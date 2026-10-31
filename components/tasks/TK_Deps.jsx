// ----------------------------------------------------------------------------
// TK_Deps: Slate plus task dependencies UI (hidden preview).
// Spec: docs/slateplus-dependencies-spec.md. Rules: components/tasks/TK_deps.js.
//
//   <TK_DwDepsRow task readOnly isAdmin />   drawer "Blocked by" row (label + value)
//   <TK_tplDepStepField templateId />        template editor "Close order step"
//
// Both render nothing while TKP_useOn() is false (off for everyone today, and
// always off in View as), so the drawer and the editor are exactly as before.
// Staff only: the client app never loads or calls these.
// ----------------------------------------------------------------------------

function TK_depClientName(id) {
  if (id == null || id === "") return "";
  try {
    var list = window.CLIENTS || [];
    for (var i = 0; i < list.length; i++) if (list[i] && String(list[i].id) === String(id)) return list[i].name || "";
  } catch (e) {}
  return "";
}

function TK_depName(b) {
  if (!b || b.readable === false) return "A task you can't see";
  return String(b.text || "").replace(/\s+/g, " ").trim() || "Untitled task";
}

function TK_depErrText(e) {
  var r = (e && (e.reason || e.code)) || "";
  var m = String((e && e.message) || "");
  if (r === "tk_dep_cycle" || /tk_dep_cycle/.test(m)) return "That task already waits on this one, so it can't block it.";
  if (r === "tk_dep_self" || /tk_dep_self/.test(m)) return "A task can't wait on itself.";
  if (r === "tk_dep_limit" || /tk_dep_limit/.test(m)) return "20 blockers is the most for one task.";
  if (r === "tk_task_in_trash" || /tk_task_in_trash/.test(m)) return "That task is in the trash.";
  if (/only an admin can remove/.test(m)) return "Only an admin can remove a close order link. Ask an admin to override it.";
  if (r === "tk_forbidden" || /tk_forbidden/.test(m)) return "You can't link those tasks.";
  return typeof TK_vErrText === "function" ? TK_vErrText(e) : "Couldn't save that change. Try again.";
}

function TK_depToast(text, action) {
  if (typeof TK_vToast === "function") TK_vToast(text, action);
}

function TK_depOpen(id) {
  if (!id) return;
  if (typeof TK_vOpenTask === "function") TK_vOpenTask(id, { from: "deps" });
  else if (typeof TK_openTask === "function") TK_openTask(id, { from: "deps" });
}

// The picker: type part of a title; your loaded tasks first, then Slate search
// (any client you can see). Picks run the same checks as the server first.
function TK_DwDepPicker(props) {
  var task = props.task;
  var qPair = React.useState("");
  var q = qPair[0];
  var setQ = qPair[1];
  var rPair = React.useState([]);
  var remote = rPair[0];
  var setRemote = rPair[1];
  var bPair = React.useState(false);
  var busy = bPair[0];
  var setBusy = bPair[1];
  var seq = React.useRef(0);

  React.useEffect(
    function () {
      var text = q.trim();
      if (text.length < 2 || typeof TK_api === "undefined" || !TK_api || typeof TK_api.search !== "function") {
        setRemote([]);
        return undefined;
      }
      var my = ++seq.current;
      var timer = setTimeout(function () {
        TK_api.search(text, 8).then(
          function (rows) {
            if (my === seq.current) setRemote(Array.isArray(rows) ? rows : []);
          },
          function () {
            if (my === seq.current) setRemote([]);
          },
        );
      }, 250);
      return function () {
        clearTimeout(timer);
      };
    },
    [q],
  );

  var text = q.trim().toLowerCase();
  var have = {};
  (props.existing || []).forEach(function (id) {
    have[String(id)] = 1;
  });
  have[String(task.id)] = 1;
  var options = [];
  var seen = {};
  if (text.length >= 2) {
    var snap = typeof TKD_snapshot === "function" ? TKD_snapshot() : { tasks: {} };
    var tasks = snap.tasks || {};
    Object.keys(tasks).forEach(function (id) {
      var t = tasks[id];
      if (!t || t.deleted_at || options.length >= 6) return;
      if (have[String(t.id)] || seen[String(t.id)]) return;
      if (String(t.text || "").toLowerCase().indexOf(text) < 0) return;
      seen[String(t.id)] = 1;
      options.push({ id: String(t.id), text: t.text || "", client_id: t.client_id || null, done: t.done === true || t.status === "done" });
    });
    remote.forEach(function (r) {
      if (!r || !r.task_id || options.length >= 12) return;
      var id = String(r.task_id);
      if (have[id] || seen[id]) return;
      seen[id] = 1;
      options.push({ id: id, text: r.task_text || "", client_id: r.client_id || null, done: r.status === "done" });
    });
  }

  var pick = function (o) {
    if (busy || !o) return;
    var snap = typeof TKD_snapshot === "function" ? TKD_snapshot() : null;
    if (snap && typeof TKD_wouldCycle === "function" && TKD_wouldCycle(task.id, o.id, snap.idx)) {
      TK_depToast("That task already waits on this one, so it can't block it.");
      return;
    }
    setBusy(true);
    TK_api.depAdd(task.id, o.id).then(
      function () {
        setBusy(false);
        setQ("");
        if (props.onDone) props.onDone();
        TKD_load(true);
        var name = TK_depName({ text: o.text, readable: true });
        var undo = function () {
          return TK_api.depRemove(task.id, o.id).then(function () {
            return TKD_load(true).then(function () {
              return "Blocker removed.";
            });
          });
        };
        if (typeof TK_api.offerUndoRun === "function") TK_api.offerUndoRun("Now waiting on " + name + ".", undo);
        else TK_depToast("Now waiting on " + name + ".");
      },
      function (e) {
        setBusy(false);
        TK_depToast(TK_depErrText(e));
      },
    );
  };

  return (
    <div className="tk-dep-picker">
      <input
        className="tk-dw-input"
        type="search"
        autoFocus
        placeholder="Find the task it waits for"
        aria-label="Find the task it waits for"
        value={q}
        disabled={busy}
        onChange={function (e) {
          setQ(e.target.value);
        }}
        onKeyDown={function (e) {
          if (e.key === "Escape") {
            e.stopPropagation();
            if (props.onDone) props.onDone();
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (options.length) pick(options[0]);
          }
        }}
      />
      {text.length >= 2 && (
        <ul className="tk-dep-options" role="listbox" aria-label="Tasks">
          {options.length ? (
            options.map(function (o) {
              var cn = TK_depClientName(o.client_id);
              return (
                <li key={o.id} role="option" aria-selected="false">
                  <button
                    type="button"
                    className="tk-dep-option"
                    disabled={busy}
                    onClick={function () {
                      pick(o);
                    }}
                  >
                    <span className="tk-dep-option-text">{TK_depName(o)}</span>
                    {(cn || o.done) && <span className="tk-muted">{[cn, o.done ? "Done" : ""].filter(Boolean).join(" · ")}</span>}
                  </button>
                </li>
              );
            })
          ) : (
            <li className="tk-muted tk-dep-none">No matching tasks.</li>
          )}
        </ul>
      )}
    </div>
  );
}

function TK_DwDepsRow(props) {
  var on = typeof TKP_useOn === "function" ? TKP_useOn() : false;
  if (typeof TKD_useDeps === "function") TKD_useDeps();
  var task = props.task;
  var taskId = task && task.id != null ? String(task.id) : "";
  var aPair = React.useState(false);
  var adding = aPair[0];
  var setAdding = aPair[1];
  var bPair = React.useState("");
  var busyId = bPair[0];
  var setBusyId = bPair[1];
  // A fresh read each time a task opens (others may have linked it).
  React.useEffect(
    function () {
      if (on && taskId && typeof TKD_load === "function") TKD_load(true);
      setAdding(false);
    },
    [on, taskId],
  );
  if (!on || !task || typeof TKD_snapshot !== "function") return null;
  var snap = TKD_snapshot();
  var blockers = TKD_allBlockers(task.id, snap.idx, snap.tasks);
  var blocking = TKD_blocking(task.id, snap.idx).filter(function (b) {
    return !b.deleted;
  });
  var openCount = blockers.filter(function (b) {
    return b.open;
  }).length;
  var done = task.done === true || task.status === "done";
  var ro = !!props.readOnly;

  var remove = function (b) {
    if (busyId) return;
    setBusyId(b.id);
    TK_api.depRemove(task.id, b.id).then(
      function () {
        setBusyId("");
        TKD_load(true);
        var undo = function () {
          return TK_api.depAdd(task.id, b.id).then(function () {
            return TKD_load(true).then(function () {
              return "Blocker put back.";
            });
          });
        };
        if (typeof TK_api.offerUndoRun === "function") TK_api.offerUndoRun("Blocker removed.", undo);
        else TK_depToast("Blocker removed.");
      },
      function (e) {
        setBusyId("");
        TK_depToast(TK_depErrText(e));
      },
    );
  };

  var tagOf = function (b) {
    if (b.deleted) return "In the trash";
    if (b.overridden && !b.done) return "Overridden";
    if (b.done) return "Done";
    return b.source === "template" ? "Close order" : "";
  };

  return (
    <React.Fragment>
      <span className="tk-dw-label">Blocked by</span>
      <div className="tk-dw-value tk-deps" data-tour="tk-dw-deps">
        {blockers.length ? (
          <ul className="tk-dep-list">
            {blockers.map(function (b) {
              var cn = TK_depClientName(b.client_id);
              var tag = tagOf(b);
              return (
                <li key={b.id} className={"tk-dep-item" + (b.open ? " is-open" : " is-clear")}>
                  {b.open ? <TK_vLockIcon /> : <span className="tk-dep-tick" aria-hidden="true">{"✓"}</span>}
                  {b.readable ? (
                    <button
                      type="button"
                      className="tk-link tk-dep-name"
                      onClick={function () {
                        TK_depOpen(b.id);
                      }}
                    >
                      {TK_depName(b)}
                    </button>
                  ) : (
                    <span className="tk-dep-name tk-muted">{TK_depName(b)}</span>
                  )}
                  {(cn || tag) && <span className="tk-muted tk-dep-meta">{[cn, tag].filter(Boolean).join(" · ")}</span>}
                  {!ro && !b.hidden && (b.source !== "template" || props.isAdmin) && (
                    <button
                      type="button"
                      className="tk-icon-btn tk-dep-remove"
                      aria-label={"Remove blocker " + TK_depName(b)}
                      title="Remove blocker"
                      disabled={!!busyId}
                      onClick={function () {
                        remove(b);
                      }}
                    >
                      {"×"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        ) : ro ? (
          <span className="tk-muted">None</span>
        ) : null}
        {!ro &&
          (adding ? (
            <TK_DwDepPicker
              task={task}
              existing={blockers.map(function (b) {
                return b.id;
              })}
              onDone={function () {
                setAdding(false);
              }}
            />
          ) : (
            <button
              type="button"
              className="tk-link tk-dep-add"
              onClick={function () {
                setAdding(true);
              }}
            >
              + Add blocker
            </button>
          ))}
        {openCount > 0 && !done && (
          <p className="tk-dw-hint">
            {"Can't be started or finished until " + (openCount === 1 ? "this is" : "these are") + " done."}
            {props.isAdmin && !ro && (
              <React.Fragment>
                {" "}
                <button
                  type="button"
                  className="tk-link"
                  onClick={function () {
                    if (typeof TKD_overridePrompt === "function") TKD_overridePrompt(task);
                  }}
                >
                  Override…
                </button>
              </React.Fragment>
            )}
          </p>
        )}
        {blocking.length > 0 && (
          <p className="tk-dw-hint tk-dep-blocking">
            {"Blocking: "}
            {blocking.slice(0, 5).map(function (b, i) {
              return (
                <React.Fragment key={b.id}>
                  {i ? ", " : ""}
                  {b.readable ? (
                    <button
                      type="button"
                      className="tk-link"
                      onClick={function () {
                        TK_depOpen(b.id);
                      }}
                    >
                      {TK_depName(b)}
                    </button>
                  ) : (
                    <span>{TK_depName(b)}</span>
                  )}
                </React.Fragment>
              );
            })}
            {blocking.length > 5 ? " and " + (blocking.length - 5) + " more" : ""}
          </p>
        )}
      </div>
    </React.Fragment>
  );
}

// Template editor: "Close order step" (admins). Saved on its own through
// tk_set_template_dep_step, so tk_save_template and the template draft are
// untouched. Empty = not chained (every existing template).
function TK_tplDepStepField(props) {
  var on = typeof TKP_useOn === "function" ? TKP_useOn() : false;
  var id = props.templateId || null;
  var sPair = React.useState("");
  var step = sPair[0];
  var setStep = sPair[1];
  var lPair = React.useState("");
  var saved = lPair[0];
  var setSaved = lPair[1];
  var mPair = React.useState("");
  var msg = mPair[0];
  var setMsg = mPair[1];
  var bPair = React.useState(false);
  var busy = bPair[0];
  var setBusy = bPair[1];
  React.useEffect(
    function () {
      if (!on || !id || typeof TK_api === "undefined" || !TK_api || typeof TK_api.templateDepStep !== "function") return undefined;
      var live = true;
      TK_api.templateDepStep(id).then(
        function (v) {
          if (!live) return;
          var s = v == null ? "" : String(v);
          setStep(s);
          setSaved(s);
        },
        function () {},
      );
      return function () {
        live = false;
      };
    },
    [on, id],
  );
  if (!on) return null;

  var commit = function () {
    var raw = String(step || "").trim();
    if (raw === saved || busy || !id) return;
    var n = raw === "" ? null : Math.floor(Number(raw));
    if (n !== null && (!isFinite(n) || n < 1 || n > 99)) {
      setMsg("Use a whole number from 1 to 99, or leave it empty.");
      return;
    }
    setBusy(true);
    TK_api.setTemplateDepStep(id, n).then(
      function () {
        setBusy(false);
        var s = n == null ? "" : String(n);
        setStep(s);
        setSaved(s);
        setMsg(n == null ? "Cleared. Its tasks no longer wait on another step." : "Saved. From now on its tasks wait for the tasks from the step before it.");
      },
      function (e) {
        setBusy(false);
        setMsg(TK_depErrText(e));
      },
    );
  };

  return (
    <div className="tk-field tk-tpl-depstep" data-tour="tk-tpl-depstep">
      <label className="tk-field-label" htmlFor="tk-tpl-depstep">
        Close order step
      </label>
      {id ? (
        <input
          id="tk-tpl-depstep"
          className="tk-input tk-tpl-depstep-input"
          type="number"
          min="1"
          max="99"
          step="1"
          inputMode="numeric"
          placeholder="None"
          value={step}
          disabled={busy || !!props.readOnly}
          onChange={function (e) {
            setStep(e.target.value);
            setMsg("");
          }}
          onBlur={commit}
          onKeyDown={function (e) {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          }}
        />
      ) : null}
      <p className="tk-field-help">
        {id
          ? "Optional. Each month, tasks from this template wait for the tasks from the step before it in the same set, for the same client and month. Same number = run side by side. Empty = no chain."
          : "Save the template first, then give it a step."}
      </p>
      {msg && <p className="tk-field-help" role="status">{msg}</p>}
    </div>
  );
}
