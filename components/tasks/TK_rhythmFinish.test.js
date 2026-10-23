// Plain node: `node components/tasks/TK_rhythmFinish.test.js`.
// Month rhythm "before flip" items: (b) bulk complete asks Full or
// Preliminary, (a) the rhythm replaces the close steps. Pure helpers plus
// static guards on the wiring (the UI itself needs a signed-in browser).

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const R = require("./TK_rhythmLogic.js");
const T = require("./TK_templateLogic.js");

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
const ROOT = path.join(__dirname, "../..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const TASKS = [
  { id: "t2", client_id: "zion", period_kind: "month", period_start: "2026-10-01" },
  { id: "t1", client_id: "grace", period_kind: "month", period_start: "2026-10-01" },
  { id: "t3", client_id: "grace", period_kind: "month", period_start: "2026-09-01" },
  { id: "t4", client_id: "grace", period_kind: "quarter", period_start: "2026-07-01" },
  { id: "t5", client_id: null, period_kind: "month", period_start: "2026-10-01" },
  { id: "t1", client_id: "grace", period_kind: "month", period_start: "2026-10-01" },
];
const NAMES = { grace: "Grace Community", zion: "Zion Church" };

t("rows: month tasks with a client only, deduped, sorted by client then month", () => {
  const rows = R.TK_bulkReportRows(TASKS, NAMES);
  assert.deepStrictEqual(rows.map((r) => r.id), ["t3", "t1", "t2"]);
  assert.strictEqual(rows[0].clientName, "Grace Community");
  assert.strictEqual(rows[0].month, "September 2026");
  assert.strictEqual(rows[1].period, "2026-10-01");
});

t("rows: a missing name falls back to the client id; bad input is empty", () => {
  const rows = R.TK_bulkReportRows([TASKS[0]], {});
  assert.strictEqual(rows[0].clientName, "zion");
  assert.deepStrictEqual(R.TK_bulkReportRows(null, null), []);
});

t("problem: every row needs a choice; preliminary needs an item", () => {
  const rows = R.TK_bulkReportRows(TASKS, NAMES);
  let p = R.TK_bulkReportProblem(rows, {});
  assert.strictEqual(p.id, "t3");
  assert.ok(p.text.indexOf("Grace Community, September 2026: Pick Full or Preliminary.") === 0);
  p = R.TK_bulkReportProblem(rows, {
    t3: { state: "full" },
    t1: { state: "preliminary", items: [{ label: "  " }] },
    t2: { state: "full" },
  });
  assert.strictEqual(p.id, "t1");
  assert.ok(p.text.indexOf("List at least one item") > 0);
  assert.strictEqual(
    R.TK_bulkReportProblem(rows, {
      t3: { state: "full" },
      t1: { state: "preliminary", items: [{ label: "Operating statement", request_id: "r1" }] },
      t2: { state: "full" },
    }),
    null,
  );
  assert.strictEqual(R.TK_bulkReportProblem([], {}).id, null);
});

t("plan: one entry per chosen row, missing cleaned, full sends no items", () => {
  const rows = R.TK_bulkReportRows(TASKS, NAMES);
  const plan = R.TK_bulkReportPlan(rows, {
    t3: { state: "full", items: [{ label: "ignored" }] },
    t1: { state: "preliminary", items: [{ label: "  Operating   statement ", request_id: "r1" }, { label: "" }] },
  });
  assert.deepStrictEqual(plan, [
    { id: "t3", client_id: "grace", period: "2026-09-01", state: "full", missing: [] },
    { id: "t1", client_id: "grace", period: "2026-10-01", state: "preliminary", missing: [{ label: "Operating statement", request_id: "r1" }] },
  ]);
});

t("after: failed saves stay open with one toast; others still complete", () => {
  assert.deepStrictEqual(R.TK_bulkReportAfter(["a", "b", "c"], []), { ids: ["a", "b", "c"], text: "" });
  const one = R.TK_bulkReportAfter(["a", "b", "c"], ["b"]);
  assert.deepStrictEqual(one.ids, ["a", "c"]);
  assert.ok(one.text.indexOf("One Send reports task") === 0);
  const two = R.TK_bulkReportAfter(["a", "b"], ["a", "b"]);
  assert.deepStrictEqual(two.ids, []);
  assert.ok(two.text.indexOf("2 Send reports tasks") === 0);
});

t("wiring: the bulk bar asks before completing, only for kind complete", () => {
  const src = read("components/tasks/TK_BulkBar.jsx");
  assert.ok(/kind !== "complete"[^\n]*reportPickTasks/.test(src), "complete is the only kind that checks");
  assert.ok(src.indexOf("TK_api.setReportState(it.client_id, it.period, it.state, it.missing)") > 0);
  assert.ok(src.indexOf("TK_bulkReportAfter(pick.ids, failed)") > 0);
  assert.ok(src.indexOf("<TK_BulkReportPick") > 0);
  assert.ok(read("components/tasks/TK_MyTasks.jsx").indexOf("clientNames={clientNames} />") > 0);
  assert.ok(read("components/tasks/TK_List.jsx").indexOf("clientNames={clientNames} />") > 0);
  const api = read("components/tasks/TK_api.js");
  const i = api.indexOf("api.reportPickTasks = function");
  assert.ok(i > 0);
  const body = api.slice(i, i + 800);
  assert.ok(body.indexOf('cur === "todo" || cur === "in_progress"') > 0, "open tasks only");
  assert.ok(body.indexOf("reportPickMaybe(t, cur)") > 0, "same gate as a single completion (TK_rhythmEnabled)");
});

t("close overlap: rhythm note only when the server says it replaces", () => {
  assert.strictEqual(T.TK_closeOptinRhythmText({ rhythm_replaces: false }), "");
  assert.ok(T.TK_closeOptinRhythmText({ rhythm_replaces: true }).indexOf("Ticking a step on the Close tab still works") > 0);
  const sql = read("supabase/slate-rhythm-4d-close-overlap.sql");
  assert.ok(sql.indexOf("if v_rhythm_on and v_set.is_standard and public.tk__is_close_task_key(t.close_key)") > 0);
  assert.ok(sql.indexOf("and not (p_client_id is not null and v_named_test)") > 0, "named test clients keep both");
  assert.ok(read("supabase/slate-rhythm-4d-close-overlap-tests.sql").indexOf("rollback;") > 0);
});

console.log("TK_rhythmFinish: " + n + " tests passed");
