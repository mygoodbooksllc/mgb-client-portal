// ----------------------------------------------------------------------------
// MB_logic: pure helpers for the Members area tab (components/members/).
// No React, no network. Browser file (plain JS); loads before MB_MembersTab.jsx.
// Node tests: components/members/MB_logic.test.js.
// ----------------------------------------------------------------------------

var MB_ACCESS_ORDER = ["client", "course", "kit"];

// "client" -> "Client", "course" -> "Course", "kit" -> "Launch Kit".
function MB_accessLabel(a) {
  if (a === "client") return "Client";
  if (a === "course") return "Course";
  if (a === "kit") return "Launch Kit";
  return a ? String(a) : "";
}

// Access chips in a steady order (Client, Course, Launch Kit), then anything else.
function MB_accessList(row) {
  var list = row && Array.isArray(row.access) ? row.access.slice() : [];
  return list.sort(function (a, b) {
    var ia = MB_ACCESS_ORDER.indexOf(a);
    var ib = MB_ACCESS_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
}

// Matches email, name or church (case-insensitive, any part). Blank matches all.
function MB_matchesQuery(row, query) {
  var q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  var hay = [row && row.email, row && row.display_name, row && row.church_name]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return q.split(/\s+/).every(function (part) {
    return hay.indexOf(part) !== -1;
  });
}

// opts: { query, access: "all" | "client" | "course" | "kit", showTests, needsSupport }
// Test rows are hidden unless showTests is true. "Needs support" keeps rows whose
// support_status is not "none" or that have open requests (always empty for now).
function MB_filterRows(rows, opts) {
  var o = opts || {};
  var access = o.access && o.access !== "all" ? o.access : "";
  return (Array.isArray(rows) ? rows : []).filter(function (r) {
    if (!r) return false;
    if (r.is_test && o.showTests !== true) return false;
    if (access && (!Array.isArray(r.access) || r.access.indexOf(access) === -1)) return false;
    if (o.needsSupport && !MB_needsSupport(r)) return false;
    return MB_matchesQuery(r, o.query);
  });
}

function MB_needsSupport(row) {
  if (!row) return false;
  var open = Number(row.open_requests) || 0;
  var st = row.support_status;
  return open > 0 || (!!st && st !== "none");
}

// Rows counted for the header line (tests only when shown).
function MB_countRows(rows, showTests) {
  return MB_filterRows(rows, { showTests: showTests === true }).length;
}

// "Never", "Today", "Yesterday", "3 days ago", "2 weeks ago", "5 months ago", "2 years ago".
function MB_relativeTime(iso, now) {
  if (!iso) return "Never";
  var t = new Date(iso).getTime();
  if (isNaN(t)) return "Never";
  var ref = now == null ? Date.now() : now instanceof Date ? now.getTime() : Number(now);
  var days = Math.floor((ref - t) / 86400000);
  if (days < 0) days = 0;
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 14) return days + " days ago";
  if (days < 60) return Math.floor(days / 7) + " weeks ago";
  if (days < 730) return Math.floor(days / 30) + " months ago";
  return Math.floor(days / 365) + " years ago";
}

// Cents to "$158" (whole dollars) or "$158.50".
function MB_money(cents) {
  var n = Number(cents);
  if (!isFinite(n)) n = 0;
  var neg = n < 0;
  n = Math.abs(Math.round(n));
  var dollars = Math.floor(n / 100);
  var rest = n % 100;
  var d = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (neg ? "-" : "") + "$" + d + (rest ? "." + (rest < 10 ? "0" : "") + rest : "");
}

// "No purchases", "1 purchase, $79", "2 purchases, $158", plus ", 1 refund".
function MB_purchasesSummary(count, paidCents, refunds) {
  var c = Number(count) || 0;
  var r = Number(refunds) || 0;
  if (!c) return "No purchases";
  var s = c + (c === 1 ? " purchase" : " purchases") + ", " + MB_money(paidCents);
  if (r > 0) s += ", " + r + (r === 1 ? " refund" : " refunds");
  return s;
}

// "2026-10-01..." -> "Oct 1, 2026". Blank for no date.
function MB_fmtDate(iso) {
  if (!iso) return "";
  var d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  var m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return m[d.getUTCMonth()] + " " + d.getUTCDate() + ", " + d.getUTCFullYear();
}

// The reason sent to open_member (3 to 500 characters). choice: "signin" |
// "purchase" | "other". Returns "" while it is not valid yet.
function MB_reasonText(choice, note) {
  var n = String(note || "").trim();
  var text = "";
  if (choice === "signin") text = "Sign-in help";
  else if (choice === "purchase") text = "Purchase question";
  else if (choice === "other") text = n ? "Other: " + n : "";
  if (text.length < 3) return "";
  return text.slice(0, 500);
}

function MB_supportLabel(status) {
  if (!status || status === "none") return "None";
  return String(status).charAt(0).toUpperCase() + String(status).slice(1);
}

// Plain message for an RPC error.
function MB_errText(err) {
  var m = (err && (err.message || err.error_description || err.msg)) || String(err || "");
  var clean = String(m).replace(/^ERROR:\s*/i, "");
  if (/42501|not allowed|permission denied/i.test(clean) || (err && err.code === "42501")) return "You don't have access to this right now. Ask the owner.";
  if (/22023|reason/i.test(clean) || (err && err.code === "22023")) return "Add a short reason (at least 3 characters).";
  return clean || "Something went wrong. Try again.";
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    MB_accessLabel: MB_accessLabel,
    MB_accessList: MB_accessList,
    MB_matchesQuery: MB_matchesQuery,
    MB_filterRows: MB_filterRows,
    MB_needsSupport: MB_needsSupport,
    MB_countRows: MB_countRows,
    MB_relativeTime: MB_relativeTime,
    MB_money: MB_money,
    MB_purchasesSummary: MB_purchasesSummary,
    MB_fmtDate: MB_fmtDate,
    MB_reasonText: MB_reasonText,
    MB_supportLabel: MB_supportLabel,
    MB_errText: MB_errText,
  };
}
