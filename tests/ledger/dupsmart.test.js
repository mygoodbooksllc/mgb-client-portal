// node --test 'tests/ledger/*.test.js'
// "Possible duplicates" Smart mode vs Strict (docs/gl-review-spec.md).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const K = require("../../components/ledger/GLR_checks.js");
const { ACCTS: A, ledger } = require("./fixtures/api.js");

const UF = { acct: "1200 Undeposited Funds", acct_id: "37", acct_type: "Other Current Asset" };
const run = (L, mode) => K.runChecks(L.lines(), { watchVendors: [], dupMode: mode });
const dups = (res) => res.flags.filter((f) => f.flag_type === "dup");

test("strict is the default and flags every same-date match", () => {
  const L = ledger();
  L.pay("2026-09-02", "Staples", "Paper", A.OFF, 45.5);
  L.pay("2026-09-02", "Staples", "Toner", A.OFF, 45.5);
  assert.equal(dups(run(L)).length, 1);
  assert.equal(dups(run(L, "strict")).length, 1);
  assert.equal(run(L).dupMode, "strict");
  assert.deepEqual(run(L).dupSetAside, []);
});

test("smart: monthly recurring payments on different dates never flag", () => {
  const L = ledger();
  ["2026-07-01", "2026-08-01", "2026-09-01"].forEach((d) => L.pay(d, "Adobe", "Subscription", A.OFF, 59.99));
  assert.equal(dups(run(L, "smart")).length, 0);
  assert.equal(dups(run(L, "strict")).length, 0);
});

test("smart: payment + deposit pair on Undeposited Funds is not a duplicate", () => {
  const L = ledger();
  L.txn("2026-09-05", "Payment", "Grace Church", "", [[UF, 500], [A.TITHE, -500]]);
  L.txn("2026-09-05", "Deposit", "Grace Church", "", [[UF, 500], [A.CK, -500]]);
  assert.equal(dups(run(L, "strict")).length, 1);
  const s = run(L, "smart");
  assert.equal(dups(s).length, 0);
  assert.equal(s.dupSetAside.length, 1);
});

test("smart: payment/deposit or transfer moving between bank and a clearing account", () => {
  const L = ledger();
  L.txn("2026-09-05", "Transfer", "", "Pay vendor", [[A.BILL, 750], [A.CK, -750]]);
  L.txn("2026-09-05", "Expense", "", "Pay vendor", [[A.BILL, 750], [A.CK, -750]]);
  assert.equal(dups(run(L, "smart")).length, 0);
});

test("smart: split lines of one transaction never pair", () => {
  const L = ledger();
  L.txn("2026-09-02", "Expense", "Costco", "Split", [[A.OFF, 40], [A.OFF, 40], [A.CK, -80]]);
  assert.equal(dups(run(L, "smart")).length, 0);
  assert.equal(dups(run(L, "strict")).length, 0);
});

test("smart: amounts under the floor are ignored; the floor is configurable", () => {
  const L = ledger();
  L.pay("2026-09-02", "Bank", "Fee", A.INT, 0.5);
  L.pay("2026-09-02", "Bank", "Fee", A.INT, 0.5);
  assert.equal(dups(run(L, "strict")).length, 1);
  assert.equal(dups(run(L, "smart")).length, 0);
  const C = require("../../components/ledger/GLR_config.js");
  C.T.dupSmartMinAbs = 0.25;
  try { assert.equal(dups(run(L, "smart")).length, 1); } finally { C.T.dupSmartMinAbs = 1; }
});

test("smart: a true double (same type, memo, amount) still flags and names the match", () => {
  const L = ledger();
  L.pay("2026-09-02", "Staples", "Paper", A.OFF, 245.5);
  L.pay("2026-09-02", "Staples", "Paper", A.OFF, 245.5);
  const d = dups(run(L, "smart"));
  assert.equal(d.length, 1);
  assert.match(d[0].why, /Expense/);
  assert.match(d[0].why, /memo/i);
  assert.equal(dups(run(L, "smart"))[0].txn_key, dups(run(L, "strict"))[0].txn_key);
});

test("smart: blank memo and blank number on both sides still flag (when in doubt, flag)", () => {
  const L = ledger();
  L.pay("2026-09-02", "Staples", "", A.OFF, 120);
  L.pay("2026-09-02", "Staples", "", A.OFF, 120);
  assert.equal(dups(run(L, "smart")).length, 1);
});

test("smart: different memos or different numbers prove they are separate", () => {
  const L = ledger();
  L.pay("2026-09-02", "Staples", "Paper", A.OFF, 120);
  L.pay("2026-09-02", "Staples", "Toner", A.OFF, 120);
  assert.equal(dups(run(L, "smart")).length, 0);
  const L2 = ledger();
  L2.txn("2026-09-02", "Invoice", "Acme", "", [[A.TITHE, -300], [A.CK, 300]], { num: "1001" });
  L2.txn("2026-09-02", "Invoice", "Acme", "", [[A.TITHE, -300], [A.CK, 300]], { num: "1002" });
  assert.equal(dups(run(L2, "smart")).length, 0);
  assert.ok(dups(run(L2, "strict")).length >= 1);
});

test("smart: Bill and Expense (both money out) still pair; Check with Deposit does not", () => {
  const L = ledger();
  L.pay("2026-09-02", "Staples", "Paper", A.OFF, 90, A.CK, { type: "Bill" });
  L.pay("2026-09-02", "Staples", "Paper", A.OFF, 90, A.CK, { type: "Expense" });
  assert.equal(dups(run(L, "smart")).length, 1);
  const L2 = ledger();
  L2.txn("2026-09-02", "Check", "Staples", "Paper", [[A.OFF, 90], [A.CK, -90]]);
  L2.txn("2026-09-02", "Deposit", "Staples", "Paper", [[A.OFF, 90], [A.CK, -90]]);
  assert.equal(dups(run(L2, "smart")).length, 0);
});

test("smart: a real double hiding among a pair that is set aside still flags", () => {
  const L = ledger();
  L.txn("2026-09-05", "Payment", "Grace Church", "", [[UF, 500], [A.TITHE, -500]]);
  L.txn("2026-09-05", "Deposit", "Grace Church", "", [[UF, 500], [A.CK, -500]]);
  L.txn("2026-09-05", "Deposit", "Grace Church", "", [[UF, 500], [A.CK, -500]]);
  assert.equal(dups(run(L, "smart")).length, 1);
});
