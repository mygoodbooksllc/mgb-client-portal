// node components/tasks/TK_rowLogic.test.js
const assert = require("assert");
const L = require("./TK_rowLogic.js");
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

t("avatar tone is stable, in range, and case-blind", () => {
  const a = L.TK_rwAvatarTone("Jesse@mgb.com");
  assert.strictEqual(a, L.TK_rwAvatarTone("jesse@mgb.com "));
  assert.ok(a >= 0 && a < 8);
  assert.strictEqual(L.TK_rwAvatarTone(""), 0);
  assert.strictEqual(L.TK_rwAvatarTone(null), 0);
});

t("priorityOf", () => {
  assert.strictEqual(L.TK_rwPriorityOf({ priority: "high" }), "high");
  assert.strictEqual(L.TK_rwPriorityOf({ priority: "low" }), "low");
  assert.strictEqual(L.TK_rwPriorityOf({ priority: "x" }), "normal");
  assert.strictEqual(L.TK_rwPriorityOf(null), "normal");
});

t("addDays crosses month and year ends", () => {
  assert.strictEqual(L.TK_rwAddDays("2026-10-31", 1), "2026-11-01");
  assert.strictEqual(L.TK_rwAddDays("2026-12-31", 1), "2027-01-01");
  assert.strictEqual(L.TK_rwAddDays("2026-03-01", -1), "2026-02-28");
  assert.strictEqual(L.TK_rwAddDays("nope", 1), "");
});

t("dueTone: red past, amber today, neutral otherwise, none when done", () => {
  const today = "2026-10-19";
  assert.strictEqual(L.TK_rwDueTone({ due_date: "2026-10-18", status: "todo" }, today), "late");
  assert.strictEqual(L.TK_rwDueTone({ due_date: "2026-10-19", status: "in_progress" }, today), "today");
  assert.strictEqual(L.TK_rwDueTone({ due_date: "2026-10-20", status: "todo" }, today), "");
  assert.strictEqual(L.TK_rwDueTone({ due_date: "2026-10-01", status: "done" }, today), "");
  assert.strictEqual(L.TK_rwDueTone({ due_date: "2026-10-01", done: true }, today), "");
  assert.strictEqual(L.TK_rwDueTone({ due_date: null }, today), "");
  assert.strictEqual(L.TK_rwDueTone({ due_date: "2026-10-19T00:00:00Z", status: "todo" }, today), "today");
});

t("dueChoices: next Monday is always in the future", () => {
  // 2026-10-19 is a Monday
  const mon = L.TK_rwDueChoices("2026-10-19");
  assert.deepStrictEqual(mon.map((c) => c.date), ["2026-10-19", "2026-10-20", "2026-10-26"]);
  // Sunday 2026-10-25 -> Monday 10-26
  assert.strictEqual(L.TK_rwDueChoices("2026-10-25")[2].date, "2026-10-26");
  // Saturday 2026-10-24 -> Monday 10-26
  assert.strictEqual(L.TK_rwDueChoices("2026-10-24")[2].date, "2026-10-26");
  assert.deepStrictEqual(L.TK_rwDueChoices("bad"), []);
});

t("duePatch", () => {
  assert.deepStrictEqual(L.TK_rwDuePatch("tomorrow", "2026-10-19"), { due_date: "2026-10-20" });
  assert.deepStrictEqual(L.TK_rwDuePatch("clear", "2026-10-19"), { due_date: null });
  assert.deepStrictEqual(L.TK_rwDuePatch("date", "2026-10-19", "2026-11-02"), { due_date: "2026-11-02" });
  assert.strictEqual(L.TK_rwDuePatch("date", "2026-10-19", "11/02/2026"), null);
  assert.strictEqual(L.TK_rwDuePatch("date", "2026-10-19", ""), null);
  assert.strictEqual(L.TK_rwDuePatch("bogus", "2026-10-19"), null);
});

t("dueError mirrors the drawer rule", () => {
  assert.strictEqual(L.TK_rwDueError({ start_on: "2026-10-20" }, "2026-10-19"), "The start date can't be after the due date.");
  assert.strictEqual(L.TK_rwDueError({ start_on: "2026-10-19" }, "2026-10-19"), "");
  assert.strictEqual(L.TK_rwDueError({ start_on: null }, "2026-10-01"), "");
  assert.strictEqual(L.TK_rwDueError({ start_on: "2026-10-20" }, null), "");
});

t("access: view-only, offline, review, owner, admin", () => {
  const task = { staff_email: "a@x.com", status: "todo" };
  assert.deepStrictEqual(L.TK_rwAccess(task, { me: "a@x.com", canEdit: false }), { edit: false, assign: false });
  assert.deepStrictEqual(L.TK_rwAccess(task, { me: "a@x.com", online: false }), { edit: false, assign: false });
  assert.deepStrictEqual(L.TK_rwAccess(task, { me: "A@x.com" }), { edit: true, assign: true });
  assert.deepStrictEqual(L.TK_rwAccess(task, { me: "b@x.com" }), { edit: true, assign: false });
  assert.deepStrictEqual(L.TK_rwAccess(task, { me: "b@x.com", isAdmin: true }), { edit: true, assign: true });
  assert.deepStrictEqual(L.TK_rwAccess({ staff_email: "a@x.com", status: "ready_for_review" }, { me: "a@x.com" }), { edit: false, assign: false });
  assert.deepStrictEqual(L.TK_rwAccess({ deleted_at: "x" }, { me: "a@x.com" }), { edit: false, assign: false });
  assert.deepStrictEqual(L.TK_rwAccess(null, {}), { edit: false, assign: false });
});

t("groupAdd: due buckets", () => {
  const ctx = { today: "2026-10-19" };
  assert.deepStrictEqual(L.TK_rwGroupAdd("today", ctx), { show: true, due_date: "2026-10-19", client_id: null });
  assert.deepStrictEqual(L.TK_rwGroupAdd("week", ctx), { show: true, due_date: "2026-10-20", client_id: null });
  assert.deepStrictEqual(L.TK_rwGroupAdd("later", ctx), { show: true, due_date: null, client_id: null });
  assert.deepStrictEqual(L.TK_rwGroupAdd("page", ctx), { show: true, due_date: null, client_id: null });
});

t("groupAdd: groups that cannot hold a new task, and no-create roles", () => {
  ["overdue", "waiting", "review", "unassigned", "done", "", "zzz"].forEach((k) => {
    assert.strictEqual(L.TK_rwGroupAdd(k, { today: "2026-10-19" }).show, false, k);
  });
  assert.strictEqual(L.TK_rwGroupAdd("today", { today: "2026-10-19", canCreate: false }).show, false);
  assert.strictEqual(L.TK_rwGroupAdd("today", {}).show, false);
});

t("groupAdd: client group", () => {
  assert.strictEqual(L.TK_rwGroupAdd("client:__none__", {}).show, false);
  assert.deepStrictEqual(L.TK_rwGroupAdd("client:42", {}), { show: true, due_date: null, client_id: "42" });
  assert.strictEqual(L.TK_rwGroupAdd("client:42", { canCreate: false }).show, false);
});

console.log("TK_rowLogic: " + n + " tests passed");
