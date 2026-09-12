// Thin wrapper around the Supabase UMD client, following the same
// global-scope pattern as components/daily-close/fromClient.js — no bundler,
// so every file shares one global scope and exposes what it needs on window.
(function () {
  const configured =
    window.SUPABASE_CONFIG &&
    window.SUPABASE_CONFIG.url &&
    !window.SUPABASE_CONFIG.url.startsWith("REPLACE_") &&
    window.SUPABASE_CONFIG.anonKey &&
    !window.SUPABASE_CONFIG.anonKey.startsWith("REPLACE_");

  // Until auth-config.js has real values, expose a null client. AuthGate.jsx
  // checks this and shows a "not configured yet" message instead of a
  // confusing crash, so the rest of the app keeps working in the meantime.
  window.mgbSupabase = configured
    ? window.supabase.createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.anonKey)
    : null;
})();
