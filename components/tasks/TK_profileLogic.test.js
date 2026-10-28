// Plain node, no framework: `node components/tasks/TK_profileLogic.test.js`.
// Slate plus person profile (docs/slateplus-profile-spec.md): the pure
// helpers, the opaque person key, the gated route, the store list kind, and
// the read-only row rule.

const assert = require("assert");

const P = require("./TK_profileLogic.js");
const K = require("./TK_personLink.js");
// TK_store.js reads TKP_personKey as a browser global.
global.TKP_personKey = K.TKP_personKey;
const S = require("./TK_store.js");
const L = require("./TK_logic.js");

let n = 0;
function t(name, fn) {
  fn();
  n++;
}

const ME = "me@example.test";
const SIERRA = "sierra@example.test";
const OTHER = "other@example.test";

// ---- Person key
t("TKP_personKey: 16 hex, stable, case and space blind, never the email", () => {
  const k = K.TKP_personKey(SIERRA);
  assert.ok(/^[0-9a-f]{16}$/.test(k), k);
  assert.strictEqual(K.TKP_personKey("  Sierra@Example.TEST "), k);
  assert.notStrictEqual(K.TKP_personKey(OTHER), k);
  assert.ok(k.indexOf("sierra") < 0);
  assert.strictEqual(K.TKP_personKey(""), "");
  assert.strictEqual(K.TKP_personKey(null), "");
  assert.strictEqual(K.TKP_personKey(undefined), "");
  assert.ok(K.TKP_isPersonKey(k));
  assert.ok(!K.TKP_isPersonKey(SIERRA));
  assert.ok(!K.TKP_isPersonKey(k.toUpperCase()));
  assert.ok(!K.TKP_isPersonKey(k + "0"));
  assert.strictEqual(K.TKP_personHref(SIERRA), "#/tasks/person/" + k);
  assert.strictEqual(K.TKP_personHref(""), "");
});

t("TKP_openPerson does nothing while the gate is off", () => {
  delete global.TKP_on;
  assert.strictEqual(K.TKP_openPerson(SIERRA), false);
  global.TKP_on = () => false;
  assert.strictEqual(K.TKP_openPerson(SIERRA), false);
  global.TKP_on = () => {
    throw new Error("boom");
  };
  assert.strictEqual(K.TKP_openPerson(SIERRA), false);
  delete global.TKP_on;
});

t("TKP_openPerson navigates with the key (never the email) when on", () => {
  let got = null;
  global.TKP_on = () => true;
  global.TK_navigate = (r) => {
    got = r;
  };
  assert.strictEqual(K.TKP_openPerson(SIERRA), true);
  assert.deepStrictEqual(got, { view: "profile", key: K.TKP_personKey(SIERRA) });
  assert.strictEqual(K.TKP_openPerson(""), false);
  delete global.TK_navigate;
  delete global.TKP_on;
});

// ---- Route (gated)
t("#/tasks/person/<key> is unknown with the gate off, profile with it on", () => {
  const k = K.TKP_personKey(SIERRA);
  delete global.TKP_on;
  assert.strictEqual(L.TK_parseRoute("#/tasks/person/" + k).view, "unknown");
  global.TKP_on = () => false;
  assert.strictEqual(L.TK_parseRoute("#/tasks/person/" + k).view, "unknown");
  global.TKP_on = () => true;
  assert.deepStrictEqual(L.TK_parseRoute("#/tasks/person/" + k), { view: "profile", key: k });
  // An email or a bad key never parses as a profile.
  assert.strictEqual(L.TK_parseRoute("#/tasks/person/" + SIERRA).view, "unknown");
  assert.strictEqual(L.TK_parseRoute("#/tasks/person/xyz").view, "unknown");
  assert.strictEqual(L.TK_parseRoute("#/tasks/person/" + k + "/more").view, "unknown");
  delete global.TKP_on;
});

t("TK_formatRoute writes the profile route only for a valid key", () => {
  const k = K.TKP_personKey(SIERRA);
  assert.strictEqual(L.TK_formatRoute({ view: "profile", key: k }), "#/tasks/person/" + k);
  assert.strictEqual(L.TK_formatRoute({ view: "profile", key: SIERRA }), L.TK_formatRoute({ view: "mine" }));
  assert.strictEqual(L.TK_formatRoute({ view: "profile" }), L.TK_formatRoute({ view: "mine" }));
});

t("existing routes unchanged by the profile branch", () => {
  const u = "00000000-0000-4000-8000-000000000001";
  const hashes = ["#/tasks", "#/tasks/u/" + u, "#/tasks/p/" + u, "#/tasks/c/7", "#/tasks/person"];
  delete global.TKP_on;
  const off = hashes.map((h) => L.TK_parseRoute(h));
  global.TKP_on = () => true;
  assert.deepStrictEqual(hashes.map((h) => L.TK_parseRoute(h)), off);
  delete global.TKP_on;
});

// ---- Store list kind
function task(over) {
  return Object.assign(
    { id: "t" + Math.random().toString(16).slice(2), text: "x", status: "todo", done: false, assignee_email: SIERRA, staff_email: ME, updated_at: "2026-10-27T00:00:00Z" },
    over || {},
  );
}

t("assignee:<key> list holds that person's tasks and follows reassignment", () => {
  const key = "assignee:" + K.TKP_personKey(SIERRA);
  const a = task();
  const b = task({ assignee_email: OTHER });
  let s = S.TK_reduce(S.TK_reduce(S.TK_initialState(), { type: "me", email: ME }), { type: "listLoaded", key: key, tasks: [a, b] });
  assert.deepStrictEqual(s.lists[key].ids, [a.id]);
  s = S.TK_reduce(s, { type: "upsert", task: Object.assign({}, a, { assignee_email: OTHER, updated_at: "2026-10-27T01:00:00Z" }) });
  assert.deepStrictEqual(s.lists[key].ids, []);
  s = S.TK_reduce(s, { type: "upsert", task: Object.assign({}, b, { assignee_email: "SIERRA@example.test", updated_at: "2026-10-27T01:00:00Z" }) });
  assert.deepStrictEqual(s.lists[key].ids, [b.id]);
});

t("TK_listKey still never builds a key from an email", () => {
  assert.strictEqual(S.TK_listKey({ assigneeEmail: SIERRA }), null);
});

// ---- Read-only rows (TK_canEdit is the hint the profile uses)
t("another person's task is read-only unless the viewer could already edit it", () => {
  const ctx = { email: ME, isAdmin: false, canSeeClient: () => true, isMember: () => true };
  // Theirs, created by them, private: read-only for me.
  assert.strictEqual(L.TK_canEdit({ staff_email: SIERRA, assignee_email: SIERRA, visibility: "private" }, ctx), false);
  // Created by me: editable (owner).
  assert.strictEqual(L.TK_canEdit({ staff_email: ME, assignee_email: SIERRA }, ctx), true);
  // Shared on a client I can see: editable, same as anywhere in Slate.
  assert.strictEqual(L.TK_canEdit({ staff_email: SIERRA, assignee_email: SIERRA, visibility: "shared", client_id: 7 }, ctx), true);
  // Shared on a client I cannot see: read-only.
  assert.strictEqual(
    L.TK_canEdit({ staff_email: SIERRA, assignee_email: SIERRA, visibility: "shared", client_id: 7 }, Object.assign({}, ctx, { canSeeClient: () => false })),
    false,
  );
  // Admin flag (the profile passes real admins only).
  assert.strictEqual(L.TK_canEdit({ staff_email: SIERRA, assignee_email: SIERRA, visibility: "private" }, Object.assign({}, ctx, { isAdmin: true })), true);
});

// ---- Pure helpers
t("TKP_findByKey resolves against the directory only", () => {
  const dir = [
    { email: "A@x.test", name: "A", role: "bookkeeper" },
    { email: SIERRA, name: "Sierra", role: "admin" },
  ];
  assert.deepStrictEqual(P.TKP_findByKey(dir, K.TKP_personKey(SIERRA), K.TKP_personKey), { email: SIERRA, name: "Sierra", role: "admin" });
  assert.strictEqual(P.TKP_findByKey(dir, K.TKP_personKey("nobody@x.test"), K.TKP_personKey), null);
  assert.strictEqual(P.TKP_findByKey(dir, "", K.TKP_personKey), null);
  assert.strictEqual(P.TKP_findByKey(null, "abc", K.TKP_personKey), null);
  assert.strictEqual(P.TKP_findByKey(dir, "abc", null), null);
  assert.strictEqual(P.TKP_findByKey(dir, K.TKP_personKey("a@x.test"), K.TKP_personKey).email, "a@x.test");
});

t("TKP_sections and TKP_glance", () => {
  const g = { overdue: [1, 2], today: [3], week: [4, 5], later: [6], waiting: [7] };
  const s = P.TKP_sections(g);
  assert.deepStrictEqual(
    s.map((x) => [x.key, x.tasks.length]),
    [
      ["late", 2],
      ["week", 3],
      ["later", 1],
      ["waiting", 1],
    ],
  );
  assert.deepStrictEqual(P.TKP_glance(g), { open: 7, week: 3, late: 2, waiting: 1 });
  assert.deepStrictEqual(P.TKP_glance(null), { open: 0, week: 0, late: 0, waiting: 0 });
});

t("TKP_coveredClients: viewer's list only, roles, no internal or test", () => {
  const clients = [
    { id: 2, name: "Zeta", assignedBookkeeper: { email: SIERRA } },
    { id: 1, name: "Alpha", accountManager: { email: "Sierra@Example.test" }, assignedBookkeeper: { email: SIERRA } },
    { id: 3, name: "Internal", isInternal: true, assignedBookkeeper: { email: SIERRA } },
    { id: 4, name: "Test", testOnly: true, assignedBookkeeper: { email: SIERRA } },
    { id: 5, name: "Other", assignedBookkeeper: { email: OTHER } },
    null,
  ];
  assert.deepStrictEqual(P.TKP_coveredClients(clients, SIERRA), [
    { id: "1", name: "Alpha", roles: ["Bookkeeper", "Account manager"] },
    { id: "2", name: "Zeta", roles: ["Bookkeeper"] },
  ]);
  assert.deepStrictEqual(P.TKP_coveredClients(clients, ""), []);
});

t("TKP_backupSummary: most common backup over readable rows", () => {
  const b = { 1: OTHER, 2: OTHER, 3: "z@x.test", 4: "", 5: SIERRA };
  assert.deepStrictEqual(P.TKP_backupSummary(b, [1, 2, 3, 4, 5, 6], SIERRA), { email: OTHER, count: 2, total: 5, unset: 2 });
  assert.strictEqual(P.TKP_backupSummary({}, [1], SIERRA), null);
  assert.strictEqual(P.TKP_backupSummary(null, null, SIERRA), null);
  // Ties break alphabetically.
  assert.strictEqual(P.TKP_backupSummary({ 1: "b@x.test", 2: "a@x.test" }, [1, 2], SIERRA).email, "a@x.test");
});

t("TKP_timeOff: current or next within 30 days, cancelled ignored", () => {
  const rows = [
    { staff_email: SIERRA, starts_on: "2026-11-20", ends_on: "2026-11-21" },
    { staff_email: SIERRA, starts_on: "2026-11-01", ends_on: "2026-11-03" },
    { staff_email: SIERRA, starts_on: "2026-10-26", ends_on: "2026-10-28", cancelled_at: "x" },
    { staff_email: OTHER, starts_on: "2026-10-27", ends_on: "2026-10-27" },
    { staff_email: SIERRA, starts_on: "2027-01-01", ends_on: "2027-01-02" },
  ];
  const r = P.TKP_timeOff(rows, SIERRA, "2026-10-27");
  assert.strictEqual(r.row.starts_on, "2026-11-01");
  assert.strictEqual(r.now, false);
  const now = P.TKP_timeOff([{ staff_email: SIERRA, starts_on: "2026-10-25", ends_on: "2026-10-27" }], SIERRA, "2026-10-27");
  assert.strictEqual(now.now, true);
  assert.strictEqual(P.TKP_timeOff(rows, OTHER, "2026-11-01"), null);
  assert.strictEqual(P.TKP_timeOff(null, SIERRA, "2026-10-27"), null);
});

t("TKP_collaborators: once per task, only tasks they are on, top N", () => {
  const tasks = [
    { id: 1, assignee_email: SIERRA, staff_email: OTHER },
    { id: 1, assignee_email: SIERRA, staff_email: OTHER }, // duplicate read
    { id: 2, assignee_email: OTHER, reviewer_email: SIERRA },
    { id: 3, assignee_email: "c@x.test", staff_email: SIERRA },
    { id: 4, assignee_email: "d@x.test", staff_email: "e@x.test" }, // not on it
    { id: 5, assignee_email: "d@x.test", staff_email: "d@x.test", __commented: true },
    { id: 6, assignee_email: OTHER, staff_email: SIERRA, deleted_at: "x" },
    { id: 7, assignee_email: "unassigned", staff_email: SIERRA },
  ];
  assert.deepStrictEqual(P.TKP_collaborators(SIERRA, tasks), [
    { email: OTHER, count: 2 },
    { email: "c@x.test", count: 1 },
    { email: "d@x.test", count: 1 },
  ]);
  assert.strictEqual(P.TKP_collaborators(SIERRA, tasks, 1).length, 1);
  assert.deepStrictEqual(P.TKP_collaborators(SIERRA, null), []);
});

t("TKP_recent: newest first, unnamed ids dropped", () => {
  const tasks = [
    { client_id: 1, project_id: "p1", updated_at: "2026-10-01" },
    { client_id: 2, updated_at: "2026-10-20" },
    { client_id: 1, completed_at: "2026-10-25" },
    { client_id: 9, updated_at: "2026-10-26" }, // not in the viewer's clients
    { project_id: "p2", __touched_at: "2026-10-27" },
    { client_id: 3, updated_at: "2026-10-27", deleted_at: "x" },
  ];
  const names = { 1: "Alpha", 2: "Beta" };
  const r = P.TKP_recent(tasks, { clientName: (id) => names[id] || "", projectName: (id) => (id === "p1" ? "Close" : ""), limit: 5 });
  assert.deepStrictEqual(
    r.clients.map((c) => c.name),
    ["Alpha", "Beta"],
  );
  assert.deepStrictEqual(
    r.projects.map((p) => p.name),
    ["Close"],
  );
  assert.deepStrictEqual(P.TKP_recent(tasks, {}), { clients: [], projects: [] });
});

t("TKP_shoutoutsFor: to them, not hidden, newest first", () => {
  const rows = [
    { id: 1, to_email: SIERRA, created_at: "2026-10-01" },
    { id: 2, to_email: SIERRA, created_at: "2026-10-20", hidden_at: "x" },
    { id: 3, to_email: "SIERRA@example.test", created_at: "2026-10-21" },
    { id: 4, to_email: OTHER, created_at: "2026-10-22" },
  ];
  assert.deepStrictEqual(
    P.TKP_shoutoutsFor(rows, SIERRA).map((r) => r.id),
    [3, 1],
  );
  assert.strictEqual(P.TKP_shoutoutsFor(rows, SIERRA, 1).length, 1);
});

t("TKP_lastSeenAt picks the later of view and action", () => {
  assert.strictEqual(P.TKP_lastSeenAt({ last_view: { occurred_at: "2026-10-26T10:00:00Z" }, last_action_at: "2026-10-27T09:00:00Z" }), "2026-10-27T09:00:00Z");
  assert.strictEqual(P.TKP_lastSeenAt({ last_view: { occurred_at: "2026-10-27T10:00:00Z" } }), "2026-10-27T10:00:00Z");
  assert.strictEqual(P.TKP_lastSeenAt(null), "");
  assert.strictEqual(P.TKP_lastSeenAt("x"), "");
});

console.log("TK_profileLogic: " + n + " tests passed");
