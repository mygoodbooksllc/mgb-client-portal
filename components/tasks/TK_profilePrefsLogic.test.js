// node components/tasks/TK_profilePrefsLogic.test.js
// Slate plus profile 2: customization logic (docs/slateplus-profile2-spec.md §4, §12.3).
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const L = require("./TK_profilePrefsLogic.js");
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

t("normalize: missing row -> defaults; share defaults with time on", () => {
  const p = L.TKP2_normalize(null);
  assert.strictEqual(p.status_line, null);
  assert.deepStrictEqual(p.focus_goals, []);
  assert.deepStrictEqual(p.skills, []);
  assert.deepStrictEqual(p.pinned_client_ids, []);
  assert.deepStrictEqual(p.favorites, []);
  assert.strictEqual(p.time_zone, null);
  assert.deepStrictEqual(p.share, { status: true, about: true, focus: false, pins: false, favorites: false, time: true });
  assert.deepStrictEqual(p.section_order, L.TKP2_SECTION_KEYS);
  assert.deepStrictEqual(p.hidden_sections, []);
  assert.deepStrictEqual(p.org, { manager: null, reports: [] });
  assert.deepStrictEqual(p.teams, []);
  assert.strictEqual(L.TKP2_SHARE_DEFAULTS.time, true);
});

t("normalize: another person's card keeps unshared fields null (no defaults filled in)", () => {
  const card = {
    email: "B@x.org", is_self: false, status_line: " Busy ", bio: null, skills: null, focus_goals: null,
    pinned_client_ids: ["acme"], pinned_project_ids: null, favorites: null, time_zone: null,
    section_order: ["about", "zzz", "header", "about"], hidden_sections: ["tasks", "pins", "pins"],
    org: { manager: { email: "c@x.org", name: "Cee" }, reports: [{ email: "d@x.org", name: "Dee" }, null] },
    teams: [{ id: U(1), name: "Close", color: "sage" }, { id: null }],
  };
  const p = L.TKP2_normalize(card);
  assert.strictEqual(p.email, "b@x.org");
  assert.strictEqual(p.isSelf, false);
  assert.strictEqual(p.status_line, "Busy");
  assert.strictEqual(p.skills, null);
  assert.strictEqual(p.focus_goals, null);
  assert.strictEqual(p.favorites, null);
  assert.strictEqual(p.pinned_project_ids, null);
  assert.deepStrictEqual(p.pinned_client_ids, ["acme"]);
  assert.strictEqual(p.time_zone, null);
  assert.deepStrictEqual(p.section_order.slice(0, 2), ["header", "about"]);
  assert.deepStrictEqual(p.hidden_sections, ["pins"]);
  assert.strictEqual(p.org.manager.email, "c@x.org");
  assert.strictEqual(p.org.reports.length, 1);
  assert.strictEqual(p.teams.length, 1);
});

t("mergeOrder: drops unknown and duplicates, header first, appends new keys in default order", () => {
  const o = L.TKP2_mergeOrder(["tasks", "bogus", "pins", "tasks", "header"]);
  assert.strictEqual(o[0], "header");
  assert.deepStrictEqual(o.slice(1, 3), ["tasks", "pins"]);
  assert.strictEqual(o.length, L.TKP2_SECTION_KEYS.length);
  assert.deepStrictEqual(o.slice(3), L.TKP2_SECTION_KEYS.filter((k) => !["header", "tasks", "pins"].includes(k)));
  assert.deepStrictEqual(L.TKP2_mergeOrder(null), L.TKP2_SECTION_KEYS);
});

t("hidden filter refuses non-hideable keys; visibleSections drops self-only for others", () => {
  assert.deepStrictEqual(L.TKP2_hiddenFilter(["tasks", "header", "glance", "load", "defaultview", "about", "nope"]), ["about"]);
  assert.strictEqual(L.TKP2_canHide("tasks"), false);
  assert.strictEqual(L.TKP2_canHide("shoutouts"), true);
  const mine = L.TKP2_visibleSections([], ["about", "tasks"], true);
  assert.ok(mine.includes("tasks") && !mine.includes("about") && mine.includes("defaultview"));
  const theirs = L.TKP2_visibleSections([], [], false);
  assert.ok(!theirs.includes("defaultview"));
  assert.deepStrictEqual(L.TKP2_FIXED, ["header", "glance", "load", "tasks", "defaultview"]);
});

t("move: up/down swaps, header never moves", () => {
  const o = L.TKP2_move([], "glance", -1);
  assert.deepStrictEqual(o.slice(0, 3), ["header", "glance", "pins"]);
  assert.deepStrictEqual(L.TKP2_move([], "pins", -1).slice(0, 2), ["header", "pins"]);
  assert.strictEqual(L.TKP2_move([], "header", 1)[0], "header");
  const last = L.TKP2_SECTION_KEYS[L.TKP2_SECTION_KEYS.length - 1];
  assert.strictEqual(L.TKP2_move([], last, 1).slice(-1)[0], last);
});

t("favorite URL rule is the trigger's regex", () => {
  const sql = fs.readFileSync(path.join(__dirname, "../../supabase/slateplus-profile2.sql"), "utf8");
  assert.ok(sql.includes("^https://[^\\s<>\"']{3,500}$"), "SQL comment documents the same rule");
  assert.ok(sql.includes("char_length(v_txt) not between 11 and 508"));
  assert.strictEqual(String(L.TKP2_URL_RE), String(/^https:\/\/[^\s<>"']{3,500}$/));
  assert.strictEqual(L.TKP2_urlOk("https://example.com/a?b=1"), true);
  assert.strictEqual(L.TKP2_urlOk("  https://example.com  "), true);
  assert.strictEqual(L.TKP2_urlOk("http://example.com"), false);
  assert.strictEqual(L.TKP2_urlOk("javascript:alert(1)"), false);
  assert.strictEqual(L.TKP2_urlOk("data:text/html,x"), false);
  assert.strictEqual(L.TKP2_urlOk("https://a b.com"), false);
  assert.strictEqual(L.TKP2_urlOk('https://x.com/"onload'), false);
  assert.strictEqual(L.TKP2_urlOk("https://ab"), false);
  assert.strictEqual(L.TKP2_urlOk("https://" + "a".repeat(500)), true);
  assert.strictEqual(L.TKP2_urlOk("https://" + "a".repeat(501)), false);
  assert.strictEqual(L.TKP2_favoriteOk({ kind: "sop", sop_id: U(1), client_id: "acme", label: "Close" }), true);
  assert.strictEqual(L.TKP2_favoriteOk({ kind: "sop", sop_id: "x", client_id: "acme", label: "Close" }), false);
  assert.strictEqual(L.TKP2_favoriteOk({ kind: "link", url: "https://a.com", label: "" }), false);
  assert.strictEqual(L.TKP2_favoriteOk({ kind: "other", label: "x" }), false);
});

t("validate mirrors the trigger rules", () => {
  assert.strictEqual(L.TKP2_validate({ status_line: "x".repeat(140) }), "");
  assert.ok(L.TKP2_validate({ status_line: "x".repeat(141) }));
  assert.ok(L.TKP2_validate({ focus_goals: [{ text: "a" }, { text: "b" }, { text: "c" }, { text: "d" }] }));
  assert.ok(L.TKP2_validate({ focus_goals: [{ text: " " }] }));
  assert.ok(L.TKP2_validate({ skills: Array.from({ length: 13 }, (_, i) => "s" + i) }));
  assert.strictEqual(L.TKP2_validate({ skills: Array.from({ length: 13 }, () => "Same") }), "");
  assert.ok(L.TKP2_validate({ favorites: [{ kind: "link", url: "http://a.com", label: "x" }] }));
  assert.ok(L.TKP2_validate({ section_order: ["nope"] }));
  assert.ok(L.TKP2_validate({ hidden_sections: ["tasks"] }));
  assert.ok(L.TKP2_validate({ time_zone: "CST" }));
  assert.ok(L.TKP2_validate({ focus_quarter: "2026-Q5" }));
  assert.ok(L.TKP2_validate({ share: { time: "yes" } }));
  assert.strictEqual(L.TKP2_validate({ time_zone: "America/Phoenix", share: { time: false } }), "");
  assert.deepStrictEqual(L.TKP2_cleanSkills([" Payroll ", "payroll", "", "Grants"]), ["Payroll", "Grants"]);
});

t("quarter label in America/Chicago at quarter boundaries", () => {
  // 2026-10-01 00:30 Central = 05:30 UTC -> Q4; 04:30 UTC is still Sep 30 in Chicago -> Q3.
  assert.strictEqual(L.TKP2_quarterOf(new Date("2026-10-01T05:30:00Z")), "2026-Q4");
  assert.strictEqual(L.TKP2_quarterOf(new Date("2026-10-01T04:30:00Z")), "2026-Q3");
  // New Year: 2027-01-01 05:59 UTC is Dec 31 23:59 CST -> 2026-Q4.
  assert.strictEqual(L.TKP2_quarterOf(new Date("2027-01-01T05:59:00Z")), "2026-Q4");
  assert.strictEqual(L.TKP2_quarterOf(new Date("2027-01-01T06:00:00Z")), "2027-Q1");
  assert.strictEqual(L.TKP2_quarterLabel("2026-Q4"), "Q4 2026");
  assert.strictEqual(L.TKP2_quarterLabel("junk"), "");
  assert.strictEqual(L.TKP2_quarterIsOld("2026-Q3", new Date("2026-10-28T15:00:00Z")), true);
  assert.strictEqual(L.TKP2_quarterIsOld("2026-Q4", new Date("2026-10-28T15:00:00Z")), false);
  assert.strictEqual(L.TKP2_quarterIsOld(null, new Date()), false);
});

t("zone rule: IANA names only (no abbreviations, offsets, Etc/)", () => {
  assert.strictEqual(L.TKP2_zoneOk("America/Chicago"), true);
  assert.strictEqual(L.TKP2_zoneOk("America/Phoenix"), true);
  assert.strictEqual(L.TKP2_zoneOk("America/Argentina/Buenos_Aires"), true);
  assert.strictEqual(L.TKP2_zoneOk("UTC"), true);
  assert.strictEqual(L.TKP2_zoneOk("CST"), false);
  assert.strictEqual(L.TKP2_zoneOk("EST"), false);
  assert.strictEqual(L.TKP2_zoneOk("+05:00"), false);
  assert.strictEqual(L.TKP2_zoneOk("Mars/Base"), false);
  assert.strictEqual(L.TKP2_zoneOk("Etc/GMT+5"), false);
  assert.strictEqual(L.TKP2_zoneOk(null), false);
});

t("zone list: common US zones first, Intl list after, fallback US only", () => {
  const z = L.TKP2_zoneList(() => ["Europe/Paris", "America/Chicago", "Etc/GMT+5", "CST", "Asia/Tokyo", "Europe/Paris"]);
  assert.deepStrictEqual(z.common.map((x) => x.label), ["Eastern", "Central", "Mountain", "Arizona", "Pacific", "Alaska", "Hawaii"]);
  assert.deepStrictEqual(z.other.map((x) => x.id), ["Asia/Tokyo", "Europe/Paris"]);
  const f = L.TKP2_zoneList(() => {
    throw new Error("no Intl");
  });
  assert.strictEqual(f.common.length, 7);
  assert.deepStrictEqual(f.other, []);
  assert.strictEqual(L.TKP2_zoneLabel("America/Los_Angeles"), "Pacific");
  assert.strictEqual(L.TKP2_zoneLabel("America/Argentina/Buenos_Aires"), "America/Argentina/Buenos Aires");
});

t("localTime formats a given instant in a zone; null/invalid zone -> null (never the browser zone)", () => {
  const at = new Date("2026-10-28T20:42:00Z"); // 3:42 PM CDT, 1:42 PM PDT, 1:42 PM MST (Phoenix)
  assert.strictEqual(L.TKP2_localTime(at, "America/Chicago"), "3:42 PM");
  assert.strictEqual(L.TKP2_localTime(at, "America/Los_Angeles"), "1:42 PM");
  assert.strictEqual(L.TKP2_localTime(at, "America/Phoenix"), "1:42 PM");
  assert.strictEqual(L.TKP2_localTime(at, null), null);
  assert.strictEqual(L.TKP2_localTime(at, "CST"), null);
  assert.strictEqual(L.TKP2_localTime(at, "Mars/Base"), null);
  assert.strictEqual(L.TKP2_localTimeLine(at, "America/Chicago"), "Local time 3:42 PM · Central");
  assert.strictEqual(L.TKP2_localTimeLine(at, null), null);
});

t("same-as-you detection and offset text (mine unset = firm time)", () => {
  const at = new Date("2026-10-28T20:42:00Z");
  assert.strictEqual(L.TKP2_offsetMinutes(at, "America/Chicago"), -300);
  assert.strictEqual(L.TKP2_offsetMinutes(at, "UTC"), 0);
  assert.strictEqual(L.TKP2_sameAsYou("America/Chicago", null, at), true);
  assert.strictEqual(L.TKP2_sameAsYou("America/Winnipeg", "America/Chicago", at), true);
  assert.strictEqual(L.TKP2_sameAsYou("America/Los_Angeles", "America/Chicago", at), false);
  assert.strictEqual(L.TKP2_sameAsYou(null, "America/Chicago", at), false);
  assert.strictEqual(L.TKP2_offsetText("America/Los_Angeles", "America/Chicago", at), "2 hours behind you");
  assert.strictEqual(L.TKP2_offsetText("America/New_York", null, at), "1 hour ahead of you");
  assert.strictEqual(L.TKP2_offsetText("Asia/Kolkata", "UTC", at), "5 hours 30 minutes ahead of you");
  assert.strictEqual(L.TKP2_offsetText("America/Chicago", null, at), "");
  assert.strictEqual(L.TKP2_offsetText(null, null, at), "");
  // Arizona has no DST: in January it is 1 hour behind Central, in October 2.
  assert.strictEqual(L.TKP2_offsetText("America/Phoenix", null, new Date("2027-01-15T18:00:00Z")), "1 hour behind you");
});

console.log("TK_profilePrefsLogic: " + n + " passed");
