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

// True when Workbench is on for this person (WB_store, loaded after this file).
function NAV_wbOn() {
  try {
    return typeof WB_store !== "undefined" && typeof WB_NAME === "string" && !!WB_store.getState().on;
  } catch (e) {
    return false;
  }
}

const NAV_PLACES = [
  {
    key: "today",
    slug: "today",
    // Desk (components/workbench/, spec E3): while it's on, Today's help is
    // the Desk article. The name stays "Today" either way.
    label: "Today",
    get hint() {
      return "What to do next, and what is waiting";
    },
    get help() {
      return NAV_wbOn() ? "workbench" : "home-page";
    },
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
    hint: "Slate, month-end close and deadlines",
    help: "work-page",
    icon: () => <ChecklistIcon width="16" height="16" strokeWidth="1.8" />,
    visible: (ctx) => !ctx.impersonating,
    tabs: [
      { key: "tasks", label: "Slate", keywords: ["tasks", "my tasks", "to-do"], help: "my-tasks" },
      // Client notes and SOPs (#/work/notes), which used to sit under the task
      // list (Tasks module, 2026-10-11).
      { key: "notes", label: "Notes & SOPs", help: "notes" },
      { key: "close", label: "Close", help: "month-end-close" },
      { key: "deadlines", label: "Deadlines", help: "deadlines", visible: () => typeof DL_DeadlinesPage === "function" },
      // Review a file (docs/gl-review-spec.md section 8): any staff member,
      // any exported General Ledger, checked in the browser, nothing saved.
      { key: "ledger", label: "Ledger review", help: "ledger-review", visible: () => typeof LR_ReviewFilePage === "function" },
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
    hint: "People, reviews, onboarding and the handbook",
    help: "team-page",
    icon: () => <TeamIcon />,
    visible: (ctx) => !ctx.impersonating,
    tabs: [
      { key: "people", label: "People", help: "time-off-coverage" },
      { key: "reviews", label: "Reviews", help: "quarterly-reviews", visible: () => typeof TR_TeamReviewsPage === "function" },
      { key: "onboarding", label: "Onboarding", help: "new-hire-onboarding", visible: () => typeof SON_ProgressTab === "function" },
      { key: "handbook", label: "Handbook", help: "staff-handbook", visible: () => typeof HB_HandbookTab === "function" },
      { key: "hours", label: "Hours", help: "hours-budget", admin: true },
      { key: "reply-times", label: "Reply times", help: "reply-times", admin: true, visible: () => typeof RT_ReplyTimesTab === "function" },
      { key: "feedback", label: "Feedback", help: "feedback-page", admin: true, visible: () => typeof FB_FeedbackPage === "function" },
      { key: "performance", label: "Performance", help: "performance", visible: () => typeof PF_PerformanceTab === "function" },
      { key: "inventory", label: "Inventory", help: "tech-inventory", visible: () => typeof TI_TechTab === "function" },
      { key: "ledger", label: "Ledger review", help: "ledger-review", admin: true, visible: () => typeof LR_SettingsPanel === "function" },
      { key: "members", label: "Members", help: "staff-management", admin: true },
      // Employee records (components/hr/): real admins only, never a
      // temporary admin grant or "View as" (the RPCs refuse them too).
      {
        key: "employees",
        label: "Employee records",
        help: "employee-records",
        admin: true,
        realAdmin: true,
        visible: () => typeof HR_RecordsTab === "function",
      },
    ],
  },
  // MGB (internal): MyGoodBooks' own books, files and close, in the same
  // workspace a client gets. Not a place with its own page: a click opens the
  // internal client (App's openInternal), so it has no tabs here and no
  // route of its own beyond #/internal (-> #/client/<id>/...). Only an admin
  // the owner granted the MGB (internal) permission sees it, never in "View as".
  {
    key: "internal",
    slug: "internal",
    label: "MGB (internal)",
    hint: "MyGoodBooks' own books, files and close. Not a client",
    help: "mgb-internal",
    icon: () => <InternalIcon width="16" height="16" strokeWidth="1.8" />,
    visible: (ctx) => !!ctx.canViewInternal && !ctx.impersonating,
  },
];

const NAV_PLACE_BY_KEY = Object.fromEntries(NAV_PLACES.map((p) => [p.key, p]));
const NAV_PLACE_BY_SLUG = Object.fromEntries(NAV_PLACES.map((p) => [p.slug, p]));

// ctx: { role, isAdmin (admin or temporary admin), isRealAdmin (role admin,
// not in "View as"), impersonating, canViewInternal }.
function NAV_visiblePlaces(ctx) {
  const c = ctx || {};
  return NAV_PLACES.filter((p) => !p.visible || p.visible(c));
}

// A place's tabs the viewer can open, in order. Admin tabs need ctx.isAdmin;
// realAdmin tabs also need ctx.isRealAdmin.
function NAV_visibleTabs(place, ctx) {
  const p = typeof place === "string" ? NAV_PLACE_BY_KEY[place] : place;
  const c = ctx || {};
  if (!p || !p.tabs) return [];
  return p.tabs.filter((t) => (!t.admin || c.isAdmin) && (!t.realAdmin || c.isRealAdmin) && (!t.visible || t.visible(c)));
}

function NAV_isPlace(key) {
  return Object.prototype.hasOwnProperty.call(NAV_PLACE_BY_KEY, key);
}

// Renamed tabs, so old links (and emails already sent) still land on the
// right tab: "<slug>/<old>" -> new key.
const NAV_TAB_ALIASES = { "team/tech": "inventory" };

// "#/work/close" -> "close"; "#/work" -> null. Only the second segment.
// Lowercase slugs only, so "#/work/notes" passes like any tab.
function NAV_subFromHash(slug) {
  try {
    const m = new RegExp("^#\\/" + slug + "\\/([a-z0-9-]+)").exec(window.location.hash || "");
    return m ? NAV_TAB_ALIASES[slug + "/" + m[1]] || m[1] : null;
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
//
// Badges (a client's tab row): `badge` truthy shows a pill; a number over 9
// reads "9+". `badgeDot: true` draws a dot instead, `badgeTone` "bad" | "warn"
// colors it, and `badgeLabel` is screen-reader text that becomes part of the
// tab's name ("Messages, 2 replies waiting"). Falsy `badge` renders nothing.
// `after` renders between the tablist and `right`, outside role="tablist"
// (the client row's Client view menu).
function NAV_TabRow({ label, tabs, current, onSelect, idPrefix, className, right, after, inTopbar }) {
  const prefix = idPrefix || "nav";
  // No tab current (a client's Client view page or Client setup is open):
  // the first tab takes the roving tab stop.
  const currentInTabs = tabs.some((t) => t.key === current);
  const tablistRef = React.useRef(null);
  // 2026-10-08: the row renders inside the app's top bar (#app-topbar-tabs,
  // App in app.jsx) when that slot exists, so the page title and its tabs
  // share one surface. Layout effect so the row never paints in the body
  // first. Pass inTopbar={false} to keep a row where it is.
  const [slot, setSlot] = React.useState(null);
  React.useLayoutEffect(() => {
    setSlot(inTopbar === false ? null : document.getElementById("app-topbar-tabs"));
  }, [inTopbar]);
  // Keep the active tab in view (phones scroll the row sideways), on mount
  // and on every tab change, so a deep link never opens with it off screen.
  // Badges arrive after the first paint and widen tabs, so a badge change in
  // the first few seconds after a tab change scrolls again; later ones
  // (polling) leave a row the person scrolled alone.
  const badgeSig = tabs.map((t) => t.key + ":" + (t.badge == null ? "" : String(t.badge))).join(",");
  const scrolledAtRef = React.useRef({ current: null, at: 0 });
  React.useEffect(() => {
    try {
      const mark = scrolledAtRef.current;
      if (mark.current !== current) scrolledAtRef.current = { current, at: Date.now() };
      else if (Date.now() - mark.at > 4000) return;
      const list = tablistRef.current;
      const el = current && list ? document.getElementById(prefix + "-tab-" + current) : null;
      if (!el || !list.contains(el) || list.scrollWidth <= list.clientWidth) return;
      const lr = list.getBoundingClientRect();
      const er = el.getBoundingClientRect();
      // Only the row scrolls (scrollIntoView would also move the page).
      if (er.left < lr.left) list.scrollLeft += er.left - lr.left - 32;
      else if (er.right > lr.right) list.scrollLeft += er.right - lr.right + 32;
    } catch (e) {}
  }, [current, prefix, slot, badgeSig]);
  // Scroll cue (bookkeeper tabs polish 2026-10-14): when the row scrolls
  // sideways (761-1023px with an admin's tabs, and phones), the edge that has
  // more tabs behind it fades out. data-more = "start" | "end" | "both".
  const [more, setMore] = React.useState("");
  React.useEffect(() => {
    const list = tablistRef.current;
    if (!list) return undefined;
    const update = () => {
      const max = list.scrollWidth - list.clientWidth;
      const next = max <= 2 ? "" : list.scrollLeft > 2 ? (list.scrollLeft < max - 2 ? "both" : "start") : "end";
      setMore((m) => (m === next ? m : next));
    };
    update();
    list.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    let ro = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(update);
      ro.observe(list);
      Array.from(list.children).forEach((c) => ro.observe(c));
    }
    return () => {
      list.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      if (ro) ro.disconnect();
    };
  }, [slot, badgeSig]);
  const onKeyDown = (e) => {
    const i = tabs.findIndex((t) => t.key === current);
    let next = null;
    // No tab current (i < 0): Right/Home go to the first tab, Left/End the last.
    if (e.key === "ArrowRight") next = tabs[i < 0 ? 0 : (i + 1) % tabs.length];
    else if (e.key === "ArrowLeft") next = tabs[i < 0 ? tabs.length - 1 : (i - 1 + tabs.length) % tabs.length];
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
      <div className="nav-tabs" role="tablist" aria-label={label} onKeyDown={onKeyDown} ref={tablistRef} data-more={more || undefined}>
        {tabs.map((t, i) => (
          <button
            key={t.key}
            id={prefix + "-tab-" + t.key}
            type="button"
            role="tab"
            aria-selected={current === t.key}
            aria-controls={prefix + "-panel"}
            tabIndex={current === t.key || (!currentInTabs && i === 0) ? 0 : -1}
            className={"nav-tab" + (current === t.key ? " active" : "")}
            data-tour={t.tour || undefined}
            onClick={() => onSelect(t.key)}
          >
            {t.icon ? <span className="nav-tab-icon" aria-hidden="true">{t.icon}</span> : null}
            <span className="nav-tab-label">{t.label}</span>
            {t.badge ? (
              <span
                className={
                  "nav-tab-badge" + (t.badgeTone ? " is-" + t.badgeTone : "") + (t.badgeDot ? " is-dot" : "")
                }
              >
                {t.badgeDot ? null : typeof t.badge === "number" ? (
                  <span aria-hidden={t.badgeLabel ? "true" : undefined}>{t.badge > 9 ? "9+" : t.badge}</span>
                ) : (
                  t.badge
                )}
                {t.badgeLabel ? <span className="nav-sr">{", " + t.badgeLabel}</span> : null}
              </span>
            ) : null}
          </button>
        ))}
      </div>
      {after || null}
      {right ? <div className="nav-tabs-right">{right}</div> : null}
    </div>
  );
  return slot && typeof ReactDOM !== "undefined" ? ReactDOM.createPortal(row, slot) : row;
}
