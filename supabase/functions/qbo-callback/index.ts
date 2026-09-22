import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Handles Intuit's OAuth redirect after a bookkeeper clicks "Connect
// QuickBooks" in Manage Access. verify_jwt is off on purpose: Intuit's
// browser redirect carries no Supabase session, only ?code&realmId&state.
//
// `state` is a random single-use token the Connect button generated and
// stored in qbo_connect_state (keyed to the real client_id) BEFORE
// redirecting to Intuit — never the bare client_id itself. That token is
// looked up and marked used here, so a guessed or replayed state value can't
// attribute a connection to a client that never actually started this flow
// (Intuit's app review explicitly tests for this class of CSRF).
//
// This endpoint receives `code` (an OAuth authorization code, sensitive) in
// the URL, so per Intuit's review requirements it must 302-redirect rather
// than render HTML directly — an HTML response here would keep the code
// sitting in the browser's address bar/history, where it could leak via a
// Referer header on any outbound request that page makes. The redirect
// target carries only a plain status word, never the code or any token.
//
// Refresh/access tokens are written via the qbo_store_tokens SQL function,
// which AES-encrypts them (pgcrypto pgp_sym_encrypt) before they ever hit
// disk, keyed by QBO_TOKEN_ENCRYPTION_KEY — required by Intuit's OAuth token
// management review checklist. The key never touches the database itself.

const QBO_CLIENT_ID = Deno.env.get("QBO_CLIENT_ID")!;
const QBO_CLIENT_SECRET = Deno.env.get("QBO_CLIENT_SECRET")!;
const QBO_TOKEN_ENCRYPTION_KEY = Deno.env.get("QBO_TOKEN_ENCRYPTION_KEY")!;
const QBO_ENV = Deno.env.get("QBO_ENV") || "sandbox"; // "sandbox" | "production"
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const STATE_MAX_AGE_MS = 15 * 60 * 1000;
const APP_URL = "https://app.mygoodbooks.org";

function redirect(status: string) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${APP_URL}/quickbooks-connected?status=${status}`,
      "Cache-Control": "no-cache, no-store",
    },
  });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const realmId = url.searchParams.get("realmId");
  const stateToken = url.searchParams.get("state");
  const err = url.searchParams.get("error");

  if (err) return redirect("cancelled");
  if (!code || !realmId || !stateToken) return redirect("invalid");

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Security audit finding: this used to SELECT the row, check `used` and
  // the age in JS, then UPDATE it in a separate statement. Two callbacks
  // arriving with the same token both read used = false and both went on to
  // exchange it — the single-use guarantee the token exists for was a
  // check-then-act race. Consuming it in one UPDATE ... WHERE used = false
  // ... RETURNING means exactly one caller can ever win; the age bound moves
  // into the same WHERE so an expired token simply matches nothing.
  const { data: stateRow } = await supabase
    .from("qbo_connect_state")
    .update({ used: true })
    .eq("token", stateToken)
    .eq("used", false)
    .gt("created_at", new Date(Date.now() - STATE_MAX_AGE_MS).toISOString())
    .select("client_id, created_by")
    .maybeSingle();

  if (!stateRow) return redirect("invalid");
  const clientId = stateRow.client_id;

  const { data: existing } = await supabase.from("qbo_connections").select("client_id").eq("client_id", clientId).maybeSingle();
  if (!existing) {
    await supabase.from("qbo_connections").upsert({ client_id: clientId });
  }

  const redirectUri = `${Deno.env.get("SUPABASE_URL")}/functions/v1/qbo-callback`;
  const basicAuth = btoa(`${QBO_CLIENT_ID}:${QBO_CLIENT_SECRET}`);

  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
  });

  // intuit_tid uniquely identifies this call in Intuit's own server-side
  // logs — captured on every response so a failed/disputed call can be
  // correlated with Intuit support without digging through logs.
  const intuitTid = tokenRes.headers.get("intuit_tid");

  if (!tokenRes.ok) {
    // Deliberately not logging the response body: it can include enough of
    // the failed exchange to count as QuickBooks-adjacent data, which
    // Intuit's review prohibits logging. Status code only.
    const lastError = intuitTid
      ? `token exchange failed (${tokenRes.status}) — intuit_tid: ${intuitTid}`
      : `token exchange failed (${tokenRes.status})`;
    await supabase
      .from("qbo_connections")
      .update({ status: "error", last_error: lastError, updated_at: new Date().toISOString() })
      .eq("client_id", clientId);
    return redirect("error");
  }

  console.log(`qbo-callback: token exchange succeeded${intuitTid ? ` (intuit_tid: ${intuitTid})` : ""}`);

  const tokens = await tokenRes.json();
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  await supabase.rpc("qbo_store_tokens", {
    p_client_id: clientId,
    p_access_token: tokens.access_token,
    p_refresh_token: tokens.refresh_token,
    p_expires_at: expiresAt,
    p_key: QBO_TOKEN_ENCRYPTION_KEY,
  });

  await supabase
    .from("qbo_connections")
    .update({
      realm_id: realmId,
      status: "connected",
      // Which Intuit environment these tokens were minted against. QBO_ENV is
      // a single global default, but a realm authorized under production keys
      // returns 403 against the sandbox host (and vice versa), so the sync
      // has to know per connection rather than re-reading the global.
      api_env: QBO_ENV === "production" ? "production" : "sandbox",
      // Who actually started this flow, stamped onto the state row from the
      // JWT at insert time (see supabase/audit2-qbo-state-hardening.sql).
      // Previously nothing recorded who connected a client's QuickBooks.
      connected_by: stateRow.created_by ?? null,
      connected_at: new Date().toISOString(),
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("client_id", clientId);

  return redirect("connected");
});
