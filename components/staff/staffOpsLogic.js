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

// ---- Reply times (supabase/client-reply-times.sql)
// The goal is a constant in calendar hours (nights and weekends count). The
// RPC has its own copy (v_goal); change both together.
var OPS_REPLY_GOAL_HOURS = 24;

// "45 min", "3.2 h", "2.1 days". null/blank => "—".
function OPS_fmtWait(hours) {
  if (hours == null || hours === "" || isNaN(Number(hours))) return "\u2014";
  var h = Math.max(0, Number(hours));
  if (h < 1) return Math.max(1, Math.round(h * 60)) + " min";
  if (h < 48) {
    var r = Math.round(h * 10) / 10;
    return (r % 1 === 0 ? String(r) : r.toFixed(1)) + " h";
  }
  var d = Math.round((h / 24) * 10) / 10;
  return (d % 1 === 0 ? String(d) : d.toFixed(1)) + " days";
}

function OPS_isoDay(dt) {
  var m = dt.getMonth() + 1, d = dt.getDate();
  return dt.getFullYear() + "-" + (m < 10 ? "0" : "") + m + "-" + (d < 10 ? "0" : "") + d;
}

// Reporting periods for the Reply times tab. today = "YYYY-MM-DD".
// "month" = 1st of this month..today, "last-month" = last calendar month,
// "90" = the 90 days ending today.
function OPS_replyPeriod(key, today) {
  var p = String(today).split("-").map(Number);
  var t = new Date(p[0], p[1] - 1, p[2]);
  if (key === "last-month") {
    return { from: OPS_isoDay(new Date(p[0], p[1] - 2, 1)), to: OPS_isoDay(new Date(p[0], p[1] - 1, 0)) };
  }
  if (key === "90") {
    return { from: OPS_isoDay(new Date(p[0], p[1] - 1, p[2] - 89)), to: OPS_isoDay(t) };
  }
  return { from: OPS_isoDay(new Date(p[0], p[1] - 1, 1)), to: OPS_isoDay(t) };
}

// ---- Time off and coverage (supabase/staff-time-off.sql)
// rows: staff_time_off rows {staff_email, starts_on, ends_on, cancelled_at}.
// Dates are "YYYY-MM-DD" strings, so plain string compares order them.
function OPS_addDays(day, n) {
  var p = String(day).split("-").map(Number);
  return OPS_isoDay(new Date(p[0], p[1] - 1, p[2] + n));
}

// The last day someone is out, if they're out on `today`. Back-to-back or
// overlapping entries chain (out Mon-Fri plus the next Mon-Tue => Tue).
// Not out today => null.
function OPS_outUntil(rows, email, today) {
  var me = String(email || "").toLowerCase();
  if (!me) return null;
  var mine = (rows || []).filter(function (r) {
    return !r.cancelled_at && String(r.staff_email || "").toLowerCase() === me;
  });
  var cur = null;
  mine.forEach(function (r) {
    if (r.starts_on <= today && r.ends_on >= today && (!cur || r.ends_on > cur)) cur = r.ends_on;
  });
  if (!cur) return null;
  var grew = true;
  while (grew) {
    grew = false;
    for (var i = 0; i < mine.length; i++) {
      var r = mine[i];
      if (r.starts_on <= OPS_addDays(cur, 1) && r.ends_on > cur) {
        cur = r.ends_on;
        grew = true;
      }
    }
  }
  return cur;
}

// Entries still to come or under way (not cancelled, not over), soonest first.
function OPS_upcomingTimeOff(rows, today, email) {
  var me = email ? String(email).toLowerCase() : null;
  return (rows || [])
    .filter(function (r) {
      return !r.cancelled_at && r.ends_on >= today && (!me || String(r.staff_email || "").toLowerCase() === me);
    })
    .slice()
    .sort(function (a, b) {
      return a.starts_on < b.starts_on ? -1 : a.starts_on > b.starts_on ? 1 : 0;
    });
}

// Problems with a time-off entry before saving, or null when it's fine.
function OPS_timeOffError(startsOn, endsOn, today) {
  if (!startsOn || !endsOn) return "Pick the first and last day.";
  if (endsOn < startsOn) return "The last day can't be before the first day.";
  if (endsOn < today) return "That's already over. Pick dates from today on.";
  var p1 = String(startsOn).split("-").map(Number), p2 = String(endsOn).split("-").map(Number);
  var days = Math.round((new Date(p2[0], p2[1] - 1, p2[2]) - new Date(p1[0], p1[1] - 1, p1[2])) / 864e5);
  if (days > 366) return "Keep it to a year or less.";
  return null;
}

// Coverage tab wording for coverage_overview's backup_access.
var OPS_BACKUP_ACCESS = {
  none_set: { label: "No backup set", tone: "bad" },
  not_staff: { label: "Backup isn't active staff", tone: "bad" },
  admin: { label: "Has access (admin)", tone: "good" },
  assigned: { label: "Has access (assigned)", tone: "good" },
  temporary: { label: "Temporary access", tone: "good" },
  none: { label: "No access", tone: "bad" },
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    OPS_BUDGET_WARN: OPS_BUDGET_WARN, OPS_BUDGET_OVER: OPS_BUDGET_OVER,
    OPS_budgetStatus: OPS_budgetStatus, OPS_budgetMatches: OPS_budgetMatches,
    OPS_REPLY_GOAL_HOURS: OPS_REPLY_GOAL_HOURS, OPS_fmtWait: OPS_fmtWait, OPS_replyPeriod: OPS_replyPeriod,
    OPS_addDays: OPS_addDays, OPS_outUntil: OPS_outUntil, OPS_upcomingTimeOff: OPS_upcomingTimeOff,
    OPS_timeOffError: OPS_timeOffError, OPS_BACKUP_ACCESS: OPS_BACKUP_ACCESS,
  };
}
