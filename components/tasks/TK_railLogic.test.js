// node components/tasks/TK_railLogic.test.js
// Slate plus icon sidebar rules (docs/slateplus-sidebar-spec.md).
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const L = require("./TK_railLogic.js");
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

t("sectionOf: profile/person -> people, project/manage -> projects, client -> clients", () => {
  assert.strictEqual(L.TKR_sectionOf({ view: "profile", key: "a" }), "people");
  assert.strictEqual(L.TKR_sectionOf({ view: "person", staffId: "x" }), "people");
  assert.strictEqual(L.TKR_sectionOf({ view: "project", projectId: "p" }), "projects");
  assert.strictEqual(L.TKR_sectionOf({ view: "manage" }), "projects");
  assert.strictEqual(L.TKR_sectionOf({ view: "client", clientId: "1" }), "clients");
  assert.strictEqual(L.TKR_sectionOf({ view: "my" }), null);
  assert.strictEqual(L.TKR_sectionOf(null), null);
});

t("activeItem: top items light themselves, others their section, unknown nothing", () => {
  ["my", "review", "waiting", "templates", "search"].forEach((v) => assert.strictEqual(L.TKR_activeItem({ view: v }), v));
  assert.strictEqual(L.TKR_activeItem({ view: "client" }), "clients");
  assert.strictEqual(L.TKR_activeItem({ view: "settings" }), null);
  assert.strictEqual(L.TKR_activeItem(undefined), null);
});

t("parsePrefs: junk, arrays, wrong types and bad sections fall back to off", () => {
  const off = { pinned: false, section: null };
  [null, undefined, "", "{", "null", "[]", "42", '"x"', [], 7].forEach((v) => assert.deepStrictEqual(L.TKR_parsePrefs(v), off));
  assert.deepStrictEqual(L.TKR_parsePrefs('{"pinned":"true","section":"people"}'), { pinned: false, section: "people" });
  assert.deepStrictEqual(L.TKR_parsePrefs('{"pinned":true,"section":"bogus"}'), { pinned: true, section: "clients" });
  assert.deepStrictEqual(L.TKR_parsePrefs({ pinned: true, section: "projects" }), { pinned: true, section: "projects" });
});

t("serializePrefs round-trips and cleans", () => {
  const s = L.TKR_serializePrefs({ pinned: true, section: "people", extra: 1 });
  assert.strictEqual(s, '{"pinned":true,"section":"people"}');
  assert.deepStrictEqual(L.TKR_parsePrefs(s), { pinned: true, section: "people" });
  assert.strictEqual(L.TKR_serializePrefs(null), '{"pinned":false,"section":null}');
});

t("prefsKey: hashed person key only, never the email", () => {
  const fn = (e) => (e === "ann@x.org" ? "0123456789abcdef" : "nothex");
  assert.strictEqual(L.TKR_prefsKey(" Ann@X.org ", fn), "mgb_tkrail_v1:0123456789abcdef");
  assert.strictEqual(L.TKR_prefsKey("bob@x.org", fn), "");
  assert.strictEqual(L.TKR_prefsKey("", fn), "");
  assert.strictEqual(L.TKR_prefsKey("ann@x.org", null), "");
  assert.ok(L.TKR_prefsKey(" Ann@X.org ", fn).indexOf("@") < 0);
});

t("prefsKey with the real TKP_personKey", () => {
  const P = require("./TK_personLink.js");
  if (typeof P.TKP_personKey !== "function") return;
  const k = L.TKR_prefsKey("someone@mygoodbooks.org", P.TKP_personKey);
  assert.ok(/^mgb_tkrail_v1:[0-9a-f]{16}$/.test(k), k);
  assert.strictEqual(k.indexOf("mgb_"), 0, "Reset local state clears mgb_ keys");
});

t("pinnedRows: pin order, present rows only, deduped, capped", () => {
  const rows = [{ id: "a" }, { id: "b" }, { id: 3 }, { id: "d" }];
  assert.deepStrictEqual(L.TKR_pinnedRows(["d", "zz", "a", "a", "3"], rows).map((r) => r.id), ["d", "a", 3]);
  assert.deepStrictEqual(L.TKR_pinnedRows(["a", "b", "d"], rows, 2).map((r) => r.id), ["a", "b"]);
  assert.deepStrictEqual(L.TKR_pinnedRows(null, rows), []);
  assert.deepStrictEqual(L.TKR_pinnedRows(["a"], null), []);
  const many = Array.from({ length: 20 }, (_, i) => ({ id: "c" + i }));
  assert.strictEqual(L.TKR_pinnedRows(many.map((r) => r.id), many).length, 12);
});

t("badgeText and itemLabel", () => {
  assert.strictEqual(L.TKR_badgeText(0), "");
  assert.strictEqual(L.TKR_badgeText(-2), "");
  assert.strictEqual(L.TKR_badgeText("x"), "");
  assert.strictEqual(L.TKR_badgeText(7), "7");
  assert.strictEqual(L.TKR_badgeText(100), "99+");
  assert.strictEqual(L.TKR_itemLabel("Review", 3), "Review, 3 waiting");
  assert.strictEqual(L.TKR_itemLabel("Review", 0), "Review");
  assert.strictEqual(L.TKR_itemLabel("Waiting on client", 2, "open"), "Waiting on client, 2 open");
});

t("nextIndex: arrows wrap, Home/End, other keys ignored", () => {
  assert.strictEqual(L.TKR_nextIndex(0, 5, "ArrowDown"), 1);
  assert.strictEqual(L.TKR_nextIndex(4, 5, "ArrowDown"), 0);
  assert.strictEqual(L.TKR_nextIndex(0, 5, "ArrowUp"), 4);
  assert.strictEqual(L.TKR_nextIndex(-1, 5, "ArrowDown"), 0);
  assert.strictEqual(L.TKR_nextIndex(-1, 5, "ArrowUp"), 4);
  assert.strictEqual(L.TKR_nextIndex(2, 5, "Home"), 0);
  assert.strictEqual(L.TKR_nextIndex(2, 5, "End"), 4);
  assert.strictEqual(L.TKR_nextIndex(2, 5, "Enter"), -1);
  assert.strictEqual(L.TKR_nextIndex(0, 0, "ArrowDown"), -1);
});

t("width: rail only unless pinned with a section", () => {
  assert.strictEqual(L.TKR_width(false, "people"), 64);
  assert.strictEqual(L.TKR_width(true, null), 64);
  assert.strictEqual(L.TKR_width(true, "clients"), 320);
});

t("filterClients: filter, name order, then the caller's sort", () => {
  const cs = [{ id: 1, name: "beta" }, { id: 2, name: "Alpha" }, { id: 3, name: "Gamma" }, null, { name: "no id" }];
  assert.deepStrictEqual(L.TKR_filterClients(cs, "").map((c) => c.id), [2, 1, 3]);
  assert.deepStrictEqual(L.TKR_filterClients(cs, " AM ").map((c) => c.id), [3]);
  assert.deepStrictEqual(L.TKR_filterClients(cs, "", (a) => a.slice().reverse()).map((c) => c.id), [3, 1, 2]);
  assert.deepStrictEqual(L.TKR_filterClients(null, "x"), []);
});

// ---- Hover menus ----
t("hover timing copies HoverNav (open at once, 200ms close grace)", () => {
  assert.strictEqual(L.TKR_HOVER_OPEN_MS, 0);
  assert.strictEqual(L.TKR_HOVER_CLOSE_MS, 200);
  assert.strictEqual(L.TKR_FLY_GAP, 6);
  const hn = fs.readFileSync(path.join(__dirname, "..", "staff", "HoverNav.jsx"), "utf8");
  assert.ok(/setTimeout\(\(\) => setSpec\(null\), 200\)/.test(hn), "HoverNav still closes after 200ms");
  assert.ok(/rect\.right \+ 6/.test(hn), "HoverNav still sits 6px from the icon");
});

t("hoverOK: needs the switch, a mouse, pen or keyboard, and no panel already there", () => {
  const base = { enabled: true, source: "mouse", section: "people", pinned: false, pinnedSection: null, floatSec: null };
  assert.strictEqual(L.TKR_hoverOK(base), true);
  assert.strictEqual(L.TKR_hoverOK({ ...base, source: "key" }), true);
  assert.strictEqual(L.TKR_hoverOK({ ...base, source: "pen" }), true);
  assert.strictEqual(L.TKR_hoverOK({ ...base, source: "touch" }), false);
  assert.strictEqual(L.TKR_hoverOK({ ...base, source: "" }), false);
  assert.strictEqual(L.TKR_hoverOK({ ...base, enabled: false }), false);
  assert.strictEqual(L.TKR_hoverOK({ ...base, enabled: undefined }), false);
  assert.strictEqual(L.TKR_hoverOK({ ...base, section: "my" }), false);
  assert.strictEqual(L.TKR_hoverOK({ ...base, pinned: true, pinnedSection: "people" }), false, "pinned for this section");
  assert.strictEqual(L.TKR_hoverOK({ ...base, pinned: true, pinnedSection: "clients" }), true, "pinned for another section");
  assert.strictEqual(L.TKR_hoverOK({ ...base, floatSec: "clients" }), false, "a floating panel is open");
  assert.strictEqual(L.TKR_hoverOK(null), false);
});

t("pointerSource", () => {
  assert.strictEqual(L.TKR_pointerSource("mouse"), "mouse");
  assert.strictEqual(L.TKR_pointerSource("pen"), "pen");
  assert.strictEqual(L.TKR_pointerSource("touch"), "touch");
  assert.strictEqual(L.TKR_pointerSource(undefined), "");
});

const link = (r) => "#" + JSON.stringify(r);
const baseD = {
  isAdmin: true,
  isRoleAdmin: true,
  myRoute: { view: "profile", key: "me" },
  people: [{ id: "s1", name: "Ann", email: "a@x.org" }, { id: "s2", name: "Bo", email: "b@x.org" }],
  personRoute: (s) => ({ view: "person", staffId: s.id }),
  pinnedProjects: [{ id: "p2", name: "Two", color: "#111" }],
  projects: [{ id: "p1", name: "One", color: "#222", kind: "onboarding" }, { id: "p2", name: "Two", color: "#111" }],
  projectRoute: (p) => ({ view: "project", projectId: p.id }),
  pinnedClients: [{ id: 5, name: "Five" }],
  clients: [{ id: 5, name: "Five", tag: "Late" }, { id: 6, name: "Six" }],
  clientRoute: (c) => ({ view: "client", clientId: String(c.id) }),
  noTeam: [{ client_id: 9, client_name: "Nine", open_tasks: 1 }, { client_id: 8, client_name: "Eight", open_tasks: 3 }],
  clientTotal: 2,
  current: (r) => r.view === "client" && r.clientId === "6",
};

t("flyModel people: my profile first, admins also get Everyone; others only their own", () => {
  const m = L.TKR_flyModel("people", baseD);
  assert.strictEqual(m.title, "People");
  assert.deepStrictEqual(m.groups.map((g) => g.title), ["", "Everyone"]);
  assert.strictEqual(m.groups[0].items[0].label, "My profile");
  assert.deepStrictEqual(m.groups[1].items.map((i) => i.label), ["Ann", "Bo"]);
  assert.ok(L.TKR_flyItems(m).every((i) => i.route), "all real links");
  const m2 = L.TKR_flyModel("people", { ...baseD, isAdmin: false });
  assert.strictEqual(L.TKR_flyItems(m2).length, 1);
  assert.strictEqual(L.TKR_flyOpens(m2), false, "one item is only a label, like HoverNav");
  assert.strictEqual(L.TKR_flyOpens(m), true);
});

t("flyModel projects: pinned, all, New project action, Manage for role admins only", () => {
  const m = L.TKR_flyModel("projects", baseD);
  assert.deepStrictEqual(m.groups.map((g) => g.title), ["Pinned", "All projects", ""]);
  const all = m.groups[1].items;
  assert.strictEqual(all[0].tag, "Onboarding");
  assert.strictEqual(all[0].dot, "#222");
  const acts = m.groups[2].items;
  assert.deepStrictEqual(acts.map((i) => i.label), ["New project", "Manage projects"]);
  assert.strictEqual(acts[0].action, "newProject");
  assert.ok(!acts[0].route && acts[1].route.view === "manage");
  const m2 = L.TKR_flyModel("projects", { ...baseD, isRoleAdmin: false, pinnedProjects: [] });
  assert.deepStrictEqual(m2.groups.map((g) => g.title), ["", ""], "a lone All heading only repeats the flyout title");
  assert.deepStrictEqual(m2.groups[1].items.map((i) => i.label), ["New project"]);
});

t("flyModel clients: No team yet (admin), pinned, all, current flag, Find a client only past 8", () => {
  const m = L.TKR_flyModel("clients", baseD);
  assert.deepStrictEqual(m.groups.map((g) => g.title), ["No team yet", "Pinned", "All clients"]);
  assert.deepStrictEqual(m.groups[0].items.map((i) => i.tag), ["1 task", "3 tasks"]);
  assert.strictEqual(m.groups[2].items.find((i) => i.label === "Six").current, true);
  assert.strictEqual(m.groups[2].items.find((i) => i.label === "Five").current, false);
  assert.ok(!m.groups[2].items.some((i) => i.action));
  const plain = L.TKR_flyModel("clients", { ...baseD, isAdmin: false, pinnedClients: [] });
  assert.deepStrictEqual(plain.groups.map((g) => g.title), [""]);
  const nonAdmin = L.TKR_flyModel("clients", { ...baseD, isAdmin: false });
  assert.ok(!nonAdmin.groups.some((g) => g.title === "No team yet"));
  const many = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, name: "C" + i }));
  const big = L.TKR_flyModel("clients", { ...baseD, clients: many, clientTotal: 30, pinnedClients: [], noTeam: [] });
  const items = big.groups[0].items;
  assert.strictEqual(items.length, L.TKR_FLY_CAP + 1);
  const last = items[items.length - 1];
  assert.deepStrictEqual([last.label, last.action, last.tag], ["Find a client...", "panel", "30"]);
  assert.ok(!last.route);
});

t("flyModel: unique keys, junk input, unknown section", () => {
  ["people", "projects", "clients"].forEach((sec) => {
    const keys = [];
    L.TKR_flyModel(sec, baseD).groups.forEach((g) => g.items.forEach((i) => keys.push(g.key + "/" + i.key)));
    assert.strictEqual(new Set(keys).size, keys.length, sec);
  });
  assert.deepStrictEqual(L.TKR_flyModel("people", null).groups, []);
  assert.deepStrictEqual(L.TKR_flyModel("people", { people: "x", pinnedProjects: 3 }).groups, []);
  assert.deepStrictEqual(L.TKR_flyModel("nope", baseD).groups, []);
  assert.strictEqual(L.TKR_flyOpens(null), false);
  const capped = L.TKR_flyModel("people", { ...baseD, people: Array.from({ length: 20 }, (_, i) => ({ id: i, name: "P" + i })) }, 5);
  assert.strictEqual(capped.groups[1].items.length, 6);
  assert.strictEqual(capped.groups[1].items[5].action, "panel");
});

t("flyPos: right of the rail, level with the icon, kept inside the window", () => {
  const m = L.TKR_flyModel("projects", baseD);
  assert.deepStrictEqual(L.TKR_flyPos(68, 300, m, 1000), { left: 74, top: 300 });
  assert.strictEqual(L.TKR_flyPos(68, 990, m, 1000).top < 990, true);
  assert.strictEqual(L.TKR_flyPos(68, -50, m, 1000).top, 8);
  assert.strictEqual(L.TKR_flyPos(68, 500, m, 100).top, 8, "taller than the window sits at the top");
  assert.deepStrictEqual(L.TKR_flyPos("x", "y", null, 0), { left: 6, top: 8 });
});

t("keyboard: ArrowRight enters, Escape closes, arrows wrap inside the menu", () => {
  assert.strictEqual(L.TKR_triggerKey("ArrowRight", true), "enter");
  assert.strictEqual(L.TKR_triggerKey("Escape", true), "close");
  assert.strictEqual(L.TKR_triggerKey("ArrowRight", false), "");
  assert.strictEqual(L.TKR_triggerKey("ArrowDown", true), "");
  assert.deepStrictEqual(L.TKR_flyKey("Escape", 1, 4), { move: -1, close: true });
  assert.deepStrictEqual(L.TKR_flyKey("ArrowLeft", 1, 4), { move: -1, close: true });
  assert.deepStrictEqual(L.TKR_flyKey("ArrowDown", 3, 4), { move: 0, close: false });
  assert.deepStrictEqual(L.TKR_flyKey("ArrowUp", 0, 4), { move: 3, close: false });
  assert.deepStrictEqual(L.TKR_flyKey("End", 0, 4), { move: 3, close: false });
  assert.deepStrictEqual(L.TKR_flyKey("a", 0, 4), { move: -1, close: false });
  assert.deepStrictEqual(L.TKR_flyKey(" ", 1, 4), { move: -1, close: false, activate: true });
});

t("flyClampTop: the measured flyout stays inside the window", () => {
  assert.strictEqual(L.TKR_flyClampTop(300, 200, 1000), 300, "fits: level with the icon");
  assert.strictEqual(L.TKR_flyClampTop(400, 620, 900), 272, "pulled up so the bottom is 8px inside");
  assert.strictEqual(L.TKR_flyClampTop(400, 2000, 900), 8, "taller than the window: top at 8px");
  assert.strictEqual(L.TKR_flyClampTop("x", null, 0), 8);
});

// Wiring: the CSS widths match the logic, the scripts load, and the gate-off path is untouched.
const root = path.join(__dirname, "..", "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

t("wiring: index.html loads the logic before the views and the rail before the sidebar", () => {
  const html = read("index.html");
  const i = (s) => html.indexOf('"components/tasks/' + s + '"');
  assert.ok(i("TK_railLogic.js") > 0 && i("TK_SlateRail.jsx") > 0);
  assert.ok(i("TK_railLogic.js") < i("TK_SlateRail.jsx"));
  assert.ok(i("TK_SlateRail.jsx") < i("TK_Sidebar.jsx"));
});

t("wiring: --tkr-w in CSS matches TKR_width", () => {
  const css = read("components/tasks/tk-views.css");
  assert.ok(css.indexOf("--tkr-w: " + L.TKR_width(false, null) + "px") > 0);
  assert.ok(css.indexOf("--tkr-w: " + L.TKR_width(true, "people") + "px") > 0);
  assert.ok(new RegExp("left: " + (L.TKR_W_RAIL + L.TKR_W_GAP) + "px").test(css));
  assert.ok(new RegExp("width: " + L.TKR_W_PANEL + "px").test(css));
});

t("wiring: sidebar and app only switch on the gate", () => {
  const sb = read("components/tasks/TK_Sidebar.jsx");
  assert.ok(/props\.variant === "icons" && plusOn && typeof TKR_Rail === "function"/.test(sb));
  assert.ok(sb.indexOf('<nav className="tk-sidebar" aria-label="Task lists" data-tour="tk-sidebar">') > 0, "old nav markup kept");
  const app = read("components/tasks/TK_App.jsx");
  assert.ok(/var railPlus = !!\(rail && plusOn && typeof TKR_Rail === "function"\)/.test(app));
  assert.ok(/variant="icons"/.test(app));
  const rail = read("components/tasks/TK_SlateRail.jsx");
  ["tk-sidebar", "tk-review-nav", "tk-waiting-nav", "tk-recurring-nav", "tk-manage-nav", "tk-no-team"].forEach((k) => assert.ok(rail.indexOf('"' + k + '"') > 0, k));
});

console.log("TK_railLogic: " + n + " passed");
