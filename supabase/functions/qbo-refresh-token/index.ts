import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { ensureFreshToken, IntuitError, NoTokensError, TokenBusyError, TokenStoreError } from "../_shared/qbo.ts";

// Batch-refreshes QBO access tokens before they expire. QBO access tokens
// last ~1hr and refresh tokens ~100 days of inactivity with NO refresh
// endpoint being called otherwise, so every connection went stale within an
// hour before this existed. Meant to be hit on a schedule (pg_cron + pg_net,
// see supabase/qbo-refresh.sql) rather than per-request.
//
// verify_jwt is off (same reasoning as qbo-callback: the caller here is
// Postgres/pg_net, not a browser with a Supabase session) but that does NOT
// mean anyone can hit this — a random anon caller must not be able to force
// token churn or read error details, so the function requires the caller to
// present a known bearer token before doing anything. Two are accepted: the
// project's service_role key, and the cron key — a secret Postgres generated
// for itself and holds in Vault (supabase/cron-shared-secret.sql), which is
// what the scheduled net.http_post call carries. The cron key is there so the
// schedule never depends on a human copying the service_role key correctly.
//
// Never logs token values — only lengths/status, matching the qbo-callback
// precedent.
//
// The refresh itself is ../_shared/qbo.ts ensureFreshToken (tested in
// tests/edge/qbo_lock.test.mjs): it reads the stored tokens first and returns
// them untouched when they have more than 10 minutes left (REFRESH_AHEAD_MS
// there), and only when a refresh is due takes the token_refresh_at lock
// (shared with qbo-sync and qbo-gl-review), re-reads under it and refreshes.
// lockTries 0: a lock held by someone else means they're refreshing that
// connection right now, so it's skipped rather than waited on. QBO_CLIENT_ID,
// QBO_CLIENT_SECRET and QBO_TOKEN_ENCRYPTION_KEY are read there. One
// connection's failure (network, timeout, a bad reply) never stops the loop.

const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Skip a connection that was touched more recently than this — avoids a
// double-refresh race if this job somehow overlaps itself or a manual
// reconnect that just ran.
const MIN_QUIET_MS = 3 * 60 * 1000;

// Constant-time comparison of two secrets. The length check leaks only the
// length (already implied by the header), then every character is compared so
// a wrong guess can't be narrowed down one byte at a time by timing.
function secretsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function unauthorized() {
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const auth = req.headers.get("Authorization") || "";
  const presented = auth.replace(/^Bearer\s+/i, "");
  if (!presented) return unauthorized();

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, SERVICE_ROLE_KEY);

  // Two bearers are accepted. The service_role key still works (manual or
  // ad-hoc calls), and so does the cron key — a 32-byte secret Postgres
  // generated for itself and keeps in Vault, read back here through the
  // service_role-only qbo_cron_key() RPC. The cron key exists so the schedule
  // never depends on someone pasting the service_role key into Vault by hand;
  // see supabase/cron-shared-secret.sql.
  let authorized = secretsMatch(presented, SERVICE_ROLE_KEY);
  if (!authorized) {
    const { data: cronKey } = await supabase.rpc("qbo_cron_key");
    authorized =
      typeof cronKey === "string" && cronKey.length > 0 && secretsMatch(presented, cronKey);
  }
  if (!authorized) return unauthorized();

  const { data: connections, error: connErr } = await supabase
    .from("qbo_connections")
    .select("client_id, updated_at")
    .eq("status", "connected");

  if (connErr) {
    return new Response(JSON.stringify({ error: "failed to list connections" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const now = Date.now();
  const result = { checked: connections?.length || 0, refreshed: 0, skipped: 0, errored: 0 };

  for (const conn of connections || []) {
    const clientId = conn.client_id;

    if (conn.updated_at && now - new Date(conn.updated_at).getTime() < MIN_QUIET_MS) {
      result.skipped++;
      continue;
    }

    let refreshedTid: string | null = null;
    try {
      const r = await ensureFreshToken(supabase, clientId, { logTag: "qbo-refresh-token", lockTries: 0 });
      if (!r.refreshed) {
        // Not due yet, or another process refreshed it while we waited.
        result.skipped++;
        continue;
      }
      refreshedTid = r.tid;
    } catch (e) {
      if (e instanceof TokenBusyError || e instanceof NoTokensError) {
        // Someone else is refreshing it right now / nothing to refresh.
        result.skipped++;
        continue;
      }
      if (e instanceof IntuitError && e.status === 401) {
        // Deliberately not logging the response body — see qbo-callback. A
        // 400/invalid_grant here almost always means the refresh token itself
        // expired or was revoked (e.g. 100+ days idle, or disconnected from
        // Intuit's side) — nothing left to retry, surface it for reconnect.
        // intuit_tid identifies the call in Intuit's own logs.
        const lastError = e.tid
          ? `Connection expired — please reconnect QuickBooks. (intuit_tid: ${e.tid})`
          : "Connection expired — please reconnect QuickBooks.";
        await supabase
          .from("qbo_connections")
          .update({ status: "error", last_error: lastError, updated_at: new Date().toISOString() })
          .eq("client_id", clientId);
        result.errored++;
        continue;
      }
      if (e instanceof TokenStoreError) {
        // Intuit rotated the refresh token and the new one couldn't be saved,
        // so the one on file is probably dead. Say so where staff will see it
        // (already logged loudly by ensureFreshToken). Status is left alone:
        // the next refresh attempt settles whether a reconnect is needed.
        await supabase
          .from("qbo_connections")
          .update({ last_error: e.message, updated_at: new Date().toISOString() })
          .eq("client_id", clientId);
        result.errored++;
        continue;
      }
      // Network / timeout / unreadable reply: our own strings only, no body.
      console.log(`qbo-refresh-token: refresh failed for client ${clientId}: ${(e as Error)?.message || e}`);
      result.errored++;
      continue;
    }

    console.log(`qbo-refresh-token: refresh succeeded for client ${clientId}${refreshedTid ? ` (intuit_tid: ${refreshedTid})` : ""}`);

    await supabase
      .from("qbo_connections")
      .update({
        status: "connected",
        last_synced_at: new Date().toISOString(),
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("client_id", clientId);

    result.refreshed++;
  }

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
