// Tasks module: review loop and on-time rules (tasks phase 2, slice S3).
//
// Pure rules, no React, no DOM, no Supabase. The database is the authority:
// tk_approve / tk_send_back / tk_withdraw_review and the staff_reminders
// trigger enforce the same rules (supabase/tasks-p2-3-review.sql). These
// copies only decide what the UI offers and how it explains a refusal.
// The on-time math mirrors tk_on_time_stats and the wait credit in
// staff_reminders_before_write (decision 8, critique M5). Times are
// America/Chicago.
//
// Loads after TK_logic.js. Node test: `node components/tasks/TK_reviewLogic.test.js`.

var TK_REVIEW_REASON_MIN = 3;
var TK_REVIEW_REASON_MAX = 2000;
var TK_ON_TIME_TZ = "America/Chicago";
var TK_ON_TIME_SKIP_SOURCES = ["asana", "access_request"];

function TK__rvLower(s) {
  return s == null ? "" : String(s).trim().toLowerCase();
}

function TK__rvStatus(task) {
  if (!task) return "todo";
  if (task.status) return String(task.status);
  return task.done ? "done" : "todo";
}

// ---- Who may do what in review (M3) ---------------------------------------
// ctx: { me, isAdmin }. Returns the review controls for one task.
//   canApprove / canSendBack: an admin who is not the assignee or submitter.
//   canWithdraw: anyone who can edit it (the server checks); the UI offers it
//     to the assignee, the submitter and admins.
//   blockedReason: why an admin can't approve (their own work), else null.
function TK_reviewRole(task, ctx) {
  var me = TK__rvLower(ctx && ctx.me);
  var isAdmin = !!(ctx && ctx.isAdmin);
  var inReview = TK__rvStatus(task) === "ready_for_review" && !(task && task.deleted_at);
  // Owner fallback on purpose (S8b): an Unassigned task's owner still can't approve it.
  var assignee = TK__rvLower(task && (task.assignee_email || task.staff_email));
  var submitter = TK__rvLower(task && task.submitted_by);
  var isAssignee = !!me && me === assignee;
  var isSubmitter = !!me && me === submitter;
  var self = isAssignee || isSubmitter;
  var canReview = inReview && isAdmin && !!me && !self;
  return {
    inReview: inReview,
    isAssignee: isAssignee,
    isSubmitter: isSubmitter,
    isReviewer: inReview && !!me && TK__rvLower(task && task.reviewer_email) === me,
    canApprove: canReview,
    canSendBack: canReview,
    canWithdraw: inReview && (self || isAdmin),
    blockedReason: inReview && isAdmin && self ? "selfReview" : null,
  };
}

// Send-back reason: 3 to 2000 characters after trimming (tk_reason_required).
// Returns null when fine, else a TK_COPY key.
function TK_sendBackReasonError(text) {
  var n = String(text == null ? "" : text).trim().length;
  if (n < TK_REVIEW_REASON_MIN) return "reasonRequired";
  if (n > TK_REVIEW_REASON_MAX) return "reasonTooLong";
  return null;
}

// Server reason -> TK_COPY key (TK_api puts it on err.reason).
var TK_REVIEW_REASON_COPY = {
  tk_self_review: "selfReview",
  tk_needs_approval: "needsApproval",
  tk_in_review: "inReview",
  tk_reason_required: "reasonRequired",
  tk_bad_reviewer: "badReviewer",
  tk_server_owned: "serverOwned",
  tk_owner_only: "ownerOnly",
};

function TK_reviewErrorKey(err) {
  if (!err) return null;
  var r = err.reason ? String(err.reason) : "";
  if (r && TK_REVIEW_REASON_COPY[r]) return TK_REVIEW_REASON_COPY[r];
  var msg = String(err.message || "");
  for (var k in TK_REVIEW_REASON_COPY) {
    if (Object.prototype.hasOwnProperty.call(TK_REVIEW_REASON_COPY, k) && msg.indexOf(k) >= 0) return TK_REVIEW_REASON_COPY[k];
  }
  return null;
}

// ---- The review queue ------------------------------------------------------
// Splits open in-review tasks for one admin:
//   mine:     I'm the named reviewer.
//   anyone:   no reviewer named (any admin may approve).
//   others:   another admin is the reviewer (I can still approve).
//   own:      my own work waiting on someone else (no buttons).
// Each list is oldest submission first.
function TK_reviewQueueGroups(tasks, me) {
  var who = TK__rvLower(me);
  var out = { mine: [], anyone: [], others: [], own: [] };
  (tasks || []).forEach(function (t) {
    if (!t || t.deleted_at || TK__rvStatus(t) !== "ready_for_review") return;
    var role = TK_reviewRole(t, { me: who, isAdmin: true });
    if (role.isAssignee || role.isSubmitter) out.own.push(t);
    else if (role.isReviewer) out.mine.push(t);
    else if (!t.reviewer_email) out.anyone.push(t);
    else out.others.push(t);
  });
  var byAge = function (a, b) {
    var x = String(a.submitted_at || a.ready_at || "");
    var y = String(b.submitted_at || b.ready_at || "");
    if (x !== y) return x < y ? -1 : 1;
    return String(a.id || "") < String(b.id || "") ? -1 : 1;
  };
  out.mine.sort(byAge);
  out.anyone.sort(byAge);
  out.others.sort(byAge);
  out.own.sort(byAge);
  return out;
}

// The count on the sidebar Review item: what this admin can act on.
function TK_reviewQueueCount(tasks, me) {
  var g = TK_reviewQueueGroups(tasks, me);
  return g.mine.length + g.anyone.length + g.others.length;
}

// "Waiting 3 h" / "Waiting 2 days" since the latest submission.
function TK_reviewWaitLabel(task, nowMs) {
  var at = task && (task.submitted_at || task.ready_at);
  var t = at ? Date.parse(at) : NaN;
  if (isNaN(t)) return "";
  var now = typeof nowMs === "number" ? nowMs : Date.now();
  var mins = Math.max(0, Math.floor((now - t) / 60000));
  if (mins < 60) return "Waiting " + (mins < 1 ? "under a minute" : mins + " min");
  var hours = Math.floor(mins / 60);
  if (hours < 24) return "Waiting " + hours + " h";
  var days = Math.floor(hours / 24);
  return "Waiting " + days + (days === 1 ? " day" : " days");
}

// ---- On-time (decision 8, critique M5) -------------------------------------

// Minutes the zone is ahead of UTC at instant ms (Chicago: -360 or -300).
function TK__tzOffsetMin(ms, tz) {
  var f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  var p = {};
  f.formatToParts(new Date(ms)).forEach(function (x) {
    p[x.type] = x.value;
  });
  var asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}

// UTC ms of midnight that starts `ymd` in America/Chicago.
function TK_chicagoMidnight(ymd) {
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ""));
  if (!m) return NaN;
  var wall = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  var guess = wall - TK__tzOffsetMin(wall, TK_ON_TIME_TZ) * 60000;
  // One more pass lands on the right side of a DST change.
  return wall - TK__tzOffsetMin(guess, TK_ON_TIME_TZ) * 60000;
}

function TK__addDay(ymd) {
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ""));
  if (!m) return null;
  var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + 1));
  var p = function (n) {
    return n < 10 ? "0" + n : String(n);
  };
  return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate());
}

function TK__ms(v) {
  if (v == null || v === "") return NaN;
  return typeof v === "number" ? v : Date.parse(v);
}

// The deadline before any running wait: the end of due_date_original in
// Chicago, plus the credited client-wait minutes. NaN when there's no due date.
function TK_baseDeadline(task) {
  if (!task || !task.due_date_original) return NaN;
  var next = TK__addDay(task.due_date_original);
  var mins = Number(task.waiting_before_due_minutes) > 0 ? Number(task.waiting_before_due_minutes) : 0;
  return TK_chicagoMidnight(next) + mins * 60000;
}

// The effective deadline now: a wait still running that began before the
// base deadline moves it by the time waited so far.
function TK_effectiveDeadline(task, nowMs) {
  var dl0 = TK_baseDeadline(task);
  if (isNaN(dl0)) return NaN;
  var now = typeof nowMs === "number" ? nowMs : Date.now();
  var since = TK__ms(task.waiting_since);
  if (TK__rvStatus(task) === "waiting_client" && !isNaN(since) && since < dl0) return dl0 + Math.max(0, now - since);
  return dl0;
}

// New waiting_before_due_minutes when a task leaves waiting_client at
// leftMs: the whole wait counts if it began before the deadline.
function TK_creditWait(task, leftMs) {
  var had = Number(task && task.waiting_before_due_minutes) > 0 ? Number(task.waiting_before_due_minutes) : 0;
  var since = TK__ms(task && task.waiting_since);
  var dl = TK_baseDeadline(task);
  if (isNaN(dl) || isNaN(since) || !(since < dl)) return had;
  return had + Math.max(0, Math.floor((leftMs - since) / 60000));
}

// Is this task part of the on-time metric at all (before timing)?
// Template tasks, or tasks someone other than the assignee created; never
// Asana imports or access requests; needs an original due date.
// Test clients and internal clients are filtered by the server.
function TK_onTimeEligible(task) {
  if (!task || !task.due_date_original) return false;
  var src = String(task.source || "manual");
  if (TK_ON_TIME_SKIP_SOURCES.indexOf(src) >= 0) return false;
  if (src === "template") return true;
  var creator = TK__rvLower(task.created_by);
  // Owner fallback on purpose (S8b): an Unassigned task counts against its owner.
  var assignee = TK__rvLower(task.assignee_email || task.staff_email);
  return creator !== assignee;
}

// The outcome for one task at nowMs, or null when it doesn't count (yet):
//   { onTime, at, deadline, hoursLate }
// Counted: done tasks (at = completed_at), open tasks past the deadline (late,
// at = deadline), deleted tasks only if deleted after the deadline.
// Approval time is what counts: a send-back is fine if approval lands in time.
function TK_onTimeOutcome(task, nowMs) {
  if (!TK_onTimeEligible(task)) return null;
  var now = typeof nowMs === "number" ? nowMs : Date.now();
  var dl = TK_effectiveDeadline(task, now);
  if (isNaN(dl)) return null;
  var deleted = TK__ms(task.deleted_at);
  if (!isNaN(deleted) && !(deleted > dl)) return null;
  var status = TK__rvStatus(task);
  if (status === "done") {
    var done = TK__ms(task.completed_at);
    if (isNaN(done)) return null;
    var ok = done <= dl;
    return { onTime: ok, at: done, deadline: dl, hoursLate: ok ? 0 : Math.round(((done - dl) / 3600000) * 10) / 10 };
  }
  if (!(dl < now)) return null;
  var end = !isNaN(deleted) ? deleted : now;
  return { onTime: false, at: dl, deadline: dl, hoursLate: Math.round(((end - dl) / 3600000) * 10) / 10 };
}

// "92% on time (23 of 25)" style summary from tk_on_time_stats rows.
function TK_onTimeSummary(row) {
  var r = row || {};
  var eligible = Number(r.eligible) || 0;
  var onTime = Number(r.on_time) || 0;
  if (!eligible) return "No tasks with a deadline yet";
  return Math.round((onTime / eligible) * 100) + "% on time (" + onTime + " of " + eligible + ")";
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    TK_REVIEW_REASON_MIN: TK_REVIEW_REASON_MIN,
    TK_REVIEW_REASON_MAX: TK_REVIEW_REASON_MAX,
    TK_REVIEW_REASON_COPY: TK_REVIEW_REASON_COPY,
    TK_reviewRole: TK_reviewRole,
    TK_sendBackReasonError: TK_sendBackReasonError,
    TK_reviewErrorKey: TK_reviewErrorKey,
    TK_reviewQueueGroups: TK_reviewQueueGroups,
    TK_reviewQueueCount: TK_reviewQueueCount,
    TK_reviewWaitLabel: TK_reviewWaitLabel,
    TK_chicagoMidnight: TK_chicagoMidnight,
    TK_baseDeadline: TK_baseDeadline,
    TK_effectiveDeadline: TK_effectiveDeadline,
    TK_creditWait: TK_creditWait,
    TK_onTimeEligible: TK_onTimeEligible,
    TK_onTimeOutcome: TK_onTimeOutcome,
    TK_onTimeSummary: TK_onTimeSummary,
  };
}
