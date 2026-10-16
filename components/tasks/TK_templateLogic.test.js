// Plain node: `node components/tasks/TK_templateLogic.test.js`.
// Recurring templates (TK_templateLogic.js): due-rule text, the next-dates
// preview (mirrors tk__generate), status and actions, validation, payload,
// and that the lists match the SQL checks in tasks-p2-4-recurring.sql.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const T = require("./TK_templateLogic.js");
const L = require("./TK_logic.js");

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

const SQL = fs.readFileSync(path.join(__dirname, "../../supabase/tasks-p2-4-recurring.sql"), "utf8");

t("SOP sections match TK_SOP_SECTION_IDS", () => {
  assert.deepStrictEqual(T.TK_TPL_SOP.map((s) => s.value), L.TK_SOP_SECTION_IDS);
});

t("roles match the assignee_role check", () => {
  const m = /task_templates_assignee_role_check\s+check \(assignee_role in \(([^)]*)\)\)/.exec(SQL);
  assert.ok(m, "check found");
  const ids = m[1].split(",").map((s) => s.trim().replace(/'/g, ""));
  assert.deepStrictEqual(T.TK_TPL_ROLES.map((r) => r.value), ids);
});

t("cadences match the cadence check", () => {
  const m = /task_templates_cadence\s+check \(cadence in \(([^)]*)\)\)/.exec(SQL);
  assert.ok(m, "check found");
  const ids = m[1].split(",").map((s) => s.trim().replace(/'/g, ""));
  assert.deepStrictEqual(T.TK_TPL_CADENCES.map((c) => c.value), ids);
});

t("every skip reason the SQL returns has text", () => {
  const re = /'reason', '([a-z_]+)'/g;
  const found = new Set();
  let m;
  while ((m = re.exec(SQL))) found.add(m[1]);
  assert.ok(found.size >= 3, "reasons found: " + [...found]);
  found.forEach((r) => assert.notStrictEqual(T.TK_tplSkipReasonText(r), "Skipped.", r));
  assert.ok(/'error'/.test(SQL));
  assert.notStrictEqual(T.TK_tplSkipReasonText("error"), "Skipped.");
});

t("kind", () => {
  assert.strictEqual(T.TK_tplKind("weekly"), "week");
  assert.strictEqual(T.TK_tplKind("monthly", "fiscal"), "month");
  assert.strictEqual(T.TK_tplKind("quarterly", "fiscal"), "quarter");
  assert.strictEqual(T.TK_tplKind("annually", "fiscal"), "year");
  assert.strictEqual(T.TK_tplKind("annually", "calendar"), "calendar_year");
});

t("status and actions", () => {
  assert.strictEqual(T.TK_tplStatus({ status: "draft", active: true }), "draft");
  assert.strictEqual(T.TK_tplStatus({ status: "active", active: true }), "active");
  assert.strictEqual(T.TK_tplStatus({ status: "active", active: false }), "paused");
  assert.strictEqual(T.TK_tplStatus({ status: "retired", active: true }), "retired");
  assert.deepStrictEqual(T.TK_tplActions({ status: "draft" }).map((a) => a.action), ["activate", "retire"]);
  assert.deepStrictEqual(T.TK_tplActions({ status: "active", active: true }).map((a) => a.action), ["pause", "retire"]);
  assert.deepStrictEqual(T.TK_tplActions({ status: "active", active: false }).map((a) => a.action), ["resume", "retire"]);
  assert.deepStrictEqual(T.TK_tplActions({ status: "retired" }).map((a) => a.action), ["draft"]);
  // every action is one tk_set_template_status accepts
  T.TK_tplActions({ status: "draft" })
    .concat(T.TK_tplActions({ status: "active" }), T.TK_tplActions({ status: "active", active: false }), T.TK_tplActions({ status: "retired" }))
    .forEach((a) => assert.ok(SQL.indexOf("p_action = '" + a.action + "'") >= 0, a.action));
});

t("effective rule: override, template, legacy offset", () => {
  const tpl = { due_rule: { type: "business_day", n: 5 }, due_offset_days: 10 };
  assert.deepStrictEqual(T.TK_tplEffectiveRule(tpl, { due_rule: { type: "eom" } }), { type: "eom" });
  assert.deepStrictEqual(T.TK_tplEffectiveRule(tpl, { due_rule: { type: "bogus" } }), tpl.due_rule);
  assert.deepStrictEqual(T.TK_tplEffectiveRule({ due_offset_days: -3 }, null), { type: "offset", days: -3 });
  assert.deepStrictEqual(T.TK_tplEffectiveRule({}, null), { type: "offset", days: 10 });
});

t("ordinals", () => {
  assert.deepStrictEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(T.TK_tplOrdinal),
    ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "101st", "111th"]);
});

t("due rule text", () => {
  assert.strictEqual(T.TK_dueRuleText({ type: "business_day", n: 5 }, "monthly"), "5th business day of the month after the month ends");
  assert.strictEqual(T.TK_dueRuleText({ type: "business_day", n: -1, month_offset: 0 }, "monthly"), "Last business day of the same month");
  assert.strictEqual(T.TK_dueRuleText({ type: "eom", offset_bd: 0 }, "quarterly"), "Last business day of the month after the quarter ends");
  assert.strictEqual(T.TK_dueRuleText({ type: "eom", offset_bd: 2, month_offset: 0 }, "quarterly"), "2 business days before the last business day of the quarter's last month");
  assert.strictEqual(T.TK_dueRuleText({ type: "day_of_month", day: 15, month_offset: 2 }, "annually"), "The 15th of the 2nd month after the year ends, or the next business day");
  assert.strictEqual(T.TK_dueRuleText({ type: "day_of_month", day: 1, roll: "none" }, "monthly"), "The 1st of the month after the month ends");
  assert.strictEqual(T.TK_dueRuleText({ type: "nth_weekday", n: -1, dow: 2, month_offset: 0 }, "monthly"), "Last Tuesday of the same month");
  assert.strictEqual(T.TK_dueRuleText({ type: "nth_weekday", n: 2, dow: 1, roll: "next" }, "monthly"), "2nd Monday of the month after the month ends, or the next business day");
  assert.strictEqual(T.TK_dueRuleText({ type: "weekday", dow: 5 }, "weekly"), "Friday of each week, or the next business day");
  assert.strictEqual(T.TK_dueRuleText({ type: "offset", days: 0 }, "monthly"), "Last day of the month");
  assert.strictEqual(T.TK_dueRuleText({ type: "offset", days: 1 }, "weekly"), "1 day after the week ends");
  assert.strictEqual(T.TK_dueRuleText({ type: "offset", days: -5 }, "quarterly"), "5 days before the quarter ends");
  assert.strictEqual(T.TK_dueRuleText(null, "monthly"), "No due rule");
});

t("default rules are valid and allowed for their cadence", () => {
  const R = require("./TK_recurrenceLogic.js");
  Object.keys(T.TK_TPL_RULES_BY_CADENCE).forEach((cad) => {
    T.TK_TPL_RULES_BY_CADENCE[cad].forEach((type) => {
      const r = T.TK_tplDefaultRule(type, cad);
      assert.strictEqual(r.type, type);
      assert.ok(R.TK_dueRuleValid(r), cad + " " + type);
      assert.ok(T.TK_TPL_RULE_LABELS[type], type);
    });
  });
});

const TODAY = "2026-10-15";

t("upcoming: monthly 5th business day, Jan 1 a holiday", () => {
  const tpl = { cadence: "monthly", due_rule: { type: "business_day", n: 5 }, lead_days: 7 };
  const u = T.TK_tplUpcoming(tpl, { today: TODAY, holidays: ["2027-01-01"], count: 3 });
  assert.deepStrictEqual(u.map((x) => [x.label, x.due, x.startOn, x.when]), [
    ["Oct 2026", "2026-11-06", "2026-10-30", "later"],
    ["Nov 2026", "2026-12-07", "2026-11-30", "later"],
    ["Dec 2026", "2027-01-08", "2027-01-01", "later"],
  ]);
});

t("upcoming: a period past the 7-day grace is missed, one inside it is now", () => {
  const tpl = { cadence: "monthly", due_rule: { type: "business_day", n: 5 }, lead_days: 7 };
  const u = T.TK_tplUpcoming(tpl, { today: TODAY, activatedOn: "2026-09-10", withMissed: true, count: 2 });
  assert.deepStrictEqual(u.map((x) => [x.label, x.due, x.when]), [
    ["Sep 2026", "2026-10-07", "missed"],
    ["Oct 2026", "2026-11-06", "later"],
  ]);
  // without withMissed the missed one is left out
  const v = T.TK_tplUpcoming(tpl, { today: TODAY, activatedOn: "2026-09-10", count: 1 });
  assert.strictEqual(v[0].label, "Oct 2026");
  // 8th of the month: exactly 7 days ago -> still created
  const w = T.TK_tplUpcoming({ cadence: "monthly", due_rule: { type: "day_of_month", day: 8, month_offset: 1, roll: "none" }, lead_days: 7 },
    { today: TODAY, activatedOn: "2026-09-10", withMissed: true, count: 1 });
  assert.deepStrictEqual([w[0].label, w[0].due, w[0].when], ["Sep 2026", "2026-10-08", "now"]);
});

t("upcoming: weekly on Friday", () => {
  const tpl = { cadence: "weekly", due_rule: { type: "weekday", dow: 5 }, lead_days: 2 };
  const u = T.TK_tplUpcoming(tpl, { today: TODAY, count: 2 });
  assert.deepStrictEqual(u.map((x) => [x.label, x.due, x.startOn, x.when]), [
    ["Wk of Oct 12", "2026-10-16", "2026-10-14", "now"],
    ["Wk of Oct 19", "2026-10-23", "2026-10-21", "later"],
  ]);
});

t("upcoming: quarterly on the 15th, rolled", () => {
  const tpl = { cadence: "quarterly", due_rule: { type: "day_of_month", day: 15, month_offset: 1 }, lead_days: 7 };
  const u = T.TK_tplUpcoming(tpl, { today: TODAY, count: 2 });
  assert.deepStrictEqual(u.map((x) => [x.label, x.due, x.when]), [
    ["Q3 2026", "2026-10-15", "now"],
    ["Q4 2026", "2027-01-15", "later"],
  ]);
});

t("upcoming: annual on a June fiscal year", () => {
  const tpl = { cadence: "annually", period_basis: "fiscal", due_rule: { type: "eom", month_offset: 3 }, lead_days: 30 };
  const u = T.TK_tplUpcoming(tpl, { today: TODAY, fye: "06-30", count: 1 });
  assert.deepStrictEqual(u.map((x) => [x.label, x.start, x.due]), [["FY 2027", "2026-07-01", "2027-09-30"]]);
  const c = T.TK_tplUpcoming(Object.assign({}, tpl, { period_basis: "calendar" }), { today: TODAY, fye: "06-30", count: 1 });
  assert.deepStrictEqual(c.map((x) => [x.label, x.start, x.due]), [["2026", "2026-01-01", "2027-03-31"]]);
});

t("upcoming: an override rule wins; bad or disallowed rules give null", () => {
  const tpl = { cadence: "monthly", due_rule: { type: "business_day", n: 5 }, lead_days: 7 };
  const u = T.TK_tplUpcoming(tpl, { today: TODAY, count: 1, override: { due_rule: { type: "eom" } } });
  assert.deepStrictEqual([u[0].label, u[0].due], ["Sep 2026", "2026-10-30"]);
  assert.strictEqual(T.TK_tplUpcoming({ cadence: "monthly", due_rule: { type: "weekday", dow: 1 } }, { today: TODAY }), null);
  assert.strictEqual(T.TK_tplUpcoming({ cadence: "monthly", due_rule: { type: "business_day", n: 40 } }, { today: TODAY }), null);
  assert.strictEqual(T.TK_tplUpcoming(tpl, {}), null);
});

t("strip period", () => {
  assert.strictEqual(T.TK_tplStripPeriod("Reconcile banks · Sep 2026"), "Reconcile banks");
  assert.strictEqual(T.TK_tplStripPeriod("Sales tax · Q3 2026"), "Sales tax");
  assert.strictEqual(T.TK_tplStripPeriod("990 prep · FY 2027"), "990 prep");
  assert.strictEqual(T.TK_tplStripPeriod("1099s · 2026"), "1099s");
  assert.strictEqual(T.TK_tplStripPeriod("Weekly check-in · Wk of Sep 7"), "Weekly check-in");
  assert.strictEqual(T.TK_tplStripPeriod("Pay 2026 taxes"), "Pay 2026 taxes");
  assert.strictEqual(T.TK_tplStripPeriod("  x  "), "x");
});

t("checklist lines", () => {
  assert.deepStrictEqual(T.TK_tplChecklistLines(" a \n\n b\n"), ["a", "b"]);
  assert.strictEqual(T.TK_tplChecklistLines(Array(60).fill("x").join("\n")).length, 50);
});

t("validate", () => {
  const ok = Object.assign(T.TK_tplBlank(), { title: "Reconcile" });
  assert.strictEqual(T.TK_tplValidate(ok), null);
  assert.ok(T.TK_tplValidate(Object.assign({}, ok, { title: " " })).title);
  assert.ok(T.TK_tplValidate(Object.assign({}, ok, { title: "Reconcile · Sep 2026" })).title);
  assert.ok(T.TK_tplValidate(Object.assign({}, ok, { lead_days: 91 })).lead_days);
  assert.ok(T.TK_tplValidate(Object.assign({}, ok, { lead_days: 1.5 })).lead_days);
  assert.ok(T.TK_tplValidate(Object.assign({}, ok, { cadence: "weekly" })).rule, "business_day is not weekly");
  assert.strictEqual(T.TK_tplValidate(Object.assign({}, ok, { cadence: "weekly", rule: { type: "weekday", dow: 5 } })), null);
  assert.ok(T.TK_tplValidate(Object.assign({}, ok, { rule: { type: "business_day", n: 0 } })).rule);
  assert.ok(T.TK_tplValidate(Object.assign({}, ok, { estimate_minutes: "0" })).estimate_minutes);
  assert.strictEqual(T.TK_tplValidate(Object.assign({}, ok, { estimate_minutes: "45" })), null);
  assert.ok(T.TK_tplValidate(Object.assign({}, ok, { checklist: Array(51).fill("x") })).checklist);
});

t("row -> draft -> payload", () => {
  const row = {
    id: "x", title: "Close", cadence: "annually", due_rule: null, due_offset_days: 20, lead_days: 14,
    plan_tiers: ["basic"], client_ids: [], priority: "high", checklist: ["a"], assignee_role: "backup",
    review_required: true, sop_section: "reporting", estimate_minutes: 30, period_basis: "fiscal", status: "active", active: false,
  };
  const d = T.TK_tplFromRow(row);
  assert.deepStrictEqual(d.rule, { type: "offset", days: 20 });
  assert.strictEqual(d.estimate_minutes, "30");
  assert.strictEqual(d.active, false);
  const p = T.TK_tplToPayload(d);
  assert.deepStrictEqual(p, {
    title: "Close", cadence: "annually", due_rule: { type: "offset", days: 20 }, lead_days: 14, plan_tiers: ["basic"],
    client_ids: [], priority: "high", checklist: ["a"], assignee_role: "backup", review_required: true,
    sop_section: "reporting", estimate_minutes: "30", period_basis: "fiscal", due_offset_days: 20,
  });
  const m = T.TK_tplToPayload(Object.assign(T.TK_tplBlank(), { title: "x", period_basis: "fiscal" }));
  assert.strictEqual(m.period_basis, "calendar", "basis only matters for annual");
  assert.strictEqual(m.estimate_minutes, "");
  assert.strictEqual(m.due_offset_days, undefined);
  // every payload key is one tk_save_template reads
  Object.keys(p).forEach((k) => assert.ok(SQL.indexOf("p_tpl ->> '" + k + "'") >= 0 || SQL.indexOf("p_tpl -> '" + k + "'") >= 0, k));
});

t("run summary", () => {
  assert.strictEqual(T.TK_tplRunSummary({ created: 0, by_assignee: {}, skipped: [], missed: [] }), "Nothing new to create.");
  assert.strictEqual(
    T.TK_tplRunSummary({ created: 3, by_assignee: { a: 2, b: 1 }, skipped: [{}], missed: [{}, {}] }),
    "Created 3 tasks for 2 people. 1 skipped. 2 missed periods listed.",
  );
  assert.strictEqual(T.TK_tplRunSummary({ dry_run: true, would_create: [{}], upcoming: [{}, {}], skipped: [], missed: [] }), "1 task would be created now. 2 more coming up.");
  assert.strictEqual(T.TK_tplRunSummary({ dry_run: true, would_create: [], upcoming: [], skipped: [], missed: [] }), "Nothing would be created now.");
});

t("groups: sets first, then firm; on before draft", () => {
  const sets = [{ id: "s1", name: "MGB Standard Monthly Close" }, { id: "gone", name: "Old", deleted_at: "2026-01-01" }];
  const g = T.TK_tplGroups(
    [
      { id: 1, title: "b", status: "draft", template_set_id: "s1" },
      { id: 2, title: "a", status: "draft", template_set_id: "s1" },
      { id: 3, title: "z", status: "active", active: true },
      { id: 4, title: "y", status: "retired" },
      { id: 5, title: "x", status: "draft", template_set_id: "gone" },
    ],
    sets,
  );
  assert.deepStrictEqual(g.map((x) => x.label), ["MGB Standard Monthly Close", "Firm templates"]);
  assert.deepStrictEqual(g[0].templates.map((x) => x.id), [2, 1]);
  assert.deepStrictEqual(g[1].templates.map((x) => x.id), [3, 5, 4]);
});

t("applies to", () => {
  assert.ok(T.TK_tplAppliesTo({ plan_tiers: [], client_ids: [] }, { id: "a", plan: "basic" }));
  assert.ok(T.TK_tplAppliesTo({ plan_tiers: ["basic"], client_ids: [] }, { id: "a", plan: "basic" }));
  assert.ok(!T.TK_tplAppliesTo({ plan_tiers: ["premium"], client_ids: [] }, { id: "a", plan: "basic" }));
  assert.ok(T.TK_tplAppliesTo({ plan_tiers: ["premium"], client_ids: ["a"] }, { id: "a", plan: "basic" }));
});

t("error text covers every template reason the SQL raises", () => {
  const sql = fs.readFileSync(path.join(__dirname, "../../supabase/tasks-p2-4-recurring.sql"), "utf8");
  const raised = new Set((sql.match(/raise exception '(tk_[a-z_]+)'/g) || []).map((m) => m.match(/'(tk_[a-z_]+)'/)[1]));
  raised.forEach((r) => assert.ok(T.TK_tplErrorText({ reason: r }), "no text for " + r));
  assert.strictEqual(T.TK_tplErrorText({ code: "tk_offline" }), "You're offline. Try again when you're back online.");
  assert.strictEqual(T.TK_tplErrorText({ code: "tk_error" }), null);
  assert.strictEqual(T.TK_tplErrorText(null), null);
});

console.log("TK_templateLogic: " + n + " tests passed");
