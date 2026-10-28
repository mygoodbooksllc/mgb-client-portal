// node components/tasks/TK_filterLogic.test.js
const assert = require("assert");
const L = require("./TK_filterLogic.js");
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

const names = { c1: "Grace Community Church", c2: "Basic Test" };
const ctx = { clientNameOf: (id) => names[id] || "" };
const tasks = [
  { id: "a", text: "Reconcile bank accounts", client_id: "c1", description: "Check the Chase statement" },
  { id: "b", text: "Send reports", client_id: "c2", description: null },
  { id: "c", text: "Payroll review", client_id: null, description: "Ask Gillian about PTO" },
  { id: "d", text: null, client_id: "c1", description: "" },
];

t("terms: lower case, split on white space, capped", () => {
  assert.deepStrictEqual(L.TK_searchTerms("  Bank  RECON "), ["bank", "recon"]);
  assert.deepStrictEqual(L.TK_searchTerms(""), []);
  assert.deepStrictEqual(L.TK_searchTerms(null), []);
  assert.deepStrictEqual(L.TK_searchTerms("   "), []);
  assert.strictEqual(L.TK_searchTerms("x".repeat(500))[0].length, 200);
});

t("empty query gives the same array back (identity)", () => {
  assert.strictEqual(L.TK_applySearch(tasks, "", ctx), tasks);
  assert.strictEqual(L.TK_applySearch(tasks, "   ", ctx), tasks);
  assert.strictEqual(L.TK_applySearch(tasks, null, ctx), tasks);
});

t("substring on the title, any case (recon finds Reconcile)", () => {
  assert.deepStrictEqual(L.TK_applySearch(tasks, "recon", ctx).map((x) => x.id), ["a"]);
  assert.deepStrictEqual(L.TK_applySearch(tasks, "REPORTS", ctx).map((x) => x.id), ["b"]);
});

t("client name matches", () => {
  assert.deepStrictEqual(L.TK_applySearch(tasks, "grace", ctx).map((x) => x.id), ["a", "d"]);
  assert.deepStrictEqual(L.TK_applySearch(tasks, "basic", ctx).map((x) => x.id), ["b"]);
});

t("notes match", () => {
  assert.deepStrictEqual(L.TK_applySearch(tasks, "gillian", ctx).map((x) => x.id), ["c"]);
  assert.deepStrictEqual(L.TK_applySearch(tasks, "chase", ctx).map((x) => x.id), ["a"]);
});

t("every word must match, across fields", () => {
  assert.deepStrictEqual(L.TK_applySearch(tasks, "grace chase", ctx).map((x) => x.id), ["a"]);
  assert.deepStrictEqual(L.TK_applySearch(tasks, "grace payroll", ctx).map((x) => x.id), []);
});

t("a word never matches across two fields joined together", () => {
  // "accountsgrace" would only match if the fields ran together
  assert.deepStrictEqual(L.TK_applySearch(tasks, "accountsgrace", ctx).map((x) => x.id), []);
});

t("no client lookup, null rows and bad input are safe", () => {
  assert.deepStrictEqual(L.TK_applySearch(tasks, "grace", {}).map((x) => x.id), []);
  assert.deepStrictEqual(L.TK_applySearch([null, tasks[0]], "bank", ctx).map((x) => x.id), ["a"]);
  assert.deepStrictEqual(L.TK_applySearch(null, "bank", ctx), []);
  assert.strictEqual(L.TK_searchMatch(null, ["a"], ctx), false);
  assert.strictEqual(L.TK_searchMatch(tasks[0], [], ctx), true);
});

t("count text", () => {
  assert.strictEqual(L.TK_searchCountText(0), "No tasks match");
  assert.strictEqual(L.TK_searchCountText(1), "1 task matches");
  assert.strictEqual(L.TK_searchCountText(4), "4 tasks match");
});

// ---- Slate plus filter bar -------------------------------------------------
const today = "2026-10-27";
const ft = [
  { id: "m1", assignee_email: "Me@x.org", client_id: "c1", project_id: "p1", due_date: "2026-10-20", status: "todo" },
  { id: "m2", assignee_email: "me@x.org", client_id: "c2", project_id: null, due_date: "2026-10-27", status: "in_progress" },
  { id: "m3", assignee_email: null, client_id: "c1", project_id: "p2", due_date: "2026-11-02", status: "waiting_client" },
  { id: "m4", assignee_email: "me@x.org", client_id: null, project_id: null, due_date: null, status: "ready_for_review" },
  { id: "m5", assignee_email: "me@x.org", client_id: "c2", project_id: "p1", due_date: "2026-11-20", status: "todo" },
  { id: "m6", assignee_email: "me@x.org", client_id: "c1", project_id: null, due_date: "2026-10-01", status: "waiting_client" },
];
const fctx = {
  email: "me@x.org",
  today,
  statusOf: (x) => x.status,
  // the real TK_isOverdue skips waiting-on-client; mimic it
  isLate: (x, d) => x.status !== "waiting_client" && x.status !== "done" && !!x.due_date && x.due_date < d,
};
const ids = (f) => L.TK_applySlateFilters(ft, f, fctx).map((x) => x.id);

t("normalize: anything becomes a safe filter set", () => {
  const def = { q: "", assignee: "any", client: "", project: "", due: "any", from: "", to: "", status: "any" };
  assert.deepStrictEqual(L.TK_normalizeSlateFilters(null), def);
  assert.deepStrictEqual(L.TK_normalizeSlateFilters([]), def);
  assert.deepStrictEqual(L.TK_normalizeSlateFilters({ assignee: "boss", due: "soon", status: "done", evil: 1 }), def);
  assert.strictEqual(L.TK_normalizeSlateFilters({ q: "x".repeat(900) }).q.length, 200);
  // custom range: bad dates dropped, swapped when backwards, empty range = any
  assert.deepStrictEqual(
    [L.TK_normalizeSlateFilters({ due: "custom", from: "2026-11-30", to: "2026-11-01" })].map((n) => [n.due, n.from, n.to])[0],
    ["custom", "2026-11-01", "2026-11-30"],
  );
  assert.strictEqual(L.TK_normalizeSlateFilters({ due: "custom", from: "2026-02-31" }).due, "any");
  assert.strictEqual(L.TK_normalizeSlateFilters({ due: "today", from: "2026-11-01" }).from, "");
  assert.strictEqual(L.TK_normalizeSlateFilters({ client: 42 }).client, "42");
});

t("nothing set gives the same array back (identity)", () => {
  assert.strictEqual(L.TK_applySlateFilters(ft, {}, fctx), ft);
  assert.strictEqual(L.TK_applySlateFilters(ft, null, fctx), ft);
  assert.strictEqual(L.TK_applySlateFilters(ft, { q: "bank" }, fctx), ft); // search is applied by TK_applySearch
  assert.strictEqual(L.TK_slateFiltersActive({}), false);
  assert.strictEqual(L.TK_slateFiltersActive({ q: "  " }), false);
  assert.strictEqual(L.TK_slateFiltersActive({ q: "a" }), true);
  assert.strictEqual(L.TK_slateFiltersActive({ status: "late" }), true);
});

t("assignee: me (any case) and unassigned", () => {
  assert.deepStrictEqual(ids({ assignee: "me" }), ["m1", "m2", "m4", "m5", "m6"]);
  assert.deepStrictEqual(ids({ assignee: "unassigned" }), ["m3"]);
  assert.deepStrictEqual(L.TK_applySlateFilters(ft, { assignee: "me" }, Object.assign({}, fctx, { email: "" })), []);
});

t("client and project (none and an id)", () => {
  assert.deepStrictEqual(ids({ client: "c1" }), ["m1", "m3", "m6"]);
  assert.deepStrictEqual(ids({ project: "none" }), ["m2", "m4", "m6"]);
  assert.deepStrictEqual(ids({ project: "p1" }), ["m1", "m5"]);
});

t("due: late, today, next 7, next 30, none, custom", () => {
  assert.deepStrictEqual(ids({ due: "late" }), ["m1"]); // m6 is waiting on the client: not late
  assert.deepStrictEqual(ids({ due: "today" }), ["m2"]);
  assert.deepStrictEqual(ids({ due: "next7" }), ["m2", "m3"]);
  assert.deepStrictEqual(ids({ due: "next30" }), ["m2", "m3", "m5"]);
  assert.deepStrictEqual(ids({ due: "none" }), ["m4"]);
  assert.deepStrictEqual(ids({ due: "custom", from: "2026-10-15", to: "2026-10-31" }), ["m1", "m2"]);
  assert.deepStrictEqual(ids({ due: "custom", from: "2026-11-01" }), ["m3", "m5"]);
  assert.deepStrictEqual(ids({ due: "custom", to: "2026-10-05" }), ["m6"]);
});

t("next 7 days crosses a month end", () => {
  const x = [{ id: "z", due_date: "2026-11-03", status: "todo" }];
  assert.strictEqual(L.TK_applySlateFilters(x, { due: "next7" }, fctx).length, 1);
  assert.strictEqual(L.TK_applySlateFilters(x, { due: "next7" }, Object.assign({}, fctx, { today: "2026-10-20" })).length, 0);
});

t("status: late, waiting, each open status; filters AND together", () => {
  assert.deepStrictEqual(ids({ status: "late" }), ["m1"]);
  assert.deepStrictEqual(ids({ status: "waiting" }), ["m3", "m6"]);
  assert.deepStrictEqual(ids({ status: "todo" }), ["m1", "m5"]);
  assert.deepStrictEqual(ids({ status: "ready_for_review" }), ["m4"]);
  assert.deepStrictEqual(ids({ status: "waiting", client: "c1", assignee: "me" }), ["m6"]);
  assert.deepStrictEqual(ids({ status: "todo", due: "next30" }), ["m5"]);
});

t("filters then search compose (the page runs both)", () => {
  const rows = [
    { id: "s1", text: "Bank recon", client_id: "c1", status: "todo", assignee_email: "me@x.org" },
    { id: "s2", text: "Bank recon", client_id: "c2", status: "todo", assignee_email: null },
  ];
  const a = L.TK_applySlateFilters(rows, { assignee: "me" }, fctx);
  assert.deepStrictEqual(L.TK_applySearch(a, "recon", ctx).map((x) => x.id), ["s1"]);
});

t("equal: search by words, other fields exact", () => {
  assert.strictEqual(L.TK_slateFiltersEqual({ q: "  Bank   recon" }, { q: "bank recon" }), true);
  assert.strictEqual(L.TK_slateFiltersEqual({}, { assignee: "any", status: "any" }), true);
  assert.strictEqual(L.TK_slateFiltersEqual({ status: "late" }, { status: "waiting" }), false);
  assert.strictEqual(L.TK_slateFiltersEqual({ due: "custom", from: "2026-11-01" }, { due: "custom", from: "2026-11-02" }), false);
});

t("names: trimmed, 1-60, unique any case, rename keeps own name, 30 max", () => {
  const rows = [{ id: "1", name: "Late for Grace" }];
  assert.deepStrictEqual(L.TK_filterViewNameCheck("  My   late  ", rows, null), { ok: true, name: "My late" });
  assert.strictEqual(L.TK_filterViewNameCheck("   ", rows, null).code, "blank");
  assert.strictEqual(L.TK_filterViewNameCheck("x".repeat(61), rows, null).code, "too_long");
  assert.strictEqual(L.TK_filterViewNameCheck("x".repeat(60), rows, null).ok, true);
  assert.strictEqual(L.TK_filterViewNameCheck("LATE FOR GRACE", rows, null).code, "duplicate");
  assert.strictEqual(L.TK_filterViewNameCheck("Late for grace", rows, "1").ok, true);
  const many = Array.from({ length: 30 }, (_, i) => ({ id: String(i), name: "v" + i }));
  assert.strictEqual(L.TK_filterViewNameCheck("new", many, null).code, "too_many");
  assert.strictEqual(L.TK_filterViewNameCheck("new", many, "3").ok, true);
});

t("database errors map to plain words", () => {
  assert.strictEqual(L.TK_filterViewErrorCode({ message: 'duplicate key value violates unique constraint "tk_slate_filter_views_owner_name_uq"' }), "duplicate");
  assert.strictEqual(L.TK_filterViewErrorCode({ message: 'new row violates check constraint "tk_slate_filter_views_name_check"' }), "too_long");
  assert.strictEqual(L.TK_filterViewErrorCode({ message: "tk_too_many_views" }), "too_many");
  assert.strictEqual(L.TK_filterViewErrorCode({ message: "x", details: "tk_slate_filter_views_filters_check" }), "too_big");
  assert.strictEqual(L.TK_filterViewErrorCode({ code: "tk_offline" }), "offline");
  assert.strictEqual(L.TK_filterViewErrorCode({ message: "tk_not_found" }), "not_found");
  assert.strictEqual(L.TK_filterViewErrorCode({ message: "boom" }), "");
  assert.strictEqual(L.TK_filterViewErrorCode(null), "");
  assert.ok(/30/.test(L.TK_filterViewErrorText("too_many")));
  assert.ok(L.TK_filterViewErrorText("") .length > 0);
});

console.log("TK_filterLogic: " + n + " tests passed");
