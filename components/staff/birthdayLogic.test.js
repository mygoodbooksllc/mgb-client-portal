// Plain node, no framework: `node components/staff/birthdayLogic.test.js`.
// Guards the month-and-day-only birthday rules (owner request 2026-10-27).
const assert = require("assert");
const L = require("./birthdayLogic.js");
const fs = require("fs");
const path = require("path");

// parse ignores the year
assert.deepStrictEqual(L.BDAY_parse("1992-04-02"), { month: 4, day: 2 });
assert.deepStrictEqual(L.BDAY_parse("1904-02-29"), { month: 2, day: 29 });
assert.deepStrictEqual(L.BDAY_parse("1987-04-09T00:00:00Z"), { month: 4, day: 9 });
assert.strictEqual(L.BDAY_parse(""), null);
assert.strictEqual(L.BDAY_parse(null), null);
assert.strictEqual(L.BDAY_parse(undefined), null);
assert.strictEqual(L.BDAY_parse("1992-13-01"), null);
assert.strictEqual(L.BDAY_parse("1992-04-31"), null);
assert.strictEqual(L.BDAY_parse("garbage"), null);

// month lengths (Feb allows 29)
assert.strictEqual(L.BDAY_daysIn(2), 29);
assert.strictEqual(L.BDAY_daysIn(4), 30);
assert.strictEqual(L.BDAY_daysIn(12), 31);
assert.strictEqual(L.BDAY_daysIn(0), 0);

// build: placeholder year when nothing is stored, real year kept when present
assert.strictEqual(L.BDAY_build(2, 27, null), "1904-02-27");
assert.strictEqual(L.BDAY_build("5", "7", ""), "1904-05-07");
assert.strictEqual(L.BDAY_build(2, 29, null), "1904-02-29");
assert.strictEqual(L.BDAY_build(3, 23, "1989-03-23"), "1989-03-23");
assert.strictEqual(L.BDAY_build(3, 24, "1989-03-23"), "1989-03-24");
// Feb 29 over a stored non-leap real year falls back to the placeholder leap year
assert.strictEqual(L.BDAY_build(2, 29, "1989-03-23"), "1904-02-29");
assert.strictEqual(L.BDAY_build(2, 29, "1992-03-23"), "1992-02-29");
// impossible or partial -> null
assert.strictEqual(L.BDAY_build(2, 30, null), null);
assert.strictEqual(L.BDAY_build(4, 31, null), null);
assert.strictEqual(L.BDAY_build(13, 1, null), null);
assert.strictEqual(L.BDAY_build("", 1, null), null);
assert.strictEqual(L.BDAY_build(1, "", null), null);
assert.strictEqual(L.BDAY_build(1.5, 2, null), null);

// label never contains a year, whether the year is real or the placeholder
for (const v of ["1992-04-02", "1904-04-02", "2001-04-02"]) {
  assert.strictEqual(L.BDAY_label(v), "Apr 2");
  assert.strictEqual(L.BDAY_longLabel(v), "April 2");
  assert.ok(!/\d{4}/.test(L.BDAY_label(v)) && !/\d{4}/.test(L.BDAY_longLabel(v)));
}
assert.strictEqual(L.BDAY_label(null), "");

// same day regardless of year
assert.ok(L.BDAY_sameDay("1992-04-02", "1904-04-02"));
assert.ok(!L.BDAY_sameDay("1992-04-02", "1992-04-03"));
assert.ok(!L.BDAY_sameDay(null, "1992-04-03"));

// form: both empty clears, one empty is an error, impossible is an error
assert.deepStrictEqual(L.BDAY_fromForm("", "", "1992-04-02"), { value: null, error: "" });
assert.strictEqual(L.BDAY_fromForm("4", "", null).value, undefined);
assert.ok(L.BDAY_fromForm("4", "", null).error);
assert.ok(L.BDAY_fromForm("2", "30", null).error);
assert.deepStrictEqual(L.BDAY_fromForm("6", "29", "1973-06-29"), { value: "1973-06-29", error: "" });
assert.deepStrictEqual(L.BDAY_fromForm("6", "30", null), { value: "1904-06-30", error: "" });

// No form still asks for a year: the profile and Members birthday fields must
// not use a date input (type="date" collects a year).
const root = path.join(__dirname, "..", "..");
const settings = fs.readFileSync(path.join(root, "components/settings/Settings.jsx"), "utf8");
const app = fs.readFileSync(path.join(root, "app.jsx"), "utf8");
const sField = settings.slice(settings.indexOf('<ST_Field label="Birthday"'), settings.indexOf('<ST_Field label="Start date"'));
assert.ok(sField.includes("ST_MonthDayInput") && !sField.includes("ST_DateInput"), "Settings birthday must use month/day input");
const bdCell = app.slice(app.indexOf('data-label="Birthday"'), app.indexOf('data-label="Start date"'));
assert.ok(bdCell.includes("ST_MonthDayInput") && !bdCell.includes("ST_DateInput"), "Members birthday cell must use month/day input");

console.log("birthdayLogic: all checks passed");
