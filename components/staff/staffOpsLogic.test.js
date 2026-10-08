// Plain node, no framework: `node components/staff/staffOpsLogic.test.js`.
// Guards the staff ops rules (staffOpsLogic.js).

const assert = require("assert");
const L = require("./staffOpsLogic.js");

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

// ---- Hours budget
t("no budget never flags", () => {
  assert.strictEqual(L.OPS_budgetStatus(600, null), null);
  assert.strictEqual(L.OPS_budgetStatus(600, ""), null);
  assert.strictEqual(L.OPS_budgetStatus(600, 0), null);
  assert.strictEqual(L.OPS_budgetStatus(600, "abc"), null);
});
t("unknown hours never flags", () => {
  assert.strictEqual(L.OPS_budgetStatus(null, 10), null);
});
t("budget thresholds", () => {
  assert.strictEqual(L.OPS_budgetStatus(0, 10).state, "ok");
  assert.strictEqual(L.OPS_budgetStatus(479, 10).state, "ok");
  assert.strictEqual(L.OPS_budgetStatus(480, 10).state, "near");
  assert.strictEqual(L.OPS_budgetStatus(599, 10).state, "near");
  assert.strictEqual(L.OPS_budgetStatus(600, 10).state, "over");
  assert.strictEqual(L.OPS_budgetStatus(900, "10").pct, 150);
});
t("budget rule matching", () => {
  const near = L.OPS_budgetStatus(500, 10);
  const over = L.OPS_budgetStatus(700, 10);
  const ok = L.OPS_budgetStatus(60, 10);
  assert.ok(L.OPS_budgetMatches("any", null));
  assert.ok(!L.OPS_budgetMatches("over", null));
  assert.ok(!L.OPS_budgetMatches("near", null));
  assert.ok(L.OPS_budgetMatches("near", near) && L.OPS_budgetMatches("near", over) && !L.OPS_budgetMatches("near", ok));
  assert.ok(L.OPS_budgetMatches("over", over) && !L.OPS_budgetMatches("over", near));
});

// ---- Reply times
t("wait formatting", () => {
  assert.strictEqual(L.OPS_fmtWait(null), "\u2014");
  assert.strictEqual(L.OPS_fmtWait(0), "1 min");
  assert.strictEqual(L.OPS_fmtWait(0.75), "45 min");
  assert.strictEqual(L.OPS_fmtWait(3.24), "3.2 h");
  assert.strictEqual(L.OPS_fmtWait(5), "5 h");
  assert.strictEqual(L.OPS_fmtWait(47.9), "47.9 h");
  assert.strictEqual(L.OPS_fmtWait(50.4), "2.1 days");
  assert.strictEqual(L.OPS_fmtWait(72), "3 days");
  assert.strictEqual(L.OPS_REPLY_GOAL_HOURS, 24);
});
t("reply periods", () => {
  assert.deepStrictEqual(L.OPS_replyPeriod("month", "2026-10-07"), { from: "2026-10-01", to: "2026-10-07" });
  assert.deepStrictEqual(L.OPS_replyPeriod("last-month", "2026-10-07"), { from: "2026-09-01", to: "2026-09-30" });
  assert.deepStrictEqual(L.OPS_replyPeriod("last-month", "2026-01-15"), { from: "2025-12-01", to: "2025-12-31" });
  assert.deepStrictEqual(L.OPS_replyPeriod("90", "2026-10-07"), { from: "2026-07-10", to: "2026-10-07" });
  assert.deepStrictEqual(L.OPS_replyPeriod("last-month", "2026-03-31"), { from: "2026-02-01", to: "2026-02-28" });
});

// ---- Time off
t("out until chains back-to-back entries", () => {
  const rows = [
    { staff_email: "A@x.org", starts_on: "2026-10-05", ends_on: "2026-10-09" },
    { staff_email: "a@x.org", starts_on: "2026-10-10", ends_on: "2026-10-13" },
    { staff_email: "a@x.org", starts_on: "2026-10-20", ends_on: "2026-10-21" },
    { staff_email: "b@x.org", starts_on: "2026-10-01", ends_on: "2026-10-30", cancelled_at: "2026-10-02T00:00:00Z" },
  ];
  assert.strictEqual(L.OPS_outUntil(rows, "a@x.org", "2026-10-07"), "2026-10-13");
  assert.strictEqual(L.OPS_outUntil(rows, "a@x.org", "2026-10-14"), null);
  assert.strictEqual(L.OPS_outUntil(rows, "a@x.org", "2026-10-21"), "2026-10-21");
  assert.strictEqual(L.OPS_outUntil(rows, "b@x.org", "2026-10-07"), null);
  assert.strictEqual(L.OPS_outUntil(rows, "", "2026-10-07"), null);
  assert.strictEqual(L.OPS_addDays("2026-02-28", 1), "2026-03-01");
});
t("upcoming time off and validation", () => {
  const rows = [
    { staff_email: "a@x.org", starts_on: "2026-11-01", ends_on: "2026-11-02" },
    { staff_email: "a@x.org", starts_on: "2026-10-01", ends_on: "2026-10-03" },
    { staff_email: "b@x.org", starts_on: "2026-10-08", ends_on: "2026-10-09" },
  ];
  assert.deepStrictEqual(L.OPS_upcomingTimeOff(rows, "2026-10-07").map((r) => r.starts_on), ["2026-10-08", "2026-11-01"]);
  assert.strictEqual(L.OPS_upcomingTimeOff(rows, "2026-10-07", "A@x.org").length, 1);
  assert.ok(L.OPS_timeOffError("", "2026-10-09", "2026-10-07"));
  assert.ok(L.OPS_timeOffError("2026-10-09", "2026-10-08", "2026-10-07"));
  assert.ok(L.OPS_timeOffError("2026-10-01", "2026-10-02", "2026-10-07"));
  assert.ok(L.OPS_timeOffError("2026-10-07", "2027-10-09", "2026-10-07"));
  assert.strictEqual(L.OPS_timeOffError("2026-10-01", "2026-10-07", "2026-10-07"), null);
  assert.strictEqual(L.OPS_BACKUP_ACCESS.none.tone, "bad");
});

// ---- Firm deadlines
const RULES = [
  { key: "1099-nec", name: "1099-NEC", cadence: "annual", due_rule: { month: 1, day: 31 }, active: true },
  { key: "w-2", name: "W-2", cadence: "annual", due_rule: { month: 1, day: 31 }, requires_payroll: true, active: true },
  { key: "941", name: "941", cadence: "quarterly", requires_payroll: true, active: true,
    due_rule: { dates: [{ month: 4, day: 30 }, { month: 7, day: 31 }, { month: 10, day: 31 }, { month: 1, day: 31 }] } },
  { key: "990", name: "990", cadence: "annual", applies_entity_type: ["nonprofit"], applies_org_type_excludes: ["Church"], active: true,
    due_rule: { fye_months: 5, day: 15, fallback_month: 5, fallback_day: 15 } },
  { key: "1096", name: "1096", cadence: "annual", due_rule: { month: 1, day: 31 }, opt_in: true, active: true },
  { key: "old", name: "Old", cadence: "annual", due_rule: { month: 3, day: 1 }, active: false },
];
t("date helpers", () => {
  assert.strictEqual(L.OPS_ymd(2026, 14, 31), "2027-02-28");
  assert.strictEqual(L.OPS_ymd(2028, 2, 30), "2028-02-29");
  assert.strictEqual(L.OPS_rollWeekend("2027-01-31"), "2027-02-01"); // Sunday
  assert.strictEqual(L.OPS_rollWeekend("2027-05-15"), "2027-05-17"); // Saturday
  assert.strictEqual(L.OPS_rollWeekend("2026-05-15"), "2026-05-15"); // Friday
  assert.strictEqual(L.OPS_fyeMonth("06-30"), 6);
  assert.strictEqual(L.OPS_fyeMonth("6/30"), 6);
  assert.strictEqual(L.OPS_fyeMonth("13-01"), null);
  assert.strictEqual(L.OPS_fyeMonth(""), null);
  assert.strictEqual(L.OPS_dayDiff("2026-10-14", "2026-10-07"), 7);
});
t("rule applies", () => {
  const np = { id: "a", entityType: "nonprofit", orgType: "Charity", payrollAddOn: false };
  const church = { id: "b", entityType: "nonprofit", orgType: "Church", payrollAddOn: true };
  const fp = { id: "c", entityType: "for_profit", orgType: "", payrollAddOn: true };
  assert.ok(L.OPS_ruleApplies(RULES[3], np));
  assert.ok(!L.OPS_ruleApplies(RULES[3], church));
  assert.ok(!L.OPS_ruleApplies(RULES[3], fp));
  assert.ok(L.OPS_ruleApplies(RULES[3], church, { due_date: "2027-05-15" }), "override forces it on");
  assert.ok(!L.OPS_ruleApplies(RULES[0], np, { skip: true }));
  assert.ok(!L.OPS_ruleApplies(RULES[1], np) && L.OPS_ruleApplies(RULES[1], church));
  assert.ok(!L.OPS_ruleApplies(RULES[4], np) && L.OPS_ruleApplies(RULES[4], np, { skip: false }));
  assert.ok(!L.OPS_ruleApplies(RULES[5], np));
});
t("occurrences", () => {
  const q = L.OPS_ruleOccurrences(RULES[2], null, 2026, 2026).filter((x) => x.period_key.startsWith("2026"));
  assert.deepStrictEqual(q.map((x) => x.nominal), ["2026-04-30", "2026-07-31", "2026-10-31", "2027-01-31"]);
  const fy = L.OPS_ruleOccurrences(RULES[3], "06-30", 2026, 2026).find((x) => x.period_key === "FY2026");
  assert.strictEqual(fy.nominal, "2026-11-15");
  const fb = L.OPS_ruleOccurrences(RULES[3], null, 2026, 2026).find((x) => x.nominal === "2026-05-15");
  assert.ok(fb.assumed && fb.period_key === "FY2025");
  const mo = L.OPS_ruleOccurrences({ cadence: "monthly", due_rule: { day: 20 } }, null, 2026, 2026).find((x) => x.period_key === "2026-12");
  assert.strictEqual(mo.nominal, "2027-01-20");
});
t("deadline items: filters, overrides, legacy dates, status", () => {
  const clients = [
    { id: "np", name: "Nonprofit", entityType: "nonprofit", orgType: "Charity", payrollAddOn: true, assignedBookkeeper: { email: "G@x.org" } },
    { id: "ch", name: "Church", entityType: "nonprofit", orgType: "Church", payrollAddOn: false },
  ];
  const base = { rules: RULES, clients, from: "2026-10-01", to: "2027-06-30", today: "2026-10-28" };
  let items = L.OPS_deadlineItems({ ...base, profiles: { np: { fiscal_year_end: "12-31" } } });
  const keys = items.map((i) => i.client_id + ":" + i.rule_key + ":" + i.due);
  assert.ok(keys.includes("np:941:2026-11-02"), "Oct 31 2026 is a Saturday, rolls to Nov 2");
  assert.ok(keys.includes("np:990:2027-05-17"));
  assert.ok(!keys.some((k) => k.startsWith("ch:990")), "churches left out");
  assert.ok(!keys.some((k) => k.includes(":1096:")), "opt-in is off");
  assert.ok(keys.includes("ch:1099-nec:2027-02-01"));
  assert.ok(!keys.some((k) => k.startsWith("ch:941")), "no payroll");
  assert.strictEqual(items[0].due <= items[items.length - 1].due, true);
  const q3 = items.find((i) => i.client_id === "np" && i.rule_key === "941" && i.period_key === "2026-Q3");
  assert.strictEqual(q3.state, "soon");
  assert.strictEqual(q3.assignee_email, "g@x.org");
  // legacy key date replaces the computed 990 date; override beats it; status marks filed
  items = L.OPS_deadlineItems({
    ...base,
    today: "2026-11-03",
    profiles: { np: { fiscal_year_end: "12-31", form_990_due: "2027-04-01" }, ch: { filing_1099_due: "2027-01-29" } },
    overrides: [{ client_id: "ch", rule_key: "1096", skip: false }, { client_id: "np", rule_key: "1099-nec", skip: true }],
    statuses: [{ client_id: "np", rule_key: "941", period_key: "2026-Q3" }, { client_id: "np", rule_key: "w-2", period_key: "2027", undone_at: "x" }],
  });
  const f = (c, r) => items.filter((i) => i.client_id === c && i.rule_key === r);
  assert.strictEqual(f("np", "990")[0].due, "2027-04-01");
  assert.strictEqual(f("np", "990")[0].source, "key-dates");
  assert.strictEqual(f("ch", "1099-nec")[0].due, "2027-01-29");
  assert.strictEqual(f("ch", "1096").length, 1);
  assert.strictEqual(f("np", "1099-nec").length, 0);
  assert.strictEqual(f("np", "941").find((i) => i.period_key === "2026-Q3").state, "filed");
  assert.strictEqual(f("np", "w-2")[0].state, "upcoming", "undone status doesn't count");
  items = L.OPS_deadlineItems({ ...base, today: "2026-11-03", profiles: { np: { form_990_due: "2027-04-01" } },
    overrides: [{ client_id: "np", rule_key: "990", due_date: "2027-03-15", note: "Extension" }] });
  const n990 = items.filter((i) => i.client_id === "np" && i.rule_key === "990");
  assert.deepStrictEqual([n990[0].due, n990[0].source, n990[0].note], ["2027-03-15", "override", "Extension"]);
  const overdue = L.OPS_deadlineItems({ ...base, today: "2026-11-03", profiles: {} }).find((i) => i.period_key === "2026-Q3");
  assert.strictEqual(overdue.state, "overdue");
  assert.ok(/Quarterly: Apr 30/.test(L.OPS_describeDueRule(RULES[2])));
  assert.ok(/after the fiscal year end/.test(L.OPS_describeDueRule(RULES[3])));
});

t("quarter range and shout-out validation", () => {
  assert.deepStrictEqual(L.OPS_quarterRange(2026, 1), ["2026-01-01", "2026-04-01"]);
  assert.deepStrictEqual(L.OPS_quarterRange("2026", "3"), ["2026-07-01", "2026-10-01"]);
  assert.deepStrictEqual(L.OPS_quarterRange(2026, 4), ["2026-10-01", "2027-01-01"]);
  assert.strictEqual(L.OPS_quarterRange(2026, 5), null);
  assert.strictEqual(L.OPS_quarterRange(null, 1), null);
  assert.strictEqual(L.OPS_shoutoutError("", "hi", "a@x"), "Pick who it's for.");
  assert.ok(/yourself/.test(L.OPS_shoutoutError("A@x ", "hi", "a@x")));
  assert.strictEqual(L.OPS_shoutoutError("b@x", "   ", "a@x"), "Write a short note.");
  assert.ok(/500/.test(L.OPS_shoutoutError("b@x", "y".repeat(501), "a@x")));
  assert.strictEqual(L.OPS_shoutoutError("b@x", "Thanks!", "a@x"), "");
});

t("SOP freshness", () => {
  assert.strictEqual(L.OPS_sopFreshness(null, null, "2026-10-07"), null);
  let f = L.OPS_sopFreshness("2026-10-01T15:00:00", null, "2026-10-07");
  assert.deepStrictEqual([f.days, f.stale, f.source], [6, false, "edit"]);
  f = L.OPS_sopFreshness("2026-01-01T12:00:00", "2026-09-30T12:00:00", "2026-10-07");
  assert.deepStrictEqual([f.days, f.stale, f.source, f.at], [7, false, "review", "2026-09-30T12:00:00"]);
  f = L.OPS_sopFreshness("2026-04-09T12:00:00", "2026-01-01T12:00:00", "2026-10-07");
  assert.deepStrictEqual([f.days, f.stale, f.source], [181, true, "edit"]);
  assert.strictEqual(L.OPS_sopFreshness("2026-04-10T12:00:00", null, "2026-10-07").stale, false, "180 is not stale");
  assert.strictEqual(L.OPS_daysAgo(0), "today");
  assert.strictEqual(L.OPS_daysAgo(1), "1 day ago");
  assert.strictEqual(L.OPS_daysAgo(30), "30 days ago");
});

console.log("staffOpsLogic: " + n + " checks passed");
