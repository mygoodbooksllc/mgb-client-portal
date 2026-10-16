// ----------------------------------------------------------------------------
// TK_TaskRow.jsx — one task row, its status and due pills, and the small
// shared pieces every Tasks view uses (views slice, C6).
//
// Exports: TK_StatusPill, TK_DuePill, TK_TaskRow, TK_SetupCard,
//          TK_vSkeletonRows, TK_vAvatar, TK_vIcon, TK_vSendBackModal
// Shared helpers for the other view files (prefix TK_v, render time only):
//   TK_vLsGet / TK_vLsSet / TK_vSsGet / TK_vSsSet   storage, always in try/catch
//   TK_vTrack(name)                                MGB_track behind a guard
//   TK_vToast(text)                                TK_toast or the mgb:toast event
//   TK_vErrText(err)                               the C10 line for an error
//   TK_vToday()                                    local YYYY-MM-DD
//   TK_vLower(s) is in TK_viewLogic.js
//   TK_vUseStore / TK_vUseSchema / TK_vUseList     the data-slice hooks, with
//                                                  a local fallback so a view
//                                                  never crashes without them
//   TK_vUseWidth / TK_vUseTouch / TK_vUseOnline     window state
//   TK_vModal                                      ModalShell, or a plain overlay
//   TK_vComplete / TK_vSetStatus                   the one completion path
//
// Other slices' globals (TK_api, TK_openTask, TK_openTaskClick, LK_href,
// ModalShell, TCL_useCounts) are read at render or call time behind typeof
// guards. React hooks are used as React.useState and so on (app.jsx, which
// destructures them, loads last).
// ----------------------------------------------------------------------------

// ---- Storage and small helpers ---------------------------------------------------

function TK_vLsGet(key, fallback) {
  try {
    var raw = window.localStorage.getItem(key);
    if (raw == null) return fallback;
    var v = JSON.parse(raw);
    return v == null ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

function TK_vLsSet(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {}
}

function TK_vSsGet(key) {
  try {
    return window.sessionStorage.getItem(key);
  } catch (e) {
    return null;
  }
}

function TK_vSsSet(key, value) {
  try {
    if (value == null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, value);
  } catch (e) {}
}

function TK_vTrack(name) {
  try {
    if (typeof MGB_track === "function") MGB_track(name);
  } catch (e) {}
}

// action (optional): { label, onClick } shows a button on the toast (Undo).
function TK_vToast(text, action) {
  if (!text) return;
  try {
    if (typeof TK_toast === "function" && !action) {
      TK_toast(text);
      return;
    }
    window.dispatchEvent(new CustomEvent("mgb:toast", { detail: { text: text, action: action || null } }));
  } catch (e) {}
}

function TK_vCopy(key, fallback) {
  try {
    if (typeof TK_COPY !== "undefined" && TK_COPY && TK_COPY[key]) return TK_COPY[key];
  } catch (e) {}
  return fallback || "";
}

// The C10 line for a failed write or read.
function TK_vErrText(err, fallbackKey) {
  var code = err && err.code ? String(err.code) : "";
  var rk = typeof TK_reviewErrorKey === "function" ? TK_reviewErrorKey(err) : null; // tasks p2 s3
  if (rk && TK_vCopy(rk)) return TK_vCopy(rk);
  if (code === "tk_offline") return TK_vCopy("offline");
  if (code === "tk_conflict") return TK_vCopy("conflict");
  if (code === "tk_reverted" || code === "tk_forbidden") return TK_vCopy("reverted");
  if (code === "tk_schema_missing") return TK_vCopy("setupTitle");
  return TK_vCopy(fallbackKey || "saveError", "Couldn't save that change. Try again.");
}

function TK_vToday() {
  if (typeof TK_ymd === "function") return TK_ymd();
  var d = new Date();
  var p = function (n) {
    return n < 10 ? "0" + n : String(n);
  };
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

function TK_vStatusOf(task) {
  if (typeof TK_effectiveStatus === "function") return TK_effectiveStatus(task);
  return task && task.status ? task.status : task && task.done ? "done" : "todo";
}

function TK_vStatusLabel(status) {
  if (typeof TK_STATUS_LABELS !== "undefined" && TK_STATUS_LABELS[status]) return TK_STATUS_LABELS[status];
  return status || "";
}

function TK_vTaskHref(id) {
  try {
    if (typeof LK_href === "function") return LK_href({ place: "tasks", tab: "my", item: "task:" + id });
  } catch (e) {}
  return "#/tasks/my?item=task:" + encodeURIComponent(String(id));
}

// A plain left click (no modifier, button 0, not handled yet).
function TK_vPlainClick(e) {
  if (!e || e.defaultPrevented) return false;
  if (e.button != null && e.button !== 0) return false;
  return !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey);
}

// Open a task in the drawer. opts.focus "assignee" asks the drawer to land on
// the assignee field (the `a` key).
function TK_vOpenTask(id, opts) {
  if (!id) return;
  if (typeof TK_openTask === "function") {
    TK_openTask(id, Object.assign({ from: "list" }, opts || {}));
    return;
  }
  try {
    if (typeof LK_go === "function") LK_go({ place: "work", tab: "tasks", item: "task:" + id });
  } catch (e) {}
}

// Send back with a reason (required, 3+ characters). Toasts on failure.
function TK_vSendBack(task, reason) {
  if (!task || typeof TK_api === "undefined" || !TK_api || typeof TK_api.sendBack !== "function") return Promise.resolve(null);
  return TK_api.sendBack(task.id, reason).catch(function (e) {
    TK_vToast(TK_vErrText(e));
    return null;
  });
}

function TK_vWithdraw(task) {
  if (!task || typeof TK_api === "undefined" || !TK_api || typeof TK_api.withdraw !== "function") return Promise.resolve(null);
  return TK_api.withdraw(task.id, null).catch(function (e) {
    TK_vToast(TK_vErrText(e));
    return null;
  });
}

// The signed-in staff email from the store ("" when unknown).
function TK_vMe() {
  try {
    var st = typeof TK_store !== "undefined" && TK_store ? TK_store.getState() : null;
    return st && st.me ? String(st.me).toLowerCase() : "";
  } catch (e) {
    return "";
  }
}

// The one completion path. Toasts come from TK_api.complete itself; this only
// toasts a failure.
function TK_vComplete(task, isAdmin) {
  if (!task || typeof TK_api === "undefined" || !TK_api || typeof TK_api.complete !== "function") return Promise.resolve(null);
  var open = typeof TK_isOpen === "function" ? TK_isOpen(task) : TK_vStatusOf(task) !== "done";
  var opts = { done: open };
  if (typeof isAdmin === "boolean") opts.isAdmin = isAdmin; // else TK_api reads the staff list
  return TK_api.complete(task, opts).catch(function (e) {
    TK_vToast(TK_vErrText(e));
    return null;
  });
}

// ---- Unassigned tasks (S8b) ------------------------------------------------------
// The assignee only ("" when nobody is on it). TK_assigneeOf lives in
// TK_logic.js; this copy keeps the row working if that loads late.
function TK_vAssigneeOf(task) {
  if (typeof TK_assigneeOf === "function") return TK_assigneeOf(task);
  return task && task.assignee_email ? String(task.assignee_email).trim().toLowerCase() : "";
}

function TK_vCanClaim(task) {
  if (!task || task.deleted_at || TK_vAssigneeOf(task)) return false;
  var st = TK_vStatusOf(task);
  return st === "todo" || st === "in_progress" || st === "waiting_client";
}

// Set once an Unassigned task has been on screen; the "Unassigned tasks and
// Claim" launch notice waits for it (components/tour/announcements.js).
var TK_SEEN_UNASSIGNED_KEY = "mgb_tk_seen_unassigned_v1";

function TK_vMarkSeenUnassigned() {
  try {
    if (window.localStorage.getItem(TK_SEEN_UNASSIGNED_KEY) !== "1") window.localStorage.setItem(TK_SEEN_UNASSIGNED_KEY, "1");
  } catch (e) {}
}

// Claim: TK_api.claim toasts both success and failure itself.
function TK_vClaim(task) {
  if (!task || typeof TK_api === "undefined" || !TK_api || typeof TK_api.claim !== "function") return Promise.resolve(null);
  return TK_api.claim(task.id).catch(function () {
    return null;
  });
}

// "Unassigned" plus a Claim button (when the row offers one).
function TK_vUnassignedClaim(props) {
  var task = props.task;
  var busyPair = React.useState(false);
  var busy = busyPair[0];
  var setBusy = busyPair[1];
  var canClaim = !!props.onClaim && TK_vCanClaim(task);
  return (
    <span className="tk-unassigned">
      <span className="tk-muted">Unassigned</span>
      {canClaim ? (
        <button
          type="button"
          className="tk-tool-btn tk-claim-btn"
          data-tour={props.tour || undefined}
          disabled={busy}
          aria-label={"Claim " + (task.text || "this task")}
          onClick={function (e) {
            e.stopPropagation();
            setBusy(true);
            Promise.resolve(props.onClaim(task)).then(
              function () { setBusy(false); },
              function () { setBusy(false); },
            );
          }}
        >
          {busy ? "Claiming…" : "Claim"}
        </button>
      ) : null}
    </span>
  );
}

function TK_vSetStatus(task, status, note, isAdmin) {
  if (!task || typeof TK_api === "undefined" || !TK_api) return Promise.resolve(null);
  // Tasks p2 s3: approve and send back have their own RPCs.
  if (TK_vStatusOf(task) === "ready_for_review" && status === "done" && typeof TK_api.approve === "function") {
    return TK_api.approve(task.id, note || null).catch(function (e) {
      TK_vToast(TK_vErrText(e));
      return null;
    });
  }
  if (status === "done" && typeof TK_api.complete === "function" && TK_vStatusOf(task) !== "ready_for_review") {
    var opts = { done: true };
    if (typeof isAdmin === "boolean") opts.isAdmin = isAdmin;
    return TK_api.complete(task, opts).catch(function (e) {
      TK_vToast(TK_vErrText(e));
      return null;
    });
  }
  if (typeof TK_api.setStatus !== "function") return Promise.resolve(null);
  return TK_api.setStatus(task.id, status, note || null).catch(function (e) {
    TK_vToast(TK_vErrText(e));
    return null;
  });
}

// ---- Hooks over the data slice (with fallbacks) ------------------------------------

function TK_vUseStore(selector) {
  if (typeof TK_useStore === "function") return TK_useStore(selector);
  // Fallback: subscribe to TK_store directly.
  var st = typeof TK_store !== "undefined" && TK_store ? TK_store : null;
  var get = function () {
    try {
      return st ? selector(st.getState()) : selector({});
    } catch (e) {
      return undefined;
    }
  };
  var pair = React.useState(get);
  var setV = pair[1];
  React.useEffect(
    function () {
      if (!st || typeof st.subscribe !== "function") return undefined;
      return st.subscribe(function () {
        setV(get);
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  return get();
}

// "unknown" | "ok" | "missing". Without the data slice there is nothing to
// show, so the views use the calm setup card.
function TK_vUseSchema() {
  if (typeof TK_useSchema === "function") return TK_useSchema();
  return "missing";
}

// { tasks, loading, error, reload }. Uses TK_useList when the data slice is
// loaded; else runs the loader itself.
function TK_vUseList(key, loader) {
  if (typeof TK_useList === "function") return TK_useList(key, loader);
  var pair = React.useState({ tasks: [], loading: true, error: null });
  var st = pair[0];
  var set = pair[1];
  var ref = React.useRef(loader);
  ref.current = loader;
  var seq = React.useRef(0);
  var reload = React.useCallback(function () {
    var n = ++seq.current;
    set(function (s) {
      return { tasks: s.tasks, loading: true, error: null };
    });
    Promise.resolve()
      .then(function () {
        return ref.current ? ref.current() : [];
      })
      .then(
        function (rows) {
          if (n === seq.current) set({ tasks: Array.isArray(rows) ? rows : [], loading: false, error: null });
        },
        function (e) {
          if (n === seq.current)
            set(function (s) {
              return { tasks: s.tasks, loading: false, error: e || { code: "tk_error" } };
            });
        },
      );
  }, []);
  React.useEffect(
    function () {
      if (key) reload();
    },
    [key, reload],
  );
  return { tasks: st.tasks, loading: st.loading, error: st.error, reload: reload };
}

function TK_vUseWidth() {
  var get = function () {
    try {
      return window.innerWidth || 1280;
    } catch (e) {
      return 1280;
    }
  };
  var pair = React.useState(get);
  var setW = pair[1];
  React.useEffect(function () {
    var t = null;
    var on = function () {
      if (t) clearTimeout(t);
      t = setTimeout(function () {
        setW(get());
      }, 80);
    };
    window.addEventListener("resize", on);
    window.addEventListener("orientationchange", on);
    return function () {
      if (t) clearTimeout(t);
      window.removeEventListener("resize", on);
      window.removeEventListener("orientationchange", on);
    };
  }, []);
  return pair[0];
}

function TK_vUseTouch() {
  var pair = React.useState(function () {
    return typeof TK_isTouchPrimary === "function" ? TK_isTouchPrimary() : false;
  });
  var setT = pair[1];
  React.useEffect(function () {
    var mq = null;
    try {
      mq = window.matchMedia ? window.matchMedia("(hover: none) and (pointer: coarse)") : null;
    } catch (e) {
      mq = null;
    }
    if (!mq) return undefined;
    var on = function () {
      setT(!!mq.matches);
    };
    try {
      if (mq.addEventListener) mq.addEventListener("change", on);
      else if (mq.addListener) mq.addListener(on);
    } catch (e) {}
    return function () {
      try {
        if (mq.removeEventListener) mq.removeEventListener("change", on);
        else if (mq.removeListener) mq.removeListener(on);
      } catch (e) {}
    };
  }, []);
  return pair[0];
}

function TK_vUseOnline() {
  var fromStore = TK_vUseStore(function (s) {
    return s && typeof s.online === "boolean" ? s.online : null;
  });
  var pair = React.useState(function () {
    try {
      return navigator.onLine !== false;
    } catch (e) {
      return true;
    }
  });
  var setO = pair[1];
  React.useEffect(function () {
    var up = function () {
      setO(true);
    };
    var down = function () {
      setO(false);
    };
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return function () {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  if (pair[0] === false) return false;
  return fromStore === false ? false : true;
}

// Project rows from the store, loading them once when nobody has yet.
function TK_vUseProjects() {
  var projects = TK_vUseStore(function (s) {
    return s ? s.projects : null;
  });
  React.useEffect(
    function () {
      if (projects == null && typeof TK_api !== "undefined" && TK_api && typeof TK_api.listProjects === "function") {
        TK_api.listProjects().catch(function () {});
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projects == null],
  );
  return projects;
}

// Active staff ({ id, email, name, role, active }), loaded once.
function TK_vUseStaff(enabled) {
  var staff = TK_vUseStore(function (s) {
    return s ? s.staff : null;
  });
  var pair = React.useState(null);
  var local = pair[0];
  var setLocal = pair[1];
  React.useEffect(
    function () {
      if (enabled === false) return;
      if (staff != null) return;
      if (typeof TK_api === "undefined" || !TK_api || typeof TK_api.listStaff !== "function") return;
      var live = true;
      Promise.resolve(TK_api.listStaff()).then(
        function (rows) {
          if (live) setLocal(rows || []);
        },
        function () {
          if (live) setLocal([]);
        },
      );
      return function () {
        live = false;
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enabled, staff == null],
  );
  return staff != null ? staff : local;
}

// Checklist counts for uuid ids, through TCL_useCounts when it is loaded.
function TK_vUseChecklist(ids) {
  if (typeof TCL_useCounts === "function") return TCL_useCounts(ids) || {};
  return {};
}

// ModalShell, or (if app.jsx's ModalShell is somehow missing) a plain overlay.
function TK_vModal(props) {
  if (typeof ModalShell === "function") {
    return (
      <ModalShell onClose={props.onClose} labelledBy={props.labelledBy} className={props.className || ""}>
        {props.children}
      </ModalShell>
    );
  }
  return (
    <div className="modal-overlay" onClick={props.onClose}>
      <div
        className={"modal-panel " + (props.className || "")}
        role="dialog"
        aria-modal="true"
        aria-labelledby={props.labelledBy}
        onClick={function (e) {
          e.stopPropagation();
        }}
      >
        {props.children}
      </div>
    </div>
  );
}

// ---- Icons (stroke uses currentColor; never a color literal) ------------------------

function TK_vIcon(props) {
  var name = props.name;
  var size = props.size || 16;
  var common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": "true",
    focusable: "false",
    className: "tk-icon" + (props.className ? " " + props.className : ""),
  };
  if (name === "check") return <svg {...common}><polyline points="5 12.5 10 17 19 7.5" /></svg>;
  if (name === "chevron") return <svg {...common}><polyline points="9 6 15 12 9 18" /></svg>;
  if (name === "down") return <svg {...common}><polyline points="6 9 12 15 18 9" /></svg>;
  if (name === "search") return <svg {...common}><circle cx="11" cy="11" r="6.5" /><line x1="16" y1="16" x2="20.5" y2="20.5" /></svg>;
  if (name === "plus") return <svg {...common}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>;
  if (name === "list") return <svg {...common}><line x1="9" y1="7" x2="20" y2="7" /><line x1="9" y1="12" x2="20" y2="12" /><line x1="9" y1="17" x2="20" y2="17" /><circle cx="4.5" cy="7" r="1" /><circle cx="4.5" cy="12" r="1" /><circle cx="4.5" cy="17" r="1" /></svg>;
  if (name === "home") return <svg {...common}><polyline points="4 11 12 4 20 11" /><path d="M6 10v9h12v-9" /></svg>;
  if (name === "window") return <svg {...common}><rect x="3.5" y="5" width="17" height="14" rx="2" /><line x1="3.5" y1="9" x2="20.5" y2="9" /></svg>;
  if (name === "dock") return <svg {...common}><rect x="3.5" y="4" width="17" height="16" rx="2" /><rect x="12" y="8" width="5.5" height="8" rx="1" /></svg>;
  if (name === "external") return <svg {...common}><path d="M14 4h6v6" /><line x1="20" y1="4" x2="11" y2="13" /><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>;
  if (name === "filter") return <svg {...common}><path d="M4 5h16l-6 7.5V19l-4-2v-4.5z" /></svg>;
  if (name === "more") return <svg {...common}><circle cx="5" cy="12" r="1.3" /><circle cx="12" cy="12" r="1.3" /><circle cx="19" cy="12" r="1.3" /></svg>;
  if (name === "keyboard") return <svg {...common}><rect x="2.5" y="6" width="19" height="12" rx="2" /><line x1="7" y1="14.5" x2="17" y2="14.5" /><line x1="6.5" y1="10" x2="7.5" y2="10" /><line x1="11.5" y1="10" x2="12.5" y2="10" /><line x1="16.5" y1="10" x2="17.5" y2="10" /></svg>;
  if (name === "people") return <svg {...common}><circle cx="9" cy="8.5" r="3.2" /><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5" /><circle cx="17" cy="9.5" r="2.4" /><path d="M15.8 14.2c2.2.2 3.8 1.8 4.4 4.3" /></svg>;
  if (name === "hourglass") return <svg {...common}><path d="M7 4h10M7 20h10" /><path d="M8 4c0 4 8 4.5 8 8s-8 4-8 8" /><path d="M16 4c0 4-8 4.5-8 8s8 4 8 8" /></svg>;
  if (name === "repeat") return <svg {...common}><path d="M4 11V9a3 3 0 0 1 3-3h12" /><polyline points="16 3 19 6 16 9" /><path d="M20 13v2a3 3 0 0 1-3 3H5" /><polyline points="8 21 5 18 8 15" /></svg>;
  if (name === "folder") return <svg {...common}><path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" /></svg>;
  return <svg {...common}><circle cx="12" cy="12" r="8" /></svg>;
}

// ---- Avatar ---------------------------------------------------------------------------

function TK_vAvatar(props) {
  var label = props.name || props.email || "";
  var initials = typeof TK_initials === "function" ? TK_initials(label) : String(label).slice(0, 2).toUpperCase();
  return (
    <span
      className={"tk-avatar" + (props.size === "sm" ? " tk-avatar-sm" : "") + (props.className ? " " + props.className : "")}
      title={props.title || label || undefined}
      aria-hidden={props.decorative ? "true" : undefined}
    >
      {initials}
    </span>
  );
}

// ---- Due pill -------------------------------------------------------------------------

function TK_DuePill(props) {
  var task = props.task;
  var today = props.today || TK_vToday();
  if (!task || !task.due_date) return null;
  var label = typeof TK_dueLabel === "function" ? TK_dueLabel(task, today) : String(task.due_date);
  if (!label) return null;
  var late = typeof TK_isOverdue === "function" ? TK_isOverdue(task, today) : false;
  return (
    <span className={"tk-due" + (late ? " tk-due-late" : "")} title={late ? "Overdue, due " + task.due_date : "Due " + task.due_date}>
      {label}
    </span>
  );
}

// ---- Send back reason -------------------------------------------------------------------

function TK_vSendBackModal(props) {
  var pair = React.useState("");
  var note = pair[0];
  var setNote = pair[1];
  var triedPair = React.useState(false);
  var tried = triedPair[0];
  var setTried = triedPair[1];
  var id = "tk-sendback-title";
  var errKey = typeof TK_sendBackReasonError === "function" ? TK_sendBackReasonError(note) : note.trim().length < 3 ? "reasonRequired" : null;
  var submit = function () {
    if (errKey) {
      setTried(true);
      return;
    }
    props.onConfirm(note.trim());
  };
  return (
    <TK_vModal onClose={props.onClose} labelledBy={id} className="tk-modal">
      <div className="modal-header">
        <h3 className="card-title" id={id} style={{ margin: 0 }}>
          Send back
        </h3>
        <button type="button" className="modal-close" onClick={props.onClose} aria-label="Close">
          ×
        </button>
      </div>
      <div className="modal-body">
        <label className="tk-field">
          <span className="tk-field-label">What needs another look?</span>
          <textarea
            className="tk-input tk-textarea"
            rows={3}
            maxLength={2000}
            value={note}
            aria-invalid={tried && errKey ? "true" : undefined}
            aria-describedby="tk-sendback-help"
            onChange={function (e) {
              setNote(e.target.value);
            }}
          />
        </label>
        <p id="tk-sendback-help" role={tried && errKey ? "alert" : undefined} className={"tk-dw-hint" + (tried && errKey ? " tk-field-error" : "")}>
          {tried && errKey
            ? TK_vCopy(errKey, "Add a short note on what needs another look.")
            : "They see this note in the task's comments, and by email if their task emails are on."}
        </p>
      </div>
      <div className="modal-footer tk-modal-footer">
        <button type="button" className="btn-secondary" onClick={props.onClose}>
          Cancel
        </button>
        <button type="button" className="btn-primary" onClick={submit}>
          Send back
        </button>
      </div>
    </TK_vModal>
  );
}

// ---- Status pill and menu -------------------------------------------------------------
// props: { task, isAdmin, canEdit, onChange(status, note), compact, openSignal, tourKey }
// openSignal: a number the `s` key bumps to open this row's menu.

function TK_StatusPill(props) {
  var task = props.task || {};
  var status = TK_vStatusOf(task);
  var label = TK_vStatusLabel(status);
  var openPair = React.useState(false);
  var open = openPair[0];
  var setOpen = openPair[1];
  var backPair = React.useState(false);
  var sendBack = backPair[0];
  var setSendBack = backPair[1];
  var btnRef = React.useRef(null);
  var menuRef = React.useRef(null);
  var items = React.useMemo(
    function () {
      return typeof TK_nextStatuses === "function" ? TK_nextStatuses(task, { isAdmin: !!props.isAdmin, me: props.me || TK_vMe() }) : [];
    },
    [task, props.isAdmin, props.me],
  );
  var canEdit = props.canEdit !== false && !!props.onChange && items.length > 0;

  var close = React.useCallback(function (refocus) {
    setOpen(false);
    if (refocus && btnRef.current) {
      try {
        btnRef.current.focus({ preventScroll: true });
      } catch (e) {}
    }
  }, []);

  // The `s` key: open and land on the first item.
  var lastSignal = React.useRef(props.openSignal || 0);
  React.useEffect(
    function () {
      var s = props.openSignal || 0;
      if (s && s !== lastSignal.current && canEdit) setOpen(true);
      lastSignal.current = s;
    },
    [props.openSignal, canEdit],
  );

  React.useEffect(
    function () {
      if (!open) return undefined;
      var first = menuRef.current ? menuRef.current.querySelector('[role="menuitem"]') : null;
      if (first) {
        try {
          first.focus({ preventScroll: true });
        } catch (e) {}
      }
      var onDoc = function (e) {
        if (menuRef.current && menuRef.current.contains(e.target)) return;
        if (btnRef.current && btnRef.current.contains(e.target)) return;
        close(false);
      };
      document.addEventListener("mousedown", onDoc, true);
      document.addEventListener("touchstart", onDoc, true);
      return function () {
        document.removeEventListener("mousedown", onDoc, true);
        document.removeEventListener("touchstart", onDoc, true);
      };
    },
    [open, close],
  );

  var onMenuKey = function (e) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
      return;
    }
    if (e.key === "Tab") {
      close(false);
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    var list = menuRef.current ? Array.prototype.slice.call(menuRef.current.querySelectorAll('[role="menuitem"]')) : [];
    if (!list.length) return;
    var i = list.indexOf(document.activeElement);
    var j = e.key === "Home" ? 0 : e.key === "End" ? list.length - 1 : e.key === "ArrowDown" ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
    try {
      list[j].focus();
    } catch (err) {}
  };

  var choose = function (item) {
    close(true);
    if (item.action === "send_back") {
      setSendBack(true);
      return;
    }
    if (item.action === "withdraw" && item.status === "in_progress") {
      TK_vWithdraw(task);
      return;
    }
    props.onChange(item.status, null);
  };

  var cls = "tk-pill tk-st-" + status + (props.compact ? " tk-pill-compact" : "");
  if (!canEdit) {
    return (
      <span className={cls} data-tour={props.tourKey || undefined}>
        {label}
      </span>
    );
  }
  return (
    <span className="tk-pill-wrap">
      <button
        type="button"
        ref={btnRef}
        className={cls + " tk-pill-btn"}
        aria-haspopup="menu"
        aria-expanded={open ? "true" : "false"}
        aria-label={"Status: " + label + ". Change status"}
        data-tour={props.tourKey || undefined}
        onClick={function (e) {
          e.stopPropagation();
          setOpen(!open);
        }}
      >
        <span>{label}</span>
        <TK_vIcon name="down" size={12} />
      </button>
      {open ? (
        <div className="tk-menu" role="menu" aria-label="Change status" ref={menuRef} onKeyDown={onMenuKey}>
          {items.map(function (it) {
            return (
              <button
                key={it.status + it.label}
                type="button"
                role="menuitem"
                className="tk-menu-item"
                onClick={function (e) {
                  e.stopPropagation();
                  choose(it);
                }}
              >
                <span className={"tk-dot tk-st-" + it.status} aria-hidden="true" />
                {it.label}
              </button>
            );
          })}
        </div>
      ) : null}
      {sendBack ? (
        <TK_vSendBackModal
          onClose={function () {
            setSendBack(false);
          }}
          onConfirm={function (note) {
            setSendBack(false);
            TK_vSendBack(task, note);
          }}
        />
      ) : null}
    </span>
  );
}

// ---- Task row -----------------------------------------------------------------------------
// props (C6): { task, today, clientName, projectName, showClient=true, showAssignee=false,
//   assigneeName, focused, checklist:{done,total}|null, isAdmin, canEdit, onOpen(id),
//   onToggleDone(task), onStatus(task, status, note) }
// Additions: columns (the list view's Assignee | Due | Status | Priority cells),
//   statusSignal (the `s` key), tourStatus (data-tour on the first row's pill),
//   snippet (a search hit's comment line), onFocusRow(id),
//   note (one more meta line), trailing (buttons before the status pill; the review queue),
//   me (the signed-in email; else the store's),
//   onClaim(task) (S8b: an open Unassigned row shows "Unassigned" and Claim),
//   showUnassigned (false hides that label off the columns layout), tourClaim.

function TK_TaskRow(props) {
  var task = props.task;
  var ref = React.useRef(null);
  var focused = !!props.focused;
  React.useEffect(
    function () {
      if (!focused || !ref.current) return;
      var el = ref.current;
      var a = document.activeElement;
      // Move the browser focus with the j/k focus unless the person is typing
      // or working in something else (a menu, the drawer).
      if (a && a !== document.body && !el.parentNode.contains(a)) return;
      try {
        el.focus({ preventScroll: true });
        if (el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
      } catch (e) {}
    },
    [focused],
  );
  // S8b: an open Unassigned task on screen unlocks its launch notice.
  var unassignedOpen = !!task && TK_vCanClaim(task);
  React.useEffect(
    function () {
      if (unassignedOpen) TK_vMarkSeenUnassigned();
    },
    [unassignedOpen],
  );
  if (!task) return null;
  var id = task.id;
  var unassigned = !TK_vAssigneeOf(task);
  var claimBits = unassigned ? <TK_vUnassignedClaim task={task} onClaim={props.onClaim} tour={props.tourClaim ? "tk-claim" : undefined} /> : null;
  var today = props.today || TK_vToday();
  var status = TK_vStatusOf(task);
  var done = status === "done";
  var showClient = props.showClient !== false;
  var href = TK_vTaskHref(id);
  var openClick = function (e) {
    if (typeof TK_openTaskClick === "function") {
      TK_openTaskClick(id)(e);
      return;
    }
    if (!TK_vPlainClick(e)) return;
    e.preventDefault();
    if (props.onOpen) props.onOpen(id);
  };
  var onRowClick = function (e) {
    var t = e.target;
    if (t && t.closest && t.closest("a, button, input, select, textarea, label, [role='menu']")) return;
    if (props.onFocusRow) props.onFocusRow(id);
    if (props.onOpen) props.onOpen(id);
  };
  var cl = props.checklist && props.checklist.total ? props.checklist : null;
  var priority = task.priority === "high" || task.priority === "low" ? task.priority : "normal";
  var priorityLabel = typeof TK_PRIORITY_LABELS !== "undefined" && TK_PRIORITY_LABELS[priority] ? TK_PRIORITY_LABELS[priority] : priority;
  var statusPill = (
    <TK_StatusPill
      task={task}
      isAdmin={props.isAdmin}
      me={props.me}
      canEdit={props.canEdit !== false && !!props.onStatus}
      compact={!props.columns}
      openSignal={props.statusSignal}
      tourKey={props.tourStatus ? "tk-status" : undefined}
      onChange={
        props.onStatus
          ? function (s, note) {
              props.onStatus(task, s, note);
            }
          : null
      }
    />
  );
  var meta = [];
  if (showClient && props.clientName) meta.push(<span key="c" className="tk-meta-client">{props.clientName}</span>);
  if (props.projectName) meta.push(<span key="p" className="tk-meta-project">{props.projectName}</span>);
  if (task.section && props.showSection) meta.push(<span key="s">{task.section}</span>);
  if (cl) meta.push(<span key="cl" className="tk-meta-check" title="Checklist">{cl.done + "/" + cl.total}</span>);
  // tasks p2 s4: made by a recurring template
  if (task.source === "template") meta.push(<span key="rc" className="tk-meta-recurring" title="Made by a recurring template">Recurring</span>);
  if (props.snippet) meta.push(<span key="sn" className="tk-meta-snippet">{"In a comment: " + props.snippet}</span>);
  if (props.note) meta.push(<span key="nt" className="tk-meta-note">{props.note}</span>);

  return (
    <li
      ref={ref}
      className={"tk-row" + (focused ? " is-focused" : "") + (done ? " is-done" : "") + (props.columns ? " tk-row-cols" : "")}
      data-lk={"task:" + id}
      data-tk-id={id}
      role="row"
      aria-selected={focused ? "true" : "false"}
      tabIndex={focused ? 0 : -1}
      onClick={onRowClick}
    >
      <div className="tk-cell tk-cell-check" role="gridcell">
        {props.onToggleDone ? (
          <button
            type="button"
            className={"tk-check" + (done ? " is-on" : "")}
            role="checkbox"
            aria-checked={done ? "true" : "false"}
            aria-label={done ? "Mark not done" : "Mark done"}
            onClick={function (e) {
              e.stopPropagation();
              props.onToggleDone(task);
            }}
          >
            {done ? <TK_vIcon name="check" size={13} /> : null}
          </button>
        ) : (
          <span className={"tk-dot tk-st-" + status} aria-hidden="true" />
        )}
      </div>
      <div className="tk-cell tk-cell-main" role="gridcell">
        <a className="tk-row-title" href={href} onClick={openClick}>
          {task.text || "Untitled task"}
        </a>
        <div className="tk-row-meta">
          {meta}
          {props.columns ? null : <TK_DuePill task={task} today={today} />}
          {props.columns ? (
            <span className="tk-row-phone">
              <TK_DuePill task={task} today={today} />
              {props.assigneeName ? <span>{props.assigneeName}</span> : unassigned ? <span className="tk-muted">Unassigned</span> : null}
              {priority !== "normal" ? <span className={"tk-prio tk-prio-" + priority}>{priorityLabel}</span> : null}
            </span>
          ) : null}
          {!props.columns && props.showAssignee && props.assigneeName ? <span className="tk-meta-who">{props.assigneeName}</span> : null}
        </div>
      </div>
      {props.columns ? (
        <React.Fragment>
          <div className="tk-cell tk-cell-who" role="gridcell">
            {props.assigneeName ? (
              <span className="tk-who" title={props.assigneeName}>
                <TK_vAvatar name={props.assigneeName} size="sm" decorative />
                <span className="tk-who-name">{props.assigneeName}</span>
              </span>
            ) : unassigned ? (
              claimBits
            ) : (
              <span className="tk-muted">No one</span>
            )}
          </div>
          <div className="tk-cell tk-cell-due" role="gridcell">
            <TK_DuePill task={task} today={today} />
          </div>
          <div className="tk-cell tk-cell-status" role="gridcell">
            {statusPill}
          </div>
          <div className="tk-cell tk-cell-prio" role="gridcell">
            <span className={"tk-prio tk-prio-" + priority}>{priorityLabel}</span>
          </div>
        </React.Fragment>
      ) : (
        <div className="tk-cell tk-cell-status" role="gridcell">
          {priority === "high" ? <span className="tk-prio tk-prio-high">High</span> : null}
          {props.showUnassigned !== false ? claimBits : null}
          {props.trailing || null}
          {statusPill}
        </div>
      )}
    </li>
  );
}

// ---- Loading rows ---------------------------------------------------------------------------

function TK_vSkeletonRows(props) {
  var n = props.count || 6;
  var rows = [];
  for (var i = 0; i < n; i++) {
    rows.push(
      <li key={i} className="tk-row tk-row-skel" aria-hidden="true">
        <span className="tk-skel tk-skel-check" />
        <span className="tk-skel tk-skel-line" style={{ width: 40 + ((i * 37) % 45) + "%" }} />
        <span className="tk-skel tk-skel-pill" />
      </li>,
    );
  }
  return (
    <ul className="tk-rows" aria-busy="true" aria-label="Loading tasks">
      {rows}
    </ul>
  );
}

// ---- Setup card (schema missing, B4) ------------------------------------------------------------

function TK_SetupCard(props) {
  return (
    <div className={"tk-setup card" + (props.embedded ? " tk-setup-embedded" : "")} role="status">
      <h2 className="tk-setup-title">{TK_vCopy("setupTitle", "Tasks is being set up")}</h2>
      <p className="tk-setup-body">{TK_vCopy("setupBody")}</p>
      {props.embedded ? null : (
        <a className="btn-secondary tk-setup-link" href="#/work/tasks">
          Open Work › Tasks
        </a>
      )}
    </div>
  );
}

// ---- Calm states shared by the lists ----------------------------------------------------------

function TK_vErrorState(props) {
  return (
    <div className="tk-state tk-state-error" role="alert">
      <p>{props.text || TK_vCopy("loadError", "Couldn't load your tasks.")}</p>
      {props.onRetry ? (
        <button type="button" className="btn-secondary" onClick={props.onRetry}>
          {TK_vCopy("retry", "Try again")}
        </button>
      ) : null}
    </div>
  );
}

function TK_vOfflineBanner() {
  return (
    <div className="tk-banner tk-banner-offline" role="status">
      {TK_vCopy("offline")}
    </div>
  );
}

// A switch (role="switch") used by toolbars and the New project modal.
function TK_vSwitch(props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked ? "true" : "false"}
      className={"tk-switch" + (props.checked ? " is-on" : "") + (props.className ? " " + props.className : "")}
      onClick={function () {
        props.onChange(!props.checked);
      }}
      disabled={props.disabled}
      id={props.id}
    >
      <span className="tk-switch-track" aria-hidden="true">
        <span className="tk-switch-thumb" />
      </span>
      <span className="tk-switch-label">{props.label}</span>
    </button>
  );
}
