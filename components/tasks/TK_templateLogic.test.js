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
// S8b: tk_save_template also reads assignee_email and leave_unassigned there.
const SQL_S8B = fs.readFileSync(path.join(__dirname, "../../supabase/tasks-p2-10-asana-import-v2.sql"), "utf8");

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
    client_ids: [], priority: "high", checklist: ["a"], assignee_role: "backup", assignee_email: "", leave_unassigned: false,
    review_required: true, sop_section: "reporting", estimate_minutes: "30", period_basis: "fiscal", due_offset_days: 20,
  });
  const m = T.TK_tplToPayload(Object.assign(T.TK_tplBlank(), { title: "x", period_basis: "fiscal" }));
  assert.strictEqual(m.period_basis, "calendar", "basis only matters for annual");
  assert.strictEqual(m.estimate_minutes, "");
  assert.strictEqual(m.due_offset_days, undefined);
  // every payload key is one tk_save_template reads
  const both = SQL + SQL_S8B;
  Object.keys(p).forEach((k) => assert.ok(both.indexOf("p_tpl ->> '" + k + "'") >= 0 || both.indexOf("p_tpl -> '" + k + "'") >= 0, k));
});

t("assign to: role, a named person, or leave unassigned (S8b)", () => {
  const base = { id: "x", title: "Close", cadence: "monthly", assignee_role: "account_manager" };
  const role = T.TK_tplFromRow(base);
  assert.strictEqual(role.assign_mode, "role");
  assert.strictEqual(T.TK_tplAssignText(base), "Account manager");
  const person = T.TK_tplFromRow(Object.assign({}, base, { assignee_email: "Pat@Example.test" }));
  assert.strictEqual(person.assign_mode, "person");
  assert.strictEqual(person.assignee_email, "pat@example.test");
  let p = T.TK_tplToPayload(person);
  assert.strictEqual(p.assignee_email, "pat@example.test");
  assert.strictEqual(p.leave_unassigned, false);
  assert.strictEqual(T.TK_tplAssignText({ assignee_email: "pat@example.test" }, (e) => (e === "pat@example.test" ? "Pat" : "")), "Pat");
  const un = T.TK_tplFromRow(Object.assign({}, base, { leave_unassigned: true }));
  assert.strictEqual(un.assign_mode, "unassigned");
  p = T.TK_tplToPayload(un);
  assert.strictEqual(p.assignee_email, "", "an empty string clears the named person");
  assert.strictEqual(p.leave_unassigned, true);
  assert.strictEqual(T.TK_tplAssignText({ leave_unassigned: true }), "Unassigned");
  // back to the role clears both
  p = T.TK_tplToPayload(Object.assign({}, person, { assign_mode: "role" }));
  assert.strictEqual(p.assignee_email, "");
  assert.strictEqual(p.leave_unassigned, false);
  // a named person must be picked
  const errs = T.TK_tplValidate(Object.assign(T.TK_tplBlank(), { title: "Close", assign_mode: "person", assignee_email: "" }));
  assert.ok(errs && errs.assignee_email);
  assert.ok(T.TK_tplErrorText({ reason: "tk_bad_assignee" }));
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

t("TK_api passes every template reason the SQL raises", () => {
  const api = fs.readFileSync(path.join(__dirname, "TK_api.js"), "utf8");
  const list = /var TK_REASONS = \[([\s\S]*?)\];/.exec(api)[1];
  const raised = new Set((SQL.match(/raise exception '(tk_[a-z_]+)'/g) || []).map((m) => m.match(/'(tk_[a-z_]+)'/)[1]));
  raised.forEach((r) => assert.ok(list.indexOf('"' + r + '"') >= 0, "TK_REASONS lacks " + r));
});

// ---- review fixes (2026-10-16) ----

t("cadence lock: new and never-on drafts are open; on, paused, retired, once-on or made-a-task are locked", () => {
  assert.strictEqual(T.TK_tplCadenceLocked({ id: null, status: "draft" }, 0), false);
  assert.strictEqual(T.TK_tplCadenceLocked({ id: "a", status: "draft", activated_at: null }, 0), false);
  assert.strictEqual(T.TK_tplCadenceLocked({ id: "a", status: "active", activated_at: "2026-10-01T17:00:00Z" }, 0), true);
  assert.strictEqual(T.TK_tplCadenceLocked({ id: "a", status: "retired" }, 0), true);
  assert.strictEqual(T.TK_tplCadenceLocked({ id: "a", status: "draft", activated_at: "2026-10-01T17:00:00Z" }, 0), true);
  assert.strictEqual(T.TK_tplCadenceLocked({ id: "a", status: "draft" }, 2), true);
  const d = T.TK_tplFromRow({ id: "a", status: "draft", activated_at: "2026-10-01T17:00:00Z" });
  assert.strictEqual(T.TK_tplCadenceLocked(d, 0), true, "the editor draft keeps activated_at");
  assert.ok(!("activated_at" in T.TK_tplToPayload(d)), "activated_at is never sent");
  assert.ok(T.TK_tplErrorText({ reason: "tk_cadence_locked" }).indexOf("Retire it") >= 0);
});

t("Central date: an evening UTC timestamp is still the Central day", () => {
  assert.strictEqual(T.TK_tplCentralDate("2026-10-02T03:30:00Z"), "2026-10-01");
  assert.strictEqual(T.TK_tplCentralDate("2026-10-01T17:00:00Z"), "2026-10-01");
  assert.strictEqual(T.TK_tplCentralDate("2026-01-01T05:59:00Z"), "2025-12-31");
  assert.strictEqual(T.TK_tplCentralDate(null), null);
  assert.strictEqual(T.TK_tplCentralDate("nope"), null);
});

t("activatedOn: later of activation and set live_since for real clients; activation for test clients", () => {
  const tpl = { activated_at: "2026-10-01T17:00:00Z", template_set_id: "s1" };
  const set = { id: "s1", live_since: "2026-12-01T18:00:00Z" };
  assert.strictEqual(T.TK_tplActivatedOn(tpl, { set }), "2026-12-01");
  assert.strictEqual(T.TK_tplActivatedOn(tpl, { set, testClient: true }), "2026-10-01");
  assert.strictEqual(T.TK_tplActivatedOn(tpl, { set: { id: "s1", live_since: "2026-09-01T18:00:00Z" } }), "2026-10-01");
  assert.strictEqual(T.TK_tplActivatedOn(tpl, { set: { id: "s1", live_since: null } }), "2026-10-01");
  assert.strictEqual(T.TK_tplActivatedOn({ activated_at: "2026-10-02T03:30:00Z" }, { set }), "2026-10-01", "firm template: no set");
  // the preview then lists nothing from before the set went live
  const rows = T.TK_tplUpcoming(
    { cadence: "monthly", due_rule: { type: "offset", days: 10 }, lead_days: 14 },
    { today: "2026-12-15", activatedOn: T.TK_tplActivatedOn(tpl, { set }), count: 3, withMissed: true },
  );
  assert.ok(rows.every((r) => r.due >= "2026-12-01"), JSON.stringify(rows));
});

t("standard_set_live reads like tk__jsonb_bool", () => {
  assert.strictEqual(T.TK_tplBool(true), true);
  assert.strictEqual(T.TK_tplBool("true"), true);
  assert.strictEqual(T.TK_tplBool(" Yes "), true);
  assert.strictEqual(T.TK_tplBool(1), true);
  assert.strictEqual(T.TK_tplBool("off"), false);
  assert.strictEqual(T.TK_tplBool(0), false);
  assert.strictEqual(T.TK_tplBool("maybe"), null);
  assert.strictEqual(T.TK_tplBool(null), null);
  assert.strictEqual(T.TK_tplBool(undefined), null);
  assert.ok(/'true', 't', 'yes', 'y', 'on', '1'/.test(SQL) && /'false', 'f', 'no', 'n', 'off', '0', ''/.test(SQL), "word lists match the SQL");
});

t("override payload: a non-admin never sends or changes the admin's no-approval", () => {
  const stored = { review_required: false, title: "Admin title", checklist: ["a"] };
  const bk = T.TK_tplOverridePayload({ title: "BK title", review: "no" }, { isAdmin: false, stored });
  assert.deepStrictEqual(bk, { title: "BK title", checklist: ["a"] });
  const bkYes = T.TK_tplOverridePayload({ review: "yes" }, { isAdmin: false, stored });
  assert.ok(!("review_required" in bkYes), "locked: the select can't switch it back on either");
  assert.deepStrictEqual(T.TK_tplOverridePayload({ review: "no" }, { isAdmin: false, stored: {} }), {}, "a non-admin can't send false");
  assert.deepStrictEqual(T.TK_tplOverridePayload({ review: "yes" }, { isAdmin: false, stored: {} }), { review_required: true });
  assert.deepStrictEqual(T.TK_tplOverridePayload({ review: "no", role: "backup" }, { isAdmin: true, stored }), {
    assignee_role: "backup",
    review_required: false,
    checklist: ["a"],
  });
  assert.deepStrictEqual(T.TK_tplOverridePayload({ review: "" }, { isAdmin: true, stored }), { checklist: ["a"] }, "admin: blank clears it");
  assert.strictEqual(T.TK_tplOverridePayload({ title: "Close · Sep 2026" }, {}).title, "Close");
  // a stored "needs approval" stays on for a non-admin, whatever they pick
  const on = { review_required: true };
  assert.deepStrictEqual(T.TK_tplOverridePayload({ review: "" }, { isAdmin: false, stored: on }), { review_required: true });
  assert.deepStrictEqual(T.TK_tplOverridePayload({ review: "no" }, { isAdmin: false, stored: on }), { review_required: true });
  assert.deepStrictEqual(T.TK_tplOverridePayload({ review: "" }, { isAdmin: true, stored: on }), {}, "an admin can still clear it");
});

t("Make task outcome: created / exists close the row; skipped keeps it with the reason", () => {
  assert.deepStrictEqual(T.TK_tplIssueOutcome({ status: "created", reminder_id: "x" }), { closed: true, text: "Task made." });
  assert.strictEqual(T.TK_tplIssueOutcome({ status: "exists" }).closed, true);
  const s = T.TK_tplIssueOutcome({ status: "skipped", reason: "no_assignee" });
  assert.strictEqual(s.closed, false);
  assert.ok(s.text.indexOf("Nobody to give it to") >= 0, s.text);
  assert.strictEqual(T.TK_tplIssueOutcome(null).closed, false);
});

console.log("TK_templateLogic: " + n + " tests passed");
