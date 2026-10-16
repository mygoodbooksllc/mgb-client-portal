// node components/tasks/TK_requestLogic.test.js
const assert = require("assert");
const L = require("./TK_requestLogic.js");
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

const TODAY = "2026-10-16";
function form(extra) {
  return Object.assign({ title: "Bank statement", prompt: "Please upload September.", kind: "document", emails: ["a@example.invalid"], contactIds: [] }, extra || {});
}

// ---- When Ask client is offered
t("a client task in To do, In progress or Waiting can ask", () => {
  ["todo", "in_progress", "waiting_client"].forEach((s) => {
    assert.strictEqual(L.TK_canAskClient({ client_id: "c1", status: s }).ok, true, s);
  });
});
t("no client, done, in review or deleted cannot ask, with a reason", () => {
  assert.match(L.TK_canAskClient({ status: "todo" }).why, /client task/);
  assert.match(L.TK_canAskClient({ client_id: "c1", status: "ready_for_review" }).why, /Take it back/);
  assert.match(L.TK_canAskClient({ client_id: "c1", status: "done" }).why, /Reopen/);
  assert.strictEqual(L.TK_canAskClient({ client_id: "c1", status: "todo", deleted_at: "x" }).ok, false);
  assert.strictEqual(L.TK_canAskClient(null).ok, false);
});

// ---- Form checks (mirror tk_ask_client)
t("a complete form has no errors", () => {
  assert.deepStrictEqual(L.TK_askFormErrors(form(), TODAY), {});
  assert.deepStrictEqual(L.TK_askFormErrors(form({ emails: [], contactIds: ["k1"] }), TODAY), {});
});
t("missing title, prompt, kind and recipients are each named", () => {
  const e = L.TK_askFormErrors({ title: " ", prompt: "", kind: "x", emails: [], contactIds: [] }, TODAY);
  assert.ok(e.title && e.prompt && e.kind && e.recipients);
});
t("too long title or prompt and too many recipients are refused", () => {
  assert.ok(L.TK_askFormErrors(form({ title: "x".repeat(201) }), TODAY).title);
  assert.ok(L.TK_askFormErrors(form({ prompt: "x".repeat(2001) }), TODAY).prompt);
  assert.ok(L.TK_askFormErrors(form({ emails: new Array(21).fill("a@b.c") }), TODAY).recipients);
  assert.ok(!L.TK_askFormErrors(form({ emails: new Array(20).fill("a@b.c") }), TODAY).recipients);
});
t("due date: today is fine, past or over a year out is not", () => {
  assert.ok(!L.TK_askFormErrors(form({ dueDate: TODAY }), TODAY).dueDate);
  assert.ok(L.TK_askFormErrors(form({ dueDate: "2026-10-15" }), TODAY).dueDate);
  assert.ok(!L.TK_askFormErrors(form({ dueDate: "2027-10-17" }), TODAY).dueDate);
  assert.ok(L.TK_askFormErrors(form({ dueDate: "2027-10-18" }), TODAY).dueDate);
});

// ---- Chips and actions
t("chips follow status; an open request past the nudge cap says No reply", () => {
  assert.strictEqual(L.TK_requestChip({ status: "open" }).label, "Waiting");
  assert.strictEqual(L.TK_requestChip({ status: "open", no_reply: true }).label, "No reply");
  assert.strictEqual(L.TK_requestChip({ status: "answered" }).tone, "ok");
  assert.strictEqual(L.TK_requestChip({ status: "accepted" }).label, "Accepted");
  assert.strictEqual(L.TK_requestChip({ status: "cancelled" }).label, "Cancelled");
});
t("open request: send, nudge, cancel, record, pause; no accept", () => {
  const a = L.TK_requestActions({ status: "open", links: { live: 0 } }, { canEdit: true });
  assert.strictEqual(a.send && a.nudge && a.cancel && a.record && a.pause, true);
  assert.strictEqual(a.accept || a.resume || a.revoke || a.askAgain, false);
});
t("paused reminders offer Resume and no Nudge; live links offer Turn off links", () => {
  const a = L.TK_requestActions({ status: "open", nudge_paused: true, links: { live: 2 } }, { canEdit: true });
  assert.strictEqual(a.nudge, false);
  assert.strictEqual(a.pause, false);
  assert.strictEqual(a.resume, true);
  assert.strictEqual(a.revoke, true);
});
t("answered request: accept and ask again only", () => {
  const a = L.TK_requestActions({ status: "answered" }, { canEdit: true });
  assert.deepStrictEqual(Object.keys(a).filter((k) => a[k]).sort(), ["accept", "askAgain"]);
});
t("legacy rows, deleted rows and read-only viewers get no buttons", () => {
  [{ status: "open", legacy: true }, { status: "open", deleted_at: "x" }].forEach((r) => {
    const a = L.TK_requestActions(r, { canEdit: true });
    assert.strictEqual(Object.keys(a).some((k) => a[k]), false);
  });
  const ro = L.TK_requestActions({ status: "open" }, { canEdit: false });
  assert.strictEqual(Object.keys(ro).some((k) => ro[k]), false);
});

// ---- Words
t("waiting label counts business days", () => {
  assert.strictEqual(L.TK_waitingLabel(0), "Asked today");
  assert.strictEqual(L.TK_waitingLabel(1), "Waiting 1 business day");
  assert.strictEqual(L.TK_waitingLabel(4), "Waiting 4 business days");
});
t("send results always say dry run and nothing sent", () => {
  assert.match(L.TK_sendResultText({ mode: "dry_run", recipients: ["a", "b"] }, "send"), /^Dry run: nothing sent\..*2 people/);
  assert.match(L.TK_sendResultText({ mode: "test", recipients: ["me"] }, "nudge"), /^Dry run: nothing sent\. Reminder .*only to you/);
  assert.match(L.TK_sendResultText({ mode: "live", recipients: ["a"] }, "send"), /^Dry run: nothing sent/);
  assert.strictEqual(L.TK_sendResultText({ mode: "dry_run", recipients: ["a"] }, "preview"), "Would go to 1 person.");
});
t("comment author labels for client and link answers", () => {
  assert.strictEqual(L.TK_requestAuthorLabel("client:pat@example.invalid", { "pat@example.invalid": "Pat" }), "Pat (client)");
  assert.strictEqual(L.TK_requestAuthorLabel("client:pat@example.invalid", {}), "pat@example.invalid (client)");
  assert.strictEqual(L.TK_requestAuthorLabel("contact:k1", { k1: "Sam" }), "Sam (by link)");
  assert.strictEqual(L.TK_requestAuthorLabel("contact:k9", {}), "Client contact (by link)");
  assert.strictEqual(L.TK_requestAuthorLabel("staff@example.invalid", {}), null);
});
t("waiting groups: longest wait first, by client and inside a client", () => {
  const g = L.TK_waitingGroups([
    { client_id: "b", client_name: "Beta", request_title: "x", business_days_waiting: 2 },
    { client_id: "a", client_name: "Alpha", request_title: "y", business_days_waiting: 1 },
    { client_id: "b", client_name: "Beta", request_title: "z", business_days_waiting: 6 },
  ]);
  assert.deepStrictEqual(g.map((x) => x.clientId), ["b", "a"]);
  assert.deepStrictEqual(g[0].rows.map((r) => r.request_title), ["z", "x"]);
  assert.strictEqual(g[0].maxDays, 6);
});
t("every server refusal has plain words; unknown falls back", () => {
  ["tk_has_open_requests", "tk_email_off", "tk_no_recipients", "tk_bad_recipient", "tk_legacy_request", "tk_reply_required",
   "tk_not_open", "tk_not_answered", "tk_contact_exists", "tk_bad_contact"].forEach((k) => {
    assert.ok(L.TK_REQUEST_ERROR_COPY[k], k);
    assert.strictEqual(L.TK_requestErrorText({ code: "23505", reason: k }), L.TK_REQUEST_ERROR_COPY[k]);
  });
  assert.match(L.TK_requestErrorText({ code: "zzz" }), /Try again/);
});

console.log("TK_requestLogic: " + n + " tests passed");
