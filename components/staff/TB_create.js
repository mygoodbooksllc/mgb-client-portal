// ----------------------------------------------------------------------------
// TB_create: the one gate for the "+ Create" menu (hidden preview). It replaces
// the top bar's small icon-only "+" quick-add (TB_QuickAdd in TopBar.jsx, and
// its Desk-rail variant) with a labeled "+ Create" pill and a roomier menu.
//
// ONE resolver, CM_createIsOn(previewOn, switchValue), true when:
//   - the person's own preview is ticked: localStorage mgb_create_preview === "1"
//     (Developer tools > Feature flags, "Create menu preview"), OR
//   - the firm switch tk_settings.create_menu_enabled is true (unset or missing
//     = off; code NEVER writes it). Read once per page load under the person's
//     own login after a session exists; the last answer is remembered per
//     browser in mgb_create_cache ("1" or removed); window event mgb:create
//     fires when it changes.
// No Classic opt-out yet. Off = the old "+" menu, untouched.
//
// Components call the hook: `const createOn = CM_useCreateMenu();`
// Feature flag rows reload the page when toggled (reloads: true); another
// tab's toggle arrives as a storage event, which the hook also hears.
//
// CM_createItems(opts) is the pure menu builder (node-tested): which rows the
// menu shows for a client page or off one, and for admins.
//
// Browser file (plain JS, no JSX); loads before TopBar.jsx. Uses
// window.mgbSupabase and React at call time only. Node test: TB_create.test.js.
// ----------------------------------------------------------------------------

var CM_PREVIEW_KEY = "mgb_create_preview";
var CM_CACHE_KEY = "mgb_create_cache";
var CM_EVENT = "mgb:create";

function CM__ls(k) {
  try {
    return window.localStorage.getItem(k);
  } catch (e) {
    return null;
  }
}
function CM__lsSet(k, v) {
  try {
    if (v == null) window.localStorage.removeItem(k);
    else window.localStorage.setItem(k, v);
  } catch (e) {}
}

// Same truthy rule as WB_plusSwitchValue / OP__switchValue.
function CM_switchValue(v) {
  return v === true || v === "true" || v === 1 || (!!v && typeof v === "object" && v.on === true);
}

// The pure resolver.
function CM_createIsOn(previewOn, switchValue) {
  return previewOn === true || CM_switchValue(switchValue);
}

function CM_previewOn() {
  return CM__ls(CM_PREVIEW_KEY) === "1";
}

// One read of tk_settings.create_menu_enabled per page load, after sign-in
// (same retry rules as WB_plusReadSwitch: not sooner than 3s without a
// session, 30s after an error, never after 3 errors in one page load).
var CM__switch = { state: "idle", fails: 0, nextAt: 0 };
function CM_readSwitch(force) {
  var c = typeof window !== "undefined" ? window.mgbSupabase : null;
  if (!c || (!force && CM__switch.state !== "idle")) return;
  if (!force && Date.now() < CM__switch.nextAt) return;
  CM__switch.state = "reading";
  var wait = function () {
    CM__switch.state = "idle";
    CM__switch.nextAt = Date.now() + 3000;
  };
  var fail = function () {
    CM__switch.fails += 1;
    CM__switch.state = CM__switch.fails >= 3 ? "done" : "idle";
    CM__switch.nextAt = Date.now() + 30000;
  };
  try {
    var go = function () {
      c.from("tk_settings")
        .select("value")
        .eq("key", "create_menu_enabled")
        .maybeSingle()
        .then(function (res) {
          if (!res || res.error) return fail();
          CM__switch.state = "done";
          var before = CM__ls(CM_CACHE_KEY);
          CM__lsSet(CM_CACHE_KEY, res.data && CM_switchValue(res.data.value) ? "1" : null);
          if (CM__ls(CM_CACHE_KEY) !== before) {
            try {
              window.dispatchEvent(new Event(CM_EVENT));
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
function CM__now() {
  return CM_createIsOn(CM_previewOn(), CM__ls(CM_CACHE_KEY) === "1");
}

// For non-React callers (tour text): the answer now, starting the switch
// read if needed. No network call when the preview is ticked.
function CM_createOn() {
  if (!CM_previewOn() && CM__switch.state === "idle") CM_readSwitch();
  return CM__now();
}

// The hook every gated spot uses. Re-renders on mgb:create (the switch answer
// changed) and on a storage change to an mgb_create_* key from another tab.
function CM_useCreateMenu() {
  var s = React.useState(0);
  var bump = s[1];
  React.useEffect(function () {
    var hit = function () {
      bump(function (n) {
        return n + 1;
      });
    };
    var onStorage = function (e) {
      if (!e || !e.key || /^mgb_create_/.test(e.key)) hit();
    };
    window.addEventListener(CM_EVENT, hit);
    window.addEventListener("storage", onStorage);
    return function () {
      window.removeEventListener(CM_EVENT, hit);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  // The read runs after render, never during it; only while the preview is
  // off (a ticked preview needs no switch).
  React.useEffect(function () {
    if (!CM_previewOn() && CM__switch.state === "idle") CM_readSwitch();
  });
  return CM__now();
}

// ---- The menu rows (pure) ----
// opts: {
//   client      the open client ({id, name}) or null
//   isAdmin     staffUser.role === "admin"
//   tk          Tasks quick add is mounted
//   deskPlus    the Desk additions gate is on (Ask client, chat-drawer Message)
//   timeOff     the existing time-off flow can be opened (WB_QuickHost + CV_MyTimeOffBody)
// }
// Returns [{ key, label, kind, icon, kbd?, sep? }] where a row with sep:true
// is a separator before the next group. kind says what the click runs:
//   "task" | "note" | "request" | "message" | "ask" | "timeoff"  (menu flows)
//   "go:<hash>"                                                  (navigation)
function CM_createItems(opts) {
  var o = opts || {};
  var client = o.client && o.client.id != null ? o.client : null;
  var items = [];
  if (client || o.tk) items.push({ key: "task", label: "Task", kind: "task", icon: "task", kbd: "q" });
  if (client) {
    items.push({ key: "note", label: "Note", kind: "note", icon: "note" });
    items.push({ key: "request", label: "Request a document", kind: "request", icon: "doc" });
    items.push({ key: "message", label: "Message", kind: "message", icon: "message" });
  } else if (o.deskPlus) {
    // Off a client page Message opens the chat drawer's own list.
    items.push({ key: "message", label: "Message a client", kind: "message", icon: "message" });
  }
  if (o.deskPlus) items.push({ key: "ask", label: "Ask client…", kind: "ask", icon: "ask" });
  if (o.timeOff) items.push({ key: "timeoff", label: "Request time off", kind: "timeoff", icon: "clock" });
  var admin = [];
  if (o.isAdmin) {
    if (client) admin.push({ key: "invite-login", label: "Invite a client login", kind: "go:#/client-access", icon: "key" });
    admin.push({ key: "add-client", label: "Add a client", kind: "go:#/client-access", icon: "building" });
    admin.push({ key: "team-review", label: "Start a team review", kind: "go:#/hr/reviews", icon: "review" });
    admin.push({ key: "invite-staff", label: "Invite staff", kind: "go:#/hr/members", icon: "person" });
  }
  if (admin.length) {
    if (items.length) items.push({ key: "sep-admin", sep: true });
    items = items.concat(admin);
  }
  return items;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    CM_createIsOn: CM_createIsOn,
    CM_switchValue: CM_switchValue,
    CM_previewOn: CM_previewOn,
    CM_createOn: CM_createOn,
    CM_readSwitch: CM_readSwitch,
    CM_createItems: CM_createItems,
    CM_PREVIEW_KEY: CM_PREVIEW_KEY,
    CM_CACHE_KEY: CM_CACHE_KEY,
    CM_EVENT: CM_EVENT,
  };
}
