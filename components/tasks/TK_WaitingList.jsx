// ----------------------------------------------------------------------------
// TK_WaitingList.jsx — Tasks › Waiting on client (#/tasks/waiting), S5.
//
// Every open Ask client request, grouped by client with the longest wait
// first (rpc tk_waiting_on_client; the server only returns clients you
// cover). Each row opens its task and offers Send reminder and Email again
// (both dry runs until S6) and Cancel. "Just mine" keeps the tasks you own.
// ----------------------------------------------------------------------------

function TK_WaitingList(props) {
  var staffUser = props.staffUser || {};
  var me = String(staffUser.email || "").toLowerCase();
  var isAdmin = !!props.isAdmin;
  var online = TK_vUseOnline();
  var staff = TK_vUseStaff(isAdmin);
  var rowsPair = React.useState(null);
  var rows = rowsPair[0];
  var setRows = rowsPair[1];
  var errPair = React.useState(null);
  var minePair = React.useState(!isAdmin);
  var cancelPair = React.useState(null);
  var seq = React.useRef(0);

  var load = React.useCallback(function () {
    if (typeof TK_api === "undefined" || !TK_api || typeof TK_api.waitingOnClient !== "function") return;
    var my = ++seq.current;
    TK_api.waitingOnClient(null).then(
      function (list) {
        if (my !== seq.current) return;
        errPair[1](null);
        setRows(Array.isArray(list) ? list : []);
      },
      function (e) {
        if (my !== seq.current) return;
        errPair[1]((e && e.code) || "error");
        setRows(function (r) { return r || []; });
      },
    );
  }, []);
  React.useEffect(function () {
    load();
    var on = function () { load(); };
    window.addEventListener("mgb:tk-requests-changed", on);
    window.addEventListener("tk:task-changed", on);
    return function () {
      window.removeEventListener("mgb:tk-requests-changed", on);
      window.removeEventListener("tk:task-changed", on);
    };
  }, [load]);

  var staffNames = React.useMemo(function () {
    var m = {};
    (Array.isArray(staff) ? staff : []).forEach(function (s) {
      if (s && s.email) m[String(s.email).toLowerCase()] = s.name || s.email;
    });
    return m;
  }, [staff]);
  var nameOf = function (email) {
    var k = String(email || "").toLowerCase();
    if (!k) return "Nobody";
    if (k === me) return "You";
    return staffNames[k] || k.split("@")[0];
  };

  var all = rows || [];
  var shown = minePair[0] ? all.filter(function (r) { return String(r.assignee_email || "").toLowerCase() === me; }) : all;
  var groups = TK_waitingGroups(shown);

  var send = function (r, action) {
    TK_api.sendClientRequest(r.request_id, action, r.task_id).then(
      function (res) { TK_vToast(TK_sendResultText(res, action)); load(); },
      function (e) { TK_vToast(TK_requestErrorText(e)); },
    );
  };

  var body;
  if (rows === null) body = <TK_vSkeletonRows count={4} />;
  else if (errPair[0] && !all.length) body = <TK_vErrorState onRetry={load} />;
  else if (!groups.length) {
    body = (
      <div className="tk-empty">
        <p>{minePair[0] && all.length ? "None of your tasks are waiting on a client." : "Nothing is waiting on a client."}</p>
      </div>
    );
  } else {
    body = (
      <div className="tk-groups" data-tour="tk-waiting-groups">
        {groups.map(function (g) {
          var gid = "tk-wt-" + g.clientId;
          return (
            <section key={g.clientId} className="tk-group tk-wt-group" aria-labelledby={gid}>
              <h3 className="tk-group-head" id={gid}>
                <span className="tk-group-name">{g.clientName}</span>
                <span className="tk-count">{g.rows.length}</span>
              </h3>
              <ul className="tk-wt-rows">
                {g.rows.map(function (r) {
                  var chip = TK_requestChip({ status: "open", no_reply: r.no_reply });
                  var acts = TK_requestActions({ status: "open", nudge_paused: r.nudge_paused, links: { live: 0 } }, { canEdit: online });
                  var meta = [TK_waitingLabel(r.business_days_waiting), "Owner: " + nameOf(r.assignee_email)];
                  if (r.nudge_count) meta.push(r.nudge_count + (r.nudge_count === 1 ? " reminder" : " reminders"));
                  if (r.nudge_paused) meta.push("Reminders paused");
                  return (
                    <li key={r.request_id} className="tk-wt-row">
                      <div className="tk-wt-main">
                        <span className={"tk-cr-chip tone-" + chip.tone}>{chip.label}</span>
                        <button type="button" className="link-btn tk-wt-open"
                          onClick={function () { TK_vOpenTask(r.task_id, { from: "list" }); }}>
                          {r.request_title}
                        </button>
                        <span className="tk-wt-task">{"on " + r.title}</span>
                      </div>
                      <p className="tk-cr-meta">{meta.join(" · ")}</p>
                      <div className="tk-cr-actions">
                        {acts.nudge && <button type="button" className="btn-secondary tk-dw-btn-sm" onClick={function () { send(r, "nudge"); }}>Send reminder</button>}
                        {acts.send && <button type="button" className="btn-secondary tk-dw-btn-sm" onClick={function () { send(r, "resend"); }}>Email again</button>}
                        {acts.cancel && <button type="button" className="link-btn tk-cr-cancel" onClick={function () { cancelPair[1](r); }}>Cancel</button>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    );
  }

  return (
    <div className="tk-view tk-waiting">
      <div className="tk-view-head" data-tour="tk-waiting-head">
        <h2 className="tk-view-title">Waiting on client</h2>
        <p className="tk-muted tk-view-sub">
          Everything you've asked a client for and they haven't answered yet, longest wait first. Reminders and emails are a dry run for now: nothing is sent.
        </p>
        <label className="tk-wt-mine">
          <input type="checkbox" checked={minePair[0]} onChange={function (e) { minePair[1](e.target.checked); }} />
          Just my tasks
        </label>
      </div>
      {!online ? <TK_vOfflineBanner /> : null}
      {body}
      {cancelPair[0] && typeof TK_crCancelModal === "function" && (
        <TK_crCancelModal onCancel={function () { cancelPair[1](null); }}
          onConfirm={function (reason) {
            var r = cancelPair[0];
            cancelPair[1](null);
            TK_api.cancelClientRequest(r.request_id, reason, r.task_id).then(
              function () { TK_vToast("Request cancelled."); load(); },
              function (e) { TK_vToast(TK_requestErrorText(e)); },
            );
          }} />
      )}
    </div>
  );
}
