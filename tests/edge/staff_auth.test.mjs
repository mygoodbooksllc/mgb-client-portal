// node --test tests/edge/*.test.mjs
// supabase/functions/staff-auth/logic.ts: request parsing, the address rules
// (domain, active staff, not a client login), the hourly budget and the
// random password. The network half (auth.admin.createUser, the caller's
// is_active_staff_admin() check) is in index.ts and isn't run here.
import test from "node:test";
import assert from "node:assert/strict";
import * as L from "../../supabase/functions/staff-auth/logic.ts";

test("domain rule is anchored and the dot is literal", () => {
  assert.ok(L.isStaffDomain("jane@mygoodbooks.org"));
  for (const bad of [
    "jane@mygoodbooks.org.evil.com",
    "jane@mygoodbooksXorg",
    "jane@sub.mygoodbooks.org",
    "jane@evil.com",
    "@mygoodbooks.org",
    "ja ne@mygoodbooks.org",
    "a@b@mygoodbooks.org",
    "jane\u200b@mygoodbooks.org",
    "jane@mygoodbooks.org\n",
    "ja\nne@mygoodbooks.org",
    "jane\u0000@mygoodbooks.org",
    "JANE@mygoodbooks.org",
    "",
  ]) {
    assert.equal(L.isStaffDomain(bad), false, bad);
  }
});

test("parseRequest: ensure lowercases, trims, dedupes and rejects non-firm addresses", () => {
  const p = L.parseRequest({
    action: "ensure",
    emails: [" Jane@MyGoodBooks.org ", "jane@mygoodbooks.org", "x@gmail.com", 42, "bob@mygoodbooks.org"],
  });
  assert.equal(p.ok, true);
  assert.deepEqual(p.emails, ["jane@mygoodbooks.org", "bob@mygoodbooks.org"]);
  assert.deepEqual(p.rejected, [
    { email: "x@gmail.com", status: "skipped", reason: "invalid_email" },
    { email: "", status: "skipped", reason: "invalid_email" },
  ]);
});

test("parseRequest: repair, bad action, bad body, empty and over-cap lists", () => {
  assert.deepEqual(L.parseRequest({ action: "repair", emails: ["ignored"] }), { ok: true, action: "repair" });
  assert.equal(L.parseRequest({ action: "delete" }).status, 400);
  assert.equal(L.parseRequest(null).status, 400);
  assert.equal(L.parseRequest([]).status, 400);
  assert.equal(L.parseRequest({ action: "ensure", emails: [] }).error, "invalid_emails");
  assert.equal(L.parseRequest({ action: "ensure", emails: "a@mygoodbooks.org" }).error, "invalid_emails");
  const many = Array.from({ length: L.MAX_EMAILS + 1 }, (_, i) => `p${i}@mygoodbooks.org`);
  assert.equal(L.parseRequest({ action: "ensure", emails: many }).error, "too_many_emails");
  assert.equal(L.parseRequest({ action: "ensure", emails: many.slice(0, L.MAX_EMAILS) }).ok, true);
});

test("plan: only ACTIVE staff who aren't client logins get created", () => {
  const staff = [
    { email: "Active@MyGoodBooks.org", active: true },
    { email: "off@mygoodbooks.org", active: false },
    { email: "nullish@mygoodbooks.org", active: null },
    { email: "both@mygoodbooks.org", active: true },
    { email: "has@mygoodbooks.org", active: true },
  ];
  const { create, results } = L.plan(
    [
      "active@mygoodbooks.org",
      "off@mygoodbooks.org",
      "nullish@mygoodbooks.org",
      "stranger@mygoodbooks.org",
      "both@mygoodbooks.org",
      "has@mygoodbooks.org",
      "x@evil.com",
    ],
    staff,
    ["Both@MyGoodBooks.org"],
    new Set(["has@mygoodbooks.org"]),
  );
  assert.deepEqual(create, ["active@mygoodbooks.org"]);
  assert.deepEqual(results, [
    { email: "off@mygoodbooks.org", status: "skipped", reason: "not_active_staff" },
    { email: "nullish@mygoodbooks.org", status: "skipped", reason: "not_active_staff" },
    { email: "stranger@mygoodbooks.org", status: "skipped", reason: "not_staff" },
    { email: "both@mygoodbooks.org", status: "skipped", reason: "client_login" },
    { email: "has@mygoodbooks.org", status: "exists" },
    { email: "x@evil.com", status: "skipped", reason: "invalid_email" },
  ]);
});

test("normalizeEmail + parseRequest: NFKC, then ASCII only", () => {
  // Kelvin sign (U+212A) is NFKC "K", so it becomes a plain "k" address.
  assert.equal(L.normalizeEmail("\u212Aate@mygoodbooks.org"), "kate@mygoodbooks.org");
  // Full-width letters fold to ASCII too.
  assert.equal(L.normalizeEmail("\uFF2Aane@mygoodbooks.org"), "jane@mygoodbooks.org");
  // Outer whitespace (incl. a trailing newline) is trimmed.
  assert.equal(L.normalizeEmail(" jane@mygoodbooks.org\n"), "jane@mygoodbooks.org");
  const p = L.parseRequest({
    action: "ensure",
    emails: [
      "\u212Aate@mygoodbooks.org",
      "jane\u200b@mygoodbooks.org",
      "ja\nne@mygoodbooks.org",
      "jane\u0000@mygoodbooks.org",
      "jos\u00e9@mygoodbooks.org",
    ],
  });
  assert.equal(p.ok, true);
  assert.deepEqual(p.emails, ["kate@mygoodbooks.org"]);
  assert.deepEqual(p.rejected.map((r) => r.reason), ["invalid_email", "invalid_email", "invalid_email", "invalid_email"]);
});

test("plan: two staff rows that normalize to one address are skipped as ambiguous", () => {
  const { create, results } = L.plan(
    ["kate@mygoodbooks.org", "bob@mygoodbooks.org"],
    [
      { email: "kate@mygoodbooks.org", active: false },
      { email: "\u212Aate@mygoodbooks.org", active: true },
      { email: "bob@mygoodbooks.org", active: true },
    ],
    [],
    null,
  );
  assert.deepEqual(create, ["bob@mygoodbooks.org"]);
  assert.deepEqual(results, [{ email: "kate@mygoodbooks.org", status: "skipped", reason: "ambiguous" }]);
});

test("plan: with no pre-check (null), active staff all go to create", () => {
  const { create } = L.plan(["a@mygoodbooks.org"], [{ email: "a@mygoodbooks.org", active: true }], [], null);
  assert.deepEqual(create, ["a@mygoodbooks.org"]);
});

test("remainingBudget: per-admin and global caps, never negative", () => {
  assert.equal(L.remainingBudget(0, 0), L.RATE_LIMIT_PER_ACTOR);
  assert.equal(L.remainingBudget(59, 0), 1);
  assert.equal(L.remainingBudget(60, 0), 0);
  assert.equal(L.remainingBudget(500, 0), 0);
  assert.equal(L.remainingBudget(0, L.RATE_LIMIT_GLOBAL - 3), 3);
  assert.equal(L.remainingBudget(0, 10_000), 0);
  assert.equal(L.remainingBudget(-5, -5), L.RATE_LIMIT_PER_ACTOR);
  // Only accounts actually made count; the auth_repair summary row doesn't.
  assert.deepEqual(L.RATE_ACTIONS, ["auth_user_created"]);
  assert.equal(L.RATE_WINDOW_MS, 3_600_000);
});

test("isAlreadyRegistered: the shapes Supabase uses", () => {
  assert.ok(L.isAlreadyRegistered({ code: "email_exists" }));
  assert.ok(L.isAlreadyRegistered({ code: "user_already_exists" }));
  assert.ok(L.isAlreadyRegistered({ message: "A user with this email address has already been registered" }));
  assert.ok(L.isAlreadyRegistered({ status: 422, message: "User already registered" }));
  // A bare 422 is also a weak password / bad address: that's a failure, not "exists".
  assert.equal(L.isAlreadyRegistered({ status: 422 }), false);
  assert.equal(L.isAlreadyRegistered({ status: 422, code: "weak_password", message: "Password is too weak" }), false);
  assert.equal(L.isAlreadyRegistered({ status: 422, code: "validation_failed", message: "Unable to validate email address" }), false);
  assert.equal(L.isAlreadyRegistered({ status: 500, message: "db down" }), false);
  assert.equal(L.isAlreadyRegistered(null), false);
});

test("randomPassword: 48 random bytes + aA1!, always upper/lower/digit/symbol", () => {
  const a = L.randomPassword();
  const b = L.randomPassword();
  assert.notEqual(a, b);
  assert.match(a, /^[A-Za-z0-9+/]{64}aA1!$/);
  assert.equal(Buffer.from(a.slice(0, 64), "base64").length, 48);
  for (let i = 0; i < 200; i++) {
    const p = L.randomPassword();
    assert.match(p, /[A-Z]/);
    assert.match(p, /[a-z]/);
    assert.match(p, /[0-9]/);
    assert.match(p, /[^A-Za-z0-9]/);
  }
});

test("summarize counts each status", () => {
  assert.deepEqual(
    L.summarize([
      { email: "a", status: "created" },
      { email: "b", status: "exists" },
      { email: "c", status: "skipped", reason: "not_staff" },
      { email: "d", status: "created" },
      { email: "e", status: "error", reason: "create_failed" },
    ]),
    { created: 2, exists: 1, skipped: 1, error: 1 },
  );
});
