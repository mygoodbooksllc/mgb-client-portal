// node components/tasks/TK_calendarLogic.test.js
// Slate plus Calendar view date-grid rules.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const L = require("./TK_calendarLogic.js");
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

t("parse: valid, invalid, trims a timestamp", () => {
  assert.deepStrictEqual(L.TKC_parse("2026-10-28"), { y: 2026, m: 10, d: 28 });
  assert.deepStrictEqual(L.TKC_parse("2026-10-28T09:00:00Z"), { y: 2026, m: 10, d: 28 });
  assert.strictEqual(L.TKC_parse("2026-02-30"), null);
  assert.strictEqual(L.TKC_parse(""), null);
  assert.strictEqual(L.TKC_parse(null), null);
});

t("addDays crosses month and year, leap day", () => {
  assert.strictEqual(L.TKC_addDays("2026-10-31", 1), "2026-11-01");
  assert.strictEqual(L.TKC_addDays("2026-01-01", -1), "2025-12-31");
  assert.strictEqual(L.TKC_addDays("2028-02-28", 1), "2028-02-29");
  assert.strictEqual(L.TKC_addDays("bad", 1), "");
});

t("shiftMonth wraps years both ways", () => {
  assert.deepStrictEqual(L.TKC_shiftMonth({ y: 2026, m: 12 }, 1), { y: 2027, m: 1 });
  assert.deepStrictEqual(L.TKC_shiftMonth({ y: 2026, m: 1 }, -1), { y: 2025, m: 12 });
  assert.deepStrictEqual(L.TKC_shiftMonth({ y: 2026, m: 10 }, 0), { y: 2026, m: 10 });
  assert.deepStrictEqual(L.TKC_shiftMonth({ y: 2026, m: 3 }, -15), { y: 2024, m: 12 });
});

t("monthLabel and dow headings start on Monday", () => {
  assert.strictEqual(L.TKC_monthLabel({ y: 2026, m: 10 }), "October 2026");
  assert.deepStrictEqual(L.TKC_dowLabels(), ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  assert.deepStrictEqual(L.TKC_dowLabels(0)[0], "Sun");
});

t("monthGrid October 2026 (Mon start): 5 rows, starts Sep 28, ends Nov 1", () => {
  const g = L.TKC_monthGrid({ y: 2026, m: 10 });
  assert.strictEqual(g.length, 5);
  g.forEach((r) => assert.strictEqual(r.length, 7));
  assert.strictEqual(g[0][0].date, "2026-09-28");
  assert.strictEqual(g[0][0].inMonth, false);
  assert.strictEqual(g[0][3].date, "2026-10-01");
  assert.strictEqual(g[0][3].inMonth, true);
  assert.strictEqual(g[4][6].date, "2026-11-01");
  assert.strictEqual(g[4][6].inMonth, false);
});

t("monthGrid: 4 rows when February starts on the week start, 6 rows when needed", () => {
  // Feb 2027 starts on Monday and has 28 days
  const feb = L.TKC_monthGrid({ y: 2027, m: 2 });
  assert.strictEqual(feb.length, 4);
  assert.strictEqual(feb[0][0].date, "2027-02-01");
  // Aug 2026 starts on Saturday (Mon start: lead 5) with 31 days -> 6 rows
  assert.strictEqual(L.TKC_monthGrid({ y: 2026, m: 8 }).length, 6);
  // Sunday start: Feb 2026 starts on Sunday
  const sun = L.TKC_monthGrid({ y: 2026, m: 2 }, 0);
  assert.strictEqual(sun[0][0].date, "2026-02-01");
  assert.strictEqual(sun.length, 4);
});

t("monthGrid covers every day of the month exactly once as inMonth", () => {
  for (let m = 1; m <= 12; m++) {
    const g = L.TKC_monthGrid({ y: 2026, m });
    const inM = [].concat(...g).filter((c) => c.inMonth);
    assert.strictEqual(inM.length, new Date(Date.UTC(2026, m, 0)).getUTCDate());
  }
});

t("bucket: groups by day, counts no due date, skips deleted, open before done", () => {
  const tasks = [
    { id: 1, text: "b", due_date: "2026-10-28", status: "todo" },
    { id: 2, text: "a", due_date: "2026-10-28T05:00:00Z", status: "done" },
    { id: 3, text: "a", due_date: "2026-10-28", status: "todo" },
    { id: 4, text: "none", due_date: null },
    { id: 5, text: "junk", due_date: "nope" },
    { id: 6, text: "gone", due_date: "2026-10-28", deleted_at: "2026-10-01" },
    { id: 7, text: "legacy done", due_date: "2026-10-29", done: true },
  ];
  const b = L.TKC_bucket(tasks);
  assert.strictEqual(b.noDue, 2);
  assert.deepStrictEqual(b.byDate["2026-10-28"].map((x) => x.id), [3, 1, 2]);
  assert.strictEqual(b.byDate["2026-10-29"].length, 1);
  assert.deepStrictEqual(L.TKC_bucket(null), { byDate: {}, noDue: 0 });
});

t("split: cap, and +1 more shows the chip instead", () => {
  const mk = (k) => Array.from({ length: k }, (_, i) => ({ id: i }));
  assert.deepStrictEqual(L.TKC_split(mk(3), 3), { shown: mk(3), more: 0 });
  assert.strictEqual(L.TKC_split(mk(4), 3).more, 0);
  const s = L.TKC_split(mk(7), 3);
  assert.strictEqual(s.shown.length, 3);
  assert.strictEqual(s.more, 4);
  assert.strictEqual(L.TKC_chipCap(true), 2);
  assert.strictEqual(L.TKC_chipCap(false), 3);
});

t("arrow keys move by day and week; other keys give nothing", () => {
  assert.strictEqual(L.TKC_arrow("2026-10-28", "ArrowRight"), "2026-10-29");
  assert.strictEqual(L.TKC_arrow("2026-10-28", "ArrowLeft"), "2026-10-27");
  assert.strictEqual(L.TKC_arrow("2026-10-28", "ArrowDown"), "2026-11-04");
  assert.strictEqual(L.TKC_arrow("2026-10-28", "ArrowUp"), "2026-10-21");
  assert.strictEqual(L.TKC_arrow("2026-10-28", "a"), "");
});

t("dropOK: only onto a different valid day", () => {
  assert.strictEqual(L.TKC_dropOK({ due_date: "2026-10-28" }, "2026-10-29"), true);
  assert.strictEqual(L.TKC_dropOK({ due_date: "2026-10-28T00:00:00Z" }, "2026-10-28"), false);
  assert.strictEqual(L.TKC_dropOK({ due_date: null }, "2026-10-28"), true);
  assert.strictEqual(L.TKC_dropOK(null, "2026-10-28"), false);
  assert.strictEqual(L.TKC_dropOK({}, "bad"), false);
});

t("labels", () => {
  assert.strictEqual(L.TKC_dayLabel("2026-10-28"), "Wednesday, October 28");
  assert.strictEqual(L.TKC_noDueText(0), "");
  assert.strictEqual(L.TKC_noDueText(1), "1 task has no due date");
  assert.strictEqual(L.TKC_noDueText(5), "5 tasks have no due date");
});

t("wiring: gated, loaded, no database write of its own", () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, "..", "..", p), "utf8");
  const idx = read("index.html");
  assert.ok(idx.indexOf("components/tasks/TK_calendarLogic.js") > 0);
  assert.ok(idx.indexOf("components/tasks/TK_Calendar.jsx") > 0);
  assert.ok(idx.indexOf("components/tasks/tk-calendar.css") > 0);
  const view = read("components/tasks/TK_Calendar.jsx");
  assert.ok(/TKP_on\(\)/.test(view) || /TKP_useOn\(\)/.test(view));
  assert.ok(!/supabase|\.from\(/.test(view), "the view saves through TK_vRowSave only");
  const my = read("components/tasks/TK_MyTasks.jsx");
  assert.ok(/TK_useCalendar\(/.test(my));
  const list = read("components/tasks/TK_List.jsx");
  assert.ok(/TK_useCalendar\(/.test(list));
});

console.log("TK_calendarLogic: " + n + " passed");
