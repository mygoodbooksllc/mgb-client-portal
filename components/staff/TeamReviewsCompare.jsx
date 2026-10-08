// Team Reviews: the comparison screen for one review (TR_ComparePanel).
// Loaded after TeamReviews.jsx and shares its globals (TR_api, TR_Pill ...).
//
// Shows nothing score-related until the database says both forms are in
// (tr_get_review applies the blind rule). Then: scores side by side, both
// sets of comments, agreed action steps (structured rows), recipient
// comments, signatures (with the optional "I disagree" note), the PDF and
// Drive export, and the admin tools: reopen before anyone signs, close
// unsigned, addenda after it locks.

function TR_ComparePanel({ review, onChanged }) {
  const r = review;
  const toast = TR_useToastSafe();
  const [modal, setModal] = React.useState(null); // {type:"reopen"|"close", kind?}
  const rFirst = TR_first(r.reviewer && r.reviewer.name) || "Reviewer";
  const rPoss = TR_poss(r.reviewer && r.reviewer.name);
  const both = !!r.both_submitted;
  const isAdmin = !!r.viewer_is_admin;
  const live = r.status === "open" || r.status === "comparing";
  const changed = () => {
    TR_changed();
    onChanged && onChanged();
  };

  return (
    <div className="tr-compare">
      {!both ? (
        <div className="card">
          <h2 className="card-title">Comparison is locked</h2>
          <p className="card-subtitle">
            Scores stay hidden until both the self-review and {rPoss} review are submitted, so neither one is influenced by the other.
          </p>
          <div className="tr-problems">
            <TR_Pill tone={r.self.status === "submitted" ? "good" : "neutral"}>
              Self-review: {(TR_STATUS_PILL[r.self.status] || [r.self.status])[0]}
            </TR_Pill>
            <TR_Pill tone={r.manager.status === "submitted" ? "good" : "neutral"}>
              {rPoss} review: {(TR_STATUS_PILL[r.manager.status] || [r.manager.status])[0]}
            </TR_Pill>
          </div>
        </div>
      ) : (
        <TR_CompareBody review={r} onChanged={changed} />
      )}

      {(r.events || []).length > 0 && (
        <div className="card">
          <h2 className="card-title">History of changes</h2>
          <ul className="tr-log">
            {r.events.map((e, i) => (
              <li key={i}>
                <strong>{TR_EVENT_LABEL[e.kind] || e.kind}</strong>
                {e.submission_kind ? ` (${e.submission_kind === "self" ? "self-review" : rPoss + " review"})` : ""} ·{" "}
                {e.actor_name || "Admin"} · {TR_fmtDate(e.created_at, { month: "short", day: "numeric", year: "numeric" })}
                {e.reason ? "\n" + e.reason : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      {isAdmin && live && (
        <div className="card">
          <h2 className="card-title">Admin</h2>
          <p className="card-subtitle">
            {r.has_signatures
              ? "Someone has signed, so the forms can no longer be reopened. Once it locks, add corrections as an addendum."
              : "Reopen a submitted form to let its author change it. The comparison goes back to hidden until it is submitted again."}
          </p>
          <div className="tr-actions">
            {!r.has_signatures && r.self.status === "submitted" && (
              <button type="button" className="btn-secondary" onClick={() => setModal({ type: "reopen", kind: "self" })}>
                Reopen self-review
              </button>
            )}
            {!r.has_signatures && r.manager.status === "submitted" && (
              <button type="button" className="btn-secondary" onClick={() => setModal({ type: "reopen", kind: "manager" })}>
                Reopen {rPoss} review
              </button>
            )}
            <button type="button" className="btn-secondary" onClick={() => setModal({ type: "close" })}>
              Close unsigned
            </button>
          </div>
        </div>
      )}

      {modal && (
        <TR_ReasonModal
          title={
            modal.type === "close"
              ? `Close ${r.staff ? TR_poss(r.staff.name) : "this"} review unsigned?`
              : `Reopen the ${modal.kind === "self" ? "self-review" : rPoss + " review"}?`
          }
          intro={
            modal.type === "close"
              ? "It becomes read-only and is kept, unsigned. Open action steps carry forward to the next quarter."
              : `${modal.kind === "self" ? TR_first(r.staff && r.staff.name) : rFirst} gets an email with your reason and can edit and resubmit.`
          }
          confirmLabel={modal.type === "close" ? "Close unsigned" : "Reopen"}
          danger={modal.type === "close"}
          onClose={() => setModal(null)}
          onConfirm={async (reason) => {
            if (modal.type === "close") await TR_api.rpc("tr_close_review_unsigned", { p_review: r.id, p_reason: reason });
            else await TR_api.rpc("tr_reopen_submission", { p_review: r.id, p_kind: modal.kind, p_reason: reason });
            toast(modal.type === "close" ? "Review closed unsigned" : "Reopened");
            setModal(null);
            changed();
          }}
        />
      )}
    </div>
  );
}

const TR_EVENT_LABEL = { reopen: "Reopened", reassign: "Reviewer changed", close_unsigned: "Closed unsigned" };

function TR_ReasonModal({ title, intro, confirmLabel, danger, onClose, onConfirm }) {
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  return (
    <TR_Confirm
      title={title}
      confirmLabel={confirmLabel}
      danger={danger}
      busy={busy}
      canConfirm={!!reason.trim()}
      onClose={onClose}
      onConfirm={async () => {
        setBusy(true);
        setError("");
        try {
          await onConfirm(reason.trim());
        } catch (e) {
          setError(TR_errText(e));
          setBusy(false);
        }
      }}
    >
      <p>{intro}</p>
      <label className="tr-label" htmlFor="tr-reason">
        Reason (required)
      </label>
      <textarea id="tr-reason" className="tr-ta" value={reason} onChange={(e) => setReason(e.target.value)} />
      <TR_Error text={error} />
    </TR_Confirm>
  );
}

function TR_CompareBody({ review, onChanged }) {
  const r = review;
  const toast = TR_useToastSafe();
  const self = r.self || {};
  const mgr = r.manager || {};
  const rPoss = TR_poss(r.reviewer && r.reviewer.name);
  const rFirst = TR_first(r.reviewer && r.reviewer.name);
  const rows = TR_compareRows(self, mgr);
  const selfTotal = TR_total(self);
  const mgrTotal = TR_total(mgr);
  const toDiscuss = TR_itemsToDiscuss(rows);
  const editable = r.status === "comparing" && !r.has_signatures;
  const locked = r.status === "signed";

  return (
    <>
      <div className="kpi-grid">
        <TR_Kpi label="Self total" value={`${selfTotal} / ${TR_MAX_TOTAL}`} />
        <TR_Kpi label={`${rPoss} total`} value={`${mgrTotal} / ${TR_MAX_TOTAL}`} />
        <TR_Kpi label="Items to discuss" value={toDiscuss} />
      </div>

      <div className="card">
        <h2 className="card-title">Scores</h2>
        <div className="al-table-wrap">
          <table className="tx-table tx-table-labeled tr-table">
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col">Self</th>
                <th scope="col">{rFirst}</th>
                <th scope="col">Gap</th>
                <th scope="col">Result</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <td data-label="Item">
                    <span className="tr-row-label">
                      {TR_sectionTitle(row.item.section)} · {row.item.kind}
                    </span>
                    <span className="tr-row-title">{row.item.title}</span>
                  </td>
                  <td data-label="Self" className="tr-num" title={TR_scaleLabel(row.self)}>
                    {row.self}
                  </td>
                  <td data-label={rFirst} className="tr-num" title={TR_scaleLabel(row.manager)}>
                    {row.manager}
                  </td>
                  <td data-label="Gap" className="tr-num">
                    {row.gap ? row.gap : "—"}
                  </td>
                  <td data-label="Result">
                    {row.result === "action" ? (
                      <TR_Pill tone="bad">Action step required</TR_Pill>
                    ) : row.result === "discuss" ? (
                      <TR_Pill tone="warm">Discuss · {row.gap}-pt gap</TR_Pill>
                    ) : (
                      <TR_Pill tone="good">Aligned</TR_Pill>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="tr-muted" style={{ marginTop: 10 }}>
          Scale: {TR_SCALE.map((s) => s.value + " " + s.label).join(" · ")}
        </p>
      </div>

      <TR_CommentsCard self={self} mgr={mgr} rFirst={rFirst} />

      <TR_StepsCard review={r} editable={editable} onChanged={onChanged} />

      <TR_RecipientComments review={r} editable={editable && r.my_role === "staff"} onChanged={onChanged} />

      <TR_SignaturesCard review={r} onChanged={onChanged} />

      {(locked || r.status === "closed_unsigned") && <TR_AddendaCard review={r} onChanged={onChanged} />}
    </>
  );
}

function TR_CommentsCard({ self, mgr, rFirst }) {
  const lines = [];
  TR_SECTIONS.forEach((s) => lines.push([s.title, self[s.comment], mgr[s.comment]]));
  lines.push(["Action steps", self.action_steps, mgr.action_steps]);
  if (self.note_to_reviewer) lines.push([`Note to ${rFirst}`, self.note_to_reviewer, null]);
  ["appreciation", "coaching", "evaluation"].forEach((k) => {
    if (mgr[k]) lines.push([k.charAt(0).toUpperCase() + k.slice(1), null, mgr[k]]);
  });
  const shown = lines.filter((l) => l[1] || l[2]);
  if (!shown.length) return null;
  return (
    <div className="card">
      <h2 className="card-title">Comments</h2>
      <div className="tr-comments-grid">
        <span className="tr-cg-head tr-cg-col" />
        <span className="tr-cg-head tr-cg-col">Self</span>
        <span className="tr-cg-head tr-cg-col">{rFirst}</span>
        {shown.map((l) => (
          <React.Fragment key={l[0]}>
            <span className="tr-cg-head">{l[0]}</span>
            <span className="tr-cg-cell">{l[1] ? <><span className="tr-row-label">Self</span>{l[1]}</> : <span className="tr-muted">—</span>}</span>
            <span className="tr-cg-cell">{l[2] ? <><span className="tr-row-label">{rFirst}</span>{l[2]}</> : <span className="tr-muted">—</span>}</span>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

// ---- Agreed action steps ---------------------------------------------------
function TR_StepsCard({ review, editable, onChanged }) {
  const r = review;
  const toast = TR_useToastSafe();
  const [editing, setEditing] = React.useState(null); // step object or {} for new
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const steps = r.steps || [];
  const needs = !!r.requires_action_step;
  const staffFirst = TR_first(r.staff && r.staff.name) || "Team member";
  const rFirst = TR_first(r.reviewer && r.reviewer.name) || "Reviewer";
  const canStatus = r.status !== "closed_unsigned";
  const nextQ = r.cycle.quarter === 4 ? "Q1" : "Q" + (r.cycle.quarter + 1);

  const run = async (fn, msg) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      if (msg) toast(msg);
      onChanged();
      return true;
    } catch (e) {
      setError(TR_errText(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="tr-card-head">
        <h2 className="card-title" style={{ margin: 0 }}>
          Agreed action steps
        </h2>
        <TR_Pill tone={needs ? "bad" : "good"}>{needs ? "Action step required" : "No action step required"}</TR_Pill>
      </div>
      {steps.length === 0 && (
        <p className="tr-muted">
          {editable ? `Agree these in the review meeting. They carry forward to ${nextQ}.` : "No action steps."}
        </p>
      )}
      <ul className="tr-step-list">
        {steps.map((s) => (
          <li key={s.id} className="tr-step">
            <div className="tr-step-main">
              <span>{s.description}</span>
              <div className="tr-step-meta">
                {s.from_label && <TR_Pill tone="warm">From {s.from_label}</TR_Pill>}
                {s.section && <span className="tr-muted">{TR_sectionTitle(s.section)}</span>}
                <span className="tr-muted">Owner: {s.owner === "reviewer" ? rFirst : staffFirst}</span>
                {s.due_date && <span className="tr-muted">Due {TR_fmtDate(s.due_date, { month: "short", day: "numeric", year: "numeric" })}</span>}
              </div>
            </div>
            <div className="tr-step-ctrls">
              {canStatus && s.status !== "carried" ? (
                <select
                  className="tr-sel"
                  aria-label={"Status of " + s.description}
                  value={s.status}
                  disabled={busy}
                  onChange={(e) => run(() => TR_api.rpc("tr_set_action_step_status", { p_id: s.id, p_status: e.target.value }), "Status updated")}
                >
                  <option value="open">Open</option>
                  <option value="in_progress">In progress</option>
                  <option value="done">Done</option>
                </select>
              ) : (
                <TR_Pill tone="neutral">{TR_STEP_STATUS[s.status] || s.status}</TR_Pill>
              )}
              {editable && (
                <>
                  <button type="button" className="link-btn" onClick={() => setEditing(s)}>
                    Edit
                  </button>
                  <button
                    type="button"
                    className="link-btn"
                    disabled={busy}
                    onClick={() => run(() => TR_api.rpc("tr_remove_action_step", { p_id: s.id }), "Step removed")}
                  >
                    Remove
                  </button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
      {editable && !editing && (
        <button type="button" className="btn-secondary" style={{ marginTop: 10 }} onClick={() => setEditing({})}>
          + Add action step
        </button>
      )}
      {editable && editing && (
        <TR_StepEditor
          step={editing}
          staffFirst={staffFirst}
          rFirst={rFirst}
          busy={busy}
          onCancel={() => setEditing(null)}
          onSave={async (v) => {
            const ok = await run(
              () =>
                TR_api.rpc("tr_upsert_action_step", {
                  p_review: r.id,
                  p_id: editing.id || null,
                  p_section: v.section,
                  p_description: v.description,
                  p_owner: v.owner,
                  p_due: v.due_date || null,
                }),
              editing.id ? "Step updated" : "Step added",
            );
            if (ok) setEditing(null);
          }}
        />
      )}
      <TR_Error text={error} />
    </div>
  );
}

function TR_StepEditor({ step, staffFirst, rFirst, busy, onCancel, onSave }) {
  const [v, setV] = React.useState({
    description: step.description || "",
    section: step.section || "",
    owner: step.owner || "staff",
    due_date: step.due_date || "",
  });
  const set = (k) => (e) => setV(Object.assign({}, v, { [k]: e.target.value }));
  return (
    <div className="tr-step-edit">
      <label className="al-field">
        <span>Action step</span>
        <input type="text" value={v.description} onChange={set("description")} placeholder="What will change, and how will we know?" />
      </label>
      <label className="al-field">
        <span>Area</span>
        <select value={v.section} onChange={set("section")}>
          <option value="">General</option>
          {TR_SECTIONS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.title}
            </option>
          ))}
        </select>
      </label>
      <label className="al-field">
        <span>Owner</span>
        <select value={v.owner} onChange={set("owner")}>
          <option value="staff">{staffFirst}</option>
          <option value="reviewer">{rFirst}</option>
        </select>
      </label>
      <label className="al-field">
        <span>Due (optional)</span>
        <input type="date" value={v.due_date} onChange={set("due_date")} />
      </label>
      <div className="tr-actions" style={{ gridColumn: "1 / -1", marginTop: 4 }}>
        <button type="button" className="btn-primary" disabled={busy || !v.description.trim()} onClick={() => onSave(v)}>
          {step.id ? "Save step" : "Add step"}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---- Recipient comments ----------------------------------------------------
function TR_RecipientComments({ review, editable, onChanged }) {
  const r = review;
  const toast = TR_useToastSafe();
  const [text, setText] = React.useState(r.recipient_comments || "");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  React.useEffect(() => setText(r.recipient_comments || ""), [r.recipient_comments]);
  if (!editable && !r.recipient_comments) return null;
  const dirty = text.trim() !== (r.recipient_comments || "").trim();
  return (
    <div className="card">
      <label className="tr-label" htmlFor="tr-recip" style={{ marginTop: 0 }}>
        Recipient comments
      </label>
      <textarea id="tr-recip" className="tr-ta" value={text} readOnly={!editable} onChange={(e) => setText(e.target.value)} />
      {editable && (
        <div className="tr-actions">
          <button
            type="button"
            className="btn-secondary"
            disabled={busy || !dirty}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await TR_api.rpc("tr_save_recipient_comments", { p_review: r.id, p_text: text });
                toast("Comments saved");
                onChanged();
              } catch (e) {
                setError(TR_errText(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Save comments
          </button>
          <span className="tr-muted">You can edit these until someone signs.</span>
        </div>
      )}
      <TR_Error text={error} />
    </div>
  );
}

// ---- Signatures ------------------------------------------------------------
function TR_SignaturesCard({ review, onChanged }) {
  const r = review;
  const sigs = r.signatures || [];
  const byRole = {};
  sigs.forEach((g) => (byRole[g.signer_role] = g));
  const signed = r.status === "signed";
  const blocks = [
    { role: "staff", title: "Team member · " + (r.staff ? r.staff.name : ""), person: r.staff },
    { role: "reviewer", title: "Reviewer · " + (r.reviewer ? r.reviewer.name : ""), person: r.reviewer },
  ];
  return (
    <div className="card">
      <h2 className="card-title">Signatures</h2>
      <p className="card-subtitle">Each person signs from their own portal login. The review locks once both have signed.</p>
      <div className="tr-sigs">
        {blocks.map((b) => (
          <TR_SignatureBlock key={b.role} review={r} block={b} sig={byRole[b.role]} onChanged={onChanged} />
        ))}
      </div>
      {signed && (
        <div className="tr-banner good" role="status" style={{ marginTop: 14, marginBottom: 0 }}>
          Signed by both. This review is locked and saved to history.
        </div>
      )}
      <TR_PdfAndDrive review={r} onChanged={onChanged} />
    </div>
  );
}

function TR_SignatureBlock({ review, block, sig, onChanged }) {
  const r = review;
  const toast = TR_useToastSafe();
  const [name, setName] = React.useState("");
  const [agree, setAgree] = React.useState(false);
  const [disagree, setDisagree] = React.useState(false);
  const [why, setWhy] = React.useState("");
  const [tried, setTried] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const mine = r.my_role === block.role;
  const canSign = mine && !sig && r.status === "comparing";
  const needsStep = !!r.requires_action_step && !(r.steps || []).length;
  const ack = (r.ack && r.ack[block.role]) || "";
  const first = TR_first(block.person && block.person.name);

  const sign = async () => {
    setTried(true);
    setError("");
    if (!name.trim() || !agree) return;
    if (disagree && !why.trim()) return;
    setBusy(true);
    try {
      const res = await TR_api.rpc("tr_sign", {
        p_review: r.id,
        p_typed_name: name.trim(),
        p_ack: true,
        p_disagree: block.role === "staff" ? disagree : false,
        p_disagree_comment: block.role === "staff" && disagree ? why.trim() : null,
      });
      toast(res && res.locked ? "Signed. The review is locked." : "Signed");
      TR_changed();
      onChanged();
    } catch (e) {
      setError(TR_errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="tr-sig">
      <div className="tr-card-head" style={{ marginBottom: 0 }}>
        <strong>{block.title}</strong>
        <TR_Pill tone={sig ? "good" : "neutral"}>{sig ? "Signed" : "Not signed"}</TR_Pill>
      </div>
      {sig && (
        <div>
          <span className="tr-sig-name">{sig.typed_name}</span>
          <span className="tr-muted">
            {new Date(sig.signed_at).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" })} CT
            {sig.ip ? " · IP " + sig.ip : ""}
          </span>
          <p className="tr-muted" style={{ marginTop: 6 }}>
            “{sig.acknowledgment}”
          </p>
          {sig.disagree && (
            <div className="tr-banner warm" style={{ marginTop: 10, marginBottom: 0 }}>
              I disagree with parts of this review
              <div style={{ fontWeight: 400, marginTop: 4, whiteSpace: "pre-wrap" }}>{sig.disagree_comment}</div>
            </div>
          )}
        </div>
      )}
      {canSign && (
        <div>
          {needsStep && (
            <p className="tr-field-error" role="alert">
              Add at least one agreed action step before signing.
            </p>
          )}
          <label className="tr-label" htmlFor={"tr-sign-" + block.role}>
            Type your full name to sign
          </label>
          <input
            id={"tr-sign-" + block.role}
            className="tr-inp"
            value={name}
            placeholder="Full name"
            autoComplete="name"
            onChange={(e) => setName(e.target.value)}
          />
          <label className="tr-check">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <span>{ack}</span>
          </label>
          {block.role === "staff" && (
            <>
              <label className="tr-check">
                <input type="checkbox" checked={disagree} onChange={(e) => setDisagree(e.target.checked)} />
                <span>I disagree with parts of this review</span>
              </label>
              {disagree && (
                <>
                  <label className="tr-label" htmlFor="tr-disagree">
                    What do you disagree with? (required)
                  </label>
                  <textarea id="tr-disagree" className="tr-ta" value={why} onChange={(e) => setWhy(e.target.value)} />
                  {tried && !why.trim() && (
                    <span className="tr-field-error" role="alert">
                      Add a comment about what you disagree with.
                    </span>
                  )}
                </>
              )}
            </>
          )}
          <div className="tr-actions" style={{ marginTop: 8 }}>
            <button type="button" className="btn-primary" disabled={busy || needsStep} onClick={sign}>
              {busy ? "Signing…" : "Sign"}
            </button>
          </div>
          {tried && (!name.trim() || !agree) && (
            <span className="tr-field-error" role="alert">
              Type your name and check the box to sign.
            </span>
          )}
          <TR_Error text={error} />
        </div>
      )}
      {!sig && !canSign && r.status === "comparing" && (
        <p className="tr-muted" style={{ marginTop: 8 }}>
          {first} signs from {block.role === "reviewer" ? "their admin" : "their own"} login.
        </p>
      )}
    </div>
  );
}

// ---- PDF download + Drive export ---------------------------------------------
function TR_reviewFileName(r) {
  return `${r.cycle.year} Q${r.cycle.quarter} Review.pdf`;
}

function TR_PdfAndDrive({ review, onChanged }) {
  const r = review;
  const toast = TR_useToastSafe();
  const [busy, setBusy] = React.useState("");
  const [error, setError] = React.useState("");
  if (r.status !== "signed") {
    if (!r.viewer_is_admin) return null;
    return (
      <div className="tr-drive">
        <div>
          <strong>Signed PDF in Google Drive</strong>
          <p className="tr-muted">Saves automatically once both people sign.</p>
        </div>
      </div>
    );
  }
  const d = r.drive || {};
  const waiting = d.error === "waiting_for_drive_setup";
  let note = "";
  if (d.exported_at) note = "Saved " + new Date(d.exported_at).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" }) + " CT";
  if (waiting) note = "Waiting for Drive setup";
  else if (d.error) note = "Export failed: " + d.error;
  else if (!d.exported_at) note = "Saving…";
  const canPdf = r.viewer_is_admin || r.my_role === "staff";
  const go = async (what) => {
    setBusy(what);
    setError("");
    try {
      if (what === "pdf") {
        await TR_downloadPdf({ action: "pdf", review_id: r.id }, `${r.staff ? r.staff.name + " - " : ""}${TR_reviewFileName(r)}`);
      } else {
        const res = await TR_api.call({ action: "export", review_id: r.id });
        if (res && res.error === "waiting_for_drive_setup") toast("Waiting for Drive setup");
        else toast("Saved to Drive");
        onChanged();
      }
    } catch (e) {
      setError(TR_errText(e));
    } finally {
      setBusy("");
    }
  };
  return (
    <div className="tr-drive">
      <div style={{ minWidth: 0 }}>
        {r.viewer_is_admin ? (
          <>
            <strong>Signed PDF in Google Drive</strong>
            <p className={"tr-muted" + (d.error ? " tr-field-error" : "")} style={{ margin: "2px 0" }}>
              {note}
            </p>
            <span className="tr-mono">
              ~ MGB: Staff Reviews / {r.staff ? r.staff.name : ""} / {TR_reviewFileName(r)}
            </span>
          </>
        ) : (
          <>
            <strong>Signed PDF</strong>
            <p className="tr-muted">Download a copy of your signed review any time.</p>
          </>
        )}
        <TR_Error text={error} />
      </div>
      <div className="tr-actions" style={{ marginTop: 0 }}>
        {canPdf && (
          <button type="button" className="btn-secondary" disabled={!!busy} onClick={() => go("pdf")}>
            {busy === "pdf" ? "Preparing…" : "Download PDF"}
          </button>
        )}
        {r.viewer_is_admin && (
          <button type="button" className="btn-primary" disabled={!!busy} onClick={() => go("export")}>
            {busy === "export" ? "Exporting…" : d.exported_at ? "Export again" : d.error ? "Retry export" : "Export to Drive"}
          </button>
        )}
      </div>
    </div>
  );
}

// ---- Addenda (after it locks or closes) -----------------------------------
function TR_AddendaCard({ review, onChanged }) {
  const r = review;
  const toast = TR_useToastSafe();
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const list = r.addenda || [];
  if (!list.length && !r.viewer_is_admin) return null;
  return (
    <div className="card">
      <h2 className="card-title">Addenda</h2>
      <p className="card-subtitle">Corrections and notes added after the review locked. The review itself never changes.</p>
      {list.length > 0 && (
        <ul className="tr-log">
          {list.map((a, i) => (
            <li key={i}>
              <strong>
                {a.author_name || "Admin"} · {TR_fmtDate(a.created_at, { month: "short", day: "numeric", year: "numeric" })}
              </strong>
              {"\n" + a.body}
            </li>
          ))}
        </ul>
      )}
      {r.viewer_is_admin && (
        <>
          <label className="tr-label" htmlFor="tr-addendum">
            Add an addendum
          </label>
          <textarea id="tr-addendum" className="tr-ta" value={text} onChange={(e) => setText(e.target.value)} />
          <div className="tr-actions">
            <button
              type="button"
              className="btn-secondary"
              disabled={busy || !text.trim()}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await TR_api.rpc("tr_add_addendum", { p_review: r.id, p_body: text });
                  setText("");
                  toast("Addendum added");
                  onChanged();
                } catch (e) {
                  setError(TR_errText(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Add addendum
            </button>
            <span className="tr-muted">Addenda can’t be edited or removed. A signed review’s PDF is re-saved with it.</span>
          </div>
          <TR_Error text={error} />
        </>
      )}
    </div>
  );
}
