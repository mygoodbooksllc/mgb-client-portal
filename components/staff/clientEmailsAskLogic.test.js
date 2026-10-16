// node components/staff/clientEmailsAskLogic.test.js
const assert = require("assert");
const L = require("./clientEmailsAskLogic.js");
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

const clients = [
  { id: "acme", name: "Acme Church" },
  { id: "beta", name: "Beta Fund" },
  { id: "basic-test", name: "Basic Test", test_only: true },
  { id: "gamma", name: "Gamma Org", testOnly: true },
];

t("pilot missing / null / odd shapes = not set", () => {
  for (const v of [undefined, null, 5, { all: true }, "ALL", "some"]) {
    const p = L.CEA_pilotStatus(v, clients);
    assert.strictEqual(p.kind, "not_set", JSON.stringify(v));
    assert.strictEqual(p.count, 0);
  }
});

t('pilot "all" counts real clients only', () => {
  const p = L.CEA_pilotStatus("all", clients);
  assert.strictEqual(p.kind, "all");
  assert.strictEqual(p.count, 2);
  assert.deepStrictEqual(p.names, ["Acme Church", "Beta Fund"]);
  assert.strictEqual(p.label, "All real clients (2)");
});

t("pilot list names real clients, drops test clients, blanks, dupes, non-strings", () => {
  const p = L.CEA_pilotStatus(["acme", "acme", "basic-test", "", 7, "unknown-id"], clients);
  assert.strictEqual(p.kind, "list");
  assert.strictEqual(p.count, 2);
  assert.deepStrictEqual(p.names, ["Acme Church", "unknown-id"]);
  assert.ok(p.label.startsWith("2 clients: "));
});

t("pilot list of only test clients or empty = none", () => {
  assert.strictEqual(L.CEA_pilotStatus([], clients).kind, "none");
  assert.strictEqual(L.CEA_pilotStatus(["basic-test", "gamma"], clients).kind, "none");
});

t("one client is singular", () => {
  assert.strictEqual(L.CEA_pilotStatus(["beta"], clients).label, "1 client: Beta Fund");
});

t("status line reads Pilot list: <status>", () => {
  assert.strictEqual(L.CEA_statusLine({ pilot: L.CEA_pilotStatus(null, clients) }), "Pilot list: not set · no real client gets these emails, even with the switch on");
  assert.strictEqual(L.CEA_statusLine({ pilot: L.CEA_pilotStatus([], clients) }), "Pilot list: empty · no real client gets these emails, even with the switch on");
  assert.strictEqual(L.CEA_statusLine({ pilot: L.CEA_pilotStatus("all", clients) }), "Pilot list: All real clients (2)");
  assert.strictEqual(L.CEA_statusLine({ pilot: L.CEA_pilotStatus(["beta"], clients) }), "Pilot list: 1 client: Beta Fund");
});

t("status line warns when nobody real is in the pilot", () => {
  assert.ok(/no real client/.test(L.CEA_statusLine({ pilot: L.CEA_pilotStatus(null, clients) })));
  assert.ok(/no real client/.test(L.CEA_statusLine({ pilot: L.CEA_pilotStatus([], clients) })));
  assert.ok(!/no real client/.test(L.CEA_statusLine({ pilot: L.CEA_pilotStatus("all", clients) })));
});

t("confirm text names exactly who is emailed", () => {
  const list = L.CEA_confirmText({ pilot: L.CEA_pilotStatus(["acme"], clients), masterOn: true });
  assert.ok(list.includes("1 real client: Acme Church."));
  assert.ok(list.includes("Every other real client stays a dry run"));
  assert.ok(list.includes("[Test] copy to the sender only"));
  assert.ok(!list.includes("Send client emails is off"));
  const all = L.CEA_confirmText({ pilot: L.CEA_pilotStatus("all", clients), masterOn: true });
  assert.ok(all.includes("ALL 2 real clients"));
  const none = L.CEA_confirmText({ pilot: L.CEA_pilotStatus(null, clients), masterOn: false });
  assert.ok(none.includes("not set, so no real client will be emailed"));
  assert.ok(none.includes("Send client emails is off"));
});

t("only the owner can toggle; others see Owner only", () => {
  assert.deepStrictEqual(L.CEA_rowState({ isOwner: true }), { canToggle: true, note: "" });
  assert.deepStrictEqual(L.CEA_rowState({ isOwner: true, busy: "settings" }), { canToggle: false, note: "" });
  assert.deepStrictEqual(L.CEA_rowState({ isOwner: false }), { canToggle: false, note: "Owner only" });
  assert.deepStrictEqual(L.CEA_rowState({}), { canToggle: false, note: "Owner only" });
});

t("hint states off = dry run, on = pilot only, test = [Test] copy to sender", () => {
  const h = L.CEA_hint();
  assert.ok(/dry run/.test(h));
  assert.ok(/pilot list only/.test(h));
  assert.ok(/\[Test\] copy, sent only to the staff member/.test(h));
});

t("last change line", () => {
  assert.strictEqual(L.CEA_lastChange(null), "");
  assert.strictEqual(
    L.CEA_lastChange({ new_value: true, changed_by: "o@x.test", changed_at: "2026-10-16T10:00:00Z" }, () => "just now"),
    "Turned on by o@x.test · just now"
  );
  assert.strictEqual(L.CEA_lastChange({ new_value: false, changed_by: "system" }), "Turned off by a database admin");
});

t("save errors", () => {
  assert.strictEqual(L.CEA_saveError({ message: "tk_owner_only" }), "Only the owner can turn Ask client emails on or off.");
  assert.strictEqual(L.CEA_saveError({ message: "boom" }), "Couldn't save: boom");
});

console.log(`clientEmailsAskLogic: ${n} tests passed`);
