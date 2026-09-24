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
| Design system | Claude Design project "MyGoodBooks Design System" (see [Claude Design](#claude-design)) |

The local folder (`~/Desktop/Mygoodbooks-app-code/client-dashboard`) can fall behind GitHub,
because some work happens in Claude Code web sessions. Run `git fetch` and compare with
`origin/main` before starting.

## How it runs

- **No bundler.** `index.html` downloads each source file as plain text and compiles it in the
  browser with `@babel/standalone`, which handles JSX and TypeScript. Nothing is built ahead
  of time.
- **Load order.** `window.__SOURCE_ORDER` in `index.html` lists the files in the order they
  run: `auth-config.js`, `qbo-config.js`, `components/auth/*`, `data.js`,
  `components/daily-close/*`, `components/qbo/mapQboToClient.js`, then `app.jsx`. All files
  start downloading at once, but they compile in this order.
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
  - Live Report has its own stylesheet, `components/daily-close/DailyClose.css`.
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
| `components/daily-close/` | Live Report (`DailyClose.tsx`, its CSS, sample data, and `fromClient.js`, which adapts client data for it) |
| `components/qbo/` | `mapQboToClient.js` converts QuickBooks table rows into the shape the pages use. Its test is `mapQboToClient.test.js`. |
| `supabase/*.sql` | Every database change: tables, row-level security (RLS) policies, functions, cron jobs. The folder is flat, one file per change. |
| `supabase/functions/` | Edge functions: `qbo-callback`, `qbo-refresh-token`, `qbo-sync`, `invite-client-user` |
| `privacy-policy.html`, `terms-of-service.html`, `qbo-connected.html` | Standalone public pages, served at `/privacy`, `/terms` and `/quickbooks-connected` |
| `vercel.json` | URL rewrites (`/login`, `/privacy`, `/terms`, `/quickbooks-connected`) and security headers |
| `.vercelignore` | Keeps internal files out of the public deploy (see [Working on it](#working-on-it)) |
| `logo.webp` | Logo |
| `marketing/` | Marketing drafts, plus `pricing-embed.html`: the public pricing chart as a Squarespace Code Block (plain HTML/CSS). Not deployed. |
| `design-system/` | Design-system package for Claude Design. Not deployed. |

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

- **Admins** see every client, plus Staff Access, Client Roster, Developer Tools and Usage Stats.
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
  contact can see: access level, tabs, categories, funds and a premium throttle. This is stored
  in `client_users`.
  - Empty lists are stored as `null`, which means "everything".
  - This scoping currently only hides things in the app. The database does not yet filter
    QuickBooks rows by category (see [Known gaps](#known-gaps-and-roadmap)).
- **Per org.** Sidebar → **Manage access** has People / Organization tabs / Requests.
  - The People and Organization tabs still work on **sample** users and per-browser settings
    (see [Known gaps](#known-gaps-and-roadmap)).
  - The Requests tab is real (`access_requests`).
- **Preview.** Staff can "Preview as" a client user to see what that person sees.
- **Premium.** Premium features depend on `clients.plan`. The "Force premium plan" dev switch
  is staff-only and saved per browser. It isn't a security boundary, because the data still
  goes through RLS.

## Data: real vs. sample

**Real (from Supabase):**

- Client roster, staff, assignments, client contacts
- Notes, private notes, SOPs, tasks and reminders, time entries
- Team Chat, activity log, access requests, upgrade requests, usage stats and feedback
- Document links (Google Drive links only; no files are stored)
- QuickBooks data for connected clients

**QuickBooks connection:**

- **Connect.** Staff connect a client's QuickBooks from Client details → QuickBooks. This runs
  OAuth through the `qbo-callback` edge function; tokens are stored encrypted in `qbo_tokens`.
- **Token refresh.** `qbo-refresh-token` runs every 15 minutes (cron `qbo-refresh-tokens`).
- **Sync.** `qbo-sync` pulls accounts, 12 months of P&L, budget, open invoices, open bills and
  90 days of transactions into the `qbo_*` tables.
  - **Cron** job `qbo-sync-hourly`. Despite the name, it runs **every minute** except :00, :15,
    :30 and :45 (`'1-14,16-29,31-44,46-59 * * * *'`, `supabase/qbo-sync-cron-1min.sql`), which
    keeps it off the token refresher's minutes. An open page re-fetches the client's numbers once
    they're more than about 90 seconds old.
  - **Sync now**: clicking the header's gold Live pill (the refresh icon at its right end) syncs,
    for staff and clients; also in Client details → QuickBooks. The function re-checks that the
    caller may sync that client.
  - **60-second throttle** per connection, for Sync now only (the cron isn't throttled).
  - **Lock.** `qbo_connections.sync_started_at` stops two syncs overlapping; a stale lock
    expires after 5 minutes.
  - **Atomic writes.** Each table's rows are swapped in one transaction by `qbo_replace_rows()`,
    so no one sees a half-finished sync.
- **Browser access.** Browsers can only **read** the `qbo_*` tables. Only the sync function
  (service role) writes to them.
- **Header (top right of every client page).** Two rows, right-aligned (left-aligned on phones):
  the **Milestone badge** on top, then the **Live pill** ("● Live · synced N minutes ago" plus a
  refresh icon; one button, `QboSyncNowButton` with `liveLabel`) and search. A client without
  QuickBooks data shows a grey **"Prototype · Sample Data"** badge instead of the Live pill. The
  "synced" label ticks every minute.
- **Sample banners.** `MockBanner` hides itself on financial pages when
  `client.dataSource === "quickbooks"`.
- As of 2026-09-22 the connected company was an Intuit **sandbox** company, even though the app
  uses production keys.

**Still sample or mock:**

- `data.js`: all financials for orgs without QuickBooks, and for every org: giving, funds,
  pledges, donors, payroll (Gusto) and the "Preview as" user list.
- Client **Messages** are sample threads with simulated bookkeeper replies.
- Client **Documents** uploads stay in the browser for that session only.
- Giving statement "Send" (Tax Documents) only simulates delivery; nothing is emailed.
- The referral popup (`ReferralPopup`) exists in code but isn't shown anywhere.

## Main features

### Staff side

- **Home** (`bookkeeper-home`): Your clients (with health dots), Needs attention, Needs a visit,
  Unread messages, Your reminders, Access requests, Enterprise upgrade requests, Recently viewed,
  Milestones to review, Jump to client.
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
- **Team Chat** (`staff-messages`): direct messages and groups, attachments, edit/unsend, read
  receipts, online presence and typing indicators (Supabase Realtime).
- **My Time**: log time per client, totals, recent entries, firm-wide utilization (admins).
- **Client details** (sidebar): Documents (Drive links), QuickBooks (connect / sync /
  disconnect), Notes, SOP, Milestone, Activity.
- **Manage access** (sidebar): People, Organization tabs, Requests.
- **Admin pages**:
  - **Staff Access**: staff roster, add, bulk import, client assignments, temporary admin grants.
  - **Client Roster**: client organizations (add/edit), client contacts, invite, scoping, bulk
    import.
  - **Developer Tools**: system info, feature flags, recent activity, local storage.
  - **Usage Stats**: page views and feedback survey results.

### Client side (and staff viewing a client)

- **Dashboard** (customizable widgets and saved views). A premium, full-access client gets
  **Live Report** here instead.
- **Messages**, **Budget vs. Actual**, **Bank Accounts**, **Cash Flow** (receivables and
  payables), **Reports**, **Giving & Funds**, **Payroll** (add-on), **Documents** (with folders
  and previews).
- **Premium upgrades** show inline on the same tabs:
  - Live Report
  - Budgeting Tool
  - Cash Flow Pro
  - Report Builder
  - Reconciliation Pro
  - Fund Accounting Pro, including **Tax Documents**: year-end giving statements per donor.
    A "Sent" status is saved only in that browser (`mygoodbooks_tax_docs_sent_v1`), and the app
    asks for confirmation before resending.
- **Milestone** (pricing tracker):
  - **Rules.** Tiers and fees match the public pricing chart (`marketing/pricing-embed.html`,
    pasted into the Squarespace site) and live in `PRICING_MILESTONES` in `app.jsx`; change both
    together. A client's milestone is the **higher** of two measures: trailing 3-month average
    monthly transactions (from synced QuickBooks data) and annual operating budget (staff-entered
    from the Form 990 or approved budget, else the QuickBooks budget, else 12 months of expenses).
    The tracker only proposes; staff set every change, up or down, and fees go down too.
  - **Badge.** Navy-and-gold pill in the header of every client page: "MILESTONE" over the name,
    the numeral in a gold medallion with a progress ring toward the next milestone, and a note
    right on the badge: "Near X" (within 90%), "Reached X" or "Moving to X" (numbers point to a
    different milestone that staff haven't set yet). Staff also see "Set milestone" on clients not
    set yet. Hover shows "N% of the way to X". Hidden from category-scoped users and on staff-only
    pages. Not in the sidebar.
  - **Milestone page** (opened from the badge): staff see **Staff: budget and milestone** first
    (budget entry, Set milestone with a note, history), then the client view: summary, the two
    progress bars, the step chart with "You are here", and the full table. Clients see only the
    client view. Also in **Client details → Milestone**; staff Home has **Milestones to review**.
  - **Database:** `supabase/client-milestones.sql` (`client_milestones`,
    `client_milestone_history`, `client_milestone_stats`, `confirm_client_milestone`; only staff
    can set a milestone).
- **Enterprise** page: what premium includes and pricing. The upgrade request is real
  (`request_enterprise_upgrade`).
- **Reports and PDFs** are generated in the browser with jsPDF: P&L, balance sheet, budget vs.
  actual, contribution and giving statements, reconciliation, payroll YTD, draft budget.
- **Global search**, light/dark toggle, collapsible sidebar. In a mouse/trackpad window at half
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
  - `qbo-sync`, `qbo-callback` and `qbo-refresh-token` run with `verify_jwt` off and check the
    caller themselves.
  - `invite-client-user` runs with `verify_jwt` on.
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

- `design-system/` is a small React/TypeScript package of the app's visual building blocks
  (cards, buttons, badges, charts, icons, toasts). It's synced to the Claude Design project
  **"MyGoodBooks Design System"**
  (https://claude.ai/design/p/b5c754f7-266e-4cf2-98a4-f1445fca1cc8) with `/design-sync`.
- Its `src/styles.css` is a **manual copy** of the relevant parts of the app's `styles.css`.
  If you change the app's look, copy the changes over and re-sync. Check the brace balance
  afterwards, because a missing `}` has broken it before.
- Setup quirks, known issues and conventions are in `design-system/.design-sync/NOTES.md` and
  `design-system/README.md`.

## Known gaps and roadmap

**Tasks and staff tools**

- Daily email digest for tasks. Needs an email service first.
- Assignee picker for tasks (assign a task to another staffer).

**Client value (Phase 2)**

- Client **"Account"** sidebar item: email notification settings, monthly digest on/off and
  recipients. Move the theme toggle and Sign out into it. Build this once email features exist.
- Real client Messages with email notifications. Today they're sample threads.
- Tax Documents "Sent" status should move to a Supabase table (client, donor, year, sent_at,
  sent_by) once statements are really emailed. Statement sends and referral sends are still
  mock.
- Persistent client document uploads (today: Drive links for staff, uploads for this session
  only for clients).

**Simplify (Phase 3)**

- Plain-language labels, one name per tab, two nav groups.
- Rename "Enterprise" (to Plus/Premium) and stop leading the nav with it.
- Remove sample-data banners wherever live data exists.
- Loop the Claude Design **"Report Builder Video"** on the sign-in page: video left and card
  right on desktop, muted, no controls, still under reduced-motion, smaller on phones.

**QuickBooks sync at scale**

- The every-minute cron syncs every connected company in turn, a few seconds each. Past roughly
  15 companies a sweep takes longer than a minute. Before then, switch to QuickBooks webhooks
  (sync a company when it changes) instead of polling faster.

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
- QuickBooks gaps: no account numbers (masks), no reconciliation data, bill memos not synced.
  Giving, funds and payroll aren't sourced from QuickBooks.
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
