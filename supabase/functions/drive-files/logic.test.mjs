// Plain node, no framework (same style as components/qbo/mapQboToClient.test.js):
//   node supabase/functions/drive-files/logic.test.mjs
// Transpiles logic.ts with the repo's esbuild, then checks the folder-path,
// doc-type and year rules, the Drive query escaping, the download-link tokens
// and the service-account JWT construction (signed with a throwaway RSA key
// generated here, then verified). It does NOT talk to Google: a real Drive
// upload can only be checked once the owner adds the secrets.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { generateKeyPairSync, createVerify } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");
const out = join(mkdtempSync(join(tmpdir(), "drive-logic-")), "logic.mjs");
const js = execFileSync(join(root, "design-system/node_modules/.bin/esbuild"), [join(here, "logic.ts"), "--format=esm", "--log-level=error"]);
writeFileSync(out, js);
const L = await import(pathToFileURL(out).href);

let n = 0;
const t = (name, fn) => Promise.resolve(fn()).then(() => n++, (e) => {
  console.error(`FAIL ${name}`);
  throw e;
});

await t("doc type from request titles", () => {
  const cases = {
    "September bank statement": "Bank statements",
    "Checking account statements Jan-Mar": "Bank statements",
    "Amex statement for August": "Credit card statements",
    "Credit card statement": "Credit card statements",
    "Mortgage statement": "Loan statements",
    "2025 W-2s": "Payroll",
    "Gusto payroll report Q3": "Payroll",
    "1099s for contractors": "Tax forms",
    "Form 990 copy": "Tax forms",
    "Receipts for the youth trip": "Receipts",
    "Unpaid invoices": "Invoices",
    "Vendor bills": "Bills",
    "Sunday giving reports": "Donations",
    "2027 budget draft": "Budgets",
    "Building lease": "Contracts",
    "Something odd": "Other",
    "": "Other",
  };
  for (const [title, want] of Object.entries(cases)) assert.equal(L.docTypeFor(title), want, title);
  assert.equal(L.docTypeFor(null), "Other");
});

await t("doc type picker values", () => {
  assert.equal(L.normalizeDocType("bank statements"), "Bank statements");
  assert.equal(L.normalizeDocType("  Receipts "), "Receipts");
  assert.equal(L.normalizeDocType("../../etc"), "Other");
  assert.equal(L.normalizeDocType(""), "Other");
  assert.ok(L.DOC_TYPES.includes("Other"));
});

await t("years", () => {
  const oct2026 = new Date("2026-10-06T15:00:00Z");
  assert.equal(L.currentYear(oct2026), 2026);
  // 1am UTC on Jan 1 is still Dec 31 in New York.
  assert.equal(L.currentYear(new Date("2027-01-01T01:00:00Z")), 2026);
  assert.equal(L.yearForRequest("2025 W-2s", oct2026), 2025);
  assert.equal(L.yearForRequest("September 2026 statement", oct2026), 2026);
  assert.equal(L.yearForRequest("September statement", oct2026), 2026);
  assert.equal(L.yearForRequest("Account 123456 statement", oct2026), 2026);
  assert.equal(L.cleanYear("2024", 2026), 2024);
  assert.equal(L.cleanYear("1999", 2026), 2026);
  assert.equal(L.cleanYear("abc", 2026), 2026);
  assert.equal(L.cleanYear(null, 2026), 2026);
});

await t("folder path", () => {
  assert.deepEqual(L.folderPath("Grace Community Church", "grace", 2026, "bank statements"), ["Grace Community Church", "2026", "Bank statements"]);
  assert.deepEqual(L.folderPath("  New\tHope  ", "new-hope", 2025, "nonsense"), ["New Hope", "2025", "Other"]);
  assert.equal(L.clientFolderName("", "abc"), "abc");
  assert.equal(L.clientFolderName("x".repeat(300), "abc").length, 200);
});

await t("drive query escaping", () => {
  assert.equal(L.driveQ("St. Mary's"), "St. Mary\\'s");
  assert.equal(L.driveQ("a\\b"), "a\\\\b");
});

await t("drive refs in old path columns", () => {
  const id = "0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d";
  assert.equal(L.driveRef(`new-hope/messages/a@b.org/drive:${id}`), id);
  assert.equal(L.driveRef(`new-hope/${id}/drive:${id}`), id);
  assert.equal(L.driveRef("new-hope/shared/123-file.pdf"), null);
  assert.equal(L.driveRef(`drive:${id}`), null);
  assert.equal(L.driveRef(null), null);
});

await t("file types and disposition", () => {
  assert.equal(L.typeOf("a.PDF", ""), "application/pdf");
  assert.equal(L.typeOf("a.bin", "application/pdf"), "application/pdf");
  assert.equal(L.typeOf("a.html", "text/html"), null);
  assert.equal(L.typeOf("a.exe", ""), null);
  assert.match(L.contentDisposition("Q3 report.pdf", "application/pdf"), /^inline; filename="Q3 report.pdf"/);
  assert.match(L.contentDisposition("book.xlsx", L.ALLOWED_TYPES.xlsx), /^attachment;/);
  assert.match(L.contentDisposition('é"x.pdf', "application/pdf"), /filename="__x.pdf"; filename\*=UTF-8''%C3%A9%22x.pdf/);
});

await t("download link tokens", async () => {
  const id = "0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d";
  const now = 1_790_000_000;
  const tok = await L.makeLinkToken(id, "secret-a", now);
  assert.equal(await L.verifyLinkToken(tok, "secret-a", now + 10), id);
  assert.equal(await L.verifyLinkToken(tok, "secret-a", now + L.LINK_TTL_SEC + 1), null, "expired");
  assert.equal(await L.verifyLinkToken(tok, "secret-b", now), null, "wrong key");
  const [p, s] = tok.split(".");
  const forged = L.b64url(JSON.stringify({ f: id, e: now + 99999 }));
  assert.equal(await L.verifyLinkToken(`${forged}.${s}`, "secret-a", now), null, "payload swapped");
  assert.equal(await L.verifyLinkToken(`${p}.${s.slice(0, -2)}AA`, "secret-a", now), null, "sig tampered");
  assert.equal(await L.verifyLinkToken("garbage", "secret-a", now), null);
});

await t("service account parsing never echoes the secret", () => {
  assert.throws(() => L.parseServiceAccount("not json SECRETVALUE"), (e) => !String(e.message).includes("SECRETVALUE"));
  assert.throws(() => L.parseServiceAccount('{"client_email":"x"}'), /private_key/);
});

await t("service account JWT (RS256) construction", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" });
  // Key files store the PEM with literal \n escapes inside JSON; both work.
  const sa = L.parseServiceAccount(JSON.stringify({ client_email: "portal@mgb.iam.gserviceaccount.com", private_key: pem }));
  const now = 1_790_000_000;
  const jwt = await L.signServiceAccountJwt(sa, now);
  const [h, c, sig] = jwt.split(".");
  const dec = (s) => JSON.parse(Buffer.from(s, "base64url").toString());
  assert.deepEqual(dec(h), { alg: "RS256", typ: "JWT" });
  assert.deepEqual(dec(c), {
    iss: "portal@mgb.iam.gserviceaccount.com",
    scope: "https://www.googleapis.com/auth/drive",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  });
  const v = createVerify("RSA-SHA256");
  v.update(`${h}.${c}`);
  assert.ok(v.verify(publicKey, Buffer.from(sig, "base64url")), "signature verifies with the public key");
  // Escaped-newline form (as pasted from some consoles).
  const sa2 = { ...sa, private_key: pem.replace(/\n/g, "\\n") };
  const jwt2 = await L.signServiceAccountJwt(sa2, now);
  const v2 = createVerify("RSA-SHA256");
  v2.update(jwt2.split(".").slice(0, 2).join("."));
  assert.ok(v2.verify(publicKey, Buffer.from(jwt2.split(".")[2], "base64url")));
});

console.log(`drive-files logic: ${n} checks passed`);
