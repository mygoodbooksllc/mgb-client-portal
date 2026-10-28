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
