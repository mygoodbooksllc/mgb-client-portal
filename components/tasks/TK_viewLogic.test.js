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
  assert.ok(L.TK_manageTrashConfirm({ name: "Empty" }).body.indexOf("disappear from every list") >= 0);
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

console.log(n + " checks passed");
