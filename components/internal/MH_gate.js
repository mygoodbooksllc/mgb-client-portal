// ----------------------------------------------------------------------------
// MH_gate: the one gate for MGB Home (docs/mgb-home-spec.md section 6), the
// firm's own home for the internal client (MyGoodBooks, clients.id
// 'mygoodbooks'): the rail label "MGB Home", its header and tab row, the
// #/internal/<tab> routes, the Home cards, Profitability and Pricing & fees,
// the ⌘K entries, its tour and notice, and the Team › Hours money hand-off.
//
//   MH_on()               = localStorage mgb_home_preview === "1"
//                           OR tk_settings.mgb_home_enabled is true
//   MH_canOpen(real, imp) = STAFF_canViewInternal(real, imp) && MH_on()
//
// STAFF_canViewInternal (app.jsx) is an active admin with the owner's MGB
// (internal) grant who is not in View as. Without it nothing here runs: no
// switch read, no label, no route, no hint. Money pieces keep
// TP_PF_canSee(effectiveUser) as a second guard, and every query behind them
// is refused server-side without can_view_internal().
//
// The firm switch tk_settings.mgb_home_enabled is owner-only
// (tk__owner_only_key, supabase/mgb-home-s1.sql); unset or missing = off;
// code NEVER writes it. Read once per page load after a session exists; the
// last answer is remembered per browser in mgb_home_cache ("1" or removed),
// and window event mgb:mgbhome fires when it changes.
//
// Never scatter raw checks: call MH_canOpen / MH_useCanOpen (React) or
// MH_on (non-React: tours, announcements). Browser file (plain JS, no JSX);
// loads before TeamPage.jsx and app.jsx. Node tests: MH_gate.test.js.
// Template: components/inbox/TM_gate.js.
// ----------------------------------------------------------------------------

var MH_PREVIEW_KEY = "mgb_home_preview";
var MH_CACHE_KEY = "mgb_home_cache";
var MH_EVENT = "mgb:mgbhome";
var MH_SWITCH_KEY = "mgb_home_enabled";

function MH__ls(k) {
  try {
    return window.localStorage.getItem(k);
  } catch (e) {
    return null;
  }
}
function MH__lsSet(k, v) {
  try {
    if (v == null) window.localStorage.removeItem(k);
    else window.localStorage.setItem(k, v);
  } catch (e) {}
}

// Same truthy rule as TM_switchValue / WB_plusSwitchValue.
function MH_switchValue(v) {
  return v === true || v === "true" || v === 1 || (!!v && typeof v === "object" && v.on === true);
}

// Pure resolvers (tested in node).
function MH_isOn(previewOn, switchValue) {
  return previewOn === true || MH_switchValue(switchValue);
}
function MH_canOpenPure(canViewInternal, on) {
  return canViewInternal === true && on === true;
}

function MH_previewOn() {
  return MH__ls(MH_PREVIEW_KEY) === "1";
}

function MH__ping() {
  try {
    window.dispatchEvent(new Event(MH_EVENT));
  } catch (e) {}
}

// One read of tk_settings.mgb_home_enabled per page load, after sign-in (no
// sooner than 3s without a session, 30s after an error, never after 3 errors
// in one page load). Read only.
var MH__switch = { state: "idle", fails: 0, nextAt: 0 }; // idle | reading | done
function MH_readSwitch(force) {
  var c = typeof window !== "undefined" ? window.mgbSupabase : null;
  if (!c || (!force && MH__switch.state !== "idle")) return;
  if (!force && Date.now() < MH__switch.nextAt) return;
  MH__switch.state = "reading";
  var wait = function () {
    MH__switch.state = "idle";
    MH__switch.nextAt = Date.now() + 3000;
  };
  var fail = function () {
    MH__switch.fails += 1;
    MH__switch.state = MH__switch.fails >= 3 ? "done" : "idle";
    MH__switch.nextAt = Date.now() + 30000;
    if (MH__switch.state === "done") MH__ping(); // settled (gave up): waiting pages may go on
  };
  try {
    var go = function () {
      c.from("tk_settings")
        .select("value")
        .eq("key", MH_SWITCH_KEY)
        .maybeSingle()
        .then(function (res) {
          if (!res || res.error) return fail();
          MH__switch.state = "done";
          MH__lsSet(MH_CACHE_KEY, res.data && MH_switchValue(res.data.value) ? "1" : null);
          // Always, not only on a change: pages waiting for MH_switchSettled
          // (app.jsx's MGB Home redirect) re-render once the answer is in.
          MH__ping();
        }, fail);
    };
    if (c.auth && typeof c.auth.getSession === "function") {
      c.auth.getSession().then(function (r) {
        if (r && r.data && r.data.session) go();
        else wait();
      }, fail);
    } else go();
  } catch (e) {
    fail();
  }
}

// Is MGB Home on in this browser (preview or switch)? Starts the switch read
// if needed, with the preview on too, so mgb_home_cache (which the launch
// notice reads) never goes stale; never decides who may open it (that is
// MH_canOpen).
function MH_on() {
  if (MH__switch.state === "idle") MH_readSwitch();
  return MH_isOn(MH_previewOn(), MH__ls(MH_CACHE_KEY) === "1");
}

// Is the answer final for this page load? True with the preview on (always
// open) or once the switch read finished (or gave up). Until then a cold
// cache reads as off, so callers that would send someone away (app.jsx's
// redirect to Team › Hours) wait instead.
function MH_switchSettled() {
  return MH_previewOn() || MH__switch.state === "done";
}

function MH__canViewInternal(real, imp) {
  try {
    return typeof STAFF_canViewInternal === "function" && STAFF_canViewInternal(real, imp) === true;
  } catch (e) {
    return false;
  }
}

// THE gate. Without the internal grant (or in View as) it answers false
// before touching the preview, the cache or the network.
function MH_canOpen(real, imp) {
  if (!MH__canViewInternal(real, imp)) return false;
  return MH_canOpenPure(true, MH_on());
}

// React: `const mhOn = MH_useCanOpen(realUser, impersonating);`
// Re-renders on mgb:mgbhome (the switch answer changed) and on a storage
// change to an mgb_home_* key from another tab.
function MH_useCanOpen(real, imp) {
  var s = React.useState(0);
  var bump = s[1];
  React.useEffect(function () {
    var hit = function () {
      bump(function (n) {
        return n + 1;
      });
    };
    var onStorage = function (e) {
      if (!e || !e.key || /^mgb_home_/.test(e.key)) hit();
    };
    window.addEventListener(MH_EVENT, hit);
    window.addEventListener("storage", onStorage);
    return function () {
      window.removeEventListener(MH_EVENT, hit);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return MH_canOpen(real, imp);
}

// ---------------------------------------------------------------------------
// Pages and routes (app.jsx parseHashRoute / buildHashRoute / effectivePage).
// MGB Home is still the internal client: its own three pages plus the Firm
// books menu, which regroups the internal client's existing pages unchanged.
// Overhead, Cost rates and Capacity are later slices (not built, no route).
// ---------------------------------------------------------------------------
var MH_TABS = [
  { key: "mgb-home", slug: "", label: "Home", tour: "mh-tab-home" },
  { key: "mgb-profitability", slug: "profitability", label: "Profitability", tour: "mh-tab-profit" },
  { key: "mgb-pricing", slug: "pricing", label: "Pricing & fees", tour: "mh-tab-pricing" },
];
// #/internal/books/<slug> -> an existing page key. Labels are for the Firm
// books menu; "fin" marks the Finances group (shown only when the internal
// client's plan has that page).
var MH_BOOKS = [
  { slug: "overview", page: "client-overview", label: "Overview" },
  { slug: "close", page: "client-close", label: "Close" },
  { slug: "reports", page: "reports", label: "Reports" },
  { slug: "bank", page: "bank", label: "Bank" },
  { slug: "ledger", page: "client-ledger", label: "Ledger review" },
  { slug: "documents", page: "documents", label: "Documents" },
  { slug: "sop", page: "sop", label: "SOP" },
  { slug: "finances", page: "dashboard", label: "Finances", fin: true },
  { slug: "budget", page: "budget", label: "Budget", fin: true },
  { slug: "receivables", page: "receivables", label: "Receivables", fin: true },
];

function MH_isPage(p) {
  for (var i = 0; i < MH_TABS.length; i++) if (MH_TABS[i].key === p) return true;
  return false;
}
function MH_bookOf(page) {
  for (var i = 0; i < MH_BOOKS.length; i++) if (MH_BOOKS[i].page === page) return MH_BOOKS[i];
  return null;
}

// The segments after "#/internal" -> a page key, or null for the landing
// (bare #/internal, or anything unknown: lands like a bare open).
function MH_pageFromPath(parts) {
  var a = parts || [];
  if (!a.length) return null;
  if (a[0] === "books") {
    for (var i = 0; i < MH_BOOKS.length; i++) if (MH_BOOKS[i].slug === a[1]) return MH_BOOKS[i].page;
    return null;
  }
  for (var j = 0; j < MH_TABS.length; j++) if (MH_TABS[j].slug && MH_TABS[j].slug === a[0]) return MH_TABS[j].key;
  return null;
}

// A page key -> its #/internal hash, or null (Client setup and anything else
// keep their #/client/<id>/... form).
function MH_hashFor(page) {
  for (var i = 0; i < MH_TABS.length; i++)
    if (MH_TABS[i].key === page) return "#/internal" + (MH_TABS[i].slug ? "/" + MH_TABS[i].slug : "");
  var b = MH_bookOf(page);
  return b ? "#/internal/books/" + b.slug : null;
}

// Team › Hours "Fees and margin are in MGB Home" line: shown for 30 days from
// the first time it showed in this browser (mgb_home_moved_seen, cleared by
// Reset local state). nowMs/firstMs are epoch ms; firstMs null = never shown.
var MH_MOVED_KEY = "mgb_home_moved_seen";
var MH_MOVED_DAYS = 30;
function MH_movedLineShows(firstMs, nowMs) {
  if (firstMs == null || !isFinite(firstMs)) return true;
  return nowMs - firstMs < MH_MOVED_DAYS * 86400000;
}
function MH_movedLineOn() {
  var now = Date.now();
  var raw = MH__ls(MH_MOVED_KEY);
  var first = raw ? Number(raw) : null;
  if (first == null || !isFinite(first)) MH__lsSet(MH_MOVED_KEY, String(now));
  return MH_movedLineShows(first, now);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    MH_isOn: MH_isOn,
    MH_canOpenPure: MH_canOpenPure,
    MH_switchValue: MH_switchValue,
    MH_previewOn: MH_previewOn,
    MH_readSwitch: MH_readSwitch,
    MH_on: MH_on,
    MH_switchSettled: MH_switchSettled,
    MH_canOpen: MH_canOpen,
    MH_PREVIEW_KEY: MH_PREVIEW_KEY,
    MH_CACHE_KEY: MH_CACHE_KEY,
    MH_EVENT: MH_EVENT,
    MH_SWITCH_KEY: MH_SWITCH_KEY,
    MH_TABS: MH_TABS,
    MH_BOOKS: MH_BOOKS,
    MH_isPage: MH_isPage,
    MH_bookOf: MH_bookOf,
    MH_pageFromPath: MH_pageFromPath,
    MH_hashFor: MH_hashFor,
    MH_movedLineShows: MH_movedLineShows,
    MH_MOVED_KEY: MH_MOVED_KEY,
  };
}
