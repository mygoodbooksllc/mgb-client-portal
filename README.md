# MyGoodBooks Client Portal

The client portal for MyGoodBooks' bookkeeping clients, which are mostly churches and
nonprofits. It has two sides:

- **Client side.** Each client organization signs in and sees its own finances: dashboard,
  budget vs. actual, bank accounts, cash flow, giving and funds, reports, documents and
  messages.
- **Staff side.** MyGoodBooks bookkeepers sign in with their Google Workspace account. They
  can switch between the clients they're assigned to, manage who has access, keep notes,
  tasks and SOPs, chat with each other and log their time.

This README replaces the old `HANDOFF*.md` notes. If code and docs ever disagree, trust the code.

## Where it lives

| What | Where |
| --- | --- |
| Source code | GitHub `mygoodbooksllc/mgb-client-portal`, branch `main` |
| Hosting | Vercel project `mgb-client-portal`. It deploys `main` automatically to **https://app.mygoodbooks.org**. There's no build step: Vercel serves the files as they are. |
| Database, sign-in, file storage, server functions | Supabase project **"MGB Client Portal"**, ref `xumsqmhccgfjnlmieqyu` |
| Staff Google sign-in | Google Cloud project "MyGoodBooks Auth". Its OAuth client is set to **Internal**, so only `mygoodbooks.org` accounts can use it. |
| Design system | **MyGoodBooks**: artifact ARYpfcrCbFgFxJnbm1xqLx (org default) and Claude Design project 96865ffb (see [Claude Design](#claude-design)) |

The local folder (`~/Desktop/Mygoodbooks-app-code/client-dashboard`) can fall behind GitHub,
because some work happens in Claude Code web sessions. Run `git fetch` and compare with
`origin/main` before starting.

## How it runs

- **No bundler.** `index.html` downloads each source file as plain text and compiles it in the
  browser with `@babel/standalone`, which handles JSX and TypeScript. Nothing is built ahead
  of time.
- **Load order.** `window.__SOURCE_ORDER` in `index.html` lists the files in the order they
  run: `auth-config.js`, `qbo-config.js`, `components/auth/*`, `data.js`,
  `components/dashboard/WidgetDrawer.jsx`, `components/daily-close/*`, `components/qbo/mapQboToClient.js`, `components/pro/*`,
  `components/inbox/StaffInbox.jsx`, `components/staff/*` (ending with `StaffGuide.jsx` and
  `TopBar.jsx`), then `app.jsx`. All files start downloading at once, but
  they compile in this order.
- **Shared global scope.** There are no imports. Every file shares `window`, so something
  defined in one file (for example `window.mgbSupabase` or `window.CLIENTS`) is visible to the
  files after it.
- **Boot steps in `index.html`.** After `data.js` runs, `loadClientsRoster()` fetches the real
  `clients` table and merges each org onto its sample data. After the mapper loads,
  `loadQboData()` replaces the sample numbers with real QuickBooks numbers for any client that
  is connected and has synced. If either step fails, the app keeps booting with sample data.
- **`app.jsx` is one big file** (about 22,000 lines) that holds almost the whole application:
  pages, sidebar, modals and PDF builders.
- **Third-party scripts** (React 18.3.1, Babel, supabase-js, jsPDF) come from unpkg or jsDelivr.
  Each is pinned to an exact version and has an SRI hash. If the app ever boots to a blank page
  right after a version bump, check those hashes first. The command to regenerate them is in a
  comment in `index.html`.
- **Styles.** `styles.css` holds the design tokens (`--navy`, `--gold`, `--gold-deep`, `--bg`,
  `--surface`, `--border`, `--text`, `--text-muted`, ...) at the top:
  - Light values are under `:root`.
  - Dark values are under `@media (prefers-color-scheme: dark)` and again under
    `[data-theme="dark"]`.
  - The theme follows the device setting unless the user picks one; the choice is saved in
    `localStorage` as `mygoodbooks_theme_v1`.
  - The current look is the "calm" redesign: static background, opaque cards and a gold accent.
  - Financial Overview has its own stylesheet, `components/daily-close/DailyClose.css`.
- **Version label.** `window.MGB_VERSION` in `index.html` is bumped by hand. It's shown in
  Developer Tools → System info.

## Repo map

| Path | What it is |
| --- | --- |
| `index.html` | Page shell, pinned CDN scripts, file loader, roster and QuickBooks boot steps |
| `app.jsx` | The application (every page and component) |
| `styles.css` | All app styles and theme tokens |
| `data.js` | **Sample** financial data for the test orgs, plus `withClientDataDefaults()`, which keeps pages from crashing when an org has no data yet |
| `auth-config.js` | Supabase URL and publishable (anon) key. Safe to be public. |
| `qbo-config.js` | QuickBooks app Client ID (public) and environment (`production`) |
| `components/auth/` | `supabaseClient.js`, `AuthGate.jsx` (staff Google gate), `ClientAuthGate.jsx` (client magic-link gate) |
| `components/dashboard/` | `WidgetDrawer.jsx` + `widget-drawer.css`: the shared **Customize** drawer and board edit mode used by every customizable board (client Dashboard, full client dashboard, Bookkeeper Home, Financial Overview), plus `WD_sync` for per-account layout saving. Every name is `WD_`/`wd-` prefixed. Loaded before `components/daily-close/*` and `app.jsx`. |
| `components/daily-close/` | Financial Overview (`DailyClose.tsx`, its CSS, sample data, and `fromClient.js`, which adapts client data for it) |
| `components/pro/` | Pro budget and report tools: `ProBudget.jsx` (Budget vs. Actual tabs, next year's draft with approval) and `ProReports.jsx` (board reports suite and the public share page), each with its own CSS. Loaded before `app.jsx`; `app.jsx` falls back to the old pages if either is missing. |
| `components/inbox/` | `StaffInbox.jsx` (the unified staff inbox, the staff chat drawer and launcher, and `SI_useClientMessaging` for the client Messages page) and `staff-inbox.css`. Loaded before `app.jsx`; every name is `SI_`/`si`/`StaffInbox` prefixed. Without it, `app.jsx` falls back to the old Team Chat page and sample client threads. |
| `components/staff/` | Staff-only features, each with its own CSS and a name prefix (`CS_` client switcher, `HLP_` Help, `TB_` top bar, ...). `TopBar.jsx` + `top-bar.css` is the staff top bar (see "Staff top bar" under Main features). All loaded before `app.jsx`. |
| `components/files/` | `DriveFiles.js`: browser helpers for client files in Google Drive (`DRV_` prefix), calling the `drive-files` edge function. Holds the one fallback switch `DRV_STORAGE_FALLBACK`. Loaded before `StaffInbox.jsx` and `app.jsx`. |
| `components/qbo/` | `mapQboToClient.js` converts QuickBooks table rows into the shape the pages use. Its test is `mapQboToClient.test.js`. |
| `supabase/*.sql` | Every database change: tables, row-level security (RLS) policies, functions, cron jobs. The folder is flat, one file per change. |
| `supabase/functions/` | Edge functions: `qbo-callback`, `qbo-refresh-token`, `qbo-sync`, `invite-client-user` |
| `privacy-policy.html`, `terms-of-service.html`, `qbo-connected.html` | Standalone public pages, served at `/privacy`, `/terms` and `/quickbooks-connected` |
| `vercel.json` | URL rewrites (`/login`, `/privacy`, `/terms`, `/quickbooks-connected`) and security headers |
| `.vercelignore` | Keeps internal files out of the public deploy (see [Working on it](#working-on-it)) |
| `logo.webp` | Logo |
| `marketing/` | Marketing drafts, plus `pricing-embed.html`: the public pricing chart as a Squarespace Code Block (plain HTML/CSS). Not deployed. |
| `design-system/` | Design-system package synced to the Claude Design project "MyGoodBooks". Not deployed. |

## Sign-in and access

**Front door.** `https://app.mygoodbooks.org/` is the **client login**.

- **Clients** enter their email and get a magic link. They must have an active row in
  `client_users`.
  - Links are sent with `shouldCreateUser: false`, so a stranger typing an email can't create
    an account.
  - So a new contact has to be **invited** first. On the Client Roster page, adding a contact
    sends the invite automatically, and each contact has an "Invite / Resend invite" button.
    Both use the `invite-client-user` edge function, which only staff can call.
- **Staff** click **"Staff? Sign in with Google"**.
  - Google only accepts `@mygoodbooks.org` accounts.
  - The app then requires an active row in the `staff` table.
  - Someone with a Google account who isn't on the staff list is signed out again.

**Routing.** `RootGate` in `app.jsx` decides which login screen to show:

- A session with a `@mygoodbooks.org` email goes to the staff gate (`AuthGate`).
- Anyone else goes to the client gate (`ClientAuthGate`).
- `/login` or `?client-login=1` always shows the client gate.
- `?access-form=<token>` shows the public access-request form, which needs no login.
- Each gate still checks its own table, so the email-domain check grants nothing by itself.

**Staff roles.** The `staff.role` column is `admin` or `bookkeeper`.

- **Admins** see every client, plus Team, Staff Access, Client Roster, Developer Tools and Usage Stats.
- **Bookkeepers** see only the clients assigned to them in `staff_client_access`.
- An admin can give a bookkeeper **temporary** access to the admin pages
  (`staff_temp_admin_access`). This only lets them view those pages; it doesn't widen which
  clients they can see.

**RLS helpers** (Postgres functions the security policies use):

- `is_active_staff()` / `is_active_staff_admin()`: is the caller on the staff roster (as an admin)?
- `can_access_client(client_id)`: is the caller an admin, or assigned to this client? Every
  per-client table uses this.
- Clients read their own org's rows through their active `client_users` row.
- `[TEST]` orgs (`test_only = true`) are hidden from non-admin staff by the database, not just
  by the app.

**Client access controls.**

- **Per person.** On Client Roster → Client contacts, `ClientUserScopeEditor` sets what each
  contact can see: access level, tabs, categories, funds and a "Pro features off" switch. This is stored
  in `client_users`.
  - Empty lists are stored as `null`, which means "everything".
  - This scoping currently only hides things in the app. The database does not yet filter
    QuickBooks rows by category (see [Known gaps](#known-gaps-and-roadmap)).
- **Per org.** Settings → **Client settings** → **Manage access** has People / Organization tabs / Requests.
  - The People and Organization tabs still work on **sample** users and per-browser settings
    (see [Known gaps](#known-gaps-and-roadmap)).
  - The Requests tab is real (`access_requests`).
- **Preview.** Staff can "Preview as" a client user to see what that person sees.
- **Plans: Basic, Plus, Pro.** Set per client in `clients.plan`, whose stored values are
  `basic` / `standard` / `premium`. They're shown as Basic / Plus / Pro. Names, prices and sync
  schedules live only in `PLAN_LABELS` / `PLAN_PRICING` / `PLAN_SYNC` / `PAYROLL_PRICING` in
  app.jsx. The same prices are published in `marketing/pricing-embed.html`.
  - **Basic**, $9/mo with 1 login included; extra logins are $9/mo each. It gets Reports,
    Documents and Messages, plus the milestone pill. There is **no Dashboard** and no per-person
    access (`BASIC_TAB_KEYS`); the landing tab is Reports. QuickBooks syncs monthly, on the 15th
    (US Central), with no Sync now.
  - **Plus**, $25/mo + $9 per login. It gets every standard tab and per-person access.
    QuickBooks syncs weekly, with no Sync now.
  - **Pro**, $39/mo + $9 per login. It adds the Pro tools inline on the same tabs (see below).
    QuickBooks syncs every 15 minutes (30 when the monthly API budget is running hot; see the
    usage guard below), and Sync now is available.
  - **Payroll add-on:** $49/mo + $6 per employee, on any plan (Basic included). Clients without it
    (`clients.payroll_add_on` false) see **Payroll** in the sidebar with an "Add-on" tag. It opens
    `PayrollAddOnPage`, which has the price, an employee-count estimate, what's included and an
    **Add Payroll** button. The button files an upgrade request with `requested_plan = 'payroll'`
    . Staff see
    a hint to turn it on under Client organizations. Clients with the add-on but no Gusto data see
    the Connect Gusto screen.
  - **Downgrades:** logins beyond what the new plan includes stay at $9/mo each, or they're
    removed.
  - Plan fees sit on top of the milestone (bookkeeping) fee.
  - **Sync schedule:** enforced server-side in `qbo-sync` (`isDueForPlan`). The cron runs every
    minute and syncs only the clients that are due. The server refuses client-initiated Sync now
    on Basic and Plus; staff can sync any plan.
  - **Plan gates:** tabs and login pricing are checked in the app only. Staff get a toast when
    they add an extra login to a Basic organization.
  - The "Force Pro plan" dev switch is staff-only and saved per browser. It isn't a security
    boundary, because the data still goes through RLS.

## Data: real vs. sample

**Real (from Supabase):**

- Client roster, staff, assignments, client contacts
- Notes, private notes, SOPs, tasks and reminders, time entries
- Client messages (`client_messages`), Team Chat, activity log, access requests, upgrade requests, usage stats and feedback
- Document links (Google Drive links only; no files are stored)
- QuickBooks data for connected clients

**QuickBooks connection:**

- **Connect.** Staff connect a client's QuickBooks from Client details → QuickBooks. This runs
  OAuth through the `qbo-callback` edge function; tokens are stored encrypted in `qbo_tokens`.
- **Token refresh.** `qbo-refresh-token` runs every 15 minutes (cron `qbo-refresh-tokens`).
- **Sync.** `qbo-sync` pulls accounts, 12 months of P&L, budget, open invoices, open bills and
  90 days of transactions into the `qbo_*` tables.
  - The P&L lands twice: monthly totals in `qbo_monthly_pl` and per-account lines in
    `qbo_pl_lines` (one row per month per account type per account, so an income and an expense
    account with the same name stay separate: `supabase/qbo-pl-lines-by-type.sql`, qbo-sync v9;
    money posted straight to a parent account is booked under the parent's name, so the lines
    add up to the totals, since v8).
    `mapQboToClient` turns this month's expense lines into `client.expenseByAccount` (and last
    month's into `expenseByAccountPrev`), which feeds Financial Overview's "Where the money went"
    whether or not the company has a QuickBooks budget.
  - Open invoices also carry `customer_id` and `customer_email` (qbo-sync v10,
    `supabase/qbo-invoice-customer-email.sql`). The email is Customer.PrimaryEmailAddr, from one
    read-only `Customer where Id in (...)` query per full read covering only customers with an
    open invoice, and falls back to the invoice's BillEmail. Financial Overview's **Collections Queue**
    uses them to draft reminders **one customer at a time** as a `mailto:` addressed to that
    customer. Checking a row from another customer replaces the selection, so one email never
    shows one customer another's balances. Nothing is sent from the portal.
  - **Cron** job `qbo-sync-hourly`. Despite the name, it ticks **every 5 minutes** at :02, :07,
    ... (`'2-59/5 * * * *'`, set by `supabase/qbo-usage-guard.sql`), off the token refresher's
    minutes. Each tick syncs only the clients that are due (Pro every 15 min, Plus weekly, Basic
    on the 15th). An open page re-fetches the client's numbers once they're more than about 90
    seconds old.
  - **CDC gate.** Between full reads (at most 24 hours apart), a due client first asks
    QuickBooks' change-data-capture endpoint what changed since the last sync; if nothing did, the
    full re-read is skipped. CDC is only used as a gate: the full read still replaces the tables.
  - **Close data.** Once a day per client (and on Sync now) the sync also pulls 13 months of
    bank, card, Undeposited Funds and uncategorized account data into `qbo_account_status` and
    `qbo_period_balances`, then re-runs the close checks (see the Close tracker below).
  - **Usage guard.** Every Intuit call is counted in `qbo_api_usage` (`qbo-sync` and
    `qbo-firm-sync`). If the month is on pace to pass 80% of the 500,000-call limit, Pro slows to
    every 30 minutes; at 95% used, scheduled syncs stop until the 1st (Sync now still works).
  - **Sync now**: clicking the gold sync pill (the refresh icon at its right end) syncs, for
    staff and clients; also in Client details → QuickBooks. Staff see the pill in the top bar;
    clients (and phones) see it in the header. The function re-checks that the
    caller may sync that client.
  - **60-second throttle** per connection, for Sync now only (the cron isn't throttled).
  - **Lock.** `qbo_connections.sync_started_at` stops two syncs overlapping; a stale lock
    expires after 5 minutes.
  - **Atomic writes.** Each table's rows are swapped in one transaction by `qbo_replace_rows()`,
    so no one sees a half-finished sync.
- **Browser access.** Browsers can only **read** the `qbo_*` tables. Only the sync function
  (service role) writes to them.
- **Header (top right of every client page).** Two rows, right-aligned (left-aligned on phones):
  the **sync pill** (plan-aware copy from `PLAN_SYNC` / `syncPillLabel`: "Every 15 min · synced
  5m ago" on Pro, "Synced weekly · …" on Plus, "Synced monthly · …" on Basic, plus a refresh
  icon; one button, `QboSyncNowButton` with `liveLabel`; Pro is never called "live") and search (clients only; staff
  search the client's data from the top bar instead). A client without
  QuickBooks data shows a grey **"Prototype · Sample Data"** badge instead of the sync pill. The
  "synced" label ticks every minute. For staff on desktop the pill moves into the staff top bar
  (the header copy is hidden by CSS while the top bar's pill is mounted).
- **Sample banners.** `MockBanner` hides itself on financial pages when
  `client.dataSource === "quickbooks"`.
- As of 2026-09-22 the connected company was an Intuit **sandbox** company, even though the app
  uses production keys.

**Still sample or mock:**

- `data.js`: all financials for orgs without QuickBooks, and for every org: giving, funds,
  pledges, donors, payroll (Gusto) and the "Preview as" user list.
- Client **Messages** fall back to the sample threads (with simulated bookkeeper replies) only
  when `client_messages` can't be read, and for staff previewing a sample person. Staff Home's
  "Unread messages" card and the Client overview's "threads waiting" still count the sample
  threads.
- Client **Documents** uploads stay in the browser for that session only.
- Giving statement "Send" (Tax Documents) only simulates delivery; nothing is emailed.
- The referral popup (`ReferralPopup`) exists in code but isn't shown anywhere.

## Main features

### Staff side

- **Staff client tools** (`supabase/staff-client-tools.sql`, applied 2026-09-27):
  - **Client overview** (page `client-overview`, staff only): staff land here when they open a
    client. It shows:
    - the monthly bill (milestone + plan + logins + payroll)
    - profitability (bill ÷ QuickBooks Time hours this month, admins only, against a target
      rate), plus automatic in-app time on the client
    - QuickBooks health: last sync, uncategorized / Ask My Accountant balances, possible
      duplicate bills. Reconciliation data isn't synced, so it isn't shown.
    - engagement: client page views in the last 30 days, and threads waiting on a reply (still
      sample messages)
    - key dates and coverage (`client_profile`)
    - pinned notes and staff notes
    - "sent to client" history
    - the month-end close checklist (`client_close_items`)
    - document requests
    - an activity timeline with "Log a call", saved as a `client_private_notes` call note
  - **Quick actions** (`StaffQuickActions` in `app.jsx`): the visible "Staff" bar on client pages
    was retired 2026-09-30. App mounts it `headless` on client pages, so it renders no buttons, only
    the Add task / Request document / Add note modals, opened from the top bar's "+" via the
    `tb:quick-add` event (kind `task` / `request` / `note`; kind `message` opens the chat drawer, or
    the Messages tab when the drawer isn't available). The Inbox context pane still renders it with
    `only={["request", "task"]}` as visible buttons. Overview moved to the top bar
    (`TB_OverviewButton`); the client sidebar no longer has the staff-only Overview item, so it
    lists exactly what the client sees. The `client-overview` route is unchanged.
  - **Open requests are hard to miss:** a "Your bookkeeper needs N documents · Upload now" banner
    shows on every client page (for the client, and for staff previewing as them), and Documents
    gets a dot in the sidebar.
  - **Document requests** (`client_doc_requests`): the client sees them on Documents and uploads
    into them. Files go to Google Drive through the `drive-files` function (see **Client files in
    Google Drive** below), which calls `fulfill_doc_request()` with the path
    `<client_id>/<request_id>/drive:<client_files id>`. Before Drive was connected (2026-10-07) files went to
    the private bucket `client-uploads`, path `<client_id>/<request_id>/<file>`. Files open through
    a short-lived link (Drive) or a 5-minute signed URL (bucket).
  - **Staff notes on anything** (`client_internal_notes`): a note button on budget lines, bank
    transactions and report cards. Clients never see it.
  - **Mark sent to client** on report cards (`client_sent_items`), with history.
  - **Preview plan** (top bar account menu on client pages, not during View as; the old sidebar select is gone): shows the client's pages as Basic / Plus / Pro
    in this browser only (`mygoodbooks_preview_plan_v1`). It's ignored in client sessions.
  - **Home → Month-end close**: last month's checklist progress for every client.
  - The same SQL lets staff read time entries and client page views for clients they can
    access.

- **Staff sidebar** (`StaffRail`, desktop and mouse windows): page navigation only: Home, Client
  view, Inbox, My Tasks, Close tracker, Help, and for admins Team, Staff Access, Client Roster,
  Developer Tools, Usage Stats and so on, plus Collapse. (Its client picker, theme, name and sign
  out moved to the top bar; they come back automatically if the top bar piece is removed.) On staff
  pages it replaces the client sidebar and collapses to icons with the usual Collapse toggle. On a
  client's pages it's a 64px icon strip beside the client sidebar. It's hidden while you preview as
  one of the client's people, so the preview shows only what they see. On phones the menu under
  your name has the same links.

- **Staff top bar** (`components/staff/TopBar.jsx` + `top-bar.css`, `TB_` prefix). App renders
  `TB_StaffTopBar` at the top of `<main>` whenever the staff sidebar shows (`showStaffRail`), so
  clients and client-user previews never see it. Sticky; no page links. Design is "option B"
  (owner-approved 2026-09-30): navy `var(--sidebar-bg)` bar joined to the sidebar, controls on
  translucent white chips, gold avatar and focus rings, light dropdown panels; colours are scoped
  `--tb-*` variables in one commented block in `top-bar.css` (dark mode adds a hairline bottom border). Each piece is its own
  component; delete its line in `TB_StaffTopBar` to drop it:
  - **Left:** `TB_ClientPicker` (reuses `CS_ClientSwitcher`), `TB_OverviewButton` ("Overview"
    chip, client pages only → `#/client/<id>/overview`; gold `is-current` + `aria-current="page"`
    on `client-overview`; label drops under 1180px), `TB_SyncPill` (reuses `QboSyncNowButton`;
    click = Sync now).
  - **Middle:** `TB_Search`, Ctrl/⌘+K. Clients and my tasks/notes are filtered locally; client SOPs
    (`client_sops` ilike, RLS-scoped) and Help (`search_staff_guide`) are queried, debounced. On a
    client page it adds an `In <client name>` group (after Clients): that client's transactions,
    budget categories, documents and messages, built by `buildClientSearchResults` in `app.jsx` (the
    same function behind the client-facing header `GlobalSearch`, so it respects `access.tabs` and
    `scopedClient` exactly the same way); picking one calls `setPage` + `setSearchTarget` to jump and
    highlight. App passes this in as the `clientSearch` prop (null on staff pages), and the
    placeholder becomes "Search clients, tasks, SOPs, Help and this client". Grouped listbox with
    arrow keys / Enter / Esc across all groups. While the top bar is shown (`showStaffTopBar`) the
    page-header search icon is not rendered; clients and client-user previews keep it.
  - **Right:** `TB_ThrottleBadge` (admins; `qbo_usage_status` mode throttled/stopped → `#/team`),
    `TB_Bell` (client messages waiting per the Inbox's read markers, `client_doc_requests` with status
    uploaded, open tasks assigned to me by someone else, last month's `close_checks` Blocked (admins:
    only clients they're the assigned bookkeeper on); seen ids in `localStorage`
    `mgb-topbar-bell-seen:<email>`), `TB_TasksBadge` (open count, overdue in red → `#/tasks`),
    `TB_QuickAdd` ("+", client pages: New task / New note / Request document / Message; dispatches
    `tb:quick-add`, which the headless `StaffQuickActions` listens for and opens its own modal or the
    chat drawer), `TB_HelpButton` ("?" menu: `#/help/<slug>` for the current page, else `#/help`, plus "Report a bug / feedback" via `FB_openFeedback`; `FB_FeedbackHost` is mounted next to it),
    `TB_AvatarMenu` (profile photo from `staff_profiles`, theme, Preview as a client user, Preview plan
    with check marks, Exit "View as", temporary access, **Settings** → `#/settings`, Sign out).
  - **Moved, not duplicated:** while mounted, the client picker, sync pill and account menu add
    `tb-has-client` / `tb-has-sync` / `tb-has-avatar` on `<html>`, and desktop-only CSS hides the old
    copies (sidebar/rail client switcher, header sync pill, rail name/sign out (the rail and sidebar theme toggles were removed; theme
    lives in the account menu and Settings), temporary-access banner and Preview as select).
  - **Phones:** the bar sits under the navy `.mobile-topbar` and keeps only the client picker, search,
    bell and "+" (44px; its menu opens fixed under the bar), since "+" is now the only way to add a
    task / note / request or message from a client page. Overview is hidden there: picking a client
    in the picker, including the one already open, lands on the overview. Everything else stays in
    the drawer.
  - Bell, My Tasks and the task/note search groups step aside during admin "View as".

- **Home** (`bookkeeper-home`): Your clients (with health dots), Needs attention, Needs a visit,
  Unread messages, Your reminders, Access requests, Upgrade requests (with the plan asked for), Recently viewed,
  Milestones to review. (The old "Jump to client" card here and on Developer Tools was removed
  2026-09-30; the top bar's client picker replaces both.)
- **My Tasks**:
  - Tabs: **Today / Upcoming / Overdue / All / By client**.
  - Separate **Notes** and **SOPs** cards below the tasks.
  - Tasks can have due dates and times, reminders, repeats and priority, and can be shared with
    a client's team.
  - Completing a repeating task rolls it forward (`complete_staff_item` RPC).
  - Notes can be linked to tasks.
  - **By client** shows each client's **handoff summary**, open tasks and notes.
  - The staff menu shows a due-count badge.
- **Client SOPs**: sectioned per-client procedures with full version history
  (`client_sops`, `client_sop_history`, `save_client_sop`). Clients never see them.
- **Inbox** (page `staff-messages`, called "Team Chat" before 2026-09-28; `components/inbox/StaffInbox.jsx`):
  one three-pane inbox for client conversations and team chat.
  - **List:** search, All / Clients / Team pills with counts, "+ New" (a client contact, a
    teammate or a new group). Every person at every client you can see (`client_users`, else the
    sample people) plus your Team Chat DMs and groups, most recent first. A client thread whose
    last message is from the client shows a red "Waiting on you · 2h"; unread threads are bold
    with a dot.
  - **Conversation:** theirs on the left, ours on the right in ink. Client threads have a
    **Reply / Note** switch (a note is `internal = true`, shown as a dashed gold "Internal note ·
    only staff see this" bubble), attachments (Google Drive through `drive-files`, stored as
    `<client_id>/messages/<email>/drive:<client_files id>`; fallback `client-uploads` bucket,
    `<client_id>/messages/<email>/<time>-<file>`; 25 MB and the bucket's types), Enter to send and
    Shift+Enter for a new line; opening a thread marks it read (`client_message_reads`). Team
    conversations reuse Team Chat's thread (`useStaffTeamChat` / `StaffTeamThread` in app.jsx):
    attachments, edit/unsend within 15 minutes, read receipts, groups, presence and typing, all
    unchanged.
  - **Details pane** (collapsible, "i" button): for a client, the church, the Pro pill, the
    milestone, cash on hand, last month's close progress, the bookkeeper, open document requests
    and tasks, files in the thread, and Add task / Request document / Open client (that client's
    Messages tab on that person). For a team conversation, members with online dots and shared
    files.
  - Live over Realtime (polls every 30 seconds if the channel can't be joined).
  - If `client_messages` is missing or unreadable, client threads fall back to the sample
    threads with a note that nothing is saved.
- **Chat drawer:** a compact inbox (list, then the conversation with a back arrow) that slides in
  from the right over any page. Opened from the staff toolbar's **Message** button (starts on that
  client's people) or the ink chat button bottom-right, which replaces the client chat bubble for
  staff. Esc or a click outside closes it. Hidden on the Inbox page itself and while previewing or
  impersonating.
- A staffer on a client's **Messages** tab gets the same inbox limited to that client's people.
- **Time tracking**: QuickBooks Time (Workforce) is the only source of staff hours. The manual
  "My Time" page was removed 2026-09-29 (`time_entries` is kept, unused). The app separately
  records **automatic in-app time** per staffer per client (`components/staff/AppTimeTracker.js`,
  `supabase/app-time-tracking.sql`): it counts only while a real staffer (not a portal client,
  not "View as") has a client page open, the tab is visible and there was input in the last 2
  minutes; it flushes every 60 s and on tab hide through `record_app_time`, which caps each call
  at 120 s and wall-clock time, 12 h per client per day and 16 h per day. Not billed time.
- **Client details** (Settings gear → **Client settings**, staff only): Documents (Drive links),
  QuickBooks (connect / sync / disconnect), Notes, SOP, Milestone, Activity. Old links
  `#/client/<id>/client-details` still open it.
- **Manage access** (Settings gear → **Client settings**): People, Organization tabs, Requests.
  Old links `#/client/<id>/manage-access` still open it.
- **Settings** (`components/settings/Settings.jsx`, `settings.css`; route `#/settings`, from the
  account menu): Profile (name, title, phone, photo in the private `staff-avatars` bucket, row in
  `staff_profiles`), Notifications (email kinds + which bell items show), Appearance & start page,
  Email signature (used by Daily Close reminders and client emails), Dashboards (reset saved
  layouts), Shortcuts, and Firm settings for admins (Team; no Staff Access). Saved per person in
  `user_settings` (`ST_store`: localStorage cache `mygoodbooks_user_settings_v1`, debounced upsert
  on `user_email`). Read-only during View as.
- **Admin pages**:
  - **Team** (`components/staff/TeamPage.jsx`): QuickBooks Time hours and tasks by person and by
    client for a period (open, overdue, completed; hours by client with a 3-month average for
    pricing), an "In app" column (automatic in-app time, not billed), person and client
    drill-downs and CSV export. Still shows in-app time when QuickBooks isn't connected. Private tasks show once
    `supabase/admin-read-all-tasks.sql` is applied.
  - **Staff Access**: staff roster, add, bulk import, client assignments, temporary admin grants.
  - **Client Roster**: client organizations (add/edit), client contacts, invite, scoping, bulk
    import.
  - **Developer Tools**: system info, feature flags, recent activity, local storage.
  - **Usage Stats**: page views and feedback survey results.

### Admin features added 2026-09-29

- **Team page** (`#/team`): one place for staff, workload and capacity. Email settings moved to
  the Emails page; the Team page links there.
- **QuickBooks Time**: firm connection and hours by person and client, which feed
  **profitability** (fee vs. cost at each person's rate) and **capacity** (weekly hours vs. target).
- **Close tracker** (`#/close-tracker`): month-end close status per client. The "Mine" filter
  uses the assigned bookkeeper's staff email.
- **Task templates** (`#/templates`): recurring monthly, quarterly and annual tasks, generated
  daily for each client's assigned bookkeeper (`supabase/task-templates.sql`).
- **Onboarding**, **client health**, **audit log** (`#/audit-log`) and **offboarding**
  (`offboard_staff` hands a leaver's clients to a replacement, including the assigned bookkeeper).
- **Weekly admin digest** (edge function `weekly-admin-digest`) and **client emails**, both sent
  through Resend (`supabase/functions/_shared/email.ts`).
- **Emails page** (`#/emails`, admins only; `components/staff/EmailsPage.jsx`): a setup banner,
  the Weekly digest card, the Client emails card (switches, per-client opt-outs, unsubscribed
  list) and a send log that merges `digest_runs` and `client_email_log`, filterable by type and
  status. The banner reads the newest real send attempt from those logs: sent means working,
  `not_configured` means the `RESEND_API_KEY` secret is missing, and a Resend "domain is not
  verified" error means the key works but the domain isn't verified. "Check the key" asks
  `weekly-admin-digest?preview=1&format=json` whether the key is set. It sends nothing but
  logs a preview run. The digest email footer links to `#/emails`.
- **Digest sections**: scope creep, price review, revenue snapshot, late payers, timesheet gaps,
  staff scorecard, stale clients, pending, and **Staff feedback** (count of `staff_feedback` rows
  still `new`, split by kind, e.g. "3 new: 2 bugs, 1 idea"; how many arrived in the last 7 days;
  the 5 newest `new` reports with kind tag, sender and the first ~120 characters, escaped; link to
  `#/feedback`; "No new feedback." when there are none). All numbers come from
  `digest_weekly_data()` (`supabase/weekly-digest.sql`; the `staff_feedback` key was added by
  `supabase/digest-staff-feedback.sql`).
- **Bug reports / feedback** (`components/staff/Feedback.jsx`, `FB_` prefix; table
  `staff_feedback`, `supabase/staff-feedback.sql`). Staff open "Report a bug / feedback" from the
  top bar's **?** menu or the bottom of the Help page: kind chips (Bug first and default, Idea,
  Question, Other), message, optional "What did you expect to happen?" for bugs. The page hash and
  open client are sent along; bugs also send the browser user agent + screen size. "My feedback" in
  the modal lists the sender's own reports with status and admin reply. Admins triage on the
  **Feedback** page (`#/feedback`, admin sidebar, badge = count of `new`): newest first, filter by
  status/kind, bugs tagged red, change status (new / planned / done / won't do) and a note to the
  sender inline. RLS: active staff insert + read own; admins read all and update; no deletes. A
  trigger stamps `author_email` from the JWT, forces `new` on insert and lets updates change only
  `status` / `admin_note`. The weekly digest has a **Staff feedback** section (see below).
  **Screenshots** (`supabase/feedback-screenshots.sql`): up to 3 images per report (png, jpeg,
  webp, gif; 10 MB each) via "Add screenshot", drag-and-drop onto the window, or paste
  (Cmd/Ctrl+V). The modal picks the row id up front, uploads on Send to the private
  `feedback-screenshots` bucket at `<author_email>/<feedback id>/<short id>-<name>`, then inserts
  the row with `attachments` (jsonb array of `{path, name, size, type}`; a check constraint caps it
  at 3 and pins paths under the sender's folder, and the insert trigger requires each file to
  exist). Failed inserts keep the uploads for the retry and keep the typed text. Storage RLS:
  active staff upload into / read their own email folder; admins read all and may delete; no
  updates. "My feedback" and the admin page show thumbnails via 1-hour signed URLs
  (`FB_Shots`); click opens full size in a new tab. `attachments` is locked after insert.
- **Assigned bookkeeper**: the Client Roster now picks a real staff member.
  `clients.assigned_bookkeeper_email` references `staff(email)`; the old display JSON is kept in
  step by a trigger. Setting it gives that person client access, and removing their access clears
  it (`supabase/assigned-bookkeeper-email.sql`). Clients whose old name matched no staff member
  show "Not linked to a staff member" until an admin picks someone.
- **QuickBooks API usage** (added 2026-09-30, Team page, admins): calls this month against
  Intuit's 500,000 limit, the month-end projection, the current Pro cadence and a per-source
  breakdown; "Change limits" edits `qbo_usage_settings` (limit, slow-down %, stop %, cadences).
  The weekly digest's Pending section shows the same line (`supabase/qbo-usage-guard.sql`).
- **Automated close checks** (added 2026-09-30, Close tracker and client overview): each
  completed month gets **Ready**, **Blocked** (uncategorized / Ask My Accountant activity in the
  month, or Undeposited Funds not cleared at month end) or **Behind** (a bank or card account
  went quiet before month end, or transactions on or before month end aren't reconciled), with
  the reasons on hover and in the cell editor. The status filter and summary can pick them.
  Written by `close_checks_evaluate()` after each close-data pull and daily at 11:25 UTC
  (`supabase/qbo-close-checks.sql`). Reconciliation is read from each transaction's cleared flag
  and bank-feed health from the last transaction date; QuickBooks exposes neither directly.
- **Stale-bank flags** (added 2026-09-30): a bank or card account with no transaction in more
  than N days (default 10; admins set it in the Close tracker toolbar,
  `month_close_settings.stale_bank_days`) is flagged in the Close tracker client column and on
  the client overview.
- **Entity type** (added 2026-09-30): `clients.entity_type` is `nonprofit` (default) or
  `for_profit`. Set on the client overview's Onboarding card (any staff with access, through
  `set_client_entity_type()`) or in Client Roster add/edit (admins). Stored and shown only for
  now (`supabase/client-entity-type.sql`).
- **Deep links**: pages have hash URLs such as `#/team`, `#/emails`, `#/tasks`, `#/home`,
  `#/client/<id>/overview` or `#/client/<id>/<tab>`. A link survives Google sign-in, and staff
  who can't see a page or client are sent to their dashboard instead.

Owner setup:

1. In Supabase > Edge Functions > Secrets, add `RESEND_API_KEY` (and optionally `DIGEST_FROM`),
   and verify the sending domain in Resend. Until then, emails are logged as "not configured".
   The Emails page banner shows which step is still missing.
2. Connect the firm's QuickBooks (Time) from the Team page, then map QuickBooks people and
   customers to staff and clients.
3. Set each staff member's cost rate (and weekly capacity) on the Team page so profitability,
   price review and capacity have numbers.
4. On the Client Roster, pick a real assigned bookkeeper for each client.

### Team Reviews and Team Survey (added 2026-10-07)

Staff-only module on the **Reviews** sidebar item (`#/reviews/<tab>`, `#/reviews/r/<id>`,
`#/reviews/survey`). Clients can't reach any of it: every table has RLS, and every read and write
goes through `security definer` RPCs that call `tr_me()` / `tr_require_admin()` first.

- **Front end** (in-browser Babel, `TR_` globals, loaded from `index.html` in this order):
  `components/staff/teamReviewsLogic.js` (scale, items, validation, year-end draft; unit tests in
  `teamReviewsLogic.test.js`), `TeamReviews.jsx` (page shell, tabs, overview store, sidebar badge,
  Home "Review due" card, the form), `TeamReviewsCompare.jsx` (comparison, action steps,
  signatures, reopen, close unsigned, addenda, PDF/Drive), `TeamReviewsSurvey.jsx` (survey and
  admin results), `TeamReviewsAdmin.jsx` (History, Team status, Year-end), `team-reviews.css`.
- **Tabs:** My review and History for everyone; admins also get Team status, Reviews I'm giving,
  Survey results and Year-end.
- **Database:** `supabase/team-reviews-1-schema.sql` (tables `review_settings`, `review_cycles`,
  `reviews`, `review_submissions`, `review_signatures`, `action_steps`, `review_events`,
  `review_addenda`, `survey_responses`, `survey_anonymous_answers`, `review_year_summaries`,
  `review_notifications`, `review_drive_folders`; locks and no-delete triggers) and
  `supabase/team-reviews-2-rpcs.sql` (all `tr_*` RPCs, the email outbox and the two crons
  `team-reviews-sweep` every 5 minutes and `team-reviews-due-soon` daily). Roles come from
  `public.staff` (bookkeeper = staff, admin = admin).
- **Blind rule** is enforced in `tr_get_review`: neither side's scores come back until both forms
  are submitted, admins included.
- **Signatures** store user id, typed name, account email, UTC time, IP and user agent. IP and
  user agent are read server-side from PostgREST's `request.headers` (`cf-connecting-ip`, then
  `x-real-ip`, then the first `x-forwarded-for` entry), never from the browser.
- **Edge function** `supabase/functions/team-reviews/` (`verify_jwt` off, checks the caller's JWT
  or the cron bearer itself): `pdf`, `export`, `year_pdf`, `year_export`, `drive_status`, plus the
  `sweep` job that sends queued emails and retries Drive exports hourly. PDFs are drawn in `pdf.ts`.
  Drive: Shared Drive id in `GOOGLE_DRIVE_REVIEWS_DRIVE_ID`, same `GOOGLE_SERVICE_ACCOUNT_JSON` as
  client files; path `{Staff Name}/{YYYY} Q{n} Review.pdf` and `{YYYY} Year-End Summary.pdf`;
  re-export updates the same file (new revision). Without the secret, reviews still lock and show
  "Waiting for Drive setup". Staff never get Drive links; PDFs stream through the portal.
- **Retention:** keep forever. Nothing in the module hard-deletes; unsigned reviews end as
  `closed_unsigned`, corrections after lock are addenda.
- **Anonymous survey questions (7 and 10)** are stored in `survey_anonymous_answers` without a
  staff id and shown only once 3 or more people answered. Caveat: with a small team, timing and
  writing style can still identify someone, and the table has no timestamp or staff id but someone
  with direct database access could guess from physical row order. It's "not linked by name", not
  cryptographic anonymity.
- Staff guide: `quarterly-reviews.md`, `team-survey.md`, `review-cycles.md`,
  `review-drive-setup.md`.

### Staff ops features (added 2026-10-07)

Eight staff-only features, built one per commit. Shared pieces: pure rules in
`components/staff/staffOpsLogic.js` (`OPS_` globals; unit tests in `staffOpsLogic.test.js`, run
with `node components/staff/staffOpsLogic.test.js`) and styles in `components/staff/team-ops.css`.
Each feature has its own component file with a unique prefix, loaded from `index.html` after the
Team Reviews files.

- **Hours budget per client** (admin only). `client_profile.monthly_hours_budget`
  (`supabase/client-hours-budget.sql`; a trigger keeps non-admins from setting or changing it,
  though they can technically read the column through the existing profile policy).
  `components/staff/HoursBudget.jsx` (`HB_`): one cached load of every budget plus this calendar
  month's `qbo_hours_by_client` (read only), shown in the Team Clients table (**Budget (this
  month)** column in `TeamQbo.jsx`), the overview Profitability card and the Home filter rule
  `budget` (`HC_RULES` entries can now be `adminOnly`). Near at 80%, over at 100%
  (`OPS_budgetStatus`). Guide: `hours-budget.md`.
- **Reply-time tracker.** `client_reply_times(p_from, p_to)` (`supabase/client-reply-times.sql`,
  security definer, read only): a wait starts at the first client message of an unanswered run in
  a (client, participant) thread and ends at the next non-internal staff message (the replier gets
  the credit); returns median, p90, % within the goal and open waits, overall, per replier and per
  client. Admins get everything; others only their own staff row and clients they can access. The
  goal is 24 calendar hours, a constant in both the RPC (`v_goal`) and `OPS_REPLY_GOAL_HOURS`.
  `components/staff/ReplyTimes.jsx` (`RT_`): the Team hub tab **Reply times** and the Home KPI tile
  `kpi-reply` (`RT_useMyReply`). The Team hub (`TP_TeamHub`) now takes extra tabs from the staff
  ops files (`TP_hubExtraTabs`, routed as `#/team/<tab>`; `buildHashRoute` keeps that sub-route).
  Guide: `reply-times.md`.
- **Time off and coverage.** `staff_time_off` (`supabase/staff-time-off.sql`; RLS: all active staff
  read, people add/edit their own, admins anyone's; no deletes, `cancelled_at` instead; a guard
  trigger stamps `created_by` and keeps a cancel final). `staff_directory()` lists active staff for
  pickers (bookkeepers can't read `staff`). Admin RPCs `coverage_overview(from, to)` (time off in the
  window, each person's clients, the client's backup and `backup_access`) and
  `grant_coverage_access(time_off_id, client_id)` (an approved `staff_client_access_grants` row for
  the backup, expiring the day after the time off ends, America/Chicago).
  `components/staff/Coverage.jsx` (`CV_`): Team hub tab **Coverage**, Home card `my-time-off`, the
  backup picker on the overview (`CV_StaffSelect`; the column is still `backup_bookkeeper_email`) and
  the `CV_OutTag` "Out until" tag (overview Key dates card, Inbox details). Emailing client messages
  to the backup was not built. Guide: `time-off-coverage.md`.
- **Firm deadline calendar.** `supabase/firm-deadlines.sql`: `firm_deadline_rules` (all active staff
  read, admins add/edit; no deletes, `active=false` turns one off; `due_rule` jsonb checked by
  `firm_deadline_rule_ok`), `client_deadline_overrides` (skip / different date / turn on an opt-in
  rule; `removed_at` instead of delete) and `client_deadline_status` ("Mark filed"; `undone_at`
  instead of delete). The last two need `can_access_client`. A guard trigger stamps who/when and
  freezes keys. Seeded US federal rules (1099-NEC, W-2, 941, 940, 990, 1096) say to verify.
  Dates are computed in the browser (`OPS_deadlineItems` in `staffOpsLogic.js`): weekends move to
  Monday, holidays don't; the 990 counts from `client_profile.fiscal_year_end` (May 15 if blank);
  the older `form_990_due` / `filing_1099_due` key dates are read as date overrides, never written.
  UI: `components/staff/Deadlines.jsx` (`DL_`), page `#/deadlines` (all staff) and Home card
  `upcoming-deadlines`. **Create task** adds a `staff_reminders` row with `source='deadline'`,
  `source_ref` = item id. Guide: `deadlines.md`.

### Client side (and staff viewing a client)

- **Basic** has no Dashboard, so a Basic client lands on Reports.
- **Settings** (gear at the bottom of the client sidebar; `#/client/<id>/settings[/<tab>]`):
  Profile, Notifications (bookkeeper messages, reports ready, monthly summary), Organization
  (full-access users: team list and org settings via `client_org_team` /
  `client_update_org_settings`, others can request access), Plan (the old Plans page;
  `#/client/<id>/plan`, `plans` and `enterprise-upgrade` still work), Appearance, Security
  (sign out on all devices) and Help. Staff viewing a client get **Client settings** (Manage
  access + Client details) and **Plan** instead; Preview as is read-only.
- **Your account manager** and **Your bookkeeper** cards at the bottom of the Dashboard
  (`AM_TeamRow` in Settings.jsx: `AM_AccountManagerCard` via RPC `client_team_profiles`,
  `ST_BookkeeperCard` via `bookkeeper_public_profile`), each with a Message button. They are
  Dashboard widgets (`team-account-manager`, `team-bookkeeper`); one card when the same person is
  both. The account manager (`clients.account_manager_email`, `supabase/account-manager.sql`,
  default Jesse) is the only one emailed when the client messages; staff can loop in the
  bookkeeper (`client_message_loop_in`) or @mention them. Staff replies on the client Messages
  page show the author's name and title.
- **Sidebar heading:** the client's milestone (for example "III · Growth"), which opens the
  Milestone page. The milestone pill sits under the tagline in the sidebar (it used to be in the
  page header). Next to it is the gold **Pro** pill, or for Basic and Plus a lock that opens
  Plans. Collapsed, it shows just the roman numeral.
- **Dashboard** (customizable widgets and saved views). A Pro, full-access client gets
  **Financial Overview** here instead.
  - **Customize** opens a right-side drawer (360px wide, full-width sheet on phones; Esc, X or
    a click outside closes it). **Add widgets** lists hidden widgets as cards with a skeleton
    preview, and **+** appends one and flashes it on the board. **On your dashboard** lists what is
    showing, with up/down, drag, and remove. The footer has saved views and **Reset to default**.
    While the drawer is open the board is in edit mode: each card gets an outline, a drag handle
    and a remove button. The same drawer serves Bookkeeper Home and the Financial Overview.
  - Layouts and saved views follow the signed-in person across browsers and devices:
    they are saved in `public.user_board_layouts` (`supabase/user-board-layouts.sql`), with `localStorage` as a cache, per signed-in user and board (debounced saves; an existing local
    layout is uploaded once). If that table is missing or unreachable, it quietly stays on
    `localStorage`. Nothing is written while staff use View as or preview a person.
- **Messages**: each person's private thread with MyGoodBooks (`client_messages`, see the Inbox
  above), with attachments, live updates, and the sidebar dot and ChatFab fed from real read
  markers. Internal notes never show here. Staff previewing a person see their real thread
  read-only if they have one, else the sample thread. The notification bell adds "New message
  from your bookkeeper".
- **Budget vs. Actual**, **Bank Accounts**, **Cash Flow** (receivables and
  payables), **Reports**, **Giving & Funds**, **Payroll** (add-on), **Documents** (with folders
  and previews).
- **Pro upgrades** show inline on the same tabs:
  - Financial Overview
  - Budgeting Tool
  - Cash Flow Pro
  - Report Builder
  - Reconciliation Pro
  - Fund Accounting Pro, including **Tax Documents**: year-end giving statements per donor.
    A "Sent" status is saved only in that browser (`mygoodbooks_tax_docs_sent_v1`), and the app
    asks for confirmation before resending.
- **Notifications from the bookkeeper:** a bell in the page header (clients, and staff
  previewing as a client) with an unseen count, a "From your bookkeeper" panel, and a pop-up
  when something new arrives. Items: open document requests ("Please upload: …") and, for
  full-access users, a budget draft waiting for approval. "Seen" is kept per browser
  (`mygoodbooks_notif_seen_v1:<clientId>`). Documents also shows a request banner and the
  sidebar a dot.
- **Pro budget tools** (`components/pro/ProBudget.jsx`), as tabs on Budget vs. Actual:
  - Budget vs. Actual with variance notes, which the client sees and the board packet carries.
  - Spending Trend.
  - Year-End Forecast.
  - What-If.
  - Next year's budget: a draft with monthly (seasonal) amounts and a ministry owner per line,
    line comments, and version history. It moves draft → submitted → changes requested /
    approved, and can be exported as a PDF. Category-scoped users see and edit only their lines.
- **Pro board reports** (`components/pro/ProReports.jsx`), below Report Builder on Reports:
  - A board packet PDF with a cover, contents, the sections you pick and the comparison columns
    you pick.
  - Saved templates.
  - Comparisons: vs. budget, prior month, same month last year, and YTD vs. last YTD. When there
    isn't enough history it says so.
  - A Statement of Functional Expenses using the Form 990 columns, with an editable
    category-to-function map.
  - Giving detail: top and lapsed donors, giving by fund, and pledges.
  - An editable "what happened this month" summary.
  - Read-only share links (7/30/90 days, can be turned off). They open at `/?share=<token>`
    without signing in, through `get_report_share`.
  - The church's logo and colour on PDFs.
- All of these need `supabase/pro-budget-reports.sql` (applied 2026-09-27). Pro gating is in
  the app, and the tables are open to the org's client users and to staff who can access the
  client.
- **Milestone** (pricing tracker):
  - **Rules.** Tiers and fees match the public pricing chart (`marketing/pricing-embed.html`,
    pasted into the Squarespace site) and live in `PRICING_MILESTONES` in `app.jsx`; change both
    together. A client's milestone is the **higher** of two measures: trailing 3-month average
    monthly transactions (from synced QuickBooks data) and annual expenses (staff-entered
    from the Form 990 or approved budget, else the QuickBooks budget, else 12 months of expenses).
    The tracker only proposes; staff set every change, up or down, and fees go down too.
  - **Tiers (since 2026-09-26).** Nine milestones: I Starter $250 (up to 30 tx, up to $150K),
    II Foundation $300, III Growth $400, IV Expanding $600, V Established $700, VI Advanced $800,
    VII Strategic $1,500, VIII Premier $2,500 (501–800 tx, $3M–$4M), IX Enterprise custom
    (800+ tx or $4M+).
  - **Church Plant (since 2026-09-27).** $100/mo until the church launches. It's stored as tier 0
    (`CHURCH_PLANT_MILESTONE`) and shows as "CP" / "Church Plant". Staff pick it in Set milestone;
    the numbers never suggest it, and no change is proposed while a client is on it. After
    launch, staff set the regular milestone. Needs `supabase/milestones-church-plant.sql`, which
    allows tier 0.
  - The old six-tier chart's history rows have `chart = 1` and show with their
    old names plus "(old chart)".
  - **Badge.** Navy-and-gold pill in the client sidebar, under the tagline: "MILESTONE" over the name,
    the numeral in a gold medallion with a progress ring toward the next milestone, and a note
    right on the badge: "Near X" (within 90%), "Reached X" or "Moving to X" (numbers point to a
    different milestone that staff haven't set yet). Staff also see "Set milestone" on clients not
    set yet. Hover shows "N% of the way to X". Hidden from category-scoped users and on staff-only
    pages. The sidebar heading repeats it.
  - **Milestone page** (opened from the badge): staff see **Staff: budget and milestone** first
    (budget entry, Set milestone with a note, history), then the client view: summary, the two
    progress bars, the step chart with "You are here", and the full table. Clients see only the
    client view. Also in **Client details → Milestone**; staff Home has **Milestones to review**.
  - **Database:** `supabase/client-milestones.sql` (`client_milestones`,
    `client_milestone_history`, `client_milestone_stats`, `confirm_client_milestone`; only staff
    can set a milestone). Existing databases run `supabase/milestones-nine-tiers.sql` once for the
    nine-tier chart, then deploy; it clears every confirmed milestone so staff set each client
    again.
- **Plans** page (`EnterpriseUpgradePage`, page key `enterprise-upgrade`): three plan cards with
  prices (and this org's estimated total), the sync schedule, an Upgrade button for each higher
  plan, and the downgrade and payroll terms. The request is real
  (`request_enterprise_upgrade` with `p_plan`, from `supabase/plans-basic-plus-pro.sql`, applied
  2026-09-27).
- **Reports and PDFs** are generated in the browser with jsPDF: P&L, balance sheet, budget vs.
  actual, contribution and giving statements, reconciliation, payroll YTD, draft budget.
- **Global search**, light/dark (Settings → Appearance), collapsible sidebar. In a mouse/trackpad window at half
  the screen width or less (`isHalfScreenWindow`) the sidebar auto-collapses to icons, however
  narrow the window gets; the expand button still works there without changing the saved
  preference. Touch phones (below 760px) get a hamburger drawer instead. A page refresh keeps you
  on the current page.
- **Hover labels** use the app's own navy-and-gold tip (`.icon-hover-tip`), not the browser's
  native tooltip.

## Database changes

- All SQL lives flat in `supabase/*.sql`. It's applied **by hand**, either in the Supabase SQL
  editor or through the Supabase MCP `apply_migration`. Nothing applies it automatically.
- The files are written to be **re-runnable** (`if not exists`, drop-then-create policies,
  `create or replace`). Keep new files that way. Each file's header says what it depends on.
- **The live database can differ from the repo.** Function bodies and policies have been
  changed live before. Before running a `create or replace function`, check the live body
  (`select pg_get_functiondef('public.fn_name'::regproc)` or look in `pg_proc`) and build on
  that.
- Some file headers say "NOT APPLIED" but were applied later (for example
  `qbo-sync-cron-5min.sql`, since superseded by `qbo-sync-cron-1min.sql`). Check the live
  database (`select * from cron.job`, `pg_policies`, `pg_proc`) before trusting a header.
- **Edge functions** live in `supabase/functions/<name>/index.ts` and are deployed with the
  Supabase MCP or CLI.
  - Secrets (`QBO_CLIENT_SECRET`, `QBO_TOKEN_ENCRYPTION_KEY`, the service role key, and so on)
    are set only in Supabase.
  - `qbo-sync`, `qbo-callback`, `qbo-refresh-token` and `qbo-firm-sync` run with `verify_jwt`
    off and check the caller themselves.
  - `invite-client-user` runs with `verify_jwt` on.
- **Client files in Google Drive** (`supabase/google-drive-files.sql`, applied 2026-10-06;
  function `supabase/functions/drive-files/`, `verify_jwt` off, checks the caller's JWT itself).
  - Files from the Documents page, the page-wide drop, document requests and client message
    attachments are stored in the "~ MGB: Client Files (Portal)" Shared Drive under
    `<Client name>/<Year>/<Document type>`, through a service account that is a Content manager on
    that Shared Drive (no domain-wide delegation). Secrets: `GOOGLE_SERVICE_ACCOUNT_JSON`,
    `GOOGLE_DRIVE_SHARED_DRIVE_ID`. Owner setup steps are in the staff guide article
    `docs/staff-guide/google-drive-files.md`.
  - Supabase keeps only `client_files` (metadata + Drive file id; browsers can only select, RLS
    mirrors the old bucket policies) and the folder cache `drive_folders`. `drive_file_events`
    logs uploads, trash and restore; `drive_status` records whether the secrets are set
    (written by `ops-health-check`) and the last Google auth result.
  - Downloads are 10-minute HMAC-signed links back to the function, which streams the file, so
    clients never need Google access. Staff get an "Open in Drive" link.
  - Portal Trash = Drive trash (Drive empties it after 30 days). Nothing is ever deleted from
    Drive by the portal; Drive files have no "Delete forever".
  - Connected 2026-10-07 (Google project MyGoodBooks Auth, service account mgb-portal-drive).
    Without the secrets the function answers `503 drive_not_connected`; `DRV_STORAGE_FALLBACK`
    is now `false`, so uploads then stop with an error instead of going to `client-uploads`. Old bucket files keep working; staff can copy them into Drive
    (originals untouched) with "Copy older files to Drive".
  - Avatars, Feedback screenshots and `staff-chat-attachments` stay in Supabase Storage.
  - `ops-health-check` alerts on 3+ failed Drive uploads in an hour and on Drive not connected
    while non-test clients exist.
  - Logic test: `node supabase/functions/drive-files/logic.test.mjs`.
- **A policy mistake to avoid.** An existence subquery inside an RLS policy is itself filtered
  by that table's RLS, so it can quietly let the wrong people through. Put existence checks in
  a `SECURITY DEFINER` function instead, as `is_conversation_member()` does.
- Make probe or test functions in `pg_temp`, never `public`.

## Working on it

- **Local preview.** Start the `client-dashboard` server from `.claude/launch.json`: a small
  Node server (`.claude/serve.js`) on **port 8420**. Then:
  - The local server doesn't rewrite `/login`, so use `/?client-login=1` to see the client gate.
  - Seeing the signed-in app requires a real Google sign-in or magic link. There's no fake login.
  - Set `MGB_CSP_TEST=1` to serve the CSP as enforcing, for testing.
- **Test.** `node components/qbo/mapQboToClient.test.js` checks the QuickBooks mapper against
  `data.js`'s shapes.
- **Commit straight to `main`.** No feature branches unless asked. The owner pushes with GitHub
  Desktop, and Vercel deploys within about a minute.
  - To undo, revert the commit (`git revert <sha>`) and push, or promote the previous
    deployment in Vercel.
  - For Vercel preview URLs to support Google sign-in, they must be on Supabase's Redirect URLs
    allow-list.
- **Never put secrets in files.** That includes the Supabase service role key, Intuit client
  secret and encryption keys. The whole repo is served publicly as static files, so anything
  next to `index.html` is a public URL.
- `.vercelignore` keeps `*.md`, `supabase/`, `marketing/`, `design-system/`, `.claude/` and
  snapshots out of the deploy. If you add a file that `index.html` loads, make sure
  `.vercelignore` doesn't exclude it.
- Any new modal should use the shared `ModalShell` (focus handling and keyboard support).

## Claude Design

- **The design system is "MyGoodBooks".** It exists in two linked forms:
  - the claude.ai Design System artifact (https://claude.ai/artifact/ARYpfcrCbFgFxJnbm1xqLx),
    the organization's default. It's the written brand guide, tokens and component references.
  - the Claude Design project **"MyGoodBooks"**
    (https://claude.ai/design/p/96865ffb-efaf-4fd2-8e6d-4665a5d3332f), which Claude Design's
    agent builds with. It has 43 real components (cards, buttons, badges, charts, toast, 30
    icons), the brand fonts, and the brand guide.
- `design-system/` is the React/TypeScript package that feeds the Claude Design project. It's
  synced with `/design-sync` (run it in Claude Code, not in Terminal). Its
  `.design-sync/config.json` is pinned to the new project.
- **Retired:** the old Claude Design project "MyGoodBooks Design System"
  (`b5c754f7-266e-4cf2-98a4-f1445fca1cc8`). Never sync to it. Delete it in Claude Design (Design
  systems tab → ⋯ → Delete Project) once nothing uses it.
- Its `src/styles.css` is a **manual copy** of the relevant parts of the app's `styles.css`. When
  the app's look changes, copy the changes over and re-sync. Check the brace balance afterwards.
- Setup quirks (the iCloud duplicate folders, the Chrome path for the render check) are in
  `design-system/.design-sync/NOTES.md`.

## Known gaps and roadmap

**Team Reviews (later)**

- Google Chat notifications for review cycles (email only for now).
- Evidence chips next to Ownership · Behavior (Asana overdue tasks, Calendar sessions outside
  scheduled hours; later Gmail response time). Spec marks them optional.
- Survey results "Recurring themes" card from the design: needs text analysis, so results show
  every answer per question instead.

**Tasks and staff tools**

- Daily email digest for tasks. Needs an email service first.
- Assignee picker for tasks (assign a task to another staffer).

**Client value (Phase 2)**

- Client Settings is built (2026-09-30). Notification emails queue in `notification_emails`
  (outbox triggers) and send through the `notification-emails` function once the Resend domain
  is verified; until then they show as "coming soon" / queued.
- Email notifications for client messages (the messages themselves are real since 2026-09-28).
- Point Staff Home's "Unread messages" card and the Client overview's "threads waiting" at
  `client_messages` (they still read the sample threads).
- Tax Documents "Sent" status should move to a Supabase table (client, donor, year, sent_at,
  sent_by) once statements are really emailed. Statement sends and referral sends are still
  mock.
- Persistent client document uploads (today: Drive links for staff, uploads for this session
  only for clients).

**Simplify (Phase 3)**

- Plain-language labels, one name per tab, two nav groups.
- Remove sample-data banners wherever live data exists.
- Loop the Claude Design **"Report Builder Video"** on the sign-in page: video left and card
  right on desktop, muted, no controls, still under reduced-motion, smaller on phones.

**QuickBooks sync at scale**

- The every-minute cron syncs every connected company in turn, a few seconds each. Past roughly
  15 companies a sweep takes longer than a minute. Before then, switch to QuickBooks webhooks
  (sync a company when it changes) instead of polling faster.

**QuickBooks Time hours (backend written, NOT applied)**

- `supabase/qbo-firm-time.sql` + `functions/qbo-firm-sync` + a small firm branch in
  `qbo-callback`: connect the firm's own QuickBooks company, pull `TimeActivity` hourly, map
  QBO customers to clients and employees to staff, and report hours with
  `qbo_hours_by_client` / `qbo_hours_by_staff`. Design notes are in the SQL header. Needs the
  migration applied, both functions deployed, and a Team-page UI.

**Code health (Phase 4)**

- Move to Vite (a real build step). That would also allow a stricter CSP.
- Split `app.jsx` by page and add a data-access layer.
- Add tests: `resolveAccess`, fail-closed scoping, operating reserve math, formatters,
  `safeHttpUrl`.

**Data and access gaps**

- Per-person category scoping isn't enforced in the database for `qbo_*` rows. The helper
  `client_can_see_category()` exists (`client-scope-view.sql`) but the QuickBooks policies
  don't use it yet.
- Manage access → Organization tabs and dashboard layouts are saved in each browser's
  `localStorage`, not in Supabase, so they don't carry across devices or people. The People
  tab edits sample users.
- QuickBooks gaps: no account numbers (masks), bill memos not synced. Reconciliation is only a
  proxy (cleared flags on the last 13 months of bank and card transactions), and CDC only gates
  the full re-read; it doesn't merge deltas.
  Giving, funds and payroll aren't sourced from QuickBooks.
- Financial Overview cards with nothing to show for a live client (no expenses posted this month, no
  open invoices, no monthly P&L yet) show a short muted line instead of rendering blank. Budget
  health, bills due soon, fund activity and cash by account hide themselves instead. The sandbox
  company (grace-community) often has little or no current-month activity, so "Where the money
  went" can legitimately be empty there.
- `data.js` is loaded before login. That's harmless while it holds only sample data, but real
  client numbers must never go into it.

## Security notes

- **RLS is the real enforcement.** The browser holds only the publishable key. Hiding something
  in the UI is a convenience, not protection. Every per-client table is scoped with
  `can_access_client()`.
- The `qbo_*` tables have no write policies at all.
- `qbo_tokens` has no policies, so browsers can't reach it; it's reached only through
  security-definer functions and edge functions.
- **CSP is report-only.** `vercel.json` sends `Content-Security-Policy-Report-Only`. After one
  real staff session and one client session show no console violations, rename the header to
  `Content-Security-Policy` to enforce it.
- The other headers (X-Frame-Options DENY, HSTS, nosniff, Referrer-Policy, Permissions-Policy)
  are enforced.
- **Browser-exposed functions.** Internal `SECURITY DEFINER` functions have EXECUTE revoked from
  anon/authenticated. Only helpers that policies need, plus the anonymous access-request RPCs,
  stay callable.
- **Write stamping.** Writes to telemetry, notes and messages are stamped with the caller's JWT
  email, never a value the browser sends.
- **Team Chat groups can be retired** (`supabase/staff-chat-retire-groups.sql`, applied
  2026-09-28). Any member can retire a group from the Inbox's context pane. A retired group is hidden
  from the list (behind "Show retired groups"), is read-only (the send policy checks
  `conversation_is_live`), and can be restored. An admin can then "Delete permanently" through
  `delete_staff_group`, which removes its messages and members. Its attachment files stay in the
  bucket.
- **Client messages** (`supabase/client-messages.sql`, applied 2026-09-28): staff who can access
  the client see every thread; a client user sees only their own thread and never internal
  notes; no updates or deletes; author emails are checked against the JWT.
  `supabase/client-messages-realtime.sql` (applied 2026-09-28) adds the one realtime.messages
  policy client users need to join their own `client-msgs-<email>` topic. It also:
  - Fixes the client `client-uploads` policies from `staff-client-tools.sql`. Inside their
    `client_users` subquery, `name` meant the person's name, not the file path. They now use
    `is_client_member()`.
  - Limits each client user to their own `messages/<email>/` folder.
  - Limits a client message's attachment to that folder.
- **Team Chat.** Membership is enforced in the database. Attachments go to a private bucket with
  a 25 MB limit and allowed file types, scoped to conversation members.
- **Realtime** channels are private, but only once Supabase's dashboard setting "Private
  channels only" is on (see `audit2-realtime-private-channels.sql`).
- The literal `'placeholder-rotate-me'` in `qbo-token-encryption.sql` was checked on 2026-09 and
  seals nothing: the live token was written with the real key. Re-check after any restore from
  an old backup.
- The QuickBooks functions never log Intuit response bodies (an Intuit review rule). They log
  only status codes, counts and `intuit_tid`.

## History

The old `HANDOFF2.md`–`HANDOFF7.md`, `HANDOFF-DESIGN.md` and
`client-dashboard-claude-code-prompt.md` were retired on 2026-09-23. They're still in git
history. For example, `git show 3344625:HANDOFF7.md` shows the full running log (§1–§171),
which explains the reasoning behind most of the decisions above.

## Staff guide

The staff Help page (`#/help`, "Help" in the staff sidebar or **?** in the top bar, whose menu opens the
current page's article or "Report a bug / feedback") is a searchable how-to guide for staff.

- **Source:** one markdown file per article in `docs/staff-guide/*.md`, with frontmatter `title`,
  `section`, `audience` (`staff` or `admin`), `keywords` and optional `sort`. The file name is the slug
  (`#/help/<slug>`). `docs/` is in `.vercelignore`, so the source is never served.
- **Storage:** articles live in the `staff_guide` table (`supabase/staff-guide.sql`). Only active staff
  can read `staff` articles and only admins can read `admin` ones (RLS). Search is the
  `search_staff_guide(q)` RPC (full-text search with a partial-word fallback). The app never writes to the table.
- **Keep it current (required):** every change staff would notice (a new page, button, setting, email,
  workflow or changed behavior) must update or add the matching article in the same commit, then
  re-sync. Mark admin-only topics `audience: admin`. Write in plain language for bookkeepers, using the
  exact button labels from the UI. Treat the guide like this README: if a feature changes, the guide changes.
- **Re-sync after editing:** `node docs/staff-guide/sync.mjs --check` validates the files, then
  `node docs/staff-guide/sync.mjs > /tmp/staff-guide-sync.sql` and run that SQL in the Supabase SQL
  editor (or through the Supabase MCP `execute_sql`). It upserts every article and removes rows whose
  file was deleted; it's safe to run again. The UI is `components/staff/StaffGuide.jsx` + `staff-guide.css`.
