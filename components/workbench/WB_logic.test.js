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
  assert.ok(L.WB_LAYER_SELECTORS.every((x) => !/^\.wb-panel/.test(x) || /\.tk-menu|\.wb-pick-list/.test(x)));
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
  assert.strictEqual(L.WB_hubClean({ chip: "gl" }).chip, "all"); // gl is not a drawer chip
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

// ---- D3: docked, resizable Desk ----
t("Desk mode: sheet at the 760px phone breakpoint, dock above", () => {
  assert.strictEqual(L.WB_deskMode(760), "sheet");
  assert.strictEqual(L.WB_deskMode(761), "dock");
  assert.strictEqual(L.WB_deskMode(375), "sheet");
  assert.strictEqual(L.WB_deskMode(1440), "dock");
  assert.strictEqual(L.WB_deskMode(NaN), "dock");
  assert.strictEqual(L.WB_deskMode(undefined), "dock");
});

t("Desk points: strip, medium, tall and the merges", () => {
  const p = L.WB_deskPoints(900);
  assert.deepStrictEqual([p.strip, p.medium, p.tall], [148, 405, 702]);
  assert.strictEqual(p.merged, false);
  // vh 400: medium and tall merge, strip stays its own stop.
  const q = L.WB_deskPoints(400);
  assert.strictEqual(q.strip, 148);
  assert.strictEqual(q.medium, q.tall);
  assert.ok(q.medium - q.strip >= 80);
  // vh 300: all three merge (the handle hides).
  const r = L.WB_deskPoints(300);
  assert.ok(r.strip === r.medium && r.medium === r.tall);
  assert.strictEqual(r.merged, true);
  assert.ok(r.tall <= 300 - 16);
  // tall never comes closer than 16px to the top.
  [360, 420, 500, 640, 800, 1000, 1400, 2200].forEach((vh) => {
    const s = L.WB_deskPoints(vh);
    assert.ok(s.tall <= vh - 16, "tall at " + vh);
    assert.ok(s.strip <= s.medium && s.medium <= s.tall, "order at " + vh);
  });
  // Garbage room does not throw.
  const z = L.WB_deskPoints("x");
  assert.ok(z.tall >= 0);
});

t("Desk clamp: strip floor, 16px from the top, NaN goes to strip", () => {
  assert.strictEqual(L.WB_deskClamp(20, 900), 148);
  assert.strictEqual(L.WB_deskClamp(5000, 900), 884);
  assert.strictEqual(L.WB_deskClamp(NaN, 900), 148);
  assert.strictEqual(L.WB_deskClamp(400.4, 900), 400);
  // A window too short for the strip gets what fits.
  assert.strictEqual(L.WB_deskClamp(300, 120), 104);
  assert.strictEqual(L.WB_deskClamp(300, 10), 0);
});

t("Desk snap: nearest stop, ties go up, flings move one stop", () => {
  const p = L.WB_deskPoints(900); // 148 / 405 / 702
  assert.strictEqual(L.WB_deskSnap(160, 0, p), "strip");
  assert.strictEqual(L.WB_deskSnap(390, 0, p), "medium");
  assert.strictEqual(L.WB_deskSnap(800, 0, p), "tall");
  // Midpoint of 148 and 405 is 276.5; of 405 and 702 is 553.5.
  const tie = L.WB_deskSnap(276.5, 0, p);
  assert.strictEqual(tie, "medium");
  assert.strictEqual(L.WB_deskSnap(553.5, 0, p), "tall");
  // A fling up from strip goes to medium, not tall.
  assert.strictEqual(L.WB_deskSnap(150, 1.2, p), "medium");
  // A fling down from tall goes to medium.
  assert.strictEqual(L.WB_deskSnap(700, -1.2, p), "medium");
  // 0.59 is not a fling.
  assert.strictEqual(L.WB_deskSnap(150, 0.59, p), "strip");
  assert.strictEqual(L.WB_deskSnap(700, -0.59, p), "tall");
  // A fling past the end stays at the end.
  assert.strictEqual(L.WB_deskSnap(702, 2, p), "tall");
  assert.strictEqual(L.WB_deskSnap(148, -2, p), "strip");
  // Merged points: the first name at that height.
  const q = L.WB_deskPoints(400);
  assert.strictEqual(L.WB_deskSnap(q.tall, 0, q), "medium");
  assert.strictEqual(L.WB_deskSnap(100, 0, {}), "medium");
});

t("Desk step: arrows, page keys, Home and End, merged stops", () => {
  const p = L.WB_deskPoints(900);
  assert.strictEqual(L.WB_deskStep("tall", "ArrowUp", p), "tall");
  assert.strictEqual(L.WB_deskStep("medium", "ArrowUp", p), "tall");
  assert.strictEqual(L.WB_deskStep("medium", "PageUp", p), "tall");
  assert.strictEqual(L.WB_deskStep("medium", "ArrowDown", p), "strip");
  assert.strictEqual(L.WB_deskStep("tall", "PageDown", p), "medium");
  assert.strictEqual(L.WB_deskStep("strip", "ArrowDown", p), "strip");
  assert.strictEqual(L.WB_deskStep("tall", "Home", p), "strip");
  assert.strictEqual(L.WB_deskStep("strip", "End", p), "tall");
  assert.strictEqual(L.WB_deskStep("medium", "Enter", p), "medium");
  assert.strictEqual(L.WB_deskStep("medium", "x", p), "medium");
  // Merged medium/tall: up from strip lands on medium, and up again stays.
  const q = L.WB_deskPoints(400);
  assert.strictEqual(L.WB_deskStep("strip", "ArrowUp", q), "medium");
  assert.strictEqual(L.WB_deskStep("medium", "ArrowUp", q), "medium");
  assert.strictEqual(L.WB_deskStep("tall", "ArrowUp", q), "tall");
  assert.strictEqual(L.WB_deskStep("tall", "ArrowDown", q), "strip");
  // All merged: nothing moves.
  const r = L.WB_deskPoints(300);
  assert.strictEqual(L.WB_deskStep("medium", "ArrowDown", r), "medium");
  // A bad snap name counts as medium.
  assert.strictEqual(L.WB_deskStep("huge", "ArrowUp", p), "tall");
});

t("Desk height, percent and words", () => {
  const p = L.WB_deskPoints(900);
  assert.strictEqual(L.WB_deskHeight("strip", p), 148);
  assert.strictEqual(L.WB_deskHeight("nope", p), 405);
  assert.strictEqual(L.WB_deskPct(405, 900), 45);
  assert.strictEqual(L.WB_deskPct(405, 0), 0);
  assert.strictEqual(L.WB_deskPct(5000, 900), 100);
  assert.ok(/Medium/.test(L.WB_deskValueText("medium")));
  assert.ok(/Short/.test(L.WB_deskValueText("strip")));
  assert.ok(/Tall/.test(L.WB_deskValueText("tall")));
  assert.ok(/Medium/.test(L.WB_deskValueText(null)));
});

t("Desk persist: round trip, bad values fall back to medium, key lowercases", () => {
  assert.strictEqual(L.WB_deskSerialize({ snap: "medium" }), '{"v":1,"snap":"medium"}');
  ["strip", "medium", "tall"].forEach((s) => {
    assert.deepStrictEqual(L.WB_deskParse(L.WB_deskSerialize({ snap: s })), { v: 1, snap: s });
  });
  assert.deepStrictEqual(L.WB_deskParse("{not json"), { v: 1, snap: "medium" });
  assert.deepStrictEqual(L.WB_deskParse('{"v":2,"snap":"tall"}'), { v: 1, snap: "medium" });
  assert.deepStrictEqual(L.WB_deskParse('{"v":1,"snap":"huge"}'), { v: 1, snap: "medium" });
  assert.deepStrictEqual(L.WB_deskParse(null), { v: 1, snap: "medium" });
  assert.deepStrictEqual(L.WB_deskParse("null"), { v: 1, snap: "medium" });
  assert.deepStrictEqual(L.WB_deskParse('"tall"'), { v: 1, snap: "medium" });
  assert.strictEqual(L.WB_deskSerialize(null), '{"v":1,"snap":"medium"}');
  assert.strictEqual(L.WB_deskKey("A@x.com"), "mgb_wb_desk:a@x.com");
  assert.strictEqual(L.WB_deskKey(" A@X.com ").split(":")[1], L.WB_hubKey("A@X.com").split(":")[1]);
  assert.strictEqual(L.WB_deskKey(""), null);
  // The hub blob is untouched by D3: no height, no snap in it.
  const hub = L.WB_hubSerialize(L.WB_hubDefault(), 1000);
  assert.ok(hub.indexOf("snap") < 0 && hub.indexOf("height") < 0);
});

t("Desk page padding: the dock lifts the page, closed and sheet do not", () => {
  assert.deepStrictEqual(L.WB_deskPagePad({ open: false, mode: "dock", h: 400 }), { pad: 60, lift: 0 });
  assert.deepStrictEqual(L.WB_deskPagePad({ open: true, mode: "sheet", h: 400 }), { pad: 60, lift: 0 });
  assert.deepStrictEqual(L.WB_deskPagePad({ open: true, mode: "dock", h: 404.6 }), { pad: 405, lift: 405 });
  assert.deepStrictEqual(L.WB_deskPagePad({ open: true, mode: "dock", h: NaN }), { pad: 60, lift: 0 });
  assert.deepStrictEqual(L.WB_deskPagePad(null), { pad: 60, lift: 0 });
});

t("Desk Esc ladder: layer > picker > field > inner > back > close", () => {
  const E = L.WB_deskEscStep;
  const all = { layerAbove: true, pickerOpen: true, fieldKeeps: true, drillInner: true, drillDepth: 2 };
  assert.strictEqual(E(all), "layer");
  assert.strictEqual(E(Object.assign({}, all, { layerAbove: false })), "picker");
  assert.strictEqual(E(Object.assign({}, all, { layerAbove: false, pickerOpen: false })), "field");
  assert.strictEqual(E({ drillInner: true, drillDepth: 1 }), "inner");
  assert.strictEqual(E({ drillDepth: 1 }), "back");
  assert.strictEqual(E({ drillDepth: 0 }), "close");
  assert.strictEqual(E({}), "close");
  assert.strictEqual(E(null), "close");
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

t("Desk focus zone and where focus goes on close", () => {
  assert.strictEqual(L.WB_deskFocusZone({ inPanel: true }), "desk");
  assert.strictEqual(L.WB_deskFocusZone({ onBar: true }), "bar");
  assert.strictEqual(L.WB_deskFocusZone({}), "page");
  assert.strictEqual(L.WB_deskFocusZone({ inLayer: true, inPanel: true }), null);
  assert.strictEqual(L.WB_deskCloseFocus("desk"), "bar");
  assert.strictEqual(L.WB_deskCloseFocus("page"), "stay");
  assert.strictEqual(L.WB_deskCloseFocus("bar"), "stay");
  assert.strictEqual(L.WB_deskCloseFocus(null), "stay");
});

console.log("WB_logic: " + n + " checks passed");
