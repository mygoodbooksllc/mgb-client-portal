// Plain node: `node components/client/AG_logic.test.js`.
// Synthetic values only.
const assert = require("assert");
const L = require("./AG_logic.js");

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

const TODAY = "2026-10-28";

t("labels and tones", () => {
  assert.strictEqual(L.AG_typeLabel("nda"), "NDA");
  assert.strictEqual(L.AG_typeLabel("nope"), "Other");
  assert.strictEqual(L.AG_statusLabel("signed"), "Signed");
  assert.strictEqual(L.AG_statusLabel(undefined), "Draft");
  assert.strictEqual(L.AG_statusTone("signed"), "good");
  assert.strictEqual(L.AG_statusTone("expired"), "bad");
  assert.deepStrictEqual(
    L.AG_TYPES.map((x) => x.key),
    ["service_agreement", "engagement_letter", "addendum", "nda", "pricing_change", "other"],
  );
  assert.deepStrictEqual(L.AG_STATUSES.map((x) => x.key), ["draft", "sent", "signed", "expired", "terminated"]);
});

t("safeUrl: https only", () => {
  assert.strictEqual(L.AG_safeUrl(" https://drive.google.com/file/d/x/view "), "https://drive.google.com/file/d/x/view");
  assert.strictEqual(L.AG_safeUrl("http://drive.google.com/x"), null);
  assert.strictEqual(L.AG_safeUrl("javascript:alert(1)"), null);
  assert.strictEqual(L.AG_safeUrl("JAVASCRIPT:alert(1)//https://"), null);
  assert.strictEqual(L.AG_safeUrl("data:text/html,hi"), null);
  assert.strictEqual(L.AG_safeUrl("https://a b.com"), null);
  assert.strictEqual(L.AG_safeUrl("https://"), null);
  assert.strictEqual(L.AG_safeUrl(""), null);
  assert.strictEqual(L.AG_safeUrl(null), null);
  assert.strictEqual(L.AG_safeUrl("https://x.com/" + "a".repeat(2000)), null);
});

t("validate", () => {
  assert.deepStrictEqual(L.AG_validate({ title: "Service agreement", status: "signed" }), []);
  assert.ok(L.AG_validate({ title: "  " }).some((m) => /title/.test(m)));
  assert.ok(L.AG_validate({ title: "x".repeat(201) }).some((m) => /under 200/.test(m)));
  assert.ok(L.AG_validate({ title: "x", document_url: "javascript:alert(1)" }).some((m) => /https/.test(m)));
  assert.ok(L.AG_validate({ title: "x", status: "bogus" }).length === 1);
  assert.ok(L.AG_validate({ title: "x", agreement_type: "bogus" }).length === 1);
  assert.ok(L.AG_validate({ title: "x", signed_on: "2026-02-30" }).some((m) => /signed date/.test(m)));
  assert.ok(L.AG_validate({ title: "x", signed_on: "2026-05-01", expires_on: "2026-04-01" }).some((m) => /before/.test(m)));
  assert.ok(L.AG_validate({ title: "x", staff_note: "n".repeat(4001) }).some((m) => /note/.test(m)));
});

t("daysUntil", () => {
  assert.strictEqual(L.AG_daysUntil("2026-10-29", TODAY), 1);
  assert.strictEqual(L.AG_daysUntil("2026-10-28", TODAY), 0);
  assert.strictEqual(L.AG_daysUntil("2026-10-27", TODAY), -1);
  assert.strictEqual(L.AG_daysUntil("2027-10-28", TODAY), 365);
  assert.strictEqual(L.AG_daysUntil(null, TODAY), null);
  assert.strictEqual(L.AG_daysUntil("bad", TODAY), null);
});

t("expiryInfo: 60-day window", () => {
  assert.deepStrictEqual(L.AG_expiryInfo({ status: "signed", expires_on: "2026-12-27" }, TODAY), { kind: "soon", days: 60, label: "Expires in 60 days" });
  assert.strictEqual(L.AG_expiryInfo({ status: "signed", expires_on: "2026-12-28" }, TODAY).kind, null);
  assert.strictEqual(L.AG_expiryInfo({ status: "signed", expires_on: "2026-10-29" }, TODAY).label, "Expires in 1 day");
  assert.strictEqual(L.AG_expiryInfo({ status: "signed", expires_on: TODAY }, TODAY).label, "Expires today");
  assert.strictEqual(L.AG_expiryInfo({ status: "signed", expires_on: "2026-01-01" }, TODAY).kind, "expired");
  assert.strictEqual(L.AG_expiryInfo({ status: "terminated", expires_on: "2026-11-01" }, TODAY).kind, null);
  assert.strictEqual(L.AG_expiryInfo({ status: "signed", expires_on: "2026-11-01", trashed_at: "x" }, TODAY).kind, null);
  assert.strictEqual(L.AG_expiryInfo({ status: "signed" }, TODAY).kind, null);
});

t("effectiveStatus", () => {
  assert.strictEqual(L.AG_effectiveStatus({ status: "signed", expires_on: "2026-01-01" }, TODAY), "expired");
  assert.strictEqual(L.AG_effectiveStatus({ status: "sent", expires_on: "2026-01-01" }, TODAY), "expired");
  assert.strictEqual(L.AG_effectiveStatus({ status: "draft", expires_on: "2026-01-01" }, TODAY), "draft");
  assert.strictEqual(L.AG_effectiveStatus({ status: "terminated", expires_on: "2026-01-01" }, TODAY), "terminated");
  assert.strictEqual(L.AG_effectiveStatus({ status: "signed", expires_on: "2027-01-01" }, TODAY), "signed");
  assert.strictEqual(L.AG_effectiveStatus({ status: "weird" }, TODAY), "draft");
});

t("clientVisible + toClientRow never carry staff fields", () => {
  const row = {
    id: "1", client_id: "c", title: "T", agreement_type: "nda", status: "signed", signed_on: "2025-01-01",
    staff_note: "SECRET", client_can_sign: true, created_by: "a@b", trashed_at: null, trashed_by: null, visible_to_client: true,
  };
  assert.strictEqual(L.AG_clientVisible(row), true);
  assert.strictEqual(L.AG_clientVisible({ ...row, visible_to_client: false }), false);
  assert.strictEqual(L.AG_clientVisible({ ...row, trashed_at: "2026-01-01" }), false);
  const c = L.AG_toClientRow(row);
  assert.deepStrictEqual(Object.keys(c).sort(), ["agreement_type", "client_file_id", "document_url", "effective_on", "expires_on", "id", "signed_on", "status", "title"]);
  assert.ok(!JSON.stringify(c).includes("SECRET"));
});

t("parseBulk", () => {
  const r = L.AG_parseBulk(
    [
      "Service agreement 2023 | https://drive.google.com/a",
      "Engagement letter\thttps://drive.google.com/b",
      "https://drive.google.com/c",
      "",
      "No link here | nothing",
      "Bad | javascript:alert(1)",
      "Old | http://insecure.example.com",
      "  ",
    ].join("\n"),
  );
  assert.deepStrictEqual(r.rows, [
    { title: "Service agreement 2023", document_url: "https://drive.google.com/a" },
    { title: "Engagement letter", document_url: "https://drive.google.com/b" },
    { title: "Signed agreement", document_url: "https://drive.google.com/c" },
  ]);
  assert.deepStrictEqual(r.bad.map((b) => b.line), [5, 6, 7]);
  assert.strictEqual(L.AG_parseBulk("").rows.length, 0);
  const many = Array.from({ length: 105 }, (_, i) => "https://x.com/" + i).join("\n");
  const m = L.AG_parseBulk(many);
  assert.strictEqual(m.rows.length, 100);
  assert.strictEqual(m.bad.length, 5);
  assert.strictEqual(L.AG_parseBulk("x".repeat(250) + " | https://x.com/a").rows[0].title.length, 200);
});

t("sort newest first", () => {
  const s = L.AG_sort([
    { id: "a", signed_on: "2023-01-01", created_at: "2026-01-01T00:00:00Z" },
    { id: "b", effective_on: "2025-06-01", created_at: "2026-01-01T00:00:00Z" },
    { id: "c", created_at: "2026-10-01T00:00:00Z" },
    { id: "d", signed_on: "2025-06-01", created_at: "2026-02-01T00:00:00Z" },
  ]);
  assert.deepStrictEqual(s.map((x) => x.id), ["c", "d", "b", "a"]);
});

t("fmtDate + todayLocal", () => {
  assert.strictEqual(L.AG_fmtDate("2026-01-05"), "Jan 5, 2026");
  assert.strictEqual(L.AG_fmtDate(""), "");
  assert.strictEqual(L.AG_fmtDate("bad"), "");
  assert.strictEqual(L.AG_todayLocal(new Date(2026, 0, 9)), "2026-01-09");
});

t("draft <-> payload", () => {
  const d = L.AG_initialDraft();
  assert.strictEqual(d.agreement_type, "service_agreement");
  assert.strictEqual(d.status, "draft");
  assert.strictEqual(d.visible_to_client, false);
  const p = L.AG_toPayload({ ...d, title: "  T  ", document_url: "javascript:x", staff_note: "  ", signed_on: "" });
  assert.strictEqual(p.title, "T");
  assert.strictEqual(p.document_url, null);
  assert.strictEqual(p.staff_note, null);
  assert.strictEqual(p.signed_on, null);
  assert.ok(!("client_can_sign" in p));
  assert.ok(!("client_id" in p));
  assert.ok(!("trashed_at" in p));
});

console.log("AG_logic: " + n + " tests passed");
