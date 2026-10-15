// Shared fixtures for the business calendar (Tasks Phase 2, S1).
//
// Used by TK_recurrenceLogic.test.js (JS) and pasted into
// tk_recurrence_selftest() in supabase/tasks-p2-1-calendar.sql (SQL). To
// regenerate the SQL seed + values after editing this file:
//   node components/tasks/TK_recurrenceLogic.test.js --sql
//
// HOLIDAYS is the tk_holidays seed: US Federal Reserve bank holidays for
// 2026-2028 (a holiday on Saturday is not observed; on Sunday it moves to
// Monday) plus the firm days the owner asked for (Q6): Good Friday, the day
// after Thanksgiving and Christmas Eve. The owner can add or switch off days
// later; the cases below assume this seed.
//
// Case shapes (fn):
//   resolve: tk_resolve_due(rule, start, end)
//   add_bd:  tk_add_business_days(day, n)
//   bdom:    tk_business_day_of_month(day, n)
//   roll:    tk_roll(day, mode)
//   pstart:  tk_period_start_for(kind, day, fye)

var TK_RECURRENCE_HOLIDAYS = [
  ["2026-01-01", "New Year's Day"],
  ["2026-01-19", "Martin Luther King Jr. Day"],
  ["2026-02-16", "Presidents Day"],
  ["2026-04-03", "Good Friday (firm)"],
  ["2026-05-25", "Memorial Day"],
  ["2026-06-19", "Juneteenth"],
  ["2026-09-07", "Labor Day"],
  ["2026-10-12", "Columbus Day"],
  ["2026-11-11", "Veterans Day"],
  ["2026-11-26", "Thanksgiving"],
  ["2026-11-27", "Day after Thanksgiving (firm)"],
  ["2026-12-24", "Christmas Eve (firm)"],
  ["2026-12-25", "Christmas Day"],
  ["2027-01-01", "New Year's Day"],
  ["2027-01-18", "Martin Luther King Jr. Day"],
  ["2027-02-15", "Presidents Day"],
  ["2027-03-26", "Good Friday (firm)"],
  ["2027-05-31", "Memorial Day"],
  ["2027-07-05", "Independence Day (observed)"],
  ["2027-09-06", "Labor Day"],
  ["2027-10-11", "Columbus Day"],
  ["2027-11-11", "Veterans Day"],
  ["2027-11-25", "Thanksgiving"],
  ["2027-11-26", "Day after Thanksgiving (firm)"],
  ["2027-12-24", "Christmas Eve (firm)"],
  ["2028-01-17", "Martin Luther King Jr. Day"],
  ["2028-02-21", "Presidents Day"],
  ["2028-04-14", "Good Friday (firm)"],
  ["2028-05-29", "Memorial Day"],
  ["2028-06-19", "Juneteenth"],
  ["2028-07-04", "Independence Day"],
  ["2028-09-04", "Labor Day"],
  ["2028-10-09", "Columbus Day"],
  ["2028-11-23", "Thanksgiving"],
  ["2028-11-24", "Day after Thanksgiving (firm)"],
  ["2028-12-25", "Christmas Day"],
];

var SEP26 = ["2026-09-01", "2026-09-30"];
var OCT26 = ["2026-10-01", "2026-10-31"];
var NOV26 = ["2026-11-01", "2026-11-30"];
var DEC25 = ["2025-12-01", "2025-12-31"];
var JAN26 = ["2026-01-01", "2026-01-31"];

function R(id, rule, period, expected) {
  return { id: id, fn: "resolve", rule: rule, start: period[0], end: period[1], expected: expected };
}

var TK_RECURRENCE_CASES = [
  // offset: calendar days from the period end, no roll
  R("offset_15", { type: "offset", days: 15 }, SEP26, "2026-10-15"),
  R("offset_neg5", { type: "offset", days: -5 }, SEP26, "2026-09-25"),
  R("offset_120_year_end", { type: "offset", days: 120 }, SEP26, "2027-01-28"),
  // business_day
  R("bd1_oct", { type: "business_day", n: 1 }, SEP26, "2026-10-01"),
  R("bd1_dec", { type: "business_day", n: 1 }, NOV26, "2026-12-01"),
  R("bd1_jan_new_year", { type: "business_day", n: 1 }, ["2026-12-01", "2026-12-31"], "2027-01-04"),
  R("bd5_jan_new_year", { type: "business_day", n: 5 }, DEC25, "2026-01-08"),
  R("bd10_skips_columbus", { type: "business_day", n: 10 }, SEP26, "2026-10-15"),
  R("bd_last_oct", { type: "business_day", n: -1 }, SEP26, "2026-10-30"),
  R("bd_last_nov", { type: "business_day", n: -1 }, OCT26, "2026-11-30"),
  R("bd_last_dec", { type: "business_day", n: -1 }, NOV26, "2026-12-31"),
  R("bd23_feb_short_month", { type: "business_day", n: 23 }, JAN26, "2026-02-27"),
  R("bd3_same_month", { type: "business_day", n: 3, month_offset: 0 }, ["2026-02-01", "2026-02-28"], "2026-02-04"),
  R("bd1_quarter_offset2", { type: "business_day", n: 1, month_offset: 2 }, ["2026-07-01", "2026-09-30"], "2026-11-02"),
  R("bd3_good_friday", { type: "business_day", n: 3, month_offset: 0 }, ["2026-04-01", "2026-04-30"], "2026-04-06"),
  R("bd15_quarter_q4", { type: "business_day", n: 15 }, ["2026-10-01", "2026-12-31"], "2027-01-25"),
  // day_of_month
  R("dom15", { type: "day_of_month", day: 15 }, SEP26, "2026-10-15"),
  R("dom31_feb_clamp_next", { type: "day_of_month", day: 31 }, JAN26, "2026-03-02"),
  R("dom31_feb_clamp_prev", { type: "day_of_month", day: 31, roll: "prev" }, JAN26, "2026-02-27"),
  R("dom29_leap_none", { type: "day_of_month", day: 29, roll: "none" }, ["2028-01-01", "2028-01-31"], "2028-02-29"),
  R("dom29_feb_nonleap", { type: "day_of_month", day: 29 }, ["2027-01-01", "2027-01-31"], "2027-03-01"),
  R("dom19_juneteenth_monday", { type: "day_of_month", day: 19 }, ["2028-05-01", "2028-05-31"], "2028-06-20"),
  R("dom18_sunday_then_mlk", { type: "day_of_month", day: 18 }, DEC25, "2026-01-20"),
  R("dom4_july_observed_next", { type: "day_of_month", day: 4 }, ["2027-06-01", "2027-06-30"], "2027-07-06"),
  R("dom4_july_prev", { type: "day_of_month", day: 4, roll: "prev" }, ["2027-06-01", "2027-06-30"], "2027-07-02"),
  // eom
  R("eom0_oct", { type: "eom", offset_bd: 0 }, SEP26, "2026-10-30"),
  R("eom5_dec_holidays", { type: "eom", offset_bd: 5 }, NOV26, "2026-12-22"),
  R("eom1_thanksgiving", { type: "eom", offset_bd: 1 }, OCT26, "2026-11-25"),
  R("eom_default_same_month", { type: "eom", month_offset: 0 }, ["2026-02-01", "2026-02-28"], "2026-02-27"),
  // nth_weekday
  R("nth2_tue", { type: "nth_weekday", n: 2, dow: 2 }, SEP26, "2026-10-13"),
  R("nth_last_fri", { type: "nth_weekday", n: -1, dow: 5 }, SEP26, "2026-10-30"),
  R("nth5_mon_none_falls_back", { type: "nth_weekday", n: 5, dow: 1 }, JAN26, "2026-02-23"),
  R("nth3_mon_holiday_no_roll", { type: "nth_weekday", n: 3, dow: 1 }, DEC25, "2026-01-19"),
  R("nth3_mon_holiday_roll_next", { type: "nth_weekday", n: 3, dow: 1, roll: "next" }, DEC25, "2026-01-20"),
  R("nth4_thu_thanksgiving", { type: "nth_weekday", n: 4, dow: 4, month_offset: 0 }, NOV26, "2026-11-26"),
  // weekday (weekly)
  R("wk_fri_new_year", { type: "weekday", dow: 5 }, ["2026-12-28", "2027-01-03"], "2027-01-04"),
  R("wk_wed_year_end", { type: "weekday", dow: 3 }, ["2026-12-28", "2027-01-03"], "2026-12-30"),
  R("wk_thu_thanksgiving", { type: "weekday", dow: 4 }, ["2026-11-23", "2026-11-29"], "2026-11-30"),
  R("wk_mon", { type: "weekday", dow: 1 }, ["2027-12-27", "2028-01-02"], "2027-12-27"),
  R("wk_fri_christmas_eve", { type: "weekday", dow: 5 }, ["2027-12-20", "2027-12-26"], "2027-12-27"),
  // fiscal years (990-style: 15th of the 5th month after year end)
  R("fy_jun_990", { type: "day_of_month", day: 15, month_offset: 5 }, ["2026-07-01", "2027-06-30"], "2027-11-15"),
  R("fy_sep_sunday", { type: "day_of_month", day: 15, month_offset: 2 }, ["2025-10-01", "2026-09-30"], "2026-11-16"),

  // add_bd
  { id: "add1_thanksgiving", fn: "add_bd", day: "2026-11-25", n: 1, expected: "2026-11-30" },
  { id: "add_neg1_thanksgiving", fn: "add_bd", day: "2026-11-30", n: -1, expected: "2026-11-25" },
  { id: "add0_weekend", fn: "add_bd", day: "2026-12-26", n: 0, expected: "2026-12-28" },
  { id: "add2_christmas", fn: "add_bd", day: "2026-12-23", n: 2, expected: "2026-12-29" },
  { id: "add_neg1_new_year", fn: "add_bd", day: "2027-01-04", n: -1, expected: "2026-12-31" },
  { id: "add10_columbus", fn: "add_bd", day: "2026-10-14", n: 10, expected: "2026-10-28" },
  { id: "add_neg1_unseeded_2025", fn: "add_bd", day: "2026-01-02", n: -1, expected: "2025-12-31" },
  // bdom
  { id: "bdom1_feb", fn: "bdom", day: "2026-02-10", n: 1, expected: "2026-02-02" },
  { id: "bdom1_jan_2028_sat_new_year", fn: "bdom", day: "2028-01-05", n: 1, expected: "2028-01-03" },
  { id: "bdom_last_may", fn: "bdom", day: "2026-05-01", n: -1, expected: "2026-05-29" },
  // roll
  { id: "roll_jul3_2026_open", fn: "roll", day: "2026-07-03", mode: "next", expected: "2026-07-03" },
  { id: "roll_prev_thanksgiving", fn: "roll", day: "2026-11-26", mode: "prev", expected: "2026-11-25" },
  { id: "roll_none_holiday", fn: "roll", day: "2026-12-25", mode: "none", expected: "2026-12-25" },
  // pstart: quarters are calendar (Q2), year = fiscal year
  { id: "ps_quarter_nov", fn: "pstart", kind: "quarter", day: "2026-11-15", fye: "06-30", expected: "2026-10-01" },
  { id: "ps_quarter_mar31", fn: "pstart", kind: "quarter", day: "2026-03-31", fye: null, expected: "2026-01-01" },
  { id: "ps_year_jun_fye_before", fn: "pstart", kind: "year", day: "2026-05-10", fye: "06-30", expected: "2025-07-01" },
  { id: "ps_year_jun_fye_first_day", fn: "pstart", kind: "year", day: "2026-07-01", fye: "06-30", expected: "2026-07-01" },
  { id: "ps_year_default_dec", fn: "pstart", kind: "year", day: "2026-12-31", fye: "", expected: "2026-01-01" },
  { id: "ps_year_slash_sep", fn: "pstart", kind: "year", day: "2026-02-14", fye: "9/30", expected: "2025-10-01" },
  { id: "ps_year_garbage", fn: "pstart", kind: "year", day: "2026-02-14", fye: "garbage", expected: "2026-01-01" },
  { id: "ps_year_jan_fye", fn: "pstart", kind: "year", day: "2026-01-15", fye: "01-31", expected: "2025-02-01" },
  { id: "ps_month", fn: "pstart", kind: "month", day: "2026-02-28", fye: null, expected: "2026-02-01" },
];

if (typeof module !== "undefined" && module.exports) {
  module.exports = { HOLIDAYS: TK_RECURRENCE_HOLIDAYS, CASES: TK_RECURRENCE_CASES };
}
