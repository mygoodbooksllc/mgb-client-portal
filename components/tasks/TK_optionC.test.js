// node components/tasks/TK_optionC.test.js
var assert = require("assert");
var fs = require("fs");
var path = require("path");
var L = require("./TK_optionCLogic.js");

var n = 0;
function test(name, fn) {
  fn();
  n++;
  console.log("ok " + n + " " + name);
}

var clients = [
  { id: "c1", org_type: "Church", entity_type: "nonprofit" },
  { id: "c2", org_type: "Organization", entity_type: "nonprofit" },
  { id: "c3", org_type: "Organization", entity_type: "for_profit" },
  { id: "c4", org_type: "Church", entity_type: "nonprofit", test_only: true },
  { id: "c5", org_type: "Bookkeeping Firm", entity_type: "for_profit" },
  { id: "c6", org_type: "church", entity_type: "" },
  { id: "c7", org_type: "Organization", entity_type: "for_profit", is_internal: true },
];
// window.CLIENTS shape (camelCase), what the Templates page really passes
var camel = [
  { id: "k1", orgType: "Church", entityType: "nonprofit" },
  { id: "k2", orgType: "Organization", entityType: "nonprofit" },
  { id: "k3", orgType: "Organization", entityType: "for_profit" },
  { id: "k4", orgType: "Church", entityType: "nonprofit", testOnly: true },
  { id: "k5", orgType: "Bookkeeping Firm", entityType: "for_profit", isInternal: true },
  { id: "k6", orgType: "Organization", entityType: "for_profit", testOnly: true },
];

test("type of a client", function () {
  assert.strictEqual(L.TK_optionCTypeOf(clients[0]), "church");
  assert.strictEqual(L.TK_optionCTypeOf(clients[1]), "nonprofit");
  assert.strictEqual(L.TK_optionCTypeOf(clients[2]), "for_profit");
  assert.strictEqual(L.TK_optionCTypeOf(clients[5]), "church");
  assert.strictEqual(L.TK_optionCTypeOf(null), "for_profit");
});

test("test, internal and firm rows are never included", function () {
  assert.deepStrictEqual(L.TK_optionCClientsOf("church", clients), ["c1", "c6"]);
  assert.deepStrictEqual(L.TK_optionCClientsOf("nonprofit", clients), ["c2"]);
  assert.deepStrictEqual(L.TK_optionCClientsOf("for_profit", clients), ["c3"]);
  assert.deepStrictEqual(L.TK_optionCClientsOf("church", null), []);
});

test("camelCase client rows (window.CLIENTS) classify and filter the same", function () {
  assert.deepStrictEqual(L.TK_optionCClientsOf("church", camel), ["k1"]);
  assert.deepStrictEqual(L.TK_optionCClientsOf("nonprofit", camel), ["k2"]);
  assert.deepStrictEqual(L.TK_optionCClientsOf("for_profit", camel), ["k3"]);
});

test("a same-title template for other clients does not block this type", function () {
  var tpls = [{ title: "Year-end close and adjusting entries", status: "draft", client_ids: ["c1", "c6"] }];
  var byType = function (type) {
    var m = {};
    L.TK_optionCPlan(type, clients, tpls).items.forEach(function (it) { m[it.title] = it.exists; });
    return m["Year-end close and adjusting entries"];
  };
  assert.strictEqual(byType("church"), true);
  assert.strictEqual(byType("nonprofit"), false);
  assert.strictEqual(byType("for_profit"), false);
  var all = [{ title: "Year-end close and adjusting entries", status: "active", client_ids: [] }];
  assert.strictEqual(L.TK_optionCPlan("nonprofit", clients, all).items.filter(function (i) { return i.exists; }).length, 1, "no client list = every client");
});

test("plan marks titles that already exist (retired ones do not count)", function () {
  var tpls = [
    { title: "  quarterly giving   STATEMENTS ", status: "active" },
    { title: "Year-end close and adjusting entries", status: "retired" },
  ];
  var p = L.TK_optionCPlan("church", clients, tpls);
  assert.deepStrictEqual(p.clientIds, ["c1", "c6"]);
  var byTitle = {};
  p.items.forEach(function (it) { byTitle[it.title] = it.exists; });
  assert.strictEqual(byTitle["Quarterly giving statements"], true);
  assert.strictEqual(byTitle["Year-end close and adjusting entries"], false);
  assert.ok(p.occasional.length > 0);
  assert.deepStrictEqual(L.TK_optionCPlan("nope", clients, []).items, []);
});

test("no filing is ever suggested (filings stay on Deadlines)", function () {
  var filing = /\b(990|1099-?(nec|misc)?\s+filing|w-2\b|941|940|1096)\b/i;
  Object.keys(L.TK_OPTION_C_SUGGESTIONS).forEach(function (k) {
    L.TK_OPTION_C_SUGGESTIONS[k].forEach(function (s) {
      assert.ok(!filing.test(s.title), s.title);
      assert.ok(s.cadence === "quarterly" || s.cadence === "annually", s.title);
      assert.ok(s.days >= -90 && s.days <= 120, s.title);
      assert.ok(s.lead >= 0 && s.lead <= 60, s.title);
    });
  });
});

test("payload matches the tk_save_template keys", function () {
  var p = L.TK_optionCPayload("for_profit", "Year-end package for the CPA", ["c3"]);
  assert.deepStrictEqual(p.due_rule, { type: "offset", days: 60 });
  assert.strictEqual(p.due_offset_days, 60);
  assert.strictEqual(p.cadence, "annually");
  assert.strictEqual(p.period_basis, "calendar");
  assert.deepStrictEqual(p.client_ids, ["c3"]);
  assert.strictEqual(p.assignee_email, "");
  assert.strictEqual(p.leave_unassigned, false);
  assert.ok(!("email_kind" in p) && !("status" in p) && !("firm_part" in p));
  assert.strictEqual(L.TK_optionCPayload("for_profit", "Not a suggestion", ["c3"]), null);
  // the same key set TK_tplToPayload sends
  var T = require("./TK_templateLogic.js");
  var std = T.TK_tplToPayload({ title: "x", cadence: "annually", rule: { type: "offset", days: 5 }, description: "d" });
  assert.deepStrictEqual(Object.keys(p).sort(), Object.keys(std).sort());
});

test("display sections: template quarter/year tasks with no section only", function () {
  var tasks = [
    { id: 1, source: "template", period_kind: "quarter", section: null },
    { id: 2, source: "template", period_kind: "year", section: "" },
    { id: 3, source: "template", period_kind: "month", section: null },
    { id: 4, source: "asana", period_kind: "quarter", section: null },
    { id: 5, source: "template", period_kind: "quarter", section: "Monthly" },
  ];
  var out = L.TK_optionCApplySections(tasks);
  assert.strictEqual(out[0].section, "Quarterly");
  assert.strictEqual(out[1].section, "Annual");
  assert.strictEqual(out[2], tasks[2]);
  assert.strictEqual(out[3], tasks[3]);
  assert.strictEqual(out[4], tasks[4]);
  assert.strictEqual(tasks[0].section, null, "input not mutated");
  var same = [tasks[2], tasks[4]];
  assert.strictEqual(L.TK_optionCApplySections(same), same);
});

test("wiring: rhythm-gated, admin only, drafts only, source order", function () {
  var root = path.join(__dirname, "..", "..");
  var html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  var a = html.indexOf("components/tasks/TK_closeOrderLogic.js");
  var b = html.indexOf("components/tasks/TK_optionCLogic.js");
  var c = html.indexOf("components/tasks/TK_OptionC.jsx");
  var d = html.indexOf("components/tasks/TK_Templates.jsx");
  assert.ok(a > 0 && b > a, "logic after close order logic");
  assert.ok(c > 0 && d > 0 && c < d, "panel before TK_Templates.jsx");
  var tpl = fs.readFileSync(path.join(__dirname, "TK_Templates.jsx"), "utf8");
  assert.ok(/isAdmin && rhythmOn && typeof TK_OptionCPanel === "function"/.test(tpl), "panel gated");
  var panel = fs.readFileSync(path.join(__dirname, "TK_OptionC.jsx"), "utf8");
  assert.ok(/TK_api\.saveTemplate\(null,/.test(panel), "new templates only");
  assert.ok(!/activateTemplate|setTemplateStatus|tk_set_template_status|"active"/.test(panel), "never activates");
  var list = fs.readFileSync(path.join(__dirname, "TK_List.jsx"), "utf8");
  assert.ok(/route\.view === "client"[^\n]*TK_rhythmEnabled\(\)[^\n]*TK_optionCApplySections/.test(list), "section fallback: client lists, rhythm-gated");
});

console.log("all " + n + " passed");
