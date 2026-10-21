// Shared vectors for the month rhythm setting (Slate month rhythm, slice 1).
//
// Used by TK_rhythmLogic.test.js (JS: TK_rhythmProblem) and copied into
// supabase/slate-rhythm-1-settings-tests.sql (SQL: tk_month_rhythm_problem).
// Each case: id, the JSON text of the value, and the expected problem code
// (null = valid). The node test checks the SQL file carries every id with
// the same JSON and code, so JS and SQL stay in agreement.
//
// Problem codes: not_object, parts_missing, parts_count, part_key, part_day,
// day_order, label, roll.

var TK_RHYTHM_CASES = [
  { id: "r01_default", json: '{"parts":[{"key":"check_in","label":"Check in","day":4},{"key":"reports","label":"Send reports","day":14},{"key":"follow_up","label":"Follow up","day":24}],"roll":"next"}', problem: null },
  { id: "r02_no_labels", json: '{"parts":[{"key":"check_in","day":3},{"key":"reports","day":12},{"key":"follow_up","day":20}],"roll":"prev"}', problem: null },
  { id: "r03_roll_none", json: '{"parts":[{"key":"check_in","day":1},{"key":"reports","day":2},{"key":"follow_up","day":28}],"roll":"none"}', problem: null },
  { id: "r04_float_int", json: '{"parts":[{"key":"check_in","day":4.0},{"key":"reports","day":14},{"key":"follow_up","day":24}],"roll":"next"}', problem: null },
  { id: "r05_extra_fields", json: '{"parts":[{"key":"check_in","day":4,"note":"x"},{"key":"reports","day":14},{"key":"follow_up","day":24}],"roll":"next","v":2}', problem: null },
  { id: "r06_array", json: "[1,2,3]", problem: "not_object" },
  { id: "r07_string", json: '"4,14,24"', problem: "not_object" },
  { id: "r08_no_parts", json: '{"roll":"next"}', problem: "parts_missing" },
  { id: "r09_parts_object", json: '{"parts":{"check_in":4},"roll":"next"}', problem: "parts_missing" },
  { id: "r10_two_parts", json: '{"parts":[{"key":"check_in","day":4},{"key":"reports","day":14}],"roll":"next"}', problem: "parts_count" },
  { id: "r11_four_parts", json: '{"parts":[{"key":"check_in","day":4},{"key":"reports","day":14},{"key":"follow_up","day":24},{"key":"follow_up","day":26}],"roll":"next"}', problem: "parts_count" },
  { id: "r12_wrong_key", json: '{"parts":[{"key":"check_in","day":4},{"key":"report","day":14},{"key":"follow_up","day":24}],"roll":"next"}', problem: "part_key" },
  { id: "r13_key_order", json: '{"parts":[{"key":"reports","day":4},{"key":"check_in","day":14},{"key":"follow_up","day":24}],"roll":"next"}', problem: "part_key" },
  { id: "r14_part_not_object", json: '{"parts":[4,14,24],"roll":"next"}', problem: "part_key" },
  { id: "r15_day_string", json: '{"parts":[{"key":"check_in","day":"4"},{"key":"reports","day":14},{"key":"follow_up","day":24}],"roll":"next"}', problem: "part_day" },
  { id: "r16_day_zero", json: '{"parts":[{"key":"check_in","day":0},{"key":"reports","day":14},{"key":"follow_up","day":24}],"roll":"next"}', problem: "part_day" },
  { id: "r17_day_29", json: '{"parts":[{"key":"check_in","day":4},{"key":"reports","day":14},{"key":"follow_up","day":29}],"roll":"next"}', problem: "part_day" },
  { id: "r18_day_fraction", json: '{"parts":[{"key":"check_in","day":4.5},{"key":"reports","day":14},{"key":"follow_up","day":24}],"roll":"next"}', problem: "part_day" },
  { id: "r19_day_missing", json: '{"parts":[{"key":"check_in"},{"key":"reports","day":14},{"key":"follow_up","day":24}],"roll":"next"}', problem: "part_day" },
  { id: "r20_equal_days", json: '{"parts":[{"key":"check_in","day":14},{"key":"reports","day":14},{"key":"follow_up","day":24}],"roll":"next"}', problem: "day_order" },
  { id: "r21_desc_days", json: '{"parts":[{"key":"check_in","day":4},{"key":"reports","day":24},{"key":"follow_up","day":14}],"roll":"next"}', problem: "day_order" },
  { id: "r22_label_empty", json: '{"parts":[{"key":"check_in","label":"  ","day":4},{"key":"reports","day":14},{"key":"follow_up","day":24}],"roll":"next"}', problem: "label" },
  { id: "r23_label_number", json: '{"parts":[{"key":"check_in","label":7,"day":4},{"key":"reports","day":14},{"key":"follow_up","day":24}],"roll":"next"}', problem: "label" },
  { id: "r24_label_long", json: '{"parts":[{"key":"check_in","label":"' + "x".repeat(41) + '","day":4},{"key":"reports","day":14},{"key":"follow_up","day":24}],"roll":"next"}', problem: "label" },
  { id: "r25_no_roll", json: '{"parts":[{"key":"check_in","day":4},{"key":"reports","day":14},{"key":"follow_up","day":24}]}', problem: "roll" },
  { id: "r26_bad_roll", json: '{"parts":[{"key":"check_in","day":4},{"key":"reports","day":14},{"key":"follow_up","day":24}],"roll":"weekend"}', problem: "roll" },
  { id: "r27_null", json: "null", problem: "not_object" },
  // r28-r33: label blanks and length in code points (slate-rhythm-1b-label-parity.sql)
  { id: "r28_label_bom", json: '{"parts":[{"key":"check_in","label":"\\ufeff","day":4},{"key":"reports","day":14},{"key":"follow_up","day":24}],"roll":"next"}', problem: "label" },
  { id: "r29_label_nel", json: '{"parts":[{"key":"check_in","label":"\\u0085","day":4},{"key":"reports","day":14},{"key":"follow_up","day":24}],"roll":"next"}', problem: "label" },
  { id: "r30_label_nbsp", json: '{"parts":[{"key":"check_in","label":"\\u00a0","day":4},{"key":"reports","day":14},{"key":"follow_up","day":24}],"roll":"next"}', problem: "label" },
  { id: "r31_label_zwsp_word", json: '{"parts":[{"key":"check_in","label":"\\u200bCheck","day":4},{"key":"reports","day":14},{"key":"follow_up","day":24}],"roll":"next"}', problem: null },
  { id: "r32_label_emoji_40", json: '{"parts":[{"key":"check_in","label":"' + "\\ud83d\\ude00".repeat(40) + '","day":4},{"key":"reports","day":14},{"key":"follow_up","day":24}],"roll":"next"}', problem: null },
  { id: "r33_label_emoji_41", json: '{"parts":[{"key":"check_in","label":"' + "\\ud83d\\ude00".repeat(41) + '","day":4},{"key":"reports","day":14},{"key":"follow_up","day":24}],"roll":"next"}', problem: "label" },
];

if (typeof module !== "undefined" && module.exports) {
  module.exports = { CASES: TK_RHYTHM_CASES };
}
