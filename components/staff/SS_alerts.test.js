// Plain node: `node components/staff/SS_alerts.test.js`. Guards the L2 admin
// alert rules (SS_alerts.js): usage, QuickBooks ops rows, client email
// failures, Drive rows, unknown keys, "out today", sorting, caps, null safety.

const assert = require("assert");
const ops = require("./staffOpsLogic.js");
if (typeof ops.OPS_outUntil === "function") global.OPS_outUntil = ops.OPS_outUntil;
const A = require("./SS_alerts.js");

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

const NOW = Date.parse("2026-10-20T15:00:00Z");
const HOUR = 3600 * 1000;
const iso = (ms) => new Date(ms).toISOString();
const clients = {
  c1: { id: "c1", name: "Acme Co", testOnly: false },
  c2: { id: "c2", name: "Birch LLC", testOnly: false },
  c3: { id: "c3", name: "Cedar Inc", testOnly: false },
  c4: { id: "c4", name: "Dune Ltd", testOnly: false },
  ct: { id: "ct", name: "Test Client", testOnly: true },
};
const rules = (o) => A.SS_alertRules(Object.assign({ clientsById: clients, today: "2026-10-20", now: NOW }, o));
const one = (list, kind) => list.filter((a) => a.kind === kind);

t("usage: normal and missing give nothing", () => {
  assert.deepStrictEqual(rules({ usage: { mode: "normal" } }), []);
  assert.deepStrictEqual(rules({ usage: null }), []);
});
t("usage: throttled is a warning with the badge text", () => {
  const a = rules({ usage: { mode: "throttled" } })[0];
  assert.strictEqual(a.severity, "warning");
  assert.strictEqual(a.text, "QuickBooks syncs slowed");
  assert.strictEqual(a.href, "#/team/hours");
});
t("usage: stopped is danger and matches the TopBar strings exactly", () => {
  const a = rules({ usage: { mode: "stopped" } })[0];
  assert.strictEqual(a.severity, "danger");
  assert.strictEqual(a.text, "QuickBooks syncs stopped");
  assert.strictEqual(A.SS_USAGE_TEXT.stopped, "QuickBooks syncs stopped");
  assert.strictEqual(A.SS_USAGE_TEXT.throttled, "QuickBooks syncs slowed");
  const fs = require("fs");
  const top = fs.readFileSync(__dirname + "/TopBar.jsx", "utf8");
  assert.ok(top.includes('"QuickBooks syncs stopped"') && top.includes('"QuickBooks syncs slowed"'));
});
t("usage: the qbo_usage_stopped ops row dedupes with the rpc (one alert)", () => {
  const list = rules({ usage: { mode: "stopped" }, opsRows: [{ key: "qbo_usage_stopped", title: "QuickBooks API usage hit the monthly safety limit" }] });
  assert.strictEqual(one(list, "usage").length, 1);
  assert.strictEqual(list.length, 1);
});
t("usage: only the ops row open still shows one stopped alert; stopped beats throttled", () => {
  const list = rules({ usage: { mode: "throttled" }, opsRows: [{ key: "qbo_usage_stopped", title: "x" }] });
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].severity, "danger");
  assert.strictEqual(rules({ opsRows: [{ key: "qbo_usage_stopped", title: "x" }] })[0].text, "QuickBooks syncs stopped");
});
t("ops keys parse for every known kind", () => {
  assert.deepStrictEqual(A.SS_parseOpsKey("qbo_reconnect:abc"), { kind: "qbo_reconnect", clientId: "abc" });
  assert.deepStrictEqual(A.SS_parseOpsKey("sync_errors:abc"), { kind: "sync_errors", clientId: "abc" });
  assert.deepStrictEqual(A.SS_parseOpsKey("sync_overdue:abc"), { kind: "sync_overdue", clientId: "abc" });
  assert.deepStrictEqual(A.SS_parseOpsKey("qbo_sync_cron"), { kind: "qbo_sync_cron", clientId: null });
  assert.deepStrictEqual(A.SS_parseOpsKey("email_failures"), { kind: "email_failures", clientId: null });
  assert.deepStrictEqual(A.SS_parseOpsKey("a:b:c"), { kind: "a", clientId: "b:c" });
  assert.deepStrictEqual(A.SS_parseOpsKey(null), { kind: "", clientId: null });
});
t("qbo: one row per client, most severe kind wins, title and client link used", () => {
  const list = rules({
    opsRows: [
      { key: "sync_overdue:c1", title: "Acme Co: QuickBooks sync is more than 2x overdue" },
      { key: "qbo_reconnect:c1", title: "Acme Co: QuickBooks needs to be reconnected" },
      { key: "sync_errors:c1", title: "Acme Co: QuickBooks sync failed 3 times in a row" },
    ],
  });
  const q = one(list, "qbo");
  assert.strictEqual(q.length, 1);
  assert.strictEqual(q[0].text, "Acme Co: QuickBooks needs to be reconnected");
  assert.strictEqual(q[0].severity, "danger");
  assert.strictEqual(q[0].href, "#/client/c1/settings/client");
  assert.strictEqual(q[0].to.clientId, "c1");
});
t("qbo: overdue alone is a warning; empty title falls back to the client name", () => {
  const q = one(rules({ opsRows: [{ key: "sync_overdue:c2", title: "" }] }), "qbo")[0];
  assert.strictEqual(q.severity, "warning");
  assert.strictEqual(q.text, "Birch LLC: reconnect QuickBooks");
});
t("qbo: more than 3 clients collapse into one row", () => {
  const list = rules({ opsRows: ["c1", "c2", "c3", "c4"].map((id) => ({ key: "sync_errors:" + id, title: id })) });
  const q = one(list, "qbo");
  assert.strictEqual(q.length, 1);
  assert.strictEqual(q[0].text, "QuickBooks: 4 clients need attention");
  assert.strictEqual(q[0].count, 4);
  assert.strictEqual(rules({ opsRows: ["c1", "c2", "c3"].map((id) => ({ key: "sync_errors:" + id, title: id })) }).length, 3);
});
t("qbo: unknown client id gets the generic text and never prints the id", () => {
  const q = one(rules({ opsRows: [{ key: "qbo_reconnect:deadbeef-uuid", title: "Gone Co: QuickBooks needs to be reconnected" }] }), "qbo")[0];
  assert.strictEqual(q.text, "A client needs QuickBooks attention");
  assert.ok(!(q.text + q.href + (q.detail || "")).includes("deadbeef"));
});
t("qbo: a test client is excluded", () => {
  assert.deepStrictEqual(rules({ opsRows: [{ key: "qbo_reconnect:ct", title: "Test Client: x" }] }), []);
});
t("test clients missing from clientsById are dropped through excludedIds (emails and QuickBooks)", () => {
  const rosterShown = { c1: clients.c1 }; // the list hides test clients by default
  const ex = { excludedIds: ["ct2"], clientsById: rosterShown };
  assert.deepStrictEqual(rules(Object.assign({ emailErrors: [{ client_id: "ct2", created_at: iso(NOW - HOUR) }] }, ex)), []);
  assert.deepStrictEqual(rules(Object.assign({ opsRows: [{ key: "qbo_reconnect:ct2", title: "x" }] }, ex)), []);
  const set = new Set(["ct2"]);
  assert.deepStrictEqual(rules({ excludedIds: set, clientsById: rosterShown, emailErrors: [{ client_id: "ct2", created_at: iso(NOW - HOUR) }] }), []);
});
t("qbo: the sync cron row has its own text", () => {
  const q = rules({ opsRows: [{ key: "qbo_sync_cron", title: "The QuickBooks sync schedule hasn't run recently" }] })[0];
  assert.strictEqual(q.text, "QuickBooks auto-sync isn't running");
  assert.strictEqual(q.severity, "danger");
});
t("unknown key becomes a generic row with its title", () => {
  const g = rules({ opsRows: [{ key: "brand_new_thing", title: "Something new broke" }] })[0];
  assert.strictEqual(g.kind, "generic");
  assert.strictEqual(g.text, "Something new broke");
  assert.strictEqual(g.href, "#/settings");
});
t("drive rows show their titles", () => {
  const list = rules({ opsRows: [{ key: "drive_upload_failures", title: "Google Drive uploads are failing: 3" }, { key: "drive_not_connected", title: "Google Drive file storage isn't connected" }] });
  assert.strictEqual(one(list, "drive").length, 2);
  assert.strictEqual(list[0].text, "Google Drive uploads are failing: 3");
});
t("emails: 24-hour boundary, preview and non-error rows excluded", () => {
  const e = (ms, extra) => Object.assign({ client_id: "c1", feature: "digest", status: "error", trigger: "manual", created_at: iso(ms) }, extra);
  const list = rules({
    emailErrors: [e(NOW - 23 * HOUR), e(NOW - 25 * HOUR), e(NOW - 1 * HOUR, { trigger: "preview" }), e(NOW - 1 * HOUR, { status: "not_configured" }), e(NOW - 24 * HOUR)],
  });
  const m = one(list, "email")[0];
  assert.strictEqual(m.count, 2); // 23h ago and exactly 24h ago
  assert.strictEqual(m.text, "2 client emails failed in the last day");
  assert.strictEqual(m.href, "#/emails");
  assert.strictEqual(rules({ emailErrors: [e(NOW - HOUR)] })[0].text, "1 client email failed in the last day");
});
t("emails: a testOnly client is dropped", () => {
  assert.deepStrictEqual(rules({ emailErrors: [{ client_id: "ct", created_at: iso(NOW - HOUR) }] }), []);
});
t("emails: only the email_failures ops row shows its own title as is", () => {
  const m = rules({ opsRows: [{ key: "email_failures", title: "Emails are failing: 4 failed sends in the last hour" }] })[0];
  assert.strictEqual(m.text, "Emails are failing: 4 failed sends in the last hour");
});
t("emails: client count and ops row merge into one row", () => {
  const list = rules({
    emailErrors: [{ client_id: "c1", created_at: iso(NOW - HOUR) }],
    opsRows: [{ key: "email_failures", title: "Emails are failing" }],
  });
  assert.strictEqual(one(list, "email").length, 1);
  assert.strictEqual(list[0].count, 1);
  assert.strictEqual(list[0].severity, "danger");
});
t("out today: inclusive of both ends, cancelled excluded, info not counted", () => {
  const dir = [{ email: "a@x.org", name: "Ann Lee" }, { email: "b@x.org", name: "Bo Park" }, { email: "c@x.org", name: "Cy Ray" }];
  const rows = [
    { staff_email: "a@x.org", starts_on: "2026-10-20", ends_on: "2026-10-22", cancelled_at: null },
    { staff_email: "b@x.org", starts_on: "2026-10-18", ends_on: "2026-10-20", cancelled_at: null },
    { staff_email: "c@x.org", starts_on: "2026-10-20", ends_on: "2026-10-20", cancelled_at: "2026-10-19T00:00:00Z" },
    { staff_email: "d@x.org", starts_on: "2026-10-21", ends_on: "2026-10-22", cancelled_at: null },
    { staff_email: "e@x.org", starts_on: "2026-10-01", ends_on: "2026-10-19", cancelled_at: null },
  ];
  const list = rules({ timeOff: rows, directory: dir });
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].severity, "info");
  assert.strictEqual(list[0].text, "Out today: Ann, Bo");
  assert.strictEqual(list[0].href, "#/team/people");
  assert.strictEqual(A.SS_alertBadgeCount(list), 0);
});
t("badge count excludes info", () => {
  const list = rules({ usage: { mode: "throttled" }, timeOff: [{ staff_email: "a@x.org", starts_on: "2026-10-20", ends_on: "2026-10-20" }] });
  assert.strictEqual(list.length, 2);
  assert.strictEqual(A.SS_alertBadgeCount(list), 1);
});
t("sorting: priority, then severity; info last", () => {
  const list = rules({
    usage: { mode: "throttled" },
    opsRows: [
      { key: "brand_new_thing", title: "g" },
      { key: "drive_not_connected", title: "d" },
      { key: "sync_overdue:c1", title: "o" },
      { key: "qbo_reconnect:c2", title: "r" },
    ],
    emailErrors: [{ client_id: "c1", created_at: iso(NOW - HOUR) }],
    timeOff: [{ staff_email: "a@x.org", starts_on: "2026-10-20", ends_on: "2026-10-20" }],
  });
  assert.deepStrictEqual(list.map((a) => a.kind), ["usage", "qbo", "qbo", "email", "drive", "generic", "out"]);
  assert.strictEqual(list[1].severity, "danger"); // danger before warning inside qbo
  assert.strictEqual(list[2].severity, "warning");
});
t("split caps at 5 rows with an N more count; info is kept apart", () => {
  const ops5 = [];
  for (let i = 0; i < 7; i++) ops5.push({ key: "mystery_" + i, title: "m" + i });
  const list = rules({ opsRows: ops5, timeOff: [{ staff_email: "a@x.org", starts_on: "2026-10-20", ends_on: "2026-10-20" }] });
  const s = A.SS_alertSplit(list);
  assert.strictEqual(s.shown.length, 5);
  assert.strictEqual(s.more, 2);
  assert.strictEqual(s.info.length, 1);
});
t("null and undefined inputs give [] without throwing", () => {
  assert.deepStrictEqual(A.SS_alertRules(), []);
  assert.deepStrictEqual(A.SS_alertRules(null), []);
  assert.deepStrictEqual(A.SS_alertRules({}), []);
  assert.deepStrictEqual(A.SS_alertRules({ usage: null, opsRows: null, emailErrors: null, timeOff: null, directory: null, clientsById: null, today: null, now: null }), []);
  assert.deepStrictEqual(A.SS_alertRules({ opsRows: [null, {}, { key: null }], emailErrors: [null], timeOff: [null], today: "2026-10-20" }), []);
  assert.strictEqual(A.SS_alertBadgeCount(null), 0);
  assert.deepStrictEqual(A.SS_alertSplit(undefined), { shown: [], more: 0, info: [] });
});

console.log("SS_alerts: " + n + " tests passed");
