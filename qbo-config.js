// QuickBooks Online connect helper (shared by Manage Access › QuickBooks in
// app.jsx and Team › QuickBooks Time in components/staff/TeamQbo.jsx).
//
// The browser no longer knows any Intuit app id or environment. Intuit issues
// separate keys for development (sandbox companies) and production (real
// companies), and which one a connection uses is decided on the server from
// the client's test_only flag (test client -> sandbox, real client and the
// firm -> production; supabase/qbo-env-per-connection.sql). The
// qbo-connect-start Edge Function mints the single-use state token, picks the
// keys, and returns the Intuit authorize URL; this helper only opens it. The
// Client IDs and Secrets live only as Edge Function secrets
// (QBO_PRODUCTION_CLIENT_ID/_SECRET, QBO_SANDBOX_CLIENT_ID/_SECRET or the
// legacy QBO_CLIENT_ID/_SECRET), never in this repo.
//
// window.mgbStartQboConnect(supabase, body)
//   body: { kind: "client", client_id } or { kind: "firm" }
//   resolves to { ok: true, url, env } or { ok: false, notConfigured, message }
//   (message is ready for a toast). Never throws.
window.QBO_CONFIG = {}; // kept so older checks for window.QBO_CONFIG don't break

window.mgbStartQboConnect = async function (supabase, body) {
  if (!supabase || !supabase.functions) {
    return { ok: false, notConfigured: false, message: "Couldn't start the QuickBooks connection. Reload and try again." };
  }
  var data = null;
  var err = null;
  try {
    var res = await supabase.functions.invoke("qbo-connect-start", { body: body });
    data = res.data;
    err = res.error;
    // A non-2xx reply arrives as an error; its JSON body says why.
    if (err && err.context && typeof err.context.json === "function") {
      try {
        var b = await err.context.json();
        if (b && b.error) data = b;
      } catch (e) {}
    }
  } catch (e) {
    err = e;
  }
  if (data && data.error === "not_configured") {
    return {
      ok: false,
      notConfigured: true,
      env: data.env,
      message:
        data.env === "sandbox"
          ? "Sandbox QuickBooks keys aren't set up yet — ask an admin."
          : "Production QuickBooks keys aren't set up yet — ask an admin.",
    };
  }
  // Only ever open Intuit's own authorize page.
  if (!err && data && typeof data.url === "string" && data.url.indexOf("https://appcenter.intuit.com/connect/oauth2?") === 0) {
    return { ok: true, url: data.url, env: data.env };
  }
  var code = data && data.error;
  var message =
    code === "forbidden"
      ? "You don't have access to connect QuickBooks here."
      : code === "unauthorized"
        ? "Your session expired. Sign in again, then connect."
        : code === "unknown_client"
          ? "This client wasn't found. Reload and try again."
          : "Couldn't start the QuickBooks connection. Try again.";
  return { ok: false, notConfigured: false, message: message };
};
