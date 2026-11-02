// ----------------------------------------------------------------------------
// TK_SlateSimple.jsx: the pieces of Slate Stage B, the simpler Slate (hidden
// preview; docs/slate-stage-b-spec.md). Every piece here renders only where a
// caller already checked TKB_useOn() (TK_slateSimple.js); with the gate off
// none of them mount, so the Slate looks exactly as before.
//
//   TKB_FilterButton({ count, children })   the Filter button + panel
//   TKB_GroupSort({ view, onChange, onReset, noGroupBy, manual })
//   TKB_AddLine({ staffUser, clients, clientId, projectId, readOnly, compact })
//   TKB_Glance({ staffUser, clients, isAdmin })   Today at a glance (pane)
//   TKB_MoreDetails({ on, count, children })  the open task's expander
//   TKB_SideAvatar({ labeled })               account avatar, sidebar bottom
//   TKB_acctSet(fn, name) / TKB_useSideAvatar()  the shared account menu:
//       TK_StandaloneBar publishes its item list, the sidebar avatar shows
//       it, and the top bar hides its own avatar while that one is mounted.
// ----------------------------------------------------------------------------

// ---- Shared account menu (one item list, two buttons) ----

var TKB__acct = { fn: null, name: "", email: "", sides: 0 };
var TKB__acctVer = 0;
var TKB__acctSubs = [];
function TKB__acctEmit() {
  TKB__acctVer++;
  TKB__acctSubs.slice().forEach(function (f) {
    try {
      f();
    } catch (e) {}
  });
}
function TKB__acctSub(f) {
  TKB__acctSubs.push(f);
  return function () {
    TKB__acctSubs = TKB__acctSubs.filter(function (x) {
      return x !== f;
    });
  };
}
function TKB__acctSnap() {
  return TKB__acctVer;
}
function TKB__useAcct() {
  React.useSyncExternalStore(TKB__acctSub, TKB__acctSnap, TKB__acctSnap);
  return TKB__acct;
}
// fn(close) returns the menu items; null removes the menu.
function TKB_acctSet(fn, name, email) {
  TKB__acct.fn = typeof fn === "function" ? fn : null;
  TKB__acct.name = name || "";
  TKB__acct.email = email || "";
  TKB__acctEmit();
}
// True while a sidebar avatar is mounted and has a menu to show.
function TKB_useSideAvatar() {
  var a = TKB__useAcct();
  return !!a.fn && a.sides > 0;
}

function TKB_SideAvatar(props) {
  var a = TKB__useAcct();
  React.useEffect(function () {
    TKB__acct.sides++;
    TKB__acctEmit();
    return function () {
      TKB__acct.sides = Math.max(0, TKB__acct.sides - 1);
      TKB__acctEmit();
    };
  }, []);
  if (!a.fn) return null;
  var labeled = !!props.labeled;
  return (
    // Arrow keys inside the open menu stay in the menu (the rail moves focus on them).
    <div
      className={"tkb-side-acct" + (labeled ? " is-labeled" : "")}
      onKeyDown={function (e) {
        e.stopPropagation();
      }}
    >
      <TK_vMenuButton
        className={"tkb-avatar" + (labeled ? " is-labeled" : "")}
        tour="tkb-avatar"
        ariaLabel="Account menu"
        title="Account menu"
        menuLabel="Account"
        up={true}
        returnFocus={true}
        label={
          <React.Fragment>
            <TK_vAvatar name={a.name} email={a.email} size="sm" decorative />
            {labeled ? <span className="tkb-avatar-name">{a.name}</span> : null}
          </React.Fragment>
        }
      >
        {function (close) {
          return TKB__acct.fn ? TKB__acct.fn(close) : null;
        }}
      </TK_vMenuButton>
    </div>
  );
}

// ---- Filter: one button, the filters in a small panel ----

var TKB__seq = 0;
function TKB__useId(prefix) {
  var r = React.useRef(null);
  if (!r.current) r.current = prefix + "-" + ++TKB__seq;
  return r.current;
}

function TKB_FilterButton(props) {
  var pair = React.useState(false);
  var open = pair[0];
  var setOpen = pair[1];
  var btnRef = React.useRef(null);
  var panelRef = React.useRef(null);
  var id = TKB__useId("tkb-filter");
  var count = Number(props.count) || 0;
  var close = function (focusBtn) {
    setOpen(false);
    if (focusBtn && btnRef.current) {
      try {
        btnRef.current.focus({ preventScroll: true });
      } catch (e) {}
    }
  };
  React.useEffect(
    function () {
      if (!open) return undefined;
      var first = panelRef.current ? panelRef.current.querySelector("select, input, button") : null;
      if (first) {
        try {
          first.focus({ preventScroll: true });
        } catch (e) {}
      }
      var onDoc = function (e) {
        if (panelRef.current && panelRef.current.contains(e.target)) return;
        if (btnRef.current && btnRef.current.contains(e.target)) return;
        setOpen(false);
      };
      document.addEventListener("mousedown", onDoc, true);
      document.addEventListener("touchstart", onDoc, true);
      return function () {
        document.removeEventListener("mousedown", onDoc, true);
        document.removeEventListener("touchstart", onDoc, true);
      };
    },
    [open],
  );
  return (
    <span className="tkb-filter tk-pop-wrap">
      <button
        type="button"
        ref={btnRef}
        className={"tk-tool-btn tkb-filter-btn" + (count ? " is-on" : "")}
        data-tour="tkb-filter"
        aria-expanded={open ? "true" : "false"}
        aria-controls={open ? id : undefined}
        onClick={function () {
          setOpen(!open);
        }}
      >
        <TK_vIcon name="filter" size={14} />
        <span>Filter</span>
        {count ? (
          <span className="tkb-count" aria-label={count === 1 ? "1 filter on" : count + " filters on"}>
            {count}
          </span>
        ) : null}
      </button>
      {open ? (
        <div
          className="tkb-pop"
          id={id}
          role="group"
          aria-label="Filters"
          ref={panelRef}
          onKeyDown={function (e) {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              close(true);
            }
          }}
        >
          <div className="tkb-pop-body">{props.children}</div>
          <div className="tkb-pop-foot">
            <button
              type="button"
              className="btn-secondary tkb-pop-done"
              onClick={function () {
                close(true);
              }}
            >
              Done
            </button>
          </div>
        </div>
      ) : null}
    </span>
  );
}

// ---- Group and sort: one menu ----

function TKB_GroupSort(props) {
  var v = props.view || { groupBy: "due", sort: null, chip: "" };
  var groups = typeof TK_SLATE_GROUPS !== "undefined" ? TK_SLATE_GROUPS : [{ key: "due", label: "Due date" }];
  var sorts = typeof TK_SLATE_SORTS !== "undefined" ? TK_SLATE_SORTS : [];
  var manual = props.manual;
  var changed = !!(v.groupBy !== "due" || (v.sort && v.sort.col) || (manual && manual.on));
  var label = function (g) {
    return typeof TKB_groupLabel === "function" ? TKB_groupLabel(g.key, g.label) : g.label;
  };
  var check = function (on) {
    return (
      <span className={"tk-menu-check" + (on ? " is-on" : "")} aria-hidden="true">
        {on ? <TK_vIcon name="check" size={12} /> : null}
      </span>
    );
  };
  return (
    <span className="tkb-groupsort" data-tour={props.noGroupBy ? undefined : "tk-groupby"}>
      <TK_vMenuButton
        className={"tk-tool-btn tkb-gs-btn" + (changed ? " is-on" : "")}
        tour="tk-slate-sort"
        menuLabel={props.noGroupBy ? "Sort" : "Group and sort"}
        label={
          <span className="tk-tool-label">
            {props.noGroupBy ? "Sort" : "Group and sort"}
            <TK_vIcon name="down" size={12} />
          </span>
        }
      >
        {function (close) {
          var items = [];
          if (!props.noGroupBy) {
            items.push(
              <span key="gh" className="tk-menu-note tkb-menu-head">
                Group by
              </span>,
            );
            groups.forEach(function (g) {
              var on = v.groupBy === g.key;
              items.push(
                <button
                  key={"g-" + g.key}
                  type="button"
                  role="menuitemradio"
                  aria-checked={on ? "true" : "false"}
                  className="tk-menu-item"
                  onClick={function () {
                    props.onChange({ groupBy: g.key });
                    close();
                  }}
                >
                  {check(on)}
                  {label(g)}
                </button>,
              );
            });
            items.push(<span key="s1" className="tk-menu-sep" role="separator" aria-hidden="true" />);
          }
          items.push(
            <span key="sh" className="tk-menu-note tkb-menu-head">
              Sort by
            </span>,
          );
          sorts.forEach(function (s) {
            var dir = v.sort && v.sort.col === s.col ? v.sort.dir : "";
            items.push(
              <button
                key={"s-" + s.col}
                type="button"
                role="menuitemradio"
                aria-checked={dir ? "true" : "false"}
                className="tk-menu-item"
                title={dir === "asc" ? "Pick again for descending" : dir === "desc" ? "Pick again for the default order" : undefined}
                onClick={function () {
                  var next = typeof TK_toggleSort === "function" ? TK_toggleSort(v.sort, s.col) : null;
                  if (next && manual && manual.on) manual.onToggle(false);
                  props.onChange({ sort: next });
                  close();
                }}
              >
                {check(!!dir)}
                {s.label + (dir === "asc" ? " (ascending)" : dir === "desc" ? " (descending)" : "")}
              </button>,
            );
          });
          if (manual) {
            items.push(
              <button
                key="manual"
                type="button"
                role="menuitemcheckbox"
                aria-checked={manual.on ? "true" : "false"}
                className="tk-menu-item"
                title="Drag rows to set the order (Alt+Up or Alt+Down moves the focused row)"
                onClick={function () {
                  manual.onToggle(!manual.on);
                  close();
                }}
              >
                {check(!!manual.on)}
                Manual order
              </button>,
            );
          }
          var isDefault = typeof TK_isDefaultSlateView === "function" ? TK_isDefaultSlateView(v) : !changed;
          if (!isDefault) {
            items.push(<span key="s2" className="tk-menu-sep" role="separator" aria-hidden="true" />);
            items.push(
              <button
                key="reset"
                type="button"
                role="menuitem"
                className="tk-menu-item"
                onClick={function () {
                  props.onReset();
                  close();
                }}
              >
                Reset view
              </button>,
            );
          }
          return items;
        }}
      </TK_vMenuButton>
    </span>
  );
}

// A saved quick view (Mine today, Waiting, Emails due) shows in the Filter
// panel as a chip; the x removes it. Emails due stays a toggle while the month
// rhythm is on.
function TKB_ChipEl(props) {
  var v = props.view || {};
  var chips = typeof TK_SLATE_CHIPS !== "undefined" ? TK_SLATE_CHIPS : [];
  var rhythm = typeof TK_rhythmEnabled === "function" && TK_rhythmEnabled();
  var cur = v.chip
    ? chips.filter(function (c) {
        return c.key === v.chip;
      })[0]
    : null;
  var emails = rhythm
    ? chips.filter(function (c) {
        return c.key === "emails_due";
      })[0]
    : null;
  if (!cur && !emails) return null;
  if (cur) {
    return (
      <span className="tks-text-chip tkb-chip">
        <span>{cur.label}</span>
        <button
          type="button"
          className="tk-icon-btn"
          aria-label={"Remove " + cur.label}
          onClick={function () {
            props.onChange({ chip: "" });
          }}
        >
          ×
        </button>
      </span>
    );
  }
  return (
    <button
      type="button"
      className="tk-filter-chip tk-sv-chip tkb-chip"
      aria-pressed="false"
      onClick={function () {
        props.onChange({ chip: emails.key });
      }}
    >
      {emails.label}
    </button>
  );
}

// ---- Add-line: plain words, no AI ----

function TKB_AddLine(props) {
  var p = props || {};
  var staffUser = p.staffUser || {};
  var me = TK_dwLower(staffUser.email);
  var clients = Array.isArray(p.clients) ? p.clients : [];
  var staff = TK_dwUseStaff();
  var nameOf = React.useMemo(
    function () {
      return TK_dwNameFn(staff);
    },
    [staff],
  );
  var online = TK_dwUseOnline();
  var schema = TK_dwUseStore(function (s) {
    return s.schema;
  });
  var tPair = React.useState("");
  var text = tPair[0];
  var setText = tPair[1];
  var bPair = React.useState(false);
  var busy = bPair[0];
  var setBusy = bPair[1];
  var ePair = React.useState("");
  var err = ePair[0];
  var setErr = ePair[1];
  var inputRef = React.useRef(null);
  var hintId = TKB__useId("tkb-add-hint");
  var today = TK_dwToday();
  var projectId = p.projectId || null;
  var readOnly = !!p.readOnly || !online;

  var parsed =
    text.trim() && typeof TK_parseQuickAdd === "function"
      ? TK_parseQuickAdd(text, {
          today: today,
          staff: (staff || []).filter(function (s) {
            return s && s.active !== false;
          }),
          clients: projectId ? [] : clients,
          defaultClientId: p.clientId || null,
          me: me,
        })
      : null;
  var title = parsed ? String(parsed.text || "").trim() : "";
  var clientId = projectId ? null : parsed ? parsed.client_id || null : null;
  var assignee = parsed && parsed.assignee_email ? TK_dwLower(parsed.assignee_email) : me;
  var client = clientId
    ? clients.filter(function (c) {
        return c && String(c.id) === String(clientId);
      })[0]
    : null;
  var ambiguous = !!(parsed && parsed.suggestions && parsed.suggestions.length);
  var will = "";
  if (parsed && title && typeof TK_qaWillAdd === "function") {
    var pl = typeof TK_PRIORITY_LABELS !== "undefined" && TK_PRIORITY_LABELS && parsed.priority ? TK_PRIORITY_LABELS[parsed.priority] : "";
    will = TK_qaWillAdd({
      title: title,
      assigneeName: assignee && assignee !== me ? nameOf(assignee) : "",
      clientName: client ? client.name : "",
      dueLabel: parsed.due_date ? (typeof TK_dlShortDate === "function" ? TK_dlShortDate(parsed.due_date, today) : parsed.due_date) : "",
      priority: parsed.priority || "normal",
      priorityLabel: pl || "",
    });
  }

  // Another person, a name that fits two, or the old schema: the Quick add
  // dialog (it checks who can see the client and asks "Did you mean").
  var openDialog = function () {
    // Keep the words when the dialog cannot take them (not mounted, or already open).
    var ready = false;
    try {
      ready = window.TK_quickAddReady === true && !document.querySelector(".modal-overlay, [aria-modal='true']");
    } catch (e) {}
    if (!ready) {
      setErr("Quick add is not available right now. The words are kept.");
      return;
    }
    try {
      window.dispatchEvent(
        new CustomEvent("tk:quick-add", {
          detail: { text: text, client_id: projectId ? null : p.clientId || null, project_id: projectId, kind: "task" },
        }),
      );
    } catch (e) {}
    setText("");
    setErr("");
  };

  var submit = function (forceDialog) {
    if (busy || readOnly) return;
    if (!title) {
      setErr("Add a few words about the task.");
      return;
    }
    var direct = !forceDialog && !ambiguous && schema === "ok" && assignee === me && typeof TK_api !== "undefined" && TK_api && typeof TK_api.create === "function";
    if (!direct) {
      openDialog();
      return;
    }
    setBusy(true);
    setErr("");
    TK_api.create({
      text: title,
      client_id: clientId,
      project_id: projectId,
      section: null,
      due_date: parsed.due_date || null,
      priority: parsed.priority || "normal",
      assignee_email: me,
      visibility: clientId || projectId ? "shared" : "private",
      kind: "task",
    }).then(
      function () {
        setBusy(false);
        setText("");
        TK_dwTrack("tasks-add-line", { client: !!clientId, project: !!projectId, where: p.where || "list" });
        TK_dwToast(TK_dwCopy("taskAdded", "Task added."));
        if (inputRef.current) {
          try {
            inputRef.current.focus({ preventScroll: true });
          } catch (e) {}
        }
      },
      function (e) {
        setBusy(false);
        setErr(e && e.code === "tk_offline" ? "Offline right now. Adding is paused." : "Couldn't add the task. Try again.");
      },
    );
  };

  var placeholder = p.placeholder || (projectId ? "Add a task to this project" : p.clientId ? "Add a task for this client" : "Add a task, for example: Call Acme about payroll Friday");
  return (
    <div className={"tkb-add tk-p3-edit" + (p.compact ? " is-compact" : "")} data-tour={p.tour || "tkb-add"}>
      <div className="tkb-add-row">
        <TK_vIcon name="plus" size={16} />
        <input
          ref={inputRef}
          type="text"
          className="tk-input tkb-add-input"
          aria-label="Add a task in plain words"
          aria-describedby={hintId}
          placeholder={readOnly ? (online ? "" : "Offline: adding is paused") : placeholder}
          maxLength={500}
          value={text}
          disabled={readOnly || busy}
          onChange={function (e) {
            setText(e.target.value);
            if (err) setErr("");
          }}
          onKeyDown={function (e) {
            if (e.key === "Enter") {
              e.preventDefault();
              submit(e.shiftKey);
            } else if (e.key === "Escape" && text) {
              e.preventDefault();
              e.stopPropagation();
              setText("");
              setErr("");
            }
          }}
        />
      </div>
      <p className="tkb-add-hint" id={hintId} aria-live="polite">
        {err
          ? err
          : readOnly
            ? online
              ? "Adding is off right now."
              : "Offline right now. Adding is paused."
            : ambiguous
            ? "A name fits more than one person or client. Press Enter to pick in Quick add."
            : will
              ? will + (assignee !== me ? " Press Enter to check access in Quick add." : " Press Enter to add.")
              : text.trim()
                ? ""
                : "Type a title. Plain words like “for Jesse”, “re Acme” or “by Friday” fill in the details."}
      </p>
    </div>
  );
}

// ---- Today at a glance (the full-size pane when no task is open) ----

function TKB_Glance(props) {
  var p = props || {};
  var staffUser = p.staffUser || {};
  var me = TK_vLower(staffUser.email);
  var isAdmin = !!p.isAdmin;
  var today = TK_vToday();
  var key = me && typeof TKP_personKey === "function" ? "assignee:" + TKP_personKey(me) : null;
  var list = TK_vUseList(key, function () {
    if (typeof TK_api === "undefined" || !TK_api || typeof TK_api.listScope !== "function") return Promise.resolve([]);
    return TK_api.listScope({ assigneeEmail: me });
  });
  var review = TK_vUseList(isAdmin ? "review" : null, function () {
    if (typeof TK_api === "undefined" || !TK_api || typeof TK_api.listReview !== "function") return Promise.resolve([]);
    return TK_api.listReview();
  });
  var g = typeof TKB_glance === "function" ? TKB_glance(list.tasks, me, today) : { overdue: 0, week: 0, waiting: 0, top: [] };
  var reviewCount = isAdmin && typeof TK_reviewQueueCount === "function" ? TK_reviewQueueCount(review.tasks, me) : 0;
  var clientName = function (id) {
    if (id == null) return "";
    var c = (p.clients || []).filter(function (x) {
      return x && String(x.id) === String(id);
    })[0];
    return c ? c.name || "" : "";
  };
  var loading = list.loading && !(list.tasks && list.tasks.length);
  var goFilter = function (kind) {
    var f = typeof TKB_glanceFilter === "function" ? TKB_glanceFilter(kind) : null;
    if (!f) return;
    if (typeof TKB_handFilter === "function") TKB_handFilter(f);
    TK_vTrack("tasks-glance-" + kind);
    TK_navigate({ view: "my" });
  };
  var stat = function (k, label, n, onGo, tour) {
    return (
      <li key={k}>
        <button type="button" className={"tkb-stat tkb-stat-" + k + (n ? " has-n" : "")} data-tour={tour || undefined} onClick={onGo} aria-label={label + ": " + (loading ? "loading" : n) + ". Show these tasks"}>
          <span className="tkb-stat-n" aria-hidden="true">
            {loading ? "–" : n}
          </span>
          <span className="tkb-stat-l" aria-hidden="true">
            {label}
          </span>
        </button>
      </li>
    );
  };
  return (
    <div className="tkb-glance" data-tour="tkb-glance">
      <h2 className="tkb-glance-title" id="tkb-glance-h">Today at a glance</h2>
      {list.error && !(list.tasks && list.tasks.length) ? (
        <p className="tkb-glance-note" role="status">
          Couldn't load tasks.{" "}
          <button type="button" className="tk-link-btn" onClick={list.reload}>
            Try again
          </button>
        </p>
      ) : null}
      <ul className="tkb-stats" aria-label="Counts">
        {stat("overdue", "Overdue", g.overdue, function () { goFilter("overdue"); })}
        {stat("week", "Due this week", g.week, function () { goFilter("week"); })}
        {stat("waiting", "Waiting on client", g.waiting, function () { goFilter("waiting"); })}
        {isAdmin
          ? stat("review", "Waiting for review", reviewCount, function () {
              TK_vTrack("tasks-glance-review");
              TK_navigate({ view: "review" });
            })
          : null}
      </ul>
      <section className="tkb-start" aria-labelledby="tkb-start-h">
        <h3 className="tkb-glance-h" id="tkb-start-h">
          Start here
        </h3>
        {loading ? (
          <p className="tkb-glance-note" role="status">
            Loading tasks...
          </p>
        ) : g.top.length ? (
          <ol className="tkb-start-list">
            {g.top.map(function (t) {
              var late = typeof TK_isOverdue === "function" && TK_isOverdue(t, today);
              var due = typeof TK_dueLabel === "function" ? TK_dueLabel(t, today) : "";
              var cn = clientName(t.client_id);
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    className={"tkb-start-item" + (late ? " is-late" : "")}
                    onClick={function () {
                      TK_vTrack("tasks-glance-open");
                      TK_openTask(t.id, { from: "glance" });
                    }}
                  >
                    <span className="tkb-start-t">{t.text || "Untitled task"}</span>
                    <span className="tkb-start-m">
                      {[cn, due ? (late ? due : "Due " + due) : "No due date"].filter(Boolean).join(" · ")}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="tkb-glance-note">Nothing open right now.</p>
        )}
      </section>
      <section className="tkb-glance-add" aria-label="Add a task">
        <TKB_AddLine staffUser={staffUser} clients={p.clients || []} compact={true} where="glance" tour="tkb-glance-add" placeholder="Add a task in plain words" />
      </section>
    </div>
  );
}

// ---- The open task: "More details" ----

var TKB_MORE_KEY = "mgb_slatesimple_more_v1";

function TKB_MoreDetails(props) {
  var on = !!props.on;
  var pair = React.useState(function () {
    try {
      return window.localStorage.getItem(TKB_MORE_KEY) === "1";
    } catch (e) {
      return false;
    }
  });
  var open = pair[0];
  var setOpen = pair[1];
  var id = TKB__useId("tkb-more");
  React.useEffect(
    function () {
      if (!on) return undefined;
      var f = function () {
        setOpen(true);
      };
      window.addEventListener("tkb:more-open", f);
      return function () {
        window.removeEventListener("tkb:more-open", f);
      };
    },
    [on],
  );
  if (!on) return props.children;
  var set = function (v) {
    setOpen(v);
    try {
      if (v) window.localStorage.setItem(TKB_MORE_KEY, "1");
      else window.localStorage.removeItem(TKB_MORE_KEY);
    } catch (e) {}
  };
  var count = Number(props.count) || 0;
  return (
    <div className={"tkb-more" + (open ? " is-open" : "")}>
      <button
        type="button"
        className="tkb-more-btn"
        data-tour="tkb-more"
        aria-expanded={open ? "true" : "false"}
        aria-controls={open ? id : undefined}
        onClick={function () {
          set(!open);
        }}
      >
        <span className="tkb-more-ico" aria-hidden="true">
          <TK_vIcon name="down" size={14} />
        </span>
        <span>More details</span>
        {count ? (
          <span className="tkb-count" aria-label={count === 1 ? "1 filled" : count + " filled"}>
            {count}
          </span>
        ) : null}
      </button>
      {open ? <div id={id}>{props.children}</div> : null}
    </div>
  );
}

// How many of the tucked-away fields hold something (the button's count).
function TKB_moreCount(task) {
  var t = task || {};
  var n = 0;
  if (t.start_on) n++;
  if (t.section) n++;
  if (t.kind && t.kind !== "task") n++;
  if (t.remind_at) n++;
  if (t.recurrence_rule || t.recurrence) n++;
  if (t.review_required) n++;
  if (t.client_id && t.sop_section) n++;
  return n;
}
