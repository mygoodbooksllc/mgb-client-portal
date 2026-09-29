// Audit log (supabase/audit-log.sql). Admin page + client-side event helpers.
// Top-level names use the AL_ prefix (shared Babel global scope). React hooks
// come from app.jsx line 1's destructure, so they're used as React.* here.

const AL_PAGE_SIZE = 50;
const AL_CSV_MAX = 10000;

// Human labels for action codes. Unknown codes fall back to the raw code.
const AL_ACTIONS = {
  "client_access.assigned": "Client assigned",
  "client_access.unassigned": "Client unassigned",
  "access_grant.requested": "Access requested",
  "access_grant.approved": "Access approved",
  "access_grant.denied": "Access denied",
  "access_grant.revoked": "Access revoked",
  "access_grant.cancelled": "Access request cancelled",
  "access_grant.deleted": "Access grant deleted",
  "staff.added": "Staff added",
  "staff.removed": "Staff removed",
  "staff.role_changed": "Role changed",
  "staff.activated": "Staff activated",
  "staff.deactivated": "Staff deactivated",
  "staff.offboarded": "Staff offboarded",
  "client_fee.set": "Client fee set",
  "client_fee.changed": "Client fee changed",
  "client_fee.removed": "Client fee removed",
  "cost_rate.set": "Cost rate set",
  "cost_rate.changed": "Cost rate changed",
  "cost_rate.removed": "Cost rate removed",
  "profitability.target_changed": "Target margin changed",
  "qbo_customer_map.insert": "QuickBooks customer mapped",
  "qbo_customer_map.update": "QuickBooks customer mapping changed",
  "qbo_customer_map.delete": "QuickBooks customer mapping removed",
  "qbo_employee_map.insert": "QuickBooks employee mapped",
  "qbo_employee_map.update": "QuickBooks employee mapping changed",
  "qbo_employee_map.delete": "QuickBooks employee mapping removed",
  "qbo_firm.connected": "Firm QuickBooks connected",
  "qbo_firm.disconnected": "Firm QuickBooks disconnected",
  "qbo_firm.status_changed": "Firm QuickBooks status changed",
  "client.created": "Client created",
  "client.deleted": "Client deleted",
  "client.plan_changed": "Plan changed",
  "client.tier_changed": "Tier changed",
  "client.updated": "Client settings changed",
  "view_as.start": "View as started",
  "view_as.stop": "View as ended",
  "portal_preview.start": "Portal preview started",
  "portal_preview.stop": "Portal preview ended",
};

// Action filter groups: value is a PostgREST "like" prefix.
const AL_ACTION_GROUPS = [
  { value: "", label: "All actions" },
  { value: "client_access.", label: "Client assignments" },
  { value: "access_grant.", label: "Temporary access" },
  { value: "staff.", label: "Staff changes" },
  { value: "client_fee.", label: "Client fees" },
  { value: "cost_rate.", label: "Cost rates" },
  { value: "profitability.", label: "Profitability settings" },
  { value: "qbo_", label: "QuickBooks" },
  { value: "client.", label: "Clients" },
  { value: "view_as.", label: "View as" },
  { value: "portal_preview.", label: "Portal preview" },
];

function AL_actionLabel(a) {
  return AL_ACTIONS[a] || a;
}

function AL_money(v) {
  if (v == null || v === "") return "none";
  const n = Number(v);
  return Number.isFinite(n) ? "$" + n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : String(v);
}

// One-line plain-English summary of the details object.
function AL_summary(row) {
  const d = row.details || {};
  const a = row.action || "";
  if (a === "staff.role_changed") return `${d.from || "?"} → ${d.to || "?"}`;
  if (a === "staff.offboarded") {
    const bits = [];
    if (d.clients_reassigned) bits.push(`${d.clients_reassigned} client${d.clients_reassigned === 1 ? "" : "s"} reassigned`);
    if (d.clients_unassigned && d.clients_unassigned !== d.clients_reassigned)
      bits.push(`${d.clients_unassigned - (d.clients_reassigned || 0)} unassigned`);
    if (d.tasks_moved) bits.push(`${d.tasks_moved} task${d.tasks_moved === 1 ? "" : "s"} moved`);
    if (d.grants_revoked) bits.push(`${d.grants_revoked} access revoked`);
    if (d.grants_cancelled) bits.push(`${d.grants_cancelled} request${d.grants_cancelled === 1 ? "" : "s"} cancelled`);
    return bits.join(", ") || "Nothing to move";
  }
  if (a.startsWith("client_fee.")) return `${AL_money(d.from)} → ${AL_money(d.to)}`;
  if (a.startsWith("cost_rate.")) return `${AL_money(d.from)} → ${AL_money(d.to)}/h from ${d.effective_from || "?"}`;
  if (a === "profitability.target_changed") return `${d.from ?? "?"}% → ${d.to ?? "?"}%`;
  if (a === "client.plan_changed" || a === "client.tier_changed") return `${d.from ?? "none"} → ${d.to ?? "none"}`;
  if (a === "client.created" || a === "client.deleted") return [d.name, d.plan].filter(Boolean).join(" · ");
  if (a === "access_grant.requested") return [d.days ? `${d.days} day${d.days === 1 ? "" : "s"}` : "", d.reason].filter(Boolean).join(" · ");
  if (a.startsWith("qbo_customer_map.")) {
    if (d.ignored) return `${d.customer || ""} ignored`;
    return `${d.customer || ""}: ${d.from_client || "none"} → ${d.to_client || "none"}`;
  }
  if (a.startsWith("qbo_employee_map.")) {
    if (d.ignored) return `${d.name || ""} ignored`;
    return `${d.name || ""}: ${d.from_staff || "none"} → ${d.to_staff || "none"}`;
  }
  if (a.startsWith("qbo_firm.")) return [d.company, d.from && d.to ? `${d.from} → ${d.to}` : "", d.error].filter(Boolean).join(" · ");
  if (a.startsWith("view_as.") || a.startsWith("portal_preview.")) return d.name || d.target || "";
  return "";
}

function AL_clientName(id, clients) {
  if (!id) return "";
  const list = clients || (typeof window !== "undefined" && window.CLIENTS) || [];
  const c = list.find((x) => x.id === id);
  return (c && c.name) || id;
}

function AL_fmtWhen(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

// ---------------------------------------------------------------------------
// Client-side events. Fire-and-forget: a failed log never blocks the UI.
// ---------------------------------------------------------------------------
function AL_logEvent(action, clientId, details) {
  const supabase = window.mgbSupabase;
  if (!supabase) return;
  try {
    Promise.resolve(
      supabase.rpc("log_audit_event", {
        p_action: action,
        p_client_id: clientId || null,
        p_details: details || {},
      }),
    ).then(
      (r) => r && r.error && console.warn("Audit log:", r.error.message),
      (e) => console.warn("Audit log:", e && e.message),
    );
  } catch (e) {
    console.warn("Audit log:", e && e.message);
  }
}

// Logs portal_preview.start / .stop as the staff member's "preview as"
// target changes. Pass nulls when not previewing.
function AL_usePortalPreviewLog(clientId, target, name) {
  const prev = React.useRef(null);
  const key = clientId && target ? clientId + "\u0000" + target : null;
  React.useEffect(() => {
    const was = prev.current;
    if (was && was.key === key) return undefined;
    if (was) AL_logEvent("portal_preview.stop", was.clientId, { target: was.target, name: was.name });
    prev.current = key ? { key, clientId, target, name } : null;
    if (key) AL_logEvent("portal_preview.start", clientId, { target, name: name || undefined });
    return undefined;
  }, [key]);
  React.useEffect(
    () => () => {
      const was = prev.current;
      if (was) AL_logEvent("portal_preview.stop", was.clientId, { target: was.target, name: was.name });
    },
    [],
  );
}

// ---------------------------------------------------------------------------
// Admin page
// ---------------------------------------------------------------------------
function AL_applyFilters(q, f) {
  if (f.actor) q = q.eq("actor_email", f.actor);
  if (f.client) q = q.eq("client_id", f.client);
  if (f.action) q = q.like("action", f.action + "%");
  if (f.from) q = q.gte("at", new Date(f.from + "T00:00:00").toISOString());
  if (f.to) {
    const end = new Date(f.to + "T00:00:00");
    end.setDate(end.getDate() + 1);
    q = q.lt("at", end.toISOString());
  }
  const s = (f.search || "").trim().replace(/[%,()*\\]/g, " ").trim();
  if (s) {
    const p = `*${s}*`;
    q = q.or(
      [
        `action.ilike.${p}`,
        `actor_email.ilike.${p}`,
        `client_id.ilike.${p}`,
        `target_id.ilike.${p}`,
        `target_type.ilike.${p}`,
      ].join(","),
    );
  }
  return q;
}

function AL_csvCell(v) {
  const s = v == null ? "" : String(v);
  // Neutralise spreadsheet formula injection as well as quoting.
  const safe = /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function AL_AuditLogPage({ clients }) {
  const supabase = window.mgbSupabase;
  const showToast = typeof useToast === "function" ? useToast() : () => {};
  const blank = { actor: "", client: "", action: "", from: "", to: "", search: "" };
  const [filters, setFilters] = React.useState(blank);
  const [searchDraft, setSearchDraft] = React.useState("");
  const [page, setPage] = React.useState(0);
  const [state, setState] = React.useState({ loading: true, rows: [], count: 0, error: null });
  const [people, setPeople] = React.useState([]);
  const [exporting, setExporting] = React.useState(false);
  const [openId, setOpenId] = React.useState(null);

  // Debounce the search box.
  React.useEffect(() => {
    const t = setTimeout(() => {
      setFilters((f) => (f.search === searchDraft ? f : { ...f, search: searchDraft }));
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [searchDraft]);

  React.useEffect(() => {
    if (!supabase) return;
    supabase
      .from("staff")
      .select("email, name")
      .order("name")
      .then(({ data }) => setPeople(data || []));
  }, [supabase]);

  React.useEffect(() => {
    if (!supabase) {
      setState({ loading: false, rows: [], count: 0, error: "Supabase isn't configured." });
      return undefined;
    }
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    const q = AL_applyFilters(
      supabase.from("audit_log").select("*", { count: "exact" }),
      filters,
    )
      .order("at", { ascending: false })
      .order("id", { ascending: false })
      .range(page * AL_PAGE_SIZE, page * AL_PAGE_SIZE + AL_PAGE_SIZE - 1);
    Promise.resolve(q).then(
      ({ data, error, count }) => {
        if (!alive) return;
        if (error) {
          const missing = /audit_log/.test(error.message || "") && /exist|schema cache/i.test(error.message || "");
          setState({
            loading: false, rows: [], count: 0,
            error: missing ? "The audit log table isn't set up yet (supabase/audit-log.sql)." : error.message,
          });
          return;
        }
        setState({ loading: false, rows: data || [], count: count || 0, error: null });
      },
      (e) => alive && setState({ loading: false, rows: [], count: 0, error: (e && e.message) || "Couldn't load." }),
    );
    return () => {
      alive = false;
    };
  }, [supabase, filters, page]);

  const set = (k) => (e) => {
    const v = e.target.value;
    setFilters((f) => ({ ...f, [k]: v }));
    setPage(0);
  };

  const nameByEmail = React.useMemo(() => {
    const m = {};
    people.forEach((p) => {
      m[p.email] = p.name;
    });
    return m;
  }, [people]);

  const clientList = clients && clients.length ? clients : window.CLIENTS || [];
  const who = (email) => (email === "system" ? "System" : nameByEmail[email] || email);
  const target = (r) => {
    if (!r.target_id) return "";
    if (r.target_type === "staff") return who(r.target_id);
    if (r.target_type === "client") return AL_clientName(r.target_id, clientList);
    return r.target_id;
  };

  async function exportCsv() {
    if (!supabase) return;
    setExporting(true);
    try {
      const all = [];
      for (let off = 0; off < AL_CSV_MAX; off += 1000) {
        const { data, error } = await AL_applyFilters(supabase.from("audit_log").select("*"), filters)
          .order("at", { ascending: false })
          .order("id", { ascending: false })
          .range(off, off + 999);
        if (error) throw error;
        all.push(...(data || []));
        if (!data || data.length < 1000) break;
      }
      const head = ["When (UTC)", "Person", "Action", "Client", "Target type", "Target", "Summary", "Details"];
      const lines = [head.join(",")].concat(
        all.map((r) =>
          [
            r.at, r.actor_email, AL_actionLabel(r.action), AL_clientName(r.client_id, clientList),
            r.target_type, r.target_id, AL_summary(r), JSON.stringify(r.details || {}),
          ].map(AL_csvCell).join(","),
        ),
      );
      const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      if (all.length >= AL_CSV_MAX) showToast(`Exported the newest ${AL_CSV_MAX.toLocaleString()} rows. Narrow the filters for older ones.`);
    } catch (e) {
      showToast("Couldn't export: " + ((e && e.message) || "unknown error"));
    } finally {
      setExporting(false);
    }
  }

  const pages = Math.max(1, Math.ceil(state.count / AL_PAGE_SIZE));
  const firstRow = state.count ? page * AL_PAGE_SIZE + 1 : 0;
  const lastRow = Math.min(state.count, (page + 1) * AL_PAGE_SIZE);
  const filtered = Object.keys(blank).some((k) => filters[k]);

  return (
    <div className="al-page">
      <div className="card">
        <div className="al-head">
          <div style={{ minWidth: 0 }}>
            <h3 className="card-title" style={{ margin: 0 }}>Audit log</h3>
            <p className="card-subtitle" style={{ margin: "4px 0 0" }}>
              Who changed access, fees, rates, mappings and client settings, and when. Written by the
              database, so nobody can edit or delete entries.
            </p>
          </div>
          <button
            type="button"
            className="btn-secondary al-export"
            onClick={exportCsv}
            disabled={exporting || !state.count}
          >
            {exporting ? "Exporting…" : "Export CSV"}
          </button>
        </div>

        <div className="al-filters">
          <label className="al-field al-field-search">
            <span>Search</span>
            <input
              type="search"
              value={searchDraft}
              placeholder="Email, client id, action…"
              onChange={(e) => setSearchDraft(e.target.value)}
            />
          </label>
          <label className="al-field">
            <span>Person</span>
            <select value={filters.actor} onChange={set("actor")}>
              <option value="">Everyone</option>
              <option value="system">System</option>
              {people.map((p) => (
                <option key={p.email} value={p.email}>{p.name || p.email}</option>
              ))}
            </select>
          </label>
          <label className="al-field">
            <span>Client</span>
            <select value={filters.client} onChange={set("client")}>
              <option value="">All clients</option>
              {clientList.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <label className="al-field">
            <span>Action</span>
            <select value={filters.action} onChange={set("action")}>
              {AL_ACTION_GROUPS.map((g) => (
                <option key={g.value} value={g.value}>{g.label}</option>
              ))}
            </select>
          </label>
          <label className="al-field">
            <span>From</span>
            <input type="date" value={filters.from} max={filters.to || undefined} onChange={set("from")} />
          </label>
          <label className="al-field">
            <span>To</span>
            <input type="date" value={filters.to} min={filters.from || undefined} onChange={set("to")} />
          </label>
          {filtered && (
            <button
              type="button"
              className="link-btn al-clear"
              onClick={() => {
                setFilters(blank);
                setSearchDraft("");
                setPage(0);
              }}
            >
              Clear filters
            </button>
          )}
        </div>

        {state.error && <p className="al-error" role="alert">{state.error}</p>}

        {!state.error && (
          <div className="al-table-wrap">
            <table className="tx-table tx-table-labeled al-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Person</th>
                  <th>Action</th>
                  <th>Client</th>
                  <th>Target</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {state.loading && !state.rows.length && (
                  <tr><td colSpan={6} className="table-empty-cell">Loading…</td></tr>
                )}
                {!state.loading && !state.rows.length && (
                  <tr><td colSpan={6} className="table-empty-cell">{filtered ? "Nothing matches these filters." : "Nothing logged yet."}</td></tr>
                )}
                {state.rows.map((r) => {
                  const open = openId === r.id;
                  return (
                    <React.Fragment key={r.id}>
                      <tr className={"al-row" + (open ? " open" : "")}>
                        <td data-label="When" className="al-when">{AL_fmtWhen(r.at)}</td>
                        <td data-label="Person">{who(r.actor_email)}</td>
                        <td data-label="Action">
                          <span className={"al-action al-action-" + String(r.action).split(".")[0]}>
                            {AL_actionLabel(r.action)}
                          </span>
                        </td>
                        <td data-label="Client">{AL_clientName(r.client_id, clientList) || <span className="al-dim">—</span>}</td>
                        <td data-label="Target">{target(r) || <span className="al-dim">—</span>}</td>
                        <td data-label="Details" className="al-details">
                          <span>{AL_summary(r)}</span>
                          {r.details && Object.keys(r.details).length > 0 && (
                            <button
                              type="button"
                              className="link-btn al-raw-toggle"
                              aria-expanded={open}
                              onClick={() => setOpenId(open ? null : r.id)}
                            >
                              {open ? "Hide" : "Raw"}
                            </button>
                          )}
                        </td>
                      </tr>
                      {open && (
                        <tr className="al-raw-row">
                          <td colSpan={6}>
                            <pre className="al-raw">{JSON.stringify(r.details, null, 2)}</pre>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!state.error && state.count > 0 && (
          <div className="al-pager">
            <span className="al-dim">
              {firstRow.toLocaleString()}–{lastRow.toLocaleString()} of {state.count.toLocaleString()}
            </span>
            <div className="al-pager-btns">
              <button type="button" className="btn-secondary" disabled={page === 0 || state.loading} onClick={() => setPage((p) => p - 1)}>
                Newer
              </button>
              <span className="al-dim">Page {page + 1} of {pages}</span>
              <button type="button" className="btn-secondary" disabled={page + 1 >= pages || state.loading} onClick={() => setPage((p) => p + 1)}>
                Older
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
