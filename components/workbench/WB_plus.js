// ----------------------------------------------------------------------------
// WB_plus: the one gate for the Desk additions ("Desk+", docs/workbench-hub-spec.md
// section 3, slices S1-S4): the Ledger chip in the Desk Inbox; Waiting on
// client, recent messages and recent files on the Desk Client tab; its Ask
// client and Message buttons; and Ask client..., Message... and Time off in
// the + menu.
//
// The Desk's own switch (wb_enabled) is already on for every staff member, so
// these ride a gate of their own. ONE resolver, WB_plusIsOn(deskOn, previewOn,
// switchValue), true only when:
//   - the Desk is on for this page (deskOn: WB_useDeskLive(..., true) in
//     app.jsx, or "inside the Desk" for its Hub; off during Classic Today,
//     View as, a plan preview and impersonation), AND
//   - a person's own preview: localStorage mgb_deskplus_preview === "1"
//     (Developer tools > Feature flags, "Desk additions preview"), OR
//   - the firm switch tk_settings.deskplus_enabled (owner-only; unset or
//     missing = off; code NEVER writes it). Read once per page load under the
//     person's own login after a session exists; the last answer is
//     remembered per browser in mgb_deskplus_cache ("1" or removed), and
//     window event mgb:deskplus fires when it changes.
// With the Desk off nothing here touches the network.
//
// Components call the hook: `const plusOn = WB_useDeskPlus(deskOn);`
// Feature flags rows reload the page when toggled (reloads: true); another
// tab's toggle arrives as a storage event, which the hook also hears.
//
// Browser file (plain JS, no JSX); loads after WB_store.js. Uses
// window.mgbSupabase and React at call time only. Node tests:
// components/workbench/WB_plus.test.js.
// ----------------------------------------------------------------------------

var WB_PLUS_PREVIEW_KEY = "mgb_deskplus_preview";
var WB_PLUS_CACHE_KEY = "mgb_deskplus_cache";
var WB_PLUS_EVENT = "mgb:deskplus";

function WB__plusLs(k) {
  try {
    return window.localStorage.getItem(k);
  } catch (e) {
    return null;
  }
}
function WB__plusLsSet(k, v) {
  try {
    if (v == null) window.localStorage.removeItem(k);
    else window.localStorage.setItem(k, v);
  } catch (e) {}
}

// Same truthy rule as OP__switchValue (components/client/OP_store.js).
function WB_plusSwitchValue(v) {
  return v === true || v === "true" || v === 1 || (!!v && typeof v === "object" && v.on === true);
}

// The pure resolver.
function WB_plusIsOn(deskOn, previewOn, switchValue) {
  if (deskOn !== true) return false;
  return previewOn === true || WB_plusSwitchValue(switchValue);
}

function WB_plusPreviewOn() {
  return WB__plusLs(WB_PLUS_PREVIEW_KEY) === "1";
}

// One read of tk_settings.deskplus_enabled per page load, after sign-in (a
// read before sign-in sees nothing, so it waits for a session; a failed or
// early read goes back to idle and is tried again next time). Read only.
var WB__plusSwitch = { state: "idle" }; // idle | reading | done
function WB_plusReadSwitch(force) {
  var c = typeof window !== "undefined" ? window.mgbSupabase : null;
  if (!c || (!force && WB__plusSwitch.state !== "idle")) return;
  WB__plusSwitch.state = "reading";
  var fail = function () {
    WB__plusSwitch.state = "idle";
  };
  try {
    var go = function () {
      c.from("tk_settings")
        .select("value")
        .eq("key", "deskplus_enabled")
        .maybeSingle()
        .then(function (res) {
          if (!res || res.error) return fail();
          WB__plusSwitch.state = "done";
          var before = WB__plusLs(WB_PLUS_CACHE_KEY);
          WB__plusLsSet(WB_PLUS_CACHE_KEY, res.data && WB_plusSwitchValue(res.data.value) ? "1" : null);
          if (WB__plusLs(WB_PLUS_CACHE_KEY) !== before) {
            try {
              window.dispatchEvent(new Event(WB_PLUS_EVENT));
            } catch (e) {}
          }
        }, fail);
    };
    if (c.auth && typeof c.auth.getSession === "function") {
      c.auth.getSession().then(function (r) {
        if (r && r.data && r.data.session) go();
        else fail();
      }, fail);
    } else go();
  } catch (e) {
    fail();
  }
}

// The answer right now, from this browser only (no network).
function WB__plusNow(deskOn) {
  if (deskOn !== true) return false;
  return WB_plusIsOn(true, WB_plusPreviewOn(), WB__plusLs(WB_PLUS_CACHE_KEY) === "1");
}

// For non-React callers: the answer now, starting the switch read if needed.
// Desk off: false, and no network call.
function WB_plusOn(deskOn) {
  if (deskOn !== true) return false;
  if (!WB_plusPreviewOn() && WB__plusSwitch.state === "idle") WB_plusReadSwitch();
  return WB__plusNow(true);
}

// The hook every gated spot uses: `const plusOn = WB_useDeskPlus(deskOn);`
// Re-renders on mgb:deskplus (the switch answer changed) and on a storage
// change to an mgb_deskplus_* key from another tab. Desk off: false, no
// listeners and no network call.
function WB_useDeskPlus(deskOn) {
  var on = deskOn === true;
  var s = React.useState(0);
  var bump = s[1];
  React.useEffect(
    function () {
      if (!on) return undefined;
      var hit = function () {
        bump(function (n) {
          return n + 1;
        });
      };
      var onStorage = function (e) {
        if (!e || !e.key || /^mgb_deskplus_/.test(e.key)) hit();
      };
      window.addEventListener(WB_PLUS_EVENT, hit);
      window.addEventListener("storage", onStorage);
      return function () {
        window.removeEventListener(WB_PLUS_EVENT, hit);
        window.removeEventListener("storage", onStorage);
      };
    },
    [on],
  );
  // The read runs after render, never during it; only while the Desk is on
  // and the preview is off. Idle again after a failure, so a later render
  // tries once more.
  React.useEffect(function () {
    if (on && !WB_plusPreviewOn() && WB__plusSwitch.state === "idle") WB_plusReadSwitch();
  });
  return WB__plusNow(on);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    WB_plusIsOn: WB_plusIsOn,
    WB_plusSwitchValue: WB_plusSwitchValue,
    WB_plusPreviewOn: WB_plusPreviewOn,
    WB_plusReadSwitch: WB_plusReadSwitch,
    WB_plusOn: WB_plusOn,
    WB_PLUS_PREVIEW_KEY: WB_PLUS_PREVIEW_KEY,
    WB_PLUS_CACHE_KEY: WB_PLUS_CACHE_KEY,
    WB_PLUS_EVENT: WB_PLUS_EVENT,
  };
}
