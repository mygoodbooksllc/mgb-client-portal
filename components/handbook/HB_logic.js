// Staff Handbook: pure rules shared by the UI (HB_api.js, HB_HandbookTab.jsx,
// HB_PolicyView.jsx, HB_Admin.jsx, TeamPage.jsx badge, Today.jsx) and the node
// test (HB_logic.test.js). No React, no DOM, no Supabase.
//
// Policy kinds (spec docs/staff-handbook-spec.md, Part K;
// supabase/staff-handbook-3-kinds.sql):
//   signed     bookkeepers sign it (sign panel, Today, badge, grid, emails)
//   reference  read-only, versioned; nobody signs it
// Status: draft (admins only, quiet) or published.
// The server already leaves reference policies and drafts out of the badge,
// Today, the grid and the countersign queue. These filters are a second lock
// so an older server answer can never put them there.

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
// Today and the Team tab badge (hb_status)
// ---------------------------------------------------------------------------
// Plain items for Today (TD_useHandbookItems). Each: { key, kind, slug,
// title, detail, overdue, due }. kind: "sign" | "countersign". Signing
// policies only: never a reference policy or a draft.
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
  return out;
}

// Team tab badge: my unsigned signing policies, plus signatures I
// countersign. Same count as Today's handbook rows.
function HB_badgeCount(st) {
  if (!st) return 0;
  if (Array.isArray(st.policies)) return HB_todayItems(st).length;
  return Number(st.badge) || 0;
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
  };
}
