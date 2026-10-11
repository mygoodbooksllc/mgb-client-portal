// ----------------------------------------------------------------------------
// Tasks module, drawer slice: files and links on a task (spec C7, row 2.11).
//
//   TK_Attachments({ task, canEdit, staffUser, nameOf })
//
// A client task's file goes to that client's Drive and is linked (kind
// "drive"); a task with no client uses the private task-files bucket (kind
// "file"). Links are https only. When Drive isn't connected, a client task
// offers links only. Files open in a new tab: the tab opens first, then gets
// its address once the signed URL comes back, so pop-up blockers allow it.
// ----------------------------------------------------------------------------

var TK_AT_KIND_LABELS = { file: "File", drive: "Drive", link: "Link" };

function TK_atOpen(att, api) {
  if (!att || !api) return;
  // Open the tab inside the click, so it isn't blocked.
  var win = null;
  try {
    win = window.open("about:blank", "_blank");
  } catch (e) {}
  if (!win) {
    TK_dwToast(TK_dwCopy("popupBlocked", "Your browser blocked the new tab. Allow pop-ups for this site and try again."));
    return;
  }
  try { win.opener = null; } catch (e) {}
  Promise.resolve()
    .then(function () { return api.openAttachment(att); })
    .then(
      function (url) {
        if (!url || !/^https:\/\//i.test(String(url))) throw { code: "tk_not_found" };
        win.location.href = url;
      },
      function (e) { throw e; },
    )
    .catch(function (e) {
      try { win.close(); } catch (x) {}
      if (e && e.code === "drive_not_connected") TK_dwToast(TK_dwCopy("driveOff", "File storage isn't connected yet. Add a link instead."));
      else if (e && e.code === "tk_offline") TK_dwToast(TK_dwCopy("offline", "You're offline."));
      else TK_dwToast("Couldn't open that file. Try again.");
    });
}

function TK_atRow(props) {
  var p = props;
  var a = p.att;
  var meta = [TK_dlFormatSize(a.size), a.added_by ? "Added by " + p.nameOf(a.added_by) : ""].filter(Boolean).join(" · ");
  return (
    <li className="tk-at-item">
      <span className={"tk-at-kind is-" + a.kind}>{TK_AT_KIND_LABELS[a.kind] || "File"}</span>
      <div className="tk-at-main">
        {a.kind === "link" && a.url && /^https:\/\//i.test(a.url) ? (
          <a className="tk-at-name" href={a.url} target="_blank" rel="noopener noreferrer">
            {a.name || a.url}
          </a>
        ) : (
          <button type="button" className="link-btn tk-at-name" onClick={function () { TK_atOpen(a, p.api); }}>
            {a.name || "File"}
          </button>
        )}
        {meta && <span className="tk-at-meta">{meta}</span>}
      </div>
      {p.canRemove && (
        <button
          type="button"
          className="tk-dw-icon-btn tk-at-remove"
          aria-label={"Remove " + (a.name || "attachment")}
          title="Remove"
          disabled={!p.online}
          onClick={function () { p.onRemove(a); }}
        >
          ×
        </button>
      )}
    </li>
  );
}

function TK_Attachments(props) {
  var p = props || {};
  var task = p.task || {};
  var api = TK_dwApi();
  var me = TK_dwLower(p.staffUser && p.staffUser.email);
  var nameOf = p.nameOf || function (email) { return TK_dlNameOf(email, []); };
  var online = TK_dwUseOnline();
  var list = TK_dwUseRows(
    "at",
    task.id || null,
    function () { return api ? api.listAttachments(task.id) : []; },
    { tables: ["tk_attachments"] },
  );

  var drivePair = React.useState(task.client_id ? null : true); // null = checking
  var driveOn = drivePair[0];
  var setDriveOn = drivePair[1];
  var upPair = React.useState(null); // { name, error? }
  var upload = upPair[0];
  var setUpload = upPair[1];
  var linkPair = React.useState(null); // { url, name, error }
  var linkForm = linkPair[0];
  var setLinkForm = linkPair[1];
  var busyPair = React.useState(false);
  var busy = busyPair[0];
  var setBusy = busyPair[1];
  var removePair = React.useState(null);
  var removing = removePair[0];
  var setRemoving = removePair[1];
  var fileRef = React.useRef(null);

  React.useEffect(function () {
    setUpload(null);
    setLinkForm(null);
    if (!task.client_id) {
      setDriveOn(true);
      return undefined;
    }
    if (typeof DRV_status !== "function") {
      setDriveOn(false);
      return undefined;
    }
    var live = true;
    setDriveOn(null);
    Promise.resolve()
      .then(function () { return DRV_status(); })
      .then(
        function (v) { if (live) setDriveOn(!!v); },
        function () { if (live) setDriveOn(false); },
      );
    return function () { live = false; };
  }, [task.id, task.client_id]);

  var canAdd = !!p.canEdit && online;
  var rows = list.rows || [];

  var pickFile = function () {
    if (fileRef.current) {
      fileRef.current.value = "";
      fileRef.current.click();
    }
  };

  var onFile = function (e) {
    var file = e.target.files && e.target.files[0];
    if (!file || !api) return;
    var msg = TK_validateAttachment(file);
    if (msg) {
      setUpload({ name: file.name, error: msg });
      return;
    }
    setUpload({ name: file.name });
    api.uploadFile(task, file).then(
      function () {
        setUpload(null);
        TK_dwTrack("tasks-attach", { kind: task.client_id ? "drive" : "file" });
        list.reload();
      },
      function (err) {
        var code = err && err.code;
        var text;
        if (code === "drive_not_connected") {
          text = TK_dwCopy("driveOff", "File storage isn't connected yet. Add a link instead.");
          setDriveOn(false);
        } else if (code === "tk_offline") text = TK_dwCopy("offline", "You're offline.");
        else if (code === "22023" && err.message) text = err.message;
        else {
          text = "Couldn't upload that file. Try again.";
          if (typeof console !== "undefined") console.error("[TK]", err);
        }
        setUpload({ name: file.name, error: text });
      },
    );
  };

  var saveLink = function () {
    if (!linkForm || !api || busy) return;
    var url = String(linkForm.url || "").trim();
    var msg = TK_validateAttachment({ url: url });
    if (msg) {
      setLinkForm(Object.assign({}, linkForm, { error: msg }));
      return;
    }
    setBusy(true);
    api.addLink(task.id, { url: url, name: String(linkForm.name || "").trim() }).then(
      function () {
        setBusy(false);
        setLinkForm(null);
        TK_dwTrack("tasks-attach", { kind: "link" });
        list.reload();
      },
      function (err) {
        setBusy(false);
        var text = err && err.code === "tk_offline" ? TK_dwCopy("offline", "You're offline.") : "Couldn't add the link. Try again.";
        setLinkForm(Object.assign({}, linkForm, { error: text }));
      },
    );
  };

  var doRemove = function () {
    var a = removing;
    setRemoving(null);
    if (!a || !api) return;
    api.removeAttachment(a.id).then(function () { list.reload(); }, TK_dwSaveError);
  };

  var linkKey = function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      saveLink();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setLinkForm(null);
    }
  };

  var filesAllowed = driveOn === true;

  return (
    <div className="tk-at">
      {list.loading && !rows.length ? (
        <div className="tk-dw-skel tk-dw-skel-row" aria-hidden="true" />
      ) : list.error && !rows.length ? (
        <p className="tk-dw-muted">
          Couldn't load files.{" "}
          <button type="button" className="link-btn" onClick={list.reload}>
            {TK_dwCopy("retry", "Try again")}
          </button>
        </p>
      ) : !rows.length && !upload ? (
        <p className="tk-dw-muted">No files yet.</p>
      ) : (
        <ul className="tk-at-list">
          {rows.map(function (a) {
            return (
              <TK_atRow
                key={a.id}
                att={a}
                api={api}
                nameOf={nameOf}
                online={online}
                canRemove={!!p.canEdit || TK_dwLower(a.added_by) === me}
                onRemove={setRemoving}
              />
            );
          })}
          {upload && (
            <li className={"tk-at-item tk-at-upload" + (upload.error ? " is-bad" : "")} role="status">
              <span className="tk-at-kind">{upload.error ? "Not added" : "Uploading"}</span>
              <div className="tk-at-main">
                <span className="tk-at-name">{upload.name}</span>
                {upload.error ? (
                  <span className="tk-dw-warn">{upload.error}</span>
                ) : (
                  <span className="tk-at-bar" aria-hidden="true">
                    <span />
                  </span>
                )}
              </div>
              {upload.error && (
                <button type="button" className="link-btn" onClick={function () { setUpload(null); }}>
                  Dismiss
                </button>
              )}
            </li>
          )}
        </ul>
      )}

      {p.canEdit && task.client_id && driveOn === false && (
        <p className="tk-dw-hint">{TK_dwCopy("driveOff", "File storage isn't connected yet. Add a link instead.")}</p>
      )}

      {p.canEdit && linkForm && (
        <div className="tk-at-linkform">
          <label className="tk-dw-label" htmlFor="tk-at-url">
            Link
          </label>
          <input
            id="tk-at-url"
            type="url"
            className="tk-dw-input"
            placeholder="https://"
            maxLength={2000}
            autoFocus
            value={linkForm.url}
            disabled={busy}
            onChange={function (e) { setLinkForm(Object.assign({}, linkForm, { url: e.target.value, error: "" })); }}
            onKeyDown={linkKey}
          />
          <label className="tk-dw-label" htmlFor="tk-at-name">
            Name (optional)
          </label>
          <input
            id="tk-at-name"
            type="text"
            className="tk-dw-input"
            maxLength={255}
            value={linkForm.name}
            disabled={busy}
            onChange={function (e) { setLinkForm(Object.assign({}, linkForm, { name: e.target.value })); }}
            onKeyDown={linkKey}
          />
          {linkForm.error && (
            <p className="tk-dw-warn" role="alert">
              {linkForm.error}
            </p>
          )}
          <div className="tk-cm-actions">
            <button type="button" className="btn-primary tk-dw-btn-sm" disabled={busy || !String(linkForm.url).trim()} onClick={saveLink}>
              Add link
            </button>
            <button type="button" className="btn-secondary tk-dw-btn-sm" disabled={busy} onClick={function () { setLinkForm(null); }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {p.canEdit && !linkForm && (
        <div className="tk-at-add">
          {filesAllowed && (
            <button type="button" className="btn-secondary tk-dw-btn-sm" disabled={!canAdd || (upload && !upload.error)} onClick={pickFile}>
              Add file
            </button>
          )}
          <button
            type="button"
            className="btn-secondary tk-dw-btn-sm"
            disabled={!canAdd}
            onClick={function () { setLinkForm({ url: "", name: "", error: "" }); }}
          >
            Add link
          </button>
          <input
            ref={fileRef}
            type="file"
            hidden
            aria-hidden="true"
            tabIndex={-1}
            accept={TK_ATTACH_MIMES.join(",") + ",.csv,.txt,.xlsx,.docx,.pdf"}
            onChange={onFile}
          />
        </div>
      )}

      {removing && (
        <TK_dwConfirm
          title="Remove this attachment?"
          body={"“" + (removing.name || "This attachment") + "” comes off this task." + (removing.kind === "drive" ? " The file stays in the client's Drive." : "")}
          confirmLabel="Remove"
          onConfirm={doRemove}
          onCancel={function () { setRemoving(null); }}
        />
      )}
    </div>
  );
}
