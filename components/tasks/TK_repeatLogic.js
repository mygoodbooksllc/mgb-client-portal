// Slate Repeat menu: the date math and the plain-words text, in plain JS.
//
// Browser/node mirror of supabase/repeat-menu.sql (tk_repeat_valid,
// tk__repeat_raw_next, tk_repeat_next, tk_repeat_series). Both must return the
// same dates for every case in TK_repeat.fixtures.js: the node test checks this
// file, and `node components/tasks/TK_repeatLogic.test.js --sql` prints the same
// cases as SQL to run against the database.
//
// A repeat rule is plain JSON, kept in staff_reminders.recurrence_rule (one
// task) or task_templates.repeat_rule (a "Custom schedule" template):
//   {
//     v: 1,
//     freq: "daily" | "weekly" | "monthly" | "yearly",
//     interval: 1..99,                    // every N days / weeks / months / years
//     dows: [1..7],                       // weekly: ISO weekdays (1 = Monday); empty = the start day's weekday
//     by: "dom" | "nth" | "last",         // monthly / yearly: day of month, nth weekday, or last day
//     day: 1..31,                         // by = dom (a short month uses its last day); absent = the start day
//     n: 1..4 | -1, dow: 1..7,            // by = nth ("2nd Tuesday", n = -1 is the last one)
//     skip: true | false,                 // skip weekends and firm holidays (move to the next business day)
//     time: "HH:MM" | null, tz: "America/Chicago" | null,
//     end: { type: "never" } | { type: "on", date: "YYYY-MM-DD" } | { type: "count", n: 1..999 },
//     start: "YYYY-MM-DD",                // templates only: the first date
//     seen: 1..                           // tasks only: how many tasks this series has made, counting this one
//   }
// Quarterly is monthly every 3 months; yearly keeps the start date's month.
//
// Holidays are the last argument: an array of 'YYYY-MM-DD' (firm_closed days)
// or a Set. None = weekends only. Names all start with TK_repeat / TK_REPEAT.

var TK_repeat = (function () {
  var DAY = 86400000;
  var FREQS = ["daily", "weekly", "monthly", "yearly"];
  var MAX_SCAN = 600; // raw dates tried before giving up (a runaway guard)

  function pad2(n) {
    return (n < 10 ? "0" : "") + n;
  }
  function utc(ymd) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ""));
    if (!m) return NaN;
    var ms = Date.UTC(+m[1], +m[2] - 1, +m[3]);
    var d = new Date(ms);
    // 2026-02-30 must not roll into March
    return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? ms : NaN;
  }
  function valid(ymd) {
    return !isNaN(utc(ymd));
  }
  function ymdOf(ms) {
    var d = new Date(ms);
    return d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate());
  }
  function addDays(ymd, n) {
    return ymdOf(utc(ymd) + n * DAY);
  }
  function diffDays(a, b) {
    return Math.round((utc(a) - utc(b)) / DAY);
  }
  function isodow(ymd) {
    var w = new Date(utc(ymd)).getUTCDay();
    return w === 0 ? 7 : w;
  }
  function daysIn(y, m) {
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
  }
  function monthIndex(ymd) {
    return +ymd.slice(0, 4) * 12 + (+ymd.slice(5, 7) - 1);
  }
  function make(y, m, d) {
    return y + "-" + pad2(m) + "-" + pad2(d);
  }
  function mondayOf(ymd) {
    return addDays(ymd, -(isodow(ymd) - 1));
  }
  function isInt(v) {
    return typeof v === "number" && isFinite(v) && Math.floor(v) === v;
  }
  function intIn(v, lo, hi) {
    return isInt(v) && v >= lo && v <= hi;
  }
  function holSet(h) {
    if (h instanceof Set) return h;
    return new Set(Array.isArray(h) ? h : []);
  }
  function isBusinessDay(ymd, hol) {
    return isodow(ymd) < 6 && !hol.has(ymd);
  }
  function rollNext(ymd, hol) {
    var cur = ymd;
    var guard = 0;
    while (!isBusinessDay(cur, hol) && guard++ < 60) cur = addDays(cur, 1);
    return cur;
  }

  // ---- Validation (same answers as tk_repeat_valid) ---------------------------

  function timeOk(t) {
    var m = /^(\d{2}):(\d{2})$/.exec(String(t));
    return !!m && +m[1] <= 23 && +m[2] <= 59;
  }

  function repeatValid(rule) {
    if (!rule || typeof rule !== "object" || Array.isArray(rule)) return false;
    if (FREQS.indexOf(rule.freq) < 0) return false;
    if (!intIn(rule.interval == null ? 1 : rule.interval, 1, 99)) return false;
    if (rule.dows != null) {
      if (!Array.isArray(rule.dows) || rule.dows.length > 7) return false;
      for (var i = 0; i < rule.dows.length; i++) if (!intIn(rule.dows[i], 1, 7)) return false;
    }
    if (rule.by != null && ["dom", "nth", "last"].indexOf(rule.by) < 0) return false;
    if (rule.day != null && !intIn(rule.day, 1, 31)) return false;
    if (rule.by === "nth" && !((intIn(rule.n, 1, 4) || rule.n === -1) && intIn(rule.dow, 1, 7))) return false;
    if (rule.skip != null && typeof rule.skip !== "boolean") return false;
    if (rule.time != null && !timeOk(rule.time)) return false;
    if (rule.tz != null && (typeof rule.tz !== "string" || rule.tz.length > 64)) return false;
    if (rule.start != null && !valid(rule.start)) return false;
    if (rule.seen != null && !intIn(rule.seen, 1, 100000)) return false;
    var e = rule.end;
    if (e != null) {
      if (typeof e !== "object" || Array.isArray(e)) return false;
      if (e.type === "never") return true;
      if (e.type === "on") return valid(e.date);
      if (e.type === "count") return intIn(e.n, 1, 999);
      return false;
    }
    return true;
  }

  // ---- The raw pattern (no weekend skipping) ----------------------------------

  // First pattern date strictly after `after`, counting from `anchor` (the
  // phase of "every N" and the default day / weekday / month). null when none
  // turns up in MAX_SCAN tries.
  function rawNext(rule, anchor, after) {
    var n = rule.interval == null ? 1 : rule.interval;
    var k;
    if (rule.freq === "daily") {
      if (diffDays(after, anchor) < 0) return anchor;
      k = Math.floor(diffDays(after, anchor) / n) + 1;
      return addDays(anchor, k * n);
    }
    if (rule.freq === "weekly") {
      var dows = (rule.dows && rule.dows.length ? rule.dows.slice() : [isodow(anchor)]).sort(function (a, b) { return a - b; });
      var week0 = mondayOf(anchor);
      var w = Math.max(0, Math.floor(diffDays(mondayOf(after), week0) / 7));
      w -= w % n;
      for (var tries = 0; tries < MAX_SCAN; tries++, w += n) {
        for (var i = 0; i < dows.length; i++) {
          var d = addDays(week0, w * 7 + dows[i] - 1);
          if (diffDays(d, after) > 0) return d;
        }
      }
      return null;
    }
    // monthly / yearly
    var step = rule.freq === "yearly" ? 12 * n : n;
    var by = rule.by || "dom";
    var aIdx = monthIndex(anchor);
    var kk = Math.max(0, Math.floor((monthIndex(after) - aIdx) / step) - 1);
    var anchorDay = +anchor.slice(8, 10);
    for (var t = 0; t < MAX_SCAN; t++, kk++) {
      var idx = aIdx + kk * step;
      var y = Math.floor(idx / 12);
      var mo = (idx % 12) + 1;
      var dim = daysIn(y, mo);
      var day;
      if (by === "last") {
        day = dim;
      } else if (by === "nth") {
        var first = make(y, mo, 1);
        var off = (rule.dow - isodow(first) + 7) % 7; // 0..6 days to the first such weekday
        if (rule.n === -1) {
          day = 1 + off;
          while (day + 7 <= dim) day += 7;
        } else {
          day = 1 + off + 7 * (rule.n - 1);
          if (day > dim) day -= 7;
        }
      } else {
        day = Math.min(rule.day == null ? anchorDay : rule.day, dim);
      }
      var cand = make(y, mo, day);
      if (diffDays(cand, after) > 0) return cand;
    }
    return null;
  }

  function pastEnd(rule, ymd) {
    return !!(rule.end && rule.end.type === "on" && diffDays(ymd, rule.end.date) > 0);
  }

  // ---- Next date after a finished task (twin of tk_repeat_next) ----------------

  // The next date after `base` (the finished task's due date) that is on or
  // after `today`, or null when the series has ended. "Count" ends are the
  // caller's: see TK_repeatMoreToCome.
  function repeatNext(rule, base, today, holidays) {
    if (!repeatValid(rule) || !valid(base)) return null;
    var hol = holSet(holidays);
    var floor = valid(today) ? today : base;
    var raw = base;
    for (var i = 0; i < MAX_SCAN; i++) {
      raw = rawNext(rule, base, raw);
      if (!raw) return null;
      var d = rule.skip ? rollNext(raw, hol) : raw;
      if (diffDays(d, base) > 0 && diffDays(d, floor) >= 0) {
        return pastEnd(rule, d) ? null : d;
      }
      if (pastEnd(rule, raw)) return null;
    }
    return null;
  }

  // A "count" end: seen tasks have been made so far, the cap is end.n.
  function repeatMoreToCome(rule) {
    if (!rule || !rule.end || rule.end.type !== "count") return true;
    return (rule.seen == null ? 1 : rule.seen) < rule.end.n;
  }

  // The rule for the task that follows: same rule, seen + 1.
  function repeatAdvance(rule) {
    var out = JSON.parse(JSON.stringify(rule));
    out.seen = (rule.seen == null ? 1 : rule.seen) + 1;
    return out;
  }

  // ---- A whole series (twin of tk_repeat_series) -------------------------------

  // Dates from rule.start (or `start`) up to and including `to`, oldest first,
  // at most `max`. Honors skip, the end date and a "count" end.
  function repeatSeries(rule, start, to, holidays, max) {
    var out = [];
    var anchor = rule && rule.start ? rule.start : start;
    if (!repeatValid(rule) || !valid(anchor) || !valid(to)) return out;
    var hol = holSet(holidays);
    var cap = max == null ? 1000 : max;
    var capCount = rule.end && rule.end.type === "count" ? rule.end.n : Infinity;
    var raw = rawNext(rule, anchor, addDays(anchor, -1));
    var last = null;
    for (var i = 0; raw && i < MAX_SCAN * 4 && out.length < cap && out.length < capCount; i++) {
      var d = rule.skip ? rollNext(raw, hol) : raw;
      if (pastEnd(rule, d) || diffDays(d, to) > 0) break;
      if (last === null || diffDays(d, last) > 0) {
        out.push(d);
        last = d;
      }
      raw = rawNext(rule, anchor, raw);
    }
    return out;
  }

  // ---- Time of day, DST-proof (twin of the due_at math in complete_staff_item) --

  function wallParts(ms, tz) {
    var f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    var p = {};
    f.formatToParts(new Date(ms)).forEach(function (x) {
      p[x.type] = +x.value;
    });
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  }

  // 'YYYY-MM-DD' + 'HH:MM' wall clock in `tz` -> an ISO instant. The same answer
  // Postgres gives for (date + time) at time zone tz: a time that does not exist
  // (spring forward) uses the offset from before the change, and a time that
  // happens twice (fall back) takes the second, as Postgres does.
  function repeatDueAt(ymd, hhmm, tz) {
    if (!valid(ymd) || !timeOk(hhmm)) return null;
    var zone = tz || "America/Chicago";
    var target = utc(ymd) + (+hhmm.slice(0, 2) * 60 + +hhmm.slice(3, 5)) * 60000;
    var off1 = wallParts(target, zone) - target;
    var c1 = target - off1;
    var c = null;
    if (wallParts(c1, zone) === target) c = c1;
    else {
      var off2 = wallParts(c1, zone) - c1;
      var c2 = target - off2;
      c = wallParts(c2, zone) === target ? c2 : c1;
    }
    // a time that happens twice: Postgres takes the later one, so do the same
    if (wallParts(c + 3600000, zone) === target) c += 3600000;
    return new Date(c).toISOString();
  }

  // ---- Plain words --------------------------------------------------------------

  var DOW_NAMES = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  var DOW_SHORT = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  var MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function ordinal(n) {
    var v = Math.abs(n);
    var s = v % 100 >= 11 && v % 100 <= 13 ? "th" : v % 10 === 1 ? "st" : v % 10 === 2 ? "nd" : v % 10 === 3 ? "rd" : "th";
    return v + s;
  }
  function clock(hhmm) {
    var h = +hhmm.slice(0, 2);
    var m = hhmm.slice(3, 5);
    return (h % 12 === 0 ? 12 : h % 12) + ":" + m + (h < 12 ? " AM" : " PM");
  }
  function prettyDate(ymd) {
    return MONTHS[+ymd.slice(5, 7)] + " " + +ymd.slice(8, 10) + ", " + ymd.slice(0, 4);
  }

  // "Every 2 weeks on Mon and Thu, until Dec 31, 2026". `startYmd` fills in the
  // day / weekday / month a rule leaves open.
  function repeatText(rule, startYmd) {
    if (!repeatValid(rule)) return "Doesn't repeat";
    var n = rule.interval == null ? 1 : rule.interval;
    var s = valid(startYmd) ? startYmd : rule.start;
    var head;
    if (rule.freq === "daily") {
      head = n === 1 ? "Every day" : "Every " + n + " days";
    } else if (rule.freq === "weekly") {
      var dows = (rule.dows && rule.dows.length ? rule.dows.slice() : s && valid(s) ? [isodow(s)] : []).sort(function (a, b) { return a - b; });
      var names = dows.map(function (d) { return DOW_SHORT[d]; });
      var list = names.length > 1 ? names.slice(0, -1).join(", ") + " and " + names[names.length - 1] : names[0] || "";
      var weekdays = dows.join("") === "12345";
      head = (n === 1 ? "Every week" : "Every " + n + " weeks") + (weekdays ? " on weekdays" : list ? " on " + list : "");
    } else {
      var by = rule.by || "dom";
      var quarterly = rule.freq === "monthly" && n === 3;
      var every = rule.freq === "yearly" ? (n === 1 ? "Every year" : "Every " + n + " years") : quarterly ? "Every quarter" : n === 1 ? "Every month" : "Every " + n + " months";
      var where;
      if (by === "last") where = "on the last day";
      else if (by === "nth") where = "on the " + (rule.n === -1 ? "last" : ordinal(rule.n)) + " " + DOW_NAMES[rule.dow];
      else {
        var day = rule.day != null ? rule.day : s && valid(s) ? +s.slice(8, 10) : null;
        where = day != null ? "on the " + ordinal(day) : "";
      }
      var inMonth = rule.freq === "yearly" && s && valid(s) ? " in " + MONTHS[+s.slice(5, 7)] : "";
      head = every + (where ? " " + where : "") + inMonth;
    }
    var bits = [head];
    if (rule.time) bits.push("at " + clock(rule.time));
    if (rule.skip) bits.push("skipping weekends and firm holidays");
    var e = rule.end;
    if (e && e.type === "on") bits.push("until " + prettyDate(e.date));
    else if (e && e.type === "count") bits.push("for " + (e.n === 1 ? "1 time" : e.n + " times"));
    return bits.join(", ");
  }

  // A fresh rule for the menu to start from.
  function repeatDefault(freq, startYmd) {
    var r = { v: 1, freq: freq || "weekly", interval: 1, skip: false, end: { type: "never" } };
    if (r.freq === "weekly" && valid(startYmd)) r.dows = [isodow(startYmd)];
    if ((r.freq === "monthly" || r.freq === "yearly") && valid(startYmd)) {
      r.by = "dom";
      r.day = +startYmd.slice(8, 10);
    }
    return r;
  }

  return {
    TK_repeatValid: repeatValid,
    TK_repeatNext: repeatNext,
    TK_repeatSeries: repeatSeries,
    TK_repeatMoreToCome: repeatMoreToCome,
    TK_repeatAdvance: repeatAdvance,
    TK_repeatDueAt: repeatDueAt,
    TK_repeatText: repeatText,
    TK_repeatDefault: repeatDefault,
    TK_repeatRawNext: rawNext,
    TK_REPEAT_FREQS: FREQS,
    TK_REPEAT_DOW_NAMES: DOW_NAMES,
    TK_REPEAT_DOW_SHORT: DOW_SHORT,
  };
})();

var TK_repeatValid = TK_repeat.TK_repeatValid;
var TK_repeatNext = TK_repeat.TK_repeatNext;
var TK_repeatSeries = TK_repeat.TK_repeatSeries;
var TK_repeatMoreToCome = TK_repeat.TK_repeatMoreToCome;
var TK_repeatAdvance = TK_repeat.TK_repeatAdvance;
var TK_repeatDueAt = TK_repeat.TK_repeatDueAt;
var TK_repeatText = TK_repeat.TK_repeatText;
var TK_repeatDefault = TK_repeat.TK_repeatDefault;
if (typeof window !== "undefined") window.TK_repeat = TK_repeat;

if (typeof module !== "undefined" && module.exports) {
  module.exports = TK_repeat;
}
