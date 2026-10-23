// Plain node: `node components/tasks/TK_rhythmLogic.test.js`.
// Month rhythm setting (TK_rhythmLogic.js, slice 1): validation vectors shared
// with SQL, default fallback, the editor form, summary text and the gate.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const R = require("./TK_rhythmLogic.js");
const F = require("./TK_rhythm.fixtures.js");

let n = 0;
function t(name, fn) {
  try {
    fn();
  } catch (e) {
    console.error("FAIL " + name);
    throw e;
  }
  n++;
}

const SQL = fs.readFileSync(path.join(__dirname, "../../supabase/slate-rhythm-1-settings.sql"), "utf8");
const SQL_TESTS = fs.readFileSync(path.join(__dirname, "../../supabase/slate-rhythm-1-settings-tests.sql"), "utf8");
const sqlLit = (s) => "'" + String(s).replace(/'/g, "''") + "'";

t("shared vectors: JS verdicts", () => {
  F.CASES.forEach((c) => {
    assert.strictEqual(R.TK_rhythmProblem(JSON.parse(c.json)), c.problem, c.id);
  });
});

t("shared vectors: the SQL self-test carries every case with the same JSON and code", () => {
  F.CASES.forEach((c) => {
    const row = "(" + sqlLit(c.id) + ", " + sqlLit(c.json) + ", " + (c.problem === null ? "null" : sqlLit(c.problem)) + ")";
    assert.ok(SQL_TESTS.includes(row), "SQL self-test is missing or differs on " + c.id + ": " + row);
  });
});

t("SQL lists match JS: part keys, rolls, day range, label max, default", () => {
  assert.ok(SQL.includes("array['check_in', 'reports', 'follow_up']"), "part keys");
  assert.ok(SQL.includes("('next', 'prev', 'none')"), "rolls");
  assert.ok(SQL.includes("between 1 and 28"), "day range");
  assert.ok(SQL.includes("char_length(v_label) > 40"), "label max");
  const m = /tk_month_rhythm_default\(\)[\s\S]*?\$\$\s*select\s+'([^']+)'::jsonb/.exec(SQL);
  assert.ok(m, "default found in SQL");
  assert.deepStrictEqual(JSON.parse(m[1]), R.TK_RHYTHM_DEFAULT);
});

t("1b label parity: SQL blank set and code-point length match JS", () => {
  const SQL_1B = fs.readFileSync(path.join(__dirname, "../../supabase/slate-rhythm-1b-label-parity.sql"), "utf8");
  assert.ok(SQL_1B.includes("v_label ~ v_blank or char_length(v_label) > 40"), "1b label check");
  assert.ok(SQL_1B.includes("E'\\t\\n\\x0b\\f\\r '"), "1b ASCII blanks");
  assert.ok(SQL_1B.includes("U&'\\0085\\00A0\\1680\\2000-\\200B\\2028\\2029\\202F\\205F\\3000\\FEFF'"), "1b Unicode blanks");
  assert.strictEqual(R.TK_RHYTHM_BLANK_RE.source, "^[\\t\\n\\x0b\\f\\r \\u0085\\u00a0\\u1680\\u2000-\\u200b\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]*$");
  // The rest of the 1b function is the slice-1 function unchanged.
  const body = (sql) => /create or replace function public\.tk_month_rhythm_problem[\s\S]*?end \$\$;/.exec(sql)[0];
  const strip = (b) => b.replace("v_label ~ '^\\s*$'", "v_label ~ v_blank").split("\n").filter((l) => !/^\s*v_blank text :=|^\s*--/.test(l)).join("\n");
  assert.strictEqual(strip(body(SQL_1B)), strip(body(SQL)), "1b only changes the label check");
});

t("SQL problem codes all have JS text", () => {
  const codes = new Set();
  const re = /return '([a-z_]+)';/g;
  let m;
  while ((m = re.exec(SQL))) codes.add(m[1]);
  assert.ok(codes.size >= 8, "found codes");
  codes.forEach((c) => assert.ok(R.TK_RHYTHM_PROBLEM_TEXT[c], "text for " + c));
});

t("default is 4/14/24, roll next, and a fresh copy each time", () => {
  const a = R.TK_rhythmDefault();
  assert.deepStrictEqual(R.TK_rhythmDays(a), { check_in: 4, reports: 14, follow_up: 24 });
  assert.strictEqual(a.roll, "next");
  a.parts[0].day = 9;
  assert.strictEqual(R.TK_rhythmDefault().parts[0].day, 4);
  assert.strictEqual(R.TK_RHYTHM_DEFAULT.parts[0].day, 4);
  assert.ok(R.TK_rhythmValid(R.TK_RHYTHM_DEFAULT));
});

t("resolve: missing row falls back to the default", () => {
  const r = R.TK_rhythmResolve(undefined);
  assert.strictEqual(r.source, "default");
  assert.deepStrictEqual(r.rhythm, R.TK_RHYTHM_DEFAULT);
});

t("resolve: a valid firm value wins, normalized", () => {
  const r = R.TK_rhythmResolve({ parts: [{ key: "check_in", day: 3 }, { key: "reports", label: " Send reports ", day: 12 }, { key: "follow_up", day: 22, x: 1 }], roll: "prev", extra: true });
  assert.strictEqual(r.source, "firm");
  assert.deepStrictEqual(r.rhythm, {
    parts: [
      { key: "check_in", label: "Check in", day: 3 },
      { key: "reports", label: "Send reports", day: 12 },
      { key: "follow_up", label: "Follow up", day: 22 },
    ],
    roll: "prev",
  });
});

t("resolve: an invalid stored value fails closed (no rhythm), json null included", () => {
  const r = R.TK_rhythmResolve({ parts: [], roll: "next" });
  assert.strictEqual(r.source, "invalid");
  assert.strictEqual(r.rhythm, null);
  assert.strictEqual(r.problem, "parts_count");
  assert.strictEqual(R.TK_rhythmResolve(null).source, "invalid");
});

t("summary and ordinals", () => {
  assert.strictEqual(R.TK_rhythmSummary(R.TK_RHYTHM_DEFAULT), "4th, 14th, 24th · next business day");
  assert.strictEqual(R.TK_rhythmSummary({ parts: [{ key: "check_in", day: 1 }, { key: "reports", day: 2 }, { key: "follow_up", day: 23 }], roll: "none" }), "1st, 2nd, 23rd · date kept");
  assert.strictEqual(R.TK_rhythmSummary({ parts: [{ key: "check_in", day: 11 }, { key: "reports", day: 12 }, { key: "follow_up", day: 13 }], roll: "prev" }), "11th, 12th, 13th · business day before");
  assert.strictEqual(R.TK_rhythmSummary({}), "Not valid");
  assert.strictEqual(R.TK_rhythmOrdinal(21), "21st");
  assert.strictEqual(R.TK_rhythmOrdinal(22), "22nd");
});

t("form: good input builds a valid value with the default labels", () => {
  const res = R.TK_rhythmFromForm({ check_in: "5", reports: 15, follow_up: " 25 ", roll: "next" });
  assert.deepStrictEqual(res.errors, {});
  assert.ok(R.TK_rhythmValid(res.value));
  assert.deepStrictEqual(R.TK_rhythmDays(res.value), { check_in: 5, reports: 15, follow_up: 25 });
  assert.strictEqual(res.value.parts[1].label, "Send reports");
});

t("form: keeps stored labels when given", () => {
  const stored = { parts: [{ key: "check_in", label: "Kickoff", day: 4 }, { key: "reports", day: 14 }, { key: "follow_up", day: 24 }], roll: "next" };
  const res = R.TK_rhythmFromForm({ check_in: 4, reports: 14, follow_up: 24, roll: "next" }, stored);
  assert.strictEqual(res.value.parts[0].label, "Kickoff");
});

t("form: per-field errors", () => {
  let r = R.TK_rhythmFromForm({ check_in: "", reports: "29", follow_up: "4.5", roll: "next" });
  assert.strictEqual(r.value, null);
  assert.ok(r.errors.check_in && r.errors.reports && r.errors.follow_up);
  r = R.TK_rhythmFromForm({ check_in: 14, reports: 14, follow_up: 24, roll: "next" });
  assert.strictEqual(r.errors.reports, "Must be after the Check in day.");
  assert.ok(!r.errors.follow_up);
  r = R.TK_rhythmFromForm({ check_in: 4, reports: 24, follow_up: 14, roll: "next" });
  assert.strictEqual(r.errors.follow_up, "Must be after the Send reports day.");
  r = R.TK_rhythmFromForm({ check_in: 20, reports: 10, follow_up: 15, roll: "next" });
  assert.ok(r.errors.reports && r.errors.follow_up, "follow up before check in also flagged");
  r = R.TK_rhythmFromForm({ check_in: 4, reports: 14, follow_up: 24, roll: "weekend" });
  assert.ok(r.errors.roll);
  r = R.TK_rhythmFromForm({ check_in: "0", reports: "-1", follow_up: "1e1", roll: "next" });
  assert.ok(r.errors.check_in && r.errors.reports && r.errors.follow_up);
});

t("form round trip and sameness", () => {
  const f = R.TK_rhythmToForm(R.TK_RHYTHM_DEFAULT);
  assert.deepStrictEqual(f, { check_in: 4, reports: 14, follow_up: 24, roll: "next" });
  assert.deepStrictEqual(R.TK_rhythmToForm(undefined), f, "missing -> default form");
  const back = R.TK_rhythmFromForm(f).value;
  assert.ok(R.TK_rhythmSame(back, R.TK_RHYTHM_DEFAULT));
  assert.ok(!R.TK_rhythmSame(R.TK_rhythmFromForm({ check_in: 4, reports: 14, follow_up: 24, roll: "prev" }).value, R.TK_RHYTHM_DEFAULT));
  assert.ok(!R.TK_rhythmSame(null, R.TK_RHYTHM_DEFAULT));
});

t("problem text exists for every code and empty for none", () => {
  ["not_object", "parts_missing", "parts_count", "part_key", "part_day", "day_order", "label", "roll"].forEach((c) =>
    assert.ok(R.TK_rhythmProblemText(c).length > 10, c)
  );
  assert.strictEqual(R.TK_rhythmProblemText(null), "");
  Object.values(R.TK_RHYTHM_PROBLEM_TEXT).forEach((s) => {
    assert.ok(!/!/.test(s), "no exclamation marks");
    assert.ok(!/colour|\bgrey/i.test(s));
  });
});

t("gate: preview or firm switch; off by default", () => {
  assert.strictEqual(R.TK_rhythmIsOn(undefined, false), false);
  assert.strictEqual(R.TK_rhythmIsOn(false, false), false);
  assert.strictEqual(R.TK_rhythmIsOn("false", false), false);
  assert.strictEqual(R.TK_rhythmIsOn(true, false), true);
  assert.strictEqual(R.TK_rhythmIsOn("true", false), true);
  assert.strictEqual(R.TK_rhythmIsOn(1, false), true);
  assert.strictEqual(R.TK_rhythmIsOn({ on: true }, false), true);
  assert.strictEqual(R.TK_rhythmIsOn(undefined, true), true);
  assert.strictEqual(R.TK_RHYTHM_PREVIEW_KEY, "mgb_rhythm_preview");
  assert.strictEqual(R.TK_RHYTHM_SWITCH_KEY, "month_rhythm_enabled");
});

t("TK_rhythmEnabled without a browser is off and does not throw", () => {
  assert.strictEqual(R.TK_rhythmEnabled(), false);
});

t("owner-only list adds month_rhythm_enabled and keeps every live key", () => {
  const m = /create or replace function public\.tk__owner_only_key[\s\S]*?select p_key in \(([\s\S]*?)\);/.exec(SQL);
  assert.ok(m, "owner-only function in migration");
  const keys = m[1].split(",").map((s) => s.trim().replace(/'/g, ""));
  ["client_request_enabled", "client_request_pilot", "standard_set_live", "late_tasks_count_against_staff",
   "late_tasks_effective_from", "wb_enabled", "desk_app_enabled", "nav_enabled", "lato_enabled", "month_rhythm_enabled"]
    .forEach((k) => assert.ok(keys.indexOf(k) >= 0, "owner-only keeps " + k));
  assert.ok(keys.indexOf("month_rhythm") < 0, "month_rhythm itself is admin write, not owner-only");
});

t("index.html loads TK_rhythmLogic.js after TK_api.js", () => {
  const html = fs.readFileSync(path.join(__dirname, "../../index.html"), "utf8");
  const a = html.indexOf('"components/tasks/TK_api.js"');
  const b = html.indexOf('"components/tasks/TK_rhythmLogic.js"');
  assert.ok(a > 0 && b > a, "script order");
});

console.log("TK_rhythmLogic: " + n + " tests passed");
