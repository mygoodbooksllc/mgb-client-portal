// ----------------------------------------------------------------------------
// "What we need from you" (Tasks Phase 2, S6; spec C6 and section H).
//
// The client portal's Messages › Requests page, also reached by the emailed
// portal link #/client/<id>/needs[/<request id>] (login ?next= allow-list in
// app.jsx). It lists the client's open requests (questions, documents,
// approvals the bookkeeper asked for with Ask client) and their answered
// history.
//
//   Reply    rpc tk_answer_client_request (client members only; staff in a
//            preview see the page read-only).
//   Upload   drive-files, request branch (DRV_upload, visibility "request"):
//            the file lands in <Client>/<Year>/<Doc type> in Drive and is
//            linked to the request (tk_attach_request_file). An old document
//            request (legacy) is closed by its upload, as before.
//   Live     realtime on client_requests (RLS: client members; column grants
//            on the safe columns) plus a 2-minute poll and the
//            "mgb:client-requests-changed" event.
//
// Data: rpc client_requests_for_client(p_client_id) returns only the fixed
// field list (never emails, task ids or amounts). Rendering is plain text.
//
// Loaded before app.jsx in the shared global scope: every top-level name has
// a CN_ prefix; app.jsx helpers (fmtDate, todayLocal) are read at render time.
// ----------------------------------------------------------------------------

const CN_EVENT = "mgb:client-requests-changed";
const CN_POLL_MS = 2 * 60 * 1000;
const CN_MAX_REPLY = 4000;
const CN_MAX_MB = 25;
const CN_ACCEPT = ".pdf,.png,.jpg,.jpeg,.heic,.heif,.csv,.xls,.xlsx,.doc,.docx,.txt";

function CN_notify() {
  try {
    window.dispatchEvent(new Event(CN_EVENT));
  } catch (e) {}
}

function CN_date(d) {
  if (!d) return "";
  try {
    return typeof fmtDate === "function" ? fmtDate(String(d).slice(0, 10)) : String(d).slice(0, 10);
  } catch (e) {
    return String(d).slice(0, 10);
  }
}

function CN_today() {
  try {
    return typeof todayLocal === "function" ? todayLocal() : new Date().toISOString().slice(0, 10);
  } catch (e) {
    return new Date().toISOString().slice(0, 10);
  }
}

const CN_KIND_LABEL = { question: "Question", document: "Document", approval: "Approval" };

/** Friendly text for an RPC or drive-files error. */
function CN_errorText(err) {
  const m = String((err && (err.code || err.message)) || "");
  if (/tk_reply_required/.test(m)) return "Type an answer or attach a file first.";
  if (/tk_not_open|already closed/.test(m)) return "This request was already answered or closed.";
  if (/tk_forbidden|forbidden/.test(m)) return "You can't answer this request.";
  if (/too_big|25 MB/.test(m)) return "That file is over " + CN_MAX_MB + " MB.";
  if (/bad_type/.test(m)) return "PDF, picture, spreadsheet, Word or text files only.";
  if (err && err.message && err.status) return err.message;
  return "That didn't go through. Try again in a moment.";
}

/** Requests for one client: { rows, loaded, error, reload }. */
function CN_useRequests(clientId) {
  const [state, setState] = React.useState({ rows: [], loaded: false, error: null, clientId: null });
  const seq = React.useRef(0);
  const reload = React.useCallback(() => {
    const sb = window.mgbSupabase;
    if (!clientId || !sb) {
      setState({ rows: [], loaded: true, error: null, clientId: clientId || null });
      return Promise.resolve();
    }
    const my = ++seq.current;
    return sb.rpc("client_requests_for_client", { p_client_id: String(clientId) }).then(
      (res) => {
        if (my !== seq.current) return;
        if (res.error) setState((s) => ({ ...s, loaded: true, error: res.error, clientId }));
        else setState({ rows: Array.isArray(res.data) ? res.data : [], loaded: true, error: null, clientId });
      },
      (e) => {
        if (my === seq.current) setState((s) => ({ ...s, loaded: true, error: e, clientId }));
      },
    );
  }, [clientId]);

  React.useEffect(() => {
    reload();
    if (!clientId) return undefined;
    const sb = window.mgbSupabase;
    let ch = null;
    let t = null;
    const bump = () => {
      clearTimeout(t);
      t = setTimeout(reload, 300);
    };
    try {
      ch = sb
        .channel("cn-requests-" + clientId + "-" + Math.random().toString(36).slice(2, 8))
        .on("postgres_changes", { event: "*", schema: "public", table: "client_requests", filter: "client_id=eq." + clientId }, bump)
        .subscribe();
    } catch (e) {
      ch = null;
    }
    const poll = setInterval(() => {
      if (!document.hidden) reload();
    }, CN_POLL_MS);
    window.addEventListener(CN_EVENT, bump);
    return () => {
      clearTimeout(t);
      clearInterval(poll);
      window.removeEventListener(CN_EVENT, bump);
      try {
        if (ch) sb.removeChannel(ch);
      } catch (e) {}
    };
  }, [clientId, reload]);

  const rows = state.clientId === (clientId || null) ? state.rows : [];
  return { rows, loaded: state.loaded && state.clientId === (clientId || null), error: state.error, reload };
}

/** Open requests only (Home "Needs you", the Messages tab dot). */
function CN_openOf(rows) {
  return (rows || []).filter((r) => r.status === "open");
}

// One open request: prompt, reply box, files, Send.
function CN_OpenCard({ r, clientId, readOnly, canUpload, focused, onOpenDocuments, onChanged }) {
  const [reply, setReply] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState(null);
  const [uploaded, setUploaded] = React.useState([]);
  const ref = React.useRef(null);
  const fileRef = React.useRef(null);
  const today = CN_today();
  const overdue = r.due_date && r.due_date < today;
  const files = Math.max(Number(r.file_count) || 0, uploaded.length);

  React.useEffect(() => {
    if (focused && ref.current) {
      try {
        ref.current.scrollIntoView({ block: "center" });
        ref.current.focus({ preventScroll: true });
      } catch (e) {}
    }
  }, [focused]);

  const upload = async (list) => {
    const picked = Array.from(list || []);
    if (!picked.length) return;
    setMsg(null);
    setBusy(true);
    try {
      for (const file of picked) {
        if (file.size > CN_MAX_MB * 1024 * 1024) throw Object.assign(new Error(""), { code: "too_big" });
        await DRV_upload({ file, clientId, visibility: "request", requestId: r.id });
        setUploaded((u) => u.concat([file.name]));
        try {
          if (typeof MGB_track === "function") MGB_track("client-needs-upload", r.legacy ? "legacy" : "request");
        } catch (e) {}
      }
      setMsg({ ok: true, text: r.legacy ? "Uploaded. Your bookkeeper will review it." : "Attached. Add a note if you like, then Send." });
      onChanged();
    } catch (e) {
      setMsg({ ok: false, text: CN_errorText(e) });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const send = async () => {
    const text = reply.trim();
    if (!text && !files) {
      setMsg({ ok: false, text: "Type an answer or attach a file first." });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const { error } = await window.mgbSupabase.rpc("tk_answer_client_request", { p_id: r.id, p_reply: text });
      if (error) throw error;
      try {
        if (typeof MGB_track === "function") MGB_track("client-needs-answer", files > 0 ? "with-files" : "text");
      } catch (e) {}
      setReply("");
      onChanged();
    } catch (e) {
      setMsg({ ok: false, text: CN_errorText(e) });
    } finally {
      setBusy(false);
    }
  };

  const inputId = "cn-reply-" + r.id;
  return (
    <li className={"cn-card" + (overdue ? " is-overdue" : "") + (focused ? " is-focused" : "")} ref={ref} tabIndex={-1}>
      <div className="cn-card-top">
        <strong className="cn-title">{r.title}</strong>
        <span className="cn-kind">{CN_KIND_LABEL[r.kind] || "Request"}</span>
      </div>
      {r.prompt ? <p className="cn-prompt">{r.prompt}</p> : null}
      <p className="cn-meta">
        {(r.asked_by_first_name ? "Asked by " + r.asked_by_first_name : "Asked") + " on " + CN_date(r.asked_at)}
        {r.due_date ? (
          <span className={overdue ? "cn-due is-late" : "cn-due"}>{(overdue ? " · Overdue, was due " : " · Due ") + CN_date(r.due_date)}</span>
        ) : null}
      </p>
      {readOnly ? (
        <p className="cn-note">Preview: the client answers here.</p>
      ) : r.legacy ? (
        <div className="cn-actions">
          {canUpload ? (
            <label className={"btn-primary cn-file" + (busy ? " is-busy" : "")}>
              {busy ? "Uploading…" : "Upload"}
              <input ref={fileRef} type="file" accept={CN_ACCEPT} disabled={busy} onChange={(e) => upload(e.target.files)} />
            </label>
          ) : null}
          {onOpenDocuments && canUpload ? (
            <button type="button" className="link-btn" onClick={onOpenDocuments}>
              Or upload on Documents
            </button>
          ) : null}
        </div>
      ) : (
        <div className="cn-answer">
          <label className="cn-label" htmlFor={inputId}>
            {r.kind === "approval" ? "Your answer (for example: Approved)" : "Your answer"}
          </label>
          <textarea
            id={inputId}
            className="cn-reply"
            rows={3}
            maxLength={CN_MAX_REPLY}
            value={reply}
            disabled={busy}
            onChange={(e) => setReply(e.target.value)}
            placeholder={r.needs_upload ? "Optional note with your file" : "Type your answer"}
          />
          {files ? <p className="cn-files">{files === 1 ? "1 file attached" : files + " files attached"}</p> : null}
          <div className="cn-actions">
            <button type="button" className="btn-primary" disabled={busy} onClick={send}>
              {busy ? "Sending…" : "Send"}
            </button>
            {canUpload ? (
              <label className={"btn-secondary cn-file" + (busy ? " is-busy" : "")}>
                {r.needs_upload ? "Attach file" : "Attach a file"}
                <input ref={fileRef} type="file" accept={CN_ACCEPT} multiple disabled={busy} onChange={(e) => upload(e.target.files)} />
              </label>
            ) : null}
          </div>
        </div>
      )}
      {msg ? (
        <p className={"cn-msg" + (msg.ok ? " is-ok" : " is-bad")} role={msg.ok ? "status" : "alert"}>
          {msg.text}
        </p>
      ) : null}
    </li>
  );
}

/**
 * Props: clientId, canUpload (the client has the Documents tab), focusId (a
 * request id from the deep link), readOnly (staff preview), onOpenDocuments.
 */
function ClientNeeds({ clientId, canUpload, focusId, readOnly, onOpenDocuments }) {
  const list = CN_useRequests(clientId);
  const open = CN_openOf(list.rows);
  const done = list.rows.filter((r) => r.status === "answered" || r.status === "accepted" || r.status === "uploaded");
  const [showDone, setShowDone] = React.useState(false);

  return (
    <div className="card cn-page" data-tour="client-needs-page">
      <h3 className="card-title cn-head">What we need from you</h3>
      <p className="card-subtitle cn-sub">
        {!list.loaded
          ? "Loading…"
          : open.length
            ? "Your bookkeeper asked for these. Answer each one here; files go straight to your documents."
            : "Nothing is waiting on you right now."}
      </p>
      {list.error && !list.rows.length ? (
        <p className="cn-msg is-bad" role="alert">
          Couldn't load requests.{" "}
          <button type="button" className="link-btn" onClick={list.reload}>
            Try again
          </button>
        </p>
      ) : null}
      {open.length ? (
        <ul className="cn-list">
          {open.map((r) => (
            <CN_OpenCard
              key={r.id}
              r={r}
              clientId={clientId}
              readOnly={!!readOnly}
              canUpload={!!canUpload}
              focused={focusId === r.id}
              onOpenDocuments={onOpenDocuments}
              onChanged={() => {
                list.reload();
                CN_notify();
              }}
            />
          ))}
        </ul>
      ) : null}
      {done.length ? (
        <div className="cn-history">
          <button type="button" className="link-btn" aria-expanded={showDone} onClick={() => setShowDone((v) => !v)}>
            {(showDone ? "Hide" : "Show") + " answered (" + done.length + ")"}
          </button>
          {showDone ? (
            <ul className="cn-done">
              {done.map((r) => (
                <li key={r.id} className="cn-done-row">
                  <span className="cn-done-title">{r.title}</span>
                  <span className="cn-done-meta">
                    {(r.status === "accepted" ? "Done" : r.status === "uploaded" ? "Uploaded, waiting for review" : "Answered") +
                      (r.answered_at ? " · " + CN_date(r.answered_at) : "")}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Slate rhythm slice 4 (c): "Preliminary" badge for a month whose reports went
 * out before everything arrived, with the missing items. Data: rpc
 * tk_client_report_state(p_client_id) returns period, state and plain labels
 * only (a request_id only while that request is still open). The server shows
 * rows to clients only when month_rhythm_enabled is on (or a test client), so
 * this renders nothing at all today. Props: clientId, canOpen (the client has
 * the Messages tab), onOpenRequest(requestId).
 */
function CN_ReportStateCard({ clientId, canOpen, onOpenRequest }) {
  const [rows, setRows] = React.useState([]);
  React.useEffect(() => {
    const sb = window.mgbSupabase;
    setRows([]);
    if (!clientId || !sb) return undefined;
    let live = true;
    const load = () =>
      sb.rpc("tk_client_report_state", { p_client_id: String(clientId) }).then(
        (res) => {
          if (!live || res.error) return;
          const list = typeof TK_clientReportBadges === "function" ? TK_clientReportBadges(res.data) : [];
          setRows(list);
        },
        () => {},
      );
    load();
    window.addEventListener(CN_EVENT, load);
    return () => {
      live = false;
      window.removeEventListener(CN_EVENT, load);
    };
  }, [clientId]);
  if (!rows.length) return null;
  return (
    <div className="cn-report-state" data-tour="client-report-state">
      {rows.map((r) => (
        <div className="card cn-report-card" key={r.period}>
          <div className="cn-report-head">
            <span className="cn-report-badge">Preliminary</span>
            <h3 className="card-title cn-report-title">{"Preliminary reports for " + r.month}</h3>
          </div>
          <p className="card-subtitle cn-report-sub">
            These reports were sent before everything arrived. We will send the full set once these come in.
          </p>
          {r.missing.length ? (
            <ul className="cn-report-missing">
              {r.missing.map((m, i) => (
                <li key={i}>
                  <span className="cn-report-label">{"Missing: " + m.label}</span>
                  {m.request_id && canOpen && typeof onOpenRequest === "function" ? (
                    <>
                      {" "}
                      <button type="button" className="link-btn" onClick={() => onOpenRequest(m.request_id)}>
                        Upload or answer
                      </button>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ))}
    </div>
  );
}
