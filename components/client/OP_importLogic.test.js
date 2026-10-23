// Plain node: `node components/client/OP_importLogic.test.js`.
// Every row and client here is INVENTED. Never paste real sheet content into
// this file (spec §7).
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const I = require("./OP_importLogic.js");

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
const TODAY = "2026-10-23";

const CLIENTS = [
  { id: "c1", name: "Acme Widget Co." },
  { id: "c2", name: "Sample Food Pantry, Inc." },
  { id: "c3", name: "Riverbend Arts Collective" },
  { id: "c4", name: "Hilltop Youth League" },
  { id: "c5", name: "Hilltop Youth League" },
  { id: "c6", name: "Northside Garden Club" },
  { id: "c7", name: "Northside Garden Society" },
  { id: "c8", name: "Lakeview Library Friends" },
];

// ---- CSV
t("parseCsv: quotes, commas and line breaks inside quotes, CRLF, BOM", () => {
  const csv = '﻿Customer Name,Email,Anniversary,Address\r\n"Acme Widget Co.",a@example.test,3/4/19,"1 Sample St, Springfield, ST 00000"\r\n"Say ""hi"" Org",,2019,"2 Line\nSpringfield ST 00000"\n\n';
  const r = I.parseCsv(csv);
  assert.deepStrictEqual(r.headers, ["Customer Name", "Email", "Anniversary", "Address"]);
  assert.strictEqual(r.rows.length, 2);
  assert.strictEqual(r.rows[0]["Address"], "1 Sample St, Springfield, ST 00000");
  assert.strictEqual(r.rows[1]["Customer Name"], 'Say "hi" Org');
  assert.strictEqual(r.rows[1]["Address"], "2 Line\nSpringfield ST 00000");
  assert.strictEqual(r.rows[1]["Email"], "");
});
t("parseCsv: empty and header-only", () => {
  assert.deepStrictEqual(I.parseCsv(""), { headers: [], rows: [] });
  assert.deepStrictEqual(I.parseCsv("A,B\n").rows, []);
  assert.strictEqual(I.parseCsv("A,B\nx").rows[0].B, "", "short rows fill with blanks");
});

// ---- Names
t("normalizeName", () => {
  assert.strictEqual(I.normalizeName("The Acme Widget Co., Inc."), "acme widget");
  assert.strictEqual(I.normalizeName("Arts & Crafts LLC"), "arts and crafts");
  assert.strictEqual(I.normalizeName("  Sam’s   Shop "), "sams shop");
  assert.strictEqual(I.normalizeName(null), "");
});
t("similarity", () => {
  assert.strictEqual(I.similarity("a b", "a b"), 1);
  assert.strictEqual(I.similarity("a", ""), 0);
  assert.ok(I.similarity("riverbend arts", "riverbend arts collective") >= 0.85, "contained");
  assert.ok(I.similarity("northside garden club", "northside garden society") < 0.8);
});

// ---- Dates
t("parseLooseDate: full dates", () => {
  assert.deepStrictEqual(I.parseLooseDate("3/4/19", TODAY), { status: "ok", iso: "2019-03-04", year: 2019, month: 3, day: 4, hint: "probably established" });
  assert.strictEqual(I.parseLooseDate("12/31/1998", TODAY).iso, "1998-12-31");
  assert.strictEqual(I.parseLooseDate("1/2/85", TODAY).iso, "1985-01-02", "two-digit years after this year are 1900s");
  assert.strictEqual(I.parseLooseDate("2025-06-01", TODAY).hint, "probably client-since");
  assert.strictEqual(I.parseLooseDate("March 5, 2019", TODAY).iso, "2019-03-05");
  assert.strictEqual(I.parseLooseDate("Sept 9th 2026", TODAY).iso, "2026-09-09");
  assert.strictEqual(I.parseLooseDate("2/29/24", TODAY).iso, "2024-02-29");
});
t("parseLooseDate: partial dates", () => {
  const p = I.parseLooseDate("06/2026", TODAY);
  assert.strictEqual(p.status, "partial");
  assert.strictEqual(p.year, 2026);
  assert.strictEqual(p.month, 6);
  assert.strictEqual(p.hint, "probably client-since");
  assert.strictEqual(I.parseLooseDate("2010", TODAY).status, "partial");
  assert.strictEqual(I.parseLooseDate("2010", TODAY).reason, "year only");
  assert.strictEqual(I.parseLooseDate("May 2001", TODAY).month, 5);
});
t("parseLooseDate: hedged dates are ambiguous but still read", () => {
  const a = I.parseLooseDate("Maybe 2015", TODAY);
  assert.strictEqual(a.status, "ambiguous");
  assert.strictEqual(a.year, 2015);
  assert.strictEqual(a.hint, "probably established");
  assert.strictEqual(I.parseLooseDate("maybe 4/1/25", TODAY).iso, "2025-04-01");
  assert.strictEqual(I.parseLooseDate("2012?", TODAY).status, "ambiguous");
  assert.strictEqual(I.parseLooseDate("Maybe", TODAY).status, "ambiguous");
  assert.strictEqual(I.parseLooseDate("Maybe", TODAY).year, undefined);
});
t("parseLooseDate: bad and empty", () => {
  assert.strictEqual(I.parseLooseDate("", TODAY).status, "empty");
  assert.strictEqual(I.parseLooseDate("soon", TODAY).status, "bad");
  assert.strictEqual(I.parseLooseDate("2/30/19", TODAY).status, "bad");
  assert.strictEqual(I.parseLooseDate("13/1/19", TODAY).status, "bad");
  assert.strictEqual(I.parseLooseDate("1/1/2027", TODAY).status, "bad", "future");
  assert.strictEqual(I.parseLooseDate("11/2026", TODAY).status, "bad", "future month");
  assert.strictEqual(I.parseLooseDate("Smarch 2019", TODAY).status, "bad");
  assert.strictEqual(I.parseLooseDate("1700", TODAY).status, "bad");
});

// ---- Addresses
t("checkAddress", () => {
  assert.deepStrictEqual(I.checkAddress("1 Sample St, Springfield, ST 00000"), { empty: false, incomplete: false, poBox: false, noZip: false, noCity: false });
  assert.strictEqual(I.checkAddress("1 Sample St\nSpringfield ST 00000-1234").incomplete, false);
  assert.strictEqual(I.checkAddress("1 Sample St, Springfield").noZip, true);
  assert.strictEqual(I.checkAddress("1 Sample St 00000").noCity, true);
  assert.strictEqual(I.checkAddress("1 Sample St, ST 00000").noCity, true);
  assert.strictEqual(I.checkAddress("").empty, true);
  assert.strictEqual(I.checkAddress("P.O. Box 12, Springfield, ST 00000").poBox, true);
  assert.strictEqual(I.checkAddress("PO Box 12, Springfield, ST 00000").poBox, true);
  assert.strictEqual(I.checkAddress("12 Boxwood Ln, Springfield, ST 00000").poBox, false);
});

// ---- Matching and buckets
const CSV = [
  "Customer Name,Email,Anniversary,Address",
  'Acme Widget Company Inc,x@example.test,3/4/19,"1 Sample St, Springfield, ST 00000"', // exact after normalize (company is a stop word)
  "Sample Food Pantry,,06/2025,\"PO Box 9, Springfield, ST 00000\"", // exact; partial date; PO box
  'Riverbend Arts,,Maybe 2010,"3 Sample Rd, Springfield"', // fuzzy; hedged; no ZIP
  'Hilltop Youth League,,2/2/2002,"4 Sample Ave, Springfield, ST 00000"', // two clients share the name
  'Northside Garden,,soon,"5 Sample Way, Springfield, ST 00000"', // two close candidates
  'Nobody Like This,,1/1/2001,', // unmatched; no address
  'acme widget co,,1/1/2001,"1 Sample St, Springfield, ST 00000"', // second row on c1
].join("\n");

t("dryRun: buckets and counts", () => {
  const r = I.dryRun(CSV, CLIENTS, { today: TODAY });
  assert.strictEqual(r.total, 7);
  assert.deepStrictEqual(r.columns, { name: "Customer Name", anniversary: "Anniversary", address: "Address" });
  const ids = (k) => r.buckets[k].map((e) => e.row);
  assert.deepStrictEqual(ids("matched"), [1, 2, 3, 7]);
  assert.deepStrictEqual(ids("ambiguousName"), [4, 5]);
  assert.deepStrictEqual(ids("unmatched"), [6]);
  assert.deepStrictEqual(ids("badDates"), [5]);
  assert.deepStrictEqual(ids("ambiguousDates"), [2, 3]);
  assert.deepStrictEqual(ids("incompleteAddress"), [3, 6]);
  assert.deepStrictEqual(ids("poBox"), [2]);
  assert.strictEqual(r.buckets.matched[2].fuzzy, true);
  assert.strictEqual(r.buckets.matched[2].client.id, "c3");
  assert.deepStrictEqual(r.buckets.ambiguousName[0].candidates.map((c) => c.id), ["c4", "c5"]);
  assert.deepStrictEqual(r.buckets.ambiguousName[1].candidates.map((c) => c.id).sort(), ["c6", "c7"]);
  assert.strictEqual(r.counts.duplicateClients, 1);
  assert.strictEqual(r.buckets.matched[0].duplicate, true);
  assert.strictEqual(r.counts.matched + r.counts.unmatched + r.counts.ambiguousName, r.total, "name buckets split every row once");
  assert.strictEqual(r.counts.hintClientSince, 1);
});
t("matchClients: no clients, no rows, bad input", () => {
  assert.strictEqual(I.matchClients([], CLIENTS).total, 0);
  const r = I.matchClients([{ "Customer Name": "Acme Widget Co." }], []);
  assert.strictEqual(r.counts.unmatched, 1);
  assert.strictEqual(r.counts.badDates, 1, "no Anniversary column means no date");
  assert.doesNotThrow(() => I.matchClients(null, null));
});
t("countsReport prints numbers only, never names, emails or addresses", () => {
  const r = I.dryRun(CSV, CLIENTS, { today: TODAY });
  const out = I.countsReport(r);
  assert.ok(/Rows: 7/.test(out));
  assert.ok(/Matched: 4/.test(out));
  assert.ok(!/Acme|Pantry|Riverbend|Hilltop|Northside|Nobody|example\.test|Sample St|Box 9/i.test(out));
});

// ---- The CLI agrees and stays counts-only
t("CLI script prints counts only", () => {
  const { execFileSync } = require("child_process");
  const os = require("os");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "opi-"));
  const csvPath = path.join(dir, "rows.csv");
  const cliPath = path.join(dir, "clients.json");
  fs.writeFileSync(csvPath, CSV);
  fs.writeFileSync(cliPath, JSON.stringify(CLIENTS));
  try {
    const out = execFileSync(process.execPath, [path.join(__dirname, "../../scripts/op-import-dry-run.js"), csvPath, cliPath, "--today", TODAY], { encoding: "utf8" });
    assert.ok(/Rows: 7/.test(out));
    assert.ok(/Matched: 4/.test(out));
    assert.ok(!/Acme|Pantry|Riverbend|Hilltop|Northside|Nobody|example\.test|Sample St/i.test(out));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

console.log("OP_importLogic: " + n + " checks passed");
