"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const P = require("../../components/ledger/GLR_parse.js");
const F = require("../../components/ledger/GLR_fingerprint.js");
const { sampleRows } = require("./fixtures/sampleChurch.js");
const { ACCTS: A, ledger } = require("./fixtures/api.js");

function shuffled(a, seed = 11) {
  const out = a.slice();
  for (let i = out.length - 1; i > 0; i--) {
    seed = (seed * 16807) % 2147483647;
    const j = seed % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

test("sha256Hex matches node:crypto", async () => {
  const s = "Check:1|35|2026-09-02|-53016|General||55\nx";
  assert.equal(await F.sha256Hex(s), crypto.createHash("sha256").update(s, "utf8").digest("hex"));
});

test("lineString uses key|acct_id|date|cents|cls|loc|name_id", () => {
  const l = P.normalizeApiLine({ key: "Check:1", date: "2026-09-02", amt: -530.16, acct: "Checking", acct_id: 35, acct_type: "Bank", cls: "General", name_id: 55 }, 0);
  assert.equal(F.lineString(l), "Check:1|35|2026-09-02|-53016|General||55");
});

test("prints are stable under reorder and float noise", async () => {
  const lines = P.parseGL(sampleRows()).lines;
  const a = await F.monthPrints(lines);
  const b = await F.monthPrints(shuffled(lines));
  assert.equal(a.length, 9);
  assert.deepEqual(a, b);
  const noisy = lines.map((l) => ({ ...l, cents: undefined, amt: l.amt + 1e-9 }));
  const c = await F.monthPrints(noisy);
  assert.deepEqual(c.map((p) => p.hash), a.map((p) => p.hash));
  assert.equal(a[8].period, "2026-09-01");
  assert.match(a[8].hash, /^[0-9a-f]{64}$/);
  assert.equal(a.reduce((s, p) => s + p.line_count, 0), 192);
});

test("any edit to a month changes only that month's hash", async () => {
  const lines = P.parseGL(sampleRows()).lines;
  const base = await F.monthPrints(lines);
  const i = lines.findIndex((l) => l.date.startsWith("2026-03"));
  const edits = [
    { cents: lines[i].cents + 1 },
    { cls: "Building Fund" },
    { loc: "North campus" },
    { name_id: "v:9" },
    { acct_id: "999" },
    { date: lines[i].date.slice(0, 8) + "28" },
  ];
  for (const e of edits) {
    const changed = lines.map((l, j) => (j === i ? { ...l, ...e } : l));
    const p = await F.monthPrints(changed);
    assert.notEqual(p[2].hash, base[2].hash, JSON.stringify(e));
    assert.equal(p[3].hash, base[3].hash);
  }
  // memo is not part of the print
  const memo = await F.monthPrints(lines.map((l, j) => (j === i ? { ...l, memo: "edited" } : l)));
  assert.equal(memo[2].hash, base[2].hash);
});

test("debit side follows the account classification; a balanced month has equal debits and credits", async () => {
  // GL report amounts are in each account's own direction: positive grows the
  // balance (expense, bank, income, card charges), negative shrinks it.
  const L = ledger();
  L.pay("2026-09-02", "Entergy", "e", A.UTIL, 500); // Dr Utilities +500, Cr Checking -500
  L.txn("2026-09-03", "Deposit", "", "offering", [[A.CK, 1200], [A.TITHE, 1200]]); // Dr Checking +1200, Cr Income +1200
  L.txn("2026-09-04", "Check", "Bank", "loan", [[A.LOAN, -800], [A.CK, -800]]); // Dr Loan -800 (balance falls), Cr Checking -800
  L.txn("2026-09-05", "Expense", "Amazon", "x", [[A.SUP, 60], [A.CARD, 60]]); // Dr Supplies +60, Cr Card +60 (balance owed grows)
  const lines = L.lines();
  const find = (a, sign) => lines.find((l) => l.acct === a.acct && Math.sign(l.cents) === sign);
  assert.equal(F.isDebit(find(A.UTIL, 1)), true);
  assert.equal(F.isDebit(find(A.TITHE, 1)), false);
  assert.equal(F.isDebit(find(A.LOAN, -1)), true);
  assert.equal(F.isDebit(find(A.CARD, 1)), false);
  assert.equal(F.isDebit(find(A.CK, -1)), false);
  const [p] = await F.monthPrints(lines);
  assert.equal(p.line_count, 8);
  assert.equal(p.debit_cents, 256000);
  assert.equal(p.credit_cents, 256000);
  assert.equal(p.debit_total, 2560);
});

test("baselineLines: compact sorted rows for one month", () => {
  const L = ledger();
  L.pay("2026-09-02", "Entergy", "e", A.UTIL, 500);
  L.pay("2026-08-02", "Entergy", "e", A.UTIL, 400);
  const rows = F.baselineLines(L.lines(), "2026-09");
  assert.deepEqual(rows, [["Expense:1", "202", "2026-09-02", 50000, "Entergy"], ["Expense:1", "35", "2026-09-02", -50000, "Entergy"]]);
  assert.deepEqual(F.baselineLines(shuffled(L.lines()), "2026-09"), rows);
});
