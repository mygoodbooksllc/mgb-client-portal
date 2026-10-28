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
    <section className={"tkw-strip" + (collapsed ? " is-collapsed" : "")} aria-label="Team load this week" data-tour="tkw-strip">
      <h3 className="tkw-head">
        <button type="button" className="tkw-toggle" aria-expanded={collapsed ? "false" : "true"} aria-controls="tkw-list" onClick={toggle}>
          <TK_vIcon name="chevron" size={14} className="tk-chev" />
          <span>{solo ? "Your load" : "Team load"}</span>
          <span className="tkw-sub">this week</span>
        </button>
      </h3>
      {collapsed ? null : (
        <ul className="tkw-list" id="tkw-list">
          {rows.map(function (r) {
            // Someone else's row opens their Slate plus profile (TK_personLink.js);
            // the strip only renders with the same gate on. Admins still get
            // their full list from the profile's "Open full list".
            var profileHref = !r.me && r.email && typeof TKP_personHref === "function" ? TKP_personHref(r.email) : "";
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
                  {h && h.weekMin != null ? (
                    <span title={"QuickBooks Time this week against a " + h.target + " h weekly target"}>
                      <b>{typeof TP_fmtHM === "function" ? TP_fmtHM(h.weekMin) : Math.round(h.weekMin / 60)}</b> / {h.target} h
                    </span>
                  ) : null}
                </span>
              </>
            );
            return (
              <li key={r.email} className={"tkw-item" + (r.me ? " is-me" : "")}>
                {href ? (
                  <a className="tkw-person" href={href} title={TKW_title(r) + (r.me ? "" : profileHref ? ". Open their profile" : ". Open their list")}>
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
