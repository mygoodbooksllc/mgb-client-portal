// ----------------------------------------------------------------------------
// Client profitability (owner request 2026-09-29). ADMIN-ONLY.
//
// Server side is supabase/client-profitability.sql:
//   client_fees             actual monthly fee per client (else tier default)
//   staff_cost_rates        loaded hourly cost per staff member, by effective date
//   profitability_settings  target margin % (default 40)
//   client_profitability()  revenue, cost, profit and margin per client
//
// This file holds the data hook plus the pieces the Team page and the client
// overview use: margin chip, summary strip, fee editor, rate editor, target
// editor and the per-client cost-by-staff card. Everything fails soft: until
// the migration is applied the tables/RPC don't exist and the UI says so
// instead of showing numbers.
//
// Loaded before app.jsx in the shared Babel scope (after TeamQbo.jsx): every
// top-level name has a TP_PF_ prefix, no React hook is redeclared, and app.jsx
// globals (fmtMoney, fmtDate, milestoneByTier...) are only used at render time.
// ----------------------------------------------------------------------------

const TP_PF_DEFAULT_TARGET = 40;
const TP_PF_AMBER_BAND = 15; // points below target that are amber, not red

const TP_PF_num = (v) => (v == null || v === "" ? null : Number(v));

// Tier fee from the confirmed pricing milestone (the fallback fee).
function TP_PF_tierFee(tier) {
  if (tier == null || typeof milestoneByTier !== "function") return null;
  const m = milestoneByTier(tier);
  return m && m.fee != null ? m.fee : null;
}

function TP_PF_errorKind(error, status) {
  if (typeof TP_qErrorKind === "function") return TP_qErrorKind(error, status);
  return error ? "other" : null;
}

async function TP_PF_safe(p) {
  try {
    const r = await p;
    return { data: r.data, error: r.error, status: r.status };
  } catch (e) {
    return { data: null, error: e, status: 0 };
  }
}

// Margin tone: good at/above target, warn within TP_PF_AMBER_BAND below, else bad.
function TP_PF_tone(margin, target) {
  if (margin == null) return null;
  const t = target == null ? TP_PF_DEFAULT_TARGET : target;
  if (margin >= t) return "good";
  if (margin >= t - TP_PF_AMBER_BAND) return "warn";
  return "bad";
}

function TP_PF_fmtPct(v) {
  if (v == null || !isFinite(v)) return "–";
  return `${Math.round(v * 10) / 10}%`;
}

function TP_PF_MarginChip({ margin, target }) {
  const tone = TP_PF_tone(margin, target);
  if (!tone) return <span className="tp-muted">–</span>;
  const label = { good: "at or above target", warn: "a little below target", bad: "well below target" }[tone];
  return (
    <span className={"task-chip pf-chip pf-" + tone} title={`Margin ${TP_PF_fmtPct(margin)}, ${label} (${TP_PF_fmtPct(target)})`}>
      {TP_PF_fmtPct(margin)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------
// enabled: load at all (admins only; never pass true for a bookkeeper).
// range: {from, to} YYYY-MM-DD. version: bump to refetch.
function TP_PF_useProfit(enabled, range, version) {
  const [state, setState] = useState({ loading: !!enabled, kind: null, error: null, rows: [], byId: {}, target: TP_PF_DEFAULT_TARGET, rates: [], fees: {}, tierFees: {} });
  const [bump, setBump] = useState(0);
  const reload = useCallback(() => setBump((n) => n + 1), []);
  useEffect(() => {
    const supabase = window.mgbSupabase;
    if (!enabled || !supabase) {
      setState((s) => ({ ...s, loading: false }));
      return undefined;
    }
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    (async () => {
      const m = await TP_PF_safe(supabase.from("client_milestones").select("client_id, confirmed_tier"));
      const tierFees = {};
      ((m && m.data) || []).forEach((r) => {
        const fee = TP_PF_tierFee(r.confirmed_tier);
        if (fee != null) tierFees[r.client_id] = fee;
      });
      const [p, s, rt, f] = await Promise.all([
        TP_PF_safe(supabase.rpc("client_profitability", { p_from: range.from, p_to: range.to, p_default_fees: tierFees })),
        TP_PF_safe(supabase.from("profitability_settings").select("target_margin_pct").limit(1)),
        TP_PF_safe(supabase.from("staff_cost_rates").select("staff_email, effective_from, hourly_cost").order("staff_email").order("effective_from", { ascending: false })),
        TP_PF_safe(supabase.from("client_fees").select("client_id, monthly_fee")),
      ]);
      if (!alive) return;
      const firstErr = [p, s, rt, f].find((r) => r.error);
      const kind = firstErr ? TP_PF_errorKind(firstErr.error, firstErr.status) : null;
      const rows = (p.data || []).map((r) => ({
        ...r,
        monthly_fee: TP_PF_num(r.monthly_fee),
        months: TP_PF_num(r.months),
        revenue: TP_PF_num(r.revenue),
        cost: TP_PF_num(r.cost),
        estimated_cost: TP_PF_num(r.estimated_cost),
        profit: TP_PF_num(r.profit),
        margin_pct: TP_PF_num(r.margin_pct),
        avg_rate: TP_PF_num(r.avg_rate),
        total_minutes: Number(r.total_minutes || 0),
        estimated_minutes: Number(r.estimated_minutes || 0),
        uncosted_minutes: Number(r.uncosted_minutes || 0),
        staff_costs: Array.isArray(r.staff_costs) ? r.staff_costs : [],
      }));
      const byId = {};
      rows.forEach((r) => {
        byId[r.client_id] = r;
      });
      const fees = {};
      (f.data || []).forEach((r) => {
        fees[r.client_id] = TP_PF_num(r.monthly_fee);
      });
      const settings = (s.data || [])[0];
      setState({
        loading: false,
        kind,
        error: firstErr ? firstErr.error : null,
        rows,
        byId,
        target: settings && settings.target_margin_pct != null ? Number(settings.target_margin_pct) : TP_PF_DEFAULT_TARGET,
        rates: (rt.data || []).map((r) => ({ ...r, hourly_cost: TP_PF_num(r.hourly_cost) })),
        fees,
        tierFees,
      });
    })();
    return () => {
      alive = false;
    };
  }, [enabled, range.from, range.to, version, bump]);
  return { ...state, ready: !state.loading && !state.kind, hasRates: state.rates.length > 0, reload };
}

// "2026-09-01" -> "Sep 1, 2026" (rate history needs the year).
function TP_PF_dateY(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ""));
  if (!m) return String(ymd || "");
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// Current rate per staff email (latest effective_from <= today).
function TP_PF_currentRate(rates, email, today) {
  const e = String(email || "").toLowerCase();
  const list = (rates || []).filter((r) => r.staff_email === e && (!today || r.effective_from <= today));
  list.sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1));
  return list[0] || null;
}

// Fee shown for a client: actual, else tier default.
function TP_PF_feeFor(profit, clientId) {
  const r = profit && profit.byId[clientId];
  if (r && r.monthly_fee != null) return { fee: r.monthly_fee, source: r.fee_source };
  if (profit && profit.fees[clientId] != null) return { fee: profit.fees[clientId], source: "actual" };
  if (profit && profit.tierFees[clientId] != null) return { fee: profit.tierFees[clientId], source: "tier_default" };
  return { fee: null, source: null };
}

// Why profit can't be shown, or null when it can.
function TP_PF_blocker(profit, qboOn) {
  if (!profit) return "Profit isn't available.";
  if (profit.loading) return null;
  if (profit.kind === "missing") return "Profitability isn't set up on the server yet.";
  if (profit.kind === "auth") return "Profit is only visible to admins.";
  if (profit.kind) return `Couldn't load profit. ${String((profit.error && profit.error.message) || "")}`.trim();
  if (!qboOn) return "Connect QuickBooks Time to see cost and profit. Fees are shown alone.";
  if (!profit.hasRates) return "Set staff rates to see profit. Open a person below to add their loaded hourly cost.";
  return null;
}

// Values a table row should show (null = show "–").
function TP_PF_rowView(profit, qboOn, clientId) {
  const fee = TP_PF_feeFor(profit, clientId);
  const r = profit && profit.byId[clientId];
  const show = !!(profit && profit.ready && qboOn && profit.hasRates && r);
  return {
    fee: fee.fee,
    feeSource: fee.source,
    revenue: r ? r.revenue : null,
    cost: show ? r.cost : null,
    profit: show ? r.profit : null,
    margin: show ? r.margin_pct : null,
    estimated: show && r.estimated_minutes > 0,
    row: r || null,
  };
}

// Sort key that puts a missing figure last in either direction.
function TP_PF_orLast(v, dir) {
  if (v == null || !isFinite(v)) return dir === "asc" ? Infinity : -Infinity;
  return v;
}

// Effective hourly rate: fee ÷ the client row's steady monthly hours
// (TP_qClientRows `basis`: 3-month average, or this period's pace).
function TP_PF_effRate(fee, row) {
  if (fee == null || !row || !(row.basis > 0)) return null;
  return fee / (row.basis / 60);
}

function TP_PF_FeeTag({ source }) {
  if (source === "tier_default") return <span className="pf-fee-tag" title="No actual fee set: using the pricing tier's fee">tier default</span>;
  return null;
}

// ---------------------------------------------------------------------------
// Summary strip (Team page, above the Clients table)
// ---------------------------------------------------------------------------
function TP_PF_SummaryStrip({ profit, qboOn, clientIds }) {
  const blocker = TP_PF_blocker(profit, qboOn);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  if (!profit || profit.loading) return <p className="pf-strip tp-muted">Loading profit…</p>;
  if (profit.kind) return <p className="pf-strip tp-muted">{blocker}</p>;
  const ids = clientIds ? new Set(clientIds) : null;
  const rows = profit.rows.filter((r) => !ids || ids.has(r.client_id));
  const canCost = qboOn && profit.hasRates;
  let revenue = 0;
  let cost = 0;
  let costedRevenue = 0;
  rows.forEach((r) => {
    if (r.revenue != null) revenue += r.revenue;
    if (canCost && r.cost != null) {
      cost += r.cost;
      if (r.revenue != null) costedRevenue += r.revenue;
    }
  });
  const profitTotal = canCost ? costedRevenue - cost : null;
  const blended = canCost && costedRevenue > 0 ? (profitTotal / costedRevenue) * 100 : null;
  const save = async () => {
    const v = Number(draft);
    if (!isFinite(v) || v < 0 || v > 100) {
      setErr("Enter a percentage from 0 to 100.");
      return;
    }
    setSaving(true);
    setErr(null);
    const res = await TP_PF_safe(window.mgbSupabase.from("profitability_settings").update({ target_margin_pct: v, updated_at: new Date().toISOString() }).eq("id", true));
    setSaving(false);
    if (res.error) {
      setErr(`Couldn't save: ${res.error.message || res.error}`);
      return;
    }
    setEditing(false);
    profit.reload();
  };
  return (
    <div className="pf-strip-wrap">
      <div className="pf-strip">
        <div className="pf-strip-item">
          <span className="tp-stat-label">Revenue</span>
          <span className="pf-strip-value">{fmtMoney(Math.round(revenue))}</span>
        </div>
        <div className="pf-strip-item">
          <span className="tp-stat-label">Cost</span>
          <span className="pf-strip-value">{canCost ? fmtMoney(Math.round(cost)) : "–"}</span>
        </div>
        <div className="pf-strip-item">
          <span className="tp-stat-label">Profit</span>
          <span className={"pf-strip-value" + (profitTotal != null && profitTotal < 0 ? " tp-bad" : "")}>
            {profitTotal != null ? fmtMoney(Math.round(profitTotal)) : "–"}
          </span>
        </div>
        <div className="pf-strip-item">
          <span className="tp-stat-label">Blended margin</span>
          <span className="pf-strip-value">
            {blended != null ? <TP_PF_MarginChip margin={blended} target={profit.target} /> : "–"}
          </span>
        </div>
        <div className="pf-strip-item">
          <span className="tp-stat-label">Target margin</span>
          {editing ? (
            <span className="pf-inline-form">
              <input
                type="number"
                min="0"
                max="100"
                step="1"
                value={draft}
                aria-label="Target margin percent"
                onChange={(e) => setDraft(e.target.value)}
              />
              <button type="button" className="btn-primary pf-btn" onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </button>
              <button type="button" className="btn-secondary pf-btn" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </span>
          ) : (
            <span className="pf-strip-value">
              {TP_PF_fmtPct(profit.target)}{" "}
              <button
                type="button"
                className="tp-q-link"
                onClick={() => {
                  setDraft(String(profit.target));
                  setEditing(true);
                }}
              >
                Edit
              </button>
            </span>
          )}
        </div>
      </div>
      {err && <p className="tp-bad" style={{ margin: "6px 0 0" }}>{err}</p>}
      {blocker && <p className="tp-muted pf-strip-note">{blocker}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Client drill-down: fee editor + cost by staff member
// ---------------------------------------------------------------------------
function TP_PF_ClientProfitCard({ clientId, profit, qboOn }) {
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  if (!profit) return null;
  const blocker = TP_PF_blocker(profit, qboOn);
  const v = TP_PF_rowView(profit, qboOn, clientId);
  const r = v.row;
  const tierFee = profit.tierFees[clientId];
  const hasActual = v.feeSource === "actual";
  const sb = window.mgbSupabase;
  const saveFee = async () => {
    const n = Number(draft);
    if (draft === "" || !isFinite(n) || n < 0) {
      setErr("Enter a monthly fee of 0 or more.");
      return;
    }
    setSaving(true);
    setErr(null);
    const res = await TP_PF_safe(sb.from("client_fees").upsert({ client_id: clientId, monthly_fee: n, updated_at: new Date().toISOString() }, { onConflict: "client_id" }));
    setSaving(false);
    if (res.error) {
      setErr(`Couldn't save: ${res.error.message || res.error}`);
      return;
    }
    setDraft("");
    profit.reload();
  };
  const clearFee = async () => {
    setSaving(true);
    setErr(null);
    const res = await TP_PF_safe(sb.from("client_fees").delete().eq("client_id", clientId));
    setSaving(false);
    if (res.error) {
      setErr(`Couldn't reset: ${res.error.message || res.error}`);
      return;
    }
    profit.reload();
  };
  const staffCosts = (r && r.staff_costs) || [];
  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <h3 className="card-title">Profitability</h3>
      <p className="card-subtitle">
        Revenue is the monthly fee × months in the period (partial months by days). Cost is QuickBooks Time hours × each
        person's loaded hourly cost on the day. Admins only.
      </p>
      {profit.loading ? (
        <p className="tp-muted">Loading…</p>
      ) : profit.kind ? (
        <p className="tp-muted">{blocker}</p>
      ) : (
        <>
          <div className="tp-stats">
            <TP_Stat label="Monthly fee" value={v.fee != null ? <>{fmtMoney(v.fee)} <TP_PF_FeeTag source={v.feeSource} /></> : "Not set"} />
            <TP_Stat label="Revenue (period)" value={v.revenue != null ? fmtMoney(Math.round(v.revenue)) : "–"} />
            <TP_Stat label={v.estimated ? "Cost (part estimated)" : "Cost"} value={v.cost != null ? fmtMoney(Math.round(v.cost)) : "–"} />
            <TP_Stat label="Profit" value={v.profit != null ? fmtMoney(Math.round(v.profit)) : "–"} bad={v.profit != null && v.profit < 0} />
            <TP_Stat label="Margin" value={<TP_PF_MarginChip margin={v.margin} target={profit.target} />} />
          </div>
          {blocker && <p className="tp-muted" style={{ marginTop: 12 }}>{blocker}</p>}
          <div className="pf-fee-form">
            <label>
              <span>{hasActual ? "Change actual monthly fee" : "Set actual monthly fee"}</span>
              <input
                type="number"
                min="0"
                step="1"
                inputMode="decimal"
                placeholder={v.fee != null ? String(v.fee) : "e.g. 450"}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
            </label>
            <button type="button" className="btn-primary pf-btn" onClick={saveFee} disabled={saving}>
              {saving ? "Saving…" : "Save fee"}
            </button>
            {hasActual && (
              <button type="button" className="btn-secondary pf-btn" onClick={clearFee} disabled={saving}>
                {tierFee != null ? `Use tier default (${fmtMoney(tierFee)})` : "Clear actual fee"}
              </button>
            )}
          </div>
          {err && <p className="tp-bad" style={{ marginTop: 8 }}>{err}</p>}
          {qboOn && profit.hasRates && (
            <>
              <h4 className="pf-subhead">Cost by staff member</h4>
              {staffCosts.length === 0 ? (
                <p className="tp-muted">No QuickBooks Time hours on this client in this period.</p>
              ) : (
                <div className="table-scroll">
                  <table className="tx-table tx-table-labeled tp-table">
                    <thead>
                      <tr>
                        <th>Person</th>
                        <th className="num">Hours</th>
                        <th className="num">Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {staffCosts.map((s, i) => (
                        <tr key={(s.staff_email || s.staff_name || "") + i}>
                          <td data-primary="">
                            <span className="tp-name">{s.staff_name || s.staff_email || "No person"}</span>
                            {s.estimated && (
                              <span className="pf-fee-tag" title={s.staff_email ? "No rate in effect on some entries: costed at the average rate" : "Not mapped to a staff member: costed at the average rate"}>
                                estimated
                              </span>
                            )}
                          </td>
                          <td className="num" data-label="Hours">{TP_fmtHM(Number(s.minutes || 0))}</td>
                          <td className="num" data-label="Cost">{s.cost != null ? fmtMoney(Math.round(Number(s.cost))) : "–"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {r && r.uncosted_minutes > 0 && (
                <p className="tp-muted" style={{ marginTop: 8 }}>{TP_fmtHM(r.uncosted_minutes)} couldn't be costed (no rates).</p>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Person drill-down: loaded hourly cost with history
// ---------------------------------------------------------------------------
function TP_PF_RateCard({ email, name, profit, today }) {
  const [amount, setAmount] = useState("");
  const [from, setFrom] = useState(today);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  if (!profit) return null;
  const e = String(email || "").toLowerCase();
  const history = (profit.rates || []).filter((r) => r.staff_email === e);
  const current = TP_PF_currentRate(profit.rates, e, today);
  const sb = window.mgbSupabase;
  const save = async () => {
    const n = Number(amount);
    if (amount === "" || !isFinite(n) || n < 0) {
      setErr("Enter an hourly cost of 0 or more.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from || "")) {
      setErr("Pick the date the rate takes effect.");
      return;
    }
    setSaving(true);
    setErr(null);
    const res = await TP_PF_safe(
      sb.from("staff_cost_rates").upsert({ staff_email: e, effective_from: from, hourly_cost: n, updated_at: new Date().toISOString() }, { onConflict: "staff_email,effective_from" }),
    );
    setSaving(false);
    if (res.error) {
      setErr(`Couldn't save: ${res.error.message || res.error}`);
      return;
    }
    setAmount("");
    profit.reload();
  };
  const remove = async (r) => {
    setSaving(true);
    setErr(null);
    const res = await TP_PF_safe(sb.from("staff_cost_rates").delete().eq("staff_email", e).eq("effective_from", r.effective_from));
    setSaving(false);
    if (res.error) setErr(`Couldn't delete: ${res.error.message || res.error}`);
    else profit.reload();
  };
  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <h3 className="card-title">Loaded hourly cost</h3>
      <p className="card-subtitle">
        What an hour of {name || "this person"} costs the firm (pay plus taxes and overhead). Used to cost QuickBooks Time
        hours. A new rate starts on its date; earlier hours keep the old rate. Admins only.
      </p>
      {profit.loading ? (
        <p className="tp-muted">Loading…</p>
      ) : profit.kind ? (
        <p className="tp-muted">{TP_PF_blocker(profit, true)}</p>
      ) : (
        <>
          <p style={{ margin: "0 0 10px" }}>
            Current: <b>{current ? `${fmtMoney(current.hourly_cost)}/h` : "not set"}</b>
            {current ? <span className="tp-muted"> since {TP_PF_dateY(current.effective_from)}</span> : null}
          </p>
          <div className="pf-fee-form">
            <label>
              <span>Hourly cost</span>
              <input type="number" min="0" step="0.5" inputMode="decimal" placeholder="e.g. 38" value={amount} onChange={(ev) => setAmount(ev.target.value)} />
            </label>
            <label>
              <span>Effective from</span>
              <input type="date" value={from} onChange={(ev) => setFrom(ev.target.value)} />
            </label>
            <button type="button" className="btn-primary pf-btn" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save rate"}
            </button>
          </div>
          {err && <p className="tp-bad" style={{ marginTop: 8 }}>{err}</p>}
          {history.length > 0 && (
            <ul className="pf-rate-history">
              {history.map((r) => (
                <li key={r.effective_from}>
                  <span>{TP_PF_dateY(r.effective_from)}</span>
                  <span>{fmtMoney(r.hourly_cost)}/h</span>
                  <button type="button" className="tp-q-link" onClick={() => remove(r)} disabled={saving}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

// CSV columns for the Clients export.
const TP_PF_CSV_HEAD = ["Monthly fee", "Fee source", "Revenue (period)", "Cost", "Estimated part of cost", "Profit", "Margin %", "Target margin %", "Cost by staffer"];
function TP_PF_csvCells(profit, qboOn, clientId) {
  if (!profit || !profit.ready) return TP_PF_CSV_HEAD.map(() => "");
  const v = TP_PF_rowView(profit, qboOn, clientId);
  const r = v.row;
  const staff =
    v.cost != null && r
      ? r.staff_costs
          .map((s) => `${s.staff_name || s.staff_email || "No person"}: ${Math.round(Number(s.cost || 0))}${s.estimated ? " (est.)" : ""}`)
          .join("; ")
      : "";
  return [
    v.fee != null ? v.fee : "",
    v.feeSource === "tier_default" ? "tier default" : v.feeSource === "actual" ? "actual" : "",
    v.revenue != null ? v.revenue : "",
    v.cost != null ? v.cost : "",
    v.cost != null && r ? r.estimated_cost : "",
    v.profit != null ? v.profit : "",
    v.margin != null ? v.margin : "",
    profit.target,
    staff,
  ];
}

// ---------------------------------------------------------------------------
// Client overview "Profitability" card lines (app.jsx, admins only)
// ---------------------------------------------------------------------------
// Month to date: revenue is the fee prorated to today, cost is QuickBooks Time
// hours so far, so the margin is like-for-like.
function TP_PF_OverviewLines({ clientId, qboOn, from, to }) {
  const range = useMemo(() => ({ from, to }), [from, to]);
  const profit = TP_PF_useProfit(true, range, 0);
  if (profit.loading) {
    return (
      <li className="muted">
        <span>Profit</span>
        <span>Loading…</span>
      </li>
    );
  }
  if (profit.kind) {
    return (
      <li className="muted">
        <span>Profit</span>
        <span>{profit.kind === "missing" ? "Not set up" : "Unavailable"}</span>
      </li>
    );
  }
  const v = TP_PF_rowView(profit, qboOn, clientId);
  const blocker = !qboOn ? "QuickBooks Time not connected" : !profit.hasRates ? "Set staff rates to see profit" : null;
  return (
    <>
      <li>
        <span>
          Monthly fee <TP_PF_FeeTag source={v.feeSource} />
        </span>
        <span>{v.fee != null ? fmtMoney(v.fee) : "Not set"}</span>
      </li>
      {blocker ? (
        <li className="muted">
          <span>Profit</span>
          <span>{blocker}</span>
        </li>
      ) : (
        <>
          <li>
            <span>{v.estimated ? "Cost to date (part est.)" : "Cost to date"}</span>
            <span>{v.cost != null ? fmtMoney(Math.round(v.cost)) : "–"}</span>
          </li>
          <li>
            <span>Profit to date</span>
            <span className={v.profit != null && v.profit < 0 ? "tp-bad" : ""}>
              {v.profit != null ? fmtMoney(Math.round(v.profit)) : "–"}
            </span>
          </li>
          <li>
            <span>Margin (target {TP_PF_fmtPct(profit.target)})</span>
            <span>
              <TP_PF_MarginChip margin={v.margin} target={profit.target} />
            </span>
          </li>
        </>
      )}
    </>
  );
}
