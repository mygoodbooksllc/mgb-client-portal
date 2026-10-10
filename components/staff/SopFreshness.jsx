// SOP freshness (owner request 2026-10-07). Staff only. supabase/sop-freshness.sql
//
//   SF_useSopStatus(enabled)  client_sop_status() rows by client id, shared
//                             by Home (needs-you rows, the "Client SOP"
//                             card rule) and the SOP badge.
//   SF_FreshnessBar           "Last reviewed N days ago" plus "Mark as still
//                             accurate", on ClientSopView (app.jsx).
//   SF_staleTodos             Home "Needs you" rows for stale SOPs.
//
// Fresh = the later of the last section edit and the last "Mark as still
// accurate". Stale after OPS_SOP_STALE_DAYS (180). A client with nothing
// written yet isn't "stale" (Client health already flags "No SOP written").
// Top-level names use the SF_ prefix.

const SF_store = { byClient: null, error: null, loadedAt: 0, subs: new Set(), inflight: null };

function SF_emit() {
  SF_store.subs.forEach((fn) => {
    try {
      fn();
    } catch (e) {}
  });
}

function SF_load(force) {
  const sb = window.mgbSupabase;
  if (!sb) return Promise.resolve();
  if (SF_store.inflight) return SF_store.inflight;
  if (!force && SF_store.loadedAt && Date.now() - SF_store.loadedAt < 60 * 1000) return Promise.resolve();
  SF_store.inflight = Promise.resolve(sb.rpc("client_sop_status"))
    .then(({ data, error }) => {
      SF_store.loadedAt = Date.now();
      if (error) {
        SF_store.error = error.message || "error";
        SF_store.byClient = SF_store.byClient || {};
      } else {
        SF_store.error = null;
        const map = {};
        (data || []).forEach((r) => (map[r.client_id] = r));
        SF_store.byClient = map;
      }
    })
    .catch(() => {
      SF_store.error = "error";
      SF_store.byClient = SF_store.byClient || {};
    })
    .finally(() => {
      SF_store.inflight = null;
      SF_emit();
    });
  return SF_store.inflight;
}

// Returns the by-client map, or null while loading / when not enabled.
function SF_useSopStatus(enabled) {
  const [, bump] = React.useReducer((n) => n + 1, 0);
  useEffect(() => {
    if (!enabled) return;
    SF_store.subs.add(bump);
    SF_load(false);
    const on = () => SF_load(true);
    window.addEventListener(STAFF_TOOLS_EVENT, on);
    window.addEventListener(CLIENT_SOPS_CHANGED_EVENT, on);
    return () => {
      SF_store.subs.delete(bump);
      window.removeEventListener(STAFF_TOOLS_EVENT, on);
      window.removeEventListener(CLIENT_SOPS_CHANGED_EVENT, on);
    };
  }, [enabled]);
  return enabled ? SF_store.byClient : null;
}

function SF_today() {
  return typeof todayLocal === "function" ? todayLocal() : OPS_isoDay(new Date());
}

// Freshness for one client's status row (null = nothing to judge yet).
function SF_freshness(row, today) {
  if (!row || !(row.filled > 0)) return null;
  return OPS_sopFreshness(row.last_edited, row.last_reviewed, today || SF_today());
}

// For the "Client SOP" Home card rule: "stale" | "fresh" | "none", or null
// while loading.
function SF_ruleState(byClient, clientId) {
  if (!byClient) return null;
  const row = byClient[clientId];
  if (!row || !(row.filled > 0)) return "none";
  const f = SF_freshness(row);
  return f && f.stale ? "stale" : "fresh";
}

function SF_staleTodos(clients, byClient, today, onOpen) {
  if (!byClient) return [];
  const out = [];
  (clients || []).forEach((c) => {
    const f = SF_freshness(byClient[c.id], today);
    if (!f || !f.stale) return;
    out.push({
      key: "sop-" + c.id,
      kind: "SOP",
      rank: 9,
      sort: -f.days,
      title: c.name || c.id,
      detail: `SOP last reviewed ${OPS_daysAgo(f.days)} · give it a read`,
      onClick: () => onOpen(c.id),
    });
  });
  return out.sort((a, b) => a.sort - b.sort);
}

// ClientSopView's freshness line. rows = { [section]: row } from the view, so
// a fresh edit shows straight away; the review comes from client_sop_status().
function SF_FreshnessBar({ client, rows }) {
  const showToast = useToast();
  const byClient = SF_useSopStatus(true);
  const [busy, setBusy] = useState(false);
  const [justMarked, setJustMarked] = useState(null);
  const dir = typeof CV_useDirectory === "function" ? CV_useDirectory() : [];
  if (!client) return null;
  const status = byClient ? byClient[client.id] : null;
  let lastEdited = status ? status.last_edited : null;
  let filled = 0;
  Object.values(rows || {}).forEach((r) => {
    if (r && r.updated_at && (!lastEdited || r.updated_at > lastEdited)) lastEdited = r.updated_at;
    if (r && CLIENT_SOP_SECTION_IDS.includes(r.section) && (r.body || "").trim()) filled++;
  });
  if (filled === 0) return null;
  const lastReviewed = justMarked || (status ? status.last_reviewed : null);
  const reviewedBy = justMarked ? null : status ? status.reviewed_by : null;
  const f = OPS_sopFreshness(lastEdited, lastReviewed, SF_today());
  if (!f) return null;
  const name =
    reviewedBy && typeof CV_nameOf === "function"
      ? CV_nameOf(dir, reviewedBy)
      : reviewedBy
        ? String(reviewedBy).split("@")[0]
        : "";
  const tip = [
    lastEdited ? "Last edit " + fmtDate(String(lastEdited).slice(0, 10)) : "",
    lastReviewed ? "Marked accurate " + fmtDate(String(lastReviewed).slice(0, 10)) + (name ? " by " + name : "") : "",
  ]
    .filter(Boolean)
    .join(" · ");

  async function mark() {
    setBusy(true);
    const { data, error } = await window.mgbSupabase.rpc("mark_sop_reviewed", { p_client_id: client.id });
    setBusy(false);
    if (error) {
      const missing = typeof isMissingTableError === "function" && isMissingTableError(error);
      return showToast(missing ? "SOP reviews aren't set up yet (database step pending)." : "Couldn't save: " + error.message);
    }
    setJustMarked(typeof data === "string" ? data : new Date().toISOString());
    showToast("Marked as still accurate");
    SF_load(true);
  }

  return (
    <div className={"sf-bar" + (f.stale ? " sf-stale" : "")} title={tip} data-tour="sop-fresh">
      <span className={"pill sf-pill" + (f.stale ? " sf-pill-bad" : " sf-pill-good")}>
        Last reviewed {OPS_daysAgo(f.days)}
      </span>
      {f.stale && <span className="sf-note">Over {OPS_SOP_STALE_DAYS} days. Give it a read and fix anything out of date.</span>}
      {!f.stale && f.source === "review" && name && <span className="sf-note">Marked accurate by {name}</span>}
      {f.days > 0 && (
        <button type="button" className="btn-secondary sf-mark" disabled={busy} onClick={mark}>
          {busy ? "Saving…" : "Mark as still accurate"}
        </button>
      )}
    </div>
  );
}
