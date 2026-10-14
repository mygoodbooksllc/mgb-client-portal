// node --test tests/ledger
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../../components/ledger/GLR_parse.js");
const { sampleRows, sampleCsv } = require("./fixtures/sampleChurch.js");

const HEAD = ["", "Transaction date", "Transaction type", "Num", "Name", "Memo/Description", "Split account", "Amount", "Balance"];

test("num handles QuickBooks number formats", () => {
  assert.equal(P.num("1,234.56"), 1234.56);
  assert.equal(P.num("(1,234.56)"), -1234.56);
  assert.equal(P.num("-1,234.56"), -1234.56);
  assert.equal(P.num("1234.56-"), -1234.56);
  assert.equal(P.num("$1,234.56"), 1234.56);
  assert.equal(P.num("$-12.00"), -12);
  assert.equal(P.num(""), 0);
  assert.equal(P.num(42.5), 42.5);
});

test("parseDate: US dates, ISO, Excel serials, Date objects", () => {
  assert.equal(P.parseDate("09/13/2026"), "2026-09-13");
  assert.equal(P.parseDate("9/3/26"), "2026-09-03");
  assert.equal(P.parseDate("2026-09-13"), "2026-09-13");
  assert.equal(P.parseDate("2026-09-13T00:00:00Z"), "2026-09-13");
  assert.equal(P.parseDate(45658), "2025-01-01");
  assert.equal(P.parseDate("45658"), "2025-01-01");
  assert.equal(P.parseDate(new Date(2026, 8, 13)), "2026-09-13");
  assert.equal(P.parseDate("02/30/2026"), null);
  assert.equal(P.parseDate("Total for Checking"), null);
  assert.equal(P.parseDate(123), null);
});

test("parseCsv: quotes, escaped quotes, embedded newlines, CRLF and BOM", () => {
  const text = "﻿a,b,c\r\n\"x, y\",\"say \"\"hi\"\"\",\"two\nlines\"\r\n1,,3\n";
  assert.deepEqual(P.parseCsv(text), [["a", "b", "c"], ["x, y", 'say "hi"', "two\nlines"], ["1", "", "3"]]);
  assert.deepEqual(P.parseCsv("a,b"), [["a", "b"]]);
});

test("sample ledger: 192 lines from rows and from CSV text, skipping Beginning Balance and Total rows", () => {
  const a = P.parseGL(sampleRows());
  const b = P.parseGL(P.parseCsv(sampleCsv()));
  assert.equal(a.lines.length, 192);
  assert.equal(b.lines.length, 192);
  assert.equal(a.company, "Grace Fellowship Church (sample)");
  assert.equal(a.period, "January - September, 2026");
  assert.deepEqual(a.lines.map((l) => l.key), b.lines.map((l) => l.key));
  assert.ok(!a.lines.some((l) => /beginning balance/i.test(l.memo)));
  const ck = a.lines.filter((l) => l.acct === "1010 Operating Checking");
  assert.equal(ck.length, 96);
  assert.equal(ck[0].acct_type, "Bank");
  assert.equal(a.cleared_available, false);
  // the two sides of one transaction share a key
  const hw = a.lines.filter((l) => l.name === "Byhalia Hardware");
  assert.equal(hw.length, 2);
  assert.equal(hw[0].key, hw[1].key);
  assert.notEqual(hw[0].line, hw[1].line);
});

test("Debit and Credit columns instead of Amount", () => {
  const rows = [
    ["Acme Co"], ["General Ledger"],
    ["Date", "Transaction Type", "Num", "Name", "Memo", "Split", "Debit", "Credit", "Balance"],
    ["Checking"],
    ["01/05/2026", "Deposit", "", "", "Offering", "Tithes", "1,000.00", "", "1,000.00"],
    ["01/06/2026", "Check", "101", "Vendor", "Supplies", "Supplies", "", "250.00", "750.00"],
    ["Total for Checking", "", "", "", "", "", "1,000.00", "250.00", ""],
  ];
  const g = P.parseGL(rows);
  assert.deepEqual(g.lines.map((l) => l.amt), [1000, -250]);
  assert.deepEqual(g.lines.map((l) => l.cents), [100000, -25000]);
  assert.equal(g.lines[1].bal, 750);
});

test("per-row Account column, (1,234.56) negatives, class, location and cleared columns", () => {
  const rows = [
    ["Date", "Type", "No.", "Name", "Memo/Description", "Account", "Class", "Location", "Clr", "Amount"],
    ["03/01/2026", "Check", "5001", "Roof Pros", "Repair", "6520 Building Repairs", "Building Fund", "Main", "", "1,234.56"],
    ["03/01/2026", "Check", "5001", "Roof Pros", "Repair", "1010 Checking", "Building Fund", "Main", "R", "(1,234.56)"],
    ["03/02/2026", "Deposit", "", "", "Offering", "1010 Checking", "", "", "C", "500.00"],
  ];
  const g = P.parseGL(rows);
  assert.equal(g.lines.length, 3);
  assert.deepEqual(g.lines.map((l) => l.acct), ["6520 Building Repairs", "1010 Checking", "1010 Checking"]);
  assert.equal(g.lines[1].amt, -1234.56);
  assert.deepEqual(g.lines.map((l) => l.cleared), ["", "R", "C"]);
  assert.equal(g.cleared_available, true);
  assert.equal(g.class_tracking, true);
  assert.equal(g.location_tracking, true);
  assert.equal(g.lines[0].cls, "Building Fund");
  assert.equal(g.lines[0].loc, "Main");
  assert.equal(g.lines[0].acct_type, "Expense");
  assert.equal(g.lines[1].acct_type, "Bank");
});

test("Excel serial dates, footer timestamp and basis rows", () => {
  const rows = [
    ["", "Date", "Transaction type", "Num", "Name", "Memo", "Split", "Amount"],
    ["Checking (2)"],
    ["", 45658, "Deposit", "", "", "Offering", "Tithes", 100],
    ["", "45659", "Deposit", "", "", "Offering", "Tithes", "200.00"],
    ["", "", "", "", "", "", "", ""],
    ["Cash Basis Tuesday, October 13, 2026 09:15 AM GMT-05:00"],
  ];
  const g = P.parseGL(rows);
  assert.equal(g.lines.length, 2);
  assert.deepEqual(g.lines.map((l) => l.date), ["2025-01-01", "2025-01-02"]);
  assert.equal(g.lines[0].acct, "Checking"); // " (2)" count stripped
  assert.equal(g.basis, "cash");
});

test("dated rows with no amount are skipped", () => {
  const rows = [HEAD, ["Checking"], ["", "01/02/2026", "Deposit", "", "", "x", "Tithes", "", ""], ["", "01/03/2026", "Deposit", "", "", "y", "Tithes", "5.00", ""]];
  assert.equal(P.parseGL(rows).lines.length, 1);
});

test("missing header and no transactions give plain-language errors", () => {
  assert.throws(() => P.parseGL([["Hello"], ["a", "b"]]), /Couldn't find the column headers/);
  assert.throws(() => P.parseGL([HEAD, ["Checking"], ["Total for Checking"]]), /no dated transactions/);
});

test("identical transactions on the same day keep separate keys", () => {
  const rows = [HEAD, ["Checking"],
    ["", "01/02/2026", "Expense", "", "Shell", "Fuel", "Auto", "-40.00", ""],
    ["", "01/02/2026", "Expense", "", "Shell", "Fuel", "Auto", "-40.00", ""],
    ["Auto"],
    ["", "01/02/2026", "Expense", "", "Shell", "Fuel", "Checking", "40.00", ""],
    ["", "01/02/2026", "Expense", "", "Shell", "Fuel", "Checking", "40.00", ""],
  ];
  const g = P.parseGL(rows);
  const ck = g.lines.filter((l) => l.acct === "Checking");
  const au = g.lines.filter((l) => l.acct === "Auto");
  assert.notEqual(ck[0].key, ck[1].key);
  assert.equal(ck[0].key, au[0].key);
  assert.equal(ck[1].key, au[1].key);
});

test("readFile/parseFile: XLSX through an injected SheetJS, CSV through readText", async () => {
  const rows = sampleRows();
  let readOpts = null, jsonOpts = null;
  const XLSX = {
    read(data, opts) { readOpts = opts; assert.equal(data.byteLength, 4); return { SheetNames: ["GL"], Sheets: { GL: { rows } } }; },
    utils: { sheet_to_json(ws, opts) { jsonOpts = opts; return ws.rows; } },
  };
  const x = await P.parseFile({ name: "Ledger.XLSX", size: 4 }, { XLSX, readArrayBuffer: async () => new ArrayBuffer(4) });
  assert.equal(x.kind, "xlsx");
  assert.equal(x.lines.length, 192);
  assert.equal(readOpts.cellDates, true);
  assert.equal(jsonOpts.header, 1);
  const c = await P.parseFile({ name: "gl.csv", size: 10 }, { readText: async () => sampleCsv() });
  assert.equal(c.kind, "csv");
  assert.equal(c.lines.length, 192);
  await assert.rejects(P.readFile({ name: "gl.pdf", size: 1 }), /\.csv or \.xlsx/);
  await assert.rejects(P.readFile({ name: "gl.csv", size: 26 * 1024 * 1024 }), /over 25 MB/);
  await assert.rejects(P.loadSheetJS(null), /only be read in the browser/);
});

test("loadSheetJS injects one pinned script with SRI", async () => {
  const appended = [];
  const doc = { createElement: () => ({}), head: { appendChild: (s) => { appended.push(s); setTimeout(() => s.onerror(), 0); } } };
  await assert.rejects(P.loadSheetJS(doc), /Couldn't load the Excel reader/);
  assert.equal(appended.length, 1);
  assert.match(appended[0].src, /^https:\/\/cdn\.jsdelivr\.net\/npm\/xlsx@0\.18\.5\//);
  assert.match(appended[0].integrity, /^sha384-/);
  assert.equal(appended[0].crossOrigin, "anonymous");
});

test("API lines normalize to the same shape (spec 2.6)", () => {
  const api = {
    status: "ok", pulled_at: "2026-10-14T12:00:00Z", cleared_available: true, class_tracking: true, location_tracking: false,
    lines: [
      { key: "Check:123", line: "Check:123:1", date: "2026-09-13", type: "Check", num: "2201", name: "Entergy", name_id: 55, memo: "Electric", split: "6510 Utilities", amt: -530.16, bal: 1200.5, acct: "1010 Checking", acct_id: 35, acct_type: "Bank", classification: "Asset", cls: "General", loc: "", cleared: "R", v1099: false },
      { key: "Check:123", line: "Check:123:2", date: "2026-09-13", type: "Check", num: "2201", name: "Entergy", name_id: "55", memo: "Electric", split: "1010 Checking", amt: "530.16", acct: "6510 Utilities", acct_id: "80", acct_type: "Expense" },
      { date: "2026-09-14", type: "Journal Entry", amt: 10, acct: "Misc", acct_id: "9", acct_type: "OtherCurrentAsset" },
      { date: "", amt: 5, acct: "x" },
    ],
  };
  const r = P.fromPull(api);
  assert.equal(r.source, "api");
  assert.equal(r.lines.length, 3);
  const [a, b, c] = r.lines;
  assert.equal(a.acct_id, "35");
  assert.equal(a.name_id, "55");
  assert.equal(a.cents, -53016);
  assert.equal(a.cleared, "R");
  assert.equal(a.acct_type_source, "api");
  assert.equal(a.askable, true);
  assert.equal(b.amt, 530.16);
  assert.equal(b.classification, "Expense");
  assert.equal(c.acct_type, "Other Current Asset");
  assert.match(c.key, /^syn:/);
  assert.equal(c.askable, false);
  // same keys every time for synthetic lines
  assert.equal(P.fromPull(api).lines[2].key, c.key);
  assert.throws(() => P.fromPull({ status: "error", error: "QuickBooks is busy. Try again in a minute." }), /QuickBooks is busy/);
  // file and API lines expose the same fields
  const fileLine = P.parseGL(sampleRows()).lines[0];
  assert.deepEqual(Object.keys(a).sort(), Object.keys(fileLine).sort());
});
