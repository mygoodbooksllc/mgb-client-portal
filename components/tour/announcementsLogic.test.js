// Plain node, no framework: `node components/tour/announcementsLogic.test.js`.
// Guards the launch announcement rules (announcementsLogic.js) and the
// registry (announcements.js).

const assert = require("assert");
const L = require("./announcementsLogic.js");

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

const NOW = Date.parse("2026-10-20T12:00:00Z");
const admin = { isAdmin: true, isBookkeeper: false, tempAdmin: false, amCount: 0 };
const bk = { isAdmin: false, isBookkeeper: true, tempAdmin: false, amCount: 0 };
const tempAdmin = { isAdmin: false, isBookkeeper: true, tempAdmin: true, amCount: 0 };
const am = { isAdmin: false, isBookkeeper: true, tempAdmin: false, amCount: 2 };

function entry(id, date, roles) {
  return { id, date, title: id, summary: "s", roles: roles || ["admin", "bookkeeper"], hash: "#/today", steps: () => [] };
}
const state = (extra) => Object.assign({ rows: {}, accountStart: "2026-01-01T00:00:00Z", hidden: [] }, extra || {});

// ---- Merging the saved copy with the database's
t("merge: the stronger answer wins, either way round", () => {
  const seen = { status: "seen", later_count: 0 };
  const later = { status: "later", later_count: 1 };
  const dismissed = { status: "dismissed", later_count: 0 };
  const toured = { status: "toured", later_count: 0 };
  assert.strictEqual(L.ANN_merge(seen, toured).status, "toured");
  assert.strictEqual(L.ANN_merge(toured, seen).status, "toured");
  assert.strictEqual(L.ANN_merge(later, dismissed).status, "dismissed");
  assert.strictEqual(L.ANN_merge(dismissed, toured).status, "toured");
  assert.strictEqual(L.ANN_merge(seen, later).status, "later");
  assert.strictEqual(L.ANN_merge(later, seen).status, "later");
});
t("merge: the Later count is the higher one, capped", () => {
  const m = L.ANN_merge({ status: "later", later_count: 2 }, { status: "later", later_count: 1 });
  assert.deepStrictEqual(m, { status: "later", later_count: 2 });
  assert.strictEqual(L.ANN_merge({ status: "seen", later_count: 0 }, { status: "later", later_count: 9 }).later_count, L.ANN_LATER_MAX);
  assert.strictEqual(L.ANN_merge({ status: "toured", later_count: 0 }, { status: "seen", later_count: 2 }).later_count, 2);
});
t("merge: an exhausted Later counts as dismissed", () => {
  const m = L.ANN_merge({ status: "later", later_count: 3 }, { status: "later", later_count: 1 });
  assert.strictEqual(L.ANN_effectiveStatus(m), "dismissed");
  assert.strictEqual(L.ANN_merge({ status: "later", later_count: 3 }, { status: "seen", later_count: 0 }).status, "later");
});
t("merge: one side missing or unreadable", () => {
  const r = { status: "seen", later_count: 0 };
  assert.strictEqual(L.ANN_merge(null, r), r);
  assert.strictEqual(L.ANN_merge(r, undefined), r);
  assert.strictEqual(L.ANN_merge(null, null), null);
  assert.strictEqual(L.ANN_merge({ status: "bogus" }, r).status, "seen");
});

// ---- Roles
t("role set: admin, temp admin, bookkeeper, account manager", () => {
  assert.deepStrictEqual(L.ANN_roleSet(admin), ["admin"]);
  assert.deepStrictEqual(L.ANN_roleSet(bk), ["bookkeeper"]);
  assert.deepStrictEqual(L.ANN_roleSet(tempAdmin), ["tempAdmin", "bookkeeper"]);
  assert.deepStrictEqual(L.ANN_roleSet(am), ["bookkeeper", "accountManager"]);
  assert.deepStrictEqual(L.ANN_roleSet(null), []);
});
t("audience filters by role", () => {
  const reg = [entry("a", "2026-10-15", ["admin"]), entry("b", "2026-10-15", ["bookkeeper"]), entry("c", "2026-10-15", ["accountManager"]), entry("d", "2026-10-15", ["tempAdmin"]), entry("e", "2026-10-15", ["client"])];
  const ids = (ctx) => L.ANN_audience(reg, ctx).map((x) => x.id);
  assert.deepStrictEqual(ids(admin), ["a"]);
  assert.deepStrictEqual(ids(bk), ["b"]);
  assert.deepStrictEqual(ids(am), ["b", "c"]);
  assert.deepStrictEqual(ids(tempAdmin), ["b", "d"]);
  assert.deepStrictEqual(ids({}), [], "no role, no notice (clients never get one)");
});
t("an admin-only launch never reaches a bookkeeper", () => {
  assert.strictEqual(L.ANN_pickNext([entry("a", "2026-10-15", ["admin"])], state(), bk, NOW), null);
});

// ---- ready(): the notice waits for the entry's own precondition (S8b)
t("ready: a gated launch waits, the next one shows instead, and a throwing ready counts as not yet", () => {
  let seen = false;
  const gated = Object.assign(entry("g", "2026-10-16"), { ready: () => seen });
  const older = entry("o", "2026-10-15");
  assert.strictEqual(L.ANN_pickNext([gated, older], state(), admin, NOW).id, "o");
  seen = true;
  assert.strictEqual(L.ANN_pickNext([gated, older], state(), admin, NOW).id, "g");
  const broken = Object.assign(entry("b", "2026-10-16"), { ready: () => { throw new Error("no storage"); } });
  assert.strictEqual(L.ANN_pickNext([broken], state(), admin, NOW), null);
  assert.strictEqual(L.ANN_ready(entry("x", "2026-10-16"), admin), true, "no ready() means ready");
  // the audience (What's new, the ? menu) still lists a gated launch
  assert.deepStrictEqual(L.ANN_audience([broken], admin).map((x) => x.id), ["b"]);
});

// ---- Statuses
t("a new announcement is picked, a toured or dismissed one is not", () => {
  const reg = [entry("a", "2026-10-15")];
  assert.strictEqual(L.ANN_pickNext(reg, state(), admin, NOW).id, "a");
  assert.strictEqual(L.ANN_pickNext(reg, state({ rows: { a: { status: "toured" } } }), admin, NOW), null);
  assert.strictEqual(L.ANN_pickNext(reg, state({ rows: { a: { status: "dismissed" } } }), admin, NOW), null);
});
t("seen and later come back on the next visit", () => {
  const reg = [entry("a", "2026-10-15")];
  assert.strictEqual(L.ANN_pickNext(reg, state({ rows: { a: { status: "seen", later_count: 0 } } }), admin, NOW).id, "a");
  assert.strictEqual(L.ANN_pickNext(reg, state({ rows: { a: { status: "later", later_count: 2 } } }), admin, NOW).id, "a");
});
t("apply: first show is seen and keeps an existing answer", () => {
  assert.deepStrictEqual(L.ANN_apply(null, "show"), { status: "seen", later_count: 0 });
  assert.deepStrictEqual(L.ANN_apply({ status: "later", later_count: 1 }, "show"), { status: "later", later_count: 1 });
  assert.deepStrictEqual(L.ANN_apply({ status: "toured", later_count: 0 }, "show"), { status: "toured", later_count: 0 });
});
t("Later three times counts as dismissed", () => {
  let row = L.ANN_apply(null, "show");
  row = L.ANN_apply(row, "later");
  assert.deepStrictEqual(row, { status: "later", later_count: 1 });
  row = L.ANN_apply(row, "later");
  assert.deepStrictEqual(row, { status: "later", later_count: 2 });
  row = L.ANN_apply(row, "later");
  assert.deepStrictEqual(row, { status: "dismissed", later_count: 3 });
  assert.strictEqual(L.ANN_pickNext([entry("a", "2026-10-15")], state({ rows: { a: row } }), admin, NOW), null);
  // Even a row left as "later" with a count of 3 reads as dismissed.
  assert.strictEqual(L.ANN_effectiveStatus({ status: "later", later_count: 3 }), "dismissed");
  assert.strictEqual(L.ANN_pickNext([entry("a", "2026-10-15")], state({ rows: { a: { status: "later", later_count: 3 } } }), admin, NOW), null);
  assert.strictEqual(L.ANN_apply({ status: "later", later_count: 3 }, "later").later_count, 3, "never past the limit");
});
t("Skip is dismissed; finishing or skipping the tour is toured", () => {
  assert.strictEqual(L.ANN_apply({ status: "seen", later_count: 0 }, "skip").status, "dismissed");
  assert.strictEqual(L.ANN_apply({ status: "later", later_count: 1 }, "tour").status, "toured");
  assert.strictEqual(L.ANN_apply(null, "tour").status, "toured");
});
t("unknown status reads as no answer", () => {
  assert.strictEqual(L.ANN_effectiveStatus({ status: "weird" }), null);
  assert.strictEqual(L.ANN_effectiveStatus(null), null);
});

// ---- Account start
t("only announcements on or after the account start count", () => {
  const reg = [entry("old", "2026-10-01"), entry("same", "2026-10-10"), entry("new", "2026-10-15")];
  const ids = (start) => {
    const out = [];
    const hidden = [];
    for (let i = 0; i < 3; i++) {
      const p = L.ANN_pickNext(reg, state({ accountStart: start, hidden }), admin, NOW);
      if (!p) break;
      out.push(p.id);
      hidden.push(p.id);
    }
    return out;
  };
  assert.deepStrictEqual(ids("2026-10-10T08:00:00Z"), ["new", "same"], "dated on the start day counts");
  assert.deepStrictEqual(ids("2026-10-16T00:00:00Z"), [], "a new hire gets none from before they started");
  assert.deepStrictEqual(ids("2026-01-01T00:00:00Z"), ["new", "same", "old"]);
});
t("an unknown account start shows nothing", () => {
  const reg = [entry("a", "2026-10-15")];
  assert.strictEqual(L.ANN_pickNext(reg, state({ accountStart: null }), admin, NOW), null);
  assert.strictEqual(L.ANN_pickNext(reg, state({ accountStart: "garbage" }), admin, NOW), null);
});

// ---- One at a time
t("newest first, one at a time, ties keep registry order", () => {
  const reg = [entry("a", "2026-10-10"), entry("b", "2026-10-14"), entry("c", "2026-10-14")];
  assert.strictEqual(L.ANN_pickNext(reg, state(), admin, NOW).id, "b");
  assert.strictEqual(L.ANN_pickNext(reg, state({ hidden: ["b"] }), admin, NOW).id, "c");
  assert.strictEqual(L.ANN_pickNext(reg, state({ hidden: ["b", "c"] }), admin, NOW).id, "a");
  assert.strictEqual(L.ANN_pickNext(reg, state({ hidden: ["a", "b", "c"] }), admin, NOW), null);
  // Returns one entry, never a list.
  assert.ok(!Array.isArray(L.ANN_pickNext(reg, state(), admin, NOW)));
});
t("answering the newest lets the next one through on the next visit", () => {
  const reg = [entry("a", "2026-10-10"), entry("b", "2026-10-14")];
  assert.strictEqual(L.ANN_pickNext(reg, state({ rows: { b: { status: "toured" } } }), admin, NOW).id, "a");
});
t("an empty or missing registry is quiet", () => {
  assert.strictEqual(L.ANN_pickNext([], state(), admin, NOW), null);
  assert.strictEqual(L.ANN_pickNext(null, state(), admin, NOW), null);
});

// ---- 60-day cap
t("stops showing 60 days after its date", () => {
  const reg = [entry("a", "2026-08-01")];
  const at = (iso) => L.ANN_pickNext(reg, state(), admin, Date.parse(iso));
  assert.ok(at("2026-09-30T12:00:00Z"), "day 60 still shows");
  assert.strictEqual(at("2026-10-01T12:00:00Z"), null, "day 61 does not");
  assert.strictEqual(at("2026-12-01T12:00:00Z"), null);
});

// ---- Never while something else is going on
t("blocked while a tour is busy or the profile prompt is open", () => {
  const reg = [entry("a", "2026-10-15")];
  assert.strictEqual(L.ANN_pickNext(reg, state(), Object.assign({ busy: true }, admin), NOW), null);
  assert.strictEqual(L.ANN_pickNext(reg, state(), Object.assign({ profileOpen: true }, admin), NOW), null);
  assert.strictEqual(L.ANN_pickNext(reg, state(), Object.assign({ busy: false, profileOpen: false }, admin), NOW).id, "a");
});
t("never during View as or a preview", () => {
  const reg = [entry("a", "2026-10-15")];
  assert.strictEqual(L.ANN_pickNext(reg, state(), Object.assign({ impersonating: true }, admin), NOW), null);
  assert.strictEqual(L.ANN_pickNext(reg, state(), Object.assign({ previewing: true }, admin), NOW), null);
  assert.strictEqual(L.ANN_blocked(null), false);
});

// ---- Admin report
t("report counts seen, toured, dismissed and not yet, with names", () => {
  const reg = [entry("a", "2026-10-15", ["admin", "bookkeeper"])];
  const person = (email, name, role, created) => ({ staff_email: email, staff_name: name, staff_role: role, staff_created_at: created, announcement_id: null });
  const data = [
    Object.assign(person("a@x", "Ann", "admin", "2026-01-01T00:00:00Z"), { announcement_id: "a", status: "toured" }),
    Object.assign(person("b@x", "Bo", "bookkeeper", "2026-01-01T00:00:00Z"), { announcement_id: "a", status: "later", later_count: 2 }),
    Object.assign(person("c@x", "Cy", "bookkeeper", "2026-01-01T00:00:00Z"), { announcement_id: "a", status: "later", later_count: 3 }),
    person("d@x", "Di", "bookkeeper", "2026-01-01T00:00:00Z"),
    person("e@x", "Ed", "bookkeeper", "2026-10-16T00:00:00Z"),
  ];
  const r = L.ANN_report(reg, data)[0];
  assert.deepStrictEqual([r.toured, r.seen, r.dismissed, r.notYet], [1, 1, 1, 1]);
  assert.deepStrictEqual(r.names.toured, ["Ann"]);
  assert.deepStrictEqual(r.names.seen, ["Bo"]);
  assert.deepStrictEqual(r.names.dismissed, ["Cy"]);
  assert.deepStrictEqual(r.names.notYet, ["Di"], "Ed joined after the launch, so isn't owed it");
});
t("report skips roles the launch isn't for", () => {
  const reg = [entry("a", "2026-10-15", ["admin"])];
  const data = [
    { staff_email: "a@x", staff_name: "Ann", staff_role: "admin", staff_created_at: "2026-01-01", announcement_id: null },
    { staff_email: "b@x", staff_name: "Bo", staff_role: "bookkeeper", staff_created_at: "2026-01-01", announcement_id: null },
  ];
  const r = L.ANN_report(reg, data)[0];
  assert.deepStrictEqual(r.names.notYet, ["Ann"]);
});

// ---- Registry integrity
t("supersedes: once the combined entry has been shown, the ones it covers stop", () => {
  const old1 = entry("old1", "2026-10-17");
  const old2 = entry("old2", "2026-10-18");
  const combo = Object.assign(entry("combo", "2026-10-21"), { supersedes: ["old1", "old2"] });
  const reg = [combo, old1, old2];
  // Before the combined one has any answer, it is the newest and shows first.
  assert.strictEqual(L.ANN_pickNext(reg, state(), admin, NOW).id, "combo");
  // Shown (seen), then answered Later or Skip: the covered ones never trickle out.
  ["seen", "later", "dismissed", "toured"].forEach((status) => {
    const st = state({ rows: { combo: { status, later_count: status === "later" ? 1 : 0 } }, hidden: [] });
    const next = L.ANN_pickNext(reg, st, admin, NOW);
    assert.ok(!next || next.id === "combo", status + " leaves old1 and old2 out");
  });
  assert.strictEqual(L.ANN_pickNext(reg, state({ rows: { combo: { status: "toured" } } }), admin, NOW), null);
  // A person it is not for (role) still gets the older ones.
  const adminOnly = Object.assign(entry("combo", "2026-10-21", ["admin"]), { supersedes: ["old1"] });
  assert.strictEqual(L.ANN_pickNext([adminOnly, old1], state({ rows: {} }), bk, NOW).id, "old1");
  // A combined entry still waiting on its own ready() does not hide them yet.
  const waiting = Object.assign(entry("combo", "2026-10-21"), { supersedes: ["old1"], ready: () => false });
  assert.strictEqual(L.ANN_pickNext([waiting, old1], state(), admin, NOW).id, "old1");
});

const { ANN_REGISTRY } = require("./announcements.js");
// Tour.jsx helpers the steps call when a tour starts.
global.TOUR_tabStep = (place, tab, title, body) => ({ id: place + "-" + tab, title, body: () => body, targets: ["#tp-tab-" + tab] });
global.TOUR_go = () => () => {};

t("registry: unique ids, valid fields", () => {
  assert.ok(ANN_REGISTRY.length >= 1);
  const seen = new Set();
  ANN_REGISTRY.forEach((a) => {
    assert.ok(/^[a-z0-9][a-z0-9-]{0,63}$/.test(a.id), "id " + a.id);
    assert.ok(!seen.has(a.id), "duplicate id " + a.id);
    seen.add(a.id);
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(a.date) && !isNaN(Date.parse(a.date)), "date " + a.id);
    assert.ok(typeof a.title === "string" && a.title.trim(), "title " + a.id);
    assert.ok(typeof a.summary === "string" && a.summary.trim(), "summary " + a.id);
    assert.ok(Array.isArray(a.roles) && a.roles.length, "roles " + a.id);
    a.roles.forEach((r) => assert.ok(L.ANN_ROLES.indexOf(r) !== -1, "role " + r + " in " + a.id));
    assert.ok(typeof a.hash === "string" && a.hash.charAt(0) === "#", "hash " + a.id);
    assert.strictEqual(typeof a.steps, "function", "steps is a function " + a.id);
  });
});
t("registry: 3 to 6 steps, a centered welcome first, unique step ids", () => {
  ANN_REGISTRY.forEach((a) => {
    const steps = a.steps({ isAdmin: true });
    assert.ok(steps.length >= 3 && steps.length <= 6, a.id + " has " + steps.length + " steps");
    assert.ok(!steps[0].targets && !steps[0].go, a.id + ": first step is a centered welcome");
    const ids = steps.map((s) => s.id);
    assert.strictEqual(new Set(ids).size, ids.length, a.id + ": step ids repeat");
    steps.forEach((s) => assert.ok(s.title && typeof s.body === "function", a.id + ": step " + s.id));
  });
});
t("registry: the id fits the database key and the tour key", () => {
  ANN_REGISTRY.forEach((a) => assert.ok(("ann:" + a.id).length <= 68));
});

t("registry: unassigned-tasks is gated on having seen an Unassigned task", () => {
  const a = ANN_REGISTRY.find((x) => x.id === "unassigned-tasks");
  assert.ok(a && typeof a.ready === "function");
  // node has no window/localStorage: not ready, and it doesn't throw out
  assert.strictEqual(L.ANN_ready(a, admin), false);
});

t("registry: desk-rename is Slate-only when the Desk is off", () => {
  const a = ANN_REGISTRY.find((x) => x.id === "desk-rename");
  assert.ok(a);
  // node has no WB_store: the Desk is off
  assert.strictEqual(a.title, "Tasks is now Slate");
  assert.ok(!/Workbench|Desk/.test(a.summary));
  const steps = a.steps({});
  assert.ok(!/Workbench|Desk/.test(steps[0].body()));
  assert.strictEqual(steps[1].when(), false);
  assert.strictEqual(steps[2].title, "Same place, new name");
});

t("registry: late-task-grace is a plain notice with the grace-period wording", () => {
  const a = ANN_REGISTRY.find((x) => x.id === "late-task-grace");
  assert.ok(a);
  assert.ok(/No late-task penalties yet/.test(a.summary));
  assert.ok(!/colour/i.test(JSON.stringify(a.steps({}).map((x) => x.body()))));
  assert.ok(a.steps({}).some((x) => /Filing deadlines/.test(x.body())));
});

t("registry: desk-launch waits for the Desk and points at the width grip", () => {
  const a = ANN_REGISTRY.find((x) => x.id === "desk-launch");
  assert.ok(a && typeof a.ready === "function");
  assert.deepStrictEqual(a.roles, ["admin", "bookkeeper"]);
  // node has no WB_store: the Desk is off, so the notice waits
  assert.strictEqual(L.ANN_ready(a, admin), false);
  const steps = a.steps({});
  assert.deepStrictEqual(
    steps.map((s) => s.id),
    ["ann-welcome", "ann-bar", "ann-handle", "ann-page"],
  );
  assert.deepStrictEqual(steps[1].targets, ["wb-bar"]);
  assert.deepStrictEqual(steps[2].targets, ["wb-desk-handle"]);
  // node has no window: not docked, so the handle step drops out
  assert.strictEqual(steps[2].when(), false);
  assert.ok(/\bD\b/.test(steps[1].body()) && !/press W/.test(steps[1].body()));
});

t("registry: desk-right-now waits for the Desk and tours the Right now card", () => {
  const a = ANN_REGISTRY.find((x) => x.id === "desk-right-now");
  assert.ok(a && typeof a.ready === "function");
  assert.deepStrictEqual(a.roles, ["admin", "bookkeeper"]);
  assert.strictEqual(L.ANN_ready(a, admin), false);
  const steps = a.steps({});
  assert.deepStrictEqual(steps.map((s) => s.id), ["ann-welcome", "ann-rightnow", "ann-topbar"]);
  assert.deepStrictEqual(steps[1].targets, ["wb-rightnow", "wb-glance"]);
  // No client of mine: the card step drops out.
  assert.strictEqual(steps[1].when({}), false);
  assert.strictEqual(steps[1].when({ myClient: { id: "c1" } }), true);
  const text = JSON.stringify(steps.map((x) => x.body()));
  assert.ok(/Right now/.test(text) && /QuickBooks/.test(text) && !/colour/i.test(text));
  assert.strictEqual(ANN_REGISTRY[1].id, "desk-right-now");
});

t("registry: today-redesign is newest, for admins and bookkeepers, and points at Today targets", () => {
  const a = ANN_REGISTRY[0];
  assert.strictEqual(a.id, "today-redesign");
  assert.deepStrictEqual(a.roles, ["admin", "bookkeeper"]);
  const steps = a.steps({});
  assert.deepStrictEqual(steps.map((x) => x.id), ["ann-welcome", "ann-next", "ann-summary", "ann-cards"]);
  assert.deepStrictEqual(steps[1].targets, ["today-list"]);
  assert.ok(!/colour/i.test(JSON.stringify(steps.map((x) => x.body()))));
});

t("registry: desk-task-view waits for the Desk and is three short steps", () => {
  const a = ANN_REGISTRY.find((x) => x.id === "desk-task-view");
  assert.ok(a && typeof a.ready === "function");
  assert.deepStrictEqual(a.roles, ["admin", "bookkeeper"]);
  assert.strictEqual(L.ANN_ready(a, admin), false);
  const steps = a.steps({});
  assert.deepStrictEqual(steps.map((s) => s.id), ["ann-welcome", "ann-row", "ann-keys"]);
  const text = JSON.stringify(steps.map((x) => x.body()));
  assert.ok(/F6/.test(text) && /Back/.test(text) && !/colour/i.test(text));
});

t("registry: desk-right-launch waits for the Desk and tours bar, rail and width grip", () => {
  const a = ANN_REGISTRY.find((x) => x.id === "desk-right-launch");
  assert.ok(a && typeof a.ready === "function");
  assert.deepStrictEqual(a.roles, ["admin", "bookkeeper"]);
  assert.strictEqual(L.ANN_ready(a, admin), false);
  const steps = a.steps({});
  assert.deepStrictEqual(
    steps.map((s) => s.id),
    ["ann-welcome", "ann-bar", "ann-rail", "ann-handle", "ann-done"],
  );
  assert.deepStrictEqual(steps[1].targets, ["wb-bar"]);
  assert.deepStrictEqual(steps[2].targets, ["wb-rail"]);
  assert.deepStrictEqual(steps[3].targets, ["wb-desk-handle"]);
  // node has no window: no rail or grip steps
  assert.strictEqual(steps[2].when(), false);
  assert.strictEqual(steps[3].when(), false);
  const text = JSON.stringify(steps.map((x) => x.body()));
  assert.ok(!/colour/i.test(text) && !/top edge/i.test(text));
});

t("registry: dup-smart is an admin and bookkeeper notice naming Smart and Strict", () => {
  const a = ANN_REGISTRY.find((x) => x.id === "dup-smart");
  assert.ok(a);
  assert.deepStrictEqual(a.roles, ["admin", "bookkeeper"]);
  assert.ok(/Smart/.test(a.summary) && /Strict/.test(a.summary));
  assert.ok(!/colour/i.test(JSON.stringify(a.steps({}).map((x) => x.body ? x.body() : ""))));
  assert.strictEqual(a.steps({})[0].targets, undefined);
});

t("registry: rail-default is an admin and bookkeeper notice pointing at the rail", () => {
  const a = ANN_REGISTRY.find((x) => x.id === "rail-default");
  assert.ok(a);
  assert.deepStrictEqual(a.roles, ["admin", "bookkeeper"]);
  const steps = a.steps({});
  assert.strictEqual(steps.length, 3);
  assert.strictEqual(steps[0].targets, undefined);
  assert.deepStrictEqual(steps[1].targets, ["staff-nav"]);
  assert.ok(!/colour/i.test(JSON.stringify(steps.map((x) => x.body()))));
});

t("registry: one-avatar points at the top-right account menu, the drawer row on phones", () => {
  const a = ANN_REGISTRY.find((x) => x.id === "one-avatar");
  assert.ok(a);
  assert.deepStrictEqual(a.roles, ["admin", "bookkeeper"]);
  const steps = a.steps({});
  assert.strictEqual(steps.length, 3);
  assert.strictEqual(steps[0].targets, undefined);
  assert.deepStrictEqual(steps[1].targets, ["tb-avatar", "staff-nav-settings"]);
  assert.ok(/top right/.test(steps[1].body("tb-avatar")) || /picture or initials/.test(steps[1].body("tb-avatar")));
  assert.ok(/phone/.test(steps[1].body("staff-nav-settings")));
  assert.ok(!/colour/i.test(JSON.stringify(steps.map((x) => x.body()))));
  // The rail no longer has Settings: rail-default's last stop is the Expand button.
  const r = ANN_REGISTRY.find((x) => x.id === "rail-default");
  assert.deepStrictEqual(r.steps({})[2].targets, ["staff-rail-collapse"]);
});

t("registry: tasks-inline-edit is an admin and bookkeeper notice pointing at the row and groups", () => {
  const a = ANN_REGISTRY.find((x) => x.id === "tasks-inline-edit");
  assert.ok(a);
  assert.deepStrictEqual(a.roles, ["admin", "bookkeeper"]);
  const steps = a.steps({});
  assert.strictEqual(steps.length, 3);
  assert.strictEqual(steps[0].targets, undefined);
  assert.deepStrictEqual(steps[1].targets, ["tk-status"]);
  assert.deepStrictEqual(steps[2].targets, ["tk-groups"]);
  assert.ok(!/colour/i.test(JSON.stringify(steps.map((x) => x.body()))));
});

t("registry: tasks-field-grid is an admin and bookkeeper notice ending on the task details fields", () => {
  const a = ANN_REGISTRY.find((x) => x.id === "tasks-field-grid");
  assert.ok(a);
  assert.strictEqual(a.date, "2026-10-19");
  assert.deepStrictEqual(a.roles, ["admin", "bookkeeper"]);
  assert.strictEqual(a.hash, "#/tasks/my");
  const steps = a.steps({});
  assert.strictEqual(steps.length, 3);
  assert.strictEqual(steps[0].targets, undefined);
  assert.deepStrictEqual(steps[1].targets, ["tk-groups"]);
  assert.deepStrictEqual(steps[2].targets, ["tk-dw-fields"]);
  assert.strictEqual(steps[2].wait, true);
  assert.ok(!/colour/i.test(JSON.stringify(steps.map((x) => x.body()))));
});

t("registry: slate-view-bar (rhythm slice 0) is ungated and tours the Slate view bar", () => {
  const a = ANN_REGISTRY.find((x) => x.id === "slate-view-bar");
  assert.ok(a);
  assert.strictEqual(a.ready, undefined);
  assert.deepStrictEqual(a.roles, ["admin", "bookkeeper"]);
  assert.strictEqual(a.hash, "#/tasks/my");
  const steps = a.steps({});
  assert.deepStrictEqual(steps.map((s) => s.id), ["ann-welcome", "ann-groupby", "ann-chips", "ann-sort"]);
  assert.deepStrictEqual(steps[1].targets, ["tk-groupby"]);
  assert.strictEqual(steps[2].targets[0], "tk-slate-chips");
  assert.strictEqual(steps[3].targets[0], "tk-slate-sort");
  const text = JSON.stringify([a.title, a.summary].concat(steps.map((x) => x.body())));
  assert.ok(!/colour|!/i.test(text));
  // The newest by date among ungated entries, so it is picked first for a person with
  // nothing answered. (Entries with visible(), such as the hidden draft
  // client-org-profile-launch, do not compete while their switch is off. The
  // admins-only view-as-whole-app notice is newer but no bookkeeper gets it. custom-repeat, 2026-10-25, is a
  // newer ungated notice and is excluded here: it is its own check above.)
  const newest = ANN_REGISTRY.filter((x) => typeof x.visible !== "function" && x.id !== "celebration-heads-up" && x.id !== "slate-single-home" && x.id !== "custom-repeat" && x.id !== "client-agreements" && x.roles.includes("bookkeeper")).reduce((m, x) => (x.date > m ? x.date : m), "");
  assert.strictEqual(a.date, newest);
});

t("registry: client-agreements waits for the card and tours it", () => {
  const a = ANN_REGISTRY.find((x) => x.id === "client-agreements");
  assert.ok(a);
  assert.strictEqual(a.visible, undefined);
  assert.strictEqual(typeof a.ready, "function");
  const steps = a.steps({});
  assert.deepStrictEqual(steps.map((s) => s.id), ["ann-welcome", "ann-card", "ann-done"]);
  assert.deepStrictEqual(steps[1].targets, ["staff-agreements"]);
  const text = JSON.stringify([a.title, a.summary].concat(steps.map((x) => x.body())));
  assert.ok(!/colour|!/i.test(text));
});

t("registry: celebration-heads-up is withdrawn (admin-only celebrations); for non-admins, 3 steps, no admin-only wording when re-enabled", () => {
  const a = ANN_REGISTRY.find((x) => x.id === "celebration-heads-up");
  assert.ok(a);
  // CEL_STAFF_VISIBLE is not defined in this node run (and is false in the app): hidden everywhere.
  assert.strictEqual(typeof a.visible, "function");
  assert.strictEqual(a.visible(), false);
  assert.deepStrictEqual(a.roles, ["tempAdmin", "bookkeeper", "accountManager"]);
  assert.strictEqual(a.date, "2026-10-27");
  const steps = a.steps({});
  assert.deepStrictEqual(steps.map((s) => s.id), ["ann-welcome", "ann-today-week", "team-people"]);
  assert.deepStrictEqual(steps[1].targets, ["today-week"]);
  const text = JSON.stringify([a.title, a.summary].concat(steps.map((x) => x.body())));
  assert.ok(!/colour|gift sent|dismiss|\b(19|20)\d\d\b/i.test(text), text);
});

t("registry: view-as-whole-app is an admins-only notice that tours HR > Members", () => {
  const a = ANN_REGISTRY.find((x) => x.id === "view-as-whole-app");
  assert.ok(a);
  assert.deepStrictEqual(a.roles, ["admin"]);
  assert.strictEqual(a.hash, "#/hr/members");
  assert.strictEqual(a.date, "2026-10-23");
  const text = JSON.stringify([a.title, a.summary]);
  assert.ok(!/colour/i.test(text));
});

t("registry: new-look-and-layout is one combined staff notice for the five launches", () => {
  const a = ANN_REGISTRY.find((x) => x.id === "new-look-and-layout");
  assert.ok(a);
  assert.strictEqual(a.date, "2026-10-21");
  assert.deepStrictEqual(a.roles, ["admin", "tempAdmin", "bookkeeper", "accountManager"]);
  assert.ok(!a.roles.includes("client"));
  assert.strictEqual(typeof a.ready, "function");
  assert.deepStrictEqual(a.supersedes, ["desk-launch", "desk-right-now", "desk-task-view", "desk-right-launch", "workbench-launch"]);
  a.supersedes.forEach((id) => assert.ok(ANN_REGISTRY.find((x) => x.id === id), id + " exists"));
  // Not ready without the three firm caches (no browser here).
  assert.strictEqual(a.ready(), false);
  const steps = a.steps({ isAdmin: true });
  assert.deepStrictEqual(steps.map((s) => s.id), ["ann-welcome", "ann-desk", "ann-sidebar", "ann-look", "ann-hover", "ann-done"]);
  assert.strictEqual(steps[0].targets, undefined);
  assert.deepStrictEqual(steps[1].targets, ["wb-bar"]);
  assert.deepStrictEqual(steps[2].targets, ["staff-sidebar-gear", "staff-nav"]);
  assert.strictEqual(steps[3].targets, undefined);
  assert.deepStrictEqual(steps[4].targets, ["staff-nav"]);
  const text = JSON.stringify([a.title, a.summary].concat(steps.map((x) => x.body()), a.steps({}).map((x) => x.body())));
  assert.ok(!/colour|grey|slate app|month rhythm/i.test(text), "US spelling; nothing about the held Slate app or Month rhythm");
  assert.ok(/Classic Today/.test(text) && !/Classic fonts/.test(text) && /Customize/.test(text) && /press D/i.test(text));
});

t("registry: new-look-and-layout ready check (caches, no Lato)", () => {
  const a = ANN_REGISTRY.find((x) => x.id === "new-look-and-layout");
  const setWin = (m) => {
    global.window = { localStorage: { getItem: (k) => (k in m ? m[k] : null) } };
  };
  try {
    setWin({ mgb_brand_classic: "1", mgb_hovernav_classic: "1" });
    assert.strictEqual(a.ready(), false, "the retired Classic keys no longer count");
    setWin({ mgb_brand_cache: "1" });
    assert.strictEqual(a.ready(), false, "hover cache missing is not ready");
    setWin({ mgb_hovernav_cache: "1" });
    assert.strictEqual(a.ready(), false, "brand cache missing is not ready");
    setWin({ mgb_brand_cache: "1", mgb_hovernav_cache: "1" });
    assert.strictEqual(a.ready(), true, "both caches set is ready without the Lato cache");
  } finally {
    delete global.window;
  }
});

// ---- Slate app launch: invisible until the firm switch is on ---------------------
const slateEntry = () => ANN_REGISTRY.find((x) => x.id === "slate-app-launch");
const withWin = (store, narrow, fn) => {
  global.window = {
    localStorage: { getItem: (k) => (k in store ? store[k] : null) },
    matchMedia: () => ({ matches: !!narrow }),
  };
  try {
    return fn();
  } finally {
    delete global.window;
  }
};
const SLATE_NOW = Date.parse("2026-10-23T12:00:00Z");

t("registry: slate-app-launch shape, roles, steps and wording", () => {
  const a = slateEntry();
  assert.ok(a);
  assert.deepStrictEqual(a.roles, ["admin", "tempAdmin", "bookkeeper", "accountManager"]);
  assert.ok(!a.roles.includes("client"));
  assert.strictEqual(a.hash, "#/tasks/my");
  assert.strictEqual(typeof a.visible, "function");
  assert.strictEqual(typeof a.ready, "function");
  assert.deepStrictEqual(a.supersedes, ["slate-view-bar"], "the launch tour covers the view bar; the other Slate notices stay owed");
  const steps = a.steps({ isAdmin: true });
  assert.deepStrictEqual(steps.map((s) => s.id), ["ann-welcome", "ann-open", "ann-sizes", "ann-shape", "ann-quick", "ann-done"]);
  assert.deepStrictEqual(steps[1].targets, ["tk-popout"]);
  assert.strictEqual(steps[1].wait, true);
  const sizes = steps[2].body();
  assert.ok(/sliver/i.test(sizes) && /compact/i.test(sizes) && /detail pane/i.test(sizes) && /Full page/.test(sizes), "window-size step");
  const text = JSON.stringify([a.title, a.summary].concat(steps.map((x) => x.body()), a.steps({}).map((x) => x.body())));
  assert.ok(!/colour|grey|month rhythm|interaction|template editor|touch drag/i.test(text), "US spelling; nothing held back is promised");
  assert.ok(!/Classic tasks page/.test(JSON.stringify(a.steps({ isAdmin: true }).map((x) => x.body()))), "the opt-out is retired");
  assert.strictEqual(a.date, "2026-10-26", "launched for Monday 2026-10-26");
});

t("slate-app-launch gate: off means nothing shows anywhere", () => {
  const a = slateEntry();
  const reg = [a];
  [admin, bk, tempAdmin, am].forEach((ctx) => {
    // No cache at all (the switch was never read or is off).
    withWin({}, false, () => {
      assert.strictEqual(L.ANN_listed(a, ctx), false);
      assert.deepStrictEqual(L.ANN_audience(reg, ctx), [], "no Launches row, no ? menu tour");
      assert.strictEqual(L.ANN_pickNext(reg, state(), ctx, SLATE_NOW), null, "no notice");
    });
    // The cache cleared again (switch turned back off).
    withWin({ mgb_slate_cache: "0" }, false, () => assert.strictEqual(L.ANN_pickNext(reg, state(), ctx, SLATE_NOW), null));
  });
});

t("slate-app-launch gate: on shows the notice once, for staff only", () => {
  const a = slateEntry();
  const reg = [a];
  withWin({ mgb_slate_cache: "1" }, false, () => {
    [admin, bk, tempAdmin, am].forEach((ctx) => {
      assert.strictEqual(L.ANN_listed(a, ctx), true);
      assert.deepStrictEqual(L.ANN_audience(reg, ctx), [a], "listed in Launches and the ? menu");
      assert.strictEqual(L.ANN_pickNext(reg, state(), ctx, SLATE_NOW), a, "the notice shows");
      // Shown once it was seen, answered (tour, Skip) it never returns; Later waits for the next visit.
      assert.strictEqual(L.ANN_pickNext(reg, state({ rows: { [a.id]: { status: "seen", later_count: 0 } } }), ctx, SLATE_NOW), a, "ignored stays owed");
      assert.strictEqual(L.ANN_pickNext(reg, state({ rows: { [a.id]: { status: "toured", later_count: 0 } } }), ctx, SLATE_NOW), null, "toured: done");
      assert.strictEqual(L.ANN_pickNext(reg, state({ rows: { [a.id]: { status: "dismissed", later_count: 0 } } }), ctx, SLATE_NOW), null, "skipped: done");
      assert.strictEqual(L.ANN_pickNext(reg, state({ hidden: [a.id] }), ctx, SLATE_NOW), null, "Later hides it until the next visit");
      // Never during View as or Preview as, nor while another overlay is up.
      assert.strictEqual(L.ANN_pickNext(reg, state(), Object.assign({ impersonating: true }, ctx), SLATE_NOW), null, "View as");
      assert.strictEqual(L.ANN_pickNext(reg, state(), Object.assign({ previewing: true }, ctx), SLATE_NOW), null, "Preview as");
      assert.strictEqual(L.ANN_pickNext(reg, state(), Object.assign({ busy: true }, ctx), SLATE_NOW), null, "busy");
    });
    // Clients (no staff role) never see it.
    assert.deepStrictEqual(L.ANN_audience(reg, { isAdmin: false, isBookkeeper: false, tempAdmin: false, amCount: 0 }), []);
    assert.strictEqual(L.ANN_pickNext(reg, state(), { role: "client" }, SLATE_NOW), null);
    // A new hire made after the launch date is not owed it.
    assert.strictEqual(L.ANN_pickNext(reg, state({ accountStart: "2026-10-27T00:00:00Z" }), admin, SLATE_NOW), null);
  });
  // The notice waits for a computer-width window; the Launches list still shows it.
  withWin({ mgb_slate_cache: "1" }, true, () => {
    assert.deepStrictEqual(L.ANN_audience(reg, admin), [a]);
    assert.strictEqual(L.ANN_pickNext(reg, state(), admin, SLATE_NOW), null, "phone width: no notice");
  });
});

t("slate-app-launch gate: blocked storage reads as off", () => {
  const a = slateEntry();
  // Blocked storage reads as off.
  global.window = { localStorage: { getItem: () => { throw new Error("blocked"); } } };
  try {
    assert.strictEqual(L.ANN_listed(a, admin), false);
  } finally {
    delete global.window;
  }
});

t("slate-app-launch gate: an entry with a throwing visible() is hidden", () => {
  const e = Object.assign(entry("boom", "2026-10-21", ["admin"]), { visible: () => { throw new Error("x"); } });
  assert.deepStrictEqual(L.ANN_audience([e], admin), []);
  assert.deepStrictEqual(L.ANN_audience([entry("plain", "2026-10-21", ["admin"])], admin).length, 1, "no visible(): always listed");
});

// ---- Client org profile launch: draft, invisible until the firm switch is on -----
const opEntry = () => ANN_REGISTRY.find((x) => x.id === "client-org-profile-launch");

t("registry: slate-single-home is gated like the Slate app launch and tours the Work > Slate summary", () => {
  const a = ANN_REGISTRY.find((x) => x.id === "slate-single-home");
  assert.ok(a);
  assert.strictEqual(a.date, "2026-10-27");
  assert.deepStrictEqual(a.roles, ["admin", "tempAdmin", "bookkeeper", "accountManager"]);
  assert.strictEqual(a.hash, "#/work/tasks");
  const steps = a.steps({});
  assert.deepStrictEqual(steps.map((s) => s.id), ["ann-welcome", "ann-summary", "ann-open-slate"]);
  assert.deepStrictEqual(steps[2].targets, ["tk-summary-open"]);
  const text = JSON.stringify([a.title, a.summary].concat(steps.map((x) => x.body())));
  assert.ok(!/colour/i.test(text), text);
  // Off with the firm switch off.
  withWin({}, false, () => assert.strictEqual(a.visible(), false));
  withWin({ mgb_slate_cache: "1" }, false, () => assert.strictEqual(a.visible(), true));
});

t("registry: slate-search tours the Slate page search box, staff only, gated like Slate", () => {
  const a = ANN_REGISTRY.find((x) => x.id === "slate-search");
  assert.ok(a);
  assert.strictEqual(a.date, "2026-10-27");
  assert.deepStrictEqual(a.roles, ["admin", "tempAdmin", "bookkeeper", "accountManager"]);
  assert.strictEqual(a.hash, "#/tasks/my");
  const steps = a.steps({});
  assert.deepStrictEqual(steps.map((s) => s.id), ["ann-welcome", "ann-search", "ann-done"]);
  assert.deepStrictEqual(steps[1].targets, ["tk-search"]);
  const text = JSON.stringify([a.title, a.summary].concat(steps.map((x) => x.body())));
  assert.ok(!/colour|!/i.test(text), text);
  withWin({}, false, () => assert.strictEqual(a.visible(), false));
  withWin({ mgb_slate_cache: "1" }, false, () => assert.strictEqual(a.visible(), true));
  withWin({ mgb_slate_cache: "1" }, false, () => {
    assert.strictEqual(L.ANN_pickNext([a], state(), Object.assign({ impersonating: true }, admin), SLATE_NOW), null, "View as");
    assert.strictEqual(L.ANN_pickNext([a], state(), { role: "client" }, SLATE_NOW), null, "clients never");
  });
});

t("registry: client-org-profile-launch shape, roles, steps and wording", () => {
  const a = opEntry();
  assert.ok(a);
  assert.deepStrictEqual(a.roles, ["admin", "tempAdmin", "bookkeeper", "accountManager"]);
  assert.strictEqual(typeof a.visible, "function");
  assert.deepStrictEqual(a.steps({ isAdmin: true }).map((s) => s.id), ["ann-welcome", "ann-card", "ann-gtk", "team-gifts", "ann-done"]);
  assert.deepStrictEqual(a.steps({ isAdmin: true })[1].targets, ["op-staff-card"]);
  assert.ok(!a.steps({ isBookkeeper: true }).some((s) => s.id === "team-gifts"), "gifts tab step is for real admins only");
  assert.ok(!a.steps({ isAdmin: true, impersonating: true }).some((s) => s.id === "team-gifts"), "not during View as");
  const text = JSON.stringify([a.title, a.summary].concat(a.steps({ isAdmin: true }).map((x) => x.body())));
  assert.ok(!/colour|favourite|grey/i.test(text), "US spelling");
  assert.ok(/Nothing here emails anyone or orders anything/.test(text));
});

t("client-org-profile-launch gate: off means nothing shows anywhere", () => {
  const a = opEntry();
  const reg = [a];
  [admin, bk, tempAdmin, am].forEach((ctx) => {
    withWin({}, false, () => {
      assert.strictEqual(L.ANN_listed(a, ctx), false);
      assert.deepStrictEqual(L.ANN_audience(reg, ctx), []);
      assert.strictEqual(L.ANN_pickNext(reg, state(), ctx, SLATE_NOW), null);
    });
    withWin({ mgb_orgprofile_cache: "0" }, false, () => assert.strictEqual(L.ANN_pickNext(reg, state(), ctx, SLATE_NOW), null));
  });
  // The whole registry with no org profile cache never picks it.
  [admin, bk, tempAdmin, am].forEach((ctx) => {
    withWin({ mgb_slate_cache: "1", mgb_brand_cache: "1", mgb_hovernav_cache: "1" }, false, () => {
      const rows = {};
      for (let i = 0; i < 40; i++) {
        const pick = L.ANN_pickNext(ANN_REGISTRY, state({ rows }), ctx, SLATE_NOW);
        if (!pick) break;
        assert.notStrictEqual(pick.id, "client-org-profile-launch");
        rows[pick.id] = { status: "dismissed", later_count: 0 };
      }
    });
  });
  // Blocked storage reads as off.
  global.window = { localStorage: { getItem: () => { throw new Error("blocked"); } } };
  try {
    assert.strictEqual(L.ANN_listed(a, admin), false);
  } finally {
    delete global.window;
  }
});

t("client-org-profile-launch gate: on shows the notice once, for staff only", () => {
  const a = opEntry();
  const reg = [a];
  withWin({ mgb_orgprofile_cache: "1" }, false, () => {
    [admin, bk, tempAdmin, am].forEach((ctx) => {
      assert.deepStrictEqual(L.ANN_audience(reg, ctx), [a]);
      assert.strictEqual(L.ANN_pickNext(reg, state(), ctx, SLATE_NOW), a);
      assert.strictEqual(L.ANN_pickNext(reg, state({ rows: { [a.id]: { status: "toured", later_count: 0 } } }), ctx, SLATE_NOW), null, "toured: done");
      assert.strictEqual(L.ANN_pickNext(reg, state({ rows: { [a.id]: { status: "dismissed", later_count: 0 } } }), ctx, SLATE_NOW), null, "skipped: done");
      assert.strictEqual(L.ANN_pickNext(reg, state(), Object.assign({ impersonating: true }, ctx), SLATE_NOW), null, "View as");
    });
    assert.deepStrictEqual(L.ANN_audience(reg, { isAdmin: false, isBookkeeper: false, tempAdmin: false, amCount: 0 }), [], "clients never");
    assert.strictEqual(L.ANN_pickNext(reg, state(), { role: "client" }, SLATE_NOW), null);
  });
});

t("client-org-profile-launch: live date, gifts step names the anniversary basis", () => {
  const a = opEntry();
  assert.strictEqual(a.date, "2026-10-25");
  const gifts = a.steps({ isAdmin: true }).find((s) => s.id === "team-gifts");
  assert.ok(/Anniversary to follow/.test(gifts.body()) && /founding date \(the default\)/.test(gifts.body()));
});

t("order: with Slate, Month rhythm and the org profile all on: Slate, the Slate tour, Month rhythm, then the org profile", () => {
  [admin, bk, tempAdmin, am].forEach((ctx) => {
    const seq = [];
    const rows = {};
    withWin({ mgb_slate_cache: "1", mgb_rhythm_cache: "1", mgb_orgprofile_cache: "1", mgb_brand_cache: "1", mgb_hovernav_cache: "1" }, false, () => {
      for (let i = 0; i < 40; i++) {
        const pick = L.ANN_pickNext(ANN_REGISTRY, state({ rows }), ctx, SLATE_NOW);
        if (!pick) break;
        seq.push(pick.id);
        rows[pick.id] = { status: "dismissed", later_count: 0 };
      }
    });
    const s = seq.filter((id) => id !== "view-as-whole-app" && id !== "celebration-heads-up" && id !== "slate-single-home" && id !== "slate-search");
    assert.deepStrictEqual(s.slice(0, 4), ["slate-app-launch", "slate-start-to-finish", "month-rhythm-launch", "client-org-profile-launch"]);
  });
});

// ---- Notice order among the three 2026-10-21 launches ---------------------------
t("order: slate-app-launch is registered above slate-view-bar and new-look-and-layout", () => {
  const ids = ANN_REGISTRY.map((x) => x.id);
  assert.ok(ids.indexOf("slate-app-launch") < ids.indexOf("slate-view-bar"));
  assert.ok(ids.indexOf("slate-app-launch") < ids.indexOf("new-look-and-layout"));
});

const ORDER_CACHES = { mgb_brand_cache: "1", mgb_hovernav_cache: "1" };
const ORDER_IDS = ["slate-app-launch", "slate-view-bar", "new-look-and-layout"];
// Walk the real registry like the app does: show one notice per visit, the person closes it (Skip), repeat.
function walk(ctx, store, narrow, first) {
  const seq = [];
  const rows = {};
  withWin(store, narrow, () => {
    for (let i = 0; i < 40; i++) {
      const pick = L.ANN_pickNext(ANN_REGISTRY, state({ rows }), ctx, SLATE_NOW);
      if (!pick) break;
      seq.push(pick.id);
      rows[pick.id] = { status: "dismissed", later_count: 0 };
    }
  });
  // The admins-only View as notice (2026-10-23) is newer than these; leave it out of the order checks.
  return seq.filter((id) => id !== "view-as-whole-app" && id !== "celebration-heads-up" && id !== "slate-single-home" && id !== "slate-search");
}

t("order: with all three eligible, slate-app-launch comes first and supersedes the view bar", () => {
  [admin, bk, tempAdmin, am].forEach((ctx) => {
    const seq = walk(ctx, Object.assign({ mgb_slate_cache: "1" }, ORDER_CACHES), false);
    assert.strictEqual(seq[0], "slate-app-launch");
    assert.ok(seq.indexOf("new-look-and-layout") > 0, "new look and layout still reaches them afterwards");
    assert.strictEqual(seq.indexOf("slate-view-bar"), -1, "the view bar is no longer shown after the launch");
    ORDER_IDS.forEach((id) => assert.ok(seq.filter((x) => x === id).length <= 1));
  });
  // Direct pick: only the three, all eligible.
  withWin(Object.assign({ mgb_slate_cache: "1" }, ORDER_CACHES), false, () => {
    const reg = ORDER_IDS.map((id) => ANN_REGISTRY.find((x) => x.id === id));
    assert.strictEqual(L.ANN_pickNext(reg, state(), admin, SLATE_NOW).id, "slate-app-launch");
    const seenOnly = state({ rows: { "slate-app-launch": { status: "seen", later_count: 0 } } });
    assert.strictEqual(L.ANN_pickNext(reg, seenOnly, admin, SLATE_NOW).id, "slate-app-launch", "ignored stays owed, ahead of the rest");
    assert.ok(L.ANN_superseded(reg, reg[1], seenOnly), "the view bar is already covered once the launch was shown");
    const after = state({ rows: { "slate-app-launch": { status: "dismissed", later_count: 0 } } });
    assert.strictEqual(L.ANN_pickNext(reg, after, admin, SLATE_NOW).id, "new-look-and-layout");
    assert.ok(L.ANN_superseded(reg, reg[1], after), "slate-view-bar is covered once the launch was shown");
    assert.ok(!L.ANN_superseded(reg, reg[2], after), "new-look-and-layout is not");
  });
});

t("order: slate-app-launch shown only after a computer-width window; view bar still owed before that", () => {
  const seq = walk(admin, Object.assign({ mgb_slate_cache: "1" }, ORDER_CACHES), true);
  assert.ok(seq.indexOf("slate-app-launch") === -1, "phone width: no launch notice");
  assert.ok(seq.indexOf("slate-view-bar") !== -1, "view bar not superseded when the launch was never shown");
});

t("order: while the Slate switch is off, the pick order is the same as without the entry", () => {
  const without = ANN_REGISTRY.filter((x) => x.id !== "slate-app-launch");
  const seqIds = (reg, ctx, store) => {
    const out = [];
    const rows = {};
    withWin(store, false, () => {
      for (let i = 0; i < 40; i++) {
        const pick = L.ANN_pickNext(reg, state({ rows }), ctx, SLATE_NOW);
        if (!pick) break;
        out.push(pick.id);
        rows[pick.id] = { status: "dismissed", later_count: 0 };
      }
    });
    return out;
  };
  [admin, bk, tempAdmin, am].forEach((ctx) => {
    [{}, { mgb_slate_cache: "0" }, ORDER_CACHES, Object.assign({ mgb_slate_cache: "0" }, ORDER_CACHES)].forEach((store) => {
      const withEntry = seqIds(ANN_REGISTRY, ctx, store);
      assert.deepStrictEqual(withEntry, seqIds(without, ctx, store));
      assert.ok(withEntry.indexOf("slate-app-launch") === -1);
    });
  });
  // And the view bar still precedes new-look-and-layout there, as before.
  const seq = seqIds(ANN_REGISTRY, admin, ORDER_CACHES);
  assert.ok(seq.indexOf("slate-view-bar") !== -1 && seq.indexOf("slate-view-bar") < seq.indexOf("new-look-and-layout"));
});

t("slate-app-launch: index.html caches the switch in the same single read as brand and hover", () => {
  const html = require("fs").readFileSync(require("path").join(__dirname, "..", "..", "index.html"), "utf8");
  assert.ok(/\.in\("key", \["brand_enabled", "hovernav_enabled", "slate_app_enabled", "month_rhythm_enabled"\]\)/.test(html), "one read, four keys");
  assert.ok(/lsSet\("mgb_slate_cache", isOn\(vals\.slate_app_enabled\) \? "1" : null\)/.test(html));
  assert.ok(!/from\("tk_settings"\)[^;]*mgb_slate_cache/.test(html), "no second read");
});

// ---- Month rhythm launch: invisible until the firm switch is on -------------------
const rhEntry = () => ANN_REGISTRY.find((x) => x.id === "month-rhythm-launch");

t("registry: month-rhythm-launch shape, roles, steps and wording", () => {
  const a = rhEntry();
  assert.ok(a);
  assert.deepStrictEqual(a.roles, ["admin", "tempAdmin", "bookkeeper", "accountManager"]);
  assert.strictEqual(a.hash, "#/tasks/my");
  assert.strictEqual(a.date, "2026-10-26");
  assert.strictEqual(typeof a.visible, "function");
  const realAdmin = a.steps({ isAdmin: true, myClient: { id: "c1", name: "X" } });
  assert.deepStrictEqual(realAdmin.map((s) => s.id), ["ann-welcome", "ann-recurring", "ann-optc", "ann-email", "ann-close-order", "ann-done"]);
  assert.strictEqual(realAdmin[1].wait, true);
  assert.deepStrictEqual(realAdmin[2].targets, ["tk-optc"]);
  assert.deepStrictEqual(realAdmin[4].targets, ["tk-close-order"]);
  assert.ok(/Preliminary/.test(realAdmin[3].body()), "Full or Preliminary is covered");
  assert.strictEqual(typeof a.ready, "function", "waits for a computer-width window like the Slate launch");
  const bkSteps = a.steps({ isBookkeeper: true });
  assert.ok(!bkSteps.some((s) => s.id === "ann-recurring" || s.id === "ann-optc"), "Recurring steps are for real admins only");
  assert.ok(!a.steps({ isAdmin: true, impersonating: true }).some((s) => s.id === "ann-recurring"), "not during View as");
  assert.ok(/Group by 4\/14\/24th/.test(bkSteps[0].body()), "bookkeeper welcome names the grouping");
  const text = JSON.stringify([a.title, a.summary].concat(realAdmin.map((x) => x.body()), bkSteps.map((x) => x.body())));
  assert.ok(!/colour|grey|favourite/i.test(text), "US spelling");
  assert.ok(/never sends/i.test(text) && /nothing is sent/i.test(text), "says no email goes out");
  // Without a client the close-order step still has no throw and stays (centered).
  const go = bkSteps.find((s) => s.id === "ann-close-order").go;
  global.window = { location: { hash: "#/tasks/my" } };
  try {
    go();
    assert.strictEqual(global.window.location.hash, "#/tasks/my", "no client: stays put");
    a.steps({ isBookkeeper: true, myClient: { id: "c 9" } }).find((s) => s.id === "ann-close-order").go();
    assert.strictEqual(global.window.location.hash, "#/tasks/c/c%209");
  } finally {
    delete global.window;
  }
});

t("month-rhythm-launch gate: off means nothing shows anywhere", () => {
  const a = rhEntry();
  const reg = [a];
  [admin, bk, tempAdmin, am].forEach((ctx) => {
    withWin({}, false, () => {
      assert.strictEqual(L.ANN_listed(a, ctx), false);
      assert.deepStrictEqual(L.ANN_audience(reg, ctx), []);
      assert.strictEqual(L.ANN_pickNext(reg, state(), ctx, SLATE_NOW), null);
    });
    // The person's preview flag is not the launch.
    withWin({ mgb_rhythm_preview: "1" }, false, () => assert.strictEqual(L.ANN_pickNext(reg, state(), ctx, SLATE_NOW), null));
    withWin({ mgb_rhythm_cache: "0" }, false, () => assert.strictEqual(L.ANN_pickNext(reg, state(), ctx, SLATE_NOW), null));
  });
  global.window = { localStorage: { getItem: () => { throw new Error("blocked"); } } };
  try {
    assert.strictEqual(L.ANN_listed(a, admin), false, "blocked storage reads as off");
  } finally {
    delete global.window;
  }
});

t("month-rhythm-launch gate: on shows the notice once, for staff only", () => {
  const a = rhEntry();
  const reg = [a];
  withWin({ mgb_rhythm_cache: "1" }, false, () => {
    [admin, bk, tempAdmin, am].forEach((ctx) => {
      assert.deepStrictEqual(L.ANN_audience(reg, ctx), [a]);
      assert.strictEqual(L.ANN_pickNext(reg, state(), ctx, SLATE_NOW), a);
      assert.strictEqual(L.ANN_pickNext(reg, state({ rows: { [a.id]: { status: "toured", later_count: 0 } } }), ctx, SLATE_NOW), null, "toured: done");
      assert.strictEqual(L.ANN_pickNext(reg, state({ rows: { [a.id]: { status: "dismissed", later_count: 0 } } }), ctx, SLATE_NOW), null, "skipped: done");
      assert.strictEqual(L.ANN_pickNext(reg, state(), Object.assign({ impersonating: true }, ctx), SLATE_NOW), null, "View as");
    });
    assert.deepStrictEqual(L.ANN_audience(reg, { isAdmin: false, isBookkeeper: false, tempAdmin: false, amCount: 0 }), [], "clients never");
    assert.strictEqual(L.ANN_pickNext(reg, state(), { role: "client" }, SLATE_NOW), null);
  });
});

t("order: slate-start-to-finish, then month-rhythm-launch, come right after slate-app-launch on the same day", () => {
  const ids = ANN_REGISTRY.map((x) => x.id);
  assert.strictEqual(ids.indexOf("slate-start-to-finish"), ids.indexOf("slate-app-launch") + 1);
  assert.strictEqual(ids.indexOf("month-rhythm-launch"), ids.indexOf("slate-app-launch") + 2);
  [admin, bk, tempAdmin, am].forEach((ctx) => {
    const seq = walk(ctx, Object.assign({ mgb_slate_cache: "1", mgb_rhythm_cache: "1" }, ORDER_CACHES), false);
    assert.strictEqual(seq[0], "slate-app-launch");
    assert.strictEqual(seq[1], "slate-start-to-finish");
    assert.strictEqual(seq[2], "month-rhythm-launch");
    assert.strictEqual(seq.filter((x) => x === "month-rhythm-launch").length, 1);
  });
});

t("desk-client-actions gate: hidden until the Desk additions switch is cached and the person is not on Classic Today", () => {
  const a = ANN_REGISTRY.find((x) => x.id === "desk-client-actions");
  assert.ok(a, "registered");
  assert.deepStrictEqual(a.roles, ["admin", "tempAdmin", "bookkeeper", "accountManager"]);
  const reg = [a];
  [{}, { mgb_deskplus_preview: "1" }, { mgb_deskplus_cache: "0" }, { mgb_deskplus_cache: "1", mgb_wb_classic: "1" }].forEach((ls) => {
    withWin(ls, false, () => {
      [admin, bk, tempAdmin, am].forEach((ctx) => assert.deepStrictEqual(L.ANN_audience(reg, ctx), [], "hidden for " + JSON.stringify(ls)));
    });
  });
  withWin({ mgb_deskplus_cache: "1" }, false, () => {
    [admin, bk, tempAdmin, am].forEach((ctx) => {
      assert.deepStrictEqual(L.ANN_audience(reg, ctx), [a]);
      assert.strictEqual(L.ANN_pickNext(reg, state(), ctx, SLATE_NOW), a);
    });
    assert.strictEqual(L.ANN_pickNext(reg, state(), { role: "client" }, SLATE_NOW), null);
  });
  const steps = a.steps({});
  assert.deepStrictEqual(steps.map((x) => x.id), ["ann-welcome", "ann-ledger", "ann-client-actions", "ann-client-waiting", "ann-plus"]);
  assert.deepStrictEqual(steps[1].targets, ["wb-chip-gl"]);
  assert.deepStrictEqual(steps[2].targets, ["wb-client-actions"]);
  assert.deepStrictEqual(steps[3].targets, ["wb-client-waiting"]);
  assert.ok(steps[4].targets.indexOf("wb-rail-add") !== -1);
  assert.ok(!/colour/i.test(JSON.stringify(steps.map((x) => x.body()))));
});

t("thread-menu gate: hidden until the thread menu switch is cached, never in View as, never for clients", () => {
  const a = ANN_REGISTRY.find((x) => x.id === "thread-menu");
  assert.ok(a, "registered");
  assert.deepStrictEqual(a.roles, ["admin", "tempAdmin", "bookkeeper", "accountManager"]);
  assert.strictEqual(a.hash, "#/inbox");
  const reg = [a];
  [{}, { mgb_threadmenu_preview: "1" }, { mgb_threadmenu_cache: "0" }].forEach((ls) => {
    withWin(ls, false, () => {
      [admin, bk, tempAdmin, am].forEach((ctx) => assert.deepStrictEqual(L.ANN_audience(reg, ctx), [], "hidden for " + JSON.stringify(ls)));
    });
  });
  withWin({ mgb_threadmenu_cache: "1" }, false, () => {
    [admin, bk, tempAdmin, am].forEach((ctx) => {
      assert.deepStrictEqual(L.ANN_audience(reg, ctx), [a]);
      assert.strictEqual(L.ANN_pickNext(reg, state(), ctx, SLATE_NOW), a);
    });
    assert.strictEqual(L.ANN_pickNext(reg, state(), { role: "client" }, SLATE_NOW), null);
    global.MGB_viewAsReadOnly = () => true;
    try {
      [admin, bk].forEach((ctx) => assert.deepStrictEqual(L.ANN_audience(reg, ctx), [], "never in View as"));
    } finally {
      delete global.MGB_viewAsReadOnly;
    }
  });
  const steps = a.steps({});
  assert.deepStrictEqual(steps.map((x) => x.id), ["ann-welcome", "ann-thread-menu", "ann-desk"]);
  assert.deepStrictEqual(steps[1].targets, ["inbox-list"]);
  assert.ok(!/colour/i.test(JSON.stringify(steps.map((x) => x.body()))));
});

t("registry: custom-repeat is a plain staff notice for the four task roles, dated when it shipped", () => {
  const a = ANN_REGISTRY.find((x) => x.id === "custom-repeat");
  assert.ok(a);
  assert.strictEqual(a.date, "2026-10-25");
  assert.deepStrictEqual(a.roles, ["admin", "tempAdmin", "bookkeeper", "accountManager"]);
  assert.strictEqual(a.visible, undefined, "not behind a switch: Repeat > Custom is live for everyone");
  const admin = a.steps({ isAdmin: true });
  const bk = a.steps({});
  assert.deepStrictEqual(admin.map((x) => x.id), ["ann-welcome", "ann-where", "ann-templates"]);
  assert.ok(/Slate > Recurring/.test(admin[2].body()) && !/Slate > Recurring/.test(bk[2].body()), "templates step differs by audience");
  assert.ok(!/colour/i.test(JSON.stringify(admin.map((x) => x.body()))));
});

console.log("announcementsLogic: " + n + " checks passed");
