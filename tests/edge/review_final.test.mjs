// node --test tests/edge/*.test.mjs
// Renders the "review final" email with fake data only. Nothing is sent.
import test from "node:test";
import assert from "node:assert/strict";
import { finalEmail, changeText, fmtScore, textTable, finalRows } from "../../supabase/functions/team-reviews/finalemail.ts";

const fmt = (d) => (d ? `Fri, ${d.slice(5)}` : "");
const scores = (label, year, quarter, cam, own, hh, total, extra = {}) =>
  ({ label, year, quarter, camaraderie: cam, ownership: own, healthy_hustle: hh, total, ...extra });
const withPrior = {
  staff_name: "Jane Doe",
  current: scores("Q3 2026", 2026, 3, 4.5, 4, 3.5, 24),
  prior: scores("Q2 2026", 2026, 2, 4, 4, 4.5, 25, { consecutive: true }),
  changes: {
    camaraderie: { change: 0.5, direction: "up" },
    ownership: { change: 0, direction: "flat" },
    healthy_hustle: { change: -1, direction: "down" },
    total: { change: -1, direction: "down" },
  },
  steps: [
    { section: "ownership", description: "Update the client sheet <weekly>", owner: "staff", due_date: "2026-10-30" },
    { section: null, description: "Pair on month-end close", owner: "reviewer", due_date: null },
  ],
  steps_total: 2,
};
const opts = (o = {}) => ({ isReviewer: false, staffName: "Jane Doe", reviewerName: "John Roe", reviewLink: "https://x/#/team/reviews/r/1", fmtDate: fmt, ...o });

test("change words never rely on color", () => {
  assert.equal(changeText(0.5, "up"), "Up 0.5");
  assert.equal(changeText(-1, "down"), "Down 1");
  assert.equal(changeText(0, "flat"), "No change");
  assert.equal(changeText(2), "Up 2");
  assert.equal(changeText(-0.5), "Down 0.5");
  assert.equal(changeText(null), "–");
});

test("scores: one decimal per area, whole number overall", () => {
  assert.equal(fmtScore("camaraderie", 4), "4.0");
  assert.equal(fmtScore("ownership", 3.5), "3.5");
  assert.equal(fmtScore("total", 24), "24");
  assert.equal(fmtScore("total", null), "–");
});

test("staff version: subject, 'your' wording, table, steps, PDF line, CTA to the review", () => {
  const m = finalEmail(withPrior, opts());
  assert.equal(m.subject, "Q3 2026 review final: scores and quarter-over-quarter change");
  assert.match(m.lines[0], /^Your Q3 2026 review is signed by both of you and locked/);
  assert.equal(m.cta, "Open the review");
  assert.equal(m.href, "https://x/#/team/reviews/r/1");
  for (const h of ["Category", "This quarter (Q3 2026)", "Last quarter (Q2 2026)", "Change", "Camaraderie", "Ownership", "Healthy Hustle", "Overall (/30)"]) {
    assert.ok(m.html.includes(h), h);
  }
  assert.ok(m.html.includes("Up 0.5") && m.html.includes("No change") && m.html.includes("Down 1"));
  assert.ok(m.html.includes("&lt;weekly&gt;"), "step text is escaped");
  assert.ok(!m.html.includes("<weekly>"));
  assert.match(m.html, /Owner: You, due Fri, 10-30/);
  assert.match(m.html, /Owner: John Roe/);
  assert.match(m.html, /download the signed PDF from Reviews/);
  assert.doesNotMatch(m.html, /Compared with/);
  assert.doesNotMatch(m.html, /first locked review/);
});

test("reviewer version names the team member; admin with a filed PDF gets the Drive line", () => {
  const m = finalEmail(withPrior, opts({ isReviewer: true, adminWithFile: true }));
  assert.match(m.subject, /^Jane Doe's Q3 2026 review final/);
  assert.match(m.lines[0], /^Jane Doe's Q3 2026 review is signed/);
  assert.match(m.html, /Owner: Jane Doe, due/);
  assert.match(m.html, /Owner: You/);
  assert.match(m.html, /saved in the Staff Reviews Shared Drive/);
  assert.equal(m.href, "https://x/#/team/reviews/r/1", "CTA stays on the review, not Drive");
  const plain = finalEmail(withPrior, opts({ isReviewer: true }));
  assert.match(plain.html, /will be saved to Drive/);
});

test("first locked review: sentence instead of a comparison, no change column", () => {
  const first = { ...withPrior, prior: null, changes: null };
  const s = finalEmail(first, opts());
  assert.equal(s.subject, "Q3 2026 review final: scores");
  assert.match(s.html, /This is your first locked review, so there is no earlier quarter to compare with yet\./);
  assert.doesNotMatch(s.html, /Last quarter|Change|Up |Down /);
  assert.ok(s.textLines.includes("This is your first locked review, so there is no earlier quarter to compare with yet."));
  const r = finalEmail(first, opts({ isReviewer: true }));
  assert.match(r.html, /This is Jane Doe&#39;s first locked review/);
});

test("prior after a gap says which quarter it is", () => {
  const gap = { ...withPrior, prior: { ...withPrior.prior, label: "Q1 2026", quarter: 1, consecutive: false } };
  const m = finalEmail(gap, opts());
  assert.match(m.html, /Compared with Q1 2026, the most recent earlier locked review\./);
  assert.ok(m.html.includes("Earlier review (Q1 2026)"));
  assert.ok(!m.html.includes("Last quarter (Q1 2026)"));
  assert.ok(m.textLines.includes("Compared with Q1 2026, the most recent earlier locked review."));
});

test("plain text: aligned table with every row", () => {
  const m = finalEmail(withPrior, opts());
  const t = m.textLines;
  const head = t.find((l) => l.startsWith("Category"));
  const row = t.find((l) => l.startsWith("Healthy Hustle"));
  const overall = t.find((l) => l.startsWith("Overall (/30)"));
  assert.ok(head && row && overall);
  // Columns line up: "This quarter" starts at the same offset in every row.
  const col = head.indexOf("This quarter");
  assert.equal(row.slice(col, col + 3), "3.5");
  assert.equal(overall.slice(col, col + 2), "24");
  assert.ok(t.includes("Agreed action steps:"));
  assert.ok(t.some((l) => l.startsWith("- Update the client sheet <weekly> (Owner: You, due")));
  assert.deepEqual(textTable(["A", "Bb"], [["xyz", "1"]]), ["A     Bb", "---   --", "xyz   1"]);
});

test("steps: clipped, capped at 10, 'and N more' from steps_total", () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ section: null, description: (i === 0 ? "x".repeat(400) : `Step ${i}`), owner: "staff", due_date: null }));
  const m = finalEmail({ ...withPrior, steps: many, steps_total: 14 }, opts());
  assert.equal((m.html.match(/<li /g) || []).length, 10);
  assert.ok(!m.html.includes("x".repeat(300)));
  assert.match(m.html, /And 4 more in the portal\./);
  const none = finalEmail({ ...withPrior, steps: [], steps_total: 0 }, opts());
  assert.doesNotMatch(none.html, /Agreed action steps/);
});

test("never leaks comments, notes or self ratings even if present in the input", () => {
  const leaky = { ...withPrior, comment_ownership: "secret-comment", note_to_reviewer: "secret-note", self: { cam_behavior: 1 }, disagree_comment: "secret-disagree" };
  const m = finalEmail(leaky, opts());
  assert.doesNotMatch(JSON.stringify(m), /secret|cam_behavior/);
});

test("nothing to send without numbers", () => {
  assert.equal(finalEmail(null, opts()), null);
  assert.equal(finalEmail({}, opts()), null);
});

test("finalRows keeps the four rows in order", () => {
  assert.deepEqual(finalRows(withPrior).map((r) => r.title), ["Camaraderie", "Ownership", "Healthy Hustle", "Overall (/30)"]);
});
