// node --test 'tests/ledger/*.test.js'
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../../components/ledger/GLR_parse.js");
const K = require("../../components/ledger/GLR_checks.js");
const { sampleRows } = require("./fixtures/sampleChurch.js");
const { ACCTS: A, ledger } = require("./fixtures/api.js");

const sample = () => P.parseGL(sampleRows()).lines;
const types = (res) => res.flags.map((f) => f.flag_type);
const ofType = (res, t) => res.flags.filter((f) => f.flag_type === t);

test("sample church: raw counts match the prototype README", () => {
  const res = K.runChecks(sample(), { dedupe: false, watchVendors: [] });
  // swing (phase 2, not in the prototype): 6520 Building Repairs drops to $0 in the last month
  assert.deepEqual(K.countByType(res.flags), {
    suspense: 2, dup: 2, obe: 1, large: 1, gap: 1, jecash: 1, swing: 1, weekend: 10, round: 6, blank: 2,
  });
});

test("sample church: deduped to one flag per transaction per type", () => {
  const res = K.runChecks(sample(), { watchVendors: [] });
  assert.deepEqual(K.countByType(res.flags), {
    suspense: 2, dup: 1, obe: 1, large: 1, gap: 1, jecash: 1, swing: 1, weekend: 5, round: 3, blank: 1,
  });
  // the category side is shown for transaction checks, the bank side for bank checks
  const wk = ofType(res, "weekend").map((f) => f.account_name);
  assert.ok(wk.every((a) => a !== "1010 Operating Checking"));
  assert.equal(ofType(res, "jecash")[0].account_name, "1010 Operating Checking");
  assert.equal(ofType(res, "weekend").find((f) => f.txn_date === "2026-09-13").line_count, 2);
  const gap = ofType(res, "gap")[0];
  assert.equal(gap.why, "Checks #2223–2224 are missing.");
  assert.equal(gap.txn_key, "chk:n~1010 operating checking:2225");
  assert.equal(ofType(res, "large")[0].txn_date, "2026-08-23");
  // severity order, newest first inside a severity
  const sev = res.flags.map((f) => f.severity);
  assert.deepEqual(sev, [...sev].sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a] - { high: 0, medium: 1, low: 2 }[b])));
  assert.equal(res.flags[0].flag_type, "suspense");
  assert.equal(res.flags[0].txn_date, "2026-07-12");
  // every flag has a unique id and the gl_review_flags fields
  assert.equal(new Set(res.flags.map((f) => f.id)).size, res.flags.length);
  for (const f of res.flags) {
    assert.match(f.period, /^\d{4}-\d{2}-01$/);
    assert.equal(f.checks_version, 1);
    assert.ok(f.txn_key.length <= 200);
  }
});

test("sample counts don't depend on the machine's time zone", () => {
  const { execFileSync } = require("node:child_process");
  const code = `const P=require(${JSON.stringify(require.resolve("../../components/ledger/GLR_parse.js"))});` +
    `const K=require(${JSON.stringify(require.resolve("../../components/ledger/GLR_checks.js"))});` +
    `const {sampleRows}=require(${JSON.stringify(require.resolve("./fixtures/sampleChurch.js"))});` +
    `process.stdout.write(JSON.stringify(K.countByType(K.runChecks(P.parseGL(sampleRows()).lines,{watchVendors:[]}).flags)))`;
  const outs = ["UTC", "America/Chicago", "Pacific/Auckland", "America/Los_Angeles"].map((tz) =>
    execFileSync(process.execPath, ["-e", code], { env: { ...process.env, TZ: tz } }).toString());
  assert.equal(new Set(outs).size, 1);
});

test("suspense: Ask My Accountant, Ask Client, Uncategorized; not regular accounts", () => {
  const L = ledger();
  L.pay("2026-09-02", "Amazon", "x", A.AMA, 20);
  L.pay("2026-09-03", "Walmart", "y", { acct: "Ask Client", acct_id: "207", acct_type: "Expense" }, 30);
  L.pay("2026-09-04", "Kroger", "z", A.UNC, 40);
  L.pay("2026-09-05", "Lifeway", "Curriculum", A.SUP, 50);
  const res = K.runChecks(L.lines(), { watchVendors: [] });
  assert.equal(ofType(res, "suspense").length, 3);
  assert.ok(!ofType(res, "suspense").some((f) => f.name === "Lifeway"));
  // API flags keep the '<type>:<id>' key and are askable
  assert.equal(ofType(res, "suspense")[0].txn_key, "Expense:3");
  assert.equal(ofType(res, "suspense")[0].askable, true);
});

test("obe: activity in Opening Balance Equity", () => {
  const L = ledger();
  L.txn("2026-09-02", "Journal Entry", "", "Reclass", [[A.OBE, -100], [A.SUP, 100]]);
  const res = K.runChecks(L.lines(), { watchVendors: [] });
  assert.equal(ofType(res, "obe").length, 1);
  const L2 = ledger();
  L2.txn("2026-09-02", "Journal Entry", "", "Reclass", [[A.OFF, -100], [A.SUP, 100]]);
  assert.equal(ofType(K.runChecks(L2.lines(), { watchVendors: [] }), "obe").length, 0);
});

test("dup: same date, name, amount and account on another transaction", () => {
  const L = ledger();
  L.pay("2026-09-02", "Staples", "Paper", A.OFF, 45.5);
  L.pay("2026-09-02", "Staples", "Paper", A.OFF, 45.5);
  L.pay("2026-09-03", "Staples", "Paper", A.OFF, 45.5); // other day
  L.pay("2026-09-02", "Staples", "Toner", A.OFF, 45.51); // other amount
  const res = K.runChecks(L.lines(), { watchVendors: [] });
  const d = ofType(res, "dup");
  assert.equal(d.length, 1);
  assert.equal(d[0].txn_key, "Expense:2");
  assert.equal(d[0].account_name, A.OFF.acct);
  assert.match(d[0].why, /Expense|another entry/);
  // the two lines of one transaction never match each other
  const L2 = ledger();
  L2.txn("2026-09-02", "Transfer", "", "move", [[A.CK, -100], [A.CK, 100]]);
  L2.txn("2026-09-02", "Transfer", "", "move", [[A.SAV, 100], [A.SAV, 100]], { id: "x" });
  assert.equal(ofType(K.runChecks(L2.lines(), { watchVendors: [] }), "dup").length, 0);
});

test("negbank: first line of each negative streak on a bank account", () => {
  const L = ledger();
  [["2026-09-01", 50], ["2026-09-02", -20], ["2026-09-03", -40], ["2026-09-04", 10], ["2026-09-05", -5]].forEach(([d, bal], i) =>
    L.txn(d, "Expense", "V" + i, "m", [[A.CK, -1, { bal }], [A.SUP, 1]]));
  L.txn("2026-09-02", "Expense", "Card", "m", [[A.CARD, -1, { bal: -500 }], [A.SUP, 1]]);
  const res = K.runChecks(L.lines(), { watchVendors: [] });
  const n = ofType(res, "negbank");
  assert.deepEqual(n.map((f) => f.txn_key).sort(), ["neg:35:2026-09-02", "neg:35:2026-09-05"]);
  assert.ok(n.every((f) => f.askable === false));
});

test("negbank: walks the register by seq when every line has one", () => {
  // Same-day lines arrive out of register order; seq puts them back.
  const L = ledger();
  L.txn("2026-09-02", "Expense", "B", "m", [[A.CK, -1, { bal: -30, seq: 2 }], [A.SUP, 1]]);
  L.txn("2026-09-02", "Expense", "A", "m", [[A.CK, -1, { bal: -10, seq: 1 }], [A.SUP, 1]]);
  L.txn("2026-09-03", "Deposit", "C", "m", [[A.CK, 1, { bal: 20, seq: 3 }], [A.TITHE, -1]]);
  const n = ofType(K.runChecks(L.lines(), { watchVendors: [] }), "negbank");
  assert.equal(n.length, 1);
  assert.equal(n[0].name, "A");
  // Without seq the arrival order wins (B first).
  const L2 = ledger();
  L2.txn("2026-09-02", "Expense", "B", "m", [[A.CK, -1, { bal: -30 }], [A.SUP, 1]]);
  L2.txn("2026-09-02", "Expense", "A", "m", [[A.CK, -1, { bal: -10 }], [A.SUP, 1]]);
  assert.equal(ofType(K.runChecks(L2.lines(), { watchVendors: [] }), "negbank")[0].name, "B");
});

test("jecash: journal entry to a bank account, shown on the bank side", () => {
  const L = ledger();
  L.txn("2026-09-02", "Journal Entry", "", "fix", [[A.SUP, 75], [A.CK, -75]]);
  L.txn("2026-09-03", "Journal Entry", "", "reclass", [[A.SUP, 75], [A.OFF, -75]]);
  const j = ofType(K.runChecks(L.lines(), { watchVendors: [] }), "jecash");
  assert.equal(j.length, 1);
  assert.equal(j[0].account_name, A.CK.acct);
  assert.equal(j[0].txn_key, "JournalEntry:1");
});

test("gap: missing check numbers between 2 and 25 apart", () => {
  const L = ledger();
  [101, 102, 104, 108].forEach((num, i) => L.pay("2026-09-0" + (i + 1), "V", "m", A.SUP, 10, A.CK, { type: "Check", num: String(num) }));
  [500, 540].forEach((num, i) => L.pay("2026-09-1" + i, "V", "m", A.SUP, 10, A.SAV, { type: "Check", num: String(num) }));
  const g = ofType(K.runChecks(L.lines(), { watchVendors: [] }), "gap");
  assert.deepEqual(g.map((f) => f.why).sort(), ["Check #103 is missing.", "Checks #105–107 are missing."]);
  assert.deepEqual(g.map((f) => f.txn_key).sort(), ["chk:35:104", "chk:35:108"]);
});

test("large: robust outlier per account, $500 minimum", () => {
  const L = ledger();
  for (let i = 1; i <= 10; i++) L.pay("2026-08-" + String(i).padStart(2, "0"), "Lifeway", "c", A.SUP, 100 + i);
  L.pay("2026-09-02", "Lifeway", "VBS", A.SUP, 2000);
  const res = K.runChecks(L.lines(), { watchVendors: [] });
  const lg = ofType(res, "large");
  assert.equal(lg.length, 1);
  assert.equal(lg[0].amount, 2000);
  assert.equal(lg[0].account_name, A.SUP.acct);
  const L2 = ledger();
  for (let i = 1; i <= 10; i++) L2.pay("2026-08-" + String(i).padStart(2, "0"), "Lifeway", "c", A.SUP, 50);
  L2.pay("2026-09-02", "Lifeway", "VBS", A.SUP, 450); // 9x the median but under $500
  assert.equal(ofType(K.runChecks(L2.lines(), { watchVendors: [] }), "large").length, 0);
});

test("round: even hundreds of $1,000+, not deposits, payroll or recurring", () => {
  const L = ledger();
  L.pay("2026-09-01", "Roof Pros", "deposit", A.REP, 1500);
  L.pay("2026-09-02", "Roof Pros", "deposit", A.REP, 1550);
  L.txn("2026-09-03", "Deposit", "", "gift", [[A.CK, 2000], [A.TITHE, 2000]]);
  ["2026-06-20", "2026-07-20", "2026-08-20"].forEach((d) => L.pay(d, "IMB", "missions", A.SUP, 1500));
  const r = ofType(K.runChecks(L.lines(), { watchVendors: [] }), "round");
  assert.equal(r.length, 1);
  assert.equal(r[0].name, "Roof Pros");
  assert.equal(r[0].txn_date, "2026-09-01");
});

test("weekend: $500+ checks/expenses on Saturday or Sunday, not giving or recurring", () => {
  const L = ledger();
  L.pay("2026-09-12", "Byhalia Hardware", "supplies", A.SUP, 640); // Saturday
  L.pay("2026-09-13", "Byhalia Hardware", "supplies", A.SUP, 499); // under $500
  L.pay("2026-09-14", "Byhalia Hardware", "supplies", A.SUP, 900); // Monday
  L.txn("2026-09-13", "Deposit", "", "offering", [[A.CK, 5000], [A.TITHE, 5000]]);
  L.txn("2026-09-13", "Journal Entry", "", "move offering", [[A.CK, 700], [A.TITHE, -700]]);
  const w = ofType(K.runChecks(L.lines(), { watchVendors: [] }), "weekend");
  assert.equal(w.length, 1);
  assert.equal(w[0].why, "Dated on a Saturday.");
});

test("blank: no name and no memo", () => {
  const L = ledger();
  L.pay("2026-09-02", "", "", A.SUP, 5);
  L.pay("2026-09-03", "", "memo only", A.SUP, 5);
  L.pay("2026-09-04", "Name only", "", A.SUP, 5);
  const b = ofType(K.runChecks(L.lines(), { watchVendors: [] }), "blank");
  assert.equal(b.length, 1);
  assert.equal(b[0].txn_date, "2026-09-02");
});

test("vendor_acct: a vendor that almost always posts to one account", () => {
  const L = ledger();
  ["2026-05-03", "2026-06-03", "2026-07-03", "2026-08-03", "2026-09-03"].forEach((d) => L.pay(d, "Lifeway", "curriculum", A.SUP, 120));
  L.pay("2026-09-10", "Lifeway", "curriculum", A.UTIL, 130);
  // a vendor split evenly between two accounts is normal
  ["2026-06-01", "2026-07-01", "2026-08-01"].forEach((d) => L.pay(d, "Walmart", "a", A.SUP, 30));
  ["2026-06-02", "2026-07-02", "2026-08-02"].forEach((d) => L.pay(d, "Walmart", "b", A.OFF, 30));
  // too few transactions
  ["2026-06-05", "2026-07-05"].forEach((d) => L.pay(d, "Hobby Lobby", "c", A.SUP, 20));
  L.pay("2026-08-05", "Hobby Lobby", "c", A.OFF, 20);
  const v = ofType(K.runChecks(L.lines(), { watchVendors: [] }), "vendor_acct");
  assert.equal(v.length, 1);
  assert.equal(v[0].name, "Lifeway");
  assert.equal(v[0].account_name, A.UTIL.acct);
  assert.match(v[0].why, /usually posts to 6620 Ministry Supplies \(5 of 6\)/);
});

test("loan_expense: loan payments in expense, loan money in income; interest is fine", () => {
  const L = ledger();
  L.pay("2026-09-02", "First Security Bank", "Monthly loan payment", A.REP, 1200);
  L.pay("2026-09-03", "First Security Bank", "Loan interest", A.INT, 300);
  L.txn("2026-09-04", "Deposit", "SBA", "Loan proceeds", [[A.CK, 25000], [A.LOANINC, 25000]]);
  L.pay("2026-09-05", "Regions Bank", "loan", A.REP, 50); // under $100
  L.pay("2026-09-06", "Roof Pros", "Repair", A.REP, 800);
  const l = ofType(K.runChecks(L.lines(), { watchVendors: [] }), "loan_expense");
  assert.equal(l.length, 2);
  assert.deepEqual(l.map((f) => f.account_name).sort(), [A.LOANINC.acct, A.REP.acct].sort());
  assert.match(l.find((f) => f.account_name === A.REP.acct).why, /principal belongs on the loan account/);
  assert.match(l.find((f) => f.account_name === A.LOANINC.acct).why, /Loan proceeds belong on a loan account/);
});

test("watch_vendor: firm-wide list, active patterns only", () => {
  const L = ledger();
  L.pay("2026-09-02", "NETFLIX.COM", "subscription", A.OFF, 15.49, A.CARD);
  L.pay("2026-09-03", "Kroger", "Total Wine run", A.SUP, 60, A.CARD);
  L.pay("2026-09-04", "Lifeway", "Curriculum", A.SUP, 60, A.CARD);
  const def = ofType(K.runChecks(L.lines(), {}), "watch_vendor");
  assert.equal(def.length, 2);
  assert.match(def.find((f) => f.name === "NETFLIX.COM").why, /\(streaming\)/);
  const custom = ofType(K.runChecks(L.lines(), { watchVendors: [{ pattern: "lifeway", category: "other" }, { pattern: "netflix", active: false }] }), "watch_vendor");
  assert.deepEqual(custom.map((f) => f.name), ["Lifeway"]);
  assert.equal(ofType(K.runChecks(L.lines(), { watchVendors: [] }), "watch_vendor").length, 0);
});

test("reconciliation panel and recon_uncleared flags", () => {
  const L = ledger();
  // Checking: reconciled through August, one old uncleared check from June
  L.pay("2026-06-10", "Old Vendor", "uncashed", A.SUP, 85, A.CK, { type: "Check", num: "900", bankExtra: { cleared: "" } });
  L.pay("2026-08-10", "Entergy", "Electric", A.UTIL, 500, A.CK, { bankExtra: { cleared: "R" } });
  L.pay("2026-09-25", "Entergy", "Electric", A.UTIL, 510, A.CK, { bankExtra: { cleared: "C" } });
  // Card: all reconciled
  L.pay("2026-09-05", "Amazon", "x", A.SUP, 40, A.CARD, { bankExtra: { cleared: "R" } });
  // Loan: payments never reconciled
  L.txn("2026-07-01", "Check", "First Security Bank", "loan payment", [[A.LOAN, 1000], [A.CK, -1000, { cleared: "R" }]]);
  L.txn("2026-08-01", "Check", "First Security Bank", "loan payment", [[A.LOAN, 1000], [A.CK, -1000, { cleared: "R" }]]);
  const lines = L.lines();

  const off = K.reconciliation(lines, { reviewPeriod: "2026-09", clearedAvailable: false });
  assert.equal(off.available, false);
  assert.equal(off.accounts.length, 3);
  assert.equal(off.accounts[0].open_count, null);
  assert.equal(ofType(K.runChecks(lines, { reviewPeriod: "2026-09", clearedAvailable: false, watchVendors: [] }), "recon_uncleared").length, 0);

  const on = K.reconciliation(lines, { reviewPeriod: "2026-09", clearedAvailable: true });
  assert.equal(on.through, "2026-09-30");
  const ck = on.accounts.find((a) => a.kind === "bank");
  assert.equal(ck.open_count, 2);
  assert.equal(ck.open_total, -595);
  assert.equal(ck.oldest_date, "2026-06-10");
  assert.equal(ck.stale_count, 1);
  assert.equal(ck.stale_total, -85);
  assert.equal(ck.cleared_not_reconciled, 1);
  assert.equal(ck.last_reconciled_date, "2026-08-10");
  assert.equal(on.banks_clean, false);
  const loan = on.accounts.find((a) => a.kind === "loan");
  assert.equal(loan.loan_uncleared, true);
  assert.equal(on.loan_issue, true);
  assert.deepEqual(on.accounts.map((a) => a.kind), ["bank", "card", "loan"]);

  const res = K.runChecks(lines, { reviewPeriod: "2026-09", clearedAvailable: true, watchVendors: [] });
  const r = ofType(res, "recon_uncleared");
  assert.equal(r.length, 2);
  const bank = r.find((f) => f.account_qbo_id === "35");
  assert.equal(bank.txn_key, "acct:35:2026-09");
  assert.equal(bank.period, "2026-09-01");
  assert.equal(bank.severity, "medium");
  // loan is medium while the bank has stale items...
  assert.equal(r.find((f) => f.account_qbo_id === "70").severity, "medium");

  // ...and high once the bank accounts are clean
  const clean = lines.filter((l) => !(l.date === "2026-06-10"));
  const r2 = ofType(K.runChecks(clean, { reviewPeriod: "2026-09", clearedAvailable: true, watchVendors: [] }), "recon_uncleared");
  assert.equal(r2.length, 1);
  assert.equal(r2[0].severity, "high");
  assert.equal(r2[0].txn_key, "acct:70:2026-09");
  assert.match(r2[0].why, /while the bank accounts are reconciled/);
});

test("holdingTotals: Uncategorized / Ask My Accountant count and dollars", () => {
  const L = ledger();
  L.pay("2026-09-02", "Amazon", "", A.AMA, 286.41);
  L.pay("2026-09-03", "Amazon", "", A.AMA, 13.59);
  L.pay("2026-09-04", "", "", A.UNC, 74.18);
  L.pay("2026-08-04", "", "", A.UNC, 10);
  const h = K.holdingTotals(L.lines(), { period: "2026-09" });
  assert.deepEqual(h.map((x) => [x.acct, x.count, x.total]), [["Ask My Accountant", 2, 300], ["Uncategorized Expense", 1, 74.18]]);
  assert.equal(K.holdingTotals(L.lines()).find((x) => x.acct === "Uncategorized Expense").count, 2);
});

test("rules: stop_flagging hides a flag for one vendor and type; suggested rules do nothing", () => {
  const L = ledger();
  L.pay("2026-09-01", "Roof Pros", "deposit", A.REP, 1500);
  L.pay("2026-09-02", "Steeple Co", "deposit", A.REP, 1500);
  const lines = L.lines();
  const rule = { id: "r1", kind: "stop_flagging", status: "active", flag_type: "round", match_name: "roof pros" };
  const res = K.runChecks(lines, { rules: [rule], watchVendors: [] });
  assert.deepEqual(ofType(res, "round").map((f) => f.name), ["Steeple Co"]);
  assert.equal(res.suppressed.length, 1);
  assert.equal(res.suppressed[0].reason, "stop_flagging");
  assert.equal(res.suppressed[0].rule_id, "r1");
  assert.equal(ofType(K.runChecks(lines, { rules: [{ ...rule, status: "suggested" }], watchVendors: [] }), "round").length, 2);
  assert.equal(ofType(K.runChecks(lines, { rules: [{ ...rule, flag_type: "weekend" }], watchVendors: [] }), "round").length, 2);
  // account-only rule (by id) for one type
  const acctRule = { id: "r2", kind: "stop_flagging", status: "active", flag_type: "round", account_qbo_id: "203" };
  assert.equal(ofType(K.runChecks(lines, { rules: [acctRule], watchVendors: [] }), "round").length, 0);
  // rules saved from a file (name, no id) still match API lines
  const nameRule = { id: "r3", kind: "stop_flagging", status: "active", flag_type: "round", account_name: "6520 building repairs", match_name: "Steeple Co" };
  assert.deepEqual(ofType(K.runChecks(lines, { rules: [nameRule], watchVendors: [] }), "round").map((f) => f.name), ["Roof Pros"]);
});

test("rules: pass_through accounts (rule and name guess) are skipped, and a dismissed guess turns it off", () => {
  const L = ledger();
  // Two different bills paid through Bill.com on the same day for the same amount:
  // the only matching lines are on the clearing account.
  L.txn("2026-09-02", "Bill Payment", "Staples", "a", [[A.OFF, 500], [A.BILL, -500]]);
  L.txn("2026-09-02", "Bill Payment", "Staples", "b", [[A.SUP, 500], [A.BILL, -500]]);
  L.txn("2026-09-03", "Bill Payment", "Staples", "c", [[A.OFF, 70], [A.APC, -70]]);
  L.txn("2026-09-03", "Bill Payment", "Staples", "d", [[A.SUP, 70], [A.APC, -70]]);
  const lines = L.lines();

  const none = K.runChecks(lines, { watchVendors: [] });
  assert.deepEqual(none.passThrough.map((p) => [p.acct, p.source]), [[A.BILL.acct, "auto"]]);
  // Bill.com dup is suppressed automatically; AP Clearing isn't a pass-through yet
  assert.deepEqual(ofType(none, "dup").map((f) => f.account_name), [A.APC.acct]);
  assert.equal(none.suppressed.filter((s) => s.reason === "pass_through").length, 1);

  const withRule = K.runChecks(lines, { rules: [{ id: "p1", kind: "pass_through", status: "active", account_qbo_id: "53" }], watchVendors: [] });
  assert.equal(ofType(withRule, "dup").length, 0);
  assert.deepEqual(withRule.passThrough.map((p) => p.source).sort(), ["auto", "rule"]);

  const dismissed = K.runChecks(lines, { rules: [{ id: "p2", kind: "pass_through", status: "dismissed", account_name: A.BILL.acct }], watchVendors: [] });
  assert.equal(dismissed.passThrough.length, 0);
  assert.equal(ofType(dismissed, "dup").length, 2);
});

test("pass-through name guess never applies to income or expense accounts", () => {
  const L = ledger();
  L.pay("2026-09-02", "", "", { acct: "6530 Wheelchair Ramp Repairs", acct_id: "300", acct_type: "Expense" }, 25);
  const res = K.runChecks(L.lines(), { watchVendors: [] });
  assert.equal(res.passThrough.length, 0);
  assert.equal(ofType(res, "blank").length, 1);
});

test("rules: account_type_override changes which checks apply", () => {
  // A file account guessed as an expense, overridden to Bank: JE-to-cash now applies.
  const rows = [
    ["", "Date", "Transaction type", "Num", "Name", "Memo", "Split", "Amount"],
    ["Envelope Fund"],
    ["", "09/02/2026", "Journal Entry", "JE-1", "", "count", "Supplies", "-40.00"],
    ["Supplies"],
    ["", "09/02/2026", "Journal Entry", "JE-1", "", "count", "Envelope Fund", "40.00"],
  ];
  const lines = P.parseGL(rows).lines;
  assert.equal(lines[0].acct_type, "Expense");
  assert.equal(lines[0].acct_type_source, "guess_default");
  assert.equal(ofType(K.runChecks(lines, { watchVendors: [] }), "jecash").length, 0);
  const rule = { id: "o1", kind: "account_type_override", status: "active", account_name: "envelope fund", account_type_override: "Bank" };
  const res = K.runChecks(lines, { rules: [rule], watchVendors: [] });
  assert.equal(ofType(res, "jecash").length, 1);
  assert.equal(res.lines[0].acct_type_source, "override");
  assert.equal(lines[0].acct_type, "Expense"); // input untouched
});

test("toUpsertRows: API flags become gl_review_upsert_flags rows; file flags are never stored", () => {
  const L = ledger();
  L.pay("2026-09-02", "Amazon", "x", A.AMA, 20, A.CK, { cls: "General", loc: "Main" });
  const rows = K.toUpsertRows(K.runChecks(L.lines(), { watchVendors: [] }).flags);
  assert.equal(rows.length, 1);
  assert.deepEqual(Object.keys(rows[0]).sort(), ["account_name", "account_qbo_id", "amount", "class_name", "flag_type", "location_name", "memo", "name", "other_side", "period", "severity", "txn_date", "txn_key", "why"].sort());
  assert.deepEqual([rows[0].txn_key, rows[0].period, rows[0].amount, rows[0].account_qbo_id, rows[0].class_name, rows[0].other_side],
    ["Expense:1", "2026-09-01", 20, "205", "General", A.CK.acct]);
  assert.equal(K.toUpsertRows(K.runChecks(sample(), { watchVendors: [] }).flags).length, 0);
});

test("flagKey: spec 4.1 key scheme", () => {
  const line = { key: "Check:9", acct_id: "35", acct: "Checking", date: "2026-09-02", num: "104" };
  assert.equal(K.flagKey("round", line), "Check:9");
  assert.equal(K.flagKey("gap", line), "chk:35:104");
  assert.equal(K.flagKey("negbank", line), "neg:35:2026-09-02");
  assert.equal(K.flagKey("recon_uncleared", line), "acct:35:2026-09");
  assert.equal(K.flagKey("swing", line, { month: "2026-08" }), "acct:35:2026-08");
  assert.equal(K.flagKey("changed_after_close", line), "month:2026-09");
  assert.equal(K.flagKey("gap", { ...line, acct_id: null }), "chk:n~checking:104");
});

test("empty and odd input never throws", () => {
  assert.deepEqual(K.runChecks([], {}).flags, []);
  assert.deepEqual(K.runChecks(null).flags, []);
  assert.equal(K.reconciliation([], {}).accounts.length, 0);
  assert.deepEqual(K.holdingTotals(null), []);
});
