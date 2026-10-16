// Plain node, no framework: `node components/workbench/WB_logic.test.js`.
// Guards the Workbench rules (WB_logic.js, spec C): groups across a
// weekend, rank order, deterministic sort, no-due fallbacks, snooze and its
// version check, chip counts, the ack rule (parity with wb_is_ack), actions
// and links per kind, keys, snooze presets and Today's rows fed in.

const assert = require("assert");
const L = require("./WB_logic.js");

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
const NOW = Date.parse("2026-10-14T17:00:00Z"); // noon in Chicago (CDT)
let seq = 0;
function row(over) {
  seq++;
  return Object.assign(
    {
      item_key: "task:task:" + String(seq).padStart(4, "0"),
      source: "task",
      kind: "task",
      source_id: "id" + seq,
      version: "todo|",
      client_id: "c1",
      client_name: "Acme",
      title: "Row " + seq,
      due_date: TODAY,
      waiting_since: "2026-10-10T12:00:00Z",
      status: "todo",
      snoozed_until: null,
      cleared: false,
    },
    over || {},
  );
}

// ---- dates
t("today is the Chicago calendar day", () => {
  assert.strictEqual(L.WB_today(Date.parse("2026-10-15T04:30:00Z")), "2026-10-14"); // 11:30pm CDT
  assert.strictEqual(L.WB_today(Date.parse("2026-10-15T05:30:00Z")), "2026-10-15");
  assert.strictEqual(L.WB_today(Date.parse("2026-12-15T05:30:00Z")), "2026-12-14"); // CST, -6
});
t("business days skip the weekend", () => {
  assert.strictEqual(L.WB_addBusinessDays("2026-10-16", 1), "2026-10-19"); // Fri → Mon
  assert.strictEqual(L.WB_addBusinessDays("2026-10-17", 1), "2026-10-19"); // Sat → Mon
  assert.strictEqual(L.WB_addBusinessDays("2026-10-14", 2), "2026-10-16");
  assert.strictEqual(L.WB_addBusinessDays("2026-10-17", 0), "2026-10-19");
});
t("chicagoAt is DST-safe", () => {
  assert.strictEqual(new Date(L.WB_chicagoAt("2026-10-15", 8, 0)).toISOString(), "2026-10-15T13:00:00.000Z");
  assert.strictEqual(new Date(L.WB_chicagoAt("2026-11-02", 8, 0)).toISOString(), "2026-11-02T14:00:00.000Z");
  assert.strictEqual(new Date(L.WB_chicagoAt("2026-11-01", 8, 0)).toISOString(), "2026-11-01T14:00:00.000Z"); // switch day
});

// ---- groups
t("group boundaries", () => {
  assert.strictEqual(L.WB_groupOf(row({ due_date: "2026-10-13" }), TODAY), "overdue");
  assert.strictEqual(L.WB_groupOf(row({ due_date: TODAY }), TODAY), "today");
  assert.strictEqual(L.WB_groupOf(row({ due_date: "2026-10-15" }), TODAY), "week");
  assert.strictEqual(L.WB_groupOf(row({ due_date: "2026-10-21" }), TODAY), "week"); // +7
  assert.strictEqual(L.WB_groupOf(row({ due_date: "2026-10-22" }), TODAY), "later"); // +8
});
t("group boundaries across a weekend", () => {
  const sat = "2026-10-17";
  const mon = "2026-10-19";
  assert.strictEqual(L.WB_groupOf(row({ due_date: "2026-10-16" }), mon), "overdue"); // Friday item on Monday
  assert.strictEqual(L.WB_groupOf(row({ due_date: mon }), sat), "week");
  // Waiting with no due since Friday afternoon: 1 business day later is Monday.
  const fri = row({ due_date: null, waiting_since: "2026-10-16T20:00:00Z" });
  assert.strictEqual(L.WB_groupOf(fri, sat), "week");
  assert.strictEqual(L.WB_groupOf(fri, mon), "today");
});
t("no-due fallbacks", () => {
  assert.strictEqual(L.WB_groupOf(row({ due_date: null, waiting_since: "2026-10-12T15:00:00Z" }), TODAY), "today");
  assert.strictEqual(L.WB_groupOf(row({ due_date: null, waiting_since: "2026-10-14T15:00:00Z" }), TODAY), "week");
  assert.strictEqual(L.WB_groupOf(row({ due_date: null, waiting_since: null }), TODAY), "week");
  assert.strictEqual(L.WB_groupOf({ source: "other", group: "today" }, TODAY), "today");
});

// ---- rank and sort
t("rank ordering", () => {
  const k = (kind, extra) => L.WB_rank(row(Object.assign({ kind: kind }, extra || {})));
  assert.strictEqual(k("task_review"), 0);
  assert.strictEqual(k("gl_approve"), 0);
  assert.strictEqual(k("client_answered"), 0);
  assert.strictEqual(k("gl_answer"), 0);
  assert.strictEqual(k("message"), 1);
  assert.strictEqual(k("doc_request"), 1);
  assert.strictEqual(k("doc_upload"), 1);
  assert.strictEqual(k("task_sent_back"), 2);
  assert.strictEqual(k("gl_sent_back"), 2);
  assert.strictEqual(k("task"), 3);
  assert.strictEqual(k("gl_flags", { severity: "high" }), 3);
  assert.strictEqual(k("gl_flags", { severity: "medium" }), 4);
  assert.strictEqual(L.WB_rank({ source: "other", kind: "other" }), 5);
});
t("deterministic sort: rank, due, waiting, client, key", () => {
  const a = row({ item_key: "task:task:b", kind: "task", client_name: "Zed" });
  const b = row({ item_key: "review:task_review:a", kind: "task_review", source: "review" });
  const c = row({ item_key: "task:task:a", kind: "task", client_name: "Zed" });
  const d = row({ item_key: "task:task:c", kind: "task", client_name: "Alpha" });
  const e = row({ item_key: "task:task:d", kind: "task", waiting_since: "2026-10-01T00:00:00Z" });
  const f = row({ item_key: "task:task:e", kind: "task", due_date: "2026-10-13" });
  const order = L.WB_sort([a, b, c, d, e, f]).map((r) => r.item_key);
  assert.deepStrictEqual(order, ["review:task_review:a", "task:task:e", "task:task:d", "task:task:c", "task:task:a", "task:task:b"]);
  // Same input in another order gives the same output.
  assert.deepStrictEqual(L.WB_sort([f, e, d, c, b, a]).map((r) => r.item_key), order);
});

// ---- snooze
t("snoozed rows hide until the time passes", () => {
  const r = row({ snoozed_until: "2026-10-14T20:00:00Z" });
  assert.strictEqual(L.WB_isSnoozed(r, NOW), true);
  assert.strictEqual(L.WB_isSnoozed(r, Date.parse("2026-10-14T21:00:00Z")), false);
});
t("version change un-snoozes", () => {
  const r = row({ snoozed_until: "2026-10-20T00:00:00Z", snoozed_version: "v1", version: "v1" });
  assert.strictEqual(L.WB_isSnoozed(r, NOW), true);
  assert.strictEqual(L.WB_isSnoozed(Object.assign({}, r, { version: "v2" }), NOW), false);
});

// ---- view model
t("chip counts are after snooze, before the source filter", () => {
  const rows = [
    row({ kind: "task", source: "task" }),
    row({ kind: "message", source: "message", item_key: "message:message:1" }),
    row({ kind: "message", source: "message", item_key: "message:message:2", snoozed_until: "2026-10-15T00:00:00Z" }),
    row({ kind: "gl_flags", source: "gl", severity: "high", item_key: "gl:gl_flags:c1|2026-09", due_date: "2026-10-13" }),
    row({ kind: "task_review", source: "review", item_key: "review:task_review:9", due_date: "2026-10-16" }),
    row({ kind: "task", source: "task", item_key: "task:task:far", due_date: "2026-11-30" }),
    row({ kind: "task", source: "task", item_key: "task:task:gone", cleared: true }),
  ].concat(L.WB_fromToday({ now: [{ key: "d1", kind: "deadline", title: "Deadline" }], week: [] }));
  const v = L.WB_build(rows, { today: TODAY, now: NOW, chip: "message" });
  assert.deepStrictEqual(v.counts, { all: 5, task: 1, review: 1, message: 1, gl: 1, doc: 0, other: 1, snoozed: 1 });
  assert.strictEqual(v.later, 1);
  assert.strictEqual(v.visible, 1);
  assert.strictEqual(v.groups[0].rows[0].item_key, "message:message:1");
  assert.deepStrictEqual(v.tiles, { reply: 1, dueToday: 3, overdue: 1, reviews: 1 });
  assert.strictEqual(v.badge, 3); // overdue + today, server rows only
  const all = L.WB_build(rows, { today: TODAY, now: NOW, chip: "all" });
  assert.deepStrictEqual(all.groups.map((g) => g.id + ":" + g.rows.length), ["overdue:1", "today:3", "week:1"]);
  const sn = L.WB_build(rows, { today: TODAY, now: NOW, chip: "snoozed" });
  assert.strictEqual(sn.visible, 1);
  assert.strictEqual(sn.groups[0].rows[0].item_key, "message:message:2");
});
t("empty input", () => {
  const v = L.WB_build([], { today: TODAY, now: NOW });
  assert.strictEqual(v.visible, 0);
  assert.deepStrictEqual(v.groups, []);
  assert.strictEqual(L.WB_nextRow(v), null);
});
t("drawer tabs map to chips", () => {
  assert.strictEqual(L.WB_drawerChip("doc"), "doc");
  assert.strictEqual(L.WB_drawerChip("gl"), "all");
});

// ---- ack rule (parity with wb_is_ack: every case below was checked live
// against the SQL function on 2026-10-16 with the same results)
t("ack rule: positive", () => {
  ["Thanks!", "ok, thank you.", "Got it 👍", "  Sounds good  ", "THANK YOU SO MUCH", "ok ok", "👍", "Perfect, thanks!", "kk"].forEach((s) =>
    assert.strictEqual(L.WB_isAck(s), true, s),
  );
});
t("ack rule: negative", () => {
  [
    "Thanks? ",
    "Thanks, can you send the file",
    "",
    null,
    "okay but the March numbers look off",
    "ok?",
    "thanks " + "x".repeat(60),
    "Thank you, attached",
    "thanks for the file",
  ].forEach((s) => assert.strictEqual(L.WB_isAck(s), false, String(s)));
});

// ---- actions and links
t("primary action per kind", () => {
  assert.strictEqual(L.WB_primaryAction(row({ kind: "task", status: "todo" })).id, "start");
  assert.strictEqual(L.WB_primaryAction(row({ kind: "task", status: "in_progress" })).id, "open");
  assert.strictEqual(L.WB_primaryAction(row({ kind: "message" })).label, "Reply");
  assert.strictEqual(L.WB_primaryAction(row({ kind: "doc_upload" })).label, "File");
  assert.strictEqual(L.WB_primaryAction(row({ kind: "gl_approve" })).label, "Review");
  assert.strictEqual(L.WB_primaryAction({ source: "other", kind: "other" }), null);
});
t("menu actions per kind", () => {
  const ids = (r) => L.WB_menuActions(r).map((a) => a.id);
  assert.deepStrictEqual(ids(row({ kind: "task", status: "todo" })), ["open", "snooze"]);
  assert.deepStrictEqual(ids(row({ kind: "message" })), ["noreply", "snooze"]);
  assert.deepStrictEqual(ids(row({ kind: "doc_upload" })), ["checked", "snooze"]);
  assert.deepStrictEqual(ids(row({ kind: "client_answered", source_id: "r1", ref_id: "t1" })), ["request", "snooze"]);
  assert.deepStrictEqual(ids({ source: "other" }), []);
  assert.strictEqual(L.WB_clearAction(row({ kind: "message" })), "noreply");
  assert.strictEqual(L.WB_clearAction(row({ kind: "task" })), null);
});
t("link per kind", () => {
  assert.deepStrictEqual(L.WB_linkTarget(row({ kind: "task", source_id: "T" })).t, { place: "work", tab: "tasks", item: "task:T" });
  assert.deepStrictEqual(L.WB_linkTarget(row({ kind: "task_review", source_id: "T" })).t, { place: "tasks", tab: "review", item: "task:T" });
  const m = L.WB_linkTarget(row({ kind: "message", source_id: "M1", ref_id: "M9", participant_email: "p@x.test" }));
  assert.deepStrictEqual(m.t, { clientId: "c1", tab: "messages", item: "msg:M9" });
  assert.deepStrictEqual(m.hint, { email: "p@x.test" });
  assert.deepStrictEqual(L.WB_linkTarget(row({ kind: "gl_flags", period: "2026-09" })).t, { clientId: "c1", tab: "ledger", month: "2026-09" });
  assert.strictEqual(L.WB_linkTarget(row({ kind: "gl_answer", source_id: "Q", period: "2026-09" })).t.item, "question:Q");
  assert.strictEqual(L.WB_linkTarget(row({ kind: "doc_upload", source_id: "F" })).t.item, "file:F");
  assert.deepStrictEqual(L.WB_linkTarget(row({ kind: "client_answered", source_id: "R", ref_id: "T" })).t, { place: "work", tab: "tasks", item: "task:T" });
  assert.deepStrictEqual(L.WB_linkTarget(row({ kind: "client_answered", source_id: "R", ref_id: "T" }), "request").t, { clientId: "c1", tab: "needs", sub: "R" });
  assert.deepStrictEqual(L.WB_linkTarget(row({ kind: "doc_request", source_id: "R", ref_id: "R" })).t, { clientId: "c1", tab: "needs", sub: "R" });
  assert.strictEqual(L.WB_linkTarget({ source: "other" }), null);
});

// ---- keys
t("keys", () => {
  assert.deepStrictEqual(L.WB_keyAction("j"), { type: "move", delta: 1 });
  assert.deepStrictEqual(L.WB_keyAction("k"), { type: "move", delta: -1 });
  assert.deepStrictEqual(L.WB_keyAction("Enter"), { type: "primary" });
  assert.deepStrictEqual(L.WB_keyAction("e"), { type: "clear" });
  assert.deepStrictEqual(L.WB_keyAction("0"), { type: "chip", chip: "all" });
  assert.deepStrictEqual(L.WB_keyAction("3"), { type: "chip", chip: "message" });
  assert.deepStrictEqual(L.WB_keyAction("6"), { type: "chip", chip: "other" });
  assert.strictEqual(L.WB_keyAction("7"), null);
  ["q", "x", "a", "t"].forEach((k) => assert.strictEqual(L.WB_keyAction(k), null, k)); // keep TK meanings
  assert.strictEqual(L.WB_keyAction("j", { meta: true }), null);
});

// ---- snooze presets
t("snooze presets", () => {
  assert.strictEqual(L.WB_snoozeUntil("later", NOW), "2026-10-14T20:00:00.000Z");
  assert.strictEqual(L.WB_snoozeUntil("tomorrow", NOW), "2026-10-15T13:00:00.000Z");
  assert.strictEqual(L.WB_snoozeUntil("monday", NOW), "2026-10-19T13:00:00.000Z");
  // On a Monday, "next Monday" is a week out.
  assert.strictEqual(L.WB_snoozeUntil("monday", Date.parse("2026-10-19T15:00:00Z")), "2026-10-26T13:00:00.000Z");
  assert.strictEqual(L.WB_snoozeUntil("date", NOW, "2026-10-20"), "2026-10-20T13:00:00.000Z");
  // Capped at 30 days; the past and junk are refused.
  assert.strictEqual(L.WB_snoozeUntil("date", NOW, "2027-03-01"), new Date(NOW + 30 * 86400000).toISOString());
  assert.strictEqual(L.WB_snoozeUntil("date", NOW, "2026-10-01"), null);
  assert.strictEqual(L.WB_snoozeUntil("date", NOW, "soon"), null);
  assert.strictEqual(L.WB_snoozeUntil("nope", NOW), null);
});

// ---- Today rows fed in
t("Today rows come in as Other, keeping order and actions", () => {
  const act = { label: "Open", onClick: () => {} };
  const rows = L.WB_fromToday({
    now: [
      { key: "r1", kind: "reply", title: "skip" },
      { key: "d1", kind: "deadline", title: "Deadline", actions: [act] },
      { key: "t1", kind: "task", title: "skip" },
    ],
    week: [{ key: "h1", kind: "handbook", title: "Sign" }],
  });
  assert.deepStrictEqual(rows.map((r) => r.item_key), ["other:deadline:d1", "other:handbook:h1"]);
  assert.strictEqual(rows[0].group, "today");
  assert.strictEqual(rows[1].group, "week");
  assert.strictEqual(rows[0]._td.actions[0], act);
});

// ---- text and flag
t("when text", () => {
  assert.strictEqual(L.WB_whenText(row({ due_date: "2026-10-12" }), TODAY, NOW), "2 days overdue");
  assert.strictEqual(L.WB_whenText(row({ due_date: TODAY }), TODAY, NOW), "Due today");
  assert.strictEqual(L.WB_whenText(row({ due_date: "2026-10-16" }), TODAY, NOW), "Due Fri");
  assert.strictEqual(L.WB_whenText(row({ kind: "message", waiting_since: "2026-10-14T14:00:00Z" }), TODAY, NOW), "Waiting 3h");
  assert.strictEqual(L.WB_updatedText(NOW - 120000, NOW), "Updated 2 min ago");
  assert.strictEqual(L.WB_periodLabel("2026-09"), "Sep 2026");
});
t("switch: setting, preview, classic", () => {
  assert.strictEqual(L.WB_isOn(undefined, false, false), false);
  assert.strictEqual(L.WB_isOn(true, false, false), true);
  assert.strictEqual(L.WB_isOn({ on: true }, false, false), true);
  assert.strictEqual(L.WB_isOn(false, true, false), true);
  assert.strictEqual(L.WB_isOn(true, true, true), false);
  assert.strictEqual(L.WB_NAME, "Workbench");
});

console.log("WB_logic: " + n + " checks passed");
