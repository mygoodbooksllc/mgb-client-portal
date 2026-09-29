// ----------------------------------------------------------------------------
// Capacity and workload balancer (owner request 2026-09-29). ADMIN-ONLY.
//
// staff_capacity (supabase/staff-capacity.sql) holds each person's weekly
// target hours (default 35 when there's no row). Hours come from QuickBooks
// Time via qbo_hours_by_staff, the same RPC as the People table:
//   - this week (Monday start) so far
//   - the last 4 full weeks, averaged per week
// Utilisation = 4-week average / target: under 70% "has room", 70–100% OK,
// over 100% overloaded. The weekly digest agent reads staff_capacity too, so
// keep the table and column names.
//
// Used by the Team page (TP_CapacityCard) and by Staff Access in app.jsx
// (TP_WorkloadHint, next to each person where admins assign clients).
// Everything fails soft: for a non-admin the RPC is refused and the hint
// renders nothing.
//
// Loaded before app.jsx in the shared Babel scope: every top-level name has a
// TP_CAP_ / TP_ prefix and no React hook is redeclared.
// ----------------------------------------------------------------------------

const TP_CAP_DEFAULT = 35;
const TP_CAP_ROOM = 0.7;
const TP_CAP_TTL = 60000;

function TP_capWeeks() {
  const now = new Date();
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
  const from4 = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 28);
  const to4 = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 1);
  return {
    week: { from: TP_ymd(monday), to: TP_ymd(sunday) },
    last4: { from: TP_ymd(from4), to: TP_ymd(to4) },
  };
}

// "room" | "ok" | "over" | null (no target or no hours data).
function TP_capStatus(util) {
  if (util == null || !isFinite(util)) return null;
  if (util < TP_CAP_ROOM) return "room";
  if (util <= 1) return "ok";
  return "over";
}
const TP_CAP_LABEL = { room: "Has room", ok: "OK", over: "Overloaded" };

// One shared fetch for every hint on the page (Staff Access renders one per
// row), refreshed after TP_CAP_TTL or when a target is saved.
let TP_capCache = null; // { at, promise }
const TP_CAP_EVENT = "mgb-capacity-changed";

async function TP_capFetch() {
  const supabase = window.mgbSupabase;
  if (!supabase) return { ok: false, reason: "none" };
  const w = TP_capWeeks();
  const safe = (p) =>
    Promise.resolve(p).then(
      (r) => r,
      (e) => ({ data: null, error: e }),
    );
  const [cap, wk, l4, acc] = await Promise.all([
    safe(supabase.from("staff_capacity").select("staff_email, weekly_target_hours")),
    safe(supabase.rpc("qbo_hours_by_staff", { p_from: w.week.from, p_to: w.week.to })),
    safe(supabase.rpc("qbo_hours_by_staff", { p_from: w.last4.from, p_to: w.last4.to })),
    safe(supabase.from("staff_client_access").select("staff_email, client_id")),
  ]);
  const capMissing = cap.error && TP_qErrorKind(cap.error, cap.status) === "missing";
  if (cap.error && !capMissing) return { ok: false, reason: TP_qErrorKind(cap.error, cap.status) || "other" };
  const hoursOk = !wk.error && !l4.error;
  const targets = {};
  ((!cap.error && cap.data) || []).forEach((r) => {
    targets[TP_lower(r.staff_email)] = Number(r.weekly_target_hours);
  });
  const mins = (res) => {
    const m = {};
    ((res && res.data) || []).forEach((r) => {
      if (r.bucket === "staff" && r.staff_email) m[TP_lower(r.staff_email)] = Number(r.total_minutes || 0);
    });
    return m;
  };
  const clients = {};
  ((!acc.error && acc.data) || []).forEach((r) => {
    const k = TP_lower(r.staff_email);
    (clients[k] = clients[k] || new Set()).add(r.client_id);
  });
  return {
    ok: true,
    capMissing: !!capMissing,
    hoursOk,
    hoursKind: hoursOk ? null : TP_qErrorKind(wk.error || l4.error, (wk.error ? wk : l4).status),
    targets,
    week: mins(wk),
    last4: mins(l4),
    clientCounts: Object.fromEntries(Object.entries(clients).map(([k, v]) => [k, v.size])),
    weeks: w,
  };
}

function TP_useCapacity(enabled) {
  const [state, setState] = useState(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    const run = (force) => {
      if (force || !TP_capCache || Date.now() - TP_capCache.at > TP_CAP_TTL) {
        TP_capCache = { at: Date.now(), promise: TP_capFetch() };
      }
      TP_capCache.promise.then((r) => alive && setState(r));
    };
    run(false);
    const onChange = () => run(false);
    window.addEventListener(TP_CAP_EVENT, onChange);
    return () => {
      alive = false;
      window.removeEventListener(TP_CAP_EVENT, onChange);
    };
  }, [enabled]);
  return state;
}

function TP_capInvalidate() {
  TP_capCache = null;
  try {
    window.dispatchEvent(new Event(TP_CAP_EVENT));
  } catch (e) {}
}

// Per-person numbers from a loaded capacity state.
function TP_capFor(cap, email, noHours) {
  const e = TP_lower(email);
  const target = cap && cap.targets[e] != null ? cap.targets[e] : TP_CAP_DEFAULT;
  if (!cap || !cap.hoursOk || noHours) return { target, weekMin: null, avgMin: null, util: null, weekUtil: null, status: null };
  const weekMin = cap.week[e] || 0;
  const avgMin = (cap.last4[e] || 0) / 4;
  const util = target > 0 ? avgMin / 60 / target : null;
  const weekUtil = target > 0 ? weekMin / 60 / target : null;
  return { target, weekMin, avgMin, util, weekUtil, status: TP_capStatus(util) };
}

function TP_UtilBar({ util, label }) {
  const status = TP_capStatus(util);
  if (!status) return <span className="tp-muted">–</span>;
  const pct = Math.round(util * 100);
  return (
    <span className="tp-cap-util" title={`${pct}% of weekly target (4-week average): ${TP_CAP_LABEL[status]}`}>
      <span className="tp-cap-track" aria-hidden="true">
        <span className={"tp-cap-fill tp-cap-" + status} style={{ width: `${Math.min(100, pct)}%` }} />
        <span className="tp-cap-mark" style={{ left: "70%" }} />
      </span>
      <span className={"tp-cap-pct tp-cap-text-" + status}>
        {pct}%{label !== false ? ` · ${TP_CAP_LABEL[status]}` : ""}
      </span>
    </span>
  );
}

function TP_CapTarget({ email, target, explicit }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const save = async () => {
    const n = Number(draft);
    if (draft === "" || !isFinite(n) || n < 0 || n > 100) {
      setErr("0 to 100");
      return;
    }
    setSaving(true);
    setErr(null);
    let res;
    try {
      res = await window.mgbSupabase
        .from("staff_capacity")
        .upsert({ staff_email: TP_lower(email), weekly_target_hours: n, updated_at: new Date().toISOString() }, { onConflict: "staff_email" });
    } catch (e) {
      res = { error: e };
    }
    setSaving(false);
    if (res.error) {
      setErr("Couldn't save");
      return;
    }
    setEditing(false);
    TP_capInvalidate();
  };
  if (editing) {
    return (
      <span className="pf-inline-form tp-cap-edit" onClick={(e) => e.stopPropagation()}>
        <input
          type="number"
          min="0"
          max="100"
          step="1"
          value={draft}
          aria-label="Weekly target hours"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") setEditing(false);
          }}
        />
        <button type="button" className="btn-primary pf-btn" onClick={save} disabled={saving}>
          {saving ? "…" : "Save"}
        </button>
        <button type="button" className="btn-secondary pf-btn" onClick={() => setEditing(false)}>
          Cancel
        </button>
        {err && <span className="tp-bad">{err}</span>}
      </span>
    );
  }
  return (
    <span>
      {target} h
      {!explicit && <span className="tp-muted" title="No target set: using the default"> (default)</span>}{" "}
      <button
        type="button"
        className="tp-q-link"
        onClick={(e) => {
          e.stopPropagation();
          setDraft(String(target));
          setEditing(true);
        }}
      >
        Edit
      </button>
    </span>
  );
}

// Team page card: each person against their weekly target.
function TP_CapacityCard({ people, qboOn, onOpenPerson }) {
  const cap = TP_useCapacity(true);
  const rows = useMemo(() => {
    if (!people) return null;
    return people
      .map((p) => ({ ...p, c: TP_capFor(cap, p.email, !qboOn) }))
      .sort((a, b) => (b.c.util == null ? -1 : b.c.util) - (a.c.util == null ? -1 : a.c.util) || a.name.localeCompare(b.name));
  }, [people, cap, qboOn]);
  const cols = 8;
  const note = !cap
    ? null
    : !cap.ok
      ? cap.reason === "auth"
        ? "Capacity is only visible to admins."
        : "Couldn't load capacity."
      : cap.capMissing
        ? "Weekly targets aren't set up on the server yet, so everyone uses 35 h."
        : !qboOn || !cap.hoursOk
          ? "QuickBooks Time isn't connected, so there are no hours to compare with targets yet."
          : null;
  const counts = { room: 0, ok: 0, over: 0 };
  (rows || []).forEach((r) => r.c.status && counts[r.c.status]++);
  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <h3 className="card-title">Capacity</h3>
      <p className="card-subtitle">
        QuickBooks Time hours this week so far and the average of the last 4 full weeks, against each person's weekly
        target. Utilisation uses the 4-week average: under 70% has room, over 100% is overloaded.
        {qboOn && cap && cap.ok && cap.hoursOk && (counts.room || counts.over) ? (
          <>
            {" "}
            <b>
              {counts.room} with room, {counts.over} overloaded.
            </b>
          </>
        ) : null}
      </p>
      {note && <p className="tp-muted" style={{ margin: "0 0 10px" }}>{note}</p>}
      <div className="table-scroll">
        <table className="tx-table tx-table-labeled tp-table tp-cap-table">
          <thead>
            <tr>
              <th>Name</th>
              <th className="num">Target / wk</th>
              <th className="num">This week</th>
              <th className="num">Avg / wk (4 wks)</th>
              <th>Utilisation</th>
              <th className="num">Clients</th>
              <th className="num">Open</th>
              <th className="num">Overdue</th>
            </tr>
          </thead>
          <tbody>
            {rows == null || cap == null ? (
              <EmptyRow colSpan={cols}>Loading…</EmptyRow>
            ) : rows.length === 0 ? (
              <EmptyRow colSpan={cols}>No staff to show.</EmptyRow>
            ) : (
              rows.map((p) => (
                <tr
                  key={p.email}
                  className="tp-row"
                  tabIndex={0}
                  onClick={() => onOpenPerson && onOpenPerson(p.email)}
                  onKeyDown={(e) => {
                    if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                      e.preventDefault();
                      onOpenPerson && onOpenPerson(p.email);
                    }
                  }}
                >
                  <td data-primary="">
                    <span className="tp-name">{p.name}</span>
                    {p.role && <span className="tp-muted tp-role">{TP_roleLabel(p.role)}</span>}
                  </td>
                  <td className="num" data-label="Target / wk">
                    {cap.ok && !cap.capMissing ? (
                      <TP_CapTarget email={p.email} target={p.c.target} explicit={cap.targets[p.email] != null} />
                    ) : (
                      `${p.c.target} h`
                    )}
                  </td>
                  <td className="num" data-label="This week">
                    {p.c.weekMin == null ? (
                      "–"
                    ) : (
                      <span>
                        {TP_fmtHM(p.c.weekMin)}
                        {p.c.weekUtil != null && <span className="tp-muted"> · {Math.round(p.c.weekUtil * 100)}%</span>}
                      </span>
                    )}
                  </td>
                  <td className="num" data-label="Avg / wk (4 wks)">{p.c.avgMin == null ? "–" : TP_fmtHM(p.c.avgMin)}</td>
                  <td data-label="Utilisation">
                    <TP_UtilBar util={p.c.util} />
                  </td>
                  <td className="num" data-label="Clients">
                    {p.role === "admin" && !p.assignedCount ? <span className="tp-muted">All</span> : p.assignedCount}
                  </td>
                  <td className="num" data-label="Open">{p.open}</td>
                  <td className={"num" + (p.overdue ? " tp-bad" : "")} data-label="Overdue">{p.overdue}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Staff Access (app.jsx): utilisation, client count and a "has room" hint
// next to a person's name wherever admins assign clients. clientCount
// overrides the loaded count (the open modal passes its live selection).
function TP_WorkloadHint({ email, clientCount }) {
  const cap = TP_useCapacity(true);
  if (!cap || !cap.ok || !cap.hoursOk) {
    if (cap && cap.ok && clientCount != null) {
      return (
        <span className="tp-cap-hint">
          {clientCount} client{clientCount === 1 ? "" : "s"}
        </span>
      );
    }
    return null;
  }
  const c = TP_capFor(cap, email);
  const n = clientCount != null ? clientCount : cap.clientCounts[TP_lower(email)] || 0;
  return (
    <span className="tp-cap-hint" title={`4-week average ${TP_fmtHM(c.avgMin)} a week against a ${c.target} h target`}>
      {c.util != null ? <TP_UtilBar util={c.util} label={false} /> : null}
      <span>
        {n} client{n === 1 ? "" : "s"}
      </span>
      {c.status === "room" && <span className="task-chip tp-cap-room-chip">Has room</span>}
      {c.status === "over" && <span className="task-chip bad">Overloaded</span>}
    </span>
  );
}
