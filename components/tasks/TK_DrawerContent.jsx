// ----------------------------------------------------------------------------
// Tasks module, task pane body (docs/desk-right-spec.md section 10, slice R0).
//
//   TK_DrawerContent(props)   one task's header, fields, subtasks, files and
//                             thread, with its own state, fetch, effects and
//                             the x / s / a / ? keys. No portal, scrim, focus
//                             trap or scroll lock: TK_Drawer (the modal chrome
//                             in TK_Drawer.jsx) wraps it today, and the Desk's
//                             task view embeds it later (R2).
//
// Props: { taskId, mode: "drawer" | "embedded", scopeRef, frame, onClose,
//          onBack, onOpenTask, registerEsc, focusField, staffUser, clients,
//          isAdmin, canManageTemplates, canCreateTemplates, onOpenTemplates }
//   scopeRef      the element the keys and the "s" lookup are scoped to (the
//                 modal's aside in drawer mode)
//   frame(inner, after, info)
//                 drawer mode: wraps the panel content (inner) and the
//                 confirm / send back / keys dialogs (after) in the chrome, so
//                 the DOM stays exactly what the single-file drawer rendered.
//                 info: { label } for the dialog's aria-label.
//   registerEsc(fn)
//                 the host asks fn() before it acts on Esc; fn returns true
//                 when the content ate it (the SOP panel closes first).
//   onBack, onOpenTask
//                 reserved for the Desk task view (R2); unused in drawer mode.
//   headStart     embedded only (R2): the host's own control at the start of
//                 the header row (the Desk's Back button).
//
// Loads right before TK_Drawer.jsx. Helpers with the TK_dw prefix that stay in
// TK_Drawer.jsx (store, api, toast, copy, links) are used at render or call
// time only, so the order between the two files never matters at load time.
// ----------------------------------------------------------------------------

function TK_dwConfirm(props) {
  var p = props;
  var hasModal = typeof ConfirmModal === "function";
  // ConfirmModal not loaded (should not happen in the app): a plain confirm.
  React.useEffect(function () {
    if (hasModal) return;
    var ok = window.confirm(p.title + "\n\n" + p.body);
    if (ok) p.onConfirm();
    else p.onCancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!hasModal) return null;
  return TK_dwPortal(
    <ConfirmModal title={p.title} body={p.body} confirmLabel={p.confirmLabel} onConfirm={p.onConfirm} onCancel={p.onCancel} />,
  );
}

// Send back from ready_for_review needs a reason (tasks p2 s3: 3-2000
// characters, tk_send_back). It goes to the assignee by email and on the task.
function TK_dwSendBack(props) {
  var p = props;
  var pair = React.useState("");
  var note = pair[0];
  var setNote = pair[1];
  var triedPair = React.useState(false);
  var tried = triedPair[0];
  var setTried = triedPair[1];
  if (typeof ModalShell !== "function") return null;
  var errKey = typeof TK_sendBackReasonError === "function" ? TK_sendBackReasonError(note) : note.trim().length < 3 ? "reasonRequired" : null;
  var submit = function () {
    if (errKey) {
      setTried(true);
      return;
    }
    p.onConfirm(note.trim());
  };
  return TK_dwPortal(
    <ModalShell onClose={p.onCancel} labelledBy="tk-dw-sendback-title" className="tk-dw-modal">
      <div className="modal-header">
        <h3 className="card-title" id="tk-dw-sendback-title" style={{ margin: 0 }}>
          Send back
        </h3>
        <button type="button" className="modal-close" onClick={p.onCancel} aria-label="Close">
          ×
        </button>
      </div>
      <div className="modal-body">
        <label className="tk-dw-label" htmlFor="tk-dw-sendback-note">
          What needs another look?
        </label>
        <textarea
          id="tk-dw-sendback-note"
          className="tk-dw-textarea"
          rows={3}
          maxLength={2000}
          value={note}
          aria-invalid={tried && errKey ? "true" : undefined}
          aria-describedby="tk-dw-sendback-help"
          onChange={function (e) { setNote(e.target.value); }}
        />
        <p id="tk-dw-sendback-help" role={tried && errKey ? "alert" : undefined} className={"tk-dw-hint" + (tried && errKey ? " tk-field-error" : "")}>
          {tried && errKey
            ? TK_dwCopy(errKey, "Add a short note on what needs another look.")
            : "They see this note in the task's comments, and by email if their task emails are on."}
        </p>
      </div>
      <div className="modal-footer">
        <button type="button" className="btn-secondary" onClick={p.onCancel}>
          Cancel
        </button>
        <button type="button" className="btn-primary" onClick={submit}>
          Send back
        </button>
      </div>
    </ModalShell>,
  );
}

// Slate rhythm slice 4 (b): completing a "Send reports" row asks whether the
// reports went out full or preliminary. Preliminary needs the missing items,
// prefilled from the client's open Ask client requests and editable. Only
// shown while TK_rhythmEnabled() (see TK_reportPickerNeeded).
function TK_dwReportState(props) {
  var p = props;
  var statePair = React.useState("");
  var state = statePair[0];
  var setState = statePair[1];
  var itemsPair = React.useState(null);
  var items = itemsPair[0];
  var setItems = itemsPair[1];
  var triedPair = React.useState(false);
  var tried = triedPair[0];
  var setTried = triedPair[1];
  var busyPair = React.useState(false);
  var busy = busyPair[0];
  var setBusy = busyPair[1];
  React.useEffect(function () {
    var live = true;
    var api = TK_dwApi();
    if (!api || typeof api.listClientRequests !== "function") {
      setItems([]);
      return undefined;
    }
    // The client's open requests, not only ones linked to this task.
    if (!p.clientId) {
      setItems([]);
      return undefined;
    }
    api.listClientRequests(null, p.clientId).then(
      function (rows) { if (live) setItems(TK_reportMissingPrefill(rows)); },
      function () { if (live) setItems([]); },
    );
    return function () { live = false; };
  }, [p.taskId, p.clientId]);
  if (typeof ModalShell !== "function") return null;
  var list = items || [];
  var problem = TK_reportPickerProblem(state, list);
  var setItem = function (i, label) {
    setItems(list.map(function (it, j) { return j === i ? { label: label, request_id: it.request_id || null } : it; }));
  };
  var removeItem = function (i) { setItems(list.filter(function (_, j) { return j !== i; })); };
  var addItem = function () {
    if (list.length >= TK_REPORT_MISSING_MAX) return;
    setItems(list.concat([{ label: "", request_id: null }]));
  };
  var submit = function () {
    if (problem || busy) {
      setTried(true);
      return;
    }
    setBusy(true);
    Promise.resolve(p.onConfirm(state, state === "preliminary" ? TK_reportMissingClean(list) : [])).then(
      function () { setBusy(false); },
      function () { setBusy(false); },
    );
  };
  var month = TK_reportMonthLabel(p.period);
  return TK_dwPortal(
    <ModalShell onClose={p.onCancel} labelledBy="tk-dw-report-title" className="tk-dw-modal">
      <div className="modal-header">
        <h3 className="card-title" id="tk-dw-report-title" style={{ margin: 0 }}>
          {"Reports for " + (month || "this month")}
        </h3>
        <button type="button" className="modal-close" onClick={p.onCancel} aria-label="Close">
          ×
        </button>
      </div>
      <div className="modal-body">
        <fieldset className="tk-dw-report-pick">
          <legend className="tk-dw-label">How did the reports go out?</legend>
          <label className="tk-dw-report-opt">
            <input type="radio" name="tk-dw-report-state" value="full" checked={state === "full"}
              onChange={function () { setState("full"); }} />
            <span><strong>Full</strong> Everything for the month was in.</span>
          </label>
          <label className="tk-dw-report-opt">
            <input type="radio" name="tk-dw-report-state" value="preliminary" checked={state === "preliminary"}
              onChange={function () { setState("preliminary"); }} />
            <span><strong>Preliminary</strong> Sent before everything arrived.</span>
          </label>
        </fieldset>
        {state === "preliminary" && (
          <div className="tk-dw-report-missing">
            <p className="tk-dw-label" id="tk-dw-report-missing-label">Still missing</p>
            {items === null ? (
              <p className="tk-dw-hint">Loading open requests…</p>
            ) : (
              <ul className="tk-dw-report-list" aria-labelledby="tk-dw-report-missing-label">
                {list.map(function (it, i) {
                  return (
                    <li key={i} className="tk-dw-report-item">
                      <input
                        type="text"
                        className="tk-dw-input"
                        maxLength={200}
                        aria-label={"Missing item " + (i + 1)}
                        value={it.label}
                        onChange={function (e) { setItem(i, e.target.value); }}
                      />
                      <button type="button" className="btn-secondary btn-sm" onClick={function () { removeItem(i); }}
                        aria-label={"Remove missing item " + (i + 1)}>
                        Remove
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {list.length < TK_REPORT_MISSING_MAX && (
              <button type="button" className="btn-secondary btn-sm" onClick={addItem}>
                Add item
              </button>
            )}
            <p className="tk-dw-hint">The client sees these items next to the reports, with a link to upload.</p>
          </div>
        )}
        {tried && problem && (
          <p role="alert" className="tk-dw-hint tk-field-error">{problem}</p>
        )}
      </div>
      <div className="modal-footer">
        <button type="button" className="btn-secondary" onClick={p.onCancel}>
          Cancel
        </button>
        <button type="button" className="btn-primary" onClick={submit} disabled={busy}>
          Mark done
        </button>
      </div>
    </ModalShell>,
  );
}

// The review strip (tasks p2 s3). In review: who reviews it, how long it has
// waited, and Approve / Send back (an admin who isn't the assignee or the
// submitter) or Take back (the assignee or submitter). Before review, admins
// can name the reviewer (blank = the default picked on submit).
function TK_dwReview(props) {
  var p = props;
  var task = p.task;
  var staff = p.staff || [];
  if (!task || task.deleted_at) return null;
  var status = TK_dwEffectiveStatus(task);
  var inReview = status === "ready_for_review";
  if (!inReview && !(task.review_required && p.isAdmin && status !== "done")) return null;
  var role = typeof TK_reviewRole === "function" ? TK_reviewRole(task, { me: p.me, isAdmin: p.isAdmin }) : {};
  var reviewerName = task.reviewer_email ? TK_dlNameOf(task.reviewer_email, staff) : "any admin";
  var wait = inReview && typeof TK_reviewWaitLabel === "function" ? TK_reviewWaitLabel(task) : "";
  // Owner fallback on purpose (S8b): an Unassigned task's owner can't review it either.
  var assignee = TK_dwLower(task.assignee_email || task.staff_email);
  // tk_set_reviewer refuses the assignee, and the submitter while in review.
  var submitter = inReview ? TK_dwLower(task.submitted_by) : "";
  var admins = staff.filter(function (s) {
    var em = s ? TK_dwLower(s.email) : "";
    return s && s.active !== false && s.role === "admin" && em !== assignee && (!submitter || em !== submitter);
  });
  var picker = p.isAdmin && !p.readOnly && (
    <label className="tk-dw-review-pick">
      <span>Reviewer</span>
      <select
        className="tk-dw-select"
        aria-label="Reviewer"
        value={task.reviewer_email || ""}
        onChange={function (e) { p.onSetReviewer(e.target.value || null); }}
      >
        <option value="">{inReview ? "Any admin" : "Default (picked when sent)"}</option>
        {admins.map(function (s) {
          return (
            <option key={s.email} value={TK_dwLower(s.email)}>
              {s.name || s.email}
            </option>
          );
        })}
      </select>
    </label>
  );
  if (!inReview) {
    return (
      <div className="tk-dw-review" data-tour="tk-review-strip">
        <span className="tk-dw-review-text">Needs review before it's done.</span>
        {picker}
      </div>
    );
  }
  return (
    <div className="tk-dw-review is-waiting" role="status" data-tour="tk-review-strip">
      <div className="tk-dw-review-text">
        <strong>Waiting for review</strong>
        <span>{" · Reviewer: " + reviewerName}</span>
        {wait ? <span>{" · " + wait}</span> : null}
        {task.send_back_count > 0 ? (
          <span>{" · Sent back " + task.send_back_count + (task.send_back_count === 1 ? " time" : " times")}</span>
        ) : null}
      </div>
      {role.blockedReason ? <p className="tk-dw-hint">{TK_dwCopy(role.blockedReason, "Another admin will review it.")}</p> : null}
      <div className="tk-dw-review-actions">
        {role.canApprove && !p.readOnly && (
          <button type="button" className="btn-primary tk-dw-btn-sm" onClick={p.onApprove}>
            Approve
          </button>
        )}
        {role.canSendBack && !p.readOnly && (
          <button type="button" className="btn-secondary tk-dw-btn-sm" onClick={p.onSendBack}>
            Send back
          </button>
        )}
        {(role.isAssignee || role.isSubmitter) && !p.readOnly && (
          <button type="button" className="btn-secondary tk-dw-btn-sm" onClick={p.onWithdraw}>
            Take back
          </button>
        )}
        {picker}
      </div>
    </div>
  );
}

// The shortcuts sheet: the views slice's TK_KeysSheet, or a plain list.
function TK_dwKeys(props) {
  var p = props;
  if (typeof TK_KeysSheet === "function") return TK_dwPortal(<TK_KeysSheet onClose={p.onClose} />);
  if (typeof ModalShell !== "function") return null;
  var keys = typeof TK_KEYMAP !== "undefined" && TK_KEYMAP ? TK_KEYMAP : [];
  return TK_dwPortal(
    <ModalShell onClose={p.onClose} labelledBy="tk-dw-keys-title" className="tk-dw-modal">
      <div className="modal-header">
        <h3 className="card-title" id="tk-dw-keys-title" style={{ margin: 0 }}>
          Keyboard shortcuts
        </h3>
        <button type="button" className="modal-close" onClick={p.onClose} aria-label="Close">
          ×
        </button>
      </div>
      <div className="modal-body">
        <dl className="tk-dw-keys">
          {keys.map(function (k) {
            return (
              <div key={k.key} className="tk-dw-keys-row">
                <dt>
                  <kbd>{k.display || k.key}</kbd>
                </dt>
                <dd>{k.label}</dd>
              </div>
            );
          })}
        </dl>
      </div>
    </ModalShell>,
  );
}

// The status control: the views slice's TK_StatusPill, or a select.
function TK_dwStatus(props) {
  var p = props;
  var task = p.task;
  if (typeof TK_StatusPill === "function") {
    return <TK_StatusPill task={task} isAdmin={p.isAdmin} canEdit={p.canEdit} onChange={p.onChange} />;
  }
  var cur = TK_dwEffectiveStatus(task);
  var next = typeof TK_nextStatuses === "function" ? TK_nextStatuses(task, { isAdmin: p.isAdmin }) : [];
  return (
    <select
      className={"tk-dw-status-select tk-st-" + cur}
      aria-label="Status"
      value=""
      disabled={!p.canEdit || !next.length}
      onChange={function (e) {
        if (e.target.value) p.onChange(e.target.value);
      }}
    >
      <option value="">{TK_dwStatusLabel(cur)}</option>
      {next.map(function (n) {
        return (
          <option key={n.status + n.label} value={n.status}>
            {n.label}
          </option>
        );
      })}
    </select>
  );
}

// Bookkeeper, Backup and Account Manager chips (1.1). Cached for the session,
// so an offline drawer still shows them.
var TK_dwPeopleCache = {};
var TK_DW_ROLE_LABELS = { bookkeeper: "Bookkeeper", backup: "Backup", account_manager: "Account Manager", reviewer: "Reviewer" };

function TK_dwPeople(props) {
  var p = props;
  var id = p.clientId ? String(p.clientId) : "";
  var pair = React.useState(function () { return TK_dwPeopleCache[id] || null; });
  var rows = pair[0];
  var setRows = pair[1];
  React.useEffect(function () {
    if (!id) return undefined;
    if (TK_dwPeopleCache[id]) {
      setRows(TK_dwPeopleCache[id]);
      return undefined;
    }
    var live = true;
    setRows(null);
    var api = TK_dwApi();
    if (!api || typeof api.clientPeople !== "function") {
      setRows([]);
      return undefined;
    }
    Promise.resolve()
      .then(function () { return api.clientPeople(id); })
      .then(
        function (list) {
          var clean = (list || []).filter(function (r) { return r && r.email; });
          TK_dwPeopleCache[id] = clean;
          if (live) setRows(clean);
        },
        function () {
          if (live) setRows([]);
        },
      );
    return function () { live = false; };
  }, [id]);

  if (!id) return null;
  if (rows === null) {
    return (
      <div className="tk-dw-people" aria-hidden="true">
        <span className="tk-dw-chip tk-dw-chip-ph" />
        <span className="tk-dw-chip tk-dw-chip-ph" />
      </div>
    );
  }
  if (!rows.length && !p.reviewRequired) return null;
  return (
    <div className="tk-dw-people" aria-label="People on this client">
      {rows.map(function (r) {
        var name = r.name || TK_dlNameOf(r.email, p.staff);
        return (
          <span key={r.role + r.email} className="tk-dw-chip" title={name}>
            <span className="tk-dw-avatar tk-dw-avatar-sm" aria-hidden="true">
              {TK_dlInitials(r.name, r.email)}
            </span>
            <span className="tk-dw-chip-role">{TK_DW_ROLE_LABELS[r.role] || r.role}</span>
            <span className="tk-dw-chip-name">{name}</span>
          </span>
        );
      })}
      {p.reviewRequired && !rows.some(function (r) { return r.role === "reviewer"; }) && (
        <span className="tk-dw-chip tk-dw-chip-note">Reviewer: any admin</span>
      )}
    </div>
  );
}

// Subtasks (parent_id) as compact rows, plus "Add subtask".
function TK_dwSubtasks(props) {
  var p = props;
  var task = p.task;
  var key = "children:" + task.id;
  var list = TK_dwUseStore(function (s) {
    if (typeof TK_selectList === "function") return TK_selectList(s, key);
    return s.lists ? s.lists[key] : null;
  });
  var tasks = list && Array.isArray(list.tasks) ? list.tasks : [];
  var loadPair = React.useState("idle");
  var load = loadPair[0];
  var setLoad = loadPair[1];
  var addPair = React.useState(null);
  var adding = addPair[0];
  var setAdding = addPair[1];
  var busyPair = React.useState(false);
  var busy = busyPair[0];
  var setBusy = busyPair[1];

  var reload = React.useCallback(function () {
    var api = TK_dwApi();
    if (!api || typeof api.listChildren !== "function") return;
    setLoad(function (l) { return l === "idle" ? "loading" : l; });
    Promise.resolve()
      .then(function () { return api.listChildren(task.id); })
      .then(
        function (rows) {
          TK_dwDispatch({ type: "listLoaded", key: key, tasks: rows || [] });
          setLoad("ok");
        },
        function () {
          setLoad("error");
        },
      );
  }, [task.id]);

  React.useEffect(function () {
    setLoad("idle");
    setAdding(null);
    reload();
  }, [task.id]);

  var submit = function () {
    var text = String(adding || "").trim();
    if (!text || busy) return;
    var api = TK_dwApi();
    if (!api) return;
    setBusy(true);
    api
      .create({
        text: text,
        parent_id: task.id,
        client_id: task.client_id || null,
        project_id: task.project_id || null,
        section: task.section || null,
        // S8b: an Unassigned parent's subtask goes to whoever adds it.
        assignee_email: task.assignee_email || null,
        visibility: task.visibility,
      })
      .then(
        function () {
          setBusy(false);
          setAdding("");
          reload();
        },
        function (e) {
          setBusy(false);
          TK_dwSaveError(e);
        },
      );
  };

  var today = TK_dwToday();
  var showAdd = p.canAdd && !p.readOnly;
  if (!tasks.length && !showAdd && load !== "loading") return null;
  return (
    <section className="tk-dw-section" aria-labelledby="tk-dw-sub-h" data-tour="tk-dw-subtasks">
      <h3 className="tk-dw-h" id="tk-dw-sub-h">
        Subtasks
        {tasks.length > 0 && (
          <span className="tk-dw-count">
            {tasks.filter(function (t) { return !TK_dwIsOpen(t); }).length} of {tasks.length}
          </span>
        )}
      </h3>
      {load === "loading" && !tasks.length && <div className="tk-dw-skel tk-dw-skel-row" aria-hidden="true" />}
      {load === "error" && !tasks.length && (
        <p className="tk-dw-muted">
          Couldn't load subtasks.{" "}
          <button type="button" className="link-btn" onClick={reload}>
            Try again
          </button>
        </p>
      )}
      {tasks.length > 0 && (
        <ul className="tk-dw-subtasks">
          {tasks.map(function (t) {
            if (typeof TK_TaskRow === "function") {
              return (
                <TK_TaskRow
                  key={t.id}
                  task={t}
                  today={today}
                  showClient={false}
                  isAdmin={p.isAdmin}
                  canEdit={!p.readOnly}
                  editFields={false}
                  onOpen={function (id) { TK_openTask(id, { from: "subtask" }); }}
                  onToggleDone={function (row) {
                    var api = TK_dwApi();
                    if (api) api.complete(row, { done: TK_dwIsOpen(row), isAdmin: p.isAdmin }).catch(TK_dwSaveError);
                  }}
                  onStatus={function (row, status) {
                    var api = TK_dwApi();
                    if (api) api.setStatus(row.id, status).catch(TK_dwSaveError);
                  }}
                />
              );
            }
            var done = !TK_dwIsOpen(t);
            return (
              <li key={t.id} className={"tk-dw-subrow" + (done ? " is-done" : "")}>
                <input
                  type="checkbox"
                  checked={done}
                  disabled={p.readOnly}
                  aria-label={(done ? "Mark not done: " : "Mark done: ") + t.text}
                  onChange={function () {
                    var api = TK_dwApi();
                    if (api) api.complete(t, { done: !done, isAdmin: p.isAdmin }).catch(TK_dwSaveError);
                  }}
                />
                <a href={TK_dwTaskHref(t.id)} onClick={TK_openTaskClick(t.id)} className="tk-dw-subrow-title">
                  {t.text}
                </a>
              </li>
            );
          })}
        </ul>
      )}
      {showAdd &&
        (adding === null ? (
          <button type="button" className="link-btn tk-dw-add" onClick={function () { setAdding(""); }}>
            + Add subtask
          </button>
        ) : (
          <div className="tk-dw-inline-add">
            <input
              type="text"
              className="tk-dw-input"
              aria-label="New subtask"
              placeholder="What needs doing?"
              maxLength={500}
              autoFocus
              value={adding}
              disabled={busy}
              onChange={function (e) { setAdding(e.target.value); }}
              onKeyDown={function (e) {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submit();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  setAdding(null);
                }
              }}
            />
            <button type="button" className="btn-primary tk-dw-btn-sm" disabled={busy || !String(adding).trim()} onClick={submit}>
              Add
            </button>
            <button type="button" className="btn-secondary tk-dw-btn-sm" onClick={function () { setAdding(null); }}>
              Cancel
            </button>
          </div>
        ))}
    </section>
  );
}

// Followers footer (2.6).
function TK_dwFollowers(props) {
  var p = props;
  var task = p.task;
  var api = TK_dwApi();
  var f = TK_dwUseRows(
    "f",
    task.id,
    function () { return api ? api.listFollowers(task.id) : []; },
    { tables: ["tk_followers"], stamp: task.assignee_email || "" },
  );
  var busyPair = React.useState(false);
  var busy = busyPair[0];
  var setBusy = busyPair[1];
  var rows = f.rows || [];
  var me = p.me;
  var following = rows.some(function (r) { return TK_dwLower(r.staff_email) === me; });
  var stack = TK_dlFollowerStack(rows, 5);
  var names = rows.map(function (r) { return p.nameOf(r.staff_email); });

  var toggle = function () {
    if (!api || busy) return;
    setBusy(true);
    var run = following ? api.unfollow(task.id) : api.follow(task.id);
    Promise.resolve(run).then(
      function () {
        setBusy(false);
        f.reload();
      },
      function (e) {
        setBusy(false);
        TK_dwSaveError(e);
      },
    );
  };

  var add = function (email) {
    if (!api || !email) return;
    setBusy(true);
    api.addFollower(task.id, email).then(
      function () {
        setBusy(false);
        f.reload();
      },
      function (e) {
        setBusy(false);
        var why = (e && (e.reason || e.code)) || "";
        if (why === "tk_follower_no_access") TK_dwToast("They can't see this task's client or project.");
        else TK_dwSaveError(e);
      },
    );
  };

  var candidates = (p.staff || []).filter(function (s) {
    var em = TK_dwLower(s.email);
    return em && s.active !== false && !rows.some(function (r) { return TK_dwLower(r.staff_email) === em; });
  });

  return (
    <footer className="tk-dw-foot">
      <div className="tk-dw-followers" aria-label={rows.length ? "Followers: " + names.join(", ") : "No followers yet"}>
        {stack.shown.map(function (r) {
          var name = p.nameOf(r.staff_email);
          var staffRow = (p.staff || []).filter(function (s) { return TK_dwLower(s.email) === TK_dwLower(r.staff_email); })[0];
          return (
            <span key={r.staff_email} className="tk-dw-avatar" title={name} aria-hidden="true">
              {TK_dlInitials(staffRow ? staffRow.name : "", r.staff_email)}
            </span>
          );
        })}
        {stack.extra > 0 && (
          <span className="tk-dw-avatar tk-dw-avatar-more" title={names.slice(5).join(", ")} aria-hidden="true">
            +{stack.extra}
          </span>
        )}
        {!rows.length && !f.loading && <span className="tk-dw-muted">No followers yet</span>}
      </div>
      {/* A deleted task can't be followed or given followers; Restore first. */}
      {!p.deleted && (
      <div className="tk-dw-foot-actions">
        <button
          type="button"
          className={"btn-secondary tk-dw-btn-sm" + (following ? " is-on" : "")}
          aria-pressed={following ? "true" : "false"}
          disabled={busy || !p.online}
          onClick={toggle}
        >
          {following ? "Following ✓" : "Follow"}
        </button>
        {p.canEdit && !p.deleted && candidates.length > 0 && (
          <select
            className="tk-dw-select tk-dw-follow-add"
            aria-label="Add follower"
            value=""
            disabled={busy || !p.online}
            onChange={function (e) { add(e.target.value); }}
          >
            <option value="">Add follower</option>
            {candidates.map(function (s) {
              return (
                <option key={s.email} value={TK_dwLower(s.email)}>
                  {s.name || TK_dlHandle(s.email)}
                </option>
              );
            })}
          </select>
        )}
      </div>
      )}
    </footer>
  );
}

// "View SOP section" slide-over inside the drawer (1.3).
function TK_dwSopPanel(props) {
  var p = props;
  var backRef = React.useRef(null);
  React.useEffect(function () {
    if (backRef.current) backRef.current.focus();
  }, []);
  var enc = encodeURIComponent(String(p.client.id));
  var sections = typeof CLIENT_SOP_SECTIONS !== "undefined" && CLIENT_SOP_SECTIONS ? CLIENT_SOP_SECTIONS : [];
  var meta = sections.filter(function (s) { return s.id === p.section; })[0];
  return (
    <div className="tk-dw-sop" role="region" aria-label="SOP section">
      <div className="tk-dw-sop-head">
        <button type="button" ref={backRef} className="link-btn tk-dw-back" onClick={p.onClose}>
          {"←"} Back to task
        </button>
        <a
          className="link-btn"
          href={"#/client/" + enc + "/sop"}
          onClick={function () { p.onLeave(); }}
        >
          Open full SOP
        </a>
      </div>
      <h3 className="tk-dw-h">{meta ? meta.title : "SOP section"}</h3>
      <div className="tk-dw-sop-body">
        {typeof ClientSopView === "function" ? (
          <ClientSopView client={p.client} readOnly section={p.section} />
        ) : (
          <p className="tk-dw-muted">Nothing written for this section yet.</p>
        )}
      </div>
    </div>
  );
}

// Auto-growing textarea for the title.
function TK_dwAutoGrow(el) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = el.scrollHeight + "px";
}

// ---- The task pane body --------------------------------------------------------

var TK_DW_RECURRENCES = [
  ["none", "Doesn't repeat"],
  ["daily", "Daily"],
  ["weekly", "Weekly"],
  ["monthly", "Monthly"],
  ["month_end", "Month end"],
];

// The Repeat row: the simple choices, plus "Custom…" which opens the Repeat menu
// (TK_RepeatMenu.jsx). Picking a simple choice clears any custom rule.
function TK_DwRepeatRow(props) {
  var task = props.task;
  var open = React.useState(false);
  var holidaysState = React.useState([]);
  var isCustom = task.recurrence === "custom" && task.recurrence_rule;
  React.useEffect(function () {
    if (!open[0] || typeof TK_api === "undefined" || !TK_api.holidays) return;
    var alive = true;
    TK_api.holidays().then(function (h) { if (alive) holidaysState[1](h || []); }).catch(function () {});
    return function () { alive = false; };
  }, [open[0]]);
  var timeOf = typeof TK_dlTimeOf === "function" ? TK_dlTimeOf(task.due_at) : "";
  var summary = isCustom ? TK_repeatText(task.recurrence_rule, task.due_date) : "";
  var saveRule = function (rule) {
    // Keep the series' own first date when the schedule is unchanged: a due
    // date pushed by skip weekends / holidays must not move the schedule.
    rule = Object.assign({}, rule, {
      start: TK_repeatSaveStart(isCustom ? task.recurrence_rule : null, rule, task.due_date),
    });
    var patch = { recurrence: "custom", recurrence_rule: rule };
    if (rule.time && task.due_date) {
      patch.due_at = TK_repeatDueAt(task.due_date, rule.time, rule.tz || "America/Chicago");
      patch.due_date = task.due_date;
    } else if (!rule.time && timeOf && task.due_at) patch.due_at = TK_dlDueAt(task.due_date, timeOf);
    props.save(patch);
    open[1](false);
  };
  return (
    <div className="tk-dw-value">
      <select
        id="tk-dw-repeat"
        className="tk-dw-select"
        value={task.recurrence || "none"}
        disabled={props.disabled || !task.due_date}
        title={!task.due_date ? "Add a due date to repeat this task." : undefined}
        onChange={function (e) {
          if (e.target.value === "custom") open[1](true);
          else {
            open[1](false);
            props.save({ recurrence: e.target.value, recurrence_rule: null });
          }
        }}
      >
        {TK_DW_RECURRENCES.map(function (r) {
          return (
            <option key={r[0]} value={r[0]}>
              {r[1]}
            </option>
          );
        })}
        <option value="custom">{isCustom ? "Custom" : "Custom…"}</option>
      </select>
      {isCustom && !open[0] ? (
        <p className="tk-field-help">
          {summary}{" "}
          {!props.disabled ? (
            <button type="button" className="tk-rpt-link" onClick={function () { open[1](true); }}>
              Edit
            </button>
          ) : null}
        </p>
      ) : null}
      {open[0] ? (
        <TK_RepeatEditor
          kind="task"
          idPrefix="tk-dw-rpt"
          value={isCustom ? task.recurrence_rule : null}
          start={task.due_date}
          today={props.today}
          holidays={holidaysState[0]}
          onSave={saveRule}
          onCancel={function () { open[1](false); }}
        />
      ) : null}
    </div>
  );
}

function TK_DrawerContent(props) {
  var p = props || {};
  var taskId = p.taskId;
  var embedded = p.mode === "embedded";
  var staffUser = p.staffUser || {};
  var me = TK_dwLower(staffUser.email);
  var isAdmin = !!p.isAdmin;
  var clients = Array.isArray(p.clients) ? p.clients : [];

  var task = TK_dwUseStore(function (s) { return (s.tasks && s.tasks[taskId]) || null; });
  var projects = TK_dwUseStore(function (s) { return s.projects; });
  var online = TK_dwUseOnline();
  var staff = TK_dwUseStaff();
  var nameOf = React.useMemo(function () { return TK_dwNameFn(staff); }, [staff]);

  var loadPair = React.useState("loading");
  var load = loadPair[0];
  var setLoad = loadPair[1];
  var tabPair = React.useState(function () { return TK_dwIsPhone() ? "comments" : "all"; });
  var tab = tabPair[0];
  var setTab = tabPair[1];
  var sopPair = React.useState(false);
  var sopOpen = sopPair[0];
  var setSopOpen = sopPair[1];
  var modalPair = React.useState(null); // "delete" | "sendback" | "keys" | "report"
  var modal = modalPair[0];
  var setModal = modalPair[1];
  var titlePair = React.useState("");
  var title = titlePair[0];
  var setTitle = titlePair[1];
  var descPair = React.useState("");
  var desc = descPair[0];
  var setDesc = descPair[1];
  // T3: the due date box keeps its own draft, so a year still being typed
  // (0002, 0020, 0202) is never saved or snapped back while you type.
  var duePair = React.useState(function () {
    var t0 = TK_dwState() && TK_dwState().tasks ? TK_dwState().tasks[taskId] : null;
    return t0 && t0.due_date ? String(t0.due_date).slice(0, 10) : "";
  });
  var dueDraft = duePair[0];
  var setDueDraft = duePair[1];
  var sectionPair = React.useState("");
  var sectionDraft = sectionPair[0];
  var setSectionDraft = sectionPair[1];
  var assignPair = React.useState(null);
  var assignable = assignPair[0];
  var setAssignable = assignPair[1];
  // Open out-of-office hand-offs (Tasks Phase 2 S7; Coverage.jsx).
  var coverRows = typeof CV_useMyCoverage === "function" ? CV_useMyCoverage() : [];

  var ownScopeRef = React.useRef(null);
  var scopeRef = p.scopeRef || ownScopeRef;
  var titleRef = React.useRef(null);
  var assigneeRef = React.useRef(null);
  var onCloseRef = React.useRef(p.onClose);
  onCloseRef.current = p.onClose;
  var sopOpenRef = React.useRef(sopOpen);
  sopOpenRef.current = sopOpen;
  var taskRef = React.useRef(task);
  taskRef.current = task;

  // ---- load
  var fetchTask = React.useCallback(function () {
    var api = TK_dwApi();
    if (!api) {
      setLoad("error");
      return;
    }
    setLoad(function (l) { return l === "ok" ? "ok" : "loading"; });
    api.get(taskId).then(
      function (t) {
        if (t) {
          TK_dwDispatch({ type: "upsert", task: t });
          setLoad("ok");
        } else setLoad("missing");
      },
      function (e) {
        var code = e && e.code;
        if (code === "tk_forbidden" || code === "tk_not_found" || code === "22P02") setLoad("missing");
        else setLoad("error");
      },
    );
  }, [taskId]);

  React.useEffect(function () {
    setLoad("loading");
    setSopOpen(false);
    setModal(null);
    fetchTask();
  }, [taskId]);

  // Gone from the store after it loaded (realtime said we can't see it):
  // ask again, which ends in "missing" when it really is gone.
  var hadTask = React.useRef(false);
  React.useEffect(function () {
    if (task) hadTask.current = true;
    else if (hadTask.current && load === "ok") {
      hadTask.current = false;
      fetchTask();
    }
  }, [!!task]);

  React.useEffect(function () {
    if (load !== "missing") return;
    TK_dwToast(
      typeof LK_COPY !== "undefined" && LK_COPY && LK_COPY.taskMissing
        ? LK_COPY.taskMissing
        : "That task isn't there anymore, or it's private to someone else.",
    );
    onCloseRef.current();
  }, [load]);

  // ---- drafts follow the server value unless the field is being edited
  React.useEffect(function () {
    if (!task) return;
    if (document.activeElement !== titleRef.current) setTitle(task.text || "");
  }, [task && task.text, taskId]);
  React.useEffect(function () {
    if (!task) return;
    var el = document.getElementById("tk-dw-desc");
    if (document.activeElement !== el) setDesc(task.description || "");
  }, [task && task.description, taskId]);
  React.useEffect(function () {
    if (!task) return;
    var el = document.getElementById("tk-dw-due");
    if (document.activeElement !== el) setDueDraft(task.due_date ? String(task.due_date).slice(0, 10) : "");
    // !!task: a task opened in place of another (parent link) that arrives
    // with no due date must still replace the previous task's draft.
  }, [task && task.due_date, taskId, !!task]);
  React.useEffect(function () {
    if (!task) return;
    var el = document.getElementById("tk-dw-section");
    if (document.activeElement !== el) setSectionDraft(task.section || "");
  }, [task && task.section, taskId]);
  React.useEffect(function () {
    TK_dwAutoGrow(titleRef.current);
  }, [title, load]);

  // ---- assignable people for this client or project
  var clientId = task ? task.client_id : null;
  var projectId = task ? task.project_id : null;
  React.useEffect(function () {
    setAssignable(null);
    var api = TK_dwApi();
    if (!api || typeof api.assignable !== "function" || !task) return undefined;
    var live = true;
    api.assignable({ clientId: clientId, projectId: projectId }).then(
      function (rows) { if (live) setAssignable(rows || []); },
      function () { if (live) setAssignable([]); },
    );
    return function () { live = false; };
  }, [taskId, clientId, projectId, !!task]);

  React.useEffect(function () {
    if (p.focusField === "assignee" && load === "ok" && assigneeRef.current) assigneeRef.current.focus();
  }, [p.focusField, load, taskId]);

  // Slate app E key: open with the title ready to edit (after the panel has
  // taken focus on open, so a short wait). Only the Slate keys ask for "title".
  React.useEffect(function () {
    if (p.focusField !== "title" || load !== "ok") return undefined;
    var h = setTimeout(function () {
      var el = titleRef.current;
      if (!el || el.readOnly) return;
      el.focus();
      try {
        var n = el.value.length;
        el.setSelectionRange(n, n);
      } catch (e) {}
    }, 60);
    return function () { clearTimeout(h); };
  }, [p.focusField, load, taskId]);

  // ---- Slate rhythm slice 4 (b): which rhythm row this task is (by source_ref)
  var rhythmOn = typeof TK_rhythmEnabled === "function" && TK_rhythmEnabled();
  var templateId = task ? task.template_id || null : null;
  var rhythmTplPair = React.useState(null);
  var rhythmTpl = rhythmTplPair[0];
  var setRhythmTpl = rhythmTplPair[1];
  React.useEffect(function () {
    setRhythmTpl(null);
    var api = TK_dwApi();
    if (!rhythmOn || !templateId || !api || typeof api.templateRef !== "function") return undefined;
    var live = true;
    api.templateRef(templateId).then(function (row) { if (live) setRhythmTpl(row); }, function () {});
    return function () { live = false; };
  }, [rhythmOn, templateId]);
  var needsReportPick = function (t) {
    return typeof TK_reportPickerNeeded === "function" && TK_reportPickerNeeded(t, rhythmTpl, rhythmOn);
  };

  // ---- permissions
  var projectList = Array.isArray(projects) ? projects : [];
  var project = projectId ? projectList.filter(function (x) { return x && x.id === projectId; })[0] || null : null;
  var client = clientId ? clients.filter(function (c) { return c && String(c.id) === String(clientId); })[0] || null : null;
  var canEdit = false;
  if (task) {
    if (typeof TK_canEdit === "function") {
      canEdit = TK_canEdit(task, {
        email: me,
        isAdmin: isAdmin,
        canSeeClient: function (id) { return clients.some(function (c) { return c && String(c.id) === String(id); }); },
        isMember: function (id) { return projectList.some(function (x) { return x && x.id === id; }); },
      });
    } else {
      canEdit = isAdmin || TK_dwLower(task.staff_email) === me || TK_dwLower(task.assignee_email) === me;
    }
  }
  var isOwner = !!task && TK_dwLower(task.staff_email) === me;
  var deleted = !!(task && task.deleted_at);
  var readOnly = !task || deleted || !canEdit || !online;
  var canAssign = !readOnly && (isOwner || isAdmin);

  // ---- saving
  var save = React.useCallback(function (draft, opts) {
    var t = taskRef.current;
    var api = TK_dwApi();
    if (!t || !api) return Promise.resolve(null);
    var patch = TK_buildPatch(t, draft);
    if (!Object.keys(patch).length) return Promise.resolve(t);
    var check = {};
    Object.keys(patch).forEach(function (k) { check[k] = patch[k]; });
    if ("start_on" in patch || "due_date" in patch) {
      check.start_on = "start_on" in patch ? patch.start_on : t.start_on;
      check.due_date = "due_date" in patch ? patch.due_date : t.due_date;
    }
    if ("recurrence" in patch) check.due_date = "due_date" in patch ? patch.due_date : t.due_date;
    var errs = TK_validateDraft(check);
    var firstErr = Object.keys(errs)[0];
    if (firstErr) {
      TK_dwToast(errs[firstErr]);
      return Promise.resolve(null);
    }
    return api
      .update(t.id, patch, { optimistic: true, baseUpdatedAt: opts && opts.base ? t.updated_at : null })
      .catch(function (e) {
        TK_dwSaveError(e);
        return null;
      });
  }, []);

  var setStatus = function (status) {
    var t = taskRef.current;
    var api = TK_dwApi();
    if (!t || !api || readOnly) return;
    var cur = TK_dwEffectiveStatus(t);
    if (status === cur) return;
    if (cur === "ready_for_review") {
      var role = typeof TK_reviewRole === "function" ? TK_reviewRole(t, { me: me, isAdmin: isAdmin }) : {};
      if (status === "in_progress" && role.canSendBack) {
        setModal("sendback");
        return;
      }
      if (status === "in_progress" && typeof api.withdraw === "function") {
        api.withdraw(t.id).catch(TK_dwReviewError);
        return;
      }
      if (status === "done" && typeof api.approve === "function") {
        api.approve(t.id).catch(TK_dwReviewError);
        return;
      }
    }
    if (status === "done" && needsReportPick(t)) {
      setModal("report");
      return;
    }
    if (status === "done") {
      api.complete(t, { done: true, isAdmin: isAdmin }).catch(TK_dwSaveError);
      return;
    }
    api.setStatus(t.id, status).catch(TK_dwSaveError);
  };

  var toggleDone = function () {
    var t = taskRef.current;
    var api = TK_dwApi();
    if (!t || !api || readOnly) return;
    if (TK_dwIsOpen(t) && TK_dwEffectiveStatus(t) !== "ready_for_review" && needsReportPick(t)) {
      setModal("report");
      return;
    }
    api.complete(t, { done: TK_dwIsOpen(t), isAdmin: isAdmin }).catch(TK_dwSaveError);
  };

  var copyLink = function () {
    var url = window.location.origin + "/" + TK_dwTaskHref(taskId);
    var done = function () { TK_dwToast(TK_dwCopy("linkCopied", "Link copied.")); };
    var fail = function () { TK_dwToast("Couldn't copy the link."); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(done, fail);
        return;
      }
    } catch (e) {}
    try {
      var ta = document.createElement("textarea");
      ta.value = url;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(ta);
      if (ok) done();
      else fail();
    } catch (e) {
      fail();
    }
  };

  var saveAsTemplate = function () {
    var t = taskRef.current;
    if (!t || typeof TT_draftFromTask !== "function") return;
    var sb = typeof window !== "undefined" ? window.mgbSupabase : null;
    if (p.canCreateTemplates && typeof p.onOpenTemplates === "function") {
      Promise.resolve()
        .then(function () { return typeof TCL_fetchTexts === "function" ? TCL_fetchTexts(sb, t.id) : []; })
        .then(function (checklist) {
          if (typeof TT_openDraft === "function") TT_openDraft(TT_draftFromTask(t, { checklist: checklist || [] }));
          p.onClose();
          p.onOpenTemplates();
        })
        .catch(function (e) { TK_dwSaveError(e); });
      return;
    }
    if (typeof TT_suggestFromTask !== "function") return;
    Promise.resolve()
      .then(function () { return TT_suggestFromTask(sb, t); })
      .then(function (res) {
        var r = res || {};
        if (r.duplicate) TK_dwToast("You've already suggested this one. An admin will review it.");
        else if (r.error) TK_dwToast("Couldn't send the suggestion. Try again.");
        else TK_dwToast("Suggested to admins as a recurring template.");
      })
      .catch(function () { TK_dwToast("Couldn't send the suggestion. Try again."); });
  };

  var doDelete = function () {
    setModal(null);
    var api = TK_dwApi();
    if (!api || !task) return;
    // P4-3: remove() raises the toast itself (with Undo on schema 12+).
    api.remove(task.id, { toast: TK_dwCopy("deleted", "Task deleted.") }).then(null, TK_dwSaveError);
  };

  var doRestore = function () {
    var api = TK_dwApi();
    if (!api || !task) return;
    api.restore(task.id).then(
      function () { TK_dwToast(TK_dwCopy("restored", "Task restored.")); },
      TK_dwSaveError,
    );
  };

  // ---- keys: the host owns Esc (and, as the modal, the Tab trap); it asks
  // here first so an open SOP panel closes before the drawer does. x s a ?
  // are handled below (bubble, on window).
  var registerEsc = p.registerEsc;
  React.useEffect(function () {
    if (typeof registerEsc !== "function") return undefined;
    registerEsc(function () {
      if (!sopOpenRef.current) return false;
      setSopOpen(false);
      return true;
    });
    return function () { registerEsc(null); };
  }, [registerEsc]);

  var keyActions = React.useRef({});
  keyActions.current = {
    x: toggleDone,
    s: function () {
      var wrap = scopeRef.current && scopeRef.current.querySelector("[data-tk-drawer-status]");
      var ctl = wrap && wrap.querySelector("button, select");
      if (!ctl || ctl.disabled) return;
      if (ctl.tagName.toLowerCase() === "select") ctl.focus();
      else ctl.click();
    },
    a: function () {
      if (assigneeRef.current && !assigneeRef.current.disabled) assigneeRef.current.focus();
    },
    "?": function () { setModal("keys"); },
  };

  React.useEffect(function () {
    var onKey = function (e) {
      var k = e.key;
      if (k !== "x" && k !== "s" && k !== "a" && k !== "?") return;
      var ctx = {
        modalOpen: !!document.querySelector(".modal-overlay"),
        menuOpen: TK_dwMenuOpen(document),
        tourOpen: !!document.querySelector(".tour-root"),
        scope: "drawer",
        keysOff: typeof TK_prefsQuickKeysOff === "function" ? TK_prefsQuickKeysOff() : false,
      };
      if (embedded) ctx.embedded = true;
      if (typeof TK_shouldHandleKey === "function") {
        if (!TK_shouldHandleKey(e, ctx)) return;
        // Embedded: any drawer keyscope passes TK_shouldHandleKey, so also
        // require this pane's own scope (a modal drawer over the Desk must not
        // get x / s / a / ? twice).
        if (embedded && !(scopeRef.current && scopeRef.current.contains(e.target))) return;
      } else {
        if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented || e.isComposing) return;
        if (ctx.modalOpen || ctx.menuOpen || ctx.tourOpen) return;
        if (TK_dwIsTyping(e.target)) return;
        var panel = scopeRef.current;
        if ((embedded || e.target !== document.body) && !(panel && panel.contains(e.target))) return;
      }
      e.preventDefault();
      TK_dwTrackShortcut(k);
      var fn = keyActions.current[k];
      if (fn) fn();
    };
    window.addEventListener("keydown", onKey);
    return function () { window.removeEventListener("keydown", onKey); };
  }, []);

  // ---- render
  var labelId = "tk-dw-title-" + String(taskId).slice(0, 8);
  var today = TK_dwToday();

  var body;
  if (!task) {
    body =
      load === "error" ? (
        <div className="tk-dw-body">
          <p className="tk-dw-muted">
            {TK_dwCopy("loadError", "Couldn't load your tasks.")}{" "}
            <button type="button" className="link-btn" onClick={fetchTask}>
              {TK_dwCopy("retry", "Try again")}
            </button>
          </p>
        </div>
      ) : (
        <div className="tk-dw-body" aria-busy="true">
          <div className="tk-dw-skel tk-dw-skel-title" />
          <div className="tk-dw-skel" />
          <div className="tk-dw-skel" />
          <div className="tk-dw-skel tk-dw-skel-short" />
        </div>
      );
  }

  var status = task ? TK_dwEffectiveStatus(task) : "todo";
  var containerName = client ? client.name || "Client" : project ? project.name || "Project" : task && task.client_id ? "Client" : task && task.project_id ? "Project" : "";
  var sopSections = typeof CLIENT_SOP_SECTIONS !== "undefined" && CLIENT_SOP_SECTIONS
    ? CLIENT_SOP_SECTIONS
    : (typeof TK_SOP_SECTION_IDS !== "undefined" ? TK_SOP_SECTION_IDS : []).map(function (id) { return { id: id, title: id.replace(/_/g, " ") }; });
  var sectionOptions = [];
  if (task) {
    var used = [];
    var st = TK_dwState();
    if (st && st.tasks) {
      Object.keys(st.tasks).forEach(function (k) {
        var other = st.tasks[k];
        if (!other || !other.section || other.deleted_at) return;
        if ((clientId && String(other.client_id) === String(clientId)) || (projectId && other.project_id === projectId)) used.push(other.section);
      });
    }
    sectionOptions = TK_dlSectionOptions(
      project && Array.isArray(project.sections) ? project.sections : null,
      used,
      clientId && typeof TK_CLIENT_SECTION_ORDER !== "undefined" ? TK_CLIENT_SECTION_ORDER : [],
    );
  }

  var assignees = (assignable || []).slice();
  // S8b: the assignee only; "" is Unassigned (anyone on the client can claim it).
  var curAssignee = task ? TK_dwLower(task.assignee_email) : "";
  if (curAssignee && !assignees.some(function (a) { return TK_dwLower(a.email) === curAssignee; })) {
    assignees.unshift({ email: curAssignee, name: nameOf(curAssignee), can_see: true });
  }
  var curAssigneeRow = assignees.filter(function (a) { return TK_dwLower(a.email) === curAssignee; })[0];
  var assigneeWarn = !!(task && task.client_id && curAssigneeRow && curAssigneeRow.can_see === false);
  var dueTime = task ? TK_dlTimeOf(task.due_at) : "";
  var descLen = desc.length;

  var moreItems = task
    ? [
        typeof TT_draftFromTask === "function" && task.kind !== "note" && !deleted
          ? {
              key: "tpl",
              label: p.canCreateTemplates ? "Save as template" : "Suggest as template",
              onSelect: saveAsTemplate,
              disabled: !online,
            }
          : null,
        (isOwner || canEdit) && !deleted
          ? { key: "del", label: "Delete", danger: true, onSelect: function () { setModal("delete"); }, disabled: !online }
          : null,
      ]
    : [];

  var leave = function () { p.onClose(); };

  var fieldDisabled = readOnly;

  // ---- T3: values for the labeled field grid, in TK_dlFieldGrid's order.
  var gf = {};
  var grid = typeof TK_dlFieldGrid === "function" ? TK_dlFieldGrid(task, { readOnly: readOnly, canAssign: canAssign, status: status }) : [];
  grid.forEach(function (f) { gf[f.key] = f; });
  var priority = typeof TK_rwPriorityOf === "function" ? TK_rwPriorityOf(task) : task && (task.priority === "high" || task.priority === "low") ? task.priority : "normal";
  var priorities = typeof TK_RW_PRIORITIES !== "undefined" ? TK_RW_PRIORITIES : [{ key: "high", label: "High" }, { key: "normal", label: "Normal" }, { key: "low", label: "Low" }];
  // A due date saves as the task rows save it (TK_rwDuePatch, TK_rwDueSavePatch):
  // only a whole date with a real year, due_at follows the day and keeps its
  // time, and clearing the date ends a repeat.
  var saveDue = function (v) {
    var t = taskRef.current;
    if (!t) return;
    var pick = typeof TK_rwDuePatch === "function" ? TK_rwDuePatch(v ? "date" : "clear", today, v) : { due_date: v || null };
    if (!pick) return;
    var draft;
    if (typeof TK_rwDueSavePatch === "function") {
      draft = TK_rwDueSavePatch(t, pick, { dueAt: TK_dlDueAt, timeOf: TK_dlTimeOf });
    } else {
      draft = { due_date: pick.due_date, due_at: TK_dlDueAt(pick.due_date, dueTime) };
      if (!pick.due_date && t.recurrence && t.recurrence !== "none") draft.recurrence = "none";
    }
    save(draft);
  };
  var gridValues = !task
    ? {}
    : {
        assignee: (
          <div className="tk-dw-value">
            <select
              id="tk-dw-assignee"
              ref={assigneeRef}
              className="tk-dw-select"
              value={curAssignee}
              disabled={!gf.assignee.editable}
              title={
                gf.assignee.hint === "inReview"
                  ? TK_dwCopy("inReview", "This is in review. Take it back from review before you reassign it.")
                  : gf.assignee.hint === "notOwner"
                    ? "Only the task's owner or an admin can reassign it."
                    : undefined
              }
              onChange={function (e) {
                var v = e.target.value;
                if (!v) return;
                // P4-3: on schema 12+ a reassign has an Undo toast.
                var api = TK_dwApi();
                if (api && typeof api.bulkReady === "function" && api.bulkReady() && typeof api.reassign === "function" && task && TK_dwLower(v) !== curAssignee) {
                  api.reassign(task.id, v, { toast: "Reassigned to " + nameOf(v) + "." }).catch(TK_dwSaveError);
                  return;
                }
                save({ assignee_email: v });
              }}
            >
              {curAssignee ? null : (
                <option value="" disabled>
                  Unassigned
                </option>
              )}
              {assignees.map(function (a) {
                var em = TK_dwLower(a.email);
                return (
                  <option key={em} value={em}>
                    {(a.name || nameOf(em)) + (a.can_see === false ? " (no access)" : "")}
                  </option>
                );
              })}
            </select>
            {!curAssignee && (
              <span className="tk-unassigned tk-dw-unassigned">
                <span className="tk-chip tk-chip-unassigned">
                  <span className="tk-chip-name">Unassigned</span>
                </span>
              </span>
            )}
            {assigneeWarn && (
              <p className="tk-dw-warn" role="note">
                {TK_dwCopy("noClientAccess", "They can't see this client yet, so they won't see this task.")}
              </p>
            )}
            {(function () {
              if (typeof TK_coverageLabel !== "function") return null;
              var row = coverRows.filter(function (r) { return r && r.task_id === task.id; })[0];
              var lbl = TK_coverageLabel(row, me);
              if (!lbl) return null;
              return (
                <p className="tk-cover-chip tk-dw-cover" title={lbl.title}>
                  {lbl.text}
                </p>
              );
            })()}
          </div>
        ),
        due: (
          <div className="tk-dw-value tk-dw-pair">
            <input
              id="tk-dw-due"
              type="date"
              className="tk-dw-input"
              value={dueDraft}
              disabled={!gf.due.editable}
              aria-describedby={dueDraft ? undefined : "tk-dw-due-ph"}
              onChange={function (e) {
                var v = e.target.value || "";
                setDueDraft(v);
                // A date box reports "" while one part (day, month or year) is
                // blank but the others are not (validity.badInput). That is a
                // half-typed date, not a clear: saving it would drop the due
                // date and end a repeat. Only an all-blank box clears.
                if (!v && e.target.validity && e.target.validity.badInput) return;
                saveDue(v);
              }}
              onBlur={function () {
                var t = taskRef.current;
                setDueDraft(t && t.due_date ? String(t.due_date).slice(0, 10) : "");
              }}
            />
            <input
              type="time"
              className="tk-dw-input tk-dw-time"
              aria-label="Due time (optional)"
              value={dueTime}
              disabled={fieldDisabled || !task.due_date}
              onChange={function (e) { save({ due_at: TK_dlDueAt(task.due_date, e.target.value) }); }}
            />
            {!dueDraft && (
              <span className="tk-dw-ph" id="tk-dw-due-ph">
                {gf.due.placeholder}
              </span>
            )}
          </div>
        ),
        client: (
          <div className="tk-dw-value">
            {task.client_id ? (
              <React.Fragment>
                <a
                  className="tk-dw-link"
                  href={TK_dwClientListHref(task.client_id)}
                  onClick={function (e) {
                    if (!TK_dlIsPlainClick(e)) return;
                    e.preventDefault();
                    leave();
                    TK_dwGo({ view: "client", clientId: task.client_id }, TK_dwClientListHref(task.client_id));
                  }}
                >
                  {client ? client.name || "Client" : "Client"}
                </a>
                <TK_dwPeople clientId={task.client_id} reviewRequired={!!task.review_required} staff={staff} />
              </React.Fragment>
            ) : (
              <span className="tk-dw-ph">{gf.client.placeholder}</span>
            )}
          </div>
        ),
        project: (
          <div className="tk-dw-value">
            {task.project_id ? (
              <a
                className="tk-dw-link"
                href={TK_dwProjectHref(task.project_id)}
                onClick={function (e) {
                  if (!TK_dlIsPlainClick(e)) return;
                  e.preventDefault();
                  leave();
                  TK_dwGo({ view: "project", projectId: task.project_id }, TK_dwProjectHref(task.project_id));
                }}
              >
                {project ? project.name || "Project" : "Project"}
              </a>
            ) : (
              <span className="tk-dw-ph">{gf.project.placeholder}</span>
            )}
          </div>
        ),
        priority: (
          <div className="tk-dw-value tk-dw-pair">
            <span className={"tk-prio-dot tk-prio-dot-" + priority} aria-hidden="true" />
            <select
              id="tk-dw-priority"
              className="tk-dw-select"
              value={priority}
              disabled={!gf.priority.editable}
              onChange={function (e) { save({ priority: e.target.value }); }}
            >
              {priorities.map(function (o) {
                return (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                );
              })}
            </select>
          </div>
        ),
        status: (
          <div className="tk-dw-value">
            <span data-tk-drawer-status className="tk-dw-status">
              <TK_dwStatus task={task} isAdmin={isAdmin} canEdit={gf.status.editable} onChange={setStatus} />
            </span>
          </div>
        ),
      };

  if (task) {
    body = (
      <div className="tk-dw-body">
        {deleted && (
          <div className="tk-dw-banner is-bad" role="status">
            <span>{TK_dwCopy("deletedBanner", "This task was deleted.")}</span>
            {(isOwner || isAdmin || canEdit) && (
              <button type="button" className="btn-secondary tk-dw-btn-sm" disabled={!online} onClick={doRestore}>
                Restore
              </button>
            )}
          </div>
        )}
        {!online && (
          <div className="tk-dw-banner" role="status">
            {TK_dwCopy("offline", "You're offline.")}
          </div>
        )}
        <TK_dwReview
          task={task}
          staff={staff}
          me={me}
          isAdmin={isAdmin}
          readOnly={readOnly}
          onApprove={function () {
            var api = TK_dwApi();
            if (api && typeof api.approve === "function") api.approve(task.id).catch(TK_dwReviewError);
          }}
          onSendBack={function () { setModal("sendback"); }}
          onWithdraw={function () {
            var api = TK_dwApi();
            if (api && typeof api.withdraw === "function") api.withdraw(task.id).catch(TK_dwReviewError);
          }}
          onSetReviewer={function (email) {
            var api = TK_dwApi();
            if (api && typeof api.setReviewer === "function") api.setReviewer(task.id, email).catch(TK_dwReviewError);
          }}
        />
        {task.parent_id && (
          <p className="tk-dw-parent">
            <a href={TK_dwTaskHref(task.parent_id)} onClick={TK_openTaskClick(task.parent_id)} className="link-btn">
              {"↑"} Open the parent task
            </a>
          </p>
        )}
        <TK_dwCloseLink task={task} readOnly={readOnly} />
        {typeof TK_EmailDraftButton === "function" ? (
          <p className="tk-dw-email-draft">
            <TK_EmailDraftButton task={task} />
          </p>
        ) : null}

        {/* T3 field grid. Future slot: a task Size field (docs/desk-right-spec.md
            section 17, idea 7) joins TK_DL_GRID_FIELDS later. Not built. */}
        <div className="tk-dw-grid" role="group" aria-label="Task fields" data-tour="tk-dw-fields">
          {grid.map(function (f) {
            var forId = f.key === "assignee" ? "tk-dw-assignee" : f.key === "due" ? "tk-dw-due" : f.key === "priority" ? "tk-dw-priority" : null;
            return (
              <div key={f.key} className={"tk-dw-gf tk-dw-gf-" + f.key + (f.empty ? " is-empty" : "")}>
                {forId ? (
                  <label className="tk-dw-label" htmlFor={forId}>
                    {f.label}
                  </label>
                ) : (
                  <span className="tk-dw-label">{f.label}</span>
                )}
                {gridValues[f.key]}
              </div>
            );
          })}
        </div>

        <div className="tk-dw-fields">
          <label className="tk-dw-label" htmlFor="tk-dw-start">
            Start
          </label>
          <div className="tk-dw-value">
            <input
              id="tk-dw-start"
              type="date"
              className="tk-dw-input"
              value={task.start_on ? String(task.start_on).slice(0, 10) : ""}
              disabled={fieldDisabled}
              onChange={function (e) { save({ start_on: e.target.value || null }); }}
            />
          </div>

          <label className="tk-dw-label" htmlFor="tk-dw-section">
            Section
          </label>
          <div className="tk-dw-value">
            <input
              id="tk-dw-section"
              type="text"
              className="tk-dw-input"
              list="tk-dw-section-list"
              maxLength={80}
              placeholder="No section"
              value={sectionDraft}
              disabled={fieldDisabled}
              onChange={function (e) { setSectionDraft(e.target.value); }}
              onBlur={function () { save({ section: sectionDraft }); }}
              onKeyDown={function (e) {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.currentTarget.blur();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  setSectionDraft(task.section || "");
                  var el = e.currentTarget;
                  setTimeout(function () { el.blur(); }, 0);
                }
              }}
            />
            <datalist id="tk-dw-section-list">
              {sectionOptions.map(function (s) {
                return <option key={s} value={s} />;
              })}
            </datalist>
          </div>

          <label className="tk-dw-label" htmlFor="tk-dw-kind">
            Type
          </label>
          <div className="tk-dw-value">
            <select
              id="tk-dw-kind"
              className="tk-dw-select"
              value={task.kind || "task"}
              disabled={fieldDisabled}
              onChange={function (e) { save({ kind: e.target.value }); }}
            >
              <option value="task">Task</option>
              <option value="reminder">Reminder</option>
              {task.kind === "note" && <option value="note">Note</option>}
            </select>
          </div>

          <label className="tk-dw-label" htmlFor="tk-dw-remind">
            Remind me
          </label>
          <div className="tk-dw-value">
            <input
              id="tk-dw-remind"
              type="datetime-local"
              className="tk-dw-input"
              value={TK_dlToLocalInput(task.remind_at)}
              disabled={fieldDisabled}
              onChange={function (e) { save({ remind_at: TK_dlFromLocalInput(e.target.value) }); }}
            />
          </div>

          <label className="tk-dw-label" htmlFor="tk-dw-repeat">
            Repeat
          </label>
          <TK_DwRepeatRow task={task} disabled={fieldDisabled} save={save} today={today} />

          {(task.client_id || task.project_id) && (
            <React.Fragment>
              <span className="tk-dw-label">Sharing</span>
              <div className="tk-dw-value" data-tour="tk-dw-sharing">
                <label className="tk-dw-check">
                  <input
                    type="checkbox"
                    checked={task.visibility === "shared"}
                    disabled={fieldDisabled || !isOwner}
                    onChange={function (e) { save({ visibility: e.target.checked ? "shared" : "private" }); }}
                  />
                  <span>{task.client_id ? "Share with the client's team" : "Share with project members"}</span>
                </label>
                {!isOwner && <p className="tk-dw-hint">Only the task's owner can change this.</p>}
              </div>
            </React.Fragment>
          )}

          <span className="tk-dw-label">Review</span>
          <div className="tk-dw-value">
            <label className="tk-dw-check">
              <input
                type="checkbox"
                checked={!!task.review_required}
                disabled={fieldDisabled || (!!task.review_required && !isAdmin)}
                onChange={function (e) { save({ review_required: e.target.checked }); }}
              />
              <span>Needs review before it's done</span>
            </label>
            {!!task.review_required && !isAdmin && <p className="tk-dw-hint">Only an admin can turn this off.</p>}
          </div>

          {task.client_id && (
            <React.Fragment>
              <label className="tk-dw-label" htmlFor="tk-dw-sop">
                SOP section
              </label>
              <div className="tk-dw-value tk-dw-pair">
                <select
                  id="tk-dw-sop"
                  className="tk-dw-select"
                  value={task.sop_section || ""}
                  disabled={fieldDisabled}
                  onChange={function (e) { save({ sop_section: e.target.value || null }); }}
                >
                  <option value="">None</option>
                  {sopSections.map(function (s) {
                    return (
                      <option key={s.id} value={s.id}>
                        {s.title}
                      </option>
                    );
                  })}
                </select>
                {task.sop_section && (
                  <button type="button" className="btn-secondary tk-dw-btn-sm" onClick={function () { setSopOpen(true); }}>
                    View SOP section
                  </button>
                )}
              </div>
            </React.Fragment>
          )}
        </div>

        <section className="tk-dw-section">
          <label className="tk-dw-h" htmlFor="tk-dw-desc">
            Description
          </label>
          <textarea
            id="tk-dw-desc"
            className="tk-dw-textarea"
            rows={4}
            maxLength={5000}
            placeholder={fieldDisabled ? "" : "Add details, steps or links"}
            value={desc}
            disabled={fieldDisabled}
            onChange={function (e) { setDesc(e.target.value); }}
            onBlur={function () { save({ description: desc }, { base: true }); }}
            onKeyDown={function (e) {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                e.currentTarget.blur();
              }
            }}
          />
          {descLen > 4500 && (
            <p className={"tk-dw-counter" + (descLen >= 5000 ? " is-bad" : "")} aria-live="polite">
              {descLen.toLocaleString("en-US")} of 5,000
            </p>
          )}
        </section>

        <TK_dwSubtasks task={task} isAdmin={isAdmin} readOnly={readOnly} canAdd={canEdit && !task.parent_id} />

        {typeof TCL_Checklist === "function" && (
          <section className="tk-dw-section" aria-label="Checklist" data-tour="tk-dw-checklist">
            <h3 className="tk-dw-h">Checklist</h3>
            <TCL_Checklist task={task} canEdit={canEdit && !deleted && online} />
          </section>
        )}

        {typeof TK_dwRequests === "function" && task.client_id && (
          <TK_dwRequests task={task} canEdit={canEdit && !deleted && online} isAdmin={isAdmin} nameOf={nameOf} />
        )}

        <section className="tk-dw-section" aria-labelledby="tk-dw-files-h">
          <h3 className="tk-dw-h" id="tk-dw-files-h">
            Files and links
          </h3>
          {typeof TK_Attachments === "function" && (
            <TK_Attachments task={task} canEdit={canEdit && !deleted && online} staffUser={staffUser} nameOf={nameOf} />
          )}
        </section>

        {/* Future slot (docs/desk-right-spec.md section 17, idea 4): a "Linked"
            section for the task's evidence (GL flag, transaction, file,
            message) goes here. Not built. */}

        <section className="tk-dw-section tk-dw-thread-wrap" data-tour="tk-dw-thread">
          <div className="tk-dw-tabs" role="tablist" aria-label="Comments and activity">
            {[
              ["all", "All"],
              ["comments", "Comments"],
              ["activity", "Activity"],
            ].map(function (t) {
              return (
                <button
                  key={t[0]}
                  type="button"
                  role="tab"
                  id={"tk-dw-tab-" + t[0]}
                  aria-selected={tab === t[0] ? "true" : "false"}
                  aria-controls="tk-dw-tabpanel"
                  tabIndex={tab === t[0] ? 0 : -1}
                  className={"tk-dw-tab" + (tab === t[0] ? " is-on" : "")}
                  onClick={function () { setTab(t[0]); }}
                  onKeyDown={function (e) {
                    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
                    e.preventDefault();
                    var order = ["all", "comments", "activity"];
                    var i = order.indexOf(tab);
                    var next = order[(i + (e.key === "ArrowRight" ? 1 : 2)) % 3];
                    setTab(next);
                    var el = document.getElementById("tk-dw-tab-" + next);
                    if (el) el.focus();
                  }}
                >
                  {t[1]}
                </button>
              );
            })}
          </div>
          <div id="tk-dw-tabpanel" role="tabpanel" aria-labelledby={"tk-dw-tab-" + tab}>
            {tab === "activity"
              ? typeof TK_Activity === "function" && <TK_Activity taskId={task.id} nameOf={nameOf} stamp={task.updated_at} />
              : typeof TK_Comments === "function" && (
                  <TK_Comments
                    task={task}
                    staffUser={staffUser}
                    staff={staff}
                    canComment={!deleted && online}
                    showActivity={tab === "all"}
                    nameOf={nameOf}
                  />
                )}
          </div>
        </section>
      </div>
    );
  }

  var inner = (
    <React.Fragment>
        <header className="tk-dw-head">
          <div className="tk-dw-head-row">
            {embedded && p.headStart ? p.headStart : null}
            <span className="tk-dw-context">
              {containerName}
              {task && task.section ? " · " + task.section : ""}
            </span>
            <div className="tk-dw-head-actions">
              <button type="button" className="tk-dw-icon-btn" onClick={copyLink} aria-label="Copy link" title="Copy link" data-tour="tk-dw-copylink">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5" />
                  <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" />
                </svg>
              </button>
              <TK_dwMenu label="More actions" items={moreItems} />
              <button type="button" className="tk-dw-icon-btn tk-dw-close" onClick={function () { p.onClose(); }} aria-label="Close details" title="Close (Esc)">
                ×
              </button>
            </div>
          </div>
          {task && (
            <div className="tk-dw-title-row">
              <h2 className="tk-dw-title-h" id={labelId}>
                <textarea
                  ref={titleRef}
                  className={"tk-dw-title" + (status === "done" ? " is-done" : "")}
                  aria-label="Title"
                  rows={1}
                  maxLength={500}
                  value={title}
                  readOnly={readOnly}
                  onChange={function (e) { setTitle(e.target.value.replace(/\n/g, " ")); }}
                  onBlur={function () {
                    if (readOnly) return;
                    var t = taskRef.current;
                    if (!String(title).trim()) {
                      setTitle(t ? t.text || "" : "");
                      return;
                    }
                    save({ text: title }, { base: true });
                  }}
                  onKeyDown={function (e) {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      e.currentTarget.blur();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      e.stopPropagation();
                      var t = taskRef.current;
                      setTitle(t ? t.text || "" : "");
                      var el = e.currentTarget;
                      setTimeout(function () { el.blur(); }, 0);
                    }
                  }}
                />
              </h2>
            </div>
          )}
          {task && (
            <p className="tk-dw-sub">
              {TK_dwStatusLabel(status)}
              {(function () {
                if (!task.due_date || typeof TK_dueLabel !== "function") return "";
                var dl = TK_dueLabel(task, today);
                if (!dl) return "";
                if (/late$/.test(dl)) return " · " + dl;
                return " · Due " + (dl === "Today" || dl === "Tomorrow" || dl === "Yesterday" ? dl.toLowerCase() : dl);
              })()}
              {task.assignee_email ? " · " + nameOf(task.assignee_email) : " · Unassigned"}
              {task.source === "template" ? <span className="tk-dw-recurring" title="Made by a recurring template. See Slate › Recurring."> · Recurring</span> : null}
            </p>
          )}
        </header>
        {body}
        {task && (
          <TK_dwFollowers
            task={task}
            me={me}
            staff={staff}
            nameOf={nameOf}
            canEdit={canEdit}
            online={online}
            deleted={deleted}
          />
        )}
        {sopOpen && task && task.client_id && task.sop_section && (
          <TK_dwSopPanel
            client={client || { id: task.client_id }}
            section={task.sop_section}
            onClose={function () { setSopOpen(false); }}
            onLeave={leave}
          />
        )}
    </React.Fragment>
  );
  var after = (
    <React.Fragment>
      {modal === "delete" && (
        <TK_dwConfirm
          title="Delete this task?"
          body="It leaves every list. Its comments and checklist are kept, and the owner or an admin can restore it."
          confirmLabel="Delete"
          onConfirm={doDelete}
          onCancel={function () { setModal(null); }}
        />
      )}
      {modal === "sendback" && (
        <TK_dwSendBack
          onCancel={function () { setModal(null); }}
          onConfirm={function (note) {
            setModal(null);
            var api = TK_dwApi();
            if (api && task && typeof api.sendBack === "function") api.sendBack(task.id, note).catch(TK_dwReviewError);
          }}
        />
      )}
      {modal === "report" && task && (
        <TK_dwReportState
          taskId={task.id}
          clientId={task.client_id || null}
          period={TK_reportPeriodOf(task)}
          onCancel={function () { setModal(null); }}
          onConfirm={function (state, missing) {
            var api = TK_dwApi();
            var t = taskRef.current;
            if (!api || !t || typeof api.setReportState !== "function") return null;
            return api.setReportState(t.client_id, TK_reportPeriodOf(t), state, missing).then(function () {
              setModal(null);
              return api.complete(t, { done: true, isAdmin: isAdmin, skipReportPick: true });
            }).catch(TK_dwSaveError);
          }}
        />
      )}
      {modal === "keys" && <TK_dwKeys onClose={function () { setModal(null); }} />}
    </React.Fragment>
  );
  var info = { label: task && task.text ? task.text : "Task details" };
  if (typeof p.frame === "function") return p.frame(inner, after, info);
  // Embedded (the Desk task view, R2): the host gives the keyscope element.
  return (
    <React.Fragment>
      {inner}
      {after}
    </React.Fragment>
  );
}
