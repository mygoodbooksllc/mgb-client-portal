// Plain node, no framework: `node components/staff/teamReviewsLogic.test.js`.
// Guards the Team Reviews rules the form shows instantly. The same rules are
// enforced in SQL (supabase/team-reviews-2-rpcs.sql); keep the two in step.

const assert = require("assert");
const L = require("./teamReviewsLogic.js");

let n = 0;
function t(name, fn) {
  fn();
  n++;
}

const all = (v) => ({ cam_behavior: v, cam_success: v, own_behavior: v, own_success: v, hh_behavior: v, hh_success: v });

t("scale labels", () => {
  assert.deepStrictEqual(L.TR_SCALE.map((s) => s.label), [
    "Not meeting expectations", "Partly meeting", "Meeting", "Often exceeding", "Consistently exceeding",
  ]);
  assert.strictEqual(L.TR_scaleLabel(4), "Often exceeding");
});

t("six items, three sections", () => {
  assert.strictEqual(L.TR_ITEMS.length, 6);
  assert.strictEqual(L.TR_SECTIONS.length, 3);
});

t("total needs all six", () => {
  const s = all(3);
  assert.strictEqual(L.TR_total(s), 18);
  delete s.hh_success;
  assert.strictEqual(L.TR_total(s), null);
  assert.deepStrictEqual(L.TR_validateSubmission(s), ["Rate all six items before submitting"]);
});

t("all 3s: total 18, no action step, nothing required", () => {
  const s = all(3);
  assert.strictEqual(L.TR_needsActionStep(s), false);
  assert.deepStrictEqual(L.TR_requiredComments(s), []);
  assert.deepStrictEqual(L.TR_validateSubmission(s), []);
});

t("one rating below 3 needs that section's comment and an action step", () => {
  const s = Object.assign(all(4), { own_success: 2 });
  assert.strictEqual(L.TR_needsActionStep(s), true);
  assert.deepStrictEqual(L.TR_requiredComments(s), ["ownership"]);
  assert.deepStrictEqual(L.TR_validateSubmission(s), [
    "Add comments for: Ownership",
    "Add an action step (a rating below 3 or a total below 18 needs one)",
  ]);
  s.comment_ownership = "Asana slipped";
  s.action_steps = "Daily Asana sweep";
  assert.deepStrictEqual(L.TR_validateSubmission(s), []);
});

t("total below 18 needs all three comments", () => {
  const s = Object.assign(all(3), { hh_success: 2 }); // 17, with a low in HH
  assert.deepStrictEqual(L.TR_requiredComments(s), ["camaraderie", "ownership", "healthy_hustle"]);
  const probs = L.TR_validateSubmission(s);
  assert.strictEqual(probs[0], "Add comments for: Camaraderie, Ownership, Healthy Hustle");
});

t("whitespace comments do not count", () => {
  const s = Object.assign(all(4), { cam_behavior: 1, comment_camaraderie: "   ", action_steps: "x" });
  assert.deepStrictEqual(L.TR_validateSubmission(s), ["Add comments for: Camaraderie"]);
});

t("compare flags", () => {
  const self = Object.assign(all(4), { cam_behavior: 2, own_behavior: 5 });
  const mgr = Object.assign(all(4), { own_behavior: 3, hh_success: 4 });
  const rows = L.TR_compareRows(self, mgr);
  const by = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.strictEqual(by.cam_behavior.result, "action");
  assert.strictEqual(by.own_behavior.result, "discuss");
  assert.strictEqual(by.own_behavior.gap, 2);
  assert.strictEqual(by.hh_success.result, "aligned");
  assert.strictEqual(by.hh_success.gap, 0);
  assert.strictEqual(L.TR_itemsToDiscuss(rows), 2);
});

t("blind rule", () => {
  const base = { staffId: "S", reviewerId: "R" };
  const see = (o) => L.TR_canSeeSubmission(Object.assign({}, base, o));
  // author always sees their own draft
  assert.strictEqual(see({ kind: "self", author: "S", viewer: "S", thisSubmitted: false }), true);
  // nobody else sees drafts, admins included
  assert.strictEqual(see({ kind: "manager", author: "R", viewer: "A", viewerIsAdmin: true, thisSubmitted: false }), false);
  // admin can't see a submitted self-review until the manager one is in
  assert.strictEqual(see({ kind: "self", author: "S", viewer: "A", viewerIsAdmin: true, thisSubmitted: true, bothSubmitted: false }), false);
  // reviewer can't see the self-review early either
  assert.strictEqual(see({ kind: "self", author: "S", viewer: "R", viewerIsAdmin: true, thisSubmitted: true, bothSubmitted: false }), false);
  // other admins can see a submitted manager review
  assert.strictEqual(see({ kind: "manager", author: "R", viewer: "A", viewerIsAdmin: true, thisSubmitted: true, bothSubmitted: false }), true);
  // ...but not if they're the reviewee
  assert.strictEqual(see({ kind: "manager", author: "R", viewer: "S", viewerIsAdmin: true, thisSubmitted: true, bothSubmitted: false }), false);
  // staff never sees manager early
  assert.strictEqual(see({ kind: "manager", author: "R", viewer: "S", thisSubmitted: true, bothSubmitted: false }), false);
  // both in: reviewee, reviewer, admins
  assert.strictEqual(see({ kind: "manager", author: "R", viewer: "S", thisSubmitted: true, bothSubmitted: true }), true);
  assert.strictEqual(see({ kind: "self", author: "S", viewer: "A", viewerIsAdmin: true, thisSubmitted: true, bothSubmitted: true }), true);
  // a non-admin outsider never
  assert.strictEqual(see({ kind: "self", author: "S", viewer: "X", thisSubmitted: true, bothSubmitted: true }), false);
});

t("survey answered count", () => {
  assert.strictEqual(L.TR_surveyAnsweredCount({}), 0);
  assert.strictEqual(L.TR_surveyAnsweredCount({ q1: "a", q6_rating: 4, q8_choice: "same" }), 3);
  assert.strictEqual(L.TR_surveyAnsweredCount({ q7: "x", q10: "y", q6: " " }), 2);
});

t("anonymous threshold", () => {
  assert.strictEqual(L.TR_anonVisible(2), false);
  assert.strictEqual(L.TR_anonVisible(3), true);
  assert.strictEqual(L.TR_anonVisible(undefined), false);
});

t("year-end draft", () => {
  assert.strictEqual(L.TR_yearSummaryDraft([], "Gillian", "Jesse"), null);
  const r1 = { self: Object.assign(all(4), {}), manager: Object.assign(all(3), { cam_behavior: 5, cam_success: 5 }) };
  const r2 = { self: all(3), manager: Object.assign(all(3), { cam_behavior: 5, cam_success: 4, hh_behavior: 2 }) };
  const d = L.TR_yearSummaryDraft([r1, r2], "Gillian", "Jesse");
  assert.ok(d.strongest.startsWith("Camaraderie"));
  assert.ok(d.focus.startsWith("Healthy Hustle"));
  assert.ok(/narrowed/.test(d.alignment), d.alignment);
});

console.log("teamReviewsLogic: " + n + " checks passed");
