// Client org profile + anniversary gifts: pure logic (no React, no network).
// Mirrors the server rules in supabase/client-org-profile.sql
// (client_org_profile_save, op__next_occurrence) so the form can say what is
// missing before it saves. The server is still the judge: it re-validates
// everything and sets completed_at itself.
// Tested by components/client/OP_logic.test.js (plain node).

// Length caps, the same numbers as the save RPC.
var OP_LIMITS = {
  card_name: 200,
  org_type: 120,
  gift_address: 500,
  receiver_name: 120,
  courier_phone: 40,
  contact_name: 120,
  contact_email: 254,
  contact_phone: 40,
  gtk: 300,
};

var OP_PHONE_RE = /^[0-9+().\-\s x]+$/;
var OP_EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// The five optional "Get to know you" questions. Keys match the server.
var OP_GTK_FIELDS = [
  { key: "favorite_treat", label: "Favorite candy or treat" },
  { key: "coffee_or_tea", label: "Coffee or tea?" },
  { key: "allergies", label: "Any allergies we should know about?" },
  { key: "hobbies", label: "Hobbies or interests" },
  { key: "team_note", label: "What would feel right for your team?" },
];

// Labels used in messages and on the staff card.
var OP_FIELD_LABELS = {
  card_name: "Name for cards and gifts",
  org_type: "Organization type",
  established_date: "Established date",
  gift_address: "Gift mailing address",
  receiver_name: "Who receives deliveries",
  courier_phone: "Phone for couriers",
  contact_name: "Main contact name",
  contact_email: "Main contact email",
  contact_phone: "Main contact phone",
  fiscal_year_end: "Fiscal year end",
};

// Budget the owner set for an anniversary gift.
var OP_BUDGET_MIN = 30;
var OP_BUDGET_MAX = 45;
var OP_DEFAULT_AMOUNT = 40;

function OP_trim(v) {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function OP_pad2(n) {
  return (n < 10 ? "0" : "") + n;
}

// "YYYY-MM-DD" for a local Date.
function OP_isoDate(d) {
  return d.getFullYear() + "-" + OP_pad2(d.getMonth() + 1) + "-" + OP_pad2(d.getDate());
}

function OP_isLeap(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function OP_daysIn(y, m) {
  return [31, OP_isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

// Parse a strict "YYYY-MM-DD" into {y, m, d}, or null when it is not a real date.
function OP_parseIso(s) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(OP_trim(s));
  if (!m) return null;
  var y = +m[1];
  var mo = +m[2];
  var d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > OP_daysIn(y, mo)) return null;
  return { y: y, m: mo, d: d };
}

// Fiscal year end "MM-DD", checked as a real day in a leap year (02-29 ok).
function OP_validFye(s) {
  var m = /^(\d{2})-(\d{2})$/.exec(OP_trim(s));
  if (!m) return false;
  var mo = +m[1];
  var d = +m[2];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= OP_daysIn(2024, mo);
}

// Is the values object complete by the server's rule?
function OP_isComplete(v) {
  v = v || {};
  var has = function (k) {
    return OP_trim(v[k]) !== "";
  };
  return (
    has("card_name") &&
    has("org_type") &&
    (has("established_date") || !!v.established_unknown) &&
    has("gift_address") &&
    has("receiver_name") &&
    has("courier_phone") &&
    has("contact_name") &&
    (has("contact_email") || has("contact_phone")) &&
    has("fiscal_year_end")
  );
}

// The form's starting values: the saved profile first, then the prefill the
// RPC sends (client name, org type, fiscal year end, the signed-in user).
function OP_initialForm(mine) {
  var p = (mine && mine.profile) || {};
  var pre = (mine && mine.prefill) || {};
  var pick = function (a, b) {
    return OP_trim(a) !== "" ? String(a) : OP_trim(b) !== "" ? String(b) : "";
  };
  var gtk = {};
  OP_GTK_FIELDS.forEach(function (f) {
    gtk[f.key] = "";
  });
  return {
    card_name: pick(p.card_name, pre.name),
    org_type: pick(p.org_type, pick(pre.org_type, pre.entity_type)),
    established_date: p.established_date ? String(p.established_date).slice(0, 10) : "",
    established_unknown: !!p.established_unknown,
    gift_same_as_org: !!p.gift_same_as_org && OP_trim(pre.org_address) !== "",
    gift_address: pick(p.gift_address, ""),
    receiver_name: pick(p.receiver_name, ""),
    courier_phone: pick(p.courier_phone, ""),
    contact_name: pick(p.contact_name, pre.user_name),
    contact_email: pick(p.contact_email, pre.user_email),
    contact_phone: pick(p.contact_phone, ""),
    fiscal_year_end: pick(p.fiscal_year_end, pre.fiscal_year_end),
    gtk: gtk,
  };
}

// Check a form before it is sent. `opts.orgAddress` is the organization
// address (for "Same as organization address"); `opts.today` is "YYYY-MM-DD".
// Returns { errors: {field: message}, missing: [field], complete, payload }.
// Errors block a save; missing fields do not (a partial save is allowed and
// the profile simply stays incomplete).
function OP_checkForm(form, opts) {
  form = form || {};
  opts = opts || {};
  var today = opts.today || OP_isoDate(new Date());
  var orgAddress = OP_trim(opts.orgAddress);
  var errors = {};
  var val = function (k) {
    return OP_trim(form[k]);
  };
  var cap = function (k) {
    if (val(k).length > OP_LIMITS[k]) errors[k] = OP_FIELD_LABELS[k] + " is too long (max " + OP_LIMITS[k] + " characters).";
  };
  ["card_name", "org_type", "receiver_name", "contact_name", "contact_email"].forEach(cap);

  var unknown = !!form.established_unknown;
  var est = unknown ? "" : val("established_date");
  if (est) {
    var p = OP_parseIso(est);
    if (!p) errors.established_date = "Use a real date.";
    else if (est < "1800-01-01" || est > today) errors.established_date = "Pick a date between 1800 and today.";
  }

  var same = !!form.gift_same_as_org;
  var gift = same ? orgAddress : val("gift_address");
  if (same && !orgAddress) errors.gift_address = "We don't have an organization address on file to copy. Type the address instead.";
  else if (gift.length > OP_LIMITS.gift_address) errors.gift_address = OP_FIELD_LABELS.gift_address + " is too long (max 500 characters).";

  ["courier_phone", "contact_phone"].forEach(function (k) {
    var v = val(k);
    if (!v) return;
    if (v.length > OP_LIMITS[k]) errors[k] = OP_FIELD_LABELS[k] + " is too long (max 40 characters).";
    else if (!OP_PHONE_RE.test(v)) errors[k] = "Use only digits, spaces and + ( ) - x.";
  });
  var em = val("contact_email");
  if (em && !errors.contact_email && !OP_EMAIL_RE.test(em)) errors.contact_email = "That doesn't look like an email address.";

  var fye = val("fiscal_year_end");
  if (fye && !OP_validFye(fye)) errors.fiscal_year_end = "Pick a real month and day.";

  var gtkIn = form.gtk || {};
  var gtk = {};
  var anyGtk = false;
  OP_GTK_FIELDS.forEach(function (f) {
    var v = OP_trim(gtkIn[f.key]);
    if (!v) return;
    if (v.length > OP_LIMITS.gtk) errors["gtk." + f.key] = "Keep this under 300 characters.";
    gtk[f.key] = v;
    anyGtk = true;
  });

  var payload = {
    card_name: val("card_name") || null,
    org_type: val("org_type") || null,
    established_date: est || null,
    established_unknown: unknown,
    gift_same_as_org: same,
    gift_address: same ? null : val("gift_address") || null,
    receiver_name: val("receiver_name") || null,
    courier_phone: val("courier_phone") || null,
    contact_name: val("contact_name") || null,
    contact_email: em ? em.toLowerCase() : null,
    contact_phone: val("contact_phone") || null,
    fiscal_year_end: fye || null,
  };
  // Get-to-know answers go only when the person typed one: sending answers
  // replaces the saved set, and leaving the section empty keeps it.
  if (anyGtk) payload.get_to_know = gtk;

  var values = Object.assign({}, payload, { gift_address: gift });
  var missing = [];
  if (!values.card_name) missing.push("card_name");
  if (!values.org_type) missing.push("org_type");
  if (!values.established_date && !unknown) missing.push("established_date");
  if (!gift) missing.push("gift_address");
  if (!values.receiver_name) missing.push("receiver_name");
  if (!values.courier_phone) missing.push("courier_phone");
  if (!values.contact_name) missing.push("contact_name");
  if (!values.contact_email && !values.contact_phone) missing.push("contact_email");
  if (!values.fiscal_year_end) missing.push("fiscal_year_end");

  return {
    errors: errors,
    missing: missing,
    complete: Object.keys(errors).length === 0 && OP_isComplete(values),
    payload: payload,
  };
}

// The next anniversary of `baseIso` on or after `fromIso`, the server's way:
// base + n years, where Feb 29 lands on Feb 28 in a non-leap year.
// Returns { date: "YYYY-MM-DD", years } or null (no date, or not yet a year).
function OP_addYears(p, n) {
  var y = p.y + n;
  var d = Math.min(p.d, OP_daysIn(y, p.m));
  return { y: y, m: p.m, d: d };
}
function OP_cmp(a, b) {
  return a.y - b.y || a.m - b.m || a.d - b.d;
}
function OP_fmtIso(p) {
  return p.y + "-" + OP_pad2(p.m) + "-" + OP_pad2(p.d);
}
function OP_nextAnniversary(baseIso, fromIso) {
  var b = OP_parseIso(String(baseIso || "").slice(0, 10));
  var f = OP_parseIso(String(fromIso || "").slice(0, 10));
  if (!b || !f) return null;
  var n = f.y - b.y;
  var d = OP_addYears(b, n);
  if (OP_cmp(d, f) < 0) {
    n += 1;
    d = OP_addYears(b, n);
  }
  if (n < 1) return null;
  return { date: OP_fmtIso(d), years: n };
}

// Whole days from a to b (both "YYYY-MM-DD"), b later is positive.
function OP_daysBetween(aIso, bIso) {
  var a = OP_parseIso(aIso);
  var b = OP_parseIso(bIso);
  if (!a || !b) return null;
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86400000);
}

// A note when a gift amount is outside the $30-45 budget, or null.
function OP_budgetWarning(amount) {
  if (amount === null || amount === undefined || String(amount).trim() === "") return null;
  var n = Number(amount);
  if (!isFinite(n)) return "Enter an amount in dollars.";
  if (n < 0 || n > 500) return "The amount must be between $0 and $500.";
  if (n < OP_BUDGET_MIN) return "Under the usual $30-45 gift budget.";
  if (n > OP_BUDGET_MAX) return "Over the usual $30-45 gift budget.";
  return null;
}

var OP_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// "YYYY-MM-DD" (or a timestamp) -> "Mar 4, 2027". Empty for bad input.
function OP_fmtDate(iso) {
  var p = OP_parseIso(String(iso || "").slice(0, 10));
  if (!p) return "";
  return OP_MONTHS[p.m - 1].slice(0, 3) + " " + p.d + ", " + p.y;
}

// "MM-DD" -> "June 30". Empty for bad input.
function OP_fmtMonthDay(mmdd) {
  if (!OP_validFye(mmdd)) return "";
  var m = OP_trim(mmdd).split("-");
  return OP_MONTHS[+m[0] - 1] + " " + +m[1];
}

// "1 year" / "5 years".
function OP_yearsLabel(n) {
  return n + " " + (n === 1 ? "year" : "years");
}

function OP_occasionLabel(occ) {
  return occ === "established" ? "Founded" : "Client since";
}

// The weekly digest's line, computed from the anniversary rows the Client
// gifts tab already has (same wording as weekly-admin-digest's
// orgAnniversaries.ts). Counts distinct clients.
function OP_digestLine(rows) {
  var ids = {};
  (rows || []).forEach(function (r) {
    if (r && r.client_id) ids[r.client_id] = 1;
  });
  var n = Object.keys(ids).length;
  return "Anniversaries coming up: " + n + " " + (n === 1 ? "client" : "clients");
}

// Status pill for an anniversary row.
function OP_giftStatus(row) {
  var s = row && row.gift_status;
  if (s === "sent") return { key: "sent", label: "Sent" };
  if (s === "skipped") return { key: "skipped", label: "Skipped" };
  if (s === "planned") return { key: "planned", label: "Planned" };
  return { key: "none", label: "Not planned" };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    OP_LIMITS: OP_LIMITS,
    OP_PHONE_RE: OP_PHONE_RE,
    OP_EMAIL_RE: OP_EMAIL_RE,
    OP_GTK_FIELDS: OP_GTK_FIELDS,
    OP_FIELD_LABELS: OP_FIELD_LABELS,
    OP_BUDGET_MIN: OP_BUDGET_MIN,
    OP_BUDGET_MAX: OP_BUDGET_MAX,
    OP_DEFAULT_AMOUNT: OP_DEFAULT_AMOUNT,
    OP_trim: OP_trim,
    OP_isoDate: OP_isoDate,
    OP_parseIso: OP_parseIso,
    OP_validFye: OP_validFye,
    OP_isComplete: OP_isComplete,
    OP_initialForm: OP_initialForm,
    OP_checkForm: OP_checkForm,
    OP_nextAnniversary: OP_nextAnniversary,
    OP_daysBetween: OP_daysBetween,
    OP_budgetWarning: OP_budgetWarning,
    OP_fmtDate: OP_fmtDate,
    OP_fmtMonthDay: OP_fmtMonthDay,
    OP_yearsLabel: OP_yearsLabel,
    OP_occasionLabel: OP_occasionLabel,
    OP_digestLine: OP_digestLine,
    OP_giftStatus: OP_giftStatus,
  };
}
