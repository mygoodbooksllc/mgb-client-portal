// Time off and coverage (owner request 2026-10-07). Staff only.
//
// staff_time_off (supabase/staff-time-off.sql): everyone adds and cancels
// their own time off, admins anyone's. Rows are never deleted; Cancel sets
// cancelled_at. No calendar sync.
//
//   CV_MyTimeOffBody   "My time off": Team → People for non-admins
//                      (TeamPage.jsx) and the home card (app.jsx wraps it)
//   CV_CoverageTab     Team → People (admins, #/team/people): who's out now and in
//                      the next 30 days, their clients, each client's backup,
//                      whether the backup can open the client, and "Give
//                      access" (grant_coverage_access, a temporary grant in
//                      staff_client_access_grants that ends the day after the
//                      time off).
//   CV_OutTag          "Out until Oct 12" next to a bookkeeper's name (Inbox
//                      context panel, Client overview).
//   CV_StaffSelect     staff picker (staff_directory RPC), used for the
//                      client's backup bookkeeper.
//   CV_Handoff         Tasks Phase 2 S7: "Hand my tasks to backups" (preview,
//                      hand off, Hand back now) on each time off; admins can
//                      pick a cover per client. CV_useMyCoverage feeds the
//                      task drawer and Today "Covering for" labels.
//
// Rules live in staffOpsLogic.js (OPS_outUntil, OPS_upcomingTimeOff,
// OPS_timeOffError, OPS_BACKUP_ACCESS).

const CV_SETUP_MSG = "Time off isn't set up yet (database step pending).";

// ---- Shared time-off store (one query for every tag and card on screen)
const CV_store = { rows: null, error: null, promise: null, subs: new Set(), listening: false };

function CV_emit() {
  CV_store.subs.forEach((fn) => {
    try {
      fn();
    } catch (e) {}
  });
}

function CV_load(force) {
  const sb = window.mgbSupabase;
  if (!sb) return Promise.resolve();
  if (!force && (CV_store.rows || CV_store.promise)) return CV_store.promise || Promise.resolve();
  CV_store.promise = sb
    .from("staff_time_off")
    .select("id, staff_email, starts_on, ends_on, note, created_by, created_at, cancelled_at")
    .is("cancelled_at", null)
    .gte("ends_on", OPS_addDays(todayLocal(), -1))
    .order("starts_on", { ascending: true })
    .then(
      ({ data, error }) => {
        CV_store.promise = null;
        if (error) {
          CV_store.rows = [];
          CV_store.error =
            typeof isMissingTableError === "function" && isMissingTableError(error) ? CV_SETUP_MSG : error.message || "Couldn't load time off.";
        } else {
          CV_store.rows = data || [];
          CV_store.error = null;
        }
        CV_emit();
      },
      () => {
        CV_store.promise = null;
        CV_store.rows = [];
        CV_store.error = "Couldn't load time off.";
        CV_emit();
      },
    );
  return CV_store.promise;
}

function CV_useTimeOff() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const fn = () => setTick((t) => t + 1);
    CV_store.subs.add(fn);
    CV_load(false);
    // One app-wide listener, however many tags are on screen.
    if (!CV_store.listening) {
      CV_store.listening = true;
      window.addEventListener(STAFF_TOOLS_EVENT, () => {
        if (CV_store.subs.size) CV_load(true);
      });
    }
    return () => {
      CV_store.subs.delete(fn);
    };
  }, []);
  return { rows: CV_store.rows || [], loading: CV_store.rows == null, error: CV_store.error };
}

// ---- Staff directory (bookkeepers can't read the staff table)
const CV_dir = { list: null, promise: null };

function CV_loadDirectory() {
  const sb = window.mgbSupabase;
  if (!sb) return Promise.resolve([]);
  if (CV_dir.list) return Promise.resolve(CV_dir.list);
  if (CV_dir.promise) return CV_dir.promise;
  CV_dir.promise = sb.rpc("staff_directory").then(
    ({ data, error }) => {
      CV_dir.promise = null;
      if (error) return [];
      CV_dir.list = (data || []).map((s) => ({ email: String(s.email || "").toLowerCase(), name: s.name, role: s.role }));
      return CV_dir.list;
    },
    () => {
      CV_dir.promise = null;
      return [];
    },
  );
  return CV_dir.promise;
}

function CV_useDirectory() {
  const [list, setList] = useState(CV_dir.list || []);
  useEffect(() => {
    let alive = true;
    CV_loadDirectory().then((l) => alive && setList(l || []));
    return () => {
      alive = false;
    };
  }, []);
  return list;
}

const CV_nameOf = (dir, email) => {
  const e = String(email || "").toLowerCase();
  const hit = (dir || []).find((s) => s.email === e);
  return (hit && hit.name) || email || "";
};

function CV_StaffSelect({ value, onChange, emptyLabel, id, exclude }) {
  const dir = CV_useDirectory();
  const v = String(value || "").toLowerCase();
  const ex = String(exclude || "").toLowerCase();
  const list = dir.filter((s) => s.email !== ex);
  return (
    <select id={id} value={v} onChange={(e) => onChange(e.target.value)}>
      <option value="">{emptyLabel || "Not set"}</option>
      {v && !list.some((s) => s.email === v) && <option value={v}>{v}</option>}
      {list.map((s) => (
        <option key={s.email} value={s.email}>
          {s.name || s.email}
          {s.role === "admin" ? " (admin)" : ""}
        </option>
      ))}
    </select>
  );
}

// Backup's name (falls back to the email) for the Client overview.
function CV_BackupName({ email }) {
  const dir = CV_useDirectory();
  if (!email) return "Not set";
  return CV_nameOf(dir, email);
}

// ---- Out tag
function CV_OutTag({ email }) {
  const st = CV_useTimeOff();
  const until = OPS_outUntil(st.rows, email, todayLocal());
  if (!until) return null;
  return (
    <span className="cv-out-tag" title="On time off. Check the client's backup bookkeeper.">
      Out until {fmtDate(until)}
    </span>
  );
}

const CV_range = (r) =>
  r.starts_on === r.ends_on ? fmtDate(r.starts_on) : fmtDate(r.starts_on) + " – " + fmtDate(r.ends_on);

// ---- Add form
function CV_TimeOffForm({ me, isAdmin, onDone }) {
  const showToast = useToast();
  const today = todayLocal();
  const [who, setWho] = useState(String(me || "").toLowerCase());
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function save(e) {
    e.preventDefault();
    const problem = OPS_timeOffError(from, to, today);
    if (problem) return setErr(problem);
    if (!who) return setErr("Pick who's out.");
    setErr("");
    setBusy(true);
    const { error } = await window.mgbSupabase
      .from("staff_time_off")
      .insert({ staff_email: who, starts_on: from, ends_on: to, note: note.trim() || null });
    setBusy(false);
    if (error) {
      setErr(typeof isMissingTableError === "function" && isMissingTableError(error) ? CV_SETUP_MSG : error.message);
      return;
    }
    showToast("Time off saved");
    setFrom("");
    setTo("");
    setNote("");
    CV_load(true);
    if (onDone) onDone();
  }
  return (
    <form className="cv-form" onSubmit={save}>
      {isAdmin && (
        <label className="task-field">
          <span>Who</span>
          <CV_StaffSelect value={who} onChange={setWho} emptyLabel="Pick a person" />
        </label>
      )}
      <label className="task-field">
        <span>First day off</span>
        <input type="date" value={from} min={today} onChange={(e) => {
          setFrom(e.target.value);
          if (!to || to < e.target.value) setTo(e.target.value);
        }} />
      </label>
      <label className="task-field">
        <span>Last day off</span>
        <input type="date" value={to} min={from || today} onChange={(e) => setTo(e.target.value)} />
      </label>
      <label className="task-field cv-form-note">
        <span>Note (optional, every staff member can see it)</span>
        <input type="text" maxLength={300} value={note} placeholder="Vacation, back Monday" onChange={(e) => setNote(e.target.value)} />
      </label>
      {err && <p className="cv-err" role="alert">{err}</p>}
      <div className="cv-form-actions">
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "Saving…" : "Save time off"}
        </button>
        {onDone && (
          <button type="button" className="btn-secondary" onClick={onDone}>
            Close
          </button>
        )}
      </div>
    </form>
  );
}

function CV_CancelButton({ row, onCancelled }) {
  const showToast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    const { error } = await window.mgbSupabase
      .from("staff_time_off")
      .update({ cancelled_at: new Date().toISOString() })
      .eq("id", row.id);
    setBusy(false);
    setConfirming(false);
    if (error) return showToast("Couldn't cancel: " + error.message);
    showToast("Time off cancelled. Any tasks with backups come back.");
    CV_load(true);
    CV_coverageChanged();
    if (onCancelled) onCancelled();
  }
  if (!confirming)
    return (
      <button type="button" className="link-btn" onClick={() => setConfirming(true)}>
        Cancel
      </button>
    );
  return (
    <span className="cv-confirm">
      <button type="button" className="link-btn cv-danger" disabled={busy} onClick={go}>
        {busy ? "Cancelling…" : "Yes, cancel it"}
      </button>
      <button type="button" className="link-btn" onClick={() => setConfirming(false)}>
        Keep
      </button>
    </span>
  );
}

// ---- Task hand-off for time off (Tasks Phase 2, S7) -------------------------
// tk_apply_ooo / tk_return_ooo / tk_my_coverage (supabase/tasks-p2-7-ooo.sql)
// through TK_api. Open tasks due while someone is out go to each client's
// backup bookkeeper; Ready for review, private and MGB (internal) tasks stay.
// The tk-ooo-daily job also does this on the first day off and hands
// everything back after the last one; these buttons do it sooner.
// Wording: TK_coverageLogic.js.
const CV_NO_ROWS = [];
const CV_cov = { rows: null, promise: null, at: 0, subs: new Set(), listening: false };

function CV_loadCoverage(force) {
  if (typeof TK_api === "undefined" || !TK_api || typeof TK_api.myCoverage !== "function") return Promise.resolve([]);
  if (!force && CV_cov.promise) return CV_cov.promise;
  if (!force && CV_cov.rows && Date.now() - CV_cov.at < 60000) return Promise.resolve(CV_cov.rows);
  CV_cov.promise = TK_api.myCoverage().then(
    (rows) => {
      CV_cov.rows = rows || [];
      CV_cov.at = Date.now();
      CV_cov.promise = null;
      CV_cov.subs.forEach((fn) => {
        try {
          fn();
        } catch (e) {}
      });
      return CV_cov.rows;
    },
    () => {
      CV_cov.rows = CV_cov.rows || [];
      CV_cov.promise = null;
      return CV_cov.rows;
    },
  );
  return CV_cov.promise;
}

// Open hand-offs that involve me (admins: everyone's). [] until loaded or
// before the database step.
function CV_useMyCoverage() {
  const [, setN] = useState(0);
  useEffect(() => {
    const fn = () => setN((x) => x + 1);
    CV_cov.subs.add(fn);
    if (!CV_cov.listening) {
      CV_cov.listening = true;
      try {
        window.addEventListener("mgb:tk-coverage-changed", () => CV_loadCoverage(true));
      } catch (e) {}
    }
    CV_loadCoverage(false);
    return () => {
      CV_cov.subs.delete(fn);
    };
  }, []);
  return CV_cov.rows || CV_NO_ROWS;
}

function CV_coverageChanged() {
  try {
    window.dispatchEvent(new CustomEvent("mgb:tk-coverage-changed"));
  } catch (e) {}
}

// "Hand my tasks to backups" for one time off: preview, then hand off; and
// "Hand back now" while tasks are out. Admins can pick a cover for clients
// with no usable backup, and their hand-off gives the backup access.
function CV_Handoff({ row, isAdmin, coveredCount }) {
  const showToast = useToast();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [overrides, setOverrides] = useState({});
  const [confirmBack, setConfirmBack] = useState(false);
  const ready = typeof TK_api !== "undefined" && TK_api && typeof TK_api.oooPreview === "function";
  if (!ready || !row || row.cancelled_at) return null;

  const errText = (e) => {
    const code = (e && (e.reason || e.code)) || "";
    if (code === "tk_forbidden") return "Only the person who is out or an admin can do this.";
    if (code === "tk_bad_request") return "That time off is over or cancelled.";
    if (code === "tk_schema_missing" || code === "PGRST202") return "Task hand-off isn't set up yet (database step pending).";
    return (e && e.message) || "Something went wrong. Try again.";
  };

  async function loadPreview(ov) {
    setBusy("preview");
    setErr("");
    try {
      const res = await TK_api.oooPreview(row.id, isAdmin ? ov || overrides : {});
      setPreview(res);
      setOpen(true);
    } catch (e) {
      setErr(errText(e));
    }
    setBusy("");
  }
  async function apply() {
    setBusy("apply");
    setErr("");
    try {
      const res = await TK_api.oooApply(row.id, isAdmin ? overrides : {});
      showToast(TK_oooApplyText(res));
      setOpen(false);
      setPreview(null);
      setOverrides({});
      CV_coverageChanged();
      if (typeof notifyStaffTools === "function") notifyStaffTools();
    } catch (e) {
      setErr(errText(e));
    }
    setBusy("");
  }
  async function handBack() {
    setBusy("back");
    setErr("");
    try {
      const res = await TK_api.oooReturn(row.id);
      showToast(TK_oooReturnText(res));
      setConfirmBack(false);
      CV_coverageChanged();
    } catch (e) {
      setErr(errText(e));
    }
    setBusy("");
  }

  const g = preview ? TK_oooPreviewGroups(preview, isAdmin) : null;
  const pickable = preview && isAdmin ? TK_oooOverrideClients(preview) : [];
  const owner = (preview && preview.owner) || row.staff_email;

  return (
    <div className="cv-handoff">
      <div className="cv-handoff-bar">
        {coveredCount > 0 && (
          <span className="pill cv-pill-good" title="These go back automatically when the time off ends">
            {coveredCount} task{coveredCount === 1 ? "" : "s"} with backups
          </span>
        )}
        {!open && (
          <button type="button" className="link-btn" disabled={busy === "preview"} onClick={() => loadPreview()}>
            {busy === "preview" ? "Checking…" : isAdmin ? "Hand off tasks" : "Hand my tasks to backups"}
          </button>
        )}
        {coveredCount > 0 &&
          (confirmBack ? (
            <span className="cv-confirm">
              <button type="button" className="link-btn" disabled={busy === "back"} onClick={handBack}>
                {busy === "back" ? "Handing back…" : "Yes, hand back now"}
              </button>
              <button type="button" className="link-btn" onClick={() => setConfirmBack(false)}>
                Keep
              </button>
            </span>
          ) : (
            <button type="button" className="link-btn" onClick={() => setConfirmBack(true)}>
              Hand back now
            </button>
          ))}
      </div>
      {err && <p className="cv-err" role="alert">{err}</p>}
      {open && g && (
        <div className="cv-handoff-panel">
          {preview.inactive ? (
            <p className="card-subtitle">That time off is over or cancelled.</p>
          ) : g.moveCount === 0 ? (
            <p className="card-subtitle">No open tasks due {CV_range(preview)} can move.</p>
          ) : (
            <>
              <p className="cv-handoff-lead">
                {g.moveCount} open task{g.moveCount === 1 ? "" : "s"} due {CV_range(preview)} go to each client's backup. They come back
                automatically after the last day off. Ready for review stays put.
              </p>
              {g.byBackup.map((b) => (
                <div key={b.to} className="cv-handoff-group">
                  <div className="cv-handoff-to">To {b.toName}</div>
                  <ul>
                    {b.items.map((m) => (
                      <li key={m.task_id}>
                        <span className="cv-handoff-title">{m.title}</span>
                        <span className="cv-note">
                          {m.client_name || ""} · due {fmtDate(m.due)}
                          {m.grant ? " · gives access" : ""}
                          {m.reason === "manual" ? " · your pick" : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </>
          )}
          {g.skips.length > 0 && (
            <div className="cv-handoff-skips">
              <div className="cv-handoff-to">Staying with {preview.owner_name || "them"}</div>
              {g.skips.map((s) => (
                <div key={s.reason} className="cv-handoff-skip">
                  <span className="cv-note">{s.text}</span>
                  <ul>
                    {s.items.map((x) => (
                      <li key={x.task_id}>
                        <span className="cv-handoff-title">{x.title}</span>
                        <span className="cv-note">
                          {x.client_name || ""} · due {fmtDate(x.due)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
          {g.privateCount > 0 && (
            <p className="cv-note">
              {g.privateCount} private or internal task{g.privateCount === 1 ? "" : "s"} stay{g.privateCount === 1 ? "s" : ""} with you.
            </p>
          )}
          {pickable.length > 0 && (
            <div className="cv-handoff-pick">
              <div className="cv-handoff-to">Pick someone to cover (admins)</div>
              {pickable.map((c) => (
                <label key={c.client_id} className="task-field">
                  <span>
                    {c.client_name} ({c.count})
                  </span>
                  <CV_StaffSelect
                    value={overrides[c.client_id] || ""}
                    exclude={owner}
                    emptyLabel="Leave with them"
                    onChange={(v) => {
                      const next = Object.assign({}, overrides);
                      if (v) next[c.client_id] = v;
                      else delete next[c.client_id];
                      setOverrides(next);
                    }}
                  />
                </label>
              ))}
              <button type="button" className="btn-secondary" disabled={busy === "preview"} onClick={() => loadPreview(overrides)}>
                {busy === "preview" ? "Checking…" : "Check again"}
              </button>
            </div>
          )}
          <div className="cv-form-actions">
            {g.moveCount > 0 && !preview.inactive && (
              <button type="button" className="btn-primary" disabled={!!busy} onClick={apply}>
                {busy === "apply" ? "Handing off…" : `Hand off ${g.moveCount} task${g.moveCount === 1 ? "" : "s"}`}
              </button>
            )}
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setOpen(false);
                setPreview(null);
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- "My time off" (home card body; Team → People for non-admins)
function CV_MyTimeOffBody({ staffUser }) {
  const me = String((staffUser && staffUser.email) || "").toLowerCase();
  const st = CV_useTimeOff();
  const today = todayLocal();
  const mine = OPS_upcomingTimeOff(st.rows, today, me);
  const [adding, setAdding] = useState(false);
  const cov = CV_useMyCoverage();
  const covCount = TK_coverageCountByTimeOff(cov.filter((c) => String(c.from_email || "").toLowerCase() === me));
  return (
    <div className="cv-my">
      {st.error && <p className="card-subtitle">{st.error}</p>}
      {!st.error && !st.loading && mine.length === 0 && !adding && (
        <p className="card-subtitle cv-empty">No time off coming up.</p>
      )}
      {mine.length > 0 && (
        <ul className="cv-list">
          {mine.map((r) => (
            <li key={r.id}>
              <span className="cv-when">
                {CV_range(r)}
                {r.starts_on <= today && <span className="cv-now">Out now</span>}
              </span>
              {r.note && <span className="cv-note">{r.note}</span>}
              <CV_CancelButton row={r} />
              <CV_Handoff row={r} isAdmin={false} coveredCount={covCount[r.id] || 0} />
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <CV_TimeOffForm me={me} isAdmin={false} onDone={() => setAdding(false)} />
      ) : (
        !st.error && (
          <button type="button" className="btn-secondary cv-add" onClick={() => setAdding(true)}>
            + Add time off
          </button>
        )
      )}
      <p className="cv-hint">
        Before you go, check each of your clients has a backup bookkeeper (Client overview → Edit dates and coverage). On your first day off, open
        tasks due while you're out go to each client's backup and come back after; Hand my tasks to backups does it now.
      </p>
    </div>
  );
}

// ---- Team → People (admins): coverage
function CV_CoverageTab() {
  const showToast = useToast();
  const ctx = useContext(StaffToolsContext) || {};
  const me = (ctx.staffUser && ctx.staffUser.email) || "";
  const today = todayLocal();
  const to = OPS_addDays(today, 30);
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const [tick, setTick] = useState(0);
  const [adding, setAdding] = useState(false);
  const [busyKey, setBusyKey] = useState(null);
  const st = CV_useTimeOff(); // re-runs the overview after add/cancel
  const stamp = (st.rows || []).map((r) => r.id).join(",");
  const covCount = TK_coverageCountByTimeOff(CV_useMyCoverage());
  useEffect(() => {
    let alive = true;
    const sb = window.mgbSupabase;
    if (!sb) return;
    sb.rpc("coverage_overview", { p_from: today, p_to: to }).then(({ data, error }) => {
      if (!alive) return;
      if (error)
        setState({
          loading: false,
          data: null,
          error: error.code === "PGRST202" || /coverage_overview/.test(error.message || "") ? CV_SETUP_MSG : error.message,
        });
      else setState({ loading: false, data: data || { time_off: [] }, error: null });
    });
    return () => {
      alive = false;
    };
  }, [tick, stamp]);

  async function grant(t, c) {
    const key = t.id + "|" + c.client_id;
    setBusyKey(key);
    const { error } = await window.mgbSupabase.rpc("grant_coverage_access", { p_time_off_id: t.id, p_client_id: c.client_id });
    setBusyKey(null);
    if (error) return showToast("Couldn't give access: " + error.message);
    showToast(`${c.backup_name || c.backup_email} can open ${c.client_name} until ${fmtDate(OPS_addDays(t.ends_on, 1))}`);
    setTick((x) => x + 1);
    if (typeof notifyStaffTools === "function") notifyStaffTools();
  }

  const list = (state.data && state.data.time_off) || [];
  const outNow = list.filter((t) => t.starts_on <= today);
  const later = list.filter((t) => t.starts_on > today);

  const block = (t) => {
    const gaps = (t.clients || []).filter((c) => ["none", "none_set", "not_staff"].includes(c.backup_access)).length;
    return (
      <div className="card cv-block" key={t.id}>
        <div className="cv-block-head">
          <div>
            <h3 className="card-title" style={{ margin: 0 }}>{t.staff_name || t.staff_email}</h3>
            <p className="card-subtitle" style={{ margin: "2px 0 0" }}>
              {CV_range(t)}
              {t.note ? " · " + t.note : ""}
            </p>
          </div>
          <div className="cv-block-side">
            {gaps > 0 ? (
              <span className="pill cv-pill-bad">{gaps} client{gaps === 1 ? "" : "s"} not covered</span>
            ) : (t.clients || []).length > 0 ? (
              <span className="pill cv-pill-good">All covered</span>
            ) : null}
            <CV_CancelButton row={t} onCancelled={() => setTick((x) => x + 1)} />
          </div>
        </div>
        <CV_Handoff row={t} isAdmin coveredCount={covCount[t.id] || 0} />
        <div className="table-scroll">
          <table className="tx-table tx-table-labeled cv-table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Backup</th>
                <th>Backup's access</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {(t.clients || []).length === 0 ? (
                <EmptyRow colSpan={4}>No clients assigned to them.</EmptyRow>
              ) : (
                t.clients.map((c) => {
                  const a = OPS_BACKUP_ACCESS[c.backup_access] || OPS_BACKUP_ACCESS.none;
                  const key = t.id + "|" + c.client_id;
                  const short = c.backup_access === "temporary" && c.grant_expires_at && c.grant_expires_at.slice(0, 10) <= t.ends_on;
                  return (
                    <tr key={c.client_id}>
                      <td data-label="Client">
                        <a href={"#/client/" + encodeURIComponent(c.client_id)}>{c.client_name || c.client_id}</a>
                      </td>
                      <td data-label="Backup">
                        {c.backup_name || c.backup_email || "—"}
                        {c.backup_away_until && <span className="cv-out-tag">Also out until {fmtDate(c.backup_away_until)}</span>}
                      </td>
                      <td data-label="Backup's access">
                        <span className={"pill cv-pill-" + (short ? "bad" : a.tone)}>
                          {a.label}
                          {c.backup_access === "temporary" && c.grant_expires_at ? " until " + fmtDateTime(c.grant_expires_at) : ""}
                        </span>
                      </td>
                      <td data-label="">
                        {c.backup_access === "none" || short ? (
                          <button type="button" className="btn-secondary cv-grant" disabled={busyKey === key} onClick={() => grant(t, c)}>
                            {busyKey === key ? "Giving access…" : "Give access for this time off"}
                          </button>
                        ) : c.backup_access === "none_set" || c.backup_access === "not_staff" ? (
                          <a className="link-btn" href={"#/client/" + encodeURIComponent(c.client_id) + "/overview"}>
                            Set a backup
                          </a>
                        ) : null}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="cv-page">
      <div className="card" style={{ marginBottom: 20 }} data-tour="cv-coverage">
        <div className="cv-block-head">
          <div>
            <h3 className="card-title" style={{ margin: 0 }}>Coverage, today to {fmtDate(to)}</h3>
            <p className="card-subtitle" style={{ margin: "2px 0 0" }}>
              Who's out, their clients and whether each client's backup can open it. "Give access" starts now and ends the day after they're back.
              "Hand off tasks" moves their open tasks due while they're out to each client's backup (the daily job does it on the first day off)
              and they come back after.
            </p>
          </div>
          {!adding && (
            <button type="button" className="btn-secondary" onClick={() => setAdding(true)}>
              + Add time off
            </button>
          )}
        </div>
        {adding && <CV_TimeOffForm me={me} isAdmin onDone={() => setAdding(false)} />}
        {state.error && (
          <div className="mock-banner" style={{ marginTop: 16, marginBottom: 0 }}>
            <WarningIcon />
            <span>{state.error}</span>
          </div>
        )}
      </div>
      {state.loading ? (
        <p className="card-subtitle">Loading…</p>
      ) : !state.error && list.length === 0 ? (
        <div className="card">
          <p className="card-subtitle cv-empty" style={{ margin: 0 }}>Nobody has time off in the next 30 days.</p>
        </div>
      ) : (
        <>
          {outNow.length > 0 && <h2 className="cv-h">Out now</h2>}
          {outNow.map(block)}
          {later.length > 0 && <h2 className="cv-h">Next 30 days</h2>}
          {later.map(block)}
        </>
      )}
    </div>
  );
}
