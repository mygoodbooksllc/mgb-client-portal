// Firm deadline calendar (owner request 2026-10-07). Staff only.
//
// Tables (supabase/firm-deadlines.sql): firm_deadline_rules (admins edit),
// client_deadline_overrides (per-client skip / different date / opt-in) and
// client_deadline_status ("Mark filed"; undo sets undone_at). The older key
// dates on client_profile (form_990_due, filing_1099_due) are read as date
// overrides and never changed here. Dates are worked out in staffOpsLogic.js
// (OPS_deadlineItems). The seeded dates are a starting point to verify, not
// tax or legal advice.
//
//   DL_DeadlinesPage        Work → Deadlines (#/work/deadlines, all staff): list and month views,
//                           mine/all, form filter, Mark filed, Create task,
//                           rules (admins edit) and client exceptions.
//   DL_UpcomingDeadlinesBody Home card "Upcoming deadlines" (next 30 days).

const DL_SETUP_MSG = "Deadlines aren't set up yet (database step pending).";
const DL_VERIFY_TEXT =
  "These dates are a starting point. Verify each one before filing: this isn't tax or legal advice. Weekends move to Monday; holidays don't.";

// ---- Shared store: rules, overrides, filings, profiles, tasks already made
const DL_store = { data: null, error: null, promise: null, subs: new Set(), listening: false };

function DL_emit() {
  DL_store.subs.forEach((fn) => {
    try {
      fn();
    } catch (e) {}
  });
}

function DL_errMsg(error, fallback) {
  if (!error) return null;
  return typeof isMissingTableError === "function" && isMissingTableError(error) ? DL_SETUP_MSG : error.message || fallback;
}

function DL_load(force) {
  const sb = window.mgbSupabase;
  if (!sb) return Promise.resolve();
  if (!force && (DL_store.data || DL_store.promise)) return DL_store.promise || Promise.resolve();
  const q = (p) => p.then((r) => r, (e) => ({ data: null, error: e || { message: "Network error" } }));
  DL_store.promise = Promise.all([
    q(sb.from("firm_deadline_rules").select("*").order("sort", { ascending: true }).order("name", { ascending: true })),
    q(sb.from("client_deadline_overrides").select("*").is("removed_at", null)),
    q(sb.from("client_deadline_status").select("*").is("undone_at", null)),
    q(sb.from("client_profile").select("client_id, fiscal_year_end, form_990_due, filing_1099_due")),
    q(sb.from("staff_reminders").select("source_ref").eq("source", "deadline")),
  ]).then(([rules, ovr, st, prof, tasks]) => {
    DL_store.promise = null;
    const err = rules.error || ovr.error || st.error;
    if (err) {
      DL_store.error = DL_errMsg(err, "Couldn't load deadlines.");
      DL_store.data = { rules: [], overrides: [], statuses: [], profiles: {}, taskRefs: new Set() };
    } else {
      const profiles = {};
      (prof.data || []).forEach((p) => {
        profiles[p.client_id] = p;
      });
      DL_store.error = null;
      DL_store.data = {
        rules: rules.data || [],
        overrides: ovr.data || [],
        statuses: st.data || [],
        profiles,
        taskRefs: new Set((tasks.data || []).map((t) => t.source_ref).filter(Boolean)),
      };
    }
    DL_emit();
  });
  return DL_store.promise;
}

function DL_useStore(enabled) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const fn = () => setTick((t) => t + 1);
    DL_store.subs.add(fn);
    DL_load(false);
    if (!DL_store.listening) {
      DL_store.listening = true;
      window.addEventListener(STAFF_TOOLS_EVENT, () => {
        if (DL_store.subs.size) DL_load(true);
      });
    }
    return () => {
      DL_store.subs.delete(fn);
    };
  }, [enabled]);
  const d = DL_store.data;
  return {
    loading: !d,
    error: DL_store.error,
    rules: (d && d.rules) || [],
    overrides: (d && d.overrides) || [],
    statuses: (d && d.statuses) || [],
    profiles: (d && d.profiles) || {},
    taskRefs: (d && d.taskRefs) || new Set(),
  };
}

function DL_items(st, clients, from, to) {
  return OPS_deadlineItems({
    rules: st.rules,
    clients: clients || [],
    profiles: st.profiles,
    overrides: st.overrides,
    statuses: st.statuses,
    from,
    to,
    today: todayLocal(),
  });
}

const DL_STATE = {
  overdue: { label: "Overdue", tone: "bad" },
  soon: { label: "Due soon", tone: "warn" },
  upcoming: { label: "Coming up", tone: "plain" },
  filed: { label: "Filed", tone: "good" },
};

function DL_clientHref(id) {
  return "#/client/" + encodeURIComponent(id) + "/overview";
}

function DL_dueText(it) {
  const parts = [fmtDate(it.due)];
  if (it.rolled) parts.push("(moved from " + fmtDate(it.nominal) + ", a weekend)");
  return parts.join(" ");
}

function DL_sourceText(it) {
  if (it.source === "override") return "Date set for this client";
  if (it.source === "key-dates") return "Date from the client's key dates";
  if (it.assumed) return "No fiscal year end set, so May 15 is assumed";
  return null;
}

// ---- Row actions: Mark filed / Undo, Create task
function DL_FiledControl({ it }) {
  const showToast = useToast();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  async function file() {
    setBusy(true);
    const { error } = await window.mgbSupabase.from("client_deadline_status").insert({
      client_id: it.client_id,
      rule_key: it.rule_key,
      period_key: it.period_key,
      due_date: it.due,
      note: note.trim() || null,
    });
    setBusy(false);
    if (error) return showToast("Couldn't mark it filed: " + (DL_errMsg(error, "error") || ""));
    showToast("Marked filed");
    setOpen(false);
    setNote("");
    DL_load(true);
  }
  async function undo() {
    setBusy(true);
    const { error } = await window.mgbSupabase
      .from("client_deadline_status")
      .update({ undone_at: new Date().toISOString() })
      .eq("id", it.status.id);
    setBusy(false);
    if (error) return showToast("Couldn't undo: " + (error.message || "error"));
    showToast("Back to not filed");
    DL_load(true);
  }
  if (it.status)
    return (
      <span className="dl-filed">
        <span className="dl-muted">
          Filed {it.status.filed_at ? fmtDate(String(it.status.filed_at).slice(0, 10)) : ""}
          {it.status.filed_by ? " by " + String(it.status.filed_by).split("@")[0] : ""}
          {it.status.note ? " · " + it.status.note : ""}
        </span>
        <button type="button" className="link-btn" disabled={busy} onClick={undo}>
          Undo
        </button>
      </span>
    );
  if (!open)
    return (
      <button type="button" className="btn-secondary dl-btn" onClick={() => setOpen(true)}>
        Mark filed
      </button>
    );
  return (
    <span className="dl-file-form">
      <input
        type="text"
        maxLength={300}
        value={note}
        placeholder="Note (optional), e.g. e-filed, confirmation #"
        aria-label="Filing note"
        onChange={(e) => setNote(e.target.value)}
      />
      <button type="button" className="btn-primary dl-btn" disabled={busy} onClick={file}>
        {busy ? "Saving…" : "Save"}
      </button>
      <button type="button" className="link-btn" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </span>
  );
}

function DL_TaskButton({ it, made }) {
  const ctx = useContext(StaffToolsContext) || {};
  const me = ctx.staffUser && ctx.staffUser.email;
  const showToast = useToast();
  const [busy, setBusy] = useState(false);
  if (typeof staffItemsApi === "undefined" || !me || it.status) return null;
  if (made) return <span className="dl-muted">Task added</span>;
  async function go() {
    setBusy(true);
    const label = it.period_label ? " (" + it.period_label + ")" : "";
    const res = await staffItemsApi.add(window.mgbSupabase, me, {
      text: it.rule_name + label + " for " + it.client_name + ", due " + fmtDate(it.due) + ". Verify the date.",
      due_date: it.due,
      client_id: it.client_id,
      kind: "task",
      priority: it.state === "overdue" ? "high" : "normal",
      source: "deadline",
      source_ref: it.id,
    });
    setBusy(false);
    if (res && res.error) return showToast("Couldn't add the task: " + (res.error.message || "error"));
    showToast("Task added to Work → Tasks");
    DL_load(true);
  }
  return (
    <button type="button" className="link-btn" disabled={busy} onClick={go}>
      {busy ? "Adding…" : "Create task"}
    </button>
  );
}

function DL_Table({ items, taskRefs, empty }) {
  return (
    <div className="table-scroll">
      <table className="tx-table tx-table-labeled dl-table">
        <thead>
          <tr>
            <th>Due</th>
            <th>Client</th>
            <th>Form</th>
            <th>Status</th>
            <th aria-label="Actions"></th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <EmptyRow colSpan={5}>{empty}</EmptyRow>
          ) : (
            items.map((it) => {
              const s = DL_STATE[it.state];
              const src = DL_sourceText(it);
              return (
                <tr key={it.id} className={"dl-row dl-row-" + it.state}>
                  <td data-label="Due">
                    <strong>{fmtDate(it.due)}</strong>
                    {it.rolled && <span className="dl-sub">moved from {fmtDate(it.nominal)} (weekend)</span>}
                  </td>
                  <td data-label="Client">
                    <a href={DL_clientHref(it.client_id)}>{it.client_name}</a>
                  </td>
                  <td data-label="Form">
                    {it.rule_name}
                    {it.period_label && <span className="dl-sub">{it.period_label}</span>}
                    {src && <span className="dl-sub">{src}</span>}
                    {it.note && <span className="dl-sub">{it.note}</span>}
                  </td>
                  <td data-label="Status">
                    <span className={"pill dl-pill-" + s.tone}>{s.label}</span>
                  </td>
                  <td data-label="" className="dl-actions">
                    <DL_FiledControl it={it} />
                    <DL_TaskButton it={it} made={taskRefs.has(it.id)} />
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

// ---- Month view
function DL_monthGrid(ym) {
  const [y, m] = ym.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const days = new Date(y, m, 0).getDate();
  const cells = [];
  for (let i = 0; i < first.getDay(); i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(OPS_ymd(y, m, d));
  while (cells.length % 7) cells.push(null);
  return cells;
}

function DL_MonthView({ ym, setYm, items, selected, setSelected }) {
  const [y, m] = ym.split("-").map(Number);
  const today = todayLocal();
  const byDay = {};
  items.forEach((it) => {
    (byDay[it.due] = byDay[it.due] || []).push(it);
  });
  const shift = (n) => {
    const d = new Date(y, m - 1 + n, 1);
    setYm(d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"));
    setSelected(null);
  };
  return (
    <div className="dl-month">
      <div className="dl-month-nav">
        <button type="button" className="btn-secondary dl-btn" onClick={() => shift(-1)} aria-label="Previous month">
          ‹
        </button>
        <h3 className="card-title">
          {OPS_MONTHS_SHORT[m - 1]} {y}
        </h3>
        <button type="button" className="btn-secondary dl-btn" onClick={() => shift(1)} aria-label="Next month">
          ›
        </button>
        <button
          type="button"
          className="link-btn"
          onClick={() => {
            setYm(today.slice(0, 7));
            setSelected(null);
          }}
        >
          This month
        </button>
      </div>
      <div className="dl-grid" role="grid">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="dl-dow">
            {d}
          </div>
        ))}
        {DL_monthGrid(ym).map((day, i) => {
          if (!day) return <div key={"e" + i} className="dl-cell dl-cell-empty" />;
          const list = byDay[day] || [];
          const worst = list.some((x) => x.state === "overdue")
            ? "overdue"
            : list.some((x) => x.state === "soon")
              ? "soon"
              : list.some((x) => x.state === "upcoming")
                ? "upcoming"
                : list.length
                  ? "filed"
                  : "";
          return (
            <button
              type="button"
              key={day}
              className={
                "dl-cell" +
                (day === today ? " dl-today" : "") +
                (selected === day ? " dl-selected" : "") +
                (worst ? " dl-cell-" + worst : "")
              }
              onClick={() => setSelected(selected === day ? null : day)}
              aria-label={fmtDate(day) + (list.length ? ", " + list.length + " due" : "")}
            >
              <span className="dl-daynum">{Number(day.slice(8))}</span>
              {list.slice(0, 3).map((it) => (
                <span key={it.id} className={"dl-chip dl-chip-" + it.state}>
                  {it.rule_name.replace(/^Forms? /, "").split(" (")[0]} · {it.client_name}
                </span>
              ))}
              {list.length > 3 && <span className="dl-chip dl-chip-more">+{list.length - 3} more</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---- Rules (everyone reads; admins edit) and client exceptions
const DL_BLANK_RULE = {
  key: "",
  name: "",
  description: "",
  cadence: "annual",
  annualKind: "fixed",
  month: 1,
  day: 31,
  fye_months: 5,
  fallback_month: 5,
  fallback_day: 15,
  dates: [
    { month: 4, day: 30 },
    { month: 7, day: 31 },
    { month: 10, day: 31 },
    { month: 1, day: 31 },
  ],
  offset_months: 1,
  entity: "",
  excludes: "",
  payroll: "",
  opt_in: false,
  sort: 100,
};

function DL_ruleToForm(r) {
  const d = r.due_rule || {};
  const f = { ...DL_BLANK_RULE, key: r.key, name: r.name, description: r.description || "", cadence: r.cadence, sort: r.sort, opt_in: !!r.opt_in };
  if (r.cadence === "annual") {
    if (d.fye_months != null) Object.assign(f, { annualKind: "fye", fye_months: d.fye_months, day: d.day, fallback_month: d.fallback_month, fallback_day: d.fallback_day });
    else Object.assign(f, { annualKind: "fixed", month: d.month, day: d.day });
  } else if (r.cadence === "quarterly") f.dates = (d.dates || DL_BLANK_RULE.dates).map((x) => ({ ...x }));
  else Object.assign(f, { day: d.day, offset_months: d.offset_months == null ? 1 : d.offset_months });
  f.entity = (r.applies_entity_type && r.applies_entity_type[0]) || "";
  f.excludes = (r.applies_org_type_excludes || []).join(", ");
  f.payroll = r.requires_payroll === true ? "yes" : r.requires_payroll === false ? "no" : "";
  return f;
}

function DL_formToRow(f) {
  const n = (v) => Number(v);
  let due_rule;
  if (f.cadence === "annual")
    due_rule =
      f.annualKind === "fye"
        ? { fye_months: n(f.fye_months), day: n(f.day), fallback_month: n(f.fallback_month), fallback_day: n(f.fallback_day) }
        : { month: n(f.month), day: n(f.day) };
  else if (f.cadence === "quarterly") due_rule = { dates: f.dates.map((x) => ({ month: n(x.month), day: n(x.day) })) };
  else due_rule = { day: n(f.day), offset_months: n(f.offset_months) };
  const ex = f.excludes
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    name: f.name.trim(),
    description: f.description.trim() || null,
    cadence: f.cadence,
    due_rule,
    applies_entity_type: f.entity ? [f.entity] : null,
    applies_org_type_excludes: ex.length ? ex : null,
    requires_payroll: f.payroll === "yes" ? true : f.payroll === "no" ? false : null,
    opt_in: !!f.opt_in,
    sort: n(f.sort) || 100,
  };
}

function DL_MonthSelect({ value, onChange, label }) {
  return (
    <select value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label}>
      {OPS_MONTHS_SHORT.map((mm, i) => (
        <option key={mm} value={i + 1}>
          {mm}
        </option>
      ))}
    </select>
  );
}

function DL_DayInput({ value, onChange, label }) {
  return (
    <input type="number" min={1} max={31} value={value} aria-label={label} onChange={(e) => onChange(e.target.value)} className="dl-day" />
  );
}

function DL_RuleForm({ rule, onDone }) {
  const showToast = useToast();
  const isNew = !rule;
  const [f, setF] = useState(() => (rule ? DL_ruleToForm(rule) : { ...DL_BLANK_RULE, dates: DL_BLANK_RULE.dates.map((x) => ({ ...x })) }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k) => (v) => setF((o) => ({ ...o, [k]: v && v.target ? (v.target.type === "checkbox" ? v.target.checked : v.target.value) : v }));
  async function save(e) {
    e.preventDefault();
    if (!f.name.trim()) return setErr("Give it a name.");
    const row = DL_formToRow(f);
    let key = f.key.trim().toLowerCase();
    if (isNew) {
      if (!key)
        key = f.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 40);
      if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(key)) return setErr("The short code needs 2 to 41 letters, numbers or dashes.");
    }
    setErr("");
    setBusy(true);
    const sb = window.mgbSupabase;
    const { error } = isNew
      ? await sb.from("firm_deadline_rules").insert({ ...row, key })
      : await sb.from("firm_deadline_rules").update(row).eq("id", rule.id);
    setBusy(false);
    if (error) return setErr(error.code === "23505" ? "That short code is already used." : DL_errMsg(error, "Couldn't save."));
    showToast(isNew ? "Deadline added" : "Deadline saved");
    DL_load(true);
    onDone();
  }
  return (
    <form className="dl-rule-form" onSubmit={save}>
      <label className="task-field">
        <span>Name</span>
        <input type="text" maxLength={80} value={f.name} onChange={set("name")} placeholder="State annual report" />
      </label>
      {isNew && (
        <label className="task-field">
          <span>Short code (optional; can't change later)</span>
          <input type="text" maxLength={41} value={f.key} onChange={set("key")} placeholder="state-annual-report" />
        </label>
      )}
      <label className="task-field dl-wide">
        <span>Description (say to verify the date)</span>
        <textarea rows={2} maxLength={600} value={f.description} onChange={set("description")} />
      </label>
      <label className="task-field">
        <span>How often</span>
        <select value={f.cadence} onChange={set("cadence")}>
          <option value="annual">Every year</option>
          <option value="quarterly">Every quarter</option>
          <option value="monthly">Every month</option>
        </select>
      </label>
      {f.cadence === "annual" && (
        <label className="task-field">
          <span>Due date is</span>
          <select value={f.annualKind} onChange={set("annualKind")}>
            <option value="fixed">The same date every year</option>
            <option value="fye">Counted from the fiscal year end</option>
          </select>
        </label>
      )}
      <div className="task-field dl-wide">
        <span>Due</span>
        {f.cadence === "annual" && f.annualKind === "fixed" && (
          <span className="dl-inline">
            <DL_MonthSelect value={f.month} onChange={set("month")} label="Month" />
            <DL_DayInput value={f.day} onChange={set("day")} label="Day" />
          </span>
        )}
        {f.cadence === "annual" && f.annualKind === "fye" && (
          <span className="dl-inline">
            Day <DL_DayInput value={f.day} onChange={set("day")} label="Day" /> of month
            <DL_DayInput value={f.fye_months} onChange={set("fye_months")} label="Months after year end" /> after the year end. If none is
            set: <DL_MonthSelect value={f.fallback_month} onChange={set("fallback_month")} label="Fallback month" />
            <DL_DayInput value={f.fallback_day} onChange={set("fallback_day")} label="Fallback day" />
          </span>
        )}
        {f.cadence === "quarterly" && (
          <span className="dl-inline">
            {f.dates.map((x, i) => (
              <span key={i} className="dl-q">
                Q{i + 1}{" "}
                <DL_MonthSelect
                  value={x.month}
                  label={"Q" + (i + 1) + " month"}
                  onChange={(v) => setF((o) => ({ ...o, dates: o.dates.map((y, j) => (j === i ? { ...y, month: v } : y)) }))}
                />
                <DL_DayInput
                  value={x.day}
                  label={"Q" + (i + 1) + " day"}
                  onChange={(v) => setF((o) => ({ ...o, dates: o.dates.map((y, j) => (j === i ? { ...y, day: v } : y)) }))}
                />
              </span>
            ))}
          </span>
        )}
        {f.cadence === "monthly" && (
          <span className="dl-inline">
            Day <DL_DayInput value={f.day} onChange={set("day")} label="Day" /> of
            <select value={f.offset_months} onChange={(e) => set("offset_months")(Number(e.target.value))} aria-label="Which month">
              <option value={0}>the same month</option>
              <option value={1}>the next month</option>
              <option value={2}>2 months later</option>
              <option value={3}>3 months later</option>
            </select>
          </span>
        )}
      </div>
      <label className="task-field">
        <span>Clients</span>
        <select value={f.entity} onChange={set("entity")}>
          <option value="">Nonprofit and for-profit</option>
          <option value="nonprofit">Nonprofits only</option>
          <option value="for_profit">For-profits only</option>
        </select>
      </label>
      <label className="task-field">
        <span>Payroll</span>
        <select value={f.payroll} onChange={set("payroll")}>
          <option value="">Any client</option>
          <option value="yes">Payroll clients only</option>
          <option value="no">Clients without payroll</option>
        </select>
      </label>
      <label className="task-field">
        <span>Leave out organization types (comma list)</span>
        <input type="text" value={f.excludes} onChange={set("excludes")} placeholder="Church" />
      </label>
      <label className="task-field">
        <span>Order</span>
        <input type="number" value={f.sort} onChange={set("sort")} />
      </label>
      <label className="dl-check dl-wide">
        <input type="checkbox" checked={f.opt_in} onChange={set("opt_in")} /> Off by default (turn it on for each client under{" "}
        <strong>Client exceptions</strong>)
      </label>
      {err && (
        <p className="cv-err dl-wide" role="alert">
          {err}
        </p>
      )}
      <div className="cv-form-actions dl-wide">
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "Saving…" : isNew ? "Add deadline" : "Save deadline"}
        </button>
        <button type="button" className="btn-secondary" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function DL_RulesCard({ st, isAdmin }) {
  const showToast = useToast();
  const [editing, setEditing] = useState(null); // rule id, "new" or null
  async function setActive(r, active) {
    const { error } = await window.mgbSupabase.from("firm_deadline_rules").update({ active }).eq("id", r.id);
    if (error) return showToast("Couldn't save: " + (error.message || "error"));
    showToast(active ? "Deadline turned back on" : "Deadline turned off");
    DL_load(true);
  }
  return (
    <div className="card dl-rules">
      <h3 className="card-title">Deadline rules</h3>
      <p className="card-subtitle">
        The firm's list of filing deadlines. {isAdmin ? "Admins can add, edit and turn them off." : "Admins keep this list up to date."}{" "}
        Verify every date: these aren't tax or legal advice.
      </p>
      {isAdmin && editing === "new" && <DL_RuleForm rule={null} onDone={() => setEditing(null)} />}
      {isAdmin && editing !== "new" && (
        <button type="button" className="btn-secondary dl-btn" onClick={() => setEditing("new")}>
          + Add deadline
        </button>
      )}
      <ul className="dl-rule-list">
        {st.rules.length === 0 && <li className="dl-muted">No deadline rules yet.</li>}
        {st.rules.map((r) => (
          <li key={r.id} className={r.active ? "" : "dl-inactive"}>
            {editing === r.id ? (
              <DL_RuleForm rule={r} onDone={() => setEditing(null)} />
            ) : (
              <>
                <div className="dl-rule-head">
                  <strong>{r.name}</strong>
                  {!r.active && <span className="pill dl-pill-plain">Off</span>}
                  {r.opt_in && <span className="pill dl-pill-plain">Off by default</span>}
                  {isAdmin && (
                    <span className="dl-rule-actions">
                      <button type="button" className="link-btn" onClick={() => setEditing(r.id)}>
                        Edit
                      </button>
                      <button type="button" className="link-btn" onClick={() => setActive(r, !r.active)}>
                        {r.active ? "Turn off" : "Turn on"}
                      </button>
                    </span>
                  )}
                </div>
                <span className="dl-sub">{OPS_describeDueRule(r)}</span>
                {r.description && <span className="dl-sub">{r.description}</span>}
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DL_ExceptionsCard({ st, clients }) {
  const showToast = useToast();
  const [clientId, setClientId] = useState("");
  const [ruleKey, setRuleKey] = useState("");
  const [kind, setKind] = useState("skip");
  const [date, setDate] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const rule = st.rules.find((r) => r.key === ruleKey);
  const byId = {};
  (clients || []).forEach((c) => {
    byId[c.id] = c;
  });
  const ruleName = (k) => {
    const r = st.rules.find((x) => x.key === k);
    return r ? r.name : k;
  };
  async function add(e) {
    e.preventDefault();
    if (!clientId || !ruleKey) return setErr("Pick a client and a deadline.");
    if (kind === "date" && !date) return setErr("Pick the date.");
    setErr("");
    setBusy(true);
    const sb = window.mgbSupabase;
    const old = st.overrides.find((o) => o.client_id === clientId && o.rule_key === ruleKey);
    if (old) await sb.from("client_deadline_overrides").update({ removed_at: new Date().toISOString() }).eq("id", old.id);
    const { error } = await sb.from("client_deadline_overrides").insert({
      client_id: clientId,
      rule_key: ruleKey,
      skip: kind === "skip",
      due_date: kind === "date" ? date : null,
      note: note.trim() || null,
    });
    setBusy(false);
    if (error) return setErr(DL_errMsg(error, "Couldn't save."));
    showToast("Exception saved");
    setDate("");
    setNote("");
    DL_load(true);
  }
  async function remove(o) {
    const { error } = await window.mgbSupabase
      .from("client_deadline_overrides")
      .update({ removed_at: new Date().toISOString() })
      .eq("id", o.id);
    if (error) return showToast("Couldn't remove: " + (error.message || "error"));
    showToast("Exception removed");
    DL_load(true);
  }
  const mine = st.overrides.filter((o) => byId[o.client_id]);
  return (
    <div className="card dl-exceptions">
      <h3 className="card-title">Client exceptions</h3>
      <p className="card-subtitle">
        Skip a deadline for one client, give it a different date (yearly deadlines), or turn on one that's off by default. The Form 990 and
        1099 dates on a client's <strong>Key dates</strong> count too.
      </p>
      <form className="dl-exc-form" onSubmit={add}>
        <select value={clientId} onChange={(e) => setClientId(e.target.value)} aria-label="Client">
          <option value="">Client…</option>
          {(clients || []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name || c.id}
            </option>
          ))}
        </select>
        <select
          value={ruleKey}
          onChange={(e) => {
            setRuleKey(e.target.value);
            const r = st.rules.find((x) => x.key === e.target.value);
            if (r && r.opt_in) setKind("on");
            else if (kind === "on") setKind("skip");
            if (r && r.cadence !== "annual" && kind === "date") setKind("skip");
          }}
          aria-label="Deadline"
        >
          <option value="">Deadline…</option>
          {st.rules
            .filter((r) => r.active)
            .map((r) => (
              <option key={r.key} value={r.key}>
                {r.name}
              </option>
            ))}
        </select>
        <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Exception">
          <option value="skip">Skip for this client</option>
          {(!rule || rule.cadence === "annual") && <option value="date">Different date</option>}
          <option value="on">Turn on for this client</option>
        </select>
        {kind === "date" && <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" />}
        <input type="text" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" aria-label="Note" />
        <button type="submit" className="btn-primary dl-btn" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
      </form>
      {err && (
        <p className="cv-err" role="alert">
          {err}
        </p>
      )}
      <ul className="dl-rule-list">
        {mine.length === 0 && <li className="dl-muted">No exceptions yet.</li>}
        {mine.map((o) => (
          <li key={o.id}>
            <div className="dl-rule-head">
              <strong>{byId[o.client_id].name || o.client_id}</strong>
              <span>
                {ruleName(o.rule_key)}: {o.skip ? "skipped" : o.due_date ? "due " + fmtDate(o.due_date) : "turned on"}
              </span>
              <span className="dl-rule-actions">
                <button type="button" className="link-btn" onClick={() => remove(o)}>
                  Remove
                </button>
              </span>
            </div>
            {o.note && <span className="dl-sub">{o.note}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---- Page
function DL_DeadlinesPage({ clients, staffUser }) {
  const me = String((staffUser && staffUser.email) || "").toLowerCase();
  const isAdmin = staffUser && staffUser.role === "admin";
  const st = DL_useStore(true);
  const today = todayLocal();
  const hasMine = (clients || []).some(
    (c) => c.assignedBookkeeper && String(c.assignedBookkeeper.email || "").toLowerCase() === me,
  );
  const [view, setView] = useState("list");
  const [who, setWho] = useState(hasMine ? "mine" : "all");
  const [form, setForm] = useState("");
  const [showFiled, setShowFiled] = useState(false);
  const [ym, setYm] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState(null);

  const from = view === "list" ? OPS_addDays(today, -180) : ym + "-01";
  const to = view === "list" ? OPS_addDays(today, 90) : OPS_ymd(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) + 1, 0);
  const all = st.loading ? [] : DL_items(st, clients, from, to);
  const filtered = all.filter(
    (it) => (who === "all" || it.assignee_email === me) && (!form || it.rule_key === form),
  );

  let body;
  if (view === "list") {
    const overdue = filtered.filter((it) => it.state === "overdue");
    const soon = filtered.filter((it) => it.state === "soon");
    const later = filtered.filter((it) => it.state === "upcoming");
    const filed = filtered.filter((it) => it.state === "filed").reverse();
    body = (
      <>
        {overdue.length > 0 && (
          <div className="card dl-group dl-group-overdue">
            <h3 className="card-title">Overdue and not filed</h3>
            <p className="card-subtitle">Past the due date in the last 6 months with nothing marked filed.</p>
            <DL_Table items={overdue} taskRefs={st.taskRefs} empty="" />
          </div>
        )}
        <div className="card dl-group">
          <h3 className="card-title">Next {OPS_DEADLINE_SOON_DAYS} days</h3>
          <DL_Table items={soon} taskRefs={st.taskRefs} empty={st.loading ? "Loading…" : "Nothing due in the next week."} />
        </div>
        <div className="card dl-group">
          <h3 className="card-title">Later (next 90 days)</h3>
          <DL_Table items={later} taskRefs={st.taskRefs} empty={st.loading ? "Loading…" : "Nothing else due in the next 90 days."} />
        </div>
        {showFiled && (
          <div className="card dl-group">
            <h3 className="card-title">Filed</h3>
            <DL_Table items={filed} taskRefs={st.taskRefs} empty="Nothing marked filed in this window." />
          </div>
        )}
      </>
    );
  } else {
    const shown = filtered.filter((it) => showFiled || it.state !== "filed");
    const dayItems = selected ? shown.filter((it) => it.due === selected) : shown;
    body = (
      <>
        <div className="card">
          <DL_MonthView ym={ym} setYm={setYm} items={shown} selected={selected} setSelected={setSelected} />
        </div>
        <div className="card dl-group">
          <h3 className="card-title">
            {selected ? "Due " + fmtDate(selected) : "Everything in " + OPS_MONTHS_SHORT[Number(ym.slice(5, 7)) - 1] + " " + ym.slice(0, 4)}
          </h3>
          {selected && (
            <button type="button" className="link-btn" onClick={() => setSelected(null)}>
              Show the whole month
            </button>
          )}
          <DL_Table items={dayItems} taskRefs={st.taskRefs} empty={st.loading ? "Loading…" : "Nothing due."} />
        </div>
      </>
    );
  }

  return (
    <div className="dl-page">
      <div className="card dl-head">
        <div className="dl-controls">
          <div className="modal-tabs" style={{ marginTop: 0 }}>
            {[
              ["list", "List"],
              ["month", "Month"],
            ].map(([k, l]) => (
              <button key={k} type="button" className={"modal-tab" + (view === k ? " active" : "")} onClick={() => setView(k)}>
                {l}
              </button>
            ))}
          </div>
          <div className="modal-tabs" style={{ marginTop: 0 }}>
            {[
              ["mine", "My clients"],
              ["all", "All clients"],
            ].map(([k, l]) => (
              <button key={k} type="button" className={"modal-tab" + (who === k ? " active" : "")} onClick={() => setWho(k)}>
                {l}
              </button>
            ))}
          </div>
          <select value={form} onChange={(e) => setForm(e.target.value)} aria-label="Form">
            <option value="">All forms</option>
            {st.rules.map((r) => (
              <option key={r.key} value={r.key}>
                {r.name}
              </option>
            ))}
          </select>
          <label className="dl-check">
            <input type="checkbox" checked={showFiled} onChange={(e) => setShowFiled(e.target.checked)} /> Show filed
          </label>
        </div>
        <p className="dl-verify">
          <WarningIcon /> {DL_VERIFY_TEXT}
        </p>
        {st.error && (
          <div className="mock-banner" style={{ marginTop: 12, marginBottom: 0 }}>
            <WarningIcon />
            <span>{st.error}</span>
          </div>
        )}
        {!st.loading && !st.error && who === "mine" && !hasMine && (
          <p className="card-subtitle">You don't have any clients assigned. Switch to All clients.</p>
        )}
      </div>
      {body}
      <div className="dl-bottom">
        <DL_ExceptionsCard st={st} clients={clients} />
        <DL_RulesCard st={st} isAdmin={isAdmin} />
      </div>
    </div>
  );
}

// ---- Home card body: next 30 days for my clients (admins with none: all)
function DL_UpcomingDeadlinesBody({ clients, staffUser }) {
  const me = String((staffUser && staffUser.email) || "").toLowerCase();
  const st = DL_useStore(true);
  const today = todayLocal();
  const mineClients = (clients || []).filter(
    (c) => c.assignedBookkeeper && String(c.assignedBookkeeper.email || "").toLowerCase() === me,
  );
  const useAll = mineClients.length === 0 && staffUser && staffUser.role === "admin";
  const items = st.loading
    ? []
    : DL_items(st, useAll ? clients : mineClients, OPS_addDays(today, -180), OPS_addDays(today, 30)).filter((it) => it.state !== "filed");
  const shown = items.slice(0, 6);
  return (
    <div className="dl-home">
      {useAll && <p className="card-subtitle">You have no clients assigned, so this shows every client.</p>}
      {st.error && <p className="card-subtitle">{st.error}</p>}
      {!st.error && st.loading && <p className="card-subtitle">Loading…</p>}
      {!st.error && !st.loading && items.length === 0 && (
        <p className="card-subtitle">{useAll ? "No deadlines in the next 30 days." : "No deadlines in the next 30 days for your clients."}</p>
      )}
      {shown.length > 0 && (
        <ul className="dl-home-list">
          {shown.map((it) => (
            <li key={it.id} className={"dl-home-" + it.state}>
              <span className={"pill dl-pill-" + DL_STATE[it.state].tone}>
                {it.state === "overdue" ? "Overdue" : fmtDate(it.due)}
              </span>
              <span className="dl-home-what">
                <strong>{it.rule_name}</strong>
                {it.period_label ? " · " + it.period_label : ""}
                <span className="dl-sub">{it.client_name}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="dl-home-foot">
        {items.length > shown.length ? items.length - shown.length + " more · " : ""}
        <a href="#/work/deadlines">Open Deadlines</a> · Verify dates before filing.
      </p>
    </div>
  );
}

function DL_Icon(props) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M3.5 10h17M8 3v4M16 3v4M8 14h3M8 17h6" />
    </svg>
  );
}
