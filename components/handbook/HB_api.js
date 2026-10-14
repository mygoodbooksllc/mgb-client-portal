// Staff Handbook: data access (spec docs/staff-handbook-spec.md, Part E).
//
// Everything is enforced in the database (supabase/staff-handbook.sql): who
// signs (hb_is_signer: active bookkeepers), who countersigns (the setting),
// the name match, the acknowledgment text, the immutable versions and the
// one-time countersign / PDF columns. The UI only mirrors those rules.
//
//   HB_api.status()                         hb_status(): tab, badge and Today
//   HB_api.policy(slug, versionNo?)         hb_get_policy()
//   HB_api.sign(versionId, typedName, ack)  hb_sign()
//   HB_api.countersign(sigId, name, ack)    hb_countersign()
//   HB_api.setCountersigner(email)          hb_set_countersigner() (admins)
//   HB_downloadPdf(signatureId, filename)   team-reviews download_handbook_pdf
//
// HB_useStatus() is one shared hb_status() request for the tab, the Team tab
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
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ""));
  if (!m) return "";
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
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

// Team tab badge: my unsigned policies, plus signatures I countersign.
function HB_badgeCount(st) {
  return (st && Number(st.badge)) || 0;
}

// Plain items for Today (TD_useHandbookItems). Each: { key, kind, slug,
// title, detail, overdue, due }. kind: "sign" | "countersign".
function HB_todayItems(st) {
  if (!st) return [];
  const out = [];
  (st.policies || []).forEach((p) => {
    const my = p.my;
    if (!my || (my.state !== "not_signed" && my.state !== "overdue")) return;
    const v = my.required_version_no || p.required_version_no || p.latest_version_no;
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
  (st.to_countersign || []).forEach((q) => {
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

// Open a policy (and, from a link, its sign or countersign panel).
function HB_policyHash(slug, versionNo) {
  return "#/team/handbook/" + encodeURIComponent(slug) + (versionNo ? "/v" + versionNo : "");
}
function HB_goPolicy(slug, versionNo) {
  const next = slug ? HB_policyHash(slug, versionNo) : "#/team/handbook";
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
