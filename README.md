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
  `TopBar.jsx`), a few `components/client/*` files, the Tasks module `components/tasks/*` (30
  files, `TK_logic.js` first and `TK_App.jsx` last, right after `components/client/QboGiving.jsx`),
  `components/tour/Tour.jsx` and `Tips.jsx`, then the launch announcements (`announcements.js`,
  `announcementsLogic.js`, `Announcements.jsx`), then `app.jsx`. The Tasks stylesheets
  `components/tasks/tk-views.css`, `tk-drawer.css`, `tk-client.css`, `tk-requests.css` and `tk-slate.css` are written right after
  `components/tour/tips.css`. All files start downloading at once, but they compile in this
  order.
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
| `qbo-config.js` | `window.mgbStartQboConnect`: asks `qbo-connect-start` for the Intuit URL. No client id or environment any more (keys are chosen per connection, server-side) |
| `components/auth/` | `signInNotice.js` (explains a failed sign-in), `supabaseClient.js`, `AuthGate.jsx` (staff Google gate), `ClientAuthGate.jsx` (client magic-link gate) |
| `components/dashboard/` | `WidgetDrawer.jsx` + `widget-drawer.css`: the shared **Customize** drawer and board edit mode used by every customizable board (client Dashboard, full client dashboard, Financial Overview), plus `WD_sync` for per-account layout saving. Every name is `WD_`/`wd-` prefixed. Loaded before `components/daily-close/*` and `app.jsx`. |
| `components/daily-close/` | Financial Overview (`DailyClose.tsx`, its CSS, sample data, and `fromClient.js`, which adapts client data for it) |
| `components/pro/` | Pro budget and report tools: `ProBudget.jsx` (Budget vs. Actual tabs, next year's draft with approval) and `ProReports.jsx` (board reports suite and the public share page), each with its own CSS. Loaded before `app.jsx`; `app.jsx` falls back to the old pages if either is missing. |
| `components/inbox/` | `StaffInbox.jsx` (the unified staff inbox, the staff chat drawer and launcher, and `SI_useClientMessaging` for the client Messages page) and `staff-inbox.css`. Loaded before `app.jsx`; every name is `SI_`/`si`/`StaffInbox` prefixed. Without it, `app.jsx` falls back to the old Team Chat page and sample client threads. |
| `components/staff/` | Staff-only features, each with its own CSS and a name prefix (`CS_` client switcher, `HLP_` Help, `TB_` top bar, ...). `TopBar.jsx` + `top-bar.css` is the staff top bar (see "Staff top bar" under Main features). All loaded before `app.jsx`. |
| `components/staff/` (profile photos, 2026-10-16) | Staff profile photos; spec `docs/staff-photo-spec.md`, database `supabase/staff-photo.sql`. `staffPhotoLogic.js` (`SP_`, pure rules, the zip writer, node test `staffPhotoLogic.test.js`), `staffPhotoApi.js` (`SP_api` RPC and storage wrappers, the shared `SP_useMyStatus` / `SP_useAdminList` stores, `SP_changed()`), `staffPhotoImage.js` (`SPI_` canvas crop and re-encode, HEIC detection, download), `StaffPhotoGate.jsx` + `staff-photo.css` (`PG_`: the required-photo gate and the shared picker), `StaffPhotoAdmin.jsx` + `staff-photo-admin.css` (`SPA_`: the Team › Members Photo column, per-person drawer and Download all). |
| `components/handbook/` | The Staff Handbook (2026-10-13; spec `docs/staff-handbook-spec.md`), HR › Handbook. Every name is `HB_`/`hb-` prefixed. `HB_logic.js` (pure rules: kinds, list groups, search, slugs, Today items, badge; node test `HB_logic.test.js`; loads first), `HB_api.js` (RPC wrappers, the PDF download, the shared `hb_status` store), `HB_PolicyView.jsx` (one policy, sign and countersign), `HB_HandbookTab.jsx` (the tab, its routes and the deep-link claim), `HB_Admin.jsx` (admin status grid, not-filed list with Retry filing, publish editor, New policy, draft bar, Edit details, Make this a signed policy, the draft Approval card), `hb.css`. Loaded after `TeamReviewsAdmin.jsx` and before `app.jsx`. |
| `components/hr/` | Employee records (2026-10-19), HR › Employee records, real admins only. `HR_`/`hr-` prefixed. `HR_logic.js` (pure rules: fields, completeness, validation, changed fields; node test `HR_logic.test.js`), `HR_api.js` (`hr_*` RPC wrappers), `HR_RecordsTab.jsx` (list, record, edit form, read-only handbook signatures), `hr.css`. Loaded after the handbook files and before `app.jsx`. |
| `components/files/` | `DriveFiles.js`: browser helpers for client files in Google Drive (`DRV_` prefix), calling the `drive-files` edge function. Holds the one fallback switch `DRV_STORAGE_FALLBACK`. Loaded before `StaffInbox.jsx` and `app.jsx`. |
| `components/tasks/` | The Tasks module, shown to people as **Slate** (code name Tasks; renamed in Desk D1, 2026-10-17; `SLATE_NAME` in `TK_logic.js` is the one place the name lives; routes, `TK_`/`tk-` names, `tk_` tables and `mgb_tk_` keys are unchanged) (2026-10-11; spec `docs/tasks-phase1-spec.md`). Every name is `TK_`/`tk-` prefixed. Logic with node tests: `TK_logic.js` (statuses, grouping, the quick-add parser, keys), `TK_viewLogic.js`, `TK_drawerLogic.js`, `TK_clientLogic.js` (the client strip and panel rules), `TK_reviewLogic.js` (Phase 2 S3: review roles, the review queue groups and a JS copy of the on-time rule), `TK_store.js`, `TK_recurrenceLogic.js` (Phase 2: the business calendar, due rules and periods; fixtures in `TK_recurrence.fixtures.js`), `TK_templateLogic.js` (Phase 2 S4: template form checks, next due dates, period labels, preview rows and error text), `TK_requestLogic.js` (Phase 2 S5: Ask client form checks, request chips and actions, waiting groups and error text), `TK_rowLogic.js` (T1/T2 of the Desk plan: row avatar colors, due chip tone and quick picks, who may edit which cell, and where "+ Add task" files a new task; node test `TK_rowLogic.test.js`), `TK_coverageLogic.js` (Phase 2 S7: time-off hand-off preview groups, skip copy and Covering for labels), `TK_rhythmLogic.js` (Slate month rhythm slice 1: the `month_rhythm` setting checks, default, summary and the `TK_rhythmEnabled()` gate; vectors in `TK_rhythm.fixtures.js`, node test `TK_rhythmLogic.test.js`). Data: `TK_api.js` (Supabase calls), `TK_sync.js` (Realtime plus a `BroadcastChannel` between windows). Views: `TK_App.jsx` (the `#/tasks/...` page and the `/tasks` shell), `TK_Sidebar.jsx`, `TK_MyTasks.jsx`, `TK_List.jsx`, `TK_ClientHeader.jsx`, `TK_ClientDrawer.jsx` (the client task strip and panel, and Follow my client), `TK_TaskRow.jsx`, `TK_StandaloneBar.jsx`, `TK_keys.jsx`, `TK_BulkBar.jsx` (Phase 4 P4-3: select many tasks and the bulk bar), `TK_ReviewQueue.jsx` (`#/tasks/review`), `TK_Templates.jsx` (`#/tasks/templates`, recurring templates), `TK_WaitingList.jsx` (`#/tasks/waiting`, open Ask client requests), `TK_ManageProjects.jsx` (`#/tasks/manage`, admin Manage projects). Task details: `TK_AskClientModal.jsx` (Client requests and the Ask client window), `TK_ClientContacts.jsx` (Phase 2 S6: the client drawer's Client contacts section), `TK_DrawerContent.jsx` (R0 of the Desk plan: the task pane body, its state, fetch and x/s/a/? keys, embeddable in the Desk later), `TK_Drawer.jsx` (the modal chrome around it: layer, scrim, dialog, Tab trap, Esc, scroll lock, focus return; plus `TK_openTask` and `TK_DrawerHost`), `TK_QuickAdd.jsx`, `TK_Comments.jsx`, `TK_Attachments.jsx`, `TK_Activity.jsx`. Styles: `tk-views.css`, `tk-drawer.css`, `tk-client.css`, `tk-requests.css`. Loaded after `components/client/QboGiving.jsx` and before `components/tour/Tour.jsx`. |
| `components/workbench/` | The **Desk** (on the right since Desk R1/R1c, 2026-10-19g, see "Desk R1 + R1c" under the change log: a 52px rail, a column that widens to `--desk-w` and pushes the page by `--desk-occupy`, and a 42px info bar; D3's bottom panel and its height code are gone; glass: Desk D2, 2026-10-17, now solid sidebar color; `--desk-*` tokens and `.wb-glass` in `WB.css`) (was the Workbench; renamed in Desk D1, 2026-10-17, spec `docs/desk-spec.md`; Tasks Phase 3, 2026-10-16; spec `docs/workbench-phase3-spec.md`), off until the owner sets `tk_settings.wb_enabled`. Every name is still `WB_`/`wb-` prefixed (file names, CSS classes, `mgb_wb_*` keys, `wb_*` database names and the `wb_enabled` flag did not change). `WORKBENCH_NAME` ("Desk") in `WB_logic.js` is the one place the name lives (`WB_NAME` is an alias; `WB_SLATE` mirrors `SLATE_NAME` for the hub tab and buttons). Today keeps its name; its list card is titled **Needs you**, and the hub header link is **Open Today**. `WB_logic.js` (pure: groups Overdue / Today / This week, ranking, tiles, chips, actions, snooze times, the Today-row adapter; node test `WB_logic.test.js`), `WB_store.js` (the one data path; also the hub state `hub` {tab, chip, clientId, scroll} saved per person in `localStorage` `mgb_wb_hub:<email>` (the old unscoped `mgb_wb_hub` is removed on join), throttled to 500 ms, reopened only within 5 minutes of the last save and only on the same route without an `?item=` arrival, plus `collapsed` groups for My tasks; node tests `WB_logic.test.js` and `WB_store.test.js`, cleared by Dev Tools Reset local state: `rpc("wb_inbox")`, Realtime on `client_messages` and `staff_reminders`, app events, a 2-minute poll, `BroadcastChannel("mgb-wb")`, optimistic writes with Undo, the switch), `WB_Row.jsx` (rows, menus, snooze picker, Undo bar, rail badge, shortcut sheet), `WB_Page.jsx` (Today's tiles and list), `WB_Hub.jsx` (the open panel, Workbench Hub spec H1, `docs/workbench-hub-spec.md`: tab shell (Inbox, My tasks and Client live), filter chips, and the stack protocol. `WB_useHubKeys` handles D / Esc / Tab in a window capture listener (D3: Esc only with focus inside the Desk, via `WB_deskEscStep`; Tab trapped only in the phone sheet) and does nothing while `WB_layerAbove` finds a layer above (task drawer `.tk-dw-layer`, client drawer, chat drawer, `.modal-overlay`, other `aria-modal`, `.tour-root`, `.wb-menu`); `WB_useHubLayers` sets `html.wb-hub-open` (lifts the chat drawer to z 1835) and `html.wb-stacked` (a drawer is over the hub) and returns focus to the row that launched the drawer when focus was inside the Desk (the hub has no scrim since D3). Task and review rows open in the existing task drawer via `WB_hubOpen` (`TK_openTask(id, {from:"wb-hub"})`), so the page never changes. H3: a client message's Reply asks the app for the chat drawer with the `mgb:open-chat` window event (`detail` {clientId, email, handled}; the `app.jsx` listener sets `siDrawer`, remounts `SI_ChatDrawer` per request with a `seq` key, passes `initialEmail`, and sets `detail.handled`, or declines on the Inbox page or without staff chat, in which case `WB_hubOpen` falls back to `WB_go`); a new file's Open file opens a blank tab inside the click, then points it at `DRV_link(fileId)` (https only; a non-inline type downloads instead of showing; toast on failure or when the tab is blocked, with no second `window.open`). The chat drawer picks the person with `SI_findInitialEntry` (`components/inbox/SI_logic.js`, node test `SI_logic.test.js`): the email on the named client only, and a toast if they aren't in the list. Mark checked and Open full page are in the row menu; `WB_hubAction` types are `task`, `chat`, `file`, `go`, `own`; tests in `WB_logic.test.js` and `WB_store.test.js`; composer drafts surviving a close (H3b) are not built, they wait for View as and P4-2 to land in `StaffInbox.jsx`), `WB_HubTasks.jsx` (the My tasks tab, H2: its own list key `wb:mine`, never the shared `mine`; `TK_groupMyTasks` + `TK_myGroupsView` + `TK_subNestGroups` + `TK_TaskRow`, Unassigned and Done dropped, capped at `WB_HUB_TASK_CAP` 200 rows; rows open `TK_vOpenTask(id,{from:"wb-hub"})`, tick done via `TK_vComplete`; keep those Tasks helpers backward compatible and run the hub tests), `WB_HubClient.jsx` (the Client tab, H4: a client picker (combobox; Pinned, Recent, All; only clients you can open) with the route's client preselected on a client page, pins per person in `localStorage` `mgb_wb_pins:<email>` capped at `WB_PINS_CAP` 8 (pure rules `WB_pins*`, `WB_hubPickClient`, `WB_hubClientOptions` in `WB_logic.js`), and the client tasks body shared with the client task panel (`TK_ClientTasksBody` in `TK_ClientDrawer.jsx`, so edit it once for both) under its own list key `wb:client:<id>` (`TK_stMatches` places task updates into it); **+ Task** and **Open client**), `WB_Drawer.jsx` (the info bar, the rail (`WB_DeskRail`) and the Desk column on every staff page, D toggles; R1 replaced the D3 notes that follow for layout: see the R1 change log entry; bar and hub are portaled into `.wb-desk-root`, a div at the end of `.app-shell` after `.main` (Tab order page, bar, Desk; inside the shell's stacking context, so modals, the Undo bar and everything portaled to `<body>` stay above it; docked z 680/690 sits under the sticky top bar (700) and its menus, the phone sheet keeps 1820/1830): `--wb-bar-left` measured from `.staff-rail` by `WB_barLeft`; `html.wb-drawer-on` pads `.main`, `--desk-pad` / `--desk-lift` add the open docked Desk's height to that padding, the toasts, Undo bar and chat buttons, and `TOUR_stickyBottom` keeps tips and tours clear of the bar and the docked Desk; D3 mode by `matchMedia("(max-width: 760px)")`: dock (non-modal `role="region"`, resize handle, drag, bar drag-to-open) or sheet (modal dialog, no resize); height helpers `WB_desk*` in `WB_logic.js`, snap name saved by `WB_store.setDeskSnap` in `mgb_wb_desk:<email>`), `WB.css`. The **MGB Desk window** (2026-10-20k, a preview) was deleted in Slate app S5 (2026-10-21): its code, `desk.webmanifest` and flags are gone, `/desk` redirects to `/slate`, and the useful parts live in `components/tasks/TK_SlateBridge.jsx` (see "MGB Slate app" under Installable app). |
| `components/tour/` | Tours, tips and launch announcements. `Tour.jsx` (client and staff tours), `Tips.jsx` (`TIPS_`), and the launch announcements (2026-10-15, `ANN_` prefix): `announcements.js` is the registry (one entry per launch), `announcementsLogic.js` the pure rules with its node test `announcementsLogic.test.js`, `Announcements.jsx` the store, notice, What's new list and Usage Stats card. Styles: `tour.css`, `tips.css`, `announcements.css`. Database: `supabase/staff-announcements.sql` (+ `staff-announcements-tests.sql`). |
| `components/ledger/` | Ledger review (GL Review phase 1, 2026-10-14; spec `docs/gl-review-spec.md`). `GLR_*.js` are pure logic with node tests in `tests/ledger/` (parse, checks, compare, summary); `LR_*` is the UI: `LR_Tab.jsx` (client tab `client-ledger`, `#/client/<id>/ledger`), `LR_Panels.jsx`, `LR_ReviewFile.jsx` (Work › Ledger review), `LR_Settings.jsx` (Team › Ledger review), `LR_api.js` (RPC and edge-function wrappers; fires `mgb:ledger-review-changed` and `mgb:gl-review-changed` so the Close card refreshes). Database: `supabase/gl-review-1-core.sql`, `supabase/gl-review-5-dup-mode.sql` (Possible duplicates mode), `supabase/gl-review-6-swing.sql` (Month swing is never auto-fixed). |
| `components/qbo/` | `mapQboToClient.js` converts QuickBooks table rows into the shape the pages use. Its test is `mapQboToClient.test.js`. |
| `supabase/*.sql` | Every database change: tables, row-level security (RLS) policies, functions, cron jobs. The folder is flat, one file per change. |
| `supabase/functions/` | Edge functions: `qbo-connect-start` (starts the Intuit connect; picks sandbox vs production keys per connection), `qbo-callback`, `qbo-refresh-token`, `qbo-sync`, `invite-client-user`, `staff-auth` (makes staff Google sign-in accounts, active admins only), `qbo-gl-review` (pulls the General Ledger, staff only), `gl-review-send` (emails a ledger question or summary), plus shared helpers in `_shared/` |
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
    Both use the `invite-client-user` edge function, which only staff can call. The activity log records the inviting staff member (`supabase/client-users-invite-actor.sql`).
  - Only an active admin (or service role with no JWT) can change a contact's `name`, `email`
    or `client_id` (`client_users_guard_identity`, `supabase/client-tools-author-stamp.sql`).
    The roster's add, invite, deactivate and scope edits don't touch those columns. Changes are
    written to the client's activity log (`access_updated`, `old_name` / `new_name` /
    `old_email` / `old_client_id`).
- **Staff** go to **`/staff`** (`vercel.json` rewrite; `staffLoginMode` in `app.jsx`) and click
  **Sign in with Google**. The small "Staff? Sign in with Google" link on the client page goes
  there. The Google return trip targets `/staff`; add `https://app.mygoodbooks.org/staff` to
  Supabase Auth → Redirect URLs. Until it's allow-listed Supabase falls back to the Site URL
  (`/`), which `RootGate` still sends to the staff gate. A client session opening `/staff` goes
  to the client gate and is not signed out.
  - Google only accepts `@mygoodbooks.org` accounts.
  - The app then requires an active row in the `staff` table.
  - **Supabase Auth → "Allow new users to sign up" stays OFF** (deliberate). So a Google sign-in
    only works for an address that already has an `auth.users` row; without one Google comes back
    with `signup_disabled`. HR › Members (`StaffAccessPage`) calls the `staff-auth` edge function
    (`supabase/functions/staff-auth/`, `verify_jwt` on) after **+ Add**, after each **Bulk import**
    (one call, up to 50 addresses each) and after reactivating someone. It runs
    `auth.admin.createUser` (email confirmed, random 48-byte password never logged or returned,
    `user_metadata.created_by = 'staff-auth'`) and Supabase then links the Google identity by email.
    - Caller: `auth.getUser(jwt)` plus `is_active_staff_admin()` called with the caller's JWT (the
      same rule as the `staff` write policy; temp admins fail it), plus a service-role check that
      their staff row is `admin` and active. Its `jwt_has_google()` part means Google has *ever*
      been linked to the account (`app_metadata.providers` contains `google`), not that this
      session used Google, so an admin in an installed-app email-code session still passes.
    - Targets: after NFKC + trim + lowercase, ASCII `^[a-z0-9._%+-]+@mygoodbooks\.org$`, an ACTIVE
      `staff` row (two rows normalizing to one address are skipped as `ambiguous`), and not a
      `client_users` login. Results per address: `created` / `exists` / `skipped` / `error`
      (+ `reason`). `exists` only on `email_exists` / `user_already_exists` or an "already
      registered" message; any other createUser failure is `error` and writes no audit row.
    - Rate limit: about 60 new accounts per admin per hour, 200 overall; not strictly atomic under
      parallel requests, bounded by number of staff rows missing an account. Counted from
      `staff_audit_log` `auth_user_created` rows only; out of budget returns 429. Both
      `auth_user_created` and `auth_repair` show in Developer tools › Recent activity.
    - A brand-new staff member's account has only the email identity until their first Google
      sign-in, so they can't use the installed-app email code (which needs `jwt_has_google()`)
      until they've signed in with Google once.
    - `supabase/staff-auth-repair.sql` adds `staff_missing_auth()` (admins only; active staff with
      no `auth.users` row, case-insensitive). The page shows a **Can't sign in yet** card and a
      **Can't sign in** row tag from it, and **Fix sign-in** calls `staff-auth` with
      `{action: 'repair'}`. Tests: `supabase/staff-auth-repair-tests.sql` (rolled back) and
      `node --test tests/edge/staff_auth.test.mjs` (`logic.ts`).
    - No trigger on `staff` makes the account: `auth.users` can't safely be written from SQL, and
      pg_net from a trigger needs a stored secret and fails silently. Rows added outside the app
      are caught by the missing-account card instead.
  - Someone with a Google account who isn't on the staff list is signed out again.
  - A staff Google sign-in that comes back without a session, with an OAuth `error`, or with a
    non-`@mygoodbooks.org` email shows a plain-language notice on the sign-in page
    (`components/auth/signInNotice.js`, loaded before `supabaseClient.js`). It keeps a one-shot
    `sessionStorage` flag and notice, strips `error*` params from the address bar, and never
    stores or logs codes or tokens. It also shows a `Reason:` line (cleaned `error` / `error_code` / `error_description`; long token-like text is redacted) and keeps a small `mgb_signin_diag_v1` record (start time, browser, outcome) in `sessionStorage`. Client sessions are never signed out by it.

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
- **Per org.** **Client setup** (staff) → **Manage access** has People / Organization tabs / Requests.
  - The People and Organization tabs still work on **sample** users and per-browser settings
    (see [Known gaps](#known-gaps-and-roadmap)).
  - The Requests tab is real (`access_requests`).
- **Preview.** Staff can "Preview as" a client user to see what that person sees.
- **Plans: Basic and Pro.** Set per client in `clients.plan`, whose stored values are
  `basic` / `standard` / `premium`. They're shown as Basic / Pro. `standard` is the retired Plus
  plan: it was never sold and is shown as Basic (its old $25 + $9 price is never shown). Names,
  prices and sync schedules live only in `PLAN_LABELS` / `PLAN_PRICING` / `PLAN_SYNC` /
  `PAYROLL_PRICING` in app.jsx. The plan prices (not payroll) are published in
  `marketing/pricing-embed.html`.
  - **Basic**, free with 1 login included; extra logins are $20/mo each. It gets Home (the
    Needs-you list, the org card and Home at a glance: BasicHome.jsx), Messages, Reports (the Downloads tab with
    the four statement PDFs; the Board packet is locked), Documents, plus the milestone pill. It
    has no Budget, Bank accounts, Cash flow or Giving & funds tab and no per-person access
    (`BASIC_TAB_KEYS`). QuickBooks syncs monthly, on the 15th (US Central), with no Sync now for
    the client. Staff still see **Bank** and can Sync now on a Basic client (staff override in
    `effectivePage`; `resolveAccess` is unchanged, so the client portal and Preview as a Basic
    user still have no Bank).
  - **Pro**, $100/mo + $20 per login. It adds the Budget, Bank accounts, Cash flow and Giving &
    funds tabs and the Pro tools inline (see below), plus per-person access. QuickBooks syncs
    every hour (2 hours when the monthly API budget is running hot; see the usage guard below),
    and the header pill has Sync now.
  - **Payroll add-on:** available on any plan (Basic included). Its price is never shown to clients
    or published (owner 2026-10-08); clients are told to message their account manager.
    `PAYROLL_PRICING` is internal only, for the staff overview's bill estimate. Clients without it
    (`clients.payroll_add_on` false) see **Payroll** under Finances with an "Add-on" tag. It opens
    `PayrollAddOnPage`, which has what's included, an **Add Payroll** button and a **Message your
    account manager** button. The button files an upgrade request with `requested_plan = 'payroll'`
    . Staff see
    a hint to turn it on under Client organizations. Clients with the add-on but no Gusto data see
    the Connect Gusto screen.
  - **Downgrades:** logins beyond what the new plan includes stay at $20/mo each, or they're
    removed.
  - Plan fees sit on top of the milestone (bookkeeping) fee.
  - **Sync schedule:** enforced server-side in `qbo-sync` (`isDueForPlan`). The cron ticks every
    5 minutes and syncs only the clients that are due. The server refuses client-initiated Sync now
    on Basic and Plus; staff can sync any plan, with no 60-second throttle (see **Sync now** below).
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

**Real clients vs. test clients vs. MGB (internal):** two flags keep non-clients out of real numbers.
`clients.test_only` marks the practice orgs (`basic-test`, `grace-community`); `clients.is_internal`
marks MyGoodBooks' own books (`mygoodbooks`). Anything that measures real clients counts only rows
that are neither (the server rule is `is_roster_client()` in `supabase/internal-company-profile.sql`;
the browser rule is `window.mgbRealClients(list)`, plus `CF_excludedIds()` for rows keyed by
`client_id`). The Clients page, client picker, Today, Team, Work, deadlines, close counts, task badges,
hours, fees and revenue all use it. See "MGB (internal) and flagged clients" under Main features.

**QuickBooks connection:**

- **Connect.** Staff connect a client's QuickBooks from Client setup → Access and details → QuickBooks. This runs
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
    minutes. Each tick syncs only the clients that are due (Pro every hour, Plus weekly, Basic
    on the 15th). An open page re-fetches the client's numbers once they're more than about 90
    seconds old.
  - **CDC gate.** Between full reads (at most 24 hours apart), a due client first asks
    QuickBooks' change-data-capture endpoint what changed since the last sync; if nothing did, the
    full re-read is skipped. CDC is only used as a gate: the full read still replaces the tables.
  - **Close data.** Once a day per client (and on every staff Sync now, `closeDue: isStaff || ...`) the sync also pulls 13 months of
    bank, card, Undeposited Funds and uncategorized account data into `qbo_account_status` and
    `qbo_period_balances`, then re-runs the close checks (see Work › Close below).
  - **Usage guard.** Every Intuit call is counted in `qbo_api_usage` (`qbo-sync` and
    `qbo-firm-sync`). If the month is on pace to pass 80% of the 500,000-call limit, Pro slows to
    every 2 hours; at 95% used, scheduled syncs stop until the 1st (Sync now still works).
  - **Sync now**: clicking the gold sync pill (the refresh icon at its right end) syncs, for
    staff and clients; also in Client setup → QuickBooks, on the Overview's status line, the Close
    tab's QuickBooks check and Bank's sync line (each passes `canSyncNow={planSyncInfo(plan).syncNow
    || (isStaffSession && !isPreviewingUser)}`). Staff see the pill in the top bar;
    clients (and phones) see it in the header. The function re-checks that the
    caller may sync that client.
  - **60-second throttle** per connection, for client Sync now only (Pro clients; the cron isn't
    throttled). Staff skip it (2026-10-10, `qbo-sync`: `!isStaff &&` in front of the check), so
    staff Sync now has no limit on any plan. Needs the `qbo-sync` deploy.
  - **Lock.** `qbo_connections.sync_started_at` stops two syncs overlapping; a stale lock
    expires after 5 minutes.
  - **Balance Sheet as of a month end** (`action: "balance_sheet_asof"`, staff only, same
    `can_access_client()` check as Sync now). Body `{ action, client_id, end_date: "YYYY-MM-DD" }`;
    `end_date` must be the last day of a month that has ended (checked against the latest date on
    Earth, UTC+14) and not before 2000. One read-only BalanceSheet report call per press (no
    `accounting_method`, like every other report here, so the company's own basis), counted in
    `qbo_api_usage`, nothing stored and no lock or throttle. Returns `{ status: "ok", as_of, basis,
    currency, empty, sections: [{ key, title, total, lines: [{ name, amount, depth, type }] }],
    totals: { assets, liabilities, equity, liabilities_and_equity } }` or `{ status: "error", error }`
    (a 401 says "reconnect"; a connection with no `api_env` yet says "Press Sync now once first" and makes no Intuit call; a report missing its Assets row or both Liabilities and Equity, or one that doesn't balance, is an error rather than a PDF; `empty: true` is only QuickBooks' real no-data case); 400 for a bad date or no connection, 403 for non-staff. Logs counts
    only. Needs the `qbo-sync` deploy.
  - **Atomic writes.** Each table's rows are swapped in one transaction by `qbo_replace_rows()`,
    so no one sees a half-finished sync.
- **Browser access.** Browsers can only **read** the `qbo_*` tables. Only the sync function
  (service role) writes to them.
- **Header (top right of every client page).** Two rows, right-aligned (left-aligned on phones):
  the **sync pill** (plan-aware copy from `PLAN_SYNC` / `syncPillLabel`: "Every hour · synced
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
  when `client_messages` can't be read, and for staff previewing a sample person. Today's
  "Replies waiting" tile and the Client overview's "threads waiting" still count the sample
  threads.
- Client **Documents** uploads stay in the browser for that session only.
- Giving statement "Send" (Tax Documents) only simulates delivery; nothing is emailed.
- The referral popup (`ReferralPopup`) exists in code but isn't shown anywhere.

## Main features

### Staff side

- **Staff navigation (owner-approved 2026-10-08; prototype
  https://claude.ai/artifact/KnuvhLhEBEPYyPJTRbh3zY):** five places in a left rail, Settings at the
  bottom, and every page is "title, one row of tabs, content".
  - **Rail and tabs:** `components/staff/StaffNav.jsx` (`NAV_`) + `staff-nav.css`. `NAV_PLACES` is
    the single source for places, tabs, routes, admin-only flags, tour ids and the help slug each
    page opens from the **?** menu. The rail is collapsible (default collapsed to icons since 2026-10-17f; the choice is saved per person) and becomes the
    drawer on touch phones; `NAV_TabRow` is the shared tab row; `NAV_useHashSub` lets a hub own its
    tab in the URL (`replaceState`). App pushes real history entries (`pushState` with `{ mgbNav }`)
    so Back returns from a client to Clients, and sets `document.title` per place.
  - **HR place (2026-10-19):** HR is a sixth place, right after Team. Handbook, Reviews, Onboarding,
    Employee records and Members moved from Team to `#/hr/<tab>`; the same `TP_TeamHub` renders both
    (`place` prop). Old `#/team/<moved tab>[/...]` addresses (review emails, announcements, bookmarks)
    are rewritten with `replaceState` by `components/staff/staffNavRoutes.js`
    (`NAV_legacyTeamRedirect`, tested in `staffNav.test.js`), which loads before `DeepLink.jsx`. The
    `team-reviews` edge function still builds `#/team/reviews/...` links on purpose; the redirect covers them.
  - **Places:** **Today** (`Today.jsx`, below), **Inbox** (unchanged), **Work** (`WorkPage.jsx`:
    Tasks = `TK_MyTasks` embedded (falls back to the legacy `MyTasksPage` when the Tasks tables
    are missing), Notes & SOPs = `MyTasksPage mode="notes"`, Close = `CT_CloseTrackerPage`,
    Deadlines = `DL_DeadlinesPage`, at `#/work/<tab>`), **Clients** (`ClientsPage.jsx`, `CL_`: Mine / All / Needs attention, Find a
    client, columns Client · Health · Assigned to · Backup · Hours this month · Close · Last viewed;
    inside a client the breadcrumb "Clients › name › tab" and `CL_ClientTabs`: one fixed row on
    every plan (`STAFF_CLIENT_TABS`: Overview, Messages, Documents, Bank, Close, Reports, SOP, then
    Milestone for real admins only), the **Client view** menu (`CL_ClientViewMenu`: the client's own
    pages, then **View as client…**) and the **Client setup** gear at the far right; the client
    sidebar is not rendered for staff). See **Client tab row** below.), **Team** (`TeamPage.jsx`: People (Who's out, My clients'
    backups, My time off, Shout-outs), Reviews, Onboarding; admins also Hours, Reply times,
    Feedback, Members, at `#/team/<tab>`).
  - **Hours for bookkeepers:** `supabase/client-hours-for-bookkeepers.sql` adds
    `qbo_my_client_hours(from, to)` (minutes per client for the caller's own clients; no rates or
    per-person split), so the Clients page's Hours this month column works for everyone.
  - **Top bar:** no page links; ⌘K lists Pages and Actions with nothing typed; the **?** menu is
    Help for this page, Staff guide, Send feedback, What's new, Tips while you learn (On/Off), then
    one entry per tour (Bookkeeper tour, plus Admin, Temporary admin and Account manager tours when
    they apply, then "New: <title> tour" for each launch announcement). Help and Feedback
    are no longer sidebar items.
  - **Tours (`components/tour/Tour.jsx`):** the client tour (`TOUR_Root`) and the staff-side tours
    (`TOUR_StaffRoot`). Staff tours are listed in `TOUR_STAFF_TOURS` in menu order: **Bookkeeper**
    (`TOUR_bookkeeperSteps`, setting `bookkeeperTour`; replaces the old generic staff tour, and
    `TOUR_startStaff()` or `"staff"` still start it), **Admin** (`TOUR_adminSteps`, `adminTour`),
    **Temporary admin** (`TOUR_tempAdminSteps`, `tempAdminTour`), **Account manager**
    (`TOUR_amSteps`, `amTour`) and **Tasks** (`TOUR_tasksSteps`, `tasksTour`, 2026-10-11: My Tasks,
    status, lists, own window, each client's tasks and keys on `#/tasks/my`; listed once `TK_store` reports schema
    `ok`, never auto-starts because it isn't in `TOUR_STAFF_AUTO_ORDER`). Each saves `{ status, at }` in user settings (the temporary admin tour
    also saves `until`, the grant's expiry, so a later grant starts it again).
  - **Staff tour ctx and order:** `TOUR_StaffRoot` builds `isAdmin` (real admin), `isBookkeeper`,
    `tempAdmin` (a bookkeeper with an unexpired `staff_temp_admin_access` row; App passes
    `hasTempAdminAccess` and `tempAdminAccessExpiresAt`), `showsAdminPages` (admin or temp admin),
    `amCount`, `impersonating` and `myClient`. One tour auto-starts per page load, in the order
    temporary admin → bookkeeper → admin → am, each only when pending. The Bookkeeper tour never
    starts by itself for admins; during View as it visits only what View as can open (Today, Clients
    and a client's pages) and skips the rest. A bookkeeper's auto-start waits for App's
    `tempAdminLoaded` (the grant check), and an auto start waits while Today's profile prompt is open.
    New admins get the basic steps first (`newToStaff`). The ? menu, ⌘K and Settings › Help all list
    `TOUR_staffTourList()`.
  - **Tour steps:** a step can `go` (open a page first, `TOUR_go(place, tab)`), `press` (click the
    target), `wait` and `when(ctx)`; a target starting with `#` is an element id (`#tp-tab-<key>`,
    `#st-tab-firm`), anything else is a `data-tour` key. `TOUR_hasTab` takes `showsAdminPages`, so a
    temporary admin's tour only visits tabs they can open.
  - **Client tour versions:** `TOUR_clientSteps(ctx)` builds one tour from the plan (`basic`,
    `standard` worded as Basic, `premium`), `pro` (Pro pages on for this person), payroll tab, access
    kind (full, limited, budget-only category) and the tabs they have. Steps filter on `when(ctx)`
    and targets, and the tour returns to Home when it ends or is skipped. Its last step (`done`)
    targets the top bar's **?** (`data-tour="client-help"`, `go: () => false` so it stays on the
    open page) and falls back to a centred step with the Settings › Help wording. The setup checklist's
    "Invite a teammate" shows only when the person can open Settings › Organization. Staff preview a
    version with Preview as + Settings › Help › Preview the tour, or the top bar's ? menu (nothing is saved).
  - **Pro tour (upsell for Basic clients):** `TOUR_proSteps(ctx)` is a two-minute walkthrough that
    lives on Settings › Plan (`EnterpriseUpgradePage`), offered only when the shown plan is below Pro
    (`planShownKey(effectivePlan(...))`, so the retired Plus reads as Basic). It never auto-starts.
    Start it with `TOUR_start("pro")` / `TOUR_startPro()` (plain `TOUR_start()` is still the client
    tour) from the **Take the Pro tour** button in the Plans hero card, the slim Pro row on Basic Home,
    Settings › Help (**Pro tour**, **Preview the Pro tour** in preview), the client top bar's **?**
    menu (`CLIENT_HelpButton`), or the client tour's Plan step. Every step first goes to Settings › Plan, then walks the plan cards, one step per
    `ENTERPRISE_FEATURES` card, the tool-by-tool comparison, the Payroll add-on (only without it)
    and the **Upgrade to Pro** button, which it points at but never clicks. A real client's finish
    or skip is saved as `proTour` `{ status, at }` (informational) and tracked as
    `MGB_track("tour-done" | "tour-skipped", "pro")`; staff and preview save nothing.
  - **Tour docs:** `bookkeeper-guide`, `admin-guide`, `account-manager-guide`, `temporary-access`,
    `client-tour` and `pro-tour` in `docs/staff-guide`.
  - **Launch announcements (`components/tour/announcements.js`, `announcementsLogic.js`,
    `Announcements.jsx` + `announcements.css`, `ANN_` prefix; owner request 2026-10-15):** when
    something new ships, each staffer gets one quiet notice the next time they visit, with **Take the
    1-minute tour**, **Later** and **Skip**, so a launch doesn't get lost. Staff side only today (the
    registry allows a `client` role for later, but no client notice exists). It reuses the staff tour
    engine: the tour key is `ann:<id>`, which `TOUR_staffTour` resolves to `ANN_tour(id)`, a synthetic
    tour built from the entry's `steps(ctx)`. It has no user-settings key and never auto-starts;
    `end()` records it as toured (finished or skipped) and `MGB_track("tour-done" | "tour-skipped",
    "ann:<id>")`.
    - **Rules** (`announcementsLogic.js`, node-tested): audience by role (`admin` = real admins,
      `tempAdmin`, `bookkeeper` includes temp admins, `accountManager`); at most ONE notice per page
      load, newest launch first (ties: registry order); statuses `seen` (shown, ignored: comes back),
      `later` (comes back next visit, the third Later counts as Skip), `toured`, `dismissed` (Skip);
      only launches dated on or after the person's account start (`staff.created_at`); nothing shows
      more than 60 days after its date; never while a tour is open or starting (`TOUR_staffBusy`),
      Today's first sign-in profile prompt is open, or during View as and Preview as. Tips wait while
      the notice is on screen (`ANN_visible()` in `TIPS_busy`).
    - **State:** `public.staff_announcements` (`supabase/staff-announcements.sql`, **not applied until
      you run it**): one row per (lower-cased staff email, announcement id) with `status`,
      `later_count`, `first_seen_at`, `updated_at`; own-row select/insert/update only; admins read
      everyone through `staff_announcement_report()` (SECURITY DEFINER, admins only). Check it with
      `supabase/staff-announcements-tests.sql` on a branch. `ANN_store` loads the person's rows once per
      session; `localStorage` (`mygoodbooks_announcements_v1`) is only a cache, and an answer the
      database hasn't taken yet is retried. If the table is missing or the load fails, no notice shows.
    - **Where else a launch appears:** a **Launches** list (Open + Take the tour) at the top of the
      What's new article, and "New: <title> tour" entries in the ? menu, ⌘K and Settings › Help
      (`TOUR_staffTourList` appends `ANN_tourList`). Admins see counts and names of who has seen,
      toured, skipped or not yet seen each launch in Usage Stats › Announcements.
    - **Optional `ready(ctx)`** on an entry (S8b): the notice waits until it returns true (a throw
      counts as false), for launches a person should only hear about once they've met the feature.
      `unassigned-tasks` reads `localStorage` `mgb_tk_seen_unassigned_v1`, which `TK_TaskRow` sets
      when an open unassigned row renders. What's new and the ? menu list the tour either way.
    - **Optional `visible(ctx)`** on an entry (Slate app launch, 2026-10-21): the entry is hidden everywhere, not only the notice (`ANN_audience` drops it), until it returns true. Use it for a launch behind a firm switch. A throw counts as hidden.
    - **Optional `supersedes: [ids]`** on an entry: a combined launch. Once the person has been shown it (any answer row), the entries it lists are no longer owed, so they do not trickle out one visit at a time (`ANN_superseded`). `new-look-and-layout` (2026-10-21) covers the earlier Desk-only notices and waits (`ready`) until the Lato, Brand colors and Hover menus firm switches are all cached on.
    - **Test:** `node components/tour/announcementsLogic.test.js` (rules and registry integrity).
  - **Tips while you learn (`components/tour/Tips.jsx` + `tips.css`, `TIPS_` prefix; owner request
    2026-10-09):** quiet one-at-a-time tips for a staffer's first 30 days (no overlay, no dimming,
    focus never moves, nothing scrolls). `TIPS_Root` is mounted beside `TOUR_StaffRoot` in `app.jsx`
    (not in the client portal, Preview as or View as). State is the user-settings key `tips`
    `{ on, startedAt, seen: {tipId: iso}, lastAt, day: {d, n, ids} }` (no SQL): the first run for a
    staffer with no `tips` writes `{ on: true, startedAt: now }`, so new staff start at first sign-in
    and current staff at launch; turning on (`TIPS_setOn`) writes a fresh `startedAt` and `seen: {}`.
    `TIPS_CATALOG` lists each tip (`id`, `roles` all / bookkeeper / admin / adminPages / am, `match`,
    `target` as a `data-tour` key, `#id` or a list of fallbacks, optional `part` (a selector inside
    a tall target to point at instead), optional `snug: true` (the ring hugs the target's children
    and text, for a heading or row wider than its contents), `text` as a string or
    `(env) => string`, `slug`, optional `adminDoc: true` when the article is audience admin,
    optional `ready()`); the first catalog tip whose target is fully in view wins, so order is
    priority. Rules (settle 1.5 s, 3 s after sign-in, one tip per page visit, 2 minutes from the
    last tip going away or a tour ending, 4 a day, never during a tour via `TOUR_staffBusy()`, a
    modal or menu, or a focused field) are `TIPS_CONFIG`, which a test harness can shorten. The
    card (280 px, thin ring) is click-through except its controls. Placement (`TIPS_position`):
    each spot that fits (below, above, right, left, edges lined up with the ring) is scored by the
    controls it would cover plus the top bar, breadcrumb, page title and tab row (`TIPS_HEAD`);
    the lowest wins and is kept while the tip shows. Top-bar targets (`TIPS_HEADER`) hang below,
    under the header band (beside it only when that covers less, above only when nothing below
    fits). Phones (< 640 px) dock it at the bottom, or at the top under the title and tabs but
    never over a field of the target's own form; when neither fits, the tip waits for a later
    visit. Its own writes use `ST_store.update(patch, { quiet: true })`, which saves without the
    Settings "Saving…" note;
    `ST_store` also adopts saves from other tabs (the `storage` event) and re-reads the server
    copy when a tab comes back into view, so a long-open tab doesn't save a stale copy. Switch rows (`TIPS_Switch`, `TIPS_menuItem`):
    the Staff guide's home, Settings › Help and the ? menu. Tracked as `MGB_track("tip-more", id)`,
    `"tips-on"` / `"tips-off"` (labels in `USAGE_ACTION_LABELS`). Adding a tip: add the `data-tour`
    attribute in the owning component and a catalog entry whose `slug` is an existing article, then
    list it in the "All tips" table in `docs/staff-guide/tips.md`.
  - **Routes:** `#/today`, `#/inbox`, `#/work/<tasks|close|deadlines>`, `#/clients`,
    `#/team/<tab>`, `#/hr/reviews/<sub>[/id]`, `#/help[/slug]`, `#/settings`, `#/templates`,
    `#/client/<id>/<tab>[/<sub>]` (tabs: `overview messages documents bank close reports sop milestone
    settings`, plus the Client view pages; `setup` is an alias of `settings`). The old routes (`#/home`, `#/tasks`, `#/close-tracker`,
    `#/deadlines`, `#/reviews`, `#/feedback`, `#/team/coverage`, `#/team/health`) are gone with no
    redirects (owner: prototype, nobody is using it yet). Email links in the edge functions were
    updated the same day.

- **Staff client tools** (`supabase/staff-client-tools.sql`, applied 2026-09-27):
  - **Client overview** (page `client-overview`, staff only; reworked 2026-10-10, bookkeeping work
    only). A fresh open of a client lands here; coming back lands on the tab you left (see
    **Client tab row**). Top to bottom:
    - the staff note, then the **Open for this client** strip (`OV_OpenStrip`): chips for what
      needs the bookkeeper (QuickBooks needs reconnecting, replies, open questions, overdue
      requests, uploads, the month's close, my tasks, the next deadline), from
      `useClientTabCounts`; each chip opens the exact item
    - the status line (`OV_StatusLine`): health score and "Why {score}?" (toggles in place),
      QuickBooks sync with Sync now, uncategorized, possible duplicate bills, and the plan with its
      sync cadence (`STAFF_planCadence`)
    - left column: the Close summary row (`CLC_CloseSummaryRow`, opens the Close tab), **Tasks for
      this client** (`OV_ClientTasks`, Mine / Everyone), and the activity timeline with "Log a
      call" (saved as a `client_private_notes` call note)
    - right column: **Key dates and coverage** (`client_profile`; the Organization type select is
      here for every staff member, the target hourly rate, hours budget and account manager picker
      for admins) and pinned notes with All notes (edit and pin in place, no remove)
    - **Billing and time**, real admins only, not in the DOM for anyone else: Monthly bill,
      Profitability, Engagement (reads "Usage stats") and the Onboarding card. Open by default,
      state in `mgb_ov_billing_open_v1`.
    Every card header opens the page that owns it (`OV_Card`; the card body is not a link). The
    checklist, "Sent to the client" and the QuickBooks check moved to the Close tab, document
    requests and reminders to Documents, open questions to Bank. The sample "waiting on a reply"
    list is gone. This is layout, not security: RLS still lets staff read these rows.
  - **Quick actions** (`StaffQuickActions` in `app.jsx`): the visible "Staff" bar on client pages
    was retired 2026-09-30. App mounts it `headless` on client pages, so it renders no buttons, only
    the Add task / Request document / Add note modals, opened from the top bar's "+" via the
    `tb:quick-add` event (kind `task` / `request` / `note`; kind `message` opens the chat drawer, or
    the Messages tab when the drawer isn't available). The Inbox context pane still renders it with
    `only={["request", "task"]}` as visible buttons. The staff client tab row is `CL_ClientTabs`; the
    client sidebar (clients only) lists exactly what the client sees. The `client-overview` route is
    unchanged. The request toast reads "It's on their Documents."
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
  - Authors are set by the database, not the browser (`supabase/client-tools-author-stamp.sql`,
    trigger `client_tools_stamp_author`) on `client_internal_notes`, `client_budget_comments`,
    `client_variance_notes` and `client_budget_draft_history`: the email is the signed-in email
    and the name is `staff.name` (any staff email) or that client's `client_users.name`. Service
    role with no JWT keeps what it sends. Author fields can't change on update, except a variance
    note's author follows whoever last changed its text. Staff can't update internal notes and
    nobody can update budget comments from the browser (insert and delete only).
  - **Soft delete** (`supabase/budget-approval-and-soft-delete.sql`): `client_internal_notes`,
    `client_budget_comments` and `client_variance_notes` have `deleted_at` / `deleted_by_email`.
    The browser can't hard delete them; it calls `delete_client_internal_note(p_id)`,
    `delete_client_budget_comment(p_id)` or `delete_client_variance_note(p_client_id, p_period,
    p_category)`, which allow the author or an active admin and stamp the deleter from the JWT.
    Every app query filters `deleted_at is null`; RLS also hides deleted rows from non-admins
    (admins can still read them through the API). Trigger `client_tools_guard_soft_delete` stops
    signed-in users setting the delete columns. Variance notes are saved through
    `save_client_variance_note(p_client_id, p_period, p_category, p_note)`: only the author or an
    admin can change a live note's text, the key (client, period, category) can't change, and new
    text on a deleted note revives it after copying the deleted version to
    `client_variance_note_tombstones` (admin read only). Same text on a deleted note is refused.
  - **Budget approval: admins and the client's full-access contacts** (same file, trigger
    `client_budget_drafts_guard`): moving a draft into `approved`, or changing a row that is
    already approved, needs `can_approve_client_budget(client_id)`: an active staff admin, or an
    active `client_users` row for that client with `access = 'full'`. Non-admin staff and limited
    contacts can't. A signed-in user can't change a draft's `client_id` or `fiscal_year`. `submitted_by` / `submitted_by_name` / `submitted_at` and
    `decided_by` / `decided_by_name` / `decided_at` are stamped from the JWT on the status change
    and frozen otherwise; `updated_by` is the JWT email. Submitting and requesting changes are
    unchanged. Only the same people can insert an `approved` history row, and the browser can't delete
    drafts. Service role with no JWT keeps what it sends.
  - **Close checklist names** (same file, trigger `client_close_items_stamp_done`): ticking stamps
    `done_by`, `done_by_name` (staff name) and `done_at` from the JWT; a step that stays ticked
    keeps its first stamp (moving it to another client, period or step re-stamps it); unticking
    clears them. The browser can't delete close items.
  - **Mark sent to client** on report cards (`client_sent_items`), with history.
  - **Preview plan** (top bar account menu on client pages, not during View as; the old sidebar select is gone): shows the client's pages as Basic / Plus / Pro
    in this browser only (`mygoodbooks_preview_plan_v1`). It's ignored in client sessions.
  - **Today → Closes open** and **Work › Close**: close progress for every client.
  - The same SQL lets staff read time entries and client page views for clients they can
    access.

- **Staff rail** (`components/staff/StaffNav.jsx`, desktop and mouse windows): the places
  (Today, Inbox, Work, Clients, Team, HR) with Collapse/Expand at the bottom (Settings, the name block and Sign out left the rail on 2026-10-19f; they are in the top bar's account menu). It opens as the 72px icon rail (with a caption and a hover/focus tooltip on each icon) until a person expands it to 220px; the choice is saved per person in `localStorage` `mgb_rail_expanded:<email>` (`"1"` expanded; no value = icon rail; the old shared `mygoodbooks_sidebar_collapsed_v1` is ignored for staff and still drives the client portal; cleared by Reset local state via the `mgb_` prefix). The places take the free height and Expand/Collapse sits at the bottom.
  It stays beside a client's pages too (staff get the breadcrumb and tab row instead of the client
  sidebar). Hidden while you preview as one of the client's people or use View as client, so the
  preview shows only what they see. On touch phones the drawer has the same places.

- **Client tab row** (bookkeeper in-client tabs redesign, 2026-10-10; `CL_ClientTabs` in
  `ClientsPage.jsx`, `STAFF_CLIENT_TABS` in `app.jsx`). Staff see one fixed row on every plan:
  Overview, Messages, Documents, Bank, Close, Reports, SOP, then Milestone for real admins
  (`STAFF_isRealAdmin`, so temporary admins don't get it), then the **Client view** menu and the
  **Client setup** gear (`data-tour="client-setup"`). From 761 to 1279 px wide the menu and gear
  portal up into the page header (`#cl-header-tools`, `CL_useHeaderToolsSlot`) so an admin's eight
  tabs fit at 1024 px; phones keep them in the row. Positions never move with the plan. Staff
  ignore `orgHiddenKeys` for the five always-tabs (`STAFF_ALWAYS_TABS`). The gate is layout, not
  security.
  - **Client view** (`CL_ClientViewMenu`): Home, Budget, Cash flow, Giving & funds, Payroll (add-on
    only), filtered by the client's tabs, then **View as client…** (the old header button is gone).
    Tracked as `MGB_track("client-view-open")`.
  - **Client setup** is page `client-settings` (clients keep **Settings**). Hash
    `#/client/<id>/settings[/client|plan|milestone]`, alias `setup`. `#/client/<id>/milestone`
    sends non-admins there (and a real admin who opens Client setup › Milestone to the row tab).
  - **Landing rule.** A fresh open lands on Overview. Coming back to a client in the same browser
    tab opens the tab you left: sessionStorage `mgb_staff_client_tab_<clientId>`
    (`STAFF_readLastTab` / `STAFF_writeLastTab` / `STAFF_resumeTab`, every access in try/catch).
    Only row tabs are stored; Client view pages and Client setup never are, and a stored key that
    is no longer a visible row tab lands on Overview. A link that names a tab always wins. The
    Inbox's Open client and the Clients page use the same rule (`openClientFromInbox`).
  - **Badges** (`components/staff/ClientTabCounts.jsx`, `CTC_`): `useClientTabCounts` is called
    once in App and passed down as `counts`. It feeds the row's badges (Messages replies waiting,
    Documents uploads and overdue requests, Bank open questions, Close dot, SOP review due,
    Client view budget waiting) and the Overview's Open strip. Stale-while-revalidate (60 s fresh,
    2 min poll), each part in its own `safe()`; when it errors the row shows no badges. The Close
    dot reads `close_checks.checks[]`: red for a QuickBooks reconnect, a blocked check, a late
    close or the month before still open; amber when bank or card accounts are behind.
  - **Close tab** (page `client-close`, `components/staff/ClientClosePage.jsx`, `CLC_`):
    `CLC_ClientClosePage` shows one client and one month: status and notes, the QuickBooks check
    (`CC_ClientCloseCard`), the Ledger review card (`CLC_LedgerCard`), the close steps (six, or seven
    with Ledger reviewed via `closeStepsFor(client, period)`; `CloseChecklistCard`, `data-tour="close-steps"`),
    Mark ready / Sign off, the read-only `monthly_close` SOP and "Sent to the client". The first tick sets the
    month to In progress; bookkeepers mark it Ready for sign-off (status `review`) and only an admin
    signs it off (Done, `tk_sign_off_period`), which emails the client's people that reports are
    ready (a second sign-off asks first). Reopening a signed-off month is admin-only with a reason
    (`tk_reopen_period`). Every `month_close` write goes through `CT_saveMonthClose`
    (`CloseTracker.jsx`), with an `updated_at` guard shared with Work › Close ("Someone else saved
    first"). "Mark sent to client" on a report for last month ticks "Reports sent to the client" (P&L set to Last Closed Month; a Balance Sheet only when its as-of date is that month's last day, `closePeriodForAsOf`). The plain Balance Sheet PDF is as of today, so only the month-end one counts: on a QuickBooks client, staff get a second button on the Balance Sheet card, "Balance Sheet as of {last month end} (QuickBooks)" (`BSQ_MonthEndBalanceSheet`, `buildBalanceSheetQboPdf`), which calls `qbo-sync` with `action: "balance_sheet_asof"` and logs its send as item_key `bs_month_end` with `closePeriodForAsOf(month end)`.
    `CLC_CloseSummaryRow` is the one-line summary on the Overview. Names in Work › Close open the
    client's Close tab.
  - **Bank for staff** (`components/client/BankAccounts.jsx`): staff on any plan get a sync line
    ("Last synced … · Basic syncs monthly, on the 15th · Sync now", cadence from
    `STAFF_planCadence`), a stale note, the not-connected, needs-reconnecting (red banner over the
    old numbers) and first-sync states, and filter chips from the path: `bank/questions`,
    `bank/uncategorized`, `bank/unreconciled`, plus month and account. Clients see none of it.

- **Deep links to one item** (`components/staff/DeepLink.jsx`, `LK_`; loaded before `app.jsx`).
  One grammar: `#/client/<id>/<tab>[/<sub>][?item=<kind>:<id>][&month=YYYY-MM][&account=<qboId>]`
  and `#/<place>[/<tab>][?item=<kind>:<id>][&client=<id>]` (work, team, inbox, today, clients...).
  The path is view state that survives a refresh; the query is a one-time pointer. `LK_capture`
  reads it at boot and on every `hashchange`, stores the arrival in memory and strips the query
  with `replaceState`, so App never sees it. A destination claims it with `LK_useArrival` or
  `LK_take`, shows the item with `LK_find` and `LK_reveal` (scroll, short highlight, focus; static
  under reduced motion), or shows a fallback toast from `LK_COPY`. Kinds: `msg docreq file
  question txn rownote task deadline step sent sop note setup at dupbills view`; the element
  carries `data-lk="<kind>:<id>"`. `LK_href`, `LK_go` and `LK_onClick` build links; `LK_go` from a
  staff surface exits Preview first (`window.MGB_exitPreview`). The sign-in round trip is kept in
  sessionStorage `mgb_lk_arrival_v1` and re-armed once by `LK_rearm` (up to 10 minutes old).
  Never put emails, names or free text in a link.

- **Staff top bar** (`components/staff/TopBar.jsx` + `top-bar.css`, `TB_` prefix). App renders
  `TB_StaffTopBar` at the top of `<main>` whenever the staff sidebar shows (`showStaffRail`), so
  clients and client-user previews never see it. Sticky; no page links. Design is "option B"
  (owner-approved 2026-09-30): navy `var(--sidebar-bg)` bar joined to the sidebar, controls on
  translucent white chips, gold avatar and focus rings, light dropdown panels; colors are scoped
  `--tb-*` variables in one commented block in `top-bar.css` (dark mode adds a hairline bottom border). Each piece is its own
  component; delete its line in `TB_StaffTopBar` to drop it:
  - **Left:** `TB_ClientPicker` (reuses `CS_ClientSwitcher`) and `TB_SyncPill` (reuses
    `QboSyncNowButton`; click = Sync now). The Overview chip retired 2026-10-08: Overview is the
    first tab of the client tab row. Staff can Sync now on any plan, with no limit.
  - **Middle:** `TB_Search`, Ctrl/⌘+K. With nothing typed it lists every page and action
    (`TB_pageRows` / `TB_actionRows`, the Pages and Actions groups, also matched while typing).
    Clients and my tasks/notes are filtered locally; client SOPs
    (`client_sops` ilike, RLS-scoped) and Help (`search_staff_guide`) are queried, debounced. On a
    client page it adds an `In <client name>` group (after Clients): that client's transactions,
    budget categories, documents and messages, built by `buildClientSearchResults` in `app.jsx` (the
    same function behind the client-facing header `GlobalSearch`, so it respects `access.tabs` and
    `scopedClient` exactly the same way); picking one calls `setPage` + `setSearchTarget` to jump and
    highlight. App passes this in as the `clientSearch` prop (null on staff pages), and the
    placeholder starts "Search or jump to…" and names this client. Grouped listbox with
    arrow keys / Enter / Esc across all groups. While the top bar is shown (`showStaffTopBar`) the
    page-header search icon is not rendered; clients and client-user previews keep it.
  - **Right:** `TB_ThrottleBadge` (admins; `qbo_usage_status` mode throttled/stopped → `#/team/hours`),
    `TB_Bell` (client messages waiting per the Inbox's read markers, `client_doc_requests` with status
    uploaded, open tasks assigned to me by someone else, last month's `close_checks` Blocked (admins:
    only clients they're the assigned bookkeeper on). A bell row opens the exact item: an upload
    opens Documents at that request, a message opens that message on the client's Messages (on
    the Inbox it selects the thread in place), a blocked close opens the client's Close tab. Seen ids in `localStorage`
    `mgb-topbar-bell-seen:<email>`), `TB_TasksBadge` (open count, overdue in red → `#/work/tasks`),
    `TB_QuickAdd` ("+", client pages: New task / New note / Request document / Message; dispatches
    `tb:quick-add`, which the headless `StaffQuickActions` listens for and opens its own modal or the
    chat drawer), `TB_HelpButton` ("?" menu: Help for this page (`TB_helpSlugFor`: `TB_HELP_FOR_PAGE` plus the `help` slugs in `NAV_PLACES`), Staff guide, Send feedback via `FB_openFeedback` (`FB_FeedbackHost` is mounted next to it), What's new (`#/help/whats-new`), a Tips while you learn On/Off row (`TIPS_menuItem()`, Tips.jsx), then one item per `TOUR_staffTourList()` tour (`TOUR_startStaff(key)`)),
    `TB_AvatarMenu` (profile photo from `staff_profiles`, theme, Preview as a client user, Preview plan
    with check marks, Exit "View as", temporary access, **Settings** → `#/settings`, Sign out).
  - **Moved, not duplicated:** while mounted, the client picker, sync pill and account menu add
    `tb-has-client` / `tb-has-sync` / `tb-has-avatar` on `<html>`, and desktop-only CSS hides the old
    copies (sidebar/rail client switcher, header sync pill; the rail's own name/Settings/Sign out were removed outright on 2026-10-19f, and the rail and sidebar theme toggles earlier; theme
    lives in the account menu and Settings), temporary-access banner and Preview as select).
  - **Phones:** the bar sits under the navy `.mobile-topbar` and keeps only the client picker, search,
    bell and "+" (44px; its menu opens fixed under the bar), since "+" is now the only way to add a
    task / note / request or message from a client page. Overview is hidden there: picking a client
    in the picker, including the one already open, lands by the landing rule (the tab you left,
    else Overview). Everything else stays in
    the drawer.
  - Bell, Tasks and the task/note search groups step aside during admin "View as".

- **Today** (`components/staff/Today.jsx`, `TD_`, `#/today`): redesigned 2026-10-19j (desk-right-spec
  decision 28, one job per surface). Greeting and date, one count line ("N due today · N late · Open
  Slate"), a single **Do next** card (`TD_DoNextCard`: the top row of the existing ranking plus "then:",
  button label and action both from `TD_doNext(row)`, shared with `WB_Page`; a `decide` row such as a
  teammate's access grant shows Review and fires `td:reveal`, which opens the fold on that row; "N more
  tasks in Slate", or "N more in your Desk" with the Desk on), an **Also needs you (N)** fold for the
  non-task, non-reply rows (access, upgrades, handbook, deadlines, bills, closes, health, reviews keep
  their inline buttons; celebrations only while This week is off), then an auto-fit card grid (Clients needing attention, Waiting on others,
  Your reminders, This week with celebrations and Milestones to review) and a one-line Recent clients
  strip. "Also show" toggles the five cards (`todayCards` in user settings: `attention`, `waiting`,
  `reminders`, `milestones`, `recent`; all default on). The same layout renders on the classic path and
  in `WB_Page.jsx` (which now only supplies the Desk-ordered top row; the count line is Today's own on
  both paths). No tiles, source chips or long list on Today. No customizable board: `BookkeeperHomePage`
  and `useHomeMasonry` were deleted 2026-10-08.
- **Tasks** (Tasks module Phase 1, 2026-10-11; `components/tasks/`, `TK_`; spec
  `docs/tasks-phase1-spec.md`). Tasks are still rows in `staff_reminders`, with new columns and
  tables from `supabase/tasks-module-v1.sql`.
  - **Routes:** `#/tasks/my` (Slate; was My Tasks), `#/tasks/c/<client>`, `#/tasks/p/<project>`,
    `#/tasks/u/<id>` (admins), `#/tasks/search`; a task opens from any route with
    `?item=task:<id>`. An unknown route shows "We couldn't find that list." `PAGE_META.tasks` is
    "Slate" / "Your tasks, client lists and projects" (renamed from Tasks in Desk D1), and the ? menu's help is `my-tasks`.
  - **My Tasks** (`TK_MyTasks`): groups Overdue, Today (View › Today group, on by default), This
    week (7 days), Later (and undated), Waiting on client, Done (folded); done tasks older than
    12 months hide unless Show older. Also embedded as **Work › Tasks**. Mine = the assignee only
    (S8b, 2026-10-16: a task can have no assignee). Open unassigned tasks the person can see form an
    **Unassigned** group (before Done; for admins only their own book or ones they own) with
    **Claim** (`TK_api.claim` → `tk_claim_task`); `TK_api.listMine` reads mine plus open unassigned.
  - **Lists** (`TK_Sidebar`, `TK_List`, `TK_ClientHeader`): My Tasks, Search, Projects, Clients,
    People (admins). The rail shows at 900px and up, a Lists sheet below. Seeded projects: SOPs
    and 90 Day (`open_to_staff` on), Directors and Owners (admins only). Only admins change
    `open_to_staff`. Bookkeepers see a client's tasks only when assigned, covering or granted
    temporary access.
  - **Task details** (`TK_Drawer`, mounted once by App as `TK_DrawerHost`; since R0 the body is
    `TK_DrawerContent` and `TK_Drawer` is only the modal chrome): five statuses
    (`todo`, `in_progress`, `waiting_client`, `ready_for_review`, `done`); a `review_required`
    task finished by a non-admin goes to Ready for review, and any admin approves or sends it back
    (`tk_set_status`). Subtasks (`parent_id`), the existing `TCL_Checklist`, comments with
    @mentions (`tk_comments`; a mention adds a follower and a `tkm:` bell item, no email in
    Phase 1), followers (`tk_followers`; they can read private tasks), files (client task: the
    client's Drive as internal files via `DRV_upload`; internal task: the private `task-files`
    bucket; links on any task) and the Activity history (`tk_activity`). Copy link, Save or
    Suggest as template, Delete (a soft delete; Restore from the banner).
  - **Quick add** (`TK_QuickAdd`, `TK_QuickAddHost`): `q` on any staff page (not while typing,
    or with a modal, menu or tour open), **+** → New task with or without a client, ⌘K New task /
    New reminder. `TK_parseQuickAdd` reads `@person`, `#client`, `!high`/`!low`, and dates
    (`today`, `tomorrow`, weekdays, `next week`, `eom`, `in N days`, `+Nd`, `+Nw`, `+Nbd`,
    `bdN`, `M/D`, `YYYY-MM-DD`). Calendar days unless a business-day token is typed.
  - **Client tasks (2026-10-11b)** (`TK_ClientDrawer.jsx`, `TK_clientLogic.js`, `tk-client.css`;
    staff only, so nothing renders for `clientPortalUser`, `impersonating` or `isPreviewingUser`):
    - **Strip** (`TK_ClientStrip`): app.jsx mounts it right under `.app-topbar` (below the client
      tabs) for an open client, never on the Client view pages (`STAFF_CLIENT_VIEW_PAGES`). It
      shows "{n} open · {m} overdue" and the next task (`TK_cdSummary`: it prefers a task that fits the
      page, then overdue first, then soonest due, skipping waiting and in-review; no tick when a
      non-admin's next task is already in review); the tick
      goes through `TK_vComplete`, so the review gate and its toast stay in `TK_api`.
    - **Panel** (`TK_ClientDrawerHost`, mounted once by App beside `TK_DrawerHost`;
      `TK_ClientDrawerPanel`): a right slide-out (a bottom sheet at 640px and under) at z 1840,
      under the task details (1850), so a task opened from it stacks on top and the panel is
      `inert` meanwhile. It reads its own `clientcd:<id>` list of that client (the store
      matches lists by key prefix, so live updates just arrive) and filters on the client side
      (no notes, no deleted, done only with Show done). It lists every open task, with no cap.
      It stays open across hash changes and follows the client. On a staff page it shows the last
      client really opened this session (`lastOpenedClientId` in app.jsx, set only while client tabs
      show), or the "Open a client" message when none has been. Opening it closes the chat and widget drawers (it posts
      `tk:drawer-open` with no id), and opening chat closes it.
    - **For this page**: `TK_CD_PAGE_RULES` maps a page to sop sections, sources and whole words
      in the task's title (never the description). A match moves the task up; it is never
      hidden and never listed twice. Groups: For this page, Overdue, Today, This week, Later,
      Waiting on client, Ready for review, Done.
    - **Top bar pill:** `TB_TasksBadge` opens the panel when a client is open and
      `window.TK_clientDrawerReady` is true, else My Tasks.
    - **`t`** toggles the panel from anywhere (the `TK_KEYMAP` row has scope `global`); with the
      panel open, `q` adds a task to that client. List keys pause behind the panel
      (`TK_vKeyCtx` counts `.tk-cd-layer`).
    - **Events and globals:** `tk:client-drawer` (`{ action: "open" | "close" | "toggle", from }`)
      and `tk:client-drawer-state` (`{ open, ready }`); the only new globals are
      `window.TK_clientDrawerReady` and `window.TK_clientDrawerOpen`.
    - **Phase 2 (not built):** auto-tick ("fold" and "suggest", audit rows 14.1 and 14.2). Fold:
      the Close checklist and document requests become tasks, so ticking a Close step or finishing
      a request is ticking the task (one checklist, no sync). Suggest: when the only evidence is
      QuickBooks `close_checks`, offer "Looks done. QuickBooks shows ... [Mark done]" instead of
      ticking. Never matched on title (needs a `source_ref` link, a database change); review still
      applies; every auto-complete is logged and can be undone.
  - **Keys** (`TK_keys`, `TK_KEYMAP`): j/k, Enter, x, s, a, q, t, Esc, ?. Settings › Shortcuts has
    a Tasks shortcuts card.
  - **Own window** (`TK_popOut`, `TK_StandaloneBar`): Open in own window opens
    `/?shell=tasks#/tasks/...` in a 480×820 popup (size kept in `mgb_tk_popout_v1`); `/tasks`
    redirects there (`vercel.json`). The shell flag is `sessionStorage` `mgb_shell_v1`, per tab.
    Dock in portal posts to the opener over `TK_sync` and closes, or turns the window into the
    full portal after 600 ms. Tours and Tips aren't mounted in the shell. **Follow my client**
    (a switch in the bar, a menu item on touch; `mgb_tk_follow_v1`, `TK_useFollowClient`): the
    portal window posts `client-focus` over `TK_sync` (`{ clientId, at }`, a record id only,
    never a name or an email) when a client page opens, the window gains focus, or the shell
    sends `client-ask`; the shell checks it with `TK_cdAcceptFollow` and moves to
    `#/tasks/c/<id>` with a replace, so an open task stays open.
  - **Elsewhere:** Today's task rows use `TK_groupMyTasks` and `TK_api.complete`; the Overview's
    Tasks for this client card opens quick add and the drawer and links to `#/tasks/c/<client>`;
    the top bar Tasks badge opens `#/tasks/my`, or the client's task panel with a client open; ⌘K searches descriptions and comments
    (`tk_search`, "In a comment: …"); the bell lists mentions (`ST_BELL_PREFS` `mentions`).
  - **Notes & SOPs** moved to their own Work tab (`#/work/notes`, `MyTasksPage mode="notes"`).
    The legacy By client view is no longer reachable while the Tasks tables exist, so the
    handoff summary (`client_notes`) moved to a Handoff summaries card on that tab
    (`renderHandoffSection`, shared with the legacy By client cards).
  - **Schema missing:** every TK view shows "Tasks is being set up" and Work › Tasks falls back to
    the legacy `MyTasksPage`.
  - **Usage stats** (`app.jsx` labels): tab label `tasks` "Tasks"; actions `tasks-drawer`, `tasks-quick-add`,
    `tasks-search`, `tasks-shortcut`, `tasks-popout`, `tasks-dock`, `tasks-client-drawer`,
    `tasks-follow`, plus `tasks-comment` and `tasks-attach`.
  - **Version:** `MGB_VERSION` `2026-10-11b`, "Tasks: client task strip and panel, t shortcut, Follow my
    client".
  - Local storage (all cleared by Developer Tools › Reset local state, which takes every
    `mgb_` key): `mgb_tk_groups_v1`, `mgb_tk_view_v1`, `mgb_tk_groupby_v1:<email>`, `mgb_tk_groupby_v1:person:<email>`, `mgb_tk_slate_view_v1:<email>`, `mgb_tk_slate_view_v1:desk:<email>`, `mgb_tk_sort_v1`, `mgb_tk_popout_v1`, `mgb_tk_follow_v1`.
    In `sessionStorage`, per tab and ending with it: the shell flag `mgb_shell_v1` and
    `mgb_tk_keys_used_v1` (`TK_keys.jsx`).
  - Guide articles: `my-tasks`, `task-details`, `task-lists-and-projects`, `tasks-own-window`, `client-tasks-drawer`.
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
  - Who a message is from is set by the database, not the browser
    (`supabase/client-messages-author-stamp.sql`): `author_name` is stamped from `staff.name`
    (staff) or that client's `client_users.name` (clients), keyed on `author_email`, which RLS
    ties to the signed-in email. Service-role inserts with no JWT email keep the name they send.
    Author fields can't change after a message is saved. The staff "new client message" email
    uses the stamped name.
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
- **Client details** (**Client setup** gear at the right end of the staff tab row → Access and
  details, staff only): Documents (Drive links), QuickBooks (connect / sync / disconnect), Notes,
  SOP, Milestone, Activity. Old links `#/client/<id>/client-details` still open it.
- **Manage access** (**Client setup** gear → Access and details): People, Organization tabs,
  Requests. Old links `#/client/<id>/manage-access` still open it.
- **Settings** (`components/settings/Settings.jsx`, `settings.css`; route `#/settings`, from the
  account menu): Profile (name is `staff.name`, saved through the `set_my_staff_name` RPC
  (own row only, `supabase/staff-name-canonical.sql`; `staff_profiles.display_name` is retired);
  title, phone, photo in the private `staff-avatars` bucket, row in `staff_profiles`), Notifications (email kinds + which bell items show), Appearance & start page,
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
  - **Staff Access**: staff roster (Admins and Bookkeepers cards), add, bulk import, client assignments, temporary admin grants.
  - **Client Roster**: client organizations (add/edit), client contacts, invite, scoping, bulk
    import.
  - **Developer Tools**: system info, feature flags, recent activity, local storage.
  - **Usage Stats**: page views and feedback survey results.

### Admin features added 2026-09-29

- **Team page** (`#/team/<tab>`, `components/staff/TeamPage.jsx`): People, Reviews and Onboarding
  for everyone; Hours, Reply times, Feedback and Members for admins. Email settings live on the
  Emails page; Team › Hours links there.
- **QuickBooks Time**: firm connection and hours by person and client, which feed
  **profitability** (fee vs. cost at each person's rate) and **capacity** (weekly hours vs. target).
- **Work › Close** (`#/work/close`; was Close tracker): month-end close status per client. The "Mine" filter
  uses the assigned bookkeeper's staff email.
- **Recurring tasks** (`#/tasks/templates`; `#/templates` and Settings › Task templates redirect
  there): weekly, monthly, quarterly and annual templates, generated each morning for each
  client (`supabase/task-templates.sql`, then `supabase/tasks-p2-4-recurring.sql`). See
  "Tasks Phase 2, S4" under the database notes.
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
  - **Ask client emails live** (Client emails card, owner only, default off) edits
    `client_email_settings.client_request_enabled` with the same plain update as the other
    switches. No RPC: the trigger `tk_guard_client_request_switch` refuses anyone but
    `is_internal_owner()` (`tk_owner_only`) and writes `tk_settings_audit` (who, when, old, new).
    The row asks `is_internal_owner` to decide clickable vs **Owner only**, shows
    `tk_settings.client_request_pilot` read-only (not set / empty / all / N clients) and the last
    audit row. Turning on confirms who gets emailed; off is immediate. Rules and copy:
    `components/staff/clientEmailsAskLogic.js` (`node components/staff/clientEmailsAskLogic.test.js`).
    Live self-test (one transaction, rolls back): `supabase/ask-client-switch-tests.sql`.
- **Digest sections**: scope creep, price review, revenue snapshot, late payers, timesheet gaps,
  staff scorecard, stale clients, pending, and **Staff feedback** (count of `staff_feedback` rows
  still `new`, split by kind, e.g. "3 new: 2 bugs, 1 idea"; how many arrived in the last 7 days;
  the 5 newest `new` reports with kind tag, sender and the first ~120 characters, escaped; link to
  `#/team/feedback`; "No new feedback." when there are none). All numbers come from
  `digest_weekly_data()` (`supabase/weekly-digest.sql`; the `staff_feedback` key was added by
  `supabase/digest-staff-feedback.sql`).
- **Bug reports / feedback** (`components/staff/Feedback.jsx`, `FB_` prefix; table
  `staff_feedback`, `supabase/staff-feedback.sql`). Staff open "Send feedback" from the
  top bar's **?** menu, the ⌘K Actions group, or the bottom of the Staff guide page: kind chips (Bug first and default, Idea,
  Question, Other), message, optional "What did you expect to happen?" for bugs. The page hash and
  open client are sent along; bugs also send the browser user agent + screen size. "My feedback" in
  the modal lists the sender's own reports with status and admin reply. Admins triage on the
  **Feedback** tab of Team (`#/team/feedback`, tab badge = count of `new`): newest first, filter by
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
- **Automated close checks** (added 2026-09-30, Work › Close, the client's Close tab and the
  client overview): each
  completed month gets **Ready**, **Blocked** (uncategorized / Ask My Accountant activity in the
  month, or Undeposited Funds not cleared at month end) or **Behind** (a bank or card account
  went quiet before month end, or transactions on or before month end aren't reconciled), with
  the reasons on hover and in the cell editor. The status filter and summary can pick them.
  Written by `close_checks_evaluate()` after each close-data pull and daily at 11:25 UTC
  (`supabase/qbo-close-checks.sql`). Reconciliation is read from each transaction's cleared flag
  and bank-feed health from the last transaction date; QuickBooks exposes neither directly.
- **Stale-bank flags** (added 2026-09-30): a bank or card account with no transaction in more
  than N days (default 10; admins set it in the Work › Close toolbar,
  `month_close_settings.stale_bank_days`) is flagged in the Work › Close client column and on
  the client overview.
- **Entity type** (added 2026-09-30): `clients.entity_type` is `nonprofit` (default) or
  `for_profit`. Set with the Organization type select (`OB_EntityTypeSelect`) in the Overview's Key
  dates and coverage (any staff with access, through `set_client_entity_type()`; also on the admin
  Onboarding card) or in Client Roster add/edit (admins). Stored and shown only for
  now (`supabase/client-entity-type.sql`).
- **Deep links**: pages have hash URLs such as `#/today`, `#/work/<tab>`, `#/clients`,
  `#/team/<tab>`, `#/emails`, `#/client/<id>/overview` or `#/client/<id>/<tab>` (the tab is part
  of the URL everywhere). A link survives Google sign-in, and staff
  who can't see a page or client are sent to their dashboard instead. Links to one item add a
  one-time pointer (see **Deep links to one item** below).

Owner setup:

1. In Supabase > Edge Functions > Secrets, add `RESEND_API_KEY` (and optionally `DIGEST_FROM`),
   and verify the sending domain in Resend. Until then, emails are logged as "not configured".
   The Emails page banner shows which step is still missing.
2. Connect the firm's QuickBooks (Time) from Team › Hours, then map QuickBooks people and
   customers to staff and clients.
3. Set each staff member's cost rate (and weekly capacity) on Team › Hours so profitability,
   price review and capacity have numbers.
4. On the Client Roster, pick a real assigned bookkeeper for each client.

### Team Reviews and Team Survey (added 2026-10-07)

Staff-only module on the **Reviews** tab of Team (`#/hr/reviews/<tab>`, `#/hr/reviews/r/<id>`,
`#/hr/reviews/survey`). Clients can't reach any of it: every table has RLS, and every read and write
goes through `security definer` RPCs that call `tr_me()` / `tr_require_admin()` first.

- **Front end** (in-browser Babel, `TR_` globals, loaded from `index.html` in this order):
  `components/staff/teamReviewsLogic.js` (scale, items, validation, year-end draft; unit tests in
  `teamReviewsLogic.test.js`), `TeamReviews.jsx` (page shell, tabs, overview store, Team tab badge,
  Today "Review due" row, the form), `TeamReviewsCompare.jsx` (comparison, action steps,
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
- **Blind rule** is enforced in `tr_get_review` via `tr_can_see_submission`: the reviewer doesn't
  get the self-review until both forms are submitted, even as an admin. Any other admin sees both
  forms live, drafts included (2026-10-13, `supabase/team-reviews-3-admin-live-view.sql`; the
  **In progress** view in `TeamReviewsCompare.jsx`).
- **Comparison lock + reveal** (2026-10-21, `supabase/team-reviews-7-comparison-lock.sql`, role
  tests in `team-reviews-7-comparison-lock-tests.sql`, ends in ROLLBACK): the reviewee (even an
  admin) gets nothing of the reviewer's side (scores, comments, flags, steps, signatures, addenda,
  totals in `tr_history` / `tr_my_overview` / `tr_team_status` / `tr_year_doc` /
  `staff_performance`, `action_steps` RLS) until the review is **revealed**: `reviews.revealed_at`
  set, or `status = 'signed'`. `tr_can_see_submission` takes a 9th `p_revealed` arg (the old
  8-arg form fails closed). Once both are in, the reviewer and admins see it to prep.
  `tr_reveal_comparison(p_review)` (active admin, not the reviewee, and the review's reviewer or in
  `review_settings.revealer_emails`, seeded jesse@ + bailley@) sets `revealed_at`/`revealed_by`,
  writes a `reveal` event, sends no email, and can't be undone (`tr_reviews_guard`). The reviewee
  can't edit steps, comments or sign until then; `tr_sign` refuses before the reveal. When both
  are in, the reviewee gets `both_complete` ("set up a time with <reviewer>"; `meeting.ts`, never
  says results are ready) and the reviewer gets `comparison_ready` (prep wording). Due items:
  `meet` (reviewee) and `reveal` (reviewer); reminders carry the same todos. UI:
  `TR_MeetingCard` / `TR_RevealBanner` in `TeamReviewsCompare.jsx`, **Ready to reveal** pills.
  Tests: `tests/edge/both_complete.test.mjs`, `teamReviewsLogic.test.js`.
- **Self-review heads-up email** (2026-10-15, `supabase/team-reviews-4-self-submitted.sql`):
  `tr_save_submission` queues `self_review_submitted` for the review's `reviewer_id` when the
  self form is submitted first (dedupe `self_submitted:<review id>`, no reopen counter, so once per
  review). Payload has cycle, name and due date only. The edge function (`selfsubmitted.ts`) skips
  it at send time if the reviewer has since submitted. Tests: `tests/edge/self_submitted.test.mjs`.
- **Review final email** (2026-10-19, `supabase/team-reviews-5-final-compare.sql`): when a review
  locks, `exportReview` queues kind `review_final` (instead of the old `locked`) for the team
  member and the reviewer, dedupe `final:<review id>:staff` / `final:<review id>:reviewer`, so
  re-exports after an addendum never resend. It queues nothing for a person who already has a
  `locked:<review id>:<staff|reviewer>` row (reviews locked before this shipped; no backfill), and
  nothing when that lookup fails. At send time the edge function calls `tr_final_compare` (service
  role only) and renders `finalemail.ts`: the official scores (the reviewer's ratings; each area is
  the average of its two items out of 5, Overall out of 30), the change from the most recent
  earlier **signed** review of the same person by any reviewer ("Up 0.5", "Down 1", "No change"; a
  "Compared with Q1 2026, the most recent earlier locked review." line when it isn't the quarter
  right before; a "first locked review" sentence when there is none), and up to 10 agreed action
  steps. Never comments, notes, disagree text or self ratings. It is skipped if the review is no
  longer signed or the recipient is no longer its team member or reviewer. `tr_get_review` returns
  the same object as `quarter_compare` on signed reviews, shown as the **Compared with last
  quarter** card in `TeamReviewsCompare.jsx` (`TR_qc*` helpers in `teamReviewsLogic.js`). The
  `locked` case stays in `emailFor` for legacy rows. Tests: `tests/edge/review_final.test.mjs`,
  `teamReviewsLogic.test.js`, SQL `supabase/team-reviews-5-final-compare-tests.sql` (ends in
  ROLLBACK). Email kinds: `cycle_opened`, `review_assigned`, `comparison_ready`,
  `self_review_submitted`, `both_complete`, `reopened`, `signature_needed`, `reminder`, `due_soon`,
  `cycle_relabelled`, `review_final` (and legacy `locked`).
- **Reassigning:** a former reviewer can't be put back on a review once its self-review exists
  (`tr_reassign_reviewer`), since while off it they could see the self-review as "another admin".
- **Drafts:** review forms autosave to `review_submissions`. Survey drafts stay in the browser
  (`localStorage`, key `mgb-survey-draft:<user>:<cycle>`) so anonymous Q7/Q10 answers are never
  stored next to a name; cleared on submit.
- **Quarter:** a cycle reviews the quarter that just ended. The Open a cycle form defaults to it
  (`TR_nextQuarter`), with the due date at the end of the next month. A cycle's quarter can't be
  changed afterwards (`tr_cycles_guard`).
- **Signatures** store user id, typed name, account email, UTC time, IP and user agent. IP and
  user agent are read server-side from PostgREST's `request.headers` (`cf-connecting-ip`, then
  `x-real-ip`, then the first `x-forwarded-for` entry), never from the browser.
- **Edge function** `supabase/functions/team-reviews/` (`verify_jwt` off, checks the caller's JWT
  or the cron bearer itself): `pdf`, `export`, `year_pdf`, `year_export`, `drive_status`, plus the
  `sweep` job that sends queued emails and retries Drive exports hourly. PDFs are drawn in `pdf.ts`;
  pure email bodies in `selfsubmitted.ts` and `finalemail.ts` (deploy both with `index.ts`).
  Email kind `cycle_relabelled` is a correction queued by hand when a cycle's quarter is fixed after
  the opening emails went out (payload `cycle`, `was`, `period`, `opened_on`, `due_at`, `role`
  reviewee/reviewer); first used 2026-10-13 for Q4 2026 -> Q3 2026.
  Drive: Shared Drive id in `GOOGLE_DRIVE_REVIEWS_DRIVE_ID`, same `GOOGLE_SERVICE_ACCOUNT_JSON` as
  client files; path `{Staff Name}/{YYYY} Q{n} Review.pdf` and `{YYYY} Year-End Summary.pdf`;
  re-export updates the same file (new revision). Without the secret, reviews still lock and show
  "Waiting for Drive setup". Staff never get Drive links; PDFs stream through the portal.
- **Retention:** keep forever. Nothing in the module hard-deletes; unsigned reviews end as
  `closed_unsigned`, corrections after lock are addenda.
- **Anonymous survey questions (7 and 10)** are stored in `survey_anonymous_answers` without a
  staff id and shown to admins as soon as 1 person answered (was 3; owner decision 2026-10-20,
  `team-reviews-6-anon-min-one.sql`). Caveat: with a small team, timing and
  writing style can still identify someone, and the table has no timestamp or staff id but someone
  with direct database access could guess from physical row order. It's "not linked by name", not
  cryptographic anonymity.
- Staff guide: `quarterly-reviews.md`, `team-survey.md`, `review-cycles.md`,
  `review-drive-setup.md`.

### Inventory (added 2026-10-08)

**Team › Inventory** (`#/team/inventory`; old `#/team/tech` links still work through
`NAV_TAB_ALIASES` in StaffNav.jsx), replacing the old Apps Script sheet. The portal's staff list
(`public.staff`) is the source of truth for people; nothing is matched by free-text name.

- **Front end:** `components/staff/TechInventory.jsx` (`TI_` globals) and `tech-inventory.css`,
  built on the portal's own classes (`kpi-grid`, `card`, `view-toggle`, `tx-table`, `task-field`,
  `pill`). Staff get **My inventory** (request hardware, log/edit/archive their own items, withdraw an
  open request) and **Standard setup**. Admins get KPI tiles plus **Requests**, **Items**,
  **Roster** (laptop, items, open requests, missing essentials per active staff member),
  **Directory** and **Standard setup**.
- **Database:** `supabase/tech-inventory.sql` (tables `tech_requests`, `tech_assets`,
  `tech_setup`), `supabase/tech-inventory-v2.sql` (`archived_at` on all three, delete grant revoked,
  staff can update their own open requests and own items; `staff_contact` for the Directory,
  admin-only RLS, no delete) and `supabase/tech-inventory-import.sql` (one-time, re-runnable import
  of the old sheet; only rows whose person is in `public.staff`). Nothing hard-deletes: rows are
  archived.
- **Directory** (`staff_contact`, keyed by lower-case staff email): legal name, personal email,
  phones, home address. Admins only. Name and email shown come from `public.staff`.
- **Request email:** trigger `notify_enqueue_tech_request` queues `notification_outbox` kind
  `staff_tech_request` to admin@mygoodbooks.org (rows older than a day are skipped, so imports
  don't email). `notification-emails` sends it and skips the active-staff check for this kind only,
  because that inbox isn't a staff login.
- **Export:** edge function `supabase/functions/tech-inventory/` (`verify_jwt` off; checks the
  caller is an active admin itself). `export` builds an XLSX (Requests, Items, Roster, Standard
  setup, Directory) and uploads it converted to a Google Sheet named `Inventory YYYY-MM-DD
  HH:MM` in an "Inventory" folder on the admin-only reviews Shared Drive
  (`GOOGLE_DRIVE_REVIEWS_DRIVE_ID`, same `GOOGLE_SERVICE_ACCOUNT_JSON`). It never writes to the
  client files drive. Deploy: `npx supabase@latest functions deploy tech-inventory --project-ref
  xumsqmhccgfjnlmieqyu --no-verify-jwt`.
- **Laptop rule:** a setup line that names a laptop (e.g. "Mac Neo") is covered by any laptop the
  person has; other essentials match on category or item name. Same rule in `TI_covers` and the
  edge function.

### First-load safety (added 2026-10-15)

- `baseClient` in `app.jsx` ends in an `isPlaceholder` client (via `withClientDataDefaults`), so an empty roster (new bookkeeper with no access rows, or a failed roster fetch) reaches the zero-clients splash instead of throwing on first render. `tests/firstload.test.js` guards it (`node tests/firstload.test.js`).
- `loadClientsRoster` (index.html) sets `window.ROSTER_LOAD_ERROR` when the client fetch errors; `app.jsx` then shows a "couldn't load the client list" splash with Reload on client pages (firm-wide pages still open).
- `ErrorBoundary` logs to `client_errors` (React doesn't send caught render errors to `window.onerror`), shows an `MGB_errorCode`, and has a Copy details button (`MGB_errorDetailsText`: message, version, path, a few frames; tokens scrubbed). `MGB_reportError` falls back to the session email when `__mgbActor` isn't set yet.

### MGB (internal) and flagged clients (added 2026-10-15)

- **MGB (internal)** (`clients.id = 'mygoodbooks'`, `clients.is_internal`) is the firm's own books, run
  through the normal client workspace. It is not a client: never in rosters, counts, the client
  switcher list, Today or Team numbers. It has its own rail item (`NAV_PLACES` key `internal`, label
  "MGB (internal)") and the alias `#/internal`.
- **Who sees it:** active admins whose row exists in `internal_access`: default ON for every admin (backfill + trigger on `staff`), the owner can switch a person OFF (remembered in `internal_access_optout`, so a later re-promotion does not re-grant) (table `internal_access`; RPCs
  `can_view_internal()`, `is_internal_owner()`, `set_internal_notify_email(p_email)` (singleton `internal_notify_settings`; `notification-emails` routes every MGB staff email and due reminder to that one address, none when unset), `set_internal_access(p_email, p_allowed)`, all in
  `supabase/internal-company-profile.sql`, with a restrictive RLS lock server-side). `AuthGate` reads the two
  checks into `staffUser.canViewInternal` / `isInternalOwner` (a failing RPC counts as "no", so the app still
  loads before the SQL is applied). Temp admins, bookkeepers, account managers and clients never see it, and
  View as hides it (`STAFF_canViewInternal(realUser, impersonating)` gates the nav item, route resolution and
  `visibleClients`). The owner toggles it per admin in HR › Members (an owner-only "MGB (internal)" column).
- **Lists and pickers:** `components/staff/ClientFlags.jsx` (`CF_`) is the one helper for flagged clients: `CF_sort`
  (normal, then Test, then Internal), `CF_Badge` (the Test / Internal pill), `CF_label` (plain-text option
  label), `CF_pick` / `CF_usePicked` (sort and hide), `CF_Toggle` (the "Show test clients" switch, Clients page
  and client picker footer) and `CF_excludedIds`. The switch is OFF by default, stored per person in
  localStorage `mgb-show-test-clients:<email>` (covered by Dev Tools' reset). Off hides test clients from lists and
  pickers for everyone, assigned or not, except the client open now (search, direct links and View as still reach them). It never changes what anyone may open. App derives
  `visibleClients` (routes and permissions) ⊇ `rosterClients` (no internal) ⊇ `listClients` (lists and pickers).
- **Docs and upkeep:** staff guide `mgb-internal.md`, `preview-as.md` ("Try things on the test clients first"),
  `clients-page.md`, `finding-a-client.md`, `admin-guide.md`, `firm-quickbooks.md`, `staff-management.md`,
  `whats-new.md`. A new table with a `client_id` column needs the lock policy (see the SQL header).

### Ledger review (added 2026-10-14)

- **Where:** a client tab "Ledger review" after Close (`client-ledger`), Work › Ledger review ("Review a
  file", browser only, nothing stored), and admin Team › Ledger review (settings: `done_gate` warn or
  block, pull window, start month, vendor watch list). A "Ledger reviewed" Close step (seven steps
  instead of six, `closeStepsFor`) follows the month's sign-off; the box can't be ticked by hand.
- **Flow:** `qbo-gl-review` pulls the ledger, the browser runs the checks (`GLR_checks.js`) and saves
  flags through RPCs; Clear, Stop flagging (a per-client rule), Ask client (portal question or email via
  `gl-review-send`), Mark reviewed, admin Approve or Send back. Ships as **warn only**.
- **Client setup:** `client_profile.greeting_name` and `contact_email` (Overview › Edit dates and
  coverage). Ask-by-email and send-summary-by-email need `contact_email`.
- **Per-run range picker, labelled "Go back to" (2026-10-15; one toolbar row: Review month / Go back to (i tooltip) / Pull from QuickBooks, status line under it shows `LR_logic.coveredLabel`; Settings field uses the same wording, its Close-step month is "Count the Close step from"):** per-run picker in `LR_Tab.jsx` (local state, never saved, resets to Default after a custom pull; settings `pull_window` stays the default). Picks a month start up to 24 back and sends `window:{start,end}` (end = today in America/Chicago); custom runs force a new pull, skip `mark_fixed`, and save only window-independent flag types (`LR_logic.CUSTOM_SAVE_TYPES`). Month lists use the firm (Chicago) date.
- **Possible duplicates: Smart or Strict (added 2026-10-17; spec `docs/gl-review-spec.md` 7.1):** Strict
  is the old rule (flag every same-date, same-name, same-amount, same-account match on a different
  transaction). Smart, the default, skips amounts under $1 (floor configurable), different kinds of
  entry that pass through a holding account (Payment vs Deposit on Undeposited Funds, bank/clearing
  transfers; same-kind or both money-out / both money-in kinds still pair), memos or document numbers
  that are both filled in and different, and lines of one transaction; when in doubt it flags. Database
  `supabase/gl-review-5-dup-mode.sql` (**not applied until you run it**): `gl_review_settings.dup_mode`
  (firm default), `gl_review_client_settings` (per-client override), RPCs `gl_review_save_dup_mode`
  (admins only, writes audit action `gl_review.dup_mode`, Audit log group Ledger review; Strict
  restores hidden flags at once) and `gl_review_hide_dup_flags` (after a Smart pull, open dup flags
  Smart no longer detects become `fixed` with `fixed_by 'dup_smart'`, labelled "No longer flagged
  (Smart mode)", hidden and not counted by the Close step; asked, cleared, approved flags and notes are
  never touched). Lines aren't stored, so a change to Smart applies on the next Pull. UI: firm default in
  Team › Ledger review (`LR_Settings.jsx`), per-client override and the "Possible duplicates: Smart/Strict"
  chip with the set-aside list on the client tab (`LR_Panels.jsx` `LR_DupModeBar`). Upkeep: launch
  announcement `dup-smart`, guide `ledger-review`, `staff-settings`, `audit-log`, `whats-new`,
  `MGB_VERSION` `2026-10-17e`; `AuditLog.jsx` label and filter group.
- **Roll-forward panel (added 2026-10-21; spec `docs/gl-review-spec.md`):** `GLR_checks.rollForward`
  (also `runChecks(...).rollfwd`) and `LR_RollForwardPanel` in `LR_Panels.jsx`, rendered under
  Reconciliation in `LR_Tab.jsx` and `LR_ReviewFile.jsx`. Per bank/card/loan account for the reviewed
  month: beginning + money in - money out = ending, footed to QuickBooks' running balance (`bal`) in
  integer cents; a miss shows the difference, never a plug, and creates no flag. Tests
  `tests/ledger/rollforward.test.js`. Upkeep: guide `ledger-review`, `whats-new`, `MGB_VERSION`
  `2026-10-21w`; no launch announcement (a panel inside an existing tab).
- **Month swing (added 2026-10-19; spec `docs/gl-review-spec.md` Phase 2 checks):** the `swing` flag
  (low, key `acct:<acct_id>:<YYYY-MM>`; `GLR_checks.swingHits`, thresholds `T.swing*` in `GLR_config.js`).
  For each income/expense account it compares the reviewed month's net total with the average of the up
  to 3 earlier months the pull covers (a covered month with nothing for the account counts as zero), and
  flags a change of at least $1,000 and 50% of that average, up or down; an average under $50 is
  skipped. It needs at least 2 earlier covered months, so an early-year year-to-date pull can't show it, and the account needs activity in 2+ of the baseline months.
  Month-dependent like `recon_uncleared` (`GLR_config.MONTH_DEPENDENT_TYPES`: only the saved month's
  flags are listed unsaved, never auto-fixed by `gl_review_mark_fixed`; the SQL list
  `v_month_types` is in `supabase/gl-review-6-swing.sql` (**not applied until you run it**) and
  `gl-review-1-core.sql`). `CHECKS_VERSION` stays 1. Tests `tests/ledger/swing.test.js`. Upkeep: guide
  `ledger-review`, `whats-new`, `MGB_VERSION` `2026-10-19q`; no launch announcement (a low priority flag
  inside an existing tab, not a new feature).
- **Docs and upkeep:** staff guide `ledger-review.md`; tour steps in `Tour.jsx` (`client-ledger`,
  Work and Team tab steps); tip `ledger-flags` in `Tips.jsx`; help slug `ledger-review`; Dev Tools links.

### Staff profile photos (added 2026-10-16)

Every active staff member must have a profile photo. An admin removes the background so the team
matches. Spec `docs/staff-photo-spec.md`; database `supabase/staff-photo.sql` (re-runnable).

- **Storage.** Bucket `staff-avatars` (private, 5 MB limit). Staff can only add objects under
  their own `<email>/` folder; the staff `update` and `delete` policies are dropped. **Objects are
  never deleted**, so old emails' signed URLs keep working. Versions are only soft-deleted
  (`staff_photo_versions.deleted_at`). `staff_profiles.photo_path` is still the current-photo
  pointer, so `bookkeeper_public_profile`, `client_team_profiles`, `signature.ts`, `ST_profile`
  and `AM_usePhoto` are unchanged.
- **Statuses (derived, never stored).** `missing`, `exempt` (no photo and an admin marked **Not
  required**, table `staff_photo_exemptions`), `submitted` (shown as **Needs edit**: the current
  version is the person's own) and `edited` (shown as **Done**: an admin edit is current). A new
  upload after an edit goes back to `submitted`.
- **RPCs.** Staff: `sp_my_photo_status`, `sp_submit_my_photo`. Admin (`is_active_staff_admin()`,
  so no temp admins): `sp_admin_photo_list`, `sp_admin_photo_history`,
  `sp_admin_replace_staff_photo`, `sp_admin_restore_staff_photo`, `sp_admin_set_photo_exempt`,
  `sp_admin_hide_photo_version`, `sp_admin_log_photo_download`. Helpers: `sp_status_for`,
  `sp_audit`, `sp_can_read_avatar`. Every change writes `audit_write('staff_photo.<verb>', ...)`
  (Audit log, group **Profile photos**) and a `staff_audit_log` row (Dev Tools).
- **The guard rule.** `staff_profiles_guard` ignores any change to `photo_path` unless the RPC set
  the transaction-local flag `mgb.staff_photo_rpc = 'on'`, so `photo_path` only moves through the
  `sp_*` functions.
- **Files.** The browser re-encodes through canvas (strips EXIF and GPS): original JPEG, longest
  side 2048 px; current 512 x 512 JPEG; admin edit 512 x 512 PNG with alpha. Input up to 15 MB,
  crop at least 400 x 400.
- **The gate (retired 2026-10-21).** `PG_Gate` is no longer mounted in `app.jsx`; staff get a "Finish setting up your portal profile" task instead (inserted once per active staffer, due 2026-10-28). The component stays in the repo. Old behavior: a full-page overlay
  `#pg-gate` for any active, non-exempt staffer with no photo. Not shown while viewing as someone,
  previewing a client, or on Settings. **Later** (always shown) and **Continue for now** (after a failed upload) hide it for
  that page load only, so it returns on every visit until a photo is saved. If the status can't load, it fails open. **Order:** photo gate, Today's
  first-sign-in profile prompt, role tour, announcements and tips; each waits while `#pg-gate`
  exists.
- **Admin UI.** HR › Members has a **Photo** column (`data-tour="members-photo"` on the first
  row), a per-person drawer (download original or current, **Replace with edited photo**,
  **Restore original**, **Not required**, History with **Hide**) and **Download all (zip)**
  (`mgb-staff-photos-<date>.zip`, logged once). Temp admins see the column read-only. Admins also
  get a Today row, **N profile photos to edit** (rank 3); it opens HR › Members at the first
  one through `sessionStorage` `mgb-photo-open` (the hash query is claimed by `DeepLink.jsx`).
- **Staff side.** Settings › Profile now has **Change photo** only (no remove). New hires get the
  onboarding step `profile-photo` ("Add your profile photo", guide article `profile-photo`);
  admins manage photos per `staff-photos`.
- **Launch.** Announcement `staff-profile-photos` (admins and bookkeepers); guide articles
  `profile-photo` and `staff-photos`.

### Staff Handbook (added 2026-10-13)

**HR › Handbook** (`#/hr/handbook`): the firm's staff policies, each with versions. Spec:
`docs/staff-handbook-spec.md`. Only active staff with role `bookkeeper` sign (`hb_is_signer`);
the countersigner is one setting (`handbook_settings`, set by an admin with `hb_set_countersigner`).

- **Database:** `supabase/staff-handbook.sql` (tables `handbook_policies`, `handbook_versions`
  (immutable), `handbook_signatures` (no deletes; countersign and PDF columns set once),
  `handbook_settings`). RPCs: `hb_status`, `hb_get_policy`, `hb_sign`, `hb_countersign`,
  `hb_publish_version`, `hb_set_countersigner`, `hb_retry_export`. Every write is audited
  (`handbook.*`). Re-signing is due 7 days after a "needs re-signing" version is published, then
  shows Overdue; nothing locks.
- **Front end:** `components/handbook/` (see the repo map). Routes: `#/hr/handbook`,
  `#/hr/handbook/<slug>`, `#/hr/handbook/<slug>/v<n>`. Deep link
  `#/hr/handbook?item=handbook:<slug>` (kind `handbook` in `LK_KINDS`, claimed by the tab).
  Today rows (`TD_useHandbookItems`): "Sign: <policy> v<n>" (Due / Overdue) and "Countersign:
  <signer>, <policy> v<n>". The Team tab badge is `hb_status().badge`.
- **Signed PDF:** after the countersignature, the `team-reviews` edge function (`export_handbook`)
  builds the PDF once and files it on the admin-only reviews Shared Drive under
  `Handbook / <Policy>`. `download_handbook_pdf` streams it to the signer, its countersigner or an admin.
- **Email:** `notification-emails` kinds `handbook_sign_needed` and `handbook_countersign_needed`
  (link only), preference `notify.email.handbook` (on by default). `handbook_approval_needed`
  (2026-10-19, batched, count and link only) goes to the policy approver, preference
  `notify.email.handbook_approval`. `handbook_changes_requested` (2026-10-20, one per request,
  title and note, never the policy text) goes to the admin who last edited the draft, preference
  `notify.email.handbook_changes`.
- **Admin tools (2026-10-14, `HB_Admin.jsx`, `supabase/staff-handbook-2-admin.sql`, run after
  `staff-handbook.sql`):** **Publish new version** in the policy view (latest version only):
  markdown textarea, live `HLP_Markdown` preview, change note, Needs re-signing / Minor edit, then
  a confirm step; calls `hb_publish_version`, which now refuses text identical to the current
  version (no duplicate versions or emails from a double click). **Signatures by bookkeeper**
  grid (policies x active bookkeepers, from `hb_status().grid`). **Not filed to Drive yet** list
  (`hb_status().unfiled`, admins) with **Retry filing** (`hb_retry_export`). Re-sign nudges are
  the shipped ones: one `handbook_sign_needed` email per active bookkeeper on publish, the Today
  row, the tab badge, Overdue after 7 days. No reminder cron (spec Part F).
- **Policy kinds and drafts (2026-10-19, spec Part K, `supabase/staff-handbook-3-kinds.sql`, run
  after `staff-handbook-2-admin.sql`; checks in `staff-handbook-3-kinds-tests.sql`):** each policy
  is `signed` or `reference` (read only, versioned, never signed, never in Today, the badge, the
  grid or email) and `draft` (admins only, quiet) or `published`. Admin **New policy**
  (`hb_create_policy`, always a reference draft; the server refuses `signed`, so nobody is asked
  to sign until an admin converts), **Publish** (`hb_publish_policy`), **Edit details**
  (`hb_update_policy`) and **Make this a signed policy** (`hb_convert_to_signed`, needs a confirm
  and a change note). The list groups "Policies to sign", then sections, then "Drafts", with
  client-side search. The server refuses reference policies in sign, countersign and PDF export;
  `HB_logic.js` filters them out of Today, the badge and the grid as a second lock.
  **Re-run guard:** `staff-handbook.sql` and `staff-handbook-2-admin.sql` stop with an error (and
  change nothing) once `handbook_policies.kind` exists, unless `set mgb.rerun_superseded = 'on';`
  runs first; then re-run `staff-handbook-3-kinds.sql` after them.
- **Draft approval (2026-10-19, spec Part L, `supabase/staff-handbook-4-approvals.sql`, run after
  `staff-handbook-3-kinds.sql`; checks in `staff-handbook-4-approvals-tests.sql`):** a draft is
  published only once the policy approver (`handbook_settings.policy_approver_email`, default
  bailley@mygoodbooks.org, changed with `hb_set_policy_approver` by the Co-CEOs only, see part 5) has approved its
  exact latest version and hash (`hb_approve_policy`, `hb_request_changes`; approver only,
  audited). Triggers reset a draft to `pending` on new text or a title, section or kind change.
  The approver gets a Today row, the tab badge, a **Needs your approval** panel and one batched
  `handbook_approval_needed` email (at most one per 30 minutes; the count is read at send time).
  Published policies are `not_required`. Deploy the `notification-emails` function first, then
  this file. Re-run it after any re-run of parts 1 to 3 or of a file that restates the outbox
  kind checks. Seed: `staff-handbook-4-seed-handbook-drafts.sql` (Employee Handbook chapters
  1 to 9 as reference drafts; run once, after part 4; never publishes or creates signatures).
- **Approver tweaks (2026-10-20, spec Part L "Approver tweaks",
  `supabase/staff-handbook-5-approver-tweaks.sql`, run after part 4; checks in
  `staff-handbook-5-approver-tweaks-tests.sql`):** only the people on
  `handbook_settings.approver_changers` (seeded once from the HR "Co-CEO" titles: Bailley and
  Jeff; after that a fixed setting changed only by SQL; empty means nobody) can run
  `hb_set_policy_approver`. `hb_approver_access()` tells the UI whether to show **Change**.
  `hb_request_changes` queues one `handbook_changes_requested` email per request to the last
  editor (`hb_last_editor`: latest version author or a later title/section change), never the
  approver, `system` or a non-admin. Settings key `notify.email.handbook_changes`; sender helper
  `notification-emails/handbookChanges.ts` (tests `tests/edge/hb_changes_email.test.mjs`). Deploy
  the function first, then the file, then the front end; re-run it after any re-run of part 4.

### Employee records (added 2026-10-19)

**HR › Employee records** (`#/hr/employees`, `components/hr/`): one admin-only record per staff
member. Database `supabase/staff-hr-records.sql` (checks in `staff-hr-records-tests.sql`):

- **Table** `staff_hr_records`, keyed by staff email: legal name, job title, employment type
  (`w2_employee` / `contractor`), schedule (`full_time` / `part_time`), manager, hire and end dates,
  work location, personal email and phone, address, emergency contact, notes. No pay, government
  IDs or bank details. No table grants at all (admins included) and admin-only RLS as a second lock.
- **RPCs** (real admins only: role `admin` on the staff row and `is_active_staff_admin()`; temporary
  admins are refused): `hr_list_records` (list columns and which fields are filled, never personal
  details; audited `hr.list_viewed` with the row count only), `hr_get_record` (audited `hr.record_viewed`), `hr_save_record` (changed fields only, ""
  clears; audited `hr.record_saved` with field names only; copies a hire date into
  `staff_profiles.start_date`, never clears it).
- **Offboarding:** `offboard_staff` is patched in place to set `end_date` (today, Chicago) when the
  record has none, audited `hr.end_date_set` (field name only). The file ends by checking the live
  `offboard_staff` has the patch and fails (rolling back) if not. `staff-offboarding.sql` stops with
  an error once `staff_hr_records` exists, unless `set mgb.rerun_superseded = 'on';` runs first;
  then re-run `staff-hr-records.sql` after it.
- **Front end:** the tab is `realAdmin` in `NAV_PLACES` (`NAV_visibleTabs` needs `ctx.isRealAdmin`:
  role admin and not in "View as"), and `TP_TeamHub` renders it only for a real admin. The open
  record is component state, never the hash. Guide: `docs/staff-guide/employee-records.md`.

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
  month)** column in `TeamQbo.jsx`), the overview Profitability card and the Clients page's **Hours this month** column
  (everyone assigned, via the narrow `qbo_my_client_hours` RPC in
  `supabase/client-hours-for-bookkeepers.sql`). Near at 80%, over at 100%
  (`OPS_budgetStatus`). Guide: `hours-budget.md`.
- **Reply-time tracker.** `client_reply_times(p_from, p_to)` (`supabase/client-reply-times.sql`,
  security definer, read only): a wait starts at the first client message of an unanswered run in
  a (client, participant) thread and ends at the next non-internal staff message (the replier gets
  the credit); returns median, p90, % within the goal and open waits, overall, per replier and per
  client. Admins get everything; others only their own staff row and clients they can access. The
  goal is 24 calendar hours, a constant in both the RPC (`v_goal`) and `OPS_REPLY_GOAL_HOURS`.
  `components/staff/ReplyTimes.jsx` (`RT_`): the Team tab **Reply times** (admins). The Home KPI tile retired with
  Home on 2026-10-08; Today's Replies waiting tile counts waiting conversations instead. Team tabs
  are declared in `NAV_PLACES` (`StaffNav.jsx`) and rendered by the hub in `TeamPage.jsx`.
  Guide: `reply-times.md`.
- **Time off and coverage.** `staff_time_off` (`supabase/staff-time-off.sql`; RLS: all active staff
  read, people add/edit their own, admins anyone's; no deletes, `cancelled_at` instead; a guard
  trigger stamps `created_by` and keeps a cancel final). `staff_directory()` lists active staff for
  pickers (bookkeepers can't read `staff`). Admin RPCs `coverage_overview(from, to)` (time off in the
  window, each person's clients, the client's backup and `backup_access`) and
  `grant_coverage_access(time_off_id, client_id)` (an approved `staff_client_access_grants` row for
  the backup, expiring the day after the time off ends, America/Chicago).
  `components/staff/Coverage.jsx` (`CV_`): Team › People (Who's out, My clients' backups, My time off), the
  backup picker on the overview (`CV_StaffSelect`; the column is still `backup_bookkeeper_email`) and
  the `CV_OutTag` "Out until" tag (overview Key dates card, Inbox details), and `CV_Handoff` (Tasks Phase 2 S7: hand tasks to backups and back). Emailing client messages
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
  UI: `components/staff/Deadlines.jsx` (`DL_`), Work › Deadlines (`#/work/deadlines`, all staff)
  and Today's deadline rows. **Create task** adds a `staff_reminders` row with `source='deadline'`,
  `source_ref` = item id. Guide: `deadlines.md`.
- **Client health board.** `supabase/client-health.sql` (migration `client_health_board`) adds four
  deductions to `client_health()`: overdue document requests 5 each (max 15), a client waiting over
  24h for a reply 10, over the monthly hours budget 10 (admins only, QuickBooks Time this calendar
  month) and SOP stale (over 180 days) or under half filled 5. The score is clamped to 0-100.
  `client_sop_status()` (staff, `can_access_client`) returns last edit and filled sections; its 7
  section ids are hardcoded and must match `CLIENT_SOP_SECTIONS` in `app.jsx`. UI:
  `components/staff/HealthBoard.jsx` (`HLB_`): `HLB_useDirectory` feeds the Clients page (Health
  column, Needs attention filter) and Today lists red/amber clients in Needs you. The Team health
  grid and the Home card retired 2026-10-08. The local `clientHealthSignal` in `app.jsx` is
  separate and doesn't use these rules. Guide: `client-health.md`.
- **Shout-outs.** `supabase/staff-shoutouts.sql`: `staff_shoutouts` (all active staff read; insert as
  yourself only; authors hide their own, admins any, via `hidden_at`/`hidden_by`; no deletes; a
  guard trigger stamps the author and freezes everything but the hidden flag; hidden rows are
  visible only to the author and admins). UI: `components/staff/Shoutouts.jsx` (`SO_`): Team › People card
  Shout-outs (feed, last 90 days, plus compose) and `SO_ReviewShoutouts` on the manager's review
  form (Appreciation, the review's quarter, read-only, not saved into the review). The recipient
  gets a `shout:` bell item (`TopBar.jsx`; Settings bell toggle "Shout-outs for me"). No email.
  Guide: `shoutouts.md`.
- **SOP freshness.** `supabase/sop-freshness.sql` (run after `client-health.sql`):
  `client_profile.sheet_reviewed_at`/`sheet_reviewed_by`, set only by `mark_sop_reviewed(client)`
  (a trigger keeps direct writes from changing them); `client_sop_status()` now returns
  `last_touched` = later of last section edit and last review, plus `last_edited`,
  `last_reviewed`, `reviewed_by`; the health reason reads "SOP not reviewed in N days". UI:
  `components/staff/SopFreshness.jsx` (`SF_`): "Last reviewed N days ago" + "Mark as still
  accurate" on `ClientSopView`; stale (over 180 days, `OPS_sopFreshness`) SOPs add an "SOP" row
  to Today's Needs you (This week) and the Clients page's Needs attention filter. Guide:
  `client-sops.md`.
- **New-hire onboarding.** `supabase/staff-onboarding.sql`: `staff_onboarding_steps` (admin-edited
  checklist, `guide_slug` links a Staff guide article, retire with `active = false`, no deletes)
  and `staff_onboarding_progress` (one row per person per step; own or admin read/write; a guard
  trigger checks the step and person and stamps `done_at`/`done_by`; reserved step `__dismissed`
  = "Hide this card"). UI: `components/staff/StaffOnboarding.jsx` (`SON_`): HR › Onboarding
  (`SON_ProgressTab`: everyone's own checklist until done or hidden; admins also see each person's
  progress, tick for someone, add/edit/reorder/retire steps). Summary
  logic: `OPS_onboardingSummary`. Guide: `new-hire-onboarding.md`.

### Client side (and staff viewing a client)

- **Client navigation (redesign 2026-10-08, `CLIENT_PLACES` in app.jsx):** the client rail shows
  five places, **Home** (`dashboard`), **Messages**, **Finances** (tabs budget, bank,
  receivables, giving, payroll; reopens the last-used tab, order from Organization tabs),
  **Reports** (tabs Downloads | Board packet, `#/client/<id>/reports/packet`) and **Documents**,
  with **Settings** at the bottom. Tab rows are `NAV_TabRow` in the top bar. Messages has
  Conversation | Requests (`CLIENT_RequestsPanel`, document requests). Home starts with
  `CLIENT_HomeTop` (Needs you list + org card with milestone, plan, See plans). Phones get
  `CLIENT_TabBar` (Home, Messages, Finances, Reports, More → Documents, Settings). Usage logs a
  Finances view as page `finances`, tab `<key>`. `#/client/<id>/home` and `/finances` work.
- **Client ? menu (2026-10-09, `CLIENT_HelpButton` in app.jsx, `.client-help` in styles.css):** a **?**
  in the client's page header, right after the notification bell (clients and staff previewing a
  client user; staff have their own `TB_` **?**). It reuses `TB_useMenu`, `TB_QuestionIcon` and the
  `.tb-icon-btn` / `.tb-panel.tb-menu` styles (TopBar.jsx loads first). Items: **Take the tour**
  (`TOUR_start()`), **Take the Pro tour** (`TOUR_start("pro")`, only when `planShownKey(plan)` is
  below Pro), **Message your bookkeeper** (only with the `messages` tab), **Help and settings**
  (`openClientSettings("help")`) and **Contact support** (`CLIENT_SUPPORT_MAILTO`). Staff previewing
  get "Preview the tour" labels. Clicks are tracked as `MGB_track("client-help", tour | pro-tour |
  messages | help | support)` for real clients only ("Client ? menu clicks" in Usage stats). It has
  `data-tour="client-help"`: the client tour's last step (`done`) points at it and stays on the
  current page. On phones the sync pill says just "Synced 5 minutes ago" (`.live-sync-short`), and the
  grey not-yet-connected pill just "Setting up" (`unsyncedPillShortLabel`), so the bell, ? and
  search fit.
- **Basic** lands on Home too: Needs you, the org card, then "Home at a glance"
  (`components/client/BasicHome.jsx`, logic in `basicHomeLogic.js`): a page-wide drop-and-sort upload (drop
  anywhere, then pick Bank statement / Credit card statement / Receipts / Invoices and bills / Tax documents
  / Something else; it calls `DRV_upload` with `visibility: "shared"` and the button's document type, the same
  drive-files path as Documents), the latest bookkeeper message, links to Reports and Documents, and one slim
  Pro row. Board packet shows the `CLIENT_LockedCard` on Basic.
- **Settings** (gear at the bottom of the client sidebar; staff get **Client setup** at the right end
  of their tab row; `#/client/<id>/settings[/<tab>]`):
  Profile, Notifications (bookkeeper messages, reports ready, monthly summary), Organization
  (full-access users: team list and org settings via `client_org_team` /
  `client_update_org_settings`, others can request access), Plan (the old Plans page;
  `#/client/<id>/plan`, `plans` and `enterprise-upgrade` still work), Appearance, Security
  (sign out on all devices) and Help. Staff viewing a client get **Client setup** instead (page key
  stays `client-settings`; hash `#/client/<id>/settings[/client|plan|milestone]`, alias `setup`):
  sub-tabs Access and details, Plan and (non-admins only) Milestone. Preview as is read-only.
- **Your account manager** and **Your bookkeeper** cards at the bottom of the Dashboard
  (`AM_TeamRow` in Settings.jsx: `AM_AccountManagerCard` via RPC `client_team_profiles`,
  `ST_BookkeeperCard` via `bookkeeper_public_profile`), each with a Message button. They are
  Dashboard widgets (`team-account-manager`, `team-bookkeeper`); one card when the same person is
  both. The account manager (`clients.account_manager_email`, `supabase/account-manager.sql`,
  default Jesse) is the only one emailed when the client messages; staff can loop in the
  bookkeeper (`client_message_loop_in`) or @mention them. Staff replies on the client Messages
  page show the author's name and title.
- **Milestone and plan:** on Home's organization card (milestone opens the Milestone page,
  **See plans** opens Settings › Plan). They left the sidebar in the 2026-10-08 redesign.
- **Dashboard** (customizable widgets and saved views). A Pro, full-access client gets
  **Financial Overview** here instead.
  - **Customize** opens a right-side drawer (360px wide, full-width sheet on phones; Esc, X or
    a click outside closes it). **Add widgets** lists hidden widgets as cards with a skeleton
    preview, and **+** appends one and flashes it on the board. **On your dashboard** lists what is
    showing, with up/down, drag, and remove. The footer has saved views and **Reset to default**.
    While the drawer is open the board is in edit mode: each card gets an outline, a drag handle
    and a remove button. The same drawer serves the Financial Overview.
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
- **Pro tools** show inline on the same tabs:
  - Financial Overview (Home): cash, receivables, payables and net income this month, a
    low-cash warning (threshold saved in that browser only), a collections queue that opens an
    email draft, and a one-click PDF snapshot.
  - Budgeting Tool: forecasts, what-if scenarios, variance notes and next year's draft, sent for
    approval.
  - Cash Flow Pro: open bills, aging, duplicate-bill checks (same vendor, same amount) and a
    planning list for paying bills with a balance forecast, exported as a CSV. Nothing is paid
    from the portal.
  - Board packet (Reports › Board packet, the one report builder; see "Pro board reports" below)
  - Reconciliation Pro: a read-only reconciliation view for each account and a downloadable
    reconciliation PDF.
  - Fund Accounting Pro: fund balances and contributions, including **Tax Documents**:
    year-end giving statements, downloadable per donor and year. A "Sent" flag is saved only in
    that browser (`mygoodbooks_tax_docs_sent_v1`), and the app asks for confirmation before
    resending. Nothing is emailed.
- **Notifications from the bookkeeper:** a bell in the page header (clients, and staff
  previewing as a client, with the ? menu just after it) with an unseen count, a "From your bookkeeper" panel, and a pop-up
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
- **Pro board reports** (`components/pro/ProReports.jsx`, `ProReportsSuite`), the one report builder
  (the old `ReportBuilderPage`, its Quick Download grid and Custom Report were removed 2026-10-09).
  Clients get it as **Reports › Board packet** on Pro (Basic sees the locked card; **Downloads** keeps
  the canned statement PDFs from `ReportsPage`, five with the payroll add-on). Staff on a Pro client's Reports page get one page: the
  Downloads grid, then the suite ("Board reports"). `showsReportBuilder` is the Pro gate; the page
  header is `PAGE_META["report-builder"]` ("Download statements and build your board packet"):
  - A board packet PDF with a cover, contents, the sections you pick and the comparison columns
    you pick.
  - **Presentation view** (`PrPresentation`, a button in `PrPacketPanel`): the packet full screen for
    a board meeting. A `role="dialog"` layer portalled to `<body>` (so `#root` goes inert and the
    staff tips stay quiet), org name and period on top, then the ticked sections, Esc or **Exit
    presentation** to close. Type is trimmed on phones (org name 26px, section titles 20px) and
    zoomed 1.12x to 1.45x from 900px up; print rules in `pro-reports.css`. The button is disabled
    until at least one section other than the cover is ticked.
  - Saved templates.
  - Comparisons: vs. budget, prior month, same month last year, and YTD vs. last YTD. When there
    isn't enough history it says so.
  - A Statement of Functional Expenses using the Form 990 columns, with an editable
    category-to-function map.
  - Giving detail: top and lapsed donors, giving by fund, and pledge progress. Only once giving
    data is connected (QuickBooks-connected orgs see "Giving isn't connected yet").
  - An editable "what happened this month" summary.
  - Read-only share links (7/30/90 days, can be turned off). They open at `/?share=<token>`
    without signing in, through `get_report_share`.
  - The church's logo and color on PDFs.
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
    client view. Admins have a Milestone tab in the client row; everyone else (temporary admins too) opens it at **Client setup › Milestone**. Today has a **Milestones to review** card (Also show).
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
  - QuickBooks keys are chosen per connection: test clients (`test_only`) use the Intuit sandbox
    pair, real clients and the firm (Team › QuickBooks Time) use the production pair. Secrets:
    `QBO_PRODUCTION_CLIENT_ID`, `QBO_PRODUCTION_CLIENT_SECRET`, `QBO_SANDBOX_CLIENT_ID`,
    `QBO_SANDBOX_CLIENT_SECRET` (sandbox pair optional; falls back to the legacy `QBO_CLIENT_ID` /
    `QBO_CLIENT_SECRET`). `QBO_ENV` is retired. Migration: `supabase/qbo-env-per-connection.sql`
    (+ `-tests.sql`), NOT APPLIED until the owner runs it.
  - Other secrets (`QBO_TOKEN_ENCRYPTION_KEY`, the service role key, and so on)
    are set only in Supabase.
  - `qbo-sync`, `qbo-callback`, `qbo-refresh-token` and `qbo-firm-sync` run with `verify_jwt`
    off and check the caller themselves.
  - `invite-client-user`, `staff-auth` and `qbo-connect-start` run with `verify_jwt` on.
  - `staff-auth` (2026-10-15): deploy with `npx supabase@latest functions deploy staff-auth
    --project-ref xumsqmhccgfjnlmieqyu` (no `--no-verify-jwt`; bundles `./logic.ts`). No new
    secret. Apply `supabase/staff-auth-repair.sql` first, or the page's missing-account card stays
    hidden and `repair` returns 503 (`ensure` still works).
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
- **Tasks module** (`supabase/tasks-module-v1.sql`, applied to production as migration
  `tasks_module_v1`, version `20261011154437`). Re-runnable and additive.
  - Security fix `tasks_module_v1_fix_1`, version `20261011212246`, lives in the same file
    (`tasks-module-v1.sql`, "fix 1" notes): a direct API insert into `staff_reminders` is staff-only,
    putting a task on a client (insert, or changing its client) needs `can_access_client()` unless
    the caller is an admin, and `tk_can_edit_task` and `tk_attachments_before_write` check
    `is_active_staff()` first (`tk_can_upload_task_file` goes through `tk_can_edit_task`), so a
    non-staff owner can't edit, attach, upload or set status.
  - New columns on `staff_reminders` (status, description, start date, section, sort key,
    `parent_id`, SOP section, review, assignee, `deleted_at` and more) and new tables
    `tk_projects`, `tk_project_members`, `tk_followers`, `tk_comments`, `tk_activity`,
    `tk_attachments`, all with RLS and exact grants. Seeds the SOPs, 90 Day, Directors and Owners
    projects. Adds the private `task-files` storage bucket and puts the tables in
    `supabase_realtime`.
  - Functions include `tk_set_status`, `tk_search`, `tk_add_follower`, `tk_client_people`,
    `tk_assignable_staff`, `tk_can_read_task` / `tk_can_edit_task` and `tk_schema_version`.
  - A `BEFORE DELETE` trigger turns a signed-in delete on `staff_reminders` into a soft delete,
    so even an old copy of the app hides rather than erases. Readers (`client_health`,
    `digest_weekly_data`, `staff_performance`, `offboard_staff_preview`,
    `complete_staff_item`, `notify_enqueue_task_assigned`) were recreated to skip deleted rows.
  - The file's header has the deploy-window note: the `notification-emails` and `client-emails`
    edge functions must also skip `deleted_at` rows.
- **Tasks Phase 2, S1 calendar** (`supabase/tasks-p2-1-calendar.sql`, applied 2026-10-15; spec
  `docs/tasks-phase2-spec.md` C1). Re-runnable and additive. Run it after `tasks-module-v1.sql`
  (which would otherwise set `tk_schema_version()` back to 1; S1 makes it 2).
  - `tk_holidays` (day, name, `firm_closed`): staff read, admins add or edit, no delete (set
    `firm_closed` false). Seeded with US Federal Reserve bank holidays 2026-2028 plus Good Friday,
    the day after Thanksgiving and Christmas Eve. Nothing past 2028 yet: add the next year's
    days before then, or business-day math treats them as working days.
  - Functions: `tk_is_business_day` (SECURITY DEFINER so every caller sees the same holidays),
    `tk_add_business_days` (n may be negative), `tk_business_day_of_month` (n = -1 is the last),
    `tk_roll` (next/prev/none), `tk_due_rule_valid`, `tk_resolve_due` (rule types `offset`,
    `business_day`, `day_of_month`, `eom`, `nth_weekday`, `weekday`) and `tk_period_start_for`
    (calendar quarters; `year` = fiscal year from an `MM-DD` year end).
  - JS mirror `components/tasks/TK_recurrenceLogic.js` (exposed as `window.TK_recurrence`; it
    keeps `TK_logic.js`'s weekend-only `TK_isBusinessDay` / `TK_addBusinessDays` globals for
    quick add). Both run the same fixtures: `node components/tasks/TK_recurrenceLogic.test.js`
    and `select * from tk_recurrence_selftest()` (admin; returns failures only, so 0 rows = pass).
    After editing the fixtures, `node components/tasks/TK_recurrenceLogic.test.js --sql` prints
    the seed and values to paste into the SQL file.
- **Tasks Phase 2, S2 period sign-off** (`supabase/tasks-p2-2-periods.sql`, applied 2026-10-15;
  spec C2 and F). Re-runnable; run it after S1 (`tk_schema_version()` becomes 3). Tests:
  `supabase/tasks-p2-2-periods-tests.sql` (one transaction, rolls back; needs no real data).
  - `month_close` gets `period_kind` (`month`/`quarter`/`year`, default `month`) and its primary
    key is now `(client_id, period_kind, period)`; a copy of the old rows is in
    `month_close_p2_backup` (admins read). **Every reader and writer must filter
    `period_kind = 'month'`** (done in CloseTracker, ClientClosePage, Today, Onboarding,
    ClientTabCounts, app.jsx, `client-emails`, `qbo-gl-review` and the SQL files that read it).
    Quarters are calendar quarters (Jan/Apr/Jul/Oct); a year row starts on the client's fiscal
    year start (`client_profile.fiscal_year_end`).
  - New columns: `signed_off_by/at`, `reopened_by/at/reason`, `reviewer_email`, `ready_at`.
    Status `review` now means **Ready for sign-off**; `ready_at` is stamped the first time a
    period reaches review or done, and `staff_performance` counts on-time from it.
  - **Only an admin sign-off makes a period Done.** `tk_sign_off_period(client, kind, period,
    note, ack_open, expected_updated_at)` (admins; open shared tasks linked to the period return
    `needs_ack` and never block; 40001 when someone saved first) and `tk_reopen_period(client,
    kind, period, reason)` (admins; 3-500 character reason). `month_close_signoff_guard` stops any
    signed-in user from moving a period into or out of Done any other way (the RPCs set the
    transaction flag `mgb.tk_signoff`). `tk_period_summary` and `tk_period_start` are staff reads.
  - The reports-ready email (`notify_enqueue_reports_ready`) is month-only and skips a person who
    got it for the same month in the last 7 days. Quarter and year sign-offs never email clients.
  - Non-admins can't change a client's fiscal year end once a year row exists.
- **Tasks Phase 2, S3 review loop and on-time** (`supabase/tasks-p2-3-review.sql`, applied
  2026-10-15; spec C3 and B). Re-runnable; run it after S2 (`tk_schema_version()` becomes 4).
  Tests: `supabase/tasks-p2-3-review-tests.sql` (one transaction, rolls back) and
  `node components/tasks/TK_reviewLogic.test.js` (the same on-time cases in JS).
  - `staff_reminders` gets `reviewer_email`, `send_back_count`, `ready_at` (first entry to review),
    `submitted_by/at` (latest), `approved_by/at`, `due_date_original` and
    `waiting_before_due_minutes`; `tk_tasks` exposes them. `client_profile.reviewer_email` (an
    active admin) is the client's reviewer.
  - **Only `tk_approve` moves a task from review to Done** (flag `mgb.tk_approve`), for admins too;
    `tk_send_back` needs a 3-2000 character reason (saved as a `send_back` comment);
    `tk_withdraw_review` and any other move out of review log `review_withdrawn`. Nobody approves
    work they did or submitted (`tk_self_review`), the assignee is locked while in review
    (`tk_in_review`), and writes to the server-owned review columns raise `tk_server_owned`.
    Reviewer: the client's reviewer, else its account manager if an admin, else (an admin's own
    work) the Team Reviews default reviewer, else any admin. `tk_set_reviewer` is admin-only.
  - **On time** (`tk_on_time_stats`, owner decision 8): finished or approved by the end of
    `due_date_original` in America/Chicago plus `waiting_before_due_minutes` (client-wait time that
    began before the deadline). Only template tasks or tasks someone else made, never `asana` or
    `access_request` sources; open late tasks count as late. `tk_review_stats` gives approvals,
    first passes, send-backs and hours in review. `TK_reviewLogic.js` mirrors the rule; keep them
    in step.
  - `tk_settings` (+ `tk_settings_audit`): owner-only keys change only for
    `internal_access.is_owner` (or with `mgb.tk_owner_override` from SQL, audited).
  - Emails: `staff_task_review_ready` (a task enters review, or a month enters Ready for sign-off),
    `staff_task_sent_back`, `staff_task_mention`. `tk__enqueue` skips a kind the outbox CHECK
    doesn't allow yet: deploy `notification-emails` first, then run
    `supabase/tasks-p2-3b-review-email-kinds.sql` to widen the lists.
  - UI: the drawer's review strip (`data-tour="tk-review-strip"`), the queue at `#/tasks/review`
    (`TK_ReviewQueue.jsx`) and the sidebar **Review** item with the admin's count
    (`TK_reviewQueueCount`).
- **Tasks Phase 2, S4 recurring engine** (`supabase/tasks-p2-4-recurring.sql` plus
  `supabase/tasks-p2-4-hotfix-trigger-helpers.sql`, applied 2026-10-15; spec C4, D, H, J, K).
  Re-runnable; run it after S3 and after `task-templates.sql` (`tk_schema_version()` becomes 5).
  Tests: `supabase/tasks-p2-4-recurring-tests.sql` (one transaction, rolls back) and
  `node components/tasks/TK_templateLogic.test.js`.
  - `task_templates` gains `status` (`draft`/`active`/`retired`, new rows are drafts),
    `due_rule`, `assignee_role`, `review_required`, `period_basis`, `template_set_id`,
    `close_key`, `activated_at` and friends; cadence adds `weekly`. **Writes only through RPCs**
    (`tk_save_template`, `tk_set_template_status`; admins, never temporary admins); nothing is
    deleted, retire instead. New tables (RLS on): `tk_template_sets`,
    `tk_client_template_overrides` (`tk_set_client_override`; staff who can reach the client,
    only admins can turn review off), `tk_generator_runs` and `tk_generate_missed`
    (`tk_issue_missed`, `tk_dismiss_missed`).
  - **Generator** `tk_generate()` (pg_cron `task-templates-daily`, 10:15 UTC, plain SQL, no
    secret; admins call it from "Make due tasks now"; the old `tt_generate_now` and
    `tt_generate_template_tasks` are thin wrappers). Only templates that are
    on, only periods from `activated_at` on, one task per client per period (unique key). A
    period whose due date is more than 7 days ago when first reached goes to
    `tk_generate_missed` instead (owner Q7). Generated tasks don't email on creation.
    `tk_generate_preview(client, days, template)` is a dry run (admin for firm-wide or one
    template; staff for one client).
  - **Standard close set** ("MGB Standard Monthly Close", six draft templates): even when on, it
    only reaches test clients until the owner-only `tk_settings` key `standard_set_live` is true
    (not seeded; missing = off; owner switch on Tasks › Recurring).
  - UI: `TK_Templates.jsx`, the Recurring tag on rows and in details (`tk-meta-recurring`,
    `tk-dw-recurring`), and `components/staff/TaskTemplates.jsx` is now only the Save-as-template
    helpers plus a redirect.
- **Tasks Phase 2, S5 Ask client** (`supabase/tasks-p2-5-requests.sql`, applied 2026-10-16; spec S5
  and critique B1-B4, M1, M9, M12, M13). Re-runnable; run it after S4 (`tk_schema_version()`
  becomes 6). Tests: `supabase/tasks-p2-5-requests-tests.sql` (one transaction, rolls back) and
  `node components/tasks/TK_requestLogic.test.js`.
  - Tables (RLS on, revoke all, **writes only through RPCs**): `client_requests` (one row per ask;
    `client_doc_requests` rows are copied in with the same ids as `legacy_doc_request` and kept in
    step by a mirror trigger; `client_doc_requests` stays writable until S6), `client_contacts`
    (people without a portal sign-in; `tk_save_client_contact`, `tk_retire_client_contact`),
    `tk_request_tokens` (answer links: **sha256 hash only**, one request each, expiring
    (`token_ttl_days`, default 14), revocable, at most 5 live per person),
    `tk_request_token_events` (append-only access log) and `tk_rate_buckets` (rate limits).
    `client_files.client_request_id` links uploads.
  - Staff RPCs: `tk_request_recipients`, `tk_ask_client` (sets the task to Waiting on client),
    `tk_client_request_send` (preview/send/resend/nudge; **always a dry run in S5**, logs a
    skipped row), `tk_cancel_client_request`, `tk_accept_client_request`,
    `tk_record_client_answer`, `tk_revoke_request_tokens`, `tk_set_request_nudge_paused`,
    `tk_list_client_requests`, `tk_waiting_on_client`. Client portal: `client_requests_for_client`,
    `tk_answer_client_request`, `tk_attach_request_file`. Service-role only (for the S6 token
    endpoint): `tk_issue_request_token`, `tk_token_lookup`, `tk_answer_request_by_token`,
    `tk_stop_nudges_by_token`, `tk_rate_hit`, `tk_log_token_event`.
  - A **nudge** adds a link and keeps earlier ones; a **resend** replaces that person's link
    (M9). `tk_ask_client` never writes `client_doc_requests`, so the doc chaser never sees an Ask
    client request (B1). `client_reply` comments are
    written under `mgb.tk_request` (B2). Real sending stays off: the owner-only
    `client_email_settings.client_request_enabled` (the owner flips it on Settings › Firm
    settings › Emails, Client emails card) plus `tk_settings.client_request_pilot`
    decide it, and only the S6 edge function will send.
  - UI: `TK_requestLogic.js`, `TK_AskClientModal.jsx` (the drawer's **Client requests** section,
    `data-tour="tk-ask-client"`, and the Ask client window), `TK_WaitingList.jsx`
    (`#/tasks/waiting`, sidebar item `tk-waiting-nav`) and `tk-requests.css`.
- **Tasks Phase 2, S6 Clients answer** (`supabase/tasks-p2-6-tokens.sql`, applied 2026-10-16; spec S6
  and critique M8, M13). Re-runnable; run it after S5 (`tk_schema_version()` becomes 7). Tests:
  `supabase/tasks-p2-6-tokens-tests.sql` (one transaction, rolls back),
  `node --test tests/edge/*.test.mjs` (incl. `tk_request_respond`, `tk_client_requests`, `resend_webhook`,
  `respond_page`) and `node supabase/functions/drive-files/logic.test.mjs`.
  - **Review fixes (2026-10-16d)**: the global invalid-token breaker only sheds load and alerts
    (`logic.ts` `resolveToken`); a valid token is never refused by it, only by its own network's
    `ip` / `ipbad` limits. **Stop reminders** (`tk_stop_nudges_by_token`) is per person: it pauses
    every open request on that client that lists the link's contact or address, and works after
    the link was used, expired or replaced (not after a staff revoke or a retired contact). An
    answer with no note needs a file this link's own person uploaded. `drive-files` refuses an
    upload whose extension and Content-Type disagree. `resend-webhook/logic.ts` drops clicked
    links and redacts `t=` values before saving to `email_events`; keep Resend **click tracking
    off** for the sending domain.
  - `client_doc_requests` is **read-only to the browser**: staff writes go through
    `tk_add_doc_request` / `tk_set_doc_request_status` (app.jsx `staffToolsApi`), which keep
    `client_requests` in step. Readers are unchanged.
  - **Edge functions** (shared code in `supabase/functions/_shared/tk_requests.ts` and `drive.ts`):
    `tk-client-requests` (staff, **verify_jwt on**: preview, send, resend, nudge; the RPC decides
    off / dry_run / test / live, a test client sends one **[Test]** copy to the caller) and
    `tk-request-respond` (public, **verify_jwt off**: `POST ?action=view|upload|answer|stop_nudges`,
    token only in the `X-MGB-Token` header, stored as sha256 only, CORS app.mygoodbooks.org only,
    token and size checked before the body is read, one file per upload call, rate-limited).
    `client-emails` sends the automatic reminders (cron `client-request-nudge`, `tk_nudge_plan`), and
    `drive-files` takes portal uploads to a request (`visibility: "request"`). Nothing sends to a
    real client until the owner turns on `client_email_settings.client_request_enabled` (Settings ›
    Firm settings › Emails, **Ask client emails live**) and lists the client in
    `tk_settings.client_request_pilot`.
  - **Deploy order**: `tk-request-respond` (`--no-verify-jwt`), `tk-client-requests`, `drive-files`
    (`--no-verify-jwt`), `client-emails` (`--no-verify-jwt`). No new secrets.
  - **/respond** (`respond.html`, `respond.js`, `respond.css`; `vercel.json` rewrite plus an
    enforced CSP, `Referrer-Policy: no-referrer`, `noindex`, `no-store`): the contact's answer page.
    The token is read from the `#t=` fragment and wiped from the address bar before any request;
    everything is rendered with `textContent`.
  - **Client portal**: `components/client/ClientNeeds.jsx` + `client-needs.css` (Messages ›
    Requests, "What we need from you"; `client_requests_for_client`, realtime on
    `client_requests`, `tk_answer_client_request`; `data-tour="client-needs-page"`). Deep link
    `#/client/<id>/needs[/<request id>]`; an emailed portal link is
    `/login?next=%23%2Fclient%2F<id>%2Fneeds%2F<id>`, allow-listed and kept across sign-in in
    `localStorage` `mgb_login_next_v1` (30 minutes).
- **Tasks Phase 2, S7 time-off hand-off** (`supabase/tasks-p2-7-ooo.sql`, applied 2026-10-16; spec
  C7, H, K and critique M1, M2, m13, m14, Q5). Re-runnable; run it after S6 (`tk_schema_version()`
  becomes 8). Tests: `supabase/tasks-p2-7-ooo-tests.sql` (one transaction, rolls back) and
  `node components/tasks/TK_coverageLogic.test.js`. Guide: `out-of-office-handoff.md`.
  - **Tables** (RLS on, no browser access; read through the RPCs): `tk_ooo_reassignments` (one
    row per task moved for a time off: from, to, reason, `returned_at` / `return_skipped_reason`)
    and `tk_ooo_runs` (each apply or return run, with its moves and skips).
  - **Rules**: on a hand-off, open tasks (To do, In progress, Waiting on client) assigned to
    the person and **due inside the window** go to `client_profile.backup_bookkeeper_email`. Ready
    for review, private, internal and after-window tasks stay. Skips: `no_backup`, `self`,
    `backup_away` (the backup is out on the due date), `no_access` (cron and non-admin runs only
    file an access request; an admin hand-off grants temporary access for the window, M1).
    Moving is a bypass via `mgb.tk_ooo` (M2), so admin sign-off is unchanged. A task changed by
    hand while out is not taken back; a task in review comes back once reviewed.
  - **RPCs**: `tk_apply_ooo(time_off_id, dry_run, overrides)` (owner or admin; admins can pick a
    cover per client), `tk_return_ooo(time_off_id)`, `tk_my_coverage()` (rows where I'm the owner
    or the backup, admins see all; ids and names only, no task titles). Cancelling or
    shortening a time off hands tasks back (`tk_staff_time_off_after_update` trigger).
  - **Patched**: `staff_reminders_before_write` (bypass), `notify_enqueue_task_assigned` (no
    per-task email for an OOO move), `tk__issue_period` (a generated task due while its assignee
    is out goes to the backup) and `complete_staff_item` (a covered repeating task rolls forward
    to the backup inside the window, else to the owner).
  - **Cron `tk-ooo-daily`** (`0 11 * * *`, `tk_ooo_daily()`): returns ended or cancelled windows
    (and retries rows waiting on review in running ones). It applies windows that start today or
    earlier only when the `tk_settings` key `ooo_auto_apply` is `true` (seeded `false`; a missing
    row also means off). Returns always run. Summaries use the existing `staff_task_batch` outbox kind,
    one per person, staff only, following the `task_batch` preference and email dry-run.
  - **UI**: `TK_coverageLogic.js` (preview groups, skip copy, labels), `CV_Handoff` in
    `components/staff/Coverage.jsx` (**Hand my tasks to backups** / **Hand off tasks**, **Hand back
    now**), the **Covering for** chip in `TK_Drawer.jsx` and on Today. Tour targets
    `cv-my-timeoff`, `cv-coverage`; launch notice `ooo-handoff`. No edge function changes.
  - **Review fixes** (`supabase/tasks-p2-9-ooo-fixes.sql`, applied 2026-10-16, schema version
    stays 9; tests added to `tasks-p2-7-ooo-tests.sql` sections 11-16): `ooo_auto_apply` off by
    default; only open ledger rows (`returned_at` null) block a move, and a manual re-apply reopens
    the returned row (the cron never re-takes a handed-back task); a denied access request is not
    re-filed for the same time off; `tk_ooo_runs` logs cron runs only when something moved or is
    left over (manual runs always log); a running window no longer hands tasks back by due date
    (a task whose due date moves past the last day off stays with the backup until the end); a
    window moved later that hasn't started under its new dates hands everything back (email:
    "Time off changed"), and one already started keeps the partial return.
- **Staff profile photos** (`supabase/staff-photo.sql`, re-runnable; see "Staff profile photos"
  under Main features). `staff_photo_versions` and `staff_photo_exemptions` (RLS, no direct writes),
  the `sp_*` RPCs, the `staff_profiles_guard` change (`photo_path` moves only through RPCs), the
  `staff-avatars` bucket limit raised to 5 MB with the staff update and delete policies dropped,
  the onboarding step `profile-photo` and a backfill for staff who already have a photo.
- **Tasks Phase 2, S8 Asana import tooling** (`supabase/tasks-p2-8-asana-import.sql`, applied
  2026-10-16; `tk_schema_version()` becomes 9). One-time import of **open** Asana tasks. **Dry run
  only: the apply is switched off and has not been run.** Tests:
  `supabase/tasks-p2-8-asana-import-tests.sql` (one transaction, rolls back) and
  `node scripts/asana-import/asanaImportPlan.test.js`.
  - **Planner** (`scripts/asana-import/asanaImportPlan.js`, pure): classifies projects (client,
    onboarding, internal, the New Client Onboarding tracker, templates skipped), merges duplicate
    projects (newest wins), maps Asana users to staff by email (unmapped and unassigned go to the
    fallback, holden@), flattens subtasks to one level and lists date anomalies.
    `scripts/asana-import/buildDryRun.js <snapshotDir> <outDir> [--redacted-md <path>]
    [--stage-json <path>]` writes the plan and report. Snapshots and full reports have names and
    emails, so they stay in a scratchpad; the committed `docs/asana-import-dry-run-report.md` is
    redacted (first names, no emails).
  - **Tables** (RLS on, admin read, no direct writes): `tk_import_runs`, `tk_import_plan_rows`,
    `tk_asana_import_map` (one row per Asana gid, so a gid is never imported twice).
  - **RPCs** (admin only): `tk_import_asana_stage(snapshot_at, report, rows)`,
    `tk_import_asana_apply(run_id, 'IMPORT <first 8 of run id>', fallback_email)` (refused unless
    the `tk_settings` key `asana_import_apply_enabled` is `true`) and
    `tk_import_asana_undo(run_id, 'UNDO <first 8>')` (soft-deletes tasks, archives projects,
    retires templates). Imported rows carry `source = 'asana'`; templates arrive as inactive drafts.
  - **No emails**: `notify_enqueue_task_assigned` skips `mgb.tk_import = 'on'` and any
    `source = 'asana'` insert. Activity rows show `asana-import` as the actor.
- **Tasks Phase 2, S8b unassigned tasks + Asana import v2** (`supabase/tasks-p2-10-asana-import-v2.sql`,
  applied 2026-10-16; `tk_schema_version()` = 10; tests `tasks-p2-10-asana-import-v2-tests.sql`).
  The import apply is still switched off. No email from any of it.
  - `staff_reminders.is_unassigned` (generated, `assignee_email is null`), in `tk_tasks` and
    `TK_TASK_COLS`. The front end keeps a null assignee (`TK_normalizeTask`, `TK_assigneeOf`,
    `TK_isUnassigned`); "who is on it" reads the assignee only. Review safety checks (self-review,
    review role, default reviewer) still fall back to the owner on purpose; stats do not (below).
  - `tk_claim_task(id)`: the only way a non-admin sets the assignee on an unassigned task (the
    trigger pins it otherwise). UI: **Claim** on rows (`TK_vUnassignedClaim`) and in the drawer.
  - Templates: `assignee_email` + `leave_unassigned` (`tk_save_template`); the editor's **Assign
    to** is a role, a named person, or Leave unassigned; the list shows who and a **From Asana** tag.
  - Admins: `tk_import_no_team_clients()` (sidebar **No team yet**) and
    `tk_import_assign_team(client, email)` (**Assign team** in `TK_ClientHeader`; sets the
    bookkeeper, joins projects, makes them owner of parked unassigned tasks, which stay claimable).
  - Review fixes (`supabase/tasks-p2-11-s8b-review-fixes.sql`, applied 2026-10-16; schema stays 10;
    tests `tasks-p2-11-s8b-review-fixes-tests.sql`, rolled back). Unassigned tasks count for nobody:
    `staff_performance`, `digest_weekly_data`, `tk_on_time_stats`, `tk_review_stats` read
    `assignee_email` only (no `coalesce` with `staff_email`). Time off (`tk__ooo_apply`,
    `tk__ooo_return`) moves and returns only tasks assigned to the person who is out. The default
    reviewer skips the owner of an unassigned task. `complete_staff_item` keeps the next copy of an
    unassigned series unassigned. `tk_import_assign_team` only takes real (not test) clients that
    have imported (`source = 'asana'`) tasks. The planner's first-name remap never beats an active
    email match and only applies when one Asana user has that first name.
- **Slate, change a client's bookkeeper** (2026-10-22; spec `docs/slate-change-bookkeeper.md`;
  `supabase/slate-change-bookkeeper.sql`, applied; schema version unchanged; self-test
  `slate-change-bookkeeper-tests.sql`, rolled back). Admins click the **Bookkeeper** chip in
  `TK_ClientHeader` (others see the plain chip). `tk_change_bookkeeper(client, email, move_open_tasks)`
  updates `clients.assigned_bookkeeper_email` (the existing triggers refresh the display JSON and grant
  access; the old bookkeeper keeps theirs), adds the new one to live projects, and with the box ticked
  moves the old bookkeeper's open shared tasks on that client that are on them or on nobody (not in
  review, private, done, or anyone else's), under the `mgb.offboarding` and `mgb.tk_import` guards, so
  no email. Refuses non-admins (`tk_forbidden`), inactive staff (`tk_bad_assignee`), MGB (internal) or a
  missing client (`tk_not_found`), no bookkeeper yet (`tk_no_team`, use Assign team) and the same person
  (`tk_same_bookkeeper`). One `client.bookkeeper_changed` audit row (labeled in the Audit log); the access trigger also writes `client_access.assigned` when the new bookkeeper had no access before.
  JS: `TK_api.changeBookkeeper`; wording in `TK_bookkeeperLogic.js` (node test
  `TK_bookkeeperLogic.test.js`). Guide: `supabase/staff-guide-change-bookkeeper.sql`.
- **Tasks Phase 3, Manage projects + Group by client** (2026-10-16; `supabase/tasks-p3-manage-projects.sql`,
  applied; schema stays 10; self-test `tasks-p3-manage-projects-tests.sql`, rolled back). Owner decisions:
  no teams yet; "delete" is trash only (restorable, never purged). No feature switch, no edge function.
  - **Server:** `tk_projects.trashed_at / trashed_by / trash_expired_at`, `staff_reminders.trashed_with_project`.
    A RESTRICTIVE policy hides trashed projects. Trash reuses `staff_reminders.deleted_at` for the
    project's tasks (tagged `trashed_with_project`), so every reader, digest and performance function
    already honors it; nothing was redeployed. Restore revives only the tasks the trash hid. Triggers
    block forged trash columns and new live tasks in a trashed project (`tk_project_trashed`). The
    unique project name ignores trashed rows (`tk_projects_name_uniq_v2`).
  - **RPCs** (SECURITY DEFINER, audit rows `tk_project.*`): `tk_project_rename`, `tk_project_archive`,
    `tk_project_trash` (refused with `tk_has_open_requests` while a live task has an open or answered
    Ask client request), `tk_project_restore` (after 30 days only an admin), and admin-only
    `tk_admin_list_projects()`. The 30-day expiry only marks (`trash_expired_at`, lazily when the list
    is read, audit `tk_project.trash_expired`); there is no purge and no cron.
  - **UI:** `TK_ManageProjects.jsx` at `#/tasks/manage` (sidebar **Manage projects** for full admins,
    `data-tour` `tk-manage-nav` / `tk-manage-head`; temporary admins don't see it). **Move to trash**
    is also in the project header's options menu (owners and admins). Pure logic in `TK_viewLogic.js`
    (`TK_manage*`, `TK_groupByClient`, `TK_flattenMyGroups`, `TK_normalizeGroupBy`), tested in
    `TK_viewLogic.test.js`; API wrappers `adminListProjects`, `renameProject`, `setProjectArchived`,
    `trashProject`, `restoreProject` in `TK_api.js`.
  - **Group by Due date | Client** on My Tasks, and **Default | Client** on a person's list
    (`data-tour` `tk-groupby`): clients A to Z, then **No client**, then test, then internal
    (`CF_flag`). Remembered per signed-in person in `localStorage` `mgb_tk_groupby_v1:<email>`
    (cleared by Developer Tools › Reset local state).
  - **Review fixes** (`supabase/tasks-p3-manage-projects-fixes.sql`, applied; same self-test file): a task
    trashed with its project can no longer be undeleted or moved to another project by a direct UPDATE
    (`tk_task_in_trash`, outside the trash/restore RPCs; other columns still change so offboarding and
    hand-offs don't abort); `tk_project_task_counts(project)` feeds the owner's Move to trash confirm
    (open, done, other people's); the Move to trash toast has an **Undo** (toast actions: the
    `mgb:toast` event and `showToast(text, {label, onClick})` in `app.jsx`) that calls the restore
    RPC, which lets the owner back in; restore into a taken name is `tk_restore_name_taken`;
    `tk_import_asana_apply` / `tk_import_assign_team` skip trashed projects. A person's list keeps its
    own Group by choice in `mgb_tk_groupby_v1:person:<email>` (`TK_groupByKey`).
  - **Slate view bar** (2026-10-21, `MGB_VERSION` `2026-10-21b`, not preview-gated; spec
    `docs/slate-rhythm-slice-0.md`): `TK_SlateViewBar` in `TK_MyTasks.jsx` replaces My Tasks' Group by switch
    with **Group by** Due date | Client | 4/14/24th | Status, **Sort** chips (Due, Priority, Status, Name;
    asc, desc, off, sorting inside each group), quick chips **Mine today** and **Waiting on client**
    (`status = 'waiting_client'`), and **Reset view**. Pure logic in `TK_viewLogic.js`
    (`TK_slateBuildView`, `TK_normalizeSlateView`, `TK_slateApplyChip`, `TK_rhythmPartOf`,
    `TK_groupByPart`, `TK_groupByStatus`, `TK_slateSortWithin`), tested in `TK_viewLogic.test.js`; the
    default view is exactly `TK_myGroupsView`. Saved per person in `mgb_tk_slate_view_v1:<email>` (falls
    back to `mgb_tk_groupby_v1:<email>`, which is still written for Due date and Client). 4/14/24th uses
    the task's `section`, else its template's section (ready for slice 3), else **No part**. The Desk Slate tab
    (`WB_HubTasks.jsx`) shows the same bar (`data-tour` `wb-slate-view`) saved in
    `mgb_tk_slate_view_v1:desk:<email>`; its tab count always uses the default grouping, and
    `WB_hubTaskGroups(view, cap, {anyKey})` lets non-due groups through. The person list switch is unchanged.
    Launch notice and tour: `slate-view-bar` in `announcements.js` (targets `tk-groupby`, `tk-slate-chips`,
    `tk-slate-sort`).
  - Known gaps: a project owner who isn't an admin can trash from the project header (and Undo from the
    toast) but can't see or restore it afterward (Manage projects is admin only); `tk_can_see_project` still resolves for
    admins on a trashed project (its tasks stay hidden).
  - Upkeep: launch announcement `tasks-manage-projects`, What's new, guide article `manage-projects`
    (admin) plus `task-lists-and-projects`, `my-tasks`, `admin-guide`, Admin tour stop
    `tasks-manage`, tips `tk-groupby` and `tk-manage-nav`, `?` Help for this page maps
    `#/tasks/manage` to `manage-projects`, Usage Stats label `Tasks › Manage projects`, INFRA_LINKS
    "Supabase SQL (Tasks manage projects)".
  - **Subtasks open in place** (client-side only; no new table). Every Tasks list calls
    `TK_vUseSubtasks(viewTasks)` (`TK_TaskRow.jsx`), which reads one firm-wide batch of subtasks
    (`api.listSubtasks`, store list key `subtasks`, realtime through `TK_stMatches`), merges them with the
    view's own tasks and returns `kidsOf / isOpen / toggle`. `TK_subNestGroups` (in `TK_viewLogic.js`)
    nests kids under their parent inside the same group only; a kid whose parent is in another group
    keeps its own row. Row body click toggles on a parent, the title opens the drawer, ArrowRight/Left
    work (`TK_subRowClickAction`, `TK_subKeyAction`). Open state in `localStorage` `mgb_tk_subs_open_v1`
    (cleared by Developer Tools › Reset local state). `data-tour` `tk-subtoggle`. Wired in My Tasks, `TK_List`,
    `TK_ClientDrawer`; not nested in the drawer's own list, Waiting on client, Review or search.
  - **Project colors** (`supabase/tasks-p3-project-colors.sql`, applied; self-test
    `supabase/tasks-p3-project-colors-tests.sql`, rolls back). `tk_projects.color` is one of ten keys
    (blue, teal, green, amber, coral, pink, purple, navy, olive, gray), NOT NULL with a check; the same list
    is `TK_PROJECT_COLORS` in `TK_viewLogic.js` and a node test fails if they drift. Existing projects were
    backfilled round robin by age; a new project gets the least-used live color. Changes go only through
    `tk_project_set_color` (admin or project manager; refused on a trashed project; audit action
    `tk_project.color_set`); a guard trigger `tk_projects_color_guard` ignores a direct UPDATE.
    `tk_admin_list_projects()` also returns `color`. UI: `TK_vProjectDot` (sidebar, list header with
    `data-tour` `tk-project-dot`, task chip), Project options › Change color (`TK_vColorModal`), and a Color
    button in Manage projects. Tokens `--tk-pc-<key>` in `tk-views.css` (light plus both dark blocks).
  - Upkeep: launch announcement `tasks-subtasks-colors`, What's new, guide articles `my-tasks`,
    `task-lists-and-projects`, `manage-projects`, Tasks tour stop `tk-subtasks`, tips `tk-subtoggle` and
    `tk-project-dot`, INFRA_LINKS "Supabase SQL (Tasks project colors)".
  - **Quick add reads plain words** (Phase 4 P4-1, client-side only; no SQL). `TK_parseQuickAdd(input, opts)` in
    `TK_logic.js` works on positioned words plus a list of taken spans. Symbols (`@name #client !high`, dates)
    parse as before. Plain words, on by default, are off with `{ plain: false }` (the inline add box in
    `TK_List.jsx` passes that, because it has no preview): `for` / `to` / `assign to` + first or full name
    (`for me` / `@me` use `opts.me`, the user's email), `for` / `re` / `client` / a dash + a client name at the
    end of the line (or before a colon when the line opens with it; whole-word prefix of the client slug, 4
    characters minimum), `by` / `due` / `on` + a date, `the 15th` (after by/due/on or last; a day the month lacks
    is not guessed) and `end of month`. A name that fits two people, a person and a client, or two clients is
    never picked: it stays in the title and the result carries `suggestions` (each option has its own span).
    `opts.ignore` holds keys from `TK_qaIgnoreKey(kind, raw)`; the chip x adds one, so those words stay in the
    title. If picking everything would leave an empty title the line is re-parsed with `plain: false`. Plain
    tokens carry `plain: true`. `TK_QuickAdd.jsx` shows the `Will add` line (`TK_qaWillAdd`) and `Did you mean`
    buttons; tests are the `pw:` group in `TK_logic.test.js`. Usage Stats event `tasks-quick-add-plain`.
  - Upkeep (P4-1): launch announcement `tasks-quick-add-plain-words`, tip `tk-quick-plain` on the `+` button,
    What's new, guide articles `quick-actions` and `my-tasks`.
  - **Close checklist linked to tasks** (Phase 4 P4-2; Phase 2 items 14.1 + 14.2;
    `supabase/tasks-p4-2-close-checklist.sql`, applied; self-test `tasks-p4-2-close-checklist-tests.sql`, rolled
    back). Per-client opt-in `tk_client_close_optin` (off by default; soft off via `disabled_at`), written only by
    `tk_set_close_optin` (admin or that client's account manager) and read by `tk_close_optin_status` (enabled,
    first close month `starts`, `can_edit`, `set_live`, `overlaps` = active non-set templates reaching the client
    that look like month-end work). `tk__generate` now checks the standard-set gate inside the client loop, so the
    five linked set members (`bank_feed`, `bank_rec`, `card_rec`, `entries`, `review`; now active, `sent` stays a
    draft) reach an opted-in client while `standard_set_live` stays off; period floor = the opt-in month's next
    month (or that month with `include_current_month`), and earlier periods are never logged as missed.
    `staff_reminders.close_key` is stamped from the template on insert (cleared on move or for subtasks; unique
    live task per client/period/key, `uq_close_task`). `tk_close_tick(client, 'YYYY-MM', key, done)` is the only
    writer of a linked item (guard trigger raises `tk_use_close_tick` otherwise; the sync runs with `mgb.tk_close`
    set and reset) and returns `{status, linked_task_id, task_status, done, message}`; a plain AFTER UPDATE trigger
    on `staff_reminders` ticks the item from the task status (an `of status` trigger misses `complete_staff_item`)
    and logs activity `close_checklist`. UI: `CloseChecklistCard` (app.jsx) shows the task chip (assignee +
    status, opens the drawer) and the 14.2 *Looks done* line (`close_checks`: bank_feed <- bank_active +
    uncategorized, bank_rec <- reconciled; never auto-ticks), drawer link back `TK_dwCloseLink`, toggle
    `TK_tplCloseOptin` on Tasks › Recurring › One client, activation warning in `askStatus`. Logic in
    `TK_templateLogic.js` (`TK_close*`), API `TK_api.closeTick/closeLinks/closeLinkForTask/closeChecks/
    closeOptinStatus/setCloseOptin/closeOptinClients`. Usage Stats `tasks-close-tick`, `tasks-close-optin`.
  - Upkeep (P4-2): launch announcement `close-checklist-tasks` with a stop on the Close steps card, tip
    `tk-close-optin`, guide article `close-checklist-tasks` (and `client-close`, `month-end-close`,
    `task-templates`), What's new, Dev Tools count of opted-in clients and INFRA_LINKS entry.
  - **Late-task grace period** (owner rule 2026-10-17: no late-task penalties for bookkeepers until the full
    Slate rollout, probably next quarter; `supabase/tasks-grace-period.sql`, applied as migration
    `tasks_grace_period`; self-test `tasks-grace-period-tests.sql`, rolled back). Two owner-only `tk_settings`
    keys: `late_tasks_count_against_staff` (default false = grace period on) and `late_tasks_effective_from`
    (stamped to today by `tk_set_late_tasks_count(true)`, so the imported backlog never counts). While off,
    `staff_performance` drops task rows (the Tasks input is filings on time only, or left out and the rest
    re-weighted), `client_health` has no overdue factor, `tk_on_time_stats` is empty, `digest_weekly_data` has
    no overdue count (`late_counts_on` false; `weekly-admin-digest` hides the figure) and the Team Overdue
    columns, tiles and CSV columns are hidden (`TK_useLateCounts`). Filing deadlines are not tasks and always
    count. Own-task lists and badges are unchanged (a reminder, not a penalty). Settings › Firm settings ›
    Late tasks card; launch notice `late-task-grace`; guide `staff-settings`, `performance`, `client-health`,
    `team-page`, `capacity`, `weekly-digest`, What's new; Dev Tools Slate switches rows.
  - **Bulk actions + undo log** (Phase 4 P4-3; spec 2.3, critique B2/M2/M3;
    `supabase/tasks-p4-3-bulk-undo.sql`, applied as migration `tasks_p4_3_bulk_undo`, `tk_schema_version` 12;
    self-test `tasks-p4-3-bulk-undo-tests.sql`, rolled back). Table `tk_undo_ops` (RLS on, no policies, no
    grants; 10-minute expiry; each bulk call deletes the caller's own rows older than 1 day). SECURITY DEFINER
    RPCs (search_path public, no anon execute): `tk_bulk_complete`, `tk_bulk_reopen`, `tk_bulk_delete`,
    `tk_bulk_update` (exactly one of `assignee_email` / `project_id` / `due_date` / `due_shift_days`) and
    `tk_undo(op)`. Up to 100 ids; each row runs in its own exception block and every skipped row comes back
    with a reason code (mapped to words by `TK_bulkReasonText`). Complete never approves: `ready_for_review`
    and `waiting_client` rows are skipped, review-required rows go to review. Undo is the same person, once,
    within 10 minutes (the UI offers it for 10 s); a row changed since is skipped (`changed_since`), an
    untouched roll-forward copy is soft-deleted, unsent assignment emails are marked skipped and sent ones are
    named. `notify_enqueue_task_assigned` stays quiet under `mgb.tk_bulk`, `mgb.tk_rollforward` and
    `mgb.tk_undo`. Client: `TK_api.bulkReady()` (probe ok and version >= 12), `bulkRun(kind, ids, patch)`,
    `offerUndo` / `liveUndo` / `undoLive`; a plain tick (to do / in progress -> done, done -> reopen), the
    drawer's delete and reassign go through the same RPCs so they get Undo (waiting and review ticks keep the
    old path). Selection helpers `TK_sel*`, `TK_bulkCounts`, `TK_skipGroups`, `TK_bulkDuePatch`,
    `TK_bulkSummary`, `TK_undoSummary`, `TK_isUndoKey` in `TK_viewLogic.js`; `TK_BulkBar.jsx`
    (`TK_useBulkSelect` + the bar, `data-tour="tk-bulkbar"`) on My Tasks and `TK_List.jsx`; row check box
    `data-tour="tk-select"` in `TK_TaskRow.jsx`; keys `v` / Shift+V (range), Esc clears, Ctrl/Cmd+Z undoes
    while the toast shows (`TK_vBindUndoKey`); toasts take `action` + `key` and `mgb:toast-dismiss`. Tests in
    `TK_viewLogic.test.js`, `TK_logic.test.js`, `TK_store.test.js`. Usage Stats `tasks-bulk-<kind>`,
    `tasks-undo-key`, `tasks-undo-click` (the toast's Undo button).
  - Review fixes (P4-3), migration `tasks_p4_3_review_fixes` (same SQL file; `tk__bulk_entry` + `tk_undo`):
    undoing a reassign also drops the follower row the reassign added for the new assignee (an older row,
    the owner and the person it went back to keep theirs); undoing a due date a non-admin set first puts
    `due_date_original` back too (written under `mgb.tk_migrate`); the "already emailed" names also count
    `staff_task_review_ready`. Client: the selection only keeps rows on screen (`TK_selOnList`, pruned
    against the focus order), so collapsed or hidden rows are never acted on; the 100-task cap notice is
    raised outside the state updater; any `[aria-modal="true"]` layer pauses list keys (since Desk D3 the
    docked Desk is not aria-modal, so page list keys and **q** work with focus on the page while it is
    open; keys with focus inside it stay with the Desk through `data-tk-keyscope="drawer"`, and the
    phone sheet is still aria-modal);
    Ctrl/Cmd+Z still undoes from a check box or radio; the row check boxes show while a tour step or tip is
    up. Deferred: an email sent in the gap after undo (needs a `notification-emails` change), the
    roll-forward copy showing in Trash after undo, a project-membership check on bulk reassign, and the
    `tk__bulk_record` race.
  - Upkeep (P4-3): launch announcement `tasks-bulk-undo` (3 steps), tip `tk-select`, guide article
    `select-many-tasks` (and `my-tasks`, `tips`, `whats-new`), Dev Tools INFRA_LINKS entry and PAGE_META.
- **Workbench (Tasks Phase 3), 2026-10-16** (`supabase/workbench-1-core.sql`, applied; self-test
  `workbench-1-core-tests.sql`, rolled back; spec `docs/workbench-phase3-spec.md` with "Build notes
  2026-10-16"). Off until the owner sets `tk_settings.wb_enabled` to true; no code sets it.
  - **Server:** tables `wb_item_state` (per-person snooze), `wb_thread_noreply` (firm-wide No reply
    needed on a client thread) and `client_file_checks` (firm-wide Mark checked on a client upload),
    each revoke-all + RLS + select only, soft-undone. `wb_inbox(p_scope, p_sources, p_include_test)`
    returns facts only (kinds task, task_sent_back, task_review, client_answered, doc_request,
    message, gl_flags, gl_sent_back, gl_approve, gl_answer, doc_upload); Mine includes items you
    cover for someone out; Everyone is admin only. Writes: `wb_snooze`, `wb_unsnooze`,
    `wb_mark_no_reply`, `wb_undo_no_reply`, `wb_mark_file_checked`, `wb_undo_file_checked`
    (SECURITY DEFINER). `wb_schema_version()` = 1. `client_messages` and `staff_reminders` are in
    the realtime publication. Optional settings `wb_gl_due_bday` (default 10) and
    `wb_doc_check_from` (default 2026-10-16). No email, no outbox kind, no edge function.
  - **UI:** `TD_TodayPage` renders `WB_Page` in place of its tiles and Needs you list when on (the
    old body is the fallback while `wb_inbox` isn't live, and always under View as). `WB_Drawer` is
    mounted in `app.jsx` for signed-in staff (not View as, not previewing, not the `/tasks` shell).
    The rail's Today item gets `WB_NavBadge` (Overdue + Today) and its label/hint/help follow the
    switch (`NAV_wbOn` in `StaffNav.jsx`). Inbox's thread header has **No reply needed**
    (`data-tour` `si-noreply`) when the client wrote last. New app event `mgb:files-changed`.
  - **Switch, per browser:** Dev Tools flags `mgb_wb_preview` (on for you only) and
    `mgb_wb_classic` (off for you only; wins). Kept by Reset local state.
  - Upkeep: launch announcement `workbench-launch` (waits until it's on for the person), What's new,
    guide article `workbench` plus `home-page`, `inbox`, `admin-guide`, `admin-insight`, tips
    `wb-more` and `wb-noreply`, `data-tour` keys `wb-tiles`, `wb-chips`, `wb-list`, `wb-row-action`,
    `wb-bar`, `si-noreply`, Usage Stats labels `wb-*`, Dev Tools Tasks switches rows, INFRA_LINKS
    "Supabase SQL (Workbench)", MGB_VERSION `2026-10-16p`.
- **Staff sidebar defaults to the icon rail, 2026-10-17f:** `app.jsx` (`loadStaffRailExpanded`,
  `saveStaffRailExpanded`, `STAFF_RAIL_KEY_PREFIX`; `sidebarCollapsed` starts from the per-email key for
  staff and from the old shared key for client portal users), `.staff-rail` in `styles.css` (expanded
  width 220px, was 224px; `.staff-rail-nav` was `flex: 0 1 auto` and `.staff-rail-foot` has a 12px top
  margin (the nav is `flex: 1 1 auto` again since 2026-10-19f); width transition off under `prefers-reduced-motion`). The
  Expand control also shows its tooltip on keyboard focus and has `aria-expanded`. Rail items keep
  `aria-label` plus the caption and tooltip, so no hover-expand overlay was added. `.main` already has no
  max-width, so page content fills the freed width; its 40px gutters are shared with the top bar's
  negative margins and were left alone. Upkeep: launch announcement `rail-default`, guide
  `getting-started` and `whats-new`, `MGB_VERSION` `2026-10-17f`; no new Usage Stats event.
- **One avatar, one settings path in staff chrome (N1), 2026-10-19f** (spec `docs/desk-right-spec.md`
  decision 21): client only, no SQL, no edge functions. `StaffRail` in `app.jsx` no longer renders the
  Settings button, the `.staff-rail-user` name block or the Sign out button; the top bar's avatar menu
  (`TB_AvatarMenu`, `data-tour="tb-avatar"`) is the only desktop path, and the phone drawer is unchanged.
  The rail keeps the places and Expand/Collapse (now `data-tour="staff-rail-collapse"`);
  `.staff-rail-nav` is `flex: 1 1 auto` again so the places take the free height and Expand sits at the
  bottom; dead `.staff-rail-user` CSS removed. Tour: `rail-default` step 3 re-pointed from
  `staff-nav-settings` to `staff-rail-collapse` (text updated; `staff-nav-settings` remains only on the
  phone drawer's Settings row). Upkeep: launch announcement `one-avatar`, guide `getting-started`,
  `staff-settings`, `whats-new`, `MGB_VERSION` `2026-10-19f`; no Usage Stats or Dev Tools label named the
  removed controls, no new event.
- **Desk R1 + R1c: right column, rail and info bar, 2026-10-19g** (spec `docs/desk-right-spec.md`
  §3, decisions 20, 26, 28; client only, no SQL, no edge functions; still off until `wb_enabled`).
  - **Layout:** pure `WB_deskLayout({vw, railW, w, open})` in `WB_logic.js` returns `mode` (`sheet` at
    760px and below, `push` at `WB_DESK_PUSH_MIN` 1100px and up, else `overlay`), the clamped width and
    `occupy`. `WB_Drawer.jsx` writes `--desk-top`, `--desk-w`, `--desk-occupy` (page right padding and
    the top bar's negative right margin, so the top bar stays full width), `--desk-occupy-any` and
    `--desk-cover` on `<html>` plus `wb-desk-side` / `wb-desk-open` / `wb-desk-push` / `wb-desk-overlay`.
    Closed, the 52px rail always takes its room; overlay mode covers the page only with the open column.
  - **Width:** 320-520 (`WB_DESK_W`, default 380), magnets at narrow / standard / wide
    (`WB_deskWidthSnap`, 24px; a right fling or dragging far past narrow closes), keys on the grip
    (`WB_deskWidthStep`: Left wider, Right narrower, PageUp/PageDown stops, Home/End, Enter standard),
    stored per person by `WB_store.setDeskWidth` in `mgb_wb_desk:<email>` as `{v:2, dock:"right",
    right:{w}}`; `WB_deskParse` migrates v1 (height snaps) to the default width. Grip:
    `.wb-desk-handle` `role="separator"` `aria-orientation="vertical"` in `WB_Hub.jsx`.
  - **Rail:** `WB_DeskRail`, `role="toolbar"` with a roving tabindex (Up/Down, Home/End, Enter), four
    counts from `WB_railCounts` (messages, reviews, files, mentions) with `.wb-rail-tip` flyouts on
    hover and focus; the messages icon opens the chat drawer (`mgb:open-chat`), mentions dispatch
    `tb:open-bell` (`TB_Bell` publishes `window.TB_bellMentions` and `tb:bell-mentions`), reviews and
    files open the Inbox on that chip. The foot reuses `TB_QuickAdd` with `variant="rail"`; the top
    bar + stays. `SI_ChatLauncher` is hidden while `WB_useDeskLive` is true (Desk on and not the phone sheet: phones have no rail, so the bubble stays there, lifted above the info bar).
  - **Info bar:** `button.wb-bar.wb-infobar`, 42px, from `--wb-bar-left` to `--desk-occupy-any`: late
    and `N of M today` (`WB_barProgress`, done count from `WB_doneToday` over the Slate store, null
    until a mine list loads), next task, the page client's open / waiting / QBO sync line
    (`WB_barClientLine`, from `useClientTabCounts` and `OV_syncStaleHours`, no new fetch), the
    `D to open/close` hint; `Clean slate` when empty. Click toggles.
  - **Focus:** no scrim and no trap above 760px; Esc and D close to the rail and focus returns to the
    opener, else the rail, else `.main` (`WB_deskReturnFocus`).
  - Removed: D3 height snaps, bar drag-to-open, `--desk-pad`/`--desk-lift`/`--desk-max-w` and their
    tests. Upkeep: launch announcement `desk-right-launch` (bar, rail, grip), tip `desk-width`
    (replaces `desk-resize`), tour targets `wb-rail`, `wb-rail-add`, Usage Stats `wb-rail` and
    relabeled `wb-resize`, guide `workbench`, `home-page`, `tips`, `whats-new`, MGB_VERSION `2026-10-19g`.
- **Desk R2: tasks open in the Desk, 2026-10-19h** (spec `docs/desk-right-spec.md`; client only, no SQL,
  no edge functions; still off until `wb_enabled`).
  - **Router:** `TK_openTask` (`TK_Drawer.jsx`) asks `window.TK_openTaskRoute(id, opts)` first. `WB_Drawer.jsx`
    registers it only while `WB_useDeskLive(mounts, true)` (any mode, sheet included) and the task schema is
    `ok` (pure `WB_deskRoute`); it returns true after `WB_store.drill(id, {from, focus})`, otherwise the
    modal drawer opens as before. `?item=task:` arrivals, Slate, My Tasks, the Desk's tabs, client pages,
    the bell and links all go through it. `TK_store.deskTaskId` (reducer case `deskTask`) marks the row
    (`.tk-row.is-open-in-desk`).
  - **Drill stack:** `WB_store` `drill` `[{id, from, focus}]`, `drillOrigin {closeOnEmpty, tab}`,
    `drill()` / `drillBack()` / `drillClear()`; a closed Desk keeps the stack 5 minutes (`drillClosedAt`).
    `WB_Hub.jsx` shows `div.wb-taskview` (`data-tour="wb-taskview"`, `data-tk-keyscope="drawer"`) with
    `TK_DrawerContent mode="embedded"` in a `.tk-dwc` container (`container: tkdw`; phone rules under
    `@container tkdw (max-width: 480px)` in `tk-drawer.css`) and a Back button (`.wb-back`,
    `data-tour="wb-back"`, label from `WB_drillBackLabel`). The column widens to at least 460px while a task
    shows (`WB_deskTaskWidth`; a drag then is not saved).
  - **Keys:** Esc ladder from `WB_deskEscStep` (layer, picker, field, the content's own Esc via
    `registerEsc`, pop, list, close); a field's own Esc keeps focus in the task view. F6 moves between the
    Desk and `.main` (`WB_deskF6Target`). Rail flyouts hide on Esc (`.wb-rail.is-tips-off`). `WB_go` keeps
    the Desk open in push layout.
  - **Client:** `TK_ClientDrawerHost` asks `window.TK_openClientRoute(clientId, action)` first, so `t` opens
    the Desk's Client tab (and closes it when that tab is already showing). `TK_ClientStrip` is not rendered
    while the Desk is on (`app.jsx` `wbDeskOn`); both come back with the Desk off.
  - Tests: `WB_logic.test.js` (route, Esc ladder, back label, width, F6), `WB_store.test.js` (drill stack),
    `TK_store` deskTask. Upkeep: announcement `desk-task-view`, tour targets `wb-taskview`, `wb-back`,
    Usage Stats `wb-drill`, Settings shortcut text for `t` and F6, guide `workbench`, `task-details`,
    `my-tasks`, `task-lists-and-projects`, `client-tasks-drawer`, `tips`, `whats-new`, MGB_VERSION `2026-10-19h`.
- **Desk R3: the open Desk follows the page, 2026-10-19i** (spec `docs/desk-right-spec.md` decisions 18,
  19, 28 and section 8; client only, no SQL, no edge functions; still off until `wb_enabled`).
  - **Glance strip and Right now:** `WB_Hub.jsx` shows `div.wb-desk-extras` between the head and the tabs
    (hidden in the task view): `WB_HubGlance` (`data-tour="wb-glance"`, the rail's four counts as buttons,
    count > 0 only; messages, reviews and files set the Inbox chip, mentions open the bell) and
    `WB_RightNow` (`data-tour="wb-rightnow"`). The card comes from pure `WB_deskContext(route, ctx)`
    (`WB_logic.js`): on a client page my open tasks (late marked), messages to answer with the oldest
    wait, questions waiting on the client, the month close label, the QuickBooks sync; on `inbox` the
    items waiting and the oldest message; elsewhere null. `WB_Drawer.jsx` builds it from
    `clientCounts` (`useClientTabCounts`) and `pageClient`, no new fetch. The tasks line opens the Client
    tab, the messages line the chat.
  - **Fill rule:** `WB_DESK_ITEMS` + `WB_deskFill({items, prefs, tier, ctx})` (budgets short 1, medium 3,
    tall 6; first items ahead, off and too-tall items skipped) with `WB_deskTier(window height)`. The
    length grip of decision 7 is dropped: the column is full height (decision 26). `prefs` is the R4
    gear's shape; nothing writes it yet.
  - **Closed layout (logic only):** `WB_deskClosedShow(choice, mode)` for the R4 gear's When closed
    (both, rail only, bar only, neither; phones always keep the bar). No UI until R4.
  - **Rail:** flyout lines are `WB_railLine` (who, subject, wait) plus a `+N more` line.
  - **Replaced shortcuts (decision 28, each guarded so the Desk off is the classic app):** `TB_StaffTopBar`
    takes `deskOn` (`wbDeskOn`) and `deskDocked` (`wbDeskLive`). Desk on: the Slate pill is
    `TB_SlateLink` (an `<a>` to `#/tasks/my`, no counts). Docked: no top-bar `TB_QuickAdd` (the rail's +
    has the same menu; phones keep the top-bar +). `TD_TodayPage` passes `deskOn` to `WB_Page`, which
    drops its four `wb-tiles`. `TD_RecentCard` stays until L1 recents ship.
  - Tests: `WB_logic.test.js` (`WB_railLine`, `WB_deskContext`, `WB_deskTier`, `WB_deskFill`,
    `WB_deskClosedShow`), `announcementsLogic.test.js`. Upkeep: announcement `desk-right-now`, tour
    targets `wb-glance`, `wb-rightnow`, `tb-quick` steps and the `tk-quick-plain` tip fall back to
    `wb-rail-add`, the `workbench-launch` tiles step skips while the Desk is on, Usage Stats `wb-glance`,
    `wb-rightnow`, guide `workbench`, `home-page`, `top-bar`, `quick-actions`, `my-tasks`, `task-details`,
    `whats-new`, MGB_VERSION `2026-10-19i`.
  - **Review fixes:** `WB_Drawer` owns the fill (`deskExtras`, passed to `WB_Hub` as `extras`); while the
    Right now card shows a client the info bar drops its page client line (decision 28, one place per
    fact). The card's message count is the larger of the tab counts and the Desk's own message rows for
    that client (`ctx.deskMessages`; the tab counts poll every 2 minutes). The Inbox card shows only the
    oldest wait (the glance strip has the message count). `top-bar.css`: the Slate-link rules no longer
    split the `.tb-icon-btn:hover` selector.
- **Task pane split + field grid (R0/T3), 2026-10-19c** (spec `docs/desk-right-spec.md` §10): client
  only, no SQL, no edge functions. R0: `TK_DrawerContent.jsx` is the task pane body (state, fetch,
  x/s/a/? keys, the delete/send back/keys modals) with `mode` `"drawer"` or `"embedded"`, `scopeRef`
  (the element its keys and `s` lookup belong to), `registerEsc` (the chrome asks it first, so an open
  SOP panel closes before the drawer) and a `frame(inner, after, {label})` render prop so the modal keeps
  the exact same DOM. `TK_Drawer` in `TK_Drawer.jsx` is now only the chrome: portal, layer, scrim,
  `aside[role=dialog]`, focus on open and return, `tk-drawer-open` scroll lock, the capture Esc/Tab trap.
  Static markup was byte-identical before and after for nine task states. T3: a labeled grid at the
  top of the pane (`.tk-dw-grid`, `data-tour="tk-dw-fields"`): Assignee, Due, Client, Project, Priority,
  Status, with faint placeholders when empty. Rows come from `TK_dlFieldGrid` / `TK_DL_GRID_FIELDS`
  (`TK_drawerLogic.js`, node-tested), which also says which are editable (assignee: owner or admin, not
  in review; client and project are links). The same controls and `save` path as before; due saves
  through `TK_rwDuePatch` + `TK_rwDueSavePatch` (a half-typed year is not saved, and a box with one
  part blanked, `validity.badInput`, is not a clear), priority options from
  `TK_RW_PRIORITIES`. Status moved from the title row into the grid. Rows are flex-wrap (label 120px,
  96px on phones; value wraps under it below about 334px), not a container query, so the pane never
  becomes a containing block for fixed menus. "Linked" (spec §17) and a task-size field are comments
  only. Upkeep: launch announcement `tasks-field-grid`, guide `task-details` and `whats-new`, tour
  text and target list, `MGB_VERSION` `2026-10-19c`; no new Usage Stats event.
- **Task rows you can change in place + Add task rows (T1/T2), 2026-10-19b:** client only, no SQL, no
  edge functions. `TK_TaskRow.jsx`: assignee initials avatar (dashed empty circle with an Assign hint),
  due chip (red overdue, amber today, faint calendar when empty), always-visible priority, each opening a
  small menu (`TK_vUseMenu`: Esc, arrows, outside click) that reuses `TK_api.update`, `reassign`
  (when `bulkReady`) and the store's staff list or `TK_api.assignable`; a hover/focus ... menu (Open,
  Mark done, Claim, Copy link). New `editFields={false}` prop (review queue and drawer subtasks stay
  read-only). Pure rules in `TK_rowLogic.js`. `TK_List.jsx` `TK_vAddRow` is now a click-to-open input
  that stays open after Enter and takes the group's due date or client; used at the bottom of Slate groups
  (`TK_MyTasks.jsx`) and the client panel (`TK_ClientDrawer.jsx`). Not shown for Overdue, Waiting,
  Review, Unassigned, Done, No client, or roles that cannot create. `WB_Row.jsx` is its own row and
  unchanged. No helper avatar stack or comment count: that data is not on the row. Upkeep: launch
  announcement `tasks-inline-edit`, guide `my-tasks`, `task-lists-and-projects`,
  `client-tasks-drawer`, `whats-new`, tour and tip text, `MGB_VERSION` `2026-10-19b`; no new Usage
  Stats event.
- **Desk D3: resizable docked Desk, D key, 2026-10-17** (spec `docs/desk-spec.md` §4.1-4.3; client
  only, no SQL, no edge functions; still off until `wb_enabled`).
  - **Modes:** `WB_deskMode(innerWidth)`: above 760px the Desk docks (centered, `--desk-max-w`),
    non-modal: no scrim, no scroll lock, no aria-modal, no focus trap, `role="region"`; the page
    gets `--desk-pad` bottom padding equal to the Desk height. At or below 760px it is the old
    full-height modal sheet (dialog, Tab trap, body scroll lock), with no resize.
  - **Height:** three snap names `strip` (148px, one row plus tabs; `html.wb-desk-strip` hides the
    chips and foot), `medium` (45% of the room above the bar, at least 228) and `tall` (78%, at
    most room minus 16). Room = bar top minus `.tb-bar` bottom. Under 360px all three merge (no
    handle); tall within 100px of medium merges into medium. Only the snap name is stored, in
    `mgb_wb_desk:<email>` (`WB_store.setDeskSnap`, `WB_deskParse` / `WB_deskSerialize`), cleared by
    Reset local state. Height is clamped on every window resize.
  - **Resize:** `.wb-desk-handle` (`role="separator"`, `aria-valuenow` 0-100 of the snaps,
    `aria-valuetext`, `data-tour="wb-desk-handle"`) uses Pointer Events with pointer capture and a
    rAF-painted `--desk-h`; release snaps by position, a fling (>0.6 px/ms) moves one level
    (`WB_deskSnap`); Esc during a drag puts the start height back. Keys on the handle: arrows /
    Page Up / Page Down step, Home strip, End tall (`WB_deskStep`). Dragging up more than 12px on
    the closed bar opens it at the dragged height. No transition with reduced motion.
  - **Keys:** D toggles (`WB_deskToggleKey`: plain d/D, no modifiers; W is gone), skipped while
    typing, under a dialog, menu or tour. Esc acts only with focus inside the Desk, in the order
    layer, client picker, self-clearing field, close (`WB_deskEscStep`; the D4 drill-in steps are
    stubbed). Focus moves to the bar on close only if it was inside the Desk
    (`WB_deskFocusZone` / `WB_deskCloseFocus`). `TK_shouldHandleKey` gains an `embedded` flag
    (unused until D4) so a drawer-scoped list inside the Desk never acts on page-body focus.
  - **Mount:** `WB_deskMounts` (a signed-in staff email with the staff rail showing; never in the
    `/tasks` shell, View as, a client preview or impersonation). Tips stay hidden while it is open (`.wb-panel` in
    `TIPS_BUSY`); `TIPS_pinned`, `TOUR_scrollIntoView` and `TOUR_stickyBottom` know `.wb-panel`.
  - Upkeep: launch announcement `desk-launch` (4 steps, waits for `WB_store.getState().on`), tip
    `desk-resize` (on the bar, computer only), Usage Stats `wb-resize` ("Desk resized (drag or
    keys)", detail `drag:<snap>` / `key:<snap>`) and `wb-drawer` detail `drag`, shortcut sheet,
    guide articles `workbench`, `home-page`, `tips`, `whats-new`, MGB_VERSION `2026-10-17d`.
  - **Review fixes (same day):** the Desk renders inside `.app-shell` (it had been portaled to
    `<body>`, which drew it over modals, top-bar menus and the Undo bar); docked z lowered to 680/690.
    The bar's press ends on pointerup / pointercancel / lost capture anywhere and on Esc mid-drag,
    so a stale press never restarts a drag or swallows a keyboard Enter/Space (`detail` 0). A held D
    (`e.repeat`) toggles once. Esc with focus on the bar closes the phone sheet. `--desk-*` and the
    desk classes come off `<html>` when the Desk switches off or unmounts (queued paint cancelled);
    padding and lift follow the height mid-drag. The open bar is square-topped with the panel's
    background and no top edge, and the docked panel's shadow is clipped at its bottom, so bar and
    panel read as one piece.
- **Asana import ran live, 2026-10-16.** First `supabase/asana-import-roster-clients.sql` (61 roster
  clients), then run `49b3186a`: 1132 tasks (135 subtasks, 176 unassigned, 160 with no client),
  16 projects + 1 merged, 749 recurring templates as drafts (off). `asana_import_apply_enabled` is
  back to false. No emails; Asana was only read. Undo (admin, soft): `select
  public.tk_import_asana_undo('<run id>', 'UNDO 49b3186a');`. Staff notice: `asana-import` in
  `components/tour/announcements.js`; full record at the end of `docs/asana-import-dry-run-report.md`.
- **Staff Handbook** (`supabase/staff-handbook.sql`, applied 2026-10-13). Re-runnable. Four
  `handbook_*` tables with RLS and no direct writes, the `hb_*` RPCs, two new outbox kinds
  (`handbook_sign_needed`, `handbook_countersign_needed`) added to both email check constraints,
  and the v1 seed of `flexible-work-sla`. See "Staff Handbook" under Main features.
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
  `data.js`'s shapes. `node components/tour/announcementsLogic.test.js` checks the launch announcement
  rules and registry. The Tasks module's tests run with
  `for f in components/tasks/*.test.js; do node "$f" || break; done`.
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
- Point Today's "Replies waiting" tile and the Client overview's "threads waiting" at
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

- **2026-10-20:** MGB Desk window (see the `components/workbench/` row). The Desk can open in its own
  pop-up window and be installed as a second app; rows open in the portal tab. Built hidden: nothing
  shows until the owner sets `tk_settings.desk_app_enabled` (SQL) or a person ticks **MGB Desk window
  preview** in Dev Tools. Version label 2026-10-20k. **Retired 2026-10-21** (Slate app S5): the code was
  deleted and the work moved into the Slate app (see **MGB Slate app** under Installable app).
- **2026-10-10:** bookkeeper in-client tabs redesign (see **Client tab row** and **Deep links to
  one item** above). One tab row on every plan, the Close tab, **Client setup** (was the Settings
  gear), Bank and unlimited Sync now for staff on every plan, an Overview that shows only
  bookkeeping work (billing is admin-only), and links that open the exact item. `qbo-sync` skips
  the Sync now throttle for staff and always refreshes the close check on a staff sync.
- **2026-10-08:** Tech Inventory moved into the portal as **Team › Inventory** (see **Inventory**
  above). The Apps Script tool and its passcode are retired once the owner has checked the import.
- **2026-10-08:** staff navigation redesign (the five places, see **Staff navigation** above).
  Deleted `BookkeeperHomePage`, `useHomeMasonry`, `HLB_HealthTab`, `HLB_AtRiskBody`, the top bar
  Overview chip, and the Home / Client view / My Tasks / Close tracker / Deadlines / Reviews /
  Help / Feedback sidebar items. The old routes have no redirects.

The old `HANDOFF2.md`–`HANDOFF7.md`, `HANDOFF-DESIGN.md` and
`client-dashboard-claude-code-prompt.md` were retired on 2026-09-23. They're still in git
history. For example, `git show 3344625:HANDOFF7.md` shows the full running log (§1–§171),
which explains the reasoning behind most of the decisions above.

## Left sidebar

**On for all staff since 2026-10-21** (`nav_enabled`, with `wb_enabled` and `lato_enabled`; the combined notice and tour is the `new-look-and-layout` announcement). There is no Classic opt-out for the sidebar; staff tune it with the gear (Customize).

The staff rail can also list **Pinned** and **Recent** clients (the admin alerts, L2, now ride in the top bell), with a gear to customize it. It is invisible unless on: `SS_navIsOn` (`components/workbench/WB_layout.js`) = `mgb_nav_classic` (launch only, not added yet) wins, else the per-person flag `mgb_nav_preview` (Developer tools > Feature flags > Sidebar preview, reloads) or the firm switch `tk_settings.nav_enabled` (code never writes it; SQL only). Gate reads go through `SS_store` in `components/staff/StaffSidebar.jsx`; the last answer is cached in `mgb_nav_on_cache`.

- Layout profile (pure logic, `WB_layout.js`, tests in `WB_layout.test.js`): person prefs over role default over built-in, merged per field. Person prefs are a diff vs the role default in localStorage `mgb_nav_prefs:<email>` = `{v:1,left:{...}}` (real email, not View as). Role defaults: `tk_settings.layout_defaults` = `{v:1,roles:{admin|am|bookkeeper|tempAdmin:{left:{...}}}}`, edited by admins in Settings > Firm settings > Sidebar defaults (`SS_DefaultsCard`, the only `tk_settings` write). Parsing never throws, 8 KB cap, unknown ids dropped. Width 220-320 (260 cap under 1100px).
- Pins reuse `WB_pins` (max 8, `mgb:wb-pins` event keeps the Desk client view and sidebar in sync); recents reuse `mgb-client-switcher-recent:<email>`. While viewing as someone, the gear and pins are read-only.
- **Alerts (L2, real admins only; moved into the top bell 2026-10-21).** The sidebar has no Alerts section any more: `SS_useBellAlerts` (StaffSidebar.jsx) feeds `TB_Bell` (TopBar.jsx), which shows an "Admin alerts" group at the top of the bell panel and adds the count to the bell badge, only for the real admin while the sidebar preview/switch is on. `SS_AlertsSection` is now unused. The rest below still describes the rules and reads. `components/staff/SS_alerts.js` (pure rules, tests in `SS_alerts.test.js`) turns data the app already reads into at most 5 rows plus "N more": the `qbo_usage_status()` rpc (the old top-bar QuickBooks badge, same wording), open `ops_alert_state` rows (QuickBooks reconnect / sync errors / sync overdue grouped per client and collapsed past 3 clients, the auto-sync cron, email failures, Google Drive upload and connection problems, and any unknown key as a generic row), `client_email_log` errors in the last 24 hours (test clients dropped), and a muted, uncounted "Out today" line from `staff_time_off` (local date, `todayLocal()`). `SS_useAdminAlerts` in `StaffSidebar.jsx` makes the reads in parallel (each fails alone), every 10 minutes while the tab is visible and once on focus after that; it reads nothing unless the viewer is the real signed-in admin (not a temp admin, not "View as", not previewing) with the sidebar preview or switch on. No migration; shares the L1 switch. While the bell has loaded the alerts it sets `SS_store.alertsShown` (event `mgb:ss-alerts`) and `TopBar.jsx` hides `TB_ThrottleBadge`; the badge returns when the sidebar preview is off or the data has not loaded. Usage labels: `nav-alert-open` and `nav-alert-<kind>`.
- When on, Today hides its Recent card. The Desk follows the rail width through its existing ResizeObserver.

## Installable app (staff only, desktop only)

`manifest.webmanifest` + `app-icons/` make the portal installable (Add to Home Screen, Chrome/Edge Install).
The links are added by the first `<script>` in `index.html`, never on phones/tablets (`isMobile()`: iPhone, iPad incl. iPadOS-as-Mac, Android), and otherwise only when `INSTALL_APP_PUBLIC` is true, the page is
already running installed, a tester override is set (`/?install-app=1`, or the Developer tools "Show unreleased
features" flag), or a staff member is signed in: `AuthGate` calls `window.mgbInstallApp.set(true)` after the `staff`
row checks out and `set(false)` on sign-out; `ClientAuthGate` calls `set(false)` for an authorized client. Keep
`INSTALL_APP_PUBLIC = false` until clients' sign-in works inside the installed app (their sign-in email link opens in
the browser, so they'd type the emailed code instead). Staff sign-in inside the installed app: Google link, or type the
work email + emailed code in the first (client) form; `RootGate` then routes the `@mygoodbooks.org` session to `AuthGate`.
`/?install-app=0` no longer hides it for signed-in staff; tester overrides (`/?install-app=1`, the unreleased flag) are never cleared by sign-out. Staff guide article: `get-the-app.md` (desktop Chrome/Edge only; phones use the website). Tip `install-app-desktop` (Today, ring on the ? button) shows only where `mgbInstallApp.canOffer()` is true.

### MGB Slate app (preview, hidden until the owner flips the switch)

Slate as its own installable app at `/slate`, built from spec `spec-desk-fullpage.md` (slices S1 to S7 and P1 to P3; P4 project templates is specced separately). It is Asana-style master task management: deep setup, organizing, projects and views. The portal Desk drawer stays the quick view-and-act side. **Nothing opens the app on its own**: no link or route in the portal redirects to it, and the portal Slate pages (Templates, Manage, bulk, project setup) keep working in the portal exactly as before. It opens only from an explicit **Open Slate app** or **Install Slate app** button (the Slate page header and the Desk's Slate tab). Everything sits behind one helper, `TK_slateAppIsOn`, and with it off behavior is today's. Files: `components/tasks/TK_SlateBridge.jsx` (shell, install, channel), `TK_SlateModes.jsx` (size modes, pane, presets), `TK_SlateSliver.jsx`, `TK_SavedViews.jsx`, `TK_Drag.jsx`, `tk-slate.css`, and pure rules in `TK_viewLogic.js` (tests in `TK_viewLogic.test.js`, `TK_store.test.js`). Its text (guide article, What's new, next-visit notice, tour) is **drafts, not live** in `docs/staff-guide/drafts/` (`staff-guide-slate-app.md`, `whats-new-slate-app.txt`, `tour-slate-app.md`), published by mgb-launch-kit when the owner flips the firm switch. The old window's guide text was fixed in S6 (below).

- **Gating (S1).** Three layers: localStorage `mgb_slate_app_preview` = "1" (Developer tools › Feature flags › **Slate app preview**, this browser only), the owner-only firm switch `tk_settings.slate_app_enabled` (`supabase/owner-only-slate-app.sql`; never set from the app and never set so far; the Slate switches card shows it read-only), and the classic opt-out `mgb_slate_classic` = "1", which wins over both (Developer tools › Feature flags › **Classic tasks page**, added 2026-10-21, this browser only; `TK_slateAppIsOn` is still the one place that decides). `TK_slateFlag` in `TK_store.js` holds the state (`TK_readSlateAppFlag()` reads the setting once and shares the read); the string "on" counts as off. Other pure helpers in `TK_viewLogic.js`: `TK_slateMode`, `TK_SLATE_EDGES`, `TK_slateCurrent`, `TK_slateSizePreset`, `TK_slateDeepHref`, `TK_popOutSize` and `TK_popOutFeatures` (minimum 240 x 180 only when the app is on).
- **Shell, install and bridge (S2).** `/slate` (a Vercel rewrite that keeps the path; `/slate/` redirects to it) is a second installable app with its own `slate.webmanifest` (id, scope and start_url `/slate`). On `/slate` the install script links nothing until the app calls `mgbInstallApp.setSlate(on)` (`TK_slateBoot` in `components/tasks/TK_SlateBridge.jsx`); on it links the Slate manifest, holds the install prompt (`mgb-slate-prompt`, `mgb-slate-installed`, localStorage `mgb_slate_installed_v1`), off it links the portal manifest as everywhere else. The app and portal windows talk over the BroadcastChannel `mgb-slate` (links that leave Tasks, chat, Dock in portal). Icons: `app-icons/slate-icon-192.png`, `slate-icon-512.png`, `slate-icon-maskable-512.png` and `slate-apple-touch-icon.png` (task rows with one gold check on teal `#06262D`, maskable-safe; the manifest theme and background match). Portal links clicked inside the app open in the portal window over the channel (a new tab when no portal answers) and the app stays put. `/desk` and `/desk/` redirect (302) to `/slate`.
- **Size modes and the detail pane (S3).** `TK_SlateModes.jsx` (the CSS contract is at the top of the file): a ResizeObserver on `.tk-app.is-shell` sets `tk-m-<mode>` (sliver under 300 wide or 200 tall, compact, regular from 720, full from 1100, with hysteresis) and `tk-shape-strip` / `tk-shape-column` for the sliver, plus `html.tk-slate-m-<mode>` and `html.tk-slate-wide`. Compact is the phone-style list, read-only for Templates, Manage, Sections and bulk ("Make the window wider to edit", **Full page** button). Full adds a detail pane (`TK_SlatePane`; `TK_DrawerHost` portals the embedded `TK_DrawerContent` into it, one owner of the open task; j/k swap it, Esc clears it). Size presets **Sliver** (360 x 140), **List** (440 x 800) and **Full page** use `resizeTo` / `moveTo` in the pop-up or installed app only, are verified within 4px, and a miss hides them for the session (sessionStorage `mgb_slate_size_miss_v1`). Old `max-width: 760px / 720px` rules in `tk-views.css`, `tk-drawer.css`, `tk-requests.css` and `styles.css` are guarded with `:where(html:not(.tk-slate-wide))`; any new width `@media` rule that can match inside the shell needs the same guard. Usage labels `slate-app-mode` and `slate-app-size`.
- **Sliver (S4).** `TK_SlateSliver.jsx` fills the sliver slot: the current task (`TK_slateCurrent`) with **Start** (`TK_vSetStatus` to in progress, to-do tasks only) and **Done** (`TK_vComplete`, so the review gate, recurring tasks and the report picker apply; Done waits while Start saves; a "Send reports" task grows the window to List size), a 5-second inline Undo (`TK_api.offerUndo`) and the next task. A strip (under 200 tall, one line, dropping due, client and +N as it shrinks, from 18px) or a column. **Expand** applies the List preset. Keys **s**, **x** and **Enter** only while focus is in the sliver. Offline disables the buttons; empty says "Clean slate"; a failed load has Retry. Usage labels `slate-sliver-start`, `slate-sliver-done`.
- **Manual order (P2).** Inside the Slate app only, regular or full width (`TK_manualOrderAllowed` in `TK_viewLogic.js`; never on the portal Slate page, the Desk tab, compact or sliver, offline, while searching, or with a column sort on). A "Manual" chip in `TK_SlateViewBar` (My tasks) and a "Manual order" toolbar toggle (project, client and person lists in `TK_List.jsx`) turn it on per list (localStorage `mgb_tk_manual_v1`, scopes `my` and `list:<key>`; separate from the shared Slate view key). Rows get a grip handle (`TK_TaskRow` `dragHandle` prop); `components/tasks/TK_Drag.jsx` handles pointer drag (drop line, autoscroll, Esc cancels) and Alt+Up / Alt+Down on the focused row, with a polite live-region announcement. Moves stay inside the group, except project lists, where a drop into another section also sets the section (same project only). The order is per person: keys live in table `tk_manual_order` (owner, scope `my` or `list:<listKey>`, task; RLS own rows, read only from the API, at most 2000 rows per person per scope), loaded by `TK_api.manualOrderLoad` and held per scope by `TK_useManualOrder` (`TK_Drag.jsx`). `TK_manualMove` updates that map optimistically and calls RPC `tk_manual_reorder` through `TK_api.manualReorder` (`supabase/tasks-slate-p2-fixes.sql`, self-test `tasks-slate-p2-reorder-tests.sql`): a key between the neighbors, or a renumber (1024 steps) of the group's top through the moved row when keys run out; on an error the map rolls back. Ordering needs read access only; a section change (project lists, same project) still needs the per-task edit check. The shared `staff_reminders.sort_key` is never written, so portal lists are unchanged; the first P2 RPC `tk_reorder` (`supabase/tasks-slate-p2-reorder.sql`), which wrote that shared column, is retired (execute revoked, not dropped). Usage label `tasks-reorder`.
- **Named saved views and bulk Status, Priority, Section (P3).** Inside the Slate app only (`TK_useSlateInApp()`; the portal Slate page and the Desk's Slate tab are unchanged). `TK_SavedViews.jsx` (`TK_SavedViewsMenu`, `data-tour="tk-slate-views"`) adds a Views menu to `TK_SlateViewBar` (passed as the `viewsMenu` prop from `TK_MyTasks.jsx`): many named views per person (table `tk_saved_views`, `supabase/tasks-slate-p3-views-bulk.sql`, RLS own rows only, owner stamped by a trigger, 30 per scope, names 1-60 characters and unique per person without regard to case, "Default" reserved). The older single view (localStorage `mgb_tk_slate_view_v1`) is never migrated or deleted: it shows as the built-in Default, backed by a baseline copy (`mgb_tk_slate_base_v1`) taken before the first named view is applied. `TK_BulkBar.jsx` gains Status, Priority and Section (kinds `set_status`, `set_priority`, `set_section` in `TK_api.bulkRun`, RPC `tk_bulk_set`, one Undo through `tk_undo_fields` and the `tk_field_ops` log): Done goes through the usual Complete path; Section is offered only when every selected task is in one project, from that project's sections; skipped tasks are listed by reason. Pure rules and tests in `TK_viewLogic.js` / `TK_viewLogic.test.js`; self-test `supabase/tasks-slate-p3-tests.sql`. Edit controls carry `tk-p3-edit` and are hidden under `.tk-m-compact` and `.tk-m-sliver` (read-only sizes).
- **Board (P1).** Inside the Slate app only, regular or full width (`TK_boardAllowed` in `TK_viewLogic.js`; never on the portal Slate page, the Desk tab, compact or sliver, and the CSS hides `.tk-board-wrap` and `.tk-board-switch` under `.tk-m-compact` and `.tk-m-sliver` as a second guard). `TK_Board.jsx` (`TK_BoardSwitch`, `TK_useBoardLayout`, `TK_useBoard`; loaded after `TK_Drag.jsx`) adds a List | Board switch (`data-tour="tk-board-switch"`) to My tasks and to project, client and person lists. My tasks and person lists use Status columns (the five statuses in workflow order, with Done folded). Project lists default to Section columns plus "No section", and project and client lists get a "Columns by" Status | Section switch. Columns show counts; cards show title, client, section (status columns on a project), due pill, priority marker, subtask count and assignee. A card click opens the task the same way as a list row. Drag uses `TK_useRowDrag` (new `axis: "x"`, `canDrop` and `onBlocked` options; lists are unchanged). Status drops follow the status pill (`TK_nextStatuses`): Done goes through `TK_vComplete` (review gate and recurring apply), approve through `TK_vSetStatus`, withdraw through `TK_vWithdraw`, and send back is never a drop (it needs a note). A blocked column shows a red outline and the reason is spoken and toasted (`TK_boardDropCheck`, `TK_BOARD_WHY`). On My tasks an Unassigned card is not draggable (claim it first). Section drops use the P2 path (`TK_manualMove`, project sections only). Order inside a column is the person's manual order (`tk_manual_order`) when no column sort is on; otherwise the sort holds (project, client and person boards show a "Clear sort" button then). Keys: cards are focusable; Alt+Left/Right moves a card to the next allowed column, Alt+Up/Down moves it within the column; moves are announced in a live region. Bulk select is off on the board. The layout is remembered per person per list in localStorage `mgb_tk_layout_v1` (only boards are stored; "list" removes the entry). Saved views on My tasks keep `layout: "board"` (`TK_normalizeSlateView`; older views without it open as a list), and the layout is never written to the shared Slate view key. Usage events: `slate-board-open`, `slate-board-move`. No SQL.
- **The retired MGB Desk window (S5).** The Desk in its own window (2026-10-20k, hidden behind `mgb_desk_app_preview` and `tk_settings.desk_app_enabled`, never turned on) was deleted on 2026-10-21: `WB_DeskApp.jsx`, `desk.webmanifest`, the `mgb-desk` channel, its Feature flags row, Slate switches row and tour steps. The useful parts moved into `TK_SlateBridge.jsx`. The Desk itself (right-side column, rail and info bar, D key) is unchanged. Old usage rows `desk-app-*` and the `desk-app` page label stay in Usage stats marked "(retired)".
- **Upkeep (S6, 2026-10-21).** Live guide text for the removed window fixed (`workbench.md`, `get-the-app.md`, `admin-insight.md`; SQL `supabase/staff-guide-slate-s6.sql`, replacing `staff-guide-desk-app.sql`); the tk-popout tour step and tip read "Open Slate app" only while `TK_slateAppOn()` is true. Developer tools: `PAGE_META` `slate-app`, usage labels `slate-app-open`, `slate-app-install`, `slate-app-forward`, `slate-app-size`, `slate-app-mode`, `slate-sliver-start`, `slate-sliver-done`, `tasks-reorder`, the INFRA note for `/slate`, and the Reset local state comment listing the app's keys (`mgb_slate_app_preview`, `mgb_slate_classic`, `mgb_slate_installed_v1`, `mgb_tk_slate_base_v1`, `mgb_tk_manual_v1`, `mgb_tk_layout_v1`, and sessionStorage `mgb_slate_size_miss_v1`).
- **Launch kit (2026-10-21, hidden until the switch).** Everything staff would read about the Slate app is invisible until `tk_settings.slate_app_enabled` is true, and never shows for someone on **Classic tasks page**. (a) The notice and tour: `ANN_REGISTRY` entry `slate-app-launch` (roles admin, tempAdmin, bookkeeper, accountManager; never clients; never during View as or Preview as; the notice also waits for a window wider than 760px). It carries the new optional field **`visible(ctx)`**: unlike `ready`, an entry that is not visible is dropped by `ANN_audience`, so the notice, What's new's Launches list, the **?** menu / Cmd+K tour entry and the Usage Stats Announcements row all stay hidden together. `visible` is `ANN_slateLaunchOn()`: `mgb_slate_classic` is not "1" and `mgb_slate_cache` is "1" (the person's Slate app preview alone does not count). (b) `mgb_slate_cache` is set by the same inline script in `index.html` and the same single `tk_settings` read as `mgb_brand_cache` and `mgb_hovernav_cache` (the query now asks for `brand_enabled`, `hovernav_enabled` and `slate_app_enabled`); only the announcement reads it, the app itself is decided by `TK_slateAppIsOn`. No `supersedes`: the older Slate notices still describe live things. The tour's window-size step (`ann-sizes`) is a centered step in the portal; an in-app `tk-size` step is not possible because the Slate app window hides tours, tips and notices (`tkShell`). (c) The tk-popout tour step and tip already switch to "Open Slate app" through `TK_slateAppOn()`, which includes the switch and Classic, so no code changes at launch. (d) Staff guide text is NOT in the live `staff_guide` table or in `docs/staff-guide/*.md`: it is in `docs/staff-guide/drafts/` and applied at flip time with `supabase/staff-guide-slate-launch.sql` (upserts only, seven articles: `tasks-own-window` replaced by the Slate app article, What's new entry dated by the database, the tips row, `workbench`, `get-the-app`, `client-tasks-drawer`, `admin-insight`). After running it, run `node docs/staff-guide/drafts/slate-launch-patch.mjs --write YYYY-MM-DD` (the same day) and `node docs/staff-guide/sync.mjs --check` in a follow-up commit so the repo matches the table. Not promised in any staff text (deferred): the templates editor in the full pane, board drag on touch screens, and a Done column that shows more than the loaded tasks. Owner flips the switch with: `select set_config('mgb.tk_owner_override','on',true); insert into tk_settings (key,value) values ('slate_app_enabled','true') on conflict (key) do update set value=excluded.value;`.

## Staff guide

The staff guide (`#/help`, opened from the **?** menu in the top bar: Help for this page, Staff
guide, Send feedback, What's new, Tips while you learn, the tours; also from ⌘K) is a searchable how-to guide for
staff. The per-page slugs are `TB_HELP_FOR_PAGE` in `TopBar.jsx` and the `help` field on each
`NAV_PLACES` place and tab in `StaffNav.jsx`, plus `TB_TASKS_HELP` for the Tasks sub-routes (`#/tasks/review` -> task-review and so on); every slug must exist as a file. `whats-new.md` is the
staff-facing changelog: add an entry with every change staff would notice.

**Pushing guide changes live (Desk D1 rule).** Never run `docs/staff-guide/sync.mjs` without `--check`: it is a full sync that deletes rows, and the live guide can drift from the files. Push edited articles one slug at a time with an md5-guarded upsert: `insert into public.staff_guide (...) values (...) on conflict (slug) do update set title=excluded.title, body_md=excluded.body_md, keywords=excluded.keywords, updated_at=now() where md5(public.staff_guide.body_md) = '<md5 of the live body you read first>'`, then check the row count (zero means the live copy changed under you: stop and look). `sync.mjs --check` must still pass.

**Names (Desk D1, 2026-10-17).** People see "Desk" (the bottom panel, `WORKBENCH_NAME`) and "Slate" (the task area, `SLATE_NAME`); do not write "Workbench" or "My Tasks" in anything user-facing. Old announcement history and What's new entries stay as written. Code names, routes, storage keys, database objects and flag names keep the old words.

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
- **Every new product or feature ships with an announcement (required):** add a registry entry in
  `components/tour/announcements.js` with its tour steps in the same commit as the feature, next to
  the guide article and What's new entry above. How to add one:
  1. Append an object to `ANN_REGISTRY` in `components/tour/announcements.js`: `id` (short, lower-case,
     hyphens, never reused), `date` (`YYYY-MM-DD` it ships), `title`, `summary` (one sentence), `roles`
     (any of `admin`, `tempAdmin`, `bookkeeper`, `accountManager`), `hash` (where **Open** goes, such as
     `#/hr/reviews`) and `steps: (ctx) => [...]`.
  2. Write 3 to 6 steps (about a minute). The first is a centered welcome (no `targets`). Build the rest
     with `TOUR_tabStep(place, tab, title, body)` for a Work or Team tab, or a plain step with `go`
     (`TOUR_go(place, tab)` or a hash change), `targets` (`"#element-id"` or a `data-tour` key) and
     `wait: true` when the target loads late. Check each target exists (`grep` for the id or
     `data-tour`) and re-point it if a layout change moves it, as with Tips.
  3. Add the matching What's new entry in `docs/staff-guide/whats-new.md` (the Launches list reads the
     registry, not that file) and run `node docs/staff-guide/sync.mjs --check`.
  4. Run `node components/tour/announcementsLogic.test.js` (it checks unique ids, valid roles, date
     format, 3 to 6 steps and a centered first step), bump `MGB_VERSION` in `index.html`, and commit.
  Nothing else is needed: the notice, the Launches list, the menu entries and the Usage Stats counts
  all come from the entry. Never change an `id` after it ships (the database keys on it).
  A notice that is shown and ignored stays `seen` and returns on every visit until it is answered or
  its 60 days end.
- **Re-sync after editing:** `node docs/staff-guide/sync.mjs --check` validates the files, then
  `node docs/staff-guide/sync.mjs > /tmp/staff-guide-sync.sql` and run that SQL in the Supabase SQL
  editor (or through the Supabase MCP `execute_sql`). It upserts every article and removes rows whose
  file was deleted; it's safe to run again. The UI is `components/staff/StaffGuide.jsx` + `staff-guide.css`.

### Slate month rhythm (preview, hidden)

Slice 1 (2026-10-21, spec `docs/slate-rhythm-slice-1.md`, plan `docs/slate-month-rhythm-build-plan.md`) stores the firm's three monthly dates in `tk_settings.month_rhythm` (`{"parts":[{"key":"check_in","day":4},{"key":"reports","day":14},{"key":"follow_up","day":24}],"roll":"next"}`; days 1 to 28, strictly ascending, roll `next`, `prev` or `none`). No row means that default. Admins edit it on **Settings › Firm settings › Month rhythm** (`ST_MonthRhythmCard` in `components/settings/Settings.jsx`), whatever the switch says; it only stores dates for now. The database refuses a bad value (trigger `tk_settings_check_month_rhythm`, `tk_month_rhythm_problem()`, reader `tk_month_rhythm()`, migration `supabase/slate-rhythm-1-settings.sql` plus `supabase/slate-rhythm-1b-label-parity.sql` (label rule matched to JS; run it after any re-run of the first), self-test `supabase/slate-rhythm-1-settings-tests.sql`); the JS copy of the rules is `components/tasks/TK_rhythmLogic.js` and both run the same vectors (`node components/tasks/TK_rhythmLogic.test.js`). Changes are audited in `tk_settings_audit`. Later slices check one gate, `TK_rhythmEnabled()`: the per-person Feature flag `mgb_rhythm_preview` or the firm switch `tk_settings.month_rhythm_enabled` (owner-only, set in the database). Nothing reads the gate yet, so behavior is unchanged.

Slice 2 (2026-10-21, spec `docs/slate-rhythm-slice-2.md`) adds the due rule type `firm_part`: `{"type":"firm_part","part":"check_in"|"reports"|"follow_up","month_offset":0-12}` (offset optional, default 1). It resolves exactly like `day_of_month` with that part's day and the rhythm's `roll`; the rule carries no day or roll of its own. JS: `TK_dueRuleValid` accepts it and `TK_resolveDue(rule, start, end, holidays, rhythm)` takes the rhythm as a fifth argument (client over firm, merged by the caller); with no rhythm it throws `tk_month_rhythm_missing`, with a bad one `tk_month_rhythm_invalid: <code>`; every other rule type ignores the argument. SQL (`supabase/slate-rhythm-2-firm-part.sql`, self-test `supabase/slate-rhythm-2-firm-part-tests.sql`): `tk_due_rule_valid` accepts it (proved to give the same answer as before for every other input; it backs the `task_templates` CHECK), new `tk_resolve_due(rule, start, end, rhythm)`, the 3-argument form uses the firm rhythm, and `tk__rhythm_for_client(client)` is the one place the generator gets a client's rhythm (the firm value today; the client override plugs in there later). `tk__generate` makes nothing from a `firm_part` template until `month_rhythm_enabled` is on (a single-template preview or a named test client may still try it); with no usable rhythm it skips that client and adds one warning to the run. `tk__issue_period` applies the same gate for every caller (`supabase/slate-rhythm-2b-issue-gate.sql`, self-test `supabase/slate-rhythm-2b-issue-gate-tests.sql`): a real write with the switch off returns `skipped` / `rhythm_off`, no usable rhythm returns `skipped` / `no_rhythm`, so `tk_issue_missed` cannot create one early. Shared vectors: `TK_RECURRENCE_RHYTHM_CASES` and `TK_RECURRENCE_RULE_VECTORS` in `components/tasks/TK_recurrence.fixtures.js` (`node components/tasks/TK_recurrenceLogic.test.js --sql-rhythm` prints the SQL rows). No `firm_part` template exists yet and the template editor does not offer the type.

Slice 3 (2026-10-21, spec `docs/slate-rhythm-slice-3.md`, SQL `supabase/slate-rhythm-3-templates.sql`, self-test `slate-rhythm-3-templates-tests.sql`) seeds the **MGB Month Rhythm** template set: eight monthly `firm_part` templates (month_offset 1), three on Check in, three on Send reports, two on Follow up, each with a description and checklist. New columns: `task_templates.description` (copied onto each task; `tasks.section` gets the part label, which Slate's 4/14/24th grouping reads), `task_templates.email_kind` (`request` on row 2, `reports` on row 6, `maintenance` on row 7; read by the email drafts in a later slice, never sent by the editor) and `tk_template_sets.gate_key` (`standard_set_live` by default, `month_rhythm_enabled` for this set). `tk__generate` gates each set by its own key, so these templates make nothing for real clients until the owner turns on `month_rhythm_enabled`; named test and internal clients get them from **Make due tasks now**. Turning the switch on stamps the set's `live_since`; dates before that day are never made. On **Slate › Recurring** (`TK_Templates.jsx`) the set, its templates and the **A month rhythm date** due rule show only when `TK_rhythmEnabled()` (Month rhythm preview or the switch); with it off the page is unchanged. Pure parts in `TK_templateLogic.js`: `TK_tplRuleTypes`, `TK_tplRuleAllowed`, `TK_tplHideRhythm`, `TK_tplIsRhythmSet`, `TK_dueRuleText(rule, cadence, rhythm)` ("On the Send reports date (14th), next month"), and `TK_tplUpcoming(..., { rhythm })`. Auto-completing rows 7 and 8 when documents arrive is slice 4.

Slice 4 (2026-10-21, spec `docs/slate-rhythm-slice-4.md`). **Late rule (live for everyone, not gated):** a task waiting on the client (`status = waiting_client`), or a month-period task for a client whose reports for that month went out **preliminary**, never counts as late, in on-time stats or in the performance score. SQL `tk_late_excused(status, client_id, period_kind, period_start)` is added to `staff_performance`, `client_health`, `digest_weekly_data` and `tk_on_time_stats` (`supabase/slate-rhythm-4c-late-exclusion.sql`, self-test `slate-rhythm-4c-late-exclusion-tests.sql` proves identical output for every other task on production data). JS copy: `TK_lateExcused` / `TK_taskMonth` / `TK_setReportStates` in `TK_logic.js` (used by `TK_isOverdue`, `TK_groupMyTasks`, Today's overdue count, the Team page and `TK_onTimeOutcome`); `TK_api.loadReportStates()` fills the cache. Quarter, year and no-period tasks are excused only while waiting. **Report state (gated by `TK_rhythmEnabled()`):** table `tk_report_state` (client, month, `none` / `preliminary` / `full`, `missing` items, audit in `tk_report_state_audit`; staff write only through `tk_set_report_state`, clients read only `tk_client_report_state(client)`, which returns month, state and plain labels, never task data; `supabase/slate-rhythm-4-report-state.sql`). Completing a **Send reports** task (row 6) in the task pane opens a Full / Preliminary picker (`TK_dwReportState` in `TK_DrawerContent.jsx`), with the missing list prefilled from the client's open Ask client requests; ticking it done anywhere else (list, Today, Overview) goes through `TK_api.complete`, which opens the task instead (`skipReportPick` is the picker's own pass; node tests in `TK_store.test.js`), and bulk complete asks too (`TK_BulkReportPick` in `TK_BulkBar.jsx`, 2026-10-23); row 8 done sets the month to full. The client Reports page shows `CN_ReportStateCard` (`components/client/ClientNeeds.jsx`) only while a month is preliminary, with links to the matching request. **Daily job** `month-rhythm-daily` (pg_cron 10:40 UTC, `tk_rhythm_daily()`, `supabase/slate-rhythm-4b-daily.sql`): completes rows 7 and 8 with the note "Nothing outstanding" when the client has no open requests, and when row 7 follows a preliminary month marks it "Second month in a row" and notifies the client's account manager (admins if none) in `tk_rhythm_notices` (bell, `TopBar.jsx`, shown only with the gate) plus the `task_batch` email, which sends only with `month_rhythm_enabled` on. Pure helpers in `TK_rhythmLogic.js` (`TK_reportPickerNeeded`, `TK_reportMissingPrefill`, `TK_clientReportBadges` and friends); node test `components/tasks/TK_rhythmSlice4.test.js`.

Slice 5 (2026-10-21, spec `docs/slate-rhythm-slice-5.md`, SQL `supabase/slate-rhythm-5-client-override.sql`, self-test `slate-rhythm-5-client-override-tests.sql`) lets one client have its own three days. Column `client_profile.rhythm` (jsonb, null = the firm rhythm; else `[{"key":"check_in","day":5},{"key":"reports","day":15},{"key":"follow_up","day":25}]`, same day rules as the firm value, checked by `tk_client_rhythm_problem`). Labels and the weekend or holiday roll always come from the firm setting. `tk__rhythm_for_client(client)` now returns `tk_month_rhythm_merge(firm, client)`: the client days over the firm value, the firm value when there is no override, and null (fail closed: the run skips that client with one warning) when either is not valid, so `tk__generate` and `tk__issue_period` pick it up with no other change. Only admins write it: trigger `client_profile_rhythm_guard` refuses any other signed-in person (bookkeepers can still read it; clients have no access to `client_profile`), the RPC is `tk_set_client_rhythm(client_id, parts)` (null clears), and every change lands in `client_rhythm_audit` (admins read). JS: `TK_rhythmForClient(firm, client)` (same merge, shared vectors in `components/tasks/TK_rhythmClient.fixtures.js`, node test `components/tasks/TK_rhythmClient.test.js`), `TK_clientRhythmProblem`, `TK_clientRhythmFromForm`, `TK_clientRhythmSummary`, and `TK_api.clientRhythm` / `TK_api.setClientRhythm`. UI, gated by `TK_rhythmEnabled()`: a **Month rhythm** row on the client Settings tab (**Access and details**, `ST_ClientRhythmRow` in `components/settings/Settings.jsx`) shows "Uses the firm rhythm (4th, 14th, 24th)" or the client days, and admins get Change, Save and Use the firm rhythm; the per-client panel on **Slate › Recurring** uses the merged rhythm for its upcoming dates, rule text and override previews. With the gate off neither shows; with no override saved, the task run output is byte-identical (dry-run md5 before and after the migration).

Rhythm finish (2026-10-23, before-flip item a, doc `docs/slate-rhythm-close-overlap.md`, SQL `supabase/slate-rhythm-4d-close-overlap.sql`, self-test `slate-rhythm-4d-close-overlap-tests.sql`, rolls back). **The month rhythm replaces the close set's task-making:** with `month_rhythm_enabled` on, `tk__generate` skips the standard close set's five step templates (`tk__is_close_task_key`) for any real client the rhythm reaches (`tk__rhythm_covers_client`, internal), whether the set is live or the client is opted in. Named test clients still get both. The Close checklist still works by hand. `tk_close_optin_status` never lists rhythm templates as an overlap and returns `rhythm_replaces`; the opt-in panel shows `TK_closeOptinRhythmText(status)` (`TK_templateLogic.js`). With the switch off every dry run is byte-identical (md5 on four dates in the migration header). The same doc records the saved `roll: "prev"` (owner to confirm before the flip).

Rhythm finish (2026-10-23, before-flip item b): **bulk complete asks Full or Preliminary.** When the bulk bar's Complete (or Status › Done) would finish open Send reports tasks, `TK_api.reportPickTasks(tasks)` finds them (same `TK_rhythmEnabled()` gate and template check as a single completion; feature off resolves `[]` and nothing changes) and the bar opens `TK_BulkReportPick` (`TK_BulkBar.jsx`): one row per client and month, Full or Preliminary, missing items prefilled from that client's open Ask client requests, Set all to Full. Save writes each state with `TK_api.setReportState`, one at a time, then completes every selected task except a row whose save failed (toast). Cancel completes nothing. Pure helpers `TK_bulkReportRows` / `TK_bulkReportProblem` / `TK_bulkReportPlan` / `TK_bulkReportAfter` in `TK_rhythmLogic.js`; node test `components/tasks/TK_rhythmFinish.test.js`. `TK_List` and `TK_MyTasks` pass `clientNames` to the bar.

Rhythm finish (2026-10-23, owner rule everywhere): waiting on a client or a month that went out preliminary never counts as late. SQL on-time stats, the performance score, client health and the digest already excused both (slice 4); the Workbench now does too. `wb_inbox` lists only to-do and in-progress tasks (so waiting never shows) but has no task period, so after a load `WB_store` asks `staff_reminders` for the period of overdue task rows on a client with any preliminary month (`WB_excuseCandidates`), marks the excused ones with `TK_lateExcused` (`WB_applyExcused`), and `WB_groupOf` puts them in Today instead of Overdue: the tiles, nav badge and "N late" all follow. No preliminary month on the list means no extra read. Tests in `components/workbench/WB_logic.test.js`. Hazard noted: re-running `supabase/internal-company-profile.sql` after slice 4c fails on purpose (its anchor text changed); do not re-run it.

Rhythm finish E1/E2 (2026-10-23, email drafts, nothing is sent): the three rhythm tasks whose template has an `email_kind` (check-in = request, Send reports = reports, mid-month follow-up = maintenance) get a "Draft email" button in the task drawer and a small envelope icon on the task row, only with the rhythm preview on (`TK_rhythmEnabled`). Hover or focus shows the subject and first lines; clicking opens an editor (subject, body, Copy subject, Copy email, Start over). There is no send button and no send path: `TK_api.emailDraftData(task, kind)` only reads (clients, client_profile greeting and rhythm, qbo_account_status, the month's qbo_transactions, open client_doc_requests, `tk_list_client_requests`, close_checks, tk_report_state, staff for the signer), each read soft so a failure leaves that part empty with a warning. The pure builder `components/tasks/TK_emailDraft.js` (`TK_emailDraftBuild`) uses the firm's Google Doc wording: Email 1 lists bank and card accounts not reconciled through month end plus open requests, and holding-account transactions as questions (debit vs deposit wording); Email 2 picks Option A or B from the month's report state (else close_checks; else keeps both for the bookkeeper) and lists pending items; Email 3 puts "Still Needed" first only when something is outstanding. Client dates come from the client's rhythm (part day plus one; reply-by five days before reports). Lists stop at 40 with "and N more". The account manager is shown as a suggested CC only. Slate and Desk get an "Emails due" quick chip (mine, open, an email template, due by today), hidden with the rhythm off; a saved chip does nothing once the rhythm is off. Tests in `components/tasks/TK_emailDraft.test.js`.

### Lato font, brand colors and hover menus (firm switches)

`html[data-font="lato"]` (set by the inline script in `index.html`) swaps `--font-heading` and `--font-body` to Lato in `styles.css`; `--font-mono` (IBM Plex Mono, numbers) is unchanged, and `DailyClose.css` follows the switch because it hard-codes its fonts. Gate: `mgb_lato_classic` wins, then the per-person checkbox `mgb_lato_preview` ("Lato font preview" in Feature flags), then the firm switch `tk_settings.lato_enabled` (owner-only via `tk__owner_only_key`, `supabase/owner-only-lato-switch.sql`; cached in `mgb_lato_cache`). Lato is loaded only when on. Owner flipped it on for staff 2026-10-21 (with `wb_enabled` and `nav_enabled`); the combined launch notice and tour is the `new-look-and-layout` announcement.

**Brand colors** (same pattern as Lato, 2026-10-21; owner turns the firm switch on with SQL, code never writes it): `mgb_brand_classic` ("Classic colors" in Feature flags) wins, then the per-person checkbox `mgb_brand_preview` ("Brand colors preview"), then the firm switch `tk_settings.brand_enabled` (cached in `mgb_brand_cache`), else the old look byte for byte. The inline script in `index.html` sets `html[data-brand="mgb"]` and loads Montserrat only then. `styles.css` blends the two: sidebars and the dark top bar stay near-black and fade to dark teal `#06262D` (5463 C) at the bottom, while buttons, headings and dark surfaces use the brand navy `#243746` (Pantone 7546 C); gold `#C7AE86` is unchanged. Headings use Montserrat.

**Hover menus** (2026-10-21): `HN_on()` in `components/staff/HoverNav.jsx` (prefix `HN_`) is the one gate: `mgb_hovernav_classic` ("Classic menus") wins, then `mgb_hovernav_preview` ("Hover menus preview"), then the firm switch `tk_settings.hovernav_enabled`, which the same inline script in `index.html` reads (one query for both brand and hover keys) and caches in `mgb_hovernav_cache`, firing the window event `mgb:hovernav` when it changes so `HN_useFlyout` re-renders and the title tips install without a reload. A document-level listener swaps native `title` tooltips for the themed `.hn-tip`; `HN_useFlyout` opens `.hn-fly`, a flyout of clickable tabs beside a sidebar icon whose place has tabs (staff rail via `NAV_visibleTabs`, client sidebar for Finances). Off means none of it shows.

**Owner-only switches** (`supabase/owner-only-brand-hovernav-switches.sql`, self-test `owner-only-brand-hovernav-switches-tests.sql`, rolls back; applied 2026-10-21): `tk__owner_only_key` now also lists `brand_enabled` and `hovernav_enabled`. Neither row exists, so both are off. To turn one on (owner only, from the SQL editor, in one run, override first): `select set_config('mgb.tk_owner_override', 'on', true); insert into tk_settings (key, value) values ('brand_enabled', 'true') on conflict (key) do update set value = excluded.value;` (same for `hovernav_enabled`; the third argument `true` keeps the override to that transaction). Both appear in Developer tools › Slate switches.
