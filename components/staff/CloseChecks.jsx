// ----------------------------------------------------------------------------
// Automated month-close checks and stale-bank flags (QBO features plan,
// Phase 1, 2026-09-30). Staff only.
//
// Data (supabase/qbo-close-checks.sql, written by qbo-sync and a daily cron):
//   close_checks        one row per client per completed month (last 6):
//                       ready / blocked / behind / no_data, the individual
//                       checks and plain-language reasons
//   qbo_account_status  per bank / card / Undeposited Funds / uncategorized
//                       account: last transaction date, unreconciled count
//   month_close_settings.stale_bank_days   default 10; admins change it
//
// Status meaning:
//   ready    every known check passes
//   blocked  uncategorized transactions in the month, or Undeposited Funds
//            not cleared at month end (fixable inside QuickBooks)
//   behind   a bank or card account has no transactions for N days before
//            month end (feed likely stopped), or transactions on or before
//            month end aren't reconciled
//   no_data  QuickBooks close data hasn't synced for this client yet
//
// Stale bank (today): a bank or card account whose last transaction is more
// than N days ago. Reconciliation is read from the cleared flag QuickBooks
// puts on each transaction; bank-feed health is read from the last
// transaction date (QuickBooks doesn't expose feed status).
//
// Used by CloseTracker.jsx (per-cell badge, stale-bank flag, admin setting)
// and app.jsx's client overview (CC_ClientCloseCard). Loaded before both and
// shares the global scope: top-level names carry a CC_ prefix.
// ----------------------------------------------------------------------------

const CC_STATUS = {
  ready: { label: "Ready", cls: "cc-ready" },
  blocked: { label: "Blocked", cls: "cc-blocked" },
  behind: { label: "Behind", cls: "cc-behind" },
  no_data: { label: "No data", cls: "cc-nodata" },
};
const CC_CHANGED_EVENT = "mgb:close-checks-changed";
const CC_DAY_MS = 24 * 60 * 60 * 1000;

function CC_daysSince(ymd, today) {
  if (!ymd) return null;
  const [y, m, d] = String(ymd).slice(0, 10).split("-").map(Number);
  const t = today || new Date();
  const a = Date.UTC(y, m - 1, d);
  const b = Date.UTC(t.getFullYear(), t.getMonth(), t.getDate());
  return Math.round((b - a) / CC_DAY_MS);
}

function CC_shortDate(ymd) {
  if (!ymd) return "never";
  const [y, m, d] = String(ymd).slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Bank and card accounts with no transaction in more than `days` days.
function CC_staleBanks(accounts, days, today) {
  return (accounts || [])
    .filter((a) => (a.kind === "bank" || a.kind === "credit_card") && a.last_txn_date)
    .map((a) => ({ ...a, idle: CC_daysSince(a.last_txn_date, today) }))
    .filter((a) => a.idle > days)
    .sort((a, b) => b.idle - a.idle);
}

// Loads close_checks for the given periods, bank/card account status and the
// stale-bank threshold. Fails soft (empty maps) if the tables aren't there.
function CC_useCloseChecks(periods) {
  const [state, setState] = useState({ loading: true, checks: {}, accounts: {}, staleDays: 10, error: null });
  const key = (periods || []).join(",");

  const load = useCallback(async () => {
    const sb = window.mgbSupabase;
    if (!sb) {
      setState((s) => ({ ...s, loading: false }));
      return;
    }
    const safe = (p) => Promise.resolve(p).then((r) => r, (e) => ({ data: null, error: e }));
    let q = sb.from("close_checks").select("client_id, period, status, checks, reasons, data_as_of, evaluated_at");
    if (periods && periods.length) q = q.in("period", periods);
    const [cc, acct, st] = await Promise.all([
      safe(q),
      safe(
        sb
          .from("qbo_account_status")
          .select("client_id, qbo_id, name, kind, last_txn_date, last_reconciled_date, unreconciled_count, current_balance")
          .in("kind", ["bank", "credit_card"]),
      ),
      safe(sb.from("month_close_settings").select("stale_bank_days").maybeSingle()),
    ]);
    const checks = {};
    (cc.data || []).forEach((r) => {
      checks[r.client_id + "|" + r.period] = r;
    });
    const accounts = {};
    (acct.data || []).forEach((a) => {
      (accounts[a.client_id] = accounts[a.client_id] || []).push(a);
    });
    setState({
      loading: false,
      checks,
      accounts,
      staleDays: (st.data && st.data.stale_bank_days) || 10,
      error: cc.error ? cc.error.message || "Couldn't load close checks." : null,
    });
    // eslint-disable-next-line
  }, [key]);

  useEffect(() => {
    load();
    const onChange = () => load();
    window.addEventListener(CC_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(CC_CHANGED_EVENT, onChange);
  }, [load]);

  return { ...state, reload: load };
}

function CC_Badge({ row, compact }) {
  if (!row) return null;
  const s = CC_STATUS[row.status] || CC_STATUS.no_data;
  const reasons = (row.reasons || []).join("\n");
  return (
    <span className={"cc-badge " + s.cls + (compact ? " compact" : "")} title={reasons ? `${s.label}: ${reasons}` : s.label}>
      {s.label}
    </span>
  );
}

function CC_CheckList({ row }) {
  if (!row) return null;
  const checks = Array.isArray(row.checks) ? row.checks : [];
  return (
    <ul className="cc-checks">
      {checks.map((c) => (
        <li key={c.key} className={c.ok === true ? "ok" : c.ok === false ? "fail" : "unknown"}>
          <span className="cc-mark" aria-hidden="true">
            {c.ok === true ? "✓" : c.ok === false ? "!" : "?"}
          </span>
          <span>
            {c.label}
            {c.ok === null && <span className="cc-sub"> · not enough data yet</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

function CC_StaleList({ stale }) {
  if (!stale || !stale.length) return null;
  return (
    <ul className="cc-stale-list">
      {stale.map((a) => (
        <li key={a.qbo_id}>
          <span>{a.name || a.qbo_id}</span>
          <span className="cc-sub">
            last transaction {CC_shortDate(a.last_txn_date)} ({a.idle} days)
          </span>
        </li>
      ))}
    </ul>
  );
}

// Client overview card: the latest completed month's close status with its
// reasons and checks, plus any stale bank or card accounts today.
function CC_ClientCloseCard({ client }) {
  const today = useMemo(() => new Date(), []);
  const lastMonth = useMemo(() => {
    const d = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  }, [today]);
  const cc = CC_useCloseChecks([lastMonth]);
  if (!client) return null;
  const row = cc.checks[client.id + "|" + lastMonth];
  const stale = CC_staleBanks(cc.accounts[client.id], cc.staleDays, today);
  // Nothing to say for a client with no QuickBooks close data at all.
  if (cc.loading || (!row && !stale.length)) return null;
  const monthName = new Date(today.getFullYear(), today.getMonth() - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
  return (
    <div className={"card cc-card" + (row && row.status === "blocked" ? " card-urgent" : "")}>
      <div className="cc-head">
        <h3 className="card-title">{monthName} close</h3>
        <CC_Badge row={row} />
      </div>
      {row && row.status !== "ready" && (row.reasons || []).length > 0 && (
        <ul className="cc-reasons">
          {row.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}
      {row && row.status !== "no_data" && <CC_CheckList row={row} />}
      {stale.length > 0 && (
        <div className="cc-stale">
          <p className="cc-stale-title">
            Bank feed may have stopped (no transactions in over {cc.staleDays} days)
          </p>
          <CC_StaleList stale={stale} />
        </div>
      )}
      {row && row.data_as_of && (
        <p className="card-subtitle cc-asof">
          From QuickBooks {typeof relTime === "function" ? relTime(row.data_as_of) : new Date(row.data_as_of).toLocaleString()}
        </p>
      )}
    </div>
  );
}

// Admin setting for the stale-bank threshold (month_close_settings).
function CC_StaleDaysSetting({ value, onSaved, toast }) {
  const [draft, setDraft] = useState("");
  const save = async (e) => {
    e.preventDefault();
    const n = parseInt(draft, 10);
    if (!(n >= 1 && n <= 90)) {
      toast && toast("Pick between 1 and 90 days.");
      return;
    }
    const sb = window.mgbSupabase;
    if (!sb) return;
    const { error } = await sb.from("month_close_settings").update({ stale_bank_days: n }).eq("id", true);
    if (error) {
      toast && toast("Couldn't save. " + (error.message || ""));
      return;
    }
    setDraft("");
    toast && toast(`Bank accounts are flagged after ${n} days without a transaction. Close checks update overnight.`);
    onSaved && onSaved(n);
    window.dispatchEvent(new Event(CC_CHANGED_EVENT));
  };
  return (
    <form className="ct-field ct-late-setting" onSubmit={save}>
      <span>Stale bank after (days)</span>
      <span className="ct-late-input">
        <input
          type="number"
          min={1}
          max={90}
          inputMode="numeric"
          value={draft === "" ? value : draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label="Days without a bank transaction before an account is flagged as stale"
        />
        {draft !== "" && Number(draft) !== value && (
          <button type="submit" className="btn-secondary">
            Save
          </button>
        )}
      </span>
    </form>
  );
}
