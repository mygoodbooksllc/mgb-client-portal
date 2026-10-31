// ----------------------------------------------------------------------------
// TK_ReviewQueue.jsx — the review queue at #/tasks/review (Tasks Phase 2, S3).
//
// TK_ReviewQueue({ staffUser, clients, isAdmin })
//   Admins: every task in Ready for review, grouped by TK_reviewQueueGroups
//   ("Waiting on you", "Any admin", "Other reviewers", "Your work in review"),
//   oldest first, plus a 30-day on-time and review card.
//   Everyone else: only their own work in review (they can take it back).
//   Rows are TK_TaskRow; the status pill offers Approve / Send back to the
//   reviewer (TK_nextStatuses), and opening a row shows the drawer's review
//   strip. The server decides who may approve (tk_approve); this view only
//   hides what would be refused.
// ----------------------------------------------------------------------------

var TK_RQ_GROUPS = [
  { key: "mine", label: "Waiting on you" },
  { key: "anyone", label: "Any admin" },
  { key: "others", label: "Other reviewers" },
  { key: "own", label: "Your work in review" },
];

function TK_rqAddDays(ymd, n) {
  var p = String(ymd || "").split("-");
  var d = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]) + n));
  var z = function (v) {
    return v < 10 ? "0" + v : String(v);
  };
  return d.getUTCFullYear() + "-" + z(d.getUTCMonth() + 1) + "-" + z(d.getUTCDate());
}

function TK_rqNote(task, nameOf) {
  var bits = [];
  var wait = typeof TK_reviewWaitLabel === "function" ? TK_reviewWaitLabel(task) : "";
  if (wait) bits.push(wait);
  var n = Number(task && task.send_back_count) || 0;
  if (n) bits.push(n === 1 ? "Sent back once" : "Sent back " + n + " times");
  bits.push(task && task.reviewer_email ? "Reviewer: " + nameOf(task.reviewer_email) : "Reviewer: any admin");
  return bits.join(" · ");
}

// Last 30 days of on-time and review numbers, one line per person (admins).
function TK_rqStats(props) {
  var nameOf = props.nameOf;
  var today = props.today;
  var sPair = React.useState(null);
  var data = sPair[0];
  var setData = sPair[1];
  React.useEffect(
    function () {
      if (typeof TK_api === "undefined" || !TK_api || typeof TK_api.onTimeStats !== "function" || typeof TK_api.reviewStats !== "function") {
        setData({ error: true });
        return undefined;
      }
      var live = true;
      var from = TK_rqAddDays(today, -29);
      Promise.all([TK_api.onTimeStats(from, today, null), TK_api.reviewStats(from, today, null)]).then(
        function (res) {
          if (!live) return;
          var by = {};
          var row = function (email) {
            var k = String(email || "").toLowerCase();
            if (!by[k]) by[k] = { email: k, eligible: 0, on_time: 0, approved: 0, first_pass: 0, sent_back: 0, open_in_review: 0 };
            return by[k];
          };
          (res[0] || []).forEach(function (r) {
            var x = row(r.staff_email);
            x.eligible += Number(r.eligible) || 0;
            x.on_time += Number(r.on_time) || 0;
          });
          (res[1] || []).forEach(function (r) {
            var x = row(r.staff_email);
            x.approved += Number(r.approved) || 0;
            x.first_pass += Number(r.first_pass) || 0;
            x.sent_back += Number(r.sent_back) || 0;
            x.open_in_review += Number(r.open_in_review) || 0;
          });
          var rows = Object.keys(by)
            .map(function (k) {
              return by[k];
            })
            .filter(function (r) {
              return r.email && (r.eligible || r.approved || r.sent_back || r.open_in_review);
            })
            .sort(function (a, b) {
              var x = nameOf(a.email).toLowerCase();
              var y = nameOf(b.email).toLowerCase();
              return x < y ? -1 : x > y ? 1 : 0;
            });
          setData({ rows: rows });
        },
        function () {
          if (live) setData({ error: true });
        },
      );
      return function () {
        live = false;
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [today],
  );

  var body;
  if (!data) body = <p className="tk-muted">Loading…</p>;
  else if (data.error) body = <p className="tk-muted">These numbers didn't load. Try again later.</p>;
  else if (!data.rows.length) body = <p className="tk-muted">No finished or reviewed tasks in the last 30 days.</p>;
  else {
    body = (
      <div className="tk-rq-table-wrap mgb-sticky-wrap">
        <table className="tk-rq-table">
          <thead>
            <tr>
              <th scope="col">Person</th>
              <th scope="col">On time</th>
              <th scope="col">Approved</th>
              <th scope="col">First pass</th>
              <th scope="col">Sent back</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map(function (r) {
              return (
                <tr key={r.email}>
                  <th scope="row">{nameOf(r.email)}</th>
                  <td>{r.eligible ? Math.round((r.on_time / r.eligible) * 100) + "% (" + r.on_time + " of " + r.eligible + ")" : "—"}</td>
                  <td>{r.approved}</td>
                  <td>{r.first_pass}</td>
                  <td>{r.sent_back}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <section className="tk-rq-stats" aria-labelledby="tk-rq-stats-title" data-tour="tk-review-stats">
      <h3 className="tk-group-head tk-rq-stats-title" id="tk-rq-stats-title">
        Last 30 days
      </h3>
      <p className="tk-field-help">On time means finished (or approved, when it needs review) by the end of its due date. Time spent waiting on the client before then is added.</p>
      {body}
    </section>
  );
}

function TK_ReviewQueue(props) {
  var schema = TK_vUseSchema();
  if (schema === "missing") return <TK_SetupCard />;
  if (schema !== "ok") {
    return (
      <div className="tk-view tk-review">
        <h2 className="tk-view-title">Review</h2>
        <TK_vSkeletonRows count={4} />
      </div>
    );
  }
  return <TK_vReviewBody {...props} />;
}

function TK_vReviewBody(props) {
  var staffUser = props.staffUser || {};
  var me = TK_vLower(staffUser.email);
  var isAdmin = !!props.isAdmin;
  var today = TK_vToday();
  var online = TK_vUseOnline();
  var staff = TK_vUseStaff(isAdmin);

  var loader = function () {
    if (typeof TK_api === "undefined" || !TK_api || typeof TK_api.listReview !== "function") return Promise.resolve([]);
    return TK_api.listReview();
  };
  var list = TK_vUseList("review", loader);
  var projects = TK_vUseProjects();
  var clientNames = React.useMemo(
    function () {
      return TK_vNameMap(props.clients, "id", "name");
    },
    [props.clients],
  );
  var projectNames = React.useMemo(
    function () {
      return TK_vNameMap(projects, "id", "name");
    },
    [projects],
  );
  var staffNames = React.useMemo(
    function () {
      var m = {};
      (Array.isArray(staff) ? staff : []).forEach(function (s) {
        if (s && s.email) m[String(s.email).toLowerCase()] = s.name || s.email;
      });
      if (me && staffUser.name && !m[me]) m[me] = staffUser.name;
      return m;
    },
    [staff, me, staffUser.name],
  );
  var nameOf = function (email) {
    var k = String(email || "").toLowerCase();
    if (!k) return "";
    if (k === me) return "You";
    return staffNames[k] || k.split("@")[0];
  };

  var all = Array.isArray(list.tasks) ? list.tasks : [];
  var groups = typeof TK_reviewQueueGroups === "function" ? TK_reviewQueueGroups(all, me) : { mine: [], anyone: [], others: [], own: [] };
  var shown = TK_RQ_GROUPS.filter(function (g) {
    return isAdmin || g.key === "own";
  }).filter(function (g) {
    return groups[g.key] && groups[g.key].length;
  });

  var loading = !!list.loading && !all.length;
  var err = list.error && !all.length ? list.error : null;
  if (err && (err === "tk_schema_missing" || err.code === "tk_schema_missing")) return <TK_SetupCard />;

  var body;
  if (loading) body = <TK_vSkeletonRows count={4} />;
  else if (err) body = <TK_vErrorState onRetry={list.reload} />;
  else if (!shown.length) {
    body = (
      <div className="tk-empty">
        <p>{TK_vCopy("reviewEmpty", "Nothing is waiting for review.")}</p>
      </div>
    );
  } else {
    body = (
      <div className="tk-groups" data-tour="tk-review-groups">
        {shown.map(function (g) {
          var gid = "tk-rq-" + g.key;
          var rows = groups[g.key];
          return (
            <section key={g.key} className={"tk-group tk-rq-group tk-rq-" + g.key} aria-labelledby={gid}>
              <h3 className="tk-group-head" id={gid}>
                <span className="tk-group-name">{g.label}</span>
                <span className="tk-count">{rows.length}</span>
              </h3>
              <ul className="tk-rows" role="grid" aria-label={g.label}>
                {rows.map(function (t) {
                  // S8b: the assignee; an unassigned task in review shows who submitted it (never the row owner)
                  var who = t.assignee_email || t.submitted_by;
                  return (
                    <TK_TaskRow
                      key={t.id}
                      task={t}
                      today={today}
                      clientName={t.client_id != null ? clientNames[String(t.client_id)] || "" : ""}
                      projectName={t.project_id ? projectNames[t.project_id] || "" : ""}
                      projectColor={t.project_id ? TK_projectColorById(projects, t.project_id) : ""}
                      showClient={true}
                      showAssignee={g.key !== "own"}
                      assigneeName={who ? nameOf(who) : ""}
                      note={TK_rqNote(t, nameOf)}
                      me={me}
                      isAdmin={isAdmin}
                      canEdit={online}
                      editFields={false}
                      onOpen={function (id) {
                        TK_vOpenTask(id, { from: "list" });
                      }}
                      onStatus={function (task, s, note) {
                        TK_vSetStatus(task, s, note, isAdmin);
                      }}
                    />
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
    <div className="tk-view tk-review">
      <div className="tk-view-head">
        <h2 className="tk-view-title">Review</h2>
        <p className="tk-muted tk-view-sub">
          {isAdmin
            ? "Work sent for review. Open a task to approve it or send it back with a note."
            : "Your work waiting for an admin to approve it. Open a task to take it back."}
        </p>
      </div>
      {!online ? <TK_vOfflineBanner /> : null}
      {body}
      {isAdmin ? <TK_rqStats nameOf={nameOf} today={today} /> : null}
    </div>
  );
}
