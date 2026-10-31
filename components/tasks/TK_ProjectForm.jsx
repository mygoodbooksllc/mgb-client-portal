// ----------------------------------------------------------------------------
// TK_ProjectForm.jsx — the Slate plus New project form (hidden preview,
// docs/slateplus-projectform-spec.md). TK_NewProjectModal (TK_Sidebar.jsx)
// renders this only while TKP_useOn() is true; with the gate off the old form
// shows, unchanged.
//
// TKPF_NewProjectModal({ isAdmin, kind, clientId, clientName, clients,
//                        staffUser, onClose, onCreated(project) })
//   Name, Description (optional, 500 characters), Client (optional; not shown
//   when the form was opened for a client), Due date, Color, Start from (a
//   starter list or another project's sections) + Sections, People (each an
//   Owner or a Member; you are the owner already), and Who can see it (admins
//   keep the Open to all staff switch) with a live one-line summary.
//   People are added after the project exists, one at a time; if any cannot be
//   added the project is kept and the form says who, with an Open project
//   button. Rules: TK_projectFormLogic.js (node test). The server decides who
//   may do what (tk_projects / tk_project_members RLS and triggers).
// ----------------------------------------------------------------------------

function TKPF_NewProjectModal(props) {
  var isAdmin = props.isAdmin === true;
  var onboarding = props.kind === "onboarding";
  var fields = typeof TK_newProjectFields === "function" ? TK_newProjectFields({ isAdmin: isAdmin }) : ["name", "sections"];
  var showSwitch = fields.indexOf("openToStaff") >= 0;
  var me = String((props.staffUser && props.staffUser.email) || "").trim().toLowerCase();
  var staff = TK_vUseStaff(true);
  var projects = TK_vUseProjects();
  var palette = typeof TK_projectColorKeys === "function" ? TK_projectColorKeys() : [];

  var nPair = React.useState(onboarding && props.clientName ? props.clientName + " onboarding" : "");
  var name = nPair[0];
  var setName = nPair[1];
  var dPair = React.useState("");
  var desc = dPair[0];
  var setDesc = dPair[1];
  var cPair = React.useState("");
  var pickedClient = cPair[0];
  var setPickedClient = cPair[1];
  var duePair = React.useState("");
  var due = duePair[0];
  var setDue = duePair[1];
  var colPair = React.useState(null);
  var color = colPair[0];
  var setColor = colPair[1];
  var fromPair = React.useState("");
  var startFrom = fromPair[0];
  var setStartFrom = fromPair[1];
  var sPair = React.useState("");
  var sections = sPair[0];
  var setSections = sPair[1];
  var pPair = React.useState([]);
  var picks = pPair[0];
  var setPicks = pPair[1];
  var wPair = React.useState("");
  var who = wPair[0];
  var setWho = wPair[1];
  var wrPair = React.useState("member");
  var whoRole = wrPair[0];
  var setWhoRole = wrPair[1];
  var oPair = React.useState(false);
  var open = oPair[0];
  var setOpen = oPair[1];
  var ePair = React.useState(null);
  var err = ePair[0];
  var setErr = ePair[1];
  var bPair = React.useState("");
  var busy = bPair[0];
  var setBusy = bPair[1];
  var donePair = React.useState(null);
  var done = donePair[0];
  var setDone = donePair[1];

  var titleId = "tk-newproject-title";
  var nameErrId = "tk-newproject-name-err";
  var descId = "tkpf-desc-count";

  var clientChoices = onboarding ? [] : TKPF_clientChoices(props.clients);
  var clientId = onboarding ? props.clientId || null : pickedClient || null;
  var clientName = onboarding
    ? props.clientName || ""
    : (function () {
        for (var i = 0; i < clientChoices.length; i++) if (clientChoices[i].id === pickedClient) return clientChoices[i].name;
        return "";
      })();
  var cleanPicks = TKPF_normalizePicks(picks, me);
  var choices = TKPF_staffChoices(staff, picks, me);
  var tmpl = TKPF_templateOptions(projects);
  var vis = TKPF_visibility({ openToStaff: showSwitch && open, people: cleanPicks.length, clientName: clientId ? clientName || "this client" : "", canOpen: showSwitch });

  var staffName = function (email) {
    var e = String(email || "").toLowerCase();
    var list = Array.isArray(staff) ? staff : [];
    for (var i = 0; i < list.length; i++) if (list[i] && String(list[i].email || "").toLowerCase() === e) return list[i].name || e.split("@")[0];
    return e.split("@")[0];
  };

  var close = function () {
    if (done && done.project) {
      if (props.onCreated) props.onCreated(done.project);
      return;
    }
    if (props.onClose) props.onClose();
  };

  var addPick = function () {
    if (!who) return;
    setPicks(picks.concat([{ email: who, role: whoRole === "owner" ? "owner" : "member" }]));
    setWho("");
    setWhoRole("member");
  };

  var save = function (e) {
    if (e) e.preventDefault();
    if (busy || done) return;
    var n = name.trim();
    if (!n) {
      setErr({ field: "name", text: "Add a name for the project." });
      return;
    }
    if (typeof TK_api === "undefined" || !TK_api || typeof TK_api.createProject !== "function") {
      setErr({ field: null, text: TK_vCopy("saveError") });
      return;
    }
    setBusy("create");
    setErr(null);
    var list = typeof TK_parseSectionsText === "function" ? TK_parseSectionsText(sections) : [];
    var want = showSwitch && open;
    var people = cleanPicks.slice();
    var input = TKPF_buildCreate({
      name: n,
      sectionsList: list,
      kind: onboarding ? "onboarding" : "internal",
      clientId: clientId,
      openToStaff: want,
      color: color,
      description: desc,
      dueOn: due,
      palette: palette,
    });
    TK_api.createProject(input)
      .then(function (p) {
        // The server keeps open_to_staff only for admins; set it again if the
        // insert did not carry it through (as the old form does).
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
          if (!p || !p.id || !people.length || typeof TK_api.addMember !== "function") {
            setBusy("");
            if (props.onCreated) props.onCreated(p);
            return;
          }
          // The project exists from here on: a refused person never undoes it.
          setBusy("people");
          TKPF_addMembers(TK_api.addMember, p.id, people).then(function (results) {
            var failed = TKPF_failures(results, staff);
            setBusy("");
            if (!failed.length) {
              if (props.onCreated) props.onCreated(p);
              return;
            }
            setDone({ project: p, failed: failed });
          });
        },
        function (e2) {
          setBusy("");
          var m = typeof TK_projectErrorText === "function" ? TK_projectErrorText(e2) : { field: null, text: TK_vCopy("saveError") };
          setErr(m);
        },
      );
  };

  if (done) {
    return (
      <TK_vModal onClose={close} labelledBy={titleId} className="tk-modal tk-newproject tkpf">
        <div className="modal-header">
          <h3 className="card-title" id={titleId} style={{ margin: 0 }}>
            Project created
          </h3>
          <button type="button" className="modal-close" onClick={close} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body tk-form">
          <p className="tkpf-warn" role="alert">
            {TKPF_failureText(done.failed)}
          </p>
        </div>
        <div className="modal-footer tk-modal-footer">
          <button type="button" className="btn-primary" onClick={close}>
            Open project
          </button>
        </div>
      </TK_vModal>
    );
  }

  return (
    <TK_vModal onClose={props.onClose} labelledBy={titleId} className="tk-modal tk-newproject tkpf">
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
            <span className="tk-field-label">Description (optional)</span>
            <textarea
              className="tk-input tk-textarea"
              rows={2}
              maxLength={TKPF_DESC_MAX}
              value={desc}
              aria-describedby={descId}
              placeholder="What this project is for"
              onChange={function (e) {
                setDesc(e.target.value);
              }}
            />
            <span className="tk-field-help tkpf-count" id={descId}>
              {TKPF_descLeft(desc) + " characters left"}
            </span>
          </label>

          {!onboarding && clientChoices.length ? (
            <label className="tk-field">
              <span className="tk-field-label">Client (optional)</span>
              <select
                className="tk-select"
                value={pickedClient}
                onChange={function (e) {
                  setPickedClient(e.target.value);
                }}
              >
                <option value="">No client (internal project)</option>
                {clientChoices.map(function (c) {
                  return (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  );
                })}
              </select>
              {pickedClient ? <span className="tk-field-help">Tasks in it belong to this client, and staff who work on this client can see it.</span> : null}
            </label>
          ) : null}

          <label className="tk-field tkpf-due-field">
            <span className="tk-field-label">Due date (optional)</span>
            <input
              className="tk-input"
              type="date"
              value={due}
              onChange={function (e) {
                setDue(e.target.value);
              }}
            />
          </label>

          <div className="tk-field">
            <span className="tk-field-label">Color</span>
            <TK_vColorPicker label="Project color" value={color} onPick={setColor} />
            <span className="tk-field-help">
              {color ? (
                <button
                  type="button"
                  className="tk-link-btn"
                  onClick={function () {
                    setColor(null);
                  }}
                >
                  Pick one for me instead
                </button>
              ) : (
                "Skip it and a color is picked for you."
              )}
            </span>
          </div>

          <label className="tk-field">
            <span className="tk-field-label">Start from</span>
            <select
              className="tk-select"
              value={startFrom}
              onChange={function (e) {
                var v = e.target.value;
                setStartFrom(v);
                var text = TKPF_templateText(v, projects);
                if (text != null) setSections(text);
              }}
            >
              <option value="">Blank (type your own sections)</option>
              <optgroup label="Starter lists">
                {tmpl.starters.map(function (o) {
                  return (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  );
                })}
              </optgroup>
              {tmpl.copies.length ? (
                <optgroup label="Copy sections from another project">
                  {tmpl.copies.map(function (o) {
                    return (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    );
                  })}
                </optgroup>
              ) : null}
            </select>
            <span className="tk-field-help">Fills in the sections below. You can still change them.</span>
          </label>
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

          <fieldset className="tk-field tkpf-people">
            <legend className="tk-field-label">People</legend>
            <ul className="tk-member-list">
              <li className="tk-member">
                <TK_vAvatar name={(props.staffUser && props.staffUser.name) || "You"} email={me} size="sm" decorative />
                <span className="tk-member-name">You</span>
                <span className="tk-muted tk-member-role">Owner</span>
              </li>
              {cleanPicks.map(function (p) {
                var nm = staffName(p.email);
                return (
                  <li key={p.email} className="tk-member">
                    <TK_vAvatar name={nm} email={p.email} size="sm" decorative />
                    <span className="tk-member-name">{nm}</span>
                    <select
                      className="tk-select tkpf-role"
                      aria-label={"Role for " + nm}
                      value={p.role}
                      onChange={function (e) {
                        var r = e.target.value === "owner" ? "owner" : "member";
                        setPicks(
                          picks.map(function (x) {
                            return String(x.email).toLowerCase() === p.email ? { email: x.email, role: r } : x;
                          }),
                        );
                      }}
                    >
                      <option value="member">Member</option>
                      <option value="owner">Owner</option>
                    </select>
                    <button
                      type="button"
                      className="tk-link-btn tk-member-remove"
                      aria-label={"Remove " + nm}
                      onClick={function () {
                        setPicks(
                          picks.filter(function (x) {
                            return String(x.email).toLowerCase() !== p.email;
                          }),
                        );
                      }}
                    >
                      Remove
                    </button>
                  </li>
                );
              })}
            </ul>
            {cleanPicks.length < TKPF_MEMBER_MAX ? (
              <div className="tkpf-add">
                <select
                  className="tk-select"
                  aria-label="Add a person"
                  value={who}
                  onChange={function (e) {
                    setWho(e.target.value);
                  }}
                >
                  <option value="">{staff == null ? "Loading staff…" : "Add a person"}</option>
                  {choices.map(function (s) {
                    return (
                      <option key={s.email} value={String(s.email).toLowerCase()}>
                        {s.name || String(s.email).split("@")[0]}
                      </option>
                    );
                  })}
                </select>
                <select
                  className="tk-select tkpf-role"
                  aria-label="Role for the new person"
                  value={whoRole}
                  onChange={function (e) {
                    setWhoRole(e.target.value);
                  }}
                >
                  <option value="member">Member</option>
                  <option value="owner">Owner</option>
                </select>
                <button type="button" className="btn-secondary" disabled={!who} onClick={addPick}>
                  Add
                </button>
              </div>
            ) : null}
            <span className="tk-field-help">Owners can manage the project (rename, people, archive). Members can see it and work on its tasks.</span>
          </fieldset>

          <div className="tk-field tkpf-vis-block">
            <span className="tk-field-label">Who can see it</span>
            {showSwitch ? <TK_vSwitch checked={open} onChange={setOpen} label={TK_vCopy("openToStaff", "Open to all staff")} /> : null}
            <p className="tk-field-help">{TKPF_visibilityHelp(showSwitch)}</p>
            <p className="tkpf-vis" aria-live="polite">
              <TK_vIcon name={showSwitch && open ? "people" : "user"} size={14} />
              <span>{vis.summary}</span>
            </p>
            {vis.warn ? <p className="tkpf-warn">{vis.warn}</p> : null}
          </div>

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
          <button type="submit" className="btn-primary" disabled={!!busy}>
            {busy === "people" ? "Adding people…" : busy ? "Saving…" : "Create project"}
          </button>
        </div>
      </form>
    </TK_vModal>
  );
}
