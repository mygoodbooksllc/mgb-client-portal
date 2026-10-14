import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  denoEnv,
  keysForStoredEnv,
  normalizeStoredEnv,
  type QboEnv,
  QboKeysMissingError,
  qboRedirectUri,
  sanitizeIntuitTid,
} from "../_shared/qbo-env.ts";

// Handles Intuit's OAuth redirect after a bookkeeper clicks "Connect
// QuickBooks" in Manage Access. verify_jwt is off on purpose: Intuit's
// browser redirect carries no Supabase session, only ?code&realmId&state.
//
// `state` is a random single-use token minted server-side BEFORE the redirect
// to Intuit — never the bare client_id itself. Client connects: the
// qbo_connect_start() RPC (via the qbo-connect-start function) writes it to
// qbo_connect_state, keyed to the real client_id and carrying the Intuit
// environment it decided (api_env). Firm connects: qbo_firm_connect_start()
// writes it to qbo_firm_connect_state (api_env 'production'). That token is
// looked up and marked used here, so a guessed or replayed state value can't
// attribute a connection to a client that never actually started this flow
// (Intuit's app review explicitly tests for this class of CSRF).
//
// Per-connection Intuit keys (supabase/functions/_shared/qbo-env.ts): the code
// is exchanged with the keys of the environment stamped on the STATE ROW, and
// that same environment is stamped on the connection, so every later refresh
// uses the keys that minted it. There is no global environment any more: the
// old QBO_ENV secret is not read (it can be deleted). A state row from before
// api_env existed (NULL) is treated as sandbox/legacy keys, which is what the
// old flow used. Missing keys for that environment -> ?status=not_configured,
// with the secret NAMES (never values) in last_error.
//
// This endpoint receives `code` (an OAuth authorization code, sensitive) in
// the URL, so per Intuit's review requirements it must 302-redirect rather
// than render HTML directly — an HTML response here would keep the code
// sitting in the browser's address bar/history, where it could leak via a
// Referer header on any outbound request that page makes. The redirect
// target carries only a plain status word, and on an exchange failure
// optionally ref=<intuit_tid> (strictly validated: letters, digits, dashes),
// never the code or any token.
//
// Refresh/access tokens are written via the qbo_store_tokens SQL function,
// which AES-encrypts them (pgcrypto pgp_sym_encrypt) before they ever hit
// disk, keyed by QBO_TOKEN_ENCRYPTION_KEY — required by Intuit's OAuth token
// management review checklist. The key never touches the database itself.
//
// Never logs or stores Intuit response bodies: status code + intuit_tid only.

const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const TOKEN_FETCH_TIMEOUT_MS = 20 * 1000;
const STATE_MAX_AGE_MS = 15 * 60 * 1000;
const APP_URL = "https://app.mygoodbooks.org";

function redirect(status: "connected" | "cancelled" | "invalid" | "error" | "not_configured", ref: string | null = null) {
  const qs = new URLSearchParams({ status });
  const safeRef = sanitizeIntuitTid(ref);
  if (safeRef) qs.set("ref", safeRef);
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${APP_URL}/quickbooks-connected?${qs}`,
      "Cache-Control": "no-cache, no-store",
    },
  });
}

type Exchange =
  | { ok: true; tokens: { access_token: string; refresh_token: string; expires_in: number }; tid: string | null }
  | { ok: false; lastError: string; tid: string | null };

// The authorization-code exchange with this environment's keys. Never throws,
// never reads an error body. Network failure / timeout / a malformed 2xx are
// failures like a non-2xx, described with our own words only.
async function exchangeCode(env: QboEnv, clientId: string, clientSecret: string, code: string, redirectUri: string): Promise<Exchange> {
  let res: Response;
  try {
    res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
      signal: AbortSignal.timeout(TOKEN_FETCH_TIMEOUT_MS),
    });
  } catch (e) {
    const timedOut = (e as Error)?.name === "TimeoutError" || (e as Error)?.name === "AbortError";
    return { ok: false, lastError: `[${env}] token exchange failed (${timedOut ? "timed out" : "network error"})`, tid: null };
  }
  // intuit_tid uniquely identifies this call in Intuit's own server-side
  // logs — captured on every response so a failed/disputed call can be
  // correlated with Intuit support without digging through logs. Only a
  // plain id shape is kept.
  const tid = sanitizeIntuitTid(res.headers.get("intuit_tid"));
  if (!res.ok) {
    // Deliberately not reading or logging the response body: it can include
    // enough of the failed exchange to count as QuickBooks-adjacent data,
    // which Intuit's review prohibits logging. Status code only.
    try { await res.body?.cancel(); } catch (_e) { /* ignore */ }
    return { ok: false, lastError: `[${env}] token exchange failed (${res.status})${tid ? ` — intuit_tid: ${tid}` : ""}`, tid };
  }
  let tokens: any = null;
  try {
    tokens = await res.json();
  } catch (_e) {
    tokens = null; // the parse error can quote the body: never surfaced
  }
  const expiresIn = Number(tokens?.expires_in);
  if (!tokens?.access_token || !tokens?.refresh_token || !(expiresIn > 0)) {
    return { ok: false, lastError: `[${env}] token exchange failed (unreadable reply)${tid ? ` — intuit_tid: ${tid}` : ""}`, tid };
  }
  return { ok: true, tokens: { access_token: tokens.access_token, refresh_token: tokens.refresh_token, expires_in: expiresIn }, tid };
}

// Firm connect: same token exchange, but the tokens go to qbo_firm_tokens
// (qbo_firm_store_tokens, same pgcrypto encryption and key) and the status to
// the singleton qbo_firm_connection. Nothing here touches qbo_connections.
async function connectFirm(supabase: any, code: string, realmId: string, createdBy: string | null, stateEnv: unknown) {
  const env = normalizeStoredEnv(stateEnv);
  const markError = (lastError: string) =>
    supabase.from("qbo_firm_connection").upsert({
      id: true,
      status: "error",
      last_error: lastError,
      updated_at: new Date().toISOString(),
    });

  let keys;
  try {
    keys = keysForStoredEnv(stateEnv, denoEnv);
  } catch (e) {
    if (!(e instanceof QboKeysMissingError)) throw e;
    await markError(`${e.message}. Ask an admin to add them, then connect again.`);
    console.log(`qbo-callback: firm connect refused — ${env} keys not configured`);
    return redirect("not_configured");
  }

  const ex = await exchangeCode(env, keys.clientId, keys.clientSecret, code, qboRedirectUri(Deno.env.get("SUPABASE_URL")));
  if (!ex.ok) {
    await markError(ex.lastError);
    console.log(`qbo-callback: firm ${ex.lastError}`);
    return redirect("error", ex.tid);
  }
  console.log(`qbo-callback: firm token exchange succeeded [${env}]${ex.tid ? ` (intuit_tid: ${ex.tid})` : ""}`);
  const encKey = Deno.env.get("QBO_TOKEN_ENCRYPTION_KEY") ?? "";
  const { error: storeErr } = await supabase.rpc("qbo_firm_store_tokens", {
    p_access_token: ex.tokens.access_token,
    p_refresh_token: ex.tokens.refresh_token,
    p_expires_at: new Date(Date.now() + ex.tokens.expires_in * 1000).toISOString(),
    p_key: encKey,
  });
  if (storeErr) {
    await markError(`[${env}] connected, but saving the QuickBooks sign-in failed — connect again`);
    return redirect("error");
  }
  const { error: markErr } = await supabase.rpc("qbo_firm_mark_connected", {
    p_realm_id: realmId,
    // From the STATE ROW (decided in SQL at connect start), never a global.
    p_api_env: env,
    p_connected_by: createdBy,
  });
  if (markErr) return redirect("error");
  return redirect("connected");
}

// Any unexpected throw still ends in a 302 (never a 500 page left sitting on a
// URL that carries the authorization code).
Deno.serve(async (req) => {
  try {
    return await handle(req);
  } catch (_e) {
    console.log("qbo-callback: unexpected failure");
    return redirect("error");
  }
});

async function handle(req: Request): Promise<Response> {
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
  // api_env needs supabase/qbo-env-per-connection.sql applied first.
  const { data: stateRow } = await supabase
    .from("qbo_connect_state")
    .update({ used: true })
    .eq("token", stateToken)
    .eq("used", false)
    .gt("created_at", new Date(Date.now() - STATE_MAX_AGE_MS).toISOString())
    .select("client_id, created_by, api_env")
    .maybeSingle();

  if (!stateRow) {
    // Not a client connect. It may be a FIRM connect (MyGoodBooks' own
    // company, for QuickBooks Time hours): those tokens are minted only by the
    // admin-only qbo_firm_connect_start() RPC into qbo_firm_connect_state
    // (supabase/qbo-firm-time.sql, supabase/qbo-env-per-connection.sql) and
    // consumed with the same atomic single-use UPDATE.
    const { data: firmState } = await supabase
      .from("qbo_firm_connect_state")
      .update({ used: true })
      .eq("token", stateToken)
      .eq("used", false)
      .gt("created_at", new Date(Date.now() - STATE_MAX_AGE_MS).toISOString())
      .select("created_by, api_env")
      .maybeSingle();
    if (!firmState) return redirect("invalid");
    try {
      return await connectFirm(supabase, code, realmId, firmState.created_by ?? null, firmState.api_env);
    } catch (_e) {
      return redirect("error");
    }
  }
  const clientId = stateRow.client_id;

  let env: QboEnv;
  try {
    env = normalizeStoredEnv(stateRow.api_env);
  } catch (_e) {
    return redirect("error");
  }

  // A row in any status (including 'error' from an earlier failed attempt)
  // never blocks a new connect: make sure one exists, then update it.
  const { data: existing } = await supabase.from("qbo_connections").select("client_id").eq("client_id", clientId).maybeSingle();
  if (!existing) {
    await supabase.from("qbo_connections").upsert({ client_id: clientId });
  }

  let keys;
  try {
    keys = keysForStoredEnv(stateRow.api_env, denoEnv);
  } catch (e) {
    if (!(e instanceof QboKeysMissingError)) return redirect("error");
    await supabase
      .from("qbo_connections")
      .update({
        status: "error",
        last_error: `${e.message}. Ask an admin to add them, then connect again.`,
        updated_at: new Date().toISOString(),
      })
      .eq("client_id", clientId);
    console.log(`qbo-callback: client ${clientId} connect refused — ${env} keys not configured`);
    return redirect("not_configured");
  }

  const ex = await exchangeCode(env, keys.clientId, keys.clientSecret, code, qboRedirectUri(Deno.env.get("SUPABASE_URL")));
  if (!ex.ok) {
    await supabase
      .from("qbo_connections")
      .update({ status: "error", last_error: ex.lastError, updated_at: new Date().toISOString() })
      .eq("client_id", clientId);
    console.log(`qbo-callback: client ${clientId} ${ex.lastError}`);
    return redirect("error", ex.tid);
  }

  console.log(`qbo-callback: token exchange succeeded [${env}]${ex.tid ? ` (intuit_tid: ${ex.tid})` : ""}`);

  const expiresAt = new Date(Date.now() + ex.tokens.expires_in * 1000).toISOString();
  const { error: storeErr } = await supabase.rpc("qbo_store_tokens", {
    p_client_id: clientId,
    p_access_token: ex.tokens.access_token,
    p_refresh_token: ex.tokens.refresh_token,
    p_expires_at: expiresAt,
    p_key: Deno.env.get("QBO_TOKEN_ENCRYPTION_KEY") ?? "",
  });
  if (storeErr) {
    // Previously ignored: the connection was marked connected with no
    // usable tokens on file.
    await supabase
      .from("qbo_connections")
      .update({
        status: "error",
        last_error: `[${env}] connected, but saving the QuickBooks sign-in failed — connect again`,
        updated_at: new Date().toISOString(),
      })
      .eq("client_id", clientId);
    return redirect("error");
  }

  await supabase
    .from("qbo_connections")
    .update({
      realm_id: realmId,
      status: "connected",
      // Which Intuit environment (and so which app keys) these tokens were
      // minted with — taken from the STATE ROW, which the connect-start RPC
      // stamped from clients.test_only. Never from a global: refresh and the
      // API host both follow this value.
      api_env: env,
      // Who actually started this flow, stamped onto the state row from the
      // JWT at insert time (see supabase/audit2-qbo-state-hardening.sql).
      connected_by: stateRow.created_by ?? null,
      connected_at: new Date().toISOString(),
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("client_id", clientId);

  return redirect("connected");
}
