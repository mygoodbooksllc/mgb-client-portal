// node --test 'tests/ledger/*.test.js'
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const K = require("../../components/ledger/GLR_checks.js");
const { ACCTS: A, ledger } = require("./fixtures/api.js");

const swing = (res) => res.flags.filter((f) => f.flag_type === "swing");
const run = (L, ctx = {}) => K.runChecks(L.lines(), { reviewPeriod: "2026-09", watchVendors: [], ...ctx });

// One expense per month for the given account, so each month is "covered".
function months(L, acct, amounts, ym = ["2026-06", "2026-07", "2026-08", "2026-09"]) {
  amounts.forEach((amt, i) => { if (amt != null) L.pay(ym[i] + "-10", "Vendor " + i, "m" + i, acct, amt); });
}

test("swing: a big jump up is flagged with a plain-English reason", () => {
  const L = ledger();
  months(L, A.SUP, [1000, 1100, 1200, 4200]);
  const f = swing(run(L));
  assert.equal(f.length, 1);
  assert.equal(f[0].severity, "low");
  assert.equal(f[0].label, "Month swing");
  assert.equal(f[0].why, "6620 Ministry Supplies is $4,200 this month vs a $1,100 average over the last 3 months (+282%).");
  assert.equal(f[0].txn_key, "acct:200:2026-09");
  assert.equal(f[0].period, "2026-09-01");
  assert.equal(f[0].amount, 4200);
  assert.equal(f[0].account_name, A.SUP.acct);
  assert.equal(f[0].account_qbo_id, "200");
  assert.equal(f[0].name, "");
});

test("swing: a big drop is flagged too, wording stays neutral", () => {
  const L = ledger();
  months(L, A.UTIL, [3000, 3200, 2800, 900]);
  const f = swing(run(L));
  assert.equal(f.length, 1);
  assert.equal(f[0].why, "6510 Utilities is $900 this month vs a $3,000 average over the last 3 months (-70%).");
  // an account with no lines in the review month is a drop to zero
  const L2 = ledger();
  months(L2, A.UTIL, [3000, 3000, 3000, null]);
  months(L2, A.OFF, [10, 10, 10, 10]); // keeps September covered
  const z = swing(run(L2));
  assert.equal(z.length, 1);
  assert.equal(z[0].account_name, A.UTIL.acct);
  assert.match(z[0].why, /is \$0 this month vs a \$3,000 average .* \(-100%\)\./);
  assert.equal(z[0].txn_key, "acct:202:2026-09");
});

test("swing: needs both $1,000 and 50% of the average", () => {
  const L = ledger();
  months(L, A.SUP, [1000, 1000, 1000, 1990]); // +$990 (under $1,000), +99%
  months(L, A.UTIL, [10000, 10000, 10000, 14000]); // +$4,000 but only +40%
  months(L, A.REP, [1000, 1000, 1000, 2000]); // exactly +$1,000 and +100%: flagged
  months(L, A.OFF, [2000, 2000, 2000, 3000]); // exactly +$1,000, exactly +50%: flagged
  const f = swing(run(L));
  assert.deepEqual(f.map((x) => x.account_name).sort(), [A.OFF.acct, A.REP.acct].sort());
});

test("swing: does not run with fewer than 2 covered prior months", () => {
  // only August and September in the pull
  const L = ledger();
  months(L, A.SUP, [1000, 9000], ["2026-08", "2026-09"]);
  assert.equal(swing(run(L)).length, 0);
  // 3 prior calendar months but the pull only covers one of them (July and August are empty for everyone)
  const L2 = ledger();
  months(L2, A.SUP, [1000, null, null, 9000]);
  months(L2, A.UTIL, [50, null, null, 50]);
  assert.equal(swing(run(L2)).length, 0);
  // two covered prior months is enough, and the average uses only those two
  const L3 = ledger();
  months(L3, A.SUP, [null, 1000, 1000, 5000]);
  const f = swing(run(L3));
  assert.equal(f.length, 1);
  assert.match(f[0].why, /\$5,000 this month vs a \$1,000 average over the last 2 months \(\+400%\)/);
});

test("swing: a covered month with no lines for the account counts as zero", () => {
  const L = ledger();
  months(L, A.SUP, [3000, 3000, null, 6000]);
  months(L, A.OFF, [10, 10, 10, 10]);
  const f = swing(run(L));
  // average = $2,000, this month $6,000: +$4,000, +200%
  assert.equal(f.length, 1);
  assert.match(f[0].why, /\$6,000 this month vs a \$2,000 average over the last 3 months \(\+200%\)/);
});

test("swing: balance-sheet accounts are ignored", () => {
  const L = ledger();
  [["2026-06-10", 100], ["2026-07-10", 100], ["2026-08-10", 100], ["2026-09-10", 90000]].forEach(([d, amt]) => {
    L.txn(d, "Check", "First Security Bank", "payment", [[A.LOAN, amt], [A.CK, -amt]]);
  });
  L.pay("2026-09-12", "x", "y", A.OFF, 20);
  assert.equal(swing(run(L)).length, 0);
});

test("swing: one flag per account, and income accounts count", () => {
  const L = ledger();
  ["2026-06", "2026-07", "2026-08"].forEach((m) => L.txn(m + "-05", "Deposit", "", "offering", [[A.CK, 2000], [A.TITHE, -2000]]));
  // three September deposits, one flag
  ["03", "10", "17"].forEach((d) => L.txn("2026-09-" + d, "Deposit", "", "offering", [[A.CK, 3000], [A.TITHE, -3000]]));
  const f = swing(run(L));
  assert.equal(f.length, 1);
  assert.equal(f[0].account_name, A.TITHE.acct);
  assert.equal(f[0].txn_key, "acct:100:2026-09");
  assert.equal(f[0].line_count, 1);
  assert.match(f[0].why, /-\$9,000 this month vs a -\$2,000 average/); // wording is about size
});

test("swing: an average near zero is never flagged", () => {
  const L = ledger();
  months(L, A.SUP, [20, 30, 40, 5000]); // average $30
  months(L, A.OFF, [0.01, 0.01, 0.01, 5000]);
  assert.equal(swing(run(L)).length, 0);
  // $50 or more has a meaningful percentage
  const L2 = ledger();
  months(L2, A.SUP, [50, 50, 50, 1100]);
  assert.equal(swing(run(L2)).length, 1);
});

test("swing: reviewPeriod picks the month, default is the latest month in the lines", () => {
  const L = ledger();
  months(L, A.SUP, [1000, 1000, 1000, 5000]);
  assert.equal(swing(run(L, { reviewPeriod: undefined })).length, 1);
  assert.equal(swing(run(L, { reviewPeriod: "2026-08" })).length, 0); // only June and July before August: avg $1,000 vs $1,000
  // a month with nothing posted at all is not a drop for every account
  assert.equal(swing(run(L, { reviewPeriod: "2026-10" })).length, 0);
});

test("swing: stop_flagging for the account hides it", () => {
  const L = ledger();
  months(L, A.SUP, [1000, 1000, 1000, 5000]);
  L.pay("2026-09-22", "Walmart", "", A.OFF, 1500, A.CK); // a round-dollar flag too
  assert.equal(swing(run(L))[0].severity, "low");
  const rule = { id: "r1", kind: "stop_flagging", status: "active", flag_type: "swing", account_qbo_id: "200" };
  const hidden = run(L, { rules: [rule] });
  assert.equal(swing(hidden).length, 0);
  assert.ok(hidden.suppressed.some((s) => s.flag.flag_type === "swing" && s.reason === "stop_flagging"));
  // a rule for another account or flag type leaves it alone
  assert.equal(swing(run(L, { rules: [{ ...rule, account_qbo_id: "201" }, { ...rule, flag_type: "large" }] })).length, 1);
});

test("swing: rows for the database, never askable", () => {
  const L = ledger();
  months(L, A.SUP, [1000, 1000, 1000, 5000]);
  const f = swing(run(L))[0];
  assert.equal(f.askable, false);
  const row = K.toUpsertRows([f])[0];
  assert.equal(row.flag_type, "swing");
  assert.equal(row.txn_key, "acct:200:2026-09");
  assert.equal(row.period, "2026-09-01");
  assert.equal(row.amount, 5000);
  assert.equal(row.txn_date, "2026-09-30");
});

test("swing: Strict and Smart duplicate logic is unaffected", () => {
  const L = ledger();
  months(L, A.SUP, [1000, 1000, 1000, 1000]);
  L.pay("2026-09-20", "Entergy", "bill", A.UTIL, 200);
  L.pay("2026-09-20", "Entergy", "bill", A.UTIL, 200);
  const strict = run(L, { dupMode: "strict" });
  const smart = run(L, { dupMode: "smart" });
  assert.equal(strict.flags.filter((f) => f.flag_type === "dup").length, 1);
  assert.equal(smart.flags.filter((f) => f.flag_type === "dup").length, 1);
});
