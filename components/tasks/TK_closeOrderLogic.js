// Month rhythm S6: Option B, "close order", as a view on a client's list.
// The same tasks as Option A (the thirds), grouped by client month and put in
// rhythm row order (month_rhythm:1_check_in ... 8_follow_up). A "Next" pill
// marks the first open step; "Waiting on client" marks a step whose task is
// waiting or has an open Ask client request. Due dates show as a target hint,
// never red. Each person picks A or B per client list (localStorage only, no
// data change). Plain functions: browser globals and node exports.

var TK_CLOSE_ORDER_KEY = "mgb_tk_rhythm_view_v1";
var TK__CO_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August",
  "September", "October", "November", "December"];

function TK_closeOrderKey(email) {
  return TK_CLOSE_ORDER_KEY + ":" + String(email || "").trim().toLowerCase();
}

// 1..8 from a rhythm source_ref, else null.
function TK_closeOrderRowOf(ref) {
  var m = /^month_rhythm:(\d+)_/.exec(String(ref || ""));
  return m ? Number(m[1]) : null;
}

// "A" (default) or "B" for one client list, from the saved map.
function TK_closeOrderChoice(saved, clientId) {
  if (!saved || typeof saved !== "object" || Array.isArray(saved) || clientId == null) return "A";
  return saved[String(clientId)] === "B" ? "B" : "A";
}

// A new map with this client's choice; "A" removes the entry (the default).
function TK_closeOrderSave(saved, clientId, choice) {
  var out = {};
  var src = saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
  Object.keys(src).forEach(function (k) {
    if (src[k] === "B") out[k] = "B";
  });
  if (clientId == null) return out;
  if (choice === "B") out[String(clientId)] = "B";
  else delete out[String(clientId)];
  return out;
}

function TK__coMonthName(period) {
  var m = /^(\d{4})-(\d{2})/.exec(String(period || ""));
  if (!m) return "";
  var i = Number(m[2]) - 1;
  return i >= 0 && i < 12 ? TK__CO_MONTHS[i] + " " + m[1] : "";
}

function TK__coStatus(t) {
  return t.status || (t.done ? "done" : "todo");
}

// tasks: the list's tasks (already filtered). opts.refs: { template_id: source_ref }.
// opts.waitingIds: { task_id: true } for tasks with an open client request.
// Returns { groups, rest, pills }:
//   groups  one per client month with rhythm tasks, oldest first:
//           { key: "close:YYYY-MM-01", name: "September 2026 close", close: true, tasks }
//   rest    every other task, in the order given (the caller groups them as before)
//   pills   { task_id: "next" | "waiting" }
function TK_closeOrderGroups(tasks, opts) {
  var o = opts || {};
  var refs = o.refs || {};
  var waitingIds = o.waitingIds || {};
  var byMonth = {};
  var rest = [];
  (Array.isArray(tasks) ? tasks : []).forEach(function (t, i) {
    if (!t) return;
    var row = t.template_id ? TK_closeOrderRowOf(refs[t.template_id]) : null;
    var period = t.period_kind === "month" && t.period_start ? String(t.period_start).slice(0, 7) + "-01" : "";
    if (!row || !TK__coMonthName(period)) {
      rest.push(t);
      return;
    }
    (byMonth[period] = byMonth[period] || []).push({ t: t, row: row, i: i });
  });
  var pills = {};
  var groups = Object.keys(byMonth).sort().map(function (period) {
    var list = byMonth[period].sort(function (a, b) {
      return a.row - b.row || a.i - b.i;
    }).map(function (x) { return x.t; });
    var nextSet = false;
    list.forEach(function (t) {
      var st = TK__coStatus(t);
      if (st === "done") return;
      if (st === "waiting_client" || waitingIds[t.id]) {
        pills[t.id] = "waiting";
        return;
      }
      if (!nextSet) {
        pills[t.id] = "next";
        nextSet = true;
      }
    });
    return { key: "close:" + period, name: TK__coMonthName(period) + " close", close: true, tasks: list };
  });
  return { groups: groups, rest: rest, pills: pills };
}

// { task_id: true } for open client requests that belong to a task.
function TK_closeOrderWaitingIds(requests) {
  var out = {};
  (Array.isArray(requests) ? requests : []).forEach(function (r) {
    if (r && r.status === "open" && r.task_id) out[r.task_id] = true;
  });
  return out;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    TK_CLOSE_ORDER_KEY: TK_CLOSE_ORDER_KEY,
    TK_closeOrderKey: TK_closeOrderKey,
    TK_closeOrderRowOf: TK_closeOrderRowOf,
    TK_closeOrderChoice: TK_closeOrderChoice,
    TK_closeOrderSave: TK_closeOrderSave,
    TK_closeOrderGroups: TK_closeOrderGroups,
    TK_closeOrderWaitingIds: TK_closeOrderWaitingIds,
  };
}
