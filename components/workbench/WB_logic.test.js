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
  assert.strictEqual(L.WB_drawerChip("gl", false), "all");
  assert.strictEqual(L.WB_drawerChip("gl", true), "gl");
});
t("Ledger chip (Desk additions, gated)", () => {
  assert.strictEqual(L.WB_drawerTabs(false), L.WB_DRAWER_TABS);
  assert.strictEqual(L.WB_drawerTabs(undefined), L.WB_DRAWER_TABS);
  assert.deepStrictEqual(L.WB_DRAWER_TABS.map((x) => x.id), ["all", "task", "review", "message", "doc"]);
  const on = L.WB_drawerTabs(true);
  assert.deepStrictEqual(on.map((x) => x.id), ["all", "task", "review", "message", "gl", "doc"]);
  assert.strictEqual(on[4].label, "Ledger");
  assert.strictEqual(L.WB_DRAWER_TABS.length, 5); // not mutated
  // saved chip
  assert.strictEqual(L.WB_hubChip("gl", false), "all");
  assert.strictEqual(L.WB_hubChip("gl", true), "gl");
  assert.strictEqual(L.WB_hubChip("old-chip", true), "all");
  assert.strictEqual(L.WB_hubChip("old-chip", false), "all");
  assert.strictEqual(L.WB_hubChip("doc", false), "doc");
  const saved = L.WB_hubSerialize({ chip: "gl" }, NOW, "#/today");
  assert.strictEqual(L.WB_hubChip(L.WB_hubParse(saved, NOW + 1000).chip, true), "gl");
  assert.strictEqual(L.WB_hubChip(L.WB_hubParse(saved, NOW + 1000).chip, false), "all");
  assert.strictEqual(L.WB_hubParse(JSON.stringify({ v: 1, at: NOW, chip: "zzz" }), NOW + 1000).chip, "all");
  // filter: only gl_* rows
  const mk = (id, kind, source) => ({ id, kind, source, title: id, due_date: TODAY, version: 1 });
  const rows = ["gl_flags", "gl_approve", "gl_sent_back", "gl_answer"].map((k) => mk(k, k, "gl")).concat([mk("t1", "task", "task"), mk("m1", "message", "message")]);
  const ids = (v) => v.groups.flatMap((g) => g.rows.map((r) => r.id)).sort();
  const gl = L.WB_build(rows, { today: TODAY, now: NOW, chip: "gl" });
  assert.ok(ids(gl).every((i) => i.startsWith("gl_")));
  assert.strictEqual(ids(gl).length, 4);
  assert.strictEqual(gl.counts.gl, 4);
  const all = L.WB_build(rows, { today: TODAY, now: NOW, chip: "all" });
  assert.strictEqual(all.counts.gl, gl.counts.gl);
  assert.ok(ids(all).includes("t1") && ids(all).includes("m1"));
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
t("switch: setting and classic (no personal preview)", () => {
  assert.strictEqual(L.WB_isOn(undefined, false), false);
  assert.strictEqual(L.WB_isOn(true, false), true);
  assert.strictEqual(L.WB_isOn({ on: true }, false), true);
  assert.strictEqual(L.WB_isOn(false, false), false);
  assert.strictEqual(L.WB_isOn(true, true), false);
  assert.strictEqual(L.WB_isOn(undefined, true), false);
  assert.strictEqual(L.WORKBENCH_NAME, "Desk");
  assert.strictEqual(L.WB_NAME, L.WORKBENCH_NAME);
  assert.strictEqual(L.WB_SLATE, "Slate");
});

t("bar left edge follows the nav", () => {
  const R = (l, r) => ({ left: l, right: r, width: r - l });
  assert.strictEqual(L.WB_barLeft([R(0, 72)], 1440), 72);
  assert.strictEqual(L.WB_barLeft([R(0, 224)], 1024), 224);
  assert.strictEqual(L.WB_barLeft([R(0, 72), R(0, 224)], 1440), 224);
  assert.strictEqual(L.WB_barLeft([], 390), 0);
  assert.strictEqual(L.WB_barLeft(null, 390), 0);
  assert.strictEqual(L.WB_barLeft([R(0, 0)], 1440), 0); // hidden
  assert.strictEqual(L.WB_barLeft([R(-300, -76)], 1440), 0); // off-canvas
  assert.strictEqual(L.WB_barLeft([R(0, 300)], 400), 0); // too wide for the window
  assert.strictEqual(L.WB_barLeft([R(0, 72.4)], 1440), 72);
});

// ---- Hub (H1) ------------------------------------------------------------------
t("hub: row action per kind", () => {
  const a = (over) => L.WB_hubAction(row(over));
  assert.deepStrictEqual(a({ kind: "task", source_id: "t1" }), { type: "task", taskId: "t1" });
  assert.deepStrictEqual(a({ kind: "task_sent_back", source_id: "t2" }), { type: "task", taskId: "t2" });
  assert.deepStrictEqual(a({ kind: "task_review", source: "review", source_id: "t3" }), { type: "task", taskId: "t3" });
  assert.deepStrictEqual(a({ kind: "client_answered", source_id: "r1", ref_id: "t4" }), { type: "task", taskId: "t4" });
  assert.deepStrictEqual(a({ kind: "doc_request", source_id: "r2", ref_id: "r2" }), { type: "go" });
  // H3: a message opens the chat drawer on that client and person; a new file opens in Drive.
  assert.deepStrictEqual(a({ kind: "message", source: "message", source_id: "m1", client_id: "c9", participant_email: "pat@client.com" }), {
    type: "chat",
    clientId: "c9",
    email: "pat@client.com",
  });
  assert.deepStrictEqual(a({ kind: "message", source: "message", source_id: "m1", client_id: "c9", participant_email: null }), { type: "chat", clientId: "c9", email: null });
  assert.deepStrictEqual(a({ kind: "message", source: "message", source_id: "m1", client_id: null }), { type: "go" });
  assert.deepStrictEqual(a({ kind: "doc_upload", source: "doc", source_id: "f1" }), { type: "file", fileId: "f1" });
  assert.deepStrictEqual(a({ kind: "doc_upload", source: "doc", source_id: null }), { type: "go" });
  assert.deepStrictEqual(a({ kind: "gl_flags", source: "gl", source_id: "g1" }), { type: "go" });
  assert.deepStrictEqual(a({ kind: "task", source_id: null }), { type: "go" });
  assert.deepStrictEqual(a({ kind: "other", source: "other" }), { type: "own" });
  assert.deepStrictEqual(L.WB_hubAction(null), { type: "own" });
});
t("hub: primary and menu for task rows", () => {
  const todo = row({ kind: "task", status: "todo", source_id: "t1" });
  assert.deepStrictEqual(L.WB_hubPrimary(todo), { id: "open", label: "Open" });
  assert.deepStrictEqual(
    L.WB_hubMenu(todo).map((x) => x.id),
    ["start", "snooze", "fullpage"],
  );
  const doing = row({ kind: "task", status: "in_progress", source_id: "t1" });
  assert.deepStrictEqual(L.WB_hubPrimary(doing), { id: "open", label: "Open" });
  assert.deepStrictEqual(
    L.WB_hubMenu(doing).map((x) => x.id),
    ["snooze", "fullpage"],
  );
  const rv = row({ kind: "task_review", source: "review", source_id: "t3" });
  assert.deepStrictEqual(L.WB_hubPrimary(rv), { id: "open", label: "Review" });
  // A message keeps Reply; its menu gains Open full page (H3).
  const msg = row({ kind: "message", source: "message", source_id: "m1" });
  assert.deepStrictEqual(L.WB_hubPrimary(msg), L.WB_primaryAction(msg));
  assert.deepStrictEqual(L.WB_hubPrimary(msg), { id: "reply", label: "Reply" });
  assert.deepStrictEqual(
    L.WB_hubMenu(msg).map((x) => x.id),
    ["noreply", "snooze", "fullpage"],
  );
  // A new file says Open file; Mark checked and Snooze stay, plus Open full page.
  const doc = row({ kind: "doc_upload", source: "doc", source_id: "f1" });
  assert.deepStrictEqual(L.WB_hubPrimary(doc), { id: "open", label: "Open file" });
  assert.deepStrictEqual(
    L.WB_hubMenu(doc).map((x) => x.id),
    ["checked", "snooze", "fullpage"],
  );
  // Nothing to open in place: the old button and menu, unchanged.
  const bare = row({ kind: "message", source: "message", source_id: "m2", client_id: null });
  assert.deepStrictEqual(L.WB_hubPrimary(bare), L.WB_primaryAction(bare));
  assert.deepStrictEqual(L.WB_hubMenu(bare), L.WB_menuActions(bare));
  const bareDoc = row({ kind: "doc_upload", source: "doc", source_id: null });
  assert.deepStrictEqual(L.WB_hubPrimary(bareDoc), { id: "open", label: "File" });
  assert.deepStrictEqual(L.WB_hubMenu(bareDoc), L.WB_menuActions(bareDoc));
  // Ledger rows keep going where they live.
  const gl = row({ kind: "gl_flags", source: "gl", source_id: "g1" });
  assert.deepStrictEqual(L.WB_hubMenu(gl), L.WB_menuActions(gl));
});

t("hub: layer selectors and order", () => {
  const sels = L.WB_LAYER_SELECTORS;
  [".tk-dw-layer", ".tk-cd-layer", ".si-drawer-layer", ".modal-overlay", '[aria-modal="true"]:not(.wb-panel)', ".tour-root", ".wb-menu"].forEach((x) =>
    assert.ok(sels.indexOf(x) >= 0, "missing " + x),
  );
  const has = (...on) => (sel) => on.indexOf(sel) >= 0;
  assert.deepStrictEqual(L.WB_layersPresent(has()), []);
  assert.strictEqual(L.WB_layerAbove(L.WB_layersPresent(has())), false);
  // Task drawer over chat drawer over hub: task drawer is the top layer.
  assert.deepStrictEqual(L.WB_layersPresent(has(".si-drawer-layer", ".tk-dw-layer")), ["task-drawer", "chat-drawer"]);
  assert.deepStrictEqual(L.WB_layersPresent(has(".tk-cd-layer", ".modal-overlay", ".wb-menu")), ["menu", "modal", "client-drawer"]);
  assert.strictEqual(L.WB_layerAbove(["menu"]), true);
  // A menu or tour alone is not a stacked drawer (the hub scrim keeps clicks).
  assert.strictEqual(L.WB_isStacked(["menu"]), false);
  assert.strictEqual(L.WB_isStacked(["tour"]), false);
  assert.strictEqual(L.WB_isStacked(["menu", "task-drawer"]), true);
  assert.strictEqual(L.WB_isStacked([]), false);
  // The hub's own panel is never a layer above it (only a menu or list inside it is).
  assert.ok(L.WB_LAYER_SELECTORS.every((x) => !/^\.wb-panel/.test(x) || /\.tk-menu|\.tk-dw-menu|\.wb-pick-list/.test(x)));
  // R2: the task view's More menu takes Esc before the task view.
  assert.deepStrictEqual(L.WB_layersPresent(has(".wb-panel .tk-dw-menu[role='menu']")), ["tk-dw-menu"]);
  assert.strictEqual(L.WB_isStacked(["tk-dw-menu"]), false);
  // A My tasks row's status menu inside the panel is a layer above the hub: Esc closes it first.
  const tkMenu = ".wb-panel .tk-menu[role='menu']";
  assert.ok(sels.indexOf(tkMenu) >= 0);
  assert.deepStrictEqual(L.WB_layersPresent(has(tkMenu)), ["tk-menu"]);
  assert.strictEqual(L.WB_layerAbove(L.WB_layersPresent(has(tkMenu))), true);
  assert.strictEqual(L.WB_isStacked(["tk-menu"]), false);
});

t("hub: My tasks tab is ready only after a real load, never a false zero", () => {
  assert.strictEqual(L.WB_hubTasksReady({ loading: false, tasks: [], error: null }, false), false, "before the first load starts");
  assert.strictEqual(L.WB_hubTasksReady({ loading: true, tasks: [], error: null }, true), false, "while loading");
  assert.strictEqual(L.WB_hubTasksReady({ loading: false, tasks: [], error: null }, true), true, "loaded and empty");
  assert.strictEqual(L.WB_hubTasksReady({ loading: true, tasks: [{ id: 1 }], error: null }, false), true, "rows already there");
  assert.strictEqual(L.WB_hubTasksReady({ loading: false, tasks: [], error: "x" }, false), true, "a failure settles it");
  assert.strictEqual(L.WB_hubTasksReady(null, true), true);
  assert.strictEqual(L.WB_hubTasksReady(undefined, false), false);
});

t("hub: tab keys", () => {
  const ids = ["inbox", "tasks", "client"];
  assert.strictEqual(L.WB_tabMove(ids, "inbox", "ArrowRight"), "tasks");
  assert.strictEqual(L.WB_tabMove(ids, "client", "ArrowRight"), "inbox");
  assert.strictEqual(L.WB_tabMove(ids, "inbox", "ArrowLeft"), "client");
  assert.strictEqual(L.WB_tabMove(ids, "tasks", "Home"), "inbox");
  assert.strictEqual(L.WB_tabMove(ids, "tasks", "End"), "client");
  assert.strictEqual(L.WB_tabMove(ids, "tasks", "x"), null);
  assert.strictEqual(L.WB_tabMove([], "tasks", "Home"), null);
  assert.deepStrictEqual(L.WB_hubTabIds(true), ["inbox", "tasks", "client"]); // all three live (H4)
  assert.deepStrictEqual(L.WB_hubTabIds(false), ["inbox", "tasks", "client"]);
});

t("hub: state clean, merge and persistence", () => {
  const d = L.WB_hubDefault();
  assert.deepStrictEqual(L.WB_hubClean(null), d);
  assert.deepStrictEqual(L.WB_hubClean("junk"), d);
  // A made-up tab or chip falls back; Client is live since H4.
  assert.strictEqual(L.WB_hubClean({ tab: "client" }).tab, "client");
  assert.strictEqual(L.WB_hubClean({ tab: "tasks" }).tab, "tasks");
  assert.strictEqual(L.WB_hubClean({ tab: "nope" }).tab, "inbox");
  assert.strictEqual(L.WB_hubClean({ chip: "gl" }).chip, "gl"); // kept in saved state; the gate resolves it (WB_hubChip)
  assert.strictEqual(L.WB_hubClean({ chip: "nope" }).chip, "all");
  assert.strictEqual(L.WB_hubClean({ chip: "doc" }).chip, "doc");
  assert.strictEqual(L.WB_hubClean({ open: "yes" }).open, false);
  assert.deepStrictEqual(L.WB_hubClean({ scroll: { inbox: -5, tasks: "x", client: 12.6 } }).scroll, { inbox: 0, tasks: 0, client: 13 });
  const m = L.WB_hubMerge({ tab: "inbox", chip: "task", scroll: { inbox: 40, tasks: 0, client: 0 } }, { scroll: { client: 9 }, open: true });
  assert.strictEqual(m.open, true);
  assert.strictEqual(m.chip, "task");
  assert.deepStrictEqual(m.scroll, { inbox: 40, tasks: 0, client: 9 });

  const saved = L.WB_hubSerialize({ open: true, tab: "inbox", chip: "message", scroll: { inbox: 220, tasks: 0, client: 0 }, lastFocus: "task:task:1" }, NOW);
  assert.ok(saved.indexOf("lastFocus") < 0, "focus row is not saved");
  // Fresh: reload inside 5 minutes restores everything.
  const back = L.WB_hubParse(saved, NOW + 60000);
  assert.strictEqual(back.open, true);
  assert.strictEqual(back.chip, "message");
  assert.strictEqual(back.scroll.inbox, 220);
  assert.strictEqual(back.lastFocus, null);
  // Older than 5 minutes: stays closed but keeps the tab, chip and scroll.
  const mid = L.WB_hubParse(saved, NOW + L.WB_HUB_OPEN_MS + 1000);
  assert.strictEqual(mid.open, false);
  assert.strictEqual(mid.chip, "message");
  assert.strictEqual(mid.scroll.inbox, 220);
  // Older than 30 minutes: scroll is dropped too.
  const old = L.WB_hubParse(saved, NOW + L.WB_HUB_SCROLL_MS + 1000);
  assert.strictEqual(old.open, false);
  assert.strictEqual(old.chip, "message");
  assert.strictEqual(old.scroll.inbox, 0);
  // Bad input never throws and gives the default.
  [null, "", "{not json", "[]", '{"v":2}', "123", '{"v":1,"at":"x","open":true}'].forEach((raw) => {
    const r = L.WB_hubParse(raw, NOW);
    assert.strictEqual(r.tab, "inbox");
    if (raw === '{"v":1,"at":"x","open":true}') assert.strictEqual(r.open, false);
  });
  assert.strictEqual(L.WB_HUB_KEY, "mgb_wb_hub");
});

t("hub: parse edges at 5 and 30 minutes and a future save", () => {
  const saved = L.WB_hubSerialize({ open: true, tab: "tasks", chip: "task", scroll: { inbox: 10, tasks: 77, client: 0 } }, NOW);
  const at = (ms) => L.WB_hubParse(saved, NOW + ms);
  // Exactly 5 minutes still reopens; one millisecond more does not.
  assert.strictEqual(at(L.WB_HUB_OPEN_MS).open, true);
  assert.strictEqual(at(L.WB_HUB_OPEN_MS + 1).open, false);
  assert.strictEqual(at(L.WB_HUB_OPEN_MS + 1).tab, "tasks");
  // Exactly 30 minutes still keeps the scroll; one millisecond more drops it.
  assert.strictEqual(at(L.WB_HUB_SCROLL_MS).scroll.tasks, 77);
  assert.strictEqual(at(L.WB_HUB_SCROLL_MS + 1).scroll.tasks, 0);
  assert.strictEqual(at(L.WB_HUB_SCROLL_MS + 1).tab, "tasks");
  // A save from the future (clock moved back) is not trusted: closed, no scroll.
  const fut = at(-1000);
  assert.strictEqual(fut.open, false);
  assert.strictEqual(fut.scroll.tasks, 0);
  assert.strictEqual(fut.chip, "task");
});

t("hub: saved state is per person and reopens only on the same page", () => {
  assert.strictEqual(L.WB_hubKey("Pat@Example.com "), "mgb_wb_hub:pat@example.com");
  assert.strictEqual(L.WB_hubKey(""), null);
  assert.strictEqual(L.WB_hubKey(null), null);
  assert.ok(L.WB_hubKey("a@b.co").indexOf("mgb_") === 0, "kept under mgb_ so Dev Tools reset clears it");
  assert.strictEqual(L.WB_hubRoute("#/clients/abc?item=task:1"), "#/clients/abc");
  assert.strictEqual(L.WB_hubRoute("#/today"), "#/today");
  assert.strictEqual(L.WB_hubArrival("#/tasks/my?item=task:9"), true);
  assert.strictEqual(L.WB_hubArrival("#/tasks/my?x=1&item=task:9"), true);
  assert.strictEqual(L.WB_hubArrival("#/tasks/my"), false);
  const saved = L.WB_hubSerialize({ open: true, tab: "inbox" }, NOW, "#/today");
  const near = NOW + 60000;
  assert.strictEqual(L.WB_hubParse(saved, near, { hash: "#/today" }).open, true);
  assert.strictEqual(L.WB_hubParse(saved, near, { hash: "#/clients" }).open, false);
  assert.strictEqual(L.WB_hubParse(saved, near, { hash: "#/today?item=task:1" }).open, false);
  // Another page or an arrival still keeps the tab and chip.
  assert.strictEqual(L.WB_hubParse(saved, near, { hash: "#/clients" }).tab, "inbox");
  // A save with no route (older) does not reopen when the page is known.
  assert.strictEqual(L.WB_hubParse(L.WB_hubSerialize({ open: true }, NOW), near, { hash: "#/today" }).open, false);
  // No context: the clock alone decides (as before).
  assert.strictEqual(L.WB_hubParse(saved, near).open, true);
});

t("hub: ref_id equal to source_id has no task to open", () => {
  const same = { source: "task", kind: "client_answered", source_id: "r1", ref_id: "r1" };
  assert.strictEqual(L.WB_hubAction(same).type, "go");
  assert.strictEqual(L.WB_hubAction({ source: "task", kind: "doc_request", source_id: "r2", ref_id: "r2" }).type, "go");
  assert.deepStrictEqual(L.WB_hubAction({ source: "task", kind: "client_answered", source_id: "r1", ref_id: "t9" }), { type: "task", taskId: "t9" });
  assert.strictEqual(L.WB_hubAction({ source: "task", kind: "client_answered", source_id: "r1", ref_id: null }).type, "go");
});

t("hub: collapsed groups clean and merge", () => {
  assert.deepStrictEqual(L.WB_hubClean({ collapsed: { overdue: true, week: false, done: true, junk: 1, later: "x" } }).collapsed, { overdue: true, week: false });
  assert.deepStrictEqual(L.WB_hubMerge({ collapsed: { overdue: true } }, { collapsed: { later: true } }).collapsed, { overdue: true, later: true });
  assert.deepStrictEqual(L.WB_hubMerge({ collapsed: { overdue: true } }, { collapsed: { overdue: false } }).collapsed, { overdue: false });
  const back = L.WB_hubParse(L.WB_hubSerialize({ collapsed: { today: true } }, NOW), NOW);
  assert.deepStrictEqual(back.collapsed, { today: true });
});

t("hub: My tasks groups drop Done and Unassigned and cap the rows", () => {
  const g = (key, n, collapsed) => ({ key, label: key, collapsed: !!collapsed, tasks: Array.from({ length: n }, (_, i) => ({ id: key + i })) });
  const view = [g("overdue", 3), g("today", 2), g("unassigned", 4), g("week", 1, true), g("later", 5), g("done", 2)];
  const r = L.WB_hubTaskGroups(view, 100);
  assert.deepStrictEqual(r.groups.map((x) => x.key), ["overdue", "today", "week", "later"]);
  assert.strictEqual(r.total, 11);
  assert.strictEqual(r.shown, 10, "a folded group draws no rows");
  assert.strictEqual(r.more, 0);
  assert.strictEqual(r.groups[2].collapsed, true);
  assert.strictEqual(r.groups[2].tasks.length, 0);
  assert.strictEqual(r.groups[2].total, 1);
  // The cap cuts across groups in order and every group keeps its full total.
  const c = L.WB_hubTaskGroups(view, 4);
  // Groups the cap cut to nothing keep their header and full count; a folded group does not use the cap.
  assert.deepStrictEqual(c.groups.map((x) => x.tasks.length), [3, 1, 0, 0]);
  assert.deepStrictEqual(c.groups.map((x) => x.total), [3, 2, 1, 5]);
  assert.strictEqual(c.total, 11);
  assert.strictEqual(c.more, 6);
  assert.strictEqual(L.WB_HUB_TASK_CAP, 200);
  const big = L.WB_hubTaskGroups([g("later", 250)]);
  assert.strictEqual(big.shown, 200);
  assert.strictEqual(big.more, 50);
  assert.deepStrictEqual(L.WB_hubTaskGroups(null), { groups: [], total: 0, shown: 0, more: 0 });
  // rhythm slice 0: anyKey draws Client / Part / Status groups; without it they drop
  const other = [g("client:c1", 2), g("part:check in", 3), g("status:todo", 1, true)];
  assert.deepStrictEqual(L.WB_hubTaskGroups(other, 100).groups, []);
  const any = L.WB_hubTaskGroups(other, 4, { anyKey: true });
  assert.deepStrictEqual(any.groups.map((x) => x.key), ["client:c1", "part:check in", "status:todo"]);
  assert.deepStrictEqual(any.groups.map((x) => x.tasks.length), [2, 2, 0]);
  assert.strictEqual(any.more, 1);
  assert.deepStrictEqual(L.WB_hubTaskGroups(view, 100, {}), r, "no anyKey: unchanged");
});

t("WB_hubShouldReload: once per distinct missing set", () => {
  assert.strictEqual(L.WB_hubShouldReload("", "", true), false);
  assert.strictEqual(L.WB_hubShouldReload("", "a", true), false);
  assert.strictEqual(L.WB_hubShouldReload("a", "", true), true);
  assert.strictEqual(L.WB_hubShouldReload("a", undefined, true), true);
  assert.strictEqual(L.WB_hubShouldReload("a,b", "a,b", true), false);
  assert.strictEqual(L.WB_hubShouldReload("a,b", "a", true), true);
  assert.strictEqual(L.WB_hubShouldReload("a", "", false), false);
});

// ---- Client tab (H4) ----
const CL = [
  { id: "c1", name: "Acme Books" },
  { id: "c2", name: "Bayside Church" },
  { id: "c3", name: "Zion Food Pantry" },
  { id: "c4", name: "acorn Club" },
  { id: "c5", name: "The Acme Trust" },
];

t("Client tab: pins key, parse, serialize, cap", () => {
  assert.strictEqual(L.WB_pinsKey(" Pat@MGB.com "), "mgb_wb_pins:pat@mgb.com");
  assert.strictEqual(L.WB_pinsKey(""), null);
  assert.strictEqual(L.WB_PINS_KEY.indexOf("mgb_"), 0); // Reset local state clears it
  assert.deepStrictEqual(L.WB_pinsParse(null), []);
  assert.deepStrictEqual(L.WB_pinsParse("{bad"), []);
  assert.deepStrictEqual(L.WB_pinsParse('{"v":1,"pins":["c1","c1",7,"",null,{}]}'), ["c1", "7"]);
  assert.deepStrictEqual(L.WB_pinsParse('["c2","c1"]'), ["c2", "c1"]);
  const many = Array.from({ length: 12 }, (_, i) => "x" + i);
  assert.strictEqual(L.WB_pinsParse(JSON.stringify(many)).length, L.WB_PINS_CAP);
  assert.deepStrictEqual(L.WB_pinsParse(L.WB_pinsSerialize(["c3", "c1"])), ["c3", "c1"]);
  assert.deepStrictEqual(L.WB_pinsClean(["a".repeat(90), "ok"]), ["ok"]);
});

t("Client tab: pin toggle puts the newest first and drops the oldest past the cap", () => {
  let r = L.WB_pinsToggle([], "c1");
  assert.deepStrictEqual(r, { pins: ["c1"], on: true, dropped: null });
  r = L.WB_pinsToggle(r.pins, "c2");
  assert.deepStrictEqual(r.pins, ["c2", "c1"]);
  r = L.WB_pinsToggle(r.pins, "c1");
  assert.deepStrictEqual(r, { pins: ["c2"], on: false, dropped: null });
  r = L.WB_pinsToggle(["a", "b", "c"], "d", 3);
  assert.deepStrictEqual(r, { pins: ["d", "a", "b"], on: true, dropped: "c" });
  assert.deepStrictEqual(L.WB_pinsToggle(["a"], null), { pins: ["a"], on: false, dropped: null });
  assert.deepStrictEqual(L.WB_pinsToggle(["a"], 5).pins, ["5", "a"]); // numeric ids become strings
});

t("Client tab: pins missing from a (partial) client list are hidden, never removed", () => {
  const pins = ["c1", "gone", "c3"];
  const partial = CL.filter((c) => c.id === "c3");
  const o = L.WB_hubClientOptions(partial, pins, [], "");
  assert.deepStrictEqual(o.sections[0].items.map((i) => i.id), ["c3"]);
  assert.deepStrictEqual(pins, ["c1", "gone", "c3"]); // the saved list is untouched
  assert.deepStrictEqual(L.WB_hubClientOptions([], pins, [], "").items, []);
  // Once the full list is in, c1 is listed as pinned again.
  assert.deepStrictEqual(L.WB_hubClientOptions(CL, pins, [], "").sections[0].items.map((i) => i.id), ["c1", "c3"]);
  assert.strictEqual(typeof L.WB_pinsPrune, "undefined"); // nothing rewrites pins from a list
});

t("Client tab: the picker hides MGB (internal) and, unless shown, test clients", () => {
  const list = [
    { id: "a", name: "Acme" },
    { id: "m", name: "MGB", isInternal: true },
    { id: "t", name: "Test Co", testOnly: true },
    null,
  ];
  assert.deepStrictEqual(L.WB_hubPickerPool(list, false, null).map((c) => c.id), ["a"]);
  assert.deepStrictEqual(L.WB_hubPickerPool(list, true, null).map((c) => c.id), ["a", "t"]);
  assert.deepStrictEqual(L.WB_hubPickerPool(list, false, "t").map((c) => c.id), ["a", "t"]); // the one on screen stays
  assert.deepStrictEqual(L.WB_hubPickerPool(list, true, "m").map((c) => c.id), ["a", "t"]); // internal never listed
  assert.deepStrictEqual(L.WB_hubPickerPool(null, true, null), []);
  // Access is still decided by the full list.
  assert.strictEqual(L.WB_hubPickClient("m", null, list.filter(Boolean)).access, true);
});

t("Client tab: a capped picker says how many there are", () => {
  const lots = Array.from({ length: 70 }, (_, i) => ({ id: "k" + i, name: "Kay " + String(i).padStart(2, "0") }));
  const o = L.WB_hubClientOptions(lots, ["k5"], ["k6"], "");
  assert.strictEqual(o.items.length, L.WB_HUB_PICK_LIMIT);
  assert.strictEqual(o.total, 70);
  assert.strictEqual(o.capped, true);
  const q = L.WB_hubClientOptions(lots, [], [], "kay 1");
  assert.strictEqual(q.total, 10);
  assert.strictEqual(q.capped, false);
});

t("Client tab: the saved scroll belongs to its client; another client starts at the top", () => {
  const h = L.WB_hubClean({ clientId: "a", scrollClientId: "a", scroll: { client: 300, tasks: 40 } });
  assert.strictEqual(h.scroll.client, 300);
  assert.strictEqual(h.scrollClientId, "a");
  const moved = L.WB_hubMerge(h, { clientId: "b" });
  assert.strictEqual(moved.scroll.client, 0);
  assert.strictEqual(moved.scrollClientId, null);
  assert.strictEqual(moved.scroll.tasks, 40); // other tabs keep theirs
  assert.strictEqual(L.WB_hubClean({ clientId: "b", scrollClientId: "a", scroll: { client: 300 } }).scroll.client, 0);
  // Saved and read back with the client it belongs to.
  const raw = L.WB_hubSerialize(h, 1000, "#/today");
  const back = L.WB_hubParse(raw, 2000, { hash: "#/today" });
  assert.strictEqual(back.scroll.client, 300);
  assert.strictEqual(back.scrollClientId, "a");
  const other = L.WB_hubParse(raw.replace('"clientId":"a"', '"clientId":"b"'), 2000, { hash: "#/today" });
  assert.strictEqual(other.scroll.client, 0);
});

t("Client tab: the route client wins, then the saved one; no access never shows a name", () => {
  assert.deepStrictEqual(L.WB_hubPickClient("c2", "c1", CL), { id: "c1", from: "route", access: true, client: CL[0] });
  assert.deepStrictEqual(L.WB_hubPickClient("c2", null, CL), { id: "c2", from: "saved", access: true, client: CL[1] });
  assert.deepStrictEqual(L.WB_hubPickClient("c2", "", CL).from, "saved");
  assert.deepStrictEqual(L.WB_hubPickClient(null, null, CL), { id: null, from: null, access: null, client: null });
  assert.deepStrictEqual(L.WB_hubPickClient("secret", null, CL), { id: "secret", from: "saved", access: false, client: null });
  assert.deepStrictEqual(L.WB_hubPickClient("c1", null, []), { id: "c1", from: "saved", access: null, client: null });
  assert.strictEqual(L.WB_hubPickClient("c1", 3, [{ id: 3, name: "Three" }]).access, true); // numeric route id
});

t("Client tab: picker rows with no query are Pinned, Recent, then All clients", () => {
  const o = L.WB_hubClientOptions(CL, ["c3", "gone"], ["c3", "c2", "nope", "c1"], "");
  assert.deepStrictEqual(
    o.sections.map((s) => [s.id, s.items.map((i) => i.id)]),
    [
      ["pinned", ["c3"]],
      ["recent", ["c2", "c1"]],
      ["all", ["c4", "c5"]],
    ],
  );
  assert.strictEqual(o.items[0].pinned, true);
  assert.strictEqual(o.items[1].pinned, false);
  assert.deepStrictEqual(o.items.map((i) => i.id), ["c3", "c2", "c1", "c4", "c5"]);
  // The limit counts every row across sections.
  const lim = L.WB_hubClientOptions(CL, ["c3"], [], "", 2);
  assert.deepStrictEqual(lim.items.map((i) => i.id), ["c3", "c1"]); // Acme Books sorts before acorn Club
  // Recent shows at most WB_HUB_RECENT_MAX.
  const lots = Array.from({ length: 9 }, (_, i) => ({ id: "r" + i, name: "R " + i }));
  const r = L.WB_hubClientOptions(lots, [], lots.map((c) => c.id), "");
  assert.strictEqual(r.sections[0].items.length, L.WB_HUB_RECENT_MAX);
  assert.deepStrictEqual(L.WB_hubClientOptions([], ["c1"], ["c1"], ""), { sections: [], items: [], total: 0, capped: false });
});

t("Client tab: a query lists starts-with first, then contains, by name; only my clients", () => {
  const o = L.WB_hubClientOptions(CL, ["c5"], [], "  ac ");
  assert.deepStrictEqual(o.sections.map((s) => s.id), ["matches"]);
  assert.deepStrictEqual(o.items.map((i) => i.id), ["c1", "c4", "c5"]);
  assert.strictEqual(o.items[2].pinned, true);
  assert.deepStrictEqual(L.WB_hubClientOptions(CL, [], [], "zzz").items, []);
});

t("Client tab: own list key, Esc in a field with text", () => {
  assert.strictEqual(L.WB_hubClientListKey("c1"), "wb:client:c1");
  assert.strictEqual(L.WB_hubClientListKey(7), "wb:client:7");
  assert.strictEqual(L.WB_hubClientListKey(""), null);
  assert.strictEqual(L.WB_hubClientListKey(null), null);
  const esc = (f) => L.WB_escKeepsField(Object.assign({ tag: "INPUT", type: "text", value: "abc", inPanel: true, clears: true }, f));
  // The add row and the picker (they clear themselves on Esc) keep Esc while they have text.
  assert.strictEqual(esc({}), true);
  assert.strictEqual(esc({ tag: "textarea", type: "textarea", value: "x" }), true);
  assert.strictEqual(esc({ value: "" }), false);
  assert.strictEqual(esc({ inPanel: false }), false);
  assert.strictEqual(esc({ tag: "BUTTON" }), false);
  // A checked checkbox or radio has a value but never clears: Esc closes the hub.
  assert.strictEqual(esc({ type: "checkbox", value: "on" }), false);
  assert.strictEqual(esc({ type: "radio", value: "on" }), false);
  // A filled contacts-form field (not self-clearing) lets Esc close the hub.
  assert.strictEqual(esc({ clears: false, value: "pat@example.com", type: "email" }), false);
  assert.strictEqual(L.WB_escKeepsField(null), false);
  // The selector names the self-clearing fields.
  [".tk-add-input", ".wb-pick-input", "[data-esc-clears]"].forEach((s) => assert.ok(L.WB_ESC_CLEARS_SEL.indexOf(s) >= 0));
});

t("Client tab: the picker list is a layer above the hub, not a stacked one", () => {
  const has = (...sels) => (sel) => sels.indexOf(sel) >= 0;
  const p = L.WB_layersPresent(has(".wb-panel .wb-pick-list"));
  assert.deepStrictEqual(p, ["picker"]);
  assert.strictEqual(L.WB_layerAbove(p), true);
  assert.strictEqual(L.WB_isStacked(p), false);
});

// ---- R1: the right-side Desk column ----
t("Desk mode: sheet at the 760px phone breakpoint, dock above", () => {
  assert.strictEqual(L.WB_deskMode(760), "sheet");
  assert.strictEqual(L.WB_deskMode(761), "dock");
  assert.strictEqual(L.WB_deskMode(375), "sheet");
  assert.strictEqual(L.WB_deskMode(1440), "dock");
  assert.strictEqual(L.WB_deskMode(NaN), "dock");
  assert.strictEqual(L.WB_deskMode(undefined), "dock");
});

t("Desk widths: the defaults from decision 26", () => {
  assert.strictEqual(L.WB_DESK_W.min, 320);
  assert.strictEqual(L.WB_DESK_W.standard, 380);
  assert.strictEqual(L.WB_DESK_W.max, 520);
  assert.strictEqual(L.WB_DESK_RAIL, 52);
  assert.strictEqual(L.WB_DESK_BAR_H, 42);
});

t("Desk width max keeps 480px of page beside the left rail", () => {
  assert.strictEqual(L.WB_deskWidthMax(1440, 64), 520);
  assert.strictEqual(L.WB_deskWidthMax(1000, 64), 456);
  assert.strictEqual(L.WB_deskWidthMax(1000, 220), 320); // never under the minimum
  assert.strictEqual(L.WB_deskWidthMax(900, 0), 420);
  assert.strictEqual(L.WB_deskWidthMax(NaN, 64), 520);
  assert.strictEqual(L.WB_deskWidthMax(1200, -5), 520);
  assert.strictEqual(L.WB_deskWidthClamp(100, 520), 320);
  assert.strictEqual(L.WB_deskWidthClamp(999, 456), 456);
  assert.strictEqual(L.WB_deskWidthClamp("x", 520), 380);
  assert.strictEqual(L.WB_deskWidthClamp(400.4, NaN), 400);
});

t("Desk layout: push, overlay, sheet and the occupy widths", () => {
  const D = L.WB_deskLayout;
  // Wide window: push; closed the rail keeps its 52px, open the column's width.
  assert.deepStrictEqual(D({ vw: 1440, railW: 64, w: 380, open: false }), { mode: "push", w: 380, max: 520, occupy: 52, occupyAny: 0 });
  assert.deepStrictEqual(D({ vw: 1440, railW: 64, w: 380, open: true }), { mode: "push", w: 380, max: 520, occupy: 380, occupyAny: 380 });
  // The 1100 boundary.
  assert.strictEqual(D({ vw: 1100, railW: 64, w: 380, open: true }).mode, "push");
  assert.strictEqual(D({ vw: 1099, railW: 64, w: 380, open: true }).mode, "overlay");
  // Overlay: the page keeps only the rail's room, the column floats over it.
  assert.deepStrictEqual(D({ vw: 900, railW: 64, w: 380, open: true }), { mode: "overlay", w: 356, max: 356 < 320 ? 320 : 356, occupy: 52, occupyAny: 356 });
  // A wide left rail can push a 1100 window back to overlay (page under 480).
  assert.strictEqual(D({ vw: 1100, railW: 400, w: 520, open: true }).mode, "overlay");
  // A stored width wider than the window allows is clamped, not lost.
  assert.strictEqual(D({ vw: 1000, railW: 64, w: 520, open: true }).w, 456);
  // Rail width changes move the max.
  assert.strictEqual(D({ vw: 1200, railW: 220, w: 520 }).max, 500);
  // Phones: the sheet covers the page; nothing is occupied.
  assert.deepStrictEqual(D({ vw: 760, railW: 0, w: 380, open: true }), { mode: "sheet", w: 320, max: 320, occupy: 0, occupyAny: 0 });
  assert.strictEqual(D({ vw: 375, open: true }).mode, "sheet");
  assert.strictEqual(D(null).mode, "overlay");
});

t("Desk width snap: magnets, close by distance and by fling", () => {
  const S = L.WB_deskWidthSnap;
  assert.deepStrictEqual(S(370, 0, 520), { w: 380, close: false });
  assert.deepStrictEqual(S(404, 0, 520), { w: 380, close: false });
  assert.deepStrictEqual(S(420, 0, 520), { w: 420, close: false }); // free between magnets
  assert.deepStrictEqual(S(470, 0, 520), { w: 460, close: false });
  assert.deepStrictEqual(S(510, 0, 520), { w: 520, close: false });
  assert.deepStrictEqual(S(9999, 0, 520), { w: 520, close: false });
  // The window's max is a magnet too, and stops beyond it are skipped.
  assert.deepStrictEqual(S(440, 0, 456), { w: 456, close: false });
  // Dragged 80px past the minimum closes.
  assert.strictEqual(S(241, 0, 520).close, false);
  assert.strictEqual(S(239, 0, 520).close, true);
  assert.strictEqual(S(239, 0, 520).w, 320);
  // A right fling closes only under Standard.
  assert.strictEqual(S(360, -0.7, 520).close, true);
  assert.strictEqual(S(360, -0.5, 520).close, false);
  assert.strictEqual(S(400, -2, 520).close, false);
  assert.strictEqual(S(360, 0.9, 520).close, false); // a left fling never closes
  assert.deepStrictEqual(S(NaN, NaN, NaN), { w: 380, close: false });
});

t("Desk width keys: arrows 24px, page stops, Home, End, Enter", () => {
  const K = L.WB_deskWidthStep;
  assert.strictEqual(K(380, "ArrowLeft", 520), 404);
  assert.strictEqual(K(380, "ArrowRight", 520), 356);
  assert.strictEqual(K(320, "ArrowRight", 520), 320);
  assert.strictEqual(K(510, "ArrowLeft", 520), 520);
  assert.strictEqual(K(380, "PageUp", 520), 460);
  assert.strictEqual(K(400, "PageUp", 520), 460);
  assert.strictEqual(K(460, "PageUp", 520), 520);
  assert.strictEqual(K(520, "PageUp", 520), 520);
  assert.strictEqual(K(460, "PageDown", 520), 380);
  assert.strictEqual(K(400, "PageDown", 520), 380);
  assert.strictEqual(K(320, "PageDown", 520), 320);
  assert.strictEqual(K(380, "PageUp", 420), 420); // the window max is the top stop
  assert.strictEqual(K(450, "Home", 520), 320);
  assert.strictEqual(K(380, "End", 456), 456);
  assert.strictEqual(K(500, "Enter", 520), 380);
  assert.strictEqual(K(380, "x", 520), null);
});

t("Desk width words for the grip", () => {
  assert.strictEqual(L.WB_deskWidthText(380), "Desk width 380 pixels, Standard");
  assert.strictEqual(L.WB_deskWidthText(320), "Desk width 320 pixels, Narrow");
  assert.strictEqual(L.WB_deskWidthText(460), "Desk width 460 pixels, Wide");
  assert.strictEqual(L.WB_deskWidthText(520), "Desk width 520 pixels, Widest");
  assert.strictEqual(L.WB_deskWidthText(420), "Desk width 420 pixels");
  assert.strictEqual(L.WB_deskWidthText(NaN), "Desk width 380 pixels, Standard");
});

t("Desk storage v2: round trip, v1 migrates, junk falls back, key lowercases", () => {
  const def = { v: 2, dock: "right", right: { w: 380 } };
  assert.deepStrictEqual(L.WB_deskDefault(), def);
  assert.strictEqual(L.WB_deskSerialize({ v: 2, right: { w: 460 } }), '{"v":2,"dock":"right","right":{"w":460}}');
  assert.deepStrictEqual(L.WB_deskParse(L.WB_deskSerialize({ v: 2, right: { w: 433.6 } })), { v: 2, dock: "right", right: { w: 434 } });
  // v1 (the D3 bottom panel height) migrates to the default column.
  assert.deepStrictEqual(L.WB_deskParse('{"v":1,"snap":"tall"}'), def);
  assert.deepStrictEqual(L.WB_deskParse('{"v":1,"snap":"strip"}'), def);
  // Junk.
  assert.deepStrictEqual(L.WB_deskParse("{not json"), def);
  assert.deepStrictEqual(L.WB_deskParse(null), def);
  assert.deepStrictEqual(L.WB_deskParse("null"), def);
  assert.deepStrictEqual(L.WB_deskParse('"tall"'), def);
  assert.deepStrictEqual(L.WB_deskParse('{"v":2,"right":"wide"}'), def);
  assert.deepStrictEqual(L.WB_deskParse('{"v":2,"right":{"w":"x"}}'), def);
  // A stored width is kept inside 320-520; the window clamp happens on apply.
  assert.strictEqual(L.WB_deskParse('{"v":2,"right":{"w":9000}}').right.w, 520);
  assert.strictEqual(L.WB_deskParse('{"v":2,"right":{"w":10}}').right.w, 320);
  // A retired bottom dock comes back as right.
  assert.strictEqual(L.WB_deskParse('{"v":2,"dock":"bottom","right":{"w":400}}').dock, "right");
  assert.strictEqual(L.WB_deskSerialize(null), JSON.stringify(def));
  assert.strictEqual(L.WB_deskKey("A@x.com"), "mgb_wb_desk:a@x.com");
  assert.strictEqual(L.WB_deskKey(" A@X.com ").split(":")[1], L.WB_hubKey("A@X.com").split(":")[1]);
  assert.strictEqual(L.WB_deskKey(""), null);
  // The hub blob carries no geometry.
  const hub = L.WB_hubSerialize(L.WB_hubDefault(), 1000);
  assert.ok(hub.indexOf("snap") < 0 && hub.indexOf("width") < 0);
});

t("Desk route change: push keeps, overlay and sheet close after the grace", () => {
  const N = L.WB_deskNavStep;
  assert.strictEqual(N({ layout: "push", msSinceOpen: 9000 }), "keep");
  assert.strictEqual(N({ layout: "overlay", msSinceOpen: 9000 }), "close");
  assert.strictEqual(N({ layout: "sheet", msSinceOpen: 9000 }), "close");
  assert.strictEqual(N({ layout: "overlay", msSinceOpen: 499 }), "keep");
  assert.strictEqual(N({ layout: "sheet", msSinceOpen: 0 }), "keep");
  assert.strictEqual(N({ layout: "overlay", msSinceOpen: 500 }), "close");
  assert.strictEqual(N({ layout: "overlay" }), "close");
  assert.strictEqual(N(null), "close");
});

t("Desk Esc ladder: layer > picker > field > inner > pop > list > close", () => {
  const E = L.WB_deskEscStep;
  const all = { layerAbove: true, pickerOpen: true, fieldKeeps: true, drillInner: true, drillDepth: 2 };
  assert.strictEqual(E(all), "layer");
  assert.strictEqual(E(Object.assign({}, all, { layerAbove: false })), "picker");
  assert.strictEqual(E(Object.assign({}, all, { layerAbove: false, pickerOpen: false })), "field");
  assert.strictEqual(E({ drillInner: true, drillDepth: 1 }), "inner");
  // Spec 6 rows 5-8.
  assert.strictEqual(E({ drillDepth: 2 }), "pop");
  assert.strictEqual(E({ drillDepth: 5, closeOnEmpty: true }), "pop");
  assert.strictEqual(E({ drillDepth: 1 }), "list");
  assert.strictEqual(E({ drillDepth: 1, closeOnEmpty: false }), "list");
  assert.strictEqual(E({ drillDepth: 1, closeOnEmpty: true }), "close");
  assert.strictEqual(E({ drillDepth: 0 }), "close");
  assert.strictEqual(E({ drillDepth: 0, closeOnEmpty: false }), "close");
  assert.strictEqual(E({ drillDepth: "junk" }), "close");
  assert.strictEqual(E({}), "close");
  assert.strictEqual(E(null), "close");
});

t("Desk route: live + schema ok goes to the Desk, else the modal", () => {
  const R = L.WB_deskRoute;
  assert.strictEqual(R({ live: true, schemaOk: true }), "desk");
  assert.strictEqual(R({ live: true, schemaOk: true, opts: { from: "arrival" } }), "desk");
  assert.strictEqual(R({ live: true, schemaOk: true, opts: { modal: true } }), "modal");
  assert.strictEqual(R({ live: true, schemaOk: true, opts: { modal: "yes" } }), "desk");
  assert.strictEqual(R({ live: false, schemaOk: true }), "modal");
  assert.strictEqual(R({ live: true, schemaOk: false }), "modal");
  assert.strictEqual(R({}), "modal");
  assert.strictEqual(R(null), "modal");
});

t("Drill stack: push, same id on top, cap, pop, top", () => {
  const P = L.WB_drillPush;
  let s = P([], { id: "a", from: "slate" });
  assert.deepStrictEqual(s, [{ id: "a", from: "slate", focus: null }]);
  s = P(s, { id: "b", from: "subtask" });
  assert.strictEqual(s.length, 2);
  assert.strictEqual(L.WB_drillTop(s).id, "b");
  // Same id on top: only the focus field changes, no new level.
  const same = P(s, { id: "b", from: "keys", focus: "assignee" });
  assert.strictEqual(same.length, 2);
  assert.deepStrictEqual(same[1], { id: "b", from: "subtask", focus: "assignee" });
  // The same id lower down is a new level (a -> b -> a).
  assert.strictEqual(P(s, { id: "a" }).length, 3);
  // Cap 5: the oldest drops.
  let c = [];
  ["1", "2", "3", "4", "5", "6", "7"].forEach((id) => (c = P(c, { id })));
  assert.deepStrictEqual(c.map((x) => x.id), ["3", "4", "5", "6", "7"]);
  assert.strictEqual(L.WB_DRILL_CAP, 5);
  assert.strictEqual(P(c, { id: "8" }, 2).length, 2);
  // Junk items and stacks.
  assert.deepStrictEqual(P(s, null), s);
  assert.deepStrictEqual(P(s, { id: "" }), s);
  assert.deepStrictEqual(P(null, { id: 7 }), [{ id: "7", from: "", focus: null }]);
  assert.deepStrictEqual(P([null, { id: "" }, { id: "x" }], { id: "y" }).map((x) => x.id), ["x", "y"]);
  // Pop and top; the input is never changed.
  const before = JSON.stringify(s);
  assert.deepStrictEqual(L.WB_drillPop(s).map((x) => x.id), ["a"]);
  assert.strictEqual(JSON.stringify(s), before);
  assert.deepStrictEqual(L.WB_drillPop([]), []);
  assert.deepStrictEqual(L.WB_drillPop(null), []);
  assert.strictEqual(L.WB_drillTop([]), null);
});

t("Drill stack kept for 5 minutes after the Desk closes", () => {
  const K = L.WB_drillKept;
  const t0 = 1000000;
  assert.strictEqual(K(0, t0), true); // never closed with a task
  assert.strictEqual(K(t0, t0 + 1000), true);
  assert.strictEqual(K(t0, t0 + L.WB_DRILL_KEEP_MS), true);
  assert.strictEqual(K(t0, t0 + L.WB_DRILL_KEEP_MS + 1), false);
  assert.strictEqual(K(t0, NaN), false);
});

t("Drill back label: Desk one deep, else the task underneath", () => {
  const B = L.WB_drillBackLabel;
  const titles = { a: "Reconcile March", b: "Call the bank" };
  const of = (id) => titles[id] || "";
  assert.strictEqual(B([{ id: "a" }], of), "Back to Desk");
  assert.strictEqual(B([], of), "Back to Desk");
  assert.strictEqual(B([{ id: "a" }], of, "Slate"), "Back to Slate");
  assert.strictEqual(B([{ id: "a" }, { id: "b" }], of), "Back to Reconcile March");
  assert.strictEqual(B([{ id: "z" }, { id: "b" }], of), "Back to the previous task");
  assert.strictEqual(B([{ id: "a" }, { id: "b" }], () => { throw new Error("x"); }), "Back to the previous task");
  const long = B([{ id: "a" }, { id: "b" }], () => "x".repeat(80));
  assert.ok(long.length <= "Back to ".length + 40 && /…$/.test(long));
});

t("Task view width: at least Wide, a dragged width wins", () => {
  const W = L.WB_deskTaskWidth;
  assert.strictEqual(W(380), 460);
  assert.strictEqual(W(500), 500);
  assert.strictEqual(W(undefined), 460);
  assert.strictEqual(W(380, 340), 340);
  assert.strictEqual(W(380, null), 460);
  // WB_deskLayout still clamps it to the window.
  assert.strictEqual(L.WB_deskLayout({ vw: 1100, railW: 220, w: W(380), open: true }).w, 400);
});

t("F6 moves between the page and the open Desk", () => {
  const F = L.WB_deskF6Target;
  assert.strictEqual(F({ open: true, zone: "page" }), "desk");
  assert.strictEqual(F({ open: true, zone: "bar" }), "desk");
  assert.strictEqual(F({ open: true, zone: "desk" }), "page");
  assert.strictEqual(F({ open: false, zone: "page" }), null);
  assert.strictEqual(F({ open: true, zone: null }), null);
  assert.strictEqual(F(null), null);
});

t("Desk mounts only for the signed-in person's own view", () => {
  const ok = { showStaffRail: true, tkShell: false, previewing: false, impersonating: false, email: "a@x.com" };
  assert.strictEqual(L.WB_deskMounts(ok), true);
  assert.strictEqual(L.WB_deskMounts(Object.assign({}, ok, { previewing: true })), false);
  assert.strictEqual(L.WB_deskMounts(Object.assign({}, ok, { impersonating: true })), false);
  assert.strictEqual(L.WB_deskMounts(Object.assign({}, ok, { tkShell: true })), false);
  assert.strictEqual(L.WB_deskMounts(Object.assign({}, ok, { email: "" })), false);
  assert.strictEqual(L.WB_deskMounts(Object.assign({}, ok, { email: null })), false);
  assert.strictEqual(L.WB_deskMounts(Object.assign({}, ok, { showStaffRail: false })), false);
  assert.strictEqual(L.WB_deskMounts(null), false);
});

t("Desk live: mounted, switched on and the table present (the chat bubble hides only then)", () => {
  const V = L.WB_deskLive;
  assert.strictEqual(V({ mounts: true, on: true, status: "ready" }), true);
  assert.strictEqual(V({ mounts: true, on: true, status: "loading" }), true);
  assert.strictEqual(V({ mounts: true, on: true, status: "missing" }), false);
  assert.strictEqual(V({ mounts: true, on: false, status: "ready" }), false);
  assert.strictEqual(V({ mounts: false, on: true, status: "ready" }), false);
  assert.strictEqual(V(null), false);
});

t("Desk key is plain D; W no longer toggles", () => {
  const K = L.WB_deskToggleKey;
  assert.strictEqual(K({ key: "d" }), true);
  assert.strictEqual(K({ key: "D" }), true); // caps lock
  assert.strictEqual(K({ key: "D", shiftKey: true }), false);
  assert.strictEqual(K({ key: "d", metaKey: true }), false);
  assert.strictEqual(K({ key: "d", ctrlKey: true }), false);
  assert.strictEqual(K({ key: "d", altKey: true }), false);
  assert.strictEqual(K({ key: "w" }), false);
  assert.strictEqual(K({ key: "W" }), false);
  assert.strictEqual(K(null), false);
});

t("Desk focus zone and where focus returns on close", () => {
  assert.strictEqual(L.WB_deskFocusZone({ inPanel: true }), "desk");
  assert.strictEqual(L.WB_deskFocusZone({ onBar: true }), "bar");
  assert.strictEqual(L.WB_deskFocusZone({}), "page");
  assert.strictEqual(L.WB_deskFocusZone({ inLayer: true, inPanel: true }), null);
  const R = L.WB_deskReturnFocus;
  assert.strictEqual(R({ openerOk: true, handleOk: true }), "opener");
  assert.strictEqual(R({ openerOk: false, handleOk: true }), "handle");
  assert.strictEqual(R({ openerOk: false, handleOk: false }), "main");
  assert.strictEqual(R(null), "main");
});

t("Info bar progress: late, X of Y today, Clean slate", () => {
  const P = L.WB_barProgress;
  assert.deepStrictEqual(P({ late: 3, dueOpen: 3, doneToday: 5 }), { late: 3, lateText: "3 late", todayText: "5 of 8 today", empty: false });
  assert.deepStrictEqual(P({ late: 0, dueOpen: 2, doneToday: null }), { late: 0, lateText: "", todayText: "2 today", empty: false });
  assert.deepStrictEqual(P({ late: 0, dueOpen: 0, doneToday: 4 }), { late: 0, lateText: "", todayText: "4 of 4 today", empty: false });
  assert.strictEqual(P({ late: 0, dueOpen: 0, doneToday: 0 }).empty, true);
  assert.strictEqual(P({ late: 0, dueOpen: 0, doneToday: null }).empty, true);
  assert.strictEqual(P({ late: 1, dueOpen: 0, doneToday: 0 }).todayText, "");
  assert.strictEqual(P(null).empty, true);
  assert.strictEqual(P({ late: -2, dueOpen: "x" }).empty, true);
});

t("Rail counts: messages, reviews, files and mentions only", () => {
  const C = L.WB_railCounts;
  assert.deepStrictEqual(C({ counts: { message: 2, review: 1, doc: 0, task: 9, gl: 4 }, mentions: 3 }), { message: 2, review: 1, doc: 0, mention: 3 });
  assert.deepStrictEqual(C({ counts: { message: -1, review: "x" }, mentions: NaN }), { message: 0, review: 0, doc: 0, mention: 0 });
  assert.deepStrictEqual(C(null), { message: 0, review: 0, doc: 0, mention: 0 });
});

t("Done today counts my finished tasks on today's Chicago date", () => {
  const today = "2026-10-19";
  const isMine = (t) => t.assignee_email === "a@x.com";
  const isDone = (t) => t.status === "done";
  const rows = [
    { assignee_email: "a@x.com", status: "done", completed_at: "2026-10-19T15:00:00Z" },
    { assignee_email: "a@x.com", status: "done", completed_at: "2026-10-20T04:30:00Z" }, // 11:30pm Chicago, still the 19th
    { assignee_email: "a@x.com", status: "done", completed_at: "2026-10-18T15:00:00Z" },
    { assignee_email: "b@x.com", status: "done", completed_at: "2026-10-19T15:00:00Z" },
    { assignee_email: "a@x.com", status: "todo", completed_at: "2026-10-19T15:00:00Z" },
    { assignee_email: "a@x.com", status: "done", completed_at: "2026-10-19T15:00:00Z", deleted_at: "x" },
    { assignee_email: "a@x.com", status: "done" },
    null,
  ];
  assert.strictEqual(L.WB_doneToday(rows, { today, isMine, isDone }), 2);
  assert.strictEqual(L.WB_doneToday(rows, { today }), 0);
  assert.strictEqual(L.WB_doneToday(null, { today, isMine, isDone }), 0);
});

t("Info bar client line: tasks, waiting, QuickBooks sync, nothing off a client page", () => {
  const C = L.WB_barClientLine;
  const now = Date.parse("2026-10-19T12:00:00Z");
  assert.strictEqual(C({ name: "" }), null);
  assert.strictEqual(C(null), null);
  const a = C({ name: "Acme", loaded: true, tasks: 2, overdue: 0, waiting: 1, qbo: true, syncedAt: "2026-10-19T09:00:00Z", staleHours: 26, now, ago: "3 hours ago" });
  assert.deepStrictEqual(a, {
    name: "Acme",
    parts: [
      { key: "tasks", text: "2 open tasks", bad: false },
      { key: "waiting", text: "1 waiting on the client", bad: false },
      { key: "qbo", text: "QuickBooks synced 3 hours ago", bad: false },
    ],
  });
  assert.strictEqual(C({ name: "Acme", loaded: true, tasks: 1, overdue: 1 }).parts[0].text, "1 open task");
  assert.strictEqual(C({ name: "Acme", loaded: true, tasks: 1, overdue: 1 }).parts[0].bad, true);
  assert.strictEqual(C({ name: "Acme", loaded: true, tasks: 0 }).parts[0].text, "No open tasks");
  // Not loaded (or errored): only the sync part, which the client row already has.
  assert.deepStrictEqual(C({ name: "Acme", loaded: false, qbo: true, qboError: true }).parts, [{ key: "qbo", text: "QuickBooks needs reconnecting", bad: true }]);
  assert.deepStrictEqual(C({ name: "Acme", loaded: true, error: true }).parts, []);
  // Stale past the plan's hours.
  assert.strictEqual(C({ name: "Acme", qbo: true, syncedAt: "2026-10-17T09:00:00Z", staleHours: 26, now, ago: "2 days ago" }).parts[0].bad, true);
  assert.strictEqual(C({ name: "Acme", qbo: true }).parts[0].text, "QuickBooks hasn't synced yet");
  // No QuickBooks: no sync part.
  assert.deepStrictEqual(C({ name: "Acme", loaded: true, tasks: 0, qbo: false }).parts.map((p) => p.key), ["tasks"]);
});

t("WB_railLine: who, subject and the wait", () => {
  const now = Date.parse("2026-10-14T17:00:00Z");
  assert.strictEqual(L.WB_railLine({ client_name: "Acme", title: "Question", waiting_since: "2026-10-14T14:00:00Z" }, now), "Acme: Question · 3h");
  assert.strictEqual(L.WB_railLine({ client_name: "Acme", title: "Question", waiting_since: "2026-10-11T17:00:00Z" }, now), "Acme: Question · 3 days");
  assert.strictEqual(L.WB_railLine({ title: "Review" }, now), "Review");
  assert.strictEqual(L.WB_railLine({ title: "Bad", waiting_since: "nope" }, now), "Bad");
  assert.strictEqual(L.WB_railLine(null, now), "");
});

t("WB_deskContext: client page card", () => {
  const C = L.WB_deskContext;
  const now = Date.parse("2026-10-14T17:00:00Z");
  const counts = {
    loaded: true,
    error: false,
    tasks: { mine: 3, overdue: 1 },
    messages: { count: 2, overdue: 0, oldestWaitAt: "2026-10-12T17:00:00Z" },
    bank: { waiting: 1 },
    close: { label: "September close is late", tone: "bad", qbo: "ok" },
  };
  const ctx = C({ page: "overview", clientName: " Acme " }, { counts, qbo: true, syncedAt: "2026-10-14T14:00:00Z", staleHours: 26, ago: "3 hours ago", now });
  assert.deepStrictEqual(ctx, {
    kind: "client",
    title: "Acme",
    parts: [
      { key: "tasks", text: "3 open tasks, 1 late", bad: true, go: "client" },
      { key: "messages", text: "2 messages to answer, oldest 2 days", bad: false, go: "messages" },
      { key: "waiting", text: "1 waiting on the client", bad: false, go: null },
      { key: "close", text: "September close is late", bad: true, go: null },
      { key: "qbo", text: "QuickBooks synced 3 hours ago", bad: false, go: null },
    ],
  });
  // Quiet client: no tasks, no messages, nothing waiting, no QuickBooks.
  const quiet = C({ page: "overview", clientName: "Acme" }, { counts: { loaded: true, tasks: { mine: 0 }, messages: { count: 0 } }, now });
  assert.deepStrictEqual(quiet.parts.map((p) => p.text), ["No open tasks", "No messages waiting"]);
  // One task, one late; a message past its SLA is bad.
  const one = C({ clientName: "Acme" }, { counts: { loaded: true, tasks: { mine: 1, overdue: 1 }, messages: { count: 1, overdue: 1 } }, now });
  assert.strictEqual(one.parts[0].text, "1 open task, 1 late");
  assert.strictEqual(one.parts[1].text, "1 message to answer");
  assert.strictEqual(one.parts[1].bad, true);
  // The Desk's own inbox rows for this client win when the tab counts lag
  // (never "No messages waiting" while the rail counts one for this client).
  const lag = C({ clientName: "Acme" }, { counts: { loaded: true, tasks: {}, messages: { count: 0 } }, deskMessages: { count: 1, oldestAt: "2026-10-14T15:00:00Z" }, now });
  assert.deepStrictEqual(lag.parts[1], { key: "messages", text: "1 message to answer, oldest 2h", bad: false, go: "messages" });
  const older = C({ clientName: "Acme" }, { counts: { loaded: true, tasks: {}, messages: { count: 2, oldestWaitAt: "2026-10-14T15:00:00Z" } }, deskMessages: { count: 1, oldestAt: "2026-10-12T17:00:00Z" }, now });
  assert.strictEqual(older.parts[1].text, "2 messages to answer, oldest 2 days");
  assert.strictEqual(older.parts[1].bad, true);
  // Not loaded (or errored): only QuickBooks.
  assert.deepStrictEqual(C({ clientName: "Acme" }, { counts: { loaded: false }, qbo: true, now }).parts, [{ key: "qbo", text: "QuickBooks hasn't synced yet", bad: false, go: null }]);
  assert.deepStrictEqual(C({ clientName: "Acme" }, { counts: { loaded: true, error: true }, now }).parts, []);
  // A broken connection says so once (the close line carries the same words).
  const broken = C(
    { clientName: "Acme" },
    { counts: { loaded: true, tasks: {}, messages: {}, close: { label: "QuickBooks needs reconnecting", tone: "bad", qbo: "error" } }, qbo: true, syncedAt: "2026-10-14T14:00:00Z", now },
  );
  assert.deepStrictEqual(broken.parts.filter((p) => /reconnect/.test(p.text)).map((p) => p.key), ["qbo"]);
  // Stale past the plan's hours.
  assert.strictEqual(C({ clientName: "Acme" }, { qbo: true, syncedAt: "2026-10-12T09:00:00Z", staleHours: 26, ago: "2 days ago", now }).parts[0].bad, true);
});

t("WB_deskContext: inbox and elsewhere", () => {
  const C = L.WB_deskContext;
  const now = Date.parse("2026-10-14T17:00:00Z");
  assert.deepStrictEqual(C({ page: "inbox" }, { inbox: { count: 4, messages: 2, oldestAt: "2026-10-14T15:00:00Z" }, now }), {
    kind: "inbox",
    title: "Inbox",
    parts: [
      { key: "all", text: "4 items waiting on you", bad: false, go: null },
      { key: "messages", text: "Oldest message waiting 2h", bad: false, go: null },
    ],
  });
  // No wait known: no messages line (the glance strip has the count).
  assert.deepStrictEqual(C({ page: "inbox" }, { inbox: { count: 1, messages: 1 }, now }).parts.map((p) => p.key), ["all"]);
  assert.deepStrictEqual(C({ page: "inbox" }, { now }).parts, [{ key: "all", text: "Nothing waiting on you", bad: false, go: null }]);
  // A client name wins over the page (a client tab is a client page).
  assert.strictEqual(C({ page: "inbox", clientName: "Acme" }, { now }).kind, "client");
  assert.strictEqual(C({ page: "today" }, { now }), null);
  assert.strictEqual(C(null, null), null);
});

t("WB_deskTier and WB_deskFill: budgets, order, off items, min length", () => {
  assert.strictEqual(L.WB_deskTier(500), "short");
  assert.strictEqual(L.WB_deskTier(700), "medium");
  assert.strictEqual(L.WB_deskTier(900), "tall");
  assert.strictEqual(L.WB_deskTier(0), "tall");
  assert.strictEqual(L.WB_deskTier("x"), "tall");
  const F = L.WB_deskFill;
  const both = { glance: true, rightNow: true };
  assert.deepStrictEqual(F({ tier: "tall", ctx: both }), ["glance", "rightNow"]);
  assert.deepStrictEqual(F({ tier: "medium", ctx: both }), ["glance", "rightNow"]);
  // Short: one line, the counts only (Right now needs Medium).
  assert.deepStrictEqual(F({ tier: "short", ctx: both }), ["glance"]);
  assert.deepStrictEqual(F({ tier: "short", ctx: { rightNow: true } }), []);
  // Not showing (nothing to count, no context): skipped.
  assert.deepStrictEqual(F({ tier: "tall", ctx: { rightNow: true } }), ["rightNow"]);
  assert.deepStrictEqual(F({ tier: "tall", ctx: {} }), []);
  // Off in prefs; an unknown tier is Tall.
  assert.deepStrictEqual(F({ tier: "tall", ctx: both, prefs: { on: { rightNow: false } } }), ["glance"]);
  assert.deepStrictEqual(F({ tier: "huge", ctx: both }), ["glance", "rightNow"]);
  // Order is honored, but the counts stay first; lines must fit the budget.
  const items = [
    { id: "glance", lines: 1, minTier: "short", on: true, first: true },
    { id: "a", lines: 2, minTier: "short", on: true },
    { id: "b", lines: 2, minTier: "short", on: true },
    { id: "c", lines: 1, minTier: "short", on: false },
  ];
  const all = { glance: true, a: true, b: true, c: true };
  assert.deepStrictEqual(F({ items, tier: "medium", ctx: all }), ["glance", "a"]);
  assert.deepStrictEqual(F({ items, tier: "medium", ctx: all, prefs: { order: ["b", "a", "glance"] } }), ["glance", "b"]);
  assert.deepStrictEqual(F({ items, tier: "tall", ctx: all, prefs: { on: { c: true } } }), ["glance", "a", "b", "c"]);
  // Turning one off lets the next one move up.
  assert.deepStrictEqual(F({ items, tier: "medium", ctx: all, prefs: { on: { a: false } } }), ["glance", "b"]);
});

t("WB_deskClosedShow: the When closed choices", () => {
  const S = L.WB_deskClosedShow;
  assert.deepStrictEqual(S("both", "dock"), { rail: true, bar: true });
  assert.deepStrictEqual(S(undefined, "dock"), { rail: true, bar: true });
  assert.deepStrictEqual(S("junk", "dock"), { rail: true, bar: true });
  assert.deepStrictEqual(S("rail", "dock"), { rail: true, bar: false });
  assert.deepStrictEqual(S("bar", "dock"), { rail: false, bar: true });
  assert.deepStrictEqual(S("neither", "dock"), { rail: false, bar: false });
  // Phones: no rail, and the bar is the only way in.
  assert.deepStrictEqual(S("neither", "sheet"), { rail: false, bar: true });
  assert.deepStrictEqual(S("rail", "sheet"), { rail: false, bar: true });
  assert.deepStrictEqual(L.WB_DESK_CLOSED, ["both", "rail", "bar", "neither"]);
});

t("WB_deskMounts: View as, preview, impersonation and the Slate shell never mount the docked column", () => {
  const base = { showStaffRail: true, email: "a@b.co" };
  assert.strictEqual(L.WB_deskMounts(base), true);
  assert.strictEqual(L.WB_deskMounts(Object.assign({}, base, { tkShell: true })), false);
});

t("owner rule: an excused late task waits in Today, never overdue", () => {
  const late = row({ due_date: "2026-10-13", client_id: "grace", source_id: "x1" });
  assert.strictEqual(L.WB_groupOf(late, TODAY), "overdue");
  assert.strictEqual(L.WB_groupOf(Object.assign({}, late, { late_excused: true }), TODAY), "today");
  const keys = { "grace|2026-09-01": true, "zion|2026-09-01": false };
  const rows = [
    late,
    row({ due_date: "2026-10-13", client_id: "zion", source_id: "x2" }),
    row({ due_date: TODAY, client_id: "grace", source_id: "x3" }),
    row({ due_date: "2026-10-10", client_id: "grace", source_id: "x4", source: "client_request", kind: "request" }),
  ];
  assert.deepStrictEqual(L.WB_excuseCandidates(rows, TODAY, keys), ["x1"]);
  assert.deepStrictEqual(L.WB_excuseCandidates(rows, TODAY, {}), []);
  const out = L.WB_applyExcused(rows, ["x1"]);
  assert.strictEqual(out[0].late_excused, true);
  assert.strictEqual(out[1], rows[1], "untouched rows keep identity");
  assert.strictEqual(L.WB_applyExcused(rows, []), rows, "nothing to change returns the same list");
  assert.strictEqual(L.WB_applyExcused(out, []).length, 4);
  assert.strictEqual(L.WB_applyExcused(out, [])[0].late_excused, false, "a re-check can clear it");
});

console.log("WB_logic: " + n + " checks passed");
