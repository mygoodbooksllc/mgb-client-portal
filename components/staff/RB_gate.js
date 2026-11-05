// ----------------------------------------------------------------------------
// RB_gate: the ONE gate for the Review board, the Deadline digest in the bell
// and the email draft extras (docs/review-board-spec.md section 1). Hidden
// until the owner launches it.
//
// RB_on() is true only when ALL of these hold:
//   - the viewer is a real admin (STAFF_isRealAdmin: role "admin"; temp
//     admins never pass). App tells us with RB_setViewer(isRealAdmin &&
//     !impersonating) during its render; the default is false;
//   - not in View as (window.mgbViewAs.on), checked again here;
//   - a person's own preview: localStorage mgb_reviewboard_preview === "1"
//     (Developer tools > Feature flags, "Review board (preview)"), OR
//   - the firm switch tk_settings.reviewboard_enabled (owner-only; missing or
//     off = off; code NEVER writes it). Read once per page load, and only for
//     a real admin, remembered per browser in mgb_reviewboard_cache ("1" or
//     removed); window event mgb:reviewboard fires when it changes.
// Because every piece is admin-only, the admin check lives inside RB_on(), so
// no caller can forget it. A stale cache "1" in a browser later used by a
// bookkeeper is harmless: the admin check runs first.
//
// Off: no reads, no listeners, and every gated spot draws exactly what it drew
// before. Not a real admin: not even the switch read happens.
//
// Browser file (plain JS, no JSX); loads before StaffNav.jsx. Uses
// window.mgbSupabase and React at call time only. Node tests:
// components/staff/RB_gate.test.js.
// ----------------------------------------------------------------------------

var RB_PREVIEW_KEY = "mgb_reviewboard_preview";
var RB_CACHE_KEY = "mgb_reviewboard_cache"; // "1" or removed
var RB_EVENT = "mgb:reviewboard"; // the gate's answer changed
var RB_SWITCH = "reviewboard_enabled";
var RB__viewer = { realAdmin: false, read: false };

function RB__ls(k) {
  try {
    return window.localStorage.getItem(k);
  } catch (e) {
    return null;
  }
}
function RB__lsSet(k, v) {
  try {
    if (v == null) window.localStorage.removeItem(k);
    else window.localStorage.setItem(k, v);
  } catch (e) {}
}
function RB__fire(name) {
  try {
    window.dispatchEvent(new CustomEvent(name, { detail: {} }));
  } catch (e) {}
}

// Same truthy rule as WB_peekSwitchValue: the owner may save true, "true", 1
// or { on: true }. Anything else is off.
function RB_switchValue(v) {
  return v === true || v === "true" || v === 1 || (!!v && typeof v === "object" && v.on === true);
}

// The pure resolver for the preview/switch half (the admin and View as halves
// are checked in RB_on).
function RB_isOn(previewOn, switchValue) {
  return previewOn === true || switchValue === true;
}

function RB_viewingAs() {
  try {
    return !!(typeof window !== "undefined" && window.mgbViewAs && window.mgbViewAs.on);
  } catch (e) {
    return false;
  }
}

// App calls this in render. Plain assignment: no event, no read, so it is safe
// during render. App passes STAFF_isRealAdmin(staffUser) && !impersonating.
function RB_setViewer(isRealAdmin) {
  RB__viewer.realAdmin = isRealAdmin === true;
}

// One read of tk_settings.reviewboard_enabled per page load, after sign-in,
// and only for a real admin (the WB_peek.js state machine: idle | reading |
// done; no session: retry after 3s; an error: after 30s; never after 3
// errors). Read only.
var RB__switch = { state: "idle", fails: 0, nextAt: 0 };
function RB_switchRead(force) {
  if (!RB__viewer.realAdmin) return;
  var c = typeof window !== "undefined" ? window.mgbSupabase : null;
  if (!c || (!force && RB__switch.state !== "idle")) return;
  if (!force && Date.now() < RB__switch.nextAt) return;
  RB__switch.state = "reading";
  var wait = function () {
    RB__switch.state = "idle";
    RB__switch.nextAt = Date.now() + 3000;
  };
  var fail = function () {
    RB__switch.fails += 1;
    RB__switch.state = RB__switch.fails >= 3 ? "done" : "idle";
    RB__switch.nextAt = Date.now() + 30000;
  };
  try {
    var go = function () {
      c.from("tk_settings")
        .select("value")
        .eq("key", RB_SWITCH)
        .maybeSingle()
        .then(function (res) {
          if (!res || res.error) return fail();
          RB__switch.state = "done";
          RB__viewer.read = true;
          var before = RB__ls(RB_CACHE_KEY);
          RB__lsSet(RB_CACHE_KEY, res.data && RB_switchValue(res.data.value) ? "1" : null);
          if (RB__ls(RB_CACHE_KEY) !== before) RB__fire(RB_EVENT);
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

// The answer now, for any caller (render, effects, non-React code).
function RB_on() {
  if (!RB__viewer.realAdmin) return false;
  if (RB_viewingAs()) return false;
  return RB_isOn(RB__ls(RB_PREVIEW_KEY) === "1", RB__ls(RB_CACHE_KEY) === "1");
}

// True only when the FIRM-WIDE switch (cached) is on, for a real admin. The
// launch tour and tip use this, never the per-person preview: held drafts stay
// hidden until the owner flips the switch.
function RB_firmOn() {
  return !!RB__viewer.realAdmin && !RB_viewingAs() && RB__ls(RB_CACHE_KEY) === "1";
}

// The hook every gated React spot uses. Not a real admin: false, no listeners,
// no network.
function RB_useOn() {
  var admin = !!RB__viewer.realAdmin;
  var s = React.useState(0);
  var bump = s[1];
  React.useEffect(
    function () {
      if (!admin) return undefined;
      var hit = function () {
        bump(function (n) {
          return n + 1;
        });
      };
      var onStorage = function (e) {
        if (!e || !e.key || e.key === RB_PREVIEW_KEY || e.key === RB_CACHE_KEY) hit();
      };
      window.addEventListener(RB_EVENT, hit);
      window.addEventListener("storage", onStorage);
      return function () {
        window.removeEventListener(RB_EVENT, hit);
        window.removeEventListener("storage", onStorage);
      };
    },
    [admin],
  );
  return RB_on();
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    RB_PREVIEW_KEY: RB_PREVIEW_KEY,
    RB_CACHE_KEY: RB_CACHE_KEY,
    RB_EVENT: RB_EVENT,
    RB_SWITCH: RB_SWITCH,
    RB__viewer: RB__viewer,
    RB__switch: RB__switch,
    RB_switchValue: RB_switchValue,
    RB_isOn: RB_isOn,
    RB_viewingAs: RB_viewingAs,
    RB_setViewer: RB_setViewer,
    RB_switchRead: RB_switchRead,
    RB_on: RB_on,
    RB_firmOn: RB_firmOn,
    RB_useOn: RB_useOn,
  };
}
