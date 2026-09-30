// ----------------------------------------------------------------------------
// Staff bug reports / feedback (owner request 2026-09-30). Mainly for
// reporting bugs, so Bug is the first and default kind.
//
//   FB_openFeedback()   opens the modal from anywhere (top bar Help menu,
//                       bottom of the Help page). Fires FB_OPEN_EVENT.
//   FB_FeedbackHost     mounted once by TB_StaffTopBar; listens for the event
//                       and renders FB_FeedbackModal with the open client.
//   FB_FeedbackModal    kind chips, message, "What did you expect to happen?"
//                       (bugs), "My feedback" list with statuses + admin notes.
//                       Page (hash route), current client and, for bugs, the
//                       browser user agent + screen size are sent along.
//   FB_FeedbackPage     admin page (#/feedback): newest first, filter by
//                       status / kind, change status + admin note inline.
//   FB_NavBadge         count of "new" reports on the admin nav item.
//
// Table + RLS: supabase/staff-feedback.sql. The server stamps author_email,
// forces status 'new' on insert and only lets admins change status /
// admin_note.
//
// Loaded before app.jsx in the shared global scope: every top-level name
// carries an FB_ prefix; app.jsx globals (useToast, ModalShell) are only
// touched at render time. Hooks are used as React.*.
// ----------------------------------------------------------------------------

const FB_OPEN_EVENT = "mgb:open-feedback";
const FB_CHANGED_EVENT = "mgb:feedback-changed";
const FB_MAX = 5000;
const FB_PAGE_SIZE = 50;

const FB_KINDS = [
  { value: "bug", label: "Bug" },
  { value: "idea", label: "Idea" },
  { value: "question", label: "Question" },
  { value: "other", label: "Other" },
];
const FB_KIND_LABEL = Object.fromEntries(FB_KINDS.map((k) => [k.value, k.label]));
const FB_STATUSES = [
  { value: "new", label: "New" },
  { value: "planned", label: "Planned" },
  { value: "done", label: "Done" },
  { value: "wont_do", label: "Won't do" },
];
const FB_STATUS_LABEL = Object.fromEntries(FB_STATUSES.map((s) => [s.value, s.label]));

function FB_openFeedback() {
  window.dispatchEvent(new CustomEvent(FB_OPEN_EVENT));
}

function FB_currentPage() {
  return String(window.location.hash || "#/").slice(0, 300);
}

function FB_browserInfo() {
  try {
    const scr = window.screen ? `screen ${window.screen.width}x${window.screen.height}` : "";
    const win = `window ${window.innerWidth}x${window.innerHeight}`;
    const tail = [scr, win].filter(Boolean).join(", ");
    const ua = String(navigator.userAgent || "");
    const room = 300 - tail.length - 3;
    return (ua.slice(0, Math.max(0, room)) + " · " + tail).slice(0, 300);
  } catch (e) {
    return null;
  }
}

function FB_when(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function FB_fullTime(ts) {
  return ts ? new Date(ts).toLocaleString() : "";
}

function FB_useToastSafe() {
  return typeof useToast === "function" ? useToast() : (m) => window.alert(m);
}

function FB_Icon(props) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <path d="M12 7v4" />
      <path d="M12 14h.01" />
    </svg>
  );
}

function FB_KindTag({ kind }) {
  return <span className={"fb-kind fb-kind-" + kind}>{FB_KIND_LABEL[kind] || kind}</span>;
}

function FB_StatusPill({ status }) {
  return <span className={"fb-status fb-status-" + status}>{FB_STATUS_LABEL[status] || status}</span>;
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------
function FB_MyFeedback() {
  const [st, setSt] = React.useState({ loading: true, rows: [], error: null });
  React.useEffect(() => {
    let alive = true;
    (async () => {
      const sb = window.mgbSupabase;
      if (!sb) return alive && setSt({ loading: false, rows: [], error: null });
      const { data: s } = await sb.auth.getSession();
      const me = s && s.session && s.session.user ? s.session.user.email : null;
      // Admins can read every row, so filter to the sender explicitly.
      let q = sb
        .from("staff_feedback")
        .select("id, created_at, kind, message, status, admin_note, updated_at")
        .order("created_at", { ascending: false })
        .limit(50);
      if (me) q = q.eq("author_email", me);
      const { data, error } = await q;
      if (alive) setSt({ loading: false, rows: data || [], error: error ? error.message : null });
    })();
    return () => {
      alive = false;
    };
  }, []);
  if (st.loading) return <p className="fb-dim">Loading…</p>;
  if (st.error) return <p className="fb-error" role="alert">{st.error}</p>;
  if (!st.rows.length) return <p className="fb-dim">You haven’t sent anything yet.</p>;
  return (
    <ul className="fb-mine">
      {st.rows.map((r) => (
        <li key={r.id} className="fb-mine-item">
          <div className="fb-mine-top">
            <FB_KindTag kind={r.kind} />
            <FB_StatusPill status={r.status} />
            <span className="fb-dim" title={FB_fullTime(r.created_at)}>{FB_when(r.created_at)}</span>
          </div>
          <p className="fb-mine-msg">{r.message.length > 240 ? r.message.slice(0, 240) + "…" : r.message}</p>
          {r.admin_note && (
            <p className="fb-mine-note">
              <b>Reply:</b> {r.admin_note}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

function FB_FeedbackModal({ clientId, onClose }) {
  const toast = FB_useToastSafe();
  const [view, setView] = React.useState("send"); // send | mine
  const [kind, setKind] = React.useState("bug");
  const [message, setMessage] = React.useState("");
  const [expected, setExpected] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState(null);
  // Captured when the modal opens, not when Send is clicked.
  const [page] = React.useState(FB_currentPage);
  const isBug = kind === "bug";
  const canSend = message.trim().length > 0 && !sending;

  async function send() {
    if (!canSend) return;
    const sb = window.mgbSupabase;
    if (!sb) return setError("Not connected. Try again after signing in.");
    setSending(true);
    setError(null);
    const { error: err } = await sb.from("staff_feedback").insert({
      kind,
      message: message.trim().slice(0, FB_MAX),
      expected: isBug && expected.trim() ? expected.trim().slice(0, FB_MAX) : null,
      page,
      browser: isBug ? FB_browserInfo() : null,
      client_id: clientId || null,
    });
    setSending(false);
    if (err) return setError("Couldn't send: " + err.message);
    window.dispatchEvent(new CustomEvent(FB_CHANGED_EVENT));
    toast("Thanks — feedback sent");
    onClose();
  }

  if (typeof ModalShell !== "function") return null;
  return (
    <ModalShell onClose={onClose} labelledBy="fb-modal-title" className="fb-modal">
      <div className="modal-header">
        <h3 className="card-title" id="fb-modal-title" style={{ margin: 0 }}>
          {view === "send" ? "Report a bug or send feedback" : "My feedback"}
        </h3>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      {view === "send" ? (
        <div className="modal-body fb-body">
          <div className="fb-kinds" role="radiogroup" aria-label="Kind">
            {FB_KINDS.map((k) => (
              <button
                key={k.value}
                type="button"
                role="radio"
                aria-checked={kind === k.value}
                className={"fb-chip" + (kind === k.value ? " active" : "") + (k.value === "bug" ? " fb-chip-bug" : "")}
                onClick={() => setKind(k.value)}
              >
                {k.label}
              </button>
            ))}
          </div>
          <label className="fb-field">
            <span>{isBug ? "What went wrong?" : kind === "question" ? "Your question" : "Your feedback"}</span>
            <textarea
              rows={5}
              maxLength={FB_MAX}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={isBug ? "What were you doing, and what happened?" : ""}
            />
          </label>
          {isBug && (
            <label className="fb-field">
              <span>
                What did you expect to happen? <span className="fb-dim">(optional)</span>
              </span>
              <textarea rows={2} maxLength={FB_MAX} value={expected} onChange={(e) => setExpected(e.target.value)} />
            </label>
          )}
          <p className="fb-note">
            {isBug ? "We’ll include the page you’re on and your browser details." : "We’ll include the page you’re on."}
          </p>
          {error && (
            <p className="fb-error" role="alert">
              {error}
            </p>
          )}
        </div>
      ) : (
        <div className="modal-body fb-body">
          <FB_MyFeedback />
        </div>
      )}
      <div className="modal-footer fb-footer">
        {view === "send" ? (
          <>
            <button type="button" className="link-btn fb-mine-link" onClick={() => setView("mine")}>
              My feedback
            </button>
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn-primary" disabled={!canSend} onClick={send}>
              {sending ? "Sending…" : "Send"}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="link-btn fb-mine-link" onClick={() => setView("send")}>
              ← Send new
            </button>
            <button type="button" className="btn-secondary" onClick={onClose}>
              Close
            </button>
          </>
        )}
      </div>
    </ModalShell>
  );
}

function FB_FeedbackHost({ clientId }) {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(FB_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(FB_OPEN_EVENT, onOpen);
  }, []);
  if (!open) return null;
  const modal = <FB_FeedbackModal clientId={clientId} onClose={() => setOpen(false)} />;
  // Portal: the host sits inside the sticky top bar, whose stacking context
  // would otherwise trap the modal's fixed overlay.
  return window.ReactDOM && ReactDOM.createPortal ? ReactDOM.createPortal(modal, document.body) : modal;
}

// Link for the bottom of the Help page.
function FB_HelpPageLink() {
  return (
    <div className="card fb-help-card">
      <div>
        <h3 className="card-title" style={{ margin: 0 }}>Found a bug or have an idea?</h3>
        <p className="card-subtitle" style={{ margin: "4px 0 0" }}>
          Tell us what went wrong or what would help. You can check on what you’ve sent under “My feedback”.
        </p>
      </div>
      <button type="button" className="btn-secondary" onClick={FB_openFeedback}>
        Report a bug / feedback
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// New-count badge (admin nav)
// ---------------------------------------------------------------------------
function FB_useNewCount(enabled) {
  const [n, setN] = React.useState(0);
  React.useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = async () => {
      const sb = window.mgbSupabase;
      if (!sb) return;
      const { count, error } = await sb
        .from("staff_feedback")
        .select("id", { count: "exact", head: true })
        .eq("status", "new");
      if (alive && !error) setN(count || 0);
    };
    load();
    const t = setInterval(load, 5 * 60 * 1000);
    window.addEventListener(FB_CHANGED_EVENT, load);
    return () => {
      alive = false;
      clearInterval(t);
      window.removeEventListener(FB_CHANGED_EVENT, load);
    };
  }, [enabled]);
  return n;
}

function FB_NavBadge({ expanded }) {
  const n = FB_useNewCount(true);
  if (!n) return null;
  const label = `${n} new feedback`;
  if (!expanded) return <span className="nav-badge-dot staff-rail-dot" aria-label={label} />;
  return (
    <span className="nav-due-counts" role="img" aria-label={label} title={label}>
      <span className="nav-due-count">{n}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Admin page
// ---------------------------------------------------------------------------
function FB_Row({ row, clientName, authorName, onSaved }) {
  const toast = FB_useToastSafe();
  const [note, setNote] = React.useState(row.admin_note || "");
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => setNote(row.admin_note || ""), [row.admin_note]);
  const dirty = note.trim() !== (row.admin_note || "").trim();

  async function save(patch, okMsg) {
    const sb = window.mgbSupabase;
    if (!sb) return;
    setBusy(true);
    const { data, error } = await sb
      .from("staff_feedback")
      .update(patch)
      .eq("id", row.id)
      .select("id, created_at, updated_at, author_email, kind, message, expected, page, browser, client_id, status, admin_note")
      .single();
    setBusy(false);
    if (error) return toast("Couldn't save: " + error.message);
    onSaved(data);
    window.dispatchEvent(new CustomEvent(FB_CHANGED_EVENT));
    toast(okMsg);
  }

  const pageHref = row.page && /^#\//.test(row.page) ? row.page : null;
  return (
    <li className={"fb-item" + (row.kind === "bug" ? " fb-item-bug" : "") + (row.status === "new" ? " fb-item-new" : "")}>
      <div className="fb-item-head">
        <FB_KindTag kind={row.kind} />
        <span className="fb-item-who">{authorName || row.author_email}</span>
        <span className="fb-dim" title={FB_fullTime(row.created_at)}>{FB_when(row.created_at)}</span>
        {row.client_id && <span className="fb-item-client">{clientName || row.client_id}</span>}
        {pageHref && (
          <a className="fb-item-page" href={pageHref} title="Open the page it was sent from">
            {row.page}
          </a>
        )}
      </div>
      <p className="fb-item-msg">{row.message}</p>
      {row.expected && (
        <p className="fb-item-expected">
          <b>Expected:</b> {row.expected}
        </p>
      )}
      {row.browser && <p className="fb-item-browser">{row.browser}</p>}
      <div className="fb-item-admin">
        <label className="fb-field fb-field-inline">
          <span>Status</span>
          <select
            value={row.status}
            disabled={busy}
            onChange={(e) => save({ status: e.target.value }, "Status updated")}
          >
            {FB_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="fb-field fb-field-grow">
          <span>Note to sender</span>
          <textarea
            rows={1}
            maxLength={FB_MAX}
            value={note}
            disabled={busy}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional. The sender sees this under My feedback."
          />
        </label>
        {dirty && (
          <button
            type="button"
            className="btn-secondary fb-save"
            disabled={busy}
            onClick={() => save({ admin_note: note.trim() || null }, "Note saved")}
          >
            Save note
          </button>
        )}
      </div>
    </li>
  );
}

function FB_FeedbackPage({ clients }) {
  const [filters, setFilters] = React.useState({ status: "", kind: "" });
  const [limit, setLimit] = React.useState(FB_PAGE_SIZE);
  const [st, setSt] = React.useState({ loading: true, rows: [], more: false, error: null });
  const [names, setNames] = React.useState({});
  const [staffNames, setStaffNames] = React.useState({});

  React.useEffect(() => {
    const sb = window.mgbSupabase;
    if (!sb) return;
    sb.from("clients")
      .select("id, name")
      .then(({ data }) => {
        const m = {};
        for (const c of data || []) m[c.id] = c.name;
        setNames(m);
      });
    sb.from("staff")
      .select("email, name")
      .then(({ data }) => {
        const m = {};
        for (const s of data || []) if (s.email) m[s.email] = s.name;
        setStaffNames(m);
      });
  }, []);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      const sb = window.mgbSupabase;
      if (!sb) return alive && setSt({ loading: false, rows: [], more: false, error: null });
      setSt((s) => ({ ...s, loading: true }));
      let q = sb
        .from("staff_feedback")
        .select("id, created_at, updated_at, author_email, kind, message, expected, page, browser, client_id, status, admin_note")
        .order("created_at", { ascending: false })
        .limit(limit + 1);
      if (filters.status) q = q.eq("status", filters.status);
      if (filters.kind) q = q.eq("kind", filters.kind);
      const { data, error } = await q;
      if (!alive) return;
      if (error) return setSt({ loading: false, rows: [], more: false, error: error.message });
      const rows = data || [];
      setSt({ loading: false, rows: rows.slice(0, limit), more: rows.length > limit, error: null });
    })();
    return () => {
      alive = false;
    };
  }, [filters, limit]);

  const clientName = (id) => {
    const c = (clients || []).find((x) => x.id === id);
    return (c && c.name) || names[id] || null;
  };
  const set = (k) => (e) => {
    setFilters((f) => ({ ...f, [k]: e.target.value }));
    setLimit(FB_PAGE_SIZE);
  };
  const filtered = !!(filters.status || filters.kind);
  const onSaved = (updated) =>
    setSt((s) => ({ ...s, rows: s.rows.map((r) => (r.id === updated.id ? updated : r)) }));

  return (
    <div className="al-page fb-page">
      <div className="card">
        <div className="al-filters">
          <label className="al-field">
            <span>Status</span>
            <select value={filters.status} onChange={set("status")}>
              <option value="">All statuses</option>
              {FB_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="al-field">
            <span>Kind</span>
            <select value={filters.kind} onChange={set("kind")}>
              <option value="">All kinds</option>
              {FB_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>
          {filtered && (
            <button
              type="button"
              className="link-btn al-clear"
              onClick={() => {
                setFilters({ status: "", kind: "" });
                setLimit(FB_PAGE_SIZE);
              }}
            >
              Clear filters
            </button>
          )}
        </div>

        {st.error && (
          <p className="al-error" role="alert">
            {st.error}
          </p>
        )}
        {!st.error && st.loading && !st.rows.length && <p className="fb-dim">Loading…</p>}
        {!st.error && !st.loading && !st.rows.length && (
          <p className="fb-dim">{filtered ? "Nothing matches these filters." : "No feedback yet."}</p>
        )}
        {!st.error && st.rows.length > 0 && (
          <ul className="fb-list">
            {st.rows.map((r) => (
              <FB_Row
                key={r.id}
                row={r}
                clientName={r.client_id ? clientName(r.client_id) : null}
                authorName={staffNames[r.author_email]}
                onSaved={onSaved}
              />
            ))}
          </ul>
        )}
        {!st.error && st.more && (
          <div className="al-pager">
            <span className="al-dim">Showing the newest {st.rows.length.toLocaleString()}</span>
            <div className="al-pager-btns">
              <button type="button" className="btn-secondary" disabled={st.loading} onClick={() => setLimit((n) => n + FB_PAGE_SIZE)}>
                {st.loading ? "Loading…" : "Show older"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
