// Team Reviews: pure rules shared by the UI (TeamReviews.jsx) and the node
// test (teamReviewsLogic.test.js). No React, no Supabase.
//
// The server enforces the same rules (supabase/team-reviews-2-rpcs.sql:
// tr_submission_problems, tr_can_see_submission, tr_needs_action_step). These
// copies are for instant feedback in the form; the database has the final say.

var TR_SCALE = [
  { value: 1, label: "Not meeting expectations" },
  { value: 2, label: "Partly meeting" },
  { value: 3, label: "Meeting" },
  { value: 4, label: "Often exceeding" },
  { value: 5, label: "Consistently exceeding" },
];

function TR_scaleLabel(v) {
  for (var i = 0; i < TR_SCALE.length; i++) if (TR_SCALE[i].value === v) return TR_SCALE[i].label;
  return "";
}

var TR_SECTIONS = [
  { key: "camaraderie", title: "Camaraderie", comment: "comment_camaraderie" },
  { key: "ownership", title: "Ownership", comment: "comment_ownership" },
  { key: "healthy_hustle", title: "Healthy Hustle", comment: "comment_healthy_hustle" },
];

var TR_ITEMS = [
  {
    key: "cam_behavior", section: "camaraderie", kind: "Behavior",
    title: "Support, encourage, and challenge our team",
    details: ["Actively participating and providing feedback to the team"],
  },
  {
    key: "cam_success", section: "camaraderie", kind: "Success",
    title: "Invest expertise and personal care in our clients",
    details: ["Providing exceptional service to clients", "Demonstrating expertise and care to clients in meaningful ways"],
  },
  {
    key: "own_behavior", section: "ownership", kind: "Behavior",
    title: "We own our tools, deadlines, and clients",
    details: [
      "Gmail: respond to clients within 24 hours (when working)",
      "Google Chat: respond to the team within 1 hour when working",
      "Google Calendar: working hours and off hours managed",
      "Asana: no overdue tasks, ever",
      "Google Drive: statements, reports and client documents stored",
      "Internal Client Detail Sheet: kept up to date",
    ],
  },
  {
    key: "own_success", section: "ownership", kind: "Success",
    title: "Maintaining and encouraging efficiency with our clients, team, and self",
    details: [],
  },
  {
    key: "hh_behavior", section: "healthy_hustle", kind: "Behavior",
    title: "Disciplined work-life balance",
    details: ["10-minute break per hour worked", "Not working when not scheduled", "100% focus and responsiveness when working"],
  },
  {
    key: "hh_success", section: "healthy_hustle", kind: "Success",
    title: "Managing our “allowable hours per client” well",
    details: ["Managing calendared hours well, occasionally checking the time clock, and asking for support to manage time"],
  },
];

var TR_MAX_TOTAL = 30;
var TR_ACTION_TOTAL = 18; // a total below this needs an action step
var TR_LOW = 3; // a rating below this needs an action step

function TR_isRating(v) {
  return typeof v === "number" && v >= 1 && v <= 5 && Math.floor(v) === v;
}

function TR_ratedCount(sub) {
  var n = 0;
  for (var i = 0; i < TR_ITEMS.length; i++) if (sub && TR_isRating(sub[TR_ITEMS[i].key])) n++;
  return n;
}

// Total of the six ratings, or null until all six are rated.
function TR_total(sub) {
  if (TR_ratedCount(sub) < TR_ITEMS.length) return null;
  var t = 0;
  for (var i = 0; i < TR_ITEMS.length; i++) t += sub[TR_ITEMS[i].key];
  return t;
}

function TR_partialTotal(sub) {
  var t = 0;
  for (var i = 0; i < TR_ITEMS.length; i++) if (sub && TR_isRating(sub[TR_ITEMS[i].key])) t += sub[TR_ITEMS[i].key];
  return t;
}

function TR_sectionHasLow(sub, sectionKey) {
  for (var i = 0; i < TR_ITEMS.length; i++) {
    var it = TR_ITEMS[i];
    if (it.section === sectionKey && sub && TR_isRating(sub[it.key]) && sub[it.key] < TR_LOW) return true;
  }
  return false;
}

// Any rating below 3, or (once all rated) a total below 18.
function TR_needsActionStep(sub) {
  for (var i = 0; i < TR_ITEMS.length; i++) {
    if (sub && TR_isRating(sub[TR_ITEMS[i].key]) && sub[TR_ITEMS[i].key] < TR_LOW) return true;
  }
  var t = TR_total(sub);
  return t !== null && t < TR_ACTION_TOTAL;
}

// Section keys whose comment is required right now.
function TR_requiredComments(sub) {
  var t = TR_total(sub);
  var all = t !== null && t < TR_ACTION_TOTAL;
  var out = [];
  for (var i = 0; i < TR_SECTIONS.length; i++) {
    if (all || TR_sectionHasLow(sub, TR_SECTIONS[i].key)) out.push(TR_SECTIONS[i].key);
  }
  return out;
}

function TR_blank(s) {
  return !s || String(s).trim() === "";
}

// Mirrors tr_submission_problems in SQL. Empty array = can submit.
function TR_validateSubmission(sub) {
  if (TR_ratedCount(sub) < TR_ITEMS.length) return ["Rate all six items before submitting"];
  var probs = [];
  var req = TR_requiredComments(sub);
  var missing = [];
  for (var i = 0; i < TR_SECTIONS.length; i++) {
    var s = TR_SECTIONS[i];
    if (req.indexOf(s.key) >= 0 && TR_blank(sub[s.comment])) missing.push(s.title);
  }
  if (missing.length) probs.push("Add comments for: " + missing.join(", "));
  if (TR_needsActionStep(sub) && TR_blank(sub.action_steps)) {
    probs.push("Add an action step (a rating below 3 or a total below 18 needs one)");
  }
  return probs;
}

// Comparison rows: either score below 3 -> action; gap >= 2 -> discuss; else aligned.
function TR_compareRows(self, mgr) {
  return TR_ITEMS.map(function (it) {
    var a = self ? self[it.key] : null;
    var b = mgr ? mgr[it.key] : null;
    var gap = TR_isRating(a) && TR_isRating(b) ? Math.abs(a - b) : null;
    var result = "aligned";
    if ((TR_isRating(a) && a < TR_LOW) || (TR_isRating(b) && b < TR_LOW)) result = "action";
    else if (gap !== null && gap >= 2) result = "discuss";
    return { key: it.key, item: it, self: a, manager: b, gap: gap, result: result };
  });
}

function TR_itemsToDiscuss(rows) {
  return rows.filter(function (r) { return r.result !== "aligned"; }).length;
}

// Mirrors tr_can_see_submission in SQL (the blind rule).
function TR_canSeeSubmission(o) {
  if (!o.viewer) return false;
  if (o.viewer === o.author) return true;
  if (!o.thisSubmitted) return false;
  if (o.bothSubmitted) return o.viewer === o.staffId || o.viewer === o.reviewerId || !!o.viewerIsAdmin;
  if (o.kind === "manager" && o.viewerIsAdmin && o.viewer !== o.staffId) return true;
  return false;
}

// Survey: Q6 and Q8 count if either part is filled.
var TR_SURVEY_MIN = 3;
function TR_surveyAnsweredCount(a) {
  a = a || {};
  var n = 0;
  ["q1", "q2", "q3", "q4", "q5", "q7", "q9", "q10"].forEach(function (k) { if (!TR_blank(a[k])) n++; });
  if (!TR_blank(a.q6) || TR_isRating(a.q6_rating)) n++;
  if (!TR_blank(a.q8) || ["more", "same", "less"].indexOf(a.q8_choice) >= 0) n++;
  return n;
}

// Anonymous groups are shown only once 3 or more people answered.
var TR_ANON_MIN = 3;
function TR_anonVisible(count) {
  return typeof count === "number" && count >= TR_ANON_MIN;
}

function TR_sectionAvg(sub, sectionKey) {
  var vals = [];
  TR_ITEMS.forEach(function (it) { if (it.section === sectionKey && sub && TR_isRating(sub[it.key])) vals.push(sub[it.key]); });
  if (!vals.length) return null;
  return vals.reduce(function (s, v) { return s + v; }, 0) / vals.length;
}

// Year-end draft from the year's reviews (both forms in). Text is a DRAFT:
// an admin must edit or confirm it before it can be exported.
function TR_yearSummaryDraft(reviews, staffName, reviewerName) {
  var done = (reviews || []).filter(function (r) { return r && r.self && r.manager; });
  if (!done.length) return null;
  var who = staffName || "This team member";
  var rev = reviewerName || "the reviewer";
  var avgs = TR_SECTIONS.map(function (s) {
    var vals = done.map(function (r) { return TR_sectionAvg(r.manager, s.key); }).filter(function (v) { return v !== null; });
    var avg = vals.reduce(function (a, b) { return a + b; }, 0) / (vals.length || 1);
    return { key: s.key, title: s.title, avg: avg };
  });
  var sorted = avgs.slice().sort(function (a, b) { return b.avg - a.avg; });
  var strongest = sorted[0];
  var focus = sorted[sorted.length - 1];
  var gaps = done.map(function (r) {
    var g = 0;
    TR_ITEMS.forEach(function (it) { g += Math.abs(r.self[it.key] - r.manager[it.key]); });
    return g / TR_ITEMS.length;
  });
  var avgGap = gaps.reduce(function (a, b) { return a + b; }, 0) / gaps.length;
  var first = gaps[0], last = gaps[gaps.length - 1];
  var trend = gaps.length < 2 ? "" : last < first ? " and narrowed over the year" : last > first ? " and widened over the year" : " and held steady over the year";
  var q = done.length === 1 ? "1 quarter" : done.length + " quarters";
  return {
    strongest: strongest.title + " was the strongest area across " + q + " (average " + strongest.avg.toFixed(1) + " of 5 in " + rev + "’s reviews).",
    focus: focus.title + " is the main focus area for next year (average " + focus.avg.toFixed(1) + " of 5).",
    alignment: who + "’s self-ratings and " + rev + "’s ratings were " + avgGap.toFixed(1) + " points apart per item on average" + trend + ".",
  };
}

function TR_fmtDate(iso, opts) {
  if (!iso) return "";
  var d = typeof iso === "string" && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(iso + "T12:00:00") : new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", opts || { month: "short", day: "numeric" });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    TR_SCALE: TR_SCALE, TR_scaleLabel: TR_scaleLabel, TR_SECTIONS: TR_SECTIONS, TR_ITEMS: TR_ITEMS,
    TR_total: TR_total, TR_partialTotal: TR_partialTotal, TR_ratedCount: TR_ratedCount,
    TR_needsActionStep: TR_needsActionStep, TR_requiredComments: TR_requiredComments,
    TR_validateSubmission: TR_validateSubmission, TR_compareRows: TR_compareRows,
    TR_itemsToDiscuss: TR_itemsToDiscuss, TR_canSeeSubmission: TR_canSeeSubmission,
    TR_surveyAnsweredCount: TR_surveyAnsweredCount, TR_anonVisible: TR_anonVisible,
    TR_yearSummaryDraft: TR_yearSummaryDraft, TR_sectionAvg: TR_sectionAvg, TR_fmtDate: TR_fmtDate,
  };
}
