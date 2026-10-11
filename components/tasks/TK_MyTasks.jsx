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
// ----------------------------------------------------------------------------

var TK_vGROUPS_KEY = "mgb_tk_groups_v1";
var TK_vVIEW_KEY = "mgb_tk_view_v1";

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
  return (
    <span className="tk-pop-wrap">
      <button
        type="button"
        ref={btnRef}
        className={props.className || "tk-tool-btn"}
        aria-haspopup="menu"
        aria-expanded={open ? "true" : "false"}
        aria-label={props.ariaLabel || undefined}
        title={props.title || undefined}
        onClick={function () {
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
        {props.embedded ? null : <h2 className="tk-view-title">My Tasks</h2>}
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

  var all = Array.isArray(list.tasks) ? list.tasks : [];
  var tasks = clientFilter
    ? all.filter(function (t) {
        return t && String(t.client_id) === clientFilter;
      })
    : all;
  var groups = typeof TK_groupMyTasks === "function" ? TK_groupMyTasks(tasks, today, { email: email, showOlder: showOlder, todayGroup: prefs.todayGroup }) : {};
  var view = TK_myGroupsView(groups, { collapsed: collapsed, showDone: prefs.showDone });
  var ids = TK_focusIds(view);
  var byId = {};
  tasks.forEach(function (t) {
    if (t && t.id != null) byId[t.id] = t;
  });
  var counts = TK_vUseChecklist(ids);

  // My clients for the filter: the ones my tasks point at, by name.
  var myClients = React.useMemo(
    function () {
      var seen = {};
      all.forEach(function (t) {
        if (t && t.client_id != null) seen[String(t.client_id)] = 1;
      });
      return Object.keys(seen)
        .map(function (id) {
          return { id: id, name: clientNames[id] || id };
        })
        .sort(function (a, b) {
          var x = a.name.toLowerCase();
          var y = b.name.toLowerCase();
          return x < y ? -1 : x > y ? 1 : 0;
        });
    },
    [all, clientNames],
  );

  var keys = TK_useKeys({
    ids: ids,
    focusedId: focusedId,
    setFocusedId: setFocusedId,
    enabled: !drawerId,
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
  var body;
  if (loading) body = <TK_vSkeletonRows count={6} />;
  else if (err) body = <TK_vErrorState onRetry={list.reload} />;
  else if (!view.length) {
    body = (
      <div className="tk-empty">
        <p>{clientFilter ? TK_vCopy("emptyList") : touch ? TK_vCopy("emptyMineTouch") : TK_vCopy("emptyMine")}</p>
      </div>
    );
  } else {
    body = (
      <div className="tk-groups" data-tour="tk-groups">
        {view.map(function (g) {
          var gid = "tk-group-" + g.key;
          return (
            <section key={g.key} className={"tk-group tk-group-" + g.key + (g.collapsed ? " is-collapsed" : "")} aria-labelledby={gid}>
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
                  <span className="tk-count">{g.tasks.length}</span>
                </button>
              </h3>
              {g.collapsed ? null : (
                <ul className="tk-rows" role="grid" aria-label={g.label}>
                  {g.tasks.map(function (t) {
                    var tour = !firstRowDone;
                    firstRowDone = true;
                    return (
                      <TK_TaskRow
                        key={t.id}
                        task={t}
                        today={today}
                        clientName={t.client_id != null ? clientNames[String(t.client_id)] || "" : ""}
                        projectName={t.project_id ? projectNames[t.project_id] || "" : ""}
                        showClient={!clientFilter}
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
                          online
                            ? function (task) {
                                TK_vComplete(task, isAdmin);
                              }
                            : undefined
                        }
                        onStatus={function (task, s, note) {
                          TK_vSetStatus(task, s, note, isAdmin);
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
    <div className={"tk-view tk-my" + (embedded ? " tk-embedded" : "")}>
      <div className="tk-view-head">
        {embedded ? null : <h2 className="tk-view-title">My Tasks</h2>}
        <div className="tk-toolbar" role="toolbar" aria-label="My Tasks options">
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
                      {c.name}
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
      {!online ? <TK_vOfflineBanner /> : null}
      {body}
      {keys.sheet}
    </div>
  );
}
