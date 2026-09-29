// ----------------------------------------------------------------------------
// Emails page (admin only, owner request 2026-09-29). One place for every
// email the portal sends:
//   1. Setup status banner: is sending actually working? Read from the logs,
//      not from secrets. The newest real send attempt (status sent / error /
//      not_configured) across digest_runs and client_email_log decides it:
//        sent            -> working
//        not_configured  -> RESEND_API_KEY secret missing
//        error "domain is not verified" -> key works, domain not verified
//        other error     -> last send failed (shows the provider's message)
//        nothing yet     -> "Not verified yet — send a test to check"
//      "Check the key" calls the existing weekly-admin-digest
//      ?preview=1&format=json, which only returns email_configured (a
//      boolean) and sends nothing. It does log a "preview" row.
//   2. Weekly digest   -> DG_DigestSettings (DigestSettings.jsx)
//   3. Client emails   -> CE_ClientEmailSettings (ClientEmailSettings.jsx)
//   4. Send log: digest_runs + client_email_log merged, newest first.
// RLS: digest_runs / *_settings are admin-only; client_email_log is readable
// by admins (all rows). App only routes admins here (effectivePage).
//
// Loaded before app.jsx in the shared global scope: every top-level name
// carries an EM_ prefix; app.jsx globals (useToast, relTime) are only
// touched at render time. Hooks are used as React.*.
// ----------------------------------------------------------------------------

const EM_PAGE_SIZE = 50;
const EM_ATTEMPT_STATUSES = ["sent", "error", "not_configured"];
const EM_SECRETS_URL = "https://supabase.com/dashboard/project/xumsqmhccgfjnlmieqyu/functions/secrets";
const EM_RESEND_DOMAINS_URL = "https://resend.com/domains";
const EM_TYPES = [
  { value: "", label: "All types" },
  { value: "digest", label: "Weekly digest" },
  { value: "doc_chaser", label: "Document reminder" },
  { value: "value_report", label: "Value report" },
];
const EM_TYPE_LABEL = { digest: "Weekly digest", doc_chaser: "Document reminder", value_report: "Value report" };
const EM_STATUSES = [
  { value: "", label: "All statuses" },
  { value: "sent", label: "Sent" },
  { value: "error", label: "Failed" },
  { value: "not_configured", label: "Email not configured" },
  { value: "skipped", label: "Skipped" },
  { value: "disabled", label: "Skipped (turned off)" },
  { value: "preview", label: "Preview" },
];
const EM_STATUS_LABEL = Object.fromEntries(EM_STATUSES.filter((s) => s.value).map((s) => [s.value, s.label]));

function EM_MailIcon(props) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3.5 6.5 12 13l8.5-6.5" />
    </svg>
  );
}

function EM_when(ts) {
  if (!ts) return "";
  try {
    if (typeof relTime === "function") return relTime(ts);
  } catch (e) {}
  return new Date(ts).toLocaleString();
}

function EM_fullTime(ts) {
  try {
    return new Date(ts).toLocaleString();
  } catch (e) {
    return String(ts || "");
  }
}

// Normalise a digest_runs row and a client_email_log row to one shape.
function EM_fromDigest(r) {
  return {
    key: "d" + r.id,
    at: r.started_at,
    type: "digest",
    trigger: r.trigger,
    status: r.status,
    recipients: r.recipients || [],
    clientId: null,
    detail: r.detail || "",
    by: r.requested_by || "",
  };
}
function EM_fromClient(r) {
  return {
    key: "c" + r.id,
    at: r.created_at,
    type: r.feature,
    trigger: r.trigger,
    status: r.status,
    recipients: r.recipients || [],
    clientId: r.client_id,
    detail: r.reason || "",
    by: r.requested_by || "",
  };
}

// What a failed attempt's message says about the setup.
function EM_classify(row) {
  if (!row) return "none";
  if (row.status === "sent") return "ok";
  if (row.status === "not_configured" || /RESEND_API_KEY|not configured/i.test(row.detail)) return "no_key";
  if (/domain is not verified|verify your domain/i.test(row.detail)) return "domain";
  if (/api key is invalid|invalid api key|\b401\b|unauthori[sz]ed/i.test(row.detail)) return "bad_key";
  return "failed";
}

function EM_SetupBanner({ reloadKey }) {
  const toast = typeof useToast === "function" ? useToast() : (m) => window.alert(m);
  const [st, setSt] = React.useState({ loading: true, latest: null, lastOk: null, error: null });
  const [checking, setChecking] = React.useState(false);
  const [keyCheck, setKeyCheck] = React.useState(null); // { configured, at }

  React.useEffect(() => {
    let alive = true;
    (async () => {
      const sb = window.mgbSupabase;
      if (!sb) return alive && setSt({ loading: false, latest: null, lastOk: null, error: null });
      const [d, c, dOk, cOk] = await Promise.all([
        sb.from("digest_runs").select("id, started_at, trigger, status, recipients, detail, requested_by").in("status", EM_ATTEMPT_STATUSES).order("started_at", { ascending: false }).limit(1),
        sb.from("client_email_log").select("id, created_at, feature, trigger, client_id, status, reason, recipients, requested_by").in("status", EM_ATTEMPT_STATUSES).order("created_at", { ascending: false }).limit(1),
        sb.from("digest_runs").select("id, started_at, trigger, status, recipients, detail, requested_by").eq("status", "sent").order("started_at", { ascending: false }).limit(1),
        sb.from("client_email_log").select("id, created_at, feature, trigger, client_id, status, reason, recipients, requested_by").eq("status", "sent").order("created_at", { ascending: false }).limit(1),
      ]);
      if (!alive) return;
      const err = d.error || c.error;
      const pick = (rows) => rows.filter(Boolean).sort((a, b) => String(b.at).localeCompare(String(a.at)))[0] || null;
      setSt({
        loading: false,
        error: err ? err.message : null,
        latest: pick([...(d.data || []).map(EM_fromDigest), ...(c.data || []).map(EM_fromClient)]),
        lastOk: pick([...(dOk.data || []).map(EM_fromDigest), ...(cOk.data || []).map(EM_fromClient)]),
      });
    })();
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  async function checkKey() {
    const sb = window.mgbSupabase;
    if (!sb) return;
    setChecking(true);
    try {
      const { data } = await sb.auth.getSession();
      const token = data && data.session && data.session.access_token;
      if (!token) throw new Error("sign in again");
      const cfg = window.SUPABASE_CONFIG || {};
      const res = await fetch(`${cfg.url}/functions/v1/weekly-admin-digest?preview=1&format=json`, {
        headers: { Authorization: `Bearer ${token}`, apikey: cfg.anonKey || "" },
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body || typeof body.email_configured !== "boolean") {
        throw new Error((body && body.error) || `HTTP ${res.status}`);
      }
      setKeyCheck({ configured: body.email_configured, from: body.from || "" });
    } catch (e) {
      toast("Couldn't check: " + (e.message || String(e)));
    }
    setChecking(false);
  }

  if (st.loading) return null;
  let kind = EM_classify(st.latest);
  // A fresh key check beats an old "key missing" log row, never a real send.
  if (keyCheck && kind === "no_key" && keyCheck.configured) kind = "key_set_unsent";
  if (keyCheck && (kind === "none" || kind === "ok") && !keyCheck.configured) kind = "no_key";

  const L = st.latest;
  const tone = kind === "ok" ? "ok" : kind === "none" || kind === "key_set_unsent" ? "neutral" : kind === "domain" ? "warn" : "bad";
  const title = {
    ok: "Email sending works",
    no_key: "Email isn't set up: the RESEND_API_KEY secret is missing",
    bad_key: "Email isn't working: Resend rejected the API key",
    domain: "Almost there: the key works, but mygoodbooks.org isn't verified in Resend",
    failed: "The last send failed",
    none: "Not verified yet — send a test to check",
    key_set_unsent: "The key is set now — send a test to confirm",
  }[kind];

  const lastLine = L ? (
    <>
      Last attempt: <b>{EM_STATUS_LABEL[L.status] || L.status}</b> · {EM_TYPE_LABEL[L.type] || L.type}
      {L.trigger === "manual" || L.trigger === "test" ? " (test)" : ""} · <span title={EM_fullTime(L.at)}>{EM_when(L.at)}</span>
      {L.status !== "sent" && L.detail ? <span className="em-banner-detail">“{L.detail}”</span> : null}
    </>
  ) : (
    "Nothing has been sent or attempted yet."
  );

  const needsKey = kind === "no_key" || kind === "bad_key" || kind === "none";
  const needsDomain = kind !== "ok";

  return (
    <div className={"card em-banner em-banner-" + tone} role="status">
      <div className="em-banner-head">
        <span className="em-banner-dot" aria-hidden="true" />
        <div style={{ minWidth: 0, flex: "1 1 260px" }}>
          <h3 className="card-title" style={{ margin: 0 }}>{title}</h3>
          {!st.error && <p className="em-banner-line">{lastLine}</p>}
          {kind !== "ok" && st.lastOk && (
            <p className="em-banner-line">
              Last successful send: {EM_TYPE_LABEL[st.lastOk.type] || st.lastOk.type} ·{" "}
              <span title={EM_fullTime(st.lastOk.at)}>{EM_when(st.lastOk.at)}</span>
            </p>
          )}
          {keyCheck && (
            <p className="em-banner-line">
              Key check just now: RESEND_API_KEY is {keyCheck.configured ? "set" : "not set"}
              {keyCheck.from ? ` · sending from ${keyCheck.from}` : ""}. This can't tell whether the domain is verified; only a real send can.
            </p>
          )}
          {st.error && <p className="em-banner-line">Couldn't read the send logs: {st.error}</p>}
        </div>
        <button type="button" className="btn-secondary em-banner-btn" onClick={checkKey} disabled={checking} title="Asks the digest function whether the key is set. Sends nothing.">
          {checking ? "Checking…" : "Check the key"}
        </button>
      </div>
      {kind !== "ok" && (
        <ol className="em-banner-steps">
          {needsKey && (
            <li>
              Add a Resend API key as the <code>RESEND_API_KEY</code> secret in{" "}
              <a href={EM_SECRETS_URL} target="_blank" rel="noopener noreferrer">Supabase → Edge Functions → Secrets</a>.
            </li>
          )}
          {needsDomain && (
            <li>
              Verify <b>mygoodbooks.org</b> in{" "}
              <a href={EM_RESEND_DOMAINS_URL} target="_blank" rel="noopener noreferrer">Resend → Domains</a> (add the DNS records it
              lists at the domain's DNS host, e.g. GoDaddy).
            </li>
          )}
          <li>Then use “Send test now” under Weekly digest below. This banner updates from the result.</li>
        </ol>
      )}
    </div>
  );
}

function EM_SendLog({ reloadKey }) {
  const [filters, setFilters] = React.useState({ type: "", status: "" });
  const [limit, setLimit] = React.useState(EM_PAGE_SIZE);
  const [st, setSt] = React.useState({ loading: true, rows: [], more: false, error: null });
  const [names, setNames] = React.useState({});

  React.useEffect(() => {
    const sb = window.mgbSupabase;
    if (!sb) return;
    sb.from("clients")
      .select("id, name")
      .then(({ data }) => {
        const m = {};
        for (const c of data || []) m[c.id] = c.name;
        setNames(m);
      });
  }, []);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      const sb = window.mgbSupabase;
      if (!sb) return alive && setSt({ loading: false, rows: [], more: false, error: null });
      setSt((s) => ({ ...s, loading: true }));
      const wantDigest = !filters.type || filters.type === "digest";
      const wantClient = filters.type !== "digest";
      const jobs = [];
      if (wantDigest) {
        let q = sb.from("digest_runs").select("id, started_at, trigger, status, recipients, detail, requested_by").order("started_at", { ascending: false }).limit(limit + 1);
        if (filters.status) q = q.eq("status", filters.status);
        jobs.push(q.then((r) => ({ ...r, map: EM_fromDigest })));
      }
      if (wantClient) {
        let q = sb.from("client_email_log").select("id, created_at, feature, trigger, client_id, status, reason, recipients, requested_by").order("created_at", { ascending: false }).limit(limit + 1);
        if (filters.type) q = q.eq("feature", filters.type);
        if (filters.status) q = q.eq("status", filters.status);
        jobs.push(q.then((r) => ({ ...r, map: EM_fromClient })));
      }
      const results = await Promise.all(jobs);
      if (!alive) return;
      const failed = results.find((r) => r.error);
      if (failed) return setSt({ loading: false, rows: [], more: false, error: failed.error.message });
      const all = results
        .flatMap((r) => (r.data || []).map(r.map))
        .sort((a, b) => String(b.at).localeCompare(String(a.at)));
      setSt({ loading: false, rows: all.slice(0, limit), more: all.length > limit, error: null });
    })();
    return () => {
      alive = false;
    };
  }, [filters, limit, reloadKey]);

  const set = (k) => (e) => {
    setFilters((f) => ({ ...f, [k]: e.target.value }));
    setLimit(EM_PAGE_SIZE);
  };
  const filtered = !!(filters.type || filters.status);
  const triggerLabel = (t) => (t === "cron" ? "scheduled" : t === "manual" || t === "test" ? "test" : t);

  return (
    <div className="card">
      <div className="al-head">
        <div style={{ minWidth: 0 }}>
          <h3 className="card-title" style={{ margin: 0 }}>Send log</h3>
          <p className="card-subtitle" style={{ margin: "4px 0 0" }}>
            Every weekly digest run and client email attempt, newest first.
          </p>
        </div>
      </div>

      <div className="al-filters">
        <label className="al-field">
          <span>Type</span>
          <select value={filters.type} onChange={set("type")}>
            {EM_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </label>
        <label className="al-field">
          <span>Status</span>
          <select value={filters.status} onChange={set("status")}>
            {EM_STATUSES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </label>
        {filtered && (
          <button type="button" className="link-btn al-clear" onClick={() => { setFilters({ type: "", status: "" }); setLimit(EM_PAGE_SIZE); }}>
            Clear filters
          </button>
        )}
      </div>

      {st.error && <p className="al-error" role="alert">{st.error}</p>}

      {!st.error && (
        <div className="al-table-wrap">
          <table className="tx-table tx-table-labeled al-table em-log">
            <thead>
              <tr>
                <th>When</th>
                <th>Type</th>
                <th>Recipient / client</th>
                <th>Status</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {st.loading && !st.rows.length && (
                <tr><td colSpan={5} className="table-empty-cell">Loading…</td></tr>
              )}
              {!st.loading && !st.rows.length && (
                <tr><td colSpan={5} className="table-empty-cell">{filtered ? "Nothing matches these filters." : "Nothing sent or attempted yet."}</td></tr>
              )}
              {st.rows.map((r) => (
                <tr key={r.key}>
                  <td data-label="When" className="al-when" title={EM_fullTime(r.at)}>{EM_when(r.at)}</td>
                  <td data-label="Type">
                    <div>{EM_TYPE_LABEL[r.type] || r.type}</div>
                    <div className="al-dim">{triggerLabel(r.trigger)}{r.by ? ` by ${r.by}` : ""}</div>
                  </td>
                  <td data-label="Recipient / client" className="em-log-who">
                    {r.clientId && <div>{names[r.clientId] || r.clientId}</div>}
                    {r.recipients.length ? (
                      <div className={r.clientId ? "al-dim" : ""}>{r.recipients.join(", ")}</div>
                    ) : (
                      !r.clientId && <span className="al-dim">—</span>
                    )}
                  </td>
                  <td data-label="Status">
                    <span className={"em-status em-status-" + r.status}>{EM_STATUS_LABEL[r.status] || r.status}</span>
                  </td>
                  <td data-label="Error" className="al-details">
                    {r.detail ? <span className={r.status === "error" || r.status === "not_configured" ? "em-log-err" : "al-dim"}>{r.detail}</span> : <span className="al-dim">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!st.error && (st.more || limit > EM_PAGE_SIZE) && (
        <div className="al-pager">
          <span className="al-dim">Showing the newest {st.rows.length.toLocaleString()}</span>
          {st.more && (
            <div className="al-pager-btns">
              <button type="button" className="btn-secondary" disabled={st.loading} onClick={() => setLimit((n) => n + EM_PAGE_SIZE)}>
                {st.loading ? "Loading…" : "Show older"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EM_EmailsPage() {
  // Bumped after a test send in either settings card so the banner and log
  // pick up the new row.
  const [reloadKey, setReloadKey] = React.useState(0);
  const bump = React.useCallback(() => setReloadKey((k) => k + 1), []);
  return (
    <div className="al-page em-page">
      <EM_SetupBanner reloadKey={reloadKey} />
      {typeof DG_DigestSettings === "function" && <DG_DigestSettings onSent={bump} />}
      {typeof CE_ClientEmailSettings === "function" && <CE_ClientEmailSettings onSent={bump} />}
      <EM_SendLog reloadKey={reloadKey} />
    </div>
  );
}
