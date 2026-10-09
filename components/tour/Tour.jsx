// ----------------------------------------------------------------------------
// Guided tours: one for new client users (owner request 2026-09-30), in a
// version for each plan and access level (2026-10-09: Pro or Basic, full,
// limited or budget-only access, the payroll add-on), and role tours on the
// staff side (owner requests 2026-10-09): a bookkeeper
// tour of a bookkeeper's day (it replaced the short generic staff tour of
// 2026-10-08), an admin tour of the pages only admins see, a temporary admin
// tour of what a temporary admin grant opens, and an account manager tour
// for anyone who is a client's account manager (clients.account_manager_email;
// Jesse today).
//
// A spotlight tour: the page dims, the target element is cut out and
// highlighted, and a small popover explains it (title, a sentence or two,
// "Step 3 of 8", Back / Next / Skip tour). After the client tour (finished
// or skipped, it goes back to Home) a small "Get set up" checklist card sits
// at the top of the client's Home until dismissed. The staff tours have no
// checklist.
//
// Targets are marked with data-tour="..." attributes:
//   Client tour (TOUR_Root; each step opens its page first)
//   client-needs     Home's "Needs you" card (app.jsx CLIENT_HomeTop)
//   customize        Customize dashboard button (WidgetDrawer.jsx), on
//                    Home for every plan but Basic
//   milestone        the milestone button on the Home organization card
//                    (app.jsx CLIENT_HomeTop; not for budget-only people)
//   sync             the header's sync pill / Sync now (app.jsx
//                    QboSyncNowButton), only once a client syncs QuickBooks
//   #cf-tab-<key>    a Finances tab, found by id (NAV_TabRow, idPrefix "cf"):
//                    budget, bank, receivables, giving, payroll
//   #cr-tab-downloads  Reports' Downloads tab (idPrefix "cr")
//   #cm-tab-conversation  Messages' Conversation tab (idPrefix "cm")
//   doc-upload       the Upload Document button (app.jsx DocumentsPage)
//   #st-tab-profile, #st-tab-organization (full access only), #st-tab-plan
//                    client Settings tabs (Settings.jsx), clicked open
// The client rail (data-tour nav-home, nav-messages, nav-finances,
// nav-reports, nav-documents and the "settings" gear, app.jsx Sidebar) is
// marked too, but the client tour doesn't point at it any more.
//   Staff tours (TOUR_StaffRoot)
//   staff-nav        the rail's list of places (app.jsx StaffRail)
//   staff-nav-<key>  one place, in the rail and in the phone drawer (app.jsx
//                    StaffRail / Sidebar): today, inbox, work, clients, team
//   today-list       the ranked list on Today (components/staff/Today.jsx)
//   tb-search        the ⌘K search box (components/staff/TopBar.jsx)
//   tb-quick         the "+" menu, only with a client open (TopBar.jsx)
//   tb-help          the "?" menu (components/staff/TopBar.jsx)
//   clients-filters  Mine / All / Needs attention (components/staff/ClientsPage.jsx)
//   inbox-list       Inbox's list of conversations (components/inbox/StaffInbox.jsx)
//   #client-tab-client-overview  a client's Overview tab (ClientsPage.jsx
//                    CL_ClientTabs, NAV_TabRow idPrefix "client")
//   #wk-tab-<key>    a Work tab, found by id (NAV_TabRow, idPrefix "wk")
//   #tp-tab-<key>    a Team tab, found by id (NAV_TabRow, idPrefix "tp")
//   #st-tab-firm     Settings' Firm settings tab, found by id (Settings.jsx)
// A role-tour step can `go` somewhere first (NAV_go to a place and tab, or
// TOUR_openClient to a client's Overview through the #/client/<id>/overview
// route) and `press` its target (click a Settings tab open) once it's found.
// A `strip` step lights up the whole tab row its target tab sits in (the
// step names the other tabs too). The popover for a tab in a row of tabs
// (NAV_TabRow) goes below it, so the rest of the row stays in view, and a
// target scrolled into view stops
// below the sticky bars at the top (the phone's navy bar, the staff tool
// bar). A step that doesn't apply to this person (limited access, a tab not on
// their plan, a missing element) is left out of the tour. On a phone the
// staff places sit in the off-canvas drawer, which the overlay opens for
// those steps and closes again afterwards.
//
// State lives in the settings JSON of public.user_settings (supabase/
// user-settings.sql), written through ST_store (Settings.jsx), which also
// keeps the localStorage cache:
//   tour.status              "started" | "done" | "skipped"   (client tour)
//   tour.startedAt/endedAt   ISO timestamps
//   tour.checklist           { profile, notifications, invite, document, message: true }
//   tour.checklistDismissed  true once the card is closed
//   tour.home                where the checklist showed for someone with no
//                            Home (before 2026-10-08; only read now)
//   bookkeeperTour.status    "done" | "skipped"            (bookkeeper tour)
//   bookkeeperTour.at        ISO timestamp of that
//   adminTour, amTour        { status, at }, same shape   (role tours)
//   tempAdminTour            { status, at, until }: until is the expiry of
//                            the grant it ran for (staff_temp_admin_access),
//                            read when the tour started
//   staffTour                { status, at } of the old generic staff tour;
//                            no longer written, only read (newToStaff)
// The client tour starts on its own only for a signed-in client user who has
// no tour status yet. Never for staff, "View as", or "Preview as a client
// user". Staff previewing can start it from client Settings > Help to see
// the version that person gets; ST_store is paused then, so nothing is
// saved.
// The staff tours start on their own for a staffer signed in as themselves,
// one per page load (so never two in a row), in the order temporary admin,
// bookkeeper, admin, account manager: the first that applies and is pending
// (TOUR_STAFF_AUTO_ORDER). The bookkeeper tour never starts by itself for an
// admin; the temporary admin tour is pending again once the grant's expiry
// differs from the saved `until` (a new grant). For a bookkeeper the pick
// waits until App has checked for a temporary admin grant, and an auto
// start waits while Today's first sign-in profile prompt is open. They run
// again whenever something calls
// TOUR_startStaff(key) (the "?" menu, ⌘K and Settings › Help list the ones
// that apply, via TOUR_staffTourList). During "View as" only the bookkeeper
// tour runs: it shows what that bookkeeper sees and saves nothing.
//
// Loaded before app.jsx in the shared global scope: every top-level name has
// a TOUR_ prefix, hooks are used as React.*, and app.jsx / Settings.jsx /
// StaffNav.jsx globals (ST_store, ST_useSettings, NAV_visiblePlaces) are only
// touched at render time.
// ----------------------------------------------------------------------------

const TOUR_START_EVENT = "mgb:tour-start";
const TOUR_STAFF_START_EVENT = "mgb:staff-tour-start";
const TOUR_DRAWER_QUERY =
  "(max-width: 760px) and (hover: none), (max-width: 760px) and (pointer: coarse)";
const TOUR_PAD = 6; // spotlight padding around the target
const TOUR_GAP = 12; // popover distance from the spotlight
const TOUR_MARGIN = 16; // popover distance from the viewport edge
// A target that isn't on the page yet (a list still loading, a drawer row
// that mounts when the drawer opens) is looked for this often, this many
// times, before the popover is centered instead.
const TOUR_FIND_EVERY_MS = 150;
const TOUR_FIND_TRIES = 12;
const TOUR_SPOT_MAX = 0.55; // a "top" spotlight covers at most this much of the viewport

// Starts the client tour. Settings > Help calls this; anything else can too.
function TOUR_start() {
  try {
    window.dispatchEvent(new CustomEvent(TOUR_START_EVENT));
  } catch (e) {}
}

// Starts a staff-side tour: "bookkeeper" (the default; "staff" is an alias
// for it), "admin", "tempAdmin" or "am". The "?" menu, ⌘K and Settings call
// this; TOUR_StaffRoot listens.
function TOUR_startStaff(which) {
  try {
    window.dispatchEvent(new CustomEvent(TOUR_STAFF_START_EVENT, { detail: { which: which || "bookkeeper" } }));
  } catch (e) {}
}

function TOUR_isObj(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

// A key is a data-tour value, or "#id" for an element found by id.
function TOUR_find(key) {
  if (key.charAt(0) === "#") {
    const el = document.getElementById(key.slice(1));
    return el && el.getClientRects().length > 0 ? el : null;
  }
  const els = document.querySelectorAll('[data-tour="' + key + '"]');
  for (let i = 0; i < els.length; i++) {
    // display:none (and hidden ancestors) give no client rects.
    if (els[i].getClientRects().length > 0) return els[i];
  }
  return null;
}

function TOUR_inDrawerMode() {
  return typeof window.matchMedia === "function" && window.matchMedia(TOUR_DRAWER_QUERY).matches;
}

function TOUR_inSidebar(el) {
  return !!(el && el.closest && el.closest(".sidebar"));
}

// What the spotlight goes around: the target, or for a `strip` step the
// whole tab row (role="tablist", NAV_TabRow) the target tab sits in.
function TOUR_spotEl(el, step) {
  return (step && step.strip && el && el.closest && el.closest('[role="tablist"]')) || el;
}

// How far down the sticky bars at the top of the page reach once stuck:
// the phone's navy .mobile-topbar and the staff tool bar (.tb-bar, which
// sits under it on a phone). 0 when neither shows.
function TOUR_stickyTop() {
  let bottom = 0;
  document.querySelectorAll(".mobile-topbar, .tb-bar").forEach((bar) => {
    if (!bar.getClientRects().length) return;
    const cs = window.getComputedStyle(bar);
    if (cs.position !== "sticky" && cs.position !== "fixed") return;
    bottom = Math.max(bottom, (parseFloat(cs.top) || 0) + bar.getBoundingClientRect().height);
  });
  return bottom;
}

// Scrolls a target into view, stopping below the sticky bars so it isn't
// left underneath them. A tall target lit at its top (`spot: "top"`) only
// moves when its top is hidden or below the middle of the screen, and then
// lines up just under the bars. Targets in the drawer or the bars
// themselves just use scrollIntoView.
function TOUR_scrollIntoView(el, step, key) {
  const pinned = TOUR_inSidebar(el) || !!(el.closest && el.closest(".mobile-topbar, .tb-bar"));
  const top = pinned ? 0 : TOUR_stickyTop();
  if (step.spot === "top" && !pinned) {
    const r = el.getBoundingClientRect();
    if (r.top < top + TOUR_PAD || r.top > window.innerHeight / 2) window.scrollBy(0, r.top - top - TOUR_GAP);
    return;
  }
  el.scrollIntoView({ block: key === "customize" ? "center" : "nearest", inline: "nearest" });
  if (pinned) return;
  const after = el.getBoundingClientRect().top;
  if (after < top + TOUR_PAD) window.scrollBy(0, after - top - TOUR_GAP);
}

// ---------------------------------------------------------------------------
// Client tour: one builder, a version per person (owner request 2026-10-09:
// "all the different versions based on the access level and role"). The
// version comes from TOUR_clientCtx:
//   kind        "full" (client_users.access is full; the only people who
//               see Settings › Organization), "category" (budget lines for
//               their areas only) or "limited" (some pages only)
//   scoped      per-person access really narrows their pages (false on
//               Basic, where a limited person still sees every Basic page,
//               so they get the plain welcome)
//   plan       "basic" | "standard" (retired Plus, worded like Basic) |
//               "premium" (Pro)
//   pro         Pro pages for this person (access.premiumForUser; false
//               when staff turned Pro pages off for them)
//   tabs        the pages they can open (access.tabs); payroll is there
//               only with the payroll add-on
// Each step opens its page first (`go`) and points at something on it, so
// its targets are page elements only, never the rail: a rail item is on
// the page the step starts from, and would be picked before the page
// changes. A step that doesn't apply is left out (TOUR_visibleClientSteps).
// ---------------------------------------------------------------------------
const TOUR_CLIENT_PAGES = ["dashboard", "messages", "budget", "bank", "receivables", "giving", "payroll", "reports", "documents"];
const TOUR_CLIENT_LABELS = {
  dashboard: "Home",
  messages: "Messages",
  budget: "Budget",
  bank: "Bank accounts",
  receivables: "Cash flow",
  giving: "Giving",
  payroll: "Payroll",
  reports: "Reports",
  documents: "Documents",
};
// The Finances tabs the finances step covers (Payroll has its own step).
const TOUR_MONEY_TABS = ["budget", "bank", "receivables", "giving"];
const TOUR_MONEY_PRO = {
  budget: "Budget with approvals",
  bank: "Bank accounts with reconciliation",
  receivables: "Cash flow for bills and money coming in",
  giving: "Giving by fund",
};

// Which version of the client tour this person gets, from App's access
// (resolveAccess). `extra` adds onSelectPage, onOpenSettings and preview.
function TOUR_clientCtx(client, access, extra) {
  const a = access || {};
  const tabs = a.tabs instanceof Set ? a.tabs : new Set(a.tabs || []);
  // The real access, not isFullAccess: on Basic a scoped person counts as
  // full there, yet Settings › Organization still hides for them (the
  // server's can_edit reads client_users.access).
  const user = a.user || null;
  const kind = !user || (user.access || "full") === "full" ? "full" : a.isCategoryScoped ? "category" : "limited";
  return {
    clientName: (client && client.name) || "",
    kind,
    plan: a.plan || "basic",
    pro: !!a.premiumForUser,
    tabs,
    categories: a.categories ? Array.from(a.categories) : [],
    canEditOrg: kind === "full",
    // Per-person access actually narrows what they see (not on Basic,
    // where resolveAccess shows everyone the whole Basic set).
    scoped: kind !== "full" && a.isFullAccess !== true,
    ...(extra || {}),
  };
}

// "pro-full", "pro-off-full" (Pro plan, Pro pages off for this person),
// "basic-full", "limited" or "category". Sent with the tour's usage event.
function TOUR_clientVersion(ctx) {
  if (ctx.kind !== "full") return ctx.kind;
  return (ctx.pro ? "pro" : ctx.plan === "premium" ? "pro-off" : "basic") + "-full";
}

// Step definitions. `targets` are tried in order; the first on the page
// wins. Steps without targets are centered (welcome, done). `home` marks a
// step on Home, where the tour starts: it stays only when its target is
// there then (the sync pill is on Pro clients synced from QuickBooks only).
function TOUR_clientSteps(ctx) {
  const org = ctx.clientName;
  const has = (k) => !!(ctx.tabs && ctx.tabs.has(k));
  const open = (page) => () => {
    if (ctx.onSelectPage) ctx.onSelectPage(page);
  };
  const settings = (tab) => () => {
    if (ctx.onOpenSettings) ctx.onOpenSettings(tab);
    else if (ctx.onSelectPage) ctx.onSelectPage("client-settings");
  };
  const home = open("dashboard");
  const full = ctx.kind === "full";
  const category = ctx.kind === "category";
  const money = TOUR_MONEY_TABS.filter(has);
  const restart = "You can restart this tour any time from Settings, under Help.";
  return [
    {
      id: "welcome",
      title: org ? `Welcome to ${org}'s portal` : "Welcome to your portal",
      body: () => {
        const name = org || "your organization";
        if (category) {
          const areas = TOUR_joinList(ctx.categories);
          return `You see ${name}'s budget for the areas you look after${areas ? ": " + areas : ""}. This tour takes about a minute.`;
        }
        // Limited only where per-person access applies: on Basic everyone
        // sees the same pages, so the plain welcome fits.
        if (!full && ctx.scoped) {
          const pages = TOUR_joinList(TOUR_CLIENT_PAGES.filter(has).map((k) => TOUR_CLIENT_LABELS[k]));
          return `You can see ${pages}. Someone with full access at ${name}, or your bookkeeper, can change that. This tour takes about a minute.`;
        }
        if (ctx.pro) return "You're on Pro with full access: live books, budgets and reports for your board. This tour takes about two minutes.";
        if (ctx.plan === "premium")
          return `You have full access to ${name}'s books, updated from QuickBooks every 15 minutes. This tour takes about two minutes.`;
        return `You're on Basic: your books are updated each ${ctx.plan === "standard" ? "week" : "month"}, and you can download statements, share documents and message your bookkeeper any time. This tour takes about two minutes.`;
      },
    },
    {
      id: "home",
      home: true,
      go: home,
      targets: ["customize", "client-needs"],
      title: "Home",
      body: (key) => {
        const pick = key === "customize" ? " Use Customize dashboard to pick which cards show and put them in the order you like." : "";
        if (category) return "Home shows what needs you, then your areas of the budget at a glance." + pick;
        if (ctx.plan === "basic")
          return "Home shows what needs you and your organization card. The locked card below shows what Pro adds.";
        return `Home starts with what needs you, then ${ctx.pro ? "a live snapshot of your finances" : "your financial snapshot"}.` + pick;
      },
    },
    {
      id: "milestone",
      home: true,
      when: () => !category,
      go: home,
      targets: ["milestone"],
      title: "Your milestone",
      body: () => "Your organization card shows your milestone and plan. Open the milestone to see what's included and what's next.",
    },
    {
      id: "sync",
      home: true,
      // Follows this person's Pro pages, like the welcome: someone with Pro
      // pages off hears about the 15-minute updates there instead.
      when: () => ctx.pro,
      go: home,
      targets: ["sync"],
      title: "Up to date with QuickBooks",
      body: () => "Pro updates from QuickBooks every 15 minutes. Sync now pulls the latest whenever you want it.",
    },
    {
      id: "finances",
      when: () => money.length > 0,
      go: open(money[0]),
      targets: money.map((k) => "#cf-tab-" + k),
      strip: true,
      title: "Finances",
      body: () => {
        if (category) {
          const parts = [];
          if (has("budget")) parts.push("Budget shows only the budget lines for your areas");
          if (has("giving")) parts.push(parts.length ? "Giving only your funds" : "Giving shows only your funds");
          return TOUR_joinList(parts) + ".";
        }
        if (ctx.pro) return `Your money, one tab each: ${TOUR_joinList(money.map((k) => TOUR_MONEY_PRO[k]))}.`;
        return `Your money, one tab each: ${TOUR_joinList(money.map((k) => TOUR_CLIENT_LABELS[k]))}, kept up to date by your bookkeeper.`;
      },
    },
    {
      id: "payroll",
      when: () => has("payroll"),
      go: open("payroll"),
      targets: ["#cf-tab-payroll"],
      title: "Payroll",
      body: () =>
        money.length
          ? "Your payroll runs and reports, from your payroll add-on."
          : "Finances holds Payroll: your payroll runs and reports, from your payroll add-on.",
    },
    {
      id: "reports",
      when: () => has("reports"),
      go: open("reports"),
      targets: ["#cr-tab-downloads"],
      strip: true,
      title: "Reports",
      body: () => {
        const dl = "Download your financial statements under Downloads.";
        if (ctx.pro) return dl + " Board packet builds one PDF for your board.";
        // On Pro, with Pro pages turned off for this person.
        if (ctx.plan === "premium") return dl + " Board packet, one PDF for your board, isn't turned on for you. Ask your bookkeeper if you need it.";
        return dl + " Board packet, one PDF for your board, comes with Pro.";
      },
    },
    {
      id: "documents",
      when: () => has("documents"),
      go: open("documents"),
      targets: ["doc-upload"],
      title: "Documents",
      body: () =>
        "When your bookkeeper asks for something, like a bank statement or a receipt, upload it here. You'll see a reminder until it's in.",
    },
    {
      id: "messages",
      when: () => has("messages"),
      go: open("messages"),
      targets: ["#cm-tab-conversation"],
      strip: true,
      title: "Messages",
      body: () =>
        "Ask your bookkeeper anything, any time, and you'll get an email when they reply. Requests, the next tab, lists what they've asked you for.",
    },
    {
      id: "settings",
      go: settings("profile"),
      targets: ["#st-tab-profile"],
      press: true,
      title: "Settings",
      body: () => "Your profile and which emails you get from the portal. Settings is always under the gear.",
    },
    {
      id: "organization",
      when: (c) => !!c.canEditOrg,
      go: settings("organization"),
      // Staff previewing get no Organization tab (it's the client's own),
      // so the step is centered for them.
      targets: ctx.preview ? undefined : ["#st-tab-organization"],
      press: true,
      title: "Your organization",
      body: () =>
        "Your organization's details, who gets the monthly summary, and your team. Ask us to add someone when a teammate needs access.",
    },
    {
      id: "plan",
      when: () => full,
      go: settings("plan"),
      targets: ["#st-tab-plan"],
      press: true,
      title: "Your plan",
      body: () => {
        const payroll = has("payroll") ? "" : ctx.plan === "premium" ? " Add Payroll is here too." : ", or Add Payroll";
        return ctx.plan === "premium"
          ? "Your plan and add-ons." + payroll
          : `See what Pro adds, then Upgrade to Pro${payroll} when you're ready.`;
      },
    },
    {
      id: "done",
      title: "You're all set",
      body: () =>
        full
          ? "A short setup checklist is waiting on Home. " + restart
          : "Need something you can't see? Message your bookkeeper. " + restart,
    },
  ];
}

// The steps this person will see: centered steps always; a step on another
// page (`go`) when `when(ctx)` says it applies, since its target only
// renders once that page opens; a Home step only when its target is on the
// page now.
function TOUR_visibleClientSteps(steps, ctx) {
  return steps.filter(
    (s) => (!s.when || s.when(ctx)) && (!s.targets || (s.go && !s.home) || s.targets.some((k) => TOUR_find(k))),
  );
}

// ---------------------------------------------------------------------------
// Staff tour steps
// ---------------------------------------------------------------------------
function TOUR_isMac() {
  try {
    return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || "");
  } catch (e) {
    return false;
  }
}

// ["Today", "Inbox", "Work"] -> "Today, Inbox and Work"
function TOUR_joinList(items) {
  const a = (items || []).filter(Boolean);
  if (a.length < 2) return a.join("");
  return a.slice(0, -1).join(", ") + " and " + a[a.length - 1];
}

// "2026-10-09T16:30:00Z" -> "4:30 PM today", "4:30 PM tomorrow", "Thursday
// 4:30 PM", or with the date when it's more than a week away. For the
// temporary admin tour, which says when the access ends.
function TOUR_fmtUntil(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || isNaN(d.getTime())) return "";
  try {
    const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    const dayStart = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const days = Math.round((dayStart(d) - dayStart(new Date())) / 864e5);
    if (days === 0) return time + " today";
    if (days === 1) return time + " tomorrow";
    const weekday = d.toLocaleDateString(undefined, { weekday: "long" });
    if (days > 1 && days < 7) return weekday + " " + time;
    return weekday + ", " + d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + ", " + time;
  } catch (e) {
    return "";
  }
}

// The basics every staffer needs: the places, ⌘K and the "?" menu. The
// bookkeeper tour has all three; the admin tour adds them for a brand-new
// admin (ctx.newToStaff). `drawer` marks a target that lives in the phone
// drawer, so the overlay opens it before looking.
function TOUR_placesStep(ctx) {
  const list = ctx.places && ctx.places.length ? ctx.places : ["Today", "Inbox", "Work", "Clients", "Team"];
  const places = TOUR_joinList(list);
  return {
    id: "places",
    targets: ["staff-nav", "staff-nav-today"],
    drawer: true,
    title: list.length === 5 ? "Your five places" : "Your places",
    body: (key) =>
      key === "staff-nav"
        ? `${places}. Everything you do lives in one of them, and Settings sits at the bottom.`
        : `${places} are in this menu. Everything you do lives in one of them.`,
  };
}

function TOUR_searchStep(go) {
  const kbd = TOUR_isMac() ? "⌘K" : "Ctrl+K";
  return {
    id: "search",
    go,
    targets: ["tb-search"],
    title: "Jump anywhere",
    body: () =>
      `Press ${kbd} to find a client, task or SOP, or to jump to any page. With nothing typed it lists every page and action.`,
  };
}

function TOUR_helpStep() {
  return {
    id: "help",
    targets: ["tb-help"],
    title: "Help, feedback and these tours",
    body: () => "The ? button has help for the page you're on, Send feedback, the staff guide and these tours.",
  };
}

// Can the viewer open this place? ctx.placeKeys comes from NAV_visiblePlaces
// ("View as" hides Inbox, Work and Team).
function TOUR_hasPlace(place, ctx) {
  return !ctx || !Array.isArray(ctx.placeKeys) || ctx.placeKeys.indexOf(place) !== -1;
}

// Is this Team (or Work) tab one the viewer can open? Role-tour steps on a
// tab the build or the person doesn't have are left out. Admin tabs show
// for admins and temporary admins alike (ctx.showsAdminPages, the same test
// the tab row uses); a step that needs a real admin also checks ctx.isAdmin.
function TOUR_hasTab(place, tab, ctx) {
  if (typeof NAV_visibleTabs !== "function" || !TOUR_hasPlace(place, ctx)) return false;
  return NAV_visibleTabs(place, { isAdmin: !!(ctx && ctx.showsAdminPages) }).some((t) => t.key === tab);
}

function TOUR_go(place, tab) {
  return () => {
    if (typeof NAV_go === "function") NAV_go(place, tab);
  };
}

// Opens a client's Overview the way a row on the Clients page links to it:
// the #/client/<id>/overview route, which App's hashchange listener turns
// into a client switch (or just the page, when that client is already
// open). A client the viewer can't see is ignored there.
function TOUR_openClient(id) {
  return () => {
    if (!id) return;
    const next = "#/client/" + encodeURIComponent(id) + "/overview";
    if (window.location.hash !== next) window.location.hash = next;
  };
}

// A step that opens a Work or Team tab and points at it.
function TOUR_tabStep(place, tab, title, body, when) {
  return {
    id: place + "-" + tab,
    when: (c) => TOUR_hasTab(place, tab, c) && (!when || when(c)),
    go: TOUR_go(place, tab),
    targets: ["#" + (place === "work" ? "wk" : "tp") + "-tab-" + tab],
    title,
    body: typeof body === "function" ? body : () => body,
  };
}

// Bookkeeper tour: a bookkeeper's day, about three minutes (owner request
// 2026-10-09; it replaced the short generic staff tour, and "staff" still
// starts it). Each step opens its page first (`go`). Admins can run it from
// the menu; during "View as" it shows what that bookkeeper sees, so steps on
// a place they can't open (Inbox, Work, Team) are left out. `wait` keeps a
// step whose target may still be loading; `spot: "top"` lights up only the
// top of a tall target.
function TOUR_bookkeeperSteps(ctx) {
  const today = () => {
    if (ctx.onSelectPage) ctx.onSelectPage("today");
  };
  const client = ctx.myClient;
  const openClient = TOUR_openClient(client && client.id);
  const next = ctx.amCount && !ctx.impersonating ? " The Account manager tour is next." : "";
  const temp = ctx.tempAdmin && !ctx.impersonating ? " While your temporary admin access lasts, the Temporary admin tour shows what it opens." : "";
  return [
    {
      id: "welcome",
      title: ctx.firstName ? `Welcome, ${ctx.firstName}` : "Welcome to MyGoodBooks",
      // Names only the places this person has ("View as" hides Inbox, Work
      // and Team).
      body: () => {
        const parts = [
          ["today", "Today"],
          ["clients", "your clients"],
          ["inbox", "the Inbox"],
          ["work", "Work"],
          ["team", "Team"],
        ]
          .filter(([key]) => !ctx.placeKeys || TOUR_hasPlace(key, ctx))
          .map(([, label]) => label);
        return `This tour walks through a bookkeeper's day: ${TOUR_joinList(parts)}. About three minutes.`;
      },
    },
    TOUR_placesStep(ctx),
    {
      id: "today",
      go: today,
      targets: ["today-list"],
      wait: true,
      spot: "top",
      title: "Start with Today",
      body: () => "What needs you across your clients, most urgent first. Click a row to go straight to it.",
    },
    {
      id: "clients",
      when: (c) => TOUR_hasPlace("clients", c),
      go: TOUR_go("clients"),
      targets: ["clients-filters"],
      title: "Your clients",
      body: () =>
        "Clients opens on Mine, the clients you look after. Health and Hours this month show at a glance. Hours come from QuickBooks Time, so there's nothing to log here. Click a client to open it.",
    },
    {
      id: "client",
      when: (c) => !!c.myClient,
      go: openClient,
      targets: ["#client-tab-client-overview", "client-overview"],
      title: "A client's Overview",
      body: () =>
        (client && client.name ? `This is ${client.name}'s Overview` : "This is the client's Overview") +
        ": the month-end close checklist, document requests, key dates and coverage. The SOP tab says how this client's books are done.",
    },
    {
      id: "quick",
      when: (c) => !!c.myClient,
      go: openClient,
      targets: ["tb-quick"],
      title: "Add something for this client",
      body: () => "With a client open, the + button adds a New task, a New note or a Request document for them, or starts a Message.",
    },
    {
      id: "inbox",
      when: (c) => TOUR_hasPlace("inbox", c),
      go: TOUR_go("inbox"),
      targets: ["inbox-list"],
      wait: true,
      title: "Inbox",
      body: () =>
        "Client messages land here. Reply sends to the client; Note stays inside the team. Aim to reply within 24 hours.",
    },
    TOUR_tabStep("work", "tasks", "Work › Tasks", "Your tasks, notes and SOPs, in one place."),
    TOUR_tabStep(
      "work",
      "close",
      "Work › Close",
      "Month-end close: one row per client, one column per month. Click a cell to mark it Done. Deadlines, the next tab, lists 990s, 1099s and other dates.",
    ),
    TOUR_tabStep(
      "team",
      "people",
      "Team › People",
      "Who's out and who's covering. Add your own time off here and pick a backup for your clients.",
    ),
    TOUR_tabStep(
      "team",
      "reviews",
      "Team › Reviews",
      "Your quarterly review: fill in your self-review when a cycle opens, then meet your account manager and both sign. Performance, next to it, shows your score out of 100.",
    ),
    TOUR_searchStep(today),
    TOUR_helpStep(),
    {
      id: "done",
      title: "You're ready",
      body: () =>
        "Take this tour again any time from the ? menu. The Bookkeeper guide in the staff guide has a daily routine." + next + temp,
    },
  ];
}

// Admin tour: the pages only admins see, about two minutes. Each step opens
// its page first (`go`), so the spotlight lands on the real tab. A brand-new
// admin (no staff or bookkeeper tour yet) gets the basics first: the
// places, ⌘K and the "?" menu.
function TOUR_adminSteps(ctx) {
  const team = (tab, title, body) => TOUR_tabStep("team", tab, title, body);
  const basics = ctx.newToStaff ? [TOUR_placesStep(ctx), TOUR_searchStep(), TOUR_helpStep()] : [];
  return [
    {
      id: "welcome",
      title: "The admin tour",
      body: () =>
        ctx.newToStaff
          ? "As an admin you see more than a bookkeeper: people, hours, money and the firm's settings. First the basics of getting around, then each of those pages in turn. About three minutes."
          : "As an admin you see more than a bookkeeper: people, hours, money and the firm's settings. This tour opens each of those pages in turn. About two minutes.",
    },
    ...basics,
    team(
      "members",
      "Team › Members",
      "Add staff, set roles, assign clients, give temporary admin access, and use View as to see exactly what a bookkeeper sees. Every View as is in the Audit log.",
    ),
    team(
      "hours",
      "Team › Hours",
      "Hours and tasks by person and by client, monthly hours budgets and capacity. Click a client or a person for fees, cost and margin.",
    ),
    team("reply-times", "Team › Reply times", "How fast clients hear back, by person, against the 24-hour goal."),
    team("performance", "Team › Performance", "Every bookkeeper's score out of 100. Admins see the full ranking; bookkeepers see only their own."),
    team(
      "reviews",
      "Team › Reviews",
      "Run the quarterly reviews: Team status › Open a review cycle, pick who's reviewed and their reviewer (Jesse by default).",
    ),
    team("feedback", "Team › Feedback", "Bug reports and ideas from staff and clients. Only admins see all of it."),
    team("inventory", "Team › Inventory", "Admins also get Requests, Items, a Roster of who's missing what, the staff Directory and Export to Google Sheet."),
    {
      id: "firm",
      when: (c) => c.isAdmin,
      go: () => {
        if (ctx.onSelectPage) ctx.onSelectPage("settings");
      },
      targets: ["#st-tab-firm"],
      press: true,
      title: "Settings › Firm settings",
      body: () =>
        "The firm-wide pages: Task templates, Client roster (where a new client is added), Emails, QuickBooks usage, Usage stats, the Audit log and Developer tools.",
    },
    {
      id: "today",
      go: () => {
        if (ctx.onSelectPage) ctx.onSelectPage("today");
      },
      targets: ["today-list"],
      spot: "top",
      title: "Your Today, admin edition",
      body: () =>
        "Today covers every client you can open, and admins can open them all: access and upgrade requests, clients at risk, and birthdays and work anniversaries a week ahead. Also show › Milestones adds pricing milestones to review.",
    },
    {
      id: "done",
      title: "That's the admin side",
      body: () =>
        (ctx.amCount ? "Next time you sign in you'll get the account manager tour, or start it now from the ? menu. " : "") +
        "The written version is in the staff guide: search for “admin guide”.",
    },
  ];
}

// Temporary admin tour: what a temporary admin grant (Team › Members, 1 hour
// to 1 week) opens for a bookkeeper, about a minute. Each stop is left out
// when its tab isn't there for this person. Data scope doesn't change: Reply
// times shows their own replies, Feedback (RLS) only what they sent, Hours
// has no money figures and Members is read-only.
function TOUR_tempAdminSteps(ctx) {
  const until = TOUR_fmtUntil(ctx.tempAdminUntil);
  const team = (tab, title, body) => TOUR_tabStep("team", tab, title, body);
  return [
    {
      id: "welcome",
      title: "Temporary admin access",
      body: () =>
        (until ? `Until ${until}, you can open some admin pages.` : "For now, you can open some admin pages.") +
        " Here's what's new. About a minute.",
    },
    team("hours", "Team › Hours", "Hours and tasks by person and by client, and each client's hours budget. Fees and margin stay with admins."),
    team("reply-times", "Team › Reply times", "How fast clients hear back, against the 24-hour goal. You see your own replies and your own clients."),
    team("feedback", "Team › Feedback", "Bug reports and ideas. You can read the ones you sent yourself; the full list stays with admins."),
    team("members", "Team › Members", "The staff list, with roles and who works on which client. It's read-only for you."),
    {
      id: "firm",
      when: (c) => !!c.showsAdminPages,
      go: () => {
        if (ctx.onSelectPage) ctx.onSelectPage("settings");
      },
      targets: ["#st-tab-firm"],
      press: true,
      title: "Settings › Firm settings",
      body: () => "Task templates, Client roster, Usage stats and Developer tools.",
    },
    {
      id: "done",
      title: "It ends by itself",
      body: () =>
        (until ? `Your access ends ${until}, and these pages go away on their own.` : "When your access ends, these pages go away on their own.") +
        " Emails, QuickBooks usage, the Audit log and money figures stay with admins. Run this tour again from the ? menu while your access lasts.",
    },
  ];
}

// Account manager tour: the client's main contact. Owner, 2026-10-09: the
// account manager does every bookkeeper's review, answers client messages,
// sets up new clients, watches client health and handles plans and
// upgrades. Admin-only stops are left out for an account manager who
// isn't an admin.
function TOUR_amSteps(ctx) {
  const n = ctx.amCount || 0;
  return [
    {
      id: "welcome",
      title: "The account manager tour",
      body: () =>
        `You're the main contact for ${n === 1 ? "1 client" : n + " clients"}. They see you on their Home as their account manager. This tour covers reviews, messages, new clients, health and plans.`,
    },
    {
      id: "reviews",
      when: (c) => TOUR_hasTab("team", "reviews", c),
      go: TOUR_go("team", "reviews"),
      targets: ["#tp-tab-reviews"],
      title: "You do the bookkeeper reviews",
      body: () =>
        "Each quarter you review every bookkeeper. When a cycle opens you get an email; fill each one in under Reviews I'm giving, then meet, agree on action steps and both sign.",
    },
    {
      id: "inbox",
      targets: ["staff-nav-inbox"],
      drawer: true,
      title: "Client messages",
      body: () =>
        "When one of your clients writes, you get the email and it lands in Inbox. Reply here, in the portal, so the client sees it and it counts toward reply times.",
    },
    {
      id: "reply-times",
      when: (c) => TOUR_hasTab("team", "reply-times", c),
      go: TOUR_go("team", "reply-times"),
      targets: ["#tp-tab-reply-times"],
      title: "Reply times",
      body: () => "How fast clients hear back, by person, against the 24-hour goal. A slow week shows here before a client mentions it.",
    },
    {
      id: "health",
      go: TOUR_go("clients"),
      targets: ["clients-filters"],
      title: "Client health check-ins",
      body: () =>
        "Needs attention picks out clients with health at risk, a late close, an access request or a stale SOP. The Health and Hours this month columns show the rest; the reasons are on each client's Overview.",
    },
    {
      id: "requests",
      go: () => {
        if (ctx.onSelectPage) ctx.onSelectPage("today");
      },
      targets: ["today-list"],
      spot: "top",
      title: "Plans and upgrades",
      body: () =>
        "Upgrade and Add Payroll requests from a client's Plan tab show on Today. Follow up, then mark each one Contacted, Completed or Dismiss. Also show › Milestones lists pricing milestones to confirm.",
    },
    {
      id: "profit",
      when: (c) => c.isAdmin && TOUR_hasTab("team", "hours", c),
      go: TOUR_go("team", "hours"),
      targets: ["#tp-tab-hours"],
      title: "Fees and hours",
      body: () =>
        "A client's fee follows their confirmed pricing milestone. Team › Hours shows each client's hours against budget; click a client for fees, cost and margin, and see who has outgrown their plan.",
    },
    {
      id: "new-client",
      when: (c) => c.isAdmin,
      go: () => {
        if (ctx.onSelectPage) ctx.onSelectPage("settings");
      },
      targets: ["#st-tab-firm"],
      press: true,
      title: "New clients",
      body: () =>
        "A new client starts in Firm settings › Client roster: name, type, plan, bookkeeper and account manager. Then set their hours budget and confirm their pricing milestone on the Client overview.",
    },
    {
      id: "done",
      title: "You're set",
      body: () =>
        "The full checklist, step by step, is in the staff guide: search for “account manager”. Take this tour again from the ? menu.",
    },
  ];
}

// The staff-side tours, in menu order: the "?" menu, ⌘K and Settings › Help
// list the available ones through TOUR_staffTourList. `available` decides
// who can take each; `pending(ctx, saved)` (default: no saved status)
// decides whether it starts on its own, in TOUR_STAFF_AUTO_ORDER, one per
// page load. `saveExtra(ctx)` adds fields to the saved { status, at }, from
// the ctx the tour started with. `sub` is a string or a function of ctx.
const TOUR_STAFF_TOURS = [
  {
    key: "bookkeeper",
    setting: "bookkeeperTour",
    label: "Bookkeeper tour",
    // During "View as" the Inbox, Work and Team stops are left out.
    sub: (ctx) => (ctx.impersonating ? "Their day: Today, their clients and a client's pages" : "Your day: Today, your clients, Inbox, Work and Team"),
    // Everyone, admins too (during "View as" it previews what that
    // bookkeeper sees), but it only starts by itself for a bookkeeper. A
    // new setting key, so bookkeepers who did the old staff tour get it once.
    available: () => true,
    pending: (ctx, saved) => !!ctx.isBookkeeper && !saved.status,
    steps: (ctx) => TOUR_bookkeeperSteps(ctx),
  },
  { key: "admin", setting: "adminTour", label: "Admin tour", sub: "The pages only admins see", available: (ctx) => ctx.isAdmin && !ctx.impersonating, steps: (ctx) => TOUR_adminSteps(ctx) },
  {
    key: "tempAdmin",
    setting: "tempAdminTour",
    label: "Temporary admin tour",
    sub: "What your temporary admin access opens",
    available: (ctx) => !!ctx.tempAdmin && !ctx.impersonating,
    // Once per grant: a saved `until` that isn't this grant's expiry means
    // the tour ran for an earlier grant (or before one ended mid-tour), so
    // the access this person has now is a new one.
    pending: (ctx, saved) =>
      !saved.status || !saved.until || new Date(saved.until).getTime() !== new Date(ctx.tempAdminUntil).getTime(),
    saveExtra: (ctx) => ({ until: ctx.tempAdminUntil || null }),
    steps: (ctx) => TOUR_tempAdminSteps(ctx),
  },
  {
    key: "am",
    setting: "amTour",
    label: "Account manager tour",
    sub: "Reviews, client messages, new clients, health and plans",
    available: (ctx) => ctx.amCount > 0 && !ctx.impersonating,
    steps: (ctx) => TOUR_amSteps(ctx),
  },
];

// The order the tours start on their own in (the first pending one wins).
const TOUR_STAFF_AUTO_ORDER = ["tempAdmin", "bookkeeper", "admin", "am"];

// A tour by key; "staff" (the old generic tour) is the bookkeeper tour now.
function TOUR_staffTour(key) {
  const k = !key || key === "staff" ? "bookkeeper" : key;
  return TOUR_STAFF_TOURS.find((t) => t.key === k) || null;
}

// One staff tour starts by itself per page load. Kept outside TOUR_StaffRoot
// because it remounts (leaving "Preview as a client user", for one), which
// would otherwise let the next pending tour start in the same load.
let TOUR_staffAutoStarted = false;

// Holds an auto-started staff tour while Today's first sign-in prompt
// ("Welcome! Finish your profile", components/staff/Today.jsx) is open, or
// may be about to open: the staffer's profile, which decides that, is
// still loading (ST_profile, Settings.jsx; given up on after `tries`).
function TOUR_staffHold(email, tries) {
  if (document.getElementById("td-profile-title")) return true;
  const p = typeof ST_profile !== "undefined" && ST_profile ? ST_profile.state : null;
  return !!p && !!email && p.email === email && !p.loaded && tries < 15;
}

// Who's signed in, for the launchers. TOUR_StaffRoot keeps it current.
let TOUR_staffCtx = { isAdmin: false, isBookkeeper: false, tempAdmin: false, showsAdminPages: false, amCount: 0, impersonating: false };

// [{ key, label, sub }] of the tours this staffer can take, in menu order.
function TOUR_staffTourList() {
  return TOUR_STAFF_TOURS.filter((t) => t.available(TOUR_staffCtx)).map((t) => ({
    key: t.key,
    label: t.label,
    sub: typeof t.sub === "function" ? t.sub(TOUR_staffCtx) : t.sub,
  }));
}

// How many clients this person is the account manager for (window.CLIENTS is
// the roster index.html loads before the app, with accountManager on each).
function TOUR_amCount(email) {
  const e = String(email || "").trim().toLowerCase();
  if (!e || !Array.isArray(window.CLIENTS)) return 0;
  return window.CLIENTS.filter((c) => c && c.accountManager && String(c.accountManager.email || "").toLowerCase() === e).length;
}

// The client the bookkeeper tour opens: the first one this person can open
// whose assigned bookkeeper they are, else the first one they can open at
// all (an admin, or a bookkeeper covering someone else's). `clients` is
// App's visibleClients (window.CLIENTS without it), so the route the tour
// takes is never refused. { id, name } or null.
function TOUR_myClient(clients, email) {
  const list = (Array.isArray(clients) ? clients : Array.isArray(window.CLIENTS) ? window.CLIENTS : []).filter((c) => c && c.id);
  const e = String(email || "").trim().toLowerCase();
  const mine = e ? list.find((c) => c.assignedBookkeeper && String(c.assignedBookkeeper.email || "").toLowerCase() === e) : null;
  const c = mine || list[0];
  return c ? { id: c.id, name: c.name || "" } : null;
}

// The steps this staffer will see: centered, `wait` and `go` steps always
// (a `go` step's target only renders once its page opens), others only when
// one of their targets is on the page (so a build without, say, the ? menu
// just has one step fewer). `when(ctx)` drops a step that doesn't apply.
function TOUR_visibleStaffSteps(steps, ctx) {
  return steps.filter(
    (s) => (!s.when || s.when(ctx)) && (!s.targets || s.wait || s.go || s.targets.some((k) => TOUR_find(k) || (k.charAt(0) !== "#" && document.querySelector('[data-tour="' + k + '"]')))),
  );
}

// Where the popover goes, given the spotlight rect and the popover size.
function TOUR_place(rect, w, h) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const M = TOUR_MARGIN;
  const clampX = (x) => Math.max(M, Math.min(x, vw - w - M));
  const clampY = (y) => Math.max(M, Math.min(y, vh - h - M));
  if (!rect) return { top: clampY((vh - h) / 2), left: clampX((vw - w) / 2), side: "center" };
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  if (rect.below && rect.bottom + TOUR_GAP + h + M <= vh) return { top: rect.bottom + TOUR_GAP, left: clampX(cx - w / 2), side: "bottom" };
  if (rect.right + TOUR_GAP + w + M <= vw) return { top: clampY(cy - h / 2), left: rect.right + TOUR_GAP, side: "right" };
  if (rect.bottom + TOUR_GAP + h + M <= vh) return { top: rect.bottom + TOUR_GAP, left: clampX(cx - w / 2), side: "bottom" };
  if (rect.top - TOUR_GAP - h >= M) return { top: rect.top - TOUR_GAP - h, left: clampX(cx - w / 2), side: "top" };
  if (rect.left - TOUR_GAP - w >= M) return { top: clampY(cy - h / 2), left: rect.left - TOUR_GAP - w, side: "left" };
  // Nothing fits beside it (phone, tall target): pin to the bottom edge.
  return { top: vh - h - M, left: clampX((vw - w) / 2), side: "bottom-edge" };
}

// ---------------------------------------------------------------------------
// Spotlight + popover
// ---------------------------------------------------------------------------
function TOUR_Overlay({ steps, index, onBack, onNext, onSkip, onFinish, setMobileNavOpen }) {
  const step = steps[index];
  const total = steps.length;
  const isLast = index === total - 1;
  const [rect, setRect] = React.useState(null);
  const [targetKey, setTargetKey] = React.useState(null);
  const [pos, setPos] = React.useState(null);
  const [ready, setReady] = React.useState(false);
  const popRef = React.useRef(null);
  const titleRef = React.useRef(null);
  const elRef = React.useRef(null);
  const stepRef = React.useRef(step);
  stepRef.current = step;
  const drawerOpenedRef = React.useRef(false);
  const titleId = "tour-title";
  const bodyId = "tour-body";

  const measure = React.useCallback(() => {
    const el = elRef.current;
    if (!el || !el.isConnected) {
      setRect(null);
      return;
    }
    const s = stepRef.current;
    const box = TOUR_spotEl(el, s);
    const r = box.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Off screen or collapsed: center the popover instead.
    if (r.width === 0 || r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) {
      setRect(null);
      return;
    }
    // A tall target (a long list) gets a spotlight on its top part only.
    const height = s && s.spot === "top" ? Math.min(r.height, Math.round(vh * TOUR_SPOT_MAX)) : r.height;
    setRect({
      top: Math.max(0, r.top - TOUR_PAD),
      left: Math.max(0, r.left - TOUR_PAD),
      width: r.width + TOUR_PAD * 2,
      height: height + TOUR_PAD * 2,
      right: r.right + TOUR_PAD,
      bottom: r.top + height + TOUR_PAD,
      // A tab in a row of tabs (NAV_TabRow's .nav-tabs), or the row: the
      // popover goes below, clear of the other tabs. Settings' tabs stand
      // in a column, so theirs stays beside them.
      below: !!(box.closest && box.closest(".nav-tabs")),
    });
  }, []);

  // Find the target, open the phone drawer for drawer steps, scroll it into
  // view, then measure. A target that isn't there yet is looked for a few
  // more times before the popover is centered instead.
  React.useEffect(() => {
    let cancelled = false;
    let poll = 0;
    let key = null;
    let pressed = false;
    setReady(false);
    const targets = step.targets || [];
    // A role-tour step opens its page first; give it a moment to render.
    if (step.go) {
      try {
        step.go();
      } catch (e) {}
    }
    const find = () => {
      for (const k of targets) {
        const el = TOUR_find(k);
        if (el) return { el, key: k };
      }
      return { el: null, key: null };
    };
    const adopt = (f) => {
      key = f.key;
      elRef.current = f.el;
      setTargetKey(f.key);
    };
    adopt(find());
    // On a phone the sidebar tabs and the staff places sit in the off-canvas
    // drawer, which still gives rects when closed: find() can't tell, so
    // check the class. A row that only renders once the drawer is open isn't
    // found at all yet, so the step itself says it lives there.
    const needsDrawer = TOUR_inDrawerMode() && (elRef.current ? TOUR_inSidebar(elRef.current) : !!step.drawer);
    let wait = step.go ? 450 : 0;
    if (needsDrawer && !drawerOpenedRef.current) {
      setMobileNavOpen(true);
      drawerOpenedRef.current = true;
      wait = Math.max(wait, 280);
    } else if (!needsDrawer && drawerOpenedRef.current) {
      setMobileNavOpen(false);
      drawerOpenedRef.current = false;
      wait = Math.max(wait, 280);
    }
    const settle = () => {
      if (cancelled) return;
      if (!elRef.current || !elRef.current.isConnected) adopt(find());
      const el = elRef.current;
      // `press`: open the tab being pointed at (Settings' Firm settings).
      if (el && el.isConnected && step.press && !pressed) {
        pressed = true;
        try {
          el.click();
        } catch (e) {}
      }
      if (el && el.isConnected) {
        try {
          TOUR_scrollIntoView(TOUR_spotEl(el, step), step, key);
        } catch (e) {}
      }
      measure();
    };
    // The drawer slides in; measure again once it has settled.
    const sidebar = wait ? document.querySelector(".sidebar") : null;
    if (sidebar) sidebar.addEventListener("transitionend", settle);
    const t2 = wait ? setTimeout(settle, 650) : 0;
    const t = setTimeout(() => {
      if (cancelled) return;
      settle();
      if (elRef.current || !targets.length) {
        setReady(true);
        return;
      }
      let tries = 0;
      poll = setInterval(() => {
        if (cancelled) return;
        tries += 1;
        const f = find();
        if (!f.el && tries < TOUR_FIND_TRIES) return;
        clearInterval(poll);
        poll = 0;
        if (f.el) adopt(f);
        settle();
        setReady(true);
      }, TOUR_FIND_EVERY_MS);
    }, wait);
    return () => {
      cancelled = true;
      clearTimeout(t);
      clearTimeout(t2);
      if (poll) clearInterval(poll);
      if (sidebar) sidebar.removeEventListener("transitionend", settle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, step.id]);

  // Close the drawer if the tour opened it.
  React.useEffect(
    () => () => {
      if (drawerOpenedRef.current) setMobileNavOpen(false);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Follow the target on scroll and resize.
  React.useEffect(() => {
    let raf = 0;
    const onMove = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        measure();
      });
    };
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [measure]);

  // Place the popover once its size is known.
  React.useLayoutEffect(() => {
    const pop = popRef.current;
    if (!pop) return;
    setPos(TOUR_place(rect, pop.offsetWidth, pop.offsetHeight));
  }, [rect, index, ready]);

  // Focus the popover heading on each step.
  React.useEffect(() => {
    if (ready && titleRef.current) {
      try {
        titleRef.current.focus({ preventScroll: true });
      } catch (e) {}
    }
  }, [ready, index]);

  // Keyboard: Esc skips, arrows move, Tab stays inside the popover.
  React.useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        isLast ? onFinish() : onSkip();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        isLast ? onFinish() : onNext();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (index > 0) onBack();
      } else if (e.key === "Tab" && popRef.current) {
        const f = Array.from(popRef.current.querySelectorAll("button:not([disabled]), [tabindex='-1']"));
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        const inside = popRef.current.contains(document.activeElement);
        if (e.shiftKey && (document.activeElement === first || !inside)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [index, isLast, onBack, onNext, onSkip, onFinish]);

  const body = step.body(targetKey);
  return ReactDOM.createPortal(
    <div className="tour-root">
      {/* Blocks clicks on the page while the tour is open. */}
      <div className={"tour-blocker" + (rect ? "" : " tour-dim")} aria-hidden="true" />
      {rect && (
        <div
          className="tour-spotlight"
          aria-hidden="true"
          style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
        />
      )}
      <div
        ref={popRef}
        className={"tour-pop" + (ready && pos ? " tour-pop-on" : "") + (pos ? " tour-pop-" + pos.side : "")}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        style={pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 }}
      >
        <div className="tour-step">
          Step {index + 1} of {total}
        </div>
        <h2 className="tour-title" id={titleId} ref={titleRef} tabIndex={-1}>
          {step.title}
        </h2>
        <p className="tour-body" id={bodyId}>
          {body}
        </p>
        <div className="tour-actions">
          {!isLast && (
            <button type="button" className="tour-btn tour-btn-link" onClick={onSkip}>
              Skip tour
            </button>
          )}
          <span className="tour-actions-spacer" />
          {index > 0 && (
            <button type="button" className="tour-btn tour-btn-ghost" onClick={onBack}>
              Back
            </button>
          )}
          <button type="button" className="tour-btn tour-btn-primary" onClick={isLast ? onFinish : onNext}>
            {isLast ? "Finish" : index === 0 ? "Start tour" : "Next"}
          </button>
        </div>
        <div className="tour-sr" aria-live="polite">
          {ready ? `Step ${index + 1} of ${total}: ${step.title}. ${body}` : ""}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// "Get set up" checklist (top of the client Dashboard)
// ---------------------------------------------------------------------------
function TOUR_Checklist({ items, onDismiss, previewing }) {
  const doneCount = items.filter((i) => i.done).length;
  const allDone = doneCount === items.length;
  return (
    <section className="card tour-check" aria-labelledby="tour-check-title">
      <div className="tour-check-head">
        <div>
          <h2 className="tour-check-title" id="tour-check-title">
            {allDone ? "You're all set up" : "Get set up"}
          </h2>
          <p className="tour-check-sub">
            {allDone
              ? "Nice work. You can close this card."
              : `${doneCount} of ${items.length} done.` + (previewing ? " Preview only, nothing is saved." : "")}
          </p>
        </div>
        <button type="button" className="tour-check-close" onClick={onDismiss} aria-label="Dismiss the setup checklist">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      <div
        className="tour-check-bar"
        role="progressbar"
        aria-label="Setup progress"
        aria-valuemin={0}
        aria-valuemax={items.length}
        aria-valuenow={doneCount}
      >
        <span style={{ width: (items.length ? (doneCount / items.length) * 100 : 0) + "%" }} />
      </div>
      <ul className="tour-check-list">
        {items.map((it) => (
          <li key={it.id}>
            <button type="button" className={"tour-check-item" + (it.done ? " is-done" : "")} onClick={it.onClick}>
              <span className="tour-check-box" aria-hidden="true">
                {it.done && (
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
                )}
              </span>
              <span className="tour-check-text">
                <span className="tour-check-label">{it.label}</span>
                <span className="tour-check-hint">{it.hint}</span>
              </span>
              <span className="tour-sr">{it.done ? "(done)" : "(not done)"}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Root: mounted once in App's <main>, just above the page content.
// ---------------------------------------------------------------------------
function TOUR_Root({
  client,
  access,
  page,
  onSelectPage,
  onOpenSettings,
  setMobileNavOpen,
  clientPortalUser,
  isStaffSession,
  isPreviewingUser,
  impersonating,
}) {
  const st = ST_useSettings();
  // Only a real client user, signed in as themselves, saves anything.
  const isRealClient = !!clientPortalUser && !isStaffSession && !impersonating && !isPreviewingUser;
  const email = clientPortalUser ? String(clientPortalUser.email || "").trim().toLowerCase() : null;
  const ownSettings = isRealClient && st.email === email;
  const saved = ownSettings && TOUR_isObj(st.settings && st.settings.tour) ? st.settings.tour : {};
  const s = (ownSettings && st.settings) || {};
  const [run, setRun] = React.useState(null); // { steps, index, persist }
  // Staff previewing: a checklist that lives only in this tab.
  const [previewChecklist, setPreviewChecklist] = React.useState(null); // null | { ticks: {} }
  const autoStarted = React.useRef(false);
  const returnFocus = React.useRef(null);
  const tabs = access && access.tabs;
  // Which version of the tour (and checklist) this person gets. Staff
  // previewing as a client user get that person's version.
  const ctx = TOUR_clientCtx(client, access, {
    onSelectPage,
    onOpenSettings,
    preview: !clientPortalUser && !!isPreviewingUser,
  });
  // Read when a tour starts or ends (after a delay), so it's always current.
  const ctxRef = React.useRef(ctx);
  ctxRef.current = ctx;

  const save = React.useCallback(
    (patch) => {
      if (isRealClient) ST_store.update({ tour: patch });
    },
    [isRealClient],
  );

  const begin = React.useCallback(
    (persist) => {
      returnFocus.current = document.activeElement;
      if (onSelectPage) onSelectPage("dashboard");
      // A restart keeps the old status (and the checklist) until it ends.
      if (persist && !saved.status) save({ status: "started", startedAt: new Date().toISOString() });
      // Let Home (its Needs-you card and Customize button) render first.
      setTimeout(() => {
        const c = ctxRef.current;
        setRun({ steps: TOUR_visibleClientSteps(TOUR_clientSteps(c), c), index: 0, persist, version: TOUR_clientVersion(c) });
      }, 350);
    },
    [onSelectPage, save, saved.status],
  );

  // First sign-in: start once settings have loaded and say it hasn't run.
  React.useEffect(() => {
    if (!isRealClient || autoStarted.current || run) return;
    if (!ownSettings || (st.status !== "ready" && st.status !== "local")) return;
    if (saved.status) return;
    // The flag is set when the timer fires, so a re-render that reschedules
    // this effect can't cancel the only start.
    const t = setTimeout(() => {
      if (autoStarted.current) return;
      autoStarted.current = true;
      begin(true);
    }, 600);
    return () => clearTimeout(t);
  }, [isRealClient, ownSettings, st.status, saved.status, run, begin]);

  // Manual start (Settings > Help, "Restart the tour").
  React.useEffect(() => {
    const onStart = () => {
      if (run) return;
      // Staff in the bookkeeper view (not previewing) have no client tour.
      if (isStaffSession && !isPreviewingUser) return;
      begin(isRealClient);
    };
    window.addEventListener(TOUR_START_EVENT, onStart);
    return () => window.removeEventListener(TOUR_START_EVENT, onStart);
  }, [run, isStaffSession, isPreviewingUser, isRealClient, begin]);

  // Leaving the client (or starting a preview) ends a running tour.
  const clientId = client && client.id;
  React.useEffect(() => {
    setRun(null);
    setPreviewChecklist(null);
  }, [clientId, isPreviewingUser]);

  // The checklist lives on Home ("dashboard"), which everyone has since the
  // 2026-10-08 redesign; the fallback to the page the app opened in its
  // place (saved as tour.home) is from before that.
  const hasDashboard = !!(tabs && tabs.has("dashboard"));
  const end = (status) => {
    const persist = run && run.persist;
    const home = hasDashboard ? undefined : page;
    setRun(null);
    // "client-pro-full", "client-limited", ...: Usage Stats groups on the
    // part before the ":" (tour-done / tour-skipped), so this is detail only.
    if (persist && window.MGB_track)
      window.MGB_track(status === "done" ? "tour-done" : "tour-skipped", "client-" + ((run && run.version) || TOUR_clientVersion(ctxRef.current)));
    if (persist) save({ status, endedAt: new Date().toISOString(), ...(home ? { home } : {}) });
    else if (!isRealClient && isPreviewingUser) setPreviewChecklist((p) => p || { ticks: {}, home });
    // Finished or skipped, back to Home, where the checklist shows (the tour
    // may have ended on another page).
    if (onSelectPage) onSelectPage("dashboard");
    const back = returnFocus.current;
    setTimeout(() => {
      if (back && back.isConnected && typeof back.focus === "function") {
        try {
          back.focus({ preventScroll: true });
        } catch (e) {}
      }
    }, 0);
  };

  // ---- checklist ----
  const ticks = isRealClient ? (TOUR_isObj(saved.checklist) ? saved.checklist : {}) : (previewChecklist && previewChecklist.ticks) || {};
  const tick = (id) => {
    if (isRealClient) save({ checklist: { [id]: true } });
    else setPreviewChecklist((p) => ({ ...(p || {}), ticks: { ...((p && p.ticks) || {}), [id]: true } }));
  };
  const notifySet = TOUR_isObj(s.notify) && TOUR_isObj(s.notify.email) && Object.keys(s.notify.email).length > 0;
  const items = [
    {
      id: "profile",
      label: "Add your profile details",
      hint: "Your name and phone number, so your bookkeeper knows how to reach you.",
      done: !!ticks.profile || !!(s.name || s.phone),
      onClick: () => {
        tick("profile");
        onOpenSettings && onOpenSettings("profile");
      },
    },
    {
      id: "notifications",
      label: "Review your notification emails",
      hint: "Choose which emails you get from the portal.",
      done: !!ticks.notifications || notifySet,
      onClick: () => {
        tick("notifications");
        onOpenSettings && onOpenSettings("notifications");
      },
    },
    // Only for someone who sees Settings › Organization (full access; not
    // a scoped person on Basic, whom resolveAccess counts as full).
    ...(ctx.canEditOrg
      ? [
          {
            id: "invite",
            label: "Invite a teammate",
            hint: "Ask us to add someone from your organization.",
            done: !!ticks.invite,
            onClick: () => {
              tick("invite");
              onOpenSettings && onOpenSettings("organization");
            },
          },
        ]
      : []),
    ...(tabs && tabs.has("documents")
      ? [
          {
            id: "document",
            label: "Upload your first requested document",
            hint: "Anything your bookkeeper has asked for shows up in Documents.",
            done: !!ticks.document,
            onClick: () => {
              tick("document");
              onSelectPage && onSelectPage("documents");
            },
          },
        ]
      : []),
    ...(tabs && tabs.has("messages")
      ? [
          {
            id: "message",
            label: "Send your bookkeeper a message",
            hint: "Say hello or ask a question.",
            done: !!ticks.message,
            onClick: () => {
              tick("message");
              onSelectPage && onSelectPage("messages");
            },
          },
        ]
      : []),
  ];
  const homePage = hasDashboard
    ? "dashboard"
    : (isRealClient ? saved.home : previewChecklist && previewChecklist.home) || "reports";
  const showChecklist =
    page === homePage &&
    !run &&
    (isRealClient ? !!saved.status && saved.status !== "started" && !saved.checklistDismissed : !!previewChecklist);

  return (
    <>
      {showChecklist && (
        <TOUR_Checklist
          items={items}
          previewing={!isRealClient}
          onDismiss={() => {
            if (isRealClient) save({ checklistDismissed: true });
            else setPreviewChecklist(null);
          }}
        />
      )}
      {run && run.steps.length > 0 && (
        <TOUR_Overlay
          steps={run.steps}
          index={run.index}
          setMobileNavOpen={setMobileNavOpen || (() => {})}
          onNext={() => setRun((r) => (r ? { ...r, index: Math.min(r.index + 1, r.steps.length - 1) } : r))}
          onBack={() => setRun((r) => (r ? { ...r, index: Math.max(r.index - 1, 0) } : r))}
          onSkip={() => end("skipped")}
          onFinish={() => end("done")}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Staff root: mounted once in App's <main> whenever the staff rail shows
// (not while previewing as a client user). Owns the staff tours' run state
// and their seen flags; TOUR_Overlay does the drawing.
//   staffUser                  the real signed-in staffer { email, name, role }
//   impersonating, viewAsUser  "View as": a boolean, and the bookkeeper being
//                              viewed as ({ email, name }) or null
//   hasTempAdminAccess,        a live temporary admin grant for a bookkeeper,
//   tempAdminAccessExpiresAt   and when it ends (App state, ISO string)
//   tempAdminLoaded            false until App has checked for that grant;
//                              a bookkeeper's auto-start waits for it
//   clients                    App's visibleClients (who the viewer can open)
// ---------------------------------------------------------------------------
function TOUR_StaffRoot({
  staffUser,
  impersonating,
  viewAsUser,
  isPreviewingUser,
  hasTempAdminAccess,
  tempAdminAccessExpiresAt,
  tempAdminLoaded,
  clients,
  page,
  onSelectPage,
  setMobileNavOpen,
}) {
  const st = ST_useSettings();
  const email = staffUser ? String(staffUser.email || "").trim().toLowerCase() : null;
  // Only a staffer signed in as themselves gets the auto-start and saves the
  // seen flag. ST_store is paused during "View as" and previews anyway, so a
  // tour started then just runs and remembers nothing.
  const isSelf = !!email && !impersonating && !isPreviewingUser;
  const ownSettings = isSelf && st.role === "staff" && st.email === email;
  const savedOf = (t) => (ownSettings && TOUR_isObj(st.settings && st.settings[t.setting]) ? st.settings[t.setting] : {});
  // staffUser.role is "bookkeeper" or "admin". isAdmin is a real admin only
  // (money, Members editing, Emails, the Audit log); a temporary admin grant
  // opens the admin tabs and Firm settings, so tab checks use showsAdminPages.
  const role = staffUser ? staffUser.role : null;
  const isAdmin = role === "admin";
  const isBookkeeper = role === "bookkeeper";
  const tempAdmin = isBookkeeper && !!hasTempAdminAccess;
  const showsAdminPages = (isAdmin || tempAdmin) && !impersonating;
  const amCount = TOUR_amCount(email);
  // "View as" shows what that bookkeeper sees: their places, their name and
  // one of their clients.
  const viewing = impersonating && viewAsUser ? viewAsUser : null;
  const navPlaces =
    typeof NAV_visiblePlaces === "function" ? NAV_visiblePlaces({ role, isAdmin: showsAdminPages, impersonating: !!impersonating }) : null;
  const firstName = String(((viewing || staffUser) && (viewing || staffUser).name) || "")
    .trim()
    .split(/\s+/)[0];
  const ctx = {
    isAdmin,
    isBookkeeper,
    tempAdmin,
    showsAdminPages,
    amCount,
    impersonating: !!impersonating,
    places: navPlaces ? navPlaces.map((p) => p.label) : null,
    placeKeys: navPlaces ? navPlaces.map((p) => p.key) : null,
    firstName,
    myClient: TOUR_myClient(clients, viewing ? viewing.email : email),
    // Never took the old staff tour or the bookkeeper tour, and the admin
    // tour (whose basics they'd have been offered) hasn't ended once, done
    // or skipped: the admin tour starts with the basics.
    newToStaff:
      ownSettings &&
      !(TOUR_isObj(st.settings && st.settings.staffTour) && st.settings.staffTour.status) &&
      !savedOf(TOUR_staffTour("bookkeeper")).status &&
      !savedOf(TOUR_staffTour("admin")).status,
    tempAdminUntil: tempAdmin ? tempAdminAccessExpiresAt || null : null,
  };
  TOUR_staffCtx = ctx;
  // Read when a tour starts or ends (after a delay), so it's always current.
  const ctxRef = React.useRef(ctx);
  ctxRef.current = ctx;
  // The first pending tour, in auto-start order, for the once-only start.
  const pending = ownSettings
    ? TOUR_STAFF_AUTO_ORDER.map(TOUR_staffTour).find(
        (t) => t && t.available(ctx) && (t.pending ? t.pending(ctx, savedOf(t)) : !savedOf(t).status),
      )
    : null;
  const [run, setRun] = React.useState(null); // { tour, steps, index, ctx }
  const returnFocus = React.useRef(null);

  // `auto`: an auto start, which waits while Today's profile prompt is open
  // (TOUR_staffHold), checking again every 400 ms.
  const begin = React.useCallback(
    (which, auto) => {
      const tour = TOUR_staffTour(which) || TOUR_STAFF_TOURS[0];
      returnFocus.current = document.activeElement;
      // The bookkeeper tour starts on Today, where its list lives. The role
      // tours open their own pages step by step.
      if (tour.key === "bookkeeper" && onSelectPage && page !== "today") onSelectPage("today");
      // Let Today (and the top bar) render first.
      let tries = 0;
      const launch = () => {
        // "View as" began while an auto start was held: drop it.
        if (auto && ctxRef.current.impersonating) return;
        if (auto && TOUR_staffHold(email, tries++)) {
          setTimeout(launch, 400);
          return;
        }
        // The ctx it starts with is kept: the temporary admin tour saves
        // the grant's expiry from it, even if the grant ends mid-tour.
        const full = { ...ctxRef.current, onSelectPage };
        const next = { tour, steps: TOUR_visibleStaffSteps(tour.steps(full), full), index: 0, ctx: full };
        // A tour started from the menu while an auto start was held wins.
        setRun((r) => (r && auto ? r : next));
      };
      setTimeout(launch, 350);
    },
    [page, onSelectPage, email],
  );

  // Once each: start the first pending tour when settings have loaded. One
  // per page load, so the admin tour waits for a sign-in after another one.
  // For a bookkeeper, not before App knows about a temporary admin grant
  // (that tour comes first).
  const pendingKey = pending ? pending.key : null;
  const waitForGrant = isBookkeeper && tempAdminLoaded === false;
  React.useEffect(() => {
    if (!ownSettings || TOUR_staffAutoStarted || run || !pendingKey || waitForGrant) return;
    if (st.status !== "ready" && st.status !== "local") return;
    // The flag is set when the timer fires, so a re-render that reschedules
    // this effect can't cancel the only start.
    const t = setTimeout(() => {
      if (TOUR_staffAutoStarted) return;
      TOUR_staffAutoStarted = true;
      begin(pendingKey, true);
    }, 600);
    return () => clearTimeout(t);
  }, [ownSettings, st.status, pendingKey, waitForGrant, run, begin]);

  // Manual start ("?" menu, ⌘K, Settings › Help). "staff" means the
  // bookkeeper tour; a tour this person can't take (any but the bookkeeper
  // tour during "View as") falls back to it.
  React.useEffect(() => {
    const onStart = (e) => {
      if (run || !staffUser) return;
      const tour = TOUR_staffTour(e && e.detail && e.detail.which);
      begin(tour && tour.available(ctxRef.current) ? tour.key : "bookkeeper");
    };
    window.addEventListener(TOUR_STAFF_START_EVENT, onStart);
    return () => window.removeEventListener(TOUR_STAFF_START_EVENT, onStart);
  }, [run, staffUser, begin]);

  // "View as", a preview or a different sign-in mid-tour ends it.
  React.useEffect(() => {
    setRun(null);
  }, [impersonating, isPreviewingUser, email]);

  const end = (status) => {
    const tour = (run && run.tour) || TOUR_STAFF_TOURS[0];
    setRun(null);
    if (ownSettings && window.MGB_track) window.MGB_track(status === "done" ? "tour-done" : "tour-skipped", tour.key);
    if (ownSettings)
      ST_store.update({
        [tour.setting]: {
          status,
          at: new Date().toISOString(),
          ...(tour.saveExtra ? tour.saveExtra((run && run.ctx) || ctxRef.current) : {}),
        },
      });
    const back = returnFocus.current;
    setTimeout(() => {
      if (back && back.isConnected && typeof back.focus === "function") {
        try {
          back.focus({ preventScroll: true });
        } catch (e) {}
      }
    }, 0);
  };

  if (!run || !run.steps.length) return null;
  return (
    <TOUR_Overlay
      steps={run.steps}
      index={run.index}
      setMobileNavOpen={setMobileNavOpen || (() => {})}
      onNext={() => setRun((r) => (r ? { ...r, index: Math.min(r.index + 1, r.steps.length - 1) } : r))}
      onBack={() => setRun((r) => (r ? { ...r, index: Math.max(r.index - 1, 0) } : r))}
      onSkip={() => end("skipped")}
      onFinish={() => end("done")}
    />
  );
}
