// Plain node, no framework: `node components/tasks/TK_store.test.js`.
// Guards the Tasks data layer: the TK_store reducer (11.4 upsert rule,
// optimistic edits), and, in a vm sandbox with a stub Supabase client,
// TK_api (2.2 complete, conflicts, B4 probe) and TK_sync (11.4 one edit /
// one fetch, DELETE hints, child coalescing, BroadcastChannel addressing).

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const nodeCrypto = require("crypto");
const S = require("./TK_store.js");

let n = 0;
const queue = [];
function t(name, fn) {
  queue.push({ name, fn });
}
function done() {
  n++;
}

const ME = "me@example.test";
const OTHER = "other@example.test";
let seq = 0;
function uuid(i) {
  return "00000000-0000-4000-8000-" + String(i).padStart(12, "0");
}
function task(over) {
  seq++;
  return Object.assign(
    {
      id: uuid(seq),
      text: "Task " + seq,
      status: "todo",
      done: false,
      priority: "normal",
      assignee_email: ME,
      staff_email: ME,
      client_id: null,
      project_id: null,
      parent_id: null,
      deleted_at: null,
      updated_at: "2026-10-11T10:00:00.000001Z",
    },
    over || {},
  );
}
function reduceAll(state, actions) {
  return actions.reduce((s, a) => S.TK_reduce(s, a), state || S.TK_initialState());
}

// ===========================================================================
// Reducer (pure)
// ===========================================================================

t("TK_listKey shapes, never from an email", () => {
  assert.strictEqual(S.TK_listKey({ mine: true }), "mine");
  assert.strictEqual(S.TK_listKey({ clientId: 42 }), "client:42");
  assert.strictEqual(S.TK_listKey({ projectId: uuid(1) }), "project:" + uuid(1));
  assert.strictEqual(S.TK_listKey({ personId: uuid(2) }), "person:" + uuid(2));
  assert.strictEqual(S.TK_listKey({ staffId: uuid(2) }), "person:" + uuid(2));
  assert.strictEqual(S.TK_listKey({ parentId: uuid(3) }), "children:" + uuid(3));
  assert.strictEqual(S.TK_listKey("mine"), "mine");
  assert.strictEqual(S.TK_listKey({ assigneeEmail: ME }), null);
  assert.strictEqual(S.TK_listKey(null), null);
  done();
});

t("canonical stamps: +00, +00:00, Z, space or T, padded fractions", () => {
  const c = S.TK_stCanonStamp;
  assert.strictEqual(c("2026-10-11 10:00:01.5+00"), "2026-10-11T10:00:01.500000Z");
  assert.strictEqual(c("2026-10-11T10:00:01.500000+00:00"), "2026-10-11T10:00:01.500000Z");
  assert.strictEqual(c("2026-10-11T10:00:01.5Z"), "2026-10-11T10:00:01.500000Z");
  assert.strictEqual(c("2026-10-11T10:00:01Z"), "2026-10-11T10:00:01.000000Z");
  assert.strictEqual(c(null), null);
  assert.strictEqual(S.TK_stCmpStamp("2026-10-11 10:00:01.5+00", "2026-10-11T10:00:01.500000Z"), 0);
  // Microseconds count (Date would drop them).
  assert.strictEqual(S.TK_stCmpStamp("2026-10-11T10:00:01.000002Z", "2026-10-11T10:00:01.000001+00:00"), 1);
  assert.strictEqual(S.TK_stCmpStamp("2026-10-11T10:00:01.000001Z", "2026-10-11T10:00:01.000002Z"), -1);
  assert.strictEqual(S.TK_stCmpStamp(null, "2026-10-11T10:00:01Z"), null);
  done();
});

t("me lowercases; drawer stores id or null; same value keeps state", () => {
  let s = S.TK_reduce(S.TK_initialState(), { type: "me", email: " Me@Example.Test " });
  assert.strictEqual(s.me, ME);
  assert.strictEqual(S.TK_reduce(s, { type: "me", email: ME }), s);
  s = S.TK_reduce(s, { type: "drawer", id: uuid(9) });
  assert.strictEqual(s.drawerId, uuid(9));
  assert.strictEqual(S.TK_reduce(s, { type: "drawer", id: uuid(9) }), s);
  assert.strictEqual(S.TK_reduce(s, { type: "drawer", id: null }).drawerId, null);
  // R2: the Desk's task view has its own field; drawerId stays the modal's.
  assert.strictEqual(S.TK_initialState().deskTaskId, null);
  let d = S.TK_reduce(s, { type: "deskTask", id: uuid(8) });
  assert.strictEqual(d.deskTaskId, uuid(8));
  assert.strictEqual(d.drawerId, uuid(9));
  assert.strictEqual(S.TK_reduce(d, { type: "deskTask", id: uuid(8) }), d);
  assert.strictEqual(S.TK_reduce(d, { type: "deskTask", id: "" }).deskTaskId, null);
  assert.strictEqual(S.TK_reduce(d, { type: "deskTask", id: null }).deskTaskId, null);
  assert.strictEqual(S.TK_reduce(s, { type: "schema", value: "bogus" }), s);
  assert.strictEqual(S.TK_reduce(s, { type: "schema", value: "ok" }).schema, "ok");
  done();
});

t("reset empties the store but keeps online; a different me resets too", () => {
  let s = reduceAll(null, [
    { type: "me", email: ME },
    { type: "online", value: false },
    { type: "upsert", task: task() },
    { type: "staff", staff: [{ email: ME, role: "admin" }] },
  ]);
  assert.ok(Object.keys(s.tasks).length === 1);
  const r = S.TK_reduce(s, { type: "reset" });
  same(r, Object.assign(S.TK_initialState(), { online: false }));
  const other = S.TK_reduce(s, { type: "me", email: "other@example.test" });
  assert.strictEqual(other.me, "other@example.test");
  same(other.tasks, {});
  assert.strictEqual(other.staff, null);
  assert.strictEqual(other.online, false);
  // null to someone (first sign-in) keeps what is there.
  const first = S.TK_reduce(Object.assign({}, s, { me: null }), { type: "me", email: ME });
  assert.strictEqual(Object.keys(first.tasks).length, 1);
  done();
});

t("listLoaded keeps server order, skips deleted and non-matching rows", () => {
  const a = task({ due_date: "2026-10-12" });
  const b = task({ due_date: "2026-10-13" });
  const del = task({ deleted_at: "2026-10-10T00:00:00Z" });
  const notMine = task({ assignee_email: OTHER });
  const s = reduceAll(null, [
    { type: "me", email: ME },
    { type: "listLoaded", key: "mine", tasks: [b, a, del, notMine, b], at: 5 },
  ]);
  assert.deepStrictEqual(s.lists.mine.ids, [b.id, a.id]);
  assert.strictEqual(s.lists.mine.at, 5);
  assert.ok(s.tasks[del.id], "deleted row kept in tasks for the drawer");
  done();
});

t("review list holds tasks in review and follows status changes (tasks p2 s3)", () => {
  const a = task({ status: "ready_for_review", assignee_email: OTHER });
  const b = task({ status: "in_progress" });
  let s = reduceAll(null, [{ type: "listLoaded", key: "review", tasks: [a, b] }]);
  assert.deepStrictEqual(s.lists.review.ids, [a.id]);
  s = S.TK_reduce(s, { type: "upsert", task: Object.assign({}, b, { status: "ready_for_review", updated_at: "2026-10-11T11:00:00Z" }) });
  assert.deepStrictEqual(s.lists.review.ids, [a.id, b.id]);
  s = S.TK_reduce(s, { type: "upsert", task: Object.assign({}, a, { status: "done", done: true, updated_at: "2026-10-11T11:00:00Z" }) });
  assert.deepStrictEqual(s.lists.review.ids, [b.id]);
  done();
});

t("subtasks list holds every subtask, takes new ones, and drops a deleted one (inline subtasks)", () => {
  const sub1 = task({ parent_id: "11111111-1111-1111-1111-111111111111", assignee_email: OTHER });
  const sub2 = task({ parent_id: "11111111-1111-1111-1111-111111111111" });
  const top = task();
  let s = reduceAll(null, [{ type: "me", email: ME }, { type: "listLoaded", key: "subtasks", tasks: [sub1, top, sub2] }]);
  assert.deepStrictEqual(s.lists.subtasks.ids, [sub1.id, sub2.id]);
  const fresh = task({ parent_id: "22222222-2222-2222-2222-222222222222", assignee_email: OTHER });
  s = S.TK_reduce(s, { type: "upsert", task: fresh });
  assert.deepStrictEqual(s.lists.subtasks.ids, [sub1.id, sub2.id, fresh.id]);
  // a trashed project's tasks arrive with deleted_at: they leave the list
  s = S.TK_reduce(s, { type: "upsert", task: Object.assign({}, sub1, { deleted_at: "2026-10-16T00:00:00Z", updated_at: "2026-10-16T01:00:00Z" }) });
  assert.deepStrictEqual(s.lists.subtasks.ids, [sub2.id, fresh.id]);
  // a task made top level (parent cleared) leaves it too
  s = S.TK_reduce(s, { type: "upsert", task: Object.assign({}, sub2, { parent_id: null, updated_at: "2026-10-16T02:00:00Z" }) });
  assert.deepStrictEqual(s.lists.subtasks.ids, [fresh.id]);
  done();
});

t("listLoading / listError", () => {
  let s = S.TK_reduce(S.TK_initialState(), { type: "listLoading", key: "mine" });
  assert.strictEqual(s.lists.mine.loading, true);
  assert.strictEqual(S.TK_reduce(s, { type: "listLoading", key: "mine" }), s);
  s = S.TK_reduce(s, { type: "listError", key: "mine", error: "tk_forbidden" });
  assert.strictEqual(s.lists.mine.loading, false);
  assert.strictEqual(s.lists.mine.error, "tk_forbidden");
  done();
});

t("upsert keeps the newer row; older ignored; equal taken without churn", () => {
  const x = task({ text: "v2", updated_at: "2026-10-11T10:00:02.000000Z" });
  let s = reduceAll(null, [{ type: "me", email: ME }, { type: "listLoaded", key: "mine", tasks: [x] }]);
  const older = Object.assign({}, x, { text: "v1", updated_at: "2026-10-11 10:00:01.999999+00" });
  assert.strictEqual(S.TK_reduce(s, { type: "upsert", task: older }), s, "older row changes nothing");
  const same = Object.assign({}, x, { updated_at: "2026-10-11 10:00:02+00" });
  const s2 = S.TK_reduce(s, { type: "upsert", task: Object.assign({}, x) });
  assert.strictEqual(s2, s, "identical row returns the same state");
  const s3 = S.TK_reduce(s, { type: "upsert", task: same });
  assert.strictEqual(s3.tasks[x.id].text, "v2");
  const newer = Object.assign({}, x, { text: "v3", updated_at: "2026-10-11T10:00:02.000001Z" });
  s = S.TK_reduce(s, { type: "upsert", task: newer });
  assert.strictEqual(s.tasks[x.id].text, "v3");
  done();
});

t("clientcd:<id> (the client panel's list) follows a client's tasks like client:<id>", () => {
  const x = task({ client_id: "7" });
  const other = task({ client_id: "8" });
  let s = reduceAll(null, [
    { type: "me", email: ME },
    { type: "listLoaded", key: "client:7", tasks: [x] },
    { type: "listLoaded", key: "clientcd:7", tasks: [x] },
  ]);
  // A new task for client 7 lands in both lists; one for client 8 in neither.
  const added = task({ client_id: "7" });
  s = S.TK_reduce(s, { type: "upsert", task: added });
  s = S.TK_reduce(s, { type: "upsert", task: other });
  assert.ok(s.lists["clientcd:7"].ids.indexOf(added.id) >= 0);
  assert.ok(s.lists["client:7"].ids.indexOf(added.id) >= 0);
  assert.ok(s.lists["clientcd:7"].ids.indexOf(other.id) < 0);
  // Loading the panel's list never replaces the full list.
  s = S.TK_reduce(s, { type: "listLoaded", key: "clientcd:7", tasks: [x] });
  assert.ok(s.lists["client:7"].ids.indexOf(added.id) >= 0);
  done();
});

t("wb:client:<id> (the Workbench hub's Client tab) follows a client's tasks; wb:mine stays as loaded", () => {
  const x = task({ client_id: "7" });
  let s = reduceAll(null, [
    { type: "me", email: ME },
    { type: "listLoaded", key: "wb:client:7", tasks: [x] },
    { type: "listLoaded", key: "wb:mine", tasks: [] },
  ]);
  const added = task({ client_id: "7" });
  const other = task({ client_id: "70" });
  s = S.TK_reduce(s, { type: "upsert", task: added });
  s = S.TK_reduce(s, { type: "upsert", task: other });
  assert.ok(s.lists["wb:client:7"].ids.indexOf(added.id) >= 0);
  assert.ok(s.lists["wb:client:7"].ids.indexOf(other.id) < 0);
  // Moved to another client: it leaves the tab's list.
  s = S.TK_reduce(s, { type: "upsert", task: Object.assign({}, added, { client_id: "8", updated_at: "2026-10-17T10:00:00.000001Z" }) });
  assert.ok(s.lists["wb:client:7"].ids.indexOf(added.id) < 0);
  // wb:mine is not a client key: membership stays as the last load set it.
  assert.ok(s.lists["wb:mine"].ids.indexOf(added.id) < 0);
  assert.ok(s.lists["wb:client:7"].ids.indexOf(x.id) >= 0);
  done();
});

t("upsert of a deleted row removes it from lists, keeps it in tasks", () => {
  const x = task({ client_id: "7" });
  let s = reduceAll(null, [
    { type: "me", email: ME },
    { type: "listLoaded", key: "mine", tasks: [x] },
    { type: "listLoaded", key: "client:7", tasks: [x] },
  ]);
  s = S.TK_reduce(s, {
    type: "upsert",
    task: Object.assign({}, x, { deleted_at: "2026-10-11T11:00:00Z", updated_at: "2026-10-11T11:00:00Z" }),
  });
  assert.deepStrictEqual(s.lists.mine.ids, []);
  assert.deepStrictEqual(s.lists["client:7"].ids, []);
  assert.ok(s.tasks[x.id].deleted_at);
  done();
});

t("a reassigned task moves out of mine; a newly assigned one moves in", () => {
  const x = task();
  const y = task({ assignee_email: OTHER });
  let s = reduceAll(null, [{ type: "me", email: ME }, { type: "listLoaded", key: "mine", tasks: [x] }]);
  s = S.TK_reduce(s, { type: "upsert", task: Object.assign({}, x, { assignee_email: OTHER, updated_at: "2026-10-11T12:00:00Z" }) });
  assert.deepStrictEqual(s.lists.mine.ids, []);
  s = S.TK_reduce(s, { type: "upsert", task: Object.assign({}, y, { assignee_email: ME, updated_at: "2026-10-11T12:00:00Z" }) });
  assert.deepStrictEqual(s.lists.mine.ids, [y.id]);
  done();
});

t("person:<id> lists follow the staff list; unknown staff leaves membership alone", () => {
  const x = task({ assignee_email: OTHER });
  let s = reduceAll(null, [{ type: "listLoaded", key: "person:" + uuid(500), tasks: [x] }]);
  assert.deepStrictEqual(s.lists["person:" + uuid(500)].ids, [x.id], "staff unknown: kept as loaded");
  s = S.TK_reduce(s, { type: "staff", staff: [{ id: uuid(500), email: OTHER }] });
  s = S.TK_reduce(s, { type: "upsert", task: Object.assign({}, x, { assignee_email: ME, updated_at: "2026-10-11T13:00:00Z" }) });
  assert.deepStrictEqual(s.lists["person:" + uuid(500)].ids, []);
  done();
});

t("remove drops the task from tasks, lists and pending", () => {
  const x = task();
  let s = reduceAll(null, [
    { type: "me", email: ME },
    { type: "listLoaded", key: "mine", tasks: [x] },
    { type: "optimistic", id: x.id, opId: "op1", patch: { text: "edit" } },
    { type: "remove", id: x.id },
  ]);
  assert.strictEqual(s.tasks[x.id], undefined);
  assert.deepStrictEqual(s.lists.mine.ids, []);
  assert.deepStrictEqual(s.pending, {});
  assert.strictEqual(S.TK_reduce(s, { type: "remove", id: uuid(9999) }), s);
  done();
});

t("optimistic applies and rolls back; unknown task is ignored", () => {
  const x = task({ text: "before", priority: "normal" });
  let s = reduceAll(null, [{ type: "me", email: ME }, { type: "listLoaded", key: "mine", tasks: [x] }]);
  assert.strictEqual(S.TK_reduce(s, { type: "optimistic", id: uuid(8888), opId: "z", patch: { text: "q" } }), s);
  s = S.TK_reduce(s, { type: "optimistic", id: x.id, opId: "op1", patch: { text: "after", priority: "high" } });
  assert.strictEqual(s.tasks[x.id].text, "after");
  assert.strictEqual(s.tasks[x.id].priority, "high");
  s = S.TK_reduce(s, { type: "rollback", opId: "op1" });
  assert.strictEqual(s.tasks[x.id].text, "before");
  assert.strictEqual(s.tasks[x.id].priority, "normal");
  assert.deepStrictEqual(s.pending, {});
  done();
});

t("optimistic reassign moves out of mine, and rollback moves it back", () => {
  const x = task();
  let s = reduceAll(null, [{ type: "me", email: ME }, { type: "listLoaded", key: "mine", tasks: [x] }]);
  s = S.TK_reduce(s, { type: "optimistic", id: x.id, opId: "op1", patch: { assignee_email: OTHER } });
  assert.deepStrictEqual(s.lists.mine.ids, []);
  s = S.TK_reduce(s, { type: "rollback", opId: "op1" });
  assert.deepStrictEqual(s.lists.mine.ids, [x.id]);
  done();
});

t("rollback of an earlier op keeps a later op's value and hands it the base", () => {
  const x = task({ text: "server" });
  let s = reduceAll(null, [
    { type: "listLoaded", key: "client:1", tasks: [] },
    { type: "upsert", task: x },
    { type: "optimistic", id: x.id, opId: "a", patch: { text: "first" } },
    { type: "optimistic", id: x.id, opId: "b", patch: { text: "second" } },
  ]);
  assert.strictEqual(s.tasks[x.id].text, "second");
  s = S.TK_reduce(s, { type: "rollback", opId: "a" });
  assert.strictEqual(s.tasks[x.id].text, "second", "later op still shows");
  s = S.TK_reduce(s, { type: "rollback", opId: "b" });
  assert.strictEqual(s.tasks[x.id].text, "server", "base landed on the server value");
  done();
});

t("upsert keeps a pending field when an older or same-stamp row arrives", () => {
  const x = task({ text: "server", updated_at: "2026-10-11T10:00:00.000001Z" });
  let s = reduceAll(null, [
    { type: "me", email: ME },
    { type: "listLoaded", key: "mine", tasks: [x] },
    { type: "optimistic", id: x.id, opId: "op1", patch: { text: "typing" } },
  ]);
  // Same exact stamp in another spelling.
  s = S.TK_reduce(s, { type: "upsert", task: Object.assign({}, x, { updated_at: "2026-10-11 10:00:00.000001+00" }) });
  assert.strictEqual(s.tasks[x.id].text, "typing");
  // Older row.
  s = S.TK_reduce(s, { type: "upsert", task: Object.assign({}, x, { text: "stale", updated_at: "2026-10-11T09:00:00Z" }) });
  assert.strictEqual(s.tasks[x.id].text, "typing");
  // Newer row from someone else: other fields update, the pending field stays,
  // and the rollback base moves to the newest server value.
  s = S.TK_reduce(s, {
    type: "upsert",
    task: Object.assign({}, x, { text: "theirs", priority: "high", updated_at: "2026-10-11T10:00:05Z" }),
  });
  assert.strictEqual(s.tasks[x.id].text, "typing");
  assert.strictEqual(s.tasks[x.id].priority, "high");
  assert.ok(s.pending.op1);
  s = S.TK_reduce(s, { type: "rollback", opId: "op1" });
  assert.strictEqual(s.tasks[x.id].text, "theirs");
  done();
});

t("commit drops the op and takes the server row (a reverted field shows the server value)", () => {
  const x = task({ text: "server", priority: "normal" });
  let s = reduceAll(null, [
    { type: "me", email: ME },
    { type: "listLoaded", key: "mine", tasks: [x] },
    { type: "optimistic", id: x.id, opId: "op1", patch: { text: "mine", priority: "high" } },
  ]);
  s = S.TK_reduce(s, {
    type: "commit",
    opId: "op1",
    task: Object.assign({}, x, { text: "mine", priority: "normal", updated_at: "2026-10-11T10:00:09Z" }),
  });
  assert.deepStrictEqual(s.pending, {});
  assert.strictEqual(s.tasks[x.id].text, "mine");
  assert.strictEqual(s.tasks[x.id].priority, "normal");
  // Commit without a row just drops the op and keeps the patched values.
  s = reduceAll(s, [
    { type: "optimistic", id: x.id, opId: "op2", patch: { text: "again" } },
    { type: "commit", opId: "op2" },
  ]);
  assert.deepStrictEqual(s.pending, {});
  assert.strictEqual(s.tasks[x.id].text, "again");
  done();
});

t("TK_selectList is stable while nothing it shows changes", () => {
  const x = task();
  const y = task({ assignee_email: OTHER });
  let s = reduceAll(null, [{ type: "me", email: ME }, { type: "listLoaded", key: "mine", tasks: [x], at: 1 }]);
  const v1 = S.TK_selectList(s, "mine");
  assert.strictEqual(v1.tasks[0], s.tasks[x.id]);
  s = S.TK_reduce(s, { type: "upsert", task: y }); // not in mine
  assert.strictEqual(S.TK_selectList(s, "mine"), v1);
  s = S.TK_reduce(s, { type: "upsert", task: Object.assign({}, x, { text: "new", updated_at: "2026-10-11T14:00:00Z" }) });
  const v2 = S.TK_selectList(s, "mine");
  assert.notStrictEqual(v2, v1);
  assert.strictEqual(v2.tasks[0].text, "new");
  assert.strictEqual(S.TK_selectList(s, "nope"), S.TK_selectList(s, "other"), "one shared empty value");
  done();
});

t("TK_createStore notifies only on change", () => {
  const store = S.TK_createStore();
  let calls = 0;
  const off = store.subscribe(() => calls++);
  store.dispatch({ type: "me", email: ME });
  store.dispatch({ type: "me", email: ME });
  assert.strictEqual(calls, 1);
  off();
  store.dispatch({ type: "me", email: OTHER });
  assert.strictEqual(calls, 1);
  done();
});

// ===========================================================================
// Browser files in a vm sandbox, with a stub Supabase client
// ===========================================================================

const DIR = __dirname;
// Values from the sandbox come from another realm; compare as plain JSON.
function same(a, b, msg) {
  assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), msg);
}

const SOURCES = ["TK_logic.js", "TK_store.js", "TK_api.js", "TK_sync.js"].filter((f) => fs.existsSync(path.join(DIR, f)));

function flush() {
  let p = Promise.resolve();
  for (let i = 0; i < 8; i++) p = p.then(() => new Promise((r) => setImmediate(r)));
  return p;
}

// One BroadcastChannel bus per test, shared by sandboxes ("windows").
function makeBus() {
  const members = [];
  return {
    members,
    Ctor: class FakeBroadcastChannel {
      constructor(name) {
        this.name = name;
        this.onmessage = null;
        this.closed = false;
        members.push(this);
      }
      postMessage(data) {
        const copy = JSON.parse(JSON.stringify(data));
        // Stricter than the browser: also echoes to the sender, so the
        // own-message guard is exercised.
        members.slice().forEach((m) => {
          if (!m.closed && m.name === this.name && typeof m.onmessage === "function") m.onmessage({ data: copy });
        });
      }
      close() {
        this.closed = true;
      }
    },
  };
}

function makeEnv(opts) {
  const o = opts || {};
  const clock = { now: Date.parse("2026-10-11T15:00:00Z") };
  const timers = [];
  let timerId = 0;
  const counts = { notify: 0, toggle: [], queries: [], rpcs: [], channels: [], removed: 0, events: [], errors: [] };
  const listeners = {};

  class FakeEvent {
    constructor(type) {
      this.type = type;
    }
  }
  class FakeCustomEvent extends FakeEvent {
    constructor(type, init) {
      super(type);
      this.detail = init ? init.detail : undefined;
    }
  }
  class FakeDate extends Date {
    static now() {
      return clock.now;
    }
  }

  const ctx = {
    console: { log: console.log, warn() {}, error: (...a) => counts.errors.push(a.join(" ")) },
    navigator: { onLine: true },
    crypto: { randomUUID: () => nodeCrypto.randomUUID() },
    Date: FakeDate,
    Promise,
    Object,
    Array,
    JSON,
    Math,
    String,
    Number,
    Error,
    TypeError,
    RegExp,
    isNaN,
    setTimeout(fn, ms) {
      const id = ++timerId;
      timers.push({ id, at: clock.now + (ms || 0), fn });
      return id;
    },
    clearTimeout(id) {
      const i = timers.findIndex((x) => x.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
    Event: FakeEvent,
    CustomEvent: FakeCustomEvent,
    BroadcastChannel: o.bus ? o.bus.Ctor : undefined,
    addEventListener(type, fn) {
      (listeners[type] = listeners[type] || []).push(fn);
    },
    removeEventListener(type, fn) {
      const l = listeners[type] || [];
      const i = l.indexOf(fn);
      if (i >= 0) l.splice(i, 1);
    },
    dispatchEvent(ev) {
      counts.events.push({ type: ev.type, detail: ev.detail });
      (listeners[ev.type] || []).slice().forEach((fn) => fn(ev));
      return true;
    },
  };
  ctx.window = ctx;
  ctx.staffItemsApi = {
    notify() {
      counts.notify++;
      ctx.dispatchEvent(new FakeEvent("mgb:staff-items-changed"));
    },
    toggleDone(sb, email, item) {
      counts.toggle.push({ email, done: item.done, id: item.id });
      return Promise.resolve({ data: null, error: null });
    },
  };
  ctx.TCL_EVENT = "mgb:task-checklists-changed";

  // Handlers decide responses: query(q) -> {data, error}; rpc(name, args) -> {data, error}
  const handlers = {
    query: o.query || (() => ({ data: [], error: null })),
    rpc: o.rpc || ((name) => (name === "tk_schema_version" ? { data: 1, error: null } : { data: null, error: null })),
  };

  function builder(table) {
    const q = { table, op: "select", ops: [], filters: {}, payload: null };
    const b = {};
    ["select", "eq", "or", "order", "limit", "is", "in", "contains", "neq", "gte", "single", "maybeSingle"].forEach((m) => {
      b[m] = (...args) => {
        q.ops.push([m].concat(args));
        if (m === "eq") q.filters[args[0]] = args[1];
        if (m === "single" || m === "maybeSingle") q.single = m;
        return b;
      };
    });
    ["update", "insert", "delete"].forEach((m) => {
      b[m] = (...args) => {
        q.op = m;
        q.payload = args[0];
        q.ops.push([m].concat(args));
        return b;
      };
    });
    b.then = (res, rej) => Promise.resolve().then(() => handlers.query(q)).then(res, rej);
    counts.queries.push(q);
    return b;
  }

  const client = {
    from: builder,
    rpc(name, args) {
      counts.rpcs.push({ name, args });
      return Promise.resolve().then(() => handlers.rpc(name, args));
    },
    channel(name, cfg) {
      const ch = {
        name,
        cfg,
        listeners: [],
        statusCb: null,
        on(type, filter, cb) {
          ch.listeners.push({ type, filter, cb });
          return ch;
        },
        subscribe(cb) {
          ch.statusCb = cb || null;
          return ch;
        },
        status(s) {
          if (ch.statusCb) ch.statusCb(s);
        },
        emit(table, payload) {
          ch.listeners.filter((l) => l.filter.table === table).forEach((l) => l.cb(payload));
        },
      };
      counts.channels.push(ch);
      return ch;
    },
    removeChannel() {
      counts.removed++;
    },
    storage: { from: () => ({ upload: () => Promise.resolve({ error: null }), createSignedUrl: () => Promise.resolve({ data: { signedUrl: "https://example.test/x" } }) }) },
  };

  vm.createContext(ctx);
  SOURCES.forEach((f) => vm.runInContext(fs.readFileSync(path.join(DIR, f), "utf8"), ctx, { filename: f }));
  ctx.TK_api._client = client;

  // Count store dispatches by type.
  const dispatched = [];
  const origDispatch = ctx.TK_store.dispatch;
  ctx.TK_store.dispatch = function (a) {
    dispatched.push(a);
    return origDispatch(a);
  };

  async function advance(ms) {
    const target = clock.now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at || a.id - b.id);
      const next = timers[0];
      if (!next || next.at > target) break;
      timers.shift();
      clock.now = next.at;
      next.fn();
      await flush();
    }
    clock.now = target;
    await flush();
  }

  return {
    ctx,
    client,
    clock,
    counts,
    handlers,
    dispatched,
    advance,
    api: ctx.TK_api,
    sync: ctx.TK_sync,
    store: ctx.TK_store,
    channel: (prefix) => counts.channels.find((c) => c.name.indexOf(prefix) === 0),
    events: (type) => counts.events.filter((e) => e.type === type),
  };
}

function row(over) {
  return Object.assign(task(), over || {});
}

// Start sync with schema ok and the "mine" list loaded with one task.
async function startedEnv(opts) {
  const env = makeEnv(opts);
  env.sync.start(ME);
  await flush();
  const x = row({ updated_at: "2026-10-11T10:00:00.123456+00:00" });
  env.store.dispatch({ type: "listLoaded", key: "mine", tasks: [env.api.normalize(x)], at: 1 });
  return { env, x };
}

t("channels: opened only after schema ok, named by tabId, private, never an email", async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const env = makeEnv({
    rpc: (name) => (name === "tk_schema_version" ? gate.then(() => ({ data: 1, error: null })) : { data: null, error: null }),
  });
  env.sync.start(ME);
  await flush();
  assert.strictEqual(env.counts.channels.length, 0, "no channel before the probe answers");
  release();
  await flush();
  assert.strictEqual(env.store.getState().schema, "ok");
  const names = env.counts.channels.map((c) => c.name).sort();
  same(names, ["tk-core-" + env.sync.tabId, "tk-tasks-" + env.sync.tabId].sort());
  env.counts.channels.forEach((c) => {
    assert.ok(c.name.indexOf("@") < 0 && c.name.indexOf("example") < 0, "no email in a channel name");
    assert.strictEqual(c.cfg.config.private, true);
  });
  assert.strictEqual(env.store.getState().me, ME);
  // Re-dispatches never open more channels.
  env.store.dispatch({ type: "online", value: false });
  env.store.dispatch({ type: "online", value: true });
  assert.strictEqual(env.counts.channels.length, 2);
  done();
});

t("channels: never opened when the schema is missing", async () => {
  const env = makeEnv({ rpc: () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function" } }) });
  env.sync.start(ME);
  await flush();
  assert.strictEqual(env.store.getState().schema, "missing");
  assert.strictEqual(env.counts.channels.length, 0);
  done();
});

t("one edit, one fetch: channel SUBSCRIBED -> zero refetches, one store upsert", async () => {
  const { env, x } = await startedEnv({
    query: (q) => {
      if (q.table === "staff_reminders" && q.op === "update") {
        return { data: [Object.assign({}, x, q.payload, { updated_at: "2026-10-11T15:00:00.654321+00:00" })], error: null };
      }
      return { data: [], error: null };
    },
  });
  env.channel("tk-tasks-").status("SUBSCRIBED");
  let loads = 0;
  env.sync.registerLoader("mine", () => {
    loads++;
  });
  const before = env.counts.queries.length;
  env.dispatched.length = 0;

  const saved = await env.api.update(x.id, { text: "Renamed" }, { baseUpdatedAt: x.updated_at });
  assert.strictEqual(saved.text, "Renamed");
  assert.strictEqual(env.counts.notify, 1, "legacy notify still fires for Today and badges");
  // The realtime echo of the same row, in Realtime's own spelling.
  env.channel("tk-tasks-").emit("staff_reminders", {
    eventType: "UPDATE",
    new: Object.assign({}, x, { text: "Renamed", updated_at: "2026-10-11 15:00:00.654321+00", search_tsv: "x", deleted_by: null }),
    old: { id: x.id },
  });
  await env.advance(3000);

  const writes = env.dispatched.filter((a) => a.type === "upsert" || a.type === "commit");
  assert.strictEqual(writes.length, 1, "one store upsert");
  assert.strictEqual(loads, 0, "no list refetch");
  assert.strictEqual(env.counts.queries.length - before, 1, "only the update itself hit the database");
  assert.strictEqual(env.store.getState().tasks[x.id].text, "Renamed");
  done();
});

t("update sends the exact base updated_at string", async () => {
  const { env, x } = await startedEnv({
    query: (q) => (q.op === "update" ? { data: [Object.assign({}, x, q.payload, { updated_at: "2026-10-11T16:00:00Z" })], error: null } : { data: [], error: null }),
  });
  await env.api.update(x.id, { priority: "high" }, { baseUpdatedAt: x.updated_at });
  const q = env.counts.queries.find((qq) => qq.op === "update");
  assert.strictEqual(q.filters.updated_at, "2026-10-11T10:00:00.123456+00:00");
  assert.strictEqual(q.filters.id, x.id);
  done();
});

t("not joined: no refetch inside 1 s of markOwnWrite, then one debounced refetch per burst", async () => {
  const { env, x } = await startedEnv({
    query: (q) => (q.op === "update" ? { data: [Object.assign({}, x, q.payload, { updated_at: "2026-10-11T15:00:01Z" })], error: null } : { data: [], error: null }),
  });
  env.channel("tk-tasks-").status("CHANNEL_ERROR");
  let loads = 0;
  env.sync.registerLoader("mine", () => {
    loads++;
  });
  await env.api.update(x.id, { text: "Edited" }, {});
  assert.strictEqual(env.counts.notify, 1);
  await env.advance(300);
  env.ctx.dispatchEvent(new env.ctx.Event("mgb:staff-items-changed")); // still inside 1 s
  await env.advance(2000);
  assert.strictEqual(loads, 0, "own write never refetches");
  // An outside burst: three events, one refetch after 400 ms.
  env.ctx.dispatchEvent(new env.ctx.Event("mgb:staff-items-changed"));
  await env.advance(100);
  env.ctx.dispatchEvent(new env.ctx.Event("mgb:staff-items-changed"));
  await env.advance(100);
  env.ctx.dispatchEvent(new env.ctx.Event("mgb:staff-items-changed"));
  await env.advance(399);
  assert.strictEqual(loads, 0, "still debouncing");
  await env.advance(1);
  assert.strictEqual(loads, 1);
  await env.advance(2000);
  assert.strictEqual(loads, 1);
  // An unloaded list is not refetched.
  let other = 0;
  env.sync.registerLoader("client:9", () => other++);
  env.ctx.dispatchEvent(new env.ctx.Event("mgb:staff-items-changed"));
  await env.advance(500);
  assert.strictEqual(loads, 2);
  assert.strictEqual(other, 0);
  done();
});

t("a write during the debounce cancels the fallback refetch", async () => {
  const { env, x } = await startedEnv({
    query: (q) => (q.op === "update" ? { data: [Object.assign({}, x, q.payload, { updated_at: "2026-10-11T15:00:02Z" })], error: null } : { data: [], error: null }),
  });
  let loads = 0;
  env.sync.registerLoader("mine", () => loads++);
  env.ctx.dispatchEvent(new env.ctx.Event("mgb:staff-items-changed"));
  await env.advance(200);
  env.sync.markOwnWrite();
  await env.advance(1500);
  assert.strictEqual(loads, 0);
  done();
});

t("legacy event ignored while joined; a rejoin after a drop refetches once", async () => {
  const { env } = await startedEnv();
  let loads = 0;
  env.sync.registerLoader("mine", () => loads++);
  const ch = env.channel("tk-tasks-");
  ch.status("SUBSCRIBED");
  assert.strictEqual(loads, 0, "first join does not refetch");
  env.ctx.dispatchEvent(new env.ctx.Event("mgb:staff-items-changed"));
  await env.advance(1000);
  assert.strictEqual(loads, 0);
  ch.status("CLOSED");
  ch.status("SUBSCRIBED");
  assert.strictEqual(loads, 1);
  done();
});

t("realtime DELETE for a task not in the store dispatches nothing", async () => {
  const { env, x } = await startedEnv();
  const ch = env.channel("tk-tasks-");
  ch.status("SUBSCRIBED");
  env.dispatched.length = 0;
  ch.emit("staff_reminders", { eventType: "DELETE", new: {}, old: { id: uuid(77777) } });
  assert.strictEqual(env.dispatched.length, 0);
  ch.emit("staff_reminders", { eventType: "DELETE", new: {}, old: { id: x.id } });
  same(env.dispatched.map((a) => a.type), ["remove"]);
  assert.strictEqual(env.store.getState().tasks[x.id], undefined);
  done();
});

t("realtime soft delete takes the task out of lists, keeps it for the drawer", async () => {
  const { env, x } = await startedEnv();
  env.channel("tk-tasks-").emit("staff_reminders", {
    eventType: "UPDATE",
    new: Object.assign({}, x, { deleted_at: "2026-10-11T15:01:00Z", updated_at: "2026-10-11T15:01:00Z" }),
    old: { id: x.id },
  });
  const s = env.store.getState();
  same(s.lists.mine.ids, []);
  assert.ok(s.tasks[x.id].deleted_at);
  done();
});

t("five child events on one task within 250 ms send one tk:task-changed", async () => {
  const { env, x } = await startedEnv();
  const core = env.channel("tk-core-");
  core.emit("tk_comments", { eventType: "INSERT", new: { id: "c1", task_id: x.id }, old: {} });
  await env.advance(50);
  core.emit("tk_comments", { eventType: "INSERT", new: { id: "c2", task_id: x.id }, old: {} });
  core.emit("tk_activity", { eventType: "INSERT", new: { id: "a1", task_id: x.id }, old: {} });
  await env.advance(100);
  core.emit("tk_activity", { eventType: "INSERT", new: { id: "a2", task_id: x.id }, old: {} });
  core.emit("task_checklist_items", { eventType: "UPDATE", new: { id: "k1", reminder_id: x.id }, old: {} });
  await env.advance(99);
  assert.strictEqual(env.events("tk:task-changed").length, 0);
  await env.advance(1);
  const evs = env.events("tk:task-changed");
  assert.strictEqual(evs.length, 1);
  assert.strictEqual(evs[0].detail.id, x.id);
  same(evs[0].detail.tables.slice().sort(), ["task_checklist_items", "tk_activity", "tk_comments"]);
  assert.strictEqual(env.events("mgb:task-checklists-changed").length, 1);
  // A child DELETE for a task this window does not have is ignored.
  core.emit("tk_followers", { eventType: "DELETE", new: {}, old: { task_id: uuid(66666), staff_email: OTHER } });
  await env.advance(300);
  assert.strictEqual(env.events("tk:task-changed").length, 1);
  done();
});

t("BroadcastChannel: own messages ignored; dock acts only for the named tab", async () => {
  const bus = makeBus();
  const a = makeEnv({ bus });
  const b = makeEnv({ bus });
  a.sync.start(ME);
  b.sync.start(ME);
  await flush();
  assert.notStrictEqual(a.sync.tabId, b.sync.tabId);
  const seenA = [];
  const seenB = [];
  a.sync.on("dock", (m) => seenA.push(m));
  b.sync.on("dock", (m) => seenB.push(m));
  a.sync.post({ type: "dock", hash: "#/tasks/my", to: "some-other-tab" });
  assert.strictEqual(seenB.length, 0, "not addressed to B");
  a.sync.post({ type: "dock", hash: "#/tasks/my", to: b.sync.tabId });
  assert.strictEqual(seenB.length, 1);
  assert.strictEqual(seenB[0].from, a.sync.tabId);
  assert.strictEqual(seenB[0].v, 1);
  assert.strictEqual(seenA.length, 0, "the sender ignores its own message");

  // upsert crosses windows once, deduped by updated_at.
  const x = a.api.normalize(row({ updated_at: "2026-10-11T15:05:00Z" }));
  a.sync.post({ type: "upsert", task: x });
  assert.strictEqual(b.store.getState().tasks[x.id].id, x.id);
  b.dispatched.length = 0;
  a.sync.post({ type: "upsert", task: x });
  assert.strictEqual(b.dispatched.length, 0, "same updated_at is not dispatched again");
  // remove for an unknown task is ignored.
  a.sync.post({ type: "remove", id: uuid(55555) });
  assert.strictEqual(b.dispatched.length, 0);
  // A wrong version is ignored.
  bus.members[1].onmessage({ data: { v: 2, type: "dock", to: b.sync.tabId, from: "x" } });
  assert.strictEqual(seenB.length, 1);
  done();
});

t("stop closes channels and BroadcastChannel; start is idempotent", async () => {
  const bus = makeBus();
  const env = makeEnv({ bus });
  env.sync.start(ME);
  env.sync.start(ME);
  await flush();
  assert.strictEqual(env.counts.channels.length, 2);
  env.sync.stop();
  assert.strictEqual(env.counts.removed, 2);
  assert.ok(bus.members.every((m) => m.closed));
  const dbg = env.sync._debug();
  assert.strictEqual(dbg.started, false);
  assert.strictEqual(dbg.hasTasksChannel, false);
  assert.strictEqual(env.store.getState().me, null, "stop clears the last person's store");
  same(env.store.getState().tasks, {});
  done();
});

// ---- TK_api.complete: Slate rhythm slice 4 row 6 guard (review fix) ----------
// A "Send reports" row completed outside the drawer picker opens the task
// instead (Full or Preliminary must be asked). Feature off: unchanged.

const RH = require("./TK_rhythmLogic.js");
const TPL6 = "tpl-6-reports";
function rhythmEnv(on, over, tplRef) {
  const base = row(Object.assign({ client_id: "grace", period_kind: "month", period_start: "2026-09-01", template_id: TPL6 }, over || {}));
  const opened = [];
  const env = makeEnv({
    rpc: (name) => {
      if (name === "tk_schema_version") return { data: 1, error: null };
      if (name === "tk_set_status") return { data: "done", error: null };
      return { data: null, error: null };
    },
    query: (q) => {
      if (q.table === "task_templates" && q.single === "maybeSingle") {
        return { data: { id: TPL6, source_ref: tplRef === undefined ? "month_rhythm:6_reports" : tplRef, email_kind: "reports" }, error: null };
      }
      if (q.table === "staff_reminders" && q.single === "maybeSingle") {
        return { data: Object.assign({}, base, { template_id: TPL6, status: "done", done: true }), error: null };
      }
      return { data: [], error: null };
    },
  });
  env.ctx.TK_rhythmEnabled = () => on;
  env.ctx.TK_reportPeriodOf = RH.TK_reportPeriodOf;
  env.ctx.TK_reportPickerNeeded = RH.TK_reportPickerNeeded;
  env.ctx.TK_openTask = (id, o) => opened.push({ id, from: o && o.from });
  env.store.dispatch({ type: "me", email: ME });
  const x = env.api.normalize(base);
  env.store.dispatch({ type: "listLoaded", key: "mine", tasks: [x] });
  return { env, x, opened, setStatus: () => env.counts.rpcs.filter((c) => c.name === "tk_set_status").length,
    tplReads: () => env.counts.queries.filter((q) => q.table === "task_templates").length };
}

t("rhythm guard: row 6 from a checkbox opens the task, does not complete", async () => {
  const { env, x, opened, setStatus } = rhythmEnv(true);
  const r = await env.api.complete(x, { done: true });
  assert.strictEqual(r.reportPick, true);
  assert.strictEqual(r.status, "todo");
  assert.strictEqual(setStatus(), 0);
  same(opened, [{ id: x.id, from: "report" }]);
  assert.strictEqual(env.events("mgb:toast")[0].detail.text, "Choose Full or Preliminary reports to finish this task.");
  done();
});

t("rhythm guard: the drawer picker (skipReportPick) completes", async () => {
  const { env, x, opened, setStatus } = rhythmEnv(true);
  const r = await env.api.complete(x, { done: true, skipReportPick: true });
  assert.strictEqual(r.status, "done");
  assert.strictEqual(setStatus(), 1);
  assert.strictEqual(opened.length, 0);
  done();
});

t("rhythm guard: feature off reads no template and completes as before", async () => {
  const { env, x, opened, setStatus, tplReads } = rhythmEnv(false);
  const r = await env.api.complete(x, { done: true });
  assert.strictEqual(r.status, "done");
  assert.strictEqual(setStatus(), 1);
  assert.strictEqual(tplReads(), 0);
  assert.strictEqual(opened.length, 0);
  done();
});

t("rhythm guard: other templates, no client, no month or no template complete", async () => {
  for (const [over, ref] of [[{}, "month_rhythm:7_follow_up"], [{ client_id: null }, undefined],
    [{ period_kind: "quarter" }, undefined], [{ template_id: null }, undefined]]) {
    const { env, x, opened, setStatus } = rhythmEnv(true, over, ref);
    const r = await env.api.complete(x, { done: true });
    assert.strictEqual(r.status, "done", JSON.stringify(over));
    assert.strictEqual(setStatus(), 1);
    assert.strictEqual(opened.length, 0);
  }
  done();
});

t("rhythm guard: a Today row without template_id looks it up", async () => {
  const { env, x, opened, setStatus } = rhythmEnv(true);
  const today = Object.assign({}, x);
  delete today.template_id;
  const r = await env.api.complete(today, { done: true });
  assert.strictEqual(r.reportPick, true);
  assert.strictEqual(setStatus(), 0);
  assert.strictEqual(opened.length, 1);
  done();
});

// ---- TK_api.complete (2.2) ---------------------------------------------------

function completeEnv(answer) {
  const x = row({ review_required: true, updated_at: "2026-10-11T10:00:00Z" });
  const env = makeEnv({
    rpc: (name, args) => {
      if (name === "tk_schema_version") return { data: 1, error: null };
      if (name === "tk_set_status") return { data: answer, error: null };
      return { data: null, error: null };
    },
    query: (q) => {
      if (q.table === "staff_reminders" && q.single === "maybeSingle") {
        return { data: Object.assign({}, x, { status: answer, done: answer === "done", updated_at: "2026-10-11T15:00:00Z" }), error: null };
      }
      return { data: [], error: null };
    },
  });
  env.store.dispatch({ type: "me", email: ME });
  env.store.dispatch({ type: "listLoaded", key: "mine", tasks: [env.api.normalize(x)] });
  return { env, x: env.api.normalize(x) };
}

t("complete: one tk_set_status call, sentForReview, exactly one toast", async () => {
  const { env, x } = completeEnv("ready_for_review");
  const p1 = env.api.complete(x, { done: true });
  const p2 = env.api.complete(x, { done: true }); // double click
  const [r1, r2] = await Promise.all([p1, p2]);
  same(JSON.parse(JSON.stringify(r1)), { status: "ready_for_review", sentForReview: true, nextId: null });
  assert.strictEqual(r1, r2, "the second click shares the first request");
  const calls = env.counts.rpcs.filter((c) => c.name === "tk_set_status");
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].args.p_id, x.id);
  assert.strictEqual(calls[0].args.p_status, "done");
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(calls[0].args.p_today));
  const toasts = env.events("mgb:toast");
  assert.strictEqual(toasts.length, 1);
  assert.strictEqual(toasts[0].detail.text, "Sent for review. An admin will approve it.");
  const s = env.store.getState();
  assert.strictEqual(s.tasks[x.id].status, "ready_for_review");
  same(s.pending, {});
  assert.strictEqual(env.counts.notify, 1);
  done();
});

t("complete: a done task sends no request", async () => {
  const { env, x } = completeEnv("done");
  const doneTask = Object.assign({}, x, { status: "done", done: true });
  const before = env.counts.rpcs.length + env.counts.queries.length;
  const r = await env.api.complete(doneTask, { done: true });
  assert.strictEqual(r.status, "done");
  assert.strictEqual(r.sentForReview, false);
  assert.strictEqual(r.nextId, null);
  assert.strictEqual(env.counts.rpcs.length + env.counts.queries.length, before);
  assert.strictEqual(env.events("mgb:toast").length, 0);
  done();
});

t("complete: plain done gives no toast and no sentForReview", async () => {
  const { env, x } = completeEnv("done");
  const r = await env.api.complete(Object.assign({}, x, { review_required: false }), { done: true });
  assert.strictEqual(r.status, "done");
  assert.strictEqual(r.sentForReview, false);
  assert.strictEqual(env.events("mgb:toast").length, 0);
  assert.strictEqual(env.store.getState().tasks[x.id].done, true);
  done();
});

t("complete: an RPC error rolls the optimistic status back", async () => {
  const x = row({ updated_at: "2026-10-11T10:00:00Z" });
  const env = makeEnv({
    rpc: (name) =>
      name === "tk_schema_version" ? { data: 1, error: null } : { data: null, error: { code: "22023", message: "tk_bad_transition" } },
  });
  env.store.dispatch({ type: "listLoaded", key: "client:1", tasks: [] });
  env.store.dispatch({ type: "upsert", task: env.api.normalize(x) });
  await assert.rejects(env.api.complete(env.api.normalize(x), { done: true }), (e) => e.code === "22023" && e.reason === "tk_bad_transition");
  const s = env.store.getState();
  assert.strictEqual(s.tasks[x.id].status, "todo");
  same(s.pending, {});
  done();
});

t("complete: schema missing falls back to staffItemsApi.toggleDone", async () => {
  const x = row();
  const env = makeEnv({ rpc: () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function public.tk_schema_version" } }) });
  env.store.dispatch({ type: "me", email: ME });
  const r = await env.api.complete(env.api.normalize(x), { done: true });
  assert.strictEqual(env.counts.toggle.length, 1);
  assert.strictEqual(env.counts.toggle[0].done, false, "toggleDone flips item.done, so it gets the current value");
  assert.strictEqual(r.status, "done");
  assert.strictEqual(env.counts.rpcs.filter((c) => c.name === "tk_set_status").length, 0);
  done();
});

t("complete offline rejects tk_offline without a request", async () => {
  const { env, x } = completeEnv("done");
  env.ctx.navigator.onLine = false;
  await assert.rejects(env.api.complete(x, { done: true }), (e) => e.code === "tk_offline");
  assert.strictEqual(env.counts.rpcs.filter((c) => c.name === "tk_set_status").length, 0);
  done();
});

// ---- TK_api.update conflicts ------------------------------------------------

function updateEnv(current) {
  const x = row({ updated_at: "2026-10-11T10:00:00.000001Z" });
  const env = makeEnv({
    query: (q) => {
      if (q.op === "update") return { data: [], error: null }; // 0 rows
      if (q.table === "staff_reminders" && q.single === "maybeSingle") return { data: current ? current(x) : null, error: null };
      return { data: [], error: null };
    },
  });
  env.store.dispatch({ type: "me", email: ME });
  env.store.dispatch({ type: "listLoaded", key: "mine", tasks: [env.api.normalize(x)] });
  return { env, x };
}

t("update on 0 rows: moved updated_at is tk_conflict and rolls the patch back", async () => {
  const { env, x } = updateEnv((x0) => Object.assign({}, x0, { text: "Theirs", updated_at: "2026-10-11T10:00:05Z" }));
  await assert.rejects(
    env.api.update(x.id, { text: "Mine" }, { baseUpdatedAt: x.updated_at, optimistic: true }),
    (e) => e.code === "tk_conflict" && e.task && e.task.text === "Theirs",
  );
  const s = env.store.getState();
  assert.strictEqual(s.tasks[x.id].text, "Theirs", "store shows the current server row");
  same(s.pending, {});
  done();
});

t("update on 0 rows: same updated_at (or no row) is tk_forbidden", async () => {
  let r = updateEnv((x0) => Object.assign({}, x0));
  await assert.rejects(r.env.api.update(r.x.id, { text: "Mine" }, { baseUpdatedAt: r.x.updated_at, optimistic: true }), (e) => e.code === "tk_forbidden");
  assert.strictEqual(r.env.store.getState().tasks[r.x.id].text, r.x.text, "optimistic patch rolled back");
  r = updateEnv(null);
  await assert.rejects(r.env.api.update(r.x.id, { text: "Mine" }, { baseUpdatedAt: r.x.updated_at }), (e) => e.code === "tk_forbidden");
  done();
});

t("update: a field the server reverted raises tk_reverted with the fields", async () => {
  const x = row({ updated_at: "2026-10-11T10:00:00Z" });
  const env = makeEnv({
    query: (q) => (q.op === "update" ? { data: [Object.assign({}, x, { client_id: null, updated_at: "2026-10-11T10:00:02Z" })], error: null } : { data: [], error: null }),
  });
  await assert.rejects(env.api.update(x.id, { client_id: "5" }, {}), (e) => e.code === "tk_reverted" && e.fields.indexOf("client_id") >= 0);
  done();
});

t("update whitelists fields and lowercases the assignee", async () => {
  const x = row({ updated_at: "2026-10-11T10:00:00Z" });
  const env = makeEnv({
    query: (q) => (q.op === "update" ? { data: [Object.assign({}, x, q.payload, { updated_at: "2026-10-11T10:00:03Z" })], error: null } : { data: [], error: null }),
  });
  await env.api.update(x.id, { assignee_email: "Other@Example.Test", status: "done", staff_email: OTHER, updated_at: "x" }, {});
  const q = env.counts.queries.find((qq) => qq.op === "update");
  same(Object.keys(q.payload), ["assignee_email"]);
  assert.strictEqual(q.payload.assignee_email, OTHER);
  done();
});

// ---- createProject ---------------------------------------------------------

t("createProject maps 23505 to tk_name_taken and uses .select()", async () => {
  const env = makeEnv({
    query: (q) => (q.table === "tk_projects" && q.op === "insert" ? { data: null, error: { code: "23505", message: "duplicate key" } } : { data: [], error: null }),
  });
  await assert.rejects(env.api.createProject({ name: "Year end" }), (e) => e.code === "tk_name_taken");
  const q = env.counts.queries.find((qq) => qq.table === "tk_projects");
  assert.ok(q.ops.some((o) => o[0] === "select"), "insert().select()");
  assert.strictEqual(q.payload.open_to_staff, undefined, "open_to_staff only sent when true");
  done();
});

t("createProject success puts the project in the store", async () => {
  const env = makeEnv({
    query: (q) =>
      q.table === "tk_projects" && q.op === "insert" ? { data: Object.assign({ id: uuid(4242) }, q.payload), error: null } : { data: [], error: null },
  });
  const p = await env.api.createProject({ name: " Year end ", sections: ["Prep", ""] });
  assert.strictEqual(p.name, "Year end");
  same(env.store.getState().projects.map((x) => x.id), [uuid(4242)]);
  assert.strictEqual(env.counts.notify, 0, "projects do not fire the legacy event");
  done();
});

// ---- B4 probe ----------------------------------------------------------------

t("probe: PGRST202 gives missing", async () => {
  const env = makeEnv({ rpc: () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function" } }) });
  assert.strictEqual(await env.api.probe(), "missing");
  assert.strictEqual(env.store.getState().schema, "missing");
  done();
});

t("probe: network trouble stays unknown and retries", async () => {
  let fail = true;
  const env = makeEnv({
    rpc: (name) => {
      if (name !== "tk_schema_version") return { data: null, error: null };
      if (fail) throw new TypeError("Failed to fetch");
      return { data: 1, error: null };
    },
  });
  assert.strictEqual(await env.api.probe(), "unknown");
  assert.strictEqual(env.store.getState().schema, "unknown");
  // A 500 without a missing-function code also stays unknown.
  fail = false;
  await env.advance(30000);
  assert.strictEqual(env.store.getState().schema, "ok", "the retry settled it");
  assert.strictEqual(await env.api.probe(), "ok");
  const probes = env.counts.rpcs.filter((c) => c.name === "tk_schema_version").length;
  await env.api.probe();
  assert.strictEqual(env.counts.rpcs.filter((c) => c.name === "tk_schema_version").length, probes, "ok answers from memory");
  done();
});

t("probe: other errors (500, 42501) stay unknown", async () => {
  const env = makeEnv({ rpc: () => ({ data: null, error: { code: "XX000", message: "internal" } }) });
  assert.strictEqual(await env.api.probe(), "unknown");
  done();
});

t("42703 with the probe ok keeps the original code", async () => {
  const env = makeEnv({
    query: (q) => (q.table === "tk_tasks" ? { data: null, error: { code: "42703", message: "column x does not exist" } } : { data: [], error: null }),
  });
  assert.strictEqual(await env.api.probe(), "ok");
  await assert.rejects(env.api.listMine(ME), (e) => e.code === "42703");
  assert.strictEqual(env.store.getState().schema, "ok");
  assert.ok(env.counts.errors.some((m) => m.indexOf("[TK]") === 0), "logged with [TK]");
  done();
});

t("42703 re-probes and gives tk_schema_missing when tk_schema_version is gone", async () => {
  let gone = false;
  const env = makeEnv({
    rpc: (name) =>
      name === "tk_schema_version"
        ? gone
          ? { data: null, error: { code: "PGRST202", message: "Could not find the function" } }
          : { data: 1, error: null }
        : { data: null, error: null },
    query: (q) => (q.table === "tk_tasks" ? { data: null, error: { code: "42703", message: "column x does not exist" } } : { data: [], error: null }),
  });
  assert.strictEqual(await env.api.probe(), "ok");
  gone = true;
  await env.advance(31000); // past the 30 s re-probe window
  await assert.rejects(env.api.listMine(ME), (e) => e.code === "tk_schema_missing");
  assert.strictEqual(env.store.getState().schema, "missing");
  done();
});

t("re-probe runs at most once per 30 s", async () => {
  const env = makeEnv({
    query: (q) => (q.table === "tk_tasks" ? { data: null, error: { code: "PGRST204", message: "Could not find the 'x' column" } } : { data: [], error: null }),
  });
  await env.api.probe();
  await env.advance(31000);
  await Promise.all([env.api.listMine(ME).catch(() => {}), env.api.listMine(ME).catch(() => {})]);
  await env.api.listMine(ME).catch(() => {});
  assert.strictEqual(env.counts.rpcs.filter((c) => c.name === "tk_schema_version").length, 2, "first probe plus one re-probe");
  done();
});

t("42501 maps to tk_forbidden; PGRST116 to tk_not_found", async () => {
  let code = "42501";
  const env = makeEnv({ query: () => ({ data: null, error: { code, message: "denied" } }) });
  await assert.rejects(env.api.listMine(ME), (e) => e.code === "tk_forbidden");
  code = "PGRST116";
  await assert.rejects(env.api.listMine(ME), (e) => e.code === "tk_not_found");
  done();
});

t("listMine: my rows by assignee only, plus open Unassigned rows, and the 12-month done window (S8b)", async () => {
  const shared = row();
  const env = makeEnv({
    query: (q) =>
      q.ops.some((o) => o[0] === "is" && o[1] === "assignee_email")
        ? { data: [shared, row({ assignee_email: null })], error: null }
        : { data: [row(), shared], error: null },
  });
  const rows = await env.api.listMine(ME);
  assert.strictEqual(rows.length, 3); // the row in both answers counts once
  assert.ok(rows.some((r) => r.assignee_email === null && r.is_unassigned === true));
  const qs = env.counts.queries.filter((q) => q.table === "tk_tasks");
  const mine = qs.find((q) => q.filters.assignee_email === ME);
  const open = qs.find((q) => q.ops.some((o) => o[0] === "is" && o[1] === "assignee_email" && o[2] === null));
  assert.ok(mine && open);
  const ors = mine.ops.filter((o) => o[0] === "or").map((o) => o[1]);
  assert.strictEqual(ors.length, 1);
  assert.ok(ors[0].indexOf("done.eq.false,completed_at.gte.") === 0);
  assert.ok(!ors.some((x) => x.indexOf("staff_email") >= 0), "the owner never stands in for the assignee");
  assert.strictEqual(open.filters.done, false);
  const before = env.counts.queries.length;
  await env.api.listMine(ME, { showOlder: true });
  const q2 = env.counts.queries.slice(before).find((q) => q.filters.assignee_email === ME);
  assert.strictEqual(q2.ops.filter((o) => o[0] === "or").length, 0);
  done();
});

t("normalize keeps a null assignee and sets is_unassigned (S8b)", () => {
  const env = makeEnv();
  const t1 = env.api.normalize(row({ assignee_email: null, staff_email: ME }));
  assert.strictEqual(t1.assignee_email, null);
  assert.strictEqual(t1.is_unassigned, true);
  const t2 = env.api.normalize(row({ assignee_email: "ME@Example.test" }));
  assert.strictEqual(t2.assignee_email, ME);
  assert.strictEqual(t2.is_unassigned, false);
  done();
});

t("the mine list holds my tasks and open Unassigned ones, not others' (S8b)", () => {
  const mineT = task();
  const un = task({ assignee_email: null, staff_email: OTHER });
  const unDone = task({ assignee_email: null, staff_email: OTHER, status: "done", done: true });
  const other = task({ assignee_email: OTHER, staff_email: ME });
  let s = reduceAll(null, [{ type: "me", email: ME }, { type: "listLoaded", key: "mine", tasks: [] }]);
  [mineT, un, unDone, other].forEach((x) => { s = S.TK_reduce(s, { type: "upsert", task: x }); });
  const ids = S.TK_selectList(s, "mine").tasks.map((x) => x.id);
  assert.ok(ids.indexOf(mineT.id) >= 0);
  assert.ok(ids.indexOf(un.id) >= 0);
  assert.ok(ids.indexOf(unDone.id) < 0);
  assert.ok(ids.indexOf(other.id) < 0, "owning a task someone else is on doesn't make it mine");
  done();
});

t("normalize keeps exactly the Task shape", () => {
  const env = makeEnv();
  const t1 = env.api.normalize(Object.assign(row(), { search_tsv: "x", deleted_by: "y", status_before_wait: "todo" }));
  assert.strictEqual(t1.search_tsv, undefined);
  assert.strictEqual(t1.deleted_by, undefined);
  assert.ok("waiting_minutes" in t1 && "series_id" in t1);
  done();
});

// ---- P4-3: bulk actions + undo (schema 12) -----------------------------------

// Schema 12 env: rpc answers come from `answers[name]` (a value or a function
// of args); queries return the rows in `rows` matching an .in("id", …).
async function bulkEnv(answers, rowsById) {
  const a = answers || {};
  const rows = rowsById || {};
  const env = makeEnv({
    rpc: (name, args) => {
      if (name === "tk_schema_version") return { data: 12, error: null };
      const v = a[name];
      if (typeof v === "function") return v(args);
      if (v && v.error) return v;
      return { data: v === undefined ? null : v, error: null };
    },
    query: (q) => {
      if (q.table !== "staff_reminders") return { data: [], error: null };
      const inOp = q.ops.find((o) => o[0] === "in");
      if (inOp) return { data: inOp[2].map((id) => rows[id]).filter(Boolean), error: null };
      if (q.single === "maybeSingle") return { data: rows[q.filters.id] || null, error: null };
      return { data: [], error: null };
    },
  });
  env.store.dispatch({ type: "me", email: ME });
  env.ctx.TK_ixUndoCheck = require("./TK_viewLogic.js").TK_ixUndoCheck;
  await env.api.probe();
  return env;
}

t("bulk: bulkReady needs schema 12; version 1 stays on the old paths", async () => {
  const old = makeEnv();
  await old.api.probe();
  assert.strictEqual(old.api.bulkReady(), false);
  assert.strictEqual(old.api.schemaVersion(), 1);
  const env = await bulkEnv();
  assert.strictEqual(env.api.bulkReady(), true);
  assert.strictEqual(env.api.schemaVersion(), 12);
  done();
});

t("bulk: a single tick goes through tk_bulk_complete and offers Undo", async () => {
  const x = row();
  const doneRow = Object.assign({}, x, { status: "done", done: true, updated_at: "2026-10-11T15:00:00Z" });
  const env = await bulkEnv({ tk_bulk_complete: { op_id: "op-1", done: [x.id], review: [], skipped: [], spawned: [] } }, { [x.id]: doneRow });
  env.store.dispatch({ type: "listLoaded", key: "mine", tasks: [env.api.normalize(x)] });
  const r = await env.api.complete(env.api.normalize(x), { done: true });
  assert.strictEqual(r.status, "done");
  assert.strictEqual(r.opId, "op-1");
  const calls = env.counts.rpcs.filter((c) => c.name === "tk_bulk_complete");
  assert.strictEqual(calls.length, 1);
  same(calls[0].args.p_ids, [x.id]);
  assert.strictEqual(env.counts.rpcs.filter((c) => c.name === "tk_set_status").length, 0);
  const toasts = env.events("mgb:toast");
  assert.strictEqual(toasts.length, 1);
  assert.strictEqual(toasts[0].detail.text, "Done.");
  assert.strictEqual(toasts[0].detail.action.label, "Undo");
  assert.ok(toasts[0].detail.key);
  assert.ok(env.api.liveUndo(), "the undo is live");
  assert.strictEqual(env.store.getState().tasks[x.id].done, true);
  same(env.store.getState().pending, {});
  done();
});

t("bulk: a skipped single tick rolls back and rejects tk_skipped with the reason", async () => {
  const x = row({ status: "in_progress" });
  const env = await bulkEnv({ tk_bulk_complete: { op_id: null, done: [], review: [], skipped: [{ id: x.id, reason: "no_access" }], spawned: [] } }, { [x.id]: x });
  env.store.dispatch({ type: "listLoaded", key: "mine", tasks: [env.api.normalize(x)] });
  await assert.rejects(env.api.complete(env.api.normalize(x), { done: true }), (e) => e.code === "tk_skipped" && e.reason === "no_access");
  await flush();
  const s = env.store.getState();
  assert.strictEqual(s.tasks[x.id].status, "in_progress");
  same(s.pending, {});
  assert.strictEqual(env.events("mgb:toast").length, 0, "the caller toasts the reason");
  done();
});

t("bulk: waiting and review rows keep the old tk_set_status path", async () => {
  const x = row({ status: "waiting_client" });
  const env = await bulkEnv({ tk_set_status: null }, { [x.id]: Object.assign({}, x, { status: "in_progress" }) });
  env.store.dispatch({ type: "upsert", task: env.api.normalize(x) });
  await env.api.complete(env.api.normalize(x), { done: true }).catch(() => null);
  assert.strictEqual(env.counts.rpcs.filter((c) => c.name === "tk_bulk_complete").length, 0);
  done();
});

t("bulk: bulkRun reports done, review and skipped, never silently", async () => {
  const a = row();
  const b = row();
  const c = row({ status: "waiting_client" });
  const env = await bulkEnv(
    { tk_bulk_complete: { op_id: "op-2", done: [a.id], review: [b.id], skipped: [{ id: c.id, reason: "waiting_client" }], spawned: [] } },
    { [a.id]: a, [b.id]: b, [c.id]: c },
  );
  const r = await env.api.bulkRun("complete", [a.id, b.id, c.id, a.id]);
  same(env.counts.rpcs.filter((x) => x.name === "tk_bulk_complete")[0].args.p_ids, [a.id, b.id, c.id], "ids are de-duplicated");
  assert.strictEqual(r.skipped.length, 1);
  assert.strictEqual(r.skipped[0].reason, "waiting_client");
  const toast = env.events("mgb:toast").pop();
  assert.ok(/1 skipped/.test(toast.detail.text), toast.detail.text);
  assert.strictEqual(toast.detail.action.label, "Undo");
  const reread = env.counts.queries.filter((q) => q.ops.some((o) => o[0] === "in"));
  assert.strictEqual(reread.length, 1, "one batched re-read");
  done();
});

t("bulk: more than 100 ids rejects tk_too_many without a request", async () => {
  const env = await bulkEnv();
  const ids = [];
  for (let i = 0; i < 101; i++) ids.push(uuid(i + 500));
  await assert.rejects(env.api.bulkRun("delete", ids), (e) => e.code === "tk_too_many");
  assert.strictEqual(env.counts.rpcs.filter((x) => x.name === "tk_bulk_delete").length, 0);
  done();
});

t("bulk: bulkUpdate takes exactly one field and lowercases the email", async () => {
  const x = row();
  const env = await bulkEnv({ tk_bulk_update: { op_id: "op-3", kind: "reassign", done: [x.id], skipped: [] } }, { [x.id]: x });
  await assert.rejects(env.api.bulkUpdate([x.id], { due_date: null, project_id: null }), (e) => e.code === "tk_bad_patch");
  await env.api.bulkUpdate([x.id], { assignee_email: "Ann@Example.com" });
  const call = env.counts.rpcs.filter((c) => c.name === "tk_bulk_update")[0];
  same(call.args.p_patch, { assignee_email: "ann@example.com" });
  done();
});

t("bulk: the live undo expires after 10 s", async () => {
  const x = row();
  const env = await bulkEnv({ tk_bulk_delete: { op_id: "op-4", done: [x.id], skipped: [] } }, { [x.id]: x });
  await env.api.bulkRun("delete", [x.id]);
  assert.ok(env.api.liveUndo());
  await env.advance(9000);
  assert.ok(env.api.liveUndo(), "still live at 9 s");
  await env.advance(1500);
  assert.strictEqual(env.api.liveUndo(), null, "gone after 10 s");
  assert.strictEqual(await env.api.undoLive(), null, "nothing to undo");
  assert.strictEqual(env.counts.rpcs.filter((c) => c.name === "tk_undo").length, 0);
  done();
});

t("bulk: undoLive calls tk_undo once, closes the toast and says what happened", async () => {
  const x = row();
  const env = await bulkEnv(
    {
      tk_bulk_delete: { op_id: "op-5", done: [x.id], skipped: [] },
      tk_undo: { op_id: "op-5", kind: "delete", done: [x.id], skipped: [], spawned_removed: 0, spawned_kept: [], emails_cancelled: 0, already_emailed: [] },
    },
    { [x.id]: x },
  );
  await env.api.bulkRun("delete", [x.id]);
  const key = env.events("mgb:toast").pop().detail.key;
  const p1 = env.api.undoLive();
  const p2 = env.api.undoLive();
  const [r1] = await Promise.all([p1, p2]);
  assert.strictEqual(env.counts.rpcs.filter((c) => c.name === "tk_undo").length, 1);
  assert.strictEqual(env.counts.rpcs.filter((c) => c.name === "tk_undo")[0].args.p_op, "op-5");
  assert.strictEqual(r1.done.length, 1);
  assert.ok(env.events("mgb:toast-dismiss").some((e) => e.detail.key === key), "the Undo toast is closed");
  assert.strictEqual(env.events("mgb:toast").pop().detail.text, "Undone.");
  assert.strictEqual(env.api.liveUndo(), null);
  done();
});

t("bulk: an expired undo on the server says it's too late", async () => {
  const x = row();
  const env = await bulkEnv(
    {
      tk_bulk_delete: { op_id: "op-6", done: [x.id], skipped: [] },
      tk_undo: { data: null, error: { code: "22023", message: "tk_undo_expired" } },
    },
    { [x.id]: x },
  );
  await env.api.bulkRun("delete", [x.id]);
  const res = await env.api.undoLive();
  assert.strictEqual(res, null);
  assert.strictEqual(env.events("mgb:toast").pop().detail.text, "Too late to undo that one.");
  done();
});

t("bulk: a newer action replaces the live undo and closes the older toast", async () => {
  const a = row();
  const b = row();
  let n = 0;
  const env = await bulkEnv(
    { tk_bulk_delete: (args) => ({ data: { op_id: "op-" + ++n, done: args.p_ids, skipped: [] }, error: null }) },
    { [a.id]: a, [b.id]: b },
  );
  await env.api.bulkRun("delete", [a.id]);
  const first = env.events("mgb:toast").pop().detail.key;
  await env.api.bulkRun("delete", [b.id]);
  assert.ok(env.events("mgb:toast-dismiss").some((e) => e.detail.key === first));
  assert.strictEqual(env.api.liveUndo().opId, "op-2");
  done();
});

t("bulk: remove goes through tk_bulk_delete with an Undo toast", async () => {
  const x = row();
  const env = await bulkEnv({ tk_bulk_delete: { op_id: "op-7", done: [x.id], skipped: [] } }, { [x.id]: Object.assign({}, x, { deleted_at: "2026-10-11T15:00:00Z" }) });
  env.store.dispatch({ type: "upsert", task: env.api.normalize(x) });
  await env.api.remove(x.id, { toast: "Task deleted." });
  assert.strictEqual(env.counts.rpcs.filter((c) => c.name === "tk_bulk_delete").length, 1);
  const toast = env.events("mgb:toast").pop();
  assert.strictEqual(toast.detail.text, "Task deleted.");
  assert.strictEqual(toast.detail.action.label, "Undo");
  assert.strictEqual(env.counts.queries.filter((q) => q.op === "update").length, 0, "no direct soft-delete write");
  done();
});

t("bulk: a single skipped delete rejects tk_skipped", async () => {
  const x = row();
  const env = await bulkEnv({ tk_bulk_delete: { op_id: null, done: [], skipped: [{ id: x.id, reason: "no_access" }] } }, { [x.id]: x });
  await assert.rejects(env.api.remove(x.id, { toast: "Task deleted." }), (e) => e.code === "tk_skipped");
  assert.strictEqual(env.events("mgb:toast").length, 0);
  done();
});

t("bulk: reassign on schema 12 uses tk_bulk_update with an Undo toast", async () => {
  const x = row();
  const env = await bulkEnv({ tk_bulk_update: { op_id: "op-8", kind: "reassign", done: [x.id], skipped: [] } }, { [x.id]: Object.assign({}, x, { assignee_email: OTHER }) });
  env.store.dispatch({ type: "upsert", task: env.api.normalize(x) });
  await env.api.reassign(x.id, OTHER, { toast: "Reassigned." });
  same(env.counts.rpcs.filter((c) => c.name === "tk_bulk_update")[0].args.p_patch, { assignee_email: OTHER });
  assert.strictEqual(env.events("mgb:toast").pop().detail.action.label, "Undo");
  done();
});

t("bulk: offline bulk calls reject tk_offline without a request", async () => {
  const env = await bulkEnv();
  env.ctx.navigator.onLine = false;
  await assert.rejects(env.api.bulkRun("complete", [uuid(900)]), (e) => e.code === "tk_offline");
  assert.strictEqual(env.counts.rpcs.filter((c) => c.name === "tk_bulk_complete").length, 0);
  done();
});

// ===========================================================================
// Slate app flag (S1): localStorage preview and classic plus tk_settings
// ===========================================================================

function slateEnv(opts) {
  const o = opts || {};
  const lsData = Object.assign({}, o.ls || {});
  const calls = { queries: [] };
  const client = o.noClient
    ? null
    : {
        from(table) {
          calls.queries.push({ table });
          const q = {
            select() {
              return q;
            },
            eq(col, val) {
              calls.queries[calls.queries.length - 1].eq = [col, val];
              return q;
            },
            maybeSingle() {
              if (o.throwSync) throw new Error("sync boom");
              if (o.reject) return Promise.reject(new Error("network"));
              if (o.error) return Promise.resolve({ data: null, error: { message: "denied" } });
              return Promise.resolve({ data: o.row === undefined ? null : o.row, error: null });
            },
          };
          return q;
        },
      };
  const flag = S.TK_createSlateFlag({
    ls: (k) => {
      if (o.lsThrows) throw new Error("storage blocked");
      return Object.prototype.hasOwnProperty.call(lsData, k) ? lsData[k] : null;
    },
    sb: () => client,
  });
  return { flag, lsData, calls };
}

t("slate flag: starts off and unknown", () => {
  const { flag } = slateEnv();
  assert.deepStrictEqual(flag.getState(), { setting: undefined, appFlagKnown: false, appOn: false });
  done();
});

t("slate flag: the preview shows at once, still unknown until the read", () => {
  const { flag } = slateEnv({ ls: { mgb_slate_app_preview: "1" } });
  assert.deepStrictEqual(flag.getState(), { setting: undefined, appFlagKnown: false, appOn: true });
  done();
});

t("slate flag: classic is known off at once", () => {
  const { flag } = slateEnv({ ls: { mgb_slate_app_preview: "1", mgb_slate_classic: "1" } });
  assert.deepStrictEqual(flag.getState(), { setting: undefined, appFlagKnown: true, appOn: false });
  const other = slateEnv({ ls: { mgb_slate_classic: "true" } }); // only "1" counts
  assert.strictEqual(other.flag.getState().appFlagKnown, false);
  done();
});

t("slate flag: callers share one in-flight read", async () => {
  const e = slateEnv({ row: { value: true } });
  const a = e.flag.readSlateAppFlag();
  const b = e.flag.readSlateAppFlag();
  assert.strictEqual(a, b);
  await a;
  assert.strictEqual(e.calls.queries.length, 1);
  const c = e.flag.readSlateAppFlag(); // finished: a new read
  assert.notStrictEqual(c, a);
  await c;
  assert.strictEqual(e.calls.queries.length, 2);
  // a read that finishes synchronously (no client) never sticks
  const n = slateEnv({ noClient: true });
  const p1 = n.flag.readSlateAppFlag();
  const p2 = n.flag.readSlateAppFlag();
  assert.notStrictEqual(p1, p2);
  await Promise.all([p1, p2]);
  done();
});

t("slate flag: reads tk_settings.slate_app_enabled", async () => {
  const e = slateEnv({ row: { value: true } });
  const r = await e.flag.readSlateAppFlag();
  assert.deepStrictEqual(r, { appOn: true, appFlagKnown: true });
  assert.deepStrictEqual(e.calls.queries[0], { table: "tk_settings", eq: ["key", "slate_app_enabled"] });
  done();
});

t("slate flag: no row, false, or the string on all read as off and known", async () => {
  for (const row of [null, { value: false }, { value: "on" }, { value: "false" }, { value: 0 }]) {
    const r = await slateEnv({ row }).flag.readSlateAppFlag();
    assert.deepStrictEqual(r, { appOn: false, appFlagKnown: true }, JSON.stringify(row));
  }
  for (const v of ["true", 1, { on: true }]) {
    const r = await slateEnv({ row: { value: v } }).flag.readSlateAppFlag();
    assert.deepStrictEqual(r, { appOn: true, appFlagKnown: true }, JSON.stringify(v));
  }
  done();
});

t("slate flag: a read error gives off and known (error, reject, throw, no client)", async () => {
  for (const o of [{ error: true }, { reject: true }, { throwSync: true }, { noClient: true }, { error: true, row: { value: true } }]) {
    const r = await slateEnv(o).flag.readSlateAppFlag();
    assert.deepStrictEqual(r, { appOn: false, appFlagKnown: true }, JSON.stringify(o));
  }
  done();
});

t("slate flag: the preview key turns it on without the firm switch", async () => {
  const e = slateEnv({ ls: { mgb_slate_app_preview: "1" }, row: null });
  assert.strictEqual(e.flag.getState().appOn, true); // computed from localStorage at once
  const r = await e.flag.readSlateAppFlag();
  assert.deepStrictEqual(r, { appOn: true, appFlagKnown: true });
  // a read error still leaves the person's own preview on
  const r2 = await slateEnv({ ls: { mgb_slate_app_preview: "1" }, reject: true }).flag.readSlateAppFlag();
  assert.deepStrictEqual(r2, { appOn: true, appFlagKnown: true });
  // only "1" counts
  const r3 = await slateEnv({ ls: { mgb_slate_app_preview: "true" }, row: null }).flag.readSlateAppFlag();
  assert.strictEqual(r3.appOn, false);
  done();
});

t("slate flag: the classic key wins over the preview and the firm switch", async () => {
  const r = await slateEnv({ ls: { mgb_slate_app_preview: "1", mgb_slate_classic: "1" }, row: { value: true } }).flag.readSlateAppFlag();
  assert.deepStrictEqual(r, { appOn: false, appFlagKnown: true });
  done();
});

t("slate flag: blocked localStorage reads as unset", async () => {
  const r = await slateEnv({ lsThrows: true, row: { value: true } }).flag.readSlateAppFlag();
  assert.deepStrictEqual(r, { appOn: true, appFlagKnown: true }); // the firm switch still applies
  const r2 = await slateEnv({ lsThrows: true, row: null }).flag.readSlateAppFlag();
  assert.deepStrictEqual(r2, { appOn: false, appFlagKnown: true });
  done();
});

t("slate flag: subscribers hear changes once; refresh re-reads localStorage", async () => {
  const e = slateEnv({ row: { value: false } });
  const seen = [];
  const off = e.flag.subscribe((st) => seen.push(Object.assign({}, st)));
  await e.flag.readSlateAppFlag();
  assert.strictEqual(seen.length, 1);
  assert.deepStrictEqual(seen[0], { setting: false, appFlagKnown: true, appOn: false });
  await e.flag.readSlateAppFlag(); // nothing changed: no new emit
  assert.strictEqual(seen.length, 1);
  e.lsData.mgb_slate_app_preview = "1";
  e.flag.refresh();
  assert.strictEqual(seen.length, 2);
  assert.strictEqual(e.flag.getState().appOn, true);
  const same = e.flag.getState();
  e.flag.refresh();
  assert.strictEqual(e.flag.getState(), same); // stable object for useSyncExternalStore
  off();
  e.lsData.mgb_slate_classic = "1";
  e.flag.refresh();
  assert.strictEqual(seen.length, 2);
  assert.strictEqual(e.flag.getState().appOn, false);
  done();
});

t("slate flag: the default singleton exists and survives no window (node)", async () => {
  assert.strictEqual(typeof S.TK_readSlateAppFlag, "function");
  const r = await S.TK_readSlateAppFlag();
  assert.deepStrictEqual(r, { appOn: false, appFlagKnown: true });
  done();
});

// ---- Slate app interactions: copy, client-side undo steps, Slate undo window --

t("slate ix: the undo window is 10 s outside the Slate app and 9 min inside it", async () => {
  const x = row();
  const env = await bulkEnv({ tk_bulk_delete: { op_id: "op-s1", done: [x.id], skipped: [] } }, { [x.id]: x });
  await env.api.bulkRun("delete", [x.id]);
  await env.advance(11000);
  assert.strictEqual(env.api.liveUndo(), null, "portal / preview off: 10 s as before");
  env.ctx.TK_slateInApp = () => true;
  await env.api.bulkRun("delete", [x.id]);
  await env.advance(8 * 60 * 1000);
  assert.ok(env.api.liveUndo(), "Slate app: Cmd+Z still undoes the last action after 8 min");
  await env.advance(61 * 1000 + 1000);
  assert.strictEqual(env.api.liveUndo(), null, "gone after 9 min (server keeps 10)");
  done();
});

t("slate undo stack: newest first, limit 5 drops the oldest, portal keeps one", async () => {
  const env = await bulkEnv();
  const ran = [];
  const offer = (n) => env.api.offerUndoRun("Moved " + n + ".", () => { ran.push(n); return Promise.resolve("Back " + n + "."); });
  offer(0);
  offer(1);
  assert.strictEqual(env.api.undoDepth(), 1, "portal / preview off: a single undo");
  env.ctx.TK_slateInApp = () => true;
  for (let i = 2; i <= 8; i++) offer(i);
  assert.strictEqual(env.api.undoDepth(), 5, "limit 5; oldest dropped");
  for (let i = 0; i < 5; i++) await env.api.undoLive();
  assert.deepStrictEqual(ran, [8, 7, 6, 5, 4], "newest first");
  assert.strictEqual(env.api.liveUndo(), null);
  assert.strictEqual(await env.api.undoLive(), null, "nothing left");
  done();
});

t("slate undo stack: each step expires on its own clock", async () => {
  const env = await bulkEnv();
  env.ctx.TK_slateInApp = () => true;
  const ran = [];
  env.api.offerUndoRun("A", () => { ran.push("A"); return Promise.resolve("a"); });
  await env.advance(5 * 60 * 1000);
  env.api.offerUndoRun("B", () => { ran.push("B"); return Promise.resolve("b"); });
  await env.advance(5 * 60 * 1000); // A is 10 min old (past 9), B is 5 min old
  assert.strictEqual(env.api.undoDepth(), 1);
  await env.api.undoLive();
  assert.deepStrictEqual(ran, ["B"]);
  assert.strictEqual(env.api.liveUndo(), null);
  done();
});

t("slate undo stack: a failed step is consumed, the others stay in order", async () => {
  const env = await bulkEnv();
  env.ctx.TK_slateInApp = () => true;
  const ran = [];
  env.api.offerUndoRun("A", () => { ran.push("A"); return Promise.resolve("a"); });
  env.api.offerUndoRun("B", () => Promise.reject(new Error("x")));
  env.api.offerUndoRun("C", () => { ran.push("C"); return Promise.resolve("c"); });
  await env.api.undoLive();
  await env.api.undoLive();
  assert.strictEqual(env.events("mgb:toast").pop().detail.text, "Couldn't undo that. Try again.");
  assert.strictEqual(env.api.undoDepth(), 1);
  await env.api.undoLive();
  assert.deepStrictEqual(ran, ["C", "A"]);
  done();
});

t("slate undo stack: an offline failure keeps the step where it was", async () => {
  const env = await bulkEnv();
  env.ctx.TK_slateInApp = () => true;
  env.api.offerUndoRun("A", () => Promise.resolve("a"));
  let first = true;
  env.api.offerUndoRun("B", () => {
    if (first) { first = false; return Promise.reject({ reason: "tk_offline" }); }
    return Promise.resolve("b");
  });
  await env.api.undoLive();
  assert.strictEqual(env.api.undoDepth(), 2, "kept after offline");
  await env.api.undoLive();
  assert.strictEqual(env.events("mgb:toast").pop().detail.text, "b");
  assert.strictEqual(env.api.undoDepth(), 1);
  done();
});

t("slate ix: copyTasks sends ids + target, re-reads copies and subtasks", async () => {
  const a = row();
  const c1 = row({ text: "copy" });
  const s1 = row({ text: "sub copy", parent_id: c1.id });
  const env = await bulkEnv(
    { tk_copy_tasks: { copies: [{ source: a.id, id: c1.id, subtasks: [s1.id] }], skipped: [] } },
    { [c1.id]: c1, [s1.id]: s1 },
  );
  const r = await env.api.copyTasks([a.id, a.id], { section: "Wrap up", bogus: 1 });
  const call = env.counts.rpcs.filter((c) => c.name === "tk_copy_tasks")[0];
  same(call.args.p_ids, [a.id]);
  same(call.args.p_target, { section: "Wrap up" });
  same(r.copies, [{ source: a.id, id: c1.id, subtasks: [s1.id] }]);
  assert.ok(env.store.getState().tasks[c1.id], "the copy is in the store");
  assert.ok(env.store.getState().tasks[s1.id], "its subtask too");
  await env.api.copyTasks([a.id], null);
  assert.strictEqual(env.counts.rpcs.filter((c) => c.name === "tk_copy_tasks")[1].args.p_target, null, "duplicate = no target");
  const many = [];
  for (let i = 0; i < 51; i++) many.push(uuid(i + 900));
  await assert.rejects(env.api.copyTasks(many), (e) => e.code === "tk_too_many");
  done();
});

t("slate ix: copyRun toasts Duplicated with Undo; undo archives copies + subtasks via tk_bulk_delete", async () => {
  const a = row();
  const c1 = row();
  const s1 = row({ parent_id: c1.id });
  const env = await bulkEnv(
    {
      tk_copy_tasks: { copies: [{ source: a.id, id: c1.id, subtasks: [s1.id] }], skipped: [] },
      tk_bulk_delete: (args) => ({ data: { op_id: "op-del", done: args.p_ids, skipped: [] }, error: null }),
    },
    { [c1.id]: c1, [s1.id]: s1 },
  );
  await env.api.copyRun([a.id], null);
  const toast = env.events("mgb:toast").pop();
  assert.strictEqual(toast.detail.text, "Duplicated.");
  assert.strictEqual(toast.detail.action.label, "Undo");
  assert.strictEqual(env.counts.rpcs.filter((c) => c.name === "tk_undo").length, 0);
  await env.api.undoLive();
  const del = env.counts.rpcs.filter((c) => c.name === "tk_bulk_delete");
  assert.strictEqual(del.length, 1);
  same(del[0].args.p_ids, [c1.id, s1.id]);
  assert.strictEqual(env.events("mgb:toast").pop().detail.text, "Undone.");
  assert.strictEqual(env.api.liveUndo(), null, "used once");
  assert.ok(!env.counts.rpcs.some((c) => /notify|email/i.test(c.name)), "no notification calls");
  done();
});

t("slate ix: paste of several with a skip says so; nothing copied offers no Undo", async () => {
  const a = row();
  const b = row();
  const c1 = row();
  const c2 = row();
  let answer = { copies: [{ source: a.id, id: c1.id, subtasks: [] }, { source: b.id, id: c2.id, subtasks: [] }], skipped: [{ id: "x", reason: "other_client" }] };
  const env = await bulkEnv({ tk_copy_tasks: () => ({ data: answer, error: null }) }, { [c1.id]: c1, [c2.id]: c2 });
  await env.api.copyRun([a.id, b.id, "x"], { section: "S" });
  assert.strictEqual(env.events("mgb:toast").pop().detail.text, "Pasted 2 tasks. 1 skipped.");
  answer = { copies: [], skipped: [{ id: a.id, reason: "other_client" }] };
  env.ctx.TK_copySkipText = () => "Tasks stay with their own client.";
  await env.api.copyRun([a.id], { client_id: "C2" });
  const last = env.events("mgb:toast").pop();
  assert.strictEqual(last.detail.text, "Tasks stay with their own client.");
  assert.strictEqual(last.detail.action, null);
  assert.strictEqual(env.api.liveUndo(), null);
  done();
});

t("slate ix: offerUndoRun runs the client step once; a throw says it couldn't", async () => {
  const env = await bulkEnv();
  let runs = 0;
  env.api.offerUndoRun("Moved to Wrap up.", () => {
    runs++;
    return Promise.resolve("Moved back.");
  });
  assert.strictEqual(env.events("mgb:toast").pop().detail.action.label, "Undo");
  await Promise.all([env.api.undoLive(), env.api.undoLive()]);
  assert.strictEqual(runs, 1);
  assert.strictEqual(env.events("mgb:toast").pop().detail.text, "Moved back.");
  env.api.offerUndoRun("Moved.", () => Promise.reject(new Error("x")));
  await env.api.undoLive();
  assert.strictEqual(env.events("mgb:toast").pop().detail.text, "Couldn't undo that. Try again.");
  done();
});

t("slate ix: a late Undo of a duplicate refuses when the copy changed since; a deleted copy is skipped", async () => {
  const a = row();
  const c1 = row({ updated_at: "2026-10-23T14:00:00.000001Z" });
  const c2 = row({ updated_at: "2026-10-23T14:00:00.000002Z" });
  const rows = { [c1.id]: c1, [c2.id]: c2 };
  const env = await bulkEnv(
    {
      tk_copy_tasks: { copies: [{ source: a.id, id: c1.id, subtasks: [] }], skipped: [] },
      tk_bulk_delete: (args) => ({ data: { op_id: "op-del", done: args.p_ids, skipped: [] }, error: null }),
    },
    rows,
  );
  await env.api.copyRun([a.id], null);
  // someone renamed the copy after it was made (server stamp moved on)
  rows[c1.id] = Object.assign({}, c1, { text: "renamed", updated_at: "2026-10-23T14:03:00.5+00:00" });
  await env.api.undoLive();
  assert.strictEqual(env.counts.rpcs.filter((c) => c.name === "tk_bulk_delete").length, 0, "nothing archived");
  assert.strictEqual(env.events("mgb:toast").pop().detail.text, "Not undone: the copy was changed since. Delete it yourself if you don't need it.");
  assert.strictEqual(env.store.getState().tasks[c1.id].text, "renamed", "the store took the server copy");

  // same stamp spelled differently still undoes; an already deleted copy is left out
  const env2 = await bulkEnv(
    {
      tk_copy_tasks: { copies: [{ source: a.id, id: c1.id, subtasks: [c2.id] }], skipped: [] },
      tk_bulk_delete: (args) => ({ data: { op_id: "op-del", done: args.p_ids, skipped: [] }, error: null }),
    },
    { [c1.id]: c1, [c2.id]: c2 },
  );
  await env2.api.copyRun([a.id], null);
  c1.updated_at = "2026-10-23T14:00:00.000001+00:00";
  c2.deleted_at = "2026-10-23T14:02:00Z";
  await env2.api.undoLive();
  const del = env2.counts.rpcs.filter((c) => c.name === "tk_bulk_delete");
  assert.strictEqual(del.length, 1);
  same(del[0].args.p_ids, [c1.id]);
  assert.strictEqual(env2.events("mgb:toast").pop().detail.text, "Undone.");
  done();
});

t("slate ix: undoCheck fails closed when the checker is missing; no stamps checks nothing", async () => {
  const c1 = row();
  const env = await bulkEnv({}, { [c1.id]: c1 });
  delete env.ctx.TK_ixUndoCheck;
  const chk = await env.api.undoCheck({ [c1.id]: c1.updated_at });
  same(chk.changed, [c1.id]);
  same(await env.api.undoCheck({}), { changed: [], gone: [] });
  done();
});

t("slate ix: manualReorder hands back the server stamp a late move Undo checks against", async () => {
  const x = row({ section: "Prep" });
  const env = await bulkEnv({
    tk_manual_reorder: { sort_key: 2048, rows: [{ id: x.id, sort_key: 2048 }], skipped: 0, section_changed: true, section: "Wrap up", updated_at: "2026-10-23T14:00:00.000009+00:00" },
  });
  env.store.dispatch({ type: "upsert", task: env.api.normalize(x) });
  const r = await env.api.manualReorder({ scope: "mine", id: x.id, setSection: true, section: "Wrap up" });
  assert.strictEqual(r.updatedAt, "2026-10-23T14:00:00.000009+00:00");
  assert.strictEqual(env.store.getState().tasks[x.id].updated_at, "2026-10-23T14:00:00.000009+00:00");
  assert.strictEqual(env.store.getState().tasks[x.id].section, "Wrap up");
  done();
});

// ===========================================================================

(async () => {
  for (const item of queue) {
    try {
      await item.fn();
    } catch (e) {
      console.error("FAIL " + item.name);
      console.error(e);
      process.exit(1);
    }
  }
  console.log(n + " checks passed");
})();
