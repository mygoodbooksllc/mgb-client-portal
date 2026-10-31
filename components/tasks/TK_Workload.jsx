// ----------------------------------------------------------------------------
// Slate plus: the "Team load" strip on the Slate page and its one-line twin in
// the Unassigned group (docs/slateplus-workload-spec.md). Hidden preview:
// renders nothing unless TKP_useOn() (TK_slatePlus.js) is true, and then reads
// only tk_slateplus_workload() (counts) plus, for admins, the existing Team
// capacity data (TP_useCapacity in components/staff/TeamCapacity.jsx).
// Read-only: no writes anywhere. Fails soft (an error renders nothing).
//
// Shared Babel scope: top-level names carry a TKW prefix.
// ----------------------------------------------------------------------------

var TKW__cache = null; // { at, bump, me, promise }

function TKW__fetch() {
  var c = window.mgbSupabase;
  if (!c) return Promise.resolve(null);
  return Promise.resolve(c.rpc("tk_slateplus_workload")).then(
    function (res) {
      return res && !res.error ? TKW_rows(res.data) : null;
    },
    function () {
      return null;
    },
  );
}

// One fetch shared by the strip and the Unassigned line; again when the Slate
// list changes size (bump), when the signed-in person changes, and every
// TKW_TTL while mounted. bump null = the Slate list is still loading: wait.
function TKW_useWorkload(enabled, bump, me) {
  var st = React.useState(null);
  var set = st[1];
  var ready = enabled && bump != null;
  React.useEffect(
    function () {
      if (!ready) return undefined;
      var alive = true;
      var run = function (force) {
        if (force || !TKW__cache || TKW__cache.bump !== bump || TKW__cache.me !== me || Date.now() - TKW__cache.at > TKW_TTL) {
          TKW__cache = { at: Date.now(), bump: bump, me: me, promise: TKW__fetch() };
        }
        TKW__cache.promise.then(function (rows) {
          if (alive) set(rows);
        });
      };
      run(false);
      // Not forced: the strip and the Unassigned line share one refresh.
      var timer = setInterval(function () {
        if (typeof document !== "undefined" && document.hidden) return;
        run(false);
      }, TKW_TTL + 500);
      return function () {
        alive = false;
        clearInterval(timer);
      };
    },
    [ready, bump, me],
  );
  return enabled ? st[0] : null;
}

// Team capacity hours (admin only). TeamCapacity.jsx loads first, so the
// typeof answer never changes between renders (hook order stays stable).
function TKW__cap(enabled) {
  return typeof TP_useCapacity === "function" ? TP_useCapacity(enabled) : null;
}

function TKW__lsGet(k) {
  try {
    return window.localStorage.getItem(k);
  } catch (e) {
    return null;
  }
}

function TK_WorkloadStrip(props) {
  var on = TKP_useOn();
  var isAdmin = props.isAdmin === true;
  var rows = TKW_useWorkload(on, props.bump, String(props.email || "").toLowerCase());
  var cap = TKW__cap(on && isAdmin);
  var cs = React.useState(function () {
    return TKW_readCollapsed(TKW__lsGet);
  });
  var collapsed = cs[0];
  if (!on || !rows || !rows.length) return null;
  // Profile 2 (gate-on paths only): selfOnly keeps just your own chip;
  // highlightEmail marks the profiled person's chip.
  var selfOnly = props.selfOnly === true;
  var focusEm = String(props.highlightEmail || "").toLowerCase();
  if (selfOnly) {
    rows = rows.filter(function (r) {
      return r.me;
    });
    if (!rows.length) return null;
    collapsed = false;
  }
  var lateOn = TKW_lateOn(rows);
  var hoursOn = isAdmin && cap && cap.ok && cap.hoursOk && typeof TP_capFor === "function";
  var toggle = function () {
    var next = !collapsed;
    cs[1](next);
    try {
      if (next) window.localStorage.setItem(TKW_COLLAPSE_KEY, "collapsed");
      else window.localStorage.removeItem(TKW_COLLAPSE_KEY);
    } catch (e) {}
  };
  var solo = rows.length === 1;
  return (
    <section
      className={"tkw-strip" + (collapsed ? " is-collapsed" : "") + (selfOnly ? " is-self" : "")}
      aria-label={selfOnly ? "How Team load shows you" : "Team load this week"}
      data-tour={props.tour || "tkw-strip"}
    >
      {selfOnly ? (
        <h3 className="tkw-head">
          <span className="tkw-toggle tkw-static">
            <span>How Team load shows you</span>
            <span className="tkw-sub">this week</span>
          </span>
        </h3>
      ) : (
        <h3 className="tkw-head">
          <button type="button" className="tkw-toggle" aria-expanded={collapsed ? "false" : "true"} aria-controls={props.listId || "tkw-list"} onClick={toggle}>
            <TK_vIcon name="chevron" size={14} className="tk-chev" />
            <span>{solo ? "Your load" : "Team load"}</span>
            <span className="tkw-sub">this week</span>
          </button>
        </h3>
      )}
      {props.before || null}
      {collapsed ? null : (
        <ul className="tkw-list" id={props.listId || "tkw-list"}>
          {rows.map(function (r) {
            // Someone else's row opens their Slate plus profile (TK_personLink.js);
            // the strip only renders with the same gate on. Admins still get
            // their full list from the profile's "Open full list".
            // Your own chip opens your own profile too (Profile 2).
            var profileHref = r.email && typeof TKP_personHref === "function" ? TKP_personHref(r.email) : "";
            var isFocus = !!focusEm && r.email === focusEm;
            var href = profileHref || TKW_href(r, isAdmin);
            var h = hoursOn ? TP_capFor(cap, r.email) : null;
            var inner = (
              <>
                <span className="tkw-name">
                  {r.me ? "You" : r.name}
                  {h && h.status === "over" ? <span className="task-chip bad tkw-chip">Overloaded</span> : null}
                  {h && h.status === "room" ? <span className="task-chip tp-cap-room-chip tkw-chip">Has room</span> : null}
                </span>
                <span className="tkw-bar" aria-hidden="true">
                  <span className="tkw-fill" style={{ width: TKW_barPct(r, rows) + "%" }} />
                </span>
                <span className="tkw-nums">
                  <span>
                    <b>{r.week}</b> due
                  </span>
                  <span>
                    <b>{r.open}</b> open
                  </span>
                  {lateOn ? (
                    <span className={r.late ? "tkw-late" : undefined}>
                      <b>{r.late}</b> late
                    </span>
                  ) : null}
                </span>
              </>
            );
            return (
              <li key={r.email} className={"tkw-item" + (r.me ? " is-me" : "") + (isFocus ? " is-focus" : "")}>
                {href ? (
                  <a
                    className="tkw-person"
                    href={href}
                    aria-current={isFocus ? "true" : undefined}
                    title={TKW_title(r) + (profileHref ? (r.me ? ". Open your profile" : ". Open their profile") : r.me ? "" : ". Open their list")}
                  >
                    {inner}
                  </a>
                ) : (
                  <span className="tkw-person" title={TKW_title(r)}>
                    {inner}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// The Unassigned group's one line: load before you claim or assign.
function TK_WorkloadLine(props) {
  var on = TKP_useOn();
  var rows = TKW_useWorkload(on, props.bump, String(props.email || "").toLowerCase());
  var text = on && rows ? TKW_compactLine(rows) : "";
  if (!text) return null;
  return (
    <p className="tkw-line" title="Tasks due this week per person, busiest first">
      <span className="tkw-line-label">Team load this week:</span> {text}
    </p>
  );
}

// ---- Profile 2: four-week bars and the Unassigned chip (spec §3, §12.4) ------
// tk_slateplus_workload_weeks(): counts only, the strip's own visibility. One
// cached fetch (TKW_TTL) shared by every mount. A failure (RPC missing before
// the migration, or an error) renders nothing.

var TKW__weeksCache = null; // { at, me, promise }

function TKW__fetchWeeks() {
  var api = typeof TK_api !== "undefined" && TK_api && typeof TK_api.workloadWeeks === "function" ? TK_api : null;
  var p;
  if (api) p = Promise.resolve().then(function () { return api.workloadWeeks(); });
  else {
    var c = window.mgbSupabase;
    if (!c) return Promise.resolve(null);
    p = Promise.resolve(c.rpc("tk_slateplus_workload_weeks")).then(function (res) {
      if (!res || res.error) throw new Error("weeks");
      return res.data;
    });
  }
  return p.then(
    function (raw) {
      var pivot = TKW_weekRows(raw);
      return pivot.weeks.length ? pivot : null;
    },
    function () {
      return null;
    },
  );
}

function TKW_useWeeks(enabled, me) {
  var st = React.useState(null);
  var set = st[1];
  React.useEffect(
    function () {
      if (!enabled) return undefined;
      var alive = true;
      var run = function () {
        if (!TKW__weeksCache || TKW__weeksCache.me !== me || Date.now() - TKW__weeksCache.at > TKW_TTL) {
          TKW__weeksCache = { at: Date.now(), me: me, promise: TKW__fetchWeeks() };
        }
        TKW__weeksCache.promise.then(function (pivot) {
          if (alive) set(pivot);
        });
      };
      run();
      var timer = setInterval(function () {
        if (typeof document !== "undefined" && document.hidden) return;
        run();
      }, TKW_TTL + 500);
      return function () {
        alive = false;
        clearInterval(timer);
      };
    },
    [enabled, me],
  );
  return enabled ? st[0] : null;
}

// props: { email, isAdmin, highlightEmail, selfOnly, title }
function TK_WorkloadWeeks(props) {
  var on = TKP_useOn();
  var me = String(props.email || "").toLowerCase();
  var pivot = TKW_useWeeks(on, me);
  var isAdmin = props.isAdmin === true;
  var cap = TKW__cap(on && isAdmin);
  if (!on || !pivot) return null;
  var selfOnly = props.selfOnly === true;
  var focusEm = String(props.highlightEmail || "").toLowerCase();
  var people = selfOnly
    ? pivot.people.filter(function (r) {
        return r.me;
      })
    : pivot.people;
  var rows = (selfOnly || !pivot.unassigned ? [] : [pivot.unassigned]).concat(people);
  if (!people.length) return null;
  var labels = TKW_weekLabels(pivot.weeks);
  var scale = selfOnly ? { people: people, unassigned: null } : pivot;
  var hoursOn = isAdmin && cap && cap.ok && cap.hoursOk && typeof TP_capFor === "function";
  var title = props.title || (selfOnly ? "Your next 4 weeks" : "Next 4 weeks");
  return (
    <section className={"tkw-weeks" + (selfOnly ? " is-self" : "")} aria-label={title} data-tour={props.tour || undefined}>
      <h3 className="tkw-weeks-head">
        {title}
        <span className="tkw-sub">tasks due each week</span>
      </h3>
      <div className="tkw-weeks-scroll">
        <table className="tkw-weeks-table">
          <thead>
            <tr>
              <th scope="col" className="tkw-wk-name">
                <span className="tk-sr">Person</span>
              </th>
              {labels.map(function (l, i) {
                return (
                  <th scope="col" key={pivot.weeks[i]} title={"Week of " + pivot.weeks[i]}>
                    {l}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map(function (r) {
              var key = r.unassigned ? "~unassigned" : r.email;
              var isFocus = !!focusEm && r.email === focusEm;
              var h = hoursOn && !r.unassigned ? TP_capFor(cap, r.email) : null;
              var label = r.unassigned ? "Unassigned" : r.me ? "You" : r.name;
              var href = r.unassigned ? "#/tasks/my" : typeof TKP_personHref === "function" ? TKP_personHref(r.email) : "";
              return (
                <tr key={key} className={"tkw-wk-row" + (r.unassigned ? " is-unassigned" : "") + (r.me ? " is-me" : "") + (isFocus ? " is-focus" : "")} aria-current={isFocus ? "true" : undefined}>
                  <th scope="row" className="tkw-wk-name">
                    {href ? (
                      <a href={href} title={r.unassigned ? "Open the Unassigned group in Slate" : r.me ? "Open your profile" : "Open " + r.name + "'s profile"}>
                        {label}
                      </a>
                    ) : (
                      label
                    )}
                  </th>
                  {r.cells.map(function (n, i) {
                    return (
                      <td key={i} className="tkw-wk-cell">
                        <span className="tkw-bar" aria-hidden="true">
                          <span className="tkw-fill" style={{ width: TKW_weekPct(n, scale) + "%" }} />
                        </span>
                        <span className="tkw-wk-num">
                          <b>{n}</b>
                          <span className="tk-sr"> due</span>
                        </span>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// Team › People: "Unassigned: N open · N due this week", linking to Slate's
// Unassigned group. Only tasks the viewer can read (server rule).
function TK_WorkloadUnassigned(props) {
  var on = TKP_useOn();
  var pivot = TKW_useWeeks(on, String(props.email || "").toLowerCase());
  if (!on || !pivot || !pivot.unassigned) return null;
  return (
    <a className="tkw-unassigned task-chip" href="#/tasks/my" title="Open the Unassigned group in Slate">
      {TKW_unassignedText(pivot.unassigned)}
    </a>
  );
}

// The profile's "load" section (spec §3, §4.3 key `load`).
//   Own profile: "How Team load shows you" (own chip, hours for admins) and
//   "Your next 4 weeks" (own row).
//   Someone else's: "Team load" with their chip and row highlighted, only
//   when the RPC returned more than one row (that is exactly admins and
//   account managers; the server decides, no client-side role rule).
// props: { me, email, self, isAdmin }
function TK_ProfileLoad(props) {
  var on = TKP_useOn();
  var me = String(props.me || "").toLowerCase();
  var rows = TKW_useWorkload(on, 0, me);
  if (!on || !rows || !rows.length) return null;
  var focus = String(props.email || "").toLowerCase();
  if (props.self) {
    return (
      <section className="tkp-load is-self" aria-label="Your load" data-tour="tkp-load">
        <TK_WorkloadStrip isAdmin={props.isAdmin} bump={0} email={me} selfOnly listId="tkw-list-self" tour="tkp-load-strip" />
        <TK_WorkloadWeeks isAdmin={props.isAdmin} email={me} selfOnly />
      </section>
    );
  }
  if (rows.length < 2) return null;
  var listed = rows.some(function (r) {
    return r.email === focus;
  });
  return (
    <section className="tkp-load" aria-label="Team load" data-tour="tkp-load">
      <TK_WorkloadStrip isAdmin={props.isAdmin} bump={0} email={me} highlightEmail={listed ? focus : ""} listId="tkw-list-profile" tour="tkp-load-strip" />
      <TK_WorkloadWeeks isAdmin={props.isAdmin} email={me} highlightEmail={listed ? focus : ""} title="Next 4 weeks" />
    </section>
  );
}
