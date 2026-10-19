// ----------------------------------------------------------------------------
// Basic plan Home, under CLIENT_HomeTop (which already has Needs you and the
// organization card): "Home at a glance" for a client on Basic.
//
//   Drop files anywhere on the page, then say where they go. A page-wide drop
//   overlay ("Drop to upload"), then a chooser ("Where should this go?") with
//   a big button per destination (basicHomeLogic.js BH_DESTINATIONS). There is
//   also a Choose files button for people who don't drag. The upload is the
//   SAME one the Documents page uses: DRV_upload (components/files/
//   DriveFiles.js -> the drive-files function), visibility "shared", with the
//   destination as the document type, so the file lands in Google Drive under
//   <Client>/<Year>/<Document type> and shows on Documents. No new storage.
//   Latest from your bookkeeper: the last message of the client's thread
//   (already loaded by App) and a Reply button to Messages.
//   Latest statements: a link to Reports. Your files: the newest Documents
//   (DRV_list, the call Documents makes) and a link to Documents. Clients have
//   no Google access, so there is no Drive folder link.
//   One slim dashed row at the bottom says what Pro adds.
//
// Loaded after basicHomeLogic.js and before app.jsx (shared Babel scope): every
// top-level name has a BH_ prefix.
// ----------------------------------------------------------------------------

function BH_Spinner() {
  return <span className="bh-spin" aria-hidden="true" />;
}

// The "Where should this go?" chooser. items: [{ id, file, status, error }]
// (status: pending | uploading | done | failed).
function BH_Chooser({ items, rejected, busy, dest, onPick, onAddMore, onClose, onRemove }) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const el = ref.current && ref.current.querySelector("button.bh-dest");
    if (el) el.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  React.useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);
  const failed = items.filter((i) => i.status === "failed");
  const waiting = items.filter((i) => i.status === "pending");
  const total = items.length;
  const doneN = items.filter((i) => i.status === "done").length;
  const showPicker = !busy && (waiting.length > 0 || failed.length > 0);
  return (
    <div className="bh-scrim" role="presentation">
      <div className="bh-chooser" role="dialog" aria-modal="true" aria-labelledby="bh-chooser-title" ref={ref}>
        <h3 id="bh-chooser-title" className="bh-chooser-title">
          {failed.length && !waiting.length && !busy ? "Some files didn't upload" : "Where should this go?"}
        </h3>
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
        <ul className="bh-files">
          {items.map((it) => (
            <li key={it.id} className={"bh-file is-" + it.status}>
              <div className="bh-file-main">
                <span className="bh-file-name">{it.file.name}</span>
                <span className="bh-file-size">{BH_sizeLabel(it.file.size)}</span>
              </div>
              <div className="bh-file-state" aria-live="polite">
                {it.status === "uploading" && (
                  <>
                    <BH_Spinner /> Uploading
                  </>
                )}
                {it.status === "done" && <span className="bh-ok">Uploaded</span>}
                {it.status === "failed" && <span className="bh-bad">{it.error || "Didn't upload"}</span>}
                {it.status === "pending" && !busy && (
                  <button type="button" className="bh-remove" onClick={() => onRemove(it.id)} aria-label={"Remove " + it.file.name}>
                    Remove
                  </button>
                )}
              </div>
              {it.status === "uploading" && <div className="bh-bar" aria-hidden="true"><span /></div>}
            </li>
          ))}
        </ul>
        {busy && (
          <p className="bh-progress" role="status">
            Uploading to {BH_labelFor(dest)}: {Math.min(total, doneN + 1)} of {total}. Please keep this page open.
          </p>
        )}
        {showPicker && (
          <>
            {failed.length > 0 && (
              <p className="bh-retry-note">
                {failed.length} file{failed.length === 1 ? "" : "s"} didn't go through, and nothing was lost. Try again, or pick a different place.
              </p>
            )}
            <div className="bh-dests">
              {BH_DESTINATIONS.map((d) => (
                <button
                  key={d.key}
                  type="button"
                  className={"bh-dest" + (failed.length && dest === d.key ? " is-last" : "")}
                  onClick={() => onPick(d.key)}
                >
                  <span className="bh-dest-label">{d.label}</span>
                  <span className="bh-dest-hint">{failed.length && !waiting.length && dest === d.key ? "Try again here" : d.hint}</span>
                </button>
              ))}
            </div>
          </>
        )}
        <div className="bh-chooser-foot">
          <button type="button" className="btn-secondary btn-sm" onClick={onAddMore} disabled={busy}>
            Add more files
          </button>
          <button type="button" className="btn-secondary btn-sm" onClick={onClose} disabled={busy}>
            {doneN && !failed.length && !waiting.length ? "Done" : "Cancel"}
          </button>
        </div>
      </div>
    </div>
  );
}

function BasicHome({ client, access, messages, live, canUpload, onGo, onSeePlans }) {
  const showToast = useToast();
  const [dragging, setDragging] = React.useState(false);
  const [queue, setQueue] = React.useState({ open: false, items: [], rejected: [] });
  const [busy, setBusy] = React.useState(false);
  const [dest, setDest] = React.useState(null);
  const [recent, setRecent] = React.useState(null);
  const [tick, setTick] = React.useState(0);
  const inputRef = React.useRef(null);
  const idRef = React.useRef(0);
  const busyRef = React.useRef(false);
  busyRef.current = busy;
  const hasTab = (k) => !access || !access.tabs || access.tabs.has(k);

  // Add files to the chooser (opens it). Unsupported ones are listed, not lost.
  const addFiles = React.useCallback(
    (list) => {
      const { accepted, rejected } = BH_pickFiles(list);
      if (!accepted.length && !rejected.length) return;
      if (busyRef.current) {
        showToast("Wait for the current upload to finish, then add more.");
        return;
      }
      if (!accepted.length) {
        showToast(rejected.length === 1 ? rejected[0].name + ": " + rejected[0].reason : "None of those files can be uploaded.");
      }
      setQueue((q) => {
        const base = q.open ? q.items.filter((i) => i.status !== "done") : [];
        const items = base.concat(accepted.map((file) => ({ id: ++idRef.current, file, status: "pending", error: null })));
        if (!items.length) return q.open ? q : { open: false, items: [], rejected: [] };
        return { open: true, items, rejected: (q.open ? q.rejected : []).concat(rejected) };
      });
    },
    [showToast],
  );

  // Page-wide drop. Only for a signed-in client; staff previewing don't get it.
  React.useEffect(() => {
    if (!canUpload) return;
    const onOver = (e) => {
      // A drop zone on the page that already claimed it keeps it.
      if (!BH_dragHasFiles(e.dataTransfer) || e.defaultPrevented) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      setDragging(true);
    };
    const onLeave = (e) => {
      // Leaving the window (no element entered), not moving between elements.
      if (!e.relatedTarget) setDragging(false);
    };
    const onDrop = (e) => {
      if (!BH_dragHasFiles(e.dataTransfer) || e.defaultPrevented) return;
      e.preventDefault();
      setDragging(false);
      addFiles(e.dataTransfer.files);
    };
    const off = () => setDragging(false);
    window.addEventListener("dragenter", onOver);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    window.addEventListener("dragend", off);
    return () => {
      window.removeEventListener("dragenter", onOver);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("dragend", off);
    };
  }, [canUpload, addFiles]);

  // Upload every file that isn't done, one at a time, through the Documents
  // page's own call. Failures keep the chooser open.
  const run = async (destKey, items) => {
    if (busyRef.current) return;
    setDest(destKey);
    setBusy(true);
    busyRef.current = true;
    const patch = (id, p) =>
      setQueue((q) => ({ ...q, items: q.items.map((i) => (i.id === id ? { ...i, ...p } : i)) }));
    let ok = 0;
    let bad = 0;
    let stop = null;
    try {
      await DRV_useStorage();
    } catch (e) {
      stop = "Uploads are paused for a moment. Please try again later.";
    }
    for (const it of items) {
      if (stop) {
        bad += 1;
        patch(it.id, { status: "failed", error: stop });
        continue;
      }
      patch(it.id, { status: "uploading", error: null });
      try {
        await DRV_upload({ file: it.file, clientId: client.id, visibility: "shared", docType: BH_docTypeFor(destKey) });
        ok += 1;
        patch(it.id, { status: "done" });
      } catch (e) {
        bad += 1;
        patch(it.id, { status: "failed", error: (e && e.message) || "Didn't upload" });
      }
    }
    busyRef.current = false;
    setBusy(false);
    showToast(BH_summary(ok, bad, destKey));
    if (ok) setTick((n) => n + 1);
    // All good: close. Otherwise the chooser stays with the failures.
    if (!bad) setQueue({ open: false, items: [], rejected: [] });
    else setQueue((q) => ({ ...q, items: q.items.filter((i) => i.status !== "done"), rejected: [] }));
  };
  const pick = (destKey) => run(destKey, queue.items.filter((i) => i.status === "pending" || i.status === "failed"));
  const close = () => setQueue({ open: false, items: [], rejected: [] });
  const remove = (id) =>
    setQueue((q) => {
      const items = q.items.filter((i) => i.id !== id);
      return items.length || q.rejected.length ? { ...q, items } : { open: false, items: [], rejected: [] };
    });

  // Newest files for the "Your files" card.
  React.useEffect(() => {
    let dead = false;
    if (!client || typeof DRV_list !== "function" || !hasTab("documents")) return;
    DRV_list(client.id, "documents")
      .then((r) => {
        if (dead) return;
        const files = ((r && r.files) || [])
          .filter((f) => f.visibility !== "internal")
          .sort((a, b) => String(b.uploaded_at).localeCompare(String(a.uploaded_at)))
          .slice(0, 3);
        setRecent(files);
      })
      .catch(() => !dead && setRecent([]));
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client && client.id, tick]);

  const last = live ? BH_latestFromBookkeeper(messages) : null;
  const fromNow = last && last.at && typeof relTime === "function" ? relTime(last.at) : null;
  const canMessage = hasTab("messages");

  return (
    <div className="bh-home" data-tour="basic-home">
      <h2 className="bh-heading">Home at a glance</h2>

      {hasTab("documents") && (
        <div className={"card bh-upload" + (canUpload ? "" : " is-off")} data-tour="basic-upload">
          <div className="bh-upload-text">
            <h3 className="card-title" style={{ margin: 0 }}>
              Send your bookkeeper files
            </h3>
            <p className="card-subtitle" style={{ margin: "4px 0 0" }}>
              {canUpload
                ? "Drop files anywhere on this page, then tell us where they go. Or choose them from your device."
                : "Your client signs in to upload files here."}
            </p>
          </div>
          <button type="button" className="btn-primary bh-choose" disabled={!canUpload} onClick={() => inputRef.current && inputRef.current.click()}>
            Choose files
          </button>
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
        </div>
      )}

      <div className="bh-grid">
        {canMessage && (
          <div className="card bh-card">
            <h3 className="card-title">Latest from your bookkeeper</h3>
            {last ? (
              <>
                <p className="bh-quote">{BH_preview(last.text)}</p>
                <p className="bh-meta">
                  {last.author}
                  {fromNow ? " · " + fromNow : ""}
                </p>
              </>
            ) : (
              <p className="card-subtitle" style={{ margin: 0 }}>
                No messages yet. Say hello any time.
              </p>
            )}
            <button type="button" className="btn-secondary btn-sm" onClick={() => onGo("messages")}>
              {last ? "Reply" : "Send a message"}
            </button>
          </div>
        )}
        {hasTab("reports") && (
          <div className="card bh-card">
            <h3 className="card-title">Latest statements</h3>
            <p className="card-subtitle" style={{ margin: 0 }}>
              Your Profit &amp; Loss, Balance Sheet and other statements, ready to download as PDFs.
            </p>
            <button type="button" className="btn-secondary btn-sm" onClick={() => onGo("reports")}>
              Open Reports
            </button>
          </div>
        )}
        {hasTab("documents") && (
          <div className="card bh-card">
            <h3 className="card-title">Your files</h3>
            {recent && recent.length > 0 ? (
              <ul className="bh-recent">
                {recent.map((f) => (
                  <li key={f.id}>
                    <span className="bh-recent-name">{f.name}</span>
                    <span className="bh-recent-meta">{f.doc_type || "Uploaded"}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="card-subtitle" style={{ margin: 0 }}>
                {recent === null ? "Loading…" : "Nothing uploaded yet. Files you send, and files from your bookkeeper, show up here."}
              </p>
            )}
            <button type="button" className="btn-secondary btn-sm" onClick={() => onGo("documents")}>
              Open Documents
            </button>
          </div>
        )}
      </div>

      <div className="bh-pro-row">
        <span>Pro adds a live snapshot of cash, receivables, payables and net income.</span>
        <span className="bh-pro-actions">
          <button type="button" className="bh-link" onClick={onSeePlans}>
            See plans
          </button>
          {typeof TOUR_start === "function" && (
            <button type="button" className="bh-link" onClick={() => TOUR_start("pro")}>
              Take the Pro tour
            </button>
          )}
        </span>
      </div>

      {dragging && canUpload && (
        <div className="bh-drop" aria-hidden="true">
          <div className="bh-drop-box">
            <strong>Drop to upload</strong>
            <span>You will pick where it goes next.</span>
          </div>
        </div>
      )}
      {queue.open && (
        <BH_Chooser
          items={queue.items}
          rejected={queue.rejected}
          busy={busy}
          dest={dest}
          onPick={pick}
          onAddMore={() => inputRef.current && inputRef.current.click()}
          onClose={close}
          onRemove={remove}
        />
      )}
    </div>
  );
}
