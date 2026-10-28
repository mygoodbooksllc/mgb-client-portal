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
  var wait = function () {
    TKP__switch.state = "idle";
    TKP__switch.nextAt = Date.now() + 3000;
  };
  var fail = function () {
    TKP__switch.fails += 1;
    TKP__switch.state = TKP__switch.fails >= 3 ? "done" : "idle";
    TKP__switch.nextAt = Date.now() + 30000;
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

// The hook: `const plusOn = TKP_useOn();` Re-renders on mgb:slateplus (the
// switch answer changed) and on a storage change to an mgb_slateplus_* key
// from another tab. The read runs after render, never during it.
function TKP_useOn() {
  var s = React.useState(0);
  var bump = s[1];
  React.useEffect(function () {
    var hit = function () {
      bump(function (n) {
        return n + 1;
      });
    };
    var onStorage = function (e) {
      if (!e || !e.key || /^mgb_slateplus_/.test(e.key)) hit();
    };
    window.addEventListener(TKP_EVENT, hit);
    window.addEventListener("storage", onStorage);
    return function () {
      window.removeEventListener(TKP_EVENT, hit);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  React.useEffect(function () {
    if (!TKP__viewAsRO() && !TKP_previewOn() && TKP__switch.state === "idle") TKP_readSwitch();
  });
  return TKP__now();
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    TKP_on: TKP_on,
    TKP_useOn: TKP_useOn,
    TKP_isOn: TKP_isOn,
    TKP_switchValue: TKP_switchValue,
    TKP_previewOn: TKP_previewOn,
    TKP_readSwitch: TKP_readSwitch,
    TKP_PREVIEW_KEY: TKP_PREVIEW_KEY,
    TKP_CACHE_KEY: TKP_CACHE_KEY,
    TKP_EVENT: TKP_EVENT,
    TKP_SWITCH_KEY: TKP_SWITCH_KEY,
  };
}
