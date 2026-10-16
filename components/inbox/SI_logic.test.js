// Plain node, no framework: `node components/inbox/SI_logic.test.js`.
// Guards which person the inbox opens on when asked to open on an email.

const assert = require("assert");
const L = require("./SI_logic.js");

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

const A1 = { kind: "client", clientId: "A", email: "pat@example.com", name: "Pat at A" };
const B1 = { kind: "client", clientId: "B", email: "pat@example.com", name: "Pat at B" };
const B2 = { kind: "client", clientId: "B", email: "sam@example.com", name: "Sam at B" };
const all = [A1, B1, B2];

t("with a client named, the same email picks that client's person", () => {
  assert.strictEqual(L.SI_findInitialEntry(all, "pat@example.com", "B"), B1);
  assert.strictEqual(L.SI_findInitialEntry(all, "pat@example.com", "A"), A1);
});

t("with a client named, a person who isn't on that client is not opened", () => {
  assert.strictEqual(L.SI_findInitialEntry(all, "sam@example.com", "A"), null);
  assert.strictEqual(L.SI_findInitialEntry([A1], "pat@example.com", "B"), null);
});

t("with no client named, the first match on the email wins (a client's Messages tab)", () => {
  assert.strictEqual(L.SI_findInitialEntry(all, "pat@example.com", null), A1);
  assert.strictEqual(L.SI_findInitialEntry(all, "sam@example.com", undefined), B2);
});

t("the email compares trimmed and in lower case", () => {
  assert.strictEqual(L.SI_findInitialEntry(all, "  Sam@Example.COM ", "B"), B2);
});

t("nothing to open on: no email, no entries, no match", () => {
  assert.strictEqual(L.SI_findInitialEntry(all, "", "A"), null);
  assert.strictEqual(L.SI_findInitialEntry(all, null, "A"), null);
  assert.strictEqual(L.SI_findInitialEntry([], "pat@example.com", "A"), null);
  assert.strictEqual(L.SI_findInitialEntry(null, "pat@example.com", "A"), null);
  assert.strictEqual(L.SI_findInitialEntry(all, "nobody@example.com", null), null);
});

console.log("SI_logic: " + n + " checks passed");
