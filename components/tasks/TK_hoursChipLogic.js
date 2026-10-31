// ----------------------------------------------------------------------------
// TK_hoursChipLogic: pure rules for the Slate plus hours-vs-budget chip
// (hidden preview, docs/slateplus-hours-chip-spec.md). The view is
// TK_HoursChip.jsx. It reuses HB_useBudgets (components/staff/HoursBudget.jsx)
// and its thresholds (OPS_budgetStatus: amber from 80%, red from 100%); this
// file only turns that data into chip text. Browser file, shared global scope:
// every name carries a TKH_ prefix. Node tests: TK_hoursChipLogic.test.js.
// ----------------------------------------------------------------------------

// Same answer as TK_api's meIsAdmin: the signed-in person's role in the staff
// list is "admin". Anyone else (or unknown) reads hours through the
// bookkeeper RPC, which only returns their own clients.
function TKH_isAdmin(staff, me) {
  var who = String(me || "").toLowerCase();
  var list = Array.isArray(staff) ? staff : [];
  if (!who) return false;
  for (var i = 0; i < list.length; i++) {
    if (list[i] && String(list[i].email || "").toLowerCase() === who) return list[i].role === "admin";
  }
  return false;
}

// "12.5" or "8" (one decimal at most, no trailing .0).
function TKH_fmt(h) {
  var n = Math.round(Number(h || 0) * 10) / 10;
  return n % 1 === 0 ? String(n) : n.toFixed(1);
}

// data: HB_useBudgets result ({ budgets, byClient } or null). Returns null
// (show nothing) when data is still loading, the client has no budget, or the
// hours are unknown (QuickBooks Time not connected, client not visible to the
// caller). Otherwise { state: ok|near|over, text, title, pct }.
function TKH_chip(data, clientId) {
  if (!data || !data.budgets || clientId == null || clientId === "") return null;
  var id = String(clientId);
  var budget = data.budgets[id];
  if (budget == null || !(Number(budget) > 0)) return null;
  var st = data.byClient ? data.byClient[id] : null;
  if (!st) return null;
  var text = TKH_fmt(st.used) + " / " + TKH_fmt(st.budget) + " h";
  var tail = st.state === "over" ? " Over budget." : st.state === "near" ? " 80% or more of the budget." : "";
  return {
    state: st.state,
    text: text,
    pct: st.pct,
    title: "Hours this month: " + text + " (" + st.pct + "%)." + tail,
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { TKH_isAdmin: TKH_isAdmin, TKH_fmt: TKH_fmt, TKH_chip: TKH_chip };
}
