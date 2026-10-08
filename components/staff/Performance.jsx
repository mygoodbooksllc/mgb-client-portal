// components/staff/Performance.jsx — Team › Performance.
//
// Admins see every bookkeeper scored 0–100 and ranked over the last 30 or
// 90 days, with the inputs behind each score one click away. Bookkeepers see
// their own score and inputs, never the ranking. Every number comes from one
// RPC, staff_performance(p_days), in
// supabase/staff-celebrations-performance.sql; the weights come back with
// the rows so this file never hard-codes them.

const PF_SIGNALS = [
  {
    key: "reply",
    label: "Replies within goal",
    pct: (r) => r.reply_pct,
    detail: (r) => (r.replies ? `${r.replies} client repl${r.replies === 1 ? "y" : "ies"} measured` : "No client replies in this period"),
  },
  {
    key: "close",
    label: "Month-ends closed on time",
    pct: (r) => r.close_pct,
    detail: (r) => (r.close_total ? `${r.close_done} of ${r.close_total} closed by the late day` : "No month-ends came due in this period"),
  },
  {
    key: "health",
    label: "Health of assigned clients",
    pct: (r) => r.health_pct,
    detail: (r) => (r.health_n ? `Average across ${r.health_n} client${r.health_n === 1 ? "" : "s"}${r.health_red ? ` · ${r.health_red} red` : ""}` : "No assigned clients"),
  },
  {
    key: "tasks",
    label: "Tasks and deadlines",
    pct: (r) => r.tasks_pct,
    detail: (r) => `${r.tasks_done} task${r.tasks_done === 1 ? "" : "s"} done · ${r.tasks_overdue} overdue · ${r.deadlines_on_time} of ${r.deadlines_total} filings on time`,
  },
  {
    key: "hours",
    label: "Hours vs capacity",
    pct: (r) => r.hours_pct,
    detail: (r) => (Number(r.hours) > 0 ? `${r.hours} h logged against ${r.capacity_hours} h of capacity` : "No hours logged in this period"),
  },
  {
    key: "review",
    label: "Latest quarterly review",
    pct: (r) => r.review_pct,
    detail: (r) => (r.review_label ? `Manager total from the ${r.review_label} review` : "No signed manager review yet"),
  },
];
const PF_DEFAULT_WEIGHTS = { reply: 25, close: 25, health: 20, tasks: 15, hours: 10, review: 5 };

function PF_num(v) {
  return v == null || v === "" ? null : Math.round(Number(v));
}
function PF_tone(n) {
  return n == null ? "none" : n >= 80 ? "good" : n >= 60 ? "ok" : "low";
}

function PF_usePerformance(days) {
  const [st, setSt] = React.useState({ loading: true, rows: [], error: "" });
  React.useEffect(() => {
    const sb = window.mgbSupabase;
    if (!sb || typeof sb.rpc !== "function") {
      setSt({ loading: false, rows: [], error: "Scores need a connection to the server." });
      return;
    }
    let alive = true;
    setSt((s) => ({ ...s, loading: true, error: "" }));
    sb.rpc("staff_performance", { p_days: days }).then(({ data, error }) => {
      if (!alive) return;
      if (error) {
        const setup = typeof isMissingTableError === "function" && isMissingTableError(error);
        setSt({ loading: false, rows: [], error: setup ? "Run supabase/staff-celebrations-performance.sql to turn this on." : error.message });
      } else {
        setSt({ loading: false, rows: Array.isArray(data) ? data : [], error: "" });
      }
    });
    return () => {
      alive = false;
    };
  }, [days]);
  return st;
}

function PF_Score({ value, big }) {
  const n = PF_num(value);
  return (
    <span className={"pf-score pf-" + PF_tone(n) + (big ? " pf-score-big" : "")} aria-label={n == null ? "No score yet" : `Score ${n} out of 100`}>
      {n == null ? "—" : n}
    </span>
  );
}

function PF_Inputs({ row, weights }) {
  return (
    <ul className="pf-inputs">
      {PF_SIGNALS.map((s) => {
        const n = PF_num(s.pct(row));
        const w = weights[s.key];
        return (
          <li key={s.key} className={"pf-input" + (n == null ? " pf-input-none" : "")}>
            <span className="pf-input-label">
              {s.label} <span className="pf-weight">· {w}% of the score</span>
            </span>
            <span className={"pf-pct pf-" + PF_tone(n)}>{n == null ? "no data" : n + "%"}</span>
            <span className="pf-bar" aria-hidden="true">
              <span style={{ width: (n == null ? 0 : n) + "%" }} />
            </span>
            <span className="pf-input-detail">{s.detail(row)}</span>
          </li>
        );
      })}
    </ul>
  );
}

function PF_How({ open, onToggle, weights, days }) {
  return (
    <div className="pf-how">
      <button type="button" className="link-btn" aria-expanded={open} onClick={onToggle}>
        {open ? "Hide how it's scored" : "How it's scored"}
      </button>
      {open && (
        <div className="pf-how-body">
          <p className="card-subtitle">
            Each signal is a percentage for the last {days} days. The score is the weighted average of the signals that have data, so a
            signal with nothing to measure (no month-ends due, no review yet) is left out rather than counted as zero.
          </p>
          <ul className="pf-how-list">
            <li>
              <b>Replies within goal ({weights.reply}%)</b> — share of client replies sent inside the firm's reply-time goal (Team › Reply
              times).
            </li>
            <li>
              <b>Month-ends closed on time ({weights.close}%)</b> — months whose late day fell in the period, closed (done or N/A) by that
              day.
            </li>
            <li>
              <b>Health of assigned clients ({weights.health}%)</b> — average client health score (Clients › Health) across their
              assigned clients.
            </li>
            <li>
              <b>Tasks and deadlines ({weights.tasks}%)</b> — tasks finished plus filings made on time, over those plus overdue tasks.
            </li>
            <li>
              <b>Hours vs capacity ({weights.hours}%)</b> — how close logged hours (QuickBooks time, else time entries) came to their
              weekly target × weeks in the period. 100 means right on target; over or under both cost points.
            </li>
            <li>
              <b>Latest quarterly review ({weights.review}%)</b> — the manager's total from their most recent signed review, out of 30.
            </li>
          </ul>
          <p className="card-subtitle">A score is a conversation starter, not a verdict. Open the details and look at the inputs before acting on it.</p>
        </div>
      )}
    </div>
  );
}

function PF_PerformanceTab({ staffUser, isAdmin }) {
  const admin = !!isAdmin;
  const me = String((staffUser && staffUser.email) || "").toLowerCase();
  const [days, setDays] = React.useState(30);
  const [openRow, setOpenRow] = React.useState("");
  const [how, setHow] = React.useState(false);
  const st = PF_usePerformance(days);
  const weights = { ...PF_DEFAULT_WEIGHTS, ...((st.rows[0] && st.rows[0].weights) || {}) };
  const mine = st.rows.find((r) => r.email === me) || null;

  const period = (
    <div className="pf-seg" role="group" aria-label="Period">
      {[30, 90].map((d) => (
        <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)}>
          Last {d} days
        </button>
      ))}
    </div>
  );
  const status = st.error ? (
    <p className="card-subtitle">{st.error}</p>
  ) : st.loading ? (
    <p className="card-subtitle">Loading…</p>
  ) : null;

  if (!admin) {
    return (
      <section className="card tp-people-card pf-card" aria-labelledby="pf-title">
        <div className="pf-head">
          <div>
            <h3 className="card-title" id="pf-title">
              Your performance
            </h3>
            <p className="card-subtitle">How your work adds up, scored 0–100 from the signals below. Admins see the same inputs.</p>
          </div>
          {period}
        </div>
        {status ||
          (!mine ? (
            <p className="card-subtitle">No score yet. Scores start once you have assigned clients.</p>
          ) : (
            <div className="pf-mine">
              <PF_Score value={mine.score} big />
              <PF_Inputs row={mine} weights={weights} />
            </div>
          ))}
        <PF_How open={how} onToggle={() => setHow(!how)} weights={weights} days={days} />
      </section>
    );
  }

  return (
    <section className="card tp-people-card pf-card" aria-labelledby="pf-title">
      <div className="pf-head">
        <div>
          <h3 className="card-title" id="pf-title">
            Bookkeeper performance
          </h3>
          <p className="card-subtitle">Every bookkeeper scored 0–100 and ranked. Open a row to see the inputs behind the score.</p>
        </div>
        {period}
      </div>
      {status ||
        (st.rows.length === 0 ? (
          <p className="card-subtitle">No bookkeepers to score yet. Assign clients to a bookkeeper and scores start from their work.</p>
        ) : (
          <div className="table-scroll">
            <table className="tx-table tx-table-labeled pf-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Bookkeeper</th>
                  <th className="num">Clients</th>
                  <th className="num">Score</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {st.rows.map((r) => {
                  const open = openRow === r.email;
                  return (
                    <React.Fragment key={r.email}>
                      <tr className={open ? "pf-open" : ""}>
                        <td data-label="Rank">{r.rank != null && r.score != null ? r.rank : "—"}</td>
                        <td data-primary="">
                          {r.name}
                          {r.email !== me && <span className="pf-email">{r.email}</span>}
                        </td>
                        <td data-label="Clients" className="num">
                          {r.clients}
                        </td>
                        <td data-label="Score" className="num">
                          <PF_Score value={r.score} />
                        </td>
                        <td>
                          <button type="button" className="link-btn" aria-expanded={open} onClick={() => setOpenRow(open ? "" : r.email)}>
                            {open ? "Hide" : "Details"}
                          </button>
                        </td>
                      </tr>
                      {open && (
                        <tr className="pf-detail">
                          <td colSpan={5}>
                            <PF_Inputs row={r} weights={weights} />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      <PF_How open={how} onToggle={() => setHow(!how)} weights={weights} days={days} />
    </section>
  );
}
