// ----------------------------------------------------------------------------
// TK_store: the one app-wide Tasks store (Phase 1 spec C5).
//
// Pure: no React, no DOM, no Supabase. Loads right after TK_logic.js, so later
// TK files may use it at their top level. Tested with plain node:
//   node components/tasks/TK_store.test.js
//
// State:
//   schema   "unknown" | "ok" | "missing"   (TK_api.probe sets it)
//   online   navigator online flag           (TK_sync sets it)
//   me       the signed-in staff email, lowercased ({type:"me"})
//   drawerId the task open in TK_DrawerHost, or null ({type:"drawer"})
//   deskTaskId the task showing in the Desk's task view (R2), or null
//            ({type:"deskTask"}); drawerId stays the modal's only
//   tasks    { [id]: Task }  every task this window has seen
//   lists    { [listKey]: { ids, loading, error, at } }
//   pending  { [opId]: { id, patch, prev, seq } }  optimistic edits in flight
//   staff, projects   arrays once loaded, else null
//
// Upsert rule (11.4): keep the newer copy. updated_at is compared as the
// exact string the server sent (never through Date, which drops
// microseconds). Fields under a pending optimistic op keep their patched
// values until that op commits or rolls back.
// ----------------------------------------------------------------------------

function TK_initialState() {
  return {
    schema: "unknown",
    online: true,
    me: null,
    drawerId: null,
    deskTaskId: null,
    tasks: {},
    lists: {},
    pending: {},
    staff: null,
    projects: null,
  };
}

// "mine", "review" (everything in review), "subtasks" (every subtask the
// viewer can see, for the inline expand on task rows), "client:<id>", "clientcd:<id>" (the client tasks panel's own copy of
// a client's list), "project:<uuid>", "person:<staff uuid>",
// "children:<uuid>". Accepts a ready key string, or a scope object
// { mine } | { clientId } | { projectId } | { personId } | { parentId }.
// Never builds a key from an email.
function TK_listKey(scope) {
  if (scope == null) return null;
  if (typeof scope === "string") return scope || null;
  if (scope.mine) return "mine";
  if (scope.clientId != null && scope.clientId !== "") return "client:" + String(scope.clientId);
  if (scope.projectId) return "project:" + String(scope.projectId);
  if (scope.personId) return "person:" + String(scope.personId);
  if (scope.staffId) return "person:" + String(scope.staffId);
  if (scope.parentId) return "children:" + String(scope.parentId);
  return null;
}

// ---- Helpers (file-private by name: TK_st*) --------------------------------

function TK_stLogic(name) {
  // TK_logic.js loads first in the browser; in node the test may not have
  // loaded it, so try require, then fall back to the small local rule.
  try {
    if (name === "TK_isMine" && typeof TK_isMine === "function") return TK_isMine;
  } catch (e) {}
  if (typeof require === "function") {
    try {
      var m = require("./TK_logic.js");
      if (m && typeof m[name] === "function") return m[name];
    } catch (e) {}
  }
  return null;
}

function TK_stIsMine(task, email) {
  var f = TK_stLogic("TK_isMine");
  if (f) return f(task, email);
  if (!task || !email) return false;
  // S8b: the assignee only; an Unassigned task (null) is nobody's.
  return String(task.assignee_email || "").toLowerCase() === String(email).toLowerCase();
}

// An open task with nobody on it (S8b). The "mine" list also carries these
// (api.listMine fetches them), so a claim or a new one lands in place.
function TK_stIsOpenUnassigned(task) {
  return !!task && !task.deleted_at && !task.assignee_email && task.status !== "done" && !task.done;
}

// Canonical form of a Postgres / PostgREST / Realtime timestamp string, so two
// spellings of the same instant compare equal: "T" separator, fraction padded
// to 6 digits, "+00", "+00:00" and "Z" all become "Z". Pure string work; no
// Date. Returns null for an empty value.
function TK_stCanonStamp(s) {
  if (s == null || s === "") return null;
  var str = String(s).trim();
  var m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d+))?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i.exec(str);
  if (!m) return str;
  var frac = (m[3] || "").slice(0, 6);
  while (frac.length < 6) frac += "0";
  var tz = (m[4] || "Z").toUpperCase();
  if (tz !== "Z") {
    var t = /^([+-])(\d{2}):?(\d{2})?$/.exec(tz);
    var hh = t ? t[2] : "00";
    var mm = t && t[3] ? t[3] : "00";
    tz = hh === "00" && mm === "00" ? "Z" : t[1] + hh + ":" + mm;
  }
  return m[1] + "T" + m[2] + "." + frac + tz;
}

// -1 / 0 / 1, or null when either side is missing. Both sides in UTC (the
// only form the server sends) compare as plain strings after canonicalizing.
function TK_stCmpStamp(a, b) {
  var ca = TK_stCanonStamp(a);
  var cb = TK_stCanonStamp(b);
  if (ca == null || cb == null) return null;
  if (ca === cb) return 0;
  return ca < cb ? -1 : 1;
}

function TK_stShallowEqual(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  var ka = Object.keys(a);
  var kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (var i = 0; i < ka.length; i++) {
    var k = ka[i];
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    var va = a[k];
    var vb = b[k];
    if (va === vb) continue;
    if (Array.isArray(va) && Array.isArray(vb) && va.length === vb.length && va.every(function (x, j) { return x === vb[j]; })) continue;
    return false;
  }
  return true;
}

function TK_stAssign(base, extra) {
  var out = {};
  var k;
  for (k in base) if (Object.prototype.hasOwnProperty.call(base, k)) out[k] = base[k];
  for (k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) out[k] = extra[k];
  return out;
}

function TK_stWithout(obj, key) {
  var out = {};
  for (var k in obj) if (Object.prototype.hasOwnProperty.call(obj, k) && k !== key) out[k] = obj[k];
  return out;
}

// Pending ops for one task, oldest first.
function TK_stOpsFor(pending, id) {
  var out = [];
  for (var opId in pending) {
    if (Object.prototype.hasOwnProperty.call(pending, opId) && pending[opId].id === id) {
      out.push({ opId: opId, op: pending[opId] });
    }
  }
  out.sort(function (a, b) { return a.op.seq - b.op.seq; });
  return out;
}

// Does `task` belong in list `key`? true / false, or null when it cannot be
// told (unknown key shape, "me" or staff not known yet): membership is then
// left as the last load set it.
function TK_stMatches(state, key, task) {
  if (!task || task.deleted_at) return false;
  if (key === "mine") return state.me ? TK_stIsMine(task, state.me) || TK_stIsOpenUnassigned(task) : null;
  if (key === "review") return task.status === "ready_for_review"; // the review queue (tasks p2 s3)
  if (key === "subtasks") return task.parent_id != null && task.parent_id !== ""; // every subtask I can see (inline subtasks, tasks p3)
  var i = key.indexOf(":");
  if (i < 0) return null;
  var kind = key.slice(0, i);
  var val = key.slice(i + 1);
  // "clientcd" is the client tasks panel and strip's own list of the same
  // client (TK_ClientDrawer.jsx), so its filters never touch the full list.
  if (kind === "client" || kind === "clientcd") return task.client_id != null && String(task.client_id) === val;
  // "wb:client:<id>" is the Workbench hub's Client tab (WB_HubClient.jsx): the
  // same client's tasks under the hub's own key. Other "wb:" keys stay null.
  if (kind === "wb" && val.indexOf("client:") === 0) return task.client_id != null && String(task.client_id) === val.slice(7);
  if (kind === "project") return task.project_id != null && String(task.project_id) === val;
  if (kind === "children") return task.parent_id != null && String(task.parent_id) === val;
  if (kind === "person") {
    var staff = state.staff || [];
    for (var s = 0; s < staff.length; s++) {
      if (staff[s] && String(staff[s].id) === val) return TK_stIsMine(task, staff[s].email);
    }
    return null;
  }
  return null;
}

// Re-place one task in every known list. Returns the same lists object when
// nothing moved.
function TK_stPlace(state, lists, task) {
  var changed = false;
  var next = {};
  for (var key in lists) {
    if (!Object.prototype.hasOwnProperty.call(lists, key)) continue;
    var L = lists[key];
    var has = L.ids.indexOf(task.id) >= 0;
    var match = TK_stMatches(state, key, task);
    if (task.deleted_at) match = false;
    if (match === true && !has) {
      next[key] = TK_stAssign(L, { ids: L.ids.concat([task.id]) });
      changed = true;
    } else if (match === false && has) {
      next[key] = TK_stAssign(L, { ids: L.ids.filter(function (x) { return x !== task.id; }) });
      changed = true;
    } else {
      next[key] = L;
    }
  }
  return changed ? next : lists;
}

// The upsert rule, shared by upsert, listLoaded and commit. Returns
// { state, task } where task is the stored copy after the rule.
function TK_stUpsert(state, incoming) {
  if (!incoming || incoming.id == null) return { state: state, task: null };
  var id = incoming.id;
  var cached = state.tasks[id];
  var take;
  if (!cached || !cached.updated_at) take = true;
  else {
    var c = TK_stCmpStamp(incoming.updated_at, cached.updated_at);
    take = c != null && c >= 0;
  }
  if (!take) return { state: state, task: cached };

  var pending = state.pending;
  var ops = TK_stOpsFor(pending, id);
  var stored = incoming;
  if (ops.length) {
    // The newest server value becomes the rollback base of the oldest op on
    // each field; the field shows the newest op's patched value.
    var nextPending = TK_stAssign(pending, {});
    var overlay = {};
    var baseSet = {};
    ops.forEach(function (o) {
      var prev = TK_stAssign(o.op.prev, {});
      Object.keys(o.op.patch).forEach(function (f) {
        if (!baseSet[f]) {
          prev[f] = incoming[f] === undefined ? null : incoming[f];
          baseSet[f] = true;
        }
        overlay[f] = o.op.patch[f];
      });
      nextPending[o.opId] = TK_stAssign(o.op, { prev: prev });
    });
    stored = TK_stAssign(incoming, overlay);
    pending = nextPending;
  }

  if (cached && TK_stShallowEqual(cached, stored) && pending === state.pending) {
    return { state: state, task: cached };
  }
  var tasks = TK_stAssign(state.tasks, {});
  tasks[id] = stored;
  var s1 = TK_stAssign(state, { tasks: tasks, pending: pending });
  var lists = TK_stPlace(s1, state.lists, stored);
  if (lists !== state.lists) s1.lists = lists;
  return { state: s1, task: stored };
}

function TK_stEmptyList() {
  return { ids: [], loading: false, error: null, at: null };
}

// ---- Reducer ---------------------------------------------------------------

function TK_reduce(state, action) {
  if (!state) state = TK_initialState();
  if (!action || !action.type) return state;
  var a = action;
  var L, lists, tasks, pending, task, op, next, i;

  switch (a.type) {
    case "schema":
      if (a.value !== "unknown" && a.value !== "ok" && a.value !== "missing") return state;
      return state.schema === a.value ? state : TK_stAssign(state, { schema: a.value });

    case "online":
      return state.online === !!a.value ? state : TK_stAssign(state, { online: !!a.value });

    case "me": {
      var me = a.email ? String(a.email).trim().toLowerCase() : null;
      if (state.me === me) return state;
      // A different person in the same tab: drop everything the last one loaded.
      if (state.me && me) return TK_stAssign(TK_initialState(), { online: state.online, me: me });
      return TK_stAssign(state, { me: me });
    }

    // Sign-out or a user switch (TK_sync.stop): back to empty, keep online.
    case "reset":
      return TK_stAssign(TK_initialState(), { online: state.online });

    case "drawer": {
      var d = a.id == null || a.id === "" ? null : a.id;
      return state.drawerId === d ? state : TK_stAssign(state, { drawerId: d });
    }

    case "deskTask": {
      var dk = a.id == null || a.id === "" ? null : String(a.id);
      return state.deskTaskId === dk ? state : TK_stAssign(state, { deskTaskId: dk });
    }

    case "staff":
      return TK_stAssign(state, { staff: Array.isArray(a.staff) ? a.staff.slice() : [] });

    case "projects":
      return TK_stAssign(state, { projects: Array.isArray(a.projects) ? a.projects.slice() : [] });

    case "listLoading":
      if (!a.key) return state;
      L = state.lists[a.key] || TK_stEmptyList();
      if (L.loading && !L.error) return state;
      lists = TK_stAssign(state.lists, {});
      lists[a.key] = TK_stAssign(L, { loading: true, error: null });
      return TK_stAssign(state, { lists: lists });

    case "listError":
      if (!a.key) return state;
      L = state.lists[a.key] || TK_stEmptyList();
      lists = TK_stAssign(state.lists, {});
      lists[a.key] = TK_stAssign(L, { loading: false, error: a.error == null ? "error" : String(a.error) });
      return TK_stAssign(state, { lists: lists });

    case "listLoaded": {
      if (!a.key) return state;
      next = state;
      var rows = Array.isArray(a.tasks) ? a.tasks : [];
      for (i = 0; i < rows.length; i++) next = TK_stUpsert(next, rows[i]).state;
      // Ids in the order the server returned them, minus rows whose stored
      // (newest) copy is deleted or no longer matches the list.
      var seen = {};
      var ids = [];
      for (i = 0; i < rows.length; i++) {
        var rid = rows[i] && rows[i].id;
        if (rid == null || seen[rid]) continue;
        seen[rid] = true;
        var st = next.tasks[rid];
        if (!st || st.deleted_at) continue;
        if (TK_stMatches(next, a.key, st) === false) continue;
        ids.push(rid);
      }
      lists = TK_stAssign(next.lists, {});
      lists[a.key] = { ids: ids, loading: false, error: null, at: a.at == null ? Date.now() : a.at };
      return TK_stAssign(next, { lists: lists });
    }

    case "upsert":
      return TK_stUpsert(state, a.task).state;

    case "remove": {
      if (a.id == null) return state;
      var inTasks = Object.prototype.hasOwnProperty.call(state.tasks, a.id);
      tasks = inTasks ? TK_stWithout(state.tasks, a.id) : state.tasks;
      var listsChanged = false;
      lists = {};
      for (var k in state.lists) {
        if (!Object.prototype.hasOwnProperty.call(state.lists, k)) continue;
        L = state.lists[k];
        if (L.ids.indexOf(a.id) >= 0) {
          lists[k] = TK_stAssign(L, { ids: L.ids.filter(function (x) { return x !== a.id; }) });
          listsChanged = true;
        } else lists[k] = L;
      }
      pending = state.pending;
      TK_stOpsFor(pending, a.id).forEach(function (o) { pending = TK_stWithout(pending, o.opId); });
      if (!inTasks && !listsChanged && pending === state.pending) return state;
      return TK_stAssign(state, { tasks: tasks, lists: listsChanged ? lists : state.lists, pending: pending });
    }

    case "optimistic": {
      if (a.id == null || !a.opId || !a.patch) return state;
      task = state.tasks[a.id];
      if (!task) return state;
      var prev = {};
      Object.keys(a.patch).forEach(function (f) { prev[f] = task[f] === undefined ? null : task[f]; });
      var seq = 1;
      for (var p in state.pending) {
        if (Object.prototype.hasOwnProperty.call(state.pending, p) && state.pending[p].seq >= seq) seq = state.pending[p].seq + 1;
      }
      pending = TK_stAssign(state.pending, {});
      pending[a.opId] = { id: a.id, patch: TK_stAssign(a.patch, {}), prev: prev, seq: seq };
      var patched = TK_stAssign(task, a.patch);
      tasks = TK_stAssign(state.tasks, {});
      tasks[a.id] = patched;
      next = TK_stAssign(state, { tasks: tasks, pending: pending });
      lists = TK_stPlace(next, state.lists, patched);
      if (lists !== state.lists) next.lists = lists;
      return next;
    }

    case "rollback": {
      op = a.opId && state.pending[a.opId];
      if (!op) return state;
      pending = TK_stWithout(state.pending, a.opId);
      task = state.tasks[op.id];
      if (!task) return TK_stAssign(state, { pending: pending });
      var restore = {};
      var later = TK_stOpsFor(pending, op.id).filter(function (o) { return o.op.seq > op.seq; });
      Object.keys(op.patch).forEach(function (f) {
        // A later op on the same field still shows its value; it inherits
        // this op's base so its own rollback lands on the server value.
        var heir = null;
        for (var j = 0; j < later.length; j++) {
          if (Object.prototype.hasOwnProperty.call(later[j].op.patch, f)) { heir = later[j]; break; }
        }
        if (heir) {
          var hp = TK_stAssign(pending[heir.opId].prev, {});
          hp[f] = op.prev[f];
          pending[heir.opId] = TK_stAssign(pending[heir.opId], { prev: hp });
        } else {
          restore[f] = op.prev[f];
        }
      });
      var rolled = TK_stAssign(task, restore);
      tasks = TK_stAssign(state.tasks, {});
      tasks[op.id] = rolled;
      next = TK_stAssign(state, { tasks: tasks, pending: pending });
      lists = TK_stPlace(next, state.lists, rolled);
      if (lists !== state.lists) next.lists = lists;
      return next;
    }

    case "commit": {
      op = a.opId && state.pending[a.opId];
      next = op ? TK_stAssign(state, { pending: TK_stWithout(state.pending, a.opId) }) : state;
      // Drop the op first, so the server row's values win over the patch
      // (a field the trigger reverted shows the reverted value).
      if (a.task) next = TK_stUpsert(next, a.task).state;
      return next;
    }

    default:
      return state;
  }
}

// ---- Selectors -------------------------------------------------------------

// Stable result: the same object back while the list entry and each of its
// task objects are unchanged, so React.useSyncExternalStore never loops.
var TK_stSelectCache = {};

function TK_selectList(state, key) {
  var L = key && state && state.lists ? state.lists[key] : null;
  if (!L) {
    var empty = TK_stSelectCache["\u0000empty"];
    if (!empty) empty = TK_stSelectCache["\u0000empty"] = { tasks: [], loading: false, error: null, at: null };
    return empty;
  }
  var tasks = [];
  for (var i = 0; i < L.ids.length; i++) {
    var t = state.tasks[L.ids[i]];
    if (t) tasks.push(t);
  }
  var prev = TK_stSelectCache[key];
  if (
    prev &&
    prev.loading === !!L.loading &&
    prev.error === (L.error || null) &&
    prev.at === (L.at == null ? null : L.at) &&
    prev.tasks.length === tasks.length &&
    prev.tasks.every(function (x, j) { return x === tasks[j]; })
  ) {
    return prev;
  }
  var out = { tasks: tasks, loading: !!L.loading, error: L.error || null, at: L.at == null ? null : L.at };
  TK_stSelectCache[key] = out;
  return out;
}

// ---- Store -----------------------------------------------------------------

function TK_createStore(reducer, init) {
  var reduce = typeof reducer === "function" ? reducer : TK_reduce;
  var state = init || TK_initialState();
  var listeners = [];
  return {
    getState: function () {
      return state;
    },
    dispatch: function (action) {
      var next = reduce(state, action);
      if (next === state) return action;
      state = next;
      listeners.slice().forEach(function (fn) {
        try {
          fn(state, action);
        } catch (e) {
          if (typeof console !== "undefined") console.error("[TK]", e);
        }
      });
      return action;
    },
    subscribe: function (fn) {
      listeners.push(fn);
      return function () {
        var i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
  };
}

var TK_store = TK_createStore();

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    TK_initialState: TK_initialState,
    TK_listKey: TK_listKey,
    TK_reduce: TK_reduce,
    TK_selectList: TK_selectList,
    TK_createStore: TK_createStore,
    TK_store: TK_store,
    TK_stCanonStamp: TK_stCanonStamp,
    TK_stCmpStamp: TK_stCmpStamp,
  };
}
