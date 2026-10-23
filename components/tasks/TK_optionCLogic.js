// Month rhythm S7: Option C, the non-monthly work (Quarterly, Annual,
// Occasional), pre-filled by client type. Plain functions: browser globals and
// node exports.
//
// - A client's type comes from clients.org_type / entity_type:
//   Church -> church; nonprofit -> nonprofit; else for_profit. The firm's own
//   row (org_type "Bookkeeping Firm") and test clients are never included.
// - "Pre-fill" makes DRAFT templates only (tk_save_template always saves a new
//   one as a draft), so nothing generates until an admin activates one.
// - Filings (990, 1099, W-2, 941, 940, 1096) are never suggested: they keep
//   their one hard date on Work > Deadlines (firm_deadline_rules), so a filing
//   never has two due dates.
// - Occasional items have no schedule, so they are listed as ideas, not made.
// - TK_optionCSectionOf files a template task with no section under Quarterly
//   or Annual on a client's list (display only; with the rhythm on).

var TK_OPTION_C_TYPES = [
  { key: "church", label: "Churches" },
  { key: "nonprofit", label: "Other nonprofits" },
  { key: "for_profit", label: "For-profit businesses" },
];

// days: days after the period ends (rule type "offset"), lead: days before due.
var TK_OPTION_C_SUGGESTIONS = {
  church: [
    { title: "Quarterly giving statements", cadence: "quarterly", days: 20, lead: 10,
      description: "Send each giver a statement of their contributions for the quarter, if the church does quarterly statements." },
    { title: "Quarterly finance committee report", cadence: "quarterly", days: 25, lead: 10,
      description: "Budget vs actual and balance sheet for the quarter, with a short note on anything unusual." },
    { title: "Year-end contribution statements", cadence: "annually", days: 25, lead: 21,
      description: "Annual giving statements to every giver (they need them by January 31)." },
    { title: "Year-end close and adjusting entries", cadence: "annually", days: 45, lead: 21,
      description: "Final reconciliations, accruals and adjusting entries; lock the year once done." },
    { title: "Clergy housing allowance and next year's budget", cadence: "annually", days: -20, lead: 30,
      description: "Remind the church to approve next year's housing allowance and budget before the year starts." },
  ],
  nonprofit: [
    { title: "Quarterly restricted funds and grant spending review", cadence: "quarterly", days: 20, lead: 10,
      description: "Check restricted balances and grant spending against each award; flag anything close to its limit." },
    { title: "Quarterly board financial report", cadence: "quarterly", days: 25, lead: 10,
      description: "Budget vs actual and balance sheet for the quarter for the board." },
    { title: "Year-end close and adjusting entries", cadence: "annually", days: 45, lead: 21,
      description: "Final reconciliations, accruals and adjusting entries; lock the year once done." },
    { title: "Year-end package for the tax preparer", cadence: "annually", days: 60, lead: 21,
      description: "Trial balance, restricted fund detail and grant schedules for whoever prepares the return (the filing itself is on Deadlines)." },
  ],
  for_profit: [
    { title: "Quarterly review with the owner", cadence: "quarterly", days: 20, lead: 10,
      description: "P&L, balance sheet and AR/AP aging for the quarter; numbers the owner needs for estimated taxes." },
    { title: "Collect W-9s from new vendors", cadence: "quarterly", days: 15, lead: 10,
      description: "Ask for a W-9 from any vendor paid this quarter that we do not have one for (1099 filing itself is on Deadlines)." },
    { title: "Year-end close and adjusting entries", cadence: "annually", days: 45, lead: 21,
      description: "Final reconciliations, accruals, fixed assets and adjusting entries; lock the year once done." },
    { title: "Year-end package for the CPA", cadence: "annually", days: 60, lead: 21,
      description: "Trial balance, fixed asset list and loan statements for the CPA (the return is the CPA's)." },
  ],
};

var TK_OPTION_C_OCCASIONAL = {
  church: ["New pastor or treasurer: update contacts and bank signers", "Building fund or capital campaign set up"],
  nonprofit: ["New grant awarded: set up its class or fund", "Board officer change: update contacts and bank signers"],
  for_profit: ["New loan or vehicle: set up the liability and asset", "New hire: confirm payroll setup"],
};

function TK_optionCTypeOf(client) {
  var c = client || {};
  var org = String(c.org_type || "").toLowerCase();
  if (org === "church") return "church";
  if (String(c.entity_type || "").toLowerCase() === "nonprofit") return "nonprofit";
  return "for_profit";
}

// Real clients only: not test, not internal, not the firm's own row.
function TK_optionCEligible(client) {
  var c = client || {};
  if (c.id == null || c.test_only || c.is_internal) return false;
  return String(c.org_type || "").toLowerCase() !== "bookkeeping firm";
}

function TK_optionCClientsOf(type, clients) {
  return (Array.isArray(clients) ? clients : [])
    .filter(function (c) { return TK_optionCEligible(c) && TK_optionCTypeOf(c) === type; })
    .map(function (c) { return String(c.id); })
    .sort();
}

function TK__ocNorm(s) {
  return String(s || "").trim().replace(/\s+/g, " ").toLowerCase();
}

// What pre-fill would make for one type: each suggestion with exists=true when
// a template (any status, not retired) already has the same title.
function TK_optionCPlan(type, clients, templates) {
  var have = {};
  (Array.isArray(templates) ? templates : []).forEach(function (t) {
    if (t && t.status !== "retired") have[TK__ocNorm(t.title)] = true;
  });
  var ids = TK_optionCClientsOf(type, clients);
  var items = (TK_OPTION_C_SUGGESTIONS[type] || []).map(function (s) {
    return { title: s.title, cadence: s.cadence, days: s.days, description: s.description, exists: !!have[TK__ocNorm(s.title)] };
  });
  return { type: type, clientIds: ids, items: items, occasional: (TK_OPTION_C_OCCASIONAL[type] || []).slice() };
}

// The tk_save_template payload for one suggestion (same keys as TK_tplToPayload).
function TK_optionCPayload(type, title, clientIds) {
  var s = (TK_OPTION_C_SUGGESTIONS[type] || []).filter(function (x) { return x.title === title; })[0];
  if (!s) return null;
  return {
    title: s.title,
    cadence: s.cadence,
    due_rule: { type: "offset", days: s.days },
    due_offset_days: s.days,
    lead_days: s.lead,
    plan_tiers: [],
    client_ids: (clientIds || []).slice(),
    priority: "normal",
    checklist: [],
    assignee_role: "bookkeeper",
    assignee_email: "",
    leave_unassigned: false,
    review_required: false,
    sop_section: "",
    estimate_minutes: "",
    period_basis: "calendar",
    description: s.description,
  };
}

// Display only: a template task with no section goes under Quarterly or Annual.
function TK_optionCSectionOf(task) {
  var t = task || {};
  if (t.section != null && String(t.section).trim()) return null;
  if (t.source !== "template") return null;
  if (t.period_kind === "quarter") return "Quarterly";
  if (t.period_kind === "year" || t.period_kind === "calendar_year") return "Annual";
  return null;
}

// The same array back when nothing changes; else copies with a section set.
function TK_optionCApplySections(tasks) {
  var list = Array.isArray(tasks) ? tasks : [];
  var changed = false;
  var out = list.map(function (t) {
    var s = TK_optionCSectionOf(t);
    if (!s) return t;
    changed = true;
    return Object.assign({}, t, { section: s });
  });
  return changed ? out : list;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    TK_OPTION_C_TYPES: TK_OPTION_C_TYPES,
    TK_OPTION_C_SUGGESTIONS: TK_OPTION_C_SUGGESTIONS,
    TK_OPTION_C_OCCASIONAL: TK_OPTION_C_OCCASIONAL,
    TK_optionCTypeOf: TK_optionCTypeOf,
    TK_optionCEligible: TK_optionCEligible,
    TK_optionCClientsOf: TK_optionCClientsOf,
    TK_optionCPlan: TK_optionCPlan,
    TK_optionCPayload: TK_optionCPayload,
    TK_optionCSectionOf: TK_optionCSectionOf,
    TK_optionCApplySections: TK_optionCApplySections,
  };
}
