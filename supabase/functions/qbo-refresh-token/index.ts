import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

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
// present the project's service_role key as a Bearer token before doing
// anything. This mirrors the standard pattern for scheduled Edge Functions
// triggered by pg_cron: the cron job's net.http_post call carries the
// service_role key in its Authorization header, the same key already
// granted service_role access to qbo_store_tokens/qbo_get_tokens.
//
// Never logs token values — only lengths/status, matching the qbo-callback
// precedent.

const QBO_CLIENT_ID = Deno.env.get("QBO_CLIENT_ID")!;
const QBO_CLIENT_SECRET = Deno.env.get("QBO_CLIENT_SECRET")!;
const QBO_TOKEN_ENCRYPTION_KEY = Deno.env.get("QBO_TOKEN_ENCRYPTION_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

// Refresh anything expiring within this window (or already expired).
const REFRESH_AHEAD_MS = 10 * 60 * 1000;
// Skip a connection that was touched more recently than this — avoids a
// double-refresh race if this job somehow overlaps itself or a manual
// reconnect that just ran.
const MIN_QUIET_MS = 3 * 60 * 1000;

function unauthorized() {
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const auth = req.headers.get("Authorization") || "";
  const presented = auth.replace(/^Bearer\s+/i, "");
  // Constant-time-ish compare isn't critical here (this isn't a password
  // check against a stored hash, it's comparing to the one secret this
  // function itself holds), but do a length check first regardless.
  if (!presented || presented.length !== SERVICE_ROLE_KEY.length || presented !== SERVICE_ROLE_KEY) {
    return unauthorized();
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, SERVICE_ROLE_KEY);

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
  const basicAuth = btoa(`${QBO_CLIENT_ID}:${QBO_CLIENT_SECRET}`);
  const result = { checked: connections?.length || 0, refreshed: 0, skipped: 0, errored: 0 };

  for (const conn of connections || []) {
    const clientId = conn.client_id;

    if (conn.updated_at && now - new Date(conn.updated_at).getTime() < MIN_QUIET_MS) {
      result.skipped++;
      continue;
    }

    const { data: tokenRows, error: tokErr } = await supabase.rpc("qbo_get_tokens", {
      p_client_id: clientId,
      p_key: QBO_TOKEN_ENCRYPTION_KEY,
    });
    const tokenRow = tokenRows?.[0];
    if (tokErr || !tokenRow?.refresh_token) {
      result.skipped++;
      continue;
    }

    const expiresAtMs = tokenRow.expires_at ? new Date(tokenRow.expires_at).getTime() : 0;
    if (expiresAtMs - now > REFRESH_AHEAD_MS) {
      result.skipped++;
      continue;
    }

    const tokenRes = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: tokenRow.refresh_token }),
    });

    // intuit_tid uniquely identifies this call in Intuit's own server-side
    // logs — captured on every response so a failed/disputed call can be
    // correlated with Intuit support without digging through logs.
    const intuitTid = tokenRes.headers.get("intuit_tid");

    if (!tokenRes.ok) {
      // Deliberately not logging the response body — see qbo-callback. A
      // 400/invalid_grant here almost always means the refresh token itself
      // expired or was revoked (e.g. 100+ days idle, or disconnected from
      // Intuit's side) — nothing left to retry, surface it for reconnect.
      const lastError = intuitTid
        ? `Connection expired — please reconnect QuickBooks. (intuit_tid: ${intuitTid})`
        : "Connection expired — please reconnect QuickBooks.";
      await supabase
        .from("qbo_connections")
        .update({
          status: "error",
          last_error: lastError,
          updated_at: new Date().toISOString(),
        })
        .eq("client_id", clientId);
      result.errored++;
      continue;
    }

    console.log(`qbo-refresh-token: refresh succeeded for client ${clientId}${intuitTid ? ` (intuit_tid: ${intuitTid})` : ""}`);

    const tokens = await tokenRes.json();
    const newExpiresAt = new Date(now + tokens.expires_in * 1000).toISOString();

    // Intuit always rotates the refresh token on every use — the old one is
    // invalid the instant this call succeeds, so the new one MUST be stored.
    await supabase.rpc("qbo_store_tokens", {
      p_client_id: clientId,
      p_access_token: tokens.access_token,
      p_refresh_token: tokens.refresh_token,
      p_expires_at: newExpiresAt,
      p_key: QBO_TOKEN_ENCRYPTION_KEY,
    });

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
