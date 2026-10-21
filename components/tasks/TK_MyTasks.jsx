// ----------------------------------------------------------------------------
// TK_MyTasks.jsx — My Tasks, grouped (Row 3.1), at #/tasks/my and embedded
// under Work › Tasks.
//
// TK_MyTasks({ staffUser, clients, isAdmin, embedded=false })
//   Groups: Overdue, Today (the view option; off merges it into This week),
//   This week, Later, Waiting on client, Done (collapsed by default). Empty
//   groups hide. Collapsed groups live in mgb_tk_groups_v1, the view options
//   in mgb_tk_view_v1. Loading shows 6 skeleton rows, an error shows the retry,
//   offline shows the banner over the cached rows, and a missing schema shows
//   the setup card.
//   Rhythm slice 0: TK_SlateViewBar under the toolbar (Group by Due date,
//   Client, Part of month or Status; Sort chips; quick chips Mine today and
//   Waiting on client; Reset view), saved per person in mgb_tk_slate_view_v1
//   (TK_vUseSlateView). The Desk's Slate tab uses the same bar.
// ----------------------------------------------------------------------------

var TK_vGROUPS_KEY = "mgb_tk_groups_v1";
var TK_vVIEW_KEY = "mgb_tk_view_v1";

var TK_vGROUPBY_KEY = "mgb_tk_groupby_v1";

// "Group by: Due date | Client", remembered per signed-in person (localStorage,
// never the server). Used by My Tasks and a person's list.
function TK_vUseGroupBy(email, scope) {
  // a person's list ("person") remembers its own choice, apart from My Tasks
  var key = typeof TK_groupByKey === "function" ? TK_groupByKey(email, scope) : TK_vGROUPBY_KEY + ":" + (scope === "person" ? "person:" : "") + (email || "");
  var pair = React.useState(function () {
    var v = TK_vLsGet(key, "due");
    return typeof TK_normalizeGroupBy === "function" ? TK_normalizeGroupBy(v) : v === "client" ? "client" : "due";
  });
  var set = function (v) {
    var n = typeof TK_normalizeGroupBy === "function" ? TK_normalizeGroupBy(v) : v;
    pair[1](n);
    TK_vLsSet(key, n);
  };
  return [pair[0], set];
}

function TK_vGroupBySwitch(props) {
  return (
    <label className="tk-select-wrap tk-groupby" data-tour="tk-groupby">
      <span className="tk-groupby-label">Sort by</span>
      <select
        className="tk-select"
        value={props.value}
        aria-label="Sort by"
        onChange={function (e) {
          props.onChange(e.target.value);
        }}
      >
        <option value="due">{props.dueLabel || "Due date"}</option>
        <option value="client">Client</option>
      </select>
    </label>
  );
}

// ---- Slate view control (month rhythm slice 0) ----------------------------------
// Group by, Sort chips, quick chips and Reset, saved per person in this
// browser (TK_slateViewKey). scope "desk" is the Desk's Slate tab, which keeps
// its own view. The Slate page falls back to the old Due date | Client choice
// and keeps writing it, so an earlier choice is never lost.
function TK_vUseSlateView(email, scope) {
  var desk = scope === "desk";
  var key = typeof TK_slateViewKey === "function" ? TK_slateViewKey(email, scope) : null;
  var legacyKey = desk ? null : typeof TK_groupByKey === "function" ? TK_groupByKey(email) : TK_vGROUPBY_KEY + ":" + (email || "");
  var read = function () {
    var saved = key ? TK_vLsGet(key, null) : null;
    var legacy = legacyKey ? TK_vLsGet(legacyKey, null) : null;
    if (typeof TK_slateViewRead === "function") return TK_slateViewRead(saved, legacy);
    return { groupBy: legacy === "client" ? "client" : "due", sort: null, chip: "" };
  };
  var pair = React.useState(read);
  var set = function (patch) {
    pair[1](function (cur) {
      var merged = Object.assign({}, cur, patch || {});
      var n = typeof TK_normalizeSlateView === "function" ? TK_normalizeSlateView(merged) : merged;
      if (key) TK_vLsSet(key, n);
      if (legacyKey && (n.groupBy === "due" || n.groupBy === "client")) TK_vLsSet(legacyKey, n.groupBy);
      return n;
    });
  };
  var reset = function () {
    set({ groupBy: "due", sort: null, chip: "" });
  };
  return [pair[0], set, reset];
}

// props: view, onChange(patch), onReset(), compact (the Desk tab),
// manual (Slate app P2, app only: { on, onToggle(on) } adds a Manual sort chip),
// viewsMenu (Slate app P3: the named saved views menu, passed only inside the
// Slate app), groupTour (data-tour of the Group by select; the Desk passes its own so a
// tip never finds two targets).
function TK_SlateViewBar(props) {
  var v = props.view || { groupBy: "due", sort: null, chip: "" };
  var groups = typeof TK_SLATE_GROUPS !== "undefined" ? TK_SLATE_GROUPS : [{ key: "due", label: "Due date" }, { key: "client", label: "Client" }];
  var sorts = typeof TK_SLATE_SORTS !== "undefined" ? TK_SLATE_SORTS : [];
  var chips = typeof TK_SLATE_CHIPS !== "undefined" ? TK_SLATE_CHIPS : [];
  var isDefault = typeof TK_isDefaultSlateView === "function" ? TK_isDefaultSlateView(v) : v.groupBy === "due" && !v.sort && !v.chip;
  var sortDir = function (col) {
    return v.sort && v.sort.col === col ? v.sort.dir : "";
  };
  return (
    <div className={"tk-slate-viewbar" + (props.compact ? " is-compact" : "")} role="group" aria-label="Slate view" data-tour={props.barTour || undefined}>
      {props.viewsMenu || null}
      <label className="tk-select-wrap tk-groupby" data-tour={props.groupTour === undefined ? "tk-groupby" : props.groupTour || undefined}>
        <span className="tk-groupby-label">Group by</span>
        <select
          className="tk-select"
          value={v.groupBy}
          aria-label="Group by"
          onChange={function (e) {
            props.onChange({ groupBy: e.target.value });
          }}
        >
          {groups.map(function (g) {
            return (
              <option key={g.key} value={g.key}>
                {g.label}
              </option>
            );
          })}
        </select>
      </label>
      {chips.length ? (
        <span className="tk-sv-set" role="group" aria-label="Quick views" data-tour={props.compact ? undefined : "tk-slate-chips"}>
          {chips.map(function (c) {
            var on = v.chip === c.key;
            return (
              <button
                key={c.key}
                type="button"
                className={"tk-filter-chip tk-sv-chip" + (on ? " is-on" : "")}
                aria-pressed={on ? "true" : "false"}
                onClick={function () {
                  props.onChange({ chip: on ? "" : c.key });
                }}
              >
                {c.label}
              </button>
            );
          })}
        </span>
      ) : null}
      {sorts.length ? (
        <span className="tk-sv-set" role="group" aria-label="Sort" data-tour={props.compact ? undefined : "tk-slate-sort"}>
          <span className="tk-groupby-label" aria-hidden="true">
            Sort
          </span>
          {sorts.map(function (s) {
            var dir = sortDir(s.col);
            var label = s.label + (dir === "asc" ? ", ascending" : dir === "desc" ? ", descending" : "");
            return (
              <button
                key={s.col}
                type="button"
                className={"tk-filter-chip tk-sv-chip" + (dir ? " is-on" : "")}
                aria-pressed={dir ? "true" : "false"}
                aria-label={"Sort by " + label}
                title={dir === "desc" ? "Click to go back to the default order" : dir === "asc" ? "Click for descending" : "Click to sort"}
                onClick={function () {
                  var next = typeof TK_toggleSort === "function" ? TK_toggleSort(v.sort, s.col) : null;
                  if (next && props.manual && props.manual.on) props.manual.onToggle(false);
                  props.onChange({ sort: next });
                }}
              >
                {s.label}
                {dir ? <span aria-hidden="true">{dir === "asc" ? " ↑" : " ↓"}</span> : null}
              </button>
            );
          })}
          {props.manual ? (
            <button
              type="button"
              className={"tk-filter-chip tk-sv-chip tk-manual-chip" + (props.manual.on ? " is-on" : "")}
              aria-pressed={props.manual.on ? "true" : "false"}
              aria-label="Sort by manual order"
              title="Drag rows to set your own order (Alt+Up or Alt+Down moves the focused row)"
              onClick={function () {
                props.manual.onToggle(!props.manual.on);
              }}
            >
              Manual
            </button>
          ) : null}
        </span>
      ) : null}
      {isDefault ? null : (
        <button type="button" className="tk-link-btn tk-sv-reset" onClick={props.onReset}>
          Reset view
        </button>
      )}
    </div>
  );
}

// Client group tag text for test and internal clients.
function TK_vGroupFlagText(flag) {
  if (flag === "internal") return "Internal";
  if (flag === "test") return "Test";
  return "";
}

function TK_vNameMap(list, keyField, nameField) {
  var m = {};
  (Array.isArray(list) ? list : []).forEach(function (x) {
    if (x && x[keyField] != null) m[String(x[keyField])] = x[nameField] || "";
  });
  return m;
}

// A small menu button (role="menu"), used for "View" and the list menus.
function TK_vMenuButton(props) {
  var pair = React.useState(false);
  var open = pair[0];
  var setOpen = pair[1];
  var btnRef = React.useRef(null);
  var menuRef = React.useRef(null);
  React.useEffect(
    function () {
      if (!open) return undefined;
      var first = menuRef.current ? menuRef.current.querySelector('[role^="menuitem"]') : null;
      if (first) {
        try {
          first.focus({ preventScroll: true });
        } catch (e) {}
      }
      var onDoc = function (e) {
        if (menuRef.current && menuRef.current.contains(e.target)) return;
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
  var onKey = function (e) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      if (btnRef.current) {
        try {
          btnRef.current.focus();
        } catch (err) {}
      }
      return;
    }
    if (e.key === "Tab") {
      setOpen(false);
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    var list = menuRef.current ? Array.prototype.slice.call(menuRef.current.querySelectorAll('[role^="menuitem"]')) : [];
    if (!list.length) return;
    var i = list.indexOf(document.activeElement);
    var j = e.key === "ArrowDown" ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
    try {
      list[j].focus();
    } catch (err) {}
  };
  var close = function () {
    setOpen(false);
  };
  // hoverOpen: a mouse pointer resting on the button or menu opens it; leaving closes it after a short grace
  var hoverT = React.useRef(null);
  var hoverIn = function (e) {
    if (!props.hoverOpen || (e && e.pointerType && e.pointerType !== "mouse")) return;
    if (hoverT.current) clearTimeout(hoverT.current);
    setOpen(true);
  };
  var hoverOut = function (e) {
    if (!props.hoverOpen || (e && e.pointerType && e.pointerType !== "mouse")) return;
    if (hoverT.current) clearTimeout(hoverT.current);
    hoverT.current = setTimeout(function () {
      setOpen(false);
    }, 250);
  };
  React.useEffect(function () {
    return function () {
      if (hoverT.current) clearTimeout(hoverT.current);
    };
  }, []);
  return (
    <span className="tk-pop-wrap" onPointerEnter={props.hoverOpen ? hoverIn : undefined} onPointerLeave={props.hoverOpen ? hoverOut : undefined}>
      <button
        type="button"
        ref={btnRef}
        className={props.className || "tk-tool-btn"}
        aria-haspopup="menu"
        aria-expanded={open ? "true" : "false"}
        aria-label={props.ariaLabel || undefined}
        title={props.title || undefined}
        onClick={function () {
          if (props.hoverOpen && open) return;
          setOpen(!open);
        }}
      >
        {props.label}
      </button>
      {open ? (
        <div className={"tk-menu" + (props.align === "right" ? " tk-menu-right" : "")} role="menu" aria-label={props.menuLabel || undefined} ref={menuRef} onKeyDown={onKey}>
          {props.children(close)}
        </div>
      ) : null}
    </span>
  );
}

function TK_MyTasks(props) {
  var schema = TK_vUseSchema();
  if (schema === "missing") return <TK_SetupCard embedded={!!props.embedded} />;
  if (schema !== "ok") {
    return (
      <div className={"tk-view tk-my" + (props.embedded ? " tk-embedded" : "")}>
        {props.embedded ? null : <h2 className="tk-view-title">Slate</h2>}
        <TK_vSkeletonRows count={6} />
      </div>
    );
  }
  return <TK_vMyTasksBody {...props} />;
}

function TK_vMyTasksBody(props) {
  var staffUser = props.staffUser || {};
  var email = TK_vLower(staffUser.email);
  var isAdmin = !!props.isAdmin;
  var embedded = !!props.embedded;
  var today = TK_vToday();
  var touch = TK_vUseTouch();
  var online = TK_vUseOnline();

  var vPair = React.useState(function () {
    var v = TK_vLsGet(TK_vVIEW_KEY, {}) || {};
    return { todayGroup: v.todayGroup !== false, showDone: v.showDone !== false };
  });
  var prefs = vPair[0];
  var setPrefs = vPair[1];
  var setPref = function (k, val) {
    setPrefs(function (p) {
      var n = Object.assign({}, p);
      n[k] = val;
      TK_vLsSet(TK_vVIEW_KEY, n);
      return n;
    });
  };
  var oPair = React.useState(false);
  var showOlder = oPair[0];
  var setShowOlder = oPair[1];
  var cPair = React.useState(function () {
    var g = TK_vLsGet(TK_vGROUPS_KEY, {});
    return g && typeof g === "object" ? g : {};
  });
  var collapsed = cPair[0];
  var setCollapsed = cPair[1];
  var fPair = React.useState("");
  var clientFilter = fPair[0];
  var setClientFilter = fPair[1];
  var focusPair = React.useState(null);
  var focusedId = focusPair[0];
  var setFocusedId = focusPair[1];
  var sigPair = React.useState({ id: null, n: 0 });
  var sig = sigPair[0];
  var setSig = sigPair[1];

  var loader = function () {
    if (typeof TK_api === "undefined" || !TK_api || typeof TK_api.listMine !== "function") return Promise.resolve([]);
    return TK_api.listMine(email, { showOlder: showOlder });
  };
  var list = TK_vUseList(email ? "mine" : null, loader);
  var firstOlder = React.useRef(true);
  React.useEffect(
    function () {
      if (firstOlder.current) {
        firstOlder.current = false;
        return;
      }
      if (list && typeof list.reload === "function") list.reload();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showOlder],
  );

  var drawerId = TK_vUseStore(function (s) {
    return s ? s.drawerId : null;
  });
  var projects = TK_vUseProjects();
  var clientNames = React.useMemo(
    function () {
      return TK_vNameMap(props.clients, "id", "name");
    },
    [props.clients],
  );
  var projectNames = React.useMemo(
    function () {
      return TK_vNameMap(projects, "id", "name");
    },
    [projects],
  );

  // S8b: admins see only the Unassigned tasks they own or on their own
  // book's clients (they are the bookkeeper); everyone else sees them all.
  var myBook = React.useMemo(
    function () {
      var out = {};
      (props.clients || []).forEach(function (c) {
        var bk = c && c.assignedBookkeeper && c.assignedBookkeeper.email;
        if (bk && TK_vLower(bk) === email) out[String(c.id)] = 1;
      });
      return out;
    },
    [props.clients, email],
  );
  var groupOpts = {
    email: email,
    showOlder: showOlder,
    todayGroup: prefs.todayGroup,
    isAdmin: isAdmin,
    inMyBook: function (clientId) {
      return !!myBook[String(clientId)];
    },
  };
  var all = Array.isArray(list.tasks) ? list.tasks : [];
  var tasks = clientFilter
    ? all.filter(function (t) {
        return t && String(t.client_id) === clientFilter;
      })
    : all;
  var groups = typeof TK_groupMyTasks === "function" ? TK_groupMyTasks(tasks, today, groupOpts) : {};
  // Rhythm slice 0: Group by (Due date, Client, Part of month, Status), Sort
  // chips and quick chips, saved per person. Nothing chosen builds the groups
  // exactly as before (TK_slateBuildView's default path is TK_myGroupsView).
  var svPair = TK_vUseSlateView(email);
  var sv = svPair[0];
  // Slate app P3: named saved views, only inside the Slate app.
  var slateApp = typeof TK_useSlateInApp === "function" ? TK_useSlateInApp() : false;
  var groupBy = sv.groupBy;
  var built =
    typeof TK_slateBuildView === "function"
      ? TK_slateBuildView(groups, sv, {
          collapsed: collapsed,
          showDone: prefs.showDone,
          email: email,
          today: today,
          clients: props.clients || [],
          flagOf: typeof CF_flag === "function" ? CF_flag : undefined,
        })
      : null;
  var byDue = built ? built.byDue : true;
  var byClient = !byDue && groupBy === "client";
  var view = built ? built.groups : TK_myGroupsView(groups, { collapsed: collapsed, showDone: prefs.showDone });
  // Slate app P2: manual order (drag, Alt+Up / Alt+Down) within each group.
  // App only, regular or full width, and no other sort; off on the portal page.
  // The order is the person's own (tk_manual_order), never the shared sort_key.
  var manualMode = typeof TK_useSlateMode === "function" ? TK_useSlateMode() : null;
  var manualPair = typeof TK_useManualPref === "function" ? TK_useManualPref("my") : [false, function () {}];
  var manualCan =
    typeof TK_manualOrderAllowed === "function" &&
    !embedded &&
    TK_manualOrderAllowed({ inApp: slateApp, mode: manualMode && manualMode.mode, kind: "my", sort: null, readOnly: !online });
  var manualOn = manualCan && manualPair[0] && !(sv.sort && sv.sort.col);
  var manualKeys = typeof TK_useManualOrder === "function" ? TK_useManualOrder("my", manualOn) : {};
  if (manualOn && typeof TK_manualSortGroups === "function") view = TK_manualSortGroups(view, manualKeys);
  // Only a quick chip can empty a list that has tasks (the client filter has
  // its own empty copy), so "No tasks match this view" shows only then.
  var chipEmptied = !!(sv && sv.chip) && TK_myGroupsView(groups, { showDone: prefs.showDone }).length > 0;
  // Subtasks open inline under their parent (a subtask whose parent is in the
  // same group is shown there, not as its own row).
  var subs = TK_vUseSubtasks(tasks);
  view = TK_subNestGroups(view, subs.kidsOf);
  var ids = TK_focusIds(view);
  var manualBoxRef = React.useRef(null);
  var manualSay = typeof TK_useManualAnnouncer === "function" ? TK_useManualAnnouncer() : null;
  var manualRun = function (plan) {
    if (!plan || typeof TK_manualMove !== "function") return;
    TK_manualMove(plan, {
      scope: "my",
      labelOf: function (k) {
        for (var i = 0; i < view.length; i++) if (view[i].key === k) return view[i].label;
        return "";
      },
      say: manualSay ? manualSay.say : null,
    });
  };
  var byId = {};
  tasks.forEach(function (t) {
    if (t && t.id != null) byId[t.id] = t;
  });
  var counts = TK_vUseChecklist(ids);

  // My clients for the filter: the ones my tasks point at, by name (and the
  // Unassigned ones My Tasks shows; not every open Unassigned task loaded).
  var myClients = React.useMemo(
    function () {
      var seen = {};
      var shown = typeof TK_groupMyTasks === "function" ? TK_groupMyTasks(all, today, groupOpts).unassigned || [] : [];
      all.forEach(function (t) {
        if (t && t.client_id != null && (t.assignee_email || shown.indexOf(t) >= 0)) seen[String(t.client_id)] = 1;
      });
      var list = Object.keys(seen)
        .map(function (id) {
          var full = (props.clients || []).filter(function (c) { return c && String(c.id) === id; })[0] || {};
          return { id: id, name: clientNames[id] || id, testOnly: full.testOnly, isInternal: full.isInternal };
        })
        .sort(function (a, b) {
          var x = a.name.toLowerCase();
          var y = b.name.toLowerCase();
          return x < y ? -1 : x > y ? 1 : 0;
        });
      // Test clients and MGB (internal) last, tagged (ClientFlags.jsx).
      if (typeof CF_sort === "function") list = CF_sort(list);
      return list;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [all, clientNames, props.clients, myBook, isAdmin, email],
  );

  // P4-3: multi-select (schema 12+ only; v / Shift+V, checkbox, Shift+click).
  // Only rows on screen stay selected (a collapsed group or hidden done
  // tasks drop out), so Delete or Reassign never touch a row you can't see.
  // Slate app full mode: the task sits in the pane, so the list keeps its keys.
  var keysOn = typeof TK_useListKeysOn === "function" ? TK_useListKeysOn(drawerId) : !drawerId;
  var slateWide = typeof TK_useSlateWide === "function" ? TK_useSlateWide() : true;
  var bulk = TK_useBulkSelect({ ids: ids, enabled: online && slateWide, keys: keysOn });
  var bulkStaff = TK_vUseStaff(bulk.count > 0);
  var addStaff = TK_vUseStaff(false) || []; // for the group add rows: the store's list, no extra fetch

  var keys = TK_useKeys({
    ids: ids,
    focusedId: focusedId,
    setFocusedId: setFocusedId,
    enabled: keysOn,
    onSelect: bulk.ready ? bulk.toggle : undefined,
    onOpen: function (id) {
      TK_vOpenTask(id, { from: "keys" });
    },
    onToggleDone: function (id) {
      if (online && byId[id]) TK_vComplete(byId[id], isAdmin);
    },
    onStatusMenu: function (id) {
      setSig(function (s) {
        return { id: id, n: s.n + 1 };
      });
    },
    quickAdd: clientFilter ? { client_id: clientFilter } : {},
  });
  if (typeof TK_useRowDrag === "function") {
    TK_useRowDrag({ enabled: manualOn, containerRef: manualBoxRef, groups: view, crossGroup: false, onMove: manualRun });
  }
  if (typeof TK_useManualKeys === "function") {
    TK_useManualKeys({ enabled: manualOn && keysOn, groups: view, focusedId: focusedId, crossGroup: false, onMove: manualRun });
  }

  var toggleGroup = function (key, isCollapsed) {
    setCollapsed(function (c) {
      var n = Object.assign({}, c);
      n[key] = !isCollapsed;
      TK_vLsSet(TK_vGROUPS_KEY, n);
      return n;
    });
  };
  var addTask = function () {
    try {
      window.dispatchEvent(new CustomEvent("tk:quick-add", { detail: clientFilter ? { client_id: clientFilter } : {} }));
    } catch (e) {}
  };

  var loading = !!list.loading && !all.length;
  var err = list.error && !all.length ? list.error : null;
  if (err && (err === "tk_schema_missing" || err.code === "tk_schema_missing")) return <TK_SetupCard embedded={embedded} />;

  var firstRowDone = false;
  var firstClaimDone = false;
  var body;
  if (loading) body = <TK_vSkeletonRows count={6} />;
  else if (err) body = <TK_vErrorState onRetry={list.reload} />;
  else if (!view.length && chipEmptied) {
    body = (
      <div className="tk-empty">
        <p>No tasks match this view.</p>
        <button type="button" className="btn-secondary" onClick={svPair[2]}>
          Reset view
        </button>
      </div>
    );
  } else if (!view.length) {
    body = (
      <div className="tk-empty">
        <p>{clientFilter ? TK_vCopy("emptyList") : touch ? TK_vCopy("emptyMineTouch") : TK_vCopy("emptyMine")}</p>
      </div>
    );
  } else {
    body = (
      <div className={"tk-groups" + (manualOn ? " is-manual" : "")} data-tour="tk-groups" ref={manualBoxRef}>
        {view.map(function (g, gi) {
          var gid = "tk-group-" + String(g.key).replace(/[^a-zA-Z0-9_-]/g, "_");
          return (
            <section
              key={g.key}
              className={"tk-group " + (byClient ? "tk-group-client" : byDue ? "tk-group-" + g.key : "tk-group-" + groupBy) + (g.collapsed ? " is-collapsed" : "")}
              aria-labelledby={gid}
              data-tour={g.key === "unassigned" ? "tk-unassigned-group" : undefined}
            >
              <h3 className="tk-group-head" id={gid}>
                <button
                  type="button"
                  className="tk-group-btn"
                  aria-expanded={g.collapsed ? "false" : "true"}
                  onClick={function () {
                    toggleGroup(g.key, g.collapsed);
                  }}
                >
                  <TK_vIcon name="chevron" size={14} className="tk-chev" />
                  <span className="tk-group-name">{g.label}</span>
                  {byClient && g.flag ? <span className="tk-group-flag">{TK_vGroupFlagText(g.flag)}</span> : null}
                  <span className="tk-count">{g.tasks.length}</span>
                </button>
                {!g.collapsed && typeof TK_BulkGroupBox === "function" ? <TK_BulkGroupBox select={bulk} tasks={g.tasks} label={g.label} /> : null}
              </h3>
              {g.collapsed ? null : (
                <ul className="tk-rows" role="grid" aria-label={g.label} data-tk-group={manualOn ? String(gi) : undefined}>
                  {g.tasks.map(function (t) {
                    var tour = !firstRowDone;
                    firstRowDone = true;
                    // S8b: an Unassigned row is claimed first, then worked.
                    var un = !byDue ? !t.assignee_email && !t.done : g.key === "unassigned";
                    var claimTour = un && !firstClaimDone;
                    if (un) firstClaimDone = true;
                    return (
                      <TK_TaskRow
                        key={t.id}
                        task={t}
                        today={today}
                        clientName={t.client_id != null ? clientNames[String(t.client_id)] || "" : ""}
                        projectName={t.project_id ? projectNames[t.project_id] || "" : ""}
                        projectColor={t.project_id ? TK_projectColorById(projects, t.project_id) : ""}
                        subs={subs}
                        showClient={!clientFilter && !byClient}
                        focused={focusedId === t.id}
                        checklist={counts[t.id] || null}
                        isAdmin={isAdmin}
                        canEdit={online}
                        statusSignal={sig.id === t.id ? sig.n : 0}
                        tourStatus={tour}
                        onFocusRow={setFocusedId}
                        onOpen={function (id) {
                          setFocusedId(id);
                          TK_vOpenTask(id, { from: "list" });
                        }}
                        onToggleDone={
                          online && !un
                            ? function (task) {
                                TK_vComplete(task, isAdmin);
                              }
                            : undefined
                        }
                        onStatus={
                          un
                            ? null
                            : function (task, s, note) {
                                TK_vSetStatus(task, s, note, isAdmin);
                              }
                        }
                        onClaim={online ? TK_vClaim : undefined}
                        tourClaim={claimTour}
                        onSelect={bulk.ready ? bulk.toggle : undefined}
                        selected={bulk.has(t.id)}
                        selecting={bulk.count > 0}
                        dragHandle={manualOn || undefined}
                      />
                    );
                  })}
                  {(function () {
                    // T2: "+ Add task" at the bottom of a group; the group says the due date or client.
                    var ga = typeof TK_rwGroupAdd === "function" ? TK_rwGroupAdd(g.key, { today: today, canCreate: online }) : { show: false };
                    if (!ga.show) return null;
                    return (
                      <TK_vAddRow
                        sectionName={g.label}
                        ctx={{ email: email, staff: addStaff, clients: props.clients || [], clientId: clientFilter || null }}
                        group={ga}
                        disabled={!online}
                      />
                    );
                  })()}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    );
  }

  return (
    <div className={"tk-view tk-my" + (embedded ? " tk-embedded" : "")}>
      <div className="tk-view-head">
        {embedded ? null : <h2 className="tk-view-title">Slate</h2>}
        <div className="tk-toolbar" role="toolbar" aria-label="Slate options">
          <button type="button" className="btn-primary tk-add-btn" data-tour="tk-add" onClick={addTask}>
            <TK_vIcon name="plus" size={15} />
            <span>Add task</span>
          </button>
          {myClients.length ? (
            <label className="tk-select-wrap">
              <span className="tk-sr">Client</span>
              <select
                className="tk-select"
                value={clientFilter}
                onChange={function (e) {
                  setClientFilter(e.target.value);
                  setFocusedId(null);
                }}
              >
                <option value="">All clients</option>
                {myClients.map(function (c) {
                  return (
                    <option key={c.id} value={c.id}>
                      {typeof CF_label === "function" ? CF_label(c) : c.name}
                    </option>
                  );
                })}
              </select>
            </label>
          ) : null}
          <TK_vSwitch
            checked={prefs.showDone}
            label="Show done"
            onChange={function (v) {
              setPref("showDone", v);
              if (!v) setShowOlder(false);
            }}
          />
          {prefs.showDone ? <TK_vSwitch checked={showOlder} label="Show older" onChange={setShowOlder} /> : null}
          <TK_vMenuButton label={<span className="tk-tool-label">View<TK_vIcon name="down" size={12} /></span>} menuLabel="View options">
            {function (close) {
              return (
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={prefs.todayGroup ? "true" : "false"}
                  className="tk-menu-item"
                  onClick={function () {
                    setPref("todayGroup", !prefs.todayGroup);
                    close();
                  }}
                >
                  <span className={"tk-menu-check" + (prefs.todayGroup ? " is-on" : "")} aria-hidden="true">
                    {prefs.todayGroup ? <TK_vIcon name="check" size={12} /> : null}
                  </span>
                  Today group
                </button>
              );
            }}
          </TK_vMenuButton>
          {touch ? null : (
            <button type="button" className="tk-icon-btn tk-keys-btn" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" onClick={keys.openHelp}>
              <TK_vIcon name="keyboard" size={16} />
            </button>
          )}
        </div>
      </div>
      <TK_SlateViewBar
        view={sv}
        onChange={svPair[1]}
        onReset={svPair[2]}
        viewsMenu={slateApp && typeof TK_SavedViewsMenu === "function" ? <TK_SavedViewsMenu view={sv} onApply={svPair[1]} email={email} scope="slate" /> : null}
        manual={
          manualCan
            ? {
                on: manualOn,
                onToggle: function (on) {
                  if (on && sv.sort) svPair[1]({ sort: null });
                  manualPair[1](!!on);
                },
              }
            : undefined
        }
      />
      {!online ? <TK_vOfflineBanner /> : null}
      {body}
      {manualOn && manualSay ? manualSay.el : null}
      <TK_BulkBar select={bulk} tasksById={byId} staff={bulkStaff} projects={projects} readOnly={!online} />
      {keys.sheet}
    </div>
  );
}
