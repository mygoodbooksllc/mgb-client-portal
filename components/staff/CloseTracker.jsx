// ----------------------------------------------------------------------------
// Month-end close tracker (owner request 2026-09-29). Staff page
// "close-tracker", every staff member.
//
// Clients x months grid: the last 6 months plus the current one. Each cell is
// a month_close row (supabase/month-close.sql); no row = not started.
// Statuses: not started / in progress / review / done / n.a., with who and
// when stamped server-side.
//
// Scope: the page gets App's visibleClients (a bookkeeper's assigned and
// temporarily granted clients; admins get everyone) and RLS
// (can_access_client) enforces the same thing on writes.
//
// Late: a month is late once today is past late_day of the FOLLOWING month
// and it isn't done / n.a. late_day lives in month_close_settings (default
// 15); admins change it here.
//
// Filters (bookkeeper, status) and the summary counts apply to the "focus"
// month, last month by default, since that's the one being closed. Saving a
// cell fires OB_CHANGED_EVENT so the onboarding "First close done" step
// updates.
//
// Loaded before app.jsx and shares its global scope: top-level names carry a
// CT_ prefix; app.jsx globals (hooks, ModalShell, useToast, fmtDate) are only
// touched at render time.
// ----------------------------------------------------------------------------

const CT_STATUSES = [
  { key: "not_started", label: "Not started", short: "—" },
  { key: "in_progress", label: "In progress", short: "In progress" },
  { key: "review", label: "Review", short: "Review" },
  { key: "done", label: "Done", short: "Done" },
  { key: "na", label: "N/A", short: "N/A" },
];
const CT_STATUS_LABEL = Object.fromEntries(CT_STATUSES.map((s) => [s.key, s.label]));
const CT_MONTHS_BACK = 6;

const CT_ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Oldest first, current month last.
function CT_periods(today) {
  const out = [];
  for (let i = CT_MONTHS_BACK; i >= 0; i--) {
    out.push(CT_ymd(new Date(today.getFullYear(), today.getMonth() - i, 1)));
  }
  return out;
}

function CT_monthLabel(period, withYear) {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString("en-US", withYear ? { month: "short", year: "numeric" } : { month: "short" });
}

// Deadline for a period: late_day of the following month.
function CT_deadline(period, lateDay) {
  const [y, m] = period.split("-").map(Number);
  return new Date(y, m, lateDay); // month index m = the following month
}

function CT_isLate(period, status, lateDay, today) {
  if (status === "done" || status === "na") return false;
  const dl = CT_deadline(period, lateDay);
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return t > dl;
}

const CT_who = (email) => String(email || "").split("@")[0];
const CT_bookkeeperOf = (c) => (c.assignedBookkeeper && c.assignedBookkeeper.name) || "";

function CT_CloseTrackerPage({ clients, staffUser }) {
  const showToast = typeof useToast === "function" ? useToast() : null;
  const toast = (m) => showToast && showToast(m);
  const isAdmin = !!(staffUser && staffUser.role === "admin");
  const today = useMemo(() => new Date(), []);
  const periods = useMemo(() => CT_periods(today), [today]);
  const [focus, setFocus] = useState(periods[periods.length - 2]);
  const [rows, setRows] = useState({}); // "client|period" -> row
  const [lateDay, setLateDay] = useState(15);
  const [state, setState] = useState({ loading: true, error: null });
  const [myClientIds, setMyClientIds] = useState(null);
  const [bkFilter, setBkFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("any");
  const [editing, setEditing] = useState(null); // { client, period }
  const [lateDraft, setLateDraft] = useState("");

  const load = useCallback(async () => {
    const sb = window.mgbSupabase;
    if (!sb) {
      setState({ loading: false, error: "Supabase isn't configured, so nothing is saved." });
      return;
    }
    const safe = (p) => Promise.resolve(p).then((r) => r, (e) => ({ data: null, error: e }));
    const [mc, st, mine] = await Promise.all([
      safe(
        sb
          .from("month_close")
          .select("client_id, period, status, notes, updated_by, updated_at")
          .gte("period", periods[0])
          .lte("period", periods[periods.length - 1]),
      ),
      safe(sb.from("month_close_settings").select("late_day").maybeSingle()),
      safe(sb.from("staff_client_access").select("client_id").eq("staff_email", staffUser && staffUser.email)),
    ]);
    const map = {};
    (mc.data || []).forEach((r) => {
      map[r.client_id + "|" + r.period] = r;
    });
    setRows(map);
    if (st.data && st.data.late_day) setLateDay(st.data.late_day);
    setMyClientIds(new Set((mine.data || []).map((r) => r.client_id)));
    setState({
      loading: false,
      error: mc.error ? "Couldn't load close status (" + (mc.error.message || "not signed in") + "). Showing empty months." : null,
    });
  }, [periods, staffUser && staffUser.email]);

  useEffect(() => {
    load();
  }, [load]);

  const statusOf = (clientId, period) => {
    const r = rows[clientId + "|" + period];
    return r ? r.status : "not_started";
  };

  const bookkeepers = useMemo(() => {
    const names = new Set();
    (clients || []).forEach((c) => {
      const n = CT_bookkeeperOf(c);
      if (n) names.add(n);
    });
    return [...names].sort();
  }, [clients]);

  const isMine = (c) =>
    (myClientIds && myClientIds.has(c.id)) ||
    (staffUser && staffUser.name && CT_bookkeeperOf(c).toLowerCase() === String(staffUser.name).toLowerCase());

  const sorted = useMemo(
    () => (clients || []).slice().sort((a, b) => String(a.name).localeCompare(String(b.name))),
    [clients],
  );

  const byBookkeeper = sorted.filter((c) =>
    bkFilter === "all"
      ? true
      : bkFilter === "mine"
        ? isMine(c)
        : bkFilter === "unassigned"
          ? !CT_bookkeeperOf(c)
          : CT_bookkeeperOf(c) === bkFilter,
  );

  const focusIsLate = (c) => CT_isLate(focus, statusOf(c.id, focus), lateDay, today);
  const visible = byBookkeeper.filter((c) =>
    statusFilter === "any" ? true : statusFilter === "late" ? focusIsLate(c) : statusOf(c.id, focus) === statusFilter,
  );

  const counts = useMemo(() => {
    const out = { late: 0 };
    CT_STATUSES.forEach((s) => (out[s.key] = 0));
    byBookkeeper.forEach((c) => {
      const s = statusOf(c.id, focus);
      out[s] = (out[s] || 0) + 1;
      if (CT_isLate(focus, s, lateDay, today)) out.late++;
    });
    return out;
    // eslint-disable-next-line
  }, [byBookkeeper.map((c) => c.id).join(","), rows, focus, lateDay]);

  const lateAll = useMemo(() => {
    let n = 0;
    byBookkeeper.forEach((c) =>
      periods.forEach((p) => {
        if (CT_isLate(p, statusOf(c.id, p), lateDay, today)) n++;
      }),
    );
    return n;
    // eslint-disable-next-line
  }, [byBookkeeper.map((c) => c.id).join(","), rows, lateDay]);

  const save = async (clientId, period, status, notes) => {
    const sb = window.mgbSupabase;
    const key = clientId + "|" + period;
    const prev = rows[key];
    const optimistic = {
      client_id: clientId,
      period,
      status,
      notes: notes || null,
      updated_by: staffUser && staffUser.email,
      updated_at: new Date().toISOString(),
    };
    setRows((r) => ({ ...r, [key]: optimistic }));
    if (!sb) return true;
    const { data, error } = await sb
      .from("month_close")
      .upsert({ client_id: clientId, period, status, notes: notes || null }, { onConflict: "client_id,period" })
      .select("client_id, period, status, notes, updated_by, updated_at")
      .single();
    if (error) {
      setRows((r) => {
        const n = { ...r };
        if (prev) n[key] = prev;
        else delete n[key];
        return n;
      });
      toast("Couldn't save. " + (error.message || ""));
      return false;
    }
    setRows((r) => ({ ...r, [key]: data }));
    try {
      window.dispatchEvent(new Event(typeof OB_CHANGED_EVENT === "string" ? OB_CHANGED_EVENT : "mgb:onboarding-changed"));
    } catch (e) {}
    return true;
  };

  const saveLateDay = async () => {
    const n = parseInt(lateDraft, 10);
    if (!(n >= 1 && n <= 28)) {
      toast("Pick a day between 1 and 28.");
      return;
    }
    const sb = window.mgbSupabase;
    const old = lateDay;
    setLateDay(n);
    setLateDraft("");
    if (!sb) return;
    const { error } = await sb.from("month_close_settings").update({ late_day: n }).eq("id", true);
    if (error) {
      setLateDay(old);
      toast("Couldn't save the late day. " + (error.message || ""));
    } else toast(`Months now count as late after the ${n}${CT_ordinal(n)} of the next month.`);
  };

  return (
    <div className="ct-page">
      <div className="card ct-toolbar-card">
        <div className="ct-toolbar">
          <label className="ct-field">
            <span>Month</span>
            <select value={focus} onChange={(e) => setFocus(e.target.value)}>
              {periods
                .slice()
                .reverse()
                .map((p) => (
                  <option key={p} value={p}>
                    {CT_monthLabel(p, true)}
                  </option>
                ))}
            </select>
          </label>
          <label className="ct-field">
            <span>Bookkeeper</span>
            <select value={bkFilter} onChange={(e) => setBkFilter(e.target.value)}>
              <option value="all">Everyone</option>
              <option value="mine">My clients</option>
              {bookkeepers.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
              <option value="unassigned">Unassigned</option>
            </select>
          </label>
          <label className="ct-field">
            <span>Status</span>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="any">Any</option>
              {CT_STATUSES.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
              <option value="late">Late</option>
            </select>
          </label>
          {isAdmin && (
            <form
              className="ct-field ct-late-setting"
              onSubmit={(e) => {
                e.preventDefault();
                saveLateDay();
              }}
            >
              <span>Late after day</span>
              <span className="ct-late-input">
                <input
                  type="number"
                  min={1}
                  max={28}
                  inputMode="numeric"
                  value={lateDraft === "" ? lateDay : lateDraft}
                  onChange={(e) => setLateDraft(e.target.value)}
                  aria-label="Day of the following month after which an open month is late"
                />
                {lateDraft !== "" && Number(lateDraft) !== lateDay && (
                  <button type="submit" className="btn-secondary">
                    Save
                  </button>
                )}
              </span>
            </form>
          )}
        </div>
        <div className="ct-summary" aria-label={`Summary for ${CT_monthLabel(focus, true)}`}>
          {CT_STATUSES.map((s) => (
            <button
              key={s.key}
              type="button"
              className={"ct-sum ct-s-" + s.key + (statusFilter === s.key ? " active" : "")}
              onClick={() => setStatusFilter(statusFilter === s.key ? "any" : s.key)}
            >
              <span className="ct-sum-n">{counts[s.key] || 0}</span>
              <span className="ct-sum-l">{s.label}</span>
            </button>
          ))}
          <button
            type="button"
            className={"ct-sum ct-s-late" + (statusFilter === "late" ? " active" : "")}
            onClick={() => setStatusFilter(statusFilter === "late" ? "any" : "late")}
          >
            <span className="ct-sum-n">{counts.late}</span>
            <span className="ct-sum-l">Late</span>
          </button>
        </div>
        <p className="card-subtitle ct-note">
          Counts are for {CT_monthLabel(focus, true)}. A month is late after the {lateDay}
          {CT_ordinal(lateDay)} of the next month if it isn't done or N/A
          {lateAll ? ` · ${lateAll} late cell${lateAll === 1 ? "" : "s"} in the grid` : ""}.
        </p>
        {state.error && <div className="mock-banner ct-banner">{state.error}</div>}
      </div>

      <div className="card ct-grid-card">
        {state.loading ? (
          <p className="card-subtitle">Loading…</p>
        ) : visible.length === 0 ? (
          <p className="card-subtitle">
            {sorted.length === 0 ? "No clients to show." : "No clients match these filters."}
          </p>
        ) : (
          <div className="ct-scroll" tabIndex={0} aria-label="Close status grid, scrolls sideways">
            <table className="ct-grid">
              <thead>
                <tr>
                  <th scope="col" className="ct-client-col">
                    Client
                  </th>
                  {periods.map((p) => (
                    <th key={p} scope="col" className={"ct-month" + (p === focus ? " focus" : "")}>
                      <button type="button" className="ct-month-btn" onClick={() => setFocus(p)}>
                        {CT_monthLabel(p, p.slice(5, 7) === "01" || p === periods[0])}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((c) => (
                  <tr key={c.id}>
                    <th scope="row" className="ct-client-col">
                      <span className="ct-client-name">{c.name}</span>
                      <span className="ct-client-bk">{CT_bookkeeperOf(c) || "Unassigned"}</span>
                    </th>
                    {periods.map((p) => {
                      const r = rows[c.id + "|" + p];
                      const s = r ? r.status : "not_started";
                      const late = CT_isLate(p, s, lateDay, today);
                      const title =
                        `${c.name} · ${CT_monthLabel(p, true)}: ${CT_STATUS_LABEL[s]}` +
                        (late ? " (late)" : "") +
                        (r && r.updated_by ? ` · ${CT_who(r.updated_by)}, ${new Date(r.updated_at).toLocaleDateString()}` : "") +
                        (r && r.notes ? ` · ${r.notes}` : "");
                      return (
                        <td key={p} className={"ct-cell" + (p === focus ? " focus" : "")}>
                          <button
                            type="button"
                            className={"ct-pill ct-s-" + s + (late ? " late" : "")}
                            title={title}
                            aria-label={title}
                            onClick={() => setEditing({ client: c, period: p })}
                          >
                            <span className="ct-pill-status">{late && s === "not_started" ? "Late" : CT_STATUSES.find((x) => x.key === s).short}</span>
                            {r && r.updated_by && s !== "not_started" && (
                              <span className="ct-pill-who">
                                {CT_who(r.updated_by)} · {new Date(r.updated_at).toLocaleDateString("en-US", { month: "numeric", day: "numeric" })}
                              </span>
                            )}
                            {r && r.notes && <span className="ct-pill-note" aria-hidden="true">•</span>}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <CT_CellEditor
          client={editing.client}
          period={editing.period}
          row={rows[editing.client.id + "|" + editing.period]}
          late={CT_isLate(editing.period, statusOf(editing.client.id, editing.period), lateDay, today)}
          deadline={CT_deadline(editing.period, lateDay)}
          onClose={() => setEditing(null)}
          onSave={async (status, notes) => {
            const ok = await save(editing.client.id, editing.period, status, notes);
            if (ok) setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function CT_ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

function CT_CellEditor({ client, period, row, late, deadline, onClose, onSave }) {
  const [status, setStatus] = useState(row ? row.status : "not_started");
  const [notes, setNotes] = useState((row && row.notes) || "");
  const [saving, setSaving] = useState(false);
  return (
    <ModalShell onClose={onClose} labelledBy="ct-edit-title" className="ct-modal">
      <form
        className="ct-modal-body"
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          await onSave(status, notes.trim());
          setSaving(false);
        }}
      >
        <h3 id="ct-edit-title" className="card-title">
          {client.name} · {CT_monthLabel(period, true)}
        </h3>
        <p className="card-subtitle">
          Due by {deadline.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
          {late ? " · late" : ""}
        </p>
        <fieldset className="ct-status-group">
          <legend className="ct-legend">Status</legend>
          {CT_STATUSES.map((s) => (
            <label key={s.key} className={"ct-status-opt ct-s-" + s.key + (status === s.key ? " selected" : "")}>
              <input type="radio" name="ct-status" value={s.key} checked={status === s.key} onChange={() => setStatus(s.key)} />
              {s.label}
            </label>
          ))}
        </fieldset>
        <label className="ct-legend" htmlFor="ct-notes">
          Notes
        </label>
        <textarea
          id="ct-notes"
          className="ct-notes"
          rows={3}
          maxLength={2000}
          value={notes}
          placeholder="Waiting on bank statement, reviewer, anything useful"
          onChange={(e) => setNotes(e.target.value)}
        />
        {row && row.updated_by && (
          <p className="card-subtitle">
            Last updated by {CT_who(row.updated_by)} on {new Date(row.updated_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
          </p>
        )}
        <div className="ct-modal-foot">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
