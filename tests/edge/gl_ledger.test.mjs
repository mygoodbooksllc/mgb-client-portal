// node --test tests/edge/
// Pure helpers behind qbo-gl-review (supabase/functions/_shared/gl_ledger.ts),
// imported straight from .ts with Node's built-in type stripping (Node 22.18+ / 24).
// The key property: the server's lines and month fingerprints must match what
// the browser computes (components/ledger/GLR_parse.js + GLR_fingerprint.js).
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import * as G from "../../supabase/functions/_shared/gl_ledger.ts";
import { num, reportColumn, walkDataRows } from "../../supabase/functions/_shared/qbo_report.ts";

const require = createRequire(import.meta.url);
const P = require("../../components/ledger/GLR_parse.js");
const F = require("../../components/ledger/GLR_fingerprint.js");
const C = require("../../components/ledger/GLR_config.js");
const { ACCTS, ledger } = require("../ledger/fixtures/api.js");

// ---------------------------------------------------------------------------
// A synthetic GeneralLedger report in Intuit's JSON shape
// ---------------------------------------------------------------------------
const COLS = [
  ["tx_date", "Date"], ["txn_type", "Transaction Type"], ["doc_num", "Num"], ["name", "Name"],
  ["memo", "Memo/Description"], ["account_name", "Account"], ["split_acc", "Split"],
  ["subt_nat_amount", "Amount"], ["rbal_nat_amount", "Balance"], ["is_cleared", "Clr"],
  ["klass_name", "Class"], ["dept_name", "Location"],
];
const AMT = 7;

function columns(cols = COLS) {
  return { Column: cols.map(([k, t]) => ({ ColTitle: t, ColType: "String", MetaData: [{ Name: "ColKey", Value: k }] })) };
}
function dataRow(r, cols = COLS) {
  const v = {
    tx_date: { value: r.date, id: r.id },
    txn_type: { value: r.type, id: r.typeId },
    doc_num: { value: r.num || "" },
    name: { value: r.name || "", id: r.nameId },
    memo: { value: r.memo || "" },
    account_name: { value: r.acctCell || "" },
    split_acc: { value: r.split || "" },
    subt_nat_amount: { value: r.amt == null ? "" : String(r.amt) },
    rbal_nat_amount: { value: r.bal == null ? "" : String(r.bal) },
    is_cleared: { value: r.clr || "" },
    klass_name: { value: r.cls || "" },
    dept_name: { value: r.loc || "" },
  };
  return { type: "Data", ColData: cols.map(([k]) => {
    const c = { ...v[k] };
    if (c.id === undefined) delete c.id;
    return c;
  }) };
}
function section(name, id, rows, total, cols = COLS) {
  const cents = rows.reduce((s, r) => {
    if (r.Rows) return s + Math.round(num(r.Summary.ColData[AMT].value) * 100);
    const a = r.ColData[AMT]?.value;
    return s + Math.round(num(a) * 100);
  }, 0);
  const sum = cols.map(() => ({ value: "" }));
  sum[0] = { value: `Total for ${name}` };
  sum[AMT] = { value: total != null ? String(total) : (cents / 100).toFixed(2) };
  return {
    type: "Section",
    Header: { ColData: [{ value: name, id }, ...cols.slice(1).map(() => ({ value: "" }))] },
    Rows: { Row: rows },
    Summary: { ColData: sum },
  };
}
function beginning(bal, cols = COLS) {
  const cd = cols.map(() => ({ value: "" }));
  cd[0] = { value: "Beginning Balance" };
  cd[8] = { value: String(bal) };
  return { type: "Data", ColData: cd };
}
function report(sectionsArr, opts = {}) {
  return {
    Header: { ReportName: "GeneralLedger", Option: opts.options || [{ Name: "NoReportData", Value: "false" }] },
    Columns: columns(opts.cols),
    Rows: { Row: sectionsArr },
  };
}

function sampleReport() {
  return report([
    section("1010 Operating Checking", "35", [
      beginning("1000.00"),
      dataRow({ date: "2026-09-02", type: "Expense", id: "501", name: "Byhalia Hardware", nameId: "77", memo: "paint", split: "6620 Ministry Supplies", amt: "-120.50", bal: "879.50", clr: "R" }),
      dataRow({ date: "2026-09-05", type: "Deposit", id: "502", name: "", memo: "Sunday offering", split: "4010 Tithes & Offerings", amt: "2,400.00", bal: "3279.50", clr: "C", cls: "General" }),
      dataRow({ date: "2026-09-07", type: "Bill Payment (Check)", id: "503", num: "1044", name: "City Water", nameId: "78", split: "2000 Accounts Payable", amt: "(88.10)", bal: "3191.40" }),
    ]),
    section("6000 Facilities", "300", [
      section("6510 Utilities", "202", [
        dataRow({ date: "2026-09-07", type: "Bill", id: "490", name: "City Water", nameId: "78", split: "2000 Accounts Payable", amt: "88.10", loc: "North" }),
      ]),
      dataRow({ date: "2026-08-30", type: "Journal Entry", name: "", memo: "no id here", amt: "15.00" }),
      dataRow({ date: "2026-08-30", type: "Journal Entry", name: "", memo: "no id here either", amt: "15.00" }),
    ]),
    section("6620 Ministry Supplies", "200", [
      dataRow({ date: "2026-09-02", type: "Expense", id: "501", name: "Byhalia Hardware", nameId: "77", memo: "paint", split: "1010 Operating Checking", amt: "120.50" }),
    ]),
    section("4010 Tithes & Offerings", "100", [
      dataRow({ date: "2026-09-05", type: "Deposit", id: "502", memo: "Sunday offering", split: "1010 Operating Checking", amt: "2400.00", cls: "General" }),
    ]),
    section("2050 Bill.com Money Out Clearing", "52", [
      dataRow({ date: "2026-09-20", type: "Transfer", id: "600", amt: "-50.00" }),
    ]),
  ]);
}

const ACCOUNTS = new Map([
  ["35", { type: "Bank", subtype: "Checking", classification: "Asset" }],
  ["202", { type: "Expense", subtype: "Utilities", classification: "Expense" }],
  ["300", { type: "Expense", subtype: null, classification: "Expense" }],
  ["200", { type: "Expense", subtype: "SuppliesMaterials", classification: "Expense" }],
  ["100", { type: "Income", subtype: "NonProfitIncome", classification: "Revenue" }],
  // "52" deliberately missing: the browser guesses its type from the name.
]);
const VENDORS = new Map([["77", true], ["78", false]]);

// ---------------------------------------------------------------------------
// Report helpers
// ---------------------------------------------------------------------------
test("num: commas, parentheses, blanks", () => {
  assert.equal(num("1,234.50"), 1234.5);
  assert.equal(num("(1,234.50)"), -1234.5);
  assert.equal(num(""), 0);
  assert.equal(num("abc"), 0);
  assert.equal(num(-3), -3);
});

test("reportColumn: by ColKey first, then title; -1 when absent", () => {
  const r = report([]);
  assert.equal(reportColumn(r, "subt_nat_amount", "amount"), 7);
  const byTitle = { Columns: { Column: [{ ColTitle: "Date" }, { ColTitle: "Amount" }] } };
  assert.equal(reportColumn(byTitle, "subt_nat_amount", "amount"), 1);
  assert.equal(reportColumn(byTitle, "is_cleared", "clr"), -1);
});

test("walkDataRows: innermost section header is the account", () => {
  const seen = [];
  walkDataRows(sampleReport().Rows.Row, (cd, sec) => seen.push(sec?.id));
  assert.deepEqual(seen, ["35", "35", "35", "35", "202", "300", "300", "200", "100", "52"]);
});

test("parseGlReport: skips Beginning Balance, keeps raw type text, account from header", () => {
  const { rows, cols } = G.parseGlReport(sampleReport());
  assert.equal(cols.cleared, 9);
  assert.equal(rows.length, 9);
  const bp = rows.find((r) => r.qbo_id === "503");
  assert.equal(bp.type, "Bill Payment (Check)");
  assert.equal(bp.amt, -88.1);
  assert.equal(bp.acct, "1010 Operating Checking");
  assert.equal(bp.acct_id, "35");
  assert.equal(bp.num, "1044");
  const util = rows.find((r) => r.qbo_id === "490");
  assert.equal(util.acct_id, "202");
  assert.equal(util.loc, "North");
  assert.equal(rows.filter((r) => r.qbo_id === null).length, 2);
});

test("sectionMismatches: totals that agree pass, a short section fails", () => {
  const ok = G.sectionMismatches(sampleReport(), AMT);
  assert.equal(ok.mismatched, 0);
  assert.ok(ok.checked >= 6);
  const bad = sampleReport();
  bad.Rows.Row[0].Rows.Row.pop(); // a row lost, Summary unchanged
  assert.equal(G.sectionMismatches(bad, AMT).mismatched, 1);
  assert.deepEqual(G.sectionMismatches(bad, -1), { checked: 0, mismatched: 0 });
});

test("reportWarning: NoReportData is not a warning; truncation wording is", () => {
  assert.equal(G.reportWarning(sampleReport()), null);
  const r = report([], { options: [{ Name: "NoReportData", Value: "false" }, { Name: "ReportWarning", Value: "Report truncated: too many rows" }] });
  assert.equal(G.reportWarning(r), "ReportWarning");
});

test("parseClearedList: key -> R / C / blank", () => {
  const cols = [["tx_date", "Date"], ["txn_type", "Transaction Type"], ["account_name", "Account"], ["is_cleared", "Clr"], ["subt_nat_amount", "Amount"]];
  const r = {
    Columns: columns(cols),
    Rows: { Row: [
      { ColData: [{ value: "2026-09-02", id: "501" }, { value: "Expense" }, { value: "1010" }, { value: "Reconciled" }, { value: "-120.50" }] },
      { ColData: [{ value: "2026-09-05", id: "502" }, { value: "Deposit" }, { value: "1010" }, { value: "C" }, { value: "2400" }] },
      { ColData: [{ value: "2026-09-07", id: "503" }, { value: "Bill Payment (Check)" }, { value: "1010" }, { value: "" }, { value: "-88.10" }] },
    ] },
  };
  const m = G.parseClearedList(r);
  assert.equal(m.get("Expense:501"), "R");
  assert.equal(m.get("Deposit:502"), "C");
  assert.equal(m.get("Bill Payment (Check):503"), "");
});

// ---------------------------------------------------------------------------
// Windows and chunks
// ---------------------------------------------------------------------------
test("resolveWindow: rolling14, ytd, custom, baseline", () => {
  const today = "2026-10-14";
  assert.deepEqual(G.resolveWindow("pull", {}, today), { kind: "rolling14", start: "2025-08-01", end: today });
  assert.deepEqual(G.resolveWindow("pull", { window: "ytd" }, today), { kind: "ytd", start: "2026-01-01", end: today });
  assert.deepEqual(G.resolveWindow("pull", { window: { start: "2026-01-01", end: "2026-03-31" } }, today),
    { kind: "custom", start: "2026-01-01", end: "2026-03-31" });
  assert.ok("error" in G.resolveWindow("pull", { window: { start: "2026-03-01", end: "2026-01-31" } }, today));
  assert.ok("error" in G.resolveWindow("pull", { window: { start: "2026-01-01", end: "2026-11-01" } }, today));
  assert.ok("error" in G.resolveWindow("pull", { window: { start: "2023-01-01", end: "2026-01-01" } }, today));
  assert.ok("error" in G.resolveWindow("pull", { window: { start: "2026-02-30", end: "2026-03-01" } }, today));
  assert.ok("error" in G.resolveWindow("pull", { window: "forever" }, today));
  assert.deepEqual(G.resolveWindow("baseline", { period: "2026-09" }, today), { kind: "baseline", start: "2026-09-01", end: "2026-09-30" });
  assert.deepEqual(G.resolveWindow("baseline", { period: "2026-10-01" }, today), { kind: "baseline", start: "2026-10-01", end: today });
  assert.ok("error" in G.resolveWindow("baseline", { period: "2026-11" }, today));
  assert.ok("error" in G.resolveWindow("baseline", { period: "Sept" }, today));
});

test("quarterChunks / halveChunk / coveredMonths", () => {
  assert.deepEqual(G.quarterChunks("2025-08-01", "2026-10-14"), [
    { start: "2025-08-01", end: "2025-09-30" },
    { start: "2025-10-01", end: "2025-12-31" },
    { start: "2026-01-01", end: "2026-03-31" },
    { start: "2026-04-01", end: "2026-06-30" },
    { start: "2026-07-01", end: "2026-09-30" },
    { start: "2026-10-01", end: "2026-10-14" },
  ]);
  assert.deepEqual(G.quarterChunks("2026-09-01", "2026-09-30"), [{ start: "2026-09-01", end: "2026-09-30" }]);
  assert.deepEqual(G.halveChunk({ start: "2026-01-01", end: "2026-03-31" }), [
    { start: "2026-01-01", end: "2026-02-14" }, { start: "2026-02-15", end: "2026-03-31" },
  ]);
  assert.deepEqual(G.halveChunk({ start: "2026-01-01", end: "2026-01-02" }), [
    { start: "2026-01-01", end: "2026-01-01" }, { start: "2026-01-02", end: "2026-01-02" },
  ]);
  assert.equal(G.halveChunk({ start: "2026-01-01", end: "2026-01-01" }), null);
  const cm = G.coveredMonths({ start: "2025-08-01", end: "2026-10-14" }, "2026-10-14");
  assert.equal(cm.length, 15);
  assert.equal(cm[0], "2025-08");
  assert.equal(cm.at(-1), "2026-10");
  assert.deepEqual(G.coveredMonths({ start: "2026-01-15", end: "2026-03-10" }, "2026-10-14"), ["2026-02"]);
});

// ---------------------------------------------------------------------------
// Lines: shape the browser reads
// ---------------------------------------------------------------------------
function serverLines(clearedByKey = null) {
  return G.buildLines(G.parseGlReport(sampleReport()).rows, ACCOUNTS, VENDORS, clearedByKey);
}

test("buildLines: keys, line ids, types, 1099, deterministic order", () => {
  const lines = serverLines();
  assert.equal(lines.length, 9);
  const bp = lines.find((l) => l.key === "Bill Payment (Check):503");
  assert.ok(bp);
  assert.equal(bp.line, "Bill Payment (Check):503:35:1");
  assert.equal(bp.acct_type, "Bank");
  assert.equal(bp.classification, "Asset");
  assert.equal(bp.v1099, false);
  const exp = lines.filter((l) => l.key === "Expense:501");
  assert.equal(exp.length, 2);
  assert.ok(exp.every((l) => l.v1099 === true));
  const syn = lines.filter((l) => l.key.startsWith("syn:"));
  assert.deepEqual(syn.map((l) => l.key).sort(), ["syn:2026-08-30:Journal Entry::300:1500:1", "syn:2026-08-30:Journal Entry::300:1500:2"]);
  const unknown = lines.find((l) => l.acct_id === "52");
  assert.equal(unknown.acct_type, null);
  assert.equal(unknown.classification, null);
  // Same input in another order -> identical output (seq aside: it records
  // the input order on purpose).
  const noSeq = (ls) => ls.map(({ seq, ...rest }) => rest);
  const rev = G.buildLines(G.parseGlReport(sampleReport()).rows.reverse(), ACCOUNTS, VENDORS);
  assert.deepEqual(noSeq(rev), noSeq(lines));
});

test("buildLines: seq is each row's position in Intuit's original order", () => {
  const raw = G.parseGlReport(sampleReport()).rows;
  const lines = G.buildLines(raw, ACCOUNTS, VENDORS);
  assert.deepEqual(lines.map((l) => l.seq).sort((a, b) => a - b), raw.map((_, i) => i));
  for (const l of lines) {
    const r = raw[l.seq];
    assert.equal(r.date, l.date);
    assert.equal(r.acct_id, l.acct_id);
    assert.equal(r.amt, l.amt);
    assert.equal(r.memo, l.memo);
  }
  // Sorting by seq gives back the report's own order.
  const back = lines.slice().sort((a, b) => a.seq - b.seq);
  assert.deepEqual(back.map((l) => [l.date, l.acct_id, l.amt]), raw.map((r) => [r.date, r.acct_id, r.amt]));
});

test("buildLines: vendor 1099 joins only where the name can be a vendor", () => {
  const raw = [
    { qbo_id: "1", date: "2026-09-01", type: "Invoice", num: "", name: "Same Id Customer", name_id: "77", memo: "", split: "", amt: 10, bal: null, acct_id: "100", acct: "", cls: "", loc: "", cleared: "" },
    { qbo_id: "2", date: "2026-09-01", type: "Payment", num: "", name: "Same Id Customer", name_id: "77", memo: "", split: "", amt: 10, bal: null, acct_id: "35", acct: "", cls: "", loc: "", cleared: "" },
    { qbo_id: "3", date: "2026-09-01", type: "Paycheck", num: "", name: "An Employee", name_id: "78", memo: "", split: "", amt: -10, bal: null, acct_id: "35", acct: "", cls: "", loc: "", cleared: "" },
    { qbo_id: "4", date: "2026-09-01", type: "Bill", num: "", name: "Vendor", name_id: "77", memo: "", split: "", amt: 10, bal: null, acct_id: "200", acct: "", cls: "", loc: "", cleared: "" },
    { qbo_id: "5", date: "2026-09-01", type: "Check", num: "", name: "Vendor", name_id: "78", memo: "", split: "", amt: -10, bal: null, acct_id: "35", acct: "", cls: "", loc: "", cleared: "" },
  ];
  const by = new Map(G.buildLines(raw, ACCOUNTS, VENDORS).map((l) => [l.type, l]));
  assert.equal(by.get("Invoice").v1099, null);
  assert.equal(by.get("Payment").v1099, null);
  assert.equal(by.get("Paycheck").v1099, null);
  assert.equal(by.get("Bill").v1099, VENDORS.get("77"));
  assert.equal(by.get("Check").v1099, VENDORS.get("78"));
  assert.equal(G.nameMayBeVendor("Bill Payment (Check)"), true);
  assert.equal(G.nameMayBeVendor("Sales Receipt"), false);
  assert.equal(G.nameMayBeVendor("Expense"), true);
});

test("buildLines: cleared fallback applies to bank and card lines only", () => {
  const m = new Map([["Expense:501", "R"], ["Deposit:502", "C"], ["Bill:490", "R"]]);
  const lines = serverLines(m);
  assert.equal(lines.find((l) => l.key === "Expense:501" && l.acct_id === "35").cleared, "R");
  assert.equal(lines.find((l) => l.key === "Expense:501" && l.acct_id === "200").cleared, "");
  assert.equal(lines.find((l) => l.key === "Bill Payment (Check):503").cleared, ""); // not in the list
  assert.equal(lines.find((l) => l.key === "Bill:490").cleared, ""); // expense account
});

test("GLR_parse.normalizeApiLines reads every server field unchanged", () => {
  const lines = serverLines();
  const b = P.normalizeApiLines(lines);
  assert.equal(b.length, lines.length);
  lines.forEach((s, i) => {
    const x = b[i];
    for (const f of ["key", "line", "date", "type", "num", "name", "name_id", "memo", "split", "amt", "bal", "acct", "acct_id", "cls", "loc", "cleared", "v1099"]) {
      assert.deepEqual(x[f], s[f], `${f} of ${s.line}`);
    }
    if (s.acct_type) {
      assert.equal(x.acct_type, s.acct_type);
      assert.equal(x.classification, s.classification);
    } else {
      assert.equal(x.acct_type, G.guessAccountType(s.acct).type);
    }
    assert.equal(x.askable, !s.key.startsWith("syn:"));
  });
  const fromPull = P.fromPull({ status: "ok", basis: "Accrual", pulled_at: "2026-10-14T15:00:00Z", window: { kind: "rolling14", start: "2025-08-01", end: "2026-10-14" }, lines, cleared_available: true, class_tracking: true, location_tracking: true });
  assert.equal(fromPull.lines.length, lines.length);
});

// ---------------------------------------------------------------------------
// Fingerprints: byte-for-byte parity with GLR_fingerprint.js
// ---------------------------------------------------------------------------
async function assertPrintParity(serverInput, label) {
  const browser = P.normalizeApiLines(serverInput);
  const want = await F.monthPrints(browser, { basis: "Accrual" });
  const got = await G.monthPrints(serverInput, "Accrual");
  assert.deepEqual(got, want, label);
  for (const p of want) {
    assert.deepEqual(G.baselineLines(serverInput, p.ym), F.baselineLines(browser, p.ym), `${label} baseline ${p.ym}`);
  }
  // line strings, line by line
  serverInput.forEach((l, i) => assert.equal(G.lineString(l), F.lineString(browser[i]), `${label} line ${i}`));
}

test("monthPrints: server-built lines match the browser exactly (incl. a guessed account type)", async () => {
  const lines = serverLines();
  await assertPrintParity(lines, "synthetic");
  const sep = (await G.monthPrints(lines, "Accrual")).find((p) => p.ym === "2026-09");
  // 1010: -120.50 (credit), +2400 (debit), -88.10 (credit); 6510 +88.10 debit; 6620 +120.50 debit;
  // 4010 +2400 (Revenue, credit); 2050 -50 guessed Credit Card -> Liability -> debit.
  assert.equal(sep.debit_cents, 240000 + 8810 + 12050 + 5000);
  assert.equal(sep.credit_cents, 12050 + 8810 + 240000);
  assert.equal(sep.line_count, 7);
});

test("monthPrints: fixture ledgers (tests/ledger/fixtures/api.js) match too", async () => {
  const L = ledger();
  L.pay("2026-08-03", "Byhalia Hardware", "paint", ACCTS.SUP, 640);
  L.pay("2026-08-09", "City Water", "", ACCTS.UTIL, 88.1, ACCTS.CARD);
  L.txn("2026-09-01", "Deposit", "", "offering", [[ACCTS.CK, 2400, { cleared: "R" }], [ACCTS.TITHE, -2400]], { cls: "General" });
  L.txn("2026-09-15", "Journal Entry", "", "opening", [[ACCTS.OBE, -10], [ACCTS.SAV, 10]], { loc: "North" });
  L.txn("2026-09-30", "Check", "First Bank", "loan pmt", [[ACCTS.LOAN, 500], [ACCTS.INT, 41.37], [ACCTS.CK, -541.37]], { num: "1201" });
  L.pay("2026-09-30", "Pipe | Co\nLtd", "weird|name", ACCTS.AMA, 0.005);
  await assertPrintParity(L.raw, "fixture");
});

test("monthPrints: a listed month with no lines gets the empty print", async () => {
  const [p] = await G.monthPrints([], "Cash", ["2026-07"]);
  assert.equal(p.period, "2026-07-01");
  assert.equal(p.line_count, 0);
  assert.equal(p.debit_total, 0);
  assert.equal(p.hash, await G.sha256Hex(""));
  assert.equal(p.basis, "Cash");
});

test("account types: guessAccountType / normalizeAccountType / classificationOf match GLR_config", () => {
  const names = [
    "1010 Operating Checking", "1020 Savings", "1200 Undeposited Funds", "1300 Prepaid Insurance", "1500 Equipment",
    "1510 Accumulated Depreciation", "2000 Accounts Payable", "2050 Bill.com Money Out Clearing", "2100 Church Visa",
    "2200 Payroll Liabilities", "2700 Building Loan", "Note Payable - First Bank", "3000 Opening Balance Equity",
    "3900 Retained Earnings", "Net Assets", "4010 Tithes & Offerings", "Interest Income", "6900 Interest Expense",
    "Bank Service Charges", "Ask My Accountant", "Uncategorized Expense", "Uncategorized Asset", "Petty Cash",
    "Money Market", "Divvy", "Ramp Card", "American Express", "Owner's Draw", "Sales", "Tuition", "Grant Revenue",
    "Vehicles", "Furniture and Fixtures", "Inventory", "Accounts Receivable (A/R)", "Sales Tax Payable", "Accrued Wages",
    "Line of Credit", "", "(no account)", "5000 Cost of Goods Sold", "9000 Other Expense", "1100-1 Checking sub",
    "Expense Reimbursement Clearing", "Operating Income Account",
  ];
  for (const n of names) assert.deepEqual(G.guessAccountType(n), C.guessAccountType(n), n);
  const types = ["Bank", "bank", "Credit Card", "CreditCard", "Other Current Asset", "OtherCurrentAsset", "Fixed Asset",
    "Accounts Receivable", "Accounts Payable", "Other Current Liability", "Long Term Liability", "Equity", "Income",
    "Other Income", "Expense", "Other Expense", "Cost of Goods Sold", "Other Asset", "Nonsense", "", null];
  for (const t of types) {
    assert.equal(G.normalizeAccountType(t), C.normalizeAccountType(t), `normalize ${t}`);
    assert.equal(G.classificationOf(t), C.classificationOf(t), `classification ${t}`);
  }
  for (const v of [0, 0.005, -0.005, 1.005, -88.1, 2400, "12.345", null]) assert.equal(G.toCents(v), C.toCents(v), `cents ${v}`);
});
