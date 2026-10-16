// node scripts/asana-import/asanaImportPlan.test.js
var assert = require("assert");
var P = require("./asanaImportPlan.js");

var pass = 0;
function t(name, fn) {
  try {
    fn();
    pass++;
  } catch (e) {
    console.error("FAIL " + name + "\n  " + (e && e.stack ? e.stack.split("\n").slice(0, 3).join("\n  ") : e));
    process.exitCode = 1;
  }
}

var STAFF = [
  { email: "owner@x.org", name: "Olive Owner", active: true },
  { email: "nicole@x.org", name: "Nicole N", active: true },
  { email: "gina@x.org", name: "Gina G", active: true },
  { email: "old@x.org", name: "Old O", active: false },
];
var CLIENTS = [
  { id: "grace-city", name: "Grace City Church", assigned_bookkeeper_email: "gina@x.org" },
  { id: "manna", name: "Manna Church" },
  { id: "manna-clarksville", name: "Manna Church - Clarksville" },
  { id: "collective", name: "Collective Church" },
  { id: "citymark", name: "Citymark Church" },
];
var TEAMS = [{ gid: "t1", name: "Nicole's Clients" }, { gid: "t2", name: "Directors" }];

function snap(extra) {
  var s = {
    snapshot_at: "2026-10-16T17:00:00Z",
    users: [
      { gid: "u1", email: "nicole@x.org", name: "Nicole N" },
      { gid: "u2", email: "gone@x.org", name: "Gone Person" },
      { gid: "u3", email: "naomi@x.org", name: "Naomi Leaving" },
    ],
    teams: TEAMS,
    projects: [
      { gid: "p1", name: "Grace City Church", team: "Nicole's Clients", archived: false, modified_at: "2026-10-01" },
      { gid: "p2", name: "Collective Church Onboarding", team: null, archived: false, modified_at: "2026-09-01", created_at: "2026-08-01" },
      { gid: "p3", name: "Collective Church Onboarding ", team: null, archived: false, modified_at: "2026-10-10", created_at: "2026-09-01" },
      { gid: "p4", name: "Directors Tasks", team: "Directors", archived: false },
      { gid: "p5", name: "Nowhere Fellowship", team: null, archived: false },
      { gid: "p6", name: "New Client Template", team: null, archived: false },
      { gid: "p7", name: "Old Thing", team: null, archived: true },
    ],
    tasks: [
      { g: "1", p: "p1", n: "Reconcile bank", a: "nicole@x.org", an: "Nicole N", d: "2026-10-20", sec: "Monthly", cf: { "Task Progress": "In progress" } },
      { g: "2", p: "p1", n: "Year end", a: "gone@x.org", an: "Gone Person", d: "2026-10-18", sec: "Annual", cf: {} },
      { g: "3", p: "p1", n: "No owner", a: null, an: null, d: null, sec: "Other", cf: {} },
      { g: "4", p: "p2", n: "Kickoff call", a: "nicole@x.org", d: "2026-10-21", sec: "Week 1", cf: {} },
      { g: "4b", p: "p2", n: "Kickoff call", a: "nicole@x.org", d: "2026-08-01", sec: "Week 1", cf: {} },
      { g: "5", p: "p3", n: "Kickoff call", a: "nicole@x.org", d: "2026-10-21", sec: "Week 1", cf: {} },
      { g: "6", p: "p2", n: "Only in old copy", a: "nicole@x.org", d: "2026-10-22", sec: "Week 2", cf: {} },
      { g: "7", p: "p4", n: "Board prep", a: "owner@x.org", d: "2026-10-30", sec: "", cf: {} },
      { g: "8", p: "p5", n: "Lost client task", a: "nicole@x.org", d: "2026-10-30", cf: {} },
      { g: "9", p: "p6", n: "Template step", a: null, cf: {} },
      { g: "10", p: "p7", n: "Archived work", a: null, cf: {} },
      { g: "1", p: "p4", n: "Reconcile bank", a: "nicole@x.org", sec: "", cf: {} },
      { g: "11", p: "p1", n: "Email reports for review", a: "nicole@x.org", d: "2026-10-31", sec: "Monthly", cf: { "Task Progress": "Done" } },
    ],
    subtasks: [
      { g: "s1", par: "1", n: "Checking", a: null, d: null },
      { g: "s2", par: "s1", n: "Deep child", a: "nicole@x.org", d: "2026-10-19" },
      { g: "s3", par: "8", n: "Orphan (parent skipped)", a: null },
    ],
  };
  Object.keys(extra || {}).forEach(function (k) {
    s[k] = extra[k];
  });
  return s;
}
function ctx(extra) {
  var c = { staff: STAFF, clients: CLIENTS, fallbackEmail: "owner@x.org", today: "2026-10-16" };
  Object.keys(extra || {}).forEach(function (k) {
    c[k] = extra[k];
  });
  return c;
}
function byGid(plan, g) {
  return plan.tasks.filter(function (r) {
    return r.asana_gid === g;
  })[0];
}

t("normName strips suffixes and punctuation", function () {
  assert.strictEqual(P.AI_normName("Collective Church Onboarding "), "collective church");
  assert.strictEqual(P.AI_normName("The Way Bookkeeping"), "the way");
  assert.strictEqual(P.AI_normName("Creative Academy  "), "creative academy");
  assert.strictEqual(P.AI_coreName("Golden City Church"), "golden city");
});

t("client match: exact high, partial medium, ambiguity, none", function () {
  assert.deepStrictEqual(P.AI_matchClient("Grace City Church", CLIENTS).client_id, "grace-city");
  assert.strictEqual(P.AI_matchClient("Grace City", CLIENTS).confidence, "high");
  assert.strictEqual(P.AI_matchClient("Manna Church - Clarksville", CLIENTS).client_id, "manna-clarksville");
  assert.strictEqual(P.AI_matchClient("Nowhere Fellowship", CLIENTS).confidence, "none");
  var amb = P.AI_matchClient("Grace", [{ id: "a", name: "Grace North" }, { id: "b", name: "Grace South" }]);
  assert.strictEqual(amb.client_id, null);
});

t("classify: internal, template skip, onboarding, staff onboarding, override", function () {
  var c = { clients: CLIENTS, staff: STAFF, teams: [{ name: "Sarah's Clients" }] };
  assert.strictEqual(P.AI_classifyProject({ gid: "a", name: "COO-SOP" }, c).target_kind, "internal");
  assert.strictEqual(P.AI_classifyProject({ gid: "a", name: "90 Day" }, c).target_kind, "internal");
  assert.strictEqual(P.AI_classifyProject({ gid: "a", name: "Employee Onboarding Template" }, c).target_kind, "skip");
  assert.strictEqual(P.AI_classifyProject({ gid: "a", name: "Sarah Onboarding" }, c).target_kind, "internal");
  var ob = P.AI_classifyProject({ gid: "a", name: "Collective Church Onboarding" }, c);
  assert.strictEqual(ob.target_kind, "onboarding");
  assert.strictEqual(ob.client_id, "collective");
  var ov = P.AI_classifyProject({ gid: "a", name: "Lifot" }, { clients: CLIENTS, overrides: { a: { target_kind: "client", client_id: "manna" } } });
  assert.strictEqual(ov.client_id, "manna");
  assert.strictEqual(ov.confidence, "owner");
});

t("status mapping", function () {
  assert.strictEqual(P.AI_status({ "Task Progress": "Not started" }).status, "todo");
  assert.strictEqual(P.AI_status({ "Task Progress": "In progress" }).status, "in_progress");
  var d = P.AI_status({ "Task Progress": "Done" });
  assert.strictEqual(d.status, "todo");
  assert.strictEqual(d.says_done, true);
  assert.strictEqual(P.AI_status({}).known, true);
});

t("plan: requires active fallback and today", function () {
  assert.throws(function () {
    P.AI_plan(snap(), ctx({ fallbackEmail: null }));
  }, /fallbackEmail/);
  assert.throws(function () {
    P.AI_plan(snap(), ctx({ fallbackEmail: "old@x.org" }));
  }, /active staff/);
  assert.throws(function () {
    P.AI_plan(snap(), ctx({ today: "Oct 16" }));
  }, /today/);
});

var plan = P.AI_plan(snap(), ctx());

t("plan: client task maps client, owner by email, status, idempotency key", function () {
  var r = byGid(plan, "1");
  assert.strictEqual(r.client_id, "grace-city");
  assert.strictEqual(r.assignee_email, "nicole@x.org");
  assert.strictEqual(r.status, "in_progress");
  assert.strictEqual(r.key, "asana:task:1");
  assert.strictEqual(r.visibility, "shared");
  assert.strictEqual(r.project_gid, null);
  assert.ok(/Imported from Asana: https:\/\/app\.asana\.com\/0\/p1\/1$/.test(r.description));
});

t("plan: multi-homed task imported once, on its client project", function () {
  var n = plan.tasks.filter(function (r) {
    return r.asana_gid === "1";
  }).length;
  assert.strictEqual(n, 1);
  assert.strictEqual(plan.report.totals.multi_homed_repeats, 1);
});

t("plan: unknown Asana user goes to fallback with a note", function () {
  var r = byGid(plan, "2");
  assert.strictEqual(r.assignee_email, "owner@x.org");
  assert.strictEqual(r.owner_how, "fallback");
  assert.ok(r.description.indexOf("Asana assignee: Gone Person") >= 0);
  assert.strictEqual(plan.report.unmapped_users.length, 1);
  assert.strictEqual(plan.report.unmapped_users[0].asana_email, "gone@x.org");
});

t("plan: unassigned task stays unassigned; the client's bookkeeper owns the row", function () {
  var r = byGid(plan, "3");
  assert.strictEqual(r.assignee_email, null);
  assert.strictEqual(r.staff_email, "gina@x.org");
  assert.strictEqual(r.owner_how, "unassigned");
  assert.strictEqual(r.owner_from, "client_bookkeeper");
  assert.ok(r.description.indexOf("Unassigned in Asana") < 0);
  assert.ok(plan.report.totals.unassigned_tasks >= 1);
  assert.strictEqual(plan.report.tasks_by_owner["(unassigned)"], plan.report.totals.unassigned_tasks);
  assert.ok(plan.report.anomalies.some(function (a) {
    return a.gid === "3" && a.kind === "no_due_date";
  }));
});

t("plan: duplicate onboarding combines; only same title+section+due repeats drop", function () {
  assert.strictEqual(plan.report.duplicates.length, 1);
  var d = plan.report.duplicates[0];
  assert.strictEqual(d.winner_gid, "p3");
  assert.strictEqual(d.tasks_dropped, 1);
  assert.strictEqual(d.tasks_merged, 2);
  assert.strictEqual(byGid(plan, "4"), undefined);
  assert.strictEqual(byGid(plan, "4b").project_gid, "p3", "same title, other due date: kept");
  assert.strictEqual(byGid(plan, "5").project_gid, "p3");
  assert.strictEqual(byGid(plan, "6").project_gid, "p3");
  assert.ok(plan.skipped.some(function (s) {
    return s.gid === "4" && s.reason === "duplicate_in_merged_project" && s.kept_gid === "5";
  }));
  var proj = plan.projects.filter(function (p) {
    return p.asana_gid === "p3";
  })[0];
  assert.strictEqual(proj.kind, "onboarding");
  assert.strictEqual(proj.client_id, "collective");
  assert.deepStrictEqual(proj.merged_gids, ["p2"]);
  assert.deepStrictEqual(proj.sections, ["Week 1", "Week 2"]);
});

t("plan: archived copy never wins but its open tasks come along", function () {
  var s = snap();
  s.projects.push({ gid: "p8", name: "Grace City Church", team: null, archived: true, modified_at: "2026-12-01" });
  s.tasks.push({ g: "20", p: "p8", n: "From archived copy", a: "nicole@x.org", cf: {} });
  s.tasks.push({ g: "21", p: "p8", n: "Reconcile bank", a: "nicole@x.org", d: "2026-10-20", sec: "Monthly", cf: {} });
  var pl = P.AI_plan(s, ctx());
  var d = pl.report.duplicates.filter(function (x) {
    return x.winner_gid === "p1";
  })[0];
  assert.ok(d, "p1 wins over a newer archived copy");
  assert.strictEqual(d.tasks_from_archived, 1);
  assert.strictEqual(byGid(pl, "20").client_id, "grace-city");
  assert.strictEqual(byGid(pl, "21"), undefined, "obvious repeat of task 1 drops");
});

t("plan: userRemap sends a departed user's tasks and team to another person", function () {
  var s = snap();
  s.teams = TEAMS.concat([{ gid: "t9", name: "Naomi's Clients" }]);
  s.projects.push({ gid: "p9", name: "Manna Church", team: "Naomi's Clients", archived: false });
  s.tasks.push({ g: "50", p: "p9", n: "Naomi task", a: "naomi@x.org", an: "Naomi Leaving", d: "2026-10-22", cf: {} });
  s.tasks.push({ g: "51", p: "p9", n: "Nobody task", a: null, d: "2026-10-22", cf: {} });
  var pl = P.AI_plan(s, ctx({ userRemap: { naomi: "nicole@x.org" } }));
  assert.strictEqual(byGid(pl, "50").assignee_email, "nicole@x.org");
  assert.strictEqual(byGid(pl, "50").owner_how, "remapped");
  assert.ok(byGid(pl, "50").description.indexOf("Asana assignee: Naomi Leaving") >= 0);
  assert.strictEqual(byGid(pl, "51").assignee_email, null);
  assert.strictEqual(byGid(pl, "51").staff_email, "nicole@x.org", "team owner via remap");
  assert.strictEqual(byGid(pl, "51").owner_from, "team_bookkeeper");
  assert.strictEqual(P.AI_teamBookkeeper("Naomi's Clients", STAFF, { naomi: "nicole@x.org" }), "nicole@x.org");
  var noMap = P.AI_plan(s, ctx());
  assert.strictEqual(byGid(noMap, "50").assignee_email, "owner@x.org");
});

t("plan: a first-name remap never beats a real email match and needs one person with that name", function () {
  var staff = STAFF.concat([{ email: "naomi.k@x.org", name: "Naomi Keeps", active: true }]);
  var s = snap();
  s.users.push({ gid: "u4", email: "naomi.k@x.org", name: "Naomi Keeps" });
  s.tasks.push({ g: "60", p: "p1", n: "Active Naomi task", a: "naomi.k@x.org", an: "Naomi Keeps", d: "2026-10-22", cf: {} });
  s.tasks.push({ g: "61", p: "p1", n: "Leaving Naomi task", a: "naomi@x.org", an: "Naomi Leaving", d: "2026-10-22", cf: {} });
  var pl = P.AI_plan(s, ctx({ staff: staff, userRemap: { naomi: "nicole@x.org" } }));
  assert.strictEqual(byGid(pl, "60").assignee_email, "naomi.k@x.org", "active email match kept");
  assert.strictEqual(byGid(pl, "61").assignee_email, "owner@x.org", "two Naomis: first-name remap does not guess");
  var byEmail = P.AI_plan(s, ctx({ staff: staff, userRemap: { "naomi@x.org": "nicole@x.org" } }));
  assert.strictEqual(byGid(byEmail, "61").assignee_email, "nicole@x.org", "an email remap key still works");
  assert.strictEqual(byGid(byEmail, "60").assignee_email, "naomi.k@x.org");
});

t("due rule: mirrors the Asana instance date per cadence", function () {
  assert.deepStrictEqual(P.AI_dueRule("weekly", "2026-10-21").rule, { type: "weekday", dow: 3 });
  assert.strictEqual(P.AI_dueRule("weekly", "2026-10-18").note, "weekend_due_rolls_to_monday");
  assert.deepStrictEqual(P.AI_dueRule("monthly", "2026-10-20").rule, { type: "day_of_month", day: 20, month_offset: 1, roll: "none" });
  assert.strictEqual(P.AI_dueRule("quarterly", "2026-10-15").rule.month_offset, 1);
  assert.strictEqual(P.AI_dueRule("quarterly", "2026-12-15").rule.month_offset, 3);
  assert.strictEqual(P.AI_dueRule("quarterly", "2027-01-31").rule.month_offset, 1);
  assert.strictEqual(P.AI_dueRule("annually", "2027-04-15").rule.month_offset, 4);
  assert.strictEqual(P.AI_dueRule("monthly", null).rule, null);
  assert.strictEqual(P.AI_dueRule("monthly", null).note, "no_due_date");
  assert.strictEqual(P.AI_dueRule("weekly", "2026-10-21").lead_days, 4);
});

t("roster: groups Asana names, matches QuickBooks, team bookkeeper, No team yet", function () {
  var projects = [
    { gid: "a", name: "Golden City", target_kind: "client", team: null },
    { gid: "b", name: "Golden City Church Onboarding", target_kind: "onboarding", team: null, archived: true },
    { gid: "c", name: "MBTR+V Club", target_kind: "client", team: null },
    { gid: "d", name: "Good Land Church", target_kind: "client", team: "Naomi's Clients" },
    { gid: "e", name: "Unco Church", target_kind: "client", team: "Nicole's Clients" },
    { gid: "f", name: "Directors Tasks", target_kind: "internal", team: "Directors" },
  ];
  var qbo = [
    { id: "1", name: "Golden City Church", display: "Golden City Church", active: true },
    { id: "2", name: "Myrtle Beach Therapeutic Riding + Vaulting Club", display: "Myrtle Beach Therapeutic Riding + Vaulting Club", active: true },
    { id: "3", name: "Good Land Church", display: "Good Land Church", active: true },
    { id: "4", name: "UNCO Church", display: "UNCO Church", active: true, last_invoice: "2026-10-01" },
    { id: "5", name: "Unco Church", display: "Unco Church_1761053752763", active: true },
    { id: "6", name: "Old Church", display: "Old Church (deleted)", active: false },
    { id: "7", name: "Hilda Person", display: "Hilda Person", active: true },
    { id: "8", name: "My Good Books", display: "My Good Books (Clock-in Option)", active: true },
  ];
  var r = P.AI_buildRoster({ projects: projects, qbo: qbo, staff: STAFF.concat([{ email: "sonya@x.org", name: "Sonya S" }]), userRemap: { naomi: "sonya@x.org" } });
  var by = function (n) {
    return r.entries.filter(function (e) {
      return e.aliases.indexOf(n) >= 0;
    })[0];
  };
  assert.strictEqual(r.entries.length, 4, "golden city client + onboarding combine; internal ignored");
  assert.strictEqual(by("Golden City").qbo.id, "1");
  assert.strictEqual(by("Golden City").proposed_client_id, "golden-city-church");
  assert.strictEqual(by("Golden City").group, "No team yet");
  assert.strictEqual(by("MBTR+V Club").qbo.id, "2");
  assert.strictEqual(by("MBTR+V Club").qbo_confidence, "acronym");
  assert.strictEqual(by("Good Land Church").bookkeeper_email, "sonya@x.org");
  assert.strictEqual(by("Unco Church").qbo.id, "4", "plain record beats the _digits duplicate");
  assert.strictEqual(by("Unco Church").bookkeeper_email, "nicole@x.org");
  assert.deepStrictEqual(r.qbo_only.map(function (q) { return q.id; }), ["7"]);
  assert.strictEqual(r.qbo_only[0].looks_personal, true);
  assert.strictEqual(r.summary.no_team_yet, 2);
  // the roster feeds the what-if plan; aliases let Asana names find the QuickBooks-named client
  var rc = P.AI_rosterClients(r);
  assert.strictEqual(P.AI_matchClient("MBTR+V Club", rc).client_id, by("MBTR+V Club").proposed_client_id);
});

t("roster: same-name records collapse to high; first-word fallback marked for checking", function () {
  var r = P.AI_buildRoster({
    projects: [
      { gid: "a", name: "Manna Church", target_kind: "client", team: null },
      { gid: "b", name: "Zeal Church", target_kind: "client", team: null },
      { gid: "c", name: "Life Church", target_kind: "client", team: null },
    ],
    qbo: [
      { id: "1", name: "Manna Church", display: "Manna Church", active: true },
      { id: "2", name: "Manna Church (deleted)", display: "Manna Church (deleted)", active: false },
      { id: "3", name: "Zeal City Church", display: "Zeal City Church", active: true },
      { id: "4", name: "Life West", display: "Life West", active: true },
      { id: "5", name: "Life Church Danville", display: "Life Church Danville", active: true },
    ],
    staff: STAFF,
  });
  var by = function (n) {
    return r.entries.filter(function (e) { return e.name === n || e.aliases.indexOf(n) >= 0; })[0];
  };
  assert.strictEqual(by("Manna Church").qbo.id, "1");
  assert.strictEqual(by("Manna Church").qbo_confidence, "high");
  assert.strictEqual(by("Zeal Church").qbo.id, "3");
  assert.strictEqual(by("Zeal Church").qbo_confidence, "first word");
  assert.strictEqual(by("Life Church").qbo, null, "two Life records: owner picks");
  assert.strictEqual(by("Life Church").qbo_confidence, "ambiguous");
  assert.strictEqual(by("Life Church").qbo_candidates.length, 2);
});

t("plan: internal project is private-owned project row; unmatched client skipped", function () {
  var r = byGid(plan, "7");
  assert.strictEqual(r.project_gid, "p4");
  assert.strictEqual(r.client_id, null);
  assert.strictEqual(r.visibility, "shared");
  assert.ok(plan.projects.some(function (p) {
    return p.asana_gid === "p4" && p.kind === "internal" && p.client_id === null;
  }));
  assert.strictEqual(byGid(plan, "8"), undefined);
  assert.ok(plan.skipped.some(function (s) {
    return s.gid === "8" && s.reason === "client_missing";
  }));
  assert.ok(plan.report.client_missing.some(function (c) {
    return c.gid === "p5" && c.suggested_client_id === "nowhere-fellowship";
  }));
});

t("plan: template and archived projects skipped", function () {
  assert.ok(plan.skipped.some(function (s) {
    return s.gid === "9" && s.reason === "project_template_project";
  }));
  assert.ok(plan.skipped.some(function (s) {
    return s.gid === "10" && s.reason === "project_archived";
  }));
});

t("plan: subtasks flatten to the top imported parent; orphans skipped", function () {
  var s1 = byGid(plan, "s1");
  var s2 = byGid(plan, "s2");
  assert.strictEqual(s1.parent_gid, "1");
  assert.strictEqual(s2.parent_gid, "1");
  assert.strictEqual(s2.flattened, true);
  assert.strictEqual(s1.client_id, "grace-city");
  assert.strictEqual(s1.assignee_email, null, "unassigned subtask stays unassigned");
  assert.strictEqual(s1.staff_email, "gina@x.org");
  assert.ok(plan.skipped.some(function (s) {
    return s.gid === "s3" && s.reason === "parent_not_imported";
  }));
  var idx = function (g) {
    return plan.tasks.indexOf(byGid(plan, g));
  };
  assert.ok(idx("1") < idx("s1"), "parents before children");
});

t("plan: draft templates from cadence sections, with subtask checklist", function () {
  var tpl = plan.templates.filter(function (x) {
    return x.asana_gid === "1";
  })[0];
  assert.strictEqual(tpl.cadence, "monthly");
  assert.strictEqual(tpl.client_id, "grace-city");
  assert.deepStrictEqual(tpl.checklist, ["Checking", "Deep child"]);
  // mirrors the open instance: due on the 20th, Nicole is not Grace City's bookkeeper (Gina) -> a named person
  assert.deepStrictEqual(tpl.due_rule, { type: "day_of_month", day: 20, month_offset: 1, roll: "none" });
  assert.strictEqual(tpl.lead_days, 14);
  assert.strictEqual(tpl.assignee_mode, "person");
  assert.strictEqual(tpl.assignee_email, "nicole@x.org");
  assert.strictEqual(tpl.leave_unassigned, false);
  assert.strictEqual(tpl.instance_gid, "1");
  assert.strictEqual(tpl.instance_due, "2026-10-20");
  assert.ok(plan.templates.some(function (x) {
    return x.asana_gid === "2" && x.cadence === "annually";
  }));
  assert.ok(!plan.templates.some(function (x) {
    return x.asana_gid === "3";
  }));
});

t("plan: template assignee mirrors Asana: the client's bookkeeper, or left unassigned", function () {
  var s = snap();
  s.users.push({ gid: "u4", email: "gina@x.org", name: "Gina G" });
  s.tasks.push({ g: "60", p: "p1", n: "Payroll", a: "gina@x.org", d: "2026-10-23", sec: "Weekly", cf: {} });
  s.tasks.push({ g: "61", p: "p1", n: "Check mail", a: null, d: "2026-10-31", sec: "Quarterly", cf: {} });
  var pl = P.AI_plan(s, ctx());
  var t60 = pl.templates.filter(function (x) { return x.asana_gid === "60"; })[0];
  var t61 = pl.templates.filter(function (x) { return x.asana_gid === "61"; })[0];
  assert.strictEqual(t60.assignee_mode, "bookkeeper");
  assert.strictEqual(t60.assignee_email, null);
  assert.deepStrictEqual(t60.due_rule, { type: "weekday", dow: 5 });
  assert.strictEqual(t61.assignee_mode, "unassigned");
  assert.strictEqual(t61.leave_unassigned, true);
  assert.strictEqual(t61.due_rule.month_offset, 1);
  assert.strictEqual(pl.report.templates_by_assignee_mode.unassigned, 1);
});

t("plan: review step counted, progress Done flagged but stays open", function () {
  var r = byGid(plan, "11");
  assert.strictEqual(r.review_step, true);
  assert.strictEqual(r.status, "todo");
  assert.ok(r.description.indexOf("Asana progress: Done") >= 0);
  assert.strictEqual(plan.report.totals.review_step_tasks, 1);
  assert.ok(plan.report.anomalies.some(function (a) {
    return a.gid === "11" && a.kind === "open_but_progress_says_done";
  }));
});

t("plan: already-imported keys are flagged, not counted in to_create", function () {
  var pl = P.AI_plan(snap(), ctx({ importedKeys: ["asana:task:1", "asana:task:7"] }));
  assert.strictEqual(byGid(pl, "1").already_imported, true);
  assert.strictEqual(pl.report.totals.already_imported, 2);
  assert.strictEqual(pl.report.totals.to_create, pl.tasks.length - 2);
});

t("plan: deterministic (same input, same plan)", function () {
  var a = JSON.stringify(P.AI_plan(snap(), ctx()));
  var b = JSON.stringify(P.AI_plan(snap(), ctx()));
  assert.strictEqual(a, b);
});

t("plan: long title truncated to 200 with full title kept in description", function () {
  var s = snap();
  var long = new Array(260).join("x");
  s.tasks.push({ g: "30", p: "p1", n: long, a: "nicole@x.org", cf: {} });
  var r = byGid(P.AI_plan(s, ctx()), "30");
  assert.strictEqual(r.title.length, 200);
  assert.ok(r.description.indexOf("Full Asana title: ") === 0);
});

t("plan: date anomalies", function () {
  var s = snap();
  s.tasks.push({ g: "40", p: "p1", n: "Ancient", a: "nicole@x.org", d: "2025-01-01", cf: {} });
  s.tasks.push({ g: "41", p: "p1", n: "Backwards", a: "nicole@x.org", d: "2026-10-20", s: "2026-10-25", cf: {} });
  s.tasks.push({ g: "42", p: "p1", n: "Weekend", a: "nicole@x.org", d: "2026-10-17", cf: {} });
  var pl = P.AI_plan(s, ctx());
  var kinds = function (g) {
    return pl.report.anomalies
      .filter(function (a) {
        return a.gid === g;
      })
      .map(function (a) {
        return a.kind;
      });
  };
  assert.ok(kinds("40").indexOf("overdue_over_60_days") >= 0);
  assert.ok(kinds("41").indexOf("start_after_due") >= 0);
  assert.strictEqual(byGid(pl, "41").start_on, null);
  assert.ok(kinds("42").indexOf("due_on_weekend") >= 0);
});

console.log(pass + " passed" + (process.exitCode ? ", some FAILED" : ""));
