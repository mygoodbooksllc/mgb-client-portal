// Plain node, no framework: `node components/handbook/HB_logic.test.js`.
// Guards the handbook rules the UI applies on its own: link names from
// titles, the list groups and search, and that reference policies and drafts
// never reach Today, the badge or the grid, and the draft approval labels,
// filter, Today row and badge. The server enforces the same
// (supabase/staff-handbook-3-kinds.sql, staff-handbook-4-approvals.sql);
// keep the two in step.

const assert = require("assert");
const L = require("./HB_logic.js");

let n = 0;
function t(name, fn) {
  fn();
}
const eq = (a, b, msg) => {
  assert.deepStrictEqual(a, b, msg);
  n++;
};

const signed = { id: "1", slug: "flexible-work-sla", title: "Flexible Work", kind: "signed", status: "published", section: null, latest_version_no: 2 };
const legacy = { id: "2", slug: "old-one", title: "Old One", latest_version_no: 1 }; // no kind / status
const ref1 = { id: "3", slug: "pto", title: "Paid Time Off", kind: "reference", status: "published", section: "Time off", latest_version_no: 1 };
const ref2 = { id: "4", slug: "dress-code", title: "Dress Code", kind: "reference", status: "published", section: null, latest_version_no: 1 };
const ref3 = { id: "5", slug: "expenses", title: "Expenses", kind: "reference", status: "published", section: "Money", latest_version_no: 3 };
const draftRef = { id: "6", slug: "new-ref", title: "New Reference", kind: "reference", status: "draft", section: "Money", latest_version_no: 1 };
const draftSigned = { id: "7", slug: "new-signed", title: "New Signed", kind: "signed", status: "draft", section: null, latest_version_no: 1 };

t("slugify", () => {
  eq(L.HB_slugify("Flexible Work, Scheduling & Operational SLA Policy"), "flexible-work-scheduling-and-operational-sla-policy");
  eq(L.HB_slugify("  Remote Work (2026)  "), "remote-work-2026");
  eq(L.HB_slugify("Employee's Handbook"), "employees-handbook");
  eq(L.HB_slugify("Café Policy"), "cafe-policy");
  eq(L.HB_slugify("---Hello---World---"), "hello-world");
  eq(L.HB_slugify("A"), "");
  eq(L.HB_slugify(""), "");
  eq(L.HB_slugify(null), "");
  eq(L.HB_slugify("!!!"), "");
  const long = L.HB_slugify("word ".repeat(40));
  eq(long.length <= 81, true);
  eq(/-$/.test(long), false);
  eq(L.HB_SLUG_RE.test(long), true);
});

t("newPolicyArgs", () => {
  eq(L.HB_NEW_POLICY_KIND, "reference");
  eq(L.HB_newPolicyArgs({ title: " PTO ", slug: "pto", section: "", body: "Text" }), {
    p_title: "PTO",
    p_slug: "pto",
    p_kind: "reference",
    p_section: null,
    p_body_md: "Text",
  });
  // A caller can't ask for a signed policy here; that takes the convert step.
  eq(L.HB_newPolicyArgs({ title: "X", slug: "x1", kind: "signed", body: "b" }).p_kind, "reference");
  eq(L.HB_newPolicyArgs({ title: "X", slug: "x1", section: " Time off ", body: "b" }).p_section, "Time off");
  eq(L.HB_newPolicyArgs(null).p_kind, "reference");
});

t("slugProblem", () => {
  eq(L.HB_slugProblem("pto", []), "");
  eq(L.HB_slugProblem("", []), "Add a link name.");
  eq(L.HB_slugProblem("Bad Slug", []) !== "", true);
  eq(L.HB_slugProblem("-x", []) !== "", true);
  eq(L.HB_slugProblem("x", []) !== "", true);
  eq(L.HB_slugProblem("pto", ["pto"]), "Another policy already uses this link name.");
});

t("kinds", () => {
  eq(L.HB_kindOf(legacy), "signed");
  eq(L.HB_kindOf(ref1), "reference");
  eq(L.HB_isSigning(signed), true);
  eq(L.HB_isSigning(legacy), true);
  eq(L.HB_isSigning(ref1), false);
  eq(L.HB_isSigning(draftSigned), false);
  eq(L.HB_isSigning(null), false);
  eq(L.HB_isDraft(draftRef), true);
  eq(L.HB_isDraft(signed), false);
});

t("groupPolicies", () => {
  const g = L.HB_groupPolicies([signed, ref1, ref2, draftRef, ref3, legacy, draftSigned]);
  eq(g.map((x) => x.label), ["Policies to sign", "Money", "Time off", "General", "Drafts"]);
  eq(g[0].items.map((p) => p.slug), ["flexible-work-sla", "old-one"]);
  eq(g[1].items.map((p) => p.slug), ["expenses"]);
  eq(g[3].items.map((p) => p.slug), ["dress-code"]);
  eq(g[4].items.map((p) => p.slug), ["new-ref", "new-signed"]);
  eq(L.HB_groupPolicies([]), []);
  eq(L.HB_groupPolicies([ref2]).map((x) => x.label), ["General"]);
  eq(L.HB_groupPolicies([{ ...ref1, section: "  " }]).map((x) => x.label), ["General"]);
});

t("searchPolicies", () => {
  const all = [signed, ref1, ref2, ref3];
  eq(L.HB_searchPolicies(all, "").length, 4);
  eq(L.HB_searchPolicies(all, "  ").length, 4);
  eq(L.HB_searchPolicies(all, "TIME").map((p) => p.slug), ["pto"]);
  eq(L.HB_searchPolicies(all, "paid off").map((p) => p.slug), ["pto"]);
  eq(L.HB_searchPolicies(all, "money").map((p) => p.slug), ["expenses"]);
  eq(L.HB_searchPolicies(all, "dress-code").map((p) => p.slug), ["dress-code"]);
  eq(L.HB_searchPolicies(all, "nothing here"), []);
  eq(L.HB_searchPolicies([{ ...ref1, title: "Café rules" }], "cafe").length, 1);
});

t("sections", () => {
  eq(L.HB_sections([ref1, ref2, ref3, draftRef, { ...ref1, section: "money" }]), ["Money", "Time off"]);
});

const st = {
  policies: [
    { ...signed, my: { state: "not_signed", due_date: "2026-10-26", overdue: false } },
    { ...ref1, my: { state: "not_signed", due_date: "2026-10-26" } }, // never on Today
    { ...draftSigned, my: { state: "overdue", overdue: true } }, // never on Today
    { ...legacy, my: { state: "signed" } },
  ],
  to_countersign: [
    { signature_id: "s1", policy_slug: "flexible-work-sla", policy_title: "Flexible Work", version_no: 2, signer_name: "A" },
    { signature_id: "s2", policy_slug: "pto", policy_title: "Paid Time Off", version_no: 1 }, // reference: dropped
    { signature_id: "s3", policy_slug: "unknown", policy_title: "Elsewhere", version_no: 1 },
  ],
  badge: 99,
};

t("todayItems", () => {
  const items = L.HB_todayItems(st);
  eq(items.map((i) => i.key), ["hb-sign-1", "hb-cs-s1", "hb-cs-s3"]);
  eq(items[0].kind, "sign");
  eq(items[0].title, "Sign: Flexible Work v2");
  eq(items[0].detail.indexOf("Due "), 0);
  eq(L.HB_todayItems(null), []);
  eq(L.HB_todayItems({ policies: [{ ...ref1, my: { state: "overdue", overdue: true } }] }), []);
});

t("badgeCount", () => {
  eq(L.HB_badgeCount(st), 3);
  eq(L.HB_badgeCount(null), 0);
  eq(L.HB_badgeCount({ badge: 2 }), 2);
  eq(L.HB_badgeCount({ policies: [{ ...ref1, my: { state: "not_signed" } }], to_countersign: [] }), 0);
});

t("gridPolicies", () => {
  eq(L.HB_gridPolicies([signed, ref1, draftSigned, legacy]).map((p) => p.slug), ["flexible-work-sla", "old-one"]);
});

t("fmtDay", () => {
  eq(L.HB_fmtDay("2026-10-26"), "Oct 26");
  eq(L.HB_fmtDay("nope"), "");
});

// Draft approval (Part L, staff-handbook-4-approvals.sql).
const dPend = { ...draftRef, id: "d1", slug: "d-pend", approval_status: "pending" };
const dAppr = { ...draftRef, id: "d2", slug: "d-appr", approval_status: "approved", approval_current: true };
const dStale = { ...draftRef, id: "d3", slug: "d-stale", approval_status: "approved", approval_current: false };
const dChg = { ...draftRef, id: "d4", slug: "d-chg", approval_status: "changes_requested", approval_note: "Fix it" };
const apSt = (me, extra) => ({
  me: { is_approver: true, ...me },
  approver: { email: "bailley@mygoodbooks.org", name: "Bailley Gray" },
  policies: [signed, dPend, dAppr, dStale, dChg],
  to_countersign: [],
  approvals_pending: 2,
  ...extra,
});

t("approvalStatus", () => {
  eq(L.HB_approvalStatus(dPend), "pending");
  eq(L.HB_approvalStatus(dChg), "changes_requested");
  eq(L.HB_approvalStatus(signed), "");
  eq(L.HB_approvalStatus(draftRef), "unknown"); // older server: nothing extra shown
  eq(L.HB_approvalCurrent(dAppr), true);
  eq(L.HB_approvalCurrent(dStale), false);
  eq(L.HB_awaitingApproval(dPend), true);
  eq(L.HB_awaitingApproval(dStale), true);
  eq(L.HB_awaitingApproval(dAppr), false);
  eq(L.HB_awaitingApproval(dChg), false);
  eq(L.HB_awaitingApproval(signed), false);
});

t("approvalPill", () => {
  const st = apSt();
  eq(L.HB_approverFirst(st), "Bailley");
  eq(L.HB_approverFirst({ approver_setting: "bailley@mygoodbooks.org" }), "Bailley");
  eq(L.HB_approverFirst(null), "the approver");
  eq(L.HB_approverFirst({ approver: null, approver_setting: "bailley.approver@example.org" }), "Bailley");
  eq(L.HB_approvalPill(dPend, st), ["Awaiting Bailley's approval", "warm"]);
  eq(L.HB_approvalPill(dStale, st), ["Awaiting Bailley's approval", "warm"]);
  eq(L.HB_approvalPill(dAppr, st), ["Approved", "good"]);
  eq(L.HB_approvalPill(dChg, st), ["Changes asked", "bad"]);
  eq(L.HB_approvalPill(signed, st), null);
  eq(L.HB_approvalPill(draftRef, st), null);
  eq(L.HB_approvalPill(dPend, {}), ["Awaiting the approver's approval", "warm"]);
});

t("pendingApprovals", () => {
  eq(L.HB_pendingApprovals(apSt()).map((p) => p.slug), ["d-pend", "d-stale"]);
  eq(L.HB_pendingApprovalCount(apSt()), 2);
  // No draft rows (older shape): the server count.
  eq(L.HB_pendingApprovalCount({ policies: [signed], approvals_pending: 4 }), 4);
  eq(L.HB_pendingApprovalCount(null), 0);
});

t("filterDrafts", () => {
  const all = [signed, dPend, dAppr, dStale, dChg];
  eq(L.HB_filterDrafts(all, "all").length, 5);
  eq(L.HB_filterDrafts(all, "pending").map((p) => p.slug), ["flexible-work-sla", "d-pend", "d-stale"]);
  eq(L.HB_filterDrafts(all, "changes").map((p) => p.slug), ["flexible-work-sla", "d-chg"]);
  eq(L.HB_filterDrafts(all, "approved").map((p) => p.slug), ["flexible-work-sla", "d-appr"]);
  eq(L.HB_APPROVAL_FILTERS.map((f) => f.key), ["all", "pending", "changes", "approved"]);
});

t("approval on Today and the badge", () => {
  const items = L.HB_todayItems(apSt());
  const ap = items.filter((i) => i.kind === "approve");
  eq(ap.length, 1);
  eq(ap[0].title, "2 handbook policies need your approval");
  eq(ap[0].slug, "approvals");
  eq(ap[0].count, 2);
  eq(L.HB_todayItems(apSt({}, { policies: [dPend] })).find((i) => i.kind === "approve").title, "1 handbook policy needs your approval");
  // Not the approver (another admin): no row, no badge.
  eq(L.HB_todayItems(apSt({ is_approver: false })).filter((i) => i.kind === "approve"), []);
  eq(L.HB_badgeCount(apSt({ is_approver: false })), 0);
  // Approver: badge counts each draft; with a policy to sign it adds up.
  eq(L.HB_badgeCount(apSt()), 2);
  const both = apSt({}, { policies: [{ ...signed, my: { state: "not_signed", due_date: "2026-10-26" } }, dPend, dStale] });
  eq(L.HB_badgeCount(both), 3);
  eq(L.HB_badgeParts(both), { sign: 1, approve: 2 });
  // Nothing waiting: no row.
  eq(L.HB_todayItems(apSt({}, { policies: [signed, dAppr, dChg], approvals_pending: 0 })).filter((i) => i.kind === "approve"), []);
  // The approval row never names a draft.
  eq(/New Reference/.test(JSON.stringify(ap)), false);
});

assert.ok(n >= 60, "need at least 60 checks, got " + n);
console.log("HB_logic: " + n + " checks passed");
