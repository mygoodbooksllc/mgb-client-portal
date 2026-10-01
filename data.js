// ---------------------------------------------------------------------------
// MOCK DATA ONLY. Nothing here comes from QuickBooks or a real bank feed yet.
// This file is what gets replaced in Phase 2 (QuickBooks) and Phase 3 (bank).
// Sample organizations are churches and nonprofits, since that's this
// bookkeeping practice's primary client base.
//
// As of §133, the org-roster/identity fields (id, name, orgType, plan,
// testOnly, payrollAddOn, assignedBookkeeper) no longer live here — they're
// in Supabase's real `clients` table (supabase/clients-roster.sql), so
// adding a new client org is a database write, not a code change +
// redeploy. What's left in CLIENTS_MOCK_DATA below is `id` (the join key)
// plus all the sample financial/content data (monthly, budget, bank
// accounts, funds, contributions, documents, threads, ...) and the mock
// `users` "Preview As" roster — none of that is real, all of it is still
// mock, and none of it moved. index.html's boot sequence fetches
// the real roster rows from Supabase right after this file loads, spreads
// each one onto the matching CLIENTS_MOCK_DATA entry by `id`, and assigns
// the merged array to window.CLIENTS — which is what app.jsx actually reads
// everywhere via the bare `CLIENTS` identifier. See HANDOFF7.md §133 for the
// full mechanism.
// ---------------------------------------------------------------------------

// Populated by index.html's boot sequence (roster fetched from
// Supabase, merged onto CLIENTS_MOCK_DATA below) before app.jsx runs.
// `window.`-scoped, not `let`/`const`, so every subsequent <script> tag
// unambiguously shares the same binding and can reassign its contents.
window.CLIENTS = [];

// A client org that exists in Supabase's `clients` roster but has no
// CLIENTS_MOCK_DATA entry yet — every newly admin-added org, until Phase 2/3
// wires real financial data in — arrives as roster fields only. Dozens of
// call sites in app.jsx index straight into these arrays (client.monthly[
// client.monthly.length - 1], client.bankAccounts[0].id, client.budget.map),
// so a missing array is an unguarded TypeError thrown during render, which
// the root ErrorBoundary turns into a whole-app "Something went wrong" card.
// Normalizing here — once, at the two places a client object is created —
// keeps every consumer working against the same shape it always has, and
// means an empty-state render rather than a crash.
window.CLIENT_DATA_DEFAULTS = {
  monthly: [],
  budget: [],
  bankAccounts: [],
  funds: [],
  contributions: [],
  pledges: [],
  donors: [],
  payables: [],
  receivables: [],
  documents: [],
  users: [],
  messages: [],
  threads: {},
};

window.withClientDataDefaults = function (client) {
  return Object.assign({}, window.CLIENT_DATA_DEFAULTS, client);
};

// bankAccounts[] holds both money the client has (checking, savings) and
// money they owe on a card. `kind` says which: "cash" | "card". QuickBooks
// accounts get it from mapQboToClient; sample data mostly omits it, so a
// missing kind is cash unless the type says credit card. A card's balance is
// the amount owed (QuickBooks reports it as a positive number) and must never
// be added to cash on hand.
window.mgbIsCardAccount = function (account) {
  if (!account) return false;
  if (account.kind) return account.kind === "card";
  return /credit\s*card/i.test(String(account.type || ""));
};
window.mgbCashAccounts = function (accounts) {
  return (accounts || []).filter(function (a) {
    return !window.mgbIsCardAccount(a);
  });
};
window.mgbCardAccounts = function (accounts) {
  return (accounts || []).filter(window.mgbIsCardAccount);
};

// Budget rows are spending lines. QuickBooks budgets can also carry income
// lines (budgeted giving); mapQboToClient tags each row's accountType and
// this drops the income ones, so "budgeted", "over budget" and budget totals
// never mix giving into spending. Sample rows have no accountType and count
// as expense.
var MGB_INCOME_ACCOUNT_TYPES = { Income: true, "Other Income": true };
window.mgbExpenseBudget = function (budget) {
  return (budget || []).filter(function (b) {
    return !(b && MGB_INCOME_ACCOUNT_TYPES[b.accountType]);
  });
};

// monthly[] for a QuickBooks client ends with the sync month, which is
// month to date (mapQboToClient sets partial: true on it). Sample months are
// all closed. Anything that averages, projects or calls a month "last
// month" uses the closed months only; charts can still show the partial one
// as long as it's labeled.
window.mgbIsPartialMonth = function (m) {
  return Boolean(m && m.partial);
};
window.mgbClosedMonths = function (monthly) {
  return (monthly || []).filter(function (m) {
    return !window.mgbIsPartialMonth(m);
  });
};
// A budget category's spending in the last CLOSED month. A QuickBooks
// budget row's `actual` is month to date (the sync month), so anything that
// multiplies it by 12 reads the real closed-month figure from
// expenseByAccountPrev instead (matched by account name, or the last segment
// of "Parent:Child"). Sample rows' actuals are a full month already.
window.mgbClosedMonthActual = function (client, budgetRow) {
  if (!budgetRow) return 0;
  if (!client || client.dataSource !== "quickbooks") return Number(budgetRow.actual) || 0;
  var prev = client.expenseByAccountPrev || [];
  var name = String(budgetRow.category || "");
  var tail = name.replace(/^.*:/, "");
  for (var i = 0; i < prev.length; i++) {
    if (prev[i].account === name || prev[i].account === tail) return Number(prev[i].amount) || 0;
  }
  return 0;
};

// "Sep 2026" when the year is known (QuickBooks rows), "Sep" otherwise.
window.mgbMonthYearLabel = function (m) {
  if (!m) return "";
  return m.year ? m.month + " " + m.year : m.month;
};
// "Sep 2026 (month to date)" for the partial month.
window.mgbMonthLabel = function (m) {
  if (!m) return "";
  return (
    window.mgbMonthYearLabel(m) +
    (window.mgbIsPartialMonth(m) ? " (month to date)" : "")
  );
};

const CLIENTS_MOCK_DATA = [
  {
    id: "grace-community",
    // Who at this organization can log in, and what each of them may see.
    // Configured by MyGoodBooks only — never editable by the client.
    users: [
      {
        id: "john",
        name: "Pastor John Whitfield",
        role: "Lead Pastor",
        email: "john@gracecommunity.org",
        access: "full",
      },
      {
        id: "rachel",
        name: "Rachel Delgado",
        role: "Kids Ministry Director",
        email: "rachel@gracecommunity.org",
        access: "scoped",
        tabs: ["dashboard", "budget", "documents", "messages"],
        categories: ["Kids Ministry"],
        funds: ["Kids Ministry Fund"],
      },
      {
        id: "tom",
        name: "Tom Reyes",
        role: "Board Treasurer",
        email: "treasurer@gracecommunity.org",
        access: "scoped",
        tabs: ["dashboard", "budget", "reports", "receivables", "messages"],
        categories: null, // all categories — restricted by tab only
        funds: null,
      },
    ],
    // Trailing 12 months, Sep (prior year) through Aug (current) — a full
    // year of history, not a Jan-Dec calendar year, so REPORT_QUARTER_DEFS'
    // Q1-Q4 match whichever single instance of each month name falls in
    // this window (there's never more than one of any given month across
    // 12 consecutive months, so this can't accidentally mix two different
    // years' Julys together).
    monthly: [
      { month: "Sep", income: 48000, expenses: 45200 },
      { month: "Oct", income: 47500, expenses: 45800 },
      { month: "Nov", income: 50200, expenses: 46400 },
      { month: "Dec", income: 68000, expenses: 49500 },
      { month: "Jan", income: 46800, expenses: 46100 },
      { month: "Feb", income: 49500, expenses: 46900 },
      { month: "Mar", income: 52000, expenses: 47800 },
      { month: "Apr", income: 54200, expenses: 48900 },
      { month: "May", income: 58900, expenses: 51200 },
      { month: "Jun", income: 61200, expenses: 53800 },
      { month: "Jul", income: 59800, expenses: 52900 },
      { month: "Aug", income: 63500, expenses: 55100 },
    ],
    budget: [
      { category: "Staff & Pastoral Salaries", budgeted: 28000, actual: 28650 },
      { category: "Facilities & Utilities", budgeted: 8200, actual: 8890 },
      { category: "Kids Ministry", budgeted: 3200, actual: 3540 },
      { category: "Ministry Programs", budgeted: 4500, actual: 3980 },
      { category: "Missions & Outreach", budgeted: 6000, actual: 6000 },
      { category: "Worship & Media", budgeted: 2200, actual: 2410 },
      { category: "Insurance", budgeted: 1800, actual: 1800 },
    ],
    bankAccounts: [
      {
        id: "operating",
        accountName: "General Operating",
        accountMask: "1204",
        type: "Checking",
        balance: 68420.55,
        // Reconciliation Pro only: statementBalance/statementDate reflect the
        // last bank statement, and cleared marks which transactions had
        // posted at the bank by then — everything since is outstanding. The
        // invariant this data keeps: balance == statementBalance + sum of
        // uncleared amounts (so the panel's "Difference" reads $0.00 here).
        statementBalance: 74200.55,
        statementDate: "2026-08-21",
        transactions: [
          { date: "2026-08-24", description: "Weekly Giving Deposit", category: "Giving", amount: 8420.00, cleared: false },
          { date: "2026-08-22", description: "Payroll - Gusto", category: "Payroll", amount: -14200.00, cleared: false },
          { date: "2026-08-20", description: "City Water & Power", category: "Utilities", amount: -1120.40, cleared: true },
          { date: "2026-08-18", description: "Weekly Giving Deposit", category: "Giving", amount: 9180.00, cleared: true },
          { date: "2026-08-15", description: "LifeWay Curriculum Order", category: "Ministry Programs", amount: -340.20, cleared: true },
          { date: "2026-08-14", description: "Kids Church Supplies - Oriental Trading", category: "Kids Ministry", amount: -418.60, cleared: true },
          { date: "2026-08-12", description: "Denominational Assessment", category: "Missions & Outreach", amount: -1500.00, cleared: true },
          { date: "2026-08-11", description: "Weekly Giving Deposit", category: "Giving", amount: 7960.00, cleared: true },
          { date: "2026-08-09", description: "VBS Snacks & Craft Materials", category: "Kids Ministry", amount: -612.35, cleared: true },
          { date: "2026-08-08", description: "Guardian Insurance", category: "Insurance", amount: -1800.00, cleared: true },
          { date: "2026-08-06", description: "Kids Ministry Volunteer Background Checks", category: "Kids Ministry", amount: -245.00, cleared: true },
          { date: "2026-08-03", description: "Nursery Equipment Replacement", category: "Kids Ministry", amount: -389.99, cleared: true },
        ],
      },
      {
        id: "building-fund",
        accountName: "Building Fund Savings",
        accountMask: "5588",
        type: "Savings",
        balance: 142300.00,
        statementBalance: 138300.00,
        statementDate: "2026-08-10",
        transactions: [
          { date: "2026-08-18", description: "Transfer from Operating - Monthly Set-Aside", category: "Transfer In", amount: 4000.00, cleared: false },
          { date: "2026-08-04", description: "Johnson Family - Building Pledge Payment", category: "Giving", amount: 500.00, cleared: true },
          { date: "2026-07-21", description: "Roof Repair - Phase 1 Deposit", category: "Facilities & Utilities", amount: -6200.00, cleared: true },
          { date: "2026-07-18", description: "Transfer from Operating - Monthly Set-Aside", category: "Transfer In", amount: 4000.00, cleared: true },
        ],
      },
      {
        id: "payroll",
        accountName: "Payroll Account",
        accountMask: "3390",
        type: "Checking",
        balance: 6200.00,
        statementBalance: 6200.00,
        statementDate: "2026-08-22",
        transactions: [
          { date: "2026-08-22", description: "Transfer from Operating - Payroll Funding", category: "Transfer In", amount: 14200.00, cleared: true },
          { date: "2026-08-22", description: "Payroll - Gusto Disbursement", category: "Payroll", amount: -14200.00, cleared: true },
          { date: "2026-08-08", description: "Transfer from Operating - Payroll Funding", category: "Transfer In", amount: 6200.00, cleared: true },
        ],
      },
      {
        id: "petty-cash",
        accountName: "Petty Cash Checking",
        accountMask: "7743",
        type: "Checking",
        balance: 850.00,
        statementBalance: 945.40,
        statementDate: "2026-08-12",
        transactions: [
          { date: "2026-08-18", description: "Office Supplies - Staples", category: "Admin & Office", amount: -95.40, cleared: false },
          { date: "2026-08-15", description: "Transfer from Operating - Petty Cash Replenishment", category: "Transfer In", amount: 500.00, cleared: true },
          { date: "2026-08-10", description: "Coffee & Hospitality Supplies", category: "Ministry Programs", amount: -54.60, cleared: true },
          { date: "2026-07-20", description: "Transfer from Operating - Petty Cash Replenishment", category: "Transfer In", amount: 500.00, cleared: true },
        ],
      },
      {
        id: "reserve",
        accountName: "Money Market Reserve",
        accountMask: "9921",
        type: "Money Market",
        balance: 25000.00,
        statementBalance: 25000.00,
        statementDate: "2026-08-01",
        transactions: [
          { date: "2026-07-01", description: "Quarterly Reserve Transfer", category: "Transfer In", amount: 12500.00, cleared: true },
          { date: "2026-04-01", description: "Quarterly Reserve Transfer", category: "Transfer In", amount: 12500.00, cleared: true },
        ],
      },
      {
        // A card: `balance` is the amount OWED, never cash (see
        // window.mgbIsCardAccount). Everything is cleared through the last
        // statement so Reconciliation's "Difference" reads $0.00.
        id: "ministry-card",
        kind: "card",
        accountName: "Ministry Visa",
        accountMask: "4417",
        type: "Credit Card",
        balance: 1284.50,
        statementBalance: 1284.50,
        statementDate: "2026-08-25",
        transactions: [
          { date: "2026-08-21", description: "Amazon - Nursery Supplies", category: "Kids Ministry", amount: -212.40, cleared: true },
          { date: "2026-08-17", description: "Costco - Fellowship Meal", category: "Ministry Programs", amount: -486.10, cleared: true },
          { date: "2026-08-12", description: "Planning Center Subscription", category: "Worship & Media", amount: -186.00, cleared: true },
          { date: "2026-08-05", description: "Card Payment - Thank You", category: "Payment", amount: 950.00, cleared: true },
          { date: "2026-08-02", description: "Youth Retreat Deposit", category: "Ministry Programs", amount: -400.00, cleared: true },
        ],
      },
    ],
    // Reconciliation Pro only: prior periods already closed and signed off,
    // one entry per account per period. The current (unlisted) period is
    // still open, which is what the transactions above reconcile.
    bankReconciliations: [
      { accountId: "operating", period: "July 2026", closedDate: "2026-08-03", closedBy: "MyGoodBooks" },
      { accountId: "building-fund", period: "July 2026", closedDate: "2026-08-03", closedBy: "MyGoodBooks" },
      { accountId: "operating", period: "June 2026", closedDate: "2026-07-02", closedBy: "MyGoodBooks" },
      { accountId: "payroll", period: "July 2026", closedDate: "2026-08-03", closedBy: "MyGoodBooks" },
      { accountId: "petty-cash", period: "July 2026", closedDate: "2026-08-03", closedBy: "MyGoodBooks" },
      { accountId: "reserve", period: "June 2026", closedDate: "2026-07-02", closedBy: "MyGoodBooks" },
    ],
    // INVARIANT: fund balances must sum to net assets (total bank balances
    // minus payables). Restricted funds are carved OUT of the cash already in
    // the accounts, never added on top of it, so the unrestricted General Fund
    // is the balancing figure. Five cash accounts sum to 242,770.55; minus
    // 2,220 payables and 1,284.50 owed on the Ministry Visa = 239,266.05 net
    // assets − 172,650 restricted = 66,616.05.
    funds: [
      { name: "General Fund", restricted: false, balance: 66616.05 },
      { name: "Building Fund", restricted: true, balance: 142300.00 },
      { name: "Missions Fund", restricted: true, balance: 18750.00 },
      { name: "Kids Ministry Fund", restricted: true, balance: 5180.00 },
      { name: "Benevolence Fund", restricted: true, balance: 6420.00 },
    ],
    contributions: [
      { date: "2026-08-24", donor: "The Whitfield Family", fund: "General Fund", method: "Online", amount: 500.00 },
      { date: "2026-08-24", donor: "Anonymous", fund: "General Fund", method: "Cash", amount: 150.00 },
      { date: "2026-08-18", donor: "Robert & Linda Chen", fund: "General Fund", method: "Check", amount: 300.00 },
      { date: "2026-08-18", donor: "Johnson Family", fund: "Building Fund", method: "Check", amount: 500.00 },
      { date: "2026-08-11", donor: "Marcus Reed", fund: "Missions Fund", method: "Online", amount: 200.00 },
      { date: "2026-08-11", donor: "The Alvarez Family", fund: "General Fund", method: "Online", amount: 250.00 },
      { date: "2026-08-09", donor: "The Delgado Family", fund: "Kids Ministry Fund", method: "Online", amount: 300.00 },
      { date: "2026-08-06", donor: "Anonymous", fund: "Kids Ministry Fund", method: "Cash", amount: 75.00 },
      { date: "2026-08-04", donor: "Anonymous", fund: "Benevolence Fund", method: "Cash", amount: 100.00 },
      { date: "2026-08-04", donor: "Susan Patterson", fund: "General Fund", method: "ACH", amount: 400.00 },
    ],
    // Fund Accounting Pro only: an email on file per named donor, backing
    // the Tax Documents view's per-donor and bulk "Send" actions. Deliberately
    // has no entry for "Anonymous" — there's no one to send a receipt to, and
    // the giving statement's per-donor total shouldn't be attributable to a
    // single anonymous contact either.
    donors: [
      { name: "The Whitfield Family", email: "whitfields@gracecommunity-member.org" },
      { name: "Robert & Linda Chen", email: "rlchen@gracecommunity-member.org" },
      { name: "Johnson Family", email: "johnsons@gracecommunity-member.org" },
      { name: "Marcus Reed", email: "mreed@gracecommunity-member.org" },
      { name: "The Alvarez Family", email: "alvarez@gracecommunity-member.org" },
      { name: "The Delgado Family", email: "delgados@gracecommunity-member.org" },
      { name: "Susan Patterson", email: "spatterson@gracecommunity-member.org" },
    ],
    // Fund Accounting Pro only: movement between funds (same dollars as the
    // "Transfer In"/"Transfer from Operating" bank transactions above, told
    // from the fund side instead of the account side) and pledges — money
    // committed but not yet received, separate from the one-off gifts in
    // contributions above.
    fundTransfers: [
      { date: "2026-08-18", fromFund: "General Fund", toFund: "Building Fund", amount: 4000.00, reason: "Monthly building set-aside" },
      { date: "2026-07-18", fromFund: "General Fund", toFund: "Building Fund", amount: 4000.00, reason: "Monthly building set-aside" },
    ],
    pledges: [
      { donor: "Johnson Family", fund: "Building Fund", committed: 10000.00, received: 5000.00, dueDate: "2026-09-15" },
      { donor: "The Whitfield Family", fund: "Building Fund", committed: 3000.00, received: 3000.00, dueDate: "2026-08-01" },
      { donor: "Robert & Linda Chen", fund: "Building Fund", committed: 2500.00, received: 1000.00, dueDate: "2026-10-01" },
    ],
    receivables: [
      { description: "Building Campaign Pledge Balance - Johnson Family", amount: 5000.00, dueDate: "2026-09-15" },
      { description: "Matching Grant - Community Foundation", amount: 10000.00, dueDate: "2026-09-30" },
    ],
    payables: [
      { vendor: "Regional Fellowship Assessment", description: "Annual denominational dues", amount: 1200.00, dueDate: "2026-09-05" },
      { vendor: "ServiceMaster HVAC", description: "Quarterly service contract", amount: 640.00, dueDate: "2026-09-10" },
      { vendor: "LifeWay Christian Resources", description: "Fall curriculum order balance", amount: 380.00, dueDate: "2026-09-12" },
    ],
    // Payroll add-on data (Gusto-synced). The `payrollAddOn` boolean flag
    // that gates whether this org even has the add-on now lives in
    // Supabase's clients table (payroll_add_on column) — this `payroll`
    // object is the separate, still-mock synced content itself, unaffected.
    // See PayrollPage in app.jsx.
    payroll: {
      provider: "Gusto",
      nextRun: { date: "2026-09-19", employeeCount: 6, gross: 21860.00, taxes: 3440.00, net: 18420.00 },
      lastRun: { date: "2026-09-05", net: 14206.00 },
      ytdCost: 132900.00,
      employees: [
        { name: "Marcus Ellery", role: "Lead Pastor", payType: "Salary", status: "active", directDeposit: "enrolled",
          ytdGross: 46750.00, ytdFederalWithholding: 6890.00, ytdStateWithholding: 1870.00, ytdFica: 3576.00, ytdNet: 34414.00 },
        { name: "Dana Whitfield", role: "Office Manager", payType: "Salary", status: "active", directDeposit: "enrolled",
          ytdGross: 28530.00, ytdFederalWithholding: 3410.00, ytdStateWithholding: 1141.00, ytdFica: 2183.00, ytdNet: 21796.00 },
        { name: "Ryan Abboud", role: "Facilities", payType: "Hourly", status: "active", directDeposit: "enrolled",
          ytdGross: 21060.00, ytdFederalWithholding: 2102.00, ytdStateWithholding: 842.00, ytdFica: 1611.00, ytdNet: 16505.00 },
        { name: "Priya Chandrasekar", role: "Children's Ministry", payType: "Hourly", status: "active", directDeposit: "enrolled",
          ytdGross: 18360.00, ytdFederalWithholding: 1652.00, ytdStateWithholding: 734.00, ytdFica: 1405.00, ytdNet: 14569.00 },
        { name: "Grace Nakamura", role: "Nursery Coordinator", payType: "Hourly", status: "active", directDeposit: "enrolled",
          ytdGross: 12200.00, ytdFederalWithholding: 950.00, ytdStateWithholding: 470.00, ytdFica: 933.00, ytdNet: 9847.00 },
        { name: "Tobias Renn", role: "Worship Director", payType: "Salary", status: "onboarding", directDeposit: "pending",
          ytdGross: 6000.00, ytdFederalWithholding: 660.00, ytdStateWithholding: 240.00, ytdFica: 459.00, ytdNet: 4641.00 },
      ],
      taxDeposits: [
        { type: "Federal 941 (income + FICA)", period: "Q3 2026", amount: 9220.00, dueDate: "2026-10-15", status: "upcoming" },
        { type: "State withholding", period: "Sep 2026", amount: 1180.00, dueDate: "2026-10-05", status: "upcoming" },
        { type: "FUTA", period: "Q3 2026", amount: 168.00, dueDate: "2026-10-31", status: "upcoming" },
        { type: "Federal 941 (income + FICA)", period: "Q2 2026", amount: 8940.00, dueDate: "2026-07-15", status: "filed" },
      ],
    },
    // visibility: "all" = everyone at the org with the Documents tab;
    // "full" = full-access users only. Set by MyGoodBooks, never by the client.
    documents: [
      { name: "August Bank Statement - Operating.pdf", category: "Bank Statement", uploadedBy: "MyGoodBooks", date: "2026-08-25", size: "412 KB", visibility: "full" },
      { name: "Property Insurance Policy 2026.pdf", category: "Insurance", uploadedBy: "Pro Test Client", date: "2026-07-02", size: "1.1 MB", visibility: "all" },
      { name: "July Financial Statements.pdf", category: "Financial Statement", uploadedBy: "MyGoodBooks", date: "2026-08-03", size: "268 KB", visibility: "full" },
      { name: "Building Campaign Pledge Log.xlsx", category: "Giving", uploadedBy: "Pro Test Client", date: "2026-08-10", size: "58 KB", visibility: "full" },
    ],
    // One private thread per person, keyed by user id. A staff member only ever
    // sees their own conversation with MyGoodBooks — the treasurer's questions
    // aren't the kids ministry director's business.
    threads: {
      john: [
        { from: "client", author: "Pastor John Whitfield", date: "2026-08-20", text: "Hi! Do we have enough in the building fund to cover the second phase of the roof repair, or should we hold off until next quarter?" },
        { from: "bookkeeper", author: "MyGoodBooks", date: "2026-08-20", text: "Looking at it now — Building Fund is sitting at $142,300 after this month's set-aside, and Phase 1 only used $6,200. You're in good shape to move ahead on Phase 2 whenever the contractor is ready." },
        { from: "client", author: "Pastor John Whitfield", date: "2026-08-21", text: "Perfect, that's what I was hoping to hear. Thank you!" },
      ],
      rachel: [
        { from: "client", author: "Rachel Delgado", date: "2026-08-14", text: "I went a little over on VBS craft supplies this year. Do I need to do anything about that, or will it wash out?" },
        { from: "bookkeeper", author: "MyGoodBooks", date: "2026-08-14", text: "No action needed on your end — I've coded it to Kids Ministry. You're about $340 over for the month, which I'll flag in the summary for Pastor John. Just send me the receipts when you get a chance." },
      ],
      tom: [
        { from: "client", author: "Tom Reyes", date: "2026-08-23", text: "For the board packet — can you confirm the receivables number I should be quoting for the building campaign?" },
      ],
    },
  },

  {
    id: "new-hope",
    users: [
      {
        id: "mia",
        name: "Pastor Mia Ortiz",
        role: "Lead Pastor",
        email: "mia@newhopefellowship.org",
        access: "full",
      },
      {
        id: "kevin",
        name: "Kevin Nakamura",
        role: "Worship Lead",
        email: "kevin@newhopefellowship.org",
        access: "scoped",
        tabs: ["dashboard", "budget", "messages"],
        categories: ["Worship & Media"],
        funds: null,
      },
    ],
    // Trailing 12 months — see grace-community's monthly comment for why
    // Sep-through-Aug (not Jan-Dec) is the right window here.
    monthly: [
      { month: "Sep", income: 8600, expenses: 9200 },
      { month: "Oct", income: 8400, expenses: 9400 },
      { month: "Nov", income: 8800, expenses: 9500 },
      { month: "Dec", income: 12500, expenses: 10200 },
      { month: "Jan", income: 8200, expenses: 9600 },
      { month: "Feb", income: 8700, expenses: 9700 },
      { month: "Mar", income: 9200, expenses: 9800 },
      { month: "Apr", income: 8900, expenses: 10100 },
      { month: "May", income: 11200, expenses: 10500 },
      { month: "Jun", income: 10100, expenses: 10800 },
      { month: "Jul", income: 9800, expenses: 10950 },
      { month: "Aug", income: 9500, expenses: 11200 },
    ],
    budget: [
      { category: "Pastoral Salary", budgeted: 4200, actual: 4200 },
      { category: "Rent (Shared Facility)", budgeted: 2200, actual: 2200 },
      { category: "Worship & Media", budgeted: 800, actual: 1120 },
      { category: "Outreach & Events", budgeted: 900, actual: 1350 },
      { category: "Office & Admin", budgeted: 400, actual: 380 },
      { category: "Insurance", budgeted: 350, actual: 350 },
    ],
    bankAccounts: [
      {
        id: "operating",
        accountName: "Operating Checking",
        accountMask: "3391",
        type: "Checking",
        balance: 4820.30,
        transactions: [
          { date: "2026-08-23", description: "Sunday Giving Deposit", category: "Giving", amount: 2140.00 },
          { date: "2026-08-21", description: "Pastoral Salary", category: "Pastoral Salary", amount: -4200.00 },
          { date: "2026-08-18", description: "Community Center - Rent", category: "Rent", amount: -2200.00 },
          { date: "2026-08-16", description: "Sunday Giving Deposit", category: "Giving", amount: 1980.00 },
          { date: "2026-08-14", description: "Portable Sound Co. - Speaker Repair", category: "Worship & Media", amount: -310.00 },
          { date: "2026-08-09", description: "Sunday Giving Deposit", category: "Giving", amount: 1740.00 },
          { date: "2026-08-06", description: "Fall Launch Event - Supplies", category: "Outreach & Events", amount: -480.00 },
        ],
      },
    ],
    // Sums to net assets: 4,450.30 = 4,820.30 cash − 370 payables.
    funds: [
      { name: "General Fund", restricted: false, balance: 3810.30 },
      { name: "Benevolence Fund", restricted: true, balance: 640.00 },
    ],
    contributions: [
      { date: "2026-08-23", donor: "The Ortiz Family", fund: "General Fund", method: "Online", amount: 200.00 },
      { date: "2026-08-23", donor: "Anonymous", fund: "General Fund", method: "Cash", amount: 60.00 },
      { date: "2026-08-16", donor: "Kevin Nakamura", fund: "General Fund", method: "Online", amount: 150.00 },
      { date: "2026-08-16", donor: "Anonymous", fund: "Benevolence Fund", method: "Cash", amount: 40.00 },
      { date: "2026-08-09", donor: "The Boyd Family", fund: "General Fund", method: "Check", amount: 125.00 },
      { date: "2026-08-09", donor: "Sarah Whitman", fund: "General Fund", method: "Online", amount: 75.00 },
    ],
    receivables: [
      { description: "Launch Team Founding Pledge Balance", amount: 800.00, dueDate: "2026-09-20" },
    ],
    payables: [
      { vendor: "Portable Sound Co.", description: "Equipment lease, monthly", amount: 220.00, dueDate: "2026-09-01" },
      { vendor: "Regional Fellowship Assessment", description: "Church plant assessment", amount: 150.00, dueDate: "2026-09-05" },
    ],
    documents: [
      { name: "August Bank Statement.pdf", category: "Bank Statement", uploadedBy: "MyGoodBooks", date: "2026-08-25", size: "204 KB", visibility: "full" },
      { name: "Facility Use Agreement.pdf", category: "Facilities", uploadedBy: "Plus Test Client", date: "2026-06-15", size: "340 KB", visibility: "all" },
      { name: "July Financial Statements.pdf", category: "Financial Statement", uploadedBy: "MyGoodBooks", date: "2026-08-03", size: "198 KB", visibility: "full" },
    ],
    threads: {
      mia: [
        { from: "client", author: "Pastor Mia Ortiz", date: "2026-08-22", text: "Our checking balance looked lower than usual this week - is that something to worry about?" },
        { from: "bookkeeper", author: "MyGoodBooks", date: "2026-08-22", text: "Good catch, and good instinct to ask. You've run a small deficit the last few months mostly from one-time launch expenses. Nothing alarming yet, but let's talk this week about tightening the outreach budget so it doesn't become a pattern." },
        { from: "client", author: "Pastor Mia Ortiz", date: "2026-08-22", text: "Sounds good, I'll call you tomorrow." },
      ],
      kevin: [
        { from: "client", author: "Kevin Nakamura", date: "2026-08-16", text: "We need to replace a monitor for the sound booth. Is there anything left in the worship & media line this month?" },
        { from: "bookkeeper", author: "MyGoodBooks", date: "2026-08-16", text: "You're already about $210 over budget for the month, so I'd hold off if it can wait until September. If it can't, check with Pastor Mia first." },
      ],
    },
  },
  {
    // Basic plan test client: one login, the barebones tabs only (Dashboard,
    // Reports, Documents, Messages). The other arrays stay filled so a
    // switch to Pro shows real-looking pages straight away.
    id: "basic-test",
    users: [
      {
        id: "ruth",
        name: "Pastor Ruth Allen",
        role: "Pastor",
        email: "ruth@cedarcreekchapel.org",
        access: "full",
      },
    ],
    monthly: [
      { month: "Sep", income: 4100, expenses: 3900 },
      { month: "Oct", income: 3950, expenses: 4050 },
      { month: "Nov", income: 4300, expenses: 4000 },
      { month: "Dec", income: 6200, expenses: 4400 },
      { month: "Jan", income: 3800, expenses: 4100 },
      { month: "Feb", income: 4000, expenses: 3950 },
      { month: "Mar", income: 4250, expenses: 4000 },
      { month: "Apr", income: 4400, expenses: 4150 },
      { month: "May", income: 4150, expenses: 4050 },
      { month: "Jun", income: 3900, expenses: 4200 },
      { month: "Jul", income: 4050, expenses: 4100 },
      { month: "Aug", income: 4300, expenses: 4000 },
    ],
    budget: [
      { category: "Pastor Stipend", budgeted: 2000, actual: 2000 },
      { category: "Building & Utilities", budgeted: 1100, actual: 1180 },
      { category: "Ministry Supplies", budgeted: 400, actual: 320 },
      { category: "Office & Admin", budgeted: 250, actual: 240 },
      { category: "Insurance", budgeted: 260, actual: 260 },
    ],
    bankAccounts: [
      {
        id: "operating",
        accountName: "Operating Checking",
        accountMask: "7710",
        type: "Checking",
        balance: 6240.15,
        transactions: [
          { date: "2026-08-23", description: "Sunday Giving Deposit", category: "Giving", amount: 1010.00 },
          { date: "2026-08-20", description: "Pastor Stipend", category: "Pastor Stipend", amount: -2000.00 },
          { date: "2026-08-16", description: "Sunday Giving Deposit", category: "Giving", amount: 1120.00 },
          { date: "2026-08-12", description: "City Electric", category: "Building & Utilities", amount: -310.00 },
          { date: "2026-08-09", description: "Sunday Giving Deposit", category: "Giving", amount: 980.00 },
        ],
      },
    ],
    funds: [
      { name: "General Fund", restricted: false, balance: 6240.15 },
    ],
    contributions: [
      { date: "2026-08-23", donor: "The Allen Family", fund: "General Fund", method: "Online", amount: 150.00 },
      { date: "2026-08-16", donor: "Anonymous", fund: "General Fund", method: "Cash", amount: 40.00 },
      { date: "2026-08-09", donor: "The Brooks Family", fund: "General Fund", method: "Check", amount: 100.00 },
    ],
    receivables: [],
    payables: [
      { vendor: "City Electric", description: "Monthly electric", amount: 305.00, dueDate: "2026-09-12" },
    ],
    documents: [
      { name: "August Bank Statement.pdf", category: "Bank Statement", uploadedBy: "MyGoodBooks", date: "2026-08-25", size: "96 KB", visibility: "full" },
      { name: "July Financial Statements.pdf", category: "Financial Statement", uploadedBy: "MyGoodBooks", date: "2026-08-03", size: "142 KB", visibility: "full" },
    ],
    threads: {
      ruth: [
        { from: "client", author: "Pastor Ruth Allen", date: "2026-08-19", text: "Did the July statements come through? I want to share them with our deacons on Sunday." },
        { from: "bookkeeper", author: "MyGoodBooks", date: "2026-08-19", text: "They're in Documents now, and under Reports. July closed with a small surplus. Nice month." },
      ],
    },
  },
];

// window.-exposed (not just the top-level const above) since the
// boot-sequence merge step in index.html runs in a separate
// <script> tag and can't rely on top-level `const` scoping across tags —
// same reason window.CLIENTS itself is declared with `window.` up top.
window.CLIENTS_MOCK_DATA_SOURCE = CLIENTS_MOCK_DATA;
