// Plain node, no framework: `node components/workbench/WB_clientExtras.test.js`.
// Guards the Desk Client tab's read-only sections (Desk additions S2,
// WB_clientExtras.js): internal or deleted messages never come back even when
// the server sends them, trashed files are dropped, the 140-character trim,
// a waiting row whose task I can't read keeps no task fields and routes to
// Waiting on client, a fast client switch never shows the old client's reply,
// and each load is exactly three requests (rpc 1, from 2) with the right
// filters.

const assert = require("assert");
const X = require("./WB_clientExtras.js");

let n = 0;
async function t(name, fn) {
  try {
    await fn();
  } catch (e) {
    console.error("FAIL " + name);
    throw e;
  }
  n++;
}

// A fake supabase client that records every call and answers from `reply`
// (section -> { data, error } or a function returning a promise).
function fakeSb(reply) {
  const calls = [];
  const answer = (section) => {
    const r = reply && reply[section];
    if (typeof r === "function") return r();
    return Promise.resolve(r || { data: [], error: null });
  };
  return {
    calls,
    rpc(name, args) {
      calls.push({ kind: "rpc", name, args });
      return answer("waiting");
    },
    from(table) {
      const q = { kind: "from", table, ops: [] };
      calls.push(q);
      const section = table === "client_messages" ? "messages" : table === "client_files" ? "files" : table;
      const b = {
        select(c) { q.ops.push(["select", c]); return b; },
        eq(k, v) { q.ops.push(["eq", k, v]); return b; },
        is(k, v) { q.ops.push(["is", k, v]); return b; },
        order(k, o) { q.ops.push(["order", k, o]); return b; },
        limit(l) { q.ops.push(["limit", l]); return b; },
        then(ok, bad) { return answer(section).then(ok, bad); },
      };
      return b;
    },
  };
}
function deferred() {
  let resolve;
  const p = new Promise((r) => (resolve = r));
  return { p, resolve };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

(async () => {
  // ---- Trim ----
  await t("140-character trim: one line, ellipsis included", () => {
    const long = "word ".repeat(60);
    const out = X.WB_cxTrim(long);
    assert.ok(out.length <= 140, "at most 140, got " + out.length);
    assert.ok(out.endsWith("…"));
    assert.strictEqual(X.WB_cxTrim("a\n\n  b\tc"), "a b c");
    const exact = "x".repeat(140);
    assert.strictEqual(X.WB_cxTrim(exact), exact, "140 exactly stays whole");
    assert.strictEqual(X.WB_cxTrim("x".repeat(141)).length, 140);
    assert.strictEqual(X.WB_cxTrim(null), "");
  });

  // ---- Messages ----
  await t("internal and deleted messages never returned, even if the server sent them", () => {
    const rows = [
      { id: 1, client_id: "c1", internal: false, deleted_at: null, author_kind: "client", author_name: "Ann", body: "Hi", created_at: "2026-10-20T10:00:00Z" },
      { id: 2, client_id: "c1", internal: true, deleted_at: null, author_kind: "staff", author_name: "Bea", body: "secret note", created_at: "2026-10-21T10:00:00Z" },
      { id: 3, client_id: "c1", internal: false, deleted_at: "2026-10-22T00:00:00Z", author_kind: "client", body: "gone", created_at: "2026-10-22T10:00:00Z" },
      { id: 4, client_id: "c1", deleted_at: null, author_kind: "client", body: "no internal field", created_at: "2026-10-23T10:00:00Z" },
      { id: 5, client_id: "c1", internal: "true", deleted_at: null, author_kind: "staff", body: "string true", created_at: "2026-10-23T11:00:00Z" },
      { id: 6, client_id: "c2", internal: false, deleted_at: null, author_kind: "client", body: "other client", created_at: "2026-10-24T10:00:00Z" },
    ];
    const out = X.WB_cxMessageRows(rows, "c1");
    assert.deepStrictEqual(out.map((m) => m.id), ["1"]);
    assert.ok(!JSON.stringify(out).includes("secret"));
  });

  await t("messages: newest first, at most 5, attachment-only shows (attachment), long body trimmed", () => {
    const rows = [];
    for (let i = 0; i < 8; i++) rows.push({ id: i, client_id: "c1", internal: false, deleted_at: null, author_kind: i % 2 ? "staff" : "client", author_name: "", participant_email: "p@x.org", body: i === 7 ? "" : "m" + i + " " + "y".repeat(200), created_at: "2026-10-0" + (i + 1) + "T10:00:00Z" });
    const out = X.WB_cxMessageRows(rows, "c1");
    assert.strictEqual(out.length, 5);
    assert.strictEqual(out[0].id, "7");
    assert.strictEqual(out[0].text, "(attachment)");
    assert.ok(out[1].text.length <= 140);
    assert.strictEqual(out[1].email, "p@x.org");
    assert.strictEqual(out[0].kindLabel, "Staff");
    assert.strictEqual(out[0].who, "MyGoodBooks");
    assert.strictEqual(out[1].who, "p@x.org");
  });

  // ---- Files ----
  await t("trashed files excluded, other client excluded, newest first, 5 at most", () => {
    const rows = [
      { id: "f1", client_id: "c1", name: "a.pdf", mime: "application/pdf", uploaded_at: "2026-10-01T00:00:00Z", drive_file_id: "d1", trashed_at: null },
      { id: "f2", client_id: "c1", name: "b.pdf", mime: "application/pdf", uploaded_at: "2026-10-05T00:00:00Z", drive_file_id: "d2", trashed_at: "2026-10-06T00:00:00Z" },
      { id: "f3", client_id: "c2", name: "c.pdf", uploaded_at: "2026-10-07T00:00:00Z", drive_file_id: "d3", trashed_at: null },
      { id: "f4", client_id: "c1", name: "sheet.xlsx", uploaded_at: "2026-10-08T00:00:00Z", drive_file_id: null, trashed_at: null },
    ];
    const out = X.WB_cxFileRows(rows, "c1");
    assert.deepStrictEqual(out.map((f) => f.id), ["f4", "f1"]);
    assert.strictEqual(out[0].kind, "Spreadsheet");
    assert.strictEqual(out[0].inDrive, false);
    assert.strictEqual(out[1].kind, "PDF");
    assert.strictEqual(out[1].inDrive, true);
    const many = [];
    for (let i = 0; i < 9; i++) many.push({ id: "g" + i, client_id: "c1", name: "x", uploaded_at: "2026-10-1" + i + "T00:00:00Z", trashed_at: null });
    assert.strictEqual(X.WB_cxFileRows(many, "c1").length, 5);
  });

  // ---- Waiting ----
  await t("null-task request row exposes no task fields and routes to Waiting on client", () => {
    const r = {
      task_id: null, title: "Pastor's private review", client_id: "c1", client_name: "Church", assignee_email: "x@mgb.org",
      task_status: "waiting_client", due_date: "2026-11-01", request_id: "r1", request_title: "Bank statements",
      asked_at: "2026-10-10T12:00:00Z", business_days_waiting: 4, nudge_count: 2, nudge_paused: false, no_reply: false,
    };
    const x = X.WB_cxWaitingRow(r, "c1");
    assert.strictEqual(x.route, "requests");
    assert.strictEqual(x.taskId, null);
    assert.strictEqual(x.taskTitle, null);
    assert.strictEqual(x.label, "Bank statements");
    const s = JSON.stringify(x);
    ["Pastor", "x@mgb.org", "2026-11-01", "waiting_client"].forEach((bad) => assert.ok(!s.includes(bad), "leaked " + bad));
    assert.ok(!("assignee_email" in x) && !("due_date" in x) && !("title" in x));
    assert.strictEqual(x.nudge, "Reminded 2 times");
  });

  await t("waiting rows: readable task opens it; task-only branch uses the task title; nudge words; other client dropped", () => {
    const rows = [
      { task_id: "t1", title: "Close Sept", client_id: "c1", request_id: "r1", request_title: "W-9", asked_at: "2026-10-01T00:00:00Z", business_days_waiting: 2, nudge_count: 1, no_reply: true, nudge_paused: true },
      { task_id: "t2", title: "Payroll setup", client_id: "c1", request_id: null, request_title: null, business_days_waiting: null },
      { task_id: null, title: null, client_id: "c1", request_id: null },
      { task_id: "t3", title: "Other", client_id: "c9", request_id: "r9", request_title: "Nope", business_days_waiting: 9 },
      { task_id: null, title: null, client_id: "c1", request_id: "r2", request_title: "", business_days_waiting: 7 },
    ];
    const out = X.WB_cxWaitingRows(rows, "c1");
    assert.deepStrictEqual(out.map((r) => r.key), ["rq:r2", "rq:r1", "tk:t2"]);
    assert.strictEqual(out[0].label, "Untitled request");
    assert.strictEqual(out[0].route, "requests");
    assert.strictEqual(out[1].route, "task");
    assert.strictEqual(out[1].taskId, "t1");
    assert.strictEqual(out[1].taskTitle, "Close Sept");
    assert.strictEqual(out[1].nudge, "No reply · Reminders paused · Reminded once");
    assert.strictEqual(out[2].label, "Payroll setup");
    assert.strictEqual(out[2].kind, "task");
    assert.strictEqual(out[2].route, "task");
  });

  await t("labels: days and dates", () => {
    assert.strictEqual(X.WB_cxDaysLabel(0), "");
    assert.strictEqual(X.WB_cxDaysLabel(1), "1 business day");
    assert.strictEqual(X.WB_cxDaysLabel(5), "5 business days");
    const now = new Date(2026, 9, 25, 15, 0, 0);
    assert.strictEqual(X.WB_cxShortDate(new Date(2026, 9, 3, 9).toISOString(), now), "Oct 3");
    assert.strictEqual(X.WB_cxShortDate(new Date(2025, 0, 9, 9).toISOString(), now), "Jan 9, 2025");
    assert.strictEqual(X.WB_cxWhen(new Date(2026, 9, 25, 14, 59, 30).toISOString(), now), "Just now");
    assert.strictEqual(X.WB_cxWhen(new Date(2026, 9, 25, 14, 30).toISOString(), now), "30 min ago");
    assert.strictEqual(X.WB_cxWhen(new Date(2026, 9, 25, 9, 0).toISOString(), now), "6 hr ago");
    assert.strictEqual(X.WB_cxWhen(new Date(2026, 9, 24, 9, 0).toISOString(), now), "Yesterday");
    assert.strictEqual(X.WB_cxWhen(new Date(2026, 9, 2, 9, 0).toISOString(), now), "Oct 2");
    assert.strictEqual(X.WB_cxWhen(null, now), "");
  });

  // ---- The reads ----
  await t("exactly 3 calls per load (rpc 1, from 2) with the right filters", async () => {
    const sb = fakeSb();
    const p = X.WB_loadClientExtras(sb, "c1");
    await Promise.all([p.waiting, p.messages, p.files]);
    assert.strictEqual(sb.calls.length, 3);
    const rpcs = sb.calls.filter((c) => c.kind === "rpc");
    const froms = sb.calls.filter((c) => c.kind === "from");
    assert.strictEqual(rpcs.length, 1);
    assert.strictEqual(froms.length, 2);
    assert.strictEqual(rpcs[0].name, "tk_waiting_on_client");
    assert.deepStrictEqual(rpcs[0].args, { p_client_id: "c1" });
    const msg = froms.find((c) => c.table === "client_messages");
    assert.deepStrictEqual(msg.ops, [
      ["select", X.WB_CX_MSG_COLS],
      ["eq", "client_id", "c1"],
      ["eq", "internal", false],
      ["is", "deleted_at", null],
      ["order", "created_at", { ascending: false }],
      ["limit", 5],
    ]);
    const files = froms.find((c) => c.table === "client_files");
    assert.deepStrictEqual(files.ops, [
      ["select", X.WB_CX_FILE_COLS],
      ["eq", "client_id", "c1"],
      ["is", "trashed_at", null],
      ["order", "uploaded_at", { ascending: false }],
      ["limit", 5],
    ]);
    ["id", "client_id", "participant_email", "author_kind", "author_name", "body", "created_at"].forEach((c) => assert.ok(X.WB_CX_MSG_COLS.split(", ").includes(c), c));
    ["id", "client_id", "name", "mime", "uploaded_at", "uploaded_by", "drive_file_id"].forEach((c) => assert.ok(X.WB_CX_FILE_COLS.split(", ").includes(c), c));
  });

  await t("WB_cxFetch: one load of all three is exactly 3 calls and applies loading then ok", async () => {
    const sb = fakeSb({
      messages: { data: [{ id: 1, client_id: "c1", internal: true, deleted_at: null, body: "note" }], error: null },
    });
    const seq = X.WB_cxSeq();
    const seen = [];
    await X.WB_cxFetch(sb, "c1", seq, null, (sec, st) => seen.push([sec, st.status, st.clientId, st.rows]));
    assert.strictEqual(sb.calls.length, 3);
    assert.deepStrictEqual(seen.filter((s) => s[1] === "loading").map((s) => s[0]).sort(), ["files", "messages", "waiting"]);
    const ok = seen.filter((s) => s[1] === "ok");
    assert.strictEqual(ok.length, 3);
    assert.deepStrictEqual(ok.find((s) => s[0] === "messages")[3], [], "internal note dropped");
  });

  await t("an error in one section is that section's error only", async () => {
    const sb = fakeSb({ files: { data: null, error: { message: "boom" } } });
    const seq = X.WB_cxSeq();
    const last = {};
    await X.WB_cxFetch(sb, "c1", seq, null, (sec, st) => (last[sec] = st.status));
    assert.deepStrictEqual(last, { waiting: "ok", messages: "ok", files: "error" });
    // Retry: one call for that section only.
    await X.WB_cxFetch(fakeSb(), "c1", seq, ["files"], (sec, st) => (last[sec] = st.status));
    assert.strictEqual(last.files, "ok");
  });

  await t("fast client switching discards stale results", async () => {
    const dA = { waiting: deferred(), messages: deferred(), files: deferred() };
    const sbA = fakeSb({ waiting: () => dA.waiting.p, messages: () => dA.messages.p, files: () => dA.files.p });
    const sbB = fakeSb({
      messages: { data: [{ id: "b1", client_id: "B", internal: false, deleted_at: null, body: "from B", created_at: "2026-10-20T00:00:00Z" }], error: null },
    });
    const seq = X.WB_cxSeq();
    const state = {};
    const apply = (sec, st) => (state[sec] = st);
    const pA = X.WB_cxFetch(sbA, "A", seq, null, apply);
    await tick();
    const pB = X.WB_cxFetch(sbB, "B", seq, null, apply);
    await pB;
    // A answers late; nothing from A may land.
    dA.waiting.resolve({ data: [{ task_id: "tA", title: "A task", client_id: "A", request_id: "rA", request_title: "A ask" }], error: null });
    dA.messages.resolve({ data: [{ id: "a1", client_id: "A", internal: false, deleted_at: null, body: "from A" }], error: null });
    dA.files.resolve({ data: null, error: { message: "late error" } });
    await pA;
    ["waiting", "messages", "files"].forEach((sec) => {
      assert.strictEqual(state[sec].clientId, "B", sec);
      assert.strictEqual(state[sec].status, "ok", sec);
    });
    assert.deepStrictEqual(state.messages.rows.map((m) => m.id), ["b1"]);
    assert.ok(!JSON.stringify(state).includes("from A"));
  });

  await t("a newer Retry of one section beats an older reply for it", async () => {
    const d1 = deferred();
    const sb1 = fakeSb({ waiting: () => d1.p });
    const sb2 = fakeSb({ waiting: { data: [{ task_id: "t2", title: "New", client_id: "c1", request_id: null }], error: null } });
    const seq = X.WB_cxSeq();
    const state = {};
    const apply = (sec, st) => (state[sec] = st);
    const p1 = X.WB_cxFetch(sb1, "c1", seq, ["waiting"], apply);
    await X.WB_cxFetch(sb2, "c1", seq, ["waiting"], apply);
    d1.resolve({ data: [{ task_id: "t1", title: "Old", client_id: "c1", request_id: null }], error: null });
    await p1;
    assert.deepStrictEqual(state.waiting.rows.map((r) => r.label), ["New"]);
    assert.strictEqual(sb1.calls.length + sb2.calls.length, 2, "one call per section load");
  });

  await t("no database client: errors, no throw", async () => {
    const seq = X.WB_cxSeq();
    const last = {};
    await X.WB_cxFetch(null, "c1", seq, null, (sec, st) => (last[sec] = st.status));
    assert.deepStrictEqual(last, { waiting: "error", messages: "error", files: "error" });
  });

  await t("load step: one full read per real client switch; hidden switch back to an earlier client reads again", async () => {
    const m = X.WB_cxMem("A");
    const runs = [];
    const step = (cid, showing) => {
      const r = X.WB_cxStep(m, cid, showing);
      runs.push((r.reset ? "reset+" : "") + (r.run || "none"));
    };
    step("A", true); // first show of A
    step("A", true); // double effect / re-render: nothing
    step("A", false); // tab hidden
    step("A", true); // shown again, nothing changed
    assert.deepStrictEqual(runs, ["all", "none", "none", "none"]);
    // Switch to B while hidden, then back to A while still hidden, then show:
    // A must be read again (its earlier replies may have been dropped).
    runs.length = 0;
    step("B", false);
    step("A", false);
    step("A", true);
    assert.deepStrictEqual(runs, ["reset+none", "reset+none", "all"]);
    // Visible switch A -> B -> A: one full read each time.
    runs.length = 0;
    step("B", true);
    step("A", true);
    assert.deepStrictEqual(runs, ["reset+all", "reset+all"]);
  });

  await t("requests-changed: reload Waiting now when showing, later when hidden, never before a load", async () => {
    const m = X.WB_cxMem("A");
    assert.strictEqual(X.WB_cxChanged(m, true), null, "nothing loaded yet");
    X.WB_cxStep(m, "A", true);
    assert.strictEqual(X.WB_cxChanged(m, true), "waiting");
    assert.strictEqual(X.WB_cxChanged(m, false), null);
    assert.strictEqual(m.dirty, true);
    assert.deepStrictEqual(X.WB_cxStep(m, "A", true), { reset: false, run: "waiting" });
    assert.deepStrictEqual(X.WB_cxStep(m, "A", true), { reset: false, run: null });
    // Switching clients forgets a pending reload.
    X.WB_cxChanged(m, false);
    assert.deepStrictEqual(X.WB_cxStep(m, "B", true), { reset: true, run: "all" });
  });

  console.log("WB_clientExtras: " + n + " tests passed");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
