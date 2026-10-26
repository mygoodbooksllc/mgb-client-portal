// Plain node: `node components/tasks/TK_repeatLogic.test.js`.
// Checks the Slate Repeat menu's date math (TK_repeatLogic.js) against the
// hand-worked vectors in TK_repeat.fixtures.js. `--sql` prints the same vectors
// as SQL for supabase/repeat-menu-tests.sql / a live check.

const assert = require("assert");
const L = require("./TK_repeatLogic.js");
const F = require("./TK_repeat.fixtures.js");

function q(s) {
  return s == null ? "null" : "'" + String(s).replace(/'/g, "''") + "'";
}

if (process.argv.includes("--sql")) {
  const nextRows = F.NEXT.map((c, i) => `      ('next ${i + 1}: ${c.id.replace(/'/g, "''")}', ${q(JSON.stringify(c.rule))}::jsonb, date ${q(c.base)}, date ${q(c.today)}, ${c.expected ? "date " + q(c.expected) : "null::date"})`).join(",\n");
  const seriesRows = F.SERIES.map((c, i) => `      ('series ${i + 1}: ${c.id.replace(/'/g, "''")}', ${q(JSON.stringify(c.rule))}::jsonb, date ${q(c.start)}, date ${q(c.to)}, array[${c.expected.map((d) => "date " + q(d)).join(", ")}])`).join(",\n");
  const dueRows = F.DUE_AT.map((c, i) => `      ('due ${i + 1}: ${c.id}', date ${q(c.date)}, ${q(c.time)}, ${q(c.tz)}, ${q(c.expected)}::timestamptz)`).join(",\n");
  console.log("-- next\n" + nextRows + "\n\n-- series\n" + seriesRows + "\n\n-- due\n" + dueRows);
  process.exit(0);
}

let n = 0;
function eq(actual, expected, msg) {
  n++;
  assert.deepStrictEqual(actual, expected, msg);
}

F.NEXT.forEach((c) => eq(L.TK_repeatNext(c.rule, c.base, c.today, F.HOLIDAYS), c.expected, "next: " + c.id));
F.SERIES.forEach((c) => eq(L.TK_repeatSeries(c.rule, c.start, c.to, F.HOLIDAYS), c.expected, "series: " + c.id));
F.DUE_AT.forEach((c) => eq(L.TK_repeatDueAt(c.date, c.time, c.tz), c.expected, "dueAt: " + c.id));
F.TEXT.forEach((c) => eq(L.TK_repeatText(c.rule, c.start), c.expected, "text: " + c.expected));

// Holidays can be a Set too
eq(L.TK_repeatNext(F.NEXT[3].rule, "2026-11-25", "2026-11-25", new Set(F.HOLIDAYS)), "2026-11-30", "Set of holidays");
// No holidays given = weekends only
eq(L.TK_repeatNext(F.NEXT[3].rule, "2026-11-25", "2026-11-25"), "2026-11-26", "no holiday list");

// Validation
const ok = (r) => L.TK_repeatValid(r);
eq(ok({ freq: "daily" }), true, "minimal rule");
eq(ok(null), false, "null");
eq(ok([]), false, "array");
eq(ok({ freq: "weekly", dows: [0] }), false, "weekday 0");
eq(ok({ freq: "weekly", dows: [1, 2, 3, 4, 5, 6, 7, 1] }), false, "too many weekdays");
eq(ok({ freq: "monthly", by: "nth", n: 5, dow: 1 }), false, "5th weekday");
eq(ok({ freq: "monthly", by: "nth", n: -1, dow: 1 }), true, "last weekday");
eq(ok({ freq: "monthly", by: "nth", dow: 1 }), false, "nth without n");
eq(ok({ freq: "monthly", day: 32 }), false, "day 32");
eq(ok({ freq: "daily", interval: 100 }), false, "interval 100");
eq(ok({ freq: "daily", time: "24:00" }), false, "time 24:00");
eq(ok({ freq: "daily", time: "09:05" }), true, "time 09:05");
eq(ok({ freq: "daily", end: { type: "count", n: 0 } }), false, "count 0");
eq(ok({ freq: "daily", end: { type: "on", date: "2026-02-30" } }), false, "end date that is not a date");
eq(ok({ freq: "daily", end: { type: "forever" } }), false, "unknown end");
eq(ok({ freq: "daily", start: "2026-13-01" }), false, "bad start");

// Count ends are the caller's: seen vs end.n
const counted = { freq: "daily", end: { type: "count", n: 2 } };
eq(L.TK_repeatMoreToCome(counted), true, "first of two");
eq(L.TK_repeatMoreToCome(L.TK_repeatAdvance(counted)), false, "second of two");
eq(L.TK_repeatAdvance(counted).seen, 2, "advance counts");
eq(counted.seen, undefined, "advance does not change the original");
eq(L.TK_repeatMoreToCome({ freq: "daily" }), true, "never ends");

// A weekday-less weekly rule defaults to the start day
eq(L.TK_repeatDefault("weekly", "2026-10-28").dows, [3], "default weekly day");
eq(L.TK_repeatDefault("monthly", "2026-10-28").day, 28, "default monthly day");

console.log("TK_repeatLogic: " + n + " checks passed");

// review fixes: skip weekends counts from the rule's start, not the moved due date
{
  const r = { v: 1, freq: "monthly", interval: 3, by: "last", skip: true, start: "2028-06-30", end: { type: "never" } };
  const a = L.TK_repeatNext(r, "2028-06-30", "2028-06-30", []);
  const b = L.TK_repeatNext(r, a, a, []);
  const c = L.TK_repeatNext(r, b, b, []);
  assert.strictEqual(a, "2028-10-02"); // Sep 30 2028 is a Saturday
  assert.strictEqual(b, "2029-01-01"); // Dec 31 2028 is a Sunday, a quarter after Sep, not a month after Oct 2
  assert.strictEqual(c, "2029-04-02"); // Mar 31 2029 is a Saturday
  // evening time: 19:00 Chicago in summer is exactly 00:00Z, nudged one second
  assert.strictEqual(L.TK_repeatDueAt("2026-07-15", "19:00", "America/Chicago"), "2026-07-16T00:00:01.000Z");
  console.log("TK_repeatLogic: review-fix checks passed");
}
