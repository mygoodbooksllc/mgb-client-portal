// Monthly hours budget per client (owner request 2026-10-07). Admin only.
//
// client_profile.monthly_hours_budget (supabase/client-hours-budget.sql) is
// the plan; QuickBooks Time hours this calendar month (qbo_hours_by_client,
// admin-only RPC, read only) are the actual. Shown in the Team page Clients
// table (TeamQbo.jsx), the client overview Profitability card (app.jsx) and
// the Home custom-card rule "Hours budget" (HomeCards.jsx).
//
// Rules live in staffOpsLogic.js (OPS_budgetStatus): near from 80%, over
// from 100%. No budget or unknown hours never flags.

const HB_store = { key: null, data: null, promise: null };

function HB_monthStart() {
  return todayLocal().slice(0, 8) + "01";
}

function HB_load(force) {
  const sb = window.mgbSupabase;
  if (!sb) return Promise.resolve(null);
  const from = HB_monthStart();
  const to = todayLocal();
  const key = from + "|" + to;
  if (!force && HB_store.key === key && (HB_store.data || HB_store.promise)) {
    return HB_store.data ? Promise.resolve(HB_store.data) : HB_store.promise;
  }
  HB_store.key = key;
  HB_store.promise = Promise.all([
    sb.from("client_profile").select("client_id, monthly_hours_budget"),
    sb.rpc("qbo_hours_by_client", { p_from: from, p_to: to }),
  ]).then(([prof, hrs]) => {
    const budgets = {};
    ((prof && prof.data) || []).forEach((r) => {
      if (r.monthly_hours_budget != null) budgets[r.client_id] = Number(r.monthly_hours_budget);
    });
    const qboOn = !!(hrs && !hrs.error && Array.isArray(hrs.data));
    const minutes = {};
    if (qboOn)
      hrs.data.forEach((r) => {
        if (r.bucket === "client" && r.client_id) minutes[r.client_id] = (minutes[r.client_id] || 0) + Number(r.total_minutes || 0);
      });
    const byClient = {};
    Object.keys(budgets).forEach((id) => {
      // QuickBooks Time not connected: hours unknown, so no status.
      byClient[id] = qboOn ? OPS_budgetStatus(minutes[id] || 0, budgets[id]) : null;
    });
    const data = { budgets, minutes, byClient, qboOn, missing: !!(prof && prof.error) };
    HB_store.data = data;
    HB_store.promise = null;
    return data;
  });
  return HB_store.promise;
}

// { loading, budgets, minutes, byClient: {clientId: status|null}, qboOn }.
// enabled=false (non-admins) returns null and never queries.
function HB_useBudgets(enabled) {
  const [data, setData] = useState(() => (enabled && HB_store.key === HB_monthStart() + "|" + todayLocal() ? HB_store.data : null));
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const run = (force) =>
      HB_load(force).then(
        (d) => alive && setData(d),
        () => alive && setData({ budgets: {}, minutes: {}, byClient: {}, qboOn: false, failed: true }),
      );
    run(false);
    const onChange = () => run(true);
    window.addEventListener(STAFF_TOOLS_EVENT, onChange);
    return () => {
      alive = false;
      window.removeEventListener(STAFF_TOOLS_EVENT, onChange);
    };
  }, [enabled]);
  return enabled ? data : null;
}

function HB_fmtH(h) {
  const n = Math.round(Number(h || 0) * 10) / 10;
  return (n % 1 === 0 ? String(n) : n.toFixed(1)) + " h";
}

// Used-vs-budget bar. status from OPS_budgetStatus.
function HB_Bar({ status, compact }) {
  if (!status) return null;
  const w = Math.min(100, status.pct);
  const label = `${HB_fmtH(status.used)} of ${HB_fmtH(status.budget)} · ${status.pct}%`;
  return (
    <span className={"hb-bar hb-" + status.state + (compact ? " hb-compact" : "")} title={label + (status.state === "over" ? " (over budget)" : status.state === "near" ? " (80% or more)" : "")}>
      <span className="hb-track" aria-hidden="true">
        <span style={{ width: w + "%" }} />
      </span>
      <span className="hb-text">
        {compact ? `${status.pct}%` : label}
        {status.state === "over" && <span className="hb-tag">Over</span>}
      </span>
    </span>
  );
}

// Cell for the Team page Clients table.
function HB_Cell({ data, clientId }) {
  if (!data) return <span className="tp-muted">…</span>;
  const budget = data.budgets[clientId];
  if (budget == null) return <span className="tp-muted">–</span>;
  const st = data.byClient[clientId];
  if (!st) return <span className="tp-muted" title="QuickBooks Time isn't connected, so hours used are unknown">{HB_fmtH(budget)}</span>;
  return <HB_Bar status={st} compact />;
}

// Line for the client overview Profitability card (admins only).
// minutes: QuickBooks Time minutes this month (null when unknown).
function HB_OverviewLine({ minutes, budget }) {
  const has = budget != null && Number(budget) > 0;
  const st = has ? OPS_budgetStatus(minutes, budget) : null;
  return (
    <li className={"hb-ov-line" + (st ? " hb-" + st.state : "")}>
      <span>Hours budget</span>
      <span className="hb-ov-val">
        {!has ? <span className="muted">Not set</span> : st ? `${HB_fmtH(st.used)} of ${HB_fmtH(st.budget)}` : `${HB_fmtH(budget)} / month`}
      </span>
      {st && (
        <span className="hb-ov-bar" title={st.state === "over" ? "Over budget" : st.state === "near" ? "80% or more of the budget" : ""}>
          <span className="hb-track" aria-hidden="true">
            <span style={{ width: Math.min(100, st.pct) + "%" }} />
          </span>
          <span className="hb-text">
            {st.pct}%{st.state === "over" && <span className="hb-tag">Over</span>}
          </span>
        </span>
      )}
    </li>
  );
}
