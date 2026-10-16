// ----------------------------------------------------------------------------
// Tasks module, drawer slice: pure helpers (docs/tasks-phase1-spec.md C7).
//
// No React, no DOM, no Supabase. Every top-level name is a browser global
// (this file loads through window.__SOURCE_ORDER) and is exported to node by
// the guard at the end for TK_drawerLogic.test.js.
//
// Names from the contract keep their contract spelling. Helpers only the
// drawer uses carry the TK_dl prefix, so they never clash with TK_logic.js or
// TK_viewLogic.js, which share the same global scope.
// ----------------------------------------------------------------------------

// The same whitelist as TK_api.update (C5).
var TK_EDITABLE_FIELDS = [
  "text", "description", "due_date", "due_at", "remind_at", "start_on", "priority", "kind", "recurrence",
  "section", "sort_key", "sop_section", "review_required", "assignee_email", "visibility", "parent_id",
  "client_id", "project_id",
];

// Fields where an empty input means "no value" (null), not "".
var TK_DL_BLANK_NULL = {
  description: 1, due_date: 1, due_at: 1, remind_at: 1, start_on: 1, section: 1, sop_section: 1,
  assignee_email: 1, parent_id: 1, client_id: 1, project_id: 1, sort_key: 1,
};

var TK_DL_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
var TK_DL_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
var TK_DL_YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
var TK_DL_HANDLE_CHAR = /[A-Za-z0-9._-]/;
var TK_DL_BEFORE_AT = /[A-Za-z0-9_.]/; // a mention needs start-of-text or one of these NOT before "@"

function TK_dlLower(s) {
  return s == null ? "" : String(s).trim().toLowerCase();
}

function TK_dlHandle(email) {
  var e = TK_dlLower(email);
  var at = e.indexOf("@");
  return at >= 0 ? e.slice(0, at) : e;
}

function TK_dlNorm(field, v) {
  if (v === undefined) v = null;
  if (field === "review_required") return !!v;
  if (field === "text") return v == null ? "" : String(v).trim();
  if (field === "description") {
    if (v == null) return null;
    var d = String(v);
    return d.trim() === "" ? null : d.replace(/\s+$/, "");
  }
  if (field === "assignee_email") {
    var a = TK_dlLower(v);
    return a === "" ? null : a;
  }
  if (field === "sort_key") {
    if (v == null || v === "") return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }
  if (TK_DL_BLANK_NULL[field]) {
    if (v == null) return null;
    var s = typeof v === "string" ? v.trim() : v;
    return s === "" ? null : s;
  }
  return v;
}

// Only changed, whitelisted fields. "" becomes null for dates, the
// description and the other optional fields.
function TK_buildPatch(original, draft) {
  var o = original || {};
  var d = draft || {};
  var patch = {};
  for (var i = 0; i < TK_EDITABLE_FIELDS.length; i++) {
    var f = TK_EDITABLE_FIELDS[i];
    if (!Object.prototype.hasOwnProperty.call(d, f)) continue;
    var next = TK_dlNorm(f, d[f]);
    var prev = TK_dlNorm(f, o[f]);
    if (next !== prev) patch[f] = next;
  }
  return patch;
}

// { field: message } for every problem; {} when the draft is fine.
function TK_validateDraft(draft) {
  var d = draft || {};
  var out = {};
  if ("text" in d) {
    var t = d.text == null ? "" : String(d.text).trim();
    if (!t) out.text = "Add a title.";
    else if (t.length > 500) out.text = "Keep the title under 500 characters.";
  }
  if (d.description != null && String(d.description).length > 5000) {
    out.description = "Keep the description under 5,000 characters.";
  }
  var start = TK_dlNorm("start_on", d.start_on);
  var due = TK_dlNorm("due_date", d.due_date);
  if (start && due && String(start) > String(due)) out.start_on = "The start date can't be after the due date.";
  if (d.recurrence && d.recurrence !== "none" && !due) out.recurrence = "Add a due date to repeat this task.";
  return out;
}

function TK_dlTime(iso) {
  var t = Date.parse(iso || "");
  return isNaN(t) ? 0 : t;
}

// Comments and activity in one ascending list. A deleted comment stays in
// place as "Comment deleted". Activity rows of kind "comment" are left out:
// the comment itself is already there.
function TK_mergeTimeline(comments, activity) {
  var out = [];
  (comments || []).forEach(function (c) {
    if (!c) return;
    var item = c.deleted_at ? Object.assign({}, c, { body: "Comment deleted", mentions: [], deleted: true }) : c;
    out.push({ type: "comment", at: c.created_at, item: item });
  });
  (activity || []).forEach(function (a) {
    if (!a || a.kind === "comment") return;
    out.push({ type: "activity", at: a.created_at, item: a });
  });
  out.sort(function (x, y) {
    var d = TK_dlTime(x.at) - TK_dlTime(y.at);
    if (d) return d;
    if (x.type !== y.type) return x.type === "activity" ? -1 : 1;
    var a = String(x.item.id == null ? "" : x.item.id);
    var b = String(y.item.id == null ? "" : y.item.id);
    if (x.type === "activity" && !isNaN(Number(a)) && !isNaN(Number(b))) return Number(a) - Number(b);
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return out;
}

// "Oct 14", or "Oct 14, 2027" when the year isn't today's year.
function TK_dlShortDate(ymd, todayYmd) {
  var m = TK_DL_YMD_RE.exec(String(ymd || ""));
  if (!m) return "";
  var label = TK_DL_MONTHS[Number(m[2]) - 1] + " " + Number(m[3]);
  var ty = TK_DL_YMD_RE.exec(String(todayYmd || ""));
  if (ty && ty[1] !== m[1]) label += ", " + m[1];
  return label;
}

// One activity row as a sentence. opts: { nameOf(email), statusLabel(status), today }
function TK_activityText(entry, opts) {
  var e = entry || {};
  var o = opts || {};
  var nameOf = typeof o.nameOf === "function" ? o.nameOf : function (x) { return TK_dlHandle(x); };
  var statusLabel = typeof o.statusLabel === "function" ? o.statusLabel : function (s) { return String(s || ""); };
  var to = e.to_value;
  switch (e.kind) {
    case "created":
      return "Created";
    case "status":
      return "Moved to " + statusLabel(to);
    case "review_approved":
      return "Approved";
    case "review_sent_back":
      return "Sent back";
    case "review_withdrawn":
      return "Taken back from review";
    case "reviewer":
      return to ? "Reviewer set to " + nameOf(to) : "Reviewer cleared";
    case "assignee":
      return to ? "Assigned to " + nameOf(to) : "Unassigned";
    case "due":
      return to ? "Due date set to " + TK_dlShortDate(to, o.today) : "Due date cleared";
    case "priority":
      return "Priority set to " + (to ? String(to).charAt(0).toUpperCase() + String(to).slice(1) : "Normal");
    case "section":
      return to ? "Moved to the " + to + " section" : "Section cleared";
    case "moved":
      return "Moved to another list";
    case "deleted":
      return "Deleted";
    case "restored":
      return "Restored";
    case "comment":
      return "Commented";
    case "client_asked":
      return "Asked the client";
    case "client_answered":
      return "The client answered";
    case "reassigned_ooo":
      // Tasks Phase 2 S7: meta.direction "back" when the time off ended.
      if (e.meta && e.meta.direction === "back")
        return to ? "Handed back to " + nameOf(to) + " after time off" : "Handed back after time off";
      return to ? "Reassigned to " + nameOf(to) + " while out of office" : "Reassigned while out of office";
    case "imported":
      return "Imported";
    default:
      return "Changed";
  }
}

// Staff whose handle or name starts with the query. Active staff only.
function TK_mentionMatches(query, staff, limit) {
  var max = limit == null ? 6 : limit;
  var q = TK_dlLower(query);
  var seen = {};
  var list = (staff || []).filter(function (s) {
    if (!s || !s.email || s.active === false) return false;
    var em = TK_dlLower(s.email);
    if (seen[em]) return false;
    seen[em] = true;
    if (!q) return true;
    if (TK_dlHandle(em).indexOf(q) === 0) return true;
    var name = TK_dlLower(s.name);
    if (name.indexOf(q) === 0) return true;
    if (name.split(/[\s.-]+/).some(function (w) { return w && w.indexOf(q) === 0; })) return true;
    return name.replace(/[^a-z0-9]+/g, "-").indexOf(q) === 0;
  });
  list.sort(function (a, b) {
    var ah = TK_dlHandle(a.email).indexOf(q) === 0 ? 0 : 1;
    var bh = TK_dlHandle(b.email).indexOf(q) === 0 ? 0 : 1;
    if (q && ah !== bh) return ah - bh;
    var an = TK_dlLower(a.name || a.email);
    var bn = TK_dlLower(b.name || b.email);
    return an < bn ? -1 : an > bn ? 1 : 0;
  });
  return list.slice(0, max);
}

// The "@que" being typed right before the caret, or null.
function TK_mentionQuery(body, caret) {
  var s = body == null ? "" : String(body);
  var c = caret == null ? s.length : Math.max(0, Math.min(s.length, caret));
  var i = c - 1;
  while (i >= 0 && TK_DL_HANDLE_CHAR.test(s.charAt(i))) i--;
  if (i < 0 || s.charAt(i) !== "@") return null;
  if (i > 0 && TK_DL_BEFORE_AT.test(s.charAt(i - 1))) return null;
  var query = s.slice(i + 1, c);
  if (query.length > 64) return null;
  return { start: i, query: query };
}

// Replace the "@que" before the caret with "@handle " and move the caret
// after it. With no "@" being typed, the mention is inserted at the caret.
function TK_insertMention(body, caret, handle) {
  var s = body == null ? "" : String(body);
  var c = caret == null ? s.length : Math.max(0, Math.min(s.length, caret));
  var h = String(handle || "").replace(/^@+/, "");
  var q = TK_mentionQuery(s, c);
  var start = c;
  var end = c;
  var lead = "";
  if (q) {
    start = q.start;
    while (end < s.length && TK_DL_HANDLE_CHAR.test(s.charAt(end))) end++;
  } else if (c > 0 && !/\s/.test(s.charAt(c - 1))) {
    lead = " ";
  }
  var after = s.slice(end);
  var insert = lead + "@" + h;
  var next = s.slice(0, start) + insert + (/^\s/.test(after) ? after : " " + after);
  return { body: next, caret: start + insert.length + 1 };
}

// Split a comment body into text and mention pieces. handleToName maps a
// lowercase handle to a display name; unknown handles stay plain text.
function TK_dlSplitMentions(body, handleToName) {
  var s = body == null ? "" : String(body);
  var map = handleToName || {};
  var re = /(^|[^A-Za-z0-9_.])@([A-Za-z0-9._-]{2,64})/g;
  var out = [];
  var last = 0;
  var m;
  while ((m = re.exec(s)) !== null) {
    var raw = m[2];
    var h = raw.toLowerCase().replace(/\.+$/, "");
    var trail = raw.length - raw.replace(/\.+$/, "").length;
    var name = Object.prototype.hasOwnProperty.call(map, h) ? map[h] : null;
    if (name) {
      var at = m.index + m[1].length;
      if (at > last) out.push({ type: "text", text: s.slice(last, at) });
      out.push({ type: "mention", handle: h, name: name });
      last = at + 1 + raw.length - trail;
    }
  }
  if (last < s.length) out.push({ type: "text", text: s.slice(last) });
  return out;
}

// ---- Attachments
var TK_ATTACH_MIMES = [
  "application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp", "text/csv", "text/plain",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];
var TK_ATTACH_MAX_BYTES = 25 * 1024 * 1024;
var TK_DL_EXT_MIME = {
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", csv: "text/csv", txt: "text/plain",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

// The mime type to upload with: the browser's, when it's on the list, else
// the one the extension implies (Windows reports CSV as an Excel type, and
// some browsers report nothing at all).
function TK_dlAttachMime(file) {
  var f = file || {};
  var t = TK_dlLower(f.type);
  if (t && TK_ATTACH_MIMES.indexOf(t) >= 0) return t;
  var name = String(f.name || "");
  var dot = name.lastIndexOf(".");
  var ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
  return TK_DL_EXT_MIME[ext] || t || "";
}

// null when it's fine, else a message. A link is { url }; a file is a File
// (or anything with name, size and type).
function TK_validateAttachment(fileOrLink) {
  var x = fileOrLink;
  if (!x) return "Choose a file or add a link.";
  if (typeof x.url === "string" || (x.url != null && x.size == null && x.name == null)) {
    var u = String(x.url || "").trim();
    if (!u) return "Add a link.";
    if (u.length > 2000) return "That link is too long.";
    if (!/^https:\/\//i.test(u)) return "Links must start with https://.";
    if (/\s/.test(u)) return "That doesn't look like a link.";
    try {
      var parsed = new URL(u);
      if (parsed.protocol !== "https:" || !parsed.hostname) return "That doesn't look like a link.";
    } catch (e) {
      return "That doesn't look like a link.";
    }
    return null;
  }
  var size = Number(x.size);
  if (!isFinite(size) || size <= 0) return "That file is empty.";
  if (size > TK_ATTACH_MAX_BYTES) return "That file is bigger than 25 MB.";
  if (TK_ATTACH_MIMES.indexOf(TK_dlAttachMime(x)) < 0) {
    return "That file type can't be attached. Use a PDF, an image, or a CSV, text, Excel or Word file.";
  }
  return null;
}

// "<taskId>/<uuid>-<safe>": safe keeps [A-Za-z0-9._-], turns anything else
// into "-", and is at most 100 characters with the extension kept.
function TK_attachmentPath(taskId, uuid, fileName) {
  var safe = String(fileName == null ? "" : fileName).replace(/[^A-Za-z0-9._-]/g, "-");
  if (!safe.replace(/[-.]/g, "")) safe = "file" + (safe.indexOf(".") >= 0 ? safe.slice(safe.lastIndexOf(".")) : "");
  if (safe.length > 100) {
    var dot = safe.lastIndexOf(".");
    var ext = dot > 0 && safe.length - dot <= 11 ? safe.slice(dot) : "";
    safe = safe.slice(0, 100 - ext.length) + ext;
  }
  return String(taskId) + "/" + String(uuid) + "-" + safe;
}

function TK_dlFormatSize(bytes) {
  if (bytes == null || bytes === "") return "";
  var n = Number(bytes);
  if (!isFinite(n) || n < 0) return "";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return Math.round(n / 1024) + " KB";
  var mb = n / (1024 * 1024);
  return (mb < 10 ? Math.round(mb * 10) / 10 : Math.round(mb)) + " MB";
}

// ---- Quick add
// What a quick add starts from: the event detail wins, then the client page
// that is open (currentClientId). A project task never picks up the open
// client by accident.
function TK_quickAddDefaults(detail, ctx) {
  var d = detail || {};
  var c = ctx || {};
  var has = function (k) { return Object.prototype.hasOwnProperty.call(d, k) && d[k] !== undefined; };
  var project = has("project_id") && d.project_id ? String(d.project_id) : null;
  var client;
  if (has("client_id")) client = d.client_id ? String(d.client_id) : null;
  else client = project ? null : c.currentClientId ? String(c.currentClientId) : null;
  var due = has("due_date") && TK_DL_YMD_RE.test(String(d.due_date)) ? String(d.due_date) : null;
  return {
    client_id: client,
    project_id: project,
    section: has("section") && d.section ? String(d.section) : null,
    kind: d.kind === "reminder" ? "reminder" : "task",
    visibility: client || project ? "shared" : "private",
    text: has("text") && d.text ? String(d.text) : "",
    due_date: due,
    assignee_email: TK_dlLower(c.me) || null,
  };
}

// ---- Opening a task
// "drawer" when the new drawer can show it, else "legacy" (LK_go to the old
// Work › Tasks page). C7: the schema must be "ok" and a host mounted.
function TK_dlOpenTarget(ctx) {
  var c = ctx || {};
  return c.schema === "ok" && c.hostReady === true ? "drawer" : "legacy";
}

// A plain left click: button 0, no modifier, not already handled.
function TK_dlIsPlainClick(e) {
  if (!e || e.defaultPrevented) return false;
  if (e.button != null && e.button !== 0) return false;
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
  return true;
}

// The click handler behind TK_openTaskClick: anything but a plain left click
// is left to the browser (new tab, new window).
function TK_dlClickHandler(id, open) {
  return function (e) {
    if (!TK_dlIsPlainClick(e)) return;
    if (typeof e.preventDefault === "function") e.preventDefault();
    open(id);
  };
}

// ---- Display helpers
function TK_dlInitials(name, email) {
  var n = String(name || "").trim();
  if (n) {
    var parts = n.split(/\s+/).filter(Boolean);
    var a = parts[0] ? parts[0].charAt(0) : "";
    var b = parts.length > 1 ? parts[parts.length - 1].charAt(0) : "";
    return (a + b).toUpperCase();
  }
  var h = TK_dlHandle(email);
  return h ? h.charAt(0).toUpperCase() : "?";
}

// "System" for system rows, the staff name when known, else the handle.
function TK_dlNameOf(email, staff) {
  var e = TK_dlLower(email);
  if (!e) return "";
  if (e === "system") return "System";
  var list = staff || [];
  for (var i = 0; i < list.length; i++) {
    if (list[i] && TK_dlLower(list[i].email) === e && list[i].name) return String(list[i].name);
  }
  return TK_dlHandle(e);
}

// Up to `max` avatars, then "+N".
function TK_dlFollowerStack(followers, max) {
  var list = followers || [];
  var m = max == null ? 5 : max;
  return { shown: list.slice(0, m), extra: Math.max(0, list.length - m) };
}

function TK_dlPad(n) {
  return n < 10 ? "0" + n : String(n);
}

function TK_dlLocalYmd(d) {
  return d.getFullYear() + "-" + TK_dlPad(d.getMonth() + 1) + "-" + TK_dlPad(d.getDate());
}

// "Just now", "5 min ago", "3 hr ago", "Yesterday", "Mon", "Oct 3",
// "Oct 3, 2025". Local time.
function TK_dlRelTime(iso, nowMs) {
  var t = Date.parse(iso || "");
  if (isNaN(t)) return "";
  var now = nowMs == null ? Date.now() : nowMs;
  var diff = Math.max(0, now - t);
  if (diff < 60 * 1000) return "Just now";
  if (diff < 60 * 60 * 1000) return Math.floor(diff / 60000) + " min ago";
  var then = new Date(t);
  var today = new Date(now);
  var thenYmd = TK_dlLocalYmd(then);
  var todayYmd = TK_dlLocalYmd(today);
  if (thenYmd === todayYmd) return Math.floor(diff / 3600000) + " hr ago";
  var y = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (thenYmd === TK_dlLocalYmd(y)) return "Yesterday";
  if (diff < 6 * 24 * 60 * 60 * 1000) return TK_DL_WEEKDAYS[then.getDay()];
  return TK_dlShortDate(thenYmd, todayYmd);
}

// due_at the way the app stores it (buildStaffDueAt in app.jsx): a date with
// no time is the sentinel "<ymd>T00:00:00.000Z"; a real local time that lands
// exactly on UTC midnight gets one second so it never reads as the sentinel.
// null without a date.
function TK_dlDueAt(ymd, hhmm) {
  var m = TK_DL_YMD_RE.exec(String(ymd || ""));
  if (!m) return null;
  var t = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ""));
  if (!t) return m[0] + "T00:00:00.000Z";
  var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(t[1]), Number(t[2]));
  if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0) d.setSeconds(1);
  return d.toISOString();
}

// "HH:MM" (local) of a due_at, or "" for none and for the date-only sentinel.
function TK_dlTimeOf(iso) {
  var t = Date.parse(iso || "");
  if (isNaN(t)) return "";
  var d = new Date(t);
  if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0) return "";
  return TK_dlPad(d.getHours()) + ":" + TK_dlPad(d.getMinutes());
}

// ISO <-> the value of an <input type="datetime-local">.
function TK_dlToLocalInput(iso) {
  var t = Date.parse(iso || "");
  if (isNaN(t)) return "";
  var d = new Date(t);
  return TK_dlLocalYmd(d) + "T" + TK_dlPad(d.getHours()) + ":" + TK_dlPad(d.getMinutes());
}
function TK_dlFromLocalInput(v) {
  var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(v || ""));
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])).toISOString();
}

// Section choices: the project's own list when it has one, else the usual
// client order, then any other section already in use, alphabetically.
function TK_dlSectionOptions(projectSections, usedSections, order) {
  var out = [];
  var seen = {};
  var add = function (s) {
    var v = s == null ? "" : String(s).trim();
    if (!v || seen[v.toLowerCase()]) return;
    seen[v.toLowerCase()] = true;
    out.push(v);
  };
  if (projectSections && projectSections.length) projectSections.forEach(add);
  else (order || []).forEach(add);
  (usedSections || []).slice().sort(function (a, b) {
    var x = String(a).toLowerCase();
    var y = String(b).toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  }).forEach(add);
  return out;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    TK_EDITABLE_FIELDS: TK_EDITABLE_FIELDS,
    TK_buildPatch: TK_buildPatch,
    TK_validateDraft: TK_validateDraft,
    TK_mergeTimeline: TK_mergeTimeline,
    TK_activityText: TK_activityText,
    TK_mentionMatches: TK_mentionMatches,
    TK_mentionQuery: TK_mentionQuery,
    TK_insertMention: TK_insertMention,
    TK_validateAttachment: TK_validateAttachment,
    TK_ATTACH_MIMES: TK_ATTACH_MIMES,
    TK_ATTACH_MAX_BYTES: TK_ATTACH_MAX_BYTES,
    TK_attachmentPath: TK_attachmentPath,
    TK_quickAddDefaults: TK_quickAddDefaults,
    TK_dlHandle: TK_dlHandle,
    TK_dlShortDate: TK_dlShortDate,
    TK_dlSplitMentions: TK_dlSplitMentions,
    TK_dlAttachMime: TK_dlAttachMime,
    TK_dlFormatSize: TK_dlFormatSize,
    TK_dlOpenTarget: TK_dlOpenTarget,
    TK_dlIsPlainClick: TK_dlIsPlainClick,
    TK_dlClickHandler: TK_dlClickHandler,
    TK_dlInitials: TK_dlInitials,
    TK_dlNameOf: TK_dlNameOf,
    TK_dlFollowerStack: TK_dlFollowerStack,
    TK_dlRelTime: TK_dlRelTime,
    TK_dlDueAt: TK_dlDueAt,
    TK_dlTimeOf: TK_dlTimeOf,
    TK_dlToLocalInput: TK_dlToLocalInput,
    TK_dlFromLocalInput: TK_dlFromLocalInput,
    TK_dlSectionOptions: TK_dlSectionOptions,
  };
}
