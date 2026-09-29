// ----------------------------------------------------------------------------
// Client switcher and temporary client access (owner request 2026-09-29).
//
// - CS_ClientSwitcher: the card at the top of the client sidebar and the staff
//   sidebar (replaces the old native <select> pickers). Search, recents, the
//   clients you can open, and the rest of the roster behind a lock with a
//   "Request access" action.
// - CS_RequestAccessModal: reason + duration, calls request_client_access.
// - CS_AccessRequestsCard: staff Home card for approvers (approve, deny,
//   revoke live temporary access).
// - CS_ApprovalsDot: the subtle "something to approve" dot on the Home link.
// - CS_TempAccessNote: slim note on a client page opened through a live grant.
// - CS_useLiveGrantClientIds: used by App to widen visibleClients with live
//   grants, so an approval shows up without a reload.
//
// Database: supabase/temp-client-access.sql. The server enforces everything
// (can_access_client honors live grants); this UI is only a convenience, so
// every query fails soft: no Supabase, a 401 or a missing table just leaves
// the grant list empty and the approvals card hidden.
//
// Loaded before app.jsx and shares its global scope, so every top-level name
// here carries a CS_ prefix, and app.jsx globals (hooks, icons, ModalShell,
// ClientHealthDot, planLabel...) are only touched at render time.
// ----------------------------------------------------------------------------

const CS_RECENT_KEY = "mgb-client-switcher-recent";
const CS_RECENT_MAX = 5;
const CS_REASON_MAX = 500;
const CS_DURATIONS = [
  { days: 1, label: "1 day" },
  { days: 7, label: "1 week" },
  { days: 30, label: "30 days" },
];
const CS_GRANT_COLUMNS =
  "id, client_id, staff_email, staff_name, reason, duration_days, status, requested_at, decided_by, decided_at, expires_at";

// ---------------------------------------------------------------------------
// Shared grant store. One fetch and one realtime channel for the whole app,
// however many components read it. App owns its lifetime (via
// CS_useLiveGrantClientIds); everything else just subscribes.
// ---------------------------------------------------------------------------
const CS_store = {
  email: null, // the real signed-in staffer (not an impersonated one)
  grants: [], // pending + live rows RLS lets this person see
  status: "idle", // idle | loading | ready | error | unavailable
  error: "",
  version: 0,
  dataRev: 0, // bumped once QuickBooks data for a newly granted client lands
  listeners: new Set(),
  channel: null,
  tick: null,
  poll: null,
  reloadTimer: null,
  loadSeq: 0,
};

const CS_lc = (s) => String(s || "").toLowerCase();

function CS_isLive(g, now) {
  return (
    g.status === "approved" &&
    !!g.expires_at &&
    new Date(g.expires_at).getTime() > (now || Date.now())
  );
}

function CS_emit() {
  CS_store.version += 1;
  CS_store.listeners.forEach((fn) => fn());
}

function CS_liveIdsFor(email, now) {
  const e = CS_lc(email);
  return CS_store.grants
    .filter((g) => CS_lc(g.staff_email) === e && CS_isLive(g, now))
    .map((g) => g.client_id)
    .sort();
}

// Plain-language versions of the RPC errors in temp-client-access.sql.
function CS_friendlyError(err) {
  if (!err) return "Something went wrong. Try again.";
  const msg = CS_lc(err.message || err);
  const code = err.code || "";
  if (code === "23505" || msg.includes("duplicate"))
    return "You already have a pending request for this client.";
  if (msg.includes("already have access"))
    return "You already have access to this client.";
  if (msg.includes("no longer pending"))
    return "Someone already handled this request.";
  if (msg.includes("nothing to end")) return "This access has already ended.";
  if (msg.includes("unknown client")) return "That client no longer exists.";
  if (msg.includes("give a reason")) return "Add a reason for the request.";
  if (msg.includes("jwt") || err.status === 401 || code === "PGRST301")
    return "Your session has expired. Sign in again and retry.";
  if (
    code === "42501" ||
    msg.includes("not allowed") ||
    msg.includes("permission denied")
  )
    return "Your account isn't allowed to do that.";
  if (msg.includes("failed to fetch") || msg.includes("network"))
    return "Couldn't reach the server. Check your connection and try again.";
  return "Something went wrong. Try again.";
}

async function CS_loadGrants() {
  const supabase = window.mgbSupabase;
  if (!supabase || !CS_store.email) return;
  const seq = ++CS_store.loadSeq;
  const wasReady = CS_store.status === "ready";
  const before = new Set(CS_liveIdsFor(CS_store.email));
  if (!wasReady) CS_store.status = "loading";
  const nowIso = new Date().toISOString();
  try {
    // Only what's still actionable: open requests and unexpired grants.
    // Decided/expired history would just grow forever here.
    const { data, error } = await supabase
      .from("staff_client_access_grants")
      .select(CS_GRANT_COLUMNS)
      .or(`status.eq.pending,and(status.eq.approved,expires_at.gt."${nowIso}")`)
      .order("requested_at", { ascending: false })
      .limit(500);
    if (seq !== CS_store.loadSeq) return;
    if (error) {
      CS_store.status = "error";
      CS_store.error = CS_friendlyError(error);
      CS_store.grants = [];
    } else {
      CS_store.status = "ready";
      CS_store.error = "";
      CS_store.grants = data || [];
      // A client that just became reachable only has roster data: its
      // QuickBooks numbers were loaded at boot, under the old RLS answer.
      // Fetch them now so the switch lands on real numbers.
      const added = CS_liveIdsFor(CS_store.email).filter((id) => !before.has(id));
      if (wasReady && added.length && window.mgbReloadQboData) {
        Promise.resolve(window.mgbReloadQboData(added))
          .catch(() => {})
          .then(() => {
            CS_store.dataRev += 1;
            CS_emit();
          });
      }
    }
  } catch (err) {
    if (seq !== CS_store.loadSeq) return;
    CS_store.status = "error";
    CS_store.error = CS_friendlyError(err);
    CS_store.grants = [];
  }
  CS_emit();
}

// Realtime events arrive in bursts (an approve touches one row, but several
// tabs may act at once), so coalesce them into one reload.
function CS_scheduleReload(delay = 250) {
  clearTimeout(CS_store.reloadTimer);
  CS_store.reloadTimer = setTimeout(CS_loadGrants, delay);
}

function CS_stopGrants() {
  const supabase = window.mgbSupabase;
  if (CS_store.channel && supabase) supabase.removeChannel(CS_store.channel);
  clearInterval(CS_store.tick);
  clearInterval(CS_store.poll);
  clearTimeout(CS_store.reloadTimer);
  Object.assign(CS_store, {
    email: null,
    grants: [],
    status: "idle",
    error: "",
    channel: null,
    tick: null,
    poll: null,
    reloadTimer: null,
  });
  CS_store.loadSeq += 1;
  CS_emit();
}

function CS_startGrants(email) {
  if (CS_store.email === email) return;
  CS_stopGrants();
  CS_store.email = email;
  const supabase = window.mgbSupabase;
  if (!supabase) {
    CS_store.status = "unavailable";
    CS_emit();
    return;
  }
  CS_loadGrants();
  try {
    // Private channel, same pattern as Team Chat: realtime.messages RLS
    // checks the caller, and the table's own RLS picks which rows reach whom.
    CS_store.channel = supabase
      .channel("access-grants-" + email, { config: { private: true } })
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "staff_client_access_grants" },
        () => CS_scheduleReload(),
      )
      .subscribe();
  } catch (e) {
    CS_store.channel = null;
  }
  // Re-render every 30s so countdowns move and an expired grant drops out
  // close to the minute, with no server round trip.
  CS_store.tick = setInterval(CS_emit, 30000);
  // Safety net if the realtime socket quietly drops.
  CS_store.poll = setInterval(() => CS_scheduleReload(0), 5 * 60000);
}

async function CS_rpc(name, args) {
  const supabase = window.mgbSupabase;
  if (!supabase) throw new Error("Failed to fetch");
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  CS_scheduleReload(0);
  return data;
}

const CS_actions = {
  request: (clientId, reason, days) =>
    CS_rpc("request_client_access", {
      p_client_id: clientId,
      p_reason: reason,
      p_days: days,
    }),
  decide: (id, approve) =>
    CS_rpc("decide_client_access", { p_id: id, p_approve: approve }),
  end: (id) => CS_rpc("end_client_access", { p_id: id }),
};

// Subscribe to the store. `selectKey` returns a primitive; the component only
// re-renders when it changes (App uses this so the 30s tick doesn't re-render
// the whole app). Without it, every emit re-renders.
function CS_useStore(selectKey) {
  const selRef = useRef(selectKey);
  selRef.current = selectKey;
  const lastRef = useRef(null);
  lastRef.current = selectKey ? selectKey() : CS_store.version;
  const [, force] = useState(0);
  useEffect(() => {
    const onChange = () => {
      const k = selRef.current ? selRef.current() : CS_store.version;
      if (k !== lastRef.current) {
        lastRef.current = k;
        force((n) => n + 1);
      }
    };
    CS_store.listeners.add(onChange);
    return () => CS_store.listeners.delete(onChange);
  }, []);
}

// Everything the UI needs, derived fresh on each render.
function CS_useAccessGrants() {
  CS_useStore();
  const now = Date.now();
  const me = CS_lc(CS_store.email);
  const myLiveByClient = {};
  const myPendingByClient = {};
  const toApprove = [];
  const activeTemp = [];
  CS_store.grants.forEach((g) => {
    const mine = CS_lc(g.staff_email) === me;
    if (g.status === "pending") {
      if (mine) myPendingByClient[g.client_id] = g;
      // RLS only returns other people's rows for clients this person can
      // approve, so anything not ours here is ours to decide.
      else toApprove.push(g);
    } else if (CS_isLive(g, now)) {
      if (mine) myLiveByClient[g.client_id] = g;
      else activeTemp.push(g);
    }
  });
  return {
    status: CS_store.status,
    error: CS_store.error,
    now,
    myLiveByClient,
    myPendingByClient,
    toApprove,
    activeTemp,
  };
}

// App: starts the store for the signed-in staffer and returns the client ids
// `viewer` (the impersonated staffer while "View as" is on) can reach through
// a live grant. Stable Set identity until that list actually changes.
function CS_useLiveGrantClientIds(sessionUser, viewer) {
  const sessionEmail = sessionUser && sessionUser.email;
  useEffect(() => {
    if (!sessionEmail) {
      if (CS_store.email) CS_stopGrants();
      return;
    }
    CS_startGrants(sessionEmail);
    return () => {
      if (CS_store.email === sessionEmail) CS_stopGrants();
    };
  }, [sessionEmail]);
  const viewerEmail = viewer && viewer.email;
  const keyFn = () =>
    CS_liveIdsFor(viewerEmail).join(",") + "|" + CS_store.dataRev;
  CS_useStore(keyFn);
  const key = keyFn();
  return useMemo(() => new Set(CS_liveIdsFor(viewerEmail)), [key]);
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
function CS_initials(name) {
  return String(name || "?")
    .replace(/[^A-Za-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0].toUpperCase())
    .slice(0, 2)
    .join("") || "?";
}

function CS_timeLeft(expiresAt, now, long) {
  const ms = new Date(expiresAt).getTime() - (now || Date.now());
  if (!(ms > 0)) return long ? "expired" : "ended";
  const mins = Math.ceil(ms / 60000);
  const hours = ms / 3600000;
  let n;
  let unit;
  if (hours < 1) {
    n = mins;
    unit = "minute";
  } else if (hours < 36) {
    n = Math.ceil(hours);
    unit = "hour";
  } else {
    n = Math.round(hours / 24);
    unit = "day";
  }
  if (long) return `expires in ${n} ${unit}${n === 1 ? "" : "s"}`;
  return `${n}${unit[0]} left`;
}

function CS_ago(iso, now) {
  const ms = (now || Date.now()) - new Date(iso).getTime();
  if (!(ms >= 0) || ms < 60000) return "just now";
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function CS_durationLabel(days) {
  const d = CS_DURATIONS.find((x) => x.days === days);
  return d ? d.label : `${days} days`;
}

function CS_clientName(id) {
  const c = (window.CLIENTS || []).find((x) => x.id === id);
  return c ? c.name : id;
}

// Recents live in localStorage per staffer; storage can be blocked
// (private mode, cleared site data), so every access is guarded.
function CS_readRecent(key) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch (e) {
    return [];
  }
}

function CS_pushRecent(key, id) {
  const next = [id, ...CS_readRecent(key).filter((x) => x !== id)].slice(
    0,
    CS_RECENT_MAX + 1, // +1 so the current client can be skipped in the list
  );
  try {
    localStorage.setItem(key, JSON.stringify(next));
  } catch (e) {}
  return next;
}

// Modals render into <body>: the phone drawer is transformed off-canvas, and
// a transformed ancestor would trap a position:fixed overlay inside it.
function CS_Portal({ children }) {
  return ReactDOM.createPortal(children, document.body);
}

// ---------------------------------------------------------------------------
// Client switcher
// ---------------------------------------------------------------------------
function CS_ClientSwitcher({
  clients, // clients this person can open (App's visibleClients)
  currentClient, // null on staff pages
  onPick,
  staffUser, // the effective staffer (impersonated one during "View as")
  statusOverrides,
  pendingRequestsByClient,
  compact, // collapsed desktop sidebar: tile only
  inline, // phone drawer: the list renders in the flow, full width
  onExpand,
  canRequest = true,
}) {
  const access = CS_useAccessGrants();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [requestFor, setRequestFor] = useState(null);
  const [actionError, setActionError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const listId = useMemo(
    () => "cs-list-" + Math.random().toString(36).slice(2, 8),
    [],
  );
  const today = todayLocal();
  const isAdmin = !!staffUser && staffUser.role === "admin";
  const recentKey = CS_RECENT_KEY + ":" + CS_lc(staffUser && staffUser.email);
  const [recentIds, setRecentIds] = useState(() => CS_readRecent(recentKey));

  const currentId = currentClient ? currentClient.id : null;
  useEffect(() => {
    if (currentId) setRecentIds(CS_pushRecent(recentKey, currentId));
  }, [currentId, recentKey]);

  const close = (refocus) => {
    setOpen(false);
    setQuery("");
    setActionError("");
    if (refocus && triggerRef.current) triggerRef.current.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) close(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown, { passive: true });
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [open]);

  // Opening from the collapsed tile expands the sidebar first, which swaps
  // this component out of compact mode; focus the search once it's there.
  // Skipped in the phone drawer, where focusing pops the keyboard over the list.
  useEffect(() => {
    if (open && !compact && !inline && inputRef.current) inputRef.current.focus();
  }, [open, compact, inline]);

  const accessibleIds = useMemo(
    () => new Set((clients || []).map((c) => c.id)),
    [clients],
  );
  // Roster-only orgs can arrive without a name; never let one crash the list.
  const nameOf = (c) => String(c.name || c.id || "");
  const byName = (a, b) => nameOf(a).localeCompare(nameOf(b));
  const q = query.trim().toLowerCase();
  const matches = (c) => !q || nameOf(c).toLowerCase().includes(q);
  const accessible = (clients || []).filter(matches).sort(byName);
  // The roster is readable by all staff, so the locked list comes straight
  // from CLIENTS. Admins can open everything and never see it.
  const locked = isAdmin
    ? []
    : (window.CLIENTS || [])
        .filter((c) => !c.testOnly && !accessibleIds.has(c.id) && matches(c))
        .sort(byName);
  // With only a handful of clients, "Recent" would just repeat the list.
  const recent = q || (clients || []).length <= CS_RECENT_MAX
    ? []
    : recentIds
        .filter((id) => id !== currentId)
        .map((id) => (clients || []).find((c) => c.id === id))
        .filter(Boolean)
        .slice(0, CS_RECENT_MAX);

  const sections = [
    { key: "recent", label: "Recent", items: recent, locked: false },
    {
      key: "all",
      label: isAdmin ? "All clients" : "Your clients",
      items: accessible,
      locked: false,
    },
    { key: "other", label: "Other clients", items: locked, locked: true },
  ];
  const flat = [];
  sections.forEach((s) =>
    s.items.forEach((c) => flat.push({ c, locked: s.locked, section: s.key })),
  );

  useEffect(() => {
    setActive(0);
  }, [q, open]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-idx="${active}"]`);
    if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const pick = (c) => {
    setRecentIds(CS_pushRecent(recentKey, c.id));
    close(false);
    onPick(c.id);
  };

  const openRequest = (c) => {
    close(false);
    setRequestFor(c);
  };

  const activate = (item) => {
    if (!item) return;
    if (!item.locked) return pick(item.c);
    if (canRequest && !access.myPendingByClient[item.c.id]) openRequest(item.c);
  };

  const cancelPending = async (g) => {
    setBusyId(g.id);
    setActionError("");
    try {
      await CS_actions.end(g.id);
    } catch (err) {
      setActionError(CS_friendlyError(err));
    } finally {
      setBusyId(null);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (flat.length) setActive((i) => (i + 1) % flat.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (flat.length) setActive((i) => (i - 1 + flat.length) % flat.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      activate(flat[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    }
  };

  const currentTemp = currentId ? access.myLiveByClient[currentId] : null;
  const currentHealth = currentClient
    ? effectiveClientHealth(currentClient, today, statusOverrides)
    : null;
  const plan = currentClient
    ? currentClient.plan === "basic" || currentClient.plan === "premium"
      ? currentClient.plan
      : "standard"
    : null;
  const triggerLabel = currentClient
    ? `Viewing ${currentClient.name}. Switch client`
    : "Choose a client";

  const renderRow = (item, idx) => {
    const { c } = item;
    const isActive = idx === active;
    const isCurrent = c.id === currentId;
    const pending = item.locked ? access.myPendingByClient[c.id] : null;
    const temp = !item.locked ? access.myLiveByClient[c.id] : null;
    const portalRequests =
      (!item.locked && pendingRequestsByClient && pendingRequestsByClient[c.id]) || 0;
    return (
      <div
        key={item.section + ":" + c.id}
        id={`${listId}-${idx}`}
        data-idx={idx}
        role="option"
        aria-selected={isActive}
        aria-current={isCurrent ? "true" : undefined}
        className={
          "cs-row" +
          (isActive ? " active" : "") +
          (item.locked ? " locked" : "") +
          (isCurrent ? " current" : "")
        }
        onMouseEnter={() => setActive(idx)}
        onClick={() => activate(item)}
      >
        {item.locked ? (
          <span className="cs-row-icon" aria-hidden="true">
            <LockIcon width="13" height="13" />
          </span>
        ) : (
          <span className="cs-row-icon">
            <ClientHealthDot
              health={effectiveClientHealth(c, today, statusOverrides)}
            />
          </span>
        )}
        <span className="cs-row-name">{nameOf(c)}</span>
        {temp && (
          <span className="cs-tag cs-tag-temp">
            Temporary · {CS_timeLeft(temp.expires_at, access.now)}
          </span>
        )}
        {portalRequests > 0 && (
          <span
            className="cs-tag cs-tag-count"
            title={`${portalRequests} portal access request${portalRequests === 1 ? "" : "s"} to review`}
            aria-label={`${portalRequests} portal access request${portalRequests === 1 ? "" : "s"} to review`}
          >
            {portalRequests}
          </span>
        )}
        {pending && (
          <>
            <span className="cs-tag cs-tag-pending">Pending</span>
            <button
              type="button"
              className="cs-row-action"
              disabled={busyId === pending.id}
              onClick={(e) => {
                e.stopPropagation();
                cancelPending(pending);
              }}
            >
              {busyId === pending.id ? "Cancelling…" : "Cancel"}
            </button>
          </>
        )}
        {item.locked && !pending && canRequest && (
          <span className="cs-row-action" aria-hidden="true">
            Request access
          </span>
        )}
      </div>
    );
  };

  let idx = -1;
  return (
    <div
      ref={rootRef}
      className={
        "cs-switcher" + (compact ? " compact" : "") + (inline ? " inline" : "")
      }
    >
      {compact ? (
        <button
          ref={triggerRef}
          type="button"
          className="cs-trigger cs-trigger-compact"
          aria-label={triggerLabel}
          title={currentClient ? currentClient.name : "Choose a client"}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => {
            setOpen(true);
            if (onExpand) onExpand();
          }}
        >
          {currentClient ? (
            <span className="cs-tile">{CS_initials(currentClient.name)}</span>
          ) : (
            <SearchIcon />
          )}
        </button>
      ) : (
        <button
          ref={triggerRef}
          type="button"
          className={"cs-trigger" + (open ? " open" : "")}
          aria-label={triggerLabel}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => (open ? close(false) : setOpen(true))}
        >
          <span className={"cs-tile" + (currentClient ? "" : " empty")}>
            {currentClient ? CS_initials(currentClient.name) : <SearchIcon />}
          </span>
          <span className="cs-trigger-text">
            <span className="cs-trigger-name">
              {currentClient ? currentClient.name : "Choose a client"}
            </span>
            <span className="cs-trigger-sub">
              {currentClient ? (
                currentTemp ? (
                  <span className="cs-sub-temp">
                    Temporary · {CS_timeLeft(currentTemp.expires_at, access.now)}
                  </span>
                ) : (
                  <>
                    <ClientHealthDot
                      health={currentHealth}
                      style={{ width: 7, height: 7 }}
                    />
                    <span className="cs-sub-text">
                      {planLabel(plan)} ·{" "}
                      {CLIENT_HEALTH_LABEL[currentHealth.status] || "No status"}
                    </span>
                  </>
                )
              ) : (
                <span className="cs-sub-text">
                  {(clients || []).length} client
                  {(clients || []).length === 1 ? "" : "s"}
                </span>
              )}
            </span>
          </span>
          <ChevronDownIcon className={"cs-chev" + (open ? " open" : "")} />
        </button>
      )}

      {open && !compact && (
        <div className="cs-popover">
          <div className="cs-search">
            <SearchIcon />
            <input
              ref={inputRef}
              type="text"
              className="cs-search-input"
              placeholder="Search clients"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={
                flat.length ? `${listId}-${active}` : undefined
              }
              aria-label="Search clients"
            />
          </div>
          <div className="cs-list" id={listId} role="listbox" ref={listRef}>
            {sections.map((s) =>
              s.items.length === 0 ? null : (
                <div key={s.key} role="group" aria-label={s.label}>
                  <div className="cs-section-label">{s.label}</div>
                  {s.items.map((c) => {
                    idx += 1;
                    return renderRow(
                      { c, locked: s.locked, section: s.key },
                      idx,
                    );
                  })}
                </div>
              ),
            )}
            {flat.length === 0 && (
              <div className="cs-empty">
                {q ? `No clients match "${query.trim()}".` : "No clients yet."}
              </div>
            )}
          </div>
          {actionError && (
            <div className="cs-error" role="alert">
              {actionError}
            </div>
          )}
        </div>
      )}

      {requestFor && (
        <CS_RequestAccessModal
          client={requestFor}
          onClose={() => setRequestFor(null)}
        />
      )}
    </div>
  );
}

// App's "no clients assigned yet" screen: the switcher on a navy panel, so a
// bookkeeper with nothing assigned can still ask for temporary access.
function CS_SplashRequestAccess({ staffUser }) {
  return (
    <div className="cs-splash-switcher">
      <div className="cs-splash-hint">Need to work on a client now?</div>
      <CS_ClientSwitcher
        clients={[]}
        currentClient={null}
        onPick={() => {}}
        staffUser={staffUser}
        inline
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Request access modal
// ---------------------------------------------------------------------------
function CS_RequestAccessModal({ client, onClose }) {
  const [reason, setReason] = useState("");
  const [days, setDays] = useState(7);
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const trimmed = reason.trim();
  const reasonError = !trimmed
    ? "Add a reason so the approver knows why you need access."
    : reason.length > CS_REASON_MAX
      ? `Keep it to ${CS_REASON_MAX} characters or fewer.`
      : "";

  const submit = async () => {
    setTouched(true);
    if (reasonError || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      await CS_actions.request(client.id, trimmed, days);
      setSent(true);
    } catch (err) {
      setError(CS_friendlyError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <CS_Portal>
      <ModalShell
        onClose={onClose}
        labelledBy="cs-request-title"
        className="cs-request-modal"
      >
        <div className="modal-header">
          <h3 className="card-title" id="cs-request-title" style={{ margin: 0 }}>
            {sent ? "Request sent" : `Request access to ${client.name}`}
          </h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {sent ? (
          <>
            <div className="modal-body">
              <p className="card-subtitle" style={{ margin: 0 }} role="status">
                Request sent. You'll get access once an admin or {client.name}'s
                bookkeeper approves it.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn-primary" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="modal-body">
              <p className="card-subtitle" style={{ margin: "0 0 14px" }}>
                An admin or the client's bookkeeper will review it. Access ends
                on its own when the time is up.
              </p>
              <label className="cs-field-label" htmlFor="cs-request-reason">
                Why do you need access?
              </label>
              <textarea
                id="cs-request-reason"
                className={
                  "client-note-textarea cs-reason" +
                  (touched && reasonError ? " invalid" : "")
                }
                rows={4}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                // Not on an untouched blur: ModalShell moves focus to the
                // close button on open, which would flag an empty field
                // before anyone typed.
                onBlur={() => reason && setTouched(true)}
                placeholder="For example: covering month-end close while their bookkeeper is out."
                aria-invalid={touched && !!reasonError}
                aria-describedby="cs-request-reason-help"
                autoFocus
              />
              <div className="cs-field-help" id="cs-request-reason-help">
                <span className={touched && reasonError ? "cs-field-error" : ""}>
                  {touched && reasonError ? reasonError : "Required"}
                </span>
                <span
                  className={
                    "cs-count-chars" +
                    (reason.length > CS_REASON_MAX ? " over" : "")
                  }
                >
                  {reason.length}/{CS_REASON_MAX}
                </span>
              </div>

              <div className="cs-field-label" id="cs-duration-label">
                How long
              </div>
              <div
                className="view-toggle cs-duration"
                role="radiogroup"
                aria-labelledby="cs-duration-label"
              >
                {CS_DURATIONS.map((d) => (
                  <button
                    key={d.days}
                    type="button"
                    role="radio"
                    aria-checked={days === d.days}
                    className={
                      "view-toggle-btn" + (days === d.days ? " active" : "")
                    }
                    onClick={() => setDays(d.days)}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
              {error && (
                <p className="cs-form-error" role="alert">
                  {error}
                </p>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={onClose}>
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={submit}
                disabled={submitting}
              >
                {submitting ? "Sending…" : "Send request"}
              </button>
            </div>
          </>
        )}
      </ModalShell>
    </CS_Portal>
  );
}

// ---------------------------------------------------------------------------
// Staff Home: approvals card
// ---------------------------------------------------------------------------
function CS_AccessRequestsCard() {
  const access = CS_useAccessGrants();
  const showToast = useToast();
  const [busy, setBusy] = useState(null); // grant id
  const [error, setError] = useState("");
  const [revoking, setRevoking] = useState(null); // grant

  // Hidden entirely until there's something to act on (and when the grants
  // couldn't load, e.g. signed out locally).
  if (access.status !== "ready") return null;
  const { toApprove, activeTemp, now } = access;
  if (toApprove.length === 0 && activeTemp.length === 0) return null;

  const run = async (g, fn, done) => {
    setBusy(g.id);
    setError("");
    try {
      await fn();
      if (showToast) showToast(done);
    } catch (err) {
      setError(CS_friendlyError(err));
    } finally {
      setBusy(null);
    }
  };
  const who = (g) => g.staff_name || g.staff_email;

  return (
    <div className="card cs-approvals" style={{ marginBottom: 20 }}>
      <h3 className="card-title">
        Client access requests
        {toApprove.length > 0 && (
          <span className="cs-card-count">{toApprove.length}</span>
        )}
      </h3>
      <p className="card-subtitle">
        Teammates asking to work on a client you look after. Access ends on its
        own when the time is up.
      </p>
      {toApprove.length > 0 && (
        <ul className="cs-req-list">
          {toApprove.map((g) => (
            <li className="cs-req-row" key={g.id}>
              <div className="cs-req-main">
                <div className="cs-req-head">
                  <strong>{who(g)}</strong> wants{" "}
                  <strong>{CS_clientName(g.client_id)}</strong> for{" "}
                  {CS_durationLabel(g.duration_days)}
                </div>
                <div className="cs-req-reason">{g.reason}</div>
                <div className="cs-req-meta">
                  Requested {CS_ago(g.requested_at, now)}
                </div>
              </div>
              <div className="cs-req-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={busy === g.id}
                  onClick={() =>
                    run(g, () => CS_actions.decide(g.id, false), "Request denied")
                  }
                >
                  Deny
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={busy === g.id}
                  onClick={() =>
                    run(
                      g,
                      () => CS_actions.decide(g.id, true),
                      `${who(g)} now has access to ${CS_clientName(g.client_id)}`,
                    )
                  }
                >
                  Approve
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {activeTemp.length > 0 && (
        <>
          <div className="cs-card-heading">Active temporary access</div>
          <ul className="cs-req-list">
            {activeTemp.map((g) => (
              <li className="cs-req-row" key={g.id}>
                <div className="cs-req-main">
                  <div className="cs-req-head">
                    <strong>{who(g)}</strong> on{" "}
                    <strong>{CS_clientName(g.client_id)}</strong>
                  </div>
                  <div className="cs-req-meta">
                    {CS_timeLeft(g.expires_at, now, true)}
                  </div>
                </div>
                <div className="cs-req-actions">
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={busy === g.id}
                    onClick={() => setRevoking(g)}
                  >
                    Revoke
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      {error && (
        <p className="card-subtitle negative" role="alert">
          {error}
        </p>
      )}
      {revoking && (
        <CS_Portal>
          <ConfirmModal
            title="Revoke access?"
            body={`${who(revoking)} will lose access to ${CS_clientName(revoking.client_id)} right away.`}
            confirmLabel="Revoke"
            onCancel={() => setRevoking(null)}
            onConfirm={() => {
              const g = revoking;
              setRevoking(null);
              run(g, () => CS_actions.end(g.id), "Access revoked");
            }}
          />
        </CS_Portal>
      )}
    </div>
  );
}

// Subtle dot on the Home link while there's something to approve.
function CS_ApprovalsDot({ className = "nav-badge-dot" }) {
  const { toApprove } = CS_useAccessGrants();
  const n = toApprove.length;
  if (!n) return null;
  const label = `${n} client access request${n === 1 ? "" : "s"} to review`;
  return <span className={className} aria-label={label} title={label} />;
}

// ---------------------------------------------------------------------------
// Requester: note on a client page opened through a live grant
// ---------------------------------------------------------------------------
function CS_TempAccessNote({ clientId, clientName }) {
  const access = CS_useAccessGrants();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const grant = clientId ? access.myLiveByClient[clientId] : null;
  if (!grant) return null;

  const giveUp = async () => {
    setConfirming(false);
    setBusy(true);
    setError("");
    try {
      // App drops the client from visibleClients on the next reload, which
      // bounces the page to one this person can still see.
      await CS_actions.end(grant.id);
    } catch (err) {
      setError(CS_friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cs-temp-note" role="status">
      <LockIcon width="14" height="14" />
      <span className="cs-temp-note-text">
        Temporary access · {CS_timeLeft(grant.expires_at, access.now, true)}
        {error && <span className="cs-temp-note-error"> {error}</span>}
      </span>
      <button
        type="button"
        className="cs-temp-note-btn"
        disabled={busy}
        onClick={() => setConfirming(true)}
      >
        {busy ? "Giving up…" : "Give up access"}
      </button>
      {confirming && (
        <CS_Portal>
          <ConfirmModal
            title="Give up access?"
            body={`You'll lose access to ${clientName} right away. You can request it again later.`}
            confirmLabel="Give up access"
            onCancel={() => setConfirming(false)}
            onConfirm={giveUp}
          />
        </CS_Portal>
      )}
    </div>
  );
}
