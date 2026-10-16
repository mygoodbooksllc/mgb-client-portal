// ----------------------------------------------------------------------------
// WB_logic: the Workbench rules, pure and node-tested (spec C, D2, D4).
//
// The server (supabase/workbench-1-core.sql, wb_inbox) returns facts only;
// grouping, ranking, chip counts, the action per kind and the link per kind
// live here. `node components/workbench/WB_logic.test.js` guards them.
//
// The name is not final (owner question K-Q1): every UI string reads
// WB_NAME, so a rename is one line.
// ----------------------------------------------------------------------------

var WB_NAME = "Workbench";
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
// The panel's tabs. Only Inbox is live in H1; the rest come in H2 and H4
// and are saved/restored safely before then (a tab that isn't live falls
// back to Inbox).
var WB_HUB_TABS = [
  { id: "inbox", label: "Inbox", live: true },
  { id: "tasks", label: "My tasks", live: false },
  { id: "client", label: "Client", live: false },
];
var WB_HUB_KEY = "mgb_wb_hub"; // localStorage; the mgb_ prefix lets Dev Tools reset clear it
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
  return { open: false, tab: "inbox", chip: "all", clientId: null, scroll: { inbox: 0, tasks: 0, client: 0 }, lastFocus: null };
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
  return {
    open: x.open === true,
    tab: WB_hubTabIds(true).indexOf(x.tab) >= 0 ? x.tab : d.tab,
    chip: chipOk ? x.chip : d.chip,
    clientId: typeof x.clientId === "string" && x.clientId.length < 80 ? x.clientId : null,
    scroll: { inbox: WB__scrollNum(sc.inbox), tasks: WB__scrollNum(sc.tasks), client: WB__scrollNum(sc.client) },
    lastFocus: typeof x.lastFocus === "string" ? x.lastFocus : null,
  };
}

// Merge a patch (scroll merges per tab) and clean the result.
function WB_hubMerge(hub, patch) {
  var cur = WB_hubClean(hub);
  var p = patch && typeof patch === "object" ? patch : {};
  var next = Object.assign({}, cur, p);
  if (p.scroll && typeof p.scroll === "object") next.scroll = Object.assign({}, cur.scroll, p.scroll);
  return WB_hubClean(next);
}

// What goes to localStorage. lastFocus stays in memory.
function WB_hubSerialize(hub, now) {
  var h = WB_hubClean(hub);
  return JSON.stringify({ v: 1, at: now, open: h.open, tab: h.tab, chip: h.chip, clientId: h.clientId, scroll: h.scroll });
}

// Saved text in, hub state out. Never throws. Old saves don't reopen the
// hub and don't bring back a scroll position.
function WB_hubParse(raw, now) {
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
  h.lastFocus = null;
  return h;
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
// drawer on top of the hub; everything else keeps going where it lives
// (messages and files get their own hub actions in H3).
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
    default:
      return { type: "go" };
  }
}

// The hub's main button: tasks Open (a todo task's Start moves to the menu).
function WB_hubPrimary(row) {
  var p = WB_primaryAction(row);
  if (p && p.id === "start" && WB_hubAction(row).type === "task") return { id: "open", label: "Open" };
  return p;
}

// The hub's menu: Start, Snooze, Open full page for task rows.
function WB_hubMenu(row) {
  var items = WB_menuActions(row);
  if (!row || row.source === "other" || WB_hubAction(row).type !== "task") return items;
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

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    WB_NAME: WB_NAME,
    WB_SOON_DAYS: WB_SOON_DAYS,
    WB_CHIPS: WB_CHIPS,
    WB_DRAWER_TABS: WB_DRAWER_TABS,
    WB_HUB_TABS: WB_HUB_TABS,
    WB_HUB_KEY: WB_HUB_KEY,
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
  };
}
