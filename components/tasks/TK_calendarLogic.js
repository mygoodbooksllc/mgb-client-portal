// ----------------------------------------------------------------------------
// TK_calendarLogic: pure date-grid rules for the Slate plus Calendar view
// (hidden preview, month grid; the view is TK_Calendar.jsx). Browser file,
// shared global scope: every name carries a TKC_ prefix. Dates are plain
// YYYY-MM-DD strings (no time zone math). Weeks start on Monday, like the rest
// of Slate. Node test: components/tasks/TK_calendarLogic.test.js.
// ----------------------------------------------------------------------------

var TKC_WEEK_START = 1; // 0 = Sunday, 1 = Monday
var TKC_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
var TKC_DOWS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function TKC_parse(iso) {
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso == null ? "" : iso));
  if (!m) return null;
  var y = +m[1];
  var mo = +m[2];
  var d = +m[3];
  var dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return { y: y, m: mo, d: d };
}

function TKC_pad(n) {
  return (n < 10 ? "0" : "") + n;
}

function TKC_iso(y, m, d) {
  var dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() + "-" + TKC_pad(dt.getUTCMonth() + 1) + "-" + TKC_pad(dt.getUTCDate());
}

function TKC_addDays(iso, n) {
  var p = TKC_parse(iso);
  if (!p) return "";
  return TKC_iso(p.y, p.m, p.d + n);
}

function TKC_dow(iso) {
  var p = TKC_parse(iso);
  return p ? new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay() : -1;
}

// The month a date sits in: { y, m } (m is 1 to 12), or null.
function TKC_monthOf(iso) {
  var p = TKC_parse(iso);
  return p ? { y: p.y, m: p.m } : null;
}

function TKC_shiftMonth(ym, delta) {
  var idx = ym.y * 12 + (ym.m - 1) + delta;
  return { y: Math.floor(idx / 12), m: (((idx % 12) + 12) % 12) + 1 };
}

function TKC_monthLabel(ym) {
  return TKC_MONTHS[ym.m - 1] + " " + ym.y;
}

// Weekday headings in grid order.
function TKC_dowLabels(weekStart) {
  var ws = weekStart == null ? TKC_WEEK_START : weekStart;
  var out = [];
  for (var i = 0; i < 7; i++) out.push(TKC_DOWS[(ws + i) % 7]);
  return out;
}

// The weeks of one month: an array of 4 to 6 rows of 7 cells
// { date, day, inMonth }. Days of the neighbor months fill the first and last row.
function TKC_monthGrid(ym, weekStart) {
  var ws = weekStart == null ? TKC_WEEK_START : weekStart;
  var first = TKC_iso(ym.y, ym.m, 1);
  var lead = (TKC_dow(first) - ws + 7) % 7;
  var start = TKC_addDays(first, -lead);
  var daysIn = new Date(Date.UTC(ym.y, ym.m, 0)).getUTCDate();
  var rows = Math.ceil((lead + daysIn) / 7);
  var out = [];
  for (var r = 0; r < rows; r++) {
    var row = [];
    for (var c = 0; c < 7; c++) {
      var date = TKC_addDays(start, r * 7 + c);
      var p = TKC_parse(date);
      row.push({ date: date, day: p.d, inMonth: p.y === ym.y && p.m === ym.m });
    }
    out.push(row);
  }
  return out;
}

function TKC_isDone(t) {
  var s = t && (t.status || (t.done ? "done" : "todo"));
  return s === "done" || !!(t && t.done);
}

// Open tasks first, then by text, so a day reads the same on every render.
function TKC_sortDay(list) {
  return list.slice().sort(function (a, b) {
    var da = TKC_isDone(a) ? 1 : 0;
    var db = TKC_isDone(b) ? 1 : 0;
    if (da !== db) return da - db;
    var x = String((a && a.text) || "").toLowerCase();
    var y = String((b && b.text) || "").toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  });
}

// Tasks by due day. Deleted tasks are skipped. -> { byDate: { iso: [task] },
// noDue: count of tasks with no (usable) due date }.
function TKC_bucket(tasks) {
  var byDate = {};
  var noDue = 0;
  (Array.isArray(tasks) ? tasks : []).forEach(function (t) {
    if (!t || t.deleted_at) return;
    var due = t.due_date ? String(t.due_date).slice(0, 10) : "";
    if (!TKC_parse(due)) {
      noDue++;
      return;
    }
    (byDate[due] = byDate[due] || []).push(t);
  });
  Object.keys(byDate).forEach(function (k) {
    byDate[k] = TKC_sortDay(byDate[k]);
  });
  return { byDate: byDate, noDue: noDue };
}

// How many chips a day shows before "+N more".
function TKC_chipCap(narrow) {
  return narrow ? 2 : 3;
}

// -> { shown, more }
function TKC_split(list, cap) {
  var n = cap > 0 ? cap : 3;
  var l = Array.isArray(list) ? list : [];
  if (l.length <= n) return { shown: l, more: 0 };
  // "+1 more" would take the room of the chip it hides: show it instead
  if (l.length === n + 1) return { shown: l, more: 0 };
  return { shown: l.slice(0, n), more: l.length - n };
}

// Arrow keys between days: the date to focus, or "" when the key is not one.
function TKC_arrow(iso, key) {
  if (key === "ArrowLeft") return TKC_addDays(iso, -1);
  if (key === "ArrowRight") return TKC_addDays(iso, 1);
  if (key === "ArrowUp") return TKC_addDays(iso, -7);
  if (key === "ArrowDown") return TKC_addDays(iso, 7);
  return "";
}

// A drop is a move only onto a different, valid day.
function TKC_dropOK(task, iso) {
  if (!task || !TKC_parse(iso)) return false;
  var cur = task.due_date ? String(task.due_date).slice(0, 10) : "";
  return cur !== iso;
}

// "Tuesday, October 28" style label for a day.
function TKC_dayLabel(iso) {
  var p = TKC_parse(iso);
  if (!p) return "";
  var names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return names[TKC_dow(iso)] + ", " + TKC_MONTHS[p.m - 1] + " " + p.d;
}

function TKC_noDueText(n) {
  if (!n) return "";
  return n + (n === 1 ? " task has" : " tasks have") + " no due date";
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    TKC_WEEK_START: TKC_WEEK_START,
    TKC_parse: TKC_parse,
    TKC_iso: TKC_iso,
    TKC_addDays: TKC_addDays,
    TKC_dow: TKC_dow,
    TKC_monthOf: TKC_monthOf,
    TKC_shiftMonth: TKC_shiftMonth,
    TKC_monthLabel: TKC_monthLabel,
    TKC_dowLabels: TKC_dowLabels,
    TKC_monthGrid: TKC_monthGrid,
    TKC_isDone: TKC_isDone,
    TKC_sortDay: TKC_sortDay,
    TKC_bucket: TKC_bucket,
    TKC_chipCap: TKC_chipCap,
    TKC_split: TKC_split,
    TKC_arrow: TKC_arrow,
    TKC_dropOK: TKC_dropOK,
    TKC_dayLabel: TKC_dayLabel,
    TKC_noDueText: TKC_noDueText,
  };
}
