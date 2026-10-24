// Month rhythm E2: "Draft email" for the three rhythm tasks (check-in,
// reports, mid-month follow-up). Builds the draft from the client's month
// (TK_api.emailDraftData + TK_emailDraftBuild) and lets the bookkeeper edit
// and copy it. Nothing is ever sent from here: no send button, no email call.
// Shown only with the rhythm preview on (TK_rhythmEnabled) and only for a task
// whose template has an email_kind.

// Which email a task drafts: null until its template is known (or none).
function TK_useEmailKind(task) {
  var on = typeof TK_rhythmEnabled === "function" && TK_rhythmEnabled();
  var tplId = task && task.template_id ? task.template_id : null;
  var period = typeof TK_emailPeriodOf === "function" ? TK_emailPeriodOf(task) : null;
  var ok = on && !!tplId && !!period && !!(task && task.client_id);
  var st = React.useState(null);
  var setKind = st[1];
  React.useEffect(function () {
    setKind(null);
    if (!ok || typeof TK_api === "undefined" || typeof TK_api.templateRef !== "function") return undefined;
    var live = true;
    TK_api.templateRef(tplId).then(function (row) {
      if (live) setKind(typeof TK_emailKindOf === "function" ? TK_emailKindOf(row) : null);
    }, function () {});
    return function () { live = false; };
  }, [ok, tplId]);
  return ok ? st[0] : null;
}

// Template id -> email_kind while the rhythm is on, else null (the Emails due chip).
function TK_useEmailTemplates() {
  var on = typeof TK_rhythmEnabled === "function" && TK_rhythmEnabled();
  var st = React.useState(null);
  var set = st[1];
  React.useEffect(function () {
    if (!on || typeof TK_api === "undefined" || typeof TK_api.emailTemplates !== "function") {
      set(null);
      return undefined;
    }
    var live = true;
    TK_api.emailTemplates().then(function (m) { if (live) set(m || {}); }, function () {});
    return function () { live = false; };
  }, [on]);
  return on ? st[0] : null;
}

// Clipboard with a fallback for browsers that block navigator.clipboard.
function TK_emailCopy(text) {
  var s = String(text || "");
  function fallback() {
    try {
      var ta = document.createElement("textarea");
      ta.value = s;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "-1000px";
      document.body.appendChild(ta);
      ta.select();
      var done = document.execCommand("copy");
      document.body.removeChild(ta);
      return done ? Promise.resolve(true) : Promise.reject(new Error("copy failed"));
    } catch (e) {
      return Promise.reject(e);
    }
  }
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(s).then(function () { return true; }, fallback);
    }
  } catch (e) {}
  return fallback();
}

// Short-lived cache so the hover preview and the editor share one load.
var TK_emailDraftCache = {};
function TK_emailLoadDraft(task, kind) {
  var key = task.id + "|" + kind;
  var hit = TK_emailDraftCache[key];
  if (hit && Date.now() - hit.at < 60000) return hit.promise;
  var p = Promise.resolve(TK_api.emailDraftData(task, kind)).then(function (input) {
    if (!input) return null;
    var draft = TK_emailDraftBuild(input);
    return draft ? Object.assign({}, draft, { warnings: input.warnings || [] }) : null;
  });
  p.catch(function () { delete TK_emailDraftCache[key]; });
  TK_emailDraftCache[key] = { at: Date.now(), promise: p };
  return p;
}

function TK_EmailDraftModal(props) {
  var task = props.task;
  var kind = props.kind;
  var loadPair = React.useState("loading");
  var load = loadPair[0];
  var setLoad = loadPair[1];
  var draftPair = React.useState(null);
  var draft = draftPair[0];
  var setDraft = draftPair[1];
  var subjPair = React.useState("");
  var subject = subjPair[0];
  var setSubject = subjPair[1];
  var bodyPair = React.useState("");
  var body = bodyPair[0];
  var setBody = bodyPair[1];
  var copiedPair = React.useState("");
  var copied = copiedPair[0];
  var setCopied = copiedPair[1];

  function start(fresh) {
    setLoad("loading");
    if (fresh) delete TK_emailDraftCache[task.id + "|" + kind];
    TK_emailLoadDraft(task, kind).then(function (d) {
      if (!d) {
        setLoad("empty");
        return;
      }
      setDraft(d);
      setSubject(d.subject);
      setBody(d.body);
      setLoad("ok");
    }, function () { setLoad("error"); });
  }
  React.useEffect(function () { start(false); }, [task.id, kind]);

  function copy(what, text) {
    TK_emailCopy(text).then(function () {
      setCopied(what);
      setTimeout(function () { setCopied(""); }, 2000);
    }, function () { setCopied("fail"); });
  }

  if (typeof ModalShell !== "function") return null;
  var title = TK_emailKindLabel(kind);
  var optionNote = draft && kind === "reports"
    ? (draft.option === "A" ? "Option A (full reports) picked from the month's report state."
      : draft.option === "B" ? "Option B (preliminary) picked from the month's report state."
      : "No report state yet, so both options are in the draft. Delete the one that does not fit.")
    : null;
  var node = (
    <ModalShell onClose={props.onClose} labelledBy="tk-email-draft-title" className="tk-dw-modal tk-email-draft">
      <div className="modal-header">
        <h3 className="card-title" id="tk-email-draft-title" style={{ margin: 0 }}>
          {"Draft: " + title}
        </h3>
        <button type="button" className="modal-close" onClick={props.onClose} aria-label="Close">
          ×
        </button>
      </div>
      <div className="modal-body tk-email-draft-body">
        <p className="tk-dw-hint">
          Nothing is sent from here. Check the draft, edit it, then copy it into your email.
        </p>
        {load === "loading" ? <p className="tk-dw-hint">Building the draft from this client's month…</p> : null}
        {load === "error" || load === "empty" ? (
          <p role="alert" className="tk-dw-hint tk-field-error">
            {load === "error" ? "Could not build the draft. Try again in a moment." : "This task has no client month to draft from."}
          </p>
        ) : null}
        {load === "ok" ? (
          <React.Fragment>
            {draft.cc ? <p className="tk-dw-hint">{"Suggested CC: " + draft.cc + " (account manager)"}</p> : null}
            {optionNote ? <p className="tk-dw-hint">{optionNote}</p> : null}
            {draft.warnings && draft.warnings.length ? (
              <p className="tk-dw-hint tk-email-draft-warn">
                {"Could not read: " + draft.warnings.join(", ") + ". Those parts may be empty; check before you send."}
              </p>
            ) : null}
            <label className="tk-dw-label" htmlFor="tk-email-draft-subject">Subject</label>
            <input
              id="tk-email-draft-subject"
              type="text"
              className="tk-dw-input tk-email-draft-subject"
              value={subject}
              onChange={function (e) { setSubject(e.target.value); }}
            />
            <label className="tk-dw-label" htmlFor="tk-email-draft-text">Email</label>
            <textarea
              id="tk-email-draft-text"
              className="tk-dw-input tk-email-draft-text"
              rows={18}
              value={body}
              onChange={function (e) { setBody(e.target.value); }}
            />
            <p className="tk-dw-hint" aria-live="polite">
              {copied === "subject" ? "Subject copied." : copied === "body" ? "Email copied." : copied === "fail" ? "Copy did not work. Select the text and copy it by hand." : ""}
            </p>
          </React.Fragment>
        ) : null}
      </div>
      <div className="modal-footer">
        <button type="button" className="btn-secondary" onClick={function () { start(true); }} disabled={load === "loading"}>
          Start over
        </button>
        <button type="button" className="btn-secondary" onClick={function () { copy("subject", subject); }} disabled={load !== "ok"}>
          Copy subject
        </button>
        <button type="button" className="btn-primary" onClick={function () { copy("body", body); }} disabled={load !== "ok"}>
          Copy email
        </button>
      </div>
    </ModalShell>
  );
  if (typeof ReactDOM !== "undefined" && ReactDOM.createPortal && typeof document !== "undefined") {
    return ReactDOM.createPortal(node, document.body);
  }
  return node;
}

// props: task, compact (row icon instead of a drawer button).
function TK_EmailDraftButton(props) {
  var task = props.task;
  var kind = TK_useEmailKind(task);
  var openPair = React.useState(false);
  var open = openPair[0];
  var setOpen = openPair[1];
  var peekPair = React.useState(null);
  var peek = peekPair[0];
  var setPeek = peekPair[1];
  var timer = React.useRef(null);
  // Each hover gets a token; a draft that arrives after the pointer left (or
  // after unmount) is dropped, so the preview never sticks open.
  var hoverTok = React.useRef(0);
  var peekId = React.useRef("tk-email-peek-" + Math.random().toString(36).slice(2, 9));
  React.useEffect(function () {
    return function () {
      hoverTok.current++;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
  if (!kind) return null;
  var label = TK_emailKindLabel(kind);

  // The row icon (one per row in long lists) never builds a draft on hover:
  // its title shows the kind. Only the drawer button previews the draft.
  function showPeek() {
    if (props.compact) return;
    if (timer.current) clearTimeout(timer.current);
    var tok = ++hoverTok.current;
    timer.current = setTimeout(function () {
      if (tok !== hoverTok.current) return;
      setPeek({ state: "loading" });
      TK_emailLoadDraft(task, kind).then(function (d) {
        if (tok !== hoverTok.current) return;
        setPeek(d ? { state: "ok", subject: d.subject, lines: d.body.split("\n").slice(0, 6) } : null);
      }, function () {
        if (tok === hoverTok.current) setPeek(null);
      });
    }, 450);
  }
  function hidePeek() {
    hoverTok.current++;
    if (timer.current) clearTimeout(timer.current);
    setPeek(null);
  }
  // The modal is portaled but is still a React child of the task row, whose
  // click, key and pointer handlers would otherwise get its events.
  function stop(e) {
    e.stopPropagation();
  }
  function onOpen(e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    hidePeek();
    setOpen(true);
  }

  return (
    <span className={"tk-email-draft-wrap" + (props.compact ? " tk-email-draft-compact" : "")}>
      <button
        type="button"
        className={props.compact ? "tk-rowmore tk-email-draft-icon" : "btn-secondary btn-sm tk-email-draft-btn"}
        onClick={onOpen}
        onMouseEnter={showPeek}
        onMouseLeave={hidePeek}
        onFocus={showPeek}
        onBlur={hidePeek}
        aria-label={"Draft email: " + label + " (nothing is sent)"}
        aria-describedby={peek ? peekId.current : undefined}
        title={props.compact ? "Draft email: " + label : undefined}
        data-tour="tk-email-draft"
      >
        {props.compact ? <span aria-hidden="true">{"✉"}</span> : "Draft email: " + label}
      </button>
      {peek ? (
        <span className="tk-email-draft-peek" role="tooltip" id={peekId.current}>
          {peek.state === "loading" ? (
            "Building the draft…"
          ) : (
            <React.Fragment>
              <strong>{peek.subject}</strong>
              {peek.lines.map(function (l, i) { return <span key={i} className="tk-email-draft-peek-line">{l || " "}</span>; })}
            </React.Fragment>
          )}
        </span>
      ) : null}
      {open ? (
        <span
          className="tk-email-draft-stop"
          onClick={stop}
          onDoubleClick={stop}
          onMouseDown={stop}
          onPointerDown={stop}
          onTouchStart={stop}
          onKeyDown={stop}
          onContextMenu={stop}
        >
          <TK_EmailDraftModal task={task} kind={kind} onClose={function () { setOpen(false); }} />
        </span>
      ) : null}
    </span>
  );
}
