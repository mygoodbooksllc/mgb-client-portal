// ----------------------------------------------------------------------------
// Page-wide file drop for staff (owner request 2026-10-05).
//
// Drop a file anywhere in the staff app and a short confirm box asks where it
// goes: which client (the open one by default; on Home and other staff pages
// you pick), which folder, and whether the client can see it. The file then
// lands in that client's Documents, exactly like uploading from the
// Documents page:
//
//   client can see it  -> client-uploads/<client_id>/shared/
//   staff only (default) -> client-uploads/<client_id>/internal/
//
// supabase/staff-only-documents.sql keeps client users out of internal/.
//
// Places that already take a dropped file (the Documents upload box, a
// message thread, Feedback) handle it themselves: their handlers call
// preventDefault, and this listener, on window, sees that and steps aside.
//
// Loaded before app.jsx and shares its global scope, so every top-level name
// carries a PD_ prefix, and app.jsx globals (hooks, ModalShell, useToast,
// formatBytes, loadDocFolders...) are only touched at render or call time.
// ----------------------------------------------------------------------------

const PD_DOCS_CHANGED_EVENT = "mgb:docs-changed";
const PD_MAX_BYTES = 25 * 1024 * 1024; // the bucket's file_size_limit
const PD_MAX_FILES = 10;
// The bucket's allowed_mime_types (supabase/staff-client-tools.sql), with
// extensions as a fallback for browsers that leave File.type empty.
const PD_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/heic",
  "text/csv",
  "text/plain",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];
const PD_EXT_TYPES = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  heic: "image/heic",
  csv: "text/csv",
  txt: "text/plain",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

function PD_typeOf(f) {
  if (f.type && PD_TYPES.includes(f.type)) return f.type;
  const ext = (f.name.split(".").pop() || "").toLowerCase();
  return PD_EXT_TYPES[ext] || null;
}

// Why a file can't be uploaded, or "" if it's fine.
function PD_problem(f) {
  if (!PD_typeOf(f)) return "This file type isn't supported (PDF, images, CSV, text, Excel or Word only).";
  if (f.size > PD_MAX_BYTES) return `Too big (${formatBytes(f.size)}). Files are capped at 25 MB.`;
  return "";
}

function PD_hasFiles(e) {
  const types = e.dataTransfer && e.dataTransfer.types;
  return !!types && Array.prototype.indexOf.call(types, "Files") !== -1;
}

// Uploads files into one client's Documents. Returns { ok, error }.
async function PD_uploadDocs(sb, clientId, files, { staffOnly, folder }) {
  const sub = staffOnly ? "internal" : "shared";
  const { folders, assignments } = loadDocFolders(clientId);
  let ok = 0;
  let error = null;
  for (const f of files) {
    const safe = f.name.replace(/[^\w.\- ]+/g, "_").slice(-120);
    const stored = `${Date.now()}-${safe}`;
    const res = await sb.storage.from("client-uploads").upload(`${clientId}/${sub}/${stored}`, f, {
      upsert: false,
      contentType: PD_typeOf(f) || undefined,
    });
    if (res.error) {
      error = error || res.error.message;
    } else {
      ok += 1;
      // Same keys the Documents page files them under.
      if (folder) assignments["file:" + (staffOnly ? "internal/" : "") + stored] = folder;
    }
  }
  if (folder && ok) saveDocFolders(clientId, folders, assignments);
  return { ok, error };
}

function PD_ConfirmModal({ files, clients, currentClient, onClose }) {
  const showToast = useToast();
  const [clientId, setClientId] = useState(currentClient ? currentClient.id : "");
  const [folder, setFolder] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const client = clients.find((c) => c.id === clientId) || (currentClient && currentClient.id === clientId ? currentClient : null);
  const folders = clientId ? loadDocFolders(clientId).folders : [];
  useEffect(() => setFolder(""), [clientId]);
  const extra = files.length > PD_MAX_FILES ? files.length - PD_MAX_FILES : 0;
  const list = files.slice(0, PD_MAX_FILES).map((f) => ({ f, problem: PD_problem(f) }));
  const good = list.filter((x) => !x.problem).map((x) => x.f);
  const sorted = clients.slice().sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  const upload = async () => {
    if (!client || !good.length || busy) return;
    const sb = window.mgbSupabase;
    const sess = sb ? await sb.auth.getSession() : null;
    if (!sess || !sess.data || !sess.data.session) {
      showToast("Uploading needs a signed-in account.");
      return;
    }
    setBusy(true);
    const { ok, error } = await PD_uploadDocs(sb, client.id, good, { staffOnly: !visible, folder });
    setBusy(false);
    if (ok) {
      window.dispatchEvent(new CustomEvent(PD_DOCS_CHANGED_EVENT, { detail: { clientId: client.id } }));
      showToast(
        `Added ${ok} file${ok === 1 ? "" : "s"} to ${client.name}'s documents` +
          (visible ? ". Their team can see " + (ok === 1 ? "it" : "them") + "." : " (staff only)."),
      );
    }
    if (error) showToast(`Couldn't upload: ${error}`);
    if (ok) onClose();
  };

  return (
    <ModalShell onClose={busy ? () => {} : onClose} labelledBy="pd-title" className="pd-modal">
      <div className="modal-header">
        <h3 className="card-title" id="pd-title" style={{ margin: 0 }}>
          Add {files.length === 1 ? "this file" : `${files.length} files`} to documents
        </h3>
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close" disabled={busy}>
          ×
        </button>
      </div>
      <div className="modal-body pd-body">
        <ul className="pd-files">
          {list.map(({ f, problem }, i) => (
            <li key={i} className={problem ? "has-problem" : ""}>
              <span className="pd-file-name">{f.name}</span>
              <span className="pd-file-meta">{problem || formatBytes(f.size)}</span>
            </li>
          ))}
          {extra > 0 && (
            <li className="has-problem">
              <span className="pd-file-meta">
                {extra} more file{extra === 1 ? "" : "s"} left out. Drop up to {PD_MAX_FILES} at a time.
              </span>
            </li>
          )}
        </ul>

        <label className="pd-field">
          <span className="pd-label">Client</span>
          <select className="hc-input" value={clientId} onChange={(e) => setClientId(e.target.value)} disabled={busy}>
            {!currentClient && <option value="">Choose a client…</option>}
            {currentClient && !clients.some((c) => c.id === currentClient.id) && (
              <option value={currentClient.id}>{currentClient.name}</option>
            )}
            {sorted.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        {folders.length > 0 && (
          <label className="pd-field">
            <span className="pd-label">Folder</span>
            <select className="hc-input" value={folder} onChange={(e) => setFolder(e.target.value)} disabled={busy}>
              <option value="">No folder</option>
              {folders.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="pd-switch">
          <input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} disabled={busy} />
          <span className="pd-switch-track" aria-hidden="true">
            <span />
          </span>
          <span className="pd-switch-text">
            <span className="pd-label">Visible to client</span>
            <span className="pd-help">
              {visible
                ? `Everyone on ${client ? client.name + "'s" : "the client's"} team can see ${good.length === 1 ? "it" : "them"} in Documents.`
                : "Off: only MyGoodBooks staff can see it. You can find it in Documents, marked Staff only."}
            </span>
          </span>
        </label>
      </div>
      <div className="modal-footer">
        <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="btn-primary" onClick={upload} disabled={!client || !good.length || busy}>
          {busy ? "Uploading…" : `Upload${good.length > 1 ? ` ${good.length} files` : ""}`}
        </button>
      </div>
    </ModalShell>
  );
}

// Mounted once by App. enabled is false for client users, while previewing
// a client user, and on pages that take drops themselves (Feedback).
function PD_PageDrop({ enabled, clients, currentClient }) {
  const [hovering, setHovering] = useState(false);
  const [files, setFiles] = useState(null);
  const hideTimer = useRef(null);
  const busyRef = useRef(false);
  busyRef.current = !!files;

  useEffect(() => {
    if (!enabled) return;
    // Another dialog is up (or ours already is): leave the drop alone.
    const blocked = () => busyRef.current || !!document.querySelector(".modal-overlay, [aria-modal='true']");
    const onOver = (e) => {
      if (!PD_hasFiles(e) || e.defaultPrevented || blocked()) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setHovering(true);
      clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => setHovering(false), 250);
    };
    const onDrop = (e) => {
      clearTimeout(hideTimer.current);
      setHovering(false);
      if (!PD_hasFiles(e) || e.defaultPrevented || blocked()) return;
      e.preventDefault();
      const list = Array.from(e.dataTransfer.files || []);
      if (list.length) setFiles(list);
    };
    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDrop);
    return () => {
      clearTimeout(hideTimer.current);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [enabled]);

  if (!enabled) return null;
  return (
    <>
      {hovering && (
        <div className="pd-overlay" aria-hidden="true">
          <div className="pd-overlay-box">
            <strong>Drop to add to {currentClient ? `${currentClient.name}'s` : "a client's"} documents</strong>
            <span>You'll choose the folder and who can see it next.</span>
          </div>
        </div>
      )}
      {files && (
        <PD_ConfirmModal files={files} clients={clients} currentClient={currentClient} onClose={() => setFiles(null)} />
      )}
    </>
  );
}
