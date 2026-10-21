// Shared vectors for the per-client month rhythm (Slate month rhythm, slice 5).
//
// Used by TK_rhythmClient.test.js (JS: TK_clientRhythmProblem, TK_rhythmForClient)
// and copied into supabase/slate-rhythm-5-client-override-tests.sql (SQL:
// tk_client_rhythm_problem, tk_month_rhythm_merge). The node test checks the
// SQL file carries every row with the same text, so JS and SQL agree.
//
// PROBLEM_CASES: id, the JSON text of a client override (null = no value), the
//   expected problem code (null = valid or no override).
// MERGE_CASES: id, firm JSON text (null = no usable firm value), client JSON text
//   (null = no override), expected merged JSON text (null = fail closed).

var F_DEFAULT = '{"parts":[{"key":"check_in","label":"Check in","day":4},{"key":"reports","label":"Send reports","day":14},{"key":"follow_up","label":"Follow up","day":24}],"roll":"next"}';
var F_PREV_NOLABEL = '{"parts":[{"key":"check_in","day":3},{"key":"reports","day":12},{"key":"follow_up","day":20}],"roll":"prev"}';
var C_5_15_25 = '[{"key":"check_in","day":5},{"key":"reports","day":15},{"key":"follow_up","day":25}]';

var TK_RHYTHM_CLIENT_PROBLEM_CASES = [
  { id: "cp01_none", json: null, problem: null },
  { id: "cp02_json_null", json: "null", problem: null },
  { id: "cp03_ok", json: C_5_15_25, problem: null },
  { id: "cp04_ok_labels", json: '[{"key":"check_in","label":"Start","day":1},{"key":"reports","day":2},{"key":"follow_up","day":28}]', problem: null },
  { id: "cp05_object", json: '{"parts":' + C_5_15_25 + "}", problem: "parts_missing" },
  { id: "cp06_string", json: '"5,15,25"', problem: "parts_missing" },
  { id: "cp07_two", json: '[{"key":"check_in","day":5},{"key":"reports","day":15}]', problem: "parts_count" },
  { id: "cp08_order", json: '[{"key":"reports","day":5},{"key":"check_in","day":15},{"key":"follow_up","day":25}]', problem: "part_key" },
  { id: "cp09_day_29", json: '[{"key":"check_in","day":5},{"key":"reports","day":15},{"key":"follow_up","day":29}]', problem: "part_day" },
  { id: "cp10_day_str", json: '[{"key":"check_in","day":"5"},{"key":"reports","day":15},{"key":"follow_up","day":25}]', problem: "part_day" },
  { id: "cp11_equal", json: '[{"key":"check_in","day":5},{"key":"reports","day":5},{"key":"follow_up","day":25}]', problem: "day_order" },
  { id: "cp12_label_blank", json: '[{"key":"check_in","label":" ","day":5},{"key":"reports","day":15},{"key":"follow_up","day":25}]', problem: "label" },
  { id: "cp13_empty_array", json: "[]", problem: "parts_count" },
  { id: "cp14_float_int", json: '[{"key":"check_in","day":5.0},{"key":"reports","day":15},{"key":"follow_up","day":25}]', problem: null },
];

var TK_RHYTHM_CLIENT_MERGE_CASES = [
  { id: "cm01_no_override", firm: F_DEFAULT, client: null, expect: F_DEFAULT },
  { id: "cm02_json_null", firm: F_DEFAULT, client: "null", expect: F_DEFAULT },
  {
    id: "cm03_override",
    firm: F_DEFAULT,
    client: C_5_15_25,
    expect: '{"parts":[{"key":"check_in","label":"Check in","day":5},{"key":"reports","label":"Send reports","day":15},{"key":"follow_up","label":"Follow up","day":25}],"roll":"next"}',
  },
  {
    id: "cm04_firm_roll_kept",
    firm: F_PREV_NOLABEL,
    client: C_5_15_25,
    expect: '{"parts":[{"key":"check_in","day":5},{"key":"reports","day":15},{"key":"follow_up","day":25}],"roll":"prev"}',
  },
  {
    id: "cm05_client_labels_ignored",
    firm: F_DEFAULT,
    client: '[{"key":"check_in","label":"Mine","day":2},{"key":"reports","day":9},{"key":"follow_up","day":27}]',
    expect: '{"parts":[{"key":"check_in","label":"Check in","day":2},{"key":"reports","label":"Send reports","day":9},{"key":"follow_up","label":"Follow up","day":27}],"roll":"next"}',
  },
  { id: "cm06_firm_missing", firm: null, client: C_5_15_25, expect: null },
  { id: "cm07_firm_missing_no_override", firm: null, client: null, expect: null },
  { id: "cm08_firm_invalid", firm: '{"parts":[],"roll":"next"}', client: C_5_15_25, expect: null },
  { id: "cm09_client_invalid", firm: F_DEFAULT, client: '[{"key":"check_in","day":20},{"key":"reports","day":15},{"key":"follow_up","day":25}]', expect: null },
  { id: "cm10_client_object", firm: F_DEFAULT, client: '{"parts":' + C_5_15_25 + "}", expect: null },
  {
    id: "cm11_float_day",
    firm: F_DEFAULT,
    client: '[{"key":"check_in","day":5.0},{"key":"reports","day":15},{"key":"follow_up","day":25}]',
    expect: '{"parts":[{"key":"check_in","label":"Check in","day":5},{"key":"reports","label":"Send reports","day":15},{"key":"follow_up","label":"Follow up","day":25}],"roll":"next"}',
  },
  {
    id: "cm12_same_as_firm",
    firm: F_DEFAULT,
    client: '[{"key":"check_in","day":4},{"key":"reports","day":14},{"key":"follow_up","day":24}]',
    expect: F_DEFAULT,
  },
  {
    id: "cm13_firm_extra_fields_dropped",
    firm: '{"parts":[{"key":"check_in","label":"Check in","day":4,"note":"x"},{"key":"reports","day":14},{"key":"follow_up","day":24}],"roll":"none","v":2}',
    client: C_5_15_25,
    expect: '{"parts":[{"key":"check_in","label":"Check in","day":5},{"key":"reports","day":15},{"key":"follow_up","day":25}],"roll":"none"}',
  },
];

if (typeof module !== "undefined" && module.exports) {
  module.exports = { PROBLEM_CASES: TK_RHYTHM_CLIENT_PROBLEM_CASES, MERGE_CASES: TK_RHYTHM_CLIENT_MERGE_CASES };
}
