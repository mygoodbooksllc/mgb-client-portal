// Plain node, no framework: `node components/inbox/TM_logic.test.js`.
// Guards the thread menu rules (TM_logic.js, docs/thread-menu-spec.md 4-5 and
// 9): the wake rules, the full-page filter and sort, counts, search
// inclusion, which menu items show, snooze times in Chicago, the wake timer,
// label and task text limits, the copy link, the focus choice, and that the
// Desk's own menus are unchanged.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const WB = require("../workbench/WB_logic.js");
// TM_logic calls these at run time as globals, as in the browser.
global.WB_snoozeUntil = WB.WB_snoozeUntil;
global.WB_today = WB.WB_today;
global.WB_addDays = WB.WB_addDays;
const L = require("./TM_logic.js");

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

const NOW = Date.parse("2026-10-20T15:00:00Z"); // Tue 10am Chicago (CDT)
const iso = (ms) => new Date(ms).toISOString();
const H = 3600000;
const D = 86400000;

function entry(key, o) {
  return Object.assign(
    { key: key, kind: "client", name: key.toUpperCase(), lastAt: iso(NOW - H), lastClientAt: iso(NOW - 2 * H), lastId: "m-" + key },
    o || {},
  );
}
function team(key, o) {
  return Object.assign({ key: key, kind: "team", name: key, lastAt: iso(NOW - 3 * H) }, o || {});
}

// ---- entry extras ----
t("lastClientAt ignores internal and staff rows; lastId = newest row", () => {
  const rows = [
    { id: "a", author_kind: "staff", internal: false, created_at: "2026-10-20T14:00:00Z" },
    { id: "b", author_kind: "client", internal: true, created_at: "2026-10-20T13:00:00Z" },
    { id: "c", author_kind: "client", internal: false, created_at: "2026-10-20T12:00:00Z" },
    { id: "d", author_kind: "client", internal: false, created_at: "2026-10-20T11:00:00Z" },
  ];
  assert.deepStrictEqual(L.TM_entryExtras(rows), { lastClientAt: "2026-10-20T12:00:00Z", lastId: "a" });
  assert.deepStrictEqual(L.TM_entryExtras([rows[0], rows[1]]), { lastClientAt: null, lastId: "a" });
  assert.deepStrictEqual(L.TM_entryExtras(null), { lastClientAt: null, lastId: null });
});

t("clientAfter: strictly newer, junk is false", () => {
  assert.strictEqual(L.TM_clientAfter("2026-10-20T12:00:01Z", "2026-10-20T12:00:00Z"), true);
  assert.strictEqual(L.TM_clientAfter("2026-10-20T12:00:00Z", "2026-10-20T12:00:00Z"), false);
  assert.strictEqual(L.TM_clientAfter(null, "2026-10-20T12:00:00Z"), false);
  assert.strictEqual(L.TM_clientAfter("2026-10-20T12:00:00Z", null), false);
  assert.strictEqual(L.TM_clientAfter("nope", "2026-10-20T12:00:00Z"), false);
});

// ---- wake rules ----
t("No state: nothing set, no tags", () => {
  const v = L.TM_threadView(entry("a"), null, NOW, true, {});
  assert.deepStrictEqual(
    [v.hidden, v.wokeHidden, v.done, v.snoozed, v.pinned, v.label, v.assignee, v.tags.length],
    [false, false, false, false, false, null, null, 0],
  );
});

t("Hidden stays hidden until the client writes; then woke with a Hidden tag", () => {
  const e = entry("a", { lastClientAt: iso(NOW - 5 * H) });
  const s = { hidden_at: iso(NOW - 4 * H) };
  let v = L.TM_threadView(e, s, NOW, false, {});
  assert.strictEqual(v.hidden, true);
  assert.strictEqual(v.wokeHidden, false);
  v = L.TM_threadView(entry("a", { lastClientAt: iso(NOW - H) }), s, NOW, false, {});
  assert.strictEqual(v.hidden, false);
  assert.strictEqual(v.wokeHidden, true);
  assert.strictEqual(v.hiddenSet, true);
  assert.ok(v.tags.some((x) => x.text === "Hidden"));
});

t("Done reopens (view-side) when the client writes after it", () => {
  const s = { done_at: iso(NOW - 3 * H) };
  assert.strictEqual(L.TM_threadView(entry("a", { lastClientAt: iso(NOW - 4 * H) }), s, NOW).done, true);
  assert.strictEqual(L.TM_threadView(entry("a", { lastClientAt: iso(NOW - 2 * H) }), s, NOW).done, false);
});

t("Snoozed: future until, not woken; wakes on time or on a client message", () => {
  const s = { snoozed_until: iso(NOW + D), snoozed_at: iso(NOW - 3 * H) };
  const quiet = entry("a", { lastClientAt: iso(NOW - 4 * H) });
  assert.strictEqual(L.TM_threadView(quiet, s, NOW).snoozed, true);
  assert.strictEqual(L.TM_threadView(quiet, s, NOW + D + 1).snoozed, false, "time passed");
  assert.strictEqual(L.TM_threadView(entry("a", { lastClientAt: iso(NOW - H) }), s, NOW).snoozed, false, "client wrote");
  const tag = L.TM_threadView(quiet, s, NOW).tags.find((x) => x.id === "snoozed");
  assert.ok(/^Snoozed until /.test(tag.text), tag.text);
});

t("Tags: Pinned, Snoozed until Wed 8am (Chicago), Done, Assigned: first name", () => {
  const until = WB.WB_snoozeUntil("tomorrow", NOW); // Wed 8am CDT
  const s = {
    pinned_at: iso(NOW - H),
    snoozed_until: until,
    snoozed_at: iso(NOW - H),
    done_at: iso(NOW - H),
    assignee_email: "Jesse.Smith@mygoodbooks.org",
    label: "Payroll",
  };
  const v = L.TM_threadView(entry("a", { lastClientAt: iso(NOW - 2 * H) }), s, NOW, false, {
    "jesse.smith@mygoodbooks.org": "Jesse Smith",
  });
  assert.deepStrictEqual(
    v.tags.map((x) => x.text),
    ["Pinned", "Snoozed until Wed 8am", "Done", "Assigned: Jesse"],
  );
  assert.strictEqual(v.label, "Payroll");
  assert.strictEqual(v.assignee, "jesse.smith@mygoodbooks.org");
  assert.strictEqual(L.TM_firstName("pat.lee@mygoodbooks.org", {}), "Pat", "falls back to the email");
});

// ---- full-page filter and sort ----
function fixture() {
  const clients = [
    entry("plain", { lastAt: iso(NOW - 1 * H) }),
    entry("hid", { lastAt: iso(NOW - 2 * H) }),
    entry("done", { lastAt: iso(NOW - 3 * H) }),
    entry("snz", { lastAt: iso(NOW - 4 * H) }),
    entry("pinOld", { lastAt: iso(NOW - 9 * H) }),
    entry("pinNew", { lastAt: iso(NOW - 8 * H) }),
    entry("woke", { lastAt: iso(NOW - 5 * H), lastClientAt: iso(NOW - 5 * H) }),
    entry("older", { lastAt: iso(NOW - 6 * H) }),
  ];
  const teams = [team("t1", { lastAt: iso(NOW - 30 * 60000) }), team("t2", { lastAt: iso(NOW - 7 * H) })];
  const lc = iso(NOW - 10 * H);
  clients.forEach((c) => {
    if (c.key !== "woke") c.lastClientAt = lc;
  });
  const states = {
    hid: { hidden_at: iso(NOW - 9 * H) },
    done: { done_at: iso(NOW - 9 * H) },
    snz: { snoozed_until: iso(NOW + D), snoozed_at: iso(NOW - 9 * H) },
    pinOld: { pinned_at: iso(NOW - 5 * H) },
    pinNew: { pinned_at: iso(NOW - 1 * H) },
    woke: { hidden_at: iso(NOW - 6 * H) },
  };
  return { clients, teams, states };
}
const keys = (list) => list.map((e) => e.key);

t("All: hidden/done/snoozed gone, pinned first (newest pin), then by recent with team mixed in", () => {
  const f = fixture();
  const vs = L.TM_views(f.clients.concat(f.teams), f.states, NOW, false, {});
  assert.deepStrictEqual(keys(L.TM_filterSort(f.clients, f.teams, "all", vs, "", false)), [
    "pinNew",
    "pinOld",
    "t1",
    "plain",
    "woke",
    "older",
    "t2",
  ]);
  assert.strictEqual(vs.t1, undefined, "team entries get no view");
});

t("Clients: same without team; Team: team only, untouched", () => {
  const f = fixture();
  const vs = L.TM_views(f.clients, f.states, NOW, true, {});
  assert.deepStrictEqual(keys(L.TM_filterSort(f.clients, f.teams, "clients", vs, "", true)), [
    "pinNew",
    "pinOld",
    "plain",
    "woke",
    "older",
  ]);
  assert.deepStrictEqual(keys(L.TM_filterSort(f.clients, f.teams, "team", vs, "", true)), ["t1", "t2"]);
});

t("Done / Snoozed chips list their set; Hidden chip admin-only", () => {
  const f = fixture();
  const vs = L.TM_views(f.clients, f.states, NOW, true, {});
  assert.deepStrictEqual(keys(L.TM_filterSort(f.clients, f.teams, "done", vs, "", false)), ["done"]);
  assert.deepStrictEqual(keys(L.TM_filterSort(f.clients, f.teams, "snoozed", vs, "", false)), ["snz"]);
  assert.deepStrictEqual(keys(L.TM_filterSort(f.clients, f.teams, "hidden", vs, "", true)), ["hid"]);
  assert.deepStrictEqual(keys(L.TM_filterSort(f.clients, f.teams, "hidden", vs, "", false)), []);
  assert.deepStrictEqual(L.TM_extraChips(false).map((c) => c[0]), ["done", "snoozed"]);
  assert.deepStrictEqual(L.TM_extraChips(true).map((c) => c[0]), ["done", "snoozed", "hidden"]);
});

t("Search: done and snoozed come back; hidden only for admins; woke always", () => {
  const f = fixture();
  const vs = L.TM_views(f.clients, f.states, NOW, false, {});
  const staff = keys(L.TM_filterSort(f.clients, [], "all", vs, "x", false));
  assert.ok(staff.includes("done") && staff.includes("snz") && staff.includes("woke"));
  assert.ok(!staff.includes("hid"));
  const admin = keys(L.TM_filterSort(f.clients, [], "all", vs, "x", true));
  assert.ok(admin.includes("hid"));
  assert.strictEqual(L.TM_inDefault(vs.woke, false, false), true);
});

t("Sort is stable for equal times (name order), pinned ties fall back to recent", () => {
  const a = entry("b1", { name: "Beta", lastAt: iso(NOW - H) });
  const b = entry("a1", { name: "Alpha", lastAt: iso(NOW - H) });
  assert.deepStrictEqual(keys(L.TM_filterSort([a, b], [], "all", {}, "", false)), ["a1", "b1"]);
  const p = iso(NOW - H);
  const vs = L.TM_views([a, b], { b1: { pinned_at: p }, a1: { pinned_at: p } }, NOW, false, {});
  assert.deepStrictEqual(keys(L.TM_filterSort([a, b], [], "all", vs, "", false)), ["a1", "b1"]);
});

t("Counts: all/clients only visible rows; set sizes; hidden 0 for non-admins", () => {
  const f = fixture();
  const vs = L.TM_views(f.clients, f.states, NOW, true, {});
  assert.deepStrictEqual(L.TM_counts(f.clients, f.teams, vs, "", true), {
    all: 7,
    clients: 5,
    team: 2,
    done: 1,
    snoozed: 1,
    hidden: 1,
  });
  assert.strictEqual(L.TM_counts(f.clients, f.teams, vs, "", false).hidden, 0);
});

// ---- menu ----
t("No menu when lastAt null, sample mode, team rows or no message id", () => {
  assert.strictEqual(L.TM_hasMenu(entry("a"), "real"), true);
  assert.strictEqual(L.TM_hasMenu(entry("a", { lastAt: null }), "real"), false);
  assert.strictEqual(L.TM_hasMenu(entry("a"), "sample"), false);
  assert.strictEqual(L.TM_hasMenu(team("t"), "real"), false);
  assert.strictEqual(L.TM_hasMenu(entry("a", { lastId: null }), "real"), false);
});

t("Messages items: full set; bookkeeper never Restore; admin Restore when hidden_at set", () => {
  const plain = L.TM_threadView(entry("a"), null, NOW);
  assert.deepStrictEqual(L.TM_menuItems(plain, "messages", false), [
    "rename", "pin", "done", "snooze", "-", "assign", "task", "-", "copy", "-", "hide",
  ]);
  const hidden = L.TM_threadView(entry("a", { lastClientAt: iso(NOW - 5 * H) }), { hidden_at: iso(NOW - H) }, NOW);
  assert.deepStrictEqual(L.TM_menuItems(hidden, "messages", false).slice(-2), ["-", "copy"], "no Hide, no Restore");
  assert.deepStrictEqual(L.TM_menuItems(hidden, "messages", true).slice(-2), ["-", "restore"]);
  const woke = L.TM_threadView(entry("a", { lastClientAt: iso(NOW - H) }), { hidden_at: iso(NOW - 2 * H) }, NOW);
  assert.deepStrictEqual(L.TM_menuItems(woke, "messages", true).slice(-2), ["hide", "restore"]);
  assert.deepStrictEqual(L.TM_menuItems(woke, "messages", false).slice(-1), ["hide"]);
  const set = L.TM_threadView(entry("a", { lastClientAt: iso(NOW - 9 * H) }), { pinned_at: iso(NOW), done_at: iso(NOW - H) }, NOW);
  const items = L.TM_menuItems(set, "messages", false);
  assert.ok(items.includes("unpin") && items.includes("reopen"));
});

t("Snooze list: Unsnooze only when snoozed", () => {
  assert.deepStrictEqual(L.TM_snoozeItems({ snoozed: false }), ["snooze:tomorrow", "snooze:monday", "snooze:date"]);
  assert.deepStrictEqual(L.TM_snoozeItems({ snoozed: true }).slice(-1), ["unsnooze"]);
});

t("Desk set: no Snooze or Pin", () => {
  const items = L.TM_menuItems(L.TM_threadView(entry("a"), null, NOW), "desk", true);
  assert.deepStrictEqual(items, ["rename", "done", "-", "assign", "task", "-", "copy", "-", "hide"]);
  items.forEach((id) => assert.notStrictEqual(L.TM_itemLabel(id), undefined));
});

// ---- snooze times ----
t("Snooze tomorrow / Monday = Chicago 8am", () => {
  assert.strictEqual(L.TM_snoozeAt("tomorrow", NOW), "2026-10-21T13:00:00.000Z");
  assert.strictEqual(L.TM_snoozeAt("monday", NOW), "2026-10-26T13:00:00.000Z");
});

t("DST edge: Sat Oct 31 -> Next Monday 8am is CST (14:00Z)", () => {
  const sat = Date.parse("2026-10-31T17:00:00Z");
  assert.strictEqual(L.TM_snoozeAt("monday", sat), "2026-11-02T14:00:00.000Z");
  assert.strictEqual(L.TM_snoozeAt("tomorrow", sat), "2026-11-01T14:00:00.000Z");
  assert.strictEqual(L.TM_shortWhen("2026-11-02T14:00:00.000Z"), "Mon 8am");
  assert.strictEqual(L.TM_shortWhen("2026-10-26T13:30:00.000Z"), "Mon 8:30am");
});

t("Pick a date: bounds tomorrow..+30; past or bad dates refused; capped at 30 days", () => {
  assert.deepStrictEqual(L.TM_dateBounds(NOW), { min: "2026-10-21", max: "2026-11-19" });
  assert.strictEqual(L.TM_snoozeAt("date", NOW, "2026-10-19"), null);
  assert.strictEqual(L.TM_snoozeAt("date", NOW, "junk"), null);
  const far = L.TM_snoozeAt("date", NOW, "2027-01-30");
  assert.ok(Date.parse(far) <= NOW + 30 * D, far);
});

t("Wake timer: earliest future snooze, at most 60s; null when none", () => {
  assert.strictEqual(L.TM_nextWakeMs({}, NOW), null);
  assert.strictEqual(L.TM_nextWakeMs({ a: { snoozed_until: iso(NOW - 1) } }, NOW), null);
  assert.strictEqual(L.TM_nextWakeMs({ a: { snoozed_until: iso(NOW + D) } }, NOW), 60000);
  assert.strictEqual(L.TM_nextWakeMs({ a: { snoozed_until: iso(NOW + D) }, b: { snoozed_until: iso(NOW + 5000) } }, NOW), 5250);
  assert.strictEqual(L.TM_nextWakeMs({ a: { snoozed_until: iso(NOW + 10) } }, NOW), 1000, "floor 1s");
});

// ---- text limits ----
t("Label cleanup mirrors the SQL; 80 is fine, 81 is refused; empty clears", () => {
  assert.deepStrictEqual(L.TM_cleanLabel("  Pay\u0007roll\n  Q3 \t"), { ok: true, value: "Pay roll Q3" });
  assert.deepStrictEqual(L.TM_cleanLabel("   "), { ok: true, value: null });
  assert.strictEqual(L.TM_cleanLabel("x".repeat(80)).ok, true);
  assert.strictEqual(L.TM_cleanLabel("x".repeat(81)).ok, false);
  // 80 astral characters are 160 UTF-16 units but 80 for Postgres char_length.
  assert.strictEqual(L.TM_cleanLabel("\u{1D400}".repeat(80)).ok, true);
  assert.strictEqual(L.TM_cleanLabel("\u{1D400}".repeat(81)).ok, false);
});

t("Task text: label first, else name, client in parens, at most 140", () => {
  assert.strictEqual(L.TM_taskText("Payroll", "Pat", "Acme"), "Reply to Payroll (Acme)");
  assert.strictEqual(L.TM_taskText(null, "Pat", "Acme"), "Reply to Pat (Acme)");
  const long = L.TM_taskText("y".repeat(200), "Pat", "Acme");
  assert.strictEqual(long.length, 140);
});

t("Copy link: message deep link, never an email", () => {
  const hrefOf = (o) => "#/client/" + o.clientId + "/" + o.tab + "?item=" + encodeURIComponent(o.item);
  const link = L.TM_copyLink("https://app.mygoodbooks.org", "/", "c1", "m9", hrefOf);
  assert.strictEqual(link, "https://app.mygoodbooks.org/#/client/c1/messages?item=msg%3Am9");
  assert.ok(!link.includes("@"));
  assert.strictEqual(L.TM_copyLink("o", "/", "c1", null, hrefOf), "");
});

t("Focus after a row leaves: next, else previous, else null", () => {
  assert.strictEqual(L.TM_focusAfter(["a", "b", "c"], "b"), "c");
  assert.strictEqual(L.TM_focusAfter(["a", "b", "c"], "c"), "b");
  assert.strictEqual(L.TM_focusAfter(["a"], "a"), null);
  assert.strictEqual(L.TM_focusAfter(["a"], "z"), null);
  assert.ok(L.TM_removesRow("hide") && L.TM_removesRow("done") && L.TM_removesRow("snooze:monday"));
  assert.ok(!L.TM_removesRow("pin") && !L.TM_removesRow("rename") && !L.TM_removesRow("restore"));
});

t("Error codes become plain words", () => {
  assert.ok(/admin/.test(L.TM_errorText({ message: "admin_only" })));
  assert.ok(/80/.test(L.TM_errorText({ message: "bad_label" })));
  assert.ok(/30 days/.test(L.TM_errorText({ message: "bad_snooze" })));
  assert.ok(/access/.test(L.TM_errorText({ message: "no_client_access" })));
  assert.strictEqual(L.TM_errorText(null), "Couldn't save that. Try again.");
});

// ---- gate off: Desk menus untouched ----
t("Desk menus: WB_menuActions / WB_hubMenu still give today's output for a message row", () => {
  const row = { kind: "message", id: "message:c1:p@x.org", client_id: "c1", participant_email: "p@x.org", ref_id: "m1", title: "Pat" };
  const a1 = JSON.stringify(WB.WB_menuActions(row));
  const h1 = JSON.stringify(WB.WB_hubMenu(row));
  // Loading TM_logic must not change them, and WB_logic.js carries no thread menu code.
  delete require.cache[require.resolve("./TM_logic.js")];
  require("./TM_logic.js");
  assert.strictEqual(JSON.stringify(WB.WB_menuActions(row)), a1);
  assert.strictEqual(JSON.stringify(WB.WB_hubMenu(row)), h1);
  const src = fs.readFileSync(path.join(__dirname, "../workbench/WB_logic.js"), "utf8");
  assert.ok(!/TM_|thread_set_|threadmenu/.test(src), "WB_logic.js has no thread menu code");
});

t("TM_logic is pure: no window, document, fetch or supabase", () => {
  const src = fs.readFileSync(path.join(__dirname, "TM_logic.js"), "utf8").replace(/\/\/.*$/gm, "");
  assert.ok(!/\bwindow\b|\bdocument\b|\bfetch\b|mgbSupabase|localStorage/.test(src));
});

console.log("TM_logic: " + n + " tests passed");
