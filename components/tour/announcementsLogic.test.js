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

t("registry: desk-launch waits for the Desk and points at the resize edge", () => {
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

t("registry: dup-smart is an admin and bookkeeper notice naming Smart and Strict", () => {
  const a = ANN_REGISTRY.find((x) => x.id === "dup-smart");
  assert.ok(a);
  assert.deepStrictEqual(a.roles, ["admin", "bookkeeper"]);
  assert.ok(/Smart/.test(a.summary) && /Strict/.test(a.summary));
  assert.ok(!/colour/i.test(JSON.stringify(a.steps({}).map((x) => x.body ? x.body() : ""))));
  assert.strictEqual(a.steps({})[0].targets, undefined);
});

console.log("announcementsLogic: " + n + " checks passed");
