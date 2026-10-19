// Staff Handbook: pure rules shared by the UI (HB_api.js, HB_HandbookTab.jsx,
// HB_PolicyView.jsx, HB_Admin.jsx, TeamPage.jsx badge, Today.jsx) and the node
// test (HB_logic.test.js). No React, no DOM, no Supabase.
//
// Policy kinds (spec docs/staff-handbook-spec.md, Part K;
// supabase/staff-handbook-3-kinds.sql):
//   signed     bookkeepers sign it (sign panel, Today, badge, grid, emails)
//   reference  read-only, versioned; nobody signs it
// Status: draft (admins only, quiet) or published.
// New policies are always reference drafts. Nobody is asked to sign until an
// admin uses "Make this a signed policy" (hb_convert_to_signed); the server
// refuses hb_create_policy with kind 'signed'.
// The server already leaves reference policies and drafts out of the badge,
// Today, the grid and the countersign queue. These filters are a second lock
// so an older server answer can never put them there.
//
// Draft approval (Part L; supabase/staff-handbook-4-approvals.sql): every
// draft needs the policy approver (Bailley by default) to approve its exact
// latest text before it can be published. approval_status on a draft:
//   pending            waiting for the approver (new, or edited since)
//   approved           approved; approval_current says it's the latest text
//   changes_requested  sent back with a note; editing makes it pending again
// The approver sees one Today row "N handbook policies need your approval"
// and the count in the Team tab badge, next to anything they sign.

var HB_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,80}$/;
var HB_GENERAL_SECTION = "General";

// "Remote Work & Travel (2026)" -> "remote-work-and-travel-2026". "" when the
// title has fewer than two usable characters.
function HB_slugify(title) {
  var s = String(title || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (s.length > 81) s = s.slice(0, 81).replace(/-+$/g, "");
  return HB_SLUG_RE.test(s) ? s : "";
}

// Problem with a link name, or "" when it's fine. `taken`: slugs in use.
function HB_slugProblem(slug, taken) {
  var s = String(slug || "");
  if (!s) return "Add a link name.";
  if (!HB_SLUG_RE.test(s)) return "Use 2 to 81 lower-case letters, numbers or hyphens, starting with a letter or number.";
  if ((taken || []).indexOf(s) >= 0) return "Another policy already uses this link name.";
  return "";
}

// hb_create_policy arguments from the New policy form. The kind is always
// "reference", whatever the caller passes.
var HB_NEW_POLICY_KIND = "reference";
function HB_newPolicyArgs(f) {
  f = f || {};
  return {
    p_title: String(f.title || "").trim(),
    p_slug: String(f.slug || ""),
    p_kind: HB_NEW_POLICY_KIND,
    p_section: String(f.section || "").trim() || null,
    p_body_md: String(f.body || ""),
  };
}

// Policies from before kinds existed have no kind / status: signed, published.
function HB_kindOf(p) {
  return p && p.kind === "reference" ? "reference" : "signed";
}
function HB_isDraft(p) {
  return !!(p && p.status === "draft");
}
// Signing policies: signed and published. Only these reach the sign panel,
// Today, the badge, the grid and emails.
function HB_isSigning(p) {
  return !!p && HB_kindOf(p) === "signed" && !HB_isDraft(p);
}

// The list, grouped: "Policies to sign" (signed, published), then one group
// per section (reference, published; A to Z, "General" for no section last),
// then "Drafts" (admins only; the server sends drafts to admins only). Order
// inside a group is the server order (sort, title).
function HB_groupPolicies(policies) {
  var sign = [];
  var drafts = [];
  var bySection = {};
  var names = [];
  (policies || []).forEach(function (p) {
    if (HB_isDraft(p)) drafts.push(p);
    else if (HB_isSigning(p)) sign.push(p);
    else {
      var name = String((p && p.section) || "").trim() || HB_GENERAL_SECTION;
      if (!bySection[name]) {
        bySection[name] = [];
        names.push(name);
      }
      bySection[name].push(p);
    }
  });
  names.sort(function (a, b) {
    if (a === HB_GENERAL_SECTION) return 1;
    if (b === HB_GENERAL_SECTION) return -1;
    return a.localeCompare(b, "en", { sensitivity: "base" });
  });
  var out = [];
  if (sign.length) out.push({ key: "sign", label: "Policies to sign", items: sign });
  names.forEach(function (n) {
    out.push({ key: "section:" + n, label: n, items: bySection[n] });
  });
  if (drafts.length) out.push({ key: "drafts", label: "Drafts", items: drafts });
  return out;
}

// Client-side search: every word must appear in the title, section or link
// name (case and accents ignored). An empty query keeps everything.
function HB_fold(s) {
  return String(s || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}
function HB_searchPolicies(policies, query) {
  var words = HB_fold(query).split(/\s+/).filter(Boolean);
  var list = policies || [];
  if (!words.length) return list.slice();
  return list.filter(function (p) {
    var hay = HB_fold([p.title, p.section, p.slug].join(" "));
    return words.every(function (w) {
      return hay.indexOf(w) >= 0;
    });
  });
}

// Existing sections, A to Z (for the section field's suggestions).
function HB_sections(policies) {
  var seen = {};
  var out = [];
  (policies || []).forEach(function (p) {
    var s = String((p && p.section) || "").trim();
    if (s && !seen[s.toLowerCase()]) {
      seen[s.toLowerCase()] = true;
      out.push(s);
    }
  });
  return out.sort(function (a, b) {
    return a.localeCompare(b, "en", { sensitivity: "base" });
  });
}

// ---------------------------------------------------------------------------
// Dates (America/Chicago, like the server)
// ---------------------------------------------------------------------------
function HB_ymd(ts) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ts));
  } catch (e) {
    return String(ts || "").slice(0, 10);
  }
}
function HB_fmtDate(ts) {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" });
  } catch (e) {
    return String(ts).slice(0, 10);
  }
}
// A YYYY-MM-DD due date (no time) → "Oct 20".
function HB_fmtDay(ymd) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ""));
  if (!m) return "";
  var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ---------------------------------------------------------------------------
// Today and the HR tab badge (hb_status)
// ---------------------------------------------------------------------------
// Plain items for Today (TD_useHandbookItems). Each: { key, kind, slug,
// title, detail, overdue, due }. kind: "sign" | "countersign" | "approve".
// Sign and countersign: signing policies only, never a reference policy or
// a draft. Approve: one row for the policy approver, "N handbook policies
// need your approval", slug "approvals" (opens the approvals panel).
function HB_todayItems(st) {
  if (!st) return [];
  var out = [];
  var signing = {};
  (st.policies || []).forEach(function (p) {
    if (p && p.slug) signing[p.slug] = HB_isSigning(p);
    if (!HB_isSigning(p)) return;
    var my = p.my;
    if (!my || (my.state !== "not_signed" && my.state !== "overdue")) return;
    var v = my.required_version_no || p.required_version_no || p.latest_version_no;
    out.push({
      key: "hb-sign-" + p.id,
      kind: "sign",
      slug: p.slug,
      title: "Sign: " + p.title + " v" + p.latest_version_no,
      detail: my.overdue ? "Overdue" : my.due_date ? "Due " + HB_fmtDay(my.due_date) : "",
      overdue: !!my.overdue,
      due: my.due_date || "",
      versionNo: v,
    });
  });
  (st.to_countersign || []).forEach(function (q) {
    // A queue item for a policy the list says isn't a signing policy is
    // dropped. One the list doesn't mention is kept (the countersigner may
    // not see every policy row).
    if (q && signing[q.policy_slug] === false) return;
    out.push({
      key: "hb-cs-" + q.signature_id,
      kind: "countersign",
      slug: q.policy_slug,
      title: "Countersign: " + (q.signer_name || "a bookkeeper") + ", " + q.policy_title + " v" + q.version_no,
      detail: q.signed_at ? "Signed " + HB_fmtDate(q.signed_at) : "",
      overdue: false,
      due: "",
      signatureId: q.signature_id,
    });
  });
  var me = st.me || {};
  var n = me.is_approver ? HB_pendingApprovalCount(st) : 0;
  if (n > 0) {
    out.push({
      key: "hb-approve",
      kind: "approve",
      slug: "approvals",
      title: n === 1 ? "1 handbook policy needs your approval" : n + " handbook policies need your approval",
      detail: "Drafts in Team › Handbook",
      overdue: false,
      due: "",
      count: n,
    });
  }
  return out;
}

// HR tab badge: my unsigned signing policies, plus signatures I
// countersign, plus (the approver) drafts waiting for approval. Today shows
// the drafts as one row; the badge counts each draft, like hb_status.badge.
function HB_badgeCount(st) {
  if (!st) return 0;
  if (Array.isArray(st.policies)) {
    return HB_todayItems(st).reduce(function (sum, it) {
      return sum + (it.kind === "approve" ? it.count : 1);
    }, 0);
  }
  return Number(st.badge) || 0;
}
// The badge's parts, for its label: { sign, approve }.
function HB_badgeParts(st) {
  var parts = { sign: 0, approve: 0 };
  if (!st || !Array.isArray(st.policies)) return parts;
  HB_todayItems(st).forEach(function (it) {
    if (it.kind === "approve") parts.approve += it.count;
    else parts.sign += 1;
  });
  return parts;
}

// ---------------------------------------------------------------------------
// Draft approval
// ---------------------------------------------------------------------------
var HB_APPROVAL_FILTERS = [
  { key: "all", label: "All drafts" },
  { key: "pending", label: "Awaiting approval" },
  { key: "changes", label: "Changes asked" },
  { key: "approved", label: "Approved" },
];

// A draft's approval state: "pending" | "approved" | "changes_requested",
// "" for a published policy, and "unknown" when the server is older than
// part 4 (no approval fields: the UI then shows nothing extra).
function HB_approvalStatus(p) {
  if (!HB_isDraft(p)) return "";
  var s = p && p.approval_status;
  if (s === "pending" || s === "approved" || s === "changes_requested") return s;
  return "unknown";
}
// Approved, and for the text that's there now.
function HB_approvalCurrent(p) {
  return HB_approvalStatus(p) === "approved" && p.approval_current !== false;
}
// Waiting for the approver: pending, or approved for text that has since
// changed (the server resets that to pending; this covers a stale answer).
function HB_awaitingApproval(p) {
  var s = HB_approvalStatus(p);
  return s === "pending" || (s === "approved" && p.approval_current === false);
}
// The approver's first name for labels ("Awaiting Bailley's approval").
function HB_approverFirst(st) {
  var a = st && st.approver;
  var name = String((a && a.name) || "").trim();
  if (name) return name.split(/\s+/)[0];
  var email = String((a && a.email) || (st && st.approver_setting) || "").trim();
  if (email) {
    var local = email.split("@")[0].split(/[._+-]/)[0];
    if (local) return local.charAt(0).toUpperCase() + local.slice(1);
  }
  return "the approver";
}
// Pill [label, tone] for a draft's approval, or null.
function HB_approvalPill(p, st) {
  var s = HB_approvalStatus(p);
  if (!s || s === "unknown") return null;
  var who = HB_approverFirst(st);
  var poss = who === "the approver" ? "the approver's" : who + "'s";
  if (HB_awaitingApproval(p)) return ["Awaiting " + poss + " approval", "warm"];
  if (s === "changes_requested") return ["Changes asked", "bad"];
  return ["Approved", "good"];
}
// Drafts waiting for the approver, in list order.
function HB_pendingApprovals(st) {
  return ((st && st.policies) || []).filter(HB_awaitingApproval);
}
// How many drafts wait: from the list when the server sent one, else the
// server's count.
function HB_pendingApprovalCount(st) {
  if (!st) return 0;
  if (Array.isArray(st.policies) && st.policies.some(function (p) { return HB_approvalStatus(p) !== "" && HB_approvalStatus(p) !== "unknown"; })) {
    return HB_pendingApprovals(st).length;
  }
  return Number(st.approvals_pending) || 0;
}
// Drafts filter for the list ("all" keeps everything).
function HB_filterDrafts(policies, key) {
  var list = policies || [];
  if (!key || key === "all") return list.slice();
  return list.filter(function (p) {
    if (!HB_isDraft(p)) return true;
    if (key === "pending") return HB_awaitingApproval(p);
    if (key === "changes") return HB_approvalStatus(p) === "changes_requested";
    if (key === "approved") return HB_approvalCurrent(p);
    return true;
  });
}

// Admin grid rows: signing policies only.
function HB_gridPolicies(policies) {
  return (policies || []).filter(HB_isSigning);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    HB_SLUG_RE: HB_SLUG_RE,
    HB_GENERAL_SECTION: HB_GENERAL_SECTION,
    HB_slugify: HB_slugify,
    HB_slugProblem: HB_slugProblem,
    HB_NEW_POLICY_KIND: HB_NEW_POLICY_KIND,
    HB_newPolicyArgs: HB_newPolicyArgs,
    HB_kindOf: HB_kindOf,
    HB_isDraft: HB_isDraft,
    HB_isSigning: HB_isSigning,
    HB_groupPolicies: HB_groupPolicies,
    HB_searchPolicies: HB_searchPolicies,
    HB_sections: HB_sections,
    HB_ymd: HB_ymd,
    HB_fmtDate: HB_fmtDate,
    HB_fmtDay: HB_fmtDay,
    HB_todayItems: HB_todayItems,
    HB_badgeCount: HB_badgeCount,
    HB_gridPolicies: HB_gridPolicies,
    HB_APPROVAL_FILTERS: HB_APPROVAL_FILTERS,
    HB_approvalStatus: HB_approvalStatus,
    HB_approvalCurrent: HB_approvalCurrent,
    HB_awaitingApproval: HB_awaitingApproval,
    HB_approverFirst: HB_approverFirst,
    HB_approvalPill: HB_approvalPill,
    HB_pendingApprovals: HB_pendingApprovals,
    HB_pendingApprovalCount: HB_pendingApprovalCount,
    HB_filterDrafts: HB_filterDrafts,
    HB_badgeParts: HB_badgeParts,
  };
}
