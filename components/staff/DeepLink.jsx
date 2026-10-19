// ----------------------------------------------------------------------------
// Deep links to one item (bookkeeper in-client tabs redesign, 2026-10-10).
//
// One grammar, used by every page (TABS-SPEC 1.2):
//   #/client/<clientId>/<tab>[/<sub>][?item=<kind>:<id>][&month=YYYY-MM][&account=<qboId>]
//   #/<place>[/<tab>][?item=<kind>:<id>][&client=<clientId>]   place = work, team, hr, inbox, …
//
// The path is view state that survives a refresh. The query is a one-time
// pointer: LK_capture reads it at boot and on every hashchange (this file
// loads before app.jsx, so its listener runs before App's and before
// NAV_useHashSub), stores the arrival, and strips the query with
// history.replaceState. App never sees a query.
//
// A destination claims an arrival with LK_useArrival(match, ready, onArrive)
// or LK_take(match), then shows the item with LK_reveal(LK_find(key)).
// Fallback toasts live in LK_COPY (one place, the staff guide quotes them).
//
// Never put emails, names or free text in a URL. An email travels as an
// in-memory `hint` only (LK_go's second argument).
// ----------------------------------------------------------------------------

const LK_EVENT = "mgb:arrive";
const LK_KEY = "mgb_lk_arrival_v1"; // sessionStorage, survives the sign-in round trip
const LK_TTL_MS = 20000; // how long an unclaimed arrival waits
const LK_REARM_MAX_MS = 600000; // sign-in round trip: an arrival up to 10 min old is re-armed once
const LK_UNCLAIMED_MS = 6000; // after the destination mounts, with no claimer
const LK_KINDS = [
  "msg", "docreq", "file", "question", "txn", "rownote", "task", "deadline",
  "step", "sent", "sop", "note", "setup", "at", "dupbills", "handbook", "view",
];
// Kinds a client portal user may claim (RLS limits them to their own rows).
const LK_CLIENT_KINDS = ["docreq", "file", "view"];
// Non-client places that claim something in this build. Anything else on a
// non-client place is ignored with no toast (TABS-SPEC 1.2).
// tasks: the Tasks module (TK_DrawerHost, or TK_App while the schema is missing).
// hr/handbook: handbook:<policy slug> (HB_HandbookTab.jsx).
const LK_PLACE_CLAIMS = { "work/tasks": 1, "work/deadlines": 1, "team/hours": 1, "hr/handbook": 1, inbox: 1, tasks: 1 };

const LK_COPY = {
  msgDeleted: "That message was deleted.",
  threadGone: "That conversation isn't in this client's inbox anymore.",
  reqReceived: "That request was already marked received.",
  reqReceivedOn: "Marked received {date}.",
  reqCancelled: "That request was cancelled.",
  reqMissing: "That request isn't there anymore.",
  fileMissing: "That file isn't in Documents anymore.",
  qAnswered: "That question was already resolved.",
  qOld: "That transaction is older than Bank shows. Here's the question.",
  qMissing: "That question isn't there anymore.",
  txnOutside: "That transaction isn't in the last 90 days.",
  accountMissing: "That account isn't in Bank anymore.",
  taskDone: "That task is already done.",
  taskMissing: "That task isn't there anymore, or it's private to someone else.",
  deadlineMonth: "Showing {Month}, where that deadline falls.",
  deadlineMissing: "That deadline isn't on the list anymore.",
  closeMonth: "{Month} isn't available, so you're seeing {Month2}.",
  sentMissing: "That item isn't in the sent list anymore.",
  sopMissing: "That SOP section isn't there anymore.",
  noteMissing: "That note was removed.",
  clientMissing: "That client isn't on this list.",
  policyMissing: "That policy isn't in the handbook anymore.",
  unclaimed: "We couldn't find that item. It may have been moved or removed.",
};

let LK_pending = null; // { place, clientId, tab, sub, kind, id, month, account, client, hint, at, rearmed, owned }
const LK_registry = new Set(); // matches of every mounted LK_useArrival
let LK_watchTimer = null;
let LK_unclaimedTimer = null;
// False until App's first authenticated mount (LK_rearm). While signed out
// the AuthGate keeps the hash but nothing can claim, so no arrival expires
// before then (sign-in round trip, TABS-SPEC 1.2).
let LK_appReady = false;

// Fill "{date}", "{Month}" … in an LK_COPY string.
function LK_fill(text, vars) {
  return String(text || "").replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] != null ? String(vars[k]) : m));
}

function LK_toast(text) {
  try {
    window.dispatchEvent(new CustomEvent("mgb:toast", { detail: { text } }));
  } catch (e) {}
}

function LK_reduceMotion() {
  try {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  } catch (e) {
    return false;
  }
}

function LK_key(kind, id) {
  return String(kind) + ":" + String(id);
}

function LK_find(key) {
  if (!key) return null;
  try {
    const esc = window.CSS && CSS.escape ? CSS.escape(String(key)) : String(key).replace(/["\\]/g, "\\$&");
    return document.querySelector('[data-lk="' + esc + '"]');
  } catch (e) {
    return null;
  }
}

// --- Grammar ---------------------------------------------------------------

function LK_normTab(tab) {
  const t = String(tab || "").toLowerCase();
  if (t === "setup" || t === "client-settings") return "settings";
  if (t === "client-overview") return "overview";
  if (t === "client-close") return "close";
  if (t === "client-ledger") return "ledger";
  return t;
}

function LK_validId(id) {
  return typeof id === "string" && id.length > 0 && id.length <= 300 && !/\s/.test(id);
}
function LK_validClientId(id) {
  return typeof id === "string" && /^[\w.-]{1,120}$/.test(id);
}

// t = { clientId, tab, sub, item, month, account } for a client page, or
//     { place, tab, sub, item, client } for any other place. item = "kind:id"
//     with the raw id (it is encoded here). `sub` on a non-client place is
//     used by Tasks: { place:"tasks", tab:"c", sub:"Ab/c" } → "#/tasks/c/Ab%2Fc".
function LK_href(t) {
  if (!t) return "#/";
  let path;
  if (t.clientId) {
    path = "#/client/" + encodeURIComponent(String(t.clientId));
    if (t.tab) path += "/" + encodeURIComponent(LK_normTab(t.tab));
    if (t.tab && t.sub) path += "/" + encodeURIComponent(String(t.sub));
  } else {
    path = "#/" + String(t.place || "");
    if (t.tab) path += "/" + encodeURIComponent(String(t.tab));
    if (t.tab && t.sub) path += "/" + encodeURIComponent(String(t.sub));
  }
  const q = [];
  if (t.item) {
    const s = String(t.item);
    const i = s.indexOf(":");
    const kind = i < 0 ? s : s.slice(0, i);
    const id = i < 0 ? "" : s.slice(i + 1);
    q.push("item=" + encodeURIComponent(kind) + ":" + encodeURIComponent(id));
  }
  if (t.month) q.push("month=" + encodeURIComponent(String(t.month)));
  if (t.account != null && t.account !== "") q.push("account=" + encodeURIComponent(String(t.account)));
  if (t.client) q.push("client=" + encodeURIComponent(String(t.client)));
  return path + (q.length ? "?" + q.join("&") : "");
}

// Path part of a hash → { place, clientId, tab, sub } (no query).
function LK_parsePath(hash) {
  let parts;
  try {
    parts = String(hash || "")
      .replace(/^#\/?/, "")
      .split("?")[0]
      .split("/")
      .filter(Boolean)
      .map(decodeURIComponent);
  } catch (e) {
    return null;
  }
  if (!parts.length) return null;
  if (parts[0] === "client") {
    if (!parts[1]) return null;
    return { place: "client", clientId: parts[1], tab: LK_normTab(parts[2] || ""), sub: (parts[3] || "").toLowerCase() };
  }
  const place = parts[0].toLowerCase();
  // Tasks ids are case-sensitive (client ids, uuids): keep tab and sub as typed.
  if (place === "tasks") return { place, clientId: null, tab: parts[1] || "", sub: parts[2] || "" };
  const tab = (parts[1] || "").toLowerCase();
  // An arrival stored under the old Team address of a tab that moved to HR
  // (staffNavRoutes.js rewrites live hashes first; this covers anything else).
  const moved = place === "team" && typeof NAV_HR_MOVED_TABS !== "undefined" && NAV_HR_MOVED_TABS.indexOf(tab) !== -1;
  return { place: moved ? "hr" : place, clientId: null, tab, sub: (parts[2] || "").toLowerCase() };
}

// Parse a full hash with a query into an arrival, or null. `invalid: true`
// means there was a query but it failed validation (strip and ignore).
function LK_parse(hash) {
  const h = String(hash || "");
  const qi = h.indexOf("?");
  if (qi < 0) return null;
  if (/access_token=|refresh_token=|error_description=|type=recovery/.test(h)) return null;
  const path = LK_parsePath(h.slice(0, qi));
  if (!path) return { invalid: true };
  let params;
  try {
    params = new URLSearchParams(h.slice(qi + 1));
  } catch (e) {
    return { invalid: true };
  }
  const item = params.get("item");
  const month = params.get("month");
  const account = params.get("account");
  const client = params.get("client");
  let kind = null;
  let id = null;
  if (item != null) {
    const i = item.indexOf(":");
    kind = i < 0 ? item : item.slice(0, i);
    id = i < 0 ? "" : item.slice(i + 1);
    if (!LK_KINDS.includes(kind) || kind === "view") return { invalid: true };
    if (kind === "dupbills") {
      if (id && !LK_validId(id)) return { invalid: true };
    } else if (!LK_validId(id)) return { invalid: true };
  }
  if (month != null && !/^\d{4}-\d{2}$/.test(month)) return { invalid: true };
  if (account != null && !/^[\w-]{1,64}$/.test(account)) return { invalid: true };
  if (client != null && !LK_validClientId(client)) return { invalid: true };
  if (!kind) {
    if (month == null && account == null && client == null) return { invalid: true };
    kind = "view";
    id = "";
  }
  return {
    place: path.place,
    clientId: path.clientId,
    tab: path.tab,
    sub: path.sub,
    kind,
    id,
    month: month || null,
    account: account || null,
    client: client || null,
  };
}

// --- Pending arrival -------------------------------------------------------

function LK_store(a) {
  try {
    if (!a) window.sessionStorage.removeItem(LK_KEY);
    else {
      const { hint, owned, ...rest } = a; // never store the hint (it can hold an email)
      window.sessionStorage.setItem(LK_KEY, JSON.stringify(rest));
    }
  } catch (e) {}
}

function LK_clearHighlights() {
  try {
    document.querySelectorAll(".lk-arrive, .lk-arrive-row").forEach((el) => {
      el.classList.remove("lk-arrive", "lk-arrive-row");
    });
  } catch (e) {}
}

function LK_setPending(a) {
  LK_clearHighlights(); // a second arrival clears any highlight still running
  LK_pending = a;
  LK_store(a);
  LK_watch();
}

function LK_clear() {
  LK_pending = null;
  LK_store(null);
  if (LK_watchTimer) clearInterval(LK_watchTimer);
  if (LK_unclaimedTimer) clearTimeout(LK_unclaimedTimer);
  LK_watchTimer = null;
  LK_unclaimedTimer = null;
}

function LK_fresh(a) {
  return !!a && Date.now() - (a.at || 0) <= LK_TTL_MS;
}

// Does `match` point at the arrival's place/tab (ignoring kinds)?
function LK_placeMatches(a, m) {
  if (!a || !m) return false;
  if (m.clientId) {
    if (a.place !== "client" || String(a.clientId) !== String(m.clientId)) return false;
    return !m.tab || !a.tab || a.tab === LK_normTab(m.tab);
  }
  if (m.place) {
    if (a.place !== String(m.place)) return false;
    return !m.tab || a.tab === String(m.tab);
  }
  return false;
}

function LK_kindAllowed(a, m) {
  if (!a || !m) return false;
  if (m.kinds && !m.kinds.includes(a.kind)) return false;
  if (m.staff !== true && !LK_CLIENT_KINDS.includes(a.kind)) return false;
  return true;
}

function LK_matches(a, m) {
  return LK_placeMatches(a, m) && LK_kindAllowed(a, m);
}

// Non-clearing check: is there a fresh arrival this match would take?
function LK_peek(match) {
  const a = LK_pending;
  return LK_fresh(a) && LK_matches(a, match || {}) ? a : null;
}

// Return and clear the arrival if it matches and is fresh.
function LK_take(match) {
  const a = LK_peek(match);
  if (!a) return null;
  LK_clear();
  return a;
}

// Is the current hash (the page on screen) the arrival's destination?
function LK_onDestination(a) {
  const p = LK_parsePath(window.location.hash);
  if (!p || !a) return false;
  if (a.place === "client") {
    if (p.place !== "client" || p.clientId !== a.clientId) return false;
    return !a.tab || p.tab === a.tab || (a.tab === "overview" && !p.tab);
  }
  if (p.place !== a.place) return false;
  return !a.tab || p.tab === a.tab;
}

function LK_ownedNow(a) {
  if (a.owned) return true;
  for (const m of LK_registry) {
    if (LK_placeMatches(a, m) && (LK_kindAllowed(a, m) || a.kind === "view")) return true;
  }
  return false;
}

function LK_toastable(a) {
  if (a.place === "client") return true;
  return !!LK_PLACE_CLAIMS[a.place + (a.tab ? "/" + a.tab : "")] || !!LK_PLACE_CLAIMS[a.place];
}

// The unclaimed timer starts when the destination is on screen (the first
// check after the hash matches the arrival), not at LK_go.
function LK_watch() {
  if (LK_watchTimer) clearInterval(LK_watchTimer);
  if (LK_unclaimedTimer) clearTimeout(LK_unclaimedTimer);
  LK_watchTimer = null;
  LK_unclaimedTimer = null;
  const a = LK_pending;
  if (!a) return;
  // Signed out (or App not mounted yet): no timers; LK_rearm starts them.
  if (!LK_appReady) return;
  let started = false;
  const tick = () => {
    if (LK_pending !== a) {
      clearInterval(LK_watchTimer);
      LK_watchTimer = null;
      return;
    }
    if (!started && LK_onDestination(a)) {
      started = true;
      a.at = Date.now(); // a slow boot still gets the full TTL once it's here
      LK_store(a);
      clearInterval(LK_watchTimer);
      LK_watchTimer = null;
      LK_unclaimedTimer = setTimeout(() => {
        LK_unclaimedTimer = null;
        if (LK_pending !== a) return;
        if (LK_ownedNow(a)) return; // the owner shows its own fallback; let it expire
        LK_clear();
        if (LK_toastable(a)) LK_toast(LK_COPY.unclaimed);
      }, LK_UNCLAIMED_MS);
      return;
    }
    if (!LK_fresh(a)) {
      LK_clear();
    }
  };
  LK_watchTimer = setInterval(tick, 250);
  setTimeout(tick, 0);
}

function LK_dispatch() {
  try {
    window.dispatchEvent(new CustomEvent(LK_EVENT));
  } catch (e) {}
}

// Read the query from a hash, store the arrival, strip the query.
function LK_capture(hash) {
  const h = hash == null ? window.location.hash : String(hash);
  const parsed = LK_parse(h);
  if (!parsed) return null;
  const clean = h.slice(0, h.indexOf("?"));
  try {
    if (window.location.hash === h) {
      window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search + clean);
    }
  } catch (e) {}
  if (parsed.invalid) return null;
  const a = { ...parsed, hint: null, at: Date.now(), rearmed: false, owned: false };
  LK_setPending(a);
  return a;
}

// App's first authenticated mount: give an arrival from before the sign-in
// round trip a fresh TTL, once.
function LK_rearm() {
  LK_appReady = true;
  let a = LK_pending;
  if (!a) {
    try {
      const raw = window.sessionStorage.getItem(LK_KEY);
      a = raw ? JSON.parse(raw) : null;
    } catch (e) {
      a = null;
    }
  }
  if (!a || !a.place) return false;
  if (a.rearmed || Date.now() - (a.at || 0) > LK_REARM_MAX_MS) {
    if (!LK_fresh(a)) LK_clear();
    else if (LK_pending) LK_watch(); // still fresh: the timers held off until now
    return false;
  }
  a.at = Date.now();
  a.rearmed = true;
  a.hint = a.hint || null;
  LK_setPending(a);
  return true;
}

// Go to an item. `hint` stays in memory only (e.g. { email }).
// opts.keepPreview: don't leave "Preview as" first (staff surfaces do).
function LK_go(t, hint, opts) {
  if (!t) return;
  if (!(opts && opts.keepPreview)) {
    try {
      if (typeof window.MGB_exitPreview === "function") window.MGB_exitPreview();
    } catch (e) {}
  }
  // Tasks (spec C9 item 7): a legacy "work/tasks" task link opens the new task
  // drawer in place once the Tasks schema is live and the drawer host is
  // mounted. No loop: TK_openTask only calls LK_go when the schema isn't ok.
  if (LK_forwardTask(t)) return;
  const full = LK_href(t);
  const qi = full.indexOf("?");
  const clean = qi < 0 ? full : full.slice(0, qi);
  const parsed = qi < 0 ? null : LK_parse(full);
  if (parsed && !parsed.invalid) {
    LK_setPending({ ...parsed, hint: hint || null, at: Date.now(), rearmed: true, owned: false });
  }
  const same = (() => {
    try {
      return decodeURIComponent(window.location.hash) === decodeURIComponent(clean);
    } catch (e) {
      return window.location.hash === clean;
    }
  })();
  if (same) {
    LK_dispatch();
  } else {
    window.location.hash = clean;
  }
}

function LK_forwardTask(t) {
  try {
    if (!t || t.clientId || t.place !== "work" || t.tab !== "tasks") return false;
    const item = String(t.item || "");
    if (item.indexOf("task:") !== 0 || item.length <= 5) return false;
    if (typeof TK_openTask !== "function" || typeof TK_store === "undefined" || !TK_store) return false;
    if (TK_store.getState().schema !== "ok" || window.TK_drawerHostReady !== true) return false;
    TK_openTask(item.slice(5), { from: "link" });
    return true;
  } catch (e) {
    return false;
  }
}

// onClick for an <a href={LK_href(t)}>: a plain left click goes in-app;
// Cmd/Ctrl/Shift/middle click fall through to the href (new tab works).
function LK_onClick(t, hint, opts) {
  return (e) => {
    if (!e || e.defaultPrevented) return;
    if (e.button != null && e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    LK_go(t, hint, opts);
  };
}

// Scroll to an element, highlight it briefly and focus it.
// opts.row: tint instead of ring. opts.noScroll: caller already scrolled
// (e.g. inside a scroll box). opts.block: scrollIntoView block.
function LK_reveal(el, opts) {
  if (!el) return false;
  const o = opts || {};
  const reduce = LK_reduceMotion();
  setTimeout(() => {
    try {
      if (!o.noScroll) el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: o.block || "center" });
    } catch (e) {}
    const cls = o.row ? "lk-arrive-row" : "lk-arrive";
    el.classList.remove("lk-arrive", "lk-arrive-row");
    void el.offsetWidth;
    el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), reduce ? 2000 : 2600);
    const f =
      (el.matches && el.matches("[data-lk-focus]") ? el : null) ||
      el.querySelector("[data-lk-focus]") ||
      el.querySelector("a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary");
    try {
      if (f) f.focus({ preventScroll: true });
      else {
        if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
        el.focus({ preventScroll: true });
      }
    } catch (e) {}
  }, 80);
  return true;
}

// Hook: claim an arrival for this page. Tries on mount, when `ready` turns
// true, and on LK_EVENT (same-hash LK_go, or a hashchange while mounted).
// Registering (even with ready=false) marks a matching arrival as owned, so
// the page shows its own fallback instead of the global "unclaimed" toast.
function LK_useArrival(match, ready, onArrive) {
  const m = match || {};
  const sig = JSON.stringify([m.clientId || null, m.place || null, m.tab || null, m.kinds || null, m.staff === true]);
  const matchRef = React.useRef(m);
  matchRef.current = m;
  const cbRef = React.useRef(onArrive);
  cbRef.current = onArrive;
  React.useEffect(() => {
    const reg = matchRef.current;
    if (!reg || (!reg.clientId && !reg.place)) return undefined;
    LK_registry.add(reg);
    if (LK_pending && LK_placeMatches(LK_pending, reg) && (LK_kindAllowed(LK_pending, reg) || LK_pending.kind === "view")) {
      LK_pending.owned = true;
    }
    return () => {
      LK_registry.delete(reg);
    };
  }, [sig]);
  React.useEffect(() => {
    if (!ready) return undefined;
    const tryIt = () => {
      const cur = matchRef.current;
      if (!cur || (!cur.clientId && !cur.place)) return;
      const a = LK_take(cur);
      if (a && typeof cbRef.current === "function") {
        try {
          cbRef.current(a);
        } catch (e) {
          if (window.console) console.error("[LK] arrive handler failed", e);
        }
      }
    };
    tryIt();
    window.addEventListener(LK_EVENT, tryIt);
    return () => window.removeEventListener(LK_EVENT, tryIt);
  }, [ready, sig]);
}

// --- Boot -------------------------------------------------------------------
// Runs at script load (before app.jsx's PENDING_ROUTE_KEY stash) and on every
// hashchange (registered before App's listener and NAV_useHashSub).
(function LK_boot() {
  try {
    if (!LK_capture(window.location.hash)) {
      // A stored arrival from before a reload (sign-in round trip). LK_take
      // only hands it out while fresh; LK_rearm gives it a fresh TTL once.
      // LK_watch holds its timers until LK_rearm, so it stays stored.
      const raw = window.sessionStorage.getItem(LK_KEY);
      const a = raw ? JSON.parse(raw) : null;
      if (a && a.place && Date.now() - (a.at || 0) <= LK_REARM_MAX_MS) {
        LK_pending = { ...a, hint: null, owned: false };
        if (LK_fresh(LK_pending)) LK_watch();
      } else if (a) {
        window.sessionStorage.removeItem(LK_KEY);
      }
    }
  } catch (e) {}
  window.addEventListener("hashchange", () => {
    LK_capture(window.location.hash);
    if (LK_pending) {
      // Pages that stay mounted across this hash change claim on the event;
      // pages that mount later claim on mount.
      setTimeout(LK_dispatch, 0);
    }
  });
})();
