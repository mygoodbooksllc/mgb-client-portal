// Plain node: `node components/client/basicHomeLogic.test.js`.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const L = require("./basicHomeLogic.js");

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
const f = (name, size, type, lm) => ({ name, size, type: type || "", lastModified: lm || 1 });

// ---- Agrees with the server (drive-files/logic.ts)
const server = fs.readFileSync(path.join(__dirname, "../../supabase/functions/drive-files/logic.ts"), "utf8");
t("max bytes matches the server", () => {
  assert.ok(/MAX_BYTES = 25 \* 1024 \* 1024/.test(server));
  assert.strictEqual(L.BH_MAX_BYTES, 25 * 1024 * 1024);
});
t("types match the server", () => {
  const block = server.split("ALLOWED_TYPES")[1].split("};")[0];
  const pairs = [...block.matchAll(/^\s*(\w+):\s*"([^"]+)"/gm)].map((m) => [m[1], m[2]]);
  assert.deepStrictEqual(Object.fromEntries(pairs), L.BH_TYPES);
});
t("every destination is a real Drive document type", () => {
  const block = server.split("DOC_TYPES = [")[1].split("] as const")[0];
  const types = [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  L.BH_DESTINATIONS.forEach((d) => assert.ok(types.includes(d.docType), d.docType));
  assert.ok(!L.BH_DESTINATIONS.some((d) => d.docType === "Messages"));
});
t("destinations: unique keys, Other last", () => {
  const keys = L.BH_DESTINATIONS.map((d) => d.key);
  assert.strictEqual(new Set(keys).size, keys.length);
  assert.strictEqual(L.BH_DESTINATIONS[L.BH_DESTINATIONS.length - 1].docType, "Other");
});
t("the client's DriveFiles.js list has them too", () => {
  const src = fs.readFileSync(path.join(__dirname, "../files/DriveFiles.js"), "utf8");
  L.BH_DESTINATIONS.forEach((d) => assert.ok(src.includes('"' + d.docType + '"'), d.docType));
});

// ---- Destination mapping
t("docTypeFor", () => {
  assert.strictEqual(L.BH_docTypeFor("tax"), "Tax forms");
  assert.strictEqual(L.BH_docTypeFor("bank"), "Bank statements");
  assert.strictEqual(L.BH_docTypeFor("nope"), "Other");
  assert.strictEqual(L.BH_labelFor("receipts"), "Receipts");
});

// ---- File checks
t("accepts the allowed types", () => {
  assert.strictEqual(L.BH_checkFile(f("a.pdf", 10, "application/pdf")), null);
  assert.strictEqual(L.BH_checkFile(f("A.JPG", 10, "image/jpeg")), null);
  assert.strictEqual(L.BH_checkFile(f("x.heic", 10, "image/heif")), null);
  assert.strictEqual(L.BH_checkFile(f("x.csv", 10, "application/vnd.ms-excel")), null);
  assert.strictEqual(L.BH_checkFile(f("x.xlsx", 10, "")), null);
});
t("rejects other types, no extension and spoofed types", () => {
  assert.ok(L.BH_checkFile(f("a.exe", 10, "application/octet-stream")));
  assert.ok(L.BH_checkFile(f("a.pdf.exe", 10, "application/pdf")));
  assert.ok(L.BH_checkFile(f("noext", 10, "application/pdf")));
  assert.ok(L.BH_checkFile(f(".pdf", 10, "application/pdf")));
  assert.ok(L.BH_checkFile(f("a.pdf", 10, "text/html")));
});
t("size limits", () => {
  assert.strictEqual(L.BH_checkFile(f("a.pdf", 25 * 1024 * 1024, "application/pdf")), null);
  assert.ok(/25 MB/.test(L.BH_checkFile(f("a.pdf", 25 * 1024 * 1024 + 1, "application/pdf"))));
  assert.ok(/empty/.test(L.BH_checkFile(f("a.pdf", 0, "application/pdf"))));
});
t("pickFiles splits and drops exact duplicates", () => {
  const r = L.BH_pickFiles([f("a.pdf", 5, "application/pdf"), f("a.pdf", 5, "application/pdf"), f("b.zip", 5), f("c.png", 9, "image/png")]);
  assert.deepStrictEqual(r.accepted.map((x) => x.name), ["a.pdf", "c.png"]);
  assert.strictEqual(r.rejected.length, 1);
  assert.strictEqual(r.rejected[0].name, "b.zip");
  assert.deepStrictEqual(L.BH_pickFiles(null), { accepted: [], rejected: [] });
});
t("fileSig matches the same file only", () => {
  const a = Object.assign(f("a.pdf", 5, "application/pdf"), { lastModified: 1 });
  const b = Object.assign(f("a.pdf", 5, "application/pdf"), { lastModified: 1 });
  const c = Object.assign(f("a.pdf", 6, "application/pdf"), { lastModified: 1 });
  assert.strictEqual(L.BH_fileSig(a), L.BH_fileSig(b));
  assert.notStrictEqual(L.BH_fileSig(a), L.BH_fileSig(c));
  assert.strictEqual(typeof L.BH_fileSig(null), "string");
});
t("sizeLabel", () => {
  assert.strictEqual(L.BH_sizeLabel(500), "500 B");
  assert.strictEqual(L.BH_sizeLabel(2048), "2 KB");
  assert.strictEqual(L.BH_sizeLabel(3 * 1024 * 1024), "3 MB");
});

// ---- Drag
t("dragHasFiles only for files", () => {
  assert.strictEqual(L.BH_dragHasFiles({ types: ["Files"] }), true);
  assert.strictEqual(L.BH_dragHasFiles({ types: ["text/plain", "Files"] }), true);
  assert.strictEqual(L.BH_dragHasFiles({ types: ["text/plain"] }), false);
  assert.strictEqual(L.BH_dragHasFiles(null), false);
});

// ---- Messages
t("summary wording", () => {
  assert.ok(/Uploaded 1 file to Receipts/.test(L.BH_summary(1, 0, "receipts")));
  assert.ok(/see it now/.test(L.BH_summary(1, 0, "receipts")));
  assert.ok(/see them now/.test(L.BH_summary(2, 0, "tax")));
  assert.ok(/2 of 3 uploaded; 1 didn't/.test(L.BH_summary(2, 1, "tax")));
  assert.ok(/Couldn't upload 2 files/.test(L.BH_summary(0, 2, "tax")));
});
t("latest from bookkeeper", () => {
  assert.strictEqual(L.BH_latestFromBookkeeper([]), null);
  assert.strictEqual(L.BH_latestFromBookkeeper([{ from: "client", text: "hi" }]), null);
  const a = L.BH_latestFromBookkeeper([
    { from: "bookkeeper", author: "Jesse", text: "Hello", created_at: "2026-10-01T00:00:00Z" },
    { from: "client", text: "thanks" },
  ]);
  assert.strictEqual(a.author, "Jesse");
  assert.strictEqual(a.waiting, false);
  const b = L.BH_latestFromBookkeeper([{ from: "bookkeeper", text: "", attachment: { name: "p.pdf" } }]);
  assert.strictEqual(b.text, "Sent a file: p.pdf");
  assert.strictEqual(b.waiting, true);
});
t("preview trims at a word", () => {
  assert.strictEqual(L.BH_preview("  a   b\nc "), "a b c");
  const p = L.BH_preview("word ".repeat(100), 20);
  assert.ok(p.length <= 20 && p.endsWith("…"));
});

console.log("basicHomeLogic: " + n + " ok");
