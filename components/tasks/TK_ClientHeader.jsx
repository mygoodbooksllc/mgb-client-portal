// ----------------------------------------------------------------------------
// TK_ClientHeader.jsx — the header on a client's task list (Row 1.2).
//
// TK_ClientHeader({ client, staffUser, isAdmin, compact })
//   name, "Open client" and "SOP" links, the QuickBooks pill (text only),
//   "Open Drive folder", "Contacts" (a popover; a sheet on phones), the People
//   chips (Bookkeeper, Backup, Account Manager) and "New onboarding project".
//
// Every piece comes from TK_api.clientHeader / clientPeople / DRV_status and
// renders nothing when its read fails, so a denied or broken read never
// breaks the list under it. Emails show only inside the contacts list, never
// in a URL.
// ----------------------------------------------------------------------------

var TK_vPEOPLE_ROLES = [
  { key: "bookkeeper", label: "Bookkeeper" },
  { key: "backup", label: "Backup" },
  { key: "account_manager", label: "Account Manager" },
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
  var phone = width <= 760;

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

  React.useEffect(
    function () {
      if (!id) return undefined;
      var live = true;
      setHeader(null);
      setPeople([]);
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
              if (live) setPeople(Array.isArray(rows) ? rows : []);
            },
            function () {
              if (live) setPeople([]);
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
    [id],
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
    return hit ? { key: r.key, label: r.label, name: hit.name || hit.email || "" } : null;
  }).filter(Boolean);

  return (
    <header className="tk-head tk-client-head">
      <div className="tk-head-row">
        <div className="tk-head-title">
          <h2 className="tk-head-name">{name}</h2>
          {qbo ? <span className={"pill " + (qboOn ? "good" : "neutral")}>{qboOn ? "QuickBooks connected" : "QuickBooks not connected"}</span> : null}
        </div>
        <div className="tk-head-actions">
          <a className="tk-link-btn" href={"#/client/" + enc + "/overview"}>
            Open client
          </a>
          <a className="tk-link-btn" href={"#/client/" + enc + "/sop"}>
            SOP
          </a>
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
      {chips.length ? (
        <div className="tk-people" aria-label="People on this client">
          {chips.map(function (c) {
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
