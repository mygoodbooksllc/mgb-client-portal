// ----------------------------------------------------------------------------
// "Ask about a transaction" (owner-approved 2026-09-30).
//
// A signed-in client picks or types what a QuickBooks transaction was for,
// with an optional note, from the Bank Accounts page. Staff who can access
// the client see open questions on the row (a "Question" pill), in the Inbox
// context pane and on the client overview, recategorize the transaction in
// QuickBooks themselves, then mark the question resolved here.
//
// Strictly read-only to QuickBooks: nothing here (or in the database) writes
// back to Intuit. Database: supabase/transaction-questions.sql. Asking posts a
// message in the client's thread and resolving posts a reply, both from
// database triggers, so the existing bell / Inbox / notification emails fire
// without anything new.
//
//   TQ_useQuestions(clientIds, opts)  rows for these clients (open or
//                                     answered by default)
//   TQ_RowControl                     the pill / Ask button on a transaction row
//   TQ_AskModal, TQ_ResolveModal      the client's ask and the staff view
//   TQ_AnswerModal                    the client answers a staff question
//   TQ_ClientViewModal                the client's read-only view of a staff
//                                     question after they answered it (client
//                                     voice; never staff emails or names)
//   TQ_OpenList                       open questions for one client (Inbox
//                                     context pane, client overview card)
//   TQ_ForYouList                     staff questions waiting on this client
//                                     user (Bank Accounts)
//
// GL Review (docs/gl-review-spec.md section 5, gl-review-2-questions.sql):
// questions now run both ways. `direction` is 'client_asked' (as before) or
// 'staff_asked' (the bookkeeper asked from Ledger review). Status is open,
// answered (a staff question the client, or staff on the email path,
// answered) or resolved. RLS decides what a client sees: their own questions
// and staff questions addressed to them in the portal. Until the migration
// runs the new columns are missing and everything falls back to the old
// columns (every row is then client_asked).
//
// Loaded before app.jsx in the shared global scope: every top-level name has
// a TQ_ prefix, hooks are React.*, and app.jsx globals (ModalShell, useToast,
// fmtMoney, fmtDate, relTime, effectivePlan, syncCadenceLabel) are only
// touched at render time.
// ----------------------------------------------------------------------------

const TQ_EVENT = "mgb:txn-questions-changed";
const TQ_COLS_LEGACY =
  "id, client_id, txn_key, txn_date, txn_amount, txn_description, txn_account, suggested_category, note, status, created_by, created_at, resolved_by, resolved_at, resolution_note";
const TQ_COLS = TQ_COLS_LEGACY + ", direction, asked_of_email, asked_via, answer, answered_by, answered_at, flag_id";
// Statuses still in play: open, or answered and waiting for staff to close.
const TQ_ACTIVE = ["open", "answered"];
// Set once a select with the new columns fails because they don't exist yet.
let TQ_legacy = false;
const TQ_cols = () => (TQ_legacy ? TQ_COLS_LEGACY : TQ_COLS);
const TQ_POLL_MS = 2 * 60 * 1000;

function TQ_notify() {
  try {
    window.dispatchEvent(new Event(TQ_EVENT));
    // Asking/resolving also posts a thread message (database trigger).
    window.dispatchEvent(new Event("mgb:client-messages-changed"));
  } catch (e) {}
}

function TQ_isMissing(error) {
  const m = String((error && (error.message || error.code)) || "");
  return /does not exist|42P01|PGRST205|schema cache/i.test(m);
}
// A missing column (gl-review-2-questions.sql not run), not a missing table.
function TQ_colMissing(error) {
  if (!error) return false;
  return error.code === "42703" || /column .* does not exist/i.test(String(error.message || ""));
}

// Direction helpers. Rows from before the migration have no direction.
const TQ_staffAsked = (q) => !!q && q.direction === "staff_asked";
// Needs the bookkeeper: a client question still open, or a staff question
// that has been answered.
const TQ_needsStaff = (q) => !!q && (TQ_staffAsked(q) ? q.status === "answered" : q.status === "open");
// A staff question still waiting on the client.
const TQ_waiting = (q) => TQ_staffAsked(q) && q.status === "open";
const TQ_isActive = (q) => !!q && TQ_ACTIVE.indexOf(q.status) !== -1;

const TQ_api = {
  // status: a status, a list of statuses, or null for all.
  async list(sb, clientIds, status) {
    const run = () => {
      let q = sb.from("transaction_questions").select(TQ_cols()).in("client_id", clientIds);
      if (Array.isArray(status)) q = q.in("status", status);
      else if (status) q = q.eq("status", status);
      return q.order("created_at", { ascending: false }).limit(500);
    };
    let r = await run();
    if (r && r.error && !TQ_legacy && TQ_colMissing(r.error)) {
      TQ_legacy = true;
      r = await run();
    }
    return r;
  },
  // One question by id (deep links), with the same fallback.
  async one(sb, id) {
    const run = () => sb.from("transaction_questions").select(TQ_cols()).eq("id", id).maybeSingle();
    let r = await run();
    if (r && r.error && !TQ_legacy && TQ_colMissing(r.error)) {
      TQ_legacy = true;
      r = await run();
    }
    return r;
  },
  ask(sb, row) {
    // created_by, status and timestamps are stamped by the database.
    return sb.from("transaction_questions").insert([row]);
  },
  // Staff close a question: an open client question, or a staff question
  // that was answered (or is still open, with a note; the database checks).
  resolve(sb, id, note) {
    return sb
      .from("transaction_questions")
      .update({ status: "resolved", resolution_note: note || null })
      .eq("id", id)
      .in("status", TQ_ACTIVE);
  },
  // The addressee answers a staff question in the portal (open -> answered).
  // Staff typing in an emailed answer use gl_review_answer from Ledger review.
  answer(sb, id, text) {
    return sb
      .from("transaction_questions")
      .update({ status: "answered", answer: text })
      .eq("id", id)
      .eq("status", "open")
      .select("id");
  },
};

// Questions for these clients. { rows, byKey (open or answered, by
// client|txn_key; an open one wins), loading, missing, reload }. Quietly empty
// without Supabase or the table.
function TQ_useQuestions(clientIds, opts) {
  const enabled = !(opts && opts.enabled === false);
  const status = opts && opts.status !== undefined ? opts.status : TQ_ACTIVE;
  const statusKey = Array.isArray(status) ? status.join(",") : status || "";
  const idsKey = (clientIds || []).filter(Boolean).slice().sort().join(",");
  const [state, setState] = React.useState({ rows: [], loading: true, missing: false });
  const load = React.useCallback(async () => {
    const sb = window.mgbSupabase;
    if (!enabled || !sb || !idsKey) {
      setState({ rows: [], loading: false, missing: false });
      return;
    }
    const res = await Promise.resolve(TQ_api.list(sb, idsKey.split(","), status)).then(
      (r) => r,
      (e) => ({ data: null, error: e }),
    );
    if (res.error) {
      setState({ rows: [], loading: false, missing: TQ_isMissing(res.error) });
      return;
    }
    setState({ rows: res.data || [], loading: false, missing: false });
    // eslint-disable-next-line
  }, [enabled, idsKey, statusKey]);
  React.useEffect(() => {
    load();
    const id = setInterval(() => !document.hidden && load(), TQ_POLL_MS);
    window.addEventListener(TQ_EVENT, load);
    return () => {
      clearInterval(id);
      window.removeEventListener(TQ_EVENT, load);
    };
  }, [load]);
  const byKey = React.useMemo(() => {
    const m = {};
    state.rows.forEach((r) => {
      if (!TQ_isActive(r)) return;
      const k = r.client_id + "|" + r.txn_key;
      if (!m[k] || (m[k].status !== "open" && r.status === "open")) m[k] = r;
    });
    return m;
  }, [state.rows]);
  return { ...state, byKey, reload: load };
}

function TQ_label(q) {
  const parts = [];
  if (q.txn_date && typeof fmtDate === "function") parts.push(fmtDate(q.txn_date));
  if (q.txn_description) parts.push(q.txn_description);
  if (q.txn_amount != null && typeof fmtMoney === "function") parts.push(fmtMoney(Number(q.txn_amount), { cents: true }));
  return parts.join(" · ") || "Transaction";
}

function TQ_cadence(client) {
  const plan = typeof effectivePlan === "function" ? effectivePlan(client) : "standard";
  const c = typeof syncCadenceLabel === "function" ? syncCadenceLabel(plan) : "Synced from QuickBooks";
  return c.charAt(0).toLowerCase() + c.slice(1);
}

// ---------------------------------------------------------------------------
// Client: ask
// ---------------------------------------------------------------------------
function TQ_AskModal({ client, txn, categories, onClose }) {
  const showToast = useToast();
  const [category, setCategory] = React.useState("");
  const [note, setNote] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");
  const listId = "tq-cats-" + String(client.id).replace(/[^A-Za-z0-9_-]/g, "_");
  const canSubmit = !!(category.trim() || note.trim());

  async function submit(e) {
    e.preventDefault();
    const sb = window.mgbSupabase;
    if (!sb || !canSubmit) return;
    setSaving(true);
    setError("");
    const { error: err } = await TQ_api.ask(sb, {
      client_id: client.id,
      txn_key: txn.txnKey,
      txn_date: txn.date || null,
      txn_amount: typeof txn.amount === "number" ? txn.amount : null,
      txn_description: String(txn.description || "").slice(0, 500) || null,
      txn_account: String(txn.accountName || "").slice(0, 200) || null,
      suggested_category: category.trim().slice(0, 200) || null,
      note: note.trim().slice(0, 2000) || null,
    });
    setSaving(false);
    if (err) {
      setError(
        /duplicate|unique/i.test(String(err.message || ""))
          ? "There's already an open question on this transaction."
          : "Couldn't send your question. Please try again.",
      );
      return;
    }
    TQ_notify();
    showToast("Question sent to your bookkeeper.");
    onClose();
  }

  return (
    <ModalShell onClose={onClose} labelledBy="tq-ask-title" className="confirm-modal tq-modal">
      <form onSubmit={submit}>
        <div className="modal-header">
          <h3 className="card-title" id="tq-ask-title" style={{ margin: 0 }}>
            Ask about this transaction
          </h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body tq-body">
          <div className="tq-txn">
            <span className="tq-txn-desc">{txn.description}</span>
            <span className="tq-txn-meta">
              {typeof fmtDate === "function" ? fmtDate(txn.date) : txn.date} · {txn.accountName} ·{" "}
              <strong className={txn.amount >= 0 ? "positive" : "negative"}>
                {typeof fmtMoney === "function" ? fmtMoney(txn.amount, { cents: true }) : txn.amount}
              </strong>
            </span>
            <span className="tq-txn-meta">
              Currently: {txn.category || "Uncategorized"}
              {txn.type ? ` · ${txn.type}` : ""}
            </span>
          </div>
          <label className="task-field">
            <span>What was this for?</span>
            <input
              type="text"
              list={listId}
              autoFocus
              maxLength={200}
              placeholder="Pick a category or type your own"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
            <datalist id={listId}>
              {(categories || []).map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
          <label className="task-field">
            <span>Note (optional)</span>
            <textarea
              rows={3}
              maxLength={2000}
              placeholder="Anything that helps, like who it was for or what was bought"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <p className="card-subtitle" style={{ margin: 0 }}>
            Your bookkeeper reviews it and makes any change in QuickBooks. The new category shows
            here after the next sync ({TQ_cadence(client)}).
          </p>
          {error && (
            <p className="tq-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={saving || !canSubmit}>
            {saving ? "Sending…" : "Send question"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Staff: resolve
// ---------------------------------------------------------------------------
function TQ_ResolveModal({ question, client, canResolve, onClose }) {
  const showToast = useToast();
  const [note, setNote] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");
  const q = question;
  const staffAsked = TQ_staffAsked(q);
  const active = TQ_isActive(q);
  // A staff question closed without an answer needs a note (database rule).
  const noteRequired = staffAsked && q.status === "open";
  const canSubmit = !noteRequired || !!note.trim();
  // canResolve is false only for a client viewer: a staff question then gets
  // the client-voice view, never "We asked" or staff emails.
  if (staffAsked && !canResolve) return <TQ_ClientViewModal question={q} onClose={onClose} />;

  async function resolve(e) {
    e.preventDefault();
    const sb = window.mgbSupabase;
    if (!sb || !canSubmit) return;
    setSaving(true);
    setError("");
    const { error: err } = await TQ_api.resolve(sb, q.id, note.trim().slice(0, 2000));
    setSaving(false);
    if (err) {
      setError("Couldn't mark it resolved. Please try again.");
      return;
    }
    TQ_notify();
    showToast(staffAsked ? "Marked resolved." : "Marked resolved. The client gets a reply in their messages.");
    onClose();
  }

  return (
    <ModalShell onClose={onClose} labelledBy="tq-res-title" className="confirm-modal tq-modal">
      <form onSubmit={resolve}>
        <div className="modal-header">
          <h3 className="card-title" id="tq-res-title" style={{ margin: 0 }}>
            Transaction question{client ? ` · ${client.name}` : ""}
          </h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body tq-body">
          <div className="tq-txn">
            <span className="tq-txn-desc">{q.txn_description || "Transaction"}</span>
            <span className="tq-txn-meta">
              {TQ_label({ ...q, txn_description: null })}
              {q.txn_account ? ` · ${q.txn_account}` : ""}
            </span>
          </div>
          {staffAsked ? (
            <dl className="tq-facts">
              <div>
                <dt>We asked</dt>
                <dd>
                  {q.asked_of_email || "the client"}
                  {q.asked_via === "email" ? " (by email)" : " (in the portal)"}
                  {q.created_by ? ` · by ${String(q.created_by).split("@")[0]}` : ""}
                  {typeof relTime === "function" && relTime(q.created_at) ? ` · ${relTime(q.created_at)}` : ""}
                </dd>
              </div>
              <div>
                <dt>Question</dt>
                <dd className="tq-note">{q.note}</dd>
              </div>
              <div>
                <dt>Answer</dt>
                <dd className={q.answer ? "tq-note" : undefined}>
                  {q.answer ? (
                    <>
                      {q.answer}
                      <span className="muted">
                        {" "}
                        · {q.answered_by}
                        {typeof relTime === "function" && relTime(q.answered_at) ? ` · ${relTime(q.answered_at)}` : ""}
                      </span>
                    </>
                  ) : (
                    <span className="muted">Waiting on the client</span>
                  )}
                </dd>
              </div>
            </dl>
          ) : (
          <dl className="tq-facts">
            <div>
              <dt>Client thinks it's</dt>
              <dd>{q.suggested_category || <span className="muted">No category given</span>}</dd>
            </div>
            {q.note && (
              <div>
                <dt>Note</dt>
                <dd className="tq-note">{q.note}</dd>
              </div>
            )}
            <div>
              <dt>Asked by</dt>
              <dd>
                {q.created_by}
                {typeof relTime === "function" && relTime(q.created_at) ? ` · ${relTime(q.created_at)}` : ""}
              </dd>
            </div>
            {q.status === "resolved" && (
              <div>
                <dt>Resolved</dt>
                <dd>
                  {canResolve ? q.resolved_by : "By your bookkeeper"}
                  {q.resolution_note ? `: ${q.resolution_note}` : ""}
                </dd>
              </div>
            )}
          </dl>
          )}
          {staffAsked && q.status === "resolved" && (
            <p className="card-subtitle" style={{ margin: 0 }}>
              Resolved by {q.resolved_by}
              {q.resolution_note ? `: ${q.resolution_note}` : ""}
            </p>
          )}
          {active && canResolve && !staffAsked && (
            <>
              <p className="tq-steps">
                Recategorize it in QuickBooks first. MyGoodBooks never changes QuickBooks; marking
                this resolved only closes the question and replies to the client.
              </p>
              <label className="task-field">
                <span>Reply to the client (optional)</span>
                <textarea
                  rows={2}
                  maxLength={2000}
                  placeholder="Moved to Building Repairs, thanks!"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
            </>
          )}
          {active && canResolve && staffAsked && (
            <>
              <p className="tq-steps">
                {q.status === "answered"
                  ? "Make any change in QuickBooks, then clear the flag in Ledger review. Marking this resolved only closes the question; the client isn't messaged."
                  : "The client hasn't answered yet. Closing it now needs a note; the client isn't messaged."}
              </p>
              <label className="task-field">
                <span>{noteRequired ? "Why close it without an answer?" : "Note for the team (optional)"}</span>
                <textarea rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
              </label>
            </>
          )}
          {error && (
            <p className="tq-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn-secondary" onClick={onClose}>
            {active && canResolve ? "Cancel" : "Close"}
          </button>
          {active && canResolve && (
            <button type="submit" className="btn-primary" disabled={saving || !canSubmit}>
              {saving ? "Saving…" : "Mark resolved"}
            </button>
          )}
        </div>
      </form>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Client: answer a question from the bookkeeper (staff_asked, portal). RLS
// only shows it to the person it was sent to.
// ---------------------------------------------------------------------------
function TQ_AnswerModal({ question, onClose }) {
  const showToast = useToast();
  const [text, setText] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");
  const q = question;
  async function submit(e) {
    e.preventDefault();
    const sb = window.mgbSupabase;
    const answer = text.trim().slice(0, 2000);
    if (!sb || !answer) return;
    setSaving(true);
    setError("");
    const { data, error: err } = await TQ_api.answer(sb, q.id, answer);
    setSaving(false);
    if (err || !data || !data.length) {
      setError(err ? "Couldn't send your answer. Please try again." : "This question was already answered or closed.");
      if (!err) TQ_notify();
      return;
    }
    TQ_notify();
    showToast("Answer sent to your bookkeeper.");
    onClose();
  }
  return (
    <ModalShell onClose={onClose} labelledBy="tq-ans-title" className="confirm-modal tq-modal">
      <form onSubmit={submit}>
        <div className="modal-header">
          <h3 className="card-title" id="tq-ans-title" style={{ margin: 0 }}>
            Question from your bookkeeper
          </h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body tq-body">
          <div className="tq-txn">
            <span className="tq-txn-desc">{q.txn_description || "Transaction"}</span>
            <span className="tq-txn-meta">
              {TQ_label({ ...q, txn_description: null })}
              {q.txn_account ? ` · ${q.txn_account}` : ""}
            </span>
          </div>
          <p className="tq-note" style={{ margin: 0 }}>
            {q.note}
          </p>
          <label className="task-field">
            <span>Your answer</span>
            <textarea
              rows={3}
              maxLength={2000}
              autoFocus
              placeholder="What was this for? Anything that helps."
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          {error && (
            <p className="tq-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={saving || !text.trim()}>
            {saving ? "Sending…" : "Send answer"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Client: a question from the bookkeeper they already answered (or that was
// closed). Read-only, in the client's voice. Shows only the question, their
// answer and when; never answered_by, created_by, resolved_by or any staff
// email, since the person reading is the client.
// ---------------------------------------------------------------------------
function TQ_ClientViewModal({ question, onClose }) {
  const q = question;
  const when = (iso) => (typeof relTime === "function" && iso ? relTime(iso) : "");
  return (
    <ModalShell onClose={onClose} labelledBy="tq-cv-title" className="confirm-modal tq-modal">
      <div className="modal-header">
        <h3 className="card-title" id="tq-cv-title" style={{ margin: 0 }}>
          Question from your bookkeeper
        </h3>
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <div className="modal-body tq-body">
        <div className="tq-txn">
          <span className="tq-txn-desc">{q.txn_description || "Transaction"}</span>
          <span className="tq-txn-meta">
            {TQ_label({ ...q, txn_description: null })}
            {q.txn_account ? ` · ${q.txn_account}` : ""}
          </span>
        </div>
        <dl className="tq-facts">
          <div>
            <dt>Your bookkeeper asked</dt>
            <dd className="tq-note">
              {q.note}
              {when(q.created_at) ? <span className="muted"> · {when(q.created_at)}</span> : null}
            </dd>
          </div>
          <div>
            <dt>You answered</dt>
            <dd className={q.answer ? "tq-note" : undefined}>
              {q.answer ? (
                <>
                  {q.answer}
                  {when(q.answered_at) ? <span className="muted"> · {when(q.answered_at)}</span> : null}
                </>
              ) : (
                <span className="muted">No answer yet</span>
              )}
            </dd>
          </div>
        </dl>
        <p className="card-subtitle" style={{ margin: 0 }}>
          {q.status === "resolved"
            ? "Your bookkeeper has closed this question. Thank you!"
            : "Your bookkeeper has your answer and will make any change in QuickBooks."}
        </p>
      </div>
      <div className="modal-footer">
        <button type="button" className="btn-secondary" onClick={onClose}>
          Close
        </button>
      </div>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// The cell control on a transaction row.
//   staff:        "Question" pill (client asked), "Asked client" (we asked,
//                 waiting) or "Answered" (we asked, they answered); opens the
//                 resolve dialog
//   client user:  "Question sent" pill for their own question, an "Answer"
//                 button for a question from the bookkeeper, "Answered" once
//                 answered, else an "Ask" button
// ---------------------------------------------------------------------------
function TQ_RowControl({ client, txn, question, isStaff, isClientUser, categories }) {
  const [open, setOpen] = React.useState(false);
  if (!txn || !txn.txnKey) return null;
  if (question) {
    const staffAsked = TQ_staffAsked(question);
    if (staffAsked && !isStaff && question.status === "open") {
      return (
        <>
          <button
            type="button"
            className="tq-ask tq-answer"
            onClick={() => setOpen(true)}
            title="Your bookkeeper has a question about this transaction"
          >
            Answer
          </button>
          {open && <TQ_AnswerModal question={question} onClose={() => setOpen(false)} />}
        </>
      );
    }
    const text = staffAsked
      ? question.status === "answered"
        ? "Answered"
        : "Asked client"
      : isStaff
        ? "Question"
        : "Question sent";
    const title = staffAsked
      ? !isStaff
        ? "You answered your bookkeeper's question"
        : question.status === "answered"
          ? "The client answered our question"
          : "Waiting on the client to answer"
      : question.suggested_category
        ? `Client thinks it's ${question.suggested_category}`
        : "Open question from the client";
    return (
      <>
        <button type="button" className="tq-pill" onClick={() => setOpen(true)} title={title}>
          {text}
        </button>
        {open &&
          (staffAsked && !isStaff ? (
            <TQ_ClientViewModal question={question} onClose={() => setOpen(false)} />
          ) : (
            <TQ_ResolveModal question={question} client={client} canResolve={!!isStaff} onClose={() => setOpen(false)} />
          ))}
      </>
    );
  }
  if (!isClientUser) return null;
  return (
    <>
      <button
        type="button"
        className="tq-ask"
        onClick={() => setOpen(true)}
        aria-label={`Ask about ${txn.description}`}
        title="Ask your bookkeeper about this transaction"
      >
        Ask
      </button>
      {open && <TQ_AskModal client={client} txn={txn} categories={categories} onClose={() => setOpen(false)} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Open questions for one client (staff). `compact` for the Inbox context pane;
// otherwise a card for the client overview. Renders nothing when there are
// none and `hideEmpty` is set.
// ---------------------------------------------------------------------------
// `filterIds` (optional, TABS WP3): only these question ids (Bank's
// "questions" preset lists the ones on older transactions).
function TQ_OpenList({ client, compact, hideEmpty, onOpenBank, filterIds }) {
  const { rows: allQRows, loading, missing } = TQ_useQuestions([client && client.id]);
  // Ones that need the bookkeeper first, then staff questions still with the client.
  const rows = (Array.isArray(filterIds) ? allQRows.filter((q) => filterIds.indexOf(q.id) !== -1) : allQRows)
    .filter(TQ_isActive)
    .slice()
    .sort((a, b) => (TQ_needsStaff(a) === TQ_needsStaff(b) ? 0 : TQ_needsStaff(a) ? -1 : 1));
  const needN = rows.filter(TQ_needsStaff).length;
  const [active, setActive] = React.useState(null);
  if (!client || missing) return null;
  if (hideEmpty && !rows.length) return null;

  const list = (
    <ul className={compact ? "si-ctx-list tq-list is-compact" : "tq-list"}>
      {rows.slice(0, compact ? 6 : 20).map((q) => (
        <li key={q.id}>
          <button type="button" className="tq-list-btn" onClick={() => setActive(q)}>
            {compact && <span className="si-ctx-kind">Txn</span>}
            <span className="tq-list-main">
              <span className="tq-list-title">{TQ_label(q)}</span>
              <span className="tq-list-sub">
                {TQ_staffAsked(q)
                  ? q.status === "answered"
                    ? "Answered our question"
                    : "We asked · waiting on the client"
                  : q.suggested_category
                    ? `Thinks: ${q.suggested_category}`
                    : "Asked a question"}
                {TQ_staffAsked(q) && q.answer
                  ? ` · "${String(q.answer).slice(0, 60)}${q.answer.length > 60 ? "…" : ""}"`
                  : q.note
                    ? ` · "${String(q.note).slice(0, 60)}${q.note.length > 60 ? "…" : ""}"`
                    : ""}
              </span>
            </span>
            {!compact && typeof relTime === "function" && <span className="tq-list-when">{relTime(q.created_at)}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
  const modal = active && (
    <TQ_ResolveModal question={active} client={client} canResolve onClose={() => setActive(null)} />
  );

  if (compact) {
    return (
      <div className="si-ctx-section">
        <div className="si-ctx-head">Transaction questions</div>
        {rows.length ? list : <p className="si-muted">{loading ? "Loading…" : "None open."}</p>}
        {modal}
      </div>
    );
  }
  return (
    <div className={"card tq-card" + (needN > 0 ? " card-urgent" : "")}>
      <div className="ov-card-head">
        <h3 className="card-title">
          Transaction questions
          {needN > 0 && <span className="tq-count">{needN}</span>}
        </h3>
        {onOpenBank && rows.length > 0 && (
          <button type="button" className="btn-secondary tq-open-bank" onClick={onOpenBank}>
            Bank Accounts
          </button>
        )}
      </div>
      {rows.length ? (
        <>
          <p className="card-subtitle" style={{ marginTop: 0 }}>
            Recategorize in QuickBooks, then mark each one resolved.
            {rows.length > needN ? ` ${rows.length - needN} waiting on the client.` : ""}
          </p>
          {list}
        </>
      ) : (
        <p className="card-subtitle">{loading ? "Loading…" : "No open questions from this client."}</p>
      )}
      {modal}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Client: questions from the bookkeeper waiting on this person (staff_asked,
// portal, open). RLS returns only the ones addressed to them. Shown at the
// top of Bank Accounts so a question on a transaction outside the loaded
// window can still be answered. Renders nothing when there are none.
// ---------------------------------------------------------------------------
function TQ_ForYouList({ questions }) {
  const rows = (questions || []).filter(TQ_waiting);
  const [active, setActive] = React.useState(null);
  if (!rows.length) return null;
  return (
    <div className="card tq-card tq-for-you card-urgent" data-lk="at:tq-for-you">
      <div className="ov-card-head">
        <h3 className="card-title">
          Questions from your bookkeeper
          <span className="tq-count">{rows.length}</span>
        </h3>
      </div>
      <ul className="tq-list">
        {rows.slice(0, 20).map((q) => (
          <li key={q.id} data-lk={"question:" + q.id}>
            <button type="button" className="tq-list-btn" onClick={() => setActive(q)}>
              <span className="tq-list-main">
                <span className="tq-list-title">{TQ_label(q)}</span>
                <span className="tq-list-sub">
                  {String(q.note || "").slice(0, 120)}
                  {String(q.note || "").length > 120 ? "…" : ""}
                </span>
              </span>
              <span className="tq-list-when">Answer</span>
            </button>
          </li>
        ))}
      </ul>
      {active && <TQ_AnswerModal question={active} onClose={() => setActive(null)} />}
    </div>
  );
}
