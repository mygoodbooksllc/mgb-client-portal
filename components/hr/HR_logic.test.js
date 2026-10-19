// Plain node, no framework: `node components/hr/HR_logic.test.js`.
// Guards the employee-record rules the form applies before the server does:
// completeness, validation (same messages as hr_save_record), which fields a
// save sends, the list filter, manager choices and the read-only handbook
// rows (signing policies only). Server: supabase/staff-hr-records.sql.

const assert = require("assert");
const L = require("./HR_logic.js");

let n = 0;
function t(name, fn) {
  fn();
}
const eq = (a, b, msg) => {
  assert.deepStrictEqual(a, b, msg);
  n++;
};

t("fields", () => {
  eq(L.HR_FIELDS.length, 15);
  eq(L.HR_COMPLETE_KEYS.length, 13);
  eq(
    L.HR_COMPLETE_KEYS.every((k) => !!L.HR_field(k)),
    true,
  );
  // Nothing about pay, government IDs or bank details.
  eq(
    L.HR_FIELDS.filter((f) => /salary|wage|pay|ssn|social|tax|bank|routing|account/i.test(f.key + " " + f.label)).length,
    0,
  );
  eq(L.HR_fieldLabel("emergency_contact_phone"), "Emergency contact phone");
  eq(L.HR_fieldLabel("job_title"), "Job title");
  eq(L.HR_fieldLabel("nope"), "nope");
  eq(L.HR_typeLabel("w2_employee"), "W-2 employee");
  eq(L.HR_scheduleLabel("part_time"), "Part time");
  eq(L.HR_typeLabel("x"), "");
});

t("completeness", () => {
  const none = L.HR_completeness(null);
  eq(none.none, true);
  eq(none.done, 0);
  eq(none.missing.length, 13);
  const all = {};
  L.HR_COMPLETE_KEYS.forEach((k) => (all[k] = true));
  eq(L.HR_completeness(all), { done: 13, total: 13, missing: [], none: false });
  const some = { ...all, address: false, emergency_contact_phone: false };
  eq(L.HR_completeness(some).missing, ["Home address", "Emergency contact phone"]);
  eq(L.HR_completeness(some).done, 11);
});

t("dates", () => {
  eq(L.HR_isDate("2024-02-29"), true);
  eq(L.HR_isDate("2023-02-29"), false);
  eq(L.HR_isDate("2023-13-01"), false);
  eq(L.HR_isDate("02/03/2020"), false);
  eq(L.HR_fmtDate("2020-02-03"), "Feb 3, 2020");
  eq(L.HR_fmtDate(""), "");
  eq(L.HR_addDays("2026-10-19", 366), "2027-10-20");
  eq(L.HR_addDays("bad", 1), "");
});

t("validate", () => {
  const today = "2026-10-19";
  eq(L.HR_validate(L.HR_formFromRecord(null), "a@x.org", today), {});
  const bad = L.HR_validate(
    {
      employment_type: "salaried",
      schedule: "weekends",
      manager_email: "A@x.org",
      hire_date: "2020-02-30",
      personal_email: "not an email",
      personal_phone: "call me",
      emergency_contact_phone: "555",
      job_title: "x".repeat(121),
    },
    "a@x.org",
    today,
  );
  eq(Object.keys(bad).sort(), [
    "emergency_contact_phone",
    "employment_type",
    "hire_date",
    "job_title",
    "manager_email",
    "personal_email",
    "personal_phone",
    "schedule",
  ]);
  eq(bad.manager_email, "Someone can't be their own manager.");
  eq(L.HR_validate({ hire_date: "2021-01-04", end_date: "2020-01-01" }, "a@x.org", today).end_date, "The end date can't be before the hire date.");
  eq(L.HR_validate({ hire_date: "1949-12-31" }, "a@x.org", today).hire_date, "The hire date is out of range.");
  eq(L.HR_validate({ hire_date: "2028-01-01" }, "a@x.org", today).hire_date, "The hire date is out of range.");
  eq(L.HR_validate({ hire_date: "2027-01-01" }, "a@x.org", today), {});
  eq(L.HR_validate({ personal_phone: "+1 (555) 010-0000 x12" }, "a@x.org", today), {});
  eq(L.HR_validate({ end_date: "2026-10-19" }, "a@x.org", today), {});
});

t("changes", () => {
  const rec = { legal_name: "Sample Legal Name", job_title: "Bookkeeper", hire_date: "2020-02-03", manager_email: "m@x.org" };
  const form = L.HR_formFromRecord(rec);
  eq(form.legal_name, "Sample Legal Name");
  eq(form.notes, "");
  eq(L.HR_changes(form, rec), {});
  eq(L.HR_changes({ ...form, job_title: "  Bookkeeper  " }, rec), {});
  eq(L.HR_changes({ ...form, job_title: "Senior Bookkeeper" }, rec), { job_title: "Senior Bookkeeper" });
  eq(L.HR_changes({ ...form, hire_date: "" }, rec), { hire_date: "" });
  eq(L.HR_changes({ ...form, manager_email: "M@X.org" }, rec), {});
  eq(L.HR_changes({ ...L.HR_formFromRecord(null), job_title: "Bookkeeper", personal_email: "Me@Home.org" }, null), {
    job_title: "Bookkeeper",
    personal_email: "me@home.org",
  });
});

const rows = [
  { email: "a@x.org", name: "Admin One", active: true, has_record: true, job_title: "Owner", filled: Object.fromEntries(L.HR_COMPLETE_KEYS.map((k) => [k, true])) },
  { email: "b@x.org", name: "Bookkeeper Two", active: true, has_record: true, job_title: "Bookkeeper", manager_name: "Admin One", filled: { job_title: true } },
  { email: "c@x.org", name: "New Hire", active: true, has_record: false, filled: null },
  { email: "d@x.org", name: "Former Staff", active: false, has_record: true, job_title: "Bookkeeper", filled: { job_title: true } },
];

t("filterRows", () => {
  eq(L.HR_filterRows(rows, "", "active").map((r) => r.email), ["a@x.org", "b@x.org", "c@x.org"]);
  eq(L.HR_filterRows(rows, "", undefined).length, 3);
  eq(L.HR_filterRows(rows, "", "former").map((r) => r.email), ["d@x.org"]);
  eq(L.HR_filterRows(rows, "", "all").length, 4);
  eq(L.HR_filterRows(rows, "bookkeeper", "all").map((r) => r.email), ["b@x.org", "d@x.org"]);
  eq(L.HR_filterRows(rows, "admin one", "active").map((r) => r.email), ["a@x.org", "b@x.org"]);
  eq(L.HR_filterRows(rows, "bookkeeper two", "active").map((r) => r.email), ["b@x.org"]);
  eq(L.HR_filterRows(null, "x", "all"), []);
});

t("summary", () => {
  eq(L.HR_summary(rows), { active: 3, former: 1, noRecord: 1, incomplete: 1, complete: 1 });
  eq(L.HR_summary([]), { active: 0, former: 0, noRecord: 0, incomplete: 0, complete: 0 });
});

t("managerOptions", () => {
  eq(L.HR_managerOptions(rows, "b@x.org", "").map((o) => o.email), ["a@x.org", "c@x.org"]);
  eq(L.HR_managerOptions(rows, "b@x.org", "d@x.org").map((o) => o.name), ["Admin One", "Former Staff (former)", "New Hire"]);
  eq(L.HR_managerOptions(rows, "A@X.org", "").map((o) => o.email), ["b@x.org", "c@x.org"]);
});

t("handbookRows", () => {
  const st = {
    policies: [
      { slug: "sla", title: "SLA", kind: "signed", status: "published", latest_version_no: 2 },
      { slug: "pto", title: "PTO", kind: "reference", status: "published", latest_version_no: 1 },
      { slug: "new", title: "New", kind: "signed", status: "draft", latest_version_no: 1 },
      { slug: "old", title: "Old", latest_version_no: 1 },
    ],
    grid: [
      { policy_slug: "sla", staff_email: "b@x.org", state: "signed" },
      { policy_slug: "sla", staff_email: "c@x.org", state: "overdue" },
    ],
  };
  const r = L.HR_handbookRows(st, "B@x.org");
  eq(r.map((x) => x.slug), ["sla", "old"]);
  eq(r[0].cell.state, "signed");
  eq(r[0].versionNo, 2);
  eq(r[1].cell, null);
  eq(L.HR_handbookRows({ policies: st.policies }, "b@x.org"), []); // not an admin answer
  eq(L.HR_handbookRows(null, "b@x.org"), []);
});

assert.ok(n >= 55, "need at least 55 checks, got " + n);
console.log("HR_logic: " + n + " checks passed");
