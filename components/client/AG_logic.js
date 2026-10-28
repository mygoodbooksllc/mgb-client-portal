// Client agreements: pure logic (no React, no network). docs/agreements-spec.md.
// Mirrors the server rules in supabase/client-agreements.sql so the form can
// say what's wrong before it saves. The server is still the judge (checks,
// RLS, the guard trigger, and client_agreements_mine never returning
// staff_note).
// Tested by components/client/AG_logic.test.js (plain node).

var AG_TYPES = [
  { key: "service_agreement", label: "Service agreement" },
  { key: "engagement_letter", label: "Engagement letter" },
  { key: "addendum", label: "Addendum" },
  { key: "nda", label: "NDA" },
  { key: "pricing_change", label: "Pricing change" },
  { key: "other", label: "Other" },
];

// tone = the .pill color class (good / warm / bad / neutral).
var AG_STATUSES = [
  { key: "draft", label: "Draft", tone: "neutral" },
  { key: "sent", label: "Sent", tone: "warm" },
  { key: "signed", label: "Signed", tone: "good" },
  { key: "expired", label: "Expired", tone: "bad" },
  { key: "terminated", label: "Terminated", tone: "neutral" },
];

var AG_SOON_DAYS = 60;
var AG_LIMITS = { title: 200, url: 2000, note: 4000 };
var AG_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function AG__find(list, key) {
  for (var i = 0; i < list.length; i++) if (list[i].key === key) return list[i];
  return null;
}
function AG_typeLabel(key) {
  var t = AG__find(AG_TYPES, key);
  return t ? t.label : "Other";
}
function AG_statusLabel(key) {
  var s = AG__find(AG_STATUSES, key);
  return s ? s.label : "Draft";
}
function AG_statusTone(key) {
  var s = AG__find(AG_STATUSES, key);
  return s ? s.tone : "neutral";
}

// https only, no spaces, at most 2000 chars (same as the SQL check).
// Returns the trimmed URL or null.
function AG_safeUrl(u) {
  if (u == null) return null;
  var s = String(u).trim();
  if (!s || s.length > AG_LIMITS.url || /\s/.test(s)) return null;
  if (!/^https:\/\//i.test(s)) return null;
  try {
    var p = new URL(s);
    if (p.protocol !== "https:" || !p.hostname) return null;
    return s;
  } catch (e) {
    return null;
  }
}

function AG_validDate(d) {
  if (!d) return true;
  if (!AG_DATE_RE.test(String(d))) return false;
  var t = Date.parse(String(d) + "T00:00:00Z");
  return !isNaN(t) && new Date(t).toISOString().slice(0, 10) === String(d);
}

// draft: { title, agreement_type, status, signed_on, effective_on, expires_on,
// document_url, client_file_id, staff_note }. Returns a list of messages
// (empty = OK to save).
function AG_validate(draft) {
  var d = draft || {};
  var errs = [];
  var title = String(d.title || "").trim();
  if (!title) errs.push("Add a title.");
  else if (title.length > AG_LIMITS.title) errs.push("Keep the title under " + AG_LIMITS.title + " characters.");
  if (d.agreement_type && !AG__find(AG_TYPES, d.agreement_type)) errs.push("Pick a type.");
  if (d.status && !AG__find(AG_STATUSES, d.status)) errs.push("Pick a status.");
  var url = String(d.document_url || "").trim();
  if (url && !AG_safeUrl(url)) errs.push("The link must start with https:// (a Google Drive link works).");
  ["signed_on", "effective_on", "expires_on"].forEach(function (k) {
    if (!AG_validDate(d[k])) errs.push("Check the " + k.replace("_on", "") + " date.");
  });
  if (d.signed_on && d.expires_on && AG_validDate(d.signed_on) && AG_validDate(d.expires_on) && d.expires_on < d.signed_on) {
    errs.push("The expiry date is before the signed date.");
  }
  if (d.staff_note && String(d.staff_note).trim().length > AG_LIMITS.note) {
    errs.push("Keep the staff note under " + AG_LIMITS.note + " characters.");
  }
  return errs;
}

// Whole days from `today` (YYYY-MM-DD) to `date`; null when either is missing.
function AG_daysUntil(date, today) {
  if (!date || !today || !AG_validDate(date) || !AG_validDate(today)) return null;
  var a = Date.parse(String(today) + "T00:00:00Z");
  var b = Date.parse(String(date) + "T00:00:00Z");
  return Math.round((b - a) / 86400000);
}

// { kind: "soon" | "expired" | null, days, label } for the expiry pill.
// Terminated, trashed and undated agreements get no pill.
function AG_expiryInfo(row, today) {
  var r = row || {};
  if (!r.expires_on || r.status === "terminated" || r.trashed_at) return { kind: null, days: null, label: "" };
  var days = AG_daysUntil(r.expires_on, today);
  if (days == null) return { kind: null, days: null, label: "" };
  if (days < 0) return { kind: "expired", days: days, label: "Expired" };
  if (days <= AG_SOON_DAYS) {
    return { kind: "soon", days: days, label: days === 0 ? "Expires today" : "Expires in " + days + " day" + (days === 1 ? "" : "s") };
  }
  return { kind: null, days: days, label: "" };
}

// The status to show: a signed (or sent) agreement whose expiry date has
// passed reads Expired; the stored status is left alone.
function AG_effectiveStatus(row, today) {
  var r = row || {};
  var s = AG__find(AG_STATUSES, r.status) ? r.status : "draft";
  if ((s === "signed" || s === "sent") && AG_expiryInfo(r, today).kind === "expired") return "expired";
  return s;
}

function AG_clientVisible(row) {
  var r = row || {};
  return !!r.visible_to_client && !r.trashed_at;
}

// Exactly the fields a client may see (the same list client_agreements_mine
// returns). Never staff_note, client_can_sign, creator or trash fields.
function AG_toClientRow(row) {
  var r = row || {};
  return {
    id: r.id,
    title: r.title,
    agreement_type: r.agreement_type,
    status: r.status,
    signed_on: r.signed_on || null,
    effective_on: r.effective_on || null,
    expires_on: r.expires_on || null,
    document_url: r.document_url || null,
    client_file_id: r.client_file_id || null,
  };
}

// "Paste several links": one per line.
//   Title | https://...      Title<TAB>https://...      https://...
// Returns { rows: [{ title, document_url }], bad: [{ line, text, reason }] }.
var AG_BULK_MAX = 100;
function AG_parseBulk(text) {
  var rows = [];
  var bad = [];
  var lines = String(text || "").split(/\r?\n/);
  for (var i = 0; i < lines.length; i++) {
    var raw = lines[i];
    var line = raw.trim();
    if (!line) continue;
    var title = "";
    var url = "";
    var parts = line.indexOf("\t") >= 0 ? line.split("\t") : line.indexOf("|") >= 0 ? line.split("|") : null;
    if (parts) {
      var cells = parts.map(function (p) { return p.trim(); }).filter(Boolean);
      var urlIdx = -1;
      for (var j = cells.length - 1; j >= 0; j--) {
        if (/^https?:\/\//i.test(cells[j])) { urlIdx = j; break; }
      }
      if (urlIdx < 0) {
        bad.push({ line: i + 1, text: line, reason: "No link on this line." });
        continue;
      }
      url = cells[urlIdx];
      title = cells.filter(function (_, k) { return k !== urlIdx; }).join(" ").trim();
    } else {
      url = line;
    }
    if (!AG_safeUrl(url)) {
      bad.push({ line: i + 1, text: line, reason: "The link must start with https://." });
      continue;
    }
    if (!title) title = "Signed agreement";
    if (title.length > AG_LIMITS.title) title = title.slice(0, AG_LIMITS.title);
    if (rows.length >= AG_BULK_MAX) {
      bad.push({ line: i + 1, text: line, reason: "Over " + AG_BULK_MAX + " lines; paste the rest in another batch." });
      continue;
    }
    rows.push({ title: title, document_url: AG_safeUrl(url) });
  }
  return { rows: rows, bad: bad };
}

// Newest first by signed, then effective, then created date (same order as
// client_agreements_mine).
function AG_sort(rows) {
  var key = function (r) {
    return String(r.signed_on || r.effective_on || String(r.created_at || "").slice(0, 10) || "");
  };
  return (rows || []).slice().sort(function (a, b) {
    var c = key(b).localeCompare(key(a));
    if (c) return c;
    return String(b.created_at || "").localeCompare(String(a.created_at || ""));
  });
}

function AG_fmtDate(d) {
  if (!d || !AG_validDate(d)) return "";
  var p = String(d).split("-");
  var m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(p[1]) - 1];
  return m + " " + Number(p[2]) + ", " + p[0];
}

function AG_todayLocal(now) {
  var d = now || new Date();
  var mm = String(d.getMonth() + 1).padStart(2, "0");
  var dd = String(d.getDate()).padStart(2, "0");
  return d.getFullYear() + "-" + mm + "-" + dd;
}

// A blank form, or one filled from a row.
function AG_initialDraft(row) {
  var r = row || {};
  return {
    title: r.title || "",
    agreement_type: r.agreement_type || "service_agreement",
    status: r.status || "draft",
    signed_on: r.signed_on || "",
    effective_on: r.effective_on || "",
    expires_on: r.expires_on || "",
    document_url: r.document_url || "",
    client_file_id: r.client_file_id || "",
    staff_note: r.staff_note || "",
    visible_to_client: !!r.visible_to_client,
  };
}

// The columns to send on insert/update (never client_can_sign, never stamps).
function AG_toPayload(draft) {
  var d = draft || {};
  var note = String(d.staff_note || "").trim();
  return {
    title: String(d.title || "").trim(),
    agreement_type: d.agreement_type || "service_agreement",
    status: d.status || "draft",
    signed_on: d.signed_on || null,
    effective_on: d.effective_on || null,
    expires_on: d.expires_on || null,
    document_url: AG_safeUrl(d.document_url) || null,
    client_file_id: d.client_file_id || null,
    staff_note: note || null,
    visible_to_client: !!d.visible_to_client,
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    AG_TYPES: AG_TYPES,
    AG_STATUSES: AG_STATUSES,
    AG_SOON_DAYS: AG_SOON_DAYS,
    AG_LIMITS: AG_LIMITS,
    AG_BULK_MAX: AG_BULK_MAX,
    AG_typeLabel: AG_typeLabel,
    AG_statusLabel: AG_statusLabel,
    AG_statusTone: AG_statusTone,
    AG_safeUrl: AG_safeUrl,
    AG_validDate: AG_validDate,
    AG_validate: AG_validate,
    AG_daysUntil: AG_daysUntil,
    AG_expiryInfo: AG_expiryInfo,
    AG_effectiveStatus: AG_effectiveStatus,
    AG_clientVisible: AG_clientVisible,
    AG_toClientRow: AG_toClientRow,
    AG_parseBulk: AG_parseBulk,
    AG_sort: AG_sort,
    AG_fmtDate: AG_fmtDate,
    AG_todayLocal: AG_todayLocal,
    AG_initialDraft: AG_initialDraft,
    AG_toPayload: AG_toPayload,
  };
}
