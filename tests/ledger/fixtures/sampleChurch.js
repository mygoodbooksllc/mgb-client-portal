// The prototype's "Try a sample" ledger (gl-review.html sampleRows), ported
// verbatim so the counts match the prototype README. Returns spreadsheet rows
// (a QuickBooks General Ledger export with section headers, Beginning Balance
// and Total rows). Dates are built and printed with local getters, so the
// MM/DD/YYYY strings are the same in every time zone.
"use strict";

function groupBy(a, f) { const m = new Map(); for (const x of a) { const k = f(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return m; }
const fdate = (d) => `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;

function sampleRows() {
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const T = []; const add = (d, type, num, name, memo, acct, split, amt) => T.push({ d, type, num, name, memo, acct, split, amt });
  const CK = "1010 Operating Checking"; let ck = 2201;
  for (let m = 0; m < 9; m++) {
    for (let w = 0; w < 4; w++) {
      const d = new Date(2026, m, 1 + w * 7 + ((7 - new Date(2026, m, 1).getDay()) % 7)); const a = Math.round(3800 + rnd() * 2400);
      add(d, "Deposit", "", "", "Sunday offering", "4010 Tithes & Offerings", CK, a); add(d, "Deposit", "", "", "Sunday offering", CK, "4010 Tithes & Offerings", a);
    }
    const pd = new Date(2026, m, 15); add(pd, "Payroll Check", "", "Gusto", "Staff payroll", "6100 Salaries & Wages", CK, 9850); add(pd, "Payroll Check", "", "Gusto", "Staff payroll", CK, "6100 Salaries & Wages", -9850);
    [["Entergy", "Electric", "6510 Utilities", 420 + rnd() * 160], ["Byhalia Water Dept", "Water", "6510 Utilities", 90 + rnd() * 30], ["Lifeway", "Curriculum", "6620 Ministry Supplies", 150 + rnd() * 300], ["Brotherhood Mutual", "Property insurance", "6400 Insurance", 612]].forEach(([n, memo, ac, a], i) => {
      if (m === 8 && i === 3) return; const d = new Date(2026, m, 4 + i * 5); let num = ck++; if (m === 5 && i === 2) { ck++; num = ck++; } a = Math.round(a * 100) / 100;
      add(d, "Check", String(num), n, memo, ac, CK, a); add(d, "Check", String(num), n, memo, CK, ac, -a);
    });
    add(new Date(2026, m, 20), "Expense", "", "International Mission Board", "Monthly missions", "6800 Missions Giving", CK, 1500); add(new Date(2026, m, 20), "Expense", "", "International Mission Board", "Monthly missions", CK, "6800 Missions Giving", -1500);
  }
  // planted issues
  add(new Date(2026, 2, 9), "Expense", "", "Amazon", "", "Ask My Accountant", CK, 286.41); add(new Date(2026, 2, 9), "Expense", "", "Amazon", "", CK, "Ask My Accountant", -286.41);
  add(new Date(2026, 6, 12), "Expense", "", "", "", "Uncategorized Expense", CK, 74.18); add(new Date(2026, 6, 12), "Expense", "", "", "", CK, "Uncategorized Expense", -74.18);
  { const o = T.find((t) => t.name === "Entergy" && t.d.getMonth() === 4 && t.acct === CK); add(o.d, "Check", "", o.name, o.memo, "6510 Utilities", CK, -o.amt); add(o.d, "Check", "", o.name, o.memo, CK, "6510 Utilities", o.amt); }
  add(new Date(2026, 8, 13), "Expense", "", "Byhalia Hardware", "Sunday setup supplies", "6620 Ministry Supplies", CK, 640); add(new Date(2026, 8, 13), "Expense", "", "Byhalia Hardware", "Sunday setup supplies", CK, "6620 Ministry Supplies", -640);
  add(new Date(2026, 7, 23), "Expense", "", "Roof Pros LLC", "Roof repair deposit", "6520 Building Repairs", CK, 14200); add(new Date(2026, 7, 23), "Expense", "", "Roof Pros LLC", "Roof repair deposit", CK, "6520 Building Repairs", -14200);
  add(new Date(2026, 3, 30), "Journal Entry", "JE-14", "", "Reclass", "Opening Balance Equity", CK, -5000); add(new Date(2026, 3, 30), "Journal Entry", "JE-14", "", "Reclass", CK, "Opening Balance Equity", 5000);
  add(new Date(2026, 6, 18), "Expense", "", "Roof Pros LLC", "Gutter work", "6520 Building Repairs", CK, 2400); add(new Date(2026, 6, 18), "Expense", "", "Roof Pros LLC", "Gutter work", CK, "6520 Building Repairs", -2400);
  const rows = [["Grace Fellowship Church (sample)"], ["General Ledger"], ["January - September, 2026"], [],
    ["", "Transaction date", "Transaction type", "Num", "Name", "Memo/Description", "Split account", "Amount", "Balance"]];
  const open = { "1010 Operating Checking": 18500 };
  for (const [acct, list] of [...groupBy(T, (t) => t.acct)].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))) {
    rows.push([acct]); let bal = open[acct] || 0;
    if (open[acct]) rows.push(["", "", "", "", "", "Beginning Balance", "", "", bal.toFixed(2)]);
    list.sort((a, b) => a.d - b.d).forEach((t) => { bal += t.amt; rows.push(["", fdate(t.d), t.type, t.num, t.name, t.memo, t.split, t.amt.toFixed(2), bal.toFixed(2)]); });
    rows.push(["Total for " + acct, "", "", "", "", "", "", list.reduce((s, t) => s + t.amt, 0).toFixed(2), ""]);
  }
  return rows;
}

// Same rows as CSV text (for parser round-trip tests).
function sampleCsv() {
  const q = (c) => (/[",\n]/.test(String(c)) ? '"' + String(c).replace(/"/g, '""') + '"' : String(c));
  return sampleRows().map((r) => r.map(q).join(",")).join("\r\n") + "\r\n";
}

module.exports = { sampleRows, sampleCsv };
