// ----------------------------------------------------------------------------
// TK_BulkBar.jsx — multi-select and the bulk bar (Phase 4, P4-3).
//
// Exports: TK_useBulkSelect, TK_BulkBar
//
// Lists (My Tasks, client / project / person lists) call TK_useBulkSelect
// with their row order and the ids still loaded; rows get onSelect /
// selected / selecting, list keys get onSelect (v, Shift+V for a range) and
// the bar renders below the rows. Everything is off until the server has the
// bulk functions (TK_api.bulkReady(): schema 12+), so an older database
// shows the lists exactly as before.
//
// The bar: "N selected · Complete · Reopen · Reassign · Move to project ·
// Due date · Delete · Clear". Each action runs TK_api.bulkRun (one server
// call, one Undo toast), then clears the selection. Rows the server skipped
// (in review, waiting on the client, no access …) are never silent: the bar
// stays up with an "N skipped" button that lists them by reason.
//
// Slate app P3: inside the Slate app only, the bar also has Status, Priority
// and Section. Done goes through Complete (review gate, recurring); the other
// statuses, priority and section go through tk_bulk_set (kinds set_status,
// set_priority, set_section) with the same one Undo. Section is offered only
// when every selected task is in one project, from that project's sections.
// The controls carry class tk-p3-edit and are hidden in the compact and
// sliver sizes, which are read-only.
// ----------------------------------------------------------------------------

// opts: { ids: the rows on screen, in focus order (collapsed groups and
//         hidden done tasks left out),
//         enabled: false to switch it off (read-only lists),
//         keys: false while list keys are paused (Esc then left alone) }
// Returns { ready, count, sel, ids(), has(id), toggle(id, shift), clear() }.
// Only rows on screen stay selected: a row that is filtered out, hidden,
// collapsed, deleted or moved leaves the selection, so a bulk action never
// touches a task the person cannot see.
function TK_useBulkSelect(opts) {
  var o = opts || {};
  // Re-render when the schema probe lands (bulkReady reads its version).
  TK_vUseStore(function (s) {
    return s ? s.schema : null;
  });
  var ready = o.enabled !== false && typeof TK_api !== "undefined" && !!TK_api && typeof TK_api.bulkReady === "function" && TK_api.bulkReady();
  var pair = React.useState(TK_selEmpty);
  var sel = pair[0];
  var setSel = pair[1];
  var order = Array.isArray(o.ids) ? o.ids : [];
  var orderKey = order.join("|");

  React.useEffect(
    function () {
      setSel(function (s) {
        return TK_selPrune(s, order);
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orderKey],
  );
  React.useEffect(
    function () {
      if (!ready) setSel(TK_selEmpty());
    },
    [ready],
  );

  // Counted and acted on against the rows on screen, even in the one render
  // before the prune above lands.
  var visible = ready ? TK_selOnList(sel, order) : [];
  var count = visible.length;
  var orderRef = React.useRef(order);
  orderRef.current = order;
  var selRef = React.useRef(sel);
  selRef.current = sel;
  var toggle = React.useCallback(function (id, shift) {
    var max = typeof TK_api !== "undefined" && TK_api && TK_api.BULK_MAX ? TK_api.BULK_MAX : 100;
    var cur = selRef.current;
    // The cap notice is shown here, not inside the state updater (React may
    // run an updater twice).
    if (TK_selToggle(cur, id, orderRef.current, !!shift, max) === cur && !TK_selHas(cur, id)) {
      TK_vToast("You can select up to " + max + " tasks at a time.");
      return;
    }
    setSel(function (s) {
      return TK_selToggle(s, id, orderRef.current, !!shift, max);
    });
  }, []);
  var clear = React.useCallback(function () {
    setSel(TK_selEmpty());
  }, []);
  // A group header's box: select (or unselect) every row of that group.
  var setMany = React.useCallback(function (ids, on) {
    var max = typeof TK_api !== "undefined" && TK_api && TK_api.BULK_MAX ? TK_api.BULK_MAX : 100;
    var next = { ids: {}, anchor: selRef.current.anchor };
    Object.keys(selRef.current.ids).forEach(function (k) {
      next.ids[k] = true;
    });
    var capped = false;
    (ids || []).forEach(function (id) {
      var k = String(id);
      if (!on) {
        delete next.ids[k];
      } else if (!next.ids[k]) {
        if (Object.keys(next.ids).length >= max) capped = true;
        else next.ids[k] = true;
      }
    });
    if (capped) TK_vToast("You can select up to " + max + " tasks at a time.");
    setSel(next);
  }, []);

  // Esc clears the selection (not while typing, in a dialog or a menu, or
  // while the list's keys are paused: the task drawer is open).
  var keysRef = React.useRef(true);
  keysRef.current = o.keys !== false;
  React.useEffect(
    function () {
      if (!count) return undefined;
      var on = function (e) {
        if (e.key !== "Escape" || e.defaultPrevented) return;
        var el = e.target;
        var tag = el && el.tagName ? String(el.tagName).toLowerCase() : "";
        if (tag === "input" || tag === "textarea" || tag === "select" || (el && el.isContentEditable)) return;
        var ctx = typeof TK_vKeyCtx === "function" ? TK_vKeyCtx() : {};
        if (ctx.modalOpen || ctx.menuOpen || ctx.tourOpen) return;
        if (!keysRef.current) return;
        e.preventDefault();
        setSel(TK_selEmpty());
      };
      document.addEventListener("keydown", on);
      return function () {
        document.removeEventListener("keydown", on);
      };
    },
    [count > 0],
  );

  return {
    ready: ready,
    count: count,
    sel: sel,
    ids: function () {
      return visible.slice();
    },
    has: function (id) {
      return ready && id != null && visible.indexOf(String(id)) >= 0;
    },
    toggle: toggle,
    setMany: setMany,
    clear: clear,
  };
}

// The "select all" box on a group header (Overdue, This week, a client...).
// props: { select (TK_useBulkSelect), tasks: the group's tasks, label }
function TK_BulkGroupBox(props) {
  var select = props.select || {};
  var ref = React.useRef(null);
  var ids = (props.tasks || []).map(function (t) {
    return String(t.id);
  });
  var n = 0;
  ids.forEach(function (id) {
    if (select.has && select.has(id)) n++;
  });
  var all = ids.length > 0 && n === ids.length;
  React.useEffect(
    function () {
      if (ref.current) ref.current.indeterminate = n > 0 && !all;
    },
    [n, all],
  );
  if (!select.ready || typeof select.setMany !== "function" || !ids.length) return null;
  return (
    <input
      ref={ref}
      type="checkbox"
      className="tk-sel-group"
      checked={all}
      aria-label={(all ? "Unselect all " : "Select all ") + ids.length + " in " + (props.label || "this group")}
      title={all ? "Unselect this group" : "Select all in this group"}
      onChange={function () {
        select.setMany(ids, !all);
      }}
    />
  );
}

var TK_vDUE_CHOICES = [
  { value: "date", label: "Pick a date…" },
  { value: "shift:1", label: "+1 day" },
  { value: "shift:7", label: "+1 week" },
  { value: "shift:-1", label: "−1 day" },
  { value: "clear", label: "No due date" },
];

// props: { select (TK_useBulkSelect), tasksById: { id: task }, staff,
//          projects, readOnly }
function TK_BulkBar(props) {
  var select = props.select || {};
  var byId = props.tasksById || {};
  var bPair = React.useState(false);
  var busy = bPair[0];
  var setBusy = bPair[1];
  var rPair = React.useState(null);
  var report = rPair[0]; // { kind, skipped: [{ id, reason }], names: { id: text } }
  var setReport = rPair[1];
  var oPair = React.useState(false);
  var openSkips = oPair[0];
  var setOpenSkips = oPair[1];
  var cPair = React.useState(false);
  var confirmDelete = cPair[0];
  var setConfirmDelete = cPair[1];
  var dPair = React.useState("");
  var pickDate = dPair[0];
  var setPickDate = dPair[1];
  var showDate = pickDate !== "";

  // Slate app P3: Status, Priority and Section, only inside the Slate app.
  var inApp = typeof TK_useSlateInApp === "function" ? TK_useSlateInApp() : false;

  var count = select.count || 0;
  // A new selection replaces the last skipped report.
  React.useEffect(
    function () {
      if (count) {
        setReport(null);
        setOpenSkips(false);
      } else {
        setConfirmDelete(false);
        setPickDate("");
      }
    },
    [count > 0],
  );

  if (!select.ready) return null;
  if (!count && !(report && report.skipped.length)) return null;

  var ids = count ? select.ids() : [];
  var tasks = ids
    .map(function (id) {
      return byId[id];
    })
    .filter(Boolean);
  var counts = TK_bulkCounts(tasks);
  var off = busy || !!props.readOnly;
  var offer = inApp && typeof TK_bulkSetOffer === "function" ? TK_bulkSetOffer(tasks, props.projects) : null;

  var run = function (kind, patch) {
    if (off || !ids.length) return;
    var names = {};
    ids.forEach(function (id) {
      names[id] = byId[id] && byId[id].text ? byId[id].text : "";
    });
    setBusy(true);
    setConfirmDelete(false);
    setPickDate("");
    TK_vTrack("tasks-bulk-" + kind);
    TK_api.bulkRun(kind, ids, patch).then(
      function (r) {
        setBusy(false);
        select.clear();
        var skipped = r && Array.isArray(r.skipped) ? r.skipped : [];
        setReport(skipped.length ? { kind: kind, skipped: skipped, names: names } : null);
        setOpenSkips(false);
      },
      function (err) {
        setBusy(false);
        TK_vToast(TK_vErrText(err));
      },
    );
  };

  var staff = (Array.isArray(props.staff) ? props.staff : []).filter(function (s) {
    return s && s.email && s.active !== false;
  });
  var projects = (Array.isArray(props.projects) ? props.projects : []).filter(function (p) {
    return p && p.id && !p.archived_at && !p.trashed_at && !p.deleted_at;
  });

  var skipBlock = null;
  if (report && report.skipped.length) {
    var groups = TK_skipGroups(report.skipped, function (id) {
      return report.names[id] || (byId[id] && byId[id].text) || "";
    });
    skipBlock = (
      <div className="tk-bulk-skips">
        <button
          type="button"
          className="tk-bulk-skipbtn"
          aria-expanded={openSkips ? "true" : "false"}
          onClick={function () {
            setOpenSkips(!openSkips);
          }}
        >
          {report.skipped.length + " skipped"}
          <TK_vIcon name="down" size={12} className={openSkips ? "tk-flip" : ""} />
        </button>
        {count ? null : (
          <button
            type="button"
            className="tk-icon-btn tk-bulk-dismiss"
            aria-label="Dismiss"
            onClick={function () {
              setReport(null);
            }}
          >
            ×
          </button>
        )}
        {openSkips ? (
          <div className="tk-bulk-skiplist" role="region" aria-label="Skipped tasks">
            {groups.map(function (g) {
              return (
                <div key={g.reason} className="tk-bulk-skipgroup">
                  <p className="tk-bulk-skipwhy">{g.text}</p>
                  <ul>
                    {g.items.map(function (it) {
                      return (
                        <li key={it.id}>
                          <button
                            type="button"
                            className="tk-bulk-skipname"
                            onClick={function () {
                              TK_vOpenTask(it.id, { from: "bulk-skip" });
                            }}
                          >
                            {it.name}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    );
  }

  if (!count) {
    return (
      <div className="tk-bulkbar is-report" role="region" aria-label="Last bulk action">
        {skipBlock}
      </div>
    );
  }

  return (
    <div className="tk-bulkbar" role="region" aria-label="Selected tasks" data-tour="tk-bulkbar">
      <span className="tk-bulk-count" aria-live="polite">
        {count + " selected"}
      </span>
      <span className="tk-bulk-hint">Shift-click another box to select everything between.</span>
      {confirmDelete ? (
        <span className="tk-bulk-confirm" role="group" aria-label="Confirm delete">
          <span>{count === 1 ? "Delete 1 task?" : "Delete " + count + " tasks?"}</span>
          <button
            type="button"
            className="tk-tool-btn tk-bulk-btn tk-bulk-danger"
            disabled={off}
            onClick={function () {
              run("delete");
            }}
          >
            Delete
          </button>
          <button
            type="button"
            className="btn-secondary tk-bulk-btn"
            onClick={function () {
              setConfirmDelete(false);
            }}
          >
            Cancel
          </button>
        </span>
      ) : (
        <span className="tk-bulk-actions">
          <button
            type="button"
            className="btn-primary tk-bulk-btn"
            disabled={off || !(counts.open || counts.review || counts.waiting)}
            title={counts.review || counts.waiting ? "Tasks in review or waiting on the client are skipped." : undefined}
            onClick={function () {
              run("complete");
            }}
          >
            Complete
          </button>
          {counts.done ? (
            <button
              type="button"
              className="btn-secondary tk-bulk-btn"
              disabled={off}
              onClick={function () {
                run("reopen");
              }}
            >
              Reopen
            </button>
          ) : null}
          <label className="tk-bulk-pick">
            <span className="tk-sr">Reassign</span>
            <select
              className="tk-select"
              value=""
              disabled={off || !staff.length}
              onChange={function (e) {
                var v = e.target.value;
                if (v) run("reassign", { assignee_email: v });
              }}
            >
              <option value="">Reassign…</option>
              {staff.map(function (s) {
                return (
                  <option key={s.email} value={String(s.email).toLowerCase()}>
                    {s.name || s.email}
                  </option>
                );
              })}
            </select>
          </label>
          <label className="tk-bulk-pick">
            <span className="tk-sr">Move to project</span>
            <select
              className="tk-select"
              value=""
              disabled={off}
              onChange={function (e) {
                var v = e.target.value;
                if (!v) return;
                run("move_project", { project_id: v === "__none" ? null : v });
              }}
            >
              <option value="">Move to project…</option>
              <option value="__none">No project</option>
              {projects.map(function (p) {
                return (
                  <option key={p.id} value={p.id}>
                    {p.name || "Untitled project"}
                  </option>
                );
              })}
            </select>
          </label>
          {offer ? (
            <span className="tk-bulk-set tk-p3-edit" role="group" aria-label="Change status, priority or section">
              <label className="tk-bulk-pick">
                <span className="tk-sr">Set status</span>
                <select
                  className="tk-select"
                  value=""
                  disabled={off}
                  title="Done follows the usual Complete rules: tasks in review or waiting on the client are skipped."
                  onChange={function (e) {
                    var r = TK_bulkStatusRoute(e.target.value);
                    if (r) run(r.kind, r.patch);
                  }}
                >
                  <option value="">Status…</option>
                  {TK_BULK_STATUS_CHOICES.map(function (c) {
                    return (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    );
                  })}
                </select>
              </label>
              <label className="tk-bulk-pick">
                <span className="tk-sr">Set priority</span>
                <select
                  className="tk-select"
                  value=""
                  disabled={off}
                  onChange={function (e) {
                    var r = TK_bulkPriorityRoute(e.target.value);
                    if (r) run(r.kind, r.patch);
                  }}
                >
                  <option value="">Priority…</option>
                  {TK_BULK_PRIORITY_CHOICES.map(function (c) {
                    return (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    );
                  })}
                </select>
              </label>
              <label className="tk-bulk-pick">
                <span className="tk-sr">Set section</span>
                <select
                  className="tk-select"
                  value=""
                  disabled={off || !offer.section}
                  title={
                    offer.section
                      ? undefined
                      : offer.sectionWhy === "mixed"
                        ? "Section needs every selected task to be in the same project."
                        : offer.sectionWhy === "none"
                          ? "Section needs tasks that are in a project."
                          : "This project has no sections yet."
                  }
                  onChange={function (e) {
                    var v = e.target.value;
                    if (!v) return;
                    var r = TK_bulkSectionRoute(v === "__none" ? null : v);
                    if (r) run(r.kind, r.patch);
                  }}
                >
                  <option value="">Section…</option>
                  {offer.section ? <option value="__none">No section</option> : null}
                  {offer.sections.map(function (name) {
                    return (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    );
                  })}
                </select>
              </label>
            </span>
          ) : null}
          {showDate ? (
            <span className="tk-bulk-date">
              <label>
                <span className="tk-sr">New due date</span>
                <input
                  type="date"
                  className="tk-input"
                  value={pickDate === "pick" ? "" : pickDate}
                  autoFocus
                  onChange={function (e) {
                    setPickDate(e.target.value || "pick");
                  }}
                />
              </label>
              <button
                type="button"
                className="btn-primary tk-bulk-btn"
                disabled={off || !TK_bulkDuePatch("date", pickDate)}
                onClick={function () {
                  var p = TK_bulkDuePatch("date", pickDate);
                  if (p) run("set_due", p);
                }}
              >
                Set
              </button>
              <button
                type="button"
                className="btn-secondary tk-bulk-btn"
                onClick={function () {
                  setPickDate("");
                }}
              >
                Cancel
              </button>
            </span>
          ) : (
            <label className="tk-bulk-pick">
              <span className="tk-sr">Due date</span>
              <select
                className="tk-select"
                value=""
                disabled={off}
                onChange={function (e) {
                  var v = e.target.value;
                  if (!v) return;
                  if (v === "date") {
                    setPickDate("pick");
                    return;
                  }
                  var p = v === "clear" ? TK_bulkDuePatch("clear") : TK_bulkDuePatch("shift", v.split(":")[1]);
                  if (p) run("set_due", p);
                }}
              >
                <option value="">Due date…</option>
                {TK_vDUE_CHOICES.map(function (c) {
                  return (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  );
                })}
              </select>
            </label>
          )}
          <button
            type="button"
            className="btn-secondary tk-bulk-btn tk-bulk-delete"
            disabled={off}
            onClick={function () {
              setConfirmDelete(true);
            }}
          >
            Delete
          </button>
        </span>
      )}
      <button type="button" className="tk-tool-btn tk-bulk-clear" title="Clear selection (Esc)" onClick={select.clear}>
        Clear
      </button>
      {skipBlock}
    </div>
  );
}
