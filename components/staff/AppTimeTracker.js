// ----------------------------------------------------------------------------
// Automatic in-app time per staff member per client (owner request
// 2026-09-29). Nothing is logged by hand; QuickBooks Time stays the only
// source of billed hours. This only counts how long staff actively spend in
// the app on each client, for the admin Team page ("In app" column).
//
// A second counts only while ALL of these hold:
//   - App says tracking is on: a real staff member, not a client in the
//     portal, not an admin in "View as" (impersonating), on a client page
//     (not a NON_CLIENT_PAGES page like Home or Team);
//   - the tab is visible;
//   - there was mouse, keyboard, touch or scroll input in the last 2 minutes;
//   - this tab holds the per-browser "leader" lock: only the tab a person
//     most recently used or focused counts, so two tabs never both accrue.
//     The lock is a localStorage entry {id, ts} rewritten on input/focus;
//     the server also caps each person to real elapsed time across all
//     clients (supabase/app-time-per-staff-clock.sql).
//
// Seconds accumulate per client in memory, flush every 60 s through the
// record_app_time RPC (supabase/app-time-tracking.sql), and flush again on
// tab hide / page close with a keepalive fetch using the cached session JWT.
// The server caps every call (120 s, wall-clock since last update, daily
// ceilings), so this file is not the line of defence against inflation.
//
// Loaded before app.jsx in the shared Babel scope: every top-level name has
// an AT_ prefix and no React hook is redeclared. App calls
// AT_setTrackingContext({ enabled, clientId }) from an effect.
// ----------------------------------------------------------------------------

const AT_IDLE_MS = 2 * 60 * 1000;
const AT_TICK_MS = 5000;
const AT_FLUSH_MS = 60 * 1000;
const AT_MAX_PER_CALL = 120;
const AT_MAX_PENDING = 600;
const AT_LEADER_KEY = "mgb_app_time_leader";
const AT_TAB_ID = Math.random().toString(36).slice(2) + Date.now().toString(36);

const AT_state = {
  started: false,
  enabled: false,
  clientId: null,
  lastInput: Date.now(),
  lastTick: Date.now(),
  pending: {}, // clientId -> seconds (float)
  token: null,
  flushing: false,
  disabled: false, // set when the server says the RPC is missing / not allowed
};

function AT_localDay() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Claim the lock for this tab (throttled: input can fire constantly).
let AT_lastClaim = 0;
function AT_claimLeader(force) {
  const now = Date.now();
  if (!force && now - AT_lastClaim < 1000) return;
  AT_lastClaim = now;
  try {
    localStorage.setItem(AT_LEADER_KEY, JSON.stringify({ id: AT_TAB_ID, ts: now }));
  } catch (e) {}
}

function AT_isLeader() {
  try {
    const raw = localStorage.getItem(AT_LEADER_KEY);
    if (!raw) return true;
    const v = JSON.parse(raw);
    // A leader idle past the input window can't be counting anyway.
    return !v || v.id === AT_TAB_ID || Date.now() - (v.ts || 0) > AT_IDLE_MS;
  } catch (e) {
    return true; // storage blocked: fall back to the server-side cap
  }
}

function AT_releaseLeader() {
  try {
    const v = JSON.parse(localStorage.getItem(AT_LEADER_KEY) || "null");
    if (v && v.id === AT_TAB_ID) localStorage.removeItem(AT_LEADER_KEY);
  } catch (e) {}
}

function AT_isActive() {
  return (
    AT_state.enabled &&
    !!AT_state.clientId &&
    !AT_state.disabled &&
    typeof document !== "undefined" &&
    document.visibilityState === "visible" &&
    Date.now() - AT_state.lastInput <= AT_IDLE_MS &&
    AT_isLeader()
  );
}

// Add the time since the last tick to the current client, if active.
function AT_tick() {
  const now = Date.now();
  // Cap a single step so a suspended laptop or throttled timer can't dump
  // minutes of "activity" at once.
  const step = Math.min(now - AT_state.lastTick, AT_TICK_MS * 2);
  AT_state.lastTick = now;
  if (step <= 0 || !AT_isActive()) return;
  const id = AT_state.clientId;
  AT_state.pending[id] = Math.min((AT_state.pending[id] || 0) + step / 1000, AT_MAX_PENDING);
}

function AT_refreshToken() {
  const sb = window.mgbSupabase;
  if (!sb || !sb.auth || typeof sb.auth.getSession !== "function") return;
  try {
    sb.auth
      .getSession()
      .then((r) => {
        const s = r && r.data && r.data.session;
        AT_state.token = s ? s.access_token : null;
      })
      .catch(() => {});
  } catch (e) {}
}

function AT_takeBatch() {
  const out = [];
  Object.keys(AT_state.pending).forEach((id) => {
    const secs = Math.floor(AT_state.pending[id] || 0);
    if (secs < 1) return;
    const send = Math.min(secs, AT_MAX_PER_CALL);
    AT_state.pending[id] -= send;
    if (AT_state.pending[id] < 0.001) delete AT_state.pending[id];
    out.push({ p_client_id: id, p_seconds: send, p_day: AT_localDay() });
  });
  return out;
}

function AT_putBack(item) {
  const id = item.p_client_id;
  AT_state.pending[id] = Math.min((AT_state.pending[id] || 0) + item.p_seconds, AT_MAX_PENDING);
}

// Regular flush through supabase-js.
async function AT_flush() {
  AT_tick();
  const sb = window.mgbSupabase;
  if (!sb || AT_state.flushing || AT_state.disabled) return;
  const batch = AT_takeBatch();
  if (!batch.length) return;
  AT_state.flushing = true;
  try {
    for (const item of batch) {
      let res;
      try {
        res = await sb.rpc("record_app_time", item);
      } catch (e) {
        res = { error: e };
      }
      const err = res && res.error;
      if (!err) continue;
      const msg = String(err.message || err);
      const code = err.code || "";
      if (code === "PGRST202" || code === "42883" || /could not find the function/i.test(msg)) {
        // Migration not applied here: stop trying for this page load.
        AT_state.disabled = true;
        AT_state.pending = {};
        break;
      }
      if (code === "42501" || /not authorized/i.test(msg)) continue; // drop it
      AT_putBack(item); // network / transient: retry next flush
    }
  } finally {
    AT_state.flushing = false;
  }
  AT_refreshToken();
}

// Last-chance flush on hide / close: keepalive fetch against the REST RPC
// with the cached JWT, since an awaited supabase-js call may not finish.
function AT_flushBeacon() {
  AT_tick();
  if (AT_state.disabled || AT_state.flushing) return;
  const cfg = window.SUPABASE_CONFIG;
  if (!cfg || !cfg.url || !cfg.anonKey || !AT_state.token) return;
  const batch = AT_takeBatch();
  batch.forEach((item) => {
    try {
      fetch(`${cfg.url}/rest/v1/rpc/record_app_time`, {
        method: "POST",
        keepalive: true,
        headers: {
          "Content-Type": "application/json",
          apikey: cfg.anonKey,
          Authorization: `Bearer ${AT_state.token}`,
        },
        body: JSON.stringify(item),
      }).catch(() => {});
    } catch (e) {
      AT_putBack(item);
    }
  });
}

function AT_start() {
  if (AT_state.started || typeof window === "undefined") return;
  AT_state.started = true;
  const markInput = () => {
    AT_state.lastInput = Date.now();
    AT_claimLeader(false);
  };
  const opts = { passive: true, capture: true };
  ["mousedown", "keydown", "touchstart", "wheel", "scroll", "pointerdown"].forEach((ev) =>
    window.addEventListener(ev, markInput, opts),
  );
  // mousemove fires constantly; a cheap throttle is plenty.
  let lastMove = 0;
  window.addEventListener(
    "mousemove",
    () => {
      const now = Date.now();
      if (now - lastMove > 1000) {
        lastMove = now;
        AT_state.lastInput = now;
        AT_claimLeader(false);
      }
    },
    opts,
  );
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      AT_flushBeacon();
    } else {
      AT_state.lastTick = Date.now();
      AT_state.lastInput = Date.now();
      AT_claimLeader(true);
    }
  });
  window.addEventListener("focus", () => AT_claimLeader(true));
  window.addEventListener("pagehide", () => {
    AT_flushBeacon();
    AT_releaseLeader();
  });
  if (document.visibilityState === "visible") AT_claimLeader(true);
  setInterval(AT_tick, AT_TICK_MS);
  setInterval(() => {
    AT_flush();
  }, AT_FLUSH_MS);
  AT_refreshToken();
  try {
    const sb = window.mgbSupabase;
    if (sb && sb.auth && typeof sb.auth.onAuthStateChange === "function") {
      sb.auth.onAuthStateChange((_event, session) => {
        AT_state.token = session ? session.access_token : null;
      });
    }
  } catch (e) {}
}

// Called by App whenever who/what is on screen changes.
function AT_setTrackingContext({ enabled, clientId }) {
  try {
    AT_start();
    const nextEnabled = !!enabled;
    const nextClient = nextEnabled ? clientId || null : null;
    if (nextEnabled === AT_state.enabled && nextClient === AT_state.clientId) return;
    // Book the time so far to the old context before switching.
    AT_tick();
    const switched = AT_state.clientId && AT_state.clientId !== nextClient;
    AT_state.enabled = nextEnabled;
    AT_state.clientId = nextClient;
    if (switched) AT_flush();
  } catch (e) {
    console.warn("App time tracker:", e && e.message);
  }
}

window.AT_setTrackingContext = AT_setTrackingContext;
