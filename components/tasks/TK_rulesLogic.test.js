// Plain node, no framework: `node components/tasks/TK_rulesLogic.test.js`.
// Guards Slate plus Rules (TK_rulesLogic.js): the trigger/action matrix matches
// the SQL, the problem messages match tk__rule_problem word for word, the save
// payload, the sentence a rule reads as, the loop guard, and who may switch a
// rule on (owner only) or off (any full admin).

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const R = require("./TK_rulesLogic.js");

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

const sql = fs.readFileSync(path.join(__dirname, "..", "..", "supabase", "slateplus-rules.sql"), "utf8");

t("pair matrix matches tk__rule_pair_ok in the SQL", () => {
  const body = sql.slice(sql.indexOf("function public.tk__rule_pair_ok"), sql.indexOf("create table if not exists public.tk_rules"));
  const pairs = [];
  body.replace(/\('([a-z_]+)', '([a-z_]+)'\)/g, (m, a, b) => pairs.push(a + ">" + b));
  const mine = [];
  Object.keys(R.TKRU_PAIRS).forEach((k) => R.TKRU_PAIRS[k].forEach((a) => mine.push(k + ">" + a)));
  assert.deepStrictEqual(mine.sort(), pairs.sort());
  assert.strictEqual(pairs.length, 13);
});

t("every problem message the page uses is in the SQL word for word", () => {
  const src = fs.readFileSync(path.join(__dirname, "TK_rulesLogic.js"), "utf8");
  const fn = src.slice(src.indexOf("function TKRU_validate"), src.indexOf("function TKRU_loopDecision"));
  const msgs = [];
  fn.replace(/return "([^"]+)"/g, (m, s) => msgs.push(s));
  assert.ok(msgs.length >= 15);
  msgs.forEach((m) => assert.ok(sql.indexOf("'" + m.replace(/'/g, "''") + "'") >= 0, "missing in SQL: " + m));
  ["Loop guard: too many rules in a row.", "Loop guard: this rule already ran for this change."].forEach((m) => assert.ok(sql.indexOf(m) >= 0, m));
});

t("pairOk and actionsFor", () => {
  assert.ok(R.TKRU_pairOk("done", "move_section"));
  assert.ok(!R.TKRU_pairOk("done", "assign"));
  assert.ok(!R.TKRU_pairOk("nope", "comment"));
  assert.deepStrictEqual(R.TKRU_actionsFor("assigned"), ["set_due", "move_section", "comment"]);
  assert.deepStrictEqual(R.TKRU_actionsFor("x"), []);
});

const base = () => Object.assign(R.TKRU_blankDraft(), { name: "Review hand-off", project_id: "p1", trigger_section: "Review", assign_email: "Jane@X.com" });
const ctx = { project: { id: "p1", sections: ["Prep", "Review", "Wrap"], trashed_at: null }, staffEmails: ["jane@x.com", "bo@x.com"] };

t("payload: only server keys, lowercased emails, numbers", () => {
  const p = R.TKRU_payload(base());
  assert.deepStrictEqual(p, {
    name: "Review hand-off",
    scope_kind: "project",
    project_id: "p1",
    client_id: null,
    trigger_kind: "section_moved",
    trigger_config: { section: "Review" },
    action_kind: "assign",
    action_config: { email: "jane@x.com" },
  });
  const d = Object.assign(base(), { id: "r1", trigger_kind: "assigned", trigger_email: "", action_kind: "set_due", due_days: "2", due_business: true });
  const q = R.TKRU_payload(d);
  assert.strictEqual(q.id, "r1");
  assert.deepStrictEqual(q.trigger_config, {});
  assert.deepStrictEqual(q.action_config, { days: 2, business: true });
  const f = R.TKRU_payload(Object.assign(base(), { trigger_kind: "done", action_kind: "follow_up", follow_title: " Call back ", follow_days: "", follow_assignee: "same" }));
  assert.deepStrictEqual(f.action_config, { title: "Call back", days: null, assignee: "same" });
  const c = R.TKRU_payload(Object.assign(base(), { scope_kind: "client", client_id: 42, trigger_kind: "overdue", action_kind: "comment", comment_text: "Late" }));
  assert.strictEqual(c.project_id, null);
  assert.strictEqual(c.client_id, "42");
});

t("draftFromRule round-trips through payload", () => {
  const rule = Object.assign({ id: "r9", enabled: false }, R.TKRU_payload(Object.assign(base(), { trigger_kind: "done", action_kind: "follow_up", follow_title: "Next", follow_days: "5", follow_assignee: "bo@x.com" })));
  const back = R.TKRU_payload(R.TKRU_draftFromRule(rule));
  delete rule.enabled;
  assert.deepStrictEqual(back, rule);
  assert.deepStrictEqual(R.TKRU_draftFromRule(null), R.TKRU_blankDraft());
});

t("validate: ok and each problem", () => {
  assert.strictEqual(R.TKRU_validate(base(), ctx), null);
  const v = (patch, c) => R.TKRU_validate(Object.assign(base(), patch), c === undefined ? ctx : c);
  assert.strictEqual(v({ name: "  " }), "Give the rule a name (up to 80 characters).");
  assert.strictEqual(v({ name: "x".repeat(81) }), "Give the rule a name (up to 80 characters).");
  assert.strictEqual(v({ project_id: "" }), "Pick a project.");
  assert.strictEqual(v({}, { project: null }), "Pick a project.");
  assert.strictEqual(v({}, { project: { sections: ["Review"], trashed_at: "2026-10-01" } }), "That project is in the trash.");
  assert.strictEqual(v({ scope_kind: "client", client_id: "" }), "Pick a client.");
  assert.strictEqual(v({ trigger_kind: "bad" }), "Pick when the rule runs.");
  assert.strictEqual(v({ action_kind: "tag" }), "Pick what the rule does.");
  assert.strictEqual(v({ trigger_kind: "done", action_kind: "assign" }), "That action does not go with that trigger.");
  assert.strictEqual(v({ scope_kind: "client", client_id: "7" }), "Section rules need a project.");
  assert.strictEqual(v({ trigger_section: "Gone" }), "Pick a section of the project.");
  assert.strictEqual(v({ trigger_kind: "assigned", trigger_email: "old@x.com", action_kind: "comment", comment_text: "hi" }), "Pick an active teammate (or anyone).");
  assert.strictEqual(v({ assign_email: "" }), "Pick an active teammate to assign.");
  assert.strictEqual(v({ assign_email: "old@x.com" }), "Pick an active teammate to assign.");
  assert.strictEqual(v({ action_kind: "set_due", due_days: "400" }), "Days must be 0 to 365.");
  assert.strictEqual(v({ action_kind: "set_due", due_days: "1.5" }), "Days must be 0 to 365.");
  assert.strictEqual(v({ action_kind: "set_due", due_days: "0" }), null);
  assert.strictEqual(v({ scope_kind: "client", client_id: "7", trigger_kind: "done", action_kind: "move_section", move_section: "Wrap" }), "Moving to a section needs a project.");
  assert.strictEqual(v({ trigger_kind: "done", action_kind: "move_section", move_section: "Nope" }), "Pick a section of the project.");
  assert.strictEqual(v({ trigger_kind: "done", action_kind: "comment", comment_text: "" }), "Write the comment (up to 1000 characters).");
  assert.strictEqual(v({ trigger_kind: "done", action_kind: "follow_up", follow_title: "" }), "Write the follow-up title (up to 200 characters).");
  assert.strictEqual(v({ trigger_kind: "done", action_kind: "follow_up", follow_title: "a", follow_days: "-1" }), "Days must be 0 to 365.");
  assert.strictEqual(v({ trigger_kind: "done", action_kind: "follow_up", follow_title: "a", follow_assignee: "old@x.com" }), "Pick an active teammate for the follow-up.");
  assert.strictEqual(v({ trigger_kind: "done", action_kind: "follow_up", follow_title: "a" }), null);
});

t("validate without context leaves people and sections to the server", () => {
  assert.strictEqual(R.TKRU_validate(Object.assign(base(), { trigger_section: "Anything", assign_email: "who@x.com" })), null);
});

t("loop guard mirrors tk__rule_fire", () => {
  assert.deepStrictEqual(R.TKRU_loopDecision(0, [], "r1"), { run: true, reason: "" });
  assert.deepStrictEqual(R.TKRU_loopDecision(1, ["r2"], "r1"), { run: true, reason: "" });
  assert.strictEqual(R.TKRU_loopDecision(2, [], "r1").reason, "Loop guard: too many rules in a row.");
  assert.strictEqual(R.TKRU_loopDecision(1, ["r1"], "r1").reason, "Loop guard: this rule already ran for this change.");
  assert.strictEqual(R.TKRU_loopDecision(null, null, "r1").run, true);
});

t("describe reads as one sentence", () => {
  const c = { projectName: () => "Onboarding: Acme", clientName: () => "Acme", staffName: (e) => (e === "jane@x.com" ? "Jane" : "") };
  assert.strictEqual(R.TKRU_describe(R.TKRU_payload(base()), c), "When a task moves to Review in Onboarding: Acme, assign it to Jane.");
  assert.strictEqual(
    R.TKRU_describe(R.TKRU_payload(Object.assign(base(), { trigger_kind: "assigned", action_kind: "set_due", due_days: "1", due_business: true })), c),
    "When a task is assigned in Onboarding: Acme, set the due date 1 business day later.",
  );
  assert.strictEqual(
    R.TKRU_describe(R.TKRU_payload(Object.assign(base(), { scope_kind: "client", client_id: "7", trigger_kind: "overdue", action_kind: "comment", comment_text: "x" })), c),
    "When a task becomes overdue for Acme, post a System comment.",
  );
  assert.strictEqual(
    R.TKRU_describe(R.TKRU_payload(Object.assign(base(), { trigger_kind: "done", action_kind: "follow_up", follow_title: "Call", follow_days: "3", follow_assignee: "bo@x.com" })), c),
    'When a task is marked done in Onboarding: Acme, add a follow-up "Call" for bo@x.com, due 3 days later.',
  );
  assert.ok(/^When something happens/.test(R.TKRU_describe({}, {})));
});

t("canToggle: owner turns on, any full admin turns off, archived never", () => {
  const owner = { role: "admin", isInternalOwner: true };
  const admin = { role: "admin", isInternalOwner: false };
  const temp = { role: "temp_admin", isInternalOwner: false };
  assert.ok(R.TKRU_canToggle(owner, {}, true));
  assert.ok(!R.TKRU_canToggle(admin, {}, true));
  assert.ok(R.TKRU_canToggle(admin, {}, false));
  assert.ok(!R.TKRU_canToggle(temp, {}, false));
  assert.ok(!R.TKRU_canToggle(owner, { archived_at: "x" }, true));
  assert.ok(!R.TKRU_canToggle(null, {}, false));
});

t("labels, gate note and error text", () => {
  assert.strictEqual(R.TKRU_runLabel("ok"), "Done");
  assert.strictEqual(R.TKRU_runLabel("zzz"), "Unknown");
  assert.strictEqual(R.TKRU_dryLabel("do"), "Would change");
  assert.ok(/not running/.test(R.TKRU_gateNote(false)));
  assert.strictEqual(R.TKRU_gateNote(true), "Rules run for rules that are switched on.");
  assert.strictEqual(R.TKRU_errorText({ code: "tk_forbidden" }), "Only admins can manage rules.");
  assert.strictEqual(R.TKRU_errorText(null), "Couldn't do that. Try again.");
});

t("US spelling and no 'colour' in user text", () => {
  const src = fs.readFileSync(path.join(__dirname, "TK_rulesLogic.js"), "utf8");
  assert.ok(!/colour|behaviour|organis/i.test(src));
});

console.log("TK_rulesLogic.test.js: " + n + " passed");
