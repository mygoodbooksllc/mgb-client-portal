// Plain node: `node components/client/OP_logic.test.js`.
// Synthetic values only.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const L = require("./OP_logic.js");

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

const TODAY = "2026-10-23";
const full = () => ({
  card_name: "Example Org",
  org_type: "Nonprofit",
  established_date: "1998-05-01",
  established_unknown: false,
  gift_same_as_org: false,
  gift_address: "1 Sample St, Springfield, ST 00000",
  receiver_name: "Front desk",
  courier_phone: "(555) 010-0000",
  contact_name: "Pat Example",
  contact_email: "Pat@Example.test",
  contact_phone: "",
  fiscal_year_end: "06-30",
  gtk: {},
});

// ---- Agrees with the server (supabase/client-org-profile.sql)
const sql = fs.readFileSync(path.join(__dirname, "../../supabase/client-org-profile.sql"), "utf8");
t("phone pattern matches the save RPC", () => {
  assert.ok(sql.includes("v_phone_re text := '^[0-9+().\\-\\s x]+$'"));
  assert.strictEqual(L.OP_PHONE_RE.source, "^[0-9+().\\-\\s x]+$");
});
t("length caps match the save RPC", () => {
  const caps = { card_name: 200, org_type: 120, receiver_name: 120, courier_phone: 40, contact_name: 120, contact_email: 254, contact_phone: 40, fiscal_year_end: 10 };
  Object.keys(caps).forEach((k) => {
    assert.ok(new RegExp("op__txt\\(p, '" + k + "', " + caps[k] + "\\)").test(sql), k);
    if (L.OP_LIMITS[k] !== undefined) assert.strictEqual(L.OP_LIMITS[k], caps[k], k);
  });
  assert.ok(/op__txt\(p, 'gift_address', 500\)/.test(sql));
  assert.strictEqual(L.OP_LIMITS.gift_address, 500);
});
t("get-to-know keys match the save RPC", () => {
  L.OP_GTK_FIELDS.forEach((f) => assert.ok(new RegExp("'" + f.key + "',\\s+public\\.op__txt\\(v_gtk_in, '" + f.key + "', 300").test(sql), f.key));
  assert.strictEqual(L.OP_GTK_FIELDS.length, 5);
});

// ---- Completeness
t("a full form is complete", () => {
  const r = L.OP_checkForm(full(), { today: TODAY });
  assert.deepStrictEqual(r.errors, {});
  assert.deepStrictEqual(r.missing, []);
  assert.strictEqual(r.complete, true);
  assert.strictEqual(r.payload.contact_email, "pat@example.test", "email lowercased");
  assert.ok(!("get_to_know" in r.payload), "no answers typed: nothing sent");
});
t("each required field missing makes it incomplete", () => {
  ["card_name", "org_type", "established_date", "gift_address", "receiver_name", "courier_phone", "contact_name", "fiscal_year_end"].forEach((k) => {
    const f = full();
    f[k] = "  ";
    const r = L.OP_checkForm(f, { today: TODAY });
    assert.strictEqual(r.complete, false, k);
    assert.ok(r.missing.includes(k), k);
  });
});
t("Not sure counts for the established date", () => {
  const f = full();
  f.established_date = "";
  f.established_unknown = true;
  const r = L.OP_checkForm(f, { today: TODAY });
  assert.strictEqual(r.complete, true);
  assert.strictEqual(r.payload.established_date, null);
});
t("Not sure drops a typed date", () => {
  const f = full();
  f.established_unknown = true;
  assert.strictEqual(L.OP_checkForm(f, { today: TODAY }).payload.established_date, null);
});
t("email or phone is enough for the contact", () => {
  const f = full();
  f.contact_email = "";
  assert.strictEqual(L.OP_checkForm(f, { today: TODAY }).complete, false);
  f.contact_phone = "555 010 0001";
  assert.strictEqual(L.OP_checkForm(f, { today: TODAY }).complete, true);
});
t("same as organization address uses the org address", () => {
  const f = full();
  f.gift_address = "";
  f.gift_same_as_org = true;
  const ok = L.OP_checkForm(f, { today: TODAY, orgAddress: "2 Sample Ave, Springfield, ST 00000" });
  assert.strictEqual(ok.complete, true);
  assert.strictEqual(ok.payload.gift_address, null, "the server copies it");
  assert.strictEqual(ok.payload.gift_same_as_org, true);
  const bad = L.OP_checkForm(f, { today: TODAY, orgAddress: "  " });
  assert.ok(bad.errors.gift_address);
  assert.strictEqual(bad.complete, false);
});
t("OP_isComplete agrees", () => {
  assert.strictEqual(L.OP_isComplete(full()), true);
  assert.strictEqual(L.OP_isComplete({}), false);
  assert.strictEqual(L.OP_isComplete(null), false);
});

// ---- Validation
t("dates: real, 1800 to today", () => {
  const f = full();
  f.established_date = "2026-02-30";
  assert.ok(L.OP_checkForm(f, { today: TODAY }).errors.established_date);
  f.established_date = "1799-12-31";
  assert.ok(L.OP_checkForm(f, { today: TODAY }).errors.established_date);
  f.established_date = "2026-10-24";
  assert.ok(L.OP_checkForm(f, { today: TODAY }).errors.established_date, "tomorrow");
  f.established_date = "2026-10-23";
  assert.ok(!L.OP_checkForm(f, { today: TODAY }).errors.established_date, "today ok");
  f.established_date = "1800-01-01";
  assert.ok(!L.OP_checkForm(f, { today: TODAY }).errors.established_date);
});
t("fiscal year end: MM-DD in a leap year", () => {
  assert.strictEqual(L.OP_validFye("02-29"), true);
  assert.strictEqual(L.OP_validFye("02-30"), false);
  assert.strictEqual(L.OP_validFye("12-31"), true);
  assert.strictEqual(L.OP_validFye("13-01"), false);
  assert.strictEqual(L.OP_validFye("6-30"), false);
  assert.strictEqual(L.OP_validFye(""), false);
});
t("phones and email", () => {
  const f = full();
  f.courier_phone = "555-0100 ext 2";
  assert.ok(L.OP_checkForm(f, { today: TODAY }).errors.courier_phone, "letters other than x");
  f.courier_phone = "+1 (555) 010-0000 x12";
  assert.ok(!L.OP_checkForm(f, { today: TODAY }).errors.courier_phone);
  f.contact_email = "nope@";
  assert.ok(L.OP_checkForm(f, { today: TODAY }).errors.contact_email);
  f.contact_phone = "1".repeat(41);
  assert.ok(L.OP_checkForm(f, { today: TODAY }).errors.contact_phone);
});
t("caps block a save", () => {
  const f = full();
  f.card_name = "a".repeat(201);
  const r = L.OP_checkForm(f, { today: TODAY });
  assert.ok(r.errors.card_name);
  assert.strictEqual(r.complete, false);
});
t("get to know: only typed answers are sent, trimmed, capped", () => {
  const f = full();
  f.gtk = { favorite_treat: "  Example treat ", hobbies: "", allergies: "   ", junk: "x" };
  const r = L.OP_checkForm(f, { today: TODAY });
  assert.deepStrictEqual(r.payload.get_to_know, { favorite_treat: "Example treat" });
  f.gtk = { team_note: "y".repeat(301) };
  assert.ok(L.OP_checkForm(f, { today: TODAY }).errors["gtk.team_note"]);
});
t("error messages never echo the value", () => {
  const f = full();
  f.contact_email = "secret-value@";
  f.courier_phone = "secret-phone!";
  const r = L.OP_checkForm(f, { today: TODAY });
  assert.ok(!/secret/.test(JSON.stringify(r.errors)));
});

// ---- Prefill
t("prefill: profile first, then RPC prefill", () => {
  const mine = {
    profile: null,
    prefill: { name: "Example Org", entity_type: "501(c)(3)", org_type: null, org_address: "", fiscal_year_end: "12-31", user_name: "Pat Example", user_email: "pat@example.test" },
  };
  const f = L.OP_initialForm(mine);
  assert.strictEqual(f.card_name, "Example Org");
  assert.strictEqual(f.org_type, "501(c)(3)");
  assert.strictEqual(f.fiscal_year_end, "12-31");
  assert.strictEqual(f.contact_name, "Pat Example");
  assert.strictEqual(f.contact_email, "pat@example.test");
  assert.strictEqual(f.gift_same_as_org, false);
  assert.deepStrictEqual(Object.keys(f.gtk), L.OP_GTK_FIELDS.map((x) => x.key));
  const saved = L.OP_initialForm({ profile: { card_name: "Card Name", established_date: "2001-02-03", gift_same_as_org: true }, prefill: { name: "Example Org", org_address: "2 Sample Ave" } });
  assert.strictEqual(saved.card_name, "Card Name");
  assert.strictEqual(saved.established_date, "2001-02-03");
  assert.strictEqual(saved.gift_same_as_org, true);
  const noAddr = L.OP_initialForm({ profile: { gift_same_as_org: true }, prefill: { org_address: "" } });
  assert.strictEqual(noAddr.gift_same_as_org, false, "can't keep same-as-org with no org address");
  assert.doesNotThrow(() => L.OP_initialForm(null));
  // Key dates is free text: only a valid MM-DD prefills the picker.
  assert.strictEqual(L.OP_initialForm({ profile: null, prefill: { fiscal_year_end: "12/31" } }).fiscal_year_end, "");
  assert.strictEqual(L.OP_initialForm({ profile: null, prefill: { fiscal_year_end: " 06-30 " } }).fiscal_year_end, "06-30");
});

// ---- Anniversaries (server: base + make_interval(years => n))
t("next anniversary: this year, later this year, next year", () => {
  assert.deepStrictEqual(L.OP_nextAnniversary("2020-11-01", "2026-10-23"), { date: "2026-11-01", years: 6 });
  assert.deepStrictEqual(L.OP_nextAnniversary("2020-10-23", "2026-10-23"), { date: "2026-10-23", years: 6 }, "today counts");
  assert.deepStrictEqual(L.OP_nextAnniversary("2020-01-15", "2026-10-23"), { date: "2027-01-15", years: 7 });
});
t("Feb 29 lands on Feb 28 in other years", () => {
  assert.deepStrictEqual(L.OP_nextAnniversary("2020-02-29", "2027-01-01"), { date: "2027-02-28", years: 7 });
  assert.deepStrictEqual(L.OP_nextAnniversary("2020-02-29", "2028-01-01"), { date: "2028-02-29", years: 8 });
  assert.deepStrictEqual(L.OP_nextAnniversary("2020-02-29", "2027-02-28"), { date: "2027-02-28", years: 7 });
});
t("no anniversary in the first year or with no date", () => {
  assert.strictEqual(L.OP_nextAnniversary("2026-10-01", "2026-09-01"), null);
  assert.deepStrictEqual(L.OP_nextAnniversary("2025-11-01", "2026-10-23"), { date: "2026-11-01", years: 1 });
  assert.strictEqual(L.OP_nextAnniversary(null, TODAY), null);
  assert.strictEqual(L.OP_nextAnniversary("not a date", TODAY), null);
  assert.deepStrictEqual(L.OP_nextAnniversary("2020-11-01T00:00:00Z", TODAY), { date: "2026-11-01", years: 6 }, "timestamps use the date part");
});
t("days between", () => {
  assert.strictEqual(L.OP_daysBetween("2026-10-23", "2026-11-22"), 30);
  assert.strictEqual(L.OP_daysBetween("2026-12-31", "2027-01-01"), 1);
  assert.strictEqual(L.OP_daysBetween("x", "2027-01-01"), null);
});

// ---- Budget
t("budget warning outside $30-45", () => {
  assert.strictEqual(L.OP_budgetWarning(40), null);
  assert.strictEqual(L.OP_budgetWarning("30"), null);
  assert.strictEqual(L.OP_budgetWarning(45), null);
  assert.ok(/Under/.test(L.OP_budgetWarning(29.99)));
  assert.ok(/Over/.test(L.OP_budgetWarning(45.01)));
  assert.ok(L.OP_budgetWarning(501));
  assert.ok(L.OP_budgetWarning(-1));
  assert.ok(L.OP_budgetWarning("abc"));
  assert.strictEqual(L.OP_budgetWarning(""), null);
  assert.strictEqual(L.OP_DEFAULT_AMOUNT, 40);
});

// ---- Formatting and the digest line
t("formatting", () => {
  assert.strictEqual(L.OP_fmtDate("2027-03-04"), "Mar 4, 2027");
  assert.strictEqual(L.OP_fmtDate("2027-03-04T10:00:00Z"), "Mar 4, 2027");
  assert.strictEqual(L.OP_fmtDate(""), "");
  // Timestamps show the LOCAL day (a US evening is already tomorrow in UTC).
  const ev = new Date(2026, 9, 23, 21, 30); // local 9:30 pm, Oct 23
  assert.strictEqual(L.OP_fmtStamp(ev.toISOString()), "Oct 23, 2026");
  assert.strictEqual(L.OP_fmtStamp("2027-03-04"), "Mar 4, 2027");
  assert.strictEqual(L.OP_fmtStamp(null), "");
  assert.strictEqual(L.OP_fmtMonthDay("06-30"), "June 30");
  assert.strictEqual(L.OP_fmtMonthDay("02-30"), "");
  assert.strictEqual(L.OP_yearsLabel(1), "1 year");
  assert.strictEqual(L.OP_yearsLabel(5), "5 years");
  assert.strictEqual(L.OP_occasionLabel("established"), "Founded");
  assert.strictEqual(L.OP_occasionLabel("client_since"), "Client since");
});
t("digest line counts distinct clients, same wording as the digest", () => {
  const ts = fs.readFileSync(path.join(__dirname, "../../supabase/functions/weekly-admin-digest/orgAnniversaries.ts"), "utf8");
  assert.ok(ts.includes("Anniversaries coming up: ${n} ${n === 1 ? \"client\" : \"clients\"}"));
  assert.strictEqual(L.OP_digestLine([]), "Anniversaries coming up: 0 clients");
  assert.strictEqual(L.OP_digestLine([{ client_id: "a" }, { client_id: "a" }]), "Anniversaries coming up: 1 client");
  assert.strictEqual(L.OP_digestLine([{ client_id: "a" }, { client_id: "b" }, null]), "Anniversaries coming up: 2 clients");
});
t("gift status pills", () => {
  assert.strictEqual(L.OP_giftStatus({ gift_status: "sent" }).label, "Sent");
  assert.strictEqual(L.OP_giftStatus({ gift_status: "skipped" }).label, "Skipped");
  assert.strictEqual(L.OP_giftStatus({ gift_status: "planned" }).label, "Planned");
  assert.strictEqual(L.OP_giftStatus({}).key, "none");
});

t("gift basis: two choices, client_since is the default, same values as the server", () => {
  assert.deepStrictEqual(L.OP_GIFT_BASES.map((b) => b.value), ["client_since", "established"]);
  assert.ok(/default/i.test(L.OP_GIFT_BASES[0].label));
  assert.strictEqual(L.OP_giftBasisValid("client_since"), true);
  assert.strictEqual(L.OP_giftBasisValid("established"), true);
  ["both", "", null, undefined, "Established", true].forEach((v) => assert.strictEqual(L.OP_giftBasisValid(v), false));
  assert.strictEqual(L.OP_giftBasisNorm("established"), "established");
  ["client_since", "x", null, undefined].forEach((v) => assert.strictEqual(L.OP_giftBasisNorm(v), "client_since"));
  assert.strictEqual(L.OP_giftBasisLabel("established"), "Founding date");
  assert.strictEqual(L.OP_giftBasisLabel(null), "Client since");
  const sql = fs.readFileSync(path.join(__dirname, "../../supabase/client-org-gift-basis.sql"), "utf8");
  assert.ok(sql.includes("not in ('client_since', 'established')"), "server accepts the same two values");
  assert.ok(sql.includes("'org_gift_basis'"), "server key name");
  assert.ok(!/\bdelete\b/i.test(sql.replace(/--.*$/gm, "")), "migration deletes nothing");
});
t("gift basis: Client gifts tab wires the admin RPCs", () => {
  const store = fs.readFileSync(path.join(__dirname, "OP_store.js"), "utf8");
  assert.ok(store.includes('OP__rpc("admin_gift_basis")'));
  assert.ok(store.includes('OP__rpc("admin_set_gift_basis", { p_basis: basis })'));
  const tab = fs.readFileSync(path.join(__dirname, "../staff/OP_GiftsTab.jsx"), "utf8");
  assert.ok(tab.includes('data-tour="op-gifts-basis"'));
  assert.ok(tab.includes("OP_api.setGiftBasis"));
});

console.log("OP_logic: " + n + " checks passed");
