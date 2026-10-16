// Tasks module: out-of-office hand-off rules (tasks phase 2, slice S7).
//
// Pure rules, no React, no DOM, no Supabase. The database is the authority:
// tk_apply_ooo, tk_return_ooo, tk_my_coverage and the daily tk-ooo-daily job
// (supabase/tasks-p2-7-ooo.sql) decide what moves and who may move it. These
// helpers only word the preview, the results and the "covered by" labels.
//
// What moves: open tasks (To do, In progress, Waiting on client) due inside
// the time off go to the client's backup bookkeeper. Ready for review stays.
// Private tasks and MGB (internal) tasks never move. Everything goes back
// when the time off ends, unless someone reassigned it by hand.
//
// Loads after TK_logic.js. Node test: `node components/tasks/TK_coverageLogic.test.js`.

var TK_OOO_SKIP_COPY = {
  private: "Private or internal task. It stays with you.",
  no_backup: "This client has no backup bookkeeper.",
  self: "You are this client's backup.",
  backup_away: "The backup is also out that day.",
  no_access: "The backup can't open this client yet.",
  error: "Couldn't move it. Try again.",
};
var TK_OOO_LEFT_COPY = {
  closed: "already done",
  changed: "someone reassigned it",
  in_review: "in review; it comes back once the review is finished",
  owner_inactive: "the person is no longer active staff",
  error: "couldn't move it",
};
var TK_OOO_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function TK__ooLower(s) {
  return s == null ? "" : String(s).trim().toLowerCase();
}

// "2026-10-12" -> "Oct 12". Anything else comes back as given.
function TK_oooDate(iso) {
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (!m) return String(iso || "");
  return TK_OOO_MONTHS[Number(m[2]) - 1] + " " + Number(m[3]);
}

function TK__plural(n, one, many) {
  return n + " " + (n === 1 ? one : many || one + "s");
}

// Skip reason -> a sentence. Non-admins asking for a no_access client also
// send an access request to admins, so the copy says so.
function TK_oooSkipText(reason, isAdmin) {
  if (reason === "no_access" && !isAdmin) return "The backup can't open this client yet. Handing off asks an admin for access.";
  return TK_OOO_SKIP_COPY[reason] || "Not moved.";
}

// Groups a tk_apply_ooo preview for display.
// -> { moveCount, byBackup: [{ to, toName, items: [move] }], skips: [{ reason, text, items }],
//      privateCount, grants }
// Backups sorted by name; private skips are only counted (no titles exist).
function TK_oooPreviewGroups(res, isAdmin) {
  var r = res || {};
  var moves = Array.isArray(r.move) ? r.move : [];
  var skipsIn = Array.isArray(r.skip) ? r.skip : [];
  var map = {};
  var order = [];
  var grants = 0;
  moves.forEach(function (m) {
    var k = TK__ooLower(m.to);
    if (!map[k]) {
      map[k] = { to: k, toName: m.to_name || m.to || "", items: [] };
      order.push(k);
    }
    map[k].items.push(m);
    if (m.grant) grants++;
  });
  var byBackup = order.map(function (k) {
    map[k].items.sort(function (a, b) { return String(a.due || "").localeCompare(String(b.due || "")); });
    return map[k];
  });
  byBackup.sort(function (a, b) { return a.toName.localeCompare(b.toName); });
  var privateCount = 0;
  var sk = {};
  var skOrder = [];
  skipsIn.forEach(function (s) {
    if (s.reason === "private") {
      privateCount++;
      return;
    }
    var k = s.reason || "error";
    if (!sk[k]) {
      sk[k] = { reason: k, text: TK_oooSkipText(k, isAdmin), items: [] };
      skOrder.push(k);
    }
    sk[k].items.push(s);
  });
  return {
    moveCount: moves.length,
    byBackup: byBackup,
    skips: skOrder.map(function (k) { return sk[k]; }),
    privateCount: privateCount,
    grants: grants,
  };
}

// Clients an admin could pick a cover for: skipped for a reason an override
// fixes (no backup, backup away, backup is the person who is out, no access).
// -> [{ client_id, client_name, reason, count }]
function TK_oooOverrideClients(res) {
  var r = res || {};
  var out = [];
  var seen = {};
  (Array.isArray(r.skip) ? r.skip : []).forEach(function (s) {
    if (!s.client_id || ["no_backup", "backup_away", "self", "no_access"].indexOf(s.reason) < 0) return;
    if (seen[s.client_id]) {
      seen[s.client_id].count++;
      return;
    }
    seen[s.client_id] = { client_id: s.client_id, client_name: s.client_name || s.client_id, reason: s.reason, count: 1 };
    out.push(seen[s.client_id]);
  });
  out.sort(function (a, b) { return String(a.client_name).localeCompare(String(b.client_name)); });
  return out;
}

// Toast after a real hand-off.
function TK_oooApplyText(res) {
  var r = res || {};
  if (r.inactive) return "That time off is over or cancelled. Nothing moved.";
  var moved = Array.isArray(r.move) ? r.move.length : 0;
  var left = Array.isArray(r.skip) ? r.skip.length : 0;
  if (!moved && !left) return "Nothing to hand off: no open tasks due while you're out.";
  var s = moved ? TK__plural(moved, "task") + " handed to backups." : "Nothing moved.";
  if (left) s += " " + TK__plural(left, "task") + " stayed put.";
  return s;
}

// Toast after "Return now" (or the result of a cancel).
function TK_oooReturnText(res) {
  var r = res || {};
  var back = Array.isArray(r.returned) ? r.returned.length : 0;
  var left = Array.isArray(r.left) ? r.left : [];
  var s = back ? TK__plural(back, "task") + " back with the owner." : "Nothing to hand back.";
  var waiting = left.filter(function (x) { return x.reason === "in_review"; }).length;
  if (waiting) s += " " + TK__plural(waiting, "task") + " in review come" + (waiting === 1 ? "s" : "") + " back once reviewed.";
  return s;
}

// Open coverage rows (tk_my_coverage) by task id. A task has at most one.
function TK_coverageByTask(rows) {
  var out = {};
  (rows || []).forEach(function (r) {
    if (r && r.task_id) out[r.task_id] = r;
  });
  return out;
}

// Open coverage rows by time off id -> count.
function TK_coverageCountByTimeOff(rows) {
  var out = {};
  (rows || []).forEach(function (r) {
    if (r && r.time_off_id) out[r.time_off_id] = (out[r.time_off_id] || 0) + 1;
  });
  return out;
}

// Label for one covered task as seen by `me`.
// -> null | { tone: "covering" | "covered" | "other", text, title }
function TK_coverageLabel(row, me) {
  if (!row) return null;
  var my = TK__ooLower(me);
  var from = row.from_name || row.from_email || "";
  var to = row.to_name || row.to_email || "";
  var until = row.ends_on ? TK_oooDate(row.ends_on) : "";
  var title = "Handed off for time off" + (row.starts_on ? " " + TK_oooDate(row.starts_on) + " – " + until : "") +
    ". It goes back automatically when the time off ends.";
  if (TK__ooLower(row.to_email) === my)
    return { tone: "covering", text: "Covering for " + from + (until ? " until " + until : ""), title: title };
  if (TK__ooLower(row.from_email) === my)
    return { tone: "covered", text: "With " + to + " while you're out" + (until ? " (to " + until + ")" : ""), title: title };
  return { tone: "other", text: to + " is covering for " + from + (until ? " until " + until : ""), title: title };
}

// Today: the rows I am covering, grouped by who I'm covering for.
// -> [{ from, fromName, endsOn, count }]
function TK_coveringSummary(rows, me) {
  var my = TK__ooLower(me);
  var map = {};
  var order = [];
  (rows || []).forEach(function (r) {
    if (!r || TK__ooLower(r.to_email) !== my) return;
    var k = TK__ooLower(r.from_email);
    if (!map[k]) {
      map[k] = { from: k, fromName: r.from_name || r.from_email, endsOn: r.ends_on || "", count: 0 };
      order.push(k);
    }
    map[k].count++;
    if (r.ends_on && r.ends_on > map[k].endsOn) map[k].endsOn = r.ends_on;
  });
  return order.map(function (k) { return map[k]; });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    TK_OOO_SKIP_COPY: TK_OOO_SKIP_COPY,
    TK_OOO_LEFT_COPY: TK_OOO_LEFT_COPY,
    TK_oooDate: TK_oooDate,
    TK_oooSkipText: TK_oooSkipText,
    TK_oooPreviewGroups: TK_oooPreviewGroups,
    TK_oooOverrideClients: TK_oooOverrideClients,
    TK_oooApplyText: TK_oooApplyText,
    TK_oooReturnText: TK_oooReturnText,
    TK_coverageByTask: TK_coverageByTask,
    TK_coverageCountByTimeOff: TK_coverageCountByTimeOff,
    TK_coverageLabel: TK_coverageLabel,
    TK_coveringSummary: TK_coveringSummary,
  };
}
