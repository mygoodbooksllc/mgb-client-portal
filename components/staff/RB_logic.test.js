// Plain node, no framework: `node components/staff/RB_logic.test.js`.
// Guards the Review board's pure logic (RB_logic.js, docs/review-board-spec.md
// sections 3b, 4b and 5): every chip rule including Unassigned and missing
// history, part labels from a custom and a missing rhythm, the row model,
// sort direction and stability per column, each filter, counts and the top
// line, digest titles (Test clients prefix), periods from the hash, recipient
// chips (de-duplication, opted-out skip, Cc not me), mailto encoding and the
// long-body fallback, and the Copy draft text.

const assert = require("assert");
const L = require("./RB_logic.js");

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

const CTX = { today: "2026-11-15" };
const task = (o) => Object.assign({ id: "t1", status: "todo", assignee: "amy@mgb.com", assignee_name: "Amy Lee", owner: "amy@mgb.com", due: "2026-11-14" }, o || {});

// ---- Parts ----
t("part keys from source refs", () => {
  assert.strictEqual(L.RB_partOf("month_rhythm:2_check_in"), "check_in");
  assert.strictEqual(L.RB_partOf("month_rhythm:6_reports"), "reports");
  assert.strictEqual(L.RB_partOf("month_rhythm:7_follow_up"), "follow_up");
  ["month_rhythm:1_check_in", "month_rhythm:8_follow_up", "", null, undefined, "toString"].forEach((r) => assert.strictEqual(L.RB_partOf(r), null, String(r)));
});
t("part labels: default, custom rhythm, missing part, blank label", () => {
  assert.strictEqual(L.RB_partLabel("check_in"), "4th · Check in");
  assert.strictEqual(L.RB_partLabel("reports", null), "14th · Send reports");
  assert.strictEqual(L.RB_partLabel("follow_up", {}), "24th · Follow up");
  const r = { parts: [{ key: "check_in", label: "Hello", day: 1 }, { key: "reports", label: "Reports out", day: 15 }, { key: "follow_up", label: "  ", day: 22 }] };
  assert.strictEqual(L.RB_partLabel("check_in", r), "1st · Hello");
  assert.strictEqual(L.RB_partLabel("reports", r), "15th · Reports out");
  assert.strictEqual(L.RB_partLabel("follow_up", r), "22nd · Follow up");
  assert.strictEqual(L.RB_partLabel("reports", { parts: [{ key: "check_in", day: 3 }] }), "14th · Send reports");
  assert.strictEqual(L.RB_partLabel("reports", { parts: [{ key: "reports", day: 99 }] }), "14th · Send reports");
  assert.strictEqual(L.RB_ordinal(11), "11th");
  assert.strictEqual(L.RB_ordinal(23), "23rd");
});
t("current part follows the days in the month after P", () => {
  const P = "2026-10-01";
  assert.strictEqual(L.RB_currentPart(null, "2026-10-20", P), "check_in");
  assert.strictEqual(L.RB_currentPart(null, "2026-11-02", P), "check_in");
  assert.strictEqual(L.RB_currentPart(null, "2026-11-04", P), "check_in");
  assert.strictEqual(L.RB_currentPart(null, "2026-11-14", P), "reports");
  assert.strictEqual(L.RB_currentPart(null, "2026-11-23", P), "reports");
  assert.strictEqual(L.RB_currentPart(null, "2026-11-24", P), "follow_up");
  assert.strictEqual(L.RB_currentPart(null, "2026-12-01", P), "follow_up");
  assert.strictEqual(L.RB_currentPart({ parts: [{ key: "reports", day: 10 }] }, "2026-11-11", P), "reports");
  assert.strictEqual(L.RB_currentPart(null, "2027-01-15", "2026-12-01"), "reports");
});

// ---- Chips: the table in spec 3b, in order ----
t("rule 1: no task", () => {
  const c = L.RB_chipFor(null, CTX);
  assert.strictEqual(c.state, "none");
  assert.strictEqual(c.label, "No task yet");
});
t("rule 2: auto-closed = not needed", () => {
  const c = L.RB_chipFor(task({ status: "done", auto: true, by: "system", completed_at: "2026-11-24T16:00:00Z" }), CTX);
  assert.strictEqual(c.state, "notneeded");
  assert.strictEqual(c.label, "Not needed · nothing outstanding · Nov 24");
});
t("rule 3: done with a name, Chicago date", () => {
  // 03:30 UTC on the 15th is still the 14th in Chicago.
  const c = L.RB_chipFor(task({ status: "done", by: "jesse@mgb.com", by_name: "Jesse Gray", completed_at: "2026-11-15T03:30:00Z" }), CTX);
  assert.strictEqual(c.state, "done");
  assert.strictEqual(c.label, "Done · Jesse G. · Nov 14");
  assert.strictEqual(c.by, "jesse@mgb.com");
});
t("rule 3: done by someone with no staff name uses the email", () => {
  const c = L.RB_chipFor(task({ status: "done", by: "temp@mgb.com", by_name: null, completed_at: "2026-11-10T15:00:00Z" }), CTX);
  assert.strictEqual(c.label, "Done · temp · Nov 10");
});
t("rule 4: done, history missing: no name, never the assignee", () => {
  const c = L.RB_chipFor(task({ status: "done", by: null, completed_at: "2026-11-10T15:00:00Z" }), CTX);
  assert.strictEqual(c.state, "done");
  assert.strictEqual(c.label, "Done · Nov 10");
  assert.ok(!/Amy/.test(c.label));
});
t("rule 5: ready for review, even when past due", () => {
  const c = L.RB_chipFor(task({ status: "ready_for_review", due: "2026-11-01" }), CTX);
  assert.strictEqual(c.state, "review");
  assert.strictEqual(c.label, "Ready for review · Amy L.");
});
t("rule 6: late (due before today, not excused)", () => {
  const c = L.RB_chipFor(task({ due: "2026-11-14" }), CTX);
  assert.strictEqual(c.state, "late");
  assert.strictEqual(c.label, "Late · due Nov 14 · Amy L.");
  assert.strictEqual(L.RB_chipFor(task({ due: "2026-11-15" }), CTX).state, "open");
});
t("rule 7: excused is open, labeled by reason", () => {
  const w = L.RB_chipFor(task({ status: "waiting_client", excused: true, waiting: true, due: "2026-11-01" }), CTX);
  assert.strictEqual(w.state, "open");
  assert.strictEqual(w.label, "Open · waiting on client");
  const p = L.RB_chipFor(task({ excused: true, waiting: false, due: "2026-11-01" }), CTX);
  assert.strictEqual(p.label, "Open · preliminary month");
});
t("rule 8: open, due later", () => {
  const c = L.RB_chipFor(task({ status: "in_progress", due: "2026-11-24" }), CTX);
  assert.strictEqual(c.state, "open");
  assert.strictEqual(c.label, "Open · due Nov 24 · Amy L.");
});
t("Unassigned never falls back to the owner", () => {
  const c = L.RB_chipFor(task({ assignee: null, assignee_name: null, owner: "amy@mgb.com" }), CTX);
  assert.strictEqual(c.label, "Late · due Nov 14 · Unassigned");
  assert.strictEqual(L.RB_chipFor(task({ assignee: null, status: "ready_for_review" }), CTX).label, "Ready for review · Unassigned");
});
t("marked sent adds a second line, state unchanged", () => {
  const c = L.RB_chipFor(task({ due: "2026-11-24", sent: { by: "jesse@mgb.com", by_name: "Jesse Gray", at: "2026-11-13T18:00:00Z" } }), CTX);
  assert.strictEqual(c.state, "open");
  assert.strictEqual(c.sent, "Email marked sent · Jesse G. · Nov 13");
  assert.strictEqual(L.RB_chipFor(task({ sent: { by: "x@mgb.com", at: "2026-11-13T18:00:00Z" } }), CTX).sent, "Email marked sent · x · Nov 13");
  assert.strictEqual(L.RB_chipFor(task(), CTX).sent, null);
});
t("chip ranks, worst first", () => {
  const order = ["late", "open", "review", "none", "done", "notneeded"];
  order.forEach((s, i) => assert.strictEqual(L.RB_chipRank(s), i));
  assert.strictEqual(L.RB_chipRank("weird"), 9);
});
t("chip tones reuse the Close tracker colors", () => {
  assert.strictEqual(L.RB_chipFor(task(), CTX).tone, "late");
  assert.strictEqual(L.RB_chipFor(null, CTX).tone, "not_started");
});

// ---- Rows ----
const rpc = (o) =>
  Object.assign(
    {
      client_id: "c1",
      name: "Acme",
      test_only: false,
      is_internal: false,
      people: [
        { role: "bookkeeper", email: "amy@mgb.com", name: "Amy Lee" },
        { role: "backup", email: "bo@mgb.com", name: "Bo Diaz" },
      ],
      contact: null,
      logins: [],
      report_state: "full",
      tasks: [],
    },
    o || {},
  );
t("row model: bookkeeper from the app wins; RPC is the fallback", () => {
  const r1 = L.RB_rowModel(rpc(), { id: "c1", name: "Acme Inc" }, { status: "in_progress", late: true }, { today: CTX.today, bk: { name: "Zed", key: "email:zed@mgb.com" } });
  assert.strictEqual(r1.name, "Acme Inc");
  assert.strictEqual(r1.bkName, "Zed");
  assert.strictEqual(r1.bkKey, "email:zed@mgb.com");
  assert.strictEqual(r1.backupName, "Bo Diaz");
  assert.deepStrictEqual(r1.close, { status: "in_progress", late: true, signedOff: null });
  const r2 = L.RB_rowModel(rpc(), null, null, { today: CTX.today });
  assert.strictEqual(r2.name, "Acme");
  assert.strictEqual(r2.bkName, "Amy Lee");
  assert.strictEqual(r2.bkKey, "email:amy@mgb.com");
  assert.strictEqual(r2.close.status, "not_started");
  const r3 = L.RB_rowModel(rpc({ people: null }), null, null, {});
  assert.strictEqual(r3.bkName, "");
  assert.strictEqual(r3.backupName, "");
});
t("row model: chips per part, first task per part, logins active first", () => {
  const r = L.RB_rowModel(
    rpc({
      tasks: [
        { part: "reports", id: "a", status: "done", by: null, completed_at: "2026-11-14T15:00:00Z" },
        { part: "reports", id: "b", status: "todo" },
        { part: "bogus", id: "z", status: "todo" },
      ],
      logins: [
        { email: "z@c.com", name: "Zoe", active: false },
        { email: "a@c.com", name: "Al", active: true },
      ],
      contact: { name: null, email: null, phone: null },
      report_state: "preliminary",
    }),
    null,
    null,
    CTX,
  );
  assert.strictEqual(r.chips.reports.state, "done");
  assert.strictEqual(r.chips.reports.id, "a");
  assert.strictEqual(r.chips.check_in.state, "none");
  assert.strictEqual(r.chips.follow_up.state, "none");
  assert.deepStrictEqual(r.logins.map((x) => x.email), ["a@c.com", "z@c.com"]);
  assert.strictEqual(r.contact, null);
  assert.strictEqual(r.prelim, true);
});

function mk(id, name, o) {
  return Object.assign({ id, name, bkName: "", bkKey: "", backupName: "", contactName: "", chips: {}, close: { status: "not_started", late: false }, test: false, internal: false, prelim: false }, o || {});
}
const chip = (state, due) => ({ state, due: due || null });
const ROWS = [
  mk("1", "Bravo", { bkName: "Amy L", bkKey: "email:amy", contactName: "Zed", chips: { check_in: chip("done"), reports: chip("late", "2026-11-13"), follow_up: chip("open", "2026-11-24") }, close: { status: "done", late: false } }),
  mk("2", "alpha", { bkName: "", bkKey: "", backupName: "Bo", chips: { check_in: chip("late", "2026-11-04"), reports: chip("late", "2026-11-12"), follow_up: chip("none") }, close: { status: "in_progress", late: true } }),
  mk("3", "Charlie", { bkName: "Cy", bkKey: "email:cy", contactName: "Ann", chips: { check_in: chip("done"), reports: chip("done"), follow_up: chip("notneeded") }, close: { status: "na", late: false }, prelim: true }),
  mk("4", "Delta", { bkName: "Amy L", bkKey: "email:amy", test: true, chips: { check_in: chip("review"), reports: chip("open", "2026-11-14"), follow_up: chip("none") }, close: { status: "review", late: false } }),
];
const ids = (rows) => rows.map((r) => r.id).join(",");

t("sort: client a-z / z-a, case-insensitive", () => {
  assert.strictEqual(ids(L.RB_sortRows(ROWS, "client", "asc")), "2,1,3,4");
  assert.strictEqual(ids(L.RB_sortRows(ROWS, "client", "desc")), "4,3,1,2");
});
t("sort: bookkeeper, empties last both ways, ties by client", () => {
  assert.strictEqual(ids(L.RB_sortRows(ROWS, "bookkeeper", "asc")), "1,4,3,2");
  assert.strictEqual(ids(L.RB_sortRows(ROWS, "bookkeeper", "desc")), "3,1,4,2");
});
t("sort: backup and contact keep empties last", () => {
  assert.strictEqual(ids(L.RB_sortRows(ROWS, "backup", "asc")), "2,1,3,4");
  assert.strictEqual(ids(L.RB_sortRows(ROWS, "backup", "desc")), "2,1,3,4");
  assert.strictEqual(ids(L.RB_sortRows(ROWS, "contact", "asc")), "3,1,2,4");
  assert.strictEqual(ids(L.RB_sortRows(ROWS, "contact", "desc")), "1,3,2,4");
});
t("sort: chip columns by rank then due date", () => {
  assert.strictEqual(ids(L.RB_sortRows(ROWS, "reports", "asc")), "2,1,4,3");
  assert.strictEqual(ids(L.RB_sortRows(ROWS, "reports", "desc")), "3,4,1,2");
  assert.strictEqual(ids(L.RB_sortRows(ROWS, "check_in", "asc")), "2,4,1,3");
  assert.strictEqual(ids(L.RB_sortRows(ROWS, "follow_up", "asc")), "1,2,4,3");
});
t("sort: close, late first, then CT order", () => {
  assert.strictEqual(ids(L.RB_sortRows(ROWS, "close", "asc")), "2,4,1,3");
  assert.strictEqual(ids(L.RB_sortRows(ROWS, "close", "desc")), "3,1,4,2");
});
t("sort: stable, does not mutate, unknown key = client", () => {
  const twins = [mk("a", "Same"), mk("b", "Same"), mk("c", "Same")];
  assert.strictEqual(ids(L.RB_sortRows(twins, "client", "asc")), "a,b,c");
  assert.strictEqual(ids(L.RB_sortRows(twins, "client", "desc")), "a,b,c");
  const before = ids(ROWS);
  L.RB_sortRows(ROWS, "reports", "desc");
  assert.strictEqual(ids(ROWS), before);
  assert.strictEqual(ids(L.RB_sortRows(ROWS, "approve", "asc")), "2,1,3,4");
});

t("filter: test clients hidden unless shown", () => {
  assert.strictEqual(ids(L.RB_filterRows(ROWS, {})), "1,2,3");
  assert.strictEqual(ids(L.RB_filterRows(ROWS, { showTest: true })), "1,2,3,4");
  assert.strictEqual(ids(L.RB_filterRows([mk("i", "MGB", { internal: true })], {})), "");
});
t("filter: bookkeeper key and Unassigned", () => {
  assert.strictEqual(ids(L.RB_filterRows(ROWS, { bk: "email:amy", showTest: true })), "1,4");
  assert.strictEqual(ids(L.RB_filterRows(ROWS, { bk: "unassigned", showTest: true })), "2");
  assert.strictEqual(ids(L.RB_filterRows(ROWS, { bk: "all", showTest: true })), "1,2,3,4");
});
t("filter: every status option", () => {
  const f = (status) => ids(L.RB_filterRows(ROWS, { status, showTest: true }));
  assert.strictEqual(f("all"), "1,2,3,4");
  assert.strictEqual(f("late"), "1,2");
  assert.strictEqual(f("open"), "1,2,4");
  assert.strictEqual(f("done3"), "3");
  assert.strictEqual(f("none"), "2,4");
  assert.strictEqual(f("close_open"), "2,4");
  assert.strictEqual(f("prelim"), "3");
  assert.deepStrictEqual(
    L.RB_STATUS_FILTERS.map((x) => x.key),
    ["all", "late", "open", "done3", "none", "close_open", "prelim"],
  );
});

t("counts: done includes not needed; no task is not counted", () => {
  assert.deepStrictEqual(L.RB_counts(ROWS, "follow_up"), { total: 2, done: 1, notneeded: 1, open: 1 });
  assert.deepStrictEqual(L.RB_counts(ROWS, "reports"), { total: 4, done: 1, notneeded: 0, open: 3 });
  assert.deepStrictEqual(L.RB_counts([], "reports"), { total: 0, done: 0, notneeded: 0, open: 0 });
});
t("top line", () => {
  assert.strictEqual(L.RB_topLine(ROWS, "reports"), "4 clients · 14th: 1 done, 3 open");
  assert.strictEqual(L.RB_topLine([ROWS[2]], "check_in", { parts: [{ key: "check_in", day: 5 }] }), "1 client · 5th: 1 done, 0 open");
});

// ---- Digest ----
t("digest title", () => {
  assert.strictEqual(L.RB_digestTitle("reports", { total: 62, done: 41, open: 21, test: false }, null, "2026-10-01"), "14th · Send reports for October: 41 of 62 done, 21 open");
  assert.strictEqual(L.RB_digestTitle("check_in", { total: 2, done: 0, test: true }, null, "2026-10-01"), "Test clients · 4th · Check in for October: 0 of 2 done, 2 open");
  const r = { parts: [{ key: "follow_up", label: "Wrap up", day: 25 }] };
  assert.strictEqual(L.RB_digestTitle("follow_up", { total: 3, done: 3, open: 0 }, r, "2026-12-01"), "25th · Wrap up for December: 3 of 3 done, 0 open");
  assert.strictEqual(L.RB_digestTitle("reports", null, null, null), "14th · Send reports: 0 of 0 done, 0 open");
});

// ---- Periods ----
t("period options: focus and the two before, across a year", () => {
  assert.deepStrictEqual(L.RB_periodOptions("2026-10-01"), ["2026-10-01", "2026-09-01", "2026-08-01"]);
  assert.deepStrictEqual(L.RB_periodOptions("2027-01-01"), ["2027-01-01", "2026-12-01", "2026-11-01"]);
  assert.deepStrictEqual(L.RB_periodOptions("junk"), []);
});
t("period from the hash: only offered months", () => {
  const opts = L.RB_periodOptions("2026-10-01");
  assert.strictEqual(L.RB_periodFromHash("#/work/review?period=2026-09", opts), "2026-09-01");
  assert.strictEqual(L.RB_periodFromHash("#/work/review?x=1&period=2026-10-01", opts), "2026-10-01");
  assert.strictEqual(L.RB_periodFromHash("#/work/review?period=2026-05", opts), null);
  assert.strictEqual(L.RB_periodFromHash("#/work/review", opts), null);
  assert.strictEqual(L.RB_periodFromHash("#/work/review?period=2026-9", opts), null);
});

// ---- Email extras ----
t("recipient chips: order, defaults, de-dup, opted-out skip, Cc not me", () => {
  const data = {
    contact: { name: "Pat Main", email: "PAT@client.com" },
    contacts: [
      { name: "Lee", email: "lee@client.com", can_answer: false },
      { name: "Kim", email: "kim@client.com", can_answer: true },
      { name: "Pat again", email: "pat@client.com", can_answer: true },
    ],
    logins: [
      { name: "Out", email: "out@client.com", opted_out: true },
      { name: "In", email: "in@client.com", opted_out: false },
      { name: "Kim", email: "KIM@client.com", opted_out: false },
      { name: "Bad", email: "bad?x@client.com" },
    ],
    staff: [
      { role: "account_manager", email: "jesse@mgb.com", name: "Jesse" },
      { role: "bookkeeper", email: "amy@mgb.com", name: "Amy" },
    ],
  };
  const c = L.RB_recipientChips(data, "Jesse@mgb.com");
  assert.deepStrictEqual(c.to.map((x) => [x.email, x.on, x.source]), [
    ["pat@client.com", true, "contact"],
    ["kim@client.com", false, "contact_list"],
    ["lee@client.com", false, "contact_list"],
    ["in@client.com", false, "login"],
  ]);
  assert.deepStrictEqual(c.cc.map((x) => [x.email, x.on, x.source]), [
    ["amy@mgb.com", true, "bookkeeper"],
    ["jesse@mgb.com", false, "account_manager"],
  ]);
});
t("recipient chips: no main contact turns the first chip on; none at all is empty", () => {
  const c = L.RB_recipientChips({ contact: null, contacts: [{ email: "a@b.co" }, { email: "c@d.co" }] }, "me@mgb.com");
  assert.deepStrictEqual(c.to.map((x) => x.on), [true, false]);
  assert.deepStrictEqual(L.RB_recipientChips(null, ""), { to: [], cc: [] });
  assert.deepStrictEqual(L.RB_recipientChips({ contact: { name: "No email", email: null } }, "").to, []);
});

// ---- Client contacts gate (docs/client-contacts-spec.md section 5)
const OPC = require("../client/OP_contacts.js");
const withList = () => ({
  contact: { name: "Pat Main", email: "PAT@client.com" },
  contacts: [{ name: "Kim", email: "kim@client.com", can_answer: true }],
  logins: [{ name: "In", email: "in@client.com", opted_out: false }],
  staff: [
    { role: "account_manager", email: "jesse@mgb.com", name: "Jesse" },
    { role: "bookkeeper", email: "amy@mgb.com", name: "Amy" },
  ],
  contact_list: [
    { name: "Pat Main", email: "pat@client.com", source: "main", is_main: true, gets_monthly_emails: true },
    { name: "Mo", email: "mo@client.com", source: "contact", gets_monthly_emails: true },
    { name: "Off", email: "off@client.com", source: "contact", gets_monthly_emails: true, opted_out: true },
    { name: "Kim", email: "kim@client.com", source: "contact", can_answer: true },
    { name: "Gone", email: "gone@client.com", source: "login", opted_out: true },
    { name: "In", email: "in@client.com", source: "login" },
    { name: "Amy too", email: "amy@mgb.com", source: "contact" },
  ],
});
t("recipient chips: contactsOn false with contact_list present is identical to today", () => {
  const d = withList();
  const today = L.RB_recipientChips(Object.assign({}, d, { contact_list: undefined }), "jesse@mgb.com");
  assert.deepStrictEqual(L.RB_recipientChips(d, "jesse@mgb.com"), today);
  assert.deepStrictEqual(L.RB_recipientChips(d, "jesse@mgb.com", { contactsOn: false, toChips: OPC.OPC_toChips }), today);
  // Gate on but an older server (no key): today's path too.
  assert.deepStrictEqual(L.RB_recipientChips(Object.assign({}, d, { contact_list: undefined }), "jesse@mgb.com", { contactsOn: true, toChips: OPC.OPC_toChips }), today);
});
t("recipient chips: contactsOn reads contact_list (main + monthly on, opted-out off or skipped)", () => {
  const c = L.RB_recipientChips(withList(), "jesse@mgb.com", { contactsOn: true, toChips: OPC.OPC_toChips });
  assert.deepStrictEqual(c.to.map((x) => [x.email, x.on, x.source]), [
    ["pat@client.com", true, "main"],
    ["mo@client.com", true, "contact"],
    ["off@client.com", false, "contact"],
    ["kim@client.com", false, "contact"],
    ["in@client.com", false, "login"],
    ["amy@mgb.com", false, "contact"],
  ]);
  assert.ok(/Contact list/.test(c.to[1].tip) && /Opted out/.test(c.to[2].tip));
  // A To address is not repeated as Cc (To first, as today).
  assert.deepStrictEqual(c.cc.map((x) => [x.email, x.on]), [["jesse@mgb.com", false]]);
});
t("recipient chips: contactsOn first-on fallback skips opted-out people", () => {
  const c = L.RB_recipientChips(
    { contact_list: [{ email: "o@client.com", source: "contact", opted_out: true }, { email: "k@client.com", source: "contact" }] },
    "",
    { contactsOn: true, toChips: OPC.OPC_toChips },
  );
  assert.deepStrictEqual(c.to.map((x) => x.on), [false, true]);
});
t("row model: contactList only with contactsOn", () => {
  const rpc = { client_id: "c1", name: "C1", contact: { name: "Pat", email: "p@c.co", source: "main" }, contact_list: [{ name: "Pat", email: "p@c.co", source: "main" }, null, {}] };
  const off = L.RB_rowModel(rpc, null, null, { today: "2026-11-05" });
  assert.ok(!("contactList" in off));
  const on = L.RB_rowModel(rpc, null, null, { today: "2026-11-05", contactsOn: true });
  assert.strictEqual(on.contactList.length, 1);
  const { contactList, ...rest } = on;
  assert.deepStrictEqual(rest, off);
});

t("mailto: addresses unencoded, subject/body encoded with CRLF", () => {
  const m = L.RB_mailto({ to: ["pat@client.com", "kim@client.com"], cc: ["amy@mgb.com"], subject: "Q&A: café", body: "Hi,\nline two\r\nend" });
  assert.strictEqual(m.full, true);
  assert.strictEqual(m.bodyLeftOut, false);
  assert.strictEqual(m.href, "mailto:pat@client.com,kim@client.com?cc=amy@mgb.com&subject=Q%26A%3A%20caf%C3%A9&body=Hi%2C%0D%0Aline%20two%0D%0Aend");
  assert.ok(!/%40/.test(m.href));
});
t("mailto: bad addresses dropped, empty parts omitted", () => {
  const m = L.RB_mailto({ to: ["ok@x.com", "a&b@x.com", "c,d@x.com", "sp ace@x.com", "per%cent@x.com", "q?@x.com", "h#sh@x.com", "noat", ""], cc: [], subject: "", body: "" });
  assert.strictEqual(m.href, "mailto:ok@x.com");
  assert.strictEqual(L.RB_mailto({}).href, "mailto:");
  assert.strictEqual(L.RB_mailto({ to: ["a@b.co", "A@b.co"], subject: "Hi" }).href, "mailto:a@b.co?subject=Hi");
});
t("mailto: over 1800 chars leaves the body out", () => {
  const body = "x".repeat(2000);
  const m = L.RB_mailto({ to: ["a@b.co"], cc: ["c@d.co"], subject: "Reports", body });
  assert.strictEqual(m.full, false);
  assert.strictEqual(m.bodyLeftOut, true);
  assert.strictEqual(m.href, "mailto:a@b.co?cc=c@d.co&subject=Reports");
  // Right at the limit still fits.
  const base = "mailto:a@b.co?body=".length;
  const fit = L.RB_mailto({ to: ["a@b.co"], body: "y".repeat(L.RB_MAILTO_MAX - base) });
  assert.strictEqual(fit.full, true);
  assert.strictEqual(fit.href.length, L.RB_MAILTO_MAX);
  // Encoding counts toward the limit (é is 6 chars encoded).
  assert.strictEqual(L.RB_mailto({ to: ["a@b.co"], body: "é".repeat(320) }).full, false);
});
t("draft text", () => {
  assert.strictEqual(L.RB_draftText({ to: ["a@b.co", "bad"], cc: ["c@d.co"], subject: "S", body: "B" }), "To: a@b.co\nCc: c@d.co\nSubject: S\n\nB");
  assert.strictEqual(L.RB_draftText({ subject: "S", body: "B" }), "Subject: S\n\nB");
});

t("dates: Chicago day and time labels", () => {
  assert.strictEqual(L.RB_ymd("2026-11-15T04:59:00Z"), "2026-11-14");
  assert.strictEqual(L.RB_ymd("2026-11-15T06:00:00Z"), "2026-11-15");
  assert.strictEqual(L.RB_ymd("nope"), "");
  assert.strictEqual(L.RB_dayLabel("2026-11-04"), "Nov 4");
  assert.strictEqual(L.RB_timeLabel("2026-11-13T20:14:00Z"), "2:14 pm");
  assert.strictEqual(L.RB_shortName("Mary Ann  Smith", "x@y"), "Mary S.");
  assert.strictEqual(L.RB_shortName("", ""), "");
});

t("sent line: you or a short name, with day and time", () => {
  const at = "2026-11-13T20:14:00Z";
  assert.strictEqual(L.RB_sentLine(null, "me@x.com"), "");
  assert.strictEqual(L.RB_sentLine({ by: "Me@x.com", at }, "me@x.com"), "Marked sent by you · Nov 13, 2:14 pm");
  assert.strictEqual(L.RB_sentLine({ by: "kim@x.com", byName: "Kim Lee", at }, "me@x.com"), "Marked sent by Kim L. · Nov 13, 2:14 pm");
  assert.strictEqual(L.RB_sentLine({ by: "kim@x.com", byName: "", at }, ""), "Marked sent by kim · Nov 13, 2:14 pm");
});

t("no visible text says Desk or colour", () => {
  const src = require("fs").readFileSync(require("path").join(__dirname, "RB_logic.js"), "utf8");
  assert.ok(!/colour/i.test(src));
  assert.ok(!/"[^"]*\bDesk\b[^"]*"/.test(src));
});

console.log("RB_logic: " + n + " tests passed");
