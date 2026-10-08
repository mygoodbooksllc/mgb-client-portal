// Tech Inventory (owner request 2026-10-08). Staff only. supabase/tech-inventory.sql
// Replaces the Apps Script tool. Team → Tech.
//
//   Staff: request hardware, log their own items, remove their own items.
//   Admins: request status (Open/Ordered/Fulfilled/Declined) and delete,
//           every asset (search, sort, edit, remove), the standard setup.
// Top-level names use the TI_ prefix.

const TI_SETUP_MSG = "Tech Inventory isn't set up yet (database step pending).";
const TI_STATUSES = ["Open", "Ordered", "Fulfilled", "Declined"];
const TI_CONDITIONS = ["New", "Good", "Fair", "Poor", "Broken"];
const TI_LAPTOP_RE = /mac|laptop|lenovo|dell|thinkpad|chromebook|notebook/i;
const TI_NOT_LAPTOP_RE = /desktop|imac|mac mini/i;

function TI_isLaptop(a) {
  const t = (a.category || "") + " " + (a.item || "");
  return TI_LAPTOP_RE.test(t) && !TI_NOT_LAPTOP_RE.test(t);
}

function TI_errMsg(error) {
  return typeof isMissingTableError === "function" && isMissingTableError(error) ? TI_SETUP_MSG : error.message;
}

function TI_TechTab({ staffUser, isAdmin }) {
  const sb = window.mgbSupabase;
  const me = String((staffUser && staffUser.email) || "").toLowerCase();
  const [requests, setRequests] = React.useState([]);
  const [assets, setAssets] = React.useState([]);
  const [setup, setSetup] = React.useState([]);
  const [staff, setStaff] = React.useState([]);
  const [error, setError] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [editId, setEditId] = React.useState(null);
  const [q, setQ] = React.useState("");
  const [sort, setSort] = React.useState({ key: "staff", dir: 1 });
  const toast = typeof useToast === "function" ? useToast() : null;
  const say = (m) => (typeof toast === "function" ? toast(m) : null);

  const load = React.useCallback(() => {
    if (!sb) return;
    Promise.all([
      sb.from("tech_requests").select("*").order("created_at", { ascending: false }),
      sb.from("tech_assets").select("*").order("created_at", { ascending: false }),
      sb.from("tech_setup").select("*").order("sort"),
      sb.from("staff").select("email, name, active"),
    ]).then(([r, a, s, st]) => {
      setLoading(false);
      const bad = r.error || a.error || s.error;
      if (bad) return setError(TI_errMsg(bad));
      setError(null);
      setRequests(r.data || []);
      setAssets(a.data || []);
      setSetup(s.data || []);
      setStaff(st.data || []);
    });
  }, [sb]);
  React.useEffect(load, [load]);

  const nameOf = (email) => {
    const s = staff.find((x) => String(x.email).toLowerCase() === String(email).toLowerCase());
    return (s && s.name) || email;
  };
  const run = (p, okMsg) =>
    Promise.resolve(p).then(({ error }) => {
      if (error) return setError(error.message);
      if (okMsg) say(okMsg);
      load();
    });

  const categories = React.useMemo(() => {
    const set = new Set(["Laptop"]);
    setup.forEach((s) => set.add(TI_LAPTOP_RE.test(s.item) ? "Laptop" : s.item));
    set.add("Other");
    return [...set];
  }, [setup]);

  if (loading) return <p className="card-subtitle">Loading…</p>;
  if (error === TI_SETUP_MSG) return <p className="card-subtitle">{error}</p>;

  const mine = assets.filter((a) => String(a.staff_email).toLowerCase() === me);
  const openReqs = requests.filter((r) => r.status === "Open" || r.status === "Ordered");
  const people = new Set(assets.map((a) => a.staff_email.toLowerCase())).size;

  const shown = assets
    .filter((a) => {
      if (!q) return true;
      const t = [nameOf(a.staff_email), a.category, a.item, a.serial, a.condition, a.notes].join(" ").toLowerCase();
      return t.includes(q.toLowerCase());
    })
    .sort((x, y) => {
      const v = (a) => String(sort.key === "staff" ? nameOf(a.staff_email) : a[sort.key] || "").toLowerCase();
      return v(x) < v(y) ? -sort.dir : v(x) > v(y) ? sort.dir : 0;
    });
  const th = (key, label) => (
    <th>
      <button type="button" className="ti-sort" onClick={() => setSort({ key, dir: sort.key === key ? -sort.dir : 1 })}>
        {label}
        {sort.key === key ? (sort.dir > 0 ? " ↑" : " ↓") : ""}
      </button>
    </th>
  );

  return (
    <div className="ti-wrap">
      {error && <p className="cv-err" role="alert">{error}</p>}

      {isAdmin && (
        <div className="ti-stats">
          <div><b>{assets.length}</b><span>Items</span></div>
          <div><b>{assets.filter(TI_isLaptop).length}</b><span>Laptops</span></div>
          <div><b>{people}</b><span>People</span></div>
          <div><b>{openReqs.length}</b><span>Open requests</span></div>
        </div>
      )}

      <div className="ti-grid">
        <section className="card ti-card">
          <h3>Request hardware</h3>
          <TI_RequestForm setup={setup} onSubmit={(d) => run(sb.from("tech_requests").insert({ ...d, staff_email: me }), "Request sent")} />
        </section>
        <section className="card ti-card">
          <h3>Log an item you have</h3>
          <TI_AssetForm categories={categories} setup={setup} onSubmit={(d) => run(sb.from("tech_assets").insert({ ...d, staff_email: me }), "Item logged")} />
        </section>
      </div>

      <section className="card ti-card">
        <h3>{isAdmin ? "Requests" : "My requests"}</h3>
        {requests.length === 0 ? (
          <p className="card-subtitle">No requests yet.</p>
        ) : (
          <ul className="ti-list">
            {requests.map((r) => (
              <li key={r.id}>
                <div className="ti-main">
                  <strong>{r.item}</strong>
                  <span className="ti-muted">
                    {isAdmin ? nameOf(r.staff_email) + " · " : ""}
                    {r.priority} · {new Date(r.created_at).toLocaleDateString()}
                  </span>
                  {r.reason && <span className="ti-muted">{r.reason}</span>}
                </div>
                {isAdmin ? (
                  <>
                    <select aria-label="Status" value={r.status} onChange={(e) => run(sb.from("tech_requests").update({ status: e.target.value }).eq("id", r.id))}>
                      {TI_STATUSES.map((s) => <option key={s}>{s}</option>)}
                    </select>
                    <button type="button" className="ti-x" aria-label="Delete request"
                      onClick={() => window.confirm("Delete this request?") && run(sb.from("tech_requests").delete().eq("id", r.id), "Request deleted")}>×</button>
                  </>
                ) : (
                  <span className={"ti-pill ti-" + r.status.toLowerCase()}>{r.status}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {!isAdmin && (
        <section className="card ti-card">
          <h3>My items</h3>
          {mine.length === 0 ? <p className="card-subtitle">Nothing logged yet.</p> : (
            <ul className="ti-list">
              {mine.map((a) => (
                <li key={a.id}>
                  <div className="ti-main">
                    <strong>{a.item}</strong>
                    <span className="ti-muted">{a.category} · {a.condition}{a.serial ? " · " + a.serial : ""}</span>
                  </div>
                  <button type="button" className="ti-x" aria-label="Remove item"
                    onClick={() => window.confirm("Remove this item from the inventory?") && run(sb.from("tech_assets").delete().eq("id", a.id), "Item removed")}>×</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {isAdmin && (
        <section className="card ti-card">
          <div className="ti-head">
            <h3>Inventory</h3>
            <input type="search" id="ti-search" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="ti-table-wrap">
            <table className="ti-table">
              <thead>
                <tr>{th("staff", "Person")}{th("category", "Category")}{th("item", "Item")}{th("serial", "Serial")}{th("condition", "Condition")}{th("date_received", "Received")}<th>Notes</th><th></th></tr>
              </thead>
              <tbody>
                {shown.map((a) =>
                  editId === a.id ? (
                    <tr key={a.id}>
                      <td colSpan={8}>
                        <TI_AssetForm categories={categories} setup={setup} staff={staff} initial={a} onCancel={() => setEditId(null)}
                          onSubmit={(d) => run(sb.from("tech_assets").update(d).eq("id", a.id), "Saved").then(() => setEditId(null))} />
                      </td>
                    </tr>
                  ) : (
                    <tr key={a.id}>
                      <td>{nameOf(a.staff_email)}</td><td>{a.category}</td><td>{a.item}</td><td>{a.serial}</td>
                      <td>{a.condition}</td><td>{a.date_received || ""}</td><td>{a.notes}</td>
                      <td className="ti-actions">
                        <button type="button" className="ti-link" onClick={() => setEditId(a.id)}>Edit</button>
                        <button type="button" className="ti-x" aria-label="Remove item"
                          onClick={() => window.confirm("Remove this item from the inventory?") && run(sb.from("tech_assets").delete().eq("id", a.id), "Item removed")}>×</button>
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="card ti-card">
        <h3>Standard setup</h3>
        <ul className="ti-setup">
          {setup.map((s) => (
            <li key={s.id}>
              {s.link ? <a href={s.link} target="_blank" rel="noopener noreferrer">{s.item}</a> : s.item}
              {!s.essential && <span className="ti-muted"> · optional</span>}
              {s.price != null && <span className="ti-muted"> · ${Number(s.price).toFixed(2)}</span>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function TI_RequestForm({ setup, onSubmit }) {
  const [d, setD] = React.useState({ item: "", reason: "", priority: "Normal" });
  const set = (k) => (e) => setD({ ...d, [k]: e.target.value });
  return (
    <form className="ti-form" onSubmit={(e) => { e.preventDefault(); if (!d.item.trim()) return; onSubmit(d); setD({ item: "", reason: "", priority: "Normal" }); }}>
      <label>Item<input id="ti-req-item" list="ti-setup-items" value={d.item} onChange={set("item")} required /></label>
      <label>Priority<select id="ti-req-priority" value={d.priority} onChange={set("priority")}><option>Low</option><option>Normal</option><option>High</option></select></label>
      <label className="ti-full">Why<textarea id="ti-req-reason" rows={2} value={d.reason} onChange={set("reason")} /></label>
      <datalist id="ti-setup-items">{setup.map((s) => <option key={s.id} value={s.item} />)}</datalist>
      <button type="submit" className="btn-primary ti-full">Send request</button>
    </form>
  );
}

function TI_AssetForm({ categories, setup, staff, initial, onSubmit, onCancel }) {
  const blank = { category: "", item: "", serial: "", condition: "Good", date_received: "", notes: "" };
  const [d, setD] = React.useState(initial ? { ...blank, ...initial } : blank);
  const set = (k) => (e) => setD({ ...d, [k]: e.target.value });
  const submit = (e) => {
    e.preventDefault();
    if (!d.category.trim() || !d.item.trim()) return;
    const out = { category: d.category, item: d.item, serial: d.serial || null, condition: d.condition, date_received: d.date_received || null, notes: d.notes || null };
    if (staff) out.staff_email = d.staff_email;
    onSubmit(out);
    if (!initial) setD(blank);
  };
  const p = initial ? "ti-ed-" : "ti-new-";
  return (
    <form className="ti-form" onSubmit={submit}>
      {staff && (
        <label>Person<select id={p + "staff"} value={d.staff_email} onChange={set("staff_email")}>
          {staff.map((s) => <option key={s.email} value={s.email}>{s.name || s.email}</option>)}
        </select></label>
      )}
      <label>Category<input id={p + "category"} list="ti-cat-list" value={d.category} onChange={set("category")} required /></label>
      <label>Item<input id={p + "item"} list="ti-setup-items-2" value={d.item} onChange={set("item")} required /></label>
      <label>Serial<input id={p + "serial"} value={d.serial || ""} onChange={set("serial")} /></label>
      <label>Condition<select id={p + "condition"} value={d.condition} onChange={set("condition")}>{TI_CONDITIONS.map((c) => <option key={c}>{c}</option>)}</select></label>
      <label>Received<input id={p + "received"} type="date" value={d.date_received || ""} onChange={set("date_received")} /></label>
      <label className="ti-full">Notes<input id={p + "notes"} value={d.notes || ""} onChange={set("notes")} /></label>
      <datalist id="ti-cat-list">{categories.map((c) => <option key={c} value={c} />)}</datalist>
      <datalist id="ti-setup-items-2">{setup.map((s) => <option key={s.id} value={s.item} />)}</datalist>
      <div className="ti-full ti-btns">
        <button type="submit" className="btn-primary">{initial ? "Save" : "Log item"}</button>
        {onCancel && <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}
