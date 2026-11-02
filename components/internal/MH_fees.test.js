// Plain node, no framework: `node components/internal/MH_fees.test.js`.
// Guards the MGB Home S5 2027 fee change review logic (MH_fees.js): filter
// chips, sorting with blanks last, the CSV and the summary line. Amounts are
// made up.

const assert = require("assert");
const F = require("./MH_fees.js");

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

const rows = [
  { row: 5, client_name: "Beta", sheet_name: "Beta", status: "Active", now: 100, next: 140, change: 40, pct: 40, flags: ["big_move"] },
  { row: 6, client_name: "Alpha", sheet_name: "Alpha Church", status: "Active", now: 100, next: 110, change: 10, pct: 10, flags: [] },
  { row: 7, client_name: "Gamma", sheet_name: "Gamma", status: "Lost", now: 100, next: null, change: null, pct: null, next_note: "fee is blank", flags: ["missing_2027", "lost_paused"] },
  { row: 8, client_name: "Delta", sheet_name: "Delta", status: "Paused", now: null, next: 90, change: null, pct: null, now_note: "fee isn't a number (TBD)", flags: ["missing_now", "lost_paused"] },
  { row: 9, client_name: "Echo", sheet_name: "Echo", status: "Active", now: 200, next: 150, change: -50, pct: -25, flags: [] },
];

t("filters", () => {
  const names = (k) => F.MH_frFilter(rows, k).map((r) => r.client_name);
  assert.deepStrictEqual(names("all"), ["Beta", "Alpha", "Gamma", "Delta", "Echo"]);
  assert.deepStrictEqual(names("flagged"), ["Beta", "Gamma", "Delta"]);
  assert.deepStrictEqual(names("big_move"), ["Beta"]);
  assert.deepStrictEqual(names("missing_2027"), ["Gamma"]);
  assert.deepStrictEqual(names("lost_paused"), ["Gamma", "Delta"]);
  assert.deepStrictEqual(F.MH_frFilter(null, "all"), []);
  for (const f of F.MH_FR_FILTERS) if (!["all", "flagged"].includes(f.key)) assert.ok(F.MH_FR_FLAGS[f.key], f.key);
});

t("sort by name and by numbers, blanks last both ways", () => {
  assert.deepStrictEqual(F.MH_frSort(rows, "name", "asc").map((r) => r.client_name), ["Alpha", "Beta", "Delta", "Echo", "Gamma"]);
  assert.deepStrictEqual(F.MH_frSort(rows, "name", "desc").map((r) => r.client_name), ["Gamma", "Echo", "Delta", "Beta", "Alpha"]);
  assert.deepStrictEqual(F.MH_frSort(rows, "pct", "desc").map((r) => r.client_name), ["Beta", "Alpha", "Echo", "Delta", "Gamma"]);
  assert.deepStrictEqual(F.MH_frSort(rows, "pct", "asc").map((r) => r.client_name), ["Echo", "Alpha", "Beta", "Delta", "Gamma"]);
  assert.deepStrictEqual(F.MH_frSort(rows, "change", "asc").map((r) => r.client_name), ["Echo", "Alpha", "Beta", "Delta", "Gamma"]);
  // input untouched
  assert.strictEqual(rows[0].client_name, "Beta");
});

t("csv: header, numbers to cents, flag labels, notes", () => {
  const c = F.MH_frCsv(rows);
  assert.deepStrictEqual(c.header, ["Client", "Sheet name", "Sheet row", "Status", "Fee now", "Fee 2027", "Change $", "Change %", "Flags", "Note"]);
  assert.strictEqual(c.rows.length, 5);
  assert.deepStrictEqual(c.rows[0], ["Beta", "Beta", 5, "Active", "100.00", "140.00", "40.00", "40", "Moves more than 25%", ""]);
  assert.deepStrictEqual(c.rows[2].slice(4), ["100.00", "", "", "", "No 2027 fee; Lost / Paused", "2027: fee is blank"]);
  assert.deepStrictEqual(c.rows[3].slice(8), ["No current fee; Lost / Paused", "now: fee isn't a number (TBD)"]);
  assert.deepStrictEqual(c.rows[4].slice(6, 8), ["-50.00", "-25"]);
});

t("summary line", () => {
  assert.strictEqual(
    F.MH_frSummary({ matched: 5, big_move: 1, missing_2027: 1, lost_paused: 2, missing_now: 1, unmatched: 0 }),
    "5 clients · 1 move more than 25% · 1 with no 2027 fee · 2 Lost or Paused · 1 with no current fee",
  );
  assert.strictEqual(F.MH_frSummary({ matched: 1, unmatched: 3, duplicate: 2 }), "1 client · 0 move more than 25% · 0 with no 2027 fee · 0 Lost or Paused · 2 on two sheet rows · 3 sheet rows not matched (not shown)");
  assert.strictEqual(F.MH_frSummary(null), "0 clients · 0 move more than 25% · 0 with no 2027 fee · 0 Lost or Paused");
});

console.log(`MH_fees: ${n} passed`);
