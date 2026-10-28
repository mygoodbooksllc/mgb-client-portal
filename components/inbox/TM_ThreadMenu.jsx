// ----------------------------------------------------------------------------
// TM_ThreadMenu: the client message thread menu (docs/thread-menu-spec.md 5).
// Staff only, and only while TM_useThreadMenu() is on (TM_gate.js).
//
//   TM_api               the thread_* RPC wrappers + client_thread_state reads.
//                        Every write fires window "mgb:thread-state-changed"
//                        with the returned row.
//   TM_useThreadStates   state rows for the clients in view, kept fresh.
//   TM_useStaffNames     { email: name } for the "Assigned:" tag.
//   TM_openMenu          opens the menu (and its dialogs) in a separate React
//                        root on <body>, so nothing it does bubbles into the
//                        list, the chat drawer or the Desk.
//   TM_openDeskMenu      the Desk Inbox entry point for a message row.
//
// Everything is audited server side and silent: no email, no notification,
// nothing the client can see. Rules live in TM_logic.js (pure, tested).
// Loads right after StaffInbox.jsx; ModalShell (app.jsx), TK_api, TK_openTask,
// LK_href and WB_store are used at call time only, each guarded.
// ----------------------------------------------------------------------------

var TM_STATE_EVENT = "mgb:thread-state-changed";

// TM__lower comes from TM_logic.js.
function TM__key(clientId, email) {
  return "c:" + clientId + ":" + TM__lower(email);
}
function TM__toast(text, action) {
  try {
    window.dispatchEvent(new CustomEvent("mgb:toast", { detail: { text: text, action: action || undefined } }));
  } catch (e) {}
}

// ---- RPCs and reads ---------------------------------------------------------
var TM_api = (function () {
  function sb() {
    return typeof window !== "undefined" ? window.mgbSupabase || null : null;
  }
  function base(t) {
    return { p_client_id: String(t.clientId), p_email: TM__lower(t.email) };
  }
  function rpc(name, t, extra) {
    var c = sb();
    if (!c) return Promise.reject(new Error("offline"));
    return Promise.resolve(c.rpc(name, Object.assign(base(t), extra || {}))).then(function (res) {
      if (!res || res.error) throw (res && res.error) || new Error("failed");
      var row = Array.isArray(res.data) ? res.data[0] : res.data;
      if (row) {
        try {
          window.dispatchEvent(new CustomEvent(TM_STATE_EVENT, { detail: { row: row } }));
        } catch (e) {}
      }
      return row || null;
    });
  }
  return {
    label: function (t, v) {
      return rpc("thread_set_label", t, { p_label: v == null ? "" : v });
    },
    hide: function (t) {
      return rpc("thread_hide", t);
    },
    restore: function (t) {
      return rpc("thread_restore", t);
    },
    done: function (t, on) {
      return rpc("thread_set_done", t, { p_done: !!on });
    },
    snooze: function (t, until) {
      return rpc("thread_snooze", t, { p_until: until || null });
    },
    pin: function (t, on) {
      return rpc("thread_set_pin", t, { p_pinned: !!on });
    },
    assign: function (t, email) {
      return rpc("thread_assign", t, { p_assignee: email || null });
    },
    logTask: function (t, taskId) {
      return rpc("thread_log_task", t, { p_task_id: String(taskId) });
    },
    // { key: row } for these clients (RLS limits it to what this staffer can see).
    list: function (ids) {
      var c = sb();
      if (!c || !ids || !ids.length) return Promise.resolve({});
      return Promise.resolve(c.from("client_thread_state").select(TM_COLS).in("client_id", ids)).then(function (res) {
        if (!res || res.error) throw (res && res.error) || new Error("failed");
        var map = {};
        (res.data || []).forEach(function (r) {
          map[TM__key(r.client_id, r.participant_email)] = r;
        });
        return map;
      });
    },
    one: function (t) {
      var c = sb();
      if (!c) return Promise.resolve(null);
      return Promise.resolve(
        c.from("client_thread_state").select(TM_COLS).eq("client_id", String(t.clientId)).eq("participant_email", TM__lower(t.email)).maybeSingle(),
      ).then(function (res) {
        if (!res || res.error) throw (res && res.error) || new Error("failed");
        return res.data || null;
      });
    },
  };
})();

// ---- State rows for the list ------------------------------------------------
// on: the gate (and real data). idsKey: the client ids, comma joined. bump:
// anything that changes when new messages arrive (StaffInbox's `recent`); a
// change refetches after 1s. Also refetches on window focus / tab visible,
// merges this browser's own writes at once, and re-checks snoozes on a timer
// (at most every 60s). Off: no request, no listener, no timer.
var TM__NO_STATES = { states: {}, now: 0 };
function TM_useThreadStates(on, idsKey, bump) {
  var sPair = React.useState({});
  var nPair = React.useState(function () {
    return Date.now();
  });
  var states = sPair[0];
  var setStates = sPair[1];
  var now = nPair[0];
  var setNow = nPair[1];
  var tokenRef = React.useRef(0);
  var firstRef = React.useRef(true);
  var reloadRef = React.useRef(0);
  var load = React.useCallback(
    function () {
      if (!on || !idsKey) return;
      var token = ++tokenRef.current;
      TM_api.list(idsKey.split(",")).then(
        function (map) {
          if (token !== tokenRef.current) return;
          setStates(map);
          setNow(Date.now());
        },
        function () {
          // A failed refetch keeps what we had, so threads don't flash back.
        },
      );
    },
    [on, idsKey],
  );
  React.useEffect(
    function () {
      if (!on) {
        tokenRef.current++;
        firstRef.current = true;
        setStates(function (s) {
          return Object.keys(s).length ? {} : s;
        });
        return undefined;
      }
      if (firstRef.current) {
        firstRef.current = false;
        load();
        return undefined;
      }
      var id = setTimeout(load, 1000);
      return function () {
        clearTimeout(id);
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [on, idsKey, bump],
  );
  React.useEffect(
    function () {
      if (!on) return undefined;
      var onRow = function (e) {
        var row = e && e.detail && e.detail.row;
        if (!row || !row.client_id) return;
        // A list() already in flight was read before this write: drop it, then
        // read again shortly so a teammate's change in that list still arrives.
        tokenRef.current++;
        clearTimeout(reloadRef.current);
        reloadRef.current = setTimeout(load, 600);
        var k = TM__key(row.client_id, row.participant_email);
        setStates(function (s) {
          var next = Object.assign({}, s);
          next[k] = row;
          return next;
        });
        setNow(Date.now());
      };
      var onFocus = function () {
        load();
      };
      var onVis = function () {
        if (!document.hidden) load();
      };
      window.addEventListener(TM_STATE_EVENT, onRow);
      window.addEventListener("focus", onFocus);
      document.addEventListener("visibilitychange", onVis);
      return function () {
        clearTimeout(reloadRef.current);
        window.removeEventListener(TM_STATE_EVENT, onRow);
        window.removeEventListener("focus", onFocus);
        document.removeEventListener("visibilitychange", onVis);
      };
    },
    [on, load],
  );
  var wake = on ? TM_nextWakeMs(states, now) : null;
  React.useEffect(
    function () {
      if (wake == null) return undefined;
      var id = setTimeout(function () {
        setNow(Date.now());
      }, wake);
      return function () {
        clearTimeout(id);
      };
    },
    [wake, now],
  );
  return on ? { states: states, now: now } : TM__NO_STATES;
}

// { email: "Full Name" } from the staff list (cached by TK_api). Off: nothing.
var TM__NO_NAMES = {};
function TM_useStaffNames(on) {
  var pair = React.useState(null);
  React.useEffect(
    function () {
      if (!on || pair[0] || typeof TK_api === "undefined" || !TK_api || typeof TK_api.listStaff !== "function") return undefined;
      var live = true;
      Promise.resolve(TK_api.listStaff()).then(
        function (list) {
          if (!live) return;
          var map = {};
          (list || []).forEach(function (s) {
            if (s && s.email) map[TM__lower(s.email)] = s.name || "";
          });
          pair[1](map);
        },
        function () {},
      );
      return function () {
        live = false;
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [on],
  );
  return pair[0] || TM__NO_NAMES;
}

// ---- The separate root --------------------------------------------------------
var TM__host = { root: null, el: null, open: null, closedAt: 0, closedTrigger: null };
function TM__render(node) {
  if (typeof document === "undefined" || typeof ReactDOM === "undefined") return;
  if (!TM__host.root) {
    var el = document.createElement("div");
    el.className = "tm-host";
    document.body.appendChild(el);
    TM__host.el = el;
    TM__host.root = ReactDOM.createRoot(el);
  }
  var root = TM__host.root;
  if (typeof ReactDOM.flushSync === "function") {
    ReactDOM.flushSync(function () {
      root.render(node);
    });
  } else root.render(node);
}
function TM__focus(el) {
  try {
    if (el && el.focus && document.contains(el)) el.focus({ preventScroll: true });
  } catch (e) {}
}
// Close whatever is open. restore: put focus back on the trigger.
function TM_closeMenu(restore) {
  var o = TM__host.open;
  TM__host.open = null;
  if (o) {
    TM__host.closedAt = Date.now();
    // Only a pointer close (restore false) arms the ⋯ toggle guard, so Esc then Enter reopens at once.
    TM__host.closedTrigger = restore ? null : o.trigger || null;
  }
  TM__render(null);
  if (restore && o) TM__focus(o.trigger);
}

// ---- Menu ---------------------------------------------------------------------
// props: x, y, items, snoozeItems, ariaLabel, onPick(id), onClose(restore)
function TM_Menu(props) {
  var ref = React.useRef(null);
  var subPair = React.useState(false);
  var sub = subPair[0];
  var setSub = subPair[1];
  var subRef = React.useRef(false);
  subRef.current = sub;
  var posPair = React.useState({ left: props.x, top: props.y });
  var wasSubRef = React.useRef(false);
  React.useLayoutEffect(
    function () {
      var el = ref.current;
      if (!el) return;
      var r = el.getBoundingClientRect();
      var left = Math.max(8, Math.min(props.x, window.innerWidth - r.width - 8));
      var top = Math.max(8, Math.min(props.y, window.innerHeight - r.height - 8));
      posPair[1]({ left: left, top: top });
      // Leaving the Snooze list puts focus back on Snooze; otherwise the first item.
      var back = wasSubRef.current && !sub ? el.querySelector("[data-tm-id='snooze']") : null;
      wasSubRef.current = sub;
      var first = back || el.querySelector("[role='menuitem']");
      if (first) first.focus({ preventScroll: true });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sub],
  );
  React.useEffect(function () {
    var inside = function (t) {
      return !!(ref.current && t && ref.current.contains(t));
    };
    // Window capture runs before the drawer's, ModalShell's and the Desk's
    // own key handlers, so Esc closes only this menu.
    var onKey = function (e) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (subRef.current) setSub(false);
        else props.onClose(true);
      } else if (e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        props.onClose(true);
      }
    };
    var onDown = function (e) {
      if (!inside(e.target)) props.onClose(false);
    };
    var onScroll = function (e) {
      if (!inside(e.target)) props.onClose(false);
    };
    var closeNow = function () {
      props.onClose(false);
    };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", closeNow);
    window.addEventListener("blur", closeNow);
    return function () {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", closeNow);
      window.removeEventListener("blur", closeNow);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  var onKeyDown = function (e) {
    var items = ref.current ? Array.prototype.slice.call(ref.current.querySelectorAll("[role='menuitem']")) : [];
    var i = items.indexOf(document.activeElement);
    var go = function (n) {
      e.preventDefault();
      e.stopPropagation();
      if (items.length) items[(n + items.length) % items.length].focus();
    };
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i < 0 ? items.length - 1 : i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(items.length - 1);
    else if (e.key === "ArrowRight" && !sub && document.activeElement && document.activeElement.getAttribute("data-tm-id") === "snooze") {
      e.preventDefault();
      e.stopPropagation();
      setSub(true);
    } else if (e.key === "ArrowLeft" && sub) {
      e.preventDefault();
      e.stopPropagation();
      setSub(false);
    }
  };
  var btn = function (id, label, hint, run, cls, extra) {
    return (
      <button
        key={id}
        type="button"
        role="menuitem"
        data-tm-id={id}
        className={"tk-menu-item tk-ix-item tm-item" + (cls ? " " + cls : "")}
        onClick={function (e) {
          e.stopPropagation();
          run();
        }}
        {...(extra || {})}
      >
        <span className="tk-menu-label">{label}</span>
        {hint ? (
          <span className="tk-ix-hint" aria-hidden="true">
            {hint}
          </span>
        ) : null}
      </button>
    );
  };
  var body;
  if (sub) {
    body = [btn("back", "‹ Back", "", function () { setSub(false); }, "tk-ix-back")];
    props.snoozeItems.forEach(function (id) {
      body.push(btn(id, TM_itemLabel(id), "", function () { props.onPick(id); }));
    });
  } else {
    body = props.items.map(function (id, i) {
      if (id === "-") return <div key={"sep" + i} className="tk-ix-sep" role="separator" />;
      if (id === "snooze")
        return btn(id, TM_itemLabel(id), "›", function () { setSub(true); }, "", { "aria-haspopup": "menu" });
      return btn(id, TM_itemLabel(id), "", function () { props.onPick(id); }, id === "hide" ? "tk-ix-danger" : "");
    });
  }
  return (
    <div
      ref={ref}
      className="tk-menu tk-ix-menu tm-menu"
      role="menu"
      aria-label={sub ? "Snooze until" : props.ariaLabel}
      style={{ position: "fixed", left: posPair[0].left, top: posPair[0].top }}
      onKeyDown={onKeyDown}
      onContextMenu={function (e) {
        e.preventDefault();
      }}
    >
      {body}
    </div>
  );
}

// ---- Dialogs ------------------------------------------------------------------
function TM__FallbackShell(props) {
  return (
    <div className="modal-overlay" onClick={props.onClose}>
      <div
        className={"modal-panel" + (props.className ? " " + props.className : "")}
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
function TM_Dialog(props) {
  var closeRef = React.useRef(props.onClose);
  closeRef.current = props.onClose;
  React.useEffect(function () {
    // Esc closes this dialog only (window capture runs first and stops it).
    var onKey = function (e) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      closeRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return function () {
      window.removeEventListener("keydown", onKey, true);
    };
  }, []);
  var Shell = typeof ModalShell === "function" ? ModalShell : TM__FallbackShell;
  return (
    <Shell onClose={props.onClose} labelledBy="tm-dialog-title" className="tm-dialog">
      <h2 id="tm-dialog-title" className="tm-dialog-title">
        {props.title}
      </h2>
      {props.children}
    </Shell>
  );
}

function TM_RenameDialog(props) {
  var pair = React.useState(props.initial || "");
  var errPair = React.useState("");
  var submit = function (e) {
    e.preventDefault();
    var c = TM_cleanLabel(pair[0]);
    if (!c.ok) {
      errPair[1]("Thread names can be up to " + TM_LABEL_MAX + " characters.");
      return;
    }
    props.onSave(c.value);
  };
  return (
    <TM_Dialog title="Rename thread" onClose={props.onClose}>
      <form className="tm-form" onSubmit={submit}>
        <p className="tm-help">Only staff see this name. {props.name ? "The person stays " + props.name + "." : ""}</p>
        <label className="tm-label" htmlFor="tm-rename-input">
          Thread name
        </label>
        <input
          id="tm-rename-input"
          className="tm-input"
          type="text"
          value={pair[0]}
          maxLength={TM_LABEL_MAX * 2 + 20}
          autoComplete="off"
          onChange={function (e) {
            pair[1](e.target.value);
            errPair[1]("");
          }}
        />
        {errPair[0] ? (
          <p className="tm-error" role="alert">
            {errPair[0]}
          </p>
        ) : null}
        <div className="tm-actions">
          {props.initial ? (
            <button type="button" className="btn-secondary" onClick={function () { props.onSave(null); }}>
              Clear name
            </button>
          ) : null}
          <button type="button" className="btn-secondary" onClick={props.onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary">
            Save
          </button>
        </div>
      </form>
    </TM_Dialog>
  );
}

function TM_AssignDialog(props) {
  var listPair = React.useState(null);
  var errPair = React.useState("");
  React.useEffect(function () {
    var live = true;
    if (typeof TK_api === "undefined" || !TK_api || typeof TK_api.assignable !== "function") {
      errPair[1]("Couldn't load the staff list.");
      return undefined;
    }
    Promise.resolve(TK_api.assignable({ clientId: props.clientId })).then(
      function (rows) {
        if (!live) return;
        listPair[1](
          (rows || [])
            .filter(function (r) {
              return r && r.email && r.can_see !== false;
            })
            .sort(function (a, b) {
              return String(a.name || a.email).localeCompare(String(b.name || b.email));
            }),
        );
      },
      function () {
        if (live) errPair[1]("Couldn't load the staff list.");
      },
    );
    return function () {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  var cur = TM__lower(props.current);
  var pick = function (email) {
    props.onSave(email || null);
  };
  var list = listPair[0];
  return (
    <TM_Dialog title="Reassign thread" onClose={props.onClose}>
      <p className="tm-help">Shows an "Assigned" tag to staff. Nobody is notified, and the Desk owner does not change.</p>
      {errPair[0] ? (
        <p className="tm-error" role="alert">
          {errPair[0]}
        </p>
      ) : !list ? (
        <p className="tm-help">Loading…</p>
      ) : (
        <ul className="tm-pick-list" aria-label="Assign to">
          <li>
            <button type="button" className={"tm-pick" + (!cur ? " is-current" : "")} aria-pressed={!cur} onClick={function () { pick(null); }}>
              Unassigned
            </button>
          </li>
          {list.map(function (r) {
            var on = TM__lower(r.email) === cur;
            return (
              <li key={r.email}>
                <button type="button" className={"tm-pick" + (on ? " is-current" : "")} aria-pressed={on} onClick={function () { pick(TM__lower(r.email)); }}>
                  <span>{r.name || r.email}</span>
                  {r.role ? <span className="tm-pick-sub">{r.role}</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="tm-actions">
        <button type="button" className="btn-secondary" onClick={props.onClose}>
          Cancel
        </button>
      </div>
    </TM_Dialog>
  );
}

function TM_DateDialog(props) {
  var b = TM_dateBounds(Date.now());
  var pair = React.useState(b.min);
  return (
    <TM_Dialog title="Snooze until" onClose={props.onClose}>
      <form
        className="tm-form"
        onSubmit={function (e) {
          e.preventDefault();
          if (pair[0]) props.onSave(pair[0]);
        }}
      >
        <p className="tm-help">Comes back at 8am Central that day, or sooner if the client writes.</p>
        <label className="tm-label" htmlFor="tm-date-input">
          Date
        </label>
        <input
          id="tm-date-input"
          className="tm-input"
          type="date"
          min={b.min}
          max={b.max}
          value={pair[0]}
          onChange={function (e) {
            pair[1](e.target.value);
          }}
        />
        <div className="tm-actions">
          <button type="button" className="btn-secondary" onClick={props.onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={!pair[0]}>
            Snooze
          </button>
        </div>
      </form>
    </TM_Dialog>
  );
}

// ---- Actions ------------------------------------------------------------------
function TM__fail(err) {
  TM__toast(TM_errorText(err));
}
function TM__deskRefresh() {
  try {
    if (typeof WB_store !== "undefined" && WB_store && typeof WB_store.refresh === "function") WB_store.refresh();
  } catch (e) {}
}
function TM__copy(text) {
  var fallback = function () {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try {
      ok = document.execCommand("copy");
    } catch (e) {}
    document.body.removeChild(ta);
    return ok ? Promise.resolve() : Promise.reject(new Error("copy"));
  };
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).catch(fallback);
  } catch (e) {}
  return fallback();
}
function TM__link(t) {
  if (typeof LK_href !== "function" || typeof location === "undefined") return "";
  return TM_copyLink(location.origin, location.pathname, t.clientId, t.msgId, LK_href);
}

// Run one menu choice. o: the TM_openMenu options.
function TM__run(id, o) {
  var t = o.thread;
  var s = o.state || {};
  // The menu closed without restoring focus (the row was about to leave the
  // list); if the change fails the row stays, so focus goes back to it.
  var fail = function (err) {
    TM__fail(err);
    TM__focus(o.trigger);
  };
  var done = function (action) {
    if (typeof o.onDone === "function") {
      try {
        o.onDone(action);
      } catch (e) {}
    }
  };
  var dialog = function (node) {
    TM__host.open = { key: TM__key(t.clientId, t.email), trigger: o.trigger, dialog: true };
    TM__render(node);
  };
  var closeDialog = function () {
    TM_closeMenu(true);
  };
  var snoozeTo = function (until) {
    if (!until) {
      TM__toast("Pick a time within the next 30 days.");
      return;
    }
    var prev = s.snoozed_until && Date.parse(s.snoozed_until) > Date.now() ? s.snoozed_until : null;
    TM_api.snooze(t, until).then(function () {
      done("snooze:set");
      TM__toast("Snoozed until " + (TM_shortWhen(until) || "later"), {
        label: "Undo",
        onClick: function () {
          TM_api.snooze(t, prev).catch(TM__fail);
        },
      });
    }, fail);
  };
  switch (id) {
    case "rename":
      dialog(
        <TM_RenameDialog
          initial={s.label || ""}
          name={t.name}
          onClose={closeDialog}
          onSave={function (v) {
            closeDialog();
            TM_api.label(t, v).then(function () {
              TM__toast(v ? "Thread renamed" : "Thread name cleared");
            }, TM__fail);
          }}
        />,
      );
      return;
    case "pin":
    case "unpin": {
      var on = id === "pin";
      TM_api.pin(t, on).then(function () {
        TM__toast(on ? "Pinned to top" : "Unpinned", {
          label: "Undo",
          onClick: function () {
            TM_api.pin(t, !on).catch(TM__fail);
          },
        });
      }, TM__fail);
      return;
    }
    case "done":
    case "reopen": {
      var d = id === "done";
      TM_api.done(t, d).then(function () {
        TM__deskRefresh();
        done(id);
        TM__toast(d ? "Marked done" : "Reopened", {
          label: "Undo",
          onClick: function () {
            TM_api.done(t, !d).then(TM__deskRefresh, TM__fail);
          },
        });
      }, fail);
      return;
    }
    case "snooze:tomorrow":
    case "snooze:monday":
      snoozeTo(TM_snoozeAt(id.slice(7), Date.now()));
      return;
    case "snooze:date":
      dialog(
        <TM_DateDialog
          onClose={closeDialog}
          onSave={function (ymd) {
            closeDialog();
            snoozeTo(TM_snoozeAt("date", Date.now(), ymd));
          }}
        />,
      );
      return;
    case "unsnooze":
      TM_api.snooze(t, null).then(function () {
        done("unsnooze");
        TM__toast("Unsnoozed");
      }, TM__fail);
      return;
    case "assign":
      dialog(
        <TM_AssignDialog
          clientId={t.clientId}
          current={s.assignee_email}
          onClose={closeDialog}
          onSave={function (email) {
            closeDialog();
            TM_api.assign(t, email).then(function () {
              TM__toast(email ? "Assigned to " + TM_firstName(email, o.names || {}) : "Unassigned");
            }, TM__fail);
          }}
        />,
      );
      return;
    case "task": {
      if (typeof TK_api === "undefined" || !TK_api || typeof TK_api.create !== "function") {
        TM__toast("Tasks aren't available here.");
        return;
      }
      var link = TM__link(t);
      Promise.resolve(
        TK_api.create({
          text: TM_taskText(s.label, t.name, t.clientName),
          client_id: t.clientId,
          assignee_email: o.me || undefined,
          source: "thread",
          source_ref: t.msgId,
          description: "From the message thread with " + (t.name || "the client") + "." + (link ? "\n" + link : ""),
        }),
      ).then(function (task) {
        if (!task || !task.id) return;
        TM_api.logTask(t, task.id).catch(function () {});
        TM__toast("Task created");
        if (typeof TK_openTask === "function") TK_openTask(task.id, { from: "thread" });
      }, TM__fail);
      return;
    }
    case "copy": {
      var url = TM__link(t);
      if (!url) {
        TM__toast("Couldn't make a link.");
        return;
      }
      TM__copy(url).then(
        function () {
          TM__toast("Link copied");
        },
        function () {
          TM__toast("Couldn't copy the link.");
        },
      );
      return;
    }
    case "hide":
      TM_api.hide(t).then(function () {
        TM__deskRefresh();
        done("hide");
        TM__toast(
          "Thread hidden. An admin can restore it.",
          o.isAdmin
            ? {
                label: "Undo",
                onClick: function () {
                  TM_api.restore(t).then(TM__deskRefresh, TM__fail);
                },
              }
            : null,
        );
      }, fail);
      return;
    case "restore":
      TM_api.restore(t).then(function () {
        TM__deskRefresh();
        done("restore");
        TM__toast("Thread restored");
      }, TM__fail);
      return;
    default:
      return;
  }
}

// Open the menu. o: {
//   thread: { clientId, email, name, clientName, msgId },
//   state (client_thread_state row or null), view (TM_threadView),
//   surface: "messages" | "desk", isAdmin, me, names,
//   trigger (element focus returns to), anchor (element to sit under, for a
//   keyboard or ⋯ open), x, y (pointer), onDone(action) }
function TM_openMenu(o) {
  if (!o || !o.thread || !o.thread.clientId || !o.thread.email) return;
  var key = TM__key(o.thread.clientId, o.thread.email);
  if (TM__host.open && TM__host.open.key === key) return; // already open
  // A click on the same ⋯ that just closed it (pointerdown) toggles it shut.
  if (o.x == null && o.trigger && TM__host.closedTrigger === o.trigger && Date.now() - TM__host.closedAt < 400) return;
  var x = o.x;
  var y = o.y;
  if (x == null || y == null || (x === 0 && y === 0)) {
    var a = o.anchor || o.trigger;
    var r = a && a.getBoundingClientRect ? a.getBoundingClientRect() : { left: 16, bottom: 16, right: 16 };
    x = r.left;
    y = r.bottom + 4;
  }
  var items = TM_menuItems(o.view, o.surface, !!o.isAdmin);
  TM__host.open = { key: key, trigger: o.trigger || null };
  if (o.trigger && o.trigger.setAttribute && o.trigger.classList && o.trigger.classList.contains("si-more")) o.trigger.setAttribute("aria-expanded", "true");
  var reset = function () {
    if (o.trigger && o.trigger.classList && o.trigger.classList.contains("si-more")) o.trigger.setAttribute("aria-expanded", "false");
  };
  TM__render(
    <TM_Menu
      x={x}
      y={y}
      items={items}
      snoozeItems={TM_snoozeItems(o.view)}
      ariaLabel={"Thread actions for " + (o.thread.name || "this person")}
      onClose={function (restore) {
        reset();
        TM_closeMenu(restore);
      }}
      onPick={function (id) {
        reset();
        TM_closeMenu(o.surface === "desk" || !TM_removesRow(id));
        TM__run(id, o);
      }}
    />,
  );
}

// The Desk Inbox: a message row (WB_Row). Reads the thread's state and its
// newest client message first, then opens the Desk set (no Snooze or Pin).
function TM_openDeskMenu(row, trigger, anchor, x, y) {
  if (!row || row.kind !== "message" || !row.client_id || !row.participant_email) return;
  var sb = window.mgbSupabase;
  var t = {
    clientId: String(row.client_id),
    email: TM__lower(row.participant_email),
    name: row.participant_name || row.title || row.participant_email,
    clientName: row.client_name || "",
    msgId: row.ref_id || row.source_id || null,
  };
  if (!t.msgId) return;
  var lastClient = sb
    ? Promise.resolve(
        sb
          .from("client_messages")
          .select("id, created_at")
          .eq("client_id", t.clientId)
          .eq("participant_email", t.email)
          .eq("author_kind", "client")
          .eq("internal", false)
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(1),
      ).then(
        function (res) {
          return res && !res.error && res.data && res.data[0] ? res.data[0].created_at : null;
        },
        function () {
          return null;
        },
      )
    : Promise.resolve(null);
  var me = "";
  try {
    me = (WB_store.getState() || {}).me || "";
  } catch (e) {}
  var admin =
    typeof TK_api !== "undefined" && TK_api && typeof TK_api.listStaff === "function"
      ? Promise.resolve(TK_api.listStaff()).then(
          function (list) {
            var mine = (list || []).find(function (s) {
              return TM__lower(s.email) === TM__lower(me);
            });
            return { admin: !!(mine && mine.role === "admin"), names: list || [] };
          },
          function () {
            return { admin: false, names: [] };
          },
        )
      : Promise.resolve({ admin: false, names: [] });
  Promise.all([TM_api.one(t).catch(function () { return null; }), lastClient, admin]).then(function (r) {
    var names = {};
    r[2].names.forEach(function (s) {
      if (s && s.email) names[TM__lower(s.email)] = s.name || "";
    });
    var view = TM_threadView({ lastClientAt: r[1] }, r[0], Date.now(), r[2].admin, names);
    TM_openMenu({
      thread: t,
      state: r[0],
      view: view,
      surface: "desk",
      isAdmin: r[2].admin,
      me: TM__lower(me),
      names: names,
      trigger: trigger,
      anchor: anchor,
      x: x,
      y: y,
    });
  });
}
