// Staff profile photos, admin side (spec docs/staff-photo-spec.md, Part H).
//
// Team > Members gets a Photo column (SPA_PhotoCell), a drawer per person
// (SPA_PhotoDrawer: download, replace with an edited PNG, restore, Not
// required, history) and a bulk bar above the roster (SPA_BulkBar: Download
// all as a zip). app.jsx StaffAccessPage mounts all three.
//
// Rules live in the database (supabase/staff-photo.sql): every action here is
// an admin-only RPC, so a temp admin or View as gets a read-only drawer with
// no downloads, and the Photo column shows a dash when the list can't load.
// Data and image helpers: staffPhotoApi.js (SP_api, SP_useAdminList),
// staffPhotoImage.js (SPI_*) and staffPhotoLogic.js (SP_*, loaded first).
// Top-level names use the SPA_ prefix.

const SPA_URL_TTL_MS = 50 * 60 * 1000;
const SPA_NEEDS_EDIT_FLAG = "mgb-photo-open"; // sessionStorage: Today's item asks Members to open the first "Needs edit"
const SPA_TONE = { warn: "bad", attention: "warm", ok: "good", muted: "neutral" };
const SPA_KIND_LABEL = { original: "Original", staff_crop: "Their crop", admin_edit: "Admin edit" };
const SPA_urlCache = new Map(); // path -> { at, url }
const SPA_urlPending = new Map(); // path -> Promise<string|null>

function SPA_toast(text) {
  try {
    window.dispatchEvent(new CustomEvent("mgb:toast", { detail: { text } }));
  } catch (e) {}
}

// A signed URL per storage path, kept for 50 minutes (they last an hour).
function SPA_signedCached(path) {
  if (!path) return Promise.resolve(null);
  const hit = SPA_urlCache.get(path);
  if (hit && Date.now() - hit.at < SPA_URL_TTL_MS) return Promise.resolve(hit.url);
  if (SPA_urlPending.has(path)) return SPA_urlPending.get(path);
  const p = SP_api
    .signedUrl(path, 3600)
    .then((url) => {
      if (url) SPA_urlCache.set(path, { at: Date.now(), url });
      return url;
    })
    .catch(() => null)
    .finally(() => SPA_urlPending.delete(path));
  SPA_urlPending.set(path, p);
  return p;
}

function SPA_useSignedUrl(path) {
  const [state, setState] = React.useState(() => {
    const hit = path ? SPA_urlCache.get(path) : null;
    return { path: path || null, url: hit && Date.now() - hit.at < SPA_URL_TTL_MS ? hit.url : null };
  });
  React.useEffect(() => {
    let off = false;
    if (!path) {
      setState({ path: null, url: null });
      return undefined;
    }
    SPA_signedCached(path).then((url) => {
      if (!off) setState({ path, url });
    });
    return () => {
      off = true;
    };
  }, [path]);
  return path && state.path === path ? state.url : null;
}

function SPA_fmtDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch (e) {
    return "";
  }
}

function SPA_extOf(path) {
  const m = /\.([a-z0-9]+)$/i.exec(String(path || ""));
  return m ? m[1].toLowerCase() : "jpg";
}

function SPA_ymd(d) {
  const x = d || new Date();
  return x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0");
}

function SPA_Chip({ status }) {
  const l = SP_statusLabel(status);
  return <span className={"pill " + (SPA_TONE[l.tone] || "neutral") + " spa-chip"}>{l.label}</span>;
}

// A round photo on the same navy circle used in the app and in emails.
function SPA_Circle({ url, size, name, label }) {
  const px = size || 160;
  return (
    <span className="spa-circle" style={{ width: px, height: px }} role="img" aria-label={label || "Current photo"}>
      {url ? (
        <img src={url} alt="" width={px} height={px} />
      ) : (
        <span className="spa-circle-initials" style={{ fontSize: px * 0.34 }}>
          {typeof ST_initials === "function" ? ST_initials(name) : String(name || "?").slice(0, 2).toUpperCase()}
        </span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// The Photo column cell.
// ---------------------------------------------------------------------------
function SPA_PhotoCell({ row, profileName, canAct, onOpen, tour }) {
  const url = SPA_useSignedUrl(row ? row.current_path : null);
  if (!row) return <span className="staff-self-note">—</span>;
  const name = profileName || row.name || row.email;
  const lbl = SP_statusLabel(row.status);
  return (
    <button
      type="button"
      className="spa-cell"
      onClick={() => onOpen(row.email)}
      data-tour={tour ? "members-photo" : undefined}
      aria-label={`Profile photo for ${name}: ${lbl.label}. ${canAct ? "Open to download or replace." : "Open to view."}`}
    >
      {typeof ST_Avatar === "function" ? (
        <ST_Avatar name={name} url={url} size={32} />
      ) : url ? (
        <img src={url} alt="" width={32} height={32} className="st-avatar" />
      ) : (
        <span className="spa-cell-initials">{String(name).slice(0, 2).toUpperCase()}</span>
      )}
      <SPA_Chip status={row.status} />
    </button>
  );
}

// ---------------------------------------------------------------------------
// The drawer.
// ---------------------------------------------------------------------------
function SPA_PhotoDrawer({ email, onClose, canAct }) {
  const list = SP_useAdminList(true);
  const row = (list.rows || []).find((r) => String(r.email).toLowerCase() === String(email).toLowerCase()) || null;
  const name = (row && row.name) || email;
  const currentUrl = SPA_useSignedUrl(row ? row.current_path : null);
  const originalUrl = SPA_useSignedUrl(row ? row.original_path : null);

  const [history, setHistory] = React.useState(null); // null while loading
  const [historyError, setHistoryError] = React.useState("");
  const [tick, setTick] = React.useState(0);
  const [busy, setBusy] = React.useState("");
  const [error, setError] = React.useState("");
  const [pending, setPending] = React.useState(null); // { blob, hasAlpha, previewUrl }
  const [note, setNote] = React.useState("");
  const [confirm, setConfirm] = React.useState(null); // "restore" | { hide: versionRow }
  const [exemptReason, setExemptReason] = React.useState("");
  const fileRef = React.useRef(null);
  const alive = React.useRef(true);

  React.useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // History reloads after any change (SP_api fires sp:changed).
  React.useEffect(() => {
    const on = () => setTick((n) => n + 1);
    window.addEventListener(SP_CHANGED_EVENT, on);
    return () => window.removeEventListener(SP_CHANGED_EVENT, on);
  }, []);
  React.useEffect(() => {
    if (!canAct) {
      setHistory([]);
      return undefined;
    }
    let off = false;
    SP_api
      .history(email)
      .then((r) => {
        if (off) return;
        setHistory(r || []);
        setHistoryError("");
      })
      .catch((e) => {
        if (off) return;
        setHistory([]);
        setHistoryError(SP_errText(e));
      });
    return () => {
      off = true;
    };
  }, [email, tick, canAct]);

  // The preview URL of a picked file must be released.
  React.useEffect(() => {
    return () => {
      if (pending && pending.previewUrl) URL.revokeObjectURL(pending.previewUrl);
    };
  }, [pending]);

  const lockedTitle = canAct ? undefined : "Only admins can do this";
  const status = row ? row.status : "";

  const run = async (label, fn) => {
    setBusy(label);
    setError("");
    try {
      await fn();
    } catch (e) {
      if (alive.current) setError(SP_errText(e));
    } finally {
      if (alive.current) setBusy("");
    }
  };

  const downloadPath = (path, which, logWhat) =>
    run("Downloading…", async () => {
      const blob = await SP_api.download(path);
      SPI_downloadBlob(blob, SP_zipName(name, email, which, SPA_extOf(path)));
      await SP_api.logDownload([email], logWhat);
    });

  const pickEdited = async (file) => {
    if (!file) return;
    setError("");
    const v = SP_validateFile({ type: file.type, size: file.size, name: file.name });
    if (!v.ok) {
      setError(v.error);
      return;
    }
    setBusy("Reading the photo…");
    try {
      const r = await SPI_normalizeEdited(file);
      if (!alive.current) return;
      setNote("");
      setPending({ blob: r.blob, hasAlpha: r.hasAlpha, previewUrl: URL.createObjectURL(r.blob) });
    } catch (e) {
      if (!alive.current) return;
      if (e && e.code === "heic") setError("This photo is in HEIC format, which this browser can't open. Export it as a PNG and try again.");
      else if (e && e.code === "small") setError("This photo is too small. Choose one at least 400 × 400 pixels.");
      else setError("Couldn't open that photo. Choose a PNG, WebP or JPEG.");
    } finally {
      if (alive.current) setBusy("");
    }
  };

  const uploadEdited = () =>
    run("Uploading…", async () => {
      const path = SP_paths(email, "edited", Date.now());
      await SP_api.upload(path, pending.blob, "image/png");
      await SP_api.replace(email, path, note.trim() || null);
      SPA_toast(`${name}'s edited photo is now their profile photo`);
      setPending(null);
      setNote("");
    });

  const restore = () =>
    run("Restoring…", async () => {
      await SP_api.restore(email);
      setConfirm(null);
      SPA_toast(`${name}'s own photo is showing again`);
    });

  const setExempt = (on) =>
    run("Saving…", async () => {
      await SP_api.setExempt(email, on, on ? exemptReason.trim() || null : null);
      setExemptReason("");
      SPA_toast(on ? `${name} no longer needs a photo` : `${name} needs a photo again`);
    });

  const hideVersion = (v) =>
    run("Hiding…", async () => {
      await SP_api.hideVersion(v.id);
      setConfirm(null);
    });

  const downloadVersion = (v) => {
    const which = v.kind === "original" ? "original" : v.kind === "admin_edit" ? "edited" : "crop";
    return downloadPath(v.storage_path, which, v.kind === "original" ? "original" : "current");
  };

  const originals = (history || []).filter((v) => v.kind === "original");
  const exempt = status === "exempt";
  const showExempt = status === "missing" || status === "exempt";
  const disabledAll = !!busy;

  return (
    <ModalShell onClose={busy ? () => {} : onClose} labelledBy="spa-title" className="spa-modal">
      <div className="modal-header">
        <h3 className="card-title" id="spa-title" style={{ margin: 0 }}>
          Profile photo — {name}
        </h3>
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close" disabled={!!busy}>
          ×
        </button>
      </div>
      <div className="modal-body spa-body">
        {!canAct && (
          <p className="card-subtitle spa-note">
            You can see the photo and its status here. Only admins can download, replace or restore it.
          </p>
        )}

        {list.loaded && !row && <p className="card-subtitle">That person isn't on the photo list.</p>}

        {row && (
          <React.Fragment>
            <div className="spa-status-row">
              <SPA_Chip status={status} />
              {row.submitted_at && <span className="staff-self-note">Submitted {SPA_fmtDate(row.submitted_at)}</span>}
              {row.edited_at && (
                <span className="staff-self-note">
                  Edited {SPA_fmtDate(row.edited_at)}
                  {row.edited_by ? " by " + row.edited_by : ""}
                </span>
              )}
              {exempt && row.exempt_reason && <span className="staff-self-note">Reason: {row.exempt_reason}</span>}
            </div>

            <div className="spa-previews">
              <figure className="spa-fig">
                <SPA_Circle url={currentUrl} name={name} size={160} label="Current photo" />
                <figcaption>Current (what the app and emails show)</figcaption>
              </figure>
              <figure className="spa-fig">
                {row.original_path ? (
                  <span className="spa-original" role="img" aria-label="Original photo">
                    {originalUrl ? <img src={originalUrl} alt="" /> : <span className="staff-self-note">Loading…</span>}
                  </span>
                ) : (
                  <span className="spa-original spa-original-empty">None yet</span>
                )}
                <figcaption>Their original</figcaption>
              </figure>
            </div>

            {canAct && (
              <div className="spa-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={disabledAll || !row.original_path}
                  title={!row.original_path ? "No original yet" : undefined}
                  onClick={() => downloadPath(row.original_path, "original", "original")}
                >
                  Download original
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={disabledAll || !row.current_path}
                  title={!row.current_path ? "No photo yet" : undefined}
                  onClick={() => downloadPath(row.current_path, "current", "current")}
                >
                  Download current
                </button>
              </div>
            )}

            <section className="spa-section" aria-labelledby="spa-replace-h">
              <h4 id="spa-replace-h" className="spa-h">
                Replace with edited photo
              </h4>
              <p className="card-subtitle spa-note">
                Remove the background in your editor, then save a square PNG with a transparent background (512 × 512 or larger). It
                shows on a navy circle everywhere.
              </p>
              {!pending && (
                <div className="spa-actions">
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/png,image/webp,image/jpeg"
                    className="spa-file"
                    aria-label="Choose the edited photo"
                    disabled={!canAct || disabledAll}
                    onChange={(e) => {
                      const f = e.target.files && e.target.files[0];
                      e.target.value = "";
                      pickEdited(f);
                    }}
                  />
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={!canAct || disabledAll}
                    title={lockedTitle}
                    onClick={() => fileRef.current && fileRef.current.click()}
                  >
                    Replace with edited photo
                  </button>
                </div>
              )}
              {pending && (
                <div className="spa-pending">
                  <div className="spa-pending-top">
                    <SPA_Circle url={pending.previewUrl} name={name} size={96} label="Preview of the edited photo" />
                    <div className="spa-pending-text">
                      <strong>Preview</strong>
                      <span className="staff-self-note">Shown on the navy circle, the way everyone will see it.</span>
                    </div>
                  </div>
                  {!pending.hasAlpha && (
                    <p className="spa-warn" role="alert">
                      This photo has no transparent background. Upload it anyway?
                    </p>
                  )}
                  <label className="spa-note-label">
                    <span>Note (optional)</span>
                    <input
                      type="text"
                      value={note}
                      maxLength={500}
                      placeholder="For example: background removed"
                      onChange={(e) => setNote(e.target.value)}
                      disabled={disabledAll}
                    />
                  </label>
                  <div className="spa-actions">
                    <button type="button" className="btn-primary" disabled={disabledAll || !canAct} onClick={uploadEdited}>
                      {pending.hasAlpha ? "Upload" : "Upload anyway"}
                    </button>
                    <button type="button" className="btn-secondary" disabled={disabledAll} onClick={() => setPending(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </section>

            {status === "edited" && (
              <section className="spa-section" aria-labelledby="spa-restore-h">
                <h4 id="spa-restore-h" className="spa-h">
                  Restore original
                </h4>
                {confirm !== "restore" ? (
                  <div className="spa-actions">
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={!canAct || disabledAll}
                      title={lockedTitle}
                      onClick={() => setConfirm("restore")}
                    >
                      Restore original
                    </button>
                  </div>
                ) : (
                  <div className="spa-confirm" role="alertdialog" aria-label="Confirm restore">
                    <p>Show {name}'s own photo again? Your edit stays in the history.</p>
                    <div className="spa-actions">
                      <button type="button" className="btn-primary" disabled={disabledAll} onClick={restore}>
                        Restore
                      </button>
                      <button type="button" className="btn-secondary" disabled={disabledAll} onClick={() => setConfirm(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </section>
            )}

            {showExempt && (
              <section className="spa-section" aria-labelledby="spa-exempt-h">
                <h4 id="spa-exempt-h" className="spa-h">
                  Not required
                </h4>
                <label className="staff-active-toggle spa-switch">
                  <input
                    type="checkbox"
                    role="switch"
                    checked={exempt}
                    disabled={!canAct || disabledAll}
                    title={lockedTitle}
                    onChange={(e) => setExempt(e.target.checked)}
                  />
                  <span>{exempt ? "Not required: they won't be asked for a photo" : "Ask them for a photo"}</span>
                </label>
                {!exempt && canAct && (
                  <label className="spa-note-label">
                    <span>Reason when switching on (optional)</span>
                    <input
                      type="text"
                      value={exemptReason}
                      maxLength={300}
                      placeholder="For example: test account"
                      onChange={(e) => setExemptReason(e.target.value)}
                      disabled={disabledAll}
                    />
                  </label>
                )}
              </section>
            )}

            {canAct && (
              <section className="spa-section" aria-labelledby="spa-history-h">
                <h4 id="spa-history-h" className="spa-h">
                  History
                </h4>
                {history === null && <p className="card-subtitle">Loading…</p>}
                {historyError && <p className="card-subtitle negative">{historyError}</p>}
                {history && history.length === 0 && !historyError && <p className="card-subtitle">No photos yet.</p>}
                {history && history.length > 0 && (
                  <ul className="spa-history">
                    {history.map((v) => (
                      <SPA_HistoryRow
                        key={v.id}
                        v={v}
                        busy={disabledAll}
                        canHide={!v.is_current && !(v.kind === "original" && originals.length <= 1)}
                        confirming={confirm && confirm.hide && confirm.hide.id === v.id}
                        onDownload={() => downloadVersion(v)}
                        onAskHide={() => setConfirm({ hide: v })}
                        onCancelHide={() => setConfirm(null)}
                        onHide={() => hideVersion(v)}
                      />
                    ))}
                  </ul>
                )}
              </section>
            )}
          </React.Fragment>
        )}

        {busy && (
          <p className="card-subtitle" role="status">
            {busy}
          </p>
        )}
        {error && (
          <p className="spa-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="modal-footer">
        <span />
        <button type="button" className="btn-secondary" onClick={onClose} disabled={!!busy}>
          Close
        </button>
      </div>
    </ModalShell>
  );
}

function SPA_HistoryRow({ v, busy, canHide, confirming, onDownload, onAskHide, onCancelHide, onHide }) {
  const url = SPA_useSignedUrl(v.storage_path);
  return (
    <li className="spa-hist-row">
      <span className="spa-thumb" aria-hidden="true">
        {url ? <img src={url} alt="" width={40} height={40} /> : null}
      </span>
      <span className="spa-hist-main">
        <strong>{SPA_KIND_LABEL[v.kind] || v.kind}</strong>
        {v.is_current && <span className="pill good spa-chip">Current</span>}
        <span className="staff-self-note">
          {v.uploaded_by} · {SPA_fmtDate(v.created_at)}
        </span>
        {v.note && <span className="staff-self-note">“{v.note}”</span>}
      </span>
      <span className="spa-hist-actions">
        {!confirming && (
          <React.Fragment>
            <button type="button" className="btn-secondary" disabled={busy} onClick={onDownload}>
              Download
            </button>
            {canHide && (
              <button type="button" className="btn-secondary" disabled={busy} onClick={onAskHide}>
                Hide
              </button>
            )}
          </React.Fragment>
        )}
        {confirming && (
          <span className="spa-confirm-inline" role="alertdialog" aria-label="Confirm hide">
            <span>Hide this version? The file is kept.</span>
            <button type="button" className="btn-primary" disabled={busy} onClick={onHide}>
              Hide
            </button>
            <button type="button" className="btn-secondary" disabled={busy} onClick={onCancelHide}>
              Cancel
            </button>
          </span>
        )}
      </span>
    </li>
  );
}

// ---------------------------------------------------------------------------
// The bulk bar above the roster cards.
// ---------------------------------------------------------------------------
function SPA_BulkBar({ rows, canAct }) {
  const [which, setWhich] = React.useState("current");
  const [progress, setProgress] = React.useState("");
  const [error, setError] = React.useState("");
  const [skipped, setSkipped] = React.useState([]);
  const [busy, setBusy] = React.useState(false);
  const alive = React.useRef(true);
  React.useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const list = (rows || []).filter((r) => r.active);
  const needEdit = SP_needsEditCount(rows || []);
  const missing = list.filter((r) => r.status === "missing").length;

  const download = async () => {
    setBusy(true);
    setError("");
    setSkipped([]);
    try {
      let targets = list;
      if (which === "needs-edit") targets = list.filter((r) => r.status === "submitted");
      const pathOf = (r) => (which === "current" ? r.current_path : r.original_path);
      const have = targets.filter((r) => pathOf(r));
      const missingFiles = targets.filter((r) => !pathOf(r)).map((r) => r.name || r.email);
      if (!have.length) {
        setError("Nothing to download for that choice.");
        return;
      }
      const entries = [];
      const done = [];
      for (let i = 0; i < have.length; i++) {
        const r = have[i];
        if (alive.current) setProgress(`${i + 1} of ${have.length}…`);
        try {
          const blob = await SP_api.download(pathOf(r));
          const bytes = new Uint8Array(await blob.arrayBuffer());
          entries.push({ name: SP_zipName(r.name, r.email, which === "current" ? "current" : "original", SPA_extOf(pathOf(r))), bytes });
          done.push(r.email);
        } catch (e) {
          missingFiles.push(r.name || r.email);
        }
      }
      if (!entries.length) {
        setError("None of those files could be downloaded.");
        return;
      }
      const zip = SP_buildZip(entries, new Date());
      SPI_downloadBlob(new Blob([zip], { type: "application/zip" }), `mgb-staff-photos-${SPA_ymd(new Date())}.zip`);
      await SP_api.logDownload(done, "zip");
      if (alive.current) setSkipped(missingFiles);
      SPA_toast(`Downloaded ${entries.length} photo${entries.length === 1 ? "" : "s"}`);
    } catch (e) {
      if (alive.current) setError(SP_errText(e));
    } finally {
      if (alive.current) {
        setBusy(false);
        setProgress("");
      }
    }
  };

  return (
    <div className="card spa-bulk" style={{ marginBottom: 20 }}>
      <div className="spa-bulk-row">
        <div className="spa-bulk-text">
          <h3 className="card-title" style={{ margin: 0 }}>
            Profile photos
          </h3>
          <p className="card-subtitle" style={{ margin: "4px 0 0" }}>
            {needEdit} need{needEdit === 1 ? "s" : ""} an edit · {missing} missing
          </p>
        </div>
        {canAct && (
          <div className="spa-bulk-controls">
            <label className="spa-bulk-select">
              <span className="spa-sr">Which photos to download</span>
              <select value={which} disabled={busy} onChange={(e) => setWhich(e.target.value)}>
                <option value="current">Current</option>
                <option value="originals">Originals</option>
                <option value="needs-edit">Needs edit only (originals)</option>
              </select>
            </label>
            <button type="button" className="btn-secondary" disabled={busy} onClick={download}>
              {busy ? progress || "Preparing…" : "Download all (zip)"}
            </button>
          </div>
        )}
      </div>
      <p className="card-subtitle spa-note" style={{ marginBottom: 0 }}>
        Active staff only. The zip is built in your browser and never uploaded. Each download is recorded in the Audit log.
      </p>
      {error && (
        <p className="spa-error" role="alert">
          {error}
        </p>
      )}
      {skipped.length > 0 && (
        <p className="card-subtitle spa-note" role="status">
          Skipped (no file): {skipped.join(", ")}
        </p>
      )}
    </div>
  );
}
