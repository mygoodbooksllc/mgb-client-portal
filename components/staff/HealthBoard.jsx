// Client health board (owner request 2026-10-07). Staff only.
//
// Reads the shared client_health() cache from ClientHealth.jsx (HL_useHealth),
// so scores match the picker dot and the Client overview card. The server
// decides what each viewer gets: bookkeepers only see clients they can
// access and never the admin-only reasons (margin, hours budget).
//
//   HLB_BAND_ORDER    red < amber < green, for sorting (Today's at-risk rows).
//   HLB_clientHref    Link to a client's overview.
//   HLB_useDirectory  Names, assignee and backup per client, for the Clients
//                   list (ClientsPage.jsx).
//
// The Team page's sortable health grid and the Home "Clients at risk" card
// retired with the staff navigation redesign (2026-10-08): the Clients list
// shows every client's score, band and bookkeeper, "Needs attention" does the
// filtering, and Today lists red and amber clients in Needs you.

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
