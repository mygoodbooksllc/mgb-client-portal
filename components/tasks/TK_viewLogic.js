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
//   Slate app (preview, spec-desk-fullpage) TK_slateAppIsOn, TK_slateMode, TK_slateCurrent,
//                                         TK_slateSizePreset, TK_slateDeepHref (and the app minimum in TK_popOutSize)
//   Slate app bridge (S2)                 TK_slateForwardOk, TK_slateDockPick, TK_slateIsTasksHash,
//                                         TK_slateDockHashOk, TK_slateAppUrl, TK_slateLaunchItems
//   Slate app P3 (preview)                TK_validateViewName, TK_mergeSavedViews, TK_activeSavedViewId (named saved views);
//                                         TK_bulkSetOffer, TK_bulkSetPlan, TK_bulkSameProject (bulk Status, Priority, Section)
//   Slate app P2 (preview)                TK_manual* (per-person manual order, drag and Alt+Up/Down)
//   Slate app interactions (preview)      TK_copySkipText, TK_manualUndoPlan, TK_ix* (menu, due picks, snooze,
//                                         paste target, drag box, row swipes, swipe back), TK_slateKeyAction
//   Slate app P1 (preview)                TK_boardAllowed, TK_boardColumns, TK_boardDropCheck, TK_boardKeyMove,
//                                         TK_boardLayoutRead/Write (List | Board per list), TK_boardAnnounce
//
// TK_logic.js loads first, so TK_compareTasks, TK_isOldDone and
// TK_CLIENT_SECTION_ORDER are used when they exist. Under node (where only
// this file is loaded) each has a private fallback with the same rule, so
// this file tests on its own. Private helpers carry the TK_v prefix so they
// never collide with another TK file.
// ----------------------------------------------------------------------------

var TK_POPOUT_DEFAULT = { w: 480, h: 820 };
var TK_POPOUT_MIN = { w: 380, h: 520 };
// Slate app only (TK_slateAppIsOn): the popup may shrink to a sliver. window.open
// and resizeTo take OUTER sizes; Chrome's outer floor is about 141px tall, so a
// 120px request would be refused (S0). 180 outer gives about 123px of content.
var TK_POPOUT_MIN_APP = { w: 240, h: 180 };
var TK_POPOUT_KEY = "mgb_tk_popout_v1";
var TK_DOCK_WAIT_MS = 600;

// ---- Pop-out ---------------------------------------------------------------

function TK_vNum(v) {
  var n = typeof v === "number" ? v : parseFloat(v);
  return isFinite(n) ? Math.round(n) : null;
}

// saved: { w, h } from localStorage (or null). scr: { availWidth, availHeight }
// (defaults to window.screen when there is one). appOn: true only when the
// Slate app is on (TK_slateAppIsOn); the minimum then drops from 380x520 to
// 240x180 (outer size). Off or omitted: exactly the numbers it has always returned.
// Returns the clamped size.
function TK_popOutSize(saved, scr, appOn) {
  var s = scr;
  if (!s && typeof screen !== "undefined" && screen) s = { availWidth: screen.availWidth, availHeight: screen.availHeight };
  var maxW = s && TK_vNum(s.availWidth) ? TK_vNum(s.availWidth) : Infinity;
  var maxH = s && TK_vNum(s.availHeight) ? TK_vNum(s.availHeight) : Infinity;
  var min = appOn === true ? TK_POPOUT_MIN_APP : TK_POPOUT_MIN;
  var w = saved ? TK_vNum(saved.w) : null;
  var h = saved ? TK_vNum(saved.h) : null;
  if (w == null || h == null) {
    w = TK_POPOUT_DEFAULT.w;
    h = TK_POPOUT_DEFAULT.h;
  }
  w = Math.max(min.w, w);
  h = Math.max(min.h, h);
  // A screen smaller than the minimum still wins: the window must fit.
  w = Math.min(w, maxW);
  h = Math.min(h, maxH);
  return { w: w, h: h };
}

function TK_popOutFeatures(saved, scr, appOn) {
  var z = TK_popOutSize(saved, scr, appOn);
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
    // Slate app only (opts.slateKeys): arrows and e. Off, nothing changes.
    if (!action && opts.slateKeys && typeof TK_slateKeyAction === "function") action = TK_slateKeyAction(e.key);
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
    } else if (action === "edit") {
      if (cur == null || typeof opts.onEdit !== "function") return;
      opts.onEdit(cur);
      acted = true;
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
    body = "The project and all its tasks, including other people's, will disappear from every list, including Slate.";
  } else if (tasks) {
    body = TK_managePlural(tasks, "task", "tasks") + " (" + open + " open, " + done + " done) will disappear from every list, including Slate, with the project.";
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

// Selected ids that are on the list (rows on screen), in list order. Bulk
// actions use this, so a selected row that was hidden or collapsed is never
// acted on.
function TK_selOnList(sel, order) {
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
  // Slate app P3 (tk_bulk_set)
  done_use_reopen: "It's done. Reopen it first.",
  no_project: "It isn't in a project.",
  section_missing: "Its project has no section by that name.",
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
  set_status: "updated",
  set_priority: "updated",
  set_section: "moved",
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
    var type = String(el.type || (typeof el.getAttribute === "function" ? el.getAttribute("type") : "") || "").toLowerCase();
    // a checkbox or radio has no text to undo: Ctrl+Z still undoes the task change
    if (tag === "INPUT" && type !== "checkbox" && type !== "radio") return false;
    if (tag === "TEXTAREA" || tag === "SELECT") return false;
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

// ---- Slate app P3: bulk Status, Priority and Section (app only) ----
// The portal bar never offers these. Status: Done goes through the same Complete
// path as the Complete button (review gate, recurring roll-forward); the three
// open statuses go through tk_bulk_set, which runs tk_set_status per task.
// Ready for review is not bulk-settable (it notifies reviewers). Section: only
// when every selected task is in one project, from that project's own list.

var TK_BULK_STATUS_CHOICES = [
  { value: "todo", label: "To do" },
  { value: "in_progress", label: "In progress" },
  { value: "waiting_client", label: "Waiting on client" },
  { value: "done", label: "Done" },
];
var TK_BULK_PRIORITY_CHOICES = [
  { value: "high", label: "High" },
  { value: "normal", label: "Normal" },
  { value: "low", label: "Low" },
];
var TK_BULK_SECTION_MAX = 60;

// -> { kind, patch } for TK_api.bulkRun, or null for a value that is not offered.
function TK_bulkStatusRoute(value) {
  if (value === "done") return { kind: "complete", patch: null };
  if (value === "todo" || value === "in_progress" || value === "waiting_client") return { kind: "set_status", patch: { status: value } };
  return null;
}

function TK_bulkPriorityRoute(value) {
  return value === "high" || value === "normal" || value === "low" ? { kind: "set_priority", patch: { priority: value } } : null;
}

// value null / "" clears the section; a string must be 1-60 characters.
function TK_bulkSectionRoute(value) {
  if (value == null || value === "") return { kind: "set_section", patch: { section: null } };
  if (typeof value !== "string") return null;
  var v = value.trim();
  if (!v || v.length > TK_BULK_SECTION_MAX) return null;
  return { kind: "set_section", patch: { section: v } };
}

// One project shared by every selected task. why: "empty" (nothing selected),
// "none" (some task has no project), "mixed" (more than one project).
function TK_bulkSameProject(tasks) {
  var list = (Array.isArray(tasks) ? tasks : []).filter(Boolean);
  if (!list.length) return { ok: false, projectId: null, why: "empty" };
  var id = null;
  for (var i = 0; i < list.length; i++) {
    var pid = list[i].project_id == null || list[i].project_id === "" ? null : String(list[i].project_id);
    if (!pid) return { ok: false, projectId: null, why: "none" };
    if (id === null) id = pid;
    else if (id !== pid) return { ok: false, projectId: null, why: "mixed" };
  }
  return { ok: true, projectId: id, why: "" };
}

function TK_vProjectOf(projects, id) {
  if (!projects || id == null) return null;
  if (Array.isArray(projects)) {
    for (var i = 0; i < projects.length; i++) if (projects[i] && String(projects[i].id) === String(id)) return projects[i];
    return null;
  }
  return projects[id] || null;
}

// The sections the picker offers: that project's own list, trimmed and
// de-duplicated (without regard to case), in the project's order.
function TK_bulkSectionChoices(tasks, projects) {
  var same = TK_bulkSameProject(tasks);
  if (!same.ok) return [];
  var p = TK_vProjectOf(projects, same.projectId);
  var seen = {};
  var out = [];
  (p && Array.isArray(p.sections) ? p.sections : []).forEach(function (x) {
    var v = x == null ? "" : String(x).trim();
    if (!v || seen[v.toLowerCase()]) return;
    seen[v.toLowerCase()] = 1;
    out.push(v);
  });
  return out;
}

// What the bar offers for this selection. Status and Priority whenever
// something is selected; Section only for a single shared project, and only
// when there is a section to pick or one to clear.
function TK_bulkSetOffer(tasks, projects) {
  var list = (Array.isArray(tasks) ? tasks : []).filter(Boolean);
  var same = TK_bulkSameProject(list);
  var sections = TK_bulkSectionChoices(list, projects);
  var anyHas = list.some(function (t) { return t.section != null && String(t.section) !== ""; });
  return {
    status: list.length > 0,
    priority: list.length > 0,
    section: same.ok && (sections.length > 0 || anyHas),
    sectionWhy: same.ok ? "" : same.why,
    sections: sections,
  };
}

// What the server will most likely do with each selected task, for the
// confirmation label. The server still decides.
// kind: complete | set_status | set_priority | set_section.
// -> { ok: [id], skipped: [{ id, reason }] }
function TK_bulkSetPlan(kind, patch, tasks, projects) {
  var out = { ok: [], skipped: [] };
  var p = patch || {};
  var list = (Array.isArray(tasks) ? tasks : []).filter(Boolean);
  var sections = kind === "set_section" ? TK_bulkSectionChoices(list, projects) : [];
  list.forEach(function (t) {
    var id = String(t.id);
    var st = TK_vStatus(t);
    var reason = "";
    if (kind === "complete") {
      if (st === "done") reason = "already_done";
    } else if (kind === "set_status") {
      if (st === "done") reason = "done_use_reopen";
      else if (st === "ready_for_review") reason = "in_review";
      else if (st === p.status) reason = "no_change";
    } else if (kind === "set_priority") {
      if ((t.priority || "normal") === p.priority) reason = "no_change";
    } else if (kind === "set_section") {
      var cur = t.section == null || t.section === "" ? null : String(t.section);
      if (p.section == null) {
        if (cur === null) reason = "no_change";
      } else if (!t.project_id) {
        reason = "no_project";
      } else {
        var want = String(p.section).trim().toLowerCase();
        var match = null;
        sections.forEach(function (x) { if (match === null && x.toLowerCase() === want) match = x; });
        if (match === null) reason = "section_missing";
        else if (cur === match) reason = "no_change";
      }
    } else {
      reason = "error";
    }
    if (reason) out.skipped.push({ id: id, reason: reason });
    else out.ok.push(id);
  });
  return out;
}

// ---- Slate view: Group by, Sort, quick chips, saved view (month rhythm slice 0) ----
// One control on the Slate page and on the Desk's Slate tab. With nothing
// chosen the list is built exactly as before (TK_slateBuildView's default
// path is TK_myGroupsView). The view is saved per person in this browser.

var TK_SLATE_GROUPS = [
  { key: "due", label: "Due date" },
  { key: "client", label: "Client" },
  { key: "part", label: "4/14/24th" },
  { key: "status", label: "Status" },
];

// Sort chips: a subset of TK_SORT_COLS, sorted inside each group.
var TK_SLATE_SORTS = [
  { col: "due", label: "Due" },
  { col: "priority", label: "Priority" },
  { col: "status", label: "Status" },
  { col: "task", label: "Name" },
];

var TK_SLATE_CHIPS = [
  { key: "mine_today", label: "Mine today" },
  { key: "waiting", label: "Waiting on client" },
  // Month rhythm E2: shown only with the rhythm on (ctx.emailTemplates set)
  { key: "emails_due", label: "Emails due", rhythm: true },
];

// The month rhythm's part labels, in rhythm order (docs/slate-month-rhythm.md).
// A later slice passes the firm's own list (tk_settings month_rhythm).
var TK_RHYTHM_PARTS_DEFAULT = ["Check in", "Send reports", "Follow up"];
var TK_SLATE_VIEW_KEY = "mgb_tk_slate_view_v1";
var TK_NO_PART_KEY = "part:__none__";

var TK_vSTATUS_LABEL_FALLBACK = {
  todo: "To do",
  in_progress: "In progress",
  waiting_client: "Waiting on client",
  ready_for_review: "Ready for review",
  done: "Done",
};

function TK_vInList(list, field, v) {
  for (var i = 0; i < list.length; i++) if (list[i][field] === v) return true;
  return false;
}

// "mgb_tk_slate_view_v1:<email>" (the Slate page) or "...:desk:<email>" (the
// Desk's Slate tab). Each place keeps its own view.
function TK_slateViewKey(email, scope) {
  return TK_SLATE_VIEW_KEY + ":" + (scope === "desk" ? "desk:" : "") + TK_vLower(email);
}

// Any value in, a valid view out: { groupBy, sort: { col, dir } | null, chip }.
function TK_normalizeSlateView(raw) {
  var r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  var groupBy = TK_vInList(TK_SLATE_GROUPS, "key", r.groupBy) ? r.groupBy : "due";
  var s = r.sort && typeof r.sort === "object" ? r.sort : null;
  var sort = s && TK_vInList(TK_SLATE_SORTS, "col", s.col) ? { col: s.col, dir: s.dir === "desc" ? "desc" : "asc" } : null;
  var chip = TK_vInList(TK_SLATE_CHIPS, "key", r.chip) ? r.chip : "";
  var out = { groupBy: groupBy, sort: sort, chip: chip };
  // Slate app P1: a saved view may carry layout "board". Only "board" is kept,
  // so a view without it (every older one) stays exactly as it was.
  if (r.layout === "board") out.layout = "board";
  return out;
}

// saved: the stored view (or null). legacyGroupBy: the old Due date | Client
// choice (mgb_tk_groupby_v1), used only when nothing new is saved.
function TK_slateViewRead(saved, legacyGroupBy) {
  if (saved && typeof saved === "object" && !Array.isArray(saved)) return TK_normalizeSlateView(saved);
  return TK_normalizeSlateView({ groupBy: legacyGroupBy === "client" ? "client" : "due" });
}

function TK_isDefaultSlateView(v) {
  var n = TK_normalizeSlateView(v);
  return n.groupBy === "due" && !n.sort && !n.chip;
}

// ---- Slate app P3: named saved views (tk_saved_views, app only) ----
// Many named views per person per scope, stored on the server. The older single
// view (this browser's localStorage) stays as the built-in "Default" entry.

var TK_SAVED_VIEW_MAX = 30;
var TK_SAVED_VIEW_NAME_MAX = 60;
var TK_SAVED_VIEW_DEFAULT_ID = "__default__";
var TK_SAVED_VIEW_DEFAULT_NAME = "Default";

var TK_VIEW_NAME_ERRORS = {
  empty: "Give the view a name.",
  too_long: "Keep the name to 60 characters or fewer.",
  reserved: "Default is the built-in view. Pick another name.",
  duplicate: "You already have a view with that name.",
  too_many: "You can keep up to 30 saved views. Delete one first.",
};

function TK_viewNameErrorText(code) {
  return Object.prototype.hasOwnProperty.call(TK_VIEW_NAME_ERRORS, code) ? TK_VIEW_NAME_ERRORS[code] : "Couldn't save that view. Try again.";
}

// Trim and collapse runs of white space, the way the server stores it.
function TK_cleanViewName(raw) {
  return (raw == null ? "" : String(raw)).replace(/\s+/g, " ").trim();
}

// existing: the saved rows ({ id, name }). exceptId: the row being renamed.
// -> { ok: true, name } or { ok: false, error, text }
function TK_validateViewName(raw, existing, exceptId) {
  var name = TK_cleanViewName(raw);
  var fail = function (code) { return { ok: false, error: code, text: TK_viewNameErrorText(code) }; };
  if (!name) return fail("empty");
  if (name.length > TK_SAVED_VIEW_NAME_MAX) return fail("too_long");
  var low = name.toLowerCase();
  if (low === TK_SAVED_VIEW_DEFAULT_NAME.toLowerCase()) return fail("reserved");
  var rows = Array.isArray(existing) ? existing : [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (!r || r.isDefault) continue;
    if (exceptId != null && String(r.id) === String(exceptId)) continue;
    if (TK_cleanViewName(r.name).toLowerCase() === low) return fail("duplicate");
  }
  return { ok: true, name: name };
}

// Saved rows only (the Default entry does not count toward the 30).
function TK_canAddSavedView(rows) {
  var n = (Array.isArray(rows) ? rows : []).filter(function (r) { return r && !r.isDefault; }).length;
  return n < TK_SAVED_VIEW_MAX;
}

function TK_nextViewPosition(rows) {
  var max = 0;
  (Array.isArray(rows) ? rows : []).forEach(function (r) {
    var p = r && typeof r.position === "number" ? r.position : parseInt(r && r.position, 10);
    if (p > max) max = p;
  });
  return max + 1;
}

// The Default entry first (the legacy view, or its baseline), then the saved
// rows by position, oldest first, then name. Every view is normalized.
// -> [{ id, name, view, isDefault, position }]
function TK_mergeSavedViews(rows, defaultView) {
  var saved = (Array.isArray(rows) ? rows : [])
    .filter(function (r) { return r && r.id != null && TK_cleanViewName(r.name); })
    .map(function (r) {
      var pos = typeof r.position === "number" ? r.position : parseInt(r.position, 10);
      return {
        id: String(r.id),
        name: TK_cleanViewName(r.name),
        view: TK_normalizeSlateView(r.view),
        isDefault: false,
        position: isNaN(pos) ? 0 : pos,
        created: r.created_at ? String(r.created_at) : "",
      };
    })
    .sort(function (a, b) {
      if (a.position !== b.position) return a.position - b.position;
      if (a.created !== b.created) return a.created < b.created ? -1 : 1;
      var an = a.name.toLowerCase();
      var bn = b.name.toLowerCase();
      if (an !== bn) return an < bn ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
  var def = { id: TK_SAVED_VIEW_DEFAULT_ID, name: TK_SAVED_VIEW_DEFAULT_NAME, view: TK_normalizeSlateView(defaultView), isDefault: true, position: 0, created: "" };
  return [def].concat(saved).map(function (e) {
    return { id: e.id, name: e.name, view: e.view, isDefault: e.isDefault, position: e.position };
  });
}

function TK_sameSlateView(a, b) {
  var x = TK_normalizeSlateView(a);
  var y = TK_normalizeSlateView(b);
  return x.groupBy === y.groupBy && x.chip === y.chip && (x.layout || "list") === (y.layout || "list") &&
    (x.sort ? x.sort.col + ":" + x.sort.dir : "") === (y.sort ? y.sort.col + ":" + y.sort.dir : "");
}

// The entry the current view matches, so the menu can mark it. A saved view
// wins over Default when both match. null when none does.
function TK_activeSavedViewId(merged, current) {
  var list = Array.isArray(merged) ? merged : [];
  var def = null;
  for (var i = 0; i < list.length; i++) {
    if (!TK_sameSlateView(list[i].view, current)) continue;
    if (list[i].isDefault) def = list[i];
    else return list[i].id;
  }
  return def ? def.id : null;
}

// The built-in "Default" entry is the person's older single view (this
// browser). That view auto-saves, so before the first named view is applied the
// app keeps a baseline copy of it under this key (never the server).
var TK_SLATE_BASE_KEY = "mgb_tk_slate_base_v1";

function TK_slateBaselineKey(email, scope) {
  return TK_SLATE_BASE_KEY + ":" + (scope === "desk" ? "desk:" : "") + TK_vLower(email);
}

// What the Default entry applies. stored: the baseline copy (or null).
// current: the live local view. rows: the saved named rows. With no baseline
// the older view is whatever is live, unless that is just a named view being
// shown (then Default is the plain default view).
function TK_resolveDefaultView(stored, current, rows) {
  if (stored && typeof stored === "object" && !Array.isArray(stored)) return TK_normalizeSlateView(stored);
  var cur = TK_normalizeSlateView(current);
  var list = Array.isArray(rows) ? rows : [];
  for (var i = 0; i < list.length; i++) {
    if (list[i] && TK_sameSlateView(list[i].view, cur)) return TK_normalizeSlateView(null);
  }
  return cur;
}

// Server error text -> a name-error code, for a friendly message.
function TK_savedViewErrorCode(err) {
  var m = String((err && (err.message || err.details || err.hint)) || err || "");
  if (m.indexOf("tk_saved_views_owner_scope_name_uq") >= 0) return "duplicate";
  if (m.indexOf("tk_too_many_views") >= 0) return "too_many";
  if (m.indexOf("tk_name_reserved") >= 0) return "reserved";
  if (m.indexOf("tk_saved_views_name_check") >= 0) return m.indexOf("character") >= 0 ? "too_long" : "empty";
  return "";
}

// ctx: { email, today }. "mine_today": assigned to me, not done, not waiting
// on the client (waiting never counts against the bookkeeper), due today or
// earlier. "waiting": status waiting_client (Ask client sets it on send).
function TK_slateChipMatch(t, chip, ctx) {
  if (!t) return false;
  if (!chip) return true;
  var st = TK_vStatus(t);
  if (chip === "waiting") return st === "waiting_client";
  if (chip === "emails_due") {
    // mine, open, a rhythm email task (template has an email_kind), due by today
    var ec = ctx || {};
    var tpls = ec.emailTemplates;
    if (!tpls || !t.template_id || !tpls[t.template_id]) return false;
    if (!TK_vLower(ec.email) || TK_vLower(t.assignee_email) !== TK_vLower(ec.email)) return false;
    if (st === "done" || st === "waiting_client") return false;
    var edue = t.due_date ? String(t.due_date).slice(0, 10) : "";
    var etoday = ec.today ? String(ec.today).slice(0, 10) : "";
    return !!edue && !!etoday && edue <= etoday;
  }
  if (chip === "mine_today") {
    var c = ctx || {};
    var me = TK_vLower(c.email);
    if (!me || TK_vLower(t.assignee_email) !== me) return false;
    if (st === "done" || st === "waiting_client") return false;
    var due = t.due_date ? String(t.due_date).slice(0, 10) : "";
    var today = c.today ? String(c.today).slice(0, 10) : "";
    if (!due || !today) return false;
    return due <= today;
  }
  return true;
}

// The same array back when no chip is on.
function TK_slateApplyChip(tasks, chip, ctx) {
  var list = Array.isArray(tasks) ? tasks : [];
  if (!chip || !TK_vInList(TK_SLATE_CHIPS, "key", chip)) return list;
  // a rhythm chip saved while the rhythm was on does nothing once it is off;
  // while the email templates are still loading (rhythm on) it shows nothing
  // rather than every task
  if (chip === "emails_due" && !(ctx && ctx.emailTemplates)) return ctx && ctx.emailsLoading ? [] : list;
  return list.filter(function (t) {
    return TK_slateChipMatch(t, chip, ctx);
  });
}

// A task's part of the month: its own section, else its template's section
// (opts.templateSectionOf(template_id) or opts.templates { id: { section } }),
// else "".
function TK_rhythmPartOf(t, opts) {
  if (!t) return "";
  var own = t.section != null ? String(t.section).trim() : "";
  if (own) return own;
  var o = opts || {};
  var tid = t.template_id != null ? String(t.template_id) : "";
  if (!tid) return "";
  var s = null;
  if (typeof o.templateSectionOf === "function") s = o.templateSectionOf(tid);
  else if (o.templates && typeof o.templates === "object" && o.templates[tid]) s = o.templates[tid].section;
  return s != null ? String(s).trim() : "";
}

// Groups by rhythm step. Order: the rhythm parts (opts.parts, default
// TK_RHYTHM_PARTS_DEFAULT) in rhythm order, then other sections
// (TK_CLIENT_SECTION_ORDER first, then A to Z), then "No part". Case-insensitive
// (one group per part). Empty groups never appear; task order inside a group
// is the input order. Returns [{ key, name, label, tasks, collapsed }].
function TK_groupByPart(tasks, opts) {
  var o = opts || {};
  var col = o.collapsed || {};
  var parts = Array.isArray(o.parts) && o.parts.length ? o.parts : TK_RHYTHM_PARTS_DEFAULT;
  var partLower = parts.map(function (p) {
    return TK_vLower(String(p == null ? "" : p).trim());
  });
  var order = typeof TK_CLIENT_SECTION_ORDER !== "undefined" && Array.isArray(TK_CLIENT_SECTION_ORDER) ? TK_CLIENT_SECTION_ORDER : TK_vCLIENT_ORDER;
  var orderLower = order.map(function (s) {
    return s.toLowerCase();
  });
  var by = {};
  var seen = [];
  (Array.isArray(tasks) ? tasks : []).forEach(function (t) {
    if (!t) return;
    var name = TK_rhythmPartOf(t, o);
    var low = name.toLowerCase();
    var key = low ? "part:" + low : TK_NO_PART_KEY;
    if (!by[key]) {
      var pi = low ? partLower.indexOf(low) : -1;
      var label = pi >= 0 ? String(parts[pi]).trim() : name || "No part";
      by[key] = { key: key, name: label, label: label, tasks: [], collapsed: Object.prototype.hasOwnProperty.call(col, key) ? !!col[key] : false, _low: low };
      seen.push(key);
    }
    by[key].tasks.push(t);
  });
  function rank(g) {
    if (!g._low) return [3, 0];
    var pi = partLower.indexOf(g._low);
    if (pi >= 0) return [0, pi];
    var si = orderLower.indexOf(g._low);
    if (si >= 0) return [1, si];
    return [2, 0];
  }
  return seen
    .map(function (k) {
      return by[k];
    })
    .sort(function (a, b) {
      var ra = rank(a);
      var rb = rank(b);
      if (ra[0] !== rb[0]) return ra[0] - rb[0];
      if (ra[1] !== rb[1]) return ra[1] - rb[1];
      return a._low < b._low ? -1 : a._low > b._low ? 1 : 0;
    })
    .map(function (g) {
      return { key: g.key, name: g.name, label: g.label, tasks: g.tasks, collapsed: g.collapsed };
    });
}

// Groups by status in workflow order. Done is folded unless opened.
function TK_groupByStatus(tasks, opts) {
  var o = opts || {};
  var col = o.collapsed || {};
  var labels = typeof TK_STATUS_LABELS !== "undefined" && TK_STATUS_LABELS ? TK_STATUS_LABELS : TK_vSTATUS_LABEL_FALLBACK;
  var by = {};
  (Array.isArray(tasks) ? tasks : []).forEach(function (t) {
    if (!t) return;
    var st = TK_vStatus(t);
    (by[st] = by[st] || []).push(t);
  });
  var out = [];
  TK_vSTATUS_ORDER.forEach(function (st) {
    if (!by[st] || !by[st].length) return;
    var key = "status:" + st;
    var label = labels[st] || TK_vSTATUS_LABEL_FALLBACK[st];
    out.push({ key: key, name: label, label: label, tasks: by[st], collapsed: Object.prototype.hasOwnProperty.call(col, key) ? !!col[key] : st === "done" });
  });
  return out;
}

// Sorts inside each group. No sort: the same groups back (same objects).
function TK_slateSortWithin(groups, sort, opts) {
  var list = Array.isArray(groups) ? groups : [];
  if (!sort || !TK_vInList(TK_SLATE_SORTS, "col", sort.col)) return list;
  return list.map(function (g) {
    if (!g || !Array.isArray(g.tasks)) return g;
    var out = {};
    for (var k in g) if (Object.prototype.hasOwnProperty.call(g, k)) out[k] = g[k];
    out.tasks = TK_sortTasks(g.tasks, sort, opts);
    return out;
  });
}

// groups: TK_groupMyTasks output. view: a saved view. ctx: { collapsed,
// showDone, email, today, clients, flagOf, parts, templates,
// templateSectionOf, nameOf, skipUnassigned }.
// Returns { groups, byDue }. With the default view this is exactly
// TK_myGroupsView(groups, { collapsed, showDone }); Client with no chip and
// no sort is exactly the old client path.
function TK_slateBuildView(groups, view, ctx) {
  var v = TK_normalizeSlateView(view);
  var c = ctx || {};
  var g = groups || {};
  var collapsed = c.collapsed || {};
  if (v.chip) {
    var fg = {};
    for (var k in g) {
      if (!Object.prototype.hasOwnProperty.call(g, k)) continue;
      fg[k] = Array.isArray(g[k]) ? TK_slateApplyChip(g[k], v.chip, c) : g[k];
    }
    g = fg;
  }
  if (c.skipUnassigned && g.unassigned) {
    var sg = {};
    for (var k2 in g) if (Object.prototype.hasOwnProperty.call(g, k2) && k2 !== "unassigned") sg[k2] = g[k2];
    g = sg;
  }
  var out;
  if (v.groupBy === "due") {
    out = TK_myGroupsView(g, { collapsed: collapsed, showDone: c.showDone });
  } else {
    var flat = TK_flattenMyGroups(g, { showDone: c.showDone });
    if (v.groupBy === "client") out = TK_groupByClient(flat, { clients: c.clients || [], collapsed: collapsed, flagOf: c.flagOf });
    else if (v.groupBy === "part") out = TK_groupByPart(flat, { collapsed: collapsed, parts: c.parts, templates: c.templates, templateSectionOf: c.templateSectionOf });
    else out = TK_groupByStatus(flat, { collapsed: collapsed });
  }
  return { groups: TK_slateSortWithin(out, v.sort, { nameOf: c.nameOf }), byDue: v.groupBy === "due" };
}

// ---- Slate app (preview; spec-desk-fullpage.md sections 3.3 to 3.5, 4) --------------
// Nothing here runs unless TK_slateAppIsOn is true; S1 only adds the pure rules.

var TK_SLATE_APP_PREVIEW = "mgb_slate_app_preview"; // localStorage "1": this browser only
var TK_SLATE_APP_CLASSIC = "mgb_slate_classic"; // localStorage "1": opt out, wins over everything (added at launch)
var TK_SLATE_APP_SETTING = "slate_app_enabled"; // tk_settings key: the firm switch, owner-only, code never writes it

// Same reading rule as WB_flagValueOn: true, "true", 1 or {on:true}. The
// string "on" is NOT on, and neither is "1" (a setting value, unlike the
// localStorage preview string below).
function TK_slateFlagValueOn(v) {
  return v === true || v === "true" || v === 1 || (!!v && typeof v === "object" && v.on === true);
}

// Three layers, one helper. setting: the tk_settings.slate_app_enabled value;
// preview: the localStorage mgb_slate_app_preview value ("1" or true counts);
// classic: the mgb_slate_classic opt-out; counts only when "1" or true.
// Classic wins, then the person's preview or the firm switch turns it on.
function TK_slateAppIsOn(setting, preview, classic) {
  if (classic === "1" || classic === true) return false;
  if (preview === "1" || preview === true) return true;
  return TK_slateFlagValueOn(setting);
}

// Size modes. Entering a mode uses the first set of numbers; once in a mode
// the window stays there until it crosses the (smaller) leave number, so a
// drag that hovers on an edge does not flicker. Tune after S0.
var TK_SLATE_MODES = ["sliver", "compact", "regular", "full"];
var TK_SLATE_EDGES = {
  sliverW: 300, // w < 300 is a sliver (a column)
  sliverH: 200, // h < 200 is a sliver (a strip)
  sliverLeaveW: 316, // a sliver stays one until w >= 316 ...
  sliverLeaveH: 216, // ... and h >= 216
  regular: 720, // regular from 720
  regularLeave: 704, // regular (or full on the way down) holds down to 704
  full: 1100, // full from 1100
  fullLeave: 1084, // full holds down to 1084
};

// TK_slateMode(w, h, prev) -> { mode, shape }
//   mode   "sliver" | "compact" | "regular" | "full"
//   shape  for a sliver only: "strip" (h < 200, the one-line bar) or "column"
//          (w < 300 and h >= 200); null in every other mode.
// w, h: the app window's inner width and height in CSS px. prev: the mode last
// returned (the string, or the whole { mode, shape } object), or nothing; it only
// adds hysteresis. With the whole object, a column sliver that shrinks in
// height stays a column until h < 200. Bad input (0, negative, NaN, undefined, strings that are not
// numbers) gives { mode: "compact", shape: null }, so a missing observer
// reading never collapses the app. While a sliver holds in the 200 to 215 band,
// the shape stays "strip" (h < 216) unless prev said "column", else "column".
function TK_slateMode(w, h, prev) {
  var E = TK_SLATE_EDGES;
  var W = typeof w === "number" ? w : NaN;
  var H = typeof h === "number" ? h : NaN;
  if (!isFinite(W) || !isFinite(H) || W <= 0 || H <= 0) return { mode: "compact", shape: null };
  var p = prev && typeof prev === "object" ? prev.mode : prev;
  if (TK_SLATE_MODES.indexOf(p) < 0) p = null;
  var wasSliver = p === "sliver";
  var sliver = wasSliver ? !(W >= E.sliverLeaveW && H >= E.sliverLeaveH) : W < E.sliverW || H < E.sliverH;
  if (sliver) {
    var wasColumn = wasSliver && prev && typeof prev === "object" && prev.shape === "column";
    var strip = H < (wasSliver && !wasColumn ? E.sliverLeaveH : E.sliverH);
    return { mode: "sliver", shape: strip ? "strip" : "column" };
  }
  var m = W >= E.full ? "full" : W >= E.regular ? "regular" : "compact";
  if (p === "full" && W >= E.fullLeave) m = "full";
  else if ((p === "full" || p === "regular") && m === "compact" && W >= E.regularLeave) m = "regular";
  return { mode: m, shape: null };
}

// The sliver's task. tasks: task rows (any list); me: the signed-in email (case
// ignored); today: "YYYY-MM-DD", accepted for the caller's convenience (the
// order below already puts late, then due today, ahead of later dates).
// Mine = assignee_email is me. Only todo and in_progress tasks count: done,
// waiting_client, ready_for_review and deleted ones are skipped.
//   1. The newest of my in_progress tasks, by status_changed_at (when it was
//      started), falling back to updated_at.
//   2. Else the first of my todo tasks in My tasks order: due date soonest
//      first (so late, then today), no due date last, then priority
//      (high, normal, low), then due time, created time and id (TK_compareTasks).
//   3. Else null.
function TK_slateCurrent(tasks, me, today) {
  var who = TK_vLower(me);
  if (!who || !Array.isArray(tasks)) return null;
  var started = null;
  var next = null;
  for (var i = 0; i < tasks.length; i++) {
    var t = tasks[i];
    if (!t || t.deleted_at || TK_vLower(t.assignee_email) !== who) continue;
    var st = TK_vStatus(t);
    if (st === "in_progress") {
      if (!started || TK_slateNewer(t, started)) started = t;
    } else if (st === "todo") {
      if (!next || TK_vCompare(t, next) < 0) next = t;
    }
  }
  return started || next || null;
}

// true when a was started or touched later than b (status_changed_at, else
// updated_at; a tie keeps the smaller id so the answer never flips).
function TK_slateNewer(a, b) {
  var sa = a.status_changed_at || a.updated_at || "";
  var sb = b.status_changed_at || b.updated_at || "";
  var ma = Date.parse(sa);
  var mb = Date.parse(sb);
  if (isFinite(ma) && isFinite(mb) && ma !== mb) return ma > mb;
  if (sa !== sb) return String(sa) > String(sb);
  return String(a.id) < String(b.id);
}

// Window size presets. id: "sliver", "list" or "full". screen: { availWidth,
// availHeight, availLeft, availTop } (window.screen). chrome: { w, h }, the
// window's outer size minus its inner size (0 x 123 in a Chrome popup, measured
// in S0), optional, default 0 x 0. resizeTo sets the OUTER size, so the result
// is ready to pass to resizeTo:
//   { id, w, h, x, y, innerW, innerH } or null for an unknown id.
//   sliver (360x140) and list (440x800) name the INNER content size wanted. w and
//     h are that plus chrome, clamped to availWidth and availHeight when the
//     screen is known. innerW and innerH are the target the caller checks a frame
//     after the resize (window.innerWidth/innerHeight, give or take 4px); after a
//     clamp they are w and h minus chrome. x and y are null (leave the window).
//   full: the available screen as an OUTER size (chrome is not added): w x h =
//     availWidth x availHeight at x y = availLeft, availTop (0 when missing);
//     innerW and innerH are that minus chrome. With no usable availWidth and
//     availHeight (junk screen) it is null: a Full page cannot be sized blind.
//   With a junk screen, sliver and list are not clamped.
//   A junk chrome (not a finite number >= 0) counts as 0 in that direction.
var TK_SLATE_PRESETS = {
  sliver: { w: 360, h: 140 },
  list: { w: 440, h: 800 },
};
function TK_slateSizePreset(id, screen, chrome) {
  var key = typeof id === "string" ? id : "";
  if (key !== "full" && !Object.prototype.hasOwnProperty.call(TK_SLATE_PRESETS, key)) return null;
  var sw = screen ? TK_vNum(screen.availWidth) : null;
  var sh = screen ? TK_vNum(screen.availHeight) : null;
  var known = sw != null && sw > 0 && sh != null && sh > 0;
  var cw = chrome ? TK_vNum(chrome.w) : null;
  var ch = chrome ? TK_vNum(chrome.h) : null;
  cw = cw != null && cw > 0 ? cw : 0;
  ch = ch != null && ch > 0 ? ch : 0;
  var w;
  var h;
  var x = null;
  var y = null;
  if (key === "full") {
    if (!known) return null;
    var l = screen ? TK_vNum(screen.availLeft) : null;
    var tp = screen ? TK_vNum(screen.availTop) : null;
    w = sw;
    h = sh;
    x = l == null ? 0 : l;
    y = tp == null ? 0 : tp;
  } else {
    var p = TK_SLATE_PRESETS[key];
    w = p.w + cw;
    h = p.h + ch;
    if (known) {
      w = Math.min(w, sw);
      h = Math.min(h, sh);
    }
  }
  return { id: key, w: w, h: h, x: x, y: y, innerW: Math.max(0, w - cw), innerH: Math.max(0, h - ch) };
}

// Address of a place inside the Slate app: "/slate#/tasks/...". route is a
// view name ("my", "search", "review", "templates", "waiting", "manage") or an
// object { view, clientId?, projectId?, staffId?, taskId? } with the views the
// portal's TK_parseRoute knows: my, search, review, templates, waiting,
// manage, client (clientId), project (projectId, a uuid), person (staffId, a
// uuid). view "task" (or taskId on any view) adds the task link the portal
// already uses, ?item=task:<uuid>; with no other view it opens on My tasks.
// Anything else (unknown view, bad or missing id, an "@" in a client id)
// returns null, so an email can never reach a URL.
var TK_vUUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var TK_SLATE_DEEP_VIEWS = ["my", "search", "review", "templates", "waiting", "manage"];
function TK_slateDeepHref(route) {
  var r = typeof route === "string" ? { view: route } : route;
  if (!r || typeof r !== "object") return null;
  var view = typeof r.view === "string" ? r.view.toLowerCase() : "";
  var hasTask = r.taskId != null && r.taskId !== "";
  if (hasTask && !(typeof r.taskId === "string" && TK_vUUID_RE.test(r.taskId))) return null;
  var path;
  if (view === "task") {
    if (!hasTask) return null;
    path = "my";
  } else if (TK_SLATE_DEEP_VIEWS.indexOf(view) >= 0) {
    path = view;
  } else if (view === "client") {
    var c = r.clientId == null ? "" : String(r.clientId);
    if (!/^[\w.-]{1,120}$/.test(c) || /^\.+$/.test(c)) return null;
    path = "c/" + encodeURIComponent(c);
  } else if (view === "project") {
    if (typeof r.projectId !== "string" || !TK_vUUID_RE.test(r.projectId)) return null;
    path = "p/" + r.projectId;
  } else if (view === "person") {
    if (typeof r.staffId !== "string" || !TK_vUUID_RE.test(r.staffId)) return null;
    path = "u/" + r.staffId;
  } else {
    return null;
  }
  return "/slate#/tasks/" + path + (hasTask ? "?item=task:" + r.taskId : "");
}

// ---- Slate app bridge (S2; TK_SlateBridge.jsx uses these) ----------------------
// Ported from the retired MGB Desk window (WB_deskForwardOk, WB_deskDockPick,
// WB_deskLaunchItems). Pure, so the channel code stays thin.
var TK_SLATE_APP_NAME = "MGB Slate";
var TK_SLATE_CHANNEL = "mgb-slate"; // BroadcastChannel between the app and portal windows
var TK_SLATE_INSTALLED_KEY = "mgb_slate_installed_v1"; // set by index.html on appinstalled

// A hash the Slate app may ask a portal to show: "#/..." with a short, plain
// set of characters (encodeURIComponent output, which keeps ' too, plus "?",
// "=", "&", ":"). No "//", nothing over 300 characters.
function TK_slateForwardOk(hash) {
  if (typeof hash !== "string" || hash.length > 300) return false;
  return /^#\/[A-Za-z0-9/_\-?=&.%:~!*()']*$/.test(hash) && hash.indexOf("//") < 0;
}

// Which portal answers a forwarded link or Dock in portal. replies = [{from,
// focusedAt, visible}]: a visible portal first, then the latest focus.
function TK_slateDockPick(replies) {
  var best = null;
  (Array.isArray(replies) ? replies : []).forEach(function (r) {
    if (!r || !r.from) return;
    var at = Number(r.focusedAt) || 0;
    if (!best || (!!r.visible && !best.visible) || (!!r.visible === !!best.visible && at > best.at)) best = { from: r.from, visible: !!r.visible, at: at };
  });
  return best ? best.from : null;
}

// "#/tasks" and "#/tasks/..." stay inside the Slate app; every other hash is a
// portal place. Same rule as the index.html shell script (^#/tasks(/|$)), so
// the address the app opens is never rewritten on load.
function TK_slateIsTasksHash(hash) {
  return typeof hash === "string" && /^#\/tasks(\/|$)/.test(hash);
}

// The only hashes Dock in portal may move a portal window to (the same rule
// as TK_startDockReceiver): up to three path parts and one ?item=kind:id.
function TK_slateDockHashOk(hash) {
  return typeof hash === "string" && /^#\/tasks(\/[A-Za-z0-9%._~-]+){0,3}(\?item=[a-z]+:[A-Za-z0-9%._~-]+)?$/.test(hash);
}

// The address "Open Slate app" opens: "/slate" plus the current Tasks route
// when it is a plain Tasks hash, otherwise "/slate#/tasks/my".
function TK_slateAppUrl(hash) {
  return "/slate" + (TK_slateIsTasksHash(hash) && TK_slateForwardOk(hash) ? hash : "#/tasks/my");
}

// The launch buttons beside the Slate page header and the Desk's Slate tab.
// o: { installed, canInstall, mobile }. Phones get none. Installed: one
// "Open Slate app" (id open-app: the "open it from your Dock" dialog). Not
// installed: "Open Slate app" (id open: the popup) plus "Install Slate app"
// (id install) when the browser can install apps at all.
function TK_slateLaunchItems(o) {
  var x = o || {};
  if (x.mobile) return [];
  if (x.installed) return [{ id: "open-app", label: "Open Slate app" }];
  var out = [{ id: "open", label: "Open Slate app" }];
  if (x.canInstall) out.push({ id: "install", label: "Install Slate app" });
  return out;
}

// ---- Slate app: what each size mode shows (S3, spec 3.3) ------------------------
// Only the Slate app (TK_slateInApp) uses these; the portal page keeps
// TK_shellLayout.

// Who owns the open task (TK_store drawerId) in a mode: "pane" (full: the
// detail pane beside the list), "drawer" (compact and regular: today's right
// drawer, which covers the window in compact) or "none" (sliver: nothing
// shows it; the id is kept, so growing the window shows it again). Anything
// else (no mode yet) is "drawer", the old behavior.
function TK_slateTaskHost(mode) {
  if (mode === "full") return "pane";
  if (mode === "sliver") return "none";
  return "drawer";
}

// The layout for a mode. touch: a touch-primary pointer (TK_isTouchPrimary).
//   rail       TK_Sidebar as a rail (regular 220px, full 240px; railW)
//   bottomBar  the bottom bar (compact on a touch screen only)
//   compact    the phone-style list (sliver and compact)
//   canEdit    Templates, Manage, Sections and bulk are editable
//   pane       the detail pane column (full only)
//   list       the list shows at all (false in a sliver: S4 fills the slot)
// Bad modes fall back to compact.
function TK_slateLayout(mode, touch) {
  var m = TK_SLATE_MODES.indexOf(mode) >= 0 ? mode : "compact";
  var wide = m === "regular" || m === "full";
  return {
    mode: m,
    rail: wide,
    railW: m === "full" ? 240 : m === "regular" ? 220 : 0,
    bottomBar: m === "compact" && !!touch,
    compact: !wide,
    canEdit: wide,
    pane: m === "full",
    list: m !== "sliver",
  };
}

// The classes for .tk-app.is-shell: "tk-m-<mode>", plus "tk-shape-<shape>"
// for a sliver. Bad input gives "tk-m-compact".
function TK_slateModeClasses(m) {
  var mode = m && TK_SLATE_MODES.indexOf(m.mode) >= 0 ? m.mode : "compact";
  var out = "tk-m-" + mode;
  if (mode === "sliver" && (m.shape === "strip" || m.shape === "column")) out += " tk-shape-" + m.shape;
  return out;
}

// Size presets only where resizeTo can work: a popup (it has an opener or is
// named "mgb-tasks", the TK_popOut window name) or the installed app
// (display-mode standalone). o: { hasOpener, standalone, name }.
function TK_slatePresetsAllowed(o) {
  var x = o || {};
  return !!x.hasOpener || !!x.standalone || x.name === "mgb-tasks";
}

// Did a preset land? want: TK_slateSizePreset's result ({ innerW, innerH });
// got: { w, h } (window.innerWidth, innerHeight) a frame later. Within tol
// (default 4px) both ways. Bad input is a miss.
function TK_slateSizeHit(want, got, tol) {
  var t = typeof tol === "number" && isFinite(tol) && tol >= 0 ? tol : 4;
  if (!want || !got) return false;
  var vals = [want.innerW, want.innerH, got.w, got.h];
  for (var i = 0; i < vals.length; i++) {
    if (typeof vals[i] !== "number" || !isFinite(vals[i])) return false;
  }
  return Math.abs(got.w - want.innerW) <= t && Math.abs(got.h - want.innerH) <= t;
}

// The size preset buttons in the bar: in regular and full (the menu holds
// them in compact). Never in a sliver.
function TK_slatePresetPlace(mode) {
  if (mode === "regular" || mode === "full") return "bar";
  if (mode === "compact") return "menu";
  return "none";
}

// ---- Slate app: the sliver (S4, spec 3.4) ---------------------------------------
// TK_SlateSliver.jsx uses these; only the Slate app shows a sliver.

// What fits in the sliver. shape: "strip" | "column"; w, h: the slot's content
// width and height in CSS px (h = the window's inner height below the slot's
// top). Returns { size, due, client, rest, lines }:
//   size    "xs" (h < 28: 18 to 27px tall buttons), "sm" (h < 44) or "md"
//   due     the due label fits (strip: h >= 24 and w >= 300)
//   client  the client name fits (strip: h >= 32 and w >= 420)
//   rest    the "+N" count fits (strip: h >= 24 and w >= 260)
//   lines   title lines (strip 1, column 3, or 2 when the column is short)
// Column: everything shows; below 120px of height the title takes 2 lines.
// Bad numbers count as 0 (the smallest strip: title, Start, Done, Expand).
function TK_slateSliverFit(shape, w, h) {
  var W = typeof w === "number" && isFinite(w) && w > 0 ? w : 0;
  var H = typeof h === "number" && isFinite(h) && h > 0 ? h : 0;
  if (shape === "column") {
    return { size: "md", due: true, client: true, rest: true, lines: H > 0 && H < 120 ? 2 : 3 };
  }
  return {
    size: H < 28 ? "xs" : H < 44 ? "sm" : "md",
    due: H >= 24 && W >= 300,
    client: H >= 32 && W >= 420,
    rest: H >= 24 && W >= 260,
    lines: 1,
  };
}

// The sliver's task, leaving out skip (ids, an array or a single id): the
// task just marked Done stays out while its Undo is up, even before the store
// has its new status. Otherwise exactly TK_slateCurrent.
function TK_slateSliverPick(tasks, me, today, skip) {
  if (!Array.isArray(tasks)) return null;
  var out = skip == null ? [] : Array.isArray(skip) ? skip : [skip];
  if (!out.length) return TK_slateCurrent(tasks, me, today);
  var drop = {};
  out.forEach(function (id) {
    if (id != null) drop[String(id)] = 1;
  });
  return TK_slateCurrent(
    tasks.filter(function (t) {
      return !(t && drop[String(t.id)]);
    }),
    me,
    today,
  );
}

// "+N": the rest of today. My open tasks (todo or in_progress, assignee me,
// not deleted) due today or late, not counting currentId and the skip ids.
// today: "YYYY-MM-DD"; without it the answer is 0.
function TK_slateSliverRest(tasks, me, today, currentId, skip) {
  var who = TK_vLower(me);
  var day = typeof today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(today) ? today : "";
  if (!who || !day || !Array.isArray(tasks)) return 0;
  var drop = {};
  if (currentId != null) drop[String(currentId)] = 1;
  (Array.isArray(skip) ? skip : skip == null ? [] : [skip]).forEach(function (id) {
    if (id != null) drop[String(id)] = 1;
  });
  var seen = {};
  var n = 0;
  for (var i = 0; i < tasks.length; i++) {
    var t = tasks[i];
    if (!t || t.deleted_at || t.id == null || drop[String(t.id)] || seen[String(t.id)]) continue;
    if (TK_vLower(t.assignee_email) !== who) continue;
    var st = TK_vStatus(t);
    if (st !== "todo" && st !== "in_progress") continue;
    var due = typeof t.due_date === "string" ? t.due_date.slice(0, 10) : "";
    if (!due || due > day) continue;
    seen[String(t.id)] = 1;
    n++;
  }
  return n;
}

// The sliver's keys: s Start, x Done, Enter open / expand. e: a keydown
// event (or { key, ctrlKey, metaKey, altKey, shiftKey }). Any modifier,
// repeat, or another key gives null.
function TK_slateSliverKey(e) {
  if (!e || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.repeat) return null;
  if (e.key === "s") return "start";
  if (e.key === "x") return "done";
  if (e.key === "Enter") return "expand";
  return null;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    TK_SLATE_APP_NAME: TK_SLATE_APP_NAME,
    TK_SLATE_CHANNEL: TK_SLATE_CHANNEL,
    TK_SLATE_INSTALLED_KEY: TK_SLATE_INSTALLED_KEY,
    TK_slateForwardOk: TK_slateForwardOk,
    TK_slateDockPick: TK_slateDockPick,
    TK_slateIsTasksHash: TK_slateIsTasksHash,
    TK_slateDockHashOk: TK_slateDockHashOk,
    TK_slateAppUrl: TK_slateAppUrl,
    TK_slateLaunchItems: TK_slateLaunchItems,
    TK_slateTaskHost: TK_slateTaskHost,
    TK_slateLayout: TK_slateLayout,
    TK_slateModeClasses: TK_slateModeClasses,
    TK_slatePresetsAllowed: TK_slatePresetsAllowed,
    TK_slateSizeHit: TK_slateSizeHit,
    TK_slatePresetPlace: TK_slatePresetPlace,
    TK_slateSliverFit: TK_slateSliverFit,
    TK_slateSliverPick: TK_slateSliverPick,
    TK_slateSliverRest: TK_slateSliverRest,
    TK_slateSliverKey: TK_slateSliverKey,
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
    TK_selOnList: TK_selOnList,
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
    TK_BULK_STATUS_CHOICES: TK_BULK_STATUS_CHOICES,
    TK_BULK_PRIORITY_CHOICES: TK_BULK_PRIORITY_CHOICES,
    TK_bulkStatusRoute: TK_bulkStatusRoute,
    TK_bulkPriorityRoute: TK_bulkPriorityRoute,
    TK_bulkSectionRoute: TK_bulkSectionRoute,
    TK_bulkSameProject: TK_bulkSameProject,
    TK_bulkSectionChoices: TK_bulkSectionChoices,
    TK_bulkSetOffer: TK_bulkSetOffer,
    TK_bulkSetPlan: TK_bulkSetPlan,
    TK_SAVED_VIEW_MAX: TK_SAVED_VIEW_MAX,
    TK_SAVED_VIEW_NAME_MAX: TK_SAVED_VIEW_NAME_MAX,
    TK_SAVED_VIEW_DEFAULT_ID: TK_SAVED_VIEW_DEFAULT_ID,
    TK_VIEW_NAME_ERRORS: TK_VIEW_NAME_ERRORS,
    TK_viewNameErrorText: TK_viewNameErrorText,
    TK_cleanViewName: TK_cleanViewName,
    TK_validateViewName: TK_validateViewName,
    TK_canAddSavedView: TK_canAddSavedView,
    TK_nextViewPosition: TK_nextViewPosition,
    TK_mergeSavedViews: TK_mergeSavedViews,
    TK_sameSlateView: TK_sameSlateView,
    TK_activeSavedViewId: TK_activeSavedViewId,
    TK_savedViewErrorCode: TK_savedViewErrorCode,
    TK_SLATE_BASE_KEY: TK_SLATE_BASE_KEY,
    TK_slateBaselineKey: TK_slateBaselineKey,
    TK_resolveDefaultView: TK_resolveDefaultView,
    TK_SLATE_GROUPS: TK_SLATE_GROUPS,
    TK_SLATE_SORTS: TK_SLATE_SORTS,
    TK_SLATE_CHIPS: TK_SLATE_CHIPS,
    TK_RHYTHM_PARTS_DEFAULT: TK_RHYTHM_PARTS_DEFAULT,
    TK_SLATE_VIEW_KEY: TK_SLATE_VIEW_KEY,
    TK_NO_PART_KEY: TK_NO_PART_KEY,
    TK_slateViewKey: TK_slateViewKey,
    TK_normalizeSlateView: TK_normalizeSlateView,
    TK_slateViewRead: TK_slateViewRead,
    TK_isDefaultSlateView: TK_isDefaultSlateView,
    TK_slateChipMatch: TK_slateChipMatch,
    TK_slateApplyChip: TK_slateApplyChip,
    TK_rhythmPartOf: TK_rhythmPartOf,
    TK_groupByPart: TK_groupByPart,
    TK_groupByStatus: TK_groupByStatus,
    TK_slateSortWithin: TK_slateSortWithin,
    TK_slateBuildView: TK_slateBuildView,
    TK_POPOUT_MIN_APP: TK_POPOUT_MIN_APP,
    TK_SLATE_APP_PREVIEW: TK_SLATE_APP_PREVIEW,
    TK_SLATE_APP_CLASSIC: TK_SLATE_APP_CLASSIC,
    TK_SLATE_APP_SETTING: TK_SLATE_APP_SETTING,
    TK_slateFlagValueOn: TK_slateFlagValueOn,
    TK_slateAppIsOn: TK_slateAppIsOn,
    TK_SLATE_MODES: TK_SLATE_MODES,
    TK_SLATE_EDGES: TK_SLATE_EDGES,
    TK_slateMode: TK_slateMode,
    TK_slateCurrent: TK_slateCurrent,
    TK_SLATE_PRESETS: TK_SLATE_PRESETS,
    TK_slateSizePreset: TK_slateSizePreset,
    TK_slateDeepHref: TK_slateDeepHref,
  };
}

// ---- Slate app P2: manual order (drag reorder) -------------------------------
// Kept in its own block (other slices edit this file). Pure helpers only; the
// drag and key wiring lives in TK_Drag.jsx. The server twin is
// tk_manual_reorder in supabase/tasks-slate-p2-fixes.sql: TK_manualKeyBetween
// and TK_manualRenormKeys must give the same numbers it does.
//
// Manual order is PER PERSON: the keys live in tk_manual_order (owner, scope,
// task) and reach these helpers as a keys map { taskId: key }. They never
// read or write the shared staff_reminders.sort_key, so a previewer's drag
// never changes anyone's portal order.
var TK_MANUAL_STEP = 1024;
var TK_MANUAL_MIN_GAP = 0.000001;
var TK_MANUAL_PREF_KEY = "mgb_tk_manual_v1";
var TK_MANUAL_KINDS = ["my", "project", "client", "person"];
var TK_MANUAL_SCOPE_RE = /^(my|list:(project|client|person):[A-Za-z0-9_.@+-]{1,120})$/;

// The tk_manual_order scope for a view: "my" or "list:<listKey>"; null when
// the key would not pass the server check.
function TK_manualScopeFor(kind, listKey) {
  var s = kind === "my" ? "my" : listKey ? "list:" + listKey : "";
  return TK_MANUAL_SCOPE_RE.test(s) ? s : null;
}

// t's key in keys ({ taskId: key }), or null. The task's own sort_key is
// ignored on purpose.
function TK_manualKeyOf(t, keys) {
  if (!t || t.id == null || !keys || typeof keys !== "object") return null;
  if (!Object.prototype.hasOwnProperty.call(keys, t.id)) return null;
  var v = keys[t.id];
  if (v == null || v === "") return null;
  var n = Number(v);
  return isFinite(n) ? n : null;
}

// The key for a row dropped between before and after (tasks or null).
// null = no room: renumber the group.
function TK_manualKeyBetween(before, after, keys) {
  var ka = TK_manualKeyOf(after, keys);
  if (!before) return after && ka != null ? ka - TK_MANUAL_STEP : TK_MANUAL_STEP;
  var kb = TK_manualKeyOf(before, keys);
  if (kb == null) return null;
  if (!after || ka == null) return kb + TK_MANUAL_STEP;
  if (kb < ka && ka - kb > TK_MANUAL_MIN_GAP) return (kb + ka) / 2;
  return null;
}

function TK_manualNeedsRenorm(before, after, keys) {
  return TK_manualKeyBetween(before, after, keys) == null;
}

// The renumber the server does: order = the group's tasks after the move.
// Rows from the top through the moved row, and through the last row that
// already has a key, get 1024, 2048, ... Returns { key, rows: {id: key} }
// where rows holds only the other rows whose key changes.
function TK_manualRenormKeys(order, movedId, keys) {
  var list = Array.isArray(order) ? order : [];
  var pos = -1;
  var cut = -1;
  list.forEach(function (t, i) {
    if (!t) return;
    if (t.id === movedId) pos = i;
    else if (TK_manualKeyOf(t, keys) != null) cut = i;
  });
  cut = Math.max(cut, pos);
  var out = { key: pos >= 0 ? TK_MANUAL_STEP * (pos + 1) : null, rows: {} };
  for (var i = 0; i <= cut; i++) {
    var t = list[i];
    if (!t || t.id === movedId) continue;
    var k = TK_MANUAL_STEP * (i + 1);
    if (TK_manualKeyOf(t, keys) !== k) out.rows[t.id] = k;
  }
  return out;
}

// A new keys map with a move's patches applied (the moved row's key and any
// renumbered rows). keys itself is not changed.
function TK_manualApply(keys, id, patches) {
  var out = {};
  var src = keys && typeof keys === "object" ? keys : {};
  for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k)) out[k] = src[k];
  if (!patches) return out;
  var rows = patches.rows || {};
  for (var r in rows) if (Object.prototype.hasOwnProperty.call(rows, r)) out[r] = rows[r];
  if (id != null && patches.key != null) out[id] = patches.key;
  return out;
}

// tk_manual_order rows [{ task_id, sort_key }] as a keys map.
function TK_manualKeysFromRows(rows) {
  var out = {};
  (Array.isArray(rows) ? rows : []).forEach(function (r) {
    if (!r || r.task_id == null || r.sort_key == null) return;
    var n = Number(r.sort_key);
    if (isFinite(n)) out[String(r.task_id)] = n;
  });
  return out;
}

// Can this view be put in manual order? o: { inApp, mode, kind, sort,
// readOnly, search }. App only, regular or full width, no other sort, not
// read-only, no search.
function TK_manualOrderAllowed(o) {
  o = o || {};
  if (!o.inApp) return false;
  if (o.mode !== "regular" && o.mode !== "full") return false;
  if (TK_MANUAL_KINDS.indexOf(o.kind) < 0) return false;
  if (o.sort && o.sort.col) return false;
  if (o.readOnly) return false;
  if (o.search && String(o.search).trim()) return false;
  return true;
}

// Only a project list may drop a row into another group (its sections).
function TK_manualCrossGroup(kind) {
  return kind === "project";
}

// groups: [{ key, label, tasks }] as shown (top-level rows, in order).
// Drop row id into group groupKey at gap index (0 = top, n = bottom, counted
// over the rows as shown, the moved row included). Returns a plan or null
// when nothing would change:
//   { id, fromKey, groupKey, index, before, after, order, crossGroup }
// index is the row's position in the group after the move; order is the
// group's tasks after the move.
function TK_manualDropPlan(groups, id, groupKey, index, opts) {
  var gs = Array.isArray(groups) ? groups : [];
  var from = null;
  var fromIdx = -1;
  var to = null;
  gs.forEach(function (g) {
    var ts = (g && g.tasks) || [];
    for (var i = 0; i < ts.length; i++) {
      if (ts[i] && ts[i].id === id) { from = g; fromIdx = i; }
    }
    if (g && g.key === groupKey) to = g;
  });
  if (!from || !to) return null;
  var cross = from !== to;
  if (cross && !(opts && opts.crossGroup)) return null;
  var moved = from.tasks[fromIdx];
  var rest = (to.tasks || []).filter(function (t) { return t && t.id !== id; });
  var at = Math.max(0, Math.min(Number(index) || 0, (to.tasks || []).length));
  if (!cross && fromIdx < at) at -= 1;
  at = Math.max(0, Math.min(at, rest.length));
  if (!cross && at === fromIdx) return null;
  var order = rest.slice(0, at).concat([moved], rest.slice(at));
  return {
    id: id,
    fromKey: from.key,
    groupKey: to.key,
    index: at,
    before: at > 0 ? rest[at - 1] : null,
    after: at < rest.length ? rest[at] : null,
    order: order,
    crossGroup: cross,
  };
}

// Alt+Up (dir -1) / Alt+Down (dir 1) on row id: one step within its group;
// at a group edge, into the next or previous non-collapsed group when
// opts.crossGroup. null when it cannot move.
function TK_manualKeyTarget(groups, id, dir, opts) {
  var gs = (Array.isArray(groups) ? groups : []).filter(function (g) { return g && !g.collapsed; });
  var gi = -1;
  var i = -1;
  gs.forEach(function (g, gx) {
    (g.tasks || []).forEach(function (t, tx) {
      if (t && t.id === id) { gi = gx; i = tx; }
    });
  });
  if (gi < 0 || (dir !== 1 && dir !== -1)) return null;
  var g = gs[gi];
  var n = (g.tasks || []).length;
  if (dir < 0 && i > 0) return TK_manualDropPlan(gs, id, g.key, i - 1, opts);
  if (dir > 0 && i < n - 1) return TK_manualDropPlan(gs, id, g.key, i + 2, opts);
  if (!(opts && opts.crossGroup)) return null;
  var ng = gs[gi + dir];
  if (!ng) return null;
  return TK_manualDropPlan(gs, id, ng.key, dir < 0 ? (ng.tasks || []).length : 0, opts);
}

// What the store should change for a plan: { key, rows: {id: key}, renorm }.
// rows holds the other renumbered rows (empty when the key fits).
function TK_manualPatches(plan, keys) {
  if (!plan) return null;
  var k = TK_manualKeyBetween(plan.before, plan.after, keys);
  if (k != null) return { key: k, rows: {}, renorm: false };
  var r = TK_manualRenormKeys(plan.order, plan.id, keys);
  return { key: r.key, rows: r.rows, renorm: true };
}

// Each group's tasks in the person's manual order: rows with a key first (low
// to high), then the rest in the order they came in (stable).
function TK_manualSortGroups(groups, keys) {
  return (Array.isArray(groups) ? groups : []).map(function (g) {
    if (!g || !Array.isArray(g.tasks)) return g;
    var out = {};
    for (var k in g) if (Object.prototype.hasOwnProperty.call(g, k)) out[k] = g[k];
    out.tasks = g.tasks
      .map(function (t, i) {
        return { t: t, i: i, k: TK_manualKeyOf(t, keys) };
      })
      .sort(function (a, b) {
        if (a.k != null && b.k != null && a.k !== b.k) return a.k - b.k;
        if ((a.k == null) !== (b.k == null)) return a.k == null ? 1 : -1;
        return a.i - b.i;
      })
      .map(function (x) {
        return x.t;
      });
    return out;
  });
}

// The live-region line after a move.
function TK_manualAnnounce(plan, label) {
  if (!plan) return "";
  var n = (plan.order || []).length;
  var where = label ? " in " + label : "";
  return "Moved to position " + (plan.index + 1) + " of " + n + where + ".";
}

// Per-person, app-only memory of which views are in manual order:
// { "<scope>": true }. Kept apart from the shared Slate view so the portal
// page never sees it.
function TK_manualPrefRead(raw, scope) {
  var o = null;
  try { o = typeof raw === "string" ? JSON.parse(raw) : raw; } catch (e) { o = null; }
  return !!(o && typeof o === "object" && !Array.isArray(o) && o[scope] === true);
}
function TK_manualPrefWrite(raw, scope, on) {
  var o = null;
  try { o = typeof raw === "string" ? JSON.parse(raw) : raw; } catch (e) { o = null; }
  if (!o || typeof o !== "object" || Array.isArray(o)) o = {};
  var out = {};
  Object.keys(o).forEach(function (k) { if (o[k] === true && k !== scope) out[k] = true; });
  if (on && scope) out[scope] = true;
  return JSON.stringify(out);
}

if (typeof module !== "undefined" && module.exports) {
  Object.assign(module.exports, {
    TK_MANUAL_STEP: TK_MANUAL_STEP,
    TK_MANUAL_MIN_GAP: TK_MANUAL_MIN_GAP,
    TK_MANUAL_PREF_KEY: TK_MANUAL_PREF_KEY,
    TK_manualScopeFor: TK_manualScopeFor,
    TK_manualApply: TK_manualApply,
    TK_manualKeysFromRows: TK_manualKeysFromRows,
    TK_manualKeyOf: TK_manualKeyOf,
    TK_manualKeyBetween: TK_manualKeyBetween,
    TK_manualNeedsRenorm: TK_manualNeedsRenorm,
    TK_manualRenormKeys: TK_manualRenormKeys,
    TK_manualOrderAllowed: TK_manualOrderAllowed,
    TK_manualCrossGroup: TK_manualCrossGroup,
    TK_manualDropPlan: TK_manualDropPlan,
    TK_manualKeyTarget: TK_manualKeyTarget,
    TK_manualPatches: TK_manualPatches,
    TK_manualSortGroups: TK_manualSortGroups,
    TK_manualAnnounce: TK_manualAnnounce,
    TK_manualPrefRead: TK_manualPrefRead,
    TK_manualPrefWrite: TK_manualPrefWrite,
  });
}

// ---- Slate app P1: board view (columns by status or section) -----------------
// Kept in its own block (other slices edit this file). Pure helpers only; the
// board itself is TK_Board.jsx. App only: TK_boardAllowed needs the Slate app
// at regular or full width, so the portal page, compact and sliver keep the
// list exactly as before.
//
// Moves reuse the single-task paths. A status column changes status the way
// the status pill does (TK_nextStatuses decides what is allowed, Done goes
// through the completion path so the review gate and recurring apply). A
// section column changes section through tk_manual_reorder (project lists
// only, P2 rule). The order inside a column is the person's manual order
// (tk_manual_order) when no sort is set.
var TK_BOARD_LAYOUT_KEY = "mgb_tk_layout_v1";
var TK_BOARD_KINDS = ["my", "project", "client", "person"];
var TK_BOARD_LAYOUT_MAX = 200; // remembered lists per person

// o: { inApp, mode, kind }
function TK_boardAllowed(o) {
  o = o || {};
  if (!o.inApp) return false;
  if (o.mode !== "regular" && o.mode !== "full") return false;
  return TK_BOARD_KINDS.indexOf(o.kind) >= 0;
}

// The group-by choices for a board, the default first. One choice: no switch.
function TK_boardGroupChoices(kind) {
  if (kind === "project") return ["section", "status"];
  if (kind === "client") return ["status", "section"];
  if (kind === "my" || kind === "person") return ["status"];
  return [];
}

// The remembered layout for one list: { layout: "list" | "board", by }.
// raw: the stored JSON { "<email>": { "<scope>": "board" | "board:<by>" } }.
// by is "" when nothing valid is stored (the caller takes the default).
function TK_boardLayoutRead(raw, email, scope, kind) {
  var o = null;
  try { o = typeof raw === "string" ? JSON.parse(raw) : raw; } catch (e) { o = null; }
  var mine = o && typeof o === "object" && !Array.isArray(o) ? o[TK_vLower(email)] : null;
  var v = mine && typeof mine === "object" && !Array.isArray(mine) ? mine[scope] : null;
  if (typeof v !== "string" || (v !== "board" && v.indexOf("board:") !== 0)) return { layout: "list", by: "" };
  var by = v.indexOf("board:") === 0 ? v.slice(6) : "";
  if (TK_boardGroupChoices(kind).indexOf(by) < 0) by = "";
  return { layout: "board", by: by };
}

// The new stored JSON. Only "board" is kept; "list" removes the entry, so a
// list nobody switched stores nothing. At most TK_BOARD_LAYOUT_MAX per person.
function TK_boardLayoutWrite(raw, email, scope, layout, by) {
  var o = null;
  try { o = typeof raw === "string" ? JSON.parse(raw) : raw; } catch (e) { o = null; }
  if (!o || typeof o !== "object" || Array.isArray(o)) o = {};
  var who = TK_vLower(email);
  var out = {};
  Object.keys(o).forEach(function (k) {
    if (k !== who && o[k] && typeof o[k] === "object" && !Array.isArray(o[k])) out[k] = o[k];
  });
  var prev = o[who] && typeof o[who] === "object" && !Array.isArray(o[who]) ? o[who] : {};
  var mine = {};
  Object.keys(prev).forEach(function (k) {
    if (k !== scope && typeof prev[k] === "string" && (prev[k] === "board" || prev[k].indexOf("board:") === 0)) mine[k] = prev[k];
  });
  if (layout === "board" && scope) mine[scope] = by ? "board:" + by : "board";
  var keys = Object.keys(mine);
  while (keys.length > TK_BOARD_LAYOUT_MAX) delete mine[keys.shift()];
  if (Object.keys(mine).length) out[who] = mine;
  return JSON.stringify(out);
}

function TK_vBoardLabel(st) {
  var labels = typeof TK_STATUS_LABELS !== "undefined" && TK_STATUS_LABELS ? TK_STATUS_LABELS : TK_vSTATUS_LABEL_FALLBACK;
  return labels[st] || TK_vSTATUS_LABEL_FALLBACK[st] || st;
}

// tasks: in the order to show (sorted first). o: { by: "status" | "section",
// kind, sections (the project's), collapsed: { key: bool } }.
// Status: all five columns in workflow order, always (empty ones too, so each
// can take a drop); Done is folded unless opened. Section: TK_groupBySection's
// columns; a project always ends with "No section".
// -> [{ key, label, status | section, tasks, collapsed }]
function TK_boardColumns(tasks, o) {
  o = o || {};
  var col = o.collapsed || {};
  var has = function (k) { return Object.prototype.hasOwnProperty.call(col, k); };
  var list = (Array.isArray(tasks) ? tasks : []).filter(function (t) { return !!t; });
  if (o.by === "section") {
    var gs = TK_groupBySection(list, { kind: o.kind === "project" ? "project" : "client", sections: o.sections || [] });
    var out = gs.map(function (g) {
      var key = "section:" + g.key;
      return { key: key, label: g.name, section: g.key, tasks: g.tasks, collapsed: has(key) ? !!col[key] : false };
    });
    if (o.kind === "project" && !out.some(function (c) { return c.section === ""; })) {
      out.push({ key: "section:", label: "No section", section: "", tasks: [], collapsed: has("section:") ? !!col["section:"] : false });
    }
    return out;
  }
  var by = {};
  list.forEach(function (t) {
    var st = TK_vStatus(t);
    (by[st] = by[st] || []).push(t);
  });
  return TK_vSTATUS_ORDER.map(function (st) {
    var key = "status:" + st;
    return { key: key, label: TK_vBoardLabel(st), status: st, tasks: by[st] || [], collapsed: has(key) ? !!col[key] : st === "done" };
  });
}

// Optimistic placement while a status change is on its way.
// pending: { taskId: { key, index } }. Returns new columns (others keep their
// object); a pending task found nowhere is ignored.
function TK_boardApplyPending(columns, pending) {
  var cols = Array.isArray(columns) ? columns : [];
  var p = pending && typeof pending === "object" ? pending : {};
  var ids = Object.keys(p).filter(function (id) {
    var dest = p[id] || {};
    return cols.some(function (c) { return c && c.key === dest.key; });
  });
  if (!ids.length) return cols;
  var moved = {};
  var out = cols.map(function (c) {
    if (!c || !Array.isArray(c.tasks)) return c;
    var keep = c.tasks.filter(function (t) {
      if (t && t.id != null && Object.prototype.hasOwnProperty.call(p, String(t.id))) {
        moved[String(t.id)] = t;
        return false;
      }
      return true;
    });
    if (keep.length === c.tasks.length) return c;
    var n = {};
    for (var k in c) if (Object.prototype.hasOwnProperty.call(c, k)) n[k] = c[k];
    n.tasks = keep;
    return n;
  });
  ids.forEach(function (id) {
    var t = moved[id];
    if (!t) return;
    var dest = p[id] || {};
    var placed = false;
    out = out.map(function (c) {
      if (placed || !c || c.key !== dest.key) return c;
      placed = true;
      var n = {};
      for (var k in c) if (Object.prototype.hasOwnProperty.call(c, k)) n[k] = c[k];
      var at = Math.max(0, Math.min(Number(dest.index) || 0, c.tasks.length));
      n.tasks = c.tasks.slice(0, at).concat([t], c.tasks.slice(at));
      return n;
    });
  });
  return out;
}

// The focus order: column by column, top to bottom, folded columns skipped.
function TK_boardIds(columns) {
  var out = [];
  (Array.isArray(columns) ? columns : []).forEach(function (c) {
    if (!c || c.collapsed) return;
    (c.tasks || []).forEach(function (t) {
      if (t && t.id != null) out.push(t.id);
    });
  });
  return out;
}

// Can task move from column `from` to column `to`? o: { kind, items (the
// TK_nextStatuses list for the task), sections (the project's), readOnly,
// canReorder }.
// -> { ok: true, action: "reorder" | "section" | "set" | "complete" | "approve" | "withdraw" }
//    or { ok: false, why }
// Status rules are the status pill's: an item must exist for the target; a
// send back needs a note, so it is never a drop. On My tasks an Unassigned
// task is claimed first (its row has no status menu there either).
function TK_boardDropCheck(task, from, to, o) {
  o = o || {};
  var no = function (why) { return { ok: false, why: why }; };
  if (!task || !from || !to) return no("not_allowed");
  if (o.readOnly) return no("read_only");
  if (from.key === to.key) return o.canReorder ? { ok: true, action: "reorder" } : no("sorted");
  if (to.status) {
    var fromSt = TK_vStatus(task);
    if (o.kind === "my" && !TK_vLower(task.assignee_email)) return no("unassigned");
    var items = Array.isArray(o.items) ? o.items : [];
    var item = null;
    for (var i = 0; i < items.length; i++) if (items[i] && items[i].status === to.status) item = items[i];
    if (!item) {
      if (fromSt === "done" && (to.status === "waiting_client" || to.status === "ready_for_review")) return no("from_done");
      if (fromSt === "ready_for_review") return no("in_review");
      if (to.status === "done" && task.review_required) return no("gated");
      return no("not_allowed");
    }
    if (item.action === "send_back") return no("send_back");
    if (item.action === "approve") return { ok: true, action: "approve" };
    if (item.action === "withdraw" && to.status === "in_progress") return { ok: true, action: "withdraw" };
    if (to.status === "done") return { ok: true, action: "complete" };
    return { ok: true, action: "set" };
  }
  if (to.section != null) {
    if (o.kind !== "project") return no("section_kind");
    if (to.section === "") return { ok: true, action: "section" };
    var secs = Array.isArray(o.sections) ? o.sections : [];
    var want = String(to.section).trim().toLowerCase();
    for (var j = 0; j < secs.length; j++) {
      if (secs[j] != null && String(secs[j]).trim().toLowerCase() === want) return { ok: true, action: "section" };
    }
    return no("section_none");
  }
  return no("not_allowed");
}

var TK_BOARD_WHY = {
  read_only: "This list is read only.",
  sorted: "A sort is on, so the order follows the sort. Clear the sort to set your own order.",
  unassigned: "Claim this task first, then move it.",
  from_done: "A done task can't go there. Move it to To do or In progress first.",
  in_review: "This task is in review. Only a reviewer can approve it.",
  gated: "This task needs a review. Drop it on Ready for review instead.",
  send_back: "To send it back, use the status menu so you can add a note.",
  section_kind: "Only a project's sections can be changed by dragging.",
  section_none: "That section isn't in this project. Add it to the project first.",
  not_allowed: "That move isn't allowed for this task.",
};

function TK_boardWhyText(why) {
  return Object.prototype.hasOwnProperty.call(TK_BOARD_WHY, why) ? TK_BOARD_WHY[why] : TK_BOARD_WHY.not_allowed;
}

// The column holding task id, or null.
function TK_boardColumnOf(columns, id) {
  var cols = Array.isArray(columns) ? columns : [];
  for (var i = 0; i < cols.length; i++) {
    var ts = (cols[i] && cols[i].tasks) || [];
    for (var j = 0; j < ts.length; j++) if (ts[j] && String(ts[j].id) === String(id)) return cols[i];
  }
  return null;
}

// A drop of id into column key at gap index, as a manual-order plan (P2's
// TK_manualDropPlan, columns as groups, crossing allowed). null = no change.
function TK_boardMovePlan(columns, id, key, index) {
  return TK_manualDropPlan(columns, id, key, index, { crossGroup: true });
}

// Alt+Arrow on a card. dir: "left" | "right" (the next column that takes the
// task, at its top) or "up" | "down" (one place within the column).
// allow(fromCol, toCol) -> { ok, why }. Returns { plan } or { why } or null
// (nothing to do: the edge of the board or the column).
function TK_boardKeyMove(columns, id, dir, allow) {
  var cols = Array.isArray(columns) ? columns : [];
  var from = TK_boardColumnOf(cols, id);
  if (!from) return null;
  if (dir === "up" || dir === "down") {
    var plan = TK_manualKeyTarget([from], id, dir === "up" ? -1 : 1, { crossGroup: false });
    if (!plan) return null;
    var ok = typeof allow === "function" ? allow(from, from) : { ok: true };
    return ok && ok.ok ? { plan: plan } : { why: (ok && ok.why) || "not_allowed" };
  }
  if (dir !== "left" && dir !== "right") return null;
  var step = dir === "left" ? -1 : 1;
  var at = cols.indexOf(from);
  var firstWhy = null;
  for (var i = at + step; i >= 0 && i < cols.length; i += step) {
    var to = cols[i];
    var r = typeof allow === "function" ? allow(from, to) : { ok: true };
    if (r && r.ok) {
      var p = TK_boardMovePlan(cols, id, to.key, 0);
      return p ? { plan: p } : null;
    }
    if (!firstWhy) firstWhy = (r && r.why) || "not_allowed";
  }
  return firstWhy ? { why: firstWhy } : null;
}

// The live-region line after a board move.
function TK_boardAnnounce(plan, label) {
  if (!plan) return "";
  var n = (plan.order || []).length;
  if (plan.crossGroup) return "Moved to " + (label || "the column") + ", position " + (plan.index + 1) + " of " + n + ".";
  return TK_manualAnnounce(plan, label);
}

if (typeof module !== "undefined" && module.exports) {
  Object.assign(module.exports, {
    TK_BOARD_LAYOUT_KEY: TK_BOARD_LAYOUT_KEY,
    TK_BOARD_KINDS: TK_BOARD_KINDS,
    TK_boardAllowed: TK_boardAllowed,
    TK_boardGroupChoices: TK_boardGroupChoices,
    TK_boardLayoutRead: TK_boardLayoutRead,
    TK_boardLayoutWrite: TK_boardLayoutWrite,
    TK_boardColumns: TK_boardColumns,
    TK_boardApplyPending: TK_boardApplyPending,
    TK_boardIds: TK_boardIds,
    TK_boardDropCheck: TK_boardDropCheck,
    TK_boardWhyText: TK_boardWhyText,
    TK_boardColumnOf: TK_boardColumnOf,
    TK_boardMovePlan: TK_boardMovePlan,
    TK_boardKeyMove: TK_boardKeyMove,
    TK_boardAnnounce: TK_boardAnnounce,
  });
}

// ---- Slate app interactions (docs/slate-app-interactions-plan.md) -----------
// Pure helpers for undo of a move, Duplicate / Copy / Paste, the right-click
// menu, the drag box, the date and person drop dock, row swipes and swipe
// back. App only: every caller is gated on TK_slateInApp (swipe back on the
// preview flag), so the portal and the preview-off app never reach these.

// The toast when a copy made nothing. skipped: [{ id, reason }] from
// tk_copy_tasks (supabase/slate-ix-copy.sql).
function TK_copySkipText(skipped) {
  var list = Array.isArray(skipped) ? skipped : [];
  var has = function (r) {
    return list.some(function (s) { return s && s.reason === r; });
  };
  if (!list.length) return "Nothing to copy.";
  if (has("other_client")) return "Tasks stay with their own client. Paste them into that client's list.";
  if (has("subtask")) return "A subtask can only be duplicated where it is.";
  if (has("project_archived")) return "That project is archived. Restore it first.";
  if (has("project_trashed") || has("in_trash")) return "That project is in the trash.";
  if (has("deleted")) return "That task was deleted.";
  if (has("no_access")) return "You can't copy that task here.";
  return "Couldn't copy that. Try again.";
}

// Where task id sits now, so an undo can put it back: { id, fromKey,
// beforeId, afterId, orderIds } (orderIds: its group as it is now). null when
// the task is not in the groups.
function TK_manualUndoPlan(groups, id) {
  var gs = Array.isArray(groups) ? groups : [];
  for (var g = 0; g < gs.length; g++) {
    var ts = (gs[g] && gs[g].tasks) || [];
    for (var i = 0; i < ts.length; i++) {
      if (ts[i] && ts[i].id === id) {
        return {
          id: id,
          fromKey: gs[g].key,
          beforeId: i > 0 && ts[i - 1] ? ts[i - 1].id : null,
          afterId: i < ts.length - 1 && ts[i + 1] ? ts[i + 1].id : null,
          orderIds: ts.map(function (t) { return t && t.id; }).filter(function (x) { return x != null; }),
        };
      }
    }
  }
  return null;
}

// "YYYY-MM-DD" plus n calendar days (UTC math, no time zone drift).
function TK__ixAddDays(ymd, n) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ""));
  if (!m) return null;
  var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]) + Math.round(Number(n) || 0) * 86400000);
  var p = function (x) { return (x < 10 ? "0" : "") + x; };
  return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate());
}

// The due date for a quick pick. choice: "today" | "tomorrow" | "next_week"
// (the next Monday, never today) | "none" (null). today: "YYYY-MM-DD".
// undefined for an unknown choice.
function TK_ixDueFor(choice, today) {
  if (choice === "none") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(today || ""))) return undefined;
  if (choice === "today") return today;
  if (choice === "tomorrow") return TK__ixAddDays(today, 1);
  if (choice === "next_week") {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today);
    var wd = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay(); // 0 Sunday
    return TK__ixAddDays(today, wd === 1 ? 7 : (8 - wd) % 7 || 7);
  }
  return undefined;
}

// Snooze (a left row swipe, the menu): to tomorrow; a task already due
// tomorrow or later moves one more day.
function TK_ixSnoozeDate(due, today) {
  var tmr = TK__ixAddDays(today, 1);
  if (!tmr) return null;
  var d = /^\d{4}-\d{2}-\d{2}/.test(String(due || "")) ? String(due).slice(0, 10) : null;
  if (!d || d < tmr) return tmr;
  return TK__ixAddDays(d, 1);
}

// The toast after a quick due change. ymd null: "Due date cleared."
function TK_ixDueText(ymd, today) {
  if (ymd == null) return "Due date cleared.";
  if (ymd === today) return "Due today.";
  if (ymd === TK__ixAddDays(today, 1)) return "Due tomorrow.";
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd));
  if (!m) return "Due date changed.";
  var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return "Due " + months[+m[2] - 1] + " " + +m[3] + ".";
}

// Where Cmd+V puts the clipboard. o: { kind, projectId, clientId, section,
// bySection }. A project list pastes into that project (and the focused
// section when the list is grouped by section); a client list onto that
// client; other lists duplicate in place (null). A copy never changes
// client: tk_copy_tasks refuses that.
function TK_ixPasteTarget(o) {
  var c = o || {};
  var t = null;
  if (c.kind === "project" && c.projectId) t = { project_id: c.projectId };
  // a client list holds the client's tasks outside projects: a paste there
  // lands outside any project (never in the source's project)
  else if (c.kind === "client" && c.clientId) t = { project_id: null, client_id: c.clientId };
  if (t && c.bySection) t.section = c.section == null || c.section === "" ? null : String(c.section);
  return t;
}

// The rows a drag box touches. box: { left, top, right, bottom } (page
// pixels, any corner order); rows: [{ id, left, top, right, bottom }].
function TK_ixMarqueeHits(box, rows) {
  if (!box) return [];
  var l = Math.min(box.left, box.right);
  var r = Math.max(box.left, box.right);
  var t = Math.min(box.top, box.bottom);
  var b = Math.max(box.top, box.bottom);
  var out = [];
  (Array.isArray(rows) ? rows : []).forEach(function (x) {
    if (!x || x.id == null) return;
    if (x.right < l || x.left > r || x.bottom < t || x.top > b) return;
    out.push(x.id);
  });
  return out;
}

// Row swipes. The first 10px decide the axis: "x" (a swipe), "y" (scroll) or
// null (not yet). A swipe that starts within 24px of a screen edge belongs to
// swipe back.
var TK_IX_SWIPE_LOCK = 10;
var TK_IX_EDGE = 24;
function TK_ixSwipeAxis(dx, dy) {
  var ax = Math.abs(Number(dx) || 0);
  var ay = Math.abs(Number(dy) || 0);
  if (Math.max(ax, ay) < TK_IX_SWIPE_LOCK) return null;
  return ax > ay * 1.5 ? "x" : "y";
}
// Only the left edge is kept for the swipe back; the right edge is a
// normal row. screenW is kept for callers and ignored.
function TK_ixAtEdge(x) {
  return (Number(x) || 0) <= TK_IX_EDGE;
}
// dx: how far the row moved; width: the row's width. "complete" (right),
// "snooze" (left) or null (not far enough: the row springs back).
function TK_ixSwipeAction(dx, width) {
  var w = Number(width) || 0;
  var need = Math.min(96, w > 0 ? w * 0.35 : 96);
  if (need < 48) need = 48;
  if (dx >= need) return "complete";
  if (dx <= -need) return "snooze";
  return null;
}

// Swipe back on a trackpad: a two-finger swipe right (negative deltaX past
// 120) that is mostly sideways, where nothing under the pointer can scroll
// left.
var TK_IX_WHEEL_BACK = 120;
function TK_ixWheelBack(sumX, sumY) {
  var x = Number(sumX) || 0;
  return x <= -TK_IX_WHEEL_BACK && Math.abs(x) >= Math.abs(Number(sumY) || 0) * 2;
}

// One "back" order for Slate and the portal: close the top layer (a menu or
// dialog), then the open task, then go to the previous page.
// s: { layer, task, history } (booleans). "layer" | "task" | "history" | null.
function TK_ixBackStep(s) {
  var o = s || {};
  if (o.layer) return "layer";
  if (o.task) return "task";
  if (o.history) return "history";
  return null;
}

// The right-click menu for a row. c: { readOnly, canEdit, done, count (the
// selected rows this acts on), clip (tasks on the clipboard), sections (the
// project's sections, when a section move applies), canClaim }. Returns the
// item keys, in order; "-" is a divider.
function TK_ixMenuItems(c) {
  var o = c || {};
  var many = (Number(o.count) || 0) > 1;
  var out = [];
  if (!many) out.push("open");
  if (o.readOnly) {
    out.push("copy");
    return out;
  }
  if (!many && o.canEdit) out.push("edit");
  out.push(o.done && !many ? "reopen" : "complete");
  out.push("-");
  out.push("duplicate", "copy");
  if ((Number(o.clip) || 0) > 0) out.push("paste");
  out.push("-");
  if (o.canClaim) out.push("assign_me");
  out.push("due_today", "due_tomorrow", "due_next_week", "due_none", "snooze");
  if (Array.isArray(o.sections) && o.sections.length) out.push("section");
  out.push("-");
  out.push(many ? "deselect" : "select");
  out.push("delete");
  return out;
}

// Slate list keys on top of j k Enter x (TK_vLIST_KEYS): arrows move between
// tasks and e opens the task to edit its title. Only bound in the Slate app.
var TK_vSLATE_KEYS = { ArrowDown: "next", ArrowUp: "prev", e: "edit" };
function TK_slateKeyAction(key) {
  return Object.prototype.hasOwnProperty.call(TK_vSLATE_KEYS, key) ? TK_vSLATE_KEYS[key] : null;
}

// Cmd/Ctrl+D, C, V and Z in the Slate app. e: a keydown event. "duplicate" |
// "copy" | "paste" | null. Shift or Alt with it leaves it to the browser.
function TK_ixChordAction(e) {
  if (!e || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return null;
  var k = String(e.key || "").toLowerCase();
  if (k === "d") return "duplicate";
  if (k === "c") return "copy";
  if (k === "v") return "paste";
  return null;
}

// Who the drop dock offers: me first ("Me"), then the people on this list,
// then the rest of the active staff; eight at most, no repeats.
function TK_ixDockPeople(me, people, staff) {
  var out = [];
  var seen = {};
  var self = String(me || "").trim().toLowerCase();
  var add = function (email, name) {
    var e = String(email || "").trim().toLowerCase();
    if (!e || seen[e] || out.length >= 8) return;
    seen[e] = 1;
    out.push({ email: e, name: e === self ? "Me" : name || e });
  };
  if (self) add(self, "Me");
  (people || []).forEach(function (x) {
    if (x) add(x.email, x.name);
  });
  (staff || []).forEach(function (x) {
    if (x && x.active !== false) add(x.email, x.name);
  });
  return out;
}

if (typeof module !== "undefined" && module.exports) {
  Object.assign(module.exports, {
    TK_copySkipText: TK_copySkipText,
    TK_manualUndoPlan: TK_manualUndoPlan,
    TK_ixDueFor: TK_ixDueFor,
    TK_ixSnoozeDate: TK_ixSnoozeDate,
    TK_ixDueText: TK_ixDueText,
    TK_ixPasteTarget: TK_ixPasteTarget,
    TK_ixMarqueeHits: TK_ixMarqueeHits,
    TK_IX_EDGE: TK_IX_EDGE,
    TK_ixSwipeAxis: TK_ixSwipeAxis,
    TK_ixAtEdge: TK_ixAtEdge,
    TK_ixSwipeAction: TK_ixSwipeAction,
    TK_ixWheelBack: TK_ixWheelBack,
    TK_ixBackStep: TK_ixBackStep,
    TK_ixMenuItems: TK_ixMenuItems,
    TK_slateKeyAction: TK_slateKeyAction,
    TK_ixChordAction: TK_ixChordAction,
    TK_ixDockPeople: TK_ixDockPeople,
  });
}
