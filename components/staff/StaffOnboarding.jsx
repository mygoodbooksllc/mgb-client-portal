// New-hire onboarding checklist (owner request 2026-10-07). Staff only.
// supabase/staff-onboarding.sql
//
//   SON_HomeCard      Home card "Your onboarding": your steps, tick them off,
//                     each with a link to its Staff guide article. Hides
//                     itself once every step is done or you click "Hide
//                     this card".
//   SON_ProgressTab   Team → Onboarding (admins): everyone's progress, tick
//                     for someone, and edit the step list (add, edit,
//                     reorder, retire / restore; never deleted).
//
// Mirrors the client onboarding checklist (Onboarding.jsx, OB_). No auto
// ticks. Top-level names use the SON_ prefix.

const SON_SETUP_MSG = "The onboarding checklist isn't set up yet (database step pending).";

const SON_store = { steps: [], rows: [], loading: true, error: null, loadedAt: 0, subs: new Set(), inflight: null };

function SON_emit() {
  SON_store.subs.forEach((fn) => {
    try {
      fn();
    } catch (e) {}
  });
}

function SON_errText(error) {
  return typeof isMissingTableError === "function" && isMissingTableError(error) ? SON_SETUP_MSG : error.message;
}

function SON_load(force) {
  const sb = window.mgbSupabase;
  if (!sb) return Promise.resolve();
  if (SON_store.inflight) return SON_store.inflight;
  if (!force && SON_store.loadedAt && Date.now() - SON_store.loadedAt < 60 * 1000) return Promise.resolve();
  SON_store.inflight = Promise.all([
    Promise.resolve(sb.from("staff_onboarding_steps").select("key, title, description, guide_slug, sort, active").order("sort")),
    // RLS: your own rows, or everyone's for admins.
    Promise.resolve(sb.from("staff_onboarding_progress").select("staff_email, step_key, done_at, done_by").limit(5000)),
  ])
    .then(([st, pr]) => {
      SON_store.loading = false;
      SON_store.loadedAt = Date.now();
      const err = st.error || pr.error;
      if (err) {
        SON_store.error = SON_errText(err);
        SON_store.steps = [];
        SON_store.rows = [];
      } else {
        SON_store.error = null;
        SON_store.steps = (st.data || []).slice().sort((a, b) => (a.sort || 0) - (b.sort || 0) || String(a.title).localeCompare(String(b.title)));
        SON_store.rows = pr.data || [];
      }
    })
    .catch(() => {
      SON_store.loading = false;
      SON_store.error = "Couldn't load the onboarding checklist.";
    })
    .finally(() => {
      SON_store.inflight = null;
      SON_emit();
    });
  return SON_store.inflight;
}

function SON_useStore() {
  const [, bump] = React.useReducer((n) => n + 1, 0);
  useEffect(() => {
    SON_store.subs.add(bump);
    SON_load(false);
    const on = () => SON_load(true);
    window.addEventListener(STAFF_TOOLS_EVENT, on);
    return () => {
      SON_store.subs.delete(bump);
      window.removeEventListener(STAFF_TOOLS_EVENT, on);
    };
  }, []);
  return SON_store;
}

async function SON_setDone(email, key, done) {
  const { error } = await window.mgbSupabase
    .from("staff_onboarding_progress")
    .upsert(
      { staff_email: String(email || "").toLowerCase(), step_key: key, done_at: done ? new Date().toISOString() : null },
      { onConflict: "staff_email,step_key" },
    );
  if (!error) SON_load(true);
  return error;
}

function SON_StepList({ steps, summary, email, canTick, onError }) {
  const [busy, setBusy] = useState("");
  async function toggle(key, done) {
    setBusy(key);
    const error = await SON_setDone(email, key, done);
    setBusy("");
    if (error && onError) onError(SON_errText(error));
  }
  return (
    <ul className="son-steps">
      {steps.map((s) => {
        const at = summary.doneAt[s.key];
        return (
          <li key={s.key} className={"son-step" + (at ? " son-done" : "")}>
            <label className="son-check">
              <input
                type="checkbox"
                checked={!!at}
                disabled={!canTick || busy === s.key}
                onChange={(e) => toggle(s.key, e.target.checked)}
              />
              <span className="son-step-text">
                <span className="son-step-title">{s.title}</span>
                {s.description && <span className="son-step-desc">{s.description}</span>}
              </span>
            </label>
            {s.guide_slug && (
              <a className="son-guide" href={"#/help/" + s.guide_slug}>
                Read the guide
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function SON_Bar({ summary }) {
  return (
    <div className="son-bar-row">
      <span className="ov-progress son-bar" aria-hidden="true">
        <span style={{ width: summary.pct + "%" }} />
      </span>
      <span className="son-bar-text">
        {summary.done} of {summary.total} done
      </span>
    </div>
  );
}

// The whole Home card (wrapper included) so it can hide itself.
function SON_HomeCard({ staffUser, className, dragProps }) {
  const showToast = useToast();
  const st = SON_useStore();
  const me = String((staffUser && staffUser.email) || "").toLowerCase();
  const [hiding, setHiding] = useState(false);
  if (!me || st.loading || st.error) return null;
  const steps = st.steps.filter((s) => s.active !== false);
  const summary = OPS_onboardingSummary(st.steps, st.rows, me);
  if (steps.length === 0 || summary.complete || summary.dismissed) return null;
  async function hide() {
    setHiding(true);
    const error = await SON_setDone(me, OPS_ONBOARDING_DISMISSED, true);
    setHiding(false);
    if (error) showToast("Couldn't hide it: " + SON_errText(error));
    else showToast("Onboarding card hidden. Find the steps again in the Staff guide.");
  }
  return (
    <div className={className} {...(dragProps || {})}>
      <h3 className="card-title">Your onboarding</h3>
      <p className="card-subtitle">Your first steps at MyGoodBooks. Tick each one off as you go.</p>
      <SON_Bar summary={summary} />
      <SON_StepList steps={steps} summary={summary} email={me} canTick onError={(m) => showToast("Couldn't save: " + m)} />
      <button type="button" className="link-btn son-hide" disabled={hiding} onClick={hide}>
        Hide this card
      </button>
    </div>
  );
}

// ---- Team → Onboarding (admins) ----

function SON_StepEditor({ step, onDone, nextSort }) {
  const showToast = useToast();
  const isNew = !step;
  const [title, setTitle] = useState(step ? step.title : "");
  const [desc, setDesc] = useState(step ? step.description || "" : "");
  const [slug, setSlug] = useState(step ? step.guide_slug || "" : "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function save(e) {
    e.preventDefault();
    const t = title.trim();
    const g = slug.trim().replace(/^#\/help\//, "");
    if (!t) return setErr("Give the step a title.");
    if (g && !/^[a-z0-9-]{1,80}$/.test(g)) return setErr("Guide article: use the article's short name, like month-end-close.");
    setErr("");
    setBusy(true);
    const sb = window.mgbSupabase;
    let error;
    if (isNew) {
      const base = t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "step";
      const key = base + "-" + Date.now().toString(36).slice(-4);
      ({ error } = await sb.from("staff_onboarding_steps").insert({ key, title: t, description: desc.trim() || null, guide_slug: g || null, sort: nextSort }));
    } else {
      ({ error } = await sb
        .from("staff_onboarding_steps")
        .update({ title: t, description: desc.trim() || null, guide_slug: g || null })
        .eq("key", step.key));
    }
    setBusy(false);
    if (error) return setErr(SON_errText(error));
    showToast(isNew ? "Step added" : "Step saved");
    SON_load(true);
    onDone();
  }
  return (
    <form className="son-edit" onSubmit={save}>
      <label className="task-field">
        <span>Step</span>
        <input type="text" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Shadow a client month-end" />
      </label>
      <label className="task-field">
        <span>Staff guide article (optional)</span>
        <input type="text" maxLength={80} value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="month-end-close" />
      </label>
      <label className="task-field son-edit-wide">
        <span>Details (optional)</span>
        <input type="text" maxLength={500} value={desc} onChange={(e) => setDesc(e.target.value)} />
      </label>
      {err && (
        <p className="cv-err son-edit-wide" role="alert">
          {err}
        </p>
      )}
      <div className="son-edit-wide cv-form-actions">
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "Saving…" : isNew ? "Add step" : "Save"}
        </button>
        <button type="button" className="btn-secondary" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function SON_StepsAdmin({ steps }) {
  const showToast = useToast();
  const [editing, setEditing] = useState(null); // key, "__new", or null
  const [busy, setBusy] = useState(false);
  const active = steps.filter((s) => s.active !== false);
  const retired = steps.filter((s) => s.active === false);
  async function patch(key, values, msg) {
    setBusy(true);
    const { error } = await window.mgbSupabase.from("staff_onboarding_steps").update(values).eq("key", key);
    setBusy(false);
    if (error) return showToast("Couldn't save: " + SON_errText(error));
    if (msg) showToast(msg);
    SON_load(true);
  }
  async function move(i, dir) {
    const a = active[i];
    const b = active[i + dir];
    if (!a || !b) return;
    setBusy(true);
    const sb = window.mgbSupabase;
    // Renumber in tens so a swap never collides with another step's sort.
    const order = active.map((s) => s.key);
    order[i] = b.key;
    order[i + dir] = a.key;
    const results = await Promise.all(order.map((key, n) => sb.from("staff_onboarding_steps").update({ sort: (n + 1) * 10 }).eq("key", key)));
    setBusy(false);
    const bad = results.find((r) => r.error);
    if (bad) showToast("Couldn't reorder: " + bad.error.message);
    SON_load(true);
  }
  const nextSort = (active.length ? Math.max(...active.map((s) => s.sort || 0)) : 0) + 10;
  return (
    <section className="card son-admin-card">
      <h3 className="card-title">Steps</h3>
      <p className="card-subtitle">Everyone gets these steps. Retiring a step hides it from the checklist but keeps who finished it.</p>
      {active.length === 0 && <p className="card-subtitle">No steps yet. Add the first one.</p>}
      <ol className="son-admin-steps">
        {active.map((s, i) =>
          editing === s.key ? (
            <li key={s.key}>
              <SON_StepEditor step={s} onDone={() => setEditing(null)} />
            </li>
          ) : (
            <li key={s.key} className="son-admin-step">
              <span className="son-step-text">
                <span className="son-step-title">{s.title}</span>
                {s.description && <span className="son-step-desc">{s.description}</span>}
                {s.guide_slug && <span className="son-step-desc">Guide: {s.guide_slug}</span>}
              </span>
              <span className="son-admin-actions">
                <button type="button" className="link-btn" disabled={busy || i === 0} onClick={() => move(i, -1)} aria-label={"Move " + s.title + " up"}>
                  ↑
                </button>
                <button type="button" className="link-btn" disabled={busy || i === active.length - 1} onClick={() => move(i, 1)} aria-label={"Move " + s.title + " down"}>
                  ↓
                </button>
                <button type="button" className="link-btn" disabled={busy} onClick={() => setEditing(s.key)}>
                  Edit
                </button>
                <button type="button" className="link-btn" disabled={busy} onClick={() => patch(s.key, { active: false }, "Step retired")}>
                  Retire
                </button>
              </span>
            </li>
          ),
        )}
      </ol>
      {editing === "__new" ? (
        <SON_StepEditor step={null} nextSort={nextSort} onDone={() => setEditing(null)} />
      ) : (
        <button type="button" className="btn-secondary" onClick={() => setEditing("__new")}>
          + Add a step
        </button>
      )}
      {retired.length > 0 && (
        <div className="son-retired">
          <h4 className="son-sub">Retired</h4>
          <ul>
            {retired.map((s) => (
              <li key={s.key}>
                <span>{s.title}</span>
                <button type="button" className="link-btn" disabled={busy} onClick={() => patch(s.key, { active: true, sort: nextSort }, "Step restored")}>
                  Restore
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function SON_ProgressTab() {
  const ctx = typeof StaffToolsContext !== "undefined" ? useContext(StaffToolsContext) : {};
  const staffUser = ctx && ctx.staffUser;
  const isAdmin = !!(staffUser && staffUser.role === "admin");
  const st = SON_useStore();
  const dir = typeof CV_useDirectory === "function" ? CV_useDirectory() : [];
  const [open, setOpen] = useState("");
  const showToast = useToast();
  if (!isAdmin) return <p className="card-subtitle">Only admins can see the team's onboarding progress.</p>;
  if (st.loading) return <p className="card-subtitle">Loading…</p>;
  if (st.error) return <p className="card-subtitle">{st.error}</p>;
  const steps = st.steps.filter((s) => s.active !== false);
  const people = dir
    .map((p) => ({ ...p, sum: OPS_onboardingSummary(st.steps, st.rows, p.email) }))
    .sort((a, b) => Number(a.sum.complete) - Number(b.sum.complete) || a.sum.pct - b.sum.pct || String(a.name).localeCompare(String(b.name)));
  return (
    <div className="son-tab">
      <section className="card son-admin-card">
        <h3 className="card-title">Progress</h3>
        <p className="card-subtitle">Each person ticks their own steps on Home. Click a name to see their steps or tick one for them.</p>
        {people.length === 0 ? (
          <p className="card-subtitle">No staff found.</p>
        ) : (
          <ul className="son-people">
            {people.map((p) => (
              <li key={p.email} className="son-person">
                <button type="button" className="son-person-head" aria-expanded={open === p.email} onClick={() => setOpen(open === p.email ? "" : p.email)}>
                  <span className="son-person-name">{p.name || p.email}</span>
                  <span className="ov-progress son-bar" aria-hidden="true">
                    <span style={{ width: p.sum.pct + "%" }} />
                  </span>
                  <span className="son-bar-text">
                    {p.sum.complete ? "Done" : `${p.sum.done} of ${p.sum.total}`}
                  </span>
                  <span className="son-person-when">
                    {p.sum.lastAt ? "Last ticked " + fmtDate(String(p.sum.lastAt).slice(0, 10)) : "Not started"}
                    {p.sum.dismissed && !p.sum.complete ? " · hid the card" : ""}
                  </span>
                </button>
                {open === p.email && (
                  <SON_StepList steps={steps} summary={p.sum} email={p.email} canTick onError={(m) => showToast("Couldn't save: " + m)} />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <SON_StepsAdmin steps={st.steps} />
    </div>
  );
}
