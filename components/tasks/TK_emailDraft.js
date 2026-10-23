// ----------------------------------------------------------------------------
// TK_emailDraft.js — month rhythm email drafts (E1). Pure: no React, no DOM,
// no Supabase. Browser globals (window.__SOURCE_ORDER) and node exports:
//   node components/tasks/TK_emailDraft.test.js
//
// Spec: docs/email-drafts-spec.md and docs/slate-month-rhythm-build-plan.md
// ("Email drafts"). Wording: the firm's "BOOKKEEPER - 4, 14, 24 Template" doc,
// standard sections copied as written. The portal never sends, stores or
// creates Gmail drafts: the builder returns text, the person copies it.
//
//   TK_emailKindOf(tpl)            "request" | "reports" | "maintenance" | null
//   TK_emailPeriodOf(task)         "YYYY-MM-01" for a month task, else null
//   TK_emailClientDays(rhythm)     { reports, replyBy, next } client-facing ordinals
//   TK_emailIsUncategorized(name, uncategorizedNames)
//   TK_emailMissingStatements(accounts, period)
//   TK_emailClarifications(txns, period, uncategorizedNames)
//   TK_emailOpenRequests(requests, docRequests)
//   TK_emailReportOption(reportState, closeCheck)   "A" | "B" | null
//   TK_emailDraftBuild(input)      { kind, subject, body, cc, option, counts }
//   TK_emailCopyText(draft)        subject + blank line + body
// ----------------------------------------------------------------------------

var TK_EMAIL_KINDS = ["request", "reports", "maintenance"];
var TK_EMAIL_LIST_MAX = 40; // lines per list before "and N more"
var TK_EMAIL_NONE = "None this month.";
var TK__EM_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August",
  "September", "October", "November", "December"];
// Same words the GL Review treats as a holding account (GLR_config suspense).
var TK_EMAIL_SUSPENSE_RE = /ask my accountant|ask (the )?client|uncategori[sz]ed|suspense/i;
var TK_EMAIL_DEPOSIT_RE = /deposit|sales receipt|^payment$/i;

function TK_emailKindOf(tpl) {
  var k = tpl && typeof tpl === "object" ? tpl.email_kind : tpl;
  return TK_EMAIL_KINDS.indexOf(k) >= 0 ? k : null;
}

// Button and modal names for each kind (the three rhythm emails).
var TK_EMAIL_LABELS = {
  request: "Request for information",
  reports: "Reports email",
  maintenance: "Mid-month update",
};
function TK_emailKindLabel(kind) {
  return TK_EMAIL_LABELS[kind] || "Email";
}

function TK_emailPeriodOf(task) {
  if (!task || task.period_kind !== "month" || !task.period_start) return null;
  var m = String(task.period_start).slice(0, 7);
  return /^\d{4}-\d{2}$/.test(m) ? m + "-01" : null;
}

function TK_em__ordinal(n) {
  var x = Number(n);
  var m100 = x % 100;
  var m10 = x % 10;
  var suf = m100 >= 11 && m100 <= 13 ? "th" : m10 === 1 ? "st" : m10 === 2 ? "nd" : m10 === 3 ? "rd" : "th";
  return x + suf;
}

function TK_em__day(rhythm, key, fallback) {
  var parts = rhythm && Array.isArray(rhythm.parts) ? rhythm.parts : [];
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i];
    if (p && p.key === key && typeof p.day === "number" && isFinite(p.day)) return p.day;
  }
  return fallback;
}

// Client-facing dates are the internal part day plus one (owner, 2026-10-20):
// reports 14 -> "15th"; check in 4 -> next request by the "5th". The reply-by
// date is five days before the reports date ("10th"); when that would not come
// after the request goes out, it is the day before the reports date.
function TK_emailClientDays(rhythm) {
  var checkIn = TK_em__day(rhythm, "check_in", 4);
  var reports = TK_em__day(rhythm, "reports", 14);
  var clientReports = reports + 1;
  var replyBy = clientReports - 5;
  if (replyBy <= checkIn + 1) replyBy = reports;
  return {
    reports: TK_em__ordinal(clientReports),
    replyBy: TK_em__ordinal(replyBy),
    next: TK_em__ordinal(checkIn + 1),
  };
}

function TK_em__monthLabel(period) {
  var m = /^(\d{4})-(\d{2})/.exec(String(period || ""));
  if (!m) return "";
  var i = Number(m[2]) - 1;
  return i >= 0 && i < 12 ? TK__EM_MONTHS[i] + " " + m[1] : "";
}

// Last day of the period's month, "YYYY-MM-DD".
function TK_em__monthEnd(period) {
  var m = /^(\d{4})-(\d{2})/.exec(String(period || ""));
  if (!m) return "";
  var y = Number(m[1]);
  var mo = Number(m[2]);
  var last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return m[1] + "-" + m[2] + "-" + (last < 10 ? "0" : "") + last;
}

function TK_em__clean(v) {
  return String(v == null ? "" : v).replace(/\s+/g, " ").trim();
}

function TK_em__money(n) {
  var x = Math.abs(Number(n) || 0);
  var parts = x.toFixed(2).split(".");
  return "$" + parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "." + parts[1];
}

function TK_em__date(ymd) {
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ""));
  return m ? m[2] + "/" + m[3] + "/" + m[1] : "";
}

function TK_emailIsUncategorized(name, uncategorizedNames) {
  var n = TK_em__clean(name);
  if (!n) return false;
  if (TK_EMAIL_SUSPENSE_RE.test(n)) return true;
  var list = Array.isArray(uncategorizedNames) ? uncategorizedNames : [];
  var low = n.toLowerCase();
  for (var i = 0; i < list.length; i++) if (TK_em__clean(list[i]).toLowerCase() === low) return true;
  return false;
}

// Bank and card accounts not reconciled through the end of the month.
// Account numbers are not in the sync, so the account name is used.
function TK_emailMissingStatements(accounts, period) {
  var end = TK_em__monthEnd(period);
  var label = TK_em__monthLabel(period);
  if (!end) return [];
  var seen = {};
  var out = [];
  (Array.isArray(accounts) ? accounts : []).forEach(function (a) {
    if (!a || (a.kind !== "bank" && a.kind !== "credit_card")) return;
    var name = TK_em__clean(a.name);
    if (!name || seen[name.toLowerCase()]) return;
    var rec = a.last_reconciled_date ? String(a.last_reconciled_date).slice(0, 10) : "";
    if (rec && rec >= end) return;
    seen[name.toLowerCase()] = true;
    out.push(name + " - " + label + " Statement");
  });
  return out.sort(function (x, y) {
    return x.toLowerCase() < y.toLowerCase() ? -1 : x.toLowerCase() > y.toLowerCase() ? 1 : 0;
  });
}

// Transactions in the month on an Uncategorized / Ask My Accountant account.
function TK_emailClarifications(txns, period, uncategorizedNames) {
  var start = /^\d{4}-\d{2}/.test(String(period || "")) ? String(period).slice(0, 7) + "-01" : "";
  var end = TK_em__monthEnd(period);
  if (!start || !end) return [];
  var rows = (Array.isArray(txns) ? txns : []).filter(function (t) {
    if (!t || !t.txn_date) return false;
    var d = String(t.txn_date).slice(0, 10);
    if (d < start || d > end) return false;
    return TK_emailIsUncategorized(t.account_name, uncategorizedNames) || TK_emailIsUncategorized(t.split_account, uncategorizedNames);
  });
  rows.sort(function (a, b) {
    var da = String(a.txn_date).slice(0, 10);
    var db = String(b.txn_date).slice(0, 10);
    if (da !== db) return da < db ? -1 : 1;
    return Math.abs(Number(b.amount) || 0) - Math.abs(Number(a.amount) || 0);
  });
  var seen = {};
  var out = [];
  rows.forEach(function (t) {
    var key = String(t.qbo_id || "") + "|" + String(t.txn_type || "");
    if (t.qbo_id && seen[key]) return;
    seen[key] = true;
    var name = TK_em__clean(t.name);
    var memo = TK_em__clean(t.memo);
    var memoPart = memo ? ' (memo: "' + memo + '")' : "";
    var when = TK_em__date(t.txn_date);
    var amt = TK_em__money(t.amount);
    if (TK_EMAIL_DEPOSIT_RE.test(TK_em__clean(t.txn_type))) {
      out.push("Uncategorized deposit on " + when + " for " + amt + (name ? ' from "' + name + '"' : "") + memoPart + " – Please confirm source of funds.");
    } else {
      out.push("Debit on " + when + " for " + amt + (name ? ' to "' + name + '"' : "") + memoPart + " – What was the business purpose?");
    }
  });
  return out;
}

// Open Ask client requests (never legacy or deleted) and open document
// requests, deduped by title, in the order given.
function TK_emailOpenRequests(requests, docRequests) {
  var seen = {};
  var out = [];
  function add(title) {
    var t = TK_em__clean(title);
    if (!t || seen[t.toLowerCase()]) return;
    seen[t.toLowerCase()] = true;
    out.push(t);
  }
  (Array.isArray(requests) ? requests : []).forEach(function (r) {
    if (!r || r.status !== "open" || r.legacy || r.legacy_doc_request || r.deleted_at) return;
    add(r.title);
  });
  (Array.isArray(docRequests) ? docRequests : []).forEach(function (r) {
    if (!r || r.status !== "open") return;
    add(r.title);
  });
  return out;
}

// Email 2 follows the report state (slice 4): full -> A, preliminary -> B.
// With no state yet, close_checks suggests: ready -> A, blocked or behind -> B,
// anything else (no_data) -> null (both options stay for the bookkeeper).
function TK_emailReportOption(reportState, closeCheck) {
  var st = reportState && reportState.state;
  if (st === "full") return "A";
  if (st === "preliminary") return "B";
  var cs = closeCheck && closeCheck.status;
  if (cs === "ready") return "A";
  if (cs === "blocked" || cs === "behind") return "B";
  return null;
}

function TK_em__list(items) {
  var list = Array.isArray(items) ? items : [];
  if (!list.length) return ["  - " + TK_EMAIL_NONE];
  var shown = list.slice(0, TK_EMAIL_LIST_MAX).map(function (s) {
    return "  - " + s;
  });
  if (list.length > TK_EMAIL_LIST_MAX) shown.push("  - and " + (list.length - TK_EMAIL_LIST_MAX) + " more (see QuickBooks)");
  return shown;
}

function TK_em__labels(items) {
  var out = [];
  (Array.isArray(items) ? items : []).forEach(function (it) {
    var s = TK_em__clean(it && typeof it === "object" ? it.label : it);
    if (s && out.indexOf(s) < 0) out.push(s);
  });
  return out;
}

function TK_em__sign(name) {
  var n = TK_em__clean(name);
  return n ? [n, "MyGoodBooks"] : ["MyGoodBooks"];
}

// input: { kind, period, clientName, greetingName, accountManager, rhythm
// (merged client over firm), signerName, accounts, uncategorizedNames,
// transactions, requests, docRequests, closeCheck, reportState }
// Returns null when kind or period is missing.
function TK_emailDraftBuild(input) {
  var i = input || {};
  var kind = TK_emailKindOf(i.kind);
  var month = TK_em__monthLabel(i.period);
  if (!kind || !month) return null;
  var client = TK_em__clean(i.clientName) || "[Client Name]";
  var greet = TK_em__clean(i.greetingName) || TK_em__clean(i.clientName) || "[Client Name]";
  var days = TK_emailClientDays(i.rhythm);
  var cc = TK_em__clean(i.accountManager) || null;
  var lines = ["Hi " + greet + ",", ""];
  var subject = "";
  var option = null;
  var counts = {};

  if (kind === "request") {
    var stmts = TK_emailMissingStatements(i.accounts, i.period).concat(TK_emailOpenRequests(i.requests, i.docRequests));
    var clar = TK_emailClarifications(i.transactions, i.period, i.uncategorizedNames);
    counts = { statements: stmts.length, clarifications: clar.length };
    subject = "Monthly Bookkeeping Update & Request for Information – " + client + " – " + month;
    lines = lines.concat([
      "Hope you’re having a great week!",
      "",
      "We have entered all available accounting data for " + month + ". To keep your accounts up to date and stay on schedule to deliver your financial reports by the " + days.reports + " of this month, please review the request below.",
      "",
      "Important Reminder: Please provide the requested items and responses by the " + days.replyBy + " of this month. Receiving this information on time ensures we have enough time to finish reconciliation and send your reports on schedule. We will strive to send reports ahead of schedule if we receive all requested information.",
      "",
      "1. Missing Bank / Credit Card Statements:",
    ]).concat(TK_em__list(stmts)).concat(["", "2. Transaction Clarifications / Missing Information:"]).concat(TK_em__list(clar)).concat([
      "",
      "Please allow a 24 hour response time for any additional reports or requests.",
      "",
      "Thank you,",
      "",
    ]).concat(TK_em__sign(i.signerName));
  } else if (kind === "reports") {
    option = TK_emailReportOption(i.reportState, i.closeCheck);
    var pending;
    if (option === "A") pending = [];
    else if (i.reportState && i.reportState.state === "preliminary") pending = TK_em__labels(i.reportState.missing);
    else pending = TK_em__labels((i.closeCheck && i.closeCheck.reasons) || []).concat(TK_emailOpenRequests(i.requests, i.docRequests).filter(function (t) {
      return TK_em__labels((i.closeCheck && i.closeCheck.reasons) || []).indexOf(t) < 0;
    }));
    counts = { pending: pending.length };
    var optA = "All accounts have been fully reconciled based on the information provided. Here are some notes based on this last month’s activity:";
    var optB = "These reports are preliminary and currently incomplete due to pending items/statements noted below. Once we receive the outstanding items, we will update and re-issue your final reports.";
    var note = option === "A" ? ["Please note: " + optA] : option === "B" ? ["Please note: " + optB]
      : ["Please note: [Choose one and delete the other]", "  - " + optA, "  - " + optB];
    subject = "Financial Reports for " + client + " – " + month;
    lines = lines.concat([
      "Attached is the Google Drive link to your financial reports for " + month + ".",
      "",
      "[Google Drive link]",
      "",
    ]).concat(note).concat(["", "Pending Items (if applicable):"]).concat(TK_em__list(pending)).concat([
      "",
      "Key Observations / Highlights:",
      "  - 🟢 [e.g., Revenue increased by 10% compared to last month.]",
      "  - 🟡 [e.g., Note on high software expenses this month.]",
      "  - 🔴 [e.g., Overbudget on x,y,z.]",
      "",
      "Please allow a 24 hour response time for any additional reports or requests.",
      "",
      "Best regards,",
      "",
    ]).concat(TK_em__sign(i.signerName));
  } else {
    // One email, two sections (owner, 2026-10-20): the follow-up request for
    // what is still missing, then the standard maintenance update. With
    // nothing outstanding the follow-up section is left out.
    var still = i.reportState && i.reportState.state === "preliminary" && TK_em__labels(i.reportState.missing).length
      ? TK_em__labels(i.reportState.missing)
      : TK_emailOpenRequests(i.requests, i.docRequests);
    counts = { missing: still.length };
    subject = "Mid-Month Account Maintenance & Bank Connection Status – " + client;
    if (still.length) {
      lines = lines.concat([
        "We are still waiting on the items below for " + month + ". Once we receive them, we will finish and send your full reports.",
        "",
        "Still Needed:",
      ]).concat(TK_em__list(still)).concat([""]);
    }
    lines = lines.concat([
      "We completed our mid-month check on your QuickBooks Online account to ensure all transaction feeds are operating smoothly.",
      "",
      "Next Steps: We will perform our next complete update and send our standard monthly document/information request by the " + days.next + " of next month for any remaining items needed for this month's reports.",
      "",
      "Bank Connection Status:",
      "  - [All bank feeds are connected and working, or which account needs to be reconnected in QuickBooks]",
      "",
      "Additional Notes / Issues (if applicable):",
      "  - [Anything else the client should know or do]",
      "",
      "Please allow a 24 hour response time for any additional reports or requests.",
      "",
      "Best regards,",
      "",
    ]).concat(TK_em__sign(i.signerName));
  }
  return { kind: kind, subject: subject, body: lines.join("\n"), cc: cc, option: option, counts: counts };
}

function TK_emailCopyText(draft) {
  if (!draft) return "";
  return "Subject: " + String(draft.subject || "") + "\n\n" + String(draft.body || "");
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    TK_EMAIL_KINDS: TK_EMAIL_KINDS,
    TK_EMAIL_LIST_MAX: TK_EMAIL_LIST_MAX,
    TK_EMAIL_NONE: TK_EMAIL_NONE,
    TK_emailKindOf: TK_emailKindOf,
    TK_emailKindLabel: TK_emailKindLabel,
    TK_emailPeriodOf: TK_emailPeriodOf,
    TK_emailClientDays: TK_emailClientDays,
    TK_emailIsUncategorized: TK_emailIsUncategorized,
    TK_emailMissingStatements: TK_emailMissingStatements,
    TK_emailClarifications: TK_emailClarifications,
    TK_emailOpenRequests: TK_emailOpenRequests,
    TK_emailReportOption: TK_emailReportOption,
    TK_emailDraftBuild: TK_emailDraftBuild,
    TK_emailCopyText: TK_emailCopyText,
  };
}
