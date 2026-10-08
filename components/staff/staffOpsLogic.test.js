// Plain node, no framework: `node components/staff/staffOpsLogic.test.js`.
// Guards the staff ops rules (staffOpsLogic.js).

const assert = require("assert");
const L = require("./staffOpsLogic.js");

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

// ---- Hours budget
t("no budget never flags", () => {
  assert.strictEqual(L.OPS_budgetStatus(600, null), null);
  assert.strictEqual(L.OPS_budgetStatus(600, ""), null);
  assert.strictEqual(L.OPS_budgetStatus(600, 0), null);
  assert.strictEqual(L.OPS_budgetStatus(600, "abc"), null);
});
t("unknown hours never flags", () => {
  assert.strictEqual(L.OPS_budgetStatus(null, 10), null);
});
t("budget thresholds", () => {
  assert.strictEqual(L.OPS_budgetStatus(0, 10).state, "ok");
  assert.strictEqual(L.OPS_budgetStatus(479, 10).state, "ok");
  assert.strictEqual(L.OPS_budgetStatus(480, 10).state, "near");
  assert.strictEqual(L.OPS_budgetStatus(599, 10).state, "near");
  assert.strictEqual(L.OPS_budgetStatus(600, 10).state, "over");
  assert.strictEqual(L.OPS_budgetStatus(900, "10").pct, 150);
});
t("budget rule matching", () => {
  const near = L.OPS_budgetStatus(500, 10);
  const over = L.OPS_budgetStatus(700, 10);
  const ok = L.OPS_budgetStatus(60, 10);
  assert.ok(L.OPS_budgetMatches("any", null));
  assert.ok(!L.OPS_budgetMatches("over", null));
  assert.ok(!L.OPS_budgetMatches("near", null));
  assert.ok(L.OPS_budgetMatches("near", near) && L.OPS_budgetMatches("near", over) && !L.OPS_budgetMatches("near", ok));
  assert.ok(L.OPS_budgetMatches("over", over) && !L.OPS_budgetMatches("over", near));
});

// ---- Reply times
t("wait formatting", () => {
  assert.strictEqual(L.OPS_fmtWait(null), "\u2014");
  assert.strictEqual(L.OPS_fmtWait(0), "1 min");
  assert.strictEqual(L.OPS_fmtWait(0.75), "45 min");
  assert.strictEqual(L.OPS_fmtWait(3.24), "3.2 h");
  assert.strictEqual(L.OPS_fmtWait(5), "5 h");
  assert.strictEqual(L.OPS_fmtWait(47.9), "47.9 h");
  assert.strictEqual(L.OPS_fmtWait(50.4), "2.1 days");
  assert.strictEqual(L.OPS_fmtWait(72), "3 days");
  assert.strictEqual(L.OPS_REPLY_GOAL_HOURS, 24);
});
t("reply periods", () => {
  assert.deepStrictEqual(L.OPS_replyPeriod("month", "2026-10-07"), { from: "2026-10-01", to: "2026-10-07" });
  assert.deepStrictEqual(L.OPS_replyPeriod("last-month", "2026-10-07"), { from: "2026-09-01", to: "2026-09-30" });
  assert.deepStrictEqual(L.OPS_replyPeriod("last-month", "2026-01-15"), { from: "2025-12-01", to: "2025-12-31" });
  assert.deepStrictEqual(L.OPS_replyPeriod("90", "2026-10-07"), { from: "2026-07-10", to: "2026-10-07" });
  assert.deepStrictEqual(L.OPS_replyPeriod("last-month", "2026-03-31"), { from: "2026-02-01", to: "2026-02-28" });
});

// ---- Time off
t("out until chains back-to-back entries", () => {
  const rows = [
    { staff_email: "A@x.org", starts_on: "2026-10-05", ends_on: "2026-10-09" },
    { staff_email: "a@x.org", starts_on: "2026-10-10", ends_on: "2026-10-13" },
    { staff_email: "a@x.org", starts_on: "2026-10-20", ends_on: "2026-10-21" },
    { staff_email: "b@x.org", starts_on: "2026-10-01", ends_on: "2026-10-30", cancelled_at: "2026-10-02T00:00:00Z" },
  ];
  assert.strictEqual(L.OPS_outUntil(rows, "a@x.org", "2026-10-07"), "2026-10-13");
  assert.strictEqual(L.OPS_outUntil(rows, "a@x.org", "2026-10-14"), null);
  assert.strictEqual(L.OPS_outUntil(rows, "a@x.org", "2026-10-21"), "2026-10-21");
  assert.strictEqual(L.OPS_outUntil(rows, "b@x.org", "2026-10-07"), null);
  assert.strictEqual(L.OPS_outUntil(rows, "", "2026-10-07"), null);
  assert.strictEqual(L.OPS_addDays("2026-02-28", 1), "2026-03-01");
});
t("upcoming time off and validation", () => {
  const rows = [
    { staff_email: "a@x.org", starts_on: "2026-11-01", ends_on: "2026-11-02" },
    { staff_email: "a@x.org", starts_on: "2026-10-01", ends_on: "2026-10-03" },
    { staff_email: "b@x.org", starts_on: "2026-10-08", ends_on: "2026-10-09" },
  ];
  assert.deepStrictEqual(L.OPS_upcomingTimeOff(rows, "2026-10-07").map((r) => r.starts_on), ["2026-10-08", "2026-11-01"]);
  assert.strictEqual(L.OPS_upcomingTimeOff(rows, "2026-10-07", "A@x.org").length, 1);
  assert.ok(L.OPS_timeOffError("", "2026-10-09", "2026-10-07"));
  assert.ok(L.OPS_timeOffError("2026-10-09", "2026-10-08", "2026-10-07"));
  assert.ok(L.OPS_timeOffError("2026-10-01", "2026-10-02", "2026-10-07"));
  assert.ok(L.OPS_timeOffError("2026-10-07", "2027-10-09", "2026-10-07"));
  assert.strictEqual(L.OPS_timeOffError("2026-10-01", "2026-10-07", "2026-10-07"), null);
  assert.strictEqual(L.OPS_BACKUP_ACCESS.none.tone, "bad");
});

console.log("staffOpsLogic: " + n + " checks passed");
