// ----------------------------------------------------------------------------
// Team page: QuickBooks Time (owner request 2026-09-29). Staff keep tracking
// time in QuickBooks Time; it lands in the firm's own QuickBooks Online
// company as TimeActivity, and supabase/functions/qbo-firm-sync copies it into
// qbo_time_activities. This file is the admin UI on top of that
// (supabase/qbo-firm-time.sql):
//   - TP_useQboStatus / TP_QboPanel: connect, disconnect, Sync now, status.
//   - TP_QboMapping: QuickBooks customers -> clients, employees/vendors -> staff.
//   - TP_useQboHours + TP_QboPeopleTable / TP_QboClientsTable: the Team page
//     tables with QuickBooks hours, fee, effective rate and trend.
//   - TP_QboDrill: raw qbo_time_activities rows behind any table row.
// QuickBooks Time is the only source of billed hours (the manual in-app time
// log was retired 2026-09-29). The People and Clients tables also carry an
// "In app" column: automatic active time per staff/client from
// staff_app_time (supabase/app-time-tracking.sql), which TeamPage.jsx loads
// and merges into the roster rows as appMinutes / appByStaff. Those tables
// still render with only in-app time when QuickBooks isn't connected
// (qboOn = false).
// Every call fails soft. Until the migration is live the RPCs don't exist
// (PostgREST PGRST202 / 404) and the panel says "not set up" instead.
//
// Same rules as TeamPage.jsx: loaded before app.jsx in one shared global
// scope, so every top-level name carries a TP_ prefix and app.jsx globals
// (hooks, fmtDate, fmtMoney, relTime, ConfirmModal, milestoneByTier...) are
// only touched at render time.
// ----------------------------------------------------------------------------

const TP_Q_TREND_UP = 1.5; // period pace vs 3-month average that gets a flag
const TP_Q_TREND_DOWN = 0.5;
const TP_Q_TREND_MIN_DIFF = 120; // minutes; ignore tiny clients
const TP_Q_TREND_MIN_DAYS = 7; // too early in a period to judge pace
const TP_Q_DAYS_PER_MONTH = 30.44;
const TP_Q_ACT_COLS =
  "qbo_id, txn_date, name_of, employee_qbo_id, employee_name, vendor_qbo_id, vendor_name, customer_qbo_id, customer_name, minutes, billable_status, hourly_rate, description, item_name";

// "missing" = the migration isn't applied (function/table not found),
// "auth" = signed out or not an admin, "other" = anything else.
function TP_qErrorKind(error, status) {
  if (!error) return null;
  const msg = String(error.message || error || "");
  const code = error.code || "";
  if (
    code === "PGRST202" ||
    code === "PGRST205" ||
    code === "42883" ||
    code === "42P01" ||
    status === 404 ||
    /could not find the (function|table)|does not exist|schema cache/i.test(msg)
  ) {
    return "missing";
  }
  if (
    status === 401 ||
    status === 403 ||
    code === "42501" ||
    /jwt|not authenticated|not authori[sz]ed|unauthori[sz]ed|permission denied/i.test(msg)
  ) {
    return "auth";
  }
  return "other";
}

function TP_qErrorText(what, error, status) {
  const kind = TP_qErrorKind(error, status);
  if (kind === "missing") return `QuickBooks Time isn't set up on the server yet, so ${what} can't load.`;
  if (kind === "auth") return `Couldn't load ${what}: you need to be signed in as an admin.`;
  return `Couldn't load ${what}. ${String((error && error.message) || error || "")}`.trim();
}

async function TP_qRpc(name, args) {
  const supabase = window.mgbSupabase;
  if (!supabase) return { data: null, error: { message: "Supabase isn't configured." }, status: 0 };
  try {
    const res = await supabase.rpc(name, args || {});
    return { data: res.data, error: res.error, status: res.status };
  } catch (e) {
    return { data: null, error: e, status: 0 };
  }
}

const TP_qHours = (minutes) => TP_fmtHM(minutes);
const TP_qNum = (v) => Number(v || 0);

// Inclusive day count from `from` to min(to, today): how much of the period
// has actually happened, for pace.
function TP_qElapsedDays(range, today) {
  const end = range.to < today ? range.to : today;
  if (end < range.from) return 0;
  return Math.round((TP_parseYmd(end) - TP_parseYmd(range.from)) / 86400000) + 1;
}

// Bookkeeping fee for a client from its confirmed pricing milestone.
function TP_qFeeFor(tier) {
  if (tier == null || typeof milestoneByTier !== "function") return null;
  const m = milestoneByTier(tier);
  return m && m.fee != null ? m.fee : null;
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------
function TP_useQboStatus() {
  const [state, setState] = useState({ loading: true, status: null, error: null, kind: null });
  const reload = useCallback(async () => {
    const res = await TP_qRpc("qbo_firm_status");
    if (res.error) {
      setState({ loading: false, status: null, error: res.error, kind: TP_qErrorKind(res.error, res.status), httpStatus: res.status });
      return;
    }
    const row = Array.isArray(res.data) ? res.data[0] : res.data;
    setState({ loading: false, status: row || null, error: null, kind: null });
  }, []);
  useEffect(() => {
    reload();
    // Coming back from the Intuit tab (or any tab) re-reads the status, so a
    // fresh connection shows without a manual refresh.
    const onFocus = () => reload();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [reload]);
  // While a sync runs server-side, poll so "Syncing…" clears by itself.
  const inProgress = !!(state.status && state.status.sync_in_progress);
  useEffect(() => {
    if (!inProgress) return undefined;
    const t = setInterval(reload, 15000);
    return () => clearInterval(t);
  }, [inProgress, reload]);
  const st = state.status;
  // "available" = there is QuickBooks data to show (connected, or history
  // kept after a disconnect).
  const available = !!(st && (st.connected || TP_qNum(st.activity_count) > 0));
  return { ...state, reload, available };
}

function TP_QboPanel({ qbo, onOpenMapping, onSynced }) {
  const showToast = useToast();
  const [busy, setBusy] = useState(null); // "connect" | "sync" | "disconnect"
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const st = qbo.status;

  async function connect() {
    const clientId = window.QBO_CONFIG && window.QBO_CONFIG.clientId;
    if (!clientId) {
      showToast("QuickBooks isn't configured yet — see qbo-config.js.");
      return;
    }
    setBusy("connect");
    const res = await TP_qRpc("qbo_firm_connect_start", { p_intuit_client_id: clientId });
    setBusy(null);
    if (res.error || !res.data) {
      showToast("Couldn't start the QuickBooks connection: " + ((res.error && res.error.message) || "no link returned"));
      return;
    }
    window.open(String(res.data), "_blank", "noopener");
    showToast("Finish connecting in the QuickBooks tab, then come back here.");
  }

  async function syncNow() {
    const supabase = window.mgbSupabase;
    if (!supabase) return;
    setBusy("sync");
    let data = null;
    let err = null;
    try {
      const res = await supabase.functions.invoke("qbo-firm-sync", { body: { force: true, trigger: "admin" } });
      data = res.data;
      err = res.error;
      if (err && err.context && typeof err.context.json === "function") {
        try {
          const body = await err.context.json();
          if (body && body.status) {
            data = body;
            err = null;
          }
        } catch (e) {}
      }
    } catch (e) {
      err = e;
    }
    setBusy(null);
    if (err) {
      showToast("Sync failed: " + (err.message || String(err)));
    } else {
      const s = data && data.status;
      if (s === "ok") {
        const n = data.counts && (data.counts.activities ?? data.counts.time_activities);
        showToast(n != null ? `Synced ${n} time entr${n === 1 ? "y" : "ies"} from QuickBooks.` : "Synced from QuickBooks.");
      } else if (s === "fresh" || s === "not_due") showToast("Already up to date.");
      else if (s === "in_progress") showToast("A sync is already running. This updates when it finishes.");
      else if (s === "not_connected") showToast("QuickBooks isn't connected.");
      else showToast("Sync failed: " + ((data && data.error) || "unknown error"));
    }
    qbo.reload();
    if (onSynced) onSynced();
  }

  async function disconnect() {
    setConfirmDisconnect(false);
    setBusy("disconnect");
    const res = await TP_qRpc("qbo_firm_disconnect");
    setBusy(null);
    if (res.error) {
      showToast("Couldn't disconnect QuickBooks: " + res.error.message);
      return;
    }
    showToast("QuickBooks disconnected. Synced hours stay on this page.");
    qbo.reload();
  }

  const head = (
    <div className="tp-q-head">
      <span className="tp-q-logo" aria-hidden="true">QB</span>
      <div style={{ minWidth: 0 }}>
        <h3 className="card-title" style={{ margin: 0 }}>QuickBooks Time</h3>
        <p className="card-subtitle" style={{ margin: 0 }}>
          Staff hours from the firm's QuickBooks company, synced hourly.
        </p>
      </div>
    </div>
  );

  if (qbo.loading) {
    return (
      <div className="card tp-q-panel" style={{ marginBottom: 20 }}>
        {head}
        <p className="tp-muted tp-q-line">Checking the QuickBooks connection…</p>
      </div>
    );
  }

  if (qbo.error) {
    return (
      <div className="card tp-q-panel" style={{ marginBottom: 20 }}>
        {head}
        {qbo.kind === "missing" ? (
          <p className="tp-muted tp-q-line">
            Not set up yet. The QuickBooks Time sync hasn't been installed on the server, so hours
            show in-app time only. Nothing to do here until it is.
          </p>
        ) : qbo.kind === "auth" ? (
          <p className="tp-muted tp-q-line">Sign in as an admin to see the QuickBooks connection.</p>
        ) : (
          <div className="tp-q-error">
            <span>Couldn't check the QuickBooks connection. {String(qbo.error.message || "")}</span>
            <button type="button" className="btn-secondary tp-q-btn" onClick={qbo.reload}>
              Retry
            </button>
          </div>
        )}
      </div>
    );
  }

  const connected = !!(st && st.connected);
  const errored = st && st.status === "error";
  const count = TP_qNum(st && st.activity_count);
  const unmappedC = TP_qNum(st && st.unmapped_customer_count);
  const unmappedP = TP_qNum(st && st.unmapped_people_count);
  const synced = st && relTime(st.last_synced_at);
  const needsMapping = unmappedC + unmappedP > 0;

  return (
    <div className="card tp-q-panel" style={{ marginBottom: 20 }}>
      <div className="tp-q-top">
        {head}
        <div className="tp-q-actions">
          {connected ? (
            <>
              <button
                type="button"
                className="btn-primary tp-q-btn"
                onClick={syncNow}
                disabled={!!busy || st.sync_in_progress}
              >
                {busy === "sync" || st.sync_in_progress ? "Syncing…" : "Sync now"}
              </button>
              <button
                type="button"
                className="btn-secondary tp-q-btn"
                onClick={() => setConfirmDisconnect(true)}
                disabled={!!busy}
              >
                Disconnect
              </button>
            </>
          ) : (
            <button type="button" className="btn-primary tp-q-btn" onClick={connect} disabled={!!busy}>
              {busy === "connect" ? "Opening QuickBooks…" : errored ? "Reconnect QuickBooks" : "Connect QuickBooks"}
            </button>
          )}
        </div>
      </div>

      {connected || errored ? (
        <div className="tp-q-facts">
          <span className={"tp-q-dot" + (errored ? " bad" : "")} aria-hidden="true" />
          <span className="tp-q-company">{st.company_name || "Firm QuickBooks company"}</span>
          {st.api_env === "sandbox" && <span className="task-chip">Sandbox</span>}
          <span className="tp-muted">
            {st.sync_in_progress
              ? "Syncing now…"
              : synced
                ? `Last synced ${synced}`
                : "Not synced yet"}
          </span>
          {count > 0 && (
            <span className="tp-muted">
              · {count.toLocaleString("en-US")} entries
              {st.earliest_txn_date && st.latest_txn_date
                ? `, ${fmtDate(st.earliest_txn_date)} to ${fmtDate(st.latest_txn_date)}`
                : ""}
            </span>
          )}
        </div>
      ) : (
        <p className="tp-muted tp-q-line">
          Not connected. Connect the firm's own QuickBooks Online company (the one QuickBooks Time
          sends timesheets to) to see hours per client and per person here. Staff keep using
          QuickBooks Time as they do now.
          {count > 0 && ` ${count.toLocaleString("en-US")} previously synced entries still show below.`}
        </p>
      )}

      {connected && count === 0 && !st.last_error && (
        <p className="tp-q-note">
          Connected. The first sync can take about 10 minutes; hours show up here as soon as it
          finishes.
        </p>
      )}

      {st && st.last_error && (
        <div className="tp-q-error" role="alert">
          <span>
            <b>Last sync failed</b>
            {st.last_attempt_at ? ` (${relTime(st.last_attempt_at)})` : ""}: {st.last_error}
          </span>
        </div>
      )}

      {(needsMapping || (count > 0 && onOpenMapping)) && (
        <div className="tp-q-chips">
          {needsMapping && (
            <button type="button" className="tp-q-chip warn" onClick={onOpenMapping}>
              <WarningIcon width="14" height="14" />
              {[
                unmappedC ? `${unmappedC} customer${unmappedC === 1 ? "" : "s"}` : null,
                unmappedP ? `${unmappedP} ${unmappedP === 1 ? "person" : "people"}` : null,
              ]
                .filter(Boolean)
                .join(" and ")}{" "}
              need mapping
            </button>
          )}
          <button type="button" className="tp-q-chip" onClick={onOpenMapping}>
            Customer and staff mapping ›
          </button>
        </div>
      )}

      {confirmDisconnect && (
        <ConfirmModal
          title="Disconnect QuickBooks Time?"
          body="Hourly syncing stops. Hours already synced stay on the Team page. You can reconnect any time."
          confirmLabel="Disconnect"
          onConfirm={disconnect}
          onCancel={() => setConfirmDisconnect(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hours (for the People and Clients tables)
// ---------------------------------------------------------------------------
function TP_useQboHours(enabled, range, avg, version) {
  const [state, setState] = useState({ loading: !!enabled, byClient: [], avgByClient: [], byStaff: [], tiers: {}, error: null });
  useEffect(() => {
    if (!enabled) {
      setState({ loading: false, byClient: [], avgByClient: [], byStaff: [], tiers: {}, error: null });
      return undefined;
    }
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    (async () => {
      const supabase = window.mgbSupabase;
      const [c, a, s, m] = await Promise.all([
        TP_qRpc("qbo_hours_by_client", { p_from: range.from, p_to: range.to }),
        TP_qRpc("qbo_hours_by_client", { p_from: avg.from, p_to: avg.to }),
        TP_qRpc("qbo_hours_by_staff", { p_from: range.from, p_to: range.to }),
        supabase
          ? supabase.from("client_milestones").select("client_id, confirmed_tier").then(
              (r) => r,
              (e) => ({ data: null, error: e }),
            )
          : Promise.resolve({ data: null }),
      ]);
      if (!alive) return;
      const errs = [];
      if (c.error) errs.push(TP_qErrorText("QuickBooks hours by client", c.error, c.status));
      if (s.error) errs.push(TP_qErrorText("QuickBooks hours by person", s.error, s.status));
      if (m && m.error) console.warn("Team page: couldn't load pricing milestones:", m.error.message);
      const tiers = {};
      ((m && m.data) || []).forEach((r) => {
        tiers[r.client_id] = r.confirmed_tier;
      });
      setState({
        loading: false,
        byClient: c.data || [],
        avgByClient: a.data || [],
        byStaff: s.data || [],
        tiers,
        error: errs.length ? [...new Set(errs)].join(" ") : null,
      });
    })();
    return () => {
      alive = false;
    };
  }, [enabled, range.from, range.to, avg.from, avg.to, version]);
  return state;
}

// People table rows: the roster (with its task counts) joined to QuickBooks
// staff rows by email, plus unmapped/ignored/no-person buckets.
function TP_qPeopleRows(people, byStaff) {
  const byEmail = {};
  const buckets = [];
  (byStaff || []).forEach((r) => {
    if (r.bucket === "staff") byEmail[TP_lower(r.staff_email)] = r;
    else buckets.push(r);
  });
  const rows = (people || []).map((p) => ({ ...p, q: byEmail[p.email] || null }));
  const seen = new Set(rows.map((r) => r.email));
  Object.entries(byEmail).forEach(([email, q]) => {
    if (seen.has(email)) return;
    rows.push({
      email,
      name: q.staff_name || email.split("@")[0],
      role: "",
      open: 0,
      overdue: 0,
      completed: 0,
      assignedCount: 0,
      tempCount: 0,
      appMinutes: 0,
      q,
    });
  });
  rows.sort(
    (a, b) =>
      TP_qNum(b.q && b.q.total_minutes) - TP_qNum(a.q && a.q.total_minutes) ||
      TP_qNum(b.appMinutes) - TP_qNum(a.appMinutes) ||
      a.name.localeCompare(b.name),
  );
  const bucketRows = buckets.map((r) => ({
    key: r.bucket === "no_person" ? "no_person" : `${r.bucket}:${r.qbo_entity_type}:${r.qbo_person_id}`,
    bucket: r.bucket,
    label:
      r.bucket === "no_person"
        ? "No employee or vendor on the entry"
        : r.qbo_person_name || `QuickBooks ${r.qbo_entity_type || "person"} ${r.qbo_person_id}`,
    q: r,
  }));
  const total = (byStaff || []).reduce((n, r) => n + TP_qNum(r.total_minutes), 0);
  return { rows, bucketRows, total };
}

const TP_APP_TIP =
  "Automatic active time in this app (client open, tab visible, input in the last 2 minutes). Not billed hours.";

function TP_AppTh({ children }) {
  return (
    <th className="num tp-app-col" title={TP_APP_TIP}>
      {children || "In app"}
    </th>
  );
}

const TP_Q_BUCKET_LABEL = {
  unmapped: "Unmapped",
  ignored: "Ignored",
  no_customer: "No customer",
  no_person: "No person",
};

function TP_QBucketTag({ bucket }) {
  return (
    <span className={"task-chip tp-q-tag tp-q-tag-" + bucket}>{TP_Q_BUCKET_LABEL[bucket] || bucket}</span>
  );
}

function TP_QboPeopleTable({ people, hours, qboOn, onOpenPerson, onOpenBucket, onOpenMapping }) {
  const loadingPeople = people == null;
  const { rows, bucketRows, total } = useMemo(
    () => TP_qPeopleRows(people || [], hours.byStaff),
    [people, hours.byStaff],
  );
  const appTotal = rows.reduce((n, r) => n + TP_qNum(r.appMinutes), 0);
  const keyed = (fn) => (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fn();
    }
  };
  const unmappedTotal = bucketRows
    .filter((b) => b.bucket === "unmapped")
    .reduce((n, b) => n + TP_qNum(b.q.total_minutes), 0);
  const cols = 10;
  const dash = <span className="tp-muted">–</span>;
  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <h3 className="card-title">People</h3>
      <p className="card-subtitle">
        {qboOn
          ? `QuickBooks Time hours for the period${total ? ` (${TP_qHours(total)} in all)` : ""}. `
          : "QuickBooks Time isn't connected, so there are no hours yet. "}
        In app is automatic active time in the app{appTotal ? ` (${TP_qHours(appTotal)} in all)` : ""}, not billed
        hours. Open and overdue are as of today; completed is within the period. Select a row for details.
      </p>
      <div className="table-scroll">
        <table className="tx-table tx-table-labeled tp-table">
          <thead>
            <tr>
              <th>Name</th>
              <th className="num">QB hours</th>
              <TP_AppTh />
              <th className="num">Billable</th>
              <th className="num">On clients</th>
              <th className="num" title="Hours on QuickBooks customers not yet mapped to a client">Unmapped cust.</th>
              <th className="num">Open</th>
              <th className="num">Overdue</th>
              <th className="num">Completed</th>
              <th className="num">Clients</th>
            </tr>
          </thead>
          <tbody>
            {loadingPeople || (hours.loading && !hours.byStaff.length) ? (
              <EmptyRow colSpan={cols}>Loading…</EmptyRow>
            ) : rows.length === 0 && bucketRows.length === 0 ? (
              <EmptyRow colSpan={cols}>No staff to show. The roster only loads for a signed-in admin.</EmptyRow>
            ) : (
              <>
                {rows.map((p) => {
                  const q = p.q;
                  const mins = TP_qNum(q && q.total_minutes);
                  return (
                    <tr
                      key={p.email}
                      className="tp-row"
                      tabIndex={0}
                      role="button"
                      aria-label={`Open ${p.name}`}
                      onClick={() => onOpenPerson(p.email)}
                      onKeyDown={keyed(() => onOpenPerson(p.email))}
                    >
                      <td data-primary="">
                        <span className="tp-name">{p.name}</span>
                        {p.role && <span className="tp-muted tp-role">{TP_roleLabel(p.role)}</span>}
                      </td>
                      <td className="num" data-label="QB hours">{q ? TP_qHours(mins) : dash}</td>
                      <td className="num tp-app-col" data-label="In app" title={TP_APP_TIP}>
                        {p.appMinutes ? TP_qHours(p.appMinutes) : dash}
                      </td>
                      <td className="num" data-label="Billable">
                        {mins ? `${Math.round((TP_qNum(q.billable_minutes) / mins) * 100)}%` : "–"}
                      </td>
                      <td className="num" data-label="On clients">{q ? TP_qHours(q.client_minutes) : "–"}</td>
                      <td
                        className={"num" + (q && TP_qNum(q.unmapped_customer_minutes) ? " tp-q-warn" : "")}
                        data-label="Unmapped customers"
                      >
                        {q && TP_qNum(q.unmapped_customer_minutes) ? TP_qHours(q.unmapped_customer_minutes) : "–"}
                      </td>
                      <td className="num" data-label="Open">{p.open}</td>
                      <td className={"num" + (p.overdue ? " tp-bad" : "")} data-label="Overdue">{p.overdue}</td>
                      <td className="num" data-label="Completed">{p.completed}</td>
                      <td className="num" data-label="Clients">
                        {p.assignedCount}
                        {p.tempCount > 0 && <span className="tp-muted tp-temp"> +{p.tempCount} temporary</span>}
                      </td>
                    </tr>
                  );
                })}
                {bucketRows.map((b) => {
                  const mins = TP_qNum(b.q.total_minutes);
                  return (
                    <tr
                      key={b.key}
                      className="tp-row tp-q-bucket-row"
                      tabIndex={0}
                      role="button"
                      aria-label={`Open ${b.label}`}
                      onClick={() => onOpenBucket(b)}
                      onKeyDown={keyed(() => onOpenBucket(b))}
                    >
                      <td data-primary="">
                        <span className="tp-name">{b.label}</span> <TP_QBucketTag bucket={b.bucket} />
                        {b.q.qbo_entity_type && <span className="tp-muted tp-role">QuickBooks {b.q.qbo_entity_type}</span>}
                      </td>
                      <td className="num" data-label="QB hours">{TP_qHours(mins)}</td>
                      <td className="num tp-muted" data-label="In app">–</td>
                      <td className="num" data-label="Billable">
                        {mins ? `${Math.round((TP_qNum(b.q.billable_minutes) / mins) * 100)}%` : "–"}
                      </td>
                      <td className="num" data-label="On clients">{TP_qHours(b.q.client_minutes)}</td>
                      <td className="num" data-label="Unmapped customers">
                        {TP_qNum(b.q.unmapped_customer_minutes) ? TP_qHours(b.q.unmapped_customer_minutes) : "–"}
                      </td>
                      <td className="num tp-muted" data-label="Open">–</td>
                      <td className="num tp-muted" data-label="Overdue">–</td>
                      <td className="num tp-muted" data-label="Completed">–</td>
                      <td className="num tp-muted" data-label="Clients">{TP_qNum(b.q.client_count) || "–"}</td>
                    </tr>
                  );
                })}
              </>
            )}
          </tbody>
        </table>
      </div>
      {unmappedTotal > 0 && (
        <p className="tp-muted" style={{ marginTop: 10 }}>
          {TP_qHours(unmappedTotal)} is logged by QuickBooks people not mapped to a staff member.{" "}
          <button type="button" className="tp-q-link" onClick={onOpenMapping}>Map them</button>
        </p>
      )}
    </div>
  );
}

// Clients table rows: the roster joined to QuickBooks client rows, plus
// buckets so the column total matches everything QuickBooks logged.
function TP_qClientRows({ clientRows, hours, range, today }) {
  const byId = {};
  const avgById = {};
  const buckets = [];
  (hours.byClient || []).forEach((r) => {
    if (r.bucket === "client") byId[r.client_id] = r;
    else buckets.push(r);
  });
  (hours.avgByClient || []).forEach((r) => {
    if (r.bucket === "client") avgById[r.client_id] = TP_qNum(r.total_minutes) / 3;
  });
  const elapsed = TP_qElapsedDays(range, today);
  const decorate = (base, q) => {
    const minutes = TP_qNum(q && q.total_minutes);
    const avgMinutes = avgById[base.id] || 0;
    const tier = hours.tiers[base.id];
    const fee = TP_qFeeFor(tier);
    const monthlyEq = elapsed > 0 ? (minutes * TP_Q_DAYS_PER_MONTH) / elapsed : 0;
    // Effective rate on a steady basis: the 3-month average, or this
    // period's pace for a client with no history yet.
    const basis = avgMinutes > 0 ? avgMinutes : elapsed >= TP_Q_TREND_MIN_DAYS ? monthlyEq : 0;
    const rate = fee != null && basis > 0 ? fee / (basis / 60) : null;
    let trend = null;
    if (elapsed >= TP_Q_TREND_MIN_DAYS) {
      if (avgMinutes > 0 && monthlyEq >= avgMinutes * TP_Q_TREND_UP && monthlyEq - avgMinutes >= TP_Q_TREND_MIN_DIFF) {
        trend = { dir: "up", pct: Math.round((monthlyEq / avgMinutes - 1) * 100) };
      } else if (avgMinutes >= TP_Q_TREND_MIN_DIFF && monthlyEq <= avgMinutes * TP_Q_TREND_DOWN) {
        trend = { dir: "down", pct: Math.round((1 - monthlyEq / avgMinutes) * 100) };
      } else if (!avgMinutes && monthlyEq >= 300) {
        trend = { dir: "new" };
      }
    }
    return { ...base, q, qMinutes: minutes, qAvgMinutes: avgMinutes, tier, fee, rate, basis, trend, monthlyEq };
  };
  const rows = (clientRows || []).map((r) => decorate(r, byId[r.id] || null));
  const seen = new Set(rows.map((r) => r.id));
  Object.values(byId).forEach((q) => {
    if (seen.has(q.client_id)) return;
    rows.push(
      decorate(
        { id: q.client_id, name: q.client_name || "Unknown client", plan: null, known: false, open: 0, overdue: 0, appMinutes: 0, appByStaff: [] },
        q,
      ),
    );
  });
  const bucketRows = buckets.map((r) => ({
    key: r.bucket === "no_customer" ? "no_customer" : `${r.bucket}:${r.qbo_customer_id}`,
    bucket: r.bucket,
    label:
      r.bucket === "no_customer"
        ? "No customer on the entry (internal time)"
        : r.qbo_customer_name || `QuickBooks customer ${r.qbo_customer_id}`,
    q: r,
  }));
  const total = (hours.byClient || []).reduce((n, r) => n + TP_qNum(r.total_minutes), 0);
  return { rows, bucketRows, total };
}

function TP_QTrend({ trend }) {
  if (!trend) return null;
  if (trend.dir === "up")
    return (
      <span className="task-chip bad tp-q-trend" title="Hours pace this period vs the 3-month monthly average">
        ▲ {trend.pct}% vs avg
      </span>
    );
  if (trend.dir === "down")
    return (
      <span className="task-chip tp-q-trend" title="Hours pace this period vs the 3-month monthly average">
        ▼ {trend.pct}% vs avg
      </span>
    );
  return <span className="task-chip tp-q-trend">New hours</span>;
}

// profit: TP_PF_useProfit() state, passed only for admins. Without it the
// fee, rate, cost, profit and margin columns are not rendered at all.
function TP_QboClientsTable({ clientRows, hours, qboOn, range, today, avg, onOpenClient, onOpenBucket, onOpenMapping, profit }) {
  const showMoney = !!profit;
  const pv = (id) => TP_PF_rowView(profit, qboOn, id);
  // Hours budget (HoursBudget.jsx): admins only, always this calendar month.
  const budgets = HB_useBudgets(showMoney);
  const budgetRatio = (id) => {
    const st = budgets && budgets.byClient[id];
    return st ? st.ratio : null;
  };
  // key null = default: QuickBooks hours when connected, in-app time otherwise.
  const [sortState, setSort] = useState({ key: null, dir: "desc" });
  const sort = sortState.key ? sortState : { key: qboOn ? "hours" : "app", dir: sortState.dir };
  const [showIdle, setShowIdle] = useState(false);
  const loadingRows = clientRows == null;
  const built = useMemo(
    () => TP_qClientRows({ clientRows: clientRows || [], hours, range, today }),
    [clientRows, hours, range, today],
  );
  const rows = useMemo(() => {
    const list = showIdle
      ? built.rows
      : built.rows.filter((r) => r.qMinutes || r.qAvgMinutes || r.appMinutes || r.open);
    const dir = sort.dir === "asc" ? 1 : -1;
    const val = {
      hours: (r) => r.qMinutes,
      app: (r) => TP_qNum(r.appMinutes),
      avg: (r) => r.qAvgMinutes,
      value: (r) => TP_qNum(r.q && r.q.billable_value),
      rate: (r) => TP_PF_orLast(showMoney ? TP_PF_effRate(pv(r.id).fee, r) : null, sort.dir),
      name: (r) => r.name.toLowerCase(),
      // Rows with no figure sort last whichever way.
      fee: (r) => TP_PF_orLast(showMoney ? pv(r.id).fee : null, sort.dir),
      cost: (r) => TP_PF_orLast(showMoney ? pv(r.id).cost : null, sort.dir),
      profit: (r) => TP_PF_orLast(showMoney ? pv(r.id).profit : null, sort.dir),
      margin: (r) => TP_PF_orLast(showMoney ? pv(r.id).margin : null, sort.dir),
      budget: (r) => TP_PF_orLast(showMoney ? budgetRatio(r.id) : null, sort.dir),
    }[sort.key] || ((r) => r.qMinutes);
    return [...list].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      if (x < y) return -1 * dir;
      if (x > y) return 1 * dir;
      return a.name.localeCompare(b.name);
    });
  }, [built, sort, showIdle, profit, qboOn, budgets]);
  const toggle = (key) =>
    setSort(() =>
      sort.key === key ? { key, dir: sort.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "name" || key === "rate" || key === "margin" ? "asc" : "desc" },
    );
  const mark = (key) => (sort.key === key ? (sort.dir === "asc" ? " ↑" : " ↓") : "");
  const keyed = (fn) => (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fn();
    }
  };
  const flagged = built.rows.filter((r) => r.trend && r.trend.dir === "up").length;
  const unmapped = built.bucketRows.filter((b) => b.bucket === "unmapped");
  const unmappedMin = unmapped.reduce((n, b) => n + TP_qNum(b.q.total_minutes), 0);
  const clientMin = built.rows.reduce((n, r) => n + r.qMinutes, 0);
  const otherMin = built.total - clientMin - unmappedMin;
  const appTotal = built.rows.reduce((n, r) => n + TP_qNum(r.appMinutes), 0);
  const cols = showMoney ? 15 : 9;
  const dash = <span className="tp-muted">–</span>;
  const leastFirst = sort.key === "margin" && sort.dir === "asc";

  return (
    <div className="card">
      <div className="tp-card-head">
        <div>
          <h3 className="card-title" style={{ marginBottom: 2 }}>Clients</h3>
          <p className="card-subtitle" style={{ margin: 0 }}>
            {qboOn
              ? `QuickBooks Time hours next to the monthly average for ${avg.label}. ${showMoney ? "Effective rate is the monthly fee ÷ average monthly hours. Cost is hours × each person's loaded hourly cost; margin is profit ÷ revenue for the period. " : ""}`
              : "QuickBooks Time isn't connected, so there are no hours yet. "}
            In app is automatic active time in the app{appTotal ? ` (${TP_qHours(appTotal)} in all)` : ""}, not
            billed hours. Select a row for details.
          </p>
        </div>
        <div className="tp-card-actions">
          {showMoney && (
            <button
              type="button"
              className={"task-chip tp-sort-chip" + (leastFirst ? " active" : "")}
              aria-pressed={leastFirst}
              onClick={() => setSort({ key: "margin", dir: "asc" })}
            >
              Least profitable first
            </button>
          )}
          <label className="tp-check">
            <input type="checkbox" checked={showIdle} onChange={(e) => setShowIdle(e.target.checked)} />
            Show clients with no activity
          </label>
        </div>
      </div>
      {showMoney && <TP_PF_SummaryStrip profit={profit} qboOn={qboOn} />}
      {built.total > 0 && (
        <p className="tp-q-recon">
          <b>{TP_qHours(built.total)}</b> logged = {TP_qHours(clientMin)} on clients
          {unmappedMin ? <> + <span className="tp-q-warn">{TP_qHours(unmappedMin)} unmapped</span></> : null}
          {otherMin > 0 ? ` + ${TP_qHours(otherMin)} ignored or internal` : ""}
          {flagged > 0 && (
            <>
              {" · "}
              <span className="tp-bad">{flagged} client{flagged === 1 ? "" : "s"} well above average</span>
            </>
          )}
        </p>
      )}
      <div className="tp-sort-mobile">
        <span className="tp-muted">Sort by</span>
        {[
          ["hours", "QB hours"],
          ["app", "In app"],
          ["avg", "Avg / mo"],
          ...(showMoney
            ? [
                ["rate", "Rate"],
                ["profit", "Profit"],
                ["margin", "Margin"],
                ["budget", "Budget"],
              ]
            : []),
          ["name", "Name"],
        ].map(([k, l]) => (
          <button
            key={k}
            type="button"
            className={"task-chip tp-sort-chip" + (sort.key === k ? " active" : "")}
            onClick={() => toggle(k)}
          >
            {l}
            {mark(k)}
          </button>
        ))}
      </div>
      <div className="table-scroll">
        <table className="tx-table tx-table-labeled tp-table">
          <thead>
            <tr>
              <th>
                <button type="button" className="tp-sort" onClick={() => toggle("name")}>Client{mark("name")}</button>
              </th>
              <th>Plan</th>
              <th className="num">
                <button type="button" className="tp-sort" onClick={() => toggle("hours")}>QB hours{mark("hours")}</button>
              </th>
              <th className="num tp-app-col" title={TP_APP_TIP}>
                <button type="button" className="tp-sort" onClick={() => toggle("app")}>In app{mark("app")}</button>
              </th>
              <th className="num">
                <button type="button" className="tp-sort" onClick={() => toggle("avg")}>Avg / mo{mark("avg")}</button>
              </th>
              <th>Trend</th>
              <th className="num">
                <button type="button" className="tp-sort" onClick={() => toggle("value")}>Billable value{mark("value")}</button>
              </th>
              {showMoney && (
                <>
                  <th className="num" title="Actual monthly fee, or the pricing tier's fee when none is set">
                    <button type="button" className="tp-sort" onClick={() => toggle("fee")}>Fee / mo{mark("fee")}</button>
                  </th>
                  <th className="num">
                    <button type="button" className="tp-sort" onClick={() => toggle("rate")}>Eff. rate{mark("rate")}</button>
                  </th>
                  <th className="num">
                    <button type="button" className="tp-sort" onClick={() => toggle("cost")}>Cost{mark("cost")}</button>
                  </th>
                  <th className="num">
                    <button type="button" className="tp-sort" onClick={() => toggle("profit")}>Profit{mark("profit")}</button>
                  </th>
                  <th className="num">
                    <button type="button" className="tp-sort" onClick={() => toggle("margin")}>Margin %{mark("margin")}</button>
                  </th>
                  <th className="num" title="QuickBooks Time hours this calendar month against the client's monthly hours budget (set on the client overview). Amber from 80%, red at 100%.">
                    <button type="button" className="tp-sort" onClick={() => toggle("budget")}>Budget (this month){mark("budget")}</button>
                  </th>
                </>
              )}
              <th className="num">Open</th>
              <th className="num">Overdue</th>
            </tr>
          </thead>
          <tbody>
            {loadingRows || (hours.loading && !hours.byClient.length) ? (
              <EmptyRow colSpan={cols}>Loading…</EmptyRow>
            ) : rows.length === 0 && built.bucketRows.length === 0 ? (
              <EmptyRow colSpan={cols}>
                {showIdle ? "No clients to show." : "No hours, in-app time or open tasks in this period."}
              </EmptyRow>
            ) : (
              <>
                {rows.map((r) => {
                  const m = showMoney ? pv(r.id) : null;
                  return (
                  <tr
                    key={r.id}
                    className="tp-row"
                    tabIndex={0}
                    role="button"
                    aria-label={`Open ${r.name}`}
                    onClick={() => onOpenClient(r.id)}
                    onKeyDown={keyed(() => onOpenClient(r.id))}
                  >
                    <td data-primary="">
                      <span className="tp-name">{r.name}</span>
                    </td>
                    <td data-label="Plan">{r.known ? planLabel(r.plan) : "–"}</td>
                    <td className="num" data-label="QB hours">{qboOn ? TP_qHours(r.qMinutes) : dash}</td>
                    <td className="num tp-app-col" data-label="In app" title={TP_APP_TIP}>
                      {r.appMinutes ? TP_qHours(r.appMinutes) : dash}
                    </td>
                    <td className="num" data-label={`Avg / mo (${avg.label})`}>{qboOn ? TP_qHours(r.qAvgMinutes) : dash}</td>
                    <td data-label="Trend">{r.trend ? <TP_QTrend trend={r.trend} /> : <span className="tp-muted">–</span>}</td>
                    <td className="num" data-label="Billable value">
                      {r.q && TP_qNum(r.q.billable_value) ? fmtMoney(TP_qNum(r.q.billable_value)) : "–"}
                    </td>
                    {showMoney && (
                      <>
                        <td className="num" data-label="Fee / mo">
                          {m.fee != null ? (
                            <span>
                              {fmtMoney(m.fee)}
                              <TP_PF_FeeTag source={m.feeSource} />
                            </span>
                          ) : (
                            "–"
                          )}
                        </td>
                        <td className="num" data-label="Effective rate">
                          {TP_PF_effRate(m.fee, r) != null ? `${fmtMoney(TP_PF_effRate(m.fee, r))}/h` : "–"}
                        </td>
                        <td className="num" data-label="Cost">
                          <span>
                            {m.cost != null ? fmtMoney(Math.round(m.cost)) : dash}
                            {m.estimated && <span className="tp-muted" title="Part of this cost uses the average rate"> est.</span>}
                          </span>
                        </td>
                        <td className={"num" + (m.profit != null && m.profit < 0 ? " tp-bad" : "")} data-label="Profit">
                          {m.profit != null ? fmtMoney(Math.round(m.profit)) : dash}
                        </td>
                        <td className="num" data-label="Margin %">
                          <TP_PF_MarginChip margin={m.margin} target={profit.target} />
                        </td>
                        <td className="num" data-label="Budget (this month)">
                          <HB_Cell data={budgets} clientId={r.id} />
                        </td>
                      </>
                    )}
                    <td className="num" data-label="Open">{r.open}</td>
                    <td className={"num" + (r.overdue ? " tp-bad" : "")} data-label="Overdue">{r.overdue}</td>
                  </tr>
                  );
                })}
                {built.bucketRows.map((b) => (
                  <tr
                    key={b.key}
                    className="tp-row tp-q-bucket-row"
                    tabIndex={0}
                    role="button"
                    aria-label={`Open ${b.label}`}
                    onClick={() => onOpenBucket(b)}
                    onKeyDown={keyed(() => onOpenBucket(b))}
                  >
                    <td data-primary="">
                      <span className="tp-name">{b.label}</span> <TP_QBucketTag bucket={b.bucket} />
                    </td>
                    <td className="tp-muted" data-label="Plan">–</td>
                    <td className={"num" + (b.bucket === "unmapped" ? " tp-q-warn" : "")} data-label="QB hours">
                      {TP_qHours(b.q.total_minutes)}
                    </td>
                    <td className="num tp-muted" data-label="In app">–</td>
                    <td className="num tp-muted" data-label="Avg / mo">–</td>
                    <td className="tp-muted" data-label="Trend">–</td>
                    <td className="num" data-label="Billable value">
                      {TP_qNum(b.q.billable_value) ? fmtMoney(TP_qNum(b.q.billable_value)) : "–"}
                    </td>
                    {showMoney && (
                      <>
                        <td className="num tp-muted" data-label="Fee / mo">–</td>
                        <td className="num tp-muted" data-label="Effective rate">–</td>
                        <td className="num tp-muted" data-label="Cost">–</td>
                        <td className="num tp-muted" data-label="Profit">–</td>
                        <td className="num tp-muted" data-label="Margin %">–</td>
                        <td className="num tp-muted" data-label="Budget (this month)">–</td>
                      </>
                    )}
                    <td className="num tp-muted" data-label="Open">–</td>
                    <td className="num tp-muted" data-label="Overdue">–</td>
                  </tr>
                ))}
              </>
            )}
          </tbody>
        </table>
      </div>
      {unmapped.length > 0 && (
        <p className="tp-muted" style={{ marginTop: 10 }}>
          {unmapped.length} QuickBooks customer{unmapped.length === 1 ? "" : "s"} with hours {unmapped.length === 1 ? "isn't" : "aren't"} mapped to a client yet.{" "}
          <button type="button" className="tp-q-link" onClick={onOpenMapping}>Map them</button>
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Drill-down: raw qbo_time_activities rows
// ---------------------------------------------------------------------------
const TP_qQuote = (v) => `"${String(v).replace(/"/g, "")}"`;
const TP_qChunk = (arr, n) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

// spec.kind: client | customer-unmapped | customer-ignored | no-customer |
//            staff | person | no-person
async function TP_qFetchActivities(spec, range) {
  const supabase = window.mgbSupabase;
  if (!supabase) return { data: [], error: { message: "Supabase isn't configured." } };
  const base = () =>
    supabase
      .from("qbo_time_activities")
      .select(TP_Q_ACT_COLS)
      .gte("txn_date", range.from)
      .lte("txn_date", range.to)
      .order("txn_date", { ascending: false })
      .order("qbo_id");

  const byCustomers = async (ids) => {
    if (!ids.length) return { data: [], error: null };
    let out = [];
    for (const part of TP_qChunk(ids, 100)) {
      const r = await TP_fetchAll(() => base().in("customer_qbo_id", part));
      if (r.error) return r;
      out = out.concat(r.data);
    }
    out.sort((a, b) => b.txn_date.localeCompare(a.txn_date));
    return { data: out, error: null };
  };
  const byPeople = async (people) => {
    const emp = people.filter((p) => p.type === "Employee").map((p) => TP_qQuote(p.id));
    const ven = people.filter((p) => p.type === "Vendor").map((p) => TP_qQuote(p.id));
    const parts = [];
    if (emp.length) parts.push(`employee_qbo_id.in.(${emp.join(",")})`);
    if (ven.length) parts.push(`and(employee_qbo_id.is.null,vendor_qbo_id.in.(${ven.join(",")}))`);
    if (!parts.length) return { data: [], error: null };
    return TP_fetchAll(() => base().or(parts.join(",")));
  };
  const resolution = async (build) => {
    const r = await TP_fetchAll(() => build(supabase.from("qbo_customer_resolution").select("qbo_customer_id")).order("qbo_customer_id"));
    return r.error ? { error: r.error } : { ids: r.data.map((x) => x.qbo_customer_id) };
  };

  if (spec.kind === "client") {
    const r = await resolution((q) => q.eq("client_id", spec.clientId));
    return r.error ? { data: [], error: r.error } : byCustomers(r.ids);
  }
  if (spec.kind === "customer-unmapped") {
    const r = await resolution((q) =>
      q.eq("root_qbo_customer_id", spec.rootId).is("client_id", null).eq("ignored", false),
    );
    if (r.error) return { data: [], error: r.error };
    // A customer the sync hasn't catalogued yet has no resolution row; fall
    // back to the id itself.
    return byCustomers(r.ids.length ? r.ids : [spec.rootId]);
  }
  if (spec.kind === "customer-ignored") {
    const r = await resolution((q) => q.eq("resolved_via_qbo_id", spec.viaId).eq("ignored", true));
    return r.error ? { data: [], error: r.error } : byCustomers(r.ids.length ? r.ids : [spec.viaId]);
  }
  if (spec.kind === "no-customer") {
    return TP_fetchAll(() => base().is("customer_qbo_id", null));
  }
  if (spec.kind === "staff") {
    const m = await TP_fetchAll(() =>
      supabase
        .from("qbo_employee_staff_map")
        .select("qbo_entity_type, qbo_id, staff_email")
        .ilike("staff_email", spec.email)
        .order("qbo_id"),
    );
    if (m.error) return { data: [], error: m.error };
    return byPeople(m.data.map((x) => ({ type: x.qbo_entity_type, id: x.qbo_id })));
  }
  if (spec.kind === "person") {
    return byPeople([{ type: spec.type, id: spec.id }]);
  }
  if (spec.kind === "no-person") {
    return TP_fetchAll(() => base().is("employee_qbo_id", null).is("vendor_qbo_id", null));
  }
  return { data: [], error: null };
}

// Turns a bucket row from either table into a drill-down spec + title.
function TP_qBucketSpec(b) {
  const q = b.q;
  if (b.bucket === "no_customer") return { kind: "no-customer" };
  if (b.bucket === "no_person") return { kind: "no-person" };
  if (q.qbo_person_id) return { kind: "person", type: q.qbo_entity_type, id: q.qbo_person_id };
  if (b.bucket === "ignored") return { kind: "customer-ignored", viaId: q.qbo_customer_id };
  return { kind: "customer-unmapped", rootId: q.qbo_customer_id };
}

const TP_qPersonName = (a) => a.employee_name || a.vendor_name || "No person";
const TP_qIsBillable = (a) => a.billable_status === "Billable" || a.billable_status === "HasBeenBilled";

function TP_QboDrill({ spec, range, groupBy, emptyText }) {
  const [state, setState] = useState({ loading: true, rows: [], error: null });
  const specKey = JSON.stringify(spec);
  useEffect(() => {
    let alive = true;
    setState({ loading: true, rows: [], error: null });
    TP_qFetchActivities(spec, range).then((r) => {
      if (!alive) return;
      setState({
        loading: false,
        rows: r.data || [],
        error: r.error ? TP_qErrorText("QuickBooks entries", r.error, r.error.status) : null,
      });
    });
    return () => {
      alive = false;
    };
  }, [specKey, range.from, range.to]);

  const rows = state.rows;
  const totals = useMemo(() => {
    let minutes = 0;
    let billable = 0;
    let value = 0;
    const groups = {};
    rows.forEach((a) => {
      const m = a.minutes || 0;
      minutes += m;
      if (TP_qIsBillable(a)) billable += m;
      if (a.hourly_rate != null) value += (m / 60) * Number(a.hourly_rate);
      const g = groupBy === "customer" ? a.customer_name || "No customer" : TP_qPersonName(a);
      groups[g] = (groups[g] || 0) + m;
    });
    const list = Object.entries(groups)
      .map(([name, m]) => ({ name, minutes: m }))
      .sort((a, b) => b.minutes - a.minutes);
    return { minutes, billable, value, list };
  }, [rows, groupBy]);
  const barEntries = useMemo(
    () => rows.map((a) => ({ entry_date: a.txn_date, minutes: a.minutes || 0 })),
    [rows],
  );
  const max = totals.list.length ? totals.list[0].minutes : 0;

  if (state.loading) {
    return (
      <div className="card" style={{ marginBottom: 20 }}>
        <p className="card-subtitle" style={{ margin: 0 }}>Loading QuickBooks entries…</p>
      </div>
    );
  }
  if (state.error) {
    return (
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="tp-q-error" style={{ marginTop: 0 }}>
          <span>{state.error}</span>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="tp-stats" style={{ marginTop: 0 }}>
          <TP_Stat label="QB hours" value={TP_qHours(totals.minutes)} />
          <TP_Stat label="Billable hours" value={TP_qHours(totals.billable)} />
          <TP_Stat label="Billable value" value={totals.value ? fmtMoney(totals.value) : "–"} />
          <TP_Stat label="Entries" value={rows.length} />
        </div>
      </div>
      <div className="tp-detail-grid">
        <div className="card">
          <h3 className="card-title">{groupBy === "customer" ? "Hours by QuickBooks customer" : "Hours by person"}</h3>
          {totals.list.length === 0 ? (
            <p className="card-subtitle">{emptyText || "No QuickBooks time in this period."}</p>
          ) : (
            <div className="tp-staff-bars">
              {totals.list.map((g) => (
                <div key={g.name}>
                  <div className="tp-staff-bar-head">
                    <span className="tp-q-ellipsis">{g.name}</span>
                    <span className="tp-muted">{TP_qHours(g.minutes)}</span>
                  </div>
                  <div className="bar-track">
                    <div className="bar-fill usage" style={{ width: max ? `${(g.minutes / max) * 100}%` : "0%" }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="card">
          <h3 className="card-title">Hours over the period</h3>
          <TP_HoursBars entries={barEntries} range={range} />
        </div>
      </div>
      <div className="card" style={{ marginBottom: 20 }}>
        <h3 className="card-title">QuickBooks Time entries</h3>
        <p className="card-subtitle">
          {rows.length} entr{rows.length === 1 ? "y" : "ies"} in the period, as synced from QuickBooks.
        </p>
        <div className="table-scroll">
          <table className="tx-table tx-table-labeled">
            <thead>
              <tr>
                <th>Date</th>
                <th>Person</th>
                <th>Customer</th>
                <th>Description</th>
                <th className="num">Hours</th>
                <th>Billable</th>
                <th className="num">Rate</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <EmptyRow colSpan={7}>{emptyText || "No QuickBooks time in this period."}</EmptyRow>
              ) : (
                rows.map((a) => (
                  <tr key={a.qbo_id}>
                    <td data-label="Date">{fmtDate(a.txn_date)}</td>
                    <td data-label="Person">{TP_qPersonName(a)}</td>
                    <td data-label="Customer">{a.customer_name || <span className="tp-muted">None</span>}</td>
                    <td data-label="Description" className="tp-desc">
                      {a.description || a.item_name || <span className="tp-muted">No description</span>}
                      {a.description && a.item_name && <span className="tp-muted tp-role">{a.item_name}</span>}
                    </td>
                    <td className="num" data-label="Hours">{TP_qHours(a.minutes)}</td>
                    <td data-label="Billable">
                      {a.billable_status === "HasBeenBilled" ? "Billed" : TP_qIsBillable(a) ? "Yes" : "No"}
                    </td>
                    <td className="num" data-label="Rate">
                      {a.hourly_rate != null ? fmtMoney(Number(a.hourly_rate), { cents: true }) : "–"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

// Detail page for a client, a person, or a bucket row, in QuickBooks mode.
function TP_QboDetail({ title, subtitle, stats, spec, groupBy, range, onBack, backLabel, children, note, showQbo = true, beforeQbo }) {
  return (
    <div>
      <div className="card" style={{ marginBottom: 20 }}>
        <TP_BackBar label={backLabel || "Back to team"} onBack={onBack} title={title} subtitle={subtitle} />
        {stats && stats.length > 0 && (
          <div className="tp-stats">
            {stats.map((s) => (
              <TP_Stat key={s.label} label={s.label} value={s.value} bad={s.bad} />
            ))}
          </div>
        )}
        {note}
      </div>
      {beforeQbo}
      {showQbo && <TP_QboDrill spec={spec} range={range} groupBy={groupBy} />}
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------
function TP_QClientPicker({ clients, value, onPick, disabled, label }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const inputRef = useRef(null);
  const current = value ? clients.find((c) => c.id === value) : null;
  const matches = useMemo(() => {
    const t = TP_lower(q);
    return clients.filter((c) => !t || TP_lower(c.name).includes(t)).slice(0, 60);
  }, [clients, q]);
  const pick = (c) => {
    setOpen(false);
    setQ("");
    if (inputRef.current) inputRef.current.blur();
    if (!current || current.id !== c.id) onPick(c.id);
  };
  return (
    <div className="tp-q-picker">
      <input
        ref={inputRef}
        type="text"
        className="tp-q-input"
        value={open ? q : current ? current.name : ""}
        placeholder={current ? current.name : "Choose a client…"}
        disabled={disabled}
        aria-label={label || "Client"}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        onFocus={() => {
          setOpen(true);
          setQ("");
          setHi(0);
        }}
        onBlur={() => setOpen(false)}
        onChange={(e) => {
          setQ(e.target.value);
          setHi(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHi((h) => Math.min(h + 1, matches.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHi((h) => Math.max(h - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (matches[hi]) pick(matches[hi]);
          } else if (e.key === "Escape") {
            e.currentTarget.blur();
          }
        }}
      />
      {open && (
        <ul className="tp-q-picker-list" role="listbox">
          {matches.length === 0 ? (
            <li className="tp-q-picker-empty">No matching clients</li>
          ) : (
            matches.map((c, i) => (
              <li
                key={c.id}
                role="option"
                aria-selected={i === hi}
                className={(i === hi ? "active" : "") + (current && current.id === c.id ? " current" : "")}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(c);
                }}
                onMouseEnter={() => setHi(i)}
              >
                {c.name}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

function TP_QStatusTag({ tone, children }) {
  return <span className={"tp-q-status" + (tone ? " " + tone : "")}>{children}</span>;
}

function TP_QboMapping({ qbo, clients, staff, onBack, onChanged }) {
  const showToast = useToast();
  const [tab, setTab] = useState("customers");
  const [filter, setFilter] = useState("needs"); // needs | all
  const [search, setSearch] = useState("");
  const [version, setVersion] = useState(0);
  const [busyKey, setBusyKey] = useState(null);
  const [state, setState] = useState({ loading: true, customers: [], resolution: {}, people: [], hoursC: {}, hoursP: {}, error: null });
  const st = qbo.status || {};

  useEffect(() => {
    let alive = true;
    const supabase = window.mgbSupabase;
    if (!supabase) {
      setState((s) => ({ ...s, loading: false, error: "Supabase isn't configured." }));
      return undefined;
    }
    setState((s) => ({ ...s, loading: true }));
    // Hours over everything synced, so the big unmapped ones sort first.
    const from = st.earliest_txn_date || "2000-01-01";
    const to = st.latest_txn_date || TP_ymd(new Date());
    (async () => {
      const [cm, rs, pm, hc, hp] = await Promise.all([
        TP_fetchAll(() =>
          supabase
            .from("qbo_customer_client_map")
            .select("realm_id, qbo_customer_id, customer_name, company_name, fully_qualified_name, parent_qbo_id, is_job, active, client_id, ignored, manual, auto_matched, updated_by, updated_at")
            .order("qbo_customer_id"),
        ),
        TP_fetchAll(() =>
          supabase
            .from("qbo_customer_resolution")
            .select("realm_id, qbo_customer_id, client_id, ignored, resolved_via_qbo_id, root_qbo_customer_id, root_customer_name")
            .order("qbo_customer_id"),
        ),
        TP_fetchAll(() =>
          supabase
            .from("qbo_employee_staff_map")
            .select("realm_id, qbo_entity_type, qbo_id, display_name, qbo_email, active, staff_email, ignored, manual, auto_matched, updated_by, updated_at")
            .order("qbo_id"),
        ),
        TP_qRpc("qbo_hours_by_client", { p_from: from, p_to: to }),
        TP_qRpc("qbo_hours_by_staff", { p_from: from, p_to: to }),
      ]);
      if (!alive) return;
      const realm = st.realm_id;
      const inRealm = (r) => !realm || r.realm_id === realm;
      const resolution = {};
      (rs.data || []).filter(inRealm).forEach((r) => {
        resolution[r.qbo_customer_id] = r;
      });
      const hoursC = {};
      (hc.data || []).forEach((r) => {
        if (r.bucket === "unmapped" || r.bucket === "ignored") hoursC[r.qbo_customer_id] = TP_qNum(r.total_minutes);
      });
      const hoursP = {};
      (hp.data || []).forEach((r) => {
        if (r.bucket === "unmapped" || r.bucket === "ignored") hoursP[`${r.qbo_entity_type}:${r.qbo_person_id}`] = TP_qNum(r.total_minutes);
      });
      const err = cm.error || pm.error || rs.error;
      setState({
        loading: false,
        customers: (cm.data || []).filter(inRealm),
        resolution,
        people: (pm.data || []).filter(inRealm),
        hoursC,
        hoursP,
        error: err ? TP_qErrorText("the QuickBooks mapping", err, err.status) : null,
      });
    })();
    return () => {
      alive = false;
    };
  }, [version, st.realm_id, st.earliest_txn_date, st.latest_txn_date]);

  const clientList = useMemo(
    () =>
      (clients || [])
        .map((c) => ({ id: c.id, name: c.name || c.id }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [clients],
  );
  const clientName = (id) => {
    const c = (clients || []).find((x) => x.id === id);
    return (c && c.name) || id;
  };
  const activeStaff = useMemo(
    () =>
      [...(staff || [])]
        .filter((s) => s.active !== false)
        .sort((a, b) => String(a.name || a.email).localeCompare(String(b.name || b.email))),
    [staff],
  );
  const staffName = (email) => {
    const s = (staff || []).find((x) => TP_lower(x.email) === TP_lower(email));
    return (s && s.name) || email;
  };

  async function save(key, rpc, args, done) {
    setBusyKey(key);
    const res = await TP_qRpc(rpc, args);
    setBusyKey(null);
    if (res.error) {
      showToast("Couldn't save the mapping: " + res.error.message);
      return;
    }
    if (done) showToast(done);
    setVersion((v) => v + 1);
    qbo.reload();
    if (onChanged) onChanged();
  }

  const customerRows = useMemo(() => {
    const byId = {};
    state.customers.forEach((c) => {
      byId[c.qbo_customer_id] = c;
    });
    return state.customers.map((c) => {
      const r = state.resolution[c.qbo_customer_id] || {};
      const minutes = state.hoursC[c.qbo_customer_id] || 0;
      let status;
      if (c.client_id) {
        status = {
          tone: "good",
          text: `${c.manual ? "Mapped" : "Auto-matched"} to ${clientName(c.client_id)}`,
        };
      } else if (c.ignored) status = { tone: "muted", text: "Ignored" };
      else if (r.client_id) {
        const via = byId[r.resolved_via_qbo_id];
        status = { tone: "good", text: `Via ${via ? via.customer_name : "parent"}: ${clientName(r.client_id)}` };
      } else if (r.ignored) status = { tone: "muted", text: "Ignored via parent" };
      else status = { tone: "warn", text: "Not mapped" };
      const unresolved = !c.client_id && !c.ignored && !r.client_id && !r.ignored;
      return { c, r, minutes, status, unresolved };
    });
  }, [state.customers, state.resolution, state.hoursC, clients]);

  const peopleRows = useMemo(
    () =>
      state.people.map((p) => {
        const key = `${p.qbo_entity_type}:${p.qbo_id}`;
        const minutes = state.hoursP[key] || 0;
        let status;
        if (p.staff_email)
          status = { tone: "good", text: `${p.manual ? "Mapped" : "Auto-matched"} to ${staffName(p.staff_email)}` };
        else if (p.ignored) status = { tone: "muted", text: "Ignored" };
        else status = { tone: "warn", text: "Not mapped" };
        return { p, key, minutes, status, unresolved: !p.staff_email && !p.ignored };
      }),
    [state.people, state.hoursP, staff],
  );

  const t = TP_lower(search);
  const shownCustomers = customerRows
    .filter((x) => (filter === "needs" ? x.unresolved && x.minutes > 0 : true))
    .filter(
      (x) =>
        !t ||
        TP_lower(x.c.fully_qualified_name || x.c.customer_name).includes(t) ||
        TP_lower(x.c.company_name).includes(t) ||
        (x.c.client_id && TP_lower(clientName(x.c.client_id)).includes(t)),
    )
    .sort(
      (a, b) =>
        b.minutes - a.minutes ||
        Number(b.unresolved) - Number(a.unresolved) ||
        String(a.c.fully_qualified_name || a.c.customer_name).localeCompare(String(b.c.fully_qualified_name || b.c.customer_name)),
    );
  const shownPeople = peopleRows
    .filter((x) => (filter === "needs" ? x.unresolved : true))
    .filter((x) => !t || TP_lower(x.p.display_name).includes(t) || TP_lower(x.p.qbo_email).includes(t))
    .sort((a, b) => b.minutes - a.minutes || Number(b.unresolved) - Number(a.unresolved) || String(a.p.display_name).localeCompare(String(b.p.display_name)));
  const needsC = customerRows.filter((x) => x.unresolved && x.minutes > 0).length;
  const needsP = peopleRows.filter((x) => x.unresolved).length;

  return (
    <div className="tp-page">
      <div className="card" style={{ marginBottom: 20 }}>
        <TP_BackBar
          label="Back to team"
          onBack={onBack}
          title="QuickBooks mapping"
          subtitle="Which client each QuickBooks customer is, and which staff member each QuickBooks employee or vendor is."
        />
        <div className="tp-q-map-tools">
          <div className="modal-tabs" style={{ marginTop: 0 }}>
            <button type="button" className={"modal-tab" + (tab === "customers" ? " active" : "")} onClick={() => setTab("customers")}>
              Customers{needsC ? ` (${needsC})` : ""}
            </button>
            <button type="button" className={"modal-tab" + (tab === "people" ? " active" : "")} onClick={() => setTab("people")}>
              People{needsP ? ` (${needsP})` : ""}
            </button>
          </div>
          <div className="modal-tabs" style={{ marginTop: 0 }}>
            <button type="button" className={"modal-tab" + (filter === "needs" ? " active" : "")} onClick={() => setFilter("needs")}>
              Needs mapping
            </button>
            <button type="button" className={"modal-tab" + (filter === "all" ? " active" : "")} onClick={() => setFilter("all")}>
              All
            </button>
          </div>
          <input
            type="search"
            className="tp-q-input tp-q-search"
            placeholder={tab === "customers" ? "Search customers" : "Search people"}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search"
          />
        </div>
        <p className="tp-muted" style={{ marginTop: 12 }}>
          Hours are everything synced that isn't counted against a client or staff member yet, so
          the biggest gaps sort first. Jobs and sub-customers roll up to their parent unless mapped
          on their own. Reset hands a row back to automatic matching by name or email.
        </p>
      </div>

      {state.error && (
        <div className="mock-banner" style={{ marginBottom: 20 }}>
          <WarningIcon />
          <span>{state.error}</span>
        </div>
      )}

      <div className="card">
        {state.loading ? (
          <p className="card-subtitle" style={{ margin: 0 }}>Loading the mapping…</p>
        ) : tab === "customers" ? (
          shownCustomers.length === 0 ? (
            <p className="card-subtitle" style={{ margin: 0 }}>
              {filter === "needs"
                ? state.customers.length
                  ? "Every QuickBooks customer with hours is mapped or ignored. Switch to All to review the rest."
                  : "No QuickBooks customers synced yet. The first sync can take about 10 minutes."
                : "No customers match."}
            </p>
          ) : (
            <ul className="tp-q-map-list">
              {shownCustomers.map(({ c, minutes, status }) => {
                const key = "c:" + c.qbo_customer_id;
                const busy = busyKey === key;
                const name = c.fully_qualified_name || c.customer_name || `Customer ${c.qbo_customer_id}`;
                return (
                  <li key={key} className={"tp-q-map-row" + (busy ? " busy" : "")}>
                    <div className="tp-q-map-main">
                      <span className="tp-name tp-q-ellipsis" title={name}>{name}</span>
                      <span className="tp-q-map-meta">
                        {c.is_job && <span className="task-chip">Job</span>}
                        {!c.active && <span className="task-chip">Inactive</span>}
                        {c.company_name && c.company_name !== c.customer_name && (
                          <span className="tp-muted">{c.company_name}</span>
                        )}
                        <TP_QStatusTag tone={status.tone}>{status.text}</TP_QStatusTag>
                      </span>
                    </div>
                    <div className={"tp-q-map-hours" + (minutes && status.tone === "warn" ? " tp-q-warn" : "")}>
                      {minutes ? (
                        <>
                          {TP_qHours(minutes)}
                          <span className="tp-muted tp-q-map-hours-label">hrs</span>
                        </>
                      ) : (
                        <span className="tp-muted">–</span>
                      )}
                    </div>
                    <div className="tp-q-map-control">
                      <TP_QClientPicker
                        clients={clientList}
                        value={c.client_id}
                        disabled={busy}
                        label={`Client for ${name}`}
                        onPick={(id) =>
                          save(key, "qbo_set_customer_mapping", { p_qbo_customer_id: c.qbo_customer_id, p_client_id: id, p_ignore: false, p_realm_id: c.realm_id }, `Mapped ${name} to ${clientName(id)}.`)
                        }
                      />
                      <div className="tp-q-map-btns">
                        <button
                          type="button"
                          className="btn-secondary tp-q-btn-sm"
                          disabled={busy || c.ignored}
                          onClick={() => save(key, "qbo_set_customer_mapping", { p_qbo_customer_id: c.qbo_customer_id, p_client_id: null, p_ignore: true, p_realm_id: c.realm_id }, `Ignoring ${name}.`)}
                        >
                          Ignore
                        </button>
                        <button
                          type="button"
                          className="btn-secondary tp-q-btn-sm"
                          disabled={busy || (!c.manual && !c.client_id && !c.ignored)}
                          onClick={() => save(key, "qbo_set_customer_mapping", { p_qbo_customer_id: c.qbo_customer_id, p_client_id: null, p_ignore: false, p_realm_id: c.realm_id }, `${name} is back on automatic matching.`)}
                        >
                          Reset
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )
        ) : shownPeople.length === 0 ? (
          <p className="card-subtitle" style={{ margin: 0 }}>
            {filter === "needs"
              ? state.people.length
                ? "Every QuickBooks employee and vendor is mapped or ignored."
                : "No QuickBooks employees or vendors synced yet."
              : "No people match."}
          </p>
        ) : (
          <ul className="tp-q-map-list">
            {shownPeople.map(({ p, key: pk, minutes, status }) => {
              const key = "p:" + pk;
              const busy = busyKey === key;
              const name = p.display_name || `${p.qbo_entity_type} ${p.qbo_id}`;
              const base = { p_qbo_entity_type: p.qbo_entity_type, p_qbo_id: p.qbo_id, p_realm_id: p.realm_id };
              const knownEmail = p.staff_email && activeStaff.some((s) => TP_lower(s.email) === TP_lower(p.staff_email));
              return (
                <li key={key} className={"tp-q-map-row" + (busy ? " busy" : "")}>
                  <div className="tp-q-map-main">
                    <span className="tp-name tp-q-ellipsis" title={name}>{name}</span>
                    <span className="tp-q-map-meta">
                      <span className="task-chip">{p.qbo_entity_type}</span>
                      {!p.active && <span className="task-chip">Inactive</span>}
                      {p.qbo_email && <span className="tp-muted tp-q-ellipsis">{p.qbo_email}</span>}
                      <TP_QStatusTag tone={status.tone}>{status.text}</TP_QStatusTag>
                    </span>
                  </div>
                  <div className={"tp-q-map-hours" + (minutes && status.tone === "warn" ? " tp-q-warn" : "")}>
                    {minutes ? (
                      <>
                        {TP_qHours(minutes)}
                        <span className="tp-muted tp-q-map-hours-label">hrs</span>
                      </>
                    ) : (
                      <span className="tp-muted">–</span>
                    )}
                  </div>
                  <div className="tp-q-map-control">
                    <select
                      className="tp-q-input"
                      value={p.staff_email ? TP_lower(p.staff_email) : ""}
                      disabled={busy}
                      aria-label={`Staff member for ${name}`}
                      onChange={(e) => {
                        const email = e.target.value;
                        if (!email) return;
                        save(key, "qbo_set_employee_mapping", { ...base, p_staff_email: email, p_ignore: false }, `Mapped ${name} to ${staffName(email)}.`);
                      }}
                    >
                      <option value="">Choose a staff member…</option>
                      {p.staff_email && !knownEmail && (
                        <option value={TP_lower(p.staff_email)}>{p.staff_email}</option>
                      )}
                      {activeStaff.map((s) => (
                        <option key={s.email} value={TP_lower(s.email)}>
                          {s.name ? `${s.name} (${s.email})` : s.email}
                        </option>
                      ))}
                    </select>
                    <div className="tp-q-map-btns">
                      <button
                        type="button"
                        className="btn-secondary tp-q-btn-sm"
                        disabled={busy || p.ignored}
                        onClick={() => save(key, "qbo_set_employee_mapping", { ...base, p_staff_email: null, p_ignore: true }, `Ignoring ${name}.`)}
                      >
                        Ignore
                      </button>
                      <button
                        type="button"
                        className="btn-secondary tp-q-btn-sm"
                        disabled={busy || (!p.manual && !p.staff_email && !p.ignored)}
                        onClick={() => save(key, "qbo_set_employee_mapping", { ...base, p_staff_email: null, p_ignore: false }, `${name} is back on automatic matching.`)}
                      >
                        Reset
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

// CSV exports in QuickBooks mode.
const TP_APP_CSV_HEAD = "In-app hours (automatic, not billed)";

function TP_qExportPeople(filename, people, byStaff, qboOn) {
  const { rows, bucketRows } = TP_qPeopleRows(people, byStaff);
  const h = (m) => (TP_qNum(m) / 60).toFixed(2);
  const qh = (m) => (qboOn ? h(m) : "");
  TP_downloadCsv(
    filename,
    ["Name", "Email", "Role", "Bucket", "QuickBooks hours", TP_APP_CSV_HEAD, "Billable hours", "Hours on mapped clients", "Hours on unmapped customers", "Open tasks", "Overdue tasks", "Completed in period", "Assigned clients", "Temporary clients"],
    [
      ...rows.map((p) => [p.name, p.email, TP_roleLabel(p.role), "staff", qh(p.q && p.q.total_minutes), h(p.appMinutes), qh(p.q && p.q.billable_minutes), qh(p.q && p.q.client_minutes), qh(p.q && p.q.unmapped_customer_minutes), p.open, p.overdue, p.completed, p.assignedCount, p.tempCount]),
      ...bucketRows.map((b) => [b.label, "", "", b.bucket, h(b.q.total_minutes), "", h(b.q.billable_minutes), h(b.q.client_minutes), h(b.q.unmapped_customer_minutes), "", "", "", "", ""]),
    ],
  );
}

// profit: TP_PF_useProfit() state for admins, else null (no money columns).
function TP_qExportClients(filename, args, avgLabel, qboOn, staffName, profit) {
  const { rows, bucketRows } = TP_qClientRows(args);
  const h = (m) => (TP_qNum(m) / 60).toFixed(2);
  const qh = (m) => (qboOn ? h(m) : "");
  const nameOf = staffName || ((e) => String(e || "").split("@")[0]);
  TP_downloadCsv(
    filename,
    ["Client", "Bucket", "Plan", "QuickBooks hours", TP_APP_CSV_HEAD, "In-app hours by staffer", `Avg hours / month (${avgLabel})`, "Billable hours", "Billable value", ...(profit ? ["Effective rate / hour", ...TP_PF_CSV_HEAD] : []), "Trend", "Open tasks", "Overdue tasks"],
    [
      ...rows
        .filter((r) => r.qMinutes || r.qAvgMinutes || r.appMinutes || r.open)
        .map((r) => [
          r.name,
          "client",
          r.known ? planLabel(r.plan) : "",
          qh(r.qMinutes),
          h(r.appMinutes),
          (r.appByStaff || []).map((s) => `${nameOf(s.email)} ${h(s.minutes)}`).join("; "),
          qh(r.qAvgMinutes),
          h(r.q && r.q.billable_minutes),
          r.q ? TP_qNum(r.q.billable_value).toFixed(2) : "",
          ...(profit
            ? [
                (() => {
                  const er = TP_PF_effRate(TP_PF_rowView(profit, qboOn, r.id).fee, r);
                  return er != null ? er.toFixed(2) : "";
                })(),
                ...TP_PF_csvCells(profit, qboOn, r.id),
              ]
            : []),
          r.trend ? (r.trend.dir === "new" ? "new" : `${r.trend.dir} ${r.trend.pct}%`) : "",
          r.open,
          r.overdue,
        ]),
      ...bucketRows.map((b) => [b.label, b.bucket, "", h(b.q.total_minutes), "", "", "", h(b.q.billable_minutes), TP_qNum(b.q.billable_value).toFixed(2), ...(profit ? ["", ...TP_PF_CSV_HEAD.map(() => "")] : []), "", "", ""]),
    ],
  );
}
