// components/staff/StaffNav.jsx — the staff side's five places, declared once.
//
// Staff navigation redesign (owner approved 2026-10-08): Today, Inbox, Work,
// Clients and Team. The rail (app.jsx StaffRail), the phone drawer (Sidebar),
// the top bar's ⌘K "Pages" group (TopBar.jsx) and the staff tour (Tour.jsx)
// all read this list, so a place is added or renamed in exactly one spot.
//
// Prefix: NAV_. Like every component file, it only touches app.jsx globals
// (icons, NON_CLIENT_PAGES) at render time, never at the top level.
//
// Routes: #/<slug> for a place, #/<slug>/<tab> for a tab inside Work or Team
// (and #/help/<article>). App owns the first segment (parseHashRoute →
// setPage); the hub page owns the tab segment through NAV_useHashSub, which
// rewrites it with history.replaceState so a tab click is not a history
// entry. App's buildHashRoute keeps a hash that already starts with the
// page's slug, so the tab survives a re-render.

const NAV_PLACES = [
  {
    key: "today",
    slug: "today",
    label: "Today",
    hint: "What needs you, in order",
    help: "home-page",
    icon: () => <HomeIcon />,
  },
  {
    key: "inbox",
    slug: "inbox",
    label: "Inbox",
    hint: "Client messages",
    help: "inbox",
    icon: () => <ChatIcon width="16" height="16" strokeWidth="1.8" />,
    // Not the signed-in person's own while an admin is in "View as".
    visible: (ctx) => !ctx.impersonating,
  },
  {
    key: "work",
    slug: "work",
    label: "Work",
    hint: "Tasks, month-end close and deadlines",
    help: "work-page",
    icon: () => <ChecklistIcon width="16" height="16" strokeWidth="1.8" />,
    visible: (ctx) => !ctx.impersonating,
    tabs: [
      { key: "tasks", label: "Tasks", help: "my-tasks" },
      { key: "close", label: "Close", help: "month-end-close" },
      { key: "deadlines", label: "Deadlines", help: "deadlines", visible: () => typeof DL_DeadlinesPage === "function" },
    ],
  },
  {
    key: "clients",
    slug: "clients",
    label: "Clients",
    hint: "Every client you can see",
    help: "clients-page",
    icon: () => <ClientRosterIcon />,
  },
  {
    key: "team",
    slug: "team",
    label: "Team",
    hint: "People, reviews and onboarding",
    help: "team-page",
    icon: () => <TeamIcon />,
    visible: (ctx) => !ctx.impersonating,
    tabs: [
      { key: "people", label: "People", help: "time-off-coverage" },
      { key: "reviews", label: "Reviews", help: "quarterly-reviews", visible: () => typeof TR_TeamReviewsPage === "function" },
      { key: "onboarding", label: "Onboarding", help: "new-hire-onboarding", visible: () => typeof SON_ProgressTab === "function" },
      { key: "hours", label: "Hours", help: "hours-budget", admin: true },
      { key: "reply-times", label: "Reply times", help: "reply-times", admin: true, visible: () => typeof RT_ReplyTimesTab === "function" },
      { key: "feedback", label: "Feedback", help: "feedback-page", admin: true, visible: () => typeof FB_FeedbackPage === "function" },
      { key: "performance", label: "Performance", help: "performance", visible: () => typeof PF_PerformanceTab === "function" },
    { key: "members", label: "Members", help: "staff-management", admin: true },
    ],
  },
];

const NAV_PLACE_BY_KEY = Object.fromEntries(NAV_PLACES.map((p) => [p.key, p]));
const NAV_PLACE_BY_SLUG = Object.fromEntries(NAV_PLACES.map((p) => [p.slug, p]));

// ctx: { role, isAdmin (admin or temporary admin), impersonating }.
function NAV_visiblePlaces(ctx) {
  const c = ctx || {};
  return NAV_PLACES.filter((p) => !p.visible || p.visible(c));
}

// A place's tabs the viewer can open, in order. Admin tabs need ctx.isAdmin.
function NAV_visibleTabs(place, ctx) {
  const p = typeof place === "string" ? NAV_PLACE_BY_KEY[place] : place;
  const c = ctx || {};
  if (!p || !p.tabs) return [];
  return p.tabs.filter((t) => (!t.admin || c.isAdmin) && (!t.visible || t.visible(c)));
}

function NAV_isPlace(key) {
  return Object.prototype.hasOwnProperty.call(NAV_PLACE_BY_KEY, key);
}

// "#/work/close" -> "close"; "#/work" -> null. Only the second segment.
function NAV_subFromHash(slug) {
  try {
    const m = new RegExp("^#\\/" + slug + "\\/([a-z0-9-]+)").exec(window.location.hash || "");
    return m ? m[1] : null;
  } catch (e) {
    return null;
  }
}

// Go to a place (and tab). Assigning the hash fires hashchange, which App
// turns into setPage; the hub then reads the tab from the hash.
function NAV_go(key, sub) {
  const p = NAV_PLACE_BY_KEY[key];
  const next = "#/" + (p ? p.slug : key) + (sub ? "/" + sub : "");
  if (window.location.hash !== next) window.location.hash = next;
}

// Tab state for a hub page (Work, Team), kept in the hash.
//   const [tab, setTab] = NAV_useHashSub("work", ["tasks","close"], "tasks");
// setTab rewrites "#/<slug>/<tab>" in place (no history entry). A tab that
// is not in `keys` (someone's old link, an admin tab for a bookkeeper) reads
// as `fallback`.
function NAV_useHashSub(slug, keys, fallback) {
  const read = () => {
    const s = NAV_subFromHash(slug);
    return s && keys.indexOf(s) !== -1 ? s : fallback;
  };
  const [sub, setSubState] = React.useState(read);
  React.useEffect(() => {
    const onHash = () => setSubState(read());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
    // keys is a fresh array each render; compare by content.
  }, [slug, keys.join("|"), fallback]);
  // Deep-link or tab-list change: keep the state in step with the hash.
  React.useEffect(() => {
    const cur = read();
    if (cur !== sub) setSubState(cur);
  }, [keys.join("|")]);
  const setSub = React.useCallback(
    (key) => {
      const next = keys.indexOf(key) !== -1 ? key : fallback;
      try {
        const url = window.location.pathname + window.location.search + "#/" + slug + "/" + next;
        window.history.replaceState(window.history.state, "", url);
      } catch (e) {}
      setSubState(next);
      // replaceState fires no hashchange, so tell listeners (Usage Stats
      // counts each tab as its own view) that the tab changed.
      try {
        window.dispatchEvent(new Event("mgb-tabchange"));
      } catch (e) {}
    },
    [slug, keys.join("|"), fallback],
  );
  return [sub, setSub];
}

// The one tab row used by every hub and by a client's pages: an accessible
// tablist (arrow keys move, Home/End jump) styled by staff-nav.css.
//   <NAV_TabRow label="Work" tabs={[{key,label,badge?}]} current={tab} onSelect={setTab} idPrefix="wk" />
// `badge` is an optional node rendered after the label (a count or dot).
function NAV_TabRow({ label, tabs, current, onSelect, idPrefix, className, right, inTopbar }) {
  const prefix = idPrefix || "nav";
  // 2026-10-08: the row renders inside the app's top bar (#app-topbar-tabs,
  // App in app.jsx) when that slot exists, so the page title and its tabs
  // share one surface. Layout effect so the row never paints in the body
  // first. Pass inTopbar={false} to keep a row where it is.
  const [slot, setSlot] = React.useState(null);
  React.useLayoutEffect(() => {
    setSlot(inTopbar === false ? null : document.getElementById("app-topbar-tabs"));
  }, [inTopbar]);
  const onKeyDown = (e) => {
    const i = tabs.findIndex((t) => t.key === current);
    let next = null;
    if (e.key === "ArrowRight") next = tabs[(i + 1) % tabs.length];
    else if (e.key === "ArrowLeft") next = tabs[(i - 1 + tabs.length) % tabs.length];
    else if (e.key === "Home") next = tabs[0];
    else if (e.key === "End") next = tabs[tabs.length - 1];
    if (!next) return;
    e.preventDefault();
    onSelect(next.key);
    const el = document.getElementById(prefix + "-tab-" + next.key);
    if (el) el.focus();
  };
  const row = (
    <div className={"nav-tabs-row" + (className ? " " + className : "")}>
      <div className="nav-tabs" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
        {tabs.map((t) => (
          <button
            key={t.key}
            id={prefix + "-tab-" + t.key}
            type="button"
            role="tab"
            aria-selected={current === t.key}
            aria-controls={prefix + "-panel"}
            tabIndex={current === t.key ? 0 : -1}
            className={"nav-tab" + (current === t.key ? " active" : "")}
            data-tour={t.tour || undefined}
            onClick={() => onSelect(t.key)}
          >
            {t.icon ? <span className="nav-tab-icon" aria-hidden="true">{t.icon}</span> : null}
            <span className="nav-tab-label">{t.label}</span>
            {t.badge ? <span className="nav-tab-badge">{t.badge}</span> : null}
          </button>
        ))}
      </div>
      {right ? <div className="nav-tabs-right">{right}</div> : null}
    </div>
  );
  return slot && typeof ReactDOM !== "undefined" ? ReactDOM.createPortal(row, slot) : row;
}
