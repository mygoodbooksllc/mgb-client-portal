// Admin lead time for STAFF celebrations (owner request 2026-10-27): admins
// see birthdays and work anniversaries a month (30 days) ahead, so there is
// time to prepare and send a gift. Pure rules shared by Today, Team › People
// and the node test (celebrationLead.test.js). No React, no DOM, no Supabase.
//
// Rows are what the staff_celebrations() RPC returns. Nothing here reads or
// shows a birth year or an age: dates are the NEXT occurrence ("May 27"), and
// "3 years on the team" is time since the start date, never the person's age.
// Only admins get the month-ahead list: callers pass the rows only when the
// signed-in person is an admin. Everyone else keeps what they had.

var CEL_ADMIN_LEAD_DAYS = 30;
// Today keeps its original "this week" behavior for the first 7 days (ranked
// at the top, Do next can use it); days 8-30 are the month-ahead rows.
var CEL_NEAR_DAYS = 7;
var CEL_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function CEL_parse(iso) {
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso == null ? "" : iso));
  return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null;
}

// Whole days from `fromIso` to `toIso` (UTC math, so DST never shifts it).
function CEL_daysBetween(toIso, fromIso) {
  var a = CEL_parse(toIso);
  var b = CEL_parse(fromIso);
  if (!a || !b) return NaN;
  return Math.round((Date.UTC(a.y, a.m - 1, a.d) - Date.UTC(b.y, b.m - 1, b.d)) / 86400000);
}

// "2027-05-27" -> "May 27". Month and day, never a year.
function CEL_dateLabel(iso) {
  var p = CEL_parse(iso);
  return p && p.m >= 1 && p.m <= 12 ? CEL_MONTHS[p.m - 1] + " " + p.d : "";
}

// 0 -> "today", 1 -> "tomorrow", 30 -> "in 30 days".
function CEL_awayText(days) {
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return "in " + days + " days";
}

// Whole years from the start date to `onIso` (the day being celebrated).
// Null when there is no start date or it is not yet a full year.
function CEL_tenureYears(startIso, onIso) {
  var s = CEL_parse(startIso);
  var o = CEL_parse(onIso);
  if (!s || !o) return null;
  var n = o.y - s.y - (o.m < s.m || (o.m === s.m && o.d < s.d) ? 1 : 0);
  return n >= 1 ? n : null;
}

function CEL_tenureText(n) {
  return n ? n + " year" + (n === 1 ? "" : "s") + " on the team" : "";
}

// Birthdays and work anniversaries for admins, nearest first. `rows` are
// staff_celebrations() rows; an occurrence already marked "gift sent" or
// dismissed (birthday_action / anniversary_action) is left out. `leadDays`
// defaults to a month. Each item:
//   { key, kind, email, name, on, days, near, handled, what, away, tenure,
//     title, detail, row }
// where `on` is the next occurrence (ISO), `days` how far away, `near` true
// within the first 7 days, `title` e.g. "Debra Ruffin's birthday, May 27" and
// `detail` e.g. "in 30 days · 3 years on the team · send a gift or a shout-out".
// `includeHandled` keeps occurrences already marked (Team › People shows them
// with a "gift sent" / "dismissed" tag); Today and the digest leave them out.
function CEL_items(rows, today, leadDays, includeHandled) {
  var lead = leadDays == null ? CEL_ADMIN_LEAD_DAYS : leadDays;
  var out = [];
  (Array.isArray(rows) ? rows : []).forEach(function (r) {
    if (!r) return;
    var name = r.name || r.email || "";
    function add(kind, on, action, title, what, tenure, parts) {
      if (!on || (action && !includeHandled)) return;
      var d = CEL_daysBetween(on, today);
      if (!(d >= 0 && d <= lead)) return;
      out.push({
        key: "cel-" + kind + "-" + r.email,
        kind: kind,
        email: r.email,
        name: name,
        on: on,
        days: d,
        near: d <= CEL_NEAR_DAYS,
        handled: action || null,
        what: what,
        away: CEL_awayText(d),
        tenure: tenure,
        title: title,
        detail: [CEL_awayText(d), tenure].concat(parts).filter(Boolean).join(" · "),
        row: r,
      });
    }
    add(
      "birthday",
      r.next_birthday,
      r.birthday_action,
      name + "'s birthday, " + CEL_dateLabel(r.next_birthday),
      "birthday",
      CEL_tenureText(CEL_tenureYears(r.start_date, r.next_birthday)),
      ["send a gift or a shout-out"],
    );
    var yrs = r.years;
    add(
      "anniversary",
      r.next_anniversary,
      r.anniversary_action,
      name + ": " + yrs + " year" + (yrs === 1 ? "" : "s") + " with the firm, " + CEL_dateLabel(r.next_anniversary),
      yrs + " year" + (yrs === 1 ? "" : "s") + " with the firm",
      "",
      ["work anniversary"],
    );
  });
  out.sort(function (a, b) {
    return a.days - b.days || String(a.name).localeCompare(String(b.name));
  });
  return out;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    CEL_ADMIN_LEAD_DAYS: CEL_ADMIN_LEAD_DAYS, CEL_NEAR_DAYS: CEL_NEAR_DAYS, CEL_daysBetween: CEL_daysBetween,
    CEL_dateLabel: CEL_dateLabel, CEL_awayText: CEL_awayText, CEL_tenureYears: CEL_tenureYears,
    CEL_tenureText: CEL_tenureText, CEL_items: CEL_items,
  };
}
