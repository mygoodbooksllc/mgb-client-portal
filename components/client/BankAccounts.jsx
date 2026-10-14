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

// ---- Staff extras (TABS-SPEC WP3, 2026-10-10) ------------------------------
// Staff only (the panel's isStaff, from StaffToolsContext, which already
// excludes Preview as): a sync line with Sync now and a stale note, the
// QuickBooks connection states (not connected / needs reconnecting / first
// sync), filter presets from the path (bank/questions|uncategorized|
// unreconciled) with removable chips, and the deep-link claim for
// question: / txn: / rownote: / view (month, account) from DeepLink.jsx
// (LK_*, loaded earlier). Clients see none of it.

// A local copy of app.jsx UNCATEGORIZED_RE, matched on the category only
// (mapQboToClient puts split_account there). Not BA_UNCAT, which is a null
// category ("not synced yet").
const BA_UNCAT_LIKE_RE = /uncategori[sz]ed|ask my accountant|suspense/i;
const BA_PRESET_LABELS = {
  uncategorized: "Uncategorized",
  questions: "Open questions",
  unreconciled: "Not reconciled",
};
// Fallback toasts live in DeepLink.jsx LK_COPY (TABS-SPEC 1.7).
function BA_lkCopy(key) {
  return LK_COPY[key];
}

function BA_ym(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}
function BA_lastMonthYm() {
  const now = new Date();
  return BA_ym(new Date(now.getFullYear(), now.getMonth() - 1, 1));
}
// "September 2026"
function BA_monthLabel(ym, withYear) {
  const [y, m] = String(ym).split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(
    "en-US",
    withYear === false ? { month: "long" } : { month: "long", year: "numeric" },
  );
}
// "Sep 15"
function BA_shortDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
// Range key for a month: last month reuses the "Last month" chip.
function BA_rangeForMonth(ym) {
  return ym === BA_lastMonthYm() ? "last" : "m:" + ym;
}

// [from, to] inclusive YYYY-MM-DD bounds for a range key, in local time.
// null means unbounded on that side. "m:YYYY-MM" is one calendar month.
function BA_rangeBounds(key) {
  const now = new Date();
  const m = /^m:(\d{4})-(\d{2})$/.exec(String(key || ""));
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]) - 1;
    return [BA_iso(new Date(y, mo, 1)), BA_iso(new Date(y, mo + 1, 0))];
  }
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

// "Last synced 2 hours ago · Synced from QuickBooks monthly, on the 15th".
function BA_syncLine(client) {
  const plan =
    typeof effectivePlan === "function" ? effectivePlan(client) : "standard";
  const cadence =
    typeof syncCadenceLabel === "function"
      ? syncCadenceLabel(plan)
      : "Synced from QuickBooks";
  if (client.dataSource !== "quickbooks") {
    if (client.testOnly === false) return "Not connected to QuickBooks yet · " + cadence.charAt(0).toLowerCase() + cadence.slice(1) + " once connected";
    return "Sample data · " + cadence.charAt(0).toLowerCase() + cadence.slice(1) + " once connected";
  }
  const ago = typeof relTime === "function" ? relTime(client.lastSyncedAt) : null;
  return (ago ? "Last synced " + ago : "Waiting for the first sync") + " · " + cadence;
}

// Staff: "Basic syncs monthly, on the 15th" (STAFF_planCadence, D25).
function BA_staffCadence(client) {
  return STAFF_planCadence(effectivePlan(client));
}

// Staff Sync now (QboSyncNowButton lives in app.jsx).
function BA_SyncNow({ client, canSyncNow }) {
  if (!canSyncNow) return null;
  return <QboSyncNowButton clientId={client.id} canSyncNow isStaff />;
}

// Staff sync line: "Last synced 24 days ago · Basic syncs monthly, on the
// 15th · Sync now". Sample data says so instead of a sync time.
function BA_StaffSyncLine({ client, isQbo, canSyncNow }) {
  const cadence = BA_staffCadence(client);
  const ago = isQbo ? relTime(client.lastSyncedAt) : null;
  const lead = isQbo ? (ago ? "Last synced " + ago : "Waiting for the first sync") : "Sample data";
  return (
    <div className="ba-sync ba-sync-line" data-tour="bank-sync">
      <span>
        {lead} · {cadence}
      </span>
      {/* Sample data too (WP3 acceptance): with no connection the server's
          400 gives the staff toast pointing at Client setup. */}
      <BA_SyncNow client={client} canSyncNow={canSyncNow} />
    </div>
  );
}

// Staff empty states (no synced data): not connected, needs reconnecting,
// first sync. `conn` is this client's qbo_connections row (null = none).
function BA_StaffEmpty({ client, conn, onOpenQuickBooks, canSyncNow }) {
  if (conn === undefined) return <div className="card ba-empty-staff" aria-busy="true" />;
  const status = conn && conn.status;
  let title = "QuickBooks isn't connected yet";
  let body = "Connect this client's QuickBooks to see their bank accounts and transactions here.";
  let button = "Connect QuickBooks";
  let firstSync = false;
  if (status === "error") {
    title = "QuickBooks needs to be reconnected";
    body = "The connection stopped working, so these numbers aren't updating. Reconnect it to start syncing again.";
    button = "Reconnect QuickBooks";
  } else if (status === "connected") {
    title = "Getting the first sync ready";
    body = "Bank accounts will show up here after the first sync finishes.";
    button = null;
    firstSync = true;
  }
  return (
    <div className={"card ba-empty-staff" + (status === "error" ? " is-bad" : "")}>
      <h3 className="card-title">{title}</h3>
      <p className="muted">{body}</p>
      <div className="ba-empty-actions">
        {button && onOpenQuickBooks && (
          <button type="button" className="btn-primary" onClick={onOpenQuickBooks}>
            {button}
          </button>
        )}
        {firstSync && <BA_SyncNow client={client} canSyncNow={canSyncNow} />}
      </div>
    </div>
  );
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

// Staff-only props (TABS WP3): bankPreset ({filter}), onClearPreset,
// onOpenQuickBooks, canSyncNow, onOpenReconciliation (BankReconciliationPage:
// an "unreconciled" link with an account opens its Reconciliation view).
function BA_BankTransactionsPanel({
  client,
  searchTarget,
  isClientUser,
  bankPreset,
  onClearPreset,
  onOpenQuickBooks,
  canSyncNow,
  onOpenReconciliation,
}) {
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
  // Staff extras. presetMonth comes from a deep-link arrival (?month=),
  // the filter from the path (bankPreset); clients ignore both.
  const [presetMonth, setPresetMonth] = React.useState(null);
  const [pendingReveal, setPendingReveal] = React.useState(null); // { key, domId }
  const [activeQuestion, setActiveQuestion] = React.useState(null);
  const [conn, setConn] = React.useState(undefined); // undefined = loading, null = none
  const presetFilter =
    isStaff && bankPreset && BA_PRESET_LABELS[bankPreset.filter] ? bankPreset.filter : null;

  // This client's QuickBooks connection, whatever client.dataSource says:
  // a connection with no synced data never gets mapped, so the panel reads it itself.
  React.useEffect(() => {
    if (!isStaff) return undefined;
    const sb = window.mgbSupabase;
    if (!sb) {
      setConn(null);
      return undefined;
    }
    let alive = true;
    const load = () =>
      Promise.resolve(
        sb
          .from("qbo_connections")
          .select("client_id, status, connected_at, last_synced_at, last_error")
          .eq("client_id", client.id)
          .maybeSingle(),
      ).then(
        (r) => alive && setConn((r && r.data) || null),
        () => alive && setConn(null),
      );
    load();
    window.addEventListener("mgb-qbo-reloaded", load);
    return () => {
      alive = false;
      window.removeEventListener("mgb-qbo-reloaded", load);
    };
  }, [isStaff, client.id]);

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

  // Rows carry `cleared` on sample data only; QuickBooks rows don't yet, so
  // "Not reconciled" falls back to month (+ account) and says so.
  const hasClearedFlag = allRows.some((t) => typeof t.cleared === "boolean");
  const tqByKey = tq.byKey || {};

  // A path preset starts from a clean slate (like a search-result jump);
  // a month from a deep-link arrival is kept.
  React.useEffect(() => {
    if (!presetFilter) return;
    setQuery("");
    setDirection("all");
    setCats([]);
    if (!presetMonth) setRange("all");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetFilter]);

  const rows = React.useMemo(() => {
    const [from, to] = BA_rangeBounds(range);
    const q = query.trim().toLowerCase();
    const catSet = activeCats.length ? new Set(activeCats) : null;
    return allRows.filter((t) => {
      if (selectedId && t.accountId !== selectedId) return false;
      if (presetFilter === "uncategorized" && !BA_UNCAT_LIKE_RE.test(String(t.category || ""))) return false;
      if (presetFilter === "questions" && !(t.txnKey && tqByKey[client.id + "|" + t.txnKey])) return false;
      if (presetFilter === "unreconciled" && hasClearedFlag && t.cleared !== false) return false;
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
  }, [allRows, selectedId, range, direction, query, catsKey, presetFilter, tqByKey, hasClearedFlag]);

  const moneyIn = rows.reduce((s, t) => s + (t.amount > 0 ? t.amount : 0), 0);
  const moneyOut = rows.reduce((s, t) => s + (t.amount < 0 ? t.amount : 0), 0);
  const filtersOn =
    !!presetFilter ||
    !!selectedId ||
    !!query.trim() ||
    range !== "all" ||
    direction !== "all" ||
    activeCats.length > 0;

  // Any filter change starts the list over at the first page.
  React.useEffect(() => {
    setLimit((l) => (pendingJump || pendingReveal ? l : BA_PAGE_SIZE));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, range, direction, query, catsKey, presetFilter]);

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

  // ---- Deep-link arrival (staff): question: / txn: / rownote: / view ------
  // Show one row: select its account, clear the filters (keep an arrival
  // month that contains it), page far enough, then reveal it.
  const revealRow = (t, month) => {
    const idx = allRows
      .filter((x) => x.accountId === t.accountId)
      .findIndex((x) => x.domId === t.domId);
    setSelectedId(t.accountId);
    setQuery("");
    setDirection("all");
    setCats([]);
    if (!(month && String(t.date || "").slice(0, 7) === month)) {
      setPresetMonth(null);
      setRange("all");
    }
    setLimit(Math.max(BA_PAGE_SIZE, idx + 1));
    setPendingReveal({ key: t.txnKey ? "txn:" + t.txnKey : null, domId: t.domId });
  };
  const arriveRef = React.useRef(null);
  arriveRef.current = (a) => {
    if (!isStaff || !a) return;
    const sb = window.mgbSupabase;
    const month = a.month && /^\d{4}-\d{2}$/.test(a.month) ? a.month : null;
    if (month) {
      setPresetMonth(month);
      setRange(BA_rangeForMonth(month));
    }
    if (a.account) {
      const acct = accounts.find((x) => String(x.id) === String(a.account));
      if (!acct) {
        showToast(BA_lkCopy("accountMissing"));
      } else {
        const filt = a.sub && BA_PRESET_LABELS[a.sub] ? a.sub : presetFilter;
        // Pro: a "not reconciled" link opens that account's Reconciliation.
        if (filt === "unreconciled" && typeof onOpenReconciliation === "function") {
          onOpenReconciliation(acct.id);
          return;
        }
        setSelectedId(acct.id);
      }
    }
    if (a.kind === "txn") {
      const t = allRows.find((x) => x.txnKey && x.txnKey === a.id);
      if (t) revealRow(t, month);
      else showToast(BA_lkCopy("txnOutside"));
    } else if (a.kind === "rownote") {
      if (!sb) return;
      Promise.resolve(
        sb
          .from("client_internal_notes")
          .select("id, target_type, target_key")
          .eq("id", a.id)
          .eq("client_id", client.id)
          .is("deleted_at", null)
          .maybeSingle(),
      ).then(
        (r) => {
          const key = r && r.data && r.data.target_key;
          const t = key
            ? allRows.find((x) => `${x.accountName || ""}|${x.date}|${x.description}|${x.amount}` === key)
            : null;
          if (t) revealRow(t, month);
          else showToast(BA_lkCopy("txnOutside"));
        },
        () => showToast(BA_lkCopy("txnOutside")),
      );
    } else if (a.kind === "question") {
      const handle = (q) => {
        if (!q) {
          showToast(BA_lkCopy("qMissing"));
          return;
        }
        const t = q.txn_key ? allRows.find((x) => x.txnKey === q.txn_key) : null;
        // Open or answered (GL Review: a staff question the client answered
        // is still waiting for staff) count as live.
        if (typeof TQ_isActive === "function" ? !TQ_isActive(q) : q.status !== "open") {
          showToast(BA_lkCopy("qAnswered"));
          if (t) revealRow(t, month);
          return;
        }
        if (t) revealRow(t, month);
        else showToast(BA_lkCopy("qOld"));
        setActiveQuestion(q);
      };
      const known = (tq.rows || []).find((q) => String(q.id) === String(a.id));
      if (known) handle(known);
      else if (sb) {
        Promise.resolve(
          sb
            .from("transaction_questions")
            .select(typeof TQ_cols === "function" ? TQ_cols() : TQ_COLS)
            .eq("id", a.id)
            .eq("client_id", client.id)
            .maybeSingle(),
        ).then(
          (r) => handle((r && r.data) || null),
          () => handle(null),
        );
      }
    }
  };
  LK_useArrival(
    { clientId: client.id, tab: "bank", kinds: ["question", "txn", "rownote", "view"], staff: isStaff },
    !tq.loading,
    (a) => arriveRef.current && arriveRef.current(a),
  );
  React.useEffect(() => {
    if (!pendingReveal) return;
    const el =
      (pendingReveal.key && LK_find(pendingReveal.key)) ||
      document.getElementById(pendingReveal.domId);
    if (el) LK_reveal(el, { row: true });
    else jumpToCard(pendingReveal.domId, pendingReveal.domId);
    setPendingReveal(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingReveal, selectedId, limit, range]);

  // Staff notes under the sync line and the filters.
  const todayIso = BA_iso(new Date());
  const viewedYm = presetMonth || (range === "last" ? BA_lastMonthYm() : BA_ym(new Date()));
  const viewedEnd = (() => {
    const [vy, vm] = viewedYm.split("-").map(Number);
    const e = BA_iso(new Date(vy, vm, 0));
    return e < todayIso ? e : todayIso;
  })();
  const lastSyncIso = client.lastSyncedAt || (conn && conn.last_synced_at) || null;
  const lastSyncDay = lastSyncIso && !isNaN(new Date(lastSyncIso).getTime()) ? BA_iso(new Date(lastSyncIso)) : null;
  const showStale = isStaff && isQbo && !!lastSyncDay && lastSyncDay < viewedEnd;
  const showReconnect = isStaff && isQbo && !!conn && conn.status === "error";
  const oldestDate = allRows.length ? allRows[allRows.length - 1].date : null;
  const show90 = isStaff && isQbo && !!presetMonth && !!oldestDate && presetMonth + "-01" < oldestDate;
  // Open questions whose transaction isn't in Bank's list: older than the
  // window, or recent but missing (voided or deleted in QuickBooks). Both are
  // listed under the table so the staffer can still reach them.
  const hiddenQs =
    isStaff && presetFilter === "questions"
      ? (tq.rows || []).filter(
          (q) => (q.status === "open" || q.status === "answered") && !allRows.some((t) => t.txnKey && t.txnKey === q.txn_key),
        )
      : [];
  const isOlderQ = (q) => !oldestDate || (!!q.txn_date && q.txn_date < oldestDate);
  const olderQIds = hiddenQs.filter(isOlderQ).map((q) => q.id);
  const missingQIds = hiddenQs.filter((q) => !isOlderQ(q)).map((q) => q.id);
  const chips = [];
  if (presetFilter) {
    chips.push({ key: "f", label: BA_PRESET_LABELS[presetFilter], onRemove: () => onClearPreset && onClearPreset() });
  }
  if (isStaff && presetMonth) {
    chips.push({
      key: "m",
      label: BA_monthLabel(presetMonth),
      onRemove: () => {
        setPresetMonth(null);
        setRange("all");
      },
    });
  }

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

  // Every hook has run, so these early returns are safe.
  // Staff on a real client with nothing synced: why, and what to do (1.6).
  // Test clients keep their sample data; a synced client with no bank
  // accounts gets the plain card below.
  if (isStaff && !isQbo && client.testOnly === false) {
    return (
      <BA_StaffEmpty client={client} conn={conn} onOpenQuickBooks={onOpenQuickBooks} canSyncNow={canSyncNow} />
    );
  }
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
      {showReconnect && (
        <div className="ba-reconnect" role="alert">
          <span>
            QuickBooks needs to be reconnected. These numbers stopped updating on{" "}
            {BA_shortDate(conn.last_synced_at || client.lastSyncedAt)}.
          </span>
          {onOpenQuickBooks && (
            <button type="button" className="btn-primary" onClick={onOpenQuickBooks}>
              Reconnect QuickBooks
            </button>
          )}
        </div>
      )}
      {isQbo && isClientUser && !isStaff && typeof TQ_ForYouList === "function" && (
        <TQ_ForYouList questions={tq.rows} />
      )}
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
          {isStaff ? (
            <BA_StaffSyncLine client={client} isQbo={isQbo} canSyncNow={canSyncNow} />
          ) : (
            <p className="ba-sync">{BA_syncLine(client)}</p>
          )}
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

        <div className="ba-main">
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
                    onClick={() => {
                      setRange(r.key);
                      setPresetMonth(null);
                    }}
                  >
                    {r.label}
                  </button>
                ))}
                {/^m:/.test(range) && (
                  <button type="button" className="view-toggle-btn active" aria-pressed="true">
                    {BA_monthLabel(range.slice(2))}
                  </button>
                )}
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

            {showStale && (
              <p className="ba-stale-note">
                These numbers stop at {BA_shortDate(lastSyncIso)}. Sync now to see the rest of{" "}
                {BA_monthLabel(viewedYm, false)}.
              </p>
            )}
            {chips.length > 0 && (
              <div className="ba-chips">
                {chips.map((c) => (
                  <span key={c.key} className={"ba-chip" + (c.key === "m" ? " is-month" : "")}>
                    <span className="ba-chip-label">{c.label}</span>
                    <button
                      type="button"
                      className="ba-chip-x"
                      aria-label={"Remove filter: " + c.label}
                      onClick={c.onRemove}
                    >
                      <span aria-hidden="true">×</span>
                    </button>
                  </span>
                ))}
              </div>
            )}
            {presetFilter === "unreconciled" && !hasClearedFlag && (
              <p className="ba-preset-note">Bank can't tell which rows are reconciled. Check them in QuickBooks.</p>
            )}
            {show90 && (
              <p className="ba-preset-note">
                Bank shows the last 90 days. Check QuickBooks for {BA_monthLabel(presetMonth, false)}.
              </p>
            )}

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
                        data-lk={t.txnKey ? "txn:" + t.txnKey : undefined}
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
          {hiddenQs.length > 0 && (
            <div className="ba-older-qs">
              {olderQIds.length > 0 && (
                <p className="ba-preset-note">
                  {olderQIds.length === 1
                    ? "1 more open question is on an older transaction."
                    : `${olderQIds.length} more open questions are on older transactions.`}
                </p>
              )}
              {missingQIds.length > 0 && (
                <p className="ba-preset-note">
                  {missingQIds.length === 1
                    ? "1 open question is on a transaction Bank isn't showing."
                    : `${missingQIds.length} open questions are on transactions Bank isn't showing.`}
                </p>
              )}
              <TQ_OpenList client={client} filterIds={olderQIds.concat(missingQIds)} hideEmpty />
            </div>
          )}
        </div>
      </div>
      {activeQuestion &&
        (!isStaff && activeQuestion.direction === "staff_asked" && activeQuestion.status === "open" ? (
          <TQ_AnswerModal question={activeQuestion} onClose={() => setActiveQuestion(null)} />
        ) : (
          <TQ_ResolveModal
            question={activeQuestion}
            client={client}
            canResolve={isStaff}
            onClose={() => setActiveQuestion(null)}
          />
        ))}
    </div>
  );
}
