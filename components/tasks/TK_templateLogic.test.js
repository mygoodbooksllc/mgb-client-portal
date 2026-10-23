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

t("every skip reason slate-rhythm-2b returns has text", () => {
  const sql = fs.readFileSync(path.join(__dirname, "../../supabase/slate-rhythm-2b-issue-gate.sql"), "utf8");
  const re = /'reason', '([a-z_]+)'/g;
  const found = new Set();
  let m;
  while ((m = re.exec(sql))) found.add(m[1]);
  assert.deepStrictEqual([...found].sort(), ["no_rhythm", "rhythm_off"]);
  found.forEach((r) => assert.notStrictEqual(T.TK_tplSkipReasonText(r), "Skipped.", r));
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

// ---- P4-2: Close checklist linked to tasks ----------------------------------------
const SQL_P42 = fs.readFileSync(path.join(__dirname, "../../supabase/tasks-p4-2-close-checklist.sql"), "utf8");

t("P4-2: the five linked keys match the SQL activation list; sent is never linked", () => {
  assert.deepStrictEqual(T.TK_CLOSE_LINKED_KEYS, ["bank_feed", "bank_rec", "card_rec", "entries", "review"]);
  assert.ok(SQL_P42.indexOf("('bank_feed', 'bank_rec', 'card_rec', 'entries', 'review')") >= 0, "SQL activates the same five");
  assert.strictEqual(T.TK_closeIsLinkedKey("sent"), false);
  assert.strictEqual(T.TK_closeIsLinkedKey("ledger_reviewed"), false);
  assert.strictEqual(T.TK_closeIsLinkedKey("bank_rec"), true);
  T.TK_CLOSE_LINKED_KEYS.forEach((k) => assert.ok(T.TK_CLOSE_ITEM_LABELS[k], k));
});

t("P4-2: labels match app.jsx CLOSE_CHECKLIST", () => {
  const app = fs.readFileSync(path.join(__dirname, "../../app.jsx"), "utf8");
  T.TK_CLOSE_LINKED_KEYS.forEach((k) => {
    assert.ok(app.indexOf('{ key: "' + k + '", label: "' + T.TK_CLOSE_ITEM_LABELS[k] + '" }') >= 0, k);
  });
});

t("P4-2: overlap words mirror the SQL and match whole words only", () => {
  assert.ok(SQL_P42.indexOf("\\m(rec|recs|reconcil\\w*|bank|card|close)\\M") >= 0, "SQL regex");
  assert.strictEqual(T.TK_CLOSE_OVERLAP_RE.source, "\\b(rec|recs|reconcil\\w*|bank|card|close)\\b");
  ["Bank rec", "Reconcile checking", "Month-end close", "Credit card statements", "Monthly recs", "BANK FEED"].forEach((s) =>
    assert.ok(T.TK_closeOverlapTitle(s), s),
  );
  ["Payroll", "Recurring invoices", "Closed captioning", "Record donations", "Disclosure letter", "Cardinal grant", ""].forEach((s) =>
    assert.ok(!T.TK_closeOverlapTitle(s), s),
  );
  assert.ok(!T.TK_closeOverlapTitle(null));
});

t("P4-2: overlap counts close_key or title, never a standard-set member", () => {
  assert.ok(T.TK_closeOverlaps({ title: "Bank rec" }));
  assert.ok(T.TK_closeOverlaps({ title: "Monthly thing", close_key: "entries" }));
  assert.ok(!T.TK_closeOverlaps({ title: "Bank rec", template_set_id: "s1" }));
  assert.ok(!T.TK_closeOverlaps({ title: "Payroll" }));
  assert.ok(!T.TK_closeOverlaps(null));
});

t("P4-2: overlap warning text", () => {
  assert.strictEqual(T.TK_closeOverlapText(0), "");
  assert.strictEqual(
    T.TK_closeOverlapText(3),
    "This client has 3 recurring templates that look like month-end work (bank rec, reconcile, close). Turn them off or you may get duplicates.",
  );
  assert.strictEqual(
    T.TK_closeOverlapText(1),
    "This client has 1 recurring template that looks like month-end work (bank rec, reconcile, close). Turn it off or you may get duplicates.",
  );
});

t("P4-2: activation warning only for month-end-looking templates and opted-in clients", () => {
  assert.strictEqual(T.TK_closeActivateWarning({ title: "Bank rec" }, []), "");
  assert.strictEqual(T.TK_closeActivateWarning({ title: "Payroll" }, ["Acme"]), "");
  assert.ok(T.TK_closeActivateWarning({ title: "Bank rec" }, ["Acme"]).indexOf("Acme gets month-end tasks") >= 0);
  assert.ok(T.TK_closeActivateWarning({ title: "Close" }, ["A", "B"]).indexOf("2 clients get") >= 0);
});

t("P4-2: 14.2 Looks done mapping", () => {
  const ok = [
    { key: "bank_active", ok: true, label: "Bank accounts active through month end" },
    { key: "uncategorized", ok: true, label: "Uncategorized is zero" },
    { key: "reconciled", ok: true, label: "Reconciled through month end" },
    { key: "undeposited", ok: false, label: "Undeposited funds cleared" },
  ];
  assert.strictEqual(
    T.TK_closeLooksDone("bank_feed", ok).text,
    "Looks done. QuickBooks shows Bank accounts active through month end and uncategorized is zero.",
  );
  assert.strictEqual(T.TK_closeLooksDone("bank_rec", ok).text, "Looks done. QuickBooks shows Reconciled through month end.");
  assert.strictEqual(T.TK_closeLooksDone("card_rec", ok), null, "nothing maps to card_rec");
  assert.strictEqual(T.TK_closeLooksDone("entries", ok), null);
  assert.strictEqual(T.TK_closeLooksDone("sent", ok), null);
  const half = ok.map((c) => (c.key === "uncategorized" ? { ...c, ok: false } : c));
  assert.strictEqual(T.TK_closeLooksDone("bank_feed", half), null, "both checks must pass");
  assert.strictEqual(T.TK_closeLooksDone("bank_feed", ok.filter((c) => c.key !== "bank_active")), null, "missing check");
  assert.strictEqual(T.TK_closeLooksDone("bank_rec", [{ key: "reconciled", ok: "true" }]), null, "only a real true");
  assert.strictEqual(T.TK_closeLooksDone("bank_rec", null), null);
});

t("P4-2: month labels, drawer link text, starts line", () => {
  assert.strictEqual(T.TK_closeMonthLabel("2026-11"), "November 2026");
  assert.strictEqual(T.TK_closeMonthLabel("2026-01-01"), "January 2026");
  assert.strictEqual(T.TK_closeMonthLabel("2026-13"), "");
  assert.strictEqual(T.TK_closeMonthLabel(null), "");
  assert.strictEqual(T.TK_closeNextMonth("2026-12-01"), "2027-01-01");
  assert.strictEqual(T.TK_closeNextMonth("2026-09-01"), "2026-10-01");
  assert.strictEqual(T.TK_closeLinkText("bank_rec", "2026-11-01"), "Close checklist: Bank accounts reconciled, November 2026");
  assert.strictEqual(T.TK_closeLinkText("sent", "2026-11-01"), "");
  assert.strictEqual(T.TK_closeLinkText("bank_rec", null), "");
  assert.strictEqual(T.TK_closeOptinStartsText({ enabled: false, starts: "2026-11-01" }), "");
  assert.strictEqual(
    T.TK_closeOptinStartsText({ enabled: true, starts: "2026-11-01" }),
    "First tasks: the November 2026 close, due early December 2026.",
  );
  assert.ok(T.TK_closeOptinStartsText({ enabled: true, starts: "2026-11-01", set_live: true }).indexOf("live for every client") >= 0);
  assert.strictEqual(T.TK_closeOptinRhythmText({ enabled: true }), "");
  assert.strictEqual(T.TK_closeOptinRhythmText(null), "");
  assert.strictEqual(T.TK_closeOptinRhythmText({ rhythm_replaces: "true" }), "");
  assert.ok(T.TK_closeOptinRhythmText({ rhythm_replaces: true }).indexOf("month rhythm") >= 0);
});

t("P4-2: row chip, checked state and toast", () => {
  assert.strictEqual(T.TK_closeChip({ status: "ready_for_review" }).label, "In review");
  assert.strictEqual(T.TK_closeChip({ status: "done", approved_at: "x" }).label, "Approved");
  assert.strictEqual(T.TK_closeChip({ status: "waiting_client" }).label, "Waiting on client");
  assert.strictEqual(T.TK_closeChip(null), null);
  assert.strictEqual(T.TK_closeRowDone({ status: "ready_for_review" }, { done: true }), false, "the task wins");
  assert.strictEqual(T.TK_closeRowDone({ status: "done" }, null), true);
  assert.strictEqual(T.TK_closeRowDone(null, { done: true }), true, "no task: the item");
  assert.strictEqual(T.TK_closeTickToast({ status: "review", message: "Sent for review" }, true), "Sent for review");
  assert.strictEqual(T.TK_closeTickToast({ status: "saved" }, true), "Checked.");
  assert.strictEqual(T.TK_closeTickToast({ status: "saved" }, false), "Unchecked.");
  assert.strictEqual(T.TK_closeTickToast({ status: "unchanged" }, true), "");
});

t("P4-2: periodFloor skips periods before the opt-in month", () => {
  const tpl = { cadence: "monthly", due_rule: { type: "business_day", n: 5 }, lead_days: 7 };
  const base = { today: "2026-10-16", activatedOn: "2026-09-01", count: 2, holidays: [] };
  const all = T.TK_tplUpcoming(tpl, base);
  assert.ok(all && all.length === 2, "unfloored list");
  assert.strictEqual(all[0].start, "2026-10-01", "October close first (September is past the grace window)");
  const floored = T.TK_tplUpcoming(tpl, { ...base, periodFloor: "2026-11-01" });
  assert.strictEqual(floored.length, 2);
  floored.forEach((p) => assert.ok(p.start >= "2026-11-01", p.start));
  assert.strictEqual(floored[0].start, "2026-11-01");
  assert.strictEqual(floored[0].due.slice(0, 7), "2026-12", "the November close is due in December");
});

// ---- Slate month rhythm, slice 3: firm_part templates ------------------------
const RH = require("./TK_rhythmLogic.js");

t("slice 3: firm_part stays out of the old rule lists", () => {
  ["weekly", "monthly", "quarterly", "annually"].forEach((c) => assert.ok(T.TK_TPL_RULES_BY_CADENCE[c].indexOf("firm_part") < 0, c));
  assert.deepStrictEqual(T.TK_tplRuleTypes("monthly", false), T.TK_TPL_RULES_BY_CADENCE.monthly);
  assert.deepStrictEqual(T.TK_tplRuleTypes("monthly", false, "business_day"), T.TK_TPL_RULES_BY_CADENCE.monthly);
  assert.deepStrictEqual(T.TK_tplRuleTypes("monthly", true), T.TK_TPL_RULES_BY_CADENCE.monthly.concat(["firm_part"]));
  assert.deepStrictEqual(T.TK_tplRuleTypes("quarterly", false, "firm_part").slice(-1), ["firm_part"], "an existing firm_part rule stays editable");
  assert.deepStrictEqual(T.TK_tplRuleTypes("weekly", true), T.TK_TPL_RULES_BY_CADENCE.weekly, "never weekly");
  assert.strictEqual(T.TK_tplRuleAllowed("monthly", "firm_part"), true);
  assert.strictEqual(T.TK_tplRuleAllowed("weekly", "firm_part"), false);
  assert.strictEqual(T.TK_tplRuleAllowed("monthly", "weekday"), false);
  assert.strictEqual(T.TK_tplRuleAllowed("nope", "offset"), false);
  const r = T.TK_tplDefaultRule("firm_part", "monthly");
  assert.deepStrictEqual(r, { type: "firm_part", part: "check_in", month_offset: 1 });
  assert.ok(require("./TK_recurrenceLogic.js").TK_dueRuleValid(r));
  assert.ok(T.TK_TPL_RULE_LABELS.firm_part);
});

t("slice 3: firm_part rule text, with and without a rhythm", () => {
  const rh = RH.TK_rhythmDefault();
  const fp = (part, mo) => ({ type: "firm_part", part, month_offset: mo });
  assert.strictEqual(T.TK_dueRuleText(fp("reports", 1), "monthly"), "On the Send reports date, next month");
  assert.strictEqual(T.TK_dueRuleText(fp("reports", 1), "monthly", rh), "On the Send reports date (14th), next month");
  assert.strictEqual(T.TK_dueRuleText(fp("check_in", 0), "monthly", rh), "On the Check in date (4th), same month");
  assert.strictEqual(T.TK_dueRuleText(fp("follow_up", 2), "monthly", rh), "On the Follow up date (24th), 2 months later");
  assert.strictEqual(T.TK_dueRuleText({ type: "firm_part", part: "follow_up" }, "monthly"), "On the Follow up date, next month", "no month_offset means 1");
  assert.strictEqual(T.TK_dueRuleText(fp("reports", 1), "quarterly", rh), "On the Send reports date (14th) of the month after the quarter ends");
  const custom = { parts: [{ key: "check_in", label: "Kickoff", day: 3 }, { key: "reports", label: "Reports out", day: 12 }, { key: "follow_up", label: "Chase", day: 20 }], roll: "prev" };
  assert.strictEqual(T.TK_dueRuleText(fp("reports", 1), "monthly", custom), "On the Reports out date (12th), next month");
  // every other rule reads the same with or without a rhythm
  [{ type: "business_day", n: 5 }, { type: "offset", days: 10 }, { type: "day_of_month", day: 15 }].forEach((x) =>
    assert.strictEqual(T.TK_dueRuleText(x, "monthly", rh), T.TK_dueRuleText(x, "monthly")),
  );
});

t("slice 3: upcoming with a rhythm matches the resolver; no rhythm gives null", () => {
  const tpl = { cadence: "monthly", due_rule: { type: "firm_part", part: "reports", month_offset: 1 }, lead_days: 10 };
  assert.strictEqual(T.TK_tplUpcoming(tpl, { today: "2026-10-21", count: 2 }), null, "fails closed without a rhythm");
  const live = { parts: RH.TK_rhythmDefault().parts, roll: "prev" };
  const u = T.TK_tplUpcoming(tpl, { today: "2026-10-21", activatedOn: "2026-10-01", count: 2, rhythm: live, holidays: [] });
  assert.deepStrictEqual(u.map((x) => [x.label, x.due, x.startOn, x.when]), [
    ["Sep 2026", "2026-10-14", "2026-10-04", "now"],
    ["Oct 2026", "2026-11-13", "2026-11-03", "later"],
  ]);
  assert.strictEqual(T.TK_tplUpcoming({ cadence: "weekly", due_rule: tpl.due_rule }, { today: "2026-10-21", rhythm: live }), null, "never weekly");
});

t("slice 3: the page hides the rhythm set and firm_part templates when off", () => {
  const sets = [{ id: "s1", name: "MGB Standard", is_standard: true, gate_key: "standard_set_live" }, { id: "s2", name: "MGB Month Rhythm", is_standard: false, gate_key: "month_rhythm_enabled" }];
  const tpls = [
    { id: "a", template_set_id: "s1", due_rule: { type: "business_day", n: 5 } },
    { id: "b", template_set_id: "s2", due_rule: { type: "firm_part", part: "check_in" } },
    { id: "c", template_set_id: null, due_rule: { type: "firm_part", part: "reports" } },
    { id: "d", template_set_id: null, due_rule: null },
  ];
  const off = T.TK_tplHideRhythm(tpls, sets, false);
  assert.deepStrictEqual(off.templates.map((x) => x.id), ["a", "d"]);
  assert.deepStrictEqual(off.sets.map((x) => x.id), ["s1"]);
  const on = T.TK_tplHideRhythm(tpls, sets, true);
  assert.strictEqual(on.templates, tpls);
  assert.strictEqual(on.sets, sets);
  assert.strictEqual(T.TK_tplIsRhythmSet(sets[1]), true);
  assert.strictEqual(T.TK_tplIsRhythmSet(sets[0]), false);
  assert.strictEqual(T.TK_tplIsRhythmSet({ id: "x" }), false, "older rows without gate_key");
  // with no rhythm template anywhere the groups are exactly as before
  const old = tpls.filter((x) => x.id === "a" || x.id === "d");
  assert.deepStrictEqual(T.TK_tplGroups(T.TK_tplHideRhythm(old, [sets[0]], false).templates, [sets[0]]), T.TK_tplGroups(old, [sets[0]]));
});

t("slice 3: description round trip; older templates save exactly as before", () => {
  const row = { id: "x", title: "Monthly close", cadence: "monthly", due_rule: { type: "business_day", n: 5 }, lead_days: 7 };
  const before = T.TK_tplToPayload(T.TK_tplFromRow(row));
  assert.ok(!("description" in before), "no description key for a row without one");
  assert.ok(!("email_kind" in before));
  const withD = T.TK_tplFromRow(Object.assign({}, row, { description: "Do the thing.", email_kind: "reports" }));
  assert.strictEqual(withD.description, "Do the thing.");
  assert.strictEqual(withD.email_kind, "reports");
  assert.strictEqual(T.TK_tplToPayload(withD).description, "Do the thing.");
  assert.ok(!("email_kind" in T.TK_tplToPayload(withD)), "email_kind is never sent");
  withD.description = "   ";
  assert.strictEqual(T.TK_tplToPayload(withD).description, "", "clearing sends an empty string");
  const typed = Object.assign(T.TK_tplBlank(), { title: "x", description: " New text " });
  assert.strictEqual(T.TK_tplToPayload(typed).description, "New text");
  assert.strictEqual(T.TK_tplValidate(Object.assign(T.TK_tplBlank(), { title: "x", description: "y".repeat(2001) })).description.length > 0, true);
  const fpDraft = Object.assign(T.TK_tplBlank(), { title: "x", rule: { type: "firm_part", part: "reports", month_offset: 1 } });
  assert.strictEqual(T.TK_tplValidate(fpDraft), null, "a firm_part rule saves for monthly");
  assert.ok(T.TK_tplValidate(Object.assign({}, fpDraft, { cadence: "weekly" })).rule, "but not for weekly");
});

t("slice 3: the seed SQL has the eight final titles, parts and email kinds", () => {
  const sql = fs.readFileSync(path.join(__dirname, "../../supabase/slate-rhythm-3-templates.sql"), "utf8");
  const want = [
    ["month_rhythm:1_check_in", "Check in with the client about last month", "null"],
    ["month_rhythm:2_check_in", "Ask for missing documents", "'request'"],
    ["month_rhythm:3_check_in", "Categorize the bank feed through month end", "null"],
    ["month_rhythm:4_check_in", "Note what is still missing", "null"],
    ["month_rhythm:5_reports", "Finish the month with the documents received", "null"],
    ["month_rhythm:6_reports", "Send reports: full if complete, preliminary if documents are missing", "'reports'"],
    ["month_rhythm:7_follow_up", "Follow up on missing documents", "'maintenance'"],
    ["month_rhythm:8_follow_up", "Finish and send full reports once documents arrive", "null"],
  ];
  want.forEach(([ref, title, email]) => {
    const i = sql.indexOf("('" + ref + "'");
    assert.ok(i > 0, ref);
    const block = sql.slice(i, sql.indexOf(")", sql.indexOf("]", i) + 1) + 1);
    assert.ok(block.indexOf("'" + title + "'") > 0, ref + " title");
    assert.ok(new RegExp(email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(::text)?\\)$").test(block.trim()), ref + " email_kind " + block.slice(-30));
    const part = ref.replace(/^month_rhythm:\d_/, "");
    assert.ok(block.indexOf("'" + part + "'") > 0, ref + " part");
    assert.ok(!/!/.test(title), "no exclamation marks");
  });
  Object.keys(T.TK_TPL_EMAIL_KIND_LABELS).forEach((k) => assert.ok(sql.indexOf("'" + k + "'") > 0, k));
  assert.ok(/email_kind in \('request', 'reports', 'maintenance'\)\)/.test(sql), "email_kind CHECK matches the labels");
});

console.log("TK_templateLogic: " + n + " tests passed");
