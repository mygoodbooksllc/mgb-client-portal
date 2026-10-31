// ----------------------------------------------------------------------------
// TK_slatePlus: the ONE gate for the hidden "Slate plus" batch (sibling
// features built at the same time share it; first user: @mention polish in
// task comments, docs/slateplus-mentions-spec.md).
//
// ONE resolver, TKP_isOn(viewAsRO, previewOn, switchValue), true only when:
//   - the person is not in View as (read-only staff preview), AND
//   - a person's own preview: localStorage mgb_slateplus_preview === "1"
//     (Developer tools > Feature flags, "Slate plus preview"), OR
//   - the firm switch tk_settings.slateplus_enabled (owner-only; unset or
//     missing = off; code NEVER writes it). Read once per page load under the
//     person's own login after a session exists; the last answer is
//     remembered per browser in mgb_slateplus_cache ("1" or removed), and
//     window event mgb:slateplus fires when it changes.
// In View as nothing here touches the network.
//
// Callers: `TKP_on()` (plain answer now; starts the switch read) or, in a
// component, `const plusOn = TKP_useOn();` (re-renders when the answer
// changes). Staff components only; the client app never calls it.
//
// Browser file (plain JS, no JSX). Uses window.mgbSupabase and React at call
// time only. Node tests: components/tasks/TK_slatePlus.test.js. Template:
// components/inbox/TM_gate.js.
// ----------------------------------------------------------------------------

var TKP_PREVIEW_KEY = "mgb_slateplus_preview";
var TKP_CACHE_KEY = "mgb_slateplus_cache";
var TKP_EVENT = "mgb:slateplus";
var TKP_SWITCH_KEY = "slateplus_enabled";

function TKP__ls(k) {
  try {
    return window.localStorage.getItem(k);
  } catch (e) {
    return null;
  }
}
function TKP__lsSet(k, v) {
  try {
    if (v == null) window.localStorage.removeItem(k);
    else window.localStorage.setItem(k, v);
  } catch (e) {}
}

// Same truthy rule as TM_switchValue / WB_plusSwitchValue.
function TKP_switchValue(v) {
  return v === true || v === "true" || v === 1 || (!!v && typeof v === "object" && v.on === true);
}

// The pure resolver.
function TKP_isOn(viewAsRO, previewOn, switchValue) {
  if (viewAsRO) return false;
  return previewOn === true || TKP_switchValue(switchValue);
}

function TKP_previewOn() {
  return TKP__ls(TKP_PREVIEW_KEY) === "1";
}

function TKP__viewAsRO() {
  try {
    return typeof MGB_viewAsReadOnly === "function" && !!MGB_viewAsReadOnly();
  } catch (e) {
    return false;
  }
}

// One read of tk_settings.slateplus_enabled per page load, after sign-in (no
// sooner than 3s without a session, 30s after an error, never after 3 errors
// in one page load). Read only.
var TKP__switch = { state: "idle", fails: 0, nextAt: 0 }; // state: idle | reading | done
function TKP_readSwitch(force) {
  var c = typeof window !== "undefined" ? window.mgbSupabase : null;
  if (!c || (!force && TKP__switch.state !== "idle")) return;
  if (!force && Date.now() < TKP__switch.nextAt) return;
  TKP__switch.state = "reading";
  // While a TKP_useOn() caller is mounted, a wait or an error schedules the
  // next try (TKP__kick); the 3-error cap still ends it.
  var again = function () {
    if (typeof TKP__store !== "undefined" && TKP__store.subs.length) TKP__kick();
  };
  var wait = function () {
    TKP__switch.state = "idle";
    TKP__switch.nextAt = Date.now() + 3000;
    again();
  };
  var fail = function () {
    TKP__switch.fails += 1;
    TKP__switch.state = TKP__switch.fails >= 3 ? "done" : "idle";
    TKP__switch.nextAt = Date.now() + 30000;
    again();
  };
  try {
    var go = function () {
      c.from("tk_settings")
        .select("value")
        .eq("key", TKP_SWITCH_KEY)
        .maybeSingle()
        .then(function (res) {
          if (!res || res.error) return fail();
          TKP__switch.state = "done";
          var before = TKP__ls(TKP_CACHE_KEY);
          TKP__lsSet(TKP_CACHE_KEY, res.data && TKP_switchValue(res.data.value) ? "1" : null);
          if (TKP__ls(TKP_CACHE_KEY) !== before) {
            try {
              window.dispatchEvent(new Event(TKP_EVENT));
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
function TKP__now() {
  return TKP_isOn(TKP__viewAsRO(), TKP_previewOn(), TKP__ls(TKP_CACHE_KEY) === "1");
}

// The shared check every gated spot uses (non-React callers too: tour, tips,
// announcements). Starts the switch read if needed. View as: false, no network.
function TKP_on() {
  if (TKP__viewAsRO()) return false;
  if (!TKP_previewOn() && TKP__switch.state === "idle") TKP_readSwitch();
  return TKP__now();
}

// ---- One shared subscription for every TKP_useOn() caller ----------------
// Review fix (2026-10-27): every task row calls the hook, so the window
// listeners live here once (added with the first subscriber, removed with the
// last), not two per row. The answer is read from localStorage at most once
// per synchronous render pass (cached until the next microtask, dropped at
// once on a change), so a list of 300 rows costs one read, and a storage
// event that does not change the answer re-renders nothing.
var TKP__store = { subs: [], snap: false, fresh: false, retry: null, onEvent: null, onStorage: null };

function TKP__drop() {
  TKP__store.fresh = false;
}
function TKP__snapshot() {
  var st = TKP__store;
  if (st.fresh) return st.snap;
  st.snap = TKP__now();
  st.fresh = true;
  try {
    Promise.resolve().then(TKP__drop);
  } catch (e) {
    st.fresh = false;
  }
  return st.snap;
}
function TKP__notify() {
  TKP__drop();
  TKP__store.subs.slice().forEach(function (fn) {
    try {
      fn();
    } catch (e) {}
  });
}
// The switch read, started after commit (never during render). A wait (no
// session yet) or an error retries once at its time, only while something
// is subscribed; TKP_readSwitch still caps errors at 3 per page load.
function TKP__kick() {
  var st = TKP__store;
  if (TKP__switch.state !== "idle" || TKP__viewAsRO() || TKP_previewOn()) return;
  var wait = TKP__switch.nextAt - Date.now();
  if (wait <= 0) {
    TKP_readSwitch();
    return;
  }
  if (st.retry || typeof setTimeout !== "function") return;
  st.retry = setTimeout(function () {
    st.retry = null;
    if (st.subs.length) TKP__kick();
  }, wait + 50);
}
function TKP__subscribe(fn) {
  var st = TKP__store;
  if (!st.subs.length && typeof window !== "undefined" && window.addEventListener) {
    st.onEvent = TKP__notify;
    st.onStorage = function (e) {
      if (!e || !e.key || /^mgb_slateplus_/.test(e.key)) TKP__notify();
    };
    window.addEventListener(TKP_EVENT, st.onEvent);
    window.addEventListener("storage", st.onStorage);
  }
  st.subs.push(fn);
  TKP__kick();
  return function () {
    var i = st.subs.indexOf(fn);
    if (i >= 0) st.subs.splice(i, 1);
    if (!st.subs.length && st.onEvent && typeof window !== "undefined" && window.removeEventListener) {
      window.removeEventListener(TKP_EVENT, st.onEvent);
      window.removeEventListener("storage", st.onStorage);
      st.onEvent = st.onStorage = null;
    }
  };
}

// The hook: `const plusOn = TKP_useOn();` Re-renders on mgb:slateplus (the
// switch answer changed) and on a storage change to an mgb_slateplus_* key
// from another tab, only when the answer actually changes. React 18's
// useSyncExternalStore when present; otherwise one state + effect per caller
// subscribed to the same shared store (still no per-row window listeners).
function TKP_useOn() {
  if (typeof React.useSyncExternalStore === "function") {
    return React.useSyncExternalStore(TKP__subscribe, TKP__snapshot, TKP__snapshot);
  }
  var s = React.useState(0);
  var bump = s[1];
  React.useEffect(function () {
    var last = TKP__snapshot();
    return TKP__subscribe(function () {
      var now = TKP__snapshot();
      if (now === last) return;
      last = now;
      bump(function (n) {
        return n + 1;
      });
    });
  }, []);
  return TKP__snapshot();
}

// The tag shown next to a project: "Onboarding" for a project of kind
// onboarding, else null. A project tied to a client made from the Slate plus
// New project form is also saved as kind onboarding (database rule), so with
// the gate on (on === true) one whose name does not contain "onboarding"
// (any case) reads "Client" instead. Gate off: always the old answer.
function TKP_projectTag(p, on) {
  if (!p || p.kind !== "onboarding") return null;
  if (on === true && !/onboarding/i.test(String(p.name == null ? "" : p.name))) return "Client";
  return "Onboarding";
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    TKP_projectTag: TKP_projectTag,
    TKP_on: TKP_on,
    TKP_useOn: TKP_useOn,
    TKP_isOn: TKP_isOn,
    TKP_switchValue: TKP_switchValue,
    TKP_previewOn: TKP_previewOn,
    TKP_readSwitch: TKP_readSwitch,
    TKP__subscribe: TKP__subscribe,
    TKP__snapshot: TKP__snapshot,
    TKP_PREVIEW_KEY: TKP_PREVIEW_KEY,
    TKP_CACHE_KEY: TKP_CACHE_KEY,
    TKP_EVENT: TKP_EVENT,
    TKP_SWITCH_KEY: TKP_SWITCH_KEY,
  };
}
