// Client health board (owner request 2026-10-07). Staff only.
//
// Reads the shared client_health() cache from ClientHealth.jsx (HL_useHealth),
// so scores match the picker dot and the Client overview card. The server
// decides what each viewer gets: bookkeepers only see clients they can
// access and never the admin-only reasons (margin, hours budget).
//
//   HLB_HealthTab   Team -> Client health (admins): sortable grid with score,
//                   band, reasons, assignee and backup, plus filters.
//   HLB_AtRiskBody  Home card "Clients at risk": red and amber clients from
//                   the list the viewer already sees (bookkeepers: theirs).

const HLB_BAND_ORDER = { red: 0, amber: 1, green: 2 };
const HLB_REASON_LABEL = {
  overdue: "Overdue tasks",
  qbo: "QuickBooks connection",
  qbo_stale: "QuickBooks sync stale",
  inactive: "No staff time",
  close_late: "Close late",
  margin: "Margin below target",
  doc_overdue: "Overdue document requests",
  client_wait: "Client waiting on a reply",
  hours_over: "Over hours budget",
  sop: "SOP stale or thin",
};

function HLB_clientHref(id) {
  return "#/client/" + encodeURIComponent(id) + "/overview";
}

// Names, assignee and backup for the grid. Team tab has no props, so it reads
// them itself (RLS: staff see the clients they can access; admins all).
function HLB_useDirectory() {
  const [state, setState] = useState({ loading: true, clients: {}, staff: {}, error: null });
  useEffect(() => {
    let alive = true;
    const sb = window.mgbSupabase;
    if (!sb) return;
    Promise.all([
      sb.from("clients").select("id, name, assigned_bookkeeper_email, test_only"),
      sb.from("client_profile").select("client_id, backup_bookkeeper_email"),
      sb.rpc("staff_directory"),
    ]).then(([c, p, s]) => {
      if (!alive) return;
      const clients = {};
      (c.data || []).forEach((r) => {
        clients[r.id] = { id: r.id, name: r.name || r.id, assignee: String(r.assigned_bookkeeper_email || "").toLowerCase(), backup: "" };
      });
      (p.data || []).forEach((r) => {
        if (clients[r.client_id]) clients[r.client_id].backup = String(r.backup_bookkeeper_email || "").toLowerCase();
      });
      const staff = {};
      (s.data || []).forEach((r) => {
        staff[String(r.email || "").toLowerCase()] = r.name || r.email;
      });
      setState({ loading: false, clients, staff, error: c.error ? c.error.message || "Couldn't load clients." : null });
    });
    return () => {
      alive = false;
    };
  }, []);
  return state;
}

function HLB_Band({ band }) {
  return (
    <span className={"pill hlb-band hlb-band-" + band}>
      <span className="hl-dot" style={{ background: HL_COLOR[band] }} aria-hidden="true" />
      {HL_LABEL[band] || band}
    </span>
  );
}

function HLB_HealthTab() {
  const { byId, status, reload } = HL_useHealth();
  const dir = HLB_useDirectory();
  const [sort, setSort] = useState({ key: "score", dir: 1 });
  const [band, setBand] = useState("");
  const [who, setWho] = useState("");
  const [reason, setReason] = useState("");
  const [q, setQ] = useState("");

  const nameOf = (email) => (email ? dir.staff[email] || email.split("@")[0] : "");
  const rows = Object.keys(byId).map((id) => {
    const h = byId[id];
    const c = dir.clients[id] || { id, name: id, assignee: "", backup: "" };
    return { id, name: c.name, score: h.score, band: h.band, reasons: h.reasons || [], assignee: c.assignee, backup: c.backup };
  });
  const people = Array.from(new Set(rows.map((r) => r.assignee).filter(Boolean))).sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  const reasonKeys = Array.from(new Set(rows.flatMap((r) => r.reasons.map((x) => x.key))));
  const needle = q.trim().toLowerCase();
  const shown = rows
    .filter(
      (r) =>
        (!band || r.band === band) &&
        (!who || (who === "__none" ? !r.assignee : r.assignee === who || r.backup === who)) &&
        (!reason || r.reasons.some((x) => x.key === reason)) &&
        (!needle || r.name.toLowerCase().includes(needle)),
    )
    .sort((a, b) => {
      const k = sort.key;
      let d;
      if (k === "score") d = a.score - b.score;
      else if (k === "band") d = HLB_BAND_ORDER[a.band] - HLB_BAND_ORDER[b.band];
      else if (k === "reasons") d = b.reasons.length - a.reasons.length;
      else if (k === "assignee") d = nameOf(a.assignee).localeCompare(nameOf(b.assignee));
      else if (k === "backup") d = nameOf(a.backup).localeCompare(nameOf(b.backup));
      else d = a.name.localeCompare(b.name);
      return d * sort.dir || a.name.localeCompare(b.name);
    });
  const counts = { red: 0, amber: 0, green: 0 };
  rows.forEach((r) => {
    counts[r.band] = (counts[r.band] || 0) + 1;
  });

  const Th = ({ k, children }) => {
    const on = sort.key === k;
    return (
      <th aria-sort={on ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
        <button type="button" className="hlb-sort" onClick={() => setSort({ key: k, dir: on ? -sort.dir : 1 })}>
          {children}
          <span aria-hidden="true">{on ? (sort.dir === 1 ? " ▲" : " ▼") : ""}</span>
        </button>
      </th>
    );
  };

  if (status === "missing")
    return (
      <div className="card">
        <p className="card-subtitle">Client health isn't set up yet (database step pending).</p>
      </div>
    );

  return (
    <div className="hlb-page">
      <div className="card">
        <h3 className="card-title">Client health</h3>
        <p className="card-subtitle">
          Every client's score out of 100 and why points were taken off. Lowest first. Click a column to sort.{" "}
          <button type="button" className="link-btn" onClick={reload}>
            Refresh
          </button>
        </p>
        <div className="hlb-counts">
          {["red", "amber", "green"].map((b) => (
            <button
              key={b}
              type="button"
              className={"hlb-count hlb-count-" + b + (band === b ? " active" : "")}
              onClick={() => setBand(band === b ? "" : b)}
              aria-pressed={band === b}
            >
              <strong>{counts[b] || 0}</strong> {HL_LABEL[b]}
            </button>
          ))}
        </div>
        <div className="hlb-filters">
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a client" aria-label="Find a client" />
          <select value={band} onChange={(e) => setBand(e.target.value)} aria-label="Band">
            <option value="">All bands</option>
            <option value="red">At risk</option>
            <option value="amber">Watch</option>
            <option value="green">Healthy</option>
          </select>
          <select value={who} onChange={(e) => setWho(e.target.value)} aria-label="Bookkeeper">
            <option value="">Everyone</option>
            {people.map((p) => (
              <option key={p} value={p}>
                {nameOf(p)} (bookkeeper or backup)
              </option>
            ))}
            <option value="__none">No bookkeeper</option>
          </select>
          <select value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason">
            <option value="">Any reason</option>
            {reasonKeys.map((k) => (
              <option key={k} value={k}>
                {HLB_REASON_LABEL[k] || k}
              </option>
            ))}
          </select>
        </div>
        <div className="table-scroll">
          <table className="tx-table tx-table-labeled hlb-table">
            <thead>
              <tr>
                <Th k="name">Client</Th>
                <Th k="score">Score</Th>
                <Th k="band">Band</Th>
                <Th k="reasons">Reasons</Th>
                <Th k="assignee">Bookkeeper</Th>
                <Th k="backup">Backup</Th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 ? (
                <EmptyRow colSpan={6}>
                  {status === "loading" || status === "idle"
                    ? "Loading…"
                    : status === "error"
                      ? "Couldn't load client health. Try Refresh."
                      : rows.length
                        ? "No clients match these filters."
                        : "No clients yet."}
                </EmptyRow>
              ) : (
                shown.map((r) => (
                  <tr key={r.id} className={"hlb-row-" + r.band}>
                    <td data-label="Client">
                      <a href={HLB_clientHref(r.id)}>{r.name}</a>
                    </td>
                    <td data-label="Score">
                      <strong className={"hl-score hl-" + r.band}>{r.score}</strong>
                    </td>
                    <td data-label="Band">
                      <HLB_Band band={r.band} />
                    </td>
                    <td data-label="Reasons">
                      {r.reasons.length ? (
                        <ul className="hlb-reasons">
                          {r.reasons.map((x) => (
                            <li key={x.key}>
                              {x.label} <span className="negative">−{x.points}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="hlb-muted">Nothing flagged</span>
                      )}
                    </td>
                    <td data-label="Bookkeeper">{r.assignee ? nameOf(r.assignee) : <span className="hlb-muted">None</span>}</td>
                    <td data-label="Backup">{r.backup ? nameOf(r.backup) : <span className="hlb-muted">None set</span>}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <p className="hlb-muted hlb-foot">
          Showing {shown.length} of {rows.length}. Points: overdue tasks 10 each (max 30), QuickBooks 25 (stale sync 10), no staff time
          in 30 days 20, late close 20, margin below target 15, overdue document requests 5 each (max 15), client waiting over 24
          hours 10, over hours budget 10, SOP stale or under half filled 5. Margin and hours budget are admin only.
        </p>
      </div>
    </div>
  );
}

function HLB_AtRiskBody({ clients, staffUser }) {
  const { byId, status } = HL_useHealth();
  const isAdmin = staffUser && staffUser.role === "admin";
  const list = (clients || [])
    .filter((c) => byId[c.id] && byId[c.id].band !== "green")
    .map((c) => ({ id: c.id, name: c.name || c.id, ...byId[c.id] }))
    .sort((a, b) => HLB_BAND_ORDER[a.band] - HLB_BAND_ORDER[b.band] || a.score - b.score);
  const shown = list.slice(0, 6);
  if (status === "missing") return <p className="card-subtitle">Client health isn't set up yet.</p>;
  return (
    <div className="hlb-home">
      {(status === "loading" || status === "idle") && !Object.keys(byId).length && <p className="card-subtitle">Loading…</p>}
      {status === "error" && <p className="card-subtitle">Couldn't load client health.</p>}
      {status === "ready" && list.length === 0 && <p className="card-subtitle">All clear ✓ No clients at risk or on watch.</p>}
      {shown.length > 0 && (
        <ul className="hlb-home-list">
          {shown.map((c) => (
            <li key={c.id}>
              <span className={"hl-score hlb-home-score hl-" + c.band}>{c.score}</span>
              <span className="hlb-home-what">
                <a href={HLB_clientHref(c.id)}>{c.name}</a> <HLB_Band band={c.band} />
                <span className="hlb-sub">
                  {(c.reasons || [])
                    .slice()
                    .sort((x, y) => y.points - x.points)
                    .slice(0, 2)
                    .map((x) => x.label)
                    .join(" · ")}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {(list.length > shown.length || isAdmin) && (
        <p className="hlb-home-foot">
          {list.length > shown.length ? list.length - shown.length + " more. " : ""}
          {isAdmin && <a href="#/team/health">Open the health board</a>}
        </p>
      )}
    </div>
  );
}
