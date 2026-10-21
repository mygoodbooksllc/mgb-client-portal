// node components/tasks/TK_viewLogic.test.js
const assert = require("assert");
const L = require("./TK_viewLogic.js");
let n = 0;
function t(name, fn) {
  try {
    fn();
  } catch (e) {
    console.error("FAIL " + name);
    throw e;
  }
  n++;
}

// ---- Pop-out features ---------------------------------------------------------
t("popOutFeatures default", () => {
  assert.strictEqual(L.TK_popOutFeatures(null, { availWidth: 1920, availHeight: 1080 }), "popup,width=480,height=820");
  assert.strictEqual(L.TK_popOutFeatures(undefined, {}), "popup,width=480,height=820");
});
t("popOutFeatures clamps to the minimum", () => {
  assert.strictEqual(L.TK_popOutFeatures({ w: 200, h: 300 }, { availWidth: 1920, availHeight: 1080 }), "popup,width=380,height=520");
});
t("popOutFeatures clamps to the screen", () => {
  assert.strictEqual(L.TK_popOutFeatures({ w: 3000, h: 2000 }, { availWidth: 1440, availHeight: 900 }), "popup,width=1440,height=900");
});
t("popOutFeatures keeps a saved size", () => {
  assert.strictEqual(L.TK_popOutFeatures({ w: 600, h: 700 }, { availWidth: 1440, availHeight: 900 }), "popup,width=600,height=700");
});
t("popOutFeatures ignores a broken saved value", () => {
  assert.strictEqual(L.TK_popOutFeatures({ w: "x" }, { availWidth: 1440, availHeight: 900 }), "popup,width=480,height=820");
});
t("popOut constants", () => {
  assert.deepStrictEqual(L.TK_POPOUT_DEFAULT, { w: 480, h: 820 });
  assert.deepStrictEqual(L.TK_POPOUT_MIN, { w: 380, h: 520 });
});

// ---- Dock plan --------------------------------------------------------------------
t("dockPlan no opener navigates", () => {
  assert.strictEqual(L.TK_dockPlan({ hasOpener: false }), "navigate");
  assert.strictEqual(L.TK_dockPlan(null), "navigate");
});
t("dockPlan closed opener navigates", () => {
  assert.strictEqual(L.TK_dockPlan({ hasOpener: true, openerClosed: true, openerTabId: "a" }), "navigate");
});
t("dockPlan no tab id navigates", () => {
  assert.strictEqual(L.TK_dockPlan({ hasOpener: true, openerClosed: false, openerTabId: null }), "navigate");
});
t("dockPlan posts first", () => {
  assert.strictEqual(L.TK_dockPlan({ hasOpener: true, openerTabId: "a" }), "post");
  assert.strictEqual(L.TK_dockPlan({ hasOpener: true, openerTabId: "a", posted: false, elapsedMs: 0 }), "post");
});
t("dockPlan waits at 599", () => {
  assert.strictEqual(L.TK_dockPlan({ hasOpener: true, openerTabId: "a", posted: true, replied: false, elapsedMs: 599 }), "wait");
  assert.strictEqual(L.TK_dockPlan({ hasOpener: true, openerTabId: "a", replied: false, elapsedMs: 0 }), "wait");
});
t("dockPlan closes when replied", () => {
  assert.strictEqual(L.TK_dockPlan({ hasOpener: true, openerTabId: "a", posted: true, replied: true, elapsedMs: 120 }), "close");
});
t("dockPlan navigates at 600", () => {
  assert.strictEqual(L.TK_dockPlan({ hasOpener: true, openerTabId: "a", posted: true, replied: false, elapsedMs: 600 }), "navigate");
});

// ---- Shell layout ------------------------------------------------------------------
t("shellLayout 1280 desktop", () => {
  assert.deepStrictEqual(L.TK_shellLayout(1280, false), { compact: false, bottomBar: false, sidebar: "rail" });
});
t("shellLayout 800 sheet", () => {
  assert.deepStrictEqual(L.TK_shellLayout(800, false), { compact: false, bottomBar: false, sidebar: "sheet" });
});
t("shellLayout 375 touch has the bar", () => {
  assert.deepStrictEqual(L.TK_shellLayout(375, true), { compact: true, bottomBar: true, sidebar: "sheet" });
});
t("shellLayout 375 no touch has no bar", () => {
  assert.deepStrictEqual(L.TK_shellLayout(375, false), { compact: true, bottomBar: false, sidebar: "sheet" });
});
t("shellLayout edges", () => {
  assert.strictEqual(L.TK_shellLayout(900, false).sidebar, "rail");
  assert.strictEqual(L.TK_shellLayout(899, false).sidebar, "sheet");
  assert.strictEqual(L.TK_shellLayout(761, true).compact, false);
  assert.strictEqual(L.TK_shellLayout(761, true).bottomBar, false);
  assert.strictEqual(L.TK_shellLayout(760, true).bottomBar, true);
});
t("isTouchPrimary uses the media query", () => {
  let asked = null;
  assert.strictEqual(
    L.TK_isTouchPrimary((q) => {
      asked = q;
      return { matches: true };
    }),
    true,
  );
  assert.strictEqual(asked, "(hover: none) and (pointer: coarse)");
  assert.strictEqual(L.TK_isTouchPrimary(() => ({ matches: false })), false);
  assert.strictEqual(
    L.TK_isTouchPrimary(() => {
      throw new Error("no");
    }),
    false,
  );
});

// ---- Sections -----------------------------------------------------------------------
const tk = (id, extra) => Object.assign({ id, text: "Task " + id, status: "todo", done: false, priority: "normal", due_date: null }, extra || {});

t("groupBySection client order", () => {
  const rows = [
    tk("1", { section: "Monthly" }),
    tk("2", { section: "Zeta" }),
    tk("3", { section: null }),
    tk("4", { section: "Weekly" }),
    tk("5", { section: "Alpha" }),
    tk("6", { section: "Monthly" }),
  ];
  const g = L.TK_groupBySection(rows, { kind: "client" });
  assert.deepStrictEqual(
    g.map((x) => x.key),
    ["Weekly", "Monthly", "Alpha", "Zeta", ""],
  );
  assert.strictEqual(g[4].name, "No section");
  assert.deepStrictEqual(
    g[1].tasks.map((x) => x.id),
    ["1", "6"],
  );
});
t("groupBySection client order ignores case", () => {
  const g = L.TK_groupBySection([tk("1", { section: "quarterly" }), tk("2", { section: "weekly" })], { kind: "client" });
  assert.deepStrictEqual(
    g.map((x) => x.key),
    ["weekly", "quarterly"],
  );
});
t("groupBySection project keeps empty sections and order", () => {
  const rows = [tk("1", { section: "Later" }), tk("2", { section: "Extra" }), tk("3", { section: "" })];
  const g = L.TK_groupBySection(rows, { kind: "project", sections: ["Now", "Later"] });
  assert.deepStrictEqual(
    g.map((x) => x.key),
    ["Now", "Later", "Extra", ""],
  );
  assert.strictEqual(g[0].tasks.length, 0);
});
t("groupBySection project with no section rows", () => {
  const g = L.TK_groupBySection([tk("1", { section: "Now" })], { kind: "project", sections: ["Now"] });
  assert.deepStrictEqual(
    g.map((x) => x.key),
    ["Now"],
  );
});
t("groupBySection empty list gives one No section group", () => {
  const g = L.TK_groupBySection([], { kind: "client" });
  assert.deepStrictEqual(
    g.map((x) => x.name),
    ["No section"],
  );
});

// ---- Sorting ------------------------------------------------------------------------
t("sortTasks default uses sort_key then due", () => {
  const rows = [tk("a", { due_date: "2026-10-01" }), tk("b", { sort_key: 2 }), tk("c", { sort_key: 1 }), tk("d", { due_date: "2026-09-01" })];
  assert.deepStrictEqual(
    L.TK_sortTasks(rows, null).map((x) => x.id),
    ["c", "b", "d", "a"],
  );
});
t("sortTasks by due keeps undated last both ways", () => {
  const rows = [tk("a"), tk("b", { due_date: "2026-10-02" }), tk("c", { due_date: "2026-10-01" })];
  assert.deepStrictEqual(
    L.TK_sortTasks(rows, { col: "due", dir: "asc" }).map((x) => x.id),
    ["c", "b", "a"],
  );
  assert.deepStrictEqual(
    L.TK_sortTasks(rows, { col: "due", dir: "desc" }).map((x) => x.id),
    ["b", "c", "a"],
  );
});
t("sortTasks by priority and status", () => {
  const rows = [tk("a", { priority: "low" }), tk("b", { priority: "high" }), tk("c")];
  assert.deepStrictEqual(
    L.TK_sortTasks(rows, { col: "priority", dir: "asc" }).map((x) => x.id),
    ["b", "c", "a"],
  );
  const st = [tk("a", { status: "done" }), tk("b", { status: "waiting_client" }), tk("c", { status: "todo" })];
  assert.deepStrictEqual(
    L.TK_sortTasks(st, { col: "status", dir: "asc" }).map((x) => x.id),
    ["c", "b", "a"],
  );
});
t("sortTasks by task text and assignee name", () => {
  const rows = [tk("a", { text: "beta", assignee_email: "z@example.test" }), tk("b", { text: "Alpha", assignee_email: "y@example.test" })];
  assert.deepStrictEqual(
    L.TK_sortTasks(rows, { col: "task", dir: "asc" }).map((x) => x.id),
    ["b", "a"],
  );
  const names = { "z@example.test": "Account Manager", "y@example.test": "Bookkeeper" };
  assert.deepStrictEqual(
    L.TK_sortTasks(rows, { col: "assignee", dir: "asc" }, { nameOf: (e) => names[e] }).map((x) => x.id),
    ["a", "b"],
  );
});
t("sortTasks by assignee puts Unassigned last both ways (S8b)", () => {
  const rows = [
    tk("u", { assignee_email: null, staff_email: "a@example.test" }),
    tk("z", { assignee_email: "z@example.test" }),
    tk("y", { assignee_email: "y@example.test" }),
  ];
  assert.deepStrictEqual(L.TK_sortTasks(rows, { col: "assignee", dir: "asc" }).map((x) => x.id), ["y", "z", "u"]);
  assert.deepStrictEqual(L.TK_sortTasks(rows, { col: "assignee", dir: "desc" }).map((x) => x.id), ["z", "y", "u"]);
});
t("My Tasks groups: Unassigned sits after Waiting and before Done (S8b)", () => {
  const keys = L.TK_MY_GROUPS.map((g) => g.key);
  assert.strictEqual(keys.indexOf("unassigned"), keys.indexOf("waiting") + 1);
  assert.strictEqual(keys.indexOf("done"), keys.indexOf("unassigned") + 1);
  const v = L.TK_myGroupsView({ overdue: [], today: [], week: [], later: [], waiting: [tk("w")], unassigned: [tk("u")], done: [] }, { collapsed: {} });
  assert.deepStrictEqual(v.map((g) => g.key), ["waiting", "unassigned"]);
  assert.strictEqual(v[1].label, "Unassigned");
});
t("sortTasks does not mutate", () => {
  const rows = [tk("b", { sort_key: 2 }), tk("a", { sort_key: 1 })];
  L.TK_sortTasks(rows, null);
  assert.strictEqual(rows[0].id, "b");
});
t("toggleSort cycles", () => {
  assert.deepStrictEqual(L.TK_toggleSort(null, "due"), { col: "due", dir: "asc" });
  assert.deepStrictEqual(L.TK_toggleSort({ col: "due", dir: "asc" }, "due"), { col: "due", dir: "desc" });
  assert.strictEqual(L.TK_toggleSort({ col: "due", dir: "desc" }, "due"), null);
  assert.deepStrictEqual(L.TK_toggleSort({ col: "due", dir: "desc" }, "status"), { col: "status", dir: "asc" });
  assert.strictEqual(L.TK_toggleSort(null, "nope"), null);
});

// ---- Filters -----------------------------------------------------------------------
t("applyFilters drops done unless showDone, old done unless showOlder", () => {
  const rows = [
    tk("open"),
    tk("done", { status: "done", done: true, completed_at: "2026-09-01T10:00:00Z" }),
    tk("old", { status: "done", done: true, completed_at: "2025-01-01T10:00:00Z" }),
    tk("gone", { deleted_at: "2026-10-01T00:00:00Z" }),
  ];
  const ids = (f) => L.TK_applyFilters(rows, Object.assign({ today: "2026-10-11" }, f)).map((x) => x.id);
  assert.deepStrictEqual(ids({}), ["open"]);
  assert.deepStrictEqual(ids({ showDone: true }), ["open", "done"]);
  assert.deepStrictEqual(ids({ showDone: true, showOlder: true }), ["open", "done", "old"]);
});
t("applyFilters by assignee and statuses", () => {
  const rows = [
    tk("1", { assignee_email: "a@example.test", status: "in_progress" }),
    tk("2", { assignee_email: "b@example.test" }),
    tk("3", { assignee_email: null, staff_email: "A@example.test", status: "waiting_client" }),
  ];
  // S8b: the assignee only; an Unassigned task never matches its owner.
  assert.deepStrictEqual(
    L.TK_applyFilters(rows, { assignee: "a@example.test" }).map((x) => x.id),
    ["1"],
  );
  assert.deepStrictEqual(
    L.TK_applyFilters(rows, { assignee: L.TK_UNASSIGNED }).map((x) => x.id),
    ["3"],
  );
  assert.deepStrictEqual(
    L.TK_applyFilters(rows, { statuses: ["waiting_client", "todo"] }).map((x) => x.id),
    ["2", "3"],
  );
});

// ---- My Tasks groups --------------------------------------------------------------
t("myGroupsView hides empty groups, Done collapsed by default", () => {
  const v = L.TK_myGroupsView({ overdue: [tk("1")], today: [], week: [tk("2")], later: [], waiting: [], done: [tk("3")] }, { collapsed: {} });
  assert.deepStrictEqual(
    v.map((g) => g.key),
    ["overdue", "week", "done"],
  );
  assert.deepStrictEqual(
    v.map((g) => g.collapsed),
    [false, false, true],
  );
  assert.strictEqual(v[1].label, "This week");
});
t("myGroupsView remembers collapse and can hide Done", () => {
  const v = L.TK_myGroupsView({ overdue: [tk("1")], done: [tk("3")] }, { collapsed: { overdue: true, done: false } });
  assert.deepStrictEqual(
    v.map((g) => g.collapsed),
    [true, false],
  );
  assert.deepStrictEqual(
    L.TK_myGroupsView({ done: [tk("3")] }, { showDone: false }).length,
    0,
  );
});
t("focusIds skips collapsed groups", () => {
  const v = [
    { key: "a", collapsed: false, tasks: [tk("1"), tk("2")] },
    { key: "b", collapsed: true, tasks: [tk("3")] },
    { key: "c", collapsed: false, tasks: [tk("4")] },
  ];
  assert.deepStrictEqual(L.TK_focusIds(v), ["1", "2", "4"]);
});

// ---- Keys ------------------------------------------------------------------------------
t("listKeyAction map", () => {
  assert.strictEqual(L.TK_listKeyAction("j"), "next");
  assert.strictEqual(L.TK_listKeyAction("k"), "prev");
  assert.strictEqual(L.TK_listKeyAction("Enter"), "open");
  assert.strictEqual(L.TK_listKeyAction("x"), "toggle");
  assert.strictEqual(L.TK_listKeyAction("s"), "status");
  assert.strictEqual(L.TK_listKeyAction("a"), "assign");
  assert.strictEqual(L.TK_listKeyAction("q"), "add");
  assert.strictEqual(L.TK_listKeyAction("?"), "help");
  assert.strictEqual(L.TK_listKeyAction("ArrowDown"), null);
  assert.strictEqual(L.TK_listKeyAction("toString"), null);
});
t("moveFocus", () => {
  assert.strictEqual(L.TK_moveFocus(["a", "b", "c"], null, 1), "a");
  assert.strictEqual(L.TK_moveFocus(["a", "b", "c"], null, -1), "c");
  assert.strictEqual(L.TK_moveFocus(["a", "b", "c"], "b", 1), "c");
  assert.strictEqual(L.TK_moveFocus(["a", "b", "c"], "c", 1), "c");
  assert.strictEqual(L.TK_moveFocus(["a", "b", "c"], "a", -1), "a");
  assert.strictEqual(L.TK_moveFocus([], "a", 1), null);
});

function fakeEvent(key, extra) {
  const e = Object.assign({ key, target: { tagName: "DIV", getAttribute: () => null }, prevented: false }, extra || {});
  e.preventDefault = () => {
    e.prevented = true;
  };
  return e;
}
function makeHandler(state, log, extra) {
  return L.TK_makeListKeyHandler(
    Object.assign(
      {
        getState: () => state,
        setFocusedId: (id) => {
          state.focusedId = id;
          log.push("focus:" + id);
        },
        onOpen: (id) => log.push("open:" + id),
        onToggleDone: (id) => log.push("toggle:" + id),
        onStatusMenu: (id) => log.push("status:" + id),
        onAssign: (id) => log.push("assign:" + id),
        onQuickAdd: () => log.push("add"),
        onHelp: () => log.push("help"),
        onUsed: (k) => log.push("used:" + k),
        shouldHandle: () => true,
      },
      extra || {},
    ),
  );
}
t("key handler walks and acts", () => {
  const state = { ids: ["a", "b"], focusedId: null };
  const log = [];
  const h = makeHandler(state, log);
  const e1 = fakeEvent("j");
  h(e1);
  assert.strictEqual(e1.prevented, true);
  h(fakeEvent("j"));
  h(fakeEvent("x"));
  h(fakeEvent("s"));
  h(fakeEvent("a"));
  h(fakeEvent("Enter"));
  h(fakeEvent("k"));
  h(fakeEvent("q"));
  h(fakeEvent("?"));
  assert.deepStrictEqual(log, [
    "focus:a",
    "used:j",
    "focus:b",
    "used:j",
    "toggle:b",
    "used:x",
    "status:b",
    "used:s",
    "assign:b",
    "used:a",
    "open:b",
    "used:Enter",
    "focus:a",
    "used:k",
    "add",
    "used:q",
    "help",
    "used:?",
  ]);
});
t("key handler leaves row keys alone with no focus", () => {
  const log = [];
  const h = makeHandler({ ids: ["a"], focusedId: null }, log);
  const e = fakeEvent("x");
  h(e);
  h(fakeEvent("Enter"));
  assert.deepStrictEqual(log, []);
  assert.strictEqual(e.prevented, false);
});
t("key handler: Enter on a link keeps the link", () => {
  const log = [];
  const h = makeHandler({ ids: ["a"], focusedId: "a" }, log);
  const e = fakeEvent("Enter", { target: { tagName: "A", getAttribute: () => null } });
  h(e);
  assert.deepStrictEqual(log, []);
  assert.strictEqual(e.prevented, false);
});
t("key handler respects shouldHandle", () => {
  const log = [];
  const h = makeHandler({ ids: ["a"], focusedId: "a" }, log, { shouldHandle: () => false });
  const e = fakeEvent("j");
  h(e);
  assert.deepStrictEqual(log, []);
  assert.strictEqual(e.prevented, false);
});
t("key handler ignores other keys", () => {
  const log = [];
  const h = makeHandler({ ids: ["a"], focusedId: "a" }, log);
  const e = fakeEvent("ArrowDown");
  h(e);
  assert.deepStrictEqual(log, []);
  assert.strictEqual(e.prevented, false);
});
t("bindListKeys with enabled false binds nothing", () => {
  let added = 0;
  const target = { addEventListener: () => added++, removeEventListener: () => {} };
  assert.strictEqual(L.TK_bindListKeys(target, { enabled: false }), null);
  assert.strictEqual(added, 0);
});
t("bindListKeys with enabled true binds once, bubble phase, and unbinds", () => {
  const calls = [];
  const target = {
    addEventListener: (type, fn, cap) => calls.push(["add", type, cap]),
    removeEventListener: (type, fn, cap) => calls.push(["remove", type, cap]),
  };
  const off = L.TK_bindListKeys(target, { enabled: true, getState: () => ({ ids: [] }) });
  assert.strictEqual(typeof off, "function");
  off();
  assert.deepStrictEqual(calls, [
    ["add", "keydown", false],
    ["remove", "keydown", false],
  ]);
});

// ---- Projects ---------------------------------------------------------------------
t("parseSectionsText", () => {
  assert.deepStrictEqual(L.TK_parseSectionsText("  Setup \n\nsetup\nReview  \r\nFiling"), ["Setup", "Review", "Filing"]);
  assert.deepStrictEqual(L.TK_parseSectionsText(""), []);
  assert.strictEqual(L.TK_parseSectionsText("x".repeat(80))[0].length, 60);
  const many = Array.from({ length: 40 }, (_, i) => "S" + i).join("\n");
  assert.strictEqual(L.TK_parseSectionsText(many).length, 30);
});
t("Open to all staff switch renders only for admins", () => {
  assert.ok(L.TK_newProjectFields({ isAdmin: true }).indexOf("openToStaff") >= 0);
  assert.ok(L.TK_newProjectFields({ isAdmin: false }).indexOf("openToStaff") < 0);
  assert.ok(L.TK_newProjectFields({}).indexOf("openToStaff") < 0);
  assert.deepStrictEqual(L.TK_newProjectFields({ isAdmin: false }), ["name", "sections"]);
});
t("New project modal shows projectNameTaken under the name", () => {
  const copy = { projectNameTaken: "NAME TAKEN", saveError: "SAVE ERR", offline: "OFF" };
  assert.deepStrictEqual(L.TK_projectErrorText({ code: "tk_name_taken" }, copy), { field: "name", text: "NAME TAKEN" });
  assert.deepStrictEqual(L.TK_projectErrorText({ code: "23505" }, copy), { field: "name", text: "NAME TAKEN" });
  assert.deepStrictEqual(L.TK_projectErrorText({ code: "tk_offline" }, copy), { field: null, text: "OFF" });
  assert.deepStrictEqual(L.TK_projectErrorText({ code: "42501" }, copy), { field: null, text: "SAVE ERR" });
  assert.strictEqual(L.TK_projectErrorText({ code: "tk_name_taken" }).field, "name");
});
t("canManageProjectHint", () => {
  const p = { id: "p", owner_email: "own@example.test" };
  assert.strictEqual(L.TK_canManageProjectHint(p, { isAdmin: true, email: "x@example.test" }), true);
  assert.strictEqual(L.TK_canManageProjectHint(p, { email: "OWN@example.test" }), true);
  assert.strictEqual(L.TK_canManageProjectHint(p, { email: "m@example.test", members: [{ staff_email: "m@example.test", role: "owner" }] }), true);
  assert.strictEqual(L.TK_canManageProjectHint(p, { email: "m@example.test", members: [{ staff_email: "m@example.test", role: "member" }] }), false);
  assert.strictEqual(L.TK_canManageProjectHint(null, { isAdmin: true }), false);
});

// ---- Display helpers ----------------------------------------------------------------
t("initials", () => {
  assert.strictEqual(L.TK_initials("Ada Byron King"), "AK");
  assert.strictEqual(L.TK_initials("cher"), "CH");
  assert.strictEqual(L.TK_initials("first.last@example.test"), "FL");
  assert.strictEqual(L.TK_initials(""), "?");
});
t("listScopeOf", () => {
  assert.deepStrictEqual(L.TK_listScopeOf({ view: "client", clientId: "c1" }), { scope: { clientId: "c1" }, key: "client:c1" });
  assert.deepStrictEqual(L.TK_listScopeOf({ view: "project", projectId: "p1" }), { scope: { projectId: "p1" }, key: "project:p1" });
  const staff = [{ id: "s1", email: "Pat@example.test" }];
  const r = L.TK_listScopeOf({ view: "person", staffId: "s1" }, { staff });
  assert.deepStrictEqual(r.scope, { assigneeEmail: "pat@example.test" });
  assert.strictEqual(r.key, "person:s1");
  assert.ok(r.key.indexOf("@") < 0);
  assert.strictEqual(L.TK_listScopeOf({ view: "person", staffId: "nope" }, { staff }), null);
  assert.strictEqual(L.TK_listScopeOf({ view: "my" }), null);
});
t("searchRowToTask", () => {
  const x = L.TK_searchRowToTask({ task_id: "t1", task_text: "Hi", client_id: "c", status: "done", due_date: "2026-10-01" });
  assert.strictEqual(x.id, "t1");
  assert.strictEqual(x.text, "Hi");
  assert.strictEqual(x.done, true);
  assert.strictEqual(L.TK_searchRowToTask({ task_id: "t2", status: "weird" }).status, "todo");
});

// ---- Group by Due date | Client ------------------------------------------------------------
t("normalizeGroupBy only allows due or client", () => {
  assert.strictEqual(L.TK_normalizeGroupBy("client"), "client");
  assert.strictEqual(L.TK_normalizeGroupBy("due"), "due");
  assert.strictEqual(L.TK_normalizeGroupBy("nonsense"), "due");
  assert.strictEqual(L.TK_normalizeGroupBy(null), "due");
});
t("flattenMyGroups keeps group order and can drop Done", () => {
  const g = { overdue: [{ id: "a" }], today: [], week: [{ id: "b" }], later: [], waiting: [{ id: "c" }], done: [{ id: "d" }] };
  assert.deepStrictEqual(L.TK_flattenMyGroups(g).map((x) => x.id), ["a", "b", "c", "d"]);
  assert.deepStrictEqual(L.TK_flattenMyGroups(g, { showDone: false }).map((x) => x.id), ["a", "b", "c"]);
  assert.deepStrictEqual(L.TK_flattenMyGroups(null), []);
});
const GC = [
  { id: "c1", name: "Zeta Corp" },
  { id: "c2", name: "alpha LLC" },
  { id: "c3", name: "Demo Test", testOnly: true },
  { id: "c4", name: "MGB Internal", isInternal: true },
];
t("groupByClient sorts by name, then No client, then test, then internal", () => {
  const tasks = [
    { id: "1", client_id: "c4" },
    { id: "2", client_id: "c1" },
    { id: "3", client_id: null },
    { id: "4", client_id: "c3" },
    { id: "5", client_id: "c2" },
    { id: "6", client_id: "c1" },
  ];
  const g = L.TK_groupByClient(tasks, { clients: GC });
  assert.deepStrictEqual(g.map((x) => x.name), ["alpha LLC", "Zeta Corp", "No client", "Demo Test", "MGB Internal"]);
  assert.deepStrictEqual(g[1].tasks.map((x) => x.id), ["2", "6"]);
  assert.strictEqual(g[2].clientId, null);
});
t("groupByClient handles unknown clients, empty input and collapsed", () => {
  assert.deepStrictEqual(L.TK_groupByClient([], { clients: GC }), []);
  assert.deepStrictEqual(L.TK_groupByClient(null), []);
  const g = L.TK_groupByClient([{ id: "1", client_id: "zz" }, { id: "2" }], { clients: GC, collapsed: { "client:zz": true } });
  assert.strictEqual(g[0].name, "zz");
  assert.strictEqual(g[0].collapsed, true);
  assert.strictEqual(g[1].collapsed, false);
});
t("groupByClient accepts a custom flag function", () => {
  const g = L.TK_groupByClient([{ id: "1", client_id: "c1" }, { id: "2", client_id: "c2" }], {
    clients: GC,
    flagOf: (c) => (c && c.id === "c2" ? "test" : null),
  });
  assert.deepStrictEqual(g.map((x) => x.name), ["Zeta Corp", "alpha LLC"]);
});

// ---- Manage projects ---------------------------------------------------------------------
const MR = [
  { id: "p1", name: "Monthly close", state: "active", client_name: "Zeta Corp", owner_name: "Dana", owner_email: "dana@x.com", open_tasks: 3, done_tasks: 2 },
  { id: "p2", name: "Old cleanup", state: "archived", client_name: null, owner_name: "Sam", owner_email: "sam@x.com", open_tasks: 0, done_tasks: 5 },
  { id: "p3", name: "Gone", state: "trashed", trashed_at: "2026-10-10T00:00:00Z", open_tasks: 1, done_tasks: 0 },
  { id: "p4", name: "Gone long ago", state: "expired", trashed_at: "2026-08-01T00:00:00Z" },
];
t("manageCounts splits active, archived and trash", () => {
  assert.deepStrictEqual(L.TK_manageCounts(MR), { all: 2, active: 1, archived: 1, trashed: 2 });
  assert.deepStrictEqual(L.TK_manageCounts(null), { all: 0, active: 0, archived: 0, trashed: 0 });
});
t("manageFilterRows filters by tab and query", () => {
  assert.deepStrictEqual(L.TK_manageFilterRows(MR, { filter: "all" }).map((r) => r.id), ["p1", "p2"]);
  assert.deepStrictEqual(L.TK_manageFilterRows(MR, { filter: "active" }).map((r) => r.id), ["p1"]);
  assert.deepStrictEqual(L.TK_manageFilterRows(MR, { filter: "archived" }).map((r) => r.id), ["p2"]);
  assert.deepStrictEqual(L.TK_manageFilterRows(MR, { filter: "trashed" }).map((r) => r.id), ["p3", "p4"]);
  assert.deepStrictEqual(L.TK_manageFilterRows(MR, { filter: "all", query: "ZETA" }).map((r) => r.id), ["p1"]);
  assert.deepStrictEqual(L.TK_manageFilterRows(MR, { filter: "all", query: "sam@" }).map((r) => r.id), ["p2"]);
  assert.deepStrictEqual(L.TK_manageFilterRows(MR, { filter: "trashed", query: "long" }).map((r) => r.id), ["p4"]);
  assert.deepStrictEqual(L.TK_manageFilterRows(null), []);
});
t("manageActions per state", () => {
  assert.deepStrictEqual(L.TK_manageActions(MR[0]), ["rename", "archive", "trash"]);
  assert.deepStrictEqual(L.TK_manageActions(MR[1]), ["rename", "unarchive", "trash"]);
  assert.deepStrictEqual(L.TK_manageActions(MR[2]), ["restore"]);
  assert.deepStrictEqual(L.TK_manageActions(MR[3]), ["restore"]);
  assert.deepStrictEqual(L.TK_manageActions(null), []);
});
t("manageTrashNote counts days left", () => {
  const now = Date.parse("2026-10-13T12:00:00Z");
  assert.strictEqual(L.TK_manageTrashNote(MR[0], now), "");
  assert.strictEqual(L.TK_manageTrashNote(MR[2], now), "In the trash for 3 days. 27 days left in the usual window.");
  assert.ok(/Past the 30-day mark/.test(L.TK_manageTrashNote(MR[3], now)));
  assert.strictEqual(
    L.TK_manageTrashNote({ state: "trashed", trashed_at: "2026-10-13T01:00:00Z" }, now),
    "Moved to the trash today. 30 days left in the usual window.",
  );
  assert.strictEqual(L.TK_manageTrashNote({ state: "trashed" }, now), "In the trash.");
});
t("manageTrashConfirm names the project and task counts", () => {
  const c = L.TK_manageTrashConfirm(MR[0]);
  assert.ok(c.title.indexOf("Monthly close") >= 0);
  assert.ok(c.body.indexOf("5 tasks (3 open, 2 done)") >= 0);
  assert.ok(/Nothing is deleted/.test(c.body));
  assert.strictEqual(c.confirm, "Move to trash");
  assert.ok(L.TK_manageTrashConfirm({ name: "Empty", open_tasks: 0, done_tasks: 0 }).body.indexOf("disappear from every list") >= 0);
});
t("manageTrashConfirm without counts warns about other people's tasks", () => {
  const b = L.TK_manageTrashConfirm({ name: "Unknown" }).body;
  assert.ok(/all its tasks, including other people's/.test(b));
  assert.ok(/Nothing is deleted/.test(L.TK_manageTrashConfirm({ name: "Unknown" }).body));
});
t("manageTrashConfirm says how many tasks belong to other people", () => {
  const some = L.TK_manageTrashConfirm({ name: "P", open_tasks: 3, done_tasks: 1, other_tasks: 2 }).body;
  assert.ok(/4 tasks \(3 open, 1 done\)/.test(some) && /2 of them belong to other people/.test(some));
  assert.ok(/All of them belong to other people/.test(L.TK_manageTrashConfirm({ name: "P", open_tasks: 1, done_tasks: 1, other_tasks: 2 }).body));
  assert.ok(/1 of them belongs to other people/.test(L.TK_manageTrashConfirm({ name: "P", open_tasks: 2, done_tasks: 1, other_tasks: 1 }).body));
  assert.ok(!/other people/.test(L.TK_manageTrashConfirm({ name: "P", open_tasks: 2, done_tasks: 1, other_tasks: 0 }).body));
});
t("restore into a taken name has its own message", () => {
  const m = L.TK_manageErrorText({ reason: "tk_restore_name_taken" });
  assert.ok(/Rename or archive the active project with this name first/.test(m));
  assert.notStrictEqual(m, L.TK_manageErrorText({ reason: "tk_name_taken" }));
});
t("person lists remember Group by apart from My Tasks", () => {
  assert.strictEqual(L.TK_groupByKey("a@x.org"), "mgb_tk_groupby_v1:a@x.org");
  assert.strictEqual(L.TK_groupByKey("a@x.org", "person"), "mgb_tk_groupby_v1:person:a@x.org");
  assert.notStrictEqual(L.TK_groupByKey("a@x.org"), L.TK_groupByKey("a@x.org", "person"));
  assert.strictEqual(L.TK_groupByKey(null, "person"), "mgb_tk_groupby_v1:person:");
});
t("manageErrorText maps the server reasons", () => {
  assert.ok(/already a project/.test(L.TK_manageErrorText({ reason: "tk_name_taken" })));
  assert.ok(/1 to 120/.test(L.TK_manageErrorText({ reason: "tk_bad_name" })));
  assert.ok(/waiting on a client/.test(L.TK_manageErrorText({ reason: "tk_has_open_requests" })));
  assert.ok(/30 days/.test(L.TK_manageErrorText({ reason: "tk_trash_expired" })));
  assert.ok(/Couldn't save/.test(L.TK_manageErrorText(null)));
});

// ---- With TK_logic loaded (the browser order) -------------------------------------------
t("works with TK_logic globals present", () => {
  let logic = null;
  try {
    logic = require("./TK_logic.js");
  } catch (e) {
    logic = null;
  }
  if (!logic) return;
  global.TK_compareTasks = logic.TK_compareTasks;
  global.TK_CLIENT_SECTION_ORDER = logic.TK_CLIENT_SECTION_ORDER;
  global.TK_isOldDone = logic.TK_isOldDone;
  try {
    const rows = [tk("a", { due_date: "2026-10-03" }), tk("b", { due_date: "2026-10-01" })];
    assert.deepStrictEqual(
      L.TK_sortTasks(rows, null).map((x) => x.id),
      ["b", "a"],
    );
    const g = L.TK_groupBySection([tk("1", { section: "Monthly" }), tk("2", { section: "Weekly" })], { kind: "client" });
    assert.strictEqual(g.length, 2);
    const kept = L.TK_applyFilters([tk("old", { status: "done", done: true, completed_at: "2024-01-01T00:00:00Z" })], { showDone: true, today: "2026-10-11" });
    assert.strictEqual(kept.length, 0);
  } finally {
    delete global.TK_compareTasks;
    delete global.TK_CLIENT_SECTION_ORDER;
    delete global.TK_isOldDone;
  }
});

// ---- Subtasks inline ------------------------------------------------------------------
const sub = (id, parent, extra) => Object.assign({ id, parent_id: parent, text: "sub " + id, status: "todo", done: false }, extra || {});
t("subIndex groups by parent, in sort_key then created_at order", () => {
  const idx = L.TK_subIndex([
    tk("p"),
    sub("c3", "p", { sort_key: null, created_at: "2026-01-03" }),
    sub("c2", "p", { sort_key: "b", created_at: "2026-01-01" }),
    sub("c1", "p", { sort_key: "a", created_at: "2026-01-02" }),
    sub("d1", "q", { created_at: "2026-01-01" }),
  ]);
  assert.deepStrictEqual(idx.p.map((x) => x.id), ["c1", "c2", "c3"]);
  assert.deepStrictEqual(idx.q.map((x) => x.id), ["d1"]);
  assert.strictEqual(idx.zzz, undefined);
});
t("subIndex leaves out deleted, self-parented and top-level rows", () => {
  const idx = L.TK_subIndex([
    tk("p"),
    sub("gone", "p", { deleted_at: "2026-10-01T00:00:00Z" }),
    sub("self", "self"),
    sub("ok", "p"),
    null,
    { id: undefined, parent_id: "p" },
    sub("blank", ""),
  ]);
  assert.deepStrictEqual(idx.p.map((x) => x.id), ["ok"]);
  assert.strictEqual(Object.keys(idx).length, 1);
});
t("subIndex keeps the last copy of an id and tolerates bad input", () => {
  const idx = L.TK_subIndex([sub("a", "p", { text: "old" }), sub("a", "p", { text: "new" })]);
  assert.strictEqual(idx.p.length, 1);
  assert.strictEqual(idx.p[0].text, "new");
  assert.deepStrictEqual(L.TK_subIndex(null), {});
  assert.deepStrictEqual(L.TK_subIndex("x"), {});
});
t("subIndex drops a subtask whose newest copy is deleted (trashed project)", () => {
  const idx = L.TK_subIndex([sub("a", "p"), sub("a", "p", { deleted_at: "2026-10-16T00:00:00Z" })]);
  assert.deepStrictEqual(idx, {});
});
t("subCount counts done by status, with the done flag as fallback", () => {
  assert.deepStrictEqual(L.TK_subCount([sub("1", "p", { status: "done" }), sub("2", "p"), sub("3", "p", { status: undefined, done: true })]), { done: 2, total: 3 });
  assert.deepStrictEqual(L.TK_subCount([]), { done: 0, total: 0 });
  assert.deepStrictEqual(L.TK_subCount(null), { done: 0, total: 0 });
});
t("subChipText and subToggleLabel", () => {
  assert.strictEqual(L.TK_subChipText({ done: 2, total: 5 }), "2/5");
  assert.strictEqual(L.TK_subChipText({ done: 0, total: 0 }), "");
  assert.strictEqual(L.TK_subChipText(null), "");
  assert.strictEqual(L.TK_subToggleLabel("File taxes", { done: 2, total: 5 }, false), "Show 5 subtasks of File taxes, 2 of 5 done");
  assert.strictEqual(L.TK_subToggleLabel("File taxes", { done: 0, total: 1 }, true), "Hide 1 subtask of File taxes, 0 of 1 done");
  assert.strictEqual(L.TK_subToggleLabel("", { done: 0, total: 2 }, false), "Show 2 subtasks of this task, 0 of 2 done");
});
t("subNestGroups hides a subtask only when its parent is in the same group and lists it", () => {
  const p = tk("p");
  const a = sub("a", "p");
  const b = sub("b", "p");
  const other = sub("o", "elsewhere");
  const kids = L.TK_subIndex([a, b, other]);
  const groups = [
    { key: "today", label: "Today", tasks: [p, a, other, tk("x")] },
    { key: "later", label: "Later", tasks: [b, tk("y")] },
  ];
  const out = L.TK_subNestGroups(groups, kids);
  assert.deepStrictEqual(out[0].tasks.map((x) => x.id), ["p", "o", "x"]);
  assert.strictEqual(out[0].key, "today");
  assert.strictEqual(out[0].label, "Today");
  // b's parent is in another group: it keeps its own row, so it is not lost
  assert.deepStrictEqual(out[1].tasks.map((x) => x.id), ["b", "y"]);
  assert.strictEqual(out[1], groups[1]);
  // input untouched
  assert.strictEqual(groups[0].tasks.length, 4);
});
t("subNestGroups keeps a subtask the parent does not list, and tolerates odd input", () => {
  const p = tk("p");
  const a = sub("a", "p");
  const out = L.TK_subNestGroups([{ key: "k", tasks: [p, a] }], {});
  assert.deepStrictEqual(out[0].tasks.map((x) => x.id), ["p", "a"]);
  assert.deepStrictEqual(L.TK_subNestGroups(null, {}), []);
  assert.deepStrictEqual(L.TK_subNestGroups([null, { key: "n" }], null), [null, { key: "n" }]);
});
t("subNestGroups feeds focusIds only the visible rows", () => {
  const p = tk("p");
  const a = sub("a", "p");
  const view = L.TK_subNestGroups([{ key: "g", collapsed: false, tasks: [p, a, tk("z")] }], L.TK_subIndex([a]));
  assert.deepStrictEqual(L.TK_focusIds(view), ["p", "z"]);
});
t("subRowClickAction: body toggles when there are subtasks, else opens; title and controls do nothing here", () => {
  assert.strictEqual(L.TK_subRowClickAction(true, "body"), "toggle");
  assert.strictEqual(L.TK_subRowClickAction(false, "body"), "open");
  assert.strictEqual(L.TK_subRowClickAction(true, "title"), "none");
  assert.strictEqual(L.TK_subRowClickAction(false, "title"), "none");
  assert.strictEqual(L.TK_subRowClickAction(true, "interactive"), "none");
  assert.strictEqual(L.TK_subRowClickAction(false, "interactive"), "none");
});
t("subKeyAction: right opens, left closes, only with subtasks", () => {
  assert.strictEqual(L.TK_subKeyAction("ArrowRight", true, false), "expand");
  assert.strictEqual(L.TK_subKeyAction("ArrowRight", true, true), null);
  assert.strictEqual(L.TK_subKeyAction("ArrowLeft", true, true), "collapse");
  assert.strictEqual(L.TK_subKeyAction("ArrowLeft", true, false), null);
  assert.strictEqual(L.TK_subKeyAction("ArrowRight", false, false), null);
  assert.strictEqual(L.TK_subKeyAction("Enter", true, false), null);
});
t("subOpenRead keeps only true ids and survives bad storage", () => {
  assert.deepStrictEqual(L.TK_subOpenRead({ a: true, b: false, c: 1, d: "yes" }), { a: true });
  assert.deepStrictEqual(L.TK_subOpenRead(null), {});
  assert.deepStrictEqual(L.TK_subOpenRead([1, 2]), {});
  assert.deepStrictEqual(L.TK_subOpenRead("x"), {});
});
t("subOpenToggle opens, closes and caps the saved ids", () => {
  let m = L.TK_subOpenToggle({}, "a");
  assert.deepStrictEqual(m, { a: true });
  m = L.TK_subOpenToggle(m, "b");
  assert.deepStrictEqual(Object.keys(m), ["a", "b"]);
  m = L.TK_subOpenToggle(m, "a");
  assert.deepStrictEqual(m, { b: true });
  const capped = L.TK_subOpenToggle({ x: true, y: true, z: true }, "w", 3);
  assert.deepStrictEqual(Object.keys(capped), ["y", "z", "w"]);
  assert.deepStrictEqual(L.TK_subOpenToggle(null, 7), { 7: true });
  assert.ok(L.TK_SUBS_OPEN_KEY.indexOf("mgb_tk_") === 0, "the key is under the mgb_tk_ prefix so Dev Tools reset finds it");
});

// ---- Project colors ----------------------------------------------------------------------
t("palette has ten unique, lower-case keys with labels", () => {
  const keys = L.TK_projectColorKeys();
  assert.strictEqual(keys.length, 10);
  assert.strictEqual(new Set(keys).size, 10);
  keys.forEach((k) => assert.ok(/^[a-z]+$/.test(k)));
  L.TK_PROJECT_COLORS.forEach((c) => assert.ok(c.label && c.label[0] === c.label[0].toUpperCase()));
});
t("palette matches the database list in tasks-p3-project-colors.sql", () => {
  const fs = require("fs");
  const path = require("path");
  const sql = fs.readFileSync(path.join(__dirname, "../../supabase/tasks-p3-project-colors.sql"), "utf8");
  const lists = sql.match(/array\[('[a-z]+'(?:\s*,\s*'[a-z]+')+)\]/g) || [];
  assert.ok(lists.length >= 3, "the SQL carries the palette in several places");
  const wanted = L.TK_projectColorKeys().join(",");
  lists.forEach((l) => assert.strictEqual(l.replace(/array\[|\]|'|\s/g, ""), wanted));
  const check = /check \(color in \(([^)]*)\)\)/.exec(sql);
  assert.ok(check);
  assert.strictEqual(check[1].replace(/'|\s/g, ""), wanted);
});
t("isProjectColor accepts only palette keys", () => {
  assert.strictEqual(L.TK_isProjectColor("teal"), true);
  assert.strictEqual(L.TK_isProjectColor("Teal"), false);
  assert.strictEqual(L.TK_isProjectColor("magenta"), false);
  assert.strictEqual(L.TK_isProjectColor(""), false);
  assert.strictEqual(L.TK_isProjectColor(null), false);
  assert.strictEqual(L.TK_isProjectColor(3), false);
});
t("projectColorOf uses a valid color, else a stable pick from the id, else gray", () => {
  assert.strictEqual(L.TK_projectColorOf({ id: "1", color: "coral" }), "coral");
  const a = L.TK_projectColorOf({ id: "abc-123", color: "nope" });
  assert.ok(L.TK_isProjectColor(a));
  assert.strictEqual(L.TK_projectColorOf({ id: "abc-123" }), a);
  assert.strictEqual(L.TK_projectColorOf({ id: "abc-123", color: null }), a);
  assert.strictEqual(L.TK_projectColorOf(null), "gray");
  assert.strictEqual(L.TK_projectColorOf({}), "gray");
  // a spread of ids reaches more than one color
  const seen = new Set();
  for (let i = 0; i < 40; i++) seen.add(L.TK_projectColorOf({ id: "id-" + i }));
  assert.ok(seen.size > 3);
});
t("projectColorById finds a project, and shows nothing for a task outside any", () => {
  const ps = [{ id: "p1", color: "teal" }, { id: "p2", color: "olive" }];
  assert.strictEqual(L.TK_projectColorById(ps, "p2"), "olive");
  assert.strictEqual(L.TK_projectColorById(ps, "nope"), "");
  assert.strictEqual(L.TK_projectColorById(ps, null), "");
  assert.strictEqual(L.TK_projectColorById(null, "p1"), "");
});
t("projectColorLabel and projectColorError", () => {
  assert.strictEqual(L.TK_projectColorLabel("coral"), "Coral");
  assert.strictEqual(L.TK_projectColorLabel("zzz"), "Gray");
  assert.ok(/isn't one of the choices/.test(L.TK_projectColorError({ code: "tk_bad_color" })));
  assert.ok(/trash/.test(L.TK_projectColorError({ reason: "tk_project_trashed" })));
  assert.ok(/can't change/.test(L.TK_projectColorError({ code: "tk_forbidden" })));
  assert.ok(/offline/.test(L.TK_projectColorError({ code: "tk_offline" })));
  assert.ok(/Couldn't save/.test(L.TK_projectColorError(null)));
});

// ---- Multi-select + bulk results (P4-3) ---------------------------------------
t("v and Shift+V map to select; the handler passes shift", () => {
  assert.strictEqual(L.TK_listKeyAction("v"), "select");
  assert.strictEqual(L.TK_listKeyAction("V"), "select");
  assert.strictEqual(L.TK_listKeyAction("x"), "toggle", "x stays mark done");
  assert.strictEqual(L.TK_listKeyAction("s"), "status", "s stays status");
  assert.strictEqual(L.TK_listKeyAction("z"), null, "z is not taken by this slice");
  const calls = [];
  const mk = (focusedId, onSelect) =>
    L.TK_makeListKeyHandler({ getState: () => ({ ids: ["a", "b"], focusedId }), onSelect });
  const ev = (key, extra) => Object.assign({ key, target: { tagName: "DIV", getAttribute: () => null }, preventDefault() { this.prevented = true; } }, extra || {});
  const e1 = ev("v");
  mk("a", (id, shift) => calls.push([id, shift]))(e1);
  const e2 = ev("V", { shiftKey: true });
  mk("b", (id, shift) => calls.push([id, shift]))(e2);
  assert.deepStrictEqual(calls, [["a", false], ["b", true]]);
  assert.ok(e1.prevented && e2.prevented);
  const e3 = ev("v");
  mk(null, (id) => calls.push([id]))(e3);
  assert.strictEqual(calls.length, 2, "no focused row, nothing selected");
  assert.ok(!e3.prevented);
  const e4 = ev("v");
  mk("a", undefined)(e4);
  assert.ok(!e4.prevented, "a list without selection leaves v alone");
});

t("selToggle: click toggles, shift selects a range from the anchor", () => {
  const order = ["a", "b", "c", "d", "e"];
  let s = L.TK_selEmpty();
  s = L.TK_selToggle(s, "b", order, false);
  assert.deepStrictEqual(L.TK_selList(s, order), ["b"]);
  assert.strictEqual(s.anchor, "b");
  s = L.TK_selToggle(s, "d", order, true);
  assert.deepStrictEqual(L.TK_selList(s, order), ["b", "c", "d"]);
  assert.strictEqual(s.anchor, "b", "a range keeps the anchor");
  s = L.TK_selToggle(s, "a", order, true);
  assert.deepStrictEqual(L.TK_selList(s, order), ["a", "b", "c", "d"], "a range upward adds, never clears");
  s = L.TK_selToggle(s, "c", order, false);
  assert.deepStrictEqual(L.TK_selList(s, order), ["a", "b", "d"]);
  assert.strictEqual(s.anchor, "c");
  assert.strictEqual(L.TK_selCount(s), 3);
  assert.ok(L.TK_selHas(s, "a") && !L.TK_selHas(s, "c") && !L.TK_selHas(s, "toString"));
  // Shift with no anchor on the list is a plain toggle.
  const s2 = L.TK_selToggle({ ids: {}, anchor: "gone" }, "e", order, true);
  assert.deepStrictEqual(L.TK_selList(s2, order), ["e"]);
  // The cap.
  let c = L.TK_selEmpty();
  c = L.TK_selToggle(c, "a", order, false, 2);
  c = L.TK_selToggle(c, "e", order, true, 2);
  assert.strictEqual(L.TK_selCount(c), 2);
  const same = L.TK_selToggle(c, "e", order, false, 2);
  assert.strictEqual(L.TK_selCount(same), 2, "a click past the cap adds nothing");
});

t("selPrune drops rows that left the list and keeps identity when nothing changed", () => {
  let s = L.TK_selEmpty();
  s = L.TK_selToggle(s, "a", ["a", "b"], false);
  s = L.TK_selToggle(s, "b", ["a", "b"], false);
  assert.strictEqual(L.TK_selPrune(s, ["a", "b", "c"]), s);
  const p = L.TK_selPrune(s, ["a"]);
  assert.deepStrictEqual(L.TK_selList(p, ["a"]), ["a"]);
  assert.strictEqual(p.anchor, null, "the anchor (b) left");
  assert.deepStrictEqual(L.TK_selList(L.TK_selPrune(null, ["a"]), []), []);
  // Off-list picks still come back from selList (after the ordered ones).
  assert.deepStrictEqual(L.TK_selList({ ids: { z: true, a: true }, anchor: null }, ["a"]), ["a", "z"]);
});

t("a selection pruned to the rows on screen drops collapsed and hidden rows", () => {
  // a, b in an open group; c in a group that gets collapsed; d done and hidden
  const view = [
    { key: "g1", tasks: [{ id: "a" }, { id: "b" }] },
    { key: "g2", collapsed: true, tasks: [{ id: "c" }] },
  ];
  const onScreen = L.TK_focusIds(view);
  assert.deepStrictEqual(onScreen, ["a", "b"]);
  const s = { ids: { a: true, c: true, d: true }, anchor: "c" };
  assert.deepStrictEqual(L.TK_selOnList(s, onScreen), ["a"], "only on-screen rows are acted on");
  const p = L.TK_selPrune(s, onScreen);
  assert.deepStrictEqual(Object.keys(p.ids), ["a"]);
  assert.strictEqual(p.anchor, null);
  assert.deepStrictEqual(L.TK_selOnList(p, onScreen), ["a"]);
  assert.deepStrictEqual(L.TK_selOnList(null, onScreen), []);
  assert.deepStrictEqual(L.TK_selOnList({ ids: { b: true, a: true }, anchor: null }, ["a", "b", "a"]), ["a", "b"], "list order, once each");
});

t("bulkCounts", () => {
  const c = L.TK_bulkCounts([
    { status: "todo" }, { status: "in_progress" }, { status: "done" }, { done: true },
    { status: "ready_for_review" }, { status: "waiting_client" }, null,
  ]);
  assert.deepStrictEqual(c, { total: 6, open: 2, done: 2, review: 1, waiting: 1 });
});

t("bulkReasonText covers every server reason", () => {
  ["no_access", "deleted", "in_trash", "in_review", "waiting_client", "already_done", "not_done",
    "approved_admin_only", "owner_only", "assignee_no_access", "project_client", "project_archived",
    "project_trashed", "no_due_date", "no_change", "has_open_requests", "bad_transition", "changed_since", "error"]
    .forEach((k) => assert.ok(L.TK_bulkReasonText(k) && L.TK_bulkReasonText(k) !== L.TK_BULK_REASONS.error || k === "error", k));
  assert.ok(/Review/.test(L.TK_bulkReasonText("in_review")));
  assert.strictEqual(L.TK_bulkReasonText("toString"), L.TK_BULK_REASONS.error);
  assert.strictEqual(L.TK_bulkReasonText(null), L.TK_BULK_REASONS.error);
  assert.ok(!/colour/i.test(JSON.stringify(L.TK_BULK_REASONS)));
});

t("bulkSummary: plain, mixed, all skipped", () => {
  assert.strictEqual(L.TK_bulkSummary("complete", { done: ["1", "2", "3", "4", "5", "6", "7"], review: [], skipped: [] }), "7 tasks completed.");
  assert.strictEqual(L.TK_bulkSummary("complete", { done: ["1"], review: [], skipped: [] }), "1 task completed.");
  assert.strictEqual(
    L.TK_bulkSummary("complete", { done: ["1", "2", "3", "4", "5"], review: ["6"], skipped: [{ id: "7" }, { id: "8" }] }),
    "5 completed, 1 sent for review, 2 skipped.",
  );
  assert.strictEqual(L.TK_bulkSummary("complete", { done: [], review: ["1"], skipped: [] }), "1 sent for review.");
  assert.strictEqual(L.TK_bulkSummary("delete", { done: [], skipped: [{}, {}, {}] }), "Nothing changed: 3 skipped.");
  assert.strictEqual(L.TK_bulkSummary("reassign", { done: ["1", "2"], skipped: [{}] }), "2 reassigned, 1 skipped.");
  assert.strictEqual(L.TK_bulkSummary("set_due", { done: ["1", "2"] }), "2 tasks rescheduled.");
  assert.strictEqual(L.TK_bulkSummary("move_project", {}), "Nothing changed.");
});

t("undoSummary: changed rows, kept repeats, already emailed", () => {
  assert.strictEqual(L.TK_undoSummary({ done: ["1"], skipped: [] }), "Undone.");
  assert.strictEqual(L.TK_undoSummary({ done: [], skipped: [{ id: "1" }] }), "Couldn't undo: the task changed since.");
  assert.strictEqual(
    L.TK_undoSummary({ done: ["1"], skipped: [{ id: "2" }, { id: "3" }] }),
    "Undone. 2 tasks changed since and stayed as they are.",
  );
  assert.strictEqual(
    L.TK_undoSummary({ done: ["1"], skipped: [], spawnedKept: ["s"], alreadyEmailed: ["Ann"] }),
    "Undone. The next repeat was kept because someone used it. Ann was already emailed.",
  );
  assert.ok(/Ann, Bo and Cy were already emailed\.$/.test(L.TK_undoSummary({ done: ["1"], alreadyEmailed: ["Ann", "Bo", "Cy"] })));
});

t("skipGroups groups by reason, biggest first, with names", () => {
  const names = { a: "Payroll", b: "Bank rec", c: "Close" };
  const g = L.TK_skipGroups(
    [{ id: "a", reason: "in_review" }, { id: "b", reason: "waiting_client" }, { id: "c", reason: "waiting_client" }, { id: "x" }],
    (id) => names[id],
  );
  assert.deepStrictEqual(g.map((x) => x.reason), ["waiting_client", "in_review", "error"]);
  assert.deepStrictEqual(g[0].items.map((x) => x.name), ["Bank rec", "Close"]);
  assert.strictEqual(g[2].items[0].name, "A task");
  assert.deepStrictEqual(L.TK_skipGroups(null), []);
});

t("isUndoKey: Ctrl/Cmd+Z only, never while typing", () => {
  const div = { tagName: "DIV", getAttribute: () => null };
  assert.ok(L.TK_isUndoKey({ key: "z", ctrlKey: true, target: div }));
  assert.ok(L.TK_isUndoKey({ key: "z", metaKey: true, target: div }));
  assert.ok(L.TK_isUndoKey({ key: "Z", metaKey: true, target: null }));
  assert.ok(!L.TK_isUndoKey({ key: "z", target: div }), "plain z");
  assert.ok(!L.TK_isUndoKey({ key: "z", metaKey: true, shiftKey: true, target: div }), "redo");
  assert.ok(!L.TK_isUndoKey({ key: "z", ctrlKey: true, altKey: true, target: div }));
  assert.ok(!L.TK_isUndoKey({ key: "y", ctrlKey: true, target: div }));
  ["INPUT", "TEXTAREA", "SELECT"].forEach((tag) =>
    assert.ok(!L.TK_isUndoKey({ key: "z", metaKey: true, target: { tagName: tag, getAttribute: () => null } }), tag));
  assert.ok(!L.TK_isUndoKey({ key: "z", metaKey: true, target: { tagName: "DIV", isContentEditable: true, getAttribute: () => null } }));
  assert.ok(!L.TK_isUndoKey({ key: "z", metaKey: true, target: { tagName: "DIV", getAttribute: (a) => (a === "contenteditable" ? "true" : null) } }));
  assert.ok(!L.TK_isUndoKey({ key: "z", metaKey: true, target: { tagName: "DIV", getAttribute: (a) => (a === "role" ? "textbox" : null) } }));
  assert.ok(!L.TK_isUndoKey(null));
  // a checkbox or radio has no text to undo
  assert.ok(L.TK_isUndoKey({ key: "z", metaKey: true, target: { tagName: "INPUT", type: "checkbox", getAttribute: () => null } }), "checkbox");
  assert.ok(L.TK_isUndoKey({ key: "z", ctrlKey: true, target: { tagName: "INPUT", getAttribute: (a) => (a === "type" ? "radio" : null) } }), "radio");
  assert.ok(!L.TK_isUndoKey({ key: "z", metaKey: true, target: { tagName: "INPUT", type: "text", getAttribute: () => null } }), "text input");
});

t("bulkDuePatch", () => {
  assert.deepStrictEqual(L.TK_bulkDuePatch("date", "2026-10-20"), { due_date: "2026-10-20" });
  assert.strictEqual(L.TK_bulkDuePatch("date", "10/20/2026"), null);
  assert.deepStrictEqual(L.TK_bulkDuePatch("clear"), { due_date: null });
  assert.deepStrictEqual(L.TK_bulkDuePatch("shift", "7"), { due_shift_days: 7 });
  assert.deepStrictEqual(L.TK_bulkDuePatch("shift", -1), { due_shift_days: -1 });
  assert.strictEqual(L.TK_bulkDuePatch("shift", 0), null);
  assert.strictEqual(L.TK_bulkDuePatch("shift", 400), null);
  assert.strictEqual(L.TK_bulkDuePatch("nope", 1), null);
});

// ---- Slate view: Group by, Sort, quick chips, saved view (rhythm slice 0) ----------
{
  const LG = require("./TK_logic.js");
  const TODAY = "2026-10-21";
  const ME = "me@example.com";
  const mk = (id, o) => Object.assign({ id, text: "Task " + id, status: "todo", assignee_email: ME, staff_email: ME, priority: "normal", created_at: "2026-10-01T00:00:00Z" }, o || {});
  const tasks = [
    mk("a", { due_date: "2026-10-18", client_id: "c2", section: "Send reports", priority: "low" }),
    mk("b", { due_date: "2026-10-21", client_id: "c1", section: "check in" }),
    mk("c", { due_date: "2026-10-24", client_id: "c1", section: "Follow up", text: "Alpha" }),
    mk("d", { due_date: "2026-12-01", client_id: "c2", section: "Monthly", priority: "high" }),
    mk("e", { due_date: "2026-10-10", client_id: "c1", status: "waiting_client", section: "Check in" }),
    mk("f", { due_date: "2026-10-20", client_id: "c1", status: "done", done: true, completed_at: "2026-10-20T10:00:00Z" }),
    mk("g", { due_date: "2026-10-19", client_id: "c3", assignee_email: null, staff_email: ME }),
    mk("h", { due_date: null, client_id: null, section: "Zebra" }),
    mk("i", { due_date: "2026-10-21", client_id: "c2", status: "in_progress", template_id: "tpl1" }),
  ];
  const clients = [{ id: "c1", name: "Beta Co" }, { id: "c2", name: "Acme" }, { id: "c3", name: "Test Co", testOnly: true }];
  const groups = LG.TK_groupMyTasks(tasks, TODAY, { email: ME, todayGroup: true });
  const ids = (gs) => gs.map((g) => [g.key, g.tasks.map((x) => x.id)]);

  t("slate view normalize and read", () => {
    assert.deepStrictEqual(L.TK_normalizeSlateView(null), { groupBy: "due", sort: null, chip: "" });
    assert.deepStrictEqual(L.TK_normalizeSlateView({ groupBy: "nope", sort: { col: "assignee" }, chip: "x" }), { groupBy: "due", sort: null, chip: "" });
    assert.deepStrictEqual(L.TK_normalizeSlateView({ groupBy: "part", sort: { col: "priority", dir: "desc" }, chip: "waiting" }), { groupBy: "part", sort: { col: "priority", dir: "desc" }, chip: "waiting" });
    assert.deepStrictEqual(L.TK_normalizeSlateView({ sort: { col: "due", dir: "weird" } }).sort, { col: "due", dir: "asc" });
    assert.deepStrictEqual(L.TK_slateViewRead(null, "client"), { groupBy: "client", sort: null, chip: "" });
    assert.deepStrictEqual(L.TK_slateViewRead(null, null), { groupBy: "due", sort: null, chip: "" });
    assert.deepStrictEqual(L.TK_slateViewRead({ groupBy: "status" }, "client").groupBy, "status", "a saved view wins over the old choice");
    assert.deepStrictEqual(L.TK_slateViewRead([], "client").groupBy, "client");
    assert.ok(L.TK_isDefaultSlateView({}));
    assert.ok(!L.TK_isDefaultSlateView({ chip: "waiting" }));
    assert.ok(!L.TK_isDefaultSlateView({ groupBy: "client" }));
    assert.ok(!L.TK_isDefaultSlateView({ sort: { col: "due" } }));
  });

  t("slate view keys share the mgb_tk_ prefix", () => {
    assert.strictEqual(L.TK_slateViewKey("Me@Example.com"), "mgb_tk_slate_view_v1:me@example.com");
    assert.strictEqual(L.TK_slateViewKey(ME, "desk"), "mgb_tk_slate_view_v1:desk:me@example.com");
    assert.ok(L.TK_slateViewKey(ME).startsWith("mgb_tk_"));
    // every sort chip is a real sort column
    L.TK_SLATE_SORTS.forEach((s) => assert.ok(L.TK_SORT_COLS.indexOf(s.col) >= 0, s.col));
  });

  t("default view is exactly TK_myGroupsView", () => {
    const col = { later: true };
    [true, false].forEach((showDone) => {
      const want = L.TK_myGroupsView(groups, { collapsed: col, showDone });
      const got = L.TK_slateBuildView(groups, null, { collapsed: col, showDone, email: ME, today: TODAY, clients });
      assert.deepStrictEqual(got.groups, want);
      assert.strictEqual(got.byDue, true);
    });
  });

  t("client with no chip or sort is exactly the old client path", () => {
    const want = L.TK_groupByClient(L.TK_flattenMyGroups(groups, { showDone: true }), { clients, collapsed: {}, flagOf: undefined });
    const got = L.TK_slateBuildView(groups, { groupBy: "client" }, { collapsed: {}, showDone: true, clients });
    assert.deepStrictEqual(got.groups, want);
    assert.strictEqual(got.byDue, false);
  });

  t("chip Mine today: mine, open, not waiting, due today or earlier", () => {
    const got = L.TK_slateApplyChip(tasks, "mine_today", { email: ME, today: TODAY }).map((x) => x.id);
    assert.deepStrictEqual(got, ["a", "b", "i"]);
    assert.ok(!L.TK_slateChipMatch(tasks[4], "mine_today", { email: ME, today: TODAY }), "waiting never counts as today's work");
    assert.ok(!L.TK_slateChipMatch(tasks[1], "mine_today", { email: "", today: TODAY }), "no email, no match");
    assert.ok(!L.TK_slateChipMatch(tasks[1], "mine_today", { email: ME }), "no today, no match");
  });

  t("chip Waiting on client: status waiting_client", () => {
    assert.deepStrictEqual(L.TK_slateApplyChip(tasks, "waiting", {}).map((x) => x.id), ["e"]);
    assert.strictEqual(L.TK_slateApplyChip(tasks, "", {}), tasks, "no chip: same array");
    assert.strictEqual(L.TK_slateApplyChip(tasks, "bogus", {}), tasks);
  });

  t("chip inside the due grouping drops empty groups", () => {
    const got = L.TK_slateBuildView(groups, { chip: "mine_today" }, { showDone: true, email: ME, today: TODAY });
    assert.deepStrictEqual(ids(got.groups), [["overdue", ["a"]], ["today", ["b", "i"]]]);
    const w = L.TK_slateBuildView(groups, { chip: "waiting", groupBy: "client" }, { showDone: true, clients });
    assert.deepStrictEqual(ids(w.groups), [["client:c1", ["e"]]]);
  });

  t("part of month: rhythm order, then sections, then No part", () => {
    const got = L.TK_groupByPart(tasks, { templates: { tpl1: { section: "Send reports" } } });
    assert.deepStrictEqual(ids(got), [
      ["part:check in", ["b", "e"]],
      ["part:send reports", ["a", "i"]],
      ["part:follow up", ["c"]],
      ["part:monthly", ["d"]],
      ["part:zebra", ["h"]],
      [L.TK_NO_PART_KEY, ["f", "g"]],
    ]);
    assert.strictEqual(got[0].label, "Check in", "the rhythm's own spelling wins");
    assert.strictEqual(got[got.length - 1].label, "No part");
    // without the template lookup the template task falls to No part
    const bare = L.TK_groupByPart(tasks, {});
    assert.deepStrictEqual(bare[bare.length - 1].tasks.map((x) => x.id), ["f", "g", "i"]);
    // a firm's own parts list
    const own = L.TK_groupByPart(tasks, { parts: ["Follow up", "Check in"] });
    assert.deepStrictEqual(own.slice(0, 2).map((g) => g.key), ["part:follow up", "part:check in"]);
    assert.strictEqual(L.TK_rhythmPartOf({ section: "  ", template_id: "x" }, { templateSectionOf: () => " Follow up " }), "Follow up");
    assert.strictEqual(L.TK_rhythmPartOf(null), "");
    assert.deepStrictEqual(L.TK_groupByPart([], {}), []);
    assert.strictEqual(L.TK_groupByPart(tasks, { collapsed: { "part:follow up": true } })[2].collapsed, true);
  });

  t("status grouping: workflow order, Done folded", () => {
    const got = L.TK_groupByStatus(tasks, {});
    assert.deepStrictEqual(got.map((g) => g.key), ["status:todo", "status:in_progress", "status:waiting_client", "status:done"]);
    assert.deepStrictEqual(got.map((g) => g.label), ["To do", "In progress", "Waiting on client", "Done"]);
    assert.strictEqual(got[3].collapsed, true);
    assert.strictEqual(got[0].collapsed, false);
    assert.strictEqual(L.TK_groupByStatus(tasks, { collapsed: { "status:done": false } })[3].collapsed, false);
  });

  t("sort inside groups; no sort returns the same groups", () => {
    const base = L.TK_slateBuildView(groups, { groupBy: "client" }, { showDone: false, clients });
    const same = L.TK_slateSortWithin(base.groups, null);
    assert.strictEqual(same, base.groups);
    const byName = L.TK_slateBuildView(groups, { groupBy: "client", sort: { col: "task", dir: "asc" } }, { showDone: false, clients });
    const c1 = byName.groups.filter((g) => g.key === "client:c1")[0];
    assert.deepStrictEqual(c1.tasks.map((x) => x.id), ["c", "b", "e"]);
    const pri = L.TK_slateBuildView(groups, { groupBy: "status", sort: { col: "priority", dir: "asc" } }, { showDone: false });
    // high first, then normal in the default order (due date, undated last), low last
    assert.deepStrictEqual(pri.groups[0].tasks.map((x) => x.id), ["d", "g", "b", "c", "h", "a"]);
    const desc = L.TK_slateBuildView(groups, { groupBy: "status", sort: { col: "priority", dir: "desc" } }, { showDone: false });
    assert.strictEqual(desc.groups[0].tasks[0].id, "a", "descending puts low first");
  });

  t("skipUnassigned (Desk) leaves Unassigned out of every grouping", () => {
    ["due", "client", "part", "status"].forEach((gb) => {
      const got = L.TK_slateBuildView(groups, { groupBy: gb }, { showDone: false, skipUnassigned: true, clients });
      got.groups.forEach((g) => g.tasks.forEach((x) => assert.notStrictEqual(x.id, "g", gb)));
    });
    // default + skipUnassigned equals TK_myGroupsView without the unassigned group
    const g2 = Object.assign({}, groups, { unassigned: [] });
    assert.deepStrictEqual(L.TK_slateBuildView(groups, null, { showDone: false, skipUnassigned: true }).groups, L.TK_myGroupsView(g2, { showDone: false }));
  });

  t("bulk ids walk every grouping", () => {
    ["due", "client", "part", "status"].forEach((gb) => {
      const got = L.TK_slateBuildView(groups, { groupBy: gb }, { showDone: true, clients, collapsed: {} });
      const walk = L.TK_focusIds(got.groups);
      assert.ok(walk.length > 0, gb);
      const sel = L.TK_selToggle(L.TK_selEmpty(), walk[0], walk, false);
      assert.deepStrictEqual(L.TK_selOnList(sel, walk), [String(walk[0])], gb);
    });
  });
}

// ---- Slate app (S1): flag helper ----------------------------------------------------
t("slateAppIsOn: firm switch values", () => {
  [true, "true", 1, { on: true }].forEach((v) => assert.strictEqual(L.TK_slateAppIsOn(v, null, false), true, JSON.stringify(v)));
  [undefined, null, false, "false", 0, "", "on", "1", "yes", { on: false }, {}].forEach((v) =>
    assert.strictEqual(L.TK_slateAppIsOn(v, null, false), false, JSON.stringify(v)),
  );
});
t("slateAppIsOn: the string on is not on", () => {
  assert.strictEqual(L.TK_slateAppIsOn("on", undefined, undefined), false);
  assert.strictEqual(L.TK_slateAppIsOn("on", "on", false), false);
});
t("slateAppIsOn: preview turns it on when the firm switch is off", () => {
  assert.strictEqual(L.TK_slateAppIsOn(undefined, "1", false), true);
  assert.strictEqual(L.TK_slateAppIsOn(false, true, false), true);
  assert.strictEqual(L.TK_slateAppIsOn(undefined, "0", false), false);
  assert.strictEqual(L.TK_slateAppIsOn(undefined, null, false), false);
});
t("slateAppIsOn: classic wins over the switch and the preview", () => {
  assert.strictEqual(L.TK_slateAppIsOn(true, "1", "1"), false);
  assert.strictEqual(L.TK_slateAppIsOn(true, "1", true), false);
  // classic counts only as "1" or true
  [1, "true", "0", "yes", "on", {}, 0, "", null, undefined, false].forEach((c) => assert.strictEqual(L.TK_slateAppIsOn(true, null, c), true, JSON.stringify(c)));
});
t("slate flag names", () => {
  assert.strictEqual(L.TK_SLATE_APP_PREVIEW, "mgb_slate_app_preview");
  assert.strictEqual(L.TK_SLATE_APP_CLASSIC, "mgb_slate_classic");
  assert.strictEqual(L.TK_SLATE_APP_SETTING, "slate_app_enabled");
});

// ---- Slate app (S1): size modes --------------------------------------------------------
const M = (w, h, prev) => L.TK_slateMode(w, h, prev);
const modeOf = (w, h, prev) => M(w, h, prev).mode;
t("slateMode: width edges at a normal height", () => {
  assert.strictEqual(modeOf(299, 600), "sliver");
  assert.strictEqual(modeOf(300, 600), "compact");
  assert.strictEqual(modeOf(719, 600), "compact");
  assert.strictEqual(modeOf(720, 600), "regular");
  assert.strictEqual(modeOf(1099, 600), "regular");
  assert.strictEqual(modeOf(1100, 600), "full");
  assert.strictEqual(modeOf(2560, 1440), "full");
});
t("slateMode: height edge 199/200", () => {
  assert.strictEqual(modeOf(800, 199), "sliver");
  assert.strictEqual(modeOf(800, 200), "regular");
  assert.strictEqual(modeOf(300, 200), "compact");
  assert.strictEqual(modeOf(1400, 199), "sliver");
});
t("slateMode: strip when h < 200, column when w < 300", () => {
  assert.deepStrictEqual(M(360, 140), { mode: "sliver", shape: "strip" });
  assert.deepStrictEqual(M(240, 600), { mode: "sliver", shape: "column" });
  assert.deepStrictEqual(M(299, 200), { mode: "sliver", shape: "column" });
  assert.deepStrictEqual(M(299, 199), { mode: "sliver", shape: "strip" }); // short wins
  assert.deepStrictEqual(M(240, 120), { mode: "sliver", shape: "strip" });
  assert.strictEqual(M(500, 500).shape, null);
});
t("slateMode: hysteresis leaving full and regular", () => {
  assert.strictEqual(modeOf(1090, 800, "full"), "full");
  assert.strictEqual(modeOf(1084, 800, "full"), "full");
  assert.strictEqual(modeOf(1083, 800, "full"), "regular");
  assert.strictEqual(modeOf(1090, 800, "regular"), "regular"); // entering full needs 1100
  assert.strictEqual(modeOf(1100, 800, "regular"), "full");
  assert.strictEqual(modeOf(710, 800, "regular"), "regular");
  assert.strictEqual(modeOf(704, 800, "regular"), "regular");
  assert.strictEqual(modeOf(703, 800, "regular"), "compact");
  assert.strictEqual(modeOf(710, 800, "compact"), "compact"); // no hysteresis going up
  assert.strictEqual(modeOf(710, 800, "full"), "regular"); // a big jump down still holds regular
  assert.strictEqual(modeOf(500, 800, "full"), "compact");
});
t("slateMode: prev as the whole result object works", () => {
  assert.strictEqual(modeOf(1090, 800, { mode: "full", shape: null }), "full");
  assert.strictEqual(modeOf(1090, 800, M(1200, 800)), "full");
});
t("slateMode: hysteresis leaving the sliver", () => {
  assert.strictEqual(modeOf(300, 600, "sliver"), "sliver");
  assert.strictEqual(modeOf(315, 600, "sliver"), "sliver");
  assert.strictEqual(modeOf(316, 600, "sliver"), "compact");
  assert.strictEqual(modeOf(500, 215, "sliver"), "sliver");
  assert.strictEqual(modeOf(500, 216, "sliver"), "compact");
  assert.strictEqual(modeOf(316, 215, "sliver"), "sliver"); // both must clear
  assert.strictEqual(modeOf(316, 216, "sliver"), "compact");
  assert.strictEqual(modeOf(900, 400, "sliver"), "regular"); // a big jump leaves cleanly
  // the shape holds while it holds
  assert.strictEqual(M(500, 210, "sliver").shape, "strip");
  assert.strictEqual(M(310, 600, "sliver").shape, "column");
  // a column that shrinks in height stays a column until h < 200 (prev as the whole result)
  const col = { mode: "sliver", shape: "column" };
  assert.strictEqual(M(250, 210, col).shape, "column");
  assert.strictEqual(M(250, 200, col).shape, "column");
  assert.strictEqual(M(250, 199, col).shape, "strip");
  assert.strictEqual(M(250, 210, { mode: "sliver", shape: "strip" }).shape, "strip");
  assert.strictEqual(M(310, 210, M(250, 400)).shape, "column");
  assert.strictEqual(M(500, 210, "compact").mode, "compact"); // fresh: 210 is not a sliver
});
t("slateMode: junk gives compact", () => {
  [[0, 0], [0, 600], [600, 0], [NaN, 600], [600, NaN], [undefined, undefined], [undefined, 600], [null, null], ["900", "700"], [-5, 700], [Infinity, 600]].forEach(([w, h]) => {
    assert.deepStrictEqual(M(w, h), { mode: "compact", shape: null }, w + "x" + h);
    assert.deepStrictEqual(M(w, h, "full"), { mode: "compact", shape: null }, w + "x" + h + " prev full");
  });
});
t("slateMode: an unknown prev is ignored", () => {
  assert.strictEqual(modeOf(1090, 800, "bogus"), "regular");
  assert.strictEqual(modeOf(1090, 800, {}), "regular");
});
t("slateMode: edges are named constants", () => {
  assert.strictEqual(L.TK_SLATE_EDGES.fullLeave, 1084);
  assert.deepStrictEqual(L.TK_SLATE_MODES, ["sliver", "compact", "regular", "full"]);
});

// ---- Slate app (S1): the sliver's current task -------------------------------------------
const SME = "me@example.test";
const sid = (i) => "00000000-0000-4000-8000-" + String(i).padStart(12, "0");
let sseq = 0;
const stask = (o) =>
  Object.assign(
    { id: sid(++sseq), text: "T" + sseq, status: "todo", done: false, priority: "normal", assignee_email: SME, due_date: null, status_changed_at: null, updated_at: "2026-10-20T10:00:00.000Z", deleted_at: null },
    o || {},
  );
const TODAY = "2026-10-21";
t("slateCurrent: in_progress beats Next up", () => {
  const late = stask({ due_date: "2026-10-01", priority: "high" });
  const mine = stask({ status: "in_progress", due_date: null });
  assert.strictEqual(L.TK_slateCurrent([late, mine], SME, TODAY), mine);
});
t("slateCurrent: the newest in_progress wins (started, else updated)", () => {
  const a = stask({ status: "in_progress", status_changed_at: "2026-10-20T09:00:00.000Z" });
  const b = stask({ status: "in_progress", status_changed_at: "2026-10-21T08:00:00.000Z" });
  const c = stask({ status: "in_progress", status_changed_at: "2026-10-19T08:00:00.000Z" });
  assert.strictEqual(L.TK_slateCurrent([a, b, c], SME, TODAY), b);
  assert.strictEqual(L.TK_slateCurrent([c, b, a], SME, TODAY), b);
  const d = stask({ status: "in_progress", status_changed_at: null, updated_at: "2026-10-21T12:00:00.000Z" });
  assert.strictEqual(L.TK_slateCurrent([a, d, b], SME, TODAY), d);
  const e = stask({ status: "in_progress", status_changed_at: "2026-10-21T08:00:00+00:00" });
  assert.strictEqual(L.TK_slateCurrent([b, e], SME, TODAY).id, b.id < e.id ? b.id : e.id); // same instant: stable tie
});
t("slateCurrent: with none in progress, Next up order (late, today, soonest, priority)", () => {
  const none = stask({ due_date: null, priority: "high" });
  const later = stask({ due_date: "2026-10-30" });
  const today = stask({ due_date: TODAY, priority: "low" });
  const late = stask({ due_date: "2026-10-15", priority: "low" });
  assert.strictEqual(L.TK_slateCurrent([none, later, today, late], SME, TODAY), late);
  assert.strictEqual(L.TK_slateCurrent([none, later, today], SME, TODAY), today);
  assert.strictEqual(L.TK_slateCurrent([none, later], SME, TODAY), later);
  const p1 = stask({ due_date: "2026-10-22", priority: "low" });
  const p2 = stask({ due_date: "2026-10-22", priority: "high" });
  assert.strictEqual(L.TK_slateCurrent([p1, p2], SME, TODAY), p2);
});
t("slateCurrent: done, waiting, review, deleted and other people's are skipped", () => {
  const rows = [
    stask({ status: "done", done: true, due_date: "2026-10-01" }),
    stask({ status: "waiting_client", due_date: "2026-10-01" }),
    stask({ status: "ready_for_review", due_date: "2026-10-01" }),
    stask({ deleted_at: "2026-10-20T00:00:00Z", due_date: "2026-10-01" }),
    stask({ assignee_email: "other@example.test", status: "in_progress" }),
    stask({ assignee_email: null, due_date: "2026-10-01" }),
  ];
  assert.strictEqual(L.TK_slateCurrent(rows, SME, TODAY), null);
  const ok = stask({ due_date: "2026-12-31" });
  assert.strictEqual(L.TK_slateCurrent(rows.concat([ok]), SME, TODAY), ok);
});
t("slateCurrent: me is matched ignoring case; empty and junk give null", () => {
  const mine = stask({ assignee_email: "ME@Example.Test" });
  assert.strictEqual(L.TK_slateCurrent([mine], "me@EXAMPLE.test", TODAY), mine);
  assert.strictEqual(L.TK_slateCurrent([], SME, TODAY), null);
  assert.strictEqual(L.TK_slateCurrent(null, SME, TODAY), null);
  assert.strictEqual(L.TK_slateCurrent(undefined, SME, TODAY), null);
  assert.strictEqual(L.TK_slateCurrent([mine], "", TODAY), null);
  assert.strictEqual(L.TK_slateCurrent([mine], null, TODAY), null);
  assert.strictEqual(L.TK_slateCurrent([null, undefined, mine], SME), mine);
});
t("slateCurrent: legacy rows with no status use the done flag", () => {
  const open = stask({ status: undefined, done: false });
  const closed = stask({ status: undefined, done: true, due_date: "2026-10-01" });
  assert.strictEqual(L.TK_slateCurrent([closed, open], SME, TODAY), open);
});

// ---- Slate app (S1): size presets ---------------------------------------------------------
t("slateSizePreset: sliver and list with no chrome", () => {
  const scr = { availWidth: 1920, availHeight: 1055, availLeft: 0, availTop: 25 };
  assert.deepStrictEqual(L.TK_slateSizePreset("sliver", scr), { id: "sliver", w: 360, h: 140, x: null, y: null, innerW: 360, innerH: 140 });
  assert.deepStrictEqual(L.TK_slateSizePreset("list", scr), { id: "list", w: 440, h: 800, x: null, y: null, innerW: 440, innerH: 800 });
});
t("slateSizePreset: chrome is added to give the OUTER size", () => {
  const scr = { availWidth: 1920, availHeight: 1055, availLeft: 0, availTop: 25 };
  const chrome = { w: 0, h: 123 };
  assert.deepStrictEqual(L.TK_slateSizePreset("sliver", scr, chrome), { id: "sliver", w: 360, h: 263, x: null, y: null, innerW: 360, innerH: 140 });
  assert.deepStrictEqual(L.TK_slateSizePreset("list", scr, chrome), { id: "list", w: 440, h: 923, x: null, y: null, innerW: 440, innerH: 800 });
  assert.deepStrictEqual(L.TK_slateSizePreset("sliver", scr, { w: 16, h: 123 }), { id: "sliver", w: 376, h: 263, x: null, y: null, innerW: 360, innerH: 140 });
});
t("slateSizePreset: full is the available screen (outer, no chrome added) with its offset", () => {
  assert.deepStrictEqual(L.TK_slateSizePreset("full", { availWidth: 1920, availHeight: 1055, availLeft: 0, availTop: 25 }), { id: "full", w: 1920, h: 1055, x: 0, y: 25, innerW: 1920, innerH: 1055 });
  assert.deepStrictEqual(L.TK_slateSizePreset("full", { availWidth: 1440, availHeight: 860, availLeft: -1440, availTop: 0 }), { id: "full", w: 1440, h: 860, x: -1440, y: 0, innerW: 1440, innerH: 860 });
  assert.deepStrictEqual(L.TK_slateSizePreset("full", { availWidth: 1280, availHeight: 700 }), { id: "full", w: 1280, h: 700, x: 0, y: 0, innerW: 1280, innerH: 700 });
  assert.deepStrictEqual(L.TK_slateSizePreset("full", { availWidth: 1280, availHeight: 700 }, { w: 0, h: 123 }), { id: "full", w: 1280, h: 700, x: 0, y: 0, innerW: 1280, innerH: 577 });
});
t("slateSizePreset: a small screen clamps the outer size, with and without chrome", () => {
  const small = { availWidth: 400, availHeight: 600 };
  assert.deepStrictEqual(L.TK_slateSizePreset("list", small), { id: "list", w: 400, h: 600, x: null, y: null, innerW: 400, innerH: 600 });
  assert.deepStrictEqual(L.TK_slateSizePreset("list", small, { w: 0, h: 123 }), { id: "list", w: 400, h: 600, x: null, y: null, innerW: 400, innerH: 477 });
  assert.deepStrictEqual(L.TK_slateSizePreset("sliver", { availWidth: 320, availHeight: 100 }, { w: 0, h: 123 }), { id: "sliver", w: 320, h: 100, x: null, y: null, innerW: 320, innerH: 0 });
  assert.deepStrictEqual(L.TK_slateSizePreset("sliver", small, { w: 0, h: 123 }), { id: "sliver", w: 360, h: 263, x: null, y: null, innerW: 360, innerH: 140 });
});
t("slateSizePreset: junk screen", () => {
  [undefined, null, {}, { availWidth: 0, availHeight: 0 }, { availWidth: "x", availHeight: NaN }, { availWidth: 1000 }].forEach((scr) => {
    assert.strictEqual(L.TK_slateSizePreset("full", scr, { w: 0, h: 123 }), null, JSON.stringify(scr));
    assert.deepStrictEqual(L.TK_slateSizePreset("sliver", scr), { id: "sliver", w: 360, h: 140, x: null, y: null, innerW: 360, innerH: 140 }, JSON.stringify(scr));
    assert.deepStrictEqual(L.TK_slateSizePreset("list", scr, { w: 0, h: 123 }), { id: "list", w: 440, h: 923, x: null, y: null, innerW: 440, innerH: 800 }, JSON.stringify(scr));
  });
});
t("slateSizePreset: junk chrome counts as zero", () => {
  const scr = { availWidth: 1920, availHeight: 1055 };
  [undefined, null, {}, { w: "x", h: NaN }, { w: -5, h: -123 }, "abc"].forEach((c) =>
    assert.deepStrictEqual(L.TK_slateSizePreset("sliver", scr, c), { id: "sliver", w: 360, h: 140, x: null, y: null, innerW: 360, innerH: 140 }, JSON.stringify(c)),
  );
  assert.deepStrictEqual(L.TK_slateSizePreset("sliver", scr, { w: 0, h: "123" }), { id: "sliver", w: 360, h: 263, x: null, y: null, innerW: 360, innerH: 140 });
});
t("slateSizePreset: unknown id gives null", () => {
  ["huge", "", null, undefined, 3, "constructor", "__proto__"].forEach((id) => assert.strictEqual(L.TK_slateSizePreset(id, { availWidth: 1000, availHeight: 800 }, { w: 0, h: 123 }), null, String(id)));
});

// ---- Slate app (S1): popup minimum -------------------------------------------------------
t("popOutSize: the 240x180 minimum only when the app is on", () => {
  const scr = { availWidth: 1920, availHeight: 1080 };
  assert.deepStrictEqual(L.TK_popOutSize({ w: 260, h: 200 }, scr, true), { w: 260, h: 200 });
  assert.deepStrictEqual(L.TK_popOutSize({ w: 260, h: 140 }, scr, true), { w: 260, h: 180 });
  assert.deepStrictEqual(L.TK_popOutSize({ w: 100, h: 50 }, scr, true), { w: 240, h: 180 });
  assert.deepStrictEqual(L.TK_popOutSize({ w: 260, h: 140 }, scr, false), { w: 380, h: 520 });
  assert.deepStrictEqual(L.TK_popOutSize({ w: 260, h: 140 }, scr), { w: 380, h: 520 });
  assert.deepStrictEqual(L.TK_popOutSize({ w: 260, h: 140 }, scr, "1"), { w: 380, h: 520 }); // only a real true
  assert.deepStrictEqual(L.TK_popOutSize({ w: 260, h: 140 }, scr, undefined), { w: 380, h: 520 });
  assert.strictEqual(L.TK_popOutFeatures({ w: 260, h: 140 }, scr, true), "popup,width=260,height=180");
  assert.strictEqual(L.TK_popOutFeatures({ w: 260, h: 140 }, scr), "popup,width=380,height=520");
  assert.deepStrictEqual(L.TK_POPOUT_MIN_APP, { w: 240, h: 180 });
});
t("popOutSize: the default and a clamp to the screen are the same on or off", () => {
  const scr = { availWidth: 1440, availHeight: 900 };
  assert.deepStrictEqual(L.TK_popOutSize(null, scr, true), L.TK_popOutSize(null, scr, false));
  assert.deepStrictEqual(L.TK_popOutSize({ w: 3000, h: 2000 }, scr, true), { w: 1440, h: 900 });
  assert.deepStrictEqual(L.TK_popOutSize({ w: 1, h: 1 }, { availWidth: 200, availHeight: 100 }, true), { w: 200, h: 100 });
});

// ---- Slate app (S1): deep links ----------------------------------------------------------
t("slateDeepHref: named views", () => {
  assert.strictEqual(L.TK_slateDeepHref("templates"), "/slate#/tasks/templates");
  assert.strictEqual(L.TK_slateDeepHref("manage"), "/slate#/tasks/manage");
  assert.strictEqual(L.TK_slateDeepHref("my"), "/slate#/tasks/my");
  assert.strictEqual(L.TK_slateDeepHref("search"), "/slate#/tasks/search");
  assert.strictEqual(L.TK_slateDeepHref("review"), "/slate#/tasks/review");
  assert.strictEqual(L.TK_slateDeepHref("waiting"), "/slate#/tasks/waiting");
  assert.strictEqual(L.TK_slateDeepHref({ view: "Templates" }), "/slate#/tasks/templates");
});
t("slateDeepHref: a list (client, project, person)", () => {
  assert.strictEqual(L.TK_slateDeepHref({ view: "client", clientId: "Ab/c" }), null); // "/" is not a safe id
  assert.strictEqual(L.TK_slateDeepHref({ view: "client", clientId: "acme-12" }), "/slate#/tasks/c/acme-12");
  assert.strictEqual(L.TK_slateDeepHref({ view: "client", clientId: 42 }), "/slate#/tasks/c/42");
  assert.strictEqual(L.TK_slateDeepHref({ view: "project", projectId: sid(5) }), "/slate#/tasks/p/" + sid(5));
  assert.strictEqual(L.TK_slateDeepHref({ view: "person", staffId: sid(6) }), "/slate#/tasks/u/" + sid(6));
});
t("slateDeepHref: a task", () => {
  assert.strictEqual(L.TK_slateDeepHref({ view: "task", taskId: sid(7) }), "/slate#/tasks/my?item=task:" + sid(7));
  assert.strictEqual(L.TK_slateDeepHref({ view: "templates", taskId: sid(7) }), "/slate#/tasks/templates?item=task:" + sid(7));
  assert.strictEqual(L.TK_slateDeepHref({ view: "task" }), null);
  assert.strictEqual(L.TK_slateDeepHref({ view: "task", taskId: "not-a-uuid" }), null);
  assert.strictEqual(L.TK_slateDeepHref({ view: "my", taskId: "x@y.com" }), null);
});
t("slateDeepHref: the hrefs parse back to the same views (TK_logic)", () => {
  let P;
  try {
    P = require("./TK_logic.js");
  } catch (e) {
    return;
  }
  const back = (h) => P.TK_parseRoute(h.slice("/slate".length));
  assert.deepStrictEqual(back(L.TK_slateDeepHref("templates")), { view: "templates" });
  assert.deepStrictEqual(back(L.TK_slateDeepHref("manage")), { view: "manage" });
  assert.deepStrictEqual(back(L.TK_slateDeepHref({ view: "client", clientId: "acme-12" })), { view: "client", clientId: "acme-12" });
  assert.deepStrictEqual(back(L.TK_slateDeepHref({ view: "project", projectId: sid(5) })), { view: "project", projectId: sid(5) });
  assert.deepStrictEqual(back(L.TK_slateDeepHref({ view: "person", staffId: sid(6) })), { view: "person", staffId: sid(6) });
  assert.deepStrictEqual(back(L.TK_slateDeepHref({ view: "task", taskId: sid(7) })), { view: "my" });
});
t("slateDeepHref: junk is rejected", () => {
  [undefined, null, "", "nope", "tasks", 5, [], {}, { view: "bogus" }, { view: "client" }, { view: "client", clientId: "a@b.com" }, { view: "client", clientId: "" }, { view: "project", projectId: "123" }, { view: "project" }, { view: "person", staffId: "x" }, "javascript:alert(1)", "//evil.com", "../manage", { view: "my/../../x" }].forEach((r) =>
    assert.strictEqual(L.TK_slateDeepHref(r), null, JSON.stringify(r)),
  );
  assert.strictEqual(L.TK_slateDeepHref({ view: "client", clientId: "x".repeat(121) }), null);
  ["..", ".", "..."].forEach((c) => assert.strictEqual(L.TK_slateDeepHref({ view: "client", clientId: c }), null, c));
  assert.strictEqual(L.TK_slateDeepHref({ view: "client", clientId: "a.b" }), "/slate#/tasks/c/a.b");
});

// ---- Slate app bridge (S2; ported from the MGB Desk window tests) -------------
t("slateForwardOk: plain app hashes only", () => {
  const K = L.TK_slateForwardOk;
  assert.strictEqual(K("#/clients/12/chat"), true);
  assert.strictEqual(K("#/help/my-tasks"), true);
  ["javascript:alert(1)", "https://evil", "#//x", "//evil.com", "", "#", "#/a b", "#/<x>", 5, null, undefined, {}, "#/" + "a".repeat(300)].forEach((v) =>
    assert.strictEqual(K(v), false, String(v)),
  );
  assert.strictEqual(K("#/" + "a".repeat(298)), true);
  assert.strictEqual(K("#/" + "a".repeat(299)), false);
  assert.strictEqual(K("#/client/ab-12/inbox?item=request:9f%2Fx&month=2026-09"), true);
  assert.strictEqual(K("#/work/tasks?item=task:abc123"), true);
  assert.strictEqual(K("#/tasks/c/Ab%2Fc"), true);
  assert.strictEqual(K("#/today?client=a%40b.co"), true);
  assert.strictEqual(K("#/tasks/c/" + encodeURIComponent("O'Brien")), true);
  assert.strictEqual(K('#/a"b'), false);
});
t("slateDockPick: none, one, several", () => {
  const D = L.TK_slateDockPick;
  assert.strictEqual(D([]), null);
  assert.strictEqual(D(undefined), null);
  assert.strictEqual(D([{ from: "a", focusedAt: 5, visible: false }]), "a");
  assert.strictEqual(D([{ from: "a", focusedAt: 9, visible: false }, { from: "b", focusedAt: 1, visible: true }]), "b");
  assert.strictEqual(D([{ from: "a", focusedAt: 3, visible: true }, { from: "b", focusedAt: 8, visible: true }]), "b");
  assert.strictEqual(D([{ from: "a", focusedAt: 3 }, { from: "b", focusedAt: 8 }, { from: "c", focusedAt: 2 }]), "b");
  assert.strictEqual(D([null, {}, { from: "z" }]), "z");
});
t("slateIsTasksHash and slateDockHashOk", () => {
  const T = L.TK_slateIsTasksHash;
  ["#/tasks", "#/tasks/", "#/tasks/my", "#/tasks/my?item=task:1", "#/tasks/c/x"].forEach((h) => assert.strictEqual(T(h), true, h));
  ["#/taskss", "#/today", "#/client/1/tasks", "", null, "#/work/tasks", "#/tasks?item=task:1"].forEach((h) => assert.strictEqual(T(h), false, String(h)));
  const D = L.TK_slateDockHashOk;
  assert.strictEqual(D("#/tasks/my"), true);
  assert.strictEqual(D("#/tasks/c/Ab%2Fc?item=task:abc-1"), true);
  ["#/today", "#/tasks/a/b/c/d", "#/tasks/my?x=1", "javascript:x", null].forEach((h) => assert.strictEqual(D(h), false, String(h)));
});
t("slateAppUrl: current Tasks route, else My tasks", () => {
  assert.strictEqual(L.TK_slateAppUrl("#/tasks/templates"), "/slate#/tasks/templates");
  assert.strictEqual(L.TK_slateAppUrl("#/tasks/c/acme?item=task:1"), "/slate#/tasks/c/acme?item=task:1");
  assert.strictEqual(L.TK_slateAppUrl("#/today"), "/slate#/tasks/my");
  assert.strictEqual(L.TK_slateAppUrl(""), "/slate#/tasks/my");
  assert.strictEqual(L.TK_slateAppUrl(undefined), "/slate#/tasks/my");
  assert.strictEqual(L.TK_slateAppUrl("#/tasks/" + "a".repeat(400)), "/slate#/tasks/my");
  assert.strictEqual(L.TK_slateAppUrl("#/tasks/a b"), "/slate#/tasks/my");
  assert.strictEqual(L.TK_slateAppUrl("#/tasks?item=task:1"), "/slate#/tasks/my");
  assert.strictEqual(L.TK_slateAppUrl("#/tasks"), "/slate#/tasks");
});
t("slateLaunchItems: open, install, installed, phone", () => {
  const I = (o) => L.TK_slateLaunchItems(o).map((x) => x.id + ":" + x.label);
  assert.deepStrictEqual(I({ canInstall: true }), ["open:Open Slate app", "install:Install Slate app"]);
  assert.deepStrictEqual(I({ canInstall: false }), ["open:Open Slate app"]);
  assert.deepStrictEqual(I({ installed: true, canInstall: true }), ["open-app:Open Slate app"]);
  assert.deepStrictEqual(I({ canInstall: true, mobile: true }), []);
  assert.deepStrictEqual(I(undefined), ["open:Open Slate app"]);
});
t("slateTaskHost: pane in full, drawer in compact and regular, none in a sliver", () => {
  assert.strictEqual(L.TK_slateTaskHost("full"), "pane");
  assert.strictEqual(L.TK_slateTaskHost("regular"), "drawer");
  assert.strictEqual(L.TK_slateTaskHost("compact"), "drawer");
  assert.strictEqual(L.TK_slateTaskHost("sliver"), "none");
  assert.strictEqual(L.TK_slateTaskHost(undefined), "drawer");
  assert.strictEqual(L.TK_slateTaskHost("big"), "drawer");
  // one owner per mode, never two
  ["sliver", "compact", "regular", "full"].forEach((m) => {
    const h = L.TK_slateTaskHost(m);
    assert.ok(["pane", "drawer", "none"].indexOf(h) >= 0);
  });
});
t("slateLayout per mode", () => {
  const f = L.TK_slateLayout("full", false);
  assert.deepStrictEqual(f, { mode: "full", rail: true, railW: 240, bottomBar: false, compact: false, canEdit: true, pane: true, list: true });
  const r = L.TK_slateLayout("regular", true);
  assert.deepStrictEqual(r, { mode: "regular", rail: true, railW: 220, bottomBar: false, compact: false, canEdit: true, pane: false, list: true });
  const c = L.TK_slateLayout("compact", true);
  assert.deepStrictEqual(c, { mode: "compact", rail: false, railW: 0, bottomBar: true, compact: true, canEdit: false, pane: false, list: true });
  assert.strictEqual(L.TK_slateLayout("compact", false).bottomBar, false);
  const s = L.TK_slateLayout("sliver", true);
  assert.strictEqual(s.list, false);
  assert.strictEqual(s.bottomBar, false);
  assert.strictEqual(s.canEdit, false);
  assert.strictEqual(L.TK_slateLayout("nope").mode, "compact");
});
t("slateModeClasses", () => {
  assert.strictEqual(L.TK_slateModeClasses({ mode: "full", shape: null }), "tk-m-full");
  assert.strictEqual(L.TK_slateModeClasses({ mode: "sliver", shape: "strip" }), "tk-m-sliver tk-shape-strip");
  assert.strictEqual(L.TK_slateModeClasses({ mode: "sliver", shape: "column" }), "tk-m-sliver tk-shape-column");
  assert.strictEqual(L.TK_slateModeClasses({ mode: "sliver", shape: "x" }), "tk-m-sliver");
  assert.strictEqual(L.TK_slateModeClasses({ mode: "regular", shape: "strip" }), "tk-m-regular");
  assert.strictEqual(L.TK_slateModeClasses(null), "tk-m-compact");
  assert.strictEqual(L.TK_slateModeClasses(L.TK_slateMode(1200, 800)), "tk-m-full");
});
t("slatePresetsAllowed: popup or installed app only", () => {
  assert.strictEqual(L.TK_slatePresetsAllowed({ hasOpener: true }), true);
  assert.strictEqual(L.TK_slatePresetsAllowed({ standalone: true }), true);
  assert.strictEqual(L.TK_slatePresetsAllowed({ name: "mgb-tasks" }), true);
  assert.strictEqual(L.TK_slatePresetsAllowed({ name: "other" }), false);
  assert.strictEqual(L.TK_slatePresetsAllowed({}), false);
  assert.strictEqual(L.TK_slatePresetsAllowed(), false);
});
t("slateSizeHit: within 4px both ways", () => {
  const want = { innerW: 440, innerH: 800 };
  assert.strictEqual(L.TK_slateSizeHit(want, { w: 440, h: 800 }), true);
  assert.strictEqual(L.TK_slateSizeHit(want, { w: 444, h: 796 }), true);
  assert.strictEqual(L.TK_slateSizeHit(want, { w: 445, h: 800 }), false);
  assert.strictEqual(L.TK_slateSizeHit(want, { w: 440, h: 790 }), false);
  assert.strictEqual(L.TK_slateSizeHit(want, { w: 450, h: 800 }, 10), true);
  assert.strictEqual(L.TK_slateSizeHit(null, { w: 1, h: 1 }), false);
  assert.strictEqual(L.TK_slateSizeHit(want, { w: NaN, h: 800 }), false);
  assert.strictEqual(L.TK_slateSizeHit(want, null), false);
});
t("slatePresetPlace", () => {
  assert.strictEqual(L.TK_slatePresetPlace("full"), "bar");
  assert.strictEqual(L.TK_slatePresetPlace("regular"), "bar");
  assert.strictEqual(L.TK_slatePresetPlace("compact"), "menu");
  assert.strictEqual(L.TK_slatePresetPlace("sliver"), "none");
  assert.strictEqual(L.TK_slatePresetPlace(), "none");
});
t("Slate app bridge constants", () => {
  assert.strictEqual(L.TK_SLATE_CHANNEL, "mgb-slate");
  assert.strictEqual(L.TK_SLATE_INSTALLED_KEY, "mgb_slate_installed_v1");
  assert.strictEqual(L.TK_SLATE_APP_NAME, "MGB Slate");
});

// ---- Slate app P3: named saved views ---------------------------------------------
t("view name: trims and collapses white space", () => {
  assert.strictEqual(L.TK_cleanViewName("  Waiting   on \t clients "), "Waiting on clients");
  assert.strictEqual(L.TK_cleanViewName(null), "");
});
t("view name: valid name returns the cleaned name", () => {
  const r = L.TK_validateViewName("  Due   soon ", []);
  assert.deepStrictEqual(r, { ok: true, name: "Due soon" });
});
t("view name: empty and blank refused", () => {
  assert.strictEqual(L.TK_validateViewName("", []).error, "empty");
  assert.strictEqual(L.TK_validateViewName("   ", []).error, "empty");
  assert.strictEqual(L.TK_validateViewName(undefined, []).error, "empty");
});
t("view name: 60 ok, 61 too long", () => {
  assert.strictEqual(L.TK_validateViewName("x".repeat(60), []).ok, true);
  const r = L.TK_validateViewName("x".repeat(61), []);
  assert.strictEqual(r.error, "too_long");
  assert.ok(r.text.length > 0);
});
t("view name: length counts after cleaning", () => {
  assert.strictEqual(L.TK_validateViewName("  " + "x".repeat(60) + "   ", []).ok, true);
});
t("view name: Default is reserved in any case", () => {
  assert.strictEqual(L.TK_validateViewName("Default", []).error, "reserved");
  assert.strictEqual(L.TK_validateViewName(" default ", []).error, "reserved");
});
t("view name: duplicate ignores case and spacing", () => {
  const rows = [{ id: "a", name: "Mine due soon" }, { id: "b", name: "Other" }];
  assert.strictEqual(L.TK_validateViewName("MINE  DUE soon", rows).error, "duplicate");
  assert.strictEqual(L.TK_validateViewName("Brand new", rows).ok, true);
});
t("view name: renaming a view to its own name is fine, to another's is not", () => {
  const rows = [{ id: "a", name: "Mine" }, { id: "b", name: "Other" }];
  assert.strictEqual(L.TK_validateViewName("mine", rows, "a").ok, true);
  assert.strictEqual(L.TK_validateViewName("other", rows, "a").error, "duplicate");
});
t("view name: the Default entry in the list is not a duplicate source", () => {
  const rows = [{ id: "__default__", name: "Default", isDefault: true }];
  assert.strictEqual(L.TK_validateViewName("Default", rows).error, "reserved");
  assert.strictEqual(L.TK_validateViewName("Other", rows).ok, true);
});
t("view name: error texts exist for every code and a fallback", () => {
  ["empty", "too_long", "reserved", "duplicate", "too_many"].forEach((c) => assert.ok(L.TK_viewNameErrorText(c).length > 5, c));
  assert.ok(L.TK_viewNameErrorText("zzz").length > 5);
  assert.ok(!/colour/i.test(JSON.stringify(L.TK_VIEW_NAME_ERRORS)));
});
t("saved views: the cap is 30 saved rows, Default does not count", () => {
  const rows = [];
  for (let i = 0; i < 29; i++) rows.push({ id: "r" + i, name: "V" + i });
  assert.strictEqual(L.TK_canAddSavedView(rows), true);
  rows.push({ id: "r29", name: "V29" });
  assert.strictEqual(L.TK_SAVED_VIEW_MAX, 30);
  assert.strictEqual(L.TK_canAddSavedView(rows), false);
  const merged = L.TK_mergeSavedViews(rows, null);
  assert.strictEqual(merged.length, 31);
  assert.strictEqual(L.TK_canAddSavedView(merged), false);
  assert.strictEqual(L.TK_canAddSavedView(merged.slice(0, 30)), true);
  assert.strictEqual(L.TK_canAddSavedView(null), true);
});
t("saved views: next position follows the highest", () => {
  assert.strictEqual(L.TK_nextViewPosition([]), 1);
  assert.strictEqual(L.TK_nextViewPosition([{ position: 3 }, { position: 7 }, { position: "2" }]), 8);
  assert.strictEqual(L.TK_nextViewPosition(null), 1);
});
t("saved views: Default first, then position, created, name", () => {
  const rows = [
    { id: "c", name: "Zed", position: 2, created_at: "2026-10-01T00:00:00Z", view: { groupBy: "client" } },
    { id: "a", name: "alpha", position: 1, created_at: "2026-10-02T00:00:00Z", view: { groupBy: "status" } },
    { id: "b", name: "Beta", position: 2, created_at: "2026-10-01T00:00:00Z", view: {} },
    { id: "d", name: "Aardvark", position: 2, created_at: "2026-10-01T00:00:00Z", view: null },
  ];
  const m = L.TK_mergeSavedViews(rows, { groupBy: "part", chip: "waiting" });
  assert.deepStrictEqual(m.map((e) => e.id), ["__default__", "a", "d", "b", "c"]);
  assert.strictEqual(m[0].isDefault, true);
  assert.strictEqual(m[0].name, "Default");
  assert.deepStrictEqual(m[0].view, { groupBy: "part", sort: null, chip: "waiting" });
});
t("saved views: every view is normalized, junk rows dropped", () => {
  const m = L.TK_mergeSavedViews(
    [
      { id: "x", name: "Bad", view: { groupBy: "nope", sort: { col: "zzz" }, chip: "nope" } },
      { id: null, name: "No id", view: {} },
      { id: "y", name: "   ", view: {} },
      null,
    ],
    undefined
  );
  assert.strictEqual(m.length, 2);
  assert.deepStrictEqual(m[1].view, { groupBy: "due", sort: null, chip: "" });
  assert.deepStrictEqual(m[0].view, { groupBy: "due", sort: null, chip: "" });
  assert.strictEqual(L.TK_mergeSavedViews(null, null).length, 1);
});
t("saved views: same-view compares normalized shape", () => {
  assert.strictEqual(L.TK_sameSlateView({ groupBy: "due" }, null), true);
  assert.strictEqual(L.TK_sameSlateView({ groupBy: "client" }, { groupBy: "due" }), false);
  assert.strictEqual(L.TK_sameSlateView({ sort: { col: "due", dir: "asc" } }, { sort: { col: "due" } }), true);
  assert.strictEqual(L.TK_sameSlateView({ sort: { col: "due", dir: "desc" } }, { sort: { col: "due", dir: "asc" } }), false);
  assert.strictEqual(L.TK_sameSlateView({ chip: "waiting" }, {}), false);
});
t("saved views: active entry is the match, a saved view beats Default", () => {
  const m = L.TK_mergeSavedViews([{ id: "s1", name: "Mine", position: 1, view: { groupBy: "client" } }, { id: "s2", name: "Same as default", position: 2, view: {} }], null);
  assert.strictEqual(L.TK_activeSavedViewId(m, { groupBy: "client" }), "s1");
  assert.strictEqual(L.TK_activeSavedViewId(m, {}), "s2");
  assert.strictEqual(L.TK_activeSavedViewId(m, { groupBy: "status" }), null);
  const only = L.TK_mergeSavedViews([], { groupBy: "client" });
  assert.strictEqual(L.TK_activeSavedViewId(only, { groupBy: "client" }), "__default__");
  assert.strictEqual(L.TK_activeSavedViewId(null, {}), null);
});
t("saved views: server errors map to codes", () => {
  assert.strictEqual(L.TK_savedViewErrorCode({ message: 'duplicate key value violates unique constraint "tk_saved_views_owner_scope_name_uq"' }), "duplicate");
  assert.strictEqual(L.TK_savedViewErrorCode({ message: "tk_too_many_views" }), "too_many");
  assert.strictEqual(L.TK_savedViewErrorCode({ message: "tk_name_reserved" }), "reserved");
  assert.strictEqual(L.TK_savedViewErrorCode({ message: 'violates check constraint "tk_saved_views_name_check"' }), "empty");
  assert.strictEqual(L.TK_savedViewErrorCode(new Error("boom")), "");
  assert.strictEqual(L.TK_savedViewErrorCode(null), "");
});

t("default view: a stored baseline wins", () => {
  const rows = [{ id: "a", name: "A", view: { groupBy: "client" } }];
  assert.deepStrictEqual(L.TK_resolveDefaultView({ groupBy: "status", chip: "waiting" }, { groupBy: "client" }, rows), { groupBy: "status", sort: null, chip: "waiting" });
});
t("default view: with no baseline it is the live older view", () => {
  assert.deepStrictEqual(L.TK_resolveDefaultView(null, { groupBy: "part" }, []), { groupBy: "part", sort: null, chip: "" });
  assert.deepStrictEqual(L.TK_resolveDefaultView(undefined, { groupBy: "part" }, [{ id: "a", name: "A", view: { groupBy: "client" } }]), { groupBy: "part", sort: null, chip: "" });
});
t("default view: with no baseline and a named view showing, it is the plain default", () => {
  assert.deepStrictEqual(L.TK_resolveDefaultView(null, { groupBy: "client" }, [{ id: "a", name: "A", view: { groupBy: "client" } }]), { groupBy: "due", sort: null, chip: "" });
});
t("default view: baseline key is per person and scope", () => {
  assert.strictEqual(L.TK_slateBaselineKey("A@B.com", "slate"), "mgb_tk_slate_base_v1:a@b.com");
  assert.strictEqual(L.TK_slateBaselineKey("A@B.com", "desk"), "mgb_tk_slate_base_v1:desk:a@b.com");
  assert.notStrictEqual(L.TK_slateBaselineKey("a@b.com"), L.TK_slateViewKey("a@b.com"));
});

// ---- Slate app P3: bulk Status, Priority, Section ------------------------------------
const bt = (id, o) => Object.assign({ id: id, status: "todo", priority: "normal", project_id: null, section: null }, o || {});
t("bulk routes: Done is the Complete path, open statuses are set_status", () => {
  assert.deepStrictEqual(L.TK_bulkStatusRoute("done"), { kind: "complete", patch: null });
  assert.deepStrictEqual(L.TK_bulkStatusRoute("in_progress"), { kind: "set_status", patch: { status: "in_progress" } });
  assert.deepStrictEqual(L.TK_bulkStatusRoute("waiting_client"), { kind: "set_status", patch: { status: "waiting_client" } });
  assert.deepStrictEqual(L.TK_bulkStatusRoute("todo"), { kind: "set_status", patch: { status: "todo" } });
});
t("bulk routes: Ready for review and junk are not bulk statuses", () => {
  assert.strictEqual(L.TK_bulkStatusRoute("ready_for_review"), null);
  assert.strictEqual(L.TK_bulkStatusRoute(""), null);
  assert.strictEqual(L.TK_bulkStatusRoute(null), null);
  assert.deepStrictEqual(L.TK_BULK_STATUS_CHOICES.map((c) => c.value), ["todo", "in_progress", "waiting_client", "done"]);
});
t("bulk routes: priorities are the schema's three", () => {
  assert.deepStrictEqual(L.TK_BULK_PRIORITY_CHOICES.map((c) => c.value), ["high", "normal", "low"]);
  ["high", "normal", "low"].forEach((p) => assert.deepStrictEqual(L.TK_bulkPriorityRoute(p), { kind: "set_priority", patch: { priority: p } }));
  assert.strictEqual(L.TK_bulkPriorityRoute("urgent"), null);
  assert.strictEqual(L.TK_bulkPriorityRoute(""), null);
});
t("bulk routes: section name trimmed, null clears, junk refused", () => {
  assert.deepStrictEqual(L.TK_bulkSectionRoute(" Alpha "), { kind: "set_section", patch: { section: "Alpha" } });
  assert.deepStrictEqual(L.TK_bulkSectionRoute(null), { kind: "set_section", patch: { section: null } });
  assert.deepStrictEqual(L.TK_bulkSectionRoute(""), { kind: "set_section", patch: { section: null } });
  assert.strictEqual(L.TK_bulkSectionRoute("   "), null);
  assert.strictEqual(L.TK_bulkSectionRoute("x".repeat(61)), null);
  assert.strictEqual(L.TK_bulkSectionRoute(5), null);
});
t("same project: all in one project", () => {
  assert.deepStrictEqual(L.TK_bulkSameProject([bt("1", { project_id: "p" }), bt("2", { project_id: "p" })]), { ok: true, projectId: "p", why: "" });
});
t("same project: mixed, none, empty", () => {
  assert.strictEqual(L.TK_bulkSameProject([bt("1", { project_id: "p" }), bt("2", { project_id: "q" })]).why, "mixed");
  assert.strictEqual(L.TK_bulkSameProject([bt("1", { project_id: "p" }), bt("2")]).why, "none");
  assert.strictEqual(L.TK_bulkSameProject([bt("1")]).why, "none");
  assert.strictEqual(L.TK_bulkSameProject([]).why, "empty");
  assert.strictEqual(L.TK_bulkSameProject(null).ok, false);
});
t("section choices: that project's list, trimmed, deduped, in order", () => {
  const projects = [{ id: "p", sections: ["Alpha", " Beta ", "alpha", "", null, "Gamma"] }, { id: "q", sections: ["Other"] }];
  assert.deepStrictEqual(L.TK_bulkSectionChoices([bt("1", { project_id: "p" })], projects), ["Alpha", "Beta", "Gamma"]);
  assert.deepStrictEqual(L.TK_bulkSectionChoices([bt("1", { project_id: "p" })], { p: projects[0] }), ["Alpha", "Beta", "Gamma"]);
});
t("section choices: none for mixed projects, no project or an unknown project", () => {
  const projects = [{ id: "p", sections: ["A"] }, { id: "q", sections: ["B"] }];
  assert.deepStrictEqual(L.TK_bulkSectionChoices([bt("1", { project_id: "p" }), bt("2", { project_id: "q" })], projects), []);
  assert.deepStrictEqual(L.TK_bulkSectionChoices([bt("1")], projects), []);
  assert.deepStrictEqual(L.TK_bulkSectionChoices([bt("1", { project_id: "zzz" })], projects), []);
  assert.deepStrictEqual(L.TK_bulkSectionChoices([bt("1", { project_id: "p" })], null), []);
});
t("offer: status and priority whenever something is selected", () => {
  const o = L.TK_bulkSetOffer([bt("1")], []);
  assert.strictEqual(o.status, true);
  assert.strictEqual(o.priority, true);
  assert.strictEqual(o.section, false);
  assert.strictEqual(o.sectionWhy, "none");
  const e = L.TK_bulkSetOffer([], []);
  assert.strictEqual(e.status, false);
  assert.strictEqual(e.priority, false);
});
t("offer: section only for one shared project with sections", () => {
  const projects = [{ id: "p", sections: ["A", "B"] }, { id: "q", sections: [] }];
  const one = L.TK_bulkSetOffer([bt("1", { project_id: "p" }), bt("2", { project_id: "p" })], projects);
  assert.strictEqual(one.section, true);
  assert.deepStrictEqual(one.sections, ["A", "B"]);
  assert.strictEqual(one.sectionWhy, "");
  const mixed = L.TK_bulkSetOffer([bt("1", { project_id: "p" }), bt("2", { project_id: "q" })], projects);
  assert.strictEqual(mixed.section, false);
  assert.strictEqual(mixed.sectionWhy, "mixed");
  const empty = L.TK_bulkSetOffer([bt("1", { project_id: "q" })], projects);
  assert.strictEqual(empty.section, false);
  const clearOnly = L.TK_bulkSetOffer([bt("1", { project_id: "q", section: "Old" })], projects);
  assert.strictEqual(clearOnly.section, true);
});
t("plan: open statuses skip done, in review and same-status tasks", () => {
  const tasks = [bt("a"), bt("b", { status: "in_progress" }), bt("c", { status: "done" }), bt("d", { status: "ready_for_review" }), bt("e", { done: true, status: undefined })];
  const plan = L.TK_bulkSetPlan("set_status", { status: "in_progress" }, tasks, []);
  assert.deepStrictEqual(plan.ok, ["a"]);
  const by = {};
  plan.skipped.forEach((s) => (by[s.id] = s.reason));
  assert.deepStrictEqual(by, { b: "no_change", c: "done_use_reopen", d: "in_review", e: "done_use_reopen" });
});
t("plan: Done skips only tasks already done (review gate is the server's)", () => {
  const plan = L.TK_bulkSetPlan("complete", null, [bt("a"), bt("b", { status: "done" }), bt("c", { status: "ready_for_review" })], []);
  assert.deepStrictEqual(plan.ok, ["a", "c"]);
  assert.deepStrictEqual(plan.skipped, [{ id: "b", reason: "already_done" }]);
});
t("plan: priority skips tasks already at that priority", () => {
  const plan = L.TK_bulkSetPlan("set_priority", { priority: "high" }, [bt("a"), bt("b", { priority: "high" }), bt("c", { priority: undefined })], []);
  assert.deepStrictEqual(plan.ok, ["a", "c"]);
  assert.deepStrictEqual(plan.skipped, [{ id: "b", reason: "no_change" }]);
  const normal = L.TK_bulkSetPlan("set_priority", { priority: "normal" }, [bt("c", { priority: undefined })], []);
  assert.deepStrictEqual(normal.skipped, [{ id: "c", reason: "no_change" }]);
});
t("plan: section matches without regard to case, skips missing and same", () => {
  const projects = [{ id: "p", sections: ["Alpha", "Beta"] }];
  const tasks = [bt("a", { project_id: "p" }), bt("b", { project_id: "p", section: "Alpha" }), bt("c", { project_id: "p", section: "Beta" })];
  const plan = L.TK_bulkSetPlan("set_section", { section: "alpha" }, tasks, projects);
  assert.deepStrictEqual(plan.ok, ["a", "c"]);
  assert.deepStrictEqual(plan.skipped, [{ id: "b", reason: "no_change" }]);
  const missing = L.TK_bulkSetPlan("set_section", { section: "Nope" }, tasks, projects);
  assert.deepStrictEqual(missing.skipped.map((s) => s.reason), ["section_missing", "section_missing", "section_missing"]);
});
t("plan: section across projects skips everything with a reason", () => {
  const projects = [{ id: "p", sections: ["A"] }, { id: "q", sections: ["A"] }];
  const plan = L.TK_bulkSetPlan("set_section", { section: "A" }, [bt("a", { project_id: "p" }), bt("b", { project_id: "q" })], projects);
  assert.deepStrictEqual(plan.ok, []);
  assert.strictEqual(plan.skipped.length, 2);
});
t("plan: no project is no_project, null clears, nothing to clear is no_change", () => {
  const projects = [{ id: "p", sections: ["A"] }];
  const plan = L.TK_bulkSetPlan("set_section", { section: "A" }, [bt("a", { project_id: "p" }), bt("b")], projects);
  assert.strictEqual(plan.skipped.length, 2);
  const only = L.TK_bulkSetPlan("set_section", { section: "A" }, [bt("b")], projects);
  assert.deepStrictEqual(only.skipped, [{ id: "b", reason: "no_project" }]);
  const clear = L.TK_bulkSetPlan("set_section", { section: null }, [bt("a", { project_id: "p", section: "A" }), bt("b")], projects);
  assert.deepStrictEqual(clear.ok, ["a"]);
  assert.deepStrictEqual(clear.skipped, [{ id: "b", reason: "no_change" }]);
});
t("plan: unknown kind skips with error", () => {
  assert.deepStrictEqual(L.TK_bulkSetPlan("zzz", {}, [bt("a")], []).skipped, [{ id: "a", reason: "error" }]);
});
t("reasons: new codes have text; summary verbs for the new kinds", () => {
  ["done_use_reopen", "no_project", "section_missing"].forEach((c) => {
    assert.notStrictEqual(L.TK_bulkReasonText(c), L.TK_BULK_REASONS.error, c);
  });
  assert.strictEqual(L.TK_bulkSummary("set_priority", { done: ["a", "b"], skipped: [] }), "2 tasks updated.");
  assert.strictEqual(L.TK_bulkSummary("set_section", { done: ["a"], skipped: [{ id: "b", reason: "no_change" }] }), "1 moved, 1 skipped.");
  assert.strictEqual(L.TK_bulkSummary("set_status", { done: [], skipped: [{ id: "b", reason: "in_review" }] }), "Nothing changed: 1 skipped.");
});
t("skip groups: new reasons group like the rest", () => {
  const g = L.TK_skipGroups([{ id: "1", reason: "no_project" }, { id: "2", reason: "no_project" }, { id: "3", reason: "section_missing" }], (id) => "T" + id);
  assert.strictEqual(g[0].reason, "no_project");
  assert.strictEqual(g[0].items.length, 2);
  assert.strictEqual(g[0].text, "It isn't in a project.");
});

// ---- Slate app S4: the sliver ---------------------------------------------------
t("sliverFit: the smallest strip keeps only title and buttons", () => {
  assert.deepStrictEqual(L.TK_slateSliverFit("strip", 360, 18), { size: "xs", due: false, client: false, rest: false, lines: 1 });
  assert.deepStrictEqual(L.TK_slateSliverFit("strip", NaN, undefined), { size: "xs", due: false, client: false, rest: false, lines: 1 });
});
t("sliverFit: strip edges by height and width", () => {
  assert.strictEqual(L.TK_slateSliverFit("strip", 360, 27).size, "xs");
  assert.strictEqual(L.TK_slateSliverFit("strip", 360, 28).size, "sm");
  assert.strictEqual(L.TK_slateSliverFit("strip", 360, 43).size, "sm");
  assert.strictEqual(L.TK_slateSliverFit("strip", 360, 44).size, "md");
  assert.strictEqual(L.TK_slateSliverFit("strip", 360, 23).due, false);
  assert.strictEqual(L.TK_slateSliverFit("strip", 360, 24).due, true);
  assert.strictEqual(L.TK_slateSliverFit("strip", 299, 60).due, false);
  assert.strictEqual(L.TK_slateSliverFit("strip", 259, 60).rest, false);
  assert.strictEqual(L.TK_slateSliverFit("strip", 260, 24).rest, true);
  assert.strictEqual(L.TK_slateSliverFit("strip", 419, 60).client, false);
  assert.strictEqual(L.TK_slateSliverFit("strip", 420, 31).client, false);
  assert.strictEqual(L.TK_slateSliverFit("strip", 420, 32).client, true);
});
t("sliverFit: column shows everything, 2 title lines when short", () => {
  assert.deepStrictEqual(L.TK_slateSliverFit("column", 240, 300), { size: "md", due: true, client: true, rest: true, lines: 3 });
  assert.strictEqual(L.TK_slateSliverFit("column", 240, 119).lines, 2);
  assert.strictEqual(L.TK_slateSliverFit("column", 240, 0).lines, 3);
});
const sv = (id, x) => Object.assign({ id, assignee_email: "me@x.com", status: "todo", text: id }, x || {});
t("sliverPick: skips the just-done id, else TK_slateCurrent", () => {
  const rows = [sv("a", { status: "in_progress", status_changed_at: "2026-10-20T10:00:00Z" }), sv("b", { due_date: "2026-10-01" })];
  assert.strictEqual(L.TK_slateSliverPick(rows, "ME@x.com", "2026-10-21").id, "a");
  assert.strictEqual(L.TK_slateSliverPick(rows, "me@x.com", "2026-10-21", "a").id, "b");
  assert.strictEqual(L.TK_slateSliverPick(rows, "me@x.com", "2026-10-21", ["a", "b"]), null);
  assert.strictEqual(L.TK_slateSliverPick(rows, "me@x.com", "2026-10-21", []).id, "a");
  assert.strictEqual(L.TK_slateSliverPick(null, "me@x.com", "2026-10-21"), null);
});
t("sliverRest: my open tasks due today or late, minus current and skip", () => {
  const rows = [
    sv("a", { due_date: "2026-10-21" }),
    sv("b", { due_date: "2026-10-01", status: "in_progress" }),
    sv("c", { due_date: "2026-10-22" }),
    sv("d", { due_date: "2026-10-21", status: "done" }),
    sv("e", { due_date: "2026-10-21", status: "waiting_client" }),
    sv("f", { due_date: "2026-10-21", assignee_email: "other@x.com" }),
    sv("g", { due_date: "2026-10-21", deleted_at: "2026-10-20T00:00:00Z" }),
    sv("h"),
    sv("a", { due_date: "2026-10-21" }),
  ];
  assert.strictEqual(L.TK_slateSliverRest(rows, "me@x.com", "2026-10-21"), 2);
  assert.strictEqual(L.TK_slateSliverRest(rows, "me@x.com", "2026-10-21", "a"), 1);
  assert.strictEqual(L.TK_slateSliverRest(rows, "me@x.com", "2026-10-21", "a", ["b"]), 0);
  assert.strictEqual(L.TK_slateSliverRest(rows, "me@x.com", "bad"), 0);
  assert.strictEqual(L.TK_slateSliverRest(rows, "", "2026-10-21"), 0);
});
t("sliverKey: s, x, Enter; modifiers and repeats are not keys", () => {
  assert.strictEqual(L.TK_slateSliverKey({ key: "s" }), "start");
  assert.strictEqual(L.TK_slateSliverKey({ key: "x" }), "done");
  assert.strictEqual(L.TK_slateSliverKey({ key: "Enter" }), "expand");
  assert.strictEqual(L.TK_slateSliverKey({ key: "S", shiftKey: true }), null);
  assert.strictEqual(L.TK_slateSliverKey({ key: "x", metaKey: true }), null);
  assert.strictEqual(L.TK_slateSliverKey({ key: "x", repeat: true }), null);
  assert.strictEqual(L.TK_slateSliverKey({ key: "j" }), null);
  assert.strictEqual(L.TK_slateSliverKey(null), null);
});

console.log(n + " checks passed");
