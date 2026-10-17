// ----------------------------------------------------------------------------
// TK_viewLogic.js — pure rules for the Tasks views (Phase 1, views slice).
//
// No React, no DOM, no Supabase. Everything here is a browser global (the
// file loads through window.__SOURCE_ORDER) and is exported for node tests:
//   node components/tasks/TK_viewLogic.test.js
//
// What lives here:
//   pop-out window size and features      TK_POPOUT_DEFAULT, TK_POPOUT_MIN, TK_popOutFeatures
//   dock decision                         TK_dockPlan (600 ms fallback)
//   shell layout by width and touch       TK_shellLayout, TK_isTouchPrimary
//   list grouping, sorting and filters    TK_groupBySection, TK_sortTasks, TK_applyFilters
//   My Tasks group headings               TK_MY_GROUPS, TK_myGroupsView, TK_focusIds
//   list keys (j k Enter x s a q ?)       TK_listKeyAction, TK_moveFocus, TK_makeListKeyHandler, TK_bindListKeys
//   project form helpers                  TK_parseSectionsText, TK_newProjectFields, TK_projectErrorText
//   group by Due date | Client            TK_normalizeGroupBy, TK_flattenMyGroups, TK_groupByClient
//   Manage projects (admin screen)        TK_manageCounts, TK_manageFilterRows, TK_manageActions,
//                                         TK_manageTrashNote, TK_manageTrashConfirm, TK_manageErrorText
//   subtasks inline                       TK_subIndex, TK_subCount, TK_subNestGroups, TK_subRowClickAction, TK_subOpenToggle
//   project colors                        TK_PROJECT_COLORS, TK_projectColorOf, TK_projectColorError
//   small display helpers                 TK_initials, TK_canManageProjectHint, TK_listScopeOf, TK_searchRowToTask
//
// TK_logic.js loads first, so TK_compareTasks, TK_isOldDone and
// TK_CLIENT_SECTION_ORDER are used when they exist. Under node (where only
// this file is loaded) each has a private fallback with the same rule, so
// this file tests on its own. Private helpers carry the TK_v prefix so they
// never collide with another TK file.
// ----------------------------------------------------------------------------

var TK_POPOUT_DEFAULT = { w: 480, h: 820 };
var TK_POPOUT_MIN = { w: 380, h: 520 };
var TK_POPOUT_KEY = "mgb_tk_popout_v1";
var TK_DOCK_WAIT_MS = 600;

// ---- Pop-out ---------------------------------------------------------------

function TK_vNum(v) {
  var n = typeof v === "number" ? v : parseFloat(v);
  return isFinite(n) ? Math.round(n) : null;
}

// saved: { w, h } from localStorage (or null). scr: { availWidth, availHeight }
// (defaults to window.screen when there is one). Returns the clamped size.
function TK_popOutSize(saved, scr) {
  var s = scr;
  if (!s && typeof screen !== "undefined" && screen) s = { availWidth: screen.availWidth, availHeight: screen.availHeight };
  var maxW = s && TK_vNum(s.availWidth) ? TK_vNum(s.availWidth) : Infinity;
  var maxH = s && TK_vNum(s.availHeight) ? TK_vNum(s.availHeight) : Infinity;
  var w = saved ? TK_vNum(saved.w) : null;
  var h = saved ? TK_vNum(saved.h) : null;
  if (w == null || h == null) {
    w = TK_POPOUT_DEFAULT.w;
    h = TK_POPOUT_DEFAULT.h;
  }
  w = Math.max(TK_POPOUT_MIN.w, w);
  h = Math.max(TK_POPOUT_MIN.h, h);
  // A screen smaller than the minimum still wins: the window must fit.
  w = Math.min(w, maxW);
  h = Math.min(h, maxH);
  return { w: w, h: h };
}

function TK_popOutFeatures(saved, scr) {
  var z = TK_popOutSize(saved, scr);
  return "popup,width=" + z.w + ",height=" + z.h;
}

// ---- Dock ------------------------------------------------------------------
// s: { hasOpener, openerClosed, openerTabId, posted, replied, elapsedMs }
//   "navigate"  no opener, opener closed or no opener tab id, or no reply in 600 ms:
//               clear the shell flag and location.assign("/" + hash)
//   "post"      not posted yet (posted false, or elapsedMs not started)
//   "wait"      posted, no reply yet, under 600 ms
//   "close"     the opener replied "docked"
function TK_dockPlan(s) {
  var o = s || {};
  if (!o.hasOpener || o.openerClosed || !o.openerTabId) return "navigate";
  if (o.posted === false || (o.posted == null && o.elapsedMs == null)) return "post";
  if (o.replied) return "close";
  var t = typeof o.elapsedMs === "number" ? o.elapsedMs : 0;
  if (t < TK_DOCK_WAIT_MS) return "wait";
  return "navigate";
}

// ---- Layout ----------------------------------------------------------------
// width >= 900: sidebar rail. 761..899: a "Lists" sheet button. <= 760:
// compact rows and a full-window drawer. The bottom bar only on a
// touch-primary device at 760 or less (and only inside the shell; TK_App
// applies that part).
function TK_shellLayout(width, touchPrimary) {
  var w = typeof width === "number" && isFinite(width) ? width : 1280;
  return {
    compact: w <= 760,
    bottomBar: !!touchPrimary && w <= 760,
    sidebar: w >= 900 ? "rail" : "sheet",
  };
}

// "Phone" for the shell is a touch-primary pointer, not width alone.
// mm: optional matchMedia function (tests pass a fake).
function TK_isTouchPrimary(mm) {
  var f = mm;
  if (!f && typeof window !== "undefined" && window && typeof window.matchMedia === "function") {
    f = function (q) {
      return window.matchMedia(q);
    };
  }
  if (typeof f !== "function") return false;
  try {
    var r = f("(hover: none) and (pointer: coarse)");
    return !!(r && r.matches);
  } catch (e) {
    return false;
  }
}

// ---- Task helpers (fallbacks for node) ---------------------------------------

var TK_vSTATUS_ORDER = ["todo", "in_progress", "waiting_client", "ready_for_review", "done"];
var TK_vPRIORITY_RANK = { high: 0, normal: 1, low: 2 };
var TK_vCLIENT_ORDER = ["Weekly", "Monthly", "Quarterly", "Annual", "Occasional"];

function TK_vStatus(t) {
  if (!t) return "todo";
  if (t.status && TK_vSTATUS_ORDER.indexOf(t.status) >= 0) return t.status;
  return t.done ? "done" : "todo";
}

function TK_vLower(s) {
  return s == null ? "" : String(s).toLowerCase();
}

function TK_vNullsLast(a, b) {
  var an = a == null || a === "";
  var bn = b == null || b === "";
  if (an && bn) return 0;
  if (an) return 1;
  if (bn) return -1;
  return a < b ? -1 : a > b ? 1 : 0;
}

function TK_vCompare(a, b) {
  if (typeof TK_compareTasks === "function") return TK_compareTasks(a, b);
  var c = TK_vNullsLast(a.due_date, b.due_date);
  if (c) return c;
  var pa = TK_vPRIORITY_RANK[a.priority] != null ? TK_vPRIORITY_RANK[a.priority] : 1;
  var pb = TK_vPRIORITY_RANK[b.priority] != null ? TK_vPRIORITY_RANK[b.priority] : 1;
  if (pa !== pb) return pa - pb;
  c = TK_vNullsLast(a.due_at, b.due_at);
  if (c) return c;
  c = TK_vNullsLast(a.created_at, b.created_at);
  if (c) return c;
  return TK_vNullsLast(a.id, b.id);
}

function TK_vMonthsBefore(ymd, months) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ""));
  if (!m) return null;
  var y = +m[1];
  var mo = +m[2] - months;
  while (mo <= 0) {
    mo += 12;
    y -= 1;
  }
  var dim = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  var d = Math.min(+m[3], dim);
  return y + "-" + (mo < 10 ? "0" : "") + mo + "-" + (d < 10 ? "0" : "") + d;
}

function TK_vIsOldDone(t, today) {
  if (typeof TK_isOldDone === "function") return TK_isOldDone(t, today);
  if (TK_vStatus(t) !== "done") return false;
  var at = String(t.completed_at || t.updated_at || "").slice(0, 10);
  var cut = TK_vMonthsBefore(today, 12);
  if (!at || !cut) return false;
  return at < cut;
}

// ---- Sections (Row 3.2) ----------------------------------------------------
// Returns [{ key, name, tasks }] in display order. key "" is "No section".
// opts.kind "project": the project's own sections (even when empty, so each
//   has its add row), then any other section a task carries (A to Z), then
//   "No section" when it holds tasks or nothing else exists.
// opts.kind "client" (and person): the distinct section values, in
//   TK_CLIENT_SECTION_ORDER first, then A to Z, "No section" last.
// Task order inside a group is the input order (sort first).
function TK_groupBySection(tasks, opts) {
  var o = opts || {};
  var list = Array.isArray(tasks) ? tasks : [];
  var order = typeof TK_CLIENT_SECTION_ORDER !== "undefined" && Array.isArray(TK_CLIENT_SECTION_ORDER) ? TK_CLIENT_SECTION_ORDER : TK_vCLIENT_ORDER;
  var byKey = {};
  var seen = [];
  list.forEach(function (t) {
    var k = t && t.section != null ? String(t.section).trim() : "";
    if (!byKey[k]) {
      byKey[k] = [];
      seen.push(k);
    }
    byKey[k].push(t);
  });
  var keys = [];
  var have = {};
  function add(k) {
    if (have[k]) return;
    have[k] = 1;
    keys.push(k);
  }
  var alpha = function (a, b) {
    var x = a.toLowerCase();
    var y = b.toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  };
  if (o.kind === "project") {
    (Array.isArray(o.sections) ? o.sections : []).forEach(function (s) {
      var k = s == null ? "" : String(s).trim();
      if (k) add(k);
    });
    seen
      .filter(function (k) {
        return k && !have[k];
      })
      .sort(alpha)
      .forEach(add);
  } else {
    var lowerOrder = order.map(function (s) {
      return s.toLowerCase();
    });
    var named = seen.filter(function (k) {
      return !!k;
    });
    named.sort(function (a, b) {
      var ia = lowerOrder.indexOf(a.toLowerCase());
      var ib = lowerOrder.indexOf(b.toLowerCase());
      if (ia >= 0 && ib >= 0) return ia - ib;
      if (ia >= 0) return -1;
      if (ib >= 0) return 1;
      return alpha(a, b);
    });
    named.forEach(add);
  }
  if (byKey[""] || !keys.length) add("");
  return keys.map(function (k) {
    return { key: k, name: k || "No section", tasks: byKey[k] || [] };
  });
}

// ---- Sorting (Row 3.2) -------------------------------------------------------
var TK_SORT_COLS = ["task", "assignee", "due", "status", "priority"];

// sort: { col, dir: "asc"|"desc" } or null. No col: sort_key (nulls last),
// then TK_compareTasks. opts.nameOf(email) gives the assignee's display name.
// Ties always fall back to the default order, so the result is stable.
function TK_sortTasks(tasks, sort, opts) {
  var list = Array.isArray(tasks) ? tasks.slice() : [];
  var s = sort || {};
  var col = TK_SORT_COLS.indexOf(s.col) >= 0 ? s.col : null;
  var dir = s.dir === "desc" ? -1 : 1;
  var nameOf = opts && typeof opts.nameOf === "function" ? opts.nameOf : null;
  function base(a, b) {
    var sa = typeof a.sort_key === "number" ? a.sort_key : null;
    var sb = typeof b.sort_key === "number" ? b.sort_key : null;
    if (sa != null || sb != null) {
      if (sa == null) return 1;
      if (sb == null) return -1;
      if (sa !== sb) return sa - sb;
    }
    return TK_vCompare(a, b);
  }
  // S8b: the assignee only; Unassigned (null) sorts last both ways.
  function who(t) {
    var e = TK_vLower(t.assignee_email);
    if (!e) return null;
    var n = nameOf ? nameOf(e) : null;
    return TK_vLower(n || e);
  }
  function key(t) {
    if (col === "task") return TK_vLower(t.text);
    if (col === "assignee") return who(t);
    if (col === "due") return t.due_date || null;
    if (col === "status") return TK_vSTATUS_ORDER.indexOf(TK_vStatus(t));
    if (col === "priority") return TK_vPRIORITY_RANK[t.priority] != null ? TK_vPRIORITY_RANK[t.priority] : 1;
    return null;
  }
  list.sort(function (a, b) {
    if (col) {
      var ka = key(a);
      var kb = key(b);
      if (col === "due" || col === "assignee") {
        // Undated (or Unassigned) tasks stay last in both directions.
        if (ka == null && kb != null) return 1;
        if (kb == null && ka != null) return -1;
      }
      if (ka !== kb && ka != null && kb != null) return (ka < kb ? -1 : 1) * dir;
    }
    return base(a, b);
  });
  return list;
}

// Click on a column header: a new column sorts ascending, the same column
// flips, and a third click on a descending column goes back to the default.
function TK_toggleSort(cur, col) {
  if (TK_SORT_COLS.indexOf(col) < 0) return null;
  if (!cur || cur.col !== col) return { col: col, dir: "asc" };
  if (cur.dir === "asc") return { col: col, dir: "desc" };
  return null;
}

// ---- Filters (Row 3.2) -------------------------------------------------------
// The assignee filter's "Unassigned" choice (S8b): tasks with nobody on them.
var TK_UNASSIGNED = "__unassigned__";

// f: { assignee: email|TK_UNASSIGNED|"", statuses: [status], showDone, showOlder, today }
// Deleted tasks never show. Done tasks only with showDone; done more than 12
// months ago only with showOlder too (D5).
function TK_applyFilters(tasks, f) {
  var o = f || {};
  var who = TK_vLower(o.assignee);
  var sts = Array.isArray(o.statuses) ? o.statuses : [];
  return (Array.isArray(tasks) ? tasks : []).filter(function (t) {
    if (!t || t.deleted_at) return false;
    var st = TK_vStatus(t);
    if (st === "done") {
      if (!o.showDone) return false;
      if (!o.showOlder && o.today && TK_vIsOldDone(t, o.today)) return false;
    }
    // S8b: the assignee only, never the owner.
    if (who === TK_UNASSIGNED) {
      if (TK_vLower(t.assignee_email)) return false;
    } else if (who && TK_vLower(t.assignee_email) !== who) return false;
    if (sts.length && sts.indexOf(st) < 0) return false;
    return true;
  });
}

// ---- My Tasks groups (Row 3.1) -----------------------------------------------
var TK_MY_GROUPS = [
  { key: "overdue", label: "Overdue" },
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "later", label: "Later" },
  { key: "waiting", label: "Waiting on client" },
  { key: "unassigned", label: "Unassigned" },
  { key: "done", label: "Done" },
];

// groups: TK_groupMyTasks output. opts: { collapsed: {key: bool}, showDone }.
// Returns the non-empty groups in order, each { key, label, tasks, collapsed }.
// Done is collapsed unless the viewer opened it.
function TK_myGroupsView(groups, opts) {
  var g = groups || {};
  var o = opts || {};
  var col = o.collapsed || {};
  var out = [];
  TK_MY_GROUPS.forEach(function (m) {
    if (m.key === "done" && o.showDone === false) return;
    var list = Array.isArray(g[m.key]) ? g[m.key] : [];
    if (!list.length) return;
    var c = Object.prototype.hasOwnProperty.call(col, m.key) ? !!col[m.key] : m.key === "done";
    out.push({ key: m.key, label: m.label, tasks: list, collapsed: c });
  });
  return out;
}

// The row ids j and k walk through: every task in an open group, in order.
function TK_focusIds(view) {
  var ids = [];
  (view || []).forEach(function (g) {
    if (g.collapsed) return;
    (g.tasks || []).forEach(function (t) {
      if (t && t.id != null) ids.push(t.id);
    });
  });
  return ids;
}

// ---- List keys (Row 3.6) -------------------------------------------------------
// v (P4-3) selects the focused row; Shift+V selects the range from the last pick.
var TK_vLIST_KEYS = { j: "next", k: "prev", Enter: "open", x: "toggle", s: "status", a: "assign", q: "add", "?": "help", v: "select", V: "select" };

function TK_listKeyAction(key) {
  return Object.prototype.hasOwnProperty.call(TK_vLIST_KEYS, key) ? TK_vLIST_KEYS[key] : null;
}

function TK_moveFocus(ids, cur, delta) {
  var list = Array.isArray(ids) ? ids : [];
  if (!list.length) return null;
  var i = list.indexOf(cur);
  if (i < 0) return delta < 0 ? list[list.length - 1] : list[0];
  var j = Math.max(0, Math.min(list.length - 1, i + delta));
  return list[j];
}

// Enter on a link, button or menu item keeps its own meaning.
function TK_vActivatable(el) {
  if (!el) return false;
  var tag = String(el.tagName || "").toUpperCase();
  if (tag === "A" || tag === "BUTTON" || tag === "SUMMARY") return true;
  var role = typeof el.getAttribute === "function" ? el.getAttribute("role") : null;
  return role === "button" || role === "menuitem" || role === "link" || role === "checkbox" || role === "switch";
}

// o: { getState() -> { ids, focusedId }, setFocusedId(id), onOpen(id),
//      onToggleDone(id), onStatusMenu(id), onAssign(id), onQuickAdd(),
//      onHelp(), shouldHandle(e) -> bool, onUsed(key) }
// Returns a keydown handler. It never fires for a key outside the keymap,
// and calls preventDefault on every key it acts on (so the global q handler
// in TK_QuickAddHost, which checks defaultPrevented, stands down).
function TK_makeListKeyHandler(o) {
  var opts = o || {};
  return function (e) {
    if (!e) return;
    var action = TK_listKeyAction(e.key);
    if (!action) return;
    if (typeof opts.shouldHandle === "function" && !opts.shouldHandle(e)) return;
    var st = typeof opts.getState === "function" ? opts.getState() || {} : {};
    var ids = Array.isArray(st.ids) ? st.ids : [];
    var cur = st.focusedId != null && ids.indexOf(st.focusedId) >= 0 ? st.focusedId : null;
    var acted = false;
    if (action === "next" || action === "prev") {
      var next = TK_moveFocus(ids, cur, action === "next" ? 1 : -1);
      if (next != null && typeof opts.setFocusedId === "function") {
        opts.setFocusedId(next);
        acted = true;
      }
    } else if (action === "open") {
      if (cur == null) return;
      // A focused link or button inside the row handles Enter itself; only
      // the row (or the page) opens through here.
      if (e.target && TK_vActivatable(e.target)) return;
      if (typeof opts.onOpen === "function") opts.onOpen(cur);
      acted = true;
    } else if (action === "toggle" || action === "status" || action === "assign") {
      if (cur == null) return;
      var fn = action === "toggle" ? opts.onToggleDone : action === "status" ? opts.onStatusMenu : opts.onAssign;
      if (typeof fn === "function") {
        fn(cur);
        acted = true;
      }
    } else if (action === "select") {
      if (cur == null || typeof opts.onSelect !== "function") return;
      opts.onSelect(cur, !!e.shiftKey);
      acted = true;
    } else if (action === "add") {
      if (typeof opts.onQuickAdd === "function") {
        opts.onQuickAdd();
        acted = true;
      }
    } else if (action === "help") {
      if (typeof opts.onHelp === "function") {
        opts.onHelp();
        acted = true;
      }
    }
    if (!acted) return;
    if (typeof e.preventDefault === "function") e.preventDefault();
    if (typeof opts.onUsed === "function") opts.onUsed(e.key);
  };
}

// Binds the handler on `target` (the page passes document, bubble phase) and
// returns the unbind function. With enabled false it binds nothing and
// returns null, so an open drawer leaves list keys entirely off (C8).
function TK_bindListKeys(target, o) {
  if (!o || !o.enabled || !target || typeof target.addEventListener !== "function") return null;
  var h = TK_makeListKeyHandler(o);
  target.addEventListener("keydown", h, false);
  return function () {
    target.removeEventListener("keydown", h, false);
  };
}

// ---- Projects (Row 1.4) -------------------------------------------------------

// One section per line: trimmed, blanks dropped, duplicates (any case)
// dropped, each cut to 60 characters, at most 30.
function TK_parseSectionsText(text) {
  var out = [];
  var have = {};
  String(text == null ? "" : text)
    .split(/\r?\n/)
    .forEach(function (line) {
      var s = line.replace(/\s+/g, " ").trim().slice(0, 60).trim();
      if (!s) return;
      var k = s.toLowerCase();
      if (have[k]) return;
      have[k] = 1;
      out.push(s);
    });
  return out.slice(0, 30);
}

// The New project form's fields. The "Open to all staff" switch is for
// admins only.
function TK_newProjectFields(opts) {
  var o = opts || {};
  var f = ["name", "sections"];
  if (o.isAdmin === true) f.push("openToStaff");
  return f;
}

// Maps a createProject or updateProject error to { field, text }.
// field "name" puts the message under the name field (the modal stays open).
function TK_projectErrorText(err, copy) {
  var c = copy || (typeof TK_COPY !== "undefined" ? TK_COPY : {});
  var code = err && err.code ? String(err.code) : "";
  if (code === "tk_name_taken" || code === "23505") {
    return { field: "name", text: c.projectNameTaken || "There's already a project with that name. Try another name." };
  }
  if (code === "tk_offline") return { field: null, text: c.offline || "You're offline." };
  return { field: null, text: c.saveError || "Couldn't save that change. Try again." };
}

// UI hint only; tk_can_manage_project decides on the server.
function TK_canManageProjectHint(project, ctx) {
  if (!project) return false;
  var c = ctx || {};
  if (c.isAdmin) return true;
  var me = TK_vLower(c.email);
  if (!me) return false;
  if (TK_vLower(project.owner_email) === me) return true;
  return (Array.isArray(c.members) ? c.members : []).some(function (m) {
    return m && TK_vLower(m.staff_email) === me && m.role === "owner";
  });
}

// ---- Display helpers -----------------------------------------------------------

// Up to two initials from a name, else from the part of an email before "@".
function TK_initials(nameOrEmail) {
  var s = String(nameOrEmail == null ? "" : nameOrEmail).trim();
  if (!s) return "?";
  if (s.indexOf("@") > 0 && s.indexOf(" ") < 0) s = s.slice(0, s.indexOf("@")).replace(/[._-]+/g, " ");
  var words = s.split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  var a = words[0].charAt(0);
  var b = words.length > 1 ? words[words.length - 1].charAt(0) : words[0].charAt(1);
  return (a + (b || "")).toUpperCase();
}

// The list a route shows: { scope, key } for TK_api.listScope and the store,
// or null. Person lists need the staff row (the email never reaches a URL;
// the key carries the staff uuid).
function TK_listScopeOf(route, ctx) {
  var r = route || {};
  if (r.view === "client" && r.clientId) return { scope: { clientId: r.clientId }, key: "client:" + r.clientId };
  if (r.view === "project" && r.projectId) return { scope: { projectId: r.projectId }, key: "project:" + r.projectId };
  if (r.view === "person" && r.staffId) {
    var staff = ctx && Array.isArray(ctx.staff) ? ctx.staff : [];
    var s = null;
    for (var i = 0; i < staff.length; i++) {
      if (staff[i] && staff[i].id === r.staffId) s = staff[i];
    }
    if (!s || !s.email) return null;
    return { scope: { assigneeEmail: TK_vLower(s.email) }, key: "person:" + r.staffId, staff: s };
  }
  return null;
}

// A tk_search row as the minimal task shape TK_TaskRow draws.
function TK_searchRowToTask(row) {
  var r = row || {};
  var st = TK_vSTATUS_ORDER.indexOf(r.status) >= 0 ? r.status : "todo";
  return {
    id: r.task_id,
    text: r.task_text || "",
    client_id: r.client_id || null,
    project_id: r.project_id || null,
    status: st,
    done: st === "done",
    due_date: r.due_date ? String(r.due_date).slice(0, 10) : null,
    priority: "normal",
    deleted_at: null,
  };
}

// ---- Group by: Due date | Client (tasks p3) -----------------------------------
// My Tasks and a person's list can group by client instead of by due date.
// The choice is remembered per person (localStorage, never the server).
var TK_GROUP_BY_VALUES = ["due", "client"];

function TK_normalizeGroupBy(v) {
  return v === "client" ? "client" : "due";
}

// localStorage key for the remembered choice. My Tasks and a person's list keep
// separate choices (scope "person"), both under the same prefix so Dev Tools'
// reset still finds them.
function TK_groupByKey(email, scope) {
  return "mgb_tk_groupby_v1:" + (scope === "person" ? "person:" : "") + (email || "");
}

// TK_groupMyTasks output -> one flat list, in group order (Overdue first,
// Done last), so a client's group still reads most urgent first. Done tasks
// are left out when opts.showDone === false.
function TK_flattenMyGroups(groups, opts) {
  var g = groups || {};
  var o = opts || {};
  var out = [];
  TK_MY_GROUPS.forEach(function (m) {
    if (m.key === "done" && o.showDone === false) return;
    var list = Array.isArray(g[m.key]) ? g[m.key] : [];
    list.forEach(function (t) {
      if (t) out.push(t);
    });
  });
  return out;
}

var TK_NO_CLIENT_KEY = "client:__none__";

// Groups tasks by client. Order: real clients A to Z, then "No client", then
// Test clients, then Internal (the same last-place rule as ClientFlags.jsx).
// opts: { clients: [{ id, name, testOnly, isInternal }], collapsed: {key: bool},
//         flagOf(client) -> "internal" | "test" | null (CF_flag when the page has it) }.
// Returns [{ key, name, label, clientId, flag, tasks, collapsed }]; empty
// groups never appear. Task order inside a group is the input order.
function TK_groupByClient(tasks, opts) {
  var o = opts || {};
  var list = Array.isArray(tasks) ? tasks : [];
  var clients = Array.isArray(o.clients) ? o.clients : [];
  var col = o.collapsed || {};
  var flagOf =
    typeof o.flagOf === "function"
      ? o.flagOf
      : function (c) {
          if (!c) return null;
          if (c.isInternal === true) return "internal";
          if (c.testOnly === true) return "test";
          return null;
        };
  var byId = {};
  clients.forEach(function (c) {
    if (c && c.id != null) byId[String(c.id)] = c;
  });
  var buckets = {};
  var order = [];
  list.forEach(function (t) {
    if (!t) return;
    var hasClient = t.client_id != null && String(t.client_id) !== "";
    var key = hasClient ? "client:" + String(t.client_id) : TK_NO_CLIENT_KEY;
    if (!buckets[key]) {
      var c = hasClient ? byId[String(t.client_id)] || null : null;
      var name = hasClient ? (c && c.name) || String(t.client_id) : "No client";
      buckets[key] = {
        key: key,
        name: name,
        label: name,
        clientId: hasClient ? String(t.client_id) : null,
        flag: hasClient ? flagOf(c) : null,
        tasks: [],
        collapsed: Object.prototype.hasOwnProperty.call(col, key) ? !!col[key] : false,
      };
      order.push(key);
    }
    buckets[key].tasks.push(t);
  });
  function rank(g) {
    if (g.clientId == null) return 1;
    if (g.flag === "internal") return 3;
    if (g.flag === "test") return 2;
    return 0;
  }
  return order
    .map(function (k) {
      return buckets[k];
    })
    .sort(function (a, b) {
      var r = rank(a) - rank(b);
      if (r) return r;
      var x = a.name.toLowerCase();
      var y = b.name.toLowerCase();
      if (x !== y) return x < y ? -1 : 1;
      return String(a.clientId) < String(b.clientId) ? -1 : String(a.clientId) > String(b.clientId) ? 1 : 0;
    });
}

// ---- Manage projects (tasks p3) ---------------------------------------------------
// rows: tk_admin_list_projects output. state is "active", "archived",
// "trashed" or "expired" (30+ days in the trash; still restorable by an admin).
var TK_MANAGE_FILTERS = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "archived", label: "Archived" },
  { key: "trashed", label: "Trash" },
];

function TK_manageIsTrashed(r) {
  return !!r && (r.state === "trashed" || r.state === "expired");
}

function TK_manageCounts(rows) {
  var c = { all: 0, active: 0, archived: 0, trashed: 0 };
  (Array.isArray(rows) ? rows : []).forEach(function (r) {
    if (!r) return;
    if (TK_manageIsTrashed(r)) c.trashed++;
    else if (r.state === "archived") c.archived++;
    else c.active++;
    if (!TK_manageIsTrashed(r)) c.all++;
  });
  return c;
}

// filter: "all" (everything not in the trash), "active", "archived", "trashed".
// query: matches the project name, client, owner name or owner email.
function TK_manageFilterRows(rows, opts) {
  var o = opts || {};
  var f = o.filter || "all";
  var q = String(o.query == null ? "" : o.query).trim().toLowerCase();
  return (Array.isArray(rows) ? rows : []).filter(function (r) {
    if (!r) return false;
    var trashed = TK_manageIsTrashed(r);
    if (f === "trashed") {
      if (!trashed) return false;
    } else if (trashed) {
      return false;
    } else if (f === "active" && r.state !== "active") return false;
    else if (f === "archived" && r.state !== "archived") return false;
    if (!q) return true;
    return [r.name, r.client_name, r.owner_name, r.owner_email].some(function (x) {
      return String(x == null ? "" : x).toLowerCase().indexOf(q) >= 0;
    });
  });
}

// The buttons a row offers, in order.
function TK_manageActions(row) {
  if (!row) return [];
  if (TK_manageIsTrashed(row)) return ["restore"];
  if (row.state === "archived") return ["rename", "unarchive", "trash"];
  return ["rename", "archive", "trash"];
}

function TK_manageDaysBetween(fromIso, nowMs) {
  var t = Date.parse(fromIso || "");
  if (!isFinite(t)) return null;
  return Math.max(0, Math.floor(((typeof nowMs === "number" ? nowMs : Date.now()) - t) / 86400000));
}

function TK_managePlural(n, one, many) {
  return n + " " + (n === 1 ? one : many);
}

// One line under a trashed row. nowMs is optional (tests pass it).
function TK_manageTrashNote(row, nowMs) {
  if (!TK_manageIsTrashed(row)) return "";
  var days = TK_manageDaysBetween(row.trashed_at, nowMs);
  if (days == null) return "In the trash.";
  if (row.state === "expired" || days >= 30) {
    return "In the trash for " + TK_managePlural(days, "day", "days") + ". Past the 30-day mark, but an admin can still restore it.";
  }
  var left = 30 - days;
  var when = days === 0 ? "Moved to the trash today" : "In the trash for " + TK_managePlural(days, "day", "days");
  return when + ". " + TK_managePlural(left, "day", "days") + " left in the usual window.";
}

// Wording for the "Move to trash" confirm.
function TK_manageTrashConfirm(row) {
  var name = (row && row.name) || "this project";
  var open = row && typeof row.open_tasks === "number" ? row.open_tasks : 0;
  var done = row && typeof row.done_tasks === "number" ? row.done_tasks : 0;
  var tasks = open + done;
  var counted = row && typeof row.open_tasks === "number" && typeof row.done_tasks === "number";
  var others = row && typeof row.other_tasks === "number" ? row.other_tasks : 0;
  var body;
  if (!counted) {
    body = "The project and all its tasks, including other people's, will disappear from every list, including My Tasks.";
  } else if (tasks) {
    body = TK_managePlural(tasks, "task", "tasks") + " (" + open + " open, " + done + " done) will disappear from every list, including My Tasks, with the project.";
    if (others) body += " " + (others === tasks ? "All of them" : others + " of them") + " belong" + (others === 1 ? "s" : "") + " to other people.";
  } else {
    body = "The project will disappear from every list.";
  }
  return {
    title: "Move “" + name + "” to the trash?",
    body: body + " Nothing is deleted. An admin can restore it from Manage projects.",
    confirm: "Move to trash",
  };
}

// Friendly text for an RPC error from rename, archive, trash or restore.
function TK_manageErrorText(err) {
  var why = err && (err.reason || err.code) ? String(err.reason || err.code) : "";
  if (why === "tk_restore_name_taken") return "Rename or archive the active project with this name first, then restore this one.";
  if (why === "tk_name_taken" || why === "23505") return "There's already a project with that name. Try another name.";
  if (why === "tk_bad_name") return "A project name needs 1 to 120 characters.";
  if (why === "tk_has_open_requests") {
    return "A task in this project is waiting on a client (an Ask client request is open or answered but not accepted). Finish or cancel it first, then move the project to the trash.";
  }
  if (why === "tk_project_trashed") return "That project is in the trash. Restore it first.";
  if (why === "tk_trash_expired") return "This project has been in the trash for over 30 days. Only an admin can restore it.";
  if (why === "tk_forbidden") return "You can't do that to this project.";
  if (why === "tk_offline") return "You're offline. Try again when you're back online.";
  return "Couldn't save that change. Try again.";
}

// ---- Subtasks inline (tasks p3) -------------------------------------------------
// A task with subtasks shows a chevron and a done count; the subtasks open
// directly beneath it. One level only (a subtask has no subtasks).

var TK_SUBS_OPEN_KEY = "mgb_tk_subs_open_v1";
var TK_SUBS_OPEN_MAX = 400;

// rows: any mix of tasks. Returns { [parentId]: [subtask] } with deleted rows
// and self-parented rows left out, each id once (the last copy wins), in the
// drawer's order: sort_key (empty last), then created_at, then id.
function TK_subIndex(rows) {
  var seen = {};
  var list = [];
  (Array.isArray(rows) ? rows : []).forEach(function (t) {
    if (!t || t.id == null || t.parent_id == null || t.parent_id === "") return;
    if (String(t.parent_id) === String(t.id)) return;
    if (Object.prototype.hasOwnProperty.call(seen, t.id)) list[seen[t.id]] = t;
    else {
      seen[t.id] = list.length;
      list.push(t);
    }
  });
  var out = {};
  list
    .filter(function (t) {
      return !t.deleted_at;
    })
    .sort(function (a, b) {
      var k = TK_vNullsLast(a.sort_key, b.sort_key);
      if (k) return k;
      var c = TK_vNullsLast(a.created_at, b.created_at);
      if (c) return c;
      return String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0;
    })
    .forEach(function (t) {
      var pid = String(t.parent_id);
      (out[pid] = out[pid] || []).push(t);
    });
  return out;
}

// { done, total } for a parent's subtasks.
function TK_subCount(kids) {
  var list = Array.isArray(kids) ? kids : [];
  var done = 0;
  list.forEach(function (t) {
    if (TK_vStatus(t) === "done") done++;
  });
  return { done: done, total: list.length };
}

// "2/5"; "" when there are none.
function TK_subChipText(count) {
  if (!count || !count.total) return "";
  return count.done + "/" + count.total;
}

// The spoken label of the expand button.
function TK_subToggleLabel(title, count, open) {
  var c = count || { done: 0, total: 0 };
  var what = c.total === 1 ? "1 subtask" : c.total + " subtasks";
  return (open ? "Hide " : "Show ") + what + " of " + (title || "this task") + ", " + c.done + " of " + c.total + " done";
}

// Rows that appear under a parent in the same group are not repeated as their
// own row. A subtask whose parent is not in its group (another due-date group,
// hidden, done) keeps its own row so it never disappears. groups: any array of
// { tasks }; returns new groups (others keep their object), same order.
function TK_subNestGroups(groups, kidsOf) {
  var has = kidsOf || {};
  return (Array.isArray(groups) ? groups : []).map(function (g) {
    if (!g || !Array.isArray(g.tasks)) return g;
    var ids = {};
    g.tasks.forEach(function (t) {
      if (t && t.id != null) ids[String(t.id)] = true;
    });
    var kept = g.tasks.filter(function (t) {
      if (!t || t.parent_id == null || t.parent_id === "") return true;
      var pid = String(t.parent_id);
      if (!ids[pid] || !has[pid]) return true;
      // only hide it when the parent will actually list it
      return !has[pid].some(function (k) {
        return k && String(k.id) === String(t.id);
      });
    });
    if (kept.length === g.tasks.length) return g;
    var out = {};
    for (var key in g) if (Object.prototype.hasOwnProperty.call(g, key)) out[key] = g[key];
    out.tasks = kept;
    return out;
  });
}

// What a click on a row does. hasKids: the row has subtasks. kind: "interactive"
// (a button, link, input or menu inside the row), "title" (the title link) or
// "body" (anything else). A row without subtasks opens the drawer from its body.
function TK_subRowClickAction(hasKids, kind) {
  if (kind === "interactive" || kind === "title") return "none";
  return hasKids ? "toggle" : "open";
}

// Arrow keys on a focused row: right opens its subtasks, left closes them.
function TK_subKeyAction(key, hasKids, open) {
  if (!hasKids) return null;
  if (key === "ArrowRight") return open ? null : "expand";
  if (key === "ArrowLeft") return open ? "collapse" : null;
  return null;
}

// Saved open state (a JSON object read from storage) -> { [id]: true }.
function TK_subOpenRead(raw) {
  var out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  Object.keys(raw).forEach(function (id) {
    if (raw[id] === true && id) out[id] = true;
  });
  return out;
}

// Flip one id. Keeps at most `max` open ids (the oldest-opened drop first).
function TK_subOpenToggle(open, id, max) {
  var cap = max || TK_SUBS_OPEN_MAX;
  var cur = TK_subOpenRead(open);
  var key = String(id);
  var out = {};
  var ids = Object.keys(cur).filter(function (k) {
    return k !== key;
  });
  if (!cur[key]) ids.push(key);
  ids = ids.slice(Math.max(0, ids.length - cap));
  ids.forEach(function (k) {
    out[k] = true;
  });
  return out;
}

// ---- Project colors (tasks p3) ---------------------------------------------------
// The ten palette keys. The database holds the same list in
// supabase/tasks-p3-project-colors.sql (a node test keeps the two equal). The
// colors themselves are CSS tokens (--tk-pc-<key> in tk-views.css), so dark
// mode follows the app's theme.
var TK_PROJECT_COLORS = [
  { key: "blue", label: "Blue" },
  { key: "teal", label: "Teal" },
  { key: "green", label: "Green" },
  { key: "amber", label: "Amber" },
  { key: "coral", label: "Coral" },
  { key: "pink", label: "Pink" },
  { key: "purple", label: "Purple" },
  { key: "navy", label: "Navy" },
  { key: "olive", label: "Olive" },
  { key: "gray", label: "Gray" },
];

function TK_projectColorKeys() {
  return TK_PROJECT_COLORS.map(function (c) {
    return c.key;
  });
}

function TK_isProjectColor(v) {
  return typeof v === "string" && TK_projectColorKeys().indexOf(v) >= 0;
}

// The palette key to draw for a project: its own color when valid, else a
// stable pick from its id (an old cached row, or one read before the column
// existed), else gray. Never throws.
function TK_projectColorOf(project) {
  if (!project) return "gray";
  if (TK_isProjectColor(project.color)) return project.color;
  var s = String(project.id != null ? project.id : project.name != null ? project.name : "");
  if (!s) return "gray";
  var h = 0;
  for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 100003;
  return TK_PROJECT_COLORS[h % TK_PROJECT_COLORS.length].key;
}

function TK_projectColorLabel(key) {
  for (var i = 0; i < TK_PROJECT_COLORS.length; i++) if (TK_PROJECT_COLORS[i].key === key) return TK_PROJECT_COLORS[i].label;
  return "Gray";
}

// A project's color by id from a project list ("" when the id is unknown or
// not a project, so a task outside any project shows no dot).
function TK_projectColorById(projects, id) {
  if (id == null || id === "") return "";
  var list = Array.isArray(projects) ? projects : [];
  for (var i = 0; i < list.length; i++) if (list[i] && String(list[i].id) === String(id)) return TK_projectColorOf(list[i]);
  return "";
}

// Friendly text for a failed color change (tk_project_set_color).
function TK_projectColorError(err) {
  var why = err && (err.reason || err.code) ? String(err.reason || err.code) : "";
  if (why === "tk_bad_color") return "That color isn't one of the choices.";
  if (why === "tk_project_trashed") return "That project is in the trash. Restore it first.";
  if (why === "tk_forbidden") return "You can't change this project's color.";
  if (why === "tk_offline") return "You're offline. Try again when you're back online.";
  return "Couldn't save that color. Try again.";
}

// ---- Multi-select + bulk results (P4-3) -------------------------------------------
// Selection is { ids: { id: true }, anchor: id | null }, a plain value: every
// helper returns a new object (or the same one when nothing changed).

function TK_selEmpty() {
  return { ids: {}, anchor: null };
}

function TK_selCount(sel) {
  return sel && sel.ids ? Object.keys(sel.ids).length : 0;
}

function TK_selHas(sel, id) {
  return !!(sel && sel.ids && id != null && Object.prototype.hasOwnProperty.call(sel.ids, String(id)));
}

// Selected ids in list order first, then any not on the list (kept in the
// order they were picked).
function TK_selList(sel, order) {
  if (!sel || !sel.ids) return [];
  var out = [];
  var seen = {};
  (Array.isArray(order) ? order : []).forEach(function (id) {
    var k = String(id);
    if (sel.ids[k] && !seen[k]) {
      seen[k] = 1;
      out.push(k);
    }
  });
  Object.keys(sel.ids).forEach(function (k) {
    if (!seen[k]) out.push(k);
  });
  return out;
}

// Click or v: toggle one row. Shift (click or Shift+V) with an anchor on the
// list: select every row from the anchor to this one (adds; never clears).
// max caps the selection (the server takes 100 ids at a time).
function TK_selToggle(sel, id, order, shift, max) {
  if (id == null) return sel || TK_selEmpty();
  var cur = sel && sel.ids ? sel : TK_selEmpty();
  var k = String(id);
  var ids = {};
  Object.keys(cur.ids).forEach(function (x) { ids[x] = true; });
  var cap = Number(max) > 0 ? Number(max) : Infinity;
  var list = (Array.isArray(order) ? order : []).map(String);
  var a = cur.anchor != null ? list.indexOf(String(cur.anchor)) : -1;
  var b = list.indexOf(k);
  if (shift && a >= 0 && b >= 0) {
    var lo = Math.min(a, b);
    var hi = Math.max(a, b);
    for (var i = lo; i <= hi; i++) {
      if (!ids[list[i]] && Object.keys(ids).length >= cap) break;
      ids[list[i]] = true;
    }
    return { ids: ids, anchor: cur.anchor };
  }
  if (ids[k]) delete ids[k];
  else {
    if (Object.keys(ids).length >= cap) return cur;
    ids[k] = true;
  }
  return { ids: ids, anchor: k };
}

// Drop ids that left the list (filtered, deleted, moved). Same object back
// when nothing changed, so a React state set is a no-op.
function TK_selPrune(sel, visibleIds) {
  if (!sel || !sel.ids) return TK_selEmpty();
  var keep = {};
  (Array.isArray(visibleIds) ? visibleIds : []).forEach(function (id) { keep[String(id)] = 1; });
  var changed = false;
  var ids = {};
  Object.keys(sel.ids).forEach(function (k) {
    if (keep[k]) ids[k] = true;
    else changed = true;
  });
  var anchor = sel.anchor != null && keep[String(sel.anchor)] ? sel.anchor : null;
  if (!changed && anchor === sel.anchor) return sel;
  return { ids: ids, anchor: anchor };
}

// How many of the selected tasks each action could touch (the server still
// decides; this only labels the bar).
function TK_bulkCounts(tasks) {
  var out = { total: 0, open: 0, done: 0, review: 0, waiting: 0 };
  (Array.isArray(tasks) ? tasks : []).forEach(function (t) {
    if (!t) return;
    out.total++;
    var st = t.status || (t.done ? "done" : "todo");
    if (st === "done") out.done++;
    else if (st === "ready_for_review") out.review++;
    else if (st === "waiting_client") out.waiting++;
    else out.open++;
  });
  return out;
}

// Why the server skipped a row (tk_bulk_* / tk_undo reason codes).
var TK_BULK_REASONS = {
  no_access: "You can't change it.",
  deleted: "It was deleted.",
  in_trash: "Its project is in the trash.",
  in_review: "It's in review. Approve it in Review.",
  waiting_client: "It's waiting on the client.",
  already_done: "It's already done.",
  not_done: "It isn't done.",
  approved_admin_only: "It was approved. Only an admin can reopen it.",
  owner_only: "Only the person who made it or an admin can change that.",
  assignee_no_access: "That person can't see its client.",
  project_client: "That project belongs to another client.",
  project_archived: "That project is archived.",
  project_trashed: "That project is in the trash.",
  no_due_date: "It has no due date to move.",
  no_change: "Nothing to change.",
  has_open_requests: "It has open client requests.",
  bad_transition: "Its status can't change that way.",
  changed_since: "It changed after your action.",
  error: "Something went wrong with this one.",
};

function TK_bulkReasonText(code) {
  var k = code == null ? "" : String(code);
  return Object.prototype.hasOwnProperty.call(TK_BULK_REASONS, k) ? TK_BULK_REASONS[k] : TK_BULK_REASONS.error;
}

var TK_BULK_VERBS = {
  complete: "completed",
  reopen: "reopened",
  delete: "deleted",
  reassign: "reassigned",
  move_project: "moved",
  set_due: "rescheduled",
};

function TK__tasks(n) {
  return n + (n === 1 ? " task" : " tasks");
}

// "7 tasks completed." / "5 completed, 1 sent for review, 2 skipped." /
// "Nothing changed: 3 skipped."
function TK_bulkSummary(kind, r) {
  var res = r || {};
  var done = Array.isArray(res.done) ? res.done.length : 0;
  var review = Array.isArray(res.review) ? res.review.length : 0;
  var skipped = Array.isArray(res.skipped) ? res.skipped.length : 0;
  var verb = TK_BULK_VERBS[kind] || "updated";
  if (!done && !review) return skipped ? "Nothing changed: " + skipped + " skipped." : "Nothing changed.";
  if (!review && !skipped) return TK__tasks(done) + " " + verb + ".";
  var parts = [];
  if (done) parts.push(done + " " + verb);
  if (review) parts.push(review + " sent for review");
  if (skipped) parts.push(skipped + " skipped");
  return parts.join(", ") + ".";
}

function TK__names(list) {
  var a = (Array.isArray(list) ? list : []).filter(Boolean).map(String);
  if (!a.length) return "";
  if (a.length === 1) return a[0];
  if (a.length === 2) return a[0] + " and " + a[1];
  return a.slice(0, -1).join(", ") + " and " + a[a.length - 1];
}

// After tk_undo: "Undone." plus what could not be put back and who was
// already emailed.
function TK_undoSummary(res) {
  var r = res || {};
  var skipped = Array.isArray(r.skipped) ? r.skipped.length : 0;
  var done = Array.isArray(r.done) ? r.done.length : 0;
  var out = !done && skipped ? "Couldn't undo: " + (skipped === 1 ? "the task" : "the tasks") + " changed since." : "Undone.";
  if (done && skipped) out += " " + TK__tasks(skipped) + " changed since and stayed as they are.";
  var kept = Array.isArray(r.spawnedKept) ? r.spawnedKept.length : 0;
  if (kept) out += kept === 1 ? " The next repeat was kept because someone used it." : " " + kept + " next repeats were kept because someone used them.";
  var names = TK__names(r.alreadyEmailed);
  if (names) out += " " + names + (Array.isArray(r.alreadyEmailed) && r.alreadyEmailed.length > 1 ? " were" : " was") + " already emailed.";
  return out;
}

// Skipped rows grouped by reason for the "N skipped" list:
// [{ reason, text, items: [{ id, name }] }], biggest group first.
function TK_skipGroups(skipped, nameOf) {
  var by = {};
  var order = [];
  (Array.isArray(skipped) ? skipped : []).forEach(function (s) {
    if (!s) return;
    var reason = String(s.reason || "error");
    if (!by[reason]) {
      by[reason] = { reason: reason, text: TK_bulkReasonText(reason), items: [] };
      order.push(reason);
    }
    var name = typeof nameOf === "function" ? nameOf(s.id) : "";
    by[reason].items.push({ id: String(s.id || ""), name: name || "A task" });
  });
  return order
    .map(function (k, i) { return { g: by[k], i: i }; })
    .sort(function (x, y) { return y.g.items.length - x.g.items.length || x.i - y.i; })
    .map(function (x) { return x.g; });
}

// Ctrl/Cmd+Z (no Shift, no Alt), and never while typing in a field.
function TK_isUndoKey(e) {
  if (!e || e.shiftKey || e.altKey) return false;
  if (!(e.ctrlKey || e.metaKey)) return false;
  if (e.key !== "z" && e.key !== "Z") return false;
  var el = e.target || null;
  if (el) {
    var tag = String(el.tagName || "").toUpperCase();
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return false;
    if (el.isContentEditable) return false;
    var ce = typeof el.getAttribute === "function" ? el.getAttribute("contenteditable") : null;
    if (ce === "" || ce === "true" || ce === "plaintext-only") return false;
    var role = typeof el.getAttribute === "function" ? el.getAttribute("role") : null;
    if (role === "textbox") return false;
  }
  return true;
}

// Due date choices for the bulk bar: a date or a shift in days.
function TK_bulkDuePatch(choice, value) {
  if (choice === "shift") {
    var n = parseInt(value, 10);
    if (!n || isNaN(n) || n < -365 || n > 365) return null;
    return { due_shift_days: n };
  }
  if (choice === "clear") return { due_date: null };
  if (choice === "date") {
    var v = value == null ? "" : String(value);
    return /^\d{4}-\d{2}-\d{2}$/.test(v) ? { due_date: v } : null;
  }
  return null;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    TK_POPOUT_DEFAULT: TK_POPOUT_DEFAULT,
    TK_POPOUT_MIN: TK_POPOUT_MIN,
    TK_POPOUT_KEY: TK_POPOUT_KEY,
    TK_DOCK_WAIT_MS: TK_DOCK_WAIT_MS,
    TK_popOutSize: TK_popOutSize,
    TK_popOutFeatures: TK_popOutFeatures,
    TK_dockPlan: TK_dockPlan,
    TK_shellLayout: TK_shellLayout,
    TK_isTouchPrimary: TK_isTouchPrimary,
    TK_groupBySection: TK_groupBySection,
    TK_SORT_COLS: TK_SORT_COLS,
    TK_sortTasks: TK_sortTasks,
    TK_toggleSort: TK_toggleSort,
    TK_applyFilters: TK_applyFilters,
    TK_UNASSIGNED: TK_UNASSIGNED,
    TK_MY_GROUPS: TK_MY_GROUPS,
    TK_myGroupsView: TK_myGroupsView,
    TK_focusIds: TK_focusIds,
    TK_listKeyAction: TK_listKeyAction,
    TK_moveFocus: TK_moveFocus,
    TK_makeListKeyHandler: TK_makeListKeyHandler,
    TK_bindListKeys: TK_bindListKeys,
    TK_parseSectionsText: TK_parseSectionsText,
    TK_newProjectFields: TK_newProjectFields,
    TK_projectErrorText: TK_projectErrorText,
    TK_canManageProjectHint: TK_canManageProjectHint,
    TK_initials: TK_initials,
    TK_listScopeOf: TK_listScopeOf,
    TK_searchRowToTask: TK_searchRowToTask,
    TK_GROUP_BY_VALUES: TK_GROUP_BY_VALUES,
    TK_normalizeGroupBy: TK_normalizeGroupBy,
    TK_groupByKey: TK_groupByKey,
    TK_flattenMyGroups: TK_flattenMyGroups,
    TK_NO_CLIENT_KEY: TK_NO_CLIENT_KEY,
    TK_groupByClient: TK_groupByClient,
    TK_MANAGE_FILTERS: TK_MANAGE_FILTERS,
    TK_manageCounts: TK_manageCounts,
    TK_manageFilterRows: TK_manageFilterRows,
    TK_manageActions: TK_manageActions,
    TK_manageTrashNote: TK_manageTrashNote,
    TK_manageTrashConfirm: TK_manageTrashConfirm,
    TK_manageErrorText: TK_manageErrorText,
    TK_SUBS_OPEN_KEY: TK_SUBS_OPEN_KEY,
    TK_SUBS_OPEN_MAX: TK_SUBS_OPEN_MAX,
    TK_subIndex: TK_subIndex,
    TK_subCount: TK_subCount,
    TK_subChipText: TK_subChipText,
    TK_subToggleLabel: TK_subToggleLabel,
    TK_subNestGroups: TK_subNestGroups,
    TK_subRowClickAction: TK_subRowClickAction,
    TK_subKeyAction: TK_subKeyAction,
    TK_subOpenRead: TK_subOpenRead,
    TK_subOpenToggle: TK_subOpenToggle,
    TK_PROJECT_COLORS: TK_PROJECT_COLORS,
    TK_projectColorKeys: TK_projectColorKeys,
    TK_isProjectColor: TK_isProjectColor,
    TK_projectColorOf: TK_projectColorOf,
    TK_projectColorLabel: TK_projectColorLabel,
    TK_projectColorById: TK_projectColorById,
    TK_projectColorError: TK_projectColorError,
    TK_selEmpty: TK_selEmpty,
    TK_selCount: TK_selCount,
    TK_selHas: TK_selHas,
    TK_selList: TK_selList,
    TK_selToggle: TK_selToggle,
    TK_selPrune: TK_selPrune,
    TK_bulkCounts: TK_bulkCounts,
    TK_BULK_REASONS: TK_BULK_REASONS,
    TK_bulkReasonText: TK_bulkReasonText,
    TK_bulkSummary: TK_bulkSummary,
    TK_undoSummary: TK_undoSummary,
    TK_skipGroups: TK_skipGroups,
    TK_isUndoKey: TK_isUndoKey,
    TK_bulkDuePatch: TK_bulkDuePatch,
  };
}
