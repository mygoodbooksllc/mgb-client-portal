// Staff birthdays: month and day only (owner request 2026-10-27). Pure rules
// shared by Settings › Profile, HR › Members and the node test
// (birthdayLogic.test.js). No React, no DOM, no Supabase.
//
// staff_profiles.birthday is a Postgres `date`, so it still needs a year. We
// never ask for one. A birthday saved from the app uses BDAY_PLACEHOLDER_YEAR,
// a leap year so 29 Feb is storable; it is not anyone's birth year, and no age
// is ever shown or computed. Rows saved earlier may hold a real year: it is
// left alone (never shown, never used) unless the month and day change, and
// every reader goes through BDAY_parse / BDAY_label, which ignore the year.
// celebrations, Today and the weekly digest all work from month + day
// (public.staff_celebrations, supabase/staff-birthday-month-day.sql).

var BDAY_PLACEHOLDER_YEAR = 1904;
var BDAY_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// Longest the month can be. February allows 29 (the placeholder year is a leap year).
function BDAY_daysIn(month) {
  var m = Number(month);
  if (m === 2) return 29;
  if (m === 4 || m === 6 || m === 9 || m === 11) return 30;
  return m >= 1 && m <= 12 ? 31 : 0;
}

function BDAY_pad(n) {
  return (n < 10 ? "0" : "") + n;
}

// "1992-04-02" (or the placeholder year) -> { month: 4, day: 2 }; anything
// else (empty, malformed, impossible month/day) -> null. The year is ignored.
function BDAY_parse(value) {
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value == null ? "" : value));
  if (!m) return null;
  var month = Number(m[2]);
  var day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > BDAY_daysIn(month)) return null;
  return { month: month, day: day };
}

// Is this year a leap year? (Used only to keep a stored real year valid.)
function BDAY_isLeap(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

// Month + day -> the date string to store. `existing` is the value already on
// the row: its year is kept when the new month/day is valid in it, so saving
// never discards data; otherwise the placeholder year is used. Returns null
// for an incomplete or impossible month/day.
function BDAY_build(month, day, existing) {
  var mo = Number(month);
  var d = Number(day);
  if (!Number.isInteger(mo) || !Number.isInteger(d) || mo < 1 || mo > 12 || d < 1 || d > BDAY_daysIn(mo)) return null;
  var year = BDAY_PLACEHOLDER_YEAR;
  var em = /^(\d{4})-/.exec(String(existing == null ? "" : existing));
  if (em) {
    var y = Number(em[1]);
    var feb29 = mo === 2 && d === 29;
    if (y >= 1900 && (!feb29 || BDAY_isLeap(y))) year = y;
  }
  return String(year) + "-" + BDAY_pad(mo) + "-" + BDAY_pad(d);
}

// "Apr 2": month and day, never the year.
function BDAY_label(value) {
  var p = BDAY_parse(value);
  return p ? BDAY_MONTHS[p.month - 1].slice(0, 3) + " " + p.day : "";
}

// "April 2" for sentences and labels.
function BDAY_longLabel(value) {
  var p = BDAY_parse(value);
  return p ? BDAY_MONTHS[p.month - 1] + " " + p.day : "";
}

// Same birthday (month and day), whatever the year.
function BDAY_sameDay(a, b) {
  var x = BDAY_parse(a);
  var y = BDAY_parse(b);
  return !!x && !!y && x.month === y.month && x.day === y.day;
}

// Month/day typed in a profile form -> { value, error }. Both empty is a clear.
function BDAY_fromForm(month, day, existing) {
  var mo = month === "" || month == null ? "" : Number(month);
  var d = day === "" || day == null ? "" : Number(day);
  if (mo === "" && d === "") return { value: null, error: "" };
  if (mo === "" || d === "") return { value: undefined, error: "Pick both a month and a day." };
  var v = BDAY_build(mo, d, existing);
  return v ? { value: v, error: "" } : { value: undefined, error: "That month doesn't have that day." };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    BDAY_PLACEHOLDER_YEAR: BDAY_PLACEHOLDER_YEAR, BDAY_MONTHS: BDAY_MONTHS, BDAY_daysIn: BDAY_daysIn,
    BDAY_parse: BDAY_parse, BDAY_build: BDAY_build, BDAY_label: BDAY_label, BDAY_longLabel: BDAY_longLabel,
    BDAY_sameDay: BDAY_sameDay, BDAY_fromForm: BDAY_fromForm,
  };
}
