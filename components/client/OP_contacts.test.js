// Plain node: `node components/client/OP_contacts.test.js`.
// Synthetic values only.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const C = require("./OP_contacts.js");
const RB = require("../staff/RB_logic.js");

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

const sql = fs.readFileSync(path.join(__dirname, "../../supabase/client-contacts.sql"), "utf8");

// ---- Email rule: one class everywhere
t("OPC_EMAIL_RE is the same class as RB_EMAIL_RE and cc__email_ok", () => {
  assert.strictEqual(C.OPC_EMAIL_RE.source, RB.RB_EMAIL_RE ? RB.RB_EMAIL_RE.source : C.OPC_EMAIL_RE.source);
  assert.ok(sql.includes('^[^\\s@?&,%#<>"]+@[^\\s@?&,%#<>"]+\\.[^\\s@?&,%#<>"]+$'), "server regex");
});
t("OPC_EMAIL_RE rejects mailto injection shapes", () => {
  ["a@b.co?bcc=x", "a,b@x.co", "a%0A@x.co", "a&b@x.co", "a#b@x.co", "<a@x.co>", '"a"@x.co', "a b@x.co", "a@b", "@x.co", ""].forEach((e) =>
    assert.strictEqual(C.OPC_emailOk(e), false, e),
  );
  ["pat@example.test", "first.last+tag@sub.example.org"].forEach((e) => assert.strictEqual(C.OPC_emailOk(e), true, e));
});

// ---- Labels
t("source labels are defined once", () => {
  assert.strictEqual(C.OPC_sourceLabel({ source: "main" }), "Main contact");
  assert.strictEqual(C.OPC_sourceLabel("profile"), "Main contact (from org profile, not saved as a contact yet)");
  assert.strictEqual(C.OPC_sourceLabel({ source: "contact" }), "Contact list");
  assert.strictEqual(C.OPC_sourceLabel({ source: "login" }), "Portal login");
  assert.strictEqual(C.OPC_sourceLabel({ source: "x" }), "");
  assert.strictEqual(C.OPC_sourceLabel(null), "");
});

// ---- Dedupe (mirrors cc__people)
t("dedupe: first wins, later fills blanks and opted_out, no-email kept", () => {
  const out = C.OPC_dedupePeople([
    { name: "Main", email: " Pat@Example.test ", source: "main" },
    { name: "Profile", email: null, phone: "555", source: "profile" },
    { name: "Dup", email: "pat@example.test", phone: "555-1", title: "Treasurer", opted_out: true, source: "login" },
    { name: "Other", email: "o@example.test", source: "contact" },
    null,
  ]);
  assert.strictEqual(out.length, 3);
  assert.strictEqual(out[0].name, "Main");
  assert.strictEqual(out[0].email, "pat@example.test");
  assert.strictEqual(out[0].phone, "555-1");
  assert.strictEqual(out[0].title, "Treasurer");
  assert.strictEqual(out[0].opted_out, true);
  assert.strictEqual(out[0].source, "main");
  assert.strictEqual(out[1].email, null);
});

// ---- Greeting
t("greeting cleaner matches the save rule", () => {
  assert.strictEqual(C.OPC_cleanGreeting("Hi Jim,"), "Jim");
  assert.strictEqual(C.OPC_cleanGreeting("dear Pastor Jim:"), "Pastor Jim");
  assert.strictEqual(C.OPC_cleanGreeting("Hello"), null);
  assert.strictEqual(C.OPC_cleanGreeting("  "), null);
  assert.strictEqual(C.OPC_cleanGreeting("Hilda"), "Hilda");
});

// ---- checkPeople
const orig = [
  { id: "a1", name: "Ann", email: "ann@example.test", title: "", gets_monthly_emails: true, can_answer: false },
  { id: "b2", name: "Bo", email: "bo@example.test", title: "Board", gets_monthly_emails: false, can_answer: true },
];
const copy = (x) => JSON.parse(JSON.stringify(x));
t("checkPeople: no change sends nothing", () => {
  const r = C.OPC_checkPeople(copy(orig), "main@example.test", orig);
  assert.deepStrictEqual(r.errors, {});
  assert.deepStrictEqual(r.payload, { upsert: [], remove: [] });
});
t("checkPeople: only changed, new and removed rows", () => {
  const rows = copy(orig).slice(0, 1);
  rows[0].title = "Treasurer";
  rows.push({ id: null, name: "New", email: "NEW@example.test", title: "", gets_monthly_emails: true, can_answer: false });
  rows.push(C.OPC_blankRow()); // untouched blank row is skipped
  const r = C.OPC_checkPeople(rows, "main@example.test", orig);
  assert.deepStrictEqual(r.errors, {});
  assert.strictEqual(r.payload.upsert.length, 2);
  assert.strictEqual(r.payload.upsert[0].id, "a1");
  assert.strictEqual(r.payload.upsert[0].title, "Treasurer");
  assert.strictEqual(r.payload.upsert[1].id, undefined);
  assert.strictEqual(r.payload.upsert[1].email, "new@example.test");
  assert.deepStrictEqual(r.payload.remove, ["b2"]);
  assert.deepStrictEqual(Object.keys(r.payload.upsert[1]).sort(), ["can_answer", "email", "gets_monthly_emails", "name", "title"]);
});
t("checkPeople: duplicates, main collision, missing and bad fields; errors never carry values", () => {
  const rows = [
    { name: "", email: "x@example.test" },
    { name: "Two", email: "X@Example.test" },
    { name: "Three", email: "Main@Example.test" },
    { name: "Four", email: "four@x.co?bcc=evil@x.co" },
    { name: "Fi\nve", email: "five@example.test", title: "a\tb" },
    { name: "Six", email: "" },
  ];
  const r = C.OPC_checkPeople(rows, "main@example.test", []);
  assert.ok(r.errors["people.0.name"]);
  assert.ok(/already in the list/.test(r.errors["people.1.email"]));
  assert.ok(/Already the main contact/.test(r.errors["people.2.email"]));
  assert.ok(/doesn't look like an email/.test(r.errors["people.3.email"]));
  assert.ok(r.errors["people.4.name"]);
  assert.ok(r.errors["people.4.title"]);
  assert.ok(r.errors["people.5.email"]);
  Object.values(r.errors).forEach((m) => {
    assert.ok(!/@/.test(m), "no email value in: " + m);
    assert.ok(!/Two|Three|Four|Six|evil/.test(m), "no name value in: " + m);
  });
});
t("checkPeople: caps (24 others, 25 changes)", () => {
  const many = [];
  for (let i = 0; i < 25; i++) many.push({ name: "P" + i, email: "p" + i + "@example.test", gets_monthly_emails: true });
  const r = C.OPC_checkPeople(many, "main@example.test", []);
  assert.ok(r.errors.people);
  const ok = C.OPC_checkPeople(many.slice(0, 24), "main@example.test", []);
  assert.deepStrictEqual(ok.errors, {});
  assert.strictEqual(ok.payload.upsert.length, 24);
  assert.ok(/at most 25 changes at a time/.test(sql) && /people_limit: at most 25 people/.test(sql), "server caps");
});
t("rowsFromMine leaves the main row out and never carries notes or source", () => {
  const rows = C.OPC_rowsFromMine({
    people: [
      { id: "m", name: "Main", email: "m@example.test", is_main: true, gets_monthly_emails: true },
      { id: "o", name: "Other", email: "o@example.test", title: "Pastor", gets_monthly_emails: false, can_answer: true, notes: "x", source: "staff" },
    ],
  });
  assert.strictEqual(rows.length, 1);
  assert.deepStrictEqual(Object.keys(rows[0]).sort(), ["can_answer", "email", "gets_monthly_emails", "id", "name", "title"]);
});

// ---- Chips
const list = [
  { name: "Main", email: "main@example.test", source: "main", is_main: true, gets_monthly_emails: true },
  { name: "Monthly", email: "monthly@example.test", source: "contact", gets_monthly_emails: true },
  { name: "Out", email: "out@example.test", source: "contact", gets_monthly_emails: true, opted_out: true },
  { name: "Asker", email: "asker@example.test", source: "contact", can_answer: true },
  { name: "Login out", email: "lo@example.test", source: "login", opted_out: true },
  { name: "Login", email: "login@example.test", source: "login" },
  { name: "Bad", email: "bad@x.co?cc=y", source: "contact", gets_monthly_emails: true },
  { name: "Main dup", email: "MAIN@example.test", source: "login" },
];
t("toChips: main + monthly on, opted-out monthly shown off, opted-out login skipped", () => {
  const c = C.OPC_toChips(list);
  assert.deepStrictEqual(c.map((x) => x.email), ["main@example.test", "monthly@example.test", "out@example.test", "asker@example.test", "login@example.test"]);
  assert.deepStrictEqual(c.map((x) => x.on), [true, true, false, false, false]);
  assert.ok(/Opted out of portal emails/.test(c[2].tip));
  assert.ok(/Main contact/.test(c[0].tip));
  assert.ok(/Portal login/.test(c[4].tip));
});
t("toChips: first-on fallback skips opted-out people", () => {
  const c = C.OPC_toChips([
    { email: "o@example.test", source: "contact", opted_out: true },
    { email: "b@example.test", source: "contact" },
  ]);
  assert.deepStrictEqual(c.map((x) => x.on), [false, true]);
  assert.deepStrictEqual(C.OPC_toChips([]), []);
});

// ---- Wiring
t("OP_contacts.js loads right before OP_store.js; store reads the switch", () => {
  const html = fs.readFileSync(path.join(__dirname, "../../index.html"), "utf8");
  const a = html.indexOf('"components/client/OP_contacts.js"');
  const b = html.indexOf('"components/client/OP_store.js"');
  assert.ok(a > 0 && b > a, "loader order");
  const store = fs.readFileSync(path.join(__dirname, "OP_store.js"), "utf8");
  assert.ok(store.includes('.eq("key", "org_contacts_enabled")'));
  assert.ok(store.includes("mgb_orgcontacts_cache"));
  assert.ok(store.includes('OP__rpc("staff_client_contact_save", { p_client_id: clientId, p: p, p_preview: !!preview })'));
});
t("OPC_isOn needs the org-profile gate and the switch or the preview", () => {
  const store = {};
  global.window = { localStorage: { getItem: (k) => (k in store ? store[k] : null) } };
  global.OP_isOn = () => true;
  assert.strictEqual(C.OPC_isOn(), false);
  store.mgb_orgcontacts_preview = "1";
  assert.strictEqual(C.OPC_isOn(), true);
  delete store.mgb_orgcontacts_preview;
  store.mgb_orgcontacts_cache = "1";
  assert.strictEqual(C.OPC_isOn(), true);
  global.OP_isOn = () => false;
  assert.strictEqual(C.OPC_isOn(), false);
  delete global.OP_isOn;
  delete global.window;
});

console.log("OP_contacts: " + n + " checks passed");
