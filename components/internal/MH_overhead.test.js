// Plain node, no framework: `node components/internal/MH_overhead.test.js`.
// Guards the MGB Home › Overhead logic (MH_overhead.js): the period ranges,
// the category rules, the per-category totals, month filling and shares.

const assert = require("assert");
const O = require("./MH_overhead.js");

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

// Periods ------------------------------------------------------------------
const oct31 = new Date(2026, 9, 31);
t("periods: five, This month first", () => {
  assert.deepStrictEqual(O.MH_OH_PERIODS.map((p) => p.key), ["month", "last-month", "3m", "year", "12m"]);
});
t("range: this month", () => assert.deepStrictEqual(O.MH_ohRange("month", oct31), { from: "2026-10-01", to: "2026-10-31" }));
t("range: last month", () => assert.deepStrictEqual(O.MH_ohRange("last-month", oct31), { from: "2026-09-01", to: "2026-09-30" }));
t("range: last 3 months is whole months", () => assert.deepStrictEqual(O.MH_ohRange("3m", oct31), { from: "2026-08-01", to: "2026-10-31" }));
t("range: this year", () => assert.deepStrictEqual(O.MH_ohRange("year", oct31), { from: "2026-01-01", to: "2026-12-31" }));
t("range: last 12 months", () => assert.deepStrictEqual(O.MH_ohRange("12m", oct31), { from: "2025-11-01", to: "2026-10-31" }));
t("range: January crosses the year", () => {
  const jan = new Date(2027, 0, 15);
  assert.deepStrictEqual(O.MH_ohRange("last-month", jan), { from: "2026-12-01", to: "2026-12-31" });
  assert.deepStrictEqual(O.MH_ohRange("3m", jan), { from: "2026-11-01", to: "2027-01-31" });
});
t("range: unknown key reads as this month", () => assert.deepStrictEqual(O.MH_ohRange("nope", oct31), O.MH_ohRange("month", oct31)));
t("range: every period fits the RPC's 3-year cap", () => {
  O.MH_OH_PERIODS.forEach((p) => {
    const r = O.MH_ohRange(p.key, oct31);
    const days = (new Date(r.to) - new Date(r.from)) / 86400000;
    assert.ok(days >= 0 && days <= 1100, p.key);
  });
});

// Categories ----------------------------------------------------------------
t("category: a real service item wins", () => assert.strictEqual(O.MH_ohCategory("Admin", "team meeting"), "Admin"));
t("category: generic Hours item falls to the description", () => assert.strictEqual(O.MH_ohCategory("Hours", "Team meeting"), "Meetings"));
t("category: blank description", () => {
  assert.strictEqual(O.MH_ohCategory("Hours", null), "No description");
  assert.strictEqual(O.MH_ohCategory(null, "   "), "No description");
});
t("category: keyword rules", () => {
  assert.strictEqual(O.MH_ohCategory("Hours", "Onboarding new client"), "Onboarding");
  assert.strictEqual(O.MH_ohCategory("Hours", "Client setup"), "Onboarding");
  assert.strictEqual(O.MH_ohCategory("Hours", "Weekly huddle"), "Meetings");
  assert.strictEqual(O.MH_ohCategory("Hours", "QBO training"), "Training");
  assert.strictEqual(O.MH_ohCategory("Hours", "Sales proposal"), "Sales & marketing");
  assert.strictEqual(O.MH_ohCategory("Hours", "Email and Asana"), "Email & admin");
  assert.strictEqual(O.MH_ohCategory("Hours", "Process review"), "Reviews & planning");
  assert.strictEqual(O.MH_ohCategory("Hours", "Lunch break"), "Other");
});
t("category: first rule wins (meeting about training)", () => assert.strictEqual(O.MH_ohCategory("Hours", "Training meeting"), "Meetings"));
t("category: no false hit inside words (recall, leader)", () => {
  assert.strictEqual(O.MH_ohCategory("Hours", "recall"), "Other");
  assert.strictEqual(O.MH_ohCategory("Hours", "leadership notes"), "Other");
  assert.strictEqual(O.MH_ohCategory("Hours", "explanation of fees"), "Other");
  assert.strictEqual(O.MH_ohCategory("Hours", "printer setup"), "Other");
});
t("category: words that should still match", () => {
  assert.strictEqual(O.MH_ohCategory("Hours", "Follow up on leads"), "Sales & marketing");
  assert.strictEqual(O.MH_ohCategory("Hours", "New lead call"), "Meetings");
  assert.strictEqual(O.MH_ohCategory("Hours", "Planning Q4"), "Reviews & planning");
  assert.strictEqual(O.MH_ohCategory("Hours", "Account setup for Acme"), "Onboarding");
});

t("categories: totals, cost sums, most minutes first", () => {
  const out = O.MH_ohCategories([
    { item: "Hours", description: null, minutes: 600, cost: 300, entries: 10 },
    { item: "Hours", description: "Team meeting", minutes: 120, cost: 60, entries: 2 },
    { item: "Hours", description: "Staff meeting", minutes: 60, cost: 30.555, entries: 1 },
    { item: "Hours", description: "Lunch", minutes: 30, cost: null, entries: 1 },
  ]);
  assert.deepStrictEqual(out.map((c) => c.category), ["No description", "Meetings", "Other"]);
  assert.strictEqual(out[1].minutes, 180);
  assert.strictEqual(out[1].cost, 90.56);
  assert.strictEqual(out[1].entries, 3);
  assert.strictEqual(out[1].lines, 2);
  assert.strictEqual(out[2].cost, null);
});
t("categories: empty / null", () => {
  assert.deepStrictEqual(O.MH_ohCategories(null), []);
  assert.deepStrictEqual(O.MH_ohCategories([null]), []);
});

// Months ----------------------------------------------------------------------
t("months: gaps filled with zero, oldest first", () => {
  const out = O.MH_ohMonths(
    [
      { month: "2026-08-01", minutes: 60, cost: 50 },
      { month: "2026-10-01", minutes: 30, cost: 25 },
    ],
    "2026-08-01",
    "2026-10-31",
  );
  assert.deepStrictEqual(out, [
    { month: "2026-08-01", minutes: 60, cost: 50 },
    { month: "2026-09-01", minutes: 0, cost: 0 },
    { month: "2026-10-01", minutes: 30, cost: 25 },
  ]);
});
t("months: across a year end", () => {
  const out = O.MH_ohMonths([], "2025-11-01", "2026-02-28");
  assert.deepStrictEqual(out.map((m) => m.month), ["2025-11-01", "2025-12-01", "2026-01-01", "2026-02-01"]);
});
t("months: twelve for last 12 months", () => {
  const r = O.MH_ohRange("12m", oct31);
  assert.strictEqual(O.MH_ohMonths([], r.from, r.to).length, 12);
});
t("months: null cost from the RPC stays null", () => {
  const out = O.MH_ohMonths([{ month: "2026-10-01", minutes: 30, cost: null }], "2026-10-01", "2026-10-31");
  assert.strictEqual(out[0].cost, null);
});
t("months: missing range gives nothing", () => assert.deepStrictEqual(O.MH_ohMonths([], null, null), []));

// Shares ---------------------------------------------------------------------
t("pct: one decimal", () => assert.strictEqual(O.MH_ohPct(1, 3), 33.3));
t("pct: zero or missing whole is null", () => {
  assert.strictEqual(O.MH_ohPct(5, 0), null);
  assert.strictEqual(O.MH_ohPct(5, null), null);
  assert.strictEqual(O.MH_ohPct(null, 5), null);
});

console.log(`MH_overhead.test.js: ${n} passed`);
