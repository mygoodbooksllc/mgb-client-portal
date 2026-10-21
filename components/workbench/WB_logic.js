// ----------------------------------------------------------------------------
// WB_logic: the Workbench rules, pure and node-tested (spec C, D2, D4).
//
// The server (supabase/workbench-1-core.sql, wb_inbox) returns facts only;
// grouping, ranking, chip counts, the action per kind and the link per kind
// live here. `node components/workbench/WB_logic.test.js` guards them.
//
// The bottom dock is called the Desk (it was the Workbench). Every UI string
// reads WORKBENCH_NAME, so a rename is one line; WB_NAME is the alias the
// older references keep using. Identifiers (wb-*, mgb_wb_*, wb_*) never change.
// ----------------------------------------------------------------------------

var WORKBENCH_NAME = "Desk"; // the bottom dock's display name, the one place it lives
var WB_NAME = WORKBENCH_NAME; // alias, so the existing references keep working
// The task module's name (SLATE_NAME in components/tasks/TK_logic.js, loaded
// first in the browser; node tests load this file alone).
var WB_SLATE = typeof SLATE_NAME !== "undefined" ? SLATE_NAME : "Slate";
var WB_SOON_DAYS = 7; // same window as TD_SOON_DAYS / TK_SOON_DAYS and the RPC
var WB_TZ = "America/Chicago";
var WB_REFRESH_MS = 120000; // 2-minute poll fallback, paused while hidden
var WB_SNOOZE_MAX_DAYS = 30;

// Chips on the page (spec D1). Keys 1-6 pick these in order; 0 = All.
var WB_CHIPS = [
  { id: "all", label: "All" },
  { id: "task", label: "Tasks" },
  { id: "review", label: "Reviews" },
  { id: "message", label: "Messages" },
  { id: "gl", label: "Ledger" },
  { id: "doc", label: "Documents" },
  { id: "other", label: "Other" },
];
// Tabs in the bottom drawer (addendum 2026-10-16).
var WB_DRAWER_TABS = [
  { id: "all", label: "All" },
  { id: "task", label: "Tasks" },
  { id: "review", label: "Reviews" },
  { id: "message", label: "Messages" },
  { id: "doc", label: "Files" },
];
var WB_GROUPS = [
  { id: "overdue", label: "Overdue" },
  { id: "today", label: "Today" },
  { id: "week", label: "This week" },
];
var WB_SOURCE_LABEL = {
  task: "Task",
  review: "Review",
  message: "Message",
  gl: "Ledger",
  doc: "Document",
  other: "Other",
};

// ---- Dates ------------------------------------------------------------------
function WB__pad2(n) {
  return (n < 10 ? "0" : "") + n;
}
var WB__YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
function WB__utcOf(ymd) {
  var m = WB__YMD_RE.exec(String(ymd || ""));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN;
}
function WB__ymdFromUTC(ms) {
  var d = new Date(ms);
  return d.getUTCFullYear() + "-" + WB__pad2(d.getUTCMonth() + 1) + "-" + WB__pad2(d.getUTCDate());
}

// Parts of an instant on the firm's wall clock.
function WB__chicagoParts(ms) {
  var fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: WB_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  var out = {};
  fmt.formatToParts(new Date(ms)).forEach(function (p) {
    if (p.type !== "literal") out[p.type] = parseInt(p.value, 10);
  });
  if (out.hour === 24) out.hour = 0;
  return out;
}

// "YYYY-MM-DD" in Chicago for an instant (default now). The server uses the
// same zone, so a row's group never disagrees with its due date.
function WB_today(now) {
  var ms = now == null ? Date.now() : now instanceof Date ? now.getTime() : typeof now === "number" ? now : Date.parse(now);
  if (isNaN(ms)) return null;
  var p = WB__chicagoParts(ms);
  return p.year + "-" + WB__pad2(p.month) + "-" + WB__pad2(p.day);
}

function WB_addDays(ymd, n) {
  var ms = WB__utcOf(ymd);
  return isNaN(ms) ? null : WB__ymdFromUTC(ms + Math.round(Number(n) || 0) * 86400000);
}
function WB_dayDiff(fromYmd, toYmd) {
  var a = WB__utcOf(fromYmd);
  var b = WB__utcOf(toYmd);
  return isNaN(a) || isNaN(b) ? NaN : Math.round((b - a) / 86400000);
}
function WB_weekday(ymd) {
  var ms = WB__utcOf(ymd);
  return isNaN(ms) ? NaN : new Date(ms).getUTCDay();
}
function WB_isBusinessDay(ymd) {
  var w = WB_weekday(ymd);
  return w >= 1 && w <= 5;
}
// Same rule as tk_add_business_days / TK_addBusinessDays: weekends skipped.
function WB_addBusinessDays(ymd, n) {
  if (isNaN(WB__utcOf(ymd))) return null;
  var cur = ymd;
  var left = Math.max(0, Math.floor(Number(n) || 0));
  if (left === 0) {
    while (!WB_isBusinessDay(cur)) cur = WB_addDays(cur, 1);
    return cur;
  }
  while (left > 0) {
    cur = WB_addDays(cur, 1);
    if (WB_isBusinessDay(cur)) left--;
  }
  return cur;
}

// The UTC instant of hh:mm on a Chicago calendar day (DST-safe).
function WB_chicagoAt(ymd, hh, mm) {
  var base = WB__utcOf(ymd);
  if (isNaN(base)) return NaN;
  var want = base + ((hh || 0) * 60 + (mm || 0)) * 60000;
  // Chicago is UTC-5 or UTC-6; start at -6 and correct once (twice at a switch).
  var guess = want + 6 * 3600000;
  for (var i = 0; i < 3; i++) {
    var p = WB__chicagoParts(guess);
    var seen = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    var diff = want - seen;
    if (diff === 0) break;
    guess += diff;
  }
  return guess;
}

// ---- Acknowledgements (spec B5) --------------------------------------------
// Mirror of public.wb_is_ack in supabase/workbench-1-core.sql. Parity cases
// live in both test files; change both together.
var WB_ACK_RE =
  /^((thanks|thank you|thank you so much|thanks so much|ty|thx|ok|okay|k|got it|sounds good|perfect|great|awesome|will do|noted|\uD83D\uDC4D)[\s,.!]*)+$/i;
function WB_isAck(body) {
  if (body == null) return false;
  var s = String(body).replace(/^ +| +$/g, ""); // btrim trims spaces only
  var len = Array.from(s).length;
  if (len < 1 || len > 60) return false;
  if (s.indexOf("?") !== -1) return false;
  return WB_ACK_RE.test(s);
}

// ---- Rank and group (spec C) -----------------------------------------------
var WB_RANK = {
  task_review: 0,
  gl_approve: 0,
  client_answered: 0,
  gl_answer: 0,
  message: 1,
  doc_request: 1,
  doc_upload: 1,
  task_sent_back: 2,
  gl_sent_back: 2,
  task: 3,
};
function WB_rank(row) {
  if (!row) return 9;
  if (row.source === "other") return 5;
  if (row.kind === "gl_flags") return row.severity === "high" ? 3 : 4;
  var r = WB_RANK[row.kind];
  return r == null ? 5 : r;
}

function WB__waitYmd(row) {
  if (!row || !row.waiting_since) return null;
  var ms = Date.parse(row.waiting_since);
  return isNaN(ms) ? null : WB_today(ms);
}

// "overdue" | "today" | "week" | "later". Rows fed in from Today carry
// `group` already (their own now/week buckets).
function WB_groupOf(row, today) {
  if (!row) return "later";
  if (row.group === "today" || row.group === "week" || row.group === "overdue") return row.group;
  var due = row.due_date ? String(row.due_date).slice(0, 10) : null;
  if (due) {
    if (due < today) return "overdue";
    if (due === today) return "today";
    return WB_dayDiff(today, due) <= WB_SOON_DAYS ? "week" : "later";
  }
  // No due date: waiting longer than one business day belongs in Today.
  var w = WB__waitYmd(row);
  if (w && WB_addBusinessDays(w, 1) <= today) return "today";
  return "week";
}

function WB__cmpStr(a, b) {
  a = a == null ? "" : String(a);
  b = b == null ? "" : String(b);
  return a < b ? -1 : a > b ? 1 : 0;
}
function WB__cmpNullLast(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return WB__cmpStr(a, b);
}
// Deterministic (spec C4): rank, due, waiting since, client, then key.
function WB_compare(a, b) {
  var d = WB_rank(a) - WB_rank(b);
  if (d) return d;
  d = WB__cmpNullLast(a.due_date || null, b.due_date || null);
  if (d) return d;
  var wa = a.waiting_since ? Date.parse(a.waiting_since) : null;
  var wb = b.waiting_since ? Date.parse(b.waiting_since) : null;
  if (wa != null && isNaN(wa)) wa = null;
  if (wb != null && isNaN(wb)) wb = null;
  if (wa != null || wb != null) {
    if (wa == null) return 1;
    if (wb == null) return -1;
    if (wa !== wb) return wa - wb;
  }
  if ((a._ord != null || b._ord != null) && a._ord !== b._ord) return (a._ord == null ? 1e9 : a._ord) - (b._ord == null ? 1e9 : b._ord);
  d = WB__cmpStr((a.client_name || "").toLowerCase(), (b.client_name || "").toLowerCase());
  if (d) return d;
  return WB__cmpStr(a.item_key, b.item_key);
}
function WB_sort(rows) {
  return (rows || []).slice().sort(WB_compare);
}

// Snoozed now? The server returns snoozed_until only while the item's
// version still matches; an optimistic local snooze carries its version so
// a change that arrives later resurfaces the row (spec K-Q10).
function WB_isSnoozed(row, nowMs) {
  if (!row || !row.snoozed_until) return false;
  if (row.snoozed_version != null && row.snoozed_version !== row.version) return false;
  var u = Date.parse(row.snoozed_until);
  return !isNaN(u) && u > (nowMs == null ? Date.now() : nowMs);
}

function WB_chipOf(row) {
  return row && WB_SOURCE_LABEL[row.source] ? row.source : "other";
}

// The whole view model (spec C1-C6).
// opts: { today, now (ms), chip ("all" | source | "snoozed") }
// Returns { groups:[{id,label,rows}], counts:{all, task, …, snoozed}, later,
//           tiles:{reply, dueToday, overdue, reviews}, badge, visible }.
function WB_build(rows, opts) {
  var o = opts || {};
  var today = o.today || WB_today();
  var now = o.now == null ? Date.now() : o.now;
  var chip = o.chip || "all";
  var counts = { all: 0, task: 0, review: 0, message: 0, gl: 0, doc: 0, other: 0, snoozed: 0 };
  var tiles = { reply: 0, dueToday: 0, overdue: 0, reviews: 0 };
  var buckets = { overdue: [], today: [], week: [] };
  var later = 0;
  var badge = 0;
  (rows || []).forEach(function (r) {
    if (!r || r.cleared) return;
    var g = WB_groupOf(r, today);
    if (g === "later") {
      later++;
      return;
    }
    if (WB_isSnoozed(r, now)) {
      counts.snoozed++;
      if (chip === "snoozed") buckets[g].push(r);
      return;
    }
    var c = WB_chipOf(r);
    counts.all++;
    counts[c]++;
    if (r.kind === "message") tiles.reply++;
    if (g === "today") tiles.dueToday++;
    if (g === "overdue") tiles.overdue++;
    // Same rows as the Reviews chip the tile opens (reviews to do, and your
    // work sent back); Ledger approvals sit under the Ledger chip.
    if (c === "review") tiles.reviews++;
    if ((g === "today" || g === "overdue") && r.source !== "other") badge++;
    if (chip === "snoozed") return;
    if (chip === "all" || chip === c) buckets[g].push(r);
  });
  var visible = 0;
  var groups = WB_GROUPS.map(function (gr) {
    var list = WB_sort(buckets[gr.id]);
    visible += list.length;
    return { id: gr.id, label: gr.label, rows: list };
  }).filter(function (gr) {
    return gr.rows.length > 0;
  });
  return { groups: groups, counts: counts, later: later, tiles: tiles, badge: badge, visible: visible };
}

// Drawer tab → chip id (Files = documents).
function WB_drawerChip(tab) {
  return tab === "task" || tab === "review" || tab === "message" || tab === "doc" ? tab : "all";
}

// The collapsed drawer's "next item": first row of the first group.
function WB_nextRow(view) {
  if (!view || !view.groups || !view.groups.length) return null;
  return view.groups[0].rows[0] || null;
}

// ---- Hub (Workbench Hub spec H1) ---------------------------------------------
// The panel's tabs: Inbox (H1), Slate (H2) and Client (H4). A tab that
// isn't live falls back to Inbox when a saved state is read.
var WB_HUB_TABS = [
  { id: "inbox", label: "Inbox", live: true },
  { id: "tasks", label: WB_SLATE, live: true },
  { id: "client", label: "Client", live: true },
];
// localStorage. The saved state is per signed-in person: "mgb_wb_hub:<email>"
// (WB_hubKey), so someone else on the same browser never inherits a filter,
// scroll or open panel. WB_HUB_KEY alone is the old unscoped key: it is never
// read again and is removed on first sign-in. The mgb_ prefix lets Dev Tools
// Reset local state clear both.
var WB_HUB_KEY = "mgb_wb_hub";
// base: the MGB Desk window saves under WB_HUB_WIN_KEY, so the two windows
// never overwrite each other's tab, drill or open state.
function WB_hubKey(email, base) {
  var e = String(email == null ? "" : email).trim().toLowerCase();
  return e ? (base || WB_HUB_KEY) + ":" + e : null;
}
// The page a saved panel belongs to: the hash without its query. A saved
// open panel comes back only on the same page and not on a link that brings
// you to an item (?item=...).
function WB_hubRoute(hash) {
  var h = String(hash == null ? "" : hash);
  var i = h.indexOf("?");
  return (i >= 0 ? h.slice(0, i) : h).slice(0, 120);
}
function WB_hubArrival(hash) {
  return /[?&]item=/.test(String(hash == null ? "" : hash));
}
var WB_HUB_OPEN_MS = 5 * 60 * 1000; // a reload inside this window reopens the hub
var WB_HUB_SCROLL_MS = 30 * 60 * 1000; // scroll positions older than this are dropped

function WB_hubTabIds(live) {
  return WB_HUB_TABS.filter(function (t) {
    return !live || t.live;
  }).map(function (t) {
    return t.id;
  });
}

function WB_hubDefault() {
  return { open: false, tab: "inbox", chip: "all", clientId: null, scrollClientId: null, scroll: { inbox: 0, tasks: 0, client: 0 }, collapsed: {}, lastFocus: null };
}

// My tasks groups the hub can collapse (never done or unassigned).
var WB_HUB_TASK_GROUPS = ["overdue", "today", "week", "later", "waiting"];

function WB__collapsedClean(c) {
  var out = {};
  var x = c && typeof c === "object" ? c : {};
  WB_HUB_TASK_GROUPS.forEach(function (k) {
    if (x[k] === true) out[k] = true;
    else if (x[k] === false) out[k] = false;
  });
  return out;
}

function WB__scrollNum(v) {
  var n = Math.round(Number(v));
  return isFinite(n) && n > 0 ? Math.min(n, 1000000) : 0;
}

// Any object in, a valid hub state out. Unknown tabs and chips fall back.
function WB_hubClean(h) {
  var d = WB_hubDefault();
  var x = h && typeof h === "object" ? h : {};
  var sc = x.scroll && typeof x.scroll === "object" ? x.scroll : {};
  var chipOk = WB_DRAWER_TABS.some(function (t) {
    return t.id === x.chip;
  });
  var clientId = typeof x.clientId === "string" && x.clientId.length < 80 ? x.clientId : null;
  // The Client tab's scroll belongs to the client it was saved on
  // (scrollClientId); another client starts at the top.
  var scrollFor = typeof x.scrollClientId === "string" && x.scrollClientId.length < 80 ? x.scrollClientId : null;
  var clientScroll = scrollFor === clientId ? WB__scrollNum(sc.client) : 0;
  return {
    open: x.open === true,
    tab: WB_hubTabIds(true).indexOf(x.tab) >= 0 ? x.tab : d.tab,
    chip: chipOk ? x.chip : d.chip,
    clientId: clientId,
    scrollClientId: clientScroll ? scrollFor : null,
    scroll: { inbox: WB__scrollNum(sc.inbox), tasks: WB__scrollNum(sc.tasks), client: clientScroll },
    collapsed: WB__collapsedClean(x.collapsed),
    lastFocus: typeof x.lastFocus === "string" ? x.lastFocus : null,
  };
}

// Merge a patch (scroll merges per tab) and clean the result.
function WB_hubMerge(hub, patch) {
  var cur = WB_hubClean(hub);
  var p = patch && typeof patch === "object" ? patch : {};
  var next = Object.assign({}, cur, p);
  if (p.scroll && typeof p.scroll === "object") next.scroll = Object.assign({}, cur.scroll, p.scroll);
  if (p.collapsed && typeof p.collapsed === "object") next.collapsed = Object.assign({}, cur.collapsed, p.collapsed);
  return WB_hubClean(next);
}

// What goes to localStorage. lastFocus stays in memory. route is the page
// the panel was open on (WB_hubRoute).
function WB_hubSerialize(hub, now, route) {
  var h = WB_hubClean(hub);
  return JSON.stringify({
    v: 1,
    at: now,
    route: typeof route === "string" ? WB_hubRoute(route) : null,
    open: h.open,
    tab: h.tab,
    chip: h.chip,
    clientId: h.clientId,
    scrollClientId: h.scrollClientId,
    scroll: h.scroll,
    collapsed: h.collapsed,
  });
}

// Saved text in, hub state out. Never throws. Old saves (more than 5 minutes)
// don't reopen the hub, a save from the future is not trusted, and 30 minutes
// drops the scroll position. ctx = { hash } (the page's current hash): the
// panel reopens only when it was saved on that same page and the link does
// not carry an item (?item=...). Without ctx only the clock decides.
function WB_hubParse(raw, now, ctx) {
  var d = WB_hubDefault();
  if (!raw) return d;
  var o;
  try {
    o = JSON.parse(raw);
  } catch (e) {
    return d;
  }
  if (!o || typeof o !== "object" || o.v !== 1) return d;
  var h = WB_hubClean(o);
  var age = Number(now) - Number(o.at);
  if (!isFinite(age) || age < 0 || age > WB_HUB_OPEN_MS) h.open = false;
  if (!isFinite(age) || age < 0 || age > WB_HUB_SCROLL_MS) h.scroll = d.scroll;
  if (ctx && typeof ctx === "object") {
    var hash = ctx.hash == null ? "" : String(ctx.hash);
    if (WB_hubArrival(hash) || typeof o.route !== "string" || o.route !== WB_hubRoute(hash)) h.open = false;
  }
  h.lastFocus = null;
  return h;
}

// ---- My tasks tab (H2) -------------------------------------------------------
var WB_HUB_TASK_CAP = 200; // rows shown before "Show all on Slate"

// TK_myGroupsView output in, the hub's groups out: only open groups assigned
// to me (no Done, no Unassigned), then at most `cap` tasks in order. Each
// group keeps its full count in `total`. Returns
// { groups, total, shown, more } where total counts every open task.
// opts.anyKey (rhythm slice 0): the Slate view control grouped by Client, Part
// of month or Status, so any group key is drawn (the caller has already left
// Done and Unassigned out). Without it the whitelist applies as before.
function WB_hubTaskGroups(view, cap, opts) {
  var max = cap == null ? WB_HUB_TASK_CAP : Math.max(0, Math.floor(Number(cap)) || 0);
  var anyKey = !!(opts && opts.anyKey);
  var groups = [];
  var total = 0;
  var shown = 0;
  var expanded = 0;
  (Array.isArray(view) ? view : []).forEach(function (g) {
    if (!g || (!anyKey && WB_HUB_TASK_GROUPS.indexOf(g.key) < 0) || !Array.isArray(g.tasks) || !g.tasks.length) return;
    total += g.tasks.length;
    // A folded group draws no rows, so it neither uses the cap nor counts as "more".
    var tasks = [];
    if (!g.collapsed) {
      expanded += g.tasks.length;
      tasks = g.tasks.slice(0, Math.max(0, max - shown));
      shown += tasks.length;
    }
    // A group the cap cut to nothing keeps its header and full count.
    groups.push({ key: g.key, label: g.label, tasks: tasks, total: g.tasks.length, collapsed: !!g.collapsed });
  });
  return { groups: groups, total: total, shown: shown, more: expanded - shown };
}

// Has the My tasks list settled? True once a load started and finished, or
// there are rows, or it failed. Before that the tab shows its skeleton and
// reports no count (never a false 0). listState {loading, tasks, error}.
// Reload the hub list for a missing-task set at most once per distinct set:
// a reload that still disagrees with the store must not loop forever.
function WB_hubShouldReload(missingStr, lastReloadedStr, loadedOnce) {
  if (!missingStr || !loadedOnce) return false;
  return missingStr !== (lastReloadedStr || "");
}

function WB_hubTasksReady(listState, sawLoading) {
  var l = listState || {};
  if (Array.isArray(l.tasks) && l.tasks.length > 0) return true;
  if (l.error) return true;
  return !!sawLoading && !l.loading;
}

// ---- Client tab (H4) ---------------------------------------------------------
// Pinned clients are per person, in their own key next to the hub state:
// "mgb_wb_pins:<email>" (mgb_ so Dev Tools Reset local state clears it). At
// most WB_PINS_CAP; the newest pin is first and pinning one more drops the
// oldest. This browser only (no cross-computer sync yet).
var WB_PINS_KEY = "mgb_wb_pins";
var WB_PINS_CAP = 8;
var WB_HUB_RECENT_MAX = 5; // recents shown in the picker
var WB_HUB_PICK_LIMIT = 50; // rows the picker lists at most

function WB_pinsKey(email) {
  var e = String(email == null ? "" : email).trim().toLowerCase();
  return e ? WB_PINS_KEY + ":" + e : null;
}

function WB__idOk(v) {
  return typeof v === "string" && v.length > 0 && v.length < 80;
}

// Clean list of client ids: strings, no repeats, at most cap.
function WB_pinsClean(list, cap) {
  var max = cap == null ? WB_PINS_CAP : Math.max(0, Math.floor(Number(cap)) || 0);
  var out = [];
  (Array.isArray(list) ? list : []).forEach(function (v) {
    var id = typeof v === "number" && isFinite(v) ? String(v) : v;
    if (WB__idOk(id) && out.indexOf(id) < 0 && out.length < max) out.push(id);
  });
  return out;
}

// Saved text in, pins out. Never throws.
function WB_pinsParse(raw) {
  if (!raw) return [];
  try {
    var o = JSON.parse(raw);
    return WB_pinsClean(o && typeof o === "object" && !Array.isArray(o) ? o.pins : o);
  } catch (e) {
    return [];
  }
}
function WB_pinsSerialize(pins) {
  return JSON.stringify({ v: 1, pins: WB_pinsClean(pins) });
}

// Pin or unpin `id`. Returns { pins, on, dropped } where on is the new state
// and dropped is the id pushed off the end (or null).
function WB_pinsToggle(pins, id, cap) {
  var max = cap == null ? WB_PINS_CAP : Math.max(1, Math.floor(Number(cap)) || 1);
  var cur = WB_pinsClean(pins, 1000);
  var key = id == null ? "" : String(id);
  if (!WB__idOk(key)) return { pins: cur.slice(0, max), on: false, dropped: null };
  var at = cur.indexOf(key);
  if (at >= 0) {
    cur.splice(at, 1);
    return { pins: cur.slice(0, max), on: false, dropped: null };
  }
  var next = [key].concat(cur);
  var dropped = next.length > max ? next[max] : null;
  return { pins: next.slice(0, max), on: true, dropped: dropped };
}

function WB__clientIndex(clients) {
  var byId = {};
  (Array.isArray(clients) ? clients : []).forEach(function (c) {
    if (c && c.id != null && c.id !== "") byId[String(c.id)] = c;
  });
  return byId;
}

// A pin for a client that isn't in my list (no access, or the list is still
// loading or partial) is never deleted: WB_hubClientOptions just doesn't list
// it, and it shows again once the client is in the list.

// Which client the tab shows: the client page I am on wins, then the one the
// tab last showed. access is true (in my client list), false (not in it: the
// tab says "You don't have access to this client" and never shows a name) or
// null (the list is not loaded yet). from is "route", "saved" or null.
function WB_hubPickClient(savedId, routeId, clients) {
  var route = routeId == null || routeId === "" ? null : String(routeId);
  var saved = savedId == null || savedId === "" ? null : String(savedId);
  var id = WB__idOk(route) ? route : WB__idOk(saved) ? saved : null;
  var from = id == null ? null : id === route ? "route" : "saved";
  if (id == null) return { id: null, from: null, access: null, client: null };
  if (!Array.isArray(clients) || !clients.length) return { id: id, from: from, access: null, client: null };
  var c = WB__clientIndex(clients)[id] || null;
  return { id: id, from: from, access: !!c, client: c };
}

function WB__clientName(c) {
  return String((c && c.name) || "").trim();
}
function WB__byName(a, b) {
  var x = WB__clientName(a).toLowerCase();
  var y = WB__clientName(b).toLowerCase();
  if (x !== y) return x < y ? -1 : 1;
  return String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0;
}

// The picker's rows. No query: Pinned (pin order), Recent (not pinned, at most
// WB_HUB_RECENT_MAX), then All clients by name. A query: Matches across every
// client I can see, names that start with it first, then names that contain
// it, each by name. Only clients in `clients` ever show (no server query).
// Returns { sections: [{ id, label, items: [{ id, name, pinned }] }], items }
// where items is every row in order (for arrow keys), at most `limit`.
function WB_hubClientOptions(clients, pins, recents, query, limit) {
  var max = limit == null ? WB_HUB_PICK_LIMIT : Math.max(1, Math.floor(Number(limit)) || 1);
  var byId = WB__clientIndex(clients);
  var pinIds = WB_pinsClean(pins).filter(function (id) {
    return !!byId[id];
  });
  var pinned = {};
  pinIds.forEach(function (id) {
    pinned[id] = 1;
  });
  var all = Object.keys(byId)
    .map(function (id) {
      return byId[id];
    })
    .filter(function (c) {
      return WB__clientName(c);
    });
  var item = function (c) {
    return { id: String(c.id), name: WB__clientName(c), pinned: !!pinned[String(c.id)] };
  };
  var used = 0;
  var total = 0; // rows before the cap
  var take = function (list) {
    total += list.length;
    var room = Math.max(0, max - used);
    var out = list.slice(0, room);
    used += out.length;
    return out;
  };
  var sections = [];
  var push = function (id, label, list) {
    var items = take(list);
    if (items.length) sections.push({ id: id, label: label, items: items });
  };
  var q = String(query == null ? "" : query).trim().toLowerCase();
  if (q) {
    var starts = [];
    var has = [];
    all.forEach(function (c) {
      var n = WB__clientName(c).toLowerCase();
      var at = n.indexOf(q);
      if (at === 0) starts.push(c);
      else if (at > 0) has.push(c);
    });
    starts.sort(WB__byName);
    has.sort(WB__byName);
    push("matches", "Matches", starts.concat(has).map(item));
  } else {
    var seen = {};
    var pinRows = pinIds
      .map(function (id) {
        seen[id] = 1;
        return byId[id];
      })
      .filter(function (c) {
        return WB__clientName(c);
      });
    push("pinned", "Pinned", pinRows.map(item));
    var recentRows = [];
    WB_pinsClean(recents, 1000).forEach(function (id) {
      if (seen[id] || !byId[id] || !WB__clientName(byId[id]) || recentRows.length >= WB_HUB_RECENT_MAX) return;
      seen[id] = 1;
      recentRows.push(byId[id]);
    });
    push("recent", "Recent", recentRows.map(item));
    push(
      "all",
      "All clients",
      all
        .filter(function (c) {
          return !seen[String(c.id)];
        })
        .sort(WB__byName)
        .map(item),
    );
  }
  var items = [];
  sections.forEach(function (sec) {
    items = items.concat(sec.items);
  });
  return { sections: sections, items: items, total: total, capped: total > items.length };
}

// The clients the picker lists: MGB (internal) left out, and test clients
// hidden while my "Show test clients" switch is off (the same rule as CF_pick
// in components/staff/ClientFlags.jsx), except the one the tab shows (keepId).
// Access is still decided by the full list (WB_hubPickClient), not this one.
function WB_hubPickerPool(clients, showTest, keepId) {
  var keep = keepId == null ? null : String(keepId);
  return (Array.isArray(clients) ? clients : []).filter(function (c) {
    if (!c || c.isInternal === true) return false;
    if (c.testOnly !== true || showTest) return true;
    return keep != null && String(c.id) === keep;
  });
}

// The Client tab's own list key (TK_stMatches places tasks in it by client).
function WB_hubClientListKey(id) {
  return WB__idOk(id == null ? null : String(id)) ? "wb:client:" + String(id) : null;
}

// Esc in a field that clears itself on Esc and still has text (the add row
// .tk-add-input, the client picker .wb-pick-input, or a field marked
// data-esc-clears) clears it first; the hub closes on the next Esc. Any other
// field (a filled contacts form, a checkbox) lets Esc close the hub as before.
// f = { tag, type, value, inPanel, clears }: clears says the element matches
// WB_ESC_CLEARS_SEL.
var WB_ESC_CLEARS_SEL = ".tk-add-input, .wb-pick-input, [data-esc-clears]";
function WB_escKeepsField(f) {
  var x = f && typeof f === "object" ? f : {};
  if (!x.inPanel || !x.clears) return false;
  var t = String(x.tag || "").toUpperCase();
  var type = String(x.type || "text").toLowerCase();
  if (t === "INPUT" && (type === "checkbox" || type === "radio" || type === "button" || type === "submit")) return false;
  return (t === "INPUT" || t === "TEXTAREA") && String(x.value == null ? "" : x.value) !== "";
}

// Arrow keys on the tab list (ARIA tabs): returns the tab to move to, or null.
function WB_tabMove(ids, cur, key) {
  if (!ids || !ids.length) return null;
  var i = Math.max(0, ids.indexOf(cur));
  if (key === "ArrowRight") return ids[(i + 1) % ids.length];
  if (key === "ArrowLeft") return ids[(i - 1 + ids.length) % ids.length];
  if (key === "Home") return ids[0];
  if (key === "End") return ids[ids.length - 1];
  return null;
}

// Layers that can sit above the hub (spec 2.3). z is the stacking order, high
// on top; stacked layers are the drawers and dialogs (they dim the page
// themselves, so the hub's own scrim stops taking clicks while one is open).
var WB_LAYERS = [
  { id: "menu", sel: ".wb-menu", z: 3000, stacked: false },
  // A My tasks row's status menu (TK_TaskRow) lives inside the panel; Esc must close it before the hub.
  { id: "tk-menu", sel: ".wb-panel .tk-menu[role='menu']", z: 3000, stacked: false },
  // R2: the task view's More menu (TK_dwMenu) closes before the task view.
  { id: "tk-dw-menu", sel: ".wb-panel .tk-dw-menu[role='menu']", z: 3000, stacked: false },
  // The Client tab's client picker list (H4): Esc closes the list before the hub.
  { id: "picker", sel: ".wb-panel .wb-pick-list", z: 3000, stacked: false },
  { id: "tour", sel: ".tour-root", z: 2900, stacked: false },
  { id: "modal", sel: ".modal-overlay", z: 2000, stacked: true },
  { id: "aria-modal", sel: '[aria-modal="true"]:not(.wb-panel)', z: 1900, stacked: true },
  { id: "task-drawer", sel: ".tk-dw-layer", z: 1850, stacked: true },
  { id: "client-drawer", sel: ".tk-cd-layer", z: 1840, stacked: true },
  { id: "chat-drawer", sel: ".si-drawer-layer", z: 1835, stacked: true },
];
var WB_LAYER_SELECTORS = WB_LAYERS.map(function (l) {
  return l.sel;
});

// has(selector) -> boolean. Returns the ids present, top layer first.
function WB_layersPresent(has) {
  return WB_LAYERS.filter(function (l) {
    return !!has(l.sel);
  })
    .sort(function (a, b) {
      return b.z - a.z;
    })
    .map(function (l) {
      return l.id;
    });
}
// Any layer above the hub: it gets Esc, Tab and W first.
function WB_layerAbove(ids) {
  return !!ids && ids.length > 0;
}
// A drawer or dialog is stacked over the hub.
function WB_isStacked(ids) {
  return (ids || []).some(function (id) {
    return WB_LAYERS.some(function (l) {
      return l.id === id && l.stacked;
    });
  });
}

// What a row does in the hub (spec 2.4). Tasks and reviews open in the task
// drawer on top of the hub; a client message opens the chat drawer on that
// person and a new client file opens in Drive (H3), both without leaving the
// page. Everything else keeps going where it lives. A message with no client
// or a file with no id has nothing to open in place, so it goes where it lives.
function WB_hubAction(row) {
  if (!row || row.source === "other") return { type: "own" };
  switch (row.kind) {
    case "task":
    case "task_sent_back":
    case "task_review":
      return row.source_id ? { type: "task", taskId: String(row.source_id) } : { type: "go" };
    case "client_answered":
    case "doc_request":
      return row.ref_id && row.ref_id !== row.source_id ? { type: "task", taskId: String(row.ref_id) } : { type: "go" };
    case "message":
      return row.client_id
        ? { type: "chat", clientId: String(row.client_id), email: row.participant_email ? String(row.participant_email) : null }
        : { type: "go" };
    case "doc_upload":
      return row.source_id ? { type: "file", fileId: String(row.source_id) } : { type: "go" };
    default:
      return { type: "go" };
  }
}

// The hub's main button: tasks Open (a todo task's Start moves to the menu),
// messages Reply, new files Open file.
function WB_hubPrimary(row) {
  var p = WB_primaryAction(row);
  if (p && p.id === "start" && WB_hubAction(row).type === "task") return { id: "open", label: "Open" };
  if (p && row.kind === "doc_upload" && WB_hubAction(row).type === "file") return { id: "open", label: "Open file" };
  return p;
}

// The hub's menu: Start, Snooze, Open full page for task rows; the clearing
// action, Snooze, Open full page for messages and files.
function WB_hubMenu(row) {
  var items = WB_menuActions(row);
  if (!row || row.source === "other") return items;
  var kind = WB_hubAction(row).type;
  if (kind === "chat" || kind === "file") return items.concat([{ id: "fullpage", label: "Open full page" }]);
  if (kind !== "task") return items;
  var out = [];
  if (row.kind === "task" && row.status === "todo") out.push({ id: "start", label: "Start" });
  items.forEach(function (a) {
    if (a.id !== "open") out.push(a);
  });
  out.push({ id: "fullpage", label: "Open full page" });
  return out;
}

// ---- Feed Today's other rows in (spec E1) ----------------------------------
// Today kinds Workbench already covers from the server stay out.
var WB_TD_SKIP = { reply: 1, task: 1 };
// td: { now:[…], week:[…] } from TD_buildRows. Keeps each row's own actions.
function WB_fromToday(td) {
  var out = [];
  var ord = 0;
  ["now", "week"].forEach(function (bucket) {
    ((td && td[bucket]) || []).forEach(function (r) {
      if (!r || WB_TD_SKIP[r.kind]) return;
      out.push({
        item_key: "other:" + String(r.kind || "item").replace(/[^a-z_]/g, "_") + ":" + String(r.key || ord),
        source: "other",
        kind: "other",
        td_kind: r.kind,
        title: r.title,
        detail: r.detail || null,
        client_name: null,
        due_date: null,
        waiting_since: null,
        group: bucket === "now" ? "today" : "week",
        _ord: ord++,
        _td: r,
      });
    });
  });
  return out;
}

// ---- Actions per kind (spec D2) --------------------------------------------
// One primary action; the rest go in the ⋯ menu.
function WB_primaryAction(row) {
  if (!row) return null;
  switch (row.kind) {
    case "task":
      return row.status === "todo" ? { id: "start", label: "Start" } : { id: "open", label: "Open" };
    case "task_sent_back":
      return { id: "open", label: "Open" };
    case "message":
      return { id: "reply", label: "Reply" };
    case "doc_upload":
      return { id: "open", label: "File" };
    case "task_review":
    case "client_answered":
    case "gl_flags":
    case "gl_sent_back":
    case "gl_approve":
    case "gl_answer":
    case "doc_request":
      return { id: "open", label: "Review" };
    default:
      return null; // other rows keep their own buttons
  }
}

function WB_menuActions(row) {
  if (!row || row.source === "other") return [];
  var out = [];
  if (row.kind === "task" && row.status === "todo") out.push({ id: "open", label: "Open" });
  if ((row.kind === "client_answered" || row.kind === "doc_request") && row.ref_id && row.ref_id !== row.source_id)
    out.push({ id: "request", label: "Open request" });
  if (row.kind === "message") out.push({ id: "noreply", label: "No reply needed" });
  if (row.kind === "doc_upload") out.push({ id: "checked", label: "Mark checked" });
  out.push({ id: "snooze", label: "Snooze" });
  return out;
}

// The "e" key: No reply needed (message) or Mark checked (upload).
function WB_clearAction(row) {
  if (!row) return null;
  if (row.kind === "message") return "noreply";
  if (row.kind === "doc_upload") return "checked";
  return null;
}

// Where a row lands: { t, hint } for LK_go, or { hash } for a raw route.
// action: "open" (default) or "request".
function WB_linkTarget(row, action) {
  if (!row || row.source === "other") return null;
  var cid = row.client_id || null;
  switch (row.kind) {
    case "task":
    case "task_sent_back":
      return { t: { place: "work", tab: "tasks", item: "task:" + row.source_id } };
    case "task_review":
      return { t: { place: "tasks", tab: "review", item: "task:" + row.source_id } };
    case "client_answered":
    case "doc_request":
      // Ask-client requests: Review opens the task (the answer shows there);
      // a request with no task opens the client's Requests list.
      if (action !== "request" && row.ref_id && row.ref_id !== row.source_id)
        return { t: { place: "work", tab: "tasks", item: "task:" + row.ref_id } };
      return cid ? { t: { clientId: cid, tab: "needs", sub: row.source_id } } : null;
    case "message":
      return cid
        ? { t: { clientId: cid, tab: "messages", item: "msg:" + (row.ref_id || row.source_id) }, hint: { email: row.participant_email || null } }
        : null;
    case "gl_flags":
    case "gl_sent_back":
    case "gl_approve":
      return cid ? { t: { clientId: cid, tab: "ledger", month: row.period || undefined } } : null;
    case "gl_answer":
      return cid ? { t: { clientId: cid, tab: "ledger", item: "question:" + row.source_id, month: row.period || undefined } } : null;
    case "doc_upload":
      return cid ? { t: { clientId: cid, tab: "files", item: "file:" + row.source_id } } : null;
    default:
      return null;
  }
}

// ---- Keyboard (spec D4) ----------------------------------------------------
// Returns { type, … } or null. Typing in inputs is filtered by the caller.
function WB_keyAction(key, mods) {
  var m = mods || {};
  if (m.ctrl || m.meta || m.alt) return null;
  switch (key) {
    case "j":
    case "ArrowDown":
      return { type: "move", delta: 1 };
    case "k":
    case "ArrowUp":
      return { type: "move", delta: -1 };
    case "Enter":
      return { type: "primary" };
    case "o":
      return { type: "open" };
    case "s":
      return { type: "snooze" };
    case "e":
      return { type: "clear" };
    case "?":
      return { type: "help" };
    case "0":
      return { type: "chip", chip: "all" };
    default:
      if (/^[1-6]$/.test(key)) return { type: "chip", chip: WB_CHIPS[+key].id };
      return null;
  }
}

// ---- Snooze (spec D2) ------------------------------------------------------
// Preset → ISO instant. now: ms. pick: "YYYY-MM-DD" for "date".
function WB_snoozeUntil(preset, now, pick) {
  var ms = now == null ? Date.now() : now;
  var today = WB_today(ms);
  var at;
  if (preset === "later") at = ms + 3 * 3600000;
  else if (preset === "tomorrow") at = WB_chicagoAt(WB_addDays(today, 1), 8, 0);
  else if (preset === "monday") {
    var w = WB_weekday(today);
    var add = ((8 - w) % 7) || 7; // the next Monday, never today
    at = WB_chicagoAt(WB_addDays(today, add), 8, 0);
  } else if (preset === "date") {
    if (!WB__YMD_RE.test(String(pick || ""))) return null;
    at = WB_chicagoAt(pick, 8, 0);
  } else return null;
  if (isNaN(at) || at <= ms) return null;
  at = Math.min(at, ms + WB_SNOOZE_MAX_DAYS * 86400000);
  return new Date(at).toISOString();
}
var WB_SNOOZE_PRESETS = [
  { id: "later", label: "Later today" },
  { id: "tomorrow", label: "Tomorrow 8am" },
  { id: "monday", label: "Next Monday 8am" },
  { id: "date", label: "Pick a date" },
];

// ---- Text ------------------------------------------------------------------
var WB__DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function WB__ago(ms, now) {
  var mins = Math.max(0, Math.floor((now - ms) / 60000));
  if (mins < 60) return mins <= 1 ? "1 min" : mins + " min";
  var h = Math.floor(mins / 60);
  if (h < 24) return h + "h";
  var d = Math.floor(h / 24);
  return d + (d === 1 ? " day" : " days");
}
// "2 days overdue" / "Due today" / "Due Fri" / "Waiting 3h".
function WB_whenText(row, today, now) {
  if (!row || row.source === "other") return "";
  var due = row.due_date ? String(row.due_date).slice(0, 10) : null;
  var n = now == null ? Date.now() : now;
  var waitMs = row.waiting_since ? Date.parse(row.waiting_since) : NaN;
  var waiting = row.kind === "message" || row.kind === "client_answered" || row.kind === "gl_answer" || row.kind === "doc_upload" || row.kind === "doc_request";
  if (waiting && !isNaN(waitMs)) return "Waiting " + WB__ago(waitMs, n);
  if (due) {
    var d = WB_dayDiff(today, due);
    if (d < 0) return -d === 1 ? "1 day overdue" : -d + " days overdue";
    if (d === 0) return "Due today";
    if (d === 1) return "Due tomorrow";
    return "Due " + WB__DOW[WB_weekday(due)];
  }
  if (!isNaN(waitMs)) return "Waiting " + WB__ago(waitMs, n);
  return "";
}
function WB_updatedText(atMs, now) {
  if (!atMs) return "";
  var mins = Math.floor(((now == null ? Date.now() : now) - atMs) / 60000);
  if (mins < 1) return "Updated just now";
  if (mins < 60) return "Updated " + mins + " min ago";
  return "Updated " + Math.floor(mins / 60) + "h ago";
}

// Short label for a period ("2026-09" → "Sep 2026").
var WB__MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function WB_periodLabel(p) {
  var m = /^(\d{4})-(\d{2})/.exec(String(p || ""));
  return m ? WB__MON[+m[2] - 1] + " " + m[1] : "";
}

// Feature switch: tk_settings.wb_enabled (unset = off), the per-person
// preview, and the "Classic Today" escape hatch.
function WB_flagValueOn(v) {
  return v === true || v === "true" || v === 1 || (!!v && typeof v === "object" && v.on === true);
}
function WB_isOn(settingValue, previewOn, classicOn) {
  if (classicOn) return false;
  return !!previewOn || WB_flagValueOn(settingValue);
}

// Where the drawer bar starts, so it sits beside the left nav instead of on
// top of it. `rails` are the visible left columns' rects ({left,right,width});
// the answer is the right edge of the widest-reaching one, kept sane: never
// negative, never past 60% of the window (a bar that narrow is useless, so
// the full width wins). No rail (phones, client pages) = 0.
function WB_barLeft(rails, vw) {
  let left = 0;
  (rails || []).forEach((r) => {
    if (!r || !(r.width > 0)) return;
    const right = Number(r.right);
    if (isFinite(right) && right > left && r.left <= 1) left = right;
  });
  const max = Math.round((Number(vw) || 0) * 0.6);
  return left > max ? 0 : Math.max(0, Math.round(left));
}

// ---- R1: the right-side Desk column (desk-right-spec 3.1, decision 26) ----
// Mode: a full sheet on phones (the existing 760px breakpoint), the right
// column above it. A bad width counts as desktop.
var WB_DESK_SHEET_MAX = 760;
function WB_deskMode(width) {
  var w = Number(width);
  if (width == null || !isFinite(w)) return "dock";
  return w <= WB_DESK_SHEET_MAX ? "sheet" : "dock";
}

// Geometry preference: a sibling of the hub blob (that one is rewritten every
// 500ms and expires after 5 minutes; a width is a lasting preference).
var WB_DESK_KEY = "mgb_wb_desk";
function WB_deskKey(email) {
  var e = String(email || "").trim().toLowerCase();
  return e ? WB_DESK_KEY + ":" + e : null;
}

// The closed slim rail, the bottom info bar, and the column widths (decision
// 26: default 380, 320-520 by the grip). The page keeps at least 480px; under
// 1100px window width the open column overlays instead of pushing.
var WB_DESK_RAIL = 52;
var WB_DESK_BAR_H = 42;
var WB_DESK_PUSH_MIN = 1100;
var WB_DESK_PAGE_MIN = 480;
var WB_DESK_W = { min: 320, narrow: 320, standard: 380, wide: 460, max: 520 };
var WB_DESK_MAGNET = 24;
var WB_DESK_STEP = 24;
var WB_DESK_FLING = 0.6;
var WB_DESK_STOPS = [
  { w: WB_DESK_W.narrow, name: "Narrow" },
  { w: WB_DESK_W.standard, name: "Standard" },
  { w: WB_DESK_W.wide, name: "Wide" },
  { w: WB_DESK_W.max, name: "Widest" },
];

// The widest the column may be in this window: the page beside it (vw minus
// the left rail minus the column) never drops under 480px.
function WB_deskWidthMax(vw, railW) {
  var v = Number(vw);
  var r = Number(railW);
  if (!isFinite(v) || v <= 0) return WB_DESK_W.max;
  if (!isFinite(r) || r < 0) r = 0;
  return Math.max(WB_DESK_W.min, Math.min(WB_DESK_W.max, Math.round(v - r - WB_DESK_PAGE_MIN)));
}
function WB_deskWidthClamp(w, max) {
  var m = Number(max);
  if (!isFinite(m)) m = WB_DESK_W.max;
  m = Math.max(WB_DESK_W.min, Math.min(WB_DESK_W.max, m));
  var n = Number(w);
  if (!isFinite(n)) n = WB_DESK_W.standard;
  return Math.round(Math.max(WB_DESK_W.min, Math.min(m, n)));
}

// Where the Desk sits: "sheet" on phones, "push" (the page moves over) when
// the window is at least 1100 wide and the page keeps 480px, else "overlay".
// occupy = what the page gives up on the right (the closed rail always takes
// its 52px on desktop so it never covers content; the open column takes its
// width in push). occupyAny = the open column's width in push or overlay, so
// toasts, the chat drawer button and the Undo bar move left of it.
function WB_deskLayout(o) {
  var x = o || {};
  var vw = Number(x.vw);
  var railW = Number(x.railW);
  if (!isFinite(railW) || railW < 0) railW = 0;
  var max = WB_deskWidthMax(vw, railW);
  var w = WB_deskWidthClamp(x.w, max);
  var open = !!x.open;
  if (WB_deskMode(x.vw) === "sheet") return { mode: "sheet", w: w, max: max, occupy: 0, occupyAny: 0 };
  var push = isFinite(vw) && vw >= WB_DESK_PUSH_MIN && vw - railW - w >= WB_DESK_PAGE_MIN;
  var mode = push ? "push" : "overlay";
  var occupy = open && push ? w : WB_DESK_RAIL;
  return { mode: mode, w: w, max: max, occupy: occupy, occupyAny: open ? w : 0 };
}

// Where a released width drag lands. w = the width at release; vx = how fast
// the width was growing in px/ms (negative = the grip moving right, so the
// column narrowing). A 24px magnet pulls to Narrow, Standard, Wide and the
// max. Dragged 80px past the minimum, or flung right with the column under
// Standard, closes the column back to the rail.
function WB_deskWidthSnap(w, vx, max) {
  var n = Number(w);
  if (!isFinite(n)) n = WB_DESK_W.standard;
  var v = Number(vx);
  var close = n < WB_DESK_W.min - 80 || (isFinite(v) && v < -WB_DESK_FLING && n < WB_DESK_W.standard);
  var top = WB_deskWidthClamp(max, max);
  var c = WB_deskWidthClamp(n, top);
  var best = null;
  WB_DESK_STOPS.concat([{ w: top }]).forEach(function (s) {
    if (s.w > top) return;
    var d = Math.abs(s.w - c);
    if (d <= WB_DESK_MAGNET && (!best || d < Math.abs(best - c))) best = s.w;
  });
  return { w: best == null ? c : best, close: close };
}

// Keys on the focused grip (it sits on the column's left edge, so Left
// widens): Left/Right 24px, PageUp/PageDown the next stop, Home min, End max,
// Enter Standard. Unknown keys return null.
function WB_deskWidthStep(w, key, max) {
  var top = WB_deskWidthClamp(max, max);
  var c = WB_deskWidthClamp(w, top);
  var stops = WB_DESK_STOPS.map(function (s) { return s.w; })
    .filter(function (s) { return s <= top; })
    .concat([top])
    .filter(function (s, i, a) { return a.indexOf(s) === i; })
    .sort(function (a, b) { return a - b; });
  if (key === "ArrowLeft") return WB_deskWidthClamp(c + WB_DESK_STEP, top);
  if (key === "ArrowRight") return WB_deskWidthClamp(c - WB_DESK_STEP, top);
  if (key === "Home") return WB_DESK_W.min;
  if (key === "End") return top;
  if (key === "Enter") return WB_deskWidthClamp(WB_DESK_W.standard, top);
  if (key === "PageUp") {
    var up = stops.filter(function (s) { return s > c; })[0];
    return up == null ? top : up;
  }
  if (key === "PageDown") {
    var downs = stops.filter(function (s) { return s < c; });
    return downs.length ? downs[downs.length - 1] : WB_DESK_W.min;
  }
  return null;
}
function WB_deskWidthName(w) {
  var n = Math.round(Number(w));
  var hit = WB_DESK_STOPS.filter(function (s) { return s.w === n; })[0];
  return hit ? hit.name : "";
}
function WB_deskWidthText(w) {
  var n = Math.round(Number(w));
  if (!isFinite(n)) n = WB_DESK_W.standard;
  var name = WB_deskWidthName(n);
  return "Desk width " + n + " pixels" + (name ? ", " + name : "");
}

// Stored geometry, v2 (spec 3.5, trimmed to what decision 26 kept): the
// wanted width, re-clamped to each window when applied. v1 (the D3 bottom
// panel height) and junk fall back to the default column.
function WB_deskDefault() {
  return { v: 2, dock: "right", right: { w: WB_DESK_W.standard } };
}
function WB_deskParse(raw) {
  var fallback = WB_deskDefault();
  if (raw == null || raw === "") return fallback;
  var o = null;
  try {
    o = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (e) {
    return fallback;
  }
  if (!o || typeof o !== "object" || o.v !== 2) return fallback;
  var r = o.right && typeof o.right === "object" ? o.right : {};
  var w = Number(r.w);
  return {
    v: 2,
    dock: "right",
    right: { w: isFinite(w) ? Math.round(Math.max(WB_DESK_W.min, Math.min(WB_DESK_W.max, w))) : WB_DESK_W.standard },
  };
}
function WB_deskSerialize(st) {
  var p = WB_deskParse(st);
  return JSON.stringify(p);
}

// Route changes (decision 11): a pushed column stays open, an overlay or the
// sheet closes so the new page shows, except within 500ms of opening (an
// arrival that routed and opened at once).
var WB_DESK_NAV_GRACE = 500;
function WB_deskNavStep(o) {
  var x = o || {};
  if (x.layout === "push") return "keep";
  var ms = Number(x.msSinceOpen);
  if (isFinite(ms) && ms >= 0 && ms < WB_DESK_NAV_GRACE) return "keep";
  return "close";
}

// Esc with focus inside the Desk, one step at a time (spec 6):
//   layer    a drawer, dialog, menu or tour above the Desk takes it
//   picker   the open client picker list closes
//   field    a field that keeps Esc (a self-clearing box with text) clears
//   inner    the task view's inner panel (the SOP panel) closes
//   pop      task view, more than one task deep: back to the previous task
//   list     task view, one deep, opened with the Desk already open: back to
//            the Desk list
//   close    one deep and the Desk was closed when the task opened (it closes
//            again, focus back to the page row), or the Desk list itself
function WB_deskEscStep(o) {
  var x = o || {};
  if (x.layerAbove) return "layer";
  if (x.pickerOpen) return "picker";
  if (x.fieldKeeps) return "field";
  if (x.drillInner) return "inner";
  var depth = Number(x.drillDepth) || 0;
  if (depth > 1) return "pop";
  if (depth === 1 && !x.closeOnEmpty) return "list";
  return "close";
}

// ---- R2: the task view (drill-in) inside the Desk column (spec 5) ----------

// Where TK_openTask sends a task (spec 5.1): "desk" while the Desk is live and
// the Tasks schema is ok, unless the caller asks for the modal (opts.modal).
// "modal" = today's path (the modal task drawer, or the Tasks page).
function WB_deskRoute(o) {
  var x = o || {};
  var opts = x.opts || {};
  if (!x.live || !x.schemaOk || opts.modal === true) return "modal";
  return "desk";
}

// The drill stack: [{ id, from, focus }], oldest first, the shown task last.
var WB_DRILL_CAP = 5;
// A stack closed by D (or a page change) comes back on reopen for 5 minutes.
var WB_DRILL_KEEP_MS = 5 * 60 * 1000;
// The task view widens the column to at least Wide (transient, never saved).
var WB_DESK_TASK_W = 460;

function WB__drillItem(item) {
  var x = item || {};
  if (x.id == null || x.id === "") return null;
  return { id: String(x.id), from: x.from ? String(x.from) : "", focus: x.focus ? String(x.focus) : null };
}
function WB__drillClean(stack) {
  var out = [];
  (Array.isArray(stack) ? stack : []).forEach(function (s) {
    var it = WB__drillItem(s);
    if (it) out.push(it);
  });
  return out;
}
// Push a task. The same id already on top only updates its focus field (a
// second click on the open task is not a new level); past the cap the oldest
// level drops. A junk item leaves the stack as it was.
function WB_drillPush(stack, item, cap) {
  var list = WB__drillClean(stack);
  var it = WB__drillItem(item);
  if (!it) return list;
  var top = list[list.length - 1];
  if (top && top.id === it.id) {
    list[list.length - 1] = { id: top.id, from: top.from, focus: it.focus };
    return list;
  }
  list.push(it);
  var c = Number(cap);
  if (!isFinite(c) || c < 1) c = WB_DRILL_CAP;
  while (list.length > c) list.shift();
  return list;
}
function WB_drillPop(stack) {
  var list = WB__drillClean(stack);
  list.pop();
  return list;
}
function WB_drillTop(stack) {
  var list = WB__drillClean(stack);
  return list.length ? list[list.length - 1] : null;
}
// Does a kept stack still come back when the Desk reopens? closedAt = when
// the Desk closed with a task showing (0 = it did not).
function WB_drillKept(closedAt, now) {
  var c = Number(closedAt);
  var n = Number(now);
  if (!isFinite(c) || c <= 0) return true;
  if (!isFinite(n)) return false;
  return n - c <= WB_DRILL_KEEP_MS;
}
// The back button's words: "Back to Desk" one level deep, else "Back to
// <the task underneath>". titleOf(id) gives a task's title ("" when unknown).
function WB_drillBackLabel(stack, titleOf, deskName) {
  var list = WB__drillClean(stack);
  var desk = String(deskName || "Desk");
  if (list.length < 2) return "Back to " + desk;
  var under = list[list.length - 2];
  var t = "";
  try {
    t = typeof titleOf === "function" ? String(titleOf(under.id) || "").trim() : "";
  } catch (e) {
    t = "";
  }
  if (!t) return "Back to the previous task";
  if (t.length > 40) t = t.slice(0, 39).replace(/\s+$/, "") + "…";
  return "Back to " + t;
}
// The column width while a task shows: at least Wide, re-clamped by
// WB_deskLayout like any width. taskW = a width dragged during this task view.
function WB_deskTaskWidth(savedW, taskW) {
  var t = Number(taskW);
  if (taskW != null && isFinite(t) && t > 0) return t;
  var s = Number(savedW);
  if (!isFinite(s)) s = WB_DESK_W.standard;
  return Math.max(s, WB_DESK_TASK_W);
}
// F6 (spec 6): from the page (or the bar) to the open Desk; from the Desk to
// the page's main. null = F6 is not the Desk's (closed Desk, focus in a layer).
function WB_deskF6Target(o) {
  var x = o || {};
  if (!x.open) return null;
  if (x.zone === "desk") return "page";
  if (x.zone === "page" || x.zone === "bar") return "desk";
  return null;
}

// The Desk shows only the signed-in person's own items, so it never mounts
// under View as, a preview or impersonation, nor inside the own-window Slate.
function WB_deskMounts(o) {
  var x = o || {};
  if (!x.showStaffRail || x.tkShell || x.previewing || x.impersonating) return false;
  // The own-window MGB Desk renders the Desk itself, never the docked column.
  if (x.deskShell) return false;
  return !!String(x.email || "").trim();
}
// Live = mounted, the switch on, and the hub table present. The chat bubble
// hides only while this is true (decision 20).
function WB_deskLive(o) {
  var x = o || {};
  return !!x.mounts && !!x.on && x.status !== "missing";
}

// The open/close key: plain D (caps lock D counts; Shift+D, Ctrl, Cmd and Alt
// do not, so browser and OS shortcuts stay free).
function WB_deskToggleKey(e) {
  var x = e || {};
  if (x.ctrlKey || x.metaKey || x.altKey || x.shiftKey) return false;
  return x.key === "d" || x.key === "D";
}

// Where focus sits: inside the Desk, on its rail or bar, or on the page.
// Focus inside a stacked layer (a modal over the Desk) is none of these.
function WB_deskFocusZone(f) {
  var x = f || {};
  if (x.inLayer) return null;
  if (x.inPanel) return "desk";
  if (x.onBar) return "bar";
  return "page";
}
// After close (spec 7): back to the opener if it is still on the page, else
// the rail (the handle), else the page's main.
function WB_deskReturnFocus(o) {
  var x = o || {};
  if (x.openerOk) return "opener";
  if (x.handleOk) return "handle";
  return "main";
}

// The info bar's progress words (R1c). late and dueOpen are my open tasks in
// the overdue and today groups; doneToday is tasks I finished today, or null
// while unknown (the task list has not loaded).
function WB_barProgress(o) {
  var x = o || {};
  var late = Math.max(0, Number(x.late) || 0);
  var open = Math.max(0, Number(x.dueOpen) || 0);
  var done = x.doneToday == null ? null : Math.max(0, Number(x.doneToday) || 0);
  var out = { late: late, lateText: late ? late + " late" : "", todayText: "", empty: false };
  if (done == null) out.todayText = open ? open + " today" : "";
  else if (open + done > 0) out.todayText = done + " of " + (open + done) + " today";
  out.empty = !late && !out.todayText;
  return out;
}

// Tasks I finished today (Chicago day), from the task store's loaded tasks.
// isMine and isDone come from the Tasks module (TK_isMine, TK_effectiveStatus).
function WB_doneToday(tasks, o) {
  var x = o || {};
  var today = x.today;
  if (!today || typeof x.isMine !== "function" || typeof x.isDone !== "function") return 0;
  var n = 0;
  (tasks || []).forEach(function (t) {
    if (!t || t.deleted_at || !t.completed_at || !x.isMine(t) || !x.isDone(t)) return;
    var ms = Date.parse(t.completed_at);
    if (isFinite(ms) && WB_today(ms) === today) n++;
  });
  return n;
}

// The info bar's page-client line (R1c): what the client page already knows,
// no new fetch. tasks = my open tasks on this client, waiting = questions
// staff asked that the client has not answered, the QuickBooks sync state as
// the Overview strip words it. ago is the "3 hours ago" text for syncedAt.
// Returns null off a client page.
function WB_barClientLine(o) {
  var x = o || {};
  var name = String(x.name || "").trim();
  if (!name) return null;
  var out = [];
  if (x.loaded && !x.error) {
    var t = Math.max(0, Number(x.tasks) || 0);
    var w = Math.max(0, Number(x.waiting) || 0);
    out.push({ key: "tasks", text: t ? t + " open task" + (t === 1 ? "" : "s") : "No open tasks", bad: Number(x.overdue) > 0 });
    if (w) out.push({ key: "waiting", text: w + " waiting on the client", bad: false });
  }
  if (x.qbo) {
    if (x.qboError) out.push({ key: "qbo", text: "QuickBooks needs reconnecting", bad: true });
    else if (x.syncedAt) {
      var ms = Date.parse(x.syncedAt);
      var now = Number(x.now) || Date.now();
      var hrs = isFinite(ms) ? (now - ms) / 36e5 : null;
      var stale = hrs != null && Number(x.staleHours) > 0 && hrs > Number(x.staleHours);
      out.push({ key: "qbo", text: "QuickBooks synced " + (x.ago || "recently"), bad: stale });
    } else out.push({ key: "qbo", text: "QuickBooks hasn't synced yet", bad: false });
  }
  return { name: name, parts: out };
}

// The rail's four counts (decision 28): messages, reviews and files from the
// Desk's own chip counts, mentions from the bell's unseen mentions.
function WB_railCounts(o) {
  var x = o || {};
  var c = x.counts || {};
  var n = function (v) {
    var k = Number(v);
    return isFinite(k) && k > 0 ? Math.round(k) : 0;
  };
  return {
    message: n(c.message),
    review: n(c.review),
    doc: n(c.doc),
    mention: n(x.mentions),
  };
}

// ---- R3: the open Desk's extras --------------------------------------------
var WB__pos = function (v) {
  var k = Number(v);
  return isFinite(k) && k > 0 ? Math.round(k) : 0;
};
var WB__s = function (k) {
  return k === 1 ? "" : "s";
};

// One rail flyout line (decision 19: who, subject, wait): "Acme: Subject · 3h".
function WB_railLine(row, now) {
  var r = row || {};
  var n = now == null ? Date.now() : Number(now);
  var head = (r.client_name ? r.client_name + ": " : "") + (r.title || "");
  var ms = r.waiting_since ? Date.parse(r.waiting_since) : NaN;
  return isFinite(ms) ? head + " · " + WB__ago(ms, n) : head;
}

// "Right now" (decision 18): one card at the top of the open Desk whose
// content follows the page. No new fetch: the client page's tab counts
// (useClientTabCounts) and the Desk's own rows.
// route = { page, clientName }. ctx = { counts (the client tab counts), qbo,
// syncedAt, staleHours, ago ("3 hours ago" for syncedAt), now, inbox:
// { count, messages, oldestAt }, deskMessages: { count, oldestAt } (the
// Desk's inbox message rows for this client) }.
// Client page: my open tasks (late ones marked), messages to answer with the
// oldest wait, questions waiting on the client, a month close problem, and
// the QuickBooks sync. Inbox page: what waits on me and the oldest message's
// wait.
// Anywhere else null (no card). Ledger, close-page and task contexts are a
// later pass.
function WB_deskContext(route, ctx) {
  var r = route || {};
  var x = ctx || {};
  var now = Number(x.now) || Date.now();
  var name = String(r.clientName || "").trim();
  if (name) {
    var c = x.counts || {};
    var parts = [];
    if (c.loaded && !c.error) {
      var tk = c.tasks || {};
      var t = WB__pos(tk.mine);
      var late = Math.min(t, WB__pos(tk.overdue));
      parts.push({
        key: "tasks",
        text: t ? t + " open task" + WB__s(t) + (late ? ", " + late + " late" : "") : "No open tasks",
        bad: late > 0,
        go: "client",
      });
      var m = c.messages || {};
      // The Desk's own inbox rows for this client (the rail's source) can be
      // newer than the tab counts: take the larger count and the older wait.
      var dm = x.deskMessages || {};
      var mc = Math.max(WB__pos(m.count), WB__pos(dm.count));
      var waitMs = m.oldestWaitAt ? Date.parse(m.oldestWaitAt) : NaN;
      var dWait = dm.oldestAt ? Date.parse(dm.oldestAt) : NaN;
      if (isFinite(dWait) && (!isFinite(waitMs) || dWait < waitMs)) waitMs = dWait;
      if (mc)
        parts.push({
          key: "messages",
          text: mc + " message" + WB__s(mc) + " to answer" + (isFinite(waitMs) ? ", oldest " + WB__ago(waitMs, now) : ""),
          bad: WB__pos(m.overdue) > 0 || (isFinite(dWait) && now - dWait > 24 * 36e5),
          go: "messages",
        });
      else parts.push({ key: "messages", text: "No messages waiting", bad: false, go: null });
      var w = WB__pos(c.bank && c.bank.waiting);
      if (w) parts.push({ key: "waiting", text: w + " waiting on the client", bad: false, go: null });
      var cl = c.close || {};
      if (cl.label && cl.qbo !== "error") parts.push({ key: "close", text: String(cl.label), bad: cl.tone === "bad", go: null });
    }
    if (x.qbo) {
      var qboError = !!(c.close && c.close.qbo === "error");
      if (qboError) parts.push({ key: "qbo", text: "QuickBooks needs reconnecting", bad: true, go: null });
      else if (x.syncedAt) {
        var ms = Date.parse(x.syncedAt);
        var hrs = isFinite(ms) ? (now - ms) / 36e5 : null;
        var stale = hrs != null && Number(x.staleHours) > 0 && hrs > Number(x.staleHours);
        parts.push({ key: "qbo", text: "QuickBooks synced " + (x.ago || "recently"), bad: stale, go: null });
      } else parts.push({ key: "qbo", text: "QuickBooks hasn't synced yet", bad: false, go: null });
    }
    return { kind: "client", title: name, parts: parts };
  }
  if (r.page === "inbox") {
    var ib = x.inbox || {};
    var all = WB__pos(ib.count);
    var msgs = WB__pos(ib.messages);
    var oldMs = ib.oldestAt ? Date.parse(ib.oldestAt) : NaN;
    var ip = [{ key: "all", text: all ? all + " item" + WB__s(all) + " waiting on you" : "Nothing waiting on you", bad: false, go: null }];
    // The glance strip above already shows the message count (decision 28:
    // one place per fact), so this line is only the oldest wait.
    if (msgs && isFinite(oldMs)) ip.push({ key: "messages", text: "Oldest message waiting " + WB__ago(oldMs, now), bad: false, go: null });
    return { kind: "inbox", title: "Inbox", parts: ip };
  }
  return null;
}

// The open Desk's glance items (spec 8.1, the open-Desk extras). lines is how
// much of the length budget an item takes; minTier the shortest length it
// shows at. first: always placed first (the counts). The key-hint footer is
// not budgeted (it stays fixed until the R4 gear can turn it off).
var WB_DESK_TIERS = ["short", "medium", "tall"];
var WB_DESK_BUDGET = { short: 1, medium: 3, tall: 6 };
var WB_DESK_ITEMS = [
  { id: "glance", lines: 1, minTier: "short", on: true, first: true },
  { id: "rightNow", lines: 2, minTier: "medium", on: true },
];

// The open column's length tier from its height in px. The column is full
// height (decision 26), so the length grip is gone; the window decides.
function WB_deskTier(h) {
  var v = Number(h);
  if (!isFinite(v) || v <= 0) return "tall";
  if (v < 640) return "short";
  if (v < 820) return "medium";
  return "tall";
}

// The fill rule (spec 8.2). prefs = { on: { id: bool }, order: [ids] } (the
// R4 gear writes it; missing means the defaults). ctx = { id: shows? }.
// Walk in order (first items ahead), skip off, too-tall-for-the-tier and not
// showing; add while the lines fit. Returns the ids to render.
function WB_deskFill(o) {
  var x = o || {};
  var items = Array.isArray(x.items) ? x.items : WB_DESK_ITEMS;
  var prefs = x.prefs || {};
  var on = prefs.on || {};
  var order = Array.isArray(prefs.order) ? prefs.order.map(String) : [];
  var ctx = x.ctx || {};
  var tier = WB_DESK_TIERS.indexOf(x.tier) >= 0 ? x.tier : "tall";
  var budget = WB_DESK_BUDGET[tier];
  var rank = function (it) {
    var i = order.indexOf(String(it.id));
    return i < 0 ? order.length + items.indexOf(it) : i;
  };
  var list = items
    .filter(function (it) {
      return it && it.id;
    })
    .slice()
    .sort(function (a, b) {
      if (!!a.first !== !!b.first) return a.first ? -1 : 1;
      return rank(a) - rank(b);
    });
  var out = [];
  var used = 0;
  list.forEach(function (it) {
    var isOn = on[it.id] == null ? it.on !== false : !!on[it.id];
    if (!isOn) return;
    if (WB_DESK_TIERS.indexOf(it.minTier || "short") > WB_DESK_TIERS.indexOf(tier)) return;
    if (!ctx[it.id]) return;
    var lines = Math.max(0, Number(it.lines) || 0);
    if (used + lines > budget) return;
    used += lines;
    out.push(it.id);
  });
  return out;
}

// What shows while the Desk is closed (decision 27; the R4 gear's "When
// closed": both, rail only, bar only, neither). mode = WB_deskMode's
// "dock" | "sheet". Phones have no rail, and the bar is their only way in, so
// it always shows there.
var WB_DESK_CLOSED = ["both", "rail", "bar", "neither"];
function WB_deskClosedShow(choice, mode) {
  var c = WB_DESK_CLOSED.indexOf(choice) >= 0 ? choice : "both";
  if (mode === "sheet") return { rail: false, bar: true };
  return { rail: c === "both" || c === "rail", bar: c === "both" || c === "bar" };
}

// ---- MGB Desk in its own window (spec-mgb-desk-app) ------------------------
var WB_DESK_APP_NAME = "MGB Desk";
var WB_DESK_WIN_KEY = "mgb_desk_win_v1";
var WB_DESK_INSTALLED_KEY = "mgb_desk_installed_v1";
var WB_DESK_APP_PREVIEW = "mgb_desk_app_preview";
var WB_HUB_WIN_KEY = "mgb_wb_hub_win";
var WB_DESK_WIN_DEFAULT = { w: 420, h: 760 };
var WB_DESK_WIN_MIN = { w: 360, h: 480 };

// Three layers, one helper: the Desk itself must be live, then the person's
// preview checkbox or the firm switch (tk_settings.desk_app_enabled). Reads
// the setting exactly like wb_enabled: true, "true", 1 or {on:true}, not "on".
function WB_deskAppIsOn(settingValue, preview, deskOn) {
  if (!deskOn) return false;
  if (preview === "1" || preview === true) return true;
  return WB_flagValueOn(settingValue);
}

// Which screen the desk shell shows. Pure so app.jsx only switches on it.
//   none: not the desk shell   signin: staff sign-in   client: clear the flag
//   wait: flags loading        off / phone: not-on panel   desk: the Desk
function WB_deskShellPlan(o) {
  var x = o || {};
  var isDesk = x.shell === "desk" || /^\/desk\/?$/.test(String(x.pathname || ""));
  if (!isDesk) return "none";
  if (!x.signedIn) return "signin";
  if (x.impersonating) return "none";
  if (x.isClient || !x.isStaff) return "client";
  if (x.mobile) return "phone";
  if (!x.flagsKnown) return "wait";
  if (!x.appOn) return "off";
  return "desk";
}

function WB__num(v) {
  var n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return isFinite(n) && n > 0 ? Math.round(n) : null;
}

// Popup size and place. saved = {w,h} from mgb_desk_win_v1 (junk is ignored);
// scr = { availWidth, availHeight, availLeft, availTop }. Opens at the right
// edge, 24px in and 40px down; a screen smaller than the minimum still wins.
function WB_deskWinSize(saved, scr) {
  var s = scr || {};
  var maxW = WB__num(s.availWidth) || Infinity;
  var maxH = WB__num(s.availHeight) || Infinity;
  var left0 = typeof s.availLeft === "number" && isFinite(s.availLeft) ? s.availLeft : 0;
  var top0 = typeof s.availTop === "number" && isFinite(s.availTop) ? s.availTop : 0;
  var w = saved && typeof saved === "object" ? WB__num(saved.w) : null;
  var h = saved && typeof saved === "object" ? WB__num(saved.h) : null;
  if (w == null || h == null) {
    w = WB_DESK_WIN_DEFAULT.w;
    h = WB_DESK_WIN_DEFAULT.h;
  }
  w = Math.min(Math.max(WB_DESK_WIN_MIN.w, w), maxW);
  h = Math.min(Math.max(WB_DESK_WIN_MIN.h, h), maxH);
  var left = maxW === Infinity ? 0 : Math.max(left0, left0 + maxW - w - 24);
  var top = maxH === Infinity ? 0 : top0 + Math.max(0, Math.min(40, maxH - h));
  return { w: w, h: h, left: left, top: top };
}
function WB_deskWinFeatures(size) {
  var z = size || WB_deskWinSize(null, null);
  return "popup,width=" + z.w + ",height=" + z.h + ",left=" + (z.left || 0) + ",top=" + (z.top || 0);
}

// The Desk menu's launch items. o: { installed, canInstall, standalone,
// mobile, narrow }. Phones and narrow windows get none (the Desk is a sheet).
// Before install: Open (popup) and Get; after: the one Open (the dialog).
function WB_deskLaunchItems(o) {
  var x = o || {};
  if (x.mobile || x.narrow) return [];
  var out = [];
  if (x.installed) out.push({ id: "open-app", label: "Open " + WB_DESK_APP_NAME });
  else {
    out.push({ id: "open", label: "Open " + WB_DESK_APP_NAME });
    if (x.canInstall) out.push({ id: "get", label: "Download " + WB_DESK_APP_NAME });
  }
  out.push({ id: "help", label: "Help" });
  return out;
}

// A hash the Desk window may ask a portal to show: "#/..." with a short,
// plain set of characters (encodeURIComponent output, which keeps ' too,
// plus "?", "=", "&", ":").
function WB_deskForwardOk(hash) {
  if (typeof hash !== "string" || hash.length > 300) return false;
  return /^#\/[A-Za-z0-9/_\-?=&.%:~!*()']*$/.test(hash) && hash.indexOf("//") < 0;
}

// Which portal answers a Dock back or a forwarded row. replies = [{from,
// focusedAt, visible}]: a visible portal first, then the latest focus.
function WB_deskDockPick(replies) {
  var best = null;
  (Array.isArray(replies) ? replies : []).forEach(function (r) {
    if (!r || !r.from) return;
    var at = Number(r.focusedAt) || 0;
    if (
      !best ||
      (!!r.visible && !best.visible) ||
      (!!r.visible === !!best.visible && at > best.at)
    )
      best = { from: r.from, visible: !!r.visible, at: at };
  });
  return best ? best.from : null;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    WORKBENCH_NAME: WORKBENCH_NAME,
    WB_NAME: WB_NAME,
    WB_SLATE: WB_SLATE,
    WB_SOON_DAYS: WB_SOON_DAYS,
    WB_CHIPS: WB_CHIPS,
    WB_DRAWER_TABS: WB_DRAWER_TABS,
    WB_HUB_TABS: WB_HUB_TABS,
    WB_HUB_KEY: WB_HUB_KEY,
    WB_HUB_TASK_CAP: WB_HUB_TASK_CAP,
    WB_HUB_TASK_GROUPS: WB_HUB_TASK_GROUPS,
    WB_hubKey: WB_hubKey,
    WB_hubRoute: WB_hubRoute,
    WB_hubArrival: WB_hubArrival,
    WB_hubTaskGroups: WB_hubTaskGroups,
    WB_hubTasksReady: WB_hubTasksReady,
    WB_hubShouldReload: WB_hubShouldReload,
    WB_PINS_KEY: WB_PINS_KEY,
    WB_PINS_CAP: WB_PINS_CAP,
    WB_HUB_RECENT_MAX: WB_HUB_RECENT_MAX,
    WB_HUB_PICK_LIMIT: WB_HUB_PICK_LIMIT,
    WB_pinsKey: WB_pinsKey,
    WB_pinsClean: WB_pinsClean,
    WB_pinsParse: WB_pinsParse,
    WB_pinsSerialize: WB_pinsSerialize,
    WB_pinsToggle: WB_pinsToggle,
    WB_hubPickClient: WB_hubPickClient,
    WB_hubClientOptions: WB_hubClientOptions,
    WB_hubClientListKey: WB_hubClientListKey,
    WB_escKeepsField: WB_escKeepsField,
    WB_ESC_CLEARS_SEL: WB_ESC_CLEARS_SEL,
    WB_hubPickerPool: WB_hubPickerPool,
    WB_HUB_OPEN_MS: WB_HUB_OPEN_MS,
    WB_HUB_SCROLL_MS: WB_HUB_SCROLL_MS,
    WB_LAYERS: WB_LAYERS,
    WB_LAYER_SELECTORS: WB_LAYER_SELECTORS,
    WB_hubTabIds: WB_hubTabIds,
    WB_hubDefault: WB_hubDefault,
    WB_hubClean: WB_hubClean,
    WB_hubMerge: WB_hubMerge,
    WB_hubSerialize: WB_hubSerialize,
    WB_hubParse: WB_hubParse,
    WB_tabMove: WB_tabMove,
    WB_layersPresent: WB_layersPresent,
    WB_layerAbove: WB_layerAbove,
    WB_isStacked: WB_isStacked,
    WB_hubAction: WB_hubAction,
    WB_hubPrimary: WB_hubPrimary,
    WB_hubMenu: WB_hubMenu,
    WB_today: WB_today,
    WB_addDays: WB_addDays,
    WB_addBusinessDays: WB_addBusinessDays,
    WB_chicagoAt: WB_chicagoAt,
    WB_isAck: WB_isAck,
    WB_rank: WB_rank,
    WB_groupOf: WB_groupOf,
    WB_compare: WB_compare,
    WB_sort: WB_sort,
    WB_isSnoozed: WB_isSnoozed,
    WB_build: WB_build,
    WB_drawerChip: WB_drawerChip,
    WB_nextRow: WB_nextRow,
    WB_barLeft: WB_barLeft,
    WB_DESK_SHEET_MAX: WB_DESK_SHEET_MAX,
    WB_DESK_KEY: WB_DESK_KEY,
    WB_DESK_RAIL: WB_DESK_RAIL,
    WB_DESK_BAR_H: WB_DESK_BAR_H,
    WB_DESK_PUSH_MIN: WB_DESK_PUSH_MIN,
    WB_DESK_PAGE_MIN: WB_DESK_PAGE_MIN,
    WB_DESK_W: WB_DESK_W,
    WB_DESK_MAGNET: WB_DESK_MAGNET,
    WB_DESK_STEP: WB_DESK_STEP,
    WB_DESK_FLING: WB_DESK_FLING,
    WB_DESK_STOPS: WB_DESK_STOPS,
    WB_DESK_NAV_GRACE: WB_DESK_NAV_GRACE,
    WB_deskMode: WB_deskMode,
    WB_deskKey: WB_deskKey,
    WB_deskWidthMax: WB_deskWidthMax,
    WB_deskWidthClamp: WB_deskWidthClamp,
    WB_deskLayout: WB_deskLayout,
    WB_deskWidthSnap: WB_deskWidthSnap,
    WB_deskWidthStep: WB_deskWidthStep,
    WB_deskWidthName: WB_deskWidthName,
    WB_deskWidthText: WB_deskWidthText,
    WB_deskDefault: WB_deskDefault,
    WB_deskParse: WB_deskParse,
    WB_deskSerialize: WB_deskSerialize,
    WB_deskNavStep: WB_deskNavStep,
    WB_deskEscStep: WB_deskEscStep,
    WB_deskRoute: WB_deskRoute,
    WB_DRILL_CAP: WB_DRILL_CAP,
    WB_DRILL_KEEP_MS: WB_DRILL_KEEP_MS,
    WB_DESK_TASK_W: WB_DESK_TASK_W,
    WB_drillPush: WB_drillPush,
    WB_drillPop: WB_drillPop,
    WB_drillTop: WB_drillTop,
    WB_drillKept: WB_drillKept,
    WB_drillBackLabel: WB_drillBackLabel,
    WB_deskTaskWidth: WB_deskTaskWidth,
    WB_deskF6Target: WB_deskF6Target,
    WB_deskMounts: WB_deskMounts,
    WB_deskLive: WB_deskLive,
    WB_deskToggleKey: WB_deskToggleKey,
    WB_deskFocusZone: WB_deskFocusZone,
    WB_deskReturnFocus: WB_deskReturnFocus,
    WB_barProgress: WB_barProgress,
    WB_railCounts: WB_railCounts,
    WB_doneToday: WB_doneToday,
    WB_barClientLine: WB_barClientLine,
    WB_railLine: WB_railLine,
    WB_deskContext: WB_deskContext,
    WB_DESK_TIERS: WB_DESK_TIERS,
    WB_DESK_BUDGET: WB_DESK_BUDGET,
    WB_DESK_ITEMS: WB_DESK_ITEMS,
    WB_deskTier: WB_deskTier,
    WB_deskFill: WB_deskFill,
    WB_DESK_CLOSED: WB_DESK_CLOSED,
    WB_deskClosedShow: WB_deskClosedShow,
    WB_fromToday: WB_fromToday,
    WB_primaryAction: WB_primaryAction,
    WB_menuActions: WB_menuActions,
    WB_clearAction: WB_clearAction,
    WB_linkTarget: WB_linkTarget,
    WB_keyAction: WB_keyAction,
    WB_snoozeUntil: WB_snoozeUntil,
    WB_whenText: WB_whenText,
    WB_updatedText: WB_updatedText,
    WB_periodLabel: WB_periodLabel,
    WB_flagValueOn: WB_flagValueOn,
    WB_isOn: WB_isOn,
    WB_DESK_APP_NAME: WB_DESK_APP_NAME,
    WB_DESK_WIN_KEY: WB_DESK_WIN_KEY,
    WB_DESK_INSTALLED_KEY: WB_DESK_INSTALLED_KEY,
    WB_DESK_APP_PREVIEW: WB_DESK_APP_PREVIEW,
    WB_HUB_WIN_KEY: WB_HUB_WIN_KEY,
    WB_DESK_WIN_DEFAULT: WB_DESK_WIN_DEFAULT,
    WB_DESK_WIN_MIN: WB_DESK_WIN_MIN,
    WB_deskAppIsOn: WB_deskAppIsOn,
    WB_deskShellPlan: WB_deskShellPlan,
    WB_deskWinSize: WB_deskWinSize,
    WB_deskWinFeatures: WB_deskWinFeatures,
    WB_deskLaunchItems: WB_deskLaunchItems,
    WB_deskForwardOk: WB_deskForwardOk,
    WB_deskDockPick: WB_deskDockPick,
  };
}
