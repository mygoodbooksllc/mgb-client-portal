// ----------------------------------------------------------------------------
// Emails page (#/emails): Client emails (owner request 2026-09-29). Admin-only card that
// controls every client-facing email sent by supabase/functions/client-emails
// (schema + rules in supabase/client-emails.sql):
//   - master switch, missing-documents chaser switch, monthly value report
//     switch (default OFF), reply-to address  -> client_email_settings
//   - "Ask client emails live" (client_request_enabled, owner-only, default
//     OFF). Saved with the same plain update; the database trigger
//     tk_guard_client_request_switch refuses anyone but the owner
//     (is_internal_owner) and audits who/when in tk_settings_audit. Shows the
//     pilot list (tk_settings.client_request_pilot, read-only here). Rules and
//     copy in clientEmailsAskLogic.js.
//   - per-client opt-outs (all / chaser / value report) and chaser pause
//                                             -> client_email_prefs
//   - people who unsubscribed via the email link, with Resubscribe
//                                             -> client_email_recipients
//   - Preview / Send test to me for either email, for any client
//   - recent attempts                         -> client_email_log
// The edge function re-checks all of these server-side before every send;
// this card only edits them. Fails soft (renders nothing for non-admins or
// before the migration exists).
//
// Loaded before app.jsx in the shared global scope: every top-level name
// carries a CE_ prefix; app.jsx globals (useToast, relTime) are only touched
// at render time.
// ----------------------------------------------------------------------------

const CE_FN = "client-emails";
const CE_JOBS = [
  { key: "doc_chaser", label: "Missing-documents reminders" },
  { key: "value_report", label: "Monthly value report" },
];
const CE_STATUS = {
  sent: "Sent",
  skipped: "Skipped",
  not_configured: "Email not configured",
  error: "Failed",
  preview: "Preview",
};

// client_email_log.feature -> short label for the activity list. The
// notification kinds come from supabase/notification-emails.sql.
const CE_FEATURE_LABEL = {
  doc_chaser: "reminder",
  value_report: "value report",
  staff_client_message: "staff: client message",
  staff_doc_upload: "staff: document uploaded",
  staff_task_assigned: "staff: task assigned",
  staff_task_due: "staff: tasks due today",
  staff_feedback_status: "staff: feedback status",
  client_message: "client: bookkeeper message",
  client_reports_ready: "client: reports ready",
};

function CE_when(ts) {
  if (!ts) return "";
  try {
    if (typeof relTime === "function") return relTime(ts);
  } catch (e) {}
  return new Date(ts).toLocaleString();
}

async function CE_callFn(body) {
  const sb = window.mgbSupabase;
  const { data } = await sb.auth.getSession();
  const token = data && data.session && data.session.access_token;
  if (!token) throw new Error("sign in again");
  const cfg = window.SUPABASE_CONFIG || {};
  return fetch(`${cfg.url}/functions/v1/${CE_FN}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, apikey: cfg.anonKey || "", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function CE_Toggle({ checked, disabled, onChange, label, hint }) {
  return (
    <label style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: disabled ? "default" : "pointer", padding: "6px 0" }}>
      <input type="checkbox" checked={!!checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} style={{ marginTop: 3 }} />
      <span>
        <span>{label}</span>
        {hint && <span className="tp-muted" style={{ display: "block", fontSize: 12 }}>{hint}</span>}
      </span>
    </label>
  );
}

function CE_ClientEmailSettings({ onSent } = {}) {
  const toast = typeof useToast === "function" ? useToast() : (m) => window.alert(m);
  const [st, setSt] = React.useState({ loading: true, settings: null, clients: [], prefs: {}, unsubs: [], log: [], error: null, isOwner: false, pilot: null, askAudit: null });
  const [replyTo, setReplyTo] = React.useState("");
  const [pick, setPick] = React.useState("");
  const [busy, setBusy] = React.useState(null);
  const [showAll, setShowAll] = React.useState(false);
  // { title, html } while the preview modal is open.
  const [previewDoc, setPreviewDoc] = React.useState(null);

  const load = React.useCallback(async () => {
    const sb = window.mgbSupabase;
    if (!sb) return setSt((s) => ({ ...s, loading: false }));
    const [s, c, p, u, l, own, pil, aud] = await Promise.all([
      sb.from("client_email_settings").select("enabled, doc_chaser_enabled, value_report_enabled, reply_to, updated_at, updated_by, client_request_enabled").eq("id", true).maybeSingle(),
      sb.from("clients").select("id, name, test_only, is_internal").order("name"),
      sb.from("client_email_prefs").select("client_id, opt_out_all, opt_out_doc_chaser, opt_out_value_report, chaser_paused"),
      sb.from("client_email_recipients").select("client_id, email, opted_out_at, opted_out_via").not("opted_out_at", "is", null).order("opted_out_at", { ascending: false }),
      sb.from("client_email_log").select("id, created_at, feature, trigger, client_id, status, reason, recipients, requested_by").order("created_at", { ascending: false }).limit(15),
      // Owner-only Ask client switch: who may flip it, the pilot list, the last change.
      // Each fails soft (a failed call means "not owner" / "not set" / no line).
      Promise.resolve(sb.rpc("is_internal_owner")).catch(() => ({ data: false })),
      Promise.resolve(sb.from("tk_settings").select("value").eq("key", "client_request_pilot").maybeSingle()).catch(() => ({ data: null })),
      Promise.resolve(
        sb.from("tk_settings_audit").select("new_value, changed_by, changed_at").eq("key", "client_email_settings.client_request_enabled").order("changed_at", { ascending: false }).limit(1)
      ).catch(() => ({ data: null })),
    ]);
    if (s.error || !s.data) return setSt((x) => ({ ...x, loading: false, error: s.error || new Error("no settings") }));
    const prefs = {};
    for (const r of (p && p.data) || []) prefs[r.client_id] = r;
    // MGB (internal) is the firm's own books, not a client: no client email settings.
    const clients = ((c && c.data) || [])
      .filter((x) => x.is_internal !== true && !(typeof window.mgbIsInternalClient === "function" && window.mgbIsInternalClient(x.id)))
      .map((x) => ({ ...x, testOnly: x.test_only === true }));
    setSt({
      loading: false,
      settings: s.data,
      clients,
      prefs,
      unsubs: (u && u.data) || [],
      log: (l && l.data) || [],
      error: null,
      isOwner: !!(own && !own.error && own.data === true),
      pilot: pil && !pil.error && pil.data ? pil.data.value : null,
      askAudit: (aud && !aud.error && aud.data && aud.data[0]) || null,
    });
    setReplyTo(s.data.reply_to || "");
    // First pick is a real client: test clients sort last.
    setPick((cur) => cur || ((CF_sort(clients)[0] || {}).id) || "");
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  async function saveSettings(patch, msg) {
    setBusy("settings");
    const { error } = await window.mgbSupabase.from("client_email_settings").update(patch).eq("id", true);
    setBusy(null);
    if (error) return toast("Couldn't save: " + error.message);
    toast(msg);
    load();
  }

  // Ask client emails live: ON needs a confirm that says who gets emailed;
  // OFF is immediate. The database refuses anyone but the owner.
  async function saveAskSwitch(v) {
    if (v) {
      // Read the pilot list again so the confirm names who gets emailed now,
      // not when the page loaded. A failed read falls back to the loaded one.
      let current = st.pilot;
      try {
        const r = await window.mgbSupabase.from("tk_settings").select("value").eq("key", "client_request_pilot").maybeSingle();
        if (r && !r.error) current = r.data ? r.data.value : null;
      } catch (e) {}
      if (current !== st.pilot) setSt((x) => ({ ...x, pilot: current }));
      const pilot = CEA_pilotStatus(current, st.clients);
      if (!window.confirm(CEA_confirmText({ pilot, masterOn: !!(st.settings && st.settings.enabled) }))) return;
    }
    setBusy("settings");
    const { error } = await window.mgbSupabase.from("client_email_settings").update({ client_request_enabled: v }).eq("id", true);
    setBusy(null);
    if (error) {
      toast(CEA_saveError(error));
      return load();
    }
    toast(v ? "Ask client emails are live for the pilot clients." : "Ask client emails are a dry run again.");
    load();
  }

  async function savePref(clientId, field, value) {
    setBusy("pref:" + clientId);
    const { error } = await window.mgbSupabase
      .from("client_email_prefs")
      .upsert({ client_id: clientId, [field]: value }, { onConflict: "client_id" });
    setBusy(null);
    if (error) return toast("Couldn't save: " + error.message);
    load();
  }

  async function resubscribe(u) {
    if (!window.confirm(`Resubscribe ${u.email}? Only do this if they asked to get these emails again.`)) return;
    setBusy("resub");
    const { error } = await window.mgbSupabase
      .from("client_email_recipients")
      .update({ opted_out_at: null, opted_out_via: null })
      .eq("client_id", u.client_id)
      .eq("email", u.email);
    setBusy(null);
    if (error) return toast("Couldn't resubscribe: " + error.message);
    toast(`${u.email} will get client emails again.`);
    load();
  }

  async function preview(job) {
    if (!pick) return;
    setBusy("preview:" + job);
    try {
      const res = await CE_callFn({ job, action: "preview", client_id: pick });
      const body = await res.text();
      if (!res.ok) {
        let msg = body;
        try {
          msg = JSON.parse(body).error || body;
        } catch (e) {}
        throw new Error(msg || `HTTP ${res.status}`);
      }
      const would = res.headers.get("X-Would-Send") || "";
      // Shown in a sandboxed srcdoc iframe, not a same-origin blob: tab, so
      // an escaping slip in a template can't run script with this session
      // (security audit L8).
      const label = (CE_JOBS.find((j) => j.key === job) || {}).label || "Email";
      setPreviewDoc({ title: label + " preview", html: body });
      if (would) toast(would === "yes" ? "This client would get this email." : "Wouldn't send right now: " + would.replace(/^no:\s*/, ""));
    } catch (e) {
      toast("Couldn't build the preview: " + (e.message || String(e)));
    }
    setBusy(null);
  }

  async function sendTest(job) {
    if (!pick) return;
    setBusy("test:" + job);
    let data = null;
    try {
      const res = await CE_callFn({ job, action: "test", client_id: pick });
      data = await res.json().catch(() => null);
    } catch (e) {
      data = { status: "error", error: e.message || String(e) };
    }
    setBusy(null);
    const s = data && data.status;
    if (s === "sent") toast(`Test sent to ${data.to}.`);
    else if (s === "skipped") toast("Not sent: " + data.reason);
    else if (s === "not_configured") toast("Email isn't configured yet. The owner needs to add the RESEND_API_KEY secret in Supabase.");
    else toast("Send failed: " + ((data && data.error) || "unknown error"));
    load();
    if (typeof onSent === "function") onSent();
  }

  // Test clients last with a tag; hidden unless "Show test clients" is on (the picked one stays).
  const shownClients = CF_usePicked(st.clients, null, pick);
  if (st.loading) return null;
  if (st.error || !st.settings) {
    return (
      <div className="card" style={{ marginBottom: 20 }}>
        <h3 className="card-title" style={{ margin: 0 }}>Client emails</h3>
        <p className="tp-muted" style={{ margin: "6px 0 10px" }}>
          Couldn't load the client email settings{st.error && st.error.message ? ": " + st.error.message : "."}
        </p>
        <button type="button" className="btn-secondary" onClick={() => { setSt((x) => ({ ...x, loading: true, error: null })); load(); }}>
          Retry
        </button>
      </div>
    );
  }
  const s = st.settings;
  const nameOf = (id) => (st.clients.find((c) => c.id === id) || {}).name || id || "All clients";
  const off = !s.enabled;
  const clientsShown = showAll ? shownClients : shownClients.slice(0, 8);

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <h3 className="card-title" style={{ margin: 0 }}>Client emails</h3>
      <p className="card-subtitle" style={{ margin: 0 }}>
        Emails that go to clients' portal users. Test clients never get the automatic ones; Send test to me and Ask client on a test client send one [Test] copy to you only. Nothing here shows fees, rates or margins.
      </p>

      <div style={{ marginTop: 10 }}>
        <CE_Toggle
          checked={s.enabled}
          disabled={!!busy}
          label={<b>Send client emails</b>}
          hint="Master switch. Off stops every client email, including tests."
          onChange={(v) => saveSettings({ enabled: v }, v ? "Client emails turned on." : "All client emails turned off.")}
        />
        <div style={{ paddingLeft: 24, opacity: off ? 0.55 : 1 }}>
          <CE_Toggle
            checked={s.doc_chaser_enabled}
            disabled={!!busy}
            label="Missing-documents reminders"
            hint="Daily at 10 AM. Emails a client about open document requests on day 0, day 3, day 7, then weekly until uploaded."
            onChange={(v) => saveSettings({ doc_chaser_enabled: v }, v ? "Document reminders turned on." : "Document reminders turned off.")}
          />
          <CE_Toggle
            checked={s.value_report_enabled}
            disabled={!!busy}
            label="Monthly value report"
            hint="On the 3rd: last month's hours, tasks completed, month-end close status and documents received."
            onChange={(v) => saveSettings({ value_report_enabled: v }, v ? "Monthly value report turned on." : "Monthly value report turned off.")}
          />
          {typeof CEA_pilotStatus === "function" && "client_request_enabled" in s && (() => {
            const rs = CEA_rowState({ isOwner: st.isOwner, busy });
            const pilot = CEA_pilotStatus(st.pilot, st.clients);
            const last = CEA_lastChange(st.askAudit, CE_when);
            return (
              <div>
                <CE_Toggle
                  checked={s.client_request_enabled}
                  disabled={!rs.canToggle}
                  label={
                    <span>
                      Ask client emails live
                      {rs.note && <span className="pill neutral" style={{ marginLeft: 6, fontSize: 11 }}>{rs.note}</span>}
                    </span>
                  }
                  hint={CEA_hint()}
                  onChange={saveAskSwitch}
                />
                <div className="tp-muted" style={{ fontSize: 12, paddingLeft: 24, marginTop: -2 }}>
                  {CEA_statusLine({ pilot })}
                  {last ? <span style={{ display: "block" }}>{last}</span> : null}
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end", marginTop: 8 }}>
        <label className="task-field" style={{ flex: "1 1 240px" }}>
          <span>Replies go to</span>
          <input type="text" inputMode="email" className="tp-q-input" value={replyTo} onChange={(e) => setReplyTo(e.target.value)} placeholder="admin@mygoodbooks.org" />
        </label>
        <button
          type="button"
          className="btn-secondary"
          disabled={!!busy}
          onClick={() => {
            const v = replyTo.trim().toLowerCase();
            if (v && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return toast("Not a valid email: " + v);
            saveSettings({ reply_to: v || null }, "Reply-to saved.");
          }}
        >
          Save
        </button>
      </div>

      <div style={{ marginTop: 16 }}>
        <div className="tp-muted" style={{ marginBottom: 6 }}>Preview or send yourself a test</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <select className="tp-q-input" value={pick} onChange={(e) => setPick(e.target.value)} style={{ flex: "1 1 200px", maxWidth: 320 }} aria-label="Client">
            {shownClients.map((c) => (
              <option key={c.id} value={c.id}>
                {CF_label(c)}
              </option>
            ))}
          </select>
        </div>
        {CE_JOBS.map((j) => (
          <div key={j.key} style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 8 }}>
            <span style={{ flex: "1 1 200px" }}>{j.label}</span>
            <button type="button" className="btn-secondary" disabled={!!busy || !pick} onClick={() => preview(j.key)}>
              {busy === "preview:" + j.key ? "Building…" : "Preview"}
            </button>
            <button type="button" className="btn-secondary" disabled={!!busy || !pick} onClick={() => sendTest(j.key)}>
              {busy === "test:" + j.key ? "Sending…" : "Send test to me"}
            </button>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 16, overflowX: "auto" }}>
        <div className="tp-muted" style={{ marginBottom: 6 }}>Per client</div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr className="tp-muted" style={{ textAlign: "left" }}>
              <th style={{ padding: "4px 6px 4px 0", fontWeight: 500 }}>Client</th>
              <th style={{ padding: 4, fontWeight: 500, textAlign: "center" }}>No emails</th>
              <th style={{ padding: 4, fontWeight: 500, textAlign: "center" }}>No reminders</th>
              <th style={{ padding: 4, fontWeight: 500, textAlign: "center" }}>No value report</th>
              <th style={{ padding: 4, fontWeight: 500, textAlign: "center" }}>Reminders paused</th>
            </tr>
          </thead>
          <tbody>
            {clientsShown.map((c) => {
              const p = st.prefs[c.id] || {};
              const dis = !!busy;
              const cell = (field) => (
                <td style={{ padding: 4, textAlign: "center" }}>
                  <input
                    type="checkbox"
                    aria-label={`${field.replace(/_/g, " ")} for ${c.name}`}
                    checked={!!p[field]}
                    disabled={dis}
                    onChange={(e) => savePref(c.id, field, e.target.checked)}
                  />
                </td>
              );
              return (
                <tr key={c.id} style={{ borderTop: "1px solid var(--border, rgba(0,0,0,0.08))" }}>
                  <td style={{ padding: "4px 6px 4px 0" }}>
                    {c.name}
                    <CF_Badge client={c} />
                    {c.test_only && <span className="tp-muted"> never emailed</span>}
                  </td>
                  {cell("opt_out_all")}
                  {cell("opt_out_doc_chaser")}
                  {cell("opt_out_value_report")}
                  {cell("chaser_paused")}
                </tr>
              );
            })}
          </tbody>
        </table>
        {shownClients.length > 8 && (
          <button type="button" className="btn-secondary" style={{ marginTop: 6 }} onClick={() => setShowAll((v) => !v)}>
            {showAll ? "Show fewer" : `Show all ${shownClients.length} clients`}
          </button>
        )}
      </div>

      {st.unsubs.length > 0 && (
        <div style={{ marginTop: 16, fontSize: 13 }}>
          <div className="tp-muted" style={{ marginBottom: 4 }}>Unsubscribed by the recipient</div>
          {st.unsubs.map((u) => (
            <div key={u.client_id + u.email} style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", padding: "2px 0" }}>
              <span>{u.email}</span>
              <span className="tp-muted">· {nameOf(u.client_id)} · {CE_when(u.opted_out_at)}</span>
              <button type="button" className="btn-secondary" style={{ padding: "2px 8px", fontSize: 12 }} disabled={!!busy} onClick={() => resubscribe(u)}>
                Resubscribe
              </button>
            </div>
          ))}
        </div>
      )}

      {st.log.length > 0 && (
        <div style={{ marginTop: 16, fontSize: 13 }}>
          <div className="tp-muted" style={{ marginBottom: 4 }}>Recent activity</div>
          {st.log.map((r) => (
            <div key={r.id} style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              <span>{CE_STATUS[r.status] || r.status}</span>
              <span className="tp-muted">
                · {CE_FEATURE_LABEL[r.feature] || String(r.feature || "email").replace(/_/g, " ")} · {nameOf(r.client_id)}
                {r.trigger === "test" ? ` · test${r.requested_by ? " by " + r.requested_by : ""}` : ""}
                {r.status === "sent" && r.recipients && r.recipients.length ? ` · to ${r.recipients.join(", ")}` : ""}
                {r.reason ? ` · ${r.reason}` : ""} · {CE_when(r.created_at)}
              </span>
            </div>
          ))}
        </div>
      )}
      {previewDoc && (
        <ModalShell onClose={() => setPreviewDoc(null)} labelledBy="ce-preview-title" className="email-preview-modal">
          <div className="modal-header">
            <h3 className="card-title" id="ce-preview-title" style={{ margin: 0 }}>
              {previewDoc.title}
            </h3>
            <button type="button" className="modal-close" onClick={() => setPreviewDoc(null)} aria-label="Close">
              ×
            </button>
          </div>
          {/* sandbox="" : opaque origin, no scripts, no forms, no top navigation. */}
          <iframe className="email-preview-frame" sandbox="" srcDoc={previewDoc.html} title="Client email preview" />
        </ModalShell>
      )}
    </div>
  );
}
