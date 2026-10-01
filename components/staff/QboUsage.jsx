// ----------------------------------------------------------------------------
// QuickBooks API usage card (QBO features plan, Phase 1, 2026-09-30). Admin
// Team page, under the QuickBooks Time panel.
//
// Intuit meters QuickBooks Online read calls (500,000 a month on the free
// Builder tier). qbo-sync and qbo-firm-sync count their calls into
// qbo_api_usage; qbo_usage_status() returns month-to-date calls, a
// straight-line projection to month end and the mode:
//   normal     Pro clients sync every premium_interval_min (15); Basic on
//              the 15th (the retired Plus plan's weekly branch is unused)
//   throttled  projection >= throttle_pct of the cap: Pro every 30 min
//   stopped    calls >= hard_stop_pct of the cap: scheduled syncs stop until
//              the 1st; "Sync now" still works
// Admins edit the thresholds and cadences (qbo_usage_settings, admin-only RLS).
// See supabase/qbo-usage-guard.sql.
//
// Loaded before app.jsx and shares its global scope: top-level names carry a
// QU_ prefix; app.jsx globals (hooks, useToast) are only touched at render.
// ----------------------------------------------------------------------------

const QU_fmt = (n) => Number(n || 0).toLocaleString("en-US");
const QU_pct = (n, cap) => (Number(cap) ? Math.round((Number(n || 0) / Number(cap)) * 100) : 0);
const QU_SOURCE_LABEL = {
  "qbo-sync": "Client syncs",
  "qbo-firm-sync": "QuickBooks Time",
  estimate: "Estimated (before counting started)",
};
const QU_MODE = {
  normal: { label: "Normal", cls: "qu-normal" },
  throttled: { label: "Slowed down", cls: "qu-throttled" },
  stopped: { label: "Scheduled syncs stopped", cls: "qu-stopped" },
};

function QU_UsageCard() {
  const showToast = typeof useToast === "function" ? useToast() : null;
  const toast = (m) => showToast && showToast(m);
  const [status, setStatus] = useState(null);
  const [settings, setSettings] = useState(null);
  const [err, setErr] = useState(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const sb = window.mgbSupabase;
    if (!sb) {
      setErr("Supabase isn't configured.");
      return;
    }
    const [st, se] = await Promise.all([
      sb.rpc("qbo_usage_status").then((r) => r, (e) => ({ error: e })),
      sb.from("qbo_usage_settings").select("*").maybeSingle().then((r) => r, (e) => ({ error: e })),
    ]);
    if (st.error) {
      setErr(st.error.message || "Couldn't load usage.");
      return;
    }
    setErr(null);
    setStatus(st.data);
    if (se.data) setSettings(se.data);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const startEdit = () => {
    if (!settings) return;
    setDraft({
      monthly_cap: String(settings.monthly_cap),
      throttle_pct: String(Math.round(Number(settings.throttle_pct) * 100)),
      hard_stop_pct: String(Math.round(Number(settings.hard_stop_pct) * 100)),
      premium_interval_min: String(settings.premium_interval_min),
      throttled_interval_min: String(settings.throttled_interval_min),
    });
    setEditing(true);
  };

  const save = async (e) => {
    e.preventDefault();
    const cap = parseInt(draft.monthly_cap, 10);
    const thr = parseInt(draft.throttle_pct, 10);
    const stop = parseInt(draft.hard_stop_pct, 10);
    const pro = parseInt(draft.premium_interval_min, 10);
    const slow = parseInt(draft.throttled_interval_min, 10);
    if (!(cap >= 1000)) return toast("The monthly limit must be at least 1,000.");
    if (!(thr >= 1 && thr <= 100 && stop >= 1 && stop <= 100 && thr <= stop))
      return toast("Pick percentages between 1 and 100, with slow-down at or below stop.");
    if (!(pro >= 5 && pro <= 1440 && slow >= pro && slow <= 1440))
      return toast("Cadences are 5 to 1440 minutes, and the slowed-down one can't be faster than normal.");
    const sb = window.mgbSupabase;
    if (!sb) return;
    setSaving(true);
    const { error } = await sb
      .from("qbo_usage_settings")
      .update({
        monthly_cap: cap,
        throttle_pct: thr / 100,
        hard_stop_pct: stop / 100,
        premium_interval_min: pro,
        throttled_interval_min: slow,
      })
      .eq("id", true);
    setSaving(false);
    if (error) return toast("Couldn't save. " + (error.message || ""));
    setEditing(false);
    toast("Usage settings saved.");
    load();
  };

  const head = (
    <div className="qu-head">
      <div style={{ minWidth: 0 }}>
        <h3 className="card-title" style={{ margin: 0 }}>QuickBooks API usage</h3>
        <p className="card-subtitle" style={{ margin: 0 }}>
          Calls to QuickBooks this month, counted against Intuit's monthly limit.
        </p>
      </div>
      {status && (
        <span className={"qu-mode " + (QU_MODE[status.mode] || QU_MODE.normal).cls}>
          {(QU_MODE[status.mode] || QU_MODE.normal).label}
        </span>
      )}
    </div>
  );

  if (err) {
    return (
      <div className="card qu-card" style={{ marginBottom: 20 }}>
        {head}
        <p className="tp-muted">Couldn't load usage. {err}</p>
      </div>
    );
  }
  if (!status) {
    return (
      <div className="card qu-card" style={{ marginBottom: 20 }}>
        {head}
        <p className="tp-muted">Loading…</p>
      </div>
    );
  }

  const cap = Number(status.cap) || 0;
  const usedPct = QU_pct(status.calls, cap);
  const projPct = QU_pct(status.projected, cap);
  const thrPct = Math.round(Number(status.throttle_pct) * 100);
  const stopPct = Math.round(Number(status.hard_stop_pct) * 100);
  const sources = Object.entries(status.by_source || {}).sort((a, b) => Number(b[1]) - Number(a[1]));
  const monthLabel = new Date(String(status.month) + "T12:00:00").toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="card qu-card" style={{ marginBottom: 20 }}>
      {head}
      <div className="qu-stats">
        <div className="qu-stat">
          <span className="qu-stat-n">{QU_fmt(status.calls)}</span>
          <span className="qu-stat-l">
            calls in {monthLabel} ({usedPct}% of {QU_fmt(cap)})
          </span>
        </div>
        <div className="qu-stat">
          <span className="qu-stat-n">{QU_fmt(status.projected)}</span>
          <span className="qu-stat-l">projected by month end ({projPct}%)</span>
        </div>
        <div className="qu-stat">
          <span className="qu-stat-n">{status.premium_interval_min} min</span>
          <span className="qu-stat-l">Pro clients sync every</span>
        </div>
      </div>
      <div className="qu-bar" role="img" aria-label={`${usedPct}% of the monthly limit used, on pace for ${projPct}%`}>
        <span className="qu-bar-proj" style={{ width: Math.min(projPct, 100) + "%" }} />
        <span className={"qu-bar-used " + (QU_MODE[status.mode] || QU_MODE.normal).cls} style={{ width: Math.min(usedPct, 100) + "%" }} />
        <span className="qu-bar-mark" style={{ left: Math.min(thrPct, 100) + "%" }} title={`Slow down at ${thrPct}% projected`} />
        <span className="qu-bar-mark stop" style={{ left: Math.min(stopPct, 100) + "%" }} title={`Stop at ${stopPct}% used`} />
      </div>
      <p className="tp-muted qu-note">
        {status.mode === "stopped"
          ? `Scheduled syncs are stopped until the 1st because ${stopPct}% of the limit is used. "Sync now" still works.`
          : status.mode === "throttled"
            ? `The month is on pace to pass ${thrPct}% of the limit, so Pro clients sync every ${status.throttled_interval_min} minutes instead of ${status.normal_interval_min}.`
            : `Pro clients slow to every ${status.throttled_interval_min} minutes if the month is on pace to pass ${thrPct}%, and scheduled syncs stop at ${stopPct}% used. Basic clients sync on the 15th.`}
      </p>
      {sources.length > 0 && (
        <ul className="qu-sources">
          {sources.map(([k, v]) => (
            <li key={k}>
              <span>{QU_SOURCE_LABEL[k] || k}</span>
              <span className="qu-num">{QU_fmt(v)}</span>
            </li>
          ))}
        </ul>
      )}
      {settings && !editing && (
        <button type="button" className="btn-secondary qu-edit-btn" onClick={startEdit}>
          Change limits
        </button>
      )}
      {editing && (
        <form className="qu-form" onSubmit={save}>
          <label className="ct-field">
            <span>Monthly limit (calls)</span>
            <input type="number" min={1000} value={draft.monthly_cap} onChange={(e) => setDraft({ ...draft, monthly_cap: e.target.value })} />
          </label>
          <label className="ct-field">
            <span>Slow down at (% projected)</span>
            <input type="number" min={1} max={100} value={draft.throttle_pct} onChange={(e) => setDraft({ ...draft, throttle_pct: e.target.value })} />
          </label>
          <label className="ct-field">
            <span>Stop at (% used)</span>
            <input type="number" min={1} max={100} value={draft.hard_stop_pct} onChange={(e) => setDraft({ ...draft, hard_stop_pct: e.target.value })} />
          </label>
          <label className="ct-field">
            <span>Pro sync every (min)</span>
            <input type="number" min={5} max={1440} value={draft.premium_interval_min} onChange={(e) => setDraft({ ...draft, premium_interval_min: e.target.value })} />
          </label>
          <label className="ct-field">
            <span>When slowed (min)</span>
            <input type="number" min={5} max={1440} value={draft.throttled_interval_min} onChange={(e) => setDraft({ ...draft, throttled_interval_min: e.target.value })} />
          </label>
          <div className="qu-form-foot">
            <button type="button" className="btn-secondary" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
