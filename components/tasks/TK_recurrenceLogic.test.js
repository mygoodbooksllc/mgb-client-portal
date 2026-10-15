// Plain node: `node components/tasks/TK_recurrenceLogic.test.js`.
// Checks the business calendar and due rules (TK_recurrenceLogic.js) against
// the shared fixtures. The same fixtures run in SQL via
// tk_recurrence_selftest(); `--sql` prints the generated seed + values blocks
// to paste into supabase/tasks-p2-1-calendar.sql.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const L = require("./TK_recurrenceLogic.js");
const F = require("./TK_recurrence.fixtures.js");

const HOL = F.HOLIDAYS.map((h) => h[0]);

function q(s) {
  return s == null ? "null" : "'" + String(s).replace(/'/g, "''") + "'";
}

if (process.argv.includes("--sql")) {
  const seed = F.HOLIDAYS.map((h) => `  (date ${q(h[0])}, ${q(h[1])})`).join(",\n");
  const vals = F.CASES.map((c) => {
    const rule = c.rule ? q(JSON.stringify(c.rule)) + "::jsonb" : "null::jsonb";
    const a = q(c.fn === "resolve" ? c.start : c.day) + "::date";
    const b = c.fn === "resolve" ? q(c.end) + "::date" : "null::date";
    const n = c.n == null ? "null::int" : String(c.n);
    const t1 = q(c.fn === "roll" ? c.mode : c.fn === "pstart" ? c.kind : null) + "::text";
    const t2 = q(c.fn === "pstart" ? c.fye : null) + "::text";
    return `      (${q(c.id)}, ${q(c.fn)}, ${rule}, ${a}, ${b}, ${n}, ${t1}, ${t2}, date ${q(c.expected)})`;
  }).join(",\n");
  console.log("-- seed\n" + seed + "\n\n-- values\n" + vals);
  process.exit(0);
}

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

function run(c) {
  switch (c.fn) {
    case "resolve":
      return L.TK_resolveDue(c.rule, c.start, c.end, HOL);
    case "add_bd":
      return L.TK_addBusinessDays(c.day, c.n, HOL);
    case "bdom":
      return L.TK_businessDayOfMonth(c.day, c.n, HOL);
    case "roll":
      return L.TK_roll(c.day, c.mode, HOL);
    case "pstart":
      return L.TK_periodStart(c.kind, c.day, c.fye);
  }
  throw new Error("unknown fn " + c.fn);
}

t("at least 40 fixture cases, unique ids", () => {
  assert.ok(F.CASES.length >= 40, "only " + F.CASES.length);
  assert.strictEqual(new Set(F.CASES.map((c) => c.id)).size, F.CASES.length);
});

t("holiday seed: unique weekdays, sorted, 2026-2028", () => {
  assert.strictEqual(new Set(HOL).size, HOL.length);
  HOL.forEach((d, i) => {
    const w = new Date(d + "T00:00:00Z").getUTCDay();
    assert.ok(w >= 1 && w <= 5, d + " is a weekend");
    assert.ok(d >= "2026-01-01" && d <= "2028-12-31", d);
    if (i) assert.ok(d > HOL[i - 1], "not sorted at " + d);
  });
});

F.CASES.forEach((c) => {
  t("fixture " + c.id, () => assert.strictEqual(run(c), c.expected, c.id));
});

t("every rule type is covered by a fixture", () => {
  const seen = new Set(F.CASES.filter((c) => c.rule).map((c) => c.rule.type));
  L.TK_RULE_TYPES.forEach((ty) => assert.ok(seen.has(ty), ty));
});

t("business days: weekends and holidays", () => {
  assert.strictEqual(L.TK_isBusinessDay("2026-11-26", HOL), false);
  assert.strictEqual(L.TK_isBusinessDay("2026-11-26", []), true);
  assert.strictEqual(L.TK_isBusinessDay("2026-11-28", []), false);
  assert.strictEqual(L.TK_isBusinessDay("2026-11-25", new Set(HOL)), true);
  assert.strictEqual(L.TK_isBusinessDay("nope", HOL), false);
  assert.strictEqual(L.TK_addBusinessDays("2026-11-25", 1), "2026-11-26");
  assert.strictEqual(L.TK_addBusinessDays(null, 1, HOL), null);
  assert.throws(() => L.TK_addBusinessDays("2026-01-01", 401, HOL));
});

t("business day of month: bad n is null", () => {
  assert.strictEqual(L.TK_businessDayOfMonth("2026-02-01", 0, HOL), null);
  assert.strictEqual(L.TK_businessDayOfMonth("2026-02-01", -2, HOL), null);
});

t("roll rejects an unknown mode", () => {
  assert.throws(() => L.TK_roll("2026-11-26", "sideways", HOL));
  assert.strictEqual(L.TK_roll("2026-11-26", null, HOL), "2026-11-26");
});

t("due rule validation", () => {
  const ok = [
    null,
    { type: "offset", days: 0 },
    { type: "offset", days: -90 },
    { type: "offset", days: 120 },
    { type: "business_day", n: -1 },
    { type: "business_day", n: 23, month_offset: 0 },
    { type: "day_of_month", day: 31, roll: "none" },
    { type: "eom" },
    { type: "eom", offset_bd: 10, month_offset: 12 },
    { type: "nth_weekday", n: 5, dow: 7 },
    { type: "weekday", dow: 1 },
  ];
  const bad = [
    [],
    "x",
    {},
    { type: "offset" },
    { type: "offset", days: 121 },
    { type: "offset", days: 1.5 },
    { type: "offset", days: "5" },
    { type: "business_day", n: 0 },
    { type: "business_day", n: 24 },
    { type: "business_day", n: -2 },
    { type: "business_day", n: 1, month_offset: 13 },
    { type: "business_day", n: 1, month_offset: -1 },
    { type: "day_of_month", day: 32 },
    { type: "day_of_month", day: 10, roll: "later" },
    { type: "eom", offset_bd: 11 },
    { type: "nth_weekday", n: 6, dow: 1 },
    { type: "nth_weekday", n: 1, dow: 0 },
    { type: "weekday", dow: 8 },
    { type: "monthly" },
  ];
  ok.forEach((r) => assert.strictEqual(L.TK_dueRuleValid(r), true, JSON.stringify(r)));
  bad.forEach((r) => assert.strictEqual(L.TK_dueRuleValid(r), false, JSON.stringify(r)));
  assert.strictEqual(L.TK_resolveDue(null, "2026-09-01", "2026-09-30", HOL), null);
  assert.throws(() => L.TK_resolveDue({ type: "offset", days: 500 }, "2026-09-01", "2026-09-30", HOL));
});

t("periodsFor: weekly across a year end", () => {
  const p = L.TK_periodsFor("week", "2026-12-24", "2027-01-08");
  assert.deepStrictEqual(
    p.map((x) => [x.start, x.end]),
    [
      ["2026-12-21", "2026-12-27"],
      ["2026-12-28", "2027-01-03"],
      ["2027-01-04", "2027-01-10"],
    ],
  );
  assert.strictEqual(p[1].label, "Wk of Dec 28");
  assert.strictEqual(p[1].key, "week:2026-12-28");
});

t("periodsFor: months, quarters, fiscal years", () => {
  assert.deepStrictEqual(
    L.TK_periodsFor("month", "2026-01-31", "2026-03-01").map((x) => x.end),
    ["2026-01-31", "2026-02-28", "2026-03-31"],
  );
  const qs = L.TK_periodsFor("quarter", "2026-02-10", "2026-12-31", "06-30");
  assert.deepStrictEqual(
    qs.map((x) => x.start + "/" + x.end + "/" + x.label),
    ["2026-01-01/2026-03-31/Q1 2026", "2026-04-01/2026-06-30/Q2 2026", "2026-07-01/2026-09-30/Q3 2026", "2026-10-01/2026-12-31/Q4 2026"],
  );
  const ys = L.TK_periodsFor("year", "2026-03-01", "2027-08-01", "06-30");
  assert.deepStrictEqual(
    ys.map((x) => x.start + "/" + x.end + "/" + x.label),
    ["2025-07-01/2026-06-30/FY 2026", "2026-07-01/2027-06-30/FY 2027", "2027-07-01/2028-06-30/FY 2028"],
  );
  assert.strictEqual(L.TK_periodsFor("year", "2026-03-01", "2026-03-01")[0].label, "FY 2026");
  assert.strictEqual(L.TK_periodsFor("calendar_year", "2026-03-01", "2026-03-01")[0].label, "2026");
  assert.strictEqual(L.TK_periodLabel("month", "2026-09-01"), "Sep 2026");
  assert.deepStrictEqual(L.TK_periodsFor("month", "2026-05-01", "2026-04-01"), []);
  assert.strictEqual(L.TK_periodsFor("week", "2020-01-01", "2035-01-01").length, 600);
  assert.throws(() => L.TK_periodStart("decade", "2026-01-01"));
});

t("fiscal start month parsing", () => {
  assert.strictEqual(L.TK_fiscalStartMonth("12-31"), 1);
  assert.strictEqual(L.TK_fiscalStartMonth("06-30"), 7);
  assert.strictEqual(L.TK_fiscalStartMonth("6/30"), 7);
  assert.strictEqual(L.TK_fiscalStartMonth(" 09-30 "), 10);
  assert.strictEqual(L.TK_fiscalStartMonth("13-01"), 1);
  assert.strictEqual(L.TK_fiscalStartMonth(null), 1);
});

t("browser load keeps TK_logic's own business-day globals", () => {
  // Both files load as classic scripts into one global scope (index.html
  // __SOURCE_ORDER). This file must not replace TK_logic's weekend-only
  // TK_isBusinessDay / TK_addBusinessDays (quick add +Nbd).
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "TK_logic.js"), "utf8"), ctx);
  const before = ctx.TK_isBusinessDay;
  vm.runInContext(fs.readFileSync(path.join(__dirname, "TK_recurrenceLogic.js"), "utf8"), ctx);
  assert.strictEqual(ctx.TK_isBusinessDay, before);
  assert.strictEqual(ctx.TK_addBusinessDays("2026-11-25", 1), "2026-11-26");
  assert.strictEqual(typeof ctx.TK_resolveDue, "function");
  assert.strictEqual(ctx.window.TK_recurrence.TK_addBusinessDays("2026-11-25", 1, HOL), "2026-11-30");
});

t("SQL file carries the current fixtures", () => {
  const sql = fs.readFileSync(path.join(__dirname, "../../supabase/tasks-p2-1-calendar.sql"), "utf8");
  F.CASES.forEach((c) => assert.ok(sql.includes("'" + c.id + "'"), "SQL is missing case " + c.id + " (run with --sql)"));
  F.HOLIDAYS.forEach((h) => assert.ok(sql.includes("'" + h[0] + "'"), "SQL is missing holiday " + h[0]));
});

console.log("TK_recurrenceLogic: " + n + " checks passed");
