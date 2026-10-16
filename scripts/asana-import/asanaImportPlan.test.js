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
      { g: "4", p: "p2", n: "Kickoff call", a: "nicole@x.org", d: "2026-08-01", sec: "Week 1", cf: {} },
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

t("plan: unassigned task goes to the client's bookkeeper", function () {
  var r = byGid(plan, "3");
  assert.strictEqual(r.assignee_email, "gina@x.org");
  assert.strictEqual(r.owner_how, "unassigned_client_bookkeeper");
  assert.ok(plan.report.anomalies.some(function (a) {
    return a.gid === "3" && a.kind === "no_due_date";
  }));
});

t("plan: duplicate onboarding merges, newest wins, duplicate titles dropped", function () {
  assert.strictEqual(plan.report.duplicates.length, 1);
  var d = plan.report.duplicates[0];
  assert.strictEqual(d.winner_gid, "p3");
  assert.strictEqual(d.tasks_dropped, 1);
  assert.strictEqual(d.tasks_merged, 1);
  assert.strictEqual(byGid(plan, "4"), undefined);
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

t("plan: archived loser never wins and its tasks drop by default", function () {
  var s = snap();
  s.projects.push({ gid: "p8", name: "Grace City Church", team: null, archived: true, modified_at: "2026-12-01" });
  s.tasks.push({ g: "20", p: "p8", n: "From archived copy", a: "nicole@x.org", cf: {} });
  var pl = P.AI_plan(s, ctx());
  var d = pl.report.duplicates.filter(function (x) {
    return x.winner_gid === "p1";
  })[0];
  assert.ok(d, "p1 wins over a newer archived copy");
  assert.strictEqual(d.tasks_dropped_archived, 1);
  var pl2 = P.AI_plan(s, ctx({ unionArchivedLosers: true }));
  assert.strictEqual(byGid(pl2, "20").client_id, "grace-city");
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
  assert.strictEqual(s1.assignee_email, "gina@x.org");
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
  assert.ok(plan.templates.some(function (x) {
    return x.asana_gid === "2" && x.cadence === "annually";
  }));
  assert.ok(!plan.templates.some(function (x) {
    return x.asana_gid === "3";
  }));
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
