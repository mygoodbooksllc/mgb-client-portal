// node --test tests/edge/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { selfSubmittedEmail } from "../../supabase/functions/team-reviews/selfsubmitted.ts";

const fmt = (d) => (d ? "Fri, Oct 30" : "");
test("names the person and cycle, links to the form, has no scores", () => {
  const m = selfSubmittedEmail({ cycle: "Q3 2026", staff_name: "Jane Doe", due_at: "2026-10-30", cam_behavior: 5, note_to_reviewer: "secret" }, false, "https://x/#/team/reviews/r/1", fmt);
  assert.match(m.subject, /Jane Doe.*Q3 2026/);
  assert.equal(m.href, "https://x/#/team/reviews/r/1");
  assert.match(m.lines.join(" "), /still open, due Fri, Oct 30/);
  assert.doesNotMatch(JSON.stringify(m), /secret|cam_behavior/);
});
test("skipped when the reviewer already submitted", () => {
  assert.equal(selfSubmittedEmail({ cycle: "Q3 2026", staff_name: "Jane" }, true, "h", fmt), null);
});
test("falls back gracefully without payload fields", () => {
  const m = selfSubmittedEmail({}, false, "h", fmt);
  assert.match(m.subject, /A team member.*this quarter/);
});
