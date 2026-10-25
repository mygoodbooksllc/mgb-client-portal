// node scripts/asana-import/dailyImport.test.js
var assert = require("assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var D = require("./dailyImport.js");

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
  { email: "nicole@x.org", name: "Nicole N", active: true },
  { email: "holden@mygoodbooks.org", name: "Holden G", active: true },
];
function task(g, name, extra) {
  return Object.assign(
    { gid: g, name: name, completed: false, assignee: { email: "nicole@x.org", name: "Nicole N" }, due_on: "2026-11-03", start_on: null, memberships: [{ project: { gid: "p1" }, section: { name: "Monthly Bookkeeping" } }], custom_fields: [], parent: null, created_at: "2026-10-22T10:00:00Z", modified_at: "2026-10-22T10:00:00Z", num_subtasks: 0, notes: "" },
    extra || {}
  );
}
function calls(tasks, more) {
  return [
    { name: "get_projects", input: { archived: false }, result: { data: [{ gid: "p1", name: "Grace City Church", archived: false, team: { name: "Nicole's Clients" } }] } },
    { name: "get_users", input: {}, result: { data: [{ gid: "u1", email: "nicole@x.org", name: "Nicole N" }] } },
    { name: "get_teams", input: {}, result: { data: [{ gid: "t1", name: "Nicole's Clients" }] } },
    { name: "search_tasks", input: { completed: false, limit: 100 }, result: { data: tasks } },
  ].concat(more || []);
}
var DB = {
  clients: [{ id: "grace-city", name: "Grace City Church", bk: "nicole@x.org", t: false, i: false }],
  staff: STAFF,
  history: [{ sp: "p1", c: "grace-city", n: 40 }],
  keys: ["asana:task:old1"],
  open: [{ c: "grace-city", t: "reconcile checking", src: "asana" }],
  templates: [],
};
function plan(tasks, db, more, fetched) {
  var b = D.buildSnapshot(calls(tasks, more), "2026-10-25T11:30:00Z");
  return D.planDaily(b.snapshot, Object.assign({}, DB, db || {}), { today: "2026-10-25", decisions: {}, fetched: fetched || [] });
}

t("new open task is staged with its client", function () {
  var r = plan([task("n1", "Send reports")]);
  assert.strictEqual(r.tasks.length, 1);
  assert.strictEqual(r.tasks[0].client_id, "grace-city");
  assert.deepStrictEqual(r.errors, []);
});

t("already imported keys are never staged again", function () {
  var r = plan([task("old1", "Send reports")]);
  assert.strictEqual(r.tasks.length, 0);
  assert.strictEqual(r.counts.already_imported, 1);
});

t("completed and project-less tasks are ignored", function () {
  var b = D.buildSnapshot(calls([task("c1", "Done", { completed: true }), task("np", "Mine", { memberships: [] })]), "x");
  assert.strictEqual(b.snapshot.tasks.length, 0);
  assert.strictEqual(b.stats.completed, 1);
  assert.strictEqual(b.stats.no_project, 1);
});

t("same client + title open in the portal is held back (recurring duplicate guard)", function () {
  var r = plan([task("n2", "Reconcile  Checking")]);
  assert.strictEqual(r.tasks.length, 0);
  assert.strictEqual(r.heldBack[0].why, "same_title_open_in_portal");
});

t("a subtask of a held-back parent is held back too", function () {
  var r = plan([task("n2", "Reconcile checking"), task("s1", "Bank 1", { parent: { gid: "n2" }, memberships: [] })]);
  assert.strictEqual(r.tasks.length, 0);
  assert.ok(r.heldBack.some(function (h) { return h.asana_gid === "s1" && h.why === "parent_held_back"; }));
});

t("a subtask whose parent is missing asks for the parent first", function () {
  var r = plan([task("s2", "Bank 2", { parent: { gid: "par9" }, memberships: [] })]);
  assert.deepStrictEqual(r.needParents, ["par9"]);
});

t("a fetched old parent is never imported, only used to place the subtask", function () {
  var parent = task("par9", "Old parent");
  var r = plan([task("s2", "Bank 2", { parent: { gid: "par9" }, memberships: [] })], null, [{ name: "get_task", input: { task_id: "par9" }, result: { data: parent } }], ["par9"]);
  assert.deepStrictEqual(r.needParents, []);
  assert.strictEqual(r.tasks.length, 0);
  assert.ok(r.heldBack.some(function (h) { return h.asana_gid === "par9" && h.why === "old_parent_not_imported"; }));
});

t("a subtask under an already imported parent is staged", function () {
  var parent = task("old1", "Old parent");
  var r = plan([task("s3", "Bank 3", { parent: { gid: "old1" }, memberships: [] })], null, [{ name: "get_task", input: { task_id: "old1" }, result: { data: parent } }], ["old1"]);
  assert.strictEqual(r.tasks.length, 1);
  assert.strictEqual(r.tasks[0].parent_gid, "old1");
});

t("a project that changes client is an error (stop, no apply)", function () {
  var r = plan([task("n3", "Send reports")], { history: [{ sp: "p1", c: "someone-else", n: 3 }] });
  assert.ok(r.errors.some(function (e) { return /client_changed/.test(e); }));
});

t("over the daily cap is an error", function () {
  var many = [];
  for (var i = 0; i <= D.CAP_TASKS; i++) many.push(task("m" + i, "Task " + i));
  var r = plan(many);
  assert.ok(r.errors.some(function (e) { return /^cap:/.test(e); }));
});

t("templates stay out", function () {
  var r = plan([task("n4", "Monthly close")]);
  assert.strictEqual(r.templates.length, 0);
});

t("extract reads only calls after the nonce, including saved-file results", function () {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "asana-daily-test-"));
  var saved = path.join(dir, "saved.txt");
  fs.writeFileSync(saved, JSON.stringify({ data: [task("z1", "From file")] }));
  var lines = [
    { message: { content: [{ type: "tool_use", id: "a", name: "mcp__x__search_tasks", input: { completed: false } }] } },
    { message: { content: [{ type: "tool_result", tool_use_id: "a", content: JSON.stringify({ data: [task("before", "Old")] }) }] } },
    { message: { content: [{ type: "tool_result", tool_use_id: "b0", content: "NONCE-123" }] } },
    { message: { content: [{ type: "tool_use", id: "b", name: "mcp__x__search_tasks", input: { completed: false } }] } },
    { message: { content: [{ type: "tool_result", tool_use_id: "b", content: "Error: result too big. Output has been saved to " + saved + ".\nFormat: JSON" }] } },
  ];
  var f = path.join(dir, "t.jsonl");
  fs.writeFileSync(f, lines.map(function (l) { return JSON.stringify(l); }).join("\n") + "\n");
  var c = D.extractCalls(f, "NONCE-123");
  assert.strictEqual(c.length, 1);
  assert.strictEqual(c[0].result.data[0].gid, "z1");
});

t("stop date is 2026-11-24", function () {
  assert.strictEqual(D.STOP_DATE, "2026-11-24");
});

console.log(pass + " passed" + (process.exitCode ? " (with failures)" : ""));
