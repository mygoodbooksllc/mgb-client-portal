// ----------------------------------------------------------------------------
// TK_TaskRow.jsx — one task row, its status and due pills, and the small
// shared pieces every Tasks view uses (views slice, C6).
//
// Exports: TK_StatusPill, TK_DuePill, TK_TaskRow, TK_SetupCard,
//          TK_vSkeletonRows, TK_vAvatar, TK_vIcon, TK_vSendBackModal,
//          TK_vUseSubtasks (inline subtasks), TK_vProjectDot, TK_vColorPicker,
//          TK_vSetProjectColor, TK_vColorModal (project colors)
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
  // P4-3: a one-row bulk call the server skipped; the message is the reason.
  if (code === "tk_skipped") return "Not changed. " + (err.message || "");
  if (code === "tk_too_many") return err.message || "Pick 100 tasks or fewer.";
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

// "Assign" button with a people dropdown, shown on an open Unassigned task. It
// uses the same pick list and reassign call as the assignee cell, so picking
// yourself is the old "Claim".
function TK_vAssignMenu(props) {
  var task = props.task;
  var menu = TK_vUseMenu();
  var staff = TK_vUseStore(function (s) {
    return s ? s.staff : null;
  });
  var peoplePair = React.useState(null);
  var people = peoplePair[0];
  var setPeople = peoplePair[1];
  React.useEffect(
    function () {
      if (!menu.open || people !== null) return undefined;
      var live = true;
      var fallback = function () {
        if (live) setPeople((staff || []).map(function (s) { return { email: String(s.email || "").toLowerCase(), name: s.name, can_see: true }; }));
      };
      if (typeof TK_api === "undefined" || !TK_api || typeof TK_api.assignable !== "function") {
        fallback();
        return undefined;
      }
      Promise.resolve(TK_api.assignable({ clientId: task.client_id, projectId: task.project_id })).then(function (rows) {
        if (live) setPeople(rows || []);
      }, fallback);
      return function () {
        live = false;
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [menu.open],
  );
  var pick = function (p) {
    menu.close(true);
    var api = typeof TK_api !== "undefined" ? TK_api : null;
    if (api && typeof api.bulkReady === "function" && api.bulkReady() && typeof api.reassign === "function") {
      api.reassign(task.id, p.email, { toast: "Assigned to " + (p.name || p.email) + "." }).catch(function (e) {
        TK_vToast(TK_vErrText(e));
      });
      return;
    }
    TK_vRowSave(task, { assignee_email: p.email });
  };
  var list = people || [];
  return (
    <span className="tk-pop-wrap tk-asg-wrap">
      <button
        type="button"
        ref={menu.btnRef}
        className="tk-tool-btn tk-claim-btn"
        data-tour={props.tour || undefined}
        aria-haspopup="menu"
        aria-expanded={menu.open ? "true" : "false"}
        aria-label={"Assign " + (task.text || "this task")}
        onClick={function (e) {
          e.stopPropagation();
          menu.setOpen(!menu.open);
        }}
      >
        Assign <span aria-hidden="true">{"\u25BE"}</span>
      </button>
      {menu.open ? (
        <div className="tk-menu" role="menu" aria-label="Assign to" ref={menu.menuRef} onKeyDown={menu.onKeyDown}>
          {people === null ? <span className="tk-menu-note">Loading…</span> : null}
          {list.map(function (p) {
            var em = String(p.email).toLowerCase();
            return (
              <button
                key={em}
                type="button"
                role="menuitem"
                className="tk-menu-item"
                disabled={p.can_see === false}
                title={p.can_see === false ? "No access to this task's client" : undefined}
                onClick={function (e) {
                  e.stopPropagation();
                  pick(p);
                }}
              >
                <TK_vAvatar name={p.name || em} email={em} size="sm" className={TK_vRowToneClass(em).trim()} title="" decorative />
                <span className="tk-menu-label">{p.name || em}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </span>
  );
}

// "Unassigned" plus an Assign dropdown (when the row offers one).
function TK_vUnassignedClaim(props) {
  var task = props.task;
  var canClaim = !!props.onClaim && TK_vCanClaim(task);
  return (
    <span className="tk-unassigned">
      <span className={props.compact ? "tk-sr" : "tk-muted"}>Unassigned</span>
      {canClaim ? <TK_vAssignMenu task={task} tour={props.tour} /> : null}
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

// ---- Subtasks inline (tasks p3) ---------------------------------------------------------
// One batched read of every subtask the person can see (the store list
// "subtasks", kept fresh by realtime and the sweep), so a list never asks per
// parent. viewTasks are the view's own tasks; they are merged in so a subtask
// created or edited a moment ago shows at once. Returns the object the rows
// take as props.subs:
//   { kidsOf: { [parentId]: [subtask] }, isOpen(id), toggle(id), nameOf(email) }
// Open state is remembered per person in localStorage (mgb_tk_subs_open_v1).
function TK_vSubLoader() {
  if (typeof TK_api !== "undefined" && TK_api && typeof TK_api.listSubtasks === "function") return TK_api.listSubtasks();
  return Promise.resolve([]);
}

function TK_vUseSubtasks(viewTasks) {
  var list = TK_vUseList("subtasks", TK_vSubLoader);
  var openPair = React.useState(function () {
    return typeof TK_subOpenRead === "function" ? TK_subOpenRead(TK_vLsGet(TK_SUBS_OPEN_KEY, {})) : {};
  });
  var open = openPair[0];
  var setOpen = openPair[1];
  var base = list && Array.isArray(list.tasks) ? list.tasks : null;
  var kidsOf = React.useMemo(
    function () {
      if (typeof TK_subIndex !== "function") return {};
      return TK_subIndex((base || []).concat(Array.isArray(viewTasks) ? viewTasks : []));
    },
    [base, viewTasks],
  );
  var any = Object.keys(kidsOf).length > 0;
  var staff = TK_vUseStaff(any);
  var toggle = React.useCallback(function (id) {
    setOpen(function (cur) {
      var next = typeof TK_subOpenToggle === "function" ? TK_subOpenToggle(cur, id) : cur;
      TK_vLsSet(TK_SUBS_OPEN_KEY, next);
      return next;
    });
  }, []);
  var nameOf = function (email) {
    if (!email) return "";
    if (typeof TK_vStaffName === "function") return TK_vStaffName(staff, email);
    return String(email).split("@")[0];
  };
  return {
    kidsOf: kidsOf,
    isOpen: function (id) {
      return open[String(id)] === true;
    },
    toggle: toggle,
    nameOf: nameOf,
  };
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
  if (name === "grip") return <svg {...common}><circle cx="9" cy="6" r="1" /><circle cx="15" cy="6" r="1" /><circle cx="9" cy="12" r="1" /><circle cx="15" cy="12" r="1" /><circle cx="9" cy="18" r="1" /><circle cx="15" cy="18" r="1" /></svg>;
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
  if (name === "calendar") return <svg {...common}><rect x="3.5" y="5" width="17" height="15" rx="2" /><line x1="3.5" y1="10" x2="20.5" y2="10" /><line x1="8" y1="3" x2="8" y2="7" /><line x1="16" y1="3" x2="16" y2="7" /></svg>;
  if (name === "user") return <svg {...common}><circle cx="12" cy="8.5" r="3.5" /><path d="M5 20c.7-3.6 3.4-5.5 7-5.5s6.3 1.9 7 5.5" /></svg>;
  if (name === "gear") return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>;
  if (name === "folder") return <svg {...common}><path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" /></svg>;
  return <svg {...common}><circle cx="12" cy="12" r="8" /></svg>;
}

// ---- Avatar ---------------------------------------------------------------------------

// A person's uploaded profile photo (every active staff member can see
// everyone's current photo; initials when there is none). Matches by email,
// then by name. Safe where the photo files are not loaded.
function TK_vPhotoUrl(email, name) {
  var list = { rows: typeof SP_useStaffPhotos === "function" ? SP_useStaffPhotos(true) : [] };
  var em = String(email || "").trim().toLowerCase();
  var nm = String(name || "").trim().toLowerCase();
  var path = null;
  var rows = (list && list.rows) || [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (!r || !r.current_path) continue;
    if ((em && String(r.email || "").toLowerCase() === em) || (!em && nm && String(r.name || "").trim().toLowerCase() === nm)) {
      path = r.current_path;
      break;
    }
  }
  var url = typeof SPA_useSignedUrl === "function" ? SPA_useSignedUrl(path) : null;
  return url || null;
}

function TK_vAvatar(props) {
  var label = props.name || props.email || "";
  var initials = typeof TK_initials === "function" ? TK_initials(label) : String(label).slice(0, 2).toUpperCase();
  var url = TK_vPhotoUrl(props.email, props.name);
  var failPair = React.useState(false);
  var failed = failPair[0];
  var setFailed = failPair[1];
  React.useEffect(
    function () {
      setFailed(false);
    },
    [url],
  );
  return (
    <span
      className={"tk-avatar" + (props.size === "sm" ? " tk-avatar-sm" : "") + (url && !failed ? " tk-avatar-photo" : "") + (props.className ? " " + props.className : "")}
      title={props.title || label || undefined}
      aria-hidden={props.decorative ? "true" : undefined}
    >
      {url && !failed ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          onError={function () {
            setFailed(true);
          }}
        />
      ) : (
        initials
      )}
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

// ---- Project color dot and picker (tasks p3) ---------------------------------------------
// The dot is decoration: the project's name always sits next to it, so the
// color never carries meaning alone. The ten colors are CSS tokens
// (--tk-pc-<key> in tk-views.css), dark-mode safe.

function TK_vProjectDot(props) {
  var key = props.color;
  if (typeof TK_isProjectColor === "function" ? !TK_isProjectColor(key) : !key) return null;
  return <span className={"tk-pdot tk-pc-" + key + (props.size === "lg" ? " tk-pdot-lg" : "")} aria-hidden="true" data-tour={props.tour || undefined} />;
}

// Save a project's color; toasts a failure. Resolves with the key, or null.
function TK_vSetProjectColor(projectId, key) {
  if (!projectId || typeof TK_api === "undefined" || !TK_api || typeof TK_api.setProjectColor !== "function") return Promise.resolve(null);
  return TK_api.setProjectColor(projectId, key).catch(function (e) {
    TK_vToast(typeof TK_projectColorError === "function" ? TK_projectColorError(e) : "Couldn't save that color. Try again.");
    return null;
  });
}

// props: { value, disabled, onPick(key), label }. Ten swatch buttons; the
// chosen one has aria-pressed and a check. Each button is named by its color.
function TK_vColorPicker(props) {
  var colors = typeof TK_PROJECT_COLORS !== "undefined" ? TK_PROJECT_COLORS : [];
  return (
    <div className="tk-colorpick" role="group" aria-label={props.label || "Project color"}>
      {colors.map(function (c) {
        var on = props.value === c.key;
        return (
          <button
            key={c.key}
            type="button"
            className={"tk-swatch tk-pc-" + c.key + (on ? " is-on" : "")}
            aria-label={c.label}
            aria-pressed={on ? "true" : "false"}
            title={c.label}
            disabled={!!props.disabled}
            onClick={function (e) {
              e.stopPropagation();
              if (!on && props.onPick) props.onPick(c.key);
            }}
          >
            {on ? <TK_vIcon name="check" size={12} /> : null}
          </button>
        );
      })}
    </div>
  );
}

// A small dialog with the picker (the project header menu opens it). Picking
// saves at once; Done closes it. props: { project, onClose }.
function TK_vColorModal(props) {
  var p = props.project || {};
  var cur = typeof TK_projectColorOf === "function" ? TK_projectColorOf(p) : "gray";
  var bPair = React.useState(false);
  var busy = bPair[0];
  var setBusy = bPair[1];
  return (
    <TK_vModal onClose={props.onClose} labelledBy="tk-color-title" className="tk-modal tk-color-modal">
      <div className="modal-header">
        <h3 className="card-title" id="tk-color-title" style={{ margin: 0 }}>
          Project color
        </h3>
        <button type="button" className="modal-close" aria-label="Close" onClick={props.onClose}>
          ×
        </button>
      </div>
      <div className="modal-body">
        <p className="tk-muted">
          {"The color shows next to " + (p.name || "this project") + " in the sidebar, the project header and task rows. Everyone sees the same color."}
        </p>
        <TK_vColorPicker
          value={cur}
          disabled={busy}
          onPick={function (key) {
            setBusy(true);
            TK_vSetProjectColor(p.id, key).then(function () {
              setBusy(false);
            });
          }}
        />
      </div>
      <div className="modal-footer tk-modal-footer">
        <button type="button" className="btn-primary" onClick={props.onClose}>
          Done
        </button>
      </div>
    </TK_vModal>
  );
}

// ---- Subtask row -------------------------------------------------------------------------
// One subtask under its parent: a checkbox (completes or reopens it through the
// same path as every row), the title (opens the drawer), the assignee and due
// date. No status pill, no menu; the drawer has the rest.

function TK_vSubRow(props) {
  var t = props.task;
  if (!t) return null;
  var status = TK_vStatusOf(t);
  var done = status === "done";
  var today = props.today || TK_vToday();
  var who = props.nameOf && t.assignee_email ? props.nameOf(t.assignee_email) : "";
  var openClick = function (e) {
    if (typeof TK_openTaskClick === "function") {
      TK_openTaskClick(t.id)(e);
      return;
    }
    if (!TK_vPlainClick(e)) return;
    e.preventDefault();
    if (props.onOpen) props.onOpen(t.id);
  };
  return (
    <li
      className={"tk-row tk-subrow" + (done ? " is-done" : "")}
      role="row"
      data-tk-sub={t.id}
      onClick={function (e) {
        var el = e.target;
        if (el && el.closest && el.closest("a, button, input, select, textarea, label, [role='menu']")) return;
        if (props.onOpen) props.onOpen(t.id);
      }}
    >
      <div className="tk-cell tk-cell-check" role="gridcell">
        {props.onToggleDone ? (
          <button
            type="button"
            className={"tk-check" + (done ? " is-on" : "")}
            role="checkbox"
            aria-checked={done ? "true" : "false"}
            aria-label={(done ? "Mark not done: " : "Mark done: ") + (t.text || "Untitled subtask")}
            onClick={function (e) {
              e.stopPropagation();
              props.onToggleDone(t);
            }}
          >
            {done ? <TK_vIcon name="check" size={13} /> : null}
          </button>
        ) : (
          <span className={"tk-dot tk-st-" + status} aria-hidden="true" />
        )}
      </div>
      <div className="tk-cell tk-cell-main" role="gridcell">
        <a className="tk-row-title" href={TK_vTaskHref(t.id)} onClick={openClick}>
          {t.text || "Untitled subtask"}
        </a>
      </div>
      <div className="tk-cell tk-subrow-end" role="gridcell">
        {who ? (
          <span className="tk-who" title={who}>
            <TK_vAvatar name={who} size="sm" decorative />
            <span className="tk-who-name">{who}</span>
          </span>
        ) : null}
        <TK_DuePill task={t} today={today} />
      </div>
    </li>
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

// ---- In-place cells (T1) ----------------------------------------------------------------
// Assignee, due date and priority each open a small menu on the row itself.
// They save through TK_api.update (reassign has its own call, with Undo) and
// show only what TK_rwAccess allows; the server still decides.

function TK_vRowSave(task, patch) {
  if (!task || typeof TK_api === "undefined" || !TK_api || typeof TK_api.update !== "function") return Promise.resolve(null);
  if ("due_date" in patch && typeof TK_rwDueError === "function") {
    var err = TK_rwDueError(task, patch.due_date);
    if (err) {
      TK_vToast(err);
      return Promise.resolve(null);
    }
  }
  // As the drawer saves it: due_at follows the day (keeping a time of day) and
  // clearing the date ends a repeat.
  if ("due_date" in patch && typeof TK_rwDueSavePatch === "function") {
    patch = TK_rwDueSavePatch(task, patch, {
      dueAt: typeof TK_dlDueAt === "function" ? TK_dlDueAt : null,
      timeOf: typeof TK_dlTimeOf === "function" ? TK_dlTimeOf : null,
    });
  }
  return TK_api.update(task.id, patch, { optimistic: true }).catch(function (e) {
    TK_vToast(TK_vErrText(e));
    return null;
  });
}

// Open state, focus handling and keys for one small menu (Esc closes and
// returns focus to the button; arrows move; Tab leaves; a press outside closes).
function TK_vUseMenu() {
  var pair = React.useState(false);
  var open = pair[0];
  var setOpen = pair[1];
  var btnRef = React.useRef(null);
  var menuRef = React.useRef(null);
  var close = React.useCallback(function (refocus) {
    setOpen(false);
    if (refocus && btnRef.current) {
      try {
        btnRef.current.focus({ preventScroll: true });
      } catch (e) {}
    }
  }, []);
  React.useEffect(
    function () {
      if (!open) return undefined;
      var first = menuRef.current ? menuRef.current.querySelector('[role^="menuitem"]:not([disabled])') : null;
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
  var onKeyDown = function (e) {
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
    if (e.target && e.target.tagName === "INPUT") return;
    e.preventDefault();
    var list = menuRef.current ? Array.prototype.slice.call(menuRef.current.querySelectorAll('[role^="menuitem"]:not([disabled])')) : [];
    if (!list.length) return;
    var i = list.indexOf(document.activeElement);
    var j = e.key === "Home" ? 0 : e.key === "End" ? list.length - 1 : e.key === "ArrowDown" ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
    try {
      list[j].focus();
    } catch (err) {}
  };
  return { open: open, setOpen: setOpen, btnRef: btnRef, menuRef: menuRef, close: close, onKeyDown: onKeyDown };
}

// A staff name from the store's staff list (already loaded by the list; no query).
function TK_vRowNameOf(staff, email, given) {
  if (given) return given;
  var em = String(email || "").toLowerCase();
  var hit = (staff || []).filter(function (s) {
    return s && String(s.email || "").toLowerCase() === em;
  })[0];
  return (hit && hit.name) || em;
}

function TK_vRowToneClass(key) {
  return " tk-av-" + (typeof TK_rwAvatarTone === "function" ? TK_rwAvatarTone(key) : 0);
}

// props: { task, name, editable, showName, claimable, onClaim }
function TK_vRowAssignee(props) {
  var task = props.task;
  var email = TK_vAssigneeOf(task);
  var menu = TK_vUseMenu();
  var staff = TK_vUseStore(function (s) {
    return s ? s.staff : null;
  });
  var peoplePair = React.useState(null);
  var people = peoplePair[0];
  var setPeople = peoplePair[1];
  var name = email ? TK_vRowNameOf(staff, email, props.name) : "";

  // The pick list loads when the menu first opens (the drawer's own call).
  React.useEffect(
    function () {
      if (!menu.open || people !== null) return undefined;
      var live = true;
      var fallback = function () {
        if (live) setPeople((staff || []).map(function (s) { return { email: String(s.email || "").toLowerCase(), name: s.name, can_see: true }; }));
      };
      if (typeof TK_api === "undefined" || !TK_api || typeof TK_api.assignable !== "function") {
        fallback();
        return undefined;
      }
      Promise.resolve(TK_api.assignable({ clientId: task.client_id, projectId: task.project_id })).then(function (rows) {
        if (live) setPeople(rows || []);
      }, fallback);
      return function () {
        live = false;
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [menu.open],
  );

  var face = email ? (
    <TK_vAvatar name={name || email} email={email} size="sm" className={TK_vRowToneClass(email).trim()} title="" decorative />
  ) : (
    <span className="tk-avatar tk-avatar-sm tk-avatar-empty" aria-hidden="true">
      <TK_vIcon name="user" size={13} />
    </span>
  );
  var shownName = props.showName && email ? <span className="tk-who-name">{name}</span> : null;
  var hint = email ? null : <span className="tk-ph-label">Assign</span>;
  if (!props.editable) {
    // Slate plus: a link to their profile while the gate is on. A plain check
    // (no hook per row); off, the row renders exactly as before.
    if (email && typeof TKP_PersonLink === "function" && typeof TKP_on === "function" && TKP_on()) {
      return (
        <span className="tk-asg" title={email ? name : "Unassigned"}>
          <TKP_PersonLink email={email} className="tkp-asg-link" title={"See " + name + "'s profile"}>
            {face}
            {shownName}
          </TKP_PersonLink>
          <span className="tk-sr">{email ? "Assignee: " + name : "Unassigned"}</span>
        </span>
      );
    }
    return (
      <span className="tk-asg" title={email ? name : "Unassigned"}>
        {face}
        {shownName}
        <span className="tk-sr">{email ? "Assignee: " + name : "Unassigned"}</span>
      </span>
    );
  }
  var list = (people || []).slice();
  if (email && !list.some(function (p) { return String(p.email).toLowerCase() === email; })) list.unshift({ email: email, name: name, can_see: true });
  var pick = function (p) {
    menu.close(true);
    if (String(p.email).toLowerCase() === email) return;
    var api = typeof TK_api !== "undefined" ? TK_api : null;
    if (api && typeof api.bulkReady === "function" && api.bulkReady() && typeof api.reassign === "function") {
      api.reassign(task.id, p.email, { toast: "Reassigned to " + (p.name || p.email) + "." }).catch(function (e) {
        TK_vToast(TK_vErrText(e));
      });
      return;
    }
    TK_vRowSave(task, { assignee_email: p.email });
  };
  return (
    <span className="tk-pop-wrap tk-asg-wrap">
      <button
        type="button"
        ref={menu.btnRef}
        className={"tk-cellbtn tk-asg" + (email ? "" : " is-empty")}
        aria-haspopup="menu"
        aria-expanded={menu.open ? "true" : "false"}
        aria-label={email ? "Assignee: " + name + ". Change assignee" : "No assignee. Assign someone"}
        title={email ? name : "Assign someone"}
        onClick={function (e) {
          e.stopPropagation();
          menu.setOpen(!menu.open);
        }}
      >
        {face}
        {shownName}
        {hint}
      </button>
      {menu.open ? (
        <div className="tk-menu" role="menu" aria-label="Assign to" ref={menu.menuRef} onKeyDown={menu.onKeyDown}>
          {email && typeof TKP_on === "function" && TKP_on() ? (
            // Slate plus: open the assignee's profile (hidden while the gate is off).
            <button
              type="button"
              role="menuitem"
              className="tk-menu-item tkp-menu-profile"
              onClick={function (e) {
                e.stopPropagation();
                menu.close(true);
                if (typeof TKP_openPerson === "function") TKP_openPerson(email);
              }}
            >
              <TK_vIcon name="user" size={14} />
              <span className="tk-menu-label">{"See " + name + "'s profile"}</span>
            </button>
          ) : null}
          {people === null ? <span className="tk-menu-note">Loading…</span> : null}
          {list.map(function (p) {
            var em = String(p.email).toLowerCase();
            var on = em === email;
            return (
              <button
                key={em}
                type="button"
                role="menuitemradio"
                aria-checked={on ? "true" : "false"}
                className="tk-menu-item"
                disabled={p.can_see === false}
                title={p.can_see === false ? "No access to this task's client" : undefined}
                onClick={function (e) {
                  e.stopPropagation();
                  pick(p);
                }}
              >
                <TK_vAvatar name={p.name || em} email={em} size="sm" className={TK_vRowToneClass(em).trim()} title="" decorative />
                <span className="tk-menu-label">{p.name || em}</span>
                {on ? <TK_vIcon name="check" size={14} /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </span>
  );
}

// props: { task, today, editable }
function TK_vRowDue(props) {
  var task = props.task;
  var today = props.today || TK_vToday();
  var menu = TK_vUseMenu();
  var datePair = React.useState(false);
  var showDate = datePair[0];
  var setShowDate = datePair[1];
  var label = typeof TK_dueLabel === "function" ? TK_dueLabel(task, today) : task.due_date ? String(task.due_date) : "";
  var has = !!label;
  var tone = has && typeof TK_rwDueTone === "function" ? TK_rwDueTone(task, today) : "";
  // Month rhythm S6: in Close order the date is a target hint, never red
  if (props.hint && tone === "late") tone = "";
  var cls = "tk-due" + (has ? " tk-due-chip" : " tk-due-empty") + (tone === "late" ? " tk-due-late is-late" : tone === "today" ? " is-today" : "") + (props.hint && has ? " is-hint" : "");
  var title = has ? (props.hint ? "Target " : tone === "late" ? "Overdue, due " : "Due ") + String(task.due_date).slice(0, 10) : "No due date";
  var content = has ? (
    <span>{label}</span>
  ) : (
    <React.Fragment>
      <TK_vIcon name="calendar" size={14} />
      <span className="tk-ph-label">Add date</span>
    </React.Fragment>
  );
  if (!props.editable) {
    if (!has) return <span className={cls} title={title}>{content}<span className="tk-sr">No due date</span></span>;
    return <span className={cls} title={title}>{content}</span>;
  }
  var apply = function (patch) {
    menu.close(true);
    setShowDate(false);
    if (patch) TK_vRowSave(task, patch);
  };
  var choices = typeof TK_rwDueChoices === "function" ? TK_rwDueChoices(today) : [];
  return (
    <span className="tk-pop-wrap tk-due-wrap">
      <button
        type="button"
        ref={menu.btnRef}
        className={cls + " tk-cellbtn"}
        aria-haspopup="menu"
        aria-expanded={menu.open ? "true" : "false"}
        aria-label={has ? "Due " + label + ". Change due date" : "No due date. Add one"}
        title={title}
        onClick={function (e) {
          e.stopPropagation();
          setShowDate(false);
          menu.setOpen(!menu.open);
        }}
      >
        {content}
      </button>
      {menu.open ? (
        <div className="tk-menu" role="menu" aria-label="Due date" ref={menu.menuRef} onKeyDown={menu.onKeyDown}>
          {choices.map(function (c) {
            return (
              <button
                key={c.key}
                type="button"
                role="menuitem"
                className="tk-menu-item"
                onClick={function (e) {
                  e.stopPropagation();
                  apply(TK_rwDuePatch(c.key, today));
                }}
              >
                <span className="tk-menu-label">{c.label}</span>
                <span className="tk-menu-hint">{typeof TK_dueLabel === "function" && c.key !== "today" ? TK_dueLabel({ due_date: c.date }, today) : ""}</span>
              </button>
            );
          })}
          {showDate ? (
            <input
              type="date"
              className="tk-menu-date"
              aria-label="Pick a due date"
              autoFocus
              onClick={function (e) {
                e.stopPropagation();
              }}
              onChange={function (e) {
                // Starts empty, so the box only reports a value once the day,
                // month and year are all in; TK_rwDuePatch also skips a year
                // still being typed. A pick from the calendar saves at once.
                var patch = TK_rwDuePatch("date", today, e.target.value);
                if (patch) apply(patch);
              }}
            />
          ) : (
            <button
              type="button"
              role="menuitem"
              className="tk-menu-item"
              onClick={function (e) {
                e.stopPropagation();
                setShowDate(true);
              }}
            >
              <span className="tk-menu-label">Pick a date…</span>
            </button>
          )}
          {has ? (
            <button
              type="button"
              role="menuitem"
              className="tk-menu-item tk-menu-danger"
              onClick={function (e) {
                e.stopPropagation();
                apply(TK_rwDuePatch("clear", today));
              }}
            >
              <span className="tk-menu-label">Clear date</span>
            </button>
          ) : null}
        </div>
      ) : null}
    </span>
  );
}

// props: { task, editable }
function TK_vRowPrio(props) {
  var task = props.task;
  var menu = TK_vUseMenu();
  var priority = typeof TK_rwPriorityOf === "function" ? TK_rwPriorityOf(task) : task.priority === "high" || task.priority === "low" ? task.priority : "normal";
  var label = typeof TK_PRIORITY_LABELS !== "undefined" && TK_PRIORITY_LABELS[priority] ? TK_PRIORITY_LABELS[priority] : priority;
  var content = (
    <React.Fragment>
      <span className={"tk-prio-dot tk-prio-dot-" + priority} aria-hidden="true" />
      <span>{label}</span>
    </React.Fragment>
  );
  var cls = "tk-prio tk-prio-" + priority;
  if (!props.editable) return <span className={cls} title={"Priority: " + label}>{content}</span>;
  var options = typeof TK_RW_PRIORITIES !== "undefined" ? TK_RW_PRIORITIES : [{ key: "high", label: "High" }, { key: "normal", label: "Normal" }, { key: "low", label: "Low" }];
  return (
    <span className="tk-pop-wrap tk-prio-wrap">
      <button
        type="button"
        ref={menu.btnRef}
        className={cls + " tk-cellbtn"}
        aria-haspopup="menu"
        aria-expanded={menu.open ? "true" : "false"}
        aria-label={"Priority: " + label + ". Change priority"}
        title={"Priority: " + label}
        onClick={function (e) {
          e.stopPropagation();
          menu.setOpen(!menu.open);
        }}
      >
        {content}
      </button>
      {menu.open ? (
        <div className="tk-menu tk-menu-right" role="menu" aria-label="Priority" ref={menu.menuRef} onKeyDown={menu.onKeyDown}>
          {options.map(function (o) {
            var on = o.key === priority;
            return (
              <button
                key={o.key}
                type="button"
                role="menuitemradio"
                aria-checked={on ? "true" : "false"}
                className="tk-menu-item"
                onClick={function (e) {
                  e.stopPropagation();
                  menu.close(true);
                  if (!on) TK_vRowSave(task, { priority: o.key });
                }}
              >
                <span className={"tk-prio-dot tk-prio-dot-" + o.key} aria-hidden="true" />
                <span className="tk-menu-label">{o.label}</span>
                {on ? <TK_vIcon name="check" size={14} /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </span>
  );
}

// The "..." menu: only things the row or the drawer already does elsewhere.
// props: { task, href, onOpen(), onToggleDone(task), done, onClaim, canClaim, allowDone }
function TK_vRowMore(props) {
  var task = props.task;
  var menu = TK_vUseMenu();
  var copy = function () {
    var url = window.location.origin + "/" + props.href;
    var ok = function () { TK_vToast(TK_vCopy("linkCopied", "Link copied.")); };
    var fail = function () { TK_vToast("Couldn't copy the link."); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(ok, fail);
      else fail();
    } catch (e) {
      fail();
    }
  };
  var items = [{ key: "open", label: "Open", run: props.onOpen }];
  if (props.allowDone) items.push({ key: "done", label: props.done ? "Mark not done" : "Mark done", run: function () { props.onToggleDone(task); } });
  if (props.canClaim) items.push({ key: "claim", label: "Assign to me", run: function () { props.onClaim(task); } });
  // Slate app interactions: Duplicate (Cmd+D). Off the app, the menu is as before.
  if (props.allowDone && typeof TK_slateInApp === "function" && TK_slateInApp() && typeof TK_api !== "undefined" && TK_api && typeof TK_api.copyRun === "function") {
    items.push({ key: "dup", label: "Duplicate", run: function () { TK_api.copyRun([task.id], null).catch(function (e) { TK_vToast(TK_vErrText(e)); }); } });
  }
  items.push({ key: "link", label: "Copy link", run: copy });
  return (
    <span className="tk-pop-wrap tk-more-wrap">
      <button
        type="button"
        ref={menu.btnRef}
        className="tk-rowmore"
        aria-haspopup="menu"
        aria-expanded={menu.open ? "true" : "false"}
        aria-label={"More actions for " + (task.text || "this task")}
        title="More actions"
        onClick={function (e) {
          e.stopPropagation();
          menu.setOpen(!menu.open);
        }}
      >
        <TK_vIcon name="more" size={16} />
      </button>
      {menu.open ? (
        <div className="tk-menu tk-menu-right" role="menu" aria-label="More actions" ref={menu.menuRef} onKeyDown={menu.onKeyDown}>
          {items.map(function (it) {
            return (
              <button
                key={it.key}
                type="button"
                role="menuitem"
                className="tk-menu-item"
                onClick={function (e) {
                  e.stopPropagation();
                  menu.close(it.key !== "open");
                  it.run();
                }}
              >
                <span className="tk-menu-label">{it.label}</span>
              </button>
            );
          })}
        </div>
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
// T1 (Desk plan): the assignee, due date and priority cells open a small menu on the
//   row and save through TK_api.update; editFields={false} makes them plain labels
//   (the review queue and the drawer's subtask list). Who may edit is TK_rwAccess
//   (TK_rowLogic.js); canEdit={false} (view-only, offline) turns all of it off. The
//   "..." menu (Open, Mark done, Claim, Copy link) shows on hover and focus.
// Tasks p3: subs (from TK_vUseSubtasks; a task with subtasks shows a chevron and a
//   done count and opens them beneath it; no subs = no nesting, as in the drawer's
//   own subtask list), projectColor (a palette key; a dot before the project name).
// P4-3 (all optional; rows without onSelect look and work as before, e.g. the
//   Workbench hub): onSelect(id, shiftKey) shows a select box before the title
//   (on hover, or always once anything is selected: `selecting`), selected.

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
  // R2: the task showing in the Desk's task view (TK_store.deskTaskId) is marked
  // on every list it appears in. The modal drawer (drawerId) is not, so rows
  // look exactly as before while the Desk is off.
  var deskOpen = TK_vUseStore(function (s) {
    return !!s && id != null && s.deskTaskId != null && String(s.deskTaskId) === String(id);
  });
  var unassigned = !TK_vAssigneeOf(task);
  // T1: the dashed assignee circle already says "Unassigned", so the label is read aloud only.
  var claimBits = unassigned ? <TK_vUnassignedClaim task={task} onClaim={props.onClaim} compact tour={props.tourClaim ? "tk-claim" : undefined} /> : null;
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
  // Tasks p3: subtasks inline. A row with subtasks opens/closes them from its
  // body; the title link still opens the drawer.
  var subs = props.subs || null;
  var kids = subs && subs.kidsOf && subs.kidsOf[String(id)] ? subs.kidsOf[String(id)] : null;
  var hasKids = !!(kids && kids.length);
  var subOpen = hasKids && subs.isOpen(id);
  var subCount = hasKids ? TK_subCount(kids) : null;
  var onRowClick = function (e) {
    var t = e.target;
    var kind = t && t.closest && t.closest("a, button, input, select, textarea, label, [role='menu']") ? "interactive" : "body";
    var act = TK_subRowClickAction(hasKids, kind);
    if (act === "none") return;
    if (props.onFocusRow) props.onFocusRow(id);
    if (act === "toggle") subs.toggle(id);
    else if (props.onOpen) props.onOpen(id);
  };
  var onRowKeyDown = function (e) {
    if (!hasKids || e.target !== e.currentTarget) return;
    var act = TK_subKeyAction(e.key, hasKids, subOpen);
    if (!act) return;
    e.preventDefault();
    subs.toggle(id);
  };
  var cl = props.checklist && props.checklist.total ? props.checklist : null;
  // T1: the three cells that edit in place. editFields={false} turns them into plain labels.
  var access =
    typeof TK_rwAccess === "function"
      ? TK_rwAccess(task, { me: props.me || TK_vMe(), isAdmin: !!props.isAdmin, canEdit: props.canEdit !== false && props.editFields !== false })
      : { edit: false, assign: false };
  var assigneeCell = <TK_vRowAssignee task={task} name={props.assigneeName} editable={access.assign} showName={!!props.columns} />;
  var dueCell = <TK_vRowDue task={task} today={today} editable={access.edit} hint={!!props.dueHint} />;
  var prioCell = <TK_vRowPrio task={task} editable={access.edit} />;
  var moreBtn = (
    <TK_vRowMore
      task={task}
      href={href}
      done={done}
      allowDone={!!props.onToggleDone && props.canEdit !== false}
      onToggleDone={props.onToggleDone}
      canClaim={!!props.onClaim && TK_vCanClaim(task)}
      onClaim={props.onClaim}
      onOpen={function () {
        if (props.onFocusRow) props.onFocusRow(id);
        if (props.onOpen) props.onOpen(id);
        else TK_vOpenTask(id, { from: "list" });
      }}
    />
  );
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
  if (props.projectName)
    meta.push(
      <span key="p" className="tk-meta-project">
        <TK_vProjectDot color={props.projectColor} />
        {props.projectName}
      </span>,
    );
  if (task.section && props.showSection) meta.push(<span key="s">{task.section}</span>);
  if (cl) meta.push(<span key="cl" className="tk-meta-check" title="Checklist">{cl.done + "/" + cl.total}</span>);
  // tasks p2 s4: made by a recurring template
  if (task.source === "template") meta.push(<span key="rc" className="tk-meta-recurring" title="Made by a recurring template">Recurring</span>);
  if (props.snippet) meta.push(<span key="sn" className="tk-meta-snippet">{"In a comment: " + props.snippet}</span>);
  if (props.note) meta.push(<span key="nt" className="tk-meta-note">{props.note}</span>);
  // Month rhythm S6 (Close order): the first open step, or one waiting on the client
  if (props.pill === "next") meta.unshift(<span key="pl" className="pill good tk-close-pill">Next</span>);
  else if (props.pill === "waiting") meta.unshift(<span key="pl" className="pill warm tk-close-pill">Waiting on client</span>);

  var toggleBtn = hasKids ? (
    <button
      type="button"
      className={"tk-subtoggle" + (subOpen ? " is-open" : "")}
      aria-expanded={subOpen ? "true" : "false"}
      aria-label={TK_subToggleLabel(task.text, subCount, subOpen)}
      data-tour="tk-subtoggle"
      onClick={function (e) {
        e.stopPropagation();
        if (props.onFocusRow) props.onFocusRow(id);
        subs.toggle(id);
      }}
    >
      <TK_vIcon name="chevron" size={14} className="tk-subtoggle-chev" />
      <span className="tk-subtoggle-count">{TK_subChipText(subCount)}</span>
    </button>
  ) : null;

  var selectable = typeof props.onSelect === "function";
  var selected = selectable && !!props.selected;
  var selectBox = selectable ? (
    <input
      type="checkbox"
      className="tk-sel"
      data-tour="tk-select"
      checked={selected}
      aria-label={(selected ? "Unselect " : "Select ") + (task.text || "this task")}
      title="Select (v). Shift-click selects a range."
      onChange={function () {}}
      onClick={function (e) {
        e.stopPropagation();
        if (props.onFocusRow) props.onFocusRow(id);
        props.onSelect(id, !!e.shiftKey);
      }}
    />
  ) : null;

  var parentRow = (
    <li
      ref={ref}
      className={
        "tk-row" +
        (focused ? " is-focused" : "") +
        (done ? " is-done" : "") +
        (props.columns ? " tk-row-cols" : "") +
        (hasKids ? " has-subs" + (subOpen ? " is-subs-open" : "") : "") +
        (selectable ? " is-selectable" : "") +
        (selected ? " is-selected" : "") +
        (selectable && props.selecting ? " is-selecting" : "") +
        (deskOpen ? " is-open-in-desk" : "")
      }
      data-lk={"task:" + id}
      data-tk-id={id}
      role="row"
      aria-selected={focused ? "true" : "false"}
      tabIndex={focused ? 0 : -1}
      onClick={onRowClick}
      onKeyDown={onRowKeyDown}
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
        <div className="tk-row-titleline">
          {props.dragHandle ? (
            <button
              type="button"
              className="tk-drag-handle"
              data-tk-drag-handle="1"
              tabIndex={-1}
              aria-hidden="true"
              title="Drag to reorder (Alt+Up or Alt+Down)"
            >
              <TK_vIcon name="grip" size={14} />
            </button>
          ) : null}
          {selectBox}
          <a className="tk-row-title" href={href} onClick={openClick}>
            {task.text || "Untitled task"}
          </a>
          {typeof TK_EmailDraftButton === "function" ? <TK_EmailDraftButton task={task} compact={true} /> : null}
          {toggleBtn}
          {moreBtn}
        </div>
        <div className="tk-row-meta">
          {meta}
          {props.columns ? null : (
            <span className="tk-row-chips">
              {assigneeCell}
              {dueCell}
              {prioCell}
            </span>
          )}
          {props.columns ? (
            <span className="tk-row-phone">
              {assigneeCell}
              {dueCell}
              {prioCell}
            </span>
          ) : null}
        </div>
      </div>
      {props.columns ? (
        <React.Fragment>
          <div className="tk-cell tk-cell-who" role="gridcell">
            {assigneeCell}
            {claimBits}
          </div>
          <div className="tk-cell tk-cell-due" role="gridcell">
            {dueCell}
          </div>
          <div className="tk-cell tk-cell-status" role="gridcell">
            {statusPill}
          </div>
          <div className="tk-cell tk-cell-prio" role="gridcell">
            {prioCell}
          </div>
        </React.Fragment>
      ) : (
        <div className="tk-cell tk-cell-status" role="gridcell">
          {props.showUnassigned !== false ? claimBits : null}
          {props.trailing || null}
          {statusPill}
        </div>
      )}
    </li>
  );
  if (!subOpen) return parentRow;
  return (
    <React.Fragment>
      {parentRow}
      {kids.map(function (k) {
        return (
          <TK_vSubRow
            key={k.id}
            task={k}
            today={today}
            nameOf={subs.nameOf}
            onOpen={function (kid) {
              if (props.onFocusRow) props.onFocusRow(id);
              TK_vOpenTask(kid, { from: "list" });
            }}
            onToggleDone={props.onToggleDone && props.canEdit !== false ? function (kid) {
              TK_vComplete(kid, props.isAdmin);
            } : undefined}
          />
        );
      })}
    </React.Fragment>
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
      <h2 className="tk-setup-title">{TK_vCopy("setupTitle", "Slate is being set up")}</h2>
      <p className="tk-setup-body">{TK_vCopy("setupBody")}</p>
      {props.embedded ? null : (
        <a className="btn-secondary tk-setup-link" href="#/work/tasks">
          Open Work › Slate
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
