// Shared vectors for the Slate Repeat menu. Hand-worked from a 2026-2028
// calendar (2026-10-26 is a Monday), not copied from either implementation.
// Used by TK_repeatLogic.test.js (JS) and, through its --sql flag, by
// supabase/repeat-menu-tests.sql (SQL). HOLIDAYS must be firm_closed rows in
// tk_holidays; the SQL run reads the live table, which has all of them.

var HOLIDAYS = ["2026-09-07", "2026-11-26", "2026-11-27", "2026-12-24", "2026-12-25", "2027-01-01", "2027-01-18"];

function R(o) {
  return Object.assign({ v: 1, interval: 1, skip: false, end: { type: "never" } }, o);
}

// next(rule, base, today) -> expected date or null
var NEXT = [
  { id: "daily", rule: R({ freq: "daily" }), base: "2026-10-26", today: "2026-10-26", expected: "2026-10-27" },
  { id: "daily every 3", rule: R({ freq: "daily", interval: 3 }), base: "2026-10-26", today: "2026-10-26", expected: "2026-10-29" },
  { id: "daily skip weekend", rule: R({ freq: "daily", skip: true }), base: "2026-10-30", today: "2026-10-30", expected: "2026-11-02" },
  { id: "daily skip Thanksgiving", rule: R({ freq: "daily", skip: true }), base: "2026-11-25", today: "2026-11-25", expected: "2026-11-30" },
  { id: "daily overdue catches up", rule: R({ freq: "daily" }), base: "2026-10-01", today: "2026-10-26", expected: "2026-10-26" },
  { id: "daily skip, today Saturday", rule: R({ freq: "daily", skip: true }), base: "2026-10-01", today: "2026-10-24", expected: "2026-10-26" },
  { id: "weekly default day", rule: R({ freq: "weekly" }), base: "2026-10-26", today: "2026-10-26", expected: "2026-11-02" },
  { id: "weekly Mon Wed Fri, from Mon", rule: R({ freq: "weekly", dows: [1, 3, 5] }), base: "2026-10-26", today: "2026-10-26", expected: "2026-10-28" },
  { id: "weekly Mon Wed Fri, from Fri", rule: R({ freq: "weekly", dows: [1, 3, 5] }), base: "2026-10-30", today: "2026-10-30", expected: "2026-11-02" },
  { id: "weekly every 2, Tue Thu, from Tue", rule: R({ freq: "weekly", interval: 2, dows: [2, 4] }), base: "2026-10-27", today: "2026-10-27", expected: "2026-10-29" },
  { id: "weekly every 2, Tue Thu, from Thu", rule: R({ freq: "weekly", interval: 2, dows: [2, 4] }), base: "2026-10-29", today: "2026-10-29", expected: "2026-11-10" },
  { id: "weekly every 2, default day", rule: R({ freq: "weekly", interval: 2 }), base: "2026-10-26", today: "2026-10-26", expected: "2026-11-09" },
  { id: "weekly Saturday skip", rule: R({ freq: "weekly", dows: [6], skip: true }), base: "2026-10-31", today: "2026-10-31", expected: "2026-11-09" },
  { id: "weekly Mon and Sat, skip", rule: R({ freq: "weekly", dows: [1, 6], skip: true }), base: "2026-10-26", today: "2026-10-26", expected: "2026-11-02" },
  { id: "weekly across the new year", rule: R({ freq: "weekly" }), base: "2026-12-30", today: "2026-12-30", expected: "2027-01-06" },
  { id: "monthly 31st into Feb", rule: R({ freq: "monthly", by: "dom", day: 31 }), base: "2026-01-31", today: "2026-01-31", expected: "2026-02-28" },
  { id: "monthly 31st into leap Feb", rule: R({ freq: "monthly", by: "dom", day: 31 }), base: "2028-01-31", today: "2028-01-31", expected: "2028-02-29" },
  { id: "monthly 30th from Feb 28", rule: R({ freq: "monthly", by: "dom", day: 30 }), base: "2026-02-28", today: "2026-02-28", expected: "2026-03-30" },
  { id: "monthly 29th into non-leap Feb", rule: R({ freq: "monthly", by: "dom", day: 29 }), base: "2027-01-29", today: "2027-01-29", expected: "2027-02-28" },
  { id: "monthly 31st across the new year", rule: R({ freq: "monthly", by: "dom", day: 31 }), base: "2026-12-31", today: "2026-12-31", expected: "2027-01-31" },
  { id: "quarterly on the 15th", rule: R({ freq: "monthly", interval: 3, by: "dom", day: 15 }), base: "2026-11-15", today: "2026-11-15", expected: "2027-02-15" },
  { id: "monthly 2nd Tuesday", rule: R({ freq: "monthly", by: "nth", n: 2, dow: 2 }), base: "2026-10-13", today: "2026-10-13", expected: "2026-11-10" },
  { id: "monthly last Friday", rule: R({ freq: "monthly", by: "nth", n: -1, dow: 5 }), base: "2026-10-30", today: "2026-10-30", expected: "2026-11-27" },
  { id: "monthly 4th Thursday skips Thanksgiving", rule: R({ freq: "monthly", by: "nth", n: 4, dow: 4, skip: true }), base: "2026-10-22", today: "2026-10-22", expected: "2026-11-30" },
  { id: "monthly last day, Jan to Feb", rule: R({ freq: "monthly", by: "last" }), base: "2026-01-31", today: "2026-01-31", expected: "2026-02-28" },
  { id: "monthly last day, leap Feb to Mar", rule: R({ freq: "monthly", by: "last" }), base: "2028-02-29", today: "2028-02-29", expected: "2028-03-31" },
  { id: "monthly last day, Apr to May", rule: R({ freq: "monthly", by: "last" }), base: "2026-04-30", today: "2026-04-30", expected: "2026-05-31" },
  { id: "monthly last day skip, Saturday Oct 31", rule: R({ freq: "monthly", by: "last", skip: true }), base: "2026-10-31", today: "2026-10-31", expected: "2026-11-30" },
  { id: "monthly last day skip, Nov to Dec", rule: R({ freq: "monthly", by: "last", skip: true }), base: "2026-11-30", today: "2026-11-30", expected: "2026-12-31" },
  { id: "monthly overdue catches up", rule: R({ freq: "monthly", by: "dom", day: 15 }), base: "2026-05-15", today: "2026-10-26", expected: "2026-11-15" },
  { id: "yearly Feb 29 into Feb 28", rule: R({ freq: "yearly", by: "dom", day: 29 }), base: "2028-02-29", today: "2028-02-29", expected: "2029-02-28" },
  { id: "yearly Feb 28 holds the 29th rule", rule: R({ freq: "yearly", by: "dom", day: 29 }), base: "2029-02-28", today: "2029-02-28", expected: "2030-02-28" },
  { id: "every 2 years", rule: R({ freq: "yearly", interval: 2, by: "dom", day: 15 }), base: "2026-03-15", today: "2026-03-15", expected: "2028-03-15" },
  { id: "ends on a date, one more", rule: R({ freq: "daily", end: { type: "on", date: "2026-10-27" } }), base: "2026-10-26", today: "2026-10-26", expected: "2026-10-27" },
  { id: "ends on a date, finished", rule: R({ freq: "daily", end: { type: "on", date: "2026-10-27" } }), base: "2026-10-27", today: "2026-10-27", expected: null },
  { id: "ends on a date, skip pushes past it", rule: R({ freq: "daily", skip: true, end: { type: "on", date: "2026-10-31" } }), base: "2026-10-30", today: "2026-10-30", expected: null },
  { id: "bad interval", rule: R({ freq: "daily", interval: 0 }), base: "2026-10-26", today: "2026-10-26", expected: null },
  { id: "bad frequency", rule: R({ freq: "hourly" }), base: "2026-10-26", today: "2026-10-26", expected: null },
];

// series(rule, start, to, max) -> expected dates
var SERIES = [
  { id: "weekly Mon Wed", rule: R({ freq: "weekly", dows: [1, 3] }), start: "2026-10-26", to: "2026-11-09", expected: ["2026-10-26", "2026-10-28", "2026-11-02", "2026-11-04", "2026-11-09"] },
  { id: "monthly 31st, five times", rule: R({ freq: "monthly", by: "dom", day: 31, end: { type: "count", n: 5 } }), start: "2026-01-31", to: "2027-12-31", expected: ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"] },
  { id: "every other day, skip, no duplicates", rule: R({ freq: "daily", interval: 2, skip: true }), start: "2026-10-30", to: "2026-11-10", expected: ["2026-10-30", "2026-11-02", "2026-11-03", "2026-11-05", "2026-11-09"] },
  { id: "weekly, three times", rule: R({ freq: "weekly", end: { type: "count", n: 3 } }), start: "2026-10-26", to: "2027-12-31", expected: ["2026-10-26", "2026-11-02", "2026-11-09"] },
  { id: "last day until a date", rule: R({ freq: "monthly", by: "last", end: { type: "on", date: "2027-01-31" } }), start: "2026-10-31", to: "2028-12-31", expected: ["2026-10-31", "2026-11-30", "2026-12-31", "2027-01-31"] },
  { id: "quarterly", rule: R({ freq: "monthly", interval: 3, by: "dom", day: 15 }), start: "2026-11-15", to: "2027-12-31", expected: ["2026-11-15", "2027-02-15", "2027-05-15", "2027-08-15", "2027-11-15"] },
  { id: "25th, skip, Christmas", rule: R({ freq: "monthly", by: "dom", day: 25, skip: true }), start: "2026-12-25", to: "2027-02-28", expected: ["2026-12-28", "2027-01-25", "2027-02-25"] },
  { id: "yearly Feb 29", rule: R({ freq: "yearly", by: "dom", day: 29 }), start: "2028-02-29", to: "2032-12-31", expected: ["2028-02-29", "2029-02-28", "2030-02-28", "2031-02-28", "2032-02-29"] },
  { id: "daily skip, count 4", rule: R({ freq: "daily", skip: true, end: { type: "count", n: 4 } }), start: "2026-10-30", to: "2027-01-01", expected: ["2026-10-30", "2026-11-02", "2026-11-03", "2026-11-04"] },
  { id: "start before the pattern", rule: R({ freq: "weekly", dows: [3] }), start: "2026-10-26", to: "2026-11-12", expected: ["2026-10-28", "2026-11-04", "2026-11-11"] },
];

// dueAt(date, time, tz) -> ISO instant. Spring-forward / fall-back included.
var DUE_AT = [
  { id: "Chicago, day before DST starts", date: "2026-03-07", time: "09:00", tz: "America/Chicago", expected: "2026-03-07T15:00:00.000Z" },
  { id: "Chicago, DST starts", date: "2026-03-08", time: "09:00", tz: "America/Chicago", expected: "2026-03-08T14:00:00.000Z" },
  { id: "Chicago, day before DST ends", date: "2026-10-31", time: "09:00", tz: "America/Chicago", expected: "2026-10-31T14:00:00.000Z" },
  { id: "Chicago, DST ends", date: "2026-11-01", time: "09:00", tz: "America/Chicago", expected: "2026-11-01T15:00:00.000Z" },
  { id: "Chicago, time that does not exist", date: "2026-03-08", time: "02:30", tz: "America/Chicago", expected: "2026-03-08T08:30:00.000Z" },
  { id: "Chicago, time that happens twice", date: "2026-11-01", time: "01:30", tz: "America/Chicago", expected: "2026-11-01T07:30:00.000Z" },
  { id: "New York, DST starts", date: "2026-03-08", time: "09:00", tz: "America/New_York", expected: "2026-03-08T13:00:00.000Z" },
  { id: "New York, day before", date: "2026-03-07", time: "09:00", tz: "America/New_York", expected: "2026-03-07T14:00:00.000Z" },
  { id: "late evening lands on the next UTC day", date: "2026-10-26", time: "23:30", tz: "America/Chicago", expected: "2026-10-27T04:30:00.000Z" },
];

// text(rule, start) -> the sentence the menu shows
var TEXT = [
  { rule: R({ freq: "daily" }), start: "2026-10-26", expected: "Every day" },
  { rule: R({ freq: "daily", interval: 3, skip: true }), start: "2026-10-26", expected: "Every 3 days, skipping weekends and firm holidays" },
  { rule: R({ freq: "weekly" }), start: "2026-10-26", expected: "Every week on Mon" },
  { rule: R({ freq: "weekly", dows: [1, 2, 3, 4, 5] }), start: "2026-10-26", expected: "Every week on weekdays" },
  { rule: R({ freq: "weekly", interval: 2, dows: [1, 4] }), start: "2026-10-26", expected: "Every 2 weeks on Mon and Thu" },
  { rule: R({ freq: "monthly", by: "dom", day: 15 }), start: "2026-10-26", expected: "Every month on the 15th" },
  { rule: R({ freq: "monthly", interval: 3, by: "dom", day: 1 }), start: "2026-10-26", expected: "Every quarter on the 1st" },
  { rule: R({ freq: "monthly", by: "nth", n: 2, dow: 2 }), start: "2026-10-26", expected: "Every month on the 2nd Tuesday" },
  { rule: R({ freq: "monthly", by: "nth", n: -1, dow: 5 }), start: "2026-10-26", expected: "Every month on the last Friday" },
  { rule: R({ freq: "monthly", by: "last" }), start: "2026-10-26", expected: "Every month on the last day" },
  { rule: R({ freq: "yearly", by: "dom", day: 3 }), start: "2026-03-03", expected: "Every year on the 3rd in Mar" },
  { rule: R({ freq: "daily", time: "09:30", end: { type: "on", date: "2026-12-31" } }), start: "2026-10-26", expected: "Every day, at 9:30 AM, until Dec 31, 2026" },
  { rule: R({ freq: "daily", end: { type: "count", n: 5 } }), start: "2026-10-26", expected: "Every day, for 5 times" },
  { rule: R({ freq: "daily", end: { type: "count", n: 1 } }), start: "2026-10-26", expected: "Every day, for 1 time" },
  { rule: null, start: "2026-10-26", expected: "Doesn't repeat" },
];

module.exports = { HOLIDAYS: HOLIDAYS, NEXT: NEXT, SERIES: SERIES, DUE_AT: DUE_AT, TEXT: TEXT };
