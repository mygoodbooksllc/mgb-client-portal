import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  authorizeUrl,
  denoEnv,
  keysForEnv,
  parseEnvStrict,
  QboKeysMissingError,
  qboRedirectUri,
} from "../_shared/qbo-env.ts";

// Starts a QuickBooks connect: mints the single-use OAuth state token and
// returns the Intuit authorize URL built with the RIGHT Intuit app for that
// connection (development keys for a test client, production keys for a real
// client or the firm). The browser opens the URL; Intuit then redirects to
// qbo-callback, which exchanges the code with the same environment's keys.
//
// DEPLOY WITH verify_jwt ON (the default): only signed-in callers. Unlike the
// other qbo-* functions this one is never called by cron or by Intuit.
//
// Request (POST, the caller's own Supabase session):
//   { kind: "client", client_id: "<clients.id>" }   staff with access to it
//   { kind: "firm" }                                admins only
// Response:
//   200 { url, env }                         open url in a new tab
//   409 { error: "not_configured", env, missing_secrets: [names] }
//        that environment's Intuit keys aren't set as edge-function secrets;
//        the user is NOT sent to Intuit. Names only, never values.
//   400 { error: "bad_request" } / 401 { error: "unauthorized" }
//   403 { error: "forbidden" } / 404 { error: "unknown_client" }
//   500 { error: "server_error" }
//
// Authorization is the SQL RPCs, called AS THE CALLER (anon key + their JWT):
// qbo_connect_start(p_client_id) requires is_active_staff() and
// can_access_client(); qbo_firm_connect_start() requires an admin. The RPCs
// also decide the environment from clients.test_only (the rule lives in SQL:
// public.qbo_env_for_client, supabase/qbo-env-per-connection.sql) and stamp it
// on the state row, so neither this function nor the browser chooses it. The
// service-role client is used for one thing only: deleting the state row we
// just minted when the keys turn out to be missing, so it can't be used.
//
// No secret is ever returned: the URL carries the Intuit client id, which is
// public by design (it is in every authorize URL), never the client secret.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

const TOKEN_RE = /^[0-9a-f]{64}$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "bad_request" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const authHeader = req.headers.get("Authorization") || "";
  if (!/^Bearer\s+\S+$/i.test(authHeader)) return json({ error: "unauthorized" }, 401);

  let body: any = null;
  try {
    body = await req.json();
  } catch (_e) {
    return json({ error: "bad_request" }, 400);
  }
  const kind = body?.kind;
  const clientId = typeof body?.client_id === "string" ? body.client_id.trim() : "";
  if (kind !== "client" && kind !== "firm") return json({ error: "bad_request" }, 400);
  if (kind === "client" && (!clientId || clientId.length > 200)) return json({ error: "bad_request" }, 400);

  const asUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userRes, error: userErr } = await asUser.auth.getUser();
  if (userErr || !userRes?.user) return json({ error: "unauthorized" }, 401);

  const { data: started, error: rpcErr } = kind === "client"
    ? await asUser.rpc("qbo_connect_start", { p_client_id: clientId })
    : await asUser.rpc("qbo_firm_connect_start");
  if (rpcErr) {
    const code = (rpcErr as any).code;
    if (code === "42501") return json({ error: "forbidden" }, 403);
    if (code === "22023") return json({ error: "bad_request" }, 400);
    if (code === "P0002") return json({ error: "unknown_client" }, 404);
    console.log(`qbo-connect-start: ${kind} start RPC failed (${code ?? "no code"})`);
    return json({ error: "server_error" }, 500);
  }

  const token = typeof started?.token === "string" ? started.token : "";
  const env = parseEnvStrict(started?.api_env);
  if (!TOKEN_RE.test(token) || !env) {
    console.log(`qbo-connect-start: ${kind} start RPC returned an unexpected shape`);
    return json({ error: "server_error" }, 500);
  }

  let keys;
  try {
    keys = keysForEnv(env, denoEnv);
  } catch (e) {
    if (!(e instanceof QboKeysMissingError)) {
      return json({ error: "server_error" }, 500);
    }
    // Burn the token we just minted: nobody will be sent to Intuit with it.
    try {
      const admin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
        auth: { persistSession: false },
      });
      await admin
        .from(kind === "client" ? "qbo_connect_state" : "qbo_firm_connect_state")
        .delete()
        .eq("token", token);
    } catch (_e) {
      // It expires after 15 minutes in qbo-callback regardless.
    }
    console.log(`qbo-connect-start: ${kind} connect refused — ${env} keys not configured (missing: ${e.missing.join(", ")})`);
    return json({ error: "not_configured", env, missing_secrets: e.missing }, 409);
  }

  let redirectUri: string;
  try {
    redirectUri = qboRedirectUri(SUPABASE_URL);
  } catch (_e) {
    return json({ error: "server_error" }, 500);
  }
  return json({ url: authorizeUrl(keys.clientId, redirectUri, token), env });
});
