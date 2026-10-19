// Employee records (Team › Employee records). Real admins only: the tab is
// hidden from bookkeepers, temporary admins and "View as" (StaffNav.jsx
// realAdmin), TeamPage.jsx renders it only for a real admin, and every
// hr_* RPC refuses anyone else (supabase/staff-hr-records.sql).
//
//   HR_RecordsTab({ staffUser })   TeamPage.jsx TP_TeamHub body
//
// The list (hr_list_records) shows each person's job basics and how complete
// their record is, never personal details. Opening a record (hr_get_record)
// is logged in the Audit log; Edit saves only the fields that changed
// (hr_save_record, logged with the field names). The handbook card is
// read-only: the admin grid from hb_status (HB_useStatus), signing policies
// only.
//
// Rules live in HR_logic.js (loads first); calls in HR_api.js. Styles:
// hr.css (.hr-*). The open record is component state, not the hash, so no
// one's email ends up in a link or the browser history.

function HR_useToastSafe() {
  return typeof useToast === "function" ? useToast() : (m) => window.alert(m);
}

function HR_Pill({ tone, children }) {
  return <span className={"pill " + (tone || "neutral")}>{children}</span>;
}

function HR_Error({ text }) {
  if (!text) return null;
  return (
    <p className="al-error hr-error" role="alert">
      {text}
    </p>
  );
}

// "Complete", "9 of 13" or "No record yet".
function HR_CompletePill({ row }) {
  if (!row.has_record) return <HR_Pill tone="warm">No record yet</HR_Pill>;
  const c = HR_completeness(row.filled);
  if (!c.missing.length) return <HR_Pill tone="good">Complete</HR_Pill>;
  return (
    <span title={"Missing: " + c.missing.join(", ")}>
      <HR_Pill tone="neutral">
        {c.done} of {c.total}
      </HR_Pill>
    </span>
  );
}

function HR_RecordsTab({ staffUser }) {
  const [rows, setRows] = React.useState(null);
  const [error, setError] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [show, setShow] = React.useState("active");
  const [open, setOpen] = React.useState("");

  const load = React.useCallback(async () => {
    setError("");
    try {
      const r = await HR_api.list();
      setRows(Array.isArray(r) ? r : []);
    } catch (e) {
      setError(HR_errText(e));
      setRows((x) => x || []);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  if (open) {
    return (
      <HR_RecordView
        email={open}
        rows={rows || []}
        onBack={() => {
          setOpen("");
          load();
        }}
      />
    );
  }

  const list = HR_filterRows(rows || [], query, show);
  const sum = HR_summary(rows || []);

  return (
    <div className="hr-tab">
      <section className="card" aria-labelledby="hr-list-title">
        <h3 className="card-title" id="hr-list-title">
          Employee records
        </h3>
        <p className="hr-muted">
          Admins only. Job details, personal contact details and an emergency contact for each staff member. Opening a record is logged in the
          Audit log. Pay, Social Security numbers and bank details don't go here.
        </p>
        {rows && rows.length > 0 && (
          <p className="hr-summary">
            {sum.active} active · {sum.complete} complete · {sum.incomplete} missing details · {sum.noRecord} with no record yet
          </p>
        )}
        <div className="hr-tools">
          <label className="hr-sr" htmlFor="hr-search">
            Search staff
          </label>
          <input
            id="hr-search"
            type="search"
            className="hr-inp"
            value={query}
            placeholder="Search by name, title or manager"
            autoComplete="off"
            onChange={(e) => setQuery(e.target.value)}
          />
          <label className="hr-sr" htmlFor="hr-show">
            Show
          </label>
          <select id="hr-show" className="hr-inp hr-sel" value={show} onChange={(e) => setShow(e.target.value)}>
            <option value="active">Active staff</option>
            <option value="former">Former staff</option>
            <option value="all">Everyone</option>
          </select>
        </div>
        <HR_Error text={error} />
        {!rows ? (
          <p className="hr-muted">Loading…</p>
        ) : !list.length ? (
          <p className="hr-muted">{rows.length ? "Nobody matches." : "No staff yet."}</p>
        ) : (
          <ul className="hr-list">
            {list.map((r) => (
              <li key={r.email} className="hr-row">
                <button type="button" className="hr-row-btn" onClick={() => setOpen(r.email)}>
                  <span className="hr-row-main">
                    <strong>{r.name || r.email}</strong>
                    <span className="hr-muted">
                      {[r.job_title, HR_typeLabel(r.employment_type), HR_scheduleLabel(r.schedule)].filter(Boolean).join(" · ") ||
                        (r.role === "admin" ? "Admin" : "Bookkeeper")}
                    </span>
                    {(r.manager_name || r.hire_date || r.end_date) && (
                      <span className="hr-muted">
                        {[
                          r.manager_name ? "Manager: " + r.manager_name : "",
                          r.hire_date ? "Hired " + HR_fmtDate(r.hire_date) : "",
                          r.end_date ? "Ended " + HR_fmtDate(r.end_date) : "",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    )}
                  </span>
                  <span className="hr-row-side">
                    {!r.active && <HR_Pill tone="neutral">Former</HR_Pill>}
                    <HR_CompletePill row={r} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// One record: read view, Edit, and the read-only handbook status. Loading it
// is the audited read (hr.record_viewed), so it happens once per open.
function HR_RecordView({ email, rows, onBack }) {
  const [data, setData] = React.useState(null);
  const [error, setError] = React.useState("");
  const [editing, setEditing] = React.useState(false);

  React.useEffect(() => {
    let live = true;
    setData(null);
    setError("");
    HR_api
      .get(email)
      .then((d) => {
        if (live) setData(d);
      })
      .catch((e) => {
        if (live) setError(HR_errText(e));
      });
    return () => {
      live = false;
    };
  }, [email]);

  const staff = (data && data.staff) || {};
  const rec = data ? data.record : null;
  const name = staff.name || (rows.find((r) => r.email === email) || {}).name || email;

  return (
    <div className="hr-view">
      <button type="button" className="link-btn hr-back" onClick={onBack}>
        ← All employee records
      </button>
      <section className="card" aria-labelledby="hr-rec-title">
        <div className="hr-head">
          <div className="hr-head-main">
            <h3 className="hr-title" id="hr-rec-title">
              {name}
            </h3>
            <p className="hr-muted">
              {email}
              {staff.role ? " · " + (staff.role === "admin" ? "Admin" : "Bookkeeper") : ""}
              {data && !staff.active ? " · Former staff" : ""}
            </p>
          </div>
          {data && !editing && (
            <button type="button" className="btn-secondary" onClick={() => setEditing(true)}>
              {rec ? "Edit" : "Start a record"}
            </button>
          )}
        </div>
        <HR_Error text={error} />
        {!data && !error && <p className="hr-muted">Loading…</p>}
        {data && editing && (
          <HR_RecordForm
            email={email}
            rec={rec}
            rows={rows}
            onCancel={() => setEditing(false)}
            onSaved={(r) => {
              setData((d) => ({ ...d, record: r }));
              setEditing(false);
            }}
          />
        )}
        {data && !editing && !rec && <p className="hr-muted hr-empty">No record yet. Start one to add job and contact details.</p>}
        {data && !editing && rec && <HR_RecordDetails rec={rec} />}
      </section>
      {data && <HR_HandbookCard email={email} staff={staff} />}
    </div>
  );
}

function HR_valueText(f, rec) {
  const v = rec[f.key];
  if (v == null || v === "") return "";
  if (f.key === "employment_type") return HR_typeLabel(v);
  if (f.key === "schedule") return HR_scheduleLabel(v);
  if (f.key === "manager_email") return rec.manager_name || v;
  if (f.kind === "date") return HR_fmtDate(v);
  return String(v);
}

function HR_RecordDetails({ rec }) {
  const c = HR_completeness(rec.filled);
  return (
    <div className="hr-details">
      {c.missing.length > 0 && <p className="hr-muted hr-missing">Missing: {c.missing.join(", ")}.</p>}
      {HR_GROUPS.map((g) => (
        <div key={g.key} className="hr-group">
          <h4 className="hr-group-title">{g.label}</h4>
          <dl className="hr-dl">
            {HR_FIELDS.filter((f) => f.group === g.key).map((f) => {
              const text = HR_valueText(f, rec);
              return (
                <div key={f.key} className={"hr-dl-row" + (f.kind === "textarea" ? " is-long" : "")}>
                  <dt>{f.label}</dt>
                  <dd className={text ? "" : "hr-muted"}>{text || "Not filled in"}</dd>
                </div>
              );
            })}
          </dl>
        </div>
      ))}
      {rec.updated_at && (
        <p className="hr-muted hr-updated">
          Last saved {HR_fmtDate(String(rec.updated_at).slice(0, 10))}
          {rec.updated_by ? " by " + rec.updated_by : ""}.
        </p>
      )}
    </div>
  );
}

function HR_RecordForm({ email, rec, rows, onCancel, onSaved }) {
  const toast = HR_useToastSafe();
  const [form, setForm] = React.useState(() => HR_formFromRecord(rec));
  const [tried, setTried] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const errs = HR_validate(form, email, HR_today());
  const bad = Object.keys(errs);
  const changes = HR_changes(form, rec);
  const dirty = Object.keys(changes).length > 0;
  const managers = HR_managerOptions(rows, email, form.manager_email);

  React.useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const set = (k) => (e) => {
    const v = e.target.value;
    setForm((f) => ({ ...f, [k]: v }));
  };

  const save = async (e) => {
    if (e) e.preventDefault();
    setTried(true);
    setError("");
    if (bad.length || busy) {
      if (bad.length) {
        const el = document.getElementById("hr-f-" + bad[0]);
        if (el) el.focus();
      }
      return;
    }
    if (!dirty) {
      onCancel();
      return;
    }
    setBusy(true);
    try {
      const r = await HR_api.save(email, changes);
      toast(r && r.created ? "Record saved." : "Changes saved.");
      onSaved(r && r.record ? r.record : rec);
    } catch (err) {
      setError(HR_errText(err));
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    if (dirty && !window.confirm("Discard your changes?")) return;
    onCancel();
  };

  const input = (f) => {
    const id = "hr-f-" + f.key;
    const common = {
      id,
      className: "hr-inp",
      value: form[f.key],
      onChange: set(f.key),
      "aria-invalid": tried && errs[f.key] ? "true" : undefined,
      "aria-describedby": tried && errs[f.key] ? id + "-err" : undefined,
    };
    if (f.kind === "select") {
      return (
        <select {...common} className="hr-inp hr-sel">
          <option value="">Not set</option>
          {Object.keys(f.options).map((k) => (
            <option key={k} value={k}>
              {f.options[k]}
            </option>
          ))}
        </select>
      );
    }
    if (f.kind === "manager") {
      return (
        <select {...common} className="hr-inp hr-sel">
          <option value="">No manager</option>
          {managers.map((m) => (
            <option key={m.email} value={m.email}>
              {m.name}
            </option>
          ))}
        </select>
      );
    }
    if (f.kind === "textarea") return <textarea {...common} className="hr-inp hr-text" maxLength={f.max} rows={f.key === "notes" ? 5 : 3} />;
    if (f.kind === "date") return <input {...common} type="date" className="hr-inp hr-date" />;
    return (
      <input
        {...common}
        type={f.kind === "email" ? "email" : f.kind === "tel" ? "tel" : "text"}
        maxLength={f.max}
        autoComplete="off"
        spellCheck={f.kind === "text" ? undefined : "false"}
      />
    );
  };

  return (
    <form className="hr-form" onSubmit={save} noValidate>
      <p className="hr-muted">
        Only admins can see this. Saving logs which fields changed, never what they say. The hire date also sets the start date on their profile
        (work anniversaries).
      </p>
      {HR_GROUPS.map((g) => (
        <fieldset key={g.key} className="hr-fieldset">
          <legend className="hr-group-title">{g.label}</legend>
          <div className="hr-grid">
            {HR_FIELDS.filter((f) => f.group === g.key).map((f) => (
              <div key={f.key} className={"hr-field" + (f.kind === "textarea" ? " is-wide" : "")}>
                <label className="hr-label" htmlFor={"hr-f-" + f.key}>
                  {f.label}
                </label>
                {input(f)}
                {f.key === "end_date" && <span className="hr-muted hr-hint">Offboarding fills this in if it's empty.</span>}
                {tried && errs[f.key] && (
                  <span className="hr-field-error" id={"hr-f-" + f.key + "-err"} role="alert">
                    {errs[f.key]}
                  </span>
                )}
              </div>
            ))}
          </div>
        </fieldset>
      ))}
      <div className="hr-actions">
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "Saving…" : rec ? "Save changes" : "Save record"}
        </button>
        <button type="button" className="btn-secondary" disabled={busy} onClick={cancel}>
          Cancel
        </button>
        {tried && bad.length > 0 && <span className="hr-muted">Fix the fields marked above.</span>}
      </div>
      <HR_Error text={error} />
    </form>
  );
}

// Read-only: where this person stands on each policy they sign. Uses the
// handbook's shared hb_status request (the admin grid), so it costs nothing
// extra when the Handbook tab was opened first.
function HR_HandbookCard({ email, staff }) {
  const can = typeof HB_useStatus === "function";
  const st = can ? HB_useStatus() : null;
  if (!can) return null;
  const isSigner = staff.role === "bookkeeper" && staff.active;
  const rows = HR_handbookRows(st && st.data, email);
  return (
    <section className="card hr-hb" aria-labelledby="hr-hb-title">
      <h3 className="card-title" id="hr-hb-title">
        Handbook signatures
      </h3>
      {!isSigner ? (
        <p className="hr-muted">Only active bookkeepers sign handbook policies.</p>
      ) : st && st.error ? (
        <p className="hr-muted">The handbook status didn't load. Open Team › Handbook to check.</p>
      ) : !st || !st.data ? (
        <p className="hr-muted">Loading…</p>
      ) : !rows.length ? (
        <p className="hr-muted">No policies need signing.</p>
      ) : (
        <ul className="hr-list">
          {rows.map((r) => (
            <li key={r.slug} className="hr-row hr-hb-row">
              <span className="hr-row-main">
                {typeof HB_goPolicy === "function" ? (
                  <button type="button" className="link-btn" onClick={() => HB_goPolicy(r.slug)}>
                    {r.title}
                  </button>
                ) : (
                  <strong>{r.title}</strong>
                )}
                <span className="hr-muted">Version {r.versionNo}</span>
              </span>
              <span className="hr-row-side">{typeof HB_GridCell === "function" ? <HB_GridCell g={r.cell} /> : null}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
