// ----------------------------------------------------------------------------
// Team page (admin only, owner request 2026-09-29). Hours and tasks by person
// and by client for a chosen period, so an admin can see who has what open or
// overdue, what got done, and how many hours each client really takes (for
// pricing, and to spot a bookkeeper working slowly).
//
// Hours come only from QuickBooks Time (Workforce); the manual in-app time
// log ("My Time", time_entries) was retired 2026-09-29. time_entries is kept
// in the database but nothing here reads it any more.
//
// Read-only. Everything is fetched raw and aggregated client-side, the same
// approach as Usage Stats:
//   - staff_app_time (supabase/app-time-tracking.sql): automatic in-app
//     active time per staff member per client per day. Admins read every
//     row. Shown as the "In app" column and in the drill-downs; it is not
//     billed time.
//   - staff_reminders: admins read every row, private ones included.
//   - staff, staff_client_access, staff_client_access_grants: roster and
//     assignments, as Staff Access and the client switcher load them.
// Every query fails soft: no Supabase, a 401 (local, signed out) or a missing
// table leaves that slice empty and shows a friendly note instead.
//
// QuickBooks Time (the firm's own QuickBooks company, supabase/qbo-firm-time.sql)
// lives in TeamQbo.jsx: the connection panel, customer/staff mapping, the
// People and Clients tables and the entry drill-downs. Those tables still
// render (with in-app time only) when QuickBooks isn't connected.
//
// Loaded before app.jsx and shares its global scope, so every top-level name
// here carries a TP_ prefix, and app.jsx globals (hooks, fmtDate, planLabel,
// EmptyRow, icons...) are only touched at render time.
// ----------------------------------------------------------------------------

const TP_PERIODS = [
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "last-month", label: "Last month" },
  { key: "custom", label: "Custom range" },
];
const TP_PAGE_SIZE = 1000;
const TP_MAX_ROWS = 20000;
const TP_APP_COLS = "staff_email, client_id, day, seconds";
const TP_TASK_BASE_COLS =
  "id, staff_email, text, due_date, done, completed_at, client_id, priority, created_at";
const TP_TASK_V2_COLS =
  "kind, due_at, recurrence, assignee_email, created_by, visibility, remind_at, source, source_ref";

const TP_ymd = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
const TP_parseYmd = (ymd) => {
  const [y, m, d] = String(ymd).split("-").map(Number);
  return new Date(y, m - 1, d);
};
const TP_lower = (s) => String(s || "").trim().toLowerCase();

// Inclusive YYYY-MM-DD bounds for a period. Weeks start on Monday.
function TP_periodRange(key, customFrom, customTo) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  if (key === "week") {
    const offset = (now.getDay() + 6) % 7;
    const start = new Date(y, m, now.getDate() - offset);
    const end = new Date(y, m, now.getDate() - offset + 6);
    return { from: TP_ymd(start), to: TP_ymd(end) };
  }
  if (key === "last-month") {
    return { from: TP_ymd(new Date(y, m - 1, 1)), to: TP_ymd(new Date(y, m, 0)) };
  }
  if (key === "custom" && customFrom && customTo) {
    return customFrom <= customTo
      ? { from: customFrom, to: customTo }
      : { from: customTo, to: customFrom };
  }
  return { from: TP_ymd(new Date(y, m, 1)), to: TP_ymd(new Date(y, m + 1, 0)) };
}

// The three full calendar months before this one, for the per-client
// monthly average that sits next to the current period.
function TP_avgRange() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const from = new Date(y, m - 3, 1);
  const to = new Date(y, m, 0);
  const label =
    from.toLocaleDateString("en-US", { month: "short" }) +
    " to " +
    to.toLocaleDateString("en-US", { month: "short" });
  return { from: TP_ymd(from), to: TP_ymd(to), label };
}

// Minutes as h:mm ("12:05").
function TP_fmtHM(minutes) {
  const total = Math.round(minutes || 0);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function TP_friendlyError(what, error) {
  const msg = String((error && error.message) || error || "");
  const status = error && error.status;
  if (
    status === 401 ||
    status === 403 ||
    /jwt|not authenticated|unauthori[sz]ed|permission denied/i.test(msg)
  ) {
    return `Couldn't load ${what}: you need to be signed in as an admin.`;
  }
  return `Couldn't load ${what}. ${msg}`.trim();
}

// Supabase caps a select at 1,000 rows, so page through with range().
async function TP_fetchAll(build) {
  let out = [];
  for (let from = 0; from < TP_MAX_ROWS; from += TP_PAGE_SIZE) {
    let res;
    try {
      res = await build().range(from, from + TP_PAGE_SIZE - 1);
    } catch (e) {
      return { data: out, error: e };
    }
    if (res.error) return { data: out, error: res.error };
    const rows = res.data || [];
    out = out.concat(rows);
    if (rows.length < TP_PAGE_SIZE) break;
  }
  return { data: out, error: null };
}

const TP_taskOwner = (t) => TP_lower(t.assignee_email || t.staff_email);

// Local YYYY-MM-DD of a completed_at timestamp, or null.
function TP_completedYmd(t) {
  if (!t.completed_at) return null;
  const d = new Date(t.completed_at);
  return isNaN(d) ? null : TP_ymd(d);
}

// Same idea of due/overdue/done as My Tasks: overdue = open with a due_date
// before today (local).
function TP_taskState(t, today, range) {
  if (t.done) {
    const c = TP_completedYmd(t);
    return c && c >= range.from && c <= range.to ? "completed" : "done-earlier";
  }
  return t.due_date && t.due_date < today ? "overdue" : "open";
}

// Everything the page shows, from the raw rows. Pure, so it can be exercised
// directly without Supabase. `appTime` rows are staff_app_time
// (staff_email, client_id, day, seconds); they become appMinutes /
// appByStaff on the people and client rows.
function TP_aggregate({ staff, appTime, tasks, access, grants, clients, range, today }) {
  const staffByEmail = {};
  (staff || []).forEach((s) => {
    staffByEmail[TP_lower(s.email)] = s;
  });
  const clientById = {};
  (clients || []).forEach((c) => {
    clientById[c.id] = c;
  });

  // Same shape TP_HoursBars already takes (entry_date, minutes).
  const appInPeriod = (appTime || [])
    .filter((r) => r.day >= range.from && r.day <= range.to)
    .map((r) => ({
      staff_email: TP_lower(r.staff_email),
      client_id: r.client_id,
      entry_date: r.day,
      minutes: (r.seconds || 0) / 60,
    }));

  // People: active staff; if the roster didn't load, whoever shows up in
  // the in-app time and task data.
  let emails = (staff || [])
    .filter((s) => s.active !== false)
    .map((s) => TP_lower(s.email));
  if (!emails.length) {
    const seen = new Set();
    appInPeriod.forEach((e) => seen.add(e.staff_email));
    (tasks || []).forEach((t) => seen.add(TP_taskOwner(t)));
    seen.delete("");
    emails = [...seen];
  }

  const assigned = {};
  (access || []).forEach((a) => {
    const k = TP_lower(a.staff_email);
    (assigned[k] = assigned[k] || new Set()).add(a.client_id);
  });
  const temp = {};
  (grants || []).forEach((g) => {
    const k = TP_lower(g.staff_email);
    if (assigned[k] && assigned[k].has(g.client_id)) return;
    (temp[k] = temp[k] || new Set()).add(g.client_id);
  });

  const people = emails.map((email) => {
    const s = staffByEmail[email] || {};
    const appMinutes = appInPeriod
      .filter((e) => e.staff_email === email)
      .reduce((n, e) => n + e.minutes, 0);
    const counts = { open: 0, overdue: 0, completed: 0 };
    (tasks || []).forEach((t) => {
      if (TP_taskOwner(t) !== email) return;
      const st = TP_taskState(t, today, range);
      if (st === "overdue") {
        counts.overdue++;
        counts.open++;
      } else if (st === "open") counts.open++;
      else if (st === "completed") counts.completed++;
    });
    return {
      email,
      name: s.name || email.split("@")[0],
      role: s.role || "",
      appMinutes,
      ...counts,
      assignedCount: assigned[email] ? assigned[email].size : 0,
      tempCount: temp[email] ? temp[email].size : 0,
    };
  });

  // Clients: the whole roster, plus any id the data mentions that the
  // roster doesn't (a removed client with old in-app time on it).
  const ids = new Set((clients || []).map((c) => c.id));
  appInPeriod.forEach((e) => e.client_id && ids.add(e.client_id));
  (tasks || []).forEach((t) => !t.done && t.client_id && ids.add(t.client_id));
  const clientRows = [...ids].map((id) => {
    const c = clientById[id];
    const byStaff = {};
    appInPeriod.forEach((e) => {
      if (e.client_id !== id) return;
      byStaff[e.staff_email] = (byStaff[e.staff_email] || 0) + e.minutes;
    });
    let open = 0;
    let overdue = 0;
    (tasks || []).forEach((t) => {
      if (t.client_id !== id) return;
      const st = TP_taskState(t, today, range);
      if (st === "overdue") {
        overdue++;
        open++;
      } else if (st === "open") open++;
    });
    return {
      id,
      name: (c && c.name) || "Unknown client",
      plan: c ? c.plan : null,
      known: !!c,
      appMinutes: Object.values(byStaff).reduce((n, m) => n + m, 0),
      appByStaff: Object.entries(byStaff)
        .map(([email, minutes]) => ({ email, minutes }))
        .sort((a, b) => b.minutes - a.minutes),
      open,
      overdue,
    };
  });

  return { people, clientRows, appInPeriod, staffByEmail, clientById };
}

// Same quoting as the Bank Accounts export, plus a leading apostrophe on
// anything a spreadsheet would read as a formula (descriptions are free text).
function TP_downloadCsv(filename, header, rows) {
  const cell = (v) => {
    let s = v == null ? "" : String(v);
    if (/^[=+\-@]/.test(s) && isNaN(Number(s))) s = "'" + s;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const csv = [header, ...rows].map((r) => r.map(cell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Daily bars for a period up to 31 days, weekly (Monday start) beyond that.
function TP_HoursBars({ entries, range }) {
  const buckets = useMemo(() => {
    const start = TP_parseYmd(range.from);
    const end = TP_parseYmd(range.to);
    const days = Math.round((end - start) / 86400000) + 1;
    const weekly = days > 31;
    const out = [];
    const index = {};
    if (weekly) {
      const first = new Date(start);
      first.setDate(first.getDate() - ((first.getDay() + 6) % 7));
      for (let d = new Date(first); d <= end; d.setDate(d.getDate() + 7)) {
        const key = TP_ymd(d);
        index[key] = out.length;
        out.push({ key, label: fmtDate(key), minutes: 0 });
      }
    } else {
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const key = TP_ymd(d);
        index[key] = out.length;
        out.push({
          key,
          label: String(d.getDate()),
          showLabel: d.getDay() === 1 || out.length === 0,
          minutes: 0,
        });
      }
    }
    (entries || []).forEach((e) => {
      let key = e.entry_date;
      if (weekly) {
        const d = TP_parseYmd(e.entry_date);
        d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
        key = TP_ymd(d);
      }
      if (index[key] != null) out[index[key]].minutes += e.minutes || 0;
    });
    return { weekly, out };
  }, [entries, range.from, range.to]);

  const max = Math.max(0, ...buckets.out.map((b) => b.minutes));
  return (
    <div>
      <div className="tp-bars" role="img" aria-label={buckets.weekly ? "Hours per week" : "Hours per day"}>
        {buckets.out.map((b) => (
          <div
            className="tp-bar-col"
            key={b.key}
            title={`${fmtDate(b.key)}${buckets.weekly ? " week" : ""}: ${TP_fmtHM(b.minutes)}`}
          >
            <div className="tp-bar-slot">
              <div
                className={"tp-bar" + (b.minutes ? "" : " empty")}
                style={{ height: max ? `${Math.max(2, (b.minutes / max) * 100)}%` : "2px" }}
              />
            </div>
            <span className="tp-bar-label">
              {buckets.weekly || b.showLabel ? b.label : ""}
            </span>
          </div>
        ))}
      </div>
      <p className="tp-muted" style={{ marginTop: 8 }}>
        {buckets.weekly ? "Hours per week" : "Hours per day"}
        {max ? `, busiest ${TP_fmtHM(max)}` : ""}
      </p>
    </div>
  );
}

function TP_TaskGroups({ tasks, today, range, clientName, ownerName, emptyText }) {
  const groups = useMemo(() => {
    const g = { overdue: [], open: [], completed: [] };
    (tasks || []).forEach((t) => {
      const st = TP_taskState(t, today, range);
      if (g[st]) g[st].push(t);
    });
    const byDue = (a, b) =>
      (a.due_date || "9999").localeCompare(b.due_date || "9999");
    g.overdue.sort(byDue);
    g.open.sort(byDue);
    g.completed.sort((a, b) =>
      String(b.completed_at || "").localeCompare(String(a.completed_at || "")),
    );
    return g;
  }, [tasks, today, range.from, range.to]);

  const sections = [
    { key: "overdue", label: "Overdue" },
    { key: "open", label: "Open" },
    { key: "completed", label: "Completed in period" },
  ];
  // "Open" in the table counts overdue too; here each task sits in one group.
  const total = groups.overdue.length + groups.open.length + groups.completed.length;
  if (!total) return <p className="card-subtitle">{emptyText || "No tasks."}</p>;

  return (
    <div className="tp-task-groups">
      {sections.map((s) => (
        <div key={s.key} className="tp-task-group">
          <h4 className={"tp-task-group-title" + (s.key === "overdue" ? " bad" : "")}>
            {s.label} <span className="tp-muted">({groups[s.key].length})</span>
          </h4>
          {groups[s.key].length === 0 ? (
            <p className="tp-muted">None.</p>
          ) : (
            <ul className="tp-task-list">
              {groups[s.key].map((t) => (
                <li key={t.id} className="tp-task">
                  <span className={"tp-task-text" + (t.done ? " done" : "")}>{t.text}</span>
                  <span className="tp-task-meta">
                    {ownerName && <span className="task-chip">{ownerName(TP_taskOwner(t))}</span>}
                    {clientName && t.client_id && (
                      <span className="task-chip">{clientName(t.client_id)}</span>
                    )}
                    {s.key === "completed" ? (
                      <span className="task-chip">
                        Done {fmtDate(TP_completedYmd(t))}
                      </span>
                    ) : t.due_date ? (
                      <span className={"task-chip" + (s.key === "overdue" ? " bad" : "")}>
                        Due {fmtDate(t.due_date)}
                      </span>
                    ) : (
                      <span className="task-chip">No due date</span>
                    )}
                    <span className={"task-chip tp-vis-" + (t.visibility === "shared" ? "shared" : "private")}>
                      {t.visibility === "shared" ? "Shared" : "Private"}
                    </span>
                    {t.kind === "reminder" && <span className="task-chip">Reminder</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

function TP_BackBar({ label, onBack, title, subtitle }) {
  return (
    <div className="tp-back-bar">
      <button type="button" className="modal-back" onClick={onBack} aria-label={label}>
        ‹
      </button>
      <div style={{ minWidth: 0 }}>
        <h3 className="card-title" style={{ margin: 0 }}>{title}</h3>
        {subtitle && <p className="card-subtitle" style={{ margin: 0 }}>{subtitle}</p>}
      </div>
    </div>
  );
}

function TP_Stat({ label, value, bad }) {
  return (
    <div className="tp-stat">
      <span className="tp-stat-label">{label}</span>
      <span className={"tp-stat-value" + (bad ? " bad" : "")}>{value}</span>
    </div>
  );
}

// In-app time drill-down: totals grouped by client (for a person) or by
// staffer (for a client), plus the same daily/weekly bars as QuickBooks.
function TP_AppTimeCard({ entries, groupBy, nameOf, range, who }) {
  const list = useMemo(() => {
    const totals = {};
    (entries || []).forEach((e) => {
      const k = groupBy === "client" ? e.client_id : e.staff_email;
      totals[k] = (totals[k] || 0) + e.minutes;
    });
    return Object.entries(totals)
      .map(([key, minutes]) => ({ key, minutes }))
      .sort((a, b) => b.minutes - a.minutes);
  }, [entries, groupBy]);
  const total = list.reduce((n, g) => n + g.minutes, 0);
  const max = list.length ? list[0].minutes : 0;
  return (
    <div className="tp-detail-grid">
      <div className="card">
        <h3 className="card-title" title={typeof TP_APP_TIP === "string" ? TP_APP_TIP : undefined}>
          In-app time by {groupBy === "client" ? "client" : "staffer"}
          <span className="tp-muted" style={{ fontWeight: 400 }}> · {TP_fmtHM(total)}</span>
        </h3>
        <p className="card-subtitle">
          Automatic active time {who ? `${who} spent ` : ""}in the app, counted only with a client open, the tab
          visible and recent input. Not billed hours.
        </p>
        {list.length === 0 ? (
          <p className="card-subtitle">No in-app time in this period.</p>
        ) : (
          <div className="tp-staff-bars">
            {list.map((g) => (
              <div key={g.key}>
                <div className="tp-staff-bar-head">
                  <span className="tp-q-ellipsis">{nameOf(g.key)}</span>
                  <span className="tp-muted">{TP_fmtHM(g.minutes)}</span>
                </div>
                <div className="bar-track">
                  <div
                    className="bar-fill usage"
                    style={{ width: max ? `${(g.minutes / max) * 100}%` : "0%" }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="card">
        <h3 className="card-title">In-app time over the period</h3>
        <TP_HoursBars entries={entries} range={range} />
      </div>
    </div>
  );
}

const TP_roleLabel = (role) =>
  role ? role.charAt(0).toUpperCase() + role.slice(1).replace(/_/g, " ") : "";

function TP_TeamPage({ clients }) {
  const supabase = window.mgbSupabase;
  const [period, setPeriod] = useState("month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [raw, setRaw] = useState(null); // null = loading
  const [errors, setErrors] = useState([]);
  const [view, setView] = useState(null); // { type: "person"|"client"|"bucket"|"mapping", key }
  // QuickBooks Time (TeamQbo.jsx) is the only hours source.
  const qbo = TP_useQboStatus();
  const qboOn = qbo.available;
  const [qboVersion, setQboVersion] = useState(0);

  const range = useMemo(
    () => TP_periodRange(period, customFrom, customTo),
    [period, customFrom, customTo],
  );
  const avg = useMemo(() => TP_avgRange(), []);
  const today = TP_ymd(new Date());
  const qHours = TP_useQboHours(qboOn, range, avg, qboVersion);
  const rangeLabel =
    range.from === range.to
      ? fmtDate(range.from)
      : `${fmtDate(range.from)} to ${fmtDate(range.to)}`;

  const load = useCallback(async () => {
    if (!supabase) {
      setErrors(["Supabase isn't configured, so there's nothing to show here."]);
      setRaw({ staff: [], appTime: [], tasks: [], access: [], grants: [] });
      return;
    }
    setRaw(null);
    const errs = [];
    const nowIso = new Date().toISOString();
    const periodStartIso = TP_parseYmd(range.from).toISOString();

    const staffP = TP_fetchAll(() =>
      supabase.from("staff").select("email, name, role, active").order("email"),
    );
    const appP = TP_fetchAll(() =>
      supabase
        .from("staff_app_time")
        .select(TP_APP_COLS)
        .gte("day", range.from)
        .lte("day", range.to)
        .order("day")
        .order("staff_email")
        .order("client_id"),
    );
    // Open tasks, plus anything completed since the period began.
    const taskQuery = (cols) => () =>
      supabase
        .from("staff_reminders")
        .select(cols)
        .or(`done.eq.false,completed_at.gte."${periodStartIso}"`)
        .order("id");
    const tasksP = (async () => {
      let res = await TP_fetchAll(taskQuery(TP_TASK_BASE_COLS + ", " + TP_TASK_V2_COLS));
      if (
        res.error &&
        typeof staffItemsApi !== "undefined" &&
        staffItemsApi.isMissingColumnError(res.error)
      ) {
        res = await TP_fetchAll(taskQuery(TP_TASK_BASE_COLS));
      }
      return res;
    })();
    const accessP = TP_fetchAll(() =>
      supabase.from("staff_client_access").select("staff_email, client_id").order("staff_email"),
    );
    const grantsP = TP_fetchAll(() =>
      supabase
        .from("staff_client_access_grants")
        .select("id, staff_email, client_id, status, expires_at")
        .eq("status", "approved")
        .gt("expires_at", nowIso)
        .order("id"),
    );

    const [staffR, appR, tasksR, accessR, grantsR] = await Promise.all([
      staffP,
      appP,
      tasksP,
      accessP,
      grantsP,
    ]);
    if (staffR.error) errs.push(TP_friendlyError("the staff list", staffR.error));
    if (appR.error) {
      // A missing table (migration not applied) stays quiet; the column just shows "–".
      if (TP_qErrorKind(appR.error, appR.error.status) === "missing") {
        console.warn("Team page: staff_app_time isn't set up:", appR.error.message);
      } else errs.push(TP_friendlyError("in-app time", appR.error));
    }
    if (tasksR.error) errs.push(TP_friendlyError("tasks", tasksR.error));
    if (accessR.error) errs.push(TP_friendlyError("client assignments", accessR.error));
    // Temporary access is a bonus column; a missing grants table stays quiet.
    if (grantsR.error) console.warn("Team page: couldn't load temporary access:", grantsR.error.message);
    const tasks = (tasksR.data || []).map((t) =>
      typeof normalizeStaffItem === "function" ? normalizeStaffItem(t) : t,
    );
    // Signed out (local dev, or an expired session) fails every query the
    // same way; one line says it better than four.
    const signIn = errs.filter((e) => /signed in as an admin/.test(e));
    setErrors(
      signIn.length > 1 && signIn.length === errs.length
        ? ["Couldn't load team data: you need to be signed in as an admin."]
        : [...new Set(errs)],
    );
    setRaw({
      staff: staffR.data || [],
      appTime: appR.data || [],
      tasks,
      access: accessR.data || [],
      grants: grantsR.data || [],
    });
  }, [supabase, range.from, range.to]);

  useEffect(() => {
    load();
  }, [load]);

  const data = useMemo(() => {
    if (!raw) return null;
    return TP_aggregate({ ...raw, clients, range, today });
  }, [raw, clients, range, today]);

  const staffName = (email) => {
    const s = data && data.staffByEmail[TP_lower(email)];
    return (s && s.name) || String(email || "").split("@")[0] || "Unknown";
  };
  const staffShortName = (email) => staffName(email).split(" ")[0];
  const clientName = (id) =>
    (data && data.clientById[id] && data.clientById[id].name) || "Unknown client";

  const fileSuffix = `${range.from}_to_${range.to}`;
  function exportPeople() {
    if (!data) return;
    TP_qExportPeople(`team_people_${fileSuffix}.csv`, data.people, qHours.byStaff, qboOn);
  }
  function exportClients() {
    if (!data) return;
    TP_qExportClients(
      `team_clients_${fileSuffix}.csv`,
      { clientRows: data.clientRows, hours: qHours, range, today },
      avg.label,
      qboOn,
      staffShortName,
    );
  }

  const qPerson =
    view && view.type === "person" && data
      ? TP_qPeopleRows(data.people, qHours.byStaff).rows.find((p) => p.email === view.key)
      : null;
  const qClientRow =
    view && view.type === "client" && data
      ? TP_qClientRows({ clientRows: data.clientRows, hours: qHours, range, today }).rows.find(
          (r) => r.id === view.key,
        )
      : null;

  // Scroll back to the top when switching between the tables and a detail.
  useEffect(() => {
    try {
      window.scrollTo({ top: 0 });
    } catch (e) {}
  }, [view]);

  const qTotal = qHours.byClient.reduce((n, r) => n + Number(r.total_minutes || 0), 0);
  const appTotal = data ? data.appInPeriod.reduce((n, e) => n + e.minutes, 0) : 0;
  const periodCard = (
    <div className="card tp-toolbar-card" style={{ marginBottom: 20 }}>
      <div className="tp-toolbar">
        <div className="modal-tabs" style={{ marginTop: 0 }}>
          {TP_PERIODS.map((p) => (
            <button
              key={p.key}
              type="button"
              className={"modal-tab" + (period === p.key ? " active" : "")}
              onClick={() => {
                if (p.key === "custom" && !customFrom) {
                  const cur = TP_periodRange(period);
                  setCustomFrom(cur.from);
                  setCustomTo(cur.to);
                }
                setPeriod(p.key);
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
        {!view && (
          <div className="tp-export">
            <button type="button" className="btn-secondary" onClick={exportPeople} disabled={!data}>
              <DownloadIcon width="14" height="14" /> People CSV
            </button>
            <button type="button" className="btn-secondary" onClick={exportClients} disabled={!data}>
              <DownloadIcon width="14" height="14" /> Clients CSV
            </button>
          </div>
        )}
      </div>
      {period === "custom" && (
        <div className="tp-custom">
          <label>
            <span>From</span>
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
          </label>
          <label>
            <span>To</span>
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
          </label>
        </div>
      )}
      <p className="card-subtitle" style={{ margin: "12px 0 0" }}>
        {rangeLabel}
        {qboOn
          ? qHours.loading
            ? " · Loading QuickBooks hours…"
            : ` · ${TP_fmtHM(qTotal)} in QuickBooks Time`
          : ""}
        {data ? (
          <span title={typeof TP_APP_TIP === "string" ? TP_APP_TIP : undefined}>
            {` · ${TP_fmtHM(appTotal)} active in the app (automatic, not billed)`}
          </span>
        ) : (
          " · Loading…"
        )}
      </p>
      {qboOn && qHours.error && (
        <div className="mock-banner" style={{ marginTop: 16, marginBottom: 0 }}>
          <WarningIcon />
          <span>{qHours.error}</span>
        </div>
      )}
      {errors.length > 0 && (
        <div className="mock-banner" style={{ marginTop: 16, marginBottom: 0 }}>
          <WarningIcon />
          <span>
            {errors.map((e, i) => (
              <span key={i} style={{ display: "block" }}>{e}</span>
            ))}
          </span>
        </div>
      )}
    </div>
  );

  const backToTeam = () => setView(null);
  const refreshQbo = () => setQboVersion((v) => v + 1);
  if (view && view.type === "mapping") {
    return (
      <TP_QboMapping
        qbo={qbo}
        clients={clients}
        staff={raw ? raw.staff : []}
        onBack={backToTeam}
        onChanged={refreshQbo}
      />
    );
  }
  if (view && view.type === "bucket" && qboOn) {
    const b = view.bucket;
    const isPerson = b.bucket === "no_person" || !!b.q.qbo_person_id;
    return (
      <div className="tp-page">
        {periodCard}
        <TP_QboDetail
          title={b.label}
          subtitle={[TP_Q_BUCKET_LABEL[b.bucket], rangeLabel].filter(Boolean).join(" · ")}
          spec={TP_qBucketSpec(b)}
          groupBy={isPerson ? "customer" : "person"}
          range={range}
          onBack={backToTeam}
          note={
            b.bucket === "unmapped" ? (
              <p className="tp-muted" style={{ marginTop: 14 }}>
                These hours aren't counted against any {isPerson ? "staff member" : "client"} yet.{" "}
                <button type="button" className="tp-q-link" onClick={() => setView({ type: "mapping" })}>
                  Open mapping
                </button>
              </p>
            ) : null
          }
        />
      </div>
    );
  }
  if (qPerson) {
    const q = qPerson.q;
    const mins = Number((q && q.total_minutes) || 0);
    const appEntries = data.appInPeriod.filter((e) => e.staff_email === qPerson.email);
    return (
      <div className="tp-page">
        {periodCard}
        <TP_QboDetail
          title={qPerson.name}
          subtitle={[qPerson.role && TP_roleLabel(qPerson.role), qPerson.email, rangeLabel]
            .filter(Boolean)
            .join(" · ")}
          stats={[
            ...(qboOn
              ? [
                  { label: "QB hours", value: TP_fmtHM(mins) },
                  { label: "Billable", value: mins ? `${Math.round((Number(q.billable_minutes || 0) / mins) * 100)}%` : "–" },
                ]
              : []),
            { label: "In app", value: TP_fmtHM(qPerson.appMinutes || 0) },
            { label: "Clients", value: qPerson.assignedCount + (qPerson.tempCount ? ` +${qPerson.tempCount}` : "") },
            { label: "Open tasks", value: qPerson.open },
            { label: "Overdue", value: qPerson.overdue, bad: qPerson.overdue > 0 },
            { label: "Completed", value: qPerson.completed },
          ]}
          spec={{ kind: "staff", email: qPerson.email }}
          groupBy="customer"
          range={range}
          onBack={backToTeam}
          showQbo={qboOn}
          beforeQbo={
            <TP_AppTimeCard
              entries={appEntries}
              groupBy="client"
              nameOf={clientName}
              range={range}
              who={qPerson.name}
            />
          }
        >
          <div className="card" style={{ marginBottom: 20 }}>
            <h3 className="card-title">Tasks</h3>
            <p className="card-subtitle">Owned by or assigned to {qPerson.name}.</p>
            <TP_TaskGroups
              tasks={(raw.tasks || []).filter((t) => TP_taskOwner(t) === qPerson.email)}
              today={today}
              range={range}
              clientName={clientName}
              emptyText="No open tasks, and nothing completed in this period."
            />
          </div>
        </TP_QboDetail>
      </div>
    );
  }
  if (qClientRow) {
    const r = qClientRow;
    const appEntries = data.appInPeriod.filter((e) => e.client_id === r.id);
    return (
      <div className="tp-page">
        {periodCard}
        <TP_QboDetail
          title={r.name}
          subtitle={[r.known ? `${planLabel(r.plan)} plan` : null, rangeLabel].filter(Boolean).join(" · ")}
          stats={[
            ...(qboOn
              ? [
                  { label: "QB hours", value: TP_fmtHM(r.qMinutes) },
                  { label: `Avg / mo (${avg.label})`, value: TP_fmtHM(r.qAvgMinutes) },
                ]
              : []),
            { label: "In app", value: TP_fmtHM(r.appMinutes || 0) },
            { label: "Fee / mo", value: r.fee != null ? fmtMoney(r.fee) : "–" },
            ...(qboOn ? [{ label: "Effective rate", value: r.rate != null ? `${fmtMoney(r.rate)}/h` : "–" }] : []),
            { label: "Open tasks", value: r.open },
            { label: "Overdue", value: r.overdue, bad: r.overdue > 0 },
          ]}
          note={
            r.trend ? (
              <p className="tp-muted" style={{ marginTop: 14 }}>
                <TP_QTrend trend={r.trend} /> This period is on pace for {TP_fmtHM(r.monthlyEq)} a month.
              </p>
            ) : null
          }
          spec={{ kind: "client", clientId: r.id }}
          groupBy="person"
          range={range}
          onBack={backToTeam}
          showQbo={qboOn}
          beforeQbo={
            <TP_AppTimeCard entries={appEntries} groupBy="staff" nameOf={staffName} range={range} />
          }
        >
          <div className="card" style={{ marginBottom: 20 }}>
            <h3 className="card-title">Tasks</h3>
            <TP_TaskGroups
              tasks={(raw.tasks || []).filter((t) => t.client_id === r.id)}
              today={today}
              range={range}
              ownerName={staffName}
              emptyText="No open tasks for this client, and nothing completed in this period."
            />
          </div>
        </TP_QboDetail>
      </div>
    );
  }

  const openMapping = () => setView({ type: "mapping" });
  return (
    <div className="tp-page">
      <TP_QboPanel qbo={qbo} onOpenMapping={openMapping} onSynced={refreshQbo} />
      {periodCard}
      <TP_QboPeopleTable
        people={data ? data.people : null}
        hours={qHours}
        qboOn={qboOn}
        onOpenPerson={(email) => setView({ type: "person", key: email })}
        onOpenBucket={(b) => setView({ type: "bucket", key: b.key, bucket: b })}
        onOpenMapping={openMapping}
      />
      <TP_QboClientsTable
        clientRows={data ? data.clientRows : null}
        hours={qHours}
        qboOn={qboOn}
        range={range}
        today={today}
        avg={avg}
        onOpenClient={(id) => setView({ type: "client", key: id })}
        onOpenBucket={(b) => setView({ type: "bucket", key: b.key, bucket: b })}
        onOpenMapping={openMapping}
      />
    </div>
  );
}
