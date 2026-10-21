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

// ---- firm_part (Slate month rhythm, slice 2) ------------------------------
// Kept out of TK_RECURRENCE_CASES on purpose: those are pasted into the
// applied tk_recurrence_selftest() and must not change. These run in node
// (TK_recurrenceLogic.test.js) and in SQL in
// supabase/slate-rhythm-2-firm-part-tests.sql via the 4-argument
// tk_resolve_due(rule, start, end, rhythm). Regenerate the SQL values with:
//   node components/tasks/TK_recurrenceLogic.test.js --sql-rhythm
// expected is a date, or "error:<message>" for a call that must fail closed.

function RH(days, roll, extra) {
  var labels = ["Check in", "Send reports", "Follow up"];
  var keys = ["check_in", "reports", "follow_up"];
  var r = {
    parts: keys.map(function (k, i) {
      return { key: k, label: labels[i], day: days[i] };
    }),
    roll: roll,
  };
  if (extra) for (var x in extra) r[x] = extra[x];
  return r;
}
var RH_DEFAULT = RH([4, 14, 24], "next");

function FP(id, rule, rhythm, period, expected) {
  return { id: id, fn: "resolve_rhythm", rule: rule, rhythm: rhythm, start: period[0], end: period[1], expected: expected };
}

var TK_RECURRENCE_RHYTHM_CASES = [
  FP("fp_checkin_sunday_next", { type: "firm_part", part: "check_in", month_offset: 1 }, RH_DEFAULT, SEP26, "2026-10-05"),
  FP("fp_reports_wednesday", { type: "firm_part", part: "reports", month_offset: 1 }, RH_DEFAULT, SEP26, "2026-10-14"),
  FP("fp_followup_saturday_next", { type: "firm_part", part: "follow_up", month_offset: 1 }, RH_DEFAULT, SEP26, "2026-10-26"),
  FP("fp_followup_saturday_prev", { type: "firm_part", part: "follow_up", month_offset: 1 }, RH([4, 14, 24], "prev"), SEP26, "2026-10-23"),
  FP("fp_followup_saturday_none", { type: "firm_part", part: "follow_up", month_offset: 1 }, RH([4, 14, 24], "none"), SEP26, "2026-10-24"),
  FP("fp_no_month_offset_means_1", { type: "firm_part", part: "reports" }, RH_DEFAULT, NOV26, "2026-12-14"),
  FP("fp_month_offset_null_means_1", { type: "firm_part", part: "reports", month_offset: null }, RH_DEFAULT, NOV26, "2026-12-14"),
  FP("fp_month_offset_0", { type: "firm_part", part: "check_in", month_offset: 0 }, RH_DEFAULT, OCT26, "2026-10-05"),
  FP("fp_thanksgiving_run", { type: "firm_part", part: "reports", month_offset: 1 }, RH([4, 26, 27], "next"), OCT26, "2026-11-30"),
  FP("fp_day_after_thanksgiving", { type: "firm_part", part: "follow_up", month_offset: 1 }, RH([4, 26, 27], "next"), OCT26, "2026-11-30"),
  FP("fp_christmas_eve_prev", { type: "firm_part", part: "reports", month_offset: 1 }, RH([3, 24, 28], "prev"), NOV26, "2026-12-23"),
  FP("fp_new_year_next", { type: "firm_part", part: "check_in", month_offset: 1 }, RH([1, 14, 24], "next"), ["2026-12-01", "2026-12-31"], "2027-01-04"),
  FP("fp_good_friday_prev", { type: "firm_part", part: "check_in", month_offset: 1 }, RH([3, 14, 24], "prev"), ["2026-03-01", "2026-03-31"], "2026-04-02"),
  FP("fp_quarter_offset_2", { type: "firm_part", part: "reports", month_offset: 2 }, RH_DEFAULT, ["2026-07-01", "2026-09-30"], "2026-11-16"),
  FP("fp_feb_28_sunday_none", { type: "firm_part", part: "follow_up", month_offset: 1 }, RH([4, 14, 28], "none"), ["2027-01-01", "2027-01-31"], "2027-02-28"),
  FP("fp_juneteenth_monday", { type: "firm_part", part: "reports", month_offset: 1 }, RH([4, 19, 24], "next"), ["2028-05-01", "2028-05-31"], "2028-06-20"),
  FP("fp_rule_roll_ignored", { type: "firm_part", part: "follow_up", month_offset: 1, roll: "prev" }, RH_DEFAULT, SEP26, "2026-10-26"),
  FP("fp_rhythm_extra_fields", { type: "firm_part", part: "check_in", month_offset: 1 }, RH([4, 14, 24], "next", { note: "x" }), SEP26, "2026-10-05"),
  FP("fp_rhythm_no_labels", { type: "firm_part", part: "reports", month_offset: 1 },
    { parts: [{ key: "check_in", day: 5 }, { key: "reports", day: 15 }, { key: "follow_up", day: 25 }], roll: "next" }, SEP26, "2026-10-15"),
  FP("fp_month_offset_12", { type: "firm_part", part: "check_in", month_offset: 12 }, RH_DEFAULT, SEP26, "2027-09-07"),
  // fails closed
  FP("fp_err_rhythm_missing", { type: "firm_part", part: "reports", month_offset: 1 }, null, SEP26, "error:tk_month_rhythm_missing"),
  FP("fp_err_days_out_of_order", { type: "firm_part", part: "reports", month_offset: 1 }, RH([14, 4, 24], "next"), SEP26, "error:tk_month_rhythm_invalid: day_order"),
  FP("fp_err_bad_roll", { type: "firm_part", part: "reports", month_offset: 1 }, RH([4, 14, 24], "later"), SEP26, "error:tk_month_rhythm_invalid: roll"),
  FP("fp_err_day_29", { type: "firm_part", part: "follow_up", month_offset: 1 }, RH([4, 14, 29], "next"), SEP26, "error:tk_month_rhythm_invalid: part_day"),
  FP("fp_err_two_parts", { type: "firm_part", part: "check_in", month_offset: 1 },
    { parts: [{ key: "check_in", day: 4 }, { key: "reports", day: 14 }], roll: "next" }, SEP26, "error:tk_month_rhythm_invalid: parts_count"),
  FP("fp_err_rhythm_array", { type: "firm_part", part: "check_in", month_offset: 1 }, [4, 14, 24], SEP26, "error:tk_month_rhythm_invalid: not_object"),
  FP("fp_err_bad_rule", { type: "firm_part", part: "middle", month_offset: 1 }, RH_DEFAULT, SEP26, "error:invalid due rule"),
  // the rhythm argument changes nothing for the other rule types
  FP("fp_dom_ignores_null_rhythm", { type: "day_of_month", day: 15 }, null, SEP26, "2026-10-15"),
  FP("fp_dom_ignores_bad_rhythm", { type: "day_of_month", day: 15 }, RH([14, 4, 24], "later"), SEP26, "2026-10-15"),
  FP("fp_bd_ignores_rhythm", { type: "business_day", n: 10 }, RH_DEFAULT, SEP26, "2026-10-15"),
  FP("fp_weekday_ignores_rhythm", { type: "weekday", dow: 5 }, null, ["2026-12-28", "2027-01-03"], "2027-01-04"),
  FP("fp_null_rule_is_null", null, RH_DEFAULT, SEP26, null),
];

// tk_due_rule_valid / TK_dueRuleValid verdicts for the new type (both sides).
var TK_RECURRENCE_RULE_VECTORS = [
  { id: "frv_checkin", rule: { type: "firm_part", part: "check_in", month_offset: 1 }, valid: true },
  { id: "frv_reports_no_offset", rule: { type: "firm_part", part: "reports" }, valid: true },
  { id: "frv_followup_offset0", rule: { type: "firm_part", part: "follow_up", month_offset: 0 }, valid: true },
  { id: "frv_offset12", rule: { type: "firm_part", part: "reports", month_offset: 12 }, valid: true },
  { id: "frv_offset_null", rule: { type: "firm_part", part: "reports", month_offset: null }, valid: true },
  { id: "frv_extra_roll_ignored", rule: { type: "firm_part", part: "reports", roll: "sideways" }, valid: true },
  { id: "frv_no_part", rule: { type: "firm_part", month_offset: 1 }, valid: false },
  { id: "frv_part_null", rule: { type: "firm_part", part: null }, valid: false },
  { id: "frv_part_unknown", rule: { type: "firm_part", part: "middle" }, valid: false },
  { id: "frv_part_case", rule: { type: "firm_part", part: "Check_in" }, valid: false },
  { id: "frv_part_number", rule: { type: "firm_part", part: 1 }, valid: false },
  { id: "frv_part_array", rule: { type: "firm_part", part: ["reports"] }, valid: false },
  { id: "frv_part_label", rule: { type: "firm_part", part: "Send reports" }, valid: false },
  { id: "frv_offset13", rule: { type: "firm_part", part: "reports", month_offset: 13 }, valid: false },
  { id: "frv_offset_neg", rule: { type: "firm_part", part: "reports", month_offset: -1 }, valid: false },
  { id: "frv_offset_fraction", rule: { type: "firm_part", part: "reports", month_offset: 1.5 }, valid: false },
  { id: "frv_offset_string", rule: { type: "firm_part", part: "reports", month_offset: "1" }, valid: false },
  { id: "frv_type_typo", rule: { type: "firm_parts", part: "reports" }, valid: false },
  { id: "frv_type_case", rule: { type: "Firm_part", part: "reports" }, valid: false },
];

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    HOLIDAYS: TK_RECURRENCE_HOLIDAYS,
    CASES: TK_RECURRENCE_CASES,
    RHYTHM_CASES: TK_RECURRENCE_RHYTHM_CASES,
    RULE_VECTORS: TK_RECURRENCE_RULE_VECTORS,
  };
}
