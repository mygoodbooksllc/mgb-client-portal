// Members area (HR > Members area): a hidden staff tab for people who help
// members (customers of the course, the Launch Kit and the client library).
// Shown only through the gate in MB_gate.js (preview checkbox or the owner's
// firm switch, plus members_staff_me.can_list). Prefix MB_ / mb-.
//
//   MB_MembersTab({ staffUser })   TeamPage.jsx TP_TeamHub body
//
// Rules live in MB_logic.js (loads first); gate in MB_gate.js. Styles: mb.css.
// RPCs (all security definer, see supabase/members-*.sql):
//   members_staff_list()              the rows
//   open_member(p_member_id, p_reason) records who opened whom and why, returns the facts
//   members_support_people() / set_members_support(p_email, p_allowed)   owner only
// The open account is component state, not the hash, so no one's email ends
// up in a link or the browser history.

function MB_useToastSafe() {
  return typeof useToast === "function" ? useToast() : (m) => window.alert(m);
}

async function MB_rpc(fn, args) {
  const sb = window.mgbSupabase;
  if (!sb) throw new Error("Sign in again.");
  const { data, error } = await sb.rpc(fn, args || {});
  if (error) throw error;
  return data;
}

function MB_Error({ text }) {
  if (!text) return null;
  return (
    <p className="al-error mb-error" role="alert">
      {text}
    </p>
  );
}

function MB_AccessChips({ row }) {
  const list = MB_accessList(row);
  if (!list.length) return <span className="mb-muted">No access</span>;
  return (
    <span className="mb-chips">
      {list.map((a) => (
        <span key={a} className={"pill " + (a === "client" ? "good" : "neutral")}>
          {MB_accessLabel(a)}
        </span>
      ))}
    </span>
  );
}

// Why are you opening this? Opening is recorded, so we ask first.
function MB_ReasonDialog({ row, busy, error, onCancel, onConfirm }) {
  const [choice, setChoice] = React.useState("signin");
  const [note, setNote] = React.useState("");
  const cancelRef = React.useRef(onCancel);
  cancelRef.current = onCancel;
  React.useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      cancelRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  const reason = MB_reasonText(choice, note);
  const name = row.display_name || row.email;
  const options = [
    ["signin", "Sign-in help"],
    ["purchase", "Purchase question"],
    ["other", "Other"],
  ];
  return (
    <div className="modal-overlay" onClick={busy ? undefined : onCancel}>
      <div className="modal-panel mb-dialog" role="dialog" aria-modal="true" aria-labelledby="mb-why-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="card-title" id="mb-why-title">
            Open {name}?
          </h3>
          <button type="button" className="modal-close" aria-label="Close" onClick={onCancel} disabled={busy}>
            ×
          </button>
        </div>
        <p className="mb-muted mb-why-note">
          Opening a customer is recorded: your name, who you opened, the time and the reason you pick here. Pick the one that fits.
        </p>
        <fieldset className="mb-why-set">
          <legend className="mb-sr">Why are you opening this customer?</legend>
          {options.map(([k, label]) => (
            <label key={k} className="mb-radio">
              <input type="radio" name="mb-why" value={k} checked={choice === k} onChange={() => setChoice(k)} />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
        {choice === "other" && (
          <div>
            <label className="mb-label" htmlFor="mb-why-text">
              A few words on why
            </label>
            <input
              id="mb-why-text"
              type="text"
              className="mb-inp"
              maxLength={450}
              value={note}
              autoFocus
              autoComplete="off"
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        )}
        <MB_Error text={error} />
        <div className="mb-dialog-actions">
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn-primary" disabled={busy || !reason} onClick={() => onConfirm(reason)}>
            {busy ? "Opening…" : "Open and record"}
          </button>
        </div>
      </div>
    </div>
  );
}

// The account facts for one opened customer.
function MB_AccountPanel({ data, onBack }) {
  const a = data.account || {};
  const access = Array.isArray(data.access) ? data.access : [];
  const purchases = Array.isArray(data.purchases) ? data.purchases : [];
  const open = Number(data.open_requests) || 0;
  return (
    <div className="mb-view">
      <button type="button" className="link-btn mb-back" onClick={onBack}>
        ← All customers
      </button>
      <section className="card" aria-labelledby="mb-acct-title">
        <h3 className="card-title" id="mb-acct-title">
          {a.display_name || a.email}
        </h3>
        <p className="mb-muted">This opening was recorded{data.opened_at ? " on " + MB_fmtDate(data.opened_at) : ""}.</p>
        <h4 className="mb-group-title">Account</h4>
        <dl className="mb-dl">
          <dt>Email</dt>
          <dd>{a.email || "Not on file"}</dd>
          <dt>Name</dt>
          <dd>{a.display_name || "Not on file"}</dd>
          <dt>Church</dt>
          <dd>{a.church_name || "Not on file"}</dd>
          <dt>Account created</dt>
          <dd>{MB_fmtDate(a.profile_created_at) || "Not on file"}</dd>
          <dt>Last sign-in</dt>
          <dd>{MB_relativeTime(a.last_sign_in_at)}</dd>
          <dt>MyGoodBooks client</dt>
          <dd>{a.is_client ? "Yes" : "No"}</dd>
        </dl>
        <h4 className="mb-group-title">Access</h4>
        {!access.length ? (
          <p className="mb-muted">No access on this account.</p>
        ) : (
          <ul className="mb-plain-list">
            {access.map((g, i) => (
              <li key={i}>
                <strong>{MB_accessLabel(g.access)}</strong>{" "}
                <span className="pill neutral">{g.live ? "Live" : "Not live"}</span>
                <span className="mb-muted">
                  {" "}
                  {[g.source ? "From " + g.source : "", g.granted_at ? "since " + MB_fmtDate(g.granted_at) : "", g.expires_at ? "ends " + MB_fmtDate(g.expires_at) : ""]
                    .filter(Boolean)
                    .join(", ")}
                </span>
              </li>
            ))}
          </ul>
        )}
        <h4 className="mb-group-title">Purchases</h4>
        {!purchases.length ? (
          <p className="mb-muted">No purchases yet.</p>
        ) : (
          <ul className="mb-plain-list">
            {purchases.map((p, i) => (
              <li key={i}>
                <strong>{p.product || "Purchase"}</strong>, {MB_money(p.amount_cents)}{" "}
                <span className="pill neutral">{p.status || "unknown"}</span>
                <span className="mb-muted">
                  {" "}
                  {[
                    p.paid_at ? "paid " + MB_fmtDate(p.paid_at) : "",
                    p.refunded_at ? "refunded " + MB_fmtDate(p.refunded_at) : "",
                    p.receipt ? "receipt " + p.receipt : "",
                  ]
                    .filter(Boolean)
                    .join(", ")}
                </span>
              </li>
            ))}
          </ul>
        )}
        <h4 className="mb-group-title">Support</h4>
        <p className="mb-muted">
          {open === 0 ? "No open requests." : open + (open === 1 ? " open request." : " open requests.")} Support status: {MB_supportLabel(data.support_status)}.
        </p>
      </section>
    </div>
  );
}

// Owner only: who may open customers.
function MB_PeopleCard() {
  const toast = MB_useToastSafe();
  const [people, setPeople] = React.useState(null);
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState("");

  const load = React.useCallback(async () => {
    setError("");
    try {
      const r = await MB_rpc("members_support_people");
      setPeople(Array.isArray(r) ? r : []);
    } catch (e) {
      setError(MB_errText(e));
      setPeople((x) => x || []);
    }
  }, []);
  React.useEffect(() => {
    load();
  }, [load]);

  const toggle = async (p, allowed) => {
    setBusy(p.email);
    setError("");
    try {
      await MB_rpc("set_members_support", { p_email: p.email, p_allowed: allowed });
      setPeople((list) => (list || []).map((x) => (x.email === p.email ? { ...x, allowed } : x)));
      toast((p.name || p.email) + (allowed ? " can now open customers." : " can no longer open customers."));
    } catch (e) {
      setError(MB_errText(e));
      load();
    }
    setBusy("");
  };

  return (
    <section className="card mb-people" aria-labelledby="mb-people-title">
      <h3 className="card-title" id="mb-people-title">
        Who can open customers
      </h3>
      <p className="mb-muted">
        Every admin can see this list. Only the people you turn on here can open a customer's account, and each opening is recorded.
      </p>
      <MB_Error text={error} />
      {!people ? (
        <p className="mb-muted">Loading…</p>
      ) : !people.length ? (
        <p className="mb-muted">No staff to show yet.</p>
      ) : (
        <ul className="mb-people-list">
          {people.map((p) => (
            <li key={p.email} className="mb-person">
              <span className="mb-person-main">
                <strong>{p.name || p.email}</strong>
                <span className="mb-muted">{[p.name ? p.email : "", p.role === "admin" ? "Admin" : p.role ? "Bookkeeper" : ""].filter(Boolean).join(" · ")}</span>
              </span>
              {p.is_owner ? (
                <span className="pill good">Always</span>
              ) : (
                <label className="mb-check">
                  <input type="checkbox" checked={!!p.allowed} disabled={busy === p.email} onChange={(e) => toggle(p, e.target.checked)} />
                  <span>{p.allowed ? "Can open" : "Can't open"}</span>
                </label>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function MB_MembersTab({ staffUser }) {
  const gate = typeof MB_useGate === "function" ? MB_useGate() : { ready: true, show: false, me: null };
  const me = gate.me || {};
  const [rows, setRows] = React.useState(null);
  const [error, setError] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [access, setAccess] = React.useState("all");
  const [needs, setNeeds] = React.useState(false);
  const [showTests, setShowTests] = React.useState(false);
  const [asking, setAsking] = React.useState(null); // the row being opened
  const [askError, setAskError] = React.useState("");
  const [opening, setOpening] = React.useState(false);
  const [opened, setOpened] = React.useState(null);

  const load = React.useCallback(async () => {
    setError("");
    try {
      const r = await MB_rpc("members_staff_list");
      setRows(Array.isArray(r) ? r : []);
    } catch (e) {
      setError(MB_errText(e));
      setRows((x) => x || []);
    }
  }, []);
  React.useEffect(() => {
    if (gate.show) load();
  }, [gate.show, load]);

  if (!gate.ready) return <p className="card-subtitle">Loading…</p>;
  if (!gate.show) return <p className="card-subtitle">Members area isn't available right now.</p>;

  const canOpen = me.can_open === true;

  const confirmOpen = async (reason) => {
    if (!asking || !asking.member_key) return;
    setOpening(true);
    setAskError("");
    try {
      const r = await MB_rpc("open_member", { p_member_id: asking.member_key, p_reason: reason });
      if (r && r.ok === true) {
        setOpened(r);
        setAsking(null);
      } else {
        setAskError("You can't open this customer. Ask the owner if you need to.");
      }
    } catch (e) {
      setAskError(MB_errText(e));
    }
    setOpening(false);
  };

  if (opened) return <MB_AccountPanel data={opened} onBack={() => setOpened(null)} />;

  const all = rows || [];
  const list = MB_filterRows(all, { query, access, showTests, needsSupport: needs });
  const count = MB_countRows(all, showTests);
  const filtering = !!query.trim() || access !== "all";

  let empty = "";
  if (rows && !list.length) {
    if (needs) empty = "Nobody needs support right now.";
    else if (filtering) empty = "No customer matches that. Try an email address or a receipt number.";
    else empty = "No one has members access yet. Customers show up here after their first purchase or when a client is added to the roster.";
  }

  return (
    <div className="mb-tab">
      <section className="card" aria-labelledby="mb-list-title">
        <h3 className="card-title" id="mb-list-title">
          Members area
        </h3>
        <p className="mb-muted">
          Customers of the course, the Launch Kit and the client library.{rows ? " " + count + (count === 1 ? " customer" : " customers") + "." : ""}
        </p>
        {rows && !canOpen && <p className="mb-note">This page is for staff who help members. Ask the owner if you need it.</p>}
        <div className="mb-tools">
          <label className="mb-sr" htmlFor="mb-search">
            Search customers
          </label>
          <input
            id="mb-search"
            type="search"
            className="mb-inp mb-search"
            value={query}
            placeholder="Search by email, name or church"
            autoComplete="off"
            onChange={(e) => setQuery(e.target.value)}
          />
          <label className="mb-sr" htmlFor="mb-access">
            Access type
          </label>
          <select id="mb-access" className="mb-inp mb-sel" value={access} onChange={(e) => setAccess(e.target.value)}>
            <option value="all">All access</option>
            <option value="client">Client</option>
            <option value="course">Course</option>
            <option value="kit">Launch Kit</option>
          </select>
        </div>
        <div className="mb-filters">
          <button type="button" className={"mb-chip" + (!needs ? " on" : "")} aria-pressed={!needs} onClick={() => setNeeds(false)}>
            All
          </button>
          <button type="button" className={"mb-chip" + (needs ? " on" : "")} aria-pressed={needs} onClick={() => setNeeds(true)}>
            Needs support
          </button>
          <label className="mb-check mb-tests">
            <input type="checkbox" checked={showTests} onChange={(e) => setShowTests(e.target.checked)} />
            <span>Show test customers</span>
          </label>
        </div>
        <MB_Error text={error} />
        {!rows ? (
          <p className="mb-muted">Loading…</p>
        ) : empty ? (
          <p className="mb-muted mb-empty">{empty}</p>
        ) : (
          <>
            <div className="mb-head" aria-hidden="true">
              <span>Customer</span>
              <span>Church</span>
              <span>Access</span>
              <span>Since</span>
              <span>Last sign-in</span>
              <span>Purchases</span>
              <span>Support</span>
              <span />
            </div>
            <ul className="mb-list">
              {list.map((r) => {
                const open = Number(r.open_requests) || 0;
                return (
                  <li key={r.member_key || r.email} className="mb-row">
                    <span className="mb-cell mb-who">
                      <strong>{r.display_name || r.email}</strong>
                      {r.display_name && <span className="mb-muted mb-email">{r.email}</span>}
                      {r.is_test && <span className="pill warm mb-test">Test</span>}
                    </span>
                    <span className="mb-cell" data-label="Church">
                      {r.church_name || <span className="mb-muted">Not on file</span>}
                    </span>
                    <span className="mb-cell" data-label="Access">
                      <MB_AccessChips row={r} />
                    </span>
                    <span className="mb-cell" data-label="Since">
                      {MB_fmtDate(r.since) || <span className="mb-muted">Not on file</span>}
                    </span>
                    <span className="mb-cell" data-label="Last sign-in">
                      {r.member_key ? MB_relativeTime(r.last_sign_in_at) : <span className="mb-muted">No sign-in account yet</span>}
                    </span>
                    <span className="mb-cell" data-label="Purchases">
                      {MB_purchasesSummary(r.purchases_count, r.purchases_paid_cents, r.refunds_count)}
                    </span>
                    <span className="mb-cell" data-label="Support">
                      {open + " open"}
                      <span className="mb-muted"> · {MB_supportLabel(r.support_status)}</span>
                    </span>
                    <span className="mb-cell mb-act">
                      {canOpen && r.member_key ? (
                        <button type="button" className="btn-secondary" onClick={() => (setAskError(""), setAsking(r))}>
                          Open
                        </button>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>
      {me.is_owner === true && <MB_PeopleCard />}
      {asking && <MB_ReasonDialog row={asking} busy={opening} error={askError} onCancel={() => setAsking(null)} onConfirm={confirmOpen} />}
    </div>
  );
}
