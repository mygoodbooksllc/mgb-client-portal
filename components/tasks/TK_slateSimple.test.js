// Plain node, no framework: `node components/tasks/TK_slateSimple.test.js`.
// Guards the Slate Stage B gate (TK_slateSimple.js): the resolver's truth
// table (View as and Slate plus off always mean off), that the switch is read
// only after Slate plus is on and never written, and the pure Today at a
// glance rules (own open tasks only, counts, top 3 order, the filters).

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const B = require("./TK_slateSimple.js");

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
async function ta(name, fn) {
  try {
    await fn();
  } catch (e) {
    console.error("FAIL " + name);
    throw e;
  }
  n++;
}

const SWITCH_ON = [true, "true", 1, { on: true }];
const SWITCH_OFF = [undefined, null, false, "false", 0, "", "1", {}, { on: false }];

t("View as: always off", () => {
  [true, false].forEach((plus) =>
    [true, false].forEach((pre) =>
      SWITCH_ON.concat(SWITCH_OFF).forEach((sw) => assert.strictEqual(B.TKB_isOn(true, plus, pre, sw), false)),
    ),
  );
});
t("Slate plus off: always off", () => {
  [false, undefined, null, "1", 1].forEach((plus) =>
    [true, false].forEach((pre) =>
      SWITCH_ON.forEach((sw) => assert.strictEqual(B.TKB_isOn(false, plus, pre, sw), false, JSON.stringify([plus, pre, sw]))),
    ),
  );
});
t("Plus on + preview: on; plus on + switch: on; neither: off", () => {
  SWITCH_OFF.forEach((sw) => assert.strictEqual(B.TKB_isOn(false, true, true, sw), true));
  SWITCH_ON.forEach((sw) => assert.strictEqual(B.TKB_isOn(false, true, false, sw), true));
  SWITCH_OFF.forEach((sw) => assert.strictEqual(B.TKB_isOn(false, true, false, sw), false));
  assert.strictEqual(B.TKB_isOn(false, true, "1", undefined), false, "preview must be strictly true");
  assert.strictEqual(B.TKB_isOn(), false);
});
t("Keys and event names", () => {
  assert.strictEqual(B.TKB_PREVIEW_KEY, "mgb_slatesimple_preview");
  assert.strictEqual(B.TKB_CACHE_KEY, "mgb_slatesimple_cache");
  assert.strictEqual(B.TKB_EVENT, "mgb:slatesimple");
  assert.strictEqual(B.TKB_SWITCH_KEY, "slatesimple_enabled");
});
t("Month step label", () => {
  assert.strictEqual(B.TKB_groupLabel("part", "4/14/24th"), "Month step (4th/14th/24th)");
  assert.strictEqual(B.TKB_groupLabel("due", "Due date"), "Due date");
});

// ---- Glance rules ----
const ME = "me@x.org";
const T = (id, o) => Object.assign({ id, assignee_email: ME, status: "todo", done: false }, o);
t("glance: own open tasks only", () => {
  const g = B.TKB_glance(
    [
      T("a", { due_date: "2026-11-01" }), // overdue
      T("b", { due_date: "2026-11-02" }), // today -> week
      T("c", { due_date: "2026-11-09" }), // +7 -> week
      T("d", { due_date: "2026-11-10" }), // +8 -> none
      T("e", { status: "waiting_client", due_date: "2026-10-01" }), // waiting, not overdue
      T("f", { done: true, status: "done", due_date: "2026-10-01" }),
      T("g", { assignee_email: "other@x.org", due_date: "2026-10-01" }),
      T("h", { assignee_email: null, due_date: "2026-10-01" }),
      T("i", { deleted_at: "2026-11-01", due_date: "2026-10-01" }),
      T("j", { assignee_email: "ME@X.ORG", due_date: "2026-10-31" }), // case-insensitive mine, overdue
    ],
    ME,
    "2026-11-02",
  );
  assert.strictEqual(g.overdue, 2);
  assert.strictEqual(g.week, 2);
  assert.strictEqual(g.waiting, 1);
  assert.deepStrictEqual(
    g.top.map((x) => x.id),
    ["j", "a", "b"],
  );
});
t("glance: no due date last; waiting never in Start here; empty and no email", () => {
  const g = B.TKB_glance([T("x", {}), T("y", { due_date: "2026-12-01" }), T("w", { status: "waiting_client" })], ME, "2026-11-02");
  assert.deepStrictEqual(g.top.map((x) => x.id), ["y", "x"]);
  assert.deepStrictEqual(B.TKB_glance([], ME, "2026-11-02"), { overdue: 0, week: 0, waiting: 0, top: [] });
  assert.deepStrictEqual(B.TKB_glance([T("a", {})], "", "2026-11-02").top, []);
  assert.deepStrictEqual(B.TKB_glance(null, ME).top, []);
});
t("glance filters set assignee me", () => {
  assert.deepStrictEqual(B.TKB_glanceFilter("overdue"), { assignee: "me", due: "late", status: "any" });
  assert.deepStrictEqual(B.TKB_glanceFilter("week"), { assignee: "me", due: "next7", status: "any" });
  assert.deepStrictEqual(B.TKB_glanceFilter("waiting"), { assignee: "me", due: "any", status: "waiting" });
  assert.strictEqual(B.TKB_glanceFilter("x"), null);
});
t("addDays crosses months", () => {
  assert.strictEqual(B.TKB_addDays("2026-11-28", 7), "2026-12-05");
  assert.strictEqual(B.TKB_addDays("2026-12-31", 1), "2027-01-01");
});

// ---- Browser behavior in a sandbox ----
function load(o) {
  o = o || {};
  const store = Object.assign({}, o.ls || {});
  const calls = { from: [], session: 0, writes: 0 };
  const events = [];
  const window = {
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => (store[k] = String(v)),
      removeItem: (k) => delete store[k],
    },
    dispatchEvent: (e) => events.push(e.type),
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  const answer = o.answer === undefined ? { data: null, error: null } : o.answer;
  const builder = {
    select: () => builder,
    eq: (col, val) => {
      calls.from[calls.from.length - 1].eq = [col, val];
      return builder;
    },
    maybeSingle: () => Promise.resolve(answer),
    insert: () => (calls.writes++, builder),
    update: () => (calls.writes++, builder),
    upsert: () => (calls.writes++, builder),
    delete: () => (calls.writes++, builder),
  };
  window.mgbSupabase = {
    from: (table) => (calls.from.push({ table }), builder),
    auth: { getSession: () => (calls.session++, Promise.resolve({ data: { session: { user: {} } } })) },
  };
  const sandbox = { window, Event: function (type) { this.type = type; }, console, Date, Promise };
  if (o.viewAs) sandbox.MGB_viewAsReadOnly = () => true;
  sandbox.TKP_on = () => !!o.plus;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "TK_slateSimple.js"), "utf8"), sandbox);
  return { sb: sandbox, store, calls, events };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

(async () => {
  await ta("Plus off: off and no switch read (no new request for most staff)", async () => {
    const L = load({ plus: false, ls: { mgb_slatesimple_preview: "1", mgb_slatesimple_cache: "1" } });
    assert.strictEqual(L.sb.TKB_on(), false);
    await tick();
    assert.strictEqual(L.calls.from.length, 0);
    assert.strictEqual(L.calls.session, 0);
  });
  await ta("View as: off, no network", async () => {
    const L = load({ plus: true, viewAs: true, ls: { mgb_slatesimple_preview: "1" } });
    assert.strictEqual(L.sb.TKB_on(), false);
    await tick();
    assert.strictEqual(L.calls.from.length, 0);
  });
  await ta("Plus on + preview: on, no switch read", async () => {
    const L = load({ plus: true, ls: { mgb_slatesimple_preview: "1" } });
    assert.strictEqual(L.sb.TKB_on(), true);
    await tick();
    assert.strictEqual(L.calls.from.length, 0);
  });
  await ta("Plus on, no preview: one read of slatesimple_enabled, never a write", async () => {
    const L = load({ plus: true, answer: { data: { value: true }, error: null } });
    assert.strictEqual(L.sb.TKB_on(), false);
    await tick();
    await tick();
    assert.deepStrictEqual(L.calls.from[0], { table: "tk_settings", eq: ["key", "slatesimple_enabled"] });
    assert.strictEqual(L.calls.writes, 0);
    assert.strictEqual(L.store.mgb_slatesimple_cache, "1");
    assert.deepStrictEqual(L.events, ["mgb:slatesimple"]);
    assert.strictEqual(L.sb.TKB_on(), true);
    L.sb.TKB_on();
    await tick();
    assert.strictEqual(L.calls.from.length, 1, "one read per page load");
  });
  await ta("Handed filter is taken once", async () => {
    const L = load({ plus: true });
    L.sb.TKB_handFilter({ due: "late" });
    assert.deepStrictEqual(L.events, ["tkb:glance-filter"]);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(L.sb.TKB_takeFilter())), { due: "late" });
    assert.strictEqual(L.sb.TKB_takeFilter(), null);
  });
  console.log("TK_slateSimple: " + n + " tests passed");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
