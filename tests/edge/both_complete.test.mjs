// node --test tests/edge/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { bothCompleteEmail } from "../../supabase/functions/team-reviews/meeting.ts";

test("asks for a meeting with the reviewer, never says results are ready", () => {
  const m = bothCompleteEmail({ cycle: "Q3 2026", reviewer_name: "Jesse Smithwick", cam_behavior: 2, coaching: "secret" }, "Jesse Smithwick", "https://x/#/team/reviews/r/1");
  assert.match(m.subject, /Both sides of your Q3 2026 review are in/);
  assert.match(m.lines.join(" "), /set up a time with Jesse/);
  assert.equal(m.href, "https://x/#/team/reviews/r/1");
  const all = JSON.stringify(m);
  assert.doesNotMatch(all, /secret|cam_behavior|Smithwick/);
  assert.doesNotMatch(all, /(results|comparison|scores?) (is|are) (ready|open|available)/i);
});
test("falls back without names", () => {
  const m = bothCompleteEmail({}, null, "h");
  assert.match(m.subject, /this quarter/);
  assert.match(m.lines.join(" "), /your reviewer/);
});
