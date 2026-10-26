// Plain node, no framework: `node components/tasks/TK_logic.test.js`.
// Guards the shared Tasks rules (TK_logic.js): statuses and the review gate,
// grouping, dates and business days, quick add, mentions, routes, keys,
// the edit hint, the normalizer and the missing-schema hints.

const assert = require("assert");
const L = require("./TK_logic.js");

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

const TODAY = "2026-10-14"; // a Wednesday
const ME = "me@example.test";
const OTHER = "other@example.test";
let seq = 0;
function task(over) {
  seq++;
  return Object.assign(
    {
      id: "00000000-0000-4000-8000-" + String(seq).padStart(12, "0"),
      text: "Task " + seq,
      status: "todo",
      done: false,
      priority: "normal",
      staff_email: ME,
      assignee_email: ME,
      due_date: null,
      created_at: "2026-10-01T12:00:00.000Z",
      deleted_at: null,
    },
    over || {},
  );
}

// ---- Constants
t("statuses and labels", () => {
  assert.deepStrictEqual(L.TK_STATUSES, ["todo", "in_progress", "waiting_client", "ready_for_review", "done"]);
  L.TK_STATUSES.forEach((s) => assert.ok(L.TK_STATUS_LABELS[s]));
  assert.strictEqual(L.TK_STATUS_LABELS.waiting_client, "Waiting on client");
  assert.deepStrictEqual(L.TK_PRIORITIES, ["high", "normal", "low"]);
  assert.strictEqual(L.TK_SOON_DAYS, 7);
  assert.strictEqual(L.TK_OLD_DONE_MONTHS, 12);
});
t("SOP section ids match app.jsx CLIENT_SOP_SECTIONS", () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "..", "app.jsx"), "utf8");
  const at = src.indexOf("const CLIENT_SOP_SECTIONS = [");
  assert.ok(at >= 0);
  const end = src.indexOf("\n];", at);
  const ids = [];
  const re = /\bid:\s*"([a-z_]+)"/g;
  let m;
  const block = src.slice(at, end);
  while ((m = re.exec(block))) ids.push(m[1]);
  assert.deepStrictEqual(ids, L.TK_SOP_SECTION_IDS);
});
t("copy strings are final", () => {
  assert.strictEqual(L.SLATE_NAME, "Slate");
  assert.strictEqual(L.TK_COPY.setupTitle, "Slate is being set up");
  assert.strictEqual(L.TK_COPY.sentForReview, "Sent for review. An admin will approve it.");
  assert.strictEqual(L.TK_COPY.taskAdded, "Task added.");
  assert.ok(/Work › Slate\.$/.test(L.TK_COPY.setupBody));
  Object.keys(L.TK_COPY).forEach((k) => assert.ok(!/!/.test(L.TK_COPY[k]), k + " has no exclamation mark"));
  assert.strictEqual(Object.keys(L.TK_COPY).length, 39);
  assert.strictEqual(L.TK_COPY.selfReview, "You can't approve your own work. Another admin will review it.");
});

// ---- Status workflow
t("effective status", () => {
  assert.strictEqual(L.TK_effectiveStatus({ status: "in_progress" }), "in_progress");
  assert.strictEqual(L.TK_effectiveStatus({ done: true }), "done");
  assert.strictEqual(L.TK_effectiveStatus({ done: false }), "todo");
  assert.strictEqual(L.TK_effectiveStatus({ status: "bogus", done: true }), "done");
  assert.strictEqual(L.TK_effectiveStatus(null), "todo");
});
t("canTransition matrix (25 pairs) mirrors tk_set_status", () => {
  const S = L.TK_STATUSES;
  let allowed = 0;
  S.forEach((from) =>
    S.forEach((to) => {
      const want = from !== to && !(from === "done" && (to === "waiting_client" || to === "ready_for_review"));
      assert.strictEqual(L.TK_canTransition(from, to), want, from + " -> " + to);
      if (want) allowed++;
    }),
  );
  assert.strictEqual(allowed, 18);
  assert.strictEqual(L.TK_canTransition("todo", "bogus"), false);
  assert.strictEqual(L.TK_canTransition("todo", null), false);
});
t("resolveStatus review gate", () => {
  const gated = task({ review_required: true, status: "in_progress" });
  assert.strictEqual(L.TK_resolveStatus(gated, "done", { isAdmin: false }), "ready_for_review");
  assert.strictEqual(L.TK_resolveStatus(gated, "done", { isAdmin: true }), "ready_for_review"); // s3: admins divert too
  assert.strictEqual(L.TK_resolveStatus(gated, "done", {}), "ready_for_review");
  assert.strictEqual(L.TK_resolveStatus(gated, "waiting_client", { isAdmin: false }), "waiting_client");
  const rfr = task({ review_required: true, status: "ready_for_review" });
  assert.strictEqual(L.TK_resolveStatus(rfr, "done", { isAdmin: false }), "ready_for_review");
  assert.strictEqual(L.TK_resolveStatus(rfr, "done", { isAdmin: true }), "done");
  const own = task({ review_required: true, status: "ready_for_review", assignee_email: "a@x.test", submitted_by: "a@x.test" });
  assert.strictEqual(L.TK_resolveStatus(own, "done", { isAdmin: true, me: "A@x.test" }), "ready_for_review");
  const sub = task({ review_required: true, status: "ready_for_review", assignee_email: "b@x.test", submitted_by: "a@x.test" });
  assert.strictEqual(L.TK_resolveStatus(sub, "done", { isAdmin: true, me: "a@x.test" }), "ready_for_review");
  assert.strictEqual(L.TK_resolveStatus(sub, "done", { isAdmin: true, me: "c@x.test" }), "done");
  const plain = task({ review_required: false });
  assert.strictEqual(L.TK_resolveStatus(plain, "done", { isAdmin: false }), "done");
  const doneGated = task({ review_required: true, status: "done", done: true });
  assert.strictEqual(L.TK_resolveStatus(doneGated, "todo", { isAdmin: false }), "todo");
});
function nexts(tk, isAdmin) {
  return L.TK_nextStatuses(tk, { isAdmin }).map((x) => x.status + ":" + x.label);
}
t("nextStatuses for a non-admin", () => {
  assert.deepStrictEqual(nexts(task({ status: "todo" }), false), [
    "in_progress:In progress", "waiting_client:Waiting on client", "ready_for_review:Ready for review", "done:Done",
  ]);
  assert.deepStrictEqual(nexts(task({ status: "todo", review_required: true }), false), [
    "in_progress:In progress", "waiting_client:Waiting on client", "ready_for_review:Send for review",
  ]);
  assert.deepStrictEqual(nexts(task({ status: "ready_for_review", review_required: true }), false), [
    "todo:To do", "in_progress:In progress", "waiting_client:Waiting on client",
  ]);
  assert.deepStrictEqual(
    L.TK_nextStatuses(task({ status: "ready_for_review", review_required: true }), { isAdmin: false }).map((x) => x.action),
    ["withdraw", "withdraw", "withdraw"],
  );
  assert.deepStrictEqual(nexts(task({ status: "ready_for_review" }), false), [
    "todo:To do", "in_progress:In progress", "waiting_client:Waiting on client",
  ]);
  assert.deepStrictEqual(nexts(task({ status: "done", done: true, review_required: true }), false), [
    "todo:To do", "in_progress:In progress",
  ]);
});
t("nextStatuses for an admin", () => {
  assert.deepStrictEqual(nexts(task({ status: "in_progress", review_required: true }), true), [
    "todo:To do", "waiting_client:Waiting on client", "ready_for_review:Send for review",
  ]);
  assert.deepStrictEqual(nexts(task({ status: "in_progress" }), true), [
    "todo:To do", "waiting_client:Waiting on client", "ready_for_review:Ready for review", "done:Done",
  ]);
  assert.deepStrictEqual(nexts(task({ status: "ready_for_review", review_required: true }), true), [
    "todo:To do", "in_progress:Send back", "waiting_client:Waiting on client", "done:Approve",
  ]);
  const rv = task({ status: "ready_for_review", review_required: true, assignee_email: "a@x.test", submitted_by: "a@x.test" });
  assert.deepStrictEqual(
    L.TK_nextStatuses(rv, { isAdmin: true, me: "b@x.test" }).map((x) => x.status + ":" + x.label + ":" + (x.action || "")),
    ["todo:To do:withdraw", "in_progress:Send back:send_back", "waiting_client:Waiting on client:withdraw", "done:Approve:approve"],
  );
  // Own work: no Approve or Send back, only withdraw moves (M3).
  assert.deepStrictEqual(L.TK_nextStatuses(rv, { isAdmin: true, me: "a@x.test" }).map((x) => x.status + ":" + x.label), [
    "todo:To do", "in_progress:In progress", "waiting_client:Waiting on client",
  ]);
  assert.deepStrictEqual(nexts(task({ status: "done", done: true }), true), ["todo:To do", "in_progress:In progress"]);
});
t("nextStatuses never offers the current status, and from done never waiting_client or ready_for_review", () => {
  [true, false].forEach((isAdmin) =>
    [true, false].forEach((rr) =>
      L.TK_STATUSES.forEach((s) => {
        const tk = task({ status: s, done: s === "done", review_required: rr });
        const list = L.TK_nextStatuses(tk, { isAdmin });
        const ids = list.map((x) => x.status);
        assert.ok(ids.indexOf(s) < 0, "current " + s);
        assert.strictEqual(new Set(ids).size, ids.length, "no duplicates");
        list.forEach((x) => assert.ok(L.TK_canTransition(s, x.status), s + " -> " + x.status));
        if (s === "done") {
          assert.ok(ids.indexOf("waiting_client") < 0);
          assert.ok(ids.indexOf("ready_for_review") < 0);
        }
        // order follows TK_STATUSES
        const idx = ids.map((x) => L.TK_STATUSES.indexOf(x));
        assert.deepStrictEqual(idx.slice().sort((a, b) => a - b), idx);
      }),
    ),
  );
  // legacy row with no status: from done.done
  assert.deepStrictEqual(nexts({ done: true }, false), ["todo:To do", "in_progress:In progress"]);
});

// ---- Predicates
t("isOpen", () => {
  assert.strictEqual(L.TK_isOpen(task()), true);
  assert.strictEqual(L.TK_isOpen(task({ status: "ready_for_review" })), true);
  assert.strictEqual(L.TK_isOpen(task({ status: "waiting_client" })), true);
  assert.strictEqual(L.TK_isOpen(task({ status: "done", done: true })), false);
  assert.strictEqual(L.TK_isOpen(task({ deleted_at: "2026-10-10T00:00:00Z" })), false);
  assert.strictEqual(L.TK_isOpen({ done: true }), false);
  assert.strictEqual(L.TK_isOpen(null), false);
});
t("isMine", () => {
  assert.strictEqual(L.TK_isMine(task(), "ME@Example.test"), true);
  assert.strictEqual(L.TK_isMine(task({ assignee_email: OTHER }), ME), false);
  // S8b: an Unassigned task is nobody's, the owner's included.
  assert.strictEqual(L.TK_isMine(task({ assignee_email: null }), ME), false);
  assert.strictEqual(L.TK_isMine(task({ assignee_email: "", staff_email: OTHER }), ME), false);
  assert.strictEqual(L.TK_isMine(task({ assignee_email: " Me@Example.Test " }), ME), true);
  assert.strictEqual(L.TK_isMine(task(), ""), false);
  assert.strictEqual(L.TK_isMine(task(), null), false);
});
t("assigneeOf: the assignee only, lowercased, or empty (S8b)", () => {
  assert.strictEqual(L.TK_assigneeOf(task({ assignee_email: " Me@Example.Test " })), ME);
  assert.strictEqual(L.TK_assigneeOf(task({ assignee_email: null, staff_email: ME })), "");
  assert.strictEqual(L.TK_assigneeOf(task({ assignee_email: "" })), "");
  assert.strictEqual(L.TK_assigneeOf(null), "");
  assert.strictEqual(L.TK_isUnassigned(task({ assignee_email: null })), true);
  assert.strictEqual(L.TK_isUnassigned(task()), false);
});
t("normalizeTask keeps a null assignee and sets is_unassigned (S8b)", () => {
  const n1 = L.TK_normalizeTask(task({ assignee_email: null, staff_email: "Me@Example.test" }));
  assert.strictEqual(n1.assignee_email, null);
  assert.strictEqual(n1.is_unassigned, true);
  assert.strictEqual(n1.staff_email, ME);
  const n2 = L.TK_normalizeTask(task({ assignee_email: "OTHER@example.test" }));
  assert.strictEqual(n2.assignee_email, OTHER);
  assert.strictEqual(n2.is_unassigned, false);
});
t("groupMyTasks: open Unassigned tasks get their own group, never a time group (S8b)", () => {
  const un = task({ id: "u1", assignee_email: null, staff_email: OTHER, due_date: "2026-10-01", client_id: "c1" });
  const unMine = task({ id: "u2", assignee_email: null, staff_email: ME, due_date: TODAY, client_id: "c2" });
  const unDone = task({ id: "u3", assignee_email: null, staff_email: ME, status: "done", done: true, completed_at: "2026-10-10T00:00:00Z" });
  const unDel = task({ id: "u4", assignee_email: null, deleted_at: "x" });
  const unWait = task({ id: "u5", assignee_email: null, staff_email: OTHER, status: "waiting_client", client_id: "c3" });
  const mine = task({ id: "m1", due_date: "2026-10-01" });
  const list = [un, unMine, unDone, unDel, unWait, mine];
  const g = L.TK_groupMyTasks(list, TODAY, { email: ME });
  assert.deepStrictEqual(g.unassigned.map((x) => x.id).sort(), ["u1", "u2", "u5"]);
  assert.deepStrictEqual(g.overdue.map((x) => x.id), ["m1"]);
  assert.strictEqual(g.today.length, 0);
  assert.strictEqual(g.waiting.length, 0);
  assert.strictEqual(g.done.length, 0);
  // Admins: only the ones they own or on their own book's clients.
  const a = L.TK_groupMyTasks(list, TODAY, { email: ME, isAdmin: true, inMyBook: (id) => id === "c3" });
  assert.deepStrictEqual(a.unassigned.map((x) => x.id).sort(), ["u2", "u5"]);
  const a2 = L.TK_groupMyTasks(list, TODAY, { email: ME, isAdmin: true });
  assert.deepStrictEqual(a2.unassigned.map((x) => x.id), ["u2"]);
});
t("isOverdue excludes waiting, done and deleted", () => {
  assert.strictEqual(L.TK_isOverdue(task({ due_date: "2026-10-13" }), TODAY), true);
  assert.strictEqual(L.TK_isOverdue(task({ due_date: TODAY }), TODAY), false);
  assert.strictEqual(L.TK_isOverdue(task({ due_date: "2026-10-15" }), TODAY), false);
  assert.strictEqual(L.TK_isOverdue(task({ due_date: null }), TODAY), false);
  assert.strictEqual(L.TK_isOverdue(task({ due_date: "2026-10-01", status: "waiting_client" }), TODAY), false);
  assert.strictEqual(L.TK_isOverdue(task({ due_date: "2026-10-01", status: "done", done: true }), TODAY), false);
  assert.strictEqual(L.TK_isOverdue(task({ due_date: "2026-10-01", deleted_at: "x" }), TODAY), false);
  assert.strictEqual(L.TK_isOverdue(task({ due_date: "2026-10-01", status: "ready_for_review" }), TODAY), true);
});
t("isOldDone (D5)", () => {
  const done = (at) => task({ status: "done", done: true, completed_at: at });
  assert.strictEqual(L.TK_isOldDone(done("2025-10-13T12:00:00"), TODAY), true);
  assert.strictEqual(L.TK_isOldDone(done("2025-10-14T12:00:00"), TODAY), false);
  assert.strictEqual(L.TK_isOldDone(done("2026-09-01T12:00:00"), TODAY), false);
  assert.strictEqual(L.TK_isOldDone(task({ status: "done", done: true, updated_at: "2024-01-01T12:00:00" }), TODAY), true);
  assert.strictEqual(L.TK_isOldDone(task({ status: "done", done: true }), TODAY), false);
  assert.strictEqual(L.TK_isOldDone(task({ completed_at: "2020-01-01T12:00:00" }), TODAY), false);
});
t("compareTasks", () => {
  const a = task({ due_date: "2026-10-10" });
  const b = task({ due_date: "2026-10-11", priority: "high" });
  const c = task({ due_date: null, priority: "high" });
  const d = task({ due_date: "2026-10-10", priority: "high" });
  const e = task({ due_date: "2026-10-10", priority: "low" });
  const sorted = [c, e, b, a, d].sort(L.TK_compareTasks).map((x) => x.id);
  assert.deepStrictEqual(sorted, [d.id, a.id, e.id, b.id, c.id]);
  const f = task({ due_date: "2026-10-10", due_at: "2026-10-10T09:00:00Z" });
  const g = task({ due_date: "2026-10-10", due_at: "2026-10-10T08:00:00Z" });
  assert.ok(L.TK_compareTasks(g, f) < 0);
  const h1 = task({ created_at: "2026-01-01T00:00:00Z" });
  const h2 = task({ created_at: "2026-01-02T00:00:00Z" });
  assert.ok(L.TK_compareTasks(h1, h2) < 0);
  const i1 = task({ id: "a", created_at: "x" });
  const i2 = task({ id: "b", created_at: "x" });
  assert.ok(L.TK_compareTasks(i1, i2) < 0);
  assert.strictEqual(L.TK_compareTasks(i1, i1), 0);
});

// ---- Grouping
function ids(list) {
  return list.map((x) => x.text);
}
t("groupMyTasks bucket boundaries d=-1,0,1,7,8 and undated", () => {
  const list = [
    task({ text: "m1", due_date: "2026-10-13" }),
    task({ text: "m30", due_date: "2026-09-14" }),
    task({ text: "d0", due_date: TODAY }),
    task({ text: "d1", due_date: "2026-10-15" }),
    task({ text: "d7", due_date: "2026-10-21" }),
    task({ text: "d8", due_date: "2026-10-22" }),
    task({ text: "none", due_date: null }),
  ];
  const g = L.TK_groupMyTasks(list, TODAY, { email: ME });
  assert.deepStrictEqual(ids(g.overdue), ["m30", "m1"]);
  assert.deepStrictEqual(ids(g.today), ["d0"]);
  assert.deepStrictEqual(ids(g.week), ["d1", "d7"]);
  assert.deepStrictEqual(ids(g.later), ["d8", "none"]);
  assert.deepStrictEqual(g.waiting, []);
  assert.deepStrictEqual(g.done, []);
});
t("groupMyTasks todayGroup=false merges today into week", () => {
  const list = [task({ text: "d0", due_date: TODAY }), task({ text: "d2", due_date: "2026-10-16" })];
  const g = L.TK_groupMyTasks(list, TODAY, { email: ME, todayGroup: false });
  assert.deepStrictEqual(g.today, []);
  assert.deepStrictEqual(ids(g.week), ["d0", "d2"]);
});
t("groupMyTasks waiting overrides date", () => {
  const list = [
    task({ text: "w-past", status: "waiting_client", due_date: "2026-10-01" }),
    task({ text: "w-none", status: "waiting_client" }),
    task({ text: "w-today", status: "waiting_client", due_date: TODAY }),
  ];
  const g = L.TK_groupMyTasks(list, TODAY, { email: ME });
  assert.deepStrictEqual(ids(g.waiting), ["w-past", "w-today", "w-none"]);
  assert.strictEqual(g.overdue.length + g.today.length + g.later.length, 0);
});
t("groupMyTasks ready_for_review stays in its date group", () => {
  const g = L.TK_groupMyTasks([task({ text: "r", status: "ready_for_review", due_date: TODAY })], TODAY, { email: ME });
  assert.deepStrictEqual(ids(g.today), ["r"]);
});
t("groupMyTasks done ordering and old done", () => {
  const list = [
    task({ text: "done-a", status: "done", done: true, completed_at: "2026-10-01T10:00:00Z" }),
    task({ text: "done-b", status: "done", done: true, completed_at: "2026-10-12T10:00:00Z" }),
    task({ text: "done-old", status: "done", done: true, completed_at: "2025-01-01T10:00:00Z" }),
    task({ text: "done-legacy", done: true, status: undefined, completed_at: "2026-10-05T10:00:00Z" }),
  ];
  const g = L.TK_groupMyTasks(list, TODAY, { email: ME });
  assert.deepStrictEqual(ids(g.done), ["done-b", "done-legacy", "done-a"]);
  const g2 = L.TK_groupMyTasks(list, TODAY, { email: ME, showOlder: true });
  assert.deepStrictEqual(ids(g2.done), ["done-b", "done-legacy", "done-a", "done-old"]);
});
t("groupMyTasks excludes not-mine and deleted", () => {
  const list = [
    task({ text: "mine", due_date: TODAY }),
    task({ text: "theirs", due_date: TODAY, assignee_email: OTHER }),
    task({ text: "owned-not-assigned", due_date: TODAY, assignee_email: OTHER, staff_email: ME }),
    task({ text: "assigned-to-me", due_date: TODAY, assignee_email: ME, staff_email: OTHER }),
    task({ text: "deleted", due_date: TODAY, deleted_at: "2026-10-12T00:00:00Z" }),
    task({ text: "deleted-done", status: "done", done: true, completed_at: "2026-10-12T00:00:00Z", deleted_at: "x" }),
  ];
  const g = L.TK_groupMyTasks(list, TODAY, { email: ME });
  assert.deepStrictEqual(ids(g.today).sort(), ["assigned-to-me", "mine"]);
  assert.strictEqual(g.done.length, 0);
});
t("groupMyTasks on a Saturday today counts calendar days", () => {
  const SAT = "2026-10-17";
  const list = [
    task({ text: "fri", due_date: "2026-10-16" }),
    task({ text: "sat", due_date: SAT }),
    task({ text: "sun", due_date: "2026-10-18" }),
    task({ text: "sat+7", due_date: "2026-10-24" }),
    task({ text: "sat+8", due_date: "2026-10-25" }),
  ];
  const g = L.TK_groupMyTasks(list, SAT, { email: ME });
  assert.deepStrictEqual(ids(g.overdue), ["fri"]);
  assert.deepStrictEqual(ids(g.today), ["sat"]);
  assert.deepStrictEqual(ids(g.week), ["sun", "sat+7"]);
  assert.deepStrictEqual(ids(g.later), ["sat+8"]);
});
t("groupMyTasks accepts the Today page form (tasks, { today, email })", () => {
  const list = [task({ text: "o", due_date: "2026-10-01" }), task({ text: "t", due_date: TODAY })];
  const g = L.TK_groupMyTasks(list, { today: TODAY, email: ME });
  assert.deepStrictEqual(ids(g.overdue), ["o"]);
  assert.deepStrictEqual(ids(g.today), ["t"]);
  assert.deepStrictEqual(L.TK_groupMyTasks(null, TODAY, { email: ME }).later, []);
});
t("groupMyTasks Today page vector: overdue, waiting with a past date, rfr due today", () => {
  const list = [
    task({ text: "late", due_date: "2026-10-10" }),
    task({ text: "waiting", status: "waiting_client", due_date: "2026-10-01" }),
    task({ text: "rfr", status: "ready_for_review", due_date: TODAY }),
  ];
  const g = L.TK_groupMyTasks(list, { today: TODAY, email: ME });
  assert.strictEqual(g.overdue.length + g.today.length, 2);
  assert.deepStrictEqual(ids(g.waiting), ["waiting"]);
});

// ---- Due labels
t("dueLabel", () => {
  const lab = (d, today) => L.TK_dueLabel({ due_date: d }, today || TODAY);
  assert.strictEqual(lab(TODAY), "Today");
  assert.strictEqual(lab("2026-10-15"), "Tomorrow");
  assert.strictEqual(lab("2026-10-13"), "Yesterday");
  assert.strictEqual(lab("2026-10-11"), "3 days late");
  assert.strictEqual(lab("2026-10-16"), "Fri");
  assert.strictEqual(lab("2026-10-20"), "Tue");
  assert.strictEqual(lab("2026-10-21"), "Oct 21");
  assert.strictEqual(lab("2027-10-14"), "Oct 14, 2027");
  assert.strictEqual(lab("2027-01-02", "2026-12-30"), "Sat");
  assert.strictEqual(lab("2027-01-08", "2026-12-30"), "Jan 8, 2027");
  assert.strictEqual(lab(null), "");
  assert.strictEqual(lab("not a date"), "");
});

// ---- Dates and business days
t("ymd and day math", () => {
  assert.strictEqual(L.TK_ymd("2026-10-14"), "2026-10-14");
  assert.strictEqual(L.TK_ymd(new Date(2026, 9, 14, 23, 30)), "2026-10-14");
  assert.strictEqual(L.TK_ymd(new Date(2026, 0, 1, 0, 1)), "2026-01-01");
  assert.strictEqual(L.TK_ymd("garbage"), null);
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(L.TK_ymd()));
  assert.strictEqual(L.TK_addDays("2026-10-14", 1), "2026-10-15");
  assert.strictEqual(L.TK_addDays("2026-10-31", 1), "2026-11-01");
  assert.strictEqual(L.TK_addDays("2026-03-08", 1), "2026-03-09"); // US DST start
  assert.strictEqual(L.TK_addDays("2026-11-01", 1), "2026-11-02"); // US DST end
  assert.strictEqual(L.TK_addDays("2026-01-01", -1), "2025-12-31");
  assert.strictEqual(L.TK_addDays("2028-02-28", 1), "2028-02-29");
  assert.strictEqual(L.TK_dayDiff("2026-10-14", "2026-10-21"), 7);
  assert.strictEqual(L.TK_dayDiff("2026-10-14", "2026-10-13"), -1);
  assert.strictEqual(L.TK_dayDiff("2026-03-01", "2026-04-01"), 31);
  assert.ok(isNaN(L.TK_dayDiff("x", "2026-01-01")));
  assert.strictEqual(L.TK_weekday("2026-10-14"), 3);
  assert.strictEqual(L.TK_weekday("2026-10-18"), 0);
  assert.strictEqual(L.TK_addMonths("2026-03-31", -1), "2026-02-28");
  assert.strictEqual(L.TK_addMonths("2026-10-14", -12), "2025-10-14");
});
t("business days (D2 opt-in)", () => {
  assert.strictEqual(L.TK_isBusinessDay("2026-10-16"), true);
  assert.strictEqual(L.TK_isBusinessDay("2026-10-17"), false);
  assert.strictEqual(L.TK_isBusinessDay("2026-10-18"), false);
  assert.strictEqual(L.TK_addBusinessDays("2026-10-16", 1), "2026-10-19"); // Fri + 1 = Mon
  assert.strictEqual(L.TK_addBusinessDays("2026-10-14", 3), "2026-10-19"); // Wed + 3 across a weekend
  assert.strictEqual(L.TK_addBusinessDays("2026-10-17", 1), "2026-10-19"); // Sat + 1 = Mon
  assert.strictEqual(L.TK_addBusinessDays("2026-10-14", 5), "2026-10-21");
  assert.strictEqual(L.TK_addBusinessDays("2026-10-17", 0), "2026-10-19");
  assert.strictEqual(L.TK_addBusinessDays("2026-10-14", 0), "2026-10-14");
  assert.strictEqual(L.TK_nthBusinessDay(2026, 10, 1), "2026-10-01"); // Thu
  assert.strictEqual(L.TK_nthBusinessDay(2026, 10, 3), "2026-10-05");
  assert.strictEqual(L.TK_nthBusinessDay(2026, 11, 1), "2026-11-02"); // Nov 1 is a Sunday
  assert.strictEqual(L.TK_nthBusinessDay(2026, 10, 22), "2026-10-30");
  assert.strictEqual(L.TK_nthBusinessDay(2026, 10, 23), null);
  assert.strictEqual(L.TK_nthBusinessDay(2026, 13, 1), null);
  assert.strictEqual(L.TK_nthBusinessDay(2026, 10, 0), null);
});

// ---- Slugs, handles and mentions
t("slug and handle", () => {
  assert.strictEqual(L.TK_slug("Example Church"), "example-church");
  assert.strictEqual(L.TK_slug("  St. Mark's & Co. "), "st-mark-s-co");
  assert.strictEqual(L.TK_slug("Iglesia Ejemplo José"), "iglesia-ejemplo-jose");
  assert.strictEqual(L.TK_slug(null), "");
  assert.strictEqual(L.TK_handleOf("Sierra.Lima@Example.test"), "sierra.lima");
  assert.strictEqual(L.TK_handleOf(""), "");
});
t("mentionTokens matches the SQL tk_parse_mentions rule", () => {
  const v = [
    ["hi @sierra", ["sierra"]],
    ["@Sierra.Lima, see this", ["sierra.lima"]],
    ["mail a@b.test now", []],
    ["@a is too short", []],
    ["thanks @al. done", ["al"]],
    ["(@sierra) and @SIERRA again", ["sierra"]],
    ["x_@sierra and y.@sierra", []],
    ["@@sierra", ["sierra"]],
    ["@sierra-l_2 ok", ["sierra-l_2"]],
    ["line\n@alfa\t@kilo", ["alfa", "kilo"]],
    ["", []],
    [null, []],
  ];
  v.forEach(([body, want]) => assert.deepStrictEqual(L.TK_mentionTokens(body), want, String(body)));
  const long = "a".repeat(70);
  assert.deepStrictEqual(L.TK_mentionTokens("@" + long), ["a".repeat(64)]);
});

// ---- Quick add
const STAFF = [
  { email: "al.k@example.test", name: "Alpha Kilo" },
  { email: "alfa@example.test", name: "Alfa Papa" },
  { email: "sierra@example.test", name: "Sierra Lima" },
  { email: "papa.r@example.test", name: "Papa Romeo" },
];
const CLIENTS = [
  { id: "ExampleChurch", name: "Example Church" },
  { id: "c2", name: "Example Fellowship" },
  { id: "c3", name: "Sample Chapel" },
  { id: "riverside", name: "Test Riverside" },
];
function qa(s, extra) {
  return L.TK_parseQuickAdd(s, Object.assign({ today: TODAY, staff: STAFF, clients: CLIENTS }, extra || {}));
}
t("qa: plain text", () => {
  const r = qa("  Reconcile   the  bank  ");
  assert.strictEqual(r.text, "Reconcile the bank");
  assert.deepStrictEqual(r.tokens, []);
  assert.deepStrictEqual(r.errors, []);
  assert.strictEqual(r.assignee_email, null);
  assert.strictEqual(r.client_id, null);
  assert.strictEqual(r.due_date, null);
  assert.strictEqual(r.priority, null);
});
t("qa: every token at once", () => {
  const r = qa("Call bank @sierra #sample tomorrow !h");
  assert.strictEqual(r.text, "Call bank");
  assert.strictEqual(r.assignee_email, "sierra@example.test");
  assert.strictEqual(r.client_id, "c3");
  assert.strictEqual(r.due_date, "2026-10-15");
  assert.strictEqual(r.priority, "high");
  assert.deepStrictEqual(r.tokens.map((x) => x.kind), ["person", "client", "date", "priority"]);
  assert.deepStrictEqual(r.tokens[0], { kind: "person", raw: "@sierra", start: 10, end: 17, value: "sierra@example.test" });
});
t("qa: @ by name slug prefix", () => {
  assert.strictEqual(qa("ask @papa-r about it").assignee_email, "papa.r@example.test");
  assert.strictEqual(qa("ask @romeo").assignee_email, null);
  assert.strictEqual(qa("ask @papa about it").assignee_email, "papa.r@example.test");
});
t("qa: @ exact handle beats a prefix tie", () => {
  const r = qa("check @alfa");
  assert.strictEqual(r.assignee_email, "alfa@example.test");
  assert.strictEqual(r.text, "check");
});
t("qa: ambiguous @ stays in text with an error", () => {
  const r = qa("check @al today");
  assert.strictEqual(r.assignee_email, null);
  assert.strictEqual(r.text, "check @al");
  assert.deepStrictEqual(r.errors, ["Who is @al?"]);
  assert.strictEqual(r.due_date, TODAY);
});
t("qa: unknown @ and #", () => {
  const r = qa("@zz #zz thing");
  assert.strictEqual(r.text, "@zz #zz thing");
  assert.deepStrictEqual(r.errors, ["Who is @zz?", "Which client is #zz?"]);
});
t("qa: @ trailing dot and case", () => {
  const r = qa("Thanks @SIERRA.");
  assert.strictEqual(r.assignee_email, "sierra@example.test");
  assert.strictEqual(r.text, "Thanks");
});
t("qa: email-like text is not a person", () => {
  const r = qa("forward a@b.test");
  assert.strictEqual(r.assignee_email, null);
  assert.deepStrictEqual(r.errors, []);
  assert.strictEqual(r.text, "forward a@b.test");
});
t("qa: second resolved @ stays in text", () => {
  const r = qa("@sierra and @alfa");
  assert.strictEqual(r.assignee_email, "sierra@example.test");
  assert.strictEqual(r.text, "and @alfa");
});
t("qa: # by slug prefix, by exact id, ambiguous", () => {
  assert.strictEqual(qa("review #example-ch").client_id, "ExampleChurch");
  assert.strictEqual(qa("review #ExampleChurch").client_id, "ExampleChurch");
  assert.strictEqual(qa("review #test-r").client_id, "riverside");
  const r = qa("review #example");
  assert.strictEqual(r.client_id, null);
  assert.deepStrictEqual(r.errors, ["Which client is #example?"]);
  assert.strictEqual(r.text, "review #example");
});
t("qa: defaultClientId, and a # overrides it", () => {
  assert.strictEqual(qa("thing", { defaultClientId: "c2" }).client_id, "c2");
  assert.strictEqual(qa("thing #sample", { defaultClientId: "c2" }).client_id, "c3");
});
t("qa: priority forms", () => {
  assert.strictEqual(qa("a !high").priority, "high");
  assert.strictEqual(qa("a !H").priority, "high");
  assert.strictEqual(qa("a !low").priority, "low");
  assert.strictEqual(qa("a !l").priority, "low");
  assert.strictEqual(qa("a !normal").priority, "normal");
  assert.strictEqual(qa("a !n").priority, "normal");
  const two = qa("a !l !h");
  assert.strictEqual(two.priority, "low");
  assert.strictEqual(two.text, "a !h");
  assert.strictEqual(qa("a !urgent").priority, null);
  assert.strictEqual(qa("wow!h").priority, null);
});
t("qa: today and tod", () => {
  assert.strictEqual(qa("x today").due_date, TODAY);
  assert.strictEqual(qa("x TOD").due_date, TODAY);
});
t("qa: tomorrow, tmr, tom", () => {
  ["tomorrow", "tmr", "tom", "Tomorrow"].forEach((w) => assert.strictEqual(qa("x " + w).due_date, "2026-10-15", w));
  const r = qa("x tomato");
  assert.strictEqual(r.due_date, null);
  assert.strictEqual(r.text, "x tomato");
});
t("qa: weekdays are strictly after today", () => {
  assert.strictEqual(qa("x wed").due_date, "2026-10-21"); // today is Wednesday
  assert.strictEqual(qa("x Wednesday").due_date, "2026-10-21");
  assert.strictEqual(qa("x thu").due_date, "2026-10-15");
  assert.strictEqual(qa("x fri").due_date, "2026-10-16");
  assert.strictEqual(qa("x saturday").due_date, "2026-10-17");
  assert.strictEqual(qa("x sun").due_date, "2026-10-18");
  assert.strictEqual(qa("x mon").due_date, "2026-10-19");
  assert.strictEqual(qa("x tues").due_date, "2026-10-20");
  assert.strictEqual(qa("x monthly report").due_date, null);
});
t("qa: tom, sun, mon, sat count only after due/on or as the last word", () => {
  const r = qa("call Tom about payroll");
  assert.strictEqual(r.due_date, null);
  assert.strictEqual(r.text, "call Tom about payroll");
  assert.strictEqual(qa("Sat with the treasurer fri").due_date, "2026-10-16");
  assert.strictEqual(qa("Sat with the treasurer fri").text, "Sat with the treasurer");
  assert.strictEqual(qa("x due mon review").due_date, "2026-10-19");
  assert.strictEqual(qa("x on sat review").due_date, "2026-10-17");
  assert.strictEqual(qa("x tom.").due_date, "2026-10-15");
  assert.strictEqual(qa("x mon review").due_date, null);
  assert.strictEqual(qa("x monday review").due_date, "2026-10-19");
});
t("qa: next week is next Monday", () => {
  assert.strictEqual(qa("x next week").due_date, "2026-10-19");
  assert.strictEqual(qa("x next  Week").due_date, "2026-10-19");
  assert.strictEqual(qa("x next week", { today: "2026-10-19" }).due_date, "2026-10-26");
  assert.strictEqual(qa("x next week", { today: "2026-10-18" }).due_date, "2026-10-19");
  assert.strictEqual(qa("x next week").text, "x");
});
t("qa: eom", () => {
  assert.strictEqual(qa("x eom").due_date, "2026-10-31");
  assert.strictEqual(qa("x eom", { today: "2028-02-10" }).due_date, "2028-02-29");
});
t("qa: in N days, +Nd, +Nw", () => {
  assert.strictEqual(qa("x in 5 days").due_date, "2026-10-19");
  assert.strictEqual(qa("x in 1 day").due_date, "2026-10-15");
  assert.strictEqual(qa("x in 2 weeks").due_date, "2026-10-28");
  assert.strictEqual(qa("x +3d").due_date, "2026-10-17");
  assert.strictEqual(qa("x +2w").due_date, "2026-10-28");
  assert.strictEqual(qa("x in 5 days").text, "x");
});
t("qa: M/D rolls a past date to next year; M/D/YY and M/D/YYYY", () => {
  assert.strictEqual(qa("x 11/3").due_date, "2026-11-03");
  assert.strictEqual(qa("x 10/14").due_date, "2026-10-14");
  assert.strictEqual(qa("x 10/13").due_date, "2027-10-13");
  assert.strictEqual(qa("x 1/5").due_date, "2027-01-05");
  assert.strictEqual(qa("x 1/5/27").due_date, "2027-01-05");
  assert.strictEqual(qa("x 3/1/2026").due_date, "2026-03-01");
  assert.strictEqual(qa("x 13/1").due_date, null);
  assert.strictEqual(qa("x 2/30/2027").due_date, null);
  assert.strictEqual(qa("x 2/29", { today: "2027-03-01" }).due_date, "2028-02-29");
  assert.strictEqual(qa("x 2/29", { today: "2026-10-14" }).due_date, null); // 2027 has no Feb 29
});
t("qa: ISO date", () => {
  assert.strictEqual(qa("x 2026-12-01").due_date, "2026-12-01");
  assert.strictEqual(qa("x 2026-02-30").due_date, null);
  assert.strictEqual(qa("x 2026-12-01").text, "x");
});
t("qa: bdN this month or next month when passed", () => {
  assert.strictEqual(qa("x bd10").due_date, "2026-10-14"); // the 10th business day is today
  assert.strictEqual(qa("x bd3").due_date, "2026-11-04"); // Oct bd3 (Oct 5) has passed
  assert.strictEqual(qa("x BD15").due_date, "2026-10-21");
  assert.strictEqual(qa("x bd1", { today: "2026-12-15" }).due_date, "2027-01-01");
  assert.strictEqual(qa("x bd30").due_date, null);
});
t("qa: +Nbd across a weekend", () => {
  assert.strictEqual(qa("x +3bd").due_date, "2026-10-19");
  assert.strictEqual(qa("x +1bd", { today: "2026-10-16" }).due_date, "2026-10-19");
  assert.strictEqual(qa("x +1bd", { today: "2026-10-17" }).due_date, "2026-10-19");
  assert.strictEqual(qa("x +3bd").text, "x");
});
t("qa: the first date word in the line wins; later ones stay", () => {
  const r = qa("move fri meeting to mon");
  assert.strictEqual(r.due_date, "2026-10-16");
  assert.strictEqual(r.text, "move meeting to mon");
  assert.strictEqual(r.tokens.filter((x) => x.kind === "date").length, 1);
});
t("qa: tokens inside words are not dates", () => {
  const r = qa("satisfy sunday-school todo");
  assert.strictEqual(r.due_date, null);
  assert.strictEqual(r.text, "satisfy sunday-school todo");
});
t("qa: text cleanup after removal", () => {
  assert.strictEqual(qa("Pay bills, fri").text, "Pay bills");
  assert.strictEqual(qa("today: payroll").text, "payroll");
  assert.strictEqual(qa("Payroll   @sierra   !h   fri  run").text, "Payroll run");
});
t("qa: empty text error", () => {
  const r = qa("today");
  assert.strictEqual(r.text, "");
  assert.deepStrictEqual(r.errors, ["Add a few words about the task."]);
  assert.deepStrictEqual(qa("").errors, ["Add a few words about the task."]);
  assert.deepStrictEqual(L.TK_parseQuickAdd(null, { today: TODAY }).errors, ["Add a few words about the task."]);
});
t("qa: token raw and positions match the input", () => {
  const s = "Tom: ask (@sierra) re #sample eom !low";
  const r = qa(s);
  r.tokens.forEach((x) => assert.strictEqual(s.slice(x.start, x.end), x.raw));
  for (let i = 1; i < r.tokens.length; i++) assert.ok(r.tokens[i].start >= r.tokens[i - 1].end);
  assert.strictEqual(r.due_date, "2026-10-31"); // "Tom" leads the line, so it is a name; eom is the date
});
t("qa: works without staff or clients", () => {
  const r = L.TK_parseQuickAdd("call @sierra fri", { today: TODAY });
  assert.strictEqual(r.due_date, "2026-10-16");
  assert.deepStrictEqual(r.errors, ["Who is @sierra?"]);
});

// ---- Quick add, plain words (Phase 4, P4-1)
const PW_STAFF = [
  { email: "ana@example.test", name: "Ana Delta" },
  { email: "sierra@example.test", name: "Sierra Lima" },
  { email: "sierra.w@example.test", name: "Sierra Wells" },
  { email: "grace@example.test", name: "Grace Hopper" },
  { email: "may@example.test", name: "May Zulu" },
  { email: "pat@example.test", name: "Pat Quebec" },
];
const PW_CLIENTS = [
  { id: "ex1", name: "Example Church" },
  { id: "ex2", name: "Example Fellowship" },
  { id: "sc", name: "Sample Chapel" },
  { id: "gc", name: "Grace Church" },
  { id: "sj", name: "Smith-Jones LLC" },
  { id: "sun", name: "Sunday Church" },
  { id: "ab", name: "Abe Co" },
];
function pw(s, extra) {
  return L.TK_parseQuickAdd(s, Object.assign({ today: TODAY, staff: PW_STAFF, clients: PW_CLIENTS, me: "PAT@example.test" }, extra || {}));
}
t("pw: for / to / assign pick one staff member by first or full name", () => {
  ["for Ana", "assign Ana", "assign to Ana", "assigned to Ana", "for ana delta", "FOR ANA"].forEach((tail) => {
    const r = pw("Send statements " + tail);
    assert.strictEqual(r.assignee_email, "ana@example.test", tail);
    assert.strictEqual(r.text, "Send statements", tail);
    assert.deepStrictEqual(r.suggestions, [], tail);
  });
  // A bare "to <name>" is only a suggestion: "Reply to Tom" may not mean Tom does it.
  const toAna = pw("Send statements to Ana");
  assert.strictEqual(toAna.assignee_email, null);
  assert.strictEqual(toAna.text, "Send statements to Ana");
  assert.deepStrictEqual(toAna.suggestions[0].options.map((o) => [o.kind, o.value]), [["person", "ana@example.test"]]);
  const mid = pw("Call for Ana about payroll");
  assert.strictEqual(mid.assignee_email, "ana@example.test");
  assert.strictEqual(mid.text, "Call about payroll");
  assert.strictEqual(mid.tokens[0].raw, "for Ana");
  assert.strictEqual(mid.tokens[0].plain, true);
});
t("pw: a full name settles a shared first name", () => {
  const r = pw("Review for Sierra Wells");
  assert.strictEqual(r.assignee_email, "sierra.w@example.test");
  assert.strictEqual(r.text, "Review");
});
t("pw: a shared first name is a suggestion, never a guess", () => {
  const r = pw("Review for Sierra");
  assert.strictEqual(r.assignee_email, null);
  assert.strictEqual(r.text, "Review for Sierra");
  assert.deepStrictEqual(r.tokens, []);
  assert.strictEqual(r.suggestions.length, 1);
  assert.deepStrictEqual(r.suggestions[0].options.map((o) => [o.kind, o.value, o.label, o.raw]), [
    ["person", "sierra@example.test", "Sierra Lima", "for Sierra"],
    ["person", "sierra.w@example.test", "Sierra Wells", "for Sierra"],
  ]);
  assert.strictEqual(r.suggestions[0].start, 7);
  assert.strictEqual(r.suggestions[0].end, 17);
});
t("pw: unknown names stay in the title with no error", () => {
  const r = pw("Send the report to Dana");
  assert.strictEqual(r.assignee_email, null);
  assert.strictEqual(r.text, "Send the report to Dana");
  assert.deepStrictEqual(r.errors, []);
  assert.deepStrictEqual(r.suggestions, []);
  assert.strictEqual(pw("Pay for the lunch").text, "Pay for the lunch");
  assert.strictEqual(pw("Ana's report for Ana's team").assignee_email, null);
});
t("pw: names that are words only count after for / to / assign", () => {
  const r = pw("Will May call Grace about it");
  assert.strictEqual(r.assignee_email, null);
  assert.strictEqual(r.client_id, null);
  assert.strictEqual(r.text, "Will May call Grace about it");
  assert.strictEqual(pw("Thank you for May").assignee_email, "may@example.test");
});
t("pw: me and @me", () => {
  assert.strictEqual(pw("Call bank for me").assignee_email, "pat@example.test");
  assert.strictEqual(pw("Call bank to me").text, "Call bank");
  assert.strictEqual(pw("assign to me call bank").assignee_email, "pat@example.test");
  assert.strictEqual(pw("Call bank @me").assignee_email, "pat@example.test");
  assert.strictEqual(pw("Call bank @ME").text, "Call bank");
  const noMe = pw("Call bank for me @me", { me: "" });
  assert.strictEqual(noMe.assignee_email, null);
  assert.deepStrictEqual(noMe.errors, ["Who is @me?"]);
  assert.strictEqual(noMe.text, "Call bank for me @me");
});
t("pw: client after for / re / client / a dash, at the end of the line", () => {
  ["Bank rec for Sample Chapel", "Bank rec re Sample Chapel", "Bank rec client Sample Chapel", "Bank rec - Sample Chapel", "Bank rec \u2013 Sample Chapel", "Bank rec for sample chapel"].forEach((s) => {
    const r = pw(s);
    assert.strictEqual(r.client_id, "sc", s);
    assert.strictEqual(r.text, "Bank rec", s);
  });
  // The start of a name is a guess: one "Did you mean" button, never a pick.
  const start = pw("Bank rec for Sample");
  assert.strictEqual(start.client_id, null);
  assert.strictEqual(start.text, "Bank rec for Sample");
  assert.deepStrictEqual(start.suggestions[0].options.map((o) => [o.kind, o.value]), [["client", "sc"]]);
  assert.strictEqual(pw("Bank rec for Smith-Jones LLC").client_id, "sj");
  assert.strictEqual(pw("Bank rec for Smith Jones LLC").client_id, "sj");
});
t("pw: a client name in the middle of a title is not a client", () => {
  const r = pw("Email Sample Chapel about the audit");
  assert.strictEqual(r.client_id, null);
  assert.strictEqual(r.text, "Email Sample Chapel about the audit");
  assert.strictEqual(pw("Send for Sample Chapel the audit").client_id, null);
  assert.strictEqual(pw("Bank rec Sample Chapel").client_id, null); // no for / re / client / dash
});
t("pw: client needs 4 characters, and can lead the line", () => {
  assert.strictEqual(pw("Bank rec for Abe").client_id, null); // 3 characters
  assert.strictEqual(pw("Bank rec for Abe Co").client_id, "ab");
  const lead = pw("re Sample Chapel: send statements");
  assert.strictEqual(lead.client_id, "sc");
  assert.strictEqual(lead.text, "send statements");
  assert.strictEqual(pw("for Sample Chapel - send statements").text, "send statements");
  assert.strictEqual(pw("client Sample Chapel, send statements").client_id, "sc");
  assert.strictEqual(pw("for Sample Chapel send statements").client_id, null); // no colon, comma or dash after it
});
t("pw: two clients match -> suggestion, words stay in the title", () => {
  const r = pw("Bank rec for Example");
  assert.strictEqual(r.client_id, null);
  assert.strictEqual(r.text, "Bank rec for Example");
  assert.deepStrictEqual(r.suggestions[0].options.map((o) => [o.kind, o.value, o.label]), [
    ["client", "ex1", "Example Church"],
    ["client", "ex2", "Example Fellowship"],
  ]);
  assert.strictEqual(pw("Bank rec for Example Church").client_id, "ex1"); // the whole name settles it
});
t("pw: a full client name beats a person's first name; a shorter one stays a suggestion", () => {
  const r = pw("Prep for Grace Church");
  assert.strictEqual(r.client_id, "gc");
  assert.strictEqual(r.assignee_email, null);
  assert.strictEqual(r.text, "Prep");
  const sug = pw("Prep for Grace");
  assert.strictEqual(sug.client_id, null);
  assert.strictEqual(sug.assignee_email, null);
  assert.deepStrictEqual(sug.suggestions[0].options.map((o) => [o.kind, o.value]).sort(), [["client", "gc"], ["person", "grace@example.test"]]);
  const person = pw("Prep for Grace Hopper");
  assert.strictEqual(person.assignee_email, "grace@example.test");
});
t("pw: a date at the end does not hide the client", () => {
  const a = pw("Bank rec for Sample Chapel Friday");
  assert.strictEqual(a.client_id, "sc");
  assert.strictEqual(a.due_date, "2026-10-16");
  assert.strictEqual(a.text, "Bank rec");
  const b = pw("Bank rec for Sample Chapel by Friday");
  assert.strictEqual(b.client_id, "sc");
  assert.strictEqual(b.text, "Bank rec");
  // The name wins over a date word inside it.
  const c = pw("Bank rec for Sunday Church");
  assert.strictEqual(c.client_id, "sun");
  assert.strictEqual(c.due_date, null);
});
t("pw: by / due / on go with the date", () => {
  [["by Friday", "2026-10-16"], ["due Friday", "2026-10-16"], ["due on Friday", "2026-10-16"], ["on Monday", "2026-10-19"], ["by tomorrow", "2026-10-15"], ["by 11/3", "2026-11-03"]].forEach((c) => {
    const r = pw("Send statements " + c[0]);
    assert.strictEqual(r.due_date, c[1], c[0]);
    assert.strictEqual(r.text, "Send statements", c[0]);
    assert.strictEqual(r.tokens[0].raw, c[0]);
  });
  assert.strictEqual(pw("Call Tom by mon").due_date, "2026-10-19"); // "mon" is a name-like word unless by / due / on is there
});
t("pw: the 15th, this month or next, never guessed", () => {
  assert.strictEqual(pw("Pay vendors the 15th").due_date, "2026-10-15");
  assert.strictEqual(pw("Pay vendors the 15th").text, "Pay vendors");
  assert.strictEqual(pw("Pay vendors by the 15th").text, "Pay vendors");
  assert.strictEqual(pw("Pay vendors on the 3rd").due_date, "2026-11-03"); // the 3rd has passed
  assert.strictEqual(pw("Pay vendors 14th").due_date, "2026-10-14"); // today counts
  assert.strictEqual(pw("Pay vendors on the 31st").due_date, "2026-10-31");
  assert.strictEqual(pw("Pay vendors on the 31st", { today: "2026-11-05" }).due_date, null); // November has 30 days
  assert.strictEqual(pw("Pay vendors on the 31st", { today: "2026-11-05" }).text, "Pay vendors on the 31st");
  assert.strictEqual(pw("Pay vendors on the 3rd", { today: "2026-12-20" }).due_date, "2027-01-03");
  assert.strictEqual(pw("Pay vendors by the 0th").due_date, null);
  assert.strictEqual(pw("Pay vendors by the 32nd").due_date, null);
});
t("pw: a day number inside a title is left alone", () => {
  const a = pw("Review the 1st quarter numbers");
  assert.strictEqual(a.due_date, null);
  assert.strictEqual(a.text, "Review the 1st quarter numbers");
  assert.strictEqual(pw("Send the 15th invoice to the board").due_date, null);
  assert.strictEqual(pw("Send the 15th invoice by Friday").due_date, "2026-10-16");
  assert.strictEqual(pw("Send the 15th invoice by Friday").text, "Send the 15th invoice");
});
t("pw: end of month and next week", () => {
  assert.strictEqual(pw("Close the books end of month").due_date, "2026-10-31");
  assert.strictEqual(pw("Close the books end of the month").text, "Close the books");
  assert.strictEqual(pw("Close the books by end of month").text, "Close the books");
  assert.strictEqual(pw("Close the books next week").due_date, "2026-10-19");
  assert.strictEqual(pw("Close the books next week").text, "Close the books");
});
t("pw: person, client and date together", () => {
  const r = pw("Send statements for Ana re Sample Chapel by Friday");
  assert.strictEqual(r.assignee_email, "ana@example.test");
  assert.strictEqual(r.client_id, "sc");
  assert.strictEqual(r.due_date, "2026-10-16");
  assert.strictEqual(r.text, "Send statements");
  assert.deepStrictEqual(r.tokens.map((x) => x.kind), ["person", "client", "date"]);
  r.tokens.forEach((x) => assert.strictEqual("Send statements for Ana re Sample Chapel by Friday".slice(x.start, x.end), x.raw));
});
t("pw: symbols still win and mix with plain words", () => {
  const r = pw("Call bank @ana for Sierra Wells #sample fri");
  assert.strictEqual(r.assignee_email, "ana@example.test"); // @ came first; the plain person stays in the title
  assert.strictEqual(r.client_id, "sc");
  assert.strictEqual(r.text, "Call bank for Sierra Wells");
  assert.strictEqual(pw("Call bank for Sample Chapel #example-ch").client_id, "ex1");
  assert.strictEqual(pw("Call bank for Sample Chapel #example-ch").text, "Call bank for Sample Chapel");
});
t("pw: a default client stays unless the line names another", () => {
  assert.strictEqual(pw("Call bank", { defaultClientId: "gc" }).client_id, "gc");
  assert.strictEqual(pw("Call bank for Sample Chapel", { defaultClientId: "gc" }).client_id, "sc");
  assert.strictEqual(pw("Call bank for Example", { defaultClientId: "gc" }).client_id, "gc"); // ambiguous: nothing changes
});
t("pw: a line that is only plain words keeps its words as the title", () => {
  const a = pw("for Ana");
  assert.strictEqual(a.text, "for Ana");
  assert.strictEqual(a.assignee_email, null);
  assert.deepStrictEqual(a.errors, []);
  const b = pw("re Sample Chapel");
  assert.strictEqual(b.text, "re Sample Chapel");
  assert.strictEqual(b.client_id, null);
  assert.strictEqual(pw("for me").text, "for me");
  assert.deepStrictEqual(pw("today").errors, ["Add a few words about the task."]); // symbol-era behavior stays
});
t("pw: ignore keeps the words in the title and stops the parse", () => {
  const k = L.TK_qaIgnoreKey;
  const a = pw("Call bank for Ana", { ignore: [k("person", "for Ana")] });
  assert.strictEqual(a.assignee_email, null);
  assert.strictEqual(a.text, "Call bank for Ana");
  const d = pw("Call bank by Friday", { ignore: [k("date", "by Friday")] });
  assert.strictEqual(d.due_date, null);
  assert.strictEqual(d.text, "Call bank by Friday");
  const c = pw("Call bank for Sample Chapel", { ignore: [k("client", "FOR  sample chapel")] });
  assert.strictEqual(c.client_id, null);
  assert.strictEqual(c.text, "Call bank for Sample Chapel");
  const sym = pw("Call bank @ana !h", { ignore: [k("person", "@ana"), k("priority", "!h")] });
  assert.strictEqual(sym.assignee_email, null);
  assert.strictEqual(sym.priority, null);
  assert.strictEqual(sym.text, "Call bank @ana !h");
  const sug = pw("Review for Sierra", { ignore: [k("person", "for Sierra")] });
  assert.deepStrictEqual(sug.suggestions, []);
  assert.strictEqual(L.TK_qaIgnoreKey("date", "  By   FRIDAY "), "date|by friday");
});
t("pw: review fixes (on the 2nd floor, Sierra Club, later phrase wins, symbols come out)", () => {
  const f = pw("Meet on the 2nd floor");
  assert.strictEqual(f.due_date, null);
  assert.strictEqual(f.text, "Meet on the 2nd floor");
  assert.strictEqual(pw("Send report by the 2nd").due_date, "2026-11-02");
  assert.strictEqual(pw("Pay rent by sat morning", { plain: false }).due_date, null);
  const t2 = pw("Reply to Ana");
  assert.strictEqual(t2.assignee_email, null);
  const late = pw("Send to Sierra for Ana");
  assert.strictEqual(late.assignee_email, "ana@example.test");
  assert.ok(late.suggestions.every((sg) => sg.options.every((o) => o.kind !== "person")));
  assert.strictEqual(pw("Plan for next week").text, "Plan");
});
t("pw: plain:false is the symbol-only parser", () => {
  const r = pw("Send statements for Ana by Friday the 15th", { plain: false });
  assert.strictEqual(r.assignee_email, null);
  assert.strictEqual(r.due_date, "2026-10-16");
  assert.strictEqual(r.text, "Send statements for Ana by the 15th");
  assert.deepStrictEqual(r.suggestions, []);
  assert.strictEqual(pw("Bank rec for Sample Chapel", { plain: false }).client_id, null);
});
t("pw: tokens keep their order, positions and raw text", () => {
  const s = "Bank rec - Sample Chapel, for Ana, due Friday";
  const r = pw(s);
  assert.deepStrictEqual(r.tokens.map((x) => x.kind), ["person", "date"]); // the dash form needs the client at the end
  r.tokens.forEach((x) => assert.strictEqual(s.slice(x.start, x.end), x.raw));
  for (let i = 1; i < r.tokens.length; i++) assert.ok(r.tokens[i].start >= r.tokens[i - 1].end);
});
t("pw: empty, odd and long input never throws", () => {
  ["", "   ", "for", "to", "re", "-", "for -", "assign to", "by", "the 15th", "!!! for @@@", "for \u2014 \u2014"].forEach((s) => {
    const r = pw(s);
    assert.ok(Array.isArray(r.tokens) && Array.isArray(r.suggestions) && Array.isArray(r.errors), JSON.stringify(s));
  });
  const long = "word ".repeat(300) + "for Ana";
  assert.strictEqual(pw(long).assignee_email, "ana@example.test");
  assert.deepStrictEqual(pw(null).suggestions, []);
});

// ---- Routes
t("parseRoute", () => {
  const P = L.TK_parseRoute;
  const U = "1b4e28ba-2fa1-41d2-883f-0016d3cca427";
  assert.deepStrictEqual(P("#/tasks"), { view: "my" });
  assert.deepStrictEqual(P("#/tasks/"), { view: "my" });
  assert.deepStrictEqual(P("#/tasks/my"), { view: "my" });
  assert.deepStrictEqual(P("#/tasks/my/"), { view: "my" });
  assert.deepStrictEqual(P("#/tasks/my?item=task:" + U), { view: "my" });
  assert.deepStrictEqual(P("#/tasks/search"), { view: "search" });
  assert.deepStrictEqual(P("#/tasks/review"), { view: "review" });
  assert.deepStrictEqual(P("#/tasks/Review/"), { view: "review" });
  assert.deepStrictEqual(P("#/tasks/review/x"), { view: "unknown" });
  assert.deepStrictEqual(P("#/tasks/templates"), { view: "templates" });
  assert.deepStrictEqual(P("#/tasks/Templates/"), { view: "templates" });
  assert.deepStrictEqual(P("#/tasks/templates/x"), { view: "unknown" });
  assert.deepStrictEqual(P("#/tasks/waiting"), { view: "waiting" });
  assert.deepStrictEqual(P("#/tasks/Waiting/"), { view: "waiting" });
  assert.deepStrictEqual(P("#/tasks/waiting/x"), { view: "unknown" });
  assert.deepStrictEqual(P("#/tasks/manage"), { view: "manage" });
  assert.deepStrictEqual(P("#/tasks/Manage/"), { view: "manage" });
  assert.deepStrictEqual(P("#/tasks/manage/x"), { view: "unknown" });
  assert.deepStrictEqual(P("#/tasks/settings"), { view: "settings" });
  assert.deepStrictEqual(P("#/tasks/settings/x"), { view: "unknown" });
  assert.deepStrictEqual(P("#/tasks/c/ExampleChurch"), { view: "client", clientId: "ExampleChurch" });
  assert.deepStrictEqual(P("#/tasks/c/Ab%2Fc"), { view: "client", clientId: "Ab/c" });
  assert.deepStrictEqual(P("#/tasks/c/Ab%2Fc/list"), { view: "client", clientId: "Ab/c" });
  assert.deepStrictEqual(P("#/tasks/c/MiXeD/"), { view: "client", clientId: "MiXeD" });
  assert.deepStrictEqual(P("#/tasks/c/a%40b.test"), { view: "unknown" });
  assert.deepStrictEqual(P("#/tasks/c/a@b.test"), { view: "unknown" });
  assert.deepStrictEqual(P("#/tasks/c/%E0%A4%A"), { view: "unknown" });
  assert.deepStrictEqual(P("#/tasks/c/"), { view: "unknown" });
  assert.deepStrictEqual(P("#/tasks/c/a/b"), { view: "unknown" });
  assert.deepStrictEqual(P("#/tasks/p/" + U), { view: "project", projectId: U });
  assert.deepStrictEqual(P("#/tasks/p/" + U.toUpperCase() + "/list"), { view: "project", projectId: U.toUpperCase() });
  assert.deepStrictEqual(P("#/tasks/p/not-a-uuid"), { view: "unknown" });
  assert.deepStrictEqual(P("#/tasks/u/" + U), { view: "person", staffId: U });
  assert.deepStrictEqual(P("#/tasks/u/" + U + "/list"), { view: "unknown" });
  assert.deepStrictEqual(P("#/tasks/u/12345"), { view: "unknown" });
  assert.deepStrictEqual(P("#/tasks/nope"), { view: "unknown" });
  assert.deepStrictEqual(P("#/today"), { view: "unknown" });
  assert.deepStrictEqual(P(""), { view: "unknown" });
  assert.deepStrictEqual(P(null), { view: "unknown" });
});
t("formatRoute and round trips", () => {
  const F = L.TK_formatRoute;
  const P = L.TK_parseRoute;
  const U = "1b4e28ba-2fa1-41d2-883f-0016d3cca427";
  assert.strictEqual(F({ view: "my" }), "#/tasks/my");
  assert.strictEqual(F({ view: "search" }), "#/tasks/search");
  assert.strictEqual(F({ view: "review" }), "#/tasks/review");
  assert.strictEqual(F({ view: "templates" }), "#/tasks/templates");
  assert.strictEqual(F({ view: "waiting" }), "#/tasks/waiting");
  assert.strictEqual(F({ view: "manage" }), "#/tasks/manage");
  assert.strictEqual(F({ view: "settings" }), "#/tasks/settings");
  assert.strictEqual(F({ view: "client", clientId: "Ab/c" }), "#/tasks/c/Ab%2Fc");
  assert.strictEqual(F({ view: "project", projectId: U }), "#/tasks/p/" + U);
  assert.strictEqual(F({ view: "person", staffId: U }), "#/tasks/u/" + U);
  assert.strictEqual(F({ view: "client", clientId: "a@b.test" }), "#/tasks/my");
  assert.strictEqual(F({ view: "project", projectId: "bad" }), "#/tasks/my");
  assert.strictEqual(F({ view: "unknown" }), "#/tasks/my");
  assert.strictEqual(F(null), "#/tasks/my");
  [
    { view: "my" },
    { view: "search" },
    { view: "review" },
    { view: "templates" },
    { view: "waiting" },
    { view: "client", clientId: "MiXeD-Case_1" },
    { view: "client", clientId: "Ab/c" },
    { view: "client", clientId: "a b&c?d#e" },
    { view: "project", projectId: U },
    { view: "person", staffId: U },
  ].forEach((r) => assert.deepStrictEqual(P(F(r)), r, JSON.stringify(r)));
  assert.strictEqual(F(P("#/tasks/")), "#/tasks/my");
  assert.strictEqual(F(P("#/tasks/c/Ab%2Fc/list")), "#/tasks/c/Ab%2Fc");
});

// ---- Keys
function el(opts) {
  const o = Object.assign({ tag: "DIV", attrs: {}, classes: [], parent: null, isContentEditable: false }, opts);
  const node = {
    tagName: o.tag,
    isContentEditable: o.isContentEditable,
    parent: o.parent,
    getAttribute: (k) => (k in o.attrs ? o.attrs[k] : null),
    matchesOne(sel) {
      sel = sel.trim();
      if (sel[0] === ".") return o.classes.indexOf(sel.slice(1)) >= 0;
      const m = /^\[([a-z-]+)(?:="([^"]*)")?\]$/.exec(sel);
      if (m) return m[1] in o.attrs && (m[2] === undefined || o.attrs[m[1]] === m[2]);
      return false;
    },
    closest(selector) {
      const parts = selector.split(",");
      let cur = node;
      while (cur) {
        if (parts.some((p) => cur.matchesOne(p))) return cur;
        cur = cur.parent;
      }
      return null;
    },
  };
  return node;
}
const BODY = el({ tag: "BODY" });
const DRAWER = el({ attrs: { "data-tk-keyscope": "drawer" }, parent: BODY });
const IN_DRAWER = el({ tag: "BUTTON", parent: DRAWER });
const LIST_ROW = el({ tag: "LI", parent: BODY });
function key(over) {
  return Object.assign({ key: "x", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, defaultPrevented: false, target: LIST_ROW }, over || {});
}
function ok(ev, ctx) {
  return L.TK_shouldHandleKey(ev, Object.assign({ scope: "list", activeElement: ev.target, body: BODY }, ctx || {}));
}
t("shouldHandleKey accepts a plain key and ? with Shift", () => {
  assert.strictEqual(ok(key()), true);
  assert.strictEqual(ok(key({ key: "?", shiftKey: true })), true);
});
t("shouldHandleKey rejects modifiers and composition", () => {
  assert.strictEqual(ok(key({ ctrlKey: true })), false);
  assert.strictEqual(ok(key({ metaKey: true })), false);
  assert.strictEqual(ok(key({ altKey: true })), false);
  assert.strictEqual(ok(key({ isComposing: true })), false);
  assert.strictEqual(ok(key({ keyCode: 229 })), false);
  assert.strictEqual(ok(key({ defaultPrevented: true })), false);
});
t("shouldHandleKey rejects typing targets", () => {
  ["INPUT", "TEXTAREA", "SELECT", "input"].forEach((tag) => assert.strictEqual(ok(key({ target: el({ tag, parent: BODY }) })), false, tag));
  assert.strictEqual(ok(key({ target: el({ isContentEditable: true, parent: BODY }) })), false);
  assert.strictEqual(ok(key({ target: el({ attrs: { contenteditable: "true" }, parent: BODY }) })), false);
  assert.strictEqual(ok(key({ target: el({ attrs: { role: "textbox" }, parent: BODY }) })), false);
  const search = el({ classes: ["tb-search"], parent: BODY });
  assert.strictEqual(ok(key({ target: el({ tag: "BUTTON", parent: search }) })), false);
  // the focused element counts even when the event target is the body
  const input = el({ tag: "INPUT", parent: BODY });
  assert.strictEqual(L.TK_shouldHandleKey(key({ target: BODY }), { scope: "list", activeElement: input, body: BODY }), false);
});
t("shouldHandleKey rejects an open modal, menu or tour", () => {
  assert.strictEqual(ok(key(), { modalOpen: true }), false);
  assert.strictEqual(ok(key(), { menuOpen: true }), false);
  assert.strictEqual(ok(key(), { tourOpen: true }), false);
});
t("shouldHandleKey scopes", () => {
  // list rejects targets inside the drawer
  assert.strictEqual(ok(key({ target: IN_DRAWER }), { scope: "list" }), false);
  assert.strictEqual(ok(key({ target: LIST_ROW }), { scope: "list" }), true);
  // drawer rejects targets outside it, except the body
  assert.strictEqual(ok(key({ target: IN_DRAWER }), { scope: "drawer" }), true);
  assert.strictEqual(ok(key({ target: DRAWER }), { scope: "drawer" }), true);
  assert.strictEqual(ok(key({ target: LIST_ROW }), { scope: "drawer" }), false);
  assert.strictEqual(ok(key({ target: BODY }), { scope: "drawer" }), true);
  // global has no scope check
  assert.strictEqual(ok(key({ key: "q", target: IN_DRAWER }), { scope: "global" }), true);
  assert.strictEqual(ok(key({ key: "q", target: LIST_ROW }), { scope: "global" }), true);
  // one press reaches exactly one of list and drawer
  [IN_DRAWER, LIST_ROW, DRAWER].forEach((target) => {
    const hits = ["list", "drawer"].filter((scope) => ok(key({ target }), { scope }));
    assert.strictEqual(hits.length, 1);
  });
});
t("shouldHandleKey embedded drawer scope (the non-modal Desk) never takes keys from the page body", () => {
  // The stand-alone drawer still takes keys from the body (focus lost after a click)...
  assert.strictEqual(ok(key({ target: BODY }), { scope: "drawer" }), true);
  // ...but a task shown inside the Desk does not: the page owns body focus.
  assert.strictEqual(ok(key({ target: BODY }), { scope: "drawer", embedded: true }), false);
  assert.strictEqual(ok(key({ target: LIST_ROW }), { scope: "drawer", embedded: true }), false);
  assert.strictEqual(ok(key({ target: IN_DRAWER }), { scope: "drawer", embedded: true }), true);
});
t("shouldHandleKey tolerates odd input", () => {
  assert.strictEqual(L.TK_shouldHandleKey({}, {}), true);
  assert.strictEqual(L.TK_shouldHandleKey({}, { keysOff: true }), false);
  assert.strictEqual(L.TK_shouldHandleKey(null, null), true);
  assert.strictEqual(L.TK_shouldHandleKey({ target: { tagName: "SPAN" } }, { scope: "list" }), true);
});
t("keymap keys are unique, scoped, labelled and have no Ctrl/Cmd combos", () => {
  const keys = L.TK_KEYMAP.map((k) => k.key);
  assert.strictEqual(new Set(keys).size, keys.length);
  assert.deepStrictEqual(keys, ["j", "k", "Enter", "x", "s", "a", "v", "q", "t", "Escape", "?"]);
  L.TK_KEYMAP.forEach((k) => {
    assert.ok(["list", "drawer", "any"].indexOf(k.scope) >= 0);
    assert.ok(k.label && k.display);
    assert.ok(!/ctrl|cmd|meta|⌘|\+/i.test(k.key + " " + k.display));
  });
  assert.strictEqual(L.TK_KEYMAP.find((k) => k.key === "Escape").display, "Esc");
  assert.deepStrictEqual(L.TK_KEYMAP.find((k) => k.key === "q").scopes, ["global"]);
  assert.deepStrictEqual(L.TK_KEYMAP.find((k) => k.key === "t").scopes, ["global"]);
});

// ---- Edit hint
t("canEdit mirrors tk_can_edit_task", () => {
  const yes = () => true;
  const no = () => false;
  const base = { email: ME, isAdmin: false, canSeeClient: no, isMember: no };
  assert.strictEqual(L.TK_canEdit(task({ staff_email: ME, assignee_email: OTHER }), base), true); // owner
  assert.strictEqual(L.TK_canEdit(task({ staff_email: OTHER, assignee_email: OTHER }), Object.assign({}, base, { isAdmin: true })), true);
  assert.strictEqual(L.TK_canEdit(task({ staff_email: OTHER, assignee_email: ME }), base), true); // assignee, no scope
  assert.strictEqual(L.TK_canEdit(task({ staff_email: OTHER, assignee_email: ME, client_id: "c1" }), base), false);
  assert.strictEqual(L.TK_canEdit(task({ staff_email: OTHER, assignee_email: ME, client_id: "c1" }), Object.assign({}, base, { canSeeClient: yes })), true);
  assert.strictEqual(L.TK_canEdit(task({ staff_email: OTHER, assignee_email: OTHER, client_id: "c1", visibility: "shared" }), Object.assign({}, base, { canSeeClient: yes })), true);
  assert.strictEqual(L.TK_canEdit(task({ staff_email: OTHER, assignee_email: OTHER, client_id: "c1", visibility: "private" }), Object.assign({}, base, { canSeeClient: yes })), false);
  assert.strictEqual(L.TK_canEdit(task({ staff_email: OTHER, assignee_email: OTHER, project_id: "p1", visibility: "shared" }), Object.assign({}, base, { isMember: yes })), true);
  assert.strictEqual(L.TK_canEdit(task({ staff_email: OTHER, assignee_email: OTHER, project_id: "p1", visibility: "shared" }), base), false);
  assert.strictEqual(L.TK_canEdit(task({ staff_email: OTHER, assignee_email: OTHER }), base), false); // a follower
  assert.strictEqual(L.TK_canEdit(task(), { email: "" }), false);
  assert.strictEqual(L.TK_canEdit(null, base), false);
});

// ---- Normalizer
t("normalizeTask fills defaults and lowercases emails", () => {
  const r = L.TK_normalizeTask({ id: "x", text: "Hi", staff_email: "Me@Example.Test", done: true, extra: 1 });
  assert.strictEqual(r.status, "done");
  assert.strictEqual(r.done, true);
  assert.strictEqual(r.staff_email, ME);
  assert.strictEqual(r.assignee_email, null); // S8b: no assignee stays Unassigned
  assert.strictEqual(r.is_unassigned, true);
  assert.strictEqual(r.priority, "normal");
  assert.strictEqual(r.kind, "task");
  assert.strictEqual(r.recurrence, "none");
  assert.strictEqual(r.visibility, "private");
  assert.strictEqual(r.source, "manual");
  assert.strictEqual(r.waiting_minutes, 0);
  assert.strictEqual(r.review_required, false);
  assert.strictEqual(r.deleted_at, null);
  assert.strictEqual(r.description, null);
  assert.strictEqual(r.extra, 1);
  const s = L.TK_normalizeTask({
    id: "y", status: "waiting_client", done: false, assignee_email: "Other@Example.Test", staff_email: ME,
    priority: "urgent", kind: "reminder", due_date: "2026-10-14T00:00:00", waiting_minutes: "45", sort_key: "3",
    created_by: "", status_changed_by: "Me@Example.Test", review_required: 1,
  });
  assert.strictEqual(s.status, "waiting_client");
  assert.strictEqual(s.done, false);
  assert.strictEqual(s.assignee_email, OTHER);
  assert.strictEqual(s.priority, "normal");
  assert.strictEqual(s.kind, "reminder");
  assert.strictEqual(s.due_date, "2026-10-14");
  assert.strictEqual(s.waiting_minutes, 45);
  assert.strictEqual(s.sort_key, 3);
  assert.strictEqual(s.created_by, null);
  assert.strictEqual(s.status_changed_by, ME);
  assert.strictEqual(s.review_required, true);
  const raw = { id: "z", staff_email: "A@B.test" };
  L.TK_normalizeTask(raw);
  assert.strictEqual(raw.staff_email, "A@B.test", "never mutates");
  assert.strictEqual(L.TK_normalizeTask(null).status, "todo");
});

// ---- Missing-schema hints
t("isMissingColumn and isMissingFunction", () => {
  assert.strictEqual(L.TK_isMissingColumn({ code: "42703" }), true);
  assert.strictEqual(L.TK_isMissingColumn({ code: "PGRST204" }), true);
  assert.strictEqual(L.TK_isMissingColumn({ message: 'column staff_reminders.status does not exist' }), true);
  assert.strictEqual(L.TK_isMissingColumn({ message: "Could not find the 'status' column of 'staff_reminders'" }), true);
  assert.strictEqual(L.TK_isMissingColumn({ code: "42501", message: "permission denied" }), false);
  assert.strictEqual(L.TK_isMissingColumn(null), false);
  assert.strictEqual(L.TK_isMissingFunction({ code: "PGRST202" }), true);
  assert.strictEqual(L.TK_isMissingFunction({ code: "42883" }), true);
  assert.strictEqual(L.TK_isMissingFunction({ message: "Could not find the function public.tk_schema_version without parameters" }), true);
  assert.strictEqual(L.TK_isMissingFunction({ code: "42703" }), false);
  assert.strictEqual(L.TK_isMissingFunction({ code: "22023", message: "tk_bad_transition" }), false);
  assert.strictEqual(L.TK_isMissingFunction(undefined), false);
});
t("missing-schema hints never touch a schema flag or store", () => {
  const err = { code: "PGRST202" };
  const before = JSON.stringify(err);
  L.TK_isMissingFunction(err);
  L.TK_isMissingColumn(err);
  assert.strictEqual(JSON.stringify(err), before);
  assert.strictEqual(typeof global.TK_store, "undefined");
  const fs = require("fs");
  const src = fs.readFileSync(require.resolve("./TK_logic.js"), "utf8");
  assert.ok(!/TK_store|dispatch\(|schema\s*=/.test(src));
});

// ---- Exports and purity
t("every C4 name is exported", () => {
  [
    "TK_STATUSES", "TK_STATUS_LABELS", "TK_PRIORITIES", "TK_PRIORITY_LABELS", "TK_SOP_SECTION_IDS", "TK_SOON_DAYS",
    "TK_OLD_DONE_MONTHS", "TK_CLIENT_SECTION_ORDER", "TK_effectiveStatus", "TK_canTransition", "TK_resolveStatus",
    "TK_nextStatuses", "TK_isOpen", "TK_isMine", "TK_assigneeOf", "TK_isUnassigned", "TK_isOverdue", "TK_isOldDone", "TK_groupMyTasks", "TK_compareTasks",
    "TK_dueLabel", "TK_ymd", "TK_addDays", "TK_dayDiff", "TK_weekday", "TK_isBusinessDay", "TK_addBusinessDays",
    "TK_nthBusinessDay", "TK_parseQuickAdd", "TK_slug", "TK_mentionTokens", "TK_handleOf", "TK_parseRoute",
    "TK_formatRoute", "TK_KEYMAP", "TK_shouldHandleKey", "TK_canEdit", "TK_normalizeTask", "TK_isMissingColumn",
    "TK_isMissingFunction", "TK_COPY",
  ].forEach((name) => assert.ok(name in L, name));
});
t("the file is pure: no React, DOM writes, Supabase or lookbehind", () => {
  const fs = require("fs");
  const src = fs.readFileSync(require.resolve("./TK_logic.js"), "utf8").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/React|mgbSupabase|localStorage|sessionStorage|addEventListener|\(\?<[=!]/.test(src));
  assert.ok(!/^(const|let|class) /m.test(src), "top level uses var and function only");
  const tops = src.match(/^(?:var|function) ([A-Za-z_$][\w$]*)/gm) || [];
  tops.forEach((d) => assert.ok(/ (TK_|SLATE_NAME$)/.test(d), d)); // SLATE_NAME is the one shared constant
});

console.log(n + " checks passed");
