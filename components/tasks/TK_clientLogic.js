// ----------------------------------------------------------------------------
// TK_clientLogic.js — pure rules for the client tasks strip and panel
// (2026-10-11b).
//
// No React, no DOM, no Supabase. Everything here is a browser global (the
// file loads through window.__SOURCE_ORDER, after TK_logic.js) and is exported
// for node tests:
//   node components/tasks/TK_clientLogic.test.js
//
// What lives here:
//   "For this page" rules          TK_CD_PAGE_RULES, TK_cdWords, TK_cdPageRule, TK_cdPageMatch
//   panel groups and buckets       TK_CD_GROUPS, TK_cdBucket, TK_cdGroups
//   strip summary                  TK_cdSummary
//   pop-out follow                 TK_cdValidClientId, TK_cdAcceptFollow
//
// The TK_logic.js helpers (TK_isOpen, TK_isOverdue, TK_dayDiff, TK_compareTasks,
// TK_effectiveStatus, TK_SOON_DAYS, TK_SOP_SECTION_IDS) are read through
// TK_cdFn: the browser global when there is one, else TK_logic.js through
// require() under node. Private names carry the TK_cd prefix.
// ----------------------------------------------------------------------------

var TK_cdNodeLogic = null;

// A TK_logic.js export by name: browser global first, then node's require.
function TK_cdFn(name) {
  try {
    if (typeof window !== "undefined" && window && window[name] != null) return window[name];
  } catch (e) {}
  if (TK_cdNodeLogic == null) {
    TK_cdNodeLogic = {};
    try {
      if (typeof require === "function") TK_cdNodeLogic = require("./TK_logic.js");
    } catch (e) {
      TK_cdNodeLogic = {};
    }
  }
  return TK_cdNodeLogic[name];
}

// ---- "For this page" ---------------------------------------------------------
// Page → rule. sops: sop_section values that match. sopAny: any non-null
// sop_section. sources: task.source values. words: whole-word, case-insensitive,
// in task.text only (never the description). Pages without a rule (overview,
// messages, milestone, dashboard and every staff page) get no group.
// sop_section ids come from TK_SOP_SECTION_IDS: access, bank_feeds,
// monthly_close, payroll, bills_vendors, reporting, quirks.
var TK_CD_PAGE_RULES = {
  "client-close": { sops: ["monthly_close"], words: ["close", "closing", "month-end", "reconcile", "reconciliation"] },
  bank: { sops: ["bank_feeds"], words: ["bank", "banks", "feed", "feeds", "reconcile", "reconciliation", "uncategorized", "statement", "statements"] },
  documents: { words: ["document", "documents", "statement", "statements", "receipt", "receipts", "upload", "uploads", "w-9", "1099"] },
  reports: { sops: ["reporting"], words: ["report", "reports", "board", "packet", "financials"] },
  payroll: { sops: ["payroll"], words: ["payroll", "paycheck", "paychecks", "w-2", "941", "940"] },
  "client-settings": { sops: ["access"], sources: ["access_request"], words: ["access", "login", "logins", "invite", "permissions"] },
  sop: { sopAny: true },
  budget: { words: ["budget", "budgets"] },
  giving: { words: ["giving", "contribution", "contributions", "donor", "donors", "pledge", "pledges"] },
  receivables: { words: ["invoice", "invoices", "receivable", "receivables"] },
};

var TK_CD_GROUPS = [
  { id: "page", label: "For this page" },
  { id: "overdue", label: "Overdue" },
  { id: "today", label: "Today" },
  { id: "week", label: "This week" },
  { id: "later", label: "Later" },
  { id: "waiting", label: "Waiting on client" },
  { id: "review", label: "Ready for review" },
  { id: "done", label: "Done" },
];

// Lowercased words of a text. Hyphens stay inside a word ("month-end", "w-9").
function TK_cdWords(text) {
  return String(text == null ? "" : text)
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter(function (w) {
      return !!w;
    });
}

function TK_cdPageRule(page) {
  if (typeof page !== "string") return null;
  return Object.prototype.hasOwnProperty.call(TK_CD_PAGE_RULES, page) ? TK_CD_PAGE_RULES[page] : null;
}

function TK_cdIn(list, value) {
  return Array.isArray(list) && list.indexOf(value) >= 0;
}

// Does this task belong to that page? Deterministic, from the task's own
// fields: sop_section, source and the words of its title.
function TK_cdPageMatch(task, page) {
  var rule = TK_cdPageRule(page);
  if (!rule || !task) return false;
  if (rule.sopAny && task.sop_section != null && task.sop_section !== "") return true;
  if (task.sop_section != null && TK_cdIn(rule.sops, task.sop_section)) return true;
  if (task.source != null && TK_cdIn(rule.sources, task.source)) return true;
  if (rule.words) {
    var words = TK_cdWords(task.text);
    for (var i = 0; i < words.length; i++) {
      if (rule.words.indexOf(words[i]) >= 0) return true;
    }
  }
  return false;
}

// ---- Buckets and groups ----------------------------------------------------------

function TK_cdDue(task) {
  return task && task.due_date ? String(task.due_date).slice(0, 10) : "";
}

// Exactly one bucket per task, decided in this order:
//   done, waiting, review, overdue, today, week (1 to TK_SOON_DAYS days), later.
function TK_cdBucket(task, today) {
  var isOpen = TK_cdFn("TK_isOpen");
  var effective = TK_cdFn("TK_effectiveStatus");
  var isOverdue = TK_cdFn("TK_isOverdue");
  var dayDiff = TK_cdFn("TK_dayDiff");
  var soon = TK_cdFn("TK_SOON_DAYS");
  if (typeof soon !== "number") soon = 7;
  if (!isOpen(task)) return "done";
  var status = effective(task);
  if (status === "waiting_client") return "waiting";
  if (status === "ready_for_review") return "review";
  if (isOverdue(task, today)) return "overdue";
  var due = TK_cdDue(task);
  if (!due) return "later";
  var d = dayDiff(today, due);
  if (d === 0) return "today";
  if (d >= 1 && d <= soon) return "week";
  return "later";
}

function TK_cdIsLive(task) {
  return !!task && task.kind !== "note" && !task.deleted_at;
}

// opts: { today, page, showDone }. Returns [{ id, label, tasks }], only the
// groups that have tasks, in TK_CD_GROUPS order. An open task that fits the
// page moves to the "page" group (it is never hidden and never twice). Done
// tasks show only with showDone and never go to "page".
function TK_cdGroups(tasks, opts) {
  var o = opts || {};
  var isOpen = TK_cdFn("TK_isOpen");
  var compare = TK_cdFn("TK_compareTasks");
  var byId = {};
  TK_CD_GROUPS.forEach(function (g) {
    byId[g.id] = [];
  });
  (Array.isArray(tasks) ? tasks : []).forEach(function (t) {
    if (!TK_cdIsLive(t)) return;
    var open = isOpen(t);
    if (!open) {
      if (o.showDone) byId.done.push(t);
      return;
    }
    if (TK_cdPageMatch(t, o.page)) {
      byId.page.push(t);
      return;
    }
    byId[TK_cdBucket(t, o.today)].push(t);
  });
  var out = [];
  TK_CD_GROUPS.forEach(function (g) {
    if (!byId[g.id].length) return;
    out.push({ id: g.id, label: g.label, tasks: byId[g.id].slice().sort(compare) });
  });
  return out;
}

// ---- Strip summary -----------------------------------------------------------------

// { open, overdue, next }. next is the first open task by TK_compareTasks
// (overdue first, then soonest due), skipping waiting and in-review tasks;
// when those are all that is open, the first of them; null with nothing open.
// With a page that has a rule, an open task that fits the page is preferred
// the same way (so the strip and the panel's "For this page" agree).
function TK_cdSummary(tasks, today, page) {
  var isOpen = TK_cdFn("TK_isOpen");
  var effective = TK_cdFn("TK_effectiveStatus");
  var isOverdue = TK_cdFn("TK_isOverdue");
  var compare = TK_cdFn("TK_compareTasks");
  var list = (Array.isArray(tasks) ? tasks : []).filter(function (t) {
    return TK_cdIsLive(t) && isOpen(t);
  });
  var overdue = list.filter(function (t) {
    return isOverdue(t, today);
  }).length;
  function pick(pool) {
    var active = pool.filter(function (t) {
      var s = effective(t);
      return s !== "waiting_client" && s !== "ready_for_review";
    });
    var from = active.length ? active : pool;
    return from.length ? from.slice().sort(compare)[0] : null;
  }
  var next = null;
  if (TK_cdPageRule(page)) {
    next = pick(
      list.filter(function (t) {
        return TK_cdPageMatch(t, page);
      }),
    );
    // A page match that is only waiting or in review does not beat an active task elsewhere.
    if (next) {
      var ns = effective(next);
      if (ns === "waiting_client" || ns === "ready_for_review") next = null;
    }
  }
  if (!next) next = pick(list);
  return { open: list.length, overdue: overdue, next: next };
}

// ---- Pop-out follow ----------------------------------------------------------------

// A record id: letters, digits and . _ ~ - only, 1 to 100 characters. Never an
// email, a name or free text.
function TK_cdValidClientId(id) {
  return typeof id === "string" && /^[A-Za-z0-9._~-]{1,100}$/.test(id);
}

// Should the pop-out act on this BroadcastChannel message? lastAt is the `at`
// of the last message it acted on; clientIds are the ids this person can open.
function TK_cdAcceptFollow(lastAt, msg, clientIds) {
  if (!msg || typeof msg !== "object" || msg.type !== "client-focus") return false;
  if (!TK_cdValidClientId(msg.clientId)) return false;
  if (!(typeof msg.at === "number" && isFinite(msg.at) && msg.at >= (lastAt || 0))) return false;
  return Array.isArray(clientIds) && clientIds.indexOf(msg.clientId) >= 0;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    TK_CD_PAGE_RULES: TK_CD_PAGE_RULES,
    TK_CD_GROUPS: TK_CD_GROUPS,
    TK_cdWords: TK_cdWords,
    TK_cdPageRule: TK_cdPageRule,
    TK_cdPageMatch: TK_cdPageMatch,
    TK_cdBucket: TK_cdBucket,
    TK_cdGroups: TK_cdGroups,
    TK_cdSummary: TK_cdSummary,
    TK_cdValidClientId: TK_cdValidClientId,
    TK_cdAcceptFollow: TK_cdAcceptFollow,
  };
}
