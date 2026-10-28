// ----------------------------------------------------------------------------
// TK_ProjectUpdates: Slate plus project status updates + Portfolio (hidden
// preview, docs/slateplus-projupdates-spec.md). Pure rules live in
// TK_projectUpdatesLogic.js (TKPU_). Shared global scope: TKPU_ prefix.
//
//   TKPU_ProjectStatus  the Status block under a project's header (TK_List).
//   TKPU_Portfolio      #/tasks/portfolio, one table of every visible project.
//
// Both render nothing unless the Slate plus gate is on (TKP_useOn). The
// database decides who may post or hide (supabase/slateplus-project-updates.sql);
// canManage here only hides buttons. Posting writes one row: no emails, no
// notifications.
// ----------------------------------------------------------------------------

var TKPU_HIDE_CONFIRM = "Hide this update? It stays saved, but no one sees it in Slate.";

function TKPU_useOnFlag() {
  return typeof TKP_useOn === "function" ? TKP_useOn() : false;
}

function TKPU_Pill(props) {
  var st = props.status || TKPU_NONE;
  return (
    <span className={"pill tkpu-pill tkpu-" + st.key + " " + st.tone}>
      {st.key === "done" ? <span aria-hidden="true">{"✓ "}</span> : null}
      {st.label}
    </span>
  );
}

// Re-run load when this tab posts or hides an update (for one project, or any).
function TKPU_useChanged(load, projectId) {
  React.useEffect(
    function () {
      var on = function (e) {
        var pid = e && e.detail ? e.detail.projectId : null;
        if (!projectId || !pid || pid === projectId) load();
      };
      window.addEventListener(TKPU_EVENT, on);
      return function () {
        window.removeEventListener(TKPU_EVENT, on);
      };
    },
    [load, projectId],
  );
}

// ---- The Status block on a project page -------------------------------------
// props: { project, canManage (hint: manager and not archived), email, staff }

function TKPU_ProjectStatus(props) {
  var plusOn = TKPU_useOnFlag();
  var project = props.project;
  var pid = project && project.id;

  var rPair = React.useState(null);
  var rows = rPair[0];
  var setRows = rPair[1];
  var lePair = React.useState(null);
  var loadErr = lePair[0];
  var setLoadErr = lePair[1];
  var cPair = React.useState(false);
  var composing = cPair[0];
  var setComposing = cPair[1];
  var sPair = React.useState("");
  var dStatus = sPair[0];
  var setDStatus = sPair[1];
  var bPair = React.useState("");
  var dBody = bPair[0];
  var setDBody = bPair[1];
  var fePair = React.useState(null);
  var formErr = fePair[0];
  var setFormErr = fePair[1];
  var svPair = React.useState(false);
  var saving = svPair[0];
  var setSaving = svPair[1];
  var aPair = React.useState(false);
  var showAll = aPair[0];
  var setShowAll = aPair[1];
  var hPair = React.useState(null);
  var hideRow = hPair[0];
  var setHideRow = hPair[1];
  var seq = React.useRef(0);
  var formRef = React.useRef(null);
  var postBtnRef = React.useRef(null);
  var wasComposing = React.useRef(false);

  // Keyboard focus: into the composer when it opens (the chosen status, else
  // the first one), back to Post update when it closes.
  React.useEffect(
    function () {
      var was = wasComposing.current;
      wasComposing.current = composing;
      if (composing && !was) {
        var f = formRef.current;
        var el = f && (f.querySelector('.tkpu-choice[aria-pressed="true"]') || f.querySelector(".tkpu-choice"));
        if (el && el.focus) el.focus();
      } else if (!composing && was) {
        var raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : function (fn) { return setTimeout(fn, 0); };
        raf(function () {
          if (postBtnRef.current && postBtnRef.current.focus) postBtnRef.current.focus();
        });
      }
    },
    [composing],
  );

  var load = React.useCallback(
    function () {
      if (!plusOn || !pid || typeof TK_api === "undefined" || !TK_api || typeof TK_api.listProjectUpdates !== "function") return;
      var n = ++seq.current;
      TK_api.listProjectUpdates(pid).then(
        function (list) {
          if (n !== seq.current) return;
          setRows(Array.isArray(list) ? list : []);
          setLoadErr(null);
        },
        function (e) {
          if (n !== seq.current) return;
          setLoadErr(e || { code: "tk_error" });
        },
      );
    },
    [plusOn, pid],
  );
  React.useEffect(
    function () {
      setRows(null);
      setLoadErr(null);
      setComposing(false);
      setShowAll(false);
      load();
    },
    [load],
  );
  TKPU_useChanged(load, pid);

  if (!plusOn || !pid) return null;

  var nameOf = function (e) {
    return typeof TK_vStaffName === "function" ? TK_vStaffName(props.staff, e) : String(e || "").split("@")[0];
  };
  var timeline = TKPU_timeline(rows || []);
  var latest = timeline[0] || null;
  var earlier = timeline.slice(1);
  var canPost = !!props.canManage;
  // Hide matches the database: project owners and admins only.
  var canHide = function () {
    return !!props.canManage;
  };

  var openComposer = function () {
    setDStatus(latest ? latest.status : "");
    setDBody("");
    setFormErr(null);
    setComposing(true);
  };
  var submit = function (e) {
    if (e) e.preventDefault();
    if (saving) return;
    var chk = TKPU_checkDraft({ status: dStatus, body: dBody });
    if (!chk.ok) {
      setFormErr(chk);
      return;
    }
    setSaving(true);
    TK_api.postProjectUpdate(pid, dStatus, dBody).then(
      function (row) {
        setSaving(false);
        setComposing(false);
        setFormErr(null);
        if (row) setRows(function (cur) { return [row].concat(Array.isArray(cur) ? cur : []); });
        if (typeof TK_vToast === "function") TK_vToast("Status update posted.");
      },
      function (e2) {
        setSaving(false);
        var code = e2 && e2.code;
        setFormErr({
          ok: false,
          field: null,
          text: code === "tk_forbidden" ? "Only the project's owners and admins can post an update." : typeof TK_vErrText === "function" ? TK_vErrText(e2, "saveError") : "Couldn't post that. Try again.",
        });
      },
    );
  };
  var confirmHide = function () {
    var r = hideRow;
    setHideRow(null);
    if (!r) return;
    TK_api.hideProjectUpdate(r.id).then(
      function () {
        setRows(function (cur) {
          return (Array.isArray(cur) ? cur : []).filter(function (x) { return x.id !== r.id; });
        });
        if (typeof TK_vToast === "function") TK_vToast("Update hidden.");
      },
      function (e2) {
        if (typeof TK_vToast === "function") TK_vToast(e2 && e2.code === "tk_forbidden" ? "You can't hide that update." : TK_vErrText(e2, "saveError"));
      },
    );
  };

  var item = function (r, isLatest) {
    return (
      <li key={r.id} className={"tkpu-item" + (isLatest ? " is-latest" : "")}>
        <div className="tkpu-item-head">
          {isLatest ? null : <TKPU_Pill status={TKPU_status(r.status)} />}
          <span className="tkpu-by tk-muted">{TKPU_bylineText(r, nameOf)}</span>
          {canHide() ? (
            <button
              type="button"
              className="tkpu-hide tk-link-btn"
              aria-label={"Hide the update from " + TKPU_whenText(r.created_at)}
              onClick={function () {
                setHideRow(r);
              }}
            >
              Hide
            </button>
          ) : null}
        </div>
        <p className="tkpu-body">{r.body}</p>
      </li>
    );
  };

  var counter = TKPU_counterText(dBody);
  var composer = composing ? (
    <form className="tkpu-form" ref={formRef} onSubmit={submit} aria-label="Post a status update">
      <div className="tkpu-choices" role="group" aria-label="Status">
        {TKPU_STATUSES.map(function (s) {
          var on = dStatus === s.key;
          return (
            <button
              key={s.key}
              type="button"
              className={"tkpu-choice tkpu-" + s.key + (on ? " is-on" : "")}
              aria-pressed={on ? "true" : "false"}
              onClick={function () {
                setDStatus(s.key);
                if (formErr && formErr.field === "status") setFormErr(null);
              }}
            >
              {s.key === "done" ? "✓ " : ""}
              {s.label}
            </button>
          );
        })}
      </div>
      <label className="tk-sr" htmlFor={"tkpu-body-" + pid}>
        Where things stand
      </label>
      <textarea
        id={"tkpu-body-" + pid}
        className="tk-input tkpu-text"
        rows={3}
        placeholder="Where things stand, in a line or two"
        value={dBody}
        aria-invalid={formErr && formErr.field === "body" ? "true" : undefined}
        aria-describedby={"tkpu-count-" + pid}
        onChange={function (e) {
          setDBody(e.target.value);
          if (formErr && formErr.field === "body") setFormErr(null);
        }}
      />
      <p id={"tkpu-count-" + pid} className={"tkpu-count tk-muted" + (dBody.trim().length > TKPU_BODY_MAX ? " is-over" : "")} aria-live="polite">
        {counter || ""}
      </p>
      {formErr && formErr.text ? (
        <p className="tk-field-error" role="alert">
          {formErr.text}
        </p>
      ) : null}
      <p className="tkpu-note tk-muted">Posting doesn't email or notify anyone.</p>
      <div className="tkpu-form-actions">
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? "Posting…" : "Post"}
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={saving}
          onClick={function () {
            setComposing(false);
            setFormErr(null);
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  ) : null;

  var body;
  if (rows == null && !loadErr) {
    body = <p className="tk-muted tkpu-loading">Loading status{"…"}</p>;
  } else if (loadErr && rows == null) {
    body = (
      <p className="tk-muted tkpu-loading" role="alert">
        Couldn't load status updates.{" "}
        <button type="button" className="tk-link-btn" onClick={load}>
          Try again
        </button>
      </p>
    );
  } else {
    body = (
      <React.Fragment>
        {latest ? <ul className="tkpu-list">{item(latest, true)}</ul> : null}
        {earlier.length ? (
          <button
            type="button"
            className="tk-link-btn tkpu-more"
            aria-expanded={showAll ? "true" : "false"}
            onClick={function () {
              setShowAll(!showAll);
            }}
          >
            {showAll ? "Hide earlier updates" : "Show " + earlier.length + (earlier.length === 1 ? " earlier update" : " earlier updates")}
          </button>
        ) : null}
        {showAll && earlier.length ? (
          <ul className="tkpu-list tkpu-earlier">
            {earlier.map(function (r) {
              return item(r, false);
            })}
          </ul>
        ) : null}
      </React.Fragment>
    );
  }

  return (
    <section className="tkpu-status" aria-label="Project status" data-tour="tk-projstatus">
      <div className="tkpu-status-head">
        <TKPU_Pill status={latest ? TKPU_status(latest.status) : TKPU_NONE} />
        {canPost && !composing && rows != null ? (
          <button type="button" className="btn-secondary tkpu-post" ref={postBtnRef} onClick={openComposer}>
            Post update
          </button>
        ) : null}
      </div>
      {composer}
      {body}
      {hideRow ? (
        <TK_vConfirm
          title="Hide this update?"
          body={TKPU_HIDE_CONFIRM}
          confirmLabel="Hide"
          onCancel={function () {
            setHideRow(null);
          }}
          onConfirm={confirmHide}
        />
      ) : null}
    </section>
  );
}

// ---- The Portfolio page -------------------------------------------------------

var TKPU_COLUMNS = [
  { key: "name", label: "Project", sort: true },
  { key: "owner", label: "Owner", sort: false },
  { key: "status", label: "Status", sort: true },
  { key: "updated", label: "Last update", sort: true },
  { key: "due", label: "Due", sort: true },
];

function TKPU_Portfolio(props) {
  var plusOn = TKPU_useOnFlag();
  var projects = TK_vUseProjects();
  var staff = TK_vUseStaff(plusOn);
  var lPair = React.useState(null);
  var latestRows = lPair[0];
  var setLatestRows = lPair[1];
  var ePair = React.useState(null);
  var err = ePair[0];
  var setErr = ePair[1];
  var aPair = React.useState(false);
  var showArchived = aPair[0];
  var setShowArchived = aPair[1];
  var sPair = React.useState({ key: "status", dir: "asc" });
  var sort = sPair[0];
  var setSort = sPair[1];
  var seq = React.useRef(0);

  var load = React.useCallback(
    function () {
      if (!plusOn || typeof TK_api === "undefined" || !TK_api || typeof TK_api.projectUpdatesLatest !== "function") return;
      var n = ++seq.current;
      TK_api.projectUpdatesLatest().then(
        function (list) {
          if (n !== seq.current) return;
          setLatestRows(Array.isArray(list) ? list : []);
          setErr(null);
        },
        function (e) {
          if (n === seq.current) setErr(e || { code: "tk_error" });
        },
      );
    },
    [plusOn],
  );
  React.useEffect(load, [load]);
  TKPU_useChanged(load, null);

  if (!plusOn) return null;

  var head = (
    <div className="tk-view-head">
      <h2 className="tk-view-title">Portfolio</h2>
      <p className="tk-muted tk-view-sub">Every project you can see, with its latest status. Stale means no update in {TKPU_STALE_DAYS} days.</p>
    </div>
  );

  if (err && latestRows == null) {
    return (
      <div className="tk-view tkpu-portfolio">
        {head}
        <div className="tk-state" role="alert">
          <p>{typeof TK_vErrText === "function" ? TK_vErrText(err, "loadError") : "Couldn't load that."}</p>
          <button type="button" className="btn-secondary" onClick={load}>
            Try again
          </button>
        </div>
      </div>
    );
  }
  if (projects == null || latestRows == null) {
    return (
      <div className="tk-view tkpu-portfolio">
        {head}
        <TK_vSkeletonRows count={5} />
      </div>
    );
  }

  var now = Date.now();
  var rows = TKPU_portfolioRows(projects, TKPU_latestMap(latestRows), {
    showArchived: showArchived,
    nowMs: now,
    today: typeof TK_vToday === "function" ? TK_vToday() : "",
    nameOf: function (e) {
      return typeof TK_vStaffName === "function" ? TK_vStaffName(staff, e) : String(e || "").split("@")[0];
    },
  });
  var sorted = TKPU_sortRows(rows, sort.key, sort.dir);
  var archivedCount = (Array.isArray(projects) ? projects : []).filter(function (p) { return p && p.archived_at; }).length;

  var tagOf = function (p) {
    return typeof TKP_projectTag === "function" ? TKP_projectTag(p, true) : p && p.kind === "onboarding" ? "Onboarding" : null;
  };
  var open = function (r) {
    if (typeof TK_navigate === "function") TK_navigate({ view: "project", projectId: r.id });
  };

  var table = !sorted.length ? (
    <div className="tk-state" role="status">
      <p>{showArchived ? "No projects yet." : "No open projects. Tick Show archived to see archived ones."}</p>
    </div>
  ) : (
    <div className="tkpu-table-wrap">
      <table className="tkpu-table">
        <caption className="tk-sr">Projects, sorted by {TKPU_COLUMNS.filter(function (c) { return c.key === sort.key; })[0].label}</caption>
        <thead>
          <tr>
            {TKPU_COLUMNS.map(function (c) {
              if (!c.sort) {
                return (
                  <th key={c.key} scope="col">
                    {c.label}
                  </th>
                );
              }
              var aria = TKPU_ariaSort(sort, c.key);
              return (
                <th key={c.key} scope="col" aria-sort={aria}>
                  <button
                    type="button"
                    className={"tkpu-sort" + (aria !== "none" ? " is-on" : "")}
                    onClick={function () {
                      setSort(TKPU_nextSort(sort, c.key));
                    }}
                  >
                    {c.label}
                    <span className="tkpu-sort-mark" aria-hidden="true">
                      {aria === "ascending" ? " ▲" : aria === "descending" ? " ▼" : ""}
                    </span>
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map(function (r) {
            var href = typeof TK_formatRoute === "function" ? TK_formatRoute({ view: "project", projectId: r.id }) : "#/tasks/p/" + r.id;
            return (
              <tr
                key={r.id}
                className={"tkpu-row" + (r.archived ? " is-archived" : "")}
                onClick={function (e) {
                  if (e.target && e.target.closest && e.target.closest("a, button")) return;
                  open(r);
                }}
              >
                <td className="tkpu-c-name">
                  <a
                    href={href}
                    onClick={function (e) {
                      if (typeof TK_vPlainClick === "function" && !TK_vPlainClick(e)) return;
                      e.preventDefault();
                      open(r);
                    }}
                  >
                    {typeof TK_vProjectDot === "function" ? <TK_vProjectDot color={typeof TK_projectColorOf === "function" ? TK_projectColorOf(r.project) : r.project.color} /> : null}
                    <span className="tkpu-name">{r.name}</span>
                  </a>
                  {tagOf(r.project) ? <span className="tk-nav-tag">{tagOf(r.project)}</span> : null}
                  {r.archived ? <span className="tk-nav-tag">Archived</span> : null}
                </td>
                <td className="tkpu-c-owner">{r.owner || <span className="tk-muted">None</span>}</td>
                <td className="tkpu-c-status">
                  <TKPU_Pill status={r.status} />
                </td>
                <td className="tkpu-c-updated">
                  {r.lastText ? <span>{r.lastText}</span> : <span className="tk-muted">Never</span>}
                  {r.stale ? <span className="pill warm tkpu-stale">Stale</span> : null}
                </td>
                <td className="tkpu-c-due">
                  {r.due ? <span className={r.due.late ? "tkpu-late" : ""}>{r.due.text}</span> : <span className="tk-muted">None</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="tk-view tkpu-portfolio">
      {head}
      <div className="tk-toolbar tkpu-toolbar">
        <p className="tkpu-summary" aria-live="polite">
          {TKPU_summaryText(rows)}
        </p>
        {archivedCount ? (
          <label className="tkpu-arch">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={function (e) {
                setShowArchived(!!e.target.checked);
              }}
            />
            {" Show archived (" + archivedCount + ")"}
          </label>
        ) : null}
      </div>
      {table}
    </div>
  );
}
