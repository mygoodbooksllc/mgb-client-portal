// Tech Inventory (owner request 2026-10-08). Team › Tech. Replaces the Apps
// Script tool. supabase/tech-inventory.sql + tech-inventory-v2.sql; export via
// supabase/functions/tech-inventory.
//
//   Staff:  request hardware, log their own items, see the standard setup.
//   Admins: Requests, Inventory, Roster, Directory and Standard setup views,
//           and Export to Google Sheet (admin-only Shared Drive).
// Nothing is deleted: requests, items and setup rows are archived and can be
// restored. Names and emails come from the portal's staff list (Members).
// Top-level names use the TI_ prefix.

const TI_SETUP_MSG = "Tech Inventory isn't set up yet (database step pending).";
const TI_STATUSES = ["Open", "Ordered", "Fulfilled", "Declined"];
const TI_CONDITIONS = ["New", "Good", "Fair", "Poor", "Broken"];
// Same rule as LAPTOP_RE in supabase/functions/tech-inventory.
const TI_LAPTOP_RE = /mac|laptop|lenovo|dell|thinkpad|chromebook|notebook|\bhp\b/i;
const TI_NOT_LAPTOP_RE = /desktop|imac|mac mini/i;
const TI_STATUS_PILL = { Open: "warm", Ordered: "neutral", Fulfilled: "good", Declined: "bad" };
const TI_COND_PILL = { New: "good", Good: "good", Fair: "warm", Poor: "bad", Broken: "bad" };

function TI_isLaptop(a) {
  const t = (a.category || "") + " " + (a.item || "");
  return TI_LAPTOP_RE.test(t) && !TI_NOT_LAPTOP_RE.test(t);
}
// An item covers a setup line when its category or name matches it, or ends
// with it ("Standing Desk" covers "Desk"). Any laptop covers a laptop line.
function TI_covers(a, item) {
  const k = String(item).toLowerCase();
  if (TI_LAPTOP_RE.test(k) && !TI_NOT_LAPTOP_RE.test(k)) return TI_isLaptop(a);
  return [a.category, a.item].some((v) => {
    const t = String(v || "").toLowerCase();
    return t === k || t.endsWith(" " + k);
  });
}
function TI_errMsg(error) {
  return typeof isMissingTableError === "function" && isMissingTableError(error) ? TI_SETUP_MSG : error.message;
}
const TI_day = (v) => (v ? new Date(v).toLocaleDateString() : "");
const TI_money = (n) => (n == null ? "" : "$" + Number(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 }));

function TI_TechTab({ staffUser, isAdmin }) {
  const sb = window.mgbSupabase;
  const me = String((staffUser && staffUser.email) || "").toLowerCase();
  const [data, setData] = React.useState({ requests: [], assets: [], setup: [], staff: [], contacts: [] });
  const [error, setError] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [view, setView] = React.useState(isAdmin ? "requests" : "mine");
  const [personFilter, setPersonFilter] = React.useState("");
  const [exporting, setExporting] = React.useState(false);
  const [sheet, setSheet] = React.useState(null);
  const toast = typeof useToast === "function" ? useToast() : null;
  const say = (m) => (typeof toast === "function" ? toast(m) : null);

  const load = React.useCallback(() => {
    if (!sb) return;
    Promise.all([
      sb.from("tech_requests").select("*").order("created_at", { ascending: false }),
      sb.from("tech_assets").select("*").order("created_at", { ascending: false }),
      sb.from("tech_setup").select("*").order("sort"),
      sb.from("staff").select("email, name, role, active").order("name"),
      isAdmin ? sb.from("staff_contact").select("*") : Promise.resolve({ data: [] }),
    ]).then(([r, a, s, st, c]) => {
      setLoading(false);
      const bad = r.error || a.error || s.error;
      if (bad) return setError(TI_errMsg(bad));
      setError(c.error ? c.error.message : null);
      setData({ requests: r.data || [], assets: a.data || [], setup: s.data || [], staff: st.data || [], contacts: c.data || [] });
    });
  }, [sb, isAdmin]);
  React.useEffect(load, [load]);

  const run = (p, okMsg) =>
    Promise.resolve(p).then(({ error }) => {
      if (error) {
        setError(error.message);
        return false;
      }
      setError(null);
      if (okMsg) say(okMsg);
      load();
      return true;
    });

  const { requests, assets, setup, staff, contacts } = data;
  const nameOf = (email) => {
    const s = staff.find((x) => String(x.email).toLowerCase() === String(email).toLowerCase());
    return (s && s.name) || email;
  };
  const activeStaff = staff.filter((s) => s.active);
  const liveAssets = assets.filter((a) => !a.archived_at);
  const liveSetup = setup.filter((s) => !s.archived_at);
  const essentials = liveSetup.filter((s) => s.essential).map((s) => s.item);
  const openReqs = requests.filter((r) => !r.archived_at && (r.status === "Open" || r.status === "Ordered"));
  const roster = activeStaff.map((s) => {
    const e = String(s.email).toLowerCase();
    const mine = liveAssets.filter((a) => String(a.staff_email).toLowerCase() === e);
    return {
      ...s,
      email: e,
      items: mine.length,
      laptop: mine.find(TI_isLaptop) || null,
      open: openReqs.filter((r) => String(r.staff_email).toLowerCase() === e).length,
      missing: essentials.filter((it) => !mine.some((a) => TI_covers(a, it))),
    };
  });
  const categories = React.useMemo(() => {
    const set = new Set(["Laptop"]);
    setup.forEach((s) => set.add(TI_LAPTOP_RE.test(s.item) ? "Laptop" : s.item));
    set.add("Other");
    return [...set];
  }, [setup]);

  if (loading) return <p className="card-subtitle">Loading…</p>;
  if (error === TI_SETUP_MSG) return <p className="card-subtitle">{error}</p>;

  async function exportSheet() {
    if (!sb || exporting) return;
    setExporting(true);
    setSheet(null);
    let body = null;
    let err = null;
    try {
      const res = await sb.functions.invoke("tech-inventory", { body: { action: "export" } });
      body = res.data;
      err = res.error;
      if (err && err.context && typeof err.context.json === "function") {
        try {
          body = await err.context.json();
          err = null;
        } catch (e) {}
      }
    } catch (e) {
      err = e;
    }
    setExporting(false);
    if (body && body.url) {
      setSheet(body);
      say("Google Sheet created");
    } else {
      setError("Export failed: " + ((body && body.message) || (err && err.message) || "unknown error"));
    }
  }

  const views = isAdmin
    ? [
        ["requests", "Requests"],
        ["inventory", "Inventory"],
        ["roster", "Roster"],
        ["directory", "Directory"],
        ["setup", "Standard setup"],
      ]
    : [
        ["mine", "My tech"],
        ["setup", "Standard setup"],
      ];
  const go = (v, person) => {
    setPersonFilter(person || "");
    setView(v);
  };
  const missingPeople = roster.filter((p) => p.missing.length > 0).length;
  const kpi = (label, value, sub, onClick) => (
    <button type="button" className="card kpi-card kpi-card-clickable" onClick={onClick}>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      <span className="kpi-sub neutral">{sub}</span>
    </button>
  );

  return (
    <div className="ti-wrap">
      {isAdmin && (
        <div className="kpi-grid ti-kpis">
          {kpi("Open requests", openReqs.length, "open or ordered", () => go("requests"))}
          {kpi("Items", liveAssets.length, `${roster.filter((p) => p.items > 0).length} of ${roster.length} people logged`, () => go("inventory"))}
          {kpi("Laptops", liveAssets.filter(TI_isLaptop).length, "in use", () => go("inventory"))}
          {kpi("Missing essentials", missingPeople, missingPeople === 1 ? "person" : "people", () => go("roster"))}
        </div>
      )}

      <div className="ti-toolbar">
        <div className="view-toggle" role="group" aria-label="Tech view">
          {views.map(([k, label]) => (
            <button key={k} type="button" className={"view-toggle-btn" + (view === k ? " active" : "")} aria-pressed={view === k} onClick={() => go(k)}>
              {label}
            </button>
          ))}
        </div>
        {isAdmin && (
          <button type="button" className="btn-secondary" onClick={exportSheet} disabled={exporting}>
            {exporting ? "Exporting…" : "Export to Google Sheet"}
          </button>
        )}
      </div>
      {sheet && (
        <p className="ti-note" role="status">
          Saved <b>{sheet.name}</b> to the admin Shared Drive.{" "}
          <a href={sheet.url} target="_blank" rel="noopener noreferrer">Open the sheet</a>
        </p>
      )}
      {error && <p className="cv-err" role="alert">{error}</p>}

      {view === "mine" && (
        <TI_MyTech me={me} requests={requests} assets={liveAssets} setup={liveSetup} categories={categories} sb={sb} run={run} />
      )}
      {view === "requests" && isAdmin && <TI_Requests requests={requests} setup={liveSetup} nameOf={nameOf} me={me} sb={sb} run={run} />}
      {view === "inventory" && isAdmin && (
        <TI_Inventory assets={assets} staff={activeStaff} setup={liveSetup} categories={categories} nameOf={nameOf}
          personFilter={personFilter} setPersonFilter={setPersonFilter} sb={sb} run={run} />
      )}
      {view === "roster" && isAdmin && <TI_Roster roster={roster} essentials={essentials} onOpen={(e) => go("inventory", e)} />}
      {view === "directory" && isAdmin && <TI_Directory staff={activeStaff} contacts={contacts} me={me} sb={sb} run={run} />}
      {view === "setup" && <TI_Setup setup={setup} isAdmin={isAdmin} sb={sb} run={run} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Staff: My tech
// ---------------------------------------------------------------------------
function TI_MyTech({ me, requests, assets, setup, categories, sb, run }) {
  const [logging, setLogging] = React.useState(false);
  const [editId, setEditId] = React.useState(null);
  const myReqs = requests.filter((r) => !r.archived_at && String(r.staff_email).toLowerCase() === me);
  const mine = assets.filter((a) => String(a.staff_email).toLowerCase() === me);
  return (
    <>
      <section className="card">
        <h3 className="card-title">Request hardware</h3>
        <p className="card-subtitle">Admins get an email and update the status here.</p>
        <TI_RequestForm setup={setup} onSubmit={(d) => run(sb.from("tech_requests").insert({ ...d, staff_email: me }), "Request sent")} />
      </section>

      <section className="card">
        <h3 className="card-title">My requests</h3>
        <div className="table-scroll">
          <table className="tx-table tx-table-labeled ti-table">
            <thead>
              <tr><th scope="col">Item</th><th scope="col">Priority</th><th scope="col">Status</th><th scope="col">Requested</th><th scope="col"><span className="tp-sr">Actions</span></th></tr>
            </thead>
            <tbody>
              {myReqs.length === 0 ? (
                <EmptyRow colSpan={5}>No requests yet.</EmptyRow>
              ) : (
                myReqs.map((r) => (
                  <tr key={r.id}>
                    <td data-label="Item"><b>{r.item}</b>{r.reason && <div className="ti-muted">{r.reason}</div>}</td>
                    <td data-label="Priority">{r.priority}</td>
                    <td data-label="Status"><span className={"pill " + (TI_STATUS_PILL[r.status] || "neutral")}>{r.status}</span></td>
                    <td data-label="Requested">{TI_day(r.created_at)}</td>
                    <td className="ti-actions">
                      {r.status === "Open" && (
                        <button type="button" className="link-btn" onClick={() => window.confirm("Withdraw this request?") && run(sb.from("tech_requests").update({ archived_at: new Date().toISOString() }).eq("id", r.id), "Request withdrawn")}>
                          Withdraw
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="ti-card-head">
          <div>
            <h3 className="card-title">My items</h3>
            <p className="card-subtitle">The equipment you have now. Keep it current so admins know what to replace.</p>
          </div>
          {!logging && <button type="button" className="btn-primary" onClick={() => setLogging(true)}>Log an item</button>}
        </div>
        {logging && (
          <TI_AssetForm categories={categories} setup={setup} onCancel={() => setLogging(false)}
            onSubmit={(d) => run(sb.from("tech_assets").insert({ ...d, staff_email: me }), "Item logged").then((ok) => ok && setLogging(false))} />
        )}
        <TI_AssetTable rows={mine} editId={editId} setEditId={setEditId} categories={categories} setup={setup} sb={sb} run={run}
          archiveConfirm="Remove this item from your list? An admin can restore it." empty="Nothing logged yet." />
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Admin: Requests
// ---------------------------------------------------------------------------
function TI_Requests({ requests, setup, nameOf, me, sb, run }) {
  const [showArchived, setShowArchived] = React.useState(false);
  const [adding, setAdding] = React.useState(false);
  const rows = requests.filter((r) => (showArchived ? !!r.archived_at : !r.archived_at));
  const stamp = (id, patch, msg) => run(sb.from("tech_requests").update(patch).eq("id", id), msg);
  return (
    <section className="card">
      <div className="ti-card-head">
        <div>
          <h3 className="card-title">{showArchived ? "Archived requests" : "Requests"}</h3>
          <p className="card-subtitle">New requests email admin@mygoodbooks.org. Set the status as you order and hand out hardware.</p>
        </div>
        <div className="ti-head-actions">
          <button type="button" className="link-btn" onClick={() => setShowArchived(!showArchived)}>{showArchived ? "Show current" : "Show archived"}</button>
          {!adding && <button type="button" className="btn-primary" onClick={() => setAdding(true)}>New request</button>}
        </div>
      </div>
      {adding && (
        <TI_RequestForm setup={setup} onCancel={() => setAdding(false)}
          onSubmit={(d) => run(sb.from("tech_requests").insert({ ...d, staff_email: me }), "Request sent").then((ok) => ok && setAdding(false))} />
      )}
      <div className="table-scroll">
        <table className="tx-table tx-table-labeled ti-table">
          <thead>
            <tr><th scope="col">Requested</th><th scope="col">Person</th><th scope="col">Item</th><th scope="col">Priority</th><th scope="col">Status</th><th scope="col"><span className="tp-sr">Actions</span></th></tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={6}>{showArchived ? "Nothing archived." : "No requests right now."}</EmptyRow>
            ) : (
              rows.map((r) => (
                <tr key={r.id}>
                  <td data-label="Requested">{TI_day(r.created_at)}</td>
                  <td data-label="Person">{nameOf(r.staff_email)}</td>
                  <td data-label="Item"><b>{r.item}</b>{r.reason && <div className="ti-muted">{r.reason}</div>}</td>
                  <td data-label="Priority">{r.priority === "High" ? <span className="pill bad">High</span> : r.priority}</td>
                  <td data-label="Status">
                    <select className="ti-select" aria-label={"Status of " + r.item} value={r.status} onChange={(e) => stamp(r.id, { status: e.target.value }, "Status updated")}>
                      {TI_STATUSES.map((s) => <option key={s}>{s}</option>)}
                    </select>
                  </td>
                  <td className="ti-actions">
                    {r.archived_at ? (
                      <button type="button" className="link-btn" onClick={() => stamp(r.id, { archived_at: null }, "Request restored")}>Restore</button>
                    ) : (
                      <button type="button" className="link-btn" onClick={() => stamp(r.id, { archived_at: new Date().toISOString() }, "Request archived")}>Archive</button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Admin: Inventory
// ---------------------------------------------------------------------------
function TI_Inventory({ assets, staff, setup, categories, nameOf, personFilter, setPersonFilter, sb, run }) {
  const [q, setQ] = React.useState("");
  const [showArchived, setShowArchived] = React.useState(false);
  const [logging, setLogging] = React.useState(false);
  const [editId, setEditId] = React.useState(null);
  const rows = assets
    .filter((a) => (showArchived ? !!a.archived_at : !a.archived_at))
    .filter((a) => !personFilter || String(a.staff_email).toLowerCase() === personFilter)
    .filter((a) => {
      if (!q) return true;
      const t = [nameOf(a.staff_email), a.category, a.item, a.serial, a.condition, a.notes].join(" ").toLowerCase();
      return t.includes(q.toLowerCase());
    })
    .sort((x, y) => nameOf(x.staff_email).localeCompare(nameOf(y.staff_email)) || String(x.category).localeCompare(String(y.category)));
  return (
    <section className="card">
      <div className="ti-card-head">
        <div>
          <h3 className="card-title">{showArchived ? "Archived items" : "Inventory"}</h3>
          <p className="card-subtitle">
            {personFilter ? <>Showing {nameOf(personFilter)}. <button type="button" className="link-btn" onClick={() => setPersonFilter("")}>Show everyone</button></> : "Every item the team has, by person."}
          </p>
        </div>
        <div className="ti-head-actions">
          <input type="search" className="ti-search" placeholder="Search items" aria-label="Search items" value={q} onChange={(e) => setQ(e.target.value)} />
          <button type="button" className="link-btn" onClick={() => setShowArchived(!showArchived)}>{showArchived ? "Show current" : "Show archived"}</button>
          {!logging && <button type="button" className="btn-primary" onClick={() => setLogging(true)}>Log an item</button>}
        </div>
      </div>
      {logging && (
        <TI_AssetForm categories={categories} setup={setup} withPerson initial={{ staff_email: personFilter }} isNew onCancel={() => setLogging(false)}
          onSubmit={(d) => run(sb.from("tech_assets").insert(d), "Item logged").then((ok) => ok && setLogging(false))} />
      )}
      <TI_AssetTable rows={rows} nameOf={nameOf} withPerson editId={editId} setEditId={setEditId} categories={categories} setup={setup} sb={sb} run={run}
        restore={showArchived} empty={showArchived ? "Nothing archived." : q || personFilter ? "No items match." : "No items logged yet."} />
    </section>
  );
}

function TI_AssetTable({ rows, nameOf, withPerson, editId, setEditId, categories, setup, sb, run, restore, archiveConfirm, empty }) {
  const cols = withPerson ? 8 : 7;
  const archive = (a) => {
    if (archiveConfirm && !window.confirm(archiveConfirm)) return;
    run(sb.from("tech_assets").update({ archived_at: new Date().toISOString() }).eq("id", a.id), "Item archived");
  };
  return (
    <div className="table-scroll">
      <table className="tx-table tx-table-labeled ti-table">
        <thead>
          <tr>
            {withPerson && <th scope="col">Person</th>}
            <th scope="col">Item</th><th scope="col">Category</th><th scope="col">Serial</th><th scope="col">Condition</th><th scope="col">Received</th><th scope="col">Notes</th>
            <th scope="col"><span className="tp-sr">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <EmptyRow colSpan={cols}>{empty}</EmptyRow>
          ) : (
            rows.map((a) =>
              editId === a.id ? (
                <tr key={a.id}>
                  <td colSpan={cols}>
                    <TI_AssetForm categories={categories} setup={setup} withPerson={withPerson} initial={a} onCancel={() => setEditId(null)}
                      onSubmit={(d) => run(sb.from("tech_assets").update(d).eq("id", a.id), "Saved").then((ok) => ok && setEditId(null))} />
                  </td>
                </tr>
              ) : (
                <tr key={a.id}>
                  {withPerson && <td data-label="Person">{nameOf(a.staff_email)}</td>}
                  <td data-label="Item"><b>{a.item}</b></td>
                  <td data-label="Category">{a.category}</td>
                  <td data-label="Serial" className="ti-mono">{a.serial || ""}</td>
                  <td data-label="Condition"><span className={"pill " + (TI_COND_PILL[a.condition] || "neutral")}>{a.condition}</span></td>
                  <td data-label="Received">{a.date_received ? new Date(a.date_received + "T12:00:00").toLocaleDateString() : ""}</td>
                  <td data-label="Notes" className="ti-notes">{a.notes || ""}</td>
                  <td className="ti-actions">
                    {restore ? (
                      <button type="button" className="link-btn" onClick={() => run(sb.from("tech_assets").update({ archived_at: null }).eq("id", a.id), "Item restored")}>Restore</button>
                    ) : (
                      <>
                        <button type="button" className="link-btn" onClick={() => setEditId(a.id)}>Edit</button>
                        <button type="button" className="link-btn" onClick={() => archive(a)}>Archive</button>
                      </>
                    )}
                  </td>
                </tr>
              ),
            )
          )}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Admin: Roster
// ---------------------------------------------------------------------------
function TI_Roster({ roster, essentials, onOpen }) {
  return (
    <section className="card">
      <h3 className="card-title">Roster</h3>
      <p className="card-subtitle">Everyone on the team and the essentials they don't have yet ({essentials.join(", ") || "none set"}). Click a name to see their items.</p>
      <div className="table-scroll">
        <table className="tx-table tx-table-labeled ti-table">
          <thead>
            <tr><th scope="col">Person</th><th scope="col">Laptop</th><th scope="col" className="num">Items</th><th scope="col" className="num">Open requests</th><th scope="col">Missing essentials</th></tr>
          </thead>
          <tbody>
            {roster.length === 0 ? (
              <EmptyRow colSpan={5}>No active staff.</EmptyRow>
            ) : (
              roster.map((p) => (
                <tr key={p.email}>
                  <td data-label="Person"><button type="button" className="link-btn" onClick={() => onOpen(p.email)}>{p.name || p.email}</button></td>
                  <td data-label="Laptop">{p.laptop ? p.laptop.item : <span className="ti-muted">None logged</span>}</td>
                  <td data-label="Items" className="num">{p.items}</td>
                  <td data-label="Open requests" className="num">{p.open}</td>
                  <td data-label="Missing essentials">{p.missing.length === 0 ? <span className="pill good">All set</span> : p.missing.join(", ")}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Admin: Directory (staff_contact)
// ---------------------------------------------------------------------------
const TI_CONTACT_FIELDS = [
  ["full_name", "Full name"],
  ["personal_email", "Personal email"],
  ["work_phone", "Work phone"],
  ["home_phone", "Home phone"],
  ["mobile", "Mobile"],
  ["street", "Street"],
  ["city", "City"],
  ["state", "State"],
  ["zip", "ZIP"],
];

function TI_Directory({ staff, contacts, me, sb, run }) {
  const [editEmail, setEditEmail] = React.useState(null);
  const byEmail = new Map(contacts.map((c) => [String(c.staff_email).toLowerCase(), c]));
  const save = (email, d) => {
    const row = { staff_email: email, updated_at: new Date().toISOString(), updated_by: me };
    TI_CONTACT_FIELDS.forEach(([k]) => (row[k] = String(d[k] || "").trim() || null));
    return run(sb.from("staff_contact").upsert(row, { onConflict: "staff_email" }), "Saved").then((ok) => ok && setEditEmail(null));
  };
  return (
    <section className="card">
      <h3 className="card-title">Directory</h3>
      <p className="card-subtitle">Admins only. Names, emails and roles come from Team › Members; add someone there and they appear here.</p>
      <div className="table-scroll">
        <table className="tx-table tx-table-labeled ti-table">
          <thead>
            <tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Phone</th><th scope="col">Home address</th><th scope="col"><span className="tp-sr">Actions</span></th></tr>
          </thead>
          <tbody>
            {staff.map((s) => {
              const e = String(s.email).toLowerCase();
              const c = byEmail.get(e) || {};
              if (editEmail === e)
                return (
                  <tr key={e}>
                    <td colSpan={5}><TI_ContactForm name={s.name} initial={c} onCancel={() => setEditEmail(null)} onSubmit={(d) => save(e, d)} /></td>
                  </tr>
                );
              const phones = [["Mobile", c.mobile], ["Home", c.home_phone], ["Work", c.work_phone]].filter(([, v]) => v);
              const cityLine = [c.city, [c.state, c.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
              return (
                <tr key={e}>
                  <td data-label="Name"><b>{s.name}</b>{c.full_name && c.full_name !== s.name && <div className="ti-muted">{c.full_name}</div>}</td>
                  <td data-label="Email"><a href={"mailto:" + e}>{e}</a>{c.personal_email && <div className="ti-muted">{c.personal_email}</div>}</td>
                  <td data-label="Phone">{phones.length ? phones.map(([k, v]) => <div key={k}>{v} <span className="ti-muted">{k.toLowerCase()}</span></div>) : <span className="ti-muted">None</span>}</td>
                  <td data-label="Home address">{c.street ? <>{c.street}<div>{cityLine}</div></> : <span className="ti-muted">None</span>}</td>
                  <td className="ti-actions"><button type="button" className="link-btn" onClick={() => setEditEmail(e)}>Edit</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TI_ContactForm({ name, initial, onSubmit, onCancel }) {
  const [d, setD] = React.useState(() => {
    const o = {};
    TI_CONTACT_FIELDS.forEach(([k]) => (o[k] = initial[k] || ""));
    return o;
  });
  return (
    <form className="ti-form" onSubmit={(e) => { e.preventDefault(); onSubmit(d); }} aria-label={"Contact details for " + name}>
      {TI_CONTACT_FIELDS.map(([k, label]) => (
        <label key={k} className={"task-field" + (k === "street" ? " ti-wide" : "")}>
          <span>{label}</span>
          <input id={"ti-ct-" + k} type={k === "personal_email" ? "email" : "text"} value={d[k]} onChange={(e) => setD({ ...d, [k]: e.target.value })} />
        </label>
      ))}
      <div className="ti-btns">
        <button type="submit" className="btn-primary">Save</button>
        <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Standard setup
// ---------------------------------------------------------------------------
function TI_Setup({ setup, isAdmin, sb, run }) {
  const [editId, setEditId] = React.useState(null);
  const [adding, setAdding] = React.useState(false);
  const [showArchived, setShowArchived] = React.useState(false);
  const rows = setup.filter((s) => (showArchived ? !!s.archived_at : !s.archived_at));
  const live = setup.filter((s) => !s.archived_at);
  const total = live.filter((s) => s.essential && s.price != null).reduce((n, s) => n + Number(s.price), 0);
  const nextSort = setup.reduce((n, s) => Math.max(n, s.sort || 0), 0) + 1;
  const cols = isAdmin ? 4 : 3;
  return (
    <section className="card">
      <div className="ti-card-head">
        <div>
          <h3 className="card-title">{showArchived ? "Archived setup items" : "Standard setup"}</h3>
          <p className="card-subtitle">What every new team member gets. Essentials come to about {TI_money(total)}.</p>
        </div>
        {isAdmin && (
          <div className="ti-head-actions">
            <button type="button" className="link-btn" onClick={() => setShowArchived(!showArchived)}>{showArchived ? "Show current" : "Show archived"}</button>
            {!adding && <button type="button" className="btn-primary" onClick={() => setAdding(true)}>Add item</button>}
          </div>
        )}
      </div>
      {adding && (
        <TI_SetupForm onCancel={() => setAdding(false)}
          onSubmit={(d) => run(sb.from("tech_setup").insert({ ...d, sort: nextSort }), "Item added").then((ok) => ok && setAdding(false))} />
      )}
      <div className="table-scroll">
        <table className="tx-table tx-table-labeled ti-table">
          <thead>
            <tr><th scope="col">Item</th><th scope="col">Type</th><th scope="col" className="num">Price</th>{isAdmin && <th scope="col"><span className="tp-sr">Actions</span></th>}</tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={cols}>{showArchived ? "Nothing archived." : "No setup items yet."}</EmptyRow>
            ) : (
              rows.map((s) =>
                editId === s.id ? (
                  <tr key={s.id}>
                    <td colSpan={cols}>
                      <TI_SetupForm initial={s} onCancel={() => setEditId(null)}
                        onSubmit={(d) => run(sb.from("tech_setup").update(d).eq("id", s.id), "Saved").then((ok) => ok && setEditId(null))} />
                    </td>
                  </tr>
                ) : (
                  <tr key={s.id}>
                    <td data-label="Item">{s.link ? <a href={s.link} target="_blank" rel="noopener noreferrer">{s.item}</a> : s.item}</td>
                    <td data-label="Type">{s.essential ? "Essential" : <span className="ti-muted">Optional</span>}</td>
                    <td data-label="Price" className="num">{TI_money(s.price)}</td>
                    {isAdmin && (
                      <td className="ti-actions">
                        {s.archived_at ? (
                          <button type="button" className="link-btn" onClick={() => run(sb.from("tech_setup").update({ archived_at: null }).eq("id", s.id), "Item restored")}>Restore</button>
                        ) : (
                          <>
                            <button type="button" className="link-btn" onClick={() => setEditId(s.id)}>Edit</button>
                            <button type="button" className="link-btn" onClick={() => run(sb.from("tech_setup").update({ archived_at: new Date().toISOString() }).eq("id", s.id), "Item archived")}>Archive</button>
                          </>
                        )}
                      </td>
                    )}
                  </tr>
                ),
              )
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TI_SetupForm({ initial, onSubmit, onCancel }) {
  const [d, setD] = React.useState({
    item: (initial && initial.item) || "",
    link: (initial && initial.link) || "",
    price: initial && initial.price != null ? String(initial.price) : "",
    essential: initial ? !!initial.essential : true,
  });
  const p = initial ? "ti-su-ed-" : "ti-su-new-";
  return (
    <form className="ti-form" onSubmit={(e) => {
      e.preventDefault();
      if (!d.item.trim()) return;
      const price = d.price.trim() === "" ? null : Number(d.price.replace(/[$,]/g, ""));
      onSubmit({ item: d.item.trim(), link: d.link.trim() || null, price: Number.isFinite(price) ? price : null, essential: d.essential });
    }}>
      <label className="task-field"><span>Item</span><input id={p + "item"} value={d.item} onChange={(e) => setD({ ...d, item: e.target.value })} required /></label>
      <label className="task-field ti-wide"><span>Link</span><input id={p + "link"} type="url" value={d.link} onChange={(e) => setD({ ...d, link: e.target.value })} placeholder="https://" /></label>
      <label className="task-field compact"><span>Price</span><input id={p + "price"} inputMode="decimal" value={d.price} onChange={(e) => setD({ ...d, price: e.target.value })} /></label>
      <label className="ti-check"><input id={p + "essential"} type="checkbox" checked={d.essential} onChange={(e) => setD({ ...d, essential: e.target.checked })} /> Essential</label>
      <div className="ti-btns">
        <button type="submit" className="btn-primary">{initial ? "Save" : "Add item"}</button>
        <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------
function TI_RequestForm({ setup, onSubmit, onCancel }) {
  const blank = { item: "", reason: "", priority: "Normal" };
  const [d, setD] = React.useState(blank);
  const set = (k) => (e) => setD({ ...d, [k]: e.target.value });
  return (
    <form className="ti-form" onSubmit={(e) => { e.preventDefault(); if (!d.item.trim()) return; onSubmit({ ...d, item: d.item.trim(), reason: d.reason.trim() || null }); setD(blank); }}>
      <label className="task-field"><span>What do you need?</span><input id="ti-req-item" list="ti-setup-items" value={d.item} onChange={set("item")} required /></label>
      <label className="task-field compact"><span>Priority</span>
        <select id="ti-req-priority" value={d.priority} onChange={set("priority")}><option>Low</option><option>Normal</option><option>High</option></select>
      </label>
      <label className="task-field ti-wide"><span>Why</span><textarea id="ti-req-reason" rows={2} value={d.reason} onChange={set("reason")} /></label>
      <datalist id="ti-setup-items">{setup.map((s) => <option key={s.id} value={s.item} />)}</datalist>
      <div className="ti-btns">
        <button type="submit" className="btn-primary">Send request</button>
        {onCancel && <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}

function TI_AssetForm({ categories, setup, withPerson, initial, isNew, onSubmit, onCancel }) {
  const blank = { staff_email: "", category: "", item: "", serial: "", condition: "Good", date_received: "", notes: "" };
  const [d, setD] = React.useState(initial ? { ...blank, ...initial } : blank);
  const [err, setErr] = React.useState(null);
  const set = (k) => (e) => setD({ ...d, [k]: e.target.value });
  const editing = initial && !isNew;
  const submit = (e) => {
    e.preventDefault();
    if (withPerson && !d.staff_email) return setErr("Choose who has it.");
    if (!d.category.trim() || !d.item.trim()) return setErr("Category and item are required.");
    setErr(null);
    const out = { category: d.category.trim(), item: d.item.trim(), serial: d.serial || null, condition: d.condition, date_received: d.date_received || null, notes: d.notes || null };
    if (withPerson) out.staff_email = String(d.staff_email).toLowerCase();
    onSubmit(out);
  };
  const p = editing ? "ti-ed-" : "ti-new-";
  return (
    <form className="ti-form" onSubmit={submit}>
      {withPerson && (
        <label className="task-field"><span>Person</span>
          {typeof CV_StaffSelect === "function" ? (
            <CV_StaffSelect id={p + "staff"} value={d.staff_email} onChange={(v) => setD({ ...d, staff_email: v })} emptyLabel="Choose a person" />
          ) : (
            <input id={p + "staff"} type="email" value={d.staff_email} onChange={set("staff_email")} />
          )}
        </label>
      )}
      <label className="task-field"><span>Category</span><input id={p + "category"} list="ti-cat-list" value={d.category} onChange={set("category")} required /></label>
      <label className="task-field"><span>Item</span><input id={p + "item"} list="ti-setup-items-2" value={d.item} onChange={set("item")} required /></label>
      <label className="task-field"><span>Serial</span><input id={p + "serial"} value={d.serial || ""} onChange={set("serial")} /></label>
      <label className="task-field compact"><span>Condition</span>
        <select id={p + "condition"} value={d.condition} onChange={set("condition")}>{TI_CONDITIONS.map((c) => <option key={c}>{c}</option>)}</select>
      </label>
      <label className="task-field compact"><span>Received</span><input id={p + "received"} type="date" value={d.date_received || ""} onChange={set("date_received")} /></label>
      <label className="task-field ti-wide"><span>Notes</span><input id={p + "notes"} value={d.notes || ""} onChange={set("notes")} /></label>
      <datalist id="ti-cat-list">{categories.map((c) => <option key={c} value={c} />)}</datalist>
      <datalist id="ti-setup-items-2">{setup.map((s) => <option key={s.id} value={s.item} />)}</datalist>
      {err && <p className="cv-err ti-wide" role="alert">{err}</p>}
      <div className="ti-btns">
        <button type="submit" className="btn-primary">{editing ? "Save" : "Log item"}</button>
        {onCancel && <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}
