// ----------------------------------------------------------------------------
// Emails page (#/emails): Weekly admin digest settings (owner request 2026-09-29).
// The email itself is built and sent by supabase/functions/weekly-admin-digest
// every Monday 7:00 America/New_York (pg_cron -> digest_cron_tick(); schema in
// supabase/weekly-digest.sql). This card lets an admin:
//   - edit digest_settings.recipients and .enabled (admin-only RLS),
//   - Preview: opens the rendered HTML in a new tab (?preview=1, sends nothing),
//   - Send test now: sends to the recipients even when turned off,
//   - see the last few runs from digest_runs.
// Fails soft: before the migration is live, or for non-admins, it renders a
// short note (or nothing) instead of erroring.
//
// Loaded before app.jsx in the shared global scope, so every top-level name
// carries a DG_ prefix and app.jsx globals (useToast, relTime) are only
// touched at render time.
// ----------------------------------------------------------------------------

const DG_FN = "weekly-admin-digest";
const DG_STATUS_LABEL = {
  sent: "Sent",
  preview: "Preview",
  not_configured: "Email not configured",
  disabled: "Skipped (turned off)",
  error: "Failed",
};

function DG_isMissing(error) {
  if (!error) return false;
  const code = error.code || "";
  return (
    code === "PGRST205" ||
    code === "42P01" ||
    /could not find the table|does not exist|schema cache/i.test(String(error.message || ""))
  );
}

function DG_parseRecipients(text) {
  return String(text || "")
    .split(/[\s,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function DG_when(ts) {
  if (!ts) return "";
  try {
    if (typeof relTime === "function") return relTime(ts);
  } catch (e) {}
  return new Date(ts).toLocaleString();
}

function DG_DigestSettings({ onSent } = {}) {
  const toast = typeof useToast === "function" ? useToast() : (m) => window.alert(m);
  const [state, setState] = React.useState({ loading: true, settings: null, runs: [], missing: false, error: null });
  const [recipientsText, setRecipientsText] = React.useState("");
  const [busy, setBusy] = React.useState(null); // "save" | "toggle" | "preview" | "send"

  const load = React.useCallback(async () => {
    const sb = window.mgbSupabase;
    if (!sb) {
      setState({ loading: false, settings: null, runs: [], missing: false, error: null });
      return;
    }
    const [s, r] = await Promise.all([
      sb.from("digest_settings").select("recipients, enabled, send_dow, send_hour, timezone, updated_at").eq("id", true).maybeSingle(),
      sb.from("digest_runs").select("id, started_at, trigger, status, requested_by, detail").order("started_at", { ascending: false }).limit(5),
    ]);
    if (s.error) {
      setState({ loading: false, settings: null, runs: [], missing: DG_isMissing(s.error), error: s.error });
      return;
    }
    setState({ loading: false, settings: s.data, runs: (r && r.data) || [], missing: false, error: null });
    setRecipientsText(((s.data && s.data.recipients) || []).join(", "));
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  async function save(patch, kind) {
    const sb = window.mgbSupabase;
    if (!sb) return;
    setBusy(kind);
    const { error } = await sb.from("digest_settings").update(patch).eq("id", true);
    setBusy(null);
    if (error) {
      toast("Couldn't save the digest settings: " + error.message);
      return;
    }
    toast(kind === "toggle" ? (patch.enabled ? "Weekly digest turned on." : "Weekly digest turned off.") : "Recipients saved.");
    load();
  }

  function saveRecipients() {
    const list = DG_parseRecipients(recipientsText);
    if (!list.length) {
      toast("Add at least one email address.");
      return;
    }
    const bad = list.filter((e) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
    if (bad.length) {
      toast("Not a valid email: " + bad.join(", "));
      return;
    }
    save({ recipients: list }, "save");
  }

  async function preview() {
    const sb = window.mgbSupabase;
    if (!sb) return;
    // Open the tab now (inside the click) so pop-up blockers allow it.
    const win = window.open("", "_blank");
    if (win) win.document.write("<p style=\"font-family:sans-serif;padding:20px;color:#555\">Building the digest preview…</p>");
    setBusy("preview");
    try {
      const { data } = await sb.auth.getSession();
      const token = data && data.session && data.session.access_token;
      if (!token) throw new Error("sign in again to preview");
      const cfg = window.SUPABASE_CONFIG || {};
      const res = await fetch(`${cfg.url}/functions/v1/${DG_FN}?preview=1`, {
        headers: { Authorization: `Bearer ${token}`, apikey: cfg.anonKey || "" },
      });
      const body = await res.text();
      if (!res.ok) {
        let msg = body;
        try {
          msg = JSON.parse(body).error || body;
        } catch (e) {}
        throw new Error(msg || `HTTP ${res.status}`);
      }
      const url = URL.createObjectURL(new Blob([body], { type: "text/html" }));
      if (win) win.location.href = url;
      else window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      if (win) win.close();
      toast("Couldn't build the preview: " + (e.message || String(e)));
    }
    setBusy(null);
    load();
  }

  async function sendTest() {
    const sb = window.mgbSupabase;
    if (!sb) return;
    setBusy("send");
    let data = null;
    let err = null;
    try {
      const res = await sb.functions.invoke(DG_FN, { body: {} });
      data = res.data;
      err = res.error;
      if (err && err.context && typeof err.context.json === "function") {
        try {
          const b = await err.context.json();
          if (b && (b.status || b.error)) {
            data = b;
            err = null;
          }
        } catch (e) {}
      }
    } catch (e) {
      err = e;
    }
    setBusy(null);
    const st = data && data.status;
    if (err) toast("Send failed: " + (err.message || String(err)));
    else if (st === "sent") toast(`Test digest sent to ${(data.recipients || []).join(", ")}.`);
    else if (st === "not_configured") toast("Email isn't configured yet. The owner needs to add the RESEND_API_KEY secret in Supabase.");
    else toast("Send failed: " + ((data && data.error) || "unknown error"));
    load();
    if (typeof onSent === "function") onSent();
  }

  if (state.loading) return null;
  if (state.error && !state.missing) {
    // Non-admins can't read digest_settings; render nothing for them.
    return null;
  }

  const s = state.settings;
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const schedule = s
    ? `${days[s.send_dow] || "Monday"}s at ${((s.send_hour + 11) % 12) + 1}:00 ${s.send_hour < 12 ? "AM" : "PM"} (${String(s.timezone || "America/New_York").replace("_", " ")})`
    : "";

  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-start", justifyContent: "space-between" }}>
        <div style={{ minWidth: 0 }}>
          <h3 className="card-title" style={{ margin: 0 }}>Weekly digest</h3>
          <p className="card-subtitle" style={{ margin: 0 }}>
            An admin email with scope creep, pricing, revenue, late payers, timesheet gaps, the staff
            scorecard, stale clients and pending items.{schedule ? ` Sent ${schedule}.` : ""}
          </p>
        </div>
        {s && (
          <label style={{ display: "flex", alignItems: "center", gap: 8, whiteSpace: "nowrap", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={!!s.enabled}
              disabled={!!busy}
              onChange={(e) => save({ enabled: e.target.checked }, "toggle")}
            />
            <span>{s.enabled ? "On" : "Off"}</span>
          </label>
        )}
      </div>

      {state.missing ? (
        <p className="tp-muted" style={{ marginTop: 10 }}>Not set up yet. The digest hasn't been installed on the server.</p>
      ) : (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "flex-end", marginTop: 12 }}>
            <label className="task-field" style={{ flex: "1 1 240px" }}>
              <span>Recipients (comma separated)</span>
              <input
                type="text"
                inputMode="email"
                className="tp-q-input"
                value={recipientsText}
                onChange={(e) => setRecipientsText(e.target.value)}
                placeholder="admin@mygoodbooks.org"
              />
            </label>
            <button type="button" className="btn-secondary" onClick={saveRecipients} disabled={!!busy}>
              {busy === "save" ? "Saving…" : "Save"}
            </button>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
            <button type="button" className="btn-secondary" onClick={preview} disabled={!!busy}>
              {busy === "preview" ? "Building…" : "Preview"}
            </button>
            <button type="button" className="btn-primary" onClick={sendTest} disabled={!!busy}>
              {busy === "send" ? "Sending…" : "Send test now"}
            </button>
          </div>

          {state.runs.length > 0 && (
            <div style={{ marginTop: 12, fontSize: 13 }}>
              <div className="tp-muted" style={{ marginBottom: 4 }}>Recent runs</div>
              {state.runs.map((r) => (
                <div key={r.id} style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  <span>{DG_STATUS_LABEL[r.status] || r.status}</span>
                  <span className="tp-muted">
                    · {r.trigger === "cron" ? "scheduled" : r.trigger === "manual" ? "test" : r.trigger}
                    {r.requested_by ? ` by ${r.requested_by}` : ""} · {DG_when(r.started_at)}
                  </span>
                  {r.status === "error" && r.detail && <span className="tp-muted">· {r.detail}</span>}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
