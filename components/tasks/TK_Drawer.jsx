// ----------------------------------------------------------------------------
// Tasks module, drawer slice (docs/tasks-phase1-spec.md C7, rows 1.1, 1.3,
// 2.1, 2.3, 2.6, 3.6, N.4).
//
//   TK_openTask(id, { from, focus })   open a task in the drawer, or fall back
//                                      to the legacy Work › Tasks page
//   TK_openTaskClick(id)               onClick for <a href={LK_href(task)}>
//   TK_DrawerHost(props)               mounted once by App; owns the drawer
//   TK_Drawer(props)                   the side panel itself
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

function TK_openTask(id, opts) {
  if (id == null || id === "") return;
  var o = opts || {};
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
      open(a.id, null);
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

  if (!drawerId || schema !== "ok") return null;
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

function TK_dwConfirm(props) {
  var p = props;
  var hasModal = typeof ConfirmModal === "function";
  // ConfirmModal not loaded (should not happen in the app): a plain confirm.
  React.useEffect(function () {
    if (hasModal) return;
    var ok = window.confirm(p.title + "\n\n" + p.body);
    if (ok) p.onConfirm();
    else p.onCancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!hasModal) return null;
  return TK_dwPortal(
    <ConfirmModal title={p.title} body={p.body} confirmLabel={p.confirmLabel} onConfirm={p.onConfirm} onCancel={p.onCancel} />,
  );
}

// Send back from ready_for_review needs a reason (tasks p2 s3: 3-2000
// characters, tk_send_back). It goes to the assignee by email and on the task.
function TK_dwSendBack(props) {
  var p = props;
  var pair = React.useState("");
  var note = pair[0];
  var setNote = pair[1];
  var triedPair = React.useState(false);
  var tried = triedPair[0];
  var setTried = triedPair[1];
  if (typeof ModalShell !== "function") return null;
  var errKey = typeof TK_sendBackReasonError === "function" ? TK_sendBackReasonError(note) : note.trim().length < 3 ? "reasonRequired" : null;
  var submit = function () {
    if (errKey) {
      setTried(true);
      return;
    }
    p.onConfirm(note.trim());
  };
  return TK_dwPortal(
    <ModalShell onClose={p.onCancel} labelledBy="tk-dw-sendback-title" className="tk-dw-modal">
      <div className="modal-header">
        <h3 className="card-title" id="tk-dw-sendback-title" style={{ margin: 0 }}>
          Send back
        </h3>
        <button type="button" className="modal-close" onClick={p.onCancel} aria-label="Close">
          ×
        </button>
      </div>
      <div className="modal-body">
        <label className="tk-dw-label" htmlFor="tk-dw-sendback-note">
          What needs another look?
        </label>
        <textarea
          id="tk-dw-sendback-note"
          className="tk-dw-textarea"
          rows={3}
          maxLength={2000}
          value={note}
          aria-invalid={tried && errKey ? "true" : undefined}
          aria-describedby="tk-dw-sendback-help"
          onChange={function (e) { setNote(e.target.value); }}
        />
        <p id="tk-dw-sendback-help" role={tried && errKey ? "alert" : undefined} className={"tk-dw-hint" + (tried && errKey ? " tk-field-error" : "")}>
          {tried && errKey
            ? TK_dwCopy(errKey, "Add a short note on what needs another look.")
            : "They see this note in the task's comments, and by email if their task emails are on."}
        </p>
      </div>
      <div className="modal-footer">
        <button type="button" className="btn-secondary" onClick={p.onCancel}>
          Cancel
        </button>
        <button type="button" className="btn-primary" onClick={submit}>
          Send back
        </button>
      </div>
    </ModalShell>,
  );
}

// The review strip (tasks p2 s3). In review: who reviews it, how long it has
// waited, and Approve / Send back (an admin who isn't the assignee or the
// submitter) or Take back (the assignee or submitter). Before review, admins
// can name the reviewer (blank = the default picked on submit).
function TK_dwReview(props) {
  var p = props;
  var task = p.task;
  var staff = p.staff || [];
  if (!task || task.deleted_at) return null;
  var status = TK_dwEffectiveStatus(task);
  var inReview = status === "ready_for_review";
  if (!inReview && !(task.review_required && p.isAdmin && status !== "done")) return null;
  var role = typeof TK_reviewRole === "function" ? TK_reviewRole(task, { me: p.me, isAdmin: p.isAdmin }) : {};
  var reviewerName = task.reviewer_email ? TK_dlNameOf(task.reviewer_email, staff) : "any admin";
  var wait = inReview && typeof TK_reviewWaitLabel === "function" ? TK_reviewWaitLabel(task) : "";
  // Owner fallback on purpose (S8b): an Unassigned task's owner can't review it either.
  var assignee = TK_dwLower(task.assignee_email || task.staff_email);
  // tk_set_reviewer refuses the assignee, and the submitter while in review.
  var submitter = inReview ? TK_dwLower(task.submitted_by) : "";
  var admins = staff.filter(function (s) {
    var em = s ? TK_dwLower(s.email) : "";
    return s && s.active !== false && s.role === "admin" && em !== assignee && (!submitter || em !== submitter);
  });
  var picker = p.isAdmin && !p.readOnly && (
    <label className="tk-dw-review-pick">
      <span>Reviewer</span>
      <select
        className="tk-dw-select"
        aria-label="Reviewer"
        value={task.reviewer_email || ""}
        onChange={function (e) { p.onSetReviewer(e.target.value || null); }}
      >
        <option value="">{inReview ? "Any admin" : "Default (picked when sent)"}</option>
        {admins.map(function (s) {
          return (
            <option key={s.email} value={TK_dwLower(s.email)}>
              {s.name || s.email}
            </option>
          );
        })}
      </select>
    </label>
  );
  if (!inReview) {
    return (
      <div className="tk-dw-review" data-tour="tk-review-strip">
        <span className="tk-dw-review-text">Needs review before it's done.</span>
        {picker}
      </div>
    );
  }
  return (
    <div className="tk-dw-review is-waiting" role="status" data-tour="tk-review-strip">
      <div className="tk-dw-review-text">
        <strong>Waiting for review</strong>
        <span>{" · Reviewer: " + reviewerName}</span>
        {wait ? <span>{" · " + wait}</span> : null}
        {task.send_back_count > 0 ? (
          <span>{" · Sent back " + task.send_back_count + (task.send_back_count === 1 ? " time" : " times")}</span>
        ) : null}
      </div>
      {role.blockedReason ? <p className="tk-dw-hint">{TK_dwCopy(role.blockedReason, "Another admin will review it.")}</p> : null}
      <div className="tk-dw-review-actions">
        {role.canApprove && !p.readOnly && (
          <button type="button" className="btn-primary tk-dw-btn-sm" onClick={p.onApprove}>
            Approve
          </button>
        )}
        {role.canSendBack && !p.readOnly && (
          <button type="button" className="btn-secondary tk-dw-btn-sm" onClick={p.onSendBack}>
            Send back
          </button>
        )}
        {(role.isAssignee || role.isSubmitter) && !p.readOnly && (
          <button type="button" className="btn-secondary tk-dw-btn-sm" onClick={p.onWithdraw}>
            Take back
          </button>
        )}
        {picker}
      </div>
    </div>
  );
}

// The shortcuts sheet: the views slice's TK_KeysSheet, or a plain list.
function TK_dwKeys(props) {
  var p = props;
  if (typeof TK_KeysSheet === "function") return TK_dwPortal(<TK_KeysSheet onClose={p.onClose} />);
  if (typeof ModalShell !== "function") return null;
  var keys = typeof TK_KEYMAP !== "undefined" && TK_KEYMAP ? TK_KEYMAP : [];
  return TK_dwPortal(
    <ModalShell onClose={p.onClose} labelledBy="tk-dw-keys-title" className="tk-dw-modal">
      <div className="modal-header">
        <h3 className="card-title" id="tk-dw-keys-title" style={{ margin: 0 }}>
          Keyboard shortcuts
        </h3>
        <button type="button" className="modal-close" onClick={p.onClose} aria-label="Close">
          ×
        </button>
      </div>
      <div className="modal-body">
        <dl className="tk-dw-keys">
          {keys.map(function (k) {
            return (
              <div key={k.key} className="tk-dw-keys-row">
                <dt>
                  <kbd>{k.display || k.key}</kbd>
                </dt>
                <dd>{k.label}</dd>
              </div>
            );
          })}
        </dl>
      </div>
    </ModalShell>,
  );
}

// The status control: the views slice's TK_StatusPill, or a select.
function TK_dwStatus(props) {
  var p = props;
  var task = p.task;
  if (typeof TK_StatusPill === "function") {
    return <TK_StatusPill task={task} isAdmin={p.isAdmin} canEdit={p.canEdit} onChange={p.onChange} />;
  }
  var cur = TK_dwEffectiveStatus(task);
  var next = typeof TK_nextStatuses === "function" ? TK_nextStatuses(task, { isAdmin: p.isAdmin }) : [];
  return (
    <select
      className={"tk-dw-status-select tk-st-" + cur}
      aria-label="Status"
      value=""
      disabled={!p.canEdit || !next.length}
      onChange={function (e) {
        if (e.target.value) p.onChange(e.target.value);
      }}
    >
      <option value="">{TK_dwStatusLabel(cur)}</option>
      {next.map(function (n) {
        return (
          <option key={n.status + n.label} value={n.status}>
            {n.label}
          </option>
        );
      })}
    </select>
  );
}

// Bookkeeper, Backup and Account Manager chips (1.1). Cached for the session,
// so an offline drawer still shows them.
var TK_dwPeopleCache = {};
var TK_DW_ROLE_LABELS = { bookkeeper: "Bookkeeper", backup: "Backup", account_manager: "Account Manager", reviewer: "Reviewer" };

function TK_dwPeople(props) {
  var p = props;
  var id = p.clientId ? String(p.clientId) : "";
  var pair = React.useState(function () { return TK_dwPeopleCache[id] || null; });
  var rows = pair[0];
  var setRows = pair[1];
  React.useEffect(function () {
    if (!id) return undefined;
    if (TK_dwPeopleCache[id]) {
      setRows(TK_dwPeopleCache[id]);
      return undefined;
    }
    var live = true;
    setRows(null);
    var api = TK_dwApi();
    if (!api || typeof api.clientPeople !== "function") {
      setRows([]);
      return undefined;
    }
    Promise.resolve()
      .then(function () { return api.clientPeople(id); })
      .then(
        function (list) {
          var clean = (list || []).filter(function (r) { return r && r.email; });
          TK_dwPeopleCache[id] = clean;
          if (live) setRows(clean);
        },
        function () {
          if (live) setRows([]);
        },
      );
    return function () { live = false; };
  }, [id]);

  if (!id) return null;
  if (rows === null) {
    return (
      <div className="tk-dw-people" aria-hidden="true">
        <span className="tk-dw-chip tk-dw-chip-ph" />
        <span className="tk-dw-chip tk-dw-chip-ph" />
      </div>
    );
  }
  if (!rows.length && !p.reviewRequired) return null;
  return (
    <div className="tk-dw-people" aria-label="People on this client">
      {rows.map(function (r) {
        var name = r.name || TK_dlNameOf(r.email, p.staff);
        return (
          <span key={r.role + r.email} className="tk-dw-chip" title={name}>
            <span className="tk-dw-avatar tk-dw-avatar-sm" aria-hidden="true">
              {TK_dlInitials(r.name, r.email)}
            </span>
            <span className="tk-dw-chip-role">{TK_DW_ROLE_LABELS[r.role] || r.role}</span>
            <span className="tk-dw-chip-name">{name}</span>
          </span>
        );
      })}
      {p.reviewRequired && !rows.some(function (r) { return r.role === "reviewer"; }) && (
        <span className="tk-dw-chip tk-dw-chip-note">Reviewer: any admin</span>
      )}
    </div>
  );
}

// Subtasks (parent_id) as compact rows, plus "Add subtask".
function TK_dwSubtasks(props) {
  var p = props;
  var task = p.task;
  var key = "children:" + task.id;
  var list = TK_dwUseStore(function (s) {
    if (typeof TK_selectList === "function") return TK_selectList(s, key);
    return s.lists ? s.lists[key] : null;
  });
  var tasks = list && Array.isArray(list.tasks) ? list.tasks : [];
  var loadPair = React.useState("idle");
  var load = loadPair[0];
  var setLoad = loadPair[1];
  var addPair = React.useState(null);
  var adding = addPair[0];
  var setAdding = addPair[1];
  var busyPair = React.useState(false);
  var busy = busyPair[0];
  var setBusy = busyPair[1];

  var reload = React.useCallback(function () {
    var api = TK_dwApi();
    if (!api || typeof api.listChildren !== "function") return;
    setLoad(function (l) { return l === "idle" ? "loading" : l; });
    Promise.resolve()
      .then(function () { return api.listChildren(task.id); })
      .then(
        function (rows) {
          TK_dwDispatch({ type: "listLoaded", key: key, tasks: rows || [] });
          setLoad("ok");
        },
        function () {
          setLoad("error");
        },
      );
  }, [task.id]);

  React.useEffect(function () {
    setLoad("idle");
    setAdding(null);
    reload();
  }, [task.id]);

  var submit = function () {
    var text = String(adding || "").trim();
    if (!text || busy) return;
    var api = TK_dwApi();
    if (!api) return;
    setBusy(true);
    api
      .create({
        text: text,
        parent_id: task.id,
        client_id: task.client_id || null,
        project_id: task.project_id || null,
        section: task.section || null,
        // S8b: an Unassigned parent's subtask goes to whoever adds it.
        assignee_email: task.assignee_email || null,
        visibility: task.visibility,
      })
      .then(
        function () {
          setBusy(false);
          setAdding("");
          reload();
        },
        function (e) {
          setBusy(false);
          TK_dwSaveError(e);
        },
      );
  };

  var today = TK_dwToday();
  var showAdd = p.canAdd && !p.readOnly;
  if (!tasks.length && !showAdd && load !== "loading") return null;
  return (
    <section className="tk-dw-section" aria-labelledby="tk-dw-sub-h">
      <h3 className="tk-dw-h" id="tk-dw-sub-h">
        Subtasks
        {tasks.length > 0 && (
          <span className="tk-dw-count">
            {tasks.filter(function (t) { return !TK_dwIsOpen(t); }).length} of {tasks.length}
          </span>
        )}
      </h3>
      {load === "loading" && !tasks.length && <div className="tk-dw-skel tk-dw-skel-row" aria-hidden="true" />}
      {load === "error" && !tasks.length && (
        <p className="tk-dw-muted">
          Couldn't load subtasks.{" "}
          <button type="button" className="link-btn" onClick={reload}>
            Try again
          </button>
        </p>
      )}
      {tasks.length > 0 && (
        <ul className="tk-dw-subtasks">
          {tasks.map(function (t) {
            if (typeof TK_TaskRow === "function") {
              return (
                <TK_TaskRow
                  key={t.id}
                  task={t}
                  today={today}
                  showClient={false}
                  isAdmin={p.isAdmin}
                  canEdit={!p.readOnly}
                  onOpen={function (id) { TK_openTask(id, { from: "subtask" }); }}
                  onToggleDone={function (row) {
                    var api = TK_dwApi();
                    if (api) api.complete(row, { done: TK_dwIsOpen(row), isAdmin: p.isAdmin }).catch(TK_dwSaveError);
                  }}
                  onStatus={function (row, status) {
                    var api = TK_dwApi();
                    if (api) api.setStatus(row.id, status).catch(TK_dwSaveError);
                  }}
                />
              );
            }
            var done = !TK_dwIsOpen(t);
            return (
              <li key={t.id} className={"tk-dw-subrow" + (done ? " is-done" : "")}>
                <input
                  type="checkbox"
                  checked={done}
                  disabled={p.readOnly}
                  aria-label={(done ? "Mark not done: " : "Mark done: ") + t.text}
                  onChange={function () {
                    var api = TK_dwApi();
                    if (api) api.complete(t, { done: !done, isAdmin: p.isAdmin }).catch(TK_dwSaveError);
                  }}
                />
                <a href={TK_dwTaskHref(t.id)} onClick={TK_openTaskClick(t.id)} className="tk-dw-subrow-title">
                  {t.text}
                </a>
              </li>
            );
          })}
        </ul>
      )}
      {showAdd &&
        (adding === null ? (
          <button type="button" className="link-btn tk-dw-add" onClick={function () { setAdding(""); }}>
            + Add subtask
          </button>
        ) : (
          <div className="tk-dw-inline-add">
            <input
              type="text"
              className="tk-dw-input"
              aria-label="New subtask"
              placeholder="What needs doing?"
              maxLength={500}
              autoFocus
              value={adding}
              disabled={busy}
              onChange={function (e) { setAdding(e.target.value); }}
              onKeyDown={function (e) {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submit();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  setAdding(null);
                }
              }}
            />
            <button type="button" className="btn-primary tk-dw-btn-sm" disabled={busy || !String(adding).trim()} onClick={submit}>
              Add
            </button>
            <button type="button" className="btn-secondary tk-dw-btn-sm" onClick={function () { setAdding(null); }}>
              Cancel
            </button>
          </div>
        ))}
    </section>
  );
}

// Followers footer (2.6).
function TK_dwFollowers(props) {
  var p = props;
  var task = p.task;
  var api = TK_dwApi();
  var f = TK_dwUseRows(
    "f",
    task.id,
    function () { return api ? api.listFollowers(task.id) : []; },
    { tables: ["tk_followers"], stamp: task.assignee_email || "" },
  );
  var busyPair = React.useState(false);
  var busy = busyPair[0];
  var setBusy = busyPair[1];
  var rows = f.rows || [];
  var me = p.me;
  var following = rows.some(function (r) { return TK_dwLower(r.staff_email) === me; });
  var stack = TK_dlFollowerStack(rows, 5);
  var names = rows.map(function (r) { return p.nameOf(r.staff_email); });

  var toggle = function () {
    if (!api || busy) return;
    setBusy(true);
    var run = following ? api.unfollow(task.id) : api.follow(task.id);
    Promise.resolve(run).then(
      function () {
        setBusy(false);
        f.reload();
      },
      function (e) {
        setBusy(false);
        TK_dwSaveError(e);
      },
    );
  };

  var add = function (email) {
    if (!api || !email) return;
    setBusy(true);
    api.addFollower(task.id, email).then(
      function () {
        setBusy(false);
        f.reload();
      },
      function (e) {
        setBusy(false);
        var why = (e && (e.reason || e.code)) || "";
        if (why === "tk_follower_no_access") TK_dwToast("They can't see this task's client or project.");
        else TK_dwSaveError(e);
      },
    );
  };

  var candidates = (p.staff || []).filter(function (s) {
    var em = TK_dwLower(s.email);
    return em && s.active !== false && !rows.some(function (r) { return TK_dwLower(r.staff_email) === em; });
  });

  return (
    <footer className="tk-dw-foot">
      <div className="tk-dw-followers" aria-label={rows.length ? "Followers: " + names.join(", ") : "No followers yet"}>
        {stack.shown.map(function (r) {
          var name = p.nameOf(r.staff_email);
          var staffRow = (p.staff || []).filter(function (s) { return TK_dwLower(s.email) === TK_dwLower(r.staff_email); })[0];
          return (
            <span key={r.staff_email} className="tk-dw-avatar" title={name} aria-hidden="true">
              {TK_dlInitials(staffRow ? staffRow.name : "", r.staff_email)}
            </span>
          );
        })}
        {stack.extra > 0 && (
          <span className="tk-dw-avatar tk-dw-avatar-more" title={names.slice(5).join(", ")} aria-hidden="true">
            +{stack.extra}
          </span>
        )}
        {!rows.length && !f.loading && <span className="tk-dw-muted">No followers yet</span>}
      </div>
      {/* A deleted task can't be followed or given followers; Restore first. */}
      {!p.deleted && (
      <div className="tk-dw-foot-actions">
        <button
          type="button"
          className={"btn-secondary tk-dw-btn-sm" + (following ? " is-on" : "")}
          aria-pressed={following ? "true" : "false"}
          disabled={busy || !p.online}
          onClick={toggle}
        >
          {following ? "Following ✓" : "Follow"}
        </button>
        {p.canEdit && !p.deleted && candidates.length > 0 && (
          <select
            className="tk-dw-select tk-dw-follow-add"
            aria-label="Add follower"
            value=""
            disabled={busy || !p.online}
            onChange={function (e) { add(e.target.value); }}
          >
            <option value="">Add follower</option>
            {candidates.map(function (s) {
              return (
                <option key={s.email} value={TK_dwLower(s.email)}>
                  {s.name || TK_dlHandle(s.email)}
                </option>
              );
            })}
          </select>
        )}
      </div>
      )}
    </footer>
  );
}

// "View SOP section" slide-over inside the drawer (1.3).
function TK_dwSopPanel(props) {
  var p = props;
  var backRef = React.useRef(null);
  React.useEffect(function () {
    if (backRef.current) backRef.current.focus();
  }, []);
  var enc = encodeURIComponent(String(p.client.id));
  var sections = typeof CLIENT_SOP_SECTIONS !== "undefined" && CLIENT_SOP_SECTIONS ? CLIENT_SOP_SECTIONS : [];
  var meta = sections.filter(function (s) { return s.id === p.section; })[0];
  return (
    <div className="tk-dw-sop" role="region" aria-label="SOP section">
      <div className="tk-dw-sop-head">
        <button type="button" ref={backRef} className="link-btn tk-dw-back" onClick={p.onClose}>
          {"←"} Back to task
        </button>
        <a
          className="link-btn"
          href={"#/client/" + enc + "/sop"}
          onClick={function () { p.onLeave(); }}
        >
          Open full SOP
        </a>
      </div>
      <h3 className="tk-dw-h">{meta ? meta.title : "SOP section"}</h3>
      <div className="tk-dw-sop-body">
        {typeof ClientSopView === "function" ? (
          <ClientSopView client={p.client} readOnly section={p.section} />
        ) : (
          <p className="tk-dw-muted">Nothing written for this section yet.</p>
        )}
      </div>
    </div>
  );
}

// Auto-growing textarea for the title.
function TK_dwAutoGrow(el) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = el.scrollHeight + "px";
}

// ---- The drawer -------------------------------------------------------------

var TK_DW_RECURRENCES = [
  ["none", "Doesn't repeat"],
  ["daily", "Daily"],
  ["weekly", "Weekly"],
  ["monthly", "Monthly"],
  ["month_end", "Month end"],
];

function TK_Drawer(props) {
  var p = props || {};
  var taskId = p.taskId;
  var staffUser = p.staffUser || {};
  var me = TK_dwLower(staffUser.email);
  var isAdmin = !!p.isAdmin;
  var clients = Array.isArray(p.clients) ? p.clients : [];

  var task = TK_dwUseStore(function (s) { return (s.tasks && s.tasks[taskId]) || null; });
  var projects = TK_dwUseStore(function (s) { return s.projects; });
  var online = TK_dwUseOnline();
  var staff = TK_dwUseStaff();
  var nameOf = React.useMemo(function () { return TK_dwNameFn(staff); }, [staff]);

  var loadPair = React.useState("loading");
  var load = loadPair[0];
  var setLoad = loadPair[1];
  var tabPair = React.useState(function () { return TK_dwIsPhone() ? "comments" : "all"; });
  var tab = tabPair[0];
  var setTab = tabPair[1];
  var sopPair = React.useState(false);
  var sopOpen = sopPair[0];
  var setSopOpen = sopPair[1];
  var modalPair = React.useState(null); // "delete" | "sendback" | "keys"
  var modal = modalPair[0];
  var setModal = modalPair[1];
  var titlePair = React.useState("");
  var title = titlePair[0];
  var setTitle = titlePair[1];
  var descPair = React.useState("");
  var desc = descPair[0];
  var setDesc = descPair[1];
  var sectionPair = React.useState("");
  var sectionDraft = sectionPair[0];
  var setSectionDraft = sectionPair[1];
  var assignPair = React.useState(null);
  var assignable = assignPair[0];
  var setAssignable = assignPair[1];
  // Open out-of-office hand-offs (Tasks Phase 2 S7; Coverage.jsx).
  var coverRows = typeof CV_useMyCoverage === "function" ? CV_useMyCoverage() : [];

  var panelRef = React.useRef(null);
  var titleRef = React.useRef(null);
  var assigneeRef = React.useRef(null);
  var restoreRef = React.useRef(null);
  var onCloseRef = React.useRef(p.onClose);
  onCloseRef.current = p.onClose;
  var sopOpenRef = React.useRef(sopOpen);
  sopOpenRef.current = sopOpen;
  var taskRef = React.useRef(task);
  taskRef.current = task;

  // ---- load
  var fetchTask = React.useCallback(function () {
    var api = TK_dwApi();
    if (!api) {
      setLoad("error");
      return;
    }
    setLoad(function (l) { return l === "ok" ? "ok" : "loading"; });
    api.get(taskId).then(
      function (t) {
        if (t) {
          TK_dwDispatch({ type: "upsert", task: t });
          setLoad("ok");
        } else setLoad("missing");
      },
      function (e) {
        var code = e && e.code;
        if (code === "tk_forbidden" || code === "tk_not_found" || code === "22P02") setLoad("missing");
        else setLoad("error");
      },
    );
  }, [taskId]);

  React.useEffect(function () {
    setLoad("loading");
    setSopOpen(false);
    setModal(null);
    fetchTask();
  }, [taskId]);

  // Gone from the store after it loaded (realtime said we can't see it):
  // ask again, which ends in "missing" when it really is gone.
  var hadTask = React.useRef(false);
  React.useEffect(function () {
    if (task) hadTask.current = true;
    else if (hadTask.current && load === "ok") {
      hadTask.current = false;
      fetchTask();
    }
  }, [!!task]);

  React.useEffect(function () {
    if (load !== "missing") return;
    TK_dwToast(
      typeof LK_COPY !== "undefined" && LK_COPY && LK_COPY.taskMissing
        ? LK_COPY.taskMissing
        : "That task isn't there anymore, or it's private to someone else.",
    );
    onCloseRef.current();
  }, [load]);

  // ---- drafts follow the server value unless the field is being edited
  React.useEffect(function () {
    if (!task) return;
    if (document.activeElement !== titleRef.current) setTitle(task.text || "");
  }, [task && task.text, taskId]);
  React.useEffect(function () {
    if (!task) return;
    var el = document.getElementById("tk-dw-desc");
    if (document.activeElement !== el) setDesc(task.description || "");
  }, [task && task.description, taskId]);
  React.useEffect(function () {
    if (!task) return;
    var el = document.getElementById("tk-dw-section");
    if (document.activeElement !== el) setSectionDraft(task.section || "");
  }, [task && task.section, taskId]);
  React.useEffect(function () {
    TK_dwAutoGrow(titleRef.current);
  }, [title, load]);

  // ---- assignable people for this client or project
  var clientId = task ? task.client_id : null;
  var projectId = task ? task.project_id : null;
  React.useEffect(function () {
    setAssignable(null);
    var api = TK_dwApi();
    if (!api || typeof api.assignable !== "function" || !task) return undefined;
    var live = true;
    api.assignable({ clientId: clientId, projectId: projectId }).then(
      function (rows) { if (live) setAssignable(rows || []); },
      function () { if (live) setAssignable([]); },
    );
    return function () { live = false; };
  }, [taskId, clientId, projectId, !!task]);

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

  React.useEffect(function () {
    if (p.focusField === "assignee" && load === "ok" && assigneeRef.current) assigneeRef.current.focus();
  }, [p.focusField, load, taskId]);

  // ---- permissions
  var projectList = Array.isArray(projects) ? projects : [];
  var project = projectId ? projectList.filter(function (x) { return x && x.id === projectId; })[0] || null : null;
  var client = clientId ? clients.filter(function (c) { return c && String(c.id) === String(clientId); })[0] || null : null;
  var canEdit = false;
  if (task) {
    if (typeof TK_canEdit === "function") {
      canEdit = TK_canEdit(task, {
        email: me,
        isAdmin: isAdmin,
        canSeeClient: function (id) { return clients.some(function (c) { return c && String(c.id) === String(id); }); },
        isMember: function (id) { return projectList.some(function (x) { return x && x.id === id; }); },
      });
    } else {
      canEdit = isAdmin || TK_dwLower(task.staff_email) === me || TK_dwLower(task.assignee_email) === me;
    }
  }
  var isOwner = !!task && TK_dwLower(task.staff_email) === me;
  var deleted = !!(task && task.deleted_at);
  var readOnly = !task || deleted || !canEdit || !online;
  var canAssign = !readOnly && (isOwner || isAdmin);

  // ---- saving
  var save = React.useCallback(function (draft, opts) {
    var t = taskRef.current;
    var api = TK_dwApi();
    if (!t || !api) return Promise.resolve(null);
    var patch = TK_buildPatch(t, draft);
    if (!Object.keys(patch).length) return Promise.resolve(t);
    var check = {};
    Object.keys(patch).forEach(function (k) { check[k] = patch[k]; });
    if ("start_on" in patch || "due_date" in patch) {
      check.start_on = "start_on" in patch ? patch.start_on : t.start_on;
      check.due_date = "due_date" in patch ? patch.due_date : t.due_date;
    }
    if ("recurrence" in patch) check.due_date = "due_date" in patch ? patch.due_date : t.due_date;
    var errs = TK_validateDraft(check);
    var firstErr = Object.keys(errs)[0];
    if (firstErr) {
      TK_dwToast(errs[firstErr]);
      return Promise.resolve(null);
    }
    return api
      .update(t.id, patch, { optimistic: true, baseUpdatedAt: opts && opts.base ? t.updated_at : null })
      .catch(function (e) {
        TK_dwSaveError(e);
        return null;
      });
  }, []);

  var setStatus = function (status) {
    var t = taskRef.current;
    var api = TK_dwApi();
    if (!t || !api || readOnly) return;
    var cur = TK_dwEffectiveStatus(t);
    if (status === cur) return;
    if (cur === "ready_for_review") {
      var role = typeof TK_reviewRole === "function" ? TK_reviewRole(t, { me: me, isAdmin: isAdmin }) : {};
      if (status === "in_progress" && role.canSendBack) {
        setModal("sendback");
        return;
      }
      if (status === "in_progress" && typeof api.withdraw === "function") {
        api.withdraw(t.id).catch(TK_dwReviewError);
        return;
      }
      if (status === "done" && typeof api.approve === "function") {
        api.approve(t.id).catch(TK_dwReviewError);
        return;
      }
    }
    if (status === "done") {
      api.complete(t, { done: true, isAdmin: isAdmin }).catch(TK_dwSaveError);
      return;
    }
    api.setStatus(t.id, status).catch(TK_dwSaveError);
  };

  var toggleDone = function () {
    var t = taskRef.current;
    var api = TK_dwApi();
    if (!t || !api || readOnly) return;
    api.complete(t, { done: TK_dwIsOpen(t), isAdmin: isAdmin }).catch(TK_dwSaveError);
  };

  var copyLink = function () {
    var url = window.location.origin + "/" + TK_dwTaskHref(taskId);
    var done = function () { TK_dwToast(TK_dwCopy("linkCopied", "Link copied.")); };
    var fail = function () { TK_dwToast("Couldn't copy the link."); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(done, fail);
        return;
      }
    } catch (e) {}
    try {
      var ta = document.createElement("textarea");
      ta.value = url;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(ta);
      if (ok) done();
      else fail();
    } catch (e) {
      fail();
    }
  };

  var saveAsTemplate = function () {
    var t = taskRef.current;
    if (!t || typeof TT_draftFromTask !== "function") return;
    var sb = typeof window !== "undefined" ? window.mgbSupabase : null;
    if (p.canCreateTemplates && typeof p.onOpenTemplates === "function") {
      Promise.resolve()
        .then(function () { return typeof TCL_fetchTexts === "function" ? TCL_fetchTexts(sb, t.id) : []; })
        .then(function (checklist) {
          if (typeof TT_openDraft === "function") TT_openDraft(TT_draftFromTask(t, { checklist: checklist || [] }));
          p.onClose();
          p.onOpenTemplates();
        })
        .catch(function (e) { TK_dwSaveError(e); });
      return;
    }
    if (typeof TT_suggestFromTask !== "function") return;
    Promise.resolve()
      .then(function () { return TT_suggestFromTask(sb, t); })
      .then(function (res) {
        var r = res || {};
        if (r.duplicate) TK_dwToast("You've already suggested this one. An admin will review it.");
        else if (r.error) TK_dwToast("Couldn't send the suggestion. Try again.");
        else TK_dwToast("Suggested to admins as a recurring template.");
      })
      .catch(function () { TK_dwToast("Couldn't send the suggestion. Try again."); });
  };

  var doDelete = function () {
    setModal(null);
    var api = TK_dwApi();
    if (!api || !task) return;
    // P4-3: remove() raises the toast itself (with Undo on schema 12+).
    api.remove(task.id, { toast: TK_dwCopy("deleted", "Task deleted.") }).then(null, TK_dwSaveError);
  };

  var doRestore = function () {
    var api = TK_dwApi();
    if (!api || !task) return;
    api.restore(task.id).then(
      function () { TK_dwToast(TK_dwCopy("restored", "Task restored.")); },
      TK_dwSaveError,
    );
  };

  // ---- keys: Esc and the Tab trap (capture, on document), x s a ? (bubble)
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
        if (sopOpenRef.current) {
          setSopOpen(false);
          return;
        }
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

  var keyActions = React.useRef({});
  keyActions.current = {
    x: toggleDone,
    s: function () {
      var wrap = panelRef.current && panelRef.current.querySelector("[data-tk-drawer-status]");
      var ctl = wrap && wrap.querySelector("button, select");
      if (!ctl || ctl.disabled) return;
      if (ctl.tagName.toLowerCase() === "select") ctl.focus();
      else ctl.click();
    },
    a: function () {
      if (assigneeRef.current && !assigneeRef.current.disabled) assigneeRef.current.focus();
    },
    "?": function () { setModal("keys"); },
  };

  React.useEffect(function () {
    var onKey = function (e) {
      var k = e.key;
      if (k !== "x" && k !== "s" && k !== "a" && k !== "?") return;
      var ctx = {
        modalOpen: !!document.querySelector(".modal-overlay"),
        menuOpen: TK_dwMenuOpen(document),
        tourOpen: !!document.querySelector(".tour-root"),
        scope: "drawer",
      };
      if (typeof TK_shouldHandleKey === "function") {
        if (!TK_shouldHandleKey(e, ctx)) return;
      } else {
        if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented || e.isComposing) return;
        if (ctx.modalOpen || ctx.menuOpen || ctx.tourOpen) return;
        if (TK_dwIsTyping(e.target)) return;
        var panel = panelRef.current;
        if (e.target !== document.body && !(panel && panel.contains(e.target))) return;
      }
      e.preventDefault();
      TK_dwTrackShortcut(k);
      var fn = keyActions.current[k];
      if (fn) fn();
    };
    window.addEventListener("keydown", onKey);
    return function () { window.removeEventListener("keydown", onKey); };
  }, []);

  // ---- render
  var labelId = "tk-dw-title-" + String(taskId).slice(0, 8);
  var today = TK_dwToday();

  var body;
  if (!task) {
    body =
      load === "error" ? (
        <div className="tk-dw-body">
          <p className="tk-dw-muted">
            {TK_dwCopy("loadError", "Couldn't load your tasks.")}{" "}
            <button type="button" className="link-btn" onClick={fetchTask}>
              {TK_dwCopy("retry", "Try again")}
            </button>
          </p>
        </div>
      ) : (
        <div className="tk-dw-body" aria-busy="true">
          <div className="tk-dw-skel tk-dw-skel-title" />
          <div className="tk-dw-skel" />
          <div className="tk-dw-skel" />
          <div className="tk-dw-skel tk-dw-skel-short" />
        </div>
      );
  }

  var status = task ? TK_dwEffectiveStatus(task) : "todo";
  var containerName = client ? client.name || "Client" : project ? project.name || "Project" : task && task.client_id ? "Client" : task && task.project_id ? "Project" : "";
  var sopSections = typeof CLIENT_SOP_SECTIONS !== "undefined" && CLIENT_SOP_SECTIONS
    ? CLIENT_SOP_SECTIONS
    : (typeof TK_SOP_SECTION_IDS !== "undefined" ? TK_SOP_SECTION_IDS : []).map(function (id) { return { id: id, title: id.replace(/_/g, " ") }; });
  var sectionOptions = [];
  if (task) {
    var used = [];
    var st = TK_dwState();
    if (st && st.tasks) {
      Object.keys(st.tasks).forEach(function (k) {
        var other = st.tasks[k];
        if (!other || !other.section || other.deleted_at) return;
        if ((clientId && String(other.client_id) === String(clientId)) || (projectId && other.project_id === projectId)) used.push(other.section);
      });
    }
    sectionOptions = TK_dlSectionOptions(
      project && Array.isArray(project.sections) ? project.sections : null,
      used,
      clientId && typeof TK_CLIENT_SECTION_ORDER !== "undefined" ? TK_CLIENT_SECTION_ORDER : [],
    );
  }

  var assignees = (assignable || []).slice();
  // S8b: the assignee only; "" is Unassigned (anyone on the client can claim it).
  var curAssignee = task ? TK_dwLower(task.assignee_email) : "";
  var canClaim = !!task && !curAssignee && !deleted && online && ["todo", "in_progress", "waiting_client"].indexOf(status) >= 0;
  if (curAssignee && !assignees.some(function (a) { return TK_dwLower(a.email) === curAssignee; })) {
    assignees.unshift({ email: curAssignee, name: nameOf(curAssignee), can_see: true });
  }
  var curAssigneeRow = assignees.filter(function (a) { return TK_dwLower(a.email) === curAssignee; })[0];
  var assigneeWarn = !!(task && task.client_id && curAssigneeRow && curAssigneeRow.can_see === false);
  var dueTime = task ? TK_dlTimeOf(task.due_at) : "";
  var descLen = desc.length;

  var moreItems = task
    ? [
        typeof TT_draftFromTask === "function" && task.kind !== "note" && !deleted
          ? {
              key: "tpl",
              label: p.canCreateTemplates ? "Save as template" : "Suggest as template",
              onSelect: saveAsTemplate,
              disabled: !online,
            }
          : null,
        (isOwner || canEdit) && !deleted
          ? { key: "del", label: "Delete", danger: true, onSelect: function () { setModal("delete"); }, disabled: !online }
          : null,
      ]
    : [];

  var leave = function () { p.onClose(); };

  var fieldDisabled = readOnly;

  if (task) {
    body = (
      <div className="tk-dw-body">
        {deleted && (
          <div className="tk-dw-banner is-bad" role="status">
            <span>{TK_dwCopy("deletedBanner", "This task was deleted.")}</span>
            {(isOwner || isAdmin || canEdit) && (
              <button type="button" className="btn-secondary tk-dw-btn-sm" disabled={!online} onClick={doRestore}>
                Restore
              </button>
            )}
          </div>
        )}
        {!online && (
          <div className="tk-dw-banner" role="status">
            {TK_dwCopy("offline", "You're offline.")}
          </div>
        )}
        <TK_dwReview
          task={task}
          staff={staff}
          me={me}
          isAdmin={isAdmin}
          readOnly={readOnly}
          onApprove={function () {
            var api = TK_dwApi();
            if (api && typeof api.approve === "function") api.approve(task.id).catch(TK_dwReviewError);
          }}
          onSendBack={function () { setModal("sendback"); }}
          onWithdraw={function () {
            var api = TK_dwApi();
            if (api && typeof api.withdraw === "function") api.withdraw(task.id).catch(TK_dwReviewError);
          }}
          onSetReviewer={function (email) {
            var api = TK_dwApi();
            if (api && typeof api.setReviewer === "function") api.setReviewer(task.id, email).catch(TK_dwReviewError);
          }}
        />
        {task.parent_id && (
          <p className="tk-dw-parent">
            <a href={TK_dwTaskHref(task.parent_id)} onClick={TK_openTaskClick(task.parent_id)} className="link-btn">
              {"↑"} Open the parent task
            </a>
          </p>
        )}
        <TK_dwCloseLink task={task} readOnly={readOnly} />

        <div className="tk-dw-fields">
          <label className="tk-dw-label" htmlFor="tk-dw-assignee">
            Assignee
          </label>
          <div className="tk-dw-value">
            <select
              id="tk-dw-assignee"
              ref={assigneeRef}
              className="tk-dw-select"
              value={curAssignee}
              disabled={!canAssign || status === "ready_for_review"}
              title={
                status === "ready_for_review" && canAssign
                  ? TK_dwCopy("inReview", "This is in review. Take it back from review before you reassign it.")
                  : !canAssign && !readOnly
                    ? "Only the task's owner or an admin can reassign it."
                    : undefined
              }
              onChange={function (e) {
                var v = e.target.value;
                if (!v) return;
                // P4-3: on schema 12+ a reassign has an Undo toast.
                var api = TK_dwApi();
                if (api && typeof api.bulkReady === "function" && api.bulkReady() && typeof api.reassign === "function" && task && TK_dwLower(v) !== curAssignee) {
                  api.reassign(task.id, v, { toast: "Reassigned to " + nameOf(v) + "." }).catch(TK_dwSaveError);
                  return;
                }
                save({ assignee_email: v });
              }}
            >
              {curAssignee ? null : (
                <option value="" disabled>
                  Unassigned
                </option>
              )}
              {assignees.map(function (a) {
                var em = TK_dwLower(a.email);
                return (
                  <option key={em} value={em}>
                    {(a.name || nameOf(em)) + (a.can_see === false ? " (no access)" : "")}
                  </option>
                );
              })}
            </select>
            {!curAssignee && (
              <span className="tk-unassigned tk-dw-unassigned">
                <span className="tk-chip tk-chip-unassigned">
                  <span className="tk-chip-name">Unassigned</span>
                </span>
                {canClaim && (
                  <button
                    type="button"
                    className="tk-tool-btn tk-claim-btn"
                    data-tour="tk-claim-drawer"
                    onClick={function () {
                      var api = TK_dwApi();
                      if (api && typeof api.claim === "function") api.claim(task.id).catch(function () {});
                    }}
                  >
                    Claim
                  </button>
                )}
              </span>
            )}
            {assigneeWarn && (
              <p className="tk-dw-warn" role="note">
                {TK_dwCopy("noClientAccess", "They can't see this client yet, so they won't see this task.")}
              </p>
            )}
            {(function () {
              if (typeof TK_coverageLabel !== "function") return null;
              var row = coverRows.filter(function (r) { return r && r.task_id === task.id; })[0];
              var lbl = TK_coverageLabel(row, me);
              if (!lbl) return null;
              return (
                <p className="tk-cover-chip tk-dw-cover" title={lbl.title}>
                  {lbl.text}
                </p>
              );
            })()}
          </div>

          <label className="tk-dw-label" htmlFor="tk-dw-due">
            Due
          </label>
          <div className="tk-dw-value tk-dw-pair">
            <input
              id="tk-dw-due"
              type="date"
              className="tk-dw-input"
              value={task.due_date ? String(task.due_date).slice(0, 10) : ""}
              disabled={fieldDisabled}
              onChange={function (e) {
                var v = e.target.value || null;
                var draft = { due_date: v, due_at: TK_dlDueAt(v, dueTime) };
                if (!v && task.recurrence && task.recurrence !== "none") draft.recurrence = "none";
                save(draft);
              }}
            />
            <input
              type="time"
              className="tk-dw-input tk-dw-time"
              aria-label="Due time (optional)"
              value={dueTime}
              disabled={fieldDisabled || !task.due_date}
              onChange={function (e) { save({ due_at: TK_dlDueAt(task.due_date, e.target.value) }); }}
            />
          </div>

          <label className="tk-dw-label" htmlFor="tk-dw-start">
            Start
          </label>
          <div className="tk-dw-value">
            <input
              id="tk-dw-start"
              type="date"
              className="tk-dw-input"
              value={task.start_on ? String(task.start_on).slice(0, 10) : ""}
              disabled={fieldDisabled}
              onChange={function (e) { save({ start_on: e.target.value || null }); }}
            />
          </div>

          <label className="tk-dw-label" htmlFor="tk-dw-priority">
            Priority
          </label>
          <div className="tk-dw-value">
            <select
              id="tk-dw-priority"
              className="tk-dw-select"
              value={task.priority || "normal"}
              disabled={fieldDisabled}
              onChange={function (e) { save({ priority: e.target.value }); }}
            >
              <option value="high">High</option>
              <option value="normal">Normal</option>
              <option value="low">Low</option>
            </select>
          </div>

          <label className="tk-dw-label" htmlFor="tk-dw-section">
            Section
          </label>
          <div className="tk-dw-value">
            <input
              id="tk-dw-section"
              type="text"
              className="tk-dw-input"
              list="tk-dw-section-list"
              maxLength={80}
              placeholder="No section"
              value={sectionDraft}
              disabled={fieldDisabled}
              onChange={function (e) { setSectionDraft(e.target.value); }}
              onBlur={function () { save({ section: sectionDraft }); }}
              onKeyDown={function (e) {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.currentTarget.blur();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  setSectionDraft(task.section || "");
                  var el = e.currentTarget;
                  setTimeout(function () { el.blur(); }, 0);
                }
              }}
            />
            <datalist id="tk-dw-section-list">
              {sectionOptions.map(function (s) {
                return <option key={s} value={s} />;
              })}
            </datalist>
          </div>

          {(task.client_id || task.project_id) && (
            <React.Fragment>
              <span className="tk-dw-label">{task.client_id ? "Client" : "Project"}</span>
              <div className="tk-dw-value">
                {task.client_id ? (
                  <a
                    className="tk-dw-link"
                    href={TK_dwClientListHref(task.client_id)}
                    onClick={function (e) {
                      if (!TK_dlIsPlainClick(e)) return;
                      e.preventDefault();
                      leave();
                      TK_dwGo({ view: "client", clientId: task.client_id }, TK_dwClientListHref(task.client_id));
                    }}
                  >
                    {containerName}
                  </a>
                ) : (
                  <a
                    className="tk-dw-link"
                    href={TK_dwProjectHref(task.project_id)}
                    onClick={function (e) {
                      if (!TK_dlIsPlainClick(e)) return;
                      e.preventDefault();
                      leave();
                      TK_dwGo({ view: "project", projectId: task.project_id }, TK_dwProjectHref(task.project_id));
                    }}
                  >
                    {containerName}
                  </a>
                )}
                {task.client_id && <TK_dwPeople clientId={task.client_id} reviewRequired={!!task.review_required} staff={staff} />}
              </div>
            </React.Fragment>
          )}

          <label className="tk-dw-label" htmlFor="tk-dw-kind">
            Type
          </label>
          <div className="tk-dw-value">
            <select
              id="tk-dw-kind"
              className="tk-dw-select"
              value={task.kind || "task"}
              disabled={fieldDisabled}
              onChange={function (e) { save({ kind: e.target.value }); }}
            >
              <option value="task">Task</option>
              <option value="reminder">Reminder</option>
              {task.kind === "note" && <option value="note">Note</option>}
            </select>
          </div>

          <label className="tk-dw-label" htmlFor="tk-dw-remind">
            Remind me
          </label>
          <div className="tk-dw-value">
            <input
              id="tk-dw-remind"
              type="datetime-local"
              className="tk-dw-input"
              value={TK_dlToLocalInput(task.remind_at)}
              disabled={fieldDisabled}
              onChange={function (e) { save({ remind_at: TK_dlFromLocalInput(e.target.value) }); }}
            />
          </div>

          <label className="tk-dw-label" htmlFor="tk-dw-repeat">
            Repeat
          </label>
          <div className="tk-dw-value">
            <select
              id="tk-dw-repeat"
              className="tk-dw-select"
              value={task.recurrence || "none"}
              disabled={fieldDisabled || !task.due_date}
              title={!task.due_date ? "Add a due date to repeat this task." : undefined}
              onChange={function (e) { save({ recurrence: e.target.value }); }}
            >
              {TK_DW_RECURRENCES.map(function (r) {
                return (
                  <option key={r[0]} value={r[0]}>
                    {r[1]}
                  </option>
                );
              })}
            </select>
          </div>

          {(task.client_id || task.project_id) && (
            <React.Fragment>
              <span className="tk-dw-label">Sharing</span>
              <div className="tk-dw-value">
                <label className="tk-dw-check">
                  <input
                    type="checkbox"
                    checked={task.visibility === "shared"}
                    disabled={fieldDisabled || !isOwner}
                    onChange={function (e) { save({ visibility: e.target.checked ? "shared" : "private" }); }}
                  />
                  <span>{task.client_id ? "Share with the client's team" : "Share with project members"}</span>
                </label>
                {!isOwner && <p className="tk-dw-hint">Only the task's owner can change this.</p>}
              </div>
            </React.Fragment>
          )}

          <span className="tk-dw-label">Review</span>
          <div className="tk-dw-value">
            <label className="tk-dw-check">
              <input
                type="checkbox"
                checked={!!task.review_required}
                disabled={fieldDisabled || (!!task.review_required && !isAdmin)}
                onChange={function (e) { save({ review_required: e.target.checked }); }}
              />
              <span>Needs review before it's done</span>
            </label>
            {!!task.review_required && !isAdmin && <p className="tk-dw-hint">Only an admin can turn this off.</p>}
          </div>

          {task.client_id && (
            <React.Fragment>
              <label className="tk-dw-label" htmlFor="tk-dw-sop">
                SOP section
              </label>
              <div className="tk-dw-value tk-dw-pair">
                <select
                  id="tk-dw-sop"
                  className="tk-dw-select"
                  value={task.sop_section || ""}
                  disabled={fieldDisabled}
                  onChange={function (e) { save({ sop_section: e.target.value || null }); }}
                >
                  <option value="">None</option>
                  {sopSections.map(function (s) {
                    return (
                      <option key={s.id} value={s.id}>
                        {s.title}
                      </option>
                    );
                  })}
                </select>
                {task.sop_section && (
                  <button type="button" className="btn-secondary tk-dw-btn-sm" onClick={function () { setSopOpen(true); }}>
                    View SOP section
                  </button>
                )}
              </div>
            </React.Fragment>
          )}
        </div>

        <section className="tk-dw-section">
          <label className="tk-dw-h" htmlFor="tk-dw-desc">
            Description
          </label>
          <textarea
            id="tk-dw-desc"
            className="tk-dw-textarea"
            rows={4}
            maxLength={5000}
            placeholder={fieldDisabled ? "" : "Add details, steps or links"}
            value={desc}
            disabled={fieldDisabled}
            onChange={function (e) { setDesc(e.target.value); }}
            onBlur={function () { save({ description: desc }, { base: true }); }}
            onKeyDown={function (e) {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                e.currentTarget.blur();
              }
            }}
          />
          {descLen > 4500 && (
            <p className={"tk-dw-counter" + (descLen >= 5000 ? " is-bad" : "")} aria-live="polite">
              {descLen.toLocaleString("en-US")} of 5,000
            </p>
          )}
        </section>

        <TK_dwSubtasks task={task} isAdmin={isAdmin} readOnly={readOnly} canAdd={canEdit && !task.parent_id} />

        {typeof TCL_Checklist === "function" && (
          <section className="tk-dw-section" aria-label="Checklist">
            <h3 className="tk-dw-h">Checklist</h3>
            <TCL_Checklist task={task} canEdit={canEdit && !deleted && online} />
          </section>
        )}

        {typeof TK_dwRequests === "function" && task.client_id && (
          <TK_dwRequests task={task} canEdit={canEdit && !deleted && online} isAdmin={isAdmin} nameOf={nameOf} />
        )}

        <section className="tk-dw-section" aria-labelledby="tk-dw-files-h">
          <h3 className="tk-dw-h" id="tk-dw-files-h">
            Files and links
          </h3>
          {typeof TK_Attachments === "function" && (
            <TK_Attachments task={task} canEdit={canEdit && !deleted && online} staffUser={staffUser} nameOf={nameOf} />
          )}
        </section>

        <section className="tk-dw-section tk-dw-thread-wrap">
          <div className="tk-dw-tabs" role="tablist" aria-label="Comments and activity">
            {[
              ["all", "All"],
              ["comments", "Comments"],
              ["activity", "Activity"],
            ].map(function (t) {
              return (
                <button
                  key={t[0]}
                  type="button"
                  role="tab"
                  id={"tk-dw-tab-" + t[0]}
                  aria-selected={tab === t[0] ? "true" : "false"}
                  aria-controls="tk-dw-tabpanel"
                  tabIndex={tab === t[0] ? 0 : -1}
                  className={"tk-dw-tab" + (tab === t[0] ? " is-on" : "")}
                  onClick={function () { setTab(t[0]); }}
                  onKeyDown={function (e) {
                    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
                    e.preventDefault();
                    var order = ["all", "comments", "activity"];
                    var i = order.indexOf(tab);
                    var next = order[(i + (e.key === "ArrowRight" ? 1 : 2)) % 3];
                    setTab(next);
                    var el = document.getElementById("tk-dw-tab-" + next);
                    if (el) el.focus();
                  }}
                >
                  {t[1]}
                </button>
              );
            })}
          </div>
          <div id="tk-dw-tabpanel" role="tabpanel" aria-labelledby={"tk-dw-tab-" + tab}>
            {tab === "activity"
              ? typeof TK_Activity === "function" && <TK_Activity taskId={task.id} nameOf={nameOf} stamp={task.updated_at} />
              : typeof TK_Comments === "function" && (
                  <TK_Comments
                    task={task}
                    staffUser={staffUser}
                    staff={staff}
                    canComment={!deleted && online}
                    showActivity={tab === "all"}
                    nameOf={nameOf}
                  />
                )}
          </div>
        </section>
      </div>
    );
  }

  return TK_dwPortal(
    <div className="tk-dw-layer">
      <div className="tk-dw-scrim" onClick={function () { p.onClose(); }} aria-hidden="true" />
      <aside
        className="tk-dw"
        role="dialog"
        aria-modal="true"
        aria-label={task && task.text ? task.text : "Task details"}
        data-tk-keyscope="drawer"
        tabIndex={-1}
        ref={panelRef}
      >
        <header className="tk-dw-head">
          <div className="tk-dw-head-row">
            <span className="tk-dw-context">
              {containerName}
              {task && task.section ? " · " + task.section : ""}
            </span>
            <div className="tk-dw-head-actions">
              <button type="button" className="tk-dw-icon-btn" onClick={copyLink} aria-label="Copy link" title="Copy link">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5" />
                  <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" />
                </svg>
              </button>
              <TK_dwMenu label="More actions" items={moreItems} />
              <button type="button" className="tk-dw-icon-btn tk-dw-close" onClick={function () { p.onClose(); }} aria-label="Close details" title="Close (Esc)">
                ×
              </button>
            </div>
          </div>
          {task && (
            <div className="tk-dw-title-row">
              <span data-tk-drawer-status className="tk-dw-status">
                <TK_dwStatus task={task} isAdmin={isAdmin} canEdit={!readOnly} onChange={setStatus} />
              </span>
              <h2 className="tk-dw-title-h" id={labelId}>
                <textarea
                  ref={titleRef}
                  className={"tk-dw-title" + (status === "done" ? " is-done" : "")}
                  aria-label="Title"
                  rows={1}
                  maxLength={500}
                  value={title}
                  readOnly={readOnly}
                  onChange={function (e) { setTitle(e.target.value.replace(/\n/g, " ")); }}
                  onBlur={function () {
                    if (readOnly) return;
                    var t = taskRef.current;
                    if (!String(title).trim()) {
                      setTitle(t ? t.text || "" : "");
                      return;
                    }
                    save({ text: title }, { base: true });
                  }}
                  onKeyDown={function (e) {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      e.currentTarget.blur();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      e.stopPropagation();
                      var t = taskRef.current;
                      setTitle(t ? t.text || "" : "");
                      var el = e.currentTarget;
                      setTimeout(function () { el.blur(); }, 0);
                    }
                  }}
                />
              </h2>
            </div>
          )}
          {task && (
            <p className="tk-dw-sub">
              {TK_dwStatusLabel(status)}
              {(function () {
                if (!task.due_date || typeof TK_dueLabel !== "function") return "";
                var dl = TK_dueLabel(task, today);
                if (!dl) return "";
                if (/late$/.test(dl)) return " · " + dl;
                return " · Due " + (dl === "Today" || dl === "Tomorrow" || dl === "Yesterday" ? dl.toLowerCase() : dl);
              })()}
              {task.assignee_email ? " · " + nameOf(task.assignee_email) : " · Unassigned"}
              {task.source === "template" ? <span className="tk-dw-recurring" title="Made by a recurring template. See Slate › Recurring."> · Recurring</span> : null}
            </p>
          )}
        </header>
        {body}
        {task && (
          <TK_dwFollowers
            task={task}
            me={me}
            staff={staff}
            nameOf={nameOf}
            canEdit={canEdit}
            online={online}
            deleted={deleted}
          />
        )}
        {sopOpen && task && task.client_id && task.sop_section && (
          <TK_dwSopPanel
            client={client || { id: task.client_id }}
            section={task.sop_section}
            onClose={function () { setSopOpen(false); }}
            onLeave={leave}
          />
        )}
      </aside>
      {modal === "delete" && (
        <TK_dwConfirm
          title="Delete this task?"
          body="It leaves every list. Its comments and checklist are kept, and the owner or an admin can restore it."
          confirmLabel="Delete"
          onConfirm={doDelete}
          onCancel={function () { setModal(null); }}
        />
      )}
      {modal === "sendback" && (
        <TK_dwSendBack
          onCancel={function () { setModal(null); }}
          onConfirm={function (note) {
            setModal(null);
            var api = TK_dwApi();
            if (api && task && typeof api.sendBack === "function") api.sendBack(task.id, note).catch(TK_dwReviewError);
          }}
        />
      )}
      {modal === "keys" && <TK_dwKeys onClose={function () { setModal(null); }} />}
    </div>,
  );
}
