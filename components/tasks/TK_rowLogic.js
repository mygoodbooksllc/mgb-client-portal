// ----------------------------------------------------------------------------
// TK_rowLogic.js — pure rules for the task row's in-place cells and the
// "+ Add task" row (T1 + T2 of the Desk plan, docs/desk-right-spec.md §15).
//
// No React, no DOM, no Supabase. Browser globals (the file loads through
// window.__SOURCE_ORDER); exported for node tests:
//   node components/tasks/TK_rowLogic.test.js
//
//   avatar color                 TK_rwAvatarTone
//   due chip tone and choices    TK_rwDueTone, TK_rwDueChoices, TK_rwDuePatch, TK_rwDueSavePatch, TK_rwDueError
//   who may edit which cell      TK_rwAccess
//   priority cell                TK_RW_PRIORITIES, TK_rwPriorityOf
//   "+ Add task" per group       TK_rwGroupAdd
//
// Private helpers carry the TK_rw prefix so they never collide with another
// TK file.
// ----------------------------------------------------------------------------

var TK_RW_TONES = 8;

var TK_RW_PRIORITIES = [
  { key: "high", label: "High" },
  { key: "normal", label: "Normal" },
  { key: "low", label: "Low" },
];

function TK_rwLower(v) {
  return v == null ? "" : String(v).trim().toLowerCase();
}

// high | normal | low (anything else reads as normal, as the row always did).
function TK_rwPriorityOf(task) {
  var p = task && task.priority;
  return p === "high" || p === "low" ? p : "normal";
}

// 0..7: the same person always gets the same avatar color.
function TK_rwAvatarTone(key) {
  var s = TK_rwLower(key);
  if (!s) return 0;
  var h = 0;
  for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 9973;
  return h % TK_RW_TONES;
}

// ---- Dates (YYYY-MM-DD strings; calendar days only) ------------------------------------

function TK_rwParts(ymd) {
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ""));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function TK_rwAddDays(ymd, n) {
  var p = TK_rwParts(ymd);
  if (!p) return "";
  var d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
  var pad = function (x) {
    return x < 10 ? "0" + x : String(x);
  };
  return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
}

// 0 = Sunday .. 6 = Saturday.
function TK_rwWeekday(ymd) {
  var p = TK_rwParts(ymd);
  return p ? new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay() : -1;
}

// "late" (open and past due), "today" (open and due today), else "".
function TK_rwDueTone(task, today) {
  var due = task && task.due_date ? String(task.due_date).slice(0, 10) : "";
  if (!due || !TK_rwParts(due) || !today) return "";
  var status = task.status || (task.done ? "done" : "todo");
  if (status === "done" || task.done) return "";
  if (due < today) return "late";
  if (due === today) return "today";
  return "";
}

// The quick picks in the due picker: [{ key, label, date }].
function TK_rwDueChoices(today) {
  if (!TK_rwParts(today)) return [];
  var dow = TK_rwWeekday(today);
  var toMonday = ((8 - dow) % 7) || 7;
  return [
    { key: "today", label: "Today", date: today },
    { key: "tomorrow", label: "Tomorrow", date: TK_rwAddDays(today, 1) },
    { key: "nextweek", label: "Next Monday", date: TK_rwAddDays(today, toMonday) },
  ];
}

// The patch for one pick: "today" | "tomorrow" | "nextweek" | "clear" | "date"
// (value = YYYY-MM-DD). null when the pick is not usable.
function TK_rwDuePatch(choice, today, value) {
  if (choice === "clear") return { due_date: null };
  if (choice === "date") {
    var v = value == null ? "" : String(value);
    // A date box reports a value while the year is still being typed (0002,
    // 0020, 0202, 2026): only a real year counts, so a half-typed one never saves.
    var p = /^\d{4}-\d{2}-\d{2}$/.test(v) ? TK_rwParts(v) : null;
    return p && p[0] >= 2000 && p[0] <= 2099 ? { due_date: v } : null;
  }
  var hit = TK_rwDueChoices(today).filter(function (c) {
    return c.key === choice;
  })[0];
  return hit ? { due_date: hit.date } : null;
}

// The full save for a new due date, as the drawer sends it: due_at moves with
// the day and keeps any time of day; clearing the date on a repeating task
// turns the repeat off (a repeat needs a due date). helpers: { dueAt(ymd, hhmm),
// timeOf(iso) } (TK_dlDueAt / TK_dlTimeOf); without them due_at is the
// date-only stamp. patch: { due_date } from TK_rwDuePatch.
function TK_rwDueSavePatch(task, patch, helpers) {
  if (!patch || !("due_date" in patch)) return patch;
  var h = helpers || {};
  var v = patch.due_date || null;
  var out = { due_date: v };
  var time = typeof h.timeOf === "function" && task ? h.timeOf(task.due_at) : "";
  if (!v) out.due_at = null;
  else if (typeof h.dueAt === "function") out.due_at = h.dueAt(v, time);
  else out.due_at = v + "T00:00:00.000Z";
  if (!v && task && task.recurrence && task.recurrence !== "none") out.recurrence = "none";
  return out;
}

// Same rule as the drawer: the start date can't come after the due date.
// "" when the new due date is fine.
function TK_rwDueError(task, due) {
  var start = task && task.start_on ? String(task.start_on).slice(0, 10) : "";
  if (start && due && start > String(due)) return "The start date can't be after the due date.";
  return "";
}

// ---- Who may edit which cell (a hint; the server decides) --------------------------------
// ctx: { me, isAdmin, canEdit, online }. Matches the drawer: anyone who can
// edit the task may change its due date and priority; only its owner or an
// admin reassigns, and not while it sits in review.
function TK_rwAccess(task, ctx) {
  var c = ctx || {};
  var none = { edit: false, assign: false };
  if (!task || task.deleted_at || c.canEdit === false || c.online === false) return none;
  var me = TK_rwLower(c.me);
  var status = task.status || (task.done ? "done" : "todo");
  var inReview = status === "ready_for_review";
  var owner = !!me && TK_rwLower(task.staff_email) === me;
  var edit = !inReview;
  return { edit: edit, assign: edit && (owner || !!c.isAdmin) };
}

// ---- "+ Add task" at the bottom of a group -----------------------------------------------
// Where a new task starts for a given group. scope "my" = Slate / My Tasks by
// due date, "client" = the client drawer's groups. Returns
//   { show, due_date, client_id }   (due_date / client_id null when the group says nothing)
// Overdue, waiting, review, unassigned, done and the client panel's "For this
// page" groups get no add row: a task made there would not stay in the group
// it was typed into.
function TK_rwGroupAdd(groupKey, ctx) {
  var c = ctx || {};
  var key = String(groupKey == null ? "" : groupKey);
  var out = { show: false, due_date: null, client_id: null };
  if (c.canCreate === false) return out;
  var m = /^client:(.+)$/.exec(key);
  if (m) {
    if (m[1] === "__none__") return out; // the No client group: nothing to file a new task under
    out.show = true;
    out.client_id = m[1];
    return out;
  }
  if (key === "today") {
    out.show = !!TK_rwParts(c.today);
    out.due_date = out.show ? c.today : null;
  } else if (key === "week") {
    out.show = !!TK_rwParts(c.today);
    out.due_date = out.show ? TK_rwAddDays(c.today, 1) : null;
  } else if (key === "later") {
    out.show = true;
  }
  return out;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    TK_RW_PRIORITIES: TK_RW_PRIORITIES,
    TK_rwPriorityOf: TK_rwPriorityOf,
    TK_rwAvatarTone: TK_rwAvatarTone,
    TK_rwAddDays: TK_rwAddDays,
    TK_rwDueTone: TK_rwDueTone,
    TK_rwDueChoices: TK_rwDueChoices,
    TK_rwDuePatch: TK_rwDuePatch,
    TK_rwDueSavePatch: TK_rwDueSavePatch,
    TK_rwDueError: TK_rwDueError,
    TK_rwAccess: TK_rwAccess,
    TK_rwGroupAdd: TK_rwGroupAdd,
  };
}
