// ----------------------------------------------------------------------------
// Client overview (staff only): Document reminders card (owner request
// 2026-09-29). Sits under Document requests. Shows the automatic
// missing-documents reminders sent by supabase/functions/client-emails for
// this client, lets any staff member with access pause / resume them
// (client_email_prefs.chaser_paused; opt-outs stay admin-only on the Team
// page), and lists each open request's reminder count plus the recent send
// history (client_email_log). Fails soft: renders nothing for client users,
// before the migration exists, or when there's nothing to show.
//
// Loaded before app.jsx in the shared global scope: every top-level name
// carries a DC_ prefix; app.jsx globals (StaffToolsContext, useToast,
// relTime) are only touched at render time.
// ----------------------------------------------------------------------------

function DC_when(ts) {
  if (!ts) return "";
  try {
    if (typeof relTime === "function") return relTime(ts);
  } catch (e) {}
  return new Date(ts).toLocaleString();
}

function DC_useIsStaff() {
  const ctx = typeof StaffToolsContext !== "undefined" ? React.useContext(StaffToolsContext) : null;
  return !!(ctx && ctx.staff);
}

function DC_DocChaserCard({ client }) {
  const isStaff = DC_useIsStaff();
  const toast = typeof useToast === "function" ? useToast() : (m) => window.alert(m);
  const [st, setSt] = React.useState({ loading: true, prefs: null, open: [], chase: {}, log: [], ok: false });
  const [busy, setBusy] = React.useState(false);
  const clientId = client && client.id;

  const load = React.useCallback(async () => {
    const sb = window.mgbSupabase;
    if (!sb || !clientId) return setSt((s) => ({ ...s, loading: false }));
    const [p, o, l] = await Promise.all([
      sb.from("client_email_prefs").select("opt_out_all, opt_out_doc_chaser, chaser_paused").eq("client_id", clientId).maybeSingle(),
      sb.from("client_doc_requests").select("id, title, created_at").eq("client_id", clientId).eq("status", "open").order("created_at"),
      sb.from("client_email_log").select("id, created_at, trigger, status, reason, recipients, requested_by").eq("client_id", clientId).eq("feature", "doc_chaser").order("created_at", { ascending: false }).limit(8),
    ]);
    if (p.error || l.error) return setSt((s) => ({ ...s, loading: false, ok: false }));
    const open = (o && o.data) || [];
    const chase = {};
    if (open.length) {
      const c = await sb.from("client_doc_chase").select("request_id, reminders_sent, last_reminded_at").in("request_id", open.map((r) => r.id));
      for (const r of (c && c.data) || []) chase[r.request_id] = r;
    }
    setSt({ loading: false, prefs: p.data || {}, open, chase, log: (l && l.data) || [], ok: true });
  }, [clientId]);

  React.useEffect(() => {
    if (isStaff) load();
  }, [isStaff, load]);

  if (!isStaff || st.loading || !st.ok) return null;
  const prefs = st.prefs || {};
  if (!st.open.length && !st.log.length && !prefs.chaser_paused) return null;

  const paused = !!prefs.chaser_paused;
  const optedOut = prefs.opt_out_all ? "This client is opted out of all emails." : prefs.opt_out_doc_chaser ? "This client is opted out of document reminders." : null;
  const testOnly = !!(client && client.test_only);

  async function setPaused(v) {
    setBusy(true);
    const { error } = await window.mgbSupabase.from("client_email_prefs").upsert({ client_id: clientId, chaser_paused: v }, { onConflict: "client_id" });
    setBusy(false);
    if (error) return toast("Couldn't update reminders: " + error.message);
    toast(v ? `Reminders paused for ${client.name}.` : `Reminders resumed for ${client.name}.`);
    load();
  }

  const status = optedOut
    ? optedOut + " An admin can change that on the Emails page."
    : paused
      ? "Paused. No automatic reminders go out until you resume."
      : testOnly
        ? "Test client, so reminders are never emailed."
        : "On. Portal users get a reminder on day 0, day 3, day 7, then weekly until each document is uploaded.";

  return (
    <div className="card">
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-start", justifyContent: "space-between" }}>
        <div style={{ minWidth: 0, flex: "1 1 200px" }}>
          <h3 className="card-title" style={{ margin: 0 }}>Document reminders</h3>
          <p className="card-subtitle" style={{ margin: 0 }}>{status}</p>
        </div>
        {!optedOut && (
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => setPaused(!paused)}>
            {busy ? "Saving…" : paused ? "Resume reminders" : "Pause reminders"}
          </button>
        )}
      </div>

      {st.open.length > 0 && (
        <div style={{ marginTop: 10, fontSize: 13 }}>
          {st.open.map((r) => {
            const c = st.chase[r.id];
            const n = (c && c.reminders_sent) || 0;
            return (
              <div key={r.id} style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "2px 0" }}>
                <span>{r.title}</span>
                <span className="tp-muted">
                  · {n ? `${n} reminder${n === 1 ? "" : "s"}, last ${DC_when(c.last_reminded_at)}` : "no reminders yet"}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {st.log.length > 0 && (
        <div style={{ marginTop: 10, fontSize: 13 }}>
          <div className="tp-muted" style={{ marginBottom: 2 }}>History</div>
          {st.log.map((r) => (
            <div key={r.id} style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              <span>{r.status === "sent" ? "Sent" : r.status === "skipped" ? "Skipped" : r.status === "not_configured" ? "Email not configured" : "Failed"}</span>
              <span className="tp-muted">
                {r.trigger === "test" ? ` · test${r.requested_by ? " by " + r.requested_by : ""}` : ""}
                {r.status === "sent" && r.recipients && r.recipients.length ? ` · to ${r.recipients.join(", ")}` : ""}
                {r.reason ? ` · ${r.reason}` : ""} · {DC_when(r.created_at)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
