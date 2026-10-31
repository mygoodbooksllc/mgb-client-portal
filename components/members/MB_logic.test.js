// Plain node, no framework: `node components/members/MB_logic.test.js`.
const assert = require("assert");
const L = require("./MB_logic.js");
const eq = assert.deepStrictEqual;
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

const rows = [
  { email: "ann@example.test", display_name: "Ann Lee", church_name: "Grace Church", access: ["kit", "course"], is_test: false, open_requests: 0, support_status: "none" },
  { email: "bob@example.test", display_name: null, church_name: null, access: ["client"], is_test: false, open_requests: 0, support_status: "none" },
  { email: "test@example.test", display_name: "Test Person", church_name: "Test Church", access: ["course"], is_test: true, open_requests: 0, support_status: "none" },
  { email: "help@example.test", display_name: "Hal Help", church_name: "River", access: ["client"], is_test: false, open_requests: 2, support_status: "open" },
];

t("access labels", () => {
  eq(L.MB_accessLabel("client"), "Client");
  eq(L.MB_accessLabel("course"), "Course");
  eq(L.MB_accessLabel("kit"), "Launch Kit");
  eq(L.MB_accessLabel("other"), "other");
  eq(L.MB_accessLabel(null), "");
});
t("access list order", () => {
  eq(L.MB_accessList(rows[0]), ["course", "kit"]);
  eq(L.MB_accessList({}), []);
});
t("search matches email, name, church, multi-word", () => {
  eq(L.MB_matchesQuery(rows[0], "ann@"), true);
  eq(L.MB_matchesQuery(rows[0], "LEE"), true);
  eq(L.MB_matchesQuery(rows[0], "grace"), true);
  eq(L.MB_matchesQuery(rows[0], "ann grace"), true);
  eq(L.MB_matchesQuery(rows[0], "zzz"), false);
  eq(L.MB_matchesQuery(rows[1], "  "), true);
  eq(L.MB_matchesQuery(rows[1], "bob"), true);
});
t("filter hides tests by default and counts without them", () => {
  eq(L.MB_filterRows(rows, {}).length, 3);
  eq(L.MB_filterRows(rows, { showTests: true }).length, 4);
  eq(L.MB_countRows(rows, false), 3);
  eq(L.MB_countRows(rows, true), 4);
});
t("filter by access", () => {
  eq(L.MB_filterRows(rows, { access: "course" }).map((r) => r.email), ["ann@example.test"]);
  eq(L.MB_filterRows(rows, { access: "course", showTests: true }).length, 2);
  eq(L.MB_filterRows(rows, { access: "all" }).length, 3);
});
t("filter needs support", () => {
  eq(L.MB_filterRows(rows, { needsSupport: true }).map((r) => r.email), ["help@example.test"]);
  eq(L.MB_filterRows(rows.slice(0, 2), { needsSupport: true }), []);
});
t("filter handles bad input", () => {
  eq(L.MB_filterRows(null, {}), []);
  eq(L.MB_filterRows([null], {}), []);
});
t("relative time", () => {
  const now = Date.parse("2026-10-31T12:00:00Z");
  eq(L.MB_relativeTime(null, now), "Never");
  eq(L.MB_relativeTime("garbage", now), "Never");
  eq(L.MB_relativeTime("2026-10-31T01:00:00Z", now), "Today");
  eq(L.MB_relativeTime("2026-10-30T01:00:00Z", now), "Yesterday");
  eq(L.MB_relativeTime("2026-10-28T12:00:00Z", now), "3 days ago");
  eq(L.MB_relativeTime("2026-10-10T12:00:00Z", now), "3 weeks ago");
  eq(L.MB_relativeTime("2026-07-01T12:00:00Z", now), "4 months ago");
  eq(L.MB_relativeTime("2023-10-01T12:00:00Z", now), "3 years ago");
  eq(L.MB_relativeTime("2027-01-01T00:00:00Z", now), "Today");
});
t("money", () => {
  eq(L.MB_money(15800), "$158");
  eq(L.MB_money(7900), "$79");
  eq(L.MB_money(15850), "$158.50");
  eq(L.MB_money(5), "$0.05");
  eq(L.MB_money(0), "$0");
  eq(L.MB_money(123456700), "$1,234,567");
  eq(L.MB_money("x"), "$0");
  eq(L.MB_money(-500), "-$5");
});
t("purchases summary", () => {
  eq(L.MB_purchasesSummary(0, 0, 0), "No purchases");
  eq(L.MB_purchasesSummary(1, 7900, 0), "1 purchase, $79");
  eq(L.MB_purchasesSummary(2, 15800, 0), "2 purchases, $158");
  eq(L.MB_purchasesSummary(2, 15800, 1), "2 purchases, $158, 1 refund");
  eq(L.MB_purchasesSummary(3, 100, 2), "3 purchases, $1, 2 refunds");
});
t("fmt date", () => {
  eq(L.MB_fmtDate("2026-10-01T00:00:00Z"), "Oct 1, 2026");
  eq(L.MB_fmtDate(null), "");
  eq(L.MB_fmtDate("nope"), "");
});
t("reason text", () => {
  eq(L.MB_reasonText("signin", ""), "Sign-in help");
  eq(L.MB_reasonText("purchase", "ignored"), "Purchase question");
  eq(L.MB_reasonText("other", ""), "");
  eq(L.MB_reasonText("other", "  refund  "), "Other: refund");
  eq(L.MB_reasonText("", ""), "");
  eq(L.MB_reasonText("other", "x".repeat(600)).length, 500);
});
t("support label and errors", () => {
  eq(L.MB_supportLabel("none"), "None");
  eq(L.MB_supportLabel(undefined), "None");
  eq(L.MB_supportLabel("open"), "Open");
  assert.ok(/access/.test(L.MB_errText({ code: "42501", message: "x" })));
  assert.ok(/reason/i.test(L.MB_errText({ code: "22023", message: "bad" })));
  eq(L.MB_errText(null), "Something went wrong. Try again.");
});

console.log("MB_logic: " + n + " checks passed");
