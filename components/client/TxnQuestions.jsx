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
//   TQ_useQuestions(clientIds, opts)  rows for these clients (open by default)
//   TQ_RowControl                     the pill / Ask button on a transaction row
//   TQ_AskModal, TQ_ResolveModal      the two dialogs
//   TQ_OpenList                       open questions for one client (Inbox
//                                     context pane, client overview card)
//
// Loaded before app.jsx in the shared global scope: every top-level name has
// a TQ_ prefix, hooks are React.*, and app.jsx globals (ModalShell, useToast,
// fmtMoney, fmtDate, relTime, effectivePlan, syncCadenceLabel) are only
// touched at render time.
// ----------------------------------------------------------------------------

const TQ_EVENT = "mgb:txn-questions-changed";
const TQ_COLS =
  "id, client_id, txn_key, txn_date, txn_amount, txn_description, txn_account, suggested_category, note, status, created_by, created_at, resolved_by, resolved_at, resolution_note";
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

const TQ_api = {
  list(sb, clientIds, status) {
    let q = sb.from("transaction_questions").select(TQ_COLS).in("client_id", clientIds);
    if (status) q = q.eq("status", status);
    return q.order("created_at", { ascending: false }).limit(500);
  },
  ask(sb, row) {
    // created_by, status and timestamps are stamped by the database.
    return sb.from("transaction_questions").insert([row]);
  },
  resolve(sb, id, note) {
    return sb
      .from("transaction_questions")
      .update({ status: "resolved", resolution_note: note || null })
      .eq("id", id)
      .eq("status", "open");
  },
};

// Questions for these clients. { rows, byKey (open, by client|txn_key),
// loading, missing, reload }. Quietly empty without Supabase or the table.
function TQ_useQuestions(clientIds, opts) {
  const enabled = !(opts && opts.enabled === false);
  const status = opts && opts.status !== undefined ? opts.status : "open";
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
  }, [enabled, idsKey, status]);
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
      if (r.status === "open") m[r.client_id + "|" + r.txn_key] = r;
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

  async function resolve(e) {
    e.preventDefault();
    const sb = window.mgbSupabase;
    if (!sb) return;
    setSaving(true);
    setError("");
    const { error: err } = await TQ_api.resolve(sb, q.id, note.trim().slice(0, 2000));
    setSaving(false);
    if (err) {
      setError("Couldn't mark it resolved. Please try again.");
      return;
    }
    TQ_notify();
    showToast("Marked resolved. The client gets a reply in their messages.");
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
                  {q.resolved_by}
                  {q.resolution_note ? `: ${q.resolution_note}` : ""}
                </dd>
              </div>
            )}
          </dl>
          {q.status === "open" && canResolve && (
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
          {error && (
            <p className="tq-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn-secondary" onClick={onClose}>
            {q.status === "open" && canResolve ? "Cancel" : "Close"}
          </button>
          {q.status === "open" && canResolve && (
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? "Saving…" : "Mark resolved"}
            </button>
          )}
        </div>
      </form>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// The cell control on a transaction row.
//   staff:        "Question" pill when one is open (opens the resolve dialog)
//   client user:  "Question sent" pill when open, else an "Ask" button
// ---------------------------------------------------------------------------
function TQ_RowControl({ client, txn, question, isStaff, isClientUser, categories }) {
  const [open, setOpen] = React.useState(false);
  if (!txn || !txn.txnKey) return null;
  if (question) {
    return (
      <>
        <button
          type="button"
          className="tq-pill"
          onClick={() => setOpen(true)}
          title={
            question.suggested_category
              ? `Client thinks it's ${question.suggested_category}`
              : "Open question from the client"
          }
        >
          {isStaff ? "Question" : "Question sent"}
        </button>
        {open && (
          <TQ_ResolveModal question={question} client={client} canResolve={!!isStaff} onClose={() => setOpen(false)} />
        )}
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
function TQ_OpenList({ client, compact, hideEmpty, onOpenBank }) {
  const { rows, loading, missing } = TQ_useQuestions([client && client.id]);
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
                {q.suggested_category ? `Thinks: ${q.suggested_category}` : "Asked a question"}
                {q.note ? ` · "${String(q.note).slice(0, 60)}${q.note.length > 60 ? "…" : ""}"` : ""}
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
    <div className={"card tq-card" + (rows.length > 0 ? " card-urgent" : "")}>
      <div className="ov-card-head">
        <h3 className="card-title">
          Transaction questions
          {rows.length > 0 && <span className="tq-count">{rows.length}</span>}
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
