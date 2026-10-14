// gl-review-send's double-send guard (supabase/functions/gl-review-send/claim.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import * as C from "../../supabase/functions/gl-review-send/claim.ts";

// A tiny in-memory PostgREST stand-in: eq / neq / gte / is-null-or-lt (the one
// .or() shape claim.ts uses) / limit / select / single, applied atomically.
function fakeDb(tables) {
  let seq = 0;
  const db = { tables, calls: [] };
  db.from = (name) => {
    const rows = tables[name] || (tables[name] = []);
    const filters = [];
    let op = "select", patch = null, single = false, limit = Infinity;
    const q = {
      select() { return q; },
      insert(r) { op = "insert"; patch = r; return q; },
      update(p) { op = "update"; patch = p; return q; },
      eq(k, v) { filters.push((r) => r[k] === v); return q; },
      neq(k, v) { filters.push((r) => r[k] !== v); return q; },
      gte(k, v) { filters.push((r) => r[k] >= v); return q; },
      or(expr) {
        const m = /^sent_at\.is\.null,sent_at\.lt\."([^"]+)"$/.exec(expr);
        assert.ok(m, `unexpected or(): ${expr}`);
        filters.push((r) => r.sent_at == null || r.sent_at < m[1]);
        return q;
      },
      limit(n) { limit = n; return q; },
      single() { single = true; return q; },
      then(res, rej) {
        db.calls.push({ name, op, patch });
        let data;
        if (db.failNext && db.failNext(name, op)) {
          db.failNext = null;
          return Promise.resolve({ data: null, error: { message: "boom" } }).then(res, rej);
        }
        if (op === "insert") {
          const r = { id: `log-${++seq}`, created_at: new Date().toISOString(), ...patch };
          rows.push(r);
          data = single ? { id: r.id } : [{ id: r.id }];
        } else {
          const hit = rows.filter((r) => filters.every((f) => f(r))).slice(0, limit);
          if (op === "update") for (const r of hit) Object.assign(r, patch);
          data = hit.map((r) => ({ id: r.id }));
        }
        return Promise.resolve({ data, error: null }).then(res, rej);
      },
    };
    return q;
  };
  return db;
}

const SID = "11111111-1111-1111-1111-111111111111";
const draft = (extra = {}) => ({ id: SID, status: "draft", sent_at: null, sent_by: null, ...extra });

test("summary: first claim wins, the second (double click) is refused", async () => {
  const db = fakeDb({ gl_review_summaries: [draft()] });
  const [a, b] = await Promise.all([C.claimSummary(db, SID, "a@x"), C.claimSummary(db, SID, "b@x")]);
  assert.equal([a, b].filter((c) => c.claimed).length, 1);
  assert.deepEqual([a, b].find((c) => !c.claimed), { claimed: false });
  assert.ok(db.tables.gl_review_summaries[0].sent_at);
});

test("summary: a sent summary can't be claimed; a stale claim can be", async () => {
  const now = Date.parse("2026-10-14T12:00:00Z");
  const sent = fakeDb({ gl_review_summaries: [draft({ status: "sent", sent_at: "2026-10-14T11:59:00.000Z" })] });
  assert.equal((await C.claimSummary(sent, SID, "a@x", now)).claimed, false);
  const fresh = fakeDb({ gl_review_summaries: [draft({ sent_at: "2026-10-14T11:55:00.000Z", sent_by: "b@x" })] });
  assert.equal((await C.claimSummary(fresh, SID, "a@x", now)).claimed, false);
  const stale = fakeDb({ gl_review_summaries: [draft({ sent_at: "2026-10-14T11:40:00.000Z", sent_by: "b@x" })] });
  const c = await C.claimSummary(stale, SID, "a@x", now);
  assert.equal(c.claimed, true);
  assert.equal(stale.tables.gl_review_summaries[0].sent_by, "a@x");
});

test("summary: release clears only our own claim on a draft", async () => {
  const db = fakeDb({ gl_review_summaries: [draft()] });
  const c = await C.claimSummary(db, SID, "a@x");
  assert.equal(await C.releaseSummary(db, SID, "2000-01-01T00:00:00.000Z"), true); // not ours: no-op
  assert.equal(db.tables.gl_review_summaries[0].sent_by, "a@x");
  await C.releaseSummary(db, SID, c.claimIso);
  assert.equal(db.tables.gl_review_summaries[0].sent_at, null);
  assert.equal(db.tables.gl_review_summaries[0].sent_by, null);
  // A failing release never throws.
  db.failNext = () => true;
  assert.equal(await C.releaseSummary(db, SID, c.claimIso), false);
  assert.equal(await C.releaseSummary({ from() { throw new Error("down"); } }, SID, c.claimIso), false);
});

test("summary: a database error is reported, not treated as already sent", async () => {
  const db = fakeDb({ gl_review_summaries: [draft()] });
  db.failNext = () => true;
  const c = await C.claimSummary(db, SID, "a@x");
  assert.equal(c.claimed, false);
  assert.equal(c.error, "boom");
});

const row = { feature: "gl_review_question", reason: "question Q1", client_id: "c1", requested_by: "a@x", trigger: "manual" };
const noSleep = { sleep: async () => {} };

test("question: a lone send claims a 'sent' log row", async () => {
  const db = fakeDb({ client_email_log: [] });
  const c = await C.claimQuestion(db, row, noSleep);
  assert.equal(c.claimed, true);
  assert.equal(db.tables.client_email_log.length, 1);
  assert.equal(db.tables.client_email_log[0].status, "sent");
  assert.equal(db.tables.client_email_log[0].reason, "question Q1");
});

test("question: already sent recently -> already_sent, our row marked skipped", async () => {
  const db = fakeDb({ client_email_log: [{ id: "old", ...row, status: "sent", created_at: new Date().toISOString() }] });
  const c = await C.claimQuestion(db, row, noSleep);
  assert.deepEqual(c, { claimed: false, status: "already_sent" });
  const mine = db.tables.client_email_log.find((r) => r.id !== "old");
  assert.equal(mine.status, "skipped");
  assert.match(mine.reason, /duplicate send blocked/);
});

test("question: an old send outside the window doesn't block", async () => {
  const db = fakeDb({ client_email_log: [{ id: "old", ...row, status: "sent", created_at: new Date(Date.now() - 11 * 60 * 1000).toISOString() }] });
  assert.equal((await C.claimQuestion(db, row, noSleep)).claimed, true);
});

test("question: errors / skipped / test copies don't block", async () => {
  const now = new Date().toISOString();
  const db = fakeDb({ client_email_log: [
    { id: "e", ...row, status: "error", created_at: now },
    { id: "s", ...row, status: "skipped", created_at: now },
    { id: "t", ...row, reason: "question Q1 (test copy to sender)", status: "sent", created_at: now },
    { id: "o", ...row, reason: "question Q2", status: "sent", created_at: now },
  ] });
  assert.equal((await C.claimQuestion(db, row, noSleep)).claimed, true);
});

test("question: two requests at once -> exactly one sends", async () => {
  // Interleave: both insert, then both check. Each sees the other; both step
  // aside; neither sends -> both told to try again (never a double send).
  const db = fakeDb({ client_email_log: [] });
  const [a, b] = await Promise.all([C.claimQuestion(db, row, noSleep), C.claimQuestion(db, row, noSleep)]);
  const claimed = [a, b].filter((c) => c.claimed).length;
  assert.ok(claimed <= 1);
  for (const c of [a, b]) if (!c.claimed) assert.ok(c.status === "already_sent" || c.status === "error");

  // Sequential (the usual double click): the first claims, the second is already_sent.
  const db2 = fakeDb({ client_email_log: [] });
  const first = await C.claimQuestion(db2, row, noSleep);
  const second = await C.claimQuestion(db2, row, noSleep);
  assert.equal(first.claimed, true);
  assert.deepEqual(second, { claimed: false, status: "already_sent" });
});

test("question: can't write the claim row -> fail closed (error, no send)", async () => {
  const db = fakeDb({ client_email_log: [] });
  db.failNext = (_n, op) => op === "insert";
  const c = await C.claimQuestion(db, row, noSleep);
  assert.equal(c.claimed, false);
  assert.equal(c.status, "error");
});

test("question: the guard check fails -> error, our row marked error", async () => {
  const db = fakeDb({ client_email_log: [] });
  let n = 0;
  db.failNext = (_n, op) => op === "select" && ++n === 1;
  const c = await C.claimQuestion(db, row, noSleep);
  assert.equal(c.status, "error");
  assert.equal(db.tables.client_email_log[0].status, "error");
});

test("finishQuestion: updates the row, never throws", async () => {
  const db = fakeDb({ client_email_log: [{ id: "L", status: "sent" }] });
  assert.equal(await C.finishQuestion(db, "L", { status: "error" }), true);
  assert.equal(db.tables.client_email_log[0].status, "error");
  assert.equal(await C.finishQuestion({ from() { throw new Error("down"); } }, "L", {}), false);
});
