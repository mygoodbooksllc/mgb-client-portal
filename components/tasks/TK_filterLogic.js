// ----------------------------------------------------------------------------
// TK_filterLogic.js — pure rules for the Slate page search box
// (docs/slateplus-filters-spec.md section 2). Plain JS, no React, no network.
//
// Search (live for all staff): TK_searchTerms, TK_searchMatch, TK_applySearch.
// Every word of the query must appear (substring, any case) in the task title,
// its client's name or its notes. An empty query gives the same array back, so
// the Slate list is built exactly as before for anyone not typing.
//
// Filter bar + saved filters (Slate plus preview only, TKP_on()):
// TK_normalizeSlateFilters, TK_slateFiltersActive, TK_applySlateFilters,
// TK_slateFiltersEqual, TK_filterViewNameCheck, TK_filterViewErrorCode /
// TK_filterViewErrorText. Nothing here runs unless the gate is on.
//
// Node tests: components/tasks/TK_filterLogic.test.js
// ----------------------------------------------------------------------------

var TK_SEARCH_MAX = 200;

function TK__fLower(s) {
  return s == null ? "" : String(s).toLowerCase();
}

// "  Bank  RECON " -> ["bank", "recon"]. Capped at 200 characters.
function TK_searchTerms(q) {
  var text = TK__fLower(q).slice(0, TK_SEARCH_MAX).trim();
  if (!text) return [];
  return text.split(/\s+/).filter(function (w) {
    return !!w;
  });
}

// ctx: { clientNameOf(clientId) -> name }. terms: TK_searchTerms output.
function TK_searchMatch(t, terms, ctx) {
  if (!t) return false;
  var list = Array.isArray(terms) ? terms : [];
  if (!list.length) return true;
  var c = ctx || {};
  var client = t.client_id != null && typeof c.clientNameOf === "function" ? c.clientNameOf(t.client_id) : "";
  var hay = TK__fLower(t.text) + "\n" + TK__fLower(client) + "\n" + TK__fLower(t.description);
  for (var i = 0; i < list.length; i++) if (hay.indexOf(list[i]) < 0) return false;
  return true;
}

// The same array back when the query is empty (identity, so nothing changes).
function TK_applySearch(tasks, q, ctx) {
  var list = Array.isArray(tasks) ? tasks : [];
  var terms = TK_searchTerms(q);
  if (!terms.length) return tasks;
  return list.filter(function (t) {
    return TK_searchMatch(t, terms, ctx);
  });
}

// "1 task matches" / "3 tasks match" / "No tasks match".
function TK_searchCountText(n) {
  var k = Number(n) || 0;
  if (k <= 0) return "No tasks match";
  return k === 1 ? "1 task matches" : k + " tasks match";
}

// ---- Slate plus: filter bar (preview only) ---------------------------------
// A filter set: { q, assignee, client, project, due, from, to, status }.
//   assignee: "any" | "me" | "unassigned"
//   client:   "" (all) | client id
//   project:  "" (any) | "none" | project id
//   due:      "any" | "late" | "today" | "next7" | "next30" | "none" | "custom"
//             (custom uses from / to, YYYY-MM-DD, either may be empty)
//   status:   "any" | "late" | "waiting" | "todo" | "in_progress" | "ready_for_review"
// Relative due choices stay relative when saved (today is read at apply time).

var TK_FILTER_ASSIGNEE = ["any", "me", "unassigned"];
var TK_FILTER_DUE = ["any", "late", "today", "next7", "next30", "none", "custom"];
var TK_FILTER_STATUS = ["any", "late", "waiting", "todo", "in_progress", "ready_for_review"];
var TK_FILTER_VIEW_NAME_MAX = 60;
var TK_FILTER_VIEW_MAX = 30;

function TK__fYmd(v) {
  var s = v == null ? "" : String(v).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "";
  var d = new Date(s + "T00:00:00Z");
  return isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? "" : s;
}

function TK__fAddDays(ymd, n) {
  var d = new Date(ymd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function TK__fId(v) {
  if (v == null) return "";
  var s = String(v).trim();
  return s.length > 80 ? "" : s;
}

// Any stored or typed value -> a safe filter set (unknown keys dropped).
function TK_normalizeSlateFilters(raw) {
  var r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  var pick = function (v, list) {
    return list.indexOf(v) >= 0 ? v : list[0];
  };
  var q = typeof r.q === "string" ? r.q.slice(0, TK_SEARCH_MAX) : "";
  var due = pick(r.due, TK_FILTER_DUE);
  var from = due === "custom" ? TK__fYmd(r.from) : "";
  var to = due === "custom" ? TK__fYmd(r.to) : "";
  if (from && to && from > to) {
    var tmp = from;
    from = to;
    to = tmp;
  }
  if (due === "custom" && !from && !to) due = "any";
  var project = TK__fId(r.project);
  return {
    q: q,
    assignee: pick(r.assignee, TK_FILTER_ASSIGNEE),
    client: TK__fId(r.client),
    project: project,
    due: due,
    from: from,
    to: to,
    status: pick(r.status, TK_FILTER_STATUS),
  };
}

// True when anything (search or a filter) narrows the list.
function TK_slateFiltersActive(f) {
  var n = TK_normalizeSlateFilters(f);
  return !!(n.q.trim() || n.assignee !== "any" || n.client || n.project || n.due !== "any" || n.status !== "any");
}

// Same filter set (search compared by its words, so "  a  b" equals "a b").
function TK_slateFiltersEqual(a, b) {
  var x = TK_normalizeSlateFilters(a);
  var y = TK_normalizeSlateFilters(b);
  return (
    TK_searchTerms(x.q).join(" ") === TK_searchTerms(y.q).join(" ") &&
    x.assignee === y.assignee &&
    x.client === y.client &&
    x.project === y.project &&
    x.due === y.due &&
    x.from === y.from &&
    x.to === y.to &&
    x.status === y.status
  );
}

// ctx: { email, today (YYYY-MM-DD), statusOf(t), isLate(t, today),
//        clientNameOf(id) }. statusOf / isLate default to TK_effectiveStatus /
// TK_isOverdue when loaded (TK_isOverdue already skips waiting-on-client and
// excused tasks via TK_lateExcused). The search (f.q) is NOT applied here:
// the caller runs TK_applySearch with the same text, so the box stays one
// source. Nothing set = the same array back.
function TK_applySlateFilters(tasks, f, ctx) {
  var n = TK_normalizeSlateFilters(f);
  if (n.assignee === "any" && !n.client && !n.project && n.due === "any" && n.status === "any") return tasks;
  var list = Array.isArray(tasks) ? tasks : [];
  var c = ctx || {};
  var me = TK__fLower(c.email);
  var today = TK__fYmd(c.today) || new Date().toISOString().slice(0, 10);
  var statusOf =
    typeof c.statusOf === "function"
      ? c.statusOf
      : typeof TK_effectiveStatus === "function"
        ? TK_effectiveStatus
        : function (t) {
            return t && t.status;
          };
  var isLate =
    typeof c.isLate === "function"
      ? c.isLate
      : typeof TK_isOverdue === "function"
        ? TK_isOverdue
        : function () {
            return false;
          };
  var next7 = TK__fAddDays(today, 7);
  var next30 = TK__fAddDays(today, 30);
  return list.filter(function (t) {
    if (!t) return false;
    if (n.assignee !== "any") {
      var who = TK__fLower(t.assignee_email);
      if (n.assignee === "me" && (!me || who !== me)) return false;
      if (n.assignee === "unassigned" && who) return false;
    }
    if (n.client && String(t.client_id == null ? "" : t.client_id) !== n.client) return false;
    if (n.project) {
      var pid = t.project_id == null ? "" : String(t.project_id);
      if (n.project === "none" ? !!pid : pid !== n.project) return false;
    }
    var due = TK__fYmd(t.due_date);
    if (n.due === "late" && !isLate(t, today)) return false;
    if (n.due === "today" && due !== today) return false;
    if (n.due === "next7" && !(due && due >= today && due <= next7)) return false;
    if (n.due === "next30" && !(due && due >= today && due <= next30)) return false;
    if (n.due === "none" && due) return false;
    if (n.due === "custom" && !(due && (!n.from || due >= n.from) && (!n.to || due <= n.to))) return false;
    if (n.status !== "any") {
      var st = statusOf(t);
      if (n.status === "late") {
        if (!isLate(t, today)) return false;
      } else if (n.status === "waiting") {
        if (st !== "waiting_client") return false;
      } else if (st !== n.status) return false;
    }
    return true;
  });
}

// Name rules before saving. rows: my saved sets; exceptId: the one renamed.
// -> { ok: true, name } | { ok: false, code, text }
function TK_filterViewNameCheck(raw, rows, exceptId) {
  var name = String(raw == null ? "" : raw)
    .replace(/\s+/g, " ")
    .trim();
  if (!name) return { ok: false, code: "blank", text: TK_filterViewErrorText("blank") };
  if (name.length > TK_FILTER_VIEW_NAME_MAX) return { ok: false, code: "too_long", text: TK_filterViewErrorText("too_long") };
  var low = name.toLowerCase();
  var list = Array.isArray(rows) ? rows : [];
  for (var i = 0; i < list.length; i++) {
    var r = list[i];
    if (!r || (exceptId != null && String(r.id) === String(exceptId))) continue;
    if (TK__fLower(r.name) === low) return { ok: false, code: "duplicate", text: TK_filterViewErrorText("duplicate") };
  }
  if (exceptId == null && list.length >= TK_FILTER_VIEW_MAX) return { ok: false, code: "too_many", text: TK_filterViewErrorText("too_many") };
  return { ok: true, name: name };
}

// Database error -> one of our codes, or "".
function TK_filterViewErrorCode(err) {
  if (!err) return "";
  var m = String((err.message || "") + " " + (err.details || "") + " " + (err.code || ""));
  if (m.indexOf("tk_slate_filter_views_owner_name_uq") >= 0) return "duplicate";
  if (m.indexOf("tk_slate_filter_views_name_check") >= 0) return "too_long";
  if (m.indexOf("tk_slate_filter_views_filters_check") >= 0) return "too_big";
  if (m.indexOf("tk_too_many_views") >= 0) return "too_many";
  if (m.indexOf("tk_not_found") >= 0) return "not_found";
  if (m.indexOf("tk_offline") >= 0) return "offline";
  return "";
}

function TK_filterViewErrorText(code) {
  switch (code) {
    case "blank":
      return "Give it a name.";
    case "too_long":
      return "Use a name of 1 to " + TK_FILTER_VIEW_NAME_MAX + " characters.";
    case "duplicate":
      return "You already have a saved filter with that name.";
    case "too_many":
      return "You can keep up to " + TK_FILTER_VIEW_MAX + " saved filters. Delete one first.";
    case "too_big":
      return "That filter is too long to save. Shorten the search.";
    case "not_found":
      return "That saved filter is gone. It may have been deleted in another window.";
    case "offline":
      return "You're offline. Try again when you're back online.";
    default:
      return "Couldn't save that. Try again.";
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    TK_SEARCH_MAX: TK_SEARCH_MAX,
    TK_searchTerms: TK_searchTerms,
    TK_searchMatch: TK_searchMatch,
    TK_applySearch: TK_applySearch,
    TK_searchCountText: TK_searchCountText,
    TK_FILTER_ASSIGNEE: TK_FILTER_ASSIGNEE,
    TK_FILTER_DUE: TK_FILTER_DUE,
    TK_FILTER_STATUS: TK_FILTER_STATUS,
    TK_FILTER_VIEW_NAME_MAX: TK_FILTER_VIEW_NAME_MAX,
    TK_FILTER_VIEW_MAX: TK_FILTER_VIEW_MAX,
    TK_normalizeSlateFilters: TK_normalizeSlateFilters,
    TK_slateFiltersActive: TK_slateFiltersActive,
    TK_slateFiltersEqual: TK_slateFiltersEqual,
    TK_applySlateFilters: TK_applySlateFilters,
    TK_filterViewNameCheck: TK_filterViewNameCheck,
    TK_filterViewErrorCode: TK_filterViewErrorCode,
    TK_filterViewErrorText: TK_filterViewErrorText,
  };
}
