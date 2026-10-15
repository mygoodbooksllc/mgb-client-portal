// ----------------------------------------------------------------------------
// TK_Sidebar.jsx — the Tasks lists sidebar and the New project modal
// (views slice, Row 1.4 and Row 11.5).
//
// TK_Sidebar({ route, clients, isAdmin, staffUser, onNavigate(route) })
//   My Tasks, Search, Projects (archived hidden, "New project"), Clients and,
//   for admins, People. Every item is a real link (TK_formatRoute), so a
//   modifier click opens a new tab; a plain click calls onNavigate.
// TK_NewProjectModal({ isAdmin, kind, clientId, clientName, onClose, onCreated(project) })
//   name, sections (one per line) and, for admins only, "Open to all staff".
//   A duplicate name shows TK_COPY.projectNameTaken under the name field and
//   keeps the modal open.
// ----------------------------------------------------------------------------

function TK_NewProjectModal(props) {
  var isAdmin = props.isAdmin === true;
  var onboarding = props.kind === "onboarding";
  var fields = typeof TK_newProjectFields === "function" ? TK_newProjectFields({ isAdmin: isAdmin }) : ["name", "sections"];
  var showSwitch = fields.indexOf("openToStaff") >= 0;
  var nPair = React.useState(onboarding && props.clientName ? props.clientName + " onboarding" : "");
  var name = nPair[0];
  var setName = nPair[1];
  var sPair = React.useState("");
  var sections = sPair[0];
  var setSections = sPair[1];
  var oPair = React.useState(false);
  var open = oPair[0];
  var setOpen = oPair[1];
  var ePair = React.useState(null);
  var err = ePair[0];
  var setErr = ePair[1];
  var bPair = React.useState(false);
  var busy = bPair[0];
  var setBusy = bPair[1];
  var titleId = "tk-newproject-title";
  var nameErrId = "tk-newproject-name-err";

  var save = function (e) {
    if (e) e.preventDefault();
    if (busy) return;
    var n = name.trim();
    if (!n) {
      setErr({ field: "name", text: "Add a name for the project." });
      return;
    }
    if (typeof TK_api === "undefined" || !TK_api || typeof TK_api.createProject !== "function") {
      setErr({ field: null, text: TK_vCopy("saveError") });
      return;
    }
    setBusy(true);
    setErr(null);
    var list = typeof TK_parseSectionsText === "function" ? TK_parseSectionsText(sections) : [];
    var want = showSwitch && open;
    TK_api.createProject({
      name: n,
      sections: list,
      kind: onboarding ? "onboarding" : "internal",
      client_id: onboarding ? props.clientId || null : null,
      open_to_staff: want,
    })
      .then(function (p) {
        // The server keeps open_to_staff only for admins; set it again if the
        // insert did not carry it through.
        if (want && p && p.id && !p.open_to_staff && typeof TK_api.updateProject === "function") {
          return TK_api.updateProject(p.id, { open_to_staff: true }).then(
            function (q) {
              return q || p;
            },
            function () {
              return p;
            },
          );
        }
        return p;
      })
      .then(
        function (p) {
          setBusy(false);
          if (props.onCreated) props.onCreated(p);
        },
        function (e2) {
          setBusy(false);
          var m = typeof TK_projectErrorText === "function" ? TK_projectErrorText(e2) : { field: null, text: TK_vCopy("saveError") };
          setErr(m);
        },
      );
  };

  return (
    <TK_vModal onClose={props.onClose} labelledBy={titleId} className="tk-modal tk-newproject">
      <form onSubmit={save} noValidate>
        <div className="modal-header">
          <h3 className="card-title" id={titleId} style={{ margin: 0 }}>
            {onboarding ? "New onboarding project" : "New project"}
          </h3>
          <button type="button" className="modal-close" onClick={props.onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body tk-form">
          {onboarding && props.clientName ? <p className="tk-muted tk-form-note">{"For " + props.clientName + ". Tasks in it belong to this client."}</p> : null}
          <label className="tk-field">
            <span className="tk-field-label">Name</span>
            <input
              className={"tk-input" + (err && err.field === "name" ? " is-invalid" : "")}
              type="text"
              maxLength={120}
              value={name}
              autoFocus
              aria-invalid={err && err.field === "name" ? "true" : "false"}
              aria-describedby={err && err.field === "name" ? nameErrId : undefined}
              onChange={function (e) {
                setName(e.target.value);
                if (err && err.field === "name") setErr(null);
              }}
            />
          </label>
          {err && err.field === "name" ? (
            <p className="tk-field-error" id={nameErrId} role="alert">
              {err.text}
            </p>
          ) : null}
          <label className="tk-field">
            <span className="tk-field-label">Sections (optional, one per line)</span>
            <textarea
              className="tk-input tk-textarea"
              rows={4}
              value={sections}
              placeholder={"To do\nIn review\nFiled"}
              onChange={function (e) {
                setSections(e.target.value);
              }}
            />
          </label>
          {showSwitch ? (
            <div className="tk-field tk-field-switch">
              <TK_vSwitch checked={open} onChange={setOpen} label={TK_vCopy("openToStaff", "Open to all staff")} />
              <p className="tk-field-help">{TK_vCopy("openToStaffHelp")}</p>
            </div>
          ) : null}
          {err && err.field !== "name" ? (
            <p className="tk-field-error" role="alert">
              {err.text}
            </p>
          ) : null}
        </div>
        <div className="modal-footer tk-modal-footer">
          <button type="button" className="btn-secondary" onClick={props.onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? "Saving…" : "Create project"}
          </button>
        </div>
      </form>
    </TK_vModal>
  );
}

function TK_vSameRoute(a, b) {
  if (!a || !b || a.view !== b.view) return false;
  if (a.view === "client") return String(a.clientId) === String(b.clientId);
  if (a.view === "project") return a.projectId === b.projectId;
  if (a.view === "person") return a.staffId === b.staffId;
  return true;
}

function TK_vNavItem(props) {
  var r = props.route;
  var href = typeof TK_formatRoute === "function" ? TK_formatRoute(r) : "#/tasks/my";
  return (
    <li>
      <a
        className={"tk-nav-item" + (props.active ? " is-active" : "")}
        href={href}
        aria-current={props.active ? "page" : undefined}
        onClick={function (e) {
          if (!TK_vPlainClick(e)) return;
          e.preventDefault();
          props.onNavigate(r);
        }}
      >
        {props.icon ? <TK_vIcon name={props.icon} size={16} /> : null}
        <span className="tk-nav-label">{props.label}</span>
        {props.tag ? <span className="tk-nav-tag">{props.tag}</span> : null}
      </a>
    </li>
  );
}

function TK_Sidebar(props) {
  var route = props.route || { view: "my" };
  var isAdmin = !!props.isAdmin;
  var nav =
    props.onNavigate ||
    function (r) {
      TK_navigate(r);
    };
  var projects = TK_vUseProjects();
  var staff = TK_vUseStaff(isAdmin);
  var fPair = React.useState("");
  var filter = fPair[0];
  var setFilter = fPair[1];
  var mPair = React.useState(false);
  var newOpen = mPair[0];
  var setNewOpen = mPair[1];

  var visibleProjects = (Array.isArray(projects) ? projects : [])
    .filter(function (p) {
      return p && !p.archived_at;
    })
    .slice()
    .sort(function (a, b) {
      var ka = (a.kind === "onboarding" ? "1" : "0") + String(a.name || "").toLowerCase();
      var kb = (b.kind === "onboarding" ? "1" : "0") + String(b.name || "").toLowerCase();
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
  var clients = (Array.isArray(props.clients) ? props.clients : []).filter(function (c) {
    return c && c.id != null;
  });
  var f = filter.trim().toLowerCase();
  // Test clients and MGB (internal) sort last with a tag; test clients hide unless "Show test clients" is on.
  var openRoute = props.route && props.route.view === "client" ? String(props.route.clientId) : null;
  var pickedClients = typeof CF_usePicked === "function" ? CF_usePicked(clients, null, openRoute) : clients;
  var shownClients = pickedClients
    .filter(function (c) {
      return !f || String(c.name || c.id).toLowerCase().indexOf(f) >= 0;
    })
    .slice()
    .sort(function (a, b) {
      var x = String(a.name || a.id).toLowerCase();
      var y = String(b.name || b.id).toLowerCase();
      return x < y ? -1 : x > y ? 1 : 0;
    });
  if (typeof CF_sort === "function") shownClients = CF_sort(shownClients);
  var people = (Array.isArray(staff) ? staff : []).filter(function (s) {
    return s && s.active !== false && s.id && (typeof TK_isUuid !== "function" || TK_isUuid(s.id));
  });

  return (
    <nav className="tk-sidebar" aria-label="Task lists" data-tour="tk-sidebar">
      <ul className="tk-nav">
        <TK_vNavItem route={{ view: "my" }} label="My Tasks" icon="home" active={route.view === "my"} onNavigate={nav} />
        <TK_vNavItem route={{ view: "search" }} label="Search" icon="search" active={route.view === "search"} onNavigate={nav} />
      </ul>

      <div className="tk-nav-section">
        <div className="tk-nav-head">
          <h3 className="tk-nav-title">Projects</h3>
          <button
            type="button"
            className="tk-icon-btn"
            aria-label="New project"
            title="New project"
            onClick={function () {
              setNewOpen(true);
            }}
          >
            <TK_vIcon name="plus" size={16} />
          </button>
        </div>
        <ul className="tk-nav">
          {projects == null ? <li className="tk-nav-empty">Loading…</li> : null}
          {projects != null && !visibleProjects.length ? <li className="tk-nav-empty">No projects yet.</li> : null}
          {visibleProjects.map(function (p) {
            var r = { view: "project", projectId: p.id };
            return (
              <TK_vNavItem
                key={p.id}
                route={r}
                label={p.name || "Project"}
                tag={p.kind === "onboarding" ? "Onboarding" : null}
                active={TK_vSameRoute(route, r)}
                onNavigate={nav}
              />
            );
          })}
        </ul>
        <button
          type="button"
          className="tk-nav-add"
          onClick={function () {
            setNewOpen(true);
          }}
        >
          <TK_vIcon name="plus" size={14} />
          <span>New project</span>
        </button>
      </div>

      <div className="tk-nav-section">
        <div className="tk-nav-head">
          <h3 className="tk-nav-title">Clients</h3>
        </div>
        {clients.length > 8 ? (
          <input
            className="tk-input tk-nav-filter"
            type="search"
            placeholder="Find a client"
            aria-label="Find a client"
            value={filter}
            onChange={function (e) {
              setFilter(e.target.value);
            }}
          />
        ) : null}
        <ul className="tk-nav tk-nav-clients">
          {!clients.length ? <li className="tk-nav-empty">No clients to show.</li> : null}
          {clients.length && !shownClients.length ? <li className="tk-nav-empty">No client matches that.</li> : null}
          {shownClients.map(function (c) {
            var r = { view: "client", clientId: String(c.id) };
            return <TK_vNavItem key={c.id} route={r} label={c.name || String(c.id)} tag={typeof CF_badgeText === "function" ? CF_badgeText(c) || null : null} active={TK_vSameRoute(route, r)} onNavigate={nav} />;
          })}
        </ul>
      </div>

      {isAdmin ? (
        <div className="tk-nav-section">
          <div className="tk-nav-head">
            <h3 className="tk-nav-title">People</h3>
          </div>
          <ul className="tk-nav">
            {staff == null ? <li className="tk-nav-empty">Loading…</li> : null}
            {people.map(function (s) {
              var r = { view: "person", staffId: s.id };
              return <TK_vNavItem key={s.id} route={r} label={s.name || "Staff member"} active={TK_vSameRoute(route, r)} onNavigate={nav} />;
            })}
          </ul>
        </div>
      ) : null}

      {newOpen ? (
        <TK_NewProjectModal
          isAdmin={isAdmin}
          kind="internal"
          onClose={function () {
            setNewOpen(false);
          }}
          onCreated={function (p) {
            setNewOpen(false);
            if (p && p.id) nav({ view: "project", projectId: p.id });
          }}
        />
      ) : null}
    </nav>
  );
}
