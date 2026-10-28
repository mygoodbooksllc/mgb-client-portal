// ----------------------------------------------------------------------------
// TK_ManageProjects.jsx — the admin "Manage projects" screen at #/tasks/manage
// (Tasks Phase 3).
//
// TK_ManageProjects({ staffUser, clients, isAdmin })
//   Every project in one list: active, archived and in the trash. Filter chips
//   (All, Active, Archived, Trash) and a search box (name, client, owner).
//   Per row: Rename (inline), Archive or Unarchive, Move to trash (with a
//   confirm), Color (a ten-color palette; the dot shows in the sidebar, the
//   project header and task rows), and Restore for anything in the trash. Trash hides a project and
//   its tasks from every list, My Tasks, Waiting, counts, digests and
//   performance; nothing is deleted. Restore brings back exactly the tasks the
//   trash hid. After 30 days a project is only marked as past the window; an
//   admin can still restore it. Not an admin: a calm "admins only" card.
//
// The pure parts are in TK_viewLogic.js (TK_manage*, tested in node). Every
// write is an RPC in supabase/tasks-p3-manage-projects.sql; the server decides
// who may call it.
// ----------------------------------------------------------------------------

function TK_mpKindLabel(r) {
  if (r && r.kind === "onboarding") return r.client_name ? "Onboarding for " + r.client_name : "Onboarding";
  return "Internal";
}

function TK_mpCountText(r) {
  var open = Number(r.open_tasks) || 0;
  var done = Number(r.done_tasks) || 0;
  var parts = [open + (open === 1 ? " open task" : " open tasks"), done + " done"];
  var held = Number(r.trashed_tasks) || 0;
  if (held && (r.state === "trashed" || r.state === "expired")) parts.push(held + (held === 1 ? " task held in the trash" : " tasks held in the trash"));
  return parts.join(", ");
}

function TK_mpRow(props) {
  var r = props.row;
  var actions = typeof TK_manageActions === "function" ? TK_manageActions(r) : [];
  var rPair = React.useState(false);
  var renaming = rPair[0];
  var setRenaming = rPair[1];
  var dPair = React.useState("");
  var draft = dPair[0];
  var setDraft = dPair[1];
  var ePair = React.useState("");
  var err = ePair[0];
  var setErr = ePair[1];
  var cPair = React.useState(false);
  var colorOpen = cPair[0];
  var setColorOpen = cPair[1];
  var trashed = r.state === "trashed" || r.state === "expired";
  var note = trashed && typeof TK_manageTrashNote === "function" ? TK_manageTrashNote(r) : "";
  var owner = r.owner_name || r.owner_email || "";
  var busy = props.busy;
  var rid = "tk-mp-rename-" + r.id;

  var saveRename = function (e) {
    if (e) e.preventDefault();
    var n = draft.trim();
    if (!n || n === r.name) {
      setRenaming(false);
      setErr("");
      return;
    }
    props.onRename(r, n).then(
      function () {
        setRenaming(false);
        setErr("");
      },
      function (e2) {
        setErr(TK_manageErrorText(e2));
      },
    );
  };

  var button = function (key, label, danger, onClick) {
    return (
      <button key={key} type="button" className={"tk-tool-btn" + (danger ? " tk-mp-danger" : "")} disabled={busy} onClick={onClick}>
        {label}
      </button>
    );
  };

  var buttons = actions.map(function (a) {
    if (a === "rename") {
      return button("rename", "Rename", false, function () {
        setDraft(r.name || "");
        setErr("");
        setRenaming(true);
      });
    }
    if (a === "archive") return button("archive", "Archive", false, function () { props.onArchive(r, true); });
    if (a === "unarchive") return button("unarchive", "Unarchive", false, function () { props.onArchive(r, false); });
    if (a === "trash") return button("trash", "Move to trash", true, function () { props.onTrash(r); });
    if (a === "restore") return button("restore", "Restore", false, function () { props.onRestore(r); });
    return null;
  });

  // A trashed project keeps its color (the server refuses to change it there).
  if (!trashed) {
    buttons.unshift(
      <button
        key="color"
        type="button"
        className="tk-tool-btn"
        disabled={busy}
        aria-expanded={colorOpen ? "true" : "false"}
        onClick={function () {
          setColorOpen(!colorOpen);
        }}
      >
        Color
      </button>,
    );
  }

  return (
    <li className={"tk-mp-row" + (trashed ? " is-trashed" : "") + (r.state === "archived" ? " is-archived" : "")}>
      <div className="tk-mp-main">
        {renaming ? (
          <form className="tk-rename" onSubmit={saveRename}>
            <input
              id={rid}
              className={"tk-input tk-rename-input" + (err ? " is-invalid" : "")}
              type="text"
              maxLength={120}
              value={draft}
              autoFocus
              aria-label={"New name for " + (r.name || "project")}
              aria-invalid={err ? "true" : "false"}
              onChange={function (e) {
                setDraft(e.target.value);
                if (err) setErr("");
              }}
              onKeyDown={function (e) {
                if (e.key === "Escape") {
                  e.preventDefault();
                  setRenaming(false);
                  setErr("");
                }
              }}
            />
            <button type="submit" className="btn-primary" disabled={busy}>
              Save
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={function () {
                setRenaming(false);
                setErr("");
              }}
            >
              Cancel
            </button>
          </form>
        ) : (
          <div className="tk-mp-title-line">
            <TK_vProjectDot color={TK_projectColorOf(r)} size="lg" />
            {trashed ? (
              <span className="tk-mp-title">{r.name}</span>
            ) : (
              <a
                className="tk-mp-title"
                href={typeof TK_formatRoute === "function" ? TK_formatRoute({ view: "project", projectId: r.id }) : "#/tasks/my"}
                onClick={function (e) {
                  if (!TK_vPlainClick(e)) return;
                  e.preventDefault();
                  TK_navigate({ view: "project", projectId: r.id });
                }}
              >
                {r.name}
              </a>
            )}
            {r.state === "archived" ? <span className="tk-nav-tag">Archived</span> : null}
            {r.state === "trashed" ? <span className="tk-nav-tag">In trash</span> : null}
            {r.state === "expired" ? <span className="tk-nav-tag">Trash, past 30 days</span> : null}
            {r.open_to_staff ? <span className="tk-nav-tag">Open to all staff</span> : null}
          </div>
        )}
        {err ? (
          <p className="tk-field-error" role="alert">
            {err}
          </p>
        ) : null}
        <p className="tk-muted tk-mp-sub">
          {TK_mpKindLabel(r)}
          {owner ? " · Owner: " + owner : ""}
          {" · " + TK_mpCountText(r)}
          {Number(r.open_requests) > 0 ? " · " + r.open_requests + (Number(r.open_requests) === 1 ? " client request open" : " client requests open") : ""}
        </p>
        {note ? <p className="tk-muted tk-mp-sub">{note}</p> : null}
        {props.plus && (props.plus.desc || props.plus.due) ? (
          <p className="tk-muted tk-mp-sub tkpf-mp-sub">
            {props.plus.due ? <span className={"tkpf-due-text" + (props.plus.due.late ? " is-late" : "")}>{props.plus.due.text}</span> : null}
            {props.plus.due && props.plus.desc ? " · " : ""}
            {props.plus.desc || ""}
          </p>
        ) : null}
        {colorOpen && !trashed ? (
          <TK_vColorPicker
            label={"Color for " + (r.name || "project")}
            value={TK_projectColorOf(r)}
            disabled={busy}
            onPick={function (key) {
              props.onColor(r, key);
            }}
          />
        ) : null}
      </div>
      <div className="tk-mp-actions">{buttons}</div>
    </li>
  );
}

function TK_ManageProjects(props) {
  var schema = TK_vUseSchema();
  if (schema === "missing") return <TK_SetupCard />;
  // The RPCs need a full admin (is_active_staff_admin); temporary admins get the note.
  if (!(props.isAdmin && props.staffUser && props.staffUser.role === "admin")) {
    return (
      <div className="tk-view tk-manage">
        <h2 className="tk-view-title">Manage projects</h2>
        <div className="tk-state" role="status">
          <p>Only admins (not temporary admins) can manage projects. You can rename or archive a project you own from its page.</p>
        </div>
      </div>
    );
  }
  if (schema !== "ok") {
    return (
      <div className="tk-view tk-manage">
        <h2 className="tk-view-title">Manage projects</h2>
        <TK_vSkeletonRows count={5} />
      </div>
    );
  }
  return <TK_vManageBody {...props} />;
}

function TK_vManageBody(props) {
  var online = TK_vUseOnline();
  var dPair = React.useState({ loading: true, error: null, rows: [] });
  var data = dPair[0];
  var setData = dPair[1];
  var fPair = React.useState("all");
  var filter = fPair[0];
  var setFilter = fPair[1];
  var qPair = React.useState("");
  var query = qPair[0];
  var setQuery = qPair[1];
  var bPair = React.useState(false);
  var busy = bPair[0];
  var setBusy = bPair[1];
  var tPair = React.useState(null);
  var trashRow = tPair[0];
  var setTrashRow = tPair[1];
  var tickPair = React.useState(0);
  var tick = tickPair[0];
  var setTick = tickPair[1];
  var plusOn = typeof TKP_useOn === "function" ? TKP_useOn() : false;
  var storeProjects = TK_vUseProjects();

  React.useEffect(
    function () {
      var live = true;
      setData(function (d) {
        return { loading: true, error: null, rows: d.rows };
      });
      if (typeof TK_api === "undefined" || !TK_api || typeof TK_api.adminListProjects !== "function") {
        setData({ loading: false, error: { code: "tk_error" }, rows: [] });
        return undefined;
      }
      TK_api.adminListProjects().then(
        function (rows) {
          if (live) setData({ loading: false, error: null, rows: rows });
        },
        function (e) {
          if (live) setData({ loading: false, error: e || { code: "tk_error" }, rows: [] });
        },
      );
      return function () {
        live = false;
      };
    },
    [tick],
  );

  var reload = function () {
    setTick(function (n) {
      return n + 1;
    });
  };

  // Runs a write, then reloads. Returns the promise so a row can show its own error.
  var act = function (fn, okText) {
    setBusy(true);
    return fn().then(
      function (v) {
        setBusy(false);
        if (okText) TK_vToast(typeof okText === "function" ? okText(v) : okText);
        reload();
        return v;
      },
      function (e) {
        setBusy(false);
        throw e;
      },
    );
  };
  var toastErr = function (e) {
    TK_vToast(TK_manageErrorText(e));
  };

  var onRename = function (r, name) {
    return act(function () {
      return TK_api.renameProject(r.id, name);
    }, "Renamed.");
  };
  var onColor = function (r, key) {
    act(function () {
      return TK_api.setProjectColor(r.id, key);
    }, "Color updated.").catch(function (e) {
      TK_vToast(TK_projectColorError(e));
    });
  };
  var onArchive = function (r, archive) {
    act(function () {
      return TK_api.setProjectArchived(r.id, archive);
    }, archive ? "Project archived." : "Project unarchived.").catch(toastErr);
  };
  var onRestore = function (r) {
    act(function () {
      return TK_api.restoreProject(r.id);
    }, function (n) {
      return "Restored" + (n ? " with " + n + (n === 1 ? " task." : " tasks.") : ".");
    }).catch(toastErr);
  };
  var confirmTrash = function () {
    var r = trashRow;
    setTrashRow(null);
    if (!r) return;
    act(function () {
      return TK_api.trashProject(r.id);
    }, function (n) {
      return "Moved to the trash" + (n ? " with " + n + (n === 1 ? " task." : " tasks.") : ".");
    }).catch(toastErr);
  };

  var counts = TK_manageCounts(data.rows);
  var shown = TK_manageFilterRows(data.rows, { filter: filter, query: query });
  // Slate plus (hidden): description and due date from the project rows the
  // store already holds (the admin list RPC does not return them; a trashed
  // project is not in the store, so it shows neither).
  var plusFor = function (r) {
    if (!plusOn || !r || typeof TKPF_dueInfo !== "function") return null;
    var list = Array.isArray(storeProjects) ? storeProjects : [];
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      if (p && p.id === r.id) {
        var desc = typeof p.description === "string" ? p.description.trim() : "";
        var due = TKPF_dueInfo({ due_on: p.due_on, archived_at: r.archived_at || p.archived_at }, TK_vToday());
        return desc || due ? { desc: desc, due: due } : null;
      }
    }
    return null;
  };
  var chips = TK_MANAGE_FILTERS;

  var body;
  if (data.loading && !data.rows.length) body = <TK_vSkeletonRows count={5} />;
  else if (data.error) {
    body = (
      <div className="tk-state" role="alert">
        <p>{TK_vErrText(data.error, "loadError")}</p>
        <button type="button" className="btn-secondary" onClick={reload}>
          Try again
        </button>
      </div>
    );
  } else if (!shown.length) {
    body = (
      <div className="tk-state" role="status">
        <p>{query.trim() ? "No project matches that." : filter === "trashed" ? "The trash is empty." : "No projects here."}</p>
      </div>
    );
  } else {
    body = (
      <ul className="tk-mp-rows">
        {shown.map(function (r) {
          return <TK_mpRow key={r.id} row={r} plus={plusFor(r)} busy={busy || !online} onRename={onRename} onColor={onColor} onArchive={onArchive} onTrash={setTrashRow} onRestore={onRestore} />;
        })}
      </ul>
    );
  }

  var confirmText = trashRow ? TK_manageTrashConfirm(trashRow) : null;

  return (
    <div className="tk-view tk-manage">
      <div className="tk-view-head" data-tour="tk-manage-head">
        <h2 className="tk-view-title">Manage projects</h2>
        <p className="tk-muted tk-view-sub">
          Rename, archive or move projects to the trash. A project in the trash and its tasks disappear from every list until you restore it. Nothing is deleted.
        </p>
      </div>
      {!online ? <TK_vOfflineBanner /> : null}
      <div className="tk-toolbar tk-mp-toolbar">
        <div className="tk-mp-chips" role="group" aria-label="Show">
          {chips.map(function (c) {
            var on = filter === c.key;
            return (
              <button
                key={c.key}
                type="button"
                className={"tk-filter-chip" + (on ? " is-on" : "")}
                aria-pressed={on ? "true" : "false"}
                onClick={function () {
                  setFilter(c.key);
                }}
              >
                {c.label + " (" + (counts[c.key] || 0) + ")"}
              </button>
            );
          })}
        </div>
        <input
          className="tk-input tk-mp-search"
          type="search"
          placeholder="Find a project, client or owner"
          aria-label="Find a project, client or owner"
          value={query}
          onChange={function (e) {
            setQuery(e.target.value);
          }}
        />
      </div>
      {body}
      {trashRow && confirmText ? (
        <TK_vConfirm
          title={confirmText.title}
          body={confirmText.body}
          confirmLabel={confirmText.confirm}
          onCancel={function () {
            setTrashRow(null);
          }}
          onConfirm={confirmTrash}
        />
      ) : null}
    </div>
  );
}
