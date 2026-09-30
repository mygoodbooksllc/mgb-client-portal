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
//   FB_Shots            thumbnails of a report's screenshots (1-hour signed
//                       URLs); click opens the full image in a new tab.
//
// Screenshots (supabase/feedback-screenshots.sql): up to 3 images per report
// via "Add screenshot", drag-and-drop or paste. On Send the modal uploads them
// to the private feedback-screenshots bucket at <email>/<feedback id>/<n>-<name>
// (the row id is picked up front), then inserts the row with
// attachments = [{path, name, size, type}]. If the insert fails the uploads are
// kept and reused on retry, and nothing typed is lost.
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
const FB_BUCKET = "feedback-screenshots";
const FB_MAX_SHOTS = 3;
const FB_MAX_BYTES = 10 * 1024 * 1024;
const FB_SHOT_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const FB_SIGN_SECONDS = 60 * 60;
const FB_COLS =
  "id, created_at, updated_at, author_email, kind, message, expected, page, browser, client_id, status, admin_note, attachments";

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
// Screenshots
// ---------------------------------------------------------------------------
function FB_uuid() {
  if (window.crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function FB_safeName(name, type) {
  const ext = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" }[type] || "png";
  let base = String(name || "").replace(/\.[^.]*$/, "");
  base = base.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "screenshot";
  return `${base}.${ext}`;
}

function FB_fmtSize(n) {
  if (n >= 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + " MB";
  return Math.max(1, Math.round(n / 1024)) + " KB";
}

// path -> { url, exp } so reopening a list doesn't re-sign every image.
const FB_signCache = {};
async function FB_signPaths(paths) {
  const sb = window.mgbSupabase;
  const now = Date.now();
  const out = {};
  const need = [];
  for (const p of paths) {
    const c = FB_signCache[p];
    if (c && c.exp - now > 5 * 60 * 1000) out[p] = c.url;
    else need.push(p);
  }
  if (need.length && sb) {
    const { data } = await sb.storage.from(FB_BUCKET).createSignedUrls(need, FB_SIGN_SECONDS);
    for (const d of data || []) {
      if (d && d.signedUrl && d.path) {
        FB_signCache[d.path] = { url: d.signedUrl, exp: now + FB_SIGN_SECONDS * 1000 };
        out[d.path] = d.signedUrl;
      }
    }
  }
  return out;
}

// Thumbnails for a saved report. Click opens the full image in a new tab.
function FB_Shots({ attachments }) {
  const list = Array.isArray(attachments) ? attachments.filter((a) => a && a.path) : [];
  const key = list.map((a) => a.path).join("|");
  const [urls, setUrls] = React.useState({});
  React.useEffect(() => {
    if (!list.length) return;
    let alive = true;
    FB_signPaths(list.map((a) => a.path)).then((m) => alive && setUrls(m));
    return () => {
      alive = false;
    };
  }, [key]);
  if (!list.length) return null;
  return (
    <div className="fb-shots" aria-label="Screenshots">
      {list.map((a) => {
        const url = urls[a.path];
        const label = `Open screenshot ${a.name || ""} full size`.trim();
        return url ? (
          <a key={a.path} className="fb-shot" href={url} target="_blank" rel="noopener noreferrer" title={a.name} aria-label={label}>
            <img src={url} alt={a.name || "Screenshot"} loading="lazy" />
          </a>
        ) : (
          <span key={a.path} className="fb-shot fb-shot-loading" title={a.name}>
            <span className="fb-dim">…</span>
          </span>
        );
      })}
    </div>
  );
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
        .select("id, created_at, kind, message, status, admin_note, updated_at, attachments")
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
          <FB_Shots attachments={r.attachments} />
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
  // Row id picked up front so screenshots can be uploaded under it first.
  const [feedbackId] = React.useState(FB_uuid);
  // [{ key, file, name, preview (object URL), path (set once uploaded) }]
  const [shots, setShots] = React.useState([]);
  const [shotMsg, setShotMsg] = React.useState(null);
  const [progress, setProgress] = React.useState(null);
  const [dragging, setDragging] = React.useState(false);
  const fileRef = React.useRef(null);
  const shotsRef = React.useRef(shots);
  shotsRef.current = shots;
  const isBug = kind === "bug";
  const canSend = message.trim().length > 0 && !sending;

  // Free the preview URLs when the modal closes.
  React.useEffect(
    () => () => {
      for (const s of shotsRef.current) if (s.preview) URL.revokeObjectURL(s.preview);
    },
    []
  );

  function addFiles(files) {
    const incoming = Array.from(files || []);
    if (!incoming.length || sending) return;
    const problems = [];
    const room = FB_MAX_SHOTS - shotsRef.current.length;
    const ok = [];
    for (const f of incoming) {
      if (!f || !FB_SHOT_TYPES.includes(f.type)) {
        problems.push(`${(f && f.name) || "That file"} isn’t a PNG, JPEG, WebP or GIF image.`);
      } else if (f.size > FB_MAX_BYTES) {
        problems.push(`${f.name || "That image"} is ${FB_fmtSize(f.size)}. The limit is 10 MB.`);
      } else if (f.size <= 0) {
        problems.push(`${f.name || "That image"} is empty.`);
      } else if (ok.length >= room) {
        problems.push(`You can attach up to ${FB_MAX_SHOTS} screenshots.`);
        break;
      } else {
        ok.push(f);
      }
    }
    if (ok.length) {
      const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
      setShots((cur) => [
        ...cur,
        ...ok.map((f, i) => {
          // Pasted images arrive as "image.png"; give them a useful name.
          const pasted = !f.name || /^image\.(png|jpe?g|gif|webp)$/i.test(f.name);
          return {
            key: FB_uuid(),
            file: f,
            name: pasted ? `screenshot-${stamp}${ok.length > 1 ? "-" + (i + 1) : ""}` : f.name,
            preview: URL.createObjectURL(f),
            path: null,
          };
        }),
      ]);
    }
    setShotMsg(problems.length ? problems.join(" ") : null);
  }

  function removeShot(key) {
    setShots((cur) => {
      const s = cur.find((x) => x.key === key);
      if (s && s.preview) URL.revokeObjectURL(s.preview);
      return cur.filter((x) => x.key !== key);
    });
    setShotMsg(null);
  }

  // Paste an image (Cmd/Ctrl+V) and drop files anywhere while the send form
  // is showing. Plain-text pastes into the boxes still work as usual.
  React.useEffect(() => {
    if (view !== "send") return;
    let depth = 0;
    const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files");
    const onPaste = (e) => {
      const items = Array.from((e.clipboardData && e.clipboardData.items) || []);
      const files = items.filter((it) => it.kind === "file").map((it) => it.getAsFile()).filter(Boolean);
      // Rich text copied from elsewhere can carry an image too; let it paste as text.
      if (!files.length || items.some((it) => it.kind === "string" && it.type === "text/plain")) return;
      e.preventDefault();
      addFiles(files);
    };
    const onEnter = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth += 1;
      setDragging(true);
    };
    const onOver = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    };
    const onLeave = (e) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const onDrop = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      addFiles(e.dataTransfer.files);
    };
    window.addEventListener("paste", onPaste);
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("paste", onPaste);
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [view, sending]);

  async function send() {
    if (!canSend) return;
    const sb = window.mgbSupabase;
    if (!sb) return setError("Not connected. Try again after signing in.");
    setSending(true);
    setError(null);
    try {
      const list = shotsRef.current.slice();
      const attachments = [];
      if (list.length) {
        const { data: s } = await sb.auth.getSession();
        const me = s && s.session && s.session.user ? s.session.user.email : null;
        if (!me) throw new Error("You’re signed out. Sign in again, then press Send.");
        for (let i = 0; i < list.length; i++) {
          const shot = list[i];
          let path = shot.path;
          if (!path) {
            setProgress(`Uploading screenshot ${i + 1} of ${list.length}…`);
            path = `${me}/${feedbackId}/${shot.key.slice(0, 8)}-${FB_safeName(shot.name, shot.file.type)}`;
            const { error: upErr } = await sb.storage
              .from(FB_BUCKET)
              .upload(path, shot.file, { contentType: shot.file.type, upsert: false, cacheControl: "3600" });
            if (upErr) throw new Error(`Couldn’t upload ${shot.name}: ${upErr.message}`);
            // Remember the upload so a retry doesn't upload it again.
            setShots((cur) => cur.map((x) => (x.key === shot.key ? { ...x, path } : x)));
            shotsRef.current = shotsRef.current.map((x) => (x.key === shot.key ? { ...x, path } : x));
          }
          attachments.push({ path, name: String(shot.name).slice(0, 255), size: shot.file.size, type: shot.file.type });
        }
      }
      setProgress(list.length ? "Sending…" : null);
      const { error: err } = await sb.from("staff_feedback").insert({
        id: feedbackId,
        kind,
        message: message.trim().slice(0, FB_MAX),
        expected: isBug && expected.trim() ? expected.trim().slice(0, FB_MAX) : null,
        page,
        browser: isBug ? FB_browserInfo() : null,
        client_id: clientId || null,
        attachments,
      });
      if (err) throw new Error("Couldn't send: " + err.message);
    } catch (e) {
      setSending(false);
      setProgress(null);
      return setError((e && e.message) || "Couldn't send. Try again.");
    }
    setSending(false);
    setProgress(null);
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
          <div className={"fb-attach" + (isBug ? " fb-attach-bug" : "") + (dragging ? " fb-attach-drag" : "")}>
            <div className="fb-attach-top">
              <span className="fb-attach-label">
                Screenshots{" "}
                <span className="fb-dim">
                  ({isBug ? "a picture really helps" : "optional"}, up to {FB_MAX_SHOTS})
                </span>
              </span>
              <button
                type="button"
                className="btn-secondary fb-attach-btn"
                disabled={sending || shots.length >= FB_MAX_SHOTS}
                onClick={() => fileRef.current && fileRef.current.click()}
              >
                Add screenshot
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>
            {shots.length > 0 && (
              <ul className="fb-thumbs">
                {shots.map((s) => (
                  <li key={s.key} className="fb-thumb">
                    <img src={s.preview} alt={s.name} />
                    <span className="fb-thumb-name" title={s.name}>
                      {s.name}
                    </span>
                    <button
                      type="button"
                      className="fb-thumb-x"
                      disabled={sending}
                      onClick={() => removeShot(s.key)}
                      aria-label={`Remove ${s.name}`}
                      title="Remove"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="fb-note">
              {dragging
                ? "Drop the image to attach it."
                : "Drag an image here or paste one. Tip: press ⌘⇧4 (Mac) or Win+Shift+S to grab part of the screen, then paste here."}
            </p>
            {shotMsg && (
              <p className="fb-error" role="alert">
                {shotMsg}
              </p>
            )}
          </div>
          <p className="fb-note">
            {isBug ? "We’ll include the page you’re on and your browser details." : "We’ll include the page you’re on."}
          </p>
          {progress && (
            <p className="fb-note" role="status">
              {progress}
            </p>
          )}
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
            <button type="button" className="btn-secondary" onClick={onClose} disabled={sending}>
              Cancel
            </button>
            <button type="button" className="btn-primary" disabled={!canSend} onClick={send}>
              {sending ? (shots.length ? "Uploading…" : "Sending…") : "Send"}
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
      .select(FB_COLS)
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
      <FB_Shots attachments={row.attachments} />
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
        .select(FB_COLS)
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
