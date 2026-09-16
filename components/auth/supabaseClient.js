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

  // Developer Tools' "Simulate slow network" flag. This file loads before
  // app.jsx exists (see index.html/build.py's load order), so it can't call
  // app.jsx's isFlagOn() helper — it just checks the same "1" in localStorage
  // convention directly. The key string is duplicated in app.jsx's
  // FEATURE_FLAGS (with a comment pointing back here) rather than shared,
  // same tradeoff the daily-close files already make for their own
  // self-contained localStorage keys.
  const SLOW_NETWORK_FLAG_KEY = "mygoodbooks_ff_slow_network_v1";
  const SLOW_NETWORK_DELAY_MS = 1800;

  function slowNetworkFetch(...args) {
    let on = false;
    try {
      on = localStorage.getItem(SLOW_NETWORK_FLAG_KEY) === "1";
    } catch (e) {}
    if (!on) return fetch(...args);
    return new Promise((resolve) => setTimeout(resolve, SLOW_NETWORK_DELAY_MS)).then(() => fetch(...args));
  }

  // Until auth-config.js has real values, expose a null client. AuthGate.jsx
  // checks this and shows a "not configured yet" message instead of a
  // confusing crash, so the rest of the app keeps working in the meantime.
  window.mgbSupabase = configured
    ? window.supabase.createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.anonKey, {
        global: { fetch: slowNetworkFetch },
      })
    : null;
})();
