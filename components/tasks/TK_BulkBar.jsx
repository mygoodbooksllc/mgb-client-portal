// ----------------------------------------------------------------------------
// TK_BulkBar.jsx — multi-select and the bulk bar (Phase 4, P4-3).
//
// Exports: TK_useBulkSelect, TK_BulkBar, TK_BulkReportPick
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
  // how.replace (the Slate drag box): the ids become the whole selection.
  var setMany = React.useCallback(function (ids, on, how) {
    var max = typeof TK_api !== "undefined" && TK_api && TK_api.BULK_MAX ? TK_api.BULK_MAX : 100;
    var replace = !!(how && how.replace);
    var next = { ids: {}, anchor: replace ? null : selRef.current.anchor };
    if (!replace) {
      Object.keys(selRef.current.ids).forEach(function (k) {
        next.ids[k] = true;
      });
    }
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
//          projects, readOnly, clientNames: { client_id: name } (the
//          Full or Preliminary picker's row labels) }
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
  // Before flip (b): Send reports tasks waiting on Full or Preliminary.
  // { rows, ids, kind, patch, names } while the picker is open.
  var kPair = React.useState(null);
  var reportPick = kPair[0];
  var setReportPick = kPair[1];

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
        setReportPick(null);
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

  var send = function (kind, list, patch, names) {
    setBusy(true);
    setConfirmDelete(false);
    setPickDate("");
    TK_vTrack("tasks-bulk-" + kind);
    TK_api.bulkRun(kind, list, patch).then(
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

  var run = function (kind, patch) {
    if (off || !ids.length) return;
    var names = {};
    ids.forEach(function (id) {
      names[id] = byId[id] && byId[id].text ? byId[id].text : "";
    });
    // Before flip (b): completing a Send reports task asks Full or Preliminary
    // first, for each one selected. Feature off: reportPickTasks resolves [].
    if (kind !== "complete" || typeof TK_api.reportPickTasks !== "function" || typeof TK_bulkReportRows !== "function") {
      send(kind, ids, patch, names);
      return;
    }
    setBusy(true);
    TK_api.reportPickTasks(tasks).then(
      function (need) {
        setBusy(false);
        var rows = TK_bulkReportRows(need, props.clientNames);
        if (!rows.length) send(kind, ids, patch, names);
        else setReportPick({ rows: rows, ids: ids.slice(), kind: kind, patch: patch, names: names });
      },
      function () {
        setBusy(false);
        TK_vToast("Could not check the Send reports tasks. Try again.");
      },
    );
  };

  // Save Full or Preliminary for each row, one at a time, then complete
  // everything selected except a row whose save failed.
  var confirmReports = function (plan) {
    var pick = reportPick;
    if (!pick) return Promise.resolve();
    var failed = [];
    var chain = Promise.resolve();
    plan.forEach(function (it) {
      chain = chain.then(function () {
        return TK_api.setReportState(it.client_id, it.period, it.state, it.missing).then(
          function () {},
          function () { failed.push(it.id); },
        );
      });
    });
    return chain.then(function () {
      var after = TK_bulkReportAfter(pick.ids, failed);
      setReportPick(null);
      if (after.text) TK_vToast(after.text);
      if (after.ids.length) send(pick.kind, after.ids, pick.patch, pick.names);
    });
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
      {reportPick ? (
        <TK_BulkReportPick
          rows={reportPick.rows}
          onCancel={function () {
            setReportPick(null);
          }}
          onConfirm={confirmReports}
        />
      ) : null}
    </div>
  );
}

// Before flip (b): the bulk bar's Full or Preliminary picker. One row per Send
// reports task being completed (client and month). Preliminary needs at least
// one missing item, prefilled from that client's open Ask client requests and
// editable, the same as the task pane's picker (TK_dwReportState). Nothing is
// saved or completed until "Save and complete"; Cancel leaves every task open.
// props: { rows (TK_bulkReportRows), onConfirm(plan) -> Promise, onCancel }
function TK_BulkReportPick(props) {
  var rows = Array.isArray(props.rows) ? props.rows : [];
  var cPair = React.useState({});
  var choices = cPair[0];
  var setChoices = cPair[1];
  var fPair = React.useState({});
  var prefill = fPair[0]; // { client_id: items }
  var setPrefill = fPair[1];
  var tPair = React.useState(false);
  var tried = tPair[0];
  var setTried = tPair[1];
  var bPair = React.useState(false);
  var busy = bPair[0];
  var setBusy = bPair[1];

  var clientKey = rows
    .map(function (r) {
      return r.client_id;
    })
    .join("|");
  React.useEffect(
    function () {
      var live = true;
      var seen = {};
      rows.forEach(function (r) {
        if (seen[r.client_id]) return;
        seen[r.client_id] = true;
        var load =
          TK_api && typeof TK_api.listClientRequests === "function"
            ? TK_api.listClientRequests(null, r.client_id)
            : Promise.resolve([]);
        load.then(
          function (list) {
            if (!live) return;
            setPrefill(function (prev) {
              var next = Object.assign({}, prev);
              next[r.client_id] = TK_reportMissingPrefill(list);
              return next;
            });
          },
          function () {
            if (!live) return;
            setPrefill(function (prev) {
              var next = Object.assign({}, prev);
              next[r.client_id] = [];
              return next;
            });
          },
        );
      });
      return function () {
        live = false;
      };
    },
    [clientKey],
  );

  if (typeof ModalShell !== "function") return null;

  var itemsOf = function (row) {
    var ch = choices[row.id] || {};
    if (Array.isArray(ch.items)) return ch.items;
    var pre = prefill[row.client_id];
    return Array.isArray(pre) ? pre : null; // null = still loading
  };
  var setRow = function (id, patch) {
    setChoices(function (prev) {
      var next = Object.assign({}, prev);
      next[id] = Object.assign({}, prev[id] || {}, patch);
      return next;
    });
  };
  // Snapshot the prefill into the row the first time it is edited.
  var editItems = function (row, fn) {
    var cur = itemsOf(row) || [];
    setRow(row.id, { items: fn(cur.slice()) });
  };
  var effective = {};
  rows.forEach(function (r) {
    var ch = choices[r.id] || {};
    effective[r.id] = { state: ch.state, items: itemsOf(r) || [] };
  });
  var problem = TK_bulkReportProblem(rows, effective);

  var submit = function () {
    if (busy) return;
    if (problem) {
      setTried(true);
      return;
    }
    setBusy(true);
    Promise.resolve(props.onConfirm(TK_bulkReportPlan(rows, effective))).then(
      function () {
        setBusy(false);
      },
      function () {
        setBusy(false);
      },
    );
  };
  var allFull = function () {
    setChoices(function (prev) {
      var next = Object.assign({}, prev);
      rows.forEach(function (r) {
        next[r.id] = Object.assign({}, prev[r.id] || {}, { state: "full" });
      });
      return next;
    });
  };

  var node = (
    <ModalShell onClose={busy ? function () {} : props.onCancel} labelledBy="tk-bulk-report-title" className="tk-dw-modal tk-bulk-report">
      <div className="modal-header">
        <h3 className="card-title" id="tk-bulk-report-title" style={{ margin: 0 }}>
          {rows.length === 1 ? "Reports: Full or Preliminary" : "Reports for " + rows.length + " clients"}
        </h3>
        <button type="button" className="modal-close" onClick={props.onCancel} disabled={busy} aria-label="Close">
          ×
        </button>
      </div>
      <div className="modal-body tk-bulk-report-body">
        <p className="tk-dw-hint">
          Before these Send reports tasks are done, say how each client's reports went out. Preliminary lists what is
          still missing; the client sees those items next to the reports.
        </p>
        {rows.length > 1 ? (
          <button type="button" className="btn-secondary btn-sm" onClick={allFull} disabled={busy}>
            Set all to Full
          </button>
        ) : null}
        {rows.map(function (row) {
          var ch = choices[row.id] || {};
          var items = itemsOf(row);
          var list = items || [];
          var name = "tk-bulk-report-" + row.id;
          var bad = tried && problem && problem.id === row.id;
          return (
            <fieldset key={row.id} className={"tk-dw-report-pick tk-bulk-report-row" + (bad ? " tk-bulk-report-bad" : "")}>
              <legend className="tk-dw-label">{row.clientName + (row.month ? " · " + row.month : "")}</legend>
              <label className="tk-dw-report-opt">
                <input
                  type="radio"
                  name={name}
                  value="full"
                  checked={ch.state === "full"}
                  disabled={busy}
                  onChange={function () {
                    setRow(row.id, { state: "full" });
                  }}
                />
                <span>
                  <strong>Full</strong> Everything for the month was in.
                </span>
              </label>
              <label className="tk-dw-report-opt">
                <input
                  type="radio"
                  name={name}
                  value="preliminary"
                  checked={ch.state === "preliminary"}
                  disabled={busy}
                  onChange={function () {
                    setRow(row.id, { state: "preliminary" });
                  }}
                />
                <span>
                  <strong>Preliminary</strong> Sent before everything arrived.
                </span>
              </label>
              {ch.state === "preliminary" ? (
                <div className="tk-dw-report-missing">
                  <p className="tk-dw-label">Still missing</p>
                  {items === null ? (
                    <p className="tk-dw-hint">Loading open requests…</p>
                  ) : (
                    <ul className="tk-dw-report-list">
                      {list.map(function (it, i) {
                        return (
                          <li key={i} className="tk-dw-report-item">
                            <input
                              type="text"
                              className="tk-dw-input"
                              maxLength={200}
                              aria-label={row.clientName + ", missing item " + (i + 1)}
                              value={it.label}
                              disabled={busy}
                              onChange={function (e) {
                                var v = e.target.value;
                                editItems(row, function (cur) {
                                  cur[i] = { label: v, request_id: (cur[i] && cur[i].request_id) || null };
                                  return cur;
                                });
                              }}
                            />
                            <button
                              type="button"
                              className="btn-secondary btn-sm"
                              disabled={busy}
                              aria-label={row.clientName + ", remove missing item " + (i + 1)}
                              onClick={function () {
                                editItems(row, function (cur) {
                                  return cur.filter(function (_, j) {
                                    return j !== i;
                                  });
                                });
                              }}
                            >
                              Remove
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {items !== null && list.length < TK_REPORT_MISSING_MAX ? (
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      disabled={busy}
                      onClick={function () {
                        editItems(row, function (cur) {
                          return cur.concat([{ label: "", request_id: null }]);
                        });
                      }}
                    >
                      Add item
                    </button>
                  ) : null}
                </div>
              ) : null}
            </fieldset>
          );
        })}
        {tried && problem ? (
          <p role="alert" className="tk-dw-hint tk-field-error">
            {problem.text}
          </p>
        ) : null}
      </div>
      <div className="modal-footer">
        <button type="button" className="btn-secondary" onClick={props.onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="btn-primary" onClick={submit} disabled={busy}>
          {busy ? "Saving…" : "Save and complete"}
        </button>
      </div>
    </ModalShell>
  );
  if (typeof ReactDOM !== "undefined" && ReactDOM.createPortal && typeof document !== "undefined") {
    return ReactDOM.createPortal(node, document.body);
  }
  return node;
}
