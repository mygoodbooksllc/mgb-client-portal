// Client health score (supabase/client-health.sql). A shared, session-wide
// cache of client_health() plus the dot used in the client picker and the
// card on Client overview. Top-level names use the HL_ prefix.
//
// The server decides what each viewer sees: bookkeepers get only clients they
// can access and never a margin reason; admins also get "margin below target".

const HL_REFRESH_MS = 5 * 60 * 1000;
const HL_COLOR = { green: "var(--good)", amber: "var(--gold-deep)", red: "var(--bad)" };
const HL_LABEL = { green: "Healthy", amber: "Watch", red: "At risk" };

const HL_store = {
  byId: null, // { [clientId]: {score, band, reasons} } once loaded
  status: "idle", // idle | loading | ready | error | missing
  loadedAt: 0,
  subs: new Set(),
  inflight: null,
};

function HL_emit() {
  HL_store.subs.forEach((fn) => {
    try {
      fn();
    } catch (e) {
      /* a bad subscriber shouldn't stop the others */
    }
  });
}

async function HL_tierFees(supabase) {
  if (typeof TP_PF_tierFee !== "function") return {};
  try {
    const { data } = await supabase.from("client_milestones").select("client_id, confirmed_tier");
    const out = {};
    (data || []).forEach((r) => {
      const fee = TP_PF_tierFee(r.confirmed_tier);
      if (fee != null) out[r.client_id] = fee;
    });
    return out;
  } catch (e) {
    return {};
  }
}

function HL_load(force) {
  const supabase = window.mgbSupabase;
  if (!supabase) return Promise.resolve();
  if (HL_store.inflight) return HL_store.inflight;
  if (!force && HL_store.status === "ready" && Date.now() - HL_store.loadedAt < HL_REFRESH_MS) {
    return Promise.resolve();
  }
  if (HL_store.status !== "ready") {
    HL_store.status = "loading";
    HL_emit();
  }
  HL_store.inflight = (async () => {
    try {
      const fees = await HL_tierFees(supabase);
      const { data, error } = await supabase.rpc("client_health", { p_default_fees: fees });
      if (error) {
        HL_store.status = /client_health/.test(error.message || "") ? "missing" : "error";
        if (HL_store.status === "error") console.warn("Client health:", error.message);
        return;
      }
      const byId = {};
      (data || []).forEach((r) => {
        byId[r.client_id] = { score: r.score, band: r.band, reasons: r.reasons || [] };
      });
      HL_store.byId = byId;
      HL_store.status = "ready";
      HL_store.loadedAt = Date.now();
    } catch (e) {
      HL_store.status = "error";
    } finally {
      HL_store.inflight = null;
      HL_emit();
    }
  })();
  return HL_store.inflight;
}

function HL_useHealth() {
  const [, bump] = React.useReducer((n) => n + 1, 0);
  React.useEffect(() => {
    HL_store.subs.add(bump);
    HL_load(false);
    const id = setInterval(() => HL_load(false), HL_REFRESH_MS);
    return () => {
      HL_store.subs.delete(bump);
      clearInterval(id);
    };
  }, []);
  return {
    byId: HL_store.byId || {},
    status: HL_store.status,
    reload: () => HL_load(true),
  };
}

function HL_tooltip(h) {
  if (!h) return "";
  const head = `Health ${h.score}/100 · ${HL_LABEL[h.band] || h.band}`;
  if (!h.reasons.length) return head + " — nothing flagged";
  return head + "\n" + h.reasons.map((r) => `• ${r.label} (−${r.points})`).join("\n");
}

// Dot for the client picker. Falls back to the app's own signal dot while the
// score is loading, when the RPC isn't there, or when someone has set a
// manual status override (that stays the human's call).
function HL_Dot({ clientId, fallback }) {
  const { byId } = HL_useHealth();
  const h = byId[clientId];
  if (!h || (fallback && fallback.isOverride)) {
    return typeof ClientHealthDot === "function" && fallback ? <ClientHealthDot health={fallback} /> : null;
  }
  const tip = HL_tooltip(h);
  return (
    <span
      className={"hl-dot hl-" + h.band}
      title={tip}
      aria-label={tip.replace(/\n/g, ". ")}
      role="img"
      style={{ background: HL_COLOR[h.band] || "var(--text-muted)" }}
    />
  );
}

function HL_HealthCard({ clientId }) {
  const { byId, status, reload } = HL_useHealth();
  const h = byId[clientId];
  if (status === "missing") return null;
  return (
    <div className={"card ov-stat hl-card" + (h && h.band === "red" ? " card-urgent" : "")}>
      <span className="kpi-label">Client health</span>
      {!h ? (
        <span className="ov-big muted">{status === "error" ? "Unavailable" : "…"}</span>
      ) : (
        <React.Fragment>
          <div className="hl-card-head">
            <span className={"ov-big hl-score hl-" + h.band}>{h.score}</span>
            <span className={"hl-band hl-band-" + h.band}>
              <span className="hl-dot" style={{ background: HL_COLOR[h.band] }} aria-hidden="true" />
              {HL_LABEL[h.band] || h.band}
            </span>
          </div>
          <div className="hl-meter" aria-hidden="true">
            <span style={{ width: Math.max(2, h.score) + "%", background: HL_COLOR[h.band] }} />
          </div>
          {h.reasons.length ? (
            <ul className="ov-lines hl-reasons">
              {h.reasons.map((r) => (
                <li key={r.key}>
                  <span>{r.label}</span>
                  <span className="negative">−{r.points}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ov-foot" style={{ marginTop: 8 }}>Nothing flagged. Tasks, QuickBooks, activity and close are on track.</p>
          )}
        </React.Fragment>
      )}
      <p className="ov-foot">
        Score out of 100 from overdue tasks, QuickBooks connection, staff activity in the last 30 days and month-end
        close.{" "}
        <button type="button" className="link-btn hl-refresh" onClick={reload}>
          Refresh
        </button>
      </p>
    </div>
  );
}
