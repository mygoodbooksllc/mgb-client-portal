// node components/tasks/TK_mentionsLogic.test.js
// Slate plus @mention helpers (TK_mentionsLogic.js): the picker split (who can
// be mentioned vs who can't see the task), the note after posting, and "me".
const assert = require("assert");
const M = require("./TK_mentionsLogic.js");
const D = require("./TK_drawerLogic.js");

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
  { email: "ann.lee@example.test", name: "Ann Lee", active: true },
  { email: "andy@example.test", name: "Andy Park", active: true },
  { email: "amy@example.test", name: "Amy Ross", active: true },
  { email: "al@example.test", name: "Al Gone", active: false },
  { email: "me@example.test", name: "Me Myself", active: true },
  { email: "bo@example.test", name: "Bo Chen", active: true },
];
const emails = (list) => list.map((s) => s.email);

// ---- TKM_pickerLists
t("no candidates yet (null): the old list, nothing off", () => {
  const r = M.TKM_pickerLists("a", staff, null, D.TK_mentionMatches, "me@example.test");
  assert.deepStrictEqual(emails(r.pick), emails(D.TK_mentionMatches("a", staff, 6)));
  assert.deepStrictEqual(r.off, []);
});
t("candidates loaded: pick only candidates, off = matching non-candidates", () => {
  const r = M.TKM_pickerLists("a", staff, ["ann.lee@example.test", "AMY@example.test"], D.TK_mentionMatches, "me@example.test");
  assert.deepStrictEqual(emails(r.pick).sort(), ["amy@example.test", "ann.lee@example.test"]);
  assert.deepStrictEqual(emails(r.off), ["andy@example.test"]);
});
t("inactive staff never appear in either list", () => {
  const r = M.TKM_pickerLists("al", staff, [], D.TK_mentionMatches, "me@example.test");
  assert.deepStrictEqual(r.pick, []);
  assert.deepStrictEqual(r.off, []);
});
t("me is in neither list", () => {
  const r = M.TKM_pickerLists("me", staff, ["me@example.test"], D.TK_mentionMatches, "ME@example.test");
  assert.deepStrictEqual(r.pick, []);
  assert.deepStrictEqual(r.off, []);
});
t("off list is capped at 2, pick at 6", () => {
  const many = [];
  for (let i = 0; i < 10; i++) many.push({ email: "zz" + i + "@example.test", name: "Zz " + i, active: true });
  const r = M.TKM_pickerLists("zz", many, ["zz0@example.test", "zz1@example.test", "zz2@example.test", "zz3@example.test", "zz4@example.test", "zz5@example.test", "zz6@example.test"], D.TK_mentionMatches);
  assert.strictEqual(r.pick.length, 6);
  assert.strictEqual(r.off.length, 2);
});
t("empty candidates: nobody pickable, matches shown as off", () => {
  const r = M.TKM_pickerLists("bo", staff, [], D.TK_mentionMatches);
  assert.deepStrictEqual(r.pick, []);
  assert.deepStrictEqual(emails(r.off), ["bo@example.test"]);
});
t("no matcher: empty lists", () => {
  assert.deepStrictEqual(M.TKM_pickerLists("a", staff, [], null), { pick: [], off: [] });
});

// ---- TKM_postNote
const me = "me@example.test";
t("no mentions: no note", () => {
  const r = M.TKM_postNote({ body: "Looks good", staff, mentions: [], candidates: [], me });
  assert.strictEqual(r.text, "");
});
t("one notified", () => {
  const r = M.TKM_postNote({ body: "@andy please check", staff, mentions: ["andy@example.test"], candidates: ["andy@example.test"], me });
  assert.strictEqual(r.text, "Andy Park was notified.");
});
t("two notified, the same person twice counts once", () => {
  const r = M.TKM_postNote({ body: "@andy @amy and @andy again", staff, mentions: ["andy@example.test", "amy@example.test"], candidates: ["andy@example.test", "amy@example.test"], me });
  assert.strictEqual(r.text, "Andy Park and Amy Ross were notified.");
});
t("three names use commas", () => {
  const r = M.TKM_postNote({ body: "@andy @amy @bo", staff, mentions: ["andy@example.test", "amy@example.test", "bo@example.test"], candidates: null, me });
  assert.strictEqual(r.text, "Andy Park, Amy Ross and Bo Chen were notified.");
});
t("not in the saved mentions: can't see this task", () => {
  const r = M.TKM_postNote({ body: "@bo FYI", staff, mentions: [], candidates: ["bo@example.test"], me });
  assert.strictEqual(r.text, "Bo Chen can't see this task, so they weren't notified.");
});
t("saved but not a candidate (edge case): treated as not notified", () => {
  const r = M.TKM_postNote({ body: "@bo FYI", staff, mentions: ["bo@example.test"], candidates: [], me });
  assert.deepStrictEqual(r.missed, ["Bo Chen"]);
});
t("inactive and self", () => {
  const r = M.TKM_postNote({ body: "@al and @me", staff, mentions: [], candidates: [], me });
  assert.strictEqual(r.text, "Al Gone isn't an active staff member, so no notice was sent. You don't get a notice for mentioning yourself.");
});
t("unknown handles and emails are plain text", () => {
  const r = M.TKM_postNote({ body: "mail bo@example.test or @nobody.", staff, mentions: [], candidates: [], me });
  assert.strictEqual(r.text, "");
});
t("trailing dot after a handle still matches", () => {
  const r = M.TKM_postNote({ body: "Thanks @andy.", staff, mentions: ["andy@example.test"], candidates: ["andy@example.test"], me });
  assert.deepStrictEqual(r.notified, ["Andy Park"]);
});
t("handle with a dot (ann.lee)", () => {
  const r = M.TKM_postNote({ body: "@ann.lee hi", staff, mentions: ["ann.lee@example.test"], candidates: ["ann.lee@example.test"], me });
  assert.deepStrictEqual(r.notified, ["Ann Lee"]);
});
t("missing inputs don't throw", () => {
  assert.strictEqual(M.TKM_postNote().text, "");
  assert.strictEqual(M.TKM_postNote({ body: "@andy" }).text, "", "no staff list: nothing to name");
  assert.strictEqual(M.TKM_postNote({ body: "@andy", staff }).text, "Andy Park can't see this task, so they weren't notified.");
});

// ---- TKM_isMe
t("isMe matches my handle only", () => {
  assert.strictEqual(M.TKM_isMe("me", me), true);
  assert.strictEqual(M.TKM_isMe("@ME", me), true);
  assert.strictEqual(M.TKM_isMe("andy", me), false);
  assert.strictEqual(M.TKM_isMe("me", ""), false);
  assert.strictEqual(M.TKM_isMe("", me), false);
});

console.log("TK_mentionsLogic: " + n + " tests passed");
