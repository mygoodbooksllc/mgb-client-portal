// ----------------------------------------------------------------------------
// TK_bookkeeperLogic.js — pure wording and picking for "Change bookkeeper"
// on a client's Slate list header (2026-10-22a; spec
// docs/slate-change-bookkeeper.md).
//
// No React, no DOM, no Supabase. Browser globals (loads after
// TK_clientLogic.js), exported for node tests:
//   node components/tasks/TK_bookkeeperLogic.test.js
//
// What lives here:
//   who can be picked              TK_bkEligible
//   panel and confirm wording      TK_bkMoveLabel, TK_bkHelpText, TK_bkConfirmText
//   result and error wording       TK_bkSuccessText, TK_bkErrorText, TK_bkErrorReloads
//
// The server is public.tk_change_bookkeeper (supabase/slate-change-bookkeeper.sql).
// ----------------------------------------------------------------------------

function TK_bkLower(s) {
  return String(s == null ? "" : s).trim().toLowerCase();
}

function TK_bkFirst(name, fallback) {
  var s = String(name == null ? "" : name).trim();
  return s ? s.split(/\s+/)[0] : fallback;
}

// Active staff with an email, sorted by name, the current bookkeeper left out.
function TK_bkEligible(staff, currentEmail) {
  var cur = TK_bkLower(currentEmail);
  var seen = {};
  return (Array.isArray(staff) ? staff : [])
    .filter(function (s) {
      if (!s || !s.email || s.active === false) return false;
      var e = TK_bkLower(s.email);
      if (!e || e === cur || seen[e]) return false;
      seen[e] = true;
      return true;
    })
    .sort(function (a, b) {
      return String(a.name || a.email).localeCompare(String(b.name || b.email));
    });
}

// Checkbox label. Names are first names; "the new bookkeeper" before a pick.
function TK_bkMoveLabel(oldName, newName) {
  return "Also move " + TK_bkFirst(oldName, "the current bookkeeper") + "'s open tasks on this client to " + TK_bkFirst(newName, "the new bookkeeper");
}

function TK_bkHelpText(oldName) {
  var who = TK_bkFirst(oldName, "The current bookkeeper");
  return (
    "Moves open tasks on this client that " + TK_bkFirst(oldName, "the current bookkeeper") +
    " owns and that are on them or on nobody. Tasks in review, private tasks, and tasks anyone else owns or is on stay as they are. " +
    who + " keeps access to the client. No email is sent."
  );
}

function TK_bkConfirmText(oldName, newName, clientName, moveTasks) {
  var nw = TK_bkFirst(newName, "them");
  var client = String(clientName == null ? "" : clientName).trim() || "this client";
  return (
    "Make " + nw + " the bookkeeper for " + client + "? " +
    (moveTasks ? TK_bkFirst(oldName, "The current bookkeeper") + "'s open tasks here move to them." : "Tasks stay where they are.")
  );
}

// Toast after a change; res is the RPC result (tasks_moved, tasks_in_review).
function TK_bkSuccessText(res, oldName, newName) {
  var r = res || {};
  var moved = Number(r.tasks_moved) || 0;
  var review = Number(r.tasks_in_review) || 0;
  var oldFirst = TK_bkFirst(oldName, "the old bookkeeper");
  var out = TK_bkFirst(newName, "The new bookkeeper") + " is now the bookkeeper.";
  if (moved) out += " Moved " + moved + (moved === 1 ? " task" : " tasks") + " from " + oldFirst + ".";
  if (review) out += " " + review + " in review stay" + (review === 1 ? "s" : "") + " with " + oldFirst + ".";
  return out;
}

var TK_BK_ERRORS = {
  tk_forbidden: "Only admins can change the bookkeeper.",
  tk_bad_assignee: "Pick someone who's active on staff.",
  tk_not_found: "We couldn't find that client.",
  tk_same_bookkeeper: "They're already the bookkeeper.",
  tk_no_team: "This client has no bookkeeper yet. Use Assign team.",
};

// The error code from a rejected rpcWrite (reason, code or message text).
function TK_bkErrorCode(err) {
  if (!err) return "";
  var parts = [err.reason, err.code, err.message, typeof err === "string" ? err : ""];
  for (var i = 0; i < parts.length; i++) {
    var s = String(parts[i] || "");
    for (var k in TK_BK_ERRORS) if (s.indexOf(k) >= 0) return k;
  }
  return "";
}

// Plain copy for a known code, else null (the caller falls back to TK_vErrText).
function TK_bkErrorText(err) {
  var code = TK_bkErrorCode(err);
  return code ? TK_BK_ERRORS[code] : null;
}

// Errors that mean the header is out of date and should reload.
function TK_bkErrorReloads(err) {
  var code = TK_bkErrorCode(err);
  return code === "tk_same_bookkeeper" || code === "tk_no_team";
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    TK_BK_ERRORS: TK_BK_ERRORS,
    TK_bkEligible: TK_bkEligible,
    TK_bkMoveLabel: TK_bkMoveLabel,
    TK_bkHelpText: TK_bkHelpText,
    TK_bkConfirmText: TK_bkConfirmText,
    TK_bkSuccessText: TK_bkSuccessText,
    TK_bkErrorCode: TK_bkErrorCode,
    TK_bkErrorText: TK_bkErrorText,
    TK_bkErrorReloads: TK_bkErrorReloads,
  };
}
