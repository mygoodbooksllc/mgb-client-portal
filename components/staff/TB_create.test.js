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
const keys = (items) => items.filter((i) => !i.sep).map((i) => i.key);

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
  assert.deepStrictEqual(keys(items), ["task", "note", "request", "message"]);
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
  assert.deepStrictEqual(k, ["task", "note", "request", "message", "ask", "timeoff"]);
});
t("admin rows come after a separator and only for admins", () => {
  const a = C.CM_createItems({ client: null, isAdmin: true, tk: true });
  assert.deepStrictEqual(keys(a), ["task", "add-client", "team-review", "invite-staff"]);
  assert.strictEqual(a[1].sep, true);
  const c = C.CM_createItems({ client: { id: 2, name: "B" }, isAdmin: true, tk: true });
  assert.ok(keys(c).includes("invite-login"));
  const na = C.CM_createItems({ client: { id: 2, name: "B" }, isAdmin: false, tk: true });
  ["invite-login", "add-client", "team-review", "invite-staff"].forEach((k) => assert.ok(!keys(na).includes(k)));
});
t("admin with nothing else has no leading separator", () => {
  const a = C.CM_createItems({ client: null, isAdmin: true, tk: false });
  assert.notStrictEqual(a[0].sep, true);
});
t("navigation rows carry a hash", () => {
  C.CM_createItems({ client: null, isAdmin: true, tk: true })
    .filter((i) => !i.sep && i.kind.indexOf("go:") === 0)
    .forEach((i) => assert.ok(/^go:#\//.test(i.kind)));
});
console.log("TB_create.test.js: " + n + " tests passed");
