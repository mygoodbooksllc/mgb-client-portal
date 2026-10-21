// ----------------------------------------------------------------------------
// Tasks module, drawer slice (docs/tasks-phase1-spec.md C7, rows 1.1, 1.3,
// 2.1, 2.3, 2.6, 3.6, N.4).
//
//   TK_openTask(id, { from, focus })   open a task in the drawer, or fall back
//                                      to the legacy Work › Tasks page
//   TK_openTaskClick(id)               onClick for <a href={LK_href(task)}>
//   TK_DrawerHost(props)               mounted once by App; owns the drawer
//   TK_Drawer(props)                   the modal side panel: chrome (layer,
//                                      scrim, dialog, Tab trap, Esc, scroll
//                                      lock, focus return) around
//                                      TK_DrawerContent (TK_DrawerContent.jsx)
//
// Every top-level name is a browser global. Private helpers carry the TK_dw
// prefix. Other files' globals are used at render or call time only, behind
// typeof guards, so a missing slice degrades instead of throwing.
// ----------------------------------------------------------------------------

// ---- Shared helpers (also used by TK_Comments, TK_Attachments, TK_Activity
// and TK_QuickAdd at render time) ---------------------------------------------

function TK_dwStore() {
  return typeof TK_store !== "undefined" && TK_store ? TK_store : null;
}

function TK_dwApi() {
  return typeof TK_api !== "undefined" && TK_api ? TK_api : null;
}

function TK_dwState() {
  var s = TK_dwStore();
  return s ? s.getState() : null;
}

function TK_dwDispatch(action) {
  var s = TK_dwStore();
  if (s) s.dispatch(action);
}

function TK_dwLower(v) {
  return v == null ? "" : String(v).trim().toLowerCase();
}

// A selector over TK_store. The selector must return stable values (a field,
// or TK_selectList's cached object) so the effect never loops.
function TK_dwUseStore(selector) {
  var selRef = React.useRef(selector);
  selRef.current = selector;
  var read = function () {
    var st = TK_dwState();
    if (!st) return undefined;
    try {
      return selRef.current(st);
    } catch (e) {
      return undefined;
    }
  };
  var pair = React.useState(read);
  var value = pair[0];
  var setValue = pair[1];
  React.useEffect(function () {
    var s = TK_dwStore();
    if (!s || typeof s.subscribe !== "function") return undefined;
    var sync = function () {
      var next = read();
      setValue(function (prev) { return prev === next ? prev : next; });
    };
    sync();
    return s.subscribe(sync);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // A selector that changed between renders (a new id) reads fresh at once.
  var now = read();
  return now === undefined ? value : now;
}

function TK_dwCopy(key, fallback) {
  if (typeof TK_COPY !== "undefined" && TK_COPY && TK_COPY[key]) return TK_COPY[key];
  return fallback || "";
}

function TK_dwToast(text) {
  if (!text) return;
  if (typeof TK_toast === "function") {
    TK_toast(text);
    return;
  }
  try {
    window.dispatchEvent(new CustomEvent("mgb:toast", { detail: { text: text } }));
  } catch (e) {}
}

function TK_dwTrack(name, detail) {
  try {
    if (typeof MGB_track === "function") MGB_track(name, detail);
  } catch (e) {}
}

// Store "online" and navigator.onLine together.
function TK_dwUseOnline() {
  var storeOnline = TK_dwUseStore(function (s) { return s.online; });
  var pair = React.useState(function () {
    return typeof navigator === "undefined" || navigator.onLine !== false;
  });
  var nav = pair[0];
  var setNav = pair[1];
  React.useEffect(function () {
    var on = function () { setNav(true); };
    var off = function () { setNav(false); };
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return function () {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return nav && storeOnline !== false;
}

// Active staff from the store, loaded once per session through TK_api.
function TK_dwUseStaff() {
  var staff = TK_dwUseStore(function (s) { return s.staff; });
  React.useEffect(function () {
    var api = TK_dwApi();
    if (staff == null && api && typeof api.listStaff === "function") {
      Promise.resolve()
        .then(function () { return api.listStaff(); })
        .catch(function () {});
    }
  }, [staff == null]);
  return staff || [];
}

function TK_dwNameFn(staff) {
  return function (email) {
    return TK_dlNameOf(email, staff);
  };
}

function TK_dwPortal(node) {
  if (typeof ReactDOM !== "undefined" && ReactDOM.createPortal && typeof document !== "undefined") {
    return ReactDOM.createPortal(node, document.body);
  }
  return node;
}

function TK_dwVisible(el) {
  return !!el && (el.offsetParent !== null || (el.getClientRects && el.getClientRects().length > 0));
}

function TK_dwMenuOpen(root) {
  try {
    var list = (root || document).querySelectorAll('[role="menu"]');
    for (var i = 0; i < list.length; i++) if (TK_dwVisible(list[i])) return true;
  } catch (e) {}
  return false;
}

function TK_dwIsTyping(el) {
  if (!el || !el.tagName) return false;
  var tag = el.tagName.toLowerCase();
  if (tag === "textarea" || tag === "select") return true;
  if (tag === "input") {
    var type = String(el.type || "text").toLowerCase();
    return ["checkbox", "radio", "button", "submit", "reset", "file", "range", "color"].indexOf(type) < 0;
  }
  if (el.isContentEditable) return true;
  return el.getAttribute && el.getAttribute("role") === "textbox";
}

// One toast per error code (C5). Returns the code.
function TK_dwSaveError(e) {
  var code = e && e.code;
  // P4-3: a one-task bulk call the server skipped says why.
  if (code === "tk_skipped" && e.message) {
    TK_dwToast("Not changed. " + e.message);
    return code;
  }
  // Ask client refusals (tasks p2 s5), e.g. leaving Waiting with open requests.
  if (e && e.reason && typeof TK_REQUEST_ERROR_COPY !== "undefined" && TK_REQUEST_ERROR_COPY[e.reason] && e.reason !== "tk_forbidden") {
    TK_dwToast(TK_REQUEST_ERROR_COPY[e.reason]);
    return e.reason;
  }
  if (code === "tk_conflict") TK_dwToast(TK_dwCopy("conflict", "Someone else just changed this task. Showing the latest."));
  else if (code === "tk_reverted" || code === "tk_forbidden" || code === "42501") {
    TK_dwToast(TK_dwCopy("reverted", "Only the task's owner or an admin can change that."));
  } else if (code === "tk_offline") TK_dwToast(TK_dwCopy("offline", "You're offline."));
  else {
    TK_dwToast(TK_dwCopy("saveError", "Couldn't save that change. Try again."));
    if (typeof console !== "undefined") console.error("[TK]", e);
  }
  return code;
}

// Review refusals (tk_self_review, tk_reason_required …) get their own line.
function TK_dwReviewError(e) {
  var key = typeof TK_reviewErrorKey === "function" ? TK_reviewErrorKey(e) : null;
  if (key && TK_dwCopy(key, "")) {
    TK_dwToast(TK_dwCopy(key, ""));
    return key;
  }
  return TK_dwSaveError(e);
}

function TK_dwTrackShortcut(key) {
  try {
    var seen = (window.TK_shortcutTracked = window.TK_shortcutTracked || {});
    if (seen[key]) return;
    seen[key] = true;
  } catch (e) {}
  TK_dwTrack("tasks-shortcut", { key: key });
}

function TK_dwFocusables(root) {
  if (!root) return [];
  var list = root.querySelectorAll(
    'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
  );
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var el = list[i];
    if (el.disabled || el.getAttribute("aria-hidden") === "true") continue;
    if (el.type === "hidden") continue;
    if (!TK_dwVisible(el)) continue;
    out.push(el);
  }
  return out;
}

function TK_dwIsPhone() {
  // Inside the Slate app the size mode decides (compact = phone style).
  var sp = typeof TK_slatePhoneNow === "function" ? TK_slatePhoneNow() : null;
  if (sp !== null) return sp;
  try {
    return !!(window.matchMedia && window.matchMedia("(max-width: 760px)").matches);
  } catch (e) {
    return false;
  }
}

function TK_dwTaskHref(id) {
  if (typeof LK_href === "function") return LK_href({ place: "tasks", tab: "my", item: "task:" + id });
  return "#/tasks/my?item=task:" + encodeURIComponent(String(id));
}

function TK_dwClientListHref(clientId) {
  if (typeof TK_formatRoute === "function") {
    try {
      return TK_formatRoute({ view: "client", clientId: clientId });
    } catch (e) {}
  }
  return "#/tasks/c/" + encodeURIComponent(String(clientId));
}

function TK_dwProjectHref(projectId) {
  if (typeof TK_formatRoute === "function") {
    try {
      return TK_formatRoute({ view: "project", projectId: projectId });
    } catch (e) {}
  }
  return "#/tasks/p/" + encodeURIComponent(String(projectId));
}

function TK_dwGo(route, href) {
  if (typeof TK_navigate === "function") {
    TK_navigate(route);
    return;
  }
  try {
    window.location.hash = href;
  } catch (e) {}
}

// P4-2: a month-end task made from the Close checklist links back to its
// checklist step ("Close checklist: Bank rec, November 2026"). For bank feed
// and bank rec it also shows the 14.2 "Looks done" line when QuickBooks'
// close checks pass; Mark done goes through tk_close_tick (never automatic).
function TK_dwCloseLink(props) {
  var task = props.task;
  var id = task && task.id;
  var templated = !!(task && task.source === "template" && task.client_id && !task.parent_id);
  var linkPair = React.useState(null);
  var link = linkPair[0];
  var setLink = linkPair[1];
  var checksPair = React.useState(null);
  var checks = checksPair[0];
  var setChecks = checksPair[1];
  var busyPair = React.useState(false);
  var busy = busyPair[0];
  var setBusy = busyPair[1];
  React.useEffect(
    function () {
      var live = true;
      setLink(null);
      setChecks(null);
      var api = TK_dwApi();
      if (!templated || !api || typeof api.closeLinkForTask !== "function") return undefined;
      api.closeLinkForTask(id).then(function (row) {
        if (!live || !row) return;
        setLink(row);
        if ((row.close_key === "bank_feed" || row.close_key === "bank_rec") && typeof api.closeChecks === "function") {
          api.closeChecks(row.client_id, row.period_start).then(function (c) {
            if (live) setChecks(c);
          });
        }
      });
      return function () {
        live = false;
      };
    },
    // re-fetch when the task moves client/month or gains/loses its close_key
    [id, templated, task && task.client_id, task && task.period_start, task && task.close_key],
  );
  if (!link || typeof TK_closeLinkText !== "function") return null;
  var ym = String(link.period_start || "").slice(0, 7);
  var target = { clientId: link.client_id, tab: "close", month: ym, item: "step:" + link.close_key };
  var href = typeof LK_href === "function" ? LK_href(target) : "#";
  var status = TK_dwEffectiveStatus(task);
  var hint = status !== "done" && status !== "ready_for_review" && !props.readOnly && checks && typeof TK_closeLooksDone === "function"
    ? TK_closeLooksDone(link.close_key, checks)
    : null;
  var markDone = function () {
    var api = TK_dwApi();
    if (!api || typeof api.closeTick !== "function" || busy) return;
    setBusy(true);
    api.closeTick(link.client_id, ym, link.close_key, true).then(
      function (res) {
        setBusy(false);
        var msg = typeof TK_closeTickToast === "function" ? TK_closeTickToast(res, true) : "";
        if (msg) TK_dwToast(msg);
      },
      function (e) {
        setBusy(false);
        TK_dwSaveError(e);
      },
    );
  };
  return (
    <div className="tk-dw-close">
      <p className="tk-dw-parent">
        <a
          href={href}
          className="link-btn"
          onClick={function (e) {
            if (typeof LK_onClick !== "function") return;
            TK_dwDispatch({ type: "drawer", id: null });
            LK_onClick(target)(e);
          }}
        >
          {TK_closeLinkText(link.close_key, link.period_start)}
        </a>
      </p>
      {hint && (
        <p className="tk-dw-close-hint">
          {hint.text}{" "}
          <button type="button" className="link-btn" disabled={busy} onClick={markDone}>
            Mark done
          </button>
        </p>
      )}
    </div>
  );
}

function TK_dwStatusLabel(status) {
  if (typeof TK_STATUS_LABELS !== "undefined" && TK_STATUS_LABELS && TK_STATUS_LABELS[status]) return TK_STATUS_LABELS[status];
  return status ? String(status).replace(/_/g, " ") : "";
}

function TK_dwEffectiveStatus(task) {
  if (typeof TK_effectiveStatus === "function") return TK_effectiveStatus(task);
  if (!task) return "todo";
  return task.status || (task.done ? "done" : "todo");
}

function TK_dwIsOpen(task) {
  if (typeof TK_isOpen === "function") return TK_isOpen(task);
  return !!task && !task.deleted_at && TK_dwEffectiveStatus(task) !== "done";
}

function TK_dwToday() {
  if (typeof TK_ymd === "function") return TK_ymd();
  if (typeof todayLocal === "function") return todayLocal();
  var d = new Date();
  return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
}

// Rows of one child table (comments, activity, followers, attachments) for a
// task, cached per session and refreshed on "tk:task-changed" and on `stamp`.
var TK_dwRowsCache = {};

function TK_dwUseRows(kind, taskId, loader, opts) {
  var o = opts || {};
  var key = taskId ? kind + ":" + taskId : null;
  var cached = key ? TK_dwRowsCache[key] : null;
  var pair = React.useState(function () {
    return { rows: cached ? cached.rows : [], loading: !cached && !!key, error: null };
  });
  var state = pair[0];
  var setState = pair[1];
  var loaderRef = React.useRef(loader);
  loaderRef.current = loader;
  var seq = React.useRef(0);

  var reload = React.useCallback(function () {
    if (!key) return Promise.resolve([]);
    var my = ++seq.current;
    setState(function (s) { return { rows: s.rows, loading: !TK_dwRowsCache[key], error: null }; });
    return Promise.resolve()
      .then(function () { return loaderRef.current(); })
      .then(
        function (rows) {
          var list = Array.isArray(rows) ? rows : [];
          TK_dwRowsCache[key] = { rows: list, at: Date.now() };
          if (my === seq.current) setState({ rows: list, loading: false, error: null });
          return list;
        },
        function (e) {
          if (my === seq.current) {
            setState(function (s) { return { rows: s.rows, loading: false, error: (e && e.code) || "error" }; });
          }
          return null;
        },
      );
  }, [key]);

  React.useEffect(function () {
    if (!key) {
      setState({ rows: [], loading: false, error: null });
      return undefined;
    }
    var c = TK_dwRowsCache[key];
    setState({ rows: c ? c.rows : [], loading: !c, error: null });
    reload();
    return undefined;
  }, [key, o.stamp]);

  React.useEffect(function () {
    if (!key) return undefined;
    var onChanged = function (e) {
      var d = (e && e.detail) || {};
      if (String(d.id) !== String(taskId)) return;
      if (o.tables) {
        var changed = Array.isArray(d.tables) && d.tables.length ? d.tables : d.table ? [d.table] : null;
        if (changed && !changed.some(function (t) { return o.tables.indexOf(t) >= 0; })) return;
      }
      reload();
    };
    window.addEventListener("tk:task-changed", onChanged);
    return function () { window.removeEventListener("tk:task-changed", onChanged); };
  }, [key, (o.tables || []).join(",")]);

  return { rows: state.rows, loading: state.loading, error: state.error, reload: reload };
}

// ---- Opening ----------------------------------------------------------------

// One router for every caller (Desk spec 5.1): while the Desk is live it
// registers window.TK_openTaskRoute (WB_Drawer.jsx), which opens the task in
// the Desk's task view and returns true. Otherwise (Desk off, View as, the
// own-window Slate, opts.modal) the modal drawer or the Tasks page opens it,
// exactly as before.
function TK_openTask(id, opts) {
  if (id == null || id === "") return;
  var o = opts || {};
  var routed = false;
  try {
    routed = typeof window.TK_openTaskRoute === "function" && window.TK_openTaskRoute(String(id), o) === true;
  } catch (e) {
    routed = false;
  }
  if (routed) return;
  var st = TK_dwState();
  var ready = false;
  try {
    ready = window.TK_drawerHostReady === true;
  } catch (e) {}
  var target = TK_dlOpenTarget({ schema: st ? st.schema : "unknown", hostReady: ready });
  if (target === "drawer") {
    try {
      window.dispatchEvent(
        new CustomEvent("tk:open-task", { detail: { id: String(id), from: o.from || null, focus: o.focus || null } }),
      );
    } catch (e) {}
    return;
  }
  // No drawer here (schema not ready, or no host): the legacy page opens it.
  if (typeof LK_go === "function") LK_go({ place: "work", tab: "tasks", item: "task:" + id });
}

function TK_openTaskClick(id) {
  return TK_dlClickHandler(id, function (taskId) { TK_openTask(taskId, { from: "link" }); });
}

// ---- Host -------------------------------------------------------------------

function TK_DrawerHost(props) {
  var p = props || {};
  var schema = TK_dwUseStore(function (s) { return s.schema; });
  var drawerId = TK_dwUseStore(function (s) { return s.drawerId; });
  var focusPair = React.useState(null);
  var focusField = focusPair[0];
  var setFocusField = focusPair[1];
  var openedAt = React.useRef(0);
  var drawerIdRef = React.useRef(drawerId);
  drawerIdRef.current = drawerId;

  React.useEffect(function () {
    try { window.TK_drawerHostReady = true; } catch (e) {}
    var api = TK_dwApi();
    if (api && typeof api.probe === "function") {
      Promise.resolve().then(function () { return api.probe(); }).catch(function () {});
    }
    return function () {
      try { window.TK_drawerHostReady = false; } catch (e) {}
      TK_dwDispatch({ type: "drawer", id: null });
    };
  }, []);

  var open = React.useCallback(function (id, focus) {
    if (id == null || id === "") return;
    openedAt.current = Date.now();
    TK_dwDispatch({ type: "drawer", id: String(id) });
    setFocusField(focus || null);
    try {
      window.dispatchEvent(new CustomEvent("tk:drawer-open", { detail: { id: String(id) } }));
    } catch (e) {}
    TK_dwTrack("tasks-drawer");
  }, []);

  var close = React.useCallback(function () {
    TK_dwDispatch({ type: "drawer", id: null });
    setFocusField(null);
  }, []);

  React.useEffect(function () {
    var onOpen = function (e) {
      var d = (e && e.detail) || {};
      open(d.id, d.focus);
    };
    // Moving to another page closes the drawer. An arrival opens it right
    // after its own hash change, so a fresh open is left alone.
    var onNav = function () {
      if (!drawerIdRef.current) return;
      if (Date.now() - openedAt.current < 500) return;
      close();
    };
    window.addEventListener("tk:open-task", onOpen);
    window.addEventListener("hashchange", onNav);
    window.addEventListener("popstate", onNav);
    return function () {
      window.removeEventListener("tk:open-task", onOpen);
      window.removeEventListener("hashchange", onNav);
      window.removeEventListener("popstate", onNav);
    };
  }, [open, close]);

  // Arrivals (11.5): ?item=task:<id> on #/tasks/... or #/work/tasks. With the
  // schema missing nothing registers, so the legacy MyTasksPage claims them.
  var onArrive = function (a) {
    if (!a) return;
    if (a.kind === "task" && a.id) {
      // Through the router, so a deep link opens in the Desk while it is live
      // (and in this drawer otherwise).
      TK_openTask(a.id, { from: "arrival" });
      return;
    }
    if (a.kind === "view" && a.client) {
      TK_dwGo({ view: "client", clientId: a.client }, TK_dwClientListHref(a.client));
    }
  };
  var live = schema !== "missing";
  var ready = schema === "ok";
  if (typeof LK_useArrival === "function") {
    LK_useArrival(live ? { place: "tasks", kinds: ["task", "view"], staff: true } : null, ready, onArrive);
    LK_useArrival(live ? { place: "work", tab: "tasks", kinds: ["task", "view"], staff: true } : null, ready, onArrive);
  }

  // Inside the Slate app: full mode shows the task in the pane (portaled
  // into its slot, still owned here), a sliver shows none. Elsewhere "drawer".
  var slateHost = typeof TK_useSlateTaskHost === "function" ? TK_useSlateTaskHost() : "drawer";
  var slatePane = typeof TK_useSlatePaneEl === "function" ? TK_useSlatePaneEl() : null;

  if (!drawerId || schema !== "ok") return null;
  if (slateHost === "none") return null;
  if (slateHost === "pane") {
    if (!slatePane || typeof TK_SlatePaneTask !== "function") return null;
    return ReactDOM.createPortal(
      <TK_SlatePaneTask
        taskId={drawerId}
        onClose={close}
        focusField={focusField}
        staffUser={p.staffUser}
        clients={p.clients}
        isAdmin={p.isAdmin}
        canManageTemplates={p.canManageTemplates}
        canCreateTemplates={p.canCreateTemplates}
        onOpenTemplates={p.onOpenTemplates}
      />,
      slatePane,
    );
  }
  return (
    <TK_Drawer
      taskId={drawerId}
      onClose={close}
      focusField={focusField}
      staffUser={p.staffUser}
      clients={p.clients}
      isAdmin={p.isAdmin}
      canManageTemplates={p.canManageTemplates}
      canCreateTemplates={p.canCreateTemplates}
      onOpenTemplates={p.onOpenTemplates}
    />
  );
}

// ---- Small pieces -----------------------------------------------------------

// A menu button with role="menu". Esc closes it (capture on document, after
// the drawer's own handler stands down for an open menu).
function TK_dwMenu(props) {
  var p = props;
  var pair = React.useState(false);
  var openState = pair[0];
  var setOpen = pair[1];
  var btnRef = React.useRef(null);
  var menuRef = React.useRef(null);
  var menuId = React.useRef("tk-dw-menu-" + Math.random().toString(36).slice(2, 8)).current;

  React.useEffect(function () {
    if (!openState) return undefined;
    var first = menuRef.current && menuRef.current.querySelector('[role="menuitem"]:not([disabled])');
    if (first) first.focus();
    var onDown = function (e) {
      if (menuRef.current && menuRef.current.contains(e.target)) return;
      if (btnRef.current && btnRef.current.contains(e.target)) return;
      setOpen(false);
    };
    var onKey = function (e) {
      if (e.key === "Escape" || e.key === "Tab") {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          if (btnRef.current) btnRef.current.focus();
        }
        setOpen(false);
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        var items = menuRef.current ? Array.prototype.slice.call(menuRef.current.querySelectorAll('[role="menuitem"]:not([disabled])')) : [];
        if (!items.length) return;
        e.preventDefault();
        var i = items.indexOf(document.activeElement);
        var next = e.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
        items[next].focus();
      }
    };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("touchstart", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return function () {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("touchstart", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [openState]);

  var items = (p.items || []).filter(Boolean);
  if (!items.length) return null;
  return (
    <div className="tk-dw-menu-wrap">
      <button
        type="button"
        ref={btnRef}
        className="tk-dw-icon-btn"
        aria-haspopup="menu"
        aria-expanded={openState ? "true" : "false"}
        aria-controls={openState ? menuId : undefined}
        aria-label={p.label}
        title={p.label}
        disabled={p.disabled}
        onClick={function () { setOpen(!openState); }}
      >
        {p.icon || "⋯"}
      </button>
      {openState && (
        <div className="tk-dw-menu" role="menu" id={menuId} ref={menuRef} aria-label={p.label}>
          {items.map(function (it) {
            return (
              <button
                key={it.key}
                type="button"
                role="menuitem"
                className={"tk-dw-menu-item" + (it.danger ? " is-danger" : "")}
                disabled={it.disabled}
                onClick={function () {
                  setOpen(false);
                  if (btnRef.current) btnRef.current.focus();
                  it.onSelect();
                }}
              >
                {it.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---- The modal drawer (chrome around TK_DrawerContent) -----------------------
// The layer, the scrim, the dialog, the Tab trap, Esc, the body scroll lock and
// focus return to the opener. Everything inside the panel is TK_DrawerContent
// (TK_DrawerContent.jsx), which the Desk's task view reuses without this chrome.

function TK_Drawer(props) {
  var p = props || {};
  var panelRef = React.useRef(null);
  var restoreRef = React.useRef(null);
  var onCloseRef = React.useRef(p.onClose);
  onCloseRef.current = p.onClose;
  // The content's "will you eat this Esc" check (an open SOP panel).
  var escRef = React.useRef(null);
  var registerEsc = React.useCallback(function (fn) { escRef.current = fn || null; }, []);

  // ---- focus: into the panel on open, back to the opener on close
  React.useEffect(function () {
    var active = document.activeElement;
    restoreRef.current = active && active !== document.body ? active : null;
    if (panelRef.current) panelRef.current.focus();
    try { document.body.classList.add("tk-drawer-open"); } catch (e) {}
    return function () {
      try { document.body.classList.remove("tk-drawer-open"); } catch (e) {}
      var prev = restoreRef.current;
      setTimeout(function () {
        if (prev && document.contains(prev) && typeof prev.focus === "function") {
          try { prev.focus(); } catch (e) {}
        }
      }, 0);
    };
  }, []);

  // ---- keys: Esc and the Tab trap (capture, on document); x s a ? live in
  // TK_DrawerContent (bubble)
  React.useEffect(function () {
    var onCapture = function (e) {
      if (e.key !== "Escape" && e.key !== "Tab") return;
      var panel = panelRef.current;
      if (!panel) return;
      // A layer above the drawer handles its own keys.
      if (document.querySelector(".modal-overlay")) return;
      if (document.querySelector(".tour-root")) return;
      if (TK_dwMenuOpen(panel)) return;
      if (e.key === "Escape") {
        // Text fields handle Esc themselves (revert, close a list, or blur).
        if (panel.contains(e.target) && TK_dwIsTyping(e.target) && e.target.tagName.toLowerCase() !== "select") return;
        e.preventDefault();
        e.stopPropagation();
        if (escRef.current && escRef.current()) return;
        onCloseRef.current();
        return;
      }
      var items = TK_dwFocusables(panel);
      var active = document.activeElement;
      if (!items.length) {
        e.preventDefault();
        panel.focus();
        return;
      }
      var first = items[0];
      var last = items[items.length - 1];
      if (!panel.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onCapture, true);
    return function () { document.removeEventListener("keydown", onCapture, true); };
  }, []);

  var frame = function (inner, after, info) {
    return TK_dwPortal(
      <div className="tk-dw-layer">
        <div className="tk-dw-scrim" onClick={function () { p.onClose(); }} aria-hidden="true" />
        <aside
          className="tk-dw"
          role="dialog"
          aria-modal="true"
          aria-label={info.label}
          data-tk-keyscope="drawer"
          tabIndex={-1}
          ref={panelRef}
        >
          {inner}
        </aside>
        {after}
      </div>,
    );
  };

  if (typeof TK_DrawerContent !== "function") return null;
  return (
    <TK_DrawerContent
      taskId={p.taskId}
      mode="drawer"
      scopeRef={panelRef}
      frame={frame}
      registerEsc={registerEsc}
      onClose={p.onClose}
      focusField={p.focusField}
      staffUser={p.staffUser}
      clients={p.clients}
      isAdmin={p.isAdmin}
      canManageTemplates={p.canManageTemplates}
      canCreateTemplates={p.canCreateTemplates}
      onOpenTemplates={p.onOpenTemplates}
    />
  );
}
