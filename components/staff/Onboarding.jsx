// ----------------------------------------------------------------------------
// Client onboarding checklist (owner request 2026-09-29).
// Tables: onboarding_steps (the default list, admins edit) and
// client_onboarding (per-client ticks). See supabase/client-onboarding.sql.
//
// A step can also tick itself (auto_source):
//   'qbo'         qbo_connections has a 'connected' row for the client
//   'first_close' month_close has a 'done' row for the client (Close tracker)
//
// One shared store (OB_store) loads everything the signed-in staff member can
// see once, so the client overview card and the client picker badges read the
// same data. Writes here, and Close tracker saves (CT_ fires
// OB_CHANGED_EVENT), trigger a reload.
//
// Exposes:
//   OB_OnboardingCard   progress card on the client overview (staff only)
//   OB_OnboardingBadge  "Onboarding 3/5" tag for the client picker rows
//                       (hover: checklist popover; click: overview card)
//   OB_useOnboarding()  the store, for anything else that wants it
//
// Loaded before app.jsx and shares its global scope: every top-level name has
// an OB_ prefix, and app.jsx globals (hooks, ModalShell, useToast)
// are only touched at render time.
// ----------------------------------------------------------------------------

const OB_CHANGED_EVENT = "mgb:onboarding-changed";
const OB_AUTO_LABEL = { qbo: "Auto: QuickBooks", first_close: "Auto: Close tracker" };

const OB_store = {
  data: null, // { steps, rows: {clientId: {stepKey: row}}, qbo: Set, closed: Set, missing }
  loading: false,
  listeners: new Set(),
  emit() {
    this.listeners.forEach((fn) => {
      try {
        fn(this.data);
      } catch (e) {}
    });
  },
  async load() {
    const sb = window.mgbSupabase;
    if (!sb) {
      this.data = { steps: [], rows: {}, qbo: new Set(), closed: new Set(), missing: true };
      this.emit();
      return;
    }
    if (this.loading) return;
    this.loading = true;
    const safe = (p) => Promise.resolve(p).then((r) => r, (e) => ({ data: null, error: e }));
    const [steps, rows, qbo, closed] = await Promise.all([
      safe(sb.from("onboarding_steps").select("key, label, description, sort_order, auto_source, active").order("sort_order")),
      safe(sb.from("client_onboarding").select("client_id, step_key, done, done_by, done_at")),
      safe(sb.from("qbo_connections").select("client_id, status")),
      safe(sb.from("month_close").select("client_id").eq("status", "done")),
    ]);
    this.loading = false;
    const byClient = {};
    (rows.data || []).forEach((r) => {
      (byClient[r.client_id] = byClient[r.client_id] || {})[r.step_key] = r;
    });
    this.data = {
      steps: steps.data || [],
      rows: byClient,
      qbo: new Set((qbo.data || []).filter((r) => r.status === "connected").map((r) => r.client_id)),
      closed: new Set((closed.data || []).map((r) => r.client_id)),
      missing: !!steps.error,
    };
    this.emit();
  },
};

try {
  window.addEventListener(OB_CHANGED_EVENT, () => OB_store.load());
} catch (e) {}

function OB_useOnboarding() {
  const [data, setData] = useState(OB_store.data);
  useEffect(() => {
    const fn = (d) => setData(d);
    OB_store.listeners.add(fn);
    if (!OB_store.data) OB_store.load();
    else setData(OB_store.data);
    return () => OB_store.listeners.delete(fn);
  }, []);
  return data;
}

// Per-step state for one client.
function OB_clientSteps(data, clientId) {
  if (!data) return [];
  const rows = data.rows[clientId] || {};
  return data.steps
    .filter((s) => s.active)
    .map((s) => {
      const row = rows[s.key];
      const manual = !!(row && row.done);
      const auto =
        (s.auto_source === "qbo" && data.qbo.has(clientId)) ||
        (s.auto_source === "first_close" && data.closed.has(clientId));
      return { ...s, row, manual, auto, done: manual || auto };
    });
}

function OB_progress(data, clientId) {
  const steps = OB_clientSteps(data, clientId);
  return { total: steps.length, done: steps.filter((s) => s.done).length };
}

// Clicking the picker badge asks the client overview to scroll its Onboarding
// card into view. The request is kept here (not just fired as an event)
// because the overview usually mounts after the click switches client/page;
// the card checks it on mount and when the event fires. app.jsx listens for
// the same event to open that client's overview.
const OB_FOCUS_EVENT = "mgb:focus-onboarding";
let OB_focusRequest = null; // { clientId, at }

function OB_requestFocus(clientId) {
  OB_focusRequest = { clientId, at: Date.now() };
  try {
    window.dispatchEvent(new CustomEvent(OB_FOCUS_EVENT, { detail: { clientId } }));
  } catch (e) {}
}

// Picker badge: hover (or keyboard focus) shows the checklist in a small
// popover; click / Enter opens the client overview at the Onboarding card.
// The popover is portalled to <body> with position:fixed so the picker's
// scrolling list can't clip it.
function OB_OnboardingBadge({ clientId, onOpen }) {
  const data = OB_useOnboarding();
  const badgeRef = useRef(null);
  const popRef = useRef(null);
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState(null);

  React.useLayoutEffect(() => {
    if (!show) {
      setPos(null);
      return;
    }
    const place = () => {
      const b = badgeRef.current;
      const p = popRef.current;
      if (!b || !p) return;
      const r = b.getBoundingClientRect();
      const m = 8;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const w = p.offsetWidth;
      const h = p.offsetHeight;
      let left = Math.min(r.left, vw - m - w);
      left = Math.max(m, left);
      let top = r.bottom + 6;
      if (top + h > vh - m) top = r.top - 6 - h;
      top = Math.max(m, Math.min(top, vh - m - h));
      setPos({ top, left });
    };
    place();
    // The list scrolling under a fixed popover would detach it; just hide.
    const hide = () => setShow(false);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [show]);

  if (!data || data.missing) return null;
  const steps = OB_clientSteps(data, clientId);
  const total = steps.length;
  const done = steps.filter((s) => s.done).length;
  if (!total || done >= total) return null;

  const popId = `ob-pop-${clientId}`;
  const open = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setShow(false);
    OB_requestFocus(clientId);
    if (onOpen) onOpen();
  };
  const onFocus = (e) => {
    let keyboard = true;
    try {
      keyboard = e.currentTarget.matches(":focus-visible");
    } catch (err) {}
    if (keyboard) setShow(true);
  };

  return (
    <>
      <span
        ref={badgeRef}
        className="cs-tag ob-badge"
        role="button"
        tabIndex={0}
        aria-label={`Onboarding: ${done} of ${total} steps done. Open the checklist`}
        aria-describedby={show ? popId : undefined}
        onPointerEnter={(e) => {
          if (e.pointerType === "mouse") setShow(true);
        }}
        onPointerLeave={() => setShow(false)}
        onFocus={onFocus}
        onBlur={() => setShow(false)}
        onClick={open}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") open(e);
          else if (e.key === "Escape" && show) {
            e.stopPropagation();
            setShow(false);
          }
        }}
      >
        Onboarding {done}/{total}
      </span>
      {show &&
        ReactDOM.createPortal(
          <div
            ref={popRef}
            id={popId}
            role="tooltip"
            className="ob-pop"
            style={pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0, visibility: "hidden" }}
          >
            <div className="ob-pop-head">
              Onboarding · {done} of {total} done
            </div>
            <ul className="ob-pop-steps">
              {steps.map((s) => (
                <li key={s.key} className={"ob-pop-step" + (s.done ? " done" : "")}>
                  <span className="ob-pop-box" aria-hidden="true">
                    {s.done ? "✓" : ""}
                  </span>
                  <span className="ob-pop-name">
                    <span className="ob-pop-sr">{s.done ? "Done: " : "To do: "}</span>
                    {s.label}
                  </span>
                  {s.auto_source && OB_AUTO_LABEL[s.auto_source] && (
                    <span className="ob-pop-auto">{OB_AUTO_LABEL[s.auto_source]}</span>
                  )}
                </li>
              ))}
            </ul>
            <div className="ob-pop-foot">Click to open the checklist</div>
          </div>,
          document.body,
        )}
    </>
  );
}

const OB_ENTITY_TYPES = [
  { value: "nonprofit", label: "Nonprofit" },
  { value: "for_profit", label: "For-profit" },
];

function OB_OnboardingCard({ client, staffUser }) {
  const data = OB_useOnboarding();
  const showToast = typeof useToast === "function" ? useToast() : null;
  const [busy, setBusy] = useState(null);
  const [editing, setEditing] = useState(false);
  const [entityType, setEntityType] = useState((client && client.entityType) || "nonprofit");
  const isAdmin = !!(staffUser && staffUser.role === "admin");
  const toast = (m) => {
    if (showToast) showToast(m);
  };
  useEffect(() => {
    setEntityType((client && client.entityType) || "nonprofit");
  }, [client && client.id, client && client.entityType]);

  // Picker badge click: scroll here and flash a gold outline. Waits for the
  // data so the card has its full height before scrolling.
  const cardRef = useRef(null);
  const clientIdForFocus = client && client.id;
  const hasData = !!data;
  useEffect(() => {
    if (!clientIdForFocus) return;
    const tryFocus = () => {
      const req = OB_focusRequest;
      if (!req || req.clientId !== clientIdForFocus || Date.now() - req.at > 15000) return;
      if (!OB_store.data) return;
      const el = cardRef.current;
      if (!el) return;
      OB_focusRequest = null;
      setTimeout(() => {
        let reduce = false;
        try {
          reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        } catch (e) {}
        if (el.scrollIntoView) el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
        el.classList.remove("ob-focus");
        void el.offsetWidth; // restart the animation
        el.classList.add("ob-focus");
        setTimeout(() => el.classList.remove("ob-focus"), 2400);
      }, 80);
    };
    tryFocus();
    window.addEventListener(OB_FOCUS_EVENT, tryFocus);
    return () => window.removeEventListener(OB_FOCUS_EVENT, tryFocus);
  }, [clientIdForFocus, hasData]);

  // clients.entity_type via set_client_entity_type() (supabase/
  // client-entity-type.sql): any staff member with access to the client can
  // set it here. Stored and shown only for now; later phases use it for
  // report wording.
  const saveEntityType = async (next) => {
    const sb = window.mgbSupabase;
    const prev = entityType;
    setEntityType(next);
    if (!sb) return;
    setBusy("entity_type");
    const { error } = await sb.rpc("set_client_entity_type", { p_client_id: client.id, p_entity_type: next });
    setBusy(null);
    if (error) {
      setEntityType(prev);
      toast("Couldn't save the organization type. " + (error.message || ""));
      return;
    }
    client.entityType = next;
    toast(next === "for_profit" ? "Marked as a for-profit business." : "Marked as a nonprofit.");
  };

  if (!data) {
    return (
      <div ref={cardRef} className="card ob-card">
        <h3 className="card-title">Onboarding</h3>
        <p className="card-subtitle">Loading…</p>
      </div>
    );
  }
  if (data.missing) {
    return (
      <div ref={cardRef} className="card ob-card">
        <h3 className="card-title">Onboarding</h3>
        <p className="card-subtitle">The onboarding checklist isn't available (sign in, or the migration isn't applied).</p>
      </div>
    );
  }

  const steps = OB_clientSteps(data, client.id);
  const done = steps.filter((s) => s.done).length;
  const pct = steps.length ? Math.round((done / steps.length) * 100) : 0;

  const toggle = async (s) => {
    const sb = window.mgbSupabase;
    if (!sb) return;
    setBusy(s.key);
    const { error } = await sb
      .from("client_onboarding")
      .upsert({ client_id: client.id, step_key: s.key, done: !s.manual }, { onConflict: "client_id,step_key" });
    setBusy(null);
    if (error) {
      toast("Couldn't save that step. " + (error.message || ""));
      return;
    }
    window.dispatchEvent(new Event(OB_CHANGED_EVENT));
  };

  return (
    <div ref={cardRef} className="card ob-card">
      <div className="ob-head">
        <h3 className="card-title">Onboarding</h3>
        <span className={"ob-count" + (done === steps.length && steps.length ? " complete" : "")}>
          {steps.length ? `${done} of ${steps.length}` : "No steps"}
        </span>
      </div>
      <div className="bar-track ob-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Onboarding progress">
        <div className="bar-fill ob-bar-fill" style={{ width: pct + "%" }} />
      </div>
      <label className="ob-entity">
        <span>Organization type</span>
        <select
          className="ob-input"
          value={entityType}
          disabled={busy === "entity_type"}
          onChange={(e) => saveEntityType(e.target.value)}
        >
          {OB_ENTITY_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <ul className="ob-steps">
        {steps.map((s) => (
          <li key={s.key} className={"ob-step" + (s.done ? " done" : "")}>
            <label className="ob-step-label">
              <input
                type="checkbox"
                checked={s.done}
                disabled={busy === s.key || (s.auto && !s.manual)}
                onChange={() => toggle(s)}
              />
              <span className="ob-step-text">
                <span className="ob-step-name">{s.label}</span>
                {s.description && <span className="ob-step-desc">{s.description}</span>}
                {s.manual && s.row && s.row.done_at && (
                  <span className="ob-step-desc">
                    {String(s.row.done_by || "").split("@")[0] || "Someone"} · {new Date(s.row.done_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </span>
                )}
              </span>
            </label>
            {s.auto_source && (
              <span className={"task-chip ob-auto" + (s.auto ? " on" : "")} title={s.auto ? "Detected automatically" : "Will tick itself when detected"}>
                {OB_AUTO_LABEL[s.auto_source]}
              </span>
            )}
          </li>
        ))}
      </ul>
      {isAdmin && (
        <button type="button" className="link-btn" onClick={() => setEditing(true)}>
          Edit default steps
        </button>
      )}
      {editing && <OB_StepsEditor steps={data.steps} onClose={() => setEditing(false)} toast={toast} />}
    </div>
  );
}

const OB_slug = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);

function OB_StepsEditor({ steps, onClose, toast }) {
  const [list, setList] = useState(() => steps.map((s) => ({ ...s })));
  const [newLabel, setNewLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const sb = window.mgbSupabase;

  const refresh = () => window.dispatchEvent(new Event(OB_CHANGED_EVENT));

  const patch = async (key, fields) => {
    setList((l) => l.map((s) => (s.key === key ? { ...s, ...fields } : s)));
    if (!sb) return;
    const { error } = await sb.from("onboarding_steps").update(fields).eq("key", key);
    if (error) toast("Couldn't save the step. " + (error.message || ""));
    refresh();
  };

  const move = async (idx, dir) => {
    const j = idx + dir;
    if (j < 0 || j >= list.length) return;
    const next = list.slice();
    [next[idx], next[j]] = [next[j], next[idx]];
    const renum = next.map((s, i) => ({ ...s, sort_order: (i + 1) * 10 }));
    setList(renum);
    if (!sb) return;
    const results = await Promise.all(
      renum.map((s) => sb.from("onboarding_steps").update({ sort_order: s.sort_order }).eq("key", s.key)),
    );
    if (results.some((r) => r.error)) toast("Couldn't save the new order.");
    refresh();
  };

  const add = async (e) => {
    e.preventDefault();
    const label = newLabel.trim();
    if (!label) return;
    let key = OB_slug(label) || "step";
    while (list.some((s) => s.key === key)) key = (key + "_2").slice(0, 40);
    const row = { key, label, sort_order: (list.length + 1) * 10, active: true, auto_source: null, description: null };
    setSaving(true);
    const { error } = sb ? await sb.from("onboarding_steps").insert(row) : { error: null };
    setSaving(false);
    if (error) {
      toast("Couldn't add the step. " + (error.message || ""));
      return;
    }
    setList((l) => [...l, row]);
    setNewLabel("");
    refresh();
  };

  return (
    <ModalShell onClose={onClose} labelledBy="ob-edit-title" className="ob-modal">
      <div className="ob-modal-body">
        <h3 id="ob-edit-title" className="card-title">Default onboarding steps</h3>
        <p className="card-subtitle">
          Every client gets these steps. Hiding a step keeps what's already been ticked. Changes save as you go.
        </p>
        <ul className="ob-edit-list">
          {list.map((s, i) => (
            <li key={s.key} className={"ob-edit-row" + (s.active ? "" : " inactive")}>
              <div className="ob-edit-move">
                <button type="button" className="ob-move-btn" aria-label={`Move ${s.label} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                  ↑
                </button>
                <button type="button" className="ob-move-btn" aria-label={`Move ${s.label} down`} disabled={i === list.length - 1} onClick={() => move(i, 1)}>
                  ↓
                </button>
              </div>
              <div className="ob-edit-fields">
                <input
                  className="ob-input"
                  value={s.label}
                  aria-label="Step name"
                  maxLength={120}
                  onChange={(e) => setList((l) => l.map((x) => (x.key === s.key ? { ...x, label: e.target.value } : x)))}
                  onBlur={(e) => e.target.value.trim() && patch(s.key, { label: e.target.value.trim() })}
                />
                <input
                  className="ob-input ob-input-desc"
                  value={s.description || ""}
                  placeholder="Short description (optional)"
                  aria-label="Step description"
                  onChange={(e) => setList((l) => l.map((x) => (x.key === s.key ? { ...x, description: e.target.value } : x)))}
                  onBlur={(e) => patch(s.key, { description: e.target.value.trim() || null })}
                />
                <div className="ob-edit-opts">
                  <select
                    className="ob-input"
                    value={s.auto_source || ""}
                    aria-label="Automatic detection"
                    onChange={(e) => patch(s.key, { auto_source: e.target.value || null })}
                  >
                    <option value="">Manual only</option>
                    <option value="qbo">Auto: QuickBooks connected</option>
                    <option value="first_close">Auto: first month closed</option>
                  </select>
                  <label className="ob-check">
                    <input type="checkbox" checked={s.active} onChange={(e) => patch(s.key, { active: e.target.checked })} />
                    Shown
                  </label>
                </div>
              </div>
            </li>
          ))}
        </ul>
        <form className="ob-add" onSubmit={add}>
          <input
            className="ob-input"
            placeholder="New step, e.g. Payroll set up"
            value={newLabel}
            maxLength={120}
            onChange={(e) => setNewLabel(e.target.value)}
            aria-label="New step name"
          />
          <button type="submit" className="btn-primary" disabled={saving || !newLabel.trim()}>
            Add step
          </button>
        </form>
        <div className="ob-modal-foot">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
