// components/staff/ClientsPage.jsx — the staff Clients place, and the frame a
// client's pages sit in for staff (breadcrumb, tab row, "View as client").
//
// Staff navigation redesign (owner approved 2026-10-08). Prefix: CL_.
//
//   CL_ClientsPage   #/clients. One row per client the viewer can see: health,
//                    who covers it, hours this month, the month being closed
//                    and when you last opened it. Mine / All / Needs attention
//                    plus a search box. Takes over from the Team page's
//                    Client health grid (HLB_HealthTab, retired) as the place
//                    to scan the whole list.
//   CL_Breadcrumb    "Clients › {client} › {tab}" above a client's pages.
//   CL_ClientTabs    The client's tab row for staff (NAV_TabRow): the same
//                    row on every plan (STAFF_CLIENT_TABS, app.jsx) with
//                    badges, the Client view menu and the Client setup gear.
//                    At desktop width staff don't get the client sidebar
//                    (clients-page.css, html.staff-client-tabs).
//   CL_ClientViewMenu "Client view": the client's own pages, then "View as
//                    client…" (in-client tabs redesign 2026-10-10).
//   CL_ViewAsButton  "View as client": preview the portal as one of the
//                    client's people (no longer mounted by App's header).
//
// Data comes from the hooks the client overview and Today already use —
// HL_useHealth (ClientHealth.jsx), HLB_useDirectory (HealthBoard.jsx),
// HB_useBudgets (HoursBudget.jsx), CT_useCloseStatus (CloseTracker.jsx),
// SF_useSopStatus (SopFreshness.jsx) — so a score or an hours figure here
// matches the one on the client's own pages. Loaded before app.jsx and shares
// its global scope: app.jsx globals (planLabel, NAV_SECTIONS, loadClientVisits,
// icons) are only touched at render time, and optional modules are guarded
// with typeof.

const CL_FILTERS = [
  { key: "mine", label: "Mine" },
  { key: "all", label: "All" },
  { key: "attention", label: "Needs attention" },
];

const CL_lower = (s) => String(s || "").toLowerCase();

// No page: the bare #/client/<id>, which App opens by the landing rule (the
// tab last open for that client this session, else Overview). Pass a page
// ("overview", "close") to name one.
function CL_clientHref(id, page) {
  return "#/client/" + encodeURIComponent(id) + (page ? "/" + page : "");
}

// Tab label for a client page key (breadcrumb, tab row).
function CL_pageLabel(page) {
  if (!page || page === "client-overview") return "Overview";
  if (page === "sop") return "SOP";
  if (page === "milestone") return "Milestone";
  if (page === "client-close") return "Close";
  if (page === "client-settings") return "Client setup";
  if (page === "enterprise-upgrade") return "Plans";
  const byKey = typeof NAV_LABEL_BY_KEY !== "undefined" ? NAV_LABEL_BY_KEY : {};
  return byKey[page] || page;
}

// "Today", "Yesterday", "3 days ago", then "Sep 12" — for Last viewed.
function CL_ago(ts, now) {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "";
  const n = now || new Date();
  const dayStart = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((dayStart(n) - dayStart(d)) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 14) return days + " days ago";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// A client is yours when you're its bookkeeper, its backup, or an admin gave
// you access to it (staff_client_access). Matched by email only: staff can
// rename themselves, so a name match could claim someone else's client.
function CL_isMine(c, me, backupEmail, grantedIds) {
  if (!me || !me.email) return false;
  const email = CL_lower(me.email);
  const bk = c.assignedBookkeeper || {};
  if (bk.email && CL_lower(bk.email) === email) return true;
  if (backupEmail && CL_lower(backupEmail) === email) return true;
  return !!(grantedIds && grantedIds.has(c.id));
}

// ---- Cells

// Score and band from client_health(); the app's own signal dot while the
// score is loading, when the RPC isn't there, or when someone set a manual
// status override (that stays the human's call — same rule as HL_Dot).
function CL_HealthCell({ h, fallback, hlStatus }) {
  if (h && !(fallback && fallback.isOverride)) {
    const tip = typeof HL_tooltip === "function" ? HL_tooltip(h) : "";
    return (
      <span className={"cl-health hl-" + h.band} title={tip}>
        <span className="hl-dot" style={{ background: HL_COLOR[h.band] || "var(--text-muted)" }} aria-hidden="true" />
        <strong className="cl-score">{h.score}</strong>
        <span className="cl-band">{HL_LABEL[h.band] || h.band}</span>
      </span>
    );
  }
  if (fallback && typeof ClientHealthDot === "function" && (fallback.isOverride || hlStatus === "missing" || hlStatus === "error" || hlStatus === "ready")) {
    return (
      <span className="cl-health">
        <ClientHealthDot health={fallback} />
        <span className="cl-band">{(typeof CLIENT_HEALTH_LABEL !== "undefined" && CLIENT_HEALTH_LABEL[fallback.status]) || ""}</span>
      </span>
    );
  }
  return <span className="muted">…</span>;
}

// Hours this month against the budget. data from HB_useBudgets.
function CL_HoursCell({ data, clientId }) {
  if (!data) return <span className="muted">…</span>;
  const budget = data.budgets[clientId];
  const mins = data.minutes[clientId];
  if (budget == null) {
    return data.qboOn && mins > 0 ? (
      <span className="cl-hours">
        {HB_fmtH(mins / 60)} <span className="muted">· no budget</span>
      </span>
    ) : (
      <span className="muted">No budget</span>
    );
  }
  if (!data.qboOn) {
    return (
      <span className="cl-hours muted" title="QuickBooks Time isn't connected, so hours used are unknown">
        — / {HB_fmtH(budget)}
      </span>
    );
  }
  const st = data.byClient[clientId] || OPS_budgetStatus(mins || 0, budget);
  if (!st) return <span className="muted">No budget</span>;
  const note = st.state === "over" ? "Over budget" : st.state === "near" ? "80% or more of the budget used" : st.pct + "% of the budget used";
  return (
    <span className={"cl-hours hb-" + st.state} title={note}>
      <span className="hb-text">
        {HB_fmtH(st.used)} / {HB_fmtH(st.budget)}
        {st.state === "over" && <span className="hb-tag">Over</span>}
      </span>
      <span className="hb-track" aria-hidden="true">
        <span style={{ width: Math.min(100, st.pct) + "%" }} />
      </span>
    </span>
  );
}

// The month being closed and where it stands. cl from CT_useCloseStatus.byClient.
function CL_CloseCell({ cl, loading, client }) {
  if (!cl) return <span className="muted">{loading ? "…" : "—"}</span>;
  const label = CT_STATUS_LABEL[cl.status] || cl.status;
  const tone = cl.late ? "bad" : cl.status === "done" ? "good" : cl.status === "in_progress" || cl.status === "review" ? "warm" : "neutral";
  const body = (
    <>
      <span className="cl-close-month">{CT_monthLabel(cl.period)}</span>
      <span className={"pill " + tone}>{cl.late ? label + " · late" : label}</span>
    </>
  );
  // Opens the client's Close tab (explicit page, not the bare landing hash).
  if (client && client.id) {
    return (
      <a className="cl-close cl-close-link" href={CL_clientHref(client.id, "close")} title={"Open " + (client.name || client.id) + "'s close"}>
        {body}
      </a>
    );
  }
  return <span className="cl-close">{body}</span>;
}

function CL_Row({ r, hours, closeLoading, hlStatus, onOpen, isRealAdmin }) {
  const c = r.c;
  const open = (page) => onOpen && onOpen(c.id, page);
  const onRowClick = (e) => {
    // Inner controls (the name link, the onboarding badge) handle their own
    // clicks; anywhere else on the row opens the client.
    if (e.target.closest && e.target.closest("a, button, [role='button'], input")) return;
    open();
  };
  const plan = typeof planLabel === "function" ? planLabel(c.plan) : c.plan;
  return (
    <tr className={"cl-row" + (r.reasons.length ? " cl-row-attention" : "")} onClick={onRowClick}>
      <td data-primary="" className="cl-cell-client">
        <div className="cl-client">
          <a
            className="cl-name"
            href={CL_clientHref(c.id)}
            onClick={(e) => {
              if (!onOpen) return;
              e.preventDefault();
              open();
            }}
          >
            {c.name || c.id}
          </a>
          {plan && <span className="pill neutral cl-tag">{plan}</span>}
          {c.testOnly && (
            <span className="pill warm cl-tag" title="A test client: sample numbers, not a real organization">
              Test
            </span>
          )}
          {/* Onboarding is admin work (D20): real admins only. */}
          {isRealAdmin && (
            <OB_OnboardingBadge clientId={c.id} onOpen={() => open("client-overview")} />
          )}
          {r.requests > 0 && (
            <span
              className="cl-requests"
              title={`${r.requests} portal access request${r.requests === 1 ? "" : "s"} to review`}
              aria-label={`${r.requests} portal access request${r.requests === 1 ? "" : "s"} to review`}
            >
              {r.requests}
            </span>
          )}
        </div>
        {r.reasons.length > 0 && <div className="cl-why">{r.reasons.join(" · ")}</div>}
      </td>
      <td data-label="Health">
        <CL_HealthCell h={r.h} fallback={r.fallback} hlStatus={hlStatus} />
      </td>
      <td data-label="Assigned to">
        {r.assigneeName ? (
          <span className="cl-person">
            {r.assigneeName}
            {typeof CV_OutTag === "function" && r.assigneeEmail && <CV_OutTag email={r.assigneeEmail} />}
          </span>
        ) : (
          <span className="muted">Unassigned</span>
        )}
      </td>
      <td data-label="Backup">
        {r.backupEmail ? (
          <span className="cl-person">
            {typeof CV_BackupName === "function" ? <CV_BackupName email={r.backupEmail} /> : r.backupEmail}
            {typeof CV_OutTag === "function" && <CV_OutTag email={r.backupEmail} />}
          </span>
        ) : (
          <span className="muted">Not set</span>
        )}
      </td>
      <td data-label="Hours this month">
        <CL_HoursCell data={hours} clientId={c.id} />
      </td>
      <td data-label="Close">
        <CL_CloseCell cl={r.cl} loading={closeLoading} client={c} />
      </td>
      <td data-label="Last viewed">{r.lastViewed ? CL_ago(r.lastViewed) : <span className="muted">Not yet</span>}</td>
    </tr>
  );
}

// ---- The page

// clients: App's visibleClients. onOpenClient(clientId, page?) opens the
// client (page defaults to its overview).
function CL_ClientsPage({ clients, staffUser, isAdmin, statusOverrides, pendingRequestsByClient, onOpenClient }) {
  const list = clients || [];
  const today = typeof todayLocal === "function" ? todayLocal() : new Date().toISOString().slice(0, 10);
  const health = HL_useHealth();
  const dir = HLB_useDirectory();
  const hours = HB_useBudgets(true, !!isAdmin);
  const close = CT_useCloseStatus(list, staffUser);
  const sops = typeof SF_useSopStatus === "function" ? SF_useSopStatus(true) : null;
  // A personal, per-browser record (recordClientVisit); read once per visit.
  const visits = useMemo(() => (typeof loadClientVisits === "function" ? loadClientVisits() : {}), []);
  const pending = pendingRequestsByClient || {};
  const [filter, setFilter] = useState(null); // null until the viewer picks
  const [q, setQ] = useState("");

  const rows = list.map((c) => {
    const d = dir.clients[c.id];
    const bk = c.assignedBookkeeper || {};
    const assigneeEmail = CL_lower(bk.email || (d && d.assignee) || "");
    const assigneeName = bk.name || (assigneeEmail ? dir.staff[assigneeEmail] || assigneeEmail.split("@")[0] : "");
    const backupEmail = (d && d.backup) || "";
    const h = health.byId[c.id];
    const fallback = typeof effectiveClientHealth === "function" ? effectiveClientHealth(c, today, statusOverrides) : null;
    const atRisk = h && !(fallback && fallback.isOverride) ? h.band === "red" : !!(fallback && fallback.status === "red");
    const cl = close.byClient[c.id];
    const requests = Number(pending[c.id] || 0);
    const sopStale = typeof SF_ruleState === "function" && SF_ruleState(sops, c.id) === "stale";
    const reasons = [];
    if (atRisk) reasons.push("Health at risk");
    if (cl && cl.late) reasons.push("Close late");
    if (requests > 0) reasons.push(requests === 1 ? "1 access request" : requests + " access requests");
    if (sopStale) reasons.push("SOP stale");
    return {
      c,
      assigneeEmail,
      assigneeName,
      backupEmail,
      h,
      fallback,
      cl,
      requests,
      reasons,
      mine: CL_isMine(c, staffUser, backupEmail, close.myClientIds),
      lastViewed: visits[c.id],
    };
  });

  const counts = {
    mine: rows.filter((r) => r.mine).length,
    all: rows.length,
    attention: rows.filter((r) => r.reasons.length > 0).length,
  };
  // Mine by default when anything is yours; the viewer's own pick sticks.
  const active = filter || (counts.mine > 0 ? "mine" : "all");
  const needle = q.trim().toLowerCase();
  const shown = rows
    .filter((r) => (active === "mine" ? r.mine : active === "attention" ? r.reasons.length > 0 : true))
    .filter((r) => !needle || CL_lower(r.c.name).includes(needle) || CL_lower(r.c.id).includes(needle) || CL_lower(r.assigneeName).includes(needle))
    .sort((a, b) => (b.reasons.length > 0) - (a.reasons.length > 0) || String(a.c.name || a.c.id).localeCompare(String(b.c.name || b.c.id)));

  const empty = !rows.length
    ? isAdmin
      ? "No clients yet. Add one from Team → Members, or wait for the roster to load."
      : "No clients are assigned to you yet. An admin can assign you from the client's settings."
    : needle
      ? `No clients match "${q.trim()}".`
      : active === "attention"
        ? "Nothing needs attention right now."
        : active === "mine"
          ? "Nothing is assigned to you. Switch to All to see every client."
          : "No clients to show.";

  return (
    <div className="cl-page">
      <div className="card cl-card">
        <div className="cl-toolbar">
          <div className="cl-seg" role="group" aria-label="Which clients to show" data-tour="clients-filters">
            {CL_FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                className={"cl-seg-btn" + (active === f.key ? " active" : "")}
                aria-pressed={active === f.key}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
                <span className="cl-seg-count" aria-label={counts[f.key] + (f.key === "attention" ? " clients need attention" : " clients")}>
                  {counts[f.key]}
                </span>
              </button>
            ))}
          </div>
          <label className="cl-search">
            {typeof SearchIcon === "function" && <SearchIcon className="cl-search-icon" aria-hidden="true" />}
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a client" aria-label="Find a client" />
          </label>
        </div>
        <div className="table-scroll" data-tour="clients-list">
          <table className="tx-table tx-table-labeled cl-table">
            <thead>
              <tr>
                <th scope="col">Client</th>
                <th scope="col" data-tour="clients-health">Health</th>
                <th scope="col">Assigned to</th>
                <th scope="col">Backup</th>
                <th scope="col">Hours this month</th>
                <th scope="col">Close</th>
                <th scope="col">Last viewed</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 ? (
                <EmptyRow colSpan={7}>{empty}</EmptyRow>
              ) : (
                shown.map((r) => <CL_Row key={r.c.id} r={r} hours={hours} closeLoading={close.loading} hlStatus={health.status} onOpen={onOpenClient} isRealAdmin={STAFF_isRealAdmin(staffUser)} />)
              )}
            </tbody>
          </table>
        </div>
        <p className="cl-foot muted">
          Showing {shown.length} of {rows.length}. Needs attention means health at risk, a late close, a portal access request waiting, or a
          stale SOP. Hours are QuickBooks Time this calendar month against the client's monthly budget.
          {health.status === "missing" && " Client health isn't set up yet (database step pending)."}
          {close.error && " " + close.error}
        </p>
      </div>
    </div>
  );
}

// ---- A client's pages: breadcrumb, tab row, View as

// Clients › {client} › {tab}. The first two are links (onOpenClients,
// onOpenOverview); the last is where you are.
function CL_Breadcrumb({ client, page, onOpenClients, onOpenOverview }) {
  if (!client) return null;
  const name = client.name || client.id;
  const go = (fn) => (e) => {
    if (typeof fn !== "function") return;
    e.preventDefault();
    fn();
  };
  return (
    <nav className="cl-crumbs" aria-label="Breadcrumb">
      <ol>
        <li>
          <a href="#/clients" onClick={go(onOpenClients)}>
            Clients
          </a>
        </li>
        <li className="cl-crumb-sep" aria-hidden="true">
          ›
        </li>
        <li>
          <a href={CL_clientHref(client.id, "overview")} onClick={go(onOpenOverview)}>
            {name}
          </a>
        </li>
        <li className="cl-crumb-sep" aria-hidden="true">
          ›
        </li>
        <li>
          <span className="cl-crumb-current" aria-current="page">
            {CL_pageLabel(page)}
          </span>
        </li>
      </ol>
    </nav>
  );
}

// "1 reply" / "2 replies": singular or plural noun after a count.
function CL_n(n, one, many) {
  return n + " " + (n === 1 ? one : many);
}

// Badge fields (NAV_TabRow badge, badgeTone, badgeDot, badgeLabel) for one
// row tab, from useClientTabCounts (ClientTabCounts.jsx). Copy: TABS-SPEC 1.3.
// Nothing before the counts load, and nothing while they're in error.
function CL_tabBadge(key, counts) {
  if (!counts || !counts.loaded || counts.error) return null;
  if (key === "messages") {
    const m = counts.messages || {};
    if (!m.count) return null;
    return {
      badge: m.count,
      badgeTone: m.overdue > 0 ? "bad" : null,
      badgeLabel:
        (m.count === 1 ? "1 reply waiting" : m.count + " replies waiting") +
        (m.overdue > 0 ? ", " + m.overdue + " waiting over a day" : ""),
    };
  }
  if (key === "documents") {
    const d = counts.documents || {};
    if (d.uploaded > 0)
      return {
        badge: d.uploaded,
        badgeTone: d.overdueOpen > 0 ? "warn" : null,
        badgeLabel:
          CL_n(d.uploaded, "upload", "uploads") +
          " to mark received" +
          (d.overdueOpen > 0 ? ", " + CL_n(d.overdueOpen, "request", "requests") + " overdue" : ""),
      };
    if (d.overdueOpen > 0)
      return { badge: 1, badgeDot: true, badgeTone: "warn", badgeLabel: CL_n(d.overdueOpen, "request", "requests") + " overdue" };
    return null;
  }
  if (key === "bank") {
    const b = counts.bank || {};
    if (!b.open) return null;
    return { badge: b.open, badgeLabel: CL_n(b.open, "open question", "open questions") };
  }
  if (key === "client-close") {
    const c = counts.close || {};
    if (!c.tone || !c.label) return null;
    return { badge: 1, badgeDot: true, badgeTone: c.tone, badgeLabel: c.label };
  }
  if (key === "sop") {
    const s = counts.sop || {};
    if (!s.stale) return null;
    return { badge: 1, badgeDot: true, badgeTone: "warn", badgeLabel: "SOP review due" };
  }
  return null;
}

// The client's tab row for staff (bookkeeper view, not previewing): the same
// fixed row on every plan (D1): Overview, Messages, Documents, Bank, Close,
// Reports, SOP, then Milestone for real admins, then the Client view menu and
// the Client setup gear at the far right. Tabs come from STAFF_CLIENT_TABS
// (app.jsx). Badges from `counts` (useClientTabCounts). Panel id
// "client-panel" (NAV_TabRow aria-controls) is the page content wrapper.
function CL_ClientTabs({ client, page, access, counts, isRealAdmin, onSelectPage, hasPendingAccessRequests, onOpenClientSettings, onPreviewAs }) {
  const rowTabs = STAFF_CLIENT_TABS;
  const tabs = rowTabs
    .filter((t) => !t.adminOnly || isRealAdmin)
    .map((t) => ({ key: t.key, label: t.label, tour: t.tour, ...(CL_tabBadge(t.key, counts) || {}) }));
  const current = tabs.some((t) => t.key === page) ? page : null;
  const onSettings = page === "client-settings";
  const settingsLabel = hasPendingAccessRequests ? "Client setup, new access request waiting" : "Client setup";
  const gear = (
    <button
      type="button"
      className={"cl-settings-btn" + (onSettings ? " active" : "") + (hasPendingAccessRequests ? " pending-alert" : "")}
      aria-pressed={onSettings}
      aria-label={settingsLabel}
      title={settingsLabel}
      data-tour="client-setup"
      onClick={() => onOpenClientSettings && onOpenClientSettings()}
    >
      {typeof ST_GearIcon === "function" && <ST_GearIcon width="16" height="16" />}
      <span className="cl-settings-label">Client setup</span>
      {hasPendingAccessRequests && <span className="cl-settings-dot" aria-hidden="true" />}
    </button>
  );
  const viewMenu = (
    <CL_ClientViewMenu client={client} page={page} access={access} counts={counts} onSelectPage={onSelectPage} onPreviewAs={onPreviewAs} />
  );
  // 761-1279px: an admin's eight tabs, the Client view menu and the gear
  // don't fit on one line, so the menu and gear move up to the page header
  // (#cl-header-tools, App in app.jsx) and the tabs get the full width.
  // Phones keep them in the row (it scrolls sideways); 1280px+ fits.
  const headerSlot = CL_useHeaderToolsSlot();
  const tabRow = (
    <NAV_TabRow
      label={((client && client.name) || "Client") + " pages"}
      tabs={tabs}
      current={current}
      onSelect={(key) => onSelectPage && onSelectPage(key)}
      idPrefix="client"
      className={"cl-tabs" + (headerSlot ? " cl-tabs-tools-up" : "")}
      after={headerSlot ? null : viewMenu}
      right={headerSlot ? null : gear}
    />
  );
  if (!headerSlot || typeof ReactDOM === "undefined") return tabRow;
  return (
    <>
      {tabRow}
      {ReactDOM.createPortal(
        <>
          {viewMenu}
          <div className="nav-tabs-right">{gear}</div>
        </>,
        headerSlot,
      )}
    </>
  );
}

// The header slot for the Client view menu and gear while the viewport is
// 761-1279px wide (CL_ClientTabs), or null. Layout effect so the row never
// paints with them in the wrong place first.
const CL_TOOLS_UP_QUERY = "(min-width: 761px) and (max-width: 1279px)";
function CL_useHeaderToolsSlot() {
  const [slot, setSlot] = useState(null);
  React.useLayoutEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const mq = window.matchMedia(CL_TOOLS_UP_QUERY);
    const sync = () => setSlot(mq.matches ? document.getElementById("cl-header-tools") : null);
    sync();
    if (mq.addEventListener) mq.addEventListener("change", sync);
    else if (mq.addListener) mq.addListener(sync);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener("change", sync);
      else if (mq.removeListener) mq.removeListener(sync);
    };
  }, []);
  return slot;
}

// "Client view": the pages the client sees (Home, Budget, Cash flow, Giving
// & funds, Payroll), filtered by access.tabs at render time, then "View as
// client…" (preview the portal as one of the client's people). Replaces the
// header "View as client" button in the bookkeeper view (D19). A menu
// button: Esc closes and refocuses, outside click closes, ArrowUp/Down
// cycle, ArrowDown on the closed button opens, first item gets focus.
function CL_ClientViewMenu({ client, page, access, counts, onSelectPage, onPreviewAs }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("pages"); // "pages" | "people" (View as client…)
  const rootRef = useRef(null);
  const btnRef = useRef(null);
  const name = (client && client.name) || "this client";
  const people = (client && client.users) || [];
  const allowed = access && access.tabs ? access.tabs : null;
  const keys = STAFF_CLIENT_VIEW_PAGES.filter((k) => !allowed || allowed.has(k));
  const labels = NAV_LABEL_BY_KEY;
  const labelOf = (k) => labels[k] || k;
  const isCurrent = keys.indexOf(page) !== -1 || STAFF_CLIENT_VIEW_PAGES.indexOf(page) !== -1;
  const budgetWaiting = !!(counts && counts.loaded && !counts.error && counts.budget && counts.budget.awaitingStaff && keys.indexOf("budget") !== -1);
  const close = (refocus) => {
    setOpen(false);
    setMode("pages");
    if (refocus && btnRef.current) btnRef.current.focus();
  };
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) close(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close(true);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown, { passive: true });
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  // First item gets focus when the menu opens or switches to the people list.
  useEffect(() => {
    if (!open || !rootRef.current) return;
    const first = rootRef.current.querySelector("[role='menuitem']:not([disabled])");
    if (first) first.focus();
  }, [open, mode]);
  const onMenuKeyDown = (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const items = Array.from((rootRef.current && rootRef.current.querySelectorAll("[role='menuitem']:not([disabled])")) || []);
    if (!items.length) return;
    e.preventDefault();
    const i = items.indexOf(document.activeElement);
    (e.key === "ArrowDown" ? items[(i + 1) % items.length] : items[(i - 1 + items.length) % items.length]).focus();
  };
  const goPage = (k) => {
    close(false);
    if (onSelectPage) onSelectPage(k);
  };
  const viewAs = () => {
    if (people.length === 1) {
      close(false);
      if (onPreviewAs) onPreviewAs(people[0].id);
    } else setMode("people");
  };
  const pickPerson = (id) => {
    close(false);
    if (onPreviewAs) onPreviewAs(id);
  };
  const toggle = () => {
    setMode("pages");
    setOpen((v) => !v);
    try {
      if (!open) MGB_track("client-view-open");
    } catch (e) {}
  };
  const btnLabel = isCurrent ? "Client view · " + labelOf(page) : "Client view";
  const noOneWhy = "No one at this client can sign in yet.";
  return (
    <span className="cl-clientview cl-viewas-wrap" ref={rootRef}>
      <button
        ref={btnRef}
        type="button"
        className={"cl-clientview-btn" + (isCurrent ? " is-current" : "") + (open ? " open" : "")}
        data-tour="client-view"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={btnLabel + (budgetWaiting ? ", Budget waiting for your decision" : "")}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setMode("pages");
            setOpen(true);
          }
        }}
      >
        <span className="cl-clientview-label" data-tour="client-view-as">
          <span className="cl-clientview-full">{btnLabel}</span>
          <span className="cl-clientview-short" aria-hidden="true">
            Client view
          </span>
        </span>
        {budgetWaiting && <span className="nav-tab-badge is-dot is-warn" aria-hidden="true" />}
        <ChevronDownIcon className={"cl-viewas-chev" + (open ? " open" : "")} />
      </button>
      {open && (
        <div className="cl-viewas-menu cl-clientview-menu" role="menu" aria-label="Client view" onKeyDown={onMenuKeyDown}>
          {mode === "pages" ? (
            <>
              <div className="cl-clientview-head" role="presentation">
                What {name} sees
              </div>
              {keys.map((k) => {
                const cur = page === k;
                return (
                  <button
                    key={k}
                    type="button"
                    role="menuitem"
                    className={"cl-viewas-item cl-clientview-item" + (cur ? " is-current" : "")}
                    aria-current={cur ? "page" : undefined}
                    onClick={() => goPage(k)}
                  >
                    <span className="cl-viewas-name">{labelOf(k)}</span>
                    {k === "budget" && budgetWaiting && (
                      <span className="cl-clientview-wait">
                        <span className="nav-tab-badge is-dot is-warn" aria-hidden="true" />
                        Waiting for you
                      </span>
                    )}
                    {cur && (
                      <span className="cl-clientview-check" aria-hidden="true">
                        ✓
                      </span>
                    )}
                  </button>
                );
              })}
              <div className="cl-clientview-sep" role="separator" />
              {people.length ? (
                <button type="button" role="menuitem" className="cl-viewas-item" onClick={viewAs}>
                  <span className="cl-viewas-name">View as client…</span>
                </button>
              ) : (
                <button
                  type="button"
                  role="menuitem"
                  className="cl-viewas-item"
                  disabled
                  aria-disabled="true"
                  aria-describedby="cl-clientview-why"
                  title={noOneWhy}
                >
                  <span className="cl-viewas-name">View as client…</span>
                  <span id="cl-clientview-why" className="cl-viewas-role">
                    {noOneWhy}
                  </span>
                </button>
              )}
            </>
          ) : (
            people.map((u) => (
              <button key={u.id} type="button" role="menuitem" className="cl-viewas-item" onClick={() => pickPerson(u.id)}>
                <span className="cl-viewas-name">{u.name}</span>
                {u.role && <span className="cl-viewas-role">{u.role}</span>}
              </button>
            ))
          )}
        </div>
      )}
    </span>
  );
}

// "View as client": one portal user opens straight away; more than one gets
// a small menu. No users: disabled, with the reason as a tooltip.
function CL_ViewAsButton({ client, onPreviewAs }) {
  const people = (client && client.users) || [];
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const btnRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        if (btnRef.current) btnRef.current.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown, { passive: true });
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const pick = (id) => {
    setOpen(false);
    if (onPreviewAs) onPreviewAs(id);
  };
  const onMenuKeyDown = (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const items = Array.from((rootRef.current && rootRef.current.querySelectorAll("[role='menuitem']")) || []);
    if (!items.length) return;
    e.preventDefault();
    const i = items.indexOf(document.activeElement);
    (e.key === "ArrowDown" ? items[(i + 1) % items.length] : items[(i - 1 + items.length) % items.length]).focus();
  };
  const icon = typeof UsersIcon === "function" ? <UsersIcon width="15" height="15" /> : null;
  if (!people.length) {
    const why = "This client has no portal users yet, so there's no one to view it as.";
    return (
      <span className="cl-viewas-wrap" title={why}>
        <button type="button" className="btn-secondary cl-viewas" disabled aria-describedby="cl-viewas-why">
          {icon}
          View as client
        </button>
        <span id="cl-viewas-why" className="cl-sr-only">
          {why}
        </span>
      </span>
    );
  }
  if (people.length === 1) {
    const u = people[0];
    return (
      <button type="button" className="btn-secondary cl-viewas" title={`See the portal as ${u.name}`} data-tour="client-view-as" onClick={() => pick(u.id)}>
        {icon}
        View as client
      </button>
    );
  }
  return (
    <span className="cl-viewas-wrap" ref={rootRef}>
      <button
        ref={btnRef}
        type="button"
        className="btn-secondary cl-viewas"
        data-tour="client-view-as"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {icon}
        View as client
        <ChevronDownIcon className={"cl-viewas-chev" + (open ? " open" : "")} />
      </button>
      {open && (
        <div className="cl-viewas-menu" role="menu" aria-label="View as" onKeyDown={onMenuKeyDown}>
          {people.map((u, i) => (
            <button key={u.id} type="button" role="menuitem" className="cl-viewas-item" autoFocus={i === 0} onClick={() => pick(u.id)}>
              <span className="cl-viewas-name">{u.name}</span>
              {u.role && <span className="cl-viewas-role">{u.role}</span>}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
