// tk-client-requests staff send: who gets which email.
// supabase/functions/tk-client-requests/send_plan.ts (envelopes, rpcErrorCode)
//   node --test tests/edge/tk_client_requests.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import * as S from "../../supabase/functions/tk-client-requests/send_plan.ts";

const contact = { type: "contact", email: "Pat@Example.invalid", name: "Pat", contact_id: "c1" };
const contact2 = { type: "contact", email: "sam@example.invalid", name: "Sam", contact_id: "c2" };
const portal = { type: "portal", email: "lee@example.invalid", name: "Lee" };
const ME = "me@mgb.example";
const plan = (o) => ({ client_id: "g", targets: [portal, contact], ...o });

test("dry run sends nothing, whatever the RPC says about needs_sender", () => {
  assert.deepEqual(S.envelopes(plan({ mode: "dry_run", needs_sender: false }), ME), []);
  assert.deepEqual(S.envelopes(plan({ mode: "dry_run", needs_sender: true }), ME), []);
  assert.deepEqual(S.envelopes(plan({ mode: "dry_run", needs_sender: true, targets: [contact, contact2] }), ME), []);
});

test("preview, off, unknown modes and a missing plan send nothing", () => {
  assert.deepEqual(S.envelopes(plan({ mode: "live", needs_sender: false }), ME), []);
  assert.deepEqual(S.envelopes(plan({ mode: "off", needs_sender: true }), ME), []);
  assert.deepEqual(S.envelopes(plan({ mode: "preview", needs_sender: true }), ME), []);
  assert.deepEqual(S.envelopes(plan({ mode: "LIVE", needs_sender: true }), ME), []);
  assert.deepEqual(S.envelopes(plan({ mode: "", needs_sender: true }), ME), []);
  assert.deepEqual(S.envelopes(null, ME), []);
  assert.deepEqual(S.envelopes(plan({ mode: "live", needs_sender: true, targets: [] }), ME), []);
});

test("test-only client: ONE [Test] copy to the caller, never to a client address", () => {
  const e = S.envelopes(plan({ mode: "test", needs_sender: true, targets: [portal, contact, contact2], client_id: "basic-test" }), ME);
  assert.equal(e.length, 1);
  assert.deepEqual(e[0], { to: ME, name: null, via: "link", contactId: "c1", test: true });
  // no client address appears anywhere in the envelope
  const s = JSON.stringify(e).toLowerCase();
  for (const t of [portal, contact, contact2]) assert.ok(!s.includes(t.email.toLowerCase()), t.email);
});

test("test-only routing: portal-only request gets a portal copy; no targets still only the caller", () => {
  assert.deepEqual(S.envelopes(plan({ mode: "test", needs_sender: true, targets: [portal] }), ME),
    [{ to: ME, name: null, via: "portal", contactId: null, test: true }]);
  assert.deepEqual(S.envelopes(plan({ mode: "test", needs_sender: true, targets: [] }), ME),
    [{ to: ME, name: null, via: "portal", contactId: null, test: true }]);
  // a contact without an id cannot mint a link: the copy falls back to the portal
  assert.deepEqual(S.envelopes(plan({ mode: "test", needs_sender: true, targets: [{ type: "contact", email: "x@y" }] }), ME),
    [{ to: ME, name: null, via: "portal", contactId: null, test: true }]);
  // test mode with needs_sender false (preview) sends nothing
  assert.deepEqual(S.envelopes(plan({ mode: "test", needs_sender: false }), ME), []);
});

test("live: one email per target, contacts by link, portal users by sign-in, deduped and lowercased", () => {
  const e = S.envelopes(plan({ mode: "live", needs_sender: true, targets: [portal, contact, { ...contact, email: "pat@example.invalid" }, contact2] }), ME);
  assert.deepEqual(e, [
    { to: "lee@example.invalid", name: "Lee", via: "portal", contactId: null, test: false },
    { to: "pat@example.invalid", name: "Pat", via: "link", contactId: "c1", test: false },
    { to: "sam@example.invalid", name: "Sam", via: "link", contactId: "c2", test: false },
  ]);
  assert.ok(!e.some((x) => x.to === ME), "the caller is not copied on a live send");
  // a contact target without an id never gets a link; empty emails are dropped
  assert.deepEqual(S.envelopes(plan({ mode: "live", needs_sender: true, targets: [{ type: "contact", email: "x@y" }, { type: "portal", email: "" }] }), ME), []);
});

test("RPC errors become short codes", () => {
  assert.equal(S.rpcErrorCode("tk_too_soon"), "too_soon");
  assert.equal(S.rpcErrorCode("ERROR: tk_email_off"), "email_off");
  assert.equal(S.rpcErrorCode("tk_mode_changed"), "mode_changed");
  assert.equal(S.rpcErrorCode("weird"), "error");
  assert.equal(S.rpcErrorCode(null), "error");
});
