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

// ---- Reply times
t("wait formatting", () => {
  assert.strictEqual(L.OPS_fmtWait(null), "\u2014");
  assert.strictEqual(L.OPS_fmtWait(0), "1 min");
  assert.strictEqual(L.OPS_fmtWait(0.75), "45 min");
  assert.strictEqual(L.OPS_fmtWait(3.24), "3.2 h");
  assert.strictEqual(L.OPS_fmtWait(5), "5 h");
  assert.strictEqual(L.OPS_fmtWait(47.9), "47.9 h");
  assert.strictEqual(L.OPS_fmtWait(50.4), "2.1 days");
  assert.strictEqual(L.OPS_fmtWait(72), "3 days");
  assert.strictEqual(L.OPS_REPLY_GOAL_HOURS, 24);
});
t("reply periods", () => {
  assert.deepStrictEqual(L.OPS_replyPeriod("month", "2026-10-07"), { from: "2026-10-01", to: "2026-10-07" });
  assert.deepStrictEqual(L.OPS_replyPeriod("last-month", "2026-10-07"), { from: "2026-09-01", to: "2026-09-30" });
  assert.deepStrictEqual(L.OPS_replyPeriod("last-month", "2026-01-15"), { from: "2025-12-01", to: "2025-12-31" });
  assert.deepStrictEqual(L.OPS_replyPeriod("90", "2026-10-07"), { from: "2026-07-10", to: "2026-10-07" });
  assert.deepStrictEqual(L.OPS_replyPeriod("last-month", "2026-03-31"), { from: "2026-02-01", to: "2026-02-28" });
});

console.log("staffOpsLogic: " + n + " checks passed");
