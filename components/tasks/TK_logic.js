// Tasks module: shared pure rules (docs/tasks-phase1-spec.md, C4).
// Statuses and the review gate, grouping for My Tasks, dates and business
// days, quick add parsing, mentions, routes, the keymap and key guard, the
// edit hint, the task normalizer, missing-schema hints and the fixed copy.
//
// No React, no DOM writes, no Supabase. Loaded first of the TK files, so
// later TK files may use these names at their top level. Node test:
// `node components/tasks/TK_logic.test.js`.

// ---- Constants
var TK_STATUSES = ["todo", "in_progress", "waiting_client", "ready_for_review", "done"];
var TK_STATUS_LABELS = {
  todo: "To do",
  in_progress: "In progress",
  waiting_client: "Waiting on client",
  ready_for_review: "Ready for review",
  done: "Done",
};
var TK_PRIORITIES = ["high", "normal", "low"];
var TK_PRIORITY_LABELS = { high: "High", normal: "Normal", low: "Low" };
// Must equal the ids of CLIENT_SOP_SECTIONS in app.jsx.
var TK_SOP_SECTION_IDS = ["access", "bank_feeds", "monthly_close", "payroll", "bills_vendors", "reporting", "quirks"];
var TK_SOON_DAYS = 7;
var TK_OLD_DONE_MONTHS = 12;
var TK_CLIENT_SECTION_ORDER = ["Weekly", "Monthly", "Quarterly", "Annual", "Occasional"];

// The task module's display name (it was "Tasks"). Identifiers (TK_*, tk_*,
// #/tasks) never change; code outside TK_ reads it with a typeof guard.
var SLATE_NAME = "Slate";

var TK_COPY = {
  setupTitle: SLATE_NAME + " is being set up",
  setupBody: "Your tasks are safe. This page fills in as soon as the update is finished. Until then, use Work › " + SLATE_NAME + ".",
  offline: "You're offline. Showing what was already loaded. Changes are paused until you're back online.",
  loadError: "Couldn't load your tasks.",
  retry: "Try again",
  saveError: "Couldn't save that change. Try again.",
  conflict: "Someone else just changed this task. Showing the latest.",
  reverted: "Only the task's owner or an admin can change that.",
  sentForReview: "Sent for review. An admin will approve it.",
  approved: "Approved.",
  sentBack: "Sent back with your note.",
  withdrawn: "Taken back from review.",
  awaitingReview: "This is waiting for an admin to approve it.",
  selfReview: "You can't approve your own work. Another admin will review it.",
  needsApproval: "Only an admin can approve this.",
  inReview: "This is in review. Take it back from review before you reassign it.",
  reasonRequired: "Add a short note on what needs another look.",
  reasonTooLong: "Keep the note under 2,000 characters.",
  badReviewer: "Pick an active admin who isn't doing the work.",
  serverOwned: "That part is set by the app and can't be edited.",
  ownerOnly: "Only the owner can change that setting.",
  reviewEmpty: "Nothing is waiting for review.",
  deleted: "Task deleted.",
  restored: "Task restored.",
  emptyMine: "Nothing assigned to you. Press q or Add task to start one.",
  emptyMineTouch: "Nothing assigned to you. Tap Add task to start one.",
  emptyList: "No tasks here yet.",
  emptySearch: "No tasks match that.",
  popupBlocked: "Your browser blocked the new window. Allow pop-ups for this site and try again.",
  personAdminOnly: "Only admins can see another person's list.",
  notFound: "We couldn't find that list.",
  deletedBanner: "This task was deleted.",
  noClientAccess: "They can't see this client yet, so they won't see this task.",
  driveOff: "File storage isn't connected yet. Add a link instead.",
  linkCopied: "Link copied.",
  projectNameTaken: "There's already a project with that name. Try another name.",
  openToStaff: "Open to all staff",
  openToStaffHelp: "Everyone on staff can see this project and add tasks to it.",
  taskAdded: "Task added.",
};

// ---- Small helpers
function TK__lower(s) {
  return s == null ? "" : String(s).trim().toLowerCase();
}

var TK__YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function TK__ymdParts(ymd) {
  var m = TK__YMD_RE.exec(String(ymd || "").slice(0, 10));
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

function TK__pad2(n) {
  return n < 10 ? "0" + n : String(n);
}

function TK__ymdFromUTC(ms) {
  var dt = new Date(ms);
  return dt.getUTCFullYear() + "-" + TK__pad2(dt.getUTCMonth() + 1) + "-" + TK__pad2(dt.getUTCDate());
}

function TK__utcOf(ymd) {
  var p = TK__ymdParts(ymd);
  return p ? Date.UTC(p.y, p.m - 1, p.d) : NaN;
}

function TK__validYmd(y, m, d) {
  if (!(m >= 1 && m <= 12) || !(d >= 1 && d <= 31) || !(y >= 1900 && y <= 9999)) return null;
  var ms = Date.UTC(y, m - 1, d);
  var out = TK__ymdFromUTC(ms);
  return out === y + "-" + TK__pad2(m) + "-" + TK__pad2(d) ? out : null;
}

// ---- Dates (calendar days; local date for "today")
// date: a Date, an ISO timestamp, a "YYYY-MM-DD" string, or nothing (now).
function TK_ymd(date) {
  if (typeof date === "string" && TK__YMD_RE.test(date)) return date;
  var dt = date == null ? new Date() : date instanceof Date ? date : new Date(date);
  if (isNaN(dt.getTime())) return null;
  return dt.getFullYear() + "-" + TK__pad2(dt.getMonth() + 1) + "-" + TK__pad2(dt.getDate());
}

function TK_addDays(ymd, n) {
  var ms = TK__utcOf(ymd);
  if (isNaN(ms)) return null;
  return TK__ymdFromUTC(ms + Math.round(Number(n) || 0) * 86400000);
}

// Whole days from fromYmd to toYmd (positive when toYmd is later).
function TK_dayDiff(fromYmd, toYmd) {
  var a = TK__utcOf(fromYmd);
  var b = TK__utcOf(toYmd);
  if (isNaN(a) || isNaN(b)) return NaN;
  return Math.round((b - a) / 86400000);
}

// 0 = Sunday .. 6 = Saturday.
function TK_weekday(ymd) {
  var ms = TK__utcOf(ymd);
  return isNaN(ms) ? NaN : new Date(ms).getUTCDay();
}

function TK__daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function TK_addMonths(ymd, n) {
  var p = TK__ymdParts(ymd);
  if (!p) return null;
  var total = p.y * 12 + (p.m - 1) + n;
  var y = Math.floor(total / 12);
  var m = (total % 12) + 1;
  var d = Math.min(p.d, TK__daysInMonth(y, m));
  return y + "-" + TK__pad2(m) + "-" + TK__pad2(d);
}

// Business days: Monday to Friday, no holidays in Phase 1. D2: these are
// used only when someone opts in (a bd token, or a business-day rule).
function TK_isBusinessDay(ymd) {
  var w = TK_weekday(ymd);
  return w >= 1 && w <= 5;
}

// n business days after ymd (n >= 0). From a weekend, +1 is the next Monday.
// n = 0 returns ymd itself when it is a business day, else the next one.
function TK_addBusinessDays(ymd, n) {
  var cur = ymd;
  if (TK__ymdParts(cur) == null) return null;
  var left = Math.max(0, Math.floor(Number(n) || 0));
  if (left === 0) {
    while (!TK_isBusinessDay(cur)) cur = TK_addDays(cur, 1);
    return cur;
  }
  while (left > 0) {
    cur = TK_addDays(cur, 1);
    if (TK_isBusinessDay(cur)) left--;
  }
  return cur;
}

// The nth business day of a month (month 1..12), or null when it has fewer.
function TK_nthBusinessDay(year, month, n) {
  var y = Number(year);
  var m = Number(month);
  var k = Math.floor(Number(n));
  if (!(m >= 1 && m <= 12) || !(k >= 1)) return null;
  var last = TK__daysInMonth(y, m);
  var count = 0;
  for (var d = 1; d <= last; d++) {
    var ymd = y + "-" + TK__pad2(m) + "-" + TK__pad2(d);
    if (TK_isBusinessDay(ymd)) {
      count++;
      if (count === k) return ymd;
    }
  }
  return null;
}

// ---- Status workflow (mirrors tk_set_status and the D6 trigger)
function TK__isStatus(s) {
  return TK_STATUSES.indexOf(s) >= 0;
}

function TK_effectiveStatus(task) {
  if (!task) return "todo";
  if (TK__isStatus(task.status)) return task.status;
  return task.done ? "done" : "todo";
}

function TK_canTransition(from, to) {
  if (!TK__isStatus(to)) return false;
  var f = TK__isStatus(from) ? from : "todo";
  if (f === to) return false;
  if (f === "done" && (to === "waiting_client" || to === "ready_for_review")) return false;
  return true;
}

// The status the server will land on. Only the review gate changes it: done
// on a review_required task that is not done or in review yet lands in
// ready_for_review, for admins too (tasks p2 s3). From ready_for_review, done
// is an approval: only an admin (who is not the assignee or submitter) gets it.
function TK_resolveStatus(task, to, opts) {
  var isAdmin = !!(opts && opts.isAdmin);
  var from = TK_effectiveStatus(task);
  if (to === "done" && from === "ready_for_review") {
    return isAdmin && !TK__isSelfReview(task, opts && opts.me) ? "done" : "ready_for_review";
  }
  if (to === "done" && task && task.review_required && from !== "done") return "ready_for_review";
  return to;
}

// The assignee or the person who sent it for review can't approve it (M3).
// Owner fallback on purpose (S8b): an Unassigned task's owner can't either.
function TK__isSelfReview(task, me) {
  var who = TK__lower(me);
  if (!task || !who) return false;
  return who === TK__lower(task.assignee_email || task.staff_email) || who === TK__lower(task.submitted_by);
}

// Menu items for the status pill, in TK_STATUSES order. Never the current
// status; from done never waiting_client or ready_for_review. A review_required
// task offers "Send for review" instead of Done, for admins too. In review, an
// admin who is not the assignee or submitter gets Approve (action "approve")
// and Send back (action "send_back", needs a reason); everyone else's moves
// out of review are a withdraw (action "withdraw").
// opts: { isAdmin, me }
function TK_nextStatuses(task, opts) {
  var isAdmin = !!(opts && opts.isAdmin);
  var from = TK_effectiveStatus(task);
  var gated = !!(task && task.review_required);
  var reviewer = from === "ready_for_review" && isAdmin && !TK__isSelfReview(task, opts && opts.me);
  var out = [];
  for (var i = 0; i < TK_STATUSES.length; i++) {
    var s = TK_STATUSES[i];
    if (!TK_canTransition(from, s)) continue;
    if (from === "ready_for_review") {
      if (s === "done") {
        if (reviewer) out.push({ status: "done", label: "Approve", action: "approve" });
        continue;
      }
      if (s === "in_progress" && reviewer) {
        out.push({ status: "in_progress", label: "Send back", action: "send_back" });
        continue;
      }
      out.push({ status: s, label: TK_STATUS_LABELS[s], action: "withdraw" });
      continue;
    }
    if (s === "done") {
      if (gated) continue; // replaced by "Send for review" below
      out.push({ status: "done", label: TK_STATUS_LABELS.done });
      continue;
    }
    if (s === "ready_for_review" && gated) {
      out.push({ status: "ready_for_review", label: "Send for review" });
      continue;
    }
    out.push({ status: s, label: TK_STATUS_LABELS[s] });
  }
  return out;
}

// ---- Task predicates
function TK_isOpen(task) {
  return !!task && !task.deleted_at && TK_effectiveStatus(task) !== "done";
}

// The person the task is on, lowercased, or "" when it is Unassigned (S8b:
// assignee_email is null). Display, sort, filters and "mine" use this; the
// owner (staff_email) is never a stand-in for it. Safety checks (self review,
// on-time scoring) still fall back to the owner on purpose.
function TK_assigneeOf(task) {
  return task ? TK__lower(task.assignee_email) : "";
}

function TK_isUnassigned(task) {
  return !!task && !TK_assigneeOf(task);
}

function TK_isMine(task, email) {
  if (!task) return false;
  var me = TK__lower(email);
  if (!me) return false;
  return TK_assigneeOf(task) === me;
}

// Slate rhythm slice 4 (f), owner rule, not gated: a task waiting on the
// client, or a month task on a client whose month went out as preliminary
// reports, is never late. Mirrors SQL tk_late_excused(status, client,
// period_kind, period_start). The cache holds "client|YYYY-MM-01" keys for
// preliminary months; staff load it from tk_report_state (TK_api). Empty
// cache means only the waiting rule applies, which TK_isOverdue already had.
var TK_reportStateCache = { keys: {}, loaded: false };

function TK_setReportStates(rows) {
  var keys = {};
  var list = Array.isArray(rows) ? rows : [];
  for (var i = 0; i < list.length; i++) {
    var r = list[i];
    if (!r || r.state !== "preliminary" || !r.client_id || !r.period) continue;
    keys[String(r.client_id) + "|" + String(r.period).slice(0, 7) + "-01"] = true;
  }
  TK_reportStateCache.keys = keys;
  TK_reportStateCache.loaded = true;
  return keys;
}

// The books month a task belongs to: its period_start month when it has a
// month period, else null (quarter, year and ad hoc tasks have no month).
function TK_taskMonth(task) {
  if (!task || task.period_kind !== "month" || !task.period_start) return null;
  var m = String(task.period_start).slice(0, 7);
  return /^\d{4}-\d{2}$/.test(m) ? m + "-01" : null;
}

function TK_lateExcused(task, cache) {
  if (!task) return false;
  if (TK_effectiveStatus(task) === "waiting_client") return true;
  var month = TK_taskMonth(task);
  if (!month || !task.client_id) return false;
  var keys = (cache && cache.keys) || TK_reportStateCache.keys || {};
  return keys[String(task.client_id) + "|" + month] === true;
}

function TK_isOverdue(task, today) {
  if (!TK_isOpen(task)) return false;
  if (TK_effectiveStatus(task) === "waiting_client") return false;
  if (TK_lateExcused(task)) return false;
  var due = task.due_date ? String(task.due_date).slice(0, 10) : "";
  if (!due) return false;
  return due < (today || TK_ymd());
}

// D5: done tasks finished more than 12 months before today.
function TK_isOldDone(task, today) {
  if (!task || TK_effectiveStatus(task) !== "done") return false;
  var at = task.completed_at || task.updated_at;
  if (!at) return false;
  var doneYmd = TK_ymd(at);
  if (!doneYmd) return false;
  var cutoff = TK_addMonths(today || TK_ymd(), -TK_OLD_DONE_MONTHS);
  return doneYmd < cutoff;
}

var TK__PRIORITY_RANK = { high: 0, normal: 1, low: 2 };

function TK__cmpNullsLast(a, b) {
  var an = a == null || a === "";
  var bn = b == null || b === "";
  if (an && bn) return 0;
  if (an) return 1;
  if (bn) return -1;
  a = String(a);
  b = String(b);
  return a < b ? -1 : a > b ? 1 : 0;
}

function TK_compareTasks(a, b) {
  var c = TK__cmpNullsLast(a && a.due_date, b && b.due_date);
  if (c) return c;
  var pa = TK__PRIORITY_RANK[(a && a.priority) || "normal"];
  var pb = TK__PRIORITY_RANK[(b && b.priority) || "normal"];
  if (pa == null) pa = 1;
  if (pb == null) pb = 1;
  if (pa !== pb) return pa - pb;
  c = TK__cmpNullsLast(a && a.due_at, b && b.due_at);
  if (c) return c;
  c = TK__cmpNullsLast(a && a.created_at, b && b.created_at);
  if (c) return c;
  return TK__cmpNullsLast(a && a.id, b && b.id);
}

// My Tasks groups. Calendar days only: Saturday and Sunday are ordinary days.
// Also accepts (tasks, { today, email, ... }) as the second argument, the
// form the Today page uses.
function TK_groupMyTasks(tasks, today, opts) {
  if (today && typeof today === "object") {
    opts = today;
    today = opts.today;
  }
  opts = opts || {};
  today = today || TK_ymd();
  var email = opts.email;
  var showOlder = !!opts.showOlder;
  var todayGroup = opts.todayGroup !== false;
  // S8b: open Unassigned tasks get their own group and never go into the time
  // groups. Admins see only the ones they own or on their own book's clients
  // (opts.inMyBook(clientId)); everyone else sees every one they can see.
  var isAdmin = !!opts.isAdmin;
  var inMyBook = typeof opts.inMyBook === "function" ? opts.inMyBook : null;
  var me = TK__lower(email);
  // Slate plus dependencies: opts.isBlocked(task) (TKD_groupOpt, only while
  // TKP_on). Open blocked tasks that aren't late go to g.blocked; late ones
  // stay in Overdue so they still count as late. Without it: as before.
  var isBlocked = typeof opts.isBlocked === "function" ? opts.isBlocked : null;
  var g = { overdue: [], today: [], week: [], later: [], waiting: [], unassigned: [], done: [] };
  if (isBlocked) g.blocked = [];
  var list = Array.isArray(tasks) ? tasks : [];
  for (var i = 0; i < list.length; i++) {
    var t = list[i];
    if (!t || t.deleted_at) continue;
    if (TK_isUnassigned(t)) {
      if (!TK_isOpen(t)) continue;
      if (isAdmin && !(me && TK__lower(t.staff_email) === me) && !(inMyBook && t.client_id && inMyBook(t.client_id))) continue;
      g.unassigned.push(t);
      continue;
    }
    if (!TK_isMine(t, email)) continue;
    var st = TK_effectiveStatus(t);
    if (st === "done") {
      if (showOlder || !TK_isOldDone(t, today)) g.done.push(t);
      continue;
    }
    if (st === "waiting_client") {
      g.waiting.push(t);
      continue;
    }
    var due = t.due_date ? String(t.due_date).slice(0, 10) : "";
    var d = due ? TK_dayDiff(today, due) : NaN;
    if (isBlocked && st !== "ready_for_review" && !(d < 0 && !TK_lateExcused(t)) && isBlocked(t)) {
      g.blocked.push(t);
      continue;
    }
    if (isNaN(d)) g.later.push(t);
    else if (d < 0 && TK_lateExcused(t)) g.waiting.push(t);   // tk rhythm s4: never late
    else if (d < 0) g.overdue.push(t);
    else if (d === 0) (todayGroup ? g.today : g.week).push(t);
    else if (d <= TK_SOON_DAYS) g.week.push(t);
    else g.later.push(t);
  }
  g.overdue.sort(TK_compareTasks);
  g.today.sort(TK_compareTasks);
  g.week.sort(TK_compareTasks);
  g.later.sort(TK_compareTasks);
  g.waiting.sort(TK_compareTasks);
  g.unassigned.sort(TK_compareTasks);
  if (g.blocked) g.blocked.sort(TK_compareTasks);
  g.done.sort(function (a, b) {
    var c = TK__cmpNullsLast(b.completed_at || b.updated_at, a.completed_at || a.updated_at);
    // nulls last even in descending order
    var an = !(a.completed_at || a.updated_at);
    var bn = !(b.completed_at || b.updated_at);
    if (an !== bn) return an ? 1 : -1;
    return c || TK__cmpNullsLast(a.id, b.id);
  });
  return g;
}

var TK__MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
var TK__WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function TK_dueLabel(task, today) {
  var due = task && task.due_date ? String(task.due_date).slice(0, 10) : "";
  var p = TK__ymdParts(due);
  if (!p) return "";
  today = today || TK_ymd();
  var d = TK_dayDiff(today, due);
  if (d === 0) return "Today";
  if (d === 1) return "Tomorrow";
  if (d === -1) return "Yesterday";
  if (d < -1) return -d + " days late";
  if (d >= 2 && d <= 6) return TK__WEEKDAYS_SHORT[TK_weekday(due)];
  var label = TK__MONTHS_SHORT[p.m - 1] + " " + p.d;
  var tp = TK__ymdParts(today);
  if (tp && tp.y !== p.y) label += ", " + p.y;
  return label;
}

// ---- Names, handles and mentions
function TK_slug(name) {
  var s = name == null ? "" : String(name);
  if (typeof s.normalize === "function") s = s.normalize("NFD").replace(/[̀-ͯ]/g, "");
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function TK_handleOf(email) {
  var e = TK__lower(email);
  var at = e.indexOf("@");
  return at >= 0 ? e.slice(0, at) : e;
}

// Same rule as SQL tk_parse_mentions: regexp_matches(body,
// '(?:^|[^A-Za-z0-9_.])@([A-Za-z0-9._-]{2,64})', 'g'), then
// rtrim(lower(handle), '.'). Unique, in first-seen order; empty handles drop.
function TK_mentionTokens(body) {
  var re = /(?:^|[^A-Za-z0-9_.])@([A-Za-z0-9._-]{2,64})/g;
  var s = body == null ? "" : String(body);
  var seen = {};
  var out = [];
  var m;
  while ((m = re.exec(s)) !== null) {
    var h = m[1].toLowerCase().replace(/\.+$/, "");
    if (h && !seen[h]) {
      seen[h] = true;
      out.push(h);
    }
    if (m[0].length === 0) re.lastIndex++;
  }
  return out;
}

// ---- Quick add
var TK__QA_PRE = "(^|[\\s(,])"; // a token starts the line or follows a space, "(" or ","
var TK__QA_END = "(?=$|[\\s),.;:!?])"; // and ends at a space, punctuation or the end

var TK__WEEKDAY_WORDS = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tues: 2, tue: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thurs: 4, thur: 4, thu: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

// Each date rule: a regex body (between TK__QA_PRE and TK__QA_END) and a
// resolver from the match groups to a "YYYY-MM-DD" (or null: no match).
var TK__QA_DATE_RULES = [
  { re: "(today|tod)", fn: function (m, today) { return today; } },
  { re: "(tomorrow|tmr|tom)", fn: function (m, today) { return TK_addDays(today, 1); } },
  { re: "(next\\s+week)", fn: function (m, today) {
      var w = TK_weekday(today);
      return TK_addDays(today, ((8 - w) % 7) || 7);
    } },
  { re: "(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tues|tue|wed|thurs|thur|thu|fri|sat)",
    fn: function (m, today) {
      var want = TK__WEEKDAY_WORDS[m[1].toLowerCase()];
      var w = TK_weekday(today);
      return TK_addDays(today, ((want - w + 7) % 7) || 7);
    } },
  { re: "(eom)", fn: function (m, today) {
      var p = TK__ymdParts(today);
      return p.y + "-" + TK__pad2(p.m) + "-" + TK__pad2(TK__daysInMonth(p.y, p.m));
    } },
  { re: "in\\s+(\\d{1,3})\\s+(days?|weeks?)", fn: function (m, today) {
      var n = Number(m[1]);
      return TK_addDays(today, /^w/i.test(m[2]) ? n * 7 : n);
    } },
  { re: "\\+(\\d{1,3})bd", fn: function (m, today) { return TK_addBusinessDays(today, Number(m[1])); } },
  { re: "\\+(\\d{1,3})([dw])", fn: function (m, today) {
      var n = Number(m[1]);
      return TK_addDays(today, m[2].toLowerCase() === "w" ? n * 7 : n);
    } },
  { re: "(\\d{4})-(\\d{2})-(\\d{2})", fn: function (m) {
      return TK__validYmd(Number(m[1]), Number(m[2]), Number(m[3]));
    } },
  { re: "(\\d{1,2})/(\\d{1,2})(?:/(\\d{4}|\\d{2}))?", fn: function (m, today) {
      var mo = Number(m[1]);
      var d = Number(m[2]);
      if (m[3]) {
        var y = Number(m[3]);
        if (m[3].length === 2) y += 2000;
        return TK__validYmd(y, mo, d);
      }
      // A past M/D (or a Feb 29 this year doesn't have) rolls to next year.
      var ty = TK__ymdParts(today).y;
      var cand = TK__validYmd(ty, mo, d);
      if (!cand || cand < today) cand = TK__validYmd(ty + 1, mo, d);
      return cand;
    } },
  { re: "bd(\\d{1,2})", fn: function (m, today) {
      var n = Number(m[1]);
      var p = TK__ymdParts(today);
      var here = TK_nthBusinessDay(p.y, p.m, n);
      if (here && here >= today) return here;
      var nm = p.m === 12 ? 1 : p.m + 1;
      var ny = p.m === 12 ? p.y + 1 : p.y;
      return TK_nthBusinessDay(ny, nm, n);
    } },
  // Plain words (Phase 4, P4-1). `plain` rules switch off with { plain: false }.
  { plain: true, re: "(end\\s+of\\s+(?:the\\s+)?month)", fn: function (m, today) {
      var p = TK__ymdParts(today);
      return p.y + "-" + TK__pad2(p.m) + "-" + TK__pad2(TK__daysInMonth(p.y, p.m));
    } },
  // "the 15th": this month when that day is today or later, else next month.
  // A month without that day (the 31st in November) is not guessed.
  // `restrict`: counts only after by / due / on, or as the last words, so
  // "Review the 1st quarter numbers" stays a title.
  { plain: true, restrict: true, re: "(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)", fn: function (m, today) {
      var d = Number(m[1]);
      if (d < 1 || d > 31) return null;
      var p = TK__ymdParts(today);
      if (d >= p.d) return d <= TK__daysInMonth(p.y, p.m) ? TK__validYmd(p.y, p.m, d) : null;
      var nm = p.m === 12 ? 1 : p.m + 1;
      var ny = p.m === 12 ? p.y + 1 : p.y;
      if (d <= TK__daysInMonth(ny, nm)) return TK__validYmd(ny, nm, d);
      return null;
    } },
];

// Short forms that are also everyday words or names ("call Tom", "Sat with"):
// they count as dates only after "due" or "on", or as the last word.
var TK__QA_AMBIGUOUS = { tom: 1, sun: 1, mon: 1, sat: 1 };

function TK__qaAmbiguousOk(source, hit, plain) {
  if (!TK__QA_AMBIGUOUS[String(hit.raw).toLowerCase()]) return true;
  if (/^[\s),.;:!?]*$/.test(source.slice(hit.end))) return true;
  return (plain ? /(^|[\s(,])(due|on|by)\s+$/i : /(^|[\s(,])(due|on)\s+$/i).test(source.slice(0, hit.start));
}

function TK__qaMatchAll(source, body, flags) {
  var re = new RegExp(TK__QA_PRE + body + TK__QA_END, flags || "gi");
  var out = [];
  var m;
  while ((m = re.exec(source)) !== null) {
    var start = m.index + m[1].length;
    out.push({ m: m, start: start, end: m.index + m[0].length, raw: source.slice(start, m.index + m[0].length) });
    if (m[0].length === 0) re.lastIndex++;
  }
  return out;
}

// Groups of a TK__qaMatchAll hit, with group 1 (the lead-in) dropped so that
// m[1] is the rule's first group.
function TK__qaGroups(hit) {
  var g = [hit.raw];
  for (var i = 2; i < hit.m.length; i++) g.push(hit.m[i]);
  return g;
}

function TK__qaPick(list, keyFns, wanted) {
  var exact = [];
  var prefix = [];
  for (var i = 0; i < list.length; i++) {
    var item = list[i];
    var isExact = false;
    var isPrefix = false;
    for (var k = 0; k < keyFns.length; k++) {
      var key = keyFns[k](item);
      if (!key) continue;
      if (key === wanted) isExact = true;
      if (key.indexOf(wanted) === 0) isPrefix = true;
    }
    if (isExact) exact.push(item);
    if (isPrefix) prefix.push(item);
  }
  if (exact.length === 1) return { item: exact[0] };
  if (prefix.length === 1) return { item: prefix[0] };
  return { item: null, count: prefix.length };
}

// ---- Quick add, plain words (Phase 4, P4-1)
// Key for a part of the line the person turned off ("Remove" on a chip), so
// the same words stay in the title and are not picked up again as they type.
function TK_qaIgnoreKey(kind, raw) {
  return String(kind) + "|" + String(raw == null ? "" : raw).toLowerCase().replace(/\s+/g, " ").trim();
}

// Words with positions. `clean` drops brackets, quotes and end punctuation;
// start/end cover the clean text; `tail` is the punctuation cut off the end.
function TK__qaWords(source) {
  var re = /\S+/g;
  var out = [];
  var m;
  while ((m = re.exec(source)) !== null) {
    var raw = m[0];
    var lead = raw.match(/^[("'\[]+/);
    lead = lead ? lead[0].length : 0;
    var trail = raw.slice(lead).match(/[)\]"',.;:!?]+$/);
    trail = trail ? trail[0].length : 0;
    out.push({
      clean: raw.slice(lead, raw.length - trail),
      start: m.index + lead,
      end: m.index + raw.length - trail,
      tail: raw.slice(raw.length - trail),
    });
  }
  return out;
}

// "Sierra Lima" -> "sierra"; the first word of a display name.
function TK__qaFirstName(name) {
  var first = String(name == null ? "" : name).trim().split(/\s+/)[0];
  return TK_slug(first);
}

// Date words that follow by / due / on take those words with them.
var TK__QA_DATE_PREFIX_RE = /(^|[\s(,])(due\s+on|due\s+by|due|by|on)\s+$/i;

function TK__qaDatePrefixStart(source, start) {
  var m = TK__QA_DATE_PREFIX_RE.exec(source.slice(0, start));
  return m ? m.index + m[1].length : -1;
}

function TK_parseQuickAdd(input, opts) {
  opts = opts || {};
  var source = input == null ? "" : String(input);
  var today = opts.today || TK_ymd();
  var staff = Array.isArray(opts.staff) ? opts.staff : [];
  var clients = Array.isArray(opts.clients) ? opts.clients : [];
  // Plain words ("for Sierra", "by Friday", "the 15th", "re Acme") are on
  // unless { plain: false }. `me` is the current user's email ("@me", "for me").
  var plain = opts.plain !== false;
  var me = opts.me ? TK__lower(opts.me) : "";
  var ignoreSet = {};
  (Array.isArray(opts.ignore) ? opts.ignore : []).forEach(function (k) { ignoreSet[String(k)] = true; });
  function ignored(kind, raw) { return ignoreSet[TK_qaIgnoreKey(kind, raw)] === true; }
  var result = {
    text: "",
    assignee_email: null,
    client_id: opts.defaultClientId != null ? opts.defaultClientId : null,
    due_date: null,
    priority: null,
    tokens: [],
    suggestions: [],
    errors: [],
  };
  var taken = [];
  function free(a, b) {
    for (var i = 0; i < taken.length; i++) if (a < taken[i][1] && b > taken[i][0]) return false;
    return true;
  }
  function take(kind, hit, value, isPlain) {
    taken.push([hit.start, hit.end]);
    var tok = { kind: kind, raw: hit.raw, start: hit.start, end: hit.end, value: value };
    if (isPlain) tok.plain = true;
    result.tokens.push(tok);
  }

  // @person: first one that resolves to exactly one staff member wins.
  // @me is the current user.
  var personSet = false;
  TK__qaMatchAll(source, "@([A-Za-z0-9._-]+)").forEach(function (hit) {
    var handle = hit.m[2].toLowerCase().replace(/\.+$/, "");
    if (handle.length < hit.m[2].length) {
      hit = { m: hit.m, start: hit.start, end: hit.start + 1 + handle.length, raw: "@" + hit.m[2].slice(0, handle.length) };
    }
    if (!handle) return;
    if (ignored("person", hit.raw)) return;
    var pick = handle === "me" && me
      ? { item: { email: me } }
      : TK__qaPick(staff, [
          function (s) { return TK_handleOf(s && s.email); },
          function (s) { return TK_slug(s && s.name); },
        ], handle);
    if (!pick.item) {
      result.errors.push("Who is @" + hit.raw.slice(1) + "?");
      return;
    }
    if (personSet) return;
    personSet = true;
    result.assignee_email = TK__lower(pick.item.email);
    take("person", hit, result.assignee_email);
  });

  // #client: by slug prefix, or by exact id.
  var clientSet = false;
  TK__qaMatchAll(source, "#([A-Za-z0-9._-]+)").forEach(function (hit) {
    var raw = hit.m[2];
    if (ignored("client", hit.raw)) return;
    var wanted = raw.toLowerCase();
    var byId = clients.filter(function (c) { return c && c.id != null && String(c.id) === raw; });
    var pick = byId.length === 1 ? { item: byId[0] } : TK__qaPick(clients, [function (c) { return TK_slug(c && c.name); }], wanted);
    if (!pick.item) {
      result.errors.push("Which client is #" + raw + "?");
      return;
    }
    if (clientSet) return;
    clientSet = true;
    result.client_id = pick.item.id;
    take("client", hit, pick.item.id);
  });

  // !priority: the first one wins.
  var prioMap = { high: "high", h: "high", low: "low", l: "low", normal: "normal", n: "normal" };
  var prioHits = TK__qaMatchAll(source, "!(high|h|low|l|normal|n)");
  for (var pi = 0; pi < prioHits.length; pi++) {
    if (!free(prioHits[pi].start, prioHits[pi].end)) continue;
    if (ignored("priority", prioHits[pi].raw)) continue;
    result.priority = prioMap[prioHits[pi].m[2].toLowerCase()];
    take("priority", prioHits[pi], result.priority);
    break;
  }

  var words = TK__qaWords(source);
  function wordFree(w) { return w.clean !== "" && free(w.start, w.end); }

  // Dates: the earliest date word in the line wins (the longest on a tie).
  // by / due / on in front of a date go with it. Returns the best match
  // without taking it; the client step below needs to see it first.
  function atEnd(pos) {
    for (var i = 0; i < words.length; i++) {
      if (words[i].start >= pos && words[i].clean !== "" && free(words[i].start, words[i].end)) return false;
    }
    return true;
  }
  function findDate() {
    var best = null;
    for (var r = 0; r < TK__QA_DATE_RULES.length; r++) {
      var rule = TK__QA_DATE_RULES[r];
      if (rule.plain && !plain) continue;
      var hits = TK__qaMatchAll(source, rule.re);
      for (var h = 0; h < hits.length; h++) {
        var hit = hits[h];
        if (!free(hit.start, hit.end)) continue;
        if (!TK__qaAmbiguousOk(source, hit, plain)) continue;
        var start = hit.start;
        if (plain) {
          var ps = TK__qaDatePrefixStart(source, hit.start);
          if (ps >= 0 && free(ps, hit.start)) start = ps;
        }
        // Words that are also everyday title words ("the 2nd floor", "Monday
        // deposits") count only at the end of the line or right after by / due;
        // "on" does not free them ("Meet on the 2nd floor").
        var restricted = rule.restrict;
        if (restricted && !(start !== hit.start && !/^on\b/i.test(source.slice(start, hit.start))) && !atEnd(hit.end)) continue;
        var raw = source.slice(start, hit.end);
        if (ignored("date", raw) || ignored("date", hit.raw)) continue;
        if (best && (start > best.start || (start === best.start && hit.end <= best.end))) continue;
        var value = rule.fn(TK__qaGroups(hit), today);
        if (!value) continue;
        best = { start: start, end: hit.end, raw: raw, value: value, plainUsed: !!rule.plain || start !== hit.start };
      }
    }
    return best;
  }

  // ---- Plain-words person and client ("for Sierra", "re Acme")
  // A person: after for / to / assign(ed) (to), the words are exactly one
  // active staff member's full name or first name, or "me". A client: after
  // for / re / client or a dash, the words that finish the line (or, when the
  // line opens with for / re / client, end at a colon, comma or dash) are one
  // client's name or the start of it, at least 4 characters. Two or more
  // matches, or a name that is both a person and a client, stay in the title
  // and become a "Did you mean" suggestion. Nothing is guessed.
  function phraseFree(from, to, span) {
    for (var i = from; i <= to; i++) {
      var w = words[i];
      if (!wordFree(w)) return false;
      if (span && w.start < span.end && w.end > span.start) return false;
      if (i < to && /[,;:!?]/.test(w.tail)) return false;
    }
    return true;
  }
  function phraseText(from, to) {
    var parts = [];
    for (var i = from; i <= to; i++) parts.push(words[i].clean);
    return parts.join(" ");
  }
  function personAt(k) {
    var c = words[k].clean.toLowerCase();
    var from = k + 1;
    if (c === "assign" || c === "assigned") {
      if (words[from] && wordFree(words[from]) && words[from].clean.toLowerCase() === "to") from++;
    } else if (c !== "for" && c !== "to") {
      return null;
    }
    if (from >= words.length) return null;
    if (me && words[from].clean.toLowerCase() === "me" && wordFree(words[from])) {
      return { start: words[k].start, end: words[from].end, matches: [{ email: me, name: "Me" }] };
    }
    for (var n = 3; n >= 1; n--) {
      var last = from + n - 1;
      if (last >= words.length) continue;
      if (!phraseFree(from, last)) continue;
      var phrase = TK_slug(phraseText(from, last));
      if (!phrase) continue;
      var ms = staff.filter(function (s) {
        if (!s || !s.email || !s.name) return false;
        if (TK_slug(s.name) === phrase) return true;
        return n === 1 && TK__qaFirstName(s.name) === phrase;
      });
      if (ms.length) return { start: words[k].start, end: words[last].end, matches: ms, weak: c === "to" };
    }
    return null;
  }
  function clientsFor(from, to) {
    var phrase = TK_slug(phraseText(from, to));
    if (phrase.replace(/-/g, "").length < 4) return [];
    var live = clients.filter(function (c) { return c && c.id != null && c.name; });
    var exact = live.filter(function (c) { return TK_slug(c.name) === phrase; });
    if (exact.length) return exact;
    // A start of a name is only a guess: it becomes a "Did you mean" option.
    return live.filter(function (c) { return TK_slug(c.name).indexOf(phrase + "-") === 0; }).map(function (c) {
      return { id: c.id, name: c.name, prefix: true };
    });
  }
  var dateAhead = null;
  function clientAt(k) {
    var c = words[k].clean.toLowerCase();
    var isDash = /^[-–—]+$/.test(c);
    if (!isDash && c !== "for" && c !== "re" && c !== "client") return null;
    var from = k + 1;
    if (from >= words.length) return null;
    // The line ends with the client (a date at the end may follow it).
    var spans = [null];
    if (dateAhead) spans.push(dateAhead);
    for (var v = 0; v < spans.length; v++) {
      var last = -1;
      for (var i = words.length - 1; i >= from; i--) {
        var w = words[i];
        if (w.clean === "") continue;
        if (!free(w.start, w.end)) continue;
        if (spans[v] && w.start < spans[v].end && w.end > spans[v].start) continue;
        last = i;
        break;
      }
      if (last < from || !phraseFree(from, last, spans[v])) continue;
      var ms = clientsFor(from, last);
      if (ms.length) return { start: words[k].start, end: words[last].end, matches: ms };
    }
    // The line opens with it: "re Acme: statements", "for Acme - statements".
    if (k === 0 && !isDash) {
      for (var j = from; j < words.length && j < from + 8; j++) {
        var nextDash = words[j + 1] && /^[-–—]+$/.test(words[j + 1].clean);
        if (!/[:,]/.test(words[j].tail) && !nextDash) continue;
        if (!phraseFree(from, j)) break;
        var lead = clientsFor(from, j);
        if (lead.length) return { start: words[k].start, end: words[j].end, matches: lead };
        break;
      }
    }
    return null;
  }
  if (plain) {
    dateAhead = findDate();
    for (var k = 0; k < words.length; k++) {
      if (!wordFree(words[k])) continue;
      var pc = personSet ? null : personAt(k);
      var cc = clientSet ? null : clientAt(k);
      var options = [];
      if (pc) {
        var praw = source.slice(pc.start, pc.end);
        if (!ignored("person", praw)) {
          pc.matches.forEach(function (s) {
            options.push({ kind: "person", value: TK__lower(s.email), label: s.name || s.email, start: pc.start, end: pc.end, raw: praw, weak: !!pc.weak });
          });
        }
      }
      if (cc) {
        var craw = source.slice(cc.start, cc.end);
        if (!ignored("client", craw)) {
          cc.matches.forEach(function (c) {
            options.push({ kind: "client", value: c.id, label: c.name, start: cc.start, end: cc.end, raw: craw, weak: !!c.prefix });
          });
        }
      }
      if (!options.length) continue;
      // A full client name that covers more words than a person's first name wins ("Sierra Club").
      if (pc && cc && !options.some(function (x) { return x.kind === "client" && x.weak; }) && cc.start <= pc.start && cc.end > pc.end) {
        options = options.filter(function (x) { return x.kind === "client"; });
      }
      // A bare "to <name>" or the start of a client name is a guess: ask.
      if (options.length === 1 && !options[0].weak) {
        var o = options[0];
        take(o.kind, o, o.value, true);
        if (o.kind === "person") {
          personSet = true;
          result.assignee_email = o.value;
        } else {
          clientSet = true;
          result.client_id = o.value;
        }
        continue;
      }
      result.suggestions.push({
        start: Math.min.apply(null, options.map(function (x) { return x.start; })),
        end: Math.max.apply(null, options.map(function (x) { return x.end; })),
        options: options.slice(0, 6),
      });
    }
  }

  // A pick made by a later phrase leaves nothing to ask about that field.
  result.suggestions = result.suggestions.map(function (sg) {
    return { start: sg.start, end: sg.end, options: sg.options.filter(function (o) { return o.kind === "person" ? !personSet : !clientSet; }) };
  }).filter(function (sg) { return sg.options.length > 0; });

  var best = findDate();
  if (best) {
    result.due_date = best.value;
    take("date", best, best.value, best.plainUsed);
  }

  // Text: the line minus every matched token, spaces collapsed.
  var spans = taken.slice().sort(function (a, b) { return a[0] - b[0]; });
  var text = "";
  var pos = 0;
  for (var si = 0; si < spans.length; si++) {
    text += source.slice(pos, spans[si][0]) + " ";
    pos = spans[si][1];
  }
  text += source.slice(pos);
  // A comma or colon left dangling at either end by a removed token goes too.
  text = text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[,;:]\s*/, "")
    .replace(/(\s*[,;:])+$/, "")
    .replace(/\s+\.$/, "")
    .trim();
  var anyPlain = result.tokens.some(function (x) { return x.plain === true; });
  if (anyPlain) {
    text = text.replace(/^[-\u2013\u2014]+\s+/, "").replace(/\s+[-\u2013\u2014]+$/, "").trim();
  }
  if (plain && result.tokens.some(function (x) { return x.kind === "date"; })) {
    // "Plan for next week" leaves "Plan for": a joining word left at the end goes too.
    var trimmed = text.replace(/\s+(for|to|re|by|due|on)$/i, "").replace(/(\s*[,;:])+$/, "").trim();
    if (trimmed) text = trimmed;
  }
  // A line that is only plain words ("for Sierra") keeps its words as the title.
  if (!text && anyPlain) {
    var again = {};
    for (var key in opts) if (Object.prototype.hasOwnProperty.call(opts, key)) again[key] = opts[key];
    again.plain = false;
    return TK_parseQuickAdd(input, again);
  }
  result.text = text;
  result.tokens.sort(function (a, b) { return a.start - b.start; });
  result.suggestions.sort(function (a, b) { return a.start - b.start; });
  if (!result.text) result.errors.push("Add a few words about the task.");
  return result;
}

// ---- Routes (11.5). Id segments keep their case.
var TK__UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function TK_isUuid(s) {
  return typeof s === "string" && TK__UUID_RE.test(s);
}

function TK_parseRoute(hash) {
  var unknown = { view: "unknown" };
  var s = hash == null ? "" : String(hash);
  var q = s.indexOf("?");
  if (q >= 0) s = s.slice(0, q); // the query belongs to LK
  s = s.replace(/^#/, "").replace(/^\/+/, "");
  var parts = s.split("/");
  while (parts.length > 1 && parts[parts.length - 1] === "") parts.pop();
  if (parts[0].toLowerCase() !== "tasks") return unknown;
  var kind = (parts[1] || "").toLowerCase();
  var n = parts.length;
  if (n === 1 || (n === 2 && (kind === "" || kind === "my"))) return { view: "my" };
  if (n === 2 && kind === "search") return { view: "search" };
  if (n === 2 && kind === "review") return { view: "review" };
  if (n === 2 && kind === "templates") return { view: "templates" }; // tasks p2 s4
  if (n === 2 && kind === "waiting") return { view: "waiting" }; // tasks p2 s5
  if (n === 2 && kind === "settings") return { view: "settings" }; // Slate app Settings page
  if (n === 2 && kind === "manage") return { view: "manage" }; // tasks p3: admin Manage projects
  var hasListSuffix = n === 4 && parts[3].toLowerCase() === "list";
  if (kind === "c" && (n === 3 || hasListSuffix)) {
    var id;
    try {
      id = decodeURIComponent(parts[2]);
    } catch (e) {
      return unknown;
    }
    if (!id || id.indexOf("@") >= 0) return unknown;
    return { view: "client", clientId: id };
  }
  if (kind === "p" && (n === 3 || hasListSuffix)) {
    return TK_isUuid(parts[2]) ? { view: "project", projectId: parts[2] } : unknown;
  }
  if (kind === "u" && n === 3) {
    return TK_isUuid(parts[2]) ? { view: "person", staffId: parts[2] } : unknown;
  }
  // Slate plus person profile (TK_Profile.jsx): an opaque key, never an email.
  // Only while the Slate plus gate is on; off it stays "unknown" as before.
  if (kind === "person" && n === 3 && TK__profileRoutesOn()) {
    var pk = String(parts[2] || "").toLowerCase();
    return /^[0-9a-f]{16}$/.test(pk) ? { view: "profile", key: pk } : unknown;
  }
  return unknown;
}

function TK__profileRoutesOn() {
  try {
    return typeof TKP_on === "function" && TKP_on() === true;
  } catch (e) {
    return false;
  }
}

// Anything that can't be written safely (no id, a bad uuid, an "@" in a
// client id) formats as My Tasks, so no email ever reaches a URL.
function TK_formatRoute(route) {
  var r = route || {};
  if (r.view === "client" && r.clientId != null && String(r.clientId) !== "" && String(r.clientId).indexOf("@") < 0) {
    return "#/tasks/c/" + encodeURIComponent(String(r.clientId));
  }
  if (r.view === "project" && TK_isUuid(r.projectId)) return "#/tasks/p/" + r.projectId;
  if (r.view === "person" && TK_isUuid(r.staffId)) return "#/tasks/u/" + r.staffId;
  if (r.view === "profile" && typeof r.key === "string" && /^[0-9a-f]{16}$/.test(r.key)) return "#/tasks/person/" + r.key;
  if (r.view === "search") return "#/tasks/search";
  if (r.view === "review") return "#/tasks/review";
  if (r.view === "templates") return "#/tasks/templates";
  if (r.view === "waiting") return "#/tasks/waiting";
  if (r.view === "manage") return "#/tasks/manage";
  if (r.view === "settings") return "#/tasks/settings";
  return "#/tasks/my";
}

// ---- Keys (C8)
// scope: "list", "drawer" or "any" (both list and drawer). `scopes` spells
// it out; the global q key carries scopes ["global"]. `display` is the key
// cap text; `key` is the KeyboardEvent.key value.
var TK_KEYMAP = [
  { key: "j", display: "j", label: "Next task", scope: "list", scopes: ["list"] },
  { key: "k", display: "k", label: "Previous task", scope: "list", scopes: ["list"] },
  { key: "Enter", display: "Enter", label: "Open task", scope: "list", scopes: ["list"] },
  { key: "x", display: "x", label: "Mark done or not done", scope: "any", scopes: ["list", "drawer"] },
  { key: "s", display: "s", label: "Change status", scope: "any", scopes: ["list", "drawer"] },
  { key: "a", display: "a", label: "Assign", scope: "any", scopes: ["list", "drawer"] },
  { key: "v", display: "v", label: "Select a task (Shift+V selects a range)", scope: "list", scopes: ["list"] },
  { key: "q", display: "q", label: "Add a task", scope: "any", scopes: ["global"] },
  { key: "t", display: "t", label: "Open or close this client's tasks (the Desk's Client tab while the Desk is on)", scope: "any", scopes: ["global"] },
  { key: "Escape", display: "Esc", label: "Close details", scope: "drawer", scopes: ["drawer"] },
  { key: "?", display: "?", label: "Show these shortcuts", scope: "any", scopes: ["list", "drawer"] },
];

function TK__closest(el, selector) {
  if (!el || typeof el.closest !== "function") return null;
  try {
    return el.closest(selector);
  } catch (e) {
    return null;
  }
}

function TK__isTypingTarget(el) {
  if (!el) return false;
  var tag = String(el.tagName || "").toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  var role = typeof el.getAttribute === "function" ? el.getAttribute("role") : null;
  if (role === "textbox") return true;
  var ce = typeof el.getAttribute === "function" ? el.getAttribute("contenteditable") : null;
  if (ce === "" || ce === "true" || ce === "plaintext-only") return true;
  if (TK__closest(el, '[contenteditable="true"], [contenteditable=""], [role="textbox"], .tb-search')) return true;
  return false;
}

// ctx: { modalOpen, menuOpen, tourOpen, scope: "list"|"drawer"|"global",
//        embedded?, activeElement?, body? } (the last two default to document's).
// embedded (Desk, D3+): the drawer keys belong to a task shown inside the
// non-modal Desk, so focus on the page body must not reach them; the target
// has to be inside the keyscope itself.
function TK_shouldHandleKey(event, ctx) {
  var e = event || {};
  var c = ctx || {};
  if (c.keysOff) return false; // Slate Settings: quick keys turned off for this person
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  if (e.isComposing || e.keyCode === 229) return false;
  if (e.defaultPrevented) return false;
  var doc = typeof document !== "undefined" ? document : null;
  var active = "activeElement" in c ? c.activeElement : doc ? doc.activeElement : null;
  var body = "body" in c ? c.body : doc ? doc.body : null;
  var target = e.target || active || null;
  if (TK__isTypingTarget(target) || (active && active !== target && TK__isTypingTarget(active))) return false;
  if (c.modalOpen || c.menuOpen || c.tourOpen) return false;
  if (c.scope === "list" || c.scope === "drawer") {
    var inDrawer = !!TK__closest(target, '[data-tk-keyscope="drawer"]');
    if (c.scope === "list" && inDrawer) return false;
    if (c.scope === "drawer" && !inDrawer && (c.embedded || !(target && body && target === body))) return false;
  }
  return true;
}

// ---- Edit hint (UI only; tk_can_edit_task decides)
function TK_canEdit(task, ctx) {
  if (!task) return false;
  var c = ctx || {};
  var me = TK__lower(c.email);
  if (!me) return false;
  if (TK__lower(task.staff_email) === me) return true;
  if (c.isAdmin) return true;
  var seeClient = function (id) { return typeof c.canSeeClient === "function" ? !!c.canSeeClient(id) : false; };
  var member = function (id) { return typeof c.isMember === "function" ? !!c.isMember(id) : false; };
  var shared = task.visibility === "shared";
  if (TK__lower(task.assignee_email) === me) {
    if (task.client_id != null) return seeClient(task.client_id);
    if (task.project_id != null) return member(task.project_id);
    return true;
  }
  if (shared && task.client_id != null && seeClient(task.client_id)) return true;
  if (shared && task.client_id == null && task.project_id != null && member(task.project_id)) return true;
  return false;
}

// ---- Normalizer
function TK__pickEnum(v, list, dflt) {
  return list.indexOf(v) >= 0 ? v : dflt;
}

function TK__lowerOrNull(v) {
  var s = TK__lower(v);
  return s ? s : null;
}

function TK_normalizeTask(row) {
  var r = row || {};
  var out = {};
  for (var k in r) if (Object.prototype.hasOwnProperty.call(r, k) && r[k] !== undefined) out[k] = r[k];
  var status = TK_effectiveStatus(r);
  var staffEmail = TK__lower(r.staff_email);
  var dueDate = r.due_date ? String(r.due_date).slice(0, 10) : null;
  var startOn = r.start_on ? String(r.start_on).slice(0, 10) : null;
  var sortKey = r.sort_key == null || r.sort_key === "" ? null : Number(r.sort_key);
  out.id = r.id;
  out.text = r.text == null ? "" : String(r.text);
  out.description = r.description == null || r.description === "" ? null : String(r.description);
  out.status = status;
  out.done = status === "done";
  out.due_date = dueDate;
  out.due_at = r.due_at || null;
  out.remind_at = r.remind_at || null;
  out.start_on = startOn;
  out.priority = TK__pickEnum(r.priority, TK_PRIORITIES, "normal");
  out.kind = TK__pickEnum(r.kind, ["task", "reminder"], "task");
  out.recurrence = TK__pickEnum(r.recurrence, ["none", "daily", "weekly", "monthly", "month_end", "custom"], "none");
  out.recurrence_rule = out.recurrence === "custom" && r.recurrence_rule && typeof r.recurrence_rule === "object" ? r.recurrence_rule : null;
  out.client_id = r.client_id == null || r.client_id === "" ? null : String(r.client_id);
  out.project_id = r.project_id || null;
  out.section = r.section == null || r.section === "" ? null : String(r.section);
  out.sort_key = sortKey == null || isNaN(sortKey) ? null : sortKey;
  out.parent_id = r.parent_id || null;
  out.sop_section = r.sop_section || null;
  out.review_required = !!r.review_required;
  // S8b: null means Unassigned; never filled in from the owner.
  out.assignee_email = TK__lower(r.assignee_email) || null;
  out.is_unassigned = !out.assignee_email;
  out.staff_email = staffEmail;
  out.created_by = TK__lowerOrNull(r.created_by);
  out.visibility = TK__pickEnum(r.visibility, ["private", "shared"], "private");
  out.source = r.source ? String(r.source) : "manual";
  out.source_ref = r.source_ref == null ? null : r.source_ref;
  out.series_id = r.series_id || null;
  out.completed_at = r.completed_at || null;
  out.status_changed_at = r.status_changed_at || null;
  out.status_changed_by = TK__lowerOrNull(r.status_changed_by);
  out.waiting_since = r.waiting_since || null;
  out.waiting_minutes = Number(r.waiting_minutes) > 0 ? Number(r.waiting_minutes) : 0;
  out.reviewer_email = TK__lowerOrNull(r.reviewer_email);
  out.send_back_count = Number(r.send_back_count) > 0 ? Number(r.send_back_count) : 0;
  out.ready_at = r.ready_at || null;
  out.submitted_by = TK__lowerOrNull(r.submitted_by);
  out.submitted_at = r.submitted_at || null;
  out.approved_by = TK__lowerOrNull(r.approved_by);
  out.approved_at = r.approved_at || null;
  out.due_date_original = r.due_date_original ? String(r.due_date_original).slice(0, 10) : null;
  out.waiting_before_due_minutes = Number(r.waiting_before_due_minutes) > 0 ? Number(r.waiting_before_due_minutes) : 0;
  out.created_at = r.created_at || null;
  out.updated_at = r.updated_at || null;
  out.deleted_at = r.deleted_at || null;
  return out;
}

// ---- Missing-schema hints. They only say "this error might mean the schema
// is missing". They never set the schema; TK_api re-probes first (B4).
function TK__errText(err) {
  if (!err) return "";
  return String(err.message || "") + " " + String(err.details || "") + " " + String(err.hint || "");
}

function TK_isMissingColumn(err) {
  if (!err) return false;
  var code = String(err.code || "");
  if (code === "42703" || code === "PGRST204") return true;
  var msg = TK__errText(err);
  return /column .* does not exist/i.test(msg) || /could not find the .* column/i.test(msg);
}

function TK_isMissingFunction(err) {
  if (!err) return false;
  var code = String(err.code || "");
  if (code === "PGRST202" || code === "42883") return true;
  return /could not find the function/i.test(TK__errText(err));
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    TK_STATUSES: TK_STATUSES,
    TK_STATUS_LABELS: TK_STATUS_LABELS,
    TK_PRIORITIES: TK_PRIORITIES,
    TK_PRIORITY_LABELS: TK_PRIORITY_LABELS,
    TK_SOP_SECTION_IDS: TK_SOP_SECTION_IDS,
    TK_SOON_DAYS: TK_SOON_DAYS,
    TK_OLD_DONE_MONTHS: TK_OLD_DONE_MONTHS,
    TK_CLIENT_SECTION_ORDER: TK_CLIENT_SECTION_ORDER,
    SLATE_NAME: SLATE_NAME,
    TK_COPY: TK_COPY,
    TK_effectiveStatus: TK_effectiveStatus,
    TK_canTransition: TK_canTransition,
    TK_resolveStatus: TK_resolveStatus,
    TK_nextStatuses: TK_nextStatuses,
    TK_isOpen: TK_isOpen,
    TK_isMine: TK_isMine,
    TK_assigneeOf: TK_assigneeOf,
    TK_isUnassigned: TK_isUnassigned,
    TK_isOverdue: TK_isOverdue,
    TK_reportStateCache: TK_reportStateCache,
    TK_setReportStates: TK_setReportStates,
    TK_taskMonth: TK_taskMonth,
    TK_lateExcused: TK_lateExcused,
    TK_isOldDone: TK_isOldDone,
    TK_groupMyTasks: TK_groupMyTasks,
    TK_compareTasks: TK_compareTasks,
    TK_dueLabel: TK_dueLabel,
    TK_ymd: TK_ymd,
    TK_addDays: TK_addDays,
    TK_addMonths: TK_addMonths,
    TK_dayDiff: TK_dayDiff,
    TK_weekday: TK_weekday,
    TK_isBusinessDay: TK_isBusinessDay,
    TK_addBusinessDays: TK_addBusinessDays,
    TK_nthBusinessDay: TK_nthBusinessDay,
    TK_parseQuickAdd: TK_parseQuickAdd,
    TK_qaIgnoreKey: TK_qaIgnoreKey,
    TK_slug: TK_slug,
    TK_mentionTokens: TK_mentionTokens,
    TK_handleOf: TK_handleOf,
    TK_isUuid: TK_isUuid,
    TK_parseRoute: TK_parseRoute,
    TK_formatRoute: TK_formatRoute,
    TK_KEYMAP: TK_KEYMAP,
    TK_shouldHandleKey: TK_shouldHandleKey,
    TK_canEdit: TK_canEdit,
    TK_normalizeTask: TK_normalizeTask,
    TK_isMissingColumn: TK_isMissingColumn,
    TK_isMissingFunction: TK_isMissingFunction,
  };
}
