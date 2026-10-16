// Tasks module: Ask client rules (tasks phase 2, slice S5).
//
// Pure rules, no React, no DOM, no Supabase. The database is the authority:
// tk_ask_client, tk_cancel_client_request, tk_accept_client_request,
// tk_record_client_answer, tk_client_request_send and the waiting guard on
// staff_reminders enforce the same rules (supabase/tasks-p2-5-requests.sql).
// These copies decide what the UI offers and how it explains a refusal.
//
// Sending is a dry run until S6 ships the sender: tk_client_request_send
// never emails, it logs a skipped row and says what would have happened.
//
// Loads after TK_logic.js. Node test: `node components/tasks/TK_requestLogic.test.js`.

var TK_REQUEST_TITLE_MAX = 200;
var TK_REQUEST_PROMPT_MAX = 2000;
var TK_REQUEST_REPLY_MAX = 4000;
var TK_REQUEST_MAX_RECIPIENTS = 20;
var TK_REQUEST_KINDS = [
  { key: "question", label: "Question", hint: "They type an answer." },
  { key: "document", label: "Document", hint: "They upload a file (a statement, a receipt)." },
  { key: "approval", label: "Approval", hint: "They say yes or no to something." },
];
var TK_ASK_STATUSES = ["todo", "in_progress", "waiting_client"];

function TK__rqLower(s) {
  return s == null ? "" : String(s).trim().toLowerCase();
}

function TK__rqStatus(task) {
  if (!task) return "todo";
  if (task.status) return String(task.status);
  return task.done ? "done" : "todo";
}

// Can this task get an Ask client? { ok, why }.
function TK_canAskClient(task) {
  if (!task || task.deleted_at) return { ok: false, why: "This task was deleted." };
  if (!task.client_id) return { ok: false, why: "Only a client task can ask the client." };
  var s = TK__rqStatus(task);
  if (TK_ASK_STATUSES.indexOf(s) < 0) {
    if (s === "ready_for_review") return { ok: false, why: "Take it back from review first." };
    return { ok: false, why: "Reopen the task first." };
  }
  return { ok: true, why: null };
}

function TK__rqYmdAddDays(ymd, days) {
  var p = String(ymd || "").split("-");
  if (p.length !== 3) return "";
  var d = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]) + days));
  var pad = function (n) { return n < 10 ? "0" + n : String(n); };
  return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
}

// form: { title, prompt, kind, dueDate, emails[], contactIds[] }; today 'YYYY-MM-DD'.
// Returns { field: message } (empty object when it can be sent).
function TK_askFormErrors(form, today) {
  var f = form || {};
  var out = {};
  var title = String(f.title || "").trim();
  var prompt = String(f.prompt || "").trim();
  if (!title) out.title = "Add a short title.";
  else if (title.length > TK_REQUEST_TITLE_MAX) out.title = "Keep the title under " + TK_REQUEST_TITLE_MAX + " characters.";
  if (!prompt) out.prompt = "Say what you need from them.";
  else if (prompt.length > TK_REQUEST_PROMPT_MAX) out.prompt = "Keep the message under " + TK_REQUEST_PROMPT_MAX + " characters.";
  if (!TK_REQUEST_KINDS.some(function (k) { return k.key === f.kind; })) out.kind = "Pick what kind of answer you need.";
  var n = (f.emails || []).length + (f.contactIds || []).length;
  if (n === 0) out.recipients = "Pick at least one person to ask.";
  else if (n > TK_REQUEST_MAX_RECIPIENTS) out.recipients = "Ask at most " + TK_REQUEST_MAX_RECIPIENTS + " people at once.";
  if (f.dueDate) {
    if (today && String(f.dueDate) < String(today)) out.dueDate = "The date can't be in the past.";
    else if (today && String(f.dueDate) > TK__rqYmdAddDays(today, 366)) out.dueDate = "Pick a date within a year.";
  }
  return out;
}

// Chip for a request: { label, tone } (tone: wait | warn | ok | muted).
function TK_requestChip(req) {
  var r = req || {};
  if (r.status === "open") {
    if (r.no_reply) return { label: "No reply", tone: "warn" };
    return { label: "Waiting", tone: "wait" };
  }
  if (r.status === "answered") return { label: "Answered", tone: "ok" };
  if (r.status === "accepted") return { label: "Accepted", tone: "muted" };
  if (r.status === "cancelled") return { label: "Cancelled", tone: "muted" };
  return { label: String(r.status || ""), tone: "muted" };
}

// Which buttons a request row offers. ctx: { canEdit }.
function TK_requestActions(req, ctx) {
  var r = req || {};
  var canEdit = !!(ctx && ctx.canEdit);
  var none = { send: false, nudge: false, cancel: false, accept: false, record: false, pause: false, resume: false, revoke: false, askAgain: false };
  if (!canEdit || r.legacy || r.deleted_at) return none;
  var open = r.status === "open";
  var liveLinks = Number((r.links && r.links.live) || 0);
  return {
    send: open,
    nudge: open && !r.nudge_paused,
    cancel: open,
    accept: r.status === "answered",
    record: open,
    pause: open && !r.nudge_paused,
    resume: open && !!r.nudge_paused,
    revoke: open && liveLinks > 0,
    askAgain: r.status === "answered" || r.status === "accepted",
  };
}

// "Asked 3 business days ago" style.
function TK_waitingLabel(days) {
  var n = Number(days);
  if (!isFinite(n) || n <= 0) return "Asked today";
  return "Waiting " + n + " business day" + (n === 1 ? "" : "s");
}

// Plain words for what tk_client_request_send returned.
function TK_sendResultText(res, action) {
  var r = res || {};
  var n = (r.recipients || []).length;
  var who = n === 1 ? "1 person" : n + " people";
  if (action === "preview") {
    if (r.mode === "test") return "Test client: a copy would go only to you.";
    return "Would go to " + who + ".";
  }
  var what = action === "nudge" ? "Reminder" : "Email";
  var sent = Number(r.sent) || 0;
  // S6: the tk-client-requests function really sent (test clients: to you).
  if (sent > 0 && r.mode === "test") return "Test " + what.toLowerCase() + " sent to you only.";
  if (sent > 0) {
    var failed = Number(r.failed) || 0;
    return what + " sent to " + (sent === 1 ? "1 person" : sent + " people") + "." + (failed ? " " + failed + " didn't go out." : "");
  }
  if (r.mode === "test") return "Dry run: nothing sent. " + what + " for a test client would go only to you.";
  if (r.mode === "live") return "Dry run: nothing sent. The email sender isn't switched on yet.";
  return "Dry run: nothing sent. " + what + " would go to " + who + " once the owner turns on client requests.";
}

// Who wrote a client_reply comment: 'client:<email>' (portal) or
// 'contact:<contact id or email>' (answer link). names: { email or id -> name }.
function TK_requestAuthorLabel(author, names) {
  var a = String(author || "");
  var map = names || {};
  if (a.indexOf("client:") === 0) {
    var em = a.slice(7);
    return (map[TK__rqLower(em)] || em) + " (client)";
  }
  if (a.indexOf("contact:") === 0) {
    var key = a.slice(8);
    return (map[key] || map[TK__rqLower(key)] || "Client contact") + " (by link)";
  }
  return null;
}

// Waiting list rows (tk_waiting_on_client) grouped by client, the client
// with the longest wait first; inside a client the longest wait first.
function TK_waitingGroups(rows) {
  var by = {};
  var order = [];
  (rows || []).forEach(function (r) {
    var k = r.client_id || "";
    if (!by[k]) {
      by[k] = { clientId: k, clientName: r.client_name || k, rows: [], maxDays: 0 };
      order.push(k);
    }
    by[k].rows.push(r);
    by[k].maxDays = Math.max(by[k].maxDays, Number(r.business_days_waiting) || 0);
  });
  var groups = order.map(function (k) { return by[k]; });
  groups.forEach(function (g) {
    g.rows.sort(function (a, b) {
      return (Number(b.business_days_waiting) || 0) - (Number(a.business_days_waiting) || 0)
        || String(a.request_title || a.title || "").localeCompare(String(b.request_title || b.title || ""));
    });
  });
  groups.sort(function (a, b) { return b.maxDays - a.maxDays || String(a.clientName).localeCompare(String(b.clientName)); });
  return groups;
}

// Error code or reason -> plain words.
var TK_REQUEST_ERROR_COPY = {
  tk_has_open_requests: "This task is waiting on the client. Cancel the open request, or record their answer, to move it on.",
  tk_email_off: "Client email is switched off in Settings, so nothing can go out.",
  tk_no_recipients: "Pick at least one person to ask.",
  tk_bad_recipient: "One of those people can't be asked (not a portal user or contact of this client).",
  tk_legacy_request: "This older document request is managed in the client's Documents panel.",
  tk_reply_required: "Type the answer first.",
  tk_not_open: "That request is already closed.",
  tk_not_answered: "Only an answered request can be accepted.",
  tk_contact_exists: "That email is already a contact for this client.",
  tk_bad_contact: "Check the name and email.",
  tk_bad_request: "Check the details and try again.",
  tk_bad_transition: "Reopen the task first.",
  tk_forbidden: "You don't have access to this client.",
  tk_offline: "You're offline. Try again when you're back online.",
  tk_too_soon: "An email for this request went out in the last 10 minutes. Try again later.",
  tk_not_configured: "Email isn't set up yet, so nothing was sent.",
  tk_send_failed: "The email didn't go out. Try again.",
  tk_mode_changed: "The client email setting just changed. Try again.",
};

function TK_requestErrorText(err) {
  var e = err || {};
  var key = e.reason || e.code || "";
  return TK_REQUEST_ERROR_COPY[key] || "That didn't work. Try again.";
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    TK_REQUEST_TITLE_MAX: TK_REQUEST_TITLE_MAX,
    TK_REQUEST_PROMPT_MAX: TK_REQUEST_PROMPT_MAX,
    TK_REQUEST_REPLY_MAX: TK_REQUEST_REPLY_MAX,
    TK_REQUEST_MAX_RECIPIENTS: TK_REQUEST_MAX_RECIPIENTS,
    TK_REQUEST_KINDS: TK_REQUEST_KINDS,
    TK_REQUEST_ERROR_COPY: TK_REQUEST_ERROR_COPY,
    TK_canAskClient: TK_canAskClient,
    TK_askFormErrors: TK_askFormErrors,
    TK_requestChip: TK_requestChip,
    TK_requestActions: TK_requestActions,
    TK_waitingLabel: TK_waitingLabel,
    TK_sendResultText: TK_sendResultText,
    TK_requestAuthorLabel: TK_requestAuthorLabel,
    TK_waitingGroups: TK_waitingGroups,
    TK_requestErrorText: TK_requestErrorText,
  };
}
