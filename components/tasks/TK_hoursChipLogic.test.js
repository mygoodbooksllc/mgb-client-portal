// node components/tasks/TK_hoursChipLogic.test.js
// Slate plus hours-vs-budget chip rules (docs/slateplus-hours-chip-spec.md).
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const L = require("./TK_hoursChipLogic.js");
const OPS = require("../staff/staffOpsLogic.js");
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

// Same shape HB_load builds: budgets by client, byClient from OPS_budgetStatus.
function data(budgets, minutes) {
  const byClient = {};
  Object.keys(budgets).forEach((id) => {
    byClient[id] = OPS.OPS_budgetStatus(minutes[id] || 0, budgets[id]);
  });
  return { budgets, minutes, byClient, qboOn: true };
}

t("under 80% is ok", () => {
  const c = L.TKH_chip(data({ a: 20 }, { a: 60 * 10 }), "a");
  assert.strictEqual(c.state, "ok");
  assert.strictEqual(c.text, "10 / 20 h");
  assert.strictEqual(c.pct, 50);
});
t("80% is near (amber), 100% is over (red)", () => {
  assert.strictEqual(L.TKH_chip(data({ a: 10 }, { a: 480 }), "a").state, "near");
  assert.strictEqual(L.TKH_chip(data({ a: 10 }, { a: 600 }), "a").state, "over");
  assert.strictEqual(L.TKH_chip(data({ a: 10 }, { a: 900 }), "a").state, "over");
  assert.ok(/Over budget/.test(L.TKH_chip(data({ a: 10 }, { a: 900 }), "a").title));
});
t("one decimal at most, no trailing .0", () => {
  assert.strictEqual(L.TKH_fmt(12.46), "12.5");
  assert.strictEqual(L.TKH_fmt(8), "8");
  assert.strictEqual(L.TKH_fmt(7.96), "8");
  assert.strictEqual(L.TKH_chip(data({ a: 40 }, { a: 90 }), "a").text, "1.5 / 40 h");
});
t("no budget, zero budget, loading or unknown hours show nothing", () => {
  assert.strictEqual(L.TKH_chip(data({ a: 10 }, {}), "b"), null);
  assert.strictEqual(L.TKH_chip(data({ a: 0 }, {}), "a"), null);
  assert.strictEqual(L.TKH_chip(null, "a"), null);
  assert.strictEqual(L.TKH_chip(data({ a: 10 }, {}), ""), null);
  assert.strictEqual(L.TKH_chip(data({ a: 10 }, {}), null), null);
  // QuickBooks Time not connected: byClient entry is null.
  assert.strictEqual(L.TKH_chip({ budgets: { a: 10 }, byClient: { a: null }, qboOn: false }, "a"), null);
});
t("no hours yet this month is 0 / budget, ok", () => {
  const c = L.TKH_chip(data({ a: 10 }, {}), "a");
  assert.strictEqual(c.text, "0 / 10 h");
  assert.strictEqual(c.state, "ok");
});
t("isAdmin follows the staff list role, unknown is not admin", () => {
  const staff = [
    { email: "A@x.org", role: "admin" },
    { email: "b@x.org", role: "bookkeeper" },
  ];
  assert.strictEqual(L.TKH_isAdmin(staff, "a@x.org"), true);
  assert.strictEqual(L.TKH_isAdmin(staff, "b@x.org"), false);
  assert.strictEqual(L.TKH_isAdmin(staff, "c@x.org"), false);
  assert.strictEqual(L.TKH_isAdmin(null, "a@x.org"), false);
  assert.strictEqual(L.TKH_isAdmin(staff, ""), false);
});
t("wiring: chip is gated by TKP_useOn and reuses HB_useBudgets (no second copy of the thresholds)", () => {
  const view = fs.readFileSync(path.join(__dirname, "TK_HoursChip.jsx"), "utf8");
  assert.ok(/TKP_useOn\(\)/.test(view));
  assert.ok(/HB_useBudgets\(/.test(view));
  assert.ok(!/0\.8|OPS_BUDGET/.test(L.TKH_chip.toString()));
  const header = fs.readFileSync(path.join(__dirname, "TK_ClientHeader.jsx"), "utf8");
  const row = fs.readFileSync(path.join(__dirname, "TK_TaskRow.jsx"), "utf8");
  assert.ok(/<TK_HoursChip /.test(header));
  assert.ok((row.match(/<TK_HoursChip /g) || []).length === 2);
  const idx = fs.readFileSync(path.join(__dirname, "../../index.html"), "utf8");
  assert.ok(idx.indexOf("components/tasks/TK_hoursChipLogic.js") > 0);
  assert.ok(idx.indexOf("components/tasks/TK_HoursChip.jsx") > idx.indexOf("components/staff/HoursBudget.jsx"));
});

console.log("TK_hoursChipLogic: " + n + " tests passed");
