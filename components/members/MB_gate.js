// ----------------------------------------------------------------------------
// MB_gate: the one gate for the Members area tab (HR > Members area), a hidden
// staff tab for people who help members (customers of the course, the Launch
// Kit and the client library).
//
// Two ways in, and both are needed for the tab to show:
//   1. It is switched on for this person or the firm:
//        - a person's own preview: localStorage mgb_members_preview === "1"
//          (Developer tools > Feature flags, "Members area preview"), OR
//        - the firm switch tk_settings.members_staff_enabled (owner-only;
//          unset or missing = off; code NEVER writes it). Read once per page
//          load under the person's own login after a session exists; the last
//          answer is remembered per browser in mgb_members_cache ("1" or
//          removed), and window event mgb:members fires when it changes.
//   2. The database says this person may list members: rpc members_staff_me
//      returns { switch_on, is_owner, can_list, can_open }, and can_list must
//      be true.
// show = (preview OR switch) AND me.can_list === true.
//
// With the preview off and the switch off (or missing) nothing here touches
// the network beyond the single tk_settings read. members_staff_me is only
// called once the preview or the switch is on.
//
// MB_tabVisible(ctx) is the sync check the nav uses. It is false during
// "View as" and impersonation (ctx.impersonating), and never starts more than
// the reads above.
//
// Browser file (plain JS, no JSX); modeled on components/workbench/WB_plus.js.
// Uses window.mgbSupabase and React at call time only. Node tests:
// components/members/MB_gate.test.js.
// ----------------------------------------------------------------------------

var MB_PREVIEW_KEY = "mgb_members_preview";
var MB_CACHE_KEY = "mgb_members_cache";
var MB_EVENT = "mgb:members";

function MB__ls(k) {
  try {
    return window.localStorage.getItem(k);
  } catch (e) {
    return null;
  }
}
function MB__lsSet(k, v) {
  try {
    if (v == null) window.localStorage.removeItem(k);
    else window.localStorage.setItem(k, v);
  } catch (e) {}
}
function MB__fire() {
  try {
    window.dispatchEvent(new Event(MB_EVENT));
  } catch (e) {}
}

// Same truthy rule as WB_plusSwitchValue.
function MB_switchValue(v) {
  return v === true || v === "true" || v === 1 || (!!v && typeof v === "object" && v.on === true);
}

// The pure resolver.
function MB_isShown(previewOn, switchOn, me) {
  if (previewOn !== true && switchOn !== true) return false;
  return !!me && me.can_list === true;
}

function MB_previewOn() {
  return MB__ls(MB_PREVIEW_KEY) === "1";
}

// One read of tk_settings.members_staff_enabled per page load, after sign-in.
// Same retry rules as WB_plus: no sooner than 3s without a session, 30s after
// an error, never after 3 errors in one page load. Read only.
var MB__switch = { state: "idle", fails: 0, nextAt: 0 };
function MB_readSwitch(force) {
  var c = typeof window !== "undefined" ? window.mgbSupabase : null;
  if (!c || (!force && MB__switch.state !== "idle")) return;
  if (!force && Date.now() < MB__switch.nextAt) return;
  MB__switch.state = "reading";
  var wait = function () {
    MB__switch.state = "idle";
    MB__switch.nextAt = Date.now() + 3000;
  };
  var fail = function () {
    MB__switch.fails += 1;
    MB__switch.state = MB__switch.fails >= 3 ? "done" : "idle";
    MB__switch.nextAt = Date.now() + 30000;
  };
  try {
    var go = function () {
      c.from("tk_settings")
        .select("value")
        .eq("key", "members_staff_enabled")
        .maybeSingle()
        .then(function (res) {
          if (!res || res.error) return fail();
          MB__switch.state = "done";
          var before = MB__ls(MB_CACHE_KEY);
          MB__lsSet(MB_CACHE_KEY, res.data && MB_switchValue(res.data.value) ? "1" : null);
          if (MB__ls(MB_CACHE_KEY) !== before) MB__fire();
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

// members_staff_me, once per page load once the preview or the switch is on.
// Same retry rules. The answer is kept in memory only.
var MB__me = { state: "idle", fails: 0, nextAt: 0, data: null };
function MB_readMe(force) {
  var c = typeof window !== "undefined" ? window.mgbSupabase : null;
  if (!c || (!force && MB__me.state !== "idle")) return;
  if (!force && Date.now() < MB__me.nextAt) return;
  MB__me.state = "reading";
  var wait = function () {
    MB__me.state = "idle";
    MB__me.nextAt = Date.now() + 3000;
  };
  var fail = function () {
    MB__me.fails += 1;
    if (MB__me.fails >= 3) {
      MB__me.state = "done";
      MB__me.data = { switch_on: false, is_owner: false, can_list: false, can_open: false };
      MB__fire();
    } else {
      MB__me.state = "idle";
    }
    MB__me.nextAt = Date.now() + 30000;
  };
  try {
    var go = function () {
      Promise.resolve(c.rpc("members_staff_me")).then(function (res) {
        if (!res || res.error || !res.data || typeof res.data !== "object") return fail();
        MB__me.state = "done";
        MB__me.data = {
          switch_on: res.data.switch_on === true,
          is_owner: res.data.is_owner === true,
          can_list: res.data.can_list === true,
          can_open: res.data.can_open === true,
        };
        MB__fire();
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

// Last answer the hook or the nav worked out; read by non-React callers.
var MB__lastShow = false;

// The answer right now, from this browser and memory only (no network).
function MB__now() {
  var pre = MB_previewOn();
  var sw = MB__ls(MB_CACHE_KEY) === "1" || (!!MB__me.data && MB__me.data.switch_on === true);
  var me = MB__me.data;
  MB__lastShow = MB_isShown(pre, sw, me);
  return { preview: pre, switchOn: sw, me: me, show: MB__lastShow };
}

// Starts whatever read is missing. Preview and switch both off: only the
// tk_settings read, and that only when the preview is off.
function MB__kick() {
  var pre = MB_previewOn();
  if (!pre && MB__switch.state === "idle") MB_readSwitch();
  var sw = MB__ls(MB_CACHE_KEY) === "1";
  if ((pre || sw) && MB__me.state === "idle") MB_readMe();
}

// For the nav (sync). False during "View as" and impersonation.
function MB_tabVisible(ctx) {
  if (ctx && (ctx.impersonating || ctx.viewAs)) return false;
  MB__kick();
  return MB__now().show;
}

// The hook: { ready, show, me }. ready is true once there is nothing left to
// wait for (switched off, or members_staff_me has answered).
function MB_useGate() {
  var s = React.useState(0);
  var bump = s[1];
  React.useEffect(function () {
    var hit = function () {
      bump(function (n) {
        return n + 1;
      });
    };
    var onStorage = function (e) {
      if (!e || !e.key || /^mgb_members_/.test(e.key)) hit();
    };
    window.addEventListener(MB_EVENT, hit);
    window.addEventListener("storage", onStorage);
    return function () {
      window.removeEventListener(MB_EVENT, hit);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  // Reads run after render, never during it. Idle again after a failure, so a
  // later render tries once more.
  React.useEffect(function () {
    MB__kick();
  });
  var now = MB__now();
  var wanted = now.preview || now.switchOn;
  return { ready: !wanted || MB__me.state === "done", show: now.show, me: now.me };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    MB_isShown: MB_isShown,
    MB_switchValue: MB_switchValue,
    MB_previewOn: MB_previewOn,
    MB_tabVisible: MB_tabVisible,
    MB_readSwitch: MB_readSwitch,
    MB_readMe: MB_readMe,
    MB_PREVIEW_KEY: MB_PREVIEW_KEY,
    MB_CACHE_KEY: MB_CACHE_KEY,
    MB_EVENT: MB_EVENT,
  };
}
