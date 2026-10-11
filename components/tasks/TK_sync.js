// ----------------------------------------------------------------------------
// TK_sync: keeps every window's TK_store current (Phase 1 spec C5, row 11.4),
// plus the React hooks over TK_store.
//
// Sources of change, one at a time:
//   * Supabase Realtime, private channel "tk-tasks-<tabId>" (staff_reminders)
//     and "tk-core-<tabId>" (comments, activity, followers, attachments,
//     checklist items). Opened only once the schema is "ok". Channel names
//     carry the random tabId, never an email.
//   * BroadcastChannel "mgb-tasks": same-browser windows, for our own writes.
//   * Fallback while "tk-tasks-<tabId>" is not SUBSCRIBED: the legacy
//     "mgb:staff-items-changed" event refetches loaded lists, debounced
//     400 ms, never within 1 s of markOwnWrite(). While the channel is joined
//     that event is ignored, so one edit never causes a TK refetch.
//
// A DELETE payload skips RLS (D14), so it is only a hint: it acts only for a
// task that is already in TK_store, and nothing else is read from it.
//
// Browser file; loads after TK_store.js and TK_api.js. React, TK_api and
// window.mgbSupabase are used at call time only.
// ----------------------------------------------------------------------------

var TK_sync = (function () {
  var CHILD_TABLES = ["tk_comments", "tk_activity", "tk_followers", "tk_attachments", "task_checklist_items"];
  var LEGACY_EVENT = "mgb:staff-items-changed";
  var CHECKLIST_EVENT = "mgb:task-checklists-changed"; // TCL_EVENT in TaskChecklist.jsx
  var COALESCE_MS = 250;
  var FALLBACK_MS = 400;
  var OWN_WRITE_MS = 1000;

  function makeTabId() {
    try {
      if (typeof crypto !== "undefined" && crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
    } catch (e) {}
    return "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  var sync = { tabId: makeTabId() };
  var st = {
    started: false,
    email: null,
    bc: null,
    chTasks: null,
    chCore: null,
    tasksJoined: false,
    everJoined: false,
    lastOwnWrite: 0,
    fallbackTimer: null,
    coalesce: {}, // task id -> { tables: [], timer }
    handlers: {}, // BroadcastChannel message type -> [fn]
    loaders: {}, // list key -> [reload fn] (TK_useList registers)
    unsubStore: null,
    winHandlers: null,
    sweepTimer: null,
    lastSweep: 0,
  };
  // Realtime only sends rows the viewer can still read, so a task that left
  // your access (reassigned, moved client) never says so. Loaded lists are
  // refetched every few minutes while the tab is visible, and on return.
  var SWEEP_MS = 5 * 60 * 1000;
  var SWEEP_RETURN_MS = 60 * 1000;

  function store() {
    return typeof TK_store !== "undefined" && TK_store ? TK_store : null;
  }

  function dispatch(action) {
    var s = store();
    if (s) s.dispatch(action);
  }

  function db() {
    try {
      if (typeof TK_api !== "undefined" && TK_api && TK_api._client) return TK_api._client;
      return window.mgbSupabase || null;
    } catch (e) {
      return null;
    }
  }

  function inStore(id) {
    var s = store();
    return !!(s && id != null && Object.prototype.hasOwnProperty.call(s.getState().tasks, id));
  }

  function normalize(row) {
    if (typeof TK_api !== "undefined" && TK_api && typeof TK_api.normalize === "function") return TK_api.normalize(row);
    return row;
  }

  function sameStamp(a, b) {
    if (typeof TK_stCmpStamp === "function") return TK_stCmpStamp(a, b) === 0;
    return a != null && a === b;
  }

  function fire(name, detail) {
    try {
      window.dispatchEvent(detail === undefined ? new Event(name) : new CustomEvent(name, { detail: detail }));
    } catch (e) {}
  }

  // ---- Store writes from outside -------------------------------------------

  // Dedupe: a row whose updated_at equals the stored one is our own echo (or
  // a second copy over BroadcastChannel) and changes nothing.
  function applyRow(row) {
    if (!row || row.id == null) return;
    var t = normalize(row);
    var s = store();
    var cached = s && s.getState().tasks[t.id];
    if (cached && cached.updated_at && sameStamp(cached.updated_at, t.updated_at)) return;
    dispatch({ type: "upsert", task: t });
  }

  function onTaskChange(payload) {
    var p = payload || {};
    var ev = String(p.eventType || p.type || "").toUpperCase();
    if (ev === "DELETE") {
      var oldId = p.old && p.old.id;
      if (inStore(oldId)) dispatch({ type: "remove", id: oldId });
      return;
    }
    // A soft-deleted row arrives as an UPDATE with deleted_at set; upsert
    // takes it out of every list and keeps it for an open drawer's banner.
    if (p["new"]) applyRow(p["new"]);
  }

  // ---- Child events, coalesced per task over 250 ms --------------------------

  function queueChild(id, table) {
    if (id == null) return;
    var c = st.coalesce[id];
    if (c) {
      if (c.tables.indexOf(table) < 0) c.tables.push(table);
      return;
    }
    c = st.coalesce[id] = { tables: [table], timer: null };
    c.timer = setTimeout(function () {
      delete st.coalesce[id];
      fire("tk:task-changed", { id: id, table: c.tables[0], tables: c.tables.slice() });
      if (c.tables.indexOf("task_checklist_items") >= 0) {
        var evName = typeof TCL_EVENT !== "undefined" && TCL_EVENT ? TCL_EVENT : CHECKLIST_EVENT;
        fire(evName);
      }
    }, COALESCE_MS);
  }

  function onChildChange(table, payload) {
    var p = payload || {};
    var ev = String(p.eventType || p.type || "").toUpperCase();
    var row = p["new"] && Object.keys(p["new"]).length ? p["new"] : p.old || {};
    var id = row.task_id != null ? row.task_id : row.reminder_id;
    if (id == null) return;
    // DELETE skips RLS: only a refetch hint for a task this window already has.
    if (ev === "DELETE" && !inStore(id)) return;
    queueChild(id, table);
  }

  // ---- Fallback refetch (legacy event while the TK channel is not joined) ----

  function ownWriteRecent() {
    return st.lastOwnWrite && Date.now() - st.lastOwnWrite < OWN_WRITE_MS;
  }

  function refetchLoaded() {
    var s = store();
    var lists = s ? s.getState().lists : {};
    Object.keys(st.loaders).forEach(function (key) {
      var fns = st.loaders[key];
      if (!fns || !fns.length) return;
      if (!lists[key] || lists[key].at == null) return; // only lists already loaded
      try {
        fns[0]();
      } catch (e) {}
    });
  }

  function sweep(minAge) {
    try {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      if (typeof navigator !== "undefined" && navigator && navigator.onLine === false) return;
    } catch (e) {}
    if (Date.now() - st.lastSweep < minAge) return;
    st.lastSweep = Date.now();
    refetchLoaded();
  }

  function onLegacyChanged() {
    if (st.tasksJoined) return;
    if (ownWriteRecent()) return;
    if (st.fallbackTimer) clearTimeout(st.fallbackTimer);
    st.fallbackTimer = setTimeout(function () {
      st.fallbackTimer = null;
      if (st.tasksJoined || ownWriteRecent()) return;
      refetchLoaded();
    }, FALLBACK_MS);
  }

  // ---- Channels --------------------------------------------------------------

  function openChannels() {
    var client = db();
    if (!client || typeof client.channel !== "function") return;
    if (!st.chTasks) {
      st.chTasks = client
        .channel("tk-tasks-" + sync.tabId, { config: { private: true } })
        .on("postgres_changes", { event: "*", schema: "public", table: "staff_reminders" }, onTaskChange);
      st.chTasks.subscribe(function (status) {
        var joined = status === "SUBSCRIBED";
        var rejoined = joined && !st.tasksJoined && st.everJoined;
        st.tasksJoined = joined;
        if (joined) st.everJoined = true;
        // Back after a drop: catch up once on what we missed.
        if (rejoined) refetchLoaded();
      });
    }
    if (!st.chCore) {
      var ch = client.channel("tk-core-" + sync.tabId, { config: { private: true } });
      CHILD_TABLES.forEach(function (table) {
        ch = ch.on("postgres_changes", { event: "*", schema: "public", table: table }, function (p) {
          onChildChange(table, p);
        });
      });
      st.chCore = ch;
      st.chCore.subscribe();
    }
  }

  function closeChannels() {
    var client = db();
    [st.chTasks, st.chCore].forEach(function (ch) {
      if (!ch) return;
      try {
        if (client && typeof client.removeChannel === "function") client.removeChannel(ch);
        else if (typeof ch.unsubscribe === "function") ch.unsubscribe();
      } catch (e) {}
    });
    st.chTasks = null;
    st.chCore = null;
    st.tasksJoined = false;
    st.everJoined = false;
  }

  // ---- BroadcastChannel ------------------------------------------------------

  function onBroadcast(e) {
    var msg = e && e.data;
    if (!msg || msg.v !== 1 || !msg.type) return;
    if (msg.from === sync.tabId) return;
    if ((msg.type === "dock" || msg.type === "docked") && msg.to !== sync.tabId) return;
    if (msg.type === "upsert" && msg.task) applyRow(msg.task);
    else if (msg.type === "remove" && inStore(msg.id)) dispatch({ type: "remove", id: msg.id });
    else if (msg.type === "child") queueChild(msg.id, msg.table || "tk_comments");
    (st.handlers[msg.type] || []).slice().forEach(function (fn) {
      try {
        fn(msg);
      } catch (err) {
        try { console.error("[TK]", err); } catch (x) {}
      }
    });
  }

  function openBroadcast() {
    if (st.bc) return;
    try {
      if (typeof BroadcastChannel === "undefined") return;
      st.bc = new BroadcastChannel("mgb-tasks");
      st.bc.onmessage = onBroadcast;
    } catch (e) {
      st.bc = null;
    }
  }

  // ---- Public ------------------------------------------------------------------

  sync.start = function (email) {
    var who = email ? String(email).trim().toLowerCase() : null;
    if (st.started && st.email === who) return;
    if (st.started) sync.stop();
    st.started = true;
    st.email = who;
    if (who) dispatch({ type: "me", email: who });
    openBroadcast();

    var onLegacy = function () { onLegacyChanged(); };
    var onOnline = function () {
      dispatch({ type: "online", value: true });
      var s = store();
      if (s && s.getState().schema === "unknown" && typeof TK_api !== "undefined") TK_api.probe();
      onLegacyChanged();
    };
    var onOffline = function () { dispatch({ type: "online", value: false }); };
    var onVisible = function () { sweep(SWEEP_RETURN_MS); };
    st.winHandlers = { legacy: onLegacy, online: onOnline, offline: onOffline, visible: onVisible };
    try {
      window.addEventListener(LEGACY_EVENT, onLegacy);
      window.addEventListener("online", onOnline);
      window.addEventListener("offline", onOffline);
      if (typeof document !== "undefined" && document.addEventListener) document.addEventListener("visibilitychange", onVisible);
    } catch (e) {}
    st.lastSweep = Date.now();
    try {
      st.sweepTimer = setInterval(function () { sweep(SWEEP_MS - 1000); }, SWEEP_MS);
    } catch (e) {}
    try {
      if (typeof navigator !== "undefined" && navigator && navigator.onLine === false) dispatch({ type: "online", value: false });
    } catch (e) {}

    var s = store();
    if (s) {
      var check = function (state) {
        if (state.schema === "ok") openChannels();
      };
      st.unsubStore = s.subscribe(check);
      check(s.getState());
      if (s.getState().schema === "unknown" && typeof TK_api !== "undefined" && TK_api) TK_api.probe();
    }
  };

  sync.stop = function () {
    if (st.unsubStore) {
      try { st.unsubStore(); } catch (e) {}
    }
    st.unsubStore = null;
    closeChannels();
    if (st.bc) {
      try { st.bc.close(); } catch (e) {}
    }
    st.bc = null;
    if (st.winHandlers) {
      try {
        window.removeEventListener(LEGACY_EVENT, st.winHandlers.legacy);
        window.removeEventListener("online", st.winHandlers.online);
        window.removeEventListener("offline", st.winHandlers.offline);
        if (typeof document !== "undefined" && document.removeEventListener) document.removeEventListener("visibilitychange", st.winHandlers.visible);
      } catch (e) {}
    }
    st.winHandlers = null;
    if (st.sweepTimer) clearInterval(st.sweepTimer);
    st.sweepTimer = null;
    if (st.fallbackTimer) clearTimeout(st.fallbackTimer);
    st.fallbackTimer = null;
    Object.keys(st.coalesce).forEach(function (id) {
      clearTimeout(st.coalesce[id].timer);
    });
    st.coalesce = {};
    var wasStarted = st.started;
    st.started = false;
    st.email = null;
    // Sign-out or user switch: nothing from the last person stays in memory.
    if (wasStarted) {
      dispatch({ type: "reset" });
      try {
        if (typeof TK_api !== "undefined" && TK_api && typeof TK_api._reset === "function") TK_api._reset();
      } catch (e) {}
    }
  };

  sync.markOwnWrite = function () {
    st.lastOwnWrite = Date.now();
  };

  // msg: { type:"upsert", task } | { type:"remove", id } | { type:"child", id, table }
  //    | { type:"dock", hash, to } | { type:"docked", to }
  sync.post = function (msg) {
    if (!msg || !msg.type) return false;
    if (!st.bc) openBroadcast();
    if (!st.bc) return false;
    var out = {};
    for (var k in msg) if (Object.prototype.hasOwnProperty.call(msg, k)) out[k] = msg[k];
    out.v = 1;
    out.from = sync.tabId;
    try {
      st.bc.postMessage(out);
      return true;
    } catch (e) {
      return false;
    }
  };

  // Listen for BroadcastChannel messages from other windows by type.
  sync.on = function (type, fn) {
    if (!type || typeof fn !== "function") return function () {};
    (st.handlers[type] = st.handlers[type] || []).push(fn);
    return function () {
      var list = st.handlers[type] || [];
      var i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    };
  };

  // TK_useList registers its reload here so the fallback can refetch the
  // lists this window has loaded (one call per key).
  sync.registerLoader = function (key, fn) {
    if (!key || typeof fn !== "function") return function () {};
    (st.loaders[key] = st.loaders[key] || []).push(fn);
    return function () {
      var list = st.loaders[key] || [];
      var i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
      if (!list.length) delete st.loaders[key];
    };
  };

  sync.isJoined = function () {
    return st.tasksJoined;
  };

  // Tests only.
  sync._debug = function () {
    return {
      started: st.started,
      tasksJoined: st.tasksJoined,
      hasTasksChannel: !!st.chTasks,
      hasCoreChannel: !!st.chCore,
      hasBroadcast: !!st.bc,
      pendingChildren: Object.keys(st.coalesce).length,
      lastOwnWrite: st.lastOwnWrite,
    };
  };

  return sync;
})();

// ---- React hooks over TK_store (render time only) ----------------------------

// Value of selector(state). Re-renders only when the selected value changes
// (Object.is). The selector must return a stable value for the same state
// (TK_selectList does).
function TK_useStore(selector) {
  var sel = typeof selector === "function" ? selector : function (s) { return s; };
  var ref = React.useRef({ state: undefined, sel: undefined, value: undefined });
  var get = function () {
    var state = TK_store.getState();
    var r = ref.current;
    if (r.state === state && r.sel === sel) return r.value;
    var v = sel(state);
    if (r.state !== undefined && Object.is(v, r.value)) {
      r.state = state;
      r.sel = sel;
      return r.value;
    }
    ref.current = { state: state, sel: sel, value: v };
    return v;
  };
  if (typeof React.useSyncExternalStore === "function") {
    return React.useSyncExternalStore(TK_store.subscribe, get, get);
  }
  var pair = React.useState(0);
  var force = pair[1];
  React.useEffect(function () {
    return TK_store.subscribe(function () { force(function (n) { return n + 1; }); });
  }, []);
  return get();
}

function TK_useSchema() {
  var schema = TK_useStore(function (s) { return s.schema; });
  React.useEffect(function () {
    if (TK_store.getState().schema === "unknown" && typeof TK_api !== "undefined") TK_api.probe();
  }, []);
  return schema;
}

// Latest-request guard per list key, shared by every hook instance.
var TK_syncListSeq = {};

// { tasks, loading, error, reload }. loader() -> Promise<[Task]>. Loads once
// the schema is "ok", again when `key` changes, and on reload().
function TK_useList(key, loader) {
  var schema = TK_useSchema();
  var sel = React.useCallback(function (s) { return TK_selectList(s, key); }, [key]);
  var view = TK_useStore(sel);
  var loaderRef = React.useRef(loader);
  loaderRef.current = loader;

  var reload = React.useCallback(
    function () {
      if (!key || typeof loaderRef.current !== "function") return Promise.resolve([]);
      var seq = (TK_syncListSeq[key] || 0) + 1;
      TK_syncListSeq[key] = seq;
      TK_store.dispatch({ type: "listLoading", key: key });
      return Promise.resolve()
        .then(function () { return loaderRef.current(); })
        .then(
          function (tasks) {
            if (TK_syncListSeq[key] === seq) TK_store.dispatch({ type: "listLoaded", key: key, tasks: tasks || [], at: Date.now() });
            return tasks || [];
          },
          function (err) {
            if (TK_syncListSeq[key] === seq) {
              TK_store.dispatch({ type: "listError", key: key, error: (err && (err.code || err.message)) || "error" });
            }
            return [];
          },
        );
    },
    [key],
  );

  React.useEffect(
    function () {
      if (!key) return undefined;
      return TK_sync.registerLoader(key, reload);
    },
    [key, reload],
  );

  React.useEffect(
    function () {
      if (key && schema === "ok") reload();
    },
    [key, schema, reload],
  );

  return { tasks: view.tasks, loading: view.loading || (schema === "unknown" && !!key), error: view.error, reload: reload };
}

// { task, loading, error, reload } for one task id. Reads the store first and
// fetches when the task is not there yet. error "tk_not_found" when the task
// does not exist or cannot be read.
function TK_useTask(id) {
  var task = TK_useStore(
    React.useCallback(function (s) { return id ? s.tasks[id] || null : null; }, [id]),
  );
  var pair = React.useState({ loading: false, error: null });
  var meta = pair[0];
  var setMeta = pair[1];
  var seqRef = React.useRef(0);

  var reload = React.useCallback(
    function () {
      if (!id) return Promise.resolve(null);
      var seq = ++seqRef.current;
      setMeta({ loading: true, error: null });
      return TK_api.get(id).then(
        function (t) {
          if (seq !== seqRef.current) return t;
          if (t) TK_store.dispatch({ type: "upsert", task: t });
          setMeta({ loading: false, error: t ? null : "tk_not_found" });
          return t;
        },
        function (err) {
          if (seq === seqRef.current) setMeta({ loading: false, error: (err && (err.code || err.message)) || "error" });
          return null;
        },
      );
    },
    [id],
  );

  React.useEffect(
    function () {
      if (!id) return;
      if (!TK_store.getState().tasks[id]) reload();
    },
    [id, reload],
  );

  return { task: task, loading: !task && meta.loading, error: task ? null : meta.error, reload: reload };
}

// Calls fn(detail) on "tk:task-changed" for that task id.
function TK_useTaskChanged(id, fn) {
  var fnRef = React.useRef(fn);
  fnRef.current = fn;
  React.useEffect(
    function () {
      if (!id) return undefined;
      var on = function (e) {
        var d = e && e.detail;
        if (d && d.id === id && typeof fnRef.current === "function") fnRef.current(d);
      };
      window.addEventListener("tk:task-changed", on);
      return function () {
        window.removeEventListener("tk:task-changed", on);
      };
    },
    [id],
  );
}
