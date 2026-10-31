// ----------------------------------------------------------------------------
// TK_projectUpdatesLogic: pure rules for Slate plus project status updates and
// the Portfolio page (hidden preview, docs/slateplus-projupdates-spec.md).
// Views: TK_ProjectUpdates.jsx. Browser file, shared global scope: every name
// carries a TKPU_ prefix. Node test: TK_projectUpdatesLogic.test.js.
//
// Statuses match the tk_project_updates_status_check constraint in
// supabase/slateplus-project-updates.sql. The pill always shows the word;
// tone only picks the pill color (good, warm, bad, neutral in styles.css).
// ----------------------------------------------------------------------------

var TKPU_BODY_MAX = 1000;
var TKPU_COUNTER_FROM = 900;
var TKPU_STALE_DAYS = 14;
var TKPU_DAY_MS = 86400000;
var TKPU_EVENT = "mgb:tk-projupdates-changed";

// rank orders the Status sort: Off track first, Done last.
var TKPU_STATUSES = [
  { key: "on_track", label: "On track", tone: "good", rank: 2 },
  { key: "at_risk", label: "At risk", tone: "warm", rank: 1 },
  { key: "off_track", label: "Off track", tone: "bad", rank: 0 },
  { key: "done", label: "Done", tone: "neutral", rank: 4 },
];
var TKPU_NONE = { key: "none", label: "No status yet", tone: "neutral", rank: 3 };

var TKPU__MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// The status entry for a key; anything unknown (or no update) is "No status yet".
function TKPU_status(key) {
  for (var i = 0; i < TKPU_STATUSES.length; i++) if (TKPU_STATUSES[i].key === key) return TKPU_STATUSES[i];
  return TKPU_NONE;
}

function TKPU_isStatus(key) {
  return TKPU_status(key) !== TKPU_NONE;
}

// The post form check: { ok, field, text }.
function TKPU_checkDraft(d) {
  var x = d || {};
  if (!TKPU_isStatus(x.status)) return { ok: false, field: "status", text: "Pick a status." };
  var b = typeof x.body === "string" ? x.body.trim() : "";
  if (!b) return { ok: false, field: "body", text: "Write a short note about where things stand." };
  if (b.length > TKPU_BODY_MAX) return { ok: false, field: "body", text: "Keep it to " + TKPU_BODY_MAX + " characters or fewer." };
  return { ok: true, field: null, text: "" };
}

// The character counter, shown only near the limit ("" otherwise).
function TKPU_counterText(body) {
  var n = typeof body === "string" ? body.trim().length : 0;
  if (n < TKPU_COUNTER_FROM) return "";
  var left = TKPU_BODY_MAX - n;
  if (left < 0) return -left + (left === -1 ? " character over" : " characters over");
  return left + (left === 1 ? " character left" : " characters left");
}

function TKPU__ms(iso) {
  if (iso == null || iso === "") return NaN;
  var v = Date.parse(String(iso));
  return isNaN(v) ? NaN : v;
}

function TKPU__ymdLocal(ms) {
  var d = new Date(ms);
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

// "today", "yesterday", "Oct 28", or "Oct 28, 2025" (another year), in the
// browser's own time zone. "" for a bad time.
function TKPU_whenText(iso, nowMs) {
  var ms = TKPU__ms(iso);
  if (isNaN(ms)) return "";
  var now = typeof nowMs === "number" ? nowMs : Date.now();
  var a = TKPU__ymdLocal(ms);
  if (a === TKPU__ymdLocal(now)) return "today";
  // Calendar yesterday, not now minus 24 hours (a DST day is 23 or 25 hours).
  var n = new Date(now);
  if (a === TKPU__ymdLocal(new Date(n.getFullYear(), n.getMonth(), n.getDate() - 1, 12).getTime())) return "yesterday";
  var d = new Date(ms);
  var s = TKPU__MONTHS[d.getMonth()] + " " + d.getDate();
  return d.getFullYear() === new Date(now).getFullYear() ? s : s + ", " + d.getFullYear();
}

// "Updated today by Grace" (nameFn(email) gives the name).
function TKPU_bylineText(update, nameFn, nowMs) {
  if (!update) return "";
  var when = TKPU_whenText(update.created_at, nowMs);
  var who = typeof nameFn === "function" ? nameFn(update.author_email) : "";
  var s = "Updated" + (when ? " " + when : "");
  return who ? s + " by " + who : s;
}

// Stale: not archived, latest status not Done, and no update for 14 days or
// more. A project with no updates counts from when it was made.
function TKPU_isStale(project, latest, nowMs) {
  var p = project || {};
  if (!p.id || p.archived_at) return false;
  if (latest && latest.status === "done") return false;
  var base = TKPU__ms(latest ? latest.created_at : p.created_at);
  if (isNaN(base)) return false;
  var now = typeof nowMs === "number" ? nowMs : Date.now();
  return now - base >= TKPU_STALE_DAYS * TKPU_DAY_MS;
}

// Newest non-hidden update per project id from any list of rows.
function TKPU_latestMap(rows) {
  var out = {};
  (Array.isArray(rows) ? rows : []).forEach(function (r) {
    if (!r || !r.project_id || r.hidden_at) return;
    var cur = out[r.project_id];
    if (!cur) {
      out[r.project_id] = r;
      return;
    }
    var a = TKPU__ms(r.created_at);
    var b = TKPU__ms(cur.created_at);
    if (a > b || (a === b && String(r.id) > String(cur.id))) out[r.project_id] = r;
  });
  return out;
}

// The timeline for one project: hidden rows dropped, newest first.
function TKPU_timeline(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter(function (r) {
      return r && !r.hidden_at;
    })
    .slice()
    .sort(function (x, y) {
      var a = TKPU__ms(x.created_at);
      var b = TKPU__ms(y.created_at);
      if (a !== b) return (isNaN(b) ? 0 : b) - (isNaN(a) ? 0 : a);
      return String(y.id) < String(x.id) ? -1 : String(y.id) > String(x.id) ? 1 : 0;
    });
}

function TKPU__cleanYmd(s) {
  var v = s == null ? "" : String(s).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "";
}

// The Due cell: { text, late } or null. Late once past due unless archived.
function TKPU_dueCell(project, todayYmd) {
  var p = project || {};
  var due = TKPU__cleanYmd(p.due_on);
  if (!due) return null;
  var t = TKPU__cleanYmd(todayYmd);
  var s = TKPU__MONTHS[+due.slice(5, 7) - 1] + " " + +due.slice(8, 10);
  if (!t || t.slice(0, 4) !== due.slice(0, 4)) s += ", " + due.slice(0, 4);
  var late = !!t && due < t && !p.archived_at;
  return { text: late ? "Late: " + s : s, late: late, ymd: due };
}

// One row per project the viewer can see. opts: { showArchived, nowMs,
// today (YYYY-MM-DD), nameOf(email) }.
function TKPU_portfolioRows(projects, latestByProject, opts) {
  var o = opts || {};
  var map = latestByProject || {};
  var nameOf = typeof o.nameOf === "function" ? o.nameOf : function (e) { return e ? String(e).split("@")[0] : ""; };
  return (Array.isArray(projects) ? projects : [])
    .filter(function (p) {
      return p && p.id && (o.showArchived === true || !p.archived_at);
    })
    .map(function (p) {
      var latest = map[p.id] || null;
      var st = latest ? TKPU_status(latest.status) : TKPU_NONE;
      var lastMs = latest ? TKPU__ms(latest.created_at) : NaN;
      return {
        id: p.id,
        project: p,
        name: p.name || "Project",
        owner: p.owner_email ? nameOf(String(p.owner_email).toLowerCase()) : "",
        status: st,
        latest: latest,
        lastMs: isNaN(lastMs) ? null : lastMs,
        lastText: latest ? TKPU_whenText(latest.created_at, o.nowMs) : "",
        stale: TKPU_isStale(p, latest, o.nowMs),
        due: TKPU_dueCell(p, o.today),
        archived: !!p.archived_at,
      };
    });
}

var TKPU_SORT_KEYS = ["status", "due", "name", "updated"];

function TKPU__byName(a, b) {
  var x = String(a.name || "").toLowerCase();
  var y = String(b.name || "").toLowerCase();
  if (x !== y) return x < y ? -1 : 1;
  return String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0;
}

// Sorted copy. key: status | due | name | updated; dir: asc | desc. Rows with
// no due date (Due) or no update (Last update) stay last either way; ties go
// by name.
function TKPU_sortRows(rows, key, dir) {
  var k = TKPU_SORT_KEYS.indexOf(key) >= 0 ? key : "status";
  var sign = dir === "desc" ? -1 : 1;
  return (Array.isArray(rows) ? rows : []).slice().sort(function (a, b) {
    var c = 0;
    if (k === "status") c = sign * (a.status.rank - b.status.rank);
    else if (k === "due") {
      var x = a.due ? a.due.ymd : null;
      var y = b.due ? b.due.ymd : null;
      if (x === null && y !== null) return 1;
      if (y === null && x !== null) return -1;
      if (x !== null && x !== y) c = sign * (x < y ? -1 : 1);
    } else if (k === "updated") {
      if (a.lastMs === null && b.lastMs !== null) return 1;
      if (b.lastMs === null && a.lastMs !== null) return -1;
      if (a.lastMs !== b.lastMs) c = sign * (a.lastMs - b.lastMs);
    } else c = sign * TKPU__byName(a, b);
    return c || TKPU__byName(a, b);
  });
}

// Clicking a column: the same column flips direction, a new one starts asc
// (Last update starts newest first).
function TKPU_nextSort(cur, key) {
  var c = cur || {};
  if (c.key === key) return { key: key, dir: c.dir === "asc" ? "desc" : "asc" };
  return { key: key, dir: key === "updated" ? "desc" : "asc" };
}

function TKPU_ariaSort(sort, key) {
  if (!sort || sort.key !== key) return "none";
  return sort.dir === "desc" ? "descending" : "ascending";
}

// The summary line over the table: "12 projects · 2 off track · 3 stale".
function TKPU_summaryText(rows) {
  var list = Array.isArray(rows) ? rows : [];
  var n = list.length;
  var parts = [n + (n === 1 ? " project" : " projects")];
  var off = list.filter(function (r) { return r.status && r.status.key === "off_track"; }).length;
  var risk = list.filter(function (r) { return r.status && r.status.key === "at_risk"; }).length;
  var stale = list.filter(function (r) { return r.stale; }).length;
  if (off) parts.push(off + " off track");
  if (risk) parts.push(risk + " at risk");
  if (stale) parts.push(stale + " stale");
  return parts.join(" · ");
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    TKPU_BODY_MAX: TKPU_BODY_MAX,
    TKPU_COUNTER_FROM: TKPU_COUNTER_FROM,
    TKPU_STALE_DAYS: TKPU_STALE_DAYS,
    TKPU_EVENT: TKPU_EVENT,
    TKPU_STATUSES: TKPU_STATUSES,
    TKPU_NONE: TKPU_NONE,
    TKPU_status: TKPU_status,
    TKPU_isStatus: TKPU_isStatus,
    TKPU_checkDraft: TKPU_checkDraft,
    TKPU_counterText: TKPU_counterText,
    TKPU_whenText: TKPU_whenText,
    TKPU_bylineText: TKPU_bylineText,
    TKPU_isStale: TKPU_isStale,
    TKPU_latestMap: TKPU_latestMap,
    TKPU_timeline: TKPU_timeline,
    TKPU_dueCell: TKPU_dueCell,
    TKPU_portfolioRows: TKPU_portfolioRows,
    TKPU_sortRows: TKPU_sortRows,
    TKPU_nextSort: TKPU_nextSort,
    TKPU_ariaSort: TKPU_ariaSort,
    TKPU_summaryText: TKPU_summaryText,
  };
}
