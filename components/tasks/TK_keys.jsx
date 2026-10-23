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
// v (P4-3) selects the focused row on lists that pass onSelect (Shift+V: the
// range). Ctrl/Cmd+Z undoes the last Tasks action only while its Undo toast
// is up (TK_api.liveUndo) and never while typing in a field.
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
    // any open dialog (the Workbench hub, the inbox drawer, …) is a layer:
    // list keys like v and x never act on the list behind it
    modalOpen: !!q(".modal-overlay") || !!q(".tk-cd-layer") || !!q('[aria-modal="true"]'),
    menuOpen: menuOpen,
    tourOpen: !!q(".tour-root"),
    scope: "list",
  };
}

// opts: { ids, focusedId, setFocusedId, onOpen(id), onToggleDone(id),
//         onStatusMenu(id), onAssign(id), onSelect(id, shift), enabled,
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
        // Slate app only: arrows move between tasks, e opens the title to edit.
        slateKeys: !!o.slateKeys,
        onEdit: function (id) {
          if (ref.current.onEdit) ref.current.onEdit(id);
          else TK_vOpenTask(id, { from: "keys", focus: "title" });
        },
        // Lists without selection leave v alone (no onSelect: not handled).
        onSelect: o.onSelect
          ? function (id, shift) {
              if (ref.current.onSelect) ref.current.onSelect(id, shift);
            }
          : undefined,
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
    // Rebinds when selection turns on (the schema probe can land after mount).
    [enabled, !!o.onSelect, !!o.slateKeys],
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

// Slate app interactions: shown in the sheet only inside the Slate app.
var TK_SLATE_KEYS_HELP = [
  ["↑ ↓", "Move between tasks", "Lists"],
  ["E", "Open the task to edit its title", "Lists"],
  ["Cmd+D", "Duplicate the task (or the selected tasks)", "Lists"],
  ["Cmd+C", "Copy the task (or the selected tasks)", "Lists"],
  ["Cmd+V", "Paste copies into this list, in the focused task's section", "Lists"],
  ["Shift+click", "Select a range of tasks", "Lists"],
  ["Cmd+click", "Select or unselect one task", "Lists"],
  ["Right-click", "Task menu (long press on a touch screen)", "Lists and boards"],
  ["Drag", "Drag across rows to select them", "Lists"],
  ["Swipe", "Swipe a row right to complete it, left to snooze it a day (touch)", "Lists"],
  ["Swipe back", "Two fingers right on a trackpad, or in from the left edge: close, then go back", "Anywhere"],
];

// The shortcuts sheet: a ModalShell listing TK_KEYMAP.
function TK_KeysSheet(props) {
  var map = typeof TK_KEYMAP !== "undefined" && Array.isArray(TK_KEYMAP) ? TK_KEYMAP : [];
  var slate = typeof TK_slateInApp === "function" && !!TK_slateInApp();
  var mac = typeof TK__ixMac === "function" ? TK__ixMac() : false;
  var where = function (k) {
    var s = Array.isArray(k.scopes) ? k.scopes : [k.scope];
    // t opens the client panel, which the Tasks window doesn't have.
    if (k.key === "t") return "In the portal (not the Slate window)";
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
        {slate ? (
          <React.Fragment>
            <h4 className="tk-keys-sub">In the Slate app</h4>
            <table className="tk-keys-table tk-keys-slate">
              <tbody>
                {TK_SLATE_KEYS_HELP.map(function (k) {
                  return (
                    <tr key={k[0]}>
                      <td className="tk-keys-cap">
                        <kbd className="tk-kbd">{k[0].replace("Cmd", mac ? "⌘" : "Ctrl")}</kbd>
                      </td>
                      <td className="tk-keys-label">{k[1]}</td>
                      <td className="tk-keys-where">{k[2]}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </React.Fragment>
        ) : null}
        <p className="tk-keys-note">
          <kbd className="tk-kbd">Ctrl</kbd> or <kbd className="tk-kbd">⌘</kbd> + <kbd className="tk-kbd">Z</kbd> undoes your last
          Tasks action while its Undo message is on screen{slate ? " (in the Slate app, your last action for up to 9 minutes)" : ""}.
        </p>
        <p className="tk-keys-note">Shortcuts pause while you type in a box or have a menu open.</p>
      </div>
    </TK_vModal>
  );
}

// ---- Undo key (P4-3) --------------------------------------------------------------
// One document listener for the page: Ctrl/Cmd+Z runs TK_api.undoLive() only
// while an Undo toast is live; otherwise the key is left to the browser.
var TK_vUndoKeyBound = false;
function TK_vBindUndoKey() {
  if (TK_vUndoKeyBound || typeof document === "undefined") return;
  TK_vUndoKeyBound = true;
  document.addEventListener("keydown", function (e) {
    if (e.defaultPrevented) return;
    if (typeof TK_isUndoKey !== "function" || !TK_isUndoKey(e)) return;
    if (typeof TK_api === "undefined" || !TK_api || typeof TK_api.liveUndo !== "function" || !TK_api.liveUndo()) return;
    e.preventDefault();
    TK_api.undoLive();
    TK_vTrack("tasks-undo-key");
  });
}
TK_vBindUndoKey();

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

// opts.app (the Slate app is on; TK_openSlateApp in TK_SlateBridge.jsx): the
// window opens at /slate (TK_slateAppUrl) with the app minimum size, and is
// then sized with resizeTo, which sets the OUTER size the shell bar saved (so
// it no longer grows by the frame height on every reopen). Without opts.app
// this is exactly the classic pop-out.
function TK_popOut(hash, opts) {
  var h = typeof hash === "string" && hash ? hash : "#/tasks/my";
  if (h.charAt(0) !== "#") h = "#" + h;
  var key = typeof TK_POPOUT_KEY === "string" ? TK_POPOUT_KEY : "mgb_tk_popout_v1";
  var saved = TK_vLsGet(key, null);
  if (opts && opts.app === true) return TK_vPopOutApp(h, saved);
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

function TK_vPopOutApp(h, saved) {
  var size = typeof TK_popOutSize === "function" ? TK_popOutSize(saved, undefined, true) : { w: 480, h: 820 };
  var features = typeof TK_popOutFeatures === "function" ? TK_popOutFeatures(saved, undefined, true) : "popup,width=480,height=820";
  var url = typeof TK_slateAppUrl === "function" ? TK_slateAppUrl(h) : "/slate#/tasks/my";
  var w = null;
  try {
    w = window.open(url, "mgb-tasks", features);
  } catch (e) {
    w = null;
  }
  if (!w) {
    TK_vToast(TK_vCopy("popupBlocked"));
    return null;
  }
  // Only a saved size (the outer size TK_StandaloneBar remembered) needs the
  // fix; a first open keeps the classic 480x820 request.
  if (saved && typeof saved === "object" && saved.w && saved.h) {
    try {
      w.resizeTo(size.w, size.h);
    } catch (e) {}
  }
  try {
    w.focus();
  } catch (e) {}
  return w;
}
