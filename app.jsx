const { useState, useMemo, useRef, useContext, useEffect, useCallback } = React;

const fmtMoney = (n, opts = {}) => {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  return (
    sign +
    "$" +
    abs.toLocaleString("en-US", {
      minimumFractionDigits: opts.cents ? 2 : 0,
      maximumFractionDigits: opts.cents ? 2 : 0,
    })
  );
};

const fmtDate = (iso) => {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

// For a real timestamp (e.g. Postgres's created_at, "2026-09-14T02:58:03Z"),
// not the plain YYYY-MM-DD strings fmtDate above expects — appending
// "T00:00:00" to one of these would double up the time component.
const fmtDateTime = (iso) => {
  const d = new Date(iso);
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

// Today as YYYY-MM-DD in the viewer's own timezone. Deliberately not
// toISOString(), which returns the UTC date — west of UTC that stamps
// anything created after ~7pm with tomorrow's date, and fmtDate above reads
// the string back as local time, so it renders as a date in the future.
const todayLocal = () => {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
};

// Same YYYY-MM-DD shape as todayLocal, n months back — used to cap a
// scrollable transaction list to a rolling window instead of a fixed count.
const monthsAgoLocal = (n) => {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
};

// Whole days from `fromIso` to `toIso` (positive = toIso is in the future).
// Used by Cash Flow Pro to bucket payables by due date without drifting
// on timezone — both sides are parsed as local midnight, same as fmtDate.
const daysUntil = (toIso, fromIso) => {
  const to = new Date(toIso + "T00:00:00");
  const from = new Date(fromIso + "T00:00:00");
  return Math.round((to - from) / 86400000);
};

// Bar-fill entrance duration scales with how far the bar travels, so a
// near-empty bar doesn't take as long to grow as a full one — matching
// DailyClose.tsx's growDuration.
const growDuration = (fillPct) => {
  const clamped = Math.min(100, Math.max(0, fillPct));
  return 450 + (clamped / 100) * 450;
};

const formatBytes = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const NAME_TITLES = new Set(["pastor", "rev", "reverend", "dr", "mr", "mrs", "ms", "fr"]);

// Strips a leading title ("Pastor John Whitfield" -> "John") so greetings
// use a first name rather than a role prefix.
const firstNameOf = (fullName) => {
  const parts = fullName.trim().split(/\s+/);
  const lead = parts[0].replace(/\.$/, "").toLowerCase();
  return NAME_TITLES.has(lead) && parts.length > 1 ? parts[1] : parts[0];
};

// Section labels -> stable DOM ids, for aria-controls on the nav toggles.
const slugify = (label) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const timeOfDayGreeting = () => {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
};

const totalCash = (client) => client.bankAccounts.reduce((s, a) => s + a.balance, 0);

const avgMonthlyExpenses = (client) =>
  client.monthly.reduce((sum, m) => sum + m.expenses, 0) / client.monthly.length;

// Months of operating reserve: how long cash on hand would cover normal
// operating costs if income stopped. This is the standard nonprofit measure,
// and it always yields a comparable number.
//
// It replaces an earlier "burn rate" that averaged only the deficit months
// (max(expenses - income, 0)) across ALL months. One bad month in six was
// divided by six, so Riverside — a pantry with a single $2,700 shortfall —
// reported 184.9 months (15 years) of runway, and the two clients that never
// ran a deficit divided by zero and fell through to a bare "Healthy".
const runwayMonthsFor = (client) => {
  const monthlyExpenses = avgMonthlyExpenses(client);
  return monthlyExpenses > 0 ? totalCash(client) / monthlyExpenses : null;
};

const lastMessageFromBookkeeper = (client) => {
  const msgs = client.messages || [];
  const last = msgs[msgs.length - 1];
  return Boolean(last && last.from === "bookkeeper");
};

// Every person at an organization has their own private thread with
// MyGoodBooks, so live threads and read state are keyed by both ids.
const threadKeyFor = (clientId, userId) => `${clientId}::${userId}`;

const seedThread = (clientId, userId) => {
  const c = CLIENTS.find((x) => x.id === clientId);
  return (c && c.threads && c.threads[userId]) || [];
};

function computeAlerts(client) {
  const alerts = [];
  const current = client.monthly[client.monthly.length - 1];
  const runway = runwayMonthsFor(client);

  if (runway !== null && runway < 3) {
    alerts.push(`Cash on hand covers under 3 months of operating expenses (${runway.toFixed(1)} mo).`);
  }
  if (current.income - current.expenses < 0) {
    alerts.push(`This month ran a deficit of ${fmtMoney(Math.abs(current.income - current.expenses))}.`);
  }
  const overBudget = client.budget.filter((b) => b.actual > b.budgeted * 1.05);
  if (overBudget.length > 0) {
    alerts.push(
      `${overBudget.length} categor${overBudget.length > 1 ? "ies" : "y"} over budget this month: ${overBudget
        .map((b) => b.category)
        .join(", ")}.`
    );
  }
  return alerts;
}

// ----------------------------------------------------------------------------
// Toast notifications (for mock actions like "download" or "upload")
// ----------------------------------------------------------------------------

const ToastContext = React.createContext(() => {});
const useToast = () => useContext(ToastContext);

function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const showToast = (text) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  };

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      <div className="toast-stack">
        {toasts.map((t) => (
          <div className="toast" key={t.id}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// ----------------------------------------------------------------------------
// Sidebar
// ----------------------------------------------------------------------------

// Premium used to mean a handful of extra, separately-named tabs
// (Report Builder, Budgeting Tool, Cash Flow Pro) living alongside their
// standard counterparts — a premium client saw both "Cash Flow" and "Cash
// Flow Pro" in the sidebar at once, two names for what a client experiences
// as one function. As of this pass, every one of those pairs has been
// collapsed into a single tab: the SAME nav item shows the upgraded page for
// a premium client and the standard one otherwise, exactly like Dashboard
// already did for Live Report. See PREMIUM_UPGRADE_TAB_KEYS and the
// showsBudgetingTool/showsCashFlowPro/showsReportBuilder checks in App.
const PREMIUM_UPGRADE_TAB_KEYS = new Set(["dashboard", "budget", "receivables", "reports", "bank", "giving"]);

const NAV_SECTIONS = [
  {
    // Enterprise leads the sidebar, and Messages/Dashboard now live inside
    // it as its first two items — Messages first (an unread badge shouldn't
    // be buried below the most-visited page), then Dashboard (which reads
    // "Dashboard Live" for a premium client, see the label override in
    // Sidebar), both ahead of Budget/Finances. Neither item here is itself
    // premium-gated (no item in this whole list carries `premium: true`
    // anymore — see PREMIUM_UPGRADE_TAB_KEYS above), so this section's
    // upsell heading is really about the PRO badges scattered across the
    // rest of the sidebar, not about hiding any row of its own.
    label: "Enterprise",
    // Live Report ("daily-close") isn't a nav item here on purpose — a
    // premium, full-access client's Dashboard tab IS the Live Report, one
    // cohesive page instead of two separate tabs both claiming to be "the
    // overview." See showsLiveReport in App.
    items: [
      { key: "messages", label: "Messages", icon: <ChatIcon width="16" height="16" strokeWidth="1.8" /> },
      { key: "dashboard", label: "Dashboard", icon: <GridIcon /> },
    ],
  },
  {
    label: "Budget",
    items: [{ key: "budget", label: "Budget vs. Actual", icon: <PieChartIcon /> }],
  },
  {
    label: "Finances",
    items: [
      { key: "bank", label: "Bank Accounts", icon: <BankIcon /> },
      { key: "receivables", label: "Cash Flow", icon: <SwapIcon /> },
      // Not in PREMIUM_UPGRADE_TAB_KEYS on purpose — Payroll is a separate
      // add-on (client.payrollAddOn), orthogonal to the standard/premium
      // plan split, not a premium-only upgrade. See PayrollPage.
      { key: "payroll", label: "Payroll", icon: <UsersIcon /> },
      { key: "reports", label: "Reports", icon: <DownloadIcon /> },
      { key: "giving", label: "Giving & Funds", icon: <GiftHeartIcon /> },
    ],
  },
  {
    label: "Documents",
    items: [{ key: "documents", label: "Documents", icon: <FolderIcon /> }],
  },
];

const ALL_TAB_KEYS = NAV_SECTIONS.flatMap((section) => section.items.map((item) => item.key));
const ALWAYS_VISIBLE_KEY = "dashboard";

// Tabs that show whole-organization figures with no category dimension, so
// they can't be meaningfully narrowed to one person's ministry area. A
// category-scoped user is never given these, even if their tab list names one.
const ORG_WIDE_TABS = new Set([
  "bank",
  "receivables",
  "reports",
  "payroll",
  // Live Report isn't a real tab key (see NAV_SECTIONS) so it can't be listed
  // here — the same org-wide exclusion for it, and for the Budgeting Tool/
  // Cash Flow Pro upgrades that now live inline on "budget"/"receivables",
  // is applied directly via the `!access.isCategoryScoped` checks in App
  // (showsLiveReport/showsBudgetingTool/showsCashFlowPro/showsReportBuilder).
]);

const BOOKKEEPER_VIEW = "__bookkeeper__";

// Synthetic staff-only pages that don't belong to any client — not in
// ALL_TAB_KEYS/NAV_SECTIONS, reachable only via the sidebar's staff utility
// links, and excluded everywhere the app assumes "the current page is one of
// a client's tabs" (the client picker, the "preview as" picker, whether to
// stamp a client visit, the page-header greeting). One shared set instead of
// repeating the same three-or-four-way `page !== "x" && page !== "y"` check
// at every one of those call sites, which is exactly how developer-tools
// nearly got left out of one of them when it was added.
const NON_CLIENT_PAGES = new Set(["bookkeeper-home", "staff-access", "client-access", "developer-tools", "staff-messages"]);

// Tabs that are part of a paid add-on rather than the base product. Always
// empty now — no nav item carries `premium: true` since every upgrade lives
// inline on an existing tab (PREMIUM_UPGRADE_TAB_KEYS) instead of being its
// own separately-gated tab. Kept rather than deleted: resolveAccess still
// reads it to decide what to strip from a standard client's access.tabs, and
// an empty set there is the correct behavior (nothing to strip) — removing
// this constant would mean re-deriving that at every call site instead.
const PREMIUM_TAB_KEYS = new Set(
  NAV_SECTIONS.flatMap((section) => section.items.filter((i) => i.premium).map((i) => i.key))
);

// Per-browser dev/QA toggles, set from Staff Access's "Developer Tools" card.
// Deliberately localStorage-only, not a Supabase table: these are throwaway
// testing aids for whoever's browser they're set in, not team-wide settings
// (a "hide Staff Access for everyone" flag would be a much bigger footgun
// than this file wants to hold).
const FEATURE_FLAGS = [
  {
    key: "mygoodbooks_ff_force_premium_v1",
    label: "Force premium plan",
    description: "Treat every client as premium, so Enterprise is reachable regardless of their real plan.",
  },
  {
    key: "mygoodbooks_ff_verbose_logging_v1",
    label: "Verbose console logging",
    description: "Log the current page and client id to the console on every navigation, for bug reports.",
  },
  {
    // Read directly by components/auth/supabaseClient.js, which loads
    // before this file exists and can't call isFlagOn() here — it checks
    // the same key/value convention ("1" in localStorage) itself. See the
    // comment there for why a duplicated literal beats a cross-file call.
    key: "mygoodbooks_ff_slow_network_v1",
    label: "Simulate slow network",
    description: "Adds a ~1.8s delay to every Supabase request, to test loading states without real network throttling.",
  },
];

// A directory, not a vault: where each piece of infrastructure lives and
// which shared password manager vault holds the real credentials for it.
// Deliberately never a place to store an actual secret — a bespoke
// in-app credential store has no MFA, no breach monitoring, and no audit
// trail, and if its encryption key ever lived in the same Supabase project
// it's protecting, one compromise exposes everything. Edit this list by
// hand as accounts change; it's just links and a pointer to where the real
// password lives.
const INFRA_LINKS = [
  { name: "GitHub", url: "https://github.com/mygoodbooksllc/mgb-client-portal", note: "Credentials: 1Password vault “MGB Infra”" },
  { name: "Supabase", url: "https://supabase.com/dashboard", note: "Project “MGB Client Portal” · org “Mygoodbooks LLC” · credentials: 1Password vault “MGB Infra”" },
  { name: "Vercel", url: "https://vercel.com/dashboard", note: "Deploys app.mygoodbooks.org from main · credentials: 1Password vault “MGB Infra”" },
  { name: "Google Cloud (OAuth)", url: "https://console.cloud.google.com", note: "Project “MyGoodBooks Auth” · credentials: 1Password vault “MGB Infra”" },
  { name: "GoDaddy", url: "https://dcc.godaddy.com", note: "Domain mygoodbooks.org · credentials: 1Password vault “MGB Infra”" },
  { name: "Squarespace", url: "https://account.squarespace.com", note: "The real mygoodbooks.org site · credentials: 1Password vault “MGB Infra”" },
];

function isFlagOn(key) {
  try {
    return localStorage.getItem(key) === "1";
  } catch (e) {
    return false;
  }
}

function setFlag(key, on) {
  try {
    if (on) localStorage.setItem(key, "1");
    else localStorage.removeItem(key);
  } catch (e) {}
}

// The billing gate. Deliberately outside <DailyClose />, which has no billing
// logic of its own — same split we will need once this is a real route loader
// checking a subscription record instead of a field on the mock client.
function hasPremiumPlan(client) {
  return client.plan === "premium" || isFlagOn(FEATURE_FLAGS[0].key);
}

// Resolves what a given person may see: the org-level baseline the bookkeeper
// set for the whole client, narrowed by that individual's own access record.
// overrideUser: a real, signed-in client_users row (Phase 2 — see
// ClientAuthGate), already resolved by the caller rather than looked up by
// id out of client.users mock data. Same shape as a client.users entry
// (access/tabs/categories/funds/premiumThrottled), so every check below
// that already reads generically off "user" needs no changes for it.
function resolveAccess(client, viewAsUserId, orgHiddenKeys, overrideUser) {
  // Premium tabs drop out entirely for clients not on the plan, before any
  // per-user scoping runs — an unsubscribed org has no one who can see them.
  const entitled = ALL_TAB_KEYS.filter((k) => !PREMIUM_TAB_KEYS.has(k) || hasPremiumPlan(client));
  const orgAllowed = entitled.filter((k) => k === ALWAYS_VISIBLE_KEY || !orgHiddenKeys.has(k));

  const user = overrideUser
    ? overrideUser
    : viewAsUserId && viewAsUserId !== BOOKKEEPER_VIEW
      ? (client.users || []).find((u) => u.id === viewAsUserId)
      : null;

  // The lead account (MyGoodBooks, via Manage Access) can throttle premium
  // features for one of the client's own people even though the client
  // itself is on Premium — e.g. a board member who shouldn't see the Pro
  // tools everyone else at the org gets. Purely per-user: it never changes
  // what the client is billed for. Every hasPremiumPlan(client) check that
  // decides whether to render the upgraded/Pro version of a page should use
  // this instead once a specific person (not "preview as MyGoodBooks") is
  // the one looking.
  const premiumForUser = hasPremiumPlan(client) && !(user && user.premiumThrottled);

  if (!user || user.access === "full") {
    return {
      user,
      tabs: new Set(orgAllowed),
      categories: null,
      funds: null,
      isCategoryScoped: false,
      isFullAccess: true,
      premiumForUser,
    };
  }

  const isCategoryScoped = Boolean(user.categories);
  const userTabs = user.tabs || orgAllowed;
  const tabs = orgAllowed.filter(
    (k) =>
      k === ALWAYS_VISIBLE_KEY ||
      (userTabs.includes(k) && !(isCategoryScoped && ORG_WIDE_TABS.has(k)))
  );

  return {
    user,
    tabs: new Set(tabs),
    categories: isCategoryScoped ? new Set(user.categories) : null,
    // A category-scoped person only ever sees funds explicitly listed for
    // them — no list means none, not "every fund" (unlike categories/tabs,
    // where an empty list falls back to the org default). Getting this
    // backwards is exactly how a ministry-area-scoped user ends up seeing
    // the org-wide fund total on their own dashboard, which the whole point
    // of scoping them says they shouldn't. A non-category-scoped restricted
    // user (tabs-only) isn't affected — they're on the unscoped dashboard,
    // where org-wide figures are expected.
    funds: user.funds ? new Set(user.funds) : isCategoryScoped ? new Set() : null,
    isCategoryScoped,
    isFullAccess: false,
    premiumForUser,
  };
}

// Narrows the client's records to just what this person is allowed to see.
// Presentation-layer only — see the Phase 5 note in the access modal.
function scopeClientData(client, access) {
  const cats = access.categories;
  const funds = access.funds;

  // Documents are gated by the bookkeeper-set visibility flag, independent of
  // category scoping — a tab-scoped user with no category limits still only
  // sees the org-wide ones. Anything unmarked defaults to org-wide.
  const documents = access.isFullAccess
    ? client.documents
    : client.documents.filter((d) => d.visibility !== "full");

  if (!cats && !funds) return { ...client, documents };

  return {
    ...client,
    documents,
    budget: cats ? client.budget.filter((b) => cats.has(b.category)) : client.budget,
    bankAccounts: client.bankAccounts.map((a) => ({
      ...a,
      transactions: cats ? a.transactions.filter((t) => cats.has(t.category)) : a.transactions,
    })),
    funds: funds ? client.funds.filter((f) => funds.has(f.name)) : client.funds,
    contributions: funds ? client.contributions.filter((c) => funds.has(c.fund)) : client.contributions,
  };
}

// Applies a client's custom drag order (if any) to a section's items. Any
// item not mentioned in the stored order (e.g. a tab added after the client
// last customized their order) falls back to the end, in its default spot.
function orderedSectionItems(section, tabOrder, clientId) {
  const customOrder = tabOrder[clientId] && tabOrder[clientId][section.label];
  if (!customOrder) return section.items;
  const byKey = Object.fromEntries(section.items.map((i) => [i.key, i]));
  const ordered = customOrder.filter((k) => byKey[k]).map((k) => byKey[k]);
  const missing = section.items.filter((i) => !customOrder.includes(i.key));
  return [...ordered, ...missing];
}

function Sidebar({
  clients,
  selectedClientId,
  onSelectClient,
  client,
  viewAsUserId,
  onSelectViewAs,
  access,
  page,
  onSelectPage,
  visibleKeys,
  tabOrder,
  onOpenSettings,
  badges,
  mobileOpen,
  onCloseMobile,
  effectiveTheme,
  onToggleTheme,
  staffUser,
  onSignOut,
  staffMessagesUnread,
  impersonating,
}) {
  // Must match App's `isPreviewingUser` guard: a viewAsUserId that no longer
  // resolves to a user (stale id, user removed) falls back to the bookkeeper
  // view rather than dereferencing a missing access.user below.
  const isBookkeeper = viewAsUserId === BOOKKEEPER_VIEW || !access.user;

  return (
    <aside className={"sidebar" + (mobileOpen ? " open" : "")}>
      <div className="brand">
        <a className="brand-link" href="https://mygoodbooks.org" target="_blank" rel="noopener noreferrer">
          <div className="brand-mark">
            <img src="logo.webp" alt="MyGoodBooks logo" className="brand-mark-img" />
          </div>
          <div className="brand-text">
            <span className="brand-name">MyGoodBooks</span>
            <span className="brand-sub">Client Portal</span>
          </div>
        </a>
        <button className="sidebar-close" onClick={onCloseMobile} aria-label="Close menu">
          ✕
        </button>
      </div>

      <div className="brand-tagline">Leave the bookkeeping to us.</div>

      {isBookkeeper ? (
        <React.Fragment>
          {/* Staff Access isn't about any client — showing a client picker
              there (and whichever client happened to be last selected) is
              exactly the confusing "why is a client's sidebar showing, I
              didn't pick one" report. Home drops it too, now that it has its
              own "Your clients" card (search + status at a glance) — a
              second, redundant way to do the same jump wasn't worth the
              sidebar space, and a dropdown is a worse version of that card
              on mobile besides. */}
          {!NON_CLIENT_PAGES.has(page) && (
            <React.Fragment>
              <div className="client-picker-label">Viewing client</div>
              <select className="client-select" value={selectedClientId} onChange={(e) => onSelectClient(e.target.value)}>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </React.Fragment>
          )}

          {staffUser && (
            <div className="client-picker-label" style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span>{staffUser.name}</span>
              <button
                onClick={onSignOut}
                style={{ background: "none", border: "none", color: "inherit", textDecoration: "underline", cursor: "pointer", font: "inherit", padding: 0 }}
              >
                Sign out
              </button>
            </div>
          )}

          {staffUser && (
            <button
              type="button"
              className={"staff-access-link" + (page === "bookkeeper-home" ? " active" : "")}
              onClick={() => {
                onSelectPage("bookkeeper-home");
                onCloseMobile();
              }}
            >
              <HomeIcon />
              Home
            </button>
          )}

          {staffUser && !impersonating && (
            <button
              type="button"
              className={"staff-access-link" + (page === "staff-messages" ? " active" : "")}
              onClick={() => {
                onSelectPage("staff-messages");
                onCloseMobile();
              }}
            >
              <ChatIcon width="16" height="16" strokeWidth="1.8" />
              Team Chat
              {staffMessagesUnread && <span className="nav-badge-dot" aria-label="Unread" style={{ marginLeft: "auto" }} />}
            </button>
          )}

          {staffUser && staffUser.role === "admin" && (
            <button
              type="button"
              className={"staff-access-link" + (page === "staff-access" ? " active" : "")}
              onClick={() => {
                onSelectPage("staff-access");
                onCloseMobile();
              }}
            >
              <UsersIcon />
              Staff Access
            </button>
          )}

          {staffUser && staffUser.role === "admin" && (
            <button
              type="button"
              className={"staff-access-link" + (page === "client-access" ? " active" : "")}
              onClick={() => {
                onSelectPage("client-access");
                onCloseMobile();
              }}
            >
              <ClientRosterIcon />
              Client Roster
            </button>
          )}

          {staffUser && staffUser.role === "admin" && (
            <button
              type="button"
              className={"staff-access-link" + (page === "developer-tools" ? " active" : "")}
              onClick={() => {
                onSelectPage("developer-tools");
                onCloseMobile();
              }}
            >
              <WrenchIcon />
              Developer Tools
            </button>
          )}

          {!NON_CLIENT_PAGES.has(page) && (
            <React.Fragment>
              <div className="client-picker-label">Preview as</div>
              <select className="client-select" value={viewAsUserId} onChange={(e) => onSelectViewAs(e.target.value)}>
                {/* Real name/email for the signed-in staffer replaces the old
                    shared "MyGoodBooks (full access)" sentinel label — the
                    underlying value stays BOOKKEEPER_VIEW so resolveAccess() and
                    everything downstream is untouched. */}
                <option value={BOOKKEEPER_VIEW}>
                  {staffUser ? `${staffUser.name} (full access)` : "MyGoodBooks (full access)"}
                </option>
                {(client.users || []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} — {u.role}
                  </option>
                ))}
              </select>
            </React.Fragment>
          )}
        </React.Fragment>
      ) : (
        <div className="signed-in-as">
          <div className="signed-in-avatar">
            {access.user.name
              .split(" ")
              .map((p) => p[0])
              .slice(0, 2)
              .join("")}
          </div>
          <div className="signed-in-text">
            <span className="signed-in-name">{access.user.name}</span>
            <span className="signed-in-role">{access.user.role}</span>
          </div>
        </div>
      )}

      {NON_CLIENT_PAGES.has(page) ? null : (
      <nav className="nav">
        {NAV_SECTIONS.map((section) => {
          const isSignature = section.label === "Enterprise";
          // Standard-plan clients don't have the premium tabs at all
          // (stripped out of access.tabs in resolveAccess), so `items`
          // below already narrows itself to just Dashboard/Messages for
          // them — no separate branch needed to keep those two reachable.
          // The Premium badge + lock live on the section heading itself
          // (clickable, opens the upgrade page) rather than a separate row
          // spelling out which tools are locked.
          const showUpsell = isSignature && !access.premiumForUser;
          const items = orderedSectionItems(section, tabOrder, selectedClientId).filter((item) => visibleKeys.has(item.key));
          if (items.length === 0 && !showUpsell) return null;
          // Enterprise gets a static gold heading (not a toggle — it no
          // longer collapses, so there's nothing for a click to do here).
          // Every other section renders no heading at all, same as before.
          const sectionId = "nav-section-" + slugify(section.label);
          return (
            <div className={"nav-section" + (isSignature ? " nav-section-signature" : "")} key={section.label}>
              {isSignature &&
                (showUpsell ? (
                  <button
                    type="button"
                    className="nav-section-label nav-section-label-signature nav-upsell-trigger"
                    onClick={() => {
                      onSelectPage("enterprise-upgrade");
                      onCloseMobile();
                    }}
                  >
                    <span>{section.label}</span>
                    <span className="nav-signature-badge">Premium</span>
                    <LockIcon className="nav-upsell-icon" />
                  </button>
                ) : (
                  <div className="nav-section-label nav-section-label-signature nav-section-label-static">
                    <span>{section.label}</span>
                    <span className="nav-signature-badge nav-signature-badge-shimmer">Pro Client</span>
                  </div>
                ))}
              <div className="nav-section-items" id={sectionId}>
                {items.map((item) => {
                  // Same tab, same name, for every plan — the PRO pill (and
                  // the gold shimmer that used to mark a whole separate
                  // premium-only tab) is the only thing that marks this one
                  // as showing the upgraded page underneath. See
                  // PREMIUM_UPGRADE_TAB_KEYS and the showsBudgetingTool/
                  // showsCashFlowPro/showsReportBuilder/showsReconciliationPro/
                  // showsFundAccountingPro checks in App.
                  const isUpgraded =
                    PREMIUM_UPGRADE_TAB_KEYS.has(item.key) && access && access.premiumForUser && !access.isCategoryScoped;
                  return (
                  <button
                    key={item.key}
                    className={"nav-item" + (page === item.key ? " active" : "") + (isUpgraded ? " nav-item-signature" : "")}
                    onClick={() => {
                      onSelectPage(item.key);
                      onCloseMobile();
                    }}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                    {badges[item.key] && <span className="nav-badge-dot" aria-label="Unread"></span>}
                  </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>
      )}

      <div className="sidebar-utility-row">
        {isBookkeeper && !NON_CLIENT_PAGES.has(page) ? (
          <button className="customize-tabs-btn" onClick={onOpenSettings}>
            <SlidersIcon /> Manage access
          </button>
        ) : isBookkeeper ? (
          <span className="sidebar-utility-label">{effectiveTheme === "dark" ? "Dark mode" : "Light mode"}</span>
        ) : (
          // Clients don't get "Manage access", and the toggle's margin-left:auto
          // left it floating alone against the right edge above a tall empty
          // gap. Labelling it fills the row and says what the button does.
          <span className="sidebar-utility-label">
            {effectiveTheme === "dark" ? "Dark mode" : "Light mode"}
          </span>
        )}
        <button
          className="theme-toggle theme-toggle-signature"
          onClick={onToggleTheme}
          aria-label={effectiveTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          title={effectiveTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {effectiveTheme === "dark" ? <SunIcon /> : <MoonIcon />}
        </button>
      </div>

      <div className="sidebar-footer">
        {isBookkeeper
          ? "Client and preview switchers are bookkeeper-side tools. Clients never see them."
          : `Signed in to ${client.name}. Access is managed by MyGoodBooks.`}
      </div>
    </aside>
  );
}

// ----------------------------------------------------------------------------
// Shared bits
// ----------------------------------------------------------------------------

// Small inline icons, all in the same thin-line, currentColor style as
// ENTERPRISE_FEATURES' icons and the chat icon — no emoji anywhere in the
// app. `.icon-inline` (styles.css) handles the baseline alignment every
// call site needs when it sits next to text.
function WarningIcon(props) {
  return (
    <svg className="icon-inline" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 4l9.5 16.5H2.5L12 4z" />
      <path d="M12 10v4.5M12 17.5h.01" />
    </svg>
  );
}

function SearchIcon(props) {
  return (
    <svg className="icon-inline" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M20 20l-4.8-4.8" />
    </svg>
  );
}

function LockIcon(props) {
  return (
    <svg className="icon-inline" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

function PaperclipIcon(props) {
  return (
    <svg className="icon-inline" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M17 7.5l-8 8a3 3 0 004.24 4.24l8-8a5 5 0 00-7.07-7.07l-8.2 8.2a7 7 0 009.9 9.9" />
    </svg>
  );
}

function FlaskIcon(props) {
  return (
    <svg className="icon-inline" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M9 3h6M10 3v6.5L4.8 18a2 2 0 001.7 3h11a2 2 0 001.7-3L14 9.5V3" />
      <path d="M7.5 15h9" />
    </svg>
  );
}

function SunIcon(props) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 2.5v3M12 18.5v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2.5 12h3M18.5 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
    </svg>
  );
}

function MoonIcon(props) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z" />
    </svg>
  );
}

function SlidersIcon(props) {
  return (
    <svg className="icon-inline" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M4 6h10M17 6h3M4 12h3M9 12h11M4 18h13M20 18h0" />
      <circle cx="14" cy="6" r="2" />
      <circle cx="6" cy="12" r="2" />
      <circle cx="16" cy="18" r="2" />
    </svg>
  );
}

function DocumentIcon(props) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M9 8h6M9 12h6M9 16h4" />
    </svg>
  );
}

function BarChartIcon(props) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M4 20V10M9.5 20V4M15 20V13M20.5 20V7" />
    </svg>
  );
}

function ShieldCheckIcon(props) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

function ChatIcon(props) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M4 5h16v11H8l-4 4V5z" />
      <path d="M8 10h8M8 13h5" />
    </svg>
  );
}

// ----------------------------------------------------------------------------
// Sidebar nav icons — one per tab (see NAV_SECTIONS), plus Home/Staff
// Access/Client Roster's own icons rendered separately above the nav. Same
// thin-line, stroke="currentColor" house style as every other icon.
// ----------------------------------------------------------------------------

function HomeIcon(props) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M4 11.5L12 4l8 7.5" />
      <path d="M6 10v9h12v-9" />
    </svg>
  );
}

function UsersIcon(props) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="9" cy="8" r="3" />
      <path d="M2 20c0-3.5 3-6 7-6s7 2.5 7 6" />
      <path d="M16 8a3 3 0 100-6" />
      <path d="M22 20c0-2.8-2-5-5-5.7" />
    </svg>
  );
}

function ClientRosterIcon(props) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18M8 4v5" />
    </svg>
  );
}

function WrenchIcon(props) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M14.7 6.3a4 4 0 00-5.4 5.4L4 17v3h3l5.3-5.3a4 4 0 005.4-5.4l-2.6 2.6-2-2z" />
    </svg>
  );
}

function ChevronUpIcon(props) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M5 15l7-7 7 7" />
    </svg>
  );
}

function ChevronDownIcon(props) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M5 9l7 7 7-7" />
    </svg>
  );
}

function GridIcon(props) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.3" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.3" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.3" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.3" />
    </svg>
  );
}

function PieChartIcon(props) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 12V3a9 9 0 019 9h-9z" />
      <path d="M20.5 15A9 9 0 1112 3v9l8.5 3z" />
    </svg>
  );
}

function BankIcon(props) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M3 10l9-6 9 6" />
      <path d="M5 10v9M10 10v9M14 10v9M19 10v9" />
      <path d="M3 19h18" />
    </svg>
  );
}

function SwapIcon(props) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M7 7h11l-3-3M17 17H6l3 3" />
    </svg>
  );
}

function CalculatorIcon(props) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M8 8h8M8 12h1M12 12h1M16 12h1M8 16h1M12 16h1M16 16h1" />
    </svg>
  );
}

function StackedBillsIcon(props) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="4" y="4" width="14" height="10" rx="1.5" />
      <rect x="7" y="9" width="14" height="10" rx="1.5" />
    </svg>
  );
}

function DownloadIcon(props) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 3v13M7 12l5 5 5-5" />
      <path d="M4 20h16" />
    </svg>
  );
}

function GiftHeartIcon(props) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 21s-7-4.5-9.5-9A5 5 0 0112 6a5 5 0 019.5 6c-2.5 4.5-9.5 9-9.5 9z" />
    </svg>
  );
}

function FolderIcon(props) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
    </svg>
  );
}

function UploadIcon(props) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 16V4M12 4l-4 4M12 4l4 4" />
      <path d="M4 16v3a2 2 0 002 2h12a2 2 0 002-2v-3" />
    </svg>
  );
}

function FileIcon(props) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M6 3h8l5 5v13a1 1 0 01-1 1H6a1 1 0 01-1-1V4a1 1 0 011-1z" />
      <path d="M14 3v5h5" />
    </svg>
  );
}

function MockBanner({ text }) {
  return (
    <div className="mock-banner">
      <FlaskIcon /> {text}
    </div>
  );
}

// Real (non-AI) search — filters this client's own transactions, budget
// categories, documents, and messages by keyword and jumps to the right
// page. Only searches within tabs the current viewer actually has access to.
function GlobalSearch({ client, messages, visibleKeys, onNavigate, onHighlightResult }) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    const onDocClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setIsOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out = [];

    if (visibleKeys.has("bank")) {
      client.bankAccounts.forEach((a) => {
        a.transactions.forEach((t, i) => {
          if (t.description.toLowerCase().includes(q) || t.category.toLowerCase().includes(q)) {
            out.push({
              type: "Transaction",
              label: t.description,
              meta: `${fmtDate(t.date)} · ${fmtMoney(t.amount, { cents: true })} · ${a.accountName}`,
              page: "bank",
              highlightKey: "tx-" + i,
              accountId: a.id,
            });
          }
        });
      });
    }

    if (visibleKeys.has("budget")) {
      client.budget.forEach((b) => {
        if (b.category.toLowerCase().includes(q)) {
          out.push({
            type: "Budget",
            label: b.category,
            meta: `${fmtMoney(b.actual)} of ${fmtMoney(b.budgeted)} budgeted`,
            page: "budget",
            highlightKey: "budget-row-" + slugify(b.category),
          });
        }
      });
    }

    if (visibleKeys.has("documents") && client.documents) {
      client.documents.forEach((d) => {
        if (d.name.toLowerCase().includes(q) || d.category.toLowerCase().includes(q)) {
          out.push({
            type: "Document",
            label: d.name,
            meta: `${d.category} · ${fmtDate(d.date)}`,
            page: "documents",
            highlightKey: "doc-row-" + slugify(d.name),
          });
        }
      });
    }

    if (visibleKeys.has("messages")) {
      messages.forEach((m, i) => {
        if (m.text && m.text.toLowerCase().includes(q)) {
          out.push({
            type: "Message",
            label: m.text.length > 70 ? m.text.slice(0, 70) + "…" : m.text,
            meta: `${m.author} · ${fmtDate(m.date)}`,
            page: "messages",
            highlightKey: "msg-" + i,
          });
        }
      });
    }

    return out.slice(0, 8);
  }, [query, client, messages, visibleKeys]);

  const go = (r) => {
    onNavigate(r.page);
    if (onHighlightResult) onHighlightResult(r);
    setIsOpen(false);
    setQuery("");
  };

  return (
    <div className="global-search" ref={wrapRef}>
      <div className="global-search-row">
        <span className="global-search-icon">
          <SearchIcon />
        </span>
        <input
          type="text"
          className="global-search-input"
          placeholder="Search transactions, budget categories, documents, messages…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
        />
      </div>

      {isOpen && query.trim() && (
        <div className="global-search-results">
          {results.length === 0 ? (
            <div className="global-search-empty">No matches for "{query.trim()}".</div>
          ) : (
            results.map((r, i) => (
              <button className="global-search-result" key={i} onClick={() => go(r)}>
                <span className="global-search-result-type">{r.type}</span>
                <span className="global-search-result-body">
                  <span className="global-search-result-label">{r.label}</span>
                  <span className="global-search-result-meta">{r.meta}</span>
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// Referral promo popup. The message is written by MyGoodBooks and shown the
// same way to every client — nobody at the client organization can edit it.
// Appears as a dismissible popup rather than sitting inline on the page.
function ReferralPopup({ isBookkeeper, promoText, onSave }) {
  const [isMounted, setIsMounted] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(promoText);
  const [isReferring, setIsReferring] = useState(false);
  const [friendName, setFriendName] = useState("");
  const [friendEmail, setFriendEmail] = useState("");
  const [emailMessage, setEmailMessage] = useState(DEFAULT_REFERRAL_EMAIL_MESSAGE);
  const showToast = useToast();
  const autoHideTimer = useRef(null);
  const engagedRef = useRef(false);

  const cancelAutoHide = () => {
    engagedRef.current = true;
    if (autoHideTimer.current) {
      clearTimeout(autoHideTimer.current);
      autoHideTimer.current = null;
    }
  };

  const close = () => {
    cancelAutoHide();
    dismissReferralPopup();
    setIsVisible(false);
    setTimeout(() => {
      setIsMounted(false);
      setIsEditing(false);
      setIsReferring(false);
    }, 300);
  };

  // Pops in 3s after load, then fades itself out after 30s if the client
  // hasn't closed or engaged with it (editing/referring cancels the timer).
  useEffect(() => {
    if (wasReferralPopupDismissed()) return;
    const showTimer = setTimeout(() => {
      setIsMounted(true);
      requestAnimationFrame(() => setIsVisible(true));
      autoHideTimer.current = setTimeout(() => {
        if (!engagedRef.current) close();
      }, 30000);
    }, 3000);
    return () => clearTimeout(showTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!isMounted) return null;

  const startEditing = () => {
    cancelAutoHide();
    setDraft(promoText);
    setIsEditing(true);
  };

  const save = () => {
    const trimmed = draft.trim();
    onSave(trimmed || DEFAULT_REFERRAL_PROMO);
    setIsEditing(false);
    showToast("Referral message updated for all clients.");
  };

  const startReferring = () => {
    cancelAutoHide();
    setFriendName("");
    setFriendEmail("");
    setEmailMessage(DEFAULT_REFERRAL_EMAIL_MESSAGE);
    setIsReferring(true);
  };

  const sendReferral = () => {
    if (!friendEmail.trim()) return;
    showToast(`Referral email sent to ${friendName.trim() || friendEmail.trim()}.`);
    setIsReferring(false);
  };

  return (
    <div
      className={
        "card referral-card referral-popup " +
        (isReferring ? "referral-center" : "referral-corner") +
        (isVisible ? " referral-visible" : "")
      }
    >
      <div className="referral-card-header">
        <span className="referral-badge">Give $100, Get $100</span>
        <div className="referral-header-actions">
          {isBookkeeper && !isEditing && !isReferring && (
            <button className="referral-edit-btn" onClick={startEditing}>
              Edit
            </button>
          )}
          <button className="modal-close" onClick={close} aria-label="Close">
            ×
          </button>
        </div>
      </div>

      {isEditing ? (
        <div className="referral-edit">
          <textarea
            className="referral-textarea"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
          />
          <div className="referral-edit-actions">
            <button className="btn-secondary" onClick={() => setIsEditing(false)}>
              Cancel
            </button>
            <button className="btn-primary" onClick={save}>
              Save
            </button>
          </div>
        </div>
      ) : isReferring ? (
        <div className="referral-form">
          <p className="referral-form-intro">Send a friend a quick note about MyGoodBooks.</p>
          <div className="referral-form-row">
            <div className="referral-form-field">
              <label>Friend's name</label>
              <input
                type="text"
                value={friendName}
                onChange={(e) => setFriendName(e.target.value)}
                placeholder="Jane Smith"
              />
            </div>
            <div className="referral-form-field">
              <label>Friend's email</label>
              <input
                type="email"
                value={friendEmail}
                onChange={(e) => setFriendEmail(e.target.value)}
                placeholder="jane@example.com"
              />
            </div>
          </div>
          <div className="referral-form-field">
            <label>Message</label>
            <textarea
              className="referral-textarea"
              rows={6}
              value={emailMessage}
              onChange={(e) => setEmailMessage(e.target.value)}
            />
          </div>
          <div className="referral-edit-actions">
            <button className="btn-secondary" onClick={() => setIsReferring(false)}>
              Back
            </button>
            <button className="btn-primary" disabled={!friendEmail.trim()} onClick={sendReferral}>
              Send Email
            </button>
          </div>
          <span className="modal-footnote">Prototype — this doesn't send a real email yet.</span>
        </div>
      ) : (
        <>
          <p className="referral-text">{promoText}</p>
          <button className="btn-primary referral-refer-btn" onClick={startReferring}>
            Refer a Friend
          </button>
        </>
      )}
    </div>
  );
}

// Circular progress ring used for the Operating Reserve KPI (Option C direction).
// `pct` is 0-1; `tone` picks the good/bad color via the existing --good/--bad
// tokens so it stays in sync with the text tone used elsewhere on the card.
function RunwayRing({ pct, tone, children }) {
  const r = 42;
  const c = 2 * Math.PI * r;
  const trackColor = tone === "negative" ? "var(--bad-soft)" : "var(--good-soft)";
  const ringColor = tone === "negative" ? "var(--bad)" : "var(--good)";
  return (
    <div className="runway-ring-wrap">
      <svg width="108" height="108" viewBox="0 0 108 108">
        <circle cx="54" cy="54" r={r} fill="none" stroke={trackColor} strokeWidth="9" />
        <circle
          cx="54"
          cy="54"
          r={r}
          fill="none"
          stroke={ringColor}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          transform="rotate(-90 54 54)"
        />
      </svg>
      <div className="runway-ring-center">{children}</div>
    </div>
  );
}

// Builds a smooth cubic-bezier path through a set of {x,y} points, using the
// midpoint between each pair as the control-point anchor — cheap and good
// enough for a year of monthly points, no need for full Catmull-Rom.
function smoothLinePath(points) {
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const midX = (p0.x + p1.x) / 2;
    d += ` C ${midX} ${p0.y}, ${midX} ${p1.y}, ${p1.x} ${p1.y}`;
  }
  return d;
}

function smoothAreaPath(points, baseline) {
  let d = `M ${points[0].x} ${baseline} L ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const midX = (p0.x + p1.x) / 2;
    d += ` C ${midX} ${p0.y}, ${midX} ${p1.y}, ${p1.x} ${p1.y}`;
  }
  d += ` L ${points[points.length - 1].x} ${baseline} Z`;
  return d;
}

// Filled area chart (Option C direction) — replaces the old grouped bars.
// budgetTotal is optional — only Budget vs. Actual/Budgeting Tool's Spending
// Trend pass it (the sum of client.budget's budgeted amounts). When present,
// this draws a dashed reference line at that value and shades the gap
// between the income/expense lines green where income is ahead, red where
// expenses are — both were picked from a 5-option mockup as the pair that
// actually ties this chart to a Budget page rather than just repeating
// Dashboard's generic version of the same chart, which is why Dashboard's
// own call site never passes budgetTotal and stays exactly as it was.
function IncomeExpenseChart({ monthly, budgetTotal }) {
  const width = 640;
  const height = 220;
  const padding = { top: 32, right: 14, bottom: 28, left: 46 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const baseline = padding.top + innerH;

  const maxVal = Math.max(...monthly.flatMap((m) => [m.income, m.expenses]), budgetTotal || 0) * 1.15;

  const yTicks = 4;
  const tickVals = Array.from({ length: yTicks + 1 }, (_, i) => (maxVal / yTicks) * i);

  const xFor = (i) => padding.left + (monthly.length === 1 ? innerW / 2 : (i / (monthly.length - 1)) * innerW);
  const yFor = (v) => baseline - (v / maxVal) * innerH;
  const incomePoints = monthly.map((m, i) => ({ x: xFor(i), y: yFor(m.income) }));
  const expensePoints = monthly.map((m, i) => ({ x: xFor(i), y: yFor(m.expenses) }));

  const gradientId = `oc-income-fill-${monthly.length}-${Math.round(maxVal)}`;
  const gradientIdExp = `oc-expense-fill-${monthly.length}-${Math.round(maxVal)}`;

  // Straight-line segments between each pair of months, not the smoothed
  // curve the strokes use — a curved fill boundary would either overshoot
  // the actual crossing point between income and expenses or need finding
  // that intersection analytically. A visible kink in a translucent fill is
  // a fair trade for the fill always matching exactly where the two lines
  // actually cross.
  const surplusSegments = budgetTotal
    ? monthly.slice(0, -1).map((m, i) => {
        const positive = m.income >= m.expenses && monthly[i + 1].income >= monthly[i + 1].expenses;
        const p0i = incomePoints[i],
          p1i = incomePoints[i + 1],
          p0e = expensePoints[i],
          p1e = expensePoints[i + 1];
        return {
          key: i,
          positive,
          d: `M ${p0i.x} ${p0i.y} L ${p1i.x} ${p1i.y} L ${p1e.x} ${p1e.y} L ${p0e.x} ${p0e.y} Z`,
        };
      })
    : [];

  const budgetY = budgetTotal ? yFor(budgetTotal) : null;

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-income)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--chart-income)" stopOpacity="0.02" />
          </linearGradient>
          <linearGradient id={gradientIdExp} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--gold)" stopOpacity="0.4" />
            <stop offset="100%" stopColor="var(--gold)" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        <g className="chart-inline-legend">
          <rect x={width - 190} y="10" width="10" height="10" rx="2" fill="var(--chart-income)" />
          <text x={width - 176} y="19" fontSize="11.5" fill="var(--text-muted)">Income</text>
          <rect x={width - 100} y="10" width="10" height="10" rx="2" fill="var(--gold)" />
          <text x={width - 86} y="19" fontSize="11.5" fill="var(--text-muted)">Expenses</text>
        </g>

        {tickVals.map((v, i) => {
          const y = padding.top + innerH - (v / maxVal) * innerH;
          return (
            <g key={i}>
              <line x1={padding.left} x2={width - padding.right} y1={y} y2={y} stroke="var(--border)" strokeWidth="1" />
              <text className="count-up" x={padding.left - 8} y={y + 4} fontSize="10.5" fill="var(--text-muted)" textAnchor="end">
                {v >= 1000 ? `${Math.round(v / 1000)}k` : Math.round(v)}
              </text>
            </g>
          );
        })}

        {surplusSegments.map((s) => (
          <path key={s.key} d={s.d} fill={s.positive ? "var(--good)" : "var(--bad)"} fillOpacity="0.16" />
        ))}

        {budgetTotal != null && (
          <g>
            <line
              x1={padding.left}
              x2={width - padding.right}
              y1={budgetY}
              y2={budgetY}
              stroke="var(--gold)"
              strokeWidth="1.5"
              strokeDasharray="5 4"
            />
            <text x={width - padding.right} y={budgetY - 6} fontSize="10.5" fill="var(--gold)" textAnchor="end">
              Budgeted {fmtMoney(budgetTotal)}/mo
            </text>
          </g>
        )}

        <path d={smoothAreaPath(expensePoints, baseline)} fill={`url(#${gradientIdExp})`} />
        <path d={smoothLinePath(expensePoints)} fill="none" stroke="var(--gold)" strokeWidth="2" />
        <path d={smoothAreaPath(incomePoints, baseline)} fill={`url(#${gradientId})`} />
        <path d={smoothLinePath(incomePoints)} fill="none" stroke="var(--chart-income)" strokeWidth="2.5" />

        {incomePoints.map((p, i) => (
          <circle key={"i" + i} cx={p.x} cy={p.y} r="3.5" fill="var(--surface)" stroke="var(--chart-income)" strokeWidth="2" />
        ))}
        {expensePoints.map((p, i) => (
          <circle key={"e" + i} cx={p.x} cy={p.y} r="3.5" fill="var(--surface)" stroke="var(--gold)" strokeWidth="2" />
        ))}

        {monthly.map((m, i) => (
          <text key={m.month} x={xFor(i)} y={height - 8} fontSize="11.5" fill="var(--text-muted)" textAnchor="middle">
            {m.month}
          </text>
        ))}
      </svg>
    </div>
  );
}

// Ledger-style breakdown of this month's transactions by subcategory account
// — income and expense rolled up into the two chart lines above hides which
// specific accounts (Payroll, Utilities, Giving, ...) actually moved. Reuses
// the same bar-track/bar-fill visual language as the Budget vs. Actual page
// so it reads as "the ledger", not a new visual system. Already-scoped data
// in, so a category-scoped client only ever sees their own subcategories.
function CategoryLedger({ client }) {
  const latestMonth = client.monthly[client.monthly.length - 1];
  if (!latestMonth) return null;
  const monthPrefix = latestMonth.month; // e.g. "Aug" — matched against tx dates below

  const monthTx = client.bankAccounts
    .flatMap((a) => a.transactions)
    .filter((t) => {
      const d = new Date(t.date + "T00:00:00");
      return MONTH_ABBR[d.getMonth()] === monthPrefix;
    });

  if (monthTx.length === 0) return null;

  const byCategory = {};
  monthTx.forEach((t) => {
    byCategory[t.category] = (byCategory[t.category] || 0) + t.amount;
  });
  const rows = Object.entries(byCategory)
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.amount)), 1);

  return (
    <div className="category-ledger">
      <p className="card-subtitle category-ledger-title">Subcategory accounts, {monthPrefix}</p>
      <div className="ledger-list">
        {rows.map((r) => {
          const pct = (Math.abs(r.amount) / maxAbs) * 100;
          const positive = r.amount >= 0;
          return (
            <div className="ledger-row" key={r.category}>
              <div className="ledger-row-top">
                <span className="ledger-category">{r.category}</span>
                <span className={"ledger-amount count-up " + (positive ? "positive" : "negative")}>
                  {positive ? "+" : ""}
                  {fmtMoney(r.amount, { cents: true })}
                </span>
              </div>
              <div className="bar-track">
                <div
                  className={"bar-fill " + (positive ? "under" : "over")}
                  style={{ width: `${pct}%`, animationDuration: `${growDuration(pct)}ms` }}
                ></div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Cards pulled in from other tabs so a client can build their dashboard into
// a single hub for everything they might want to see — gated by access.tabs,
// so a widget only shows up as an option if the client can already see that
// tab's real page. Each id is namespaced "xt-<tab>-..." to keep it distinct
// from the dashboard's own native widgets.
function crossTabWidgetDefs(client, access) {
  const defs = [];

  if (access.tabs.has("budget") && client.budget.length > 0) {
    const totals = client.budget.reduce((a, b) => ({ budgeted: a.budgeted + b.budgeted, actual: a.actual + b.actual }), { budgeted: 0, actual: 0 });
    defs.push({
      id: "xt-budget-summary",
      group: "content",
      sourceTab: "Budget vs. Actual",
      label: "Budget Totals",
      description: "Total budgeted, actual, and variance this month",
      render: () => (
        <>
          <h3 className="card-title">Budget Totals</h3>
          <p className="card-subtitle">Budgeted vs. actual, this month</p>
          <div className="mini-stat-row">
            <div className="mini-stat">
              <span className="kpi-label">Budgeted</span>
              <span className="kpi-value">{fmtMoney(totals.budgeted)}</span>
            </div>
            <div className="mini-stat">
              <span className="kpi-label">Actual</span>
              <span className="kpi-value">{fmtMoney(totals.actual)}</span>
            </div>
            <div className="mini-stat">
              <span className="kpi-label">Variance</span>
              <span className={"kpi-value " + (totals.actual > totals.budgeted ? "negative" : "positive")}>
                {fmtMoney(totals.actual - totals.budgeted)}
              </span>
            </div>
          </div>
        </>
      ),
    });
  }

  if (access.tabs.has("bank") && client.bankAccounts.length > 0) {
    defs.push({
      id: "xt-bank-accounts",
      group: "content",
      sourceTab: "Bank Accounts",
      label: "Bank Accounts",
      description: "Balance for each connected account",
      render: () => (
        <>
          <h3 className="card-title">Bank Accounts</h3>
          <p className="card-subtitle">{fmtMoney(totalCash(client))} across {client.bankAccounts.length} account{client.bankAccounts.length > 1 ? "s" : ""}</p>
          <div className="tx-list">
            {client.bankAccounts.map((a) => (
              <div className="tx-row" key={a.id}>
                <div>
                  <div className="tx-desc">{a.accountName}</div>
                  <div className="tx-meta">{a.type} · ending {a.accountMask}</div>
                </div>
                <div className="tx-amount positive">{fmtMoney(a.balance, { cents: true })}</div>
              </div>
            ))}
          </div>
        </>
      ),
    });
  }

  if (access.tabs.has("receivables") && (client.receivables.length > 0 || client.payables.length > 0)) {
    const totalReceivable = client.receivables.reduce((s, r) => s + r.amount, 0);
    const totalPayable = client.payables.reduce((s, p) => s + p.amount, 0);
    defs.push({
      id: "xt-receivables-payables",
      group: "content",
      sourceTab: "Cash Flow",
      label: "Cash Flow",
      description: "What's owed to you and what you owe",
      render: () => (
        <>
          <h3 className="card-title">Cash Flow</h3>
          <p className="card-subtitle">Net position: {fmtMoney(totalReceivable - totalPayable)}</p>
          <div className="mini-stat-row">
            <div className="mini-stat">
              <span className="kpi-label">Owed to you</span>
              <span className="kpi-value positive">{fmtMoney(totalReceivable)}</span>
            </div>
            <div className="mini-stat">
              <span className="kpi-label">You owe</span>
              <span className="kpi-value negative">{fmtMoney(totalPayable)}</span>
            </div>
          </div>
        </>
      ),
    });
  }

  if (access.tabs.has("giving") && ((client.funds || []).length > 0 || (client.contributions || []).length > 0)) {
    const totalGiving = (client.contributions || []).reduce((s, c) => s + c.amount, 0);
    defs.push({
      id: "xt-giving-summary",
      group: "content",
      sourceTab: "Giving & Funds",
      label: "Giving & Funds",
      description: "Recent giving and fund balances",
      render: () => (
        <>
          <h3 className="card-title">Giving & Funds</h3>
          <p className="card-subtitle">{fmtMoney(totalGiving)} in recent giving</p>
          <div className="tx-list">
            {(client.funds || []).map((f) => (
              <div className="tx-row" key={f.name}>
                <div>
                  <div className="tx-desc">{f.name}</div>
                  <div className="tx-meta">{f.restricted ? "Restricted" : "Unrestricted"}</div>
                </div>
                <div className="tx-amount positive">{fmtMoney(f.balance)}</div>
              </div>
            ))}
          </div>
        </>
      ),
    });
  }

  return defs;
}

// ----------------------------------------------------------------------------
// Dashboard page
// ----------------------------------------------------------------------------

// Dashboard for someone scoped to specific ministry areas. Deliberately omits
// org-wide figures (total cash, revenue, operating reserve) — not theirs to see.
function ScopedDashboardPage({ client, access, isBookkeeper, promoText, onSaveReferralPromo }) {
  const budgeted = client.budget.reduce((s, b) => s + b.budgeted, 0);
  const spent = client.budget.reduce((s, b) => s + b.actual, 0);
  const remaining = budgeted - spent;
  const areas = Array.from(access.categories).join(", ");

  const twoMonthsAgo = monthsAgoLocal(2);
  const myTx = client.bankAccounts
    .flatMap((a) => a.transactions)
    .filter((t) => t.date >= twoMonthsAgo)
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  const myFunds = client.funds || [];

  const widgets = [
    { id: "kpi-budgeted", group: "kpi", label: "Budgeted (your areas)", description: "This month's budget" },
    { id: "kpi-spent", group: "kpi", label: "Spent (your areas)", description: "Actual spend, current month" },
    { id: "kpi-remaining", group: "kpi", label: "Remaining", description: "Budget left this month" },
    ...(myFunds.length > 0
      ? [{ id: "kpi-funds", group: "kpi", label: myFunds.length === 1 ? myFunds[0].name : "Your Funds", description: "Available balance" }]
      : []),
    { id: "your-budget", group: "content", label: "Your Budget", description: "Budgeted vs. actual, current month" },
    { id: "recent-activity", group: "content", label: "Your Recent Activity", description: "Transactions in your areas" },
    ...crossTabWidgetDefs(client, access),
  ];
  const crossTabById = Object.fromEntries(widgets.filter((w) => w.id.startsWith("xt-")).map((w) => [w.id, w]));
  const layout = useWidgetLayout(`${client.id}:scoped:${Array.from(access.categories).sort().join(",")}`, widgets.map((w) => w.id));
  const drag = useDragReorder(layout);
  const kpiOrder = layout.visibleOrder.filter((id) => id.startsWith("kpi-"));
  const { flashCardId, jumpToCard } = useCardFlash();
  const jumpToBudget = layout.hidden.has("your-budget") ? null : () => jumpToCard("sdp-your-budget-card", "your-budget");

  return (
    <div>
      <MockBanner text="Every number on this page is sample data for prototyping — no QuickBooks or bank connection yet." />

      {/* Referral popup disabled for now — component kept below, re-add here when it's back on. */}

      <div className="scope-notice">
        You're seeing <strong>{areas}</strong>. Other areas of {client.name}'s finances aren't part of your access.
      </div>

      <CustomizeDashboardButton widgets={widgets} layout={layout} />

      <div className="kpi-grid">
        {kpiOrder.map((id) => {
          if (id === "kpi-budgeted") {
            const Tag = jumpToBudget ? "button" : "div";
            return (
              <Tag
                className={"card kpi-card " + (jumpToBudget ? "kpi-card-clickable " : "") + drag.dragClass(id)}
                key={id}
                {...drag.dragProps(id)}
                {...(jumpToBudget ? { onClick: jumpToBudget } : {})}
              >
                <span className="kpi-label">Budgeted (your areas)</span>
                <span className="kpi-value">{fmtMoney(budgeted)}</span>
                <span className="kpi-sub neutral">this month</span>
              </Tag>
            );
          }
          if (id === "kpi-spent") {
            const Tag = jumpToBudget ? "button" : "div";
            return (
              <Tag
                className={"card kpi-card " + (jumpToBudget ? "kpi-card-clickable " : "") + drag.dragClass(id)}
                key={id}
                {...drag.dragProps(id)}
                {...(jumpToBudget ? { onClick: jumpToBudget } : {})}
              >
                <span className="kpi-label">Spent (your areas)</span>
                <span className="kpi-value">{fmtMoney(spent)}</span>
                <span className={"kpi-sub " + (spent > budgeted ? "negative" : "positive")}>
                  {spent > budgeted ? "Over budget" : "Within budget"}
                </span>
              </Tag>
            );
          }
          if (id === "kpi-remaining") {
            const Tag = jumpToBudget ? "button" : "div";
            return (
              <Tag
                className={"card kpi-card " + (jumpToBudget ? "kpi-card-clickable " : "") + drag.dragClass(id)}
                key={id}
                {...drag.dragProps(id)}
                {...(jumpToBudget ? { onClick: jumpToBudget } : {})}
              >
                <span className="kpi-label">Remaining</span>
                <span className="kpi-value">{fmtMoney(remaining)}</span>
                <span className="kpi-sub neutral">{budgeted > 0 ? `${Math.round((spent / budgeted) * 100)}% used` : "—"}</span>
              </Tag>
            );
          }
          if (id === "kpi-funds" && myFunds.length > 0)
            return (
              <div className={"card kpi-card " + drag.dragClass(id)} key={id} {...drag.dragProps(id)}>
                <span className="kpi-label">{myFunds.length === 1 ? myFunds[0].name : "Your Funds"}</span>
                <span className="kpi-value">{fmtMoney(myFunds.reduce((s, f) => s + f.balance, 0))}</span>
                <span className="kpi-sub neutral">available balance</span>
              </div>
            );
          return null;
        })}
      </div>

      <div className="content-masonry">
        {layout.visibleOrder
          .filter((id) => !id.startsWith("kpi-"))
          .map((id) => {
            if (id === "your-budget")
              return (
                <div
                  className={"card " + (flashCardId === "your-budget" ? "card-flash " : "") + drag.dragClass(id)}
                  key={id}
                  id="sdp-your-budget-card"
                  {...drag.dragProps(id)}
                >
                  <h3 className="card-title">Your Budget</h3>
                  <p className="card-subtitle">Budgeted vs. actual, current month</p>
                  <div className="table-scroll">
                    <table className="budget-table tx-table-labeled">
                      <thead>
                        <tr>
                          <th style={{ width: "40%" }}>Category</th>
                          <th className="num">Budgeted</th>
                          <th className="num">Actual</th>
                          <th className="num">Variance</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {client.budget.map((b) => {
                          const over = b.actual > b.budgeted;
                          const pct = (b.actual / b.budgeted) * 100;
                          return (
                            <tr key={b.category}>
                              <td data-primary="">
                                <div className="category-name">{b.category}</div>
                                <div className="bar-track">
                                  <div
                                    className={"bar-fill " + (over ? "over" : "under")}
                                    style={{ width: `${Math.min(pct, 100)}%`, animationDuration: `${growDuration(pct)}ms` }}
                                  ></div>
                                </div>
                              </td>
                              <td className="num" data-label="Budgeted">{fmtMoney(b.budgeted)}</td>
                              <td className="num" data-label="Actual">{fmtMoney(b.actual)}</td>
                              <td className="num" data-label="Variance">
                                {b.actual - b.budgeted >= 0 ? "+" : ""}
                                {fmtMoney(b.actual - b.budgeted)}
                              </td>
                              <td>
                                <span className={"pill " + (over ? "over" : "under")}>{over ? "Over" : "On Track"}</span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            if (id === "recent-activity")
              return (
                <div className={"card " + drag.dragClass(id)} key={id} {...drag.dragProps(id)}>
                  <h3 className="card-title">Your Recent Activity</h3>
                  <p className="card-subtitle">Transactions in your areas, last 2 months</p>
                  <div className="tx-list tx-list-scroll">
                    {myTx.length === 0 && <p className="card-subtitle">No recent transactions in your areas.</p>}
                    {myTx.map((t, i) => (
                      <div className="tx-row" key={i}>
                        <div>
                          <div className="tx-desc">{t.description}</div>
                          <div className="tx-meta">
                            {fmtDate(t.date)} · {t.category}
                          </div>
                        </div>
                        <div className={"tx-amount " + (t.amount >= 0 ? "positive" : "negative")}>
                          {t.amount >= 0 ? "+" : ""}
                          {fmtMoney(t.amount, { cents: true })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            if (crossTabById[id])
              return (
                <div className={"card " + drag.dragClass(id)} key={id} {...drag.dragProps(id)}>
                  {crossTabById[id].render()}
                </div>
              );
            return null;
          })}
      </div>
    </div>
  );
}

function DashboardPage({ client, access, isBookkeeper, promoText, onSaveReferralPromo }) {
  const current = client.monthly[client.monthly.length - 1];
  const prev = client.monthly[client.monthly.length - 2];
  const cash = totalCash(client);

  const netIncome = current.income - current.expenses;
  const prevNetIncome = prev.income - prev.expenses;
  const netChangePct = prevNetIncome !== 0 ? ((netIncome - prevNetIncome) / Math.abs(prevNetIncome)) * 100 : 0;

  const runwayMonths = runwayMonthsFor(client);
  const alerts = computeAlerts(client);

  const kpis = [
    { label: "Cash on Hand", value: fmtMoney(cash), sub: `${client.bankAccounts.length} account${client.bankAccounts.length > 1 ? "s" : ""}`, tone: "neutral" },
    {
      label: "Net Surplus / (Deficit)",
      value: fmtMoney(netIncome),
      sub: (netChangePct >= 0 ? "+" : "") + netChangePct.toFixed(1) + "% vs. last month",
      tone: netChangePct >= 0 ? "positive" : "negative",
    },
    {
      label: "Revenue (this month)",
      value: fmtMoney(current.income),
      sub: `vs. ${fmtMoney(prev.income)} last month`,
      tone: current.income >= prev.income ? "positive" : "negative",
    },
    {
      label: "Operating Reserve",
      value: runwayMonths == null ? "—" : `${runwayMonths.toFixed(1)} mo`,
      sub: "of expenses covered by cash",
      tone: runwayMonths != null && runwayMonths < 3 ? "negative" : "positive",
      ring: {
        // Six months of reserve is the common healthy target, so the ring
        // fills against that rather than an arbitrary 12.
        pct: runwayMonths == null ? 1 : Math.max(0.08, Math.min(runwayMonths / 6, 1)),
        status: runwayMonths != null && runwayMonths < 3 ? "Monitor" : "Healthy",
      },
    },
  ];

  const twoMonthsAgo = monthsAgoLocal(2);
  const allTx = client.bankAccounts
    .flatMap((a) => a.transactions.map((t) => ({ ...t, accountName: a.accountName })))
    .filter((t) => t.date >= twoMonthsAgo)
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  const widgets = [
    { id: "kpi-cash", group: "kpi", label: "Cash on Hand", description: "Total across all bank accounts" },
    { id: "kpi-net", group: "kpi", label: "Net Surplus / (Deficit)", description: "This month's income minus expenses" },
    { id: "kpi-revenue", group: "kpi", label: "Revenue (this month)", description: "Compared to last month" },
    { id: "kpi-runway", group: "kpi", label: "Operating Reserve", description: "Months of expenses covered by cash on hand" },
    { id: "income-expenses", group: "content", label: "Income vs. Expenses", description: "12-month trend chart" },
    { id: "recent-activity", group: "content", label: "Recent Activity", description: "Latest transactions across all accounts" },
    ...crossTabWidgetDefs(client, access),
  ];
  const crossTabById = Object.fromEntries(widgets.filter((w) => w.id.startsWith("xt-")).map((w) => [w.id, w]));
  const layout = useWidgetLayout(`${client.id}:full`, widgets.map((w) => w.id));
  const drag = useDragReorder(layout);
  const kpiOrder = layout.visibleOrder.filter((id) => id.startsWith("kpi-"));

  const kpiById = {
    "kpi-cash": kpis[0],
    "kpi-net": kpis[1],
    "kpi-revenue": kpis[2],
    "kpi-runway": kpis[3],
  };

  const { flashCardId, jumpToCard } = useCardFlash();
  // Operating Reserve (the runway ring) has no single content card below it
  // that summarizes it, so it's left out — stays a plain, non-clickable tile.
  const KPI_DASHBOARD_JUMP_TARGETS = {
    "kpi-cash": { domId: "dp-recent-activity-card", contentId: "recent-activity" },
    "kpi-net": { domId: "dp-income-expenses-card", contentId: "income-expenses" },
    "kpi-revenue": { domId: "dp-income-expenses-card", contentId: "income-expenses" },
  };

  return (
    <div>
      <MockBanner text="Every number on this page is sample data for prototyping — no QuickBooks or bank connection yet." />

      {/* Referral popup disabled for now — component kept below, re-add here when it's back on. */}

      {alerts.length > 0 && (
        <div className="alerts-block" style={{ marginBottom: 20 }}>
          <div className="alerts-card-header">
            <h3 className="card-title">Take Note -</h3>
          </div>
          <ul className="alerts-list">
            {alerts.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      )}

      <CustomizeDashboardButton widgets={widgets} layout={layout} />

      <div className="kpi-grid">
        {kpiOrder.map((id) => {
          const k = kpiById[id];
          const jumpTarget = KPI_DASHBOARD_JUMP_TARGETS[id];
          const jump = jumpTarget && !layout.hidden.has(jumpTarget.contentId) ? () => jumpToCard(jumpTarget.domId, jumpTarget.contentId) : null;
          return k.ring ? (
            <div className={"card kpi-card runway-ring-card " + drag.dragClass(id)} key={id} {...drag.dragProps(id)}>
              <span className="kpi-label">{k.label}</span>
              <RunwayRing pct={k.ring.pct} tone={k.tone}>
                <div className="runway-ring-value">{k.value}</div>
                <div className={"runway-ring-status " + k.tone}>{k.ring.status}</div>
              </RunwayRing>
              <span className={"kpi-sub " + k.tone}>{k.sub}</span>
            </div>
          ) : (() => {
            const Tag = jump ? "button" : "div";
            return (
              <Tag
                className={
                  "card kpi-card" +
                  (k.cardTone ? " kpi-card-" + k.cardTone : "") +
                  (jump ? " kpi-card-clickable" : "") +
                  " " +
                  drag.dragClass(id)
                }
                key={id}
                {...drag.dragProps(id)}
                {...(jump ? { onClick: jump } : {})}
              >
                <span className="kpi-label">{k.label}</span>
                <span className="kpi-value">{k.value}</span>
                <span className={"kpi-sub " + k.tone}>{k.sub}</span>
              </Tag>
            );
          })();
        })}
      </div>

      <div className="content-masonry">
        {layout.visibleOrder
          .filter((id) => !id.startsWith("kpi-"))
          .map((id) => {
            if (id === "income-expenses")
              return (
                <div
                  className={"card " + (flashCardId === "income-expenses" ? "card-flash " : "") + drag.dragClass(id)}
                  key={id}
                  id="dp-income-expenses-card"
                  {...drag.dragProps(id)}
                >
                  <h3 className="card-title">Income vs. Expenses</h3>
                  <p className="card-subtitle">Last {client.monthly.length} months</p>
                  <IncomeExpenseChart monthly={client.monthly} />
                  <CategoryLedger client={client} />
                </div>
              );
            if (id === "recent-activity")
              return (
                <div
                  className={"card " + (flashCardId === "recent-activity" ? "card-flash " : "") + drag.dragClass(id)}
                  key={id}
                  id="dp-recent-activity-card"
                  {...drag.dragProps(id)}
                >
                  <h3 className="card-title">Recent Activity</h3>
                  <p className="card-subtitle">Across all accounts, last 2 months</p>
                  <div className="tx-list tx-list-scroll">
                    {allTx.map((t, i) => (
                      <div className="tx-row" key={i}>
                        <div>
                          <div className="tx-desc">{t.description}</div>
                          <div className="tx-meta">
                            {fmtDate(t.date)} · {t.accountName}
                          </div>
                        </div>
                        <div className={"tx-amount " + (t.amount >= 0 ? "positive" : "negative")}>
                          {t.amount >= 0 ? "+" : ""}
                          {fmtMoney(t.amount, { cents: true })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            if (crossTabById[id])
              return (
                <div className={"card " + drag.dragClass(id)} key={id} {...drag.dragProps(id)}>
                  {crossTabById[id].render()}
                </div>
              );
            return null;
          })}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Budget vs Actual page
// ----------------------------------------------------------------------------

function BudgetPage({ client, searchTarget }) {
  const totals = client.budget.reduce(
    (acc, b) => {
      acc.budgeted += b.budgeted;
      acc.actual += b.actual;
      return acc;
    },
    { budgeted: 0, actual: 0 }
  );

  // "By Category" (the existing budgeted-vs-actual table, current month
  // only — that's all the category-level granularity this mock data
  // carries) vs. "Spending Trend" (the real multi-month income/expense
  // history from client.monthly, same data/chart the Dashboard already
  // uses). Not "this period vs. prior period" for the category table
  // itself — there's no prior-month category breakdown in this data model,
  // and fabricating one would mean inventing numbers rather than showing
  // something real.
  const [view, setView] = useState("category");

  const { flashCardId, jumpToCard } = useCardFlash();
  // Deferred a tick: switching view can mount the "By Category" card for
  // the first time (coming from "Spending Trend"), and jumpToCard's
  // getElementById has to run after that DOM update lands, not in the same
  // synchronous click handler that triggered it.
  const jumpToSpending = () => {
    setView("category");
    setTimeout(() => jumpToCard("budget-spending-card", "spending"), 0);
  };

  // A global-search hit on a budget category scrolls straight to that row
  // and flashes it, rather than just landing on the page and leaving the
  // client to find it themselves in the table — the row only exists in the
  // "By Category" view, so a hit switches back to it first.
  useEffect(() => {
    if (searchTarget) setView("category");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTarget && searchTarget.nonce]);

  // Separate effect, dependent on `view`, so this only ever looks for the
  // row once "By Category" has actually mounted — same split BankPage uses
  // for its own account-switch-then-jump case.
  useEffect(() => {
    if (searchTarget && view === "category") jumpToCard(searchTarget.highlightKey, searchTarget.highlightKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTarget && searchTarget.nonce, view]);

  return (
    <div>
      <MockBanner text="Budget figures are hardcoded for this prototype. In Phase 2 these will sync from QuickBooks budgets." />

      <div className="kpi-grid">
        <button className="card kpi-card kpi-card-clickable" onClick={jumpToSpending}>
          <span className="kpi-label">Total Budgeted (this month)</span>
          <span className="kpi-value">{fmtMoney(totals.budgeted)}</span>
        </button>
        <button className="card kpi-card kpi-card-clickable" onClick={jumpToSpending}>
          <span className="kpi-label">Total Actual (this month)</span>
          <span className="kpi-value">{fmtMoney(totals.actual)}</span>
        </button>
        <button className="card kpi-card kpi-card-clickable" onClick={jumpToSpending}>
          <span className="kpi-label">Variance</span>
          <span className="kpi-value">{fmtMoney(totals.actual - totals.budgeted)}</span>
          <span className={"kpi-sub " + (totals.actual > totals.budgeted ? "negative" : "positive")}>
            {totals.actual > totals.budgeted ? "Over budget" : "Under budget"}
          </span>
        </button>
      </div>

      <div className="view-toggle" style={{ marginBottom: 20 }}>
        <button type="button" className={"view-toggle-btn" + (view === "category" ? " active" : "")} onClick={() => setView("category")}>
          By Category
        </button>
        <button type="button" className={"view-toggle-btn" + (view === "trend" ? " active" : "")} onClick={() => setView("trend")}>
          Spending Trend
        </button>
      </div>

      {view === "category" && (
        <div className={"card " + (flashCardId === "spending" ? "card-flash" : "")} id="budget-spending-card">
          <h3 className="card-title">Spending by Category</h3>
          <p className="card-subtitle">Budgeted vs. actual, current month</p>
          <div className="table-scroll">
<table className="budget-table tx-table-labeled">
            <thead>
              <tr>
                <th style={{ width: "34%" }}>Category</th>
                <th className="num">Budgeted</th>
                <th className="num">Actual</th>
                <th className="num">Variance</th>
                <th style={{ width: "18%" }}>% Used</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {client.budget.map((b) => {
                const pct = (b.actual / b.budgeted) * 100;
                const over = b.actual > b.budgeted;
                const rowId = "budget-row-" + slugify(b.category);
                // Bullet-style bar: the track spans whichever of budgeted/actual
                // is bigger, so the fill shows the real dollar amount (not just
                // "% of budget" capped at 100%) and a target tick marks exactly
                // where the budget line falls — over-budget rows visibly run
                // past the tick instead of just stopping flush with the edge.
                const scaleMax = Math.max(b.budgeted, b.actual, 1) * 1.08;
                const fillPct = Math.min((b.actual / scaleMax) * 100, 100);
                const tickPct = Math.min((b.budgeted / scaleMax) * 100, 100);
                return (
                  <tr key={b.category} id={rowId} className={flashCardId === rowId ? "row-flash" : ""}>
                    <td data-primary="">
                      <div className="category-name">{b.category}</div>
                      <div className="bullet-track">
                        <div
                          className={"bullet-fill " + (over ? "over" : "under")}
                          style={{ width: `${fillPct}%`, animationDuration: `${growDuration(fillPct)}ms` }}
                        ></div>
                        <div className="bullet-target" style={{ left: `${tickPct}%` }}></div>
                      </div>
                    </td>
                    <td className="num" data-label="Budgeted">{fmtMoney(b.budgeted)}</td>
                    <td className="num" data-label="Actual">{fmtMoney(b.actual)}</td>
                    <td className="num" data-label="Variance">
                      {b.actual - b.budgeted >= 0 ? "+" : ""}
                      {fmtMoney(b.actual - b.budgeted)}
                    </td>
                    <td data-label="% Used">{pct.toFixed(0)}%</td>
                    <td>
                      <span className={"pill " + (over ? "over" : "under")}>{over ? "Over" : "On Track"}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {view === "trend" && (
        <div className="card">
          <h3 className="card-title">Spending Trend</h3>
          <p className="card-subtitle">Income vs. expenses, last {client.monthly.length} months</p>
          <IncomeExpenseChart monthly={client.monthly} budgetTotal={totals.budgeted} />
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Giving & Funds page
// ----------------------------------------------------------------------------

// Shared between standard Giving & Funds and Fund Accounting Pro, so the
// fund-card grid and the contributions table exist in exactly one place.
function FundBalancesCard({ client }) {
  return (
    <div className="card">
      <h3 className="card-title">Fund Balances</h3>
      <p className="card-subtitle">What the money in the bank is designated for</p>
      <div className="fund-grid">
        {client.funds.map((f) => (
          <div className="fund-card" key={f.name}>
            <div className="fund-card-top">
              <span className="fund-name">{f.name}</span>
              <span className={"pill " + (f.restricted ? "restricted" : "unrestricted")}>
                {f.restricted ? "Restricted" : "Unrestricted"}
              </span>
            </div>
            <span className="fund-balance">{fmtMoney(f.balance)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ContributionsCard({ client }) {
  return (
    <div className="card">
      <h3 className="card-title">Recent Contributions</h3>
      <p className="card-subtitle">Individual gifts and grants received</p>
      <div className="table-scroll">
<table className="tx-table tx-table-stack tx-stack-giving">
        <thead>
          <tr>
            <th>Date</th>
            <th>Donor</th>
            <th>Fund</th>
            <th>Method</th>
            <th className="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {client.contributions.map((c, i) => (
            <tr key={i}>
              <td>{fmtDate(c.date)}</td>
              <td>{c.donor}</td>
              <td>
                <span className="category-tag">{c.fund}</span>
              </td>
              <td>{c.method}</td>
              <td className="num tx-amount positive">+{fmtMoney(c.amount, { cents: true })}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

function GivingFundsPage({ client }) {
  const totalGiving = client.contributions.reduce((s, c) => s + c.amount, 0);
  const restrictedTotal = client.funds.filter((f) => f.restricted).reduce((s, f) => s + f.balance, 0);
  const unrestrictedTotal = client.funds.filter((f) => !f.restricted).reduce((s, f) => s + f.balance, 0);
  // Contributions and Fund Balances used to both sit on the page at once,
  // with the KPI cards above just scrolling down to whichever section —
  // a real toggle shows one at a time instead, so each gets the whole page
  // rather than fighting the other for space.
  const [view, setView] = useState("funds");

  return (
    <div>
      <MockBanner text="Giving records and fund balances shown here are fabricated for this prototype." />

      <div className="kpi-grid">
        <button className="card kpi-card kpi-card-clickable" onClick={() => setView("contributions")}>
          <span className="kpi-label">Recent Giving</span>
          <span className="kpi-value">{fmtMoney(totalGiving)}</span>
          <span className="kpi-sub neutral">{client.contributions.length} gifts</span>
        </button>
        <button className="card kpi-card kpi-card-clickable" onClick={() => setView("funds")}>
          <span className="kpi-label">Unrestricted Funds</span>
          <span className="kpi-value">{fmtMoney(unrestrictedTotal)}</span>
          <span className="kpi-sub positive">Available for general use</span>
        </button>
        <button className="card kpi-card kpi-card-clickable" onClick={() => setView("funds")}>
          <span className="kpi-label">Restricted Funds</span>
          <span className="kpi-value">{fmtMoney(restrictedTotal)}</span>
          <span className="kpi-sub neutral">Designated for specific purposes</span>
        </button>
      </div>

      <div className="view-toggle" style={{ marginBottom: 20 }}>
        <button type="button" className={"view-toggle-btn" + (view === "funds" ? " active" : "")} onClick={() => setView("funds")}>
          Fund Balances
        </button>
        <button
          type="button"
          className={"view-toggle-btn" + (view === "contributions" ? " active" : "")}
          onClick={() => setView("contributions")}
        >
          Contributions
        </button>
      </div>

      {view === "funds" && <FundBalancesCard client={client} />}
      {view === "contributions" && <ContributionsCard client={client} />}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Fund Accounting Pro — adds two views next to the same fund balances and
// contributions Giving & Funds already shows: Fund Activity (transfers
// between funds) and Pledges (committed vs. received). Same
// Fund Balances/Contributions views as standard, so this stays a strict
// superset — see HANDOFF7 §54/§55 on that bar. Fund balance trend over time
// (the fund-accounting equivalent of Budget's Spending Trend) isn't included
// here: unlike a bank or budget trend, it would need each fund's balance
// sampled monthly, which this mock dataset doesn't carry — only a snapshot
// balance plus this period's contributions/transfers — so it stayed out
// rather than fabricating six months of numbers.
// ----------------------------------------------------------------------------

function FundAccountingProPage({ client }) {
  const fundTransfers = client.fundTransfers || [];
  const pledges = client.pledges || [];
  const totalGiving = client.contributions.reduce((s, c) => s + c.amount, 0);
  const restrictedTotal = client.funds.filter((f) => f.restricted).reduce((s, f) => s + f.balance, 0);
  const unrestrictedTotal = client.funds.filter((f) => !f.restricted).reduce((s, f) => s + f.balance, 0);
  const pledgesOutstanding = pledges.reduce((s, p) => s + (p.committed - p.received), 0);
  const [view, setView] = useState("funds");
  const showToast = useToast();
  const today = todayLocal();

  const handleDownloadStatement = (donor) => {
    const filename = buildGivingStatementPdf(client, donor);
    showToast(`Downloaded "${filename}"`);
  };

  // Tax Documents: one row per named donor (never "Anonymous" — there's no
  // one to send a receipt to, and a YTD total shouldn't be attributable to
  // a single anonymous contact), with their YTD total and the email on file
  // from client.donors, if any.
  const donorRoster = useMemo(() => {
    const emailByDonor = Object.fromEntries((client.donors || []).map((d) => [d.name, d.email]));
    const totals = {};
    client.contributions.forEach((c) => {
      if (c.donor === "Anonymous") return;
      if (!totals[c.donor]) totals[c.donor] = { donor: c.donor, total: 0, giftCount: 0 };
      totals[c.donor].total += c.amount;
      totals[c.donor].giftCount += 1;
    });
    return Object.values(totals)
      .map((d) => ({ ...d, email: emailByDonor[d.donor] || null }))
      .sort((a, b) => b.total - a.total);
  }, [client.contributions, client.donors]);

  // No real send path exists (see the referral popup's own "this doesn't
  // send a real email yet" disclaimer for the same honest-mock posture) —
  // this simulates success with a toast rather than pretending to open a
  // mailto draft, since the whole point is attaching a generated PDF, which
  // a mailto: link can never do.
  const handleSendStatement = (donor, email) => {
    if (!email) return;
    showToast(`Giving statement sent to ${donor} (${email}).`);
  };

  const handleSendAll = () => {
    const withEmail = donorRoster.filter((d) => d.email);
    if (!withEmail.length) return;
    showToast(`Sent ${withEmail.length} giving statement${withEmail.length === 1 ? "" : "s"}.`);
  };

  return (
    <div>
      <MockBanner text="Giving records, fund balances, transfers, and pledges shown here are fabricated for this prototype." />

      <div className="kpi-grid">
        <button className="card kpi-card kpi-card-clickable" onClick={() => setView("contributions")}>
          <span className="kpi-label">Recent Giving</span>
          <span className="kpi-value">{fmtMoney(totalGiving)}</span>
          <span className="kpi-sub neutral">{client.contributions.length} gifts</span>
        </button>
        <button className="card kpi-card kpi-card-clickable" onClick={() => setView("funds")}>
          <span className="kpi-label">Unrestricted Funds</span>
          <span className="kpi-value">{fmtMoney(unrestrictedTotal)}</span>
          <span className="kpi-sub positive">Available for general use</span>
        </button>
        <button className="card kpi-card kpi-card-clickable" onClick={() => setView("funds")}>
          <span className="kpi-label">Restricted Funds</span>
          <span className="kpi-value">{fmtMoney(restrictedTotal)}</span>
          <span className="kpi-sub neutral">Designated for specific purposes</span>
        </button>
        <button className="card kpi-card kpi-card-clickable" onClick={() => setView("pledges")}>
          <span className="kpi-label">Pledges Outstanding</span>
          <span className="kpi-value">{fmtMoney(pledgesOutstanding)}</span>
          <span className="kpi-sub neutral">{pledges.length} active pledge{pledges.length !== 1 ? "s" : ""}</span>
        </button>
      </div>

      <div className="view-toggle" style={{ marginBottom: 20 }}>
        <button type="button" className={"view-toggle-btn" + (view === "funds" ? " active" : "")} onClick={() => setView("funds")}>
          Fund Balances
        </button>
        <button
          type="button"
          className={"view-toggle-btn" + (view === "contributions" ? " active" : "")}
          onClick={() => setView("contributions")}
        >
          Contributions
        </button>
        <button
          type="button"
          className={"view-toggle-btn" + (view === "activity" ? " active" : "")}
          onClick={() => setView("activity")}
        >
          Fund Activity
        </button>
        <button
          type="button"
          className={"view-toggle-btn" + (view === "pledges" ? " active" : "")}
          onClick={() => setView("pledges")}
        >
          Pledges
        </button>
        <button
          type="button"
          className={"view-toggle-btn" + (view === "tax-documents" ? " active" : "")}
          onClick={() => setView("tax-documents")}
        >
          Tax Documents
        </button>
      </div>

      {view === "funds" && <FundBalancesCard client={client} />}
      {view === "contributions" && <ContributionsCard client={client} />}

      {view === "activity" && (
        <div className="card">
          <h3 className="card-title premium-shimmer">Fund Activity</h3>
          <p className="card-subtitle">Transfers between funds, with the reason for each move</p>
          <div className="table-scroll">
            <table className="tx-table tx-table-stack tx-stack-giving">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>From</th>
                  <th>To</th>
                  <th>Reason</th>
                  <th className="num">Amount</th>
                </tr>
              </thead>
              <tbody>
                {fundTransfers.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ color: "var(--text-muted)" }}>
                      No fund transfers recorded.
                    </td>
                  </tr>
                ) : (
                  fundTransfers.map((t, i) => (
                    <tr key={i}>
                      <td>{fmtDate(t.date)}</td>
                      <td>
                        <span className="category-tag">{t.fromFund}</span>
                      </td>
                      <td>
                        <span className="category-tag">{t.toFund}</span>
                      </td>
                      <td>{t.reason}</td>
                      <td className="num tx-amount">{fmtMoney(t.amount, { cents: true })}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {view === "pledges" && (
        <div className="card">
          <h3 className="card-title premium-shimmer">Pledges</h3>
          <p className="card-subtitle">Committed vs. received, by donor and fund</p>
          <div className="table-scroll">
            <table className="tx-table tx-table-stack tx-stack-giving">
              <thead>
                <tr>
                  <th>Donor</th>
                  <th>Fund</th>
                  <th>Due</th>
                  <th className="num">Committed</th>
                  <th className="num">Received</th>
                  <th className="num">Remaining</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {pledges.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ color: "var(--text-muted)" }}>
                      No open pledges.
                    </td>
                  </tr>
                ) : (
                  pledges.map((p, i) => {
                    const remaining = p.committed - p.received;
                    const isOverdue = remaining > 0.005 && daysUntil(p.dueDate, today) < 0;
                    const status = remaining <= 0.005 ? "Fulfilled" : isOverdue ? "Overdue" : "In progress";
                    const pillClass = remaining <= 0.005 ? "good" : isOverdue ? "bad" : "neutral";
                    return (
                      <tr key={i}>
                        <td>{p.donor}</td>
                        <td>
                          <span className="category-tag">{p.fund}</span>
                        </td>
                        <td>{fmtDate(p.dueDate)}</td>
                        <td className="num">{fmtMoney(p.committed, { cents: true })}</td>
                        <td className="num">{fmtMoney(p.received, { cents: true })}</td>
                        <td className="num">{fmtMoney(remaining, { cents: true })}</td>
                        <td>
                          <span className={"pill " + pillClass}>{status}</span>
                        </td>
                        <td>
                          <button className="btn-secondary" onClick={() => handleDownloadStatement(p.donor)}>
                            Giving Statement
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {view === "tax-documents" && (
        <div className="card">
          <div className="page-header" style={{ marginBottom: 4 }}>
            <div>
              <h3 className="card-title premium-shimmer">Tax Documents</h3>
              <p className="card-subtitle" style={{ margin: 0 }}>
                Year-end giving statements donors can use to write off their contributions
              </p>
            </div>
            <button className="btn-primary" disabled={!donorRoster.some((d) => d.email)} onClick={handleSendAll}>
              Send All
            </button>
          </div>
          <div className="table-scroll">
            <table className="tx-table tx-table-stack tx-stack-giving">
              <thead>
                <tr>
                  <th>Donor</th>
                  <th>Email on File</th>
                  <th className="num">Gifts</th>
                  <th className="num">YTD Total</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {donorRoster.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ color: "var(--text-muted)" }}>
                      No named donors to send statements to — every gift on record so far is anonymous.
                    </td>
                  </tr>
                ) : (
                  donorRoster.map((d) => (
                    <tr key={d.donor}>
                      <td>{d.donor}</td>
                      <td>
                        {d.email || <span style={{ color: "var(--text-muted)" }}>No email on file</span>}
                      </td>
                      <td className="num">{d.giftCount}</td>
                      <td className="num tx-amount">{fmtMoney(d.total, { cents: true })}</td>
                      <td style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                        <button className="btn-secondary" onClick={() => handleDownloadStatement(d.donor)}>
                          Download
                        </button>
                        <button
                          className="btn-secondary"
                          disabled={!d.email}
                          title={d.email ? undefined : "No email on file for this donor"}
                          onClick={() => handleSendStatement(d.donor, d.email)}
                        >
                          Send
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <p className="card-subtitle" style={{ margin: "12px 0 0" }}>
            Prototype — Send simulates delivery and doesn't actually email anything yet.
          </p>
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Cash Flow page
// ----------------------------------------------------------------------------

function ReceivablesPayablesPage({ client }) {
  const totalReceivable = client.receivables.reduce((s, r) => s + r.amount, 0);
  const totalPayable = client.payables.reduce((s, p) => s + p.amount, 0);
  const { flashCardId, jumpToCard } = useCardFlash();

  return (
    <div>
      <MockBanner text="These balances are hardcoded for the prototype. Real amounts will come from QuickBooks in Phase 2." />

      <div className="kpi-grid">
        <button className="card kpi-card kpi-card-clickable" onClick={() => jumpToCard("rp-receivables-card", "receivables")}>
          <span className="kpi-label">Money Owed To You</span>
          <span className="kpi-value">{fmtMoney(totalReceivable)}</span>
          <span className="kpi-sub positive">{client.receivables.length} open item{client.receivables.length !== 1 ? "s" : ""}</span>
        </button>
        <button className="card kpi-card kpi-card-clickable" onClick={() => jumpToCard("rp-payables-card", "payables")}>
          <span className="kpi-label">Money You Owe</span>
          <span className="kpi-value">{fmtMoney(totalPayable)}</span>
          <span className="kpi-sub negative">{client.payables.length} open item{client.payables.length !== 1 ? "s" : ""}</span>
        </button>
        <div className="card kpi-card">
          <span className="kpi-label">Net Position</span>
          <span className="kpi-value">{fmtMoney(totalReceivable - totalPayable)}</span>
          <span className="kpi-sub neutral">receivables minus payables</span>
        </div>
      </div>

      <div className="content-masonry">
        <div className={"card " + (flashCardId === "receivables" ? "card-flash" : "")} id="rp-receivables-card">
          <h3 className="card-title">Receivables</h3>
          <p className="card-subtitle">Grants, pledges, and reimbursements coming in</p>
          <div className="table-scroll">
<table className="tx-table tx-table-labeled">
            <thead>
              <tr>
                <th>Description</th>
                <th>Due</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {client.receivables.map((r, i) => (
                <tr key={i}>
                  <td data-primary="">{r.description}</td>
                  <td data-label="Due">{fmtDate(r.dueDate)}</td>
                  <td className="num tx-amount positive" data-label="Amount">{fmtMoney(r.amount, { cents: true })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </div>

        <div className={"card " + (flashCardId === "payables" ? "card-flash" : "")} id="rp-payables-card">
          <h3 className="card-title">Payables</h3>
          <p className="card-subtitle">Bills and commitments going out</p>
          <div className="table-scroll">
<table className="tx-table tx-table-labeled">
            <thead>
              <tr>
                <th>Vendor</th>
                <th>Due</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {client.payables.map((p, i) => (
                <tr key={i}>
                  <td data-primary="">
                    {p.vendor}
                    <div className="tx-meta">{p.description}</div>
                  </td>
                  <td data-label="Due">{fmtDate(p.dueDate)}</td>
                  <td className="num tx-amount negative" data-label="Amount">-{fmtMoney(p.amount, { cents: true })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Payroll page — a paid add-on (client.payrollAddOn / client.payroll), not a
// premium-plan upgrade. Deliberately not in PREMIUM_UPGRADE_TAB_KEYS or
// gated by hasPremiumPlan: a Standard client can buy it just as easily as a
// Premium one. Real pay runs are processed in Gusto; this page only reads
// what Gusto reports, so there's no "run payroll" action anywhere here.
// ----------------------------------------------------------------------------

const PAYROLL_STATUS_META = {
  active: { label: "Active", cls: "positive" },
  onboarding: { label: "Onboarding", cls: "neutral" },
};

const PAYROLL_DEPOSIT_STATUS_META = {
  upcoming: { label: "Upcoming", cls: "neutral" },
  filed: { label: "Filed", cls: "positive" },
};

function PayrollUpsell({ client }) {
  const showToast = useToast();

  const handleConnect = () => {
    showToast("Prototype — this would send your admin to Gusto to authorize read access.");
  };

  return (
    <div>
      <MockBanner text="Payroll is an add-on, independent of plan — a Standard client can add it just like a Premium one. Nothing here is connected to a real Gusto account yet." />

      <div className="card" style={{ marginBottom: 20, textAlign: "center", padding: "36px 28px" }}>
        <div className="eyebrow-badge">Payroll · Add-on</div>
        <h2 style={{ fontFamily: "var(--font-heading)", fontSize: 26, margin: "10px 0 8px", color: "var(--ink-strong)" }}>
          Add Payroll for {client.name}
        </h2>
        <p style={{ color: "var(--text-muted)", maxWidth: 560, margin: "0 auto" }}>
          Run payroll in Gusto like you do today — connect it here to see every employee's pay,
          withholding, and upcoming tax deposits right alongside the rest of this client's books.
        </p>
        <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "center", marginTop: 18, flexWrap: "wrap" }}>
          <button className="btn-primary" onClick={handleConnect}>
            Connect Gusto
          </button>
          <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
            1.25% of processed payroll, per employee, per run — no plan upgrade required
          </span>
        </div>
      </div>

      <div className="report-grid">
        <div className="card">
          <h3 className="card-title">Per-employee detail</h3>
          <p className="card-subtitle" style={{ marginBottom: 0 }}>
            Pay type, status, and direct deposit enrollment for every employee, synced from Gusto.
          </p>
        </div>
        <div className="card">
          <h3 className="card-title">Tax deposits tracked</h3>
          <p className="card-subtitle" style={{ marginBottom: 0 }}>
            Federal 941, state withholding, and FUTA — amounts and due dates, so nothing sneaks up on you.
          </p>
        </div>
        <div className="card">
          <h3 className="card-title">Synced with your books</h3>
          <p className="card-subtitle" style={{ marginBottom: 0 }}>
            Payroll cost rolls into Budget vs. Actual and Reports — a Payroll YTD report joins the others.
          </p>
        </div>
      </div>
    </div>
  );
}

function PayrollPage({ client }) {
  if (!client.payroll) return <PayrollUpsell client={client} />;

  const { payroll } = client;
  const { flashCardId, jumpToCard } = useCardFlash();

  return (
    <div>
      <MockBanner text="Payroll figures are sample data for this prototype. Once connected, this page reflects your live Gusto account." />

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
        <span className="badge-live">
          <span className="badge-dot" style={{ background: "var(--good)" }}></span>
          Connected via {payroll.provider}
        </span>
      </div>

      <div className="kpi-grid">
        <div className="card kpi-card">
          <span className="kpi-label">Active Employees</span>
          <span className="kpi-value">{payroll.employees.filter((e) => e.status === "active").length}</span>
          <span className="kpi-sub neutral">{payroll.employees.length} total on roster</span>
        </div>
        <div className="card kpi-card">
          <span className="kpi-label">Next Run Total</span>
          <span className="kpi-value">{fmtMoney(payroll.nextRun.net)}</span>
          <span className="kpi-sub neutral">{fmtDate(payroll.nextRun.date)}</span>
        </div>
        <div className="card kpi-card">
          <span className="kpi-label">Last Run Net Pay</span>
          <span className="kpi-value">{fmtMoney(payroll.lastRun.net)}</span>
          <span className="kpi-sub neutral">{fmtDate(payroll.lastRun.date)}</span>
        </div>
        <button className="card kpi-card kpi-card-clickable" onClick={() => jumpToCard("payroll-deposits-card", "deposits")}>
          <span className="kpi-label">YTD Payroll Cost</span>
          <span className="kpi-value">{fmtMoney(payroll.ytdCost)}</span>
          <span className="kpi-sub neutral">see tax deposits below</span>
        </button>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
          <h3 className="card-title" style={{ margin: 0 }}>
            Next pay run
          </h3>
          <span className="card-subtitle" style={{ margin: 0 }}>
            {fmtDate(payroll.nextRun.date)} · {payroll.nextRun.employeeCount} employees
          </span>
        </div>
        <div className="kpi-grid" style={{ marginTop: 16, marginBottom: 0 }}>
          <div>
            <span className="kpi-label">Gross Pay</span>
            <div className="kpi-value" style={{ fontSize: 18 }}>{fmtMoney(payroll.nextRun.gross)}</div>
          </div>
          <div>
            <span className="kpi-label">Taxes &amp; Withholding</span>
            <div className="kpi-value" style={{ fontSize: 18 }}>{fmtMoney(payroll.nextRun.taxes)}</div>
          </div>
          <div>
            <span className="kpi-label">Net Pay</span>
            <div className="kpi-value" style={{ fontSize: 18, color: "var(--good)" }}>{fmtMoney(payroll.nextRun.net)}</div>
          </div>
        </div>
      </div>

      <div className="content-masonry">
        <div className={"card " + (flashCardId === "deposits" ? "card-flash" : "")} id="payroll-deposits-card">
          <h3 className="card-title">Tax deposits</h3>
          <p className="card-subtitle">Federal and state, current quarter</p>
          <div className="table-scroll">
            <table className="tx-table tx-table-labeled">
              <thead>
                <tr>
                  <th>Deposit</th>
                  <th>Due</th>
                  <th className="num">Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {payroll.taxDeposits.map((d, i) => {
                  const meta = PAYROLL_DEPOSIT_STATUS_META[d.status];
                  return (
                    <tr key={i}>
                      <td data-primary="">
                        {d.type}
                        <div className="tx-meta">{d.period}</div>
                      </td>
                      <td data-label="Due">{fmtDate(d.dueDate)}</td>
                      <td className="num tx-amount" data-label="Amount">{fmtMoney(d.amount)}</td>
                      <td data-label="Status">
                        <span className={"kpi-sub " + meta.cls}>{meta.label}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <h3 className="card-title">Employee roster</h3>
          <p className="card-subtitle">Rate, YTD pay, and withholding are on the Payroll YTD report under Reports</p>
          <div className="table-scroll">
            <table className="tx-table tx-table-labeled">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Pay type</th>
                  <th>Direct deposit</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {payroll.employees.map((e, i) => {
                  const meta = PAYROLL_STATUS_META[e.status];
                  return (
                    <tr key={i}>
                      <td data-primary="">{e.name}</td>
                      <td data-label="Role">{e.role}</td>
                      <td data-label="Pay type">{e.payType}</td>
                      <td data-label="Direct deposit">{e.directDeposit === "enrolled" ? "Enrolled" : "Pending"}</td>
                      <td data-label="Status">
                        <span className={"kpi-sub " + meta.cls}>{meta.label}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

const ACCOUNT_DONUT_COLORS = ["var(--gold)", "var(--good)", "var(--bad)", "var(--gold-deep)", "var(--chart-income)"];

function AccountCashDonut({ accounts }) {
  const total = accounts.reduce((s, a) => s + a.balance, 0);
  let cursor = 0;
  const stops = accounts.map((a, i) => {
    const pct = total > 0 ? (a.balance / total) * 100 : 0;
    const color = ACCOUNT_DONUT_COLORS[i % ACCOUNT_DONUT_COLORS.length];
    const stop = `${color} ${cursor}% ${cursor + pct}%`;
    cursor += pct;
    return stop;
  });

  return (
    <div className="donut-widget compact">
      <div className="donut" style={{ background: `conic-gradient(${stops.join(", ")})` }}>
        <div className="donut-hole">
          <span className="donut-center-value">{fmtMoney(total)}</span>
          <span className="donut-center-label">Total Cash</span>
        </div>
      </div>
      <div className="donut-legend">
        {accounts.map((a, i) => (
          <div className="donut-legend-row" key={a.id}>
            <span className="legend-swatch" style={{ background: ACCOUNT_DONUT_COLORS[i % ACCOUNT_DONUT_COLORS.length] }}></span>
            <span>{a.accountName}</span>
            <span className="donut-legend-value">{fmtMoney(a.balance)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Bank Accounts page (multiple accounts + CSV export)
// ----------------------------------------------------------------------------

// The actual balances/transactions view — shared by standard Bank Accounts
// and Reconciliation Pro (which wraps this in a Transactions/Reconciliation
// toggle, see BankReconciliationPage below), so the transaction table and
// its search-jump/CSV-export behavior exist in exactly one place.
function BankTransactionsPanel({ client, searchTarget }) {
  const [activeAccountId, setActiveAccountId] = useState(client.bankAccounts[0].id);
  // "This Account" (the existing account-tabs-driven view) vs. "All
  // Accounts" (every account's activity combined, most recent first, with
  // its own Account column) — the transactions table only, not the KPI
  // strip above it, which stays about whichever account is picked in the
  // tabs either way.
  const [txView, setTxView] = useState("account");
  const showToast = useToast();
  const account = client.bankAccounts.find((a) => a.id === activeAccountId) || client.bankAccounts[0];
  const cash = totalCash(client);
  const { flashCardId, jumpToCard } = useCardFlash();

  const allTx = useMemo(
    () =>
      client.bankAccounts
        .flatMap((a) => a.transactions.map((t) => ({ ...t, accountName: a.accountName })))
        .sort((a, b) => (a.date < b.date ? 1 : -1)),
    [client]
  );

  // A transaction hit lives on one specific account's tab, so switch to it
  // first (and drop back to the single-account view, since its row ids only
  // exist there) — the row won't exist in the DOM until that tab is active.
  useEffect(() => {
    if (searchTarget && searchTarget.accountId && searchTarget.accountId !== activeAccountId) {
      setActiveAccountId(searchTarget.accountId);
    }
    if (searchTarget && searchTarget.accountId) setTxView("account");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTarget && searchTarget.nonce]);

  useEffect(() => {
    if (searchTarget && txView === "account") jumpToCard(searchTarget.highlightKey, searchTarget.highlightKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTarget && searchTarget.nonce, activeAccountId, txView]);

  const exportCSV = () => {
    const isAll = txView === "all";
    const header = isAll ? ["Date", "Account", "Description", "Category", "Amount"] : ["Date", "Description", "Category", "Amount"];
    const rows = isAll
      ? allTx.map((t) => [t.date, t.accountName, t.description, t.category, t.amount])
      : account.transactions.map((t) => [t.date, t.description, t.category, t.amount]);
    const csv = [header, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${client.name.replace(/\s+/g, "_")}_${isAll ? "all_accounts" : account.accountName.replace(/\s+/g, "_")}_transactions.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`Exported ${isAll ? allTx.length : account.transactions.length} transactions to CSV.`);
  };

  return (
    <div>
      <div className="bank-top-grid">
        <div className="bank-top-left">
          <div className="bank-summary-row">
            <div className="card kpi-card">
              <span className="kpi-label">Total Cash on Hand</span>
              <span className="kpi-value">{fmtMoney(cash)}</span>
              <span className="kpi-sub neutral">across {client.bankAccounts.length} account{client.bankAccounts.length > 1 ? "s" : ""}</span>
            </div>

            <div className="card kpi-card">
              <span className="kpi-label">Current Balance</span>
              <span className="kpi-value">{fmtMoney(account.balance, { cents: true })}</span>
              <span className="kpi-sub neutral">
                {account.accountName} ({account.type})
                <span className="dot-sep">•</span>
                Account ending {account.accountMask}
              </span>
            </div>
          </div>

          <div className="account-tabs">
            {client.bankAccounts.map((a) => (
              <button
                key={a.id}
                className={"account-tab" + (a.id === activeAccountId ? " active" : "")}
                onClick={() => setActiveAccountId(a.id)}
              >
                <span className="account-tab-name">{a.accountName}</span>
                <span className="account-tab-balance">{fmtMoney(a.balance)}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="card bank-top-right">
          <h3 className="card-title">Cash by Account</h3>
          <p className="card-subtitle" style={{ margin: 0 }}>Share of total cash on hand</p>
          <AccountCashDonut accounts={client.bankAccounts} />
        </div>
      </div>

      <div className="card">
        <div className="page-header" style={{ marginBottom: 4 }}>
          <div>
            <h3 className="card-title">Recent Transactions</h3>
            <p className="card-subtitle" style={{ margin: 0 }}>
              {txView === "all"
                ? "Every account's activity, most recent first"
                : "Most recent activity on this account — scroll to go back further"}
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div className="view-toggle">
              <button
                type="button"
                className={"view-toggle-btn" + (txView === "account" ? " active" : "")}
                onClick={() => setTxView("account")}
              >
                This Account
              </button>
              <button
                type="button"
                className={"view-toggle-btn" + (txView === "all" ? " active" : "")}
                onClick={() => setTxView("all")}
              >
                All Accounts
              </button>
            </div>
            <button className="btn-secondary" onClick={exportCSV}>
              Export CSV
            </button>
          </div>
        </div>
        <div className="table-scroll tx-list-scroll">
<table className="tx-table tx-table-stack tx-stack-bank" style={{ marginTop: 16 }}>
          <thead>
            <tr>
              <th>Date</th>
              {txView === "all" && <th>Account</th>}
              <th>Description</th>
              <th>Category</th>
              <th className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {(txView === "all" ? allTx : account.transactions).map((t, i) => {
              const rowId = "tx-" + i;
              return (
              <tr key={i} id={txView === "all" ? undefined : rowId} className={txView !== "all" && flashCardId === rowId ? "row-flash" : ""}>
                <td>{fmtDate(t.date)}</td>
                {txView === "all" && <td>{t.accountName}</td>}
                <td>{t.description}</td>
                <td>
                  <span className="category-tag">{t.category}</span>
                </td>
                <td className={"num tx-amount " + (t.amount >= 0 ? "positive" : "negative")}>
                  {t.amount >= 0 ? "+" : ""}
                  {fmtMoney(t.amount, { cents: true })}
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}

function BankPage({ client, searchTarget }) {
  return (
    <div>
      <MockBanner text="Account balances and transactions are fabricated sample data — no bank is connected yet." />
      <BankTransactionsPanel client={client} searchTarget={searchTarget} />
    </div>
  );
}

// ----------------------------------------------------------------------------
// Reconciliation Pro — adds a month-end reconciliation workflow next to the
// same transactions view Bank Accounts already shows, behind a Transactions/
// Reconciliation toggle (same in-page-toggle pattern as Budget vs. Actual's
// Spending Trend and the rest — see HANDOFF7 §54). Reconciliation status is
// read-only here: cleared/outstanding and the statement balance are set in
// the mock data (data.js), not edited from this page — there's no bookkeeper
// action or persistence layer behind a checkbox yet, so this shows the
// current state rather than pretending to let you change it.
// ----------------------------------------------------------------------------

function BankReconciliationPage({ client, searchTarget }) {
  const [view, setView] = useState("transactions");

  // A transaction search result always means "show me that transaction," so
  // it forces the view back to Transactions first, same as Bank Accounts'
  // own This Account/All Accounts toggle already does for account switches.
  useEffect(() => {
    if (searchTarget) setView("transactions");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTarget && searchTarget.nonce]);

  return (
    <div>
      <MockBanner text="Account balances, transactions, and reconciliation status shown here are fabricated for this prototype." />

      <div className="view-toggle" style={{ marginBottom: 20 }}>
        <button
          type="button"
          className={"view-toggle-btn" + (view === "transactions" ? " active" : "")}
          onClick={() => setView("transactions")}
        >
          Transactions
        </button>
        <button
          type="button"
          className={"view-toggle-btn" + (view === "reconciliation" ? " active" : "")}
          onClick={() => setView("reconciliation")}
        >
          Reconciliation
        </button>
      </div>

      {view === "transactions" && <BankTransactionsPanel client={client} searchTarget={searchTarget} />}
      {view === "reconciliation" && <ReconciliationPanel client={client} />}
    </div>
  );
}

function ReconciliationPanel({ client }) {
  const [activeAccountId, setActiveAccountId] = useState(client.bankAccounts[0].id);
  const showToast = useToast();
  const account = client.bankAccounts.find((a) => a.id === activeAccountId) || client.bankAccounts[0];

  // Missing cleared/statementBalance (any client this session's mock data
  // wasn't written for) reads as "fully cleared, nothing outstanding" rather
  // than crashing — see the standard-vs-premium comparison mockup's honesty
  // note about not fabricating data a page doesn't actually have.
  const outstanding = account.transactions.filter((t) => t.cleared === false);
  const outstandingTotal = outstanding.reduce((s, t) => s + t.amount, 0);
  const statementBalance = account.statementBalance != null ? account.statementBalance : account.balance;
  const adjustedBalance = statementBalance + outstandingTotal;
  const difference = account.balance - adjustedBalance;
  const isReconciled = Math.abs(difference) < 0.005;

  const history = (client.bankReconciliations || []).filter((r) => r.accountId === activeAccountId);

  // Across every account, not just the one selected in the tabs above — a
  // quick "where should I actually look first" comparison, since the tabs
  // only ever show one account's detail at a time.
  const outstandingByAccount = client.bankAccounts.map((a) => ({
    label: a.accountName,
    amount: (a.transactions || []).filter((t) => t.cleared === false).reduce((s, t) => s + Math.abs(t.amount), 0),
  }));

  const handleDownload = () => {
    const filename = buildReconciliationReportPdf(client, account, { statementBalance, outstanding, difference });
    showToast(`Downloaded "${filename}"`);
  };

  return (
    <div>
      <div className="account-tabs" style={{ marginBottom: 20 }}>
        {client.bankAccounts.map((a) => (
          <button
            key={a.id}
            className={"account-tab" + (a.id === activeAccountId ? " active" : "")}
            onClick={() => setActiveAccountId(a.id)}
          >
            <span className="account-tab-name">{a.accountName}</span>
            <span className="account-tab-balance">{fmtMoney(a.balance)}</span>
          </button>
        ))}
      </div>

      <div className="kpi-grid" style={{ marginBottom: 20 }}>
        <div className="card kpi-card">
          <span className="kpi-label">Statement Balance</span>
          <span className="kpi-value">{fmtMoney(statementBalance, { cents: true })}</span>
          <span className="kpi-sub neutral">As of {account.statementDate ? fmtDate(account.statementDate) : "—"}</span>
        </div>
        <div className="card kpi-card">
          <span className="kpi-label">Outstanding Items</span>
          <span className="kpi-value">{fmtMoney(outstandingTotal, { cents: true })}</span>
          <span className="kpi-sub neutral">{outstanding.length} not yet cleared</span>
        </div>
        <div className="card kpi-card">
          <span className="kpi-label">Difference</span>
          <span className="kpi-value" style={{ color: isReconciled ? "var(--good)" : "var(--bad)" }}>
            {fmtMoney(difference, { cents: true })}
          </span>
          <span className={"kpi-sub " + (isReconciled ? "positive" : "negative")}>
            {isReconciled ? "Reconciled" : "Book balance vs. adjusted statement"}
          </span>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 className="card-title premium-shimmer">Outstanding by Account</h3>
        <p className="card-subtitle">Not-yet-cleared dollars across every account, at a glance</p>
        <ReportBarRows items={outstandingByAccount} />
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="page-header" style={{ marginBottom: 4 }}>
          <div>
            <h3 className="card-title premium-shimmer">{account.accountName} — Cleared Status</h3>
            <p className="card-subtitle" style={{ margin: 0 }}>
              Which transactions have shown up on the bank statement so far
            </p>
          </div>
          <button className="btn-primary" onClick={handleDownload}>
            Download Reconciliation Report
          </button>
        </div>
        <div className="table-scroll">
          <table className="tx-table tx-table-stack tx-stack-bank" style={{ marginTop: 16 }}>
            <thead>
              <tr>
                <th>Status</th>
                <th>Date</th>
                <th>Description</th>
                <th>Category</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {account.transactions.map((t, i) => (
                <tr key={i}>
                  <td>
                    <span className={"pill " + (t.cleared !== false ? "good" : "warm")}>
                      {t.cleared !== false ? "Cleared" : "Outstanding"}
                    </span>
                  </td>
                  <td>{fmtDate(t.date)}</td>
                  <td>{t.description}</td>
                  <td>
                    <span className="category-tag">{t.category}</span>
                  </td>
                  <td className={"num tx-amount " + (t.amount >= 0 ? "positive" : "negative")}>
                    {t.amount >= 0 ? "+" : ""}
                    {fmtMoney(t.amount, { cents: true })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3 className="card-title premium-shimmer">Reconciliation History</h3>
        <p className="card-subtitle">Prior periods closed and signed off for {account.accountName}</p>
        {history.length === 0 ? (
          <p className="card-subtitle" style={{ margin: 0 }}>
            No prior periods closed yet for this account.
          </p>
        ) : (
          <div className="table-scroll">
            <table className="tx-table tx-table-stack tx-stack-bank">
              <thead>
                <tr>
                  <th>Period</th>
                  <th>Closed</th>
                  <th>Closed By</th>
                </tr>
              </thead>
              <tbody>
                {history.map((r, i) => (
                  <tr key={i}>
                    <td>{r.period}</td>
                    <td>{fmtDate(r.closedDate)}</td>
                    <td>{r.closedBy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// PDF report generation
// Builds real, downloadable PDFs from a client's data using jsPDF (loaded
// from a CDN in index.html, since this prototype has no bundler/npm install).
// ----------------------------------------------------------------------------

const sanitizeFilename = (s) => s.replace(/[\\/:*?"<>|]/g, "");

// [5, 8, 13] is --navy (#05080d), the near-black navy the app switched to on
// 2026-09-15. jsPDF only takes RGB triples, not CSS custom properties, so
// these have to be kept in sync by hand if the theme color ever changes again.
const PDF_TABLE_THEME = {
  theme: "striped",
  styles: { fontSize: 9, cellPadding: 3, textColor: [5, 8, 13] },
  headStyles: { fillColor: [5, 8, 13], textColor: [250, 249, 246], fontStyle: "bold" },
  footStyles: { fillColor: [199, 174, 134], textColor: [5, 8, 13], fontStyle: "bold" },
  margin: { left: 14, right: 14 },
};

function newReportDoc(title, subtitle, client) {
  const doc = new window.jspdf.jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFillColor(5, 8, 13);
  doc.rect(0, 0, pageWidth, 28, "F");
  doc.setTextColor(250, 249, 246);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("MyGoodBooks", 14, 12);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(client.name, 14, 19.5);

  doc.setTextColor(5, 8, 13);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(title, 14, 40);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(110, 110, 110);
  doc.text(subtitle, 14, 47);

  return doc;
}

// periodKey selects how many of the trailing months in `client.monthly`
// the headline totals aggregate over — "month" (just the latest), "quarter"
// (last 3), or "ytd" (every month this mock data carries, which is only a
// trailing ~8 months, not a real calendar year — see the caveat this app
// already documents elsewhere for `client.monthly`). The month-by-month
// table and the category breakdown always show the same full history/
// current month regardless, since those aren't period-dependent.
function periodMonths(monthly, periodKey) {
  if (periodKey === "quarter") return monthly.slice(-3);
  if (periodKey === "ytd") return monthly.slice();
  return monthly.slice(-1);
}

const PERIOD_LABELS = { month: "This Month", quarter: "This Quarter", ytd: "Year to Date" };

function buildProfitAndLossPdf(client, periodKey = "month") {
  // Sourced from `monthly` and `budget`, not the transaction register: the
  // register is a short sample of recent activity, so summing it would
  // contradict the revenue figures shown on the dashboard.
  const latestMonth = client.monthly[client.monthly.length - 1];
  const monthLabel = `${latestMonth.month} ${new Date().getFullYear()}`;
  const periodMonthList = periodMonths(client.monthly, periodKey);
  const periodLabel = PERIOD_LABELS[periodKey] || PERIOD_LABELS.month;
  const periodIncome = periodMonthList.reduce((s, m) => s + m.income, 0);
  const periodExpenses = periodMonthList.reduce((s, m) => s + m.expenses, 0);
  const expenseRows = client.budget
    .map((b) => [b.category, b.actual])
    .sort((a, b) => b[1] - a[1]);
  const categorizedExpenses = expenseRows.reduce((s, [, v]) => s + v, 0);

  const doc = newReportDoc("Profit & Loss Statement", `${periodLabel} (through ${monthLabel})`, client);

  doc.autoTable({
    startY: 55,
    head: [["Month", "Income", "Expenses", "Net"]],
    body: client.monthly.map((m) => [
      m.month,
      fmtMoney(m.income),
      fmtMoney(m.expenses),
      (m.income - m.expenses >= 0 ? "+" : "") + fmtMoney(m.income - m.expenses),
    ]),
    columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" } },
    ...PDF_TABLE_THEME,
  });

  doc.autoTable({
    startY: doc.lastAutoTable.finalY + 8,
    head: [[`Expenses by Category — ${monthLabel}`, "Amount"]],
    body: expenseRows.map(([cat, amt]) => [cat, fmtMoney(amt)]),
    foot: [["Total Categorized Expenses", fmtMoney(categorizedExpenses)]],
    columnStyles: { 1: { halign: "right" } },
    ...PDF_TABLE_THEME,
  });

  let y = doc.lastAutoTable.finalY + 12;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(5, 8, 13);
  doc.text(`Total Income (${periodLabel}): ${fmtMoney(periodIncome)}`, 14, y);
  doc.text(`Total Expenses (${periodLabel}): ${fmtMoney(periodExpenses)}`, 14, y + 7);
  doc.text(
    `Net Income (${periodLabel}): ${fmtMoney(periodIncome - periodExpenses)}`,
    14,
    y + 16
  );

  const filename = `${sanitizeFilename(client.name)} - Profit and Loss (${periodLabel}).pdf`;
  doc.save(filename);
  return filename;
}

function buildBalanceSheetPdf(client) {
  const totalAssets = client.bankAccounts.reduce((s, a) => s + a.balance, 0);
  const totalLiabilities = (client.payables || []).reduce((s, p) => s + p.amount, 0);
  const totalFundBalance = client.funds.reduce((s, f) => s + f.balance, 0);
  const asOf = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  const doc = newReportDoc("Balance Sheet", `As of ${asOf}`, client);

  doc.autoTable({
    startY: 55,
    head: [["Assets", "Balance"]],
    body: client.bankAccounts.map((a) => [`${a.accountName} (••${a.accountMask})`, fmtMoney(a.balance, { cents: true })]),
    foot: [["Total Assets", fmtMoney(totalAssets, { cents: true })]],
    columnStyles: { 1: { halign: "right" } },
    ...PDF_TABLE_THEME,
  });

  doc.autoTable({
    startY: doc.lastAutoTable.finalY + 8,
    head: [["Liabilities", "Amount"]],
    body: (client.payables || []).map((p) => [`${p.vendor} — ${p.description}`, fmtMoney(p.amount, { cents: true })]),
    foot: [["Total Liabilities", fmtMoney(totalLiabilities, { cents: true })]],
    columnStyles: { 1: { halign: "right" } },
    ...PDF_TABLE_THEME,
  });

  let y = doc.lastAutoTable.finalY + 12;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(5, 8, 13);
  doc.text(`Net Assets: ${fmtMoney(totalAssets - totalLiabilities, { cents: true })}`, 14, y);

  const unrestricted = client.funds.filter((f) => !f.restricted).reduce((s, f) => s + f.balance, 0);
  const restricted = client.funds.filter((f) => f.restricted).reduce((s, f) => s + f.balance, 0);

  doc.autoTable({
    startY: y + 8,
    head: [["Net Assets by Fund", "Balance"]],
    body: [
      ...client.funds.map((f) => [
        f.name + (f.restricted ? " (restricted)" : " (unrestricted)"),
        fmtMoney(f.balance, { cents: true }),
      ]),
      ["Total Unrestricted", fmtMoney(unrestricted, { cents: true })],
      ["Total Restricted", fmtMoney(restricted, { cents: true })],
    ],
    foot: [["Total Net Assets", fmtMoney(totalFundBalance, { cents: true })]],
    columnStyles: { 1: { halign: "right" } },
    ...PDF_TABLE_THEME,
  });

  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  doc.setTextColor(110, 110, 110);
  doc.text(
    "Restricted fund balances are held within the accounts listed above, not in addition to them.",
    14,
    doc.lastAutoTable.finalY + 6
  );

  const filename = `${sanitizeFilename(client.name)} - Balance Sheet.pdf`;
  doc.save(filename);
  return filename;
}

function buildBudgetVsActualPdf(client) {
  const rows = client.budget.map((b) => {
    const variance = b.actual - b.budgeted;
    return [b.category, fmtMoney(b.budgeted), fmtMoney(b.actual), (variance >= 0 ? "+" : "") + fmtMoney(variance)];
  });
  const totalBudgeted = client.budget.reduce((s, b) => s + b.budgeted, 0);
  const totalActual = client.budget.reduce((s, b) => s + b.actual, 0);
  const totalVariance = totalActual - totalBudgeted;
  const latestMonth = client.monthly[client.monthly.length - 1];
  const period = `${latestMonth.month} ${new Date().getFullYear()}`;

  const doc = newReportDoc("Budget vs. Actual Report", `For the month of ${period}`, client);

  doc.autoTable({
    startY: 55,
    head: [["Category", "Budgeted", "Actual", "Variance"]],
    body: rows,
    foot: [["Total", fmtMoney(totalBudgeted), fmtMoney(totalActual), (totalVariance >= 0 ? "+" : "") + fmtMoney(totalVariance)]],
    columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" } },
    ...PDF_TABLE_THEME,
  });

  const filename = `${sanitizeFilename(client.name)} - Budget vs Actual.pdf`;
  doc.save(filename);
  return filename;
}

function buildContributionStatementPdf(client) {
  const contributions = client.contributions || [];
  const byFund = {};
  contributions.forEach((c) => {
    byFund[c.fund] = (byFund[c.fund] || 0) + c.amount;
  });
  const total = contributions.reduce((s, c) => s + c.amount, 0);
  const year = new Date().getFullYear();

  const doc = newReportDoc("Contribution Statement (YTD)", `January 1 – December 31, ${year}`, client);

  doc.autoTable({
    startY: 55,
    head: [["Fund", "Total Given"]],
    body: Object.entries(byFund).map(([fund, amt]) => [fund, fmtMoney(amt, { cents: true })]),
    foot: [["Total Contributions", fmtMoney(total, { cents: true })]],
    columnStyles: { 1: { halign: "right" } },
    ...PDF_TABLE_THEME,
  });

  doc.autoTable({
    startY: doc.lastAutoTable.finalY + 8,
    head: [["Date", "Donor", "Fund", "Method", "Amount"]],
    body: contributions.map((c) => [fmtDate(c.date), c.donor, c.fund, c.method, fmtMoney(c.amount, { cents: true })]),
    columnStyles: { 4: { halign: "right" } },
    ...PDF_TABLE_THEME,
  });

  const filename = `${sanitizeFilename(client.name)} - Contribution Statement.pdf`;
  doc.save(filename);
  return filename;
}

// Reconciliation Pro only. { statementBalance, outstanding, difference } is
// exactly what ReconciliationPanel already computed for the page itself, so
// there's no second copy of the balancing math to keep in sync.
function buildReconciliationReportPdf(client, account, { statementBalance, outstanding, difference }) {
  const outstandingTotal = outstanding.reduce((s, t) => s + t.amount, 0);
  const doc = newReportDoc(`Bank Reconciliation — ${account.accountName}`, account.statementDate ? `Statement dated ${fmtDate(account.statementDate)}` : "Current period", client);

  doc.autoTable({
    startY: 55,
    head: [["", "Amount"]],
    body: [
      ["Statement Balance", fmtMoney(statementBalance, { cents: true })],
      ["Outstanding Items", fmtMoney(outstandingTotal, { cents: true })],
      ["Adjusted Balance", fmtMoney(statementBalance + outstandingTotal, { cents: true })],
      ["Book Balance", fmtMoney(account.balance, { cents: true })],
    ],
    foot: [["Difference", fmtMoney(difference, { cents: true })]],
    columnStyles: { 1: { halign: "right" } },
    ...PDF_TABLE_THEME,
  });

  doc.autoTable({
    startY: doc.lastAutoTable.finalY + 8,
    head: [["Date", "Description", "Category", "Amount"]],
    body: outstanding.length
      ? outstanding.map((t) => [fmtDate(t.date), t.description, t.category, fmtMoney(t.amount, { cents: true })])
      : [["—", "No outstanding items", "—", "—"]],
    columnStyles: { 3: { halign: "right" } },
    ...PDF_TABLE_THEME,
  });

  const filename = `${sanitizeFilename(client.name)} - ${sanitizeFilename(account.accountName)} Reconciliation.pdf`;
  doc.save(filename);
  return filename;
}

// Fund Accounting Pro only. One donor's gifts across every fund, YTD — the
// per-donor equivalent of buildContributionStatementPdf's by-fund summary.
function buildGivingStatementPdf(client, donorName) {
  const gifts = (client.contributions || []).filter((c) => c.donor === donorName);
  const total = gifts.reduce((s, c) => s + c.amount, 0);
  const year = new Date().getFullYear();

  const doc = newReportDoc(`Giving Statement — ${donorName}`, `January 1 – December 31, ${year}`, client);

  doc.autoTable({
    startY: 55,
    head: [["Date", "Fund", "Method", "Amount"]],
    body: gifts.map((c) => [fmtDate(c.date), c.fund, c.method, fmtMoney(c.amount, { cents: true })]),
    foot: [["", "", "Total", fmtMoney(total, { cents: true })]],
    columnStyles: { 3: { halign: "right" } },
    ...PDF_TABLE_THEME,
  });

  const filename = `${sanitizeFilename(client.name)} - ${sanitizeFilename(donorName)} Giving Statement.pdf`;
  doc.save(filename);
  return filename;
}

// Payroll add-on only (client.payroll). The per-employee equivalent of
// buildContributionStatementPdf's by-fund summary — the roster on the
// Payroll page itself deliberately leaves out rate/YTD figures and points
// here instead, so this is where they actually live.
function buildPayrollYtdPdf(client) {
  const payroll = client.payroll;
  const employees = payroll.employees;
  const totals = employees.reduce(
    (s, e) => ({
      gross: s.gross + e.ytdGross,
      federal: s.federal + e.ytdFederalWithholding,
      state: s.state + e.ytdStateWithholding,
      fica: s.fica + e.ytdFica,
      net: s.net + e.ytdNet,
    }),
    { gross: 0, federal: 0, state: 0, fica: 0, net: 0 }
  );
  const year = new Date().getFullYear();

  const doc = newReportDoc("Payroll — Year to Date by Employee", `January 1 – Present, ${year}`, client);

  doc.autoTable({
    startY: 55,
    head: [["Employee", "Gross YTD", "Federal W/H", "State W/H", "FICA", "Net YTD"]],
    body: employees.map((e) => [
      e.name,
      fmtMoney(e.ytdGross),
      fmtMoney(e.ytdFederalWithholding),
      fmtMoney(e.ytdStateWithholding),
      fmtMoney(e.ytdFica),
      fmtMoney(e.ytdNet),
    ]),
    foot: [[
      `Total (${employees.length} employees)`,
      fmtMoney(totals.gross),
      fmtMoney(totals.federal),
      fmtMoney(totals.state),
      fmtMoney(totals.fica),
      fmtMoney(totals.net),
    ]],
    columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" } },
    ...PDF_TABLE_THEME,
  });

  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  doc.setTextColor(110, 110, 110);
  doc.text(`Figures synced from ${payroll.provider}.`, 14, doc.lastAutoTable.finalY + 6);

  const filename = `${sanitizeFilename(client.name)} - Payroll YTD.pdf`;
  doc.save(filename);
  return filename;
}

function buildDraftBudgetPdf(client, rows) {
  const totalCurrent = rows.reduce((s, r) => s + r.current, 0);
  const totalProposed = rows.reduce((s, r) => s + r.proposed, 0);

  const doc = newReportDoc("Draft Budget", "Proposed for next period", client);

  doc.autoTable({
    startY: 55,
    head: [["Category", "This Year's Actual", "Current Budget", "Proposed Budget"]],
    body: rows.map((r) => [r.category, fmtMoney(r.actual), fmtMoney(r.current), fmtMoney(r.proposed)]),
    foot: [["Total", "", fmtMoney(totalCurrent), fmtMoney(totalProposed)]],
    columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" } },
    ...PDF_TABLE_THEME,
  });

  const filename = `${sanitizeFilename(client.name)} - Draft Budget.pdf`;
  doc.save(filename);
  return filename;
}

const REPORT_PDF_BUILDERS = {
  pl: buildProfitAndLossPdf,
  bs: buildBalanceSheetPdf,
  budget: buildBudgetVsActualPdf,
  giving: buildContributionStatementPdf,
  payroll: buildPayrollYtdPdf,
};

// ----------------------------------------------------------------------------
// Reports page
// ----------------------------------------------------------------------------

const REPORT_TYPES = [
  { key: "pl", name: "Profit & Loss Statement", description: "Income and expenses for the selected period." },
  { key: "bs", name: "Balance Sheet", description: "Assets, liabilities, and fund balances as of month end." },
  { key: "budget", name: "Budget vs. Actual Report", description: "Category-by-category comparison for the current month." },
  { key: "giving", name: "Contribution Statement (YTD)", description: "Giving summary by fund, ready to share with your board or donors." },
  // Payroll add-on only (client.payroll) — filtered out below for a client
  // that hasn't added it, same as this report type not existing at all.
  { key: "payroll", name: "Payroll — Year to Date", description: "Gross pay, withholding, and net by employee.", requires: "payroll" },
];

// The plain per-report "download a PDF" grid — shared by ReportsPage (the
// standard tab) and ReportBuilderPage (what premium clients see instead).
// Report Builder replaced this tab entirely rather than sitting alongside
// it (see PREMIUM_UPGRADE_TAB_KEYS), so it has to be a strict superset of
// what the standard Reports page could already do, not just its own custom
// builder — this is what keeps the plain "just give me a PDF" downloads
// reachable for a premium client too.
function QuickDownloadReports({ client }) {
  const showToast = useToast();
  // Only the Profit & Loss report has a real trailing-month range to
  // aggregate over (client.monthly) — Balance Sheet is always a snapshot as
  // of today, Budget vs. Actual and the Contribution Statement only ever
  // carry one period's worth of data in this mock dataset, so this toggle
  // is deliberately scoped to just the one report it actually changes.
  const [period, setPeriod] = useState("month");
  const availableReportTypes = REPORT_TYPES.filter((r) => !r.requires || client[r.requires]);

  const handleDownload = (r) => {
    const filename = REPORT_PDF_BUILDERS[r.key](client, r.key === "pl" ? period : undefined);
    showToast(`Downloaded "${filename}"`);
  };

  return (
    <div>
      <div className="card" style={{ marginBottom: 20 }}>
        <h3 className="card-title">Period</h3>
        <p className="card-subtitle" style={{ margin: 0 }}>
          Applies to the Profit &amp; Loss Statement below — the other reports each only ever cover
          one fixed period.
        </p>
        <div className="view-toggle" style={{ marginTop: 12 }}>
          {["month", "quarter", "ytd"].map((key) => (
            <button
              type="button"
              key={key}
              className={"view-toggle-btn" + (period === key ? " active" : "")}
              onClick={() => setPeriod(key)}
            >
              {PERIOD_LABELS[key]}
            </button>
          ))}
        </div>
      </div>

      <div className="report-grid">
        {availableReportTypes.map((r) => (
          <div className="card report-card" key={r.key}>
            <h3 className="card-title">{r.name}</h3>
            <p className="card-subtitle">
              {r.key === "pl" ? `${r.description} Currently set to ${PERIOD_LABELS[period]}.` : r.description}
            </p>
            <button className="btn-primary" onClick={() => handleDownload(r)}>
              Download PDF
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReportsPage({ client }) {
  return (
    <div>
      <MockBanner text="Reports are generated as real PDFs from this client's mock data — once QuickBooks is connected in Phase 2, these will reflect live books." />
      <QuickDownloadReports client={client} />
    </div>
  );
}

// ----------------------------------------------------------------------------
// Report Builder — assembles a formatted board/leadership report from this
// client's real data (not a separate mock dataset). Two states: pick a
// period/scope/sections in the builder panel, then "Generate Report" swaps
// to a printable, presentable report built from those same numbers.
// ----------------------------------------------------------------------------

// direction-agnostic % change between two totals for the same period length.
// `goodDir` says which direction reads as positive (expenses down = good).
function trendInfo(current, prior, goodDir = "up") {
  if (prior == null || prior === 0) {
    return { dir: "flat", cls: "neutral", label: "no prior period on record", arrow: "•" };
  }
  const pct = ((current - prior) / Math.abs(prior)) * 100;
  const dir = pct > 0.5 ? "up" : pct < -0.5 ? "down" : "flat";
  const cls = dir === "flat" ? "neutral" : dir === goodDir ? "positive" : "negative";
  const label = dir === "flat" ? "steady vs. prior period" : `${Math.abs(pct).toFixed(1)}% vs. prior period`;
  const arrow = dir === "up" ? "▲" : dir === "down" ? "▼" : "●";
  return { dir, cls, label, arrow };
}

function TrendPill({ current, prior, goodDir }) {
  const t = trendInfo(current, prior, goodDir);
  const pillClass = t.cls === "positive" ? "good" : t.cls === "negative" ? "bad" : "neutral";
  return (
    <span className={"pill " + pillClass}>
      {t.arrow} {t.label}
    </span>
  );
}

// Small horizontal bar list shared by the budget and fund breakdowns —
// same visual language as .bar-track/.bar-fill elsewhere, just laid out
// as rows with a trailing amount instead of inline in a table cell.
function ReportBarRows({ items }) {
  const max = Math.max(...items.map((i) => Math.abs(i.amount)), 1);
  return (
    <div className="rb-bar-rows">
      {items.map((item) => (
        <div className="rb-bar-row" key={item.label}>
          <span>{item.label}</span>
          <div className="bar-track">
            <div
              className={"bar-fill " + (item.tone || "rb-bar-fill")}
              style={{ width: `${Math.max(4, Math.round((Math.abs(item.amount) / max) * 100))}%` }}
            ></div>
          </div>
          <span className="rb-bar-amt">{fmtMoney(item.amount)}</span>
        </div>
      ))}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Enterprise upgrade preview — what a standard-plan client's "+"/lock in the
// sidebar opens instead of the real upgraded pages, none of which are
// separate tabs to strip from access.tabs anymore: a standard client's
// Dashboard/Budget vs. Actual/Cash Flow/Reports/Bank Accounts/Giving & Funds
// already ARE the tabs they'll keep using after upgrading, just showing the
// plain version — see showsLiveReport/showsBudgetingTool/showsCashFlowPro/
// showsReportBuilder/showsReconciliationPro/showsFundAccountingPro in App
// for where each one flips over.
// ----------------------------------------------------------------------------

const ENTERPRISE_FEATURES = [
  {
    icon: <DocumentIcon />,
    title: "Live Report",
    description: "Your dashboard becomes a continuously-live financial snapshot — cash on hand, receivables, what's due — instead of a static once-a-day view. Click-to-jump KPIs, a low-cash alert, a collections queue, and a one-click PDF snapshot, all customizable to how you work.",
  },
  {
    icon: <BarChartIcon />,
    title: "Report Builder",
    description: "Assemble a formatted board report from your own numbers in a couple of clicks — pick a period, a scope, and the sections that matter this quarter.",
  },
  {
    icon: <CalculatorIcon />,
    title: "Budgeting Tool",
    description: "Draft next period's budget together with your bookkeeper, category by category, before it's locked in.",
  },
  {
    icon: <StackedBillsIcon />,
    title: "Cash Flow Pro",
    description: "Every bill in one place with aging and vendor summaries, batch pay runs with an approval step and a cash-impact forecast, duplicate-bill detection, and a ready-to-upload ACH export.",
  },
  {
    icon: <BankIcon />,
    title: "Reconciliation Pro",
    description: "A real month-end close on Bank Accounts — clear transactions against your statement, track outstanding items automatically, and keep a signed-off history of every period you've closed.",
  },
  {
    icon: <GiftHeartIcon />,
    title: "Fund Accounting Pro",
    description: "See money move between funds with a reason attached, track pledges from committed to received, and send year-end giving statements to every donor for their tax write-offs.",
  },
];

// Tool-by-tool feature lists for the interactive comparison accordion below.
// One entry per tab that has a premium upgrade (PREMIUM_UPGRADE_TAB_KEYS) —
// kept as its own list rather than reused from ENTERPRISE_FEATURES because
// this one needs a "what you already have" column too, not just "what's
// new." Feature text mirrors what each real page actually renders (same
// grounding rule as the standard-vs-premium comparison mockup this was
// built from), not marketing copy.
const ENTERPRISE_COMPARISON = [
  {
    key: "dashboard",
    tool: "Dashboard",
    standardLabel: "Dashboard",
    premiumLabel: "Live Report",
    standard: [
      "KPI row: Cash on Hand, Net Surplus/Deficit, Revenue, Operating Reserve",
      "Income vs. Expenses — 12-month trend chart",
      "Recent Activity — latest transactions across all accounts",
      "Customizable widget layout, with saved views",
    ],
    premium: [
      "Continuously-live snapshot, not just a once-a-day view",
      "Click-to-jump KPIs: Cash, Receivables, Payables, Net Income MTD",
      "Cash by Account donut and Top Expense Categories",
      "Receivables Aging with a Collections Queue",
      "Cash Flow Forecast, Revenue Trend, and Anomalies & Flags",
      "Low-cash alert and a one-click PDF snapshot",
    ],
  },
  {
    key: "receivables",
    tool: "Cash Flow",
    standardLabel: "Cash Flow",
    premiumLabel: "Cash Flow Pro",
    standard: ["Money Owed To You / Money You Owe ledger", "Simple receivables and payables tables"],
    premium: [
      "Open Bills workflow with status filters and search",
      "Duplicate-bill detection",
      "Batch Pay Runs with an approval step and a ready-to-upload ACH export",
      "Vendor Summary and Aging Summary",
      "Next 5 Due, at a glance",
    ],
  },
  {
    key: "budget",
    tool: "Budget vs. Actual",
    standardLabel: "Budget vs. Actual",
    premiumLabel: "Budgeting Tool",
    standard: ["Budgeted vs. actual, by category, with a variance and % used", "Spending Trend chart"],
    premium: [
      "Collaborative draft budget for next period",
      "Editable per-category proposed amounts",
      "Add or remove categories inline",
      "Download Draft Budget PDF",
    ],
  },
  {
    key: "reports",
    tool: "Reports",
    standardLabel: "Reports",
    premiumLabel: "Report Builder",
    standard: ["Four canned PDFs — Profit & Loss, Balance Sheet, Budget vs. Actual, Contribution Statement"],
    premium: [
      "Everything Reports has, in the same Quick Download tab",
      "Custom report builder — pick a period, a scope, and which sections to include",
      "Live preview while building",
      "A presentation mode for board meetings",
    ],
  },
  {
    key: "bank",
    tool: "Bank Accounts",
    standardLabel: "Bank Accounts",
    premiumLabel: "Reconciliation Pro",
    standard: ["Balances and transaction history, per account or all at once", "CSV export"],
    premium: [
      "Real month-end reconciliation workflow",
      "Cleared vs. outstanding tracking, transaction by transaction",
      "Reconciliation history, with who closed each period and when",
      "Downloadable reconciliation report",
    ],
  },
  {
    key: "giving",
    tool: "Giving & Funds",
    standardLabel: "Giving & Funds",
    premiumLabel: "Fund Accounting Pro",
    standard: ["Fund balances, restricted vs. unrestricted", "Contribution history"],
    premium: [
      "Fund Activity ledger — money moved between funds, with a reason",
      "Pledge tracking — committed vs. received, with an aging status",
      "Tax Documents — year-end giving statements, downloadable per donor or sent to everyone at once",
    ],
  },
];

// PLACEHOLDER PRICING — mock figures only, standing in until MyGoodBooks
// gives real numbers. Priced per user profile per month (client.users.length
// — every login the client has configured, not just full-access ones) so
// the total scales with how many people at the organization actually sign
// in, rather than being a flat per-org rate. Kept in one place on purpose
// so swapping in real numbers later is a one-line change, not a hunt
// through the page.
const ENTERPRISE_PRICING = {
  standard: { perUser: 19, note: "Included in your current plan" },
  enterprise: { perUser: 12, note: "Added on top of Standard, billed monthly" },
};

function EnterpriseUpgradePage({ client }) {
  const showToast = useToast();
  // Which tool's row is expanded in the comparison list below — starts with
  // none open so the page loads short, not a wall of text. A client
  // interested in one thing (say, reconciliation) can go straight to it
  // without scrolling past five others already expanded.
  const [openKey, setOpenKey] = useState(null);
  const userCount = (client.users || []).length || 1;

  return (
    <div className="enterprise-page">
      <MockBanner text="This is a preview of what Enterprise includes — nothing here is connected to a real upgrade flow yet, and the pricing below is a placeholder." />

      <div className="card" style={{ marginBottom: 20, textAlign: "center", padding: "36px 28px" }}>
        <div className="eyebrow-badge">Enterprise · Add-on</div>
        <h2 style={{ fontFamily: "var(--font-heading)", fontSize: 26, margin: "10px 0 8px", color: "var(--ink-strong)" }}>
          Unlock Enterprise for {client.name}
        </h2>
        <p style={{ color: "var(--text-muted)", maxWidth: 560, margin: "0 auto" }}>
          Six tools built for organizations that want more than a monthly statement — a live pulse on the numbers, a
          board-ready report in minutes, a shared space to plan next period's budget, a command center for what you
          owe, a real month-end close, and fund accounting that tracks pledges and transfers.
        </p>
      </div>

      <div className="pricing-grid" style={{ marginBottom: 20 }}>
        <div className="card pricing-card">
          <div className="eyebrow-badge">Your current plan</div>
          <h3 className="card-title" style={{ marginTop: 14, marginBottom: 2 }}>
            Standard
          </h3>
          <div className="pricing-value">
            ${ENTERPRISE_PRICING.standard.perUser}
            <span>/user/mo</span>
          </div>
          <p className="pricing-total">
            ${ENTERPRISE_PRICING.standard.perUser * userCount}/mo total for {userCount} user profile{userCount !== 1 ? "s" : ""}
          </p>
          <p className="card-subtitle" style={{ marginBottom: 0 }}>
            {ENTERPRISE_PRICING.standard.note}
          </p>
        </div>
        <div className="card pricing-card pricing-card-premium">
          <span className="nav-pro-pill">Enterprise</span>
          <h3 className="card-title" style={{ marginTop: 14, marginBottom: 2 }}>
            + Enterprise
          </h3>
          <div className="pricing-value pricing-value-premium">
            +${ENTERPRISE_PRICING.enterprise.perUser}
            <span>/user/mo</span>
          </div>
          <p className="pricing-total pricing-total-premium">
            +${ENTERPRISE_PRICING.enterprise.perUser * userCount}/mo total for {userCount} user profile{userCount !== 1 ? "s" : ""}
          </p>
          <p className="card-subtitle" style={{ marginBottom: 0 }}>
            {ENTERPRISE_PRICING.enterprise.note}
          </p>
          <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "8px 0 0" }}>
            Estimated — your bookkeeper will confirm final pricing.
          </p>
        </div>
      </div>

      <div className="report-grid" style={{ marginBottom: 20 }}>
        {ENTERPRISE_FEATURES.map((f) => (
          <div className="card" key={f.title}>
            <div className="icon-badge">{f.icon}</div>
            <h3 className="card-title" style={{ marginTop: 14 }}>
              {f.title}
            </h3>
            <p className="card-subtitle" style={{ marginBottom: 0 }}>
              {f.description}
            </p>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 className="card-title">Compare, tool by tool</h3>
        <p className="card-subtitle">
          Click a tool to see exactly what changes — everything on the left, you already have.
        </p>
        <div className="compare-list">
          {ENTERPRISE_COMPARISON.map((c) => {
            const isOpen = openKey === c.key;
            return (
              <div className={"compare-row" + (isOpen ? " open" : "")} key={c.key}>
                <button
                  type="button"
                  className="compare-row-head"
                  onClick={() => setOpenKey(isOpen ? null : c.key)}
                  aria-expanded={isOpen}
                >
                  <span>{c.tool}</span>
                  {isOpen ? <ChevronUpIcon /> : <ChevronDownIcon />}
                </button>
                {/* Always mounted (not isOpen &&) — grid-template-rows animates
                    0fr/1fr smoothly on both open AND close, which conditional
                    mounting can't do (a removed node has nothing to transition
                    from). The inner div's own padding/margins collapse to
                    nothing at 0fr since overflow:hidden clips it, so there's
                    no telltale gap when closed. */}
                <div className="compare-row-body-wrap">
                  <div className="compare-row-body">
                    <div className="compare-col">
                      <div className="compare-col-header">{c.standardLabel}</div>
                      <ul className="compare-feat-list">
                        {c.standard.map((f, i) => (
                          <li key={i}>{f}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="compare-col compare-col-premium">
                      <div className="compare-col-header premium">
                        {c.premiumLabel} <span className="nav-pro-pill">PRO</span>
                      </div>
                      <ul className="compare-feat-list">
                        {c.premium.map((f, i) => (
                          <li key={i}>{f}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
        <div>
          <h3 className="card-title">Ready to add it on?</h3>
          <p className="card-subtitle" style={{ marginBottom: 0 }}>
            Your bookkeeper can turn this on for {client.name} — no setup required on your end.
          </p>
        </div>
        <button className="btn-primary" onClick={() => showToast("Thanks! Your bookkeeper will follow up about upgrading.")}>
          Upgrade to Enterprise
        </button>
      </div>
    </div>
  );
}

// Calendar quarters, matched against the "Mon" month labels client.monthly
// already uses. Whichever of these months a client actually has recorded
// data for is what a quarter picks up — most clients only have a trailing
// handful of months on file, so a quarter can legitimately be partial (one
// month) or empty (none yet), and the report says so rather than showing
// fabricated zeros as if they were real figures.
const REPORT_QUARTER_DEFS = [
  { key: "q1", label: "Q1", months: ["Jan", "Feb", "Mar"] },
  { key: "q2", label: "Q2", months: ["Apr", "May", "Jun"] },
  { key: "q3", label: "Q3", months: ["Jul", "Aug", "Sep"] },
  { key: "q4", label: "Q4", months: ["Oct", "Nov", "Dec"] },
];

const REPORT_MONTH_NAMES = {
  Jan: "January", Feb: "February", Mar: "March", Apr: "April", May: "May", Jun: "June",
  Jul: "July", Aug: "August", Sep: "September", Oct: "October", Nov: "November", Dec: "December",
};

// Builds the period dropdown: Year to Date (everything on file) and all
// four quarters are always offered — a quarter with nothing recorded yet
// (e.g. Q4, most clients only have data through August) just reports that
// honestly rather than being hidden — plus one option per month this
// client actually has on record.
function reportPeriodOptions(monthly) {
  return [
    { key: "ytd", label: "Year to Date", months: monthly.map((m) => m.month) },
    ...REPORT_QUARTER_DEFS,
    ...monthly.map((m) => ({ key: "m-" + m.month, label: REPORT_MONTH_NAMES[m.month] || m.month, months: [m.month] })),
  ];
}

const REPORT_SECTION_DEFS = [
  { key: "revenue", label: "Revenue & Expenses" },
  { key: "budget", label: "Budget vs. Actual" },
  { key: "cash", label: "Cash Position" },
  { key: "receivables", label: "Cash Flow" },
  { key: "giving", label: "Giving & Funds" },
  { key: "outlook", label: "Outlook" },
];

function ReportBuilderPage({ client }) {
  const [stage, setStage] = useState("builder"); // "builder" | "report"
  const [builderTab, setBuilderTab] = useState("quick"); // "custom" | "quick" — see QuickDownloadReports
  const [presenting, setPresenting] = useState(false);
  const [period, setPeriod] = useState("ytd");
  const [scope, setScope] = useState("consolidated"); // "consolidated" | "by-fund"

  const funds = client.funds || [];
  const contributions = client.contributions || [];
  const hasFunds = funds.length > 0;

  const [sections, setSections] = useState({
    revenue: true,
    budget: true,
    cash: true,
    receivables: true,
    giving: hasFunds || contributions.length > 0,
    outlook: true,
  });

  useEffect(() => {
    document.body.classList.toggle("rb-presenting", presenting);
    return () => document.body.classList.remove("rb-presenting");
  }, [presenting]);

  const toggleSection = (key) => setSections((s) => ({ ...s, [key]: !s[key] }));

  const monthly = client.monthly;
  const periodOptions = useMemo(() => reportPeriodOptions(monthly), [monthly]);
  const selectedOption = periodOptions.find((p) => p.key === period) || periodOptions[0];

  // "Prior period" is the equal-length stretch of months immediately before
  // whichever ones are selected, by position in this client's own record —
  // not a literal prior quarter/year, since most clients don't have a full
  // year (let alone two) on file. Degrades to "no prior period" cleanly via
  // trendInfo() when nothing precedes the selection.
  const selectedIndices = monthly.reduce((acc, m, i) => (selectedOption.months.includes(m.month) ? [...acc, i] : acc), []);
  const currentSlice = selectedIndices.map((i) => monthly[i]);
  const priorSlice =
    selectedIndices.length && selectedIndices[0] - selectedIndices.length >= 0
      ? monthly.slice(selectedIndices[0] - selectedIndices.length, selectedIndices[0])
      : [];
  const hasPeriodData = currentSlice.length > 0;
  const sum = (arr, key) => arr.reduce((s, m) => s + m[key], 0);

  const revenueTotal = sum(currentSlice, "income");
  const revenuePrior = priorSlice.length ? sum(priorSlice, "income") : null;
  const expenseTotal = sum(currentSlice, "expenses");
  const expensePrior = priorSlice.length ? sum(priorSlice, "expenses") : null;
  const netTotal = revenueTotal - expenseTotal;
  const netPrior = priorSlice.length ? revenuePrior - expensePrior : null;

  const cash = totalCash(client);
  const monthlyExpenses = avgMonthlyExpenses(client);
  const runwayMonths = runwayMonthsFor(client);

  const totalReceivable = client.receivables.reduce((s, r) => s + r.amount, 0);
  const totalPayable = client.payables.reduce((s, p) => s + p.amount, 0);

  const totalGiving = contributions.reduce((s, c) => s + c.amount, 0);
  const restrictedTotal = funds.filter((f) => f.restricted).reduce((s, f) => s + f.balance, 0);
  const unrestrictedTotal = funds.filter((f) => !f.restricted).reduce((s, f) => s + f.balance, 0);

  const overBudget = client.budget
    .filter((b) => b.actual > b.budgeted)
    .sort((a, b) => b.actual - b.budgeted - (a.actual - a.budgeted))
    .slice(0, 5);
  const budgetTotal = client.budget.reduce((acc, b) => ({ budgeted: acc.budgeted + b.budgeted, actual: acc.actual + b.actual }), {
    budgeted: 0,
    actual: 0,
  });

  const periodLabel = selectedOption.label;
  const rangeLabel = hasPeriodData
    ? currentSlice.length > 1
      ? `${currentSlice[0].month} – ${currentSlice[currentSlice.length - 1].month}`
      : currentSlice[0].month
    : "No data yet";
  const scopeLabel = scope === "by-fund" ? "By fund" : "Consolidated";

  const generate = () => {
    setStage("report");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (stage === "builder") {
    return (
      <div>
        <MockBanner text="Report Builder assembles a formatted report from this client's own numbers shown elsewhere in the portal — nothing here is a separate dataset." />

        <div className="view-toggle" style={{ marginBottom: 20 }}>
          <button
            type="button"
            className={"view-toggle-btn" + (builderTab === "quick" ? " active" : "")}
            onClick={() => setBuilderTab("quick")}
          >
            Quick Download
          </button>
          <button
            type="button"
            className={"view-toggle-btn" + (builderTab === "custom" ? " active" : "")}
            onClick={() => setBuilderTab("custom")}
          >
            Custom Report
          </button>
        </div>

        {builderTab === "quick" && <QuickDownloadReports client={client} />}

        {builderTab === "custom" && (
        <div className="rb-layout">
          <div className="card rb-panel">
            <h3 className="card-title premium-shimmer">Build a report</h3>
            <p className="rb-panel-sub">Choose a period, a scope, and which sections belong in this report.</p>

            <div className="rb-field">
              <label className="rb-field-label" htmlFor="rb-period">
                Reporting period
              </label>
              <select id="rb-period" className="rb-select" value={period} onChange={(e) => setPeriod(e.target.value)}>
                <option value="ytd">Year to Date</option>
                <optgroup label="Quarters">
                  {REPORT_QUARTER_DEFS.map((q) => (
                    <option key={q.key} value={q.key}>
                      {q.label}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Months">
                  {monthly.map((m) => (
                    <option key={"m-" + m.month} value={"m-" + m.month}>
                      {REPORT_MONTH_NAMES[m.month] || m.month}
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>

            <div className="rb-field">
              <label className="rb-field-label">Scope</label>
              <div className="rb-segmented">
                <button type="button" aria-pressed={scope === "consolidated"} onClick={() => setScope("consolidated")}>
                  Consolidated
                </button>
                <button type="button" aria-pressed={scope === "by-fund"} disabled={!hasFunds} onClick={() => hasFunds && setScope("by-fund")}>
                  By fund
                </button>
              </div>
              {!hasFunds && <p className="rb-note">This client has no tracked funds yet, so fund-level breakdowns aren't available.</p>}
            </div>

            <div className="rb-field">
              <label className="rb-field-label">Sections</label>
              <ul className="rb-checklist">
                <li className="locked">
                  Executive summary <span className="locked-note">always included</span>
                </li>
                {REPORT_SECTION_DEFS.filter((s) => s.key !== "giving" || hasFunds || contributions.length > 0).map((s) => (
                  <li key={s.key}>
                    <label>
                      <input type="checkbox" checked={sections[s.key]} onChange={() => toggleSection(s.key)} />
                      <span>{s.label}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>

            <button className="btn-primary" style={{ width: "100%" }} onClick={generate}>
              Generate Report
            </button>
          </div>

          <div className="card rb-preview">
            <div className="rb-preview-label">Live Preview</div>
            <div className="rb-preview-cover">
              <div className="rb-eyebrow">Board Report &middot; {scopeLabel}</div>
              <h3>{client.name}</h3>
              <div className="rb-meta-row rb-meta-row-compact">
                <div>
                  <b>{periodLabel}</b>Period
                </div>
                <div>
                  <b>{rangeLabel}</b>Range
                </div>
              </div>
            </div>

            {hasPeriodData ? (
              <div className="rb-preview-stats">
                <div>
                  <span className="rb-preview-stat-label">Revenue</span>
                  <span className="rb-preview-stat-value">{fmtMoney(revenueTotal)}</span>
                </div>
                <div>
                  <span className="rb-preview-stat-label">Net Income</span>
                  <span className="rb-preview-stat-value">{fmtMoney(netTotal)}</span>
                </div>
                <div>
                  <span className="rb-preview-stat-label">Cash on Hand</span>
                  <span className="rb-preview-stat-value">{fmtMoney(cash)}</span>
                </div>
              </div>
            ) : (
              <p className="rb-commentary">No revenue or expense data recorded for {periodLabel} yet — the report will still include cash, budget, and other sections you've checked below.</p>
            )}

            <div className="rb-preview-sections">
              <span className="rb-preview-stat-label">Sections included</span>
              <div className="rb-preview-pills">
                <span className="pill neutral">Executive Summary</span>
                {REPORT_SECTION_DEFS.filter((s) => sections[s.key] && (s.key !== "giving" || hasFunds || contributions.length > 0)).map((s) => (
                  <span className="pill neutral" key={s.key}>{s.label}</span>
                ))}
              </div>
            </div>
          </div>
        </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="rb-toolbar">
        <button className="btn-secondary" onClick={() => setStage("builder")}>
          &larr; Edit report
        </button>
        <div className="rb-actions">
          {presenting ? (
            <button className="btn-secondary" onClick={() => setPresenting(false)}>
              &larr; Exit presentation
            </button>
          ) : (
            <button className="btn-secondary" onClick={() => setPresenting(true)}>
              Presentation view
            </button>
          )}
          <button className="btn-primary" onClick={() => window.print()}>
            Print / Save as PDF
          </button>
        </div>
      </div>

      <div className="card rb-report">
        <div className="rb-cover">
          <div className="rb-eyebrow">Board Report &middot; {scopeLabel}</div>
          <h1>{client.name}</h1>
          <div className="rb-meta-row">
            <div>
              <b>{periodLabel}</b>Reporting period
            </div>
            <div>
              <b>{rangeLabel}</b>Date range
            </div>
            <div>
              <b>{scopeLabel}</b>Scope
            </div>
            <div>
              <b>Generated by MyGoodBooks</b>Prepared for board review
            </div>
          </div>
        </div>

        <div className="rb-section">
          <h2>Executive Summary</h2>
          <p className="rb-section-sub">
            {periodLabel} &middot; {rangeLabel}
          </p>
          <div className="kpi-grid">
            <div className="card kpi-card">
              <span className="kpi-label">Revenue</span>
              {hasPeriodData ? (
                <>
                  <span className="kpi-value">{fmtMoney(revenueTotal)}</span>
                  <TrendPill current={revenueTotal} prior={revenuePrior} goodDir="up" />
                </>
              ) : (
                <>
                  <span className="kpi-value">—</span>
                  <span className="kpi-sub neutral">no data for this period</span>
                </>
              )}
            </div>
            <div className="card kpi-card">
              <span className="kpi-label">Net Income</span>
              {hasPeriodData ? (
                <>
                  <span className="kpi-value">{fmtMoney(netTotal)}</span>
                  <TrendPill current={netTotal} prior={netPrior} goodDir="up" />
                </>
              ) : (
                <>
                  <span className="kpi-value">—</span>
                  <span className="kpi-sub neutral">no data for this period</span>
                </>
              )}
            </div>
            <div className="card kpi-card">
              <span className="kpi-label">Cash on Hand</span>
              <span className="kpi-value">{fmtMoney(cash)}</span>
              <span className="kpi-sub neutral">as of today</span>
            </div>
            <div className="card kpi-card">
              <span className="kpi-label">Receivables</span>
              <span className="kpi-value">{fmtMoney(totalReceivable)}</span>
              <span className="kpi-sub neutral">{client.receivables.length} open item{client.receivables.length !== 1 ? "s" : ""}</span>
            </div>
          </div>
          <p className="rb-commentary">
            {hasPeriodData ? (
              <>
                {periodLabel} was a {netTotal >= netPrior || netPrior == null ? "solid" : "tighter"} stretch: revenue{" "}
                {trendInfo(revenueTotal, revenuePrior).dir === "up" ? "grew" : trendInfo(revenueTotal, revenuePrior).dir === "down" ? "declined" : "held steady"},
                cash on hand stands at {fmtMoney(cash)}, and net income came in at {fmtMoney(netTotal)} for the period.
              </>
            ) : (
              <>No revenue or expense data has been recorded for {periodLabel} yet — cash on hand stands at {fmtMoney(cash)} as of today.</>
            )}
          </p>
        </div>

        {sections.revenue && (
          <div className="rb-section">
            <h2>Revenue &amp; Expenses</h2>
            <p className="rb-section-sub">{periodLabel}</p>
            {hasPeriodData ? (
              <>
                <div className="rb-stat-row">
                  <span className="rb-big">{fmtMoney(revenueTotal)}</span>
                  <TrendPill current={revenueTotal} prior={revenuePrior} goodDir="up" />
                </div>
                <p className="rb-commentary">
                  Revenue {trendInfo(revenueTotal, revenuePrior).dir === "flat" ? "held steady" : trendInfo(revenueTotal, revenuePrior).dir === "up" ? "grew" : "declined"}{" "}
                  {revenuePrior != null ? trendInfo(revenueTotal, revenuePrior).label : "— no prior period of the same length to compare yet"}. Expenses
                  totaled {fmtMoney(expenseTotal)} ({expensePrior != null ? trendInfo(expenseTotal, expensePrior, "down").label : "no prior period on record"}).
                </p>
              </>
            ) : (
              <p className="rb-commentary">No revenue or expense data has been recorded for {periodLabel} yet.</p>
            )}
          </div>
        )}

        {sections.budget && (
          <div className="rb-section">
            <h2>Budget vs. Actual</h2>
            <p className="rb-section-sub">Current month</p>
            <div className="rb-stat-row">
              <span className="rb-big">{fmtMoney(budgetTotal.actual - budgetTotal.budgeted)}</span>
              <span className={"pill " + (budgetTotal.actual > budgetTotal.budgeted ? "bad" : "good")}>
                {budgetTotal.actual > budgetTotal.budgeted ? "Over budget overall" : "Under budget overall"}
              </span>
            </div>
            {overBudget.length > 0 ? (
              <>
                <p className="rb-commentary">
                  {overBudget.length} categor{overBudget.length !== 1 ? "ies are" : "y is"} running over budget this month:
                </p>
                <ReportBarRows
                  items={overBudget.map((b) => ({ label: b.category, amount: b.actual - b.budgeted, tone: "over" }))}
                />
              </>
            ) : (
              <p className="rb-commentary">Every category is within budget this month.</p>
            )}
          </div>
        )}

        {sections.cash && (
          <div className="rb-section">
            <h2>Cash Position</h2>
            <p className="rb-section-sub">Company-wide &middot; as of today</p>
            <div className="rb-stat-row">
              <span className="rb-big">{fmtMoney(cash)}</span>
              <span className="pill neutral">{client.bankAccounts.length} account{client.bankAccounts.length !== 1 ? "s" : ""}</span>
            </div>
            <p className="rb-commentary">Cash is managed company-wide and isn't attributed to individual funds or departments.</p>
          </div>
        )}

        {sections.receivables && (
          <div className="rb-section">
            <h2>Cash Flow</h2>
            <p className="rb-section-sub">Open balances</p>
            <div className="content-grid">
              <div>
                <div className="rb-stat-row">
                  <span className="rb-big">{fmtMoney(totalReceivable)}</span>
                </div>
                <p className="rb-commentary" style={{ marginTop: -6 }}>
                  Receivable
                </p>
                <div className="tx-list">
                  {client.receivables.slice(0, 4).map((r, i) => (
                    <div className="tx-row" key={i}>
                      <div>
                        <div className="tx-desc">{r.description}</div>
                        <div className="tx-meta">Due {fmtDate(r.dueDate)}</div>
                      </div>
                      <div className="tx-amount positive">{fmtMoney(r.amount, { cents: true })}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="rb-stat-row">
                  <span className="rb-big">{fmtMoney(totalPayable)}</span>
                </div>
                <p className="rb-commentary" style={{ marginTop: -6 }}>
                  Payable
                </p>
                <div className="tx-list">
                  {client.payables.slice(0, 4).map((p, i) => (
                    <div className="tx-row" key={i}>
                      <div>
                        <div className="tx-desc">{p.vendor}</div>
                        <div className="tx-meta">Due {fmtDate(p.dueDate)}</div>
                      </div>
                      <div className="tx-amount negative">-{fmtMoney(p.amount, { cents: true })}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {sections.giving && (hasFunds || contributions.length > 0) && (
          <div className="rb-section">
            <h2>Giving &amp; Funds</h2>
            <p className="rb-section-sub">{scope === "by-fund" ? "By fund" : "Company-wide"}</p>
            <div className="rb-stat-row">
              <span className="rb-big">{fmtMoney(totalGiving)}</span>
              <span className="pill neutral">{contributions.length} gift{contributions.length !== 1 ? "s" : ""} on record</span>
            </div>
            {scope === "by-fund" && hasFunds ? (
              <>
                <p className="rb-commentary">Fund balances, unrestricted and restricted:</p>
                <ReportBarRows items={funds.map((f) => ({ label: f.name, amount: f.balance }))} />
              </>
            ) : (
              <p className="rb-commentary">
                Unrestricted funds total {fmtMoney(unrestrictedTotal)}; restricted funds total {fmtMoney(restrictedTotal)}. Switch scope to
                "By fund" for the breakdown.
              </p>
            )}
          </div>
        )}

        {sections.outlook && (
          <div className="rb-section">
            <h2>Outlook</h2>
            <p className="rb-section-sub">Months of operating reserve</p>
            <div className="rb-runway-row">
              <RunwayRing pct={runwayMonths == null ? 1 : Math.max(0.08, Math.min(runwayMonths / 6, 1))} tone={runwayMonths != null && runwayMonths < 3 ? "negative" : "positive"}>
                <div className="runway-ring-value">{runwayMonths == null ? "—" : `${runwayMonths.toFixed(1)} mo`}</div>
                <div className={"runway-ring-status " + (runwayMonths != null && runwayMonths < 3 ? "negative" : "positive")}>
                  {runwayMonths != null && runwayMonths < 3 ? "Monitor" : "Healthy"}
                </div>
              </RunwayRing>
              <p className="rb-commentary" style={{ flex: 1, minWidth: 220 }}>
                {runwayMonths == null
                  ? "Not enough expense history to calculate an operating reserve."
                  : `At average operating expenses of ${fmtMoney(monthlyExpenses)}/mo, cash on hand covers approximately ${runwayMonths.toFixed(1)} months. Six months is a common target for an operating reserve.`}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Budgeting Tool (client-editable draft budget, separate from the
// bookkeeper-maintained Budget vs. Actual report)
// ----------------------------------------------------------------------------

function BudgetingToolPage({ client }) {
  const [rows, setRows] = useState(() =>
    client.budget.map((b) => ({ category: b.category, actual: b.actual, current: b.budgeted, proposed: b.budgeted }))
  );
  const [newCategory, setNewCategory] = useState("");
  const showToast = useToast();

  const updateProposed = (index, value) => {
    const num = parseFloat(value);
    setRows((r) => r.map((row, i) => (i === index ? { ...row, proposed: isNaN(num) ? 0 : num } : row)));
  };

  const removeRow = (index) => {
    setRows((r) => r.filter((_, i) => i !== index));
  };

  const addRow = () => {
    if (!newCategory.trim()) return;
    setRows((r) => [...r, { category: newCategory.trim(), actual: 0, current: 0, proposed: 0 }]);
    setNewCategory("");
  };

  const totalCurrent = rows.reduce((s, r) => s + r.current, 0);
  const totalProposed = rows.reduce((s, r) => s + r.proposed, 0);
  const pctChange = totalCurrent > 0 ? ((totalProposed - totalCurrent) / totalCurrent) * 100 : 0;

  const { flashCardId, jumpToCard } = useCardFlash();
  const jumpToDraft = () => jumpToCard("budgeting-tool-draft-card", "draft");

  return (
    <div>
      <MockBanner text="This is a working draft space — nothing here is saved anywhere real yet, and submitting doesn't notify anyone." />

      <div className="kpi-grid">
        <button className="card kpi-card kpi-card-clickable" onClick={jumpToDraft}>
          <span className="kpi-label">Current Budget Total</span>
          <span className="kpi-value">{fmtMoney(totalCurrent)}</span>
        </button>
        <button className="card kpi-card kpi-card-clickable" onClick={jumpToDraft}>
          <span className="kpi-label">Proposed Budget Total</span>
          <span className="kpi-value">{fmtMoney(totalProposed)}</span>
        </button>
        <button className="card kpi-card kpi-card-clickable" onClick={jumpToDraft}>
          <span className="kpi-label">Change</span>
          <span className="kpi-value">
            {(pctChange >= 0 ? "+" : "") + pctChange.toFixed(1)}%
          </span>
          <span className="kpi-sub neutral">vs. current budget</span>
        </button>
      </div>

      <div
        className={"card " + (flashCardId === "draft" ? "card-flash" : "")}
        id="budgeting-tool-draft-card"
        style={{ marginBottom: 20 }}
      >
        <h3 className="card-title premium-shimmer">Draft Budget by Category</h3>
        <p className="card-subtitle">Adjust proposed amounts for next period. This year's actual is shown for reference.</p>
        <div className="table-scroll">
<table className="tx-table tx-table-labeled">
          <thead>
            <tr>
              <th>Category</th>
              <th className="num">This Year's Actual</th>
              <th className="num">Current Budget</th>
              <th className="num">Proposed Budget</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              // Same bullet-bar treatment as standard Budget vs. Actual's
              // Spending by Category: track spans whichever of current
              // budget/actual is bigger, fill is the real dollar amount, tick
              // marks the current budget line — against actual, not the
              // proposed number being drafted in this row.
              const scaleMax = Math.max(r.current, r.actual, 1) * 1.08;
              const fillPct = Math.min((r.actual / scaleMax) * 100, 100);
              const tickPct = Math.min((r.current / scaleMax) * 100, 100);
              const over = r.actual > r.current;
              return (
              <tr key={i}>
                <td data-primary="">
                  <div className="category-name">{r.category}</div>
                  <div className="bullet-track">
                    <div
                      className={"bullet-fill " + (over ? "over" : "under")}
                      style={{ width: `${fillPct}%`, animationDuration: `${growDuration(fillPct)}ms` }}
                    ></div>
                    <div className="bullet-target" style={{ left: `${tickPct}%` }}></div>
                  </div>
                </td>
                <td className="num" data-label="This year's actual">{fmtMoney(r.actual)}</td>
                <td className="num" data-label="Current budget">{fmtMoney(r.current)}</td>
                <td className="num" data-label="Proposed budget">
                  <input
                    type="number"
                    className="budget-input"
                    value={r.proposed}
                    onChange={(e) => updateProposed(i, e.target.value)}
                  />
                </td>
                <td className="row-remove-cell">
                  <button className="row-remove-btn" onClick={() => removeRow(i)} aria-label={`Remove ${r.category}`}>
                    ×
                  </button>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
        </div>

        <div className="add-category-row">
          <input
            type="text"
            placeholder="New category name…"
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addRow();
            }}
          />
          <button className="btn-secondary" onClick={addRow}>
            + Add Category
          </button>
        </div>

        <div className="budget-tool-footer">
          <span className="card-subtitle" style={{ margin: 0 }}>
            Total Proposed: {fmtMoney(totalProposed)}
          </span>
          <button
            className="btn-primary"
            onClick={() => {
              const filename = buildDraftBudgetPdf(client, rows);
              showToast(`Downloaded "${filename}"`);
            }}
          >
            Download PDF
          </button>
        </div>
      </div>

      {/* Budget vs. Actual (the standard page this one replaces for a
          premium client) has a Spending Trend toggle — the same
          multi-month income/expense chart the Dashboard uses. Shown here as
          a plain reference card rather than a toggle, since the draft table
          above is this page's whole reason to exist and shouldn't be
          hideable behind one — but the chart itself needs to stay reachable
          so this page is still a strict superset of Budget vs. Actual. */}
      <div className="card">
        <h3 className="card-title">Spending Trend</h3>
        <p className="card-subtitle">Income vs. expenses, last {client.monthly.length} months — for reference while drafting</p>
        <IncomeExpenseChart monthly={client.monthly} budgetTotal={totalCurrent} />
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Cash Flow Pro — a bookkeeper-grade view of the same payables shown
// under Cash Flow: status filters, an aging summary, and a
// next-due list. Same client.payables array, not a second data set — see
// [[project-mock-data-inconsistencies]] on why nothing here should sum
// bankAccounts[].transactions instead.
// ----------------------------------------------------------------------------

const AP_SOON_DAYS = 7;

const AP_STATUS_META = {
  overdue: { label: "Overdue", pill: "bad" },
  soon: { label: "Due soon", pill: "warm" },
  scheduled: { label: "Scheduled", pill: "neutral" },
};

const AP_STATUS_FILTERS = [
  { key: "all", label: "All" },
  { key: "overdue", label: "Overdue" },
  { key: "soon", label: "Due soon" },
  { key: "scheduled", label: "Scheduled" },
];

function apDueText(diff) {
  if (diff < 0) return `${Math.abs(diff)}d overdue`;
  if (diff === 0) return "Due today";
  return `in ${diff}d`;
}

function APCommandCenterPage({ client }) {
  const [statusFilter, setStatusFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(() => new Set());
  const [payRun, setPayRun] = useState(null); // { ids, total, status: "awaiting_approval" | "approved" }
  const today = todayLocal();
  const showToast = useToast();
  const { flashCardId, jumpToCard } = useCardFlash();
  const jumpToBills = (status) => {
    setStatusFilter(status);
    jumpToCard("ap-cc-open-bills-card", "open-bills");
  };

  const rows = useMemo(() => {
    return client.payables.map((p, i) => {
      const diff = daysUntil(p.dueDate, today);
      const status = diff < 0 ? "overdue" : diff <= AP_SOON_DAYS ? "soon" : "scheduled";
      return { ...p, diff, status, rowId: p.id != null ? p.id : i };
    });
  }, [client.payables, today]);

  // Same vendor + same amount showing up more than once usually means a bill
  // was entered twice, not that the vendor billed the same amount by chance.
  const duplicateRowIds = useMemo(() => {
    const seen = new Map();
    rows.forEach((r) => {
      const key = r.vendor + "|" + r.amount;
      seen.set(key, (seen.get(key) || []).concat(r.rowId));
    });
    const flagged = new Set();
    seen.forEach((ids) => {
      if (ids.length > 1) ids.forEach((id) => flagged.add(id));
    });
    return flagged;
  }, [rows]);

  const vendorSummary = useMemo(() => {
    const byVendor = new Map();
    rows.forEach((r) => {
      const v = byVendor.get(r.vendor) || { vendor: r.vendor, total: 0, count: 0, overdue: 0 };
      v.total += r.amount;
      v.count += 1;
      if (r.status === "overdue") v.overdue += 1;
      byVendor.set(r.vendor, v);
    });
    return [...byVendor.values()].sort((a, b) => b.total - a.total);
  }, [rows]);

  const byStatus = (key) => rows.filter((r) => key === "all" || r.status === key);

  const totals = useMemo(() => {
    const sum = (list) => list.reduce((s, r) => s + r.amount, 0);
    return Object.fromEntries(
      ["all", "overdue", "soon", "scheduled"].map((key) => {
        const list = byStatus(key);
        return [key, { amount: sum(list), count: list.length }];
      })
    );
  }, [rows]);

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return byStatus(statusFilter)
      .filter((r) => !q || r.vendor.toLowerCase().includes(q) || r.description.toLowerCase().includes(q))
      .sort((a, b) => a.diff - b.diff);
  }, [rows, statusFilter, query]);

  const agingBuckets = useMemo(() => {
    const buckets = [
      { key: "current", label: "Current", test: (d) => d >= 0, color: "var(--good)" },
      { key: "d1_7", label: "1–7 days over", test: (d) => d < 0 && d >= -7, color: "var(--warm-text)" },
      { key: "d8_30", label: "8–30 days over", test: (d) => d < -7 && d >= -30, color: "var(--bad)" },
      { key: "d30plus", label: "30+ days over", test: (d) => d < -30, color: "var(--bad)" },
    ];
    return buckets.map((b) => ({ ...b, amount: rows.filter((r) => b.test(r.diff)).reduce((s, r) => s + r.amount, 0) }));
  }, [rows]);
  const maxBucket = Math.max(...agingBuckets.map((b) => b.amount), 1);

  const nextDue = useMemo(() => [...rows].sort((a, b) => a.diff - b.diff).slice(0, 5), [rows]);
  const shownTotal = filteredRows.reduce((s, r) => s + r.amount, 0);

  const toggleRow = (rowId) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  };
  const allShownSelected = filteredRows.length > 0 && filteredRows.every((r) => selected.has(r.rowId));
  const toggleAllShown = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allShownSelected) filteredRows.forEach((r) => next.delete(r.rowId));
      else filteredRows.forEach((r) => next.add(r.rowId));
      return next;
    });
  };

  const selectedRows = rows.filter((r) => selected.has(r.rowId));
  const selectedTotal = selectedRows.reduce((s, r) => s + r.amount, 0);
  const cashOnHand = totalCash(client);
  const cashAfterPayRun = cashOnHand - selectedTotal;

  const startPayRun = () => {
    if (selectedRows.length === 0) return;
    setPayRun({ ids: [...selected], total: selectedTotal, status: "awaiting_approval" });
    showToast(
      `Pay run of ${selectedRows.length} bill${selectedRows.length !== 1 ? "s" : ""} (${fmtMoney(selectedTotal, {
        cents: true,
      })}) sent for approval.`
    );
  };
  const approvePayRun = () => {
    setPayRun((prev) => (prev ? { ...prev, status: "approved" } : prev));
    showToast("Pay run approved — ready to send to the bank.");
  };
  const cancelPayRun = () => {
    setPayRun(null);
    setSelected(new Set());
  };

  const exportPayRunCsv = () => {
    const list = payRun ? rows.filter((r) => payRun.ids.includes(r.rowId)) : selectedRows;
    if (list.length === 0) return;
    const csvRows = [
      ["Vendor", "Description", "Amount", "Due Date"],
      ...list.map((r) => [r.vendor, r.description, r.amount.toFixed(2), r.dueDate]),
    ];
    const csv = csvRows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${client.name.replace(/\s+/g, "_")}_ACH_batch.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`Exported ${list.length} bill${list.length !== 1 ? "s" : ""} for bank upload.`);
  };

  return (
    <div>
      <MockBanner text="These are the same sample payables shown under Cash Flow. Connect QuickBooks to replace this with live AP data." />

      <div className="kpi-grid">
        <button className="card kpi-card kpi-card-clickable" onClick={() => jumpToBills("all")}>
          <span className="kpi-label">Total Payable</span>
          <span className="kpi-value">{fmtMoney(totals.all.amount)}</span>
          <span className="kpi-sub neutral">
            {totals.all.count} open bill{totals.all.count !== 1 ? "s" : ""}
          </span>
        </button>
        <button className="card kpi-card kpi-card-clickable" onClick={() => jumpToBills("overdue")}>
          <span className="kpi-label">Overdue</span>
          <span className="kpi-value negative">{fmtMoney(totals.overdue.amount)}</span>
          <span className="kpi-sub negative">
            {totals.overdue.count} bill{totals.overdue.count !== 1 ? "s" : ""} past due
          </span>
        </button>
        <button className="card kpi-card kpi-card-clickable" onClick={() => jumpToBills("soon")}>
          <span className="kpi-label">Due Within {AP_SOON_DAYS} Days</span>
          <span className="kpi-value warm">{fmtMoney(totals.soon.amount)}</span>
          <span className="kpi-sub warm">
            {totals.soon.count} bill{totals.soon.count !== 1 ? "s" : ""}
          </span>
        </button>
        <button className="card kpi-card kpi-card-clickable" onClick={() => jumpToBills("scheduled")}>
          <span className="kpi-label">Scheduled</span>
          <span className="kpi-value">{fmtMoney(totals.scheduled.amount)}</span>
          <span className="kpi-sub neutral">
            {totals.scheduled.count} bill{totals.scheduled.count !== 1 ? "s" : ""}
          </span>
        </button>
      </div>

      <div
        className={"card " + (flashCardId === "open-bills" ? "card-flash " : "")}
        id="ap-cc-open-bills-card"
        style={{ marginBottom: 20 }}
      >
        <div className="ap-cc-toolbar">
          <div>
            <h3 className="card-title premium-shimmer">Open Bills</h3>
            <p className="card-subtitle">Every payable on file for {client.name}</p>
          </div>
          <div className="ap-cc-filters">
            <input
              className="ap-cc-search"
              type="text"
              placeholder="Search vendor or memo"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="rb-segmented ap-cc-segmented">
              {AP_STATUS_FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  aria-pressed={statusFilter === f.key}
                  onClick={() => setStatusFilter(f.key)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="table-scroll">
          <table className="tx-table tx-table-labeled">
            <thead>
              <tr>
                <th style={{ width: 28 }}>
                  <input
                    type="checkbox"
                    checked={allShownSelected}
                    onChange={toggleAllShown}
                    aria-label="Select all shown bills"
                  />
                </th>
                <th>Vendor</th>
                <th>Status</th>
                <th className="num">Amount</th>
                <th>Due</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((r) => {
                const meta = AP_STATUS_META[r.status];
                return (
                  <tr key={r.rowId}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(r.rowId)}
                        onChange={() => toggleRow(r.rowId)}
                        aria-label={`Select ${r.vendor} bill`}
                      />
                    </td>
                    <td data-primary="">
                      {r.vendor}
                      <div className="tx-meta">
                        {r.description}
                        {duplicateRowIds.has(r.rowId) && (
                          <span className="pill warm" style={{ marginLeft: 6 }}>
                            Possible duplicate
                          </span>
                        )}
                      </div>
                    </td>
                    <td data-label="Status">
                      <span className={"pill " + meta.pill}>{meta.label}</span>
                    </td>
                    <td className="num tx-amount negative" data-label="Amount">
                      -{fmtMoney(r.amount, { cents: true })}
                    </td>
                    <td data-label="Due">
                      {fmtDate(r.dueDate)}
                      <div className={"ap-cc-due-days" + (r.diff < 0 ? " overdue" : "")}>{apDueText(r.diff)}</div>
                    </td>
                  </tr>
                );
              })}
              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan={5} className="ap-cc-empty">
                    No bills match this filter.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>Total shown</td>
                <td className="num tx-amount negative">-{fmtMoney(shownTotal, { cents: true })}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {(selected.size > 0 || payRun) && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3 className="card-title premium-shimmer">Pay Run</h3>
          <p className="card-subtitle">
            {payRun
              ? `${payRun.ids.length} bill${payRun.ids.length !== 1 ? "s" : ""} · ${fmtMoney(payRun.total, {
                  cents: true,
                })}`
              : `${selectedRows.length} bill${selectedRows.length !== 1 ? "s" : ""} selected · ${fmtMoney(
                  selectedTotal,
                  { cents: true }
                )}`}
          </p>

          <div className="ap-cc-payrun-impact">
            <div>
              <span className="ap-cc-age-label">Cash on hand today</span>
              <div className="kpi-value" style={{ fontSize: 20 }}>{fmtMoney(cashOnHand, { cents: true })}</div>
            </div>
            <div>
              <span className="ap-cc-age-label">Balance after this pay run</span>
              <div className={"kpi-value " + (cashAfterPayRun < 0 ? "negative" : "")} style={{ fontSize: 20 }}>
                {fmtMoney(cashAfterPayRun, { cents: true })}
              </div>
            </div>
          </div>

          {payRun && (
            <div className="ap-cc-approval-row">
              <span className={"pill " + (payRun.status === "approved" ? "good" : "warm")}>
                {payRun.status === "approved" ? "Approved" : "Awaiting Treasurer approval"}
              </span>
            </div>
          )}

          <div className="ap-cc-payrun-actions">
            {!payRun && (
              <button className="btn-primary" onClick={startPayRun} disabled={selectedRows.length === 0}>
                Send for Approval
              </button>
            )}
            {payRun && payRun.status === "awaiting_approval" && (
              <button className="btn-primary" onClick={approvePayRun}>
                Approve Pay Run
              </button>
            )}
            <button className="btn-secondary" onClick={exportPayRunCsv} disabled={selectedRows.length === 0 && !payRun}>
              Export ACH Batch (CSV)
            </button>
            {payRun && (
              <button className="btn-secondary" onClick={cancelPayRun}>
                Clear Pay Run
              </button>
            )}
          </div>
        </div>
      )}

      <div className="content-masonry">
        <div className="card">
          <h3 className="card-title premium-shimmer">Vendor Summary</h3>
          <p className="card-subtitle">Open balance by vendor</p>
          <div className="ap-cc-upcoming">
            {vendorSummary.slice(0, 6).map((v) => (
              <div className="ap-cc-upcoming-item" key={v.vendor}>
                <div>
                  <div className="ap-cc-upcoming-who">{v.vendor}</div>
                  <div className="ap-cc-upcoming-when">
                    {v.count} bill{v.count !== 1 ? "s" : ""}
                    {v.overdue > 0 ? ` · ${v.overdue} overdue` : ""}
                  </div>
                </div>
                <span className="ap-cc-upcoming-amt">{fmtMoney(v.total, { cents: true })}</span>
              </div>
            ))}
            {vendorSummary.length === 0 && <p className="card-subtitle">No open bills.</p>}
          </div>
        </div>

        <div className="card">
          <h3 className="card-title premium-shimmer">Aging Summary</h3>
          <p className="card-subtitle">Payables by how overdue they are</p>
          <div className="ap-cc-aging">
            {agingBuckets.map((b) => (
              <div className="ap-cc-age-row" key={b.key}>
                <span className="ap-cc-age-label">{b.label}</span>
                <span className="ap-cc-age-track">
                  <span className="ap-cc-age-fill" style={{ width: `${(b.amount / maxBucket) * 100}%`, background: b.color }} />
                </span>
                <span className="ap-cc-age-amt">{fmtMoney(b.amount)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <h3 className="card-title">Next 5 Due</h3>
          <p className="card-subtitle">Coming up soonest</p>
          <div className="ap-cc-upcoming">
            {nextDue.map((r, i) => (
              <div className="ap-cc-upcoming-item" key={i}>
                <div>
                  <div className="ap-cc-upcoming-who">{r.vendor}</div>
                  <div className="ap-cc-upcoming-when">{apDueText(r.diff)}</div>
                </div>
                <span className="ap-cc-upcoming-amt">{fmtMoney(r.amount, { cents: true })}</span>
              </div>
            ))}
            {nextDue.length === 0 && <p className="card-subtitle">No open bills.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Staff Access (admin only) — manage who can sign in to the portal at all.
// Reads/writes the real `staff` table in Supabase directly (not mock data).
// Authorization is enforced by Postgres RLS (see
// supabase/staff-admin-policies.sql), not by this component: a non-admin who
// somehow rendered this page would still have every request rejected by the
// database, since only an active admin's own row satisfies the write policy.
// ----------------------------------------------------------------------------

const STAFF_ROLES = ["bookkeeper", "admin"];

const STAFF_AUDIT_VERBS = {
  added: "added",
  removed: "removed",
  role_changed: "changed the role of",
  activated: "reactivated",
  deactivated: "deactivated",
};

function staffAuditVerb(action) {
  return STAFF_AUDIT_VERBS[action] || action;
}

// Shared invite copy for both send paths below. There's no backend to send
// real email from yet (Phase 3), so both are the honest version of "real"
// available right now: an actual email the admin reviews and hits send on,
// rather than a simulated toast that claims to have sent something it didn't.
function inviteCopyFor(row) {
  const firstName = firstNameOf(row.name);
  const subject = "You're set up on the MyGoodBooks client portal";
  const body =
    `Hi ${firstName},\n\n` +
    `You've been added to the MyGoodBooks client portal as a ${row.role}. ` +
    `Sign in at https://app.mygoodbooks.org with your Google Workspace account (${row.email}) — ` +
    `click "Sign in with Google" and you're in, nothing else to set up.\n\n` +
    `Questions, just reply here.`;
  return { subject, body };
}

// mailto: hands off to whatever the browser/OS has set as the DEFAULT mail
// handler — Apple Mail on a Mac unless that's been changed, regardless of
// which mail app someone actually uses day to day. There's no way for a
// mailto: link itself to specify Gmail; buildInviteGmailUrl below is the
// separate, Gmail-specific path for staff who'd rather it open there.
function buildInviteMailto(row) {
  const { subject, body } = inviteCopyFor(row);
  return `mailto:${row.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// Gmail's own compose-in-browser URL — opens gmail.com's compose window
// (in whichever Google account is signed in) directly, sidestepping the OS
// mail-handler question entirely. Works for anyone signed into Gmail in
// their browser, which every mygoodbooks.org staffer already is.
function buildInviteGmailUrl(row) {
  const { subject, body } = inviteCopyFor(row);
  const params = new URLSearchParams({ view: "cm", fs: "1", to: row.email, su: subject, body });
  return `https://mail.google.com/mail/?${params.toString()}`;
}

// Parses pasted CSV for bulk staff import: email,name,role per line, with an
// optional header row (detected by its first field not being an email) and
// blank lines skipped. Deliberately tiny — no quoted-field/embedded-comma
// support — since this is for pasting out of a simple roster spreadsheet,
// not accepting arbitrary CSV exports.
function parseStaffCsv(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const rows = [];
  lines.forEach((line, i) => {
    const [rawEmail, rawName, rawRole] = line.split(",").map((f) => (f || "").trim());
    if (i === 0 && rawEmail && !rawEmail.includes("@")) return; // header row
    const email = (rawEmail || "").toLowerCase();
    const name = rawName || "";
    const role = STAFF_ROLES.includes((rawRole || "").toLowerCase()) ? rawRole.toLowerCase() : "bookkeeper";
    const errors = [];
    if (!email || !email.includes("@")) errors.push("missing/invalid email");
    else if (!email.endsWith("@mygoodbooks.org")) errors.push("must be a mygoodbooks.org address");
    if (!name) errors.push("missing name");
    rows.push({ line, email, name, role, errors });
  });
  return rows;
}

// Cleared by Developer Tools' "Reset local state" button. Everything this
// matches is a per-browser viewer preference (theme, tab layout, dashboard/
// Live Report widget layouts, cash-floor alerts, per-client-user access
// overrides, ...), never anything from Supabase, so clearing it can't lose
// real data — only whatever local customization got the browser stuck.
//
// Previously an explicit list of keys, which meant every new feature that
// added its own localStorage key (the cash-floor alert, Live Report's own
// widget layout, ...) had to remember to also add itself here — easy to
// forget, and forgetting it silently makes "reset local state" a lie for
// that one feature. Matching everything under the shared "mygoodbooks_"
// prefix closes that gap for whatever gets added next, without needing to
// touch this function again. Feature flags (mygoodbooks_ff_*) are
// deliberately excluded — they're their own toggles right next to this
// button, not "local state" in the sense this reset is for.
function resettableLocalStorageKeys() {
  try {
    return Object.keys(localStorage).filter((k) => k.startsWith("mygoodbooks_") && !k.startsWith("mygoodbooks_ff_"));
  } catch (e) {
    return [];
  }
}

function StaffAccessPage({ staffUser, onImpersonate }) {
  const showToast = useToast();
  const supabase = window.mgbSupabase;

  const [rows, setRows] = useState(null); // null while loading
  const [loadError, setLoadError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState("bookkeeper");
  const [adding, setAdding] = useState(false);
  const [clientAccessFor, setClientAccessFor] = useState(null); // the staff row being edited, or null
  const [clientAccessSet, setClientAccessSet] = useState(new Set());
  const [clientAccessLoading, setClientAccessLoading] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvResults, setCsvResults] = useState(null); // per-row outcome after an import run

  const csvPreview = useMemo(() => (csvText.trim() ? parseStaffCsv(csvText) : []), [csvText]);
  const csvValidCount = csvPreview.filter((r) => r.errors.length === 0).length;

  function openClientAccess(row) {
    setClientAccessFor(row);
    setClientAccessLoading(true);
    supabase
      .from("staff_client_access")
      .select("client_id")
      .eq("staff_email", row.email)
      .then(({ data, error }) => {
        setClientAccessLoading(false);
        if (error) {
          showToast(`Couldn't load ${row.name}'s client access: ${error.message}`);
          setClientAccessFor(null);
          return;
        }
        setClientAccessSet(new Set(data.map((r) => r.client_id)));
      });
  }

  async function toggleClientAccess(clientId) {
    const wasChecked = clientAccessSet.has(clientId);
    const { error } = wasChecked
      ? await supabase.from("staff_client_access").delete().eq("staff_email", clientAccessFor.email).eq("client_id", clientId)
      : await supabase.from("staff_client_access").insert({ staff_email: clientAccessFor.email, client_id: clientId });
    if (error) {
      showToast(`Couldn't update client access: ${error.message}`);
      return;
    }
    setClientAccessSet((prev) => {
      const next = new Set(prev);
      if (wasChecked) next.delete(clientId);
      else next.add(clientId);
      return next;
    });
  }

  const load = useCallback(() => {
    if (!supabase) {
      setLoadError("Supabase isn't configured — see auth-config.js.");
      setRows([]);
      return;
    }
    supabase
      .from("staff")
      .select("id, email, name, role, active, created_at")
      .order("created_at", { ascending: true })
      .then(({ data, error }) => {
        if (error) {
          // Most likely cause: supabase/staff-admin-policies.sql hasn't been
          // run yet, so only your own row is readable, not the full roster.
          setLoadError("Couldn't load the staff list. " + error.message);
          setRows([]);
        } else {
          setLoadError("");
          setRows(data);
        }
      });
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  async function addStaff() {
    const email = newEmail.trim().toLowerCase();
    const name = newName.trim();
    if (!email || !name) return;
    if (!email.endsWith("@mygoodbooks.org")) {
      showToast("Staff email must be a mygoodbooks.org address — Google sign-in will reject anything else.");
      return;
    }
    setAdding(true);
    const { error } = await supabase.from("staff").insert({ email, name, role: newRole, active: true });
    setAdding(false);
    if (error) {
      showToast(`Couldn't add ${email}: ${error.message}`);
      return;
    }
    setNewEmail("");
    setNewName("");
    setNewRole("bookkeeper");
    showToast(`Added ${name} to the staff list.`);
    load();
  }

  async function importCsv() {
    const validRows = csvPreview.filter((r) => r.errors.length === 0);
    if (validRows.length === 0) return;
    setCsvImporting(true);
    // One insert per row, not a single batch insert, so one bad row (a typo'd
    // duplicate email, most likely) doesn't fail the whole import — matches
    // how addStaff() already reports failures per person.
    const results = [];
    for (const r of validRows) {
      const { error } = await supabase.from("staff").insert({ email: r.email, name: r.name, role: r.role, active: true });
      results.push({ email: r.email, name: r.name, ok: !error, message: error ? error.message : "" });
    }
    setCsvImporting(false);
    setCsvResults(results);
    const okCount = results.filter((r) => r.ok).length;
    showToast(
      okCount === results.length
        ? `Imported ${okCount} staff.`
        : `Imported ${okCount} of ${results.length} — see the results below for what failed.`
    );
    if (okCount === results.length) setCsvText("");
    load();
  }

  async function updateRow(row, patch) {
    setBusyId(row.id);
    const { error } = await supabase.from("staff").update(patch).eq("id", row.id);
    setBusyId(null);
    if (error) {
      showToast(`Couldn't update ${row.email}: ${error.message}`);
      return;
    }
    load();
  }

  async function removeRow(row) {
    if (!window.confirm(`Remove ${row.name} (${row.email})? They'll lose portal access immediately.`)) return;
    setBusyId(row.id);
    const { error } = await supabase.from("staff").delete().eq("id", row.id);
    setBusyId(null);
    if (error) {
      showToast(`Couldn't remove ${row.email}: ${error.message}`);
      return;
    }
    showToast(`Removed ${row.name}.`);
    load();
  }

  return (
    <div>
      <div className="mock-banner">
        <WarningIcon /> This page writes directly to the real staff table in Supabase — unlike the rest of the app,
        nothing here is sample data.
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 className="card-title">Add staff</h3>
        <p className="card-subtitle">
          They'll sign in with Google using this exact address — add them here first, or Google will let them in and
          this app will turn them away.
        </p>
        <div className="staff-add-row">
          <input
            type="email"
            placeholder="name@mygoodbooks.org"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
          />
          <input type="text" placeholder="Full name" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <select value={newRole} onChange={(e) => setNewRole(e.target.value)}>
            {STAFF_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <button className="btn-primary" disabled={adding || !newEmail.trim() || !newName.trim()} onClick={addStaff}>
            + Add
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 className="card-title">Bulk import</h3>
        <p className="card-subtitle">
          Paste rows as <code>email, name, role</code> (role optional, defaults to bookkeeper) — one person per line,
          straight out of a spreadsheet. A header row is fine, it's detected and skipped.
        </p>
        <textarea
          className="staff-csv-textarea"
          rows={4}
          placeholder={"jane@mygoodbooks.org, Jane Alvarez, bookkeeper\nmark@mygoodbooks.org, Mark Chen, admin"}
          value={csvText}
          onChange={(e) => {
            setCsvText(e.target.value);
            setCsvResults(null);
          }}
        />
        {csvPreview.length > 0 && (
          <React.Fragment>
            <ul className="staff-csv-preview">
              {csvPreview.map((r, i) => (
                <li key={i} className={r.errors.length ? "negative" : "positive"}>
                  {r.errors.length ? (
                    <React.Fragment>
                      <strong>{r.line}</strong> — {r.errors.join(", ")}
                    </React.Fragment>
                  ) : (
                    <React.Fragment>
                      {r.name} ({r.email}) · {r.role}
                    </React.Fragment>
                  )}
                </li>
              ))}
            </ul>
            <div className="staff-reset-row">
              <button className="btn-primary" disabled={csvImporting || csvValidCount === 0} onClick={importCsv}>
                {csvImporting ? "Importing…" : `Import ${csvValidCount} staff`}
              </button>
              {csvValidCount < csvPreview.length && (
                <p className="card-subtitle" style={{ margin: 0 }}>
                  {csvPreview.length - csvValidCount} row(s) above have errors and will be skipped.
                </p>
              )}
            </div>
          </React.Fragment>
        )}
        {csvResults && (
          <ul className="staff-csv-preview" style={{ marginTop: 12 }}>
            {csvResults.map((r, i) => (
              <li key={i} className={r.ok ? "positive" : "negative"}>
                {r.ok ? `Added ${r.name}` : `${r.name || r.email} — ${r.message}`}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 className="card-title">Staff roster</h3>
        <p className="card-subtitle">Who can sign in to the portal, and with what role. You can't change your own row.</p>

        {rows === null && !loadError && <p className="card-subtitle">Loading…</p>}
        {loadError && <p className="card-subtitle negative">{loadError}</p>}

        {rows && rows.length > 0 && (
          <div className="table-scroll">
            <table className="tx-table tx-table-labeled">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Active</th>
                  <th>Clients</th>
                  <th></th>
                  <th></th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const isSelf = row.email === staffUser.email;
                  const busy = busyId === row.id;
                  return (
                    <tr key={row.id}>
                      <td data-primary="">{row.name}</td>
                      <td data-label="Email">{row.email}</td>
                      <td data-label="Role">
                        <select
                          value={row.role}
                          disabled={isSelf || busy}
                          onChange={(e) => updateRow(row, { role: e.target.value })}
                        >
                          {STAFF_ROLES.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td data-label="Active">
                        <label className="staff-active-toggle">
                          <input
                            type="checkbox"
                            checked={row.active}
                            disabled={isSelf || busy}
                            onChange={(e) => updateRow(row, { active: e.target.checked })}
                          />
                          <span>{row.active ? "Active" : "Deactivated"}</span>
                        </label>
                      </td>
                      <td data-label="Clients">
                        {row.role === "admin" ? (
                          <span className="staff-self-note">All (admin)</span>
                        ) : (
                          <button className="btn-secondary staff-clients-btn" onClick={() => openClientAccess(row)}>
                            Manage
                          </button>
                        )}
                      </td>
                      <td data-label="">
                        {!isSelf && row.role !== "admin" && row.active && (
                          <button className="btn-secondary staff-view-as-btn" onClick={() => onImpersonate(row)}>
                            View as
                          </button>
                        )}
                      </td>
                      <td data-label="">
                        {!isSelf && (
                          <div className="staff-invite-links">
                            <a
                              className="btn-secondary staff-invite-btn"
                              href={buildInviteGmailUrl(row)}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              Email invite
                            </a>
                            <a className="staff-invite-alt" href={buildInviteMailto(row)}>
                              or mail app
                            </a>
                          </div>
                        )}
                      </td>
                      <td className="row-remove-cell">
                        {isSelf ? (
                          <span className="staff-self-note">You</span>
                        ) : (
                          <button
                            className="row-remove-btn"
                            onClick={() => removeRow(row)}
                            disabled={busy}
                            aria-label={`Remove ${row.name}`}
                          >
                            ×
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {rows && rows.length === 0 && !loadError && <p className="card-subtitle">No staff rows yet.</p>}
      </div>

      {clientAccessFor && (
        <ModalShell onClose={() => setClientAccessFor(null)} labelledBy="client-access-title">
          <div className="modal-header">
            <h3 className="card-title" id="client-access-title" style={{ margin: 0 }}>
              {clientAccessFor.name}'s clients
            </h3>
            <button className="modal-close" onClick={() => setClientAccessFor(null)} aria-label="Close">
              ×
            </button>
          </div>
          <p className="card-subtitle">
            Unchecked means they can't see this client at all — not just a restricted view, the client won't appear
            in their switcher.
          </p>
          <div className="modal-body">
            {clientAccessLoading && <p className="card-subtitle">Loading…</p>}
            {!clientAccessLoading &&
              CLIENTS.map((c) => (
                <label className="tab-toggle-row" key={c.id}>
                  <input
                    type="checkbox"
                    checked={clientAccessSet.has(c.id)}
                    onChange={() => toggleClientAccess(c.id)}
                  />
                  <span>{c.name}</span>
                </label>
              ))}
          </div>
          <div className="modal-footer">
            <button className="btn-primary" onClick={() => setClientAccessFor(null)}>
              Done
            </button>
          </div>
        </ModalShell>
      )}
    </div>
  );
}

// Parses pasted CSV for bulk client-contact import: client_id,email,name,role
// per line. Same tiny/no-quoted-fields approach as parseStaffCsv, plus a
// client_id column checked against the real CLIENTS list instead of a fixed
// role enum. client_id has to be the exact slug (e.g. "grace-community"),
// not the display name — there's no fuzzy matching here.
function parseClientUserCsv(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const rows = [];
  lines.forEach((line, i) => {
    const [rawClientId, rawEmail, rawName, rawRole] = line.split(",").map((f) => (f || "").trim());
    if (i === 0 && rawEmail && !rawEmail.includes("@")) return; // header row
    const clientId = rawClientId || "";
    const email = (rawEmail || "").toLowerCase();
    const name = rawName || "";
    const role = rawRole || "";
    const errors = [];
    const client = CLIENTS.find((c) => c.id === clientId);
    if (!clientId || !client) errors.push("unknown client id");
    if (!email || !email.includes("@")) errors.push("missing/invalid email");
    if (!name) errors.push("missing name");
    if (!role) errors.push("missing role");
    rows.push({ line, clientId, clientName: client ? client.name : clientId, email, name, role, errors });
  });
  return rows;
}

// ----------------------------------------------------------------------------
// Developer Tools (admin only) — per-browser QA toggles and local-state
// reset. Split out of Staff Access into its own sidebar page: it has nothing
// to do with who can sign in, and burying browser-only debugging aids in
// the middle of a page that writes to the real staff table made them easy
// to overlook and easy to confuse for something that affects other staff.
// ----------------------------------------------------------------------------

function readAllMygoodbooksStorage() {
  try {
    return Object.keys(localStorage)
      .filter((k) => k.startsWith("mygoodbooks_"))
      .sort()
      .map((key) => ({ key, value: localStorage.getItem(key) }));
  } catch (e) {
    return [];
  }
}

// Pretty-prints a stored value if it's JSON, otherwise shows it as-is — most
// keys here are JSON (layouts, tab config, ...), a few are plain strings
// (theme, page) or bare numbers (a cash-floor threshold).
function formatStorageValue(raw) {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch (e) {
    return raw;
  }
}

function DeveloperToolsPage({ staffUser, onJumpToClient }) {
  const supabase = window.mgbSupabase;
  const [, forceRerender] = useState(0);
  const [clientQuery, setClientQuery] = useState("");
  const [storageEntries, setStorageEntries] = useState(readAllMygoodbooksStorage);
  const [auditRows, setAuditRows] = useState(null);
  const [auditError, setAuditError] = useState("");
  // Only a read-status check, not the roster itself — Staff Access owns the
  // actual roster fetch/CRUD; this just needs to know whether a read against
  // the staff table succeeds, for the System Info card below.
  const [staffReadOk, setStaffReadOk] = useState(null); // null = checking, else boolean
  const [staffReadError, setStaffReadError] = useState("");

  const loadAudit = useCallback(() => {
    if (!supabase) return;
    supabase
      .from("staff_audit_log")
      .select("id, actor_email, action, target_email, detail, created_at")
      .order("created_at", { ascending: false })
      .limit(20)
      .then(({ data, error }) => {
        if (error) {
          setAuditError("Couldn't load recent activity. " + error.message);
          setAuditRows([]);
        } else {
          setAuditError("");
          setAuditRows(data);
        }
      });
  }, [supabase]);

  useEffect(() => {
    loadAudit();
  }, [loadAudit]);

  useEffect(() => {
    if (!supabase) {
      setStaffReadOk(false);
      setStaffReadError("Supabase isn't configured — see auth-config.js.");
      return;
    }
    supabase
      .from("staff")
      .select("id")
      .limit(1)
      .then(({ error }) => {
        setStaffReadOk(!error);
        setStaffReadError(error ? error.message : "");
      });
  }, [supabase]);

  function toggleFlag(key) {
    setFlag(key, !isFlagOn(key));
    forceRerender((v) => v + 1);
  }

  function resetLocalState() {
    if (
      !window.confirm(
        "Reset this browser's local MyGoodBooks state (theme, tab layout, dashboard/Live Report widget layouts, cash-floor alerts, per-person access overrides, ...)? This only affects this browser — nothing in Supabase is touched. The page will reload."
      )
    ) {
      return;
    }
    resettableLocalStorageKeys().forEach((key) => {
      try {
        localStorage.removeItem(key);
      } catch (e) {}
    });
    window.location.reload();
  }

  const matchingClients = clientQuery.trim()
    ? CLIENTS.filter((c) => c.name.toLowerCase().includes(clientQuery.trim().toLowerCase())).slice(0, 8)
    : [];

  return (
    <div>
      <MockBanner text="Per-browser testing aids — nothing here is shared with other staff or written to Supabase." />

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 className="card-title">Jump to client</h3>
        <p className="card-subtitle">Skip the sidebar dropdown — land straight on a client's dashboard.</p>
        <input
          type="text"
          className="ap-cc-search"
          style={{ width: "100%", boxSizing: "border-box" }}
          placeholder="Search clients by name…"
          value={clientQuery}
          onChange={(e) => setClientQuery(e.target.value)}
        />
        {matchingClients.length > 0 && (
          <div className="staff-audit-list" style={{ marginTop: 10 }}>
            {matchingClients.map((c) => (
              <button
                type="button"
                className="staff-due-row"
                key={c.id}
                style={{ width: "100%", textAlign: "left", cursor: "pointer", background: "none", border: "none", font: "inherit" }}
                onClick={() => onJumpToClient && onJumpToClient(c.id)}
              >
                <span className="staff-flag-label">{c.name}</span>
                <span className="staff-flag-desc">{c.plan === "premium" ? "Premium" : "Standard"} · {c.id}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 className="card-title">Feature flags</h3>
        <p className="card-subtitle">Stored in this browser's localStorage only.</p>

        {FEATURE_FLAGS.map((f) => (
          <label className="staff-flag-row" key={f.key}>
            <input type="checkbox" checked={isFlagOn(f.key)} onChange={() => toggleFlag(f.key)} />
            <span>
              <span className="staff-flag-label">{f.label}</span>
              <span className="staff-flag-desc">{f.description}</span>
            </span>
          </label>
        ))}

        <div className="staff-reset-row">
          <button className="btn-secondary" onClick={resetLocalState}>
            Reset local state
          </button>
          <p className="card-subtitle" style={{ margin: 0 }}>
            Clears every saved theme, tab layout, widget layout, and per-person access override
            under this browser's "mygoodbooks_" storage (feature flags excepted — those stay,
            right above), then reloads. Doesn't touch Supabase or any other browser.
          </p>
        </div>
      </div>

      <div className="card">
        <div className="page-header" style={{ marginBottom: 4 }}>
          <div>
            <h3 className="card-title">Raw local storage</h3>
            <p className="card-subtitle" style={{ margin: 0 }}>
              Every "mygoodbooks_" key in this browser, as actually stored — for when a bug report
              says "my layout looks wrong" and you want the real value without opening devtools.
            </p>
          </div>
          <button className="btn-secondary" onClick={() => setStorageEntries(readAllMygoodbooksStorage())}>
            Refresh
          </button>
        </div>
        {storageEntries.length === 0 ? (
          <p className="card-subtitle">No "mygoodbooks_" keys stored in this browser.</p>
        ) : (
          <div className="staff-audit-list">
            {storageEntries.map((e) => (
              <div className="staff-audit-row" key={e.key} style={{ flexDirection: "column", alignItems: "stretch" }}>
                <span className="staff-flag-label">{e.key}</span>
                <pre
                  style={{
                    margin: "4px 0 0",
                    fontSize: 11.5,
                    fontFamily: "IBM Plex Mono, monospace",
                    color: "var(--text-muted)",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {formatStorageValue(e.value)}
                </pre>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 20, marginBottom: 20 }}>
        <h3 className="card-title">Recent activity</h3>
        <p className="card-subtitle">
          Every change to the staff table, logged automatically by Postgres — not just the ones made from Staff Access.
        </p>

        {auditRows === null && !auditError && <p className="card-subtitle">Loading…</p>}
        {auditError && <p className="card-subtitle negative">{auditError}</p>}

        {auditRows && auditRows.length > 0 && (
          <ul className="staff-audit-list">
            {auditRows.map((entry) => (
              <li className="staff-audit-row" key={entry.id}>
                <span className="staff-audit-text">
                  <strong>{entry.actor_email || "Unknown"}</strong> {staffAuditVerb(entry.action)}{" "}
                  <strong>{entry.target_email}</strong>
                  {entry.detail ? ` (${entry.detail})` : ""}
                </span>
                <span className="staff-audit-time">{fmtDateTime(entry.created_at)}</span>
              </li>
            ))}
          </ul>
        )}

        {auditRows && auditRows.length === 0 && !auditError && (
          <p className="card-subtitle">No activity recorded yet.</p>
        )}
      </div>

      <div className="content-masonry">
        <div className="card">
          <h3 className="card-title">System info</h3>
          <p className="card-subtitle">What the app is actually talking to, for debugging a broken login or a stale deploy.</p>
          <dl className="staff-info-list">
            <div>
              <dt>App version</dt>
              <dd>
                {window.MGB_VERSION ? `${window.MGB_VERSION.label} — ${window.MGB_VERSION.note}` : "Not set"}
              </dd>
            </div>
            <div>
              <dt>Supabase project</dt>
              <dd>{supabase && window.SUPABASE_CONFIG ? new URL(window.SUPABASE_CONFIG.url).host : "Not configured"}</dd>
            </div>
            <div>
              <dt>Staff table read</dt>
              <dd className={staffReadOk === false ? "negative" : staffReadOk ? "positive" : ""}>
                {staffReadOk === false ? `Failing — ${staffReadError}` : staffReadOk ? "OK" : "Checking…"}
              </dd>
            </div>
            <div>
              <dt>Audit log read</dt>
              <dd className={auditError ? "negative" : auditRows ? "positive" : ""}>
                {auditError ? "Failing — run staff-audit-log.sql" : auditRows ? "OK" : "Checking…"}
              </dd>
            </div>
            {staffUser && (
              <div>
                <dt>Signed in as</dt>
                <dd>
                  {staffUser.name} ({staffUser.email}) · {staffUser.role}
                </dd>
              </div>
            )}
          </dl>
        </div>

        <div className="card">
          <h3 className="card-title">Where things live</h3>
          <p className="card-subtitle">
            A directory, not a vault — this doesn't store any real credentials. Edit <code>INFRA_LINKS</code> in
            app.jsx when an account changes.
          </p>
          <div className="staff-audit-list">
            {INFRA_LINKS.map((l) => (
              <a className="staff-due-row" href={l.url} target="_blank" rel="noopener noreferrer" key={l.name}>
                <span className="staff-flag-label">{l.name}</span>
                <span className="staff-flag-desc">{l.note}</span>
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Team Chat — internal staff messaging, separate from client conversations
// (which are mock data, not Supabase — see data.js's `threads`). Any active
// staff member can DM any other active staff member (bookkeepers included —
// two bookkeepers working the same client need this as much as a bookkeeper
// <-> admin line does), on real Supabase tables (staff_conversations /
// staff_conversation_members / staff_messages), with file attachments,
// edit/unsend within 5 seconds of sending, and live read receipts pushed
// over Supabase Realtime.
// ----------------------------------------------------------------------------

// 15 minutes, not 5 seconds — the old window (staff-chat-v2.sql) expired
// before most people finished typing a fix, so Edit/Unsend looked broken
// even though it was working exactly as configured. Mirrored in
// supabase/staff-chat-groups.sql's RLS policy; both must be changed together.
const CHAT_EDIT_WINDOW_MS = 15 * 60 * 1000;

function StaffMessagesPage({ staffUser, onActivity }) {
  const supabase = window.mgbSupabase;
  const showToast = useToast();

  const [directory, setDirectory] = useState(null); // every other active staff member
  const [conversations, setConversations] = useState(null); // my conversations, most recent first
  const [activeConversationId, setActiveConversationId] = useState(null);
  const [activeMembers, setActiveMembers] = useState(null); // [{staff_email, last_read_at}] for the open conversation
  const [messages, setMessages] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [draft, setDraft] = useState("");
  const [pendingAttachment, setPendingAttachment] = useState(null); // {file, name, size}
  const [isDragging, setIsDragging] = useState(false);
  const [sending, setSending] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState("");
  const [, setTick] = useState(0); // forces a re-render so the edit/unsend window visibly expires
  const [threadFilter, setThreadFilter] = useState("");
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [onlineEmails, setOnlineEmails] = useState(new Set()); // Realtime Presence
  const [typingName, setTypingName] = useState(null); // Realtime Broadcast, active conversation only
  const fileInputRef = useRef(null);
  const typingChannelRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const lastTypingSentRef = useRef(0);
  // Guards against a stale async openWith() resolving after the user has
  // already clicked to a different thread and overwriting their new
  // selection — see selectConversation/openWith below. This was the actual
  // cause of "I messaged Gillian and Jeff got it": clicking Gillian (no
  // conversation yet) kicked off an insert; if Send was hit before that
  // insert resolved, it fired against whatever activeConversationId still
  // held — Jeff's, left over from before.
  const openTokenRef = useRef(0);

  useEffect(() => {
    if (!supabase) return;
    supabase
      .from("staff")
      .select("email, name, role, active")
      .eq("active", true)
      .neq("email", staffUser.email)
      .order("name", { ascending: true })
      .then(({ data, error }) => {
        if (!error) setDirectory(data);
      });
  }, [supabase, staffUser.email]);

  const loadConversations = useCallback(() => {
    if (!supabase) return;
    supabase
      .from("staff_conversation_members")
      .select("conversation_id, last_read_at")
      .eq("staff_email", staffUser.email)
      .then(async ({ data, error }) => {
        if (error || !data || data.length === 0) {
          setConversations([]);
          return;
        }
        const convIds = data.map((r) => r.conversation_id);
        const myReadByConv = {};
        data.forEach((r) => {
          myReadByConv[r.conversation_id] = r.last_read_at;
        });

        const [{ data: otherMembers }, { data: recentMessages }, { data: convRows }] = await Promise.all([
          supabase
            .from("staff_conversation_members")
            .select("conversation_id, staff_email")
            .in("conversation_id", convIds)
            .neq("staff_email", staffUser.email),
          supabase
            .from("staff_messages")
            .select("conversation_id, author_email, text, attachment_name, created_at")
            .in("conversation_id", convIds)
            .is("deleted_at", null)
            .order("created_at", { ascending: false }),
          // is_group/title only exist once staff-chat-groups.sql has been run —
          // an older DB just won't have any group conversations to find here.
          supabase.from("staff_conversations").select("id, is_group, title").in("id", convIds),
        ]);

        // A group has 2+ "other" members, so this collects an array per
        // conversation rather than the single email a 1:1 DM used to assume
        // (that assumption is what silently mislabeled groups before).
        const othersByConv = {};
        (otherMembers || []).forEach((m) => {
          (othersByConv[m.conversation_id] || (othersByConv[m.conversation_id] = [])).push(m.staff_email);
        });
        const convMetaById = {};
        (convRows || []).forEach((c) => {
          convMetaById[c.id] = c;
        });
        const otherEmails = [...new Set(Object.values(othersByConv).flat())];
        let staffByEmail = {};
        if (otherEmails.length > 0) {
          const { data: staffRows } = await supabase.from("staff").select("email, name, role").in("email", otherEmails);
          (staffRows || []).forEach((s) => {
            staffByEmail[s.email] = s;
          });
        }
        const lastByConv = {};
        (recentMessages || []).forEach((m) => {
          if (!lastByConv[m.conversation_id]) lastByConv[m.conversation_id] = m;
        });

        const rows = convIds.map((id) => {
          const meta = convMetaById[id] || {};
          const otherEmailsForConv = othersByConv[id] || [];
          const otherNames = otherEmailsForConv.map((e) => (staffByEmail[e] ? staffByEmail[e].name : e));
          const isGroup = !!meta.is_group;
          const last = lastByConv[id];
          const myReadAt = myReadByConv[id];
          const unread = !!last && last.author_email !== staffUser.email && (!myReadAt || new Date(last.created_at) > new Date(myReadAt));
          return {
            id,
            isGroup,
            otherEmail: !isGroup ? otherEmailsForConv[0] || null : null,
            otherEmails: otherEmailsForConv,
            otherName: isGroup ? meta.title || otherNames.join(", ") || "Group" : otherNames[0] || otherEmailsForConv[0] || "Unknown",
            otherRole: isGroup ? `${otherEmailsForConv.length + 1} people` : (staffByEmail[otherEmailsForConv[0]] || {}).role || "",
            lastText: last ? last.text || (last.attachment_name ? `Attachment: ${last.attachment_name}` : "") : "",
            lastAt: last ? last.created_at : null,
            unread,
          };
        });
        rows.sort((a, b) => new Date(b.lastAt || 0) - new Date(a.lastAt || 0));
        setConversations(rows);
      });
  }, [supabase, staffUser.email]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  const markRead = useCallback(
    (conversationId) => {
      if (!supabase || !conversationId) return;
      supabase
        .from("staff_conversation_members")
        .update({ last_read_at: new Date().toISOString() })
        .eq("conversation_id", conversationId)
        .eq("staff_email", staffUser.email)
        .then(() => {
          loadConversations();
          if (onActivity) onActivity();
        });
    },
    [supabase, staffUser.email, loadConversations, onActivity]
  );

  const loadMessages = useCallback(() => {
    if (!supabase || !activeConversationId) return;
    Promise.all([
      supabase
        .from("staff_messages")
        .select(
          "id, conversation_id, author_email, author_name, author_role, text, attachment_name, attachment_url, attachment_size, created_at, edited_at, deleted_at"
        )
        .eq("conversation_id", activeConversationId)
        .order("created_at", { ascending: true }),
      supabase.from("staff_conversation_members").select("staff_email, last_read_at").eq("conversation_id", activeConversationId),
    ]).then(([msgRes, memRes]) => {
      if (msgRes.error) {
        setLoadError("Couldn't load messages. Has staff-chat-v2.sql been run? " + msgRes.error.message);
        setMessages([]);
        return;
      }
      setLoadError("");
      setMessages((msgRes.data || []).filter((m) => !m.deleted_at));
      setActiveMembers(memRes.data || []);
      markRead(activeConversationId);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, activeConversationId]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  // Live updates: new messages, edits/unsends, and the other side marking
  // the thread read, all pushed in — no polling, no manual refresh needed
  // to see a reply or watch "Sent" flip to "Seen".
  const conversationIdsRef = useRef(new Set());
  useEffect(() => {
    conversationIdsRef.current = new Set((conversations || []).map((c) => c.id));
  }, [conversations]);
  const activeConversationIdRef = useRef(null);
  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  useEffect(() => {
    if (!supabase) return;
    const channel = supabase
      .channel("staff-chat-" + staffUser.email)
      .on("postgres_changes", { event: "*", schema: "public", table: "staff_messages" }, (payload) => {
        const convId = (payload.new && payload.new.conversation_id) || (payload.old && payload.old.conversation_id);
        if (!convId) return;
        if (convId === activeConversationIdRef.current) loadMessages();
        loadConversations();
        if (onActivity) onActivity();
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "staff_conversation_members" }, (payload) => {
        const convId = payload.new && payload.new.conversation_id;
        if (convId && convId === activeConversationIdRef.current) loadMessages();
        loadConversations();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, staffUser.email]);

  // Realtime Presence: one shared channel every signed-in staff member
  // joins, keyed by their own email. `sync` fires with the full roster
  // whenever anyone joins/leaves, so onlineEmails is always just "who's in
  // presenceState() right now" — no polling, no manual heartbeat.
  useEffect(() => {
    if (!supabase) return;
    const channel = supabase.channel("staff-presence", { config: { presence: { key: staffUser.email } } });
    channel
      .on("presence", { event: "sync" }, () => {
        setOnlineEmails(new Set(Object.keys(channel.presenceState())));
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") await channel.track({ online_at: new Date().toISOString() });
      });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, staffUser.email]);

  // Realtime Broadcast, scoped to whichever conversation is open — a fresh
  // channel per activeConversationId (not the per-user inbox channel above,
  // which isn't shared between the two people in a DM). Typing pulses reset
  // a 3s timeout rather than an explicit "stopped typing" event, so it also
  // self-clears if the other tab closes mid-keystroke.
  useEffect(() => {
    setTypingName(null);
    typingChannelRef.current = null;
    if (!supabase || !activeConversationId) return;
    const channel = supabase.channel("conv-typing-" + activeConversationId);
    channel
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        if (!payload || payload.email === staffUser.email) return;
        setTypingName(payload.name || "Someone");
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => setTypingName(null), 3000);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") typingChannelRef.current = channel;
      });
    return () => {
      clearTimeout(typingTimeoutRef.current);
      supabase.removeChannel(channel);
      typingChannelRef.current = null;
    };
  }, [supabase, activeConversationId, staffUser.email]);

  const notifyTyping = () => {
    const now = Date.now();
    if (!typingChannelRef.current || now - lastTypingSentRef.current < 1500) return;
    lastTypingSentRef.current = now;
    typingChannelRef.current.send({ type: "broadcast", event: "typing", payload: { email: staffUser.email, name: staffUser.name } });
  };

  // Live-expire the edit/unsend window on-screen without needing another
  // action to trigger a re-render.
  useEffect(() => {
    const hasRecent = (messages || []).some(
      (m) => m.author_email === staffUser.email && Date.now() - new Date(m.created_at).getTime() < CHAT_EDIT_WINDOW_MS
    );
    if (!hasRecent) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [messages, staffUser.email]);

  // token: this call's own stamp from openTokenRef, taken at click time by
  // selectConversation below. If the user has since clicked a different
  // thread (bumping the ref), this result is stale and must NOT overwrite
  // activeConversationId — that's what let a message meant for a brand-new
  // conversation land in whatever conversation was active before it.
  const openWith = useCallback(
    (otherEmail, token) => {
      if (!supabase || !otherEmail) return;
      const dmKey = [staffUser.email, otherEmail].sort().join("|");
      supabase
        .from("staff_conversations")
        .select("id")
        .eq("dm_key", dmKey)
        .maybeSingle()
        .then(async ({ data: existing }) => {
          if (existing) {
            if (openTokenRef.current === token) setActiveConversationId(existing.id);
            return;
          }
          const { data: created, error } = await supabase.from("staff_conversations").insert({ dm_key: dmKey }).select("id").single();
          if (error || !created) {
            showToast("Couldn't start the conversation.");
            return;
          }
          await supabase.from("staff_conversation_members").insert([
            { conversation_id: created.id, staff_email: staffUser.email, last_read_at: new Date().toISOString() },
            { conversation_id: created.id, staff_email: otherEmail },
          ]);
          if (openTokenRef.current === token) setActiveConversationId(created.id);
          loadConversations();
        });
    },
    [supabase, staffUser.email, loadConversations, showToast]
  );

  // Every thread click (existing conversation or a fresh 1:1) goes through
  // here so switching always clears the old thread's messages immediately —
  // otherwise the previous conversation's messages (and its
  // activeConversationId) stay on screen/active while the new one loads,
  // which is exactly the gap the openWith race above could land a message in.
  const selectConversation = useCallback(
    (c) => {
      openTokenRef.current += 1;
      const token = openTokenRef.current;
      setActiveConversationId(null);
      setMessages(null);
      setActiveMembers(null);
      if (c.id) {
        if (openTokenRef.current === token) setActiveConversationId(c.id);
        return;
      }
      openWith(c.otherEmail, token);
    },
    [openWith]
  );

  const createGroup = useCallback(
    async (emails, title) => {
      if (!supabase || emails.length < 2) return;
      const { data: created, error } = await supabase
        .from("staff_conversations")
        .insert({ is_group: true, title: title.trim() || null })
        .select("id")
        .single();
      if (error || !created) {
        showToast(
          error && /is_group|column/i.test(error.message || "")
            ? "Couldn't create the group — has staff-chat-groups.sql been run?"
            : "Couldn't create the group."
        );
        return;
      }
      await supabase.from("staff_conversation_members").insert([
        { conversation_id: created.id, staff_email: staffUser.email, last_read_at: new Date().toISOString() },
        ...emails.map((email) => ({ conversation_id: created.id, staff_email: email })),
      ]);
      setShowGroupModal(false);
      openTokenRef.current += 1;
      setActiveConversationId(created.id);
      setMessages(null);
      setActiveMembers(null);
      loadConversations();
    },
    [supabase, staffUser.email, loadConversations, showToast]
  );

  const stageFile = (file) => {
    if (!file) return;
    setPendingAttachment({ file, name: file.name, size: formatBytes(file.size) });
  };

  async function send() {
    if ((!draft.trim() && !pendingAttachment) || !activeConversationId || !supabase) return;
    setSending(true);
    // Everything below used to run with no try/catch: any REJECTED promise
    // (a thrown network/CORS/timeout error, as opposed to a resolved
    // {error} response) skipped straight past every setSending(false) call
    // below, leaving Send permanently disabled and the attachment stuck
    // staged with zero feedback — "it's sending but not going anywhere."
    // upload()/insert() normally resolve with {error} rather than throw, but
    // "normally" isn't a guarantee, and the one path that must never happen
    // is the button getting stuck. finally covers every exit.
    try {
      let attachment_name = null;
      let attachment_url = null;
      let attachment_size = null;
      if (pendingAttachment) {
        // Supabase Storage keys reject characters a real filename has all
        // the time (#, %, &, ?, +, non-ASCII…). Unsanitized, a name like
        // "Q3 Report #2.pdf" made the upload fail outright — and since
        // send() used to bail before ever inserting the message row, that
        // attempt left nothing behind at all: no message, no file, nothing
        // to retry from but re-attaching. attachment_name (below) keeps the
        // real name for display; only the storage key itself needs to be safe.
        const safeName = pendingAttachment.file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = `${activeConversationId}/${Date.now()}-${safeName}`;
        const { error: upErr } = await supabase.storage.from("staff-chat-attachments").upload(path, pendingAttachment.file);
        if (upErr) {
          showToast(`Couldn't upload attachment: ${upErr.message}`);
          return;
        }
        const { data: urlData } = supabase.storage.from("staff-chat-attachments").getPublicUrl(path);
        attachment_name = pendingAttachment.file.name;
        attachment_url = urlData.publicUrl;
        attachment_size = pendingAttachment.size;
      }
      const { error } = await supabase.from("staff_messages").insert({
        conversation_id: activeConversationId,
        author_email: staffUser.email,
        author_name: staffUser.name,
        author_role: staffUser.role,
        text: draft.trim() || null,
        attachment_name,
        attachment_url,
        attachment_size,
      });
      if (error) {
        showToast(`Couldn't send: ${error.message}`);
        return;
      }
      setDraft("");
      setPendingAttachment(null);
      loadMessages();
    } catch (err) {
      showToast(`Couldn't send: ${err && err.message ? err.message : "unexpected error"}`);
    } finally {
      setSending(false);
    }
  }

  function startEdit(m) {
    setEditingId(m.id);
    setEditDraft(m.text || "");
  }

  async function saveEdit(id) {
    const text = editDraft.trim();
    if (!text || !supabase) return;
    const { error } = await supabase.from("staff_messages").update({ text, edited_at: new Date().toISOString() }).eq("id", id);
    if (error) showToast("Couldn't save — the 15 minute edit window has passed.");
    setEditingId(null);
    loadMessages();
  }

  async function unsend(id) {
    if (!supabase) return;
    const { error } = await supabase.from("staff_messages").update({ deleted_at: new Date().toISOString() }).eq("id", id);
    if (error) showToast("Couldn't unsend — the 15 minute window has passed.");
    loadMessages();
  }

  // Recent conversations first, then anyone in the directory not yet
  // messaged (1:1 only — a group thread is always started explicitly via
  // "New Group", never implied by a directory row), so opening a new
  // conversation is just picking a name rather than a separate flow.
  const chatEntries = useMemo(() => {
    if (!directory) return [];
    const convEmails = new Set((conversations || []).filter((c) => !c.isGroup).map((c) => c.otherEmail));
    const withoutConv = directory
      .filter((d) => !convEmails.has(d.email))
      .map((d) => ({ id: null, otherEmail: d.email, otherName: d.name, otherRole: d.role, lastText: "", lastAt: null, unread: false, isGroup: false }));
    withoutConv.sort((a, b) => a.otherName.localeCompare(b.otherName));
    // Unread first (most recent unread first), then everything else by
    // recency — an unread thread three days old shouldn't hide below five
    // read ones from this morning.
    const sortedConversations = [...(conversations || [])].sort((a, b) => {
      if (a.unread !== b.unread) return a.unread ? -1 : 1;
      return new Date(b.lastAt || 0) - new Date(a.lastAt || 0);
    });
    const combined = [...sortedConversations, ...withoutConv];
    const q = threadFilter.trim().toLowerCase();
    return q ? combined.filter((c) => c.otherName.toLowerCase().includes(q)) : combined;
  }, [directory, conversations, threadFilter]);

  const activeEntry = chatEntries.find((c) => (c.id ? c.id === activeConversationId : false));
  const otherActiveMembers = (activeMembers || []).filter((mm) => mm.staff_email !== staffUser.email);
  const otherMember = otherActiveMembers.length === 1 ? otherActiveMembers[0] : null;
  const otherHasSeen = (m) => !!(otherMember && otherMember.last_read_at && new Date(otherMember.last_read_at) >= new Date(m.created_at));
  const seenCount = (m) => otherActiveMembers.filter((mm) => mm.last_read_at && new Date(mm.last_read_at) >= new Date(m.created_at)).length;
  let lastMineMessage = null;
  (messages || []).forEach((m) => {
    if (m.author_email === staffUser.email) lastMineMessage = m;
  });

  return (
    <div>
      <MockBanner text="Internal only — separate from client conversations. Nothing here is visible to any client." />

      <div className="thread-picker">
        <div className="thread-picker-toolbar">
          <span className="thread-picker-label">Conversation with</span>
          <input
            type="text"
            className="thread-filter-input"
            placeholder="Find a person or group…"
            value={threadFilter}
            onChange={(e) => setThreadFilter(e.target.value)}
          />
          <button type="button" className="btn-secondary" onClick={() => setShowGroupModal(true)}>
            + New Group
          </button>
        </div>
        {directory === null ? (
          <p className="card-subtitle">Loading…</p>
        ) : chatEntries.length === 0 ? (
          <p className="card-subtitle">{threadFilter ? "No matches." : "No other active staff yet."}</p>
        ) : (
          <div className="thread-picker-tabs">
            {chatEntries.map((c) => (
              <button
                key={c.id || c.otherEmail}
                className={
                  "thread-tab" +
                  ((c.id ? c.id === activeConversationId : false) ? " active" : "") +
                  (c.isGroup ? " thread-tab-group" : "") +
                  (c.unread ? " thread-tab-unread" : "")
                }
                onClick={() => selectConversation(c)}
              >
                <span className="thread-tab-name">
                  {/* Presence, not a stored column — reflects who's on the channel
                      right now, not "was active as of last page load". */}
                  {(c.isGroup ? c.otherEmails.some((e) => onlineEmails.has(e)) : onlineEmails.has(c.otherEmail)) && (
                    <span className="online-dot" aria-label="Online" title="Online now" />
                  )}
                  {c.otherName}
                </span>
                <span className="thread-tab-role">{c.otherRole}</span>
                {c.lastText && <span className="thread-tab-preview">{c.lastText}</span>}
                {c.unread && <span className="thread-tab-dot" aria-label="Unread" />}
              </button>
            ))}
          </div>
        )}
      </div>

      {activeConversationId && (
        <div
          className={"card message-card" + (isDragging ? " dragging" : "")}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            stageFile(e.dataTransfer.files && e.dataTransfer.files[0]);
          }}
        >
          <h3 className="card-title">
            {activeEntry &&
              (activeEntry.isGroup
                ? activeEntry.otherEmails.some((e) => onlineEmails.has(e))
                : onlineEmails.has(activeEntry.otherEmail)) && <span className="online-dot" aria-label="Online" title="Online now" />}
            {activeEntry ? `Conversation with ${activeEntry.otherName}` : "Conversation"}
          </h3>
          {loadError && <p className="card-subtitle negative">{loadError}</p>}
          {messages === null && !loadError && <p className="card-subtitle">Loading…</p>}
          {messages && messages.length === 0 && !loadError && <p className="card-subtitle">No messages yet — say hello.</p>}
          {messages && messages.length > 0 && (
            <div className="message-thread">
              {messages.map((m) => {
                const mine = m.author_email === staffUser.email;
                const withinWindow = mine && Date.now() - new Date(m.created_at).getTime() < CHAT_EDIT_WINDOW_MS;
                return (
                  <div className={"message-bubble-row " + (mine ? "client" : "bookkeeper")} key={m.id}>
                    <div className="message-bubble">
                      <div className="message-author">
                        {m.author_name} · {m.author_role}
                      </div>
                      {editingId === m.id ? (
                        <div className="message-edit-row">
                          <input
                            type="text"
                            value={editDraft}
                            onChange={(e) => setEditDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveEdit(m.id);
                              if (e.key === "Escape") setEditingId(null);
                            }}
                            autoFocus
                          />
                          <button className="btn-secondary" onClick={() => saveEdit(m.id)}>
                            Save
                          </button>
                        </div>
                      ) : (
                        <React.Fragment>
                          {m.text && <div className="message-text">{m.text}</div>}
                          {m.attachment_name && (
                            <a className="message-attachment" href={m.attachment_url} target="_blank" rel="noreferrer">
                              <PaperclipIcon /> {m.attachment_name}{" "}
                              {m.attachment_size && <span className="message-attachment-size">({m.attachment_size})</span>}
                            </a>
                          )}
                        </React.Fragment>
                      )}
                      <div className="message-date">
                        {fmtDateTime(m.created_at)}
                        {m.edited_at && <span className="message-edited-tag"> · edited</span>}
                      </div>
                      {withinWindow && editingId !== m.id && (
                        <div className="message-own-actions">
                          <button type="button" onClick={() => startEdit(m)}>
                            Edit
                          </button>
                          <button type="button" onClick={() => unsend(m.id)}>
                            Unsend
                          </button>
                        </div>
                      )}
                      {mine && m === lastMineMessage && (
                        <div className="message-seen-status">
                          {activeEntry && activeEntry.isGroup
                            ? seenCount(m) > 0
                              ? `Seen by ${seenCount(m)}/${otherActiveMembers.length}`
                              : "Sent"
                            : otherHasSeen(m)
                            ? "Seen"
                            : "Sent"}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {pendingAttachment && (
            <div className="attachment-chip">
              <span>
                <PaperclipIcon /> {pendingAttachment.name}
              </span>
              <span className="attachment-chip-meta">{pendingAttachment.size}</span>
              <button className="attachment-remove" onClick={() => setPendingAttachment(null)} aria-label="Remove attachment">
                ×
              </button>
            </div>
          )}

          {/* Reserves its line whether or not anyone's typing, so the
              compose bar doesn't hop up and down every time it appears. */}
          <div className="typing-indicator">{typingName ? `${typingName} is typing…` : " "}</div>

          <div className="message-compose">
            <button type="button" className="attach-btn" onClick={() => fileInputRef.current.click()} aria-label="Attach file">
              <PaperclipIcon />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              style={{ display: "none" }}
              onChange={(e) => {
                stageFile(e.target.files && e.target.files[0]);
                e.target.value = "";
              }}
            />
            <input
              type="text"
              placeholder="Write a message…"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                notifyTyping();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") send();
              }}
            />
            <button className="btn-primary" onClick={send} disabled={sending || (!draft.trim() && !pendingAttachment)}>
              Send
            </button>
          </div>
        </div>
      )}

      {showGroupModal && (
        <GroupComposeModal directory={directory || []} onCreate={createGroup} onClose={() => setShowGroupModal(false)} />
      )}
    </div>
  );
}

function GroupComposeModal({ directory, onCreate, onClose }) {
  const [selected, setSelected] = useState(new Set());
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);

  const toggle = (email) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  };

  const handleCreate = async () => {
    setCreating(true);
    await onCreate([...selected], title);
    setCreating(false);
  };

  return (
    <ModalShell onClose={onClose} labelledBy="new-group-title">
      <div className="modal-header">
        <h3 id="new-group-title">New group</h3>
        <button className="modal-close" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="modal-body">
        <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6 }} htmlFor="new-group-name">
          Group name (optional)
        </label>
        <input
          id="new-group-name"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Grace Community team"
          style={{ marginBottom: 16 }}
        />
        <p className="card-subtitle" style={{ marginTop: 0 }}>
          Pick at least 2 people. Without a name, the group is labeled by who's in it.
        </p>
        <div className="group-member-list">
          {directory.map((d) => (
            <label className="group-member-row" key={d.email}>
              <input type="checkbox" checked={selected.has(d.email)} onChange={() => toggle(d.email)} />
              <span className="group-member-name">{d.name}</span>
              <span className="group-member-role">{d.role}</span>
            </label>
          ))}
        </div>
        <button
          className="btn-primary"
          style={{ marginTop: 16 }}
          disabled={selected.size < 2 || creating}
          onClick={handleCreate}
        >
          {creating ? "Creating…" : `Create group${selected.size > 0 ? ` (${selected.size + 1} people)` : ""}`}
        </button>
      </div>
    </ModalShell>
  );
}

function ClientAccessPage() {
  const showToast = useToast();
  const supabase = window.mgbSupabase;

  const [rows, setRows] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [busyEmail, setBusyEmail] = useState(null);
  const [search, setSearch] = useState("");
  const [newClientId, setNewClientId] = useState(CLIENTS[0] ? CLIENTS[0].id : "");
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState("");
  const [adding, setAdding] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvResults, setCsvResults] = useState(null);

  const csvPreview = useMemo(() => (csvText.trim() ? parseClientUserCsv(csvText) : []), [csvText]);
  const csvValidCount = csvPreview.filter((r) => r.errors.length === 0).length;

  const load = useCallback(() => {
    if (!supabase) {
      setLoadError("Supabase isn't configured — see auth-config.js.");
      setRows([]);
      return;
    }
    supabase
      .from("client_users")
      .select("email, client_id, name, role, active, created_at")
      .order("created_at", { ascending: true })
      .then(({ data, error }) => {
        if (error) {
          // Most likely cause: supabase/client-users.sql hasn't been run yet.
          setLoadError("Couldn't load client contacts. " + error.message);
          setRows([]);
        } else {
          setLoadError("");
          setRows(data);
        }
      });
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const filteredRows = useMemo(() => {
    if (!rows) return [];
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q) ||
        clientNameFor(r.client_id).toLowerCase().includes(q)
    );
  }, [rows, search]);

  function clientNameFor(clientId) {
    const c = CLIENTS.find((c) => c.id === clientId);
    return c ? c.name : clientId;
  }

  async function addContact() {
    const email = newEmail.trim().toLowerCase();
    const name = newName.trim();
    const role = newRole.trim();
    if (!email || !name || !role || !newClientId) return;
    setAdding(true);
    const { error } = await supabase
      .from("client_users")
      .insert({ email, client_id: newClientId, name, role, active: true });
    setAdding(false);
    if (error) {
      showToast(`Couldn't add ${email}: ${error.message}`);
      return;
    }
    setNewEmail("");
    setNewName("");
    setNewRole("");
    showToast(`Added ${name} (${clientNameFor(newClientId)}).`);
    load();
  }

  async function toggleActive(row) {
    setBusyEmail(row.email);
    const { error } = await supabase.from("client_users").update({ active: !row.active }).eq("email", row.email);
    setBusyEmail(null);
    if (error) {
      showToast(`Couldn't update ${row.email}: ${error.message}`);
      return;
    }
    load();
  }

  async function removeContact(row) {
    if (!window.confirm(`Remove ${row.name} (${row.email}) from ${clientNameFor(row.client_id)}?`)) return;
    setBusyEmail(row.email);
    const { error } = await supabase.from("client_users").delete().eq("email", row.email);
    setBusyEmail(null);
    if (error) {
      showToast(`Couldn't remove ${row.email}: ${error.message}`);
      return;
    }
    showToast(`Removed ${row.name}.`);
    load();
  }

  async function importCsv() {
    const validRows = csvPreview.filter((r) => r.errors.length === 0);
    if (validRows.length === 0) return;
    setCsvImporting(true);
    const results = [];
    for (const r of validRows) {
      const { error } = await supabase
        .from("client_users")
        .insert({ email: r.email, client_id: r.clientId, name: r.name, role: r.role, active: true });
      results.push({ email: r.email, name: r.name, ok: !error, message: error ? error.message : "" });
    }
    setCsvImporting(false);
    setCsvResults(results);
    const okCount = results.filter((r) => r.ok).length;
    showToast(
      okCount === results.length
        ? `Imported ${okCount} client contacts.`
        : `Imported ${okCount} of ${results.length} — see the results below for what failed.`
    );
    if (okCount === results.length) setCsvText("");
    load();
  }

  return (
    <div>
      <div className="mock-banner">
        <WarningIcon /> This page writes directly to the real client_users table in Supabase. It only
        controls who WILL be able to sign in once Phase 2's client login gate is built — until
        then, nothing here changes who can actually access a client's data (see "Manage
        access" on each client's dashboard for that).
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 className="card-title">Add a contact</h3>
        <p className="card-subtitle">
          One row per person, not per organization — each contact signs in with their own
          address once Phase 2 is live.
        </p>
        <div className="staff-add-row">
          <select value={newClientId} onChange={(e) => setNewClientId(e.target.value)}>
            {CLIENTS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <input
            type="email"
            placeholder="name@theirdomain.org"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
          />
          <input type="text" placeholder="Full name" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <input type="text" placeholder="Role (e.g. Board Treasurer)" value={newRole} onChange={(e) => setNewRole(e.target.value)} />
          <button
            className="btn-primary"
            disabled={adding || !newEmail.trim() || !newName.trim() || !newRole.trim()}
            onClick={addContact}
          >
            + Add
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 className="card-title">Bulk import</h3>
        <p className="card-subtitle">
          Paste rows as <code>client_id, email, name, role</code> — client_id must match a
          client's id exactly (e.g. <code>grace-community</code>), not its display name.
        </p>
        <textarea
          className="staff-csv-textarea"
          rows={4}
          placeholder={"grace-community, john@gracecommunity.org, Pastor John Whitfield, Lead Pastor\nnew-hope, mia@newhopeoutreach.org, Mia Alvarez, Executive Director"}
          value={csvText}
          onChange={(e) => {
            setCsvText(e.target.value);
            setCsvResults(null);
          }}
        />
        {csvPreview.length > 0 && (
          <React.Fragment>
            <ul className="staff-csv-preview">
              {csvPreview.map((r, i) => (
                <li key={i} className={r.errors.length ? "negative" : "positive"}>
                  {r.errors.length ? (
                    <React.Fragment>
                      <strong>{r.line}</strong> — {r.errors.join(", ")}
                    </React.Fragment>
                  ) : (
                    <React.Fragment>
                      {r.name} ({r.email}) · {r.role} · {r.clientName}
                    </React.Fragment>
                  )}
                </li>
              ))}
            </ul>
            <div className="staff-reset-row">
              <button className="btn-primary" disabled={csvImporting || csvValidCount === 0} onClick={importCsv}>
                {csvImporting ? "Importing…" : `Import ${csvValidCount} contacts`}
              </button>
              {csvValidCount < csvPreview.length && (
                <p className="card-subtitle" style={{ margin: 0 }}>
                  {csvPreview.length - csvValidCount} row(s) above have errors and will be skipped.
                </p>
              )}
            </div>
          </React.Fragment>
        )}
        {csvResults && (
          <ul className="staff-csv-preview" style={{ marginTop: 12 }}>
            {csvResults.map((r, i) => (
              <li key={i} className={r.ok ? "positive" : "negative"}>
                {r.ok ? `Added ${r.name}` : `${r.name || r.email} — ${r.message}`}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
          <div>
            <h3 className="card-title">Client contacts</h3>
            <p className="card-subtitle">Everyone registered to sign in, across every client.</p>
          </div>
          <input
            type="text"
            placeholder="Search name, email, or client…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ maxWidth: 240 }}
          />
        </div>

        {rows === null && !loadError && <p className="card-subtitle">Loading…</p>}
        {loadError && <p className="card-subtitle negative">{loadError}</p>}

        {rows && rows.length > 0 && filteredRows.length === 0 && (
          <p className="card-subtitle">No contact matches "{search}".</p>
        )}

        {filteredRows.length > 0 && (
          <div className="table-scroll">
            <table className="tx-table tx-table-labeled">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Client</th>
                  <th>Role</th>
                  <th>Active</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => {
                  const busy = busyEmail === row.email;
                  return (
                    <tr key={row.email}>
                      <td data-primary="">{row.name}</td>
                      <td data-label="Email">{row.email}</td>
                      <td data-label="Client">{clientNameFor(row.client_id)}</td>
                      <td data-label="Role">{row.role}</td>
                      <td data-label="Active">
                        <label className="staff-active-toggle">
                          <input
                            type="checkbox"
                            checked={row.active}
                            disabled={busy}
                            onChange={() => toggleActive(row)}
                          />
                          <span>{row.active ? "Active" : "Deactivated"}</span>
                        </label>
                      </td>
                      <td className="row-remove-cell">
                        <button
                          className="row-remove-btn"
                          onClick={() => removeContact(row)}
                          disabled={busy}
                          aria-label={`Remove ${row.name}`}
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {rows && rows.length === 0 && !loadError && <p className="card-subtitle">No client contacts yet.</p>}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Bookkeeper Home — every signed-in staffer's landing page (not admin-only,
// unlike Staff Access). Aggregates what's due across every client they can
// see (visibleClients, already narrowed by staff_client_access for a
// bookkeeper — an admin sees all), and a personal reminders list backed by
// staff_reminders. Neither table has cross-staff visibility: reminders are
// private per person, and clients here are exactly whatever the sidebar
// switcher already shows this signed-in person.
// ----------------------------------------------------------------------------

const CLIENT_VISIT_STALE_DAYS = 7;

// How long a KPI's click-to-jump target card holds its flash — kept in sync
// with .card-flash's animation-duration in styles.css (the JS timeout is
// what actually removes the class; the CSS duration just needs to match so
// the fade-out finishes before the class disappears mid-animation).
const CARD_FLASH_HOLD_MS = 2600;

// Shared by every page with KPI tiles that summarize a specific content card
// further down the same page (Home's KPI row, Cash Flow Pro's totals) —
// scrolls to that card and briefly highlights it (.card-flash), so clicking
// a summary number doesn't just quietly move the page somewhere.
function useCardFlash() {
  const [flashCardId, setFlashCardId] = useState(null);
  const flashTimeoutRef = useRef(null);
  useEffect(() => () => clearTimeout(flashTimeoutRef.current), []);
  const jumpToCard = (domId, cardId) => {
    const el = document.getElementById(domId);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
    setFlashCardId(cardId);
    flashTimeoutRef.current = setTimeout(() => setFlashCardId(null), CARD_FLASH_HOLD_MS);
  };
  return { flashCardId, jumpToCard };
}

function BookkeeperHomePage({ staffUser, clients, messagesByClient, readMessageClients, onNavigateToClient }) {
  const showToast = useToast();
  const supabase = window.mgbSupabase;
  const today = todayLocal();

  const [reminders, setReminders] = useState(null);
  const [reminderError, setReminderError] = useState("");
  const [newReminder, setNewReminder] = useState("");
  const [newReminderDate, setNewReminderDate] = useState("");
  const [adding, setAdding] = useState(false);
  const [notes, setNotes] = useState({}); // client_id -> { note, updated_by, updated_at }
  const [noteError, setNoteError] = useState("");
  const [editingNoteFor, setEditingNoteFor] = useState(null); // client object, or null
  const [noteDraft, setNoteDraft] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const { flashCardId, jumpToCard } = useCardFlash();
  const [clientSearch, setClientSearch] = useState("");
  // Separate from clientSearch below (the full "Your clients" card's own
  // filter) — this is a quick type-and-jump at the very top of the page,
  // not tied to that card's position or visibility in Customize dashboard.
  const [jumpQuery, setJumpQuery] = useState("");

  const loadReminders = useCallback(() => {
    if (!supabase) return;
    supabase
      .from("staff_reminders")
      .select("id, text, due_date, done, created_at")
      .eq("staff_email", staffUser.email)
      .order("done", { ascending: true })
      .order("due_date", { ascending: true, nullsFirst: false })
      .then(({ data, error }) => {
        if (error) {
          setReminderError("Couldn't load reminders. Has staff-reminders.sql been run? " + error.message);
          setReminders([]);
        } else {
          setReminderError("");
          setReminders(data);
        }
      });
  }, [supabase, staffUser.email]);

  useEffect(() => {
    loadReminders();
  }, [loadReminders]);

  async function addReminder() {
    const text = newReminder.trim();
    if (!text) return;
    setAdding(true);
    const { error } = await supabase
      .from("staff_reminders")
      .insert({ staff_email: staffUser.email, text, due_date: newReminderDate || null });
    setAdding(false);
    if (error) {
      showToast(`Couldn't add reminder: ${error.message}`);
      return;
    }
    setNewReminder("");
    setNewReminderDate("");
    loadReminders();
  }

  async function toggleReminder(reminder) {
    const { error } = await supabase.from("staff_reminders").update({ done: !reminder.done }).eq("id", reminder.id);
    if (error) {
      showToast(`Couldn't update reminder: ${error.message}`);
      return;
    }
    loadReminders();
  }

  async function removeReminder(reminder) {
    const { error } = await supabase.from("staff_reminders").delete().eq("id", reminder.id);
    if (error) {
      showToast(`Couldn't remove reminder: ${error.message}`);
      return;
    }
    loadReminders();
  }

  const loadNotes = useCallback(() => {
    if (!supabase || clients.length === 0) return;
    supabase
      .from("client_notes")
      .select("client_id, note, updated_by, updated_at")
      .in("client_id", clients.map((c) => c.id))
      .then(({ data, error }) => {
        if (error) {
          setNoteError("Couldn't load client notes. Has client-notes.sql been run? " + error.message);
          return;
        }
        setNoteError("");
        setNotes(Object.fromEntries(data.map((n) => [n.client_id, n])));
      });
  }, [supabase, clients]);

  useEffect(() => {
    loadNotes();
  }, [loadNotes]);

  function openNoteEditor(client) {
    setEditingNoteFor(client);
    setNoteDraft((notes[client.id] && notes[client.id].note) || "");
  }

  async function saveNote() {
    setSavingNote(true);
    const { error } = await supabase
      .from("client_notes")
      .upsert({ client_id: editingNoteFor.id, note: noteDraft, updated_by: staffUser.email, updated_at: new Date().toISOString() });
    setSavingNote(false);
    if (error) {
      showToast(`Couldn't save note: ${error.message}`);
      return;
    }
    setEditingNoteFor(null);
    loadNotes();
  }

  // Same "last message is from the bookkeeper, and the viewer hasn't seen it
  // yet" check the sidebar badge uses for one client (see App's
  // threadHasUnread), just run across every client/person this staffer can
  // see instead of only the selected client.
  const unreadAcrossClients = useMemo(() => {
    const rows = [];
    clients.forEach((client) => {
      (client.users || []).forEach((u) => {
        const key = threadKeyFor(client.id, u.id);
        const msgs = messagesByClient[key] || seedThread(client.id, u.id);
        const unread = lastMessageFromBookkeeper({ messages: msgs }) && msgs.length > (readMessageClients[key] || 0);
        if (unread) rows.push({ clientId: client.id, clientName: client.name, userId: u.id, userName: u.name });
      });
    });
    return rows;
  }, [clients, messagesByClient, readMessageClients]);

  // Per-browser visit history (see recordClientVisit / App's effect that
  // stamps it on every client switch) — not real-time, just whatever this
  // browser last recorded, refreshed on mount.
  const clientVisits = useMemo(() => loadClientVisits(), []);
  const recentlyViewed = useMemo(
    () =>
      clients
        .filter((c) => clientVisits[c.id])
        .sort((a, b) => clientVisits[b.id] - clientVisits[a.id])
        .slice(0, 5),
    [clients, clientVisits]
  );
  const staleMs = CLIENT_VISIT_STALE_DAYS * 24 * 60 * 60 * 1000;
  const needsVisit = useMemo(
    () =>
      clients
        .filter((c) => !clientVisits[c.id] || Date.now() - clientVisits[c.id] > staleMs)
        .sort((a, b) => (clientVisits[a.id] || 0) - (clientVisits[b.id] || 0)),
    [clients, clientVisits]
  );

  const filteredClients = useMemo(() => {
    const q = clientSearch.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter((c) => c.name.toLowerCase().includes(q));
  }, [clients, clientSearch]);

  // Every open bill across every client this person can see, newest-due
  // first — same overdue/soon/scheduled split as Cash Flow Pro, just
  // rolled up across clients instead of scoped to one.
  const dueAcrossClients = useMemo(() => {
    const rows = [];
    clients.forEach((client) => {
      (client.payables || []).forEach((p) => {
        const diff = daysUntil(p.dueDate, today);
        const status = diff < 0 ? "overdue" : diff <= AP_SOON_DAYS ? "soon" : "scheduled";
        if (status === "scheduled") return; // only surface what actually needs attention
        rows.push({ ...p, diff, status, clientId: client.id, clientName: client.name });
      });
    });
    return rows.sort((a, b) => a.diff - b.diff);
  }, [clients, today]);

  const overdueCount = dueAcrossClients.filter((r) => r.status === "overdue").length;
  const soonCount = dueAcrossClients.filter((r) => r.status === "soon").length;

  const dueCountByClient = useMemo(() => {
    const map = {};
    dueAcrossClients.forEach((r) => {
      map[r.clientId] = map[r.clientId] || { overdue: 0, soon: 0 };
      map[r.clientId][r.status]++;
    });
    return map;
  }, [dueAcrossClients]);

  // Same drag-to-reorder / hide-and-show system the client Dashboard uses
  // (useWidgetLayout + useDragReorder + CustomizeDashboardButton) — a fixed
  // scope key rather than a per-client one, since Home isn't about any one
  // client. Long-press (touch) or drag (mouse) any card by its body to pick
  // it up; a plain tap/click still reaches the card's own buttons and links.
  const widgets = [
    { id: "kpi-clients", group: "kpi", label: "Your clients", description: "How many clients you can see" },
    { id: "kpi-overdue", group: "kpi", label: "Overdue bills", description: "Across all your clients" },
    { id: "kpi-soon", group: "kpi", label: `Due within ${AP_SOON_DAYS} days`, description: "Across all your clients" },
    { id: "kpi-unread", group: "kpi", label: "Unread messages", description: "Across all your clients" },
    { id: "needs-attention", group: "content", label: "Needs attention", description: "Overdue or due-soon bills" },
    { id: "unread-list", group: "content", label: "Unread messages", description: "Threads waiting on a reply" },
    { id: "recently-viewed", group: "content", label: "Recently viewed", description: "Clients you've had open recently on this device" },
    { id: "needs-visit", group: "content", label: "Needs a visit", description: "Clients not opened in a while" },
    { id: "your-clients", group: "content", label: "Your clients", description: "Full client list, with search and notes" },
    { id: "your-reminders", group: "content", label: "Your reminders", description: "Your private personal reminders" },
  ];
  const layout = useWidgetLayout("bookkeeper-home", widgets.map((w) => w.id));
  const drag = useDragReorder(layout);
  const kpiOrder = layout.visibleOrder.filter((id) => id.startsWith("kpi-"));
  const contentOrder = layout.visibleOrder.filter((id) => !id.startsWith("kpi-"));

  const jumpMatches = jumpQuery.trim()
    ? clients.filter((c) => c.name.toLowerCase().includes(jumpQuery.trim().toLowerCase())).slice(0, 8)
    : [];

  return (
    <div>
      <div className="card" style={{ marginBottom: 20 }}>
        <h3 className="card-title">Jump to client</h3>
        <p className="card-subtitle">Skip the sidebar dropdown — land straight on a client's dashboard.</p>
        <input
          type="text"
          className="ap-cc-search"
          style={{ width: "100%", boxSizing: "border-box" }}
          placeholder="Search your clients by name…"
          value={jumpQuery}
          onChange={(e) => setJumpQuery(e.target.value)}
        />
        {jumpMatches.length > 0 && (
          <div className="staff-audit-list" style={{ marginTop: 10 }}>
            {jumpMatches.map((c) => (
              <button
                type="button"
                className="staff-due-row"
                key={c.id}
                style={{ width: "100%", textAlign: "left", cursor: "pointer", background: "none", border: "none", font: "inherit" }}
                onClick={() => onNavigateToClient(c.id, "dashboard")}
              >
                <span className="staff-flag-label">{c.name}</span>
                <span className="staff-flag-desc">{c.plan === "premium" ? "Premium" : "Standard"} · {c.id}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <CustomizeDashboardButton widgets={widgets} layout={layout} />

      <div className="kpi-grid">
        {kpiOrder.map((id) => {
          // Every KPI here jumps to the content card it summarizes, when
          // that card is actually on the page (not hidden via Customize
          // dashboard) — a plain, non-clickable tile otherwise, since
          // there'd be nothing to jump to.
          if (id === "kpi-clients") {
            const jump = layout.hidden.has("your-clients")
              ? null
              : () => jumpToCard("home-your-clients-card", "your-clients");
            const Tag = jump ? "button" : "div";
            return (
              <Tag
                className={"card kpi-card " + (jump ? "kpi-card-clickable " : "") + drag.dragClass(id)}
                key={id}
                {...drag.dragProps(id)}
                {...(jump ? { onClick: jump } : {})}
              >
                <span className="kpi-label">Your clients</span>
                <span className="kpi-value">{clients.length}</span>
                <span className="kpi-sub neutral">
                  {clients.length === 0 ? "none assigned yet" : `client${clients.length === 1 ? "" : "s"} you can see`}
                </span>
              </Tag>
            );
          }
          if (id === "kpi-overdue") {
            const jump = layout.hidden.has("needs-attention")
              ? null
              : () => jumpToCard("home-needs-attention-card", "needs-attention");
            const Tag = jump ? "button" : "div";
            return (
              <Tag
                className={"card kpi-card " + (jump ? "kpi-card-clickable " : "") + drag.dragClass(id)}
                key={id}
                {...drag.dragProps(id)}
                {...(jump ? { onClick: jump } : {})}
              >
                <span className="kpi-label">Overdue bills</span>
                <span className="kpi-value negative">{overdueCount}</span>
                <span className="kpi-sub negative">across all your clients</span>
              </Tag>
            );
          }
          if (id === "kpi-soon") {
            const jump = layout.hidden.has("needs-attention")
              ? null
              : () => jumpToCard("home-needs-attention-card", "needs-attention");
            const Tag = jump ? "button" : "div";
            return (
              <Tag
                className={"card kpi-card " + (jump ? "kpi-card-clickable " : "") + drag.dragClass(id)}
                key={id}
                {...drag.dragProps(id)}
                {...(jump ? { onClick: jump } : {})}
              >
                <span className="kpi-label">Due within {AP_SOON_DAYS} days</span>
                <span className="kpi-value warm">{soonCount}</span>
                <span className="kpi-sub warm">across all your clients</span>
              </Tag>
            );
          }
          if (id === "kpi-unread")
            return unreadAcrossClients.length > 0 ? (
              <button
                className={"card kpi-card kpi-card-clickable " + drag.dragClass(id)}
                key={id}
                {...drag.dragProps(id)}
                onClick={() => onNavigateToClient(unreadAcrossClients[0].clientId, "messages")}
              >
                <span className="kpi-label">Unread messages</span>
                <span className="kpi-value warm">{unreadAcrossClients.length}</span>
                <span className="kpi-sub warm">across all your clients — click to open the oldest</span>
              </button>
            ) : (
              <div className={"card kpi-card " + drag.dragClass(id)} key={id} {...drag.dragProps(id)}>
                <span className="kpi-label">Unread messages</span>
                <span className="kpi-value">0</span>
                <span className="kpi-sub neutral">across all your clients</span>
              </div>
            );
          return null;
        })}
      </div>

      <div className="content-masonry" style={{ marginBottom: 20 }}>
        {contentOrder.map((id) => {
          if (id === "needs-attention")
            return (
              <div
                className={"card " + (flashCardId === "needs-attention" ? "card-flash " : "") + drag.dragClass(id)}
                key={id}
                id="home-needs-attention-card"
                {...drag.dragProps(id)}
              >
                <h3 className="card-title">Needs attention</h3>
                <p className="card-subtitle">Overdue or due soon, across every client you can see.</p>
                {dueAcrossClients.length === 0 && <p className="card-subtitle">Nothing due soon — you're caught up.</p>}
                {dueAcrossClients.length > 0 && (
                  <div className="staff-audit-list">
                    {dueAcrossClients.slice(0, 12).map((r, i) => (
                      <button
                        className="staff-due-row"
                        key={i}
                        onClick={() => onNavigateToClient(r.clientId, "receivables")}
                      >
                        <span>
                          <span className="staff-flag-label">{r.vendor}</span>
                          <span className="staff-flag-desc">
                            {r.clientName} · {apDueText(r.diff)}
                          </span>
                        </span>
                        <span className={"pill " + (r.status === "overdue" ? "bad" : "warm")}>
                          {fmtMoney(r.amount, { cents: true })}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          if (id === "unread-list")
            return (
              <div className={"card " + drag.dragClass(id)} key={id} {...drag.dragProps(id)}>
                <h3 className="card-title">Unread messages</h3>
                <p className="card-subtitle">Waiting on a reply, across every client you can see.</p>
                {unreadAcrossClients.length === 0 && <p className="card-subtitle">Nothing unread.</p>}
                {unreadAcrossClients.length > 0 && (
                  <div className="staff-audit-list">
                    {unreadAcrossClients.slice(0, 12).map((r) => (
                      <button
                        className="staff-due-row"
                        key={r.clientId + r.userId}
                        onClick={() => onNavigateToClient(r.clientId, "messages")}
                      >
                        <span className="staff-flag-label">{r.userName}</span>
                        <span className="staff-flag-desc">{r.clientName}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          if (id === "recently-viewed")
            return (
              <div className={"card " + drag.dragClass(id)} key={id} {...drag.dragProps(id)}>
                <h3 className="card-title">Recently viewed</h3>
                <p className="card-subtitle">The clients you've had open most recently, on this device.</p>
                {recentlyViewed.length === 0 && <p className="card-subtitle">Nothing viewed yet this device.</p>}
                {recentlyViewed.length > 0 && (
                  <div className="staff-audit-list">
                    {recentlyViewed.map((c) => (
                      <button className="staff-due-row" key={c.id} onClick={() => onNavigateToClient(c.id, "dashboard")}>
                        <span className="staff-flag-label">{c.name}</span>
                        <span className="staff-flag-desc">{fmtDateTime(new Date(clientVisits[c.id]).toISOString())}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          if (id === "needs-visit")
            return (
              <div className={"card " + drag.dragClass(id)} key={id} {...drag.dragProps(id)}>
                <h3 className="card-title">Needs a visit</h3>
                <p className="card-subtitle">
                  Not opened on this device in {CLIENT_VISIT_STALE_DAYS}+ days (or ever) — nothing to imply they need
                  anything urgent, just a nudge not to lose track.
                </p>
                {needsVisit.length === 0 && <p className="card-subtitle">You're caught up with all of them.</p>}
                {needsVisit.length > 0 && (
                  <div className="staff-audit-list">
                    {needsVisit.slice(0, 8).map((c) => (
                      <button className="staff-due-row" key={c.id} onClick={() => onNavigateToClient(c.id, "dashboard")}>
                        <span className="staff-flag-label">{c.name}</span>
                        <span className="staff-flag-desc">
                          {clientVisits[c.id] ? fmtDateTime(new Date(clientVisits[c.id]).toISOString()) : "Never viewed"}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          if (id === "your-clients")
            return (
              <div
                className={"card " + (flashCardId === "your-clients" ? "card-flash " : "") + drag.dragClass(id)}
                key={id}
                id="home-your-clients-card"
                {...drag.dragProps(id)}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
                  <div>
                    <h3 className="card-title">Your clients</h3>
                    <p className="card-subtitle" style={{ marginTop: 0 }}>
                      Click through to any of them, or add a note for yourself or a colleague.
                    </p>
                  </div>
                  <input
                    type="text"
                    placeholder="Search your clients…"
                    value={clientSearch}
                    onChange={(e) => setClientSearch(e.target.value)}
                    style={{ maxWidth: 220 }}
                  />
                </div>
                {clients.length === 0 && <p className="card-subtitle">None assigned yet — ask an admin.</p>}
                {clients.length > 0 && filteredClients.length === 0 && (
                  <p className="card-subtitle">No client matches "{clientSearch}".</p>
                )}
                {noteError && <p className="card-subtitle negative">{noteError}</p>}
                <div className="staff-audit-list">
                  {filteredClients.map((c) => {
                    const due = dueCountByClient[c.id];
                    const note = notes[c.id];
                    return (
                      <div className="staff-due-row" key={c.id} style={{ cursor: "default" }}>
                        <button
                          className="staff-client-jump"
                          onClick={() => onNavigateToClient(c.id, "dashboard")}
                          style={{ textAlign: "left", flex: 1 }}
                        >
                          <span className="staff-flag-label">{c.name}</span>
                          <span className="staff-flag-desc">
                            {c.plan === "premium" ? "Premium" : "Standard"} plan
                            {due && due.overdue > 0 ? ` · ${due.overdue} overdue` : ""}
                            {due && due.soon > 0 ? ` · ${due.soon} due soon` : ""}
                            {note && note.note ? ` · has a note` : ""}
                          </span>
                        </button>
                        <button className="btn-secondary" onClick={() => openNoteEditor(c)}>
                          {note && note.note ? "Edit note" : "+ Note"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          if (id === "your-reminders")
            return (
              <div className={"card " + drag.dragClass(id)} key={id} {...drag.dragProps(id)}>
                <h3 className="card-title">Your reminders</h3>
                <p className="card-subtitle">Private to you — nobody else, including admins, can see these.</p>

                <div className="staff-add-row">
                  <input
                    type="text"
                    placeholder="Follow up with Grace Community about..."
                    value={newReminder}
                    onChange={(e) => setNewReminder(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") addReminder();
                    }}
                  />
                  <input type="date" value={newReminderDate} onChange={(e) => setNewReminderDate(e.target.value)} />
                  <button className="btn-primary" disabled={adding || !newReminder.trim()} onClick={addReminder}>
                    + Add
                  </button>
                </div>

                {reminderError && <p className="card-subtitle negative" style={{ marginTop: 16 }}>{reminderError}</p>}
                {reminders === null && !reminderError && <p className="card-subtitle" style={{ marginTop: 16 }}>Loading…</p>}
                {reminders && reminders.length === 0 && !reminderError && (
                  <p className="card-subtitle" style={{ marginTop: 16 }}>No reminders yet.</p>
                )}

                {reminders && reminders.length > 0 && (
                  <ul className="staff-audit-list">
                    {reminders.map((r) => (
                      <li className="staff-audit-row" key={r.id}>
                        <label className="staff-active-toggle" style={{ flex: 1 }}>
                          <input type="checkbox" checked={r.done} onChange={() => toggleReminder(r)} />
                          <span style={{ textDecoration: r.done ? "line-through" : "none" }}>
                            {r.text}
                            {r.due_date ? ` — due ${fmtDate(r.due_date)}` : ""}
                          </span>
                        </label>
                        <button className="row-remove-btn" onClick={() => removeReminder(r)} aria-label={`Remove reminder: ${r.text}`}>
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          return null;
        })}
      </div>

      {editingNoteFor && (
        <ModalShell onClose={() => setEditingNoteFor(null)} labelledBy="client-note-title">
          <div className="modal-header">
            <h3 className="card-title" id="client-note-title" style={{ margin: 0 }}>
              Note for {editingNoteFor.name}
            </h3>
            <button className="modal-close" onClick={() => setEditingNoteFor(null)} aria-label="Close">
              ×
            </button>
          </div>
          <p className="card-subtitle">
            Visible to every active staff member, not just you — for handing off context on this client.
            {notes[editingNoteFor.id] &&
              notes[editingNoteFor.id].updated_by &&
              ` Last edited by ${notes[editingNoteFor.id].updated_by}.`}
          </p>
          <div className="modal-body">
            <textarea
              className="client-note-textarea"
              rows={6}
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              placeholder="Waiting on March bank statement, flagged for QuickBooks migration, ..."
            />
          </div>
          <div className="modal-footer">
            <button className="btn-secondary" onClick={() => setEditingNoteFor(null)}>
              Cancel
            </button>
            <button className="btn-primary" disabled={savingNote} onClick={saveNote}>
              Save
            </button>
          </div>
        </ModalShell>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Documents page (upload)
// ----------------------------------------------------------------------------

// Folders (names + which document each one holds, keyed by document name
// since docs have no stable id) are the one part of the Documents page that
// persists across reloads — everything else here is deliberately session-
// only (see the page's own MockBanner). Organizing files into folders is a
// real, lasting decision a client would want to keep making sense next
// time they're back, even though the underlying sample/uploaded files
// themselves aren't really stored anywhere yet.
function docFoldersKey(clientId) {
  return `mygoodbooks_doc_folders_v1:${clientId}`;
}

function loadDocFolders(clientId) {
  try {
    const raw = localStorage.getItem(docFoldersKey(clientId));
    if (!raw) return { folders: [], assignments: {} };
    const parsed = JSON.parse(raw);
    return {
      folders: Array.isArray(parsed.folders) ? parsed.folders : [],
      assignments: parsed.assignments && typeof parsed.assignments === "object" ? parsed.assignments : {},
    };
  } catch (e) {
    return { folders: [], assignments: {} };
  }
}

function saveDocFolders(clientId, folders, assignments) {
  try {
    localStorage.setItem(docFoldersKey(clientId), JSON.stringify({ folders, assignments }));
  } catch (e) {}
}

function DocumentsPage({ client, isBookkeeper, searchTarget }) {
  const [folders, setFolders] = useState(() => loadDocFolders(client.id).folders);
  const [docs, setDocs] = useState(() => {
    const { assignments } = loadDocFolders(client.id);
    return client.documents.map((d) => ({ ...d, folder: assignments[d.name] || null }));
  });
  const [activeFolder, setActiveFolder] = useState(null); // null = "All"
  const [addingFolder, setAddingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(null);
  const fileInputRef = useRef(null);
  const newFolderInputRef = useRef(null);
  const showToast = useToast();
  const { flashCardId, jumpToCard } = useCardFlash();

  useEffect(() => {
    if (searchTarget) jumpToCard(searchTarget.highlightKey, searchTarget.highlightKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTarget && searchTarget.nonce]);

  // Persists folder names + which folder each document is in, by name.
  // Doesn't persist the documents themselves — a fresh session still starts
  // from client.documents/newly uploaded files, same as before.
  useEffect(() => {
    const assignments = {};
    docs.forEach((d) => {
      if (d.folder) assignments[d.name] = d.folder;
    });
    saveDocFolders(client.id, folders, assignments);
  }, [client.id, folders, docs]);

  const addFiles = (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    const today = todayLocal();
    const newDocs = files.map((f) => ({
      name: f.name,
      category: "Uploaded",
      uploadedBy: "You",
      date: today,
      size: formatBytes(f.size),
      // Org-wide by default, so whoever just uploaded a file can still see it.
      // MyGoodBooks can restrict it afterwards.
      visibility: "all",
      // Kept only for real files uploaded this session, so the preview modal
      // has actual bytes to show. Pre-loaded sample documents never had a
      // real file behind them, so they fall back to a metadata-only preview.
      file: f,
      folder: activeFolder,
    }));
    setDocs((d) => [...newDocs, ...d]);
    showToast(`Uploaded ${files.length} file${files.length > 1 ? "s" : ""}.`);
  };

  const toggleVisibility = (index) => {
    setDocs((d) =>
      d.map((doc, i) =>
        i === index ? { ...doc, visibility: doc.visibility === "full" ? "all" : "full" } : doc
      )
    );
  };

  const moveDocToFolder = (index, folderName) => {
    setDocs((d) => d.map((doc, i) => (i === index ? { ...doc, folder: folderName || null } : doc)));
  };

  const addFolder = () => {
    const name = newFolderName.trim();
    if (!name) return;
    if (folders.includes(name)) {
      showToast(`"${name}" already exists.`);
      return;
    }
    setFolders((f) => [...f, name]);
    setNewFolderName("");
    setAddingFolder(false);
    setActiveFolder(name);
  };

  const [folderPendingDelete, setFolderPendingDelete] = useState(null);

  const confirmRemoveFolder = () => {
    const name = folderPendingDelete;
    setFolderPendingDelete(null);
    setFolders((f) => f.filter((x) => x !== name));
    setDocs((d) => d.map((doc) => (doc.folder === name ? { ...doc, folder: null } : doc)));
    if (activeFolder === name) setActiveFolder(null);
  };

  // "Full Access Only" filters down to the visibility flag itself
  // (toggleVisibility, above) rather than some separate "shared with me"
  // concept — this app's documents only ever carry that one binary flag
  // (org-wide vs. full-access-only), so that's the real, honest thing to
  // filter by. Only worth offering when there's at least one such document
  // to filter to — a restricted client viewer never has any (scopedClient's
  // documents are already filtered upstream), so this naturally stays
  // hidden for them.
  const [visFilter, setVisFilter] = useState("all");
  const hasRestrictedDocs = docs.some((d) => d.visibility === "full");
  const folderFiltered = activeFolder === null ? docs : docs.filter((d) => d.folder === activeFolder);
  const visibleDocs = visFilter === "full" ? folderFiltered.filter((d) => d.visibility === "full") : folderFiltered;
  const unfiledCount = docs.filter((d) => !d.folder).length;

  return (
    <div>
      <MockBanner text="Uploaded files stay in your browser for this session only — nothing is actually stored yet. Folders you create do stick around on this browser." />

      <div className="doc-folder-bar">
        <button
          type="button"
          className={"doc-folder-pill" + (activeFolder === null ? " active" : "")}
          onClick={() => setActiveFolder(null)}
        >
          <FolderIcon width="14" height="14" strokeWidth="1.8" />
          All Documents
          <span className="doc-folder-count">{docs.length}</span>
        </button>
        {folders.map((name) => {
          const count = docs.filter((d) => d.folder === name).length;
          return (
            <button
              type="button"
              key={name}
              className={"doc-folder-pill" + (activeFolder === name ? " active" : "")}
              onClick={() => setActiveFolder(name)}
            >
              <FolderIcon width="14" height="14" strokeWidth="1.8" />
              {name}
              <span className="doc-folder-count">{count}</span>
              <span
                className="doc-folder-remove"
                role="button"
                tabIndex={0}
                aria-label={`Delete folder ${name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setFolderPendingDelete(name);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.stopPropagation();
                    setFolderPendingDelete(name);
                  }
                }}
              >
                ×
              </span>
            </button>
          );
        })}
        {addingFolder ? (
          <span className="doc-folder-new">
            <input
              ref={newFolderInputRef}
              type="text"
              placeholder="Folder name"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addFolder();
                if (e.key === "Escape") {
                  setAddingFolder(false);
                  setNewFolderName("");
                }
              }}
              autoFocus
            />
            <button type="button" className="btn-secondary" onClick={addFolder}>
              Add
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="doc-folder-pill doc-folder-add-trigger"
            onClick={() => setAddingFolder(true)}
          >
            + New Folder
          </button>
        )}
      </div>

      <div
        className={"card upload-card dropzone" + (isDragging ? " dragging" : "")}
        style={{ marginBottom: 20 }}
        onClick={() => fileInputRef.current.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          addFiles(e.dataTransfer.files);
        }}
      >
        <svg className="dropzone-border" preserveAspectRatio="none">
          <rect x="1" y="1" rx="19" ry="19" />
        </svg>
        <div className="upload-content">
          <div className="dropzone-icon">
            <UploadIcon width="22" height="22" strokeWidth="1.6" />
          </div>
          <div>
            <h3 className="card-title">Share a document</h3>
            <p className="card-subtitle" style={{ margin: 0 }}>
              Drag and drop files here, or click to browse. Receipts, statements, or anything your bookkeeper should see.
            </p>
          </div>
        </div>
        <button
          className="btn-primary"
          onClick={(e) => {
            e.stopPropagation();
            fileInputRef.current.click();
          }}
        >
          Upload Document
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: "none" }}
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      <div className="card">
        <div className="page-header" style={{ marginBottom: 4 }}>
          <div>
            <h3 className="card-title">{activeFolder === null ? "All Documents" : activeFolder}</h3>
            <p className="card-subtitle" style={{ margin: 0 }}>
              {visibleDocs.length} file{visibleDocs.length !== 1 ? "s" : ""} · click a document to preview it
            </p>
          </div>
          {hasRestrictedDocs && (
            <div className="view-toggle">
              <button
                type="button"
                className={"view-toggle-btn" + (visFilter === "all" ? " active" : "")}
                onClick={() => setVisFilter("all")}
              >
                All Documents
              </button>
              <button
                type="button"
                className={"view-toggle-btn" + (visFilter === "full" ? " active" : "")}
                onClick={() => setVisFilter("full")}
              >
                Full Access Only
              </button>
            </div>
          )}
        </div>
        <div className="table-scroll">
<table className="tx-table tx-table-labeled">
          <thead>
            <tr>
              <th>Name</th>
              <th>Category</th>
              <th>Uploaded By</th>
              <th>Date</th>
              <th>Folder</th>
              {isBookkeeper && <th>Visible To</th>}
              <th className="num">Size</th>
            </tr>
          </thead>
          <tbody>
            {visibleDocs.map((d) => {
              const i = docs.indexOf(d);
              const rowId = "doc-row-" + slugify(d.name);
              return (
              <tr key={d.name + i} id={rowId} className={"doc-row" + (flashCardId === rowId ? " row-flash" : "")} onClick={() => setPreviewIndex(i)} tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter") setPreviewIndex(i); }}>
                <td data-primary="">
                  <span className="doc-name-link">
                    <FileIcon width="15" height="15" strokeWidth="1.7" className="icon-inline" />
                    {d.name}
                  </span>
                </td>
                <td data-label="Category">
                  <span className="category-tag">{d.category}</span>
                </td>
                <td data-label="Uploaded by">{d.uploadedBy}</td>
                <td data-label="Date">{fmtDate(d.date)}</td>
                <td data-label="Folder">
                  <select
                    className="doc-folder-select"
                    value={d.folder || ""}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => moveDocToFolder(i, e.target.value)}
                  >
                    <option value="">Unfiled</option>
                    {folders.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </td>
                {isBookkeeper && (
                  <td data-label="Visible to">
                    <button
                      className={"visibility-toggle" + (d.visibility === "full" ? " restricted" : "")}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleVisibility(i);
                      }}
                      title="Click to change who at this organization can see this file"
                    >
                      {d.visibility === "full" ? (
                        <React.Fragment>
                          <LockIcon /> Full access only
                        </React.Fragment>
                      ) : (
                        "Everyone"
                      )}
                    </button>
                  </td>
                )}
                <td className="num" data-label="Size">{d.size}</td>
              </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </div>

      {previewIndex !== null && docs[previewIndex] && (
        <DocumentPreviewModal doc={docs[previewIndex]} onClose={() => setPreviewIndex(null)} />
      )}

      {folderPendingDelete && (
        <ConfirmModal
          title={`Delete "${folderPendingDelete}"?`}
          body="Its documents move back to Unfiled — nothing is deleted."
          confirmLabel="Delete folder"
          onConfirm={confirmRemoveFolder}
          onCancel={() => setFolderPendingDelete(null)}
        />
      )}
    </div>
  );
}

// File extensions we know how to render inline. Anything else — real upload
// or sample document alike — falls back to the metadata-only preview panel
// rather than guessing at a MIME type from the extension.
const PREVIEWABLE_IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg)$/i;
const PREVIEWABLE_PDF_EXT = /\.pdf$/i;

function docExtension(name) {
  const match = /\.([a-z0-9]+)$/i.exec(name || "");
  return match ? match[1].toUpperCase() : "FILE";
}

function DocumentPreviewModal({ doc, onClose }) {
  const objectUrl = useMemo(() => (doc.file ? URL.createObjectURL(doc.file) : null), [doc.file]);
  useEffect(() => () => { if (objectUrl) URL.revokeObjectURL(objectUrl); }, [objectUrl]);

  const isImage = PREVIEWABLE_IMAGE_EXT.test(doc.name);
  const isPdf = PREVIEWABLE_PDF_EXT.test(doc.name);

  return (
    <ModalShell onClose={onClose} labelledBy="doc-preview-title" className="doc-preview-modal">
      <div className="modal-header">
        <h3 className="card-title" id="doc-preview-title" style={{ margin: 0 }}>
          <FileIcon width="17" height="17" strokeWidth="1.7" className="icon-inline" />
          {doc.name}
        </h3>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      <div className="modal-body doc-preview-body">
        {objectUrl && isImage && (
          <img src={objectUrl} alt={doc.name} className="doc-preview-image" />
        )}
        {objectUrl && isPdf && (
          <iframe src={objectUrl} title={doc.name} className="doc-preview-frame" />
        )}
        {!objectUrl && (
          <div className="doc-preview-placeholder">
            <FileIcon width="40" height="40" strokeWidth="1.3" />
            <p className="card-subtitle" style={{ margin: "10px 0 0", textAlign: "center" }}>
              {doc.file
                ? `Preview isn't available for .${docExtension(doc.name).toLowerCase()} files yet — download to open it.`
                : "This is sample data — there's no real file behind it to preview yet."}
            </p>
          </div>
        )}
        {objectUrl && !isImage && !isPdf && (
          <div className="doc-preview-placeholder">
            <FileIcon width="40" height="40" strokeWidth="1.3" />
            <p className="card-subtitle" style={{ margin: "10px 0 0", textAlign: "center" }}>
              Preview isn't available for .{docExtension(doc.name).toLowerCase()} files yet — download to open it.
            </p>
          </div>
        )}
      </div>

      <div className="modal-footer doc-preview-footer">
        <div className="doc-preview-meta">
          <span className="category-tag">{doc.category}</span>
          <span>{doc.uploadedBy}</span>
          <span>{fmtDate(doc.date)}</span>
          <span>{doc.size}</span>
        </div>
        <div className="doc-preview-actions">
          {objectUrl && (
            <a className="btn-secondary" href={objectUrl} download={doc.name}>
              Download
            </a>
          )}
          <button className="btn-primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

// ----------------------------------------------------------------------------
// Floating "you have unread messages" indicator — a plain round tap target
// that jumps straight to the real Messages page, used on every screen size.
// A fixed-position floating mini-thread (this used to be desktop-only,
// `ChatWidget`) fought the on-screen keyboard on mobile, but it wasn't much
// better on desktop either — a 3-message preview isn't very useful when the
// real Messages page is one click away regardless, so this is now the only
// form the unread indicator takes anywhere.
// ----------------------------------------------------------------------------

function ChatFab({ unreadCount, onOpen, onDismiss }) {
  return (
    <div className="chat-fab-wrap">
      <button className="chat-fab" onClick={onOpen} aria-label="Open messages">
        <ChatIcon width="22" height="22" strokeWidth="1.6" />
        {unreadCount > 0 && <span className="chat-fab-badge">{unreadCount}</span>}
      </button>
      <button className="chat-fab-dismiss" onClick={onDismiss} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Messages page
// ----------------------------------------------------------------------------

function MessagesPage({ client, messages, onSend, users, activeUserId, onSelectUser, unreadUserIds, isBookkeeper, searchTarget, bookkeeperTyping }) {
  const [draft, setDraft] = useState("");
  const [pendingAttachment, setPendingAttachment] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);
  const { flashCardId, jumpToCard } = useCardFlash();

  // Search only ever looks within the currently-open thread (see
  // GlobalSearch), so there's no other person's conversation to switch to
  // first — just scroll to and flash the matching bubble.
  useEffect(() => {
    if (searchTarget) jumpToCard(searchTarget.highlightKey, searchTarget.highlightKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTarget && searchTarget.nonce]);

  const stageFile = (file) => {
    if (!file) return;
    setPendingAttachment({ name: file.name, size: formatBytes(file.size) });
  };

  const send = () => {
    if (!draft.trim() && !pendingAttachment) return;
    onSend(draft.trim(), pendingAttachment || undefined);
    setDraft("");
    setPendingAttachment(null);
  };

  const activeUser = (users || []).find((u) => u.id === activeUserId);

  return (
    <div>
      <MockBanner text="This is a sample conversation — sending a message here doesn't notify anyone yet." />

      {/* Each person has a private thread, so in bookkeeper view MyGoodBooks
          picks whose conversation to open. Clients never see this. */}
      {isBookkeeper && users && users.length > 0 && (
        <div className="thread-picker">
          <span className="thread-picker-label">Conversation with</span>
          <div className="thread-picker-tabs">
            {users.map((u) => (
              <button
                key={u.id}
                className={"thread-tab" + (u.id === activeUserId ? " active" : "")}
                onClick={() => onSelectUser(u.id)}
              >
                <span className="thread-tab-name">{u.name}</span>
                <span className="thread-tab-role">{u.role}</span>
                {(unreadUserIds || []).includes(u.id) && <span className="thread-tab-dot" />}
              </button>
            ))}
          </div>
        </div>
      )}

      <div
        className={"card message-card" + (isDragging ? " dragging" : "")}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          stageFile(e.dataTransfer.files && e.dataTransfer.files[0]);
        }}
      >
        <h3 className="card-title">
          {isBookkeeper && activeUser
            ? `Conversation with ${activeUser.name}`
            : client && client.assignedBookkeeper
              ? (
                <>
                  Conversation with {client.assignedBookkeeper.name}
                  <span className="online-dot" title="Online now" />
                </>
              )
              : "Conversation with MyGoodBooks"}
        </h3>
        {messages.length === 0 && (
          <p className="card-subtitle">No messages yet in this conversation.</p>
        )}
        <div className="message-thread">
          {messages.map((m, i) => {
            const rowId = "msg-" + i;
            return (
            <div className={"message-bubble-row " + m.from} id={rowId} key={i}>
              <div className={"message-bubble" + (flashCardId === rowId ? " row-flash" : "")}>
                <div className="message-author">
                  {m.from === "bookkeeper" && client && client.assignedBookkeeper
                    ? client.assignedBookkeeper.name
                    : m.author}
                </div>
                {m.text && <div className="message-text">{m.text}</div>}
                {m.attachment && (
                  <div className="message-attachment">
                    <PaperclipIcon /> {m.attachment.name}{" "}
                    <span className="message-attachment-size">({m.attachment.size})</span>
                  </div>
                )}
                <div className="message-date">{fmtDate(m.date)}</div>
              </div>
            </div>
            );
          })}
        </div>

        {pendingAttachment && (
          <div className="attachment-chip">
            <span>
              <PaperclipIcon /> {pendingAttachment.name}
            </span>
            <span className="attachment-chip-meta">{pendingAttachment.size}</span>
            <button className="attachment-remove" onClick={() => setPendingAttachment(null)} aria-label="Remove attachment">
              ×
            </button>
          </div>
        )}

        <div className="typing-indicator">
          {!isBookkeeper && bookkeeperTyping && client && client.assignedBookkeeper
            ? `${client.assignedBookkeeper.name} is typing…`
            : " "}
        </div>
        <div className="message-compose">
          <button type="button" className="attach-btn" onClick={() => fileInputRef.current.click()} aria-label="Attach file">
            <PaperclipIcon />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            style={{ display: "none" }}
            onChange={(e) => {
              stageFile(e.target.files && e.target.files[0]);
              e.target.value = "";
            }}
          />
          <input
            type="text"
            placeholder="Type a message…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") send();
            }}
          />
          <button className="btn-primary" onClick={send}>
            Send
          </button>
        </div>

        {isDragging && <div className="message-drop-overlay">Drop file to attach</div>}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Access Request Form — public, no login (see supabase/access-requests.sql).
// A client's admin uses this to specify exactly what each of their staff
// should see, without needing a MyGoodBooks account of their own. Reached by
// its own query param (see the ReactDOM.createRoot call at the bottom of
// this file), entirely outside AuthGate/App. A bookkeeper reads the
// submission back in Manage Access -> Requests and applies it by hand — see
// that SQL file's header for why this doesn't auto-apply.
// ----------------------------------------------------------------------------

function emptyAccessRequestPerson() {
  return { name: "", email: "", role: "", access: "full", tabs: [], categories: [] };
}

function AccessRequestForm({ token }) {
  const supabase = window.mgbSupabase;
  // "loading" | "invalid" | "ready" | "submitting" | "done"
  const [status, setStatus] = useState("loading");
  const [client, setClient] = useState(null);
  const [submitterName, setSubmitterName] = useState("");
  const [submitterEmail, setSubmitterEmail] = useState("");
  const [people, setPeople] = useState([emptyAccessRequestPerson()]);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (!supabase) {
      setErrorMsg("This portal isn't configured yet.");
      setStatus("invalid");
      return;
    }
    supabase
      .from("access_request_links")
      .select("client_id, active")
      .eq("token", token)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error || !data || !data.active) {
          setStatus("invalid");
          return;
        }
        const c = CLIENTS.find((c) => c.id === data.client_id);
        if (!c) {
          setStatus("invalid");
          return;
        }
        setClient(c);
        setStatus("ready");
      });
  }, [token, supabase]);

  const requestableTabs = NAV_SECTIONS.flatMap((s) => s.items).filter((i) => i.key !== ALWAYS_VISIBLE_KEY);

  function updatePerson(i, patch) {
    setPeople((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  }
  function toggleTab(i, key) {
    setPeople((prev) =>
      prev.map((p, idx) => {
        if (idx !== i) return p;
        const set = new Set(p.tabs);
        if (set.has(key)) set.delete(key);
        else set.add(key);
        return { ...p, tabs: Array.from(set) };
      })
    );
  }
  function toggleCategory(i, cat) {
    setPeople((prev) =>
      prev.map((p, idx) => {
        if (idx !== i) return p;
        const set = new Set(p.categories);
        if (set.has(cat)) set.delete(cat);
        else set.add(cat);
        return { ...p, categories: Array.from(set) };
      })
    );
  }

  async function submit() {
    setStatus("submitting");
    const { error } = await supabase.from("access_requests").insert({
      client_id: client.id,
      token,
      submitted_by_name: submitterName.trim(),
      submitted_by_email: submitterEmail.trim(),
      people: people.map((p) => ({
        name: p.name.trim(),
        email: p.email.trim(),
        role: p.role.trim(),
        access: p.access,
        tabs: p.access === "full" ? null : p.tabs,
        categories: p.access === "full" ? null : p.categories,
      })),
    });
    if (error) {
      setErrorMsg("Couldn't submit — " + error.message);
      setStatus("ready");
      return;
    }
    setStatus("done");
  }

  const canSubmit =
    submitterName.trim() &&
    submitterEmail.trim() &&
    people.length > 0 &&
    people.every((p) => p.name.trim() && p.email.trim() && p.role.trim());

  if (status === "loading") {
    return (
      <div className="boot-splash" role="status" aria-live="polite">
        <div className="boot-splash-mark">MyGoodBooks</div>
        <div className="boot-splash-sub">Loading the access form…</div>
      </div>
    );
  }

  if (status === "invalid") {
    return (
      <div className="boot-splash" role="alert">
        <div className="boot-splash-mark">MyGoodBooks</div>
        <div className="boot-splash-sub">
          {errorMsg || "This form link isn't active anymore. Ask your bookkeeper for a new one."}
        </div>
      </div>
    );
  }

  if (status === "done") {
    return (
      <div className="boot-splash" role="status">
        <div className="boot-splash-mark">MyGoodBooks</div>
        <div className="boot-splash-sub">
          Thanks — we've received your access request for {client.name}. Your bookkeeper will set
          this up and follow up if anything's unclear.
        </div>
      </div>
    );
  }

  return (
    <div className="access-form-page">
      <div className="access-form-header">
        <span className="access-form-brand">MyGoodBooks</span>
        <span className="access-form-title">Staff Access Request — {client.name}</span>
      </div>
      <div className="access-form-body">
        <div className="card">
          <h3 className="card-title">Your info</h3>
          <p className="card-subtitle">Who's filling this out, in case we have questions.</p>
          <div className="access-form-row">
            <input
              type="text"
              placeholder="Your name"
              value={submitterName}
              onChange={(e) => setSubmitterName(e.target.value)}
            />
            <input
              type="email"
              placeholder="Your email"
              value={submitterEmail}
              onChange={(e) => setSubmitterEmail(e.target.value)}
            />
          </div>
        </div>

        {people.map((p, i) => (
          <div className="card" key={i}>
            <div className="access-form-person-header">
              <h3 className="card-title">Person {i + 1}</h3>
              {people.length > 1 && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setPeople((prev) => prev.filter((_, idx) => idx !== i))}
                >
                  Remove
                </button>
              )}
            </div>
            <div className="access-form-row">
              <input
                type="text"
                placeholder="Full name"
                value={p.name}
                onChange={(e) => updatePerson(i, { name: e.target.value })}
              />
              <input
                type="email"
                placeholder="Email"
                value={p.email}
                onChange={(e) => updatePerson(i, { email: e.target.value })}
              />
              <input
                type="text"
                placeholder="Role (e.g. Board Treasurer)"
                value={p.role}
                onChange={(e) => updatePerson(i, { role: e.target.value })}
              />
            </div>

            <div className="access-level-toggle" style={{ marginTop: 14 }}>
              <button
                type="button"
                className={"access-level-btn" + (p.access === "full" ? " active" : "")}
                onClick={() => updatePerson(i, { access: "full" })}
              >
                Full access
                <span>Sees all of {client.name}'s finances</span>
              </button>
              <button
                type="button"
                className={"access-level-btn" + (p.access !== "full" ? " active" : "")}
                onClick={() => updatePerson(i, { access: "scoped" })}
              >
                Limited access
                <span>Only the areas you choose below</span>
              </button>
            </div>

            {p.access !== "full" && (
              <div className="modal-body" style={{ padding: "16px 0 0" }}>
                <div className="modal-section">
                  <div className="nav-section-label modal-section-label">Pages they should see</div>
                  {requestableTabs.map((item) => (
                    <label className="tab-toggle-row" key={item.key}>
                      <input
                        type="checkbox"
                        checked={p.tabs.includes(item.key)}
                        onChange={() => toggleTab(i, item.key)}
                      />
                      <span>{item.label}</span>
                    </label>
                  ))}
                </div>
                <div className="modal-section">
                  <div className="nav-section-label modal-section-label">Budget areas they should see</div>
                  <p className="card-subtitle" style={{ marginTop: 0, marginBottom: 8 }}>
                    Leave all unchecked to give them every category.
                  </p>
                  {(client.budget || []).map((b) => (
                    <label className="tab-toggle-row" key={b.category}>
                      <input
                        type="checkbox"
                        checked={p.categories.includes(b.category)}
                        onChange={() => toggleCategory(i, b.category)}
                      />
                      <span>{b.category}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}

        <button
          type="button"
          className="btn-secondary"
          onClick={() => setPeople((prev) => [...prev, emptyAccessRequestPerson()])}
        >
          + Add another person
        </button>

        {errorMsg && (
          <p className="card-subtitle" style={{ color: "var(--bad)" }}>
            {errorMsg}
          </p>
        )}

        <button
          type="button"
          className="btn-primary access-form-submit"
          disabled={!canSubmit || status === "submitting"}
          onClick={submit}
        >
          {status === "submitting" ? "Submitting…" : "Submit access request"}
        </button>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Access management (bookkeeper-side only). Two levels: which tabs the whole
// organization gets, and what each named person at that org may see.
// ----------------------------------------------------------------------------

function UserAccessEditor({
  client,
  user,
  orgAllowedKeys,
  userAccess,
  onToggleUserTab,
  onToggleUserCategory,
  onToggleUserFund,
  onSetAccessLevel,
  onToggleUserPremium,
  onBack,
}) {
  const isFull = user.access === "full";
  const effective = userAccess[user.id] || {};
  const userTabs = new Set(effective.tabs || user.tabs || orgAllowedKeys);
  const userCats = new Set(effective.categories || user.categories || []);
  const isCategoryScoped = Boolean(effective.categories || user.categories);
  const userFunds = new Set(effective.funds || user.funds || []);
  const isPremiumClient = hasPremiumPlan(client);
  const premiumThrottled = "premiumThrottled" in effective ? effective.premiumThrottled : Boolean(user.premiumThrottled);

  return (
    <React.Fragment>
      <div className="modal-header">
        <button className="modal-back" onClick={onBack} aria-label="Back to people">
          ‹
        </button>
        <div style={{ flex: 1 }}>
          <h3 className="card-title" id="user-access-editor-title" style={{ margin: 0 }}>{user.name}</h3>
          <p className="card-subtitle" style={{ margin: 0 }}>{user.role} · {user.email}</p>
        </div>
      </div>

      <div className="access-level-toggle">
        <button
          className={"access-level-btn" + (isFull ? " active" : "")}
          onClick={() => onSetAccessLevel(user.id, "full")}
        >
          Full access
          <span>Sees all of {client.name}'s finances</span>
        </button>
        <button
          className={"access-level-btn" + (!isFull ? " active" : "")}
          onClick={() => onSetAccessLevel(user.id, "scoped")}
        >
          Limited access
          <span>Only the areas you choose below</span>
        </button>
      </div>

      {isPremiumClient && (
        <div className="access-level-toggle" style={{ marginTop: 12 }}>
          <button
            className={"access-level-btn" + (!premiumThrottled ? " active" : "")}
            onClick={() => premiumThrottled && onToggleUserPremium(user.id)}
          >
            Premium features on
            <span>Sees the Pro tools {client.name} is subscribed to</span>
          </button>
          <button
            className={"access-level-btn" + (premiumThrottled ? " active" : "")}
            onClick={() => !premiumThrottled && onToggleUserPremium(user.id)}
          >
            Premium features throttled
            <span>Standard experience, even though {client.name} has Premium</span>
          </button>
        </div>
      )}

      {!isFull && (
        <div className="modal-body">
          <div className="modal-section">
            <div className="nav-section-label modal-section-label">Pages they can open</div>
            {NAV_SECTIONS.flatMap((s) => s.items)
              .filter((item) => orgAllowedKeys.includes(item.key))
              .map((item) => {
                const locked = item.key === ALWAYS_VISIBLE_KEY;
                const blockedByScope = isCategoryScoped && ORG_WIDE_TABS.has(item.key);
                return (
                  <label
                    className={"tab-toggle-row" + (locked || blockedByScope ? " locked" : "")}
                    key={item.key}
                  >
                    <input
                      type="checkbox"
                      checked={(userTabs.has(item.key) || locked) && !blockedByScope}
                      disabled={locked || blockedByScope}
                      onChange={() => onToggleUserTab(user.id, item.key)}
                    />
                    <span>{item.label}</span>
                    {locked && <span className="tab-toggle-note">Always visible</span>}
                    {blockedByScope && <span className="tab-toggle-note">Org-wide only</span>}
                  </label>
                );
              })}
          </div>

          <div className="modal-section">
            <div className="nav-section-label modal-section-label">Budget areas they can see</div>
            <p className="card-subtitle" style={{ marginTop: 0, marginBottom: 8 }}>
              Leave all unchecked to give them every category.
            </p>
            {client.budget.map((b) => (
              <label className="tab-toggle-row" key={b.category}>
                <input
                  type="checkbox"
                  checked={userCats.has(b.category)}
                  onChange={() => onToggleUserCategory(user.id, b.category)}
                />
                <span>{b.category}</span>
              </label>
            ))}
          </div>

          {isCategoryScoped && (
            <div className="modal-section">
              <div className="nav-section-label modal-section-label">Funds they can see</div>
              <p className="card-subtitle" style={{ marginTop: 0, marginBottom: 8 }}>
                Their dashboard never shows the org-wide fund total — leave all unchecked to hide the Funds widget
                for them entirely, rather than showing every fund by default.
              </p>
              {(client.funds || []).map((f) => (
                <label className="tab-toggle-row" key={f.name}>
                  <input
                    type="checkbox"
                    checked={userFunds.has(f.name)}
                    onChange={() => onToggleUserFund(user.id, f.name)}
                  />
                  <span>{f.name}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      {isFull && (
        <div className="modal-body">
          <p className="card-subtitle">
            {user.name} sees every page and every category for {client.name}, the same view you get previewing as
            MyGoodBooks.
          </p>
        </div>
      )}
    </React.Fragment>
  );
}

// Shared chrome for every modal in the app. Previously each one rendered a bare
// overlay div: Escape did nothing, focus stayed on whatever was behind the
// dialog, Tab walked the page underneath, and screen readers announced no
// dialog at all. Anything that puts a modal on screen should go through here.
// A branded stand-in for window.confirm() — the browser's own confirm()
// dialog is chrome-owned and prefixes itself with the page's domain (e.g.
// "example.com says"), which reads wrong for an app clients use under a
// custom brand. This renders as an ordinary in-app modal instead, so it
// carries no browser-domain text at all.
function ConfirmModal({ title, body, confirmLabel = "Confirm", onConfirm, onCancel }) {
  return (
    <ModalShell onClose={onCancel} labelledBy="confirm-modal-title" className="confirm-modal">
      <div className="modal-header">
        <h3 className="card-title" id="confirm-modal-title" style={{ margin: 0 }}>
          {title}
        </h3>
        <button className="modal-close" onClick={onCancel} aria-label="Close">
          ×
        </button>
      </div>
      <div className="modal-body">
        <p className="card-subtitle" style={{ margin: 0 }}>
          {body}
        </p>
      </div>
      <div className="modal-footer">
        <button className="btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="btn-primary"
          onClick={() => {
            onConfirm();
          }}
        >
          {confirmLabel}
        </button>
      </div>
    </ModalShell>
  );
}

function ModalShell({ onClose, labelledBy, className = "", children }) {
  const panelRef = useRef(null);
  const restoreFocusRef = useRef(null);
  // Read the latest onClose without it being an effect dependency — a modal
  // whose OWN invoking component also owns fast-changing state (e.g. a
  // textarea inside it) passes a new inline `onClose` identity on every
  // keystroke; depending on it here would re-run this effect that often,
  // and its cleanup restores focus to whatever was focused before the modal
  // opened, kicking the caret out after every single character typed.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const panel = panelRef.current;
    restoreFocusRef.current = document.activeElement;

    const focusables = () =>
      [...panel.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(
        (el) => !el.disabled && el.offsetParent !== null
      );

    // Land the caret inside the dialog rather than leaving it behind the scrim.
    const first = focusables()[0];
    (first || panel).focus();

    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (!items.length) return;
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      // Wrap at both ends so Tab can't walk out into the page behind.
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      const prev = restoreFocusRef.current;
      if (prev && typeof prev.focus === "function") prev.focus();
    };
    // Deliberately mount/unmount only (see onCloseRef above) — this must NOT
    // re-run on every render, or the cleanup's focus-restore fires on every
    // keystroke in a text field elsewhere in the modal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className={"modal-panel" + (className ? " " + className : "")}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

function TabSettingsModal({
  client,
  visibleKeys,
  tabOrder,
  userAccess,
  onToggle,
  onReorder,
  onToggleUserTab,
  onToggleUserCategory,
  onToggleUserFund,
  onSetAccessLevel,
  onToggleUserPremium,
  staffUser,
  onClose,
}) {
  const [draggedKey, setDraggedKey] = useState(null);
  const [dragOverKey, setDragOverKey] = useState(null);
  const [editingUserId, setEditingUserId] = useState(null);
  const [tab, setTab] = useState("people");
  const [activeLink, setActiveLink] = useState(undefined); // undefined = loading, null = none
  const [requests, setRequests] = useState([]);
  const [generatingLink, setGeneratingLink] = useState(false);
  const [copied, setCopied] = useState(false);
  const [documents, setDocuments] = useState(undefined); // undefined = loading
  const [newDocName, setNewDocName] = useState("");
  const [newDocUrl, setNewDocUrl] = useState("");
  const [addingDoc, setAddingDoc] = useState(false);
  const [qboConnection, setQboConnection] = useState(undefined); // undefined = loading
  const showToast = useToast();

  const supabase = window.mgbSupabase;

  const loadQboConnection = useCallback(() => {
    if (!supabase) return;
    supabase
      .from("qbo_connections")
      .select("client_id, status, connected_at, last_synced_at, last_error")
      .eq("client_id", client.id)
      .maybeSingle()
      .then(({ data }) => setQboConnection(data || null));
  }, [supabase, client.id]);

  useEffect(() => {
    if (tab === "quickbooks") loadQboConnection();
  }, [tab, loadQboConnection]);

  function connectQuickBooks() {
    // Stub: the Intuit Developer app (client ID/secret) isn't provisioned
    // yet, so there's no OAuth redirect to send this to. Once it exists,
    // this becomes window.location.href = `${QBO_AUTH_URL}?client_id=...`
    // and an Edge Function handles the callback + token exchange.
    showToast("QuickBooks connection isn't set up yet — needs an Intuit Developer app first.");
  }

  const loadDocuments = useCallback(() => {
    if (!supabase) return;
    supabase
      .from("client_documents")
      .select("id, name, drive_url, category, created_at")
      .eq("client_id", client.id)
      .order("created_at", { ascending: false })
      .then(({ data }) => setDocuments(data || []));
  }, [supabase, client.id]);

  useEffect(() => {
    if (tab === "documents") loadDocuments();
  }, [tab, loadDocuments]);

  async function addDocument(e) {
    e.preventDefault();
    if (!supabase || !newDocName.trim() || !newDocUrl.trim()) return;
    setAddingDoc(true);
    const { error } = await supabase.from("client_documents").insert({
      client_id: client.id,
      name: newDocName.trim(),
      drive_url: newDocUrl.trim(),
      added_by: staffUser && staffUser.email,
    });
    setAddingDoc(false);
    if (error) {
      showToast("Couldn't add that document: " + error.message);
      return;
    }
    setNewDocName("");
    setNewDocUrl("");
    loadDocuments();
  }

  async function removeDocument(id) {
    await supabase.from("client_documents").delete().eq("id", id);
    loadDocuments();
  }

  const loadRequestsTab = useCallback(() => {
    if (!supabase) return;
    supabase
      .from("access_request_links")
      .select("token, active, created_at")
      .eq("client_id", client.id)
      .eq("active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => setActiveLink(data || null));
    supabase
      .from("access_requests")
      .select("id, submitted_by_name, submitted_by_email, submitted_at, people, reviewed")
      .eq("client_id", client.id)
      .order("submitted_at", { ascending: false })
      .then(({ data }) => setRequests(data || []));
  }, [supabase, client.id]);

  useEffect(() => {
    if (tab === "requests") loadRequestsTab();
  }, [tab, loadRequestsTab]);

  async function generateLink() {
    if (!supabase) return;
    setGeneratingLink(true);
    if (activeLink) {
      await supabase.from("access_request_links").update({ active: false }).eq("token", activeLink.token);
    }
    const token = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)).replace(/-/g, "");
    const { error } = await supabase
      .from("access_request_links")
      .insert({ token, client_id: client.id, created_by: staffUser && staffUser.email });
    setGeneratingLink(false);
    if (error) {
      showToast("Couldn't generate a link: " + error.message);
      return;
    }
    loadRequestsTab();
  }

  async function markReviewed(id, reviewed) {
    await supabase.from("access_requests").update({ reviewed }).eq("id", id);
    loadRequestsTab();
  }

  function copyLink() {
    if (!activeLink) return;
    const url = `${window.location.origin}${window.location.pathname}?access-form=${activeLink.token}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const orgAllowedKeys = ALL_TAB_KEYS.filter((k) => visibleKeys.has(k));
  const editingUser = editingUserId ? (client.users || []).find((u) => u.id === editingUserId) : null;

  if (editingUser) {
    return (
      <ModalShell onClose={onClose} labelledBy="user-access-editor-title">
          <UserAccessEditor
            client={client}
            user={editingUser}
            orgAllowedKeys={orgAllowedKeys}
            userAccess={userAccess}
            onToggleUserTab={onToggleUserTab}
            onToggleUserCategory={onToggleUserCategory}
            onToggleUserFund={onToggleUserFund}
            onSetAccessLevel={onSetAccessLevel}
            onToggleUserPremium={onToggleUserPremium}
            onBack={() => setEditingUserId(null)}
          />
          <div className="modal-footer">
            <button className="btn-primary" onClick={onClose}>
              Done
            </button>
          </div>
      </ModalShell>
    );
  }

  return (
    <ModalShell onClose={onClose} labelledBy="manage-access-title">
        <div className="modal-header">
          <h3 className="card-title" id="manage-access-title" style={{ margin: 0 }}>Manage access</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <p className="card-subtitle">{client.name}</p>

        <div className="modal-tabs">
          <button className={"modal-tab" + (tab === "people" ? " active" : "")} onClick={() => setTab("people")}>
            People
          </button>
          <button className={"modal-tab" + (tab === "org" ? " active" : "")} onClick={() => setTab("org")}>
            Organization tabs
          </button>
          <button className={"modal-tab" + (tab === "requests" ? " active" : "")} onClick={() => setTab("requests")}>
            Requests
            {requests.some((r) => !r.reviewed) && <span className="thread-tab-dot" />}
          </button>
          <button className={"modal-tab" + (tab === "documents" ? " active" : "")} onClick={() => setTab("documents")}>
            Documents
          </button>
          <button className={"modal-tab" + (tab === "quickbooks" ? " active" : "")} onClick={() => setTab("quickbooks")}>
            QuickBooks
          </button>
        </div>

        {tab === "people" && (
          <div className="modal-body">
            <p className="card-subtitle" style={{ marginTop: 0 }}>
              Only MyGoodBooks can change these. Nobody at {client.name} can widen their own access.
            </p>
            {(client.users || []).map((u) => {
              const eff = userAccess[u.id] || {};
              const cats = eff.categories || u.categories;
              const throttled = "premiumThrottled" in eff ? eff.premiumThrottled : u.premiumThrottled;
              return (
                <button className="person-row" key={u.id} onClick={() => setEditingUserId(u.id)}>
                  <div className="person-avatar">
                    {u.name.split(" ").map((p) => p[0]).slice(0, 2).join("")}
                  </div>
                  <div className="person-text">
                    <span className="person-name">{u.name}</span>
                    <span className="person-role">{u.role}</span>
                  </div>
                  {hasPremiumPlan(client) && (
                    <span className={"pill " + (throttled ? "restricted" : "unrestricted")}>
                      {throttled ? "Premium throttled" : "Premium"}
                    </span>
                  )}
                  <span className={"pill " + (u.access === "full" ? "unrestricted" : "restricted")}>
                    {u.access === "full" ? "Full access" : cats ? `${cats.length} area${cats.length === 1 ? "" : "s"}` : "Limited"}
                  </span>
                  <span className="person-chevron">›</span>
                </button>
              );
            })}
          </div>
        )}

        {tab === "org" && (
          <div className="modal-body">
            <p className="card-subtitle" style={{ marginTop: 0 }}>
              Turn a tab off here and nobody at {client.name} sees it, whatever their individual access. Drag ⠿ to
              reorder.
            </p>
            {NAV_SECTIONS.map((section) => {
              const items = orderedSectionItems(section, tabOrder, client.id);
              return (
                <div className="modal-section" key={section.label}>
                  <div className="nav-section-label modal-section-label">{section.label}</div>
                  {items.map((item) => {
                    const locked = item.key === ALWAYS_VISIBLE_KEY;
                    const checked = visibleKeys.has(item.key);
                    return (
                      <div
                        key={item.key}
                        className={
                          "tab-toggle-row" +
                          (locked ? " locked" : "") +
                          (dragOverKey === item.key && draggedKey !== item.key ? " drag-over" : "")
                        }
                        draggable={!locked}
                        onDragStart={() => setDraggedKey(item.key)}
                        onDragOver={(e) => {
                          e.preventDefault();
                          if (!locked) setDragOverKey(item.key);
                        }}
                        onDragLeave={() => setDragOverKey((k) => (k === item.key ? null : k))}
                        onDrop={(e) => {
                          e.preventDefault();
                          if (draggedKey && draggedKey !== item.key && !locked) {
                            onReorder(section.label, draggedKey, item.key);
                          }
                          setDraggedKey(null);
                          setDragOverKey(null);
                        }}
                        onDragEnd={() => {
                          setDraggedKey(null);
                          setDragOverKey(null);
                        }}
                      >
                        <span className={"drag-handle" + (locked ? " disabled" : "")}>{locked ? "" : "⠿"}</span>
                        <label className="tab-toggle-label">
                          <input type="checkbox" checked={checked} disabled={locked} onChange={() => onToggle(item.key)} />
                          <span>{item.label}</span>
                        </label>
                        {locked && <span className="tab-toggle-note">Always visible</span>}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}

        {tab === "requests" && (
          <div className="modal-body">
            <p className="card-subtitle" style={{ marginTop: 0 }}>
              Send {client.name} a link to specify each person's access themselves. Applying a
              request still has to be done by hand in the People tab above — nothing here changes
              anyone's access on its own.
            </p>

            <div className="modal-section">
              {activeLink === undefined ? (
                <p className="card-subtitle">Loading…</p>
              ) : activeLink ? (
                <div className="access-link-row">
                  <input
                    type="text"
                    readOnly
                    value={`${window.location.origin}${window.location.pathname}?access-form=${activeLink.token}`}
                    onFocus={(e) => e.target.select()}
                  />
                  <button className="btn-secondary" onClick={copyLink}>
                    {copied ? "Copied!" : "Copy"}
                  </button>
                  <button className="btn-secondary" disabled={generatingLink} onClick={generateLink}>
                    {generatingLink ? "Working…" : "Regenerate"}
                  </button>
                </div>
              ) : (
                <button className="btn-primary" disabled={generatingLink} onClick={generateLink}>
                  {generatingLink ? "Generating…" : "Generate a link"}
                </button>
              )}
            </div>

            <div className="modal-section">
              <div className="nav-section-label modal-section-label">Submitted requests</div>
              {requests.length === 0 && <p className="card-subtitle">Nothing submitted yet.</p>}
              {requests.map((r) => (
                <div className="access-request-row" key={r.id}>
                  <div className="access-request-row-header">
                    <div>
                      <span className="person-name">{r.submitted_by_name}</span>
                      <span className="person-role"> · {r.submitted_by_email} · {fmtDate(r.submitted_at.slice(0, 10))}</span>
                    </div>
                    <label className="tab-toggle-row" style={{ margin: 0 }}>
                      <input type="checkbox" checked={r.reviewed} onChange={(e) => markReviewed(r.id, e.target.checked)} />
                      <span>Reviewed</span>
                    </label>
                  </div>
                  {(r.people || []).map((p, i) => (
                    <div className="access-request-person" key={i}>
                      <div>
                        <strong>{p.name}</strong> · {p.role} · {p.email}
                      </div>
                      <div className="card-subtitle" style={{ margin: "2px 0 0" }}>
                        {p.access === "full"
                          ? "Full access requested"
                          : [
                              (p.tabs || []).length
                                ? "Pages: " +
                                  p.tabs
                                    .map((k) => (ALL_TAB_KEYS.includes(k) ? NAV_SECTIONS.flatMap((s) => s.items).find((i) => i.key === k) : null))
                                    .filter(Boolean)
                                    .map((i) => i.label)
                                    .join(", ")
                                : "No specific pages requested",
                              (p.categories || []).length ? "Categories: " + p.categories.join(", ") : null,
                            ]
                              .filter(Boolean)
                              .join(" — ")}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === "documents" && (
          <div className="modal-body">
            <p className="card-subtitle" style={{ marginTop: 0 }}>
              Links to files already in {client.name}'s Google Drive. Nothing is uploaded or
              stored here — this just points at where the file already lives.
            </p>

            <form className="access-link-row" onSubmit={addDocument} style={{ marginBottom: 16 }}>
              <input
                type="text"
                placeholder="Document name"
                value={newDocName}
                onChange={(e) => setNewDocName(e.target.value)}
                required
              />
              <input
                type="url"
                placeholder="Google Drive share link"
                value={newDocUrl}
                onChange={(e) => setNewDocUrl(e.target.value)}
                required
              />
              <button className="btn-primary" disabled={addingDoc} type="submit">
                {addingDoc ? "Adding…" : "Add"}
              </button>
            </form>

            <div className="modal-section">
              <div className="nav-section-label modal-section-label">Linked documents</div>
              {documents === undefined ? (
                <p className="card-subtitle">Loading…</p>
              ) : documents.length === 0 ? (
                <p className="card-subtitle">No documents linked yet.</p>
              ) : (
                documents.map((d) => (
                  <div className="access-request-row" key={d.id}>
                    <div className="access-request-row-header">
                      <a href={d.drive_url} target="_blank" rel="noopener noreferrer" className="person-name">
                        {d.name}
                      </a>
                      <button className="btn-secondary" onClick={() => removeDocument(d.id)}>
                        Remove
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {tab === "quickbooks" && (
          <div className="modal-body">
            <p className="card-subtitle" style={{ marginTop: 0 }}>
              Connect {client.name}'s QuickBooks Online account to sync transactions, accounts, and
              budgets automatically instead of entering them by hand.
            </p>

            <div className="modal-section">
              {qboConnection === undefined ? (
                <p className="card-subtitle">Loading…</p>
              ) : qboConnection && qboConnection.status === "connected" ? (
                <div className="access-request-row">
                  <div className="access-request-row-header">
                    <span className="person-name">Connected</span>
                  </div>
                  <div className="card-subtitle" style={{ margin: "2px 0 0" }}>
                    Last synced{" "}
                    {qboConnection.last_synced_at ? fmtDate(qboConnection.last_synced_at.slice(0, 10)) : "never yet"}
                  </div>
                </div>
              ) : (
                <button className="btn-primary" onClick={connectQuickBooks}>
                  Connect QuickBooks
                </button>
              )}
            </div>
          </div>
        )}

        <div className="modal-footer">
          <span className="modal-footnote">Prototype — access isn't enforced yet.</span>
          <button className="btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
    </ModalShell>
  );
}

// ----------------------------------------------------------------------------
// App
// ----------------------------------------------------------------------------

// Explicit theme choice from the header toggle. Null means "use the product
// default" (dark) — the OS setting no longer decides this (see index.html's
// pre-hydration script and styles.css's data-theme guard).
const THEME_STORAGE_KEY = "mygoodbooks_theme_v1";

function loadTheme() {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    return raw === "light" || raw === "dark" ? raw : null;
  } catch (e) {
    return null;
  }
}

const PAGE_STORAGE_KEY = "mygoodbooks_page_v1";

// Which tab the viewer was last on, so a refresh doesn't dump them back on the
// default page. Validated against the known tabs on the way out — a key from an
// older build (or a hand-edited value) falls back to the default rather than
// rendering nothing. Access is checked separately at render time via
// effectivePage, so a stored tab the current viewer can't see is handled there.
function loadPage() {
  try {
    const raw = localStorage.getItem(PAGE_STORAGE_KEY);
    if (
      raw === "enterprise-upgrade" ||
      raw === "staff-access" ||
      raw === "client-access" ||
      raw === "bookkeeper-home" ||
      ALL_TAB_KEYS.includes(raw)
    ) {
      return raw;
    }
    return null;
  } catch (e) {
    return null;
  }
}

const SELECTED_CLIENT_STORAGE_KEY = "mygoodbooks_selected_client_v1";

function loadSelectedClientId() {
  try {
    const raw = localStorage.getItem(SELECTED_CLIENT_STORAGE_KEY);
    return raw && CLIENTS.some((c) => c.id === raw) ? raw : null;
  } catch (e) {
    return null;
  }
}

// Set once per browser TAB (sessionStorage, not localStorage — a new tab or
// window gets a fresh one, closing the tab clears it, but a plain refresh of
// the same tab keeps it). Lets the very first render of a tab distinguish
// "just opened/signed in" (land on Home) from "refreshed mid-work" (restore
// exactly where they were) without hooking into Supabase auth events, which
// fire ambiguously between a real new sign-in and a silently-restored
// existing session on a page load.
const SESSION_STARTED_KEY = "mygoodbooks_session_started_v1";

function initialPage() {
  try {
    if (!sessionStorage.getItem(SESSION_STARTED_KEY)) {
      sessionStorage.setItem(SESSION_STARTED_KEY, "1");
      return "bookkeeper-home";
    }
  } catch (e) {}
  return loadPage() || "dashboard";
}

// When THIS browser last viewed each client — per-device, not shared across
// staff or synced anywhere. Powers Home's "Recently viewed" and "Needs a
// visit" lists. Deliberately not a Supabase table: it's a personal working
// aid, not something anyone needs to see about anyone else.
const CLIENT_VISITS_STORAGE_KEY = "mygoodbooks_client_visits_v1";

function loadClientVisits() {
  try {
    const raw = localStorage.getItem(CLIENT_VISITS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function recordClientVisit(clientId) {
  try {
    const visits = loadClientVisits();
    visits[clientId] = Date.now();
    localStorage.setItem(CLIENT_VISITS_STORAGE_KEY, JSON.stringify(visits));
  } catch (e) {}
}

const TAB_CONFIG_STORAGE_KEY = "mygoodbooks_tab_config_v2";

function loadTabConfig() {
  try {
    const raw = localStorage.getItem(TAB_CONFIG_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

const TAB_ORDER_STORAGE_KEY = "mygoodbooks_tab_order_v1";

function loadTabOrder() {
  try {
    const raw = localStorage.getItem(TAB_ORDER_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

// Dashboard widget picker: which cards a client has chosen to show on their
// own dashboard, and in what order. Scoped separately per client + access
// scope (a bookkeeper previewing a limited user sees that user's picks, not
// their own full-access ones) since the set of *available* widgets differs.
const DASHBOARD_WIDGETS_STORAGE_KEY = "mygoodbooks_dashboard_widgets_v1";

function loadDashboardWidgetLayouts() {
  try {
    const raw = localStorage.getItem(DASHBOARD_WIDGETS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

// Named snapshots of a widget arrangement ("Board meeting view", "Just the
// numbers", ...) a client can save and switch back to later, separate from
// the single "current" layout above. Scoped the same way (per client +
// access scope) since the available widgets differ by scope too.
const DASHBOARD_VIEWS_STORAGE_KEY = "mygoodbooks_dashboard_views_v1";

function loadDashboardViews() {
  try {
    const raw = localStorage.getItem(DASHBOARD_VIEWS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

// allIds: every widget available in this scope right now (order = default
// order). Merges in any ids not yet in a saved layout (new widget added to
// the app later, or one that just became available) and drops any that are
// no longer available (e.g. a fund that was removed).
function useWidgetLayout(scopeKey, allIds) {
  const [layouts, setLayouts] = useState(loadDashboardWidgetLayouts);
  const [views, setViews] = useState(loadDashboardViews);
  const saved = layouts[scopeKey];
  const order = saved ? saved.order.filter((id) => allIds.includes(id)).concat(allIds.filter((id) => !saved.order.includes(id))) : allIds.slice();
  const hidden = new Set(saved ? saved.hidden.filter((id) => allIds.includes(id)) : []);
  const scopedViews = views[scopeKey] || [];

  const update = (nextOrder, nextHidden) => {
    setLayouts((prev) => {
      const next = { ...prev, [scopeKey]: { order: nextOrder, hidden: Array.from(nextHidden) } };
      try {
        localStorage.setItem(DASHBOARD_WIDGETS_STORAGE_KEY, JSON.stringify(next));
      } catch (e) {}
      return next;
    });
  };

  return {
    order,
    hidden,
    visibleOrder: order.filter((id) => !hidden.has(id)),
    toggle: (id) => {
      const next = new Set(hidden);
      next.has(id) ? next.delete(id) : next.add(id);
      update(order, next);
    },
    // Drops draggedId into targetId's slot, shifting everything between.
    // Direction-aware: removing draggedId shifts every later index down by
    // one, so a forward drag (dragging something onto a neighbor further
    // right/down) has to land *after* the target's post-removal position —
    // landing "before" it (the naive approach) puts it right back where it
    // started for an adjacent swap, which reads as "dragging right does
    // nothing." A backward drag has no such shift, so "before" is correct.
    reorder: (draggedId, targetId) => {
      if (draggedId === targetId) return;
      const draggedIndex = order.indexOf(draggedId);
      const targetIndex = order.indexOf(targetId);
      if (draggedIndex === -1 || targetIndex === -1) return;
      const next = order.filter((id) => id !== draggedId);
      let insertAt = next.indexOf(targetId);
      if (draggedIndex < targetIndex) insertAt += 1;
      next.splice(insertAt, 0, draggedId);
      update(next, hidden);
    },
    // Swaps id with its immediate neighbor, direction -1 (up/earlier) or +1
    // (down/later). The button-based reorder path (WidgetPickerModal) —
    // works identically for a hidden widget (moves it within the full
    // order, same as reorder above) or a visible one; the modal only ever
    // calls this on adjacent rows as rendered, so a plain swap is exactly
    // equivalent to reorder()'s shift-based math for that one-step case,
    // without needing the shift logic at all.
    move: (id, direction) => {
      const index = order.indexOf(id);
      const targetIndex = index + direction;
      if (index === -1 || targetIndex < 0 || targetIndex >= order.length) return;
      const next = order.slice();
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      update(next, hidden);
    },
    reset: () => update(allIds.slice(), new Set()),

    // Named snapshots of the current order/hidden set — separate from
    // localStorage's single "current" layout above, so a client can flip
    // between a couple of arrangements (e.g. a stripped-down board view vs.
    // their own everyday one) without losing either.
    views: scopedViews,
    saveView: (name) => {
      const trimmed = (name || "").trim();
      if (!trimmed) return;
      setViews((prev) => {
        // Saving under a name that already exists overwrites it rather than
        // piling up duplicates.
        const existing = (prev[scopeKey] || []).filter((v) => v.name !== trimmed);
        const next = { ...prev, [scopeKey]: [...existing, { name: trimmed, order, hidden: Array.from(hidden) }] };
        try {
          localStorage.setItem(DASHBOARD_VIEWS_STORAGE_KEY, JSON.stringify(next));
        } catch (e) {}
        return next;
      });
    },
    applyView: (name) => {
      const view = scopedViews.find((v) => v.name === name);
      if (!view) return;
      update(
        view.order.filter((id) => allIds.includes(id)).concat(allIds.filter((id) => !view.order.includes(id))),
        new Set(view.hidden.filter((id) => allIds.includes(id)))
      );
    },
    deleteView: (name) => {
      setViews((prev) => {
        const next = { ...prev, [scopeKey]: (prev[scopeKey] || []).filter((v) => v.name !== name) };
        try {
          localStorage.setItem(DASHBOARD_VIEWS_STORAGE_KEY, JSON.stringify(next));
        } catch (e) {}
        return next;
      });
    },
  };
}

// Same breakpoint the phone layout already switches on (.app-shell/
// .mobile-topbar in styles.css). matchMedia + a change listener, not a
// resize listener + innerWidth check — matchMedia only fires when the
// query's truthiness actually flips, not on every pixel of a resize/rotate.
const MOBILE_BREAKPOINT_QUERY = "(max-width: 760px)";

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.matchMedia(MOBILE_BREAKPOINT_QUERY).matches
  );
  useEffect(() => {
    const mql = window.matchMedia(MOBILE_BREAKPOINT_QUERY);
    const onChange = (e) => setIsMobile(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return isMobile;
}

// Lets the actual cards on a page (not just the picker modal's rows) be
// picked up and dropped to reorder — same underlying layout.reorder, just
// driven by dragging the card itself. dragProps(id) spreads onto the card's
// wrapper div; dragClass(id) adds the visual feedback classes.
//
// Mouse-only, deliberately. An earlier version simulated touch dragging with
// pointer capture + document.elementFromPoint() hit-testing, long-press to
// pick up. Four different real-device bugs in a row (never actually
// reordering, then selecting text instead of dragging, then the browser's
// own scroll gesture winning the race against the long-press timer every
// time) made clear that reimplementing native drag-and-drop over touch is
// fragile in a way that's genuinely hard to fully close out. Touch users
// reorder via the ▲/▼ buttons in the "Customize dashboard" modal
// (WidgetPickerModal) instead — see layout.move() — which needs no gesture
// recognition at all and can't conflict with scrolling, text selection, or
// anything else the OS is doing with the same touch.
function useDragReorder(layout) {
  const [draggedId, setDraggedId] = useState(null);
  // The last target reorder() was actually called against. dragover fires
  // continuously (many times a second) while hovering, and
  // layout.reorder(draggedId, targetId) is NOT idempotent for a stationary
  // hover — calling it twice in a row on the same pair swaps them, then
  // swaps them right back (the dragged item's index vs. the target's flips
  // after the first call, which flips which branch the insert-position math
  // takes). Repeated firing during any hover longer than one event tick —
  // i.e. any real, deliberate drag — oscillates between two arrangements and
  // can land back where it started by the time you release, which reads as
  // "picks up fine, never actually swaps." Only reordering once per
  // newly-entered target (reset when the drag starts or ends) restores the
  // intended "shuffle the instant you drag over a neighbor" behavior.
  const lastTarget = useRef(null);

  return {
    // iPhone-homescreen-style: cards shuffle live the instant you drag over
    // a neighbor, not just when you release — dropping only ends the grab.
    // The browser's own drag-and-drop, ghost image and all — mouse only,
    // see the hook comment above for why there's no touch equivalent here.
    dragProps: (id) => ({
      draggable: true,
      onDragStart: () => {
        lastTarget.current = null;
        setDraggedId(id);
      },
      onDragOver: (e) => {
        e.preventDefault();
        if (draggedId && draggedId !== id && lastTarget.current !== id) {
          lastTarget.current = id;
          layout.reorder(draggedId, id);
        }
      },
      onDrop: (e) => {
        e.preventDefault();
        lastTarget.current = null;
        setDraggedId(null);
      },
      onDragEnd: () => {
        lastTarget.current = null;
        setDraggedId(null);
      },
    }),
    // The card being held stops jiggling and lifts; every other card in the
    // grid jiggles in place, same as iOS's wiggle-to-rearrange mode.
    dragClass: (id) => "draggable-card" + (draggedId === id ? " card-dragging" : draggedId ? " card-jiggling" : ""),
    isDragging: Boolean(draggedId),
  };
}

// Modal listing every widget available in this scope, with a checkbox to
// add/remove it from the dashboard and a drag handle to reorder the ones
// currently shown. Shared by DashboardPage and ScopedDashboardPage.
function WidgetPickerModal({ widgets, layout, onClose }) {
  const [draggedId, setDraggedId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const [newViewName, setNewViewName] = useState("");

  return (
    <ModalShell onClose={onClose} labelledBy="widget-picker-title" className="widget-picker-modal">
        <div className="modal-header">
          <h3 id="widget-picker-title">Customize your dashboard</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <p className="card-subtitle" style={{ marginBottom: 16 }}>
          Pull in any card you have access to from across the app. Use the ▲▼ buttons below to
          reorder them, or drag the handle with a mouse — make this your hub. On the dashboard
          itself, drag a card with a mouse to move it directly.
        </p>
        <div className="widget-picker-list">
          {layout.order.map((id, index) => {
            const w = widgets.find((x) => x.id === id);
            if (!w) return null;
            const isHidden = layout.hidden.has(id);
            return (
              <div
                className={
                  "widget-picker-row" +
                  (isHidden ? " widget-picker-row-hidden" : "") +
                  (dragOverId === id && draggedId !== id ? " widget-picker-row-drag-over" : "") +
                  (draggedId === id ? " widget-picker-row-dragging" : "")
                }
                key={id}
                draggable
                onDragStart={() => setDraggedId(id)}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (draggedId && draggedId !== id) setDragOverId(id);
                }}
                onDragLeave={() => setDragOverId((cur) => (cur === id ? null : cur))}
                onDrop={(e) => {
                  e.preventDefault();
                  if (draggedId) layout.reorder(draggedId, id);
                  setDraggedId(null);
                  setDragOverId(null);
                }}
                onDragEnd={() => {
                  setDraggedId(null);
                  setDragOverId(null);
                }}
              >
                <span className="drag-handle" aria-hidden="true">⠿</span>
                <div className="widget-picker-move">
                  <button
                    type="button"
                    className="widget-picker-move-btn"
                    disabled={index === 0}
                    onClick={() => layout.move(id, -1)}
                    aria-label={`Move ${w.label} up`}
                  >
                    <ChevronUpIcon />
                  </button>
                  <button
                    type="button"
                    className="widget-picker-move-btn"
                    disabled={index === layout.order.length - 1}
                    onClick={() => layout.move(id, 1)}
                    aria-label={`Move ${w.label} down`}
                  >
                    <ChevronDownIcon />
                  </button>
                </div>
                <label className="widget-picker-label">
                  <input type="checkbox" checked={!isHidden} onChange={() => layout.toggle(id)} />
                  <span>
                    {w.sourceTab && <span className="widget-picker-source">From {w.sourceTab}</span>}
                    <strong>{w.label}</strong>
                    {w.description && <span className="widget-picker-desc"> — {w.description}</span>}
                  </span>
                </label>
              </div>
            );
          })}
        </div>
        <div className="widget-picker-views">
          <h4 className="widget-picker-views-title">Saved views</h4>
          <p className="card-subtitle" style={{ margin: "0 0 10px" }}>
            Save this arrangement under a name to switch back to it later — a stripped-down board
            view and your own everyday one, say — without losing either.
          </p>
          {layout.views.length > 0 && (
            <div className="widget-picker-view-list">
              {layout.views.map((v) => (
                <div className="widget-picker-view-row" key={v.name}>
                  <span className="widget-picker-view-name">{v.name}</span>
                  <div className="widget-picker-view-actions">
                    <button type="button" className="btn-secondary" onClick={() => layout.applyView(v.name)}>
                      Apply
                    </button>
                    <button
                      type="button"
                      className="widget-picker-view-remove"
                      onClick={() => layout.deleteView(v.name)}
                      aria-label={`Delete view ${v.name}`}
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="widget-picker-view-new">
            <input
              type="text"
              placeholder="Name this arrangement…"
              value={newViewName}
              onChange={(e) => setNewViewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newViewName.trim()) {
                  layout.saveView(newViewName);
                  setNewViewName("");
                }
              }}
            />
            <button
              type="button"
              className="btn-secondary"
              disabled={!newViewName.trim()}
              onClick={() => {
                layout.saveView(newViewName);
                setNewViewName("");
              }}
            >
              Save as view
            </button>
          </div>
        </div>
        <div className="widget-picker-actions">
          <button className="btn-secondary" onClick={layout.reset}>Reset to default</button>
          <button className="btn-primary" onClick={onClose}>Done</button>
        </div>
    </ModalShell>
  );
}

function CustomizeDashboardButton({ widgets, layout }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="customize-dashboard-btn" onClick={() => setOpen(true)}>
        <SlidersIcon /> Customize dashboard
      </button>
      {open && <WidgetPickerModal widgets={widgets} layout={layout} onClose={() => setOpen(false)} />}
    </>
  );
}

const REFERRAL_PROMO_STORAGE_KEY = "mygoodbooks_referral_promo_v1";
const DEFAULT_REFERRAL_PROMO =
  "Know another church or nonprofit that could use a great bookkeeper? Refer them to MyGoodBooks — once they sign on, you'll both get a $100 gift card.";

const DEFAULT_REFERRAL_EMAIL_MESSAGE =
  "Hi there,\n\nI wanted to pass along a recommendation — our bookkeeping is handled by MyGoodBooks, and they've been great to work with. They specialize in bookkeeping for churches and nonprofits: monthly books, budget tracking, and giving/fund reports, all through a clean online dashboard so you always know where things stand.\n\nIf you're looking for a bookkeeper you can trust, I'd recommend reaching out to them.\n\nThanks,\n[Your name]";

// Dismissing the referral popup only hides it for the rest of this visit
// (sessionStorage) — it comes back next time the client opens the app.
const REFERRAL_POPUP_DISMISSED_KEY = "mygoodbooks_referral_popup_dismissed_v1";

function wasReferralPopupDismissed() {
  try {
    return sessionStorage.getItem(REFERRAL_POPUP_DISMISSED_KEY) === "1";
  } catch (e) {
    return false;
  }
}

function dismissReferralPopup() {
  try {
    sessionStorage.setItem(REFERRAL_POPUP_DISMISSED_KEY, "1");
  } catch (e) {}
}

function loadReferralPromo() {
  try {
    const raw = localStorage.getItem(REFERRAL_PROMO_STORAGE_KEY);
    return raw || DEFAULT_REFERRAL_PROMO;
  } catch (e) {
    return DEFAULT_REFERRAL_PROMO;
  }
}

const PAGE_META = {
  dashboard: { title: "Dashboard", subtitle: "A quick look at where things stand" },
  // Display name only. The route key, the DailyClose component and the
  // components/daily-close/ directory keep their original names — renaming
  // those would churn the whole vendored component for a label change.
  "daily-close": { title: "Live Report", subtitle: "A live financial snapshot, updating continuously" },
  budget: { title: "Budget vs. Actual", subtitle: "How spending compares to plan, by category" },
  giving: { title: "Giving & Funds", subtitle: "Contributions received and fund balances" },
  receivables: { title: "Cash Flow", subtitle: "Money coming in and bills going out" },
  bank: { title: "Bank Accounts", subtitle: "Balances and recent activity" },
  payroll: { title: "Payroll", subtitle: "Employees, pay runs, and tax deposits" },
  reports: { title: "Reports", subtitle: "Download statements and summaries" },
  "report-builder": { title: "Report Builder", subtitle: "Assemble a formatted report for your board or leadership" },
  "budgeting-tool": { title: "Budgeting Tool", subtitle: "Draft next period's budget with your bookkeeper" },
  "ap-command-center": { title: "Cash Flow Pro", subtitle: "Every open bill, aging, and what's due next" },
  "bank-reconciliation": { title: "Bank Accounts", subtitle: "Balances, activity, and month-end reconciliation" },
  "fund-accounting-pro": { title: "Giving & Funds", subtitle: "Contributions, fund balances, transfers, and pledges" },
  "enterprise-upgrade": { title: "Enterprise", subtitle: "See what's included, and what upgrading unlocks" },
  "staff-access": { title: "Staff Access", subtitle: "Who can sign in to the portal, and with what role" },
  "client-access": { title: "Client Roster", subtitle: "Who at each organization is registered to sign in" },
  "developer-tools": { title: "Developer Tools", subtitle: "Per-browser testing aids — nothing here is shared with other staff or written to Supabase" },
  "staff-messages": { title: "Team Chat", subtitle: "Message management, separate from client conversations" },
  "bookkeeper-home": { title: "Home", subtitle: "What needs attention across every client you can see" },
  documents: { title: "Documents", subtitle: "Shared files between you and your bookkeeper" },
  messages: { title: "Messages", subtitle: "Talk directly with your bookkeeping team" },
};

// Without this, any component error unmounts the whole tree and the page
// goes blank with nothing but a console error. This is the only class
// component in the app — getDerivedStateFromError/componentDidCatch have no
// hook equivalent.
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error("Uncaught error in app tree:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary">
          <div className="error-boundary-card">
            <div className="error-boundary-title">Something went wrong</div>
            <p className="error-boundary-body">
              This page hit an unexpected error. Reloading usually fixes it — your data hasn't been affected.
            </p>
            <button className="btn-primary" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// clientPortalUser: a signed-in client (Phase 2 — see ClientAuthGate), never
// present alongside staffUser. Pins the whole app to that one person's own
// client_id (no picker, nothing to switch) and, further down, hands their
// real row straight to resolveAccess instead of the mock viewAsUserId
// lookup — everything downstream (Sidebar's isBookkeeper branch, the
// effectivePage guards, scopeClientData) already treats "access.user is a
// real person" as the client-facing view, the same path "Preview As"
// already exercises, so this reuses it rather than building a parallel one.
function App({ staffUser, onSignOut, clientPortalUser }) {
  // Riverside: premium plan (so Live Report is reachable) and, as of the
  // thread fixes in data.js, no thread whose last message is unread —
  // nothing steals focus with the chat popup on first load. Only the
  // fallback when nothing was ever persisted (loadSelectedClientId returns
  // null) — a returning staffer lands back on whatever client they last had
  // open, per initialPage's refresh-vs-fresh-open distinction below.
  const [selectedClientId, setSelectedClientId] = useState(
    () => (clientPortalUser && clientPortalUser.client_id) || loadSelectedClientId() || "riverside-pantry"
  );
  // A client never lands on "bookkeeper-home" — initialPage()'s fresh-session
  // default is staff-only chrome they can't render (no staffUser).
  const [page, setPage] = useState(() => (clientPortalUser ? "dashboard" : initialPage()));
  // Sidebar dot for Team Chat — recomputed on every page change and on any
  // Team Chat activity (cheap, single-purpose query) rather than polling,
  // same posture as the rest of this app's Supabase reads. "Read" is now a
  // real per-conversation server column (staff_conversation_members.last_read_at),
  // not a per-browser localStorage guess, so this works the same regardless
  // of who the other side of any given conversation is.
  const [staffMessagesUnread, setStaffMessagesUnread] = useState(false);
  const checkStaffMessagesUnread = useCallback(() => {
    const supabase = window.mgbSupabase;
    if (!supabase || !staffUser) {
      setStaffMessagesUnread(false);
      return;
    }
    supabase
      .from("staff_conversation_members")
      .select("conversation_id, last_read_at")
      .eq("staff_email", staffUser.email)
      .then(({ data, error }) => {
        if (error || !data || data.length === 0) {
          setStaffMessagesUnread(false);
          return;
        }
        const convIds = data.map((r) => r.conversation_id);
        const readByConv = {};
        data.forEach((r) => {
          readByConv[r.conversation_id] = r.last_read_at;
        });
        supabase
          .from("staff_messages")
          .select("conversation_id, author_email, created_at")
          .in("conversation_id", convIds)
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(200)
          .then(({ data: msgs, error: msgErr }) => {
            if (msgErr || !msgs) {
              setStaffMessagesUnread(false);
              return;
            }
            const latestByConv = {};
            msgs.forEach((m) => {
              if (!latestByConv[m.conversation_id]) latestByConv[m.conversation_id] = m;
            });
            const unread = Object.values(latestByConv).some((m) => {
              if (m.author_email === staffUser.email) return false;
              const readAt = readByConv[m.conversation_id];
              return !readAt || new Date(m.created_at) > new Date(readAt);
            });
            setStaffMessagesUnread(unread);
          });
      });
  }, [staffUser]);
  useEffect(() => {
    checkStaffMessagesUnread();
  }, [checkStaffMessagesUnread, page]);
  // Set when a global-search result is clicked, so the destination page
  // knows exactly which row to scroll to and flash — not just which tab to
  // open. `nonce` forces the effect on the receiving page to re-fire even
  // when the same result is clicked twice in a row (same key, same page).
  const [searchTarget, setSearchTarget] = useState(null);
  const [tabConfig, setTabConfig] = useState(loadTabConfig);
  const [tabOrder, setTabOrder] = useState(loadTabOrder);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Read state and live threads are both keyed "<clientId>::<userId>", since
  // every person at an organization has their own private thread.
  const [readMessageClients, setReadMessageClients] = useState({});
  const [viewAsUserId, setViewAsUserId] = useState(BOOKKEEPER_VIEW);
  const [userAccess, setUserAccess] = useState({});
  const [referralPromo, setReferralPromo] = useState(loadReferralPromo);
  // null until the header toggle is used, at which point it pins the choice
  // (see the effects below). Null means dark — the product default.
  const [theme, setTheme] = useState(loadTheme);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [messagesByClient, setMessagesByClient] = useState({});
  // Purely client-side "is typing" flag for the simulated bookkeeper reply
  // below — there's no real backend for this thread (see MockBanner on
  // MessagesPage), so this just mirrors the same 900ms window the reply
  // already waits, rather than faking a live Realtime channel.
  const [bookkeeperTyping, setBookkeeperTyping] = useState(false);
  const [chatWidgetOpen, setChatWidgetOpen] = useState(false);
  // Which person's thread the bookkeeper is reading (clients only ever see
  // their own, so this is unused while previewing as someone).
  const [bookkeeperThreadUserId, setBookkeeperThreadUserId] = useState(null);

  // Which clients THIS staffer may see. null means "unrestricted" — true for
  // every admin (assignment never applies to them), and also the safe
  // fail-open value while the fetch is in flight or if it errors (e.g. the
  // staff-client-access.sql migration hasn't been run yet) — a broken query
  // should never look the same as an admin having deliberately assigned zero
  // clients. Only a SUCCESSFUL fetch that returns zero rows sets an actual
  // empty Set, which does restrict a bookkeeper to nothing until an admin
  // checks at least one client for them.
  const [assignedClientIds, setAssignedClientIds] = useState(null);

  // Lets an admin see the app exactly as one specific bookkeeper would —
  // their assigned clients, their Home rollups, their own private reminders
  // — without needing that person's Google login. Set from the roster's
  // "View as" button (StaffAccessPage) and cleared from the banner below.
  // Only ever holds a {email, name, role} row from the staff table, never
  // the real admin's own — nothing here touches Supabase auth, so writes
  // made while impersonating (a note, a reminder) still carry the real
  // signed-in admin's session for RLS purposes; only what's DISPLAYED and
  // which rows get READ (assigned clients, that person's own reminders)
  // change.
  const [impersonating, setImpersonating] = useState(null);
  const effectiveStaffUser = impersonating || staffUser;

  const startImpersonating = (row) => {
    setImpersonating({ email: row.email, name: row.name, role: row.role });
    setPage("bookkeeper-home");
  };
  const stopImpersonating = () => {
    setImpersonating(null);
    setPage("bookkeeper-home");
  };

  useEffect(() => {
    setAssignedClientIds(null);
    // Nothing to scope for a signed-in client — they only ever have their
    // own one client_id, not a list to filter.
    if (!effectiveStaffUser || effectiveStaffUser.role === "admin") return;
    const supabase = window.mgbSupabase;
    if (!supabase) return;
    supabase
      .from("staff_client_access")
      .select("client_id")
      .eq("staff_email", effectiveStaffUser.email)
      .then(({ data, error }) => {
        if (error) {
          console.warn("Couldn't load client access (staff-client-access.sql may not be run yet):", error.message);
          return;
        }
        setAssignedClientIds(new Set(data.map((r) => r.client_id)));
      });
  }, [effectiveStaffUser && effectiveStaffUser.email, effectiveStaffUser && effectiveStaffUser.role]);

  const visibleClients = useMemo(
    () => (assignedClientIds ? CLIENTS.filter((c) => assignedClientIds.has(c.id)) : CLIENTS),
    [assignedClientIds]
  );

  const saveReferralPromo = (text) => {
    setReferralPromo(text);
    try {
      localStorage.setItem(REFERRAL_PROMO_STORAGE_KEY, text);
    } catch (e) {}
  };

  // Sending a message updates one person's thread, so the full Messages page
  // and the floating chat widget always agree on what's there.
  const sendMessage = (clientId, userId, text, attachment) => {
    const today = todayLocal();
    const key = threadKeyFor(clientId, userId);
    const seedFor = () => seedThread(clientId, userId);
    // The thread belongs to one person, but the bookkeeper can also write into
    // it while previewing, so record who actually composed the message.
    const author = (access.user && access.user.name) || "You";
    setMessagesByClient((prev) => ({
      ...prev,
      [key]: [
        ...(prev[key] || seedFor()),
        { from: "client", author, date: today, text, attachment },
      ],
    }));
    setBookkeeperTyping(true);
    setTimeout(() => {
      setBookkeeperTyping(false);
      setMessagesByClient((prev) => ({
        ...prev,
        [key]: [
          ...(prev[key] || seedFor()),
          {
            from: "bookkeeper",
            author: "MyGoodBooks",
            date: today,
            text: "Thanks for the note — this is a sample thread, so replies here are simulated. In the real product, your bookkeeper will respond here directly.",
          },
        ],
      }));
    }, 900);
  };

  // Remember the tab across refreshes. Stores the raw `page` rather than
  // `effectivePage`: if a bookkeeper is previewing as someone without access to
  // the current tab, the render falls back to the dashboard, but their own
  // choice should survive exiting the preview.
  useEffect(() => {
    try {
      localStorage.setItem(PAGE_STORAGE_KEY, page);
    } catch (e) {}
  }, [page]);

  useEffect(() => {
    try {
      localStorage.setItem(SELECTED_CLIENT_STORAGE_KEY, selectedClientId);
    } catch (e) {}
  }, [selectedClientId]);

  useEffect(() => {
    try {
      localStorage.setItem(TAB_CONFIG_STORAGE_KEY, JSON.stringify(tabConfig));
    } catch (e) {}
  }, [tabConfig]);

  useEffect(() => {
    try {
      localStorage.setItem(TAB_ORDER_STORAGE_KEY, JSON.stringify(tabOrder));
    } catch (e) {}
  }, [tabOrder]);

  // Dark is the product default. data-theme is always set (never removed), so the
  // OS preference no longer decides the theme — only a stored choice does, and the
  // absence of one means dark. index.html sets the same attribute before first
  // paint; this keeps it in sync once React owns the state.
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme || "dark");
    try {
      if (theme) localStorage.setItem(THEME_STORAGE_KEY, theme);
      else localStorage.removeItem(THEME_STORAGE_KEY);
    } catch (e) {}
  }, [theme]);

  const effectiveTheme = theme || "dark";

  const baseClient = useMemo(
    () => visibleClients.find((c) => c.id === selectedClientId) || visibleClients[0] || CLIENTS[0],
    [selectedClientId, visibleClients]
  );

  // A restricted bookkeeper's selectedClientId can point at a client that
  // isn't (or is no longer) assigned to them — the very first render before
  // assignedClientIds loads, or an admin having just unchecked one out from
  // under them. baseClient above already falls back safely so nothing
  // crashes, but this brings the URL/localStorage-persisted selection back
  // in sync once we know the real list.
  useEffect(() => {
    if (visibleClients.length === 0) return;
    if (!visibleClients.find((c) => c.id === selectedClientId)) {
      setSelectedClientId(visibleClients[0].id);
    }
  }, [visibleClients]);

  // Apply any access edits the bookkeeper made in this session on top of the
  // access records that ship with the data.
  const client = useMemo(() => {
    if (!baseClient.users) return baseClient;
    return {
      ...baseClient,
      users: baseClient.users.map((u) => (userAccess[u.id] ? { ...u, ...userAccess[u.id] } : u)),
    };
  }, [baseClient, userAccess]);

  // Switching client resets the preview — a person at one org is meaningless at another.
  // Also lands on Dashboard for the newly-selected client (Live Report for a
  // premium, full-access client; the plain Dashboard otherwise) rather than
  // keeping whatever tab happened to be open for the PREVIOUS client — e.g.
  // staying on Report Builder after switching to a standard-plan client that
  // doesn't even have that tab. Skips its own first run so a page refresh
  // still restores the last-viewed tab as before; this only fires on an
  // actual client switch, after mount.
  const skipFirstClientSwitch = useRef(true);
  useEffect(() => {
    setViewAsUserId(BOOKKEEPER_VIEW);
    setBookkeeperThreadUserId(null);
    if (skipFirstClientSwitch.current) {
      skipFirstClientSwitch.current = false;
    } else {
      setPage("dashboard");
    }
  }, [selectedClientId]);

  // Only counts as "visiting" a client while actually looking at one of its
  // pages, not while browsing Home/Staff Access (which don't belong to any
  // client, and would otherwise stamp whatever client was last selected
  // every time someone just checks their reminders).
  useEffect(() => {
    if (NON_CLIENT_PAGES.has(page)) return;
    recordClientVisit(selectedClientId);
  }, [selectedClientId, page]);

  // tabConfig stores HIDDEN keys per client (not visible ones) so that any
  // tab added later in the app defaults to visible for every client, rather
  // than silently staying hidden because it's missing from an old snapshot.
  const visibleKeys = useMemo(() => {
    const hidden = new Set(tabConfig[selectedClientId] || []);
    return new Set(ALL_TAB_KEYS.filter((k) => k === ALWAYS_VISIBLE_KEY || !hidden.has(k)));
  }, [tabConfig, selectedClientId]);

  const toggleTab = (key) => {
    if (key === ALWAYS_VISIBLE_KEY) return;
    setTabConfig((prev) => {
      const hidden = new Set(prev[selectedClientId] || []);
      if (hidden.has(key)) hidden.delete(key);
      else hidden.add(key);
      return { ...prev, [selectedClientId]: Array.from(hidden) };
    });
  };

  const reorderTab = (sectionLabel, fromKey, toKey) => {
    setTabOrder((prev) => {
      const section = NAV_SECTIONS.find((s) => s.label === sectionLabel);
      const currentOrder =
        (prev[selectedClientId] && prev[selectedClientId][sectionLabel]) || section.items.map((i) => i.key);
      const withoutFrom = currentOrder.filter((k) => k !== fromKey);
      const toIndex = withoutFrom.indexOf(toKey);
      withoutFrom.splice(toIndex, 0, fromKey);
      return {
        ...prev,
        [selectedClientId]: { ...(prev[selectedClientId] || {}), [sectionLabel]: withoutFrom },
      };
    });
  };

  const toggleUserPremium = (userId) => {
    const user = client.users.find((u) => u.id === userId);
    setUserAccess((prev) => {
      const current = prev[userId] && "premiumThrottled" in prev[userId] ? prev[userId].premiumThrottled : Boolean(user.premiumThrottled);
      return { ...prev, [userId]: { ...(prev[userId] || {}), premiumThrottled: !current } };
    });
  };

  const setAccessLevel = (userId, level) => {
    setUserAccess((prev) => ({
      ...prev,
      [userId]: { ...(prev[userId] || {}), access: level, ...(level === "full" ? { categories: null, tabs: null } : {}) },
    }));
  };

  const toggleUserTab = (userId, key) => {
    if (key === ALWAYS_VISIBLE_KEY) return;
    const user = client.users.find((u) => u.id === userId);
    setUserAccess((prev) => {
      const current = new Set((prev[userId] && prev[userId].tabs) || user.tabs || ALL_TAB_KEYS);
      if (current.has(key)) current.delete(key);
      else current.add(key);
      return { ...prev, [userId]: { ...(prev[userId] || {}), tabs: ALL_TAB_KEYS.filter((k) => current.has(k)) } };
    });
  };

  const toggleUserCategory = (userId, category) => {
    const user = client.users.find((u) => u.id === userId);
    setUserAccess((prev) => {
      const current = new Set((prev[userId] && prev[userId].categories) || user.categories || []);
      if (current.has(category)) current.delete(category);
      else current.add(category);
      const next = Array.from(current);
      return { ...prev, [userId]: { ...(prev[userId] || {}), categories: next.length ? next : null } };
    });
  };

  // Unlike categories, an empty fund list stays an empty list (stored as
  // null, same "nothing set" representation) rather than falling back to
  // every fund — see the comment on resolveAccess's funds line.
  const toggleUserFund = (userId, fundName) => {
    const user = client.users.find((u) => u.id === userId);
    setUserAccess((prev) => {
      const current = new Set((prev[userId] && prev[userId].funds) || user.funds || []);
      if (current.has(fundName)) current.delete(fundName);
      else current.add(fundName);
      const next = Array.from(current);
      return { ...prev, [userId]: { ...(prev[userId] || {}), funds: next.length ? next : null } };
    });
  };

  // Normalized to the same shape a client.users mock entry has — see
  // resolveAccess's overrideUser param.
  const portalOverrideUser = useMemo(
    () =>
      clientPortalUser
        ? {
            id: clientPortalUser.email,
            name: clientPortalUser.name,
            role: clientPortalUser.role,
            access: clientPortalUser.access || "full",
            tabs: clientPortalUser.tabs,
            categories: clientPortalUser.categories,
            funds: clientPortalUser.funds,
            premiumThrottled: clientPortalUser.premium_throttled,
          }
        : null,
    [clientPortalUser]
  );

  const access = useMemo(
    () => resolveAccess(client, viewAsUserId, new Set(tabConfig[selectedClientId] || []), portalOverrideUser),
    [client, viewAsUserId, tabConfig, selectedClientId, portalOverrideUser]
  );

  const scopedClient = useMemo(() => scopeClientData(client, access), [client, access]);

  // "enterprise-upgrade", "staff-access"/"client-access"/"developer-tools",
  // and "staff-messages" are synthetic pages, not real tabs — none is in
  // ALL_TAB_KEYS/access.tabs, so each needs its own bypass here or the
  // normal fallback would bounce it straight back to the dashboard. The
  // admin-only three additionally require the role, matching the sidebar
  // links that are the only way to reach them — Postgres RLS is the real
  // enforcement for staff-access (see supabase/staff-admin-policies.sql)
  // and developer-tools only ever touches this browser's own localStorage,
  // but the page-level gate still keeps a demoted admin's stale stored page
  // from rendering either. staff-messages is open to any staff role (a
  // bookkeeper has their own thread too) but, like the admin-only three,
  // unreachable while impersonating — "view as" is about seeing a
  // bookkeeper's CLIENT-facing view, and whose Team Chat thread should show
  // during that (the real admin's, or the impersonated bookkeeper's) has no
  // clean answer, so it's simplest to just not offer it mid-impersonation.
  const effectivePage =
    page === "enterprise-upgrade"
      ? page
      : (page === "staff-access" || page === "client-access" || page === "developer-tools") &&
        staffUser &&
        staffUser.role === "admin" &&
        !impersonating
      ? page
      : page === "staff-messages" && staffUser && !impersonating
      ? page
      : page === "bookkeeper-home" && staffUser
      ? page
      : access.tabs.has(page)
      ? page
      : ALWAYS_VISIBLE_KEY;
  // Each of these six tabs IS its upgraded page for a full-access premium
  // viewer — same pattern for all six now (see PREMIUM_UPGRADE_TAB_KEYS):
  // one nav item, content swapped by plan, rather than a second
  // separately-named tab. "daily-close"/"report-builder"/"budgeting-tool"/
  // "ap-command-center"/"bank-reconciliation"/"fund-accounting-pro" survive
  // as PAGE_META keys purely to supply the header title/subtitle for the
  // upgraded state below — they're no longer reachable page keys of their
  // own (no nav item points at them, and the render switch no longer
  // branches on them directly). Category-scoped premium users still get
  // every plain tab (ORG_WIDE_TABS-equivalent: a live org-wide
  // snapshot/report has no "their" slice to show).
  const showsLiveReport = effectivePage === "dashboard" && access.premiumForUser && !access.isCategoryScoped;
  const showsBudgetingTool = effectivePage === "budget" && access.premiumForUser && !access.isCategoryScoped;
  const showsCashFlowPro = effectivePage === "receivables" && access.premiumForUser && !access.isCategoryScoped;
  const showsReportBuilder = effectivePage === "reports" && access.premiumForUser && !access.isCategoryScoped;
  const showsReconciliationPro = effectivePage === "bank" && access.premiumForUser && !access.isCategoryScoped;
  const showsFundAccountingPro = effectivePage === "giving" && access.premiumForUser && !access.isCategoryScoped;
  const meta = showsLiveReport
    ? PAGE_META["daily-close"]
    : showsBudgetingTool
    ? PAGE_META["budgeting-tool"]
    : showsCashFlowPro
    ? PAGE_META["ap-command-center"]
    : showsReportBuilder
    ? PAGE_META["report-builder"]
    : showsReconciliationPro
    ? PAGE_META["bank-reconciliation"]
    : showsFundAccountingPro
    ? PAGE_META["fund-accounting-pro"]
    : PAGE_META[effectivePage];
  // Drives the shimmering gold subtitle right under the page greeting — a
  // one-glance "you're looking at the premium version" cue that doesn't
  // depend on noticing the sidebar's PRO pill or scrolling into the page
  // itself. True on exactly the six upgraded pages from PREMIUM_UPGRADE_TAB_KEYS.
  const isPremiumPage =
    showsLiveReport || showsBudgetingTool || showsCashFlowPro || showsReportBuilder || showsReconciliationPro || showsFundAccountingPro;
  const isPreviewingUser = viewAsUserId !== BOOKKEEPER_VIEW && access.user;

  const clientUsers = client.users || [];

  const threadFor = (userId) =>
    messagesByClient[threadKeyFor(selectedClientId, userId)] || seedThread(selectedClientId, userId);

  // Tracks how many messages were already seen per thread, rather than a plain
  // "read" flag — a flag latches on first visit and would stop every later
  // reply from ever raising the badge or the chat widget again.
  const threadHasUnread = (userId) => {
    const msgs = threadFor(userId);
    return (
      lastMessageFromBookkeeper({ messages: msgs }) &&
      msgs.length > (readMessageClients[threadKeyFor(selectedClientId, userId)] || 0)
    );
  };

  const unreadThreadUserIds = clientUsers.filter((u) => threadHasUnread(u.id)).map((u) => u.id);
  // A client sees a badge only for their own thread; the bookkeeper sees one
  // if anybody at the organization is waiting on a reply.
  const hasUnreadMessages = access.user
    ? unreadThreadUserIds.includes(access.user.id)
    : unreadThreadUserIds.length > 0;

  // A person always reads their own thread. In bookkeeper view there's no
  // signed-in person, so MyGoodBooks picks whose thread to open — and it opens
  // one that's actually waiting. Defaulting to clientUsers[0] meant landing on a
  // thread that was never flagged, marking *that* read while the badge (raised
  // by a different person's thread) stayed lit no matter how often you looked.
  // An explicit pick from the thread picker always wins.
  const activeThreadUserId = access.user
    ? access.user.id
    : bookkeeperThreadUserId || unreadThreadUserIds[0] || (clientUsers[0] && clientUsers[0].id) || null;

  const liveMessages = activeThreadUserId ? threadFor(activeThreadUserId) : [];

  useEffect(() => {
    // effectivePage, not page: when the current tab isn't visible to this viewer
    // the app falls back to the dashboard, and a thread nobody is looking at
    // must not be marked read.
    if (effectivePage === "messages" && activeThreadUserId) {
      const key = threadKeyFor(selectedClientId, activeThreadUserId);
      setReadMessageClients((prev) =>
        prev[key] === liveMessages.length ? prev : { ...prev, [key]: liveMessages.length }
      );
    }
  }, [effectivePage, selectedClientId, activeThreadUserId, liveMessages.length]);

  // Switching tabs (or clients) should land at the top of the new page, not
  // wherever the previous page happened to be scrolled to — the sidebar is
  // sticky, so it's the window/body that actually scrolls.
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [effectivePage, selectedClientId]);

  useEffect(() => {
    if (isFlagOn(FEATURE_FLAGS[1].key)) {
      console.log("[MyGoodBooks debug]", { page: effectivePage, clientId: selectedClientId });
    }
  }, [effectivePage, selectedClientId]);

  // Live Report reads as continuously live, not a once-a-day snapshot —
  // dailyCloseFromClient(client) is called fresh on every render and stamps
  // its own "Live as of ..." label from the current clock, so a periodic,
  // otherwise-inert re-render is enough to keep that timestamp (and the
  // pulsing dot next to it) ticking forward on its own.
  const [, tickDailyClose] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tickDailyClose((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, []);

  // Chart/graph entrance animations (bar fills, the income/expense wipe-in,
  // the account donut, DailyClose's sparklines and anomaly rows) only play
  // once a card actually scrolls into view, rather than the instant a page
  // mounts — and each card gets its own randomized pace, via --reveal-dur,
  // so nothing on the page animates in perfect lockstep. The CSS side (see
  // "Chart entrance animations" in styles.css and DailyClose.css) keeps
  // every animated element in its pre-animation state until an ancestor
  // .card/.dc-kpiTile/.dc-panel carries .in-view. A single observer here
  // covers every page: cards mount and unmount as React swaps pages, so a
  // MutationObserver re-scans for newly-added ones instead of wiring this
  // up per page component.
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const seen = new WeakSet();
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const el = entry.target;
          el.style.setProperty("--reveal-dur", Math.round(2550 + Math.random() * 1950) + "ms");
          // A data attribute, not a class: React re-renders these cards often
          // (drag state, widget-layout state, the 30s Live Report tick), and
          // every render recomputes className from scratch, silently wiping
          // an imperatively-added class the next time React commits. React
          // never touches attributes it wasn't told about, so this survives.
          el.setAttribute("data-in-view", "true");
          io.unobserve(el);
        });
      },
      { threshold: 0.2 }
    );
    const scan = () => {
      // .compare-row: the Enterprise upgrade page's tool-by-tool accordion
      // rows aren't .card elements, so they need their own entry here to
      // pick up data-in-view for the same scroll-reveal treatment.
      document.querySelectorAll(".card, .dc-kpiTile, .dc-panel, .compare-row").forEach((el) => {
        if (seen.has(el)) return;
        seen.add(el);
        io.observe(el);
      });
    };
    scan();
    const mo = new MutationObserver(scan);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      io.disconnect();
      mo.disconnect();
    };
  }, []);

  // .content-masonry uses CSS multi-column layout (see its comment in
  // styles.css for why), which packs cards into whichever column the
  // browser's own height-balancing puts them in — there's no CSS selector
  // for "the last card that ended up alone at the bottom, with nothing
  // beside it." So this measures it directly: after layout settles, if the
  // last card's vertical span doesn't overlap any other card's, nothing
  // is next to it, and it gets .cm-solo — which spans the full masonry
  // width and centers itself there (see styles.css) instead of sitting
  // pinned to one column with dead space only on one side.
  useEffect(() => {
    const containers = new Set();
    const settle = () => {
      document.querySelectorAll(".content-masonry").forEach((el) => {
        const kids = Array.from(el.children).filter((c) => c.offsetParent !== null);
        kids.forEach((k) => k.classList.remove("cm-solo"));
        if (kids.length < 2) return;
        const last = kids[kids.length - 1];
        const lastRect = last.getBoundingClientRect();
        const hasNeighbor = kids.some((k) => {
          if (k === last) return false;
          const r = k.getBoundingClientRect();
          return r.top < lastRect.bottom && r.bottom > lastRect.top;
        });
        if (!hasNeighbor) last.classList.add("cm-solo");
      });
    };
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(settle);
    const scanMasonry = () => {
      document.querySelectorAll(".content-masonry").forEach((el) => {
        if (containers.has(el)) return;
        containers.add(el);
        if (ro) ro.observe(el);
      });
      settle();
    };
    scanMasonry();
    const mo2 = new MutationObserver(scanMasonry);
    mo2.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", settle);
    return () => {
      if (ro) ro.disconnect();
      mo2.disconnect();
      window.removeEventListener("resize", settle);
    };
  }, []);

  // Every prominent stat (KPI tiles, Report Builder's big numbers, fund
  // balances, Live Report's own KPI row) counts up from zero as the page
  // first loads. This works on the already-rendered text rather than routing
  // every number through a component: find the first real text node inside
  // the target, pull the numeric run out of it with a regex, and animate that
  // node's data from 0 up to it, leaving any prefix ("$", "-"), suffix
  // (" mo", "%"), and sibling markup (Live Report's cents <small>)
  // untouched. A value with no number in it (e.g. a runway ring reading
  // "Healthy") is simply left alone.
  //
  // Runs for the life of the whole session, not just the opening moments —
  // every page swap mounts fresh KPI/stat DOM nodes (each page component is
  // conditionally rendered, not kept alive off-screen), so the same
  // MutationObserver-driven scan that catches the first page's numbers
  // catches every later page's too, with no separate re-arming needed.
  // Durations are uniform (not randomised per number) so figures in the same
  // KPI row don't land at visibly different times and read as jitter.
  useEffect(() => {
    const seen = new WeakSet();
    const animate = (textNode, prefix, suffix, target, decimals) => {
      const duration = 650;
      const start = performance.now();
      const fmt = (n) => n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
      const frame = (now) => {
        const p = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - p, 3);
        textNode.data = prefix + fmt(target * eased) + suffix;
        if (p < 1) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    };
    const trigger = (el) => {
      const candidates = Array.from(el.childNodes).filter((n) => n.nodeType === Node.TEXT_NODE && n.data.trim());
      const textNode = candidates.find((n) => /\d/.test(n.data)) || candidates[0];
      if (!textNode) return;
      const match = textNode.data.match(/-?[\d,]+(?:\.\d+)?/);
      if (!match) return;
      const target = parseFloat(match[0].replace(/,/g, ""));
      if (Number.isNaN(target)) return;
      const decimals = (match[0].split(".")[1] || "").length;
      animate(textNode, textNode.data.slice(0, match.index), textNode.data.slice(match.index + match[0].length), target, decimals);
    };
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        io.unobserve(entry.target);
        trigger(entry.target);
      });
    }, { threshold: 0.2 });
    const scan = () => {
      document.querySelectorAll(".kpi-value, .rb-big, .rb-preview-stat-value, .fund-balance, .dc-kpiValue, .runway-ring-value, .count-up").forEach((el) => {
        if (seen.has(el)) return;
        seen.add(el);
        io.observe(el);
      });
    };
    scan();
    const mo = new MutationObserver(scan);
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      io.disconnect();
      mo.disconnect();
    };
  }, []);

  // Greet whoever's actually being previewed; otherwise fall back to the
  // client's first listed contact, since that's who'd land on this portal.
  // Only a real previewed person's own name when one is actually being
  // previewed — a signed-in staffer looking at the org with full access
  // isn't John, so "Good morning, John" was flatly wrong (nobody named
  // John is actually there). Falls back to the org's own name instead.
  const greetingName = access.user ? firstNameOf(access.user.name) : client.name;

  // Pop the floating chat widget open when an unread reply arrives — but only
  // once per unread reply. The previous version re-ran on every page change and
  // unconditionally re-set the flag, so dismissing the widget only lasted until
  // the next tab click. Tracking what we've already offered lets a dismissal
  // stick until something actually new shows up.
  // Every unread state we've already popped the widget for. A set, not a single
  // value, so switching to another client and back doesn't re-offer a reply the
  // user already dismissed.
  const offeredChatFor = useRef(new Set());

  // Signature of the current unread state: which threads are waiting, plus the
  // message count, so a *new* reply in an already-unread thread re-opens the
  // widget. A string, not the array, so the effect doesn't re-run every render.
  const unreadSignature = hasUnreadMessages
    ? selectedClientId + "|" + unreadThreadUserIds.join(",") + "|" + liveMessages.length
    : null;

  useEffect(() => {
    // Home already has its own cross-client "Unread messages" card, and the
    // other synthetic staff-only pages (Staff Access, Client Roster,
    // Developer Tools) aren't about any client at all — the floating widget
    // popping up over any of them is redundant at best (Home) and outright
    // confusing at worst (it's scoped to whatever client happened to be
    // last selected, which has nothing to do with that page).
    const canShow = access.tabs.has("messages") && effectivePage !== "messages" && !NON_CLIENT_PAGES.has(effectivePage);
    const signature = unreadSignature;

    if (!signature || !canShow) {
      setChatWidgetOpen(false);
      return;
    }

    // Already offered this exact unread state: respect the user's dismissal
    // instead of reopening on navigation or on returning to this client.
    if (offeredChatFor.current.has(signature)) return;

    offeredChatFor.current.add(signature);
    setChatWidgetOpen(true);
  }, [unreadSignature, effectivePage]);

  const closeChatWidget = () => {
    setChatWidgetOpen(false);
    if (!activeThreadUserId) return;
    setReadMessageClients((prev) => ({
      ...prev,
      [threadKeyFor(selectedClientId, activeThreadUserId)]: liveMessages.length,
    }));
  };

  // A bookkeeper with a real (successful, non-null) assignment fetch but
  // zero checked clients — the opt-in default from staff-client-access.sql.
  // Nothing below this point has a sensible client to show, so stop here
  // rather than let baseClient's CLIENTS[0] fallback silently show data
  // nobody granted them.
  if (assignedClientIds && visibleClients.length === 0) {
    return (
      <div className="boot-splash" role="main">
        <div className="boot-splash-mark">MyGoodBooks</div>
        <div className="boot-splash-sub">
          {effectiveStaffUser.name}, you're signed in but no clients are assigned to you yet. Ask an admin to check
          off at least one client for you under Staff Access.
        </div>
        {impersonating && (
          <button
            onClick={stopImpersonating}
            style={{
              marginTop: 16,
              background: "none",
              border: "none",
              color: "inherit",
              textDecoration: "underline",
              cursor: "pointer",
              font: "inherit",
            }}
          >
            Exit "View as {impersonating.name}"
          </button>
        )}
        <button
          onClick={onSignOut}
          style={{
            marginTop: 16,
            background: "none",
            border: "none",
            color: "inherit",
            textDecoration: "underline",
            cursor: "pointer",
            font: "inherit",
          }}
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <ToastProvider>
      <div className="mesh-bg" aria-hidden="true">
        <span></span>
        <span></span>
        <span></span>
      </div>
      <div className={"app-shell" + (isPreviewingUser ? " previewing" : "")}>
        <div className="mobile-topbar">
          <button className="hamburger-btn" onClick={() => setMobileNavOpen(true)} aria-label="Open menu">
            <span></span>
            <span></span>
            <span></span>
          </button>
          <span className="mobile-topbar-title">
            {NON_CLIENT_PAGES.has(effectivePage) ? "MyGoodBooks" : client.name}
          </span>
        </div>
        <div
          className={"sidebar-scrim" + (mobileNavOpen ? " visible" : "")}
          onClick={() => setMobileNavOpen(false)}
        ></div>
        <Sidebar
          clients={visibleClients}
          selectedClientId={selectedClientId}
          onSelectClient={setSelectedClientId}
          client={client}
          viewAsUserId={viewAsUserId}
          onSelectViewAs={setViewAsUserId}
          access={access}
          page={effectivePage}
          onSelectPage={setPage}
          visibleKeys={access.tabs}
          tabOrder={tabOrder}
          onOpenSettings={() => setSettingsOpen(true)}
          badges={{ messages: hasUnreadMessages }}
          mobileOpen={mobileNavOpen}
          onCloseMobile={() => setMobileNavOpen(false)}
          effectiveTheme={effectiveTheme}
          onToggleTheme={() => setTheme(effectiveTheme === "dark" ? "light" : "dark")}
          staffUser={effectiveStaffUser}
          onSignOut={onSignOut}
          staffMessagesUnread={staffMessagesUnread}
          impersonating={impersonating}
        />
        <main className="main">
          {impersonating && (
            <div className="preview-bar">
              <span>
                Viewing as <strong>{impersonating.name}</strong> — {impersonating.role}. This is exactly what they see
                when they sign in, including their assigned clients and their own reminders.
              </span>
              <button className="preview-exit" onClick={stopImpersonating}>
                Exit "View as"
              </button>
            </div>
          )}
          {isPreviewingUser && (
            <div className="preview-bar">
              <span>
                Previewing as <strong>{access.user.name}</strong> — {access.user.role}. This is exactly what they see
                when they sign in.
              </span>
              <button className="preview-exit" onClick={() => setViewAsUserId(BOOKKEEPER_VIEW)}>
                Exit preview
              </button>
            </div>
          )}

          <div className="page-header">
            <div>
              <div className="portal-greeting">
                {NON_CLIENT_PAGES.has(effectivePage) ? "MyGoodBooks" : client.name}
              </div>
              {NON_CLIENT_PAGES.has(effectivePage) ? (
                <h1 className="page-title">
                  {timeOfDayGreeting()}, {firstNameOf(effectiveStaffUser.name)}
                </h1>
              ) : (
                <h1 className="page-title">
                  {timeOfDayGreeting()}, {greetingName}
                </h1>
              )}
              <div className={"page-subtitle" + (isPremiumPage ? " premium-shimmer" : "")}>{meta.subtitle}</div>
            </div>
            <div className="page-header-actions">
              <span className="badge-live">
                <span className="badge-dot"></span>
                Prototype · Sample Data
              </span>
            </div>
          </div>

          <GlobalSearch
            client={scopedClient}
            messages={liveMessages}
            visibleKeys={access.tabs}
            onNavigate={setPage}
            onHighlightResult={(r) => setSearchTarget({ ...r, nonce: Date.now() })}
            key={"search-" + client.id}
          />

          {effectivePage === "dashboard" &&
            (showsLiveReport ? (
              // A premium, full-access client's "Dashboard" IS the Live
              // Report — one cohesive page instead of two separate tabs
              // both claiming to be "the overview." theme is null until the
              // header toggle is used, in which case DailyClose follows the
              // OS setting via its own dark block — identical to the
              // shell's default. Once toggled, the explicit choice is
              // passed through so both sides stay in step. Data is derived
              // from the selected client rather than the shipped Bramblewood
              // sample, so the panel and the rest of the app agree.
              <DailyClose
                data={dailyCloseFromClient(client)}
                theme={effectiveTheme}
                onNavigate={setPage}
                key={"daily-close-" + client.id}
              />
            ) : access.isCategoryScoped ? (
              <ScopedDashboardPage
                client={scopedClient}
                access={access}
                isBookkeeper={!isPreviewingUser}
                promoText={referralPromo}
                onSaveReferralPromo={saveReferralPromo}
              />
            ) : (
              <DashboardPage
                client={scopedClient}
                access={access}
                isBookkeeper={!isPreviewingUser}
                promoText={referralPromo}
                onSaveReferralPromo={saveReferralPromo}
              />
            ))}
          {effectivePage === "budget" &&
            (showsBudgetingTool ? (
              <BudgetingToolPage client={scopedClient} key={"budgeting-tool-" + client.id} />
            ) : (
              <BudgetPage
                client={scopedClient}
                searchTarget={searchTarget && searchTarget.page === "budget" ? searchTarget : null}
              />
            ))}
          {effectivePage === "giving" &&
            (showsFundAccountingPro ? (
              <FundAccountingProPage client={scopedClient} key={"fund-accounting-pro-" + client.id} />
            ) : (
              <GivingFundsPage client={scopedClient} />
            ))}
          {effectivePage === "receivables" &&
            (showsCashFlowPro ? (
              <APCommandCenterPage client={scopedClient} key={"ap-command-center-" + client.id} />
            ) : (
              <ReceivablesPayablesPage client={scopedClient} />
            ))}
          {effectivePage === "bank" &&
            (showsReconciliationPro ? (
              <BankReconciliationPage
                client={scopedClient}
                searchTarget={searchTarget && searchTarget.page === "bank" ? searchTarget : null}
                key={"bank-reconciliation-" + client.id}
              />
            ) : (
              <BankPage
                client={scopedClient}
                searchTarget={searchTarget && searchTarget.page === "bank" ? searchTarget : null}
                key={"bank-" + client.id}
              />
            ))}
          {effectivePage === "payroll" && <PayrollPage client={scopedClient} key={"payroll-" + client.id} />}
          {effectivePage === "reports" &&
            (showsReportBuilder ? (
              <ReportBuilderPage client={scopedClient} key={"report-builder-" + client.id} />
            ) : (
              <ReportsPage client={scopedClient} />
            ))}
          {effectivePage === "enterprise-upgrade" && <EnterpriseUpgradePage client={scopedClient} key={"enterprise-upgrade-" + client.id} />}
          {effectivePage === "staff-access" && (
            <StaffAccessPage staffUser={staffUser} onImpersonate={startImpersonating} />
          )}
          {effectivePage === "client-access" && <ClientAccessPage />}
          {effectivePage === "staff-messages" && (
            <StaffMessagesPage staffUser={staffUser} onActivity={checkStaffMessagesUnread} />
          )}
          {effectivePage === "developer-tools" && (
            <DeveloperToolsPage
              staffUser={staffUser}
              onJumpToClient={(clientId) => {
                setSelectedClientId(clientId);
                setPage("dashboard");
              }}
            />
          )}
          {effectivePage === "bookkeeper-home" && (
            <BookkeeperHomePage
              staffUser={effectiveStaffUser}
              clients={visibleClients}
              messagesByClient={messagesByClient}
              readMessageClients={readMessageClients}
              onNavigateToClient={(clientId, targetPage) => {
                setSelectedClientId(clientId);
                setPage(targetPage);
              }}
            />
          )}
          {effectivePage === "documents" && (
            <DocumentsPage
              client={scopedClient}
              isBookkeeper={!isPreviewingUser}
              searchTarget={searchTarget && searchTarget.page === "documents" ? searchTarget : null}
              key={"docs-" + client.id}
            />
          )}
          {effectivePage === "messages" && (
            <MessagesPage
              client={scopedClient}
              messages={liveMessages}
              onSend={(text, attachment) => sendMessage(selectedClientId, activeThreadUserId, text, attachment)}
              users={clientUsers}
              activeUserId={activeThreadUserId}
              onSelectUser={setBookkeeperThreadUserId}
              unreadUserIds={unreadThreadUserIds}
              isBookkeeper={!isPreviewingUser}
              bookkeeperTyping={bookkeeperTyping}
              searchTarget={searchTarget && searchTarget.page === "messages" ? searchTarget : null}
              key={"msgs-" + client.id + "-" + activeThreadUserId}
            />
          )}
        </main>
      </div>

      {chatWidgetOpen && (
        // Same tap-to-open button on every screen size now — see ChatFab's
        // own comment for why the floating mini-thread this replaced isn't
        // worth keeping even on desktop.
        <ChatFab
          unreadCount={unreadThreadUserIds.length}
          onOpen={() => {
            setPage("messages");
            closeChatWidget();
          }}
          onDismiss={closeChatWidget}
        />
      )}

      {settingsOpen && (
        <TabSettingsModal
          client={client}
          visibleKeys={visibleKeys}
          tabOrder={tabOrder}
          userAccess={userAccess}
          onToggle={toggleTab}
          onReorder={reorderTab}
          onToggleUserTab={toggleUserTab}
          onToggleUserCategory={toggleUserCategory}
          onToggleUserFund={toggleUserFund}
          onSetAccessLevel={setAccessLevel}
          onToggleUserPremium={toggleUserPremium}
          staffUser={staffUser}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </ToastProvider>
  );
}

// A client's access-request form (see AccessRequestForm above) is reached by
// its own link — ?access-form=<token> — and has to render before AuthGate
// even mounts: the person filling it out has no MyGoodBooks account and
// never will, so gating it behind staff login would make the link useless.
const accessFormToken = new URLSearchParams(window.location.search).get("access-form");

// Phase 2 (real client login) entry point — see components/auth/ClientAuthGate.jsx
// and supabase/client-auth-phase2.sql. Reached the same way as the access
// form: its own query param, checked before AuthGate, since a client signing
// in for real is never a staff member. Renders the same <App> staff use, just
// with clientPortalUser set instead of staffUser — see the comment on App's
// definition for how that pins it to one client with no staff chrome.
// /login is the friendly path (vercel.json rewrites it to index.html, since
// this is otherwise a static single-page app with no server-side router);
// ?client-login=1 stays supported for any link already sent out before
// this existed.
const clientLoginMode =
  window.location.pathname === "/login" ||
  new URLSearchParams(window.location.search).get("client-login") === "1";

function ClientPortalGuard({ clientUser, onSignOut }) {
  // Client data (bank accounts, budget, transactions...) is still mock
  // data.js, not real tables (Phase 3) — a real client_users row whose
  // client_id has no matching CLIENTS entry has nothing to actually show.
  if (!CLIENTS.some((c) => c.id === clientUser.client_id)) {
    return (
      <div className="boot-splash" role="alert">
        <div className="boot-splash-mark">MyGoodBooks</div>
        <div className="boot-splash-sub">
          {clientUser.name}'s account isn't linked to a client MyGoodBooks has set up yet.
        </div>
        <button className="btn-secondary" style={{ marginTop: 16 }} onClick={onSignOut}>
          Sign out
        </button>
      </div>
    );
  }
  return <App clientPortalUser={clientUser} onSignOut={onSignOut} />;
}

// AuthGate (components/auth/AuthGate.jsx) is the Phase-1 login gate: it only
// calls this render prop once a Supabase session exists AND that email is an
// active row in the `staff` table. Until auth-config.js has real Supabase
// credentials, AuthGate shows a "not configured" screen instead — the rest of
// the app is unreachable either way, by design.
ReactDOM.createRoot(document.getElementById("root")).render(
  <ErrorBoundary>
    {accessFormToken ? (
      <AccessRequestForm token={accessFormToken} />
    ) : clientLoginMode ? (
      <ClientAuthGate>
        {(clientUser, onSignOut) => <ClientPortalGuard clientUser={clientUser} onSignOut={onSignOut} />}
      </ClientAuthGate>
    ) : (
      <AuthGate>
        {(staffUser, onSignOut) => <App staffUser={staffUser} onSignOut={onSignOut} />}
      </AuthGate>
    )}
  </ErrorBoundary>
);
