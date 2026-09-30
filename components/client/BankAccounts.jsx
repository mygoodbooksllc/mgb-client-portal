// ----------------------------------------------------------------------------
// Client Bank Accounts page (redesign, owner-approved 2026-09-30).
//
//   BA_BankTransactionsPanel  the whole balances + transactions view. Used by
//                             BankPage and by BankReconciliationPage's
//                             Transactions view (app.jsx).
//
// Layout: three KPIs (Cash on hand, Card balances owed, Net cash), then one
// compact account list grouped Cash / Cards (click a row to filter the
// transactions to that account, click again or "All accounts" to clear), then
// the transactions table with search, date-range chips, In/Out filter, a
// totals line for the filtered rows, paging (50 + "Show more") and a CSV
// export of exactly the filtered set.
//
// Category vs. Type (2026-09-30): on QuickBooks data the Category is the
// posting ("split") account qbo-sync saves in qbo_transactions.split_account
// and Type is the transaction type. Until a sync that saves categories has run
// for the client every category is null: the Category column and the
// multi-select category filter stay hidden and Type carries the row. Client
// users get an "Ask" button per row (components/client/TxnQuestions.jsx);
// staff see a "Question" pill on rows with an open question.
//
// Cash vs. card: a card's balance is the amount OWED (QuickBooks reports it as
// a positive number), so it is never added to cash. window.mgbIsCardAccount
// (data.js) decides which is which.
//
// Loaded before app.jsx in the shared global scope: every top-level name
// carries a BA_ prefix; app.jsx globals (fmtMoney, fmtDate, todayLocal,
// useToast, useCardFlash, EmptyRow, InternalNoteButton, effectivePlan,
// syncCadenceLabel, relTime) are only touched at render time. Hooks are used
// as React.*.
// ----------------------------------------------------------------------------

const BA_PAGE_SIZE = 50;

const BA_RANGES = [
  { key: "month", label: "This month" },
  { key: "last", label: "Last month" },
  { key: "90", label: "90 days" },
  { key: "all", label: "All" },
];

const BA_DIRECTIONS = [
  { key: "all", label: "All" },
  { key: "in", label: "In" },
  { key: "out", label: "Out" },
];

function BA_iso(d) {
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}

// [from, to] inclusive YYYY-MM-DD bounds for a range key, in local time.
// null means unbounded on that side.
function BA_rangeBounds(key) {
  const now = new Date();
  if (key === "month") {
    return [BA_iso(new Date(now.getFullYear(), now.getMonth(), 1)), null];
  }
  if (key === "last") {
    return [
      BA_iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
      BA_iso(new Date(now.getFullYear(), now.getMonth(), 0)),
    ];
  }
  if (key === "90") {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 90);
    return [BA_iso(d), null];
  }
  return [null, null];
}

function BA_domId(accountId, index) {
  return "ba-tx-" + String(accountId).replace(/[^A-Za-z0-9_-]/g, "_") + "-" + index;
}

// "Last synced 2 hours ago · Synced from QuickBooks weekly".
function BA_syncLine(client) {
  const plan =
    typeof effectivePlan === "function" ? effectivePlan(client) : "standard";
  const cadence =
    typeof syncCadenceLabel === "function"
      ? syncCadenceLabel(plan)
      : "Synced from QuickBooks";
  if (client.dataSource !== "quickbooks") {
    return "Sample data · " + cadence.charAt(0).toLowerCase() + cadence.slice(1) + " once connected";
  }
  const ago = typeof relTime === "function" ? relTime(client.lastSyncedAt) : null;
  return (ago ? "Last synced " + ago : "Waiting for the first sync") + " · " + cadence;
}

function BA_AccountRow({ account, share, isCard, selected, onSelect }) {
  return (
    <button
      type="button"
      className={"ba-acct" + (selected ? " is-selected" : "")}
      aria-pressed={selected}
      onClick={onSelect}
      title={selected ? "Show all accounts" : `Show only ${account.accountName}`}
    >
      <span className="ba-acct-main">
        <span className="ba-acct-name">{account.accountName}</span>
        <span className="ba-acct-meta">
          {account.type}
          {account.accountMask ? ` · •••• ${account.accountMask}` : ""}
        </span>
      </span>
      <span className="ba-acct-amount">
        <span className={"ba-acct-balance" + (isCard ? " is-card" : "")}>
          {fmtMoney(account.balance, { cents: true })}
        </span>
        {isCard && <span className="ba-acct-owed">owed</span>}
      </span>
      <span className="ba-acct-bar" aria-hidden="true">
        <span
          className={"ba-acct-bar-fill" + (isCard ? " is-card" : "")}
          style={{ width: `${Math.max(2, Math.round(share * 100))}%` }}
        />
      </span>
    </button>
  );
}

function BA_AccountGroup({ label, accounts, total, isCard, selectedId, onSelect }) {
  if (!accounts.length) return null;
  const denom = accounts.reduce((s, a) => s + Math.abs(a.balance), 0);
  return (
    <div className="ba-group">
      <div className="ba-group-head">
        <span className="ba-group-label">{label}</span>
        <span className="ba-group-total">
          {fmtMoney(total, { cents: true })}
          {isCard ? " owed" : ""}
        </span>
      </div>
      {accounts.map((a) => (
        <BA_AccountRow
          key={a.id}
          account={a}
          isCard={isCard}
          share={denom > 0 ? Math.abs(a.balance) / denom : 0}
          selected={selectedId === a.id}
          onSelect={() => onSelect(selectedId === a.id ? null : a.id)}
        />
      ))}
    </div>
  );
}

// Multi-select category filter: a button that opens a checklist. `selected`
// is an array of category labels (BA_UNCAT stands for "no category").
function BA_CategoryFilter({ options, selected, onChange }) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const toggle = (c) =>
    onChange(selected.includes(c) ? selected.filter((x) => x !== c) : [...selected, c]);
  const label = !selected.length
    ? "All categories"
    : selected.length === 1
      ? selected[0]
      : `${selected.length} categories`;
  return (
    <div className="ba-catfilter" ref={rootRef}>
      <button
        type="button"
        className={"ba-catfilter-btn" + (selected.length ? " is-active" : "")}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="ba-catfilter-label">{label}</span>
        <span aria-hidden="true" className="ba-catfilter-caret">▾</span>
      </button>
      {open && (
        <div className="ba-catfilter-panel" role="group" aria-label="Filter by category">
          <div className="ba-catfilter-head">
            <span>Category</span>
            {selected.length > 0 && (
              <button type="button" className="ba-catfilter-clear" onClick={() => onChange([])}>
                Clear
              </button>
            )}
          </div>
          <div className="ba-catfilter-list">
            {options.map((o) => (
              <label key={o.value} className="ba-catfilter-opt">
                <input
                  type="checkbox"
                  checked={selected.includes(o.value)}
                  onChange={() => toggle(o.value)}
                />
                <span className="ba-catfilter-name">{o.label}</span>
                <span className="ba-catfilter-n">{o.count}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const BA_UNCAT = "\u0000uncategorized";

function BA_BankTransactionsPanel({ client, searchTarget, isClientUser }) {
  const showToast = useToast();
  const { flashCardId, jumpToCard } = useCardFlash();
  const staffCtx =
    typeof StaffToolsContext !== "undefined" ? React.useContext(StaffToolsContext) : null;
  const isStaff = !!(staffCtx && staffCtx.staff);
  const accounts = client.bankAccounts || [];
  const cashAccts = window.mgbCashAccounts(accounts);
  const cardAccts = window.mgbCardAccounts(accounts);
  const cashTotal = cashAccts.reduce((s, a) => s + a.balance, 0);
  const cardTotal = cardAccts.reduce((s, a) => s + a.balance, 0);
  const isQbo = client.dataSource === "quickbooks";
  // Transaction questions (components/client/TxnQuestions.jsx): QuickBooks
  // rows only, since they need a stable transaction key.
  const tq =
    typeof TQ_useQuestions === "function"
      ? TQ_useQuestions([client.id], { enabled: isQbo })
      : { byKey: {} };

  const [rawSelectedId, setSelectedId] = React.useState(null);
  // An id that isn't one of this client's accounts (a stale search target,
  // an account that disappeared on re-sync) means "all accounts".
  const selectedId = accounts.some((a) => a.id === rawSelectedId)
    ? rawSelectedId
    : null;
  const [query, setQuery] = React.useState("");
  const [range, setRange] = React.useState("all");
  const [direction, setDirection] = React.useState("all");
  const [cats, setCats] = React.useState([]);
  const [limit, setLimit] = React.useState(BA_PAGE_SIZE);
  const [pendingJump, setPendingJump] = React.useState(null);

  const allRows = React.useMemo(
    () =>
      accounts
        .flatMap((a) =>
          (a.transactions || []).map((t, i) => ({
            ...t,
            accountId: a.id,
            accountName: a.accountName,
            domId: BA_domId(a.id, i),
          })),
        )
        .sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : 0)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client],
  );

  const selected = accounts.find((a) => a.id === selectedId) || null;

  // Category = the QuickBooks posting (split) account, or data.js's budget
  // category on sample data. It stays null on QuickBooks rows until the
  // updated qbo-sync has run for this client; until then the Category column
  // and filter are hidden and the Type column carries the row.
  const hasCategories = allRows.some((t) => t.category);
  const hasTypes = allRows.some((t) => t.type);
  // With neither known the table still shows one column: Type on QuickBooks
  // data, Category on sample data.
  const showCatCol = hasCategories || (!hasTypes && !isQbo);
  const showTypeCol = hasTypes || (!hasCategories && isQbo);
  const catOptions = React.useMemo(() => {
    const counts = {};
    let uncat = 0;
    allRows.forEach((t) => {
      if (t.category) counts[t.category] = (counts[t.category] || 0) + 1;
      else uncat++;
    });
    const opts = Object.keys(counts)
      .sort((a, b) => a.localeCompare(b))
      .map((c) => ({ value: c, label: c, count: counts[c] }));
    if (uncat && opts.length) opts.push({ value: BA_UNCAT, label: "Uncategorized", count: uncat });
    return opts;
  }, [allRows]);
  // Drop picks that no longer exist (re-sync, another client).
  const activeCats = hasCategories ? cats.filter((c) => catOptions.some((o) => o.value === c)) : [];
  const catsKey = activeCats.join("\u0001");
  // Suggestions for "What was this for?": the categories already in use plus
  // the budget / P&L lines.
  const askCategories = React.useMemo(() => {
    const set = new Set();
    allRows.forEach((t) => t.category && !/^Split \(/.test(t.category) && set.add(t.category));
    (client.budget || []).forEach((b) => b && b.category && set.add(b.category));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRows, client]);

  const rows = React.useMemo(() => {
    const [from, to] = BA_rangeBounds(range);
    const q = query.trim().toLowerCase();
    const catSet = activeCats.length ? new Set(activeCats) : null;
    return allRows.filter((t) => {
      if (selectedId && t.accountId !== selectedId) return false;
      if (from && t.date < from) return false;
      if (to && t.date > to) return false;
      if (direction === "in" && !(t.amount > 0)) return false;
      if (direction === "out" && !(t.amount < 0)) return false;
      if (catSet && !catSet.has(t.category || BA_UNCAT)) return false;
      if (q) {
        const hay = (
          String(t.description || "") +
          " " +
          String(t.memo || "") +
          " " +
          String(t.category || "") +
          " " +
          String(t.type || "")
        ).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRows, selectedId, range, direction, query, catsKey]);

  const moneyIn = rows.reduce((s, t) => s + (t.amount > 0 ? t.amount : 0), 0);
  const moneyOut = rows.reduce((s, t) => s + (t.amount < 0 ? t.amount : 0), 0);
  const filtersOn =
    !!selectedId ||
    !!query.trim() ||
    range !== "all" ||
    direction !== "all" ||
    activeCats.length > 0;

  // Any filter change starts the list over at the first page.
  React.useEffect(() => {
    setLimit((l) => (pendingJump ? l : BA_PAGE_SIZE));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, range, direction, query, catsKey]);

  // Search-result deep link: filter to that account, clear the other filters,
  // page far enough to include the row, then scroll to it and flash it.
  React.useEffect(() => {
    if (!searchTarget || !searchTarget.accountId) return;
    const m = /^tx-(\d+)$/.exec(String(searchTarget.highlightKey || ""));
    if (!m) return;
    const domId = BA_domId(searchTarget.accountId, Number(m[1]));
    const idx = allRows
      .filter((t) => t.accountId === searchTarget.accountId)
      .findIndex((t) => t.domId === domId);
    setSelectedId(searchTarget.accountId);
    setQuery("");
    setRange("all");
    setDirection("all");
    setCats([]);
    setLimit(Math.max(BA_PAGE_SIZE, idx + 1));
    setPendingJump(domId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTarget && searchTarget.nonce]);

  React.useEffect(() => {
    if (!pendingJump) return;
    jumpToCard(pendingJump, pendingJump);
    setPendingJump(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingJump, selectedId, limit]);

  const exportCSV = () => {
    const header = [
      "Date",
      "Account",
      "Description",
      ...(showCatCol ? ["Category"] : []),
      ...(showTypeCol ? ["Type"] : []),
      "Amount",
    ];
    const body = rows.map((t) => [
      t.date,
      t.accountName,
      t.description,
      ...(showCatCol ? [t.category || "Uncategorized"] : []),
      ...(showTypeCol ? [t.type || ""] : []),
      t.amount,
    ]);
    const csv = [header, ...body]
      .map((r) => r.map((v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const scope = selected
      ? selected.accountName.replace(/\s+/g, "_")
      : "all_accounts";
    a.download = `${client.name.replace(/\s+/g, "_")}_${scope}_transactions.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(
      `Exported ${rows.length} transaction${rows.length === 1 ? "" : "s"} to CSV.`,
    );
  };

  // Every hook has run, so this early return is safe.
  if (!accounts.length) {
    return (
      <div className="card">
        <h3 className="card-title">No accounts connected yet</h3>
        <p className="muted">
          Once your bookkeeper links your bank accounts, balances and
          transactions will show up here.
        </p>
      </div>
    );
  }

  const shown = rows.slice(0, limit);
  const colCount = (selectedId ? 3 : 4) + (showCatCol ? 1 : 0) + (showTypeCol ? 1 : 0);

  return (
    <div className="ba-page">
      <div className="kpi-grid ba-kpis">
        <div className="card kpi-card">
          <span className="kpi-label">Cash on hand</span>
          <span className="kpi-value">{fmtMoney(cashTotal)}</span>
          <span className="kpi-sub neutral">
            across {cashAccts.length} account{cashAccts.length !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="card kpi-card">
          <span className="kpi-label">Card balances (owed)</span>
          <span className="kpi-value">{fmtMoney(cardTotal)}</span>
          <span className="kpi-sub neutral">
            {cardAccts.length
              ? `on ${cardAccts.length} card${cardAccts.length !== 1 ? "s" : ""}`
              : "no cards linked"}
          </span>
        </div>
        <div className="card kpi-card">
          <span className="kpi-label">Net cash</span>
          <span
            className="kpi-value"
            style={cashTotal - cardTotal < 0 ? { color: "var(--bad)" } : undefined}
          >
            {fmtMoney(cashTotal - cardTotal)}
          </span>
          <span className="kpi-sub neutral">cash minus card balances</span>
        </div>
      </div>

      <div className="ba-layout">
        <div className="card ba-accounts">
          <div className="ba-accounts-head">
            <h3 className="card-title" style={{ margin: 0 }}>
              Accounts
            </h3>
            <button
              type="button"
              className={"ba-all" + (selectedId ? "" : " is-selected")}
              aria-pressed={!selectedId}
              onClick={() => setSelectedId(null)}
            >
              All accounts
            </button>
          </div>
          <p className="ba-sync">{BA_syncLine(client)}</p>
          <BA_AccountGroup
            label="Cash"
            accounts={cashAccts}
            total={cashTotal}
            isCard={false}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
          <BA_AccountGroup
            label="Cards"
            accounts={cardAccts}
            total={cardTotal}
            isCard={true}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </div>

        <div className="card ba-tx">
          <div className="page-header" style={{ marginBottom: 4 }}>
            <div>
              <h3 className="card-title">Transactions</h3>
              <p className="card-subtitle" style={{ margin: 0 }}>
                {selected
                  ? `${selected.accountName} only, most recent first`
                  : "All accounts, most recent first"}
              </p>
            </div>
            <button className="btn-secondary" onClick={exportCSV} disabled={!rows.length}>
              Export CSV
            </button>
          </div>

          <div className="ba-filters">
            <input
              type="search"
              className="ba-search"
              placeholder={hasCategories ? "Search description, memo or category" : "Search description or memo"}
              aria-label="Search transactions"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="view-toggle" role="group" aria-label="Date range">
              {BA_RANGES.map((r) => (
                <button
                  key={r.key}
                  type="button"
                  className={"view-toggle-btn" + (range === r.key ? " active" : "")}
                  aria-pressed={range === r.key}
                  onClick={() => setRange(r.key)}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <div className="view-toggle" role="group" aria-label="Money in or out">
              {BA_DIRECTIONS.map((d) => (
                <button
                  key={d.key}
                  type="button"
                  className={"view-toggle-btn" + (direction === d.key ? " active" : "")}
                  aria-pressed={direction === d.key}
                  onClick={() => setDirection(d.key)}
                >
                  {d.label}
                </button>
              ))}
            </div>
            {hasCategories && catOptions.length > 0 && (
              <BA_CategoryFilter options={catOptions} selected={activeCats} onChange={setCats} />
            )}
          </div>

          <div className="ba-totals" aria-live="polite">
            <span>
              {rows.length} transaction{rows.length !== 1 ? "s" : ""}
            </span>
            <span>
              In <strong className="positive">+{fmtMoney(moneyIn, { cents: true })}</strong>
            </span>
            <span>
              Out <strong className="negative">{fmtMoney(moneyOut, { cents: true })}</strong>
            </span>
            <span>
              Net{" "}
              <strong className={moneyIn + moneyOut >= 0 ? "positive" : "negative"}>
                {moneyIn + moneyOut >= 0 ? "+" : ""}
                {fmtMoney(moneyIn + moneyOut, { cents: true })}
              </strong>
            </span>
          </div>

          <div className="table-scroll">
            <table className="tx-table tx-table-labeled ba-table">
              <thead>
                <tr>
                  <th>Date</th>
                  {!selectedId && <th>Account</th>}
                  <th>Description</th>
                  {showCatCol && <th>Category</th>}
                  {showTypeCol && <th>Type</th>}
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {shown.length === 0 ? (
                  <EmptyRow colSpan={colCount}>
                    {filtersOn && allRows.length
                      ? "No transactions match these filters."
                      : selected
                        ? "No transactions on this account yet."
                        : "No transactions yet."}
                  </EmptyRow>
                ) : (
                  shown.map((t) => (
                    <tr
                      key={t.domId}
                      id={t.domId}
                      className={flashCardId === t.domId ? "row-flash" : ""}
                    >
                      <td data-label="Date">{fmtDate(t.date)}</td>
                      {!selectedId && <td data-label="Account">{t.accountName}</td>}
                      <td data-primary="">
                        {t.description}
                        <InternalNoteButton
                          client={client}
                          targetType="transaction"
                          targetKey={`${t.accountName || ""}|${t.date}|${t.description}|${t.amount}`}
                          targetLabel={`${fmtDate(t.date)} · ${t.description} · ${fmtMoney(t.amount)}`}
                        />
                        {isQbo && typeof TQ_RowControl === "function" && (
                          <TQ_RowControl
                            client={client}
                            txn={t}
                            question={t.txnKey ? tq.byKey[client.id + "|" + t.txnKey] : null}
                            isStaff={isStaff}
                            isClientUser={!!isClientUser}
                            categories={askCategories}
                          />
                        )}
                      </td>
                      {showCatCol && (
                        <td data-label="Category">
                          <span className={"category-tag" + (t.category ? "" : " is-uncat")}>
                            {t.category || "Uncategorized"}
                          </span>
                        </td>
                      )}
                      {showTypeCol && (
                        <td data-label="Type" className="ba-type">
                          {t.type || "—"}
                        </td>
                      )}
                      <td
                        className={
                          "num tx-amount " + (t.amount >= 0 ? "positive" : "negative")
                        }
                        data-label="Amount"
                      >
                        {t.amount >= 0 ? "+" : ""}
                        {fmtMoney(t.amount, { cents: true })}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {rows.length > shown.length && (
            <div className="ba-more">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setLimit((l) => l + BA_PAGE_SIZE)}
              >
                Show more
              </button>
              <span className="ba-more-count">
                Showing {shown.length} of {rows.length}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
