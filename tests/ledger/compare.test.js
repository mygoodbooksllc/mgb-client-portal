"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../../components/ledger/GLR_parse.js");
const CM = require("../../components/ledger/GLR_compare.js");
const { sampleRows } = require("./fixtures/sampleChurch.js");
const { ACCTS: A, ledger } = require("./fixtures/api.js");

const sample = () => P.parseGL(sampleRows()).lines;

test("sample September: Insurance missing, Ministry Supplies up, the rest in range", () => {
  const rows = CM.compareMonth(sample(), "2026-09");
  const by = Object.fromEntries(rows.map((r) => [r.acct, r]));
  assert.equal(by["6400 Insurance"].status, "miss");
  assert.equal(by["6400 Insurance"].cur, 0);
  assert.equal(by["6400 Insurance"].avg, 612);
  assert.equal(by["6620 Ministry Supplies"].status, "up");
  assert.equal(by["6620 Ministry Supplies"].cur, 974.21);
  assert.equal(by["6620 Ministry Supplies"].avg, 306.6);
  assert.equal(by["6620 Ministry Supplies"].oneTime, true); // the $640 hardware run
  assert.equal(by["6620 Ministry Supplies"].top[0].name, "Byhalia Hardware");
  assert.equal(by["6510 Utilities"].status, "ok");
  assert.equal(by["6520 Building Repairs"].status, "ok");
  const notOk = rows.filter((r) => r.status !== "ok").map((r) => r.acct).sort();
  assert.deepEqual(notOk, ["6400 Insurance", "6620 Ministry Supplies"]);
  // income and expense accounts only: no bank, no equity
  assert.ok(!by["1010 Operating Checking"]);
  assert.ok(!by["Opening Balance Equity"]);
  assert.ok(rows.every((r) => r.classification === "Revenue" || r.classification === "Expense"));
  // flagged rows sort first
  assert.equal(rows[0].status, "miss");
  assert.equal(by["6620 Ministry Supplies"].series.length, 9);
  assert.deepEqual(by["6620 Ministry Supplies"].series[8], ["2026-09", 974.21]);
  assert.equal(by["6620 Ministry Supplies"].prior, by["6620 Ministry Supplies"].series[7][1]);
});

test("new account, down, and lastCompleteMonth leaves later months out of the average", () => {
  const L = ledger();
  ["2026-05", "2026-06", "2026-07", "2026-08"].forEach((m) => L.pay(m + "-10", "Entergy", "e", A.UTIL, 1000));
  L.pay("2026-09-10", "Entergy", "e", A.UTIL, 300);
  L.pay("2026-09-11", "Staples", "new", A.OFF, 50);
  L.pay("2026-10-02", "Entergy", "partial", A.UTIL, 5);
  const rows = CM.compareMonth(L.lines(), "2026-09", { lastCompleteMonth: "2026-09" });
  const by = Object.fromEntries(rows.map((r) => [r.acct, r]));
  assert.equal(by[A.UTIL.acct].avg, 1000);
  assert.equal(by[A.UTIL.acct].status, "down");
  assert.equal(by[A.UTIL.acct].pct, -70);
  assert.equal(by[A.OFF.acct].status, "new");
  // without the cutoff the October stub drags the average down
  const all = CM.compareMonth(L.lines(), "2026-09");
  assert.equal(all.find((r) => r.acct === A.UTIL.acct).avg, 801);
});

test("pass-through accounts are excluded, including P&L accounts with a pass_through rule", () => {
  const L = ledger();
  ["2026-07", "2026-08", "2026-09"].forEach((m) => L.pay(m + "-10", "Ramp", "x", A.SUP, 100));
  ["2026-07", "2026-08", "2026-09"].forEach((m) => L.pay(m + "-11", "Lifeway", "x", A.OFF, 100));
  const rules = [{ kind: "pass_through", status: "active", account_qbo_id: A.SUP.acct_id }];
  const rows = CM.compareMonth(L.lines(), "2026-09", { rules });
  assert.deepEqual(rows.map((r) => r.acct), [A.OFF.acct]);
});

test("seasonal: the same month last year moved the same way", () => {
  const L = ledger();
  for (let i = 0; i < 13; i++) {
    const y = 2025 + Math.floor((8 + i) / 12), m = ((8 + i) % 12) + 1;
    const ym = `${y}-${String(m).padStart(2, "0")}`;
    const amt = m === 9 ? 3000 : 500; // VBS every September
    L.pay(ym + "-05", "Lifeway", "VBS", A.SUP, amt);
  }
  const r = CM.compareMonth(L.lines(), "2026-09").find((x) => x.acct === A.SUP.acct);
  assert.equal(r.status, "up");
  assert.equal(r.seasonal, true);
  assert.equal(r.explained, true);
});

test("monthKeys and monthlyVolume", () => {
  const L = ledger();
  L.pay("2026-07-02", "a", "", A.SUP, 1);
  L.pay("2026-09-02", "b", "", A.SUP, 1);
  L.txn("2026-09-03", "Bill Payment", "c", "", [[A.SUP, 5], [A.BILL, -5]]);
  assert.deepEqual(CM.monthKeys(L.lines()), ["2026-07", "2026-08", "2026-09"]);
  assert.deepEqual(CM.monthlyVolume(L.lines()), [
    { month: "2026-07", lines: 2, txns: 1 },
    { month: "2026-08", lines: 0, txns: 0 },
    { month: "2026-09", lines: 3, txns: 2 },
  ]);
});
