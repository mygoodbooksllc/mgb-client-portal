// ----------------------------------------------------------------------------
// Team page (admin only, owner request 2026-09-29). Hours and tasks by person
// and by client for a chosen period, so an admin can see who has what open or
// overdue, what got done, and how many hours each client really takes (for
// pricing, and to spot a bookkeeper working slowly).
//
// Read-only. Everything is fetched raw and aggregated client-side, the same
// approach as Usage Stats:
//   - time_entries: admins already read every row.
//   - staff_reminders: admins read every row, private ones included, once
//     supabase/admin-read-all-tasks.sql is applied. Until then RLS returns
//     only the admin's own and shared tasks, and the page shows just that.
//   - staff, staff_client_access, staff_client_access_grants: roster and
//     assignments, as Staff Access and the client switcher load them.
// Every query fails soft: no Supabase, a 401 (local, signed out) or a missing
// table leaves that slice empty and shows a friendly note instead.
//
// QuickBooks Time (the firm's own QuickBooks company, supabase/qbo-firm-time.sql)
// lives in TeamQbo.jsx: the connection panel, customer/staff mapping, and the
// QuickBooks versions of the People and Clients tables. When QuickBooks has
// data the page defaults to it; an "App hours" toggle brings back the
// time_entries tables below unchanged.
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
const TP_ENTRY_COLS =
  "id, staff_email, client_id, minutes, description, entry_date, created_at, billable";
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
// directly without Supabase.
function TP_aggregate({ staff, entries, tasks, access, grants, clients, range, avg, today }) {
  const staffByEmail = {};
  (staff || []).forEach((s) => {
    staffByEmail[TP_lower(s.email)] = s;
  });
  const clientById = {};
  (clients || []).forEach((c) => {
    clientById[c.id] = c;
  });

  const inPeriod = (entries || []).filter(
    (e) => e.entry_date >= range.from && e.entry_date <= range.to,
  );
  const inAvg = (entries || []).filter(
    (e) => e.entry_date >= avg.from && e.entry_date <= avg.to,
  );

  // People: active staff; if the roster didn't load, whoever shows up in
  // the time and task data.
  let emails = (staff || [])
    .filter((s) => s.active !== false)
    .map((s) => TP_lower(s.email));
  if (!emails.length) {
    const seen = new Set();
    inPeriod.forEach((e) => seen.add(TP_lower(e.staff_email)));
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
    const mine = inPeriod.filter((e) => TP_lower(e.staff_email) === email);
    const minutes = mine.reduce((n, e) => n + (e.minutes || 0), 0);
    const billableMinutes = mine
      .filter((e) => e.billable !== false)
      .reduce((n, e) => n + (e.minutes || 0), 0);
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
      minutes,
      billableMinutes,
      ...counts,
      assignedCount: assigned[email] ? assigned[email].size : 0,
      tempCount: temp[email] ? temp[email].size : 0,
    };
  });
  people.sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name));

  // Clients: the whole roster, plus any id the data mentions that the
  // roster doesn't (a removed client with old time on it).
  const ids = new Set((clients || []).map((c) => c.id));
  inPeriod.forEach((e) => e.client_id && ids.add(e.client_id));
  (tasks || []).forEach((t) => !t.done && t.client_id && ids.add(t.client_id));
  const clientRows = [...ids].map((id) => {
    const c = clientById[id];
    const mine = inPeriod.filter((e) => e.client_id === id);
    const byStaff = {};
    mine.forEach((e) => {
      const k = TP_lower(e.staff_email);
      byStaff[k] = (byStaff[k] || 0) + (e.minutes || 0);
    });
    const avgTotal = inAvg
      .filter((e) => e.client_id === id)
      .reduce((n, e) => n + (e.minutes || 0), 0);
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
      minutes: mine.reduce((n, e) => n + (e.minutes || 0), 0),
      billableMinutes: mine
        .filter((e) => e.billable !== false)
        .reduce((n, e) => n + (e.minutes || 0), 0),
      byStaff: Object.entries(byStaff)
        .map(([email, minutes]) => ({ email, minutes }))
        .sort((a, b) => b.minutes - a.minutes),
      avgMinutes: avgTotal / 3,
      open,
      overdue,
    };
  });

  return { people, clientRows, inPeriod, staffByEmail, clientById };
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

function TP_PersonDetail({ person, data, tasks, range, avg, today, onBack, rangeLabel }) {
  const clientName = (id) =>
    (data.clientById[id] && data.clientById[id].name) || "Unknown client";
  const entries = useMemo(
    () =>
      data.inPeriod
        .filter((e) => TP_lower(e.staff_email) === person.email)
        .sort((a, b) => b.entry_date.localeCompare(a.entry_date) ||
          String(b.created_at || "").localeCompare(String(a.created_at || ""))),
    [data, person.email],
  );
  const byClient = useMemo(() => {
    const totals = {};
    entries.forEach((e) => {
      totals[e.client_id] = (totals[e.client_id] || 0) + (e.minutes || 0);
    });
    const rowById = {};
    data.clientRows.forEach((r) => {
      rowById[r.id] = r;
    });
    return Object.entries(totals)
      .map(([id, minutes]) => ({ id, minutes, row: rowById[id] }))
      .sort((a, b) => b.minutes - a.minutes);
  }, [entries, data]);
  const myTasks = useMemo(
    () => (tasks || []).filter((t) => TP_taskOwner(t) === person.email),
    [tasks, person.email],
  );
  const maxClient = byClient.length ? byClient[0].minutes : 0;
  const billablePct = person.minutes
    ? Math.round((person.billableMinutes / person.minutes) * 100)
    : null;

  return (
    <div>
      <div className="card" style={{ marginBottom: 20 }}>
        <TP_BackBar
          label="Back to team"
          onBack={onBack}
          title={person.name}
          subtitle={[person.role && TP_roleLabel(person.role), person.email, rangeLabel]
            .filter(Boolean)
            .join(" · ")}
        />
        <div className="tp-stats">
          <TP_Stat label="Hours" value={TP_fmtHM(person.minutes)} />
          <TP_Stat label="Billable" value={billablePct == null ? "–" : `${billablePct}%`} />
          <TP_Stat label="Open tasks" value={person.open} />
          <TP_Stat label="Overdue" value={person.overdue} bad={person.overdue > 0} />
          <TP_Stat label="Completed" value={person.completed} />
          <TP_Stat
            label="Clients"
            value={person.assignedCount + (person.tempCount ? ` +${person.tempCount}` : "")}
          />
        </div>
      </div>

      <div className="tp-detail-grid">
        <div className="card">
          <h3 className="card-title">Hours by client</h3>
          <p className="card-subtitle">
            Share is this person's part of all hours logged on the client in the period.
          </p>
          <div className="table-scroll">
            <table className="tx-table tx-table-labeled">
              <thead>
                <tr>
                  <th>Client</th>
                  <th className="num">Hours</th>
                  <th className="num">Share</th>
                  <th className="num">Client avg / mo</th>
                </tr>
              </thead>
              <tbody>
                {byClient.length === 0 ? (
                  <EmptyRow colSpan={4}>No time logged in this period.</EmptyRow>
                ) : (
                  byClient.map((c) => (
                    <tr key={c.id}>
                      <td data-primary="">
                        {clientName(c.id)}
                        <div className="bar-track">
                          <div
                            className="bar-fill usage"
                            style={{ width: maxClient ? `${(c.minutes / maxClient) * 100}%` : "0%" }}
                          />
                        </div>
                      </td>
                      <td className="num" data-label="Hours">{TP_fmtHM(c.minutes)}</td>
                      <td className="num" data-label="Share">
                        {c.row && c.row.minutes
                          ? `${Math.round((c.minutes / c.row.minutes) * 100)}%`
                          : "–"}
                      </td>
                      <td className="num" data-label={`Client avg / mo (${avg.label})`}>
                        {c.row ? TP_fmtHM(c.row.avgMinutes) : "–"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <h3 className="card-title">Hours over the period</h3>
          <TP_HoursBars entries={entries} range={range} />
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 className="card-title">Tasks</h3>
        <p className="card-subtitle">Owned by or assigned to {person.name}.</p>
        <TP_TaskGroups
          tasks={myTasks}
          today={today}
          range={range}
          clientName={clientName}
          emptyText="No open tasks, and nothing completed in this period."
        />
      </div>

      <div className="card">
        <h3 className="card-title">Time log</h3>
        <p className="card-subtitle">
          {entries.length} entr{entries.length === 1 ? "y" : "ies"} in the period
        </p>
        <TP_EntryTable entries={entries} clientName={clientName} />
      </div>
    </div>
  );
}

function TP_EntryTable({ entries, clientName, staffName }) {
  return (
    <div className="table-scroll">
      <table className="tx-table tx-table-labeled">
        <thead>
          <tr>
            <th>Date</th>
            {clientName && <th>Client</th>}
            {staffName && <th>Staffer</th>}
            <th>Description</th>
            <th className="num">Hours</th>
            <th>Billable</th>
          </tr>
        </thead>
        <tbody>
          {entries.length === 0 ? (
            <EmptyRow colSpan={5}>No time logged in this period.</EmptyRow>
          ) : (
            entries.map((e) => (
              <tr key={e.id}>
                <td data-label="Date">{fmtDate(e.entry_date)}</td>
                {clientName && <td data-label="Client">{clientName(e.client_id)}</td>}
                {staffName && <td data-label="Staffer">{staffName(e.staff_email)}</td>}
                <td data-label="Description" className="tp-desc">
                  {e.description || <span className="tp-muted">No description</span>}
                </td>
                <td className="num" data-label="Hours">{TP_fmtHM(e.minutes)}</td>
                <td data-label="Billable">{e.billable === false ? "No" : "Yes"}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function TP_ClientDetail({ row, data, tasks, range, avg, today, onBack, rangeLabel }) {
  const staffName = (email) => {
    const s = data.staffByEmail[TP_lower(email)];
    return (s && s.name) || String(email || "").split("@")[0] || "Unknown";
  };
  const entries = useMemo(
    () =>
      data.inPeriod
        .filter((e) => e.client_id === row.id)
        .sort((a, b) => b.entry_date.localeCompare(a.entry_date) ||
          String(b.created_at || "").localeCompare(String(a.created_at || ""))),
    [data, row.id],
  );
  const clientTasks = useMemo(
    () => (tasks || []).filter((t) => t.client_id === row.id),
    [tasks, row.id],
  );
  const maxStaff = row.byStaff.length ? row.byStaff[0].minutes : 0;

  return (
    <div>
      <div className="card" style={{ marginBottom: 20 }}>
        <TP_BackBar
          label="Back to team"
          onBack={onBack}
          title={row.name}
          subtitle={[row.known ? `${planLabel(row.plan)} plan` : null, rangeLabel]
            .filter(Boolean)
            .join(" · ")}
        />
        <div className="tp-stats">
          <TP_Stat label="Hours" value={TP_fmtHM(row.minutes)} />
          <TP_Stat label="Billable hours" value={TP_fmtHM(row.billableMinutes)} />
          <TP_Stat label={`Avg / mo (${avg.label})`} value={TP_fmtHM(row.avgMinutes)} />
          <TP_Stat label="Open tasks" value={row.open} />
          <TP_Stat label="Overdue" value={row.overdue} bad={row.overdue > 0} />
        </div>
      </div>

      <div className="tp-detail-grid">
        <div className="card">
          <h3 className="card-title">Hours by staffer</h3>
          {row.byStaff.length === 0 ? (
            <p className="card-subtitle">No time logged in this period.</p>
          ) : (
            <div className="tp-staff-bars">
              {row.byStaff.map((s) => (
                <div key={s.email}>
                  <div className="tp-staff-bar-head">
                    <span>{staffName(s.email)}</span>
                    <span className="tp-muted">{TP_fmtHM(s.minutes)}</span>
                  </div>
                  <div className="bar-track">
                    <div
                      className="bar-fill usage"
                      style={{ width: maxStaff ? `${(s.minutes / maxStaff) * 100}%` : "0%" }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="card">
          <h3 className="card-title">Hours over the period</h3>
          <TP_HoursBars entries={entries} range={range} />
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 className="card-title">Tasks</h3>
        <TP_TaskGroups
          tasks={clientTasks}
          today={today}
          range={range}
          ownerName={staffName}
          emptyText="No open tasks for this client, and nothing completed in this period."
        />
      </div>

      <div className="card">
        <h3 className="card-title">Time entries</h3>
        <p className="card-subtitle">
          {entries.length} entr{entries.length === 1 ? "y" : "ies"} in the period
        </p>
        <TP_EntryTable entries={entries} staffName={staffName} />
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
  const [view, setView] = useState(null); // { type: "person"|"client", key }
  const [clientSort, setClientSort] = useState({ key: "hours", dir: "desc" });
  const [showIdleClients, setShowIdleClients] = useState(false);
  // QuickBooks Time (TeamQbo.jsx). Hours default to QuickBooks whenever it
  // has data; "App" keeps the in-app time_entries view.
  const qbo = TP_useQboStatus();
  const [source, setSource] = useState(null);
  const [qboVersion, setQboVersion] = useState(0);

  const range = useMemo(
    () => TP_periodRange(period, customFrom, customTo),
    [period, customFrom, customTo],
  );
  const avg = useMemo(() => TP_avgRange(), []);
  const today = TP_ymd(new Date());
  const src = qbo.available ? source || "qbo" : "app";
  const qHours = TP_useQboHours(src === "qbo", range, avg, qboVersion);
  const rangeLabel =
    range.from === range.to
      ? fmtDate(range.from)
      : `${fmtDate(range.from)} to ${fmtDate(range.to)}`;

  // One fetch window covers both the period and the 3-month average.
  const fetchFrom = range.from < avg.from ? range.from : avg.from;
  const fetchTo = range.to > avg.to ? range.to : avg.to;

  const load = useCallback(async () => {
    if (!supabase) {
      setErrors(["Supabase isn't configured, so there's nothing to show here."]);
      setRaw({ staff: [], entries: [], tasks: [], access: [], grants: [] });
      return;
    }
    setRaw(null);
    const errs = [];
    const nowIso = new Date().toISOString();
    const periodStartIso = TP_parseYmd(range.from).toISOString();

    const staffP = TP_fetchAll(() =>
      supabase.from("staff").select("email, name, role, active").order("email"),
    );
    const entriesP = TP_fetchAll(() =>
      supabase
        .from("time_entries")
        .select(TP_ENTRY_COLS)
        .gte("entry_date", fetchFrom)
        .lte("entry_date", fetchTo)
        .order("id"),
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

    const [staffR, entriesR, tasksR, accessR, grantsR] = await Promise.all([
      staffP,
      entriesP,
      tasksP,
      accessP,
      grantsP,
    ]);
    if (staffR.error) errs.push(TP_friendlyError("the staff list", staffR.error));
    if (entriesR.error) errs.push(TP_friendlyError("time entries", entriesR.error));
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
      entries: entriesR.data || [],
      tasks,
      access: accessR.data || [],
      grants: grantsR.data || [],
    });
  }, [supabase, range.from, fetchFrom, fetchTo]);

  useEffect(() => {
    load();
  }, [load]);

  const data = useMemo(() => {
    if (!raw) return null;
    return TP_aggregate({ ...raw, clients, range, avg, today });
  }, [raw, clients, range, avg, today]);

  const staffShortName = (email) => {
    const s = data && data.staffByEmail[email];
    const name = (s && s.name) || email.split("@")[0];
    return name.split(" ")[0];
  };

  const clientRows = useMemo(() => {
    if (!data) return [];
    const rows = showIdleClients
      ? data.clientRows
      : data.clientRows.filter((r) => r.minutes || r.avgMinutes || r.open);
    const dir = clientSort.dir === "asc" ? 1 : -1;
    const val = {
      hours: (r) => r.minutes,
      avg: (r) => r.avgMinutes,
      name: (r) => r.name.toLowerCase(),
    }[clientSort.key];
    return [...rows].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      if (x < y) return -1 * dir;
      if (x > y) return 1 * dir;
      return a.name.localeCompare(b.name);
    });
  }, [data, clientSort, showIdleClients]);

  function toggleSort(key) {
    setClientSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "name" ? "asc" : "desc" },
    );
  }
  const sortMark = (key) =>
    clientSort.key === key ? (clientSort.dir === "asc" ? " ↑" : " ↓") : "";

  const fileSuffix = `${range.from}_to_${range.to}`;
  function exportPeople() {
    if (!data) return;
    if (src === "qbo") {
      TP_qExportPeople(`team_people_quickbooks_${fileSuffix}.csv`, data.people, qHours.byStaff);
      return;
    }
    TP_downloadCsv(
      `team_people_${fileSuffix}.csv`,
      ["Name", "Email", "Role", "Hours", "Billable hours", "Billable %", "Open tasks", "Overdue tasks", "Completed in period", "Assigned clients", "Temporary clients"],
      data.people.map((p) => [
        p.name,
        p.email,
        TP_roleLabel(p.role),
        (p.minutes / 60).toFixed(2),
        (p.billableMinutes / 60).toFixed(2),
        p.minutes ? Math.round((p.billableMinutes / p.minutes) * 100) : "",
        p.open,
        p.overdue,
        p.completed,
        p.assignedCount,
        p.tempCount,
      ]),
    );
  }
  function exportClients() {
    if (!data) return;
    if (src === "qbo") {
      TP_qExportClients(
        `team_clients_quickbooks_${fileSuffix}.csv`,
        { clientRows: data.clientRows, hours: qHours, range, today },
        avg.label,
      );
      return;
    }
    TP_downloadCsv(
      `team_clients_${fileSuffix}.csv`,
      ["Client", "Plan", "Hours", "Billable hours", `Avg hours / month (${avg.label})`, "Hours by staffer", "Open tasks", "Overdue tasks"],
      clientRows.map((r) => [
        r.name,
        r.known ? planLabel(r.plan) : "",
        (r.minutes / 60).toFixed(2),
        (r.billableMinutes / 60).toFixed(2),
        (r.avgMinutes / 60).toFixed(2),
        r.byStaff.map((s) => `${staffShortName(s.email)} ${(s.minutes / 60).toFixed(2)}`).join("; "),
        r.open,
        r.overdue,
      ]),
    );
  }

  const person =
    view && view.type === "person" && data && src === "app"
      ? data.people.find((p) => p.email === view.key)
      : null;
  const qPerson =
    view && view.type === "person" && data && src === "qbo"
      ? TP_qPeopleRows(data.people, qHours.byStaff).rows.find((p) => p.email === view.key)
      : null;
  const clientRow =
    view && view.type === "client" && data && src === "app"
      ? data.clientRows.find((r) => r.id === view.key)
      : null;
  const qClientRow =
    view && view.type === "client" && data && src === "qbo"
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
        {qbo.available && (
          <div className="modal-tabs tp-q-source" style={{ marginTop: 0 }} role="group" aria-label="Hours source">
            {[
              ["qbo", "QuickBooks hours"],
              ["app", "App hours"],
            ].map(([k, l]) => (
              <button
                key={k}
                type="button"
                className={"modal-tab" + (src === k ? " active" : "")}
                aria-pressed={src === k}
                onClick={() => setSource(k)}
              >
                {l}
              </button>
            ))}
          </div>
        )}
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
        {src === "qbo"
          ? qHours.loading
            ? " · Loading QuickBooks hours…"
            : ` · ${TP_fmtHM(qHours.byClient.reduce((n, r) => n + Number(r.total_minutes || 0), 0))} in QuickBooks Time`
          : data
            ? ` · ${TP_fmtHM(data.inPeriod.reduce((n, e) => n + (e.minutes || 0), 0))} logged in the app`
            : " · Loading…"}
      </p>
      {src === "qbo" && qHours.error && (
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
  if (view && view.type === "bucket" && src === "qbo") {
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
    return (
      <div className="tp-page">
        {periodCard}
        <TP_QboDetail
          title={qPerson.name}
          subtitle={[qPerson.role && TP_roleLabel(qPerson.role), qPerson.email, rangeLabel]
            .filter(Boolean)
            .join(" · ")}
          stats={[
            { label: "Billable", value: mins ? `${Math.round((Number(q.billable_minutes || 0) / mins) * 100)}%` : "–" },
            { label: "Clients", value: q ? Number(q.client_count || 0) : 0 },
            { label: "Open tasks", value: qPerson.open },
            { label: "Overdue", value: qPerson.overdue, bad: qPerson.overdue > 0 },
            { label: "Completed", value: qPerson.completed },
          ]}
          spec={{ kind: "staff", email: qPerson.email }}
          groupBy="customer"
          range={range}
          onBack={backToTeam}
        >
          <div className="card" style={{ marginBottom: 20 }}>
            <h3 className="card-title">Tasks</h3>
            <p className="card-subtitle">Owned by or assigned to {qPerson.name}.</p>
            <TP_TaskGroups
              tasks={(raw.tasks || []).filter((t) => TP_taskOwner(t) === qPerson.email)}
              today={today}
              range={range}
              clientName={(id) => (data.clientById[id] && data.clientById[id].name) || "Unknown client"}
              emptyText="No open tasks, and nothing completed in this period."
            />
          </div>
        </TP_QboDetail>
      </div>
    );
  }
  if (qClientRow) {
    const r = qClientRow;
    const staffName = (email) => {
      const s = data.staffByEmail[TP_lower(email)];
      return (s && s.name) || String(email || "").split("@")[0] || "Unknown";
    };
    return (
      <div className="tp-page">
        {periodCard}
        <TP_QboDetail
          title={r.name}
          subtitle={[r.known ? `${planLabel(r.plan)} plan` : null, rangeLabel].filter(Boolean).join(" · ")}
          stats={[
            { label: `Avg / mo (${avg.label})`, value: TP_fmtHM(r.qAvgMinutes) },
            { label: "Fee / mo", value: r.fee != null ? fmtMoney(r.fee) : "–" },
            { label: "Effective rate", value: r.rate != null ? `${fmtMoney(r.rate)}/h` : "–" },
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

  if (person) {
    return (
      <div className="tp-page">
        {periodCard}
        <TP_PersonDetail
          person={person}
          data={data}
          tasks={raw.tasks}
          range={range}
          avg={avg}
          today={today}
          rangeLabel={rangeLabel}
          onBack={() => setView(null)}
        />
      </div>
    );
  }
  if (clientRow) {
    return (
      <div className="tp-page">
        {periodCard}
        <TP_ClientDetail
          row={clientRow}
          data={data}
          tasks={raw.tasks}
          range={range}
          avg={avg}
          today={today}
          rangeLabel={rangeLabel}
          onBack={() => setView(null)}
        />
      </div>
    );
  }

  const openRow = (type, key) => () => setView({ type, key });
  const rowKeys = (type, key) => (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setView({ type, key });
    }
  };

  const openMapping = () => setView({ type: "mapping" });
  const qboPanel = (
    <TP_QboPanel qbo={qbo} onOpenMapping={openMapping} onSynced={refreshQbo} />
  );
  if (src === "qbo") {
    return (
      <div className="tp-page">
        {qboPanel}
        {periodCard}
        <TP_QboPeopleTable
          people={data ? data.people : []}
          hours={qHours}
          onOpenPerson={(email) => setView({ type: "person", key: email })}
          onOpenBucket={(b) => setView({ type: "bucket", key: b.key, bucket: b })}
          onOpenMapping={openMapping}
        />
        <TP_QboClientsTable
          clientRows={data ? data.clientRows : []}
          hours={qHours}
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

  return (
    <div className="tp-page">
      {qboPanel}
      {periodCard}

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 className="card-title">People</h3>
        <p className="card-subtitle">
          Hours logged in the app for the period. Open and overdue are as of today; completed is within the period. Select a person for details.
        </p>
        <div className="table-scroll">
          <table className="tx-table tx-table-labeled tp-table">
            <thead>
              <tr>
                <th>Name</th>
                <th className="num">Hours</th>
                <th className="num">Billable</th>
                <th className="num">Open</th>
                <th className="num">Overdue</th>
                <th className="num">Completed</th>
                <th className="num">Clients</th>
              </tr>
            </thead>
            <tbody>
              {!data ? (
                <EmptyRow colSpan={7}>Loading…</EmptyRow>
              ) : data.people.length === 0 ? (
                <EmptyRow colSpan={7}>
                  No staff to show. The roster only loads for a signed-in admin.
                </EmptyRow>
              ) : (
                data.people.map((p) => (
                  <tr
                    key={p.email}
                    className="tp-row"
                    tabIndex={0}
                    role="button"
                    aria-label={`Open ${p.name}`}
                    onClick={openRow("person", p.email)}
                    onKeyDown={rowKeys("person", p.email)}
                  >
                    <td data-primary="">
                      <span className="tp-name">{p.name}</span>
                      {p.role && <span className="tp-muted tp-role">{TP_roleLabel(p.role)}</span>}
                    </td>
                    <td className="num" data-label="Hours">{TP_fmtHM(p.minutes)}</td>
                    <td className="num" data-label="Billable">
                      {p.minutes ? `${Math.round((p.billableMinutes / p.minutes) * 100)}%` : "–"}
                    </td>
                    <td className="num" data-label="Open">{p.open}</td>
                    <td className={"num" + (p.overdue ? " tp-bad" : "")} data-label="Overdue">
                      {p.overdue}
                    </td>
                    <td className="num" data-label="Completed">{p.completed}</td>
                    <td className="num" data-label="Clients">
                      {p.assignedCount}
                      {p.tempCount > 0 && (
                        <span className="tp-muted tp-temp"> +{p.tempCount} temporary</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="tp-card-head">
          <div>
            <h3 className="card-title" style={{ marginBottom: 2 }}>Clients</h3>
            <p className="card-subtitle" style={{ margin: 0 }}>
              App-logged hours next to the monthly average for {avg.label}. Select a client for details.
            </p>
          </div>
          <label className="tp-check">
            <input
              type="checkbox"
              checked={showIdleClients}
              onChange={(e) => setShowIdleClients(e.target.checked)}
            />
            Show clients with no activity
          </label>
        </div>
        <div className="tp-sort-mobile">
          <span className="tp-muted">Sort by</span>
          {[
            ["hours", "Hours"],
            ["avg", "Avg / mo"],
            ["name", "Name"],
          ].map(([k, l]) => (
            <button
              key={k}
              type="button"
              className={"task-chip tp-sort-chip" + (clientSort.key === k ? " active" : "")}
              onClick={() => toggleSort(k)}
            >
              {l}
              {sortMark(k)}
            </button>
          ))}
        </div>
        <div className="table-scroll">
          <table className="tx-table tx-table-labeled tp-table">
            <thead>
              <tr>
                <th>
                  <button type="button" className="tp-sort" onClick={() => toggleSort("name")}>
                    Client{sortMark("name")}
                  </button>
                </th>
                <th>Plan</th>
                <th className="num">
                  <button type="button" className="tp-sort" onClick={() => toggleSort("hours")}>
                    Hours{sortMark("hours")}
                  </button>
                </th>
                <th className="num">
                  <button type="button" className="tp-sort" onClick={() => toggleSort("avg")}>
                    Avg / mo{sortMark("avg")}
                  </button>
                </th>
                <th className="num">Billable</th>
                <th>By staffer</th>
                <th className="num">Open</th>
                <th className="num">Overdue</th>
              </tr>
            </thead>
            <tbody>
              {!data ? (
                <EmptyRow colSpan={8}>Loading…</EmptyRow>
              ) : clientRows.length === 0 ? (
                <EmptyRow colSpan={8}>
                  {showIdleClients ? "No clients to show." : "No client activity in this period."}
                </EmptyRow>
              ) : (
                clientRows.map((r) => (
                  <tr
                    key={r.id}
                    className="tp-row"
                    tabIndex={0}
                    role="button"
                    aria-label={`Open ${r.name}`}
                    onClick={openRow("client", r.id)}
                    onKeyDown={rowKeys("client", r.id)}
                  >
                    <td data-primary="">
                      <span className="tp-name">{r.name}</span>
                    </td>
                    <td data-label="Plan">{r.known ? planLabel(r.plan) : "–"}</td>
                    <td className="num" data-label="Hours">{TP_fmtHM(r.minutes)}</td>
                    <td className="num" data-label={`Avg / mo (${avg.label})`}>
                      {TP_fmtHM(r.avgMinutes)}
                    </td>
                    <td className="num" data-label="Billable">{TP_fmtHM(r.billableMinutes)}</td>
                    <td data-label="By staffer" className="tp-split">
                      {r.byStaff.length === 0 ? (
                        <span className="tp-muted">–</span>
                      ) : (
                        r.byStaff.map((s) => (
                          <span key={s.email} className="tp-split-item">
                            {staffShortName(s.email)} <b>{TP_fmtHM(s.minutes)}</b>
                          </span>
                        ))
                      )}
                    </td>
                    <td className="num" data-label="Open">{r.open}</td>
                    <td className={"num" + (r.overdue ? " tp-bad" : "")} data-label="Overdue">
                      {r.overdue}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
