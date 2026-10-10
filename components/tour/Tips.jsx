// ----------------------------------------------------------------------------
// Tips while you learn (owner request 2026-10-09): "when they click into a
// client highlight a part and give a tip of how to use certain features that
// they can dismiss ... or click into to get a deeper dive", for a staffer's
// first 30 days, "subtle and not intrusive or distracting".
//
// Not a tour (components/tour/Tour.jsx): nothing dims, nothing blocks the
// page, every click still reaches the app (the card itself is click-through
// except for its three controls), the page never scrolls and focus never
// moves. One small card at a time sits beside its target, which gets a soft
// thin ring (tips.css, class prefix ltip-; .mgb-tip is the title tooltip in
// components/ui/tooltips.css). Of the spots that fit (below, above, right,
// left, lined up with the ring's left or right edge) the card takes the one
// covering the fewest buttons, links, tabs and fields and the least of the
// top bars, the page's breadcrumb, title row and tab row, and keeps it while
// it shows; for a target up in those bars it hangs below, into the page
// (TIPS_position). It fades in over 150 ms (no fade with reduced motion).
// On a phone (< 640 px) it docks at the bottom (above a bottom tab bar, the
// chat button and the home indicator), or the top when the target sits down
// there (under the page's title and tab row while they show, and never over
// a field of the form the target is in); when neither fits, the tip waits
// for a later visit. Card: "Tip", one or two sentences, Learn more
// (#/help/<slug>, only when the viewer can read that article), Got it, and
// a small "Turn off tips". It's a role="note" that never takes focus; a
// polite live region reads "Tip: ..." once to screen readers.
//
// State lives in the settings JSON of public.user_settings, written through
// ST_store (Settings.jsx; update() deep-merges objects, so each write sends
// only the fields it changes):
//   tips.on         false once turned off (missing or true: on)
//   tips.startedAt  ISO; tips show until startedAt + TIPS_CONFIG.days. The
//                   first run for a staffer with no `tips` writes
//                   { on: true, startedAt: now }: a new hire's first sign-in,
//                   or launch day for everyone already on staff
//   tips.seen       { tipId: ISO } of tips dismissed; a seen tip never returns
//   tips.lastAt     ISO of the last tip shown or dismissed (the cooldown)
//   tips.day        { d: "YYYY-MM-DD" local, n: tips shown that day, ids:
//                   [tipIds counted that day] (a tip that comes back counts
//                   once) }
// The engine's own writes (first run, shown, seen) are quiet saves
// (ST_store.update(patch, { quiet: true })) and are skipped while the
// browser tab is hidden.
// Turning on (the switch, from off or after the days ran out) writes
// { on: true, startedAt: now, seen: {}, lastAt: null, day: null }: a fresh
// 30 days, every tip again. Turning off writes { on: false } and keeps the
// rest. The switch (TIPS_Switch) sits on the Help page's home, in Settings ›
// Help and in the top bar's ? menu (TIPS_menuItem); each tracks
// MGB_track("tips-on" | "tips-off", "help" | "settings" | "menu"), and the
// card's link tracks "tips-off" with "card". Learn more tracks
// MGB_track("tip-more", <tip id>).
//
// Who: a staffer signed in as themselves (TIPS_Root is mounted beside
// TOUR_StaffRoot in app.jsx, so never in the client portal or "Preview as a
// client user"); never during "View as". Nothing is shown or written while
// ST_store is paused or before settings have loaded from the server.
//
// When: a tip needs all of
//   - the page settled: TIPS_CONFIG.settleMs since the last route change,
//     scroll or click, and it keeps looking for TIPS_TRY_MS after that
//   - TIPS_CONFIG.graceMs since sign-in (this page load)
//   - TIPS_CONFIG.cooldownMs since the last tip was shown or went away, and
//     since a tour was last on screen; under TIPS_CONFIG.maxPerDay today
//   - no tip yet on this visit to the page (route = page + hash, so each
//     Work or Team tab is its own); the next waits for a later visit
//   - nothing busy: no tour open or about to start by itself
//     (TOUR_staffBusy), no modal, drawer, menu or popover open (TIPS_BUSY),
//     no text field focused, the browser tab visible
//   - its target on the page and fully in view, with room for the card
//     beside it
// The first catalog tip that passes wins.
// Seen (never comes back): Esc, Got it, Learn more, Turn off tips, or a
// click anywhere else (the click still goes through; a click that opens a
// menu or dialog counts too), and a route change or the target scrolling
// out of view once the tip has been up TIPS_READ_MS. Not seen (it can show
// on a later visit): a tour, modal, menu or focused field appearing without
// a click (it opened by itself, or from the keyboard such as Ctrl+K), the
// layout switching between phone and computer, the target leaving the page
// (a list reloading), or leaving the page or scrolling away sooner.
//
// TIPS_CATALOG entries:
//   id      stable key in tips.seen and tip-more tracking (no ':')
//   roles   "all" | "bookkeeper" (incl. temporary admins) | "admin" (a real
//           admin) | "adminPages" (admin or temporary admin) | "am" (an
//           admin who is a client's account manager, TOUR_amCount)
//   match   (route) => bool; route = { page: App's effectivePage, client:
//           true on a client's pages (html.staff-client-tabs) }. Work and
//           Team tabs are read from the selected tab (TIPS_tab)
//   target  a data-tour key or "#id" (TOUR_find), or a list tried in order
//   part    optional CSS selector (or list) inside the target to point at
//           instead, for a target that is large or can be taller than the
//           screen (the first match fully in view, else the first match)
//   snug    optional true: ring just what's inside the element (its
//           children and text together, TIPS_rect), for a label, heading
//           or row stretched wider than its contents
//   text    a string, or (env) => string with env { kbd: "⌘K" | "Ctrl+K",
//           touch }
//   slug    docs/staff-guide/<slug>.md for Learn more
//   adminDoc  true when that article is audience: admin (RLS hides it from
//           everyone but real admins), so Learn more shows only to them
//   ready   optional () => bool, an extra check (hover-only tips skip touch)
//
// Test knobs: window.TIPS_CONFIG is read each time it's used, so a harness
// can shorten it after load, e.g.
//   Object.assign(window.TIPS_CONFIG, { settleMs: 300, graceMs: 0, cooldownMs: 0, maxPerDay: 99 })
// Tips are on for a staffer with no `tips` key; "Reset local state" doesn't
// touch them (the user_settings row is authoritative).
//
// Loaded after Tour.jsx and before app.jsx in the shared global scope: every
// top-level name has a TIPS_ prefix, hooks are used as React.*, and
// Settings.jsx / Tour.jsx globals (ST_store, ST_useSettings, ST_Toggle,
// TOUR_find, TOUR_isMac, TOUR_touchOnly, TOUR_stickyTop, TOUR_stickyBottom,
// TOUR_amCount, TOUR_staffBusy) are only touched at run time.
// ----------------------------------------------------------------------------

window.TIPS_CONFIG = Object.assign(
  {
    settleMs: 1500, // quiet time after a route change, scroll or click
    graceMs: 3000, // nothing this soon after sign-in (page load)
    cooldownMs: 120000, // at most one new tip per 2 minutes
    maxPerDay: 4, // and 4 a day
    days: 30, // how long tips last after they start
  },
  window.TIPS_CONFIG || {},
);
const TIPS_DEFAULTS = { settleMs: 1500, graceMs: 3000, cooldownMs: 120000, maxPerDay: 4, days: 30 };
const TIPS_DAY_MS = 864e5;
const TIPS_TICK_MS = 300; // how often the engine looks
const TIPS_TRY_MS = 6000; // how long after settling it keeps looking for a target
const TIPS_PHONE_MAX = 640; // narrower than this, the card docks
const TIPS_GAP = 10; // card distance from the ring
const TIPS_MARGIN = 12; // card distance from the viewport edge and the bars
const TIPS_RING_PAD = 4; // ring distance from the target
const TIPS_AWAY_SHARE = 0.6; // less of the target than this in view: it's gone
const TIPS_READ_MS = 2000; // up this long, leaving the page or scrolling away counts as seen
// Dismissals that always mark a tip seen (see "Seen" above).
const TIPS_DISMISS = { got: true, esc: true, click: true, more: true, off: true };
// Something open that a tip mustn't sit on: modals (ModalShell and anything
// aria-modal), top-bar panels and menus, popovers (notes, the client
// portal's new-message popup, the onboarding checklist), the chat drawer,
// the phone nav drawer.
const TIPS_BUSY =
  ".tour-root, .modal-overlay, [aria-modal='true'], .tb-panel, [role='menu'], .notif-panel, .notif-popup, .inote-pop, .ob-pop, .si-drawer, .sidebar-scrim.visible, aside.sidebar.open";
// What the card shouldn't sit on when another side fits.
const TIPS_CONTROL =
  "a[href], button, input, select, textarea, summary, [role='tab'], [role='button'], [role='link'], [role='checkbox'], [role='switch'], [role='menuitem']";
// Nor, by area: the bars at the top, the page's header band (breadcrumb,
// title row, tab row) and any other heading or tab row.
const TIPS_HEAD =
  ".tb-bar, .mobile-topbar, .app-topbar, .page-header, .nav-tabs-row, [role='tablist'], h1, h2, .page-title, .cl-crumbs, nav[aria-label='Breadcrumb']";
// A target up here (the top bar, or the header band with the title, its
// actions and the tab row) gets its card below, hanging into the page.
const TIPS_HEADER = ".tb-bar, .mobile-topbar, .app-topbar";
// The floating chat button(s) a docked card stays above.
const TIPS_FAB = ".si-launcher, .chat-fab-wrap";
const TIPS_FIELD =
  "input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=reset]):not([type=range]):not([type=color]):not([type=file]), textarea, select, [contenteditable='true'], [contenteditable='']";

function TIPS_cfg(key) {
  const v = Number((window.TIPS_CONFIG || {})[key]);
  return isFinite(v) && v >= 0 ? v : TIPS_DEFAULTS[key];
}

function TIPS_isObj(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

// A Work or Team tab (NAV_TabRow ids wk-tab-<key>, tp-tab-<key>) is open.
function TIPS_tab(id) {
  const el = document.getElementById(id);
  return !!el && el.getAttribute("aria-selected") === "true";
}

function TIPS_touch() {
  return typeof TOUR_touchOnly === "function" && TOUR_touchOnly();
}

// ---------------------------------------------------------------------------
// Catalog, in priority order (the first eligible one on a page wins).
// ---------------------------------------------------------------------------
const TIPS_CATALOG = [
  {
    id: "am-today-upgrade",
    roles: "am",
    match: (r) => r.page === "today",
    target: "today-upgrade",
    // Its Contacted / Completed / Dismiss buttons, not the whole row.
    part: [".td-row-actions", ".td-row-main"],
    snug: true,
    text: "A client asked to upgrade or add Payroll. Follow up, then mark it Contacted or Completed, or Dismiss it, so it leaves everyone's Today.",
    slug: "account-manager-guide",
  },
  {
    id: "today-kpis",
    roles: "all",
    match: (r) => r.page === "today",
    target: "today-kpis",
    // The last tile, not the whole row of them: its card then hangs at the
    // right, clear of the first Needs you row's title.
    part: ".td-kpi:last-child",
    text: "The tiles in this row are shortcuts: Replies waiting opens Inbox, Closes open opens Work › Close, and Overdue jumps to the Now list.",
    slug: "home-page",
  },
  {
    id: "clients-mine",
    roles: "all",
    match: (r) => r.page === "clients",
    target: "clients-filters",
    text: "Mine also includes clients you're the backup for and ones an admin gave you access to, not only those assigned to you.",
    slug: "clients-page",
  },
  {
    id: "clients-health",
    roles: "all",
    match: (r) => r.page === "clients",
    target: "clients-health",
    text: "Hover a Health score to see what's costing it points. The same reasons are listed on the client's Overview.",
    slug: "client-health",
    // Hover only, and only once scores (not just the dots) have loaded.
    ready: () => !TIPS_touch() && !!document.querySelector(".cl-table .cl-score"),
  },
  {
    id: "ov-close-checklist",
    roles: "all",
    match: (r) => r.client && r.page === "client-overview",
    target: "ov-close",
    part: ".close-item", // the first step's checkbox and name, not the whole card
    snug: true,
    text: "Tick each close step as you finish it; it records who and when. This checklist and Work › Close are separate and don't update each other.",
    slug: "month-end-close",
  },
  {
    id: "ov-doc-requests",
    roles: "all",
    match: (r) => r.client && (r.page === "client-overview" || r.page === "documents"),
    target: "doc-requests",
    part: "h3",
    text: "The client sees these on their Documents page and uploads straight into them. Files go to the firm's Google Drive; Mark received closes one.",
    slug: "document-requests",
  },
  {
    id: "ov-coverage",
    roles: "all",
    match: (r) => r.client && r.page === "client-overview",
    target: "ov-coverage",
    part: "summary",
    text: "Set this client's backup under Edit dates and coverage. A backup doesn't get in automatically; they can request access, or an admin can give it.",
    slug: "time-off-coverage",
  },
  {
    id: "client-sop-fresh",
    roles: "all",
    match: (r) => r.client && r.page === "sop",
    target: "sop-fresh",
    part: ".sf-pill", // "Last reviewed …", not the whole bar
    text: "After 180 days an SOP shows as stale. Read it through; if it's still right, Mark as still accurate resets the clock.",
    slug: "client-sops",
  },
  {
    id: "inbox-loop-in",
    roles: "all",
    match: (r) => r.page === "inbox" || (r.client && r.page === "messages"),
    target: "inbox-loop-in",
    text: "Loop in emails the assigned bookkeeper and adds a staff-only note. @name in a Note does the same; in a Reply the client sees the @name.",
    slug: "inbox",
  },
  {
    id: "client-messages-details",
    roles: "all",
    match: (r) => r.client && r.page === "messages",
    target: "inbox-details",
    text: "Click i for this client's portal logins, open requests, pinned notes, SOP and recent portal visits, right beside the thread.",
    slug: "inbox",
  },
  {
    id: "client-sync",
    roles: "all",
    match: (r) => r.client,
    // The top bar's pill on a computer; the page header's copy on a phone
    // and below 900 px, where the top bar hides its own.
    target: ["tb-sync", "sync"],
    // Starts with what it points at: the card hangs below the header band,
    // a way down from the pill.
    text: "The sync pill: Basic clients sync monthly and Pro every 15 minutes. Click it to Sync now after you change something in QuickBooks.",
    slug: "quickbooks-connection",
  },
  {
    id: "client-view-as",
    roles: "all",
    match: (r) => r.client,
    target: "client-view-as",
    text: "View as client shows these pages exactly as one of the client's people sees them. Nothing changes for them; Exit preview brings you back.",
    slug: "preview-as",
  },
  {
    id: "work-task-share",
    roles: "all",
    match: (r) => r.page === "work" && TIPS_tab("wk-tab-tasks"),
    target: "task-add",
    // Just the Share checkbox and its words, not the whole form or the
    // full-width row (no Share row before the reminders database update,
    // and then no tip).
    part: ".task-share",
    snug: true,
    text: "Pick a client and tick Share with this client's team so other staff on it can see and tick off the task. Repeat needs a Due date.",
    slug: "my-tasks",
  },
  {
    id: "work-close-notes",
    roles: "all",
    match: (r) => r.page === "work" && TIPS_tab("wk-tab-close"),
    target: "close-grid",
    // One cell (the focus month's, else the first) of the first client:
    // the grid itself is taller than the screen for most firms.
    part: ["tbody td.ct-cell.focus", "tbody td.ct-cell"],
    text: "Click a cell to set the month's status and add a note, like waiting on a bank statement. The cell shows who changed it and when.",
    slug: "month-end-close",
  },
  {
    id: "work-deadlines",
    roles: "all",
    match: (r) => r.page === "work" && TIPS_tab("wk-tab-deadlines"),
    target: "#wk-tab-deadlines",
    text: "Weekend due dates move to Monday, but holidays don't, so verify each date before filing. Mark filed shows the team who filed it.",
    slug: "deadlines",
  },
  {
    id: "team-backup-access",
    roles: "bookkeeper",
    match: (r) => r.page === "team" && TIPS_tab("tp-tab-people"),
    target: "#tp-timeoff-title",
    snug: true, // the words "My time off", not the card-wide heading
    text: "Adding time off doesn't give your backup access. Check each client has a backup on its Overview; admins can give access for your dates.",
    slug: "time-off-coverage",
  },
  {
    id: "am-reviews-giving",
    roles: "am",
    match: (r) => r.page === "team" && TIPS_tab("tp-tab-reviews"),
    target: "#tr-tab-giving",
    text: "Reviews you give are here. Fill in each person's form; once both are in, meet, agree on action steps and both sign.",
    slug: "account-manager-guide",
  },
  {
    id: "team-reviews-blind",
    roles: "all",
    match: (r) => r.page === "team" && TIPS_tab("tp-tab-reviews"),
    // Only where "My review" exists (not for an admin without a review of
    // their own, for whom the text wouldn't fit).
    target: "#tr-tab-my",
    text: "Your self-review saves as a draft as you go. You and your reviewer can't see each other's scores until both forms are in.",
    slug: "quarterly-reviews",
  },
  {
    id: "admin-members-temp",
    roles: "admin",
    match: (r) => r.page === "team" && TIPS_tab("tp-tab-members"),
    target: "members-temp",
    text: "Give a bookkeeper the admin pages for 1 hour, 1 day or 1 week, say while you're away. It ends by itself; Revoke ends it early.",
    slug: "staff-management",
    adminDoc: true,
  },
  {
    id: "settings-start-page",
    roles: "all",
    match: (r) => r.page === "settings",
    target: "#st-tab-appearance",
    text: "Choose where you land after signing in: Today, Work › Tasks or the last client you opened. It's under Appearance & start page.",
    slug: "staff-settings",
  },
  {
    id: "admin-usage-quiet",
    roles: "adminPages",
    match: (r) => r.page === "usage-stats",
    target: "usage-range",
    text: "Counts are exact for the range you pick. Further down, Quiet clients lists organizations with no sign-in for 30 days or more (or never): worth a nudge.",
    slug: "admin-insight",
  },
  {
    id: "tb-search",
    roles: "all",
    match: (r) => r.client,
    target: "tb-search",
    text: (env) =>
      (env.touch ? "Search" : `Search (or ${env.kbd})`) +
      " also looks inside the open client: transactions, budget lines, documents and messages, as well as clients, SOPs and help.",
    slug: "top-bar",
  },
];

// ---------------------------------------------------------------------------
// State (user_settings.tips through ST_store)
// ---------------------------------------------------------------------------
function TIPS_saved() {
  const s = typeof ST_store !== "undefined" ? ST_store.settings : null;
  return TIPS_isObj(s) && TIPS_isObj(s.tips) ? s.tips : null;
}

// Whole days left (rounded up); 0 or less once they've run out. A start in
// the future (a computer with the wrong clock) counts as now.
function TIPS_daysLeft(t, now) {
  const start = Date.parse(t && t.startedAt);
  if (!isFinite(start)) return 0;
  return Math.ceil((Math.min(start, now) + TIPS_cfg("days") * TIPS_DAY_MS - now) / TIPS_DAY_MS);
}

function TIPS_isActive(t, now) {
  return TIPS_isObj(t) && t.on !== false && TIPS_daysLeft(t, now) > 0;
}

// Local calendar day, for the daily cap.
function TIPS_today() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function TIPS_shownToday(t) {
  return TIPS_isObj(t && t.day) && t.day.d === TIPS_today() ? Number(t.day.n) || 0 : 0;
}

// Only the signed-in staffer's own settings, once they've loaded from the
// server, and never while paused ("View as", previews; ST_store.update
// refuses then too).
function TIPS_canSave() {
  return (
    typeof ST_store !== "undefined" &&
    ST_store.role === "staff" &&
    !ST_store.paused &&
    typeof ST_store.snapshot === "function" &&
    ST_store.snapshot().status === "ready"
  );
}

// The engine's own writes: quiet (no "Saving…" note on the Settings page)
// and never from a tab in the background, which may hold an old copy.
function TIPS_canAutoSave() {
  return TIPS_canSave() && !document.hidden;
}

// Seen, and the cooldown starts again from now.
function TIPS_markSeen(id) {
  if (!TIPS_canAutoSave()) return;
  const now = new Date().toISOString();
  ST_store.update({ tips: { seen: { [id]: now }, lastAt: now } }, { quiet: true });
}

// Counts toward today's limit once per tip: one hidden by something opening
// over it may come back on a later visit without counting again.
function TIPS_recordShown(id) {
  if (!TIPS_canAutoSave()) return;
  const t = TIPS_saved();
  const d = TIPS_today();
  const ids = TIPS_isObj(t && t.day) && t.day.d === d && Array.isArray(t.day.ids) ? t.day.ids : [];
  if (ids.indexOf(id) !== -1) return;
  ST_store.update(
    { tips: { lastAt: new Date().toISOString(), day: { d, n: TIPS_shownToday(t) + 1, ids: ids.concat(id) } } },
    { quiet: true },
  );
}

// The switch. On: a fresh run of days with every tip again. ST_store's
// update merges objects, so `seen` is cleared to null first, then set to {}.
function TIPS_setOn(on, where) {
  if (!TIPS_canSave()) return false;
  const ok = on
    ? ST_store.update({ tips: { on: true, startedAt: new Date().toISOString(), seen: null, lastAt: null, day: null } }) &&
      ST_store.update({ tips: { seen: {} } })
    : ST_store.update({ tips: { on: false } });
  if (ok && window.MGB_track) window.MGB_track(on ? "tips-on" : "tips-off", where);
  return ok;
}

// { on, text } for the switch rows. No `tips` yet means the first run is
// about to start them.
function TIPS_status(t, now) {
  const days = TIPS_cfg("days");
  if (!TIPS_isObj(t) || (!t.startedAt && t.on !== false)) return { on: true, text: `On, ${days} days left` };
  if (t.on === false) return { on: false, text: "Off" };
  const left = TIPS_daysLeft(t, now);
  if (left <= 0) return { on: false, text: `Your ${days} days ended. Turn on for another ${days} days.` };
  return { on: true, text: `On, ${left} ${left === 1 ? "day" : "days"} left` };
}

// ---------------------------------------------------------------------------
// Switch rows: the Help page's home (card), Settings › Help, and the ? menu.
// ---------------------------------------------------------------------------
function TIPS_Switch({ where, disabled, card }) {
  const st = typeof ST_useSettings === "function" ? ST_useSettings() : null;
  if (!st || st.role !== "staff" || typeof ST_Toggle !== "function") return null;
  const s = TIPS_status(st.settings && st.settings.tips, Date.now());
  const row = (
    <ST_Toggle
      label="Tips while you learn"
      sub={s.text}
      checked={s.on}
      disabled={!!disabled || st.paused || st.status !== "ready"}
      onChange={(v) => TIPS_setOn(v, where)}
    />
  );
  return card ? <div className="card ltip-switch-card">{row}</div> : row;
}

// The ? menu's row, or null when the switch can't save right now. The
// visible ": On" / ": Off" is left out of the accessible name (ariaLabel),
// since aria-checked already says it.
function TIPS_menuItem() {
  if (!TIPS_canSave()) return null;
  const on = TIPS_status(TIPS_saved(), Date.now()).on;
  return {
    label: "Tips while you learn: " + (on ? "On" : "Off"),
    ariaLabel: "Tips while you learn",
    checked: on,
    run: () => TIPS_setOn(!on, "menu"),
  };
}

// ---------------------------------------------------------------------------
// Finding, measuring and placing
// ---------------------------------------------------------------------------
// The element a tip points at: the first of its targets on the page, or with
// `part`, a matching element inside it (the first fully in view, else the
// first).
function TIPS_find(tip) {
  const keys = Array.isArray(tip.target) ? tip.target : [tip.target];
  for (let i = 0; i < keys.length; i++) {
    const el = typeof TOUR_find === "function" ? TOUR_find(keys[i]) : null;
    if (el) return tip.part ? TIPS_part(el, tip.part) : el;
  }
  return null;
}

function TIPS_part(el, part) {
  const sels = Array.isArray(part) ? part : [part];
  let first = null;
  for (let i = 0; i < sels.length; i++) {
    const found = el.querySelector(sels[i]);
    if (!found || !found.getClientRects().length) continue;
    if (TIPS_share(found) >= 0.99) return found;
    first = first || found;
  }
  return first;
}

// Targets in the bars themselves (the top bar, the phone bars, the rails)
// aren't covered by them.
function TIPS_pinned(el) {
  return !!(el.closest && el.closest(".tb-bar, .mobile-topbar, .client-tabbar, .sidebar, .staff-rail"));
}

function TIPS_barTop(el) {
  return el && TIPS_pinned(el) ? 0 : typeof TOUR_stickyTop === "function" ? TOUR_stickyTop() : 0;
}

function TIPS_barBottom(el) {
  return el && TIPS_pinned(el) ? 0 : typeof TOUR_stickyBottom === "function" ? TOUR_stickyBottom() : 0;
}

// How much of the target (0-1) is actually on screen: inside the viewport,
// clear of the sticky bars, and not clipped by a scrolling ancestor (a tab
// row that scrolls sideways, a table).
function TIPS_share(el) {
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return 0;
  let t = Math.max(r.top, TIPS_barTop(el));
  let b = Math.min(r.bottom, window.innerHeight - TIPS_barBottom(el));
  let l = Math.max(r.left, 0);
  let rt = Math.min(r.right, window.innerWidth);
  for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
    const cs = window.getComputedStyle(p);
    if (!/(auto|scroll|hidden|clip)/.test(cs.overflowX + " " + cs.overflowY)) continue;
    const pr = p.getBoundingClientRect();
    t = Math.max(t, pr.top);
    b = Math.min(b, pr.bottom);
    l = Math.max(l, pr.left);
    rt = Math.min(rt, pr.right);
  }
  return (Math.max(0, b - t) * Math.max(0, rt - l)) / (r.width * r.height);
}

// The box the ring goes around: the element's, or with `snug`, just what's
// inside it (its children and text together, read with a Range, kept inside
// the element's own box), for a label, heading or row stretched wider than
// its contents.
function TIPS_rect(el, snug) {
  const r = el.getBoundingClientRect();
  if (!snug || typeof document.createRange !== "function") return r;
  const range = document.createRange();
  range.selectNodeContents(el);
  const c = range.getBoundingClientRect();
  const t = Math.max(c.top, r.top);
  const l = Math.max(c.left, r.left);
  const b = Math.min(c.bottom, r.bottom);
  const rt = Math.min(c.right, r.right);
  if (!(c.width > 0 && c.height > 0 && rt > l && b > t)) return r;
  return { top: t, left: l, bottom: b, right: rt, width: rt - l, height: b - t };
}

// The boxes of the buttons, links, tabs and fields on screen (not the card's
// or ring's own), for TIPS_covers. Read once per placement.
function TIPS_controls(skip) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const out = [];
  document.querySelectorAll(TIPS_CONTROL).forEach((c) => {
    if (skip.some((s) => s && s.contains(c))) return;
    const r = c.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw) out.push(r);
  });
  return out;
}

// How much a card at `pos` would be in the way (the card and ring themselves
// skipped): 1 for each button, link, tab or field it would hide, plus 1/3
// for each point of a 5 x 3 grid on the top bars, the page's header band, a
// heading or a tab row (a card wholly over those counts as 5 more), so it
// prefers empty space. A control counts when a grid point lands on it, or
// when its box (from `ctls`, TIPS_controls) overlaps the card and it's what
// shows at the middle of the overlap, so a short row of buttons between the
// grid's rows still counts.
function TIPS_covers(pos, cw, ch, skip, ctls) {
  if (typeof document.elementsFromPoint !== "function") return 0;
  const topAt = (x, y) => {
    const stack = document.elementsFromPoint(x, y);
    for (let k = 0; k < stack.length; k++) {
      if (!skip.some((s) => s && s.contains(stack[k]))) return stack[k];
    }
    return null;
  };
  const hits = new Set();
  const hit = (at) => {
    const c = at && at.closest ? at.closest(TIPS_CONTROL) : null;
    if (c) hits.add(c);
  };
  let head = 0;
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 3; j++) {
      const at = topAt(pos.left + 6 + ((cw - 12) * i) / 4, pos.top + 6 + ((ch - 12) * j) / 2);
      hit(at);
      if (at && at.closest && at.closest(TIPS_HEAD)) head++;
    }
  }
  const right = pos.left + cw;
  const bottom = pos.top + ch;
  (ctls || []).forEach((r) => {
    const l = Math.max(r.left, pos.left);
    const t = Math.max(r.top, pos.top);
    const rt = Math.min(r.right, right);
    const b = Math.min(r.bottom, bottom);
    if (rt > l && b > t) hit(topAt((l + rt) / 2, (t + b) / 2));
  });
  return hits.size + head / 3;
}

// The bottom of the page's header band (.app-topbar: breadcrumb, title row,
// tab row) while any of it is on screen below the sticky bars, else 0.
function TIPS_headBottom() {
  const bars = typeof TOUR_stickyTop === "function" ? TOUR_stickyTop() : 0;
  const els = document.querySelectorAll(".app-topbar");
  for (let i = 0; i < els.length; i++) {
    const r = els[i].getBoundingClientRect();
    if (r.height > 0 && r.bottom > bars) return r.bottom;
  }
  return 0;
}

// Where the card goes, without covering the ring (`rect`, TIPS_rect, else the
// element's box). On a computer: below or above with its left or right edge
// lined up with the ring's (only edges that really line up; the left one,
// shifted on screen, when neither does), or right or left of it; the `side`
// it already has if that still fits, else the one least in the way
// (TIPS_covers; ties in that order, so left edges lined up and below win).
// A target in the top bar or the header band (TIPS_HEADER) takes a spot
// below whenever one fits, right under it or under the header band so it
// hangs into the page rather than over the title and tabs; beside it (also
// under the band) only when that hides less than every spot below. On a
// phone: docked. null when nothing fits.
function TIPS_position(el, card, side, skip, rect) {
  const cw = card.offsetWidth;
  const ch = card.offsetHeight;
  const r = rect || el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const ring = { top: r.top - TIPS_RING_PAD, bottom: r.bottom + TIPS_RING_PAD, left: r.left - TIPS_RING_PAD, right: r.right + TIPS_RING_PAD };
  const topLimit = TIPS_barTop(el) + TIPS_MARGIN;
  const bottomLimit = vh - TIPS_barBottom(el) - TIPS_MARGIN;
  if (vw < TIPS_PHONE_MAX) {
    // Docked across the bottom, above a bottom tab bar, the home indicator
    // (tips.css puts the safe-area inset in scroll-margin-bottom so it can
    // be read here) and the floating chat button; at the top, under the
    // bars, when the target is down there.
    const safe = parseFloat(window.getComputedStyle(card).scrollMarginBottom) || 0;
    let dockBottom = vh - Math.max(typeof TOUR_stickyBottom === "function" ? TOUR_stickyBottom() : 0, safe) - TIPS_MARGIN;
    document.querySelectorAll(TIPS_FAB).forEach((fab) => {
      const fr = fab.getBoundingClientRect();
      if (fr.height > 0 && fr.top < dockBottom && fr.bottom > dockBottom - ch) dockBottom = fr.top - TIPS_GAP;
    });
    const dockTop = (typeof TOUR_stickyTop === "function" ? TOUR_stickyTop() : 0) + TIPS_MARGIN;
    if (ring.bottom + TIPS_GAP <= dockBottom - ch) return { dock: true, top: dockBottom - ch };
    // At the top it never covers the page's title and tab row (under them
    // while they're on screen, else just under the bars), nor a field of
    // the form the target is in (Work › Tasks' task box, say). When neither
    // dock fits, the tip waits for a later visit.
    const top = Math.max(dockTop, TIPS_headBottom() + TIPS_MARGIN);
    if (ring.top - TIPS_GAP < top + ch) return null;
    const form = el.closest ? el.closest("form") : null;
    const fields = form ? form.querySelectorAll(TIPS_FIELD) : [];
    for (let i = 0; i < fields.length; i++) {
      const fr = fields[i].getBoundingClientRect();
      if (fr.width > 0 && fr.height > 0 && fr.bottom > top && fr.top < top + ch) return null;
    }
    return { dock: true, top };
  }
  const clampX = (x) => Math.max(TIPS_MARGIN, Math.min(x, vw - cw - TIPS_MARGIN));
  const startX = clampX(ring.left); // left edges lined up
  const endX = clampX(ring.right - cw); // right edges lined up
  const xs = [
    ["", startX, startX === ring.left],
    ["-end", endX, endX === ring.right - cw && endX !== startX],
  ].filter((x) => x[2]);
  if (!xs.length) xs.push(["", startX]);
  const fits = [];
  const add = (s, top, left) => {
    if (top >= topLimit && top + ch <= bottomLimit) fits.push({ side: s, top, left });
  };
  const head = !!(el.closest && el.closest(TIPS_HEADER));
  // "under" is the same as "below" once the header band has scrolled away.
  const under = Math.max(ring.bottom, TIPS_headBottom()) + TIPS_GAP;
  xs.forEach((x) => add("below" + x[0], ring.bottom + TIPS_GAP, x[1]));
  if (head) xs.forEach((x) => add("under" + x[0], under, x[1]));
  const belowCount = fits.length;
  if (!head || !belowCount) xs.forEach((x) => add("above" + x[0], ring.top - TIPS_GAP - ch, x[1]));
  if (bottomLimit - topLimit >= ch) {
    const y = Math.max(topLimit, Math.min(head ? Math.max(r.top, under) : r.top, bottomLimit - ch));
    if (ring.right + TIPS_GAP + cw <= vw - TIPS_MARGIN) fits.push({ side: "right", top: y, left: ring.right + TIPS_GAP });
    if (ring.left - TIPS_GAP - cw >= TIPS_MARGIN) fits.push({ side: "left", top: y, left: ring.left - TIPS_GAP - cw });
  }
  if (!fits.length) return null;
  const kept = side && fits.find((f) => f.side === side);
  if (kept) return kept;
  if (fits.length === 1) return fits[0];
  let ctls = null;
  let best = fits[0];
  let fewest = Infinity;
  fits.forEach((f) => {
    const n = TIPS_covers(f, cw, ch, skip, ctls || (ctls = TIPS_controls(skip)));
    if (n < fewest) {
      best = f;
      fewest = n;
    }
  });
  return best;
}

// Puts the ring and card in place (inline styles, no re-render). Returns
// true, or why not: "gone" (the target left the page), "busy" (the layout
// switched between phone and computer) or "away" (out of view, or no room
// for the card). The element and side found the first time are kept while
// they last, so the ring and card don't jump.
function TIPS_layout(shown, card, ring) {
  if (!shown || !card || !ring) return "gone";
  let el = shown.el && shown.el.isConnected && shown.el.getClientRects().length ? shown.el : null;
  if (!el) el = shown.el = TIPS_find(shown.tip);
  if (!el) return "gone";
  if (TIPS_share(el) < (shown.on ? TIPS_AWAY_SHARE : 0.99)) return "away";
  const phone = window.innerWidth < TIPS_PHONE_MAX;
  if (phone !== !!shown.dock) return "busy";
  if (phone) {
    card.style.left = TIPS_MARGIN + "px";
    card.style.right = TIPS_MARGIN + "px";
  } else {
    card.style.right = "";
  }
  const r = TIPS_rect(el, shown.tip.snug);
  const pos = TIPS_position(el, card, shown.side, [card, ring], r);
  if (!pos) return "away";
  shown.side = pos.side;
  card.style.top = Math.round(pos.top) + "px";
  if (!phone) card.style.left = Math.round(pos.left) + "px";
  const top = r.top - TIPS_RING_PAD;
  ring.style.top = Math.round(top) + "px";
  ring.style.left = Math.round(r.left - TIPS_RING_PAD) + "px";
  ring.style.width = Math.round(r.width + 2 * TIPS_RING_PAD) + "px";
  ring.style.height = Math.round(r.height + 2 * TIPS_RING_PAD) + "px";
  // Never drawn over the sticky bars when the target scrolls under them.
  const clip = Math.max(0, TIPS_barTop(el) - top);
  ring.style.clipPath = clip ? "inset(" + Math.round(clip) + "px -4px -4px -4px)" : "";
  return true;
}

// A tour open or about to start, a modal, menu or popover open, or a text
// field focused.
function TIPS_busy() {
  if (typeof TOUR_staffBusy === "function" ? TOUR_staffBusy() : document.querySelector(".tour-root")) return true;
  if (document.querySelector(TIPS_BUSY)) return true;
  const a = document.activeElement;
  return !!(a && a !== document.body && a.matches && a.matches(TIPS_FIELD));
}

// A tour actually on screen (not just due to start): tips wait
// TIPS_CONFIG.cooldownMs after one, so two kinds of help never stack.
function TIPS_tourOnScreen() {
  return (typeof TOUR_staffState !== "undefined" && !!TOUR_staffState && TOUR_staffState.open) || !!document.querySelector(".tour-root");
}

// The first tip this person can get on this page, not yet seen, whose target
// is fully in view, as { tip, el }. `skip` holds tips that didn't fit on
// this route.
function TIPS_pick(ctx, seen, skip) {
  const route = { page: ctx.page, client: document.documentElement.classList.contains("staff-client-tabs") };
  for (let i = 0; i < TIPS_CATALOG.length; i++) {
    const tip = TIPS_CATALOG[i];
    if (!ctx.roles[tip.roles] || (seen && seen[tip.id]) || skip.has(tip.id)) continue;
    if (!tip.match(route) || (tip.ready && !tip.ready())) continue;
    const el = TIPS_find(tip);
    if (el && TIPS_share(el) >= 0.99) return { tip, el };
  }
  return null;
}

// A polite live region, so a screen reader reads the tip once without focus
// moving. Made empty when the engine starts (a region added with its text
// already in it is often not read).
function TIPS_live() {
  let el = document.getElementById("ltip-live");
  if (!el) {
    el = document.createElement("div");
    el.id = "ltip-live";
    el.className = "ltip-sr";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    document.body.appendChild(el);
  }
  return el;
}

function TIPS_announce(text) {
  const el = document.getElementById("ltip-live");
  if (el) el.textContent = text ? "Tip: " + text : "";
}

function TIPS_BulbIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 18h6" />
      <path d="M10 21h4" />
      <path d="M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.2h5c0-.9.4-1.6 1.1-2.2A6 6 0 0 0 12 3z" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// The engine and the card. Mounted by App beside TOUR_StaffRoot with
//   staffUser            the signed-in staffer ({ email, role })
//   impersonating        truthy during "View as" (tips stay off)
//   isPreviewingUser     previewing as a client user (tips stay off)
//   hasTempAdminAccess   a live temporary admin grant ("adminPages" tips)
//   page                 App's effectivePage
// ---------------------------------------------------------------------------
function TIPS_Root({ staffUser, impersonating, isPreviewingUser, hasTempAdminAccess, page }) {
  const st = ST_useSettings();
  const email = staffUser ? String(staffUser.email || "").trim().toLowerCase() : null;
  const own = !!email && !impersonating && !isPreviewingUser && st.role === "staff" && st.email === email && !st.paused && st.status === "ready";
  const saved = own && TIPS_isObj(st.settings && st.settings.tips) ? st.settings.tips : null;
  const started = !!saved && (!!saved.startedAt || saved.on === false);
  const active = own && started && TIPS_isActive(saved, Date.now());

  // First run: tips start now for anyone on staff without them yet.
  React.useEffect(() => {
    if (own && !started) ST_store.update({ tips: { on: true, startedAt: new Date().toISOString() } }, { quiet: true });
  }, [own, started]);

  const role = staffUser ? staffUser.role : null;
  const isAdmin = role === "admin";
  const tempAdmin = role === "bookkeeper" && !!hasTempAdminAccess;
  const ctx = React.useRef({});
  ctx.current = {
    page,
    isAdmin,
    roles: {
      all: true,
      bookkeeper: role === "bookkeeper",
      admin: isAdmin,
      adminPages: isAdmin || tempAdmin,
      am: isAdmin && typeof TOUR_amCount === "function" && TOUR_amCount(email) > 0,
    },
  };
  // "Sign-in" for the grace period: when this page load first saw this staffer.
  const signedIn = React.useRef({ email: null, at: 0 });
  if (signedIn.current.email !== email) signedIn.current = { email, at: Date.now() };

  // { tip, el, text, more, dock, side, rk, on, onAt }; el and side are
  // filled in by TIPS_layout as it goes.
  const [shown, setShown] = React.useState(null);
  const shownRef = React.useRef(null);
  shownRef.current = shown;
  const cardRef = React.useRef(null);
  const ringRef = React.useRef(null);
  const hideRef = React.useRef(() => {});
  const tickRef = React.useRef(() => {});
  const skipRef = React.useRef(new Set());
  const routeDoneRef = React.useRef(null); // the route a tip already showed on this visit
  const focusRef = React.useRef(null); // what had focus when the tip showed

  React.useEffect(() => {
    if (!active) return undefined;
    TIPS_live();
    let routeKey = null;
    let activityAt = Date.now();
    let frame = 0;
    let hiddenAt = 0; // when the last tip went away
    let tourAt = 0; // when a tour was last on screen
    // See "Seen" in the header. A keyboard user who used a card button gets
    // focus back where it was, rather than on the page body.
    const hide = (reason) => {
      const cur = shownRef.current;
      if (!cur) return;
      const card = cardRef.current;
      const hadFocus = !!(card && card.contains(document.activeElement));
      shownRef.current = null;
      setShown(null);
      hiddenAt = Date.now();
      TIPS_announce("");
      const read = !!cur.onAt && hiddenAt - cur.onAt >= TIPS_READ_MS;
      if (TIPS_DISMISS[reason] || ((reason === "route" || reason === "away") && read)) TIPS_markSeen(cur.tip.id);
      const back = focusRef.current;
      if (hadFocus && back && back.isConnected && typeof back.focus === "function") {
        try {
          back.focus({ preventScroll: true });
        } catch (e) {}
      }
    };
    hideRef.current = hide;
    const place = () => {
      frame = 0;
      const cur = shownRef.current;
      if (!cur || !cur.on) return;
      const ok = TIPS_layout(cur, cardRef.current, ringRef.current);
      if (ok !== true) hide(ok);
    };
    const tick = () => {
      const now = Date.now();
      if (TIPS_tourOnScreen()) tourAt = now;
      const rk = ctx.current.page + "|" + window.location.hash;
      if (rk !== routeKey) {
        if (routeKey !== null) hide("route");
        routeKey = rk;
        activityAt = now;
        skipRef.current = new Set();
        routeDoneRef.current = null;
      }
      const cur = shownRef.current;
      if (cur) {
        if (TIPS_busy()) hide("busy");
        else if (cur.on && !frame) place();
        return;
      }
      if (routeDoneRef.current === rk) return;
      const settle = TIPS_cfg("settleMs");
      const quiet = now - activityAt;
      if (quiet < settle || quiet > settle + TIPS_TRY_MS || document.hidden) return;
      if (now - signedIn.current.at < TIPS_cfg("graceMs")) return;
      const t = TIPS_saved();
      if (!TIPS_isActive(t, now)) return;
      // A saved time in the future (another computer's wrong clock) counts as now.
      const last = Math.max(Math.min(Date.parse(t.lastAt) || 0, now), hiddenAt, tourAt);
      if (now - last < TIPS_cfg("cooldownMs")) return;
      if (TIPS_shownToday(t) >= TIPS_cfg("maxPerDay") || TIPS_busy()) return;
      const found = TIPS_pick(ctx.current, TIPS_isObj(t.seen) ? t.seen : {}, skipRef.current);
      if (!found) return;
      const { tip, el } = found;
      const env = {
        kbd: typeof TOUR_isMac === "function" && TOUR_isMac() ? "⌘K" : "Ctrl+K",
        touch: TIPS_touch(),
      };
      const next = {
        tip,
        el,
        text: typeof tip.text === "function" ? tip.text(env) : tip.text,
        more: !tip.adminDoc || ctx.current.isAdmin,
        dock: window.innerWidth < TIPS_PHONE_MAX,
        side: null,
        rk,
        on: false,
      };
      shownRef.current = next;
      setShown(next);
    };
    tickRef.current = tick;
    const onActivity = () => {
      activityAt = Date.now();
      if (shownRef.current && !frame) frame = window.requestAnimationFrame(place);
    };
    // A click anywhere but the card's own controls dismisses, and goes
    // through (the card is click-through, tips.css).
    const onPointer = (e) => {
      activityAt = Date.now();
      const card = cardRef.current;
      if (shownRef.current && !(card && card.contains(e.target))) hide("click");
    };
    const onKey = (e) => {
      if (e.key === "Escape" && shownRef.current) hide("esc");
    };
    const timer = window.setInterval(tick, TIPS_TICK_MS);
    window.addEventListener("scroll", onActivity, true);
    window.addEventListener("resize", onActivity);
    document.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("hashchange", tick);
    window.addEventListener("mgb-tabchange", tick);
    return () => {
      window.clearInterval(timer);
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onActivity, true);
      window.removeEventListener("resize", onActivity);
      document.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("hashchange", tick);
      window.removeEventListener("mgb-tabchange", tick);
      hideRef.current = () => {};
      tickRef.current = () => {};
      shownRef.current = null;
      TIPS_announce("");
      setShown(null);
    };
  }, [active]);

  // A page change is a route change right away (the tick would catch it
  // within TIPS_TICK_MS anyway).
  React.useEffect(() => {
    tickRef.current();
  }, [page]);

  // First placement, before paint: a tip that doesn't fit after all is
  // skipped for this route; one that does counts as shown, takes this
  // route's one tip, and fades in.
  React.useLayoutEffect(() => {
    if (!shown || shown.on) return undefined;
    if (TIPS_layout(shown, cardRef.current, ringRef.current) !== true) {
      skipRef.current.add(shown.tip.id);
      shownRef.current = null;
      setShown(null);
      return undefined;
    }
    routeDoneRef.current = shown.rk;
    focusRef.current = document.activeElement;
    TIPS_recordShown(shown.tip.id);
    const f = window.requestAnimationFrame(() => {
      setShown((s) => (s && s.tip === shown.tip ? { ...s, on: true, onAt: Date.now() } : s));
      TIPS_announce(shown.text);
    });
    return () => window.cancelAnimationFrame(f);
  }, [shown]);

  if (!shown) return null;
  const { tip } = shown;
  return ReactDOM.createPortal(
    <>
      <div ref={ringRef} className={"ltip-ring" + (shown.on ? " ltip-on" : "")} aria-hidden="true" />
      <div
        ref={cardRef}
        className={"ltip-card" + (shown.dock ? " ltip-dock" : "") + (shown.on ? " ltip-on" : "")}
        role="note"
        aria-label="Tip"
        // Clicking the card's links never takes focus from the page.
        onMouseDown={(e) => e.preventDefault()}
      >
        <div className="ltip-eyebrow">
          <TIPS_BulbIcon />
          Tip
        </div>
        <p className="ltip-text">{shown.text}</p>
        <div className="ltip-actions">
          <button
            type="button"
            className="ltip-off"
            onClick={() => {
              hideRef.current("off");
              TIPS_setOn(false, "card");
            }}
          >
            Turn off tips
          </button>
          {shown.more && (
            <a
              className="ltip-more"
              href={"#/help/" + tip.slug}
              onClick={() => {
                hideRef.current("more");
                if (window.MGB_track) window.MGB_track("tip-more", tip.id);
              }}
            >
              Learn more
            </a>
          )}
          <button type="button" className="ltip-got" onClick={() => hideRef.current("got")}>
            Got it
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}
