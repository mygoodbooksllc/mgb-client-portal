// components/ledger/LR_Settings.jsx — Team › Ledger review (admin settings).
// docs/gl-review-spec.md sections 3.7, 6 and 13.
//
//   LR_SettingsPanel({ staffUser, isAdmin })
//
// Firm-wide settings (gl_review_settings, one row) and the vendor watch list
// (gl_review_watch_vendors). Admins edit through gl_review_save_settings and
// gl_review_save_watch_vendor; everyone else sees it read-only.

const LR_WATCH_CATEGORIES = [
  { key: "streaming", label: "Streaming" },
  { key: "liquor", label: "Liquor" },
  { key: "gambling", label: "Gambling" },
  { key: "personal_payment", label: "Personal payment app" },
  { key: "other", label: "Other" },
];
const LR_watchCatLabel = (k) => (LR_WATCH_CATEGORIES.find((c) => c.key === k) || { label: k || "Other" }).label;

function LR_WatchRow({ row, isAdmin, onSave }) {
  const [edit, setEdit] = useState(false);
  const [pattern, setPattern] = useState(row.pattern || "");
  const [category, setCategory] = useState(row.category || "other");
  const [note, setNote] = useState(row.note || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const id = "lrw-" + row.id;
  const valid = pattern.trim().length >= 2 && pattern.trim().length <= 80;
  const save = async (patch) => {
    setBusy(true);
    setErr("");
    try {
      await onSave(row.id, { pattern: pattern.trim(), category, note: note.trim(), active: row.active !== false, ...(patch || {}) });
      setEdit(false);
    } catch (e) {
      setErr((e && e.message) || "Couldn't save.");
    } finally {
      setBusy(false);
    }
  };
  if (!edit) {
    return (
      <li className={"lr-rule" + (row.active === false ? " is-off" : "")}>
        <span className="lr-rule-text">
          <strong>{row.pattern}</strong> <span className="lr-kind">{LR_watchCatLabel(row.category)}</span>
          {row.active === false ? <span className="lr-kind is-warn">Off</span> : null}
          {row.note ? <span className="lr-meta-note">{row.note}</span> : null}
        </span>
        {isAdmin && (
          <span className="lr-rule-actions">
            <button type="button" className="btn-secondary lr-btn-sm" onClick={() => setEdit(true)} aria-label={"Edit " + row.pattern}>
              Edit
            </button>
            <button
              type="button"
              className="link-btn lr-btn-sm"
              disabled={busy}
              onClick={() => save({ active: row.active === false })}
              aria-label={(row.active === false ? "Turn on " : "Turn off ") + row.pattern}
            >
              {row.active === false ? "Turn on" : "Turn off"}
            </button>
          </span>
        )}
        {err && (
          <p className="lr-error" role="alert">
            {err}
          </p>
        )}
      </li>
    );
  }
  return (
    <li className="lr-rule is-editing">
      <form
        className="lr-watch-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid && !busy) save();
        }}
      >
        <label className="ct-legend" htmlFor={id + "-p"}>
          Name contains
        </label>
        <input id={id + "-p"} className="lr-input" value={pattern} maxLength={80} onChange={(e) => setPattern(e.target.value)} />
        <label className="ct-legend" htmlFor={id + "-c"}>
          Category
        </label>
        <select id={id + "-c"} className="lr-select" value={category} onChange={(e) => setCategory(e.target.value)}>
          {LR_WATCH_CATEGORIES.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>
        <label className="ct-legend" htmlFor={id + "-n"}>
          Note (optional)
        </label>
        <input id={id + "-n"} className="lr-input" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
        <div className="lr-inline">
          <button type="submit" className="btn-primary lr-btn-sm" disabled={!valid || busy}>
            {busy ? "Saving…" : "Save"}
          </button>
          <button type="button" className="btn-secondary lr-btn-sm" disabled={busy} onClick={() => setEdit(false)}>
            Cancel
          </button>
        </div>
        {err && (
          <p className="lr-error" role="alert">
            {err}
          </p>
        )}
      </form>
    </li>
  );
}

function LR_SettingsPanel({ staffUser, isAdmin }) {
  const showToast = typeof useToast === "function" ? useToast() : null;
  const toast = (m) => showToast && showToast(m);
  const [state, setState] = useState({ loading: true, error: "", settings: null, watch: [] });
  const [gate, setGate] = useState("warn");
  const [win, setWin] = useState("rolling14");
  const [from, setFrom] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState("");
  const [add, setAdd] = useState({ pattern: "", category: "other", note: "" });
  const [addBusy, setAddBusy] = useState(false);
  const [addErr, setAddErr] = useState("");
  const [showOff, setShowOff] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await LR_api.loadSettings();
      const s = r.settings || { done_gate: "warn", pull_window: "rolling14", effective_from: null };
      setState({ loading: false, error: "", settings: s, watch: r.watch || [] });
      setGate(s.done_gate || "warn");
      setWin(s.pull_window || "rolling14");
      setFrom(s.effective_from ? String(s.effective_from).slice(0, 7) : "");
    } catch (e) {
      setState({ loading: false, error: (e && e.message) || "Couldn't load the settings.", settings: null, watch: [] });
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const s = state.settings || {};
  const dirty = gate !== (s.done_gate || "warn") || win !== (s.pull_window || "rolling14") || from !== (s.effective_from ? String(s.effective_from).slice(0, 7) : "");

  const saveSettings = async (e) => {
    e.preventDefault();
    if (!isAdmin || saving) return;
    setSaving(true);
    setSaveErr("");
    try {
      await LR_api.saveSettings(gate, win, from ? from + "-01" : null);
      toast("Ledger review settings saved.");
      // The Close step count (six or seven) depends on effective_from and the
      // done gate: refresh the shared cache so open pages update.
      if (typeof closeStepsLoad === "function") closeStepsLoad(true);
      await load();
    } catch (x) {
      setSaveErr((x && x.message) || "Couldn't save.");
    } finally {
      setSaving(false);
    }
  };
  const saveWatch = async (id, v) => {
    await LR_api.saveWatchVendor(id, v.pattern, v.category, v.note, v.active);
    toast("Watch list saved.");
    await load();
  };
  const addWatch = async (e) => {
    e.preventDefault();
    const p = add.pattern.trim();
    if (p.length < 2 || addBusy) return;
    setAddBusy(true);
    setAddErr("");
    try {
      await LR_api.saveWatchVendor(null, p, add.category, add.note.trim(), true);
      setAdd({ pattern: "", category: "other", note: "" });
      toast(`"${p}" added to the watch list.`);
      await load();
    } catch (x) {
      setAddErr((x && x.message) || "Couldn't add it.");
    } finally {
      setAddBusy(false);
    }
  };

  if (state.loading)
    return (
      <p className="card-subtitle" role="status">
        Loading Ledger review settings…
      </p>
    );
  if (state.error)
    return (
      <p className="lr-error" role="alert">
        {state.error}
      </p>
    );

  const watchOn = state.watch.filter((w) => w.active !== false);
  const watchOff = state.watch.filter((w) => w.active === false);
  const ro = !isAdmin;

  return (
    <div className="lr-page lr-settings">
      {ro && (
        <p className="lr-note" role="note">
          Only admins can change these settings.
        </p>
      )}
      <section className="card lr-panel" aria-labelledby="lrs-h">
        <h3 className="card-title" id="lrs-h">
          Ledger review settings
        </h3>
        <p className="card-subtitle">These apply to every client.</p>
        <form onSubmit={saveSettings}>
          <fieldset className="lr-fieldset" disabled={ro}>
            <legend className="ct-legend">If the ledger review isn't approved when a month is marked Done</legend>
            <label className="lr-radio">
              <input type="radio" name="lrs-gate" value="warn" checked={gate === "warn"} onChange={() => setGate("warn")} />
              <span>
                Warn, then let them mark it Done (recommended)
                <span className="lr-hint">The Close tab shows that the "Ledger reviewed" step isn't finished.</span>
              </span>
            </label>
            <label className="lr-radio">
              <input type="radio" name="lrs-gate" value="block" checked={gate === "block"} onChange={() => setGate("block")} />
              <span>
                Block until they're cleared
                <span className="lr-hint">A month can't be marked Done on the Close tab until its ledger review is approved. Admins can override with a reason.</span>
              </span>
            </label>
          </fieldset>
          <label className="ct-legend" htmlFor="lrs-win">
            Pull transactions back to
          </label>
          <select id="lrs-win" className="lr-select" value={win} disabled={ro} onChange={(e) => setWin(e.target.value)}>
            <option value="rolling14">Usual range: 14 months back (recommended)</option>
            <option value="ytd">This year so far (lighter)</option>
          </select>
          <p className="lr-hint">
            14 months covers the year comparison and lets the app mark flags fixed when they drop out of QuickBooks. "This year so far" is
            lighter but skips both in January. Staff can choose an earlier month (up to 24 months back) for a single pull on the client's Ledger review tab; that never changes this setting.
          </p>
          <label className="ct-legend" htmlFor="lrs-from">
            Count the Close step from
          </label>
          <input id="lrs-from" type="month" className="lr-input" value={from} disabled={ro} onChange={(e) => setFrom(e.target.value)} />
          <p className="lr-hint">The "Ledger reviewed" Close step only counts from this month on.</p>
          {saveErr && (
            <p className="lr-error" role="alert">
              {saveErr}
            </p>
          )}
          {!ro && (
            <div className="lr-inline">
              <button type="submit" className="btn-primary" disabled={!dirty || saving}>
                {saving ? "Saving…" : "Save settings"}
              </button>
              {s.updated_at && (
                <span className="lr-hint">
                  Last changed {typeof relTime === "function" ? relTime(s.updated_at) : String(s.updated_at).slice(0, 10)}
                  {s.updated_by ? " by " + LR_logic.who(s.updated_by) : ""}
                </span>
              )}
            </div>
          )}
        </form>
      </section>

      <section className="card lr-panel" aria-labelledby="lrw-h">
        <h3 className="card-title" id="lrw-h">
          Vendor watch list
        </h3>
        <p className="card-subtitle">
          Transactions whose name or memo contains one of these get a "Watch-list vendor" flag, for every client. Keep it to names that are
          almost never an organization expense.
        </p>
        {watchOn.length === 0 ? (
          <p className="card-subtitle">The list is empty, so nothing is flagged as a watch-list vendor.</p>
        ) : (
          <ul className="lr-rule-list">
            {watchOn.map((w) => (
              <LR_WatchRow key={w.id} row={w} isAdmin={isAdmin} onSave={saveWatch} />
            ))}
          </ul>
        )}
        {watchOff.length > 0 && (
          <>
            <button type="button" className="link-btn lr-btn-sm" aria-expanded={showOff} onClick={() => setShowOff((v) => !v)}>
              {showOff ? "Hide" : "Show"} {watchOff.length} turned off
            </button>
            {showOff && (
              <ul className="lr-rule-list">
                {watchOff.map((w) => (
                  <LR_WatchRow key={w.id} row={w} isAdmin={isAdmin} onSave={saveWatch} />
                ))}
              </ul>
            )}
          </>
        )}
        {isAdmin && (
          <form className="lr-watch-form lr-watch-add" onSubmit={addWatch}>
            <h4 className="lr-sub-h">Add a name</h4>
            <label className="ct-legend" htmlFor="lrw-add-p">
              Name contains
            </label>
            <input
              id="lrw-add-p"
              className="lr-input"
              value={add.pattern}
              maxLength={80}
              placeholder="e.g. draftkings"
              onChange={(e) => setAdd({ ...add, pattern: e.target.value })}
            />
            <label className="ct-legend" htmlFor="lrw-add-c">
              Category
            </label>
            <select id="lrw-add-c" className="lr-select" value={add.category} onChange={(e) => setAdd({ ...add, category: e.target.value })}>
              {LR_WATCH_CATEGORIES.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
            <label className="ct-legend" htmlFor="lrw-add-n">
              Note (optional)
            </label>
            <input id="lrw-add-n" className="lr-input" value={add.note} maxLength={500} onChange={(e) => setAdd({ ...add, note: e.target.value })} />
            {addErr && (
              <p className="lr-error" role="alert">
                {addErr}
              </p>
            )}
            <div className="lr-inline">
              <button type="submit" className="btn-primary lr-btn-sm" disabled={add.pattern.trim().length < 2 || addBusy}>
                {addBusy ? "Adding…" : "Add to the list"}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
