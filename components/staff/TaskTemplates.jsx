// ----------------------------------------------------------------------------
// Recurring task templates (owner request 2026-09-29). Admin page
// "task-templates".
//
// An admin defines recurring work once (title, cadence, due offset, which
// plan tiers or clients it applies to). The database turns templates into
// staff_reminders rows for each matching client's assigned bookkeeper:
// supabase/task-templates.sql has the rules, the pg_cron job
// "task-templates-daily" runs it every morning, and "Generate now" here calls
// the admin-only tt_generate_now() RPC.
//
// Generated tasks land in the bookkeeper's My Tasks (staff_email =
// assignee_email = bookkeeper), shared with the client's team, tagged
// source='template' and deduplicated per template x client x period.
//
// Loaded before app.jsx and shares its global scope: top-level names carry a
// TT_ prefix; app.jsx globals (hooks, planLabel, ModalShell, useToast) are
// only touched at render time.
// ----------------------------------------------------------------------------

const TT_CADENCES = [
  { key: "monthly", label: "Monthly" },
  { key: "quarterly", label: "Quarterly" },
  { key: "annually", label: "Annually" },
];
const TT_TIERS = ["basic", "standard", "premium"];
const TT_COLS =
  "id, title, cadence, due_offset_days, lead_days, plan_tiers, client_ids, priority, active, created_by, created_at";
const TT_BLANK = {
  title: "",
  cadence: "monthly",
  due_offset_days: 10,
  lead_days: 14,
  plan_tiers: [],
  client_ids: [],
  priority: "normal",
  active: true,
};

const TT_name = (c) => String((c && (c.name || c.id)) || "");
const TT_tierLabel = (t) => (typeof planLabel === "function" ? planLabel(t) : t);

function TT_offsetText(t) {
  const n = Number(t.due_offset_days) || 0;
  const period = t.cadence === "monthly" ? "month" : t.cadence === "quarterly" ? "quarter" : "year";
  if (n === 0) return `Due on the last day of the ${period}`;
  if (n > 0) return `Due ${n} day${n === 1 ? "" : "s"} after the ${period} ends`;
  return `Due ${-n} day${n === -1 ? "" : "s"} before the ${period} ends`;
}

// Next due date on or after today (same maths as tt_generate_template_tasks).
function TT_nextDue(t, today = new Date()) {
  const step = t.cadence === "monthly" ? 1 : t.cadence === "quarterly" ? 3 : 12;
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let start =
    t.cadence === "monthly"
      ? new Date(t0.getFullYear(), t0.getMonth() - 6, 1)
      : t.cadence === "quarterly"
        ? new Date(t0.getFullYear(), Math.floor(t0.getMonth() / 3) * 3 - 6, 1)
        : new Date(t0.getFullYear() - 1, 0, 1);
  for (let i = 0; i < 40; i++) {
    const end = new Date(start.getFullYear(), start.getMonth() + step, 0);
    const due = new Date(end.getFullYear(), end.getMonth(), end.getDate() + (Number(t.due_offset_days) || 0));
    if (due >= t0) return due;
    start = new Date(start.getFullYear(), start.getMonth() + step, 1);
  }
  return null;
}

function TT_appliesText(t, clientsById) {
  const parts = [];
  if (t.plan_tiers && t.plan_tiers.length) parts.push(t.plan_tiers.map(TT_tierLabel).join(", ") + " plan");
  if (t.client_ids && t.client_ids.length) {
    const names = t.client_ids.map((id) => (clientsById[id] ? TT_name(clientsById[id]) : id));
    parts.push(names.length > 2 ? `${names.slice(0, 2).join(", ")} +${names.length - 2}` : names.join(", "));
  }
  return parts.length ? parts.join(" · ") : "Every client";
}

function TT_matchCount(t, clients) {
  const tiers = t.plan_tiers || [];
  const ids = t.client_ids || [];
  if (!tiers.length && !ids.length) return clients.length;
  return clients.filter((c) => tiers.includes(c.plan || "standard") || ids.includes(c.id)).length;
}

function TT_TaskTemplatesPage({ clients }) {
  const showToast = typeof useToast === "function" ? useToast() : null;
  const toast = (m) => showToast && showToast(m);
  const [list, setList] = useState([]);
  const [issued, setIssued] = useState({});
  const [state, setState] = useState({ loading: true, error: null });
  const [editing, setEditing] = useState(null); // template draft or null
  const [generating, setGenerating] = useState(false);
  const [lastRun, setLastRun] = useState(null);
  const clientsById = useMemo(() => Object.fromEntries((clients || []).map((c) => [c.id, c])), [clients]);

  const load = useCallback(async () => {
    const sb = window.mgbSupabase;
    if (!sb) {
      setState({ loading: false, error: "Supabase isn't configured, so templates can't be saved." });
      return;
    }
    const safe = (p) => Promise.resolve(p).then((r) => r, (e) => ({ data: null, error: e }));
    const [t, i] = await Promise.all([
      safe(sb.from("task_templates").select(TT_COLS).order("created_at")),
      safe(sb.from("task_template_issued").select("template_id").limit(10000)),
    ]);
    setList(t.data || []);
    const counts = {};
    (i.data || []).forEach((r) => (counts[r.template_id] = (counts[r.template_id] || 0) + 1));
    setIssued(counts);
    setState({
      loading: false,
      error: t.error ? "Couldn't load templates (" + (t.error.message || "not signed in") + ")." : null,
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (draft) => {
    const sb = window.mgbSupabase;
    const row = {
      title: draft.title.trim(),
      cadence: draft.cadence,
      due_offset_days: Number(draft.due_offset_days) || 0,
      lead_days: Math.max(0, Math.min(90, Number(draft.lead_days) || 0)),
      plan_tiers: draft.plan_tiers,
      client_ids: draft.client_ids,
      priority: draft.priority,
      active: draft.active,
    };
    if (!sb) {
      toast("Supabase isn't configured.");
      return false;
    }
    const res = draft.id
      ? await sb.from("task_templates").update(row).eq("id", draft.id).select(TT_COLS).single()
      : await sb.from("task_templates").insert(row).select(TT_COLS).single();
    if (res.error) {
      toast("Couldn't save the template. " + (res.error.message || ""));
      return false;
    }
    setList((l) => (draft.id ? l.map((x) => (x.id === draft.id ? res.data : x)) : [...l, res.data]));
    toast(draft.id ? "Template saved." : "Template added. Tasks appear once they're within the lead window.");
    return true;
  };

  const remove = async (t) => {
    if (!window.confirm(`Delete "${t.title}"? Tasks it already created stay in My Tasks.`)) return;
    const sb = window.mgbSupabase;
    if (!sb) return;
    const { error } = await sb.from("task_templates").delete().eq("id", t.id);
    if (error) {
      toast("Couldn't delete. " + (error.message || ""));
      return;
    }
    setList((l) => l.filter((x) => x.id !== t.id));
    setEditing(null);
  };

  const toggleActive = async (t) => {
    const sb = window.mgbSupabase;
    if (!sb) return;
    setList((l) => l.map((x) => (x.id === t.id ? { ...x, active: !t.active } : x)));
    const { error } = await sb.from("task_templates").update({ active: !t.active }).eq("id", t.id);
    if (error) {
      setList((l) => l.map((x) => (x.id === t.id ? { ...x, active: t.active } : x)));
      toast("Couldn't update. " + (error.message || ""));
    }
  };

  const generateNow = async () => {
    const sb = window.mgbSupabase;
    if (!sb) return;
    setGenerating(true);
    const { data, error } = await sb.rpc("tt_generate_now");
    setGenerating(false);
    if (error) {
      toast("Couldn't generate tasks. " + (error.message || ""));
      return;
    }
    setLastRun({ ...data, at: new Date() });
    const n = (data && data.created) || 0;
    toast(n ? `Created ${n} task${n === 1 ? "" : "s"}.` : "Nothing new to create right now.");
    try {
      if (typeof STAFF_ITEMS_CHANGED_EVENT === "string") window.dispatchEvent(new Event(STAFF_ITEMS_CHANGED_EVENT));
    } catch (e) {}
    load();
  };

  return (
    <div className="tt-page">
      <div className="card tt-intro">
        <div className="tt-intro-text">
          <h3 className="card-title">Recurring task templates</h3>
          <p className="card-subtitle">
            Each template creates a task in the assigned bookkeeper's My Tasks for every matching client, once per period,
            as soon as the due date is within the lead window. This runs every morning automatically.
          </p>
          {lastRun && (
            <p className="tt-run">
              Last run {lastRun.at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}: {lastRun.created || 0} created
              {lastRun.skipped_no_assignee
                ? ` · ${lastRun.skipped_no_assignee} skipped because the client's bookkeeper doesn't match a staff login`
                : ""}
              .
            </p>
          )}
        </div>
        <div className="tt-intro-actions">
          <button type="button" className="btn-secondary" onClick={generateNow} disabled={generating || !list.some((t) => t.active)}>
            {generating ? "Generating…" : "Generate now"}
          </button>
          <button type="button" className="btn-primary" onClick={() => setEditing({ ...TT_BLANK })}>
            New template
          </button>
        </div>
      </div>

      {state.error && <div className="mock-banner tt-banner">{state.error}</div>}

      {state.loading ? (
        <div className="card">
          <p className="card-subtitle">Loading…</p>
        </div>
      ) : list.length === 0 ? (
        <div className="card tt-empty">
          <p className="card-subtitle">
            No templates yet. Try "Reconcile bank accounts", monthly, due 10 days after month end, for every client.
          </p>
        </div>
      ) : (
        <ul className="tt-list">
          {list.map((t) => {
            const next = TT_nextDue(t);
            return (
              <li key={t.id} className={"card tt-item" + (t.active ? "" : " inactive")}>
                <div className="tt-item-main">
                  <div className="tt-item-title">
                    {t.title}
                    {!t.active && <span className="task-chip">Paused</span>}
                    {t.priority === "high" && <span className="task-chip bad">High</span>}
                  </div>
                  <div className="tt-item-meta">
                    <span className="task-chip">{TT_CADENCES.find((c) => c.key === t.cadence).label}</span>
                    <span>{TT_offsetText(t)}</span>
                    <span>
                      {TT_appliesText(t, clientsById)} ({TT_matchCount(t, clients || [])} client
                      {TT_matchCount(t, clients || []) === 1 ? "" : "s"})
                    </span>
                    {next && (
                      <span>
                        Next due {next.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}, created{" "}
                        {t.lead_days} day{t.lead_days === 1 ? "" : "s"} before
                      </span>
                    )}
                    {issued[t.id] ? <span>{issued[t.id]} created so far</span> : null}
                  </div>
                </div>
                <div className="tt-item-actions">
                  <button type="button" className="link-btn" onClick={() => toggleActive(t)}>
                    {t.active ? "Pause" : "Resume"}
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => setEditing({ ...t })}>
                    Edit
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {editing && (
        <TT_Editor
          draft={editing}
          clients={clients || []}
          onClose={() => setEditing(null)}
          onDelete={editing.id ? () => remove(editing) : null}
          onSave={async (d) => {
            if (await save(d)) setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function TT_Editor({ draft: initial, clients, onClose, onSave, onDelete }) {
  const [d, setD] = useState(initial);
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setD((x) => ({ ...x, [k]: v }));
  const toggleIn = (k, v) =>
    setD((x) => ({ ...x, [k]: x[k].includes(v) ? x[k].filter((y) => y !== v) : [...x[k], v] }));
  const shown = clients
    .filter((c) => !q || TT_name(c).toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => TT_name(a).localeCompare(TT_name(b)));
  const everyone = !d.plan_tiers.length && !d.client_ids.length;
  const next = TT_nextDue(d);

  return (
    <ModalShell onClose={onClose} labelledBy="tt-edit-title" className="tt-modal">
      <form
        className="tt-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!d.title.trim()) return;
          setSaving(true);
          await onSave(d);
          setSaving(false);
        }}
      >
        <h3 id="tt-edit-title" className="card-title">
          {d.id ? "Edit template" : "New template"}
        </h3>

        <label className="tt-label" htmlFor="tt-title">
          Task title
        </label>
        <input
          id="tt-title"
          className="tt-input"
          value={d.title}
          maxLength={200}
          required
          placeholder="Reconcile bank accounts"
          onChange={(e) => set("title", e.target.value)}
        />
        <p className="tt-help">The period is added automatically, e.g. "… · Sep 2026".</p>

        <div className="tt-row">
          <div>
            <label className="tt-label" htmlFor="tt-cadence">
              Repeats
            </label>
            <select id="tt-cadence" className="tt-input" value={d.cadence} onChange={(e) => set("cadence", e.target.value)}>
              {TT_CADENCES.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="tt-label" htmlFor="tt-offset">
              Due (days after period end)
            </label>
            <input
              id="tt-offset"
              className="tt-input"
              type="number"
              min={-90}
              max={120}
              value={d.due_offset_days}
              onChange={(e) => set("due_offset_days", e.target.value)}
            />
          </div>
          <div>
            <label className="tt-label" htmlFor="tt-lead">
              Create (days before due)
            </label>
            <input
              id="tt-lead"
              className="tt-input"
              type="number"
              min={0}
              max={90}
              value={d.lead_days}
              onChange={(e) => set("lead_days", e.target.value)}
            />
          </div>
          <div>
            <label className="tt-label" htmlFor="tt-priority">
              Priority
            </label>
            <select id="tt-priority" className="tt-input" value={d.priority} onChange={(e) => set("priority", e.target.value)}>
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
            </select>
          </div>
        </div>
        <p className="tt-help">
          {TT_offsetText(d)}. 0 = last day of the period, negative = before it ends.
          {next ? ` Next due ${next.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}.` : ""}
        </p>

        <fieldset className="tt-fieldset">
          <legend className="tt-label">Applies to</legend>
          <div className="tt-tiers">
            {TT_TIERS.map((t) => (
              <label key={t} className="tt-check">
                <input type="checkbox" checked={d.plan_tiers.includes(t)} onChange={() => toggleIn("plan_tiers", t)} />
                {TT_tierLabel(t)} plan
              </label>
            ))}
          </div>
          <input
            className="tt-input tt-search"
            placeholder="Also add specific clients…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search clients"
          />
          <div className="tt-clients">
            {shown.map((c) => (
              <label key={c.id} className="tt-check">
                <input type="checkbox" checked={d.client_ids.includes(c.id)} onChange={() => toggleIn("client_ids", c.id)} />
                <span className="tt-client-name">{TT_name(c)}</span>
                <span className="tt-muted">{TT_tierLabel(c.plan || "standard")}</span>
              </label>
            ))}
            {shown.length === 0 && <p className="tt-help">No clients match.</p>}
          </div>
          <p className="tt-help">
            {everyone
              ? `Nothing selected, so it applies to every client (${clients.length}).`
              : `Matches ${TT_matchCount(d, clients)} client${TT_matchCount(d, clients) === 1 ? "" : "s"}.`}{" "}
            Tasks go to each client's assigned bookkeeper.
          </p>
        </fieldset>

        <label className="tt-check">
          <input type="checkbox" checked={d.active} onChange={(e) => set("active", e.target.checked)} />
          Active
        </label>

        <div className="tt-foot">
          {onDelete && (
            <button type="button" className="link-btn tt-delete" onClick={onDelete}>
              Delete template
            </button>
          )}
          <span className="tt-foot-spacer" />
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={saving || !d.title.trim()}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}
