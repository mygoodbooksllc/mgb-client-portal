// Staff operations: pure rules shared by the staff ops components
// (HoursBudget.jsx, ReplyTimes.jsx, Coverage.jsx, Deadlines.jsx,
// HealthBoard.jsx, SopFreshness.jsx, StaffOnboarding.jsx) and the node test
// (staffOpsLogic.test.js). No React, no Supabase.

// ---- Hours budget (supabase/client-hours-budget.sql)
var OPS_BUDGET_WARN = 0.8; // "near" from 80% of the budget
var OPS_BUDGET_OVER = 1.0; // "over" from 100%

// minutes: QuickBooks Time minutes used; budgetHours: client_profile
// .monthly_hours_budget. No budget (null, blank, 0 or bad) => null, so
// nothing is flagged. Hours unknown (null) => null too: unknown never matches.
function OPS_budgetStatus(minutes, budgetHours) {
  var b = budgetHours == null || budgetHours === "" ? NaN : Number(budgetHours);
  if (!(b > 0)) return null;
  if (minutes == null || isNaN(Number(minutes))) return null;
  var used = Number(minutes) / 60;
  var ratio = used / b;
  var state = ratio >= OPS_BUDGET_OVER ? "over" : ratio >= OPS_BUDGET_WARN ? "near" : "ok";
  return { used: used, budget: b, ratio: ratio, pct: Math.round(ratio * 100), state: state };
}

// HC rule "budget": any | near (80% or more, includes over) | over.
function OPS_budgetMatches(rule, status) {
  if (!rule || rule === "any") return true;
  if (!status) return false;
  if (rule === "over") return status.state === "over";
  if (rule === "near") return status.state === "near" || status.state === "over";
  if (rule === "ok") return status.state === "ok";
  return true;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    OPS_BUDGET_WARN: OPS_BUDGET_WARN, OPS_BUDGET_OVER: OPS_BUDGET_OVER,
    OPS_budgetStatus: OPS_budgetStatus, OPS_budgetMatches: OPS_budgetMatches,
  };
}
