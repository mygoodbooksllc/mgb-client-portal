// node components/tasks/TK_drawerLogic.test.js
const assert = require("assert");
const L = require("./TK_drawerLogic.js");
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

// ---- TK_EDITABLE_FIELDS / TK_buildPatch
t("whitelist matches TK_api.update", () => {
  assert.deepStrictEqual(L.TK_EDITABLE_FIELDS, [
    "text", "description", "due_date", "due_at", "remind_at", "start_on", "priority", "kind", "recurrence", "recurrence_rule",
    "section", "sort_key", "sop_section", "review_required", "assignee_email", "visibility", "parent_id",
    "client_id", "project_id",
  ]);
});
const orig = {
  id: "t1", text: "Reconcile bank", description: null, due_date: "2026-10-14", start_on: null, priority: "normal",
  assignee_email: "bk@example.test", review_required: false, section: "Monthly", status: "todo", updated_at: "x",
};
t("buildPatch: unchanged draft gives {}", () => {
  assert.deepStrictEqual(L.TK_buildPatch(orig, Object.assign({}, orig)), {});
});
t("buildPatch: only changed fields", () => {
  assert.deepStrictEqual(L.TK_buildPatch(orig, { text: "Reconcile bank", priority: "high" }), { priority: "high" });
});
t("buildPatch: never non-whitelisted fields", () => {
  assert.deepStrictEqual(L.TK_buildPatch(orig, { status: "done", updated_at: "y", id: "t2", done: true }), {});
});
t("buildPatch: empty date becomes null", () => {
  assert.deepStrictEqual(L.TK_buildPatch(orig, { due_date: "" }), { due_date: null });
});
t("buildPatch: empty description is no change when it was null", () => {
  assert.deepStrictEqual(L.TK_buildPatch(orig, { description: "" }), {});
  assert.deepStrictEqual(L.TK_buildPatch(orig, { description: "   " }), {});
});
t("buildPatch: description set and cleared", () => {
  assert.deepStrictEqual(L.TK_buildPatch(orig, { description: "Notes" }), { description: "Notes" });
  assert.deepStrictEqual(L.TK_buildPatch({ description: "Notes" }, { description: "" }), { description: null });
});
t("buildPatch: title is trimmed and whitespace-only change ignored", () => {
  assert.deepStrictEqual(L.TK_buildPatch(orig, { text: "  Reconcile bank  " }), {});
  assert.deepStrictEqual(L.TK_buildPatch(orig, { text: " Reconcile bank feeds " }), { text: "Reconcile bank feeds" });
});
t("buildPatch: assignee lowercased, case change ignored, blank -> null", () => {
  assert.deepStrictEqual(L.TK_buildPatch(orig, { assignee_email: "BK@example.test" }), {});
  assert.deepStrictEqual(L.TK_buildPatch(orig, { assignee_email: "AM@Example.test" }), { assignee_email: "am@example.test" });
  assert.deepStrictEqual(L.TK_buildPatch(orig, { assignee_email: "" }), { assignee_email: null });
});
t("buildPatch: review_required boolean", () => {
  assert.deepStrictEqual(L.TK_buildPatch(orig, { review_required: true }), { review_required: true });
  assert.deepStrictEqual(L.TK_buildPatch(orig, { review_required: 0 }), {});
});
t("buildPatch: section blank -> null; sop section set", () => {
  assert.deepStrictEqual(L.TK_buildPatch(orig, { section: "" }), { section: null });
  assert.deepStrictEqual(L.TK_buildPatch(orig, { sop_section: "payroll" }), { sop_section: "payroll" });
});
t("buildPatch: tolerates nulls", () => {
  assert.deepStrictEqual(L.TK_buildPatch(null, null), {});
  assert.deepStrictEqual(L.TK_buildPatch(null, { text: "A" }), { text: "A" });
});

// ---- TK_validateDraft
t("validateDraft: fine draft", () => {
  assert.deepStrictEqual(L.TK_validateDraft({ text: "A", due_date: "2026-10-14", start_on: "2026-10-13" }), {});
});
t("validateDraft: title rules", () => {
  assert.strictEqual(L.TK_validateDraft({ text: "  " }).text, "Add a title.");
  assert.strictEqual(L.TK_validateDraft({ text: "x".repeat(500) }).text, undefined);
  assert.strictEqual(L.TK_validateDraft({ text: "x".repeat(501) }).text, "Keep the title under 500 characters.");
  assert.strictEqual(L.TK_validateDraft({}).text, undefined);
});
t("validateDraft: description length", () => {
  assert.strictEqual(L.TK_validateDraft({ description: "x".repeat(5000) }).description, undefined);
  assert.ok(L.TK_validateDraft({ description: "x".repeat(5001) }).description);
});
t("validateDraft: start after due", () => {
  assert.ok(L.TK_validateDraft({ start_on: "2026-10-15", due_date: "2026-10-14" }).start_on);
  assert.strictEqual(L.TK_validateDraft({ start_on: "2026-10-14", due_date: "2026-10-14" }).start_on, undefined);
});
t("validateDraft: recurrence needs due date", () => {
  assert.ok(L.TK_validateDraft({ recurrence: "weekly", due_date: "" }).recurrence);
  assert.strictEqual(L.TK_validateDraft({ recurrence: "none", due_date: null }).recurrence, undefined);
  assert.strictEqual(L.TK_validateDraft({ recurrence: "monthly", due_date: "2026-10-31" }).recurrence, undefined);
});

// ---- TK_mergeTimeline
t("mergeTimeline: ascending, skips comment activity, deleted comment", () => {
  const comments = [
    { id: "c2", created_at: "2026-10-10T12:00:00Z", body: "Second", mentions: [] },
    { id: "c1", created_at: "2026-10-10T10:00:00Z", body: "Gone", mentions: ["a@example.test"], deleted_at: "2026-10-10T11:00:00Z" },
  ];
  const activity = [
    { id: 3, kind: "comment", created_at: "2026-10-10T12:00:00Z" },
    { id: 2, kind: "status", to_value: "in_progress", created_at: "2026-10-10T10:00:00Z" },
    { id: 1, kind: "created", created_at: "2026-10-09T09:00:00Z" },
  ];
  const tl = L.TK_mergeTimeline(comments, activity);
  assert.deepStrictEqual(tl.map((x) => x.type + ":" + x.item.id), ["activity:1", "activity:2", "comment:c1", "comment:c2"]);
  assert.strictEqual(tl[2].item.body, "Comment deleted");
  assert.strictEqual(tl[2].item.deleted, true);
  assert.deepStrictEqual(tl[2].item.mentions, []);
  assert.strictEqual(comments[1].body, "Gone"); // input untouched
  assert.strictEqual(tl[0].at, "2026-10-09T09:00:00Z");
});
t("mergeTimeline: empty and null", () => {
  assert.deepStrictEqual(L.TK_mergeTimeline(null, undefined), []);
});
t("mergeTimeline: same time activity ids numeric order", () => {
  const tl = L.TK_mergeTimeline([], [
    { id: 10, kind: "due", created_at: "2026-10-10T10:00:00Z" },
    { id: 9, kind: "status", created_at: "2026-10-10T10:00:00Z" },
  ]);
  assert.deepStrictEqual(tl.map((x) => x.item.id), [9, 10]);
});

// ---- TK_activityText
const names = { "bk@example.test": "Pat Bookkeeper" };
const actOpts = {
  nameOf: (e) => names[e] || e,
  statusLabel: (s) => ({ in_progress: "In progress", done: "Done" })[s] || s,
  today: "2026-10-11",
};
t("activityText vectors", () => {
  const v = [
    [{ kind: "created" }, "Created"],
    [{ kind: "status", to_value: "in_progress" }, "Moved to In progress"],
    [{ kind: "review_approved" }, "Approved"],
    [{ kind: "review_sent_back" }, "Sent back"],
    [{ kind: "review_withdrawn" }, "Taken back from review"],
    [{ kind: "reviewer", to_value: "bk@example.test" }, "Reviewer set to Pat Bookkeeper"],
    [{ kind: "reviewer", to_value: null }, "Reviewer cleared"],
    [{ kind: "assignee", to_value: "bk@example.test" }, "Assigned to Pat Bookkeeper"],
    [{ kind: "assignee", to_value: null }, "Unassigned"],
    [{ kind: "due", to_value: "2026-10-14" }, "Due date set to Oct 14"],
    [{ kind: "due", to_value: "2027-01-05" }, "Due date set to Jan 5, 2027"],
    [{ kind: "due", to_value: null }, "Due date cleared"],
    [{ kind: "priority", to_value: "high" }, "Priority set to High"],
    [{ kind: "section", to_value: "Payroll" }, "Moved to the Payroll section"],
    [{ kind: "section", to_value: "" }, "Section cleared"],
    [{ kind: "moved", meta: { from_client: "a", to_client: "b" } }, "Moved to another list"],
    [{ kind: "deleted" }, "Deleted"],
    [{ kind: "restored" }, "Restored"],
    [{ kind: "comment" }, "Commented"],
    [{ kind: "client_asked" }, "Asked the client"],
    [{ kind: "client_answered" }, "The client answered"],
    [{ kind: "reassigned_ooo", to_value: "bk@example.test" }, "Reassigned to Pat Bookkeeper while out of office"],
    [{ kind: "reassigned_ooo", to_value: "bk@example.test", meta: { direction: "out" } }, "Reassigned to Pat Bookkeeper while out of office"],
    [{ kind: "reassigned_ooo", to_value: "bk@example.test", meta: { direction: "back" } }, "Handed back to Pat Bookkeeper after time off"],
    [{ kind: "imported" }, "Imported"],
    [{ kind: "close_checklist", to_value: "true", meta: { item_key: "bank_rec", period: "2026-11" } }, "Close checklist updated"],
    [{ kind: "something_new" }, "Changed"],
  ];
  v.forEach(([entry, want]) => assert.strictEqual(L.TK_activityText(entry, actOpts), want, entry.kind));
});
t("activityText: defaults without opts", () => {
  assert.strictEqual(L.TK_activityText({ kind: "assignee", to_value: "am@example.test" }), "Assigned to am");
  assert.strictEqual(L.TK_activityText(null), "Changed");
});

// ---- mentions
const staff = [
  { email: "pat.lee@example.test", name: "Pat Lee", active: true },
  { email: "sam@example.test", name: "Sam Rivera" },
  { email: "jo-ann@example.test", name: "Jo Ann Smith" },
  { email: "old@example.test", name: "Old Staff", active: false },
  { email: "patricia@example.test", name: "Alex Patricia" },
  { email: "ng@example.test", name: "Patty Ng" },
];
t("mentionMatches: handle prefix first, then name", () => {
  const m = L.TK_mentionMatches("pat", staff).map((s) => s.email);
  // handle matches (by name), then name-only matches
  assert.deepStrictEqual(m, ["patricia@example.test", "pat.lee@example.test", "ng@example.test"]);
});
t("mentionMatches: name word prefix and case", () => {
  assert.deepStrictEqual(L.TK_mentionMatches("RIV", staff).map((s) => s.email), ["sam@example.test"]);
  assert.deepStrictEqual(L.TK_mentionMatches("ann", staff).map((s) => s.email), ["jo-ann@example.test"]);
});
t("mentionMatches: inactive excluded, limit, empty query lists all active", () => {
  assert.deepStrictEqual(L.TK_mentionMatches("old", staff), []);
  assert.strictEqual(L.TK_mentionMatches("", staff).length, 5);
  assert.strictEqual(L.TK_mentionMatches("", staff, 2).length, 2);
  assert.deepStrictEqual(L.TK_mentionMatches("zz", staff), []);
  assert.deepStrictEqual(L.TK_mentionMatches("a", null), []);
});
t("mentionQuery", () => {
  assert.deepStrictEqual(L.TK_mentionQuery("Hi @pa", 6), { start: 3, query: "pa" });
  assert.deepStrictEqual(L.TK_mentionQuery("@", 1), { start: 0, query: "" });
  assert.strictEqual(L.TK_mentionQuery("mail me@pa", 10), null);
  assert.strictEqual(L.TK_mentionQuery("Hi @pa there", 12), null);
  assert.deepStrictEqual(L.TK_mentionQuery("(@sam", 5), { start: 1, query: "sam" });
  assert.strictEqual(L.TK_mentionQuery("", 0), null);
});
t("insertMention: replaces the typed query", () => {
  assert.deepStrictEqual(L.TK_insertMention("Hi @pa", 6, "pat.lee"), { body: "Hi @pat.lee ", caret: 12 });
});
t("insertMention: mid-text keeps the rest and one space", () => {
  const r = L.TK_insertMention("Hi @pa see this", 6, "pat.lee");
  assert.strictEqual(r.body, "Hi @pat.lee see this");
  assert.strictEqual(r.caret, 12);
});
t("insertMention: caret inside a handle replaces the whole token", () => {
  const r = L.TK_insertMention("Hi @pax now", 5, "sam");
  assert.strictEqual(r.body, "Hi @sam now");
});
t("insertMention: no @ inserts at caret with a lead space", () => {
  assert.deepStrictEqual(L.TK_insertMention("Hi", 2, "@sam"), { body: "Hi @sam ", caret: 8 });
  assert.deepStrictEqual(L.TK_insertMention("", 0, "sam"), { body: "@sam ", caret: 5 });
});
t("splitMentions: known handles become chips, unknown stay text", () => {
  const parts = L.TK_dlSplitMentions("Thanks @sam, ask @nobody and @pat.lee.", { sam: "Sam Rivera", "pat.lee": "Pat Lee" });
  assert.deepStrictEqual(parts, [
    { type: "text", text: "Thanks " },
    { type: "mention", handle: "sam", name: "Sam Rivera" },
    { type: "text", text: ", ask @nobody and " },
    { type: "mention", handle: "pat.lee", name: "Pat Lee" },
    { type: "text", text: "." },
  ]);
  assert.deepStrictEqual(L.TK_dlSplitMentions("mail me@sam", { sam: "Sam" }), [{ type: "text", text: "mail me@sam" }]);
  assert.deepStrictEqual(L.TK_dlSplitMentions("", {}), []);
});

// ---- attachments
t("validateAttachment: links", () => {
  assert.strictEqual(L.TK_validateAttachment({ url: "https://example.test/a" }), null);
  assert.strictEqual(L.TK_validateAttachment({ url: "http://example.test/a" }), "Links must start with https://.");
  assert.strictEqual(L.TK_validateAttachment({ url: "javascript:alert(1)" }), "Links must start with https://.");
  assert.strictEqual(L.TK_validateAttachment({ url: "https://" + "a".repeat(1995) }), "That link is too long.");
  assert.strictEqual(L.TK_validateAttachment({ url: "https://bad host" }), "That doesn't look like a link.");
  assert.strictEqual(L.TK_validateAttachment({ url: "" }), "Add a link.");
  assert.strictEqual(L.TK_validateAttachment({ url: "https://" + "a".repeat(1992) }), null); // 2000 exactly
});
t("validateAttachment: files", () => {
  const mb = 1024 * 1024;
  assert.strictEqual(L.TK_validateAttachment({ name: "a.pdf", size: 10, type: "application/pdf" }), null);
  assert.strictEqual(L.TK_validateAttachment({ name: "a.pdf", size: 25 * mb, type: "application/pdf" }), null);
  assert.strictEqual(L.TK_validateAttachment({ name: "a.pdf", size: 25 * mb + 1, type: "application/pdf" }), "That file is bigger than 25 MB.");
  assert.strictEqual(L.TK_validateAttachment({ name: "a.pdf", size: 0, type: "application/pdf" }), "That file is empty.");
  assert.ok(/can't be attached/.test(L.TK_validateAttachment({ name: "a.exe", size: 10, type: "application/x-msdownload" })));
  assert.ok(/can't be attached/.test(L.TK_validateAttachment({ name: "a.zip", size: 10, type: "" })));
  // CSV reported as an Excel type on Windows, or no type at all: the extension decides.
  assert.strictEqual(L.TK_validateAttachment({ name: "bank.csv", size: 10, type: "application/vnd.ms-excel" }), null);
  assert.strictEqual(L.TK_validateAttachment({ name: "notes.TXT", size: 10, type: "" }), null);
  assert.strictEqual(L.TK_validateAttachment(null), "Choose a file or add a link.");
});
t("ATTACH_MIMES and size", () => {
  assert.strictEqual(L.TK_ATTACH_MIMES.length, 9);
  assert.ok(L.TK_ATTACH_MIMES.indexOf("text/csv") >= 0);
  assert.strictEqual(L.TK_ATTACH_MAX_BYTES, 26214400);
  assert.strictEqual(L.TK_dlAttachMime({ name: "x.xlsx", type: "" }), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  assert.strictEqual(L.TK_dlAttachMime({ name: "x.png", type: "image/png" }), "image/png");
});
t("attachmentPath", () => {
  assert.strictEqual(L.TK_attachmentPath("T", "U", "Bank statement (Oct).pdf"), "T/U-Bank-statement--Oct-.pdf");
  assert.strictEqual(L.TK_attachmentPath("T", "U", "a.b-c_d.PDF"), "T/U-a.b-c_d.PDF");
  assert.strictEqual(L.TK_attachmentPath("T", "U", ""), "T/U-file");
  assert.strictEqual(L.TK_attachmentPath("T", "U", "///"), "T/U-file");
  assert.strictEqual(L.TK_attachmentPath("T", "U", "../../x.pdf"), "T/U-..-..-x.pdf");
  const long = L.TK_attachmentPath("T", "U", "x".repeat(150) + ".xlsx");
  const safe = long.slice("T/U-".length);
  assert.strictEqual(safe.length, 100);
  assert.ok(safe.endsWith(".xlsx"));
  assert.strictEqual(L.TK_attachmentPath("T", "U", "résumé.pdf"), "T/U-r-sum-.pdf");
});
t("formatSize", () => {
  assert.strictEqual(L.TK_dlFormatSize(512), "512 B");
  assert.strictEqual(L.TK_dlFormatSize(2048), "2 KB");
  assert.strictEqual(L.TK_dlFormatSize(1.5 * 1024 * 1024), "1.5 MB");
  assert.strictEqual(L.TK_dlFormatSize(20 * 1024 * 1024), "20 MB");
  assert.strictEqual(L.TK_dlFormatSize(null), "");
});

// ---- quick add defaults
t("quickAddDefaults: currentClientId when the detail has none", () => {
  assert.deepStrictEqual(L.TK_quickAddDefaults({}, { me: "Me@Example.test", currentClientId: "C1" }), {
    client_id: "C1", project_id: null, section: null, kind: "task", visibility: "shared", text: "", due_date: null,
    assignee_email: "me@example.test",
  });
});
t("quickAddDefaults: detail client wins, explicit null clears", () => {
  assert.strictEqual(L.TK_quickAddDefaults({ client_id: "C2" }, { currentClientId: "C1" }).client_id, "C2");
  assert.strictEqual(L.TK_quickAddDefaults({ client_id: null }, { currentClientId: "C1" }).client_id, null);
});
t("quickAddDefaults: project does not pick up the open client", () => {
  const d = L.TK_quickAddDefaults({ project_id: "P1", section: "Week 1" }, { currentClientId: "C1" });
  assert.strictEqual(d.client_id, null);
  assert.strictEqual(d.project_id, "P1");
  assert.strictEqual(d.section, "Week 1");
  assert.strictEqual(d.visibility, "shared");
});
t("quickAddDefaults: no container is private; reminder kind; text and due", () => {
  const d = L.TK_quickAddDefaults({ kind: "reminder", text: "Call", due_date: "2026-10-12" }, {});
  assert.strictEqual(d.visibility, "private");
  assert.strictEqual(d.kind, "reminder");
  assert.strictEqual(d.text, "Call");
  assert.strictEqual(d.due_date, "2026-10-12");
  assert.strictEqual(L.TK_quickAddDefaults({ kind: "note", due_date: "soon" }, null).kind, "task");
  assert.strictEqual(L.TK_quickAddDefaults({ due_date: "soon" }, null).due_date, null);
  assert.strictEqual(L.TK_quickAddDefaults(null, null).assignee_email, null);
});

// ---- opening a task
t("openTarget: drawer only when schema ok and a host is mounted", () => {
  assert.strictEqual(L.TK_dlOpenTarget({ schema: "ok", hostReady: true }), "drawer");
  assert.strictEqual(L.TK_dlOpenTarget({ schema: "missing", hostReady: true }), "legacy");
  assert.strictEqual(L.TK_dlOpenTarget({ schema: "unknown", hostReady: true }), "legacy");
  assert.strictEqual(L.TK_dlOpenTarget({ schema: "ok", hostReady: false }), "legacy");
  assert.strictEqual(L.TK_dlOpenTarget(null), "legacy");
});
function fakeEvent(extra) {
  const e = Object.assign({ button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false }, extra);
  e.prevented = 0;
  e.preventDefault = () => { e.prevented++; };
  return e;
}
t("openTaskClick: plain left click opens and prevents default", () => {
  const opened = [];
  const h = L.TK_dlClickHandler("T1", (id) => opened.push(id));
  const e = fakeEvent();
  h(e);
  assert.deepStrictEqual(opened, ["T1"]);
  assert.strictEqual(e.prevented, 1);
});
t("openTaskClick: modifier, middle and handled clicks are left to the browser", () => {
  const opened = [];
  const h = L.TK_dlClickHandler("T1", (id) => opened.push(id));
  [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { button: 2 }, { defaultPrevented: true }].forEach((x) => {
    const e = fakeEvent(x);
    h(e);
    assert.strictEqual(e.prevented, 0, JSON.stringify(x));
  });
  assert.deepStrictEqual(opened, []);
  assert.strictEqual(L.TK_dlIsPlainClick(null), false);
});

// ---- display helpers
t("initials and names", () => {
  assert.strictEqual(L.TK_dlInitials("Pat Lee", "x@example.test"), "PL");
  assert.strictEqual(L.TK_dlInitials("Sam", ""), "S");
  assert.strictEqual(L.TK_dlInitials("", "jo@example.test"), "J");
  assert.strictEqual(L.TK_dlInitials("", ""), "?");
  assert.strictEqual(L.TK_dlNameOf("system", []), "System");
  assert.strictEqual(L.TK_dlNameOf("SAM@example.test", staff), "Sam Rivera");
  assert.strictEqual(L.TK_dlNameOf("who@example.test", staff), "who");
  assert.strictEqual(L.TK_dlNameOf(null, staff), "");
  assert.strictEqual(L.TK_dlHandle("Pat.Lee@Example.test"), "pat.lee");
});
t("followerStack", () => {
  assert.deepStrictEqual(L.TK_dlFollowerStack([1, 2, 3, 4, 5, 6, 7]), { shown: [1, 2, 3, 4, 5], extra: 2 });
  assert.deepStrictEqual(L.TK_dlFollowerStack([1, 2]), { shown: [1, 2], extra: 0 });
  assert.deepStrictEqual(L.TK_dlFollowerStack(null), { shown: [], extra: 0 });
});
t("relTime", () => {
  const now = new Date(2026, 9, 11, 15, 0, 0).getTime(); // Sun Oct 11 2026, 3pm local
  const iso = (d) => d.toISOString();
  assert.strictEqual(L.TK_dlRelTime(iso(new Date(now - 20 * 1000)), now), "Just now");
  assert.strictEqual(L.TK_dlRelTime(iso(new Date(now - 5 * 60 * 1000)), now), "5 min ago");
  assert.strictEqual(L.TK_dlRelTime(iso(new Date(2026, 9, 11, 12, 0)), now), "3 hr ago");
  assert.strictEqual(L.TK_dlRelTime(iso(new Date(2026, 9, 10, 23, 0)), now), "Yesterday");
  assert.strictEqual(L.TK_dlRelTime(iso(new Date(2026, 9, 7, 10, 0)), now), "Wed");
  assert.strictEqual(L.TK_dlRelTime(iso(new Date(2026, 8, 3, 10, 0)), now), "Sep 3");
  assert.strictEqual(L.TK_dlRelTime(iso(new Date(2025, 8, 3, 10, 0)), now), "Sep 3, 2025");
  assert.strictEqual(L.TK_dlRelTime("nope", now), "");
});
t("dueAt, timeOf and local inputs round-trip", () => {
  const at = L.TK_dlDueAt("2026-10-14", "09:30");
  assert.strictEqual(L.TK_dlTimeOf(at), "09:30");
  assert.strictEqual(L.TK_dlDueAt("2026-10-14", ""), "2026-10-14T00:00:00.000Z");
  assert.strictEqual(L.TK_dlTimeOf("2026-10-14T00:00:00.000Z"), "");
  assert.strictEqual(L.TK_dlDueAt("", "09:30"), null);
  const iso = L.TK_dlFromLocalInput("2026-10-14T08:05");
  assert.strictEqual(L.TK_dlToLocalInput(iso), "2026-10-14T08:05");
  assert.strictEqual(L.TK_dlFromLocalInput(""), null);
  assert.strictEqual(L.TK_dlToLocalInput(null), "");
  assert.strictEqual(L.TK_dlTimeOf(null), "");
});
t("shortDate", () => {
  assert.strictEqual(L.TK_dlShortDate("2026-10-04", "2026-10-11"), "Oct 4");
  assert.strictEqual(L.TK_dlShortDate("2027-10-04", "2026-10-11"), "Oct 4, 2027");
  assert.strictEqual(L.TK_dlShortDate("bad", "2026-10-11"), "");
});
t("sectionOptions", () => {
  assert.deepStrictEqual(L.TK_dlSectionOptions(["Week 1", "Week 2"], ["week 1", "Later", "Admin"], ["Monthly"]), ["Week 1", "Week 2", "Admin", "Later"]);
  assert.deepStrictEqual(L.TK_dlSectionOptions(null, ["Zed", ""], ["Monthly", "Payroll"]), ["Monthly", "Payroll", "Zed"]);
  assert.deepStrictEqual(L.TK_dlSectionOptions([], null, null), []);
});

// ---- TK_dlFieldGrid (T3)
const gridTask = { id: "t1", assignee_email: "bk@example.test", staff_email: "bk@example.test", due_date: "2026-10-20", client_id: "c1", project_id: null, priority: "high", status: "in_progress" };
const pick = (rows, key) => rows.filter((r) => r.key === key)[0];
t("fieldGrid: the six fields, in order, always listed", () => {
  const rows = L.TK_dlFieldGrid(gridTask, { readOnly: false, canAssign: true });
  assert.deepStrictEqual(rows.map((r) => r.label), ["Assignee", "Due", "Client", "Project", "Priority", "Status"]);
  assert.deepStrictEqual(L.TK_dlFieldGrid(null, {}).map((r) => r.key), ["assignee", "due", "client", "project", "priority", "status"]);
});
t("fieldGrid: empty values are flagged with their placeholder", () => {
  const rows = L.TK_dlFieldGrid({ id: "t2", assignee_email: "  ", due_date: null, client_id: null, project_id: null }, { canAssign: true });
  assert.deepStrictEqual(rows.filter((r) => r.empty).map((r) => r.placeholder), ["Unassigned", "No due date", "No client", "No project"]);
  const full = L.TK_dlFieldGrid(Object.assign({}, gridTask, { project_id: "p1" }), { canAssign: true });
  assert.deepStrictEqual(full.filter((r) => r.empty), []);
  assert.strictEqual(pick(full, "priority").placeholder, "");
});
t("fieldGrid: an editor changes everything but Client and Project", () => {
  const rows = L.TK_dlFieldGrid(gridTask, { readOnly: false, canAssign: true });
  assert.deepStrictEqual(rows.filter((r) => r.editable).map((r) => r.key), ["assignee", "due", "priority", "status"]);
  assert.ok(rows.every((r) => r.hint === ""));
});
t("fieldGrid: view-only (or deleted, or offline) locks every field, no reassign hint", () => {
  const rows = L.TK_dlFieldGrid(gridTask, { readOnly: true, canAssign: false });
  assert.deepStrictEqual(rows.filter((r) => r.editable), []);
  assert.strictEqual(pick(rows, "assignee").hint, "");
});
t("fieldGrid: an editor who isn't the owner or an admin can't reassign", () => {
  const rows = L.TK_dlFieldGrid(gridTask, { readOnly: false, canAssign: false });
  assert.strictEqual(pick(rows, "assignee").editable, false);
  assert.strictEqual(pick(rows, "assignee").hint, "notOwner");
  assert.strictEqual(pick(rows, "due").editable, true);
});
t("fieldGrid: in review locks only the assignee", () => {
  const rows = L.TK_dlFieldGrid(gridTask, { readOnly: false, canAssign: true, status: "ready_for_review" });
  assert.strictEqual(pick(rows, "assignee").editable, false);
  assert.strictEqual(pick(rows, "assignee").hint, "inReview");
  assert.deepStrictEqual(rows.filter((r) => r.editable).map((r) => r.key), ["due", "priority", "status"]);
  // The task's own status counts when ctx doesn't pass one.
  assert.strictEqual(pick(L.TK_dlFieldGrid(Object.assign({}, gridTask, { status: "ready_for_review" }), { canAssign: true }), "assignee").hint, "inReview");
});
t("fieldGrid: a private task (no client, no project) still lists both, empty", () => {
  const rows = L.TK_dlFieldGrid(Object.assign({}, gridTask, { client_id: null, visibility: "private" }), { canAssign: true });
  assert.strictEqual(pick(rows, "client").empty, true);
  assert.strictEqual(pick(rows, "project").empty, true);
});

console.log(n + " checks passed");
