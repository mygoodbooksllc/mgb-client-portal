// ----------------------------------------------------------------------------
// TK_Rules.jsx — Slate plus Rules at #/tasks/rules (hidden preview, TKP_on).
//
// TK_Rules({ staffUser, clients, isAdmin })
//   Simple "When ..., then ..." rules for one project or one client. Full
//   admins see and edit them; only the owner can switch a rule on. Every rule
//   starts switched off. Dry run shows what a rule would do to today's tasks
//   and writes nothing. Recent runs lists what rules did (newest first).
//   While the firm switch (tk_settings.slateplus_enabled) is off, the server
//   never runs a rule, switched on or not; the page says so at the top.
//
// The pure parts are in TK_rulesLogic.js (TKRU_*, tested in node). Every write
// is an RPC in supabase/slateplus-rules.sql; the server decides who may call it.
// Only TK_App renders this, and only while TKP_on() is true.
// ----------------------------------------------------------------------------

function TK_rulesWhen(iso) {
  if (!iso) return "";
  try {
    var d = new Date(iso);
    return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch (e) {
    return "";
  }
}

function TK_Rules(props) {
  var schema = TK_vUseSchema();
  if (schema === "missing") return <TK_SetupCard />;
  if (!(props.isAdmin && props.staffUser && props.staffUser.role === "admin")) {
    return (
      <div className="tk-view tk-manage tkru">
        <h2 className="tk-view-title">Rules</h2>
        <div className="tk-state" role="status">
          <p>Only admins (not temporary admins) can see and edit rules.</p>
        </div>
      </div>
    );
  }
  if (schema !== "ok") {
    return (
      <div className="tk-view tk-manage tkru">
        <h2 className="tk-view-title">Rules</h2>
        <TK_vSkeletonRows count={4} />
      </div>
    );
  }
  return <TK_vRulesBody {...props} />;
}

function TK_vRulesBody(props) {
  var me = props.staffUser || {};
  var isOwner = me.isInternalOwner === true;
  var online = TK_vUseOnline();
  var dPair = React.useState({ loading: true, error: null, rows: [] });
  var data = dPair[0];
  var setData = dPair[1];
  var tickPair = React.useState(0);
  var tick = tickPair[0];
  var setTick = tickPair[1];
  var bPair = React.useState(false);
  var busy = bPair[0];
  var setBusy = bPair[1];
  var lPair = React.useState(null);
  var live = lPair[0];
  var setLive = lPair[1];
  var ePair = React.useState(null);
  var editing = ePair[0];
  var setEditing = ePair[1];
  var aPair = React.useState(false);
  var showArchived = aPair[0];
  var setShowArchived = aPair[1];
  var sPair = React.useState([]);
  var staff = sPair[0];
  var setStaff = sPair[1];
  var dryPair = React.useState(null);
  var dry = dryPair[0];
  var setDry = dryPair[1];
  var rPair = React.useState({ loading: true, rows: [] });
  var runs = rPair[0];
  var setRuns = rPair[1];

  var projects = TK_vUseStore(function (s) {
    return s ? s.projects : null;
  });
  React.useEffect(
    function () {
      if (projects == null && TK_api && typeof TK_api.listProjects === "function") TK_api.listProjects().catch(function () {});
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projects == null],
  );
  React.useEffect(function () {
    var on = true;
    if (TK_api && typeof TK_api.listStaff === "function") {
      Promise.resolve(TK_api.listStaff()).then(
        function (list) {
          if (on) setStaff(Array.isArray(list) ? list : []);
        },
        function () {},
      );
    }
    // The firm switch, read only, so the note at the top tells the truth.
    try {
      var c = window.mgbSupabase;
      if (c) {
        c.from("tk_settings")
          .select("value")
          .eq("key", "slateplus_enabled")
          .maybeSingle()
          .then(function (res) {
            if (on && res && !res.error) setLive(typeof TKP_switchValue === "function" ? TKP_switchValue(res.data && res.data.value) : false);
          });
      }
    } catch (e) {}
    return function () {
      on = false;
    };
  }, []);

  React.useEffect(
    function () {
      var on = true;
      setData(function (d) {
        return { loading: true, error: null, rows: d.rows };
      });
      TK_api.rulesList().then(
        function (rows) {
          if (on) setData({ loading: false, error: null, rows: rows });
        },
        function (e) {
          if (on) setData({ loading: false, error: e || { code: "tk_error" }, rows: [] });
        },
      );
      TK_api.ruleRecentRuns(null, 50).then(
        function (rows) {
          if (on) setRuns({ loading: false, rows: rows });
        },
        function () {
          if (on) setRuns({ loading: false, rows: [], error: true });
        },
      );
      return function () {
        on = false;
      };
    },
    [tick],
  );
  var reload = function () {
    setTick(function (n) {
      return n + 1;
    });
  };

  var clientNames = React.useMemo(
    function () {
      return TK_vNameMap(props.clients, "id", "name");
    },
    [props.clients],
  );
  var projectById = {};
  (projects || []).forEach(function (p) {
    if (p && p.id) projectById[p.id] = p;
  });
  var staffName = {};
  staff.forEach(function (s) {
    if (s && s.email) staffName[String(s.email).toLowerCase()] = s.name || s.email;
  });
  var ctx = {
    projectName: function (id) {
      return projectById[id] ? projectById[id].name : "";
    },
    clientName: function (id) {
      return clientNames[String(id)] || "";
    },
    staffName: function (e) {
      return staffName[String(e || "").toLowerCase()] || "";
    },
  };

  var act = function (fn, okText) {
    setBusy(true);
    return fn().then(
      function (res) {
        setBusy(false);
        if (res && res.ok === false) {
          TK_vToast(res.problem || "Couldn't do that. Try again.");
          return res;
        }
        if (okText) TK_vToast(okText);
        reload();
        return res;
      },
      function (e) {
        setBusy(false);
        TK_vToast(TKRU_errorText(e));
        throw e;
      },
    );
  };

  var onToggle = function (r, on) {
    if (!TKRU_canToggle(me, r, on)) {
      TK_vToast(on ? "Only the owner can switch a rule on." : "You can't change this rule.");
      return;
    }
    act(function () {
      return TK_api.ruleSetEnabled(r.id, on);
    }, on ? "Rule switched on." : "Rule switched off.").catch(function () {});
  };
  var onArchive = function (r, archived) {
    act(function () {
      return TK_api.ruleArchive(r.id, archived);
    }, archived ? "Rule archived. It won't run." : "Rule restored. It's switched off.").catch(function () {});
  };
  var runDry = function (key, payload) {
    setDry({ key: key, loading: true, result: null });
    TK_api.ruleDryRun(payload).then(
      function (res) {
        setDry({ key: key, loading: false, result: res || null });
        if (res && typeof res.live === "boolean") setLive(res.live);
      },
      function (e) {
        setDry({ key: key, loading: false, result: { ok: false, problem: TKRU_errorText(e) } });
      },
    );
  };

  var rows = data.rows.filter(function (r) {
    return showArchived || !r.archived_at;
  });
  var archivedCount = data.rows.filter(function (r) {
    return !!r.archived_at;
  }).length;

  return (
    <div className="tk-view tk-manage tkru">
      <h2 className="tk-view-title">Rules</h2>
      <p className={"tkru-gate" + (live ? " is-live" : "")} role="status">
        {live == null ? "Checking whether rules are running…" : TKRU_gateNote(live)}
      </p>
      <p className="tk-muted tkru-intro">
        A rule does one thing when something happens to a task in one project or one client: assign it, set its due date, move it, post a System comment or add a follow-up. New rules start switched off.
        {isOwner ? " You can switch a rule on." : " Only the owner can switch a rule on."}
      </p>

      <div className="tk-mp-bar tkru-bar">
        <button
          type="button"
          className="btn-primary"
          data-tour="tk-rules-new"
          disabled={busy || !online || !!editing}
          onClick={function () {
            setDry(null);
            setEditing(TKRU_blankDraft());
          }}
        >
          New rule
        </button>
        {archivedCount ? (
          <label className="tkru-check">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={function (e) {
                setShowArchived(e.target.checked);
              }}
            />{" "}
            Show archived ({archivedCount})
          </label>
        ) : null}
      </div>

      {editing ? (
        <TK_vRuleForm
          draft={editing}
          projects={(projects || []).filter(function (p) {
            return p && !p.archived_at;
          })}
          projectById={projectById}
          clients={props.clients || []}
          staff={staff}
          busy={busy || !online}
          dry={dry && dry.key === "draft" ? dry : null}
          onDry={function (payload) {
            runDry("draft", payload);
          }}
          onCancel={function () {
            setEditing(null);
            if (dry && dry.key === "draft") setDry(null);
          }}
          onSave={function (payload) {
            return act(function () {
              return TK_api.ruleSave(payload);
            }, payload.id ? (isOwner ? "Rule saved." : "Rule saved. It's switched off until the owner switches it on.") : "Rule saved. It's switched off.").then(function (res) {
              if (res && res.ok !== false) {
                setEditing(null);
                setDry(null);
              }
              return res;
            });
          }}
        />
      ) : null}

      {data.loading && !data.rows.length ? <TK_vSkeletonRows count={3} /> : null}
      {data.error ? (
        <div className="tk-state" role="alert">
          <p>{TKRU_errorText(data.error)}</p>
          <button type="button" className="btn-secondary" onClick={reload}>
            Try again
          </button>
        </div>
      ) : null}
      {!data.loading && !data.error && !rows.length ? (
        <div className="tk-state" role="status">
          <p>No rules yet. Start with New rule, then use Dry run to see what it would do.</p>
        </div>
      ) : null}
      {rows.length ? (
        <ul className="tk-mp-rows tkru-rows">
          {rows.map(function (r) {
            var archived = !!r.archived_at;
            var canOn = TKRU_canToggle(me, r, true);
            var canOff = TKRU_canToggle(me, r, false);
            var swDisabled = busy || !online || archived || (r.enabled ? !canOff : !canOn);
            var openDry = dry && dry.key === r.id ? dry : null;
            return (
              <li key={r.id} className={"tk-mp-row tkru-row" + (archived ? " is-archived" : "")}>
                <div className="tk-mp-main">
                  <div className="tk-mp-title-line">
                    <span className="tk-mp-title">{r.name}</span>
                    {archived ? <span className="tk-nav-tag">Archived</span> : null}
                  </div>
                  <p className="tk-muted tk-mp-sub">{TKRU_describe(r, ctx)}</p>
                  <p className="tk-muted tk-mp-sub">
                    {r.enabled && r.enabled_at ? "Switched on " + TK_rulesWhen(r.enabled_at) : "Switched off"}
                    {r.updated_by ? " · Last edit by " + (ctx.staffName(r.updated_by) || r.updated_by) : ""}
                  </p>
                  {openDry ? <TK_vRuleDryResult dry={openDry} clientNames={clientNames} /> : null}
                </div>
                <div className="tk-mp-actions">
                  <TK_vSwitch
                    checked={!!r.enabled}
                    disabled={swDisabled}
                    label={r.enabled ? "On" : "Off"}
                    onChange={function (on) {
                      onToggle(r, on);
                    }}
                  />
                  {!archived ? (
                    <button
                      type="button"
                      className="tk-tool-btn"
                      disabled={busy || !!editing}
                      onClick={function () {
                        setDry(null);
                        setEditing(TKRU_draftFromRule(r));
                      }}
                    >
                      Edit
                    </button>
                  ) : null}
                  {!archived ? (
                    <button
                      type="button"
                      className="tk-tool-btn"
                      data-tour="tk-rules-dry"
                      disabled={busy || !online || (openDry && openDry.loading)}
                      onClick={function () {
                        if (openDry && !openDry.loading) setDry(null);
                        else runDry(r.id, { id: r.id });
                      }}
                    >
                      {openDry && !openDry.loading ? "Hide dry run" : "Dry run"}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="tk-tool-btn"
                    disabled={busy || !online}
                    onClick={function () {
                      onArchive(r, !archived);
                    }}
                  >
                    {archived ? "Restore" : "Archive"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      <section className="tkru-runs" data-tour="tk-rules-runs" aria-labelledby="tkru-runs-h">
        <h3 className="tkru-h" id="tkru-runs-h">
          Recent runs
        </h3>
        {runs.loading ? <TK_vSkeletonRows count={2} /> : null}
        {!runs.loading && runs.error ? <p className="tk-muted">Couldn't load recent runs.</p> : null}
        {!runs.loading && !runs.error && !runs.rows.length ? <p className="tk-muted">Nothing yet. When a rule runs, it shows here.</p> : null}
        {runs.rows.length ? (
          <ul className="tkru-run-list">
            {runs.rows.map(function (x) {
              var change = x.from_value || x.to_value ? (x.from_value || "none") + " → " + (x.to_value || "none") : "";
              return (
                <li key={x.id} className={"tkru-run is-" + x.outcome}>
                  <span className="tkru-run-when">{TK_rulesWhen(x.created_at)}</span>
                  <span className="tkru-run-main">
                    <strong>{x.rule_name}</strong>
                    {" · "}
                    {x.task_text || "A task you can't open"}
                    {x.client_id != null && clientNames[String(x.client_id)] ? " (" + clientNames[String(x.client_id)] + ")" : ""}
                  </span>
                  <span className={"tkru-pill is-" + x.outcome}>{TKRU_runLabel(x.outcome)}</span>
                  {change || x.detail ? <span className="tk-muted tkru-run-detail">{[change, x.detail].filter(Boolean).join(" · ")}</span> : null}
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>
    </div>
  );
}

function TK_vRuleDryResult(props) {
  var dry = props.dry;
  if (!dry) return null;
  if (dry.loading) return <p className="tk-muted tkru-dry">Checking today's tasks…</p>;
  var res = dry.result || {};
  if (res.ok === false) {
    return (
      <p className="tk-field-error tkru-dry" role="alert">
        {res.problem || "Couldn't run the dry run."}
      </p>
    );
  }
  var counts = res.counts || {};
  var total = Number(res.total) || 0;
  var names = props.clientNames || {};
  return (
    <div className="tkru-dry" role="status">
      <p className="tkru-dry-head">
        Dry run, nothing changed.{" "}
        {total
          ? total + (total === 1 ? " task matches now" : " tasks match now") + (res.capped ? " (first 500 checked)" : "") + ": " + (Number(counts.do) || 0) + " would change, " + (Number(counts.noop) || 0) + " already set, " + (Number(counts.skipped) || 0) + " skipped."
          : "No tasks match right now."}
      </p>
      {Array.isArray(res.matches) && res.matches.length ? (
        <ul className="tkru-dry-list">
          {res.matches.map(function (m) {
            return (
              <li key={m.task_id} className="tkru-dry-item">
                <span className={"tkru-pill is-" + m.outcome}>{TKRU_dryLabel(m.outcome)}</span>
                <span className="tkru-dry-text">
                  {m.text}
                  {m.client_id != null && names[String(m.client_id)] ? " (" + names[String(m.client_id)] + ")" : ""}
                </span>
                {m.would ? <span className="tk-muted tkru-dry-would">{m.would}</span> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {total > (res.matches ? res.matches.length : 0) ? <p className="tk-muted">Showing the first {res.matches ? res.matches.length : 0}.</p> : null}
    </div>
  );
}

function TK_vRuleForm(props) {
  var dPair = React.useState(props.draft);
  var d = dPair[0];
  var setD = dPair[1];
  var pPair = React.useState("");
  var problem = pPair[0];
  var setProblem = pPair[1];
  var set = function (patch) {
    setD(function (x) {
      return Object.assign({}, x, patch);
    });
    if (problem) setProblem("");
  };
  var project = d.scope_kind === "project" && d.project_id ? props.projectById[d.project_id] || null : null;
  var sections = project && Array.isArray(project.sections) ? project.sections : [];
  var staffEmails = props.staff.map(function (s) {
    return String(s.email || "").toLowerCase();
  });
  // People and sections are checked here only once they've loaded; the server checks everything.
  var check = function () {
    var c = {};
    if (props.staff.length) c.staffEmails = staffEmails;
    if (project) c.project = project;
    return TKRU_validate(d, c);
  };
  var onSubmit = function (e) {
    if (e) e.preventDefault();
    var p = check();
    if (p) return setProblem(p);
    props.onSave(TKRU_payload(d)).then(
      function (res) {
        if (res && res.ok === false) setProblem(res.problem || "Couldn't save the rule.");
      },
      function () {},
    );
  };
  var onDry = function () {
    var p = check();
    if (p) return setProblem(p);
    props.onDry(TKRU_payload(d));
  };
  var staffOptions = props.staff.map(function (s) {
    return (
      <option key={s.email} value={String(s.email).toLowerCase()}>
        {s.name || s.email}
      </option>
    );
  });
  var sectionOptions = sections.map(function (s) {
    return (
      <option key={s} value={s}>
        {s}
      </option>
    );
  });
  // The actions a trigger allows in this scope (a client rule can't move sections).
  var allowed = function (trigger, scope) {
    return TKRU_actionsFor(trigger).filter(function (k) {
      return scope === "project" || k !== "move_section";
    });
  };
  // Keep the picked action when it still fits; otherwise the first that does.
  var withAction = function (next) {
    var trig = next.trigger_kind || d.trigger_kind;
    var list = allowed(trig, next.scope_kind || d.scope_kind);
    if (list.indexOf(d.action_kind) < 0) next.action_kind = list[0] || "";
    return next;
  };
  var actions = allowed(d.trigger_kind, d.scope_kind);
  var pickTrigger = function (k) {
    set(withAction({ trigger_kind: k }));
  };
  var sentenceCtx = {
    projectName: function (id) {
      return props.projectById[id] ? props.projectById[id].name : "";
    },
    clientName: function (id) {
      var c = props.clients.filter(function (x) {
        return String(x.id) === String(id);
      })[0];
      return c ? c.name : "";
    },
    staffName: function (e) {
      var s = props.staff.filter(function (x) {
        return String(x.email).toLowerCase() === e;
      })[0];
      return s ? s.name : "";
    },
  };
  var fid = "tkru-f-" + (d.id || "new");

  return (
    <form className="tkru-form" onSubmit={onSubmit} aria-labelledby={fid + "-h"}>
      <h3 className="tkru-h" id={fid + "-h"}>
        {d.id ? "Edit rule" : "New rule"}
      </h3>
      <label className="tk-field">
        <span className="tk-field-label">Name</span>
        <input
          className="tk-input"
          type="text"
          maxLength={80}
          value={d.name}
          autoFocus
          onChange={function (e) {
            set({ name: e.target.value });
          }}
        />
      </label>

      <fieldset className="tkru-set">
        <legend className="tk-field-label">Where</legend>
        <div className="tkru-row-fields">
          <select
            className="tk-select"
            aria-label="Project or client"
            value={d.scope_kind}
            onChange={function (e) {
              var k = e.target.value;
              var next = { scope_kind: k };
              if (k === "client" && d.trigger_kind === "section_moved") next.trigger_kind = "done";
              set(withAction(next));
            }}
          >
            <option value="project">A project</option>
            <option value="client">A client</option>
          </select>
          {d.scope_kind === "project" ? (
            <select
              className="tk-select"
              aria-label="Project"
              value={d.project_id}
              onChange={function (e) {
                set({ project_id: e.target.value, trigger_section: "", move_section: "" });
              }}
            >
              <option value="">Pick a project</option>
              {props.projects.map(function (p) {
                return (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                );
              })}
            </select>
          ) : (
            <select
              className="tk-select"
              aria-label="Client"
              value={d.client_id}
              onChange={function (e) {
                set({ client_id: e.target.value });
              }}
            >
              <option value="">Pick a client</option>
              {props.clients.map(function (c) {
                return (
                  <option key={c.id} value={String(c.id)}>
                    {c.name || String(c.id)}
                  </option>
                );
              })}
            </select>
          )}
        </div>
      </fieldset>

      <fieldset className="tkru-set">
        <legend className="tk-field-label">When</legend>
        <div className="tkru-row-fields">
          <select
            className="tk-select"
            aria-label="When the rule runs"
            value={d.trigger_kind}
            onChange={function (e) {
              pickTrigger(e.target.value);
            }}
          >
            {TKRU_TRIGGERS.filter(function (k) {
              return d.scope_kind === "project" || k !== "section_moved";
            }).map(function (k) {
              return (
                <option key={k} value={k}>
                  {TKRU_TRIGGER_LABELS[k]}
                </option>
              );
            })}
          </select>
          {d.trigger_kind === "section_moved" ? (
            <select
              className="tk-select"
              aria-label="Section"
              value={d.trigger_section}
              onChange={function (e) {
                set({ trigger_section: e.target.value });
              }}
            >
              <option value="">{project ? "Pick a section" : "Pick a project first"}</option>
              {sectionOptions}
            </select>
          ) : null}
          {d.trigger_kind === "assigned" ? (
            <select
              className="tk-select"
              aria-label="Assigned to"
              value={d.trigger_email}
              onChange={function (e) {
                set({ trigger_email: e.target.value });
              }}
            >
              <option value="">to anyone</option>
              {staffOptions}
            </select>
          ) : null}
        </div>
        {d.trigger_kind === "overdue" ? <span className="tk-field-help">Checked once a day, early morning. A task counts once per due date.</span> : null}
      </fieldset>

      <fieldset className="tkru-set">
        <legend className="tk-field-label">Then</legend>
        <div className="tkru-row-fields">
          <select
            className="tk-select"
            aria-label="What the rule does"
            value={d.action_kind}
            onChange={function (e) {
              set({ action_kind: e.target.value });
            }}
          >
            {actions.map(function (k) {
              return (
                <option key={k} value={k}>
                  {TKRU_ACTION_LABELS[k]}
                </option>
              );
            })}
          </select>
          {d.action_kind === "assign" ? (
            <select
              className="tk-select"
              aria-label="Assign to"
              value={d.assign_email}
              onChange={function (e) {
                set({ assign_email: e.target.value });
              }}
            >
              <option value="">Pick a teammate</option>
              {staffOptions}
            </select>
          ) : null}
          {d.action_kind === "set_due" ? (
            <React.Fragment>
              <input
                className="tk-input tkru-num"
                type="number"
                min={0}
                max={365}
                aria-label="Days later"
                value={d.due_days}
                onChange={function (e) {
                  set({ due_days: e.target.value });
                }}
              />
              <label className="tkru-check">
                <input
                  type="checkbox"
                  checked={d.due_business}
                  onChange={function (e) {
                    set({ due_business: e.target.checked });
                  }}
                />{" "}
                business days
              </label>
            </React.Fragment>
          ) : null}
          {d.action_kind === "move_section" ? (
            <select
              className="tk-select"
              aria-label="Move to section"
              value={d.move_section}
              onChange={function (e) {
                set({ move_section: e.target.value });
              }}
            >
              <option value="">{project ? "Pick a section" : "Pick a project first"}</option>
              {sectionOptions}
            </select>
          ) : null}
        </div>
        {d.action_kind === "set_due" ? <span className="tk-field-help">Days after the day the rule runs. The original due date stays as it was, so on-time scores don't move.</span> : null}
        {d.action_kind === "comment" ? (
          <textarea
            className="tk-textarea"
            aria-label="Comment"
            maxLength={1000}
            rows={3}
            value={d.comment_text}
            onChange={function (e) {
              set({ comment_text: e.target.value });
            }}
          />
        ) : null}
        {d.action_kind === "comment" ? <span className="tk-field-help">Posted as System, with the rule's name. It doesn't email anyone.</span> : null}
        {d.action_kind === "follow_up" ? (
          <div className="tkru-row-fields">
            <input
              className="tk-input"
              type="text"
              maxLength={200}
              aria-label="Follow-up title"
              placeholder="Follow-up title"
              value={d.follow_title}
              onChange={function (e) {
                set({ follow_title: e.target.value });
              }}
            />
            <select
              className="tk-select"
              aria-label="Follow-up for"
              value={d.follow_assignee}
              onChange={function (e) {
                set({ follow_assignee: e.target.value });
              }}
            >
              <option value="same">Same person</option>
              {staffOptions}
            </select>
            <input
              className="tk-input tkru-num"
              type="number"
              min={0}
              max={365}
              aria-label="Due days later (optional)"
              placeholder="Days"
              value={d.follow_days}
              onChange={function (e) {
                set({ follow_days: e.target.value });
              }}
            />
          </div>
        ) : null}
      </fieldset>

      <p className="tk-muted tkru-sentence">{TKRU_describe(TKRU_payload(d), sentenceCtx)}</p>
      {problem ? (
        <p className="tk-field-error" role="alert">
          {problem}
        </p>
      ) : null}
      <div className="tkru-form-actions">
        <button type="submit" className="btn-primary" disabled={props.busy}>
          Save
        </button>
        <button type="button" className="btn-secondary" disabled={props.busy || (props.dry && props.dry.loading)} onClick={onDry}>
          Dry run
        </button>
        <button type="button" className="btn-secondary" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
      {props.dry ? <TK_vRuleDryResult dry={props.dry} clientNames={TK_vNameMap(props.clients, "id", "name")} /> : null}
    </form>
  );
}
