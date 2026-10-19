// Employee records: Supabase calls (supabase/staff-hr-records.sql). Admins
// only; the RPCs refuse everyone else, including temporary admins.
//
//   HR_api.list()                hr_list_records()  list columns + which fields are filled
//   HR_api.get(email)            hr_get_record()    the full record (audited: hr.record_viewed)
//   HR_api.save(email, changes)  hr_save_record()   changed fields only; "" clears one
//                                                   (audited: hr.record_saved, field names only)
//
// Nothing here is cached outside the tab: the list and an open record live
// in HR_RecordsTab's state and are gone when the tab closes.

function HR_errText(err) {
  const m = (err && (err.message || err.error_description || err.msg)) || String(err || "");
  const clean = m.replace(/^ERROR:\s*/i, "");
  if (/admins only|permission denied|42501/i.test(clean)) return "Only admins can open employee records.";
  return clean || "Something went wrong. Try again.";
}

const HR_api = {
  async rpc(fn, args) {
    const sb = window.mgbSupabase;
    if (!sb) throw new Error("Sign in again.");
    const { data, error } = await sb.rpc(fn, args || {});
    if (error) throw new Error(HR_errText(error));
    return data;
  },
  list() {
    return HR_api.rpc("hr_list_records");
  },
  get(email) {
    return HR_api.rpc("hr_get_record", { p_email: email });
  },
  save(email, changes) {
    return HR_api.rpc("hr_save_record", { p_email: email, p_record: changes || {} });
  },
};

// Today in America/Chicago (YYYY-MM-DD), the server's calendar.
function HR_today() {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch (e) {
    return new Date().toISOString().slice(0, 10);
  }
}
