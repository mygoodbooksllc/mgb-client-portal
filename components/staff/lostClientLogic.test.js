// node components/staff/lostClientLogic.test.js
const assert = require("assert");
const L = require("./lostClientLogic.js");
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

const T = "2026-11-03";

t("LC_today is the local calendar day", () => {
  assert.strictEqual(L.LC_today(new Date(2026, 0, 5, 23, 59)), "2026-01-05");
  assert.strictEqual(L.LC_today(new Date(2026, 10, 3, 0, 1)), "2026-11-03");
});

t("LC_lostAt reads camelCase, the raw column, and timestamps", () => {
  assert.strictEqual(L.LC_lostAt({ lostAt: "2026-10-30" }), "2026-10-30");
  assert.strictEqual(L.LC_lostAt({ lost_at: "2026-10-30" }), "2026-10-30");
  assert.strictEqual(L.LC_lostAt({ lostAt: "2026-10-30T00:00:00Z" }), "2026-10-30");
  assert.strictEqual(L.LC_lostAt({ lostAt: null }), null);
  assert.strictEqual(L.LC_lostAt({ lostAt: "soon" }), null);
  assert.strictEqual(L.LC_lostAt(null), null);
});

t("empty = current, a future date = still current, today or earlier = lost", () => {
  assert.strictEqual(L.LC_isLost({ id: "a" }, T), false);
  assert.strictEqual(L.LC_isLost({ id: "a", lostAt: "2026-11-04" }, T), false);
  assert.strictEqual(L.LC_isLeaving({ id: "a", lostAt: "2026-11-04" }, T), true);
  assert.strictEqual(L.LC_isLost({ id: "a", lostAt: T }, T), true);
  assert.strictEqual(L.LC_isLeaving({ id: "a", lostAt: T }, T), false);
  assert.strictEqual(L.LC_isLost({ id: "a", lostAt: "2026-10-30" }, T), true);
});

t("LC_split keeps order and drops empty slots", () => {
  const s = L.LC_split([{ id: "a" }, null, { id: "b", lostAt: "2026-10-30" }, { id: "c", lostAt: "2027-01-01" }], T);
  assert.deepStrictEqual(s.current.map((c) => c.id), ["a", "c"]);
  assert.deepStrictEqual(s.lost.map((c) => c.id), ["b"]);
});

t("LC_checkDate refuses blanks, fake days and dates before 2000", () => {
  assert.strictEqual(L.LC_checkDate("2026-10-30"), null);
  assert.strictEqual(L.LC_checkDate("2000-01-01"), null);
  assert.ok(L.LC_checkDate(""));
  assert.ok(L.LC_checkDate("10/30/2026"));
  assert.ok(L.LC_checkDate("2026-02-30"));
  assert.ok(L.LC_checkDate("1999-12-31"));
});

t("LC_status words", () => {
  assert.strictEqual(L.LC_status({ lostAt: "2026-10-30" }, T), "Lost Oct 30, 2026");
  assert.strictEqual(L.LC_status({ lostAt: "2026-11-15" }, T), "Leaving Nov 15, 2026");
  assert.strictEqual(L.LC_status({}, T), "");
});

console.log("lostClientLogic: all " + n + " passed");
