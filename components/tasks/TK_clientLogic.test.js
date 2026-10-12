// node components/tasks/TK_clientLogic.test.js
const assert = require("assert");
const L = require("./TK_clientLogic.js");
const K = require("./TK_logic.js");
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

const TODAY = "2026-10-11";
function day(offset) {
  return K.TK_addDays(TODAY, offset);
}
let seq = 0;
function task(over) {
  seq++;
  return Object.assign(
    { id: "id" + String(seq).padStart(3, "0"), text: "A task", status: "todo", due_date: null, priority: "normal", kind: "task", sop_section: null, source: null, deleted_at: null },
    over || {},
  );
}

// ---- Words ---------------------------------------------------------------------
t("words: case, hyphens kept, punctuation split", () => {
  assert.deepStrictEqual(L.TK_cdWords("Month-end CLOSE, for W-9s!"), ["month-end", "close", "for", "w-9s"]);
  assert.deepStrictEqual(L.TK_cdWords("Collect the W-9 (vendor) / 1099"), ["collect", "the", "w-9", "vendor", "1099"]);
  assert.deepStrictEqual(L.TK_cdWords("  "), []);
  assert.deepStrictEqual(L.TK_cdWords(null), []);
});

// ---- Page match ------------------------------------------------------------------
t("pageMatch: close", () => {
  assert.strictEqual(L.TK_cdPageMatch(task({ text: "Anything", sop_section: "monthly_close" }), "client-close"), true);
  assert.strictEqual(L.TK_cdPageMatch(task({ text: "Reconcile the September operating account" }), "client-close"), true);
  assert.strictEqual(L.TK_cdPageMatch(task({ text: "Month-end close for Test Church A" }), "client-close"), true);
  assert.strictEqual(L.TK_cdPageMatch(task({ text: "Closet inventory" }), "client-close"), false);
  assert.strictEqual(L.TK_cdPageMatch(task({ text: "Send the giving summary" }), "client-close"), false);
});
t("pageMatch: description-only never matches", () => {
  assert.strictEqual(L.TK_cdPageMatch(task({ text: "Call the treasurer", description: "Reconcile and close the month" }), "client-close"), false);
});
t("pageMatch: bank", () => {
  assert.strictEqual(L.TK_cdPageMatch(task({ text: "Clear the uncategorized bank feed items" }), "bank"), true);
  assert.strictEqual(L.TK_cdPageMatch(task({ text: "Something else", sop_section: "bank_feeds" }), "bank"), true);
  assert.strictEqual(L.TK_cdPageMatch(task({ text: "Something else", sop_section: "payroll" }), "bank"), false);
  assert.strictEqual(L.TK_cdPageMatch(task({ text: "Upload the September receipts" }), "bank"), false);
});
t("pageMatch: documents, reports, payroll, budget, giving, receivables", () => {
  assert.strictEqual(L.TK_cdPageMatch(task({ text: "Upload the September receipts" }), "documents"), true);
  assert.strictEqual(L.TK_cdPageMatch(task({ text: "Get a W-9 from the new vendor" }), "documents"), true);
  assert.strictEqual(L.TK_cdPageMatch(task({ text: "Send the board packet" }), "reports"), true);
  assert.strictEqual(L.TK_cdPageMatch(task({ text: "Anything", sop_section: "reporting" }), "reports"), true);
  assert.strictEqual(L.TK_cdPageMatch(task({ text: "Run payroll for the 15th" }), "payroll"), true);
  assert.strictEqual(L.TK_cdPageMatch(task({ text: "Update the budget" }), "budget"), true);
  assert.strictEqual(L.TK_cdPageMatch(task({ text: "Thank the donors" }), "giving"), true);
  assert.strictEqual(L.TK_cdPageMatch(task({ text: "Follow up on invoice 12" }), "receivables"), true);
});
t("pageMatch: sop matches any non-null sop_section", () => {
  assert.strictEqual(L.TK_cdPageMatch(task({ sop_section: "quirks" }), "sop"), true);
  assert.strictEqual(L.TK_cdPageMatch(task({ sop_section: "access" }), "sop"), true);
  assert.strictEqual(L.TK_cdPageMatch(task({ sop_section: null }), "sop"), false);
});
t("pageMatch: client-settings by source and sop", () => {
  assert.strictEqual(L.TK_cdPageMatch(task({ text: "Anything", source: "access_request" }), "client-settings"), true);
  assert.strictEqual(L.TK_cdPageMatch(task({ text: "Anything", sop_section: "access" }), "client-settings"), true);
  assert.strictEqual(L.TK_cdPageMatch(task({ text: "Anything", source: "manual" }), "client-settings"), false);
});
t("pageMatch: pages without a rule never match", () => {
  const closeish = task({ text: "Reconcile and close the month", sop_section: "monthly_close" });
  ["client-overview", "messages", "milestone", "dashboard", "today", "inbox", "nope", "", null, undefined, "constructor", "__proto__"].forEach((p) => {
    assert.strictEqual(L.TK_cdPageMatch(closeish, p), false, String(p));
  });
  assert.strictEqual(L.TK_cdPageRule("constructor"), null);
  assert.strictEqual(L.TK_cdPageRule("bank"), L.TK_CD_PAGE_RULES.bank);
  assert.strictEqual(L.TK_cdPageMatch(null, "bank"), false);
});
t("page rules only use sop ids that exist", () => {
  Object.keys(L.TK_CD_PAGE_RULES).forEach((page) => {
    (L.TK_CD_PAGE_RULES[page].sops || []).forEach((s) => {
      assert.ok(K.TK_SOP_SECTION_IDS.indexOf(s) >= 0, page + " " + s);
    });
  });
});

// ---- Buckets ---------------------------------------------------------------------
t("bucket: every bucket", () => {
  assert.strictEqual(L.TK_cdBucket(task({ status: "done", done: true }), TODAY), "done");
  assert.strictEqual(L.TK_cdBucket(task({ deleted_at: "2026-10-01T00:00:00Z" }), TODAY), "done");
  assert.strictEqual(L.TK_cdBucket(task({ due_date: day(-3) }), TODAY), "overdue");
  assert.strictEqual(L.TK_cdBucket(task({ due_date: TODAY }), TODAY), "today");
  assert.strictEqual(L.TK_cdBucket(task({ due_date: day(1) }), TODAY), "week");
  assert.strictEqual(L.TK_cdBucket(task({ due_date: day(7) }), TODAY), "week");
  assert.strictEqual(L.TK_cdBucket(task({ due_date: day(8) }), TODAY), "later");
  assert.strictEqual(L.TK_cdBucket(task({ due_date: null }), TODAY), "later");
});
t("bucket: waiting and review beat overdue", () => {
  assert.strictEqual(L.TK_cdBucket(task({ status: "waiting_client", due_date: day(-5) }), TODAY), "waiting");
  assert.strictEqual(L.TK_cdBucket(task({ status: "waiting_client", due_date: day(2) }), TODAY), "waiting");
  assert.strictEqual(L.TK_cdBucket(task({ status: "ready_for_review", due_date: day(-5) }), TODAY), "review");
  assert.strictEqual(L.TK_cdBucket(task({ status: "in_progress", due_date: day(-1) }), TODAY), "overdue");
});

// ---- Groups ------------------------------------------------------------------------
function ids(g) {
  return g.tasks.map((x) => x.id);
}
t("groups: order, empty dropped, labels", () => {
  const tasks = [
    task({ id: "later1", due_date: day(30) }),
    task({ id: "over1", due_date: day(-2) }),
    task({ id: "today1", due_date: TODAY }),
    task({ id: "week1", due_date: day(3) }),
    task({ id: "wait1", status: "waiting_client", due_date: day(2) }),
    task({ id: "rev1", status: "ready_for_review" }),
  ];
  const g = L.TK_cdGroups(tasks, { today: TODAY, page: "client-overview", showDone: false });
  assert.deepStrictEqual(
    g.map((x) => x.id),
    ["overdue", "today", "week", "later", "waiting", "review"],
  );
  assert.deepStrictEqual(
    g.map((x) => x.label),
    ["Overdue", "Today", "This week", "Later", "Waiting on client", "Ready for review"],
  );
  const only = L.TK_cdGroups([task({ due_date: TODAY })], { today: TODAY });
  assert.deepStrictEqual(
    only.map((x) => x.id),
    ["today"],
  );
  assert.deepStrictEqual(L.TK_cdGroups([], { today: TODAY }), []);
  assert.deepStrictEqual(L.TK_cdGroups(null, { today: TODAY }), []);
});
t("groups: a page match moves the task out of its bucket and appears once", () => {
  const rec = task({ id: "rec", text: "Reconcile the September operating account", due_date: day(2) });
  const clo = task({ id: "clo", text: "Month-end close for Test Church A", due_date: TODAY, sop_section: "monthly_close" });
  const oth = task({ id: "oth", text: "Send the giving summary", due_date: day(-3) });
  const wait = task({ id: "wait", text: "Waiting on the client for the missing statement", status: "waiting_client", due_date: day(2) });
  const g = L.TK_cdGroups([rec, clo, oth, wait], { today: TODAY, page: "client-close" });
  assert.strictEqual(g[0].id, "page");
  assert.deepStrictEqual(ids(g[0]), ["clo", "rec"]);
  const all = [];
  g.forEach((x) => x.tasks.forEach((y) => all.push(y.id)));
  assert.strictEqual(all.length, 4);
  assert.strictEqual(new Set(all).size, 4);
  assert.deepStrictEqual(
    g.map((x) => x.id),
    ["page", "overdue", "waiting"],
  );
  // On the bank page the waiting task (its title has "statement") goes to the page group too.
  const b = L.TK_cdGroups([rec, clo, oth, wait], { today: TODAY, page: "bank" });
  assert.strictEqual(b[0].id, "page");
  assert.deepStrictEqual(ids(b[0]), ["rec", "wait"]);
});
t("groups: nothing matches means no empty page group", () => {
  const g = L.TK_cdGroups([task({ text: "Call the treasurer", due_date: TODAY })], { today: TODAY, page: "bank" });
  assert.deepStrictEqual(
    g.map((x) => x.id),
    ["today"],
  );
});
t("groups: done is hidden unless showDone, and never in page", () => {
  const done = task({ id: "d1", text: "Reconcile the August account", status: "done", done: true });
  const open = task({ id: "o1", text: "Reconcile the September account", due_date: TODAY });
  const hidden = L.TK_cdGroups([done, open], { today: TODAY, page: "client-close" });
  assert.deepStrictEqual(
    hidden.map((x) => x.id),
    ["page"],
  );
  assert.deepStrictEqual(ids(hidden[0]), ["o1"]);
  const shown = L.TK_cdGroups([done, open], { today: TODAY, page: "client-close", showDone: true });
  assert.deepStrictEqual(
    shown.map((x) => x.id),
    ["page", "done"],
  );
  assert.deepStrictEqual(ids(shown[0]), ["o1"]);
  assert.deepStrictEqual(ids(shown[1]), ["d1"]);
});
t("groups: notes and deleted are dropped", () => {
  const g = L.TK_cdGroups(
    [task({ id: "n", kind: "note", due_date: TODAY }), task({ id: "x", deleted_at: "2026-10-01T00:00:00Z", due_date: TODAY }), task({ id: "ok", due_date: TODAY })],
    { today: TODAY, showDone: true },
  );
  assert.strictEqual(g.length, 1);
  assert.deepStrictEqual(ids(g[0]), ["ok"]);
});
t("groups: each group is sorted by compareTasks", () => {
  const a = task({ id: "a", due_date: day(5), priority: "normal" });
  const b = task({ id: "b", due_date: day(2), priority: "normal" });
  const c = task({ id: "c", due_date: day(2), priority: "high" });
  const d = task({ id: "d", due_date: day(40) });
  const e = task({ id: "e", due_date: null });
  const g = L.TK_cdGroups([a, b, c, d, e], { today: TODAY });
  assert.deepStrictEqual(ids(g.find((x) => x.id === "week")), ["c", "b", "a"]);
  assert.deepStrictEqual(ids(g.find((x) => x.id === "later")), ["d", "e"]);
});
t("groups: no cap on how many tasks a group holds", () => {
  const many = [];
  for (let i = 0; i < 250; i++) many.push(task({ due_date: day(10 + (i % 5)) }));
  const g = L.TK_cdGroups(many, { today: TODAY });
  assert.strictEqual(g.length, 1);
  assert.strictEqual(g[0].tasks.length, 250);
});

// ---- Summary -------------------------------------------------------------------------
t("summary: counts and next", () => {
  const tasks = [
    task({ id: "w", status: "waiting_client", due_date: day(-9) }),
    task({ id: "r", status: "ready_for_review", due_date: day(-8) }),
    task({ id: "late", due_date: day(-3) }),
    task({ id: "soon", due_date: day(1) }),
    task({ id: "done", status: "done", done: true }),
    task({ id: "note", kind: "note" }),
    task({ id: "gone", deleted_at: "2026-10-01T00:00:00Z" }),
  ];
  const s = L.TK_cdSummary(tasks, TODAY);
  assert.strictEqual(s.open, 4);
  assert.strictEqual(s.overdue, 2); // late, and the in-review task (due in the past); waiting never counts
  assert.strictEqual(s.next.id, "late");
});
t("summary: overdue never counts a waiting task", () => {
  const s = L.TK_cdSummary([task({ status: "waiting_client", due_date: day(-9) })], TODAY);
  assert.strictEqual(s.overdue, 0);
  assert.strictEqual(s.open, 1);
});
t("summary: next falls back to waiting and review", () => {
  const tasks = [task({ id: "r", status: "ready_for_review", due_date: day(4) }), task({ id: "w", status: "waiting_client", due_date: day(2) })];
  const s = L.TK_cdSummary(tasks, TODAY);
  assert.strictEqual(s.next.id, "w");
  assert.strictEqual(s.open, 2);
});
t("summary: null when nothing is open", () => {
  assert.deepStrictEqual(L.TK_cdSummary([], TODAY), { open: 0, overdue: 0, next: null });
  assert.deepStrictEqual(L.TK_cdSummary(null, TODAY), { open: 0, overdue: 0, next: null });
  assert.deepStrictEqual(L.TK_cdSummary([task({ status: "done", done: true })], TODAY), { open: 0, overdue: 0, next: null });
});
t("summary: the page's best task is the strip's next, never a waiting one", () => {
  const rec = task({ id: "rec", text: "Reconcile the September account", due_date: day(2) });
  const oth = task({ id: "oth", text: "Send the giving summary", due_date: day(-3) });
  const wait = task({ id: "wait", text: "Missing bank statement", status: "waiting_client", due_date: day(-9) });
  assert.strictEqual(L.TK_cdSummary([rec, oth, wait], TODAY).next.id, "oth");
  assert.strictEqual(L.TK_cdSummary([rec, oth, wait], TODAY, "client-overview").next.id, "oth");
  assert.strictEqual(L.TK_cdSummary([rec, oth, wait], TODAY, "client-close").next.id, "rec");
  assert.strictEqual(L.TK_cdSummary([rec, oth, wait], TODAY, "bank").next.id, "rec");
  assert.strictEqual(L.TK_cdSummary([oth, wait], TODAY, "bank").next.id, "oth");
  assert.strictEqual(L.TK_cdSummary([rec, oth, wait], TODAY, "documents").next.id, "oth");
});

// ---- Client id and follow acceptance ----------------------------------------------------
t("validClientId", () => {
  assert.strictEqual(L.TK_cdValidClientId("tk-test-a"), true);
  assert.strictEqual(L.TK_cdValidClientId("c_1.2~3"), true);
  assert.strictEqual(L.TK_cdValidClientId("12345"), true);
  assert.strictEqual(L.TK_cdValidClientId(""), false);
  assert.strictEqual(L.TK_cdValidClientId("a b"), false);
  assert.strictEqual(L.TK_cdValidClientId("a/b"), false);
  assert.strictEqual(L.TK_cdValidClientId("a@b.org"), false);
  assert.strictEqual(L.TK_cdValidClientId("a".repeat(100)), true);
  assert.strictEqual(L.TK_cdValidClientId("a".repeat(101)), false);
  [null, undefined, 12, {}, [], true].forEach((v) => assert.strictEqual(L.TK_cdValidClientId(v), false));
});
t("acceptFollow", () => {
  const ids = ["tk-test-a", "grace-community"];
  const ok = { type: "client-focus", clientId: "grace-community", at: 2000 };
  assert.strictEqual(L.TK_cdAcceptFollow(0, ok, ids), true);
  assert.strictEqual(L.TK_cdAcceptFollow(2000, ok, ids), true); // same `at` is not stale
  assert.strictEqual(L.TK_cdAcceptFollow(1000, ok, ids), true);
  assert.strictEqual(L.TK_cdAcceptFollow(undefined, ok, ids), true);
  assert.strictEqual(L.TK_cdAcceptFollow(0, Object.assign({}, ok, { type: "client-ask" }), ids), false);
  assert.strictEqual(L.TK_cdAcceptFollow(0, Object.assign({}, ok, { clientId: "a b" }), ids), false);
  assert.strictEqual(L.TK_cdAcceptFollow(0, Object.assign({}, ok, { clientId: "not-a-client" }), ids), false);
  assert.strictEqual(L.TK_cdAcceptFollow(3000, ok, ids), false); // stale
  assert.strictEqual(L.TK_cdAcceptFollow(0, Object.assign({}, ok, { at: NaN }), ids), false);
  assert.strictEqual(L.TK_cdAcceptFollow(0, Object.assign({}, ok, { at: Infinity }), ids), false);
  assert.strictEqual(L.TK_cdAcceptFollow(0, Object.assign({}, ok, { at: "2000" }), ids), false);
  assert.strictEqual(L.TK_cdAcceptFollow(0, ok, null), false);
  assert.strictEqual(L.TK_cdAcceptFollow(0, ok, "grace-community"), false);
  assert.strictEqual(L.TK_cdAcceptFollow(0, null, ids), false);
  assert.strictEqual(L.TK_cdAcceptFollow(0, "client-focus", ids), false);
});

console.log(n + " checks passed");
