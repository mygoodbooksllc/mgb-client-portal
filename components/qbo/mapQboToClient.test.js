// Plain node, no framework: `node components/qbo/mapQboToClient.test.js`.
// There is no test runner in this repo (no bundler, no package.json build
// step — see index.html's header comment), so this is deliberately a script
// that throws on the first failed assertion and prints a count when it ends.
//
// What it actually guards: that mapQboToClient emits the SAME SHAPES data.js
// documents. That is the whole contract — app.jsx indexes into
// client.monthly[n].income, client.bankAccounts[0].accountMask,
// client.budget[n].budgeted, client.payables[n].dueDate and so on with no
// guards at all, so a renamed field here is an unguarded TypeError in a
// render, which the root ErrorBoundary turns into "Something went wrong" for
// the whole app. Comparing key sets against a real CLIENTS_MOCK_DATA entry
// means the test fails if data.js's shape moves and this mapper doesn't.

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..", "..");

// Both files are browser scripts that hang things off `window`. Run them in
// one context with a stub window — no DOM, no React, nothing else needed.
const sandbox = { window: {}, console };
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, "data.js"), "utf8"), sandbox, {
  filename: "data.js",
});
vm.runInContext(
  fs.readFileSync(path.join(__dirname, "mapQboToClient.js"), "utf8"),
  sandbox,
  { filename: "mapQboToClient.js" },
);

const { mapQboToClient, CLIENTS_MOCK_DATA_SOURCE, withClientDataDefaults } =
  sandbox.window;

let checks = 0;
function ok(cond, what) {
  checks++;
  if (!cond) {
    console.error("FAIL: " + what);
    process.exit(1);
  }
}
function eq(actual, expected, what) {
  ok(
    actual === expected,
    `${what} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}
// Every key the sample object has must exist on the mapped one. Extra keys on
// the mapped side are fine (statementBalance and friends are optional — the
// new-hope sample client has no statementBalance either).
function hasSampleKeys(actual, sample, what) {
  Object.keys(sample).forEach((k) => {
    ok(
      Object.prototype.hasOwnProperty.call(actual, k),
      `${what} is missing data.js's "${k}" (has: ${Object.keys(actual).join(", ")})`,
    );
  });
}

const SAMPLE = CLIENTS_MOCK_DATA_SOURCE.find((c) => c.id === "grace-community");
ok(SAMPLE, "data.js still has the grace-community sample client");
// grace-community's bank accounts carry the Reconciliation Pro extras
// (statementBalance/statementDate/cleared), which are optional — new-hope, the
// other sample client, has none of them, and app.jsx renders it fine. So bank
// shapes are checked against new-hope: that is the REQUIRED shape, and
// requiring reconciliation fields of a QuickBooks account would be asserting
// data QuickBooks' Account entity does not carry.
const SAMPLE_BANK = CLIENTS_MOCK_DATA_SOURCE.find((c) => c.id === "new-hope");
ok(SAMPLE_BANK, "data.js still has the new-hope sample client");

// --- fixtures --------------------------------------------------------------
// Dates are generated relative to today so the budget's current-month rule
// and the receivable/payable overdue split stay meaningful in any month.
const now = new Date();
const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const CURRENT_MONTH = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
const LAST_MONTH = (() => {
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
})();
const SYNCED_AT = new Date(
  now.getFullYear(),
  now.getMonth(),
  now.getDate(),
  12,
).toISOString();
const PAST = ymd(new Date(Date.now() - 20 * 86400000));
const FUTURE = ymd(new Date(Date.now() + 20 * 86400000));

const ROWS = {
  connection: {
    client_id: "grace-community",
    status: "connected",
    // Midday today, local time: the mapper's "current month" follows the
    // sync date, and the fixtures' CURRENT_MONTH follows today.
    last_synced_at: SYNCED_AT,
    last_error: null,
  },
  accounts: [
    {
      client_id: "grace-community",
      qbo_id: "35",
      name: "General Operating 1204",
      account_type: "Bank",
      account_sub_type: "Checking",
      classification: "Asset",
      current_balance: 68420.55,
      currency: "USD",
      active: true,
    },
    {
      client_id: "grace-community",
      qbo_id: "36",
      name: "Building Fund Savings",
      account_type: "Bank",
      account_sub_type: "MoneyMarket",
      classification: "Asset",
      current_balance: 142300,
      currency: "USD",
      active: true,
    },
    {
      client_id: "grace-community",
      qbo_id: "37",
      name: "Ministry Card",
      account_type: "Credit Card",
      account_sub_type: "CreditCard",
      classification: "Liability",
      // QuickBooks reports a card's balance owed as a POSITIVE number.
      current_balance: 840.2,
      currency: "USD",
      active: true,
    },
    // Not a bank account — must not become a "bank account" card.
    {
      client_id: "grace-community",
      qbo_id: "80",
      name: "Facilities & Utilities",
      account_type: "Expense",
      account_sub_type: "Utilities",
      classification: "Expense",
      current_balance: 0,
      currency: "USD",
      active: true,
    },
    // Inactive: filtered out.
    {
      client_id: "grace-community",
      qbo_id: "99",
      name: "Old Checking 0001",
      account_type: "Bank",
      account_sub_type: "Checking",
      classification: "Asset",
      current_balance: 12,
      currency: "USD",
      active: false,
    },
  ],
  monthlyPl: [
    { client_id: "grace-community", month: "2026-08-01", revenue: 63500, expenses: 55100, net: 8400 },
    { client_id: "grace-community", month: "2026-06-01", revenue: 61200, expenses: 53800, net: 7400 },
    { client_id: "grace-community", month: "2026-07-01", revenue: 59800, expenses: 52900, net: 6900 },
  ],
  budgetLines: [
    { client_id: "grace-community", fiscal_year: 2026, month: CURRENT_MONTH, account_name: "Facilities & Utilities", budgeted: 8200, actual: 8890 },
    { client_id: "grace-community", fiscal_year: 2026, month: CURRENT_MONTH, account_name: "Kids Ministry", budgeted: 3200, actual: 3540 },
    // Same account twice in the current month — must aggregate, not duplicate.
    { client_id: "grace-community", fiscal_year: 2026, month: CURRENT_MONTH, account_name: "Kids Ministry", budgeted: 300, actual: 60 },
    // A different month — must be excluded from the current-month view.
    { client_id: "grace-community", fiscal_year: 2026, month: LAST_MONTH, account_name: "Insurance", budgeted: 1800, actual: 1800 },
  ],
  invoices: [
    { client_id: "grace-community", qbo_id: "1041", customer_name: "Community Foundation", doc_number: "1007", txn_date: "2026-08-01", due_date: FUTURE, total: 10000, balance: 10000, status: "open" },
    { client_id: "grace-community", qbo_id: "1042", customer_name: "Johnson Family", txn_date: "2026-07-01", due_date: PAST, total: 5000, balance: 5000, status: "overdue" },
    // No due date at all: falls back to txn_date rather than rendering
    // "Invalid Date" in the receivables table.
    { client_id: "grace-community", qbo_id: "1043", customer_name: "Anonymous Pledge", txn_date: "2026-06-15", due_date: null, total: 250, balance: 250, status: "open" },
  ],
  bills: [
    { client_id: "grace-community", qbo_id: "77", vendor_name: "ServiceMaster HVAC", doc_number: "INV-5521", txn_date: "2026-08-10", due_date: FUTURE, total: 640, balance: 640, status: "open" },
    { client_id: "grace-community", qbo_id: "78", vendor_name: "LifeWay Christian Resources", txn_date: "2026-07-20", due_date: PAST, total: 380, balance: 380, status: "overdue" },
  ],
  transactions: [
    { client_id: "grace-community", qbo_id: "5001", txn_type: "Deposit", txn_date: "2026-08-24", account_name: "General Operating 1204", split_account: "Tithes & Offerings", name: "Sunday Giving", memo: "Weekly Giving Deposit", amount: 8420 },
    { client_id: "grace-community", qbo_id: "5002", txn_type: "Expense", txn_date: "2026-08-22", account_name: "General Operating 1204", split_account: "-Split-", name: "Gusto", memo: null, amount: -14200 },
    { client_id: "grace-community", qbo_id: "5003", txn_type: "Transfer", txn_date: "2026-08-18", account_name: "Building Fund Savings", name: null, memo: "Monthly set-aside", amount: 4000 },
    // Belongs to an account that isn't a bank account — must be dropped
    // rather than dumped onto an arbitrary card.
    { client_id: "grace-community", qbo_id: "5004", txn_type: "Expense", txn_date: "2026-08-20", account_name: "Facilities & Utilities", name: "City Water & Power", memo: null, amount: -1120.4 },
  ],
};

const base = withClientDataDefaults({ id: "grace-community", name: "Grace Community" });
const mapped = mapQboToClient(base, ROWS);

// --- identity / flags ------------------------------------------------------
eq(mapped.id, "grace-community", "client id survives the map");
eq(mapped.name, "Grace Community", "roster fields survive the map");
eq(mapped.dataSource, "quickbooks", "dataSource");
eq(mapped.lastSyncedAt, SYNCED_AT, "lastSyncedAt");
ok(base.dataSource === undefined, "the input client is not mutated");

// --- bankAccounts ----------------------------------------------------------
eq(mapped.bankAccounts.length, 3, "only active Bank/Credit Card accounts map");
hasSampleKeys(mapped.bankAccounts[0], SAMPLE_BANK.bankAccounts[0], "bankAccounts[0]");
const operating = mapped.bankAccounts.find((a) => a.id === "35");
ok(operating, "the operating account is present, keyed by its QuickBooks id");
eq(operating.accountName, "General Operating 1204", "accountName");
eq(operating.accountMask, "1204", "accountMask comes off the trailing digits");
eq(operating.type, "Checking", "type from AccountSubType");
eq(operating.balance, 68420.55, "balance");
eq(
  mapped.bankAccounts.find((a) => a.id === "36").type,
  "Money Market",
  "PascalCase sub-types are spaced to match data.js",
);
eq(
  mapped.bankAccounts.find((a) => a.id === "37").accountMask,
  "",
  "no invented mask when the name has no number",
);
ok(
  !mapped.bankAccounts.some((a) => a.id === "80" || a.id === "99"),
  "expense and inactive accounts are excluded",
);

// --- cash vs. card -----------------------------------------------------------
// A card's balance is money owed, never cash on hand.
const card = mapped.bankAccounts.find((a) => a.id === "37");
eq(card.kind, "card", "Credit Card accounts are kind: card");
eq(card.balance, 840.2, "card balance is the amount owed, as QuickBooks reports it");
eq(operating.kind, "cash", "Bank accounts are kind: cash");
eq(
  mapped.bankAccounts[mapped.bankAccounts.length - 1].id,
  "37",
  "cards sort after cash accounts",
);
const { mgbIsCardAccount, mgbCashAccounts, mgbCardAccounts } = sandbox.window;
eq(
  mgbCashAccounts(mapped.bankAccounts).reduce((s, a) => s + a.balance, 0),
  68420.55 + 142300,
  "cash total excludes the card balance",
);
eq(mgbCardAccounts(mapped.bankAccounts).length, 1, "one card account");
eq(mgbIsCardAccount({ type: "Checking" }), false, "no kind + bank type → cash");
eq(mgbIsCardAccount({ type: "Credit Card" }), true, "no kind + credit card type → card");
eq(mgbIsCardAccount({ kind: "cash", type: "Credit Card" }), false, "explicit kind wins");
ok(
  SAMPLE.bankAccounts.every((a) => !mgbIsCardAccount(a) || a.kind === "card"),
  "sample-data accounts classify without a kind field",
);

// --- transactions (the shape BankTransactionsPanel reads) ------------------
const sampleTx = SAMPLE_BANK.bankAccounts[0].transactions[0];
eq(operating.transactions.length, 2, "transactions land on their own account");
hasSampleKeys(operating.transactions[0], sampleTx, "a mapped transaction");
eq(operating.transactions[0].date, "2026-08-24", "transactions sort newest first");
eq(operating.transactions[0].description, "Weekly Giving Deposit", "memo wins for description");
eq(operating.transactions[1].description, "Gusto", "payee name is the fallback description");
eq(operating.transactions[0].category, "Tithes & Offerings", "category from the split (posting) account");
eq(operating.transactions[0].type, "Deposit", "type from txn_type");
eq(operating.transactions[0].txnKey, "Deposit:5001", "txnKey is txn_type:qbo_id");
eq(operating.transactions[1].category, "Split (several accounts)", "QuickBooks' -Split- marker gets a readable label");
eq(operating.transactions[1].type, "Expense", "type on the split row");
{
  // Before the updated qbo-sync runs, split_account is absent: category is
  // null (pages fall back to the type), never the txn_type in disguise.
  const building = mapped.bankAccounts.find((a) => a.accountName === "Building Fund Savings");
  eq(building.transactions[0].category, null, "no split account -> null category");
  eq(building.transactions[0].type, "Transfer", "type still set without a split account");
  const blank = mapQboToClient(base, {
    ...ROWS,
    transactions: [{ ...ROWS.transactions[0], split_account: "   " }],
  });
  eq(blank.bankAccounts.find((a) => a.id === "35").transactions[0].category, null, "a blank split account is null, not an empty category");
}
eq(operating.transactions[0].amount, 8420, "amount");
// Card register: QuickBooks reports a charge as positive (owed went up).
// Flipped so a charge is money out, like every other register.
{
  const withCard = mapQboToClient(base, {
    ...ROWS,
    transactions: [
      ...ROWS.transactions,
      { client_id: "grace-community", qbo_id: "6001", txn_type: "Credit Card Expense", txn_date: "2026-08-21", account_name: "Ministry Card", name: "Amazon", memo: null, amount: 212.4 },
      { client_id: "grace-community", qbo_id: "6002", txn_type: "Bill Payment (Credit Card)", txn_date: "2026-08-05", account_name: "Ministry Card", name: null, memo: "Card payment", amount: -950 },
      { client_id: "grace-community", qbo_id: "6003", txn_type: "Credit Card Expense", txn_date: "2026-08-04", account_name: "Ministry Card", name: "Zero", memo: null, amount: 0 },
    ],
  });
  const cardTx = withCard.bankAccounts.find((a) => a.id === "37").transactions;
  eq(cardTx[0].amount, -212.4, "a card charge maps as money out (negative)");
  eq(cardTx[1].amount, 950, "a card payment maps as money in (positive)");
  ok(Object.is(cardTx[2].amount, 0), "a zero card row stays +0, not -0");
  eq(withCard.bankAccounts.find((a) => a.id === operating.id).transactions[0].amount, 8420, "bank rows keep their sign");
}
ok(
  !mapped.bankAccounts.some((a) =>
    (a.transactions || []).some((t) => t.description === "City Water & Power"),
  ),
  "a non-bank-account transaction is dropped, not reassigned",
);

// --- monthly ---------------------------------------------------------------
eq(mapped.monthly.length, 3, "one monthly row per synced month");
hasSampleKeys(mapped.monthly[0], SAMPLE.monthly[0], "monthly[0]");
eq(
  mapped.monthly.map((m) => m.month).join(","),
  "Jun,Jul,Aug",
  "monthly is chronological with data.js's three-letter labels",
);
eq(mapped.monthly[2].income, 63500, "revenue maps to income");
eq(mapped.monthly[2].expenses, 55100, "expenses");

// --- budget ----------------------------------------------------------------
eq(mapped.budget.length, 2, "budget collapses to the current month, one row per account");
hasSampleKeys(mapped.budget[0], SAMPLE.budget[0], "budget[0]");
const kids = mapped.budget.find((b) => b.category === "Kids Ministry");
eq(kids.budgeted, 3500, "duplicate account rows in a month are summed");
eq(kids.actual, 3600, "actuals are summed alongside");
ok(
  !mapped.budget.some((b) => b.category === "Insurance"),
  "another month's budget rows are excluded",
);
eq(
  mapQboToClient(base, { ...ROWS, budgetLines: [] }).budget.length,
  0,
  "no budget rows means an empty budget, never the sample one",
);

// --- receivables / payables ------------------------------------------------
eq(mapped.receivables.length, 3, "every open invoice becomes a receivable");
hasSampleKeys(mapped.receivables[0], SAMPLE.receivables[0], "receivables[0]");
eq(mapped.receivables[0].dueDate, "2026-06-15", "a due-date-less invoice falls back to its txn_date");
const johnson = mapped.receivables.find((r) => r.description === "Johnson Family");
eq(johnson.amount, 5000, "receivable amount is the open balance, not the total");
eq(johnson.dueDate, PAST, "the past due date is preserved verbatim for daysUntil()");

eq(mapped.payables.length, 2, "every open bill becomes a payable");
hasSampleKeys(mapped.payables[0], SAMPLE.payables[0], "payables[0]");
const hvac = mapped.payables.find((p) => p.vendor === "ServiceMaster HVAC");
eq(hvac.amount, 640, "payable amount is the open balance");
eq(hvac.dueDate, FUTURE, "payable due date");
eq(hvac.description, "Bill #INV-5521", "a bill shows QuickBooks' DocNumber");
eq(hvac.id, "bill:77", "payables carry a stable id for React keys");
const lifeway = mapped.payables.find((p) => p.vendor === "LifeWay Christian Resources");
eq(lifeway.description, "Bill dated 2026-07-20", "no DocNumber: the bill date, never the internal qbo_id");
eq(lifeway.docNumber, null, "no invented bill number");
const foundation = mapped.receivables.find((r) => r.description === "Community Foundation");
eq(foundation.docNumber, "1007", "invoices carry QuickBooks' DocNumber");
eq(foundation.id, "inv:1041", "receivables carry a stable id");
eq(johnson.docNumber, null, "no DocNumber on older invoice rows");

// Every date the app renders goes through fmtDate/daysUntil, which append
// "T00:00:00" — a non-YYYY-MM-DD value there is an Invalid Date in a
// financial table.
[...mapped.receivables, ...mapped.payables].forEach((r) => {
  ok(/^\d{4}-\d{2}-\d{2}$/.test(r.dueDate), `dueDate "${r.dueDate}" is a bare calendar date`);
});
mapped.bankAccounts.forEach((a) =>
  a.transactions.forEach((t) =>
    ok(/^\d{4}-\d{2}-\d{2}$/.test(t.date), `transaction date "${t.date}" is a bare calendar date`),
  ),
);

// --- the empty case --------------------------------------------------------
// A connected client whose sync found nothing must still produce a renderable
// client (app.jsx indexes into these arrays unguarded).
const empty = mapQboToClient(base, {});
["bankAccounts", "monthly", "budget", "receivables", "payables"].forEach((k) => {
  ok(Array.isArray(empty[k]) && empty[k].length === 0, `${k} is an empty array, not undefined`);
});
eq(empty.lastSyncedAt, null, "lastSyncedAt is null with no connection row");
ok(Array.isArray(empty.expenseByAccount) && empty.expenseByAccount.length === 0, "expenseByAccount is an empty array");

// --- expenses by account (qbo_pl_lines) ------------------------------------
// The Live Report's "Where the money went" card reads this even when the
// company has no QuickBooks budget.
const exp = mapQboToClient(base, {
  plLines: [
    { month: CURRENT_MONTH, account_name: "Rent", account_type: "Expense", amount: "900" },
    { month: CURRENT_MONTH, account_name: "Utilities", account_type: "Expense", amount: 120.5 },
    { month: CURRENT_MONTH, account_name: "Refunds", account_type: "Expense", amount: -40 },
    { month: CURRENT_MONTH, account_name: "Tithes", account_type: "Income", amount: 5000 },
    { month: "2001-01-01", account_name: "Old", account_type: "Expense", amount: 10 },
  ],
});
eq(exp.expenseByAccount.length, 2, "only this month's positive expense accounts");
eq(exp.expenseByAccount[0].account, "Rent", "biggest expense first");
eq(exp.expenseByAccount[1].amount, 120.5, "amounts are numbers");
eq(exp.budget.length, 0, "no budget is invented from P&L lines");

// --- nothing sample survives for data QuickBooks doesn't sync -------------------
const sampled = mapQboToClient(SAMPLE, ROWS);
["contributions", "pledges", "donors", "fundTransfers", "bankReconciliations", "documents"].forEach((k) => {
  ok(Array.isArray(sampled[k]) && sampled[k].length === 0, `${k} is emptied for a QuickBooks client`);
});
// Funds come only from QuickBooks accounts (auto-detected here), never the sample.
const qboNames = new Set(ROWS.accounts.map((a) => a.name));
ok(sampled.funds.every((f) => qboNames.has(f.name)), "funds are QuickBooks accounts, not sample funds");
eq(sampled.payroll, null, "sample payroll is dropped for a QuickBooks client");
ok(sampled.users === SAMPLE.users, "the users roster is kept");

// --- partial month follows the sync date --------------------------------------
eq(mapped.monthly[2].key, "2026-08", "monthly rows carry a YYYY-MM key");
eq(mapped.monthly[2].year, 2026, "monthly rows carry the year");
const partialRun = mapQboToClient(base, {
  connection: { ...ROWS.connection, last_synced_at: "2026-08-15T12:00:00" },
  monthlyPl: ROWS.monthlyPl,
});
eq(partialRun.monthly[2].partial, true, "the sync month is flagged partial");
eq(partialRun.monthly[1].partial, false, "earlier months are closed");
eq(
  sandbox.window.mgbClosedMonths(partialRun.monthly).length,
  2,
  "mgbClosedMonths drops the month to date",
);
eq(sandbox.window.mgbMonthLabel(partialRun.monthly[2]), "Aug 2026 (month to date)", "month-to-date label");
eq(sandbox.window.mgbMonthLabel(partialRun.monthly[1]), "Jul 2026", "closed month label");
const laterSync = mapQboToClient(base, {
  connection: { ...ROWS.connection, last_synced_at: "2026-09-02T12:00:00" },
  monthlyPl: ROWS.monthlyPl,
});
ok(!laterSync.monthly.some((m) => m.partial), "a sync after the month ended leaves every month closed");

// --- budget: expense lines only, plus last month's --------------------------
const typed = mapQboToClient(base, {
  ...ROWS,
  accounts: [
    ...ROWS.accounts,
    { client_id: "grace-community", qbo_id: "90", name: "Tithes", account_type: "Income", classification: "Revenue", current_balance: 0, active: true },
  ],
  budgetLines: [
    ...ROWS.budgetLines,
    { client_id: "grace-community", fiscal_year: 2026, month: CURRENT_MONTH, account_name: "Tithes", budgeted: 50000, actual: 41000 },
    // Matched on the last segment of "Parent:Child".
    { client_id: "grace-community", fiscal_year: 2026, month: CURRENT_MONTH, account_name: "Giving:Tithes", budgeted: 100, actual: 90 },
  ],
});
ok(!typed.budget.some((b) => /Tithes/.test(b.category)), "income budget lines are left out of client.budget");
eq(typed.budgetIncome.length, 2, "income budget lines are kept separately");
eq(typed.budget.length, 2, "expense budget lines are unchanged");
eq(typed.budgetPrev.length, 1, "budgetPrev holds last month's expense lines");
eq(typed.budgetPrev[0].category, "Insurance", "budgetPrev row");
eq(
  sandbox.window.mgbExpenseBudget([{ category: "A", accountType: "Income" }, { category: "B" }]).length,
  1,
  "mgbExpenseBudget drops income rows and keeps untyped ones",
);

// categoryMonthly: per-month actual (P&L lines) beside budgeted (budget
// lines), income typed as income, for custom dashboard cards.
const tithes = typed.categoryMonthly.find((r) => r.category === "Tithes" && r.month === CURRENT_MONTH.slice(0, 7));
ok(tithes, "categoryMonthly has a row for a budget-only income account");
eq(tithes.type, "income", "categoryMonthly types income accounts");
eq(tithes.budgeted, 50000, "categoryMonthly budgeted comes from the budget lines");
ok(
  typed.categoryMonthly.every((r) => /^\d{4}-\d{2}$/.test(r.month) && typeof r.actual === "number"),
  "categoryMonthly rows are keyed YYYY-MM with numeric actuals",
);

// givingQbo: tithes and offerings from the P&L. Automatic detection picks
// income accounts named like giving; a staff pick (client_giving_accounts)
// replaces it; transaction split accounts match on their leaf name.
{
  const { mgbBuildQboGiving } = sandbox.window;
  const pl = [
    { month: "2026-08-01", account_name: "Tithes", account_type: "Income", amount: 1000 },
    { month: "2026-09-01", account_name: "Tithes", account_type: "Income", amount: 1200 },
    { month: "2026-09-01", account_name: "Building Fund Offering", account_type: "Income", amount: 300 },
    { month: "2026-09-01", account_name: "Facility Rental", account_type: "Income", amount: 500 },
    { month: "2026-09-01", account_name: "Gift Shop Supplies", account_type: "Expense", amount: 80 },
  ];
  const tx = [
    { txn_type: "Deposit", txn_date: "2026-09-07", split_account: "Giving:Tithes", name: "", memo: "Sunday", amount: 600 },
    { txn_type: "Deposit", txn_date: "2026-09-08", split_account: "Facility Rental", name: "", memo: "", amount: 500 },
    { txn_type: "Estimate", txn_date: "2026-09-09", split_account: "Tithes", name: "", memo: "", amount: 1 },
    { txn_type: "Expense", txn_date: "2026-09-10", split_account: "Supplies:Tithes", name: "", memo: "", amount: -5 },
  ];
  const auto = mgbBuildQboGiving({ plLines: pl, transactions: tx, monthKeys: ["2026-08", "2026-09"], syncMonthKey: "2026-09" });
  eq(auto.source, "auto", "giving defaults to automatic detection");
  eq(auto.accounts.join("|"), "Building Fund Offering|Tithes", "auto picks income accounts named like giving, not expenses");
  eq(auto.thisMonth, 1500, "giving this month sums the giving accounts only");
  eq(auto.lastMonth, 1000, "giving last month is the last closed month");
  eq(auto.recent.length, 1, "recent giving matches split accounts on the leaf name and skips estimates and expenses");
  const picked = mgbBuildQboGiving({ plLines: pl, transactions: tx, monthKeys: ["2026-08", "2026-09"], syncMonthKey: "2026-09", setting: { account_names: ["Facility Rental"] } });
  eq(picked.source, "staff", "a client_giving_accounts row overrides detection");
  eq(picked.thisMonth, 500, "staff-picked accounts drive the totals");
  const mapped = mapQboToClient(withClientDataDefaults({ id: "x", name: "X" }), { plLines: pl, monthlyPl: [{ month: "2026-09-01", revenue: 2000, expenses: 0 }], connection: { last_synced_at: "2026-09-20T12:00:00Z" } });
  ok(mapped.givingQbo && mapped.givingQbo.accounts.length === 2, "mapQboToClient attaches givingQbo");
}

// fundsQbo: fund balances from qbo_accounts. Auto picks equity/asset
// accounts named like a fund (never Undeposited Funds); a client_fund_accounts
// row replaces it; restricted is guessed from the name unless set.
{
  const { mgbBuildQboFunds, mgbGuessRestricted } = sandbox.window;
  eq(mgbGuessRestricted("Temporarily restricted net assets"), true, "temporarily restricted counts as restricted");
  eq(mgbGuessRestricted("Unrestricted net assets"), false, "unrestricted is not restricted");
  eq(mgbGuessRestricted("Missions Fund"), false, "default is unrestricted");
  const accts = [
    { name: "Restricted - Building Fund", account_type: "Equity", classification: "Equity", current_balance: "25000", active: true },
    { name: "Missions Fund", account_type: "Equity", classification: "Equity", current_balance: 4000, active: true },
    { name: "Undeposited Funds", account_type: "Other Current Asset", classification: "Asset", current_balance: 900, active: true },
    { name: "Checking", account_type: "Bank", classification: "Asset", current_balance: 12000, active: true },
    { name: "Tithes", account_type: "Income", classification: "Revenue", current_balance: 0, active: true },
  ];
  const auto = mgbBuildQboFunds({ accounts: accts });
  eq(auto.source, "auto", "funds default to automatic detection");
  eq(auto.funds.map((f) => f.name).join("|"), "Missions Fund|Restricted - Building Fund", "auto picks fund-named equity/asset accounts, not Undeposited Funds");
  eq(auto.restrictedTotal, 25000, "restricted total");
  eq(auto.unrestrictedTotal, 4000, "unrestricted total");
  eq(auto.candidates.length, 4, "candidates are the balance-sheet accounts only");
  const picked = mgbBuildQboFunds({ accounts: accts, setting: { accounts: [{ name: "Checking", restricted: true }, { name: "Gone", restricted: false }] } });
  eq(picked.source, "staff", "a client_fund_accounts row overrides detection");
  eq(picked.restrictedTotal, 12000, "staff restricted flag wins");
  eq(picked.funds[1].missing, true, "a picked account that no longer syncs is flagged");
  const mapped2 = mapQboToClient(withClientDataDefaults({ id: "x", name: "X" }), { accounts: accts, fundSettings: [{ accounts: [{ name: "Missions Fund", restricted: false }] }] });
  eq(mapped2.funds.length, 1, "mapQboToClient uses the fund pick");
  eq(mapped2.funds[0].balance, 4000, "fund balance is the account's current balance");
}

console.log(`mapQboToClient: ${checks} assertions passed.`);
