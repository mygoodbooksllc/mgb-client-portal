// Client health board (owner request 2026-10-07). Staff only.
//
// Reads the shared client_health() cache from ClientHealth.jsx (HL_useHealth),
// so scores match the picker dot and the Client overview card. The server
// decides what each viewer gets: bookkeepers only see clients they can
// access and never the admin-only reasons (margin, hours budget).
//
//   HLB_AtRiskBody  Today card "Clients at risk": red and amber clients from
//                   the list the viewer already sees (bookkeepers: theirs).
//   HLB_useDirectory  Names, assignee and backup per client, for the Clients
//                   list (ClientsPage.jsx).
//
// The Team page's sortable health grid (HLB_HealthTab) retired with the staff
// navigation redesign (2026-10-08): the Clients list shows every client's
// score, band and bookkeeper, with "Needs attention" doing the filtering.

const HLB_BAND_ORDER = { red: 0, amber: 1, green: 2 };

function HLB_clientHref(id) {
  return "#/client/" + encodeURIComponent(id) + "/overview";
}

// Names, assignee and backup per client. Reads them itself rather than taking
// props (RLS: staff see the clients they can access; admins all).
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
          {isAdmin && (
            <a
              href="#/clients"
              onClick={(e) => {
                if (typeof NAV_go !== "function") return;
                e.preventDefault();
                NAV_go("clients");
              }}
            >
              Open the Clients list
            </a>
          )}
        </p>
      )}
    </div>
  );
}
