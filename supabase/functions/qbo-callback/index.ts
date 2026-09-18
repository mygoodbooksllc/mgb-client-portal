import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Handles Intuit's OAuth redirect after a bookkeeper clicks "Connect
// QuickBooks" in Manage Access. verify_jwt is off on purpose: Intuit's
// browser redirect carries no Supabase session, only ?code&realmId&state.
// `state` is the client_id the Connect button encoded before redirecting,
// checked against a real qbo_connections row so a forged state can't write
// tokens for a client that never started a connect flow.

const QBO_CLIENT_ID = Deno.env.get("QBO_CLIENT_ID")!;
const QBO_CLIENT_SECRET = Deno.env.get("QBO_CLIENT_SECRET")!;
const QBO_ENV = Deno.env.get("QBO_ENV") || "sandbox"; // "sandbox" | "production"
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

function html(body: string, status = 200) {
  return new Response(
    `<!doctype html><html><body style="font:16px system-ui;padding:40px;text-align:center">${body}</body></html>`,
    { status, headers: { "Content-Type": "text/html" } },
  );
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const realmId = url.searchParams.get("realmId");
  const clientId = url.searchParams.get("state");
  const err = url.searchParams.get("error");

  if (err) return html(`QuickBooks connection was cancelled or denied (${err}). You can close this tab.`);
  if (!code || !realmId || !clientId) return html("Missing code/realmId/state from QuickBooks.", 400);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Reject a state that doesn't correspond to a client this app actually knows
  // about, so a crafted callback URL can't attribute tokens to an arbitrary id.
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

  if (!tokenRes.ok) {
    const detail = await tokenRes.text();
    await supabase
      .from("qbo_connections")
      .update({ status: "error", last_error: detail.slice(0, 500), updated_at: new Date().toISOString() })
      .eq("client_id", clientId);
    return html(`Couldn't finish connecting QuickBooks. Ask MyGoodBooks to try again.`, 502);
  }

  const tokens = await tokenRes.json();
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  await supabase.from("qbo_tokens").upsert({
    client_id: clientId,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  });

  await supabase
    .from("qbo_connections")
    .update({
      realm_id: realmId,
      status: "connected",
      connected_at: new Date().toISOString(),
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("client_id", clientId);

  return html("QuickBooks connected. You can close this tab and go back to MyGoodBooks.");
});
