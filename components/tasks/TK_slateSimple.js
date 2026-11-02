// ----------------------------------------------------------------------------
// TK_slateSimple: the ONE gate for Slate Stage B, the simpler Slate (hidden
// preview; docs/slate-stage-b-spec.md). Same pattern as TK_slatePlus.js.
//
// ONE resolver, TKB_isOn(viewAsRO, plusOn, previewOn, switchValue), true only
// when:
//   - the person is not in View as (read-only staff preview), AND
//   - Slate plus is on for the person (TKP_on()), AND
//   - a person's own preview: localStorage mgb_slatesimple_preview === "1"
//     (Developer tools > Feature flags, "Simpler Slate preview"), OR
//   - the firm switch tk_settings.slatesimple_enabled (owner-only; unset or
//     missing = off; code NEVER writes it). Read once per page load, only
//     after Slate plus is on and a session exists; the last answer is
//     remembered per browser in mgb_slatesimple_cache ("1" or removed), and
//     window event mgb:slatesimple fires when it changes.
// In View as nothing here touches the network.
//
// Callers: `TKB_on()` or, in a component, `const simple = TKB_useOn();`
// (always called, never inside a condition). Staff components only.
//
// Also the pure Today-at-a-glance rules (TKB_glance) and the Month step label
// (TKB_groupLabel). Browser file (plain JS, no JSX). Node tests:
// components/tasks/TK_slateSimple.test.js.
// ----------------------------------------------------------------------------

var TKB_PREVIEW_KEY = "mgb_slatesimple_preview";
var TKB_CACHE_KEY = "mgb_slatesimple_cache";
var TKB_EVENT = "mgb:slatesimple";
var TKB_SWITCH_KEY = "slatesimple_enabled";

function TKB__ls(k) {
  try {
    return window.localStorage.getItem(k);
  } catch (e) {
    return null;
  }
}
function TKB__lsSet(k, v) {
  try {
    if (v == null) window.localStorage.removeItem(k);
    else window.localStorage.setItem(k, v);
  } catch (e) {}
}

// Same truthy rule as TM_switchValue / WB_plusSwitchValue.
function TKB_switchValue(v) {
  return v === true || v === "true" || v === 1 || (!!v && typeof v === "object" && v.on === true);
}

// The pure resolver.
function TKB_isOn(viewAsRO, plusOn, previewOn, switchValue) {
  if (viewAsRO || plusOn !== true) return false;
  return previewOn === true || TKB_switchValue(switchValue);
}

// Slate plus right now (Stage B sits on top of it).
function TKB__plusOn() {
  try {
    return typeof TKP_on === "function" && TKP_on() === true;
  } catch (e) {
    return false;
  }
}

function TKB_previewOn() {
  return TKB__ls(TKB_PREVIEW_KEY) === "1";
}

function TKB__viewAsRO() {
  try {
    return typeof MGB_viewAsReadOnly === "function" && !!MGB_viewAsReadOnly();
  } catch (e) {
    return false;
  }
}

// One read of tk_settings.slatesimple_enabled per page load, after sign-in (no
// sooner than 3s without a session, 30s after an error, never after 3 errors
// in one page load). Read only.
var TKB__switch = { state: "idle", fails: 0, nextAt: 0 }; // state: idle | reading | done
function TKB_readSwitch(force) {
  var c = typeof window !== "undefined" ? window.mgbSupabase : null;
  if (!c || (!force && TKB__switch.state !== "idle")) return;
  if (!force && Date.now() < TKB__switch.nextAt) return;
  TKB__switch.state = "reading";
  // While a TKB_useOn() caller is mounted, a wait or an error schedules the
  // next try (TKB__kick); the 3-error cap still ends it.
  var again = function () {
    if (typeof TKB__store !== "undefined" && TKB__store.subs.length) TKB__kick();
  };
  var wait = function () {
    TKB__switch.state = "idle";
    TKB__switch.nextAt = Date.now() + 3000;
    again();
  };
  var fail = function () {
    TKB__switch.fails += 1;
    TKB__switch.state = TKB__switch.fails >= 3 ? "done" : "idle";
    TKB__switch.nextAt = Date.now() + 30000;
    again();
  };
  try {
    var go = function () {
      c.from("tk_settings")
        .select("value")
        .eq("key", TKB_SWITCH_KEY)
        .maybeSingle()
        .then(function (res) {
          if (!res || res.error) return fail();
          TKB__switch.state = "done";
          var before = TKB__ls(TKB_CACHE_KEY);
          TKB__lsSet(TKB_CACHE_KEY, res.data && TKB_switchValue(res.data.value) ? "1" : null);
          if (TKB__ls(TKB_CACHE_KEY) !== before) {
            try {
              window.dispatchEvent(new Event(TKB_EVENT));
            } catch (e) {}
          }
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

// The answer right now, from this browser only (no network).
function TKB__now() {
  return TKB_isOn(TKB__viewAsRO(), TKB__plusOn(), TKB_previewOn(), TKB__ls(TKB_CACHE_KEY) === "1");
}

// The shared check every gated spot uses (non-React callers too: tour, tips,
// announcements). Starts the switch read if needed. View as: false, no network.
function TKB_on() {
  if (TKB__viewAsRO() || !TKB__plusOn()) return false;
  if (!TKB_previewOn() && TKB__switch.state === "idle") TKB_readSwitch();
  return TKB__now();
}

// ---- One shared subscription for every TKB_useOn() caller ----------------
// Review fix (2026-10-27): every task row calls the hook, so the window
// listeners live here once (added with the first subscriber, removed with the
// last), not two per row. The answer is read from localStorage at most once
// per synchronous render pass (cached until the next microtask, dropped at
// once on a change), so a list of 300 rows costs one read, and a storage
// event that does not change the answer re-renders nothing.
var TKB__store = { subs: [], snap: false, fresh: false, retry: null, onEvent: null, onStorage: null };

function TKB__drop() {
  TKB__store.fresh = false;
}
function TKB__snapshot() {
  var st = TKB__store;
  if (st.fresh) return st.snap;
  st.snap = TKB__now();
  st.fresh = true;
  try {
    Promise.resolve().then(TKB__drop);
  } catch (e) {
    st.fresh = false;
  }
  return st.snap;
}
function TKB__notify() {
  TKB__drop();
  TKB__store.subs.slice().forEach(function (fn) {
    try {
      fn();
    } catch (e) {}
  });
}
// The switch read, started after commit (never during render). A wait (no
// session yet) or an error retries once at its time, only while something
// is subscribed; TKB_readSwitch still caps errors at 3 per page load.
function TKB__kick() {
  var st = TKB__store;
  if (TKB__switch.state !== "idle" || TKB__viewAsRO() || TKB_previewOn() || !TKB__plusOn()) return;
  var wait = TKB__switch.nextAt - Date.now();
  if (wait <= 0) {
    TKB_readSwitch();
    return;
  }
  if (st.retry || typeof setTimeout !== "function") return;
  st.retry = setTimeout(function () {
    st.retry = null;
    if (st.subs.length) TKB__kick();
  }, wait + 50);
}
function TKB__subscribe(fn) {
  var st = TKB__store;
  if (!st.subs.length && typeof window !== "undefined" && window.addEventListener) {
    st.onEvent = TKB__notify;
    st.onStorage = function (e) {
      if (!e || !e.key || /^mgb_slate(simple|plus)_/.test(e.key)) TKB__notify();
    };
    window.addEventListener(TKB_EVENT, st.onEvent);
    window.addEventListener("mgb:slateplus", st.onEvent);
    window.addEventListener("storage", st.onStorage);
  }
  st.subs.push(fn);
  TKB__kick();
  return function () {
    var i = st.subs.indexOf(fn);
    if (i >= 0) st.subs.splice(i, 1);
    if (!st.subs.length && st.onEvent && typeof window !== "undefined" && window.removeEventListener) {
      window.removeEventListener(TKB_EVENT, st.onEvent);
      window.removeEventListener("mgb:slateplus", st.onEvent);
      window.removeEventListener("storage", st.onStorage);
      st.onEvent = st.onStorage = null;
    }
  };
}

// The hook: `const simple = TKB_useOn();` Re-renders on mgb:slatesimple or
// mgb:slateplus and on a storage change to an mgb_slatesimple_/plus_ key
// from another tab, only when the answer actually changes. React 18's
// useSyncExternalStore when present; otherwise one state + effect per caller
// subscribed to the same shared store (still no per-row window listeners).
function TKB_useOn() {
  if (typeof React.useSyncExternalStore === "function") {
    return React.useSyncExternalStore(TKB__subscribe, TKB__snapshot, TKB__snapshot);
  }
  var s = React.useState(0);
  var bump = s[1];
  React.useEffect(function () {
    var last = TKB__snapshot();
    return TKB__subscribe(function () {
      var now = TKB__snapshot();
      if (now === last) return;
      last = now;
      bump(function (n) {
        return n + 1;
      });
    });
  }, []);
  return TKB__snapshot();
}

// ---- Pure rules (no DOM) ------------------------------------------------

// "4/14/24th" reads "Month step (4th/14th/24th)" under Stage B. Never mutates
// the shared TK_SLATE_GROUPS list (the Desk tab and the old bar use it).
function TKB_groupLabel(key, label) {
  return key === "part" ? "Month step (4th/14th/24th)" : label;
}

function TKB__ymd(d) {
  var y = d.getFullYear();
  var m = d.getMonth() + 1;
  var day = d.getDate();
  return y + "-" + (m < 10 ? "0" : "") + m + "-" + (day < 10 ? "0" : "") + day;
}
function TKB_addDays(ymd, n) {
  var p = String(ymd || "").split("-");
  var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]) + n);
  return TKB__ymd(d);
}
function TKB__status(t) {
  if (typeof TK_effectiveStatus === "function") return TK_effectiveStatus(t);
  return t && t.done ? "done" : (t && t.status) || "todo";
}
function TKB__due(t) {
  return t && t.due_date ? String(t.due_date).slice(0, 10) : "";
}

// Today at a glance: own open tasks only (assignee = me; Unassigned rows and
// anyone else's rows are dropped, top-level and subtasks alike).
//   overdue  : due before today, not waiting on client (TK_isOverdue rule when loaded)
//   week     : due today through today + 7 (the Next 7 days filter's range)
//   waiting  : status Waiting on client
//   top      : up to 3, overdue first, then soonest due, no due date last
// Returns { overdue, week, waiting, top: [task] }.
function TKB_glance(tasks, me, today) {
  var who = String(me || "").trim().toLowerCase();
  var day = today || TKB__ymd(new Date());
  var end = TKB_addDays(day, 7);
  var out = { overdue: 0, week: 0, waiting: 0, top: [] };
  if (!who) return out;
  var open = (Array.isArray(tasks) ? tasks : []).filter(function (t) {
    if (!t || t.deleted_at || t.done) return false;
    if (String(t.assignee_email || "").toLowerCase() !== who) return false;
    var st = TKB__status(t);
    return st !== "done";
  });
  var late = function (t) {
    if (typeof TK_isOverdue === "function") return TK_isOverdue(t, day);
    var d = TKB__due(t);
    return !!d && d < day && TKB__status(t) !== "waiting_client";
  };
  open.forEach(function (t) {
    var d = TKB__due(t);
    if (late(t)) out.overdue += 1;
    else if (d && d >= day && d <= end) out.week += 1;
    if (TKB__status(t) === "waiting_client") out.waiting += 1;
  });
  out.top = open
    .filter(function (t) {
      return TKB__status(t) !== "waiting_client";
    })
    .slice()
    .sort(function (a, b) {
      var la = late(a) ? 0 : 1;
      var lb = late(b) ? 0 : 1;
      if (la !== lb) return la - lb;
      var da = TKB__due(a) || "9999-99-99";
      var db = TKB__due(b) || "9999-99-99";
      if (da !== db) return da < db ? -1 : 1;
      var pa = { high: 0, normal: 1, low: 2 }[a.priority] == null ? 1 : { high: 0, normal: 1, low: 2 }[a.priority];
      var pb = { high: 0, normal: 1, low: 2 }[b.priority] == null ? 1 : { high: 0, normal: 1, low: 2 }[b.priority];
      if (pa !== pb) return pa - pb;
      return String(a.id || "") < String(b.id || "") ? -1 : 1;
    })
    .slice(0, 3);
  return out;
}

// The filter a glance count sets on My tasks (TK_applySlateFilters values).
function TKB_glanceFilter(kind) {
  if (kind === "overdue") return { assignee: "me", due: "late", status: "any" };
  if (kind === "week") return { assignee: "me", due: "next7", status: "any" };
  if (kind === "waiting") return { assignee: "me", due: "any", status: "waiting" };
  return null;
}

// A filter handed from the glance panel to My tasks: kept until My tasks
// mounts (or is already mounted and hears the event), then taken once.
var TKB__pendingFilter = null;
function TKB_handFilter(f) {
  TKB__pendingFilter = f || null;
  try {
    window.dispatchEvent(new Event("tkb:glance-filter"));
  } catch (e) {}
}
function TKB_takeFilter() {
  var f = TKB__pendingFilter;
  TKB__pendingFilter = null;
  return f;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    TKB_groupLabel: TKB_groupLabel,
    TKB_glance: TKB_glance,
    TKB_glanceFilter: TKB_glanceFilter,
    TKB_addDays: TKB_addDays,
    TKB_handFilter: TKB_handFilter,
    TKB_takeFilter: TKB_takeFilter,
    TKB_on: TKB_on,
    TKB_useOn: TKB_useOn,
    TKB_isOn: TKB_isOn,
    TKB_switchValue: TKB_switchValue,
    TKB_previewOn: TKB_previewOn,
    TKB_readSwitch: TKB_readSwitch,
    TKB__subscribe: TKB__subscribe,
    TKB__snapshot: TKB__snapshot,
    TKB_PREVIEW_KEY: TKB_PREVIEW_KEY,
    TKB_CACHE_KEY: TKB_CACHE_KEY,
    TKB_EVENT: TKB_EVENT,
    TKB_SWITCH_KEY: TKB_SWITCH_KEY,
  };
}
