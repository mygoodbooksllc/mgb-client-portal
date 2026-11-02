// Plain node, no framework: `node components/internal/MH_books.test.js`.
// Guards the MGB Home S4 Firm books logic (MH_books.js): the firm sync state,
// the close due line, close-check reasons and the firm P&L sums.

const assert = require("assert");
const B = require("./MH_books.js");

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

// Sync state ---------------------------------------------------------------
const now = Date.parse("2026-11-02T21:00:00Z");
const hAgo = (h) => new Date(now - h * 3600 * 1000).toISOString();

t("sync: no connection", () => assert.strictEqual(B.MH_bkSyncState(null, null, now).kind, "none"));
t("sync: disconnected reads as not connected", () => {
  const s = B.MH_bkSyncState({ status: "disconnected", last_synced_at: hAgo(1) }, { status: "error", started_at: hAgo(0.5) }, now);
  assert.deepStrictEqual([s.kind, s.warn], ["none", false]);
});
t("sync: connected, never synced", () => {
  const s = B.MH_bkSyncState({ status: "connected", last_synced_at: null }, null, now);
  assert.strictEqual(s.kind, "never");
  assert.strictEqual(s.warn, false);
});
t("sync: fresh is ok", () => {
  const s = B.MH_bkSyncState({ status: "connected", last_synced_at: hAgo(1) }, { status: "ok", started_at: hAgo(1) }, now);
  assert.deepStrictEqual([s.kind, s.warn, s.at], ["ok", false, hAgo(1)]);
});
t("sync: reconnect wins over everything", () => {
  const s = B.MH_bkSyncState({ status: "error", last_synced_at: hAgo(1) }, { status: "error", started_at: hAgo(0.5) }, now);
  assert.deepStrictEqual([s.kind, s.warn], ["reconnect", true]);
});
t("sync: failed run after the last good sync", () => {
  const s = B.MH_bkSyncState({ status: "connected", last_synced_at: hAgo(3) }, { status: "error", started_at: hAgo(1) }, now);
  assert.deepStrictEqual([s.kind, s.warn, s.failedAt], ["failed", true, hAgo(1)]);
});
t("sync: an old failed run before a good sync is ignored", () => {
  const s = B.MH_bkSyncState({ status: "connected", last_synced_at: hAgo(1) }, { status: "error", started_at: hAgo(3) }, now);
  assert.strictEqual(s.kind, "ok");
});
t("sync: failed and never synced reads as failed", () => {
  const s = B.MH_bkSyncState({ status: "connected", last_synced_at: null }, { status: "error", started_at: hAgo(1) }, now);
  assert.strictEqual(s.kind, "failed");
});
t("sync: stale after the threshold", () => {
  const s = B.MH_bkSyncState({ status: "connected", last_synced_at: hAgo(B.MH_BK_STALE_HOURS + 1) }, null, now);
  assert.deepStrictEqual([s.kind, s.warn], ["stale", true]);
});
t("sync: just under the threshold is ok", () => {
  const s = B.MH_bkSyncState({ status: "connected", last_synced_at: hAgo(B.MH_BK_STALE_HOURS - 1) }, null, now);
  assert.strictEqual(s.kind, "ok");
});
t("sync: bad date reads as never", () => {
  assert.strictEqual(B.MH_bkSyncState({ status: "connected", last_synced_at: "nope" }, null, now).kind, "never");
});

// Close due line -----------------------------------------------------------
const due = new Date(2026, 10, 15); // Nov 15, 2026 (October's close)
const nov2 = new Date(2026, 10, 2);
const nov20 = new Date(2026, 10, 20);
t("close: done and N/A have no line", () => {
  assert.strictEqual(B.MH_bkCloseNote("done", due, false, nov2), null);
  assert.strictEqual(B.MH_bkCloseNote("na", due, false, nov2), null);
});
t("close: open and due ahead", () => {
  const c = B.MH_bkCloseNote("in_progress", due, false, nov2);
  assert.deepStrictEqual([c.kind, c.warn, c.due.getTime()], ["due", false, due.getTime()]);
});
t("close: missing status reads as not started", () => assert.strictEqual(B.MH_bkCloseNote(null, due, false, nov2).kind, "due"));
t("close: due today is still due", () => assert.strictEqual(B.MH_bkCloseNote("not_started", due, false, new Date(2026, 10, 15, 18)).kind, "due"));
t("close: late warns", () => {
  const c = B.MH_bkCloseNote("in_progress", due, true, nov20);
  assert.deepStrictEqual([c.kind, c.warn], ["late", true]);
});
t("close: ready for sign-off is not late", () => {
  const c = B.MH_bkCloseNote("review", due, false, nov20);
  assert.deepStrictEqual([c.kind, c.warn], ["signoff", false]);
});
t("close: past due but not counted late has no line", () => {
  assert.strictEqual(B.MH_bkCloseNote("in_progress", new Date(2026, 9, 15), false, nov2), null);
});

// Reasons ------------------------------------------------------------------
t("reasons: first two and the rest counted", () => {
  assert.deepStrictEqual(B.MH_bkReasons({ reasons: ["a", "b", "c", "d"] }, 2), { shown: ["a", "b"], more: 2 });
});
t("reasons: blanks dropped, none is empty", () => {
  assert.deepStrictEqual(B.MH_bkReasons({ reasons: ["", null, " "] }), { shown: [], more: 0 });
  assert.deepStrictEqual(B.MH_bkReasons(null), { shown: [], more: 0 });
  assert.deepStrictEqual(B.MH_bkReasons({ reasons: "nope" }), { shown: [], more: 0 });
});

// P&L ----------------------------------------------------------------------
t("pnl: sums, net, margin", () => {
  const p = B.MH_bkPnl([
    { month: "Aug", year: 2026, income: 1000.1, expenses: 600.05 },
    { month: "Sep", year: 2026, income: "2000", expenses: 2500 },
  ]);
  assert.deepStrictEqual([p.income, p.expenses, p.net, p.margin], [3000.1, 3100.05, -99.95, -3.3]);
  assert.deepStrictEqual(p.rows.map((r) => [r.month, r.net]), [["Aug", 400.05], ["Sep", -500]]);
});
t("pnl: no income -> no margin", () => {
  const p = B.MH_bkPnl([{ month: "Sep", income: 0, expenses: 10 }]);
  assert.strictEqual(p.margin, null);
  assert.strictEqual(p.net, -10);
});
t("pnl: empty and junk", () => {
  assert.deepStrictEqual(B.MH_bkPnl(null), { income: 0, expenses: 0, net: 0, margin: null, rows: [] });
  const p = B.MH_bkPnl([{ month: "Oct", income: "x", expenses: undefined }]);
  assert.deepStrictEqual([p.income, p.expenses, p.net], [0, 0, 0]);
});

console.log("MH_books: " + n + " passed");
