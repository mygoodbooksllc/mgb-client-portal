// ----------------------------------------------------------------------------
// TK_List.jsx — a client, project or person list (Row 3.2, Row 1.4 header)
// and the search view (Row 3.6 keys run here too).
//
// TK_List({ route, staffUser, clients, isAdmin })
//   Header: TK_ClientHeader, the project header, or the person header.
//   Columns: Task | Assignee | Due | Status | Priority. A column header sorts
//   (TK_sortTasks, remembered per list in mgb_tk_sort_v1) and shows a flat
//   list; with no column sort the rows are grouped by section, each group
//   collapsible with its own one-line "Add task" row. Filters: assignee,
//   status (multi), Show done, Show older; on phones they sit in a "Filters"
//   sheet. Filters and sorting never reach the URL.
// TK_SearchView({ staffUser, clients, isAdmin })
//   One search box. The query lives in this component only, never the URL.
// ----------------------------------------------------------------------------

var TK_vSORT_KEY = "mgb_tk_sort_v1";

var TK_vCOLUMNS = [
  { col: "task", label: "Task" },
  { col: "assignee", label: "Assignee" },
  { col: "due", label: "Due" },
  { col: "status", label: "Status" },
  { col: "priority", label: "Priority" },
];

function TK_vFind(list, field, value) {
  var arr = Array.isArray(list) ? list : [];
  for (var i = 0; i < arr.length; i++) {
    if (arr[i] && String(arr[i][field]) === String(value)) return arr[i];
  }
  return null;
}

function TK_vStaffName(staff, email) {
  var e = TK_vLower(email);
  if (!e) return "";
  var s = TK_vFind(staff, "email", e);
  if (s && s.name) return s.name;
  return e.split("@")[0];
}

function TK_vRoleLabel(role) {
  var r = String(role || "").toLowerCase();
  if (r === "admin" || r === "owner") return "Admin";
  if (r === "account_manager") return "Account Manager";
  if (r === "bookkeeper") return "Bookkeeper";
  if (r === "reviewer") return "Reviewer";
  if (!r) return "Staff";
  return r.charAt(0).toUpperCase() + r.slice(1).replace(/_/g, " ");
}

// A confirm step: the app's ConfirmModal when it is loaded, else a small one.
function TK_vConfirm(props) {
  if (typeof ConfirmModal === "function") {
    return <ConfirmModal title={props.title} body={props.body} confirmLabel={props.confirmLabel} onConfirm={props.onConfirm} onCancel={props.onCancel} />;
  }
  return (
    <TK_vModal onClose={props.onCancel} labelledBy="tk-confirm-title" className="tk-modal">
      <div className="modal-header">
        <h3 className="card-title" id="tk-confirm-title" style={{ margin: 0 }}>
          {props.title}
        </h3>
      </div>
      <div className="modal-body">
        <p>{props.body}</p>
      </div>
      <div className="modal-footer tk-modal-footer">
        <button type="button" className="btn-secondary" onClick={props.onCancel}>
          Cancel
        </button>
        <button type="button" className="btn-primary" onClick={props.onConfirm}>
          {props.confirmLabel || "Confirm"}
        </button>
      </div>
    </TK_vModal>
  );
}

// ---- The inline "Add task" row (one per section) --------------------------------

function TK_vAddRow(props) {
  var tPair = React.useState("");
  var text = tPair[0];
  var setText = tPair[1];
  var bPair = React.useState(false);
  var busy = bPair[0];
  var setBusy = bPair[1];
  var ePair = React.useState("");
  var msg = ePair[0];
  var setMsg = ePair[1];
  var label = props.sectionName ? "Add a task to " + props.sectionName : "Add a task";

  var save = function () {
    var raw = text.trim();
    if (!raw || busy) return;
    var ctx = props.ctx || {};
    var today = TK_vToday();
    var parsed =
      typeof TK_parseQuickAdd === "function"
        ? TK_parseQuickAdd(raw, { today: today, staff: ctx.staff || [], clients: ctx.clients || [], defaultClientId: ctx.clientId != null ? ctx.clientId : null })
        : { text: raw, errors: [], client_id: ctx.clientId != null ? ctx.clientId : null };
    if (parsed.errors && parsed.errors.length) {
      setMsg(parsed.errors[0]);
      return;
    }
    var detail = { section: props.section || null };
    if (ctx.projectId) detail.project_id = ctx.projectId;
    if (parsed.client_id != null) detail.client_id = parsed.client_id;
    else if (ctx.clientId != null) detail.client_id = ctx.clientId;
    else detail.client_id = null;
    var base =
      typeof TK_quickAddDefaults === "function"
        ? TK_quickAddDefaults(detail, { me: ctx.email, currentClientId: ctx.clientId })
        : {
            client_id: detail.client_id,
            project_id: detail.project_id || null,
            section: detail.section,
            kind: "task",
            visibility: detail.client_id || detail.project_id ? "shared" : "private",
            assignee_email: ctx.email || null,
          };
    var fields = {
      text: parsed.text,
      kind: "task",
      client_id: base.client_id,
      project_id: base.project_id,
      section: base.section,
      visibility: base.visibility,
      due_date: parsed.due_date || null,
      assignee_email: parsed.assignee_email || ctx.assigneeEmail || base.assignee_email || null,
    };
    if (parsed.priority) fields.priority = parsed.priority;
    if (typeof TK_api === "undefined" || !TK_api || typeof TK_api.create !== "function") {
      setMsg(TK_vCopy("saveError"));
      return;
    }
    setBusy(true);
    setMsg("");
    TK_api.create(fields).then(
      function () {
        setBusy(false);
        setText("");
        setMsg(TK_vCopy("taskAdded", "Task added."));
        TK_vTrack("tasks-quick-add");
      },
      function (e) {
        setBusy(false);
        setMsg(TK_vErrText(e, "saveError"));
      },
    );
  };

  if (props.disabled) return null;
  return (
    <li className="tk-add-row">
      <span className="tk-add-icon" aria-hidden="true">
        <TK_vIcon name="plus" size={14} />
      </span>
      <input
        className="tk-add-input"
        type="text"
        value={text}
        maxLength={500}
        disabled={busy}
        placeholder="Add task"
        aria-label={label}
        onChange={function (e) {
          setText(e.target.value);
          if (msg) setMsg("");
        }}
        onKeyDown={function (e) {
          if (e.key === "Enter" && !e.isComposing) {
            e.preventDefault();
            save();
          } else if (e.key === "Escape" && text) {
            e.preventDefault();
            e.stopPropagation();
            setText("");
          }
        }}
      />
      <span className="tk-add-msg" role="status" aria-live="polite">
        {msg}
      </span>
    </li>
  );
}

// ---- Filters ------------------------------------------------------------------------

function TK_vFilters(props) {
  var f = props.value;
  var set = props.onChange;
  var statuses = typeof TK_STATUSES !== "undefined" && Array.isArray(TK_STATUSES) ? TK_STATUSES : ["todo", "in_progress", "waiting_client", "ready_for_review", "done"];
  var people = props.people || [];
  var toggleStatus = function (s) {
    var cur = f.statuses.slice();
    var i = cur.indexOf(s);
    if (i >= 0) cur.splice(i, 1);
    else cur.push(s);
    set({ statuses: cur });
  };
  return (
    <div className={"tk-filters" + (props.stacked ? " is-stacked" : "")}>
      {props.hideAssignee ? null : (
        <label className="tk-select-wrap">
          <span className={props.stacked ? "tk-field-label" : "tk-sr"}>Assignee</span>
          <select
            className="tk-select"
            value={f.assignee}
            onChange={function (e) {
              set({ assignee: e.target.value });
            }}
          >
            <option value="">Anyone</option>
            <option value={typeof TK_UNASSIGNED !== "undefined" ? TK_UNASSIGNED : "__unassigned__"}>Unassigned</option>
            {people.map(function (p) {
              return (
                <option key={p.email} value={p.email}>
                  {p.name}
                </option>
              );
            })}
          </select>
        </label>
      )}
      <fieldset className="tk-status-filter">
        <legend className={props.stacked ? "tk-field-label" : "tk-sr"}>Status</legend>
        {statuses
          .filter(function (s) {
            return s !== "done" || f.showDone;
          })
          .map(function (s) {
            var on = f.statuses.indexOf(s) >= 0;
            return (
              <button
                key={s}
                type="button"
                className={"tk-filter-chip tk-st-" + s + (on ? " is-on" : "")}
                aria-pressed={on ? "true" : "false"}
                onClick={function () {
                  toggleStatus(s);
                }}
              >
                {TK_vStatusLabel(s)}
              </button>
            );
          })}
      </fieldset>
      <TK_vSwitch
        checked={f.showDone}
        label="Show done"
        onChange={function (v) {
          var patch = { showDone: v };
          if (!v) {
            patch.showOlder = false;
            patch.statuses = f.statuses.filter(function (s) {
              return s !== "done";
            });
          }
          set(patch);
        }}
      />
      {f.showDone ? (
        <TK_vSwitch
          checked={f.showOlder}
          label="Show older"
          onChange={function (v) {
            set({ showOlder: v });
          }}
        />
      ) : null}
    </div>
  );
}

// ---- Project header (Row 1.4) ------------------------------------------------------------

function TK_vSectionsModal(props) {
  var sPair = React.useState(function () {
    var list = Array.isArray(props.sections) ? props.sections.slice() : [];
    return list.length ? list : [""];
  });
  var rows = sPair[0];
  var setRows = sPair[1];
  var bPair = React.useState(false);
  var busy = bPair[0];
  var setBusy = bPair[1];
  var ePair = React.useState("");
  var err = ePair[0];
  var setErr = ePair[1];
  var setAt = function (i, v) {
    var n = rows.slice();
    n[i] = v;
    setRows(n);
  };
  var move = function (i, d) {
    var j = i + d;
    if (j < 0 || j >= rows.length) return;
    var n = rows.slice();
    var t = n[i];
    n[i] = n[j];
    n[j] = t;
    setRows(n);
  };
  var remove = function (i) {
    var n = rows.slice();
    n.splice(i, 1);
    setRows(n.length ? n : [""]);
  };
  var save = function (e) {
    if (e) e.preventDefault();
    if (busy) return;
    var clean = typeof TK_parseSectionsText === "function" ? TK_parseSectionsText(rows.join("\n")) : rows.filter(Boolean);
    setBusy(true);
    setErr("");
    TK_api.updateProject(props.projectId, { sections: clean }).then(
      function () {
        setBusy(false);
        props.onClose();
      },
      function (e2) {
        setBusy(false);
        setErr(TK_vErrText(e2, "saveError"));
      },
    );
  };
  return (
    <TK_vModal onClose={props.onClose} labelledBy="tk-sections-title" className="tk-modal tk-sections-modal tk-sheet">
      <form onSubmit={save} noValidate>
        <div className="modal-header">
          <h3 className="card-title" id="tk-sections-title" style={{ margin: 0 }}>
            Sections
          </h3>
          <button type="button" className="modal-close" onClick={props.onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body tk-form">
          <p className="tk-muted tk-form-note">Tasks keep their section name. A task in a section you remove shows under its old name until you move it.</p>
          <ol className="tk-section-list">
            {rows.map(function (r, i) {
              return (
                <li key={i} className="tk-section-item">
                  <input
                    className="tk-input"
                    type="text"
                    maxLength={80}
                    value={r}
                    aria-label={"Section " + (i + 1)}
                    onChange={function (e) {
                      setAt(i, e.target.value);
                    }}
                  />
                  <button
                    type="button"
                    className="tk-icon-btn"
                    aria-label={"Move section " + (i + 1) + " up"}
                    disabled={i === 0}
                    onClick={function () {
                      move(i, -1);
                    }}
                  >
                    <TK_vIcon name="down" size={14} className="tk-flip" />
                  </button>
                  <button
                    type="button"
                    className="tk-icon-btn"
                    aria-label={"Move section " + (i + 1) + " down"}
                    disabled={i === rows.length - 1}
                    onClick={function () {
                      move(i, 1);
                    }}
                  >
                    <TK_vIcon name="down" size={14} />
                  </button>
                  <button
                    type="button"
                    className="tk-icon-btn"
                    aria-label={"Remove section " + (i + 1)}
                    onClick={function () {
                      remove(i);
                    }}
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ol>
          <button
            type="button"
            className="tk-nav-add"
            onClick={function () {
              setRows(rows.concat([""]));
            }}
          >
            <TK_vIcon name="plus" size={14} />
            <span>Add section</span>
          </button>
          {err ? (
            <p className="tk-field-error" role="alert">
              {err}
            </p>
          ) : null}
        </div>
        <div className="modal-footer tk-modal-footer">
          <button type="button" className="btn-secondary" onClick={props.onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? "Saving…" : "Save sections"}
          </button>
        </div>
      </form>
    </TK_vModal>
  );
}

function TK_vMembersModal(props) {
  var members = props.members || [];
  var staff = Array.isArray(props.staff) ? props.staff : [];
  var have = {};
  members.forEach(function (m) {
    if (m) have[TK_vLower(m.staff_email)] = 1;
  });
  var choices = staff.filter(function (s) {
    return s && s.active !== false && s.email && !have[TK_vLower(s.email)];
  });
  var wPair = React.useState("");
  var who = wPair[0];
  var setWho = wPair[1];
  var rPair = React.useState("member");
  var role = rPair[0];
  var setRole = rPair[1];
  var bPair = React.useState(false);
  var busy = bPair[0];
  var setBusy = bPair[1];
  var ePair = React.useState("");
  var err = ePair[0];
  var setErr = ePair[1];
  var cPair = React.useState(null);
  var removing = cPair[0];
  var setRemoving = cPair[1];

  var add = function (e) {
    if (e) e.preventDefault();
    if (!who || busy) return;
    setBusy(true);
    setErr("");
    TK_api.addMember(props.projectId, who, role).then(
      function () {
        setBusy(false);
        setWho("");
        setRole("member");
        if (props.onChanged) props.onChanged();
      },
      function (e2) {
        setBusy(false);
        setErr(TK_vErrText(e2, "saveError"));
      },
    );
  };
  var doRemove = function (email) {
    setRemoving(null);
    TK_api.removeMember(props.projectId, email).then(
      function () {
        if (props.onChanged) props.onChanged();
      },
      function (e2) {
        setErr(TK_vErrText(e2, "saveError"));
      },
    );
  };

  return (
    <TK_vModal onClose={props.onClose} labelledBy="tk-members-title" className="tk-modal tk-members-modal tk-sheet">
      <div className="modal-header">
        <h3 className="card-title" id="tk-members-title" style={{ margin: 0 }}>
          Members
        </h3>
        <button type="button" className="modal-close" onClick={props.onClose} aria-label="Close">
          ×
        </button>
      </div>
      <div className="modal-body tk-form">
        {members.length ? (
          <ul className="tk-member-list">
            {members.map(function (m) {
              var name = TK_vStaffName(staff, m.staff_email);
              return (
                <li key={m.staff_email} className="tk-member">
                  <TK_vAvatar name={name} size="sm" decorative />
                  <span className="tk-member-name">{name}</span>
                  <span className="tk-muted tk-member-role">{m.role === "owner" ? "Owner" : "Member"}</span>
                  {props.canManage ? (
                    <button
                      type="button"
                      className="tk-link-btn tk-member-remove"
                      onClick={function () {
                        setRemoving(m.staff_email);
                      }}
                    >
                      Remove
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="tk-muted">No members yet.</p>
        )}
        {props.canManage ? (
          <form className="tk-member-add" onSubmit={add}>
            <label className="tk-field">
              <span className="tk-field-label">Add member</span>
              <select
                className="tk-select"
                value={who}
                onChange={function (e) {
                  setWho(e.target.value);
                }}
              >
                <option value="">Choose a staff member</option>
                {choices.map(function (s) {
                  return (
                    <option key={s.email} value={s.email}>
                      {s.name || s.email.split("@")[0]}
                    </option>
                  );
                })}
              </select>
            </label>
            <label className="tk-field">
              <span className="tk-field-label">Role</span>
              <select
                className="tk-select"
                value={role}
                onChange={function (e) {
                  setRole(e.target.value);
                }}
              >
                <option value="member">Member</option>
                <option value="owner">Owner (can manage the project)</option>
              </select>
            </label>
            <button type="submit" className="btn-primary" disabled={!who || busy}>
              {busy ? "Adding…" : "Add member"}
            </button>
          </form>
        ) : null}
        {err ? (
          <p className="tk-field-error" role="alert">
            {err}
          </p>
        ) : null}
      </div>
      {removing ? (
        <TK_vConfirm
          title="Remove this member?"
          body="They lose access to this project's tasks unless they can see them another way."
          confirmLabel="Remove"
          onCancel={function () {
            setRemoving(null);
          }}
          onConfirm={function () {
            doRemove(removing);
          }}
        />
      ) : null}
    </TK_vModal>
  );
}

function TK_vProjectHeader(props) {
  var project = props.project;
  var isAdmin = !!props.isAdmin;
  var email = props.email;
  var staff = props.staff;
  var mPair = React.useState([]);
  var members = mPair[0];
  var setMembers = mPair[1];
  var seqRef = React.useRef(0);
  var loadMembers = React.useCallback(
    function () {
      if (!project || !project.id || typeof TK_api === "undefined" || !TK_api || typeof TK_api.listMembers !== "function") return;
      var n = ++seqRef.current;
      TK_api.listMembers(project.id).then(
        function (rows) {
          if (n === seqRef.current) setMembers(Array.isArray(rows) ? rows : []);
        },
        function () {
          if (n === seqRef.current) setMembers([]);
        },
      );
    },
    [project && project.id],
  );
  React.useEffect(loadMembers, [loadMembers]);

  var ePair = React.useState(false);
  var editing = ePair[0];
  var setEditing = ePair[1];
  var nPair = React.useState("");
  var draft = nPair[0];
  var setDraft = nPair[1];
  var errPair = React.useState("");
  var err = errPair[0];
  var setErr = errPair[1];
  var oPair = React.useState(null);
  var modal = oPair[0];
  var setModal = oPair[1];
  var cPair = React.useState(null);
  var counts = cPair[0];
  var setCounts = cPair[1];

  if (!project) return null;
  var archived = !!project.archived_at;
  var canManage = !archived && TK_canManageProjectHint(project, { email: email, isAdmin: isAdmin, members: members });

  var saveName = function (e) {
    if (e) e.preventDefault();
    var n = draft.trim();
    if (!n || n === project.name) {
      setEditing(false);
      setErr("");
      return;
    }
    TK_api.updateProject(project.id, { name: n }).then(
      function () {
        setEditing(false);
        setErr("");
      },
      function (e2) {
        var m = TK_projectErrorText(e2);
        setErr(m.text);
      },
    );
  };
  var setOpenToStaff = function (v) {
    TK_api.updateProject(project.id, { open_to_staff: v }).catch(function (e2) {
      TK_vToast(TK_vErrText(e2, "saveError"));
    });
  };
  var archive = function () {
    setModal(null);
    TK_api.archiveProject(project.id).then(
      function () {
        TK_vToast("Project archived.");
      },
      function (e2) {
        TK_vToast(TK_vErrText(e2, "saveError"));
      },
    );
  };

  // Open the trash confirm, then fetch the task counts for it (the project row
  // carries none). Until they arrive the confirm says "all its tasks, including
  // other people's".
  var askTrash = function () {
    setCounts(null);
    setModal("trash");
    var id = project.id;
    if (typeof TK_api.projectTaskCounts !== "function") return;
    TK_api.projectTaskCounts(id).then(
      function (c) {
        if (c) setCounts(c);
      },
      function () {},
    );
  };
  var trash = function () {
    setModal(null);
    var id = project.id;
    TK_api.trashProject(id).then(
      function () {
        // Undo works right away: the restore RPC lets the project's owner back in
        // even though the project is hidden from direct reads while trashed.
        TK_vToast("Moved to the trash. " + (isAdmin ? "Restore it from Manage projects." : "An admin can restore it."), {
          label: "Undo",
          onClick: function () {
            TK_api.restoreProject(id).then(
              function () {
                TK_vToast("Restored.");
                try {
                  TK_navigate({ view: "project", projectId: id });
                } catch (e4) {}
              },
              function (e5) {
                TK_vToast(typeof TK_manageErrorText === "function" ? TK_manageErrorText(e5) : TK_vErrText(e5, "saveError"));
              },
            );
          },
        });
        try {
          TK_navigate({ view: "my" });
        } catch (e3) {}
      },
      function (e2) {
        TK_vToast(typeof TK_manageErrorText === "function" ? TK_manageErrorText(e2) : TK_vErrText(e2, "saveError"));
      },
    );
  };

  var shown = members.slice(0, 5);
  return (
    <header className="tk-head tk-project-head">
      <div className="tk-head-row">
        <div className="tk-head-title">
          {editing ? (
            <form className="tk-rename" onSubmit={saveName}>
              <input
                className={"tk-input tk-rename-input" + (err ? " is-invalid" : "")}
                type="text"
                maxLength={120}
                value={draft}
                autoFocus
                aria-label="Project name"
                aria-invalid={err ? "true" : "false"}
                onChange={function (e) {
                  setDraft(e.target.value);
                  if (err) setErr("");
                }}
                onKeyDown={function (e) {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    setEditing(false);
                    setErr("");
                  }
                }}
              />
              <button type="submit" className="btn-primary">
                Save
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={function () {
                  setEditing(false);
                  setErr("");
                }}
              >
                Cancel
              </button>
            </form>
          ) : (
            <h2 className="tk-head-name">{project.name || "Project"}</h2>
          )}
          {project.kind === "onboarding" ? <span className="pill neutral">Onboarding</span> : null}
          {project.open_to_staff ? <span className="pill good tk-open-chip">{TK_vCopy("openToStaff", "Open to all staff")}</span> : null}
        </div>
        <div className="tk-head-actions">
          {shown.length ? (
            <button
              type="button"
              className="tk-avatars"
              aria-label={"Members: " + members.length}
              title="Members"
              onClick={function () {
                setModal("members");
              }}
            >
              {shown.map(function (m) {
                return <TK_vAvatar key={m.staff_email} name={TK_vStaffName(staff, m.staff_email)} size="sm" decorative />;
              })}
              {members.length > shown.length ? <span className="tk-avatar tk-avatar-sm tk-avatar-more">{"+" + (members.length - shown.length)}</span> : null}
            </button>
          ) : null}
          {canManage ? (
            <button
              type="button"
              className="tk-link-btn"
              onClick={function () {
                setModal("members");
              }}
            >
              <TK_vIcon name="people" size={15} />
              <span>Add member</span>
            </button>
          ) : null}
          {canManage ? (
            <TK_vMenuButton
              className="tk-icon-btn"
              ariaLabel="Project options"
              title="Project options"
              menuLabel="Project options"
              align="right"
              label={<TK_vIcon name="more" size={16} />}
            >
              {function (close) {
                var items = [
                  <button
                    key="rename"
                    type="button"
                    role="menuitem"
                    className="tk-menu-item"
                    onClick={function () {
                      close();
                      setDraft(project.name || "");
                      setEditing(true);
                    }}
                  >
                    Rename
                  </button>,
                  <button
                    key="sections"
                    type="button"
                    role="menuitem"
                    className="tk-menu-item"
                    onClick={function () {
                      close();
                      setModal("sections");
                    }}
                  >
                    Sections
                  </button>,
                ];
                if (isAdmin) {
                  items.push(
                    <button
                      key="open"
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={project.open_to_staff ? "true" : "false"}
                      className="tk-menu-item"
                      onClick={function () {
                        close();
                        setOpenToStaff(!project.open_to_staff);
                      }}
                    >
                      <span className={"tk-menu-check" + (project.open_to_staff ? " is-on" : "")} aria-hidden="true">
                        {project.open_to_staff ? <TK_vIcon name="check" size={12} /> : null}
                      </span>
                      {TK_vCopy("openToStaff", "Open to all staff")}
                    </button>,
                  );
                }
                items.push(
                  <button
                    key="archive"
                    type="button"
                    role="menuitem"
                    className="tk-menu-item tk-menu-danger"
                    onClick={function () {
                      close();
                      setModal("archive");
                    }}
                  >
                    Archive project
                  </button>,
                  <button
                    key="trash"
                    type="button"
                    role="menuitem"
                    className="tk-menu-item tk-menu-danger"
                    onClick={function () {
                      close();
                      askTrash();
                    }}
                  >
                    Move to trash
                  </button>,
                );
                return items;
              }}
            </TK_vMenuButton>
          ) : null}
        </div>
      </div>
      {err ? (
        <p className="tk-field-error" role="alert">
          {err}
        </p>
      ) : null}
      {archived ? (
        <div className="tk-banner" role="status">
          This project is archived.
        </div>
      ) : null}
      {modal === "sections" ? (
        <TK_vSectionsModal
          projectId={project.id}
          sections={project.sections}
          onClose={function () {
            setModal(null);
          }}
        />
      ) : null}
      {modal === "members" ? (
        <TK_vMembersModal
          projectId={project.id}
          members={members}
          staff={staff}
          canManage={canManage}
          onChanged={loadMembers}
          onClose={function () {
            setModal(null);
          }}
        />
      ) : null}
      {modal === "archive" ? (
        <TK_vConfirm
          title="Archive this project?"
          body="It leaves the sidebar and its tasks become read-only. Nothing is deleted."
          confirmLabel="Archive"
          onCancel={function () {
            setModal(null);
          }}
          onConfirm={archive}
        />
      ) : null}
      {modal === "trash" ? (
        <TK_vConfirm
          title={TK_manageTrashConfirm(Object.assign({}, project, counts || {})).title}
          body={TK_manageTrashConfirm(Object.assign({}, project, counts || {})).body}
          confirmLabel="Move to trash"
          onCancel={function () {
            setModal(null);
          }}
          onConfirm={trash}
        />
      ) : null}
    </header>
  );
}

function TK_vPersonHeader(props) {
  var s = props.person || {};
  return (
    <header className="tk-head tk-person-head">
      <div className="tk-head-row">
        <div className="tk-head-title">
          <TK_vAvatar name={s.name || ""} decorative />
          <h2 className="tk-head-name">{s.name || "Staff member"}</h2>
          <span className="pill neutral">{TK_vRoleLabel(s.role)}</span>
        </div>
      </div>
    </header>
  );
}

function TK_vNotice(props) {
  return (
    <div className="tk-state" role="status">
      <p>{props.text}</p>
      <a className="btn-secondary" href="#/tasks/my">
        Go to My Tasks
      </a>
    </div>
  );
}

// ---- The list -------------------------------------------------------------------------

function TK_List(props) {
  var schema = TK_vUseSchema();
  if (schema === "missing") return <TK_SetupCard />;
  if (schema !== "ok") {
    return (
      <div className="tk-view tk-list">
        <TK_vSkeletonRows count={6} />
      </div>
    );
  }
  var route = props.route || {};
  if (route.view === "person" && !props.isAdmin) return <TK_vNotice text={TK_vCopy("personAdminOnly", "Only admins can see someone else's list.")} />;
  // Remount per list so filters, focus and collapsed sections start fresh.
  return <TK_vListBody key={TK_formatRoute(route)} {...props} />;
}

function TK_vListBody(props) {
  var route = props.route || {};
  var staffUser = props.staffUser || {};
  var email = TK_vLower(staffUser.email);
  var isAdmin = !!props.isAdmin;
  var today = TK_vToday();
  var width = TK_vUseWidth();
  var phone = width <= 760;
  var online = TK_vUseOnline();
  var touch = TK_vUseTouch();
  var staff = TK_vUseStaff(true);
  var projects = TK_vUseProjects();
  var clients = Array.isArray(props.clients) ? props.clients : [];
  var drawerId = TK_vUseStore(function (s) {
    return s ? s.drawerId : null;
  });
  // Person lists can group by client (remembered per signed-in person).
  var gbPair = TK_vUseGroupBy(email, "person");
  var byClient = route.view === "person" && gbPair[0] === "client" && typeof TK_groupByClient === "function";

  var scopeInfo = TK_listScopeOf(route, { staff: staff || [] });
  var listKey = scopeInfo ? scopeInfo.key : null;
  var project = route.view === "project" ? TK_vFind(projects, "id", route.projectId) : null;
  var client = route.view === "client" ? TK_vFind(clients, "id", route.clientId) : null;
  var person = scopeInfo && scopeInfo.staff ? scopeInfo.staff : null;
  var archived = !!(project && project.archived_at);

  var fPair = React.useState({ assignee: "", statuses: [], showDone: false, showOlder: false });
  var filters = fPair[0];
  var setFilters = fPair[1];
  var patchFilters = function (p) {
    setFilters(function (f) {
      return Object.assign({}, f, p);
    });
  };
  var sPair = React.useState(function () {
    var all = TK_vLsGet(TK_vSORT_KEY, {}) || {};
    var v = listKey && all[listKey];
    return v && v.col ? v : null;
  });
  var sort = sPair[0];
  var setSort = sPair[1];
  // A person list knows its key only once staff has loaded.
  React.useEffect(
    function () {
      if (!listKey) return;
      var saved = (TK_vLsGet(TK_vSORT_KEY, {}) || {})[listKey];
      if (saved && saved.col) setSort(saved);
    },
    [listKey],
  );
  var cPair = React.useState({});
  var collapsed = cPair[0];
  var setCollapsed = cPair[1];
  var focusPair = React.useState(null);
  var focusedId = focusPair[0];
  var setFocusedId = focusPair[1];
  var sigPair = React.useState({ id: null, n: 0 });
  var sig = sigPair[0];
  var setSig = sigPair[1];
  var shPair = React.useState(false);
  var filtersOpen = shPair[0];
  var setFiltersOpen = shPair[1];

  var loader = function () {
    if (!scopeInfo || typeof TK_api === "undefined" || !TK_api || typeof TK_api.listScope !== "function") return Promise.resolve([]);
    return TK_api.listScope(scopeInfo.scope, { showDone: filters.showDone, showOlder: filters.showOlder });
  };
  var list = TK_vUseList(listKey, loader);
  var firstLoad = React.useRef(true);
  React.useEffect(
    function () {
      if (firstLoad.current) {
        firstLoad.current = false;
        return;
      }
      if (list && typeof list.reload === "function") list.reload();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filters.showDone, filters.showOlder],
  );

  var nameOf = function (e) {
    return TK_vStaffName(staff, e);
  };
  var clientNames = {};
  clients.forEach(function (c) {
    if (c && c.id != null) clientNames[String(c.id)] = c.name || "";
  });
  var projectNames = {};
  (Array.isArray(projects) ? projects : []).forEach(function (p) {
    if (p && p.id) projectNames[p.id] = p.name || "";
  });

  var all = Array.isArray(list.tasks) ? list.tasks : [];
  var shown = TK_applyFilters(all, { assignee: filters.assignee, statuses: filters.statuses, showDone: filters.showDone, showOlder: filters.showOlder, today: today });
  var sorted = TK_sortTasks(shown, sort, { nameOf: nameOf });
  var groups = byClient
    ? TK_groupByClient(sorted, { clients: clients, collapsed: collapsed, flagOf: typeof CF_flag === "function" ? CF_flag : undefined }).map(function (g) {
        return { key: g.key, name: g.label, flag: g.flag, tasks: g.tasks };
      })
    : sort
    ? [{ key: "\u0000flat", name: "", tasks: sorted }]
    : TK_groupBySection(sorted, { kind: route.view === "project" ? "project" : "client", sections: project ? project.sections : [] });
  var ids = [];
  groups.forEach(function (g) {
    if (collapsed[g.key]) return;
    g.tasks.forEach(function (t) {
      if (t && t.id != null) ids.push(t.id);
    });
  });
  var byId = {};
  all.forEach(function (t) {
    if (t && t.id != null) byId[t.id] = t;
  });
  var counts = TK_vUseChecklist(ids);

  // People in the assignee filter: who holds tasks in this list (the
  // assignee only; Unassigned is its own choice, S8b).
  var people = (function () {
    var seen = {};
    var out = [];
    all.forEach(function (t) {
      var e = TK_vLower(t && t.assignee_email);
      if (!e || seen[e]) return;
      seen[e] = 1;
      out.push({ email: e, name: nameOf(e) });
    });
    return out.sort(function (a, b) {
      var x = a.name.toLowerCase();
      var y = b.name.toLowerCase();
      return x < y ? -1 : x > y ? 1 : 0;
    });
  })();

  var clientIdForAdd = route.view === "client" ? route.clientId : project && project.kind === "onboarding" && project.client_id ? project.client_id : null;
  var addCtx = {
    email: email,
    staff: staff || [],
    clients: clients,
    clientId: clientIdForAdd,
    projectId: route.view === "project" ? route.projectId : null,
    assigneeEmail: person ? TK_vLower(person.email) : null,
  };
  var quickAddDetail = function () {
    var d = {};
    if (addCtx.projectId) d.project_id = addCtx.projectId;
    if (addCtx.clientId != null) d.client_id = addCtx.clientId;
    var f = focusedId && byId[focusedId];
    if (f && f.section) d.section = f.section;
    return d;
  };
  var readOnly = archived || !online;

  var keys = TK_useKeys({
    ids: ids,
    focusedId: focusedId,
    setFocusedId: setFocusedId,
    enabled: !drawerId,
    onOpen: function (id) {
      TK_vOpenTask(id, { from: "keys" });
    },
    onToggleDone: function (id) {
      if (byId[id] && !readOnly) TK_vComplete(byId[id], isAdmin);
    },
    onStatusMenu: function (id) {
      setSig(function (s) {
        return { id: id, n: s.n + 1 };
      });
    },
    quickAdd: archived ? {} : quickAddDetail,
  });

  var clickSort = function (col) {
    var next = TK_toggleSort(sort, col);
    setSort(next);
    if (listKey) {
      var allSorts = TK_vLsGet(TK_vSORT_KEY, {}) || {};
      if (next) allSorts[listKey] = next;
      else delete allSorts[listKey];
      TK_vLsSet(TK_vSORT_KEY, allSorts);
    }
  };

  // ---- Not found (or no access) -------------------------------------------------
  if (!scopeInfo) {
    if (route.view === "person" && staff == null) return <TK_vSkeletonRows count={6} />;
    return <TK_vNotice text={TK_vCopy("notFound", "We couldn't find that list.")} />;
  }
  if (route.view === "project" && projects != null && !project) return <TK_vNotice text={TK_vCopy("notFound", "We couldn't find that list.")} />;
  if (route.view === "client" && clients.length && !client) return <TK_vNotice text={TK_vCopy("notFound", "We couldn't find that list.")} />;

  var header = null;
  if (route.view === "client") header = <TK_ClientHeader client={client || { id: route.clientId, name: "" }} staffUser={staffUser} isAdmin={isAdmin} onTeamChanged={list.reload} />;
  else if (route.view === "project") header = project ? <TK_vProjectHeader project={project} isAdmin={isAdmin} email={email} staff={staff} /> : null;
  else if (route.view === "person") header = <TK_vPersonHeader person={person} />;

  var loading = !!list.loading && !all.length;
  var errCode = list.error ? (typeof list.error === "string" ? list.error : list.error.code) : null;
  if (errCode === "tk_schema_missing") return <TK_SetupCard />;
  var activeFilters = (filters.assignee ? 1 : 0) + filters.statuses.length + (filters.showDone ? 1 : 0);

  var toolbar = (
    <div className="tk-toolbar" role="toolbar" aria-label="List options">
      {readOnly ? null : (
        <button
          type="button"
          className="btn-primary tk-add-btn"
          data-tour="tk-add"
          onClick={function () {
            try {
              window.dispatchEvent(new CustomEvent("tk:quick-add", { detail: quickAddDetail() }));
            } catch (e) {}
          }}
        >
          <TK_vIcon name="plus" size={15} />
          <span>Add task</span>
        </button>
      )}
      {phone ? (
        <button
          type="button"
          className="tk-tool-btn"
          aria-haspopup="dialog"
          onClick={function () {
            setFiltersOpen(true);
          }}
        >
          <TK_vIcon name="filter" size={15} />
          <span>{"Filters" + (activeFilters ? " (" + activeFilters + ")" : "")}</span>
        </button>
      ) : (
        <TK_vFilters value={filters} onChange={patchFilters} people={people} hideAssignee={route.view === "person"} />
      )}
      {route.view === "person" ? <TK_vGroupBySwitch value={gbPair[0]} dueLabel="Default" onChange={gbPair[1]} /> : null}
      {sort && !byClient ? (
        <button
          type="button"
          className="tk-tool-btn"
          onClick={function () {
            setSort(null);
            if (listKey) {
              var s2 = TK_vLsGet(TK_vSORT_KEY, {}) || {};
              delete s2[listKey];
              TK_vLsSet(TK_vSORT_KEY, s2);
            }
          }}
        >
          Group by section
        </button>
      ) : null}
      {touch ? null : (
        <button type="button" className="tk-icon-btn tk-keys-btn" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" onClick={keys.openHelp}>
          <TK_vIcon name="keyboard" size={16} />
        </button>
      )}
    </div>
  );

  var colHead = (
    <div className="tk-col-head" role="row">
      <span className="tk-cell tk-cell-check" role="columnheader">
        <span className="tk-sr">Done</span>
      </span>
      {TK_vCOLUMNS.map(function (c) {
        var on = sort && sort.col === c.col;
        var aria = on ? (sort.dir === "desc" ? "descending" : "ascending") : "none";
        var cls = c.col === "task" ? "tk-cell-main" : c.col === "assignee" ? "tk-cell-who" : c.col === "due" ? "tk-cell-due" : c.col === "status" ? "tk-cell-status" : "tk-cell-prio";
        return (
          <span key={c.col} className={"tk-cell " + cls} role="columnheader" aria-sort={aria}>
            <button
              type="button"
              className={"tk-sort-btn" + (on ? " is-on" : "")}
              onClick={function () {
                clickSort(c.col);
              }}
            >
              {c.label}
              {on ? <TK_vIcon name="down" size={12} className={sort.dir === "asc" ? "tk-flip" : ""} /> : null}
            </button>
          </span>
        );
      })}
    </div>
  );

  var body;
  if (loading) body = <TK_vSkeletonRows count={6} />;
  else if (list.error && !all.length) body = <TK_vErrorState onRetry={list.reload} />;
  else {
    var rowFor = function (t) {
      return (
        <TK_TaskRow
          key={t.id}
          task={t}
          today={today}
          columns={true}
          clientName={t.client_id != null ? clientNames[String(t.client_id)] || "" : ""}
          projectName={route.view !== "project" && t.project_id ? projectNames[t.project_id] || "" : ""}
          showClient={route.view !== "client" && !byClient}
          showSection={!!sort}
          assigneeName={t.assignee_email ? nameOf(t.assignee_email) : ""}
          onClaim={readOnly ? undefined : TK_vClaim}
          focused={focusedId === t.id}
          checklist={counts[t.id] || null}
          isAdmin={isAdmin}
          canEdit={!readOnly}
          statusSignal={sig.id === t.id ? sig.n : 0}
          onFocusRow={setFocusedId}
          onOpen={function (id) {
            setFocusedId(id);
            TK_vOpenTask(id, { from: "list" });
          }}
          onToggleDone={
            readOnly
              ? null
              : function (task) {
                  TK_vComplete(task, isAdmin);
                }
          }
          onStatus={
            readOnly
              ? null
              : function (task, s, note) {
                  TK_vSetStatus(task, s, note, isAdmin);
                }
          }
        />
      );
    };
    var nothing = !shown.length;
    body = (
      <div className="tk-table" role="grid" aria-label="Tasks" aria-rowcount={shown.length}>
        {colHead}
        {nothing && (activeFilters || readOnly) ? (
          <div className="tk-empty">
            <p>{TK_vCopy("emptyList", "Nothing here yet.")}</p>
          </div>
        ) : null}
        {groups.map(function (g) {
          if (g.key === "\u0000flat") {
            return (
              <ul key={g.key} className="tk-rows" role="rowgroup">
                {g.tasks.map(rowFor)}
              </ul>
            );
          }
          var isCol = !!collapsed[g.key];
          var hid = "tk-sec-" + encodeURIComponent(g.key || "none").replace(/%/g, "_");
          return (
            <section key={g.key || "\u0000none"} className={"tk-group tk-section" + (isCol ? " is-collapsed" : "")} aria-labelledby={hid}>
              <h3 className="tk-group-head" id={hid}>
                <button
                  type="button"
                  className="tk-group-btn"
                  aria-expanded={isCol ? "false" : "true"}
                  onClick={function () {
                    setCollapsed(function (c) {
                      var n = Object.assign({}, c);
                      n[g.key] = !isCol;
                      return n;
                    });
                  }}
                >
                  <TK_vIcon name="chevron" size={14} className="tk-chev" />
                  <span className="tk-group-name">{g.name}</span>
                  {byClient && g.flag ? <span className="tk-group-flag">{TK_vGroupFlagText(g.flag)}</span> : null}
                  <span className="tk-count">{g.tasks.length}</span>
                </button>
              </h3>
              {isCol ? null : (
                <ul className="tk-rows" role="rowgroup">
                  {g.tasks.map(rowFor)}
                  {nothing && !activeFilters && !g.tasks.length && groups.length === 1 ? (
                    <li className="tk-empty tk-empty-inline">{TK_vCopy("emptyList", "Nothing here yet.")}</li>
                  ) : null}
                  {byClient ? null : <TK_vAddRow section={g.key || null} sectionName={g.key ? g.name : ""} ctx={addCtx} disabled={readOnly} />}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    );
  }

  return (
    <div className={"tk-view tk-list tk-list-" + route.view + (archived ? " is-archived" : "")}>
      {header}
      {toolbar}
      {!online ? <TK_vOfflineBanner /> : null}
      {body}
      {filtersOpen && phone ? (
        <TK_vModal
          onClose={function () {
            setFiltersOpen(false);
          }}
          labelledBy="tk-filters-title"
          className="tk-modal tk-sheet tk-filters-sheet"
        >
          <div className="modal-header">
            <h3 className="card-title" id="tk-filters-title" style={{ margin: 0 }}>
              Filters
            </h3>
            <button
              type="button"
              className="modal-close"
              aria-label="Close"
              onClick={function () {
                setFiltersOpen(false);
              }}
            >
              ×
            </button>
          </div>
          <div className="modal-body">
            <TK_vFilters value={filters} onChange={patchFilters} people={people} hideAssignee={route.view === "person"} stacked />
          </div>
          <div className="modal-footer tk-modal-footer">
            <button
              type="button"
              className="btn-secondary"
              onClick={function () {
                setFilters({ assignee: "", statuses: [], showDone: false, showOlder: false });
              }}
            >
              Clear
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={function () {
                setFiltersOpen(false);
              }}
            >
              Done
            </button>
          </div>
        </TK_vModal>
      ) : null}
      {keys.sheet}
    </div>
  );
}

// ---- Search -----------------------------------------------------------------------------

function TK_SearchView(props) {
  var schema = TK_vUseSchema();
  if (schema === "missing") return <TK_SetupCard />;
  if (schema !== "ok") {
    return (
      <div className="tk-view tk-search">
        <TK_vSkeletonRows count={4} />
      </div>
    );
  }
  return <TK_vSearchBody {...props} />;
}

function TK_vSearchBody(props) {
  var isAdmin = !!props.isAdmin;
  var today = TK_vToday();
  var online = TK_vUseOnline();
  var clients = Array.isArray(props.clients) ? props.clients : [];
  var projects = TK_vUseProjects();
  var drawerId = TK_vUseStore(function (s) {
    return s ? s.drawerId : null;
  });
  var qPair = React.useState("");
  var q = qPair[0];
  var setQ = qPair[1];
  var rPair = React.useState({ q: "", rows: [], loading: false, error: null });
  var res = rPair[0];
  var setRes = rPair[1];
  var focusPair = React.useState(null);
  var focusedId = focusPair[0];
  var setFocusedId = focusPair[1];
  var sigPair = React.useState({ id: null, n: 0 });
  var sig = sigPair[0];
  var setSig = sigPair[1];
  var seq = React.useRef(0);
  var tracked = React.useRef(false);
  var inputRef = React.useRef(null);

  var run = React.useCallback(function (text) {
    var t = String(text || "").trim();
    var n = ++seq.current;
    if (!t) {
      setRes({ q: "", rows: [], loading: false, error: null });
      return;
    }
    setRes(function (r) {
      return { q: t, rows: r.rows, loading: true, error: null };
    });
    if (typeof TK_api === "undefined" || !TK_api || typeof TK_api.search !== "function") {
      setRes({ q: t, rows: [], loading: false, error: "tk_error" });
      return;
    }
    TK_api.search(t, 50).then(
      function (rows) {
        if (n !== seq.current) return;
        setRes({ q: t, rows: Array.isArray(rows) ? rows : [], loading: false, error: null });
        if (!tracked.current) {
          tracked.current = true;
          TK_vTrack("tasks-search");
        }
      },
      function (e) {
        if (n !== seq.current) return;
        setRes({ q: t, rows: [], loading: false, error: (e && e.code) || "tk_error" });
      },
    );
  }, []);

  React.useEffect(
    function () {
      var h = setTimeout(function () {
        run(q);
      }, 250);
      return function () {
        clearTimeout(h);
      };
    },
    [q, run],
  );
  React.useEffect(function () {
    if (inputRef.current) {
      try {
        inputRef.current.focus({ preventScroll: true });
      } catch (e) {}
    }
  }, []);

  // Rows show the store's copy of a task when it has one, so a status change
  // made here or in the drawer shows straight away.
  var storeTasks = TK_vUseStore(function (s) {
    return s ? s.tasks : null;
  });
  // A task deleted since the search ran drops out (its store copy says so).
  var rows = [];
  res.rows.forEach(function (r) {
    var base = TK_searchRowToTask(r);
    var live = storeTasks && base.id ? storeTasks[base.id] : null;
    if (live && live.deleted_at) return;
    rows.push({ task: live || base, snippet: r.match === "comment" ? r.snippet || "" : "" });
  });
  var ids = rows.map(function (r) {
    return r.task.id;
  });
  var byId = {};
  rows.forEach(function (r) {
    byId[r.task.id] = r.task;
  });
  var clientNames = {};
  clients.forEach(function (c) {
    if (c && c.id != null) clientNames[String(c.id)] = c.name || "";
  });
  var projectNames = {};
  (Array.isArray(projects) ? projects : []).forEach(function (p) {
    if (p && p.id) projectNames[p.id] = p.name || "";
  });

  var keys = TK_useKeys({
    ids: ids,
    focusedId: focusedId,
    setFocusedId: setFocusedId,
    enabled: !drawerId,
    onOpen: function (id) {
      TK_vOpenTask(id, { from: "search" });
    },
    onToggleDone: function (id) {
      if (online && byId[id]) TK_vComplete(byId[id], isAdmin);
    },
    onStatusMenu: function (id) {
      setSig(function (s) {
        return { id: id, n: s.n + 1 };
      });
    },
    quickAdd: {},
  });

  var body = null;
  if (!res.q && !q.trim()) body = <p className="tk-muted tk-search-hint">Search task names, notes and comments.</p>;
  else if (res.loading && !res.rows.length) body = <TK_vSkeletonRows count={4} />;
  else if (res.error) {
    body = (
      <TK_vErrorState
        text={TK_vCopy("loadError")}
        onRetry={function () {
          run(q);
        }}
      />
    );
  } else if (!rows.length && res.q) {
    body = (
      <div className="tk-empty">
        <p>{TK_vCopy("emptySearch", "No tasks match that search.")}</p>
      </div>
    );
  } else {
    body = (
      <ul className="tk-rows" role="grid" aria-label="Search results" aria-busy={res.loading ? "true" : "false"}>
        {rows.map(function (r) {
          var t = r.task;
          return (
            <TK_TaskRow
              key={t.id}
              task={t}
              today={today}
              clientName={t.client_id != null ? clientNames[String(t.client_id)] || "" : ""}
              projectName={t.project_id ? projectNames[t.project_id] || "" : ""}
              snippet={r.snippet}
              focused={focusedId === t.id}
              isAdmin={isAdmin}
              canEdit={online}
              statusSignal={sig.id === t.id ? sig.n : 0}
              onFocusRow={setFocusedId}
              onOpen={function (id) {
                setFocusedId(id);
                TK_vOpenTask(id, { from: "search" });
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
    );
  }

  return (
    <div className="tk-view tk-search">
      <h2 className="tk-view-title">Search</h2>
      <div className="tk-search-box" role="search">
        <TK_vIcon name="search" size={16} className="tk-search-icon" />
        <input
          ref={inputRef}
          className="tk-input tk-search-input"
          type="search"
          value={q}
          maxLength={200}
          placeholder="Search tasks"
          aria-label="Search tasks"
          autoComplete="off"
          onChange={function (e) {
            setQ(e.target.value);
            setFocusedId(null);
          }}
          onKeyDown={function (e) {
            if (e.key === "Enter") {
              e.preventDefault();
              run(q);
            } else if (e.key === "ArrowDown" && ids.length) {
              e.preventDefault();
              setFocusedId(ids[0]);
              try {
                e.target.blur();
              } catch (err) {}
            }
          }}
        />
      </div>
      {body}
      {keys.sheet}
    </div>
  );
}
