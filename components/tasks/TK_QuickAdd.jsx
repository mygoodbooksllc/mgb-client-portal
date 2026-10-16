// ----------------------------------------------------------------------------
// Tasks module, drawer slice: quick add (spec C7, rows 2.1, 3.6).
//
//   TK_QuickAddHost({ staffUser, clients, currentClientId })
//       mounted once by App. Opens the dialog on "tk:quick-add" (detail:
//       { client_id?, project_id?, section?, text?, due_date?, kind? }), on
//       the top bar's "tb:quick-add" with kind "task", and on the q key.
//   TK_QuickAddDialog(props)
//
// The title line understands plain words ("for Sierra", "re Acme", "by Friday",
// "the 15th", "for me") as well as @person (@me too), #client, !high or !low
// and dates such as "fri" or "oct 14" (TK_parseQuickAdd). What it understood
// shows as chips and a "Will add" line; the x on a chip puts the words back
// in the title. A name that fits two people or two clients is never guessed:
// "Did you mean" asks. A field picked by hand wins over what the line says.
// Enter adds; Shift+Enter adds and opens the task.
// With the new columns missing, it saves through the legacy staffItemsApi.
// ----------------------------------------------------------------------------

var TK_QA_TOKEN_LABELS = { person: "Assignee", client: "Client", priority: "Priority", date: "Due" };

function TK_qaToday() {
  return TK_dwToday();
}

// "Will add" line: the title and what the line and the fields below it say.
function TK_qaWillAdd(parts) {
  var bits = [];
  if (parts.assigneeName) bits.push("for " + parts.assigneeName);
  if (parts.clientName) bits.push("client " + parts.clientName);
  if (parts.dueLabel) bits.push("due " + parts.dueLabel);
  if (parts.priorityLabel && parts.priority !== "normal") bits.push(parts.priorityLabel.toLowerCase() + " priority");
  return "Will add \u201c" + parts.title + "\u201d" + (bits.length ? ", " + bits.join(", ") : "") + ".";
}

function TK_qaCut(input, start, end) {
  var s = String(input || "");
  var out = s.slice(0, start) + s.slice(end);
  return out.replace(/\s{2,}/g, " ").replace(/^\s+/, "");
}

function TK_QuickAddDialog(props) {
  var p = props;
  var base = p.defaults || {};
  var staffUser = p.staffUser || {};
  var me = TK_dwLower(staffUser.email);
  var clients = Array.isArray(p.clients) ? p.clients : [];
  var staff = TK_dwUseStaff();
  var nameOf = React.useMemo(function () { return TK_dwNameFn(staff); }, [staff]);
  var online = TK_dwUseOnline();
  var schema = TK_dwUseStore(function (s) { return s.schema; });
  var projects = TK_dwUseStore(function (s) { return s.projects; });

  var inputPair = React.useState(base.text || "");
  var input = inputPair[0];
  var setInput = inputPair[1];
  var touchedPair = React.useState({});
  var touched = touchedPair[0];
  var setTouched = touchedPair[1];
  var busyPair = React.useState(false);
  var busy = busyPair[0];
  var setBusy = busyPair[1];
  var errPair = React.useState("");
  var err = errPair[0];
  var setErr = errPair[1];
  var ignoredPair = React.useState([]); // chips the person turned off (TK_qaIgnoreKey)
  var ignored = ignoredPair[0];
  var setIgnored = ignoredPair[1];
  var triedPair = React.useState(false);
  var tried = triedPair[0];
  var setTried = triedPair[1];
  var assignPair = React.useState(null);
  var assignable = assignPair[0];
  var setAssignable = assignPair[1];
  var inputRef = React.useRef(null);

  var today = TK_qaToday();
  var parsed =
    typeof TK_parseQuickAdd === "function"
      ? TK_parseQuickAdd(input, {
          today: today,
          staff: staff.filter(function (s) { return s && s.active !== false; }),
          clients: base.project_id ? [] : clients,
          defaultClientId: base.client_id,
          me: me,
          ignore: ignored,
        })
      : { text: input.trim(), client_id: base.client_id, assignee_email: null, due_date: null, priority: null, tokens: [], suggestions: [], errors: input.trim() ? [] : ["Add a few words about the task."] };

  var has = function (k) { return Object.prototype.hasOwnProperty.call(touched, k); };
  var projectId = base.project_id || null;
  var clientId = projectId ? null : has("client_id") ? touched.client_id : parsed.client_id || null;
  var dueDate = has("due_date") ? touched.due_date : parsed.due_date || base.due_date || null;
  var assignee = TK_dwLower(has("assignee_email") ? touched.assignee_email : parsed.assignee_email || base.assignee_email || me);
  var priority = parsed.priority || "normal";
  var container = !!(clientId || projectId);
  var visibility = !container ? "private" : has("visibility") ? touched.visibility : base.visibility === "private" ? "private" : "shared";
  var kind = base.kind === "reminder" ? "reminder" : "task";
  var project = projectId && Array.isArray(projects) ? projects.filter(function (x) { return x && x.id === projectId; })[0] : null;
  var client = clientId ? clients.filter(function (c) { return c && String(c.id) === String(clientId); })[0] : null;
  var useLegacy = schema !== "ok" && typeof staffItemsApi !== "undefined" && staffItemsApi && typeof staffItemsApi.add === "function";

  React.useEffect(function () {
    if (inputRef.current) {
      inputRef.current.focus();
      var n = inputRef.current.value.length;
      try { inputRef.current.setSelectionRange(n, n); } catch (e) {}
    }
  }, []);

  // People who can be assigned here (with whether they can see the client).
  React.useEffect(function () {
    setAssignable(null);
    if (!clientId && !projectId) return undefined;
    var api = TK_dwApi();
    if (!api || typeof api.assignable !== "function" || schema !== "ok") return undefined;
    var live = true;
    api.assignable({ clientId: clientId, projectId: projectId }).then(
      function (rows) { if (live) setAssignable(rows || []); },
      function () { if (live) setAssignable(null); },
    );
    return function () { live = false; };
  }, [clientId, projectId, schema]);

  var people = assignable
    ? assignable.slice()
    : staff
        .filter(function (s) { return s && s.email && s.active !== false; })
        .map(function (s) { return { email: s.email, name: s.name, can_see: true }; });
  if (assignee && !people.some(function (a) { return TK_dwLower(a.email) === assignee; })) {
    people.unshift({ email: assignee, name: nameOf(assignee), can_see: assignable ? false : true });
  }
  var assigneeRow = people.filter(function (a) { return TK_dwLower(a.email) === assignee; })[0];
  var noAccess = !!(clientId && assigneeRow && assigneeRow.can_see === false);

  var titleError = !String(parsed.text || "").trim();
  var parseNotes = (parsed.errors || []).filter(function (m) { return m !== "Add a few words about the task."; });

  var submit = function (openAfter) {
    setTried(true);
    if (busy) return;
    if (titleError) {
      if (inputRef.current) inputRef.current.focus();
      return;
    }
    if (!online) {
      setErr(TK_dwCopy("offline", "You're offline."));
      return;
    }
    setBusy(true);
    setErr("");
    var text = String(parsed.text).trim();
    var done = function (task) {
      setBusy(false);
      TK_dwTrack("tasks-quick-add", { client: !!clientId, project: !!projectId, open: !!openAfter });
      if ((parsed.tokens || []).some(function (x) { return x && x.plain === true; })) TK_dwTrack("tasks-quick-add-plain");
      if (openAfter && task && task.id && !useLegacy) {
        p.onClose();
        TK_openTask(task.id, { from: "quick-add" });
      } else {
        TK_dwToast(TK_dwCopy("taskAdded", "Task added."));
        p.onClose();
      }
    };
    var fail = function (e) {
      setBusy(false);
      if (e && e.code === "tk_offline") setErr(TK_dwCopy("offline", "You're offline."));
      else {
        setErr("Couldn't add the task. Try again.");
        if (typeof console !== "undefined") console.error("[TK]", e);
      }
    };
    if (useLegacy) {
      var dueAt = null;
      if (dueDate && typeof buildStaffDueAt === "function") {
        try { dueAt = buildStaffDueAt(dueDate, null); } catch (e) {}
      }
      Promise.resolve()
        .then(function () {
          return staffItemsApi.add(window.mgbSupabase, me, {
            text: text,
            due_date: dueDate,
            due_at: dueAt,
            client_id: clientId,
            priority: priority,
            assignee_email: assignee || me,
            visibility: visibility,
            kind: kind,
          });
        })
        .then(function (res) {
          if (res && res.error) throw res.error;
          done(res && res.data ? res.data : null);
        })
        .catch(fail);
      return;
    }
    var api = TK_dwApi();
    if (!api) {
      fail(null);
      return;
    }
    api
      .create({
        text: text,
        client_id: clientId,
        project_id: projectId,
        section: base.section || null,
        due_date: dueDate,
        priority: priority,
        assignee_email: assignee || me,
        visibility: visibility,
        kind: kind,
      })
      .then(done, fail);
  };

  var setField = function (k, v) {
    var next = Object.assign({}, touched);
    next[k] = v;
    setTouched(next);
  };

  // Turn a part of the line off: its words stay in the title and are not
  // picked up again while they are typed.
  var removeToken = function (tok) {
    setIgnored(ignored.concat(TK_qaIgnoreKey(tok.kind, tok.raw)));
    setTimeout(function () { if (inputRef.current) inputRef.current.focus(); }, 0);
  };

  // "Did you mean": pick one. The words leave the title and the field is set.
  var pickSuggestion = function (opt) {
    setInput(TK_qaCut(input, opt.start, opt.end));
    setField(opt.kind === "person" ? "assignee_email" : "client_id", opt.value);
    setTimeout(function () { if (inputRef.current) inputRef.current.focus(); }, 0);
  };
  var skipSuggestion = function (sg) {
    setIgnored(ignored.concat(sg.options.map(function (o) { return TK_qaIgnoreKey(o.kind, o.raw); })));
    setTimeout(function () { if (inputRef.current) inputRef.current.focus(); }, 0);
  };
  var optionText = function (opt) {
    return (opt.kind === "person" ? "Assign to " : "Client: ") + opt.label;
  };

  var tokenText = function (tok) {
    if (tok.kind === "person") return nameOf(tok.value);
    if (tok.kind === "client") {
      var c = clients.filter(function (x) { return x && String(x.id) === String(tok.value); })[0];
      return c ? c.name : "Client";
    }
    if (tok.kind === "priority") {
      return typeof TK_PRIORITY_LABELS !== "undefined" && TK_PRIORITY_LABELS && TK_PRIORITY_LABELS[tok.value] ? TK_PRIORITY_LABELS[tok.value] : tok.value;
    }
    if (tok.kind === "date") return TK_dlShortDate(tok.value, today);
    return tok.raw;
  };

  var heading = kind === "reminder" ? "Add a reminder" : "Add a task";
  // Test clients and MGB (internal) sort last with a tag; test clients hide unless "Show test clients" is on.
  var pickedClients = typeof CF_usePicked === "function" ? CF_usePicked(clients, null, clientId ? String(clientId) : null) : clients;
  var sortedClients = pickedClients
    .filter(function (c) { return c && c.id != null; })
    .slice()
    .sort(function (a, b) { return String(a.name || "").localeCompare(String(b.name || "")); });
  if (typeof CF_sort === "function") sortedClients = CF_sort(sortedClients);

  if (typeof ModalShell !== "function") return null;
  return TK_dwPortal(
    <ModalShell onClose={p.onClose} labelledBy="tk-qa-title" className="tk-qa">
      <div className="modal-header">
        <h3 className="card-title" id="tk-qa-title" style={{ margin: 0 }}>
          {heading}
        </h3>
        <button type="button" className="modal-close" onClick={p.onClose} aria-label="Close">
          ×
        </button>
      </div>
      <div className="modal-body tk-qa-body">
        <label className="tk-dw-label" htmlFor="tk-qa-input">
          What needs doing?
        </label>
        <input
          id="tk-qa-input"
          ref={inputRef}
          type="text"
          className="tk-dw-input tk-qa-input"
          maxLength={500}
          autoComplete="off"
          placeholder="Send the March statements for Sierra by Friday"
          aria-describedby="tk-qa-help"
          aria-invalid={tried && titleError ? "true" : "false"}
          value={input}
          disabled={busy}
          onChange={function (e) {
            setInput(e.target.value);
            if (err) setErr("");
          }}
          onKeyDown={function (e) {
            if (e.key === "Enter" && !e.isComposing) {
              e.preventDefault();
              submit(e.shiftKey);
            }
          }}
        />
        <p className="tk-dw-hint" id="tk-qa-help">
          Type it the way you'd say it: for a name, re a client, by Friday, the 15th. Or use @ for a person, # for a client, ! for priority.
        </p>
        {parsed.tokens && parsed.tokens.length > 0 && (
          <ul className="tk-qa-tokens" aria-label="Picked up from what you typed">
            {parsed.tokens.map(function (tok) {
              return (
                <li key={tok.kind + tok.start} className={"tk-qa-token is-" + tok.kind}>
                  <span className="tk-qa-token-kind">{TK_QA_TOKEN_LABELS[tok.kind] || tok.kind}</span>
                  <span className="tk-qa-token-value">{tokenText(tok)}</span>
                  <button
                    type="button"
                    className="tk-qa-token-x"
                    aria-label={"Not " + (TK_QA_TOKEN_LABELS[tok.kind] || tok.kind).toLowerCase() + " " + tokenText(tok) + ": keep the words in the title"}
                    title="Don't use this. Keep the words in the title."
                    onClick={function () { removeToken(tok); }}
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {parsed.suggestions && parsed.suggestions.length > 0 &&
          parsed.suggestions.map(function (sg) {
            return (
              <div key={"sg" + sg.start} className="tk-qa-suggest" role="group" aria-label="Did you mean">
                <span className="tk-qa-suggest-q">Did you mean</span>
                {sg.options.map(function (opt) {
                  return (
                    <button
                      key={opt.kind + ":" + opt.value}
                      type="button"
                      className="tk-qa-suggest-opt"
                      onClick={function () { pickSuggestion(opt); }}
                    >
                      {optionText(opt)}
                    </button>
                  );
                })}
                <button type="button" className="tk-qa-suggest-skip" onClick={function () { skipSuggestion(sg); }}>
                  Neither
                </button>
              </div>
            );
          })}
        {!titleError && ((parsed.tokens && parsed.tokens.length > 0) || (parsed.suggestions && parsed.suggestions.length > 0)) && (
          <p className="tk-qa-preview" aria-live="polite">
            {TK_qaWillAdd({
              title: String(parsed.text).trim(),
              assigneeName: assignee && assignee !== me ? nameOf(assignee) : "",
              clientName: client ? client.name : "",
              dueLabel: dueDate ? TK_dlShortDate(dueDate, today) : "",
              priority: priority,
              priorityLabel: typeof TK_PRIORITY_LABELS !== "undefined" && TK_PRIORITY_LABELS ? TK_PRIORITY_LABELS[priority] : priority,
            })}
          </p>
        )}
        {tried && titleError && (
          <p className="tk-dw-warn" role="alert">
            Add a few words about the task.
          </p>
        )}
        {parseNotes.map(function (m) {
          return (
            <p key={m} className="tk-dw-hint tk-qa-note">
              {m}
            </p>
          );
        })}

        <div className="tk-qa-fields">
          {!projectId && (
            <div className="tk-qa-field">
              <label className="tk-dw-label" htmlFor="tk-qa-client">
                Client
              </label>
              <select
                id="tk-qa-client"
                className="tk-dw-select"
                value={clientId ? String(clientId) : ""}
                disabled={busy}
                onChange={function (e) { setField("client_id", e.target.value || null); }}
              >
                <option value="">No client</option>
                {clientId && !client && <option value={String(clientId)}>Client</option>}
                {sortedClients.map(function (c) {
                  return (
                    <option key={c.id} value={String(c.id)}>
                      {typeof CF_label === "function" ? CF_label(c) : c.name}
                    </option>
                  );
                })}
              </select>
            </div>
          )}
          <div className="tk-qa-field">
            <label className="tk-dw-label" htmlFor="tk-qa-due">
              Due
            </label>
            <input
              id="tk-qa-due"
              type="date"
              className="tk-dw-input"
              value={dueDate || ""}
              disabled={busy}
              onChange={function (e) { setField("due_date", e.target.value || null); }}
            />
          </div>
          <div className="tk-qa-field">
            <label className="tk-dw-label" htmlFor="tk-qa-assignee">
              Assignee
            </label>
            <select
              id="tk-qa-assignee"
              className="tk-dw-select"
              value={assignee}
              disabled={busy}
              onChange={function (e) { setField("assignee_email", e.target.value); }}
            >
              {people.map(function (a) {
                var em = TK_dwLower(a.email);
                return (
                  <option key={em} value={em}>
                    {(em === me ? "Me" : a.name || nameOf(em)) + (a.can_see === false ? " (no access)" : "")}
                  </option>
                );
              })}
            </select>
          </div>
        </div>
        {noAccess && (
          <p className="tk-dw-warn" role="note">
            {TK_dwCopy("noClientAccess", "They can't see this client yet, so they won't see this task.")}
          </p>
        )}

        {(container || base.section) && (
          <div className="tk-qa-context">
            {projectId && (
              <span className="tk-dw-chip">
                <span className="tk-dw-chip-role">Project</span>
                <span className="tk-dw-chip-name">{project ? project.name : "This project"}</span>
              </span>
            )}
            {base.section && (
              <span className="tk-dw-chip">
                <span className="tk-dw-chip-role">Section</span>
                <span className="tk-dw-chip-name">{base.section}</span>
              </span>
            )}
            {container && (
              <label className="tk-dw-check">
                <input
                  type="checkbox"
                  checked={visibility === "shared"}
                  disabled={busy}
                  onChange={function (e) { setField("visibility", e.target.checked ? "shared" : "private"); }}
                />
                <span>{projectId ? "Share with project members" : "Share with the client's team"}</span>
              </label>
            )}
          </div>
        )}

        {!online && (
          <p className="tk-dw-banner" role="status">
            {TK_dwCopy("offline", "You're offline.")}
          </p>
        )}
        {err && (
          <p className="tk-dw-warn" role="alert">
            {err}
          </p>
        )}
      </div>
      <div className="modal-footer tk-qa-foot">
        <button type="button" className="btn-secondary" onClick={p.onClose} disabled={busy}>
          Cancel
        </button>
        {!useLegacy && (
          <button type="button" className="btn-secondary" onClick={function () { submit(true); }} disabled={busy || !online}>
            Add and open
          </button>
        )}
        <button type="button" className="btn-primary" onClick={function () { submit(false); }} disabled={busy || !online}>
          {busy ? "Adding…" : "Add"}
        </button>
      </div>
    </ModalShell>,
  );
}

function TK_QuickAddHost(props) {
  var p = props || {};
  var pair = React.useState(null); // defaults for an open dialog
  var openWith = pair[0];
  var setOpenWith = pair[1];
  var seq = React.useRef(0);
  var lastRef = React.useRef(0);
  var propsRef = React.useRef(p);
  propsRef.current = p;
  var openRef = React.useRef(false);
  openRef.current = !!openWith;

  React.useEffect(function () {
    try { window.TK_quickAddReady = true; } catch (e) {}
    // The TopBar "+" keeps this in state, so it shows even when it rendered first.
    try { window.dispatchEvent(new CustomEvent("tk:quick-add-ready", { detail: { ready: true } })); } catch (e) {}
    var open = function (detail) {
      if (openRef.current) return;
      var cur = propsRef.current;
      var me = cur.staffUser && cur.staffUser.email;
      seq.current += 1;
      setOpenWith({ key: seq.current, defaults: TK_quickAddDefaults(detail || {}, { me: me, currentClientId: cur.currentClientId }) });
    };
    var onQuick = function (e) {
      lastRef.current = Date.now();
      open((e && e.detail) || {});
    };
    var onTop = function (e) {
      var d = (e && e.detail) || {};
      if (d.kind && d.kind !== "task") return;
      lastRef.current = Date.now();
      open({});
    };
    var onKey = function (e) {
      if (e.key !== "q") return;
      var st = TK_dwState();
      if (!st || st.schema !== "ok") return;
      var ctx = {
        // Any dialog counts, including the inbox and widget drawers
        // (aria-modal), so q never opens quick add over them.
        modalOpen: !!document.querySelector(".modal-overlay, .si-drawer, [aria-modal='true']"),
        menuOpen: TK_dwMenuOpen(document),
        tourOpen: !!document.querySelector(".tour-root"),
        scope: "global",
      };
      if (typeof TK_shouldHandleKey === "function") {
        if (!TK_shouldHandleKey(e, ctx)) return;
      } else if (e.ctrlKey || e.metaKey || e.altKey || ctx.modalOpen || ctx.menuOpen || ctx.tourOpen || TK_dwIsTyping(e.target)) {
        return;
      }
      var at = Date.now();
      // A view that handles q itself (with its own client or project) wins.
      setTimeout(function () {
        if (e.defaultPrevented) return;
        if (lastRef.current > at - 50) return;
        if (openRef.current) return;
        TK_dwTrackShortcut("q");
        open({});
      }, 0);
    };
    window.addEventListener("tk:quick-add", onQuick);
    window.addEventListener("tb:quick-add", onTop);
    window.addEventListener("keydown", onKey);
    return function () {
      try { window.TK_quickAddReady = false; } catch (e) {}
      try { window.dispatchEvent(new CustomEvent("tk:quick-add-ready", { detail: { ready: false } })); } catch (e) {}
      window.removeEventListener("tk:quick-add", onQuick);
      window.removeEventListener("tb:quick-add", onTop);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  if (!openWith) return null;
  return (
    <TK_QuickAddDialog
      key={openWith.key}
      defaults={openWith.defaults}
      staffUser={p.staffUser}
      clients={p.clients}
      onClose={function () { setOpenWith(null); }}
    />
  );
}
