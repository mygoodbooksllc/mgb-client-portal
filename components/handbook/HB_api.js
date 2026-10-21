// Staff Handbook: data access (spec docs/staff-handbook-spec.md, Part E).
//
// Everything is enforced in the database (supabase/staff-handbook.sql,
// staff-handbook-2-admin.sql, staff-handbook-3-kinds.sql,
// staff-handbook-4-approvals.sql, staff-handbook-5-approver-tweaks.sql):
// who approves drafts and who can change that, who
// signs (hb_is_signer: active bookkeepers), who countersigns (the setting),
// the name match, the acknowledgment text, the immutable versions and the
// one-time countersign / PDF columns. The UI only mirrors those rules.
//
//   HB_api.status()                         hb_status(): tab, badge and Today
//   HB_api.policy(slug, versionNo?)         hb_get_policy()
//   HB_api.sign(versionId, typedName, ack)  hb_sign()
//   HB_api.countersign(sigId, name, ack)    hb_countersign()
//   HB_api.setCountersigner(email)          hb_set_countersigner() (admins)
//   HB_api.publish(policyId, body, resign, note)  hb_publish_version() (admins)
//   HB_api.retryExport(sigId)               hb_retry_export() (admins)
//   HB_api.createPolicy({title, slug, section, body})  hb_create_policy() (admins; a reference draft)
//   HB_api.publishPolicy(policyId)          hb_publish_policy() (admins; draft -> published)
//   HB_api.updatePolicy(policyId, title, section, sort)  hb_update_policy() (admins)
//   HB_api.convertToSigned(policyId, note)  hb_convert_to_signed() (admins; reference -> signed)
//   HB_api.approve(policyId, versionId)     hb_approve_policy() (the policy approver; that exact text)
//   HB_api.requestChanges(policyId, note)   hb_request_changes() (the policy approver; emails the last editor)
//   HB_api.setApprover(email)               hb_set_policy_approver() (only the people on approver_changers)
//   HB_api.approverAccess()                 hb_approver_access() (admins: can_change, changers, label)
//   HB_downloadPdf(signatureId, filename)   team-reviews download_handbook_pdf
//
// Pure rules (kinds, grouping, search, slugs, dates, Today items, the badge)
// live in HB_logic.js, which loads first.
//
// HB_useStatus() is one shared hb_status() request for the tab, the HR tab
// badge (TeamPage.jsx) and Today (TD_useHandbookItems). HB_changed() refreshes
// all three after a sign or countersign.
//
// Careful: components/staff/HoursBudget.jsx (hours budgets) also uses the HB_
// prefix (HB_store, HB_load, HB_key, HB_Cell, HB_Bar, HB_fmtH, HB_monthStart,
// HB_useBudgets, HB_OverviewLine) and .hb-track / .hb-text / .hb-tag / .hb-ov-*
// classes. All files share one global scope, so never reuse those names here.

const HB_FN = "team-reviews";
const HB_CHANGED_EVENT = "hb:changed";

const HB_SIGNER_ACK = "I have read and agree to this policy, and I agree to sign it electronically.";
const HB_COUNTERSIGN_ACK = "I countersign this policy on behalf of MyGoodBooks, and I agree to sign it electronically.";

function HB_errText(err) {
  const m = (err && (err.message || err.error_description || err.msg)) || String(err || "");
  return m.replace(/^ERROR:\s*/i, "") || "Something went wrong. Try again.";
}

const HB_api = {
  async rpc(fn, args) {
    const sb = window.mgbSupabase;
    if (!sb) throw new Error("Sign in again.");
    const { data, error } = await sb.rpc(fn, args || {});
    if (error) throw new Error(HB_errText(error));
    return data;
  },
  status() {
    return HB_api.rpc("hb_status");
  },
  policy(slug, versionNo) {
    const args = { p_slug: slug };
    if (versionNo != null) args.p_version_no = versionNo;
    return HB_api.rpc("hb_get_policy", args);
  },
  sign(versionId, typedName, ack) {
    return HB_api.rpc("hb_sign", { p_version_id: versionId, p_typed_name: typedName, p_ack: !!ack });
  },
  countersign(signatureId, typedName, ack) {
    return HB_api.rpc("hb_countersign", { p_signature_id: signatureId, p_typed_name: typedName, p_ack: !!ack });
  },
  setCountersigner(email) {
    return HB_api.rpc("hb_set_countersigner", { p_email: email || null });
  },
  publish(policyId, bodyMd, requiresResign, changeNote) {
    return HB_api.rpc("hb_publish_version", {
      p_policy_id: policyId,
      p_body_md: bodyMd,
      p_requires_resign: !!requiresResign,
      p_change_note: changeNote || null,
    });
  },
  retryExport(signatureId) {
    return HB_api.rpc("hb_retry_export", { p_signature_id: signatureId });
  },
  createPolicy(f) {
    return HB_api.rpc("hb_create_policy", HB_newPolicyArgs(f));
  },
  publishPolicy(policyId) {
    return HB_api.rpc("hb_publish_policy", { p_policy_id: policyId });
  },
  updatePolicy(policyId, title, section, sort) {
    return HB_api.rpc("hb_update_policy", {
      p_policy_id: policyId,
      p_title: title,
      p_section: section || null,
      p_sort: sort == null || sort === "" ? null : Number(sort),
    });
  },
  // The current text becomes a new version that everyone signs.
  convertToSigned(policyId, changeNote) {
    return HB_api.rpc("hb_convert_to_signed", {
      p_policy_id: policyId,
      p_body_md: null,
      p_change_note: changeNote,
      p_confirm: true,
    });
  },
  // Draft approval (staff-handbook-4-approvals.sql). versionId is the
  // version the approver read; if the draft changed since, nothing is approved.
  approve(policyId, versionId) {
    return HB_api.rpc("hb_approve_policy", { p_policy_id: policyId, p_version_id: versionId });
  },
  requestChanges(policyId, note) {
    return HB_api.rpc("hb_request_changes", { p_policy_id: policyId, p_note: note });
  },
  setApprover(email) {
    return HB_api.rpc("hb_set_policy_approver", { p_email: email || null });
  },
  // Can the signed-in admin change the approver, and who can
  // (staff-handbook-5-approver-tweaks.sql). The server enforces it either way.
  approverAccess() {
    return HB_api.rpc("hb_approver_access", {});
  },
  // The team-reviews edge function (PDF download). Same call shape as TR_api.call.
  async call(body, wantBlob) {
    const sb = window.mgbSupabase;
    const cfg = window.SUPABASE_CONFIG || {};
    if (!sb) throw new Error("Sign in again.");
    const { data } = await sb.auth.getSession();
    const token = data && data.session && data.session.access_token;
    if (!token) throw new Error("Sign in again.");
    const res = await fetch(`${cfg.url}/functions/v1/${HB_FN}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, apikey: cfg.anonKey || "", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const type = res.headers.get("content-type") || "";
    if (res.ok && wantBlob && type.indexOf("application/pdf") === 0) return res.blob();
    let json = null;
    try {
      json = await res.json();
    } catch (e) {
      json = null;
    }
    if (!res.ok) throw new Error((json && json.message) || `Handbook service error (HTTP ${res.status}).`);
    return json || {};
  },
};

// Download one signed copy (the signer's own, the countersigner's, or anyone's
// for an admin).
async function HB_downloadPdf(signatureId, filename) {
  const blob = await HB_api.call({ action: "download_handbook_pdf", signature_id: signatureId }, true);
  if (!(blob instanceof Blob)) throw new Error("The signed copy isn't ready yet. Try again in a minute.");
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "Signed policy.pdf";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

// File name for a download: "<Policy> v<n> — <YYYY-MM-DD>.pdf" (the Drive
// copy also carries the signer's name; the server sets that one).
function HB_pdfName(title, versionNo, signedAt) {
  const safe = String(title || "Policy").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  const day = signedAt ? HB_ymd(signedAt) : "";
  return safe + " v" + (versionNo || "") + (day ? " — " + day : "") + ".pdf";
}

// ---------------------------------------------------------------------------
// Shared status store (hb_status). Quiet: an error (schema missing, not
// staff) leaves data null and the badge / Today rows simply don't show.
// ---------------------------------------------------------------------------
const HB_statusStore = { data: null, error: "", at: 0, pending: null, subs: new Set() };

function HB_loadStatus(force) {
  if (!force && HB_statusStore.pending) return HB_statusStore.pending;
  if (!force && HB_statusStore.at && Date.now() - HB_statusStore.at < 60000) return Promise.resolve(HB_statusStore.data);
  HB_statusStore.pending = HB_api
    .status()
    .then((d) => {
      HB_statusStore.data = d || null;
      HB_statusStore.error = "";
      return HB_statusStore.data;
    })
    .catch((e) => {
      HB_statusStore.error = HB_errText(e);
      return null;
    })
    .finally(() => {
      HB_statusStore.at = Date.now();
      HB_statusStore.pending = null;
      HB_statusStore.subs.forEach((f) => f());
    });
  return HB_statusStore.pending;
}

function HB_changed() {
  HB_statusStore.at = 0;
  window.dispatchEvent(new CustomEvent(HB_CHANGED_EVENT));
}

function HB_useStatus() {
  const [, bump] = React.useReducer((x) => x + 1, 0);
  React.useEffect(() => {
    HB_statusStore.subs.add(bump);
    HB_loadStatus(false);
    const onChange = () => HB_loadStatus(true);
    const t = setInterval(() => HB_loadStatus(true), 5 * 60 * 1000);
    window.addEventListener(HB_CHANGED_EVENT, onChange);
    return () => {
      HB_statusStore.subs.delete(bump);
      clearInterval(t);
      window.removeEventListener(HB_CHANGED_EVENT, onChange);
    };
  }, []);
  return {
    data: HB_statusStore.data,
    error: HB_statusStore.error,
    loading: !HB_statusStore.data && !HB_statusStore.error,
    reload: () => HB_loadStatus(true),
  };
}

// HB_badgeCount and HB_todayItems: HB_logic.js.

// Open a policy (and, from a link, its sign or countersign panel).
function HB_policyHash(slug, versionNo) {
  return "#/hr/handbook/" + encodeURIComponent(slug) + (versionNo ? "/v" + versionNo : "");
}
function HB_goPolicy(slug, versionNo) {
  const next = slug ? HB_policyHash(slug, versionNo) : "#/hr/handbook";
  if (window.location.hash !== next) window.location.hash = next;
}

// Fill the policy's placeholders. Before signing: "Date of signing" / "Your
// name". On a signed copy: the signing date and the signer's name.
function HB_fillPlaceholders(md, fill) {
  const f = fill || {};
  return String(md || "")
    .replace(/\{\{\s*effective_date\s*\}\}/g, f.date ? f.date : "*Date of signing*")
    .replace(/\{\{\s*employee_name\s*\}\}/g, f.name ? f.name : "*Your name*");
}
