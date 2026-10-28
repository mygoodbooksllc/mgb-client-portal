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

// Re-saving the Repeat menu on a task whose due date was pushed keeps the series' start
{
  const hol = ["2026-11-27"];
  // quarterly, last day, skip weekends; started 2026-10-31, Jan 31 2027 is a Sunday so the task sits on Mon Feb 1
  const q = { v: 1, freq: "monthly", interval: 3, by: "last", skip: true, start: "2026-10-31", end: { type: "never" } };
  const resavedQ = Object.assign({}, q, { skip: true }); // the menu hands back the same schedule
  const keptQ = L.TK_repeatSaveStart(q, resavedQ, "2027-02-01");
  assert.strictEqual(keptQ, "2026-10-31");
  assert.strictEqual(L.TK_repeatNext(Object.assign({}, resavedQ, { start: keptQ }), "2027-02-01", "2027-02-01", hol), "2027-04-30");
  // the old behavior (start = pushed due date) gave 2027-03-01
  assert.strictEqual(L.TK_repeatNext(Object.assign({}, resavedQ, { start: "2027-02-01" }), "2027-02-01", "2027-02-01", hol), "2027-03-01");
  // every 2 weeks on Friday, skip; Nov 27 2026 is a holiday so the task sits on Mon Nov 30
  const w = { v: 1, freq: "weekly", interval: 2, dows: [5], skip: true, start: "2026-11-13", end: { type: "never" } };
  const keptW = L.TK_repeatSaveStart(w, Object.assign({}, w), "2026-11-30");
  assert.strictEqual(keptW, "2026-11-13");
  assert.strictEqual(L.TK_repeatNext(Object.assign({}, w, { start: keptW }), "2026-11-30", "2026-11-30", hol), "2026-12-11");
  assert.strictEqual(L.TK_repeatNext(Object.assign({}, w, { start: "2026-11-30" }), "2026-11-30", "2026-11-30", hol), "2026-12-04");
  // changing the schedule (every 2 weeks -> every week, or a new weekday) takes the due date
  assert.strictEqual(L.TK_repeatSaveStart(w, Object.assign({}, w, { interval: 1 }), "2026-11-30"), "2026-11-30");
  assert.strictEqual(L.TK_repeatSaveStart(w, Object.assign({}, w, { dows: [4] }), "2026-11-30"), "2026-11-30");
  // changing only skip, time or end keeps the start
  assert.strictEqual(L.TK_repeatSaveStart(w, Object.assign({}, w, { skip: false, time: "09:00" }), "2026-11-30"), "2026-11-13");
  // first creation, and an old rule with no start, take the due date
  assert.strictEqual(L.TK_repeatSaveStart(null, w, "2026-11-30"), "2026-11-30");
  assert.strictEqual(L.TK_repeatSaveStart({ v: 1, freq: "weekly", interval: 2, dows: [5] }, w, "2026-11-30"), "2026-11-30");
  // staff moved the due date by hand to another valid occurrence: the series follows it
  assert.strictEqual(L.TK_repeatSaveStart(w, Object.assign({}, w), "2026-11-20"), "2026-11-20"); // other week
  const yr = { v: 1, freq: "yearly", interval: 1, by: "dom", day: 15, skip: false, start: "2026-03-15", end: { type: "never" } };
  assert.strictEqual(L.TK_repeatSaveStart(yr, Object.assign({}, yr), "2026-04-15"), "2026-04-15"); // yearly move
  assert.strictEqual(L.TK_repeatSaveStart(yr, Object.assign({}, yr), "2027-03-15"), "2026-03-15"); // on the series
  // month-end: a manual move off the last day re-anchors; the weekend shift keeps
  const me = { v: 1, freq: "monthly", interval: 1, by: "last", skip: true, start: "2026-10-31", end: { type: "never" } };
  assert.strictEqual(L.TK_repeatSaveStart(me, Object.assign({}, me), "2026-11-30"), "2026-10-31"); // Nov 30 is the last day
  assert.strictEqual(L.TK_repeatSaveStart(me, Object.assign({}, me), "2026-11-12"), "2026-11-12");
  assert.strictEqual(L.TK_repeatSaveStart(me, Object.assign({}, me), "2027-02-01"), "2026-10-31"); // Jan 31 Sun -> Mon Feb 1
  // nth weekday (2nd Tuesday): 2026-11-10 is on the series, 2026-11-17 is not
  const nth = { v: 1, freq: "monthly", interval: 1, by: "nth", n: 2, dow: 2, skip: false, start: "2026-10-13", end: { type: "never" } };
  assert.strictEqual(L.TK_repeatSaveStart(nth, Object.assign({}, nth), "2026-11-10"), "2026-10-13");
  assert.strictEqual(L.TK_repeatSaveStart(nth, Object.assign({}, nth), "2026-11-17"), "2026-11-17");
  // no due date: nothing to compare, keep the old start
  assert.strictEqual(L.TK_repeatSaveStart(w, Object.assign({}, w), null), "2026-11-13");
  // with a holiday list the shifted date must be exact
  assert.strictEqual(L.TK_repeatSaveStart(w, Object.assign({}, w), "2026-11-30", hol), "2026-11-13");
  assert.strictEqual(L.TK_repeatSaveStart(w, Object.assign({}, w), "2026-11-16", hol), "2026-11-16");
  console.log("TK_repeatLogic: keep-start checks passed");
}

// Re-save with the holiday list supplied (exact mode) vs the 5-day heuristic
{
  const closure = [];
  for (let d = new Date(Date.UTC(2025, 11, 24)); d <= new Date(Date.UTC(2026, 0, 1)); d.setUTCDate(d.getUTCDate() + 1)) closure.push(d.toISOString().slice(0, 10));
  // yearly on the 24th, skip weekends and holidays, firm closed Dec 24 - Jan 1: the task rolls to Mon 2026-01-05
  const y = { v: 1, freq: "yearly", interval: 1, by: "dom", day: 24, skip: true, start: "2025-12-24", end: { type: "never" } };
  const rolled = L.TK_repeatSeries(y, "2025-12-24", "2026-02-01", closure, 5)[0];
  assert.ok(rolled > "2026-01-01" && diffDaysYmd(rolled, "2025-12-24") > 5, "closure is longer than 5 days: " + rolled);
  // exact mode keeps the first date; the heuristic alone would re-anchor
  assert.strictEqual(L.TK_repeatSaveStart(y, Object.assign({}, y), rolled, closure), "2025-12-24");
  assert.strictEqual(L.TK_repeatSaveStart(y, Object.assign({}, y), rolled), rolled);
  // daily (every 2 days) skip rule
  const d = { v: 1, freq: "daily", interval: 2, skip: true, start: "2026-11-02", end: { type: "never" } };
  assert.strictEqual(L.TK_repeatSaveStart(d, Object.assign({}, d), "2026-11-04", []), "2026-11-02"); // on the every-2-days cycle
  assert.strictEqual(L.TK_repeatSaveStart(d, Object.assign({}, d), "2026-11-05", []), "2026-11-05"); // off cycle re-anchors
  assert.strictEqual(L.TK_repeatSaveStart(d, Object.assign({}, d), "2026-11-09", []), "2026-11-02"); // Sat Nov 7 shifted to Mon Nov 9
  // monthly every 3 months (interval > 1): off-cycle month re-anchors, on-cycle keeps
  const m = { v: 1, freq: "monthly", interval: 3, by: "dom", day: 10, skip: true, start: "2026-10-10", end: { type: "never" } };
  assert.strictEqual(L.TK_repeatSaveStart(m, Object.assign({}, m), "2027-01-11", ["2027-01-10"]), "2026-10-10"); // Jan 10 2027 is a Sunday
  assert.strictEqual(L.TK_repeatSaveStart(m, Object.assign({}, m), "2026-12-10", []), "2026-12-10");
  // due date before the start: not on the series, re-anchors
  assert.strictEqual(L.TK_repeatSaveStart(m, Object.assign({}, m), "2026-09-10", []), "2026-09-10");
  assert.strictEqual(L.TK_repeatSaveStart(y, Object.assign({}, y), "2025-12-01", closure), "2025-12-01");
  console.log("TK_repeatLogic: closure and holiday-list checks passed");
}
function diffDaysYmd(a, b) { return Math.round((Date.parse(a) - Date.parse(b)) / 864e5); }
