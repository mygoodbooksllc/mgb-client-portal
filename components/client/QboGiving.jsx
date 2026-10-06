// Giving from QuickBooks (read-only).
//
// A church's tithes and offerings come from its QuickBooks P&L: the income
// accounts that count as giving, month by month, plus recent transactions
// posted to those accounts. The numbers are built by mgbBuildQboGiving in
// components/qbo/mapQboToClient.js and arrive as client.givingQbo. Which
// accounts count: the staff pick in Client details -> QuickBooks
// (QG_GivingAccountsPicker below, table client_giving_accounts), otherwise
// any income account whose name looks like giving.
//
// Funds come from QuickBooks too: the balance-sheet accounts staff mark as
// funds in Client details -> QuickBooks (QG_FundAccountsPicker below, table
// client_fund_accounts), otherwise equity/asset accounts named like a fund.
// mgbBuildQboFunds in mapQboToClient.js builds client.funds / client.fundsQbo.
// Pro clients get the full Giving & Funds page (FundAccountingProPage in
// app.jsx) fed from these; QG_GivingTrend and QG_qboContributions are the
// pieces it borrows.
//
// Nothing here writes to QuickBooks. The pickers only save portal settings.
//
// Globals are QG_-prefixed. app.jsx helpers (fmtMoney, fmtDate, relTime,
// syncCadenceLabel, useToast) are looked up at render time, guarded.

const QG_AUTO_WORDS = "tithe, offering, contribution, donation, giving, pledge or gift";

function QG_money(n, opts) {
  if (typeof fmtMoney === "function") return fmtMoney(n, opts);
  return "$" + Math.round(Number(n) || 0).toLocaleString();
}

function QG_date(d) {
  if (typeof fmtDate === "function") return fmtDate(d);
  return d || "";
}

function QG_monthName(key) {
  const m = /^(\d{4})-(\d{2})/.exec(String(key || ""));
  if (!m) return "";
  const names = ["January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December"];
  return names[Number(m[2]) - 1] + " " + m[1];
}

// "As of last sync, 2 hours ago · Synced from QuickBooks every 15 minutes".
function QG_syncLine(client, plan) {
  const cadence =
    typeof syncCadenceLabel === "function" ? syncCadenceLabel(plan || client.plan) : "Synced from QuickBooks";
  const ago = typeof relTime === "function" ? relTime(client.lastSyncedAt) : null;
  return (ago ? "As of last sync, " + ago : "Waiting for the first sync") + " · " + cadence;
}

// Fires after a giving-accounts save so App re-reads window.CLIENTS.
function QG_notifyReloaded() {
  try {
    window.dispatchEvent(new Event("mgb-qbo-reloaded"));
  } catch (e) {
    /* old browsers: the page picks it up on the next refresh */
  }
}

function QG_Header({ client, plan, title }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div className="eyebrow-badge">Giving · From QuickBooks</div>
      <h2
        style={{
          fontFamily: "var(--font-heading)",
          fontSize: 22,
          margin: "8px 0 4px",
          color: "var(--ink-strong)",
        }}
      >
        {title}
      </h2>
      <p className="card-subtitle" style={{ margin: 0 }}>
        {QG_syncLine(client, plan)}
      </p>
    </div>
  );
}

function QG_CalmCard({ badge, title, children }) {
  return (
    <div className="card" style={{ textAlign: "center", padding: "36px 28px", marginBottom: 20 }}>
      {badge && <div className="eyebrow-badge">{badge}</div>}
      <h2
        style={{
          fontFamily: "var(--font-heading)",
          fontSize: 22,
          margin: "10px 0 8px",
          color: "var(--ink-strong)",
        }}
      >
        {title}
      </h2>
      <div style={{ color: "var(--text-muted)", maxWidth: 560, margin: "0 auto" }}>{children}</div>
    </div>
  );
}

// A real (not test-only) client with no QuickBooks connection yet. Never
// shows sample numbers.
function QG_GivingEmptyState({ client }) {
  return (
    <div className="giving-page">
      <QG_CalmCard badge="Giving" title="Giving appears here once QuickBooks is connected">
        <p style={{ margin: 0 }}>
          Once {client.name || "your organization"}'s QuickBooks is connected, your
          tithes and offerings show up here by month. Your bookkeeper is setting
          this up.
        </p>
      </QG_CalmCard>
      <QG_FundsSection client={client} />
    </div>
  );
}

// Fund balances. A QuickBooks client's funds are the accounts staff picked
// (or auto-detected) in Client details -> QuickBooks, with each account's
// balance as of the last sync. Real clients never see the sample funds.
function QG_FundsSection({ client, isStaff }) {
  const funds = client.funds || [];
  const fq = client.fundsQbo || null;
  if (!funds.length) {
    return (
      <div className="card" style={{ marginBottom: 20 }}>
        <h3 className="card-title">Fund Balances</h3>
        <p className="card-subtitle" style={{ marginBottom: 0 }}>
          Funds appear here once your bookkeeper sets them up.
          {isStaff && client.dataSource === "quickbooks"
            ? " Pick which QuickBooks accounts are funds in Client details → QuickBooks → Fund accounts."
            : ""}
        </p>
      </div>
    );
  }
  const restricted = funds.filter((f) => f.restricted).reduce((s, f) => s + (Number(f.balance) || 0), 0);
  const unrestricted = funds.filter((f) => !f.restricted).reduce((s, f) => s + (Number(f.balance) || 0), 0);
  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <h3 className="card-title">Fund Balances</h3>
      <p className="card-subtitle">
        {fq && fq.source === "staff"
          ? "QuickBooks accounts your bookkeeper set up as funds"
          : "QuickBooks accounts with a name like fund or restricted"}
        {" · "}
        {QG_money(unrestricted)} unrestricted, {QG_money(restricted)} restricted, as of last sync
      </p>
      <div className="fund-grid">
        {funds.map((f) => (
          <div className="fund-card" key={f.name}>
            <div className="fund-card-top">
              <span className="fund-name">{f.name}</span>
              <span className={"pill " + (f.restricted ? "restricted" : "unrestricted")}>
                {f.restricted ? "Restricted" : "Unrestricted"}
              </span>
            </div>
            <span className="fund-balance">{QG_money(f.balance)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Giving transactions from QuickBooks in data.js's contributions shape
// ({ date, donor, fund, method, amount }), so the Pro page's Contributions
// table, Tax Documents donor list and giving statement PDF work unchanged.
// Donor is the QuickBooks customer / payer name on the transaction; gifts
// with no name (most bank deposits) count as Anonymous. Only what the sync
// holds: about the last 90 days of transactions.
function QG_qboContributions(client) {
  const g = client && client.givingQbo;
  if (!g || !g.gifts) return [];
  return g.gifts.map((t) => ({
    date: t.date,
    donor: t.name ? t.name : "Anonymous",
    fund: t.account,
    method: t.type || "",
    amount: Number(t.amount) || 0,
  }));
}

// Monthly giving bars. The sync month is month to date and drawn lighter.
function QG_MonthlyBars({ months }) {
  const wrapRef = React.useRef(null);
  const [wrapW, setWrapW] = React.useState(0);
  React.useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver((entries) => setWrapW(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  if (!months.length) {
    return <p className="card-subtitle">No months synced yet.</p>;
  }
  const narrow = wrapW > 0 && wrapW < 480;
  const width = narrow ? Math.max(280, Math.round(wrapW)) : 640;
  const height = 200;
  const pad = { top: 16, right: 8, bottom: 26, left: 52 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const maxVal = Math.max(1, ...months.map((m) => m.amount)) * 1.1;
  const slot = innerW / months.length;
  const barW = Math.max(6, Math.min(36, slot * 0.6));
  const ticks = [0, 0.5, 1].map((f) => maxVal * f);
  const labelEvery = narrow && months.length > 6 ? 2 : 1;
  const short = (v) =>
    v >= 1000 ? "$" + (v / 1000).toFixed(v >= 10000 ? 0 : 1) + "k" : "$" + Math.round(v);
  return (
    <div className="chart-wrap" ref={wrapRef} style={{ height: "auto" }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        role="img"
        aria-label="Giving by month"
        style={{ display: "block" }}
      >
        {ticks.map((t, i) => {
          const y = pad.top + innerH - (t / maxVal) * innerH;
          return (
            <g key={i}>
              <line x1={pad.left} x2={width - pad.right} y1={y} y2={y} stroke="var(--border)" strokeWidth="1" />
              <text x={pad.left - 6} y={y + 4} textAnchor="end" fontSize="11" fill="var(--text-muted)">
                {short(t)}
              </text>
            </g>
          );
        })}
        {months.map((m, i) => {
          const h = Math.max(0, (Math.max(0, m.amount) / maxVal) * innerH);
          const x = pad.left + slot * i + (slot - barW) / 2;
          const y = pad.top + innerH - h;
          return (
            <g key={m.key}>
              <rect
                x={x}
                y={y}
                width={barW}
                height={h}
                rx="3"
                fill="var(--chart-income)"
                opacity={m.partial ? 0.4 : 0.9}
              >
                <title>
                  {QG_monthName(m.key) + ": " + QG_money(m.amount) + (m.partial ? " (month to date)" : "")}
                </title>
              </rect>
              {i % labelEvery === 0 && (
                <text
                  x={x + barW / 2}
                  y={height - 8}
                  textAnchor="middle"
                  fontSize="11"
                  fill="var(--text-muted)"
                >
                  {m.month}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// Giving by month and by account, from client.givingQbo. Used on the
// Giving page and on the Pro Giving & Funds page's Giving view.
function QG_GivingTrend({ g }) {
  if (!g) return null;
  return (
    <>
      <div className="card" style={{ marginBottom: 20 }}>
        <h3 className="card-title">Giving by month</h3>
        <p className="card-subtitle">
          From the QuickBooks profit and loss. The lighter bar is this month so far.
        </p>
        <QG_MonthlyBars months={g.months} />
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 className="card-title">By account</h3>
        <p className="card-subtitle">
          {g.source === "staff"
            ? "Income accounts your bookkeeper picked as giving."
            : `Income accounts with a name like ${QG_AUTO_WORDS}.`}
        </p>
        <div className="table-scroll">
          <table className="tx-table">
            <thead>
              <tr>
                <th>Account</th>
                <th className="num">This month</th>
                <th className="num">Year to date</th>
                <th className="num">Last 12 months</th>
              </tr>
            </thead>
            <tbody>
              {g.byAccount.length === 0 && (
                <tr>
                  <td colSpan={4} className="card-subtitle">
                    Nothing posted to {g.accounts.join(", ")} in the last 12 months.
                  </td>
                </tr>
              )}
              {g.byAccount.map((a) => (
                <tr key={a.account}>
                  <td>
                    <span className="category-tag">{a.account}</span>
                  </td>
                  <td className="num">{QG_money(a.thisMonth)}</td>
                  <td className="num">{QG_money(a.ytd)}</td>
                  <td className="num">{QG_money(a.last12)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </>
  );
}

function QG_QboGivingPage({ client, plan, isStaff }) {
  const g = client.givingQbo;

  if (client.givingQboHidden) {
    return (
      <div className="giving-page">
        <QG_CalmCard badge="Giving" title="Giving totals are organization-wide">
          <p style={{ margin: 0 }}>
            Your access covers specific areas, so the organization's overall
            giving isn't shown here. Ask your administrator if you need it.
          </p>
        </QG_CalmCard>
      </div>
    );
  }

  if (!g || !g.accounts.length) {
    return (
      <div className="giving-page">
        <QG_Header client={client} plan={plan} title="Giving" />
        <QG_CalmCard title="No giving accounts found in QuickBooks yet">
          <p style={{ margin: 0 }}>
            {g && g.source === "staff"
              ? "No income accounts are picked as giving for this organization."
              : `Giving shows up here from income accounts with a name like ${QG_AUTO_WORDS}.`}{" "}
            {isStaff
              ? "Pick which income accounts count as giving in Client details → QuickBooks."
              : "Your bookkeeper can choose which income accounts count as giving."}
          </p>
        </QG_CalmCard>
      </div>
    );
  }

  // Only compared when both sides have giving; "-100%" for a month nothing
  // was recorded in yet reads as an alarm rather than information.
  const change =
    g.lastMonth > 0 && g.monthlyAverage > 0
      ? (g.lastMonth - g.monthlyAverage) / g.monthlyAverage
      : null;

  return (
    <div className="giving-page">
      <QG_Header client={client} plan={plan} title="Giving" />

      <div className="kpi-grid">
        <div className="card kpi-card">
          <span className="kpi-label">This month so far</span>
          <span className="kpi-value">{QG_money(g.thisMonth)}</span>
          <span className="kpi-sub neutral">{QG_monthName(g.thisMonthKey)}, month to date</span>
        </div>
        <div className="card kpi-card">
          <span className="kpi-label">Last month</span>
          <span className="kpi-value">{g.lastMonth === null ? "—" : QG_money(g.lastMonth)}</span>
          <span className={"kpi-sub " + (change === null ? "neutral" : change >= 0 ? "positive" : "negative")}>
            {change === null
              ? QG_monthName(g.lastMonthKey) || "No closed month yet"
              : `${change >= 0 ? "+" : ""}${Math.round(change * 100)}% vs. monthly average`}
          </span>
        </div>
        <div className="card kpi-card">
          <span className="kpi-label">Year to date</span>
          <span className="kpi-value">{QG_money(g.ytd)}</span>
          <span className="kpi-sub neutral">
            {g.ytdFromKey && g.ytdFromKey.slice(5) !== "01"
              ? `Since ${QG_monthName(g.ytdFromKey)} (as far back as the sync goes)`
              : `${String(g.thisMonthKey || "").slice(0, 4)} so far`}
          </span>
        </div>
        <div className="card kpi-card">
          <span className="kpi-label">Last 12 months</span>
          <span className="kpi-value">{QG_money(g.last12)}</span>
          <span className="kpi-sub neutral">
            {g.monthlyAverage === null ? "—" : `About ${QG_money(g.monthlyAverage)} a month`}
          </span>
        </div>
      </div>

      <QG_GivingTrend g={g} />

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 className="card-title">Recent giving</h3>
        <p className="card-subtitle">
          Transactions posted to the giving accounts in the last 90 days. A
          deposit split across several accounts isn't listed here, but it is in
          the totals above.
        </p>
        <div className="table-scroll">
          <table className="tx-table tx-table-stack">
            <thead>
              <tr>
                <th>Date</th>
                <th>From</th>
                <th>Account</th>
                <th>Type</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {g.recent.length === 0 && (
                <tr>
                  <td colSpan={5} className="card-subtitle">
                    No single-account giving transactions in the last 90 days.
                  </td>
                </tr>
              )}
              {g.recent.map((t, i) => (
                <tr key={t.date + "-" + i}>
                  <td>{QG_date(t.date)}</td>
                  <td>{t.name || t.memo || "—"}</td>
                  <td>
                    <span className="category-tag">{t.account}</span>
                  </td>
                  <td>{t.type}</td>
                  <td className={"num tx-amount " + (t.amount >= 0 ? "positive" : "negative")}>
                    {QG_money(t.amount, { cents: true })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <QG_FundsSection client={client} isStaff={isStaff} />
    </div>
  );
}

// Client details -> QuickBooks (staff only): which income accounts count as
// giving. No row in client_giving_accounts = automatic (names like tithe,
// offering...). Saving writes only the portal setting, never QuickBooks.
function QG_GivingAccountsPicker({ client }) {
  const sb = window.mgbSupabase;
  const showToast = typeof useToast === "function" ? useToast() : null;
  const [state, setState] = React.useState({ loading: true });
  const [picked, setPicked] = React.useState(null); // Set of names, or null = automatic
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    if (!sb) {
      setState({ loading: false, error: "Not connected to the database." });
      return undefined;
    }
    (async () => {
      const [acc, pl, setting] = await Promise.all([
        sb.from("qbo_accounts").select("name, account_type").eq("client_id", client.id),
        sb.from("qbo_pl_lines").select("account_name, account_type").eq("client_id", client.id).eq("account_type", "Income"),
        sb.from("client_giving_accounts").select("account_names").eq("client_id", client.id).maybeSingle(),
      ]);
      if (!alive) return;
      if (acc.error) {
        setState({ loading: false, error: acc.error.message });
        return;
      }
      const names =
        typeof window.mgbQboIncomeAccountNames === "function"
          ? window.mgbQboIncomeAccountNames(acc.data || [], pl.data || [])
          : [];
      const row = setting && !setting.error ? setting.data : null;
      setState({ loading: false, names, hasRow: !!row });
      setPicked(row ? new Set(row.account_names || []) : null);
    })();
    return () => {
      alive = false;
    };
  }, [client.id]);

  if (state.loading) return <p className="card-subtitle">Loading income accounts…</p>;
  if (state.error) return <p className="card-subtitle">Couldn't load income accounts: {state.error}</p>;

  const looks = typeof window.mgbLooksLikeGiving === "function" ? window.mgbLooksLikeGiving : () => false;
  const autoSet = new Set(state.names.filter(looks));
  const effective = picked || autoSet;
  const isAuto = picked === null;

  const toggle = (name) => {
    const next = new Set(effective);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setPicked(next);
  };

  async function afterSave(msg) {
    if (window.mgbReloadQboData) await window.mgbReloadQboData([client.id]);
    QG_notifyReloaded();
    if (showToast) showToast(msg);
  }

  async function save() {
    if (!sb || saving) return;
    setSaving(true);
    const { error } = await sb
      .from("client_giving_accounts")
      .upsert({ client_id: client.id, account_names: Array.from(effective), updated_at: new Date().toISOString() });
    setSaving(false);
    if (error) {
      if (showToast) showToast("Couldn't save: " + error.message);
      return;
    }
    setState((s) => ({ ...s, hasRow: true }));
    afterSave("Saved. Giving now uses the accounts you picked.");
  }

  async function useAutomatic() {
    if (!sb || saving) return;
    setSaving(true);
    const { error } = await sb.from("client_giving_accounts").delete().eq("client_id", client.id);
    setSaving(false);
    if (error) {
      if (showToast) showToast("Couldn't save: " + error.message);
      return;
    }
    setPicked(null);
    setState((s) => ({ ...s, hasRow: false }));
    afterSave("Giving is back to picking accounts automatically.");
  }

  return (
    <div className="modal-section">
      <div className="nav-section-label modal-section-label">Giving accounts</div>
      <p className="card-subtitle" style={{ marginTop: 0 }}>
        Which QuickBooks income accounts count as giving on the client's Giving
        page. {isAuto
          ? `Right now it's automatic: any income account with a name like ${QG_AUTO_WORDS}.`
          : "Right now it uses the accounts ticked below."}{" "}
        This is a portal setting only; nothing changes in QuickBooks.
      </p>
      {state.names.length === 0 ? (
        <p className="card-subtitle">No income accounts have synced yet.</p>
      ) : (
        <div style={{ display: "grid", gap: 6, margin: "8px 0 12px" }}>
          {state.names.map((n) => (
            <label key={n} style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
              <input type="checkbox" checked={effective.has(n)} onChange={() => toggle(n)} />
              <span>{n}</span>
              {autoSet.has(n) && (
                <span className="card-subtitle" style={{ margin: 0 }}>
                  (matches automatically)
                </span>
              )}
            </label>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn-primary" onClick={save} disabled={saving || isAuto || state.names.length === 0}>
          {saving ? "Saving…" : "Save giving accounts"}
        </button>
        {state.hasRow && (
          <button className="btn-secondary" onClick={useAutomatic} disabled={saving}>
            Go back to automatic
          </button>
        )}
      </div>
    </div>
  );
}

// Client details -> QuickBooks (staff only): which balance-sheet accounts
// are funds, each restricted or unrestricted. No row in client_fund_accounts
// = automatic (equity/asset accounts named like "fund" or "restricted", never
// Undeposited Funds). Saving writes only the portal setting, never QuickBooks.
function QG_FundAccountsPicker({ client }) {
  const sb = window.mgbSupabase;
  const showToast = typeof useToast === "function" ? useToast() : null;
  const [state, setState] = React.useState({ loading: true });
  // Map of name -> restricted (boolean), or null = automatic.
  const [picked, setPicked] = React.useState(null);
  const [saving, setSaving] = React.useState(false);

  const looks = typeof window.mgbLooksLikeFund === "function" ? window.mgbLooksLikeFund : () => false;
  const guess = typeof window.mgbGuessRestricted === "function" ? window.mgbGuessRestricted : () => false;

  React.useEffect(() => {
    let alive = true;
    if (!sb) {
      setState({ loading: false, error: "Not connected to the database." });
      return undefined;
    }
    (async () => {
      const [acc, setting] = await Promise.all([
        sb
          .from("qbo_accounts")
          .select("name, account_type, classification, current_balance, active")
          .eq("client_id", client.id),
        sb.from("client_fund_accounts").select("accounts").eq("client_id", client.id).maybeSingle(),
      ]);
      if (!alive) return;
      if (acc.error) {
        setState({ loading: false, error: acc.error.message });
        return;
      }
      const candidates =
        typeof window.mgbQboFundCandidates === "function" ? window.mgbQboFundCandidates(acc.data || []) : [];
      const row = setting && !setting.error ? setting.data : null;
      setState({ loading: false, candidates, hasRow: !!row });
      if (row && Array.isArray(row.accounts)) {
        const m = new Map();
        row.accounts.forEach((a) => {
          if (a && a.name) m.set(a.name, typeof a.restricted === "boolean" ? a.restricted : guess(a.name));
        });
        setPicked(m);
      } else {
        setPicked(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [client.id]);

  if (state.loading) return <p className="card-subtitle">Loading balance-sheet accounts…</p>;
  if (state.error) return <p className="card-subtitle">Couldn't load accounts: {state.error}</p>;

  const autoMap = new Map(state.candidates.filter((c) => looks(c.name)).map((c) => [c.name, guess(c.name)]));
  const effective = picked || autoMap;
  const isAuto = picked === null;
  // A saved pick whose account no longer syncs still shows, so staff can untick it.
  const names = state.candidates.map((c) => c.name);
  const missing = Array.from(effective.keys()).filter((n) => names.indexOf(n) === -1);
  const balanceOf = {};
  state.candidates.forEach((c) => {
    balanceOf[c.name] = c.balance;
  });

  const toggle = (name) => {
    const next = new Map(effective);
    if (next.has(name)) next.delete(name);
    else next.set(name, guess(name));
    setPicked(next);
  };
  const setRestricted = (name, val) => {
    const next = new Map(effective);
    next.set(name, val);
    setPicked(next);
  };

  async function afterSave(msg) {
    if (window.mgbReloadQboData) await window.mgbReloadQboData([client.id]);
    QG_notifyReloaded();
    if (showToast) showToast(msg);
  }

  async function save() {
    if (!sb || saving) return;
    setSaving(true);
    const accounts = Array.from(effective.entries()).map(([name, restricted]) => ({ name, restricted: !!restricted }));
    const { error } = await sb
      .from("client_fund_accounts")
      .upsert({ client_id: client.id, accounts, updated_at: new Date().toISOString() });
    setSaving(false);
    if (error) {
      if (showToast) showToast("Couldn't save: " + error.message);
      return;
    }
    setPicked(new Map(effective));
    setState((s) => ({ ...s, hasRow: true }));
    afterSave("Saved. Funds now use the accounts you picked.");
  }

  async function useAutomatic() {
    if (!sb || saving) return;
    setSaving(true);
    const { error } = await sb.from("client_fund_accounts").delete().eq("client_id", client.id);
    setSaving(false);
    if (error) {
      if (showToast) showToast("Couldn't save: " + error.message);
      return;
    }
    setPicked(null);
    setState((s) => ({ ...s, hasRow: false }));
    afterSave("Funds are back to picking accounts automatically.");
  }

  const row = (n, isMissing) => {
    const on = effective.has(n);
    return (
      <div key={n} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer", flex: "1 1 220px" }}>
          <input type="checkbox" checked={on} onChange={() => toggle(n)} />
          <span>{n}</span>
          <span className="card-subtitle" style={{ margin: 0 }}>
            {isMissing ? "(no longer in QuickBooks)" : QG_money(balanceOf[n])}
            {!isMissing && autoMap.has(n) ? " · matches automatically" : ""}
          </span>
        </label>
        {on && (
          <span className="view-toggle" style={{ margin: 0 }}>
            <button
              type="button"
              className={"view-toggle-btn" + (!effective.get(n) ? " active" : "")}
              onClick={() => setRestricted(n, false)}
            >
              Unrestricted
            </button>
            <button
              type="button"
              className={"view-toggle-btn" + (effective.get(n) ? " active" : "")}
              onClick={() => setRestricted(n, true)}
            >
              Restricted
            </button>
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="modal-section">
      <div className="nav-section-label modal-section-label">Fund accounts</div>
      <p className="card-subtitle" style={{ marginTop: 0 }}>
        Which QuickBooks balance-sheet accounts are funds on the client's Giving
        &amp; Funds page, and whether each is restricted. Balances are as of the
        last sync.{" "}
        {isAuto
          ? 'Right now it\'s automatic: equity and asset accounts with "fund" or "restricted" in the name (not Undeposited Funds), restricted when the name says restricted.'
          : "Right now it uses the accounts ticked below."}{" "}
        This is a portal setting only; nothing changes in QuickBooks.
      </p>
      {state.candidates.length === 0 && missing.length === 0 ? (
        <p className="card-subtitle">No equity or asset accounts have synced yet.</p>
      ) : (
        <div style={{ display: "grid", gap: 6, margin: "8px 0 12px", maxHeight: 320, overflowY: "auto" }}>
          {names.map((n) => row(n, false))}
          {missing.map((n) => row(n, true))}
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          className="btn-primary"
          onClick={save}
          disabled={saving || (isAuto && autoMap.size === 0) || (state.candidates.length === 0 && missing.length === 0)}
        >
          {saving ? "Saving…" : "Save fund accounts"}
        </button>
        {state.hasRow && (
          <button className="btn-secondary" onClick={useAutomatic} disabled={saving}>
            Go back to automatic
          </button>
        )}
      </div>
    </div>
  );
}
