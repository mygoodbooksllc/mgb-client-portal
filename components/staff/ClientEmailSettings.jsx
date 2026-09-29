// ----------------------------------------------------------------------------
// Team page: Client emails (owner request 2026-09-29). Admin-only card that
// controls every client-facing email sent by supabase/functions/client-emails
// (schema + rules in supabase/client-emails.sql):
//   - master switch, missing-documents chaser switch, monthly value report
//     switch (default OFF), reply-to address  -> client_email_settings
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

function CE_ClientEmailSettings() {
  const toast = typeof useToast === "function" ? useToast() : (m) => window.alert(m);
  const [st, setSt] = React.useState({ loading: true, settings: null, clients: [], prefs: {}, unsubs: [], log: [], error: null });
  const [replyTo, setReplyTo] = React.useState("");
  const [pick, setPick] = React.useState("");
  const [busy, setBusy] = React.useState(null);
  const [showAll, setShowAll] = React.useState(false);

  const load = React.useCallback(async () => {
    const sb = window.mgbSupabase;
    if (!sb) return setSt((s) => ({ ...s, loading: false }));
    const [s, c, p, u, l] = await Promise.all([
      sb.from("client_email_settings").select("enabled, doc_chaser_enabled, value_report_enabled, reply_to, updated_at, updated_by").eq("id", true).maybeSingle(),
      sb.from("clients").select("id, name, test_only").order("name"),
      sb.from("client_email_prefs").select("client_id, opt_out_all, opt_out_doc_chaser, opt_out_value_report, chaser_paused"),
      sb.from("client_email_recipients").select("client_id, email, opted_out_at, opted_out_via").not("opted_out_at", "is", null).order("opted_out_at", { ascending: false }),
      sb.from("client_email_log").select("id, created_at, feature, trigger, client_id, status, reason, recipients, requested_by").order("created_at", { ascending: false }).limit(15),
    ]);
    if (s.error || !s.data) return setSt((x) => ({ ...x, loading: false, error: s.error || new Error("no settings") }));
    const prefs = {};
    for (const r of (p && p.data) || []) prefs[r.client_id] = r;
    const clients = (c && c.data) || [];
    setSt({ loading: false, settings: s.data, clients, prefs, unsubs: (u && u.data) || [], log: (l && l.data) || [], error: null });
    setReplyTo(s.data.reply_to || "");
    setPick((cur) => cur || (clients[0] && clients[0].id) || "");
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
    const win = window.open("", "_blank");
    if (win) win.document.write('<p style="font-family:sans-serif;padding:20px;color:#555">Building the preview…</p>');
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
      const url = URL.createObjectURL(new Blob([body], { type: "text/html" }));
      if (win) win.location.href = url;
      else window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      if (would) toast(would === "yes" ? "This client would get this email." : "Wouldn't send right now: " + would.replace(/^no:\s*/, ""));
    } catch (e) {
      if (win) win.close();
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
  }

  if (st.loading || st.error || !st.settings) return null;
  const s = st.settings;
  const nameOf = (id) => (st.clients.find((c) => c.id === id) || {}).name || id || "All clients";
  const off = !s.enabled;
  const clientsShown = showAll ? st.clients : st.clients.slice(0, 8);

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <h3 className="card-title" style={{ margin: 0 }}>Client emails</h3>
      <p className="card-subtitle" style={{ margin: 0 }}>
        Emails that go to clients' portal users. Test clients never get them. Nothing here shows fees, rates or margins.
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
            {st.clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.test_only ? " (test)" : ""}
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
                    {c.test_only && <span className="tp-muted"> · test, never emailed</span>}
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
        {st.clients.length > 8 && (
          <button type="button" className="btn-secondary" style={{ marginTop: 6 }} onClick={() => setShowAll((v) => !v)}>
            {showAll ? "Show fewer" : `Show all ${st.clients.length} clients`}
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
                · {r.feature === "doc_chaser" ? "reminder" : "value report"} · {nameOf(r.client_id)}
                {r.trigger === "test" ? ` · test${r.requested_by ? " by " + r.requested_by : ""}` : ""}
                {r.status === "sent" && r.recipients && r.recipients.length ? ` · to ${r.recipients.join(", ")}` : ""}
                {r.reason ? ` · ${r.reason}` : ""} · {CE_when(r.created_at)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
