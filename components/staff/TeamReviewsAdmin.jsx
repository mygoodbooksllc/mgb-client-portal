// Reviews: History (everyone), Team status and Year-end (admins).
// Loaded after TeamReviews.jsx; uses its TR_* helpers. The database checks
// every action again (tr_require_admin / tr_history's own-history rule).

const TR_DRIVE_ROOT = "~ MGB: Staff Reviews";

function TR_useRpc(fn, args, deps) {
  const [state, setState] = React.useState({ data: null, error: "", loading: true });
  const [ver, setVer] = React.useState(0);
  React.useEffect(() => {
    let alive = true;
    setState((s) => Object.assign({}, s, { loading: true }));
    (fn ? TR_api.rpc(fn, args) : Promise.resolve(null))
      .then((d) => alive && setState({ data: d, error: "", loading: false }))
      .catch((e) => alive && setState({ data: null, error: TR_errText(e), loading: false }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps.concat([ver]));
  return Object.assign({}, state, { reload: () => setVer((v) => v + 1) });
}

function TR_fmtStamp(iso) {
  if (!iso) return "";
  return (
    new Date(iso).toLocaleString("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) + " CT"
  );
}

// Average points apart per item (self vs reviewer) for one review.
function TR_itemGap(r) {
  if (!r || !r.self || !r.manager) return null;
  let g = 0;
  TR_ITEMS.forEach((it) => {
    g += Math.abs(r.self[it.key] - r.manager[it.key]);
  });
  return g / TR_ITEMS.length;
}

// ---------------------------------------------------------------------------
// Shared year view: KPIs + total score by quarter
// ---------------------------------------------------------------------------
function TR_YearBars({ h }) {
  const reviews = h.reviews || [];
  const done = reviews.filter((r) => r.self && r.manager);
  const rev = TR_first((done[done.length - 1] || reviews[reviews.length - 1] || {}).reviewer_name) || "Reviewer";
  const avg = done.length ? done.reduce((s, r) => s + r.manager.total, 0) / done.length : null;
  const gaps = done.map(TR_itemGap);
  const gapText =
    gaps.length === 0 ? "—" : gaps.length === 1 ? gaps[0].toFixed(1) : `${gaps[0].toFixed(1)} → ${gaps[gaps.length - 1].toFixed(1)}`;
  const steps = h.steps || { done: 0, total: 0 };
  return (
    <>
      <div className="kpi-grid">
        <TR_Kpi label={`${h.year} average (${rev})`} value={avg != null ? `${avg.toFixed(1)} / ${TR_MAX_TOTAL}` : "—"} />
        <TR_Kpi label={`Self vs. ${rev} gap`} value={gapText} sub="Avg. points apart per item, first → latest" />
        <TR_Kpi label="Action steps completed" value={`${steps.done || 0} of ${steps.total || 0}`} />
      </div>
      <div className="card">
        <div className="tr-card-head">
          <h2 className="card-title" style={{ margin: 0 }}>
            Total score by quarter
          </h2>
          <span style={{ display: "inline-flex", gap: 12 }}>
            <span className="tr-legend">
              <i />
              Self
            </span>
            <span className="tr-legend">
              <i className="mgr" />
              {rev}
            </span>
          </span>
        </div>
        {reviews.length === 0 ? (
          <p className="tr-muted" style={{ margin: 0 }}>
            No reviews in {h.year}.
          </p>
        ) : (
          <div className="tr-bars">
            {reviews.map((r) => (
              <div className="tr-bar-row" key={r.review_id}>
                <span className="tr-num">Q{r.quarter}</span>
                {r.self && r.manager ? (
                  <div className="tr-bar-pair">
                    {[
                      ["Self", r.self.total, ""],
                      [rev, r.manager.total, " mgr"],
                    ].map(([who, v, cls]) => (
                      <div className="tr-bar-line" key={who}>
                        <div className="tr-bar-track" role="img" aria-label={`Q${r.quarter} ${who}: ${v} of ${TR_MAX_TOTAL}`}>
                          <div className={"tr-bar-fill" + cls} style={{ width: (100 * v) / TR_MAX_TOTAL + "%" }} />
                        </div>
                        <span className="tr-num">
                          {v} / {TR_MAX_TOTAL}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <span className="tr-muted">
                    {r.status === "closed_unsigned" ? "Closed unsigned before both reviews were in" : "Scores show once both reviews are in"}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
        <p className="tr-muted" style={{ margin: "12px 0 0" }}>
          Scale is out of {TR_MAX_TOTAL}. A total below 18 requires an action step.
        </p>
      </div>
    </>
  );
}

function TR_SummaryRows({ s }) {
  return (
    <div className="tr-summary">
      <div className="tr-summary-row">
        <span>Strongest</span>
        <span>{s.strongest}</span>
      </div>
      <div className="tr-summary-row">
        <span>Focus area</span>
        <span>{s.focus}</span>
      </div>
      <div className="tr-summary-row">
        <span>Alignment</span>
        <span>{s.alignment}</span>
      </div>
    </div>
  );
}

function TR_StaffYearPicker({ people, staffId, setStaffId, years, year, setYear, idp }) {
  return (
    <div className="tr-toolbar">
      {people && (
        <label className="al-field">
          <span>Team member</span>
          <select id={idp + "-staff"} value={staffId || ""} onChange={(e) => setStaffId(e.target.value)}>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="al-field">
        <span>Year</span>
        <select id={idp + "-year"} value={year || ""} onChange={(e) => setYear(Number(e.target.value))}>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

// ---------------------------------------------------------------------------
// History (everyone: own; admins can pick anyone)
// ---------------------------------------------------------------------------
function TR_HistoryTab({ ov }) {
  const toast = TR_useToastSafe();
  const isAdmin = !!(ov.me && ov.me.is_admin);
  const [staffId, setStaffId] = React.useState(ov.me ? ov.me.id : null);
  const [year, setYear] = React.useState(null);
  const [busy, setBusy] = React.useState("");
  const opts = TR_useRpc(isAdmin ? "tr_admin_options" : null, {}, [isAdmin]);
  const h = TR_useRpc("tr_history", { p_staff: staffId, p_year: year }, [staffId, year]);
  const people = isAdmin && opts.data && opts.data.staff ? opts.data.staff : null;

  if (h.error) return <TR_Error text={h.error} />;
  if (!h.data) return <p className="tr-muted">Loading…</p>;
  const d = h.data;
  const years = (d.years && d.years.length ? d.years : [d.year]).slice().sort((a, b) => b - a);
  const name = d.staff ? d.staff.name : "";
  const mine = ov.me && d.staff && d.staff.id === ov.me.id;

  const pdf = async (r) => {
    setBusy(r.review_id);
    try {
      await TR_downloadPdf({ action: "pdf", review_id: r.review_id }, `${name} - ${r.year} Q${r.quarter} Review.pdf`);
    } catch (e) {
      toast(TR_errText(e));
    } finally {
      setBusy("");
    }
  };
  const yearPdf = async () => {
    setBusy("year");
    try {
      await TR_downloadPdf({ action: "year_pdf", staff_id: d.staff.id, year: d.year }, `${name} - ${d.year} Year-End Summary.pdf`);
    } catch (e) {
      toast(TR_errText(e));
    } finally {
      setBusy("");
    }
  };
  const s = d.summary;
  const confirmed = s && s.status === "confirmed";

  return (
    <div className="tr-tab">
      <TR_StaffYearPicker
        people={people}
        staffId={staffId}
        setStaffId={(v) => {
          setStaffId(v);
          setYear(null);
        }}
        years={years}
        year={d.year}
        setYear={setYear}
        idp="tr-hist"
      />
      {!mine && <h2 className="card-title">{name}</h2>}
      <TR_YearBars h={d} />

      <div className="card">
        <h2 className="card-title">Reviews in {d.year}</h2>
        {(d.reviews || []).length === 0 ? (
          <p className="tr-muted" style={{ margin: 0 }}>
            None yet.
          </p>
        ) : (
          <div className="al-table-wrap">
            <table className="tx-table tx-table-labeled tr-table">
              <thead>
                <tr>
                  <th scope="col">Quarter</th>
                  <th scope="col">Reviewer</th>
                  <th scope="col">Status</th>
                  <th scope="col">Totals</th>
                  <th scope="col">
                    <span className="tr-sr">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {d.reviews.map((r) => (
                  <tr key={r.review_id}>
                    <td data-label="Quarter">
                      <strong>{r.label}</strong>
                    </td>
                    <td data-label="Reviewer">{r.reviewer_name}</td>
                    <td data-label="Status">
                      <TR_ReviewStatusPill status={r.status} />
                    </td>
                    <td data-label="Totals" className="tr-num">
                      {r.self && r.manager ? `Self ${r.self.total} · ${TR_first(r.reviewer_name)} ${r.manager.total}` : "—"}
                    </td>
                    <td className="row-remove-cell">
                      <span style={{ display: "inline-flex", gap: 8, flexWrap: "wrap" }}>
                        <button type="button" className="btn-secondary" onClick={() => TR_goReviews("r/" + r.review_id)} aria-label={"Open " + r.label + " review"}>
                          Open
                        </button>
                        {r.status === "signed" && (
                          <button type="button" className="btn-secondary" disabled={busy === r.review_id} onClick={() => pdf(r)} aria-label={"Download " + r.label + " PDF"}>
                            {busy === r.review_id ? "Preparing…" : "Download PDF"}
                          </button>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="tr-card-head">
          <h2 className="card-title" style={{ margin: 0 }}>
            {d.year} year-end summary
          </h2>
          {confirmed && (
            <button type="button" className="btn-secondary" disabled={busy === "year"} onClick={yearPdf}>
              {busy === "year" ? "Preparing…" : "Download PDF"}
            </button>
          )}
        </div>
        {confirmed ? (
          <>
            <p className="tr-muted" style={{ margin: 0 }}>
              Confirmed by {s.confirmed_by} on {TR_fmtStamp(s.confirmed_at)}
            </p>
            <TR_SummaryRows s={s} />
          </>
        ) : (
          <p className="tr-muted" style={{ margin: 0 }}>
            {isAdmin && s ? "Draft saved. Confirm it on the Year-end tab to share it." : "Shows here once an admin confirms it."}
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Year-end (admin): draft, confirm, PDF, Drive
// ---------------------------------------------------------------------------
function TR_YearEndTab({ ov }) {
  const toast = TR_useToastSafe();
  const opts = TR_useRpc("tr_admin_options", {}, []);
  const [staffId, setStaffId] = React.useState(null);
  const [year, setYear] = React.useState(null);
  const people = (opts.data && opts.data.staff) || [];
  const firstReviewee = people.find((p) => p.role !== "admin") || people[0];
  const sid = staffId || (firstReviewee && firstReviewee.id) || null;
  const h = TR_useRpc("tr_history", { p_staff: sid, p_year: year }, [sid, year]);
  const [form, setForm] = React.useState(null);
  const [dirty, setDirty] = React.useState(false);
  const [busy, setBusy] = React.useState("");
  const [error, setError] = React.useState("");
  const [driveNote, setDriveNote] = React.useState("");

  const d = h.data;
  const key = d ? d.staff && d.staff.id + ":" + d.year : "";
  React.useEffect(() => {
    if (!d) return;
    const s = d.summary;
    const reviewer = ((d.reviews || []).slice(-1)[0] || {}).reviewer_name;
    const draft = s ? { strongest: s.strongest || "", focus: s.focus || "", alignment: s.alignment || "" } : TR_yearSummaryDraft(d.reviews, d.staff && TR_first(d.staff.name), TR_first(reviewer));
    setForm(draft || { strongest: "", focus: "", alignment: "" });
    setDirty(false);
    setError("");
    setDriveNote("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, d && d.summary && d.summary.updated_at]);

  if (opts.error) return <TR_Error text={opts.error} />;
  if (!opts.data || (!d && !h.error)) return <p className="tr-muted">Loading…</p>;
  if (h.error) return <TR_Error text={h.error} />;
  if (!sid) return <p className="tr-muted">No team members yet.</p>;

  const s = d.summary;
  const confirmed = s && s.status === "confirmed" && !dirty;
  const name = d.staff ? d.staff.name : "";
  const years = (d.years && d.years.length ? d.years : [d.year]).slice().sort((a, b) => b - a);
  const hasData = (d.reviews || []).some((r) => r.self && r.manager);
  const f = form || { strongest: "", focus: "", alignment: "" };
  const filled = f.strongest.trim() && f.focus.trim() && f.alignment.trim();

  const set = (k) => (e) => {
    setDirty(true);
    setForm(Object.assign({}, f, { [k]: e.target.value }));
  };
  const save = async (confirm) => {
    setBusy(confirm ? "confirm" : "save");
    setError("");
    try {
      await TR_api.rpc("tr_save_year_summary", {
        p_staff: d.staff.id,
        p_year: d.year,
        p_strongest: f.strongest,
        p_focus: f.focus,
        p_alignment: f.alignment,
        p_confirm: !!confirm,
      });
      toast(confirm ? "Year-end summary confirmed" : "Draft saved");
      setDirty(false);
      h.reload();
    } catch (e) {
      setError(TR_errText(e));
    } finally {
      setBusy("");
    }
  };
  const yearPdf = async () => {
    setBusy("pdf");
    setError("");
    try {
      await TR_downloadPdf({ action: "year_pdf", staff_id: d.staff.id, year: d.year }, `${name} - ${d.year} Year-End Summary.pdf`);
    } catch (e) {
      setError(TR_errText(e));
    } finally {
      setBusy("");
    }
  };
  const exportYear = async () => {
    setBusy("export");
    setError("");
    try {
      const res = await TR_api.call({ action: "year_export", staff_id: d.staff.id, year: d.year });
      if (res && res.ok) {
        toast("Saved to Google Drive");
        h.reload();
      } else if (res && res.error === "waiting_for_drive_setup") setDriveNote("Waiting for Drive setup");
      else setError((res && res.error) || "Couldn’t save to Drive.");
    } catch (e) {
      setError(TR_errText(e));
    } finally {
      setBusy("");
    }
  };

  let statusPill = <TR_Pill tone="neutral">Not saved</TR_Pill>;
  if (dirty) statusPill = <TR_Pill tone="warm">Unsaved changes</TR_Pill>;
  else if (s && s.status === "confirmed") statusPill = <TR_Pill tone="good">Confirmed</TR_Pill>;
  else if (s) statusPill = <TR_Pill tone="warm">Draft</TR_Pill>;

  return (
    <div className="tr-tab">
      <TR_StaffYearPicker
        people={people}
        staffId={sid}
        setStaffId={(v) => {
          setStaffId(v);
          setYear(null);
        }}
        years={years}
        year={d.year}
        setYear={setYear}
        idp="tr-ye"
      />
      <TR_YearBars h={d} />
      <div className="card">
        <div className="tr-card-head">
          <h2 className="card-title" style={{ margin: 0 }}>
            {d.year} year-end summary · {name}
          </h2>
          {statusPill}
        </div>
        {!hasData && !s ? (
          <p className="tr-muted" style={{ margin: 0 }}>
            The draft fills in once a review in {d.year} has both forms in.
          </p>
        ) : (
          <>
            <p className="tr-muted" style={{ margin: "0 0 12px" }}>
              {s && s.status === "confirmed" && !dirty
                ? `Confirmed by ${s.confirmed_by} on ${TR_fmtStamp(s.confirmed_at)}. ${name ? TR_first(name) : "They"} can download it from History.`
                : "Drafted from the year’s scores. Edit it, then confirm. Only a confirmed summary can be downloaded, exported or seen by " +
                  (TR_first(name) || "the team member") +
                  "."}
              {s && s.status === "confirmed" ? " Saving changes returns it to draft until it’s confirmed again." : ""}
            </p>
            {[
              ["strongest", "Strongest"],
              ["focus", "Focus area"],
              ["alignment", "Alignment"],
            ].map(([k, label]) => (
              <div key={k} style={{ marginBottom: 12 }}>
                <label className="tr-label" htmlFor={"tr-ye-" + k}>
                  {label}
                </label>
                <textarea id={"tr-ye-" + k} className="tr-ta" value={f[k]} maxLength={3000} onChange={set(k)} />
              </div>
            ))}
            <div className="tr-actions">
              <button type="button" className="btn-secondary" disabled={!!busy || !dirty} onClick={() => save(false)}>
                {busy === "save" ? "Saving…" : "Save draft"}
              </button>
              <button type="button" className="btn-primary" disabled={!!busy || !filled || (s && s.status === "confirmed" && !dirty)} onClick={() => save(true)}>
                {busy === "confirm" ? "Confirming…" : "Confirm summary"}
              </button>
            </div>
          </>
        )}
        <div className="tr-drive" style={{ marginTop: 16 }}>
          <div>
            <strong>Year-end PDF</strong>
            <p className="tr-muted">
              Saves to <span className="tr-mono">{`${TR_DRIVE_ROOT} / ${name} / ${d.year} Year-End Summary.pdf`}</span>
              {driveNote ? " · " + driveNote : s && s.drive_exported_at && !dirty ? " · Saved " + TR_fmtStamp(s.drive_exported_at) : ""}
            </p>
          </div>
          <span style={{ display: "inline-flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn-secondary" disabled={!confirmed || !!busy} onClick={yearPdf}>
              {busy === "pdf" ? "Preparing…" : "Download PDF"}
            </button>
            <button type="button" className="btn-primary" disabled={!confirmed || !!busy} onClick={exportYear}>
              {busy === "export" ? "Exporting…" : s && s.drive_exported_at ? "Export again" : driveNote ? "Retry export" : "Export to Drive"}
            </button>
          </span>
        </div>
        <TR_Error text={error} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Team status (admin)
// ---------------------------------------------------------------------------
function TR_DriveStatusCard() {
  const [st, setSt] = React.useState({ loading: true, data: null, error: "" });
  const check = React.useCallback(() => {
    setSt({ loading: true, data: null, error: "" });
    TR_api
      .call({ action: "drive_status" })
      .then((d) => setSt({ loading: false, data: d, error: "" }))
      .catch((e) => setSt({ loading: false, data: null, error: TR_errText(e) }));
  }, []);
  React.useEffect(check, [check]);
  let text = "Checking Google Drive…";
  let tone = "neutral";
  if (!st.loading) {
    if (st.error) {
      text = "Couldn’t check Drive: " + st.error;
      tone = "bad";
    } else if (st.data && st.data.connected) {
      text = "Connected to " + (st.data.drive_name || "the Shared Drive");
      tone = "good";
    } else if (st.data && st.data.missing) {
      text = "Waiting for Drive setup";
      tone = "warm";
    } else {
      text = "Drive error" + (st.data && st.data.error ? ": " + st.data.error : "");
      tone = "bad";
    }
  }
  return (
    <div className="card tr-drive">
      <div>
        <strong>Google Drive</strong>
        <p className="tr-muted">Signed reviews save to {TR_DRIVE_ROOT}, one folder per person. Admins only.</p>
      </div>
      <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <TR_Pill tone={tone}>{text}</TR_Pill>
        <button type="button" className="btn-secondary" disabled={st.loading} onClick={check}>
          Check again
        </button>
      </span>
    </div>
  );
}

function TR_nextQuarter(cycles) {
  const now = new Date();
  let y = now.getFullYear();
  let q = Math.floor(now.getMonth() / 3) + 1;
  const taken = new Set((cycles || []).map((c) => c.year * 4 + c.quarter));
  while (taken.has(y * 4 + q)) {
    q += 1;
    if (q > 4) {
      q = 1;
      y += 1;
    }
  }
  return { year: y, quarter: q };
}
function TR_isoDay(d) {
  const z = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

// Reviewee checkboxes + a reviewer per person (default reviewer preselected).
function TR_PickPeople({ people, admins, defaultReviewer, exclude, picked, setPicked, reviewers, setReviewers }) {
  const list = people.filter((p) => !(exclude || []).includes(p.id));
  if (!list.length) return <p className="tr-muted">Everyone active is already in this cycle.</p>;
  return (
    <div className="tr-picks">
      {list.map((p) => {
        const on = picked.includes(p.id);
        const choices = admins.filter((a) => a.id !== p.id);
        const fallback = defaultReviewer && defaultReviewer !== p.id ? defaultReviewer : choices[0] && choices[0].id;
        const rv = reviewers[p.id] || fallback || "";
        return (
          <div className="tr-pick" key={p.id}>
            <label className="tr-check">
              <input
                type="checkbox"
                checked={on}
                onChange={(e) => setPicked(e.target.checked ? picked.concat(p.id) : picked.filter((x) => x !== p.id))}
              />
              <span>
                <strong>{p.name}</strong>
                {p.role === "admin" ? <span className="tr-muted"> · admin</span> : null}
              </span>
            </label>
            {on && (
              <label className="al-field">
                <span>Reviewer</span>
                <select value={rv} onChange={(e) => setReviewers(Object.assign({}, reviewers, { [p.id]: e.target.value }))}>
                  {choices.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        );
      })}
    </div>
  );
}

function TR_reviewerMap(picked, reviewers, admins, defaultReviewer) {
  const out = {};
  picked.forEach((id) => {
    const choices = admins.filter((a) => a.id !== id);
    out[id] = reviewers[id] || (defaultReviewer && defaultReviewer !== id ? defaultReviewer : choices[0] && choices[0].id) || null;
  });
  return out;
}

function TR_OpenCycleCard({ options, cycles, onDone }) {
  const toast = TR_useToastSafe();
  const people = options.staff || [];
  const admins = people.filter((p) => p.role === "admin");
  const nq = TR_nextQuarter(cycles);
  const [year, setYear] = React.useState(nq.year);
  const [quarter, setQuarter] = React.useState(nq.quarter);
  const [opens, setOpens] = React.useState(TR_isoDay(new Date()));
  const [due, setDue] = React.useState(() => TR_isoDay(new Date(nq.year, (nq.quarter - 1) * 3 + 1, 0)));
  const [picked, setPicked] = React.useState(() => people.filter((p) => p.role !== "admin").map((p) => p.id));
  const [reviewers, setReviewers] = React.useState({});
  const [defRev, setDefRev] = React.useState(options.default_reviewer_id || "");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");

  const changeDefault = async (id) => {
    setError("");
    try {
      await TR_api.rpc("tr_set_default_reviewer", { p_reviewer: id });
      setDefRev(id);
      toast("Default reviewer updated");
    } catch (e) {
      setError(TR_errText(e));
    }
  };
  const open = async () => {
    setBusy(true);
    setError("");
    try {
      await TR_api.rpc("tr_open_cycle", {
        p_year: Number(year),
        p_quarter: Number(quarter),
        p_opens: opens || null,
        p_due: due,
        p_staff_ids: picked,
        p_reviewers: TR_reviewerMap(picked, reviewers, admins, defRev),
      });
      toast(`Q${quarter} ${year} review cycle opened`);
      TR_changed();
      onDone();
    } catch (e) {
      setError(TR_errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card">
      <h2 className="card-title">Open a review cycle</h2>
      <p className="card-subtitle">Everyone you pick gets an email with their self-review and the team survey. Reviewers are emailed too.</p>
      <div className="tr-form-grid" style={{ marginTop: 12 }}>
        <label className="al-field">
          <span>Year</span>
          <input type="number" min="2020" max="2100" value={year} onChange={(e) => setYear(e.target.value)} />
        </label>
        <label className="al-field">
          <span>Quarter</span>
          <select value={quarter} onChange={(e) => setQuarter(Number(e.target.value))}>
            {[1, 2, 3, 4].map((q) => (
              <option key={q} value={q}>
                Q{q}
              </option>
            ))}
          </select>
        </label>
        <label className="al-field">
          <span>Opens</span>
          <input type="date" value={opens} onChange={(e) => setOpens(e.target.value)} />
        </label>
        <label className="al-field">
          <span>Due</span>
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </label>
      </div>
      <div className="tr-toolbar" style={{ marginTop: 12, marginBottom: 0 }}>
        <label className="al-field">
          <span>Default reviewer</span>
          <select value={defRev || ""} onChange={(e) => changeDefault(e.target.value)}>
            {!defRev && <option value="">Pick one</option>}
            {admins.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <h3 className="tr-section-title">Who’s being reviewed</h3>
      <TR_PickPeople
        people={people}
        admins={admins}
        defaultReviewer={defRev}
        picked={picked}
        setPicked={setPicked}
        reviewers={reviewers}
        setReviewers={setReviewers}
      />
      <div className="tr-actions">
        <button type="button" className="btn-primary" disabled={busy || !picked.length || !due} onClick={open}>
          {busy ? "Opening…" : `Open Q${quarter} ${year} for ${picked.length} ${picked.length === 1 ? "person" : "people"}`}
        </button>
      </div>
      <TR_Error text={error} />
    </div>
  );
}

const TR_MEETING = (r) => {
  if (r.status === "closed_unsigned") return ["Closed unsigned", "bad"];
  if (r.status === "signed") return ["Signed", "good"];
  if (r.status === "comparing") {
    const n = (r.staff_signed ? 1 : 0) + (r.reviewer_signed ? 1 : 0);
    return n ? [`${n} of 2 signed`, "warm"] : ["Ready to meet", "warm"];
  }
  return ["Waiting on reviews", "neutral"];
};

function TR_TeamStatusTab({ ov }) {
  const toast = TR_useToastSafe();
  const [cycleId, setCycleId] = React.useState(null);
  const ts = TR_useRpc("tr_team_status", { p_cycle: cycleId }, [cycleId]);
  const opts = TR_useRpc("tr_admin_options", {}, []);
  const [modal, setModal] = React.useState(null); // {kind, ...}
  const [busy, setBusy] = React.useState("");
  const [error, setError] = React.useState("");
  const [showOpen, setShowOpen] = React.useState(false);
  const [addPicked, setAddPicked] = React.useState([]);
  const [addReviewers, setAddReviewers] = React.useState({});

  if (ts.error) return <TR_Error text={ts.error} />;
  if (opts.error) return <TR_Error text={opts.error} />;
  if (!ts.data || !opts.data) return <p className="tr-muted">Loading…</p>;

  const d = ts.data;
  const c = d.cycle;
  const rows = d.rows || [];
  const people = opts.data.staff || [];
  const admins = people.filter((p) => p.role === "admin");
  const defRev = opts.data.default_reviewer_id;
  const anyOpen = (d.cycles || []).some((x) => x.status === "open");
  const isOpen = c && c.status === "open";
  const n = rows.length;
  const selfIn = rows.filter((r) => r.self_status === "submitted").length;
  const mgrIn = rows.filter((r) => r.manager_status === "submitted").length;
  const signedIn = rows.filter((r) => r.status === "signed").length;
  const revSet = Array.from(new Set(rows.map((r) => r.reviewer_name)));
  const revName = revSet.length === 1 ? TR_first(revSet[0]) : "";
  const refresh = () => {
    ts.reload();
    TR_changed();
  };

  const remind = async () => {
    setBusy("remind");
    setError("");
    try {
      const k = await TR_api.rpc("tr_send_reminder", { p_cycle: c.id });
      toast(k ? `Reminder queued for ${k} ${k === 1 ? "person" : "people"}` : "Everyone is up to date");
    } catch (e) {
      setError(TR_errText(e));
    } finally {
      setBusy("");
    }
  };
  const startClose = async () => {
    setBusy("preview");
    setError("");
    try {
      const list = await TR_api.rpc("tr_close_cycle_preview", { p_cycle: c.id });
      setModal({ kind: "close", list: list || [] });
    } catch (e) {
      setError(TR_errText(e));
    } finally {
      setBusy("");
    }
  };
  const doClose = async () => {
    setBusy("close");
    try {
      const k = await TR_api.rpc("tr_close_cycle", { p_cycle: c.id });
      toast(`${c.label} closed${k ? ` · ${k} closed unsigned` : ""}`);
      setModal(null);
      refresh();
    } catch (e) {
      setError(TR_errText(e));
      setModal(null);
    } finally {
      setBusy("");
    }
  };
  const doAdd = async () => {
    setBusy("add");
    try {
      const k = await TR_api.rpc("tr_add_reviewees", {
        p_cycle: c.id,
        p_staff_ids: addPicked,
        p_reviewers: TR_reviewerMap(addPicked, addReviewers, admins, defRev),
      });
      toast(`Added ${k} to ${c.label}`);
      setModal(null);
      setAddPicked([]);
      setAddReviewers({});
      refresh();
    } catch (e) {
      setError(TR_errText(e));
      setModal(null);
    } finally {
      setBusy("");
    }
  };
  const doReassign = async () => {
    setBusy("reassign");
    try {
      await TR_api.rpc("tr_reassign_reviewer", { p_review: modal.row.review_id, p_reviewer: modal.to, p_reason: modal.reason || null });
      toast("Reviewer changed");
      setModal(null);
      refresh();
    } catch (e) {
      setModal(Object.assign({}, modal, { error: TR_errText(e) }));
    } finally {
      setBusy("");
    }
  };

  const avg = d.averages || {};
  return (
    <div className="tr-tab">
      <div className="tr-toolbar">
        {(d.cycles || []).length > 0 && (
          <label className="al-field">
            <span>Quarter</span>
            <select value={c ? c.id : ""} onChange={(e) => setCycleId(e.target.value)}>
              {d.cycles.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                  {x.status === "open" ? " (open)" : ""}
                </option>
              ))}
            </select>
          </label>
        )}
        <span className="tr-grow" />
        {!anyOpen && !showOpen && (
          <button type="button" className="btn-primary" onClick={() => setShowOpen(true)}>
            Open a review cycle
          </button>
        )}
      </div>

      {!anyOpen && (showOpen || !c) && (
        <TR_OpenCycleCard
          options={opts.data}
          cycles={d.cycles}
          onDone={() => {
            setShowOpen(false);
            setCycleId(null);
            ts.reload();
            opts.reload();
          }}
        />
      )}

      {c && (
        <>
          <div className="kpi-grid">
            <TR_Kpi label="Self-reviews in" value={`${selfIn} / ${n}`} />
            <TR_Kpi label={revName ? `${revName}’s reviews done` : "Reviewer reviews done"} value={`${mgrIn} / ${n}`} />
            <TR_Kpi label="Signed & locked" value={`${signedIn} / ${n}`} />
          </div>
          <div className="card">
            <div className="tr-card-head">
              <h2 className="card-title" style={{ margin: 0 }}>
                {c.label}
                {c.due_at ? ` · due ${TR_fmtDate(c.due_at)}` : ""}
                {!isOpen ? " · closed" : ""}
              </h2>
              {isOpen && (
                <span style={{ display: "inline-flex", gap: 8, flexWrap: "wrap" }}>
                  <button type="button" className="btn-secondary" disabled={!!busy} onClick={remind}>
                    {busy === "remind" ? "Sending…" : "Send reminder"}
                  </button>
                  <button type="button" className="btn-secondary" disabled={!!busy} onClick={() => setModal({ kind: "add" })}>
                    Add people
                  </button>
                  <button type="button" className="btn-secondary" disabled={!!busy} onClick={startClose}>
                    Close cycle
                  </button>
                </span>
              )}
            </div>
            <TR_Error text={error} />
            {rows.length === 0 ? (
              <p className="tr-muted" style={{ margin: 0 }}>
                Nobody in this cycle yet.
              </p>
            ) : (
              <div className="al-table-wrap">
                <table className="tx-table tx-table-labeled tr-table">
                  <thead>
                    <tr>
                      <th scope="col">Team member</th>
                      <th scope="col">Reviewer</th>
                      <th scope="col">Self-review</th>
                      <th scope="col">Reviewer’s review</th>
                      <th scope="col">Survey</th>
                      <th scope="col">Meeting</th>
                      <th scope="col">Total</th>
                      <th scope="col">
                        <span className="tr-sr">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const m = TR_MEETING(r);
                      const canReassign = isOpen && r.status === "open" && r.manager_status !== "submitted";
                      return (
                        <tr key={r.review_id}>
                          <td data-label="Team member">
                            <strong>{r.staff_name}</strong>
                          </td>
                          <td data-label="Reviewer">
                            {canReassign ? (
                              <select
                                className="tr-sel"
                                aria-label={"Reviewer for " + r.staff_name}
                                value={r.reviewer_id}
                                onChange={(e) => setModal({ kind: "reassign", row: r, to: e.target.value, reason: "" })}
                              >
                                {admins
                                  .filter((a) => a.id !== r.staff_id)
                                  .map((a) => (
                                    <option key={a.id} value={a.id}>
                                      {a.name}
                                    </option>
                                  ))}
                              </select>
                            ) : (
                              r.reviewer_name
                            )}
                          </td>
                          <td data-label="Self-review">
                            <TR_StatusPill status={r.self_status} />
                          </td>
                          <td data-label="Reviewer’s review">
                            <TR_StatusPill status={r.manager_status} />
                          </td>
                          <td data-label="Survey">
                            <TR_Pill tone={r.survey_submitted ? "good" : "neutral"}>{r.survey_submitted ? "Submitted" : "Not yet"}</TR_Pill>
                          </td>
                          <td data-label="Meeting">
                            <TR_Pill tone={m[1]}>{m[0]}</TR_Pill>
                            {r.status === "signed" && (
                              <div className="tr-muted" style={{ fontSize: 12, marginTop: 4 }}>
                                {r.drive_exported_at
                                  ? "In Drive"
                                  : r.drive_export_error === "waiting_for_drive_setup"
                                    ? "Waiting for Drive setup"
                                    : r.drive_export_error
                                      ? "Drive export failed"
                                      : "Saving to Drive…"}
                              </div>
                            )}
                          </td>
                          <td data-label="Total" className="tr-num">
                            {r.manager_total != null ? `${r.manager_total} / ${TR_MAX_TOTAL}` : "—"}
                          </td>
                          <td className="row-remove-cell">
                            <span style={{ display: "inline-flex", gap: 8, flexWrap: "wrap" }}>
                              <button type="button" className="btn-secondary" onClick={() => TR_goReviews("r/" + r.review_id)} aria-label={"Open review for " + r.staff_name}>
                                Open
                              </button>
                              {(r.status === "open" || r.status === "comparing") && (
                                <button
                                  type="button"
                                  className="btn-secondary"
                                  onClick={() => setModal({ kind: "close-one", row: r })}
                                  aria-label={"Close review for " + r.staff_name + " unsigned"}
                                >
                                  Close unsigned
                                </button>
                              )}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card">
            <h2 className="card-title">Team averages {c.year}</h2>
            <p className="card-subtitle">Reviewer scores, out of 5, from reviews with both forms in{avg.count ? ` (${avg.count})` : ""}.</p>
            {TR_SECTIONS.map((sec) => {
              const v = avg[sec.key];
              return (
                <div className="tr-avg-row" key={sec.key}>
                  <span>{sec.title}</span>
                  <div className="tr-bar-track" role="img" aria-label={`${sec.title}: ${v != null ? Number(v).toFixed(1) : "no data"} of 5`}>
                    <div className="tr-bar-fill mgr" style={{ width: v != null ? (100 * Number(v)) / 5 + "%" : 0 }} />
                  </div>
                  <span className="tr-num">{v != null ? Number(v).toFixed(1) : "—"}</span>
                </div>
              );
            })}
          </div>
        </>
      )}

      <TR_DriveStatusCard />

      {modal && modal.kind === "close" && (
        <TR_Confirm title={`Close ${c.label}?`} confirmLabel="Close cycle" danger busy={busy === "close"} onConfirm={doClose} onClose={() => setModal(null)}>
          {modal.list.length ? (
            <>
              <p>These reviews aren’t signed. They’ll be marked closed unsigned and kept, read-only:</p>
              <ul>
                {modal.list.map((x) => (
                  <li key={x.review_id}>
                    {x.staff_name} · {(TR_REVIEW_STATUS[x.status] || [x.status])[0]}
                  </li>
                ))}
              </ul>
              <p>Their open action steps carry forward to the next quarter.</p>
            </>
          ) : (
            <p>Every review in {c.label} is signed. Closing stops new submissions and survey answers.</p>
          )}
        </TR_Confirm>
      )}
      {modal && modal.kind === "close-one" && (
        <TR_ReasonModal
          title={`Close ${TR_poss(modal.row.staff_name)} review unsigned?`}
          intro="It’s kept, read-only, with your reason. Open action steps carry forward."
          confirmLabel="Close unsigned"
          danger
          onClose={() => setModal(null)}
          onConfirm={async (reason) => {
            await TR_api.rpc("tr_close_review_unsigned", { p_review: modal.row.review_id, p_reason: reason });
            toast("Closed unsigned");
            setModal(null);
            refresh();
          }}
        />
      )}
      {modal && modal.kind === "reassign" && (
        <TR_Confirm
          title="Change reviewer?"
          confirmLabel="Change reviewer"
          busy={busy === "reassign"}
          onConfirm={doReassign}
          onClose={() => setModal(null)}
        >
          <p>
            {modal.row.staff_name}’s review moves from {modal.row.reviewer_name} to {(admins.find((a) => a.id === modal.to) || {}).name}. Any draft{" "}
            {TR_first(modal.row.reviewer_name)} started is kept in the history but not handed over. The new reviewer gets an email.
          </p>
          <label className="tr-label" htmlFor="tr-reassign-reason">
            Reason (optional)
          </label>
          <textarea
            id="tr-reassign-reason"
            className="tr-ta"
            value={modal.reason}
            onChange={(e) => setModal(Object.assign({}, modal, { reason: e.target.value }))}
          />
          <TR_Error text={modal.error} />
        </TR_Confirm>
      )}
      {modal && modal.kind === "add" && (
        <TR_Confirm
          title={`Add people to ${c.label}`}
          confirmLabel={`Add ${addPicked.length || ""}`.trim()}
          busy={busy === "add"}
          canConfirm={addPicked.length > 0}
          onConfirm={doAdd}
          onClose={() => setModal(null)}
        >
          <TR_PickPeople
            people={people}
            admins={admins}
            defaultReviewer={defRev}
            exclude={rows.map((r) => r.staff_id)}
            picked={addPicked}
            setPicked={setAddPicked}
            reviewers={addReviewers}
            setReviewers={setAddReviewers}
          />
        </TR_Confirm>
      )}
    </div>
  );
}
