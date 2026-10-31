// Tests for the Master Data fee sync rules. Run: node supabase/functions/master-sheet-sync/logic.test.js
import assert from "node:assert/strict";
import { generateKeyPairSync, createVerify } from "node:crypto";
import {
  FEE_COLUMN,
  normName,
  parseFee,
  normStatus,
  findColumns,
  readRows,
  planSync,
  planFingerprint,
  cronHoldReason,
  parseServiceAccount,
  signServiceAccountJwt,
  jwtClaims,
  SHEETS_SCOPE,
  googleErrorMessage,
  valuesUrl,
} from "./logic.js";

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ---------------------------------------------------------------------------
test("fee column defaults to 2027 (owner decision)", () => {
  assert.equal(FEE_COLUMN, "2027");
});

test("normName lowercases and drops everything but a-z0-9", () => {
  assert.equal(normName("City House Church, Milwaukee"), "cityhousechurchmilwaukee");
  assert.equal(normName("  The Way  Bookkeeping "), "thewaybookkeeping");
  assert.equal(normName("St. Mark's (AZ)"), "stmarksaz");
  assert.equal(normName(null), "");
  assert.equal(normName("Café"), "caf"); // same as SQL master_sheet_norm()
});

test("parseFee reads money text and numbers", () => {
  assert.deepEqual(parseFee("$3,000.00"), { fee: 3000, reason: null });
  assert.deepEqual(parseFee("3000"), { fee: 3000, reason: null });
  assert.deepEqual(parseFee("$ 1,200"), { fee: 1200, reason: null });
  assert.deepEqual(parseFee(450.5), { fee: 450.5, reason: null });
  assert.deepEqual(parseFee(" 99.999 "), { fee: 100, reason: null });
  assert.equal(parseFee(1234.567).fee, 1234.57);
});

test("parseFee never gives a fee for blank, text, errors, negatives, zero or huge", () => {
  for (const v of [null, undefined, "", "   ", "-", "$ -", "TBD", "#N/A", "#REF!", "n/a", "-100", "$-100", "(100)", "($1,000.00)", 0, "0", "$0.00", -5, 250000, "150,000", "1.2.3", "3000 / mo", NaN, Infinity]) {
    const r = parseFee(v);
    assert.equal(r.fee, null, `expected no fee for ${JSON.stringify(v)}`);
    assert.ok(r.reason, `expected a reason for ${JSON.stringify(v)}`);
  }
});

test("normStatus", () => {
  assert.equal(normStatus("Active"), "active");
  assert.equal(normStatus(" ACTIVE "), "active");
  assert.equal(normStatus("Lost"), "lost");
  assert.equal(normStatus("paused"), "paused");
  assert.equal(normStatus("Gone"), "gone");
  assert.equal(normStatus(""), "blank");
  assert.equal(normStatus(null), "blank");
  assert.equal(normStatus("Onboarding"), "other");
});

const HEAD = ["Client", "Status", "C", "D", "E", "F", "Bookkeeping fee now", "Bookkeeping fee 2027"];

test("findColumns by header text, picks the configured fee column", () => {
  assert.deepEqual(findColumns(HEAD, "2027"), { client: 0, status: 1, fee: 7, feeHeader: "Bookkeeping fee 2027" });
  assert.equal(findColumns(HEAD, "now").fee, 6);
  assert.equal(findColumns([" client ", "STATUS", "bookkeeping  fee 2027"], "2027").fee, 2);
});

test("findColumns refuses a missing or duplicated header", () => {
  assert.throws(() => findColumns(["Client", "Status", "Bookkeeping fee now"], "2027"), /Bookkeeping fee 2027/);
  assert.throws(() => findColumns(["Client", "Client", "Status", "Bookkeeping fee 2027"], "2027"), /appears 2 times/);
  assert.throws(() => findColumns(HEAD, "2030"), /Unknown fee column/);
});

test("readRows skips blank names and keeps row numbers", () => {
  const { rows } = readRows([HEAD, ["A Church", "Active", "", "", "", "", "$100", "$200"], ["", "Active"], ["  ", "Active"], ["B", "Lost", "", "", "", "", "", ""]]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].rowNumber, 5);
  assert.equal(rows[0].fee, 200);
  assert.equal(rows[1].rowNumber, 8);
  assert.equal(rows[1].fee, null);
});

// ---------------------------------------------------------------------------
const row = (name, status, fee2027, feeNow = "") => [name, status, "", "", "", "", feeNow, fee2027];
const clients = [
  { id: "alpha", name: "Alpha Church" },
  { id: "beta", name: "Beta Ministries" },
  { id: "gamma", name: "Gamma Inc" },
  { id: "delta", name: "Delta Fellowship" },
  { id: "life-church", name: "Life Church" },
  { id: "the-way", name: "The Way Bookkeeping" },
  { id: "pathway", name: "Pathway Community Church" },
  { id: "testco", name: "Test Co", test_only: true },
  { id: "mgb", name: "MyGoodBooks", is_internal: true },
  { id: "twin1", name: "Twin Church" },
  { id: "twin2", name: "Twin  Church!" },
  { id: "over", name: "Override Org" },
];
const map = [
  { sheet_key: normName("Life Church Danville"), sheet_name: "Life Church Danville", client_id: "life-church", ignored: false },
  { sheet_key: normName("The Way Community Church"), sheet_name: "The Way Community Church", client_id: "the-way", ignored: false },
  { sheet_key: normName("HHCR Foundation"), sheet_name: "HHCR Foundation", client_id: null, ignored: true },
];
const fees = [
  { client_id: "alpha", monthly_fee: 500, sheet_override: false },
  { client_id: "beta", monthly_fee: "750.00", sheet_override: false },
  { client_id: "gamma", monthly_fee: 300, sheet_override: false },
  { client_id: "delta", monthly_fee: 900, sheet_override: false },
  { client_id: "over", monthly_fee: 100, sheet_override: true },
];
const values = [
  HEAD,
  row("Alpha Church", "Active", "$600.00"), // change 500 -> 600
  row("Beta Ministries", "Active", "$750.00"), // unchanged
  row("Gamma Inc", "Lost", "$999.00"), // lost: left alone
  row("Delta Fellowship", "Active", ""), // blank: never clears
  row("Life Church Danville", "Active", "$1,000"), // map -> life-church, new fee
  row("The Way Community Church", "Active", "$400"), // map -> the-way, NOT pathway
  row("Meals On Wheels of Horry County", "Active", "$300"), // unmatched
  row("HHCR Foundation", "Active", "$200"), // ignored by map
  row("Test Co", "Active", "$50"), // test_only
  row("MyGoodBooks", "Active", "$50"), // internal
  row("Twin Church", "Active", "$80"), // two portal clients normalize the same
  row("Override Org", "Active", "$5,000"), // override on
  row("Old Gone Client", "Gone", "$100"), // no portal client and gone: skipped, not unmatched
  row("Paused Pal", "Paused", "$100"),
  row("Gamma Inc", "Lost", "$999.00"), // second row for gamma, but lost: still skipped
];

test("planSync applies every rule", () => {
  const p = planSync({ values, clients, fees, map, feeColumn: "2027" });
  assert.equal(p.error, undefined);
  assert.equal(p.rowsRead, 15);

  const ch = Object.fromEntries(p.changes.map((c) => [c.client_id, c]));
  assert.deepEqual(Object.keys(ch).sort(), ["alpha", "life-church", "the-way"]);
  assert.equal(ch.alpha.from, 500);
  assert.equal(ch.alpha.to, 600);
  assert.equal(ch["life-church"].from, null);
  assert.equal(ch["life-church"].to, 1000);
  assert.ok(!p.items.some((i) => i.client_id === "pathway"), "The Way must never land on Pathway");

  assert.deepEqual(p.unchanged.map((u) => u.client_id), ["beta"]);
  assert.deepEqual(p.items.map((i) => i.client_id).sort(), ["alpha", "beta", "life-church", "the-way"]);
  assert.equal(p.items.find((i) => i.client_id === "beta").change, false);

  assert.deepEqual(p.unmatched.map((u) => u.sheet_name).sort(), ["Meals On Wheels of Horry County", "Twin Church"]);
  assert.match(p.unmatched.find((u) => u.sheet_name === "Twin Church").reason, /2 portal clients/);

  const why = (name) => p.skipped.filter((s) => s.sheet_name === name).map((s) => s.reason);
  assert.match(why("Gamma Inc")[0], /Lost/);
  assert.match(why("Delta Fellowship")[0], /blank/);
  assert.deepEqual(why("HHCR Foundation"), ["marked not a client"]);
  assert.deepEqual(why("Test Co"), ["test client"]);
  assert.deepEqual(why("MyGoodBooks"), ["internal company"]);
  assert.deepEqual(why("Override Org"), ["override on in the portal"]);
  assert.match(why("Old Gone Client")[0], /no portal client/);
  assert.match(why("Paused Pal")[0], /no portal client/);
  assert.equal(p.errors.length, 0);

  assert.deepEqual(p.counts, { rows_read: 15, updated: 3, unchanged: 1, unmatched: 2, skipped: 9, errors: 0 });
  // Lost, Gone, Paused, blank and non-numeric rows never become items.
  for (const id of ["gamma", "delta", "testco", "mgb", "over"]) assert.ok(!p.items.some((i) => i.client_id === id), id);
});

test("planSync uses the 'now' column when flipped", () => {
  const v = [HEAD, ...Array.from({ length: 5 }, (_, i) => row(`X${i}`, "Active", "$2", "$1")), row("Alpha Church", "Active", "$999", "$500")];
  const p = planSync({ values: v, clients, fees, map: [], feeColumn: "now" });
  assert.deepEqual(p.unchanged.map((u) => u.client_id), ["alpha"]);
  assert.equal(p.changes.length, 0);
});

test("two sheet rows for one client: error, nothing written for it", () => {
  const v = [...values, row("alpha church", "Active", "$700")];
  const p = planSync({ values: v, clients, fees, map, feeColumn: "2027" });
  assert.ok(!p.items.some((i) => i.client_id === "alpha"));
  assert.equal(p.errors.filter((e) => e.client_id === "alpha").length, 2);
});

test("map pointing at a deleted client is an error, never a guess", () => {
  const p = planSync({ values, clients: clients.filter((c) => c.id !== "the-way"), fees, map, feeColumn: "2027" });
  assert.ok(p.errors.some((e) => e.sheet_name === "The Way Community Church"));
  assert.ok(!p.items.some((i) => i.client_id === "pathway"));
});

test("too few rows or missing header: error, no items", () => {
  assert.match(planSync({ values: [HEAD, row("Alpha Church", "Active", "$1")], clients, fees, map }).error, /Only 1 client row/);
  assert.match(planSync({ values: [["Client", "Status"]], clients, fees, map }).error, /Couldn't find/);
  assert.match(planSync({ values: [], clients, fees, map }).error, /Couldn't find/);
});

test("fingerprint is order-independent and changes with the plan", async () => {
  const p = planSync({ values, clients, fees, map, feeColumn: "2027" });
  const f1 = await planFingerprint(p);
  const f2 = await planFingerprint({ changes: [...p.changes].reverse() });
  assert.equal(f1, f2);
  assert.match(f1, /^[0-9a-f]{64}$/);
  const f3 = await planFingerprint({ changes: p.changes.map((c) => (c.client_id === "alpha" ? { ...c, to: 601 } : c)) });
  assert.notEqual(f1, f3);
});

test("cron hold: many changes or a big swing waits for a person", () => {
  assert.equal(cronHoldReason({ changes: [{ client_name: "A", from: 100, to: 120 }] }), null);
  assert.equal(cronHoldReason({ changes: [{ client_name: "New", from: null, to: 5000 }] }), null);
  assert.match(cronHoldReason({ changes: [{ client_name: "A", from: 100, to: 200 }] }), /A: fee moves more than 50%/);
  const many = Array.from({ length: 11 }, (_, i) => ({ client_name: `C${i}`, from: 100, to: 101 }));
  assert.match(cronHoldReason({ changes: many }), /11 fee changes/);
});

// ---------------------------------------------------------------------------
test("service account JWT is RS256, read-only scope, verifies with the public key", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" });
  const sa = parseServiceAccount(JSON.stringify({ client_email: "mgb-sheets@example.iam.gserviceaccount.com", private_key: pem }));
  const jwt = await signServiceAccountJwt(sa, 1_700_000_000);
  const [h, c, s] = jwt.split(".");
  const dec = (x) => JSON.parse(Buffer.from(x, "base64url").toString("utf8"));
  assert.deepEqual(dec(h), { alg: "RS256", typ: "JWT" });
  assert.deepEqual(dec(c), jwtClaims(sa, 1_700_000_000));
  assert.equal(dec(c).scope, SHEETS_SCOPE);
  assert.match(SHEETS_SCOPE, /spreadsheets\.readonly$/);
  const v = createVerify("RSA-SHA256");
  v.update(`${h}.${c}`);
  assert.ok(v.verify(publicKey, Buffer.from(s, "base64url")));
  // a key pasted with literal \n still works
  const sa2 = parseServiceAccount(JSON.stringify({ client_email: "x@y", private_key: pem.replace(/\n/g, "\\n") }));
  assert.ok((await signServiceAccountJwt(sa2, 1)).split(".").length === 3);
});

test("parseServiceAccount errors never echo the secret", () => {
  const secret = "-----BEGIN PRIVATE KEY-----SECRETSECRET";
  for (const raw of [secret, JSON.stringify({ private_key: secret }), ""]) {
    try {
      parseServiceAccount(raw);
      assert.fail("should throw");
    } catch (e) {
      assert.ok(!String(e.message).includes("SECRET"), e.message);
    }
  }
});

test("google errors are plain words; values URL is read-only and unformatted", () => {
  assert.match(googleErrorMessage(403, "sa@x"), /Share MGB_Master_Data with sa@x as Viewer/);
  assert.match(googleErrorMessage(500), /\(500\)/);
  const u = valuesUrl();
  assert.match(u, /valueRenderOption=UNFORMATTED_VALUE/);
  assert.match(u, /Clients!A4%3AZ1000|Clients%21A4%3AZ1000/);
});

// ---------------------------------------------------------------------------
for (const [name, fn] of tests) {
  try {
    await fn();
    passed++;
  } catch (e) {
    console.error(`FAIL ${name}\n`, e);
    process.exit(1);
  }
}
console.log(`master-sheet-sync logic: ${passed}/${tests.length} passed`);
