// Plain node, no framework: `node components/staff/TB_create.test.js`.
// Guards the "+ Create" gate (TB_create.js): the pure resolver's truth table,
// the preview flag / switch cache reads, and which rows the menu builder
// returns for a client page, off one, and for admins.
const assert = require("assert");
const C = require("./TB_create.js");

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
const keys = (items) => items.filter((i) => !i.sep && i.kind !== "label").map((i) => i.key);

t("resolver: off with neither", () => {
  assert.strictEqual(C.CM_createIsOn(false, undefined), false);
  assert.strictEqual(C.CM_createIsOn(false, null), false);
  assert.strictEqual(C.CM_createIsOn(false, false), false);
  assert.strictEqual(C.CM_createIsOn(false, "false"), false);
  assert.strictEqual(C.CM_createIsOn("1", undefined), false); // only a real true counts
});
t("resolver: preview or firm switch turns it on", () => {
  assert.strictEqual(C.CM_createIsOn(true, undefined), true);
  assert.strictEqual(C.CM_createIsOn(false, true), true);
  assert.strictEqual(C.CM_createIsOn(false, "true"), true);
  assert.strictEqual(C.CM_createIsOn(false, { on: true }), true);
  assert.strictEqual(C.CM_createIsOn(false, { on: false }), false);
});
t("preview key and storage failure", () => {
  global.window = { localStorage: { getItem: () => "1" } };
  assert.strictEqual(C.CM_previewOn(), true);
  global.window = { localStorage: { getItem: () => null } };
  assert.strictEqual(C.CM_previewOn(), false);
  global.window = { localStorage: { getItem: () => { throw new Error("blocked"); } } };
  assert.strictEqual(C.CM_previewOn(), false);
  delete global.window;
});
t("client page, non-admin, no Desk additions", () => {
  const items = C.CM_createItems({ client: { id: 1, name: "Acme" }, isAdmin: false, tk: true });
  assert.deepStrictEqual(keys(items), ["task", "note", "request", "upload", "message"]);
  assert.strictEqual(items[0].kbd, "q");
});
t("no client, non-admin, nothing available = empty", () => {
  assert.deepStrictEqual(C.CM_createItems({ client: null, isAdmin: false, tk: false }), []);
});
t("no client, tasks only", () => {
  assert.deepStrictEqual(keys(C.CM_createItems({ client: null, isAdmin: false, tk: true })), ["task"]);
});
t("no client with Desk additions and time off", () => {
  const k = keys(C.CM_createItems({ client: null, isAdmin: false, tk: true, deskPlus: true, timeOff: true }));
  assert.deepStrictEqual(k, ["task", "message", "ask", "timeoff"]);
});
t("client page merges Desk additions", () => {
  const k = keys(C.CM_createItems({ client: { id: 1, name: "A" }, isAdmin: false, tk: true, deskPlus: true, timeOff: true }));
  assert.deepStrictEqual(k, ["task", "note", "request", "upload", "message", "ask", "timeoff"]);
});
t("admin rows come after a separator and an Admin label, only for admins", () => {
  const a = C.CM_createItems({ client: null, isAdmin: true, tk: true });
  assert.deepStrictEqual(keys(a), ["task", "add-client", "team-review", "invite-staff"]);
  assert.strictEqual(a[1].sep, true);
  assert.strictEqual(a[2].kind, "label");
  assert.strictEqual(a[2].label, "Admin");
  assert.strictEqual(a.filter((i) => i.kind === "label").length, 1);
  const c = C.CM_createItems({ client: { id: 2, name: "B" }, isAdmin: true, tk: true });
  assert.ok(keys(c).includes("invite-login"));
  const na = C.CM_createItems({ client: { id: 2, name: "B" }, isAdmin: false, tk: true });
  ["invite-login", "add-client", "team-review", "invite-staff"].forEach((k) => assert.ok(!keys(na).includes(k)));
  assert.strictEqual(na.filter((i) => i.kind === "label").length, 0);
});
t("staff-level rows stay above the Admin group", () => {
  const c = C.CM_createItems({ client: { id: 2, name: "B" }, isAdmin: true, tk: true, template: true });
  const at = c.findIndex((i) => i.kind === "label");
  assert.deepStrictEqual(keys(c.slice(0, at)), ["task", "note", "request", "upload", "message", "template"]);
  assert.deepStrictEqual(keys(c.slice(at)), ["invite-login", "add-client", "team-review", "invite-staff"]);
});
t("admin with nothing else has no leading separator", () => {
  const a = C.CM_createItems({ client: null, isAdmin: true, tk: false });
  assert.notStrictEqual(a[0].sep, true);
  assert.strictEqual(a[0].kind, "label");
});
t("Upload a file needs a client and no gate; any staff level", () => {
  assert.ok(keys(C.CM_createItems({ client: { id: 1, name: "A" }, isAdmin: false, tk: false })).includes("upload"));
  assert.ok(!keys(C.CM_createItems({ client: null, isAdmin: true, tk: true, deskPlus: true })).includes("upload"));
});
t("Start from a template needs a client and the template flag", () => {
  const client = { id: 1, name: "A" };
  assert.ok(!keys(C.CM_createItems({ client, isAdmin: false, tk: true })).includes("template"));
  assert.ok(keys(C.CM_createItems({ client, isAdmin: false, tk: true, template: true })).includes("template"));
  assert.ok(!keys(C.CM_createItems({ client: null, isAdmin: false, tk: true, template: true })).includes("template"));
  const row = C.CM_createItems({ client, isAdmin: false, tk: true, template: true }).find((i) => i.key === "template");
  assert.strictEqual(row.label, "Start from a template");
  assert.strictEqual(row.kind, "template");
});
t("navigation rows carry a hash", () => {
  C.CM_createItems({ client: null, isAdmin: true, tk: true })
    .filter((i) => !i.sep && i.kind !== "label" && i.kind.indexOf("go:") === 0)
    .forEach((i) => assert.ok(/^go:#\//.test(i.kind)));
});
console.log("TB_create.test.js: " + n + " tests passed");

t("Slate app: New project and Recurring task rows, and no Admin group", () => {
  const k = (a) => a.map((i) => i.key);
  const s = C.CM_createItems({ client: null, isAdmin: true, tk: true, template: true, deskPlus: true, timeOff: true, slate: true });
  assert.deepStrictEqual(k(s), ["task", "message", "project", "recurring", "ask", "timeoff"]);
  const p = C.CM_createItems({ client: null, isAdmin: true, tk: true, template: true, deskPlus: true, timeOff: true });
  assert.ok(k(p).includes("add-client") && !k(p).includes("recurring") && !k(p).includes("project"));
});

t("Slate page in the portal: Slate rows plus the Admin group", () => {
  const k = (a) => a.map((i) => i.key);
  const s = C.CM_createItems({ client: null, isAdmin: true, tk: true, template: true, slatePage: true });
  assert.ok(k(s).includes("project") && k(s).includes("recurring") && k(s).includes("add-client"));
});
