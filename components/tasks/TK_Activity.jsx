// ----------------------------------------------------------------------------
// Tasks module, drawer slice: the Activity tab (spec C7, row 2.7).
//
//   TK_Activity({ taskId, nameOf, stamp })
//
// Rows from TK_api.listActivity (oldest first), one sentence each through
// TK_activityText. `stamp` (the task's updated_at) reloads after a change.
// Shares the "a:<id>" row cache with the All tab in TK_Comments.
// ----------------------------------------------------------------------------

function TK_Activity(props) {
  var p = props || {};
  var api = TK_dwApi();
  var nameOf = p.nameOf || function (email) { return TK_dlNameOf(email, []); };
  var act = TK_dwUseRows(
    "a",
    p.taskId || null,
    function () { return api ? api.listActivity(p.taskId) : []; },
    { stamp: p.stamp || "" },
  );
  var rows = (act.rows || []).filter(function (a) { return a && a.kind !== "comment"; });
  var today = TK_dwToday();
  var now = Date.now();

  if (act.loading && !rows.length) {
    return (
      <div className="tk-act" aria-busy="true">
        <div className="tk-dw-skel tk-dw-skel-row" />
        <div className="tk-dw-skel tk-dw-skel-row" />
        <div className="tk-dw-skel tk-dw-skel-short" />
      </div>
    );
  }
  if (act.error && !rows.length) {
    return (
      <p className="tk-dw-muted">
        Couldn't load the activity.{" "}
        <button type="button" className="link-btn" onClick={act.reload}>
          {TK_dwCopy("retry", "Try again")}
        </button>
      </p>
    );
  }
  if (!rows.length) return <p className="tk-dw-muted tk-cm-empty">No changes yet.</p>;

  return (
    <ul className="tk-act tk-cm-thread">
      {rows.map(function (a) {
        var exact = "";
        try {
          exact = a.created_at ? new Date(a.created_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "";
        } catch (e) {}
        return (
          <li key={a.id} className="tk-cm-activity">
            <span className="tk-cm-dot" aria-hidden="true" />
            <span className="tk-cm-activity-text">
              <span className="tk-cm-name">{nameOf(a.actor_email)}</span>{" "}
              {TK_activityText(a, { nameOf: nameOf, statusLabel: TK_dwStatusLabel, today: today })}
            </span>
            <time className="tk-cm-time" dateTime={a.created_at || undefined} title={exact}>
              {TK_dlRelTime(a.created_at, now)}
            </time>
          </li>
        );
      })}
    </ul>
  );
}
