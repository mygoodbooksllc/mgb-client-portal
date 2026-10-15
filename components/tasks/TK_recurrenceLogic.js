// Tasks Phase 2 (S1): the business calendar and due-date rules, in plain JS.
//
// This is the browser/node mirror of supabase/tasks-p2-1-calendar.sql. Both
// must return the same dates for every case in TK_recurrence.fixtures.js; the
// node test checks this file, tk_recurrence_selftest() checks the SQL.
//
// Every function takes the holiday list as its last argument: an array of
// 'YYYY-MM-DD' strings (firm_closed days only) or a Set of them. No holidays
// = weekends only.
//
// Name clash: TK_logic.js already owns the globals TK_isBusinessDay and
// TK_addBusinessDays (Phase 1 quick add, weekends only, no holidays). This
// file must not overwrite them, so everything lives inside one closure. The
// browser gets window.TK_recurrence (all functions, spec names) plus the
// globals that don't clash: TK_businessDayOfMonth, TK_resolveDue,
// TK_dueRuleValid, TK_periodStart, TK_periodEnd, TK_periodsFor, TK_periodKey,
// TK_periodLabel. Node gets everything through module.exports.

var TK_recurrence = (function () {
  var DAY = 86400000;

  function pad2(n) {
    return (n < 10 ? "0" : "") + n;
  }
  function utc(ymd) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ""));
    if (!m) return NaN;
    return Date.UTC(+m[1], +m[2] - 1, +m[3]);
  }
  function ymdOf(ms) {
    var d = new Date(ms);
    return d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate());
  }
  function addDays(ymd, n) {
    return ymdOf(utc(ymd) + n * DAY);
  }
  function parts(ymd) {
    return { y: +ymd.slice(0, 4), m: +ymd.slice(5, 7), d: +ymd.slice(8, 10) };
  }
  function make(y, m, d) {
    return y + "-" + pad2(m) + "-" + pad2(d);
  }
  function daysIn(y, m) {
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
  }
  // ISO weekday: 1 = Monday .. 7 = Sunday (same as Postgres isodow).
  function isodow(ymd) {
    var w = new Date(utc(ymd)).getUTCDay();
    return w === 0 ? 7 : w;
  }
  function firstOfMonth(ymd) {
    return ymd.slice(0, 8) + "01";
  }
  function addMonths(firstYmd, n) {
    var p = parts(firstYmd);
    var t = p.y * 12 + (p.m - 1) + n;
    return make(Math.floor(t / 12), (((t % 12) + 12) % 12) + 1, 1);
  }
  function lastOfMonth(ymd) {
    var p = parts(ymd);
    return make(p.y, p.m, daysIn(p.y, p.m));
  }
  function valid(ymd) {
    return !isNaN(utc(ymd));
  }
  function holSet(h) {
    if (h instanceof Set) return h;
    return new Set(Array.isArray(h) ? h : []);
  }

  function isBusinessDay(ymd, holidays) {
    if (!valid(ymd)) return false;
    return isodow(ymd) < 6 && !holSet(holidays).has(ymd);
  }

  // n business days after (n > 0) or before (n < 0) ymd. n = 0 returns ymd
  // when it is a business day, else the next one.
  function addBusinessDays(ymd, n, holidays) {
    if (!valid(ymd) || n == null || isNaN(n)) return null;
    var h = holSet(holidays);
    var k = Math.trunc(Number(n));
    if (Math.abs(k) > 400) throw new Error("business day offset out of range");
    var cur = ymd;
    if (k === 0) {
      while (!isBusinessDay(cur, h)) cur = addDays(cur, 1);
      return cur;
    }
    var step = k < 0 ? -1 : 1;
    var left = Math.abs(k);
    while (left > 0) {
      cur = addDays(cur, step);
      if (isBusinessDay(cur, h)) left--;
    }
    return cur;
  }

  // The nth business day of the month holding monthYmd. n = -1 is the last
  // business day. A month with fewer than n business days returns its last.
  function businessDayOfMonth(monthYmd, n, holidays) {
    if (!valid(monthYmd)) return null;
    var k = Math.trunc(Number(n));
    if (!(k >= 1 || k === -1)) return null;
    var h = holSet(holidays);
    var first = firstOfMonth(monthYmd);
    var last = lastOfMonth(monthYmd);
    var lastBd = last;
    while (!isBusinessDay(lastBd, h)) lastBd = addDays(lastBd, -1);
    if (k === -1) return lastBd;
    var count = 0;
    for (var cur = first; cur <= last; cur = addDays(cur, 1)) {
      if (isBusinessDay(cur, h) && ++count === k) return cur;
    }
    return lastBd;
  }

  function roll(ymd, mode, holidays) {
    if (!valid(ymd)) return null;
    var m = mode == null ? "none" : mode;
    if (m === "none") return ymd;
    if (m !== "next" && m !== "prev") throw new Error("roll must be next, prev or none");
    var h = holSet(holidays);
    var cur = ymd;
    while (!isBusinessDay(cur, h)) cur = addDays(cur, m === "next" ? 1 : -1);
    return cur;
  }

  // ---- Due rules -----------------------------------------------------------

  var RULE_TYPES = ["offset", "business_day", "day_of_month", "eom", "nth_weekday", "weekday"];

  function isInt(v) {
    return typeof v === "number" && isFinite(v) && Math.floor(v) === v;
  }
  function intIn(v, lo, hi) {
    return isInt(v) && v >= lo && v <= hi;
  }
  function optInt(r, k, lo, hi) {
    return r[k] === undefined || r[k] === null || intIn(r[k], lo, hi);
  }
  function optRoll(r) {
    return r.roll === undefined || r.roll === null || r.roll === "next" || r.roll === "prev" || r.roll === "none";
  }

  // Same rules as tk_due_rule_valid(jsonb). null is valid (legacy offset).
  function dueRuleValid(rule) {
    if (rule === null || rule === undefined) return true;
    if (typeof rule !== "object" || Array.isArray(rule)) return false;
    var mo = optInt(rule, "month_offset", 0, 12);
    switch (rule.type) {
      case "offset":
        return intIn(rule.days, -90, 120);
      case "business_day":
        return (intIn(rule.n, 1, 23) || rule.n === -1) && mo;
      case "day_of_month":
        return intIn(rule.day, 1, 31) && mo && optRoll(rule);
      case "eom":
        return optInt(rule, "offset_bd", 0, 10) && mo;
      case "nth_weekday":
        return (intIn(rule.n, 1, 5) || rule.n === -1) && intIn(rule.dow, 1, 7) && mo && optRoll(rule);
      case "weekday":
        return intIn(rule.dow, 1, 7);
      default:
        return false;
    }
  }

  // The due date for one period. rule null returns null: the caller falls
  // back to the legacy due_offset_days ({type:'offset', days}).
  // month_offset counts from the month the period ends in (default 1 = the
  // month after).
  function resolveDue(rule, periodStart, periodEnd, holidays) {
    if (rule === null || rule === undefined) return null;
    if (!dueRuleValid(rule)) throw new Error("invalid due rule");
    if (!valid(periodStart) || !valid(periodEnd)) return null;
    var h = holSet(holidays);
    var mo = rule.month_offset == null ? 1 : rule.month_offset;
    var target = addMonths(firstOfMonth(periodEnd), mo);
    var tp = parts(target);
    switch (rule.type) {
      case "offset":
        return addDays(periodEnd, rule.days);
      case "business_day":
        return businessDayOfMonth(target, rule.n, h);
      case "day_of_month":
        return roll(make(tp.y, tp.m, Math.min(rule.day, daysIn(tp.y, tp.m))), rule.roll == null ? "next" : rule.roll, h);
      case "eom":
        return addBusinessDays(businessDayOfMonth(target, -1, h), -(rule.offset_bd || 0), h);
      case "nth_weekday": {
        var dim = daysIn(tp.y, tp.m);
        var d;
        if (rule.n === -1) {
          d = dim;
          while (isodow(make(tp.y, tp.m, d)) !== rule.dow) d--;
        } else {
          d = 1;
          while (isodow(make(tp.y, tp.m, d)) !== rule.dow) d++;
          d += 7 * (rule.n - 1);
          if (d > dim) d -= 7; // no 5th one this month: the last one
        }
        return roll(make(tp.y, tp.m, d), rule.roll == null ? "none" : rule.roll, h);
      }
      case "weekday": {
        var monday = addDays(periodStart, 1 - isodow(periodStart));
        return roll(addDays(monday, rule.dow - 1), "next", h);
      }
    }
    return null;
  }

  // ---- Periods -------------------------------------------------------------
  // Kinds: 'week', 'month', 'quarter' (always calendar, owner Q2), 'year'
  // (fiscal year, from client_profile.fiscal_year_end 'MM-DD'; default 12-31)
  // and 'calendar_year'. Only month/quarter/year are month_close kinds;
  // week and calendar_year have no close row (critique M6).

  // Month the fiscal year starts in (1..12). Bad or empty input = January.
  function fiscalStartMonth(fiscalYearEnd) {
    var m = /^\s*(\d{1,2})[-/](\d{1,2})\s*$/.exec(String(fiscalYearEnd || ""));
    var mm = m ? +m[1] : 12;
    if (!(mm >= 1 && mm <= 12)) mm = 12;
    return (mm % 12) + 1;
  }

  function periodStart(kind, ymd, fiscalYearEnd) {
    if (!valid(ymd)) return null;
    var p = parts(ymd);
    switch (kind) {
      case "week":
        return addDays(ymd, 1 - isodow(ymd));
      case "month":
        return make(p.y, p.m, 1);
      case "quarter":
        return make(p.y, p.m - ((p.m - 1) % 3), 1);
      case "year": {
        var sm = fiscalStartMonth(fiscalYearEnd);
        return make(p.m >= sm ? p.y : p.y - 1, sm, 1);
      }
      case "calendar_year":
        return make(p.y, 1, 1);
    }
    throw new Error("unknown period kind " + kind);
  }

  function periodEnd(kind, startYmd) {
    if (!valid(startYmd)) return null;
    switch (kind) {
      case "week":
        return addDays(startYmd, 6);
      case "month":
        return lastOfMonth(startYmd);
      case "quarter":
        return addDays(addMonths(startYmd, 3), -1);
      case "year":
      case "calendar_year":
        return addDays(addMonths(startYmd, 12), -1);
    }
    throw new Error("unknown period kind " + kind);
  }

  function nextStart(kind, startYmd) {
    switch (kind) {
      case "week":
        return addDays(startYmd, 7);
      case "month":
        return addMonths(startYmd, 1);
      case "quarter":
        return addMonths(startYmd, 3);
      default:
        return addMonths(startYmd, 12);
    }
  }

  // Every period of this kind that overlaps [fromYmd, toYmd], oldest first:
  // [{kind, start, end, key, label}]. Capped at 600 periods.
  function periodsFor(kind, fromYmd, toYmd, fiscalYearEnd) {
    if (!valid(fromYmd) || !valid(toYmd) || toYmd < fromYmd) return [];
    var out = [];
    var s = periodStart(kind, fromYmd, fiscalYearEnd);
    while (s <= toYmd && out.length < 600) {
      out.push({ kind: kind, start: s, end: periodEnd(kind, s), key: periodKey(kind, s), label: periodLabel(kind, s) });
      s = nextStart(kind, s);
    }
    return out;
  }

  // Stable id for (kind, start), e.g. 'month:2026-09-01'.
  function periodKey(kind, startYmd) {
    return kind + ":" + startYmd;
  }

  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  // Title label: 'Sep 2026', 'Q3 2026', 'FY 2027' (named by the year it
  // ends in), '2026', 'Wk of Sep 7'.
  function periodLabel(kind, startYmd) {
    if (!valid(startYmd)) return "";
    var p = parts(startYmd);
    switch (kind) {
      case "week":
        return "Wk of " + MON[p.m - 1] + " " + p.d;
      case "month":
        return MON[p.m - 1] + " " + p.y;
      case "quarter":
        return "Q" + ((p.m - 1) / 3 + 1) + " " + p.y;
      case "year":
        return "FY " + parts(periodEnd("year", startYmd)).y;
      case "calendar_year":
        return String(p.y);
    }
    return startYmd;
  }

  return {
    TK_isBusinessDay: isBusinessDay,
    TK_addBusinessDays: addBusinessDays,
    TK_businessDayOfMonth: businessDayOfMonth,
    TK_roll: roll,
    TK_dueRuleValid: dueRuleValid,
    TK_resolveDue: resolveDue,
    TK_fiscalStartMonth: fiscalStartMonth,
    TK_periodStart: periodStart,
    TK_periodEnd: periodEnd,
    TK_periodsFor: periodsFor,
    TK_periodKey: periodKey,
    TK_periodLabel: periodLabel,
    TK_RULE_TYPES: RULE_TYPES,
  };
})();

// Browser globals that don't clash with TK_logic.js (see the header).
var TK_businessDayOfMonth = TK_recurrence.TK_businessDayOfMonth;
var TK_dueRuleValid = TK_recurrence.TK_dueRuleValid;
var TK_resolveDue = TK_recurrence.TK_resolveDue;
var TK_periodStart = TK_recurrence.TK_periodStart;
var TK_periodEnd = TK_recurrence.TK_periodEnd;
var TK_periodsFor = TK_recurrence.TK_periodsFor;
var TK_periodKey = TK_recurrence.TK_periodKey;
var TK_periodLabel = TK_recurrence.TK_periodLabel;
if (typeof window !== "undefined") window.TK_recurrence = TK_recurrence;

if (typeof module !== "undefined" && module.exports) {
  module.exports = TK_recurrence;
}
