// ----------------------------------------------------------------------------
// TK_CustomFields: Slate plus custom fields UI (hidden preview).
// Spec: docs/slateplus-customfields-spec.md. Rules: components/tasks/TK_customFields.js.
//
//   <TK_DwFieldRows task readOnly />                         drawer rows (label + value each)
//   <TK_CFHeaderButton scope target canManage listName />    "Fields" button + panel (headers)
//   TK_CFRowChips(task)                                      row chips (array of spans) or null
//
// All render nothing while TKP_useOn() is false (off for everyone today, and
// always off in View as), so the drawer, rows and headers are exactly as before.
// Staff only: the client app never loads or calls these.
// ----------------------------------------------------------------------------

function TK_cfToast(text) {
  if (text && typeof TK_vToast === "function") TK_vToast(text);
}

function TK_cfStaffName(staff, email) {
  if (!email) return "";
  if (typeof TK_vStaffName === "function") return TK_vStaffName(staff, email);
  return String(email);
}

function TK_cfSetTitle(meta, staff) {
  if (!meta || !meta.updated_by) return "";
  var when = "";
  try {
    when = meta.updated_at ? new Date(meta.updated_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
  } catch (e) {}
  return "Last set by " + TK_cfStaffName(staff, meta.updated_by) + (when ? ", " + when : "");
}

// One editor per type. Text and number keep a draft and save on blur or Enter
// (Esc puts the saved value back); the rest save on change.
function TK_CFEditor(props) {
  var f = props.field;
  var value = props.value;
  var dis = !!props.disabled;
  var id = props.inputId;
  var dPair = React.useState(value == null ? "" : String(value));
  var draft = dPair[0];
  var setDraft = dPair[1];
  var errPair = React.useState("");
  var err = errPair[0];
  var setErr = errPair[1];
  var key = JSON.stringify(value == null ? null : value);
  React.useEffect(
    function () {
      setDraft(value == null ? "" : String(value));
      setErr("");
    },
    [key, f.id],
  );
  var commit = function (raw) {
    setErr("");
    TKCF_setValue(f, props.task, raw).then(function (r) {
      if (r && !r.ok && r.error) {
        setErr(r.error);
        if (f.type !== "text" && f.type !== "number") TK_cfToast(r.error);
      }
    });
  };
  var keys = function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      e.currentTarget.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setDraft(value == null ? "" : String(value));
      setErr("");
      var el = e.currentTarget;
      setTimeout(function () {
        el.blur();
      }, 0);
    }
  };
  var hint = err ? (
    <p className="tk-dw-hint tk-cf-err" role="alert">
      {err}
    </p>
  ) : null;

  if (f.type === "text" || f.type === "number") {
    return (
      <React.Fragment>
        <input
          id={id}
          type="text"
          inputMode={f.type === "number" ? "decimal" : undefined}
          className="tk-dw-input"
          maxLength={f.type === "text" ? 500 : 24}
          placeholder={f.type === "number" ? "No number" : "Empty"}
          value={draft}
          disabled={dis}
          onChange={function (e) {
            setDraft(e.target.value);
          }}
          onBlur={function () {
            var was = value == null ? "" : String(value);
            if (draft.trim() === was.trim()) {
              setErr("");
              return;
            }
            commit(draft);
          }}
          onKeyDown={keys}
        />
        {hint}
      </React.Fragment>
    );
  }
  if (f.type === "date") {
    return (
      <React.Fragment>
        <input
          id={id}
          type="date"
          className="tk-dw-input"
          min="1900-01-01"
          max="2200-12-31"
          value={value ? String(value).slice(0, 10) : ""}
          disabled={dis}
          onChange={function (e) {
            var d = e.target.value || "";
            // While a year is being typed the input can report "0002-...":
            // save only empty or in-range dates, with no error toast.
            if (d && (d < "1900-01-01" || d > "2200-12-31")) return;
            commit(d || null);
          }}
        />
        {hint}
      </React.Fragment>
    );
  }
  if (f.type === "checkbox") {
    return (
      <React.Fragment>
        <label className="tk-dw-check">
          <input
            id={id}
            type="checkbox"
            checked={value === true}
            disabled={dis}
            onChange={function (e) {
              commit(e.target.checked);
            }}
          />
          <span>{value === true ? "Yes" : "No"}</span>
        </label>
        {hint}
      </React.Fragment>
    );
  }
  if (f.type === "dropdown") {
    var opts = TKCF_activeOptions(f);
    var cur = value == null ? "" : String(value);
    var curOpt = null;
    (f.options || []).forEach(function (o) {
      if (o && String(o.id) === cur) curOpt = o;
    });
    return (
      <React.Fragment>
        <select
          id={id}
          className="tk-dw-select"
          value={cur}
          disabled={dis}
          onChange={function (e) {
            commit(e.target.value || null);
          }}
        >
          <option value="">None</option>
          {opts.map(function (o) {
            return (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            );
          })}
          {curOpt && curOpt.retired ? (
            <option value={cur} disabled>
              {curOpt.label + " (retired)"}
            </option>
          ) : null}
        </select>
        {hint}
      </React.Fragment>
    );
  }
  if (f.type === "person") {
    var staff = Array.isArray(props.staff) ? props.staff : [];
    var pv = value == null ? "" : String(value).toLowerCase();
    var listed = false;
    var people = staff
      .filter(function (s) {
        return s && s.email && s.active !== false;
      })
      .map(function (s) {
        var em = String(s.email).toLowerCase();
        if (em === pv) listed = true;
        return { email: em, name: s.name || s.email };
      })
      .sort(function (a, b) {
        return String(a.name).localeCompare(String(b.name));
      });
    return (
      <React.Fragment>
        <select
          id={id}
          className="tk-dw-select"
          value={pv}
          disabled={dis}
          onChange={function (e) {
            commit(e.target.value || null);
          }}
        >
          <option value="">Nobody</option>
          {people.map(function (p) {
            return (
              <option key={p.email} value={p.email}>
                {p.name}
              </option>
            );
          })}
          {pv && !listed ? (
            <option value={pv} disabled>
              {pv}
            </option>
          ) : null}
        </select>
        {hint}
      </React.Fragment>
    );
  }
  return null;
}

// Drawer: one row per active field that applies to the task (project fields
// first, then the client's). Nothing when off or when the list has no fields.
function TK_DwFieldRows(props) {
  var on = typeof TKP_useOn === "function" ? TKP_useOn() : false;
  if (typeof TKCF_useFields === "function") TKCF_useFields();
  var staff = typeof TK_vUseStaff === "function" ? TK_vUseStaff(on) : [];
  var task = props.task;
  var taskId = task && task.id != null ? String(task.id) : "";
  React.useEffect(
    function () {
      if (on && taskId && typeof TKCF_loadTask === "function") TKCF_loadTask(taskId);
    },
    [on, taskId],
  );
  if (!on || !task || typeof TKCF_fieldsOf !== "function") return null;
  var fields = TKCF_fieldsOf(task);
  if (!fields.length) return null;
  var vals = TKCF_valuesOf(task.id);
  var ro = !!props.readOnly || !!task.deleted_at;
  return (
    <React.Fragment>
      {fields.map(function (f, i) {
        var meta = vals[String(f.id)] || null;
        var inputId = "tk-dw-cf-" + f.id;
        var title = TK_cfSetTitle(meta, staff);
        var label =
          f.type === "checkbox" ? (
            <span className="tk-dw-label tk-cf-label" title={title || undefined}>
              {f.name}
            </span>
          ) : (
            <label className="tk-dw-label tk-cf-label" htmlFor={inputId} title={title || undefined}>
              {f.name}
            </label>
          );
        return (
          <React.Fragment key={f.id}>
            {label}
            <div className="tk-dw-value tk-cf-value" data-tour={i === 0 ? "tkcf-drawer" : undefined}>
              <TK_CFEditor field={f} value={meta ? meta.value : null} task={task} disabled={ro} inputId={inputId} staff={staff} />
            </div>
          </React.Fragment>
        );
      })}
    </React.Fragment>
  );
}

// Row chips: "Fund: Building", "Reviewed" (with a tick), at most 3, then +N.
function TK_CFRowChips(task) {
  if (!task || typeof TKCF_chipsFor !== "function") return null;
  var c = TKCF_chipsFor(task);
  if (!c) return null;
  var out = c.chips.map(function (x, i) {
    return (
      <span key={"cf-" + x.key} className="tk-meta-cf" title={x.text} data-tour={i === 0 ? "tkcf-chips" : undefined}>
        {x.check ? <TK_vIcon name="check" size={11} /> : null}
        <span className="tk-meta-cf-text">{x.text}</span>
      </span>
    );
  });
  if (c.more) {
    out.push(
      <span key="cf-more" className="tk-meta-cf tk-meta-cf-more" title={c.moreTitle} aria-label={c.more + " more fields: " + c.moreTitle.replace(/\n/g, ", ")}>
        {"+" + c.more}
      </span>,
    );
  }
  return out;
}

// Options editor for an existing dropdown: one input per option (keeps its id,
// so a rename shows on every task), add and remove. Removing one that tasks
// use keeps it on those tasks as retired (the server does that).
function TK_CFOptionsEditor(props) {
  var f = props.field;
  var oPair = React.useState(function () {
    return TKCF_activeOptions(f).map(function (o) {
      return { id: o.id, label: o.label };
    });
  });
  var rows = oPair[0];
  var setRows = oPair[1];
  var setAt = function (i, v) {
    var n = rows.slice();
    n[i] = Object.assign({}, n[i], { label: v });
    setRows(n);
  };
  var retired = (f.options || []).filter(function (o) {
    return o && o.retired;
  });
  return (
    <div className="tk-cf-opts">
      <ol className="tk-section-list">
        {rows.map(function (r, i) {
          return (
            <li key={r.id || "new-" + i} className="tk-section-item">
              <input
                className="tk-input"
                type="text"
                maxLength={40}
                value={r.label}
                aria-label={"Option " + (i + 1)}
                disabled={props.busy}
                onChange={function (e) {
                  setAt(i, e.target.value);
                }}
              />
              <button
                type="button"
                className="tk-icon-btn"
                aria-label={"Remove option " + (i + 1)}
                disabled={props.busy}
                onClick={function () {
                  var n = rows.slice();
                  n.splice(i, 1);
                  setRows(n);
                }}
              >
                ×
              </button>
            </li>
          );
        })}
      </ol>
      {rows.length < 20 ? (
        <button
          type="button"
          className="tk-nav-add"
          disabled={props.busy}
          onClick={function () {
            setRows(rows.concat([{ label: "" }]));
          }}
        >
          <TK_vIcon name="plus" size={14} />
          <span>Add option</span>
        </button>
      ) : null}
      {retired.length ? (
        <p className="tk-muted tk-form-note">
          {"Retired (still on some tasks, can't be picked): " +
            retired
              .map(function (o) {
                return o.label;
              })
              .join(", ")}
        </p>
      ) : null}
      <div className="tk-cf-actions">
        <button
          type="button"
          className="btn-primary"
          disabled={props.busy}
          onClick={function () {
            props.onSave(rows);
          }}
        >
          Save options
        </button>
        <button type="button" className="btn-secondary" disabled={props.busy} onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function TK_CFFieldItem(props) {
  var f = props.field;
  var can = props.canManage;
  var nPair = React.useState(f.name);
  var name = nPair[0];
  var setName = nPair[1];
  React.useEffect(
    function () {
      setName(f.name);
    },
    [f.name],
  );
  var saveName = function () {
    var clean = String(name || "").replace(/\s+/g, " ").trim();
    if (clean === f.name) return;
    var chk = TKCF_nameCheck(clean, props.siblings, f.id);
    if (!chk.ok) {
      props.onError(chk.error);
      setName(f.name);
      return;
    }
    props.run(TKCF_saveField(f.id, null, null, chk.name, null, null)).then(function (ok) {
      if (!ok) setName(f.name);
    });
  };
  return (
    <li className="tk-cf-item">
      <div className="tk-cf-item-row">
        {can ? (
          <input
            className="tk-input tk-cf-name"
            type="text"
            maxLength={40}
            value={name}
            aria-label={"Name of field " + f.name}
            disabled={props.busy}
            onChange={function (e) {
              setName(e.target.value);
            }}
            onBlur={saveName}
            onKeyDown={function (e) {
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setName(f.name);
              }
            }}
          />
        ) : (
          <span className="tk-cf-name-ro">{f.name}</span>
        )}
        <span className="pill neutral tk-cf-type">{TKCF_typeLabel(f.type)}</span>
        {f.type === "dropdown" && !can ? (
          <span className="tk-muted tk-cf-optlist">
            {TKCF_activeOptions(f)
              .map(function (o) {
                return o.label;
              })
              .join(", ")}
          </span>
        ) : null}
        {can ? (
          <span className="tk-cf-item-btns">
            {f.type === "dropdown" ? (
              <button type="button" className="tk-link-btn" disabled={props.busy} onClick={props.onToggleOptions}>
                {props.optionsOpen ? "Close options" : "Options"}
              </button>
            ) : null}
            <button type="button" className="tk-icon-btn" aria-label={"Move " + f.name + " up"} disabled={props.busy || props.first} onClick={props.onUp}>
              <TK_vIcon name="down" size={14} className="tk-flip" />
            </button>
            <button type="button" className="tk-icon-btn" aria-label={"Move " + f.name + " down"} disabled={props.busy || props.last} onClick={props.onDown}>
              <TK_vIcon name="down" size={14} />
            </button>
            <button type="button" className="tk-link-btn" disabled={props.busy} onClick={props.onArchive}>
              Archive
            </button>
          </span>
        ) : null}
      </div>
      {can && props.optionsOpen ? (
        <TK_CFOptionsEditor
          field={f}
          busy={props.busy}
          onCancel={props.onToggleOptions}
          onSave={function (rows) {
            var norm = TKCF_normalizeOptions(rows);
            if (!norm.ok) {
              props.onError(norm.error);
              return;
            }
            props.run(TKCF_saveField(f.id, null, null, f.name, null, norm.options), props.onToggleOptions);
          }}
        />
      ) : null}
    </li>
  );
}

// The Fields panel: anyone who can see the list reads it; managers add,
// rename, reorder, edit options, archive and restore.
function TK_CFPanel(props) {
  TKCF_useFields();
  var scope = props.scope;
  var target = props.target;
  var slateWide = typeof TK_useSlateWide === "function" ? TK_useSlateWide() : true;
  var can = !!props.canManage && slateWide;
  var bPair = React.useState(false);
  var busy = bPair[0];
  var setBusy = bPair[1];
  var ePair = React.useState("");
  var err = ePair[0];
  var setErr = ePair[1];
  var aPair = React.useState(false);
  var showArchived = aPair[0];
  var setShowArchived = aPair[1];
  var oPair = React.useState("");
  var optsFor = oPair[0];
  var setOptsFor = oPair[1];
  var nnPair = React.useState("");
  var newName = nnPair[0];
  var setNewName = nnPair[1];
  var ntPair = React.useState("text");
  var newType = ntPair[0];
  var setNewType = ntPair[1];
  var noPair = React.useState("");
  var newOpts = noPair[0];
  var setNewOpts = noPair[1];
  var list = TKCF_listFor(scope, target);
  var active = list.active;
  var archived = list.archived;
  var atCap = active.length >= TKCF_MAX_FIELDS;

  var run = function (p, after) {
    setBusy(true);
    setErr("");
    return p.then(function (r) {
      setBusy(false);
      if (!r || !r.ok) {
        setErr((r && r.error) || "Couldn't save that change. Try again.");
        return false;
      }
      if (after) after(r);
      return true;
    });
  };
  var move = function (i, d) {
    var ids = active.map(function (f) {
      return f.id;
    });
    var next = TKCF_reorder(ids, i, i + d);
    if (next.join() === ids.join()) return;
    run(TKCF_orderFields(next));
  };
  var add = function (e) {
    if (e) e.preventDefault();
    if (busy || !can || atCap) return;
    var chk = TKCF_nameCheck(newName, active, null);
    if (!chk.ok) {
      setErr(chk.error);
      return;
    }
    var opts = null;
    if (newType === "dropdown") {
      var norm = TKCF_parseOptionsText(newOpts, []);
      if (!norm.ok) {
        setErr(norm.error);
        return;
      }
      opts = norm.options;
    }
    run(TKCF_saveField(null, scope, target, chk.name, newType, opts), function () {
      setNewName("");
      setNewOpts("");
      setNewType("text");
    });
  };
  var who = scope === "client" ? "Only an admin can change a client's fields." : "Only an admin or the project owner can change fields.";
  var RO = typeof TK_SlateReadOnly === "function" ? TK_SlateReadOnly : React.Fragment;

  return (
    <TK_vModal onClose={props.onClose} labelledBy="tk-cf-title" className="tk-modal tk-cf-modal tk-sheet">
      <div className="modal-header">
        <h3 className="card-title" id="tk-cf-title" style={{ margin: 0 }}>
          {"Fields" + (props.listName ? ": " + props.listName : "")}
        </h3>
        <button type="button" className="modal-close" onClick={props.onClose} aria-label="Close">
          ×
        </button>
      </div>
      <div className="modal-body tk-form">
        <p className="tk-muted tk-form-note">
          {"Extra facts for every task in this list, filled in each task's details. Up to " + TKCF_MAX_FIELDS + " fields."}
          {props.canManage ? "" : " " + who}
        </p>
        <RO>
          {active.length ? (
            <ol className="tk-cf-list">
              {active.map(function (f, i) {
                return (
                  <TK_CFFieldItem
                    key={f.id}
                    field={f}
                    siblings={active}
                    canManage={can}
                    busy={busy}
                    first={i === 0}
                    last={i === active.length - 1}
                    optionsOpen={optsFor === f.id}
                    onToggleOptions={function () {
                      setOptsFor(optsFor === f.id ? "" : f.id);
                    }}
                    onUp={function () {
                      move(i, -1);
                    }}
                    onDown={function () {
                      move(i, 1);
                    }}
                    onArchive={function () {
                      run(TKCF_archiveField(f.id, true), function () {
                        TK_cfToast(f.name + " archived. Its values are kept; Show archived brings it back.");
                      });
                    }}
                    onError={setErr}
                    run={run}
                  />
                );
              })}
            </ol>
          ) : (
            <p className="tk-muted tk-cf-empty">No fields yet.</p>
          )}
          {can && atCap ? <p className="tk-muted tk-form-note">{TKCF_CAP_TEXT}</p> : null}
          {can && !atCap ? (
            <form className="tk-cf-add" onSubmit={add} noValidate>
              <input
                className="tk-input tk-cf-name"
                type="text"
                maxLength={40}
                placeholder="New field name"
                aria-label="New field name"
                value={newName}
                disabled={busy}
                onChange={function (e) {
                  setNewName(e.target.value);
                }}
              />
              <select
                className="tk-select tk-cf-type-pick"
                aria-label="Field type"
                value={newType}
                disabled={busy}
                onChange={function (e) {
                  setNewType(e.target.value);
                }}
              >
                {TKCF_TYPES.map(function (t) {
                  return (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  );
                })}
              </select>
              {newType === "dropdown" ? (
                <textarea
                  className="tk-input tk-cf-newopts"
                  rows={4}
                  placeholder={"One option per line (up to 20)"}
                  aria-label="Dropdown options, one per line"
                  value={newOpts}
                  disabled={busy}
                  onChange={function (e) {
                    setNewOpts(e.target.value);
                  }}
                />
              ) : null}
              <button type="submit" className="btn-primary" disabled={busy || !newName.trim()}>
                Add field
              </button>
              <p className="tk-muted tk-form-note tk-cf-typenote">The type can't change later.</p>
            </form>
          ) : null}
          {archived.length ? (
            <div className="tk-cf-archived">
              <button
                type="button"
                className="tk-link-btn"
                aria-expanded={showArchived ? "true" : "false"}
                onClick={function () {
                  setShowArchived(!showArchived);
                }}
              >
                {(showArchived ? "Hide archived" : "Show archived") + " (" + archived.length + ")"}
              </button>
              {showArchived ? (
                <ul className="tk-cf-list tk-cf-list-archived">
                  {archived.map(function (f) {
                    return (
                      <li key={f.id} className="tk-cf-item">
                        <div className="tk-cf-item-row">
                          <span className="tk-cf-name-ro">{f.name}</span>
                          <span className="pill neutral tk-cf-type">{TKCF_typeLabel(f.type)}</span>
                          {can ? (
                            <span className="tk-cf-item-btns">
                              <button
                                type="button"
                                className="tk-link-btn"
                                disabled={busy || atCap}
                                title={atCap ? TKCF_CAP_TEXT : undefined}
                                onClick={function () {
                                  run(TKCF_archiveField(f.id, false));
                                }}
                              >
                                Restore
                              </button>
                            </span>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>
          ) : null}
        </RO>
        {err ? (
          <p className="tk-field-error" role="alert">
            {err}
          </p>
        ) : null}
      </div>
      <div className="modal-footer tk-modal-footer">
        <button type="button" className="btn-secondary" onClick={props.onClose}>
          Done
        </button>
      </div>
    </TK_vModal>
  );
}

// Header button: "Fields" (with the count when there are any). Opens the panel.
function TK_CFHeaderButton(props) {
  var on = typeof TKP_useOn === "function" ? TKP_useOn() : false;
  if (typeof TKCF_useFields === "function") TKCF_useFields();
  var oPair = React.useState(false);
  var open = oPair[0];
  var setOpen = oPair[1];
  if (!on || !props.target || typeof TKCF_listFor !== "function") return null;
  var count = TKCF_listFor(props.scope, props.target).active.length;
  return (
    <React.Fragment>
      <button
        type="button"
        className="tk-link-btn tk-cf-btn"
        data-tour="tkcf-fields"
        title="Custom fields for this list"
        onClick={function () {
          setOpen(true);
        }}
      >
        <TK_vIcon name="list" size={15} />
        <span>{count ? "Fields (" + count + ")" : "Fields"}</span>
      </button>
      {open ? (
        <TK_CFPanel
          scope={props.scope}
          target={props.target}
          canManage={!!props.canManage}
          listName={props.listName}
          onClose={function () {
            setOpen(false);
          }}
        />
      ) : null}
    </React.Fragment>
  );
}
