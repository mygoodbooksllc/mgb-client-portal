// ----------------------------------------------------------------------------
// Client agreements card (docs/agreements-spec.md), on the Documents page.
//
// Staff (DocumentsPage isBookkeeper): admins and the client's account manager
// add, edit, mark signed, show/hide and trash agreements; bookkeepers with
// access read only; admins restore from trash. Read-only in View as. Reads
// the table directly (RLS: can_access_client); writes go through RLS +
// the client_agreements_guard trigger.
//
// Clients: read-only list from client_agreements_mine(), which never returns
// the staff note and returns nothing unless the firm switch
// tk_settings.agreements_client_enabled is on (code never sets it). With the
// switch off the client card renders nothing at all.
//
// Loaded before app.jsx in the shared global scope: every top-level name
// carries an AG_ prefix; app.jsx globals (useToast) are only touched at
// render time. Pure rules live in AG_logic.js.
// ----------------------------------------------------------------------------

function AG_ro() {
  return typeof MGB_viewAsReadOnly === "function" && !!MGB_viewAsReadOnly();
}

function AG_useToast() {
  return typeof useToast === "function" ? useToast() : (m) => window.alert(m);
}

async function AG_openRow(row, toast) {
  const url = AG_safeUrl(row.document_url);
  if (url) {
    window.open(url, "_blank", "noopener");
    return;
  }
  if (row.client_file_id && typeof DRV_link === "function") {
    try {
      window.open(await DRV_link(row.client_file_id), "_blank", "noopener");
    } catch (e) {
      toast("That file isn't available.");
    }
    return;
  }
  toast("No file is attached to this agreement yet.");
}

function AG_StatusPill({ row, today }) {
  const s = AG_effectiveStatus(row, today);
  return <span className={"pill " + AG_statusTone(s)}>{AG_statusLabel(s)}</span>;
}

function AG_dates(row) {
  const bits = [];
  if (row.signed_on) bits.push("Signed " + AG_fmtDate(row.signed_on));
  if (row.effective_on) bits.push("Effective " + AG_fmtDate(row.effective_on));
  if (row.expires_on) bits.push("Renews or expires " + AG_fmtDate(row.expires_on));
  return bits.join(" · ");
}

function AG_AgreementsCard({ client, staff }) {
  if (!client || !client.id) return null;
  return staff ? <AG_StaffCard client={client} /> : <AG_ClientCard client={client} />;
}

// --- Client (read only) -----------------------------------------------------

function AG_ClientCard({ client }) {
  const toast = AG_useToast();
  const [st, setSt] = React.useState({ loading: true, enabled: false, rows: [] });
  const clientId = client.id;

  React.useEffect(() => {
    let live = true;
    const sb = window.mgbSupabase;
    if (!sb) return;
    sb.rpc("client_agreements_mine", { p_client_id: clientId }).then(({ data, error }) => {
      if (!live) return;
      if (error || !data) return setSt({ loading: false, enabled: false, rows: [] });
      setSt({ loading: false, enabled: !!data.enabled, rows: Array.isArray(data.agreements) ? data.agreements : [] });
    });
    return () => {
      live = false;
    };
  }, [clientId]);

  if (st.loading || !st.enabled) return null;
  const today = AG_todayLocal();
  return (
    <div className="card ag-card" data-tour="client-agreements">
      <h3 className="card-title">Agreements</h3>
      {st.rows.length === 0 ? (
        <p className="card-subtitle">No agreements are shared with you yet. Your MyGoodBooks team adds them here.</p>
      ) : (
        <ul className="doc-req-list">
          {st.rows.map((r) => (
            <li key={r.id} className="doc-req">
              <div className="doc-req-main">
                <span className="doc-req-title">{r.title}</span>
                <span className="doc-req-meta">
                  {AG_typeLabel(r.agreement_type)}
                  {AG_dates(r) ? " · " + AG_dates(r) : ""}
                </span>
              </div>
              <div className="doc-req-actions">
                <AG_StatusPill row={r} today={today} />
                {(AG_safeUrl(r.document_url) || r.client_file_id) && (
                  <button type="button" className="btn-secondary" onClick={() => AG_openRow(r, toast)}>
                    Open
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// --- Staff ------------------------------------------------------------------

function AG_StaffCard({ client }) {
  const toast = AG_useToast();
  const clientId = client.id;
  const [perms, setPerms] = React.useState(null);
  const [rows, setRows] = React.useState([]);
  const [loadErr, setLoadErr] = React.useState(false);
  const [files, setFiles] = React.useState(null); // Drive files in Documents
  const [mode, setMode] = React.useState(null); // null | "add" | "bulk" | row id (edit)
  const [draft, setDraft] = React.useState(AG_initialDraft());
  const [bulk, setBulk] = React.useState({ text: "", agreement_type: "service_agreement", status: "signed" });
  const [busy, setBusy] = React.useState(false);
  const [showTrash, setShowTrash] = React.useState(false);

  const load = React.useCallback(async () => {
    const sb = window.mgbSupabase;
    if (!sb) return;
    const [p, r] = await Promise.all([
      sb.rpc("agreements_staff_perms", { p_client_id: clientId }),
      sb.from("client_agreements").select("*").eq("client_id", clientId).order("created_at", { ascending: false }).limit(500),
    ]);
    if (p.error || !p.data) {
      setPerms({ can_read: false });
      return;
    }
    setPerms(p.data);
    if (r.error) setLoadErr(true);
    else {
      setLoadErr(false);
      setRows(r.data || []);
    }
  }, [clientId]);

  React.useEffect(() => {
    load();
  }, [load]);

  // The launch notice ("client-agreements" in announcements.js) waits for this.
  const seen = !!(perms && perms.can_read);
  React.useEffect(() => {
    if (!seen) return;
    try {
      window.localStorage.setItem("mgb_ag_seen_card_v1", "1");
    } catch (e) {}
  }, [seen]);

  const loadFiles = React.useCallback(async () => {
    if (files || typeof DRV_list !== "function") return;
    try {
      const res = await DRV_list(clientId, "documents");
      setFiles((res && res.files) || []);
    } catch (e) {
      setFiles([]);
    }
  }, [clientId, files]);

  const needFiles = rows.some((r) => r.client_file_id);
  React.useEffect(() => {
    if (needFiles) loadFiles();
  }, [needFiles, loadFiles]);

  if (!perms || !perms.can_read) return null;
  const ro = !perms.can_edit || AG_ro();
  const isAdmin = !!perms.is_admin && !AG_ro();
  const today = AG_todayLocal();
  const live = AG_sort(rows.filter((r) => !r.trashed_at));
  const trashed = AG_sort(rows.filter((r) => r.trashed_at));
  const fileById = {};
  (files || []).forEach((f) => {
    fileById[f.id] = f;
  });

  function startAdd() {
    setDraft(AG_initialDraft());
    setMode("add");
    loadFiles();
  }
  function startEdit(r) {
    setDraft(AG_initialDraft(r));
    setMode(r.id);
    loadFiles();
  }
  function close() {
    setMode(null);
  }

  async function save(e) {
    e.preventDefault();
    if (ro) return;
    const errs = AG_validate(draft);
    if (errs.length) return toast(errs[0]);
    const payload = AG_toPayload(draft);
    setBusy(true);
    const sb = window.mgbSupabase;
    const res =
      mode === "add"
        ? await sb.from("client_agreements").insert({ ...payload, client_id: clientId })
        : await sb.from("client_agreements").update(payload).eq("id", mode).eq("client_id", clientId);
    setBusy(false);
    if (res.error) return toast("Couldn't save that agreement: " + res.error.message);
    toast(mode === "add" ? `Added "${payload.title}".` : `Saved "${payload.title}".`);
    setMode(null);
    load();
  }

  async function saveBulk(e) {
    e.preventDefault();
    if (ro) return;
    const parsed = AG_parseBulk(bulk.text);
    if (!parsed.rows.length) return toast(parsed.bad.length ? "No lines had an https:// link." : "Paste at least one link.");
    setBusy(true);
    const ins = parsed.rows.map((r) => ({
      client_id: clientId,
      title: r.title,
      document_url: r.document_url,
      agreement_type: bulk.agreement_type,
      status: bulk.status,
      visible_to_client: false,
    }));
    const { error } = await window.mgbSupabase.from("client_agreements").insert(ins);
    setBusy(false);
    if (error) return toast("Couldn't add those agreements: " + error.message);
    toast(
      `Added ${ins.length} agreement${ins.length === 1 ? "" : "s"} as Staff only.` +
        (parsed.bad.length ? ` Skipped ${parsed.bad.length} line${parsed.bad.length === 1 ? "" : "s"} without an https:// link.` : ""),
    );
    setBulk({ ...bulk, text: "" });
    setMode(null);
    load();
  }

  async function patch(r, change, msg) {
    if (ro && !(isAdmin && "trashed_at" in change)) return;
    setBusy(true);
    const { error } = await window.mgbSupabase.from("client_agreements").update(change).eq("id", r.id).eq("client_id", clientId);
    setBusy(false);
    if (error) return toast("Couldn't update that agreement: " + error.message);
    toast(msg);
    load();
  }

  function markSigned(r) {
    patch(r, { status: "signed", signed_on: r.signed_on || today }, `Marked "${r.title}" signed.`);
  }
  function toggleVisible(r) {
    patch(
      r,
      { visible_to_client: !r.visible_to_client },
      r.visible_to_client ? `"${r.title}" is now Staff only.` : `"${r.title}" is now visible to the client${perms.client_enabled ? "" : " (once client agreements are turned on)"}.`,
    );
  }
  function trash(r) {
    if (!window.confirm(`Move "${r.title}" to the trash? An admin can restore it.`)) return;
    patch(r, { trashed_at: new Date().toISOString() }, `Moved "${r.title}" to the trash.`);
  }
  function restore(r) {
    if (!isAdmin) return;
    patch(r, { trashed_at: null }, `Restored "${r.title}".`);
  }

  const bulkPreview = mode === "bulk" ? AG_parseBulk(bulk.text) : null;
  const draftFile = draft.client_file_id ? fileById[draft.client_file_id] : null;

  return (
    <div className="card ag-card" data-tour="staff-agreements">
      <div className="ag-head">
        <div style={{ minWidth: 0, flex: "1 1 220px" }}>
          <h3 className="card-title" style={{ margin: 0 }}>Agreements</h3>
          <p className="card-subtitle" style={{ margin: 0 }}>
            Service agreements, engagement letters and changes, with signed and renewal dates.
            {ro && !AG_ro() ? " Admins and this client's account manager can edit." : ""}
          </p>
        </div>
        {!ro && mode == null && (
          <div className="ag-toolbar">
            <button type="button" className="btn-primary" onClick={startAdd}>
              Add agreement
            </button>
            <button type="button" className="btn-secondary" onClick={() => setMode("bulk")}>
              Paste several links
            </button>
          </div>
        )}
      </div>

      {!perms.client_enabled && (
        <p className="ag-note">
          Clients don't see agreements yet, even ones marked Visible to client. The owner turns this on in Developer tools › Settings.
        </p>
      )}
      {loadErr && <p className="card-subtitle">Couldn't load agreements. Refresh to try again.</p>}

      {live.length === 0 && !loadErr && mode == null && <p className="card-subtitle">No agreements yet.</p>}

      {live.length > 0 && (
        <ul className="doc-req-list">
          {live.map((r) => {
            const exp = AG_expiryInfo(r, today);
            const f = r.client_file_id ? fileById[r.client_file_id] : null;
            const fileHidden = r.visible_to_client && f && f.visibility === "internal";
            return (
              <li key={r.id} className="doc-req">
                <div className="doc-req-main">
                  <span className="doc-req-title">{r.title}</span>
                  <span className="doc-req-meta">
                    {AG_typeLabel(r.agreement_type)}
                    {AG_dates(r) ? " · " + AG_dates(r) : ""}
                    {f ? " · File: " + f.name : ""}
                  </span>
                  <span className="ag-pills">
                    <AG_StatusPill row={r} today={today} />
                    <span className={"pill " + (r.visible_to_client ? "good" : "neutral")}>{r.visible_to_client ? "Visible to client" : "Staff only"}</span>
                    {exp.kind === "soon" && <span className="pill warm">{exp.label}</span>}
                  </span>
                  {r.staff_note && <span className="ag-staff-note">Staff note: {r.staff_note}</span>}
                  {fileHidden && <span className="ag-warn">The attached file is Staff only in Documents, so the client can't open it.</span>}
                </div>
                <div className="doc-req-actions ag-actions">
                  {(AG_safeUrl(r.document_url) || r.client_file_id) && (
                    <button type="button" className="btn-secondary" onClick={() => AG_openRow(r, toast)}>
                      Open
                    </button>
                  )}
                  {!ro && (
                    <React.Fragment>
                      {r.status !== "signed" && (
                        <button type="button" className="link-btn" disabled={busy} onClick={() => markSigned(r)}>
                          Mark signed
                        </button>
                      )}
                      <button type="button" className="link-btn" disabled={busy} onClick={() => toggleVisible(r)}>
                        {r.visible_to_client ? "Hide from client" : "Show to client"}
                      </button>
                      <button type="button" className="link-btn" disabled={busy} onClick={() => startEdit(r)}>
                        Edit
                      </button>
                      <button type="button" className="link-btn" disabled={busy} onClick={() => trash(r)}>
                        Move to trash
                      </button>
                    </React.Fragment>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {(mode === "add" || (mode && mode !== "bulk")) && !ro && (
        <form className="ms-form" onSubmit={save}>
          <div className="ms-form-title">{mode === "add" ? "Add agreement" : "Edit agreement"}</div>
          <div className="ms-form-row">
            <label className="task-field ag-wide">
              <span>Title</span>
              <input type="text" maxLength={AG_LIMITS.title} placeholder="Service agreement 2026" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            </label>
            <label className="task-field">
              <span>Type</span>
              <select value={draft.agreement_type} onChange={(e) => setDraft({ ...draft, agreement_type: e.target.value })}>
                {AG_TYPES.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="task-field">
              <span>Status</span>
              <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
                {AG_STATUSES.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="ms-form-row" style={{ marginTop: 10 }}>
            <label className="task-field">
              <span>Signed</span>
              <input type="date" value={draft.signed_on} onChange={(e) => setDraft({ ...draft, signed_on: e.target.value })} />
            </label>
            <label className="task-field">
              <span>Effective</span>
              <input type="date" value={draft.effective_on} onChange={(e) => setDraft({ ...draft, effective_on: e.target.value })} />
            </label>
            <label className="task-field">
              <span>Renews or expires (optional)</span>
              <input type="date" value={draft.expires_on} onChange={(e) => setDraft({ ...draft, expires_on: e.target.value })} />
            </label>
          </div>
          <div className="ms-form-row" style={{ marginTop: 10 }}>
            <label className="task-field ag-wide">
              <span>Link (Google Drive, https://)</span>
              <input type="url" maxLength={AG_LIMITS.url} placeholder="https://drive.google.com/…" value={draft.document_url} onChange={(e) => setDraft({ ...draft, document_url: e.target.value })} />
            </label>
            <label className="task-field ag-wide">
              <span>Or a file already in Documents</span>
              <select value={draft.client_file_id} onChange={(e) => setDraft({ ...draft, client_file_id: e.target.value })}>
                <option value="">{files == null ? "Loading files…" : "No file"}</option>
                {(files || []).map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                    {f.visibility === "internal" ? " (Staff only)" : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="task-field" style={{ marginTop: 10 }}>
            <span>Staff note (never shown to the client)</span>
            <textarea className="ag-textarea" rows={2} maxLength={AG_LIMITS.note} value={draft.staff_note} onChange={(e) => setDraft({ ...draft, staff_note: e.target.value })} />
          </label>
          <div className="ag-checks">
            <label className="ag-check">
              <input type="checkbox" checked={draft.visible_to_client} onChange={(e) => setDraft({ ...draft, visible_to_client: e.target.checked })} />
              Visible to client
            </label>
            {isAdmin && (
              <label className="ag-check ag-disabled" title="In-portal signing is planned, not built yet.">
                <input type="checkbox" checked={false} disabled readOnly />
                Client signing: not available yet
              </label>
            )}
          </div>
          {draft.visible_to_client && draftFile && draftFile.visibility === "internal" && (
            <p className="ag-warn">That file is Staff only in Documents, so the client won't be able to open it. Share the file first, or use a link.</p>
          )}
          <div className="ag-toolbar" style={{ marginTop: 12 }}>
            <button type="submit" className="btn-primary" disabled={busy || !draft.title.trim()}>
              {busy ? "Saving…" : mode === "add" ? "Add agreement" : "Save"}
            </button>
            <button type="button" className="btn-secondary" onClick={close} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {mode === "bulk" && !ro && (
        <form className="ms-form" onSubmit={saveBulk}>
          <div className="ms-form-title">Paste several links</div>
          <p className="card-subtitle" style={{ marginTop: 0 }}>
            One per line: <code>Title | https://…</code>, two spreadsheet columns (title, link), or just the link. They all start as Staff only.
          </p>
          <textarea
            className="ag-textarea"
            rows={6}
            placeholder={"Service agreement 2023 | https://drive.google.com/…\nEngagement letter 2024 | https://drive.google.com/…"}
            value={bulk.text}
            onChange={(e) => setBulk({ ...bulk, text: e.target.value })}
          />
          <div className="ms-form-row" style={{ marginTop: 10 }}>
            <label className="task-field">
              <span>Type for all</span>
              <select value={bulk.agreement_type} onChange={(e) => setBulk({ ...bulk, agreement_type: e.target.value })}>
                {AG_TYPES.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="task-field">
              <span>Status for all</span>
              <select value={bulk.status} onChange={(e) => setBulk({ ...bulk, status: e.target.value })}>
                {AG_STATUSES.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {bulkPreview && (bulkPreview.rows.length > 0 || bulkPreview.bad.length > 0) && (
            <p className="doc-req-meta" style={{ marginTop: 8 }}>
              {bulkPreview.rows.length} ready to add
              {bulkPreview.bad.length ? ` · skipping line${bulkPreview.bad.length === 1 ? "" : "s"} ${bulkPreview.bad.map((b) => b.line).join(", ")} (no https:// link)` : ""}
            </p>
          )}
          <div className="ag-toolbar" style={{ marginTop: 12 }}>
            <button type="submit" className="btn-primary" disabled={busy || !bulkPreview || !bulkPreview.rows.length}>
              {busy
                ? "Adding…"
                : bulkPreview && bulkPreview.rows.length
                  ? `Add ${bulkPreview.rows.length} agreement${bulkPreview.rows.length === 1 ? "" : "s"}`
                  : "Add agreements"}
            </button>
            <button type="button" className="btn-secondary" onClick={close} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {trashed.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <button type="button" className="link-btn" onClick={() => setShowTrash(!showTrash)}>
            {showTrash ? "Hide trash" : `Show trash (${trashed.length})`}
          </button>
          {showTrash && (
            <ul className="doc-req-list">
              {trashed.map((r) => (
                <li key={r.id} className="doc-req">
                  <div className="doc-req-main">
                    <span className="doc-req-title">{r.title}</span>
                    <span className="doc-req-meta">
                      {AG_typeLabel(r.agreement_type)} · in the trash{r.trashed_by ? " · moved by " + r.trashed_by : ""}
                    </span>
                  </div>
                  {isAdmin && (
                    <div className="doc-req-actions">
                      <button type="button" className="btn-secondary" disabled={busy} onClick={() => restore(r)}>
                        Restore
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
