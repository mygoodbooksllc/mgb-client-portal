// ----------------------------------------------------------------------------
// TK_ClientHeader.jsx — the header on a client's task list (Row 1.2).
//
// TK_ClientHeader({ client, staffUser, isAdmin, compact, onTeamChanged })
//   name, "Open client" and "SOP" links, the QuickBooks pill (text only),
//   "Open Drive folder", "Contacts" (a popover; a sheet on phones), the People
//   chips (Bookkeeper, Backup, Account Manager) and "New onboarding project".
//
// Every piece comes from TK_api.clientHeader / clientPeople / DRV_status and
// renders nothing when its read fails, so a denied or broken read never
// breaks the list under it. Emails show only inside the contacts list, never
// in a URL.
//
// S8b: an admin on a client with no bookkeeper gets "Assign team": pick an
// active staffer, tk_import_assign_team makes them the bookkeeper and hands
// over the imported Unassigned tasks it owns. No email is sent.
//
// Change bookkeeper (2026-10-22a): for an admin the Bookkeeper chip is a
// button. It opens a panel under the chips: pick another active staffer, an
// "Also move ... open tasks" box (on by default), then a confirm step;
// tk_change_bookkeeper does the swap (wording in TK_bookkeeperLogic.js). Esc
// closes it and returns focus to the chip. Everyone else sees the plain chip;
// the other chips never change. No email is sent.
// ----------------------------------------------------------------------------

var TK_vPEOPLE_ROLES = [
  { key: "bookkeeper", label: "Bookkeeper" },
  { key: "backup", label: "Backup" },
  { key: "account_manager", label: "Account Manager" },
  { key: "reviewer", label: "Reviewer" },
];

function TK_vClientRoleLabel(role) {
  var r = String(role || "").toLowerCase();
  if (!r) return "";
  if (r === "admin" || r === "owner") return "Admin";
  if (r === "viewer" || r === "view") return "Viewer";
  if (r === "member" || r === "user") return "Member";
  return r.charAt(0).toUpperCase() + r.slice(1).replace(/_/g, " ");
}

function TK_vContactsList(props) {
  var list = props.contacts || [];
  if (!list.length) return <p className="tk-muted">No contacts on this client yet.</p>;
  return (
    <ul className="tk-contacts">
      {list.map(function (c, i) {
        return (
          <li key={(c.email || "") + i} className={"tk-contact" + (c.active === false ? " is-inactive" : "")}>
            <div className="tk-contact-main">
              <span className="tk-contact-name">{c.name || c.email || "Contact"}</span>
              {c.role ? <span className="tk-contact-role">{TK_vClientRoleLabel(c.role)}</span> : null}
            </div>
            {c.email && c.name ? <div className="tk-contact-email">{c.email}</div> : null}
            <div className="tk-contact-tags">
              {c.active === false ? <span className="pill neutral">Inactive</span> : null}
              {c.optedOut ? <span className="pill warm">Unsubscribed</span> : null}
              {c.summary && !c.optedOut ? <span className="pill good">Gets summaries</span> : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function TK_ClientHeader(props) {
  var client = props.client || null;
  var id = client && client.id != null ? String(client.id) : "";
  var enc = encodeURIComponent(id);
  var width = TK_vUseWidth();
  var phone = typeof TK_useSlatePhone === "function" ? TK_useSlatePhone(width) : width <= 760;

  var hPair = React.useState(null);
  var header = hPair[0];
  var setHeader = hPair[1];
  var pPair = React.useState([]);
  var people = pPair[0];
  var setPeople = pPair[1];
  var dPair = React.useState(null);
  var driveOn = dPair[0];
  var setDriveOn = dPair[1];
  var cPair = React.useState(false);
  var contactsOpen = cPair[0];
  var setContactsOpen = cPair[1];
  var nPair = React.useState(false);
  var newOnboarding = nPair[0];
  var setNewOnboarding = nPair[1];
  var popRef = React.useRef(null);
  var btnRef = React.useRef(null);
  var plPair = React.useState(false);
  var peopleLoaded = plPair[0];
  var setPeopleLoaded = plPair[1];
  var rvPair = React.useState(0);
  var rv = rvPair[0];
  var setRv = rvPair[1];
  var atPair = React.useState(false);
  var assignOpen = atPair[0];
  var setAssignOpen = atPair[1];
  var apPair = React.useState("");
  var assignPick = apPair[0];
  var setAssignPick = apPair[1];
  var abPair = React.useState(false);
  var assignBusy = abPair[0];
  var setAssignBusy = abPair[1];
  // Change bookkeeper (admins): panel open, pick, move box, confirm step, busy.
  var cbPair = React.useState(false);
  var cbOpen = cbPair[0];
  var setCbOpen = cbPair[1];
  var cpPair = React.useState("");
  var cbPick = cpPair[0];
  var setCbPick = cpPair[1];
  var cmPair = React.useState(true);
  var cbMove = cmPair[0];
  var setCbMove = cmPair[1];
  var ccPair = React.useState(false);
  var cbConfirm = ccPair[0];
  var setCbConfirm = ccPair[1];
  var cxPair = React.useState(false);
  var cbBusy = cxPair[0];
  var setCbBusy = cxPair[1];
  var cbChipRef = React.useRef(null);
  var cbSelectRef = React.useRef(null);
  var cbYesRef = React.useRef(null);
  var isAdmin = !!props.isAdmin;
  var allStaff = TK_vUseStaff(isAdmin && (assignOpen || cbOpen));

  // A different client closes the change-bookkeeper panel.
  React.useEffect(
    function () {
      setCbOpen(false);
      setCbPick("");
      setCbMove(true);
      setCbConfirm(false);
    },
    [id],
  );

  // Focus follows the step: the select on open, "Yes, reassign" on confirm.
  React.useEffect(
    function () {
      if (!cbOpen) return;
      var el = cbConfirm ? cbYesRef.current : cbSelectRef.current;
      if (el) {
        try {
          el.focus();
        } catch (e) {}
      }
    },
    [cbOpen, cbConfirm],
  );

  React.useEffect(
    function () {
      if (!id) return undefined;
      var live = true;
      setHeader(null);
      setPeople([]);
      setPeopleLoaded(false);
      var api = typeof TK_api !== "undefined" && TK_api ? TK_api : null;
      if (api && typeof api.clientHeader === "function") {
        Promise.resolve()
          .then(function () {
            return api.clientHeader(id);
          })
          .then(
            function (h) {
              if (live) setHeader(h || null);
            },
            function () {
              if (live) setHeader(null);
            },
          );
      }
      if (api && typeof api.clientPeople === "function") {
        Promise.resolve()
          .then(function () {
            return api.clientPeople(id);
          })
          .then(
            function (rows) {
              if (!live) return;
              setPeople(Array.isArray(rows) ? rows : []);
              setPeopleLoaded(true);
            },
            function () {
              if (live) setPeople([]); // unknown: no Assign team on a failed read
            },
          );
      }
      if (typeof DRV_status === "function") {
        Promise.resolve()
          .then(function () {
            return DRV_status();
          })
          .then(
            function (on) {
              if (live) setDriveOn(!!on);
            },
            function () {
              if (live) setDriveOn(false);
            },
          );
      } else {
        setDriveOn(false);
      }
      return function () {
        live = false;
      };
    },
    [id, rv],
  );

  // The desktop popover closes on an outside click and on Esc.
  React.useEffect(
    function () {
      if (!contactsOpen || phone) return undefined;
      var onDoc = function (e) {
        if (popRef.current && popRef.current.contains(e.target)) return;
        if (btnRef.current && btnRef.current.contains(e.target)) return;
        setContactsOpen(false);
      };
      var onKey = function (e) {
        if (e.key !== "Escape") return;
        e.preventDefault();
        e.stopPropagation();
        setContactsOpen(false);
        if (btnRef.current) {
          try {
            btnRef.current.focus();
          } catch (err) {}
        }
      };
      document.addEventListener("mousedown", onDoc, true);
      document.addEventListener("keydown", onKey, true);
      return function () {
        document.removeEventListener("mousedown", onDoc, true);
        document.removeEventListener("keydown", onKey, true);
      };
    },
    [contactsOpen, phone],
  );

  if (!client) return null;
  var name = client.name || client.display_name || id;
  var qbo = header && header.qbo ? header.qbo : null;
  var qboOn = qbo && String(qbo.status || "").toLowerCase() === "connected";
  var folder = header && header.driveFolderId ? String(header.driveFolderId) : null;
  var driveReady = !!folder && driveOn === true;
  var contacts = header && Array.isArray(header.contacts) ? header.contacts : [];
  var chips = TK_vPEOPLE_ROLES.map(function (r) {
    var hit = null;
    for (var i = 0; i < people.length; i++) if (people[i] && people[i].role === r.key) hit = people[i];
    return hit ? { key: r.key, label: r.label, name: hit.name || hit.email || "", email: hit.email || "" } : null;
  }).filter(Boolean);

  // S8b: no bookkeeper on the client (and the roster agrees) -> Assign team.
  var hasBookkeeper =
    people.some(function (x) { return x && x.role === "bookkeeper"; }) ||
    !!(client.assignedBookkeeper && client.assignedBookkeeper.email);
  var canAssignTeam = isAdmin && peopleLoaded && !hasBookkeeper && typeof TK_api !== "undefined" && TK_api && typeof TK_api.assignTeam === "function";
  var activeStaff = (Array.isArray(allStaff) ? allStaff : [])
    .filter(function (x) { return x && x.email && x.active !== false; })
    .slice()
    .sort(function (a, b) {
      var x = String(a.name || a.email).toLowerCase();
      var y = String(b.name || b.email).toLowerCase();
      return x < y ? -1 : x > y ? 1 : 0;
    });
  var doAssignTeam = function () {
    if (!assignPick || assignBusy) return;
    var who = activeStaff.filter(function (x) { return String(x.email).toLowerCase() === assignPick; })[0];
    var whoName = (who && who.name) || assignPick;
    setAssignBusy(true);
    TK_api.assignTeam(id, assignPick).then(
      function (res) {
        setAssignBusy(false);
        setAssignOpen(false);
        setAssignPick("");
        var n = res && Number(res.tasks_moved) > 0 ? Number(res.tasks_moved) : 0;
        TK_toast("Assigned " + whoName + " as bookkeeper." + (n ? " They now own " + n + (n === 1 ? " unassigned task" : " unassigned tasks") + "; anyone on the team can claim them." : ""));
        setRv(function (x) { return x + 1; });
        try {
          window.dispatchEvent(new CustomEvent("mgb:tk-team-assigned", { detail: { clientId: id } }));
        } catch (e) {}
        if (typeof props.onTeamChanged === "function") props.onTeamChanged();
      },
      function (err) {
        setAssignBusy(false);
        var why = (err && (err.reason || err.code)) || "";
        var text =
          why === "tk_has_team"
            ? "This client already has a bookkeeper."
            : why === "tk_bad_assignee"
              ? "Pick someone who's active on staff."
              : why === "tk_forbidden"
                ? "Only admins can assign a team."
                : why === "tk_not_found"
                  ? "We couldn't find that client."
                  : typeof TK_vErrText === "function"
                    ? TK_vErrText(err)
                    : "Couldn't assign the team. Try again.";
        TK_toast(text);
        if (why === "tk_has_team") setRv(function (x) { return x + 1; });
      },
    );
  };

  // Change bookkeeper: admins, a bookkeeper chip with an email, the API and wording loaded.
  var bkChip = chips.filter(function (c) { return c.key === "bookkeeper"; })[0] || null;
  var canChangeBk =
    isAdmin && !!(bkChip && bkChip.email) &&
    typeof TK_api !== "undefined" && TK_api && typeof TK_api.changeBookkeeper === "function" &&
    typeof TK_bkEligible === "function";
  var cbOldName = bkChip ? bkChip.name : "";
  var cbChoices = canChangeBk ? TK_bkEligible(activeStaff, bkChip.email) : [];
  var cbWho = cbChoices.filter(function (x) { return String(x.email).toLowerCase() === cbPick; })[0];
  var cbNewName = (cbWho && cbWho.name) || cbPick;
  var closeChangeBk = function (refocus) {
    setCbOpen(false);
    setCbPick("");
    setCbMove(true);
    setCbConfirm(false);
    if (refocus && cbChipRef.current) {
      try {
        cbChipRef.current.focus();
      } catch (e) {}
    }
  };
  var onChangeBkKey = function (e) {
    if (e.key !== "Escape" || !cbOpen || cbBusy) return;
    e.preventDefault();
    e.stopPropagation();
    closeChangeBk(true);
  };
  var doChangeBk = function () {
    if (!cbPick || cbBusy) return;
    var oldName = cbOldName;
    var newName = cbNewName;
    setCbBusy(true);
    TK_api.changeBookkeeper(id, cbPick, cbMove).then(
      function (res) {
        setCbBusy(false);
        closeChangeBk(false);
        TK_toast(TK_bkSuccessText(res, oldName, newName));
        setRv(function (x) { return x + 1; });
        try {
          window.dispatchEvent(new CustomEvent("mgb:tk-team-assigned", { detail: { clientId: id } }));
        } catch (e) {}
        if (typeof props.onTeamChanged === "function") props.onTeamChanged();
      },
      function (err) {
        setCbBusy(false);
        TK_toast(
          TK_bkErrorText(err) ||
            (typeof TK_vErrText === "function" ? TK_vErrText(err) : "Couldn't change the bookkeeper. Try again."),
        );
        if (TK_bkErrorReloads(err)) {
          closeChangeBk(false);
          setRv(function (x) { return x + 1; });
        } else {
          setCbConfirm(false);
        }
      },
    );
  };

  return (
    <header className="tk-head tk-client-head">
      <div className="tk-head-row">
        <div className="tk-head-title">
          <h2 className="tk-head-name">{name}</h2>
          {qbo ? <span className={"pill " + (qboOn ? "good" : "neutral")} data-tour="tk-ch-qbo">{qboOn ? "QuickBooks connected" : "QuickBooks not connected"}</span> : null}
          {typeof TK_HoursChip === "function" && id ? <TK_HoursChip clientId={id} /> : null}
        </div>
        <div className="tk-head-actions" data-tour="tk-ch-links">
          <a className="tk-link-btn" href={"#/client/" + enc + "/overview"}>
            Open client
          </a>
          <a className="tk-link-btn" href={"#/client/" + enc + "/sop"}>
            SOP
          </a>
          {typeof TK_CFHeaderButton === "function" && id ? <TK_CFHeaderButton scope="client" target={id} canManage={isAdmin} listName={name} /> : null}
          {driveReady ? (
            <a
              className="tk-link-btn"
              href={"https://drive.google.com/drive/folders/" + encodeURIComponent(folder)}
              target="_blank"
              rel="noopener noreferrer"
            >
              <TK_vIcon name="folder" size={15} />
              <span>Open Drive folder</span>
            </a>
          ) : (
            <button type="button" className="tk-link-btn" disabled aria-disabled="true" title={TK_vCopy("driveOff")}>
              <TK_vIcon name="folder" size={15} />
              <span>Open Drive folder</span>
            </button>
          )}
          {header ? (
            <span className="tk-pop-wrap">
              <button
                type="button"
                ref={btnRef}
                className="tk-link-btn"
                aria-haspopup="dialog"
                aria-expanded={contactsOpen ? "true" : "false"}
                onClick={function () {
                  setContactsOpen(!contactsOpen);
                }}
              >
                <TK_vIcon name="people" size={15} />
                <span>{"Contacts" + (contacts.length ? " (" + contacts.length + ")" : "")}</span>
              </button>
              {contactsOpen && !phone ? (
                <div className="tk-popover tk-contacts-pop" role="dialog" aria-label="Contacts" ref={popRef}>
                  <TK_vContactsList contacts={contacts} />
                </div>
              ) : null}
            </span>
          ) : null}
          {canAssignTeam && !assignOpen ? (
            <button
              type="button"
              className="tk-tool-btn is-primary"
              data-tour="tk-assign-team"
              onClick={function () {
                setAssignOpen(true);
              }}
            >
              <TK_vIcon name="people" size={15} />
              <span>Assign team</span>
            </button>
          ) : null}
          {typeof TK_NewProjectModal === "function" ? (
            <button
              type="button"
              className="tk-link-btn"
              onClick={function () {
                setNewOnboarding(true);
              }}
            >
              <TK_vIcon name="plus" size={15} />
              <span>New onboarding project</span>
            </button>
          ) : null}
        </div>
      </div>
      {canAssignTeam && assignOpen ? (
        <div className="tk-assign-team" role="group" aria-label="Assign team">
          <label className="tk-select-wrap">
            <span className="tk-field-label">Bookkeeper</span>
            <select
              className="tk-select"
              value={assignPick}
              disabled={assignBusy}
              onChange={function (e) {
                setAssignPick(e.target.value);
              }}
            >
              <option value="">{allStaff == null ? "Loading…" : "Pick someone"}</option>
              {activeStaff.map(function (x) {
                var em = String(x.email).toLowerCase();
                return (
                  <option key={em} value={em}>
                    {x.name || em}
                  </option>
                );
              })}
            </select>
          </label>
          <button type="button" className="btn-primary" disabled={!assignPick || assignBusy} onClick={doAssignTeam}>
            {assignBusy ? "Assigning…" : "Assign"}
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={assignBusy}
            onClick={function () {
              setAssignOpen(false);
              setAssignPick("");
            }}
          >
            Cancel
          </button>
          <span className="tk-field-help">They become the bookkeeper and get this client's imported tasks that nobody is on yet. No email is sent.</span>
        </div>
      ) : null}
      {chips.length ? (
        <div className="tk-people" aria-label="People on this client" data-tour="tk-ch-people">
          {chips.map(function (c) {
            if (c.key === "bookkeeper" && canChangeBk) {
              return (
                <button
                  key={c.key}
                  type="button"
                  ref={cbChipRef}
                  className="tk-chip tk-chip-btn"
                  aria-expanded={cbOpen ? "true" : "false"}
                  aria-controls="tk-change-bk"
                  aria-label={"Change bookkeeper, now " + c.name}
                  title="Change bookkeeper"
                  disabled={cbBusy}
                  onKeyDown={onChangeBkKey}
                  onClick={function () {
                    if (cbOpen) closeChangeBk(false);
                    else setCbOpen(true);
                  }}
                >
                  <TK_vAvatar name={c.name} size="sm" decorative />
                  <span className="tk-chip-role">{c.label}</span>
                  <span className="tk-chip-name">{c.name}</span>
                  <TK_vIcon name="down" size={13} />
                </button>
              );
            }
            return (
              <span key={c.key} className="tk-chip">
                <TK_vAvatar name={c.name} size="sm" decorative />
                <span className="tk-chip-role">{c.label}</span>
                <span className="tk-chip-name">{c.name}</span>
              </span>
            );
          })}
        </div>
      ) : null}
      {canChangeBk && cbOpen ? (
        <div id="tk-change-bk" className="tk-assign-team tk-change-bk" role="group" aria-label="Change bookkeeper" onKeyDown={onChangeBkKey}>
          {!cbConfirm ? (
            <React.Fragment>
              <label className="tk-select-wrap">
                <span className="tk-field-label">New bookkeeper</span>
                <select
                  ref={cbSelectRef}
                  className="tk-select"
                  value={cbPick}
                  disabled={cbBusy}
                  onChange={function (e) {
                    setCbPick(e.target.value);
                  }}
                >
                  <option value="">{allStaff == null ? "Loading…" : "Pick someone"}</option>
                  {cbChoices.map(function (x) {
                    var em = String(x.email).toLowerCase();
                    return (
                      <option key={em} value={em}>
                        {x.name || em}
                      </option>
                    );
                  })}
                </select>
              </label>
              <label className="tk-ask-check tk-change-bk-move">
                <input
                  type="checkbox"
                  checked={cbMove}
                  disabled={cbBusy}
                  onChange={function (e) {
                    setCbMove(!!e.target.checked);
                  }}
                />
                <span>{TK_bkMoveLabel(cbOldName, cbPick ? cbNewName : "")}</span>
              </label>
              <button
                type="button"
                className="btn-primary"
                disabled={!cbPick || cbBusy}
                onClick={function () {
                  setCbConfirm(true);
                }}
              >
                Reassign
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={cbBusy}
                onClick={function () {
                  closeChangeBk(true);
                }}
              >
                Cancel
              </button>
              <span className="tk-field-help">{TK_bkHelpText(cbOldName)}</span>
            </React.Fragment>
          ) : (
            <React.Fragment>
              <p className="tk-change-bk-confirm" aria-live="polite">
                {TK_bkConfirmText(cbOldName, cbNewName, name, cbMove)}
              </p>
              <button type="button" ref={cbYesRef} className="btn-primary" disabled={cbBusy} onClick={doChangeBk}>
                {cbBusy ? "Reassigning…" : "Yes, reassign"}
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={cbBusy}
                onClick={function () {
                  setCbConfirm(false);
                }}
              >
                Back
              </button>
            </React.Fragment>
          )}
        </div>
      ) : null}
      {contactsOpen && phone ? (
        <TK_vModal
          onClose={function () {
            setContactsOpen(false);
          }}
          labelledBy="tk-contacts-title"
          className="tk-modal tk-sheet"
        >
          <div className="modal-header">
            <h3 className="card-title" id="tk-contacts-title" style={{ margin: 0 }}>
              Contacts
            </h3>
            <button
              type="button"
              className="modal-close"
              aria-label="Close"
              onClick={function () {
                setContactsOpen(false);
              }}
            >
              ×
            </button>
          </div>
          <div className="modal-body">
            <TK_vContactsList contacts={contacts} />
          </div>
        </TK_vModal>
      ) : null}
      {newOnboarding && typeof TK_NewProjectModal === "function" ? (
        <TK_NewProjectModal
          isAdmin={!!props.isAdmin}
          kind="onboarding"
          clientId={id}
          clientName={name}
          staffUser={props.staffUser}
          onClose={function () {
            setNewOnboarding(false);
          }}
          onCreated={function (p) {
            setNewOnboarding(false);
            if (p && p.id) TK_navigate({ view: "project", projectId: p.id });
          }}
        />
      ) : null}
    </header>
  );
}
