// ----------------------------------------------------------------------------
// WB_HubTasks: the My tasks tab of the Workbench hub (Workbench Hub spec H2).
//
// Every open task assigned to me, grouped like My Tasks' default view
// (Overdue, Today, This week, Later, Waiting on client). It reads the same
// pieces My Tasks does and edits none of them:
//   TK_vUseList("wb:mine", ...)   its OWN list key. TK_sync refetches a key with
//                                 the first loader registered for it, and My
//                                 Tasks' loader changes with Show older, so the
//                                 hub never shares the "mine" key.
//   TK_groupMyTasks / TK_myGroupsView / TK_subNestGroups   the same grouping.
//   TK_TaskRow                    today's props only (no selection, no bulk);
//                                 subtasks open inline under their task.
//   TK_vOpenTask                  a row opens the task drawer on top of the hub
//   TK_vComplete / TK_vSetStatus  the one completion and status paths
// Unassigned and Done never show here. At most WB_HUB_TASK_CAP rows draw, then
// "Show all on My Tasks". Collapsed groups live in the hub state (saved with
// it), not in My Tasks' own key.
// Rhythm slice 0: the Slate view bar (TK_SlateViewBar) sits above the groups,
// saved per person under mgb_tk_slate_view_v1:desk:<email>. Nothing chosen
// keeps the default groups above; the tab count always uses them.
//
// Browser file; loads after WB_Hub.jsx. Uses TK_* globals at render time only.
// ----------------------------------------------------------------------------

function WB_hubNames(list) {
  var out = {};
  (Array.isArray(list) ? list : []).forEach(function (c) {
    if (c && c.id != null && c.name) out[String(c.id)] = c.name;
  });
  return out;
}

// Stand-in for TK_vUseSlateView when the Slate files are older than this one:
// no view control, the default groups.
function WB_hubNoSlateView() {
  return [null, function () {}, function () {}];
}

function WB_HubTasks(props) {
  var ok = typeof TK_vUseSchema === "function" && typeof TK_vUseList === "function" && typeof TK_TaskRow === "function" && typeof TK_groupMyTasks === "function" && typeof TK_myGroupsView === "function";
  if (!ok) {
    return (
      <p className="wb-filtered-empty" role="status">
        Slate isn't available here yet. <a href="#/tasks/my">Slate</a>
      </p>
    );
  }
  return <WB_HubTasksGate {...props} />;
}

function WB_HubTasksGate(props) {
  var schema = TK_vUseSchema();
  if (schema === "missing") {
    return (
      <p className="wb-filtered-empty" role="status">
        Slate is being set up. Try again in a little while.
      </p>
    );
  }
  if (schema !== "ok") {
    return (
      <div className="tk-view">
        <TK_vSkeletonRows count={5} />
      </div>
    );
  }
  return <WB_HubTasksBody {...props} />;
}

// props: me (lowercase email), isAdmin, clients, collapsed (hub state),
// onCollapse(key, isCollapsed), onCount(n | null), onReady(), active.
function WB_HubTasksBody(props) {
  var email = String(props.me || "").toLowerCase();
  var isAdmin = !!props.isAdmin;
  var today = TK_vToday();
  var online = TK_vUseOnline();
  // The Slate app (TK_SlateBridge.jsx): "Open Slate app" instead of the pop-out.
  var slateOn = typeof TK_useSlateAppOn === "function" ? TK_useSlateAppOn() : false;
  var paneRef = React.useRef(null);
  var focusPair = React.useState(null);
  var focusedId = focusPair[0];
  var setFocusedId = focusPair[1];
  // Rhythm slice 0: the same Group by / Sort / quick chips control as the
  // Slate page, saved per person for the Desk (its own key). Client, Part of
  // month and Status folds live here only; the hub state keeps its due groups.
  var useSv = typeof TK_vUseSlateView === "function" ? TK_vUseSlateView : WB_hubNoSlateView;
  var svPair = useSv(email, "desk");
  var localColPair = React.useState({});

  var loader = function () {
    if (typeof TK_api === "undefined" || !TK_api || typeof TK_api.listMine !== "function") return Promise.resolve([]);
    return TK_api.listMine(email, { showOlder: false });
  };
  var list = TK_vUseList(email ? "wb:mine" : null, loader);
  var all = Array.isArray(list.tasks) ? list.tasks : [];

  // The first load is "settled" only after it really started and finished (or
  // there are rows, or it failed), so the tab never reports a false 0.
  var sawRef = React.useRef(false);
  if (list.loading) sawRef.current = true;
  var loaded = WB_hubTasksReady(list, sawRef.current);

  // A task assigned to me that the store knows but this list lacks (made by
  // quick add, reassigned to me): TK_stMatches cannot place the wb:mine key, so
  // reload it, debounced. The selector returns a string so it only re-renders
  // when the set of missing ids changes.
  var missing = TK_vUseStore(function (st) {
    if (!email || !st || !st.tasks) return "";
    var L = st.lists && st.lists["wb:mine"];
    if (!L || L.loading || !L.at) return "";
    var have = {};
    (L.ids || []).forEach(function (id) {
      have[id] = 1;
    });
    var out = [];
    for (var id in st.tasks) {
      if (!Object.prototype.hasOwnProperty.call(st.tasks, id) || have[id]) continue;
      var t = st.tasks[id];
      if (!t || t.deleted_at || t.done || t.status === "done") continue;
      if (String(t.assignee_email || "").toLowerCase() !== email) continue;
      out.push(id);
    }
    return out.sort().join(",");
  });
  var reloadRef = React.useRef(list.reload);
  reloadRef.current = list.reload;
  var lastReloadedRef = React.useRef("");
  var loadedRef = React.useRef(false);
  loadedRef.current = loaded;
  React.useEffect(
    function () {
      if (!missing) {
        lastReloadedRef.current = "";
        return undefined;
      }
      if (!WB_hubShouldReload(missing, lastReloadedRef.current, loadedRef.current)) return undefined;
      var tm = setTimeout(function () {
        lastReloadedRef.current = missing;
        if (reloadRef.current) reloadRef.current();
      }, 500);
      return function () {
        clearTimeout(tm);
      };
    },
    [missing, loaded],
  );

  var projects = TK_vUseProjects();
  var clientNames = React.useMemo(
    function () {
      return WB_hubNames(props.clients);
    },
    [props.clients],
  );
  var projectNames = React.useMemo(
    function () {
      return WB_hubNames(projects);
    },
    [projects],
  );

  var groups = TK_groupMyTasks(all, today, { email: email, showOlder: false, todayGroup: true, isAdmin: isAdmin });
  var view = TK_myGroupsView(groups, { collapsed: props.collapsed || {}, showDone: false });
  var subs = TK_vUseSubtasks(all);
  if (typeof TK_subNestGroups === "function") view = TK_subNestGroups(view, subs.kidsOf);
  var baseShown = WB_hubTaskGroups(view, WB_HUB_TASK_CAP);
  var sv = svPair[0];
  var custom = !!sv && typeof TK_slateBuildView === "function" && typeof TK_isDefaultSlateView === "function" && !TK_isDefaultSlateView(sv);
  var dueGroups = !custom || sv.groupBy === "due";
  var shown = baseShown;
  if (custom) {
    var built = TK_slateBuildView(groups, sv, {
      collapsed: dueGroups ? props.collapsed || {} : localColPair[0],
      showDone: false,
      skipUnassigned: true,
      email: email,
      today: today,
      clients: props.clients || [],
      flagOf: typeof CF_flag === "function" ? CF_flag : undefined,
    });
    var cview = built.groups;
    if (typeof TK_subNestGroups === "function") cview = TK_subNestGroups(cview, subs.kidsOf);
    shown = WB_hubTaskGroups(cview, WB_HUB_TASK_CAP, dueGroups ? undefined : { anyKey: true });
  }
  var byClientGroups = custom && sv.groupBy === "client";
  var collapseGroup = function (key, isCollapsed) {
    if (dueGroups) {
      if (props.onCollapse) props.onCollapse(key, isCollapsed);
      return;
    }
    localColPair[1](function (c) {
      var n = Object.assign({}, c);
      n[key] = isCollapsed;
      return n;
    });
  };
  var ids = [];
  shown.groups.forEach(function (g) {
    g.tasks.forEach(function (t) {
      if (t && t.id != null) ids.push(t.id);
    });
  });
  // One row is always focusable (roving tabindex): the one I last used, else the first.
  var rovingId = focusedId != null && ids.indexOf(focusedId) >= 0 ? focusedId : ids.length ? ids[0] : null;
  var counts = TK_vUseChecklist(ids);

  var loading = !loaded;
  var err = list.error && !all.length ? list.error : null;
  var onCount = props.onCount;
  var onReady = props.onReady;
  // The tab count always uses the default groups, so a chip never changes it.
  var total = baseShown.total;
  var settled = loaded;
  React.useEffect(
    function () {
      if (onCount) onCount(settled && !err ? total : null);
    },
    [total, settled, !!err],
  );
  React.useEffect(
    function () {
      if (settled && onReady) onReady();
    },
    [settled],
  );

  var openTask = function (id) {
    setFocusedId(id);
    WB_store.setHub({ lastFocus: "tk:" + id }, true);
    WB_track("wb-action", WB__taskDrawerReady() ? "task:open-in-place" : "task:open");
    TK_vOpenTask(id, { from: "wb-hub" });
  };
  // A plain click on a row's title link (TK_TaskRow handles the open itself):
  // remember the row for focus return and log the same way.
  var onClickCapture = function (e) {
    var t = e.target;
    var a = t && t.closest ? t.closest("a.tk-row-title") : null;
    if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var row = a ? a.closest("[data-tk-id],[data-tk-sub]") : null;
    if (!a && t && t.closest) {
      // A body click on a subtask row (not on a control) counts like a main row.
      var sub = t.closest("li[data-tk-sub]");
      if (sub && !t.closest("a, button, input, select, textarea, [role='menu']")) row = sub;
    }
    if (!row) return;
    var id = row ? row.getAttribute("data-tk-id") || row.getAttribute("data-tk-sub") : null;
    if (!id) return;
    setFocusedId(id);
    WB_store.setHub({ lastFocus: "tk:" + id }, true);
    WB_track("wb-action", WB__taskDrawerReady() ? "task:open-in-place" : "task:open");
  };
  var addTask = function () {
    WB_track("wb-action", "task:add");
    try {
      window.dispatchEvent(new CustomEvent("tk:quick-add", { detail: {} }));
    } catch (e) {}
  };
  var complete = function (task) {
    Promise.resolve(TK_vComplete(task, isAdmin)).then(function () {
      // The Inbox count and the other task lists catch up (debounced).
      try {
        window.dispatchEvent(new CustomEvent("mgb:staff-items-changed"));
      } catch (e) {}
    });
  };

  // Arrow keys move between rows (the row list is roving: one row is focusable).
  var onKeyDown = function (e) {
    if (e.key === "Enter" && e.target && e.target.matches && e.target.matches("li.tk-row[data-tk-id]") && !e.defaultPrevented) {
      e.preventDefault();
      openTask(e.target.getAttribute("data-tk-id"));
      return;
    }
    if (e.key === "Enter" && e.target && e.target.matches && e.target.matches("li[data-tk-sub]") && !e.defaultPrevented) {
      e.preventDefault();
      openTask(e.target.getAttribute("data-tk-sub"));
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    var t = e.target;
    if (!t || !t.closest || t.closest("input, select, textarea, [role='menu']")) return;
    var row = t.closest("li.tk-row[data-tk-id]");
    var pane = paneRef.current;
    if (!row || !pane) return;
    var rows = Array.prototype.filter.call(pane.querySelectorAll("li.tk-row[data-tk-id]"), function (el) {
      return el.offsetParent !== null;
    });
    var i = rows.indexOf(row);
    var next = rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
    if (!next || next === row) return;
    e.preventDefault();
    setFocusedId(next.getAttribute("data-tk-id"));
    try {
      next.focus({ preventScroll: false });
    } catch (x) {}
  };

  var body;
  if (loading) body = <TK_vSkeletonRows count={6} />;
  else if (err) body = <TK_vErrorState onRetry={list.reload} />;
  else if (!shown.groups.length && custom && baseShown.total > 0) {
    body = (
      <div className="wb-filtered-empty" role="status">
        <p>No tasks match this view.</p>
        <button type="button" className="btn-secondary" onClick={svPair[2]}>
          Reset view
        </button>
      </div>
    );
  } else if (!shown.groups.length) {
    body = (
      <p className="wb-filtered-empty" role="status">
        Nothing assigned to you right now.
      </p>
    );
  } else {
    body = (
      <div className="tk-groups wb-hub-groups">
        {shown.groups.map(function (g) {
          var gid = "wb-hub-group-" + String(g.key).replace(/[^a-zA-Z0-9_-]/g, "_");
          return (
            <section key={g.key} className={"tk-group tk-group-" + (dueGroups ? g.key : sv.groupBy) + (g.collapsed ? " is-collapsed" : "")} aria-labelledby={gid}>
              <h3 className="tk-group-head" id={gid}>
                <button
                  type="button"
                  className="tk-group-btn"
                  aria-expanded={g.collapsed ? "false" : "true"}
                  onClick={function () {
                    collapseGroup(g.key, !g.collapsed);
                  }}
                >
                  <TK_vIcon name="chevron" size={14} className="tk-chev" />
                  <span className="tk-group-name">{g.label}</span>
                  <span className="tk-count">{g.total}</span>
                </button>
              </h3>
              {g.collapsed || !g.tasks.length ? null : (
                <ul className="tk-rows" role="grid" aria-label={g.label}>
                  {g.tasks.map(function (t) {
                    return (
                      <TK_TaskRow
                        key={t.id}
                        task={t}
                        today={today}
                        clientName={t.client_id != null ? clientNames[String(t.client_id)] || "" : ""}
                        projectName={t.project_id ? projectNames[t.project_id] || "" : ""}
                        projectColor={t.project_id && typeof TK_projectColorById === "function" ? TK_projectColorById(projects, t.project_id) : ""}
                        subs={subs}
                        showClient={!byClientGroups}
                        focused={rovingId === t.id}
                        checklist={counts[t.id] || null}
                        isAdmin={isAdmin}
                        canEdit={online}
                        onFocusRow={setFocusedId}
                        onOpen={openTask}
                        onToggleDone={online ? complete : undefined}
                        onStatus={function (task, s, note) {
                          Promise.resolve(TK_vSetStatus(task, s, note, isAdmin)).then(function () {
                            if (s === "done") {
                              try {
                                window.dispatchEvent(new CustomEvent("mgb:staff-items-changed"));
                              } catch (x) {}
                            }
                          });
                        }}
                      />
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    );
  }

  return (
    <div className="tk-view wb-hub-tasks" ref={paneRef} onKeyDown={onKeyDown} onClickCapture={onClickCapture} data-tour="wb-hub-tasks">
      {!online ? <p className="wb-offline-line" role="status">Offline. Changes wait until you're back.</p> : null}
      {slateOn && typeof TK_SlateLaunch === "function" ? (
        <div className="wb-hub-popout">
          <TK_SlateLaunch hash="#/tasks/my" iconSize={14} />
        </div>
      ) : typeof TK_popOut === "function" ? (
        <div className="wb-hub-popout">
          <button type="button" className="tk-tool-btn tk-popout-btn" title="Open Slate in its own window" onClick={function () { TK_popOut("#/tasks/my"); }}>
            <TK_vIcon name="window" size={14} />
            <span>Open in own window</span>
          </button>
        </div>
      ) : null}
      {sv && typeof TK_SlateViewBar === "function" ? <TK_SlateViewBar view={sv} onChange={svPair[1]} onReset={svPair[2]} compact groupTour={null} barTour="wb-slate-view" /> : null}
      {body}
      {shown.more > 0 ? (
        <p className="wb-later">
          {shown.more} more not shown · <a href="#/tasks/my">Show all on Slate</a>
        </p>
      ) : null}
      <div className="wb-hub-tasks-foot">
        <button type="button" className="btn-secondary wb-hub-add" onClick={addTask}>
          Add to your {WB_SLATE}
        </button>
        <a className="wb-hub-link" href="#/tasks/my">
          Slate page
        </a>
      </div>
    </div>
  );
}
