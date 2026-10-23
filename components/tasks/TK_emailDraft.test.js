// Plain node: `node components/tasks/TK_emailDraft.test.js`.
// Month rhythm email drafts (E1): the pure builder. Nothing is ever sent.

const assert = require("assert");
const E = require("./TK_emailDraft.js");

let n = 0;
function t(name, fn) {
  try {
    fn();
  } catch (e) {
    console.error("FAIL " + name);
    throw e;
  }
  n++;
}

const FIRM = { parts: [{ key: "check_in", day: 4 }, { key: "reports", day: 14 }, { key: "follow_up", day: 24 }], roll: "next" };
const ACCOUNTS = [
  { name: "Operating Checking", kind: "bank", last_reconciled_date: "2026-08-31" },
  { name: "Savings", kind: "bank", last_reconciled_date: "2026-09-30" },
  { name: "Visa Card", kind: "credit_card", last_reconciled_date: null },
  { name: "Uncategorized Expense", kind: "uncategorized" },
  { name: "Undeposited Funds", kind: "undeposited" },
];
const TXNS = [
  { qbo_id: "1", txn_type: "Expense", txn_date: "2026-09-12", account_name: "Operating Checking", split_account: "Uncategorized Expense", name: "Vendor XYZ", memo: "", amount: -150 },
  { qbo_id: "2", txn_type: "Deposit", txn_date: "2026-09-20", account_name: "Operating Checking", split_account: "Uncategorized Income", name: "", memo: "mobile dep", amount: 2500 },
  { qbo_id: "3", txn_type: "Expense", txn_date: "2026-09-21", account_name: "Operating Checking", split_account: "Office Supplies", name: "Store", amount: -20 },
  { qbo_id: "4", txn_type: "Expense", txn_date: "2026-08-31", account_name: "Ask My Accountant", name: "Old", amount: -5 },
  { qbo_id: "5", txn_type: "Check", txn_date: "2026-09-30", account_name: "Ask My Accountant", name: "Late", amount: -1234567.5 },
];
const REQUESTS = [
  { id: "r1", status: "open", title: "Payroll report for September" },
  { id: "r2", status: "cancelled", title: "Old ask" },
  { id: "r3", status: "open", title: "Legacy one", legacy: true },
  { id: "r4", status: "open", title: "payroll report for september" },
];
const DOCS = [{ status: "open", title: "Loan statement" }, { status: "done", title: "Done doc" }];

t("kind and period: only the three kinds; month tasks only", () => {
  assert.strictEqual(E.TK_emailKindOf({ email_kind: "request" }), "request");
  assert.strictEqual(E.TK_emailKindOf({ email_kind: "other" }), null);
  assert.strictEqual(E.TK_emailKindOf(null), null);
  assert.strictEqual(E.TK_emailPeriodOf({ period_kind: "month", period_start: "2026-09-01" }), "2026-09-01");
  assert.strictEqual(E.TK_emailPeriodOf({ period_kind: "quarter", period_start: "2026-07-01" }), null);
});

t("client dates: part day plus one; reply-by five days before reports", () => {
  assert.deepStrictEqual(E.TK_emailClientDays(FIRM), { reports: "15th", replyBy: "10th", next: "5th" });
  assert.deepStrictEqual(E.TK_emailClientDays(null), { reports: "15th", replyBy: "10th", next: "5th" });
  const own = { parts: [{ key: "check_in", day: 1 }, { key: "reports", day: 10 }, { key: "follow_up", day: 20 }] };
  assert.deepStrictEqual(E.TK_emailClientDays(own), { reports: "11th", replyBy: "6th", next: "2nd" });
  const tight = { parts: [{ key: "check_in", day: 5 }, { key: "reports", day: 8 }, { key: "follow_up", day: 20 }] };
  assert.strictEqual(E.TK_emailClientDays(tight).replyBy, "8th", "falls back to the day before the client date");
  const ord = { parts: [{ key: "check_in", day: 20 }, { key: "reports", day: 21 }, { key: "follow_up", day: 22 }] };
  assert.strictEqual(E.TK_emailClientDays(ord).reports, "22nd");
  assert.strictEqual(E.TK_emailClientDays(ord).next, "21st");
});

t("missing statements: bank and card not reconciled through month end, sorted", () => {
  assert.deepStrictEqual(E.TK_emailMissingStatements(ACCOUNTS, "2026-09-01"), [
    "Operating Checking - September 2026 Statement",
    "Visa Card - September 2026 Statement",
  ]);
  assert.deepStrictEqual(E.TK_emailMissingStatements(ACCOUNTS, "2026-08-01"), ["Visa Card - August 2026 Statement"]);
  assert.deepStrictEqual(E.TK_emailMissingStatements(null, "2026-09-01"), []);
});

t("month ends: February, leap February, 30 and 31 day months", () => {
  const a = [{ name: "B", kind: "bank", last_reconciled_date: "2026-02-28" }];
  assert.deepStrictEqual(E.TK_emailMissingStatements(a, "2026-02-01"), []);
  const leap = [{ name: "B", kind: "bank", last_reconciled_date: "2028-02-28" }];
  assert.strictEqual(E.TK_emailMissingStatements(leap, "2028-02-01").length, 1, "29 Feb 2028 is the month end");
  assert.deepStrictEqual(E.TK_emailMissingStatements([{ name: "B", kind: "bank", last_reconciled_date: "2026-04-30" }], "2026-04-01"), []);
  assert.strictEqual(E.TK_emailMissingStatements([{ name: "B", kind: "bank", last_reconciled_date: "2026-10-30" }], "2026-10-01").length, 1);
});

t("clarifications: holding accounts in the month; debit vs deposit wording", () => {
  const lines = E.TK_emailClarifications(TXNS, "2026-09-01", ["Uncategorized Expense"]);
  assert.deepStrictEqual(lines, [
    'Debit on 09/12/2026 for $150.00 to "Vendor XYZ" – What was the business purpose?',
    'Uncategorized deposit on 09/20/2026 for $2,500.00 (memo: "mobile dep") – Please confirm source of funds.',
    'Debit on 09/30/2026 for $1,234,567.50 to "Late" – What was the business purpose?',
  ]);
  assert.ok(E.TK_emailIsUncategorized("Ask My Accountant"));
  assert.ok(E.TK_emailIsUncategorized("Custom Holding", ["custom holding"]));
  assert.ok(!E.TK_emailIsUncategorized("Office Supplies", []));
});

t("open requests: open only, no legacy, deduped by title, docs after asks", () => {
  assert.deepStrictEqual(E.TK_emailOpenRequests(REQUESTS, DOCS), ["Payroll report for September", "Loan statement"]);
});

t("report option: state wins, then close check, else none", () => {
  assert.strictEqual(E.TK_emailReportOption({ state: "full" }, { status: "behind" }), "A");
  assert.strictEqual(E.TK_emailReportOption({ state: "preliminary" }, { status: "ready" }), "B");
  assert.strictEqual(E.TK_emailReportOption(null, { status: "ready" }), "A");
  assert.strictEqual(E.TK_emailReportOption(null, { status: "blocked" }), "B");
  assert.strictEqual(E.TK_emailReportOption({ state: "none" }, { status: "no_data" }), null);
});

const BASE = {
  period: "2026-09-01",
  clientName: "Grace Church",
  rhythm: FIRM,
  signerName: "Pat Doe",
  accounts: ACCOUNTS,
  uncategorizedNames: ["Uncategorized Expense"],
  transactions: TXNS,
  requests: REQUESTS,
  docRequests: DOCS,
};

t("email 1: subject, dates, both lists, signature", () => {
  const d = E.TK_emailDraftBuild(Object.assign({ kind: "request", accountManager: "Account Manager" }, BASE));
  assert.strictEqual(d.subject, "Monthly Bookkeeping Update & Request for Information – Grace Church – September 2026");
  assert.ok(d.body.indexOf("Hi Grace Church,") === 0);
  assert.ok(d.body.indexOf("financial reports by the 15th of this month") > 0);
  assert.ok(d.body.indexOf("responses by the 10th of this month") > 0);
  assert.ok(d.body.indexOf("  - Visa Card - September 2026 Statement") > 0);
  assert.ok(d.body.indexOf("  - Loan statement") > 0);
  assert.ok(d.body.indexOf('to "Vendor XYZ"') > 0);
  assert.ok(/Thank you,\n\nPat Doe\nMyGoodBooks$/.test(d.body));
  assert.strictEqual(d.cc, "Account Manager");
  assert.deepStrictEqual(d.counts, { statements: 4, clarifications: 3 });
});

t("email 1 empty: headings stay with None this month; greeting name wins", () => {
  const d = E.TK_emailDraftBuild({ kind: "request", period: "2026-09-01", clientName: "Grace Church", greetingName: "Grace team" });
  assert.ok(d.body.indexOf("Hi Grace team,") === 0);
  assert.strictEqual(d.body.split("None this month.").length - 1, 2);
  assert.ok(/MyGoodBooks$/.test(d.body));
  assert.strictEqual(d.cc, null);
});

t("January sends December of the year before", () => {
  const d = E.TK_emailDraftBuild({ kind: "request", period: "2025-12-01", clientName: "X" });
  assert.ok(d.subject.indexOf("December 2025") > 0);
});

t("long lists stop at the cap with an and-more line", () => {
  const many = [];
  for (let i = 0; i < 55; i++) many.push({ name: "Bank " + String(i).padStart(2, "0"), kind: "bank", last_reconciled_date: null });
  const d = E.TK_emailDraftBuild({ kind: "request", period: "2026-09-01", clientName: "X", accounts: many });
  assert.ok(d.body.indexOf("  - and 15 more (see QuickBooks)") > 0);
  assert.ok(d.body.indexOf("Bank 39") > 0 && d.body.indexOf("Bank 40") < 0);
});

t("email 2: preliminary state picks B and lists its missing items", () => {
  const d = E.TK_emailDraftBuild(Object.assign({ kind: "reports", reportState: { state: "preliminary", missing: [{ label: "Operating statement" }] }, closeCheck: { status: "ready" } }, BASE));
  assert.strictEqual(d.option, "B");
  assert.strictEqual(d.subject, "Financial Reports for Grace Church – September 2026");
  assert.ok(d.body.indexOf("Please note: These reports are preliminary") > 0);
  assert.ok(d.body.indexOf("All accounts have been fully reconciled") < 0);
  assert.ok(d.body.indexOf("  - Operating statement") > 0);
  assert.ok(d.body.indexOf("[Google Drive link]") > 0);
});

t("email 2: full picks A with no pending items; no_data leaves both", () => {
  const a = E.TK_emailDraftBuild(Object.assign({ kind: "reports", reportState: { state: "full" } }, BASE));
  assert.strictEqual(a.option, "A");
  assert.ok(a.body.indexOf("Pending Items (if applicable):\n  - None this month.") > 0);
  const none = E.TK_emailDraftBuild(Object.assign({ kind: "reports", closeCheck: { status: "no_data" } }, BASE));
  assert.strictEqual(none.option, null);
  assert.ok(none.body.indexOf("[Choose one and delete the other]") > 0);
  assert.ok(none.body.indexOf("fully reconciled") > 0 && none.body.indexOf("preliminary") > 0);
  const behind = E.TK_emailDraftBuild(Object.assign({ kind: "reports", closeCheck: { status: "behind", reasons: ["Visa Card not reconciled"] } }, BASE));
  assert.strictEqual(behind.option, "B");
  assert.ok(behind.body.indexOf("  - Visa Card not reconciled\n  - Payroll report for September\n  - Loan statement") > 0);
});

t("email 3: follow-up section first, then the maintenance update", () => {
  const d = E.TK_emailDraftBuild(Object.assign({ kind: "maintenance" }, BASE));
  assert.strictEqual(d.subject, "Mid-Month Account Maintenance & Bank Connection Status – Grace Church");
  const a = d.body.indexOf("Still Needed:");
  const b = d.body.indexOf("We completed our mid-month check");
  assert.ok(a > 0 && b > a);
  assert.ok(d.body.indexOf("by the 5th of next month") > 0);
  assert.ok(d.body.indexOf("Bank Connection Status:") > 0 && d.body.indexOf("Additional Notes / Issues (if applicable):") > 0);
  const clean = E.TK_emailDraftBuild({ kind: "maintenance", period: "2026-09-01", clientName: "X" });
  assert.ok(clean.body.indexOf("Still Needed:") < 0, "nothing outstanding: no follow-up section");
  const prelim = E.TK_emailDraftBuild(Object.assign({ kind: "maintenance", reportState: { state: "preliminary", missing: [{ label: "Card statement" }] } }, BASE));
  assert.ok(prelim.body.indexOf("  - Card statement") > 0 && prelim.body.indexOf("Loan statement") < 0, "report state wins");
});

t("bad input: no kind or no period gives null; copy text joins subject and body", () => {
  assert.strictEqual(E.TK_emailDraftBuild({ kind: "x", period: "2026-09-01" }), null);
  assert.strictEqual(E.TK_emailDraftBuild({ kind: "request" }), null);
  assert.strictEqual(E.TK_emailCopyText({ subject: "S", body: "B" }), "Subject: S\n\nB");
  assert.strictEqual(E.TK_emailCopyText(null), "");
});

// ---- E2: Emails due chip and wiring (UI itself needs a signed-in browser)
const V = require("./TK_viewLogic.js");
const fs = require("fs");
const path = require("path");
const read = (p) => fs.readFileSync(path.join(__dirname, "../..", p), "utf8");

t("emails due chip: mine, open, an email template, due by today", () => {
  const ctx = { email: "me@x.com", today: "2026-10-23", emailTemplates: { tplA: "request" } };
  const base = { assignee_email: "ME@x.com", template_id: "tplA", status: "todo", due_date: "2026-10-23" };
  assert.ok(V.TK_slateChipMatch(base, "emails_due", ctx));
  assert.ok(!V.TK_slateChipMatch(Object.assign({}, base, { due_date: "2026-10-24" }), "emails_due", ctx), "not yet due");
  assert.ok(!V.TK_slateChipMatch(Object.assign({}, base, { template_id: "other" }), "emails_due", ctx), "not an email task");
  assert.ok(!V.TK_slateChipMatch(Object.assign({}, base, { assignee_email: "you@x.com" }), "emails_due", ctx), "someone else's");
  assert.ok(!V.TK_slateChipMatch(Object.assign({}, base, { status: "done" }), "emails_due", ctx), "done");
  const list = [base, Object.assign({}, base, { template_id: null })];
  assert.strictEqual(V.TK_slateApplyChip(list, "emails_due", ctx).length, 1);
  assert.strictEqual(V.TK_slateApplyChip(list, "emails_due", { email: "me@x.com", today: "2026-10-23" }), list, "rhythm off: the chip does nothing");
  assert.strictEqual(V.TK_normalizeSlateView({ chip: "emails_due" }).chip, "emails_due");
});

t("wiring: gated on the rhythm, nothing is sent, registered in load order", () => {
  const ui = read("components/tasks/TK_EmailDraft.jsx");
  assert.ok(ui.indexOf("TK_rhythmEnabled()") > 0, "gated on the rhythm preview");
  assert.ok(!/sendEmail|functions\.invoke|\.rpc\(/.test(ui), "the draft UI never calls a send path");
  const api = read("components/tasks/TK_api.js");
  const i = api.indexOf("api.emailDraftData = function");
  assert.ok(i > 0);
  const body = api.slice(i, api.indexOf("api.emailTemplates = function"));
  assert.ok(!/\.insert\(|\.update\(|\.upsert\(|rpcWrite|functions\.invoke/.test(body), "draft data is read only");
  const idx = read("index.html");
  assert.ok(idx.indexOf('"components/tasks/TK_rhythmLogic.js",\n        "components/tasks/TK_emailDraft.js"') > 0);
  assert.ok(idx.indexOf('"components/tasks/TK_EmailDraft.jsx",\n        "components/tasks/TK_TaskRow.jsx"') > 0);
  assert.ok(read("components/tasks/TK_DrawerContent.jsx").indexOf("<TK_EmailDraftButton task={task} />") > 0);
  assert.ok(read("components/tasks/TK_TaskRow.jsx").indexOf("<TK_EmailDraftButton task={task} compact={true} />") > 0);
  assert.ok(read("components/tasks/TK_MyTasks.jsx").indexOf("!c.rhythm || rhythmChips") > 0, "chip hidden with the rhythm off");
});

console.log("TK_emailDraft: " + n + " tests passed");
