// Ask-client links, tokens and emails (supabase/functions/_shared/tk_requests.ts)
// and the staff send envelopes (supabase/functions/tk-client-requests/send_plan.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as T from "../../supabase/functions/_shared/tk_requests.ts";
import * as S from "../../supabase/functions/tk-client-requests/send_plan.ts";

test("tokens are 32 random bytes, base64url, and only their sha256 is stored", async () => {
  const a = T.newToken();
  const b = T.newToken();
  assert.match(a, T.TOKEN_RE);
  assert.notEqual(a, b);
  assert.equal(Buffer.from(a, "base64url").length, 32);
  assert.equal(await T.tokenHashHex(a), createHash("sha256").update(a).digest("hex"));
  assert.equal(await T.tokenHashParam(a), "\\x" + createHash("sha256").update(a).digest("hex"));
});

test("links: token in the fragment, portal deep link matches the login allow-list", () => {
  const t = T.newToken();
  assert.equal(T.respondLink(t), `https://app.mygoodbooks.org/respond#t=${t}`);
  assert.equal(T.respondLink(t, true), `https://app.mygoodbooks.org/respond#t=${t}&stop=1`);
  assert.throws(() => T.respondLink("short"));
  const rid = "0b0f1c2e-1111-4222-8333-944455556666";
  const href = T.portalLink("grace-community", rid);
  assert.equal(href, `https://app.mygoodbooks.org/login?next=${encodeURIComponent(`#/client/grace-community/needs/${rid}`)}`);
  const next = decodeURIComponent(new URL(href).searchParams.get("next"));
  assert.match(next, /^#\/client\/[a-z0-9-]+\/needs(\/[0-9a-f-]{36})?$/);
  assert.throws(() => T.portalLink("Grace Community"));
  assert.throws(() => T.portalLink("grace", "nope"));
});

test("ask email: escaped, no amounts, link note and Reply-To wording", () => {
  const t = T.newToken();
  const e = T.askEmail({
    clientName: "Grace <Community>", recipientName: "Pat Q Treasurer", staffFirstName: "Jesse Smith",
    title: "2025 W-9 <b>", prompt: "Line one\n<script>alert(1)</script>", dueDate: "2026-10-30",
    href: T.respondLink(t), viaPortal: false, expiresOn: "2026-10-30",
  });
  assert.equal(e.subject, "Grace <Community>: 2025 W-9 <b>");
  assert.ok(!e.html.includes("<script>"));
  assert.ok(!e.html.includes("<Community>"));
  assert.ok(e.html.includes("Hi Pat,"));
  assert.ok(e.html.includes("Jesse at MyGoodBooks needs the following:"));
  assert.ok(e.html.includes("This link works once and expires on October 30, 2026. It only shows this request."));
  assert.ok(e.html.includes("Reply or upload"));
  assert.ok(e.text.includes(T.respondLink(t)));
  assert.ok(e.text.includes("Questions? Reply to this email to reach Jesse."));
  assert.ok(!/\$\s?\d/.test(e.text));
  const test1 = T.askEmail({ clientName: "B", staffFirstName: "J", title: "t", prompt: "p", href: T.portalLink("b"), viaPortal: true, test: true });
  assert.ok(test1.subject.startsWith("[Test] "));
  assert.ok(test1.html.includes("Open in the portal"));
});

test("nudge email: one line per item, its own link, Stop reminders for contacts", () => {
  const t1 = T.newToken();
  const t2 = T.newToken();
  const e = T.nudgeEmail({
    clientName: "Grace", recipientName: "Pat", viaPortal: false,
    items: [{ title: "W-9", href: T.respondLink(t1) }, { title: "Bank <stmt>", href: T.respondLink(t2) }],
    stopHref: T.respondLink(t1, true), replyToFirstName: "Jesse",
  });
  assert.equal(e.subject, "Reminder: 2 items Grace still needs from you");
  assert.ok(e.html.includes(t1) && e.html.includes(t2));
  assert.ok(e.html.includes("Stop reminders"));
  assert.ok(!e.html.includes("<stmt>"));
  assert.equal(T.nudgeEmail({ clientName: "G", items: [{ title: "x", href: T.portalLink("g") }], viaPortal: true }).subject,
    "Reminder: 1 item G still needs from you");
});

test("dates: long form and Chicago expiry", () => {
  assert.equal(T.longDate("2026-01-05"), "January 5, 2026");
  assert.equal(T.longDate(null), "");
  assert.equal(T.expiresOn(14, new Date("2026-10-16T12:00:00Z")), "2026-10-30");
});

const contact = { type: "contact", email: "Pat@Example.invalid", name: "Pat", contact_id: "c1" };
const portal = { type: "portal", email: "lee@example.invalid", name: "Lee" };

test("dry run, preview and off send nothing", () => {
  assert.deepEqual(S.envelopes({ mode: "dry_run", needs_sender: false, targets: [contact], client_id: "g" }, "me@x"), []);
  assert.deepEqual(S.envelopes({ mode: "live", needs_sender: false, targets: [contact], client_id: "g" }, "me@x"), []);
  assert.deepEqual(S.envelopes({ mode: "off", needs_sender: true, targets: [contact], client_id: "g" }, "me@x"), []);
});

test("a test client sends ONE copy to the caller, with a real test link when there is a contact", () => {
  const e = S.envelopes({ mode: "test", needs_sender: true, targets: [portal, contact], client_id: "basic-test" }, "me@mgb.example");
  assert.deepEqual(e, [{ to: "me@mgb.example", name: null, via: "link", contactId: "c1", test: true }]);
  const p = S.envelopes({ mode: "test", needs_sender: true, targets: [portal], client_id: "basic-test" }, "me@mgb.example");
  assert.deepEqual(p, [{ to: "me@mgb.example", name: null, via: "portal", contactId: null, test: true }]);
});

test("live: one email per target, contacts by link, portal users by sign-in", () => {
  const e = S.envelopes({ mode: "live", needs_sender: true, targets: [portal, contact, contact], client_id: "g" }, "me@x");
  assert.deepEqual(e, [
    { to: "lee@example.invalid", name: "Lee", via: "portal", contactId: null, test: false },
    { to: "pat@example.invalid", name: "Pat", via: "link", contactId: "c1", test: false },
  ]);
  // a contact target without an id never gets a link
  assert.deepEqual(S.envelopes({ mode: "live", needs_sender: true, targets: [{ type: "contact", email: "x@y" }], client_id: "g" }, "me@x"), []);
});

test("RPC errors become short codes", () => {
  assert.equal(S.rpcErrorCode("tk_too_soon"), "too_soon");
  assert.equal(S.rpcErrorCode("ERROR: tk_email_off"), "email_off");
  assert.equal(S.rpcErrorCode("weird"), "error");
});
