// Plain node, no framework: `node components/staff/staffOpsLogic.test.js`.
// Guards the staff ops rules (staffOpsLogic.js).

const assert = require("assert");
const L = require("./staffOpsLogic.js");

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

// ---- Hours budget
t("no budget never flags", () => {
  assert.strictEqual(L.OPS_budgetStatus(600, null), null);
  assert.strictEqual(L.OPS_budgetStatus(600, ""), null);
  assert.strictEqual(L.OPS_budgetStatus(600, 0), null);
  assert.strictEqual(L.OPS_budgetStatus(600, "abc"), null);
});
t("unknown hours never flags", () => {
  assert.strictEqual(L.OPS_budgetStatus(null, 10), null);
});
t("budget thresholds", () => {
  assert.strictEqual(L.OPS_budgetStatus(0, 10).state, "ok");
  assert.strictEqual(L.OPS_budgetStatus(479, 10).state, "ok");
  assert.strictEqual(L.OPS_budgetStatus(480, 10).state, "near");
  assert.strictEqual(L.OPS_budgetStatus(599, 10).state, "near");
  assert.strictEqual(L.OPS_budgetStatus(600, 10).state, "over");
  assert.strictEqual(L.OPS_budgetStatus(900, "10").pct, 150);
});
t("budget rule matching", () => {
  const near = L.OPS_budgetStatus(500, 10);
  const over = L.OPS_budgetStatus(700, 10);
  const ok = L.OPS_budgetStatus(60, 10);
  assert.ok(L.OPS_budgetMatches("any", null));
  assert.ok(!L.OPS_budgetMatches("over", null));
  assert.ok(!L.OPS_budgetMatches("near", null));
  assert.ok(L.OPS_budgetMatches("near", near) && L.OPS_budgetMatches("near", over) && !L.OPS_budgetMatches("near", ok));
  assert.ok(L.OPS_budgetMatches("over", over) && !L.OPS_budgetMatches("over", near));
});

console.log("staffOpsLogic: " + n + " checks passed");
