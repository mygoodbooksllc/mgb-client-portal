// node components/tasks/TK_coverageLogic.test.js
const assert = require("assert");
const L = require("./TK_coverageLogic.js");
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

const preview = {
  dry_run: true,
  owner: "ann@example.invalid",
  owner_name: "Ann",
  starts_on: "2026-10-19",
  ends_on: "2026-10-23",
  move: [
    { task_id: "t2", title: "Reconcile bank", client_id: "c1", client_name: "Acme", due: "2026-10-21", to: "bob@example.invalid", to_name: "Bob", grant: false, reason: "backup" },
    { task_id: "t1", title: "Payroll", client_id: "c1", client_name: "Acme", due: "2026-10-20", to: "Bob@example.invalid", to_name: "Bob", grant: false, reason: "backup" },
    { task_id: "t3", title: "Close", client_id: "c2", client_name: "Beta", due: "2026-10-22", to: "al@example.invalid", to_name: "Al", grant: true, reason: "backup" },
  ],
  skip: [
    { reason: "private", due: "2026-10-20" },
    { task_id: "t4", title: "Taxes", client_id: "c3", client_name: "Gamma", due: "2026-10-21", reason: "no_backup" },
    { task_id: "t5", title: "1099s", client_id: "c3", client_name: "Gamma", due: "2026-10-22", reason: "no_backup" },
    { task_id: "t6", title: "AP", client_id: "c4", client_name: "Delta", due: "2026-10-22", reason: "no_access", to: "bob@example.invalid" },
  ],
};

// ---- Dates
t("date formats ISO", () => assert.strictEqual(L.TK_oooDate("2026-10-05"), "Oct 5"));
t("date passes junk through", () => assert.strictEqual(L.TK_oooDate("soon"), "soon"));
t("date handles null", () => assert.strictEqual(L.TK_oooDate(null), ""));

// ---- Preview grouping
t("groups by backup, case-insensitive, sorted by name", () => {
  const g = L.TK_oooPreviewGroups(preview, false);
  assert.strictEqual(g.moveCount, 3);
  assert.deepStrictEqual(g.byBackup.map((b) => b.toName), ["Al", "Bob"]);
  assert.strictEqual(g.byBackup[1].items.length, 2);
});
t("items within a backup sorted by due date", () => {
  const g = L.TK_oooPreviewGroups(preview, false);
  assert.deepStrictEqual(g.byBackup[1].items.map((i) => i.task_id), ["t1", "t2"]);
});
t("private skips are only counted", () => {
  const g = L.TK_oooPreviewGroups(preview, false);
  assert.strictEqual(g.privateCount, 1);
  assert.ok(g.skips.every((s) => s.reason !== "private"));
});
t("skips grouped by reason", () => {
  const g = L.TK_oooPreviewGroups(preview, false);
  assert.deepStrictEqual(g.skips.map((s) => [s.reason, s.items.length]), [["no_backup", 2], ["no_access", 1]]);
});
t("grant count", () => assert.strictEqual(L.TK_oooPreviewGroups(preview, true).grants, 1));
t("empty preview", () => {
  const g = L.TK_oooPreviewGroups(null, false);
  assert.strictEqual(g.moveCount, 0);
  assert.deepStrictEqual(g.byBackup, []);
  assert.deepStrictEqual(g.skips, []);
});

// ---- Skip copy
t("no_access copy differs for non-admins (asks for access)", () => {
  assert.ok(/asks an admin/.test(L.TK_oooSkipText("no_access", false)));
  assert.ok(!/asks an admin/.test(L.TK_oooSkipText("no_access", true)));
});
t("unknown skip reason has copy", () => assert.strictEqual(L.TK_oooSkipText("zzz", true), "Not moved."));
t("every server skip reason has copy", () => {
  ["private", "no_backup", "self", "backup_away", "no_access", "error"].forEach((r) => assert.ok(L.TK_OOO_SKIP_COPY[r], r));
});
t("every server return reason has copy", () => {
  ["closed", "changed", "in_review", "owner_inactive", "error"].forEach((r) => assert.ok(L.TK_OOO_LEFT_COPY[r], r));
});

// ---- Override clients
t("override clients: unique, counted, sorted; private never offered", () => {
  const o = L.TK_oooOverrideClients(preview);
  assert.deepStrictEqual(o.map((c) => [c.client_name, c.count, c.reason]), [["Delta", 1, "no_access"], ["Gamma", 2, "no_backup"]]);
});
t("override clients: error skips are not offered", () => {
  assert.deepStrictEqual(L.TK_oooOverrideClients({ skip: [{ task_id: "x", client_id: "c9", reason: "error" }] }), []);
});

// ---- Result toasts
t("apply text", () => assert.strictEqual(L.TK_oooApplyText({ move: [1, 2], skip: [1] }), "2 tasks handed to backups. 1 task stayed put."));
t("apply text: nothing", () => assert.ok(/Nothing to hand off/.test(L.TK_oooApplyText({ move: [], skip: [] }))));
t("apply text: inactive", () => assert.ok(/over or cancelled/.test(L.TK_oooApplyText({ inactive: true }))));
t("apply text: one", () => assert.strictEqual(L.TK_oooApplyText({ move: [1], skip: [] }), "1 task handed to backups."));
t("return text", () => {
  assert.strictEqual(
    L.TK_oooReturnText({ returned: [1, 2, 3], left: [{ reason: "in_review" }, { reason: "changed" }] }),
    "3 tasks back with the owner. 1 task in review comes back once reviewed.",
  );
});
t("return text: nothing", () => assert.strictEqual(L.TK_oooReturnText({ returned: [], left: [] }), "Nothing to hand back."));

// ---- Coverage rows
const rows = [
  { time_off_id: "w1", task_id: "t1", from_email: "ann@example.invalid", from_name: "Ann", to_email: "bob@example.invalid", to_name: "Bob", starts_on: "2026-10-19", ends_on: "2026-10-23" },
  { time_off_id: "w1", task_id: "t2", from_email: "ann@example.invalid", from_name: "Ann", to_email: "bob@example.invalid", to_name: "Bob", starts_on: "2026-10-19", ends_on: "2026-10-23" },
  { time_off_id: "w2", task_id: "t3", from_email: "cy@example.invalid", from_name: "Cy", to_email: "Bob@example.invalid", to_name: "Bob", starts_on: "2026-10-01", ends_on: "2026-10-30" },
  { time_off_id: "w3", task_id: "t4", from_email: "bob@example.invalid", from_name: "Bob", to_email: "ann@example.invalid", to_name: "Ann", starts_on: "2026-11-01", ends_on: "2026-11-02" },
];
t("by task", () => assert.strictEqual(L.TK_coverageByTask(rows).t3.from_name, "Cy"));
t("count by time off", () => assert.deepStrictEqual(L.TK_coverageCountByTimeOff(rows), { w1: 2, w2: 1, w3: 1 }));
t("label: covering", () => {
  const l = L.TK_coverageLabel(rows[0], "BOB@example.invalid");
  assert.strictEqual(l.tone, "covering");
  assert.strictEqual(l.text, "Covering for Ann until Oct 23");
});
t("label: covered (my task with someone else)", () => {
  const l = L.TK_coverageLabel(rows[0], "ann@example.invalid");
  assert.strictEqual(l.tone, "covered");
  assert.strictEqual(l.text, "With Bob while you're out (to Oct 23)");
});
t("label: admin sees both names", () => {
  const l = L.TK_coverageLabel(rows[0], "boss@example.invalid");
  assert.strictEqual(l.tone, "other");
  assert.strictEqual(l.text, "Bob is covering for Ann until Oct 23");
});
t("label: none", () => assert.strictEqual(L.TK_coverageLabel(null, "x"), null));
t("label title explains it goes back", () => assert.ok(/goes back automatically/.test(L.TK_coverageLabel(rows[0], "x").title)));
t("covering summary groups by owner, latest end date", () => {
  const s = L.TK_coveringSummary(rows, "bob@example.invalid");
  assert.deepStrictEqual(s.map((x) => [x.fromName, x.count, x.endsOn]), [["Ann", 2, "2026-10-23"], ["Cy", 1, "2026-10-30"]]);
});
t("covering summary ignores tasks covered for me", () => {
  assert.deepStrictEqual(L.TK_coveringSummary(rows, "cy@example.invalid"), []);
});

console.log("TK_coverageLogic: " + n + " passed");
