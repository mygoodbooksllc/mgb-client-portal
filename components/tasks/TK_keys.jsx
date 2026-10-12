// ----------------------------------------------------------------------------
// TK_keys.jsx — list keys, the shortcuts sheet, routes and the pop-out
// (views slice, C6 and C8).
//
// Exports: TK_useKeys, TK_KeysSheet, TK_navigate, TK_useRoute, TK_popOut
//
// List keys (j k Enter x s a q ?) bind through TK_bindListKeys only while
// `enabled` is true; list views pass enabled = !drawerId, so with the drawer
// open no list key fires. The handler sits on `document` in the bubble phase:
// after every capture-phase trap (ModalShell, the drawer, Tour), and before
// TK_QuickAddHost's global `q` on window. A list's own `q` calls
// preventDefault, so the global handler stands down and exactly one
// tk:quick-add goes out, carrying the list's client, project and section.
//
// t (TK_ClientDrawerHost) toggles the client tasks panel; list keys pause while it's open.
//
// Globals: window.TK_listContext holds the active list's quick add context
// (client, project and section, or null) while that list has its keys
// enabled, and is null otherwise. Nothing reads it today; the tk:quick-add
// event detail is the supported path. A reader must treat null as "no list".
// ----------------------------------------------------------------------------

var TK_vKEYS_USED_KEY = "mgb_tk_keys_used_v1";
var TK_vKeysUsed = {};

// MGB_track("tasks-shortcut") at most once per session per key.
function TK_vTrackKey(key) {
  var k = String(key || "");
  if (!k || TK_vKeysUsed[k]) return;
  TK_vKeysUsed[k] = 1;
  var seen = {};
  try {
    seen = JSON.parse(TK_vSsGet(TK_vKEYS_USED_KEY) || "{}") || {};
  } catch (e) {
    seen = {};
  }
  if (seen[k]) return;
  seen[k] = 1;
  TK_vSsSet(TK_vKEYS_USED_KEY, JSON.stringify(seen));
  TK_vTrack("tasks-shortcut");
}

// The ctx TK_shouldHandleKey needs, read from the page.
function TK_vKeyCtx() {
  var q = function (sel) {
    try {
      return document.querySelector(sel);
    } catch (e) {
      return null;
    }
  };
  var menuOpen = false;
  try {
    var menus = document.querySelectorAll('[role="menu"]');
    for (var i = 0; i < menus.length; i++) {
      if (menus[i].offsetParent !== null || menus[i].getClientRects().length) menuOpen = true;
    }
  } catch (e) {}
  if (q(".tb-search-list")) menuOpen = true;
  return {
    modalOpen: !!q(".modal-overlay") || !!q(".tk-cd-layer"),
    menuOpen: menuOpen,
    tourOpen: !!q(".tour-root"),
    scope: "list",
  };
}

// opts: { ids, focusedId, setFocusedId, onOpen(id), onToggleDone(id),
//         onStatusMenu(id), onAssign(id), enabled,
//         quickAdd: { client_id?, project_id?, section? } | () => detail }
// Returns { sheet }: the shortcuts sheet element while `?` has it open.
function TK_useKeys(opts) {
  var o = opts || {};
  var ref = React.useRef(o);
  ref.current = o;
  var pair = React.useState(false);
  var help = pair[0];
  var setHelp = pair[1];
  var enabled = !!o.enabled;

  React.useEffect(
    function () {
      if (!enabled || typeof TK_bindListKeys !== "function") return undefined;
      var off = TK_bindListKeys(document, {
        enabled: true,
        getState: function () {
          return { ids: ref.current.ids || [], focusedId: ref.current.focusedId };
        },
        shouldHandle: function (e) {
          if (typeof TK_shouldHandleKey !== "function") return false;
          return TK_shouldHandleKey(e, TK_vKeyCtx());
        },
        setFocusedId: function (id) {
          if (ref.current.setFocusedId) ref.current.setFocusedId(id);
        },
        onOpen: function (id) {
          if (ref.current.onOpen) ref.current.onOpen(id);
        },
        onToggleDone: function (id) {
          if (ref.current.onToggleDone) ref.current.onToggleDone(id);
        },
        onStatusMenu: function (id) {
          if (ref.current.onStatusMenu) ref.current.onStatusMenu(id);
        },
        onAssign: function (id) {
          if (ref.current.onAssign) ref.current.onAssign(id);
          else TK_vOpenTask(id, { from: "keys", focus: "assignee" });
        },
        onQuickAdd: function () {
          var qa = ref.current.quickAdd;
          var detail = typeof qa === "function" ? qa() : qa || {};
          try {
            window.dispatchEvent(new CustomEvent("tk:quick-add", { detail: detail || {} }));
          } catch (e) {}
        },
        onHelp: function () {
          setHelp(true);
        },
        onUsed: TK_vTrackKey,
      });
      return off || undefined;
    },
    [enabled],
  );

  // The list's quick add context, for a QuickAddHost that wants to read it.
  React.useEffect(
    function () {
      if (!enabled) return undefined;
      var qa = ref.current.quickAdd;
      try {
        window.TK_listContext = typeof qa === "function" ? qa() : qa || null;
      } catch (e) {}
      return function () {
        try {
          window.TK_listContext = null;
        } catch (e) {}
      };
    },
    [enabled, typeof o.quickAdd === "function" ? "fn" : JSON.stringify(o.quickAdd || null)],
  );

  return {
    sheet: help ? (
      <TK_KeysSheet
        onClose={function () {
          setHelp(false);
        }}
      />
    ) : null,
    openHelp: function () {
      setHelp(true);
    },
  };
}

// The shortcuts sheet: a ModalShell listing TK_KEYMAP.
function TK_KeysSheet(props) {
  var map = typeof TK_KEYMAP !== "undefined" && Array.isArray(TK_KEYMAP) ? TK_KEYMAP : [];
  var where = function (k) {
    var s = Array.isArray(k.scopes) ? k.scopes : [k.scope];
    // t opens the client panel, which the Tasks window doesn't have.
    if (k.key === "t") return "In the portal (not the Tasks window)";
    if (s.indexOf("global") >= 0) return "Anywhere in the portal";
    if (s.indexOf("list") >= 0 && s.indexOf("drawer") >= 0) return "Lists and task details";
    if (s.indexOf("drawer") >= 0) return "Task details";
    return "Lists";
  };
  var id = "tk-keys-title";
  return (
    <TK_vModal onClose={props.onClose} labelledBy={id} className="tk-modal tk-keys-sheet tk-sheet">
      <div className="modal-header">
        <h3 className="card-title" id={id} style={{ margin: 0 }}>
          Keyboard shortcuts
        </h3>
        <button type="button" className="modal-close" onClick={props.onClose} aria-label="Close">
          ×
        </button>
      </div>
      <div className="modal-body">
        <table className="tk-keys-table">
          <tbody>
            {map.map(function (k) {
              return (
                <tr key={k.key}>
                  <td className="tk-keys-cap">
                    <kbd className="tk-kbd">{k.display || k.key}</kbd>
                  </td>
                  <td className="tk-keys-label">{k.label}</td>
                  <td className="tk-keys-where">{where(k)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="tk-keys-note">Shortcuts pause while you type in a box or have a menu open.</p>
      </div>
    </TK_vModal>
  );
}

// ---- Routes ---------------------------------------------------------------------

function TK_vHashOf(route) {
  if (typeof route === "string") return route.charAt(0) === "#" ? route : "#" + route;
  if (typeof TK_formatRoute === "function") return TK_formatRoute(route);
  return "#/tasks/my";
}

// pushState({ mgbNav: AN_navIndex()+1 }) + "mgb-nav" + "tk:route"; replace
// uses replaceState and keeps history.state. Outside the Tasks page (the
// embedded My Tasks under Work) it sets location.hash, so App switches page.
function TK_navigate(route, opts) {
  var hash = TK_vHashOf(route);
  var replace = !!(opts && opts.replace);
  var here = "";
  try {
    here = window.location.hash || "";
  } catch (e) {}
  if (!/^#\/tasks(\/|\?|$)/.test(here)) {
    try {
      window.location.hash = hash;
    } catch (e) {}
    return;
  }
  if (here === hash) {
    try {
      window.dispatchEvent(new Event("tk:route"));
    } catch (e) {}
    return;
  }
  try {
    if (replace) {
      window.history.replaceState(window.history.state, "", hash);
    } else {
      var idx = typeof AN_navIndex === "function" ? AN_navIndex() : 0;
      window.history.pushState({ mgbNav: idx + 1 }, "", hash);
      window.dispatchEvent(new Event("mgb-nav"));
    }
    window.dispatchEvent(new Event("tk:route"));
  } catch (e) {
    try {
      window.location.hash = hash;
    } catch (err) {}
  }
}

function TK_vReadRoute() {
  var h = "";
  try {
    h = window.location.hash || "";
  } catch (e) {}
  return typeof TK_parseRoute === "function" ? TK_parseRoute(h) : { view: "my" };
}

function TK_useRoute() {
  var pair = React.useState(TK_vReadRoute);
  var setR = pair[1];
  React.useEffect(function () {
    var on = function () {
      var next = TK_vReadRoute();
      setR(function (cur) {
        return JSON.stringify(cur) === JSON.stringify(next) ? cur : next;
      });
    };
    window.addEventListener("hashchange", on);
    window.addEventListener("popstate", on);
    window.addEventListener("tk:route", on);
    return function () {
      window.removeEventListener("hashchange", on);
      window.removeEventListener("popstate", on);
      window.removeEventListener("tk:route", on);
    };
  }, []);
  return pair[0];
}

// ---- Pop-out (Row 11.2) -------------------------------------------------------------

function TK_popOut(hash) {
  var h = typeof hash === "string" && hash ? hash : "#/tasks/my";
  if (h.charAt(0) !== "#") h = "#" + h;
  var key = typeof TK_POPOUT_KEY === "string" ? TK_POPOUT_KEY : "mgb_tk_popout_v1";
  var saved = TK_vLsGet(key, null);
  var features = typeof TK_popOutFeatures === "function" ? TK_popOutFeatures(saved) : "popup,width=480,height=820";
  var w = null;
  try {
    // No noopener: the window docks back through window.opener.
    w = window.open("/?shell=tasks" + h, "mgb-tasks", features);
  } catch (e) {
    w = null;
  }
  if (!w) {
    TK_vToast(TK_vCopy("popupBlocked"));
    return null;
  }
  TK_vTrack("tasks-popout");
  try {
    w.focus();
  } catch (e) {}
  return w;
}
