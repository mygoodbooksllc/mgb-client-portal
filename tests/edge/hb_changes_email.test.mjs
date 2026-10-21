// node --test tests/edge/*.test.mjs
// Staff Handbook part 5: the "changes requested" email
// (supabase/functions/notification-emails/handbookChanges.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CHANGES_KIND, changesSkipReason, changesEmail,
} from "../../supabase/functions/notification-emails/handbookChanges.ts";

const draft = { status: "draft", active: true, approval_status: "changes_requested" };
const ok = (over = {}) => ({ to: "ed@x.org", byEmail: "ap@x.org", isActiveAdmin: true, policy: draft, ...over });

test("sends to the last editor while the draft waits on changes", () => {
  assert.equal(changesSkipReason(ok()), null);
  assert.equal(changesSkipReason(ok({ byEmail: null })), null);
});
test("never emails the approver about their own edit", () => {
  assert.match(changesSkipReason(ok({ to: "ap@x.org", byEmail: " AP@x.org" })), /approver/i);
});
test("skips when the recipient isn't an active admin", () => {
  assert.match(changesSkipReason(ok({ isActiveAdmin: false })), /not an active admin/i);
});
test("skips when the draft is gone, published, edited or approved since", () => {
  assert.match(changesSkipReason(ok({ policy: null })), /no longer exists/);
  assert.match(changesSkipReason(ok({ policy: { ...draft, active: false } })), /no longer exists/);
  assert.match(changesSkipReason(ok({ policy: { ...draft, status: "published" } })), /published/);
  assert.match(changesSkipReason(ok({ policy: { ...draft, approval_status: "pending" } })), /edited or approved/);
  assert.match(changesSkipReason(ok({ policy: { ...draft, approval_status: "approved" } })), /edited or approved/);
});
test("the email names the draft, quotes the note and links to it", () => {
  const m = changesEmail({ policy_title: "PTO policy", policy_slug: "pto policy", by: "Bailley Hawkins", note: "Fix the intro.\nAnd the dates." }, "https://app.example/");
  assert.equal(m.subject, "Changes requested: PTO policy");
  assert.equal(m.href, "https://app.example/#/hr/handbook?item=handbook:pto%20policy");
  assert.equal(m.cta, "Open the draft");
  assert.match(m.lines[0], /Bailley Hawkins asked for changes to <b>PTO policy<\/b>/);
  assert.equal(m.lines[1], "<i>Fix the intro.<br>And the dates.</i>");
  assert.match(m.lines.join(" "), /HR › Handbook/);
  assert.ok(m.textLines.includes("Fix the intro.\nAnd the dates."));
  assert.match(m.preheader, /^Bailley Hawkins: Fix the intro/);
  assert.ok(m.preheader.length <= 140);
});
test("everything from the payload is escaped in the HTML lines", () => {
  const m = changesEmail({ policy_title: "<script>x</script>", by: "A & B", note: `"quoted" <b>bold</b> 'it'` }, "h/");
  const html = m.lines.join(" ");
  assert.ok(!html.includes("<script>"));
  assert.match(html, /&lt;script&gt;x&lt;\/script&gt;/);
  assert.match(html, /A &amp; B/);
  assert.match(html, /&quot;quoted&quot; &lt;b&gt;bold&lt;\/b&gt; &#39;it&#39;/);
});
test("a thin payload still reads sensibly", () => {
  const m = changesEmail({}, "h/");
  assert.equal(m.subject, "Changes requested: A handbook draft");
  assert.equal(m.href, "h/#/hr/handbook");
  assert.equal(m.lines.length, 2);
  assert.match(m.lines[0], /^The policy approver asked/);
  assert.equal(changesEmail(null, "h/").cta, "Open the draft");
});
test("the outbox kind is wired into the sender and Settings", () => {
  assert.equal(CHANGES_KIND, "handbook_changes_requested");
  const idx = readFileSync(new URL("../../supabase/functions/notification-emails/index.ts", import.meta.url), "utf8");
  assert.match(idx, /handbook_changes_requested: \{ key: "handbook_changes", def: true \}/);
  assert.match(idx, /r\.kind === "handbook_changes_requested" \? `\|\$\{r\.id\}`/); // one email per row
  const settings = readFileSync(new URL("../../components/settings/Settings.jsx", import.meta.url), "utf8");
  assert.match(settings, /key: "handbook_changes"/);
  const emails = readFileSync(new URL("../../components/staff/EmailsPage.jsx", import.meta.url), "utf8");
  assert.match(emails, /value: "handbook_changes_requested"/);
});
