// Team › Hours: pure date and average rules for the interim "stale data" fix
// (2026-10-31). No React, no Supabase. Used by TeamPage.jsx and TeamQbo.jsx,
// tested by teamHoursLogic.test.js.
//
// The portal reads QuickBooks Online TimeActivity, which lags the real time.
// So nothing here may treat days after the last synced day as "zero hours":
// averages use only fully synced calendar months, pace stops at the last
// synced day, and monthly-paid staff get a note instead of a stale 0:00.

// There is no pay-frequency field anywhere in the database, so this small
// explicit list is the source of truth. Add an email here to mark someone as
// paid monthly (their hours post to QuickBooks at month end).
var TH_MONTHLY_PAID_EMAILS = ["gillian@mygoodbooks.org"];

var TH_MONTHLY_NOTE = "Paid monthly, hours post at month end";

function TH_isMonthlyPaid(email) {
  var e = String(email || "").trim().toLowerCase();
  return !!e && TH_MONTHLY_PAID_EMAILS.indexOf(e) !== -1;
}

function TH_ymd(d) {
  return (
    d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0")
  );
}

// Which full calendar months feed the "Avg / mo" figure: up to `want` months
// (default 3) before the month of `today`, each one ending on or before the
// last synced day. A month the sync has not fully reached is left out, so a
// partial month never drags the average down. With no synced day known, the
// months before this one are used as before. Returns { from, to, months }
// where months is the divisor (0 when nothing qualifies).
function TH_avgRange(today, syncedThrough, want) {
  var n = want || 3;
  var t = String(today).split("-").map(Number);
  var y = t[0];
  var m = t[1] - 1;
  var months = [];
  for (var back = 1; back <= 12 && months.length < n; back++) {
    var start = new Date(y, m - back, 1);
    var end = new Date(y, m - back + 1, 0);
    if (syncedThrough && TH_ymd(end) > syncedThrough) continue;
    months.unshift({ start: start, end: end });
  }
  if (!months.length) return { from: null, to: null, months: 0, label: "none yet" };
  var first = months[0].start;
  var last = months[months.length - 1].end;
  var short = function (d) {
    return d.toLocaleDateString("en-US", { month: "short" });
  };
  return {
    from: TH_ymd(first),
    to: TH_ymd(last),
    months: months.length,
    label: months.length === 1 ? short(first) : short(first) + " to " + short(last),
  };
}

// The last `want` (default 4) complete Monday to Sunday weeks that are fully
// synced: each ends on or before yesterday and on or before the last synced
// day, so the current partial week never counts. Returns { from, to, weeks }
// (weeks 0 when none qualify); the average per week divides by `weeks`.
function TH_lastFullWeeks(today, syncedThrough, want) {
  var n = want || 4;
  var t = String(today).split("-").map(Number);
  var monday = new Date(t[0], t[1] - 1, t[2] - ((new Date(t[0], t[1] - 1, t[2]).getDay() + 6) % 7));
  var weeks = [];
  for (var back = 1; back <= 60 && weeks.length < n; back++) {
    var start = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 7 * back);
    var end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
    if (syncedThrough && TH_ymd(end) > syncedThrough) continue;
    weeks.unshift({ start: start, end: end });
  }
  if (!weeks.length) return { from: null, to: null, weeks: 0 };
  return { from: TH_ymd(weeks[0].start), to: TH_ymd(weeks[weeks.length - 1].end), weeks: weeks.length };
}

// The day pace should count up to: today, or the last synced day if that is
// earlier (days after it have no data yet, not zero hours).
function TH_paceDay(today, syncedThrough) {
  if (syncedThrough && syncedThrough < today) return syncedThrough;
  return today;
}

// True when the period reaches past the last synced day.
function TH_periodUnsynced(range, syncedThrough) {
  return !!syncedThrough && !!range && range.to > syncedThrough;
}

// The People table QB-hours note for a monthly-paid person, or null to show
// the normal figure. Shown when they have no hours in the period, or the
// period runs past the last synced day (their month end is not in yet).
function TH_monthlyNote(email, minutes, range, syncedThrough) {
  if (!TH_isMonthlyPaid(email)) return null;
  if (!minutes || TH_periodUnsynced(range, syncedThrough)) return TH_MONTHLY_NOTE;
  return null;
}

// "Hours synced through Oct 28, 2026", or "" when unknown.
function TH_syncedLine(syncedThrough) {
  if (!syncedThrough) return "";
  var p = String(syncedThrough).split("-").map(Number);
  if (p.length !== 3 || p.some(isNaN)) return "";
  var d = new Date(p[0], p[1] - 1, p[2]);
  return (
    "Hours synced through " +
    d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
  );
}

// Clients CSV header (Team › Hours and MGB Home › Profitability). moneyHead is
// the money columns (TeamProfit.jsx TP_PF_CSV_HEAD plus the effective rate),
// passed only inside MGB Home, or on Hours for a grant holder before the
// MGB Home switch (spec OQ6). Hours never export a Billable value column.
function TH_clientsCsvHead(avgLabel, appHead, moneyHead, late) {
  return [
    "Client",
    "Bucket",
    "Plan",
    "QuickBooks hours",
    appHead,
    "In-app hours by staffer",
    "Avg hours / month (" + avgLabel + ")",
    "Billable hours",
  ]
    .concat(moneyHead && moneyHead.length ? moneyHead : [])
    .concat(["Trend", "Open tasks"])
    .concat(late ? ["Overdue tasks"] : []);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    TH_clientsCsvHead: TH_clientsCsvHead,
    TH_MONTHLY_PAID_EMAILS: TH_MONTHLY_PAID_EMAILS,
    TH_MONTHLY_NOTE: TH_MONTHLY_NOTE,
    TH_isMonthlyPaid: TH_isMonthlyPaid,
    TH_avgRange: TH_avgRange,
    TH_lastFullWeeks: TH_lastFullWeeks,
    TH_paceDay: TH_paceDay,
    TH_periodUnsynced: TH_periodUnsynced,
    TH_monthlyNote: TH_monthlyNote,
    TH_syncedLine: TH_syncedLine,
  };
}
