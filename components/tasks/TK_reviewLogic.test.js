// node components/tasks/TK_reviewLogic.test.js
const assert = require("assert");
const L = require("./TK_reviewLogic.js");
const C = require("./TK_logic.js");
let n = 0;
function t(name, fn) {
  try {
    fn();
  } catch (e) {
    console.error("FAIL " + name);
    throw e;
  }
  n++;
}

const A1 = "a1@x.test";
const A2 = "a2@x.test";
const BK = "bk@x.test";
function rv(extra) {
  return Object.assign({ id: "t1", status: "ready_for_review", review_required: true, assignee_email: BK, submitted_by: BK }, extra || {});
}

// ---- Who may review (M3)
t("an admin who isn't the assignee or submitter may approve and send back", () => {
  const r = L.TK_reviewRole(rv(), { me: A1, isAdmin: true });
  assert.strictEqual(r.canApprove, true);
  assert.strictEqual(r.canSendBack, true);
  assert.strictEqual(r.canWithdraw, true);
  assert.strictEqual(r.blockedReason, null);
});
t("a bookkeeper never approves; the assignee may withdraw", () => {
  const r = L.TK_reviewRole(rv(), { me: "BK@x.test", isAdmin: false });
  assert.strictEqual(r.canApprove, false);
  assert.strictEqual(r.canSendBack, false);
  assert.strictEqual(r.canWithdraw, true);
  assert.strictEqual(r.isAssignee, true);
  const other = L.TK_reviewRole(rv(), { me: "other@x.test", isAdmin: false });
  assert.strictEqual(other.canWithdraw, false);
});
t("an admin can't approve their own work or what they submitted", () => {
  const own = L.TK_reviewRole(rv({ assignee_email: A1, submitted_by: A1 }), { me: A1, isAdmin: true });
  assert.strictEqual(own.canApprove, false);
  assert.strictEqual(own.blockedReason, "selfReview");
  // Reassigned after submitting: the submitter is still blocked.
  const sub = L.TK_reviewRole(rv({ assignee_email: BK, submitted_by: A1 }), { me: A1, isAdmin: true });
  assert.strictEqual(sub.canApprove, false);
  assert.strictEqual(sub.blockedReason, "selfReview");
});
t("not in review: no review controls", () => {
  const r = L.TK_reviewRole(rv({ status: "in_progress" }), { me: A1, isAdmin: true });
  assert.deepStrictEqual([r.inReview, r.canApprove, r.canSendBack, r.canWithdraw], [false, false, false, false]);
  const del = L.TK_reviewRole(rv({ deleted_at: "2026-10-15T00:00:00Z" }), { me: A1, isAdmin: true });
  assert.strictEqual(del.canApprove, false);
});
t("the named reviewer is recognised", () => {
  assert.strictEqual(L.TK_reviewRole(rv({ reviewer_email: A2 }), { me: "A2@x.test", isAdmin: true }).isReviewer, true);
  assert.strictEqual(L.TK_reviewRole(rv({ reviewer_email: A2 }), { me: A1, isAdmin: true }).isReviewer, false);
});
t("the pill and the role agree", () => {
  [A1, BK].forEach((me) =>
    [true, false].forEach((isAdmin) => {
      const task = rv();
      const role = L.TK_reviewRole(task, { me, isAdmin });
      const items = C.TK_nextStatuses(task, { me, isAdmin });
      assert.strictEqual(items.some((x) => x.action === "approve"), role.canApprove, me + isAdmin);
      assert.strictEqual(items.some((x) => x.action === "send_back"), role.canSendBack, me + isAdmin);
    }),
  );
});

// ---- Send-back reason
t("send back needs 3 to 2000 characters", () => {
  assert.strictEqual(L.TK_sendBackReasonError(""), "reasonRequired");
  assert.strictEqual(L.TK_sendBackReasonError("  ok  "), "reasonRequired");
  assert.strictEqual(L.TK_sendBackReasonError(null), "reasonRequired");
  assert.strictEqual(L.TK_sendBackReasonError("Fix"), null);
  assert.strictEqual(L.TK_sendBackReasonError("x".repeat(2000)), null);
  assert.strictEqual(L.TK_sendBackReasonError("x".repeat(2001)), "reasonTooLong");
});
t("server reasons map to copy keys that exist", () => {
  Object.keys(L.TK_REVIEW_REASON_COPY).forEach((k) => assert.ok(C.TK_COPY[L.TK_REVIEW_REASON_COPY[k]], k));
  assert.ok(C.TK_COPY.reasonTooLong);
  assert.strictEqual(L.TK_reviewErrorKey({ reason: "tk_self_review" }), "selfReview");
  assert.strictEqual(L.TK_reviewErrorKey({ message: 'P0001: tk_in_review' }), "inReview");
  assert.strictEqual(L.TK_reviewErrorKey({ code: "tk_forbidden", message: "tk_forbidden" }), null);
  assert.strictEqual(L.TK_reviewErrorKey(null), null);
});

// ---- Queue
t("queue groups and order", () => {
  const tasks = [
    rv({ id: "1", reviewer_email: A1, submitted_at: "2026-10-14T10:00:00Z" }),
    rv({ id: "2", reviewer_email: null, submitted_at: "2026-10-13T10:00:00Z" }),
    rv({ id: "3", reviewer_email: A2, submitted_at: "2026-10-12T10:00:00Z" }),
    rv({ id: "4", assignee_email: A1, submitted_by: A1, reviewer_email: A2, submitted_at: "2026-10-11T10:00:00Z" }),
    rv({ id: "5", reviewer_email: A1, submitted_at: "2026-10-10T10:00:00Z" }),
    rv({ id: "6", status: "in_progress" }),
    rv({ id: "7", deleted_at: "2026-10-14T00:00:00Z" }),
  ];
  const g = L.TK_reviewQueueGroups(tasks, A1);
  assert.deepStrictEqual(g.mine.map((x) => x.id), ["5", "1"]);
  assert.deepStrictEqual(g.anyone.map((x) => x.id), ["2"]);
  assert.deepStrictEqual(g.others.map((x) => x.id), ["3"]);
  assert.deepStrictEqual(g.own.map((x) => x.id), ["4"]);
  assert.strictEqual(L.TK_reviewQueueCount(tasks, A1), 4);
  assert.strictEqual(L.TK_reviewQueueCount([], A1), 0);
});
t("wait label", () => {
  const now = Date.parse("2026-10-15T12:00:00Z");
  assert.strictEqual(L.TK_reviewWaitLabel({ submitted_at: "2026-10-15T11:59:40Z" }, now), "Waiting under a minute");
  assert.strictEqual(L.TK_reviewWaitLabel({ submitted_at: "2026-10-15T11:20:00Z" }, now), "Waiting 40 min");
  assert.strictEqual(L.TK_reviewWaitLabel({ submitted_at: "2026-10-15T09:00:00Z" }, now), "Waiting 3 h");
  assert.strictEqual(L.TK_reviewWaitLabel({ ready_at: "2026-10-14T09:00:00Z" }, now), "Waiting 1 day");
  assert.strictEqual(L.TK_reviewWaitLabel({ submitted_at: "2026-10-12T09:00:00Z" }, now), "Waiting 3 days");
  assert.strictEqual(L.TK_reviewWaitLabel({}, now), "");
});

// ---- Chicago days
t("chicago midnight follows daylight saving", () => {
  assert.strictEqual(new Date(L.TK_chicagoMidnight("2026-10-15")).toISOString(), "2026-10-15T05:00:00.000Z"); // CDT
  assert.strictEqual(new Date(L.TK_chicagoMidnight("2026-12-01")).toISOString(), "2026-12-01T06:00:00.000Z"); // CST
  assert.strictEqual(new Date(L.TK_chicagoMidnight("2026-03-08")).toISOString(), "2026-03-08T06:00:00.000Z"); // spring-forward day
  assert.strictEqual(new Date(L.TK_chicagoMidnight("2026-11-01")).toISOString(), "2026-11-01T05:00:00.000Z"); // fall-back day
  assert.ok(isNaN(L.TK_chicagoMidnight("nope")));
});
t("base deadline is the end of the original due day plus credited wait", () => {
  const dl = L.TK_baseDeadline({ due_date_original: "2026-10-14", waiting_before_due_minutes: 90 });
  assert.strictEqual(new Date(dl).toISOString(), "2026-10-15T06:30:00.000Z");
  assert.ok(isNaN(L.TK_baseDeadline({ due_date_original: null })));
});

// ---- On-time cases (mirror tasks-p2-3-review-tests.sql section 9)
const DAY = 86400000;
const NOW = Date.parse("2026-10-15T17:00:00Z"); // noon in Chicago
function ymd(offsetDays) {
  return new Date(NOW + offsetDays * DAY - 5 * 3600000).toISOString().slice(0, 10);
}
function ot(extra) {
  return Object.assign({ created_by: A2, assignee_email: BK, source: "manual", status: "todo" }, extra);
}
const nowIso = new Date(NOW).toISOString();
function leaveWait(task, sinceMs) {
  const w = Object.assign({}, task, { waiting_since: new Date(sinceMs).toISOString() });
  return Object.assign({}, task, { waiting_before_due_minutes: L.TK_creditWait(w, NOW) });
}
const cases = {
  a: ot({ due_date_original: ymd(1), status: "done", completed_at: nowIso }),
  b: ot({ due_date_original: ymd(-3), status: "done", completed_at: nowIso }),
  c: Object.assign(leaveWait(ot({ due_date_original: ymd(-3) }), NOW - 5 * DAY), { status: "done", completed_at: nowIso }),
  d: Object.assign(leaveWait(ot({ due_date_original: ymd(-3) }), NOW - 1 * DAY), { status: "done", completed_at: nowIso }),
  e: ot({ due_date_original: ymd(-3) }),
  f: ot({ due_date_original: ymd(-3), deleted_at: nowIso }),
  g: ot({ due_date_original: ymd(1), deleted_at: nowIso }),
  h: ot({ due_date_original: ymd(-3), created_by: BK, status: "done", completed_at: nowIso }),
  i: ot({ due_date_original: ymd(1), status: "done", completed_at: nowIso, send_back_count: 1 }),
};
t("wait credit: before the deadline counts in full, after it not at all", () => {
  assert.strictEqual(cases.c.waiting_before_due_minutes, 5 * 24 * 60);
  assert.strictEqual(cases.d.waiting_before_due_minutes, 0);
  assert.strictEqual(L.TK_creditWait(ot({ due_date_original: null, waiting_since: nowIso }), NOW + DAY), 0);
});
t("on-time a-i: 7 eligible, 3 on time (same as the SQL self-test)", () => {
  const out = {};
  Object.keys(cases).forEach((k) => (out[k] = L.TK_onTimeOutcome(cases[k], NOW)));
  const counted = Object.keys(out).filter((k) => out[k]);
  assert.deepStrictEqual(counted, ["a", "b", "c", "d", "e", "f", "i"]);
  assert.deepStrictEqual(counted.filter((k) => out[k].onTime), ["a", "c", "i"]);
  assert.ok(out.b.hoursLate > 48);
  assert.strictEqual(out.e.at, L.TK_baseDeadline(cases.e));
});
t("a running wait that began before the deadline pushes it out", () => {
  const task = ot({ due_date_original: ymd(-1), status: "waiting_client", waiting_since: new Date(NOW - 2 * DAY).toISOString() });
  assert.strictEqual(L.TK_effectiveDeadline(task, NOW), L.TK_baseDeadline(task) + 2 * DAY);
  assert.strictEqual(L.TK_onTimeOutcome(task, NOW), null); // not late yet
  const late = ot({ due_date_original: ymd(-3), status: "waiting_client", waiting_since: new Date(NOW - DAY).toISOString() });
  assert.strictEqual(L.TK_effectiveDeadline(late, NOW), L.TK_baseDeadline(late));
  assert.strictEqual(L.TK_onTimeOutcome(late, NOW).onTime, false);
});
t("eligibility rules (M5)", () => {
  assert.strictEqual(L.TK_onTimeEligible(ot({ due_date_original: ymd(1) })), true);
  assert.strictEqual(L.TK_onTimeEligible(ot({ due_date_original: ymd(1), created_by: "BK@x.test" })), false);
  assert.strictEqual(L.TK_onTimeEligible(ot({ due_date_original: ymd(1), created_by: BK, source: "template" })), true);
  assert.strictEqual(L.TK_onTimeEligible(ot({ due_date_original: ymd(1), source: "asana" })), false);
  assert.strictEqual(L.TK_onTimeEligible(ot({ due_date_original: ymd(1), source: "access_request" })), false);
  assert.strictEqual(L.TK_onTimeEligible(ot({ due_date_original: null })), false);
  assert.strictEqual(L.TK_onTimeOutcome(ot({ due_date_original: ymd(1) }), NOW), null); // open, not due yet
  assert.strictEqual(L.TK_onTimeOutcome(ot({ due_date_original: ymd(-3), status: "done" }), NOW), null); // no completed_at
});
t("summary text", () => {
  assert.strictEqual(L.TK_onTimeSummary({ eligible: 25, on_time: 23 }), "92% on time (23 of 25)");
  assert.strictEqual(L.TK_onTimeSummary({ eligible: 0, on_time: 0 }), "No tasks with a deadline yet");
  assert.strictEqual(L.TK_onTimeSummary(null), "No tasks with a deadline yet");
});

console.log(n + " checks passed");
