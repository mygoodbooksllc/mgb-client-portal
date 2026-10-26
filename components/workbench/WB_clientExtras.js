// ----------------------------------------------------------------------------
// WB_clientExtras: data for the Desk Client tab's three read-only sections
// (Desk additions S2, docs/workbench-hub-spec.md 3.2): Waiting on client,
// recent messages and recent files. Hidden behind the Desk additions gate
// (WB_plus.js); WB_HubClientExtras in WB_HubClient.jsx draws them and only
// mounts while the gate is on and a client I can open is chosen.
//
// Exactly three reads per client, in parallel, under my own login (RLS):
//   waiting   rpc tk_waiting_on_client({ p_client_id })   (definer: active
//             staff + can_access_client per row; task fields come back null
//             when I can't read the task, e.g. someone else's private task)
//   messages  client_messages  eq client_id, eq internal false, is deleted_at
//             null, order created_at desc, limit 5
//   files     client_files     eq client_id, is trashed_at null, order
//             uploaded_at desc, limit 5
// The rpc is called directly (same call as TK_api.waitingOnClient) so a
// failure is one request: TK_api's error path can re-probe the schema and log,
// which would be extra calls.
//
// Defense in depth: whatever the server sends, the shapers drop internal
// notes, deleted messages, trashed files and rows for another client, and a
// waiting row whose task I can't read keeps no task fields at all (it opens
// Waiting on client instead of a task).
//
// Stale replies: WB_cxSeq() hands out a token per section load; a client
// switch (reset) or a newer load of the same section makes older tokens
// stale, and WB_cxFetch never applies a stale reply.
//
// Browser file (plain JS, no JSX); loads after WB_plus.js. Node test:
// components/workbench/WB_clientExtras.test.js.
// ----------------------------------------------------------------------------

var WB_CX_LIMIT = 5; // messages and files per client
var WB_CX_TRIM = 140; // message preview length, ellipsis included
var WB_CX_WAIT_CAP = 10; // waiting rows shown before "See all"
var WB_CX_SECTIONS = ["waiting", "messages", "files"];
var WB_CX_MSG_COLS = "id, client_id, participant_email, author_kind, author_name, body, created_at, internal, deleted_at";
var WB_CX_FILE_COLS = "id, client_id, name, mime, uploaded_at, uploaded_by, drive_file_id, trashed_at";
var WB_CX_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function WB__cxStr(v) {
  return v == null ? "" : String(v);
}
function WB__cxDate(iso) {
  if (!iso) return null;
  var d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

// One line, at most max characters (default 140) including the ellipsis.
function WB_cxTrim(text, max) {
  var m = typeof max === "number" && max > 1 ? max : WB_CX_TRIM;
  var s = WB__cxStr(text).replace(/\s+/g, " ").trim();
  if (s.length <= m) return s;
  return s.slice(0, m - 1).replace(/\s+$/, "") + "…";
}

// "Oct 3", or "Oct 3, 2025" outside the current year (local time).
function WB_cxShortDate(iso, now) {
  var d = WB__cxDate(iso);
  if (!d) return "";
  var n = now instanceof Date ? now : new Date();
  var s = WB_CX_MONTHS[d.getMonth()] + " " + d.getDate();
  return d.getFullYear() === n.getFullYear() ? s : s + ", " + d.getFullYear();
}

// "Just now", "5 min ago", "3 hr ago", "Yesterday", else the short date.
function WB_cxWhen(iso, now) {
  var d = WB__cxDate(iso);
  if (!d) return "";
  var n = now instanceof Date ? now : new Date();
  var ms = n.getTime() - d.getTime();
  if (ms >= 0 && ms < 60000) return "Just now";
  if (ms >= 0 && ms < 3600000) return Math.floor(ms / 60000) + " min ago";
  var day0 = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
  if (d.getTime() >= day0 && ms >= 0) return Math.floor(ms / 3600000) + " hr ago";
  if (d.getTime() >= day0 - 864e5 && d.getTime() < day0) return "Yesterday";
  return WB_cxShortDate(iso, n);
}

// Reminder state in plain words: "No reply", "Reminders paused",
// "Reminded once" / "Reminded 3 times", joined with " · "; "" when none.
function WB_cxNudgeLabel(r) {
  var x = r || {};
  var out = [];
  if (x.no_reply === true) out.push("No reply");
  if (x.nudge_paused === true) out.push("Reminders paused");
  var n = Number(x.nudge_count) || 0;
  if (n === 1) out.push("Reminded once");
  else if (n > 1) out.push("Reminded " + n + " times");
  return out.join(" · ");
}

// "1 business day" / "4 business days"; "" for 0 or unknown.
function WB_cxDaysLabel(days) {
  var n = Number(days);
  if (!isFinite(n) || n < 1) return "";
  n = Math.floor(n);
  return n + (n === 1 ? " business day" : " business days");
}

function WB__cxSameClient(row, clientId) {
  return !!row && row.client_id != null && String(row.client_id) === String(clientId);
}

// One waiting row, or null. A row whose task I can't read (task_id null)
// carries no task fields: no title, no owner, no due date, and it routes to
// Waiting on client ("requests"), never to a task.
function WB_cxWaitingRow(r, clientId) {
  if (!r || (clientId != null && !WB__cxSameClient(r, clientId))) return null;
  var hasTask = r.task_id != null && r.task_id !== "";
  var isRequest = r.request_id != null && r.request_id !== "";
  if (!isRequest && !hasTask) return null;
  var label = isRequest ? WB_cxTrim(r.request_title, 120) || "Untitled request" : WB_cxTrim(r.title, 120) || "Untitled task";
  var days = Number(r.business_days_waiting);
  return {
    key: isRequest ? "rq:" + String(r.request_id) : "tk:" + String(r.task_id),
    kind: isRequest ? "request" : "task",
    label: label,
    askedAt: isRequest && r.asked_at ? String(r.asked_at) : null,
    days: isFinite(days) ? days : null,
    nudge: isRequest ? WB_cxNudgeLabel(r) : "",
    // The task the request sits on, only when I can read it.
    taskTitle: isRequest && hasTask ? WB_cxTrim(r.title, 80) || null : null,
    taskId: hasTask ? String(r.task_id) : null,
    route: hasTask ? "task" : "requests",
  };
}

// Longest wait first, then the oldest ask; one row per key.
function WB_cxWaitingRows(rows, clientId) {
  var seen = {};
  var out = [];
  (Array.isArray(rows) ? rows : []).forEach(function (r) {
    var x = WB_cxWaitingRow(r, clientId);
    if (!x || seen[x.key]) return;
    seen[x.key] = true;
    out.push(x);
  });
  out.sort(function (a, b) {
    var d = (Number(b.days) || 0) - (Number(a.days) || 0);
    if (d) return d;
    var ta = a.askedAt ? Date.parse(a.askedAt) || 0 : 0;
    var tb = b.askedAt ? Date.parse(b.askedAt) || 0 : 0;
    return ta - tb || a.label.localeCompare(b.label);
  });
  return out;
}

// Only a message the client can see: internal strictly false (a row without
// the field is dropped too), not deleted, this client.
function WB_cxVisibleMessage(m, clientId) {
  return !!m && m.internal === false && m.deleted_at == null && WB__cxSameClient(m, clientId);
}

function WB_cxMessageRows(rows, clientId) {
  var list = (Array.isArray(rows) ? rows : []).filter(function (m) {
    return WB_cxVisibleMessage(m, clientId) && m.id != null;
  });
  list.sort(function (a, b) {
    return (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0);
  });
  return list.slice(0, WB_CX_LIMIT).map(function (m) {
    var staff = m.author_kind === "staff";
    var text = WB_cxTrim(m.body);
    return {
      key: "msg:" + String(m.id),
      id: String(m.id),
      who: WB_cxTrim(m.author_name, 60) || (staff ? "MyGoodBooks" : WB__cxStr(m.participant_email) || "Client"),
      kindLabel: staff ? "Staff" : "Client",
      email: m.participant_email ? String(m.participant_email) : null,
      at: m.created_at ? String(m.created_at) : null,
      text: text || "(attachment)",
      attachmentOnly: !text,
    };
  });
}

// A short type word from the mime type or the file name.
function WB_cxFileKind(mime, name) {
  var m = WB__cxStr(mime).toLowerCase();
  var ext = (/\.([a-z0-9]{1,5})$/i.exec(WB__cxStr(name)) || [])[1];
  ext = ext ? ext.toLowerCase() : "";
  if (m === "application/pdf" || ext === "pdf") return "PDF";
  if (m.indexOf("image/") === 0 || /^(png|jpe?g|gif|heic|webp|tiff?)$/.test(ext)) return "Image";
  if (/spreadsheet|excel|csv/.test(m) || /^(xlsx?|csv|ods)$/.test(ext)) return "Spreadsheet";
  if (/word|document|rtf|text\/plain/.test(m) || /^(docx?|rtf|txt|odt)$/.test(ext)) return "Document";
  if (/zip|compressed/.test(m) || ext === "zip") return "Zip";
  return "File";
}

function WB_cxVisibleFile(f, clientId) {
  return !!f && f.trashed_at == null && WB__cxSameClient(f, clientId);
}

function WB_cxFileRows(rows, clientId) {
  var list = (Array.isArray(rows) ? rows : []).filter(function (f) {
    return WB_cxVisibleFile(f, clientId) && f.id != null;
  });
  list.sort(function (a, b) {
    return (Date.parse(b.uploaded_at) || 0) - (Date.parse(a.uploaded_at) || 0);
  });
  return list.slice(0, WB_CX_LIMIT).map(function (f) {
    return {
      key: "file:" + String(f.id),
      id: String(f.id),
      name: WB_cxTrim(f.name, 120) || "Untitled file",
      kind: WB_cxFileKind(f.mime, f.name),
      at: f.uploaded_at ? String(f.uploaded_at) : null,
      // DRV_link takes client_files.id; the server needs a Drive file behind it.
      inDrive: !!f.drive_file_id,
    };
  });
}

// ---- The reads ----
function WB__cxData(res) {
  if (!res) throw new Error("No reply");
  if (res.error) throw res.error;
  return Array.isArray(res.data) ? res.data : [];
}
function WB_cxQuery(sb, clientId, section) {
  var cid = String(clientId);
  if (section === "waiting") return sb.rpc("tk_waiting_on_client", { p_client_id: cid });
  if (section === "messages") {
    return sb
      .from("client_messages")
      .select(WB_CX_MSG_COLS)
      .eq("client_id", cid)
      .eq("internal", false)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(WB_CX_LIMIT);
  }
  if (section === "files") {
    return sb
      .from("client_files")
      .select(WB_CX_FILE_COLS)
      .eq("client_id", cid)
      .is("trashed_at", null)
      .order("uploaded_at", { ascending: false })
      .limit(WB_CX_LIMIT);
  }
  throw new Error("Unknown section " + section);
}
var WB__cxShape = { waiting: WB_cxWaitingRows, messages: WB_cxMessageRows, files: WB_cxFileRows };

// One section: a promise of shaped rows (rejects on an error).
function WB_cxLoadSection(sb, clientId, section) {
  if (!sb || clientId == null || clientId === "") return Promise.reject(new Error("No database or client"));
  return Promise.resolve()
    .then(function () {
      return WB_cxQuery(sb, clientId, section);
    })
    .then(function (res) {
      return WB__cxShape[section](WB__cxData(res), String(clientId));
    });
}

// All three at once: { waiting, messages, files }, each a promise.
function WB_loadClientExtras(sb, clientId) {
  return {
    waiting: WB_cxLoadSection(sb, clientId, "waiting"),
    messages: WB_cxLoadSection(sb, clientId, "messages"),
    files: WB_cxLoadSection(sb, clientId, "files"),
  };
}

// The sequence guard. reset() on a client switch makes every token stale;
// start(section) makes that section's older tokens stale (a Retry).
function WB_cxSeq() {
  var gen = 0;
  var per = {};
  return {
    reset: function () {
      gen += 1;
    },
    start: function (section) {
      per[section] = (per[section] || 0) + 1;
      return { g: gen, s: section, n: per[section] };
    },
    ok: function (tok) {
      return !!tok && tok.g === gen && per[tok.s] === tok.n;
    },
  };
}

// Loads sections (null = all three, a client switch: older replies are
// dropped) and calls apply(section, state) with state { clientId, status:
// "loading" | "ok" | "error", rows }. A stale reply is never applied.
// Resolves when every read has settled (for tests).
function WB_cxFetch(sb, clientId, seq, sections, apply) {
  var cid = String(clientId);
  var list = Array.isArray(sections) && sections.length ? sections : WB_CX_SECTIONS;
  if (!Array.isArray(sections) || !sections.length) seq.reset();
  var toks = {};
  list.forEach(function (sec) {
    toks[sec] = seq.start(sec);
    apply(sec, { clientId: cid, status: "loading", rows: null });
  });
  var all = list.length === WB_CX_SECTIONS.length ? WB_loadClientExtras(sb, cid) : null;
  return Promise.all(
    list.map(function (sec) {
      var p = all ? all[sec] : WB_cxLoadSection(sb, cid, sec);
      return p.then(
        function (rows) {
          if (seq.ok(toks[sec])) apply(sec, { clientId: cid, status: "ok", rows: rows });
        },
        function () {
          if (seq.ok(toks[sec])) apply(sec, { clientId: cid, status: "error", rows: null });
        },
      );
    }),
  );
}

// The Client tab's load rules as one pure step, so they can be tested.
// mem = {cid, loaded, dirty} (kept by the component across renders).
// WB_cxStep(mem, cid, showing) runs on every client / showing change and
// returns {reset, run}: reset = drop replies still in flight (another client);
// run = null | "all" | "waiting". Another client always forgets what was
// loaded, so going back to an earlier client while the tab was hidden reads
// again instead of keeping "Loading…" (its replies were dropped by the reset).
// WB_cxChanged(mem, showing) is the mgb:tk-requests-changed step: "waiting"
// to reload now, or null (marked dirty for when the tab shows again).
function WB_cxMem(cid) {
  return { cid: cid == null ? null : String(cid), loaded: null, dirty: false };
}
function WB_cxStep(mem, cid, showing) {
  var c = String(cid);
  var out = { reset: false, run: null };
  if (mem.cid !== c) {
    mem.cid = c;
    mem.loaded = null;
    mem.dirty = false;
    out.reset = true;
  }
  if (!showing) return out;
  if (mem.loaded === c) {
    if (mem.dirty) {
      mem.dirty = false;
      out.run = "waiting";
    }
    return out;
  }
  mem.loaded = c;
  mem.dirty = false;
  out.run = "all";
  return out;
}
function WB_cxChanged(mem, showing) {
  if (mem.loaded == null || mem.loaded !== mem.cid) return null;
  if (showing) return "waiting";
  mem.dirty = true;
  return null;
}

// ---- Desk additions S4: the + menu's pure rules (WB_QuickActions.jsx) ----

// The client picker that "Ask client..." shows off a client page. pool is
// WB_hubPickerPool(clients, showTest, null) (no MGB internal, no test client
// unless "Show test clients" is on); the query matches the name, case and
// spacing ignored, starts-with first, then contains; sorted by name.
function WB_quickPickFilter(pool, query) {
  var q = String(query == null ? "" : query).toLowerCase().replace(/\s+/g, " ").trim();
  var rows = (Array.isArray(pool) ? pool : []).filter(function (c) {
    return c && c.id != null && String(c.name || "").trim() !== "";
  });
  var key = function (c) {
    return String(c.name).toLowerCase().replace(/\s+/g, " ").trim();
  };
  var out = q
    ? rows.filter(function (c) {
        return key(c).indexOf(q) >= 0;
      })
    : rows.slice();
  out.sort(function (a, b) {
    var sa = q && key(a).indexOf(q) === 0 ? 0 : 1;
    var sb = q && key(b).indexOf(q) === 0 ? 0 : 1;
    if (sa !== sb) return sa - sb;
    return key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : String(a.id) < String(b.id) ? -1 : 1;
  });
  return out;
}

// What "Message..." does after asking the app to open the chat drawer
// (mgb:open-chat; handled = the app took it): "done" = the chat drawer is
// open; with the app declining (the Inbox page itself, or no staff chat), on
// a client page "page" = fall back to the client's Messages (the old
// Message item's own path) and off one "inbox" = the Desk's Messages chip.
function WB_quickMessageStep(hasClient, handled) {
  if (handled === true) return "done";
  return hasClient ? "page" : "inbox";
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    WB_quickPickFilter: WB_quickPickFilter,
    WB_quickMessageStep: WB_quickMessageStep,
    WB_cxMem: WB_cxMem,
    WB_cxStep: WB_cxStep,
    WB_cxChanged: WB_cxChanged,
    WB_CX_LIMIT: WB_CX_LIMIT,
    WB_CX_TRIM: WB_CX_TRIM,
    WB_CX_WAIT_CAP: WB_CX_WAIT_CAP,
    WB_CX_MSG_COLS: WB_CX_MSG_COLS,
    WB_CX_FILE_COLS: WB_CX_FILE_COLS,
    WB_cxTrim: WB_cxTrim,
    WB_cxShortDate: WB_cxShortDate,
    WB_cxWhen: WB_cxWhen,
    WB_cxNudgeLabel: WB_cxNudgeLabel,
    WB_cxDaysLabel: WB_cxDaysLabel,
    WB_cxWaitingRow: WB_cxWaitingRow,
    WB_cxWaitingRows: WB_cxWaitingRows,
    WB_cxVisibleMessage: WB_cxVisibleMessage,
    WB_cxMessageRows: WB_cxMessageRows,
    WB_cxFileKind: WB_cxFileKind,
    WB_cxVisibleFile: WB_cxVisibleFile,
    WB_cxFileRows: WB_cxFileRows,
    WB_cxQuery: WB_cxQuery,
    WB_cxLoadSection: WB_cxLoadSection,
    WB_loadClientExtras: WB_loadClientExtras,
    WB_cxSeq: WB_cxSeq,
    WB_cxFetch: WB_cxFetch,
  };
}
