// Plain node, no framework: `node components/handbook/HB_logic.test.js`.
// Guards the handbook rules the UI applies on its own: link names from
// titles, the list groups and search, and that reference policies and drafts
// never reach Today, the badge or the grid. The server enforces the same
// (supabase/staff-handbook-3-kinds.sql); keep the two in step.

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

assert.ok(n >= 60, "need at least 60 checks, got " + n);
console.log("HB_logic: " + n + " checks passed");
