// ----------------------------------------------------------------------------
// Checklists inside a task (owner request 2026-09-30). Used by app.jsx's
// MyTasksPage.
//
//   task_checklist_items     the steps of one staff_reminders task (text,
//                            done, sort_order). Access follows the task's own
//                            RLS: whoever can read the task reads its
//                            checklist; whoever can update it can edit.
//   staff_checklist_presets  personal reusable checklists (name + items),
//                            private to their owner.
//   task_templates.checklist copied onto every generated task by
//                            tt_generate_template_tasks().
// SQL: supabase/task-checklists.sql and supabase/task-templates.sql.
//
// Loaded before app.jsx and shares its global scope: top-level names carry a
// TCL_ prefix; app.jsx globals (hooks, useToast) are only touched at render
// time.
// ----------------------------------------------------------------------------

const TCL_EVENT = "mgb:task-checklists-changed";
const TCL_MAX_ITEMS = 50;

function TCL_emit() {
  try {
    window.dispatchEvent(new Event(TCL_EVENT));
  } catch (e) {}
}

const TCL_safe = (p) => Promise.resolve(p).then((r) => r, (e) => ({ data: null, error: e }));

// Item texts of one task, in order (for "Save as template").
async function TCL_fetchTexts(sb, reminderId) {
  if (!sb || !reminderId) return [];
  const { data, error } = await TCL_safe(
    sb.from("task_checklist_items").select("text, sort_order").eq("reminder_id", reminderId).order("sort_order"),
  );
  if (error || !Array.isArray(data)) return [];
  return data
    .slice()
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
    .map((r) => r.text)
    .filter(Boolean)
    .slice(0, TCL_MAX_ITEMS);
}

// { [reminder_id]: { done, total } } for the given task ids.
function TCL_useCounts(taskIds) {
  const [counts, setCounts] = useState({});
  const key = (taskIds || []).filter((id) => /^[0-9a-f-]{36}$/i.test(String(id))).sort().join(",");
  const load = useCallback(async () => {
    const sb = window.mgbSupabase;
    if (!sb || !key) {
      setCounts({});
      return;
    }
    const ids = key.split(",");
    const out = {};
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await TCL_safe(
        sb.from("task_checklist_items").select("reminder_id, done").in("reminder_id", ids.slice(i, i + 200)).limit(5000),
      );
      if (error) {
        setCounts({});
        return;
      }
      (data || []).forEach((r) => {
        const c = out[r.reminder_id] || (out[r.reminder_id] = { done: 0, total: 0 });
        c.total += 1;
        if (r.done) c.done += 1;
      });
    }
    setCounts(out);
  }, [key]);
  useEffect(() => {
    load();
    window.addEventListener(TCL_EVENT, load);
    return () => window.removeEventListener(TCL_EVENT, load);
  }, [load]);
  return counts;
}

function TCL_Icon(props) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M4 6l1.5 1.5L8 5" />
      <path d="M4 12l1.5 1.5L8 11" />
      <path d="M4 18l1.5 1.5L8 17" />
      <path d="M11 6h9M11 12h9M11 18h9" />
    </svg>
  );
}

function TCL_Checklist({ task, canEdit }) {
  const showToast = typeof useToast === "function" ? useToast() : null;
  const toast = (m) => showToast && showToast(m);
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");
  const [newText, setNewText] = useState("");
  const [busy, setBusy] = useState(false);
  const [presets, setPresets] = useState([]);
  const [presetId, setPresetId] = useState("");
  const [saving, setSaving] = useState(false); // "save as my checklist" form open
  const [presetName, setPresetName] = useState("");
  const inputId = "tcl-add-" + task.id;

  const load = useCallback(async () => {
    const sb = window.mgbSupabase;
    if (!sb) {
      setItems([]);
      return;
    }
    const { data, error: err } = await TCL_safe(
      sb
        .from("task_checklist_items")
        .select("id, text, done, sort_order, done_by, done_at")
        .eq("reminder_id", task.id)
        .order("sort_order"),
    );
    if (err) {
      setError("Couldn't load the checklist. " + (err.message || ""));
      setItems([]);
      return;
    }
    setError("");
    setItems((data || []).slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)));
  }, [task.id]);

  const loadPresets = useCallback(async () => {
    const sb = window.mgbSupabase;
    if (!sb) return;
    const { data, error: err } = await TCL_safe(sb.from("staff_checklist_presets").select("id, name, items").order("name"));
    if (!err && Array.isArray(data)) setPresets(data);
  }, []);

  useEffect(() => {
    load();
    loadPresets();
  }, [load, loadPresets]);

  const nextOrder = () => (items && items.length ? Math.max(...items.map((i) => i.sort_order || 0)) + 1 : 0);

  const addTexts = async (texts) => {
    const sb = window.mgbSupabase;
    const clean = texts.map((t) => String(t || "").trim().slice(0, 300)).filter(Boolean);
    if (!sb || !clean.length) return false;
    const room = TCL_MAX_ITEMS - (items ? items.length : 0);
    if (room <= 0) {
      toast(`A checklist can have up to ${TCL_MAX_ITEMS} steps.`);
      return false;
    }
    const start = nextOrder();
    setBusy(true);
    const { error: err } = await sb
      .from("task_checklist_items")
      .insert(clean.slice(0, room).map((text, i) => ({ reminder_id: task.id, text, sort_order: start + i })));
    setBusy(false);
    if (err) {
      toast("Couldn't add to the checklist. " + (err.message || ""));
      return false;
    }
    await load();
    TCL_emit();
    return true;
  };

  const toggle = async (item) => {
    const sb = window.mgbSupabase;
    if (!sb) return;
    setItems((l) => l.map((x) => (x.id === item.id ? { ...x, done: !item.done } : x)));
    const { error: err } = await sb.from("task_checklist_items").update({ done: !item.done }).eq("id", item.id);
    if (err) {
      setItems((l) => l.map((x) => (x.id === item.id ? { ...x, done: item.done } : x)));
      toast("Couldn't update the step. " + (err.message || ""));
      return;
    }
    TCL_emit();
  };

  const remove = async (item) => {
    const sb = window.mgbSupabase;
    if (!sb) return;
    const { error: err } = await sb.from("task_checklist_items").delete().eq("id", item.id);
    if (err) {
      toast("Couldn't remove the step. " + (err.message || ""));
      return;
    }
    setItems((l) => l.filter((x) => x.id !== item.id));
    TCL_emit();
  };

  const move = async (idx, dir) => {
    const sb = window.mgbSupabase;
    const j = idx + dir;
    if (!sb || !items || j < 0 || j >= items.length) return;
    const a = items[idx];
    const b = items[j];
    const next = items.slice();
    next[idx] = { ...b, sort_order: a.sort_order };
    next[j] = { ...a, sort_order: b.sort_order };
    // Equal sort orders (e.g. both 0) can't be swapped; renumber instead.
    const renumber = a.sort_order === b.sort_order;
    const final = renumber ? next.map((x, i) => ({ ...x, sort_order: i })) : next;
    setItems(final);
    const changed = final.filter((x) => {
      const old = items.find((y) => y.id === x.id);
      return old && old.sort_order !== x.sort_order;
    });
    const results = await Promise.all(
      changed.map((x) => sb.from("task_checklist_items").update({ sort_order: x.sort_order }).eq("id", x.id)),
    );
    if (results.some((r) => r && r.error)) {
      toast("Couldn't reorder the checklist.");
      load();
    }
  };

  const applyPreset = async () => {
    const p = presets.find((x) => x.id === presetId);
    if (!p) return;
    if (await addTexts(p.items || [])) {
      toast(`Added "${p.name}".`);
      setPresetId("");
    }
  };

  const savePreset = async (e) => {
    e.preventDefault();
    const sb = window.mgbSupabase;
    const name = presetName.trim().slice(0, 80);
    const texts = (items || []).map((i) => i.text).slice(0, TCL_MAX_ITEMS);
    if (!sb || !name || !texts.length) return;
    const existing = presets.find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (existing && !window.confirm(`Replace your saved checklist "${existing.name}"?`)) return;
    const res = existing
      ? await sb.from("staff_checklist_presets").update({ items: texts }).eq("id", existing.id)
      : await sb.from("staff_checklist_presets").insert({ name, items: texts });
    if (res.error) {
      toast("Couldn't save the checklist. " + (res.error.message || ""));
      return;
    }
    toast(`Saved "${name}" to your checklists.`);
    setSaving(false);
    setPresetName("");
    loadPresets();
  };

  const deletePreset = async () => {
    const p = presets.find((x) => x.id === presetId);
    const sb = window.mgbSupabase;
    if (!p || !sb) return;
    if (!window.confirm(`Delete your saved checklist "${p.name}"? Tasks that already use it keep their steps.`)) return;
    const { error: err } = await sb.from("staff_checklist_presets").delete().eq("id", p.id);
    if (err) {
      toast("Couldn't delete. " + (err.message || ""));
      return;
    }
    setPresets((l) => l.filter((x) => x.id !== p.id));
    setPresetId("");
  };

  if (items === null) return <div className="tcl-panel tcl-loading">Loading checklist…</div>;
  const done = items.filter((i) => i.done).length;

  return (
    <div className="tcl-panel" role="group" aria-label={`Checklist for ${task.text}`}>
      {error && <p className="tcl-error">{error}</p>}
      {items.length > 0 && (
        <div className="tcl-progress" aria-hidden="true">
          <span className="tcl-bar">
            <span style={{ width: `${Math.round((done / items.length) * 100)}%` }} />
          </span>
          <span>
            {done} of {items.length} done
          </span>
        </div>
      )}
      {items.length > 0 ? (
        <ul className="tcl-list">
          {items.map((it, idx) => (
            <li key={it.id} className={"tcl-item" + (it.done ? " done" : "")}>
              <label className="tcl-check">
                <input type="checkbox" checked={it.done} disabled={!canEdit} onChange={() => toggle(it)} />
                <span>{it.text}</span>
              </label>
              {canEdit && (
                <span className="tcl-item-actions">
                  <button
                    type="button"
                    className="task-icon-btn tcl-mini"
                    onClick={() => move(idx, -1)}
                    disabled={idx === 0}
                    aria-label={`Move up: ${it.text}`}
                    title="Move up"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="task-icon-btn tcl-mini"
                    onClick={() => move(idx, 1)}
                    disabled={idx === items.length - 1}
                    aria-label={`Move down: ${it.text}`}
                    title="Move down"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="task-icon-btn tcl-mini"
                    onClick={() => remove(it)}
                    aria-label={`Remove step: ${it.text}`}
                    title="Remove step"
                  >
                    ×
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="tcl-empty">{canEdit ? "No steps yet. Add the first one below." : "No checklist on this task."}</p>
      )}

      {canEdit && (
        <form
          className="tcl-add"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await addTexts([newText])) setNewText("");
          }}
        >
          <label htmlFor={inputId} className="tcl-sr">
            Add a step
          </label>
          <input
            id={inputId}
            type="text"
            className="tcl-input"
            placeholder="Add a step, e.g. Download bank statements"
            maxLength={300}
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
          />
          <button type="submit" className="btn-secondary" disabled={busy || !newText.trim()}>
            Add
          </button>
        </form>
      )}

      {canEdit && (
        <div className="tcl-presets">
          {presets.length > 0 && (
            <span className="tcl-preset-pick">
              <label className="tcl-sr" htmlFor={"tcl-preset-" + task.id}>
                Saved checklist
              </label>
              <select
                id={"tcl-preset-" + task.id}
                className="tcl-input"
                value={presetId}
                onChange={(e) => setPresetId(e.target.value)}
              >
                <option value="">Use a saved checklist…</option>
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({(p.items || []).length})
                  </option>
                ))}
              </select>
              <button type="button" className="btn-secondary" onClick={applyPreset} disabled={!presetId || busy}>
                Add steps
              </button>
              {presetId && (
                <button type="button" className="link-btn tcl-danger" onClick={deletePreset}>
                  Delete saved
                </button>
              )}
            </span>
          )}
          {items.length > 0 &&
            (saving ? (
              <form className="tcl-save" onSubmit={savePreset}>
                <label className="tcl-sr" htmlFor={"tcl-name-" + task.id}>
                  Checklist name
                </label>
                <input
                  id={"tcl-name-" + task.id}
                  className="tcl-input"
                  placeholder="Name, e.g. Month-end close"
                  maxLength={80}
                  autoFocus
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                />
                <button type="submit" className="btn-secondary" disabled={!presetName.trim()}>
                  Save
                </button>
                <button type="button" className="link-btn" onClick={() => setSaving(false)}>
                  Cancel
                </button>
              </form>
            ) : (
              <button type="button" className="link-btn" onClick={() => setSaving(true)}>
                Save as my checklist
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
