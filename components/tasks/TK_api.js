// ----------------------------------------------------------------------------
// TK_api: every Tasks read and write (Phase 1 spec C5, B4).
//
// Goes through window.mgbSupabase under RLS. Every method returns a Promise
// and rejects with an Error that carries `.code`: tk_schema_missing,
// tk_forbidden, tk_conflict, tk_reverted, tk_offline, tk_not_found,
// tk_name_taken, or the Postgres / PostgREST code. `.reason` holds the
// server's tk_ token when there is one (tk_bad_transition, tk_wrong_client …).
//
// Schema (B4): probe() calls rpc("tk_schema_version") once per page load.
// A missing-column or missing-function error from any other call re-probes
// (shared, at most once per 30 s); the schema becomes "missing" only when
// tk_schema_version itself is missing (PGRST202 / 42883).
//
// After every successful task write: store upsert (or commit), TK_sync.post,
// TK_sync.markOwnWrite, then staffItemsApi.notify, in that order, so the
// legacy event that follows our own write never makes TK refetch.
//
// Browser file; loads after TK_logic.js and TK_store.js. Uses other globals
// (TK_sync, staffItemsApi, DRV_*, TK_attachmentPath …) at call time only.
// ----------------------------------------------------------------------------

var TK_TASK_COLS =
  "id, text, description, status, done, due_date, due_at, remind_at, start_on, priority, kind, recurrence, " +
  "client_id, project_id, section, sort_key, parent_id, sop_section, review_required, assignee_email, " +
  "staff_email, created_by, visibility, source, source_ref, series_id, completed_at, status_changed_at, " +
  "status_changed_by, waiting_since, waiting_minutes, created_at, updated_at, deleted_at, " +
  "reviewer_email, send_back_count, ready_at, submitted_by, submitted_at, approved_by, approved_at, " +
  "due_date_original, waiting_before_due_minutes";

// Raises a toast through the existing window event that ToastProvider handles.
function TK_toast(text) {
  if (!text) return;
  try {
    window.dispatchEvent(new CustomEvent("mgb:toast", { detail: { text: String(text) } }));
  } catch (e) {}
}

var TK_api = (function () {
  var TASK_FIELDS = TK_TASK_COLS.split(",").map(function (s) { return s.trim(); });
  var UPDATE_FIELDS = [
    "text", "description", "due_date", "due_at", "remind_at", "start_on", "priority", "kind", "recurrence",
    "section", "sort_key", "sop_section", "review_required", "assignee_email", "visibility", "parent_id",
    "client_id", "project_id",
  ];
  var CREATE_FIELDS = UPDATE_FIELDS.concat(["status", "source", "source_ref"]);
  var COMMENT_COLS = "id, task_id, author_email, body, mentions, kind, created_at, edited_at, edited_by, deleted_at";
  var ACTIVITY_COLS = "id, task_id, actor_email, kind, from_value, to_value, meta, created_at";
  var FOLLOWER_COLS = "task_id, staff_email, added_by, added_at";
  var ATTACH_COLS = "id, task_id, kind, client_file_id, storage_path, url, name, size, mime, added_by, created_at, removed_at";
  var PROJECT_COLS = "id, name, kind, client_id, owner_email, open_to_staff, sections, archived_at, created_at, updated_at";
  var MEMBER_COLS = "project_id, staff_email, role, added_by, added_at";
  var STAFF_COLS = "id, email, name, role, active";
  var PROJECT_UPDATE_FIELDS = ["name", "sections", "open_to_staff", "archived_at"];
  var EMAIL_FIELDS = { assignee_email: 1, staff_email: 1, created_by: 1, reviewer_email: 1 };
  var STAMP_FIELDS = { due_at: 1, remind_at: 1, deleted_at: 1 };
  var REPROBE_MS = 30000;
  var TK_REASONS = [
    "tk_forbidden", "tk_bad_status", "tk_bad_transition", "tk_follower_no_access", "tk_wrong_client",
    "tk_use_drive", "tk_member_inactive", "tk_name_taken",
    "tk_self_review", "tk_needs_approval", "tk_in_review", "tk_reason_required", "tk_bad_reviewer",
    "tk_server_owned", "tk_owner_only",
    "tk_bad_due_rule", "tk_bad_template", "tk_checklist_too_long", "tk_bad_override", "tk_bad_action",
    "tk_template_retired", "tk_not_found", "tk_cadence_locked", "tk_review_admin_only",
    "tk_has_open_requests", "tk_email_off", "tk_no_recipients", "tk_bad_recipient", "tk_legacy_request",
    "tk_reply_required", "tk_not_open", "tk_not_answered", "tk_contact_exists", "tk_bad_contact", "tk_bad_request",
  ];
  var COPY_FALLBACK = {
    sentForReview: "Sent for review. An admin will approve it.",
    approved: "Approved.",
    sentBack: "Sent back with your note.",
    withdrawn: "Taken back from review.",
    awaitingReview: "This is waiting for an admin to approve it.",
  };

  // ---- small helpers -------------------------------------------------------
  var api = {};
  var probeState = { value: "unknown", promise: null, at: 0, retryTimer: null, onlineBound: false };
  var completing = {}; // task id -> in-flight complete() promise (double-click guard)
  var staffCache = null;

  function db() {
    if (api._client) return api._client;
    try {
      return window.mgbSupabase || null;
    } catch (e) {
      return null;
    }
  }

  function store() {
    return typeof TK_store !== "undefined" && TK_store ? TK_store : null;
  }

  function dispatch(action) {
    var s = store();
    if (s) s.dispatch(action);
  }

  function me() {
    var s = store();
    var v = s && s.getState().me;
    return v ? String(v).toLowerCase() : "";
  }

  function lower(v) {
    return v == null ? "" : String(v).trim().toLowerCase();
  }

  function copy(key) {
    try {
      if (typeof TK_COPY !== "undefined" && TK_COPY && TK_COPY[key]) return TK_COPY[key];
    } catch (e) {}
    return COPY_FALLBACK[key] || "";
  }

  function todayYmd() {
    try {
      if (typeof TK_ymd === "function") return TK_ymd(new Date());
    } catch (e) {}
    var d = new Date();
    var p = function (n) { return n < 10 ? "0" + n : String(n); };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function monthsAgoIso(n) {
    var d = new Date();
    d.setMonth(d.getMonth() - n);
    return d.toISOString();
  }

  function pick(obj, fields) {
    var out = {};
    if (!obj) return out;
    fields.forEach(function (f) {
      if (Object.prototype.hasOwnProperty.call(obj, f) && obj[f] !== undefined) out[f] = obj[f];
    });
    return out;
  }

  function quote(v) {
    // PostgREST logic-tree value: double-quoted, with " and \ escaped.
    return '"' + String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
  }

  function errOf(code, message, extra) {
    var e = new Error(message || code);
    e.code = code;
    if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) e[k] = extra[k];
    return e;
  }

  function reasonOf(error) {
    var msg = String((error && error.message) || "");
    for (var i = 0; i < TK_REASONS.length; i++) if (msg.indexOf(TK_REASONS[i]) >= 0) return TK_REASONS[i];
    return null;
  }

  function isMissingColumn(err) {
    if (typeof TK_isMissingColumn === "function") return TK_isMissingColumn(err);
    if (!err) return false;
    var c = String(err.code || "");
    var m = String(err.message || "");
    return c === "42703" || c === "PGRST204" || /column .* does not exist/i.test(m) || /could not find the .* column/i.test(m);
  }

  function isMissingFunction(err) {
    if (typeof TK_isMissingFunction === "function") return TK_isMissingFunction(err);
    if (!err) return false;
    var c = String(err.code || "");
    return c === "PGRST202" || c === "42883" || /could not find the function/i.test(String(err.message || ""));
  }

  function isNetworkError(err) {
    if (!err) return false;
    if (err.code) return false;
    var m = String(err.message || err);
    return /failed to fetch|networkerror|network request failed|load failed|fetch failed|timeout/i.test(m) || err.name === "TypeError";
  }

  function offline() {
    try {
      return typeof navigator !== "undefined" && navigator && navigator.onLine === false;
    } catch (e) {
      return false;
    }
  }

  function requireOnline() {
    if (offline()) return Promise.reject(errOf("tk_offline", "offline"));
    return null;
  }

  function normalize(row) {
    if (!row) return null;
    var t = typeof TK_normalizeTask === "function" ? TK_normalizeTask(row) : fallbackNormalize(row);
    // Keep exactly the Task shape (C2), so a Realtime row (which carries
    // search_tsv, deleted_by …) and a PostgREST row compare equal.
    var out = {};
    TASK_FIELDS.forEach(function (f) { out[f] = t[f] === undefined ? null : t[f]; });
    return out;
  }

  function fallbackNormalize(r) {
    var out = {};
    for (var k in r) if (Object.prototype.hasOwnProperty.call(r, k)) out[k] = r[k];
    var status = r.status || (r.done ? "done" : "todo");
    out.status = status;
    out.done = status === "done";
    out.staff_email = lower(r.staff_email);
    out.assignee_email = lower(r.assignee_email) || out.staff_email;
    out.priority = r.priority || "normal";
    out.kind = r.kind || "task";
    out.recurrence = r.recurrence || "none";
    out.visibility = r.visibility || "private";
    out.review_required = !!r.review_required;
    out.waiting_minutes = Number(r.waiting_minutes) > 0 ? Number(r.waiting_minutes) : 0;
    out.source = r.source || "manual";
    return out;
  }

  function effectiveStatus(task) {
    if (typeof TK_effectiveStatus === "function") return TK_effectiveStatus(task);
    if (!task) return "todo";
    return task.status || (task.done ? "done" : "todo");
  }

  function isOpen(task) {
    if (typeof TK_isOpen === "function") return TK_isOpen(task);
    return !!task && !task.deleted_at && effectiveStatus(task) !== "done";
  }

  function sync() {
    return typeof TK_sync !== "undefined" && TK_sync ? TK_sync : null;
  }

  // The after-write sequence (C5). msg is the TK_sync.post message.
  function afterWrite(msg, opts) {
    var s = sync();
    if (s && msg) {
      try { s.post(msg); } catch (e) {}
    }
    if (s) {
      try { s.markOwnWrite(); } catch (e) {}
    }
    if (opts && opts.legacy === false) return;
    try {
      if (typeof staffItemsApi !== "undefined" && staffItemsApi && typeof staffItemsApi.notify === "function") staffItemsApi.notify();
    } catch (e) {}
  }

  function afterTaskWrite(task, opId) {
    if (!task) return;
    if (opId) dispatch({ type: "commit", opId: opId, task: task });
    else dispatch({ type: "upsert", task: task });
    afterWrite({ type: "upsert", task: task });
  }

  function afterChildWrite(taskId, table) {
    afterWrite({ type: "child", id: taskId, table: table }, { legacy: false });
  }

  // ---- Schema probe (B4) ---------------------------------------------------

  function setSchema(v) {
    probeState.value = v;
    dispatch({ type: "schema", value: v });
  }

  function scheduleRetry() {
    if (probeState.retryTimer) return;
    try {
      probeState.retryTimer = setTimeout(function () {
        probeState.retryTimer = null;
        if (probeState.value === "unknown") runProbe();
      }, REPROBE_MS);
    } catch (e) {}
    if (!probeState.onlineBound) {
      probeState.onlineBound = true;
      try {
        window.addEventListener("online", function () {
          if (probeState.value === "unknown") runProbe();
        });
      } catch (e) {}
    }
  }

  function runProbe() {
    if (probeState.promise) return probeState.promise;
    var client = db();
    if (!client) {
      setSchema("missing");
      return Promise.resolve("missing");
    }
    probeState.at = Date.now();
    var p = Promise.resolve()
      .then(function () { return client.rpc("tk_schema_version"); })
      .then(
        function (res) {
          if (res && !res.error && Number(res.data) >= 1) {
            setSchema("ok");
            return "ok";
          }
          var error = res && res.error;
          if (error && isMissingFunction(error)) {
            setSchema("missing");
            return "missing";
          }
          // Network trouble or anything unexpected: stay unknown and retry.
          if (probeState.value !== "ok" && probeState.value !== "missing") setSchema("unknown");
          scheduleRetry();
          return probeState.value;
        },
        function () {
          if (probeState.value !== "ok" && probeState.value !== "missing") setSchema("unknown");
          scheduleRetry();
          return probeState.value;
        },
      )
      .then(function (v) {
        probeState.promise = null;
        return v;
      });
    probeState.promise = p;
    return p;
  }

  // Once per page load: a settled "ok" or "missing" answers from memory.
  api.probe = function () {
    if (probeState.value === "ok" || probeState.value === "missing") return Promise.resolve(probeState.value);
    return runProbe();
  };

  // Re-run the probe after a missing-column or missing-function error,
  // shared and at most once per 30 s.
  function reprobe() {
    if (probeState.promise) return probeState.promise;
    if (probeState.at && Date.now() - probeState.at < REPROBE_MS && probeState.value !== "unknown") {
      return Promise.resolve(probeState.value);
    }
    return runProbe();
  }

  // Turn a Supabase { error } into a rejection, re-probing first when the
  // code could mean the schema is missing.
  function fail(error, context) {
    if (!error) return Promise.reject(errOf("tk_error", "Unknown error"));
    if (error.code === "tk_offline" || (offline() && isNetworkError(error))) {
      return Promise.reject(errOf("tk_offline", "offline"));
    }
    if (isMissingColumn(error) || isMissingFunction(error)) {
      return reprobe().then(function (v) {
        if (v === "missing") throw errOf("tk_schema_missing", "Tasks is being set up");
        logError(error, context);
        throw errOf(String(error.code || "tk_error"), error.message, { reason: reasonOf(error), details: error.details || null });
      });
    }
    var reason = reasonOf(error);
    var code = String(error.code || "");
    if (code === "42501") code = "tk_forbidden";
    else if (code === "23505" && context && context.uniqueAs) code = context.uniqueAs;
    else if (code === "PGRST116") code = "tk_not_found";
    if (!code) code = isNetworkError(error) ? "tk_network" : "tk_error";
    if (code !== "tk_forbidden" && code !== "tk_name_taken" && code !== "tk_not_found") logError(error, context);
    return Promise.reject(errOf(code, error.message, { reason: reason, pgCode: error.code || null }));
  }

  function logError(error, context) {
    try {
      console.error("[TK]", error.code || "", error.message || "", context && context.where ? context.where : "");
    } catch (e) {}
  }

  // Runs a builder; resolves with data, or rejects through fail().
  function run(build, context) {
    var client = db();
    if (!client) return Promise.reject(errOf("tk_schema_missing", "No database client"));
    return Promise.resolve()
      .then(function () { return build(client); })
      .then(
        function (res) {
          if (res && res.error) return fail(res.error, context);
          return res ? res.data : null;
        },
        function (thrown) {
          return fail(thrown && (thrown.code || thrown.message) ? thrown : { message: String(thrown) }, context);
        },
      );
  }

  // ---- Lists ---------------------------------------------------------------

  // Open tasks, plus done ones from the last 12 months. A done row with no
  // completed_at (old legacy rows) falls back to updated_at so it still shows.
  function recentFilter() {
    var cut = quote(monthsAgoIso(12));
    return "done.eq.false,completed_at.gte." + cut + ",and(completed_at.is.null,updated_at.gte." + cut + ")";
  }

  api.listMine = function (email, opts) {
    var who = lower(email || me());
    var showOlder = !!(opts && opts.showOlder);
    if (!who) return Promise.resolve([]);
    return run(function (c) {
      var q = c
        .from("tk_tasks")
        .select(TK_TASK_COLS)
        .or("assignee_email.eq." + quote(who) + ",and(assignee_email.is.null,staff_email.eq." + quote(who) + ")");
      if (!showOlder) q = q.or(recentFilter());
      return q.order("due_date", { ascending: true, nullsFirst: false }).limit(1000);
    }, { where: "listMine" }).then(function (rows) {
      return (rows || []).map(normalize);
    });
  };

  api.listScope = function (scope, opts) {
    var s = scope || {};
    var showDone = !!(opts && opts.showDone);
    var showOlder = !!(opts && opts.showOlder);
    if (!s.clientId && !s.projectId && !s.assigneeEmail && !s.parentId) return Promise.resolve([]);
    return run(function (c) {
      var q = c.from("tk_tasks").select(TK_TASK_COLS);
      if (s.clientId) q = q.eq("client_id", String(s.clientId));
      if (s.projectId) q = q.eq("project_id", s.projectId);
      if (s.parentId) q = q.eq("parent_id", s.parentId);
      if (s.assigneeEmail) {
        var who = lower(s.assigneeEmail);
        q = q.or("assignee_email.eq." + quote(who) + ",and(assignee_email.is.null,staff_email.eq." + quote(who) + ")");
      }
      if (!showDone) q = q.eq("done", false);
      else if (!showOlder) q = q.or(recentFilter());
      if (s.parentId) {
        q = q.order("sort_key", { ascending: true, nullsFirst: false }).order("created_at", { ascending: true });
      } else {
        q = q.order("due_date", { ascending: true, nullsFirst: false });
      }
      return q.limit(1000);
    }, { where: "listScope" }).then(function (rows) {
      return (rows || []).map(normalize);
    });
  };

  api.listChildren = function (parentId) {
    return api.listScope({ parentId: parentId }, { showDone: true, showOlder: true });
  };

  // From the base table, so a deleted task can still be shown and restored.
  api.get = function (id) {
    if (!id) return Promise.resolve(null);
    return run(function (c) {
      return c.from("staff_reminders").select(TK_TASK_COLS).eq("id", id).maybeSingle();
    }, { where: "get" }).then(function (row) {
      return row ? normalize(row) : null;
    });
  };

  // Fetch one task and put it in the store (used after RPC writes).
  function refresh(id) {
    return api.get(id).then(
      function (t) {
        if (t) dispatch({ type: "upsert", task: t });
        return t;
      },
      function () {
        return null;
      },
    );
  }

  // ---- Task writes -----------------------------------------------------------

  api.create = function (fields) {
    var off = requireOnline();
    if (off) return off;
    var f = pick(fields || {}, CREATE_FIELDS);
    var who = me() || lower(fields && fields.staff_email);
    if (!who) return Promise.reject(errOf("tk_forbidden", "Not signed in"));
    if (!f.text || !String(f.text).trim()) return Promise.reject(errOf("22023", "Add a few words about the task."));
    var row = {};
    for (var k in f) if (Object.prototype.hasOwnProperty.call(f, k)) row[k] = f[k];
    row.text = String(f.text).trim();
    row.staff_email = who;
    row.created_by = who;
    row.assignee_email = lower(f.assignee_email) || who;
    row.status = f.status || "todo";
    row.priority = f.priority || "normal";
    row.kind = f.kind || "task";
    row.recurrence = f.recurrence || "none";
    row.source = f.source || "manual";
    row.client_id = f.client_id || null;
    row.project_id = f.project_id || null;
    // Shared only inside a container. Project tasks default to shared (members
    // see them); client tasks keep the legacy private default unless asked.
    var container = !!(row.client_id || row.project_id);
    row.visibility = container ? (f.visibility || (row.project_id ? "shared" : "private")) : "private";
    if (row.visibility !== "shared") row.visibility = "private";
    if (!row.due_at && row.due_date && typeof buildStaffDueAt === "function") {
      try { row.due_at = buildStaffDueAt(row.due_date, null); } catch (e) {}
    }
    return run(function (c) {
      return c.from("staff_reminders").insert(row).select(TK_TASK_COLS).single();
    }, { where: "create" }).then(function (data) {
      var t = normalize(data);
      afterTaskWrite(t);
      return t;
    });
  };

  function sameValue(field, a, b) {
    var na = a === "" || a === undefined ? null : a;
    var nb = b === "" || b === undefined ? null : b;
    if (na === nb) return true;
    if (na == null || nb == null) return false;
    if (EMAIL_FIELDS[field]) return lower(na) === lower(nb);
    if (STAMP_FIELDS[field]) {
      var ta = new Date(na).getTime();
      var tb = new Date(nb).getTime();
      return !isNaN(ta) && ta === tb;
    }
    if (field === "due_date" || field === "start_on") return String(na).slice(0, 10) === String(nb).slice(0, 10);
    if (field === "sort_key") return Number(na) === Number(nb);
    if (typeof na === "boolean" || typeof nb === "boolean") return !!na === !!nb;
    if (Array.isArray(na) && Array.isArray(nb)) return JSON.stringify(na) === JSON.stringify(nb);
    return String(na) === String(nb);
  }

  // Shared by update / remove / restore. `clean` is already whitelisted.
  function writeTask(id, clean, opts) {
    var base = opts && opts.baseUpdatedAt;
    var opId = opts && opts.opId;
    return run(function (c) {
      var q = c.from("staff_reminders").update(clean).eq("id", id);
      if (base) q = q.eq("updated_at", base); // exact server string, never through Date
      return q.select(TK_TASK_COLS);
    }, { where: "update" }).then(function (rows) {
      var row = Array.isArray(rows) ? rows[0] : rows;
      if (!row) {
        // 0 rows: someone moved updated_at (conflict) or RLS said no.
        return api.get(id).then(
          function (cur) {
            if (cur && base && cur.updated_at && cur.updated_at !== base) {
              if (opId) dispatch({ type: "rollback", opId: opId });
              dispatch({ type: "upsert", task: cur });
              throw errOf("tk_conflict", "conflict", { task: cur });
            }
            throw errOf("tk_forbidden", "forbidden", { task: cur || null });
          },
          function (e) {
            if (e && (e.code === "tk_conflict" || e.code === "tk_forbidden")) throw e;
            throw errOf("tk_forbidden", "forbidden");
          },
        );
      }
      var t = normalize(row);
      var reverted = Object.keys(clean).filter(function (f) {
        return Object.prototype.hasOwnProperty.call(t, f) && !sameValue(f, t[f], clean[f]);
      });
      afterTaskWrite(t, opId);
      if (reverted.length) throw errOf("tk_reverted", "reverted", { fields: reverted, task: t });
      return t;
    });
  }

  // update(id, patch, { baseUpdatedAt, optimistic })
  //   optimistic: true also applies the patch to the store first and commits
  //   or rolls it back (an addition to C5; callers may still do it themselves).
  api.update = function (id, patch, opts) {
    var off = requireOnline();
    if (off) return off;
    if (!id) return Promise.reject(errOf("tk_not_found", "No task"));
    var clean = pick(patch || {}, UPDATE_FIELDS);
    if (clean.assignee_email) clean.assignee_email = lower(clean.assignee_email);
    if (!Object.keys(clean).length) {
      var s = store();
      var cur = s && s.getState().tasks[id];
      return cur ? Promise.resolve(cur) : api.get(id);
    }
    var o = opts || {};
    var opId = o.opId || null;
    if (o.optimistic && !opId) {
      opId = "tk-op-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
      dispatch({ type: "optimistic", id: id, patch: clean, opId: opId });
    }
    return writeTask(id, clean, { baseUpdatedAt: o.baseUpdatedAt || null, opId: opId }).catch(function (e) {
      if (opId && e && e.code !== "tk_conflict" && e.code !== "tk_reverted") dispatch({ type: "rollback", opId: opId });
      throw e;
    });
  };

  api.remove = function (id) {
    var off = requireOnline();
    if (off) return off;
    return writeTask(id, { deleted_at: nowIso() }, {}).catch(function (e) {
      // deleted_at is a stamp: the server's value differs from ours by design.
      if (e && e.code === "tk_reverted" && e.task && e.task.deleted_at) return e.task;
      throw e;
    });
  };

  api.restore = function (id) {
    var off = requireOnline();
    if (off) return off;
    return writeTask(id, { deleted_at: null }, {});
  };

  function statusRpc(id, status, note) {
    return run(function (c) {
      return c.rpc("tk_set_status", {
        p_id: id,
        p_status: status,
        p_note: note == null || note === "" ? null : String(note),
        p_today: todayYmd(),
      });
    }, { where: "setStatus" }).then(function (data) {
      return typeof data === "string" ? data : data && data.tk_set_status ? data.tk_set_status : String(data || status);
    });
  }

  function toastFor(fromStatus, asked, result) {
    // Done (or a resend for review) that lands in review: say so, every time.
    if ((asked === "done" || asked === "ready_for_review") && result === "ready_for_review") {
      TK_toast(copy("sentForReview"));
      return true;
    }
    if (asked === "done" && result === "done" && fromStatus === "ready_for_review") TK_toast(copy("approved"));
    return false;
  }

  // Status change through the RPC. Raises the review toasts itself (same as
  // complete), so callers never toast "Sent for review" or "Approved".
  api.setStatus = function (id, status, note) {
    var off = requireOnline();
    if (off) return off;
    var s = store();
    var cached = s && s.getState().tasks[id];
    var from = cached ? effectiveStatus(cached) : null;
    return statusRpc(id, status, note).then(function (result) {
      toastFor(from, status, result);
      return refresh(id).then(function (t) {
        afterWrite(t ? { type: "upsert", task: t } : null);
        return result;
      });
    });
  };

  // Caller did not say: use the staff list in the store (role "admin").
  function meIsAdmin() {
    var s = store();
    var st = s && s.getState();
    var who = lower(me());
    var list = st && Array.isArray(st.staff) ? st.staff : [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && lower(list[i].email) === who) return list[i].role === "admin";
    }
    return false;
  }

  // The one completion path (rows, drawer, Today, Overview, reminders card).
  // complete(task, { done = true, isAdmin }) -> { status, sentForReview, nextId: null }
  api.complete = function (task, opts) {
    if (!task || !task.id) return Promise.reject(errOf("tk_not_found", "No task"));
    var done = !(opts && opts.done === false);
    var current = effectiveStatus(task);
    // Double-click guard: nothing to do, or the same request already running.
    if (done && current === "done") return Promise.resolve({ status: current, sentForReview: false, nextId: null });
    if (!done && current !== "done") return Promise.resolve({ status: current, sentForReview: false, nextId: null });
    if (completing[task.id]) return completing[task.id];
    var off = requireOnline();
    if (off) return off;

    var p = api
      .probe()
      .then(function (schema) {
        if (schema === "missing") return completeLegacy(task, done);
        var target = done ? "done" : "todo";
        var guess = target;
        var isAdmin = opts && typeof opts.isAdmin === "boolean" ? opts.isAdmin : meIsAdmin();
        // Tasks p2 s3: done on a gated task lands in review for admins too;
        // done from review is an approval, which only an admin can give.
        if (done && current === "ready_for_review") {
          if (!isAdmin) {
            TK_toast(copy("awaitingReview"));
            return { status: current, sentForReview: false, nextId: null };
          }
          return api.approve(task.id).then(function (r) {
            return { status: r.status, sentForReview: false, nextId: r.nextId };
          });
        }
        if (done && task.review_required) guess = "ready_for_review";
        var opId = "tk-done-" + task.id + "-" + Date.now().toString(36);
        dispatch({
          type: "optimistic",
          id: task.id,
          opId: opId,
          patch: { status: guess, done: guess === "done", completed_at: guess === "done" ? nowIso() : null },
        });
        return statusRpc(task.id, target, null).then(
          function (result) {
            var sentForReview = done && result === "ready_for_review";
            toastFor(current, target, result);
            return api.get(task.id).then(
              function (t) {
                dispatch({ type: "commit", opId: opId, task: t || undefined });
                if (!t) dispatch({ type: "upsert", task: Object.assign({}, task, { status: result, done: result === "done" }) });
                afterWrite(t ? { type: "upsert", task: t } : null);
                return { status: result, sentForReview: sentForReview, nextId: null };
              },
              function () {
                dispatch({ type: "commit", opId: opId });
                afterWrite(null);
                return { status: result, sentForReview: sentForReview, nextId: null };
              },
            );
          },
          function (e) {
            dispatch({ type: "rollback", opId: opId });
            throw e;
          },
        );
      })
      .then(
        function (r) {
          delete completing[task.id];
          return r;
        },
        function (e) {
          delete completing[task.id];
          throw e;
        },
      );
    completing[task.id] = p;
    return p;
  };

  // Schema missing: the legacy toggle (complete_staff_item, or its client-side
  // fallback). staffItemsApi.toggleDone flips item.done, so pass the current one.
  function completeLegacy(task, done) {
    if (typeof staffItemsApi === "undefined" || !staffItemsApi || typeof staffItemsApi.toggleDone !== "function") {
      return Promise.reject(errOf("tk_schema_missing", "Tasks is being set up"));
    }
    var item = Object.assign({}, task, { done: !done });
    return Promise.resolve(staffItemsApi.toggleDone(db(), me() || lower(task.staff_email), item)).then(function (res) {
      if (res && res.error) {
        var e = errOf(String(res.error.code || "tk_error"), res.error.message);
        throw e;
      }
      return { status: done ? "done" : "todo", sentForReview: false, nextId: null };
    });
  }

  api.toggleDone = function (task, opts) {
    return api.complete(task, { done: isOpen(task), isAdmin: opts && opts.isAdmin }).then(function (r) {
      return r.status;
    });
  };

  // ---- Review (tasks p2 s3) -------------------------------------------------
  // The server enforces who may do what (tk__review_target). Each call
  // refreshes the task and runs the after-write sequence. Failures reject
  // with .reason (tk_self_review, tk_reason_required …) for the caller's toast.
  function reviewCall(id, rpcName, args, where, optimistic) {
    var off = requireOnline();
    if (off) return off;
    var opId = null;
    if (optimistic) {
      opId = "tk-rv-" + id + "-" + Date.now().toString(36);
      dispatch({ type: "optimistic", id: id, opId: opId, patch: optimistic });
    }
    return run(function (c) {
      return c.rpc(rpcName, args);
    }, { where: where }).then(
      function (data) {
        return refresh(id).then(
          function (t) {
            if (opId) dispatch({ type: "commit", opId: opId, task: t || undefined });
            afterWrite(t ? { type: "upsert", task: t } : null);
            return { data: data, task: t || null };
          },
          function () {
            if (opId) dispatch({ type: "commit", opId: opId });
            afterWrite(null);
            return { data: data, task: null };
          },
        );
      },
      function (e) {
        if (opId) dispatch({ type: "rollback", opId: opId });
        throw e;
      },
    );
  }

  // Approve: ready_for_review -> done (series roll forward). { status, nextId }
  api.approve = function (id, note) {
    return reviewCall(id, "tk_approve", { p_id: id, p_note: note ? String(note) : null }, "approve", {
      status: "done",
      done: true,
      completed_at: nowIso(),
    }).then(function (r) {
      TK_toast(copy("approved"));
      var d = r.data || {};
      return { status: r.task ? r.task.status : "done", nextId: d.next_id || null };
    });
  };

  // Send back with a reason (3-2000 characters): back to In progress.
  api.sendBack = function (id, reason) {
    var why = String(reason == null ? "" : reason).trim();
    if (why.length < 3 || why.length > 2000) {
      return Promise.reject(errOf("tk_reason_required", "tk_reason_required", { reason: "tk_reason_required" }));
    }
    return reviewCall(id, "tk_send_back", { p_id: id, p_reason: why }, "sendBack", { status: "in_progress", done: false }).then(
      function (r) {
        TK_toast(copy("sentBack"));
        return { status: r.task ? r.task.status : "in_progress" };
      },
    );
  };

  // The assignee (or an admin) takes it back out of review.
  api.withdraw = function (id, note) {
    return reviewCall(id, "tk_withdraw_review", { p_id: id, p_note: note ? String(note) : null }, "withdraw", {
      status: "in_progress",
      done: false,
    }).then(function (r) {
      TK_toast(copy("withdrawn"));
      return { status: r.task ? r.task.status : "in_progress" };
    });
  };

  api.readyForReview = function (id, note) {
    return reviewCall(id, "tk_ready_for_review", { p_id: id, p_note: note ? String(note) : null }, "readyForReview", {
      status: "ready_for_review",
      done: false,
    }).then(function (r) {
      TK_toast(copy("sentForReview"));
      return { status: r.task ? r.task.status : String(r.data || "ready_for_review") };
    });
  };

  // Admin only. Empty email clears it (the server picks the default on submit).
  api.setReviewer = function (id, email) {
    var who = lower(email) || null;
    return reviewCall(id, "tk_set_reviewer", { p_id: id, p_email: who }, "setReviewer", { reviewer_email: who }).then(function (r) {
      return r.task;
    });
  };

  // Everything in review this person can see (RLS decides), oldest first.
  api.listReview = function () {
    return run(function (c) {
      return c
        .from("tk_tasks")
        .select(TK_TASK_COLS)
        .eq("status", "ready_for_review")
        .order("submitted_at", { ascending: true, nullsFirst: true })
        .limit(500);
    }, { where: "listReview" }).then(function (rows) {
      return (rows || []).map(normalize);
    });
  };

  // Stats (admins see everyone; others only themselves). Dates are YYYY-MM-DD.
  api.reviewStats = function (from, to, email) {
    return run(function (c) {
      return c.rpc("tk_review_stats", { p_from: from, p_to: to, p_email: email ? lower(email) : null });
    }, { where: "reviewStats" }).then(function (rows) {
      return rows || [];
    });
  };

  api.onTimeStats = function (from, to, email) {
    return run(function (c) {
      return c.rpc("tk_on_time_stats", { p_from: from, p_to: to, p_email: email ? lower(email) : null });
    }, { where: "onTimeStats" }).then(function (rows) {
      return rows || [];
    });
  };

  // ---- Comments ------------------------------------------------------------

  api.listComments = function (taskId) {
    return run(function (c) {
      return c.from("tk_comments").select(COMMENT_COLS).eq("task_id", taskId).order("created_at", { ascending: true }).limit(500);
    }, { where: "listComments" }).then(function (rows) { return rows || []; });
  };

  api.addComment = function (taskId, body) {
    var off = requireOnline();
    if (off) return off;
    var text = String(body || "").trim();
    if (!text) return Promise.reject(errOf("22023", "Empty comment"));
    return run(function (c) {
      return c.from("tk_comments").insert({ task_id: taskId, body: text }).select(COMMENT_COLS).single();
    }, { where: "addComment" }).then(function (row) {
      afterChildWrite(taskId, "tk_comments");
      return row;
    });
  };

  function updateComment(id, patch) {
    var off = requireOnline();
    if (off) return off;
    return run(function (c) {
      return c.from("tk_comments").update(patch).eq("id", id).select(COMMENT_COLS);
    }, { where: "updateComment" }).then(function (rows) {
      var row = Array.isArray(rows) ? rows[0] : rows;
      if (!row) throw errOf("tk_forbidden", "forbidden");
      afterChildWrite(row.task_id, "tk_comments");
      return row;
    });
  }

  api.editComment = function (id, body) {
    var text = String(body || "").trim();
    if (!text) return Promise.reject(errOf("22023", "Empty comment"));
    return updateComment(id, { body: text });
  };

  api.deleteComment = function (id) {
    return updateComment(id, { deleted_at: nowIso() });
  };

  api.listActivity = function (taskId) {
    return run(function (c) {
      return c.from("tk_activity").select(ACTIVITY_COLS).eq("task_id", taskId).order("created_at", { ascending: true }).limit(500);
    }, { where: "listActivity" }).then(function (rows) { return rows || []; });
  };

  // ---- Followers -----------------------------------------------------------

  api.listFollowers = function (taskId) {
    return run(function (c) {
      return c.from("tk_followers").select(FOLLOWER_COLS).eq("task_id", taskId).order("added_at", { ascending: true });
    }, { where: "listFollowers" }).then(function (rows) { return rows || []; });
  };

  api.follow = function (taskId) {
    var off = requireOnline();
    if (off) return off;
    var who = me();
    if (!who) return Promise.reject(errOf("tk_forbidden", "Not signed in"));
    return run(function (c) {
      return c.from("tk_followers").insert({ task_id: taskId, staff_email: who });
    }, { where: "follow", uniqueAs: "tk_already" }).then(
      function () {
        afterChildWrite(taskId, "tk_followers");
        return true;
      },
      function (e) {
        if (e && e.code === "tk_already") return true;
        throw e;
      },
    );
  };

  api.unfollow = function (taskId) {
    return api.removeFollower(taskId, me());
  };

  api.addFollower = function (taskId, email) {
    var off = requireOnline();
    if (off) return off;
    return run(function (c) {
      return c.rpc("tk_add_follower", { p_task: taskId, p_email: lower(email) });
    }, { where: "addFollower" }).then(function (added) {
      afterChildWrite(taskId, "tk_followers");
      return !!added;
    });
  };

  api.removeFollower = function (taskId, email) {
    var off = requireOnline();
    if (off) return off;
    var who = lower(email);
    if (!who) return Promise.reject(errOf("tk_forbidden", "No person"));
    return run(function (c) {
      return c.from("tk_followers").delete().eq("task_id", taskId).eq("staff_email", who).select("task_id");
    }, { where: "removeFollower" }).then(function (rows) {
      // 0 rows: RLS refused it (or it was already gone), so nothing changed.
      if (!rows || !rows.length) throw errOf("tk_forbidden", "forbidden");
      afterChildWrite(taskId, "tk_followers");
      return true;
    });
  };

  // ---- Attachments ---------------------------------------------------------

  api.listAttachments = function (taskId) {
    return run(function (c) {
      return c
        .from("tk_attachments")
        .select(ATTACH_COLS)
        .eq("task_id", taskId)
        .is("removed_at", null)
        .order("created_at", { ascending: true });
    }, { where: "listAttachments" }).then(function (rows) { return rows || []; });
  };

  api.addLink = function (taskId, link) {
    var off = requireOnline();
    if (off) return off;
    var url = String((link && link.url) || "").trim();
    if (!/^https:\/\//i.test(url) || url.length > 2000) {
      return Promise.reject(errOf("22023", "Use a link that starts with https://"));
    }
    var name = String((link && link.name) || "").trim() || url;
    return run(function (c) {
      return c
        .from("tk_attachments")
        .insert({ task_id: taskId, kind: "link", url: url, name: name.slice(0, 255) })
        .select(ATTACH_COLS)
        .single();
    }, { where: "addLink" }).then(function (row) {
      afterChildWrite(taskId, "tk_attachments");
      return row;
    });
  };

  function newUuid() {
    try {
      if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    } catch (e) {}
    var h = "";
    for (var i = 0; i < 32; i++) h += Math.floor(Math.random() * 16).toString(16);
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-4" + h.slice(13, 16) + "-a" + h.slice(17, 20) + "-" + h.slice(20, 32);
  }

  function attachmentPath(taskId, id, fileName) {
    if (typeof TK_attachmentPath === "function") return TK_attachmentPath(taskId, id, fileName);
    var safe = String(fileName || "file").replace(/[^A-Za-z0-9._-]/g, "-").slice(-100);
    return taskId + "/" + id + "-" + safe;
  }

  // Client task: the file goes to the client's Drive, then it is linked.
  // No client: the private task-files bucket.
  api.uploadFile = function (task, file) {
    var off = requireOnline();
    if (off) return off;
    if (!task || !task.id || !file) return Promise.reject(errOf("22023", "No file"));
    if (typeof TK_validateAttachment === "function") {
      var msg = TK_validateAttachment(file);
      if (msg) return Promise.reject(errOf("22023", msg));
    }
    if (task.client_id) {
      if (typeof DRV_upload !== "function") return Promise.reject(errOf("drive_not_connected", "Drive is not available"));
      return Promise.resolve()
        .then(function () { return DRV_upload({ file: file, clientId: task.client_id, visibility: "internal" }); })
        .then(function (res) {
          var fileId = res && res.file && res.file.id;
          if (!fileId) throw errOf("drive_not_connected", "Drive did not return a file");
          return run(function (c) {
            return c.rpc("tk_attach_client_file", { p_task: task.id, p_file: fileId });
          }, { where: "attachClientFile" });
        })
        .then(function (attId) {
          afterChildWrite(task.id, "tk_attachments");
          return run(function (c) {
            return c.from("tk_attachments").select(ATTACH_COLS).eq("id", attId).maybeSingle();
          }, { where: "getAttachment" }).then(
            function (row) { return row || { id: attId, task_id: task.id, kind: "drive", name: file.name }; },
            function () { return { id: attId, task_id: task.id, kind: "drive", name: file.name }; },
          );
        });
    }
    var path = attachmentPath(task.id, newUuid(), file.name);
    var client = db();
    if (!client) return Promise.reject(errOf("tk_schema_missing", "No database client"));
    return Promise.resolve()
      .then(function () {
        return client.storage.from("task-files").upload(path, file, { contentType: file.type || undefined, upsert: false });
      })
      .then(function (res) {
        if (res && res.error) return fail(res.error, { where: "upload" });
        return run(function (c) {
          return c
            .from("tk_attachments")
            .insert({
              task_id: task.id,
              kind: "file",
              storage_path: path,
              name: String(file.name || "file").slice(0, 255),
              size: file.size == null ? null : file.size,
              mime: file.type || null,
            })
            .select(ATTACH_COLS)
            .single();
        }, { where: "addFile" });
        // If this insert fails the stored file stays: the bucket has no delete
        // policy on purpose (files are never removed). The same check gates
        // both steps, so this only happens on a race; see the spec's open items.
      })
      .then(function (row) {
        afterChildWrite(task.id, "tk_attachments");
        return row;
      });
  };

  api.openAttachment = function (att) {
    if (!att) return Promise.reject(errOf("tk_not_found", "No attachment"));
    if (att.kind === "link") return Promise.resolve(att.url);
    if (att.kind === "drive") {
      if (typeof DRV_link !== "function") return Promise.reject(errOf("drive_not_connected", "Drive is not available"));
      return Promise.resolve().then(function () { return DRV_link(att.client_file_id); });
    }
    var client = db();
    if (!client) return Promise.reject(errOf("tk_schema_missing", "No database client"));
    return Promise.resolve()
      .then(function () { return client.storage.from("task-files").createSignedUrl(att.storage_path, 60); })
      .then(function (res) {
        if (res && res.error) return fail(res.error, { where: "openAttachment" });
        return res && res.data ? res.data.signedUrl : null;
      });
  };

  api.removeAttachment = function (id) {
    var off = requireOnline();
    if (off) return off;
    return run(function (c) {
      return c.from("tk_attachments").update({ removed_at: nowIso() }).eq("id", id).select(ATTACH_COLS);
    }, { where: "removeAttachment" }).then(function (rows) {
      var row = Array.isArray(rows) ? rows[0] : rows;
      if (!row) throw errOf("tk_forbidden", "forbidden");
      afterChildWrite(row.task_id, "tk_attachments");
      return row;
    });
  };

  // ---- Search, mentions, people --------------------------------------------

  api.search = function (q, limit) {
    var text = String(q || "").trim();
    if (!text) return Promise.resolve([]);
    if (text.length > 200) text = text.slice(0, 200);
    return run(function (c) {
      return c.rpc("tk_search", { q: text, p_limit: limit || 20 });
    }, { where: "search" }).then(function (rows) { return rows || []; });
  };

  api.listMentions = function (email, opts) {
    var who = lower(email || me());
    if (!who) return Promise.resolve([]);
    var days = opts && opts.sinceDays != null ? Number(opts.sinceDays) : 14;
    var since = new Date(Date.now() - days * 86400000).toISOString();
    return run(function (c) {
      return c
        .from("tk_comments")
        .select(COMMENT_COLS)
        .contains("mentions", [who])
        .neq("author_email", who)
        .is("deleted_at", null)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(30);
    }, { where: "listMentions" }).then(function (comments) {
      var list = comments || [];
      var ids = [];
      list.forEach(function (cm) { if (ids.indexOf(cm.task_id) < 0) ids.push(cm.task_id); });
      if (!ids.length) return [];
      return run(function (c) {
        return c.from("tk_tasks").select(TK_TASK_COLS).in("id", ids);
      }, { where: "listMentionTasks" }).then(function (rows) {
        var byId = {};
        (rows || []).forEach(function (r) { var t = normalize(r); byId[t.id] = t; });
        return list.filter(function (cm) { return byId[cm.task_id]; }).map(function (cm) {
          return { comment: cm, task: byId[cm.task_id] };
        });
      });
    });
  };

  api.clientPeople = function (clientId) {
    if (!clientId) return Promise.resolve([]);
    return run(function (c) {
      return c.rpc("tk_client_people", { p_client: String(clientId) });
    }, { where: "clientPeople" }).then(function (rows) { return rows || []; });
  };

  api.assignable = function (scope) {
    var s = scope || {};
    return run(function (c) {
      return c.rpc("tk_assignable_staff", { p_client: s.clientId ? String(s.clientId) : null, p_project: s.projectId || null });
    }, { where: "assignable" }).then(function (rows) {
      return (rows || []).map(function (r) { return Object.assign({}, r, { email: lower(r.email) }); });
    });
  };

  // Active staff, cached for the session. { force: true } reloads.
  api.listStaff = function (opts) {
    if (staffCache && !(opts && opts.force)) return staffCache;
    var p = run(function (c) {
      return c.from("staff").select(STAFF_COLS).eq("active", true).order("name", { ascending: true });
    }, { where: "listStaff" }).then(
      function (rows) {
        var list = (rows || []).map(function (r) { return Object.assign({}, r, { email: lower(r.email) }); });
        dispatch({ type: "staff", staff: list });
        return list;
      },
      function (e) {
        staffCache = null;
        throw e;
      },
    );
    staffCache = p;
    return p;
  };

  // ---- Projects --------------------------------------------------------------

  function putProject(row) {
    var s = store();
    if (!s || !row) return;
    var list = (s.getState().projects || []).slice();
    var i = -1;
    for (var j = 0; j < list.length; j++) if (list[j].id === row.id) i = j;
    if (i >= 0) list[i] = row;
    else list.push(row);
    dispatch({ type: "projects", projects: list });
  }

  api.listProjects = function () {
    return run(function (c) {
      return c.from("tk_projects").select(PROJECT_COLS).order("name", { ascending: true });
    }, { where: "listProjects" }).then(function (rows) {
      var list = rows || [];
      dispatch({ type: "projects", projects: list });
      return list;
    });
  };

  api.createProject = function (fields) {
    var off = requireOnline();
    if (off) return off;
    var f = fields || {};
    var name = String(f.name || "").trim();
    if (!name) return Promise.reject(errOf("22023", "Add a name"));
    var kind = f.kind === "onboarding" ? "onboarding" : "internal";
    var row = {
      name: name.slice(0, 120),
      kind: kind,
      client_id: kind === "onboarding" ? f.client_id || null : null,
      sections: Array.isArray(f.sections)
        ? f.sections.map(function (x) { return String(x).trim(); }).filter(Boolean).slice(0, 30)
        : [],
    };
    if (f.open_to_staff === true) row.open_to_staff = true; // the server keeps it only for admins
    return run(function (c) {
      return c.from("tk_projects").insert(row).select(PROJECT_COLS).single();
    }, { where: "createProject", uniqueAs: "tk_name_taken" }).then(function (p) {
      putProject(p);
      afterWrite(null, { legacy: false });
      return p;
    });
  };

  api.updateProject = function (id, patch) {
    var off = requireOnline();
    if (off) return off;
    var clean = pick(patch || {}, PROJECT_UPDATE_FIELDS);
    if (clean.name != null) clean.name = String(clean.name).trim().slice(0, 120);
    return run(function (c) {
      return c.from("tk_projects").update(clean).eq("id", id).select(PROJECT_COLS);
    }, { where: "updateProject", uniqueAs: "tk_name_taken" }).then(function (rows) {
      var p = Array.isArray(rows) ? rows[0] : rows;
      if (!p) throw errOf("tk_forbidden", "forbidden");
      putProject(p);
      afterWrite(null, { legacy: false });
      return p;
    });
  };

  api.archiveProject = function (id) {
    return api.updateProject(id, { archived_at: nowIso() });
  };

  api.listMembers = function (projectId) {
    return run(function (c) {
      return c.from("tk_project_members").select(MEMBER_COLS).eq("project_id", projectId).order("added_at", { ascending: true });
    }, { where: "listMembers" }).then(function (rows) { return rows || []; });
  };

  api.addMember = function (projectId, email, role) {
    var off = requireOnline();
    if (off) return off;
    var who = lower(email);
    var r = role === "owner" ? "owner" : "member";
    return run(function (c) {
      return c.from("tk_project_members").insert({ project_id: projectId, staff_email: who, role: r }).select(MEMBER_COLS).single();
    }, { where: "addMember", uniqueAs: "tk_already" }).catch(function (e) {
      if (!e || e.code !== "tk_already") throw e;
      // Already a member: set the role instead.
      return run(function (c) {
        return c
          .from("tk_project_members")
          .update({ role: r })
          .eq("project_id", projectId)
          .eq("staff_email", who)
          .select(MEMBER_COLS)
          .maybeSingle();
      }, { where: "updateMember" });
    });
  };

  api.removeMember = function (projectId, email) {
    var off = requireOnline();
    if (off) return off;
    return run(function (c) {
      return c.from("tk_project_members").delete().eq("project_id", projectId).eq("staff_email", lower(email)).select("project_id");
    }, { where: "removeMember" }).then(function (rows) {
      // 0 rows: RLS refused it, so nothing changed.
      if (!rows || !rows.length) throw errOf("tk_forbidden", "forbidden");
      return true;
    });
  };

  // ---- Client header (row 1.2) ---------------------------------------------
  // Every piece is null (or []) when its read is denied or fails.

  api.clientHeader = function (clientId) {
    var client = db();
    var id = clientId == null ? "" : String(clientId);
    if (!client || !id) return Promise.resolve({ qbo: null, driveFolderId: null, contacts: [] });
    function soft(build) {
      return Promise.resolve()
        .then(function () { return build(client); })
        .then(
          function (res) { return res && !res.error ? res.data : null; },
          function () { return null; },
        );
    }
    return Promise.all([
      soft(function (c) { return c.from("qbo_connections").select("status").eq("client_id", id).maybeSingle(); }),
      soft(function (c) {
        return c.from("drive_folders").select("drive_folder_id").eq("client_id", id).is("year", null).is("doc_type", null).limit(1);
      }),
      soft(function (c) { return c.from("client_users").select("email, name, role, active").eq("client_id", id); }),
      soft(function (c) { return c.from("client_email_recipients").select("email, opted_out_at").eq("client_id", id); }),
      soft(function (c) { return c.from("client_email_prefs").select("summary_recipients").eq("client_id", id).maybeSingle(); }),
    ]).then(function (r) {
      var qbo = r[0] ? { status: r[0].status || null } : null;
      var folders = Array.isArray(r[1]) ? r[1] : r[1] ? [r[1]] : [];
      var driveFolderId = folders.length && folders[0].drive_folder_id ? folders[0].drive_folder_id : null;
      var optedOut = {};
      (Array.isArray(r[3]) ? r[3] : []).forEach(function (x) { if (x && x.opted_out_at) optedOut[lower(x.email)] = true; });
      var sr = r[4] ? r[4].summary_recipients : null;
      // null summary_recipients means "everyone gets the summary".
      var summarySet = Array.isArray(sr) ? sr.map(lower) : null;
      var contacts = (Array.isArray(r[2]) ? r[2] : []).map(function (u) {
        var em = lower(u.email);
        return {
          email: em,
          name: u.name || "",
          role: u.role || null,
          active: u.active !== false,
          optedOut: !!optedOut[em],
          summary: summarySet ? summarySet.indexOf(em) >= 0 : u.active !== false,
        };
      });
      return { qbo: qbo, driveFolderId: driveFolderId, contacts: contacts };
    });
  };

  // ---- Recurring templates (Tasks Phase 2, S4) -------------------------------
  // Reads are RLS (admins see every template; staff see firm-wide ones and
  // ones for a client they can reach). Every write is an RPC in
  // supabase/tasks-p2-4-recurring.sql; the server decides who may call it.

  var TPL_COLS =
    "id, title, cadence, due_offset_days, due_rule, lead_days, plan_tiers, client_ids, priority, active, status, checklist, " +
    "assignee_role, review_required, sop_section, estimate_minutes, period_basis, template_set_id, close_key, activated_at, " +
    "source, created_by, created_at, updated_by";

  function rpcWrite(name, args, where) {
    var off = requireOnline();
    if (off) return off;
    return run(function (c) {
      return c.rpc(name, args);
    }, { where: where });
  }

  api.listTemplates = function () {
    return run(function (c) {
      return c.from("task_templates").select(TPL_COLS).order("created_at", { ascending: true }).limit(1000);
    }, { where: "listTemplates" }).then(function (rows) { return rows || []; });
  };

  api.listTemplateSets = function () {
    return run(function (c) {
      return c.from("tk_template_sets").select("id, name, is_standard, deleted_at, live_since").order("name", { ascending: true });
    }, { where: "listTemplateSets" }).then(function (rows) { return rows || []; });
  };

  // template id -> how many periods it has created (all clients you can see).
  api.templateIssuedCounts = function () {
    return run(function (c) {
      return c.from("task_template_issued").select("template_id").limit(10000);
    }, { where: "templateIssuedCounts" }).then(function (rows) {
      var counts = {};
      (rows || []).forEach(function (r) { counts[r.template_id] = (counts[r.template_id] || 0) + 1; });
      return counts;
    });
  };

  // Create (id null, always a draft) or edit. Resolves with the id.
  api.saveTemplate = function (id, payload) {
    return rpcWrite("tk_save_template", { p_id: id || null, p_tpl: payload }, "saveTemplate");
  };

  // action: activate | pause | resume | retire | draft
  api.setTemplateStatus = function (id, action) {
    return rpcWrite("tk_set_template_status", { p_id: id, p_action: action }, "setTemplateStatus");
  };

  api.listOverrides = function (clientId) {
    if (!clientId) return Promise.resolve([]);
    return run(function (c) {
      return c
        .from("tk_client_template_overrides")
        .select("template_id, skip, override, updated_by, updated_at")
        .eq("client_id", String(clientId));
    }, { where: "listOverrides" }).then(function (rows) { return rows || []; });
  };

  api.setClientOverride = function (clientId, templateId, skip, override) {
    return rpcWrite(
      "tk_set_client_override",
      { p_client_id: String(clientId), p_template_id: templateId, p_skip: !!skip, p_override: override || {} },
      "setClientOverride",
    );
  };

  // Dry run: what the next run would create, plus the next `days` days.
  // A client needs access; all clients or one template needs an admin.
  api.generatePreview = function (clientId, days, templateId) {
    return run(function (c) {
      return c.rpc("tk_generate_preview", {
        p_client_id: clientId ? String(clientId) : null,
        p_days: days == null ? 30 : days,
        p_template_id: templateId || null,
      });
    }, { where: "generatePreview" });
  };

  // A real run now (admins). clientId limits it to one client.
  api.generateNow = function (clientId) {
    return rpcWrite("tk_generate", { p_today: null, p_dry_run: false, p_client_id: clientId ? String(clientId) : null, p_horizon_days: null }, "generateNow");
  };

  api.listRuns = function (limit) {
    return run(function (c) {
      return c
        .from("tk_generator_runs")
        .select("id, ran_at, p_today, trigger, ran_by, created, skipped, missed, result")
        .order("ran_at", { ascending: false })
        .limit(limit || 15);
    }, { where: "listRuns" }).then(function (rows) { return rows || []; });
  };

  // Open missed periods (admins): neither created nor dismissed.
  api.listMissed = function () {
    return run(function (c) {
      return c
        .from("tk_generate_missed")
        .select("template_id, client_id, period_start, due_date, label, first_seen_at")
        .is("dismissed_at", null)
        .is("issued_at", null)
        .order("due_date", { ascending: true })
        .limit(300);
    }, { where: "listMissed" }).then(function (rows) { return rows || []; });
  };

  api.issueMissed = function (templateId, clientId, periodStart) {
    return rpcWrite("tk_issue_missed", { p_template_id: templateId, p_client_id: String(clientId), p_period_start: periodStart }, "issueMissed");
  };

  api.dismissMissed = function (templateId, clientId, periodStart) {
    return rpcWrite("tk_dismiss_missed", { p_template_id: templateId, p_client_id: String(clientId), p_period_start: periodStart }, "dismissMissed");
  };

  // Firm-closed days as 'YYYY-MM-DD' (the preview's business-day maths).
  api.holidays = function () {
    return run(function (c) {
      return c.from("tk_holidays").select("day").eq("firm_closed", true).order("day", { ascending: true }).limit(2000);
    }, { where: "holidays" }).then(function (rows) {
      return (rows || []).map(function (r) { return String(r.day).slice(0, 10); });
    });
  };

  // tk_settings as { key: value }.
  api.getSettings = function () {
    return run(function (c) {
      return c.from("tk_settings").select("key, value, updated_by, updated_at");
    }, { where: "getSettings" }).then(function (rows) {
      var out = {};
      (rows || []).forEach(function (r) { out[r.key] = r.value; });
      return out;
    });
  };

  // Owner-only keys (standard_set_live …) are refused for anyone else
  // (tk_owner_only); every change is audited.
  api.setSetting = function (key, value) {
    var off = requireOnline();
    if (off) return off;
    return run(function (c) {
      return c.from("tk_settings").upsert({ key: key, value: value }, { onConflict: "key" });
    }, { where: "setSetting" });
  };

  api.clientFiscalYearEnd = function (clientId) {
    if (!clientId) return Promise.resolve(null);
    return run(function (c) {
      return c.from("client_profile").select("fiscal_year_end").eq("client_id", String(clientId)).maybeSingle();
    }, { where: "clientFiscalYearEnd" }).then(function (row) { return row ? row.fiscal_year_end || null : null; });
  };

  // "Save as template" suggestions from staff (admins resolve them).
  api.listSuggestions = function () {
    return run(function (c) {
      return c
        .from("task_template_suggestions")
        .select("id, title, priority, client_id, suggested_by, created_at")
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(50);
    }, { where: "listSuggestions" }).then(function (rows) { return rows || []; });
  };

  // patch: { status: 'dismissed' } or { status: 'created', template_id }.
  api.resolveSuggestion = function (id, patch) {
    var off = requireOnline();
    if (off) return off;
    return run(function (c) {
      return c.from("task_template_suggestions").update(patch).eq("id", id);
    }, { where: "resolveSuggestion" }).then(function () {
      try { window.dispatchEvent(new Event("mgb:staff-tools-changed")); } catch (e) {}
      return true;
    });
  };

  // ---- Ask client (Tasks Phase 2, S5) ----------------------------------------
  // Every write is an RPC in supabase/tasks-p2-5-requests.sql (staff cannot
  // write client_requests or client_contacts directly). Sending is a dry run
  // until S6: nothing is emailed and the result says dry_run.

  function afterRequestWrite(taskId) {
    try { window.dispatchEvent(new CustomEvent("mgb:tk-requests-changed", { detail: { taskId: taskId || null } })); } catch (e) {}
    if (!taskId) return Promise.resolve(null);
    return refresh(taskId).then(function (t) {
      if (t) afterWrite({ type: "upsert", task: t });
      afterChildWrite(taskId, "client_requests");
      return t;
    });
  }

  // { portal: [{email, name, role, opted_out}], contacts: [{id, name, email, role, can_answer, notes}] }
  api.requestRecipients = function (clientId) {
    return run(function (c) {
      return c.rpc("tk_request_recipients", { p_client_id: String(clientId) });
    }, { where: "requestRecipients" }).then(function (r) { return r || { portal: [], contacts: [] }; });
  };

  api.saveClientContact = function (id, clientId, fields) {
    var f = fields || {};
    return rpcWrite("tk_save_client_contact", {
      p_id: id || null, p_client_id: clientId ? String(clientId) : null, p_name: f.name || "", p_email: f.email || "",
      p_role: f.role || null, p_can_answer: f.can_answer !== false, p_notes: f.notes || null,
    }, "saveClientContact");
  };

  api.retireClientContact = function (id) {
    return rpcWrite("tk_retire_client_contact", { p_id: id }, "retireClientContact");
  };

  // req: { clientId, taskId, title, prompt, kind, needsUpload, dueDate, emails[], contactIds[] }
  api.askClient = function (req) {
    var r = req || {};
    return rpcWrite("tk_ask_client", {
      p_client_id: String(r.clientId || ""), p_task_id: r.taskId || null, p_title: r.title || "", p_prompt: r.prompt || "",
      p_kind: r.kind || "question", p_needs_upload: !!r.needsUpload, p_due_date: r.dueDate || null,
      p_recipient_emails: r.emails || [], p_contact_ids: r.contactIds || [],
    }, "askClient").then(function (id) {
      return afterRequestWrite(r.taskId).then(function () { return id; });
    });
  };

  // action: preview | send | resend | nudge; target: one contact id or portal
  // email (optional). Resolves { mode, dry_run, sent, recipients, subject }.
  // S6: the tk-client-requests edge function sends (test clients: one copy to
  // you; live only once the owner turns on client_request_enabled). Until it
  // is deployed (404) or when it can't be reached, the RPC answers instead:
  // a dry run that sends nothing.
  function sendViaRpc(id, action, target) {
    return rpcWrite("tk_client_request_send", { p_id: id, p_action: action, p_target: target || null }, "sendClientRequest");
  }
  api.sendClientRequest = function (id, action, taskId, target) {
    var act = action || "send";
    var off = requireOnline();
    if (off) return off;
    var c = db();
    var p;
    if (!c || !c.functions || typeof c.functions.invoke !== "function") p = sendViaRpc(id, act, target);
    else {
      p = Promise.resolve()
        .then(function () {
          return c.functions.invoke("tk-client-requests", { body: { action: act, request_id: id, target: target || null } });
        })
        .then(function (res) {
          if (res && !res.error) return res.data || {};
          var resp = res && res.error && res.error.context;
          var status = resp && resp.status;
          if (!status || status === 404) return sendViaRpc(id, act, target);
          return Promise.resolve(resp && typeof resp.json === "function" ? resp.json().catch(function () { return {}; }) : {})
            .then(function (b) {
              if (b && Number(b.sent) > 0) return b;
              var code = "tk_" + String((b && b.error) || "send_failed").replace(/[^a-z_]/g, "");
              throw errOf(code, code, { reason: code });
            });
        }, function () {
          return sendViaRpc(id, act, target);
        });
    }
    return p.then(function (res) {
      if (act !== "preview") afterRequestWrite(taskId);
      return res;
    });
  };

  api.listClientRequests = function (taskId, clientId) {
    return run(function (c) {
      return c.rpc("tk_list_client_requests", { p_task_id: taskId || null, p_client_id: clientId ? String(clientId) : null });
    }, { where: "listClientRequests" }).then(function (rows) { return rows || []; });
  };

  api.waitingOnClient = function (clientId) {
    return run(function (c) {
      return c.rpc("tk_waiting_on_client", { p_client_id: clientId ? String(clientId) : null });
    }, { where: "waitingOnClient" }).then(function (rows) { return rows || []; });
  };

  api.cancelClientRequest = function (id, reason, taskId) {
    return rpcWrite("tk_cancel_client_request", { p_id: id, p_reason: reason || null }, "cancelClientRequest")
      .then(function () { return afterRequestWrite(taskId); });
  };

  api.acceptClientRequest = function (id, taskId) {
    return rpcWrite("tk_accept_client_request", { p_id: id }, "acceptClientRequest")
      .then(function () { return afterRequestWrite(taskId); });
  };

  api.recordClientAnswer = function (id, reply, taskId) {
    return rpcWrite("tk_record_client_answer", { p_id: id, p_reply: reply || "" }, "recordClientAnswer")
      .then(function () { return afterRequestWrite(taskId); });
  };

  api.revokeRequestLinks = function (id, taskId) {
    return rpcWrite("tk_revoke_request_tokens", { p_request_id: id, p_reason: "staff" }, "revokeRequestLinks")
      .then(function (n) { afterRequestWrite(taskId); return n; });
  };

  api.setRequestNudgePaused = function (id, paused, taskId) {
    return rpcWrite("tk_set_request_nudge_paused", { p_id: id, p_paused: !!paused }, "setRequestNudgePaused")
      .then(function () { return afterRequestWrite(taskId); });
  };

  // ---- Out-of-office hand-off (Tasks Phase 2, S7) ---------------------------
  // supabase/tasks-p2-7-ooo.sql. The server decides who may call: the person
  // who is out or an admin; only admins pass overrides ({ client_id: email })
  // and only an admin hand-off gives the backup access to a client.
  // Resolves { dry_run, owner, owner_name, starts_on, ends_on, move[], skip[] }.
  api.oooPreview = function (timeOffId, overrides) {
    return run(function (c) {
      return c.rpc("tk_apply_ooo", { p_time_off_id: timeOffId, p_dry_run: true, p_overrides: overrides || {} });
    }, { where: "oooPreview" });
  };
  api.oooApply = function (timeOffId, overrides) {
    return rpcWrite("tk_apply_ooo", { p_time_off_id: timeOffId, p_dry_run: false, p_overrides: overrides || {} }, "oooApply")
      .then(function (res) { return refreshAfterOoo(res && res.move).then(function () { return res; }); });
  };
  // Hands every covered task back now. Resolves { returned[], left[] }.
  api.oooReturn = function (timeOffId) {
    return rpcWrite("tk_return_ooo", { p_time_off_id: timeOffId, p_dry_run: false }, "oooReturn")
      .then(function (res) { return refreshAfterOoo(res && res.returned).then(function () { return res; }); });
  };
  // Open hand-offs that involve me (admins: everyone's).
  api.myCoverage = function () {
    return run(function (c) {
      return c.rpc("tk_my_coverage");
    }, { where: "myCoverage" }).then(function (rows) { return rows || []; });
  };
  // Re-reads the tasks that changed hands so lists update now (other tabs and
  // people get them through realtime).
  function refreshAfterOoo(list) {
    try { window.dispatchEvent(new CustomEvent("mgb:tk-coverage-changed")); } catch (e) {}
    var ids = (list || []).map(function (x) { return x && x.task_id; }).filter(Boolean).slice(0, 50);
    return Promise.all(ids.map(function (id) {
      return refresh(id).then(function (t) { if (t) afterWrite({ type: "upsert", task: t }); });
    })).catch(function () {});
  }

  // ---- Exposed for TK_sync and tests ----------------------------------------
  api.normalize = normalize;
  api._client = null; // tests inject a stub client here
  api._reset = function () {
    probeState.value = "unknown";
    probeState.promise = null;
    probeState.at = 0;
    if (probeState.retryTimer) {
      try { clearTimeout(probeState.retryTimer); } catch (e) {}
    }
    probeState.retryTimer = null;
    completing = {};
    staffCache = null;
  };

  return api;
})();
