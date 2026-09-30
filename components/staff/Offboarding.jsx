// Staff offboarding wizard (supabase/staff-offboarding.sql). Opened from the
// "Offboard" button on Staff Access. Top-level names use the OFF_ prefix.
//
// Steps: 1 choose replacements -> 2 review summary -> 3 confirm by typing the
// person's name -> done. Everything happens in one RPC (offboard_staff), so
// it either all lands or none of it does. The staff row is never deleted.

const OFF_NONE = "__none__"; // "no replacement, just unassign"

function OFF_OffboardButton({ row, staffRows, onDone, disabled }) {
  const [open, setOpen] = React.useState(false);
  return (
    <React.Fragment>
      <button
        type="button"
        className="btn-secondary off-btn"
        onClick={() => setOpen(true)}
        disabled={disabled}
      >
        Offboard
      </button>
      {open && (
        <OFF_Wizard
          row={row}
          staffRows={staffRows}
          onClose={() => setOpen(false)}
          onDone={() => {
            setOpen(false);
            if (onDone) onDone();
          }}
        />
      )}
    </React.Fragment>
  );
}

function OFF_plural(n, one, many) {
  return `${n} ${n === 1 ? one : many || one + "s"}`;
}

function OFF_Wizard({ row, staffRows, onClose, onDone }) {
  const supabase = window.mgbSupabase;
  const showToast = typeof useToast === "function" ? useToast() : () => {};
  const [preview, setPreview] = React.useState(null);
  const [loadError, setLoadError] = React.useState("");
  const [step, setStep] = React.useState(1);
  const [mode, setMode] = React.useState("one"); // "one" | "each"
  const [allTo, setAllTo] = React.useState("");
  const [perClient, setPerClient] = React.useState({});
  const [typed, setTyped] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [runError, setRunError] = React.useState("");
  const [result, setResult] = React.useState(null);

  const displayName = row.name || row.email;
  const candidates = React.useMemo(
    () =>
      (staffRows || [])
        .filter((s) => s.active && s.email !== row.email)
        .sort((a, b) => String(a.name || a.email).localeCompare(String(b.name || b.email))),
    [staffRows, row.email],
  );
  const nameOf = (email) => {
    if (!email || email === OFF_NONE) return "No one";
    const s = candidates.find((c) => c.email === email);
    return s ? s.name || s.email : email;
  };

  React.useEffect(() => {
    if (!supabase) {
      setLoadError("Supabase isn't configured.");
      return undefined;
    }
    let alive = true;
    supabase.rpc("offboard_staff_preview", { p_email: row.email }).then(({ data, error }) => {
      if (!alive) return;
      if (error) {
        setLoadError(
          /offboard_staff_preview/.test(error.message || "")
            ? "Offboarding isn't set up yet (supabase/staff-offboarding.sql)."
            : error.message,
        );
        return;
      }
      setPreview(data || {});
    });
    return () => {
      alive = false;
    };
  }, [supabase, row.email]);

  // Clients whose work needs routing: assigned ones plus any others with
  // open tasks (e.g. from a temporary grant).
  const routeClients = React.useMemo(() => {
    if (!preview) return [];
    const a = (preview.clients || []).map((c) => ({ ...c, assigned: true }));
    const b = (preview.other_task_clients || []).map((c) => ({ ...c, assigned: false }));
    return a.concat(b);
  }, [preview]);

  const targetFor = (clientId) => {
    if (mode === "one") return allTo || OFF_NONE;
    return perClient[clientId] || allTo || OFF_NONE;
  };

  const noClientTasks = (preview && preview.open_tasks_no_client) || 0;
  const fallbackName = allTo ? nameOf(allTo) : "you";

  const payload = () => {
    const clients = {};
    routeClients.forEach((c) => {
      const t = targetFor(c.client_id);
      clients[c.client_id] = t === OFF_NONE ? null : t;
    });
    return { default: allTo || null, clients };
  };

  const summary = React.useMemo(() => {
    if (!preview) return null;
    const lines = [];
    const groups = {};
    routeClients
      .filter((c) => c.assigned)
      .forEach((c) => {
        const t = targetFor(c.client_id);
        (groups[t] = groups[t] || []).push(c.client_name || c.client_id);
      });
    Object.entries(groups).forEach(([t, names]) => {
      lines.push(
        t === OFF_NONE
          ? `Unassign ${OFF_plural(names.length, "client")} with no replacement: ${names.join(", ")}`
          : `Give ${nameOf(t)} ${OFF_plural(names.length, "client")}: ${names.join(", ")}`,
      );
    });
    const tasks = preview.open_tasks_total || 0;
    if (tasks) {
      lines.push(
        `Move ${OFF_plural(tasks, "open task")} to the client's new person` +
          (noClientTasks || routeClients.some((c) => targetFor(c.client_id) === OFF_NONE)
            ? ` (tasks with no replacement go to ${fallbackName})`
            : ""),
      );
    }
    if (preview.live_grants) lines.push(`Revoke ${OFF_plural(preview.live_grants, "live temporary access grant")}`);
    if (preview.pending_grants) lines.push(`Cancel ${OFF_plural(preview.pending_grants, "pending access request")}`);
    if (preview.temp_admin) lines.push("End their temporary admin access");
    lines.push(`Deactivate ${displayName}. Their staff record and history stay.`);
    return lines;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, routeClients, mode, allTo, perClient]);

  const nameMatches = typed.trim().toLowerCase() === String(displayName).trim().toLowerCase();

  async function run() {
    setBusy(true);
    setRunError("");
    const { data, error } = await supabase.rpc("offboard_staff", {
      p_email: row.email,
      p_reassign: payload(),
    });
    setBusy(false);
    if (error) {
      setRunError(error.message || "Couldn't offboard.");
      return;
    }
    setResult(data || {});
    setStep(4);
    showToast(`${displayName} is offboarded.`);
  }

  const replacementSelect = (value, onChange, id, allowNone = true) => (
    <select id={id} className="off-select" value={value} onChange={(e) => onChange(e.target.value)}>
      {allowNone && <option value="">{id === "off-all" ? "Choose a person…" : "Same as above"}</option>}
      {id !== "off-all" && <option value={OFF_NONE}>No one (just unassign)</option>}
      {candidates.map((c) => (
        <option key={c.email} value={c.email}>
          {c.name || c.email}
          {c.role === "admin" ? " (admin)" : ""}
        </option>
      ))}
    </select>
  );

  const nothingToMove =
    preview &&
    !routeClients.length &&
    !preview.open_tasks_total &&
    !preview.live_grants &&
    !preview.pending_grants &&
    !preview.temp_admin;

  return (
    <ModalShell onClose={busy ? () => {} : step === 4 ? onDone : onClose} labelledBy="off-title" className="off-modal">
      <div className="modal-header">
        <h3 className="card-title" id="off-title" style={{ margin: 0 }}>
          {step === 4 ? `${displayName} offboarded` : `Offboard ${displayName}`}
        </h3>
        <button
          type="button"
          className="modal-close"
          onClick={step === 4 ? onDone : onClose}
          disabled={busy}
          aria-label="Close"
        >
          ×
        </button>
      </div>

      {step < 4 && (
        <ol className="off-steps" aria-label="Steps">
          {["Replacements", "Review", "Confirm"].map((s, i) => (
            <li key={s} className={step === i + 1 ? "active" : step > i + 1 ? "done" : ""}>
              <span className="off-step-n">{i + 1}</span>
              {s}
            </li>
          ))}
        </ol>
      )}

      <div className="modal-body off-body">
        {loadError && <p className="off-error" role="alert">{loadError}</p>}
        {!loadError && !preview && <p className="card-subtitle">Loading what {displayName} owns…</p>}

        {preview && step === 1 && (
          <React.Fragment>
            <div className="off-facts">
              <div><strong>{routeClients.filter((c) => c.assigned).length}</strong><span>assigned clients</span></div>
              <div><strong>{preview.open_tasks_total || 0}</strong><span>open tasks</span></div>
              <div><strong>{(preview.live_grants || 0) + (preview.pending_grants || 0)}</strong><span>access grants</span></div>
            </div>
            {nothingToMove ? (
              <p className="card-subtitle">
                {displayName} has no clients, open tasks or access grants. Offboarding just deactivates them.
              </p>
            ) : (
              <React.Fragment>
                <div className="off-mode" role="radiogroup" aria-label="How to reassign">
                  <label className={mode === "one" ? "active" : ""}>
                    <input type="radio" name="off-mode" checked={mode === "one"} onChange={() => setMode("one")} />
                    One person takes everything
                  </label>
                  <label className={mode === "each" ? "active" : ""}>
                    <input type="radio" name="off-mode" checked={mode === "each"} onChange={() => setMode("each")} />
                    Choose per client
                  </label>
                </div>
                <label className="off-label" htmlFor="off-all">
                  {mode === "one" ? "Replacement" : "Default replacement (also gets tasks with no client)"}
                </label>
                {replacementSelect(allTo, setAllTo, "off-all")}
                {mode === "each" && routeClients.length > 0 && (
                  <div className="off-client-list">
                    {routeClients.map((c) => (
                      <div className="off-client-row" key={c.client_id}>
                        <label htmlFor={"off-c-" + c.client_id}>
                          <span className="off-client-name">{c.client_name || c.client_id}</span>
                          <span className="off-client-meta">
                            {c.assigned ? "Assigned" : "Not assigned"}
                            {c.open_tasks ? ` · ${OFF_plural(c.open_tasks, "open task")}` : ""}
                          </span>
                        </label>
                        {replacementSelect(
                          perClient[c.client_id] || "",
                          (v) => setPerClient((m) => ({ ...m, [c.client_id]: v })),
                          "off-c-" + c.client_id,
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {!allTo && (
                  <p className="off-hint">
                    With no replacement, clients are just unassigned and open tasks come to you.
                  </p>
                )}
              </React.Fragment>
            )}
          </React.Fragment>
        )}

        {preview && step === 2 && summary && (
          <React.Fragment>
            <p className="card-subtitle" style={{ marginTop: 0 }}>This will happen all at once:</p>
            <ul className="off-summary">
              {summary.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
            <p className="off-hint">Finished tasks, time, messages and audit history aren't touched.</p>
          </React.Fragment>
        )}

        {preview && step === 3 && (
          <React.Fragment>
            <p className="off-warn">
              You're about to offboard <strong>{displayName}</strong> ({row.email}). They lose access straight away.
              You can reactivate them later on Team → Members, but their clients and tasks won't move back on their own.
            </p>
            <label className="off-label" htmlFor="off-confirm">
              Type <strong>{displayName}</strong> to confirm
            </label>
            <input
              id="off-confirm"
              className="off-input"
              value={typed}
              autoComplete="off"
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && nameMatches && !busy) run();
              }}
            />
            {runError && <p className="off-error" role="alert">{runError}</p>}
          </React.Fragment>
        )}

        {step === 4 && result && (
          <ul className="off-summary">
            <li>{OFF_plural(result.clients_reassigned || 0, "client")} reassigned</li>
            {(result.clients_unassigned || 0) > (result.clients_reassigned || 0) && (
              <li>{OFF_plural(result.clients_unassigned - (result.clients_reassigned || 0), "client")} unassigned</li>
            )}
            <li>{OFF_plural(result.tasks_moved || 0, "open task")} moved</li>
            {result.grants_revoked > 0 && <li>{OFF_plural(result.grants_revoked, "access grant")} revoked</li>}
            {result.grants_cancelled > 0 && <li>{OFF_plural(result.grants_cancelled, "access request")} cancelled</li>}
            {result.temp_admin_expired > 0 && <li>Temporary admin access ended</li>}
            <li>{displayName} deactivated. It's all in the Audit log.</li>
          </ul>
        )}
      </div>

      <div className="modal-footer">
        {step === 4 ? (
          <button type="button" className="btn-primary" onClick={onDone}>Done</button>
        ) : (
          <React.Fragment>
            <button
              type="button"
              className="btn-secondary"
              onClick={step === 1 ? onClose : () => setStep(step - 1)}
              disabled={busy}
            >
              {step === 1 ? "Cancel" : "Back"}
            </button>
            {step < 3 ? (
              <button
                type="button"
                className="btn-primary"
                disabled={!preview}
                onClick={() => setStep(step + 1)}
              >
                {step === 1 ? "Review" : "Continue"}
              </button>
            ) : (
              <button
                type="button"
                className="btn-primary off-danger"
                disabled={!nameMatches || busy}
                onClick={run}
              >
                {busy ? "Offboarding…" : `Offboard ${displayName}`}
              </button>
            )}
          </React.Fragment>
        )}
      </div>
    </ModalShell>
  );
}
