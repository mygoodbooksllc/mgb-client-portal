// ----------------------------------------------------------------------------
// TK_AskClientModal.jsx — Ask client (Tasks Phase 2, S5).
//
// TK_AskClientModal({ clientId, clientName, taskId, again, onClose, onAsked })
//   Kind, title, message, needs upload, due date and who to ask: the client's
//   portal users and contacts (client_contacts), with "Add contact" inline.
//   Asking (rpc tk_ask_client) puts the task in Waiting on client. Then it
//   "sends" with tk_client_request_send, which is a dry run until S6: nothing
//   is emailed and the toast says so.
//
// TK_dwRequests({ task, canEdit, isAdmin, nameOf })
//   The drawer's "Client requests" section: each request with its status
//   chip, who was asked, the answer, files, and the actions the server allows
//   (TK_requestActions): Email again (dry run), Reminder (dry run), Record
//   answer, Accept, Cancel, Pause or Resume reminders, Turn off links.
//
// Every write is an RPC; the server decides who may call it. Older document
// requests (legacy) show read-only here and stay in the Documents panel.
// ----------------------------------------------------------------------------

function TK_crToast(text) {
  if (typeof TK_toast === "function") TK_toast(text);
}

function TK_crFail(e) {
  TK_crToast(typeof TK_requestErrorText === "function" ? TK_requestErrorText(e) : "That didn't work. Try again.");
}

function TK_crTrack(name, detail) {
  try {
    if (typeof trackEvent === "function") trackEvent(name, detail || {});
  } catch (e) {}
}

function TK_crToday() {
  return typeof TK_dwToday === "function" ? TK_dwToday() : new Date().toISOString().slice(0, 10);
}

function TK_crDate(iso) {
  if (!iso) return "";
  try {
    var d = new Date(String(iso).length === 10 ? iso + "T12:00:00" : iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch (e) {
    return String(iso).slice(0, 10);
  }
}

// Inline "Add contact" (client_contacts via tk_save_client_contact).
function TK_crAddContact(props) {
  var p = props;
  var namePair = React.useState("");
  var emailPair = React.useState("");
  var rolePair = React.useState("treasurer");
  var busyPair = React.useState(false);
  var save = function () {
    if (busyPair[0]) return;
    busyPair[1](true);
    TK_api.saveClientContact(null, p.clientId, { name: namePair[0], email: emailPair[0], role: rolePair[0] }).then(
      function (id) {
        busyPair[1](false);
        TK_crTrack("tasks-contact-added", {});
        p.onSaved(id);
      },
      function (e) {
        busyPair[1](false);
        TK_crFail(e);
      },
    );
  };
  return (
    <div className="tk-cr-addcontact">
      <input className="tk-dw-input" aria-label="Contact name" placeholder="Name" maxLength={120}
        value={namePair[0]} onChange={function (e) { namePair[1](e.target.value); }} />
      <input className="tk-dw-input" aria-label="Contact email" placeholder="Email" type="email" maxLength={254}
        value={emailPair[0]} onChange={function (e) { emailPair[1](e.target.value); }} />
      <select className="tk-dw-select" aria-label="Role" value={rolePair[0]} onChange={function (e) { rolePair[1](e.target.value); }}>
        <option value="treasurer">Treasurer</option>
        <option value="pastor">Pastor</option>
        <option value="board">Board</option>
        <option value="finance">Finance</option>
        <option value="other">Other</option>
      </select>
      <button type="button" className="btn-secondary tk-dw-btn-sm" disabled={busyPair[0]} onClick={save}>Save contact</button>
      <button type="button" className="link-btn" onClick={p.onCancel}>Cancel</button>
    </div>
  );
}

function TK_AskClientModal(props) {
  var p = props;
  var again = p.again || null;
  var formPair = React.useState({
    kind: (again && again.kind) || "question",
    title: (again && again.title) || "",
    prompt: (again && again.prompt) || "",
    needsUpload: !!(again && again.needs_upload),
    dueDate: "",
    emails: [],
    contactIds: [],
  });
  var form = formPair[0];
  var setForm = formPair[1];
  var peoplePair = React.useState(null);
  var people = peoplePair[0];
  var setPeople = peoplePair[1];
  var triedPair = React.useState(false);
  var busyPair = React.useState(false);
  var addingPair = React.useState(false);
  var sendNowPair = React.useState(true);

  var loadPeople = function (pickId) {
    TK_api.requestRecipients(p.clientId).then(
      function (r) {
        setPeople(r || { portal: [], contacts: [] });
        if (pickId) setForm(function (f) { return Object.assign({}, f, { contactIds: f.contactIds.concat([pickId]) }); });
      },
      function (e) {
        setPeople({ portal: [], contacts: [], error: true });
        TK_crFail(e);
      },
    );
  };
  React.useEffect(function () { loadPeople(null); }, [p.clientId]);

  if (typeof ModalShell !== "function") return null;
  var set = function (k, v) { setForm(function (f) { var o = Object.assign({}, f); o[k] = v; return o; }); };
  var toggle = function (k, v) {
    setForm(function (f) {
      var list = f[k].slice();
      var i = list.indexOf(v);
      if (i >= 0) list.splice(i, 1);
      else list.push(v);
      var o = Object.assign({}, f);
      o[k] = list;
      return o;
    });
  };
  var errors = typeof TK_askFormErrors === "function" ? TK_askFormErrors(form, TK_crToday()) : {};
  var hasErr = Object.keys(errors).length > 0;
  var tried = triedPair[0];

  var submit = function () {
    if (hasErr) { triedPair[1](true); return; }
    if (busyPair[0]) return;
    busyPair[1](true);
    TK_api.askClient({
      clientId: p.clientId, taskId: p.taskId || null, title: form.title.trim(), prompt: form.prompt.trim(), kind: form.kind,
      needsUpload: form.kind === "document" ? true : form.needsUpload, dueDate: form.dueDate || null,
      emails: form.emails, contactIds: form.contactIds,
    }).then(
      function (id) {
        TK_crTrack("tasks-ask-client", { kind: form.kind, recipients: form.emails.length + form.contactIds.length, again: !!again });
        if (!sendNowPair[0]) {
          busyPair[1](false);
          TK_crToast("Asked. The task is waiting on the client. Nothing was emailed.");
          if (p.onAsked) p.onAsked(id);
          return;
        }
        TK_api.sendClientRequest(id, "send", p.taskId).then(
          function (res) {
            busyPair[1](false);
            TK_crToast("Asked. " + TK_sendResultText(res, "send"));
            if (p.onAsked) p.onAsked(id);
          },
          function (e) {
            busyPair[1](false);
            // The request exists; only the (dry-run) send was refused.
            TK_crToast("Asked. The task is waiting on the client. " + TK_requestErrorText(e));
            if (p.onAsked) p.onAsked(id);
          },
        );
      },
      function (e) {
        busyPair[1](false);
        TK_crFail(e);
      },
    );
  };

  var errLine = function (k) {
    return tried && errors[k] ? <p className="tk-dw-hint tk-field-error" role="alert">{errors[k]}</p> : null;
  };
  var portal = (people && people.portal) || [];
  var contacts = ((people && people.contacts) || []).filter(function (c) { return c.can_answer; });

  return TK_dwPortal(
    <ModalShell onClose={p.onClose} labelledBy="tk-ask-title" className="tk-dw-modal tk-ask-modal">
      <div className="modal-header">
        <h3 className="card-title" id="tk-ask-title" style={{ margin: 0 }}>
          {again ? "Ask again" : "Ask client"}
          {p.clientName ? <span className="tk-ask-client">{" · " + p.clientName}</span> : null}
        </h3>
        <button type="button" className="modal-close" onClick={p.onClose} aria-label="Close">×</button>
      </div>
      <div className="modal-body tk-ask-body">
        <fieldset className="tk-ask-kinds">
          <legend className="tk-dw-label">What do you need?</legend>
          {TK_REQUEST_KINDS.map(function (k) {
            return (
              <label key={k.key} className={"tk-ask-kind" + (form.kind === k.key ? " is-on" : "")}>
                <input type="radio" name="tk-ask-kind" value={k.key} checked={form.kind === k.key}
                  onChange={function () { set("kind", k.key); }} />
                <span className="tk-ask-kind-name">{k.label}</span>
                <span className="tk-ask-kind-hint">{k.hint}</span>
              </label>
            );
          })}
        </fieldset>

        <label className="tk-dw-label" htmlFor="tk-ask-t">Title</label>
        <input id="tk-ask-t" className="tk-dw-input" maxLength={200} value={form.title}
          placeholder="September bank statement" onChange={function (e) { set("title", e.target.value); }} />
        {errLine("title")}

        <label className="tk-dw-label" htmlFor="tk-ask-p">Message</label>
        <textarea id="tk-ask-p" className="tk-dw-textarea" rows={4} maxLength={2000} value={form.prompt}
          placeholder="What you need, in plain words. They see this in the email and on the page."
          onChange={function (e) { set("prompt", e.target.value); }} />
        {errLine("prompt")}

        <div className="tk-ask-row">
          {form.kind !== "document" && (
            <label className="tk-ask-check">
              <input type="checkbox" checked={form.needsUpload} onChange={function (e) { set("needsUpload", e.target.checked); }} />
              They should upload a file too
            </label>
          )}
          <label className="tk-ask-due">
            <span>Needed by (optional)</span>
            <input type="date" className="tk-dw-input" value={form.dueDate} min={TK_crToday()}
              onChange={function (e) { set("dueDate", e.target.value); }} />
          </label>
        </div>
        {errLine("dueDate")}

        <fieldset className="tk-ask-people" data-tour="tk-ask-people">
          <legend className="tk-dw-label">Who should answer?</legend>
          {!people ? <p className="tk-dw-muted">Loading people…</p> : null}
          {people && !portal.length && !contacts.length ? (
            <p className="tk-dw-muted">This client has no portal users or contacts yet. Add a contact below.</p>
          ) : null}
          {portal.map(function (u) {
            return (
              <label key={"u:" + u.email} className="tk-ask-person">
                <input type="checkbox" checked={form.emails.indexOf(u.email) >= 0} onChange={function () { toggle("emails", u.email); }} />
                <span className="tk-ask-person-name">{u.name || u.email}</span>
                <span className="tk-ask-person-note">{"Portal user" + (u.opted_out ? " · turned off client emails" : "")}</span>
              </label>
            );
          })}
          {contacts.map(function (c) {
            return (
              <label key={"c:" + c.id} className="tk-ask-person">
                <input type="checkbox" checked={form.contactIds.indexOf(c.id) >= 0} onChange={function () { toggle("contactIds", c.id); }} />
                <span className="tk-ask-person-name">{c.name}</span>
                <span className="tk-ask-person-note">{"Contact" + (c.role ? " · " + c.role : "") + " · answers by link"}</span>
              </label>
            );
          })}
          {addingPair[0] ? (
            <TK_crAddContact clientId={p.clientId}
              onCancel={function () { addingPair[1](false); }}
              onSaved={function (id) { addingPair[1](false); loadPeople(id); }} />
          ) : (
            <button type="button" className="link-btn tk-ask-addbtn" onClick={function () { addingPair[1](true); }}>+ Add contact</button>
          )}
          {errLine("recipients")}
        </fieldset>

        <label className="tk-ask-check">
          <input type="checkbox" checked={sendNowPair[0]} onChange={function (e) { sendNowPair[1](e.target.checked); }} />
          Email them now
        </label>
        <p className="tk-dw-hint">
          Client emails for requests aren't switched on yet, so this is a dry run: nothing is sent, and the request is logged as if it had been.
        </p>
      </div>
      <div className="modal-footer">
        <button type="button" className="btn-secondary" onClick={p.onClose}>Cancel</button>
        <button type="button" className="btn-primary" disabled={busyPair[0]} onClick={submit}>
          {busyPair[0] ? "Asking…" : "Ask"}
        </button>
      </div>
    </ModalShell>,
  );
}

// Record an answer that came by phone or email.
function TK_crRecordModal(props) {
  var p = props;
  var pair = React.useState("");
  if (typeof ModalShell !== "function") return null;
  return TK_dwPortal(
    <ModalShell onClose={p.onCancel} labelledBy="tk-cr-rec-title" className="tk-dw-modal">
      <div className="modal-header">
        <h3 className="card-title" id="tk-cr-rec-title" style={{ margin: 0 }}>Record their answer</h3>
        <button type="button" className="modal-close" onClick={p.onCancel} aria-label="Close">×</button>
      </div>
      <div className="modal-body">
        <label className="tk-dw-label" htmlFor="tk-cr-rec">What did they say?</label>
        <textarea id="tk-cr-rec" className="tk-dw-textarea" rows={4} maxLength={4000} value={pair[0]}
          onChange={function (e) { pair[1](e.target.value); }} />
        <p className="tk-dw-hint">For an answer that came by phone or email. It closes the request and goes on the task.</p>
      </div>
      <div className="modal-footer">
        <button type="button" className="btn-secondary" onClick={p.onCancel}>Cancel</button>
        <button type="button" className="btn-primary" disabled={!pair[0].trim()} onClick={function () { p.onConfirm(pair[0].trim()); }}>
          Save answer
        </button>
      </div>
    </ModalShell>,
  );
}

function TK_crCancelModal(props) {
  var p = props;
  var pair = React.useState("");
  if (typeof ModalShell !== "function") return null;
  return TK_dwPortal(
    <ModalShell onClose={p.onCancel} labelledBy="tk-cr-cx-title" className="tk-dw-modal">
      <div className="modal-header">
        <h3 className="card-title" id="tk-cr-cx-title" style={{ margin: 0 }}>Cancel this request?</h3>
        <button type="button" className="modal-close" onClick={p.onCancel} aria-label="Close">×</button>
      </div>
      <div className="modal-body">
        <label className="tk-dw-label" htmlFor="tk-cr-cx">Why (optional)</label>
        <input id="tk-cr-cx" className="tk-dw-input" maxLength={500} value={pair[0]} onChange={function (e) { pair[1](e.target.value); }} />
        <p className="tk-dw-hint">Its answer links stop working. When it's the last open request, the task goes back to where it was.</p>
      </div>
      <div className="modal-footer">
        <button type="button" className="btn-secondary" onClick={p.onCancel}>Keep it</button>
        <button type="button" className="btn-primary" onClick={function () { p.onConfirm(pair[0].trim()); }}>Cancel request</button>
      </div>
    </ModalShell>,
  );
}

function TK_crRow(props) {
  var p = props;
  var r = p.req;
  var chip = TK_requestChip(r);
  var acts = TK_requestActions(r, { canEdit: p.canEdit });
  var taskId = p.taskId;
  var who = (r.recipients || []).map(function (x) {
    return (x.name || x.email) + (x.type === "contact" ? " (contact" + (x.retired ? ", removed" : "") + ")" : "");
  }).join(", ");
  var answeredBy = r.answered_by ? (TK_requestAuthorLabel(r.answered_via === "portal" ? "client:" + r.answered_by : r.answered_by, {}) || p.nameOf(r.answered_by)) : "";
  var meta = [];
  meta.push("Asked " + TK_crDate(r.asked_at) + " by " + p.nameOf(r.asked_by));
  if (r.status === "open") {
    meta.push(TK_waitingLabel(r.business_days_waiting));
    if (r.nudge_count) meta.push(r.nudge_count + (r.nudge_count === 1 ? " reminder" : " reminders"));
    if (r.nudge_paused) meta.push("Reminders paused");
    if (r.links && r.links.live) meta.push(r.links.live + (r.links.live === 1 ? " live link" : " live links"));
    if (r.links && r.links.viewed_at) meta.push("Opened " + TK_crDate(r.links.viewed_at));
  }
  if (r.due_date) meta.push("Needed by " + TK_crDate(r.due_date));
  var act = function (fn, done) {
    return function () {
      fn().then(function (res) { if (done) done(res); p.onChanged(); }, TK_crFail);
    };
  };
  var send = function (action) {
    return act(function () { return TK_api.sendClientRequest(r.id, action, taskId); }, function (res) {
      TK_crToast(TK_sendResultText(res, action));
    });
  };
  return (
    <li className={"tk-cr-item is-" + r.status}>
      <div className="tk-cr-top">
        <span className={"tk-cr-chip tone-" + chip.tone}>{chip.label}</span>
        <span className="tk-cr-kind">{(TK_REQUEST_KINDS.filter(function (k) { return k.key === r.kind; })[0] || {}).label || r.kind}</span>
        <strong className="tk-cr-title">{r.title}</strong>
        {r.legacy ? <span className="tk-cr-legacy">Documents panel</span> : null}
      </div>
      <p className="tk-cr-prompt">{r.prompt}</p>
      {who ? <p className="tk-cr-who">{"Asked: " + who}</p> : null}
      <p className="tk-cr-meta">{meta.join(" · ")}</p>
      {r.reply || (r.files && r.files.length) ? (
        <div className="tk-cr-answer">
          <span className="tk-cr-answer-by">{answeredBy ? answeredBy + " answered" : "Answer"}{r.answered_at ? " · " + TK_crDate(r.answered_at) : ""}</span>
          {r.reply ? <p>{r.reply}</p> : null}
          {(r.files || []).length ? <p className="tk-cr-files">{r.files.map(function (f) { return f.name; }).join(", ")}</p> : null}
        </div>
      ) : null}
      {r.status === "cancelled" && r.cancel_reason ? <p className="tk-cr-meta">{"Cancelled: " + r.cancel_reason}</p> : null}
      <div className="tk-cr-actions">
        {acts.accept && <button type="button" className="btn-primary tk-dw-btn-sm" onClick={act(function () { return TK_api.acceptClientRequest(r.id, taskId); })}>Accept</button>}
        {acts.askAgain && <button type="button" className="btn-secondary tk-dw-btn-sm" onClick={function () { p.onAskAgain(r); }}>Ask again</button>}
        {acts.record && <button type="button" className="btn-secondary tk-dw-btn-sm" onClick={function () { p.onModal({ kind: "record", req: r }); }}>Record answer</button>}
        {acts.send && <button type="button" className="btn-secondary tk-dw-btn-sm" onClick={send("resend")}>Email again</button>}
        {acts.nudge && <button type="button" className="btn-secondary tk-dw-btn-sm" onClick={send("nudge")}>Send reminder</button>}
        {acts.pause && <button type="button" className="link-btn" onClick={act(function () { return TK_api.setRequestNudgePaused(r.id, true, taskId); })}>Pause reminders</button>}
        {acts.resume && <button type="button" className="link-btn" onClick={act(function () { return TK_api.setRequestNudgePaused(r.id, false, taskId); })}>Resume reminders</button>}
        {acts.revoke && <button type="button" className="link-btn" onClick={act(function () { return TK_api.revokeRequestLinks(r.id, taskId); }, function () { TK_crToast("Answer links turned off."); })}>Turn off links</button>}
        {acts.cancel && <button type="button" className="link-btn tk-cr-cancel" onClick={function () { p.onModal({ kind: "cancel", req: r }); }}>Cancel</button>}
      </div>
    </li>
  );
}

function TK_dwRequests(props) {
  var p = props;
  var task = p.task;
  var nameOf = p.nameOf || function (e) { return e; };
  var stamp = String(task.status) + "|" + String(task.updated_at || "");
  var rows = TK_dwUseRows("requests", task.id, function () {
    if (typeof TK_api === "undefined" || !TK_api || typeof TK_api.listClientRequests !== "function") return Promise.resolve([]);
    return TK_api.listClientRequests(task.id, null);
  }, { stamp: stamp, tables: ["client_requests"] });
  var modalPair = React.useState(null);
  var modal = modalPair[0];
  var setModal = modalPair[1];
  React.useEffect(function () {
    var on = function (e) {
      var d = (e && e.detail) || {};
      if (!d.taskId || String(d.taskId) === String(task.id)) rows.reload();
    };
    window.addEventListener("mgb:tk-requests-changed", on);
    return function () { window.removeEventListener("mgb:tk-requests-changed", on); };
  }, [task.id]);

  var can = typeof TK_canAskClient === "function" ? TK_canAskClient(task) : { ok: true };
  var list = rows.rows || [];
  var open = list.filter(function (r) { return r.status === "open" && !r.legacy; }).length;
  var clientName = p.clientName || "";

  return (
    <section className="tk-dw-section tk-rq" aria-labelledby="tk-dw-cr-h" data-tour="tk-ask-client">
      <h3 className="tk-dw-h" id="tk-dw-cr-h">
        Client requests
        {open ? <span className="tk-dw-count">{open + " open"}</span> : null}
      </h3>
      {rows.loading && !list.length ? <p className="tk-dw-muted">Loading…</p> : null}
      {rows.error && !list.length ? <p className="tk-dw-muted">Requests didn't load.</p> : null}
      {list.length ? (
        <ul className="tk-cr-list">
          {list.map(function (r) {
            return (
              <TK_crRow key={r.id} req={r} taskId={task.id} canEdit={p.canEdit} nameOf={nameOf}
                onChanged={rows.reload}
                onModal={setModal}
                onAskAgain={function (req) { setModal({ kind: "ask", again: req }); }} />
            );
          })}
        </ul>
      ) : !rows.loading && !rows.error ? (
        <p className="tk-dw-muted">Need something from the client? Ask them here and this task waits until they answer.</p>
      ) : null}
      {p.canEdit && (
        <button type="button" className="btn-secondary tk-dw-btn-sm tk-cr-ask" disabled={!can.ok} title={can.ok ? "" : can.why}
          onClick={function () { setModal({ kind: "ask" }); }}>
          Ask client
        </button>
      )}
      {p.canEdit && !can.ok ? <p className="tk-dw-hint">{can.why}</p> : null}
      {modal && modal.kind === "ask" && (
        <TK_AskClientModal clientId={task.client_id} clientName={clientName} taskId={task.id} again={modal.again || null}
          onClose={function () { setModal(null); }}
          onAsked={function () { setModal(null); rows.reload(); }} />
      )}
      {modal && modal.kind === "record" && (
        <TK_crRecordModal onCancel={function () { setModal(null); }}
          onConfirm={function (text) {
            var r = modal.req;
            setModal(null);
            TK_api.recordClientAnswer(r.id, text, task.id).then(function () { TK_crToast("Answer saved."); rows.reload(); }, TK_crFail);
          }} />
      )}
      {modal && modal.kind === "cancel" && (
        <TK_crCancelModal onCancel={function () { setModal(null); }}
          onConfirm={function (reason) {
            var r = modal.req;
            setModal(null);
            TK_api.cancelClientRequest(r.id, reason, task.id).then(function () { TK_crToast("Request cancelled."); rows.reload(); }, TK_crFail);
          }} />
      )}
    </section>
  );
}
