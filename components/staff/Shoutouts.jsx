// Shout-outs (owner request 2026-10-07). Staff only. supabase/staff-shoutouts.sql
//
//   SO_ShoutoutsBody     "Shout-outs" (Team → People, TeamPage.jsx; also the
//                        home card): the team feed plus a short
//                        compose form (who, optional client, note).
//   SO_ReviewShoutouts   read-only list on the manager's review form
//                        (Appreciation), for the review's quarter. Not
//                        copied into the review.
//
// The recipient's in-app notice is a "shout:" item in the top-bar bell
// (TopBar.jsx). No email. Hide = soft (hidden_at); authors hide their own,
// admins any. Top-level names use the SO_ prefix.

const SO_SETUP_MSG = "Shout-outs aren't set up yet (database step pending).";
const SO_FEED_DAYS = 90;
const SO_FEED_SHOWN = 6;

const SO_store = { rows: [], loading: true, error: null, loadedAt: 0, subs: new Set(), inflight: null };

function SO_emit() {
  SO_store.subs.forEach((fn) => {
    try {
      fn();
    } catch (e) {}
  });
}

function SO_load(force) {
  const sb = window.mgbSupabase;
  if (!sb) return Promise.resolve();
  if (SO_store.inflight) return SO_store.inflight;
  if (!force && SO_store.loadedAt && Date.now() - SO_store.loadedAt < 60 * 1000) return Promise.resolve();
  const since = new Date(Date.now() - SO_FEED_DAYS * 864e5).toISOString();
  SO_store.inflight = Promise.resolve(
    sb
      .from("staff_shoutouts")
      .select("id, from_email, to_email, body, client_id, created_at, hidden_at, hidden_by")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(200),
  )
    .then(({ data, error }) => {
      SO_store.loading = false;
      SO_store.loadedAt = Date.now();
      if (error) {
        SO_store.error = typeof isMissingTableError === "function" && isMissingTableError(error) ? SO_SETUP_MSG : error.message;
        SO_store.rows = [];
      } else {
        SO_store.error = null;
        SO_store.rows = data || [];
      }
    })
    .catch(() => {
      SO_store.loading = false;
      SO_store.error = "Couldn't load shout-outs.";
    })
    .finally(() => {
      SO_store.inflight = null;
      SO_emit();
    });
  return SO_store.inflight;
}

function SO_useStore() {
  const [, bump] = React.useReducer((n) => n + 1, 0);
  useEffect(() => {
    SO_store.subs.add(bump);
    SO_load(false);
    const on = () => SO_load(true);
    window.addEventListener(STAFF_TOOLS_EVENT, on);
    return () => {
      SO_store.subs.delete(bump);
      window.removeEventListener(STAFF_TOOLS_EVENT, on);
    };
  }, []);
  return SO_store;
}

function SO_changed() {
  SO_load(true);
  // Bell and other staff tools reload on this event.
  if (typeof notifyStaffTools === "function") notifyStaffTools();
}

function SO_name(dir, email) {
  if (typeof CV_nameOf === "function") return CV_nameOf(dir, email);
  return String(email || "").split("@")[0];
}

function SO_Item({ row, dir, me, isAdmin, clientName }) {
  const showToast = useToast();
  const [busy, setBusy] = useState(false);
  const canHide = isAdmin || String(row.from_email).toLowerCase() === me;
  async function setHidden(hide) {
    setBusy(true);
    const { error } = await window.mgbSupabase
      .from("staff_shoutouts")
      .update({ hidden_at: hide ? new Date().toISOString() : null })
      .eq("id", row.id);
    setBusy(false);
    if (error) return showToast("Couldn't update: " + error.message);
    showToast(hide ? "Shout-out hidden" : "Shout-out shown again");
    SO_changed();
  }
  const tag = row.client_id ? clientName(row.client_id) : "";
  return (
    <li className={"so-item" + (row.hidden_at ? " so-hidden" : "")}>
      <div className="so-head">
        <strong>{SO_name(dir, row.from_email)}</strong>
        <span className="so-arrow" aria-label="to">
          →
        </span>
        <strong>{SO_name(dir, row.to_email)}</strong>
        {tag && <span className="pill so-client">{tag}</span>}
        <span className="so-when">{typeof relTime === "function" ? relTime(row.created_at) : fmtDate(String(row.created_at).slice(0, 10))}</span>
      </div>
      <p className="so-body">{row.body}</p>
      {canHide && (
        <div className="so-actions">
          {row.hidden_at ? (
            <>
              <span className="so-hidden-tag">Hidden{row.hidden_by ? " by " + SO_name(dir, row.hidden_by) : ""}</span>
              <button type="button" className="link-btn" disabled={busy} onClick={() => setHidden(false)}>
                Show again
              </button>
            </>
          ) : (
            <button type="button" className="link-btn" disabled={busy} onClick={() => setHidden(true)}>
              Hide
            </button>
          )}
        </div>
      )}
    </li>
  );
}

// Today's celebration reminders open the composer with the teammate filled
// in. The People tab may not be mounted yet, so the target waits here.
let SO_pending = null;
function SO_openCompose(to) {
  SO_pending = to || null;
  if (typeof NAV_go === "function") NAV_go("team", "people");
  window.dispatchEvent(new Event("so:compose"));
}

function SO_Compose({ me, clients, onDone }) {
  const showToast = useToast();
  const [to, setTo] = useState(SO_pending || "");
  useEffect(() => {
    SO_pending = null;
  }, []);
  const [clientId, setClientId] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function send(e) {
    e.preventDefault();
    const problem = OPS_shoutoutError(to, body, me);
    if (problem) return setErr(problem);
    setErr("");
    setBusy(true);
    const { error } = await window.mgbSupabase
      .from("staff_shoutouts")
      .insert({ from_email: me, to_email: to, body: body.trim(), client_id: clientId || null });
    setBusy(false);
    if (error) {
      setErr(typeof isMissingTableError === "function" && isMissingTableError(error) ? SO_SETUP_MSG : error.message);
      return;
    }
    showToast("Shout-out sent");
    setTo("");
    setClientId("");
    setBody("");
    SO_changed();
    if (onDone) onDone();
  }
  const sorted = (clients || []).slice().sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));
  return (
    <form className="so-form" onSubmit={send}>
      <label className="task-field">
        <span>Who</span>
        {typeof CV_StaffSelect === "function" ? (
          <CV_StaffSelect value={to} onChange={setTo} emptyLabel="Pick a teammate" exclude={me} />
        ) : (
          <input type="email" value={to} onChange={(e) => setTo(e.target.value)} />
        )}
      </label>
      <label className="task-field">
        <span>Client (optional)</span>
        <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
          <option value="">None</option>
          {sorted.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name || c.id}
            </option>
          ))}
        </select>
      </label>
      <label className="task-field so-form-body">
        <span>What did they do? (the whole team can see it)</span>
        <textarea
          rows={3}
          maxLength={OPS_SHOUTOUT_MAX}
          value={body}
          placeholder="Thanks for covering the Grace close while I was out!"
          onChange={(e) => setBody(e.target.value)}
        />
        <span className="so-count">
          {body.trim().length}/{OPS_SHOUTOUT_MAX}
        </span>
      </label>
      {err && (
        <p className="cv-err so-form-body" role="alert">
          {err}
        </p>
      )}
      <div className="so-form-body cv-form-actions">
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "Sending…" : "Send shout-out"}
        </button>
        {onDone && (
          <button type="button" className="btn-secondary" onClick={onDone}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function SO_ShoutoutsBody({ clients, staffUser }) {
  const me = String((staffUser && staffUser.email) || "").toLowerCase();
  const isAdmin = !!(staffUser && staffUser.role === "admin");
  const st = SO_useStore();
  const dir = typeof CV_useDirectory === "function" ? CV_useDirectory() : [];
  const [composing, setComposing] = useState(false);
  const [all, setAll] = useState(false);
  useEffect(() => {
    const on = () => {
      if (SO_pending) setComposing(true);
    };
    on();
    window.addEventListener("so:compose", on);
    return () => window.removeEventListener("so:compose", on);
  }, []);
  const byId = {};
  (clients || []).forEach((c) => (byId[c.id] = c.name || c.id));
  // A client the viewer can't open stays untagged rather than showing an id.
  const clientName = (id) => byId[id] || "";
  const rows = st.rows;
  const shown = all ? rows : rows.slice(0, SO_FEED_SHOWN);
  return (
    <div className="so-card">
      {composing ? (
        <SO_Compose me={me} clients={clients} onDone={() => setComposing(false)} />
      ) : (
        !st.error && (
          <button type="button" className="btn-secondary so-new" onClick={() => setComposing(true)}>
            + Give a shout-out
          </button>
        )
      )}
      {st.error && <p className="card-subtitle">{st.error}</p>}
      {!st.error && st.loading && <p className="card-subtitle">Loading…</p>}
      {!st.error && !st.loading && rows.length === 0 && (
        <p className="card-subtitle so-empty">No shout-outs yet. Be the first to thank a teammate.</p>
      )}
      {shown.length > 0 && (
        <ul className="so-list">
          {shown.map((r) => (
            <SO_Item key={r.id} row={r} dir={dir} me={me} isAdmin={isAdmin} clientName={clientName} />
          ))}
        </ul>
      )}
      {rows.length > SO_FEED_SHOWN && (
        <button type="button" className="link-btn so-more" onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${rows.length} from the last ${SO_FEED_DAYS} days`}
        </button>
      )}
    </div>
  );
}

// Review form (manager side, Appreciation). Reads straight from the table
// for the review's own quarter so older reviews show their own quarter.
function SO_ReviewShoutouts({ email, name, year, quarter }) {
  const [state, setState] = useState({ loading: true, rows: [], error: null });
  const range = OPS_quarterRange(year, quarter);
  const who = String(email || "").toLowerCase();
  useEffect(() => {
    let alive = true;
    const sb = window.mgbSupabase;
    if (!sb || !who || !range) {
      setState({ loading: false, rows: [], error: null });
      return;
    }
    Promise.resolve(
      sb
        .from("staff_shoutouts")
        .select("id, from_email, body, created_at")
        .eq("to_email", who)
        .is("hidden_at", null)
        .gte("created_at", range[0])
        .lt("created_at", range[1])
        .order("created_at", { ascending: false })
        .limit(50),
    ).then(({ data, error }) => {
      if (!alive) return;
      if (error) setState({ loading: false, rows: [], error: typeof isMissingTableError === "function" && isMissingTableError(error) ? "missing" : error.message });
      else setState({ loading: false, rows: data || [], error: null });
    });
    return () => {
      alive = false;
    };
  }, [who, range && range[0]]);
  const dir = typeof CV_useDirectory === "function" ? CV_useDirectory() : [];
  if (state.error === "missing") return null;
  const now = new Date();
  const isCurrent = Number(year) === now.getFullYear() && Number(quarter) === Math.floor(now.getMonth() / 3) + 1;
  return (
    <div className="so-review" aria-live="polite">
      <div className="so-review-head">
        {isCurrent ? "Shout-outs this quarter" : `Shout-outs in Q${quarter} ${year}`} for {name || "them"}
        <span className="so-review-note"> · for reference, not part of the review</span>
      </div>
      {state.loading ? (
        <p className="tr-muted">Loading…</p>
      ) : state.error ? (
        <p className="tr-muted">Couldn't load shout-outs.</p>
      ) : state.rows.length === 0 ? (
        <p className="tr-muted">None this quarter.</p>
      ) : (
        <ul className="so-review-list">
          {state.rows.map((r) => (
            <li key={r.id}>
              <span className="so-review-from">
                {SO_name(dir, r.from_email)} · {fmtDate(String(r.created_at).slice(0, 10))}
              </span>
              <span className="so-review-body">{r.body}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
