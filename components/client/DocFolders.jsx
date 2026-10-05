// ----------------------------------------------------------------------------
// Shared Documents folders (owner request 2026-10-05).
//
// Folder names and which folder each document is in, per client, in
// public.document_folders / document_folder_items
// (supabase/document-folders.sql), so the client and every staff member see
// the same folders. Every client starts with five defaults.
//
// Falls back to the old per-browser localStorage copy (app.jsx's
// loadDocFolders / saveDocFolders) when there's no Supabase session or the
// client isn't in the database (prototype sample clients). The first shared
// load copies anything still in this browser's localStorage up, then clears
// it.
//
// Loaded before app.jsx and PageDrop.jsx, sharing one global scope: every
// top-level name has a DF_ prefix, and app.jsx globals are only used at call
// time.
// ----------------------------------------------------------------------------

// Returns { mode: "shared" | "local", folders: [name], assignments: {key: folder} }.
async function DF_load(sb, clientId) {
  const local = () => ({ mode: "local", ...loadDocFolders(clientId) });
  if (!sb || !clientId) return local();
  try {
    const sess = await sb.auth.getSession();
    if (!sess || !sess.data || !sess.data.session) return local();
    const exists = await sb.from("clients").select("id").eq("id", clientId).limit(1);
    if (exists.error || !exists.data || !exists.data.length) return local();
    let [fRes, iRes] = await Promise.all([
      sb.from("document_folders").select("name, sort, created_at").eq("client_id", clientId),
      sb.from("document_folder_items").select("doc_key, folder").eq("client_id", clientId),
    ]);
    if (fRes.error || iRes.error) return local();
    let folders = DF_sortFolders(fRes.data || []);
    const assignments = {};
    (iRes.data || []).forEach((r) => (assignments[r.doc_key] = r.folder));

    // One-time move of this browser's old folders into the shared copy.
    const old = loadDocFolders(clientId);
    if (old.folders.length || Object.keys(old.assignments).length) {
      const newNames = old.folders.filter((n) => !folders.includes(n));
      if (newNames.length) {
        const up = await sb
          .from("document_folders")
          .upsert(
            newNames.map((name, i) => ({ client_id: clientId, name, sort: 100 + i })),
            { onConflict: "client_id,name", ignoreDuplicates: true },
          );
        if (!up.error) folders = folders.concat(newNames);
      }
      const rows = Object.entries(old.assignments)
        .filter(([key, folder]) => !assignments[key] && folders.includes(folder))
        .map(([doc_key, folder]) => ({ client_id: clientId, doc_key, folder }));
      if (rows.length) {
        const up = await sb
          .from("document_folder_items")
          .upsert(rows, { onConflict: "client_id,doc_key", ignoreDuplicates: true });
        if (!up.error) rows.forEach((r) => (assignments[r.doc_key] = r.folder));
      }
      try {
        localStorage.removeItem(docFoldersKey(clientId));
      } catch (e) {}
    }
    return { mode: "shared", folders, assignments };
  } catch (e) {
    return local();
  }
}

function DF_sortFolders(rows) {
  return rows
    .slice()
    .sort((a, b) => a.sort - b.sort || String(a.created_at).localeCompare(String(b.created_at)))
    .map((r) => r.name);
}

// Each writer returns an error message, or null.
async function DF_addFolder(sb, clientId, mode, name, existing) {
  if (mode !== "shared") {
    const cur = loadDocFolders(clientId);
    saveDocFolders(clientId, cur.folders.concat(name), cur.assignments);
    return null;
  }
  const { error } = await sb
    .from("document_folders")
    .insert({ client_id: clientId, name, sort: 100 + (existing || []).length });
  return error ? error.message : null;
}

// Its documents go back to Unfiled (the database cascades the rows away).
async function DF_removeFolder(sb, clientId, mode, name) {
  if (mode !== "shared") {
    const cur = loadDocFolders(clientId);
    const assignments = {};
    Object.entries(cur.assignments).forEach(([k, f]) => {
      if (f !== name) assignments[k] = f;
    });
    saveDocFolders(clientId, cur.folders.filter((f) => f !== name), assignments);
    return null;
  }
  const { error } = await sb.from("document_folders").delete().eq("client_id", clientId).eq("name", name);
  return error ? error.message : null;
}

// Files one or more documents (by key) into a folder, or Unfiled when
// folder is empty.
async function DF_assign(sb, clientId, mode, keys, folder) {
  const list = Array.isArray(keys) ? keys : [keys];
  if (!list.length) return null;
  if (mode !== "shared") {
    const cur = loadDocFolders(clientId);
    list.forEach((k) => {
      if (folder) cur.assignments[k] = folder;
      else delete cur.assignments[k];
    });
    saveDocFolders(clientId, cur.folders, cur.assignments);
    return null;
  }
  const res = folder
    ? await sb.from("document_folder_items").upsert(
        list.map((doc_key) => ({ client_id: clientId, doc_key, folder, updated_at: new Date().toISOString() })),
        { onConflict: "client_id,doc_key" },
      )
    : await sb.from("document_folder_items").delete().eq("client_id", clientId).in("doc_key", list);
  return res.error ? res.error.message : null;
}

// "+ New folder…" from a document's folder menu. onCreate(name) resolves to
// an error message, or null once the folder exists.
function DF_NewFolderModal({ docName, onCreate, onCancel }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    const clean = name.trim();
    if (!clean || busy) return;
    setBusy(true);
    const err = await onCreate(clean);
    setBusy(false);
    if (err) setError(err);
  };
  return (
    <ModalShell onClose={busy ? () => {} : onCancel} labelledBy="df-new-title" className="confirm-modal">
      <form onSubmit={submit}>
        <div className="modal-header">
          <h3 className="card-title" id="df-new-title" style={{ margin: 0 }}>
            New folder
          </h3>
          <button type="button" className="modal-close" onClick={onCancel} aria-label="Close" disabled={busy}>
            ×
          </button>
        </div>
        <div className="modal-body">
          <label className="pd-field">
            <span className="pd-label">Folder name</span>
            <input
              type="text"
              className="hc-input"
              value={name}
              maxLength={60}
              onChange={(e) => {
                setName(e.target.value);
                setError("");
              }}
              disabled={busy}
            />
          </label>
          <p className="card-subtitle" style={{ margin: "8px 0 0" }}>
            {error || `${docName} goes in it. Everyone on this client's Documents page sees the new folder.`}
          </p>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={!name.trim() || busy}>
            {busy ? "Creating…" : "Create and move"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
