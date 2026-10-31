// ----------------------------------------------------------------------------
// Client profitability (owner request 2026-09-29). INTERNAL-ONLY since
// 2026-10-31: an admin who also holds the owner's MGB (internal) grant
// (staffUser.canViewInternal, server can_view_internal()). Everyone else gets
// nothing rendered at all, not an error: call TP_PF_canSee(staffUser) before
// mounting any piece here (supabase/profitability-internal-only.sql).
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

// The one gate for every fee / rate / cost / margin surface in the app.
// View as: callers pass the effective (impersonated) user, which never carries
// canViewInternal, so previews stay clean too.
function TP_PF_canSee(user) {
  return !!user && user.role === "admin" && user.canViewInternal === true;
}

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
        TP_PF_safe(supabase.from("client_fees").select("client_id, monthly_fee, needs_review, review_note, source, sheet_override, synced_at")),
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
      const feeReview = {};
      // Master Data sync (supabase/master-sheet-sync.sql): "synced" = the fee
      // comes from the sheet and is read-only here; "override" = an admin
      // stopped the sync for this client.
      const feeSheet = {};
      (f.data || []).forEach((r) => {
        fees[r.client_id] = TP_PF_num(r.monthly_fee);
        if (r.needs_review) feeReview[r.client_id] = r.review_note || "Double check this price";
        if (r.sheet_override) feeSheet[r.client_id] = { kind: "override", syncedAt: r.synced_at };
        else if (r.source === "master_sheet") feeSheet[r.client_id] = { kind: "synced", syncedAt: r.synced_at };
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
        feeReview,
        feeSheet,
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
  if (profit.kind === "auth") return null; // no grant: render nothing, say nothing
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
    feeReview: (profit && profit.feeReview && profit.feeReview[clientId]) || null,
    feeSheet: (fee.source === "actual" && profit && profit.feeSheet && profit.feeSheet[clientId]) || null,
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

function TP_PF_FeeTag({ source, review, sheet }) {
  return (
    <>
      {source === "tier_default" && <span className="pf-fee-tag" title="No actual fee set: using the pricing tier's fee">tier default</span>}
      {sheet && sheet.kind === "synced" && (
        <span className="pf-fee-tag pf-fee-sheet" title="Synced from the MGB_Master_Data Google Sheet">
          Master Data
        </span>
      )}
      {sheet && sheet.kind === "override" && (
        <span className="pf-fee-tag pf-fee-check" title="An admin overrode this fee: the Master Data sync leaves it alone">
          override
        </span>
      )}
      {review && (
        <span className="pf-fee-tag pf-fee-check" title={review}>
          check price
        </span>
      )}
    </>
  );
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
  if (!profit || profit.kind === "auth") return null;
  if (profit.loading) return <p className="pf-strip tp-muted">Loading profit…</p>;
  if (profit.kind) return <p className="pf-strip tp-muted">{blocker}</p>;
  const ids = clientIds ? new Set(clientIds) : null;
  // Test clients and MGB (internal) never count toward firm revenue, cost or profit.
  const excl = typeof CF_excludedIds === "function" ? CF_excludedIds() : new Set();
  const rows = profit.rows.filter((r) => (!ids || ids.has(r.client_id)) && !excl.has(r.client_id));
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
  const [overriding, setOverriding] = useState(false);
  useEffect(() => {
    setOverriding(false);
    setDraft("");
  }, [clientId]);
  if (!profit || profit.kind === "auth") return null;
  const blocker = TP_PF_blocker(profit, qboOn);
  const v = TP_PF_rowView(profit, qboOn, clientId);
  const r = v.row;
  const tierFee = profit.tierFees[clientId];
  const hasActual = v.feeSource === "actual";
  // Master Data sync: a synced fee is read-only unless an admin overrides it.
  const synced = !!(v.feeSheet && v.feeSheet.kind === "synced");
  const overridden = !!(v.feeSheet && v.feeSheet.kind === "override");
  const showForm = !synced || overriding;
  const sb = window.mgbSupabase;
  const saveFee = async () => {
    const n = Number(draft);
    if (draft === "" || !isFinite(n) || n < 0) {
      setErr("Enter a monthly fee of 0 or more.");
      return;
    }
    setSaving(true);
    setErr(null);
    const row = { client_id: clientId, monthly_fee: n, needs_review: false, review_note: null, updated_at: new Date().toISOString() };
    // Overriding a synced fee: the sync leaves this client alone until "Resume sync".
    if (synced || overridden) row.sheet_override = true;
    const res = await TP_PF_safe(sb.from("client_fees").upsert(row, { onConflict: "client_id" }));
    setSaving(false);
    if (res.error) {
      setErr(`Couldn't save: ${res.error.message || res.error}`);
      return;
    }
    setDraft("");
    setOverriding(false);
    profit.reload();
  };
  const resumeSync = async () => {
    setSaving(true);
    setErr(null);
    const res = await TP_PF_safe(sb.from("client_fees").update({ sheet_override: false }).eq("client_id", clientId));
    setSaving(false);
    if (res.error) {
      setErr(`Couldn't resume: ${res.error.message || res.error}`);
      return;
    }
    profit.reload();
  };
  const markChecked = async () => {
    setSaving(true);
    setErr(null);
    const res = await TP_PF_safe(sb.from("client_fees").update({ needs_review: false, review_note: null }).eq("client_id", clientId));
    setSaving(false);
    if (res.error) {
      setErr(`Couldn't save: ${res.error.message || res.error}`);
      return;
    }
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
            <TP_Stat label="Monthly fee" value={v.fee != null ? <>{fmtMoney(v.fee)} <TP_PF_FeeTag source={v.feeSource} review={v.feeReview} sheet={v.feeSheet} /></> : "Not set"} />
            <TP_Stat label="Revenue (period)" value={v.revenue != null ? fmtMoney(Math.round(v.revenue)) : "–"} />
            <TP_Stat label={v.estimated ? "Cost (part estimated)" : "Cost"} value={v.cost != null ? fmtMoney(Math.round(v.cost)) : "–"} />
            <TP_Stat label="Profit" value={v.profit != null ? fmtMoney(Math.round(v.profit)) : "–"} bad={v.profit != null && v.profit < 0} />
            <TP_Stat label="Margin" value={<TP_PF_MarginChip margin={v.margin} target={profit.target} />} />
          </div>
          {blocker && <p className="tp-muted" style={{ marginTop: 12 }}>{blocker}</p>}
          {synced && (
            <p className="pf-sheet-note">
              <b>Synced from Master Data.</b> This fee comes from the MGB_Master_Data sheet
              {v.feeSheet.syncedAt ? ` (last synced ${TP_PF_when(v.feeSheet.syncedAt)})` : ""}. Change it in the sheet.
              {!overriding && (
                <>
                  {" "}
                  <button type="button" className="tp-q-link" onClick={() => setOverriding(true)}>
                    Override (stops Master Data sync for this client)
                  </button>
                </>
              )}
            </p>
          )}
          {overridden && (
            <p className="pf-sheet-note">
              <b>Override on.</b> The Master Data sync leaves this fee alone.{" "}
              <button type="button" className="tp-q-link" onClick={resumeSync} disabled={saving}>
                Resume sync
              </button>{" "}
              <span className="tp-muted">(the next sync sets it back to the sheet's fee)</span>
            </p>
          )}
          {showForm && (
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
              {saving ? "Saving…" : synced ? "Save override" : "Save fee"}
            </button>
            {synced && overriding && (
              <button type="button" className="btn-secondary pf-btn" onClick={() => setOverriding(false)} disabled={saving}>
                Cancel
              </button>
            )}
            {v.feeReview && (
              <button type="button" className="btn-secondary pf-btn" onClick={markChecked} disabled={saving} title={v.feeReview}>
                Price checked
              </button>
            )}
            {hasActual && !synced && !overridden && (
              <button type="button" className="btn-secondary pf-btn" onClick={clearFee} disabled={saving}>
                {tierFee != null ? `Use tier default (${fmtMoney(tierFee)})` : "Clear actual fee"}
              </button>
            )}
          </div>
          )}
          {!showForm && v.feeReview && (
            <div className="pf-fee-form">
              <button type="button" className="btn-secondary pf-btn" onClick={markChecked} disabled={saving} title={v.feeReview}>
                Price checked
              </button>
            </div>
          )}
          {err && <p className="tp-bad" style={{ marginTop: 8 }}>{err}</p>}
          {qboOn && profit.hasRates && (
            <>
              <h4 className="pf-subhead">Cost by staff member</h4>
              {staffCosts.length === 0 ? (
                <p className="tp-muted">No QuickBooks Time hours on this client in this period.</p>
              ) : (
                <div className="table-scroll mgb-sticky-wrap">
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
// Master Data sync strip (Team page, under the summary strip)
// ---------------------------------------------------------------------------
// Edge function master-sheet-sync + supabase/master-sheet-sync.sql. Fees come
// from the MGB_Master_Data Google Sheet (Clients tab). Only rendered for the
// same people as the rest of this file (TP_PF_canSee); the function and the
// tables refuse everyone else on the server too.
const TP_PF_SYNC_FN = "master-sheet-sync";

function TP_PF_when(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

async function TP_PF_invokeSync(body) {
  const sb = window.mgbSupabase;
  if (!sb) return { error: "Not signed in." };
  try {
    const res = await sb.functions.invoke(TP_PF_SYNC_FN, { body });
    let data = res.data;
    let err = res.error;
    if (err && err.context && typeof err.context.json === "function") {
      try {
        const b = await err.context.json();
        if (b && (b.status || b.error)) {
          data = b;
          err = null;
        }
      } catch (e) {}
    }
    if (err) return { error: err.message || String(err) };
    if (data && data.error) return { error: data.error === "forbidden" ? "You don't have access to this." : String(data.error) };
    return { data };
  } catch (e) {
    return { error: (e && e.message) || String(e) };
  }
}

function TP_PF_SheetSyncStrip({ profit }) {
  const [st, setSt] = useState({ loading: true });
  const [ver, setVer] = useState(0);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(null);
  const [preview, setPreview] = useState(null);
  const [msg, setMsg] = useState(null);
  const [pick, setPick] = useState({});
  const [done, setDone] = useState({});
  // Wait for the profit load: it is what proves the internal grant (kind "auth" = no grant).
  const blocked = !profit || !profit.ready;
  useEffect(() => {
    const sb = window.mgbSupabase;
    if (blocked || !sb) return undefined;
    let alive = true;
    (async () => {
      const [s, runs, un, cl, mp] = await Promise.all([
        TP_PF_invokeSync({ action: "status" }),
        TP_PF_safe(
          sb
            .from("master_sheet_sync_runs")
            .select("id, started_at, trigger, mode, status, requested_by, rows_read, updated, unchanged, unmatched, skipped, errors, conflicts, message")
            .order("started_at", { ascending: false })
            .limit(8)
        ),
        TP_PF_safe(sb.from("master_sheet_unmatched").select("sheet_key, sheet_name, status, fee_text, reason, last_seen_at").order("sheet_name")),
        TP_PF_safe(sb.from("clients").select("id, name, test_only, is_internal").order("name")),
        TP_PF_safe(sb.from("master_sheet_client_map").select("sheet_key")),
      ]);
      if (!alive) return;
      setSt({
        loading: false,
        status: s.data || null,
        statusErr: s.error || null,
        forbidden: s.error === "You don't have access to this.",
        tablesMissing: !!runs.error,
        runs: runs.data || [],
        // The list is rebuilt only on a live run: hide rows matched since then.
        unmatched: (un.data || []).filter((u) => !(mp.data || []).some((m) => m.sheet_key === u.sheet_key)),
        clients: (cl.data || []).filter((c) => !c.test_only && !c.is_internal),
      });
    })();
    return () => {
      alive = false;
    };
  }, [blocked, ver]);
  if (blocked || st.loading || st.tablesMissing || st.forbidden) return null;

  const status = st.status;
  const connected = !!(status && status.connected);
  const lastLive = st.runs.find((r) => r.mode === "live" && r.status !== "not_connected");
  const lastAny = st.runs[0];
  const unmatched = st.unmatched.filter((u) => !done[u.sheet_key]);
  const reloadAll = () => {
    setVer((n) => n + 1);
    profit.reload();
  };

  const runPreview = async () => {
    setBusy("preview");
    setMsg(null);
    const r = await TP_PF_invokeSync({ action: "preview" });
    setBusy(null);
    if (r.error) {
      setMsg({ bad: true, text: `Preview failed: ${r.error}` });
      return;
    }
    if (r.data.status !== "ok") {
      setMsg({ bad: r.data.status === "error", text: r.data.message || "Preview didn't run." });
      setPreview(null);
      setVer((n) => n + 1);
      return;
    }
    setPreview(r.data);
    setOpen(true);
    setVer((n) => n + 1);
  };

  const runSync = async () => {
    if (!preview) return;
    const n = (preview.changes || []).length;
    const ok = window.confirm(
      n ? `Apply ${n} fee change${n === 1 ? "" : "s"} from Master Data? Each change is logged in the Audit log.` : "No fee changes. Record a sync now (this also turns on the nightly sync)?"
    );
    if (!ok) return;
    setBusy("sync");
    setMsg(null);
    const r = await TP_PF_invokeSync({ action: "sync", fingerprint: preview.fingerprint });
    setBusy(null);
    if (r.error) {
      setMsg({ bad: true, text: `Sync failed: ${r.error}` });
      return;
    }
    const d = r.data;
    if (d.status === "ok") {
      setMsg({ bad: false, text: `Synced. ${d.message || ""}` });
      setPreview(null);
      setDone({});
      reloadAll();
    } else {
      setMsg({ bad: true, text: d.message || "Sync didn't run." });
      if (d.status === "changed_since_preview") setPreview(null);
      setVer((n) => n + 1);
    }
  };

  const saveMap = async (u, clientId) => {
    const sb = window.mgbSupabase;
    setBusy("map:" + u.sheet_key);
    const row = clientId ? { sheet_name: u.sheet_name, client_id: clientId, ignored: false } : { sheet_name: u.sheet_name, client_id: null, ignored: true };
    const res = await TP_PF_safe(sb.from("master_sheet_client_map").upsert(row, { onConflict: "sheet_key" }));
    setBusy(null);
    if (res.error) {
      setMsg({ bad: true, text: `Couldn't save the match: ${res.error.message || res.error}` });
      return;
    }
    setDone((m) => ({ ...m, [u.sheet_key]: true }));
    setMsg({ bad: false, text: clientId ? `${u.sheet_name} matched. Its fee syncs on the next Sync now.` : `${u.sheet_name} marked not a client.` });
  };

  const summary = (r) => {
    if (!r) return null;
    const bits = [`${r.updated} updated`, `${r.unchanged} already matched`];
    if (r.unmatched) bits.push(`${r.unmatched} need matching`);
    if (r.skipped) bits.push(`${r.skipped} skipped`);
    if (r.errors) bits.push(`${r.errors} errors`);
    if (r.conflicts) bits.push(`${r.conflicts} left alone`);
    return bits.join(" · ");
  };
  const trig = (r) => (r.trigger === "cron" ? "nightly" : r.requested_by || "manual");

  return (
    <div className="pf-sync">
      <div className="pf-sync-head">
        <span className="pf-sync-title">Master Data sync</span>
        {!status ? (
          <span className="tp-muted">{st.statusErr ? `Couldn't check the sync: ${st.statusErr}` : "Checking…"}</span>
        ) : !connected ? (
          <span className="pf-fee-tag pf-fee-check">not connected yet</span>
        ) : lastLive ? (
          <span className="tp-muted">
            Last sync {TP_PF_when(lastLive.started_at)} ({trig(lastLive)}){lastLive.status === "ok" ? `: ${summary(lastLive)}` : `: ${lastLive.status.replace(/_/g, " ")}`}
          </span>
        ) : (
          <span className="tp-muted">Connected. No sync yet: preview, then Sync now.</span>
        )}
        <span className="pf-sync-actions">
          {connected && (
            <button type="button" className="btn-secondary pf-btn" onClick={runPreview} disabled={!!busy}>
              {busy === "preview" ? "Reading the sheet…" : "Preview changes"}
            </button>
          )}
          <button type="button" className="tp-q-link" onClick={() => setOpen((o) => !o)}>
            {open ? "Hide details" : `Details${unmatched.length ? ` (${unmatched.length} to match)` : ""}`}
          </button>
        </span>
      </div>
      {msg && <p className={msg.bad ? "tp-bad pf-sync-msg" : "pf-sync-msg"}>{msg.text}</p>}
      {connected && lastAny && lastAny.status === "error" && !msg && <p className="tp-bad pf-sync-msg">Last run failed: {lastAny.message}</p>}
      {connected && lastAny && lastAny.status === "held" && !msg && <p className="pf-sync-msg">{lastAny.message}</p>}

      {open && (
        <div className="pf-sync-body">
          {!connected && (
            <div className="pf-sync-steps">
              <p>
                Fees will come from the <b>{(status && status.fee_header) || "Bookkeeping fee 2027"}</b> column of the MGB_Master_Data sheet (Clients tab) once
                the sheet is connected. Until then nothing changes.
              </p>
              {status && status.key_error && <p className="tp-bad">The key saved in Supabase doesn't work: {status.key_error}</p>}
              <ol>
                <li>In Google Cloud, create a service account (no roles) in a project with the Google Sheets API turned on, and download a JSON key for it.</li>
                <li>In Supabase › Edge Functions › Secrets, add <code>GOOGLE_SA_KEY</code> with the whole JSON key as the value.</li>
                <li>Share MGB_Master_Data with the service account's email (it ends in <code>.iam.gserviceaccount.com</code>) as <b>Viewer</b> only.</li>
                <li>Come back here, click Preview changes, check the list, then Sync now.</li>
              </ol>
              <p className="tp-muted">The full steps are in the Profitability guide article.</p>
            </div>
          )}
          {connected && status.service_account_email && (
            <p className="tp-muted">
              Reading as {status.service_account_email} (Viewer) · column “{status.fee_header}” ·{" "}
              {status.nightly_ready ? "nightly sync on (early morning, about 3:20–4:20 AM Eastern)" : "nightly sync starts after the first Sync now"}
            </p>
          )}

          {preview && (
            <div className="pf-sync-preview">
              <h4 className="pf-subhead">Preview: nothing has changed yet</h4>
              <p className="tp-muted">
                {preview.counts.rows_read} sheet rows · {(preview.changes || []).length} fee changes · {preview.unchanged} already match ·{" "}
                {(preview.unmatched || []).length} need matching · {(preview.skipped || []).length} skipped
              </p>
              {(preview.changes || []).length > 0 && (
                <div className="table-scroll">
                  <table className="tx-table tx-table-labeled tp-table">
                    <thead>
                      <tr>
                        <th>Client</th>
                        <th className="num">Now</th>
                        <th className="num">From sheet</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.changes.map((c) => (
                        <tr key={c.client_id}>
                          <td data-primary="">
                            <span className="tp-name">{c.client_name}</span>
                            {c.sheet_name !== c.client_name && <span className="tp-muted"> (sheet: {c.sheet_name})</span>}
                          </td>
                          <td className="num" data-label="Now">{c.from != null ? fmtMoney(c.from) : "Not set"}</td>
                          <td className="num" data-label="From sheet">{fmtMoney(c.to)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {(preview.errors || []).length > 0 && (
                <ul className="pf-sync-list tp-bad">
                  {preview.errors.map((e, i) => (
                    <li key={i}>
                      Row {e.row} {e.sheet_name}: {e.reason}
                    </li>
                  ))}
                </ul>
              )}
              {(preview.skipped || []).length > 0 && (
                <details className="pf-sync-details">
                  <summary>Skipped rows ({preview.skipped.length})</summary>
                  <ul className="pf-sync-list">
                    {preview.skipped.map((s, i) => (
                      <li key={i}>
                        {s.sheet_name}: {s.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              <div className="pf-inline-form" style={{ marginTop: 10 }}>
                <button type="button" className="btn-primary pf-btn" onClick={runSync} disabled={!!busy}>
                  {busy === "sync"
                    ? "Syncing…"
                    : (preview.changes || []).length
                      ? `Sync now: apply ${(preview.changes || []).length} change${(preview.changes || []).length === 1 ? "" : "s"}`
                      : "Sync now (no fee changes)"}
                </button>
                <button type="button" className="btn-secondary pf-btn" onClick={() => setPreview(null)} disabled={!!busy}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {unmatched.length > 0 && (
            <>
              <h4 className="pf-subhead">Sheet rows with no portal client ({unmatched.length})</h4>
              <p className="tp-muted">Never guessed. Match each to a client, or mark it not a client. Matches take effect on the next sync.</p>
              <ul className="pf-sync-unmatched">
                {unmatched.map((u) => (
                  <li key={u.sheet_key}>
                    <span className="pf-sync-uname">
                      <b>{u.sheet_name}</b>{" "}
                      <span className="tp-muted">
                        {u.status || "no status"}
                        {u.fee_text ? ` · ${u.fee_text}` : ""}
                      </span>
                    </span>
                    <span className="pf-inline-form">
                      <select
                        aria-label={`Portal client for ${u.sheet_name}`}
                        value={pick[u.sheet_key] || ""}
                        onChange={(e) => setPick((p) => ({ ...p, [u.sheet_key]: e.target.value }))}
                      >
                        <option value="">Choose a client…</option>
                        {st.clients.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      <button type="button" className="btn-secondary pf-btn" disabled={!pick[u.sheet_key] || !!busy} onClick={() => saveMap(u, pick[u.sheet_key])}>
                        Match to client
                      </button>
                      <button type="button" className="tp-q-link" disabled={!!busy} onClick={() => saveMap(u, null)}>
                        Not a client
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {st.runs.length > 0 && (
            <details className="pf-sync-details">
              <summary>Recent runs</summary>
              <ul className="pf-sync-list">
                {st.runs.map((r) => (
                  <li key={r.id}>
                    {TP_PF_when(r.started_at)} · {r.mode === "dry_run" ? "preview" : "sync"} by {trig(r)} · {r.status.replace(/_/g, " ")}
                    {r.status === "ok" && r.mode === "live" ? ` · ${summary(r)}` : ""}
                    {r.message && r.status !== "ok" ? ` · ${r.message}` : ""}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
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
  if (!profit || profit.kind === "auth") return null;
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
  // No grant (or anything else wrong): show nothing rather than a hint that
  // profit exists.
  if (profit.kind) return null;
  const v = TP_PF_rowView(profit, qboOn, clientId);
  const blocker = !qboOn ? "QuickBooks Time not connected" : !profit.hasRates ? "Set staff rates to see profit" : null;
  return (
    <>
      <li>
        <span>
          Monthly fee <TP_PF_FeeTag source={v.feeSource} review={v.feeReview} sheet={v.feeSheet} />
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
