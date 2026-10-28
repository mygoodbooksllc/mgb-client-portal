// ----------------------------------------------------------------------------
// TK_Profile.jsx: the Slate plus person profile (#/tasks/person/<key>), spec
// docs/slateplus-profile-spec.md. Hidden: TK_App renders it only while
// TKP_on() is true (preview mgb_slateplus_preview or the firm switch
// slateplus_enabled; never in View as).
//
// Visibility: every read is an existing RLS-scoped read under the viewer's own
// login (tk_tasks, tk_comments task ids only, tk_projects, client_profile,
// staff_time_off, staff_shoutouts, staff_directory, staff_profiles). Client
// names come only from the viewer's own `clients` list. No hours. Last seen
// (staff_last_seen) only for real admins. Rows are read-only unless
// TK_canEdit says the viewer could already edit that task.
// ----------------------------------------------------------------------------

var TKP_SINCE_DAYS = 90;
var TKP_TOUCH_COLS = "id, client_id, project_id, assignee_email, staff_email, reviewer_email, created_at, updated_at, completed_at, deleted_at";

function TKP_useDirectoryOnce() {
  var pair = React.useState(null);
  var dir = pair[0];
  var setDir = pair[1];
  React.useEffect(function () {
    var live = true;
    var done = function (rows) {
      if (live) setDir(Array.isArray(rows) ? rows : []);
    };
    try {
      if (typeof CV_loadDirectory === "function") {
        CV_loadDirectory().then(done, function () {
          done([]);
        });
      } else if (window.mgbSupabase) {
        window.mgbSupabase.rpc("staff_directory").then(function (res) {
          done(
            ((res && res.data) || []).map(function (s) {
              return { email: String(s.email || "").toLowerCase(), name: s.name, role: s.role };
            }),
          );
        }, function () {
          done([]);
        });
      } else done([]);
    } catch (e) {
      done([]);
    }
    return function () {
      live = false;
    };
  }, []);
  return dir;
}

function TK_Profile(props) {
  var schema = TK_vUseSchema();
  var dir = TKP_useDirectoryOnce();
  var route = props.route || {};
  if (schema === "missing") return <TK_SetupCard />;
  if (schema !== "ok" || dir == null) {
    return (
      <div className="tk-view tkp-profile">
        <TK_vSkeletonRows count={6} />
      </div>
    );
  }
  var person = TKP_findByKey(dir, route.key, TKP_personKey);
  if (!person) {
    return (
      <div className="tk-state" role="status">
        <p>We couldn't find that person.</p>
        <a className="btn-secondary" href="#/tasks/my">
          Go to Slate
        </a>
      </div>
    );
  }
  return <TK_vProfileBody key={person.email} person={person} dir={dir} staffUser={props.staffUser} clients={props.clients} isAdmin={props.isAdmin} />;
}

function TKP__nameOf(dir, email) {
  var e = String(email || "").toLowerCase();
  for (var i = 0; i < (dir || []).length; i++) if (dir[i] && dir[i].email === e) return dir[i].name || e.split("@")[0];
  return e ? e.split("@")[0] : "";
}

function TKP__fmt(ymd) {
  if (!ymd) return "";
  try {
    return typeof fmtDate === "function" ? fmtDate(String(ymd).slice(0, 10)) : String(ymd).slice(0, 10);
  } catch (e) {
    return String(ymd).slice(0, 10);
  }
}

function TKP__ago(iso) {
  if (!iso) return "";
  try {
    if (typeof relTime === "function") return relTime(iso);
  } catch (e) {}
  return TKP__fmt(iso);
}

// The extra reads behind collaborators, recent work, backup, title and last
// seen. One pass per person when the page opens (the backup read again only
// when the covered client list changes); every read is bounded and RLS-scoped.
function TKP__safe(p) {
  return Promise.resolve(p).then(
    function (r) {
      return r && !r.error ? r.data : null;
    },
    function () {
      return null;
    },
  );
}

function TKP_useExtras(person, coveredIds, opts) {
  var EMPTY = { loading: true, touched: [], title: "", lastSeen: "" };
  var pair = React.useState(EMPTY);
  var st = pair[0];
  var set = pair[1];
  var bpair = React.useState(null);
  var backups = bpair[0];
  var setBackups = bpair[1];
  var idsKey = coveredIds.join(",");
  React.useEffect(
    function () {
      var live = true;
      set(EMPTY);
      var sb = window.mgbSupabase;
      if (!sb) {
        set({ loading: false, touched: [], title: "", lastSeen: "" });
        return undefined;
      }
      var email = person.email;
      var since = new Date(Date.now() - TKP_SINCE_DAYS * 864e5).toISOString();
      // Tasks they made by hand (template tasks carry the template author).
      var created = TKP__safe(
        sb
          .from("tk_tasks")
          .select(TKP_TOUCH_COLS)
          .eq("staff_email", email)
          .is("deleted_at", null)
          .or("source.is.null,source.neq.template")
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(300),
      );
      // Tasks they commented on: task ids only, never the comment body.
      var commented = TKP__safe(
        sb.from("tk_comments").select("task_id, created_at").eq("author_email", email).is("deleted_at", null).gte("created_at", since).order("created_at", { ascending: false }).limit(200),
      ).then(function (rows) {
        var at = {};
        (rows || []).forEach(function (r) {
          if (r && r.task_id && !at[r.task_id]) at[r.task_id] = r.created_at;
        });
        var ids = Object.keys(at).slice(0, 200);
        if (!ids.length) return [];
        return TKP__safe(sb.from("tk_tasks").select(TKP_TOUCH_COLS).in("id", ids).is("deleted_at", null)).then(function (ts) {
          return (ts || []).map(function (t) {
            return Object.assign({}, t, { __commented: true, __touched_at: at[t.id] });
          });
        });
      });
      // staff_profiles RLS: own row or admins; skip the read for anyone else.
      var title =
        opts.realAdmin || opts.self
          ? TKP__safe(sb.from("staff_profiles").select("title").eq("email", email).maybeSingle()).then(function (r) {
              return (r && r.title) || "";
            })
          : Promise.resolve("");
      // staff_last_seen refuses everyone but real admins; never in View as.
      var ro = typeof MGB_viewAsReadOnly === "function" && MGB_viewAsReadOnly();
      var seen =
        opts.realAdmin && !ro
          ? TKP__safe(sb.rpc("staff_last_seen", { p_email: email })).then(function (d) {
              return TKP_lastSeenAt(d);
            })
          : Promise.resolve("");
      Promise.all([created, commented, title, seen]).then(function (res) {
        if (!live) return;
        set({ loading: false, touched: (res[0] || []).concat(res[1] || []), title: res[2] || "", lastSeen: res[3] || "" });
      });
      return function () {
        live = false;
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [person.email, opts.realAdmin, opts.self],
  );
  React.useEffect(
    function () {
      var live = true;
      setBackups(null);
      var sb = window.mgbSupabase;
      if (!sb || !idsKey) return undefined;
      // client_profile RLS: is_active_staff and can_access_client.
      TKP__safe(sb.from("client_profile").select("client_id, backup_bookkeeper_email").in("client_id", idsKey.split(","))).then(function (rows) {
        if (!live || !rows) return;
        var m = {};
        rows.forEach(function (r) {
          m[String(r.client_id)] = String(r.backup_bookkeeper_email || "").toLowerCase();
        });
        setBackups(m);
      });
      return function () {
        live = false;
      };
    },
    [person.email, idsKey],
  );
  return { loading: st.loading, touched: st.touched, backups: backups, title: st.title, lastSeen: st.lastSeen };
}

function TK_vProfileBody(props) {
  var person = props.person;
  var dir = props.dir || [];
  var staffUser = props.staffUser || {};
  var me = TK_vLower(staffUser.email);
  var isAdmin = !!props.isAdmin;
  // Admin RLS is role admin only: temporary admins get the non-admin view.
  var realAdmin = isAdmin && String(staffUser.role || "").toLowerCase() === "admin";
  var self = me && me === person.email;
  var today = TK_vToday();
  var online = TK_vUseOnline();
  var clients = Array.isArray(props.clients) ? props.clients : [];
  var projects = TK_vUseProjects();
  var staff = TK_vUseStaff(realAdmin);
  var timeOff = typeof CV_useTimeOff === "function" ? CV_useTimeOff() : { rows: [], loading: false };
  var so = typeof SO_useStore === "function" ? SO_useStore() : { rows: [], loading: false };

  // List key from the profile key: list keys never carry an email.
  var list = TK_vUseList("assignee:" + TKP_personKey(person.email), function () {
    return TK_api.listScope({ assigneeEmail: person.email });
  });

  var clientNames = React.useMemo(
    function () {
      var m = {};
      clients.forEach(function (c) {
        if (c && c.id != null) m[String(c.id)] = c.name || "";
      });
      return m;
    },
    [clients],
  );
  var projectNames = {};
  (projects || []).forEach(function (p) {
    if (p && p.id) projectNames[p.id] = p.name || "";
  });

  var covered = React.useMemo(
    function () {
      return TKP_coveredClients(clients, person.email);
    },
    [clients, person.email],
  );
  var coveredIds = covered.map(function (c) {
    return c.id;
  });
  var extras = TKP_useExtras(person, coveredIds, { realAdmin: realAdmin, self: !!self });

  var groups = TK_groupMyTasks(list.tasks, today, { email: person.email });
  var sections = TKP_sections(groups);
  var glance = TKP_glance(groups);
  var mine = list.tasks.filter(function (t) {
    return TK_isMine(t, person.email);
  });
  var collabs = extras.loading ? [] : TKP_collaborators(person.email, mine.concat(extras.touched), 6);
  var recent = TKP_recent(mine.concat(extras.touched), {
    clientName: function (id) {
      return clientNames[id] || "";
    },
    projectName: function (id) {
      return projectNames[id] || "";
    },
    limit: 5,
  });
  var out = TKP_timeOff(timeOff.rows, person.email, today, 30);
  var backup = TKP_backupSummary(extras.backups, coveredIds, person.email);
  var shouts = TKP_shoutoutsFor(so.rows, person.email, 5);
  var staffRow = realAdmin
    ? (staff || []).filter(function (s) {
        return s && String(s.email || "").toLowerCase() === person.email;
      })[0]
    : null;

  var editCtx = {
    email: me,
    isAdmin: realAdmin,
    canSeeClient: function (id) {
      return Object.prototype.hasOwnProperty.call(clientNames, String(id));
    },
    isMember: function (id) {
      return Object.prototype.hasOwnProperty.call(projectNames, id);
    },
  };

  var rowFor = function (t) {
    var editable = online && TK_canEdit(t, editCtx);
    return (
      <TK_TaskRow
        key={t.id}
        task={t}
        today={today}
        clientName={t.client_id != null ? clientNames[String(t.client_id)] || "" : ""}
        projectName={t.project_id ? projectNames[t.project_id] || "" : ""}
        projectColor={t.project_id && typeof TK_projectColorById === "function" ? TK_projectColorById(projects, t.project_id) : ""}
        showClient={true}
        assigneeName={person.name || ""}
        focused={false}
        checklist={null}
        isAdmin={realAdmin}
        canEdit={editable}
        editFields={editable}
        onOpen={function (id) {
          TK_vOpenTask(id, { from: "list" });
        }}
        onToggleDone={
          editable
            ? function (task) {
                TK_vComplete(task, realAdmin);
              }
            : null
        }
        onStatus={
          editable
            ? function (task, s, note) {
                TK_vSetStatus(task, s, note, realAdmin);
              }
            : null
        }
      />
    );
  };

  var tasksBody;
  if (list.loading && !list.tasks.length) tasksBody = <TK_vSkeletonRows count={5} />;
  else if (list.error && !list.tasks.length) tasksBody = <TK_vErrorState onRetry={list.reload} />;
  else if (!glance.open) {
    tasksBody = (
      <div className="tk-empty">
        <p>{self ? "You have no open tasks." : "No open tasks you can see."}</p>
      </div>
    );
  } else {
    tasksBody = (
      <div className="tk-groups">
        {sections.map(function (g) {
          if (!g.tasks.length) return null;
          var gid = "tkp-group-" + g.key;
          return (
            <section key={g.key} className={"tk-group tkp-group tkp-group-" + g.key} aria-labelledby={gid}>
              <h3 className="tk-group-head" id={gid}>
                <span className="tk-group-btn">
                  <span className="tk-group-name">{g.label}</span>
                  <span className="tk-count">{g.tasks.length}</span>
                </span>
              </h3>
              <ul className="tk-rows" role="grid" aria-label={g.label}>
                {g.tasks.map(rowFor)}
              </ul>
            </section>
          );
        })}
      </div>
    );
  }

  var personLink = function (email, label) {
    return (
      <TKP_PersonLink email={email} className="tkp-person">
        <TK_vAvatar name={label} email={email} size="sm" decorative />
        <span className="tkp-person-name">{label}</span>
      </TKP_PersonLink>
    );
  };

  var outText = "";
  if (out) {
    var range = typeof CV_range === "function" ? CV_range(out.row) : TKP__fmt(out.row.starts_on) + " to " + TKP__fmt(out.row.ends_on);
    outText = (out.now ? "Out now, " : "Out ") + range;
  }


  // ---- Profile 2 (TK_ProfileEdit.jsx): card, own edits, order --------------
  var p2 = typeof TKP2_useCard === "function" ? TKP2_useCard(person.email, !!self) : null;
  var card = p2 ? p2.card : null;
  var canEdit = !!(p2 && p2.canEdit);
  var save = p2 ? p2.save : null;
  var now = typeof TKP2_useMinute === "function" ? TKP2_useMinute() : Date.now();
  var myZone = typeof TKP2_useMyZone === "function" ? TKP2_useMyZone(me) : null;
  var teamsList = typeof TKP2_useTeams === "function" ? TKP2_useTeams(!!(card && card.teams && card.teams.length), 0) : null;
  var arrangePair = React.useState(false);
  var arranging = arrangePair[0];
  var setArranging = arrangePair[1];
  var order = card ? TKP2_visibleSections(card.section_order, card.hidden_sections, !!self) : ["header", "glance", "load", "tasks", "covers", "collab", "recent", "shoutouts"];

  var header = (
    <header className="tk-head tkp-head" key="header">
      <div className="tkp-id">
        <TK_vAvatar name={person.name || person.email} email={person.email} className="tkp-avatar" decorative />
        <div className="tkp-id-text">
          <h2 className="tk-head-name tkp-name">{person.name || person.email.split("@")[0]}</h2>
          <div className="tkp-meta">
            <span className="pill neutral">{typeof TK_vRoleLabel === "function" ? TK_vRoleLabel(person.role) : person.role}</span>
            {extras.title ? <span className="tkp-title">{extras.title}</span> : null}
            {outText ? <span className={"pill tkp-out" + (out.now ? " is-now" : "")}>{outText}</span> : null}
          </div>
          {card ? <TKP2_HeaderExtras card={card} self={!!self} canEdit={canEdit} save={save} now={now} myZone={myZone} teamsList={teamsList} dir={dir} /> : null}
          {realAdmin && extras.lastSeen ? <p className="tkp-line tkp-muted">Last seen {TKP__ago(extras.lastSeen)}</p> : null}
        </div>
      </div>
      {canEdit || (staffRow && staffRow.id && TK_isUuid(staffRow.id)) ? (
        <div className="tk-head-actions">
          {canEdit ? (
            <button
              type="button"
              className="btn-secondary"
              data-tour="tkp-customize"
              onClick={function () {
                setArranging(true);
              }}
            >
              Customize
            </button>
          ) : null}
          {staffRow && staffRow.id && TK_isUuid(staffRow.id) ? (
            <a
              className="btn-secondary"
              href={TK_formatRoute({ view: "person", staffId: staffRow.id })}
              onClick={function (e) {
                if (!TK_vPlainClick(e)) return;
                e.preventDefault();
                TK_navigate({ view: "person", staffId: staffRow.id });
              }}
            >
              Open full list
            </a>
          ) : null}
        </div>
      ) : null}
    </header>
  );

  var glanceNode = (
    <section className="tkp-glance" aria-label="This week at a glance" key="glance">
      <h3 className="tk-sr">This week at a glance</h3>
      <div className="tkp-tile">
        <span className="tkp-num">{glance.open}</span>
        <span className="tkp-lbl">Open</span>
      </div>
      <div className="tkp-tile">
        <span className="tkp-num">{glance.week}</span>
        <span className="tkp-lbl">Due this week</span>
      </div>
      <div className="tkp-tile">
        <span className="tkp-num">{glance.late}</span>
        <span className="tkp-lbl">Late</span>
      </div>
      <div className="tkp-tile">
        <span className="tkp-num">{glance.waiting}</span>
        <span className="tkp-lbl">Waiting on client</span>
      </div>
    </section>
  );

  // Someone else's out-of-office card: their time off and backups (read-only).
  var oooOther = null;
  if (!self && (outText || (backup && (backup.email || backup.unset)))) {
    oooOther = (
      <section className="card tkp-card tkp2-ooo" aria-labelledby="tkp2-ooo-other-title" key="ooo">
        <h3 className="card-title" id="tkp2-ooo-other-title">
          Out of office
        </h3>
        {outText ? <p className="tkp-line">{outText}</p> : <p className="tkp-line tkp-muted">No time off in the next 30 days.</p>}
        {out && out.row.note ? <p className="tkp-line tkp-out-note">{out.row.note}</p> : null}
        {backup && backup.email ? (
          <p className="tkp-line">
            Backup while out: <b>{TKP__nameOf(dir, backup.email)}</b>{" "}
            <span className="tkp-muted">
              ({backup.count} of {backup.total} client{backup.total === 1 ? "" : "s"}
              {backup.unset ? ", " + backup.unset + " with no backup" : ""})
            </span>
          </p>
        ) : backup && backup.unset ? (
          <p className="tkp-line tkp-muted">No backup set for their clients you can see.</p>
        ) : null}
        {realAdmin ? (
          <p className="tkp-line">
            <a className="link-btn" href="#/team/people">
              Manage in Team › Who's out
            </a>
          </p>
        ) : null}
      </section>
    );
  }

  var nodeFor = function (k) {
    if (k === "header") return header;
    if (k === "glance") return glanceNode;
    if (k === "load") {
      // Profile 2 "load" section (TK_Workload.jsx): your own load and next 4
      // weeks on your profile; Team load for admins and account managers.
      return typeof TK_ProfileLoad === "function" ? <TK_ProfileLoad key="load" me={me} email={person.email} self={!!self} isAdmin={realAdmin} /> : null;
    }
    if (k === "tasks") {
      return (
        <div className="tkp2-tasks" key="tasks" data-section="tasks">
          <h3 className="tkp-h">{self ? "Your tasks" : "Their tasks"}</h3>
          {!self && !realAdmin ? <p className="tkp-muted tkp-note">Only tasks you can already see are listed.</p> : null}
          {tasksBody}
        </div>
      );
    }
    if (!card) return null;
    if (k === "pins") return <TKP2_PinsSection key="pins" card={card} canEdit={canEdit} save={save} clients={clients} projects={projects} />;
    if (k === "org") return <TKP2_OrgSection key="org" card={card} self={!!self} realAdmin={realAdmin} dir={dir} teamsList={teamsList} />;
    if (k === "focus") return <TKP2_FocusSection key="focus" card={card} canEdit={canEdit} save={save} now={now} />;
    if (k === "about") return <TKP2_AboutSection key="about" card={card} canEdit={canEdit} save={save} />;
    if (k === "favorites") return <TKP2_FavoritesSection key="favorites" card={card} canEdit={canEdit} save={save} clients={clients} />;
    if (k === "defaultview") return self ? <TKP2_DefaultViewSection key="defaultview" me={me} canEdit={canEdit} /> : null;
    if (k === "ooo") return self ? (canEdit ? <TKP2_OooSelf key="ooo" me={me} staffUser={staffUser} clients={clients} dir={dir} canEdit={canEdit} /> : null) : oooOther;
    if (k === "covers") {
      return (
        <section className="card tkp-card" key="covers" data-section="covers">
          <h3 className="card-title">Clients they cover</h3>
          {covered.length ? (
            <ul className="tkp-list">
              {covered.map(function (c) {
                return (
                  <li key={c.id}>
                    <a
                      href={TK_formatRoute({ view: "client", clientId: c.id })}
                      onClick={function (e) {
                        if (!TK_vPlainClick(e)) return;
                        e.preventDefault();
                        TK_navigate({ view: "client", clientId: c.id });
                      }}
                    >
                      {c.name || "Client"}
                    </a>
                    <span className="tkp-muted"> · {c.roles.join(", ")}</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="card-subtitle">{realAdmin ? "No clients assigned." : "None of your clients."}</p>
          )}
        </section>
      );
    }
    if (k === "collab") {
      return (
        <section className="card tkp-card" key="collab" data-section="collab">
          <h3 className="card-title">Works most with</h3>
          {extras.loading ? (
            <p className="card-subtitle">Loading…</p>
          ) : collabs.length ? (
            <ul className="tkp-list tkp-people">
              {collabs.map(function (c) {
                return (
                  <li key={c.email}>
                    {personLink(c.email, TKP__nameOf(dir, c.email))}
                    <span className="tkp-muted">
                      {" "}
                      · {c.count} task{c.count === 1 ? "" : "s"}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="card-subtitle">Nobody yet.</p>
          )}
        </section>
      );
    }
    if (k === "recent") {
      return (
        <section className="card tkp-card" key="recent" data-section="recent">
          <h3 className="card-title">Recent work</h3>
          {extras.loading ? (
            <p className="card-subtitle">Loading…</p>
          ) : recent.clients.length || recent.projects.length ? (
            <ul className="tkp-list">
              {recent.clients.map(function (c) {
                return (
                  <li key={"c" + c.id}>
                    <a
                      href={TK_formatRoute({ view: "client", clientId: c.id })}
                      onClick={function (e) {
                        if (!TK_vPlainClick(e)) return;
                        e.preventDefault();
                        TK_navigate({ view: "client", clientId: c.id });
                      }}
                    >
                      {c.name}
                    </a>
                    <span className="tkp-muted"> · client</span>
                  </li>
                );
              })}
              {recent.projects.map(function (p) {
                return (
                  <li key={"p" + p.id}>
                    <a
                      href={TK_formatRoute({ view: "project", projectId: p.id })}
                      onClick={function (e) {
                        if (!TK_vPlainClick(e)) return;
                        e.preventDefault();
                        TK_navigate({ view: "project", projectId: p.id });
                      }}
                    >
                      {p.name}
                    </a>
                    <span className="tkp-muted"> · project</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="card-subtitle">Nothing in the last 90 days that you can see.</p>
          )}
        </section>
      );
    }
    if (k === "shoutouts") {
      return (
        <section className="card tkp-card" key="shoutouts" data-section="shoutouts">
          <h3 className="card-title">Shout-outs</h3>
          {so.loading && !shouts.length ? (
            <p className="card-subtitle">Loading…</p>
          ) : shouts.length ? (
            <ul className="tkp-list tkp-shouts">
              {shouts.map(function (r) {
                var tag = r.client_id != null && clientNames[String(r.client_id)] ? clientNames[String(r.client_id)] : "";
                return (
                  <li key={r.id}>
                    <div className="tkp-shout-head">
                      {personLink(r.from_email, TKP__nameOf(dir, r.from_email))}
                      {tag ? <span className="pill so-client">{tag}</span> : null}
                      <span className="tkp-muted tkp-when">{TKP__ago(r.created_at)}</span>
                    </div>
                    <p className="tkp-shout-body">{r.body}</p>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="card-subtitle">None in the last 90 days.</p>
          )}
        </section>
      );
    }
    return null;
  };

  // Columns: header, pins, glance and load across the top; tasks and focus in
  // the main column; everything else in the side column. Order is kept within
  // each column (on a phone it is one column in the same order).
  var TOP = { header: 1, pins: 1, glance: 1, load: 1 };
  var MAIN = { tasks: 1, focus: 1 };
  var top = [];
  var main = [];
  var side = [];
  order.forEach(function (k) {
    var n = nodeFor(k);
    if (!n) return;
    if (TOP[k]) top.push(n);
    else if (MAIN[k]) main.push(n);
    else side.push(n);
  });

  return (
    <div className="tk-view tkp-profile" data-tour="tkp-profile">
      {top}
      <div className="tkp-grid">
        <div className="tkp-main">{main}</div>
        {side.length ? (
          <aside className="tkp-side" aria-label="About this person">
            {side}
          </aside>
        ) : null}
      </div>
      {arranging && canEdit && card ? (
        <TKP2_ArrangeDialog
          card={card}
          save={save}
          onClose={function () {
            setArranging(false);
          }}
        />
      ) : null}
    </div>
  );
}
