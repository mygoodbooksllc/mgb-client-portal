// ----------------------------------------------------------------------------
// L1 left sidebar (spec-l1-sidebar.md, build #2). When the gate is on, the
// staff rail (StaffRail in app.jsx) also lists Pinned clients, Recent clients
// and the admin Alerts section (L2, spec-l2-admin-alerts.md) under the places,
// has a Customize gear and a drag-wider grip. Everything here is invisible while the gate is off.
//
// The gate (SS_store, a copy of the Desk's WB_store pattern):
//   Layer 1  localStorage mgb_nav_preview = "1" ("Sidebar preview" in Feature flags)
//   Layer 2  tk_settings.nav_enabled (code never writes it; missing means off)
//   Layer 3  localStorage mgb_nav_classic = "1" (opt-out; added at launch only)
//   Classic wins, then preview or the firm switch (SS_navIsOn, WB_layout.js).
// Until the switch is read, the last answer is remembered (mgb_nav_on_cache).
// Every gated branch calls SS_isOn() (SS_useOn() in a component re-renders on a
// change). No raw flag reads anywhere else.
//
// Data: role defaults in tk_settings.layout_defaults (admins write, everyone
// reads, always run through WB_layoutParse); a person's choices in
// localStorage mgb_nav_prefs:<email> (only the differences from the role
// default); pins mgb_wb_pins:<email> and recents mgb-client-switcher-recent:<email>
// (the real viewer's, never the "View as" person's).
//
// Browser file; loads after WB_HubClient.jsx and SS_alerts.js. Uses WB_layout.js,
// WB_store.js (WB_pinToggle, WB_toast), SS_alerts.js (the pure alert rules),
// app.jsx globals at call time only.
// ----------------------------------------------------------------------------

const SS_PREVIEW_KEY = "mgb_nav_preview";
const SS_CLASSIC_KEY = "mgb_nav_classic";
const SS_CACHE_KEY = "mgb_nav_on_cache";
const SS_PREFS_PREFIX = "mgb_nav_prefs:";
const SS_SECTION_LABELS = { pinned: "Pinned clients", recent: "Recent clients", alerts: "Alerts" };

function SS__ls(key) {
  try {
    return window.localStorage.getItem(key);
  } catch (e) {
    return null;
  }
}
function SS__lsSet(key, val) {
  try {
    if (val == null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, val);
    return true;
  } catch (e) {
    return false;
  }
}
function SS_track(name, detail) {
  try {
    if (typeof window.MGB_track === "function") window.MGB_track(name, detail);
  } catch (e) {}
}
function SS_prefsKey(email) {
  const e = String(email == null ? "" : email).trim().toLowerCase();
  return e ? SS_PREFS_PREFIX + e : null;
}

// ---- The gate and the shared role defaults ----
const SS_store = (function () {
  let listeners = [];
  const previewOn = () => SS__ls(SS_PREVIEW_KEY) === "1";
  const classicOn = () => SS__ls(SS_CLASSIC_KEY) === "1";
  const fromCache = () => (classicOn() ? false : previewOn() || SS__ls(SS_CACHE_KEY) === "1");
  let state = { on: fromCache(), flagKnown: false, defaults: null, defaultsLoaded: false, alertsShown: false };
  let flagInflight = false;
  let defaultsInflight = false;
  let warned = false;

  function emit() {
    listeners.slice().forEach((fn) => {
      try {
        fn();
      } catch (e) {}
    });
  }
  function set(patch) {
    state = Object.assign({}, state, patch);
    emit();
  }
  function sb() {
    return typeof window !== "undefined" ? window.mgbSupabase : null;
  }

  // Reads tk_settings.nav_enabled. Without a client yet, nothing changes (the
  // cache stays) and the next ensure() tries again.
  function readFlag() {
    const c = sb();
    if (!c || flagInflight) return;
    flagInflight = true;
    const done = (v) => {
      flagInflight = false;
      const on = SS_navIsOn(v, previewOn(), classicOn());
      SS__lsSet(SS_CACHE_KEY, on ? "1" : null);
      set({ on: on, flagKnown: true });
      if (on) loadDefaults();
    };
    try {
      c.from("tk_settings")
        .select("value")
        .eq("key", "nav_enabled")
        .maybeSingle()
        .then(
          (res) => done(res && !res.error && res.data ? res.data.value : undefined),
          () => done(undefined),
        );
    } catch (e) {
      done(undefined);
    }
  }

  // Role defaults, once per session, and only while the gate is on.
  function loadDefaults(force) {
    const c = sb();
    if (!c || defaultsInflight || !state.on) return;
    if (state.defaultsLoaded && !force) return;
    defaultsInflight = true;
    const done = (v) => {
      defaultsInflight = false;
      let parsed = null;
      if (v !== undefined && v !== null) {
        parsed = WB_layoutParse(v);
        if (!parsed && !warned) {
          warned = true;
          try {
            console.warn("[sidebar] layout_defaults ignored (malformed, too big or a newer version); using the built-in layout.");
          } catch (e) {}
        }
      }
      set({ defaults: parsed, defaultsLoaded: true });
    };
    try {
      c.from("tk_settings")
        .select("value")
        .eq("key", "layout_defaults")
        .maybeSingle()
        .then(
          (res) => done(res && !res.error && res.data ? res.data.value : undefined),
          () => done(undefined),
        );
    } catch (e) {
      done(undefined);
    }
  }

  // The first component to mount starts the read; a later one retries if the
  // Supabase client was not ready yet.
  function ensure() {
    if (!state.flagKnown) readFlag();
    else if (state.on && !state.defaultsLoaded) loadDefaults();
  }

  // Another tab's answer arrives through the cache key (and a cleared storage).
  if (typeof window !== "undefined" && window.addEventListener) {
    window.addEventListener("storage", (e) => {
      if (e && e.key && e.key !== SS_CACHE_KEY) return;
      const on = fromCache();
      if (on !== state.on) set({ on: on });
    });
  }

  // L2: true only while the Alerts section is really rendered and visible with
  // data (SS_AlertsSection sets it). The top bar's QuickBooks badge hides on it.
  function setAlertsShown(v) {
    const next = !!v;
    if (next === state.alertsShown) return;
    state = Object.assign({}, state, { alertsShown: next });
    emit();
    try {
      window.dispatchEvent(new CustomEvent("mgb:ss-alerts", { detail: { shown: next } }));
    } catch (e) {}
  }

  return {
    get alertsShown() {
      return !!state.alertsShown;
    },
    setAlertsShown: setAlertsShown,
    getState: () => state,
    subscribe: (fn) => {
      listeners.push(fn);
      return () => {
        listeners = listeners.filter((f) => f !== fn);
      };
    },
    ensure: ensure,
    readFlag: readFlag,
    loadDefaults: loadDefaults,
    setDefaults: (parsed) => set({ defaults: parsed, defaultsLoaded: true }),
  };
})();

// The one switch every gated branch asks.
function SS_isOn() {
  return !!SS_store.getState().on;
}
// Same answer, and the component re-renders when it changes.
function SS_useOn() {
  const [, bump] = React.useState(0);
  React.useEffect(() => {
    const off = SS_store.subscribe(() => bump((n) => n + 1));
    SS_store.ensure();
    return off;
  }, []);
  return SS_isOn();
}

// ---- Per-person prefs, pins, recents, width ----
function SS__readPrefs(email) {
  const k = SS_prefsKey(email);
  return k ? WB_layoutParse(SS__ls(k)) : null;
}

// props: on, realEmail (the REAL viewer), isRealAdmin (real role admin, not "View as",
// not previewing: gates the Alerts section), role / hasTempAdminAccess / amCount
// (the person on screen), currentClientId, clients, readOnly, halfScreen,
// expanded. Returns null while the gate is off.
function SS_useSidebar(o) {
  const on = !!o.on;
  const email = String(o.realEmail || "").trim().toLowerCase();
  const readOnly = !!o.readOnly || !email;
  const roleKey = WB_layoutRoleKey({ role: o.role, hasTempAdminAccess: o.hasTempAdminAccess, amCount: o.amCount });
  const defaults = SS_store.getState().defaults;

  const [prefs, setPrefs] = React.useState(() => (on ? SS__readPrefs(email) : null));
  const [pins, setPins] = React.useState(() => (on && email ? WB_pinsRead(email) : []));
  const [recentIds, setRecentIds] = React.useState([]);
  const [liveWidth, setLiveWidth] = React.useState(null);
  const [dragging, setDragging] = React.useState(false);
  const [vw, setVw] = React.useState(() => (typeof window !== "undefined" ? window.innerWidth : 1440));

  // Prefs and pins: read on mount and when another tab (storage) or the Desk
  // (mgb:wb-pins, same tab) changes them.
  React.useEffect(() => {
    if (!on) return undefined;
    setPrefs(SS__readPrefs(email));
    setPins(email ? WB_pinsRead(email) : []);
    const prefKey = SS_prefsKey(email);
    const pinKey = typeof WB_pinsKey === "function" ? WB_pinsKey(email) : null;
    const onStorage = (e) => {
      if (!e || !e.key) {
        setPrefs(SS__readPrefs(email));
        setPins(email ? WB_pinsRead(email) : []);
      } else if (e.key === prefKey) setPrefs(SS__readPrefs(email));
      else if (e.key === pinKey) setPins(WB_pinsRead(email));
    };
    const onPins = (e) => {
      const who = e && e.detail && e.detail.email;
      if (!who || String(who).toLowerCase() === email) setPins(WB_pinsRead(email));
    };
    const onResize = () => setVw(window.innerWidth);
    window.addEventListener("storage", onStorage);
    window.addEventListener("mgb:wb-pins", onPins);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("mgb:wb-pins", onPins);
      window.removeEventListener("resize", onResize);
    };
  }, [on, email]);

  // Recents: read after the client switcher's own push for this page. Its push
  // effect can run after ours in the same pass, so read again a moment later.
  React.useEffect(() => {
    if (!on || !email) return undefined;
    const read = () => setRecentIds(WB_recentsRead(email));
    read();
    const t = setTimeout(read, 60);
    return () => clearTimeout(t);
  }, [on, email, o.currentClientId]);

  const base = React.useMemo(
    () => WB_layoutProfile({ bar: "left", roleKey: roleKey, roleDefaults: defaults }),
    [roleKey, defaults],
  );
  const profile = React.useMemo(
    () => WB_layoutProfile({ bar: "left", roleKey: roleKey, roleDefaults: defaults, personPrefs: prefs }),
    [roleKey, defaults, prefs],
  );

  const clientsById = React.useMemo(() => {
    const m = {};
    (Array.isArray(o.clients) ? o.clients : []).forEach((c) => {
      if (c && c.id != null) m[String(c.id)] = c;
    });
    return m;
  }, [o.clients]);
  const clientsReady = Object.keys(clientsById).length > 0;

  // Saves the person's choices as differences from the role default. Never
  // writes while "View as" is on. A blocked localStorage is a no-op with a note.
  const save = (next, usage) => {
    if (readOnly) return false;
    const diff = WB_layoutDiff(next, base);
    const k = SS_prefsKey(email);
    const text = Object.keys(diff).length ? JSON.stringify({ v: WB_LAYOUT_SCHEMA, left: diff }) : null;
    let ok = false;
    try {
      if (text == null) window.localStorage.removeItem(k);
      else window.localStorage.setItem(k, text);
      ok = true;
    } catch (e) {
      ok = false;
    }
    if (!ok) {
      WB_toast("Can't save in this browser");
      return false;
    }
    setPrefs(text == null ? null : WB_layoutParse(text));
    if (usage) SS_track(usage[0], usage[1]);
    return true;
  };
  const reset = () => {
    if (readOnly) return false;
    const k = SS_prefsKey(email);
    if (!SS__lsSet(k, null)) {
      WB_toast("Can't save in this browser");
      return false;
    }
    setPrefs(null);
    SS_track("nav-reset", "");
    return true;
  };

  // Pin or unpin (the real viewer's pins, through the one store the Desk uses).
  const togglePin = (id) => {
    if (readOnly || id == null) return;
    const r = WB_pinToggle(email, String(id), pins);
    setPins(r.pins);
    if (r.on && r.dropped) {
      const gone = clientsById[r.dropped];
      WB_toast("Pinned. " + (gone && gone.name ? gone.name : "Your oldest pin") + " was unpinned (" + WB_PINS_CAP + " at most).");
    }
  };

  if (!on) return null;
  const width = WB_layoutWidthFor(liveWidth != null ? liveWidth : profile.width, vw);
  const pinnedVisible = pins.filter((id) => clientsById[id]);
  const recentVisible = SS_filterRecents(
    clientsReady ? recentIds.filter((id) => clientsById[id]) : recentIds,
    pins,
    o.currentClientId,
  );
  return {
    roleKey: roleKey,
    base: base,
    profile: profile,
    readOnly: readOnly,
    width: width,
    dragging: dragging,
    setDragging: setDragging,
    setLiveWidth: setLiveWidth,
    pins: pins,
    pinnedIds: clientsReady ? pinnedVisible : pins,
    recentIds: recentVisible,
    clientsById: clientsById,
    clientsReady: clientsReady,
    currentClientId: o.currentClientId == null || o.currentClientId === "" ? null : String(o.currentClientId),
    save: save,
    reset: reset,
    togglePin: togglePin,
    // L2: alerts are for real admins only (not temp admins, not "View as").
    showAlerts: !!o.isRealAdmin,
  };
}

// ---- Admin alerts (L2, spec-l2-admin-alerts.md) ----
const SS_ALERT_REFRESH_MS = 10 * 60 * 1000; // same cadence as the old top bar badge
let SS_alertWarned = false;
function SS_alertWarn(what, err) {
  if (SS_alertWarned) return;
  SS_alertWarned = true;
  try {
    console.warn("[sidebar alerts] could not read " + what + "; that rule is skipped.", err && err.message ? err.message : "");
  } catch (e) {}
}
function SS_todayLocal() {
  return typeof todayLocal === "function" ? todayLocal() : OPS_isoDay(new Date());
}

// One read that never throws: resolves { ok, data }.
function SS_alertRead(what, make) {
  return new Promise((resolve) => {
    try {
      Promise.resolve(make()).then(
        (res) => {
          if (!res || res.error) {
            if (what !== "usage") SS_alertWarn(what, res && res.error);
            resolve({ ok: false, data: null });
          } else resolve({ ok: true, data: res.data });
        },
        (err) => {
          SS_alertWarn(what, err);
          resolve({ ok: false, data: null });
        },
      );
    } catch (err) {
      SS_alertWarn(what, err);
      resolve({ ok: false, data: null });
    }
  });
}

// The four reads, in parallel, each failing on its own. Nothing is fetched
// unless enabled (a real admin, rail on screen). Loads every 10 minutes while
// the tab is visible, and once on focus when the last load is older than that.
function SS_useAdminAlerts({ enabled }) {
  const [data, setData] = React.useState(null);
  const prev = React.useRef(null);
  React.useEffect(() => {
    if (!enabled) {
      prev.current = null;
      setData(null);
      return undefined;
    }
    let alive = true;
    let last = 0;
    let inflight = false;
    const load = () => {
      const sb = window.mgbSupabase;
      if (!sb || inflight || document.visibilityState === "hidden") return;
      inflight = true;
      const today = SS_todayLocal(); // recomputed every poll, so midnight rolls over
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const done = () => {
        inflight = false;
      };
      const guard = setTimeout(done, 30000); // a read that never settles must not stop polling
      Promise.all([
        SS_alertRead("usage", () => sb.rpc("qbo_usage_status")),
        SS_alertRead("ops_alert_state", () => sb.from("ops_alert_state").select("key,title,detail,first_seen_at").is("resolved_at", null).limit(100)),
        SS_alertRead("client_email_log", () =>
          sb.from("client_email_log").select("client_id,feature,created_at").eq("status", "error").neq("trigger", "preview").gt("created_at", since).order("created_at", { ascending: false }).limit(50),
        ),
        SS_alertRead("staff_time_off", () => sb.from("staff_time_off").select("staff_email,starts_on,ends_on,cancelled_at").is("cancelled_at", null).lte("starts_on", OPS_addDays(today, 60)).gte("ends_on", today)), // SS_alertRules keeps only today; the wider range lets back-to-back entries chain
        typeof CV_loadDirectory === "function"
          ? Promise.resolve(CV_loadDirectory()).then((l) => ({ ok: true, data: l || [] }), () => ({ ok: false, data: null }))
          : SS_alertRead("staff_directory", () => sb.rpc("staff_directory")),
      ]).then((r) => {
        clearTimeout(guard);
        done();
        if (!alive) return;
        last = Date.now();
        const dir = (r[4].data || []).map((s) => ({ email: String(s.email || "").toLowerCase(), name: s.name }));
        // A failed read keeps the last good value for that source (a blip never
        // turns a real alert into "All clear"); the first load starts empty.
        const keep = (i, key, okVal) => (okVal !== undefined ? okVal : prev.current && prev.current[key] !== undefined ? prev.current[key] : null);
        const next = {
          usage: keep(0, "usage", r[0].ok ? r[0].data || null : undefined),
          opsRows: keep(1, "opsRows", r[1].ok && Array.isArray(r[1].data) ? r[1].data : undefined),
          emailErrors: keep(2, "emailErrors", r[2].ok && Array.isArray(r[2].data) ? r[2].data : undefined),
          timeOff: keep(3, "timeOff", r[3].ok && Array.isArray(r[3].data) ? r[3].data : undefined),
          directory: r[4].ok ? dir : prev.current ? prev.current.directory : [],
          today: today,
          now: Date.now(),
        };
        prev.current = next;
        setData(next);
      });
    };
    load();
    const id = setInterval(load, SS_ALERT_REFRESH_MS);
    const onFocus = () => {
      if (Date.now() - last > SS_ALERT_REFRESH_MS) load();
    };
    const onVis = () => {
      if (document.visibilityState === "visible") onFocus();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      alive = false;
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [enabled]);
  return data; // null until the first load finishes
}

function SS_BellIcon(props) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

// A small error boundary: on an error the section renders nothing (and its
// unmount puts the top bar badge back).
class SS_AlertsBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err) {
    try {
      SS_store.setAlertsShown(false);
      console.warn("[sidebar alerts] the Alerts section failed and was hidden.", err && err.message ? err.message : "");
    } catch (e) {}
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function SS_alertGo(e, a, after) {
  SS_track("nav-alert-" + a.kind, "");
  if (after) after();
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
  if (a.to && typeof LK_go === "function") {
    e.preventDefault();
    LK_go(a.to);
  }
}

// Rows shared by the expanded list and the collapsed flyout.
function SS_AlertRows({ split, onGo }) {
  const row = (a) => (
    <a
      key={a.id}
      className={"ss-alert-row sev-" + a.severity}
      href={a.href}
      title={a.detail || undefined}
      onClick={(e) => SS_alertGo(e, a, onGo)}
    >
      <span className="ss-alert-dot" aria-hidden="true" />
      <span className="ss-alert-text">{a.text}</span>
    </a>
  );
  return (
    <>
      {split.shown.map(row)}
      {split.more > 0 && (
        <a className="ss-alert-more" href="#/settings" onClick={() => {
            SS_track("nav-alert-generic", "more");
            if (onGo) onGo();
          }}>
          {split.more} more
        </a>
      )}
      {split.info.map(row)}
    </>
  );
}

function SS_AlertsInner({ ss, expanded, showTip, hideTip }) {
  const rootRef = React.useRef(null);
  const btnRef = React.useRef(null);
  const [visible, setVisible] = React.useState(false);
  const [fly, setFly] = React.useState(null); // { left, top } when the collapsed flyout is open
  const closeTimer = React.useRef(0);

  // Is the rail on screen? (Phones and half-screen collapsed mode hide it by CSS.)
  React.useLayoutEffect(() => {
    const check = () => {
      const el = rootRef.current;
      setVisible(!!el && el.getClientRects().length > 0);
    };
    check();
    window.addEventListener("resize", check);
    // The rail hides under 761px unless there is a fine pointer (styles.css).
    let mq = null;
    try {
      mq = window.matchMedia ? window.matchMedia("(min-width: 761px), (hover: hover) and (pointer: fine)") : null;
      if (mq && mq.addEventListener) mq.addEventListener("change", check);
    } catch (e) {
      mq = null;
    }
    return () => {
      window.removeEventListener("resize", check);
      try {
        if (mq && mq.removeEventListener) mq.removeEventListener("change", check);
      } catch (e) {}
    };
  }, [expanded]);

  const data = SS_useAdminAlerts({ enabled: !!ss.showAlerts && visible });
  const alerts = React.useMemo(
    () =>
      data
        ? SS_alertRules({
            usage: data.usage,
            opsRows: data.opsRows,
            emailErrors: data.emailErrors,
            timeOff: data.timeOff,
            directory: data.directory,
            clientsById: ss.clientsById,
            excludedIds: typeof CF_excludedIds === "function" ? Array.from(CF_excludedIds()) : [],
            today: data.today,
            now: data.now,
          })
        : [],
    [data, ss.clientsById],
  );
  const split = React.useMemo(() => SS_alertSplit(alerts, 5), [alerts]);
  const count = SS_alertBadgeCount(alerts);
  const ready = !!data;

  // The mounted signal the top bar reads: only while really rendered, visible and loaded.
  React.useLayoutEffect(() => {
    SS_store.setAlertsShown(ready && visible);
  }, [ready, visible]);
  React.useLayoutEffect(() => () => SS_store.setAlertsShown(false), []);

  const closeFly = () => {
    clearTimeout(closeTimer.current);
    setFly(null);
  };
  const openFly = () => {
    clearTimeout(closeTimer.current);
    const b = btnRef.current;
    if (!b) return;
    const r = b.getBoundingClientRect();
    setFly((cur) => {
      if (!cur) SS_track("nav-alert-open", "");
      return { left: r.right + 8, top: Math.max(8, r.top) };
    });
  };
  const holdClose = () => {
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setFly(null), 200);
  };
  React.useEffect(() => {
    if (!fly) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") {
        closeFly();
        if (btnRef.current) btnRef.current.focus();
      }
    };
    const onDown = (e) => {
      const t = e.target;
      if (btnRef.current && btnRef.current.contains(t)) return;
      if (t && t.closest && t.closest(".ss-alert-fly")) return;
      closeFly();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
      clearTimeout(closeTimer.current);
    };
  }, [!!fly]);
  React.useEffect(() => {
    if (expanded) setFly(null);
  }, [expanded]);

  const clear = ready && split.shown.length === 0;
  return (
    <div
      ref={rootRef}
      className={"ss-section ss-alerts" + (ready ? "" : " ss-alerts-pending")}
      data-tour="staff-sidebar-alerts"
      role="region"
      aria-label="Alerts"
    >
      {ready &&
        (expanded ? (
          <>
            <div className="staff-rail-heading ss-heading ss-alerts-head">
              <span>Alerts</span>
              {count > 0 && (
                <span className="ss-alert-badge" aria-label={count + " admin alert" + (count === 1 ? "" : "s")}>
                  {count}
                </span>
              )}
            </div>
            {clear && <div className="ss-alert-clear">All clear</div>}
            <SS_AlertRows split={split} onGo={null} />
          </>
        ) : (
          <>
            <div className="staff-rail-divider" role="separator" aria-label="Alerts" />
            <button
              type="button"
              ref={btnRef}
              className="staff-rail-item ss-alert-btn"
              aria-haspopup="true"
              aria-expanded={!!fly}
              aria-label={count > 0 ? count + " admin alert" + (count === 1 ? "" : "s") : "Alerts: all clear"}
              onClick={openFly}
              onMouseEnter={openFly}
              onMouseLeave={holdClose}
              onFocus={openFly}
            >
              <span className="ss-alert-bell">
                <SS_BellIcon />
                {count > 0 && (
                  <span className="ss-alert-badge ss-alert-badge-mini" aria-hidden="true">
                    {count > 9 ? "9+" : count}
                  </span>
                )}
              </span>
            </button>
            {fly &&
              ReactDOM.createPortal(
                <div
                  className="ss-alert-fly"
                  role="region"
                  aria-label="Alerts"
                  style={{ left: fly.left, top: fly.top }}
                  onMouseEnter={() => clearTimeout(closeTimer.current)}
                  onMouseLeave={holdClose}
                >
                  <div className="ss-alert-fly-title">Alerts</div>
                  {clear && <div className="ss-alert-clear">All clear</div>}
                  <SS_AlertRows split={split} onGo={closeFly} />
                </div>,
                document.body,
              )}
          </>
        ))}
    </div>
  );
}

function SS_AlertsSection(props) {
  return (
    <SS_AlertsBoundary>
      <SS_AlertsInner {...props} />
    </SS_AlertsBoundary>
  );
}

// ---- Icons ----
function SS_GearIcon(props) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
function SS_PinIcon(props) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6z" />
      <path d="M12 14v7" />
    </svg>
  );
}
function SS_CloseIcon(props) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true" {...props}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

// ---- Client rows ----
// One line under the name: the account manager's initials, only when the
// roster already in memory has one. Never fetched per row.
function SS_detailLine(client) {
  const am = client && client.accountManager;
  const name = am && typeof am.name === "string" ? am.name.trim() : "";
  if (name) return "AM " + SS_initials(name);
  const bk = client && client.assignedBookkeeper;
  const bn = bk && typeof bk.name === "string" ? bk.name.trim() : "";
  return bn ? "BK " + SS_initials(bn) : "";
}

// kind: "pinned" | "recent". detail: "compact" (name only) or "full" (name plus
// the detail line). Collapsed rails show an initials chip and the portaled
// hover tip (showTip, from StaffRail) with the full name and detail.
function SS_ClientSection({ kind, ss, expanded, detail, showTip, hideTip, onOpenClient }) {
  const ids = kind === "pinned" ? ss.pinnedIds : ss.recentIds;
  const canPinHere = kind === "pinned" && !ss.readOnly && ss.currentClientId && ss.clientsById[ss.currentClientId] && ss.pins.indexOf(ss.currentClientId) < 0;
  if (!ids.length && !canPinHere) return null;
  const heading = kind === "pinned" ? "Pinned" : "Recent";
  const rows = ids.map((id) => {
    const c = ss.clientsById[id];
    const name = c ? String(c.name || id) : "";
    const line = c ? SS_detailLine(c) : "";
    const active = kind === "pinned" && id === ss.currentClientId;
    const tipText = line ? name + " · " + line : name;
    return (
      <div className={"ss-client-row" + (active ? " active" : "")} key={id}>
        {c ? (
          <a
            className={"staff-rail-item ss-client" + (active ? " active" : "")}
            href={"#/client/" + encodeURIComponent(id)}
            aria-current={active ? "page" : undefined}
            aria-label={expanded ? undefined : name}
            onClick={(e) => onOpenClient(e, id)}
            onMouseEnter={(e) => showTip(e, tipText)}
            onMouseLeave={hideTip}
            onFocus={(e) => showTip(e, tipText)}
            onBlur={hideTip}
          >
            <span className="ss-chip" aria-hidden="true">{SS_initials(name)}</span>
            {expanded && (
              <span className="ss-client-text">
                <span className="ss-client-name">{name}</span>
                {detail === "full" && line && <span className="ss-client-detail">{line}</span>}
              </span>
            )}
          </a>
        ) : (
          <span className="staff-rail-item ss-client ss-skel" aria-hidden="true">
            <span className="ss-chip">?</span>
            {expanded && <span className="ss-client-text"><span className="ss-skel-bar" /></span>}
          </span>
        )}
        {kind === "pinned" && c && !ss.readOnly && expanded && (
          <button type="button" className="ss-unpin" aria-label={"Unpin " + name} title="Unpin" onClick={() => ss.togglePin(id)}>
            <SS_CloseIcon />
          </button>
        )}
      </div>
    );
  });
  // Roster not loaded yet: up to three placeholder rows (initials skeleton).
  const shown = ss.clientsReady ? rows : rows.slice(0, 3);
  return (
    <div className="ss-section" data-tour={kind === "pinned" ? "staff-sidebar-pinned" : "staff-sidebar-recent"}>
      {expanded ? (
        <div className="staff-rail-heading ss-heading">{heading}</div>
      ) : (
        <div className="staff-rail-divider" role="separator" aria-label={heading} />
      )}
      {canPinHere && (
        <button
          type="button"
          className="staff-rail-item ss-pin-this"
          onClick={() => ss.togglePin(ss.currentClientId)}
          aria-label="Pin this client"
          onMouseEnter={(e) => showTip(e, "Pin this client")}
          onMouseLeave={hideTip}
          onFocus={(e) => showTip(e, "Pin this client")}
          onBlur={hideTip}
        >
          <SS_PinIcon />
          {expanded && <span className="staff-rail-label">Pin this client</span>}
        </button>
      )}
      {shown}
    </div>
  );
}

// The sections under the places, in the profile's order. Places themselves
// stay as StaffRail draws them.
function SS_Sections({ ss, expanded, showTip, hideTip }) {
  const open = (e, id) => {
    hideTip();
    if (typeof LK_go === "function" && !(e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1)) {
      e.preventDefault();
      LK_go({ clientId: id });
    }
  };
  const p = ss.profile;
  return (
    <>
      {p.order.map((id) => {
        if (id === "places" || !p.on[id] || p.detail[id] === "off") return null;
        if (id === "pinned" || id === "recent") {
          return <SS_ClientSection key={id} kind={id} ss={ss} expanded={expanded} detail={p.detail[id]} showTip={showTip} hideTip={hideTip} onOpenClient={open} />;
        }
        if (id === "alerts") return ss.showAlerts ? <SS_AlertsSection key={id} ss={ss} expanded={expanded} showTip={showTip} hideTip={hideTip} /> : null;
        return null;
      })}
    </>
  );
}

// ---- Drag-wider grip ----
function SS_WidthGrip({ ss, railRef }) {
  const w = ss.width;
  const commit = (next) => {
    ss.setLiveWidth(null);
    const profile = Object.assign({}, ss.profile, { width: WB_layoutWidthFor(next, 9999) });
    if (profile.width !== ss.profile.width) ss.save(profile, ["nav-widen", String(profile.width)]);
  };
  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const rail = railRef.current;
    if (!rail) return;
    const left = rail.getBoundingClientRect().left;
    const target = e.currentTarget;
    try {
      target.setPointerCapture(e.pointerId);
    } catch (err) {}
    ss.setDragging(true);
    let last = w;
    let moved = false;
    const move = (ev) => {
      moved = true;
      last = WB_layoutWidthFor(ev.clientX - left, window.innerWidth);
      ss.setLiveWidth(last);
    };
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
      ss.setDragging(false);
      if (moved) commit(last);
      else ss.setLiveWidth(null);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  };
  const onKeyDown = (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const next = WB_layoutWidthFor(w + (e.key === "ArrowRight" ? 20 : -20), window.innerWidth);
    ss.setLiveWidth(null);
    const profile = Object.assign({}, ss.profile, { width: next });
    ss.save(profile, ["nav-widen", String(next)]);
  };
  const onDouble = () => {
    ss.setLiveWidth(null);
    ss.save(Object.assign({}, ss.profile, { width: WB_LAYOUT_WIDTH_MIN }), ["nav-widen", "reset"]);
  };
  return (
    <div
      className="ss-grip"
      role="separator"
      aria-orientation="vertical"
      aria-label="Sidebar width. Arrow keys change it, double-click resets."
      aria-valuenow={w}
      aria-valuemin={WB_LAYOUT_WIDTH_MIN}
      aria-valuemax={WB_LAYOUT_WIDTH_MAX}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={onDouble}
    />
  );
}

// ---- Layout controls (the gear and the admin defaults card share these) ----
// profile: a complete profile. onChange(nextProfile). allowWidth: show the width slider.
function SS_LayoutControls({ profile, onChange, readOnly, showAlerts, allowWidth }) {
  const ids = profile.order.filter((id) => id !== "places" && (id !== "alerts" || showAlerts));
  const move = (id, dir) => {
    const list = profile.order.filter((x) => x === "places" || x !== "alerts" || showAlerts);
    const i = list.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 1 || j >= list.length) return;
    const next = list.slice();
    next[i] = list[j];
    next[j] = id;
    // Keep any hidden ids (alerts for non-admins) at the end.
    const rest = profile.order.filter((x) => next.indexOf(x) < 0);
    onChange(Object.assign({}, profile, { order: next.concat(rest) }));
  };
  const setOn = (id, v) => {
    const detail = Object.assign({}, profile.detail);
    if (v && detail[id] === "off") detail[id] = "compact";
    onChange(Object.assign({}, profile, { on: Object.assign({}, profile.on, { [id]: v }), detail: detail }));
  };
  const setDetail = (id, v) => onChange(Object.assign({}, profile, { detail: Object.assign({}, profile.detail, { [id]: v }) }));
  return (
    <div className="ss-controls">
      <div className="ss-ctl-row ss-ctl-fixed">
        <span className="ss-ctl-label">Places</span>
        <span className="ss-ctl-note">Always on, always first</span>
      </div>
      {ids.map((id, i) => {
        const on = !!profile.on[id] && profile.detail[id] !== "off";
        const first = i === 0;
        const last = i === ids.length - 1;
        return (
          <div className="ss-ctl-row" key={id}>
            <label className="ss-ctl-switch">
              <input type="checkbox" checked={on} disabled={readOnly} onChange={(e) => setOn(id, e.target.checked)} />
              <span className="ss-ctl-label">{SS_SECTION_LABELS[id] || id}</span>
            </label>
            <span className="ss-ctl-tools">
              {id !== "alerts" && (
                <select
                  className="ss-ctl-select"
                  aria-label={(SS_SECTION_LABELS[id] || id) + " detail"}
                  value={profile.detail[id] === "full" ? "full" : "compact"}
                  disabled={readOnly || !on}
                  onChange={(e) => setDetail(id, e.target.value)}
                >
                  <option value="compact">Name only</option>
                  <option value="full">Name and detail</option>
                </select>
              )}
              <button type="button" className="ss-ctl-btn" aria-label={"Move " + (SS_SECTION_LABELS[id] || id) + " up"} disabled={readOnly || first} onClick={() => move(id, -1)}>
                &uarr;
              </button>
              <button type="button" className="ss-ctl-btn" aria-label={"Move " + (SS_SECTION_LABELS[id] || id) + " down"} disabled={readOnly || last} onClick={() => move(id, 1)}>
                &darr;
              </button>
            </span>
          </div>
        );
      })}
      {allowWidth && (
        <div className="ss-ctl-row">
          <label className="ss-ctl-label" htmlFor="ss-ctl-width">Width</label>
          <span className="ss-ctl-tools">
            <input
              id="ss-ctl-width"
              type="range"
              min={WB_LAYOUT_WIDTH_MIN}
              max={WB_LAYOUT_WIDTH_MAX}
              step="20"
              value={profile.width}
              disabled={readOnly}
              onChange={(e) => onChange(Object.assign({}, profile, { width: WB_layoutWidthFor(Number(e.target.value), 9999) }))}
            />
            <span className="ss-ctl-note">{profile.width}px</span>
          </span>
        </div>
      )}
    </div>
  );
}

// ---- The gear (per person) ----
function SS_Gear({ ss, expanded, railRef, showTip, hideTip }) {
  const [open, setOpen] = React.useState(false);
  const btnRef = React.useRef(null);
  const popRef = React.useRef(null);
  const [pos, setPos] = React.useState(null);
  React.useEffect(() => {
    if (!open) return undefined;
    const rail = railRef.current;
    const r = rail ? rail.getBoundingClientRect() : { right: 80 };
    setPos({ left: r.right + 8, bottom: 12 });
    const onDown = (e) => {
      if (popRef.current && popRef.current.contains(e.target)) return;
      if (btnRef.current && btnRef.current.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        setOpen(false);
        if (btnRef.current) btnRef.current.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  // Move focus into the dialog once it is on screen (it is portaled to the end of body).
  React.useEffect(() => {
    if (!open || !pos || !popRef.current) return;
    const first = popRef.current.querySelector("input,select,button");
    if (first && first.focus) first.focus();
  }, [open, !!pos]);
  const toggle = () => {
    hideTip();
    setOpen((v) => {
      if (!v) SS_track("nav-gear", "open");
      return !v;
    });
  };
  return (
    <>
      <button
        type="button"
        ref={btnRef}
        className="sidebar-collapse-toggle ss-gear"
        data-tour="staff-sidebar-gear"
        onClick={toggle}
        aria-label="Customize sidebar"
        aria-expanded={open}
        aria-haspopup="dialog"
        onMouseEnter={(e) => showTip(e, "Customize sidebar")}
        onMouseLeave={hideTip}
        onFocus={(e) => showTip(e, "Customize sidebar")}
        onBlur={hideTip}
      >
        <SS_GearIcon />
        {expanded && <span>Customize</span>}
      </button>
      {open &&
        pos &&
        ReactDOM.createPortal(
          <div ref={popRef} className="ss-pop" role="dialog" aria-label="Customize sidebar" style={{ left: pos.left, bottom: pos.bottom }}>
            <div className="ss-pop-title">Customize sidebar</div>
            {ss.readOnly ? (
              <p className="ss-pop-note">Customize is off while viewing as someone</p>
            ) : (
              <p className="ss-pop-note">Saved for you in this browser.</p>
            )}
            <SS_LayoutControls profile={ss.profile} readOnly={ss.readOnly} showAlerts={ss.showAlerts} onChange={(next) => ss.save(next)} />
            <div className="ss-pop-foot">
              <button type="button" className="btn-secondary st-btn-sm" disabled={ss.readOnly} onClick={() => ss.reset()}>
                Reset to my role's default
              </button>
              <button type="button" className="btn-secondary st-btn-sm" onClick={() => setOpen(false)}>
                Done
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

// ---- Admin: Sidebar defaults card (Settings > Firm settings) ----
const SS_ROLE_OPTIONS = [
  ["admin", "Admin"],
  ["am", "Account manager"],
  ["bookkeeper", "Bookkeeper"],
  ["tempAdmin", "Temp admin"],
];

// Lightweight read-only preview: the sections only, no data-tour keys, no links.
function SS_Preview({ profile, showAlerts }) {
  const sample = [
    { n: "Sample client A", d: "AM JG" },
    { n: "Sample client B", d: "AM TS" },
  ];
  const label = (id) => (id === "pinned" ? "Pinned" : id === "recent" ? "Recent" : "Alerts");
  return (
    <div className="ss-preview" aria-hidden="true">
      <div className="ss-preview-rail" style={{ width: profile.width }}>
        <div className="ss-preview-places">Today, Inbox, Work, Clients, Team</div>
        {profile.order.map((id) => {
          if (id === "places" || !profile.on[id] || profile.detail[id] === "off") return null;
          if (id === "alerts") return showAlerts ? <div className="ss-preview-alerts" key={id}>{label(id)}</div> : null;
          return (
            <div className="ss-preview-sec" key={id}>
              <div className="staff-rail-heading ss-heading">{label(id)}</div>
              {sample.map((s) => (
                <div className="ss-preview-row" key={s.n}>
                  <span className="ss-chip">{SS_initials(s.n)}</span>
                  <span className="ss-client-text">
                    <span className="ss-client-name">{s.n}</span>
                    {profile.detail[id] === "full" && <span className="ss-client-detail">{s.d}</span>}
                  </span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SS_DefaultsCard() {
  const [role, setRole] = React.useState("bookkeeper");
  const [saved, setSaved] = React.useState(() => SS_store.getState().defaults);
  const [draft, setDraft] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState("");
  // Per role: admins' built-in order has Alerts after the places (WB_layoutProfile).
  const builtin = React.useMemo(() => WB_layoutProfile({ bar: "left", roleKey: role }), [role]);
  React.useEffect(() => {
    SS_store.ensure();
    return SS_store.subscribe(() => setSaved(SS_store.getState().defaults));
  }, []);
  // The profile on screen for this role: the saved default, or the draft.
  const current = React.useMemo(() => WB_layoutProfile({ bar: "left", roleKey: role, roleDefaults: saved }), [role, saved]);
  const profile = draft && draft.role === role ? draft.profile : current;
  const dirty = !!draft && draft.role === role;
  // Temp admins never see the Alerts section (L2), so only the admin role lists it.
  const showAlerts = role === "admin";

  // mutate(roles) edits a plain copy of the roles as stored RIGHT NOW: the row is
  // read again just before the save so another role's defaults are never lost.
  const write = async (mutate, doneText, usage) => {
    const sb = window.mgbSupabase;
    if (!sb) {
      setMsg("Not connected. Try again.");
      return;
    }
    setBusy(true);
    setMsg("");
    let nextRoles = {};
    try {
      const cur = await sb.from("tk_settings").select("value").eq("key", "layout_defaults").maybeSingle();
      if (!cur || cur.error) {
        setMsg("Could not read the current defaults. Try again.");
        setBusy(false);
        return;
      }
      if (cur.data && cur.data.value !== undefined && cur.data.value !== null) {
        const parsed = WB_layoutParse(cur.data.value);
        if (!parsed) {
          setMsg("The saved defaults could not be read, so nothing was changed.");
          setBusy(false);
          return;
        }
        Object.keys(parsed.roles || {}).forEach((rk) => {
          nextRoles[rk] = parsed.roles[rk];
        });
      }
    } catch (e) {
      setMsg("Could not read the current defaults. Try again.");
      setBusy(false);
      return;
    }
    mutate(nextRoles);
    const value = { v: WB_LAYOUT_SCHEMA };
    if (Object.keys(nextRoles).length) value.roles = nextRoles;
    if (JSON.stringify(value).length > WB_LAYOUT_MAX_BYTES) {
      setMsg("Too big to save (8 KB at most).");
      setBusy(false);
      return;
    }
    try {
      const res = await sb.from("tk_settings").upsert({ key: "layout_defaults", value: value }, { onConflict: "key" });
      if (res && res.error) {
        setMsg(/42501|row-level security|permission/i.test(String(res.error.code || "") + " " + String(res.error.message || "")) ? "Only admins can save sidebar defaults." : "Could not save. Try again.");
      } else {
        SS_store.setDefaults(WB_layoutParse(value));
        setDraft(null);
        setMsg(doneText);
        SS_track(usage, role);
        try {
          WB_toast(doneText);
        } catch (e) {}
      }
    } catch (e) {
      setMsg("Could not save. Try again.");
    }
    setBusy(false);
  };
  const onSave = () => {
    const diff = WB_layoutDiff(profile, builtin);
    write((roles) => {
      if (Object.keys(diff).length) roles[role] = { left: diff };
      else delete roles[role];
    }, "Saved the sidebar default for " + (SS_ROLE_OPTIONS.find((r) => r[0] === role) || [0, role])[1] + ".", "nav-defaults-save");
  };
  const onResetRole = () => {
    write((roles) => {
      delete roles[role];
    }, "Reset this role to the built-in sidebar.", "nav-defaults-save");
  };
  return (
    <div className="ss-defaults">
      <p className="st-muted">
        What each kind of person sees in the left sidebar until they customize it. Anyone's own choices win; fields they never touched follow these defaults.
      </p>
      <div className="ss-defaults-pick">
        <label htmlFor="ss-role-pick" className="st-row-label">Role</label>
        <select id="ss-role-pick" className="ss-ctl-select" value={role} onChange={(e) => { setRole(e.target.value); setMsg(""); }}>
          {SS_ROLE_OPTIONS.map((r) => (
            <option key={r[0]} value={r[0]}>{r[1]}</option>
          ))}
        </select>
      </div>
      <div className="ss-defaults-body">
        <SS_LayoutControls profile={profile} showAlerts={showAlerts} allowWidth onChange={(next) => setDraft({ role: role, profile: next })} />
        <SS_Preview profile={profile} showAlerts={showAlerts} />
      </div>
      <div className="ss-pop-foot">
        <button type="button" className="btn-primary st-btn-sm" disabled={busy || !dirty} onClick={onSave}>Save</button>
        <button type="button" className="btn-secondary st-btn-sm" disabled={busy} onClick={onResetRole}>Reset this role to built-in</button>
      </div>
      <p className="st-muted" aria-live="polite">{msg}</p>
    </div>
  );
}
