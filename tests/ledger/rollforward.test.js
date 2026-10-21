// node --test 'tests/ledger/*.test.js'
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../../components/ledger/GLR_parse.js");
const K = require("../../components/ledger/GLR_checks.js");
const { sampleRows } = require("./fixtures/sampleChurch.js");
const { ACCTS: A, ledger } = require("./fixtures/api.js");

// Build a ledger and stamp running balances (bal) and register order (seq) on each account.
function stamp(raw, opening = {}) {
  const run = {};
  const sq = {};
  raw.forEach((r) => {
    const id = r.acct_id;
    if (!(id in run)) run[id] = Math.round((opening[id] || 0) * 100);
    run[id] += Math.round(r.amt * 100);
    r.bal = run[id] / 100;
    sq[id] = (sq[id] || 0) + 1;
    r.seq = sq[id];
  });
}
const rf = (g, ctx = {}) => K.rollForward(g.lines(), Object.assign({ reviewPeriod: "2026-09" }, ctx));
const acct = (res, a) => res.accounts.find((x) => x.acct_id === a.acct_id);

function sample() {
  const g = ledger();
  g.pay("2026-08-10", "Vendor A", "m", A.SUP, 100, A.CK);
  g.txn("2026-08-15", "Deposit", "Donor", "", [[A.CK, 500], [A.TITHE, -500]]);
  g.pay("2026-09-03", "Vendor B", "m", A.UTIL, 40.1, A.CK);
  g.pay("2026-09-04", "Vendor C", "m", A.SUP, 20.2, A.CK, { type: "Check" });
  g.pay("2026-09-05", "Vendor D", "m", A.OFF, 10, A.CK, { type: "Check" });
  g.txn("2026-09-10", "Deposit", "Donor", "", [[A.CK, 300.3], [A.TITHE, -300.3]]);
  g.txn("2026-09-12", "Transfer", "", "", [[A.CK, 50], [A.SAV, -50]]);
  stamp(g.raw, { 35: 1000, 36: 200, 60: 0, 70: -5000 });
  return g;
}

test("beginning comes from the last earlier line's balance and the roll-forward foots", () => {
  const res = rf(sample());
  const ck = acct(res, A.CK);
  assert.equal(ck.beginning, 1000 - 100 + 500);
  assert.equal(ck.total_in, 350.3);
  assert.equal(ck.total_out, -70.3);
  assert.equal(ck.ending_computed, 1400 + 350.3 - 70.3);
  assert.equal(ck.ending_qbo, ck.ending_computed);
  assert.equal(ck.diff, 0);
  assert.equal(ck.foot_ok, true);
  assert.equal(ck.no_balance, false);
  assert.equal(res.available, true);
  assert.equal(res.period, "2026-09");
  assert.equal(res.through, "2026-09-30");
});

test("grouping by type, sorted by absolute total", () => {
  const ck = acct(rf(sample()), A.CK);
  assert.deepEqual(ck.in_groups, [
    { type: "Deposit", count: 1, total: 300.3 },
    { type: "Transfer", count: 1, total: 50 },
  ]);
  assert.deepEqual(ck.out_groups, [
    { type: "Check", count: 2, total: -30.2 },
    { type: "Expense", count: 1, total: -40.1 },
  ].sort((a, b) => Math.abs(b.total) - Math.abs(a.total)));
  assert.equal(ck.out_groups[0].type, "Expense");
});

test("beginning is derived from the first month line when there is no earlier line", () => {
  const g = ledger();
  g.pay("2026-09-03", "Vendor B", "m", A.UTIL, 25, A.CK);
  g.txn("2026-09-10", "Deposit", "Donor", "", [[A.CK, 100], [A.TITHE, -100]]);
  stamp(g.raw, { 35: 400 });
  const ck = acct(rf(g), A.CK);
  assert.equal(ck.beginning, 400);
  assert.equal(ck.ending_qbo, 475);
  assert.equal(ck.foot_ok, true);
});

test("a tampered balance fails with the exact unexplained difference", () => {
  const g = sample();
  const last = g.raw.filter((r) => r.acct_id === "35").pop();
  last.bal = Math.round((last.bal + 12.34) * 100) / 100;
  const ck = acct(rf(g), A.CK);
  assert.equal(ck.foot_ok, false);
  assert.equal(ck.diff, 12.34);
  assert.equal(ck.diff_cents, 1234);
  assert.equal(ck.ending_qbo - ck.ending_computed > 12.33, true);
});

test("account with no lines in the month: ending equals beginning, passes", () => {
  const g = sample();
  const sv = acct(rf(g), A.SAV);
  // savings has one Sept line (the transfer); look at October instead
  const oct = acct(rf(g, { reviewPeriod: "2026-10" }), A.SAV);
  assert.equal(sv.line_count, 1);
  assert.equal(oct.line_count, 0);
  assert.equal(oct.beginning, oct.ending_qbo);
  assert.equal(oct.ending_computed, oct.beginning);
  assert.deepEqual(oct.in_groups, []);
  assert.deepEqual(oct.out_groups, []);
  assert.equal(oct.foot_ok, true);
});

test("null balances: no_balance, no foot check, activity still listed", () => {
  const g = sample();
  g.raw.forEach((r) => { if (r.acct_id === "35") r.bal = null; });
  const ck = acct(rf(g), A.CK);
  assert.equal(ck.no_balance, true);
  assert.equal(ck.beginning, null);
  assert.equal(ck.foot_ok, null);
  assert.equal(ck.diff, null);
  assert.equal(ck.in_groups.length, 2);
  // other accounts are unaffected
  assert.equal(acct(rf(g), A.SAV).no_balance, false);
});

test("cards and loans are included in natural sign, P&L accounts are not, order is bank then card then loan", () => {
  const g = sample();
  // Natural sign: a card charge is +60 and the owed balance goes up; a loan payment is -200 and the owed balance goes down.
  // Balances are written by hand, not derived from amt.
  g.txn("2026-08-20", "Credit Card Charge", "Store", "", [[A.CARD, 25, { bal: 25, seq: 1 }], [A.SUP, -25]]);
  g.txn("2026-09-08", "Credit Card Charge", "Store", "", [[A.CARD, 60, { bal: 85, seq: 2 }], [A.SUP, -60]]);
  g.txn("2026-09-09", "Credit Card Credit", "Store", "", [[A.CARD, -10, { bal: 75, seq: 3 }], [A.SUP, 10]]);
  g.txn("2026-08-01", "Loan Draw", "", "", [[A.LOAN, 5000, { bal: 5000, seq: 1 }], [A.CK, -5000]]);
  g.txn("2026-09-20", "Payment", "", "", [[A.LOAN, -200, { bal: 4800, seq: 2 }], [A.CK, 200]]);
  const res = rf(g);
  assert.deepEqual(res.accounts.map((a) => a.kind), ["bank", "bank", "card", "loan"]);
  assert.equal(res.accounts.some((a) => a.acct_id === A.SUP.acct_id || a.acct_id === A.TITHE.acct_id), false);
  const card = acct(res, A.CARD);
  assert.equal(card.beginning, 25);
  assert.equal(card.total_in, 60);
  assert.equal(card.total_out, -10);
  assert.equal(card.ending_qbo, 75);
  assert.equal(card.foot_ok, true);
  assert.equal(card.sign, 1);
  const loan = acct(res, A.LOAN);
  assert.equal(loan.beginning, 5000);
  assert.equal(loan.total_out, -200);
  assert.equal(loan.foot_ok, true);
});

test("a Debit/Credit file export of a card foots through sign detection", () => {
  const hdr = ["", "Transaction date", "Transaction type", "Num", "Name", "Memo/Description", "Split account", "Debit", "Credit", "Balance"];
  const rows = [["Test Church"], ["General Ledger"], ["August - September, 2026"], [], hdr,
    ["2100 Church Visa"],
    ["", "08/20/2026", "Credit Card Charge", "", "Store", "", "6620 Ministry Supplies", "", "25.00", "25.00"],
    ["", "09/08/2026", "Credit Card Charge", "", "Store", "", "6620 Ministry Supplies", "", "60.00", "85.00"],
    ["", "09/09/2026", "Credit Card Credit", "", "Store", "", "6620 Ministry Supplies", "10.00", "", "75.00"],
    ["Total for 2100 Church Visa"]];
  const lines = P.parseGL(rows).lines;
  assert.equal(lines.find((l) => l.date === "2026-09-08").amt, -60); // debit - credit
  const res = K.rollForward(lines, { reviewPeriod: "2026-09" });
  const card = res.accounts[0];
  assert.equal(card.kind, "card");
  assert.equal(card.sign, -1);
  assert.equal(card.beginning, 25);
  assert.equal(card.total_in, 60);
  assert.equal(card.total_out, -10);
  assert.equal(card.foot_ok, true);
});

test("a pull that starts mid-month reports the date the beginning balance is as of", () => {
  const g = ledger();
  g.txn("2026-09-07", "Deposit", "D", "", [[A.CK, 100, { bal: 600, seq: 1 }], [A.TITHE, -100]]);
  const ck = acct(rf(g), A.CK);
  assert.equal(ck.beginning, 500);
  assert.equal(ck.beginning_date, "2026-09-07");
  const other = acct(rf(sample()), A.CK);
  assert.equal(other.beginning_date, null);
});

test("cents-exact math with fractional amounts", () => {
  const g = ledger();
  g.pay("2026-09-01", "V", "m", A.SUP, 0.1, A.CK);
  g.pay("2026-09-02", "V", "m", A.SUP, 0.2, A.CK);
  g.txn("2026-09-03", "Deposit", "D", "", [[A.CK, 0.3], [A.TITHE, -0.3]]);
  stamp(g.raw, { 35: 1234.56 });
  const ck = acct(rf(g), A.CK);
  assert.equal(ck.beginning, 1234.56);
  assert.equal(ck.diff_cents, 0);
  assert.equal(ck.foot_ok, true);
  assert.equal(ck.total_out, -0.3);
});

test("open (not reconciled) lines only when cleared data is available", () => {
  const g = sample();
  g.raw.forEach((r) => { if (r.acct_id === "35") r.cleared = r.date < "2026-09-05" ? "R" : ""; });
  assert.equal(acct(rf(g), A.CK).open_count, null);
  const ck = acct(rf(g, { clearedAvailable: true }), A.CK);
  assert.equal(ck.open_count, 3);
  assert.equal(ck.open_total, 300.3 + 50 - 10);
});

test("files without seq sort by date; seq wins when every line has one", () => {
  const g = ledger();
  g.txn("2026-09-02", "Deposit", "D", "", [[A.CK, 10], [A.TITHE, -10]]);
  g.txn("2026-08-30", "Deposit", "D", "", [[A.CK, 5], [A.TITHE, -5]]);
  g.raw.forEach((r) => { if (r.acct_id === "35") r.bal = r.date === "2026-08-30" ? 105 : 115; });
  const ck = acct(rf(g), A.CK);
  assert.equal(ck.beginning, 105);
  assert.equal(ck.foot_ok, true);
});

test("runChecks carries rollfwd, and the sample church parse produces one", () => {
  const lines = P.parseGL(sampleRows()).lines;
  const res = K.runChecks(lines, { watchVendors: [] });
  assert.ok(res.rollfwd && Array.isArray(res.rollfwd.accounts));
  assert.equal(res.rollfwd.period, res.recon.period);
  assert.deepEqual(res.rollfwd.accounts.map((a) => a.acct), res.recon.accounts.map((a) => a.acct));
  res.rollfwd.accounts.forEach((a) => {
    assert.equal(typeof a.no_balance, "boolean");
    assert.ok(Number.isInteger(Math.round(a.total_in * 100)));
  });
});
