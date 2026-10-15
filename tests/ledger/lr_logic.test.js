"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../../components/ledger/LR_logic.js");
const R = require("../../components/ledger/GLR_rules.js");

const flag = (o) => ({
  txn_key: "Check:1",
  flag_type: "large",
  severity: "medium",
  status: "open",
  period: "2026-09-01",
  first_period: "2026-09-01",
  txn_date: "2026-09-10",
  ...o,
});

test("lastCompleteMonth and monthOptions", () => {
  assert.equal(L.lastCompleteMonth(new Date(2026, 9, 14)), "2026-09");
  assert.equal(L.lastCompleteMonth(new Date(2026, 0, 3)), "2025-12");
  const opts = L.monthOptions(new Date(2026, 0, 3), 3);
  assert.deepEqual(opts.map((o) => o.ym), ["2025-12", "2025-11", "2025-10"]);
  assert.equal(opts[0].label, "December 2025");
  assert.equal(L.toPeriod("2026-09"), "2026-09-01");
  assert.equal(L.ymOf("2026-09-01"), "2026-09");
});

test("memory cache expires after its ttl and never needs storage", () => {
  let now = 1000;
  const c = L.makeMemoryCache(15 * 60 * 1000, () => now);
  c.set("a", { lines: [1] });
  assert.deepEqual(c.get("a"), { lines: [1] });
  now += 15 * 60 * 1000;
  assert.deepEqual(c.get("a"), { lines: [1] });
  now += 1;
  assert.equal(c.get("a"), null);
  assert.equal(c.size(), 0);
  c.set("b", 1);
  c.drop("b");
  assert.equal(c.get("b"), null);
});

test("attachRun matches stored rows to run flags by txn_key and flag_type", () => {
  const run = [{ txn_key: "Check:1", flag_type: "large", line: { acct: "Bank" } }];
  const out = L.attachRun([flag({ id: "a" }), flag({ id: "b", flag_type: "round" })], run);
  assert.equal(out[0].run, run[0]);
  assert.equal(out[1].run, null);
  assert.equal(out[0].id, "a");
});

test("viewFlags, tabCounts and openSince", () => {
  const flags = [
    flag({ id: "1", severity: "high" }),
    flag({ id: "2", period: "2026-08-01", first_period: "2026-08-01", txn_date: "2026-08-02" }),
    flag({ id: "3", status: "asked" }),
    flag({ id: "4", status: "cleared" }),
    flag({ id: "5", status: "fixed" }),
    flag({ id: "6", status: "cleared", period: "2026-08-01" }),
    flag({ id: "7", period: "2026-10-01" }),
    flag({ id: "8", flag_type: "round", severity: "low" }),
  ];
  assert.deepEqual(L.viewFlags(flags, { ym: "2026-09", tab: "open" }).map((f) => f.id), ["1", "2", "8"]);
  assert.deepEqual(L.viewFlags(flags, { ym: "2026-09", tab: "cleared" }).map((f) => f.id), ["4", "5"]);
  assert.deepEqual(L.viewFlags(flags, { ym: "2026-09", tab: "open", type: "round" }).map((f) => f.id), ["8"]);
  assert.deepEqual(L.tabCounts(flags, "2026-09"), { open: 3, asked: 1, cleared: 2, high: 1 });
  assert.equal(L.openSince(flags[1], "2026-09"), "Open since August 2026");
  assert.equal(L.openSince(flags[0], "2026-09"), null);
  const chips = L.typeCounts(flags, "2026-09", "open");
  assert.deepEqual(chips.map((c) => [c.type, c.n]), [["large", 2], ["round", 1]]);
});

test("isAskable mirrors gl_review_ask", () => {
  assert.equal(L.isAskable({ txn_key: "Check:123" }), true);
  assert.equal(L.isAskable({ txn_key: "chk:35:1004" }), false);
  assert.equal(L.isAskable({ txn_key: "acct:35:2026-09" }), false);
  assert.equal(L.isAskable({ txn_key: "syn:2026-09-01:x" }), false);
  assert.equal(L.isAskable({ txn_key: "nokey" }), false);
  assert.match(L.defaultQuestion({ flag_type: "dup" }), /twice/);
  assert.match(L.defaultQuestion({ flag_type: "weekend" }), /what this was for/);
});

test("toTsv escapes tabs, line breaks and formula-looking text", () => {
  const s = L.toTsv([["a\tb", "line1\nline2", "=SUM(A1)", "-12.5", -3, "@x", null]]);
  assert.equal(s, "a b\tline1 line2\t'=SUM(A1)\t-12.5\t-3\t'@x\t");
  const f = L.flagsToTsv([flag({ amount: -1234.567, name: "+Acme", why: "Big", account_name: "Office" })]);
  const lines = f.split("\n");
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^Date\tCheck\tPriority/);
  assert.match(lines[1], /^2026-09-10\tUnusually large\tmedium\t'\+Acme\t\tOffice\t\t-1234.57\tBig\tOpen$/);
  const c = L.compareToTsv([{ acct: "Utilities", acct_type: "Expense", cur: 10, avg: 5, diff: 5, pct: 100.4, status: "up" }], "2026-09");
  assert.equal(c.split("\n")[1], "Utilities\tExpense\t10\t5\t5\t100\tHigher than usual");
});

test("chunk, pullWindowLabel and clearReasonLabel", () => {
  assert.deepEqual(L.chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(L.chunk([], 2), []);
  assert.equal(L.pullWindowLabel("rolling14"), "Last 14 months");
  assert.equal(L.pullWindowLabel({ start: "2026-01-01", end: "2026-09-30" }), "2026-01-01 to 2026-09-30");
  assert.equal(L.pullWindowLabel({ window_kind: "rolling14" }), "Last 14 months");
  assert.equal(
    L.pullWindowLabel({ window_kind: "custom", window_start: "2026-03-01", window_end: "2026-04-30" }),
    "March 2026 to April 2026",
  );
  assert.equal(L.pullWindowLabel({ window_kind: "custom", window_start: "2026-03-01", window_end: L.firmToday() }), "Since March 2026");
  assert.equal(L.clearReasonLabel("fixed_in_qbo"), "Fixed it in QuickBooks");
  assert.equal(L.clearReasonLabel("rule"), "Hidden by a rule");
});

test("ruleLabel reads plainly", () => {
  assert.equal(
    L.ruleLabel({ kind: "stop_flagging", flag_type: "round", match_name: "Duke Energy" }),
    'Don\'t flag "Duke Energy" for "Round dollar"',
  );
  assert.match(L.ruleLabel({ kind: "pass_through", account_name: "Mission Trip Fund" }), /^Mission Trip Fund is a pass-through/);
  assert.equal(
    L.ruleLabel({ kind: "account_type_override", account_name: "Misc", account_type_override: "Expense" }),
    "Misc is treated as Expense",
  );
});

test("fileRules feed GLR_rules: true keeps, false dismisses the suggestion", () => {
  const lines = [
    { acct: "Divvy Clearing", acct_id: null, classification: "Liability", acct_type: "Other Current Liability" },
    { acct: "Office Supplies", acct_id: null, classification: "Expense", acct_type: "Expense" },
  ];
  const auto = R.passThrough(lines, []);
  assert.equal(auto.accounts.length, 1);
  const off = R.passThrough(lines, L.fileRules({ passThrough: { "Divvy Clearing": false } }));
  assert.equal(off.accounts.length, 0);
  const on = R.passThrough(lines, L.fileRules({ passThrough: { "Office Supplies": true } }));
  assert.deepEqual(on.accounts.map((a) => a.source).sort(), ["auto", "rule"]);
  const typed = R.applyAccountTypes(lines, L.fileRules({ types: { "Office Supplies": "Other Expense" } }));
  assert.equal(typed[1].acct_type, "Other Expense");
  assert.equal(typed[1].acct_type_source, "override");
});

test("holdingSplit separates Ask accounts from uncategorized", () => {
  const out = L.holdingSplit([
    { acct: "Ask My Accountant", count: 2, total: 100.1 },
    { acct: "Uncategorized Expense", count: 1, total: 20 },
    { acct: "Suspense", count: 1, total: 5.05 },
  ]);
  assert.deepEqual(out, { uncategorized: { count: 2, total: 25.05 }, ask: { count: 2, total: 100.1 } });
});

test("signoffSummary covers each state, including self-approval", () => {
  assert.equal(L.signoffSummary(null).label, "Not reviewed yet");
  assert.equal(L.signoffSummary({ status: "reviewed", reviewed_by: "gillian@x.com" }).detail, "Reviewed by gillian");
  const self = L.signoffSummary({ status: "approved", reviewed_by: "Jesse@x.com", approved_by: "jesse@x.com" });
  assert.match(self.detail, /same person/);
  assert.equal(L.signoffSummary({ status: "sent_back", sent_back_by: "jesse@x.com", sent_back_note: " Fix  the dup " }).detail, "jesse: Fix the dup");
});

test("chartBars scales to the largest absolute value", () => {
  const g = L.chartBars([["2026-08", 50], ["2026-09", -100]], 100, 40, { gap: 0, avg: 25, current: "2026-09" });
  assert.equal(g.max, 100);
  assert.equal(g.bars[0].h, 20);
  assert.equal(g.bars[1].h, 40);
  assert.equal(g.bars[1].neg, true);
  assert.equal(g.bars[1].current, true);
  assert.equal(g.bars[1].x, 50);
  assert.equal(g.avgY, 30);
  assert.deepEqual(L.chartBars([], 100, 40).bars, []);
});

test("pullFromOptions stays inside the server's 24-month limit", () => {
  const opts = L.pullFromOptions(new Date(2026, 9, 15));
  assert.equal(opts.length, 24);
  assert.deepEqual(opts[0], { ym: "2026-10", label: opts[0].label, start: "2026-10-01" });
  assert.equal(opts[1].start, "2026-09-01");
  assert.equal(opts[23].start, "2024-11-01");
  // server: start >= addMonths(end, -24) = first of the month 24 back
  assert.ok(opts[23].start >= "2024-10-01");
  assert.equal(L.pullFromOptions(new Date(2026, 0, 31), 2)[1].start, "2025-12-01");
});

test("pullWindowFrom ends on the firm (Chicago) date, not UTC", () => {
  // 2026-10-16 03:00 UTC is still 10-15 in Chicago
  assert.equal(L.firmToday(new Date("2026-10-16T03:00:00Z")), "2026-10-15");
  assert.deepEqual(L.pullWindowFrom("2025-03-01", new Date("2026-10-16T03:00:00Z")), { start: "2025-03-01", end: "2026-10-15" });
});

test("month lists use the firm (Chicago) month, not UTC or the browser month", () => {
  // 2026-11-01 03:00 UTC is still 2026-10-31 in Chicago
  const now = new Date("2026-11-01T03:00:00Z");
  assert.equal(L.pullFromOptions(now, 2)[0].ym, "2026-10");
  assert.equal(L.monthOptions(now, 1)[0].ym, "2026-09");
  assert.equal(L.lastCompleteMonth(now), "2026-09");
  // and just after Chicago midnight it rolls over
  assert.equal(L.pullFromOptions(new Date("2026-11-01T06:30:00Z"), 1)[0].ym, "2026-11");
});

test("a custom pull saves only window-independent flag types", () => {
  const rows = ["suspense", "round", "weekend", "large", "vendor_acct", "gap", "recon_uncleared", "negbank", "dup"].map((t) => ({ flag_type: t }));
  assert.deepEqual(L.rowsForWindow(rows, "custom").map((r) => r.flag_type), ["suspense", "negbank", "dup"]);
  assert.equal(L.rowsForWindow(rows, "rolling14").length, rows.length);
});

test("coveredLabel shows the real start and end months", () => {
  assert.equal(L.coveredLabel({ window_start: "2025-08-15", window_end: "2026-10-15" }), "Aug 2025 \u2013 Oct 2026");
  assert.equal(L.coveredLabel({ window_kind: "ytd" }), "");
  assert.equal(L.coveredLabel(null), "");
});

test("windowSplit hides flags dated before the pull window, keeps them stored", () => {
  const flags = [
    { txn_date: "2025-05-10", status: "open" },
    { txn_date: "2025-08-15", status: "open" },
    { txn_date: "2026-03-02", status: "cleared" },
    { txn_date: null, status: "open" },
  ];
  const r = L.windowSplit(flags, "2025-08-15");
  assert.deepEqual(r.hidden.map((f) => f.txn_date), ["2025-05-10"]);
  assert.equal(r.shown.length, 3);
  assert.equal(L.windowSplit(flags, "").shown.length, 4);
  // counts only include what is shown
  assert.equal(L.tabCounts(r.shown.map((f) => ({ ...f, period: "2025-09-01" })), "2026-09").open, 2);
});
