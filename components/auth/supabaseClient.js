// Thin wrapper around the Supabase UMD client, following the same
// global-scope pattern as components/daily-close/fromClient.js — no bundler,
// so every file shares one global scope and exposes what it needs on window.

// ----------------------------------------------------------------------------
// "View as" is read-only (docs/view-as-full-app-spec.md D1/D2, §3.1).
// App sets window.mgbViewAs = { on, name, email } only after a REAL admin
// starts View as (startImpersonating); while it is off this guard does
// nothing. While on, every write leaving the page for Supabase is refused with
// a 403 and a toast. This is a UX safety net, NOT a security boundary: the
// admin's JWT can always write through devtools, and RLS stays the real
// control. Nothing may rely on this guard to keep data from the admin.
//
// It wraps window.fetch BEFORE createClient below on purpose: realtime-js
// resolves the global fetch once, when the client is built, for its REST
// broadcast fallback, so a later wrap would miss it. Websocket sends
// (presence, typing) don't use fetch; team chat is never mounted in View as.
//
// Every new read RPC a bookkeeper's page calls must be classified here
// (MGB_VIEW_AS_READ_RPCS or MGB_VIEW_AS_SILENT_RPCS, spec §3.1a) after
// checking in SQL that it is STABLE / writes nothing. Unlisted RPCs are
// blocked with a toast.
// ----------------------------------------------------------------------------
window.MGB_VIEW_AS_READ_RPCS = new Set([
  // Client-scoped reads (lists are already filtered to the viewed person's clients).
  "bookkeeper_public_profile",
  "client_team_profiles",
  "client_health",
  "client_milestone_stats",
  "client_org_settings",
  "client_org_team",
  "staff_client_org_profile", // STABLE; get-to-know answers hidden in View as (OP_StaffCard)
  "client_sop_status",
  "client_requests_for_client",
  "tk_client_report_state",
  "tk_list_client_requests",
  "tk_request_recipients",
  "tk_close_optin_status",
  "tk_waiting_on_client", // admin gets every client: callers filter to eff's
  // Firm settings / directory.
  "tk_late_count_from",
  "tk_schema_version",
  "tk_assignable_staff",
  "tk_client_people",
  "coverage_overview",
  "staff_directory",
  "staff_celebrations", // birth year hidden in View as
  "sp_staff_photo_paths",
  "search_staff_guide", // admin articles dropped in View as
  "hb_get_policy",
  "gl_review_portal_addressees",
  "client_profitability",
  "qbo_hours_by_client",
  "qbo_hours_by_staff",
  "qbo_usage_status",
  "qbo_my_client_hours",
  // JWT "me" reads that answer for the admin; callers filter to eff.
  "can_view_internal",
  "is_internal_owner",
  "staff_performance",
  "tk_on_time_stats", // callers pass eff's email
  "tk_review_stats", // callers pass eff's email
  "tk_my_coverage", // rows kept only when from/to = eff
]);
// Reads denied on purpose, with no toast and no audit row: each answers "me"
// from the admin's JWT, or shows more than the bookkeeper could see.
window.MGB_VIEW_AS_SILENT_RPCS = new Set([
  "tr_my_overview",
  "tr_get_review",
  "tr_survey_get",
  "tr_survey_results",
  "hb_status",
  "hb_approver_access",
  "tk_search",
  "wb_inbox",
  "sp_my_photo_status",
  "tk_project_task_counts",
  // Slate plus "Blocked by" (STABLE, answers for the admin's own JWT). The
  // preview is off in View as (TKP_on), so these normally never run there.
  "tk_dep_list",
  "tk_dep_my_notices",
]);
// The admin's own telemetry (JWT-bound server-side).
window.MGB_VIEW_AS_WRITE_OK = new Set(["usage_events", "client_errors"]);
window.MGB_VIEW_AS_TELEMETRY_RPCS = new Set(["log_audit_event", "record_app_time"]);
// Google Drive actions that only read (a blocked "status" would cache "not
// connected" for a minute after exit, DriveFiles.js).
window.MGB_VIEW_AS_DRIVE_READS = new Set(["status", "list", "link"]);

function MGB_viewAsReadOnly() {
  return !!(window.mgbViewAs && window.mgbViewAs.on);
}
window.MGB_viewAsReadOnly = MGB_viewAsReadOnly;

// Pure verdict for one request while View as is on: { ok, silent, kind, name }.
// url: a URL (or null when it didn't parse). base: the Supabase origin.
function MGB_viewAsVerdict(url, method, init, base) {
  if (!url) return { ok: false, kind: "other", name: "unparsed url" };
  // Other origins (CDN, Google Fonts, same-origin source files) pass.
  if (!base || url.origin !== base) return { ok: true };
  const path = url.pathname;
  const m = String(method || "GET").toUpperCase();
  const read = m === "GET" || m === "HEAD";
  const seg = (prefix) => {
    const s = path.slice(prefix.length).split("/")[0] || "";
    try {
      return decodeURIComponent(s);
    } catch (e) {
      return s;
    }
  };

  if (path.indexOf("/auth/v1/") === 0) {
    if (m === "POST" && (path === "/auth/v1/token" || path === "/auth/v1/logout")) return { ok: true };
    if (read && path === "/auth/v1/user") return { ok: true };
    return { ok: false, kind: "auth", name: path.slice("/auth/v1/".length) };
  }
  if (path.indexOf("/rest/v1/rpc/") === 0) {
    // By name whatever the method: PostgREST also takes GET RPCs.
    const name = seg("/rest/v1/rpc/");
    if (window.MGB_VIEW_AS_READ_RPCS.has(name) || window.MGB_VIEW_AS_TELEMETRY_RPCS.has(name)) return { ok: true };
    if (window.MGB_VIEW_AS_SILENT_RPCS.has(name)) return { ok: false, silent: true, kind: "rpc", name };
    return { ok: false, kind: "rpc", name };
  }
  if (path.indexOf("/rest/v1/") === 0) {
    const table = seg("/rest/v1/");
    if (read) return { ok: true };
    if (m === "POST" && window.MGB_VIEW_AS_WRITE_OK.has(table)) return { ok: true };
    // Read markers are the admin's own; StaffInbox skips them too.
    if (table === "client_message_reads") return { ok: false, silent: true, kind: "rest", name: table };
    return { ok: false, kind: "rest", name: table };
  }
  if (path.indexOf("/storage/v1/") === 0) {
    if (read) return { ok: true };
    // Signed DOWNLOAD urls and listings only; /object/upload/sign/ stays blocked.
    if (m === "POST" && (path.indexOf("/storage/v1/object/sign/") === 0 || path.indexOf("/storage/v1/object/list/") === 0))
      return { ok: true };
    return { ok: false, kind: "storage", name: path.slice("/storage/v1/".length).split("/").slice(0, 3).join("/") };
  }
  if (path.indexOf("/functions/v1/") === 0) {
    // Every method: an edge function can mail, call QBO or write on a GET.
    const fn = seg("/functions/v1/");
    if (fn === "drive-files") {
      // Download stream (drive-files?t=...): only logs failures.
      if (read && url.searchParams.get("t")) return { ok: true };
      if (m === "POST" && init && typeof init.body === "string") {
        try {
          const body = JSON.parse(init.body);
          if (body && typeof body.action === "string" && window.MGB_VIEW_AS_DRIVE_READS.has(body.action))
            return { ok: true };
        } catch (e) {}
      }
    }
    return { ok: false, kind: "function", name: fn };
  }
  // /realtime/v1/api/broadcast, /graphql/v1, anything unknown: default deny.
  if (read) return { ok: true };
  return { ok: false, kind: "other", name: path.split("/").slice(1, 3).join("/") };
}

let MGB_viewAsLastToast = 0;
// A refused write: toast (once per 4 s), a console warning, and one
// view_as.blocked audit row per page per View as session.
function MGB_viewAsBlocked(v) {
  const va = window.mgbViewAs || {};
  console.warn("[view-as] blocked " + v.kind, v.name);
  const now = Date.now();
  if (now - MGB_viewAsLastToast > 4000) {
    MGB_viewAsLastToast = now;
    try {
      window.dispatchEvent(
        new CustomEvent("mgb:toast", { detail: { text: "View as is read-only. Exit View as to make changes." } }),
      );
    } catch (e) {}
  }
  const page = String((window.__mgbActor && window.__mgbActor.page) || "unknown");
  if (!va.blockedPages) va.blockedPages = {};
  if (va.blockedPages[page]) return;
  va.blockedPages[page] = true;
  try {
    if (typeof AL_logEvent === "function")
      AL_logEvent("view_as.blocked", null, {
        target: va.email || "",
        page: page.slice(0, 60),
        kind: v.kind,
        name: String(v.name || "").slice(0, 80),
      });
  } catch (e) {}
}

(function MGB_wrapFetchForViewAs() {
  if (typeof window.fetch !== "function") return;
  const orig = window.fetch.bind(window);
  window.fetch = function (input, init) {
    if (!MGB_viewAsReadOnly()) return orig(input, init);
    // input can be a string, a URL object (.href) or a Request (.url);
    // relative URLs resolve against the page.
    let url = null;
    try {
      const raw = typeof input === "string" ? input : (input && (input.href || input.url)) || "";
      url = new URL(String(raw), window.location.href);
    } catch (e) {
      url = null;
    }
    let v;
    try {
      const method = String((init && init.method) || (input && typeof input === "object" && input.method) || "GET").toUpperCase();
      let base = null;
      try {
        base = new URL(window.SUPABASE_CONFIG.url).origin;
      } catch (e) {}
      v = MGB_viewAsVerdict(url, method, init, base);
    } catch (e) {
      v = { ok: false, kind: "other", name: "guard error" };
    }
    if (v.ok) return orig(input, init);
    if (!v.silent) MGB_viewAsBlocked(v);
    else console.debug("[view-as] skipped", v.kind, v.name);
    return Promise.resolve(
      new Response(JSON.stringify({ code: "VIEWAS", message: "View as is read-only. Exit View as to make changes." }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
    );
  };
})();

(function () {
  const configured =
    window.SUPABASE_CONFIG &&
    window.SUPABASE_CONFIG.url &&
    !window.SUPABASE_CONFIG.url.startsWith("REPLACE_") &&
    window.SUPABASE_CONFIG.anonKey &&
    !window.SUPABASE_CONFIG.anonKey.startsWith("REPLACE_");

  // Developer Tools' "Simulate slow network" flag. This file loads before
  // app.jsx exists (see index.html's load order), so it can't call
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
