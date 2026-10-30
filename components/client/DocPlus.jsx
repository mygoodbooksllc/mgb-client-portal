// ----------------------------------------------------------------------------
// Staff Documents upgrades (docs/client-page-drop.md, "Scope B").
//
// Behind the gate in CPD_gate.js: a staff member's preview flag
// (mgb_clientdrop_preview) or the firm switch. With both off, DocumentsPage
// renders exactly as before; nothing in this file runs.
//
//   - Rename a file (display name only; Drive and the original name stay):
//     client_file_rename. Links rename client_documents.name.
//   - Rename a folder (its files go with it: ON UPDATE CASCADE).
//     Both renames need the firm switch on for that client (the client sees
//     the new name); with the preview alone they open read-only.
//   - Select several rows: move to a folder, move to Trash, restore.
//   - Type tag (PDF, Excel, ...) beside the document type.
//   - "Who can see" badge, the per-file rule, and per-login rules on staff
//     uploads. Saving a rule needs the firm switch on for that client (the
//     database refuses otherwise); the preview alone shows it read-only.
//   - Replace with a new version: uploads the new file with the same type,
//     year, name, folder, rule and uploader, then moves the old one to Trash.
//   - Copy link (the deep link to the row).
//   - History: uploads, renames, rule changes, trash and restore.
//
// Shared Babel scope: every top-level name has a DP_ prefix. Uses CPD_*
// (clientPageDropLogic.js, ClientPageDrop.jsx) and app.jsx globals
// (ModalShell, LK_href) at render or call time only.
// ----------------------------------------------------------------------------

// { [file id]: [emails] } for the client's restricted files (staff read
// client_file_access directly). null until the first read lands (View as
// hides every restricted file until then); a refetch keeps the old map.
function DP_useAccessRows(sb, clientId, on, tick) {
  const [rows, setRows] = React.useState(null);
  const lastClient = React.useRef(clientId);
  React.useEffect(() => {
    let dead = false;
    if (!on || !sb || !clientId) return;
    // Another client: forget the last one's rows while this one loads.
    if (lastClient.current !== clientId) {
      lastClient.current = clientId;
      setRows(null);
    }
    sb.from("client_file_access")
      .select("file_id, email")
      .eq("client_id", clientId)
      .limit(5000)
      .then((res) => {
        if (dead || !res || res.error) return;
        const map = {};
        (res.data || []).forEach((r) => {
          (map[r.file_id] = map[r.file_id] || []).push(String(r.email).toLowerCase());
        });
        setRows(map);
      });
    return () => {
      dead = true;
    };
  }, [sb, clientId, on, tick]);
  return rows;
}

// The "⋯" row menu. items: [{ label, onClick, disabled }]. off: the firm
// switch is off for this client (Rename and Who can see it open read-only);
// marks the menu data-cpd-off so the row-menu tip can say so.
// The list is position: fixed (placed from the button) so the table's
// scroll box never clips it; it opens upward when there's no room below and
// closes on scroll or resize.
function DP_RowMenu({ label, items, off }) {
  const [pos, setPos] = React.useState(null);
  const open = !!pos;
  const ref = React.useRef(null);
  const btnRef = React.useRef(null);
  const close = () => setPos(null);
  const toggle = () => {
    if (open) return close();
    const r = btnRef.current ? btnRef.current.getBoundingClientRect() : null;
    if (!r) return;
    const h = items.length * 37 + 10;
    const up = r.bottom + 4 + h > window.innerHeight && r.top - 4 - h > 0;
    const right = Math.max(8, window.innerWidth - r.right);
    setPos(up ? { right, bottom: window.innerHeight - r.top + 4 } : { right, top: r.bottom + 4 });
  };
  React.useEffect(() => {
    if (!open) return;
    const away = (e) => {
      if (ref.current && !ref.current.contains(e.target)) close();
    };
    const esc = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
        if (btnRef.current) btnRef.current.focus();
      }
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc, true);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);
  return (
    <span className="dp-menu" data-tour="doc-row-menu" data-cpd-off={off ? "" : undefined} ref={ref} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <button ref={btnRef} type="button" className="dp-menu-btn" aria-haspopup="menu" aria-expanded={open} aria-label={label} title="More" onClick={toggle}>
        ⋯
      </button>
      {open && (
        <span className="dp-menu-list" role="menu" style={pos}>
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              disabled={it.disabled}
              onClick={() => {
                close();
                it.onClick();
              }}
            >
              {it.label}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

// One text field + Save. validate(value) -> error | null; onSave(value) ->
// error | null (async). canSave false (switch off for this client): the
// field is read-only, Save is off and offNote says why.
function DP_RenameModal({ title, label, initial, hint, maxLength, validate, onSave, onClose, canSave = true, offNote }) {
  const [value, setValue] = React.useState(initial || "");
  const [err, setErr] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (busy || !canSave) return;
    const v = value.trim();
    const bad = validate ? validate(v) : null;
    if (bad) return setErr(bad);
    setBusy(true);
    const res = await onSave(v);
    setBusy(false);
    if (res) return setErr(res);
    onClose();
  };
  return (
    <ModalShell onClose={() => !busy && onClose()} labelledBy="dp-rename-title">
      <form onSubmit={submit}>
        <div className="modal-header">
          <h3 id="dp-rename-title">{title}</h3>
          <button type="button" className="modal-close" onClick={() => !busy && onClose()} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body cpd-body">
          <div className="cpd-field">
            <label className="cpd-label" htmlFor="dp-rename-input">
              {label}
            </label>
            <input
              id="dp-rename-input"
              type="text"
              value={value}
              maxLength={maxLength || 200}
              onChange={(e) => {
                setValue(e.target.value);
                setErr("");
              }}
              disabled={busy}
              readOnly={!canSave}
            />
            {hint && canSave && <p className="cpd-note">{hint}</p>}
            {!canSave && <p className="cpd-warn">{offNote || "Renaming turns on for this client at launch."}</p>}
            {err && <p className="cpd-err">{err}</p>}
          </div>
        </div>
        <div className="cpd-foot">
          <span />
          <span className="cpd-foot-right">
            <button type="button" className="btn-secondary btn-sm" onClick={onClose} disabled={busy}>
              {canSave ? "Cancel" : "Close"}
            </button>
            {canSave && (
              <button type="submit" className="btn-primary btn-sm" disabled={busy}>
                {busy ? "Saving…" : "Save"}
              </button>
            )}
          </span>
        </div>
      </form>
    </ModalShell>
  );
}

// Who did what to one file.
function DP_HistoryModal({ sb, file, onClose }) {
  const [lines, setLines] = React.useState(null);
  const [err, setErr] = React.useState("");
  React.useEffect(() => {
    let dead = false;
    sb.rpc("client_file_access_history", { p_file_id: file.driveId }).then((res) => {
      if (dead) return;
      if (res.error) setErr(res.error.message);
      else setLines(CPD_historyLines(res.data || [], file.driveId));
    });
    return () => {
      dead = true;
    };
  }, [sb, file.driveId]);
  const when = (at) => {
    if (!at) return "";
    try {
      return new Date(at).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
    } catch (e) {
      return String(at);
    }
  };
  return (
    <ModalShell onClose={onClose} labelledBy="dp-history-title" className="dp-history">
      <div className="modal-header">
        <h3 id="dp-history-title">History</h3>
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <div className="modal-body cpd-body">
        <p className="cpd-file-line">
          <strong>{file.name}</strong>
          {file.origName && file.origName !== file.name && <span className="cpd-orig"> (file: {file.origName})</span>}
        </p>
        {err ? (
          <p className="cpd-err">Couldn't load the history: {err}</p>
        ) : lines === null ? (
          <p className="cpd-note">Loading…</p>
        ) : !lines.length ? (
          <p className="cpd-note">Nothing recorded yet. Changes made from now on show here.</p>
        ) : (
          <ul className="dp-history-list">
            {lines.map((l, i) => (
              <li key={i}>
                <span className="dp-history-text">{l.text}</span>
                <span className="dp-history-meta">
                  {l.actor}
                  {l.at ? " · " + when(l.at) : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </ModalShell>
  );
}

// "Who can see" on the staff upload picker. value: { mode, emails }.
function DP_UploadAccess({ sb, clientId, orgName, value, onChange }) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState(value);
  const [err, setErr] = React.useState("");
  const { logins } = CPD_useLogins(sb, clientId, "staff", "", open);
  const label =
    value.mode === "everyone" ? "Everyone at the client" : CPD_accessBadge(value.mode, value.emails.length);
  const save = () => {
    const acc = CPD_normalizeAccess(draft.mode, draft.emails, logins || [], "", { forNewFile: true });
    if (acc.error) return setErr(acc.error);
    onChange({ mode: acc.mode, emails: acc.emails });
    setOpen(false);
  };
  return (
    <>
      <button
        type="button"
        className="btn-secondary btn-sm dp-upload-access"
        onClick={() => {
          setDraft(value);
          setErr("");
          setOpen(true);
        }}
        title="Who at the client can see files you upload here"
      >
        Who can see: {label}
      </button>
      {open && (
        <ModalShell onClose={() => setOpen(false)} labelledBy="dp-ua-title" className="cpd-dialog">
          <div className="modal-header">
            <h3 id="dp-ua-title">Who can see what you upload</h3>
            <button type="button" className="modal-close" onClick={() => setOpen(false)} aria-label="Close">
              ✕
            </button>
          </div>
          <div className="modal-body cpd-body">
            {logins === null ? (
              <p className="cpd-note">Loading…</p>
            ) : (
              <CPD_AccessPicker
                idBase="dp-ua"
                orgName={orgName}
                logins={logins}
                mode={draft.mode}
                emails={draft.emails}
                lockedEmail=""
                onMode={(m) => {
                  setDraft((d) => ({ ...d, mode: m }));
                  setErr("");
                }}
                onEmails={(l) => {
                  setDraft((d) => ({ ...d, emails: l }));
                  setErr("");
                }}
              />
            )}
            <p className="cpd-note">Applies to the next files you upload on this page. Staff-only files ignore it.</p>
            {err && <p className="cpd-err">{err}</p>}
          </div>
          <div className="cpd-foot">
            <span />
            <span className="cpd-foot-right">
              <button type="button" className="btn-secondary btn-sm" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button type="button" className="btn-primary btn-sm" onClick={save} disabled={logins === null}>
                Use this
              </button>
            </span>
          </div>
        </ModalShell>
      )}
    </>
  );
}

// The bar over the table while rows are ticked.
function DP_BulkBar({ count, folders, trashView, busy, onMove, onTrash, onRestore, onClear }) {
  if (!count) return null;
  return (
    <div className="dp-bulk" role="region" aria-label="Selected documents">
      <strong>{count} selected</strong>
      {!trashView && (
        <label className="dp-bulk-move">
          Move to{" "}
          <select
            className="rb-select"
            value="__pick"
            disabled={busy}
            onChange={(e) => {
              if (e.target.value !== "__pick") onMove(e.target.value === "__unfiled" ? null : e.target.value);
            }}
          >
            <option value="__pick" disabled>
              Choose a folder
            </option>
            <option value="__unfiled">Unfiled</option>
            {folders.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
      )}
      {trashView ? (
        <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={onRestore}>
          Restore
        </button>
      ) : (
        <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={onTrash}>
          Move to Trash
        </button>
      )}
      <button type="button" className="bh-link" onClick={onClear} disabled={busy}>
        Clear
      </button>
    </div>
  );
}

// Copy the deep link to one row.
function DP_copyLink(clientId, key, showToast) {
  const href = LK_href({ clientId, tab: "documents", item: "file:" + key });
  const url = CPD_copyLinkUrl(window.location.origin, window.location.pathname, href);
  const done = () => showToast("Link copied. Anyone who opens it still needs access to this client.");
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, () => showToast(url));
      return;
    }
  } catch (e) {}
  showToast(url);
}

// A "who can see it" list for a NEW file (a staff upload or a Replace): only
// active logins can go on a new file (the database refuses the rest), so
// stale ones come off. An Except list left with nobody becomes Everyone (the
// people it hid are gone); an Only list left with nobody is an error.
// Returns { mode, emails, dropped, error }.
async function DP_accessForNewFile(sb, clientId, mode, emails) {
  if (mode !== "only" && mode !== "except") return { mode: "everyone", emails: [], dropped: [], error: null };
  const res = await sb.from("client_users").select("email").eq("client_id", clientId).eq("active", true);
  if (res.error) return { mode, emails: [], dropped: [], error: "Couldn't check the client's logins: " + res.error.message };
  const logins = (res.data || []).map((r) => ({ email: String(r.email || "").toLowerCase() }));
  const acc = CPD_normalizeAccess(mode, emails, logins, "", { forNewFile: true });
  if (acc.error && mode === "except" && !acc.emails.length) return { mode: "everyone", emails: [], dropped: acc.dropped, error: null };
  if (acc.error && mode === "only" && !acc.emails.length) return { ...acc, error: "Nobody on its Only list still has a login. Change Who can see it first." };
  return acc;
}

// Replace a Drive file with a new version: same type, year, name, folder,
// rule and uploader (drive-files copies the uploader and the Desk check when
// it gets `replaces`); then the old one goes to Trash (Drive's trash, so it
// can come back). Returns { error, dropped }.
async function DP_replaceFile({ sb, clientId, folderMode, d, file, accessEmails }) {
  const restricted = !d.staffOnly && (d.accessMode === "only" || d.accessMode === "except");
  const acc = restricted ? await DP_accessForNewFile(sb, clientId, d.accessMode, accessEmails || []) : { mode: "everyone", emails: [], dropped: [], error: null };
  if (acc.error) return { error: acc.error, dropped: [] };
  let res;
  try {
    res = await DRV_upload({
      file,
      clientId,
      visibility: d.staffOnly ? "internal" : "shared",
      docType: d.docType || "Other",
      year: d.year || undefined,
      displayName: d.name !== file.name ? d.name : null,
      accessMode: acc.mode !== "everyone" ? acc.mode : undefined,
      accessEmails: acc.emails,
      replacesId: d.driveId,
    });
  } catch (e) {
    return { error: CPD_errorText(e), dropped: [] };
  }
  const newKey = res && res.file && res.file.id ? "drive:" + res.file.id : null;
  if (newKey && d.folder) await DF_assign(sb, clientId, folderMode, [newKey], d.folder);
  try {
    await DRV_trash(d.driveId);
  } catch (e) {
    return { error: "The new version is up, but the old one couldn't go to Trash: " + ((e && e.message) || ""), dropped: acc.dropped };
  }
  return { error: null, dropped: acc.dropped };
}
