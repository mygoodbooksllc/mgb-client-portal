// Plain node, no framework: `node components/tasks/TK_deps.test.js`.
// Guards the Slate plus "Blocked by" rules (TK_deps.js): the index, which
// blockers still hold a task up (store copy wins, overridden / done / trashed
// ones don't), masked names for blockers the person can't read, the loop
// check, the refusal text, the bulk split, and that every runtime helper is
// inert (no network, input unchanged) while the gate is off.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const D = require("./TK_deps.js");

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

const row = (task, blocker, extra) =>
  Object.assign({ task_id: task, blocker_id: blocker, source: "manual", blocker_text: "B " + blocker, task_text: "T " + task }, extra || {});

t("index groups rows both ways and skips junk", () => {
  const idx = D.TKD_index([row("a", "b"), row("a", "c"), row("d", "b"), null, { task_id: "x" }]);
  assert.deepStrictEqual(Object.keys(idx.byTask).sort(), ["a", "d"]);
  assert.strictEqual(idx.byTask.a.length, 2);
  assert.strictEqual(idx.byBlocker.b.length, 2);
  assert.deepStrictEqual(D.TKD_index(null), { byTask: {}, byBlocker: {} });
});

t("openBlockers: done, trashed and overridden rows don't count", () => {
  const idx = D.TKD_index([
    row("a", "b"),
    row("a", "c", { blocker_done: true }),
    row("a", "d", { blocker_deleted: true }),
    row("a", "e", { overridden_at: "2026-10-27T00:00:00Z" }),
  ]);
  const open = D.TKD_openBlockers("a", idx, {});
  assert.deepStrictEqual(open.map((b) => b.id), ["b"]);
  assert.strictEqual(open[0].text, "B b");
});

t("openBlockers: the store copy wins over the row snapshot", () => {
  const idx = D.TKD_index([row("a", "b"), row("a", "c", { blocker_done: true })]);
  // b finished in this browser; c was reopened here.
  const tasks = { b: { id: "b", done: true, status: "done" }, c: { id: "c", done: false, status: "todo", text: "Fresh C" } };
  const open = D.TKD_openBlockers("a", idx, tasks);
  assert.deepStrictEqual(open.map((x) => x.id), ["c"]);
  assert.strictEqual(open[0].text, "Fresh C");
  // Trashed in the store.
  assert.strictEqual(D.TKD_openBlockers("a", idx, { b: { id: "b", deleted_at: "x" }, c: { id: "c", deleted_at: "x" } }).length, 0);
});

t("unreadable blockers are masked (no title, client or assignee)", () => {
  const idx = D.TKD_index([row("a", "b", { blocker_readable: false, blocker_client_id: "9", blocker_assignee: "x@y.z" })]);
  const open = D.TKD_openBlockers("a", idx, {});
  assert.strictEqual(open[0].text, "");
  assert.strictEqual(open[0].client_id, null);
  assert.strictEqual(open[0].assignee, "");
  assert.ok(D.TKD_blockedText(open).indexOf("a task you can't see") >= 0);
  assert.ok(D.TKD_blockedText(open).indexOf("B b") < 0);
  const all = D.TKD_allBlockers("a", idx, {});
  assert.strictEqual(all[0].readable, false);
  assert.strictEqual(all[0].text, "");
});

t("allBlockers lists every row with its state", () => {
  const idx = D.TKD_index([row("a", "b"), row("a", "c", { blocker_done: true }), row("a", "d", { overridden_at: "x" })]);
  const all = D.TKD_allBlockers("a", idx, {});
  assert.deepStrictEqual(
    all.map((b) => [b.id, b.open, b.done, b.overridden]),
    [
      ["b", true, false, false],
      ["c", false, true, false],
      ["d", false, false, true],
    ],
  );
});

t("blocking lists the tasks this one holds up, masked when unreadable", () => {
  const idx = D.TKD_index([row("a", "b"), row("c", "b", { task_readable: false })]);
  const l = D.TKD_blocking("b", idx);
  assert.deepStrictEqual(l.map((x) => [x.id, x.text]), [["a", "T a"], ["c", ""]]);
});

t("isBlockedTask: only open tasks with an open blocker", () => {
  const idx = D.TKD_index([row("a", "b")]);
  assert.strictEqual(D.TKD_isBlockedTask({ id: "a", status: "todo" }, idx, {}), true);
  assert.strictEqual(D.TKD_isBlockedTask({ id: "a", status: "done", done: true }, idx, {}), false);
  assert.strictEqual(D.TKD_isBlockedTask({ id: "a", deleted_at: "x" }, idx, {}), false);
  assert.strictEqual(D.TKD_isBlockedTask({ id: "z" }, idx, {}), false);
  assert.strictEqual(D.TKD_isBlockedTask(null, idx, {}), false);
});

t("wouldCycle: self, direct and indirect loops", () => {
  const idx = D.TKD_index([row("b", "c"), row("c", "a")]);
  assert.strictEqual(D.TKD_wouldCycle("a", "a", idx), true);
  // a blocked by b, while b waits on c which waits on a.
  assert.strictEqual(D.TKD_wouldCycle("a", "b", idx), true);
  assert.strictEqual(D.TKD_wouldCycle("a", "x", idx), false);
  assert.strictEqual(D.TKD_wouldCycle("x", "a", idx), false);
  // A long chain stops at depth 50 without hanging.
  const rows = [];
  for (let i = 0; i < 200; i++) rows.push(row("n" + i, "n" + (i + 1)));
  assert.strictEqual(D.TKD_wouldCycle("n0", "n1", D.TKD_index(rows)), false);
  // A loop already in the data doesn't hang.
  assert.strictEqual(D.TKD_wouldCycle("q", "p", D.TKD_index([row("p", "r"), row("r", "p")])), false);
});

t("blockedText and chip text", () => {
  const one = [{ readable: true, text: "Reconcile bank" }];
  assert.strictEqual(D.TKD_blockedText(one), "Blocked by 1 unfinished task: Reconcile bank. Finish that first.");
  const five = ["A", "B", "C", "D", "E"].map((x) => ({ readable: true, text: x }));
  assert.strictEqual(D.TKD_blockedText(five), "Blocked by 5 unfinished tasks: A, B, C and 2 more. Finish those first.");
  assert.strictEqual(D.TKD_blockedText([]), "");
  assert.strictEqual(D.TKD_chipText(2), "Blocked by 2");
  assert.strictEqual(D.TKD_chipTitle(one), "Waiting on: Reconcile bank");
  const long = [{ readable: true, text: "x".repeat(80) }];
  assert.ok(D.TKD_blockedText(long).indexOf("...") > 0);
});

t("movesBlocked: start, send for review and finish only", () => {
  ["done", "in_progress", "ready_for_review"].forEach((s) => assert.strictEqual(D.TKD_movesBlocked(s), true));
  ["todo", "waiting_client", "", null, "constructor"].forEach((s) => assert.strictEqual(D.TKD_movesBlocked(s), false));
});

t("splitBulk: complete and moving statuses skip blocked ids", () => {
  const isB = (id) => id === "b";
  assert.deepStrictEqual(D.TKD_splitBulk(["a", "b", "c"], "complete", null, isB), { keep: ["a", "c"], skipped: [{ id: "b", reason: "blocked" }] });
  assert.deepStrictEqual(D.TKD_splitBulk(["a", "b"], "set_status", { status: "in_progress" }, isB).keep, ["a"]);
  // Other kinds / statuses pass through untouched.
  assert.deepStrictEqual(D.TKD_splitBulk(["a", "b"], "set_status", { status: "waiting_client" }, isB), { keep: ["a", "b"], skipped: [] });
  assert.deepStrictEqual(D.TKD_splitBulk(["a", "b"], "assign", { assignee: "x" }, isB), { keep: ["a", "b"], skipped: [] });
  assert.deepStrictEqual(D.TKD_splitBulk(["a", "b"], "complete", null, null), { keep: ["a", "b"], skipped: [] });
});

// Runtime helpers in a sandbox: gate off means no call and no change.
function sandbox(gateOn) {
  const calls = [];
  const ctx = {
    window: { dispatchEvent() {}, addEventListener() {}, removeEventListener() {} },
    Event: function () {},
    CustomEvent: function () {},
    TKP_on: () => gateOn,
    TK_api: {
      depList: () => {
        calls.push("depList");
        return Promise.resolve([row("a", "b")]);
      },
    },
    TK_store: { getState: () => ({ tasks: { a: { id: "a", status: "todo" }, b: { id: "b", status: "todo" } } }) },
    console,
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "TK_deps.js"), "utf8"), ctx);
  return { ctx, calls };
}

(async () => {
  {
    const { ctx, calls } = sandbox(false);
    await vm.runInContext("TKD_load(true)", ctx);
    t("gate off: no load, nothing blocked, lists unchanged", () => {
      assert.deepStrictEqual(calls, []);
      assert.strictEqual(vm.runInContext("TKD_ready()", ctx), false);
      assert.strictEqual(vm.runInContext("TKD_blockersOf({ id: 'a' })", ctx), null);
      assert.strictEqual(vm.runInContext("TKD_isBlockedId('a')", ctx), false);
      assert.strictEqual(vm.runInContext("TKD_groupOpt()", ctx), undefined);
      vm.runInContext("var L = [{ id: 'a' }, { id: 'b' }];", ctx);
      assert.strictEqual(vm.runInContext("TKD_skipBlocked(L) === L", ctx), true);
      assert.strictEqual(vm.runInContext("TKD_precheck({ id: 'a' }, 'done', false)", ctx), false);
    });
  }
  {
    const { ctx, calls } = sandbox(true);
    await vm.runInContext("TKD_load(true)", ctx);
    t("gate on: loads once, blocks a, not b", () => {
      assert.deepStrictEqual(calls, ["depList"]);
      assert.strictEqual(vm.runInContext("TKD_ready()", ctx), true);
      assert.strictEqual(vm.runInContext("TKD_isBlockedId('a')", ctx), true);
      assert.strictEqual(vm.runInContext("TKD_isBlockedId('b')", ctx), false);
      assert.strictEqual(vm.runInContext("TKD_groupOpt()({ id: 'a', status: 'todo' })", ctx), true);
      assert.deepStrictEqual(JSON.parse(vm.runInContext("JSON.stringify(TKD_skipBlocked([{ id: 'a' }, { id: 'b' }]))", ctx)), [{ id: "b" }]);
      // Precheck stops a finish but not a move to To do.
      assert.strictEqual(vm.runInContext("TKD_precheck({ id: 'a', status: 'todo' }, 'done', false)", ctx), true);
      assert.strictEqual(vm.runInContext("TKD_precheck({ id: 'a', status: 'in_progress' }, 'todo', false)", ctx), false);
      // Back from review / waiting on the client is a resume, not a start.
      assert.strictEqual(vm.runInContext("TKD_precheck({ id: 'a', status: 'ready_for_review' }, 'in_progress', false)", ctx), false);
      assert.strictEqual(vm.runInContext("TKD_precheck({ id: 'a', status: 'waiting_client' }, 'in_progress', false)", ctx), false);
      assert.strictEqual(vm.runInContext("TKD_precheck({ id: 'a', status: 'todo' }, 'in_progress', false)", ctx), true);
    });
    await vm.runInContext("TKD_load(false)", ctx);
    t("gate on: a second load within a minute is served from memory", () => {
      assert.deepStrictEqual(calls, ["depList"]);
    });
    // A forced load while one is in flight runs once more after it.
    const p1 = vm.runInContext("TKD_load(true)", ctx);
    const p2 = vm.runInContext("TKD_load(true)", ctx);
    const p3 = vm.runInContext("TKD_load(true)", ctx);
    await Promise.all([p1, p2, p3]);
    t("gate on: forced loads during a load chain one more (not one each)", () => {
      assert.deepStrictEqual(calls, ["depList", "depList", "depList"]);
    });
  }
  console.log("TK_deps tests passed (" + n + ")");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
