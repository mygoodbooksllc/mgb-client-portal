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
const PAST = ymd(new Date(Date.now() - 20 * 86400000));
const FUTURE = ymd(new Date(Date.now() + 20 * 86400000));

const ROWS = {
  connection: {
    client_id: "grace-community",
    status: "connected",
    last_synced_at: "2026-09-22T14:05:00Z",
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
      current_balance: -840.2,
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
    { client_id: "grace-community", qbo_id: "1041", customer_name: "Community Foundation", txn_date: "2026-08-01", due_date: FUTURE, total: 10000, balance: 10000, status: "open" },
    { client_id: "grace-community", qbo_id: "1042", customer_name: "Johnson Family", txn_date: "2026-07-01", due_date: PAST, total: 5000, balance: 5000, status: "overdue" },
    // No due date at all: falls back to txn_date rather than rendering
    // "Invalid Date" in the receivables table.
    { client_id: "grace-community", qbo_id: "1043", customer_name: "Anonymous Pledge", txn_date: "2026-06-15", due_date: null, total: 250, balance: 250, status: "open" },
  ],
  bills: [
    { client_id: "grace-community", qbo_id: "77", vendor_name: "ServiceMaster HVAC", txn_date: "2026-08-10", due_date: FUTURE, total: 640, balance: 640, status: "open" },
    { client_id: "grace-community", qbo_id: "78", vendor_name: "LifeWay Christian Resources", txn_date: "2026-07-20", due_date: PAST, total: 380, balance: 380, status: "overdue" },
  ],
  transactions: [
    { client_id: "grace-community", qbo_id: "5001", txn_type: "Deposit", txn_date: "2026-08-24", account_name: "General Operating 1204", name: "Sunday Giving", memo: "Weekly Giving Deposit", amount: 8420 },
    { client_id: "grace-community", qbo_id: "5002", txn_type: "Expense", txn_date: "2026-08-22", account_name: "General Operating 1204", name: "Gusto", memo: null, amount: -14200 },
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
eq(mapped.lastSyncedAt, "2026-09-22T14:05:00Z", "lastSyncedAt");
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

// --- transactions (the shape BankTransactionsPanel reads) ------------------
const sampleTx = SAMPLE_BANK.bankAccounts[0].transactions[0];
eq(operating.transactions.length, 2, "transactions land on their own account");
hasSampleKeys(operating.transactions[0], sampleTx, "a mapped transaction");
eq(operating.transactions[0].date, "2026-08-24", "transactions sort newest first");
eq(operating.transactions[0].description, "Weekly Giving Deposit", "memo wins for description");
eq(operating.transactions[1].description, "Gusto", "payee name is the fallback description");
eq(operating.transactions[0].category, "Deposit", "category from txn_type");
eq(operating.transactions[0].amount, 8420, "amount");
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

console.log(`mapQboToClient: ${checks} assertions passed.`);
