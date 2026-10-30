// ----------------------------------------------------------------------------
// Client page drop (docs/client-page-drop.md).
//
// A signed-in client drops files anywhere in the portal (or taps "Add a file"
// on a phone), then a dialog asks:
//   - Folder: a Documents folder, a new one, or none.
//   - Name: one file only; saved as client_files.display_name.
//   - What it is for: the Drive document type (Basic Home's friendly labels
//     first, then the rest of DRV_DOC_TYPES).
//   - Who can see it: everyone at the org, only these people, or everyone
//     except these people. MyGoodBooks staff always see every file.
// Up to 10 files, 25 MB each, the Basic Home type list. One file at a time
// through DRV_upload (the drive-files function), the same upload Documents
// uses; failures stay in the dialog to try again.
//
// Gate (CPD_gate.js): mounts for a client when client_page_drop_state() says
// enabled (the firm switch + pilot + the login's Documents tab). Staff in
// View as with their preview flag on get a DEMO: same listener and dialog,
// nothing is uploaded. Never on Basic Home, which owns its own page drop.
//
// Steps aside (no double firing) when the drop already belongs to something:
// e.defaultPrevented, or the target is inside [data-drop-owner] (Documents
// dropzone, Messages card, widget drawer, Home reorder list), another dialog
// is open, or an upload is running.
//
// CPD_AccessModal ("Who can see this") is shared: the client uploader's row
// menu on Documents and the staff Documents upgrades (DocPlus.jsx) both use
// it; it saves through client_file_set_access.
//
// Loaded after clientPageDropLogic.js, CPD_gate.js, basicHomeLogic.js,
// DocFolders.jsx and DriveFiles.js; before app.jsx. Shared Babel scope, so
// every top-level name has a CPD_ prefix; app.jsx globals (ModalShell,
// useToast, MGB_track) are only used at render or call time.
// ----------------------------------------------------------------------------

// Documents tells us which folder is open, so a drop there defaults to it.
var CPD__openFolder = null;
function CPD_setOpenFolder(name) {
  CPD__openFolder = name || null;
}

function CPD__track(name, detail) {
  try {
    if (typeof MGB_track === "function") MGB_track(name, detail);
  } catch (e) {}
}

// Active logins of the org for "Who can see it".
//   client: client_org_logins() (empty unless the switch is on for the org).
//   staff (View as demo, staff Documents): client_users directly.
// Returns { logins: [{ email, name, is_me }] | null, reload }.
function CPD_useLogins(sb, clientId, who, meEmail, on) {
  const [logins, setLogins] = React.useState(null);
  const [n, setN] = React.useState(0);
  React.useEffect(() => {
    let dead = false;
    if (!on || !sb || !clientId) return;
    const me = String(meEmail || "").toLowerCase();
    const q =
      who === "client"
        ? sb.rpc("client_org_logins")
        : sb.from("client_users").select("email, name, active").eq("client_id", clientId).eq("active", true);
    q.then(
      (res) => {
        if (dead) return;
        const rows = (res && !res.error && res.data) || [];
        setLogins(
          rows
            .map((r) => ({ email: String(r.email || "").toLowerCase(), name: r.name || "", is_me: r.is_me === true || String(r.email || "").toLowerCase() === me }))
            .sort((a, b) => (b.is_me ? 1 : 0) - (a.is_me ? 1 : 0) || String(a.name || a.email).localeCompare(String(b.name || b.email))),
        );
      },
      () => !dead && setLogins([]),
    );
    return () => {
      dead = true;
    };
  }, [sb, clientId, who, meEmail, on, n]);
  return { logins, reload: () => setN((x) => x + 1) };
}

// Radios + checklist. lockedEmail: the uploader (on for Only, hidden for
// Except). stale: emails on the saved list with no active login any more.
function CPD_AccessPicker({ idBase, orgName, logins, mode, emails, lockedEmail, stale, onMode, onEmails, disabled }) {
  const locked = String(lockedEmail || "").toLowerCase();
  const set = new Set((emails || []).map((e) => String(e).toLowerCase()));
  const toggle = (email) => {
    const next = new Set(set);
    if (next.has(email)) next.delete(email);
    else next.add(email);
    onEmails(Array.from(next));
  };
  const opts = [
    { key: "everyone", label: "Everyone at " + (orgName || "your organization") },
    { key: "only", label: "Only these people" },
    { key: "except", label: "Everyone except these people" },
  ];
  const list = (logins || []).filter((l) => !(mode === "except" && l.email === locked));
  return (
    <fieldset className="cpd-access" disabled={disabled}>
      <legend className="cpd-label">Who can see it</legend>
      <div className="cpd-radios" role="radiogroup">
        {opts.map((o) => (
          <label key={o.key} className={"cpd-radio" + (mode === o.key ? " is-on" : "")}>
            <input type="radio" name={idBase + "-mode"} value={o.key} checked={mode === o.key} onChange={() => onMode(o.key)} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
      {mode !== "everyone" && (
        <div className="cpd-people" aria-label={mode === "only" ? "People who can see it" : "People who can't see it"}>
          {list.map((l) => {
            const isLocked = mode === "only" && l.email === locked;
            return (
              <label key={l.email} className="cpd-person">
                <input type="checkbox" checked={isLocked || set.has(l.email)} disabled={isLocked} onChange={() => toggle(l.email)} />
                <span className="cpd-person-name">
                  {l.name || l.email}
                  {l.is_me ? " (you)" : isLocked ? " (added it)" : ""}
                </span>
                {l.name && <span className="cpd-person-email">{l.email}</span>}
              </label>
            );
          })}
          {!list.length && <p className="cpd-note">Nobody else has a login yet.</p>}
        </div>
      )}
      {stale && stale.length > 0 && (
        <p className="cpd-warn" role="status">
          {stale.length === 1 ? stale[0] + " no longer has a login" : stale.length + " people on this list no longer have a login"}
          {mode === "except" ? ". They stay hidden from this file." : ", so they come off the list when you save."}
        </p>
      )}
      <p className="cpd-note">MyGoodBooks staff can always see your files.</p>
    </fieldset>
  );
}

// The doc type select: Basic Home's friendly labels first, then the rest.
function CPD_DocTypeSelect({ id, value, onChange, disabled }) {
  const friendly = typeof BH_DESTINATIONS !== "undefined" ? BH_DESTINATIONS : [];
  const used = new Set(friendly.map((d) => d.docType));
  const rest = (typeof DRV_DOC_TYPES !== "undefined" ? DRV_DOC_TYPES : []).filter((t) => !used.has(t));
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
      {friendly.map((d) => (
        <option key={d.key} value={d.docType}>
          {d.label}
        </option>
      ))}
      {rest.length > 0 && (
        <optgroup label="More types">
          {rest.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}

// The upload dialog. items: [{ id, file, status, error }].
function CPD_Dialog({ demo, orgName, items, rejected, busy, progress, folders, folder, onFolder, newFolder, onNewFolder, folderErr, name, onName, nameErr, docType, onDocType, logins, me, mode, emails, onMode, onEmails, accessErr, accessNote, onUpload, onAddMore, onRemove, onClose }) {
  const pending = items.filter((i) => i.status === "pending" || i.status === "failed");
  const failed = items.filter((i) => i.status === "failed");
  const doneN = items.filter((i) => i.status === "done").length;
  const single = items.length === 1 && pending.length === 1;
  // With one login left, the picker still shows while a limit is chosen, so
  // the person sees why instead of the setting silently becoming Everyone.
  const showAccess = !!logins && (logins.length > 1 || mode !== "everyone");
  const aloneWarn = showAccess && logins.length <= 1 && mode !== "everyone";
  const close = () => {
    if (!busy) onClose();
  };
  return (
    <ModalShell onClose={close} labelledBy="cpd-title" className="cpd-dialog">
      <div className="modal-header">
        <h3 id="cpd-title">{failed.length && !busy ? "Some files didn't upload" : "Add to your documents"}</h3>
        <button type="button" className="modal-close" onClick={close} disabled={busy} aria-label="Close">
          ✕
        </button>
      </div>
      <div className="modal-body cpd-body" aria-busy={busy || undefined}>
        {demo && (
          <p className="cpd-demo" role="note">
            Preview only. This is what the client sees; nothing is uploaded.
          </p>
        )}
        {rejected.length > 0 && (
          <div className="bh-rejected" role="alert">
            <strong>Skipped {rejected.length} file{rejected.length === 1 ? "" : "s"}:</strong>
            <ul>
              {rejected.map((r, i) => (
                <li key={i}>
                  {r.name}: {r.reason}
                </li>
              ))}
            </ul>
          </div>
        )}
        <ul className="bh-files cpd-files">
          {items.map((it) => (
            <li key={it.id} className={"bh-file is-" + it.status}>
              <div className="bh-file-main">
                <span className="bh-file-name">{it.file.name}</span>
                <span className="bh-file-size">{BH_sizeLabel(it.file.size)}</span>
              </div>
              <div className="bh-file-state" aria-live="polite">
                {it.status === "uploading" && (
                  <>
                    <span className="bh-spin" aria-hidden="true" /> Uploading
                  </>
                )}
                {it.status === "done" && <span className="bh-ok">{demo ? "Done (preview)" : "Uploaded"}</span>}
                {it.status === "failed" && <span className="bh-bad">{it.error || "Didn't upload"}</span>}
                {(it.status === "pending" || it.status === "failed") && !busy && (
                  <button type="button" className="bh-remove" onClick={() => onRemove(it.id)} aria-label={"Remove " + it.file.name}>
                    Remove
                  </button>
                )}
              </div>
              {it.status === "uploading" && (
                <div className="bh-bar" aria-hidden="true">
                  <span />
                </div>
              )}
            </li>
          ))}
        </ul>

        {pending.length > 0 && (
          <div className="cpd-fields">
            <div className="cpd-field">
              <label className="cpd-label" htmlFor="cpd-folder">
                Folder
              </label>
              <select id="cpd-folder" value={folder} onChange={(e) => onFolder(e.target.value)} disabled={busy}>
                <option value="">No folder</option>
                {(folders || []).map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
                <option value="__new">New folder…</option>
              </select>
              {folder === "__new" && (
                <input
                  type="text"
                  className="cpd-newfolder"
                  aria-label="New folder name"
                  placeholder="Folder name"
                  maxLength={60}
                  value={newFolder}
                  onChange={(e) => onNewFolder(e.target.value)}
                  disabled={busy}
                />
              )}
              {folderErr && <p className="cpd-err">{folderErr}</p>}
            </div>
            {single && (
              <div className="cpd-field">
                <label className="cpd-label" htmlFor="cpd-name">
                  Name
                </label>
                <input id="cpd-name" type="text" maxLength={CPD_NAME_MAX} value={name} onChange={(e) => onName(e.target.value)} disabled={busy} />
                {nameErr && <p className="cpd-err">{nameErr}</p>}
              </div>
            )}
            <div className="cpd-field">
              <label className="cpd-label" htmlFor="cpd-type">
                What it is for
              </label>
              <CPD_DocTypeSelect id="cpd-type" value={docType} onChange={onDocType} disabled={busy} />
            </div>
            {showAccess && (
              <CPD_AccessPicker
                idBase="cpd"
                orgName={orgName}
                logins={logins}
                mode={mode}
                emails={emails}
                lockedEmail={me}
                onMode={onMode}
                onEmails={onEmails}
                disabled={busy}
              />
            )}
            {aloneWarn && (
              <p className="cpd-warn" role="status">
                {mode === "only" ? "Nobody else has a login now, so only you will see it." : "Nobody else has a login now. Pick Everyone to add it."}
              </p>
            )}
            {accessNote && <p className="cpd-warn">{accessNote}</p>}
            {accessErr && <p className="cpd-err">{accessErr}</p>}
          </div>
        )}

        {busy && (
          <p className="bh-progress" role="status">
            Uploading {progress ? progress.at + " of " + progress.of : ""}. Please keep this page open.
          </p>
        )}
      </div>
      <div className="cpd-foot">
        <button type="button" className="btn-secondary btn-sm" onClick={onAddMore} disabled={busy || items.length >= CPD_MAX_FILES}>
          Add more files
        </button>
        <span className="cpd-foot-right">
          <button type="button" className="btn-secondary btn-sm" onClick={close} disabled={busy}>
            {doneN && !pending.length ? "Done" : "Cancel"}
          </button>
          {pending.length > 0 && (
            <button type="button" className="btn-primary btn-sm" onClick={onUpload} disabled={busy}>
              {failed.length ? "Try again" : pending.length === 1 ? "Add file" : "Add " + pending.length + " files"}
            </button>
          )}
        </span>
      </div>
    </ModalShell>
  );
}

// The page-wide listener, the phone "Add a file" button and the dialog.
//   enabled: a real client whose org has the switch on (uploads for real).
//   demo: staff in View as with the preview flag (nothing uploads).
//   demoEmail: the previewed login's email (demo only).
//   pageOk: false on pages that don't take the page drop (Basic Home, staff
//     pages, the pages in NON_CLIENT_PAGES). Only the listener and the
//     "Add a file" button follow it.
// app.jsx keeps this mounted. While an upload runs or the dialog is open the
// props are latched (holdRef): switching pages, leaving View as or the gate
// changing never unmounts the dialog mid-upload or loses the chosen files.
function CPD_ClientPageDrop(props) {
  const [queue, setQueue] = React.useState({ open: false, items: [], rejected: [] });
  const [busy, setBusy] = React.useState(false);
  const holdRef = React.useRef(null);
  if (!(busy || queue.open) || !holdRef.current) {
    holdRef.current = { enabled: props.enabled, demo: props.demo, client: props.client, sb: props.sb, demoEmail: props.demoEmail };
  }
  const { enabled, demo, client, sb, demoEmail } = holdRef.current;
  const page = props.page;
  const on = !!(enabled || demo);
  const listen = on && props.pageOk !== false;
  const showToast = useToast();
  const [dragging, setDragging] = React.useState(false);
  const [progress, setProgress] = React.useState(null);
  const [folders, setFolders] = React.useState({ mode: "local", folders: [] });
  const [folder, setFolder] = React.useState("");
  const [newFolder, setNewFolder] = React.useState("");
  const [folderErr, setFolderErr] = React.useState("");
  const [name, setName] = React.useState("");
  const [nameErr, setNameErr] = React.useState("");
  const [docType, setDocType] = React.useState("Other");
  const [mode, setMode] = React.useState("everyone");
  const [emails, setEmails] = React.useState([]);
  const [accessErr, setAccessErr] = React.useState("");
  const [accessNote, setAccessNote] = React.useState("");
  const [meState, setMe] = React.useState(demo ? String(demoEmail || "").toLowerCase() : "");
  const inputRef = React.useRef(null);
  const idRef = React.useRef(0);
  const busyRef = React.useRef(false);
  busyRef.current = busy;
  const clientId = client && client.id;
  const { logins, reload: reloadLogins } = CPD_useLogins(sb, clientId, demo ? "staff" : "client", demo ? demoEmail : meState, on && queue.open);
  // Before the session read lands, the login list's own is_me row says who I am.
  const me = (demo ? String(demoEmail || "").toLowerCase() : meState) || ((logins || []).find((l) => l.is_me) || {}).email || "";

  // The signed-in client's email (to lock "you" on Only).
  React.useEffect(() => {
    if (demo || !on || !sb) return;
    sb.auth.getSession().then((r) => {
      const e = r && r.data && r.data.session && r.data.session.user && r.data.session.user.email;
      if (e) setMe(String(e).toLowerCase());
    });
  }, [demo, on, sb]);

  const reset = () => {
    setQueue({ open: false, items: [], rejected: [] });
    setFolderErr("");
    setNameErr("");
    setAccessErr("");
    setAccessNote("");
    setNewFolder("");
    setMode("everyone");
    setEmails([]);
    setDocType("Other");
  };

  const queueRef = React.useRef(queue);
  queueRef.current = queue;
  const addFiles = React.useCallback(
    (list) => {
      if (busyRef.current) {
        showToast("Wait for the current upload to finish, then add more.");
        return;
      }
      const q = queueRef.current;
      const base = q.open ? q.items.filter((i) => i.status !== "done") : [];
      const { accepted, rejected } = CPD_takeFiles(list, base.map((i) => i.file));
      if (!accepted.length && !rejected.length) return;
      if (!accepted.length && !q.open) {
        showToast(rejected.length === 1 ? rejected[0].name + ": " + rejected[0].reason : "None of those files can be uploaded.");
        return;
      }
      const items = base.concat(accepted.map((file) => ({ id: ++idRef.current, file, status: "pending", error: null })));
      // A fresh dialog: the default folder is the one open on Documents.
      if (!q.open) setFolder(CPD__openFolder || "");
      const next = { open: true, items, rejected: (q.open ? q.rejected : []).concat(rejected) };
      queueRef.current = next;
      setQueue(next);
    },
    [showToast],
  );

  // Folders when the dialog opens.
  React.useEffect(() => {
    let dead = false;
    if (!queue.open || !clientId || typeof DF_load !== "function") return;
    DF_load(sb, clientId).then((r) => !dead && setFolders(r || { mode: "local", folders: [] }));
    return () => {
      dead = true;
    };
  }, [queue.open, clientId, sb]);

  // Page-wide drop (the Basic Home listener, BasicHome.jsx).
  React.useEffect(() => {
    if (!listen) return;
    let depth = 0;
    let timer = null;
    const hide = () => {
      depth = 0;
      clearTimeout(timer);
      setDragging(false);
    };
    const otherDialog = () =>
      Array.from(document.querySelectorAll(".modal-overlay, [aria-modal='true']")).some(
        (el) => !el.classList.contains("cpd-dialog") && !(el.querySelector && el.querySelector(".cpd-dialog")),
      );
    const owned = (e) => {
      const t = e.target;
      return !!(t && t.closest && t.closest("[data-drop-owner]"));
    };
    const claim = (e) => {
      if (!BH_dragHasFiles(e.dataTransfer) || e.defaultPrevented || owned(e)) return false;
      e.preventDefault();
      const ok = !busyRef.current && !otherDialog();
      if (e.dataTransfer) e.dataTransfer.dropEffect = ok ? "copy" : "none";
      return ok;
    };
    const show = () => {
      setDragging(true);
      clearTimeout(timer);
      timer = setTimeout(hide, 800);
    };
    const onEnter = (e) => {
      if (!BH_dragHasFiles(e.dataTransfer)) return;
      depth += 1;
      if (claim(e)) show();
    };
    const onOver = (e) => {
      if (claim(e)) show();
      else if (BH_dragHasFiles(e.dataTransfer)) setDragging(false);
    };
    const onLeave = (e) => {
      if (!BH_dragHasFiles(e.dataTransfer)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) hide();
    };
    const onDrop = (e) => {
      const has = BH_dragHasFiles(e.dataTransfer);
      hide();
      if (!has || e.defaultPrevented || owned(e)) return;
      e.preventDefault();
      if (otherDialog()) return;
      addFiles(e.dataTransfer.files);
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    window.addEventListener("dragend", hide);
    window.addEventListener("blur", hide);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("dragend", hide);
      window.removeEventListener("blur", hide);
      setDragging(false);
    };
  }, [listen, addFiles]);

  React.useEffect(() => {
    if (!busy) return;
    const onUnload = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [busy]);

  // The single-file name follows the file until someone types.
  const single = queue.items.length === 1 ? queue.items[0] : null;
  React.useEffect(() => {
    if (single) setName(CPD_defaultName(single.file.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [single && single.id]);

  const upload = async () => {
    if (busyRef.current) return;
    const todo = queue.items.filter((i) => i.status === "pending" || i.status === "failed");
    if (!todo.length) return;
    setFolderErr("");
    setNameErr("");
    setAccessErr("");
    setAccessNote("");

    // Folder.
    let target = folder;
    if (folder === "__new") {
      const err = CPD_folderNameError(newFolder, folders.folders);
      if (err) return setFolderErr(err);
      target = newFolder.trim();
    }
    // Name (one file).
    let displayName = null;
    if (todo.length === 1 && queue.items.length === 1) {
      const c = CPD_cleanName(name);
      if (c.error) return setNameErr(c.error);
      displayName = CPD_displayNameFor(todo[0].file.name, c.value);
    }
    // Who can see it. A new file takes active logins only, so stale ones
    // come off the list (in every mode) and we say so.
    let acc = { mode: "everyone", emails: [], dropped: [], error: null };
    if (logins && mode !== "everyone") {
      acc = CPD_normalizeAccess(mode, emails, logins, me, { forNewFile: true });
      if (acc.error) return setAccessErr(acc.error);
      if (acc.dropped.length) setAccessNote(acc.dropped.join(", ") + " no longer " + (acc.dropped.length === 1 ? "has" : "have") + " a login, so they were left off.");
    }

    busyRef.current = true;
    setBusy(true);
    setProgress({ at: 1, of: todo.length });
    const patch = (id, p) => setQueue((q) => ({ ...q, items: q.items.map((i) => (i.id === id ? { ...i, ...p } : i)) }));
    let ok = 0;
    let bad = 0;
    let stop = null;
    const keys = [];

    if (target && folder === "__new" && !demo) {
      const err = await DF_addFolder(sb, clientId, folders.mode, target, folders.folders);
      if (err && !/duplicate|already exists/i.test(err)) {
        busyRef.current = false;
        setBusy(false);
        setProgress(null);
        return setFolderErr("Couldn't make that folder: " + err);
      }
    }
    if (!demo) {
      try {
        if (await DRV_useStorage()) stop = "Uploads aren't available here right now. Use Documents, or try again later.";
      } catch (e) {
        stop = "Uploads are paused for a moment. Please try again later.";
      }
    }
    for (let k = 0; k < todo.length; k++) {
      const it = todo[k];
      if (stop) {
        bad += 1;
        patch(it.id, { status: "failed", error: stop });
        continue;
      }
      setProgress({ at: k + 1, of: todo.length });
      patch(it.id, { status: "uploading", error: null });
      try {
        if (demo) {
          await new Promise((r) => setTimeout(r, 350));
        } else {
          const res = await DRV_upload({
            file: it.file,
            clientId,
            visibility: "shared",
            docType,
            displayName,
            accessMode: acc.mode,
            accessEmails: acc.emails,
          });
          if (res && res.file && res.file.id) keys.push("drive:" + res.file.id);
        }
        ok += 1;
        patch(it.id, { status: "done", error: null });
      } catch (e) {
        bad += 1;
        const code = e && (e.code || "");
        patch(it.id, { status: "failed", error: CPD_errorText(e) });
        // A login left the org mid-way: refresh the list and stop.
        if (code === "bad_access_list" || /bad_access_list/.test(String((e && e.message) || ""))) {
          reloadLogins();
          stop = CPD_errorText(e);
        } else if (code === "feature_off") stop = CPD_errorText(e);
      }
    }
    if (keys.length && target && typeof DF_assign === "function") {
      try {
        await DF_assign(sb, clientId, folders.mode, keys, target);
      } catch (e) {}
    }
    busyRef.current = false;
    setBusy(false);
    setProgress(null);
    if (demo) showToast(ok ? "Preview only: nothing was uploaded." : "Preview only.");
    else {
      showToast(CPD_summary(ok, bad));
      if (ok) {
        try {
          window.dispatchEvent(new Event(typeof PD_DOCS_CHANGED_EVENT !== "undefined" ? PD_DOCS_CHANGED_EVENT : "mgb:docs-changed"));
        } catch (e) {}
      }
    }
    CPD__track("client-page-drop", (demo ? "demo:" : "upload:") + ok + (bad ? ",failed:" + bad : "") + (acc.mode !== "everyone" ? "," + acc.mode : ""));
    if (!bad) reset();
    else setQueue((q) => ({ ...q, items: q.items.filter((i) => i.status !== "done"), rejected: [] }));
  };

  const remove = (id) =>
    setQueue((q) => {
      const items = q.items.filter((i) => i.id !== id);
      return items.length ? { ...q, items } : { open: false, items: [], rejected: [] };
    });

  if (!on) return null;
  const orgName = client && (client.shortName || client.name);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={BH_ACCEPT}
        className="bh-input"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const picked = Array.from(e.target.files || []);
          e.target.value = "";
          addFiles(picked);
        }}
      />
      {listen &&
        page !== "documents" &&
        !queue.open &&
        ReactDOM.createPortal(
          <button type="button" className="cpd-fab" onClick={() => inputRef.current && inputRef.current.click()}>
            <span aria-hidden="true">+</span> Add a file
          </button>,
          document.body,
        )}
      {dragging &&
        ReactDOM.createPortal(
          <div className="bh-drop" aria-hidden="true">
            <div className="bh-drop-box">
              <strong>{queue.open ? "Drop to add them" : "Drop to add to your documents"}</strong>
              <span>{demo ? "Preview: nothing is uploaded." : queue.open ? "They join the list." : "You'll choose the folder and who can see it next."}</span>
            </div>
          </div>,
          document.body,
        )}
      {queue.open && (
        <CPD_Dialog
          demo={demo}
          orgName={orgName}
          items={queue.items}
          rejected={queue.rejected}
          busy={busy}
          progress={progress}
          folders={folders.folders}
          folder={folder}
          onFolder={(v) => {
            setFolder(v);
            setFolderErr("");
          }}
          newFolder={newFolder}
          onNewFolder={setNewFolder}
          folderErr={folderErr}
          name={name}
          onName={(v) => {
            setName(v);
            setNameErr("");
          }}
          nameErr={nameErr}
          docType={docType}
          onDocType={setDocType}
          logins={logins}
          me={me}
          mode={mode}
          emails={emails}
          onMode={(m) => {
            setMode(m);
            setAccessErr("");
          }}
          onEmails={(list) => {
            setEmails(list);
            setAccessErr("");
          }}
          accessErr={accessErr}
          accessNote={accessNote}
          onUpload={upload}
          onAddMore={() => inputRef.current && inputRef.current.click()}
          onRemove={remove}
          onClose={reset}
        />
      )}
    </>
  );
}

// "Who can see this" (and the name) after upload.
//   file: { id, name (shown), origName, uploadedBy, accessMode }
//   who: "client" (the uploader) | "staff"
//   canSave: false shows the rule read-only with a note (switch off).
function CPD_AccessModal({ sb, clientId, orgName, file, who, meEmail, canSave, offNote, onSaved, onClose, showToast }) {
  const isStaff = who === "staff";
  const { logins } = CPD_useLogins(sb, clientId, isStaff ? "staff" : "client", meEmail, true);
  const [mode, setMode] = React.useState(file.accessMode || "everyone");
  const [emails, setEmails] = React.useState([]);
  const [saved, setSaved] = React.useState(null);
  const [name, setName] = React.useState(file.name || "");
  const [err, setErr] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  // The uploader: kept on Only, never on Except (when they're a login).
  const uploader = String(file.uploadedBy || (isStaff ? "" : meEmail) || "").toLowerCase();

  React.useEffect(() => {
    let dead = false;
    sb.from("client_file_access")
      .select("email")
      .eq("file_id", file.id)
      .then((res) => {
        if (dead) return;
        const list = ((res && !res.error && res.data) || []).map((r) => String(r.email).toLowerCase());
        setSaved(list);
        setEmails(list);
      });
    return () => {
      dead = true;
    };
  }, [sb, file.id]);

  const stale = logins && saved ? CPD_staleEmails(saved, logins) : [];
  const save = async () => {
    if (busy || !canSave) return;
    setErr("");
    const acc = CPD_normalizeAccess(mode, emails, logins || [], uploader);
    if (acc.error) return setErr(acc.error);
    let dn = null;
    if (!isStaff) {
      const c = CPD_cleanName(name);
      if (c.error) return setErr(c.error);
      if (c.value !== file.name) dn = c.value === file.origName ? "" : c.value;
    }
    setBusy(true);
    const res = await sb.rpc("client_file_set_access", {
      p_file_id: file.id,
      p_mode: acc.mode,
      p_emails: acc.emails,
      p_display_name: dn,
    });
    setBusy(false);
    if (res.error) return setErr(CPD_errorText({ code: null, message: res.error.message }));
    CPD__track("doc-access", (isStaff ? "staff:" : "client:") + acc.mode);
    if (showToast) showToast(acc.dropped.length ? "Saved. " + acc.dropped.length + " old login" + (acc.dropped.length === 1 ? " was" : "s were") + " taken off the list." : "Saved.");
    onSaved && onSaved(res.data || {});
    onClose();
  };

  return (
    <ModalShell onClose={() => !busy && onClose()} labelledBy="cpd-access-title" className="cpd-dialog cpd-access-modal">
      <div className="modal-header">
        <h3 id="cpd-access-title">Who can see this</h3>
        <button type="button" className="modal-close" onClick={() => !busy && onClose()} aria-label="Close">
          ✕
        </button>
      </div>
      <div className="modal-body cpd-body">
        <p className="cpd-file-line">
          <strong>{file.name}</strong>
          {isStaff && file.origName && file.origName !== file.name && <span className="cpd-orig"> (file: {file.origName})</span>}
        </p>
        {!isStaff && canSave && (
          <div className="cpd-field">
            <label className="cpd-label" htmlFor="cpd-access-name">
              Name
            </label>
            <input id="cpd-access-name" type="text" maxLength={CPD_NAME_MAX} value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
          </div>
        )}
        {logins === null || saved === null ? (
          <p className="cpd-note">Loading…</p>
        ) : (
          <CPD_AccessPicker
            idBase="cpd-access"
            orgName={orgName}
            logins={logins}
            mode={mode}
            emails={emails}
            lockedEmail={uploader}
            stale={stale}
            onMode={(m) => {
              setMode(m);
              setErr("");
            }}
            onEmails={(l) => {
              setEmails(l);
              setErr("");
            }}
            disabled={busy || !canSave}
          />
        )}
        {!canSave && <p className="cpd-warn">{offNote || "Choosing who can see a file isn't turned on for this client yet."}</p>}
        {err && <p className="cpd-err">{err}</p>}
      </div>
      <div className="cpd-foot">
        <span />
        <span className="cpd-foot-right">
          <button type="button" className="btn-secondary btn-sm" onClick={onClose} disabled={busy}>
            {canSave ? "Cancel" : "Close"}
          </button>
          {canSave && (
            <button type="button" className="btn-primary btn-sm" onClick={save} disabled={busy || logins === null || saved === null}>
              {busy ? "Saving…" : "Save"}
            </button>
          )}
        </span>
      </div>
    </ModalShell>
  );
}
