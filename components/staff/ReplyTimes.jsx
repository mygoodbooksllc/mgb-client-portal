// Reply-time tracker (owner request 2026-10-07). Staff only.
//
// Numbers come from the client_reply_times(p_from, p_to) RPC
// (supabase/client-reply-times.sql): a wait starts at the first client
// message of an unanswered run in a thread (client + participant) and ends at
// the next staff reply. Internal notes and deleted messages don't count. The
// goal is OPS_REPLY_GOAL_HOURS (24 calendar hours, staffOpsLogic.js).
//
// Shown as the Team hub tab "Reply times" (RT_ReplyTimesTab, admins see
// everyone) and the Home KPI tile "kpi-reply" (RT_useMyReply, your own
// median this month). Bookkeepers only ever get their own row and their own
// clients back from the RPC.

const RT_cache = {}; // "from|to" -> { data, error, promise }

function RT_load(from, to, force) {
  const sb = window.mgbSupabase;
  if (!sb) return Promise.resolve({ data: null, error: "Not signed in." });
  const key = from + "|" + to;
  const hit = RT_cache[key];
  if (!force && hit) return hit.promise || Promise.resolve(hit);
  const entry = { data: null, error: null, promise: null };
  RT_cache[key] = entry;
  entry.promise = sb.rpc("client_reply_times", { p_from: from, p_to: to }).then(
    (r) => {
      entry.promise = null;
      if (r.error) {
        entry.error =
          r.error.code === "PGRST202" || /client_reply_times/.test(r.error.message || "")
            ? "Reply times aren't set up yet (database step pending)."
            : r.error.message || "Couldn't load reply times.";
      } else entry.data = r.data || null;
      return entry;
    },
    (e) => {
      entry.promise = null;
      entry.error = (e && e.message) || "Couldn't load reply times.";
      return entry;
    },
  );
  return entry.promise;
}

// { loading, data, error }. Refreshes on STAFF_TOOLS_EVENT.
function RT_useReplyTimes(from, to, enabled) {
  const key = from + "|" + to;
  const [state, setState] = useState(() => {
    const hit = RT_cache[key];
    return hit && !hit.promise ? { loading: false, data: hit.data, error: hit.error } : { loading: true, data: null, error: null };
  });
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const run = (force) =>
      RT_load(from, to, force).then((e) => alive && setState({ loading: false, data: e.data, error: e.error }));
    const hit = RT_cache[key];
    if (!hit || hit.promise) setState((s) => ({ ...s, loading: true }));
    run(false);
    const onChange = () => run(true);
    window.addEventListener(STAFF_TOOLS_EVENT, onChange);
    return () => {
      alive = false;
      window.removeEventListener(STAFF_TOOLS_EVENT, onChange);
    };
  }, [key, enabled]);
  return state;
}

// Home KPI: the viewer's own median this month plus open waits over the
// goal (their clients; firm-wide for admins).
function RT_useMyReply(email, enabled) {
  const r = OPS_replyPeriod("month", todayLocal());
  const st = RT_useReplyTimes(r.from, r.to, enabled);
  if (!enabled) return null;
  const me = String(email || "").toLowerCase();
  const d = st.data;
  const row = d && (d.by_staff || []).find((s) => String(s.email || "").toLowerCase() === me);
  return {
    loading: st.loading,
    error: st.error,
    median: row ? row.median_h : null,
    replies: row ? row.replies : 0,
    openOver: d ? (d.open || []).length : 0,
  };
}

const RT_PERIODS = [
  { key: "month", label: "This month" },
  { key: "last-month", label: "Last month" },
  { key: "90", label: "Last 90 days" },
];

const RT_pct = (v) => (v == null ? "—" : Math.round(Number(v)) + "%");
const RT_clientHref = (id) => "#/client/" + encodeURIComponent(id) + "/messages";

function RT_Kpi({ label, value, sub, tone }) {
  return (
    <div className={"card kpi-card rt-kpi" + (tone ? " rt-kpi-" + tone : "")}>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      {sub && <span className="kpi-sub">{sub}</span>}
    </div>
  );
}

function RT_ReplyTimesTab() {
  const ctx = useContext(StaffToolsContext) || {};
  const me = ctx.staffUser || {};
  const isAdmin = me.role === "admin";
  const [period, setPeriod] = useState("month");
  const range = OPS_replyPeriod(period, todayLocal());
  const st = RT_useReplyTimes(range.from, range.to, true);
  const d = st.data;
  const goal = (d && d.goal_hours) || OPS_REPLY_GOAL_HOURS;
  const o = (d && d.overall) || {};
  const byStaff = (d && d.by_staff) || [];
  const byClient = (d && d.by_client) || [];
  const open = (d && d.open) || [];
  const rangeLabel = fmtDate(range.from) + " – " + fmtDate(range.to);

  return (
    <div className="rt-page">
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="modal-tabs" style={{ marginTop: 0 }}>
          {RT_PERIODS.map((p) => (
            <button
              key={p.key}
              type="button"
              className={"modal-tab" + (period === p.key ? " active" : "")}
              onClick={() => setPeriod(p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <p className="card-subtitle" style={{ margin: "12px 0 0" }}>
          {rangeLabel} · Goal: a reply within {goal} hours (calendar hours, nights and weekends count).
          {!isAdmin && " Showing your own replies and your clients only."}
        </p>
        {st.error && (
          <div className="mock-banner" style={{ marginTop: 16, marginBottom: 0 }}>
            <WarningIcon />
            <span>{st.error}</span>
          </div>
        )}
      </div>

      <div className="kpi-grid rt-kpis">
        <RT_Kpi label="Median reply" value={st.loading ? "…" : OPS_fmtWait(o.median_h)} sub={o.replied ? `${o.replied} repl${o.replied === 1 ? "y" : "ies"}` : "no replies yet"} />
        <RT_Kpi label="Slowest 10% (p90)" value={st.loading ? "…" : OPS_fmtWait(o.p90_h)} sub="9 in 10 replies are faster" />
        <RT_Kpi
          label={`Within ${goal} h`}
          value={st.loading ? "…" : RT_pct(o.pct_under_goal)}
          sub={o.waits ? `of ${o.replied || 0} answered` : "nothing to measure"}
          tone={o.pct_under_goal != null && o.pct_under_goal < 80 ? "warn" : null}
        />
        <RT_Kpi
          label={`Waiting over ${goal} h`}
          value={st.loading ? "…" : open.length}
          sub={open.length ? "right now, any period" : "nobody waiting ✓"}
          tone={open.length ? "bad" : "good"}
        />
      </div>

      {open.length > 0 && (
        <div className="card rt-open" style={{ marginBottom: 20 }}>
          <h3 className="card-title">Waiting for a reply now</h3>
          <p className="card-subtitle">Client messages with no staff reply for more than {goal} hours, oldest first.</p>
          <ul className="rt-open-list">
            {open.map((w, i) => (
              <li key={w.client_id + "|" + w.participant_email + "|" + i}>
                <a href={RT_clientHref(w.client_id)} className="rt-open-client">
                  {w.client_name || w.client_id}
                </a>
                <span className="rt-muted">{w.participant_email}</span>
                <span className="pill rt-pill-bad">waiting {OPS_fmtWait(w.hours)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 className="card-title">By staff member</h3>
        <p className="card-subtitle">Credited to whoever sent the reply.</p>
        <div className="table-scroll">
          <table className="tx-table tx-table-labeled rt-table">
            <thead>
              <tr>
                <th>Name</th>
                <th className="num">Replies</th>
                <th className="num">Median</th>
                <th className="num">p90</th>
                <th className="num">Within {goal} h</th>
              </tr>
            </thead>
            <tbody>
              {st.loading ? (
                <EmptyRow colSpan={5}>Loading…</EmptyRow>
              ) : byStaff.length === 0 ? (
                <EmptyRow colSpan={5}>No replies to client messages in this period yet.</EmptyRow>
              ) : (
                byStaff.map((s) => (
                  <tr key={s.email}>
                    <td data-label="Name">{s.name || s.email}</td>
                    <td data-label="Replies" className="num">{s.replies}</td>
                    <td data-label="Median" className="num">{OPS_fmtWait(s.median_h)}</td>
                    <td data-label="p90" className="num">{OPS_fmtWait(s.p90_h)}</td>
                    <td data-label={`Within ${goal} h`} className="num">{RT_pct(s.pct_under_goal)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3 className="card-title">By client</h3>
        <p className="card-subtitle">Slowest first. Waiting counts any open wait over {goal} hours.</p>
        <div className="table-scroll">
          <table className="tx-table tx-table-labeled rt-table">
            <thead>
              <tr>
                <th>Client</th>
                <th className="num">Waits</th>
                <th className="num">Median</th>
                <th className="num">p90</th>
                <th className="num">Within {goal} h</th>
                <th className="num">Waiting</th>
              </tr>
            </thead>
            <tbody>
              {st.loading ? (
                <EmptyRow colSpan={6}>Loading…</EmptyRow>
              ) : byClient.length === 0 ? (
                <EmptyRow colSpan={6}>No client messages in this period yet.</EmptyRow>
              ) : (
                byClient.map((c) => (
                  <tr key={c.client_id}>
                    <td data-label="Client">
                      <a href={RT_clientHref(c.client_id)}>{c.client_name || c.client_id}</a>
                    </td>
                    <td data-label="Waits" className="num">{c.waits}</td>
                    <td data-label="Median" className="num">{OPS_fmtWait(c.median_h)}</td>
                    <td data-label="p90" className="num">{OPS_fmtWait(c.p90_h)}</td>
                    <td data-label={`Within ${goal} h`} className="num">{RT_pct(c.pct_under_goal)}</td>
                    <td data-label="Waiting" className="num">
                      {c.open_over_goal > 0 ? <span className="pill rt-pill-bad">{c.open_over_goal}</span> : "0"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
