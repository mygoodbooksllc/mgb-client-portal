// ----------------------------------------------------------------------------
// Guided tours: one for new client users (owner request 2026-09-30), a
// short one for staff (navigation redesign, 2026-10-08), and two role tours
// on the staff side (owner request 2026-10-09): an admin tour of the pages
// only admins see, and an account manager tour for anyone who is a client's
// account manager (clients.account_manager_email; Jesse today).
//
// A spotlight tour: the page dims, the target element is cut out and
// highlighted, and a small popover explains it (title, a sentence or two,
// "Step 3 of 8", Back / Next / Skip tour). After the client tour a small
// "Get set up" checklist card sits at the top of the client Dashboard until
// dismissed (or the page the app opens instead, for someone without a
// Dashboard). The staff tour has no checklist.
//
// Targets are marked with data-tour="..." attributes:
//   Client tour (TOUR_Root)
//   customize        Customize dashboard button (WidgetDrawer.jsx)
//   milestone        the milestone pill heading the client sidebar (app.jsx)
//   nav-<tab key>    client sidebar tabs (app.jsx Sidebar): nav-dashboard,
//                    nav-bank, nav-receivables, nav-budget, nav-reports,
//                    nav-documents, nav-messages
//   settings         the sidebar Settings gear (app.jsx Sidebar)
//   Staff tour (TOUR_StaffRoot)
//   staff-nav        the rail's list of places (app.jsx StaffRail)
//   staff-nav-<key>  one place, in the rail and in the phone drawer (app.jsx
//                    StaffRail / Sidebar): today, inbox, work, clients, team
//   today-list       the ranked list on Today (components/staff/Today.jsx)
//   tb-search        the ⌘K search box (components/staff/TopBar.jsx)
//   tb-help          the "?" menu (components/staff/TopBar.jsx)
//   clients-filters  Mine / All / Needs attention (components/staff/ClientsPage.jsx)
//   #tp-tab-<key>    a Team tab, found by id (NAV_TabRow, idPrefix "tp")
//   #st-tab-firm     Settings' Firm settings tab, found by id (Settings.jsx)
// A role-tour step can `go` somewhere first (NAV_go to a place and tab) and
// `press` its target (click a Settings tab open) once it's found.
// A step whose target isn't on the page for this person (limited access, a
// tab not on their plan, a missing element) is left out of the tour. On a
// phone the client tabs and the staff places sit in the off-canvas drawer,
// which the overlay opens for those steps and closes again afterwards.
//
// State lives in the settings JSON of public.user_settings (supabase/
// user-settings.sql), written through ST_store (Settings.jsx), which also
// keeps the localStorage cache:
//   tour.status              "started" | "done" | "skipped"   (client tour)
//   tour.startedAt/endedAt   ISO timestamps
//   tour.checklist           { profile, notifications, invite, document, message: true }
//   tour.checklistDismissed  true once the card is closed
//   tour.home                where the checklist shows for someone with no
//                            Dashboard tab (Basic plan, limited access)
//   staffTour.status         "done" | "skipped"               (staff tour)
//   staffTour.at             ISO timestamp of that
//   adminTour, amTour        { status, at }, same shape   (role tours)
// The client tour starts on its own only for a signed-in client user who has
// no tour status yet. Never for staff, "View as", or "Preview as a client
// user". Staff previewing can start it from client Settings > Help to see
// what the client sees; ST_store is paused then, so nothing is saved.
// The staff tours start on their own once each, for a staffer signed in as
// themselves: on a page load, the first of staff, admin, account manager
// that applies to them and has no status yet (so never two in a row). They
// run again whenever something calls TOUR_startStaff(key) (the "?" menu,
// ⌘K and Settings › Help list the ones that apply, via TOUR_staffTourList).
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

// Starts a staff-side tour: "staff" (the default), "admin" or "am". The "?"
// menu, ⌘K and Settings call this; TOUR_StaffRoot listens.
function TOUR_startStaff(which) {
  try {
    window.dispatchEvent(new CustomEvent(TOUR_STAFF_START_EVENT, { detail: { which: which || "staff" } }));
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

// Step definitions. `targets` are tried in order; the first on the page wins.
// Steps without targets are centered (welcome, done).
function TOUR_steps(ctx) {
  const name = ctx.clientName || "your organization";
  return [
    {
      id: "welcome",
      title: "Welcome to your portal",
      body: () =>
        `This quick tour shows you around ${name}'s books and how to finish setting up your account. It takes about a minute.`,
    },
    {
      id: "dashboard",
      targets: ["customize", "nav-home"],
      title: "Home",
      body: (key) =>
        key === "customize"
          ? "Home starts with what needs you, then your financial snapshot. Use Customize dashboard to pick which cards show and put them in the order you like."
          : "Home starts with what needs you, then your financial snapshot, kept up to date by your bookkeeper.",
    },
    {
      id: "milestone",
      targets: ["milestone"],
      title: "Your milestone",
      body: () =>
        "Your organization card shows your milestone and plan. Open the milestone to see what's included and what's next.",
    },
    {
      id: "finances",
      targets: ["nav-finances"],
      title: "Finances",
      body: () =>
        "Budget, bank accounts, cash flow, giving and payroll live here, as tabs along the top of the page.",
    },
    {
      id: "reports",
      targets: ["nav-reports"],
      title: "Reports",
      body: () =>
        "Download your financial statements under Downloads. Board packet builds one PDF for your board.",
    },
    {
      id: "documents",
      targets: ["nav-documents"],
      title: "Documents",
      body: () =>
        "When your bookkeeper asks for something, like a bank statement or a receipt, upload it here. You'll see a reminder until it's in.",
    },
    {
      id: "messages",
      targets: ["nav-messages"],
      title: "Messages",
      body: () => "Talk to your bookkeeper here. Ask a question any time, and you'll get an email when they reply. Requests lists anything they've asked you for.",
    },
    {
      id: "settings",
      targets: ["settings"],
      title: "Settings",
      body: () =>
        ctx.fullAccess
          ? "Update your profile and email notifications, invite teammates under Organization, and see your plan."
          : "Update your profile and email notifications, and see your plan.",
    },
    {
      id: "done",
      title: "You're all set",
      body: () =>
        ctx.withChecklist
          ? "A short setup checklist is waiting at the top of the page. You can restart this tour any time from Settings, under Help."
          : "You can restart this tour any time from Settings, under Help.",
    },
  ];
}

// A rail place is visible when its page, or any of its tabs, is (CLIENT_PLACES).
function TOUR_navVisible(key, tabs) {
  const place = typeof CLIENT_PLACES !== "undefined" ? CLIENT_PLACES.find((p) => p.key === key) : null;
  if (!place) return tabs.has(key);
  return place.tabs ? place.tabs.some((t) => tabs.has(t)) : tabs.has(place.page);
}

// The steps this person will actually see: centered steps always, others
// only when one of their targets is on the page.
function TOUR_visibleSteps(ctx) {
  return TOUR_steps(ctx).filter(
    (s) =>
      !s.targets ||
      s.targets.some(
        (k) => (!k.startsWith("nav-") || !ctx.tabs || TOUR_navVisible(k.slice(4), ctx.tabs)) && document.querySelector('[data-tour="' + k + '"]'),
      ),
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

// Six short steps. `drawer` marks a target that lives in the phone drawer, so
// the overlay opens it before looking. `wait` keeps the step even when its
// target hasn't rendered yet (Today's list may still be loading when the tour
// starts); the overlay keeps looking for a moment. `spot: "top"` lights up
// only the top of a tall target.
function TOUR_staffSteps(ctx) {
  const places = TOUR_joinList(
    ctx.places && ctx.places.length ? ctx.places : ["Today", "Inbox", "Work", "Clients", "Team"],
  );
  const kbd = TOUR_isMac() ? "⌘K" : "Ctrl+K";
  return [
    {
      id: "welcome",
      title: ctx.firstName ? `Welcome, ${ctx.firstName}` : "Welcome to MyGoodBooks",
      body: () =>
        "Five places, one layout: every page is a title, one row of tabs and the content. This tour takes about a minute.",
    },
    {
      id: "places",
      targets: ["staff-nav", "staff-nav-today"],
      drawer: true,
      title: "Your five places",
      body: (key) =>
        key === "staff-nav"
          ? `${places}. Everything you do lives in one of them, and Settings sits at the bottom.`
          : `${places} are in this menu. Everything you do lives in one of them.`,
    },
    {
      id: "today",
      targets: ["today-list"],
      wait: true,
      spot: "top",
      title: "Start with Today",
      body: () => "One list of what needs you, most urgent first. Click a row to go straight to it.",
    },
    {
      id: "search",
      targets: ["tb-search"],
      title: "Jump anywhere",
      body: () =>
        `Press ${kbd} to find a client, task or SOP, or to jump to any page. With nothing typed it lists every page and action.`,
    },
    {
      id: "help",
      targets: ["tb-help"],
      title: "Help, feedback and this tour",
      body: () => "The ? button has help for the page you're on, a place to send feedback, and this tour.",
    },
    {
      id: "done",
      title: "You're ready",
      body: () => "Take this tour again any time from the ? menu. Have a good day.",
    },
  ];
}

// Is this Team (or Work) tab one the viewer can open? Role-tour steps on a
// tab the build or the person doesn't have are left out.
function TOUR_hasTab(place, tab, ctx) {
  if (typeof NAV_visibleTabs !== "function") return false;
  return NAV_visibleTabs(place, { isAdmin: !!ctx.isAdmin }).some((t) => t.key === tab);
}

function TOUR_go(place, tab) {
  return () => {
    if (typeof NAV_go === "function") NAV_go(place, tab);
  };
}

// Admin tour: the pages only admins see, about two minutes. Each step opens
// its page first (`go`), so the spotlight lands on the real tab.
function TOUR_adminSteps(ctx) {
  const team = (tab, title, body) => ({
    id: "team-" + tab,
    when: (c) => TOUR_hasTab("team", tab, c),
    go: TOUR_go("team", tab),
    targets: ["#tp-tab-" + tab],
    title,
    body: () => body,
  });
  return [
    {
      id: "welcome",
      title: "The admin tour",
      body: () =>
        "As an admin you see more than a bookkeeper: people, hours, money and the firm's settings. This tour opens each of those pages in turn. About two minutes.",
    },
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
    team("feedback", "Team › Feedback", "Bug reports and ideas from staff and clients. Only admins see this tab."),
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

// The staff-side tours, in the order they start on their own (one per page
// load). `available` decides who gets each; the "?" menu, ⌘K and Settings ›
// Help list the available ones through TOUR_staffTourList.
const TOUR_STAFF_TOURS = [
  { key: "staff", setting: "staffTour", label: "Take the tour", sub: "A quick walk through the staff side", available: () => true, steps: (ctx) => TOUR_staffSteps(ctx) },
  { key: "admin", setting: "adminTour", label: "Admin tour", sub: "The pages only admins see", available: (ctx) => ctx.isAdmin && !ctx.impersonating, steps: (ctx) => TOUR_adminSteps(ctx) },
  {
    key: "am",
    setting: "amTour",
    label: "Account manager tour",
    sub: "Reviews, client messages, new clients, health and plans",
    available: (ctx) => ctx.amCount > 0 && !ctx.impersonating,
    steps: (ctx) => TOUR_amSteps(ctx),
  },
];

// Who's signed in, for the launchers. TOUR_StaffRoot keeps it current.
let TOUR_staffCtx = { isAdmin: false, amCount: 0, impersonating: false };

// [{ key, label, sub }] of the tours this staffer can take, staff tour first.
function TOUR_staffTourList() {
  return TOUR_STAFF_TOURS.filter((t) => t.available(TOUR_staffCtx)).map((t) => ({ key: t.key, label: t.label, sub: t.sub }));
}

// How many clients this person is the account manager for (window.CLIENTS is
// the roster index.html loads before the app, with accountManager on each).
function TOUR_amCount(email) {
  const e = String(email || "").trim().toLowerCase();
  if (!e || !Array.isArray(window.CLIENTS)) return 0;
  return window.CLIENTS.filter((c) => c && c.accountManager && String(c.accountManager.email || "").toLowerCase() === e).length;
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
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Off screen or collapsed: center the popover instead.
    if (r.width === 0 || r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) {
      setRect(null);
      return;
    }
    // A tall target (a long list) gets a spotlight on its top part only.
    const s = stepRef.current;
    const height = s && s.spot === "top" ? Math.min(r.height, Math.round(vh * TOUR_SPOT_MAX)) : r.height;
    setRect({
      top: Math.max(0, r.top - TOUR_PAD),
      left: Math.max(0, r.left - TOUR_PAD),
      width: r.width + TOUR_PAD * 2,
      height: height + TOUR_PAD * 2,
      right: r.right + TOUR_PAD,
      bottom: r.top + height + TOUR_PAD,
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
          el.scrollIntoView({ block: key === "customize" ? "center" : "nearest", inline: "nearest" });
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
  const fullAccess = !!(access && access.isFullAccess);
  const tabs = access && access.tabs;

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
      // Let the Dashboard (and its Customize button) render first.
      setTimeout(() => {
        const steps = TOUR_visibleSteps({
          clientName: client && client.name,
          fullAccess,
          tabs,
          withChecklist: true,
        });
        setRun({ steps, index: 0, persist });
      }, 350);
    },
    [client, fullAccess, tabs, onSelectPage, save, saved.status],
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

  // The checklist lives on the Dashboard, or for someone without one (Basic
  // plan, limited access) on the page the app opened in its place.
  const hasDashboard = !!(tabs && tabs.has("dashboard"));
  const end = (status) => {
    const persist = run && run.persist;
    const home = hasDashboard ? undefined : page;
    setRun(null);
    if (persist && window.MGB_track) window.MGB_track(status === "done" ? "tour-done" : "tour-skipped", "client");
    if (persist) save({ status, endedAt: new Date().toISOString(), ...(home ? { home } : {}) });
    else if (!isRealClient && isPreviewingUser) setPreviewChecklist((p) => p || { ticks: {}, home });
    if (status === "done" && onSelectPage) onSelectPage("dashboard");
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
    ...(fullAccess
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
// (not while previewing as a client user). Owns the staff tour's run state
// and its seen flag; TOUR_Overlay does the drawing.
// ---------------------------------------------------------------------------
function TOUR_StaffRoot({ staffUser, impersonating, isPreviewingUser, page, onSelectPage, setMobileNavOpen }) {
  const st = ST_useSettings();
  const email = staffUser ? String(staffUser.email || "").trim().toLowerCase() : null;
  // Only a staffer signed in as themselves gets the auto-start and saves the
  // seen flag. ST_store is paused during "View as" and previews anyway, so a
  // tour started then just runs and remembers nothing.
  const isSelf = !!email && !impersonating && !isPreviewingUser;
  const ownSettings = isSelf && st.role === "staff" && st.email === email;
  const savedOf = (t) => (ownSettings && TOUR_isObj(st.settings && st.settings[t.setting]) ? st.settings[t.setting] : {});
  // Real admins only: temporary admin access doesn't open Members, Feedback
  // and the rest of what the admin tour shows.
  const isAdmin = !!staffUser && staffUser.role === "admin";
  const amCount = TOUR_amCount(email);
  const ctx = { isAdmin, amCount, impersonating: !!impersonating };
  TOUR_staffCtx = ctx;
  // The first tour that applies and hasn't run, for the once-only start.
  const pending = ownSettings ? TOUR_STAFF_TOURS.find((t) => t.available(ctx) && !savedOf(t).status) : null;
  const [run, setRun] = React.useState(null); // { tour, steps, index }
  const autoStarted = React.useRef(false);
  const returnFocus = React.useRef(null);

  const begin = React.useCallback(
    (which) => {
      const tour = TOUR_STAFF_TOURS.find((t) => t.key === which) || TOUR_STAFF_TOURS[0];
      returnFocus.current = document.activeElement;
      // The staff tour starts on Today, where its list lives. The role
      // tours open their own pages step by step.
      if (tour.key === "staff" && onSelectPage && page !== "today") onSelectPage("today");
      // Let Today (and the top bar) render first.
      setTimeout(() => {
        const places =
          typeof NAV_visiblePlaces === "function"
            ? NAV_visiblePlaces({
                role: staffUser && staffUser.role,
                isAdmin,
                impersonating: !!impersonating,
              }).map((p) => p.label)
            : null;
        const firstName = String((staffUser && staffUser.name) || "")
          .trim()
          .split(/\s+/)[0];
        const full = { places, firstName, isAdmin, amCount, onSelectPage };
        setRun({ tour, steps: TOUR_visibleStaffSteps(tour.steps(full), full), index: 0 });
      }, 350);
    },
    [staffUser, impersonating, page, onSelectPage, isAdmin, amCount],
  );

  // Once each: start the first pending tour when settings have loaded. One
  // per page load, so the admin tour waits for a sign-in after the staff one.
  const pendingKey = pending ? pending.key : null;
  React.useEffect(() => {
    if (!ownSettings || autoStarted.current || run || !pendingKey) return;
    if (st.status !== "ready" && st.status !== "local") return;
    // The flag is set when the timer fires, so a re-render that reschedules
    // this effect can't cancel the only start.
    const t = setTimeout(() => {
      if (autoStarted.current) return;
      autoStarted.current = true;
      begin(pendingKey);
    }, 600);
    return () => clearTimeout(t);
  }, [ownSettings, st.status, pendingKey, run, begin]);

  // Manual start ("?" menu, ⌘K, Settings › Help). A tour this person can't
  // take falls back to the staff tour.
  React.useEffect(() => {
    const onStart = (e) => {
      if (run || !staffUser) return;
      const which = e && e.detail && e.detail.which;
      const tour = TOUR_STAFF_TOURS.find((t) => t.key === which);
      begin(tour && tour.available(ctx) ? tour.key : "staff");
    };
    window.addEventListener(TOUR_STAFF_START_EVENT, onStart);
    return () => window.removeEventListener(TOUR_STAFF_START_EVENT, onStart);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, staffUser, begin, isAdmin, amCount, impersonating]);

  // "View as", a preview or a different sign-in mid-tour ends it.
  React.useEffect(() => {
    setRun(null);
  }, [impersonating, isPreviewingUser, email]);

  const end = (status) => {
    const tour = (run && run.tour) || TOUR_STAFF_TOURS[0];
    setRun(null);
    if (ownSettings && window.MGB_track) window.MGB_track(status === "done" ? "tour-done" : "tour-skipped", tour.key);
    if (ownSettings) ST_store.update({ [tour.setting]: { status, at: new Date().toISOString() } });
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
