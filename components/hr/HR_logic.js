// Employee records (Team › Employee records, admins only): pure rules shared
// by HR_RecordsTab.jsx and the node test (HR_logic.test.js). No React, no DOM,
// no Supabase.
//
// The server (supabase/staff-hr-records.sql) is the real check: hr_save_record
// validates every field, and only real admins can call any hr_* RPC. The
// checks here mirror its messages so the form can point at the field first;
// keep the two in step.
//
// Never pay, government IDs or bank details: the table has no column for them
// and the form has no field for them.

var HR_TYPE_LABELS = { w2_employee: "W-2 employee", contractor: "Contractor" };
var HR_SCHEDULE_LABELS = { full_time: "Full time", part_time: "Part time" };

// Every field the form edits, in form order. kind: text | select | manager |
// date | email | tel | textarea. `max` mirrors the table's length checks.
var HR_FIELDS = [
  { key: "legal_name", label: "Legal name", group: "job", kind: "text", max: 200 },
  { key: "job_title", label: "Job title", group: "job", kind: "text", max: 120 },
  { key: "employment_type", label: "Employment type", group: "job", kind: "select", options: HR_TYPE_LABELS },
  { key: "schedule", label: "Schedule", group: "job", kind: "select", options: HR_SCHEDULE_LABELS },
  { key: "manager_email", label: "Manager", group: "job", kind: "manager" },
  { key: "work_location", label: "Work location", group: "job", kind: "text", max: 200 },
  { key: "hire_date", label: "Hire date", group: "job", kind: "date" },
  { key: "end_date", label: "End date", group: "job", kind: "date" },
  { key: "personal_email", label: "Personal email", group: "contact", kind: "email", max: 254 },
  { key: "personal_phone", label: "Personal phone", group: "contact", kind: "tel", max: 40 },
  { key: "address", label: "Home address", group: "contact", kind: "textarea", max: 500 },
  { key: "emergency_contact_name", label: "Name", group: "emergency", kind: "text", max: 200 },
  { key: "emergency_contact_relationship", label: "Relationship", group: "emergency", kind: "text", max: 80 },
  { key: "emergency_contact_phone", label: "Phone", group: "emergency", kind: "tel", max: 40 },
  { key: "notes", label: "Notes", group: "notes", kind: "textarea", max: 4000 },
];

var HR_GROUPS = [
  { key: "job", label: "Job" },
  { key: "contact", label: "Personal contact" },
  { key: "emergency", label: "Emergency contact" },
  { key: "notes", label: "Notes" },
];

// The fields that count toward "complete" (hr_filled() on the server). End
// date and notes don't: most people have neither.
var HR_COMPLETE_KEYS = [
  "legal_name",
  "job_title",
  "employment_type",
  "schedule",
  "manager_email",
  "hire_date",
  "work_location",
  "personal_email",
  "personal_phone",
  "address",
  "emergency_contact_name",
  "emergency_contact_relationship",
  "emergency_contact_phone",
];

var HR_PHONE_RE = /^[0-9+(). x-]{7,40}$/;
var HR_EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/i;
var HR_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function HR_field(key) {
  for (var i = 0; i < HR_FIELDS.length; i++) if (HR_FIELDS[i].key === key) return HR_FIELDS[i];
  return null;
}

// The label a list or audit line shows for one field ("Emergency contact
// phone", not just "Phone").
function HR_fieldLabel(key) {
  var f = HR_field(key);
  if (!f) return String(key || "");
  return f.group === "emergency" ? "Emergency contact " + f.label.toLowerCase() : f.label;
}

function HR_typeLabel(v) {
  return HR_TYPE_LABELS[v] || "";
}
function HR_scheduleLabel(v) {
  return HR_SCHEDULE_LABELS[v] || "";
}

// { done, total, missing: [labels], none } from the list row's `filled`
// (true / false per key; null when there is no record yet).
function HR_completeness(filled) {
  var total = HR_COMPLETE_KEYS.length;
  if (!filled) {
    return { done: 0, total: total, missing: HR_COMPLETE_KEYS.map(HR_fieldLabel), none: true };
  }
  var missing = [];
  HR_COMPLETE_KEYS.forEach(function (k) {
    if (!filled[k]) missing.push(HR_fieldLabel(k));
  });
  return { done: total - missing.length, total: total, missing: missing, none: false };
}

// A YYYY-MM-DD string that is a real calendar date.
function HR_isDate(s) {
  var m = HR_DATE_RE.exec(String(s || ""));
  if (!m) return false;
  var d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

// "2020-02-03" -> "Feb 3, 2020". "" for anything else.
function HR_fmtDate(ymd) {
  var m = HR_DATE_RE.exec(String(ymd || "").slice(0, 10));
  if (!m || !HR_isDate(m[0])) return "";
  var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// Form state: every field as a string ("" when empty).
function HR_formFromRecord(rec) {
  var out = {};
  HR_FIELDS.forEach(function (f) {
    var v = rec ? rec[f.key] : null;
    out[f.key] = v == null ? "" : String(v).slice(0, f.kind === "date" ? 10 : undefined);
  });
  return out;
}

// Field problems, keyed by field ({} when the form is fine). `email` is the
// person's work email (nobody manages themselves); `today` is YYYY-MM-DD.
function HR_validate(form, email, today) {
  var f = form || {};
  var errs = {};
  var val = function (k) {
    return String(f[k] == null ? "" : f[k]).trim();
  };
  HR_FIELDS.forEach(function (fd) {
    var v = val(fd.key);
    if (v && fd.max && v.length > fd.max) errs[fd.key] = "Keep this under " + fd.max + " characters.";
  });
  if (val("employment_type") && !HR_TYPE_LABELS[val("employment_type")]) errs.employment_type = "Pick W-2 employee or Contractor.";
  if (val("schedule") && !HR_SCHEDULE_LABELS[val("schedule")]) errs.schedule = "Pick Full time or Part time.";
  if (val("manager_email") && email && val("manager_email").toLowerCase() === String(email).toLowerCase()) {
    errs.manager_email = "Someone can't be their own manager.";
  }
  ["hire_date", "end_date"].forEach(function (k) {
    if (val(k) && !HR_isDate(val(k))) errs[k] = "Use a real date.";
  });
  if (!errs.hire_date && val("hire_date")) {
    var max = HR_addDays(today, 366);
    if (val("hire_date") < "1950-01-01" || (max && val("hire_date") > max)) errs.hire_date = "The hire date is out of range.";
  }
  if (!errs.hire_date && !errs.end_date && val("hire_date") && val("end_date") && val("end_date") < val("hire_date")) {
    errs.end_date = "The end date can't be before the hire date.";
  }
  if (val("personal_email") && !errs.personal_email && !HR_EMAIL_RE.test(val("personal_email"))) {
    errs.personal_email = "This doesn't look like an email address.";
  }
  ["personal_phone", "emergency_contact_phone"].forEach(function (k) {
    if (val(k) && !errs[k] && !HR_PHONE_RE.test(val(k))) errs[k] = "Use digits, spaces and + ( ) - . only.";
  });
  return errs;
}

function HR_addDays(ymd, n) {
  if (!HR_isDate(ymd)) return "";
  var m = HR_DATE_RE.exec(ymd);
  var d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + n));
  return d.toISOString().slice(0, 10);
}

// What to send hr_save_record: only the fields that changed, trimmed; "" clears
// a saved value. A new record (rec null) sends only the fields filled in.
function HR_changes(form, rec) {
  var before = HR_formFromRecord(rec);
  var out = {};
  HR_FIELDS.forEach(function (f) {
    var now = String((form && form[f.key]) == null ? "" : form[f.key]).trim();
    if (f.kind === "email" || f.kind === "manager") now = now.toLowerCase();
    if (now !== String(before[f.key]).trim()) out[f.key] = now;
  });
  return out;
}

// The list: search (name, title, manager; every word must match) and a
// show filter: "active" (default), "former" or "all".
function HR_filterRows(rows, query, show) {
  var words = String(query || "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  return (rows || []).filter(function (r) {
    if (show !== "all" && (show === "former" ? r.active : !r.active)) return false;
    if (!words.length) return true;
    var hay = [r.name, r.email, r.job_title, r.manager_name, HR_typeLabel(r.employment_type)].join(" ").toLowerCase();
    return words.every(function (w) {
      return hay.indexOf(w) >= 0;
    });
  });
}

// Counts for the summary line (active staff only).
function HR_summary(rows) {
  var s = { active: 0, former: 0, noRecord: 0, incomplete: 0, complete: 0 };
  (rows || []).forEach(function (r) {
    if (!r.active) {
      s.former++;
      return;
    }
    s.active++;
    if (!r.has_record) s.noRecord++;
    else if (HR_completeness(r.filled).missing.length) s.incomplete++;
    else s.complete++;
  });
  return s;
}

// Manager choices: active staff other than this person, by name. A saved
// manager who is no longer active stays in the list so the form can show it.
function HR_managerOptions(rows, email, current) {
  var me = String(email || "").toLowerCase();
  var cur = String(current || "").toLowerCase();
  return (rows || [])
    .filter(function (r) {
      var e = String(r.email || "").toLowerCase();
      return e !== me && (r.active || (cur && e === cur));
    })
    .map(function (r) {
      return { email: String(r.email).toLowerCase(), name: (r.name || r.email) + (r.active ? "" : " (former)") };
    })
    .sort(function (a, b) {
      return a.name.localeCompare(b.name, "en", { sensitivity: "base" });
    });
}

// Read-only handbook status for one person, from hb_status (admins get the
// grid). Signing policies only (signed and published), like the grid itself:
// [{ slug, title, versionNo, cell }] where cell is the grid entry or null.
function HR_handbookRows(status, email) {
  if (!status || !Array.isArray(status.grid)) return [];
  var me = String(email || "").toLowerCase();
  var at = {};
  status.grid.forEach(function (g) {
    if (g && String(g.staff_email || "").toLowerCase() === me) at[g.policy_slug] = g;
  });
  return (status.policies || [])
    .filter(function (p) {
      return p && p.kind !== "reference" && p.status !== "draft";
    })
    .map(function (p) {
      return { slug: p.slug, title: p.title, versionNo: p.latest_version_no, cell: at[p.slug] || null };
    });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    HR_TYPE_LABELS: HR_TYPE_LABELS,
    HR_SCHEDULE_LABELS: HR_SCHEDULE_LABELS,
    HR_FIELDS: HR_FIELDS,
    HR_GROUPS: HR_GROUPS,
    HR_COMPLETE_KEYS: HR_COMPLETE_KEYS,
    HR_field: HR_field,
    HR_fieldLabel: HR_fieldLabel,
    HR_typeLabel: HR_typeLabel,
    HR_scheduleLabel: HR_scheduleLabel,
    HR_completeness: HR_completeness,
    HR_isDate: HR_isDate,
    HR_fmtDate: HR_fmtDate,
    HR_formFromRecord: HR_formFromRecord,
    HR_validate: HR_validate,
    HR_addDays: HR_addDays,
    HR_changes: HR_changes,
    HR_filterRows: HR_filterRows,
    HR_summary: HR_summary,
    HR_managerOptions: HR_managerOptions,
    HR_handbookRows: HR_handbookRows,
  };
}
