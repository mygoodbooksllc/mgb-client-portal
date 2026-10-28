// node components/tasks/TK_workloadLogic.test.js
// Slate plus workload strip: pure logic, the shared gate resolver and wiring.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const L = require("./TK_workloadLogic.js");
const G = require("./TK_slatePlus.js");
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
const U = (i) => "00000000-0000-4000-8000-00000000000" + i;
const raw = [
  { staff_id: U(1), email: "Ana@x.org", name: "Ana Ruiz", role: "bookkeeper", is_me: false, open_count: 9, due_week: 3, late_count: null },
  { staff_id: U(2), email: "ben@x.org", name: "Ben Ode", role: "bookkeeper", is_me: false, open_count: 4, due_week: 7, late_count: null },
  { staff_id: U(3), email: "me@x.org", name: "Me Person", role: "admin", is_me: true, open_count: 2, due_week: 3, late_count: null },
  { staff_id: null, email: "", name: "junk" },
  null,
];

t("rows: cleaned, lower-cased, busiest this week first, ties by late then open", () => {
  const r = L.TKW_rows(raw);
  assert.deepStrictEqual(r.map((x) => x.email), ["ben@x.org", "ana@x.org", "me@x.org"]);
  assert.strictEqual(r[1].late, null);
  assert.strictEqual(r[2].me, true);
});
t("rows: bad numbers become 0, not NaN", () => {
  const r = L.TKW_rows([{ email: "a@x", open_count: "x", due_week: -3, late_count: "2" }]);
  assert.deepStrictEqual([r[0].open, r[0].week, r[0].late], [0, 0, 2]);
  assert.deepStrictEqual(L.TKW_rows(null), []);
});
t("late column only when the server sends late counts (grace period off)", () => {
  assert.strictEqual(L.TKW_lateOn(L.TKW_rows(raw)), false);
  assert.strictEqual(L.TKW_lateOn(L.TKW_rows([{ email: "a@x", late_count: 0 }])), true);
});
t("bar is relative to the busiest person", () => {
  const r = L.TKW_rows(raw);
  assert.strictEqual(L.TKW_barPct(r[0], r), 100);
  assert.strictEqual(L.TKW_barPct(r[1], r), 43);
  assert.strictEqual(L.TKW_barPct(r[0], [{ week: 0 }]), 0);
});
t("click: own row -> Slate; others -> their list for admins only", () => {
  const r = L.TKW_rows(raw);
  const me = r.find((x) => x.me);
  const ana = r.find((x) => x.email === "ana@x.org");
  assert.strictEqual(L.TKW_href(me, false), "#/tasks/my");
  assert.strictEqual(L.TKW_href(ana, true), "#/tasks/u/" + U(1));
  assert.strictEqual(L.TKW_href(ana, false), null);
  assert.strictEqual(L.TKW_href({ id: "not-a-uuid", me: false }, true), null);
  assert.strictEqual(L.TKW_href({ id: "javascript:alert(1)", me: false }, true), null);
});
t("compact line: first names, You, cap with +N more, empty for one person", () => {
  const r = L.TKW_rows(raw);
  assert.strictEqual(L.TKW_compactLine(r), "Ben 7 · Ana 3 · You 3");
  assert.strictEqual(L.TKW_compactLine(r, 2), "Ben 7 · Ana 3 · +1 more");
  assert.strictEqual(L.TKW_compactLine([r[0]]), "");
});
t("title text names the counts (late only when counted)", () => {
  const r = L.TKW_rows(raw);
  assert.strictEqual(L.TKW_title(r[0]), "Ben Ode: 4 open, 7 due this week");
  assert.ok(/1 late/.test(L.TKW_title({ name: "A", open: 1, week: 1, late: 1 })));
});
t("collapsed state reads the one key, safe on errors", () => {
  assert.strictEqual(L.TKW_readCollapsed((k) => (k === L.TKW_COLLAPSE_KEY ? "collapsed" : null)), true);
  assert.strictEqual(L.TKW_readCollapsed(() => null), false);
  assert.strictEqual(L.TKW_readCollapsed(() => { throw new Error("blocked"); }), false);
});
t("gate: preview or switch turns it on; View as always off; default off", () => {
  assert.strictEqual(G.TKP_isOn(false, false, false), false);
  assert.strictEqual(G.TKP_isOn(false, true, false), true);
  assert.strictEqual(G.TKP_isOn(false, false, true), true);
  assert.strictEqual(G.TKP_isOn(true, true, true), false);
  assert.strictEqual(G.TKP_PREVIEW_KEY, "mgb_slateplus_preview");
  assert.ok(G.TKP_switchValue(true) && G.TKP_switchValue("true") && G.TKP_switchValue({ on: true }));
  assert.ok(!G.TKP_switchValue(false) && !G.TKP_switchValue(null) && !G.TKP_switchValue("false"));
});

const root = path.join(__dirname, "..", "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
t("wiring: scripts and css load, gate file never writes the switch", () => {
  const html = read("index.html");
  ["TK_slatePlus.js", "TK_workloadLogic.js", "TK_Workload.jsx", "tk-workload.css"].forEach((f) => assert.ok(html.includes("components/tasks/" + f), f));
  assert.ok(html.indexOf("TK_Workload.jsx") < html.indexOf("TK_MyTasks.jsx"));
  const gate = read("components/tasks/TK_slatePlus.js");
  assert.ok(!/\.(upsert|insert|update|delete)\(/.test(gate), "gate is read-only");
  const ui = read("components/tasks/TK_Workload.jsx");
  assert.ok(!/\.(upsert|insert|update|delete)\(/.test(ui), "strip is read-only");
  assert.ok(/TKP_useOn\(\)/.test(ui));
});
t("wiring: Slate mounts the strip and the Unassigned line only when not embedded", () => {
  const my = read("components/tasks/TK_MyTasks.jsx");
  assert.ok(/!embedded && typeof TK_WorkloadStrip === "function" \? <TK_WorkloadStrip/.test(my));
  assert.ok(/g\.key === "unassigned" && !embedded && !g\.collapsed && typeof TK_WorkloadLine === "function"/.test(my));
});
t("wiring: Feature flags row reloads, Dev Tools switch row present", () => {
  const app = read("app.jsx");
  assert.ok(/key: "mgb_slateplus_preview",[\s\S]{0,900}?reloads: true/.test(app));
  assert.ok(app.includes('["slateplus_enabled", "Slate plus for all staff (owner only)"'));
});
console.log("TK_workloadLogic: " + n + " passed");
