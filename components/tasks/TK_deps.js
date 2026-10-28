// ----------------------------------------------------------------------------
// TK_deps: Slate plus task dependencies ("Blocked by"), hidden preview.
// Spec: docs/slateplus-dependencies-spec.md. Data: supabase/slateplus-deps.sql.
//
// Gate: TKP_on() (components/tasks/TK_slatePlus.js). While it is false every
// runtime helper here answers "nothing" (null / false / the input unchanged)
// and makes no network call, so callers behave exactly as before.
//
// Pure rules (node tests in TK_deps.test.js):
//   TKD_index(rows)                      tk_dep_list rows -> { byTask, byBlocker }
//   TKD_openBlockers(id, idx, tasks)     unfinished, not overridden blockers
//   TKD_isBlockedTask(task, idx, tasks)  open task with an unfinished blocker
//   TKD_wouldCycle(task, blocker, idx)   self or a loop (quick browser check)
//   TKD_blockedText(list)                "Blocked by 2 unfinished tasks: A, B. ..."
//   TKD_movesBlocked(status)             done / in_progress / ready_for_review
//   TKD_splitBulk(ids, kind, patch, fn)  bulk ids minus the blocked ones
//
// Runtime (browser): TKD_load, TKD_ready, TKD_blockersOf, TKD_isBlocked,
// TKD_groupOpt, TKD_skipBlocked, TKD_precheck, TKD_useDeps.
// Plain JS (no JSX). Uses TK_api, TK_store, React at call time only.
// ----------------------------------------------------------------------------

var TKD_EVENT = "mgb:tkdeps";
var TKD_MOVES = { done: 1, in_progress: 1, ready_for_review: 1 };
var TKD_MASKED = "a task you can't see";

function TKD__lc(v) {
  return v == null ? "" : String(v).trim().toLowerCase();
}

// The server masks the side the caller cannot read (null id, text and flags;
// only is_open is given for a hidden blocker). Such a row is filed under the
// side that is known, with a local key ("hidden:N") standing in for the
// hidden id. Rows with neither id are dropped.
function TKD_index(rows) {
  var byTask = {};
  var byBlocker = {};
  var n = 0;
  (Array.isArray(rows) ? rows : []).forEach(function (r) {
    if (!r || (!r.task_id && !r.blocker_id)) return;
    if (!r.task_id || !r.blocker_id) {
      n += 1;
      r = Object.assign({}, r, { _hidden: "hidden:" + n });
    }
    if (r.task_id) {
      var t = String(r.task_id);
      (byTask[t] = byTask[t] || []).push(r);
    }
    if (r.blocker_id) {
      var b = String(r.blocker_id);
      (byBlocker[b] = byBlocker[b] || []).push(r);
    }
  });
  return { byTask: byTask, byBlocker: byBlocker };
}

function TKD__bid(r) {
  return r.blocker_id ? String(r.blocker_id) : r._hidden || "hidden";
}
function TKD__tid(r) {
  return r.task_id ? String(r.task_id) : r._hidden || "hidden";
}

function TKD__taskDone(t) {
  if (!t) return false;
  return t.done === true || t.status === "done";
}

// A blocker still holds its task up when the dep is not overridden and the
// blocker is neither done nor in the trash. A fresher copy of the blocker in
// the store (tasks[id]) wins over the row's snapshot.
function TKD__rowOpen(row, tasks) {
  if (!row || row.overridden_at) return false;
  var b = tasks && row.blocker_id ? tasks[String(row.blocker_id)] : null;
  if (b) return !b.deleted_at && !TKD__taskDone(b);
  if (typeof row.is_open === "boolean") return row.is_open;
  return !row.blocker_done && !row.blocker_deleted;
}

function TKD_openBlockers(taskId, idx, tasks) {
  if (taskId == null || !idx || !idx.byTask) return [];
  var rows = idx.byTask[String(taskId)] || [];
  var out = [];
  rows.forEach(function (r) {
    if (!TKD__rowOpen(r, tasks)) return;
    var b = tasks && r.blocker_id ? tasks[String(r.blocker_id)] : null;
    var readable = r.blocker_readable !== false && !!r.blocker_id;
    out.push({
      id: TKD__bid(r),
      hidden: !r.blocker_id,
      text: readable ? (b && b.text) || r.blocker_text || "" : "",
      readable: readable,
      client_id: readable ? (b ? b.client_id : r.blocker_client_id) || null : null,
      status: readable ? (b ? b.status : r.blocker_status) || null : null,
      assignee: readable ? TKD__lc(b ? b.assignee_email : r.blocker_assignee) : "",
      due_date: readable ? (b ? b.due_date : r.blocker_due_date) || null : null,
      source: r.source || "manual",
    });
  });
  return out;
}

// Every blocker row for the task, done ones too (the drawer lists them all).
function TKD_allBlockers(taskId, idx, tasks) {
  if (taskId == null || !idx || !idx.byTask) return [];
  return (idx.byTask[String(taskId)] || []).map(function (r) {
    var b = tasks && r.blocker_id ? tasks[String(r.blocker_id)] : null;
    var readable = r.blocker_readable !== false && !!r.blocker_id;
    return {
      id: TKD__bid(r),
      hidden: !r.blocker_id,
      text: readable ? (b && b.text) || r.blocker_text || "" : "",
      readable: readable,
      client_id: readable ? (b ? b.client_id : r.blocker_client_id) || null : null,
      open: TKD__rowOpen(r, tasks),
      done: b ? TKD__taskDone(b) : !!r.blocker_done,
      deleted: b ? !!b.deleted_at : !!r.blocker_deleted,
      overridden: !!r.overridden_at,
      source: r.source || "manual",
    };
  });
}

// Tasks this one holds up.
function TKD_blocking(taskId, idx) {
  if (taskId == null || !idx || !idx.byBlocker) return [];
  return (idx.byBlocker[String(taskId)] || []).map(function (r) {
    var readable = r.task_readable !== false && !!r.task_id;
    return {
      id: TKD__tid(r),
      hidden: !r.task_id,
      text: readable ? r.task_text || "" : "",
      readable: readable,
      client_id: readable ? r.task_client_id || null : null,
      done: !!r.task_done,
      deleted: !!r.task_deleted,
    };
  });
}

function TKD_isBlockedTask(task, idx, tasks) {
  if (!task || task.id == null || task.deleted_at || TKD__taskDone(task)) return false;
  return TKD_openBlockers(task.id, idx, tasks).length > 0;
}

// Would "taskId is blocked by blockerId" make a loop? True for a self-block or
// when blockerId already waits (directly or not) on taskId. Each id is walked
// once (seen set), so any graph ends; no depth cap. The server checks again
// under a lock; this only gives a quick message. Hidden blockers are skipped.
function TKD_wouldCycle(taskId, blockerId, idx) {
  if (taskId == null || blockerId == null) return false;
  var target = String(taskId);
  if (String(blockerId) === target) return true;
  var byTask = (idx && idx.byTask) || {};
  var seen = {};
  var stack = [String(blockerId)];
  while (stack.length) {
    var cur = stack.pop();
    if (seen[cur]) continue;
    seen[cur] = true;
    var rows = byTask[cur] || [];
    for (var i = 0; i < rows.length; i++) {
      if (!rows[i].blocker_id) continue;
      var next = String(rows[i].blocker_id);
      if (next === target) return true;
      if (!seen[next]) stack.push(next);
    }
  }
  return false;
}

function TKD_chipText(n) {
  return "Blocked by " + n;
}

function TKD__name(b) {
  if (!b || !b.readable) return TKD_MASKED;
  var t = String(b.text || "").replace(/\s+/g, " ").trim();
  if (t.length > 60) t = t.slice(0, 57) + "...";
  return t || "Untitled task";
}

// The message for a refused start or finish. Never more than three names.
function TKD_blockedText(list) {
  var l = Array.isArray(list) ? list : [];
  var n = l.length;
  if (!n) return "";
  var names = l.slice(0, 3).map(TKD__name);
  var more = n > 3 ? " and " + (n - 3) + " more" : "";
  return "Blocked by " + n + " unfinished task" + (n === 1 ? "" : "s") + ": " + names.join(", ") + more + ". Finish " + (n === 1 ? "that" : "those") + " first.";
}

// The hover text on the row chip.
function TKD_chipTitle(list) {
  var l = Array.isArray(list) ? list : [];
  if (!l.length) return "";
  return "Waiting on: " + l.slice(0, 5).map(TKD__name).join("; ") + (l.length > 5 ? "; and " + (l.length - 5) + " more" : "");
}

function TKD_movesBlocked(status) {
  return Object.prototype.hasOwnProperty.call(TKD_MOVES, String(status || ""));
}

// Bulk: which ids go to the server and which are skipped as blocked.
// kind complete, or set_status to a status a blocked task can't move to.
function TKD_splitBulk(ids, kind, patch, isBlocked) {
  var list = Array.isArray(ids) ? ids : [];
  var applies = kind === "complete" || (kind === "set_status" && patch && TKD_movesBlocked(patch.status));
  if (!applies || typeof isBlocked !== "function") return { keep: list.slice(), skipped: [] };
  var keep = [];
  var skipped = [];
  list.forEach(function (id) {
    if (isBlocked(id)) skipped.push({ id: id, reason: "blocked" });
    else keep.push(id);
  });
  return { keep: keep, skipped: skipped };
}

// ---- Runtime (browser only) --------------------------------------------------

var TKD__s = { idx: TKD_index([]), loaded: false, loading: null, again: null, at: 0, ver: 0, fails: 0 };
var TKD__FRESH_MS = 60000;

function TKD_on() {
  try {
    return typeof TKP_on === "function" && TKP_on() === true;
  } catch (e) {
    return false;
  }
}

function TKD__emit() {
  TKD__s.ver += 1;
  try {
    window.dispatchEvent(new Event(TKD_EVENT));
  } catch (e) {}
}

// Loads every dep the person can see (tk_dep_list, max 2000). One call in
// flight; fresh for a minute unless forced. Gate off: nothing.
function TKD_load(force) {
  if (!TKD_on()) return Promise.resolve(null);
  if (typeof TK_api === "undefined" || !TK_api || typeof TK_api.depList !== "function") return Promise.resolve(null);
  // A forced load while one is in flight runs again after it (the change
  // that asked for it may be newer than that request).
  if (TKD__s.loading) {
    if (!force) return TKD__s.loading;
    if (!TKD__s.again) {
      TKD__s.again = TKD__s.loading.then(function () {
        TKD__s.again = null;
        return TKD_load(true);
      });
    }
    return TKD__s.again;
  }
  if (!force && TKD__s.loaded && Date.now() - TKD__s.at < TKD__FRESH_MS) return Promise.resolve(TKD__s.idx);
  if (!force && TKD__s.fails >= 3 && Date.now() - TKD__s.at < 5 * TKD__FRESH_MS) return Promise.resolve(null);
  var p = TK_api.depList(null).then(
    function (rows) {
      TKD__s.idx = TKD_index(rows);
      TKD__s.loaded = true;
      TKD__s.fails = 0;
      TKD__s.at = Date.now();
      TKD__s.loading = null;
      TKD__emit();
      return TKD__s.idx;
    },
    function () {
      TKD__s.fails += 1;
      TKD__s.at = Date.now();
      TKD__s.loading = null;
      return null;
    },
  );
  TKD__s.loading = p;
  return p;
}

function TKD_ready() {
  return TKD__s.loaded && TKD_on();
}

function TKD__tasks() {
  try {
    var st = typeof TK_store !== "undefined" && TK_store ? TK_store.getState() : null;
    return (st && st.tasks) || {};
  } catch (e) {
    return {};
  }
}

// What the drawer reads: the loaded index and the store's tasks.
function TKD_snapshot() {
  return { idx: TKD__s.idx, tasks: TKD__tasks(), loaded: TKD_ready() };
}

// Unfinished blockers of a task, or null while off / not loaded yet.
function TKD_blockersOf(task) {
  if (!task || task.id == null || !TKD_ready()) return null;
  if (task.deleted_at || TKD__taskDone(task)) return [];
  return TKD_openBlockers(task.id, TKD__s.idx, TKD__tasks());
}

function TKD_isBlocked(task) {
  var l = TKD_blockersOf(task);
  return !!(l && l.length);
}

// For lists that only have an id (Desk rows): the store copy when there is
// one, else the dep rows alone.
function TKD_isBlockedId(id) {
  if (id == null || !TKD_ready()) return false;
  var tasks = TKD__tasks();
  var t = tasks[String(id)];
  if (t) return TKD_isBlockedTask(t, TKD__s.idx, tasks);
  return TKD_openBlockers(id, TKD__s.idx, tasks).length > 0;
}

// TK_groupMyTasks opts.isBlocked: a function while on and loaded, else
// undefined (the groups are then built exactly as before).
function TKD_groupOpt() {
  if (!TKD_ready()) return undefined;
  var idx = TKD__s.idx;
  var tasks = TKD__tasks();
  return function (t) {
    return TKD_isBlockedTask(t, idx, tasks);
  };
}

// "Do next" picks: the list without blocked items. Off: the same array.
function TKD_skipBlocked(list, idOf) {
  if (!Array.isArray(list) || !TKD_ready()) return list;
  var get = typeof idOf === "function" ? idOf : function (x) { return x && x.id; };
  return list.filter(function (x) {
    return !TKD_isBlockedId(get(x));
  });
}

function TKD__toast(text, action) {
  if (!text) return;
  try {
    if (typeof TK_vToast === "function") {
      TK_vToast(text, action);
      return;
    }
    window.dispatchEvent(new CustomEvent("mgb:toast", { detail: { text: text, action: action || null } }));
  } catch (e) {}
}

function TKD__meIsAdmin() {
  try {
    var st = typeof TK_store !== "undefined" && TK_store ? TK_store.getState() : null;
    var me = TKD__lc(st && st.me);
    var list = st && Array.isArray(st.staff) ? st.staff : [];
    for (var i = 0; i < list.length; i++) if (list[i] && TKD__lc(list[i].email) === me) return list[i].role === "admin";
  } catch (e) {}
  return false;
}

// Admin override: asks for a reason, then stamps the open deps (logged).
function TKD_overridePrompt(task) {
  if (!task || typeof TK_api === "undefined" || !TK_api || typeof TK_api.depOverride !== "function") return Promise.resolve(null);
  var title = String(task.text || "this task").replace(/\s+/g, " ").slice(0, 60);
  var r = null;
  try {
    r = window.prompt('Override the block on "' + title + '"? It is logged. Reason (at least 3 characters):', "");
  } catch (e) {
    r = null;
  }
  if (r == null) return Promise.resolve(null);
  r = String(r).trim();
  if (r.length < 3) {
    TKD__toast("Not overridden. Give a reason of at least 3 characters.");
    return Promise.resolve(null);
  }
  return TK_api.depOverride(task.id, r.slice(0, 500)).then(
    function (res) {
      return TKD_load(true).then(function () {
        TKD__toast("Block overridden. You can start or finish it now.");
        return res;
      });
    },
    function (e) {
      TKD__toast(typeof TK_vErrText === "function" ? TK_vErrText(e) : "Couldn't override that. Try again.");
      return null;
    },
  );
}

// Before a start, send for review or finish: true when it stopped the action
// (and toasted why). Off, not loaded, or not blocked: false, nothing shown.
function TKD_precheck(task, toStatus, isAdmin) {
  if (!task || !TKD_movesBlocked(toStatus)) return false;
  // Back from review is a resume (the server allows it too). Back from waiting
  // on the client is a resume only when it was in progress before the wait;
  // the browser does not load status_before_wait, so it lets the server decide
  // (a refusal comes back as "This task is waiting on another task to finish.").
  if (toStatus === "in_progress" && (task.status === "ready_for_review" || task.status === "waiting_client")) return false;
  var list = TKD_blockersOf(task);
  if (!list || !list.length) return false;
  var admin = typeof isAdmin === "boolean" ? isAdmin : TKD__meIsAdmin();
  TKD__toast(
    TKD_blockedText(list),
    admin
      ? {
          label: "Override",
          onClick: function () {
            TKD_overridePrompt(task);
          },
        }
      : null,
  );
  return true;
}

// The hook: `var depsVer = TKD_useDeps();` Re-renders when deps load or the
// gate changes; starts a load while on. Refreshes on window focus (at most
// once a minute). Off: no network, returns 0.
function TKD_useDeps() {
  var on = typeof TKP_useOn === "function" ? TKP_useOn() : false;
  var s = React.useState(0);
  var bump = s[1];
  React.useEffect(
    function () {
      if (!on) return undefined;
      var hit = function () {
        bump(function (n) {
          return n + 1;
        });
      };
      var onFocus = function () {
        TKD_load(false);
      };
      window.addEventListener(TKD_EVENT, hit);
      window.addEventListener("focus", onFocus);
      TKD_load(false);
      return function () {
        window.removeEventListener(TKD_EVENT, hit);
        window.removeEventListener("focus", onFocus);
      };
    },
    [on],
  );
  return on ? TKD__s.ver : 0;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    TKD_EVENT: TKD_EVENT,
    TKD_index: TKD_index,
    TKD_openBlockers: TKD_openBlockers,
    TKD_allBlockers: TKD_allBlockers,
    TKD_blocking: TKD_blocking,
    TKD_isBlockedTask: TKD_isBlockedTask,
    TKD_wouldCycle: TKD_wouldCycle,
    TKD_chipText: TKD_chipText,
    TKD_chipTitle: TKD_chipTitle,
    TKD_blockedText: TKD_blockedText,
    TKD_movesBlocked: TKD_movesBlocked,
    TKD_splitBulk: TKD_splitBulk,
    TKD_on: TKD_on,
    TKD_ready: TKD_ready,
    TKD_blockersOf: TKD_blockersOf,
    TKD_isBlocked: TKD_isBlocked,
    TKD_isBlockedId: TKD_isBlockedId,
    TKD_groupOpt: TKD_groupOpt,
    TKD_skipBlocked: TKD_skipBlocked,
    TKD_precheck: TKD_precheck,
    TKD_load: TKD_load,
    TKD_snapshot: TKD_snapshot,
  };
}
