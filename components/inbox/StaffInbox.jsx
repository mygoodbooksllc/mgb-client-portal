// ----------------------------------------------------------------------------
// Unified staff inbox and real client messaging (owner request 2026-09-28).
//
// - StaffInbox: the three-pane inbox on the staff Team Chat page (list, then
//   the conversation, then a context pane). It mixes every person at every
//   client this staffer can see (client_messages, one private thread per
//   person) with the staff Team Chat DMs and groups (useStaffTeamChat and
//   StaffTeamThread in app.jsx, reused as they are). `compact` is the same
//   inbox inside the chat drawer; `lockClientId` limits it to one client, for
//   a client's Messages tab.
// - SI_ChatDrawer: the right-side drawer the staff toolbar's Message button
//   and the bottom-right launcher open over any page.
// - SI_useClientMessaging: the client side (a signed-in client user, staff
//   previewing as one, and the staff sidebar badge), used by App.
//
// Database: supabase/client-messages.sql. Every query tolerates the tables
// being missing (isMissingTableError): the inbox then falls back to the sample
// threads in data.js and says that nothing is saved.
//
// Loaded before app.jsx and shares its global scope, so every top-level name
// here is prefixed (SI_ / si / StaffInbox) and hooks are called as
// React.useState etc. app.jsx globals (useToast, ModalShell, relTime, ...)
// are only touched at render time, after app.jsx has run.
// ----------------------------------------------------------------------------

// Mirrors the client-uploads bucket (staff-client-tools.sql): 25 MB and these
// types. The bucket is the real enforcement; this is the friendly error.
const SI_MAX_BYTES = 25 * 1024 * 1024;
const SI_ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/heic",
  "text/csv",
  "text/plain",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const SI_CHANGED_EVENT = "mgb:client-messages-changed";
const SI_MSG_COLS =
  "id, client_id, participant_email, author_email, author_name, author_kind, body, internal, attachment_path, attachment_name, created_at";
const SI_POLL_MS = 30 * 1000;
const SI_THREAD_PAGE = 200;
let siInstanceSeq = 0;

const siNotifyChanged = () => {
  try {
    window.dispatchEvent(new Event(SI_CHANGED_EVENT));
  } catch (e) {}
};

const siLower = (s) => String(s || "").trim().toLowerCase();

function siInitials(name) {
  const parts = String(name || "")
    .replace(/[^A-Za-z0-9 ]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "?";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (parts[0][0] + last).toUpperCase();
}

// "now", "5m", "2h", "3d", then a short date.
function siShortAgo(iso) {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (!isFinite(t)) return "";
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days <= 7) return `${days}d`;
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function siTime(iso) {
  if (!iso) return "";
  return typeof fmtDateTime === "function" ? fmtDateTime(iso) : new Date(iso).toLocaleString();
}

// Returns an error message, or null if the file can be attached.
function SI_checkFile(file) {
  if (!file) return "No file chosen.";
  const size = typeof formatBytes === "function" ? formatBytes(file.size) : `${file.size} bytes`;
  if (file.size > SI_MAX_BYTES) return `${file.name} is ${size}. Attachments are capped at 25 MB.`;
  // Browsers leave file.type empty for extensions they don't recognise, so an
  // unknown type is rejected rather than waved through.
  if (!SI_ALLOWED_TYPES.has(file.type))
    return `Can't attach ${file.name}. PDF, PNG, JPEG, HEIC, CSV, Excel, Word and text files only.`;
  return null;
}

// The JWT email, which the RLS policies compare author_email / reader_email
// against. Falls back to what the app already knows.
async function siSessionEmail(sb, fallback) {
  try {
    const { data } = await sb.auth.getSession();
    const e = data && data.session && data.session.user && data.session.user.email;
    return e || fallback || "";
  } catch (e) {
    return fallback || "";
  }
}

// <client_id>/messages/<participant email>/<timestamp>-<file name>
async function siUpload(sb, clientId, participant, file) {
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
  const path = `${clientId}/messages/${siLower(participant)}/${Date.now()}-${safe}`;
  const { error } = await sb.storage
    .from("client-uploads")
    .upload(path, file, { upsert: false, contentType: file.type || undefined });
  return { path, error };
}

// Adds a 10-minute signed URL to every row with an attachment.
async function siSignRows(sb, rows) {
  const paths = [...new Set(rows.filter((r) => r.attachment_path).map((r) => r.attachment_path))];
  if (!paths.length) return rows;
  try {
    const { data } = await sb.storage.from("client-uploads").createSignedUrls(paths, 600);
    const byPath = {};
    (data || []).forEach((d) => {
      if (d && d.path && d.signedUrl) byPath[d.path] = d.signedUrl;
    });
    return rows.map((r) => (r.attachment_path ? { ...r, attachment_url: byPath[r.attachment_path] || null } : r));
  } catch (e) {
    return rows;
  }
}

// data.js sample messages ({from, author, date, text}) as client_messages rows.
function siSampleRows(msgs, clientId, email) {
  return (msgs || []).map((m, i) => ({
    id: `sample-${clientId}-${email}-${i}`,
    client_id: clientId,
    participant_email: email,
    author_kind: m.from === "client" ? "client" : "staff",
    author_name: m.author,
    author_email: m.author_email || null,
    body: m.text || "",
    internal: !!m.internal,
    attachment_name: m.attachment ? m.attachment.name : null,
    created_at: m.created_at || (m.date ? `${m.date}T12:00:00` : null),
  }));
}

const siPersonKey = (clientId, email) => `c:${clientId}:${siLower(email)}`;

// A client's contacts: client_users when staff can read it, else the sample
// people in data.js.
function SI_useRoster(clients, enabled) {
  const ids = clients.map((c) => c.id).sort().join(",");
  const [state, setState] = React.useState({ loaded: false, byClient: null });
  React.useEffect(() => {
    const sb = window.mgbSupabase;
    if (!sb || !enabled || !ids) {
      setState({ loaded: true, byClient: null });
      return;
    }
    let alive = true;
    sb.from("client_users")
      .select("email, name, role, client_id, active")
      .in("client_id", ids.split(","))
      .then(
        ({ data, error }) => {
          if (!alive) return;
          if (error) return setState({ loaded: true, byClient: null });
          const by = {};
          (data || []).forEach((r) => {
            (by[r.client_id] || (by[r.client_id] = [])).push(r);
          });
          setState({ loaded: true, byClient: by });
        },
        () => alive && setState({ loaded: true, byClient: null }),
      );
    return () => {
      alive = false;
    };
  }, [ids, enabled]);
  return state;
}

// ----------------------------------------------------------------------------
// One message bubble. Theirs on the left in white; ours on the right in ink;
// an internal note is a dashed gold bubble only staff ever see.
// ----------------------------------------------------------------------------
function SI_Bubble({ row, mine, authorLabel }) {
  const url = row.attachment_url && typeof safeHttpUrl === "function" ? safeHttpUrl(row.attachment_url) : null;
  const clip = typeof PaperclipIcon === "function" ? <PaperclipIcon /> : null;
  return (
    <div className={"si-msg " + (row.internal ? "si-msg-note" : mine ? "si-msg-mine" : "si-msg-theirs")}>
      <div className="si-bubble">
        {row.internal && <div className="si-note-label">Internal note · only staff see this</div>}
        {row.body && <div className="si-bubble-text">{row.body}</div>}
        {row.attachment_name &&
          (url ? (
            <a className="si-attachment" href={url} target="_blank" rel="noreferrer">
              {clip} {row.attachment_name}
            </a>
          ) : (
            <span className="si-attachment">
              {clip} {row.attachment_name}
            </span>
          ))}
      </div>
      <div className="si-msg-meta">
        {authorLabel ? `${authorLabel} · ` : ""}
        {siTime(row.created_at)}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// A client person's thread, staff side: messages, Reply / Note composer,
// attachments, and marking the thread read when it opens.
// ----------------------------------------------------------------------------
function SI_ClientThread({ entry, mode, me, staffUser, sampleRows, onSampleSend, rev, onRows }) {
  const showToast = typeof useToast === "function" ? useToast() : null;
  const toast = (m) => (showToast ? showToast(m) : console.warn(m));
  const sb = window.mgbSupabase;
  const [realRows, setRows] = React.useState(null);
  const rows = mode === "real" ? realRows : sampleRows || [];
  // Keyed on content, not identity: sample rows are rebuilt on every list
  // refresh, and reporting them up re-renders the list.
  const rowsSig = rows ? `${rows.length}:${rows.length ? rows[rows.length - 1].id : ""}` : "none";
  const [loadError, setLoadError] = React.useState("");
  const [draft, setDraft] = React.useState("");
  const [isNote, setIsNote] = React.useState(false);
  const [file, setFile] = React.useState(null);
  const [sending, setSending] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);
  const fileRef = React.useRef(null);
  const endRef = React.useRef(null);
  const textRef = React.useRef(null);

  React.useEffect(() => {
    if (mode !== "real" || !sb) return;
    let alive = true;
    sb.from("client_messages")
      .select(SI_MSG_COLS)
      .eq("client_id", entry.clientId)
      .eq("participant_email", entry.email)
      .order("created_at", { ascending: true })
      .limit(1000)
      .then(async ({ data, error }) => {
        if (!alive) return;
        if (error) {
          setLoadError("Couldn't load this conversation. " + (error.message || ""));
          setRows([]);
          return;
        }
        setLoadError("");
        const signed = await siSignRows(sb, data || []);
        if (alive) setRows(signed);
      });
    // Opening (or receiving into) the thread marks it read for me.
    if (me)
      sb.from("client_message_reads")
        .upsert({
          client_id: entry.clientId,
          participant_email: entry.email,
          reader_email: me,
          last_read_at: new Date().toISOString(),
        })
        .then(({ error }) => {
          if (!error) siNotifyChanged();
        });
    return () => {
      alive = false;
    };
  }, [mode, entry.clientId, entry.email, rev, me]);

  React.useEffect(() => {
    if (onRows) onRows(rows || []);
    const box = endRef.current && endRef.current.parentNode;
    if (box) box.scrollTop = box.scrollHeight;
  }, [rowsSig]);

  const stage = (f) => {
    if (!f) return;
    const err = SI_checkFile(f);
    if (err) return toast(err);
    setFile(f);
  };

  async function send() {
    const body = draft.trim();
    if ((!body && !file) || sending) return;
    if (mode !== "real") {
      onSampleSend &&
        onSampleSend(entry.clientId, entry.userId || entry.email, {
          from: "bookkeeper",
          author: (staffUser && staffUser.name) || "MyGoodBooks",
          author_email: me || (staffUser && staffUser.email) || null,
          date: typeof todayLocal === "function" ? todayLocal() : new Date().toISOString().slice(0, 10),
          created_at: new Date().toISOString(),
          text: body,
          internal: isNote,
          attachment: file ? { name: file.name, size: typeof formatBytes === "function" ? formatBytes(file.size) : "" } : undefined,
        });
      setDraft("");
      setFile(null);
      return;
    }
    if (!sb) return;
    setSending(true);
    try {
      const author = await siSessionEmail(sb, me || (staffUser && staffUser.email));
      let attachment_path = null;
      let attachment_name = null;
      if (file) {
        const up = await siUpload(sb, entry.clientId, entry.email, file);
        if (up.error) {
          toast(`Couldn't upload ${file.name}: ${up.error.message}`);
          return;
        }
        attachment_path = up.path;
        attachment_name = file.name;
      }
      const { error } = await sb.from("client_messages").insert({
        client_id: entry.clientId,
        participant_email: siLower(entry.email),
        author_email: author,
        author_name: (staffUser && staffUser.name) || author,
        author_kind: "staff",
        body,
        internal: isNote,
        attachment_path,
        attachment_name,
      });
      if (error) {
        toast(`Couldn't send: ${error.message}`);
        return;
      }
      setDraft("");
      setFile(null);
      siNotifyChanged();
      const { data } = await sb
        .from("client_messages")
        .select(SI_MSG_COLS)
        .eq("client_id", entry.clientId)
        .eq("participant_email", entry.email)
        .order("created_at", { ascending: true })
        .limit(1000);
      if (data) setRows(await siSignRows(sb, data));
    } catch (err) {
      toast(`Couldn't send: ${(err && err.message) || "unexpected error"}`);
    } finally {
      setSending(false);
      if (textRef.current) textRef.current.focus();
    }
  }

  return (
    <div
      className={"si-convo" + (dragging ? " si-dragging" : "")}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        stage(e.dataTransfer.files && e.dataTransfer.files[0]);
      }}
    >
      <div className="si-messages" aria-live="polite">
        {loadError && <p className="si-muted si-error">{loadError}</p>}
        {rows === null && <p className="si-muted">Loading…</p>}
        {rows && rows.length === 0 && !loadError && (
          <p className="si-muted si-empty-thread">No messages with {entry.name} yet. Say hello.</p>
        )}
        {(rows || []).map((r) => (
          <SI_Bubble
            key={r.id}
            row={r}
            mine={r.author_kind === "staff"}
            authorLabel={r.author_kind === "staff" ? r.author_name || "MyGoodBooks" : r.author_name || entry.name}
          />
        ))}
        <div ref={endRef} />
      </div>

      <div className={"si-composer" + (isNote ? " si-composer-note" : "")}>
        <div className="si-mode" role="radiogroup" aria-label="Reply or internal note">
          <button type="button" role="radio" aria-checked={!isNote} className={!isNote ? "active" : ""} onClick={() => setIsNote(false)}>
            Reply
          </button>
          <button type="button" role="radio" aria-checked={isNote} className={isNote ? "active" : ""} onClick={() => setIsNote(true)}>
            Note
          </button>
          <span className="si-mode-hint">{isNote ? "Only staff see notes" : `${entry.name} will see this`}</span>
        </div>
        {file && (
          <div className="si-file-chip">
            <span>{file.name}</span>
            <button type="button" aria-label="Remove attachment" onClick={() => setFile(null)}>
              ×
            </button>
          </div>
        )}
        <div className="si-compose-row">
          <button type="button" className="si-icon-btn" aria-label="Attach a file" onClick={() => fileRef.current && fileRef.current.click()}>
            {typeof PaperclipIcon === "function" ? <PaperclipIcon /> : "+"}
          </button>
          <input
            ref={fileRef}
            type="file"
            hidden
            onChange={(e) => {
              stage(e.target.files && e.target.files[0]);
              e.target.value = "";
            }}
          />
          <textarea
            ref={textRef}
            rows={1}
            className="si-textarea"
            aria-label={isNote ? "Internal note" : `Reply to ${entry.name}`}
            placeholder={isNote ? "Add an internal note…" : `Reply to ${entry.name}…`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends; Shift+Enter is a new line.
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
          />
          <button type="button" className="si-send" onClick={send} disabled={sending || (!draft.trim() && !file)}>
            {sending ? "Sending…" : isNote ? "Add note" : "Send"}
          </button>
        </div>
      </div>
      {dragging && <div className="si-drop">Drop file to attach</div>}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Context pane for a client thread.
// ----------------------------------------------------------------------------
function SI_ClientContext({ entry, staffUser, rows, onOpenClient }) {
  const client = entry.client;
  const staffTools = typeof useStaffToolList === "function" && typeof staffToolsApi === "object";
  const docs = staffTools
    ? useStaffToolList((sb, id) => staffToolsApi.docRequests(sb, id), client.id)
    : { rows: [], loading: false };
  const period = typeof closePeriodFor === "function" ? closePeriodFor() : null;
  const close = staffTools && period
    ? useStaffToolList((sb, id) => staffToolsApi.closeItems(sb, id, period), client.id)
    : { rows: [], loading: false, missing: true };
  const ms = typeof useMilestones === "function" ? useMilestones([client.id]) : { byId: {} };
  const [tasks, setTasks] = React.useState([]);
  React.useEffect(() => {
    const sb = window.mgbSupabase;
    if (!sb || typeof staffItemsApi !== "object" || !staffUser) return;
    let alive = true;
    const load = () =>
      staffItemsApi.list(sb, staffUser.email).then(({ data }) => {
        if (alive) setTasks((data || []).filter((t) => t.client_id === client.id && !t.done));
      });
    load();
    const evt = typeof STAFF_ITEMS_CHANGED_EVENT === "string" ? STAFF_ITEMS_CHANGED_EVENT : null;
    if (evt) window.addEventListener(evt, load);
    return () => {
      alive = false;
      if (evt) window.removeEventListener(evt, load);
    };
  }, [client.id, staffUser && staffUser.email]);

  const summary = ms.byId && ms.byId[client.id];
  const milestone = summary && summary.current;
  const cash = typeof totalCash === "function" ? totalCash(client) : null;
  const doneCount = (close.rows || []).filter((r) => r.done).length;
  const totalItems = typeof CLOSE_CHECKLIST !== "undefined" ? CLOSE_CHECKLIST.length : 0;
  const bk = client.assignedBookkeeper;
  const bkName = bk ? (typeof bk === "string" ? bk : bk.name) : null;
  const openDocs = (docs.rows || []).filter((r) => r.status === "open");
  const files = (rows || []).filter((r) => r.attachment_name);
  const premium = typeof hasPremiumPlan === "function" && hasPremiumPlan(client, false);

  return (
    <div className="si-ctx-body">
      <div className="si-ctx-org">
        <div className="si-ctx-name">
          {client.name}
          {premium && <span className="nav-pro-pill si-pro">{typeof PLAN_LABELS === "object" ? PLAN_LABELS.premium : "Pro"}</span>}
        </div>
        {milestone && <div className="si-ctx-sub">Milestone {milestone.numeral ? `${milestone.numeral} · ` : ""}{milestone.name}</div>}
      </div>
      <dl className="si-ctx-facts">
        {cash !== null && typeof fmtMoney === "function" && (client.bankAccounts || []).length > 0 && (
          <div>
            <dt>Cash on hand</dt>
            <dd>{fmtMoney(cash)}</dd>
          </div>
        )}
        {period && !close.missing && totalItems > 0 && (
          <div>
            <dt>{typeof closePeriodLabel === "function" ? closePeriodLabel(period) : period} close</dt>
            <dd>
              {doneCount}/{totalItems}
              <span className="si-meter" aria-hidden="true">
                <span style={{ width: `${Math.round((doneCount / totalItems) * 100)}%` }} />
              </span>
            </dd>
          </div>
        )}
        {bkName && (
          <div>
            <dt>Bookkeeper</dt>
            <dd>{bkName}</dd>
          </div>
        )}
      </dl>

      <div className="si-ctx-section">
        <div className="si-ctx-head">Open for them</div>
        {openDocs.length === 0 && tasks.length === 0 ? (
          <p className="si-muted">Nothing open.</p>
        ) : (
          <ul className="si-ctx-list">
            {openDocs.slice(0, 6).map((r) => (
              <li key={"d" + r.id}>
                <span className="si-ctx-kind">Doc</span>
                <span className="si-ctx-text">{r.title}</span>
                {r.due_date && typeof fmtDate === "function" && <span className="si-ctx-when">Due {fmtDate(r.due_date)}</span>}
              </li>
            ))}
            {tasks.slice(0, 6).map((t) => (
              <li key={"t" + t.id}>
                <span className="si-ctx-kind">Task</span>
                <span className="si-ctx-text">{t.text}</span>
                {t.due_date && typeof fmtDate === "function" && <span className="si-ctx-when">Due {fmtDate(t.due_date)}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {typeof TQ_OpenList === "function" && client.dataSource === "quickbooks" && (
        <TQ_OpenList client={client} compact hideEmpty />
      )}

      <div className="si-ctx-section">
        <div className="si-ctx-head">Files in thread</div>
        {files.length === 0 ? (
          <p className="si-muted">No files yet.</p>
        ) : (
          <ul className="si-ctx-list">
            {files.map((r) => {
              const url = r.attachment_url && typeof safeHttpUrl === "function" ? safeHttpUrl(r.attachment_url) : null;
              return (
                <li key={r.id}>
                  {url ? (
                    <a href={url} target="_blank" rel="noreferrer" className="si-ctx-text">
                      {r.attachment_name}
                    </a>
                  ) : (
                    <span className="si-ctx-text">{r.attachment_name}</span>
                  )}
                  <span className="si-ctx-when">{siShortAgo(r.created_at)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="si-ctx-section si-ctx-actions">
        {typeof StaffQuickActions === "function" && (
          <StaffQuickActions client={client} onNavigate={() => {}} only={["request", "task"]} />
        )}
        {onOpenClient && (
          <button type="button" className="si-open-client" onClick={() => onOpenClient(client.id, entry.email)}>
            Open client
          </button>
        )}
      </div>
    </div>
  );
}

// Context pane for a Team Chat conversation: members and shared files.
function SI_TeamContext({ chat }) {
  const entry = chat.activeEntry;
  const [confirm, setConfirm] = React.useState(null); // "retire" | "delete"
  if (!entry) return <p className="si-muted">Loading…</p>;
  const isAdmin = !!(chat.staffUser && chat.staffUser.role === "admin");
  const byEmail = {};
  (chat.directory || []).forEach((d) => (byEmail[d.email] = d));
  const files = (chat.messages || []).filter((m) => m.attachment_name);
  return (
    <div className="si-ctx-body">
      <div className="si-ctx-org">
        <div className="si-ctx-name">{entry.otherName}</div>
        <div className="si-ctx-sub">{entry.isGroup ? entry.otherRole : "Team"}</div>
      </div>
      <div className="si-ctx-section">
        <div className="si-ctx-head">Members</div>
        <ul className="si-ctx-list">
          <li>
            <span className="si-ctx-text">{(chat.staffUser && chat.staffUser.name) || "You"} (you)</span>
          </li>
          {(entry.otherEmails || []).map((e) => (
            <li key={e}>
              {chat.onlineEmails.has(e) && <span className="online-dot" aria-label="Online" />}
              <span className="si-ctx-text">{(byEmail[e] && byEmail[e].name) || e}</span>
              {byEmail[e] && <span className="si-ctx-when">{byEmail[e].role}</span>}
            </li>
          ))}
        </ul>
      </div>
      <div className="si-ctx-section">
        <div className="si-ctx-head">Shared files</div>
        {files.length === 0 ? (
          <p className="si-muted">No files yet.</p>
        ) : (
          <ul className="si-ctx-list">
            {files.map((m) => {
              const url = typeof safeHttpUrl === "function" ? safeHttpUrl(m.attachment_signed_url) : null;
              return (
                <li key={m.id}>
                  {url ? (
                    <a href={url} target="_blank" rel="noreferrer" className="si-ctx-text">
                      {m.attachment_name}
                    </a>
                  ) : (
                    <span className="si-ctx-text">{m.attachment_name}</span>
                  )}
                  <span className="si-ctx-when">{siShortAgo(m.created_at)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {entry.isGroup && entry.id && typeof chat.setGroupRetired === "function" && (
        <div className="si-ctx-section">
          <div className="si-ctx-head">Group</div>
          {entry.retired ? (
            <>
              <p className="si-muted">Retired. Hidden from the inbox and read-only.</p>
              <button type="button" className="si-ctx-action" onClick={() => chat.setGroupRetired(entry.id, false)}>
                Restore group
              </button>
              {isAdmin && (
                <button type="button" className="si-ctx-action si-ctx-danger" onClick={() => setConfirm("delete")}>
                  Delete permanently
                </button>
              )}
            </>
          ) : (
            <button type="button" className="si-ctx-action" onClick={() => setConfirm("retire")}>
              Retire group
            </button>
          )}
        </div>
      )}
      {confirm && typeof ConfirmModal === "function" && (
        <ConfirmModal
          title={confirm === "delete" ? `Delete "${entry.otherName}" for good?` : `Retire "${entry.otherName}"?`}
          body={
            confirm === "delete"
              ? "This removes the group, every message in it and its member list. It can't be undone."
              : "It drops out of everyone's inbox and becomes read-only. Any member can restore it later."
          }
          confirmLabel={confirm === "delete" ? "Delete group" : "Retire group"}
          onConfirm={async () => {
            const kind = confirm;
            setConfirm(null);
            if (kind === "delete") await chat.deleteGroup(entry.id);
            else await chat.setGroupRetired(entry.id, true);
          }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}

// "New message": pick a client contact or a teammate, or start a group.
function SI_NewMessageModal({ people, teammates, teamEnabled, onPickPerson, onPickTeammate, onNewGroup, onClose }) {
  const [q, setQ] = React.useState("");
  const needle = q.trim().toLowerCase();
  const match = (...xs) => !needle || xs.some((x) => String(x || "").toLowerCase().includes(needle));
  const ppl = people.filter((p) => match(p.name, p.email, p.client.name)).slice(0, 60);
  const team = (teammates || []).filter((t) => match(t.name, t.email)).slice(0, 40);
  return (
    <ModalShell onClose={onClose} labelledBy="si-new-title" className="confirm-modal si-new-modal">
      <div className="modal-header">
        <h3 className="card-title" id="si-new-title" style={{ margin: 0 }}>
          New message
        </h3>
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <div className="modal-body">
        <input
          type="search"
          className="si-search"
          placeholder="Search people and clients"
          aria-label="Search people and clients"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="si-new-head">Client contacts</div>
        {ppl.length === 0 ? (
          <p className="si-muted">No matches.</p>
        ) : (
          <ul className="si-new-list">
            {ppl.map((p) => (
              <li key={p.key}>
                <button type="button" onClick={() => onPickPerson(p)}>
                  <span className="si-avatar si-avatar-sm">{siInitials(p.name)}</span>
                  <span className="si-new-name">{p.name}</span>
                  <span className="si-tag">{p.client.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {teamEnabled && (
          <React.Fragment>
            <div className="si-new-head">
              Team
              <button type="button" className="si-link" onClick={onNewGroup}>
                + New group
              </button>
            </div>
            {team.length === 0 ? (
              <p className="si-muted">{teammates ? "No matches." : "Loading teammates…"}</p>
            ) : (
              <ul className="si-new-list">
                {team.map((t) => (
                  <li key={t.email}>
                    <button type="button" onClick={() => onPickTeammate(t)}>
                      <span className="si-avatar si-avatar-sm">{siInitials(t.name)}</span>
                      <span className="si-new-name">{t.name}</span>
                      <span className="si-tag si-tag-team">{t.role || "Team"}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </React.Fragment>
        )}
      </div>
    </ModalShell>
  );
}

// ----------------------------------------------------------------------------
// The inbox.
//
// Props: staffUser, onActivity (Team Chat unread refresh), clients (App's
// visibleClients), compact (drawer), defaultClientId (drawer opened from a
// client page), lockClientId + initialEmail (a client's Messages tab),
// sampleThreads + onSampleSend (App's messagesByClient, for the sample
// fallback), onOpenClient(clientId, email), onClose (drawer).
// ----------------------------------------------------------------------------
function StaffInbox({
  staffUser,
  onActivity,
  clients,
  compact,
  defaultClientId,
  lockClientId,
  initialEmail,
  sampleThreads,
  onSampleSend,
  onOpenClient,
  onClose,
}) {
  const teamEnabled = !lockClientId;
  const chat = useStaffTeamChat(staffUser, onActivity, teamEnabled);
  const allClients = clients || [];
  const scopeClients = React.useMemo(
    () => (lockClientId ? allClients.filter((c) => c.id === lockClientId) : allClients),
    [allClients, lockClientId],
  );
  const idsKey = scopeClients.map((c) => c.id).join(",");
  const roster = SI_useRoster(scopeClients, true);

  const [instance] = React.useState(() => ++siInstanceSeq);
  const [me, setMe] = React.useState((staffUser && staffUser.email) || "");
  const [mode, setMode] = React.useState("loading"); // loading | real | sample
  const [sampleReason, setSampleReason] = React.useState(""); // missing | error | offline
  const [recent, setRecent] = React.useState([]);
  const [reads, setReads] = React.useState({});
  const [rev, setRev] = React.useState(0);
  const [filter, setFilter] = React.useState("all");
  const [query, setQuery] = React.useState("");
  // Retired Team Chat groups stay out of the list unless asked for.
  const [showRetired, setShowRetired] = React.useState(false);
  const [clientFilter, setClientFilter] = React.useState(lockClientId || defaultClientId || null);
  const [sel, setSel] = React.useState(null); // {kind:"client", key} | {kind:"team"}
  const [contextOpen, setContextOpen] = React.useState(() => {
    if (lockClientId) return false;
    try {
      return localStorage.getItem("mgb_inbox_context_v1") !== "0";
    } catch (e) {
      return true;
    }
  });
  const [showNew, setShowNew] = React.useState(false);
  const [threadRows, setThreadRows] = React.useState([]);
  const [viewedSample, setViewedSample] = React.useState(() => new Set());
  const searchRef = React.useRef(null);
  const recentTokenRef = React.useRef(0);

  React.useEffect(() => {
    const sb = window.mgbSupabase;
    if (!sb) return;
    siSessionEmail(sb, staffUser && staffUser.email).then((e) => e && setMe(e));
  }, [staffUser && staffUser.email]);

  const loadRecent = React.useCallback(() => {
    const sb = window.mgbSupabase;
    if (!sb) {
      setMode("sample");
      setSampleReason("offline");
      return;
    }
    if (!idsKey) {
      setMode("real");
      setRecent([]);
      return;
    }
    const ids = idsKey.split(",");
    const token = ++recentTokenRef.current;
    Promise.all([
      sb
        .from("client_messages")
        .select(SI_MSG_COLS)
        .in("client_id", ids)
        .order("created_at", { ascending: false })
        .limit(1500),
      sb
        .from("client_message_reads")
        .select("client_id, participant_email, last_read_at")
        .eq("reader_email", me)
        .in("client_id", ids),
    ])
      .then(([m, r]) => {
        if (token !== recentTokenRef.current) return;
        if (m.error) {
          setMode("sample");
          setSampleReason(typeof isMissingTableError === "function" && isMissingTableError(m.error) ? "missing" : "error");
          return;
        }
        const map = {};
        (r.data || []).forEach((x) => (map[siPersonKey(x.client_id, x.participant_email)] = x.last_read_at));
        setReads(map);
        setRecent(m.data || []);
        setMode("real");
      })
      .catch(() => {
        if (token !== recentTokenRef.current) return;
        setMode("sample");
        setSampleReason("error");
      });
  }, [idsKey, me]);

  React.useEffect(() => {
    loadRecent();
    window.addEventListener(SI_CHANGED_EVENT, loadRecent);
    return () => window.removeEventListener(SI_CHANGED_EVENT, loadRecent);
  }, [loadRecent]);

  // Live: any new message this staffer can see (RLS filters the stream)
  // refreshes the list and the open thread. Polls instead if Realtime can't
  // be joined.
  React.useEffect(() => {
    const sb = window.mgbSupabase;
    if (!sb || mode !== "real") return;
    let poll = null;
    const bump = () => {
      loadRecent();
      setRev((n) => n + 1);
    };
    const channel = sb
      .channel(`si-inbox-${me}-${instance}`, { config: { private: true } })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "client_messages" }, bump)
      .subscribe((status) => {
        if ((status === "CHANNEL_ERROR" || status === "TIMED_OUT") && !poll)
          poll = setInterval(() => !document.hidden && bump(), SI_POLL_MS);
      });
    return () => {
      if (poll) clearInterval(poll);
      sb.removeChannel(channel);
    };
  }, [mode, me, instance, loadRecent]);

  // Every person at every client in scope, with their thread summary.
  const clientEntries = React.useMemo(() => {
    if (mode === "loading") return [];
    const out = [];
    const byThread = {};
    if (mode === "real") {
      recent.forEach((m) => {
        const k = siPersonKey(m.client_id, m.participant_email);
        (byThread[k] || (byThread[k] = [])).push(m); // newest first
      });
    }
    scopeClients.forEach((client) => {
      const people = [];
      const seen = new Set();
      const add = (p) => {
        const email = siLower(p.email);
        if (!email || seen.has(email)) return;
        seen.add(email);
        people.push({ ...p, email });
      };
      const rosterRows = mode === "real" && roster.byClient ? roster.byClient[client.id] || [] : null;
      if (rosterRows) rosterRows.filter((r) => r.active !== false).forEach((r) => add({ name: r.name, role: r.role, email: r.email }));
      else (client.users || []).forEach((u) => add({ name: u.name, role: u.role, email: u.email, userId: u.id }));
      if (mode === "real") {
        // Someone with messages but no active roster row (deactivated, or
        // the roster couldn't be read) still has a thread.
        Object.keys(byThread).forEach((k) => {
          const msgs = byThread[k];
          if (msgs[0].client_id !== client.id) return;
          const fromThem = msgs.find((x) => x.author_kind === "client");
          add({ name: (fromThem && fromThem.author_name) || msgs[0].participant_email, role: "", email: msgs[0].participant_email });
        });
      }
      people.forEach((p) => {
        const key = siPersonKey(client.id, p.email);
        let newestFirst;
        if (mode === "real") newestFirst = byThread[key] || [];
        else {
          const sampleKey = typeof threadKeyFor === "function" ? threadKeyFor(client.id, p.userId) : "";
          const src = (sampleThreads && sampleThreads[sampleKey]) || (typeof seedThread === "function" ? seedThread(client.id, p.userId) : []);
          newestFirst = siSampleRows(src, client.id, p.email).reverse();
        }
        const last = newestFirst[0] || null;
        const lastPublic = newestFirst.find((x) => !x.internal) || null;
        const waiting = !!(lastPublic && lastPublic.author_kind === "client");
        const lastClient = newestFirst.find((x) => x.author_kind === "client");
        const unread =
          mode === "real"
            ? !!(lastClient && (!reads[key] || new Date(lastClient.created_at) > new Date(reads[key])))
            : waiting && !viewedSample.has(key);
        out.push({
          kind: "client",
          key,
          client,
          clientId: client.id,
          email: p.email,
          userId: p.userId,
          name: p.name || p.email,
          role: p.role || "",
          lastAt: last ? last.created_at : null,
          preview: last
            ? (last.internal
                ? "Note: "
                : last.author_kind !== "staff"
                  ? ""
                  : last.author_email && siLower(last.author_email) === siLower(me)
                    ? "You: "
                    : `${String(last.author_name || "MyGoodBooks").split(" ")[0]}: `) +
              (last.body || (last.attachment_name ? `Attachment: ${last.attachment_name}` : ""))
            : "No messages yet",
          waiting,
          waitingSince: waiting ? lastPublic.created_at : null,
          unread,
          sampleRows: mode === "real" ? null : newestFirst.slice().reverse(),
        });
      });
    });
    return out;
  }, [mode, recent, reads, roster, scopeClients, sampleThreads, viewedSample, me]);

  const teamEntries = React.useMemo(
    () =>
      teamEnabled
        ? (chat.conversations || []).filter((c) => !c.retired || showRetired).map((c) => ({
            kind: "team",
            retired: !!c.retired,
            key: "t:" + c.id,
            conv: c,
            name: c.otherName,
            role: c.otherRole,
            lastAt: c.lastAt,
            preview: c.lastText || "No messages yet",
            unread: c.unread,
            online: c.isGroup ? c.otherEmails.some((e) => chat.onlineEmails.has(e)) : chat.onlineEmails.has(c.otherEmail),
          }))
        : [],
    [teamEnabled, chat.conversations, chat.onlineEmails, showRetired],
  );

  const needle = query.trim().toLowerCase();
  const matches = (e) =>
    !needle ||
    [e.name, e.email, e.role, e.client && e.client.name]
      .filter(Boolean)
      .some((x) => String(x).toLowerCase().includes(needle));
  const inClientScope = (e) => !clientFilter || e.kind !== "client" || e.clientId === clientFilter;
  const byRecent = (a, b) =>
    new Date(b.lastAt || 0) - new Date(a.lastAt || 0) || String(a.name).localeCompare(String(b.name));
  const clientList = clientEntries.filter((e) => inClientScope(e) && matches(e));
  const teamList = teamEntries.filter(matches);
  // With a client picked (drawer opened on a client page), the list is that
  // client's people, then team conversations.
  const listed = (filter === "clients" ? clientList : filter === "team" ? teamList : [...clientList, ...teamList]).sort(byRecent);

  // Open a specific person when asked (a client's Messages tab).
  const initialDone = React.useRef(false);
  React.useEffect(() => {
    if (initialDone.current || mode === "loading" || !initialEmail) return;
    const hit = clientEntries.find((e) => e.email === siLower(initialEmail));
    if (hit) {
      initialDone.current = true;
      openEntry(hit);
    }
  }, [mode, clientEntries, initialEmail]);
  // On a client's Messages tab with nothing picked, open the thread that's
  // waiting (or the first person) on a wide screen.
  React.useEffect(() => {
    if (!lockClientId || sel || initialEmail || mode === "loading" || compact) return;
    if (window.matchMedia && window.matchMedia("(max-width: 759px)").matches) return;
    const first = clientEntries.slice().sort(byRecent).find((e) => e.waiting) || clientEntries.slice().sort(byRecent)[0];
    if (first) openEntry(first);
  }, [lockClientId, mode, clientEntries.length]);

  function openEntry(e) {
    setThreadRows([]);
    if (e.kind === "client") {
      setSel({ kind: "client", key: e.key });
      if (mode !== "real") setViewedSample((prev) => new Set(prev).add(e.key));
    } else {
      setSel({ kind: "team" });
      chat.selectConversation(e.conv);
    }
  }

  const selEntry = sel && sel.kind === "client" ? clientEntries.find((e) => e.key === sel.key) : null;
  const teamActive = sel && sel.kind === "team";
  const hasSel = !!(selEntry || teamActive);

  const toggleContext = () => {
    setContextOpen((v) => {
      try {
        localStorage.setItem("mgb_inbox_context_v1", v ? "0" : "1");
      } catch (e) {}
      return !v;
    });
  };

  const counts = { all: clientList.length + teamList.length, clients: clientList.length, team: teamList.length };
  const scopedClient = clientFilter && allClients.find((c) => c.id === clientFilter);

  const header = selEntry ? (
    <React.Fragment>
      <span className="si-avatar">{siInitials(selEntry.name)}</span>
      <span className="si-head-main">
        <span className="si-head-name">{selEntry.name}</span>
        <span className="si-head-sub">
          {[selEntry.client.name, selEntry.role].filter(Boolean).join(" · ")}
        </span>
      </span>
    </React.Fragment>
  ) : teamActive ? (
    <React.Fragment>
      <span className="si-avatar si-avatar-team">
        {siInitials(chat.activeEntry ? chat.activeEntry.otherName : "…")}
        {chat.activeEntry &&
          (chat.activeEntry.isGroup
            ? chat.activeEntry.otherEmails.some((e) => chat.onlineEmails.has(e))
            : chat.onlineEmails.has(chat.activeEntry.otherEmail)) && <span className="online-dot" aria-label="Online" />}
      </span>
      <span className="si-head-main">
        <span className="si-head-name">{chat.activeEntry ? chat.activeEntry.otherName : "Opening…"}</span>
        <span className="si-head-sub">
          {["Team", chat.activeEntry && chat.activeEntry.otherRole].filter(Boolean).join(" · ")}
        </span>
      </span>
    </React.Fragment>
  ) : null;

  return (
    <div
      className={
        "si-root" +
        (compact ? " si-compact" : "") +
        (lockClientId ? " si-locked" : "") +
        (hasSel ? " si-has-sel" : "") +
        (hasSel && contextOpen && !compact ? " si-ctx-open" : "")
      }
    >
      <section className="si-list-pane" aria-label="Conversations">
        <div className="si-list-head">
          <h2 className="si-title">{lockClientId || !compact ? "Conversations" : "Inbox"}</h2>
          <button type="button" className="si-new-btn" onClick={() => setShowNew(true)}>
            + New
          </button>
          {onClose && (
            <button type="button" className="si-icon-btn si-close" aria-label="Close chat" onClick={onClose}>
              ×
            </button>
          )}
        </div>
        <input
          ref={searchRef}
          type="search"
          className="si-search"
          placeholder="Search people and clients"
          aria-label="Search people and clients"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          data-si-autofocus=""
        />
        {teamEnabled && (
          <div className="si-filters" role="group" aria-label="Show">
            {[
              ["all", "All"],
              ["clients", "Clients"],
              ["team", "Team"],
            ].map(([k, label]) => (
              <button
                key={k}
                type="button"
                className={"si-filter" + (filter === k ? " active" : "")}
                aria-pressed={filter === k}
                onClick={() => setFilter(k)}
              >
                {label} <span className="si-count">{counts[k]}</span>
              </button>
            ))}
          </div>
        )}
        {scopedClient && !lockClientId && (
          <div className="si-scope-chip">
            <span>{scopedClient.name}</span>
            <button type="button" aria-label="Show every client" onClick={() => setClientFilter(null)}>
              ×
            </button>
          </div>
        )}
        {mode === "sample" && (
          <p className="si-sample-note">
            {sampleReason === "missing"
              ? "Client messaging isn't set up yet, so these are sample threads and nothing you send is saved."
              : "Couldn't reach client messages, so these are sample threads and nothing you send is saved."}
          </p>
        )}
        <ul className="si-list">
          {mode === "loading" && <li className="si-muted si-list-note">Loading…</li>}
          {mode !== "loading" && listed.length === 0 && (
            <li className="si-muted si-list-note">{needle ? "No matches." : "No conversations yet."}</li>
          )}
          {listed.map((e) => {
            const active =
              (e.kind === "client" && selEntry && selEntry.key === e.key) ||
              (e.kind === "team" && teamActive && chat.activeConversationId === e.conv.id);
            return (
              <li key={e.key}>
                <button
                  type="button"
                  className={"si-item" + (active ? " active" : "") + (e.unread ? " unread" : "")}
                  aria-current={active ? "true" : undefined}
                  onClick={() => openEntry(e)}
                >
                  <span className={"si-avatar" + (e.kind === "team" ? " si-avatar-team" : "")}>
                    {siInitials(e.name)}
                    {e.online && <span className="online-dot" aria-label="Online" />}
                  </span>
                  <span className="si-item-main">
                    <span className="si-item-top">
                      <span className="si-item-name">{e.name}</span>
                      <span className="si-item-time">{siShortAgo(e.lastAt)}</span>
                    </span>
                    <span className="si-item-tags">
                      {e.kind === "client" ? (
                        !lockClientId && <span className="si-tag">{e.client.name}</span>
                      ) : (
                        <span className="si-tag si-tag-team">{e.retired ? "Retired" : "Team"}</span>
                      )}
                      {e.role && <span className="si-item-role">{e.role}</span>}
                    </span>
                    <span className="si-item-preview">{e.preview}</span>
                    {e.waiting && <span className="si-waiting">Waiting on you · {siShortAgo(e.waitingSince)}</span>}
                  </span>
                  {e.unread && <span className="si-dot" aria-label="Unread" />}
                </button>
              </li>
            );
          })}
          {teamEnabled && (chat.conversations || []).some((c) => c.retired) && (
            <li className="si-list-note">
              <button type="button" className="si-retired-toggle" onClick={() => setShowRetired((v) => !v)}>
                {showRetired
                  ? "Hide retired groups"
                  : `Show retired groups (${(chat.conversations || []).filter((c) => c.retired).length})`}
              </button>
            </li>
          )}
        </ul>
      </section>

      <section className="si-thread-pane" aria-label="Conversation">
        {!hasSel ? (
          <div className="si-empty">
            <p className="si-empty-title">Pick a conversation</p>
            <p className="si-muted">Client threads and team chats are all here.</p>
          </div>
        ) : (
          <React.Fragment>
            <div className="si-thread-head">
              <button type="button" className="si-icon-btn si-back" aria-label="Back to conversations" onClick={() => setSel(null)}>
                ‹
              </button>
              {header}
              {!compact && (
                <button
                  type="button"
                  className={"si-icon-btn si-ctx-toggle" + (contextOpen ? " active" : "")}
                  aria-pressed={contextOpen}
                  aria-label={contextOpen ? "Hide details" : "Show details"}
                  onClick={toggleContext}
                >
                  i
                </button>
              )}
            </div>
            {selEntry && (
              <SI_ClientThread
                key={selEntry.key + ":" + mode}
                entry={selEntry}
                mode={mode}
                me={me}
                staffUser={staffUser}
                sampleRows={selEntry.sampleRows}
                onSampleSend={onSampleSend}
                rev={rev}
                onRows={setThreadRows}
              />
            )}
            {teamActive && (
              <div className="si-convo si-team">
                {chat.activeConversationId ? <StaffTeamThread chat={chat} hideTitle /> : <p className="si-muted">Opening…</p>}
              </div>
            )}
          </React.Fragment>
        )}
      </section>

      {!compact && hasSel && contextOpen && (
        <aside className="si-context-pane" aria-label="Details">
          {selEntry ? (
            <SI_ClientContext entry={selEntry} staffUser={staffUser} rows={threadRows} onOpenClient={onOpenClient} />
          ) : (
            <SI_TeamContext chat={chat} />
          )}
        </aside>
      )}

      {showNew && (
        <SI_NewMessageModal
          people={clientEntries}
          teammates={chat.directory}
          teamEnabled={teamEnabled}
          onClose={() => setShowNew(false)}
          onPickPerson={(p) => {
            setShowNew(false);
            if (clientFilter && p.clientId !== clientFilter && !lockClientId) setClientFilter(null);
            setFilter((f) => (f === "team" ? "all" : f));
            openEntry(p);
          }}
          onPickTeammate={(t) => {
            setShowNew(false);
            const existing = (chat.conversations || []).find((c) => !c.isGroup && c.otherEmail === t.email);
            setSel({ kind: "team" });
            chat.selectConversation(existing || { id: null, otherEmail: t.email });
          }}
          onNewGroup={() => {
            setShowNew(false);
            chat.setShowGroupModal(true);
          }}
        />
      )}
      {teamEnabled && chat.showGroupModal && typeof GroupComposeModal === "function" && (
        <GroupComposeModal
          directory={chat.directory || []}
          onCreate={async (emails, title) => {
            await chat.createGroup(emails, title);
            setSel({ kind: "team" });
          }}
          onClose={() => chat.setShowGroupModal(false)}
        />
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Chat drawer: the compact inbox over any page. Esc or a click outside closes
// it; Tab stays inside while it's open; focus returns where it was.
// ----------------------------------------------------------------------------
function SI_ChatDrawer({ onClose, ...inboxProps }) {
  const panelRef = React.useRef(null);
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;
  React.useEffect(() => {
    const panel = panelRef.current;
    const restore = document.activeElement;
    const first = panel && panel.querySelector("[data-si-autofocus]");
    if (first) first.focus();
    const onKey = (e) => {
      // A modal opened from inside the drawer handles its own Esc first
      // (ModalShell stops it in the capture phase).
      if (e.key === "Escape" && !e.defaultPrevented) {
        if (document.querySelector(".modal-overlay")) return;
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !panel || document.querySelector(".modal-overlay")) return;
      const items = [
        ...panel.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
      ].filter((el) => !el.disabled && el.offsetParent !== null);
      if (!items.length) return;
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (!panel.contains(document.activeElement)) {
        e.preventDefault();
        firstEl.focus();
      } else if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (restore && typeof restore.focus === "function") restore.focus();
    };
  }, []);
  return ReactDOM.createPortal(
    <div className="si-drawer-layer">
      <div className="si-drawer-scrim" onClick={onClose} aria-hidden="true" />
      <div className="si-drawer" role="dialog" aria-modal="true" aria-label="Messages" ref={panelRef}>
        <StaffInbox {...inboxProps} compact onClose={onClose} />
      </div>
    </div>,
    document.body,
  );
}

// Bottom-right launcher for the drawer (staff only; replaces the client
// ChatFab for staff so there's one chat bubble, not two).
function SI_ChatLauncher({ onOpen, unread }) {
  return (
    <button type="button" className="si-launcher" onClick={onOpen} aria-label={unread ? "Messages, unread" : "Messages"}>
      {typeof ChatIcon === "function" ? <ChatIcon width="22" height="22" strokeWidth="1.6" /> : "Chat"}
      {unread && <span className="si-launcher-dot" aria-hidden="true" />}
    </button>
  );
}

// ----------------------------------------------------------------------------
// Client side, used by App.
//
// role "client":  a signed-in client user reading and writing their own
//                 thread (realtime, read markers, unread badge).
// role "preview": staff previewing as one of the client's people. Real rows
//                 only if that person has any (sample people never do), and
//                 read-only: staff reply from the inbox.
// role "staff":   the bookkeeper view of a client, for the sidebar badge:
//                 how many of this client's threads are waiting on staff.
//
// status: off | loading | real | sample (table missing, an error, or a
// preview with no real rows). App keeps its sample behaviour unless "real".
// ----------------------------------------------------------------------------
function SI_useClientMessaging({ enabled, role, clientId, email, name, active, refreshKey }) {
  const em = siLower(email);
  const on = !!(enabled && clientId && (role === "staff" || em) && window.mgbSupabase);
  const [state, setState] = React.useState({ status: on ? "loading" : "off", rows: [], readAt: null, waitingCount: 0 });
  const [me, setMe] = React.useState("");
  // The thread loads its newest SI_THREAD_PAGE messages; "Load earlier"
  // raises this a page at a time.
  const [limit, setLimit] = React.useState(SI_THREAD_PAGE);
  const tokenRef = React.useRef(0);

  React.useEffect(() => {
    const sb = window.mgbSupabase;
    if (!sb || !on) return;
    siSessionEmail(sb, "").then(setMe);
  }, [on]);

  React.useEffect(() => setLimit(SI_THREAD_PAGE), [clientId, em]);

  const load = React.useCallback(() => {
    const sb = window.mgbSupabase;
    if (!on || !sb) {
      setState({ status: "off", rows: [], readAt: null, waitingCount: 0 });
      return;
    }
    const token = ++tokenRef.current;
    const stale = () => token !== tokenRef.current;
    // A signed-in client never falls back to the sample thread: they'd be
    // chatting with a made-up bookkeeper. They get an error with a retry.
    const fail = (error) =>
      !stale() &&
      setState({
        status: role === "client" ? "error" : "sample",
        reason: error && typeof isMissingTableError === "function" && isMissingTableError(error) ? "missing" : "error",
        rows: [],
        readAt: null,
        waitingCount: 0,
      });
    if (role === "staff") {
      Promise.all([
        sb
          .from("client_messages")
          .select("client_id, participant_email, author_kind, created_at")
          .eq("client_id", clientId)
          .eq("internal", false)
          .order("created_at", { ascending: false })
          .limit(500),
        me
          ? sb.from("client_message_reads").select("participant_email, last_read_at").eq("client_id", clientId).eq("reader_email", me)
          : Promise.resolve({ data: [] }),
      ])
        .then(([m, r]) => {
          if (stale()) return;
          if (m.error) return fail(m.error);
          const readBy = {};
          (r.data || []).forEach((x) => (readBy[x.participant_email] = x.last_read_at));
          const lastBy = {};
          (m.data || []).forEach((x) => {
            if (!lastBy[x.participant_email]) lastBy[x.participant_email] = x;
          });
          const waitingCount = Object.values(lastBy).filter(
            (x) =>
              x.author_kind === "client" &&
              (!readBy[x.participant_email] || new Date(x.created_at) > new Date(readBy[x.participant_email])),
          ).length;
          setState({ status: "real", rows: [], readAt: null, waitingCount });
        })
        .catch(fail);
      return;
    }
    Promise.all([
      sb
        .from("client_messages")
        .select(SI_MSG_COLS)
        .eq("client_id", clientId)
        .eq("participant_email", em)
        // RLS already hides notes from clients; this also hides them from
        // staff previewing as the client.
        .eq("internal", false)
        // Newest first so the limit keeps the latest; one extra row says
        // whether there's more to load.
        .order("created_at", { ascending: false })
        .limit(limit + 1),
      sb
        .from("client_message_reads")
        .select("reader_email, last_read_at")
        .eq("client_id", clientId)
        .eq("participant_email", em),
    ])
      .then(async ([m, r]) => {
        if (stale()) return;
        if (m.error) return fail(m.error);
        const newest = m.data || [];
        const hasMore = newest.length > limit;
        const rows = newest
          .slice(0, limit)
          .reverse()
          .filter((x) => !x.internal);
        if (role === "preview" && rows.length === 0)
          return setState({ status: "sample", reason: "none", rows: [], readAt: null, waitingCount: 0 });
        // The person's own read marker (their JWT email is the participant).
        const mine = (r.data || []).find((x) => siLower(x.reader_email) === em);
        const signed = await siSignRows(sb, rows);
        if (stale()) return;
        setState({ status: "real", rows: signed, readAt: mine ? mine.last_read_at : null, waitingCount: 0, hasMore });
      })
      .catch(fail);
  }, [on, role, clientId, em, me, limit]);

  const retry = React.useCallback(() => {
    setState((s) => ({ ...s, status: "loading" }));
    load();
  }, [load]);
  const loadEarlier = React.useCallback(() => setLimit((n) => n + SI_THREAD_PAGE), []);

  React.useEffect(() => {
    load();
    window.addEventListener(SI_CHANGED_EVENT, load);
    return () => window.removeEventListener(SI_CHANGED_EVENT, load);
  }, [load, refreshKey]);

  // Realtime for the signed-in client: new rows in their org arrive here and
  // RLS drops everything that isn't their own, non-internal thread. The topic
  // name matches the realtime.messages policy in
  // supabase/client-messages-realtime.sql. Polls instead if it can't join.
  React.useEffect(() => {
    const sb = window.mgbSupabase;
    if (!sb || !on || role !== "client" || state.status === "sample") return;
    let poll = null;
    const startPoll = () => {
      if (!poll) poll = setInterval(() => !document.hidden && load(), SI_POLL_MS);
    };
    const channel = sb
      .channel("client-msgs-" + em, { config: { private: true } })
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "client_messages", filter: `client_id=eq.${clientId}` },
        () => load(),
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") startPoll();
      });
    return () => {
      if (poll) clearInterval(poll);
      sb.removeChannel(channel);
    };
  }, [on, role, clientId, em, state.status === "sample", load]);

  const rows = state.rows;
  const lastStaff = [...rows].reverse().find((x) => x.author_kind === "staff");
  const unread =
    state.status === "real" &&
    role !== "staff" &&
    !!(lastStaff && rows[rows.length - 1] === lastStaff && (!state.readAt || new Date(lastStaff.created_at) > new Date(state.readAt)));

  const markRead = React.useCallback(() => {
    const sb = window.mgbSupabase;
    if (!sb || role !== "client" || state.status !== "real") return;
    const now = new Date().toISOString();
    siSessionEmail(sb, em).then((reader) =>
      sb
        .from("client_message_reads")
        .upsert({ client_id: clientId, participant_email: em, reader_email: reader, last_read_at: now })
        .then(({ error }) => {
          if (!error) setState((s) => ({ ...s, readAt: now }));
        }),
    );
  }, [role, state.status, clientId, em]);

  React.useEffect(() => {
    if (active && unread) markRead();
  }, [active, unread, markRead]);

  // Resolves to an error message, or null once the message is saved.
  const send = React.useCallback(
    async (text, attachment) => {
      const sb = window.mgbSupabase;
      if (!sb || role !== "client") return "You can't send from here.";
      try {
        const author = await siSessionEmail(sb, em);
        let attachment_path = null;
        let attachment_name = null;
        const file = attachment && attachment.file;
        if (file) {
          const err = SI_checkFile(file);
          if (err) return err;
          const up = await siUpload(sb, clientId, em, file);
          if (up.error) return `Couldn't upload ${file.name}: ${up.error.message}`;
          attachment_path = up.path;
          attachment_name = file.name;
        }
        const { error } = await sb.from("client_messages").insert({
          client_id: clientId,
          participant_email: em,
          author_email: author,
          author_name: name || null,
          author_kind: "client",
          body: text || "",
          internal: false,
          attachment_path,
          attachment_name,
        });
        if (error) return `Couldn't send: ${error.message}`;
        load();
        return null;
      } catch (err) {
        return `Couldn't send: ${(err && err.message) || "unexpected error"}`;
      }
    },
    [role, clientId, em, name, load],
  );

  // In the shape MessagesPage already renders.
  const messages = React.useMemo(
    () =>
      rows.map((x) => ({
        id: x.id,
        from: x.author_kind === "client" ? "client" : "bookkeeper",
        author: x.author_name || (x.author_kind === "client" ? "You" : "MyGoodBooks"),
        date: String(x.created_at || "").slice(0, 10),
        created_at: x.created_at,
        text: x.body,
        attachment: x.attachment_name ? { name: x.attachment_name, url: x.attachment_url || null } : undefined,
      })),
    [rows],
  );

  return {
    status: state.status,
    reason: state.reason,
    messages,
    unread,
    lastId: rows.length ? rows[rows.length - 1].id : null,
    lastText: lastStaff ? lastStaff.body || lastStaff.attachment_name || "" : "",
    waitingCount: state.waitingCount,
    readOnly: role !== "client",
    hasMore: !!state.hasMore,
    loadEarlier,
    retry,
    markRead,
    send,
    checkFile: SI_checkFile,
  };
}
