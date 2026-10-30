// ----------------------------------------------------------------------------
// CPD_gate: the one gate for the client page drop and the staff Documents
// upgrades (docs/client-page-drop.md).
//
// Two inputs, one resolver each side:
//   - the per-person preview: localStorage mgb_clientdrop_preview === "1"
//     (Developer tools > Feature flags, "Client page drop + Documents upgrades preview").
//   - the firm switch: tk_settings.client_page_drop_enabled (true/false) and
//     tk_settings.client_page_drop_pilot ("all" or a list of client ids).
//     Owner-only keys; code NEVER writes them. On for a client only when
//     enabled AND the pilot is "all" or lists that client (same rule as the
//     database's cpd__on).
//
// Staff (CPD_useStaffGate / CPD_staffGateNow):
//   plus  = preview OR switch enabled: the staff Documents upgrades (rename,
//           folders, multi-select, tags, replace, copy link, access badge,
//           history). Rename, folders and the rest work with the preview
//           alone.
//   onFor(clientId) = the switch is on for that client: only then can a
//           "who can see it" rule be saved (the database refuses otherwise).
//   Staff read tk_settings once per page load after a session exists; the
//   last answer is kept per browser in mgb_clientdrop_cache and the window
//   event mgb:clientdrop fires when it changes.
// Clients (CPD_useClientState): clients can't read tk_settings, so they ask
//   client_page_drop_state() once per page load; { enabled } already folds
//   in the switch, the pilot and the login's Documents tab.
// The client page drop mounts when the client's state is enabled. Staff in
//   View as get a demo of it (uploads stubbed) only with their preview on.
//
// Browser file (plain JS); loads before ClientPageDrop.jsx and app.jsx.
// Node test: components/client/clientPageDropLogic.test.js (resolver).
// ----------------------------------------------------------------------------

var CPD_PREVIEW_KEY = "mgb_clientdrop_preview";
var CPD_CACHE_KEY = "mgb_clientdrop_cache";
var CPD_EVENT = "mgb:clientdrop";

function CPD__ls(k) {
  try {
    return window.localStorage.getItem(k);
  } catch (e) {
    return null;
  }
}
function CPD__lsSet(k, v) {
  try {
    if (v == null) window.localStorage.removeItem(k);
    else window.localStorage.setItem(k, v);
  } catch (e) {}
}
function CPD__emit() {
  try {
    window.dispatchEvent(new Event(CPD_EVENT));
  } catch (e) {}
}

function CPD_previewOn() {
  return CPD__ls(CPD_PREVIEW_KEY) === "1";
}

function CPD__cache() {
  try {
    var v = JSON.parse(CPD__ls(CPD_CACHE_KEY) || "null");
    return v && typeof v === "object" ? v : { enabled: false, pilot: null };
  } catch (e) {
    return { enabled: false, pilot: null };
  }
}

// Staff: one read of the two switch keys per page load, after sign-in.
var CPD__switch = { state: "idle", fails: 0, nextAt: 0 };
function CPD_readSwitch(force) {
  var c = typeof window !== "undefined" ? window.mgbSupabase : null;
  if (!c || (!force && CPD__switch.state !== "idle")) return;
  if (!force && Date.now() < CPD__switch.nextAt) return;
  CPD__switch.state = "reading";
  var wait = function () {
    CPD__switch.state = "idle";
    CPD__switch.nextAt = Date.now() + 3000;
  };
  var fail = function () {
    CPD__switch.fails += 1;
    CPD__switch.state = CPD__switch.fails >= 3 ? "done" : "idle";
    CPD__switch.nextAt = Date.now() + 30000;
  };
  try {
    var go = function () {
      c.from("tk_settings")
        .select("key, value")
        .in("key", ["client_page_drop_enabled", "client_page_drop_pilot"])
        .then(function (res) {
          if (!res || res.error) return fail();
          CPD__switch.state = "done";
          var rows = res.data || [];
          var get = function (k) {
            for (var i = 0; i < rows.length; i++) if (rows[i].key === k) return rows[i].value;
            return null;
          };
          var next = { enabled: CPD_switchValue(get("client_page_drop_enabled")), pilot: get("client_page_drop_pilot") };
          var before = CPD__ls(CPD_CACHE_KEY);
          CPD__lsSet(CPD_CACHE_KEY, next.enabled ? JSON.stringify(next) : null);
          if (CPD__ls(CPD_CACHE_KEY) !== before) CPD__emit();
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

// The staff answer right now (no network).
function CPD_staffGateNow() {
  var sw = CPD__cache();
  var preview = CPD_previewOn();
  return {
    preview: preview,
    plus: CPD_staffPlus(preview, sw.enabled),
    onFor: function (clientId) {
      return CPD_switchOnFor(sw.enabled, sw.pilot, clientId);
    },
  };
}

function CPD__useBump(re) {
  var s = React.useState(0);
  var bump = s[1];
  React.useEffect(function () {
    var hit = function () {
      bump(function (n) {
        return n + 1;
      });
    };
    var onStorage = function (e) {
      if (!e || !e.key || re.test(e.key)) hit();
    };
    window.addEventListener(CPD_EVENT, hit);
    window.addEventListener("storage", onStorage);
    return function () {
      window.removeEventListener(CPD_EVENT, hit);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
}

// Staff hook: `const cpd = CPD_useStaffGate(isStaff);` Reads the switch only
// for staff (a client's read of tk_settings would just be refused).
function CPD_useStaffGate(isStaff) {
  CPD__useBump(/^mgb_clientdrop_/);
  React.useEffect(function () {
    if (isStaff && CPD__switch.state === "idle") CPD_readSwitch();
  });
  if (!isStaff) return { preview: false, plus: false, onFor: function () { return false; } };
  return CPD_staffGateNow();
}

// Client: client_page_drop_state() once per page load.
var CPD__client = { state: "idle", value: null };
function CPD_readClientState(force) {
  var c = typeof window !== "undefined" ? window.mgbSupabase : null;
  if (!c || (!force && CPD__client.state !== "idle")) return;
  CPD__client.state = "reading";
  try {
    c.auth.getSession().then(
      function (r) {
        if (!r || !r.data || !r.data.session) {
          CPD__client.state = "idle";
          return;
        }
        c.rpc("client_page_drop_state").then(
          function (res) {
            CPD__client.state = "done";
            var v = res && !res.error && res.data && typeof res.data === "object" ? res.data : null;
            CPD__client.value = v ? { eligible: v.eligible === true, enabled: v.enabled === true } : { eligible: false, enabled: false };
            CPD__emit();
          },
          function () {
            CPD__client.state = "done";
            CPD__client.value = { eligible: false, enabled: false };
          },
        );
      },
      function () {
        CPD__client.state = "idle";
      },
    );
  } catch (e) {
    CPD__client.state = "done";
  }
}

// Client hook: `const st = CPD_useClientState(isRealClient);` -> { enabled }.
function CPD_useClientState(isRealClient) {
  CPD__useBump(/^$/);
  React.useEffect(function () {
    if (isRealClient && CPD__client.state === "idle") CPD_readClientState();
  });
  if (!isRealClient) return { enabled: false };
  return { enabled: !!(CPD__client.value && CPD__client.value.enabled) };
}
