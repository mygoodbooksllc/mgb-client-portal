// Plain node, no framework: `node components/staff/teamHoursLogic.test.js`.
// Guards the Team › Hours rules for stale QuickBooks data.

const assert = require("assert");
const T = require("./teamHoursLogic.js");

// Averages use only fully synced months.
let a = T.TH_avgRange("2026-10-31", "2026-10-28");
assert.deepStrictEqual([a.from, a.to, a.months, a.label], ["2026-07-01", "2026-09-30", 3, "Jul to Sep"]);

// Sync stalls into November: October is partial, so it is left out.
a = T.TH_avgRange("2026-11-05", "2026-10-28");
assert.deepStrictEqual([a.from, a.to, a.months], ["2026-07-01", "2026-09-30", 3]);

// Sync reaches the last day of October: October counts.
a = T.TH_avgRange("2026-11-05", "2026-10-31");
assert.deepStrictEqual([a.from, a.to, a.months], ["2026-08-01", "2026-10-31", 3]);

// Unknown sync day falls back to the three months before this one.
a = T.TH_avgRange("2026-10-31", null);
assert.deepStrictEqual([a.from, a.to, a.months], ["2026-07-01", "2026-09-30", 3]);

// Year boundary.
a = T.TH_avgRange("2027-01-15", "2027-01-10");
assert.deepStrictEqual([a.from, a.to, a.months], ["2026-10-01", "2026-12-31", 3]);

// Sync far behind: fewer months, divisor follows.
a = T.TH_avgRange("2026-10-31", "2026-08-15");
assert.strictEqual(a.months, 3);
assert.strictEqual(a.to, "2026-07-31");

// Full weeks: Fri Oct 30, synced through Wed Oct 28 -> weeks end Sun Oct 25 and earlier.
let w = T.TH_lastFullWeeks("2026-10-30", "2026-10-28");
assert.deepStrictEqual([w.from, w.to, w.weeks], ["2026-09-28", "2026-10-25", 4]);
// Monday Nov 2, sync still at Oct 28: the week of Oct 26 is partial, so it is skipped.
w = T.TH_lastFullWeeks("2026-11-02", "2026-10-28");
assert.deepStrictEqual([w.from, w.to, w.weeks], ["2026-09-28", "2026-10-25", 4]);
// Fully synced through Sun Nov 1 on Mon Nov 2: week Oct 26-Nov 1 counts.
w = T.TH_lastFullWeeks("2026-11-02", "2026-11-01");
assert.deepStrictEqual([w.from, w.to, w.weeks], ["2026-10-05", "2026-11-01", 4]);
// Never the current week even with a future sync day; unknown sync day = last 4 calendar weeks.
w = T.TH_lastFullWeeks("2026-10-30", "2026-12-31");
assert.deepStrictEqual([w.from, w.to, w.weeks], ["2026-09-28", "2026-10-25", 4]);
w = T.TH_lastFullWeeks("2026-10-30", null);
assert.deepStrictEqual([w.from, w.to, w.weeks], ["2026-09-28", "2026-10-25", 4]);
// Sunday: the week that ends today is still the current week.
w = T.TH_lastFullWeeks("2026-11-01", null);
assert.deepStrictEqual([w.from, w.to], ["2026-09-28", "2026-10-25"]);

// Pace stops at the last synced day.
assert.strictEqual(T.TH_paceDay("2026-10-31", "2026-10-28"), "2026-10-28");
assert.strictEqual(T.TH_paceDay("2026-10-31", "2026-11-02"), "2026-10-31");
assert.strictEqual(T.TH_paceDay("2026-10-31", null), "2026-10-31");

// Period past the last synced day.
assert.strictEqual(T.TH_periodUnsynced({ from: "2026-10-01", to: "2026-10-31" }, "2026-10-28"), true);
assert.strictEqual(T.TH_periodUnsynced({ from: "2026-09-01", to: "2026-09-30" }, "2026-10-28"), false);
assert.strictEqual(T.TH_periodUnsynced({ from: "2026-10-01", to: "2026-10-31" }, null), false);

// Monthly-paid note.
const oct = { from: "2026-10-01", to: "2026-10-31" };
const sep = { from: "2026-09-01", to: "2026-09-30" };
assert.strictEqual(T.TH_monthlyNote("Gillian@MyGoodBooks.org", 0, sep, "2026-10-28"), T.TH_MONTHLY_NOTE);
assert.strictEqual(T.TH_monthlyNote("gillian@mygoodbooks.org", 600, oct, "2026-10-28"), T.TH_MONTHLY_NOTE);
assert.strictEqual(T.TH_monthlyNote("gillian@mygoodbooks.org", 600, sep, "2026-10-28"), null);
assert.strictEqual(T.TH_monthlyNote("someone@mygoodbooks.org", 0, oct, "2026-10-28"), null);
assert.strictEqual(T.TH_monthlyNote("", 0, oct, "2026-10-28"), null);

// Freshness line.
assert.strictEqual(T.TH_syncedLine("2026-10-28"), "Hours synced through Oct 28, 2026");
assert.strictEqual(T.TH_syncedLine(null), "");
assert.strictEqual(T.TH_syncedLine("nope"), "");

// Clients CSV: no money header at all without the money columns (MGB Home S1).
const head = T.TH_clientsCsvHead("Jul to Sep", "In-app hours", null, false);
assert.deepStrictEqual(head, ["Client", "Bucket", "Plan", "QuickBooks hours", "In-app hours", "In-app hours by staffer", "Avg hours / month (Jul to Sep)", "Billable hours", "Trend", "Open tasks"]);
const moneyWords = /value|fee|rate|cost|profit|margin|revenue|\$/i;
assert.ok(head.every((h) => !moneyWords.test(h)), "Hours CSV must carry no money header");
assert.ok(T.TH_clientsCsvHead("x", "a", [], true).includes("Overdue tasks"));
const withMoney = T.TH_clientsCsvHead("x", "a", ["Effective rate / hour", "Monthly fee"], false);
assert.deepStrictEqual(withMoney.slice(8, 10), ["Effective rate / hour", "Monthly fee"]);
assert.ok(!withMoney.includes("Billable value"));

console.log("teamHoursLogic: all passed");
