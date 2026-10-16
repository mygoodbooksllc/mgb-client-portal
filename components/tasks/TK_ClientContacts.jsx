// Tasks Phase 2, S6: client contacts (spec C6, section H "Client profile:
// contacts"). People at a client who answer requests by emailed link and
// have no portal login (a treasurer, a pastor). Shown in the client tasks
// drawer (TK_ClientDrawer) for staff with access to the client.
//
// Writes go through RPCs only (tasks-p2-5-requests.sql):
//   tk_save_client_contact   add or edit (turning off "Can answer" revokes
//                            that contact's open links)
//   tk_retire_client_contact remove (soft delete; revokes open links)
// Reads: tk_request_recipients(p_client_id).contacts.
//
// Loaded after TK_AskClientModal.jsx (TK_crToast, TK_crFail, TK_crTrack) in
// the shared global scope: every top-level name has a TK_cc prefix.

var TK_CC_ROLES = [
  ["treasurer", "Treasurer"],
  ["pastor", "Pastor"],
  ["board", "Board"],
  ["finance", "Finance"],
  ["other", "Other"],
];

function TK_ccRoleLabel(role) {
  for (var i = 0; i < TK_CC_ROLES.length; i++) if (TK_CC_ROLES[i][0] === role) return TK_CC_ROLES[i][1];
  return "";
}

function TK_ccForm(props) {
  var p = props;
  var c = p.contact || {};
  var fPair = React.useState({
    name: c.name || "",
    email: c.email || "",
    role: c.role || "treasurer",
    can_answer: c.can_answer !== false,
    notes: c.notes || "",
  });
  var f = fPair[0];
  var busyPair = React.useState(false);
  var set = function (k, v) {
    fPair[1](function (cur) {
      var n = Object.assign({}, cur);
      n[k] = v;
      return n;
    });
  };
  var save = function (e) {
    if (e) e.preventDefault();
    if (busyPair[0]) return;
    busyPair[1](true);
    TK_api.saveClientContact(c.id || null, p.clientId, f).then(
      function () {
        busyPair[1](false);
        TK_crTrack(c.id ? "tasks-contact-edited" : "tasks-contact-added", {});
        TK_crToast(c.id ? "Contact saved" : "Contact added");
        p.onDone();
      },
      function (err) {
        busyPair[1](false);
        TK_crFail(err);
      },
    );
  };
  return (
    <form className="tk-cc-form" onSubmit={save}>
      <input className="tk-dw-input" aria-label="Contact name" placeholder="Name" maxLength={120} required
        value={f.name} onChange={function (e) { set("name", e.target.value); }} />
      <input className="tk-dw-input" aria-label="Contact email" placeholder="Email" type="email" maxLength={254} required
        value={f.email} onChange={function (e) { set("email", e.target.value); }} />
      <select className="tk-dw-select" aria-label="Role" value={f.role} onChange={function (e) { set("role", e.target.value); }}>
        {TK_CC_ROLES.map(function (r) {
          return <option key={r[0]} value={r[0]}>{r[1]}</option>;
        })}
      </select>
      <input className="tk-dw-input" aria-label="Notes" placeholder="Notes (optional)" maxLength={500}
        value={f.notes} onChange={function (e) { set("notes", e.target.value); }} />
      <label className="tk-cc-check">
        <input type="checkbox" checked={f.can_answer} onChange={function (e) { set("can_answer", e.target.checked); }} />
        Can answer requests by email link
      </label>
      <div className="tk-cc-actions">
        <button type="submit" className="btn-secondary tk-dw-btn-sm" disabled={busyPair[0]}>
          {busyPair[0] ? "Saving…" : "Save"}
        </button>
        <button type="button" className="link-btn" onClick={p.onDone}>Cancel</button>
      </div>
    </form>
  );
}

function TK_ClientContacts(props) {
  var p = props;
  var clientId = p.clientId;
  var openPair = React.useState(false);
  var listPair = React.useState({ loaded: false, contacts: [], error: false });
  var editPair = React.useState(null); // contact id, "new" or null
  var load = React.useCallback(function () {
    if (!clientId) return;
    TK_api.requestRecipients(clientId).then(
      function (r) {
        listPair[1]({ loaded: true, contacts: (r && r.contacts) || [], error: false });
      },
      function () {
        listPair[1]({ loaded: true, contacts: [], error: true });
      },
    );
  }, [clientId]);
  React.useEffect(function () {
    listPair[1]({ loaded: false, contacts: [], error: false });
    editPair[1](null);
    if (openPair[0]) load();
  }, [clientId]);
  React.useEffect(function () {
    if (openPair[0] && !listPair[0].loaded) load();
  }, [openPair[0]]);
  if (!clientId) return null;

  var list = listPair[0];
  var done = function () {
    editPair[1](null);
    load();
  };
  var retire = function (c) {
    if (!window.confirm("Remove " + (c.name || c.email) + "? Their open request links stop working.")) return;
    TK_api.retireClientContact(c.id).then(
      function () {
        TK_crTrack("tasks-contact-removed", {});
        TK_crToast("Contact removed");
        load();
      },
      TK_crFail,
    );
  };

  return (
    <section className="tk-cd-group tk-cc" data-tour="tk-contacts">
      <h3 className="tk-cd-group-head">
        <button type="button" className="tk-cc-toggle" aria-expanded={openPair[0]}
          onClick={function () { openPair[1](!openPair[0]); }}>
          <span>Client contacts</span>
          {list.loaded ? <span className="tk-cd-group-n">{list.contacts.length}</span> : null}
          <span className="tk-cc-caret" aria-hidden="true">{openPair[0] ? "▾" : "▸"}</span>
        </button>
      </h3>
      {openPair[0] ? (
        <div className="tk-cc-body">
          <p className="tk-cc-help">People without a portal login who answer requests by emailed link.</p>
          {!list.loaded ? <p className="tk-dw-muted">Loading…</p> : null}
          {list.error ? <p className="tk-dw-muted">Couldn't load contacts.</p> : null}
          {list.loaded && !list.error && !list.contacts.length && editPair[0] !== "new" ? (
            <p className="tk-dw-muted">No contacts yet.</p>
          ) : null}
          <ul className="tk-cc-list">
            {list.contacts.map(function (c) {
              if (editPair[0] === c.id) {
                return (
                  <li key={c.id} className="tk-cc-row">
                    <TK_ccForm clientId={clientId} contact={c} onDone={done} />
                  </li>
                );
              }
              return (
                <li key={c.id} className="tk-cc-row">
                  <div className="tk-cc-main">
                    <span className="tk-cc-name">{c.name}</span>
                    <span className="tk-cc-meta">
                      {c.email}
                      {c.role ? " · " + TK_ccRoleLabel(c.role) : ""}
                      {c.can_answer ? "" : " · can't answer"}
                    </span>
                    {c.notes ? <span className="tk-cc-meta">{c.notes}</span> : null}
                  </div>
                  {p.online === false ? null : (
                    <span className="tk-cc-btns">
                      <button type="button" className="link-btn" onClick={function () { editPair[1](c.id); }}>Edit</button>
                      <button type="button" className="link-btn" onClick={function () { retire(c); }}>Remove</button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          {editPair[0] === "new" ? (
            <TK_ccForm clientId={clientId} contact={null} onDone={done} />
          ) : p.online === false ? null : (
            <button type="button" className="link-btn" onClick={function () { editPair[1]("new"); }}>+ Add contact</button>
          )}
        </div>
      ) : null}
    </section>
  );
}
