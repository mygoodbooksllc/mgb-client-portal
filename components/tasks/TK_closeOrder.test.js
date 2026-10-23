// Plain node: `node components/tasks/TK_closeOrder.test.js`.
// Month rhythm S6: Option B (close order) as a view, plus the per-person A/B choice.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const C = require("./TK_closeOrderLogic.js");

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
const read = (p) => fs.readFileSync(path.join(__dirname, "../..", p), "utf8");

const REFS = { r1: "month_rhythm:1_check_in", r2: "month_rhythm:2_check_in", r5: "month_rhythm:5_reports", r6: "month_rhythm:6_reports", x: "other:1" };
const M = (id, tpl, period, status, extra) =>
  Object.assign({ id, template_id: tpl, period_kind: "month", period_start: period, status: status || "todo" }, extra || {});

t("row number from source_ref only", () => {
  assert.strictEqual(C.TK_closeOrderRowOf("month_rhythm:6_reports"), 6);
  assert.strictEqual(C.TK_closeOrderRowOf("month_rhythm:x"), null);
  assert.strictEqual(C.TK_closeOrderRowOf(null), null);
});

t("choice: A by default, B per client, saving A removes the entry", () => {
  assert.strictEqual(C.TK_closeOrderChoice(null, "grace"), "A");
  assert.strictEqual(C.TK_closeOrderChoice({ grace: "B" }, "grace"), "B");
  assert.strictEqual(C.TK_closeOrderChoice({ grace: "Z" }, "grace"), "A");
  assert.deepStrictEqual(C.TK_closeOrderSave({ zion: "B", junk: 4 }, "grace", "B"), { zion: "B", grace: "B" });
  assert.deepStrictEqual(C.TK_closeOrderSave({ zion: "B", grace: "B" }, "grace", "A"), { zion: "B" });
  assert.strictEqual(C.TK_closeOrderKey(" Me@X.com "), "mgb_tk_rhythm_view_v1:me@x.com");
});

t("groups: one per month, oldest first, in rhythm row order; others kept in order", () => {
  const tasks = [
    M("a6", "r6", "2026-10-01"),
    M("o1", null, null, "todo", { period_kind: null }),
    M("b2", "r2", "2026-09-01", "done"),
    M("a1", "r1", "2026-10-01"),
    M("b5", "r5", "2026-09-01"),
    M("ox", "x", "2026-10-01"),
    M("q", "r1", "2026-07-01", "todo", { period_kind: "quarter" }),
  ];
  const r = C.TK_closeOrderGroups(tasks, { refs: REFS });
  assert.deepStrictEqual(r.groups.map((g) => g.key), ["close:2026-09-01", "close:2026-10-01"]);
  assert.strictEqual(r.groups[0].name, "September 2026 close");
  assert.ok(r.groups[0].close);
  assert.deepStrictEqual(r.groups[0].tasks.map((x) => x.id), ["b2", "b5"]);
  assert.deepStrictEqual(r.groups[1].tasks.map((x) => x.id), ["a1", "a6"]);
  assert.deepStrictEqual(r.rest.map((x) => x.id), ["o1", "ox", "q"]);
});

t("pills: Next on the first open step; waiting steps are skipped; done gets none", () => {
  const tasks = [M("s1", "r1", "2026-09-01", "done"), M("s2", "r2", "2026-09-01", "waiting_client"), M("s5", "r5", "2026-09-01"), M("s6", "r6", "2026-09-01")];
  const r = C.TK_closeOrderGroups(tasks, { refs: REFS });
  assert.deepStrictEqual(r.pills, { s2: "waiting", s5: "next" });
  const w = C.TK_closeOrderGroups(tasks, { refs: REFS, waitingIds: C.TK_closeOrderWaitingIds([{ status: "open", task_id: "s5" }, { status: "accepted", task_id: "s6" }]) });
  assert.deepStrictEqual(w.pills, { s2: "waiting", s5: "waiting", s6: "next" });
  assert.deepStrictEqual(C.TK_closeOrderGroups(null, {}), { groups: [], rest: [], pills: {} });
});

t("wiring: gated on the rhythm, client lists only, a view not a data change", () => {
  const ui = read("components/tasks/TK_CloseOrder.jsx");
  assert.ok(ui.indexOf("TK_rhythmEnabled()") > 0);
  assert.ok(!/rpcWrite|\.insert\(|\.update\(|\.upsert\(/.test(ui), "no writes");
  const list = read("components/tasks/TK_List.jsx");
  assert.ok(list.indexOf('on: route.view === "client"') > 0);
  assert.ok(list.indexOf("closeOrder.choice === \"B\" && closeOrder.refs && !byClient && !sort") > 0);
  assert.ok(list.indexOf("{g.close ? null : byClient ? (") > 0, "no add row that would set a close: section");
  const row = read("components/tasks/TK_TaskRow.jsx");
  assert.ok(row.indexOf('if (props.hint && tone === "late") tone = "";') > 0, "target hint is never red");
  const idx = read("index.html");
  assert.ok(idx.indexOf('"components/tasks/TK_closeOrderLogic.js"') > 0);
  assert.ok(idx.indexOf('"components/tasks/TK_TaskRow.jsx",\n        "components/tasks/TK_CloseOrder.jsx"') > 0);
});

console.log("TK_closeOrder: " + n + " tests passed");
