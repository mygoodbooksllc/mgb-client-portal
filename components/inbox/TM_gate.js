// ----------------------------------------------------------------------------
// TM_gate: the one gate for the client message thread menu
// (docs/thread-menu-spec.md section 6): right-click or the "⋯" button on a
// client thread on the Messages page, the client's Messages tab and the Desk
// Inbox (Rename, Pin, Mark done, Snooze, Reassign, Create task, Copy link,
// Hide / Restore).
//
// ONE resolver, TM_isOn(viewAsRO, previewOn, switchValue), true only when:
//   - the person is not in View as (read-only staff preview), AND
//   - a person's own preview: localStorage mgb_threadmenu_preview === "1"
//     (Developer tools > Feature flags, "Thread menu preview"), OR
//   - the firm switch tk_settings.threadmenu_enabled (owner-only; unset or
//     missing = off; code NEVER writes it). Read once per page load under the
//     person's own login after a session exists; the last answer is
//     remembered per browser in mgb_threadmenu_cache ("1" or removed), and
//     window event mgb:threadmenu fires when it changes.
// In View as nothing here touches the network.
//
// Components call the hook: `const tmOn = TM_useThreadMenu();`
// Only staff components (StaffInbox, WB_Row) call it; the client app never
// does. Feature flags rows reload the page when toggled (reloads: true);
// another tab's toggle arrives as a storage event, which the hook also hears.
//
// Browser file (plain JS, no JSX); loads before StaffInbox.jsx. Uses
// window.mgbSupabase and React at call time only. Node tests:
// components/inbox/TM_gate.test.js. Template: components/workbench/WB_plus.js.
// ----------------------------------------------------------------------------

var TM_PREVIEW_KEY = "mgb_threadmenu_preview";
var TM_CACHE_KEY = "mgb_threadmenu_cache";
var TM_EVENT = "mgb:threadmenu";
var TM_SWITCH_KEY = "threadmenu_enabled";

function TM__ls(k) {
  try {
    return window.localStorage.getItem(k);
  } catch (e) {
    return null;
  }
}
function TM__lsSet(k, v) {
  try {
    if (v == null) window.localStorage.removeItem(k);
    else window.localStorage.setItem(k, v);
  } catch (e) {}
}

// Same truthy rule as WB_plusSwitchValue / OP__switchValue.
function TM_switchValue(v) {
  return v === true || v === "true" || v === 1 || (!!v && typeof v === "object" && v.on === true);
}

// The pure resolver.
function TM_isOn(viewAsRO, previewOn, switchValue) {
  if (viewAsRO) return false;
  return previewOn === true || TM_switchValue(switchValue);
}

function TM_previewOn() {
  return TM__ls(TM_PREVIEW_KEY) === "1";
}

function TM__viewAsRO() {
  try {
    return typeof MGB_viewAsReadOnly === "function" && !!MGB_viewAsReadOnly();
  } catch (e) {
    return false;
  }
}

// One read of tk_settings.threadmenu_enabled per page load, after sign-in
// (same retry rules as WB_plusReadSwitch: no sooner than 3s without a
// session, 30s after an error, never after 3 errors in one page load). Read
// only.
var TM__switch = { state: "idle", fails: 0, nextAt: 0 }; // state: idle | reading | done
function TM_readSwitch(force) {
  var c = typeof window !== "undefined" ? window.mgbSupabase : null;
  if (!c || (!force && TM__switch.state !== "idle")) return;
  if (!force && Date.now() < TM__switch.nextAt) return;
  TM__switch.state = "reading";
  var wait = function () {
    TM__switch.state = "idle";
    TM__switch.nextAt = Date.now() + 3000;
  };
  var fail = function () {
    TM__switch.fails += 1;
    TM__switch.state = TM__switch.fails >= 3 ? "done" : "idle";
    TM__switch.nextAt = Date.now() + 30000;
  };
  try {
    var go = function () {
      c.from("tk_settings")
        .select("value")
        .eq("key", TM_SWITCH_KEY)
        .maybeSingle()
        .then(function (res) {
          if (!res || res.error) return fail();
          TM__switch.state = "done";
          var before = TM__ls(TM_CACHE_KEY);
          TM__lsSet(TM_CACHE_KEY, res.data && TM_switchValue(res.data.value) ? "1" : null);
          if (TM__ls(TM_CACHE_KEY) !== before) {
            try {
              window.dispatchEvent(new Event(TM_EVENT));
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
function TM__now() {
  return TM_isOn(TM__viewAsRO(), TM_previewOn(), TM__ls(TM_CACHE_KEY) === "1");
}

// For non-React callers (tour, tips, announcements): the answer now, starting
// the switch read if needed. View as: false, and no network call.
function TM_threadMenuOn() {
  if (TM__viewAsRO()) return false;
  if (!TM_previewOn() && TM__switch.state === "idle") TM_readSwitch();
  return TM__now();
}

// The hook every gated spot uses: `const tmOn = TM_useThreadMenu();`
// Re-renders on mgb:threadmenu (the switch answer changed) and on a storage
// change to an mgb_threadmenu_* key from another tab.
function TM_useThreadMenu() {
  var s = React.useState(0);
  var bump = s[1];
  React.useEffect(function () {
    var hit = function () {
      bump(function (n) {
        return n + 1;
      });
    };
    var onStorage = function (e) {
      if (!e || !e.key || /^mgb_threadmenu_/.test(e.key)) hit();
    };
    window.addEventListener(TM_EVENT, hit);
    window.addEventListener("storage", onStorage);
    return function () {
      window.removeEventListener(TM_EVENT, hit);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  // The read runs after render, never during it; only while the preview is
  // off and not in View as. Idle again after a failure, so a later render
  // tries once more.
  React.useEffect(function () {
    if (!TM__viewAsRO() && !TM_previewOn() && TM__switch.state === "idle") TM_readSwitch();
  });
  return TM__now();
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    TM_isOn: TM_isOn,
    TM_switchValue: TM_switchValue,
    TM_previewOn: TM_previewOn,
    TM_readSwitch: TM_readSwitch,
    TM_threadMenuOn: TM_threadMenuOn,
    TM_PREVIEW_KEY: TM_PREVIEW_KEY,
    TM_CACHE_KEY: TM_CACHE_KEY,
    TM_EVENT: TM_EVENT,
    TM_SWITCH_KEY: TM_SWITCH_KEY,
  };
}
