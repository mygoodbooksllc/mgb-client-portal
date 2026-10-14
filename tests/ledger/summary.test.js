"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../../components/ledger/GLR_parse.js");
const K = require("../../components/ledger/GLR_checks.js");
const CM = require("../../components/ledger/GLR_compare.js");
const S = require("../../components/ledger/GLR_summary.js");
const { sampleRows } = require("./fixtures/sampleChurch.js");
const { ACCTS: A, ledger } = require("./fixtures/api.js");

const BRITISH = /\b(colour|favour|behaviour|organis|categoris|recognis|summaris|realis|analys(e|ing)\b|cheque|cancelled|travelled|labelled|centre|licence|fulfil\b|enrol\b|programme|whilst|amongst|cheers)/i;
const MONEY_TALK = /\bfees?\b|\brates?\b|\bmargins?\b|\bpric(e|ing)\b|\binvoice\b|\bbilling\b/i;

function findingsFor(lines, period, statuses = {}, ctx = {}) {
  const res = K.runChecks(lines, { reviewPeriod: period, watchVendors: [], ...ctx });
  const flags = res.flags.map((f) => ({ ...f, ...(statuses[f.flag_type] || { status: "cleared" }) }));
  return S.buildFindings({
    period, flags, lines: res.lines, recon: res.recon,
    compare: CM.compareMonth(res.lines, period, { lastCompleteMonth: period }),
    holding: K.holdingTotals(res.lines, { period }),
  });
}

function quietLedger() {
  const L = ledger();
  ["2026-06", "2026-07", "2026-08", "2026-09"].forEach((m, i) => {
    L.pay(m + "-08", "Entergy", "Electric", A.UTIL, 400 + i, A.CK, { bankExtra: { cleared: "R" } });
    L.txn(m + "-03", "Deposit", "", "Sunday offering", [[A.CK, 4000 + i, { cleared: "R" }], [A.TITHE, 4000 + i]]);
  });
  return L;
}

test("clean: nothing open, reconciled, trends in range", () => {
  const f = findingsFor(quietLedger().lines(), "2026-09", {}, { clearedAvailable: true });
  assert.equal(f.flags.open, 0);
  assert.equal(f.recon.clean, true);
  assert.equal(f.month_label, "September 2026");
  const out = S.findingsToSummary(f, { greetingName: "Pastor Mike", bookkeeperName: "Bailley Smith", orgType: "church" });
  assert.equal(out.variant, "clean");
  assert.equal(out.needsGreetingName, false);
  assert.match(out.body, /^Hello Pastor Mike,\n\n/);
  assert.match(out.body, /September 2026/);
  assert.match(out.body, /the bank accounts are reconciled/);
  assert.match(out.body, /nothing you need to do/);
  assert.match(out.body, /Giving and spending were in line with the rest of the year\./);
  assert.match(out.body, /Thank you,\nBailley Smith$/);
});

test("minor: open items the bookkeeper handles, plus old uncleared bank items", () => {
  const L = quietLedger();
  L.pay("2026-09-12", "Byhalia Hardware", "", A.UTIL, 1500, A.CK, { bankExtra: { cleared: "R" } }); // round + weekend
  L.pay("2026-05-02", "Old Vendor", "uncashed", A.UTIL, 85, A.CK, { type: "Check", num: "77" });
  const f = findingsFor(L.lines(), "2026-09", { round: { status: "open" }, weekend: { status: "open" } }, { clearedAvailable: true });
  assert.equal(f.flags.open, 2);
  assert.equal(f.recon.stale_count, 1);
  const out = S.findingsToSummary(f, { greetingName: "Dana", bookkeeperName: "Bailley Smith" });
  assert.equal(out.variant, "minor");
  assert.match(out.body, /2 small items that I'm cleaning up on my end/);
  assert.match(out.body, /haven't cleared the bank yet/);
  assert.match(out.body, /Operating Checking/);
  assert.doesNotMatch(out.body, /^Hello Dana,\n\n.*need your help/s);
});

test("action: asked questions, holding-account dollars and a loan statement", () => {
  const L = quietLedger();
  L.pay("2026-09-09", "Amazon", "", A.AMA, 286.41, A.CK, { bankExtra: { cleared: "R" } });
  L.pay("2026-09-15", "Walmart", "", A.UNC, 74.18, A.CK, { bankExtra: { cleared: "R" } });
  L.txn("2026-08-01", "Check", "First Security Bank", "payment", [[A.LOAN, -1000], [A.CK, -1000, { cleared: "R" }]]);
  const lines = L.lines();
  const res = K.runChecks(lines, { reviewPeriod: "2026-09", clearedAvailable: true, watchVendors: [] });
  const flags = res.flags.map((fl) => fl.flag_type === "suspense" && fl.name === "Amazon"
    ? { ...fl, status: "asked", question: "What was this Amazon order for?" }
    : { ...fl, status: fl.flag_type === "suspense" ? "open" : "cleared" });
  const f = S.buildFindings({ period: "2026-09", flags, lines: res.lines, recon: res.recon, holding: K.holdingTotals(res.lines, { period: "2026-09" }), compare: [] });
  assert.equal(f.questions.length, 1);
  assert.equal(f.holding_count, 2);
  assert.equal(f.holding_total, 360.59);
  assert.equal(f.recon.loan_issue, true);
  const out = S.findingsToSummary(f, { greetingName: "", bookkeeperName: "Bailley Smith", orgType: "church" });
  assert.equal(out.variant, "action");
  assert.equal(out.needsGreetingName, true);
  assert.match(out.body, /^Hello,\n\n/);
  assert.match(out.body, /1\. 09\/09\/2026, Amazon, \$286\.41: What was this Amazon order for\?/);
  assert.match(out.body, /2\. 2 transactions totaling \$360\.59 couldn't be categorized yet/);
  assert.match(out.body, /3\. Please send the latest statement for Building Loan/);
  assert.match(out.body, /1 small item|one small item/);
});

test("the sample church drafts a minor-items summary with trends", () => {
  const lines = P.parseGL(sampleRows()).lines;
  const f = findingsFor(lines, "2026-09", { weekend: { status: "open" } });
  assert.equal(f.recon.available, false);
  assert.equal(f.trends.changes.length, 2);
  const out = S.findingsToSummary(f, { greetingName: "Grace Fellowship", bookkeeperName: "Bailley Smith", orgType: "church", reconciled: true });
  assert.equal(out.variant, "minor");
  assert.match(out.body, /Insurance had no activity this month, though it usually does\./);
  assert.match(out.body, /Ministry Supplies was higher than usual: \$974\.21 compared with a monthly average of \$306\.60, mostly from one payment \(Byhalia Hardware\)\./);
});

test("every variant: American spelling, first person, no fee or rate talk, deterministic", () => {
  const variants = [];
  const L = quietLedger();
  const clean = findingsFor(L.lines(), "2026-09", {}, { clearedAvailable: true });
  const sampleLines = P.parseGL(sampleRows()).lines;
  const minor = findingsFor(sampleLines, "2026-09", { weekend: { status: "open" } });
  const action = findingsFor(sampleLines, "2026-09", { weekend: { status: "open" }, suspense: { status: "asked", question: "What was this for?" } });
  for (const f of [clean, minor, action, { ...clean, holding_count: 1, holding_total: 5 }]) {
    for (const ctx of [{ greetingName: "Pat", bookkeeperName: "Bailley", orgType: "church" }, { bookkeeperName: "Jesse", orgType: "business" }]) {
      const out = S.findingsToSummary(f, ctx);
      variants.push(out.variant);
      assert.doesNotMatch(out.body, BRITISH);
      assert.doesNotMatch(out.body, MONEY_TALK);
      assert.match(out.body, /\bI\b|\bI'/);
      assert.ok(out.body.length <= 8000);
      assert.deepEqual(S.findingsToSummary(f, ctx), out);
    }
  }
  assert.deepEqual([...new Set(variants)].sort(), ["action", "clean", "minor"]);
});

test("opener rotates by month, greeting falls back to Hello,", () => {
  const f = findingsFor(quietLedger().lines(), "2026-09", {}, { clearedAvailable: true });
  const sep = S.findingsToSummary(f, {}).body;
  const aug = S.findingsToSummary({ ...f, period: "2026-08", month_label: "August 2026" }, {}).body;
  assert.notEqual(sep.split("\n\n")[1].split(" ")[0] + sep.split("\n\n")[1].split(" ")[1], aug.split("\n\n")[1].split(" ")[0] + aug.split("\n\n")[1].split(" ")[1]);
  assert.match(sep, /^Hello,\n\n/);
  assert.match(sep, /Thank you,\nYour bookkeeper$/);
  assert.equal(S.findingsToSummary(null, {}).variant, "clean");
});

test("findings shape is JSON-safe and versioned", () => {
  const f = findingsFor(P.parseGL(sampleRows()).lines, "2026-09");
  assert.deepEqual(JSON.parse(JSON.stringify(f)), f);
  assert.equal(f.version, S.FINDINGS_VERSION);
  assert.equal(f.period, "2026-09");
  assert.equal(f.line_count, 20);
  assert.ok(f.txn_count > 0 && f.txn_count <= f.line_count);
  for (const k of ["open", "asked", "cleared", "fixed", "high_open", "medium_open", "low_open", "by_type"]) assert.ok(k in f.flags, k);
});
