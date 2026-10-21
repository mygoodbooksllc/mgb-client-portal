// Plain node: `node components/tasks/TK_rhythmSlice4.test.js`.
// Slate month rhythm slice 4: the late rule (owner rule, ungated) shared with
// SQL tk_late_excused, report-state helpers (row 6 picker, client badge), and
// static guards on the gated UI wiring.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const L = require("./TK_logic.js");
const R = require("./TK_rhythmLogic.js");
const RV = require("./TK_reviewLogic.js");

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
const SQL = read("supabase/slate-rhythm-4c-late-exclusion.sql");
const SQL_TESTS = read("supabase/slate-rhythm-4c-late-exclusion-tests.sql");

const TODAY = "2026-10-21";
const CACHE = { keys: { "grace|2026-08-01": true, "grace|2026-07-01": true } };
const mk = (o) => Object.assign({ id: "x", status: "todo", done: false, client_id: "grace", due_date: "2026-10-01",
  assignee_email: "me@x.test", staff_email: "boss@x.test" }, o);

// The same cases the SQL self-test checks (slate-rhythm-4c-late-exclusion-tests.sql).
const VECTORS = [
  [{ status: "waiting_client", client_id: null, period_kind: null, period_start: null }, true, "waiting is excused"],
  [{ status: "todo", period_kind: "month", period_start: "2026-08-15" }, true, "preliminary month is excused"],
  [{ status: "todo", period_kind: "month", period_start: "2026-09-01" }, false, "full or no state is not excused"],
  [{ status: "todo", period_kind: "quarter", period_start: "2026-07-01" }, false, "quarter period is not excused"],
  [{ status: "todo", client_id: "other", period_kind: "month", period_start: "2026-08-01" }, false, "other client is not excused"],
  [{ status: "todo", period_kind: null, period_start: null }, false, "no period is not excused"],
  [{ status: "in_progress", period_kind: "month", period_start: "2026-07-01" }, true, "any open status in a preliminary month"],
  [{ status: "waiting_client", period_kind: "month", period_start: "2026-07-01" }, true, "both rules"],
];

t("TK_lateExcused vectors (shared with SQL)", () => {
  VECTORS.forEach(([o, want, why]) => assert.strictEqual(L.TK_lateExcused(mk(o), CACHE), want, why));
  assert.strictEqual(L.TK_lateExcused(null), false);
});

t("SQL rule matches: waiting, month period only, preliminary state", () => {
  const fn = SQL.slice(SQL.indexOf("create or replace function public.tk_late_excused"), SQL.indexOf("revoke all on function public.tk_late_excused"));
  assert.ok(/coalesce\(p_status, ''\) = 'waiting_client'/.test(fn));
  assert.ok(/p_period_kind = 'month'/.test(fn));
  assert.ok(/s\.state = 'preliminary'/.test(fn));
  assert.ok(/date_trunc\('month', p_period_start\)/.test(fn));
  ["staff_performance(integer,jsonb)", "client_health(jsonb)", "digest_weekly_data(date,date)", "tk_on_time_stats(date,date,text)"]
    .forEach((f) => assert.ok(SQL.indexOf("patch_fn('public." + f + "'") >= 0, "patched " + f));
  assert.ok(/Applied to production 2026-10-21/.test(SQL), "applied header");
  // The SQL self-test proves identical output before and after on production data.
  ["staff_performance identical", "client_health identical", "digest_weekly_data identical", "tk_on_time_stats identical",
   "only the 3 ordinary late tasks count", "everyone else unchanged"].forEach((s) => assert.ok(SQL_TESTS.indexOf(s) >= 0, s));
  assert.ok(/\nrollback;\s*$/.test(SQL_TESTS), "self-test rolls back");
});

t("TK_taskMonth: month periods only", () => {
  assert.strictEqual(L.TK_taskMonth({ period_kind: "month", period_start: "2026-09-01" }), "2026-09-01");
  assert.strictEqual(L.TK_taskMonth({ period_kind: "month", period_start: "2026-09-17T00:00:00Z" }), "2026-09-01");
  assert.strictEqual(L.TK_taskMonth({ period_kind: "quarter", period_start: "2026-07-01" }), null);
  assert.strictEqual(L.TK_taskMonth({ period_kind: "month", period_start: null }), null);
  assert.strictEqual(L.TK_taskMonth({ due_date: "2026-10-04" }), null, "no fallback to the due date");
});

t("TK_setReportStates keeps preliminary rows only", () => {
  const keys = L.TK_setReportStates([
    { client_id: "a", period: "2026-08-01", state: "preliminary" },
    { client_id: "b", period: "2026-08-01", state: "full" },
    { client_id: "c", period: "2026-09-01T00:00:00", state: "preliminary" },
    null,
  ]);
  assert.deepStrictEqual(Object.keys(keys).sort(), ["a|2026-08-01", "c|2026-09-01"]);
  assert.strictEqual(L.TK_reportStateCache.loaded, true);
  L.TK_setReportStates([]);
});

t("overdue and My Tasks groups: excused late tasks never show as late", () => {
  L.TK_setReportStates([{ client_id: "grace", period: "2026-08-01", state: "preliminary" }]);
  const prelim = mk({ id: "p", period_kind: "month", period_start: "2026-08-01" });
  const normal = mk({ id: "n", period_kind: "month", period_start: "2026-09-01" });
  assert.strictEqual(L.TK_isOverdue(prelim, TODAY), false);
  assert.strictEqual(L.TK_isOverdue(normal, TODAY), true);
  const g = L.TK_groupMyTasks([prelim, normal], TODAY, { email: "me@x.test" });
  assert.deepStrictEqual(g.overdue.map((x) => x.id), ["n"]);
  assert.deepStrictEqual(g.waiting.map((x) => x.id), ["p"]);
  // Not late yet: stays in its own time group.
  const soon = mk({ id: "s", due_date: "2026-10-23", period_kind: "month", period_start: "2026-08-01" });
  assert.deepStrictEqual(L.TK_groupMyTasks([soon], TODAY, { email: "me@x.test" }).week.map((x) => x.id), ["s"]);
  L.TK_setReportStates([]);
});

t("byte-identical for every other task (empty cache, no rhythm data)", () => {
  L.TK_setReportStates([]);
  const statuses = ["todo", "in_progress", "ready_for_review", "done"];
  const kinds = [null, "month", "quarter"];
  const dues = ["2026-10-01", TODAY, "2026-10-24", "2026-12-01", null];
  const list = [];
  let i = 0;
  statuses.forEach((s) => kinds.forEach((k) => dues.forEach((d) => {
    list.push(mk({ id: "t" + i++, status: s, done: s === "done", period_kind: k, period_start: k ? "2026-08-01" : null, due_date: d,
      completed_at: s === "done" ? "2026-10-20T10:00:00Z" : null }));
  })));
  // Old rule: open and not waiting and due before today.
  list.forEach((x) => {
    const old = x.status !== "done" && !!x.due_date && x.due_date < TODAY;
    assert.strictEqual(L.TK_isOverdue(x, TODAY), old, x.id);
  });
  const g = L.TK_groupMyTasks(list, TODAY, { email: "me@x.test" });
  assert.strictEqual(g.waiting.length, 0);
  assert.strictEqual(g.overdue.length, list.filter((x) => x.status !== "done" && x.due_date && x.due_date < TODAY).length);
});

t("on-time outcome: excused tasks never count (browser global), others unchanged", () => {
  const ot = (o) => Object.assign({ id: "o", source: "template", assignee_email: "bk@x.test", created_by: "a@x.test",
    due_date_original: "2026-10-10", status: "todo", client_id: "grace" }, o);
  const NOW = Date.parse("2026-10-21T15:00:00Z");
  const before = RV.TK_onTimeOutcome(ot({ status: "waiting_client", waiting_since: "2026-10-15T00:00:00Z" }), NOW);
  assert.ok(before && before.onTime === false, "node without the global: old behavior");
  global.TK_lateExcused = L.TK_lateExcused;
  try {
    L.TK_setReportStates([{ client_id: "grace", period: "2026-08-01", state: "preliminary" }]);
    assert.strictEqual(RV.TK_onTimeOutcome(ot({ status: "waiting_client", waiting_since: "2026-10-15T00:00:00Z" }), NOW), null);
    assert.strictEqual(RV.TK_onTimeOutcome(ot({ period_kind: "month", period_start: "2026-08-01" }), NOW), null);
    const plain = RV.TK_onTimeOutcome(ot({ period_kind: "month", period_start: "2026-09-01" }), NOW);
    assert.ok(plain && plain.onTime === false, "an ordinary late task still counts");
  } finally {
    delete global.TK_lateExcused;
    L.TK_setReportStates([]);
  }
});

t("report-state helpers: row lookup, period, picker gate", () => {
  assert.strictEqual(R.TK_rhythmRowOf({ source_ref: "month_rhythm:6_reports" }), "reports");
  assert.strictEqual(R.TK_rhythmRowOf("month_rhythm:7_follow_up"), "follow_7");
  assert.strictEqual(R.TK_rhythmRowOf({ source_ref: "month_rhythm:8_follow_up" }), "follow_8");
  assert.strictEqual(R.TK_rhythmRowOf({ source_ref: "month_rhythm:2_check_in" }), null);
  assert.strictEqual(R.TK_rhythmRowOf(null), null);
  const task = { client_id: "c", period_kind: "month", period_start: "2026-09-01" };
  const tpl = { source_ref: "month_rhythm:6_reports" };
  assert.strictEqual(R.TK_reportPickerNeeded(task, tpl, true), true);
  assert.strictEqual(R.TK_reportPickerNeeded(task, tpl, false), false, "gated by TK_rhythmEnabled()");
  assert.strictEqual(R.TK_reportPickerNeeded(Object.assign({}, task, { client_id: null }), tpl, true), false);
  assert.strictEqual(R.TK_reportPickerNeeded(Object.assign({}, task, { period_kind: "quarter" }), tpl, true), false);
  assert.strictEqual(R.TK_reportPickerNeeded(task, { source_ref: "month_rhythm:7_follow_up" }, true), false);
  assert.strictEqual(R.TK_reportPickerNeeded(task, null, true), false, "template not loaded yet");
});

t("missing list: prefill from open Ask client requests, clean, problems", () => {
  const reqs = [
    { id: "r1", status: "open", title: "  March bank   statement " },
    { id: "r2", status: "answered", title: "Payroll report" },
    { id: "r3", status: "open", title: "Old doc", legacy: true },
    { id: "r4", status: "open", title: "   " },
    { id: "r5", status: "open", title: "Receipts" },
  ];
  assert.deepStrictEqual(R.TK_reportMissingPrefill(reqs), [
    { label: "March bank statement", request_id: "r1" },
    { label: "Receipts", request_id: "r5" },
  ]);
  assert.deepStrictEqual(R.TK_reportMissingPrefill(null), []);
  const many = Array.from({ length: 40 }, (_, i) => ({ label: "Item " + i }));
  assert.strictEqual(R.TK_reportMissingClean(many).length, R.TK_REPORT_MISSING_MAX);
  assert.strictEqual(R.TK_reportMissingClean([{ label: "x".repeat(250) }])[0].label.length, 200);
  assert.strictEqual(R.TK_reportPickerProblem("", []), "Pick Full or Preliminary.");
  assert.strictEqual(R.TK_reportPickerProblem("full", []), null);
  assert.ok(R.TK_reportPickerProblem("preliminary", [{ label: "  " }]));
  assert.strictEqual(R.TK_reportPickerProblem("preliminary", [{ label: "Receipts" }]), null);
  // Same limits as the server (tk_set_report_state).
  const sql = read("supabase/slate-rhythm-4-report-state.sql");
  assert.ok(/30/.test(sql) && /200/.test(sql));
});

t("client badges: preliminary only, newest first, plain labels", () => {
  const out = R.TK_clientReportBadges([
    { period: "2026-08-01", state: "preliminary", missing: [{ label: " Bank  statement ", request_id: "r1" }, { label: "" }] },
    { period: "2026-09-01", state: "full", missing: [] },
    { period: "2026-09-01", state: "none", missing: [] },
    { period: "2026-10-01", state: "preliminary", missing: [] },
    { period: "bad", state: "preliminary" },
  ]);
  assert.deepStrictEqual(out.map((r) => r.month), ["October 2026", "August 2026"]);
  assert.deepStrictEqual(out[1].missing, [{ label: "Bank statement", request_id: "r1" }]);
  assert.deepStrictEqual(R.TK_clientReportBadges(null), []);
  assert.strictEqual(R.TK_reportMonthLabel("2026-01-01"), "January 2026");
});

t("wiring: drawer picker gated, bell gated, client card plain copy", () => {
  const drawer = read("components/tasks/TK_DrawerContent.jsx");
  assert.ok(/TK_reportPickerNeeded\(t, rhythmTpl, rhythmOn\)/.test(drawer));
  assert.ok(/var rhythmOn = typeof TK_rhythmEnabled === "function" && TK_rhythmEnabled\(\);/.test(drawer));
  assert.ok(/if \(!rhythmOn \|\| !templateId/.test(drawer), "no template read with the feature off");
  assert.ok(/api\.setReportState\(t\.client_id, TK_reportPeriodOf\(t\), state, missing\)\.then/.test(drawer), "state saved before completing");
  const bell = read("components/staff/TopBar.jsx");
  assert.ok(/const on = typeof TK_rhythmEnabled === "function" && TK_rhythmEnabled\(\);/.test(bell));
  assert.ok(/id: "task:rhy:" \+ row\.id/.test(bell), "follows the Tasks assigned to me bell setting");
  const cn = read("components/client/ClientNeeds.jsx");
  const card = cn.slice(cn.indexOf("function CN_ReportStateCard"));
  assert.ok(/tk_client_report_state/.test(card));
  assert.ok(!/!\s*[<"`']/.test(card.replace(/!==|!=|!\w|!\(/g, "")), "no exclamation marks in copy");
  assert.ok(/if \(!rows\.length\) return null;/.test(card), "renders nothing with no data");
  assert.ok(!/task_id|assignee|staff_email/.test(card), "never task details on the client side");
  const app = read("app.jsx");
  assert.ok(/<CN_ReportStateCard[\s\S]{0,400}<ReportsPage client=\{scopedClient\} \/>/.test(app));
  assert.ok(/"period_kind", "period_start"\];/.test(app), "staff items carry the task month");
  const team = read("components/staff/TeamPage.jsx");
  assert.ok(/TK_lateExcused\(t\)/.test(team) && /TP_TASK_S4_COLS/.test(team));
  const today = read("components/staff/Today.jsx");
  assert.ok(/t\.due_date < today && !lateExcused\(t\)/.test(today));
  const api = read("components/tasks/TK_api.js");
  assert.ok(/"template_id, period_kind, period_start"/.test(api));
});

t("review fixes: prefill by client, cache loaded for Today and Team, picker guard", () => {
  const drawer = read("components/tasks/TK_DrawerContent.jsx");
  assert.ok(/api\.listClientRequests\(null, p\.clientId\)/.test(drawer), "prefill lists the client's open requests");
  assert.ok(/clientId=\{task\.client_id \|\| null\}/.test(drawer));
  assert.ok(/skipReportPick: true/.test(drawer), "the picker completes past the guard");
  const app = read("app.jsx");
  assert.ok(/await TK_api\.loadReportStates\(\);[\s\S]{0,120}data\.map\(normalizeStaffItem\)/.test(app), "Today and badges load preliminary months");
  assert.ok(/await TK_api\.loadReportStates\(\);/.test(read("components/staff/TeamPage.jsx")));
  const api = read("components/tasks/TK_api.js");
  assert.ok(/!\(opts && opts\.skipReportPick\) && reportPickMaybe\(task, current\)/.test(api));
});

t("no ' 2' duplicate files next to the slice 4 files", () => {
  ["components/tasks", "components/client", "components/staff", "supabase", "docs"].forEach((d) => {
    fs.readdirSync(path.join(ROOT, d)).forEach((f) => assert.ok(!/ 2(\.|$)/.test(f), d + "/" + f));
  });
});

console.log("TK_rhythmSlice4: " + n + " tests passed");
