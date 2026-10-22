// node components/tasks/TK_bookkeeperLogic.test.js
const assert = require("assert");
const L = require("./TK_bookkeeperLogic.js");
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

const staff = [
  { name: "Current Keeper", email: "two@example.test", active: true },
  { name: "Old Keeper", email: "One@Example.test", active: true },
  { name: "Inactive Person", email: "gone@example.test", active: false },
  { name: "No Email", email: "", active: true },
  { name: "Old Duplicate", email: "one@example.test", active: true },
  { name: "New Keeper", email: "three@example.test" },
];

t("eligible: active with email, current left out, sorted, no duplicates", () => {
  const out = L.TK_bkEligible(staff, "TWO@example.test");
  assert.deepStrictEqual(out.map((s) => s.name), ["New Keeper", "Old Keeper"]);
});
t("eligible: no current keeps everyone active", () => {
  assert.strictEqual(L.TK_bkEligible(staff, null).length, 3);
});
t("eligible: bad input is an empty list", () => {
  assert.deepStrictEqual(L.TK_bkEligible(null, "x"), []);
});

t("move label uses first names", () => {
  assert.strictEqual(L.TK_bkMoveLabel("Old Keeper", "New Keeper"), "Also move Old's open tasks on this client to New");
});
t("move label before a pick", () => {
  assert.strictEqual(L.TK_bkMoveLabel("Old Keeper", ""), "Also move Old's open tasks on this client to the new bookkeeper");
});
t("help text says what stays and that no email is sent", () => {
  const s = L.TK_bkHelpText("Old Keeper");
  assert.ok(s.indexOf("that Old owns") > 0);
  assert.ok(s.indexOf("Tasks in review, private tasks, and tasks anyone else owns or is on stay as they are.") > 0);
  assert.ok(s.indexOf("Old keeps access to the client.") > 0);
  assert.ok(/No email is sent\.$/.test(s));
});

t("confirm with moving", () => {
  assert.strictEqual(L.TK_bkConfirmText("Old Keeper", "New Keeper", "Client Co", true), "Make New the bookkeeper for Client Co? Old's open tasks here move to them.");
});
t("confirm without moving", () => {
  assert.strictEqual(L.TK_bkConfirmText("Old Keeper", "New Keeper", "", false), "Make New the bookkeeper for this client? Tasks stay where they are.");
});

t("success: none moved", () => {
  assert.strictEqual(L.TK_bkSuccessText({ tasks_moved: 0 }, "Old Keeper", "New Keeper"), "New is now the bookkeeper.");
});
t("success: one moved, one in review", () => {
  assert.strictEqual(
    L.TK_bkSuccessText({ tasks_moved: 1, tasks_in_review: 1 }, "Old Keeper", "New Keeper"),
    "New is now the bookkeeper. Moved 1 task from Old. 1 in review stays with Old.",
  );
});
t("success: many", () => {
  assert.strictEqual(
    L.TK_bkSuccessText({ tasks_moved: 12, tasks_in_review: 2 }, "Old Keeper", "New Keeper"),
    "New is now the bookkeeper. Moved 12 tasks from Old. 2 in review stay with Old.",
  );
});
t("success: missing result", () => {
  assert.strictEqual(L.TK_bkSuccessText(null, "", ""), "The new bookkeeper is now the bookkeeper.");
});

t("errors: each code has plain copy", () => {
  assert.strictEqual(L.TK_bkErrorText({ reason: "tk_forbidden" }), "Only admins can change the bookkeeper.");
  assert.strictEqual(L.TK_bkErrorText({ code: "tk_bad_assignee" }), "Pick someone who's active on staff.");
  assert.strictEqual(L.TK_bkErrorText({ message: "ERROR: tk_not_found" }), "We couldn't find that client.");
  assert.strictEqual(L.TK_bkErrorText("tk_same_bookkeeper"), "They're already the bookkeeper.");
  assert.strictEqual(L.TK_bkErrorText({ reason: "tk_no_team" }), "This client has no bookkeeper yet. Use Assign team.");
});
t("errors: unknown falls back (null)", () => {
  assert.strictEqual(L.TK_bkErrorText({ message: "network down" }), null);
  assert.strictEqual(L.TK_bkErrorText(null), null);
});
t("errors: which ones reload the header", () => {
  assert.strictEqual(L.TK_bkErrorReloads({ reason: "tk_same_bookkeeper" }), true);
  assert.strictEqual(L.TK_bkErrorReloads({ reason: "tk_no_team" }), true);
  assert.strictEqual(L.TK_bkErrorReloads({ reason: "tk_forbidden" }), false);
});
t("copy: no exclamation marks, US spelling", () => {
  const all = Object.values(L.TK_BK_ERRORS).join(" ") + L.TK_bkHelpText("A") + L.TK_bkConfirmText("A", "B", "C", true);
  assert.ok(all.indexOf("!") < 0);
  assert.ok(!/colour/i.test(all));
});

console.log(n + " checks passed");
