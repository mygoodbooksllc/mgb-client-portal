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
// Used by AP Command Center to bucket payables by due date without drifting
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

const NAV_SECTIONS = [
  {
    label: "Enterprise Tools",
    items: [
      { key: "daily-close", label: "Daily Report", premium: true },
      { key: "report-builder", label: "Report Builder", premium: true },
      { key: "budgeting-tool", label: "Budgeting Tool", premium: true },
      { key: "ap-command-center", label: "AP Command Center", premium: true },
    ],
  },
  {
    label: "Overview",
    items: [
      { key: "dashboard", label: "Dashboard" },
      { key: "budget", label: "Budget vs. Actual" },
    ],
  },
  {
    label: "Finances",
    items: [
      { key: "bank", label: "Bank Accounts" },
      { key: "receivables", label: "Receivables & Payables" },
      { key: "reports", label: "Reports" },
      { key: "giving", label: "Giving & Funds" },
    ],
  },
  {
    label: "Client Tools",
    items: [
      { key: "messages", label: "Messages" },
      { key: "documents", label: "Documents" },
    ],
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
  "report-builder",
  "budgeting-tool",
  "daily-close",
  // Same payables array as Receivables & Payables, which has no category
  // dimension either — a category-scoped user (e.g. Luis, Youth Ministry)
  // has no meaningful "their" bills to filter this down to.
  "ap-command-center",
]);

const BOOKKEEPER_VIEW = "__bookkeeper__";

// Tabs that are part of a paid add-on rather than the base product.
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
    description: "Treat every client as premium, so Enterprise Tools are reachable regardless of their real plan.",
  },
  {
    key: "mygoodbooks_ff_verbose_logging_v1",
    label: "Verbose console logging",
    description: "Log the current page and client id to the console on every navigation, for bug reports.",
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
function resolveAccess(client, viewAsUserId, orgHiddenKeys) {
  // Premium tabs drop out entirely for clients not on the plan, before any
  // per-user scoping runs — an unsubscribed org has no one who can see them.
  const entitled = ALL_TAB_KEYS.filter((k) => !PREMIUM_TAB_KEYS.has(k) || hasPremiumPlan(client));
  const orgAllowed = entitled.filter((k) => k === ALWAYS_VISIBLE_KEY || !orgHiddenKeys.has(k));

  const user =
    viewAsUserId && viewAsUserId !== BOOKKEEPER_VIEW
      ? (client.users || []).find((u) => u.id === viewAsUserId)
      : null;

  if (!user || user.access === "full") {
    return { user, tabs: new Set(orgAllowed), categories: null, funds: null, isCategoryScoped: false, isFullAccess: true };
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
}) {
  // Must match App's `isPreviewingUser` guard: a viewAsUserId that no longer
  // resolves to a user (stale id, user removed) falls back to the bookkeeper
  // view rather than dereferencing a missing access.user below.
  const isBookkeeper = viewAsUserId === BOOKKEEPER_VIEW || !access.user;

  // Which nav sections are collapsed. Deliberately NOT keyed by client id —
  // this is a viewer preference, not client data, so it should persist when
  // switching organizations. Sections start expanded.
  const [collapsedSections, setCollapsedSections] = useState(() => new Set());

  const toggleSection = (label) =>
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });

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
          {page !== "staff-access" && page !== "client-access" && page !== "bookkeeper-home" && (
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
              Home
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
              Client Roster
            </button>
          )}

          {page !== "bookkeeper-home" && page !== "staff-access" && page !== "client-access" && (
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

      {page === "bookkeeper-home" ? (
        <div className="sidebar-home-note">Pick a client above to see their tabs.</div>
      ) : page === "staff-access" || page === "client-access" ? null : (
      <nav className="nav">
        {NAV_SECTIONS.map((section) => {
          const isSignature = section.label === "Enterprise Tools";
          // Standard-plan clients don't have these tabs at all (stripped out
          // of access.tabs in resolveAccess), so the section would normally
          // just vanish. Show a single upsell row instead, so the add-on is
          // discoverable rather than invisible.
          if (isSignature && !hasPremiumPlan(client)) {
            return (
              <div className="nav-section nav-section-signature" key={section.label}>
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
                </button>
              </div>
            );
          }
          const items = orderedSectionItems(section, tabOrder, selectedClientId).filter((item) => visibleKeys.has(item.key));
          if (items.length === 0) return null;
          // Only the Enterprise Tools section collapses — the rest always show
          // their items, so the label is a static heading rather than a toggle.
          const collapsible = isSignature;
          const collapsed = collapsible && collapsedSections.has(section.label);
          // Collapsing the section holding the current page would otherwise
          // hide the only indicator of where you are, so the label carries it.
          const holdsActivePage = items.some((item) => item.key === page);
          const sectionId = "nav-section-" + slugify(section.label);
          return (
            <div className={"nav-section" + (collapsed ? " collapsed" : "") + (isSignature ? " nav-section-signature" : "")} key={section.label}>
              {collapsible ? (
                <button
                  type="button"
                  className={"nav-section-label" + (collapsed && holdsActivePage ? " holds-active" : "") + (isSignature ? " nav-section-label-signature" : "")}
                  onClick={() => toggleSection(section.label)}
                  aria-expanded={!collapsed}
                  aria-controls={sectionId}
                >
                  <span className="nav-section-chevron" aria-hidden="true">
                    ▾
                  </span>
                  <span>{section.label}</span>
                  {collapsed && badges && items.some((item) => badges[item.key]) && (
                    <span className="nav-badge-dot" aria-label="Unread"></span>
                  )}
                </button>
              ) : null}
              <div className="nav-section-items" id={sectionId} hidden={collapsed}>
                {items.map((item) => (
                  <button
                    key={item.key}
                    className={"nav-item" + (page === item.key ? " active" : "") + (isSignature ? " nav-item-signature" : "")}
                    onClick={() => {
                      onSelectPage(item.key);
                      onCloseMobile();
                    }}
                  >
                    <span>{item.label}</span>
                    {badges[item.key] && <span className="nav-badge-dot" aria-label="Unread"></span>}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </nav>
      )}

      <div className="sidebar-utility-row">
        {isBookkeeper && page !== "bookkeeper-home" && page !== "staff-access" && page !== "client-access" ? (
          <button className="customize-tabs-btn" onClick={onOpenSettings}>
            ⚙ Manage access
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
          {effectiveTheme === "dark" ? "☀️" : "🌙"}
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

function MockBanner({ text }) {
  return <div className="mock-banner">🧪 {text}</div>;
}

// Real (non-AI) search — filters this client's own transactions, budget
// categories, documents, and messages by keyword and jumps to the right
// page. Only searches within tabs the current viewer actually has access to.
function GlobalSearch({ client, messages, visibleKeys, onNavigate }) {
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
        a.transactions.forEach((t) => {
          if (t.description.toLowerCase().includes(q) || t.category.toLowerCase().includes(q)) {
            out.push({
              type: "Transaction",
              label: t.description,
              meta: `${fmtDate(t.date)} · ${fmtMoney(t.amount, { cents: true })} · ${a.accountName}`,
              page: "bank",
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
          });
        }
      });
    }

    if (visibleKeys.has("messages")) {
      messages.forEach((m) => {
        if (m.text && m.text.toLowerCase().includes(q)) {
          out.push({
            type: "Message",
            label: m.text.length > 70 ? m.text.slice(0, 70) + "…" : m.text,
            meta: `${m.author} · ${fmtDate(m.date)}`,
            page: "messages",
          });
        }
      });
    }

    return out.slice(0, 8);
  }, [query, client, messages, visibleKeys]);

  const go = (page) => {
    onNavigate(page);
    setIsOpen(false);
    setQuery("");
  };

  return (
    <div className="global-search" ref={wrapRef}>
      <div className="global-search-row">
        <span className="global-search-icon">🔍</span>
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
              <button className="global-search-result" key={i} onClick={() => go(r.page)}>
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
// enough for 6 monthly points, no need for full Catmull-Rom.
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
function IncomeExpenseChart({ monthly }) {
  const width = 640;
  const height = 220;
  const padding = { top: 32, right: 14, bottom: 28, left: 46 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const baseline = padding.top + innerH;

  const maxVal = Math.max(...monthly.flatMap((m) => [m.income, m.expenses])) * 1.15;

  const yTicks = 4;
  const tickVals = Array.from({ length: yTicks + 1 }, (_, i) => (maxVal / yTicks) * i);

  const xFor = (i) => padding.left + (monthly.length === 1 ? innerW / 2 : (i / (monthly.length - 1)) * innerW);
  const incomePoints = monthly.map((m, i) => ({ x: xFor(i), y: baseline - (m.income / maxVal) * innerH }));
  const expensePoints = monthly.map((m, i) => ({ x: xFor(i), y: baseline - (m.expenses / maxVal) * innerH }));

  const gradientId = `oc-income-fill-${monthly.length}-${Math.round(maxVal)}`;
  const gradientIdExp = `oc-expense-fill-${monthly.length}-${Math.round(maxVal)}`;

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
      sourceTab: "Receivables & Payables",
      label: "Receivables & Payables",
      description: "What's owed to you and what you owe",
      render: () => (
        <>
          <h3 className="card-title">Receivables & Payables</h3>
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
          if (id === "kpi-budgeted")
            return (
              <div className={"card kpi-card " + drag.dragClass(id)} key={id} {...drag.dragProps(id)}>
                <span className="kpi-label">Budgeted (your areas)</span>
                <span className="kpi-value">{fmtMoney(budgeted)}</span>
                <span className="kpi-sub neutral">this month</span>
              </div>
            );
          if (id === "kpi-spent")
            return (
              <div className={"card kpi-card " + drag.dragClass(id)} key={id} {...drag.dragProps(id)}>
                <span className="kpi-label">Spent (your areas)</span>
                <span className="kpi-value">{fmtMoney(spent)}</span>
                <span className={"kpi-sub " + (spent > budgeted ? "negative" : "positive")}>
                  {spent > budgeted ? "Over budget" : "Within budget"}
                </span>
              </div>
            );
          if (id === "kpi-remaining")
            return (
              <div className={"card kpi-card " + drag.dragClass(id)} key={id} {...drag.dragProps(id)}>
                <span className="kpi-label">Remaining</span>
                <span className="kpi-value">{fmtMoney(remaining)}</span>
                <span className="kpi-sub neutral">{budgeted > 0 ? `${Math.round((spent / budgeted) * 100)}% used` : "—"}</span>
              </div>
            );
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
                <div className={"card " + drag.dragClass(id)} key={id} {...drag.dragProps(id)}>
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
    { id: "income-expenses", group: "content", label: "Income vs. Expenses", description: "6-month trend chart" },
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
          return k.ring ? (
            <div className={"card kpi-card runway-ring-card " + drag.dragClass(id)} key={id} {...drag.dragProps(id)}>
              <span className="kpi-label">{k.label}</span>
              <RunwayRing pct={k.ring.pct} tone={k.tone}>
                <div className="runway-ring-value">{k.value}</div>
                <div className={"runway-ring-status " + k.tone}>{k.ring.status}</div>
              </RunwayRing>
              <span className={"kpi-sub " + k.tone}>{k.sub}</span>
            </div>
          ) : (
            <div
              className={"card kpi-card" + (k.cardTone ? " kpi-card-" + k.cardTone : "") + " " + drag.dragClass(id)}
              key={id}
              {...drag.dragProps(id)}
            >
              <span className="kpi-label">{k.label}</span>
              <span className="kpi-value">{k.value}</span>
              <span className={"kpi-sub " + k.tone}>{k.sub}</span>
            </div>
          );
        })}
      </div>

      <div className="content-masonry">
        {layout.visibleOrder
          .filter((id) => !id.startsWith("kpi-"))
          .map((id) => {
            if (id === "income-expenses")
              return (
                <div className={"card " + drag.dragClass(id)} key={id} {...drag.dragProps(id)}>
                  <h3 className="card-title">Income vs. Expenses</h3>
                  <p className="card-subtitle">Last 6 months</p>
                  <IncomeExpenseChart monthly={client.monthly} />
                  <CategoryLedger client={client} />
                </div>
              );
            if (id === "recent-activity")
              return (
                <div className={"card " + drag.dragClass(id)} key={id} {...drag.dragProps(id)}>
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

function BudgetPage({ client }) {
  const totals = client.budget.reduce(
    (acc, b) => {
      acc.budgeted += b.budgeted;
      acc.actual += b.actual;
      return acc;
    },
    { budgeted: 0, actual: 0 }
  );

  return (
    <div>
      <MockBanner text="Budget figures are hardcoded for this prototype. In Phase 2 these will sync from QuickBooks budgets." />

      <div className="kpi-grid">
        <div className="card kpi-card">
          <span className="kpi-label">Total Budgeted (this month)</span>
          <span className="kpi-value">{fmtMoney(totals.budgeted)}</span>
        </div>
        <div className="card kpi-card">
          <span className="kpi-label">Total Actual (this month)</span>
          <span className="kpi-value">{fmtMoney(totals.actual)}</span>
        </div>
        <div className="card kpi-card">
          <span className="kpi-label">Variance</span>
          <span className="kpi-value">{fmtMoney(totals.actual - totals.budgeted)}</span>
          <span className={"kpi-sub " + (totals.actual > totals.budgeted ? "negative" : "positive")}>
            {totals.actual > totals.budgeted ? "Over budget" : "Under budget"}
          </span>
        </div>
      </div>

      <div className="card">
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
    </div>
  );
}

// ----------------------------------------------------------------------------
// Giving & Funds page
// ----------------------------------------------------------------------------

function GivingFundsPage({ client }) {
  const totalGiving = client.contributions.reduce((s, c) => s + c.amount, 0);
  const restrictedTotal = client.funds.filter((f) => f.restricted).reduce((s, f) => s + f.balance, 0);
  const unrestrictedTotal = client.funds.filter((f) => !f.restricted).reduce((s, f) => s + f.balance, 0);

  return (
    <div>
      <MockBanner text="Giving records and fund balances shown here are fabricated for this prototype." />

      <div className="kpi-grid">
        <div className="card kpi-card">
          <span className="kpi-label">Recent Giving</span>
          <span className="kpi-value">{fmtMoney(totalGiving)}</span>
          <span className="kpi-sub neutral">{client.contributions.length} gifts shown below</span>
        </div>
        <div className="card kpi-card">
          <span className="kpi-label">Unrestricted Funds</span>
          <span className="kpi-value">{fmtMoney(unrestrictedTotal)}</span>
          <span className="kpi-sub positive">Available for general use</span>
        </div>
        <div className="card kpi-card">
          <span className="kpi-label">Restricted Funds</span>
          <span className="kpi-value">{fmtMoney(restrictedTotal)}</span>
          <span className="kpi-sub neutral">Designated for specific purposes</span>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
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
    </div>
  );
}

// ----------------------------------------------------------------------------
// Receivables & Payables page
// ----------------------------------------------------------------------------

function ReceivablesPayablesPage({ client }) {
  const totalReceivable = client.receivables.reduce((s, r) => s + r.amount, 0);
  const totalPayable = client.payables.reduce((s, p) => s + p.amount, 0);

  return (
    <div>
      <MockBanner text="These balances are hardcoded for the prototype. Real amounts will come from QuickBooks in Phase 2." />

      <div className="kpi-grid">
        <div className="card kpi-card">
          <span className="kpi-label">Money Owed To You</span>
          <span className="kpi-value">{fmtMoney(totalReceivable)}</span>
          <span className="kpi-sub positive">{client.receivables.length} open item{client.receivables.length !== 1 ? "s" : ""}</span>
        </div>
        <div className="card kpi-card">
          <span className="kpi-label">Money You Owe</span>
          <span className="kpi-value">{fmtMoney(totalPayable)}</span>
          <span className="kpi-sub negative">{client.payables.length} open item{client.payables.length !== 1 ? "s" : ""}</span>
        </div>
        <div className="card kpi-card">
          <span className="kpi-label">Net Position</span>
          <span className="kpi-value">{fmtMoney(totalReceivable - totalPayable)}</span>
          <span className="kpi-sub neutral">receivables minus payables</span>
        </div>
      </div>

      <div className="content-masonry">
        <div className="card">
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

        <div className="card">
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

const ACCOUNT_DONUT_COLORS = ["var(--gold)", "var(--good)", "var(--bad)", "var(--gold-deep)"];

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

function BankPage({ client }) {
  const [activeAccountId, setActiveAccountId] = useState(client.bankAccounts[0].id);
  const showToast = useToast();
  const account = client.bankAccounts.find((a) => a.id === activeAccountId) || client.bankAccounts[0];
  const cash = totalCash(client);

  const exportCSV = () => {
    const rows = [
      ["Date", "Description", "Category", "Amount"],
      ...account.transactions.map((t) => [t.date, t.description, t.category, t.amount]),
    ];
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${client.name.replace(/\s+/g, "_")}_${account.accountName.replace(/\s+/g, "_")}_transactions.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`Exported ${account.transactions.length} transactions to CSV.`);
  };

  return (
    <div>
      <MockBanner text="Account balances and transactions are fabricated sample data — no bank is connected yet." />

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
            <p className="card-subtitle" style={{ margin: 0 }}>Most recent activity on this account — scroll to go back further</p>
          </div>
          <button className="btn-secondary" onClick={exportCSV}>
            Export CSV
          </button>
        </div>
        <div className="table-scroll tx-list-scroll">
<table className="tx-table tx-table-stack tx-stack-bank" style={{ marginTop: 16 }}>
          <thead>
            <tr>
              <th>Date</th>
              <th>Description</th>
              <th>Category</th>
              <th className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {account.transactions.map((t, i) => (
              <tr key={i}>
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
    </div>
  );
}

// ----------------------------------------------------------------------------
// PDF report generation
// Builds real, downloadable PDFs from a client's data using jsPDF (loaded
// from a CDN in index.html, since this prototype has no bundler/npm install).
// ----------------------------------------------------------------------------

const sanitizeFilename = (s) => s.replace(/[\\/:*?"<>|]/g, "");

const PDF_TABLE_THEME = {
  theme: "striped",
  styles: { fontSize: 9, cellPadding: 3, textColor: [36, 55, 70] },
  headStyles: { fillColor: [36, 55, 70], textColor: [250, 249, 246], fontStyle: "bold" },
  footStyles: { fillColor: [199, 174, 134], textColor: [36, 55, 70], fontStyle: "bold" },
  margin: { left: 14, right: 14 },
};

function newReportDoc(title, subtitle, client) {
  const doc = new window.jspdf.jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFillColor(36, 55, 70);
  doc.rect(0, 0, pageWidth, 28, "F");
  doc.setTextColor(250, 249, 246);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("MyGoodBooks", 14, 12);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(client.name, 14, 19.5);

  doc.setTextColor(36, 55, 70);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(title, 14, 40);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(110, 110, 110);
  doc.text(subtitle, 14, 47);

  return doc;
}

function buildProfitAndLossPdf(client) {
  // Sourced from `monthly` and `budget`, not the transaction register: the
  // register is a short sample of recent activity, so summing it would
  // contradict the revenue figures shown on the dashboard.
  const latestMonth = client.monthly[client.monthly.length - 1];
  const period = `${latestMonth.month} ${new Date().getFullYear()}`;
  const expenseRows = client.budget
    .map((b) => [b.category, b.actual])
    .sort((a, b) => b[1] - a[1]);
  const categorizedExpenses = expenseRows.reduce((s, [, v]) => s + v, 0);

  const doc = newReportDoc("Profit & Loss Statement", `For the month of ${period}`, client);

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
    head: [[`Expenses by Category — ${period}`, "Amount"]],
    body: expenseRows.map(([cat, amt]) => [cat, fmtMoney(amt)]),
    foot: [["Total Categorized Expenses", fmtMoney(categorizedExpenses)]],
    columnStyles: { 1: { halign: "right" } },
    ...PDF_TABLE_THEME,
  });

  let y = doc.lastAutoTable.finalY + 12;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(36, 55, 70);
  doc.text(`Total Income (${period}): ${fmtMoney(latestMonth.income)}`, 14, y);
  doc.text(`Total Expenses (${period}): ${fmtMoney(latestMonth.expenses)}`, 14, y + 7);
  doc.text(
    `Net Income (${period}): ${fmtMoney(latestMonth.income - latestMonth.expenses)}`,
    14,
    y + 16
  );

  const filename = `${sanitizeFilename(client.name)} - Profit and Loss.pdf`;
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
  doc.setTextColor(36, 55, 70);
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
};

// ----------------------------------------------------------------------------
// Reports page
// ----------------------------------------------------------------------------

const REPORT_TYPES = [
  { key: "pl", name: "Profit & Loss Statement", description: "Income and expenses for the selected period." },
  { key: "bs", name: "Balance Sheet", description: "Assets, liabilities, and fund balances as of month end." },
  { key: "budget", name: "Budget vs. Actual Report", description: "Category-by-category comparison for the current month." },
  { key: "giving", name: "Contribution Statement (YTD)", description: "Giving summary by fund, ready to share with your board or donors." },
];

function ReportsPage({ client }) {
  const showToast = useToast();

  const handleDownload = (r) => {
    const filename = REPORT_PDF_BUILDERS[r.key](client);
    showToast(`Downloaded "${filename}"`);
  };

  return (
    <div>
      <MockBanner text="Reports are generated as real PDFs from this client's mock data — once QuickBooks is connected in Phase 2, these will reflect live books." />
      <div className="report-grid">
        {REPORT_TYPES.map((r) => (
          <div className="card report-card" key={r.key}>
            <h3 className="card-title">{r.name}</h3>
            <p className="card-subtitle">{r.description}</p>
            <button className="btn-primary" onClick={() => handleDownload(r)}>
              Download PDF
            </button>
          </div>
        ))}
      </div>
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
// Enterprise Tools upgrade preview — what a standard-plan client's "+" in the
// sidebar opens instead of the real Daily Report/Report Builder/Budgeting
// Tool pages, which are stripped out of their access.tabs entirely.
// ----------------------------------------------------------------------------

const ENTERPRISE_FEATURES = [
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <rect x="5" y="3" width="14" height="18" rx="2" />
        <path d="M9 8h6M9 12h6M9 16h4" />
      </svg>
    ),
    title: "Daily Report",
    description: "A fresh financial snapshot every morning — cash on hand, receivables, what's due — before your coffee's ready.",
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 20V10M9.5 20V4M15 20V13M20.5 20V7" />
      </svg>
    ),
    title: "Report Builder",
    description: "Assemble a formatted board report from your own numbers in a couple of clicks — pick a period, a scope, and the sections that matter this quarter.",
  },
  {
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" />
        <path d="M9 12l2 2 4-4" />
      </svg>
    ),
    title: "Budgeting Tool",
    description: "Draft next period's budget together with your bookkeeper, category by category, before it's locked in.",
  },
];

function EnterpriseUpgradePage({ client }) {
  const showToast = useToast();

  return (
    <div>
      <MockBanner text="This is a preview of what Enterprise Tools includes — nothing here is connected to a real upgrade flow yet." />

      <div className="card" style={{ marginBottom: 20, textAlign: "center", padding: "36px 28px" }}>
        <div className="eyebrow-badge">Enterprise Tools · Add-on</div>
        <h2 style={{ fontFamily: "var(--font-heading)", fontSize: 26, margin: "10px 0 8px", color: "var(--ink-strong)" }}>
          Unlock Enterprise Tools for {client.name}
        </h2>
        <p style={{ color: "var(--text-muted)", maxWidth: 520, margin: "0 auto" }}>
          Three tools built for organizations that want more than a monthly statement — a daily pulse on the numbers, a
          board-ready report in minutes, and a shared space to plan next period's budget.
        </p>
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
  { key: "receivables", label: "Receivables & Payables" },
  { key: "giving", label: "Giving & Funds" },
  { key: "outlook", label: "Outlook" },
];

function ReportBuilderPage({ client }) {
  const [stage, setStage] = useState("builder"); // "builder" | "report"
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
    receivables: false,
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

        <div className="rb-layout">
          <div className="card rb-panel">
            <h3 className="card-title">Build a report</h3>
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
            <h2>Receivables &amp; Payables</h2>
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

  return (
    <div>
      <MockBanner text="This is a working draft space — nothing here is saved anywhere real yet, and submitting doesn't notify anyone." />

      <div className="kpi-grid">
        <div className="card kpi-card">
          <span className="kpi-label">Current Budget Total</span>
          <span className="kpi-value">{fmtMoney(totalCurrent)}</span>
        </div>
        <div className="card kpi-card">
          <span className="kpi-label">Proposed Budget Total</span>
          <span className="kpi-value">{fmtMoney(totalProposed)}</span>
        </div>
        <div className="card kpi-card">
          <span className="kpi-label">Change</span>
          <span className="kpi-value">
            {(pctChange >= 0 ? "+" : "") + pctChange.toFixed(1)}%
          </span>
          <span className="kpi-sub neutral">vs. current budget</span>
        </div>
      </div>

      <div className="card">
        <h3 className="card-title">Draft Budget by Category</h3>
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
            {rows.map((r, i) => (
              <tr key={i}>
                <td data-primary="">{r.category}</td>
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
            ))}
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
    </div>
  );
}

// ----------------------------------------------------------------------------
// AP Command Center — a bookkeeper-grade view of the same payables shown
// under Receivables & Payables: status filters, an aging summary, and a
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
  const today = todayLocal();

  const rows = useMemo(() => {
    return client.payables.map((p) => {
      const diff = daysUntil(p.dueDate, today);
      const status = diff < 0 ? "overdue" : diff <= AP_SOON_DAYS ? "soon" : "scheduled";
      return { ...p, diff, status };
    });
  }, [client.payables, today]);

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

  return (
    <div>
      <MockBanner text="These are the same sample payables shown under Receivables & Payables. Connect QuickBooks to replace this with live AP data." />

      <div className="kpi-grid">
        <div className="card kpi-card">
          <span className="kpi-label">Total Payable</span>
          <span className="kpi-value">{fmtMoney(totals.all.amount)}</span>
          <span className="kpi-sub neutral">
            {totals.all.count} open bill{totals.all.count !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="card kpi-card">
          <span className="kpi-label">Overdue</span>
          <span className="kpi-value negative">{fmtMoney(totals.overdue.amount)}</span>
          <span className="kpi-sub negative">
            {totals.overdue.count} bill{totals.overdue.count !== 1 ? "s" : ""} past due
          </span>
        </div>
        <div className="card kpi-card">
          <span className="kpi-label">Due Within {AP_SOON_DAYS} Days</span>
          <span className="kpi-value warm">{fmtMoney(totals.soon.amount)}</span>
          <span className="kpi-sub warm">
            {totals.soon.count} bill{totals.soon.count !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="card kpi-card">
          <span className="kpi-label">Scheduled</span>
          <span className="kpi-value">{fmtMoney(totals.scheduled.amount)}</span>
          <span className="kpi-sub neutral">
            {totals.scheduled.count} bill{totals.scheduled.count !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="ap-cc-toolbar">
          <div>
            <h3 className="card-title">Open Bills</h3>
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
                <th>Vendor</th>
                <th>Status</th>
                <th className="num">Amount</th>
                <th>Due</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((r, i) => {
                const meta = AP_STATUS_META[r.status];
                return (
                  <tr key={i}>
                    <td data-primary="">
                      {r.vendor}
                      <div className="tx-meta">{r.description}</div>
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
                  <td colSpan={4} className="ap-cc-empty">
                    No bills match this filter.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>Total shown</td>
                <td className="num tx-amount negative">-{fmtMoney(shownTotal, { cents: true })}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="content-masonry">
        <div className="card">
          <h3 className="card-title">Aging Summary</h3>
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

// Opens the admin's own mail client with a ready-to-send invite. There's no
// backend to send real email from yet (Phase 3), so this is the honest
// version of "real" available right now: an actual email the admin reviews
// and hits send on, rather than a simulated toast that claims to have sent
// something it didn't.
function buildInviteMailto(row) {
  const firstName = firstNameOf(row.name);
  const subject = "You're set up on the MyGoodBooks client portal";
  const body =
    `Hi ${firstName},\n\n` +
    `You've been added to the MyGoodBooks client portal as a ${row.role}. ` +
    `Sign in at https://app.mygoodbooks.org with your Google Workspace account (${row.email}) — ` +
    `click "Sign in with Google" and you're in, nothing else to set up.\n\n` +
    `Questions, just reply here.`;
  return `mailto:${row.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
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

// Cleared by Staff Access's "Reset local state" button. Everything here is a
// per-browser viewer preference (theme, tab layout, per-client-user access
// overrides, ...), never anything from Supabase, so clearing it can't lose
// real data — only whatever local customization got the browser stuck.
const RESETTABLE_STORAGE_KEYS = [
  "mygoodbooks_theme_v1",
  "mygoodbooks_page_v1",
  "mygoodbooks_tab_config_v2",
  "mygoodbooks_tab_order_v1",
  "mygoodbooks_dashboard_widgets_v1",
  "mygoodbooks_referral_promo_v1",
];

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
  const [auditRows, setAuditRows] = useState(null);
  const [auditError, setAuditError] = useState("");
  const [flagVersion, setFlagVersion] = useState(0); // bumped to force a re-read of localStorage
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

  const loadAudit = useCallback(() => {
    if (!supabase) return;
    supabase
      .from("staff_audit_log")
      .select("id, actor_email, action, target_email, detail, created_at")
      .order("created_at", { ascending: false })
      .limit(20)
      .then(({ data, error }) => {
        if (error) {
          // Most likely cause: supabase/staff-audit-log.sql hasn't been run
          // yet. Not fatal to the rest of the page, so this stays quiet
          // rather than another red banner on top of the roster's own.
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
    loadAudit();
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
    loadAudit();
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
    loadAudit();
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
    loadAudit();
  }

  function resetLocalState() {
    if (
      !window.confirm(
        "Reset this browser's local MyGoodBooks state (theme, tab layout, dashboard widgets, per-person access overrides)? This only affects this browser — nothing in Supabase is touched. The page will reload."
      )
    ) {
      return;
    }
    RESETTABLE_STORAGE_KEYS.forEach((key) => {
      try {
        localStorage.removeItem(key);
      } catch (e) {}
    });
    window.location.reload();
  }

  function toggleFlag(key) {
    setFlag(key, !isFlagOn(key));
    setFlagVersion((v) => v + 1);
  }

  return (
    <div>
      <div className="mock-banner">
        ⚠️ This page writes directly to the real staff table in Supabase — unlike the rest of the app, nothing here
        is sample data.
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
                          <a className="btn-secondary staff-invite-btn" href={buildInviteMailto(row)}>
                            Email invite
                          </a>
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

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 className="card-title">Recent activity</h3>
        <p className="card-subtitle">
          Every change to the staff table, logged automatically by Postgres — not just the ones made from this page.
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

      <div className="content-masonry" style={{ marginBottom: 20 }}>
        <div className="card">
          <h3 className="card-title">System info</h3>
          <p className="card-subtitle">What this page is actually talking to, for debugging a broken login or a stale deploy.</p>
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
              <dd className={loadError ? "negative" : rows ? "positive" : ""}>
                {loadError ? "Failing — see the roster card above" : rows ? "OK" : "Checking…"}
              </dd>
            </div>
            <div>
              <dt>Audit log read</dt>
              <dd className={auditError ? "negative" : auditRows ? "positive" : ""}>
                {auditError ? "Failing — run staff-audit-log.sql" : auditRows ? "OK" : "Checking…"}
              </dd>
            </div>
            <div>
              <dt>Signed in as</dt>
              <dd>
                {staffUser.name} ({staffUser.email}) · {staffUser.role}
              </dd>
            </div>
          </dl>
        </div>

        <div className="card">
          <h3 className="card-title">Developer tools</h3>
          <p className="card-subtitle">Per-browser testing aids — nothing here is shared with other staff or written to Supabase.</p>

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
              Clears this browser's saved theme, tab layout, dashboard widgets, and per-person access overrides, then
              reloads. Doesn't touch Supabase or any other browser.
            </p>
          </div>
        </div>
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
        ⚠️ This page writes directly to the real client_users table in Supabase. It only
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
  const [clientSearch, setClientSearch] = useState("");

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
  // first — same overdue/soon/scheduled split as AP Command Center, just
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

  return (
    <div>
      <CustomizeDashboardButton widgets={widgets} layout={layout} />

      <div className="kpi-grid">
        {kpiOrder.map((id) => {
          if (id === "kpi-clients")
            return (
              <div className={"card kpi-card " + drag.dragClass(id)} key={id} {...drag.dragProps(id)}>
                <span className="kpi-label">Your clients</span>
                <span className="kpi-value">{clients.length}</span>
                <span className="kpi-sub neutral">
                  {clients.length === 0 ? "none assigned yet" : `client${clients.length === 1 ? "" : "s"} you can see`}
                </span>
              </div>
            );
          if (id === "kpi-overdue")
            return (
              <div className={"card kpi-card " + drag.dragClass(id)} key={id} {...drag.dragProps(id)}>
                <span className="kpi-label">Overdue bills</span>
                <span className="kpi-value negative">{overdueCount}</span>
                <span className="kpi-sub negative">across all your clients</span>
              </div>
            );
          if (id === "kpi-soon")
            return (
              <div className={"card kpi-card " + drag.dragClass(id)} key={id} {...drag.dragProps(id)}>
                <span className="kpi-label">Due within {AP_SOON_DAYS} days</span>
                <span className="kpi-value warm">{soonCount}</span>
                <span className="kpi-sub warm">across all your clients</span>
              </div>
            );
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
              <div className={"card " + drag.dragClass(id)} key={id} {...drag.dragProps(id)}>
                <h3 className="card-title">Needs attention</h3>
                <p className="card-subtitle">Overdue or due soon, across every client you can see.</p>
                {dueAcrossClients.length === 0 && <p className="card-subtitle">Nothing due soon — you're caught up.</p>}
                {dueAcrossClients.length > 0 && (
                  <div className="staff-audit-list">
                    {dueAcrossClients.slice(0, 12).map((r, i) => (
                      <button
                        className="staff-due-row"
                        key={i}
                        onClick={() => onNavigateToClient(r.clientId, "ap-command-center")}
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
              <div className={"card " + drag.dragClass(id)} key={id} {...drag.dragProps(id)}>
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

function DocumentsPage({ client, isBookkeeper }) {
  const [docs, setDocs] = useState(client.documents);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);
  const showToast = useToast();

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

  return (
    <div>
      <MockBanner text="Uploaded files stay in your browser for this session only — nothing is actually stored yet." />

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
        style={{ marginBottom: 20 }}
      >
        <div className="upload-content">
          <div className="dropzone-icon">⬆</div>
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
        <h3 className="card-title">All Documents</h3>
        <p className="card-subtitle">{docs.length} file{docs.length !== 1 ? "s" : ""}</p>
        <div className="table-scroll">
<table className="tx-table tx-table-labeled">
          <thead>
            <tr>
              <th>Name</th>
              <th>Category</th>
              <th>Uploaded By</th>
              <th>Date</th>
              {isBookkeeper && <th>Visible To</th>}
              <th className="num">Size</th>
            </tr>
          </thead>
          <tbody>
            {docs.map((d, i) => (
              <tr key={i}>
                <td data-primary="">{d.name}</td>
                <td data-label="Category">
                  <span className="category-tag">{d.category}</span>
                </td>
                <td data-label="Uploaded by">{d.uploadedBy}</td>
                <td data-label="Date">{fmtDate(d.date)}</td>
                {isBookkeeper && (
                  <td data-label="Visible to">
                    <button
                      className={"visibility-toggle" + (d.visibility === "full" ? " restricted" : "")}
                      onClick={() => toggleVisibility(i)}
                      title="Click to change who at this organization can see this file"
                    >
                      {d.visibility === "full" ? "🔒 Full access only" : "Everyone"}
                    </button>
                  </td>
                )}
                <td className="num" data-label="Size">{d.size}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Floating chat widget — surfaces an active conversation from any page so
// the client doesn't have to be sitting on the Messages tab to see it.
// ----------------------------------------------------------------------------

function ChatWidget({ messages, onSend, onOpenFull, onClose }) {
  const [draft, setDraft] = useState("");
  const recent = messages.slice(-3);
  const threadRef = useRef(null);

  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [messages.length]);

  const send = () => {
    if (!draft.trim()) return;
    onSend(draft.trim());
    setDraft("");
  };

  return (
    <div className="chat-widget">
      <div className="chat-widget-header">
        <span className="chat-widget-title">💬 MyGoodBooks</span>
        <button className="modal-close" onClick={onClose} aria-label="Close chat">
          ×
        </button>
      </div>

      <div className="chat-widget-thread" ref={threadRef}>
        {recent.map((m, i) => (
          <div className={"message-bubble-row " + m.from} key={i}>
            <div className="message-bubble">
              <div className="message-author">{m.author}</div>
              {m.text && <div className="message-text">{m.text}</div>}
              <div className="message-date">{fmtDate(m.date)}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="chat-widget-compose">
        <input
          type="text"
          placeholder="Reply…"
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

      <button className="chat-widget-viewall" onClick={onOpenFull}>
        Open full conversation →
      </button>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Messages page
// ----------------------------------------------------------------------------

function MessagesPage({ client, messages, onSend, users, activeUserId, onSelectUser, unreadUserIds, isBookkeeper }) {
  const [draft, setDraft] = useState("");
  const [pendingAttachment, setPendingAttachment] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

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
          {isBookkeeper && activeUser ? `Conversation with ${activeUser.name}` : "Conversation with MyGoodBooks"}
        </h3>
        {messages.length === 0 && (
          <p className="card-subtitle">No messages yet in this conversation.</p>
        )}
        <div className="message-thread">
          {messages.map((m, i) => (
            <div className={"message-bubble-row " + m.from} key={i}>
              <div className="message-bubble">
                <div className="message-author">{m.author}</div>
                {m.text && <div className="message-text">{m.text}</div>}
                {m.attachment && (
                  <div className="message-attachment">
                    📎 {m.attachment.name} <span className="message-attachment-size">({m.attachment.size})</span>
                  </div>
                )}
                <div className="message-date">{fmtDate(m.date)}</div>
              </div>
            </div>
          ))}
        </div>

        {pendingAttachment && (
          <div className="attachment-chip">
            <span>📎 {pendingAttachment.name}</span>
            <span className="attachment-chip-meta">{pendingAttachment.size}</span>
            <button className="attachment-remove" onClick={() => setPendingAttachment(null)} aria-label="Remove attachment">
              ×
            </button>
          </div>
        )}

        <div className="message-compose">
          <button type="button" className="attach-btn" onClick={() => fileInputRef.current.click()} aria-label="Attach file">
            📎
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
  onBack,
}) {
  const isFull = user.access === "full";
  const effective = userAccess[user.id] || {};
  const userTabs = new Set(effective.tabs || user.tabs || orgAllowedKeys);
  const userCats = new Set(effective.categories || user.categories || []);
  const isCategoryScoped = Boolean(effective.categories || user.categories);
  const userFunds = new Set(effective.funds || user.funds || []);

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
  onClose,
}) {
  const [draggedKey, setDraggedKey] = useState(null);
  const [dragOverKey, setDragOverKey] = useState(null);
  const [editingUserId, setEditingUserId] = useState(null);
  const [tab, setTab] = useState("people");

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
        </div>

        {tab === "people" ? (
          <div className="modal-body">
            <p className="card-subtitle" style={{ marginTop: 0 }}>
              Only MyGoodBooks can change these. Nobody at {client.name} can widen their own access.
            </p>
            {(client.users || []).map((u) => {
              const eff = userAccess[u.id] || {};
              const cats = eff.categories || u.categories;
              return (
                <button className="person-row" key={u.id} onClick={() => setEditingUserId(u.id)}>
                  <div className="person-avatar">
                    {u.name.split(" ").map((p) => p[0]).slice(0, 2).join("")}
                  </div>
                  <div className="person-text">
                    <span className="person-name">{u.name}</span>
                    <span className="person-role">{u.role}</span>
                  </div>
                  <span className={"pill " + (u.access === "full" ? "unrestricted" : "restricted")}>
                    {u.access === "full" ? "Full access" : cats ? `${cats.length} area${cats.length === 1 ? "" : "s"}` : "Limited"}
                  </span>
                  <span className="person-chevron">›</span>
                </button>
              );
            })}
          </div>
        ) : (
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
  return loadPage() || "daily-close";
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

// allIds: every widget available in this scope right now (order = default
// order). Merges in any ids not yet in a saved layout (new widget added to
// the app later, or one that just became available) and drops any that are
// no longer available (e.g. a fund that was removed).
function useWidgetLayout(scopeKey, allIds) {
  const [layouts, setLayouts] = useState(loadDashboardWidgetLayouts);
  const saved = layouts[scopeKey];
  const order = saved ? saved.order.filter((id) => allIds.includes(id)).concat(allIds.filter((id) => !saved.order.includes(id))) : allIds.slice();
  const hidden = new Set(saved ? saved.hidden.filter((id) => allIds.includes(id)) : []);

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
    reset: () => update(allIds.slice(), new Set()),
  };
}

// Lets the actual cards on a page (not just the picker modal's rows) be
// picked up and dropped to reorder — same underlying layout.reorder, just
// driven by dragging the card itself. dragProps(id) spreads onto the card's
// wrapper div; dragClass(id) adds the visual feedback classes.
// How long a finger has to rest on a card before it's picked up. Long enough
// that a normal scroll swipe never trips it, short enough not to feel stuck.
const CARD_LONG_PRESS_MS = 350;

function useDragReorder(layout) {
  const [draggedId, setDraggedId] = useState(null);
  // Touch bookkeeping lives in a ref, not state: it changes on every pointer
  // move and must not re-render the grid on its own.
  const touch = useRef({ id: null, x: 0, y: 0, timer: null, active: false, el: null, pointerId: null });
  // The last target reorder() was actually called against, for both paths.
  // dragover/pointermove fire continuously (many times a second) while
  // hovering, and layout.reorder(draggedId, targetId) is NOT idempotent for
  // a stationary hover — calling it twice in a row on the same pair swaps
  // them, then swaps them right back (the dragged item's index vs. the
  // target's flips after the first call, which flips which branch the
  // insert-position math takes). Repeated firing during any hover longer
  // than one event tick — i.e. any real, deliberate drag — oscillates
  // between two arrangements and can land back where it started by the
  // time you release, which reads as "picks up fine, never actually
  // swaps." Only reordering once per newly-entered target (reset when the
  // drag starts or ends) restores the intended "shuffle the instant you
  // drag over a neighbor" behavior.
  const lastTarget = useRef(null);

  const resetTouch = () => {
    const t = touch.current;
    if (t.timer) clearTimeout(t.timer);
    if (t.el && t.pointerId != null) {
      try {
        t.el.releasePointerCapture(t.pointerId);
      } catch (e) {
        /* capture was already released, or never taken */
      }
    }
    touch.current = { id: null, x: 0, y: 0, timer: null, active: false, el: null, pointerId: null };
    lastTarget.current = null;
  };

  const endTouchDrag = () => {
    resetTouch();
    setDraggedId(null);
  };

  // A live touch drag has to stop the page scrolling out from under the
  // finger. React's own touchmove listener is passive, so preventDefault has
  // to come from a native non-passive one — attached only for the life of the
  // drag so ordinary scrolling is never touched.
  //
  // This is also the one place the whole page can get stuck unable to
  // scroll: onPointerUp/onPointerCancel below are bound to the SPECIFIC card
  // element that was picked up, via React's synthetic events — but
  // onPointerMove calls layout.reorder() on every card it passes over, which
  // changes widget order state and can cause React to swap out that exact
  // DOM node (a reorder, or losing/regaining premium-gated widgets) mid-
  // drag. Pointer capture and its bound handlers are lost with the old node,
  // and if the browser doesn't cleanly deliver a pointercancel for that,
  // draggedId never resets — and this effect's touchmove blocker, being
  // keyed only to draggedId, keeps calling preventDefault() on every scroll
  // attempt on the ENTIRE page, forever, since nothing ever set it back to
  // null. Document-level pointerup/pointercancel/pointerleave listeners
  // below are the safety net: they fire regardless of which element the
  // capture was on, so a drag can never get permanently stuck this way. A
  // hard 5s ceiling is a second, even-more-defensive backstop in case a
  // browser drops pointer events entirely mid-gesture.
  useEffect(() => {
    if (!draggedId) return;
    const block = (e) => {
      if (touch.current.active) e.preventDefault();
    };
    const forceEnd = () => endTouchDrag();
    document.addEventListener("touchmove", block, { passive: false });
    document.addEventListener("pointerup", forceEnd, true);
    document.addEventListener("pointercancel", forceEnd, true);
    document.addEventListener("pointerleave", forceEnd, true);
    const ceiling = setTimeout(forceEnd, 5000);
    return () => {
      document.removeEventListener("touchmove", block);
      document.removeEventListener("pointerup", forceEnd, true);
      document.removeEventListener("pointercancel", forceEnd, true);
      document.removeEventListener("pointerleave", forceEnd, true);
      clearTimeout(ceiling);
    };
  }, [draggedId]);

  return {
    // iPhone-homescreen-style: cards shuffle live the instant you drag over
    // a neighbor, not just when you release — dropping only ends the grab.
    dragProps: (id) => ({
      // --- Mouse: the browser's own drag-and-drop, ghost image and all. ---
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

      // --- Touch: HTML5 drag events are never fired from a finger, on any
      // mobile browser, so a pointer-based path stands in for them. Press and
      // hold to pick a card up (a plain swipe still scrolls the page), then
      // slide over a neighbour to shuffle it, exactly as the mouse path does.
      // elementFromPoint is what finds the card under the finger: pointer
      // capture routes every move back to the held card, so hit-testing by
      // hand is the only way to know what it's over. ---
      "data-widget-id": id,
      onPointerDown: (e) => {
        if (e.pointerType === "mouse") return;
        const el = e.currentTarget;
        const pointerId = e.pointerId;
        resetTouch();
        touch.current = { id, x: e.clientX, y: e.clientY, timer: null, active: false, el, pointerId };
        touch.current.timer = setTimeout(() => {
          touch.current.active = true;
          try {
            el.setPointerCapture(pointerId);
          } catch (err) {
            /* element left the DOM mid-press */
          }
          setDraggedId(id);
        }, CARD_LONG_PRESS_MS);
      },
      onPointerMove: (e) => {
        if (e.pointerType === "mouse") return;
        const t = touch.current;
        if (!t.id) return;
        if (!t.active) {
          // Moved before the hold landed — that's a scroll, not a pick-up.
          if (Math.abs(e.clientX - t.x) + Math.abs(e.clientY - t.y) > 10) resetTouch();
          return;
        }
        const under = document.elementFromPoint(e.clientX, e.clientY);
        const targetEl = under && under.closest ? under.closest("[data-widget-id]") : null;
        const targetId = targetEl && targetEl.getAttribute("data-widget-id");
        if (targetId && targetId !== t.id && lastTarget.current !== targetId) {
          lastTarget.current = targetId;
          layout.reorder(t.id, targetId);
        }
      },
      onPointerUp: (e) => {
        if (e.pointerType !== "mouse") endTouchDrag();
      },
      onPointerCancel: (e) => {
        if (e.pointerType !== "mouse") endTouchDrag();
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

  return (
    <ModalShell onClose={onClose} labelledBy="widget-picker-title" className="widget-picker-modal">
        <div className="modal-header">
          <h3 id="widget-picker-title">Customize your dashboard</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <p className="card-subtitle" style={{ marginBottom: 16 }}>
          Pull in any card you have access to from across the app, and drag the handle to reorder them — make this your hub.
          On the dashboard itself, drag a card to move it, or press and hold on a touch screen.
        </p>
        <div className="widget-picker-list">
          {layout.order.map((id) => {
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
        ⚙ Customize dashboard
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
  "daily-close": { title: "Daily Report", subtitle: "A live financial snapshot, updating continuously" },
  budget: { title: "Budget vs. Actual", subtitle: "How spending compares to plan, by category" },
  giving: { title: "Giving & Funds", subtitle: "Contributions received and fund balances" },
  receivables: { title: "Receivables & Payables", subtitle: "Money coming in and bills going out" },
  bank: { title: "Bank Accounts", subtitle: "Balances and recent activity" },
  reports: { title: "Reports", subtitle: "Download statements and summaries" },
  "report-builder": { title: "Report Builder", subtitle: "Assemble a formatted report for your board or leadership" },
  "budgeting-tool": { title: "Budgeting Tool", subtitle: "Draft next period's budget with your bookkeeper" },
  "ap-command-center": { title: "AP Command Center", subtitle: "Every open bill, aging, and what's due next" },
  "enterprise-upgrade": { title: "Enterprise Tools", subtitle: "See what's included, and what upgrading unlocks" },
  "staff-access": { title: "Staff Access", subtitle: "Who can sign in to the portal, and with what role" },
  "client-access": { title: "Client Roster", subtitle: "Who at each organization is registered to sign in" },
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

function App({ staffUser, onSignOut }) {
  // Riverside: premium plan (so Daily Report is reachable) and, as of the
  // thread fixes in data.js, no thread whose last message is unread —
  // nothing steals focus with the chat popup on first load. Only the
  // fallback when nothing was ever persisted (loadSelectedClientId returns
  // null) — a returning staffer lands back on whatever client they last had
  // open, per initialPage's refresh-vs-fresh-open distinction below.
  const [selectedClientId, setSelectedClientId] = useState(() => loadSelectedClientId() || "riverside-pantry");
  const [page, setPage] = useState(initialPage);
  // Count-up gating (see the effect further down). Armed for the page the user
  // lands on, disarmed the moment they navigate away from it.
  const countUpArmed = useRef(true);
  const countUpTeardown = useRef(null);
  const countUpFirstPage = useRef(true);
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
    if (effectiveStaffUser.role === "admin") return;
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
  }, [effectiveStaffUser.email, effectiveStaffUser.role]);

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
    setTimeout(() => {
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
  useEffect(() => {
    setViewAsUserId(BOOKKEEPER_VIEW);
    setBookkeeperThreadUserId(null);
  }, [selectedClientId]);

  // Only counts as "visiting" a client while actually looking at one of its
  // pages, not while browsing Home/Staff Access (which don't belong to any
  // client, and would otherwise stamp whatever client was last selected
  // every time someone just checks their reminders).
  useEffect(() => {
    if (page === "bookkeeper-home" || page === "staff-access" || page === "client-access") return;
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

  const access = useMemo(
    () => resolveAccess(client, viewAsUserId, new Set(tabConfig[selectedClientId] || [])),
    [client, viewAsUserId, tabConfig, selectedClientId]
  );

  const scopedClient = useMemo(() => scopeClientData(client, access), [client, access]);

  // "enterprise-upgrade" and "staff-access" are synthetic pages, not real
  // tabs — neither is in ALL_TAB_KEYS/access.tabs, so each needs its own
  // bypass here or the normal fallback would bounce it straight back to the
  // dashboard. staff-access additionally requires admin, matching the
  // sidebar link that's the only way to reach it — Postgres RLS is the real
  // enforcement (see supabase/staff-admin-policies.sql), this is just so a
  // demoted admin's stale stored page doesn't render a fetch that RLS then
  // silently empties.
  const effectivePage =
    page === "enterprise-upgrade"
      ? page
      : (page === "staff-access" || page === "client-access") && staffUser.role === "admin" && !impersonating
      ? page
      : page === "bookkeeper-home"
      ? page
      : access.tabs.has(page)
      ? page
      : ALWAYS_VISIBLE_KEY;
  const meta = PAGE_META[effectivePage];
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

  // Daily Report reads as continuously live, not a once-a-day snapshot —
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
          // (drag state, widget-layout state, the 30s Daily Report tick), and
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
      document.querySelectorAll(".card, .dc-kpiTile, .dc-panel").forEach((el) => {
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

  // Every prominent stat (KPI tiles, Report Builder's big numbers, fund
  // balances, Daily Report's own KPI row) counts up from zero as the page
  // first loads. This works on the already-rendered text rather than routing
  // every number through a component: find the first real text node inside
  // the target, pull the numeric run out of it with a regex, and animate that
  // node's data from 0 up to it, leaving any prefix ("$", "-"), suffix
  // (" mo", "%"), and sibling markup (Daily Report's cents <small>)
  // untouched. A value with no number in it (e.g. a runway ring reading
  // "Healthy") is simply left alone.
  //
  // It runs for the opening moments only. It used to fire on every page swap
  // too, because React mounts fresh nodes each time — so every tab change made
  // the whole dashboard spin up from $0 before it could be read. Durations
  // were also randomised per number, which landed figures in the same KPI row
  // at different times and read as jitter; they're uniform now.
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
      if (!countUpArmed.current) return;
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
    // Handed to the disarm effect below so it can stop watching the document
    // once there's nothing left to animate.
    countUpTeardown.current = () => {
      io.disconnect();
      mo.disconnect();
    };
    return () => {
      io.disconnect();
      mo.disconnect();
    };
  }, []);

  // Disarm on the first navigation. This used to be a 2s wall clock, which
  // quietly killed the animation on the real site: a cold load saturates the
  // main thread right after mount (Babel has just compiled the app, React is
  // rendering the whole dashboard), IntersectionObserver callbacks are only
  // delivered once that work lets go, and past the deadline every number was
  // skipped and rendered flat. Localhost with a warm cache was always fast
  // enough to hide it. Nothing here depends on how long the first paint takes.
  useEffect(() => {
    if (countUpFirstPage.current) {
      countUpFirstPage.current = false;
      return;
    }
    countUpArmed.current = false;
    if (countUpTeardown.current) {
      countUpTeardown.current();
      countUpTeardown.current = null;
    }
  }, [page]);

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
    // Home already has its own cross-client "Unread messages" card, and
    // Staff Access isn't about any client at all — the floating widget
    // popping up over either is redundant at best (Home) and outright
    // confusing at worst (Staff Access: it's scoped to whatever client
    // happened to be last selected, which has nothing to do with that page).
    const canShow =
      access.tabs.has("messages") &&
      effectivePage !== "messages" &&
      effectivePage !== "bookkeeper-home" &&
      effectivePage !== "staff-access" &&
      effectivePage !== "client-access";
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
          <span className="mobile-topbar-title">{client.name}</span>
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
                {effectivePage === "bookkeeper-home" || effectivePage === "staff-access" || effectivePage === "client-access"
                  ? "MyGoodBooks"
                  : client.name}
              </div>
              {effectivePage === "bookkeeper-home" || effectivePage === "staff-access" || effectivePage === "client-access" ? (
                <h1 className="page-title">
                  {timeOfDayGreeting()}, {firstNameOf(effectiveStaffUser.name)}
                </h1>
              ) : (
                <h1 className="page-title">
                  {timeOfDayGreeting()}, {greetingName}
                </h1>
              )}
              <div className="page-subtitle">{meta.subtitle}</div>
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
            key={"search-" + client.id}
          />

          {effectivePage === "dashboard" &&
            (access.isCategoryScoped ? (
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
          {effectivePage === "daily-close" && hasPremiumPlan(client) && (
            // theme is null until the header toggle is used, in which case
            // DailyClose follows the OS setting via its own dark block —
            // identical to the shell's default. Once toggled, the explicit
            // choice is passed through so both sides stay in step.
            // Data is derived from the selected client rather than the shipped
            // Bramblewood sample, so the panel and the rest of the app agree.
            <DailyClose data={dailyCloseFromClient(client)} theme={effectiveTheme} key={"daily-close-" + client.id} />
          )}
          {effectivePage === "budget" && <BudgetPage client={scopedClient} />}
          {effectivePage === "giving" && <GivingFundsPage client={scopedClient} />}
          {effectivePage === "receivables" && <ReceivablesPayablesPage client={scopedClient} />}
          {effectivePage === "bank" && <BankPage client={scopedClient} key={"bank-" + client.id} />}
          {effectivePage === "reports" && <ReportsPage client={scopedClient} />}
          {effectivePage === "report-builder" && <ReportBuilderPage client={scopedClient} key={"report-builder-" + client.id} />}
          {effectivePage === "enterprise-upgrade" && <EnterpriseUpgradePage client={scopedClient} key={"enterprise-upgrade-" + client.id} />}
          {effectivePage === "staff-access" && (
            <StaffAccessPage staffUser={staffUser} onImpersonate={startImpersonating} />
          )}
          {effectivePage === "client-access" && <ClientAccessPage />}
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
          {effectivePage === "budgeting-tool" && <BudgetingToolPage client={scopedClient} key={"budgeting-tool-" + client.id} />}
          {effectivePage === "ap-command-center" && (
            <APCommandCenterPage client={scopedClient} key={"ap-command-center-" + client.id} />
          )}
          {effectivePage === "documents" && (
            <DocumentsPage client={scopedClient} isBookkeeper={!isPreviewingUser} key={"docs-" + client.id} />
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
              key={"msgs-" + client.id + "-" + activeThreadUserId}
            />
          )}
        </main>
      </div>

      {chatWidgetOpen && (
        <ChatWidget
          // Keyed by thread so an unsent draft can't follow the bookkeeper to
          // another person's conversation and be sent to the wrong recipient.
          key={"chat-" + threadKeyFor(selectedClientId, activeThreadUserId)}
          messages={liveMessages}
          onSend={(text) => sendMessage(selectedClientId, activeThreadUserId, text)}
          onOpenFull={() => setPage("messages")}
          onClose={closeChatWidget}
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
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </ToastProvider>
  );
}

// AuthGate (components/auth/AuthGate.jsx) is the Phase-1 login gate: it only
// calls this render prop once a Supabase session exists AND that email is an
// active row in the `staff` table. Until auth-config.js has real Supabase
// credentials, AuthGate shows a "not configured" screen instead — the rest of
// the app is unreachable either way, by design.
ReactDOM.createRoot(document.getElementById("root")).render(
  <ErrorBoundary>
    <AuthGate>
      {(staffUser, onSignOut) => <App staffUser={staffUser} onSignOut={onSignOut} />}
    </AuthGate>
  </ErrorBoundary>
);
