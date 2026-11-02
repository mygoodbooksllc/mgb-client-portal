// Monthly hours budget per client (owner request 2026-10-07).
//
// client_profile.monthly_hours_budget (supabase/client-hours-budget.sql) is
// the plan; QuickBooks Time hours this calendar month are the actual. Admins
// read the hours through qbo_hours_by_client (every client, plus the firm's
// non-client buckets); everyone else through qbo_my_client_hours
// (supabase/client-hours-for-bookkeepers.sql), which only returns the
// caller's own clients. Both are read only. Shown in the Team page Clients
// table (TeamQbo.jsx), the client overview Hourly rate card (app.jsx), the
// Home custom-card rule "Hours budget" (HomeCards.jsx) and the Clients list
// (ClientsPage.jsx, staff navigation redesign 2026-10-08).
//
// Rules live in staffOpsLogic.js (OPS_budgetStatus): near from 80%, over
// from 100%. No budget or unknown hours never flags.

const HB_HISTORY_MONTHS = 6;
const HB_store = { key: null, data: null, promise: null };

function HB_monthStart() {
  return todayLocal().slice(0, 8) + "01";
}

// One cache per month and per RPC, so an admin switching to "View as" a
// bookkeeper refetches through the bookkeeper's RPC instead of reusing the
// admin rows.
function HB_key(admin) {
  return HB_monthStart() + "|" + todayLocal() + "|" + (admin ? "all" : "mine");
}

function HB_load(force, admin) {
  const sb = window.mgbSupabase;
  if (!sb) return Promise.resolve(null);
  const from = HB_monthStart();
  const to = todayLocal();
  const key = HB_key(admin);
  if (!force && HB_store.key === key && (HB_store.data || HB_store.promise)) {
    return HB_store.data ? Promise.resolve(HB_store.data) : HB_store.promise;
  }
  HB_store.key = key;
  HB_store.data = null;
  HB_store.promise = Promise.all([
    sb.from("client_profile").select("client_id, monthly_hours_budget"),
    admin
      ? sb.rpc("qbo_hours_by_client", { p_from: from, p_to: to })
      : sb.rpc("qbo_my_client_hours", { p_from: from, p_to: to }),
    // The last 6 complete months (supabase/client-hours-monthly-history.sql).
    // Asks for one extra: the server clock is UTC, so on the last evening of a
    // month it is already next month there; the helpers trim to the right 6.
    // One RPC for everyone (can_access_client is true for admins). A failure
    // here only hides the averages; budgets and this month still work.
    sb.rpc("qbo_my_client_hours_monthly", { p_months: HB_HISTORY_MONTHS + 1 }),
  ]).then(([prof, hrs, hist]) => {
    const budgets = {};
    ((prof && prof.data) || []).forEach((r) => {
      if (r.monthly_hours_budget != null) budgets[r.client_id] = Number(r.monthly_hours_budget);
    });
    const qboOn = !!(hrs && !hrs.error && Array.isArray(hrs.data));
    const minutes = {};
    if (qboOn)
      hrs.data.forEach((r) => {
        // The admin RPC also returns the firm's other buckets (unassigned,
        // internal); only client rows count. The bookkeeper RPC is clients only.
        if (r.client_id && (!admin || r.bucket === "client"))
          minutes[r.client_id] = (minutes[r.client_id] || 0) + Number(r.total_minutes || 0);
      });
    const byClient = {};
    Object.keys(budgets).forEach((id) => {
      // QuickBooks Time not connected: hours unknown, so no status.
      byClient[id] = qboOn ? OPS_budgetStatus(minutes[id] || 0, budgets[id]) : null;
    });
    // history: { months: ["YYYY-MM-01", ...oldest first], byClient: { id: { monthly: minutes[], avg: hours|null } } }
    // avg is null for a client with no history at all; the current month is never in it.
    const histOn = !!(hist && !hist.error && Array.isArray(hist.data));
    const history = OPS_monthlyHistory(histOn ? hist.data : [], todayLocal(), HB_HISTORY_MONTHS);
    const avg = {};
    const monthly = {};
    Object.keys(history.byClient).forEach((id) => {
      avg[id] = history.byClient[id].avg;
      monthly[id] = history.byClient[id].monthly;
    });
    const data = { budgets, minutes, byClient, qboOn, missing: !!(prof && prof.error), history, histOn, avg, monthly };
    HB_store.data = data;
    HB_store.promise = null;
    return data;
  });
  return HB_store.promise;
}

// { loading, budgets, minutes (this month), byClient: {clientId: status|null}, qboOn,
//   history, histOn, avg: {clientId: hours|null}, monthly: {clientId: minutes[6]} }.
// avg/monthly cover the last 6 complete months; a client with no history has no entry (avg null).
// enabled=false returns null and never queries. isAdmin picks the RPC; left
// out, it follows the signed-in (or viewed-as) staffer from StaffToolsContext,
// and admin when there is none, which is what the existing admin-only callers
// (Home watchlist, Team Hours) expect.
function HB_useBudgets(enabled, isAdmin) {
  const ctx = typeof StaffToolsContext !== "undefined" ? React.useContext(StaffToolsContext) : null;
  const admin =
    isAdmin !== undefined ? !!isAdmin : ctx && ctx.staffUser ? ctx.staffUser.role === "admin" : true;
  const [data, setData] = useState(() => (enabled && HB_store.key === HB_key(admin) ? HB_store.data : null));
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const run = (force) =>
      HB_load(force, admin).then(
        (d) => alive && setData(d),
        () => alive && setData({ budgets: {}, minutes: {}, byClient: {}, qboOn: false, failed: true, history: { months: [], byClient: {} }, histOn: false, avg: {}, monthly: {} }),
      );
    run(false);
    const onChange = () => run(true);
    window.addEventListener(STAFF_TOOLS_EVENT, onChange);
    return () => {
      alive = false;
      window.removeEventListener(STAFF_TOOLS_EVENT, onChange);
    };
  }, [enabled, admin]);
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

// Small bar sparkline of the last 6 complete months plus the current month
// (accent color). monthly: 6 numbers, oldest first; curMinutes: this month.
function HB_Spark({ monthly, curMinutes, budget }) {
  const list = (monthly || []).concat(curMinutes == null ? [] : [curMinutes]);
  const max = Math.max(1, ...list, budget > 0 ? budget * 60 : 0);
  return (
    <span className="hb-spark" aria-hidden="true">
      {list.map((m, i) => (
        <i key={i} className={i === list.length - 1 && curMinutes != null ? "hb-spark-cur" : ""} style={{ height: Math.max(2, Math.round((m / max) * 100)) + "%" }} />
      ))}
    </span>
  );
}

// Per-month bar chart with a dashed budget line and one summary line.
// months: ["YYYY-MM-01"...]; used in the Clients list detail row.
function HB_MonthChart({ months, monthly, curMinutes, budget, summary }) {
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const label = (k) => names[Number(k.slice(5, 7)) - 1];
  const bars = (months || []).map((k, i) => ({ k, label: label(k), m: (monthly && monthly[i]) || 0, cur: false }));
  if (curMinutes != null) {
    const t = todayLocal();
    bars.push({ k: t, label: label(t) + " so far", m: curMinutes, cur: true });
  }
  const b = budget > 0 ? Number(budget) : 0;
  const max = Math.max(1, b * 60, ...bars.map((x) => x.m));
  return (
    <div className="hb-chart">
      <div className="hb-chart-plot" role="img" aria-label={summary}>
        {b > 0 && <span className="hb-chart-line" style={{ bottom: "calc(18px + (100% - 36px) * " + (b * 60) / max + ")" }} title={"Budget " + HB_fmtH(b)} />}
        {bars.map((x) => (
          <span className="hb-chart-col" key={x.k} title={x.label + ": " + HB_fmtH(x.m / 60)}>
            <span className="hb-chart-val">{HB_fmtH(x.m / 60)}</span>
            <i className={x.cur ? "hb-spark-cur" : ""} style={{ height: Math.max(2, Math.round((x.m / max) * 100)) + "%" }} />
            <span className="hb-chart-lab">{x.label}</span>
          </span>
        ))}
      </div>
      <p className="hb-chart-sum">{summary}</p>
    </div>
  );
}

// Line for the client overview Hourly rate card: 6-month average.
function HB_OverviewAvgLine({ clientId }) {
  const data = HB_useBudgets(true, true);
  if (!data || !data.histOn) return null;
  const a = data.avg[clientId];
  return (
    <li className="hb-ov-line" title="Average hours per month over the last 6 complete months (this month is not counted)">
      <span>6-month average</span>
      <span className="hb-ov-val">{a == null ? <span className="muted">No history</span> : HB_fmtH(a) + " / month"}</span>
    </li>
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

// Line for the client overview Hourly rate card (admins only).
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
