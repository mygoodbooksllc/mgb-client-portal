// node --test tests/edge/*.test.mjs
// Staff Handbook part 4: the batched approver email
// (supabase/functions/notification-emails/handbookApproval.ts).
import test from "node:test";
import assert from "node:assert/strict";
import {
  APPROVAL_KIND, APPROVAL_HASH, notBefore, isHeld, approvalSkipReason, approvalEmail,
} from "../../supabase/functions/notification-emails/handbookApproval.ts";

const NOW = Date.parse("2026-10-19T15:00:00Z");
const row = (not_before, kind = APPROVAL_KIND) => ({ kind, payload: not_before === undefined ? {} : { not_before } });

test("a notice inside its 30-minute window is held, later it goes", () => {
  assert.equal(isHeld(row("2026-10-19T15:20:00+00:00"), NOW), true);
  assert.equal(isHeld(row("2026-10-19T15:00:00Z"), NOW), false);
  assert.equal(isHeld(row("2026-10-19T14:59:00Z"), NOW), false);
});
test("no or bad not_before: not held (never stuck)", () => {
  assert.equal(isHeld(row(undefined), NOW), false);
  assert.equal(isHeld(row(""), NOW), false);
  assert.equal(isHeld(row("not a date"), NOW), false);
  assert.equal(notBefore({ payload: null }), null);
});
test("only the approval kind is ever held", () => {
  assert.equal(isHeld(row("2026-10-19T16:00:00Z", "handbook_sign_needed"), NOW), false);
});
test("sends to the current approver when drafts wait", () => {
  assert.equal(approvalSkipReason({ to: "b@x.org", approverSetting: "B@x.org ", isActiveAdmin: true, pending: 3 }), null);
});
test("skips when the approver changed, isn't an admin, or nothing waits", () => {
  assert.match(approvalSkipReason({ to: "old@x.org", approverSetting: "new@x.org", isActiveAdmin: true, pending: 2 }), /no longer/i);
  assert.match(approvalSkipReason({ to: "b@x.org", approverSetting: null, isActiveAdmin: true, pending: 2 }), /no longer/i);
  assert.match(approvalSkipReason({ to: "b@x.org", approverSetting: "b@x.org", isActiveAdmin: false, pending: 2 }), /not an active admin/);
  assert.match(approvalSkipReason({ to: "b@x.org", approverSetting: "b@x.org", isActiveAdmin: true, pending: 0 }), /No handbook drafts/);
  assert.match(approvalSkipReason({ to: "b@x.org", approverSetting: "b@x.org", isActiveAdmin: true, pending: null }), /count/);
});
test("the email gives a count and a link, never titles or text", () => {
  const m = approvalEmail(9, "https://app.example/");
  assert.equal(m.subject, "9 handbook policies need your approval");
  assert.equal(m.href, `https://app.example/${APPROVAL_HASH}`);
  assert.equal(m.cta, "Open the drafts");
  assert.match(m.lines.join(" "), /Team › Handbook/);
  const one = approvalEmail(1, "https://app.example/");
  assert.equal(one.subject, "1 handbook policy needs your approval");
  assert.match(one.lines[0], /before it can be published/);
  // Only the count and fixed wording: the function takes no titles at all.
  assert.equal(approvalEmail.length, 2);
});
test("a bad count still reads sensibly", () => {
  assert.equal(approvalEmail(0, "h/").subject, "1 handbook policy needs your approval");
  assert.equal(approvalEmail(NaN, "h/").subject, "1 handbook policy needs your approval");
});
