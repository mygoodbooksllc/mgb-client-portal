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

console.log("TK_filterLogic: " + n + " tests passed");
