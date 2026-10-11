# MGB Portal — Tasks Module: Step 0 audit report
Date: 2026-10-10 · Status: **Step 0 deliverable, awaiting the product owner's approval. No code, SQL or migrations were written. Nothing was committed.**
Inputs: `docs/tasks-module-brief.md`, the Claude Docs spec "MGB Portal — Tasks Module Spec", `docs/tasks-prototype.dc.html`, the repo working tree as of 2026-10-10 (read-only), the live Supabase project `xumsqmhccgfjnlmieqyu` (read-only), and the live Asana workspace (read-only).
How to read this file: Part A is the short version for a decision. Part B is the reference the build sessions will work from: every spec feature as a row with evidence, the verifier corrections, the foundation decisions, the data model sketch, conventions, risks and inventories.
Line-number caveat: `app.jsx` cites were taken from a working tree that carries about 3,400 uncommitted lines from the Today/StaffNav redesign, so some `app.jsx` numbers drift by up to about 1,200 lines against `origin/main`. Search by symbol name (for example `MyTasksPage`, `HASH_SUB_ROUTE_PAGES`, `staffItemsApi`). Verifier notes below correct the cites they checked.

## A1. Headline
The portal already contains most of the raw material for the Tasks module, and none of it should be thrown away. The right foundation is to extend `staff_reminders` in place as the task table, keep `task_templates` plus its issued ledger as the recurring engine, keep `month_close` as the period object, fold the two parallel close checklists and the document-request queue into the new module, and build the new screens as `components/tasks/TK_*.jsx` files loaded through `window.__SOURCE_ORDER` like everything else.
Of the 66 audited features (66 rows from the brief plus the spec cross-check), after verification: **2 exist as-is, 33 exist and need extending, 31 are missing.** Three statuses were corrected by the verifiers (10.2 and N.2 to extend; 11.5's 'what exists' understated DeepLink.jsx). The live database is effectively empty of task data (1 reminder row, 0 templates, 0 close rows, both clients test-only), so the schema can still change cheaply.
The spec and the brief disagree in a dozen small places (status names, My Tasks grouping, who reviews, which phase the timer lands in). Those are resolved below with the product owner's decisions of 2026-10-10 and listed where still open.

## A2. The plan in plain English
1. **One task table.** `staff_reminders` becomes the task table. New columns are added beside the old ones (status, description, start date, section, project, parent, period, template, review and waiting fields, estimate, tags, soft delete). Old columns and the `done` flag keep working, so Today, notes, the bell, and the generator never break.
2. **Roles from the staff table.** `staff.role` stays bookkeeper or admin. Any admin can review and approve; the Account Manager is the default reviewer. Bookkeepers see their assigned clients' tasks; access to another client is granted when needed through the existing coverage and temp-access grants, not permanently (the product owner may widen this later). Owners and Directors projects belong to all admins.
3. **Recurring work from templates.** `task_templates` grows weekly cadence and a due-rule field (calendar-day offset by default, business-day rule optional). The existing nightly generator is extended and the existing `task_template_issued` ledger stops double generation. The hard-coded `CLOSE_CHECKLIST` becomes the seeded 'MGB Standard Monthly Close' set.
4. **Periods stay in `month_close`.** Add sign-off fields; only the sign-off RPC may set `done`, because `done` already emails the client that reports are ready.
5. **Ask-client replaces document requests.** A new `client_requests` table absorbs `client_doc_requests`; the chaser cron, client email log and prefs are reused for 3-business-day nudges; the client page is `#/client/<id>/needs`.
6. **Screens as TK_ files.** My Tasks, List, Drawer, Quick add, Templates, Review queue, Close tracker, Inbox and the pop-out shell are new `TK_` components under `components/tasks/`. Today, Work, TopBar, StaffNav and Coverage are extended, not rewritten. `MyTasksPage` is retired once TK_ matches it.
7. **URLs reuse DeepLink.jsx.** Task links keep the existing `#/<place>?item=task:<id>` grammar (`LK_href`, `LK_go`); `tasks/*` is added to `LK_PLACE_CLAIMS` and `#/work/tasks?item=task:<id>` stays as an alias so emailed links keep working. The `/tasks` path rewrite needs a `<base href="/">` or a single-segment rewrite, because every asset URL in `index.html` is relative.
8. **Asana import last.** After phase 1, import users by email, teams to bookkeepers, projects to clients and internal projects, sections to cadence, and all completed history (hidden after 12 months in default views), then run both tools through the November close.

## A3. Decisions the product owner already made (2026-10-10)
| # | Decision | Rows it changes |
|---|---|---|
| D1 | **Reviewer = any admin; the Account Manager is the default.** Bookkeepers do not review each other. | 1.1, 4.4, 5.1, 5.2, 9.1, 10.4 |
| D2 | **Due dates default to calendar days.** Business-day rule type still built (nudges, opt-in items). | 4.3, 4.4, 6.4, N.3 |
| D3 | **Bookkeepers see their assigned clients by default.** Access to another client is granted when needed (coverage or temp access), not permanently; the product owner may change this later. Edit only own or assigned tasks. | 2.1, 3.2, 9.1, 10.2, tk_can_read_task |
| D4 | **Few or no Asana add-ons** (Rules, forms, email-to-task) in use. Confirm with an owner and a senior bookkeeper. | 8.1, 8.3, 12.1, 12.4 |
| D5 | **Keep history indefinitely**; default views hide done tasks older than 12 months. | 12.3, 10.6, 3.1 |
| D6 | **My Tasks groups: Overdue / Today / This week / Later**, Waiting on client as its own section ('today maybe', so Today is tentative). | 3.1, Today.jsx |
| D7 | **Ask-client queue is a full build** (decided earlier on 2026-10-10). | 6.1 to 6.6, 10.5 |
| D8 | **Build is on hold** until the product owner gives the go. Only this report was produced. | all |
| D9 | **Phase 1 is not trimmed.** Attachments (2.5) and server-side search (2.13) stay in phase 1. | 2.5, 2.13, A6 |
| D10 | **Owners = all admins** for the Tasks module. Owners and Directors project tasks are visible to every admin; no narrowing of the admins-read-all policy. | 1.4, RLS, C10 |
| D11 | **`/tasks` is a secondary shell** in phase 1. The pop-out may use its own path or flag (for example `/tasks-popout`) if the shell needs it. | 11.1, 11.2 |

## A4. Decisions still needed before or during the build
The four phase-1 questions from the first draft (read-all scope, phase 1 size, Owners privacy, `/tasks` entry) were answered late on 2026-10-10 and are recorded as D3 and D9 to D11 in A3. Nothing blocks phase 1 now except the go.

Needed in phase 2:
- Backup bookkeeper: keep on `client_profile` (no data move) or consolidate onto `clients`?
- Out of office: move only tasks due inside the window, or all open tasks? Do tasks in Ready for review stay with the original bookkeeper?
- Quarterly and annual sign-off (990 prep, giving statements): needed, or monthly only? Yes means widening the `month_close` primary key (0 rows today, so cheap now).
- Closing a period: every task Done, or only the admin sign-off?
- Ask-client responders without a login (treasurer, pastor): token link, or must everyone have a `client_users` row and sign in by magic link? Token links need `tk_request_tokens` and a `client_contacts` table.
- Client uploads: new Drive month folder level (Client/Year/MM Month) or the existing doc-type folders?
- Asana import: which duplicate onboarding project wins (Collective Church ×2, Golden City ×2)? Do the 3 Asana users with no `staff` row become staff rows, or get mapped to an owner fallback? Do onboarding projects import into `client_onboarding` or into `tk_projects`?
- On-time rate: exclude time waiting on the client? Does a send-back count against on-time when final approval is still before the due date?
- Which inbound email provider for tasks@ (if D4 confirms it is needed at all), and is the Resend sending domain verified?
- PWA: open the install gate (`INSTALL_APP_PUBLIC`) for staff when the Tasks shell ships?

## A5. Foundation in one table
| Decision | Assets |
|---|---|
| **foundation** (6) | staff_reminders; task_checklist_items; TaskChecklist.jsx (TCL_); task_template_issued; SI_ChatDrawer pattern; staffOpsLogic.test.js style |
| **extend** (30) | staff_reminders_before_write (live body in staff-offboarding.sql); staff_reminders RLS policies; complete_staff_item(uuid, boolean, date); notify_enqueue_task_assigned; staffItemsApi (app.jsx 16776-17087); task_templates; tt_generate_template_tasks / tt_generate_now / cron task-templates-daily; month_close; client_sops / client_sop_history / save_client_sop / sop-freshness; client_doc_chase / client-doc-chaser cron / client-emails edge function / DocChaser.jsx (DC_); notification_outbox / notification-emails edge function / crons; am_body_mentions; staff_time_off / coverage_overview / grant_coverage_access / Coverage.jsx (CV_); staff_capacity / client_profile.monthly_hours_budget / TeamCapacity.jsx (TP_) / HoursBudget.jsx (HB_); time_entries; staff_performance (staff-celebrations-performance.sql); client_files / drive_folders / drive-files edge function; Today.jsx (TD_buildRows, TD_RemindersCard); WorkPage.jsx (WK_); TaskTemplates.jsx (TT_); CloseTracker.jsx (CT_); ModalShell / ConfirmModal / Toast; TopBar.jsx (TB_Search, TB_QuickAdd, TB_TasksBadge); StaffNav NAV_PLACES / NAV_useHashSub / HASH_SUB_ROUTE_PAGES / parseHashRoute; Realtime channel staff-reminders-<email> (app.jsx 24353-24411); vercel.json / manifest.webmanifest / INSTALL_APP_PUBLIC gate; has_temp_admin_access (gates the templates page today); Offboarding.jsx / offboard_staff_preview; StaffGuide.jsx + staff_guide + docs/staff-guide/*.md; components/tour/Tips.jsx + Tour.jsx |
| **fold** (4) | tt_client_bookkeeper; client_close_items + CLOSE_CHECKLIST (app.jsx 5248); client_doc_requests / fulfill_doc_request; CLIENT_RequestsPanel (app.jsx 753-794) |
| **retire** (1) | MyTasksPage (app.jsx 18142-19522) |
| **keep-separate** (17) | task_template_suggestions; staff_reminders.recurrence (per-item recurrence); month_close_settings; close_checks / close_checks_evaluate / cron close-checks-daily; client_email_log / client_email_settings / client_email_prefs / client_email_recipients; transaction_questions / TxnQuestions.jsx (TQ_); digest_settings / digest_runs / weekly-admin-digest; offboard_staff; staff_app_time / record_app_time / AppTimeTracker.js; firm_deadline_rules / client_deadline_overrides / client_deadline_status / Deadlines.jsx (DL_); onboarding_steps / client_onboarding; client_private_notes.linked_task_id; client_documents / document_folders; StaffInbox.jsx (SI_); staff_checklist_presets (personal; promote to firm sop_steps only by choice — corrected by verifier 4.7); client_notes (shared per-client staff notes, supabase/client-notes.sql — added by the critic; show in the drawer, do not fold); ReplyTimes.jsx, HealthBoard.jsx, ClientHealth.jsx, shoutouts/celebrations, client-status-overrides (reconcile their overdue and done reads) |

Full rationale per asset is in B3. Corrections applied there: personal checklist presets are not folded firm-wide; `client_documents` is kept separate because it is the client-readable library (its staff policy does use `can_access_client`, contrary to the analysts' note); `complete_staff_item` nulls `source_ref` on roll-forward only for `source='template'`; `created_by` is stamped from the JWT only when the caller is active staff and the owner, never forced, so the generator, import and the access-request definer inserts keep working.

## A6. Phasing (brief's four phases, rows assigned)

**Phase 1** (25 rows). Brief: My Tasks, List, roles, task drawer, pop-out shell. The product owner kept the analysts' fuller phase 1 (D9): comments, attachments, followers, activity log and server search ship with the drawer. Sequence: schema and RLS, then My Tasks and List, then the drawer, then quick add and search, then the pop-out shell.
- 1.1 Client record carries bookkeeper, backup and reviewer assignments
- 1.2 Client record carries QBO link, Drive folder and contacts
- 1.3 SOP per client, attachable to tasks
- 1.4 Internal projects (SOPs, Directors, Owners, 90 Day, onboarding) as task containers alongside clients
- 2.1 Task core fields: title, description, assignee, due date, start date, section, priority
- 2.2 Status workflow To do -> In progress -> Waiting on client -> Ready for review -> Done
- 2.3 Subtasks / checklist on a task
- 2.4 Comments on a task with @mentions
- 2.5 Attachments on a task
- 2.6 Followers on a task
- 2.7 Activity log per task
- 2.11 Quick add
- 2.13 Global search across tasks and clients
- 3.1 My Tasks grouped Overdue / Today (tentative) / This week / Later, plus a Waiting on client section (brief wording: Overdue / This week / Waiting on clients / Later)
- 3.2 List view
- 3.6 Keyboard-first navigation and shortcuts
- 11.1 Same app served at /tasks (tasks. subdomain later)
- 11.2 Open in own window: window.open sized popup with slim top-bar shell; Dock in portal returns
- 11.4 Supabase Realtime plus BroadcastChannel keep windows in sync
- 11.5 Every client, task and view has a URL
- N.1 One name prefix per new file (TK_), registered in window.__SOURCE_ORDER, CSS per component, no bundler
- N.2 RLS on every new table, re-runnable SQL, nothing destructive to existing tables without a data-preserving migration
- N.3 Tests in the existing *.test.js style for business-day math and status transitions
- N.4 Every screen works at phone width
- N.5 Bump window.MGB_VERSION

**Phase 2** (23 rows). Brief: recurring engine, review loop, Ask-client. Gate: Asana import and parallel run start here, which needs a real client roster (today 2 test-only clients) and the phase-2 SQL helpers (4.3) first. Pulled forward from phase 3 with reason: 7.2 immediate mentions/send-backs (the review loop needs them), 10.4 review queue, 10.5 waiting list, 9.1 manual OOO reassignment.
- 4.1 Per-client template built on the MGB Standard Monthly Close plus client-specific items
- 4.2 Cadence weekly / monthly / quarterly / annual
- 4.3 Due rules including business-day N
- 4.4 Tasks generated N days ahead by a scheduled function
- 4.5 Period object (open / in review / closed) with sign-off
- 4.6 Bulk-edit a recurring series
- 4.7 SOP attached to each recurring item; SOP steps become the task checklist
- 5.1 Ready for review -> Approve / Send back with reason
- 5.2 Review counts per bookkeeper
- 6.1 Ask client on any task pauses it (Waiting on client)
- 6.2 Client-facing What we need from you page with upload and reply
- 6.3 Email with magic link for clients who do not log in
- 6.4 Nudges every 3 business days
- 6.5 Answering resumes the task and files the upload in the client Drive month folder
- 6.6 client_requests table with Client role RLS (own org only)
- 7.2 Mentions and send-backs delivered immediately
- 9.1 Reassign due tasks to the backup while out, and back on return
- 10.4 Review queue
- 10.5 Waiting-on-client list
- 12.1 Import users by email, teams -> bookkeeper, projects -> clients
- 12.2 Sections -> cadence; recurring tasks -> draft templates for bookkeeper confirmation
- 12.3 12 months of completed history; merge duplicate onboarding projects
- 12.4 Parallel run with Asana through the November close

**Phase 3** (13 rows). Brief: Board, Calendar, Inbox, automations, dashboards. Note: 4.4 generated-task notices depend on tk_inbox_items (7.1); either ship the table in phase 2 or accept that phase-2 generated tasks notify only through the existing task_due email.
- 3.3 Board view
- 3.4 Calendar view
- 3.5 Saved filters
- 7.1 Inbox grouped by client
- 7.3 Everything else in a daily digest
- 7.4 Mute per client
- 8.1 Rule builder with bookkeeping triggers: overdue N business days, period closed, sent back twice, bookkeeper out of office, email received at tasks@
- 8.2 Fire counts per rule
- 8.3 Email-to-task from a firm tasks@ inbox, client picked by sender domain
- 10.1 Close tracker: clients x months
- 10.2 Overdue by bookkeeper
- 10.3 Workload vs capacity in hours
- 11.3 PWA installable (manifest exists, currently gated)

**Phase 4** (5 rows). Brief: dependencies, tags, bulk edit, time rollups. The one-tap timer (2.10) could land in phase 2 or 3 if wanted; the brief phases only the rollups.
- 2.8 Blocked-by dependencies that shift due dates
- 2.9 Tags
- 2.10 Time tracking per task with a one-tap timer
- 2.12 Bulk edit
- 10.6 On-time rate feeding quarterly reviews

Timeline check: the brief wants the parallel run through the November close, so phase 2 must be live in early November. Phase 1 as sized above is several weeks of work in a no-bundler codebase, and the product owner chose not to trim it (D9), so the schedule risk is accepted; the lever is to start phase 2's SQL helpers (4.3) as soon as the phase-1 schema lands.

## A7. Build Phase 1 on these existing pieces (from the 10/27 redesign session)
- `components/staff/DeepLink.jsx` (LK_): the URL grammar `#/<place>[/<tab>][?item=<kind>:<id>]`, `LK_href`, `LK_go`, `LK_reveal`, `LK_useArrival`. Kinds `task` and `view` already exist. Add `tasks/*` to `LK_PLACE_CLAIMS`, keep `#/work/tasks?item=task:<id>` as an alias, and repoint the `TB_go` call sites in TopBar.jsx (around lines 351, 357, 508, 835, 946). Never put emails, names or free text in URLs.
- Client Overview tasks card (`app.jsx` around 6539, item `at:ov-tasks`) and `ClientOverviewPage` (around 6921): the client-side entry point into tasks.
- Today task rows (`Today.jsx` around 410, `TD_buildRows`, `TD_RemindersCard`): keep Today as home; rows open the TK_ drawer; grouping comes from one shared TK_ logic file so Today and My Tasks never disagree on 'overdue'.
- `MyTasksPage` task rows already carry `data-lk="task:<id>"` and call `LK_reveal(LK_find(...))` (app.jsx around 19663-19677, 20134): copy that pattern, then retire the page.

## A8. What was not done, on purpose
No code, SQL, migrations or edge-function changes. No git commands in the repo (another session holds about 3,400 uncommitted lines in app.jsx, Today.jsx, StaffNav, index.html and styles.css). No file other than this one was created or edited. Nothing was changed in Supabase or Asana.

---

# Part B — Reference

## B1. Gap table summary
Status after verification. 'exists' = present and usable as is; 'extend' = present, needs additions; 'missing' = nothing to build on.

| ID | Feature | Status | Phase | Confidence | Verified |
|---|---|---|---|---|---|
| 1.1 | Client record carries bookkeeper, backup and reviewer assignments | extend | 1 | high | agree; agree |
| 1.2 | Client record carries QBO link, Drive folder and contacts | extend | 1 | medium | agree; agree |
| 1.3 | SOP per client, attachable to tasks | extend | 1 | high | agree; agree |
| 1.4 | Internal projects (SOPs, Directors, Owners, 90 Day, onboarding) as task containers alongside clients | missing | 1 | high | agree; agree |
| 2.1 | Task core fields: title, description, assignee, due date, start date, section, priority | extend | 1 | high | agree; agree |
| 2.2 | Status workflow To do -> In progress -> Waiting on client -> Ready for review -> Done | missing | 1 | high | agree; agree |
| 2.3 | Subtasks / checklist on a task | extend | 1 | high | agree; agree |
| 2.4 | Comments on a task with @mentions | missing | 1 | high | agree; agree |
| 2.5 | Attachments on a task | missing | 1 | medium | agree; agree |
| 2.6 | Followers on a task | missing | 1 | medium | agree; agree |
| 2.7 | Activity log per task | missing | 1 | high | agree; agree |
| 2.8 | Blocked-by dependencies that shift due dates | missing | 4 | high | agree; agree |
| 2.9 | Tags | missing | 4 | high | agree; agree |
| 2.10 | Time tracking per task with a one-tap timer | extend | 4 | medium | agree; agree |
| 2.11 | Quick add | extend | 1 | high | agree; agree |
| 2.12 | Bulk edit | missing | 4 | high | agree; agree |
| 2.13 | Global search across tasks and clients | extend | 1 | high | agree; agree |
| 3.1 | My Tasks grouped Overdue / Today (tentative) / This week / Later, plus a Waiting on client section (brief wording: Overdue / This week / Waiting on clients / Later) | extend | 1 | high | agree; agree |
| 3.2 | List view | extend | 1 | high | agree; agree |
| 3.3 | Board view | missing | 3 | high | agree; agree |
| 3.4 | Calendar view | missing | 3 | high | agree; agree |
| 3.5 | Saved filters | missing | 3 | high | agree; agree |
| 3.6 | Keyboard-first navigation and shortcuts | missing | 1 | high | agree; agree |
| 4.1 | Per-client template built on the MGB Standard Monthly Close plus client-specific items | extend | 2 | medium | agree; agree |
| 4.2 | Cadence weekly / monthly / quarterly / annual | extend | 2 | high | agree; agree |
| 4.3 | Due rules including business-day N | missing | 2 | high | agree; agree |
| 4.4 | Tasks generated N days ahead by a scheduled function | extend | 2 | high | agree; agree |
| 4.5 | Period object (open / in review / closed) with sign-off | extend | 2 | medium | agree; agree |
| 4.6 | Bulk-edit a recurring series | missing | 2 | medium | agree; agree |
| 4.7 | SOP attached to each recurring item; SOP steps become the task checklist | extend | 2 | medium | agree; agree |
| 5.1 | Ready for review -> Approve / Send back with reason | missing | 2 | high | agree; agree |
| 5.2 | Review counts per bookkeeper | missing | 2 | high | agree; agree |
| 6.1 | Ask client on any task pauses it (Waiting on client) | missing | 2 | high | agree; agree |
| 6.2 | Client-facing What we need from you page with upload and reply | extend | 2 | high | agree; agree |
| 6.3 | Email with magic link for clients who do not log in | extend | 2 | medium | agree; agree |
| 6.4 | Nudges every 3 business days | extend | 2 | high | agree; agree |
| 6.5 | Answering resumes the task and files the upload in the client Drive month folder | extend | 2 | medium | agree; agree |
| 6.6 | client_requests table with Client role RLS (own org only) | missing | 2 | high | agree; agree |
| 7.1 | Inbox grouped by client | missing | 3 | high | agree; agree |
| 7.2 | Mentions and send-backs delivered immediately | extend | 2 | high | agree; agree |
| 7.3 | Everything else in a daily digest | extend | 3 | medium | agree; agree |
| 7.4 | Mute per client | missing | 3 | high | agree; agree |
| 8.1 | Rule builder with bookkeeping triggers: overdue N business days, period closed, sent back twice, bookkeeper out of office, email received at tasks@ | missing | 3 | medium | agree; agree |
| 8.2 | Fire counts per rule | missing | 3 | high | agree; agree |
| 8.3 | Email-to-task from a firm tasks@ inbox, client picked by sender domain | missing | 3 | medium | agree; agree |
| 9.1 | Reassign due tasks to the backup while out, and back on return | extend | 2 | medium | agree; agree |
| 10.1 | Close tracker: clients x months | extend | 3 | high | agree; agree |
| 10.2 | Overdue by bookkeeper | extend (was missing) | 3 | high | corrected→extend; agree |
| 10.3 | Workload vs capacity in hours | extend | 3 | medium | agree; agree |
| 10.4 | Review queue | missing | 2 | high | agree; agree |
| 10.5 | Waiting-on-client list | extend | 2 | medium | agree; agree |
| 10.6 | On-time rate feeding quarterly reviews | extend | 4 | medium | agree; agree |
| 11.1 | Same app served at /tasks (tasks. subdomain later) | missing | 1 | high | agree; agree |
| 11.2 | Open in own window: window.open sized popup with slim top-bar shell; Dock in portal returns | missing | 1 | high | agree; agree |
| 11.3 | PWA installable (manifest exists, currently gated) | extend | 3 | medium | agree; agree |
| 11.4 | Supabase Realtime plus BroadcastChannel keep windows in sync | extend | 1 | high | agree; agree |
| 11.5 | Every client, task and view has a URL | extend | 1 | high | agree; corrected→extend |
| 12.1 | Import users by email, teams -> bookkeeper, projects -> clients | missing | 2 | medium | agree; agree |
| 12.2 | Sections -> cadence; recurring tasks -> draft templates for bookkeeper confirmation | missing | 2 | medium | agree; agree |
| 12.3 | 12 months of completed history; merge duplicate onboarding projects | missing | 2 | medium | agree; agree |
| 12.4 | Parallel run with Asana through the November close | missing | 2 | low | agree; agree |
| N.1 | One name prefix per new file (TK_), registered in window.__SOURCE_ORDER, CSS per component, no bundler | exists | 1 | high | agree; agree |
| N.2 | RLS on every new table, re-runnable SQL, nothing destructive to existing tables without a data-preserving migration | extend (was exists) | 1 | high | corrected→extend; agree |
| N.3 | Tests in the existing *.test.js style for business-day math and status transitions | extend | 1 | high | agree; agree |
| N.4 | Every screen works at phone width | extend | 1 | high | agree; agree |
| N.5 | Bump window.MGB_VERSION | exists | 1 | high | agree; agree |

### Rows the critic asked to add
- **NEW-unify (phase 1).** Inventory every existing task writer and reader and decide keep or reroute for each. Writers: the access-request security-definer inserts (`supabase/audit-hardening-telemetry-and-rpcs.sql:161`, `supabase/user-settings.sql:460`, one row per `staff_client_access`, with no source, visibility or assignee; the live trigger then rewrites `source` to `access_request` by matching text `LIKE 'New access request from %'`, `staff-offboarding.sql:53-58`), `DL_TaskButton` (source `deadline`), note-to-task (`app.jsx` around 18406-18415, source `note`), `StaffQuickActions` task branch, `TaskTemplates` 'Save as template', `TD_RemindersCard`, `MyTasksPage` add, `tt_generate_template_tasks`, `complete_staff_item` roll-forward. Readers that must learn `deleted_at` and `status`: `client_health`, `staff_performance`, the weekly digests, `offboard_staff`, the notification-emails `task_due` job, the client-emails value report, `TeamPage.jsx` (around 891), `Deadlines.jsx` (around 46), `TB_TasksBadge`, `StaffInbox` client panel, `HomeCards.jsx` (242, 266) and `StaffInbox.jsx` (707) which read `CLOSE_CHECKLIST`.
- **NEW-client_notes.** `supabase/client-notes.sql` (shared per-client staff notes such as 'waiting on March bank statement') is cited nowhere. Decision: keep separate, show in the client header or drawer; do not fold into comments.
- **NEW-open-questions.** Each open question mapped to the rows it blocks: reviewer → 1.1, 5.1, 9.1 (now settled by D1); business days → 4.3 (settled by D2); cross-bookkeeper reading → 9.1, 3.2 (settled by D3); Asana add-ons → 8.3, 12.3 (mostly settled by D4).
- **NEW-subdomain (deferred note).** `tasks.mygoodbooks.org` is a different origin: separate localStorage so no shared Supabase session, its own Auth redirect allow-list entries, a CSP connect-src review and a vercel.json host rule. Not in phases 1 to 4.
- **NEW-non-additive migrations.** The brief's non-negotiable needs a list: `drive_folders` unique index swap (6.5), `month_close` PK widening (4.5, only if quarterly/annual sign-off is wanted), `client_doc_requests` fold (6.6, preserve ids so `client_files.request_id`, `client_doc_chase` and `client_email_log.request_ids` still resolve), `client_close_items` fold (4.1), cadence CHECK widening (4.2), `staff_reminders_shared_needs_client` CHECK replacement (1.4), `notification_outbox` kind and `client_email_log` feature CHECK widening (2.4, 7.2; defined in two files). Each gets a data-preservation step and a rollback note in its migration.

## B2. Gap table detail
Each row: what exists, what is missing, the proposal, evidence (file:lines), the analysts' disagreement where there was one, the verifier verdicts and fixes, the critic's requested changes, and the product owner's decision where it applies. Verifier reasons are quoted in full only where they disagreed; agreeing verdicts are listed by label.

### Area 1 Clients first-class

#### 1.1 Client record carries bookkeeper, backup and reviewer assignments
**Status:** extend · **Phase:** 1 · **Confidence:** high

**Exists:** The bookkeeper and account manager are columns on clients. The backup lives on client_profile and is edited in the client profile panel. staff.role is only bookkeeper/admin. A grep finds no reviewer_email or can_review column anywhere in supabase/.

**Missing:** A reviewer per client (or a firm default reviewer). FK or trigger validation of the backup against staff. One resolver that returns bookkeeper, backup, reviewer and account manager for a client, so routing, the generator, OOO and the review gate all read the same answer.

**Proposal:** Add clients.reviewer_email text references staff(email), next to assigned_bookkeeper_email. Until the product owner answers the reviewer question, a null value falls back to a firm default reviewer setting (an owner). Keep backup_bookkeeper_email on client_profile in phase 1, so no data moves, and add a validation trigger against active staff. Add SQL function tk_client_people(p_client_id) returning (bookkeeper, backup, reviewer, account_manager) using lower() email compares, and repoint tt_client_bookkeeper at it. Mirror it in TK_clientRoles for the UI. TK_ClientHeader and the drawer's People row show the four roles as chips. Do not reuse account_manager as the reviewer.

**Evidence:**
- `supabase/assigned-bookkeeper-email.sql` 33-48 — clients.assigned_bookkeeper_email, FK to staff.email; RLS uses it (to line 144)
- `supabase/staff-client-tools.sql` 26-44 — client_profile.backup_bookkeeper_email (line 33) is plain text with no FK to staff
- `supabase/account-manager.sql` 50-66 — clients.account_manager_email is a relationship owner, not a close reviewer
- `supabase/task-templates.sql` 147-177 — tt_client_bookkeeper resolves the owner only and ignores backup and reviewer; its name match (line 164) and the jsonb email path differ from the plain clients column
- `app.jsx` 6229-6631 — client profile editor shows and edits the backup bookkeeper with a CV_OutTag badge

**Analyst disagreement:** Database-first put reviewer_email on clients and moved or mirrored the backup onto clients. UI-first put reviewer on clients and left the backup where it is, read through a view. Spec-skeptic put reviewer on client_profile. I chose clients.reviewer_email so it sits next to the bookkeeper column that RLS and the FK already use, and left the backup in place (UI-first) so there is no data move in phase 1. Whether to consolidate the backup is still an open question.

**Verification:**
- verify:1:db: agree.
- verify:1:ui: agree.

**Verifier fixes to the proposal:**
- (verify:1:db) Give clients.reviewer_email the same pattern as account_manager_email: FK to staff(email) on update cascade on delete set null, plus a before-write trigger that lowercases it and fills a display name. Without the trigger, mixed-case emails break the FK and the lower() compares. Put the firm default reviewer in the existing month_close_settings singleton (add default_reviewer_email), not in a new settings table or in team-reviews review_settings.
- (verify:1:db) The client_profile backup validation trigger should fire only on insert, or on update when backup_bookkeeper_email actually changes, and should allow null. Otherwise, once offboard_staff sets the backup's staff.active=false, every later edit to an unrelated profile field (fiscal year, hours budget, sheet_reviewed_at via mark_sop_reviewed) fails. Also extend offboard_staff to move or clear backup_bookkeeper_email, account_manager_email and reviewer_email.
- (verify:1:db) tk_client_people must not be a definer function open to everyone signed in. tt_client_bookkeeper is deliberately revoked from authenticated because it returns staff emails for any client id, and the backup lives under can_access_client RLS. Either revoke it from authenticated (internal use only) or check is_active_staff() and can_access_client(p_client_id) first. Repoint coverage_overview and grant_coverage_access at it too, so OOO and coverage resolve the same backup.
- (verify:1:db) Setting reviewer_email on clients is admin-only under the current RLS ('admins can update clients'). If bookkeepers or the reviewer question need non-admins to set it, put it in an RPC with a can_access_client check, not a loosened clients update policy.
- (verify:1:ui) clients.reviewer_email alone does not give the reviewer access. Copy the assigned-bookkeeper pattern: a before-write trigger that lower()s the email and an after-write trigger that inserts staff_client_access for the reviewer. Alternatively, make tk_can_read_task include the reviewer explicitly. Without one of these, a bookkeeper reviewer cannot read the client's tasks, because can_access_client checks only staff_client_access and grants. Add reviewer_email to index.html loadClientsRoster with an AM_COLS_OK-style retry flag, since the select fails until the migration runs. Put the firm default reviewer on month_close_settings (default_reviewer_email references staff(email)) rather than a new table, and do not reuse review_settings.default_reviewer_id, which is the performance-review default. The backup validation trigger must use lower() matching, as coverage does, and run on client_profile. offboard_staff also needs to clear or reassign backup_bookkeeper_email, which it does not do today. Point TK_clientRoles at the same resolver that CL_isMine, HealthBoard and TeamPage use, so there are not four resolvers.

**Critic:**
- Add the before-write (lowercase) and after-write (staff_client_access insert) triggers for reviewer_email, copied from assigned-bookkeeper-email.sql. Put default_reviewer_email on month_close_settings. Revoke tk_client_people from authenticated, or gate it with can_access_client. Repoint coverage_overview, grant_coverage_access, CL_isMine, HealthBoard and TeamPage to the same resolver. Extend offboard_staff to cover backup_bookkeeper_email, account_manager_email and reviewer_email.

**Decision applied (2026-10-10):** Reviewer = any active admin (role 'admin'), with the Account Manager as the default reviewer. Bookkeepers do not review each other. So phase 1 needs no reviewer column: tk_client_people returns bookkeeper, backup and account_manager only, and an optional clients.reviewer_email override plus month_close_settings.default_reviewer_email (the Account Manager) move to phase 2 with the review loop. Drop staff.can_review. Bookkeepers see only their assigned clients by default (D3), so tk_client_people stays gated by can_access_client() like the rest of the client data.


#### 1.2 Client record carries QBO link, Drive folder and contacts
**Status:** extend · **Phase:** 1 · **Confidence:** medium

**Exists:** The QBO link is available through qbo_connections (realm id). A client's Drive folders are cached per year and doc type. Portal logins are client_users, and email recipients are client_email_recipients.

**Missing:** No client header the task module can show (QBO deep link, root Drive folder, contacts). No stored contacts list (treasurer, pastor, finance chair) separate from logins, which Ask-client needs for contacts who never log in.

**Proposal:** Phase 1: TK_ClientHeader shows a QBO status pill and link (from qbo_connections), an 'Open Drive folder' link (root drive_folders row), and a contacts popover (client_users plus client_email_recipients). It reads from loadClientsRoster and tk_client_people, so phase 1 needs no new storage. Optionally add clients.qbo_url and clients.drive_root_url overrides, derived when blank. Phase 2, with Ask-client: new client_contacts table (id, client_id, name, email, role, is_request_recipient, active). Staff RLS uses can_access_client; clients read through is_client_member. Ask-client takes recipients from client_contacts and falls back to client_email_recipients.

**Evidence:**
- `supabase/clients-roster.sql` 23-68 — clients has no qbo_url, drive_url or contacts columns
- `supabase/google-drive-files.sql` 54-128 — drive_folders cache keyed (client_id, year, doc_type)
- `supabase/functions/drive-files/index.ts` 277-281 — folder layout Client/Year/DocType, with no month level
- `supabase/client-users.sql` 18-38 — client_users are portal logins, not a church contacts list
- `supabase/client-emails.sql` 209 — client_email_recipients already lists who receives client email
- `index.html` 322-388 — loadClientsRoster loads the roster globally

**Analyst disagreement:** UI-first said no new storage is needed and contacts are client_users. Database-first and spec-skeptic want a client_contacts table for church contacts who never log in. I kept UI-first's phase 1 (display only) and scheduled client_contacts for phase 2 with Ask-client, where the need for it actually shows up.

**Verification:**
- verify:1:db: agree.
- verify:1:ui: agree.

**Verifier fixes to the proposal:**
- (verify:1:db) Phase-1 contacts popover: list client_users (name, role, active) only, and mark opted-out or summary-recipient status from client_email_recipients and client_email_prefs.summary_recipients. Do not present client_email_recipients as an extra contact source, because it is seeded from active client_users. 'Open Drive folder' needs a fallback when the client has no client-level drive_folders row, for example calling the drive-files edge function to create or resolve it. Any qbo_url or drive_root_url override on clients is readable by the client's own portal users (client-read-own-org policy) and writable only by admins.
- (verify:1:db) Phase-2 client_contacts must not be folded into client_users. Its email is the PK and an active row grants portal sign-in. A separate table is right, but add an optional client_user_email link (or a union view) so a contact who also logs in isn't stored twice with diverging name and role.
- (verify:1:ui) Drop client_email_recipients as a contacts source and as the Ask-client fallback. It is a lazily created unsubscribe ledger of client_users emails. The fallback should be active client_users minus rows where client_email_recipients.opted_out_at is not null, respecting client_email_prefs. 'Open Drive folder' must handle a missing client-level drive_folders row (no uploads yet) and Drive not being connected (drive_status, 503 drive_not_connected). Show a disabled state, or have the drive-files function create the folder on demand, rather than a dead link. Staff also need membership in the shared drive for the folder URL to open. Do not promise a QBO 'deep link': only realm_id is stored and no code builds a company-specific QBO URL. Show the qbo_connections status pill and link to the in-app QBO page. For phase 2 client_contacts, note that client_users.email is the primary key, so one person cannot be a contact at two churches. Key client_contacts on (client_id, email), not email.

**Critic:**
- Contacts popover reads client_users only, with opt-out flags from client_email_recipients and summary_recipients. Do not promise a QBO deep link (only realm_id is stored). Disable the Drive link when drive_status is not connected or no root folder exists. Key phase-2 client_contacts on (client_id, email), with an optional client_user_email link, and name 6.1 as its consumer.


#### 1.3 SOP per client, attachable to tasks
**Status:** extend · **Phase:** 1 · **Confidence:** high

**Exists:** Each client has an SOP in 7 free-text sections, with history, conflict-safe saves, freshness tracking and realtime.

**Missing:** Tasks have no link to an SOP section. SOP content is prose with no structured steps, so it cannot be attached to a template item or turned into a checklist.

**Proposal:** Phase 1: add staff_reminders.sop_section (a text id from CLIENT_SOP_SECTIONS). The drawer's SOP row opens a read-only slide-over of that section from client_sops, which stays the source of truth for narrative. Phase 2 (see 4.7): new sop_steps (id, client_id null meaning firm standard, section, template_id null, sort_order, text, archived_at). A 'Use these lines as steps' helper turns prose lines into steps by hand.

**Evidence:**
- `supabase/client-sops.sql` 47-255 — client_sops: one row per (client_id, section), free-text body, client_sop_history, save_client_sop with version conflict detection, realtime
- `app.jsx` 17278-17314 — CLIENT_SOP_SECTIONS ids (7 sections)
- `supabase/sop-freshness.sql` 29-137 — mark_sop_reviewed and client_sop_status

**Analyst disagreement:** Spec-skeptic put this in phase 2 and database-first in phase 1. I split it: the cheap link is phase 1 and the structured steps are phase 2 with the recurring engine that consumes them. Database-first's client_sop_steps and spec-skeptic's sop_steps are merged into one table with a nullable client_id, so the firm-standard steps fit too.

**Verification:**
- verify:1:db: agree.
- verify:1:ui: agree.

**Verifier fixes to the proposal:**
- (verify:1:db) staff_reminders.sop_section should carry a CHECK of (sop_section is null or sop_section in ('access','bank_feeds','monthly_close','payroll','bills_vendors','reporting','quirks')), or be validated in the write trigger. client_sops.section has no DB constraint and the ids exist only in app.jsx. Cite app.jsx 17370-17407, not 17278-17314.
- (verify:1:ui) Build the drawer SOP slide-over on ClientSopView with readOnly and a new section prop, not a new viewer. When MyTasksPage is retired, repoint OPEN_CLIENT_SOP_EVENT, requestOpenClientSop and the settings modal's onEditInMyTasks to the client 'sop' page (app.jsx 27084). Otherwise 'Edit in My Tasks' breaks. For sop_steps rows with client_id null (firm standard), add an explicit policy: read when is_active_staff(), write when is_active_staff_admin(). can_access_client(null) is true only for admins, so bookkeepers could not read the firm-standard steps.

**Critic:**
- Fix the cite to app.jsx 17370-17407. Add a CHECK on sop_section against the 7 CLIENT_SOP_SECTION_IDS. Build the slide-over on ClientSopView readOnly. Repoint OPEN_CLIENT_SOP_EVENT and 'Edit in My Tasks' to the client sop page before retiring MyTasksPage.


#### 1.4 Internal projects (SOPs, Directors, Owners, 90 Day, onboarding) as task containers alongside clients
**Status:** missing · **Phase:** 1 · **Confidence:** high

**Exists:** Nothing. Non-client tasks are private reminders with a null client_id.

**Missing:** A projects table, so Directors, Owners, 90 Day, SOP-writing and onboarding work has a home with members and sections, and Asana's internal projects have somewhere to import into.

**Proposal:** New tk_projects (id, name, kind CHECK in ('internal','onboarding'), client_id null for onboarding projects, owner_email, sections text[], archived_at) and tk_project_members (project_id, staff_email). Add staff_reminders.project_id references tk_projects. RLS: members plus admins, so private Owners and Directors tasks stay hidden from bookkeepers. Client tasks keep client_id and need no project row; the client page is the container (#/tasks/c/<client>), and internal projects route at #/tasks/p/<id>. TK_Sidebar lists Projects under the client list.

**Evidence:**
- `supabase/staff-reminders-v2.sql` 36-83 — tasks carry only an optional client_id; no project concept
- `supabase/staff-reminders.sql` 9-36 — original table, client_id with no project
- `supabase/client-onboarding.sql` 24-131 — onboarding_steps and client_onboarding are a separate checklist system
- `components/staff/StaffNav.jsx` 18-79 — NAV_PLACES has no project list

**Analyst disagreement:** UI-first and spec-skeptic create one project row per client, lazily or implicitly. Database-first keeps client tasks on client_id with no project row. I chose database-first: a project row per client would need syncing with clients (renames, archiving, test_only) for no data benefit, and client_id already drives can_access_client RLS.

**Verification:**
- verify:1:db: agree.
- verify:1:ui: agree.

**Verifier fixes to the proposal:**
- (verify:1:db) Adding staff_reminders.project_id also requires replacing CHECK staff_reminders_shared_needs_client (staff-reminders-v2.sql:63-66) with (visibility = 'private' or client_id is not null or project_id is not null), and adding project-member select and update policies. The current shared policies require client_id is not null, so shared project tasks would otherwise be rejected or invisible.
- (verify:1:db) 'Members plus admins' does not keep Owners and Directors work private from non-owner admins. The live policy 'admins read all reminders' (admin-read-all-tasks.sql) lets every admin read every row. If Owners or Directors projects must be hidden from admins who are not members, the policy needs a carve-out such as using (is_active_staff_admin() and (project_id is null or tk_is_project_member(project_id))). That reverses part of the 2026-09-29 owner decision, so the product owner must sign off.
- (verify:1:db) For onboarding projects that carry client_id, add a trigger forcing staff_reminders.client_id = tk_projects.client_id when project_id is set. Otherwise a task's can_access_client scope and its project's scope can disagree. Name which onboarding is meant: client_onboarding (client-onboarding.sql) or staff_onboarding_steps (staff-onboarding.sql).
- (verify:1:ui) Change the CHECK staff_reminders_shared_needs_client to (visibility = 'private' or client_id is not null or project_id is not null). Otherwise every internal-project task must be private, and project members cannot share them. If Owners or Directors work must be hidden from admins who are not owners, narrow the 'admins read all reminders' policy (admin-read-all-tasks.sql) so that rows with project_id are excluded unless the admin is a member. Today every admin reads every row. State the client_id rule as a CHECK: client_id text references clients(id) required when kind = 'onboarding' and null otherwise (the row's wording reads backwards). tk_project_members.staff_email should reference staff(email) on update cascade on delete cascade, stored lower-case. Add project membership to offboard_staff. Decide whether staff onboarding (staff_onboarding_steps) is in scope for 'onboarding' projects, or only client_onboarding.

**Critic:**
- Replace the staff_reminders_shared_needs_client CHECK with (visibility='private' or client_id is not null or project_id is not null). Name client_onboarding (not staff onboarding) as the onboarding target. Add a trigger forcing task client_id = project client_id. Add a product owner decision on narrowing 'admins read all reminders' for Owners and Directors projects. Block auto-follow (2.6) from granting non-members access to project tasks.

**Decision applied (2026-10-10):** Owners and Directors projects: the members are all admins (the product owner: 'owners includes all admin'). The admins-read-all policy is not narrowed. Bookkeepers are kept out by project membership.


### Area 2 Tasks

#### 2.1 Task core fields: title, description, assignee, due date, start date, section, priority
**Status:** extend · **Phase:** 1 · **Confidence:** high

**Exists:** staff_reminders already holds title (text), due_date/due_at, priority (low/normal/high, which matches the prototype), assignee_email, created_by, client_id, visibility and source/source_ref. It is live with realtime and admin read-all.

**Missing:** description, start date, section, sort key, project_id, parent_id and soft delete. RLS gives the assignee no access unless they own the row or it is shared on a client they can access, so a private task assigned to a colleague is invisible to them. The trigger trusts a browser-supplied created_by and does not pin assignee_email.

**Proposal:** Migration 1 is additive: ALTER TABLE staff_reminders ADD COLUMN description text, start_on date, section text, sort_key numeric, project_id uuid, parent_id uuid, deleted_at timestamptz, deleted_by text. Expose it as view tk_tasks (security_invoker) so TK_ code never names the legacy table. Add the policy 'assignee reads and updates assigned tasks' on lower(assignee_email)=lower(jwt email), and member access for project tasks. In the before_write trigger, force created_by from the JWT on insert and pin assignee changes to owner, admin or RPC paths. Change staffItemsApi.remove to set deleted_at; every read filters deleted_at is null. TK_Drawer fields: Title (inline), Status, Assignee, Due, Start, Priority, Section, Client or Project, Description.

**Evidence:**
- `supabase/staff-reminders-v2.sql` 36-46 — already adds kind, due_at, remind_at, recurrence, assignee_email, created_by, visibility, source, source_ref; line 81 backfills assignee_email from staff_email
- `supabase/staff-reminders-v2.sql` 156-193 — RLS: owner (staff_email) full access, plus shared rows on accessible clients. No assignee policy.
- `supabase/staff-offboarding.sql` 43-89 — live staff_reminders_before_write: created_by := coalesce(new.created_by, caller) trusts a browser value on insert; for non-owners it pins staff_email, created_by, client_id and visibility but NOT assignee_email
- `supabase/admin-read-all-tasks.sql` 8-10 — admins read all
- `app.jsx` 16776-17087 — staffItemsApi: list, add, update, toggleDone, remove (hard delete)

**Analyst disagreement:** Spec-skeptic said owner and assignee are the same column and proposed adding assignee_email. That is wrong: staff-reminders-v2.sql:42 adds assignee_email and line 81 backfills it. The real gap is RLS and trigger pinning, which database-first identified.

**Verification:**
- verify:2:db: agree.
- verify:2:ui: agree.

**Verifier fixes to the proposal:**
- (verify:2:db) Do not force created_by from the JWT unconditionally. submit_access_request inserts with a client's JWT, so the client's email would become created_by. complete_staff_item intentionally carries the original created_by, and the template cron has no JWT. Use: if v_caller <> '' and is_active_staff() and v_caller = new.staff_email then created_by := v_caller; otherwise keep the coalesce fallback.
- (verify:2:db) An assignee policy alone is not enough. Change staffItemsApi.list's .or() filter to include assignee_email.eq.<me>, or drop the filter and rely on RLS. Move the hard-coded owner-or-shared checks onto tk_can_edit_task in complete_staff_item (tasks-notes-v3.sql:128-140) and in the task_checklist_items edit policy (task-checklists.sql:91-110). Otherwise assignees can see a task but cannot complete it or tick its checklist. Pin assignee_email in the trigger's non-owner branch.
- (verify:2:db) Soft delete needs every server-side reader to filter deleted_at is null, not just the app: client_health, staff_performance, the weekly digests and offboard_staff. Otherwise deleted tasks still count as overdue. The realtime listener must stay on staff_reminders, because postgres_changes does not fire for the tk_tasks view.
- (verify:2:ui) An assignee RLS policy alone will not surface assigned tasks. staffItemsApi.list must also add assignee_email.eq.<me> to its .or() filter, and emails should be compared lowercase on both sides (the trigger does not lowercase assignee_email, while the notify trigger and TopBar do). Add an assignee picker to the MyTasks form and the StaffQuickActions modal, because no UI sets a different assignee today. Assignee pinning must keep notify_enqueue_task_assigned firing for legitimate reassignments. 'Every read filters deleted_at is null' must name the direct readers outside staffItemsApi, or move them to tk_tasks: client-health.sql overdue, weekly-digest.sql, digest-staff-feedback.sql, staff_performance, TeamPage.jsx:891, Deadlines.jsx:46, the notification-emails task_due job, and the client-emails edge function. That last one emails clients the text of completed tasks, so a deleted task would still reach the client.

**Critic:**
- Replace 'force created_by from JWT' with the conditional rule (stamp only when the caller is active staff and is the owner). Preserve the access_request text-sniffing branch and the due_date/due_at sync. Add assignee_email.eq.<me> to staffItemsApi.list. Lowercase assignee_email in the trigger. Move complete_staff_item and the checklist edit policy onto tk_can_edit_task. List every direct reader that must filter deleted_at (client_health, staff_performance, the weekly digests, offboard_staff, the notification-emails task_due job, client-emails value report, TeamPage.jsx:891, Deadlines.jsx:46).

**Decision applied (2026-10-10):** Edit rights: owner, assignee or any admin. Read rights for client tasks go through can_access_client() (assigned bookkeeper, backup, coverage or temp grants, admins), so a bookkeeper sees another client's tasks only while a grant is active (D3). Private tasks are limited to owner, assignee and followers. Project tasks are limited to project members, and the Owners and Directors projects' members are all admins (D10).


#### 2.2 Status workflow To do -> In progress -> Waiting on client -> Ready for review -> Done
**Status:** missing · **Phase:** 1 · **Confidence:** high

**Exists:** Tasks are either done or not done. complete_staff_item handles completion and roll-forward.

**Missing:** A status column, enforced transitions, a review gate, a waiting state and per-transition timestamps.

**Proposal:** Add status text NOT NULL DEFAULT 'todo' CHECK (status in ('todo','in_progress','waiting_client','ready_for_review','done')), plus status_changed_at and status_changed_by. Backfill status='done' where done. A BEFORE trigger keeps done and completed_at in sync with status both ways, so Today.jsx, StaffRail, staff_performance, complete_staff_item and the realtime channel keep working. Transitions go through tk_set_status(p_id, p_status, p_reason) SECURITY DEFINER, which validates against a transition matrix mirrored in a tested JS logic file. In the UI, a status pill on the row and drawer opens a menu of legal next states. The prototype's short names are UI labels only.

**Evidence:**
- `supabase/staff-reminders.sql` 9-36 — only done boolean plus completed_at
- `supabase/tasks-notes-v3.sql` 102-212 — complete_staff_item flips done and rolls recurrence forward
- `supabase/month-close.sql` 28-36 — month_close has its own per-period status enum, not per task
- `docs/tasks-prototype.dc.html`  — prototype labels todo/progress/wait/review/done

**Analyst disagreement:** Spec-skeptic wanted done to become a generated column and used the prototype's short status names. I chose trigger sync (database-first and UI-first) because legacy writers, including complete_staff_item and staffItemsApi.toggleDone, write done directly, and a generated column would make those writes fail. I chose the descriptive values two analysts used.

**Verification:**
- verify:2:db: agree.
- verify:2:ui: agree.

**Verifier fixes to the proposal:**
- (verify:2:db) tk_set_status is SECURITY DEFINER, so it must re-implement the caller permission check through tk_can_edit_task, as complete_staff_item does. The done-to-status sync trigger must also enforce the review gate. A legacy direct update of done=true on a review-required task (the _toggleDoneClientSide fallback, or a PostgREST patch) must be rejected or diverted to ready_for_review, or the gate can be bypassed.
- (verify:2:ui) Excluding waiting_client from overdue has to reach every place that treats not-done as overdue. Otherwise paused tasks inflate client health, digests, staff_performance overdue counts, the task_due email, the TB_TasksBadge/countDueStaffItems badge and Today rows (the prototype excludes 'wait' at line 774). ready_for_review must not sync done=true, because the client-emails value report lists done=true tasks to clients.

**Critic:**
- State that a legacy done=true write on a review_required task becomes ready_for_review, and that ready_for_review never syncs done=true. tk_set_status re-checks tk_can_edit_task. Make groupMyTasks/TK logic the single overdue definition, and list the consumers to switch to it.


#### 2.3 Subtasks / checklist on a task
**Status:** extend · **Phase:** 1 · **Confidence:** high

**Exists:** The checklist table, RLS, presets and UI all work today.

**Missing:** Checklist items are not copied when a recurring task rolls forward. There are no true subtasks (child tasks with their own assignee, due date and status). The checklist is not in the realtime publication.

**Proposal:** Keep task_checklist_items as the checklist and reuse TCL_Checklist inside TK_Drawer. Add task_checklist_items to supabase_realtime. Patch complete_staff_item to copy unchecked checklist text into the next occurrence. Add staff_reminders.parent_id uuid references staff_reminders(id) on delete set null in migration 1 for real subtasks; the subtask UI can follow once the drawer is stable, or sooner if the Asana import needs it.

**Evidence:**
- `supabase/task-checklists.sql` 29-114 — task_checklist_items keyed by reminder_id with cascade, done_by/done_at, RLS inherited from the task; not in realtime
- `supabase/task-checklists.sql` 120-165 — staff_checklist_presets
- `components/staff/TaskChecklist.jsx` 104-423 — TCL_ checklist UI
- `supabase/tasks-notes-v3.sql` 102-212 — complete_staff_item rolls recurrence forward but does not copy checklist items

**Analyst disagreement:** UI-first deferred parent_id to phase 4. Database-first and spec-skeptic add it in phase 1. I add the column in phase 1 (cheap, and it lets the import map Asana subtasks) and leave the subtask UI flexible.

**Verification:**
- verify:2:db: agree.
- verify:2:ui: agree.

**Verifier fixes to the proposal:**
- (verify:2:db) When copying the checklist on roll-forward, also fix the source_ref copy. complete_staff_item copies source_ref into the new row, which is harmless only because template rows have recurrence 'none'. Null it out for the next occurrence, as the foundation decision says.


#### 2.4 Comments on a task with @mentions
**Status:** missing · **Phase:** 1 · **Confidence:** high

**Exists:** Notes can link to a task, and there is a client-message mention parser to copy.

**Missing:** A task comment table, mention extraction for any staff member, and a notification kind for mentions.

**Proposal:** New tk_comments (id, task_id references staff_reminders on delete cascade, author_email stamped by trigger, body 1-5000, mentions text[] filled by trigger against staff, kind CHECK in ('comment','send_back','client_reply','system'), created_at, edited_at, deleted_at). Generalize am_body_mentions into tk_parse_mentions. RLS through tk_can_read_task. An AFTER INSERT trigger inserts tk_inbox_items and notification_outbox kind 'staff_task_mention'. Add the table to realtime. The drawer has a Comments tab with @-autocomplete from the staff roster.

**Evidence:**
- `supabase/account-manager.sql` 171-332 — am_body_mentions is the only mention parser; scoped to client messages and the assigned bookkeeper
- `supabase/tasks-notes-v3.sql` 30-73 — client_private_notes.linked_task_id links a note to a task; it is not a comment thread

**Verification:**
- verify:2:db: agree.
- verify:2:ui: agree.

**Verifier fixes to the proposal:**
- (verify:2:db) Widen notification_outbox_kind_check and client_email_log_feature_check from their latest definition in tech-inventory-v2.sql:52-60, then add the new kind to the notification-emails edge function. am_body_mentions returns a boolean per email, so tk_parse_mentions has to loop over active staff or be rewritten as an extractor that returns text[].
- (verify:2:ui) Inserting kind 'staff_task_mention' into notification_outbox will fail until its kind CHECK is dropped and re-added (notification-emails.sql:46-50). The client_email_log feature CHECK (lines 68-73) and the notification-emails edge function, which needs a template and pref key, must widen too. Since am_body_mentions is execute-revoked from authenticated, tk_parse_mentions must also be SECURITY DEFINER and called only from the trigger.

**Critic:**
- Add the CHECK widening (both files) and the edge-function deploy order. Make tk_parse_mentions a SECURITY DEFINER extractor that returns text[]. Restrict mention-driven auto-follow to people who can already read the task.


#### 2.5 Attachments on a task
**Status:** missing · **Phase:** 1 · **Confidence:** medium

**Exists:** Drive-backed client_files and client_documents, plus Storage bucket patterns.

**Missing:** Any link from a task to a file or Drive link.

**Proposal:** New tk_attachments (id, task_id, client_file_id references client_files null, storage_path null, drive_url null, name, size, added_by, created_at, removed_at). For client tasks, files upload through drive-files with visibility 'internal'. For internal project tasks, they go to a private staff-only bucket 'task-files'. RLS through tk_can_read_task. Never attach through client_documents, whose staff policy lacks can_access_client.

**Evidence:**
- `supabase/google-drive-files.sql` 54-128 — client_files rows have visibility shared/internal/request/message and no task link
- `supabase/client-documents.sql` 4-20 — client_documents staff policy is is_active_staff() only, without can_access_client
- `supabase/functions/drive-files/index.ts` 277-281 — Drive upload path per client/year/doc type
- `supabase/audit2-storage-limits.sql`  — Storage bucket limits pattern

**Analyst disagreement:** UI-first put attachments in phase 2 (Drive links in the description would do for phase 1). Database-first and spec-skeptic put them in phase 1. Database-first stores them via client_files; the others use a bucket. I kept phase 1 because the drawer is phase-1 scope, and combined the storage approaches: Drive for client tasks, a bucket for internal ones.

**Verification:**
- verify:2:db: agree.
- verify:2:ui: agree.

**Verifier fixes to the proposal:**
- (verify:2:db) client_files rejects writes from authenticated users, so tk_attachments.client_file_id links must be created by the drive-files edge function with the service role, or by a SECURITY DEFINER RPC that checks tk_can_edit_task. The new task-files bucket must be private, with file_size_limit and allowed_mime_types as in audit2-storage-limits.sql. Its storage.objects select policy must check task readability through a path-encoded task id and tk_can_read_task, not the staff-chat pattern of is_active_staff() alone, which would expose files on private tasks.
- (verify:2:ui) Change the rationale for avoiding client_documents. Its staff policy already uses can_access_client (audit-hardening-client-scoping.sql:73-76, live). The real reasons: it is the client-readable document library ('client reads own documents'), and it stores only a drive_url, with no internal visibility.

**Critic:**
- Correct the rationale: client_documents does use can_access_client, so it is excluded because it is the client-readable library. Create client_files links through drive-files with the service role. Give the task-files bucket a storage policy keyed on tk_can_read_task, not is_active_staff. Drop any storage-fallback assumption (DRV_STORAGE_FALLBACK=false). Consider moving this row to phase 2.

**Decision applied (2026-10-10):** Stays in phase 1. The product owner declined trimming phase 1 (D9).


#### 2.6 Followers on a task
**Status:** missing · **Phase:** 1 · **Confidence:** medium

**Exists:** Nothing.

**Missing:** A follower list, auto-follow, and RLS that lets a follower read the task.

**Proposal:** New tk_followers (task_id, staff_email, added_at, PK both). Triggers auto-add the creator, assignee, reviewer and mentioned staff. tk_can_read_task includes followers. The drawer footer shows an avatar stack with Follow/Unfollow. Inbox fan-out (phase 3) reads tk_followers.

**Evidence:**
- `supabase/staff-reminders-v2.sql` 36-83 — only owner, assignee and created_by
- `supabase/admin-read-all-tasks.sql` 8-10 — only the owner and admins can read private rows

**Analyst disagreement:** Database-first put followers in phase 3 with the inbox. UI-first and spec-skeptic put them in phase 1. I chose phase 1 because the shared read helper tk_can_read_task and the mention flow depend on followers, and the table is trivial.

**Verification:**
- verify:2:db: agree.
- verify:2:ui: agree.

**Verifier fixes to the proposal:**
- (verify:2:db) Make tk_can_read_task and tk_can_edit_task SECURITY DEFINER with a fixed search_path, so the staff_reminders, tk_followers and task_checklist_items policies do not recurse through each other. Restrict follower inserts to the follower themselves on a task they can already read, or to task editors. Otherwise adding a follower becomes a way to grant access to private tasks.

**Critic:**
- Follower inserts are limited to self-follow on readable tasks, or to editors. tk_can_read_task is SECURITY DEFINER to avoid policy recursion.


#### 2.7 Activity log per task
**Status:** missing · **Phase:** 1 · **Confidence:** high

**Exists:** Only created_at, updated_at and completed_at.

**Missing:** An append-only log of status, assignee, due date, review and Ask-client events. Review counts and the on-time rate need it.

**Proposal:** New tk_activity (id bigserial, task_id, actor_email, kind CHECK in ('created','status','assignee','due','priority','section','comment','review_approved','review_sent_back','client_asked','client_answered','reassigned_ooo','imported'), from_value, to_value, meta jsonb, created_at). Written only by an AFTER UPDATE trigger on staff_reminders and by RPCs. No insert or delete policy for authenticated users; select uses tk_can_read_task. The drawer's Activity tab interleaves activity with comments in time order, as the prototype drawer does.

**Evidence:**
- `supabase/client-sops.sql` 47-255 — client_sop_history is the only history-table pattern in this domain
- `supabase/staff-offboarding.sql` 43-89 — before_write trigger is the hook point; no history table

**Verification:**
- verify:2:db: agree.
- verify:2:ui: agree.

**Verifier fixes to the proposal:**
- (verify:2:db) The AFTER UPDATE trigger that writes tk_activity must be SECURITY DEFINER, as audit_row_change() is, because the table has no insert policy for authenticated users. Consider modeling it on audit_log's revoke-all, admin-read pattern.
- (verify:2:ui) Model tk_activity on audit_row_change. It must be AFTER INSERT OR UPDATE (for 'created') and SECURITY DEFINER, since there is no insert policy. Actor should be coalesce(jwt email, 'system') so writes from the generator, cron and import (no JWT) still log. A plain AFTER UPDATE invoker trigger would fail under RLS and would miss creation.

**Critic:**
- Make the trigger AFTER INSERT OR UPDATE and SECURITY DEFINER, with actor coalesce(jwt email,'system'), modeled on audit_row_change.


#### 2.8 Blocked-by dependencies that shift due dates
**Status:** missing · **Phase:** 4 · **Confidence:** high

**Exists:** Nothing.

**Missing:** Dependency edges, cycle prevention and due-date shifting.

**Proposal:** New tk_dependencies (task_id, blocked_by_id, lag_business_days int default 0, PK both, CHECK task_id<>blocked_by_id). A cycle check runs in a BEFORE INSERT trigger using a recursive CTE. When a blocker's due date changes, tk_shift_dependents() moves open dependents by the same business-day delta using tk_add_business_days, mirrored in the JS shiftForDependency (tested). The drawer gets a 'Blocked by' picker and rows show a lock glyph.

**Evidence:**
- `supabase/staff-reminders-v2.sql` 36-83 — no dependency columns

**Verification:**
- verify:2:db: agree.
- verify:2:ui: agree.

**Verifier fixes to the proposal:**
- (verify:2:db) tk_add_business_days and a holiday table do not exist; the only weekend logic is JS OPS_rollWeekend. Create tk_holidays and tk_add_business_days in the same migration, with a JS mirror tested in staffOpsLogic.test.js style, before tk_shift_dependents can use them.
- (verify:2:ui) tk_add_business_days and tk_holidays do not exist. The only business-day code is OPS_rollWeekend (weekends only). Dependency shifting in phase 4 depends on the recurring-engine phase creating those first; state that dependency explicitly.


#### 2.9 Tags
**Status:** missing · **Phase:** 4 · **Confidence:** high

**Exists:** Nothing for tasks. Asana custom fields are unused, so there is little to import.

**Missing:** Firm-wide tags and task tagging.

**Proposal:** Add staff_reminders.tags text[] with a GIN index, plus a tk_tags catalog (name unique, case-insensitive, color token; admin manage, staff read) for the picker and colors. Chip input in the drawer, and tags are filterable through saved filters and bulk edit.

**Evidence:**
- `supabase/staff-reminders-v2.sql` 36-83 — no tags column
- `supabase/tasks-notes-v3.sql` 30-73 — only client_private_notes.category is close

**Analyst disagreement:** Database-first used join tables (tk_tags plus tk_task_tags). UI-first used text[] only. Spec-skeptic used text[] plus a tk_tags catalog. I chose spec-skeptic's hybrid: one-column filtering and bulk edit, with a catalog for colors. Renaming a tag means updating rows, which is acceptable at this volume.

**Verification:**
- verify:2:db: agree.
- verify:2:ui: agree.


#### 2.10 Time tracking per task with a one-tap timer
**Status:** extend · **Phase:** 4 · **Confidence:** medium

**Exists:** Passive per-client app time, QuickBooks Time actuals, and a dormant time_entries table.

**Missing:** A per-task start/stop timer that survives reloads, and rollups by task, template item, client and bookkeeper.

**Proposal:** Extend time_entries: ADD COLUMN task_id uuid references staff_reminders on delete set null, started_at, ended_at, and source CHECK in ('timer','manual','app'). A partial unique index allows one running timer per staff_email. Add RPCs tk_timer_start(task_id) and tk_timer_stop(). Rollups go in view tk_time_rollup. A TK_Timer button sits in the drawer. Keep staff_app_time as a separate passive signal and QB Time as payroll truth.

**Evidence:**
- `supabase/time-entries.sql` 55-82 — time_entries is dormant and has no task_id
- `supabase/app-time-tracking.sql` 37-131 — staff_app_time and record_app_time log time per client per day, passively
- `components/staff/AppTimeTracker.js`  — AT_ passive tracker
- `components/staff/TeamCapacity.jsx` 22-373 — QuickBooks Time vs staff_capacity, admin only
- `components/staff/HoursBudget.jsx`  — HB_ client hours budget

**Analyst disagreement:** Database-first marked this missing; UI-first and spec-skeptic marked it extend. UI-first wanted to write the timer into staff_app_time. I chose extend on time_entries (database-first and spec-skeptic): the table exists to extend, and passive app time is not task time.

**Verification:**
- verify:2:db: agree.
- verify:2:ui: agree.

**Verifier fixes to the proposal:**
- (verify:2:db) time_entries.minutes is NOT NULL with CHECK (minutes > 0), and client_id is NOT NULL. A running timer row, or a timer on an internal project task with no client, would fail. Make minutes nullable with CHECK (ended_at is null or minutes > 0), computed in tk_timer_stop, and allow a null client_id when task_id is set. Timer minutes will also feed staff_performance hours through the te CTE fallback. Exclude source='timer' there, or accept that it changes the hours metric.
- (verify:2:ui) time_entries.minutes is NOT NULL CHECK (minutes > 0), and client_id is NOT NULL. tk_timer_start cannot insert a running row, and internal project tasks have no client. Make minutes nullable with CHECK (ended_at IS NULL OR minutes > 0), or compute it at stop, and relax client_id (or require project_id when it is null). Update the staff_performance te CTE (staff-celebrations-performance.sql:266-276) to skip running rows and decide whether timer minutes should count as hours when there is no QB Time. Note that the 'staff read client time entries' policy shows timer rows to teammates on that client.

**Critic:**
- Make minutes nullable with CHECK (ended_at is null or minutes > 0). Allow a null client_id when task_id is set. Exclude running rows from the staff_performance te CTE. Split the phases: timer in phase 2 or 3, rollups in phase 4, per the brief.


#### 2.11 Quick add
**Status:** extend · **Phase:** 1 · **Confidence:** high

**Exists:** A top-bar quick add and an inline reminder add, both writing staff_reminders through staffItemsApi.add.

**Missing:** Inline parsing of client, assignee, due date ('fri', 'bd5') and priority. Defaults for section and status. Opening the drawer on the new task.

**Proposal:** New TK_QuickAdd modal, opened by the 'q' shortcut and the 'tb:quick-add' event. One line with tokens '@person', '#client', a date phrase or 'bd5', and '!high', parsed by a tested parseQuickAdd in the TK logic file. It calls staffItemsApi.add (extended for the new columns), then opens the drawer. Fold TD_RemindersCard's add into it.

**Evidence:**
- `components/staff/TopBar.jsx` 955 — TB_QuickAdd dispatches 'tb:quick-add'
- `components/staff/TopBar.jsx` 347-353 — 'New reminder' palette action goes to #/work/tasks
- `components/staff/Today.jsx` 757-843 — TD_RemindersCard inline add

**Verification:**
- verify:2:db: agree.
- verify:2:ui: agree.

**Verifier fixes to the proposal:**
- (verify:2:db) tb:quick-add already opens StaffQuickActions' task modal on client pages. If TK_QuickAdd also listens, two modals open. Remove the task branch from StaffQuickActions, or have TB_QuickAdd dispatch a distinct event for tasks, and render TB_QuickAdd without a client, since it currently returns null.
- (verify:2:ui) TK_QuickAdd must work with no client open, since TB_QuickAdd returns null without one. Retire or reroute StaffQuickActions' 'tb:quick-add' task modal so there are not two task-add dialogs. The 'q' shortcut would be the app's first single-key shortcut, so it must ignore input, textarea, select and contenteditable, IME composition, and modifier keys.

**Critic:**
- Reroute the StaffQuickActions task branch so only one task modal opens. Make TB_QuickAdd render with no client open. Make the single-key 'q' guard ignore inputs, IME composition and modifier keys.


#### 2.12 Bulk edit
**Status:** missing · **Phase:** 4 · **Confidence:** high

**Exists:** Nothing.

**Missing:** Multi-select, a bulk action bar, and a server path that changes many rows atomically and logs activity.

**Proposal:** Add RPC tk_bulk_update(p_ids uuid[], p_patch jsonb), SECURITY INVOKER so RLS applies per row. It accepts a whitelist of keys (assignee_email, due_date or due shift, status via the transition check, priority, section, tags) and writes tk_activity. The UI is a TK_List checkbox column with shift-click range select and a sticky TK_BulkBar.

**Evidence:**
- `app.jsx` 18142-19522 — MyTasksPage has no multi-select

**Verification:**
- verify:2:db: agree.
- verify:2:ui: agree.

**Verifier fixes to the proposal:**
- (verify:2:db) With tk_bulk_update as SECURITY INVOKER, a direct insert into tk_activity fails because there is no insert policy. Let the definer AFTER UPDATE trigger log activity, and route any status keys through tk_set_status rather than writing status directly.
- (verify:2:ui) staff_reminders_before_write silently resets staff_email, created_by, client_id and visibility for non-owners instead of raising an error. A SECURITY INVOKER tk_bulk_update would report success while a bulk client or visibility change did nothing. Return per-row applied and skipped results, and compare the updated row with the patch.


#### 2.13 Global search across tasks and clients
**Status:** extend · **Phase:** 1 · **Confidence:** high

**Exists:** Cmd-K search already covers clients, the user's own tasks, notes, SOPs and help, searched client-side.

**Missing:** A deep link to a single task. Search over description, comments and other people's or shared tasks. Server-side search for the roughly 8-10k imported tasks a year.

**Proposal:** Add a generated tsvector column staff_reminders.search_tsv (text plus description) with a GIN index, and RPC tk_search(q, limit 20) over tasks and comments with RLS applied. TB_Search's Tasks group calls it and routes hits to #/tasks/t/<id>, which opens the drawer over the current view.

**Evidence:**
- `components/staff/TopBar.jsx` 382-407 — TB_Search, Cmd/Ctrl+K
- `components/staff/TopBar.jsx` 504-506 — a 'Tasks' result group already exists (mine.filter(kind !== 'note')), but hits go to #/work/tasks, not to the task
- `components/staff/TopBar.jsx` 595-620 — placeholder: 'clients, tasks, SOPs and help'

**Analyst disagreement:** UI-first said the palette has no task results. TopBar.jsx:506 shows a Tasks group already exists, so I followed database-first and spec-skeptic: the gap is deep links and server-side scope.

**Verification:**
- verify:2:db: agree.
- verify:2:ui: agree.

**Verifier fixes to the proposal:**
- (verify:2:db) Model search_tsv and tk_search on staff_guide.search_tsv and search_staff_guide (a generated weighted tsvector, a GIN index, a SECURITY INVOKER function using websearch_to_tsquery). The title column is named text, so quote it as "text" in the generated expression, and filter out deleted_at rows.
- (verify:2:ui) Do not invent #/tasks/t/<id>. The in-progress DeepLink.jsx grammar is #/<place>[/<tab>]?item=task:<id> (the path holds view state; the query is a one-time pointer stripped at boot), with LK_PLACE_CLAIMS 'work/tasks' and LK_COPY task fallbacks already defined. TK views should claim task arrivals with LK_useArrival, and LK_PLACE_CLAIMS should gain the new 'tasks' place.

**Critic:**
- Use the LK_ grammar (?item=task:<id>, with a 'tasks' place added to LK_PLACE_CLAIMS) instead of #/tasks/t/<id>. Model the search on search_staff_guide, and quote "text". Consider phase 2.

**Decision applied (2026-10-10):** Stays in phase 1. The product owner declined trimming phase 1 (D9).


### Area 3 Views

#### 3.1 My Tasks grouped Overdue / Today (tentative) / This week / Later, plus a Waiting on client section (brief wording: Overdue / This week / Waiting on clients / Later)
**Status:** extend · **Phase:** 1 · **Confidence:** high

**Exists:** Date-based grouping on Today and tabbed lists on MyTasksPage.

**Missing:** A Waiting on clients group (needs status) and a Later group. Collapsible groups and a drawer. My Tasks queries owner rows, not assignee rows.

**Proposal:** New TK_MyTasks (components/tasks/TK_MyTasks.jsx) with 4 collapsible groups from a tested groupMyTasks(tasks, today). Overdue = due < today and status not in (done, waiting_client). Waiting = waiting_client. This week = due within the business week. Later = the rest. The query filters assignee_email = me and deleted_at is null. Rows are a shared TK_TaskRow (checkbox, title, client chip, due, status pill), and clicking one opens TK_Drawer. Mount it at #/tasks/my and in WK_WorkPage at #/work/tasks. Retire MyTasksPage once it matches.

**Evidence:**
- `components/staff/Today.jsx` 330-595 — TD_buildRows groups into Now / This week; no Waiting or Later band
- `app.jsx` 18142-19522 — MyTasksPage has tabs today/upcoming/overdue/all/byclient and queries owner rows
- `components/staff/WorkPage.jsx` 51-106 — WK_WorkPage mounts MyTasksPage at #/work/tasks

**Verification:**
- verify:3:db: agree.
- verify:3:ui: agree.

**Verifier fixes to the proposal:**
- (verify:3:db) The assignee_email = me query only works after the RLS extension. Today no policy lets a non-owner assignee read a private row (staff-reminders-v2.sql:159-191). Make TK_MyTasks depend on tk_can_read_task, which includes assignee_email = auth.jwt()->>'email', landing first, or keep the current .or(staff_email, shared) fetch plus an isMyStaffItem filter until then. Name the group 'Waiting on client' and keep it distinct from Today's 'waiting' (client threads waiting on staff), so Today's Now band and My Tasks do not use one word for opposite directions.
- (verify:3:ui) (a) The query filter assignee_email = me returns nothing for rows other people own until the RLS change (tk_can_read_task with an assignee clause) ships. Today's policies are owner-or-shared only. Sequence the view after that policy, and compare lowercased emails: notification-emails.sql lowercases assignee_email, while the staff-reminders-v2 policies compare raw JWT email. (b) 'This week = business week' conflicts with the rolling 7-day 'This week' in Today (TD_SOON_DAYS = 7) and MyTasks Upcoming. Since Today will read TK logic, define one rule in groupMyTasks. Say what happens on Saturday and Sunday (the brief's prototype TODAY is a Saturday), and put undated tasks in Later explicitly (Today currently drops them). (c) 'Retire MyTasksPage once it matches' must first rehome its Notes card, SOPs card, By client handoff cards and v1 legacy fallback, then repoint the 'my-tasks' help slug and the guide pages.

**Critic:**
- Sequence after tk_can_read_task. Define This week (pick rolling 7 days or business week, and apply it to Today too), weekend behavior and undated tasks going to Later. Rehome the MyTasksPage Notes, SOPs, By client and legacy cards, plus the my-tasks help slug, Tips and staff-guide pages, before retiring it.

**Decision applied (2026-10-10):** Groups are Overdue / Today / This week / Later, with Waiting on client as its own section (the product owner: 'today maybe', so the Today group is tentative and can collapse into This week if it feels noisy). Due dates are calendar days, so This week is the rolling 7 days Today.jsx already uses. Default views hide done tasks older than 12 months, with a 'Show older' toggle (D5).


#### 3.2 List view
**Status:** extend · **Phase:** 1 · **Confidence:** high

**Exists:** A personal flat list with a by-client tab.

**Missing:** A list per client, project or person with section grouping, inline add per section, columns and sorting.

**Proposal:** New TK_List (#/tasks/c/<client>/list, #/tasks/p/<project>/list), grouped by section and ordered by sort_key. It has an 'Add task' row per section and column headers (Assignee, Due, Status, Priority) with sort. Filters: client_id, project_id, assignee, section, status, period. It shares TK_TaskRow with My Tasks and is reused by client and project pages and by list presets (review queue, waiting).

**Evidence:**
- `app.jsx` 18142-19522 — MyTasksPage flat list; the by-client tab is the nearest
- `components/staff/WorkPage.jsx` 51-106 — Work tabs
- `docs/tasks-prototype.dc.html` 253-373 — project list with sections

**Verification:**
- verify:3:db: agree.
- verify:3:ui: agree.

**Verifier fixes to the proposal:**
- (verify:3:db) A per-person list is readable only by admins today (admin-read-all-tasks.sql) and is read-only for them. Either scope the 'person' filter to admins in phase 1, or make sure tk_can_read_task covers assignee, reviewer and follower before shipping it. Carry over the existing client and mine/shared scope filters from MyTasksPage instead of re-deriving them. client_id is text (app-config clients), so filter values must be the text ids, not uuids.
- (verify:3:ui) A list 'per person' works for non-admins only after tk_can_read_task exists. For admins, the existing admin policy is SELECT-only, so inline edits on someone else's private row fail at the RLS update check. Either make the edit controls read-only for those rows, or route edits through tk_set_status and a security-definer RPC. Reuse TP_TaskGroups or TP_taskState for the admin person view rather than building a third grouping. Client-scoped routes like #/tasks/c/<client>/list need 'tasks' added to HASH_SUB_ROUTE_PAGES and a TK parser for segments 3 and up, because NAV_subFromHash reads only segment 2. Client ids are free text, and buildHashRoute keeps only [a-z0-9-] segments.

**Critic:**
- Make the per-person filter admin-only and read-only until the edit RPCs exist. Reuse TP_TaskGroups/TP_taskState. Add 'tasks' to HASH_SUB_ROUTE_PAGES and a segment-3+ parser. Encode client ids.

**Decision applied (2026-10-10):** The per-person filter is admin-only. Bookkeepers see rows for their assigned and granted clients only (D3).


#### 3.3 Board view
**Status:** missing · **Phase:** 3 · **Confidence:** high

**Exists:** Only the prototype.

**Missing:** Status columns with drag.

**Proposal:** New TK_Board with columns by status (default) or section. It uses native HTML5 drag with a keyboard fallback through the status menu. A drop calls tk_set_status so transitions and the review gate are enforced on the server. At phone width it becomes a status-tab list or swipeable snap panes.

**Evidence:**
- `components/staff/CloseTracker.jsx` 188-575 — a clients-by-months grid, not a status board
- `docs/tasks-prototype.dc.html` 253-373 — board toggle on the project screen

**Verification:**
- verify:3:db: agree.
- verify:3:ui: agree.

**Verifier fixes to the proposal:**
- (verify:3:db) Use HTML5 drag on desktop only. WD_useDragReorder's notes record that native drag-and-drop failed on touch, so touch and tablet should use the status menu or tabs on every touch device, not just at phone width. Keep board status (task status) separate from month_close.status ('review' and 'na' are period states), and never write month_close from a board drop.
- (verify:3:ui) Do not gate drag on width alone. WidgetDrawer documents that native HTML5 drag-and-drop on touch failed on real devices. At tablet widths (768px and up) with a touch pointer, the board still needs the per-card status menu as the move path. Use (pointer: coarse) or a no-drag fallback, not just the phone breakpoint.

**Critic:**
- Gate drag on (pointer: fine), not width. Touch devices use the status menu (WD_useDragReorder finding).


#### 3.4 Calendar view
**Status:** missing · **Phase:** 3 · **Confidence:** high

**Exists:** No task calendar, but the Deadlines page already has a month grid to borrow.

**Missing:** A task calendar by due date.

**Proposal:** New TK_Calendar (#/tasks/my/calendar, #/tasks/c/<client>/calendar) reusing the DL_ month grid markup and styles. Data comes from the TK_List query ranged by due_date. Weekends and tk_holidays are shaded, and firm deadlines show as read-only markers. At phone width it becomes an agenda list.

**Evidence:**
- `components/staff/Deadlines.jsx` 294-345 — DL_monthGrid and DL_MonthView: an existing month grid (role=grid, prev/next month) for firm deadlines that can be reused

**Analyst disagreement:** UI-first said Deadlines is list-only. Deadlines.jsx:305 DL_MonthView is a month grid, so I followed database-first: reuse it.

**Verification:**
- verify:3:db: agree.
- verify:3:ui: agree.

**Verifier fixes to the proposal:**
- (verify:3:db) Deadline markers must come from DL_useStore + OPS_deadlineItems (rules + overrides + status + client_profile computed on the client), not from a table query. tk_holidays does not exist, and OPS_rollWeekend deliberately ignores holidays. Add tk_holidays with RLS (staff read, admins write) before the calendar shades holidays. Changing OPS_rollWeekend to use it changes live deadline dates, so the firm-deadlines.sql and Deadlines.jsx disclaimers ('holidays don't') and staffOpsLogic.test.js must change with it.
- (verify:3:ui) Only DL_monthGrid and the .dl-* CSS can be reused. DL_MonthView reads deadline fields (rule_name, client_name, state). Move DL_monthGrid into staffOpsLogic.js as a tested OPS_ helper (it already exports for tests) so TK_Calendar does not call another prefix's private function. The grid already degrades to dot chips plus a selected-day list at 640px, so the phone 'agenda list' can reuse that instead of a new layout. tk_holidays does not exist yet: it is new, and OPS_rollWeekend currently ignores holidays.

**Critic:**
- Move DL_monthGrid into staffOpsLogic.js as a tested OPS_ helper. Deadline markers come from DL_useStore + OPS_deadlineItems. Any OPS_rollWeekend holiday change must update the Deadlines copy and tests.


#### 3.5 Saved filters
**Status:** missing · **Phase:** 3 · **Confidence:** high

**Exists:** Nothing. The tabs are hard-coded.

**Missing:** Named, shareable filter definitions with URLs.

**Proposal:** New tk_saved_filters (id, owner_email, name, filter jsonb, shared boolean, sort_order). RLS: the owner manages; staff read shared ones. A filter-bar chip row shows them, and each serializes to #/tasks/v/<id>. The review queue and waiting list ship as built-in presets.

**Evidence:**
- `app.jsx` 24027-24060 — hash routes carry no filter state
- `supabase/user-settings.sql` 55-107 — user_settings key-value store; no saved views

**Verification:**
- verify:3:db: agree.
- verify:3:ui: agree.

**Verifier fixes to the proposal:**
- (verify:3:db) Follow the user_settings convention: owner_email default lower(auth.jwt()->>'email'), with a before-write guard trigger that forces it (like user_settings_guard) so clients cannot spoof the owner. Use policies 'owner all' and 'is_active_staff() and shared' for select; revoke anon. Keep personal-only UI state (collapsed groups, last view) in user_settings.settings via ST_store, not in the new table. Fix the routing evidence citation to app.jsx:24175-24260.
- (verify:3:ui) Serialize only the view id in the URL (#/tasks/v/<uuid>), never the filter jsonb. Filters hold assignee emails, and DeepLink.jsx forbids emails or free text in URLs and strips query strings. Stamp owner_email from the JWT in a guard trigger, as user_settings and user_board_layouts do, rather than trusting the client. Private-only views could live in user_board_layouts (board_key 'tasks'); only shared views need the new table. Add 'tasks' to HASH_SUB_ROUTE_PAGES or the route resets to #/tasks.

**Critic:**
- Put only the view id in the URL. Add a JWT-stamped owner guard trigger. Keep personal UI state in user_settings or user_board_layouts.


#### 3.6 Keyboard-first navigation and shortcuts
**Status:** missing · **Phase:** 1 · **Confidence:** high

**Exists:** Only the Cmd-K search shortcut, which is covered under 2.13.

**Missing:** All task shortcuts: j/k move, Enter opens, Esc closes, x toggles done, s status, a assign, c or q create, e edit, g m My Tasks, g i Inbox, and a ? help sheet.

**Proposal:** A TK_useKeys hook scoped to the TK_ shell that ignores inputs and contenteditable. The keymap lives in the TK logic file and feeds a ? cheat-sheet ModalShell. Ship j/k/Enter/Esc/x/q/s/a in phase 1, since this is the main speed gap for staff leaving Asana.

**Evidence:**
- `components/staff/TopBar.jsx` 397-407 — Cmd/Ctrl+K is the only global shortcut
- `docs/tasks-prototype.dc.html`  — no shortcuts in the prototype

**Analyst disagreement:** UI-first and spec-skeptic marked this extend because Cmd+K exists; database-first marked it missing. I chose missing because none of the feature (task shortcuts) exists. All three agreed on phase 1.

**Verification:**
- verify:3:db: agree.
- verify:3:ui: agree.

**Verifier fixes to the proposal:**
- (verify:3:db) Put the keymap in one place that both the ? ModalShell and Settings > Keyboard shortcuts (Settings.jsx:1184) render, so the two never drift. q/c should dispatch TB_QUICK_ADD_EVENT (or TK_QuickAdd, which replaces it) rather than open a third create modal. TK_useKeys must ignore events whose Esc an open menu already handled (TopBar menus call stopPropagation) and must skip while ModalShell or a focus-trapped drawer is open.
- (verify:3:ui) TK_useKeys must defer to existing handlers. It should ignore keys when a ModalShell, SI_ChatDrawer-style trap, TopBar search or ClientSwitcher menu is open; check document.activeElement and defaultPrevented. It must not bind Cmd/Ctrl+K, which TB_Search owns. Register in the bubble phase so the capture-phase modal traps (app.jsx ~22086, WidgetDrawer 751, Tour 1538) win.


### Area 4 Recurring engine

#### 4.1 Per-client template built on the MGB Standard Monthly Close plus client-specific items
**Status:** extend · **Phase:** 2 · **Confidence:** medium

**Exists:** Firm-level templates that generate tasks for clients picked by plan tier or client_ids, an admin editor, and a hard-coded close checklist. Each task_templates row already acts as one recurring item.

**Missing:** A standard set that clients inherit, with per-client skips, overrides and client-only items. Bookkeepers cannot edit their clients' items. 'MGB Standard Monthly Close' exists only as a JS constant.

**Proposal:** Keep each task_templates row as one recurring item, so the task_template_issued ledger keeps working unchanged. Add task_templates.template_set_id, client_id (null = firm item, set = client-only item), status ('draft','active'), sop_section, review_required, assignee_role ('bookkeeper','backup','reviewer') and estimate_minutes. New tk_template_sets (id, name, is_standard), seeded with 'MGB Standard Monthly Close' from CLOSE_CHECKLIST. New tk_client_template_overrides (client_id, template_id, skip boolean, override jsonb, PK both) for inherited items. The generator resolves: standard set items, minus the client's skips, with overrides applied, plus client-only items. RPC tk_save_client_item lets the client's bookkeeper manage their client's items without opening admin RLS. UI: TK_Templates at #/tasks/templates (firm standard, admin) and a Recurring tab on the client page (inherited items greyed with 'Skip for this client', plus 'Add client item'), reusing TT_Editor pieces.

**Evidence:**
- `supabase/task-templates.sql` 57-114 — task_templates: cadence, due_offset_days, lead_days, plan_tiers, client_ids, priority, checklist text[]; admin-only RLS; one template = one task per client per period; 0 live rows
- `supabase/task-templates.sql` 116-137 — task_template_issued PK (template_id, client_id, period)
- `components/staff/TaskTemplates.jsx` 171-658 — TT_ admin editor
- `app.jsx` 5248 — CLOSE_CHECKLIST six-step close is a hard-coded constant
- `supabase/staff-client-tools.sql` 170-185 — client_close_items (client_id, period, item_key) per-client close extras

**Analyst disagreement:** Database-first kept task_templates as item definitions plus tk_template_sets and a tk_client_template_items table (inherit_off, override, client_only). UI-first replaced it with new tk_template_sets and tk_template_items. Spec-skeptic added base_template_id and client_id plus a child tk_template_items. I chose task_templates-as-item with a client_id for client-only items and a thin overrides table, because client-only items must stay task_templates rows for the task_template_issued FK and idempotency key to hold. UI-first's migration to new tables is unnecessary with 0 rows and a working ledger.

**Verification:**
- verify:4:db: agree.
- verify:4:ui: agree.

**Verifier fixes to the proposal:**
- (verify:4:db) A client-only item (task_templates.client_id set, plan_tiers and client_ids empty) matches EVERY client under the existing join, because the generator treats both arrays empty as all clients (task-templates.sql:219-223). Do one of two things in the same migration. Either replace the generator so it filters 'client_id is null or c.id = t.client_id', or write client_ids = array[client_id] and add CHECK (client_id is null or client_ids = array[client_id]). Do not let the old generator run against the new rows.
- (verify:4:db) Do not migrate client_close_items rows into client-only items. They are done ticks for the six standard CLOSE_CHECKLIST keys, not client-specific items. Map them to the done state of the matching period tasks, converting text 'YYYY-MM' to a first-of-month date, or keep them as read-only history. Keep CLOSE_CHECKLIST, or a shim, until HomeCards.jsx and StaffInbox.jsx stop reading it.
- (verify:4:db) tk_save_client_item must be SECURITY DEFINER, check is_active_staff() and can_access_client(p_client_id), and refuse to edit rows where client_id is null (firm items). Bookkeepers then edit only their own client's overrides and items. The Recurring tab needs a staff-readable path to task_template_issued, an RPC or view, because its RLS is admin-only.
- (verify:4:ui) The current generator treats an empty plan_tiers plus an empty client_ids as 'every client' (task-templates.sql:218-222). A client-only item added with only the new client_id column would fan out to every client until tk_generate replaces the body. Either ship the columns and the new generator in one migration, or store client-only items with client_ids = array[client_id] and add a CHECK that client_id is null or client_ids = array[client_id]. Draft rows must also be excluded: the generator filters only 'active', so drafts need active=false or a status filter. The Recurring tab needs a read path too. task_templates has a single admin-only FOR ALL policy, so bookkeepers need a select policy (can_access_client(client_id) for client-only items, plus firm items) or an RPC, not only tk_save_client_item for writes.

**Critic:**
- Use client_ids = array[client_id] (or a CHECK that ties client_id to it). Ship the new generator in the same migration. Map client_close_items to period-task done state, not client-only items. Keep CLOSE_CHECKLIST until HomeCards and StaffInbox stop reading it. Add a staff read path (RPC) for task_templates and task_template_issued. Make tk_save_client_item SECURITY DEFINER with can_access_client.


#### 4.2 Cadence weekly / monthly / quarterly / annual
**Status:** extend · **Phase:** 2 · **Confidence:** high

**Exists:** Templates cover monthly, quarterly and annual. Per-task recurrence on staff_reminders covers daily, weekly, monthly and month-end. These are two engines.

**Missing:** Weekly cadence on templates, which the Asana Weekly sections need, and a weekly period key.

**Proposal:** Widen the task_templates cadence CHECK to add 'weekly' (with a weekday column) by dropping and re-adding the constraint, so existing data is unchanged. Extend the generator's period series with a week branch. task_template_issued.period stores the week's Monday date. Keep per-task recurrence for personal and ad-hoc items; it is not migrated into templates. Fix its collisions (see 4.6) so the two engines cannot double-generate.

**Evidence:**
- `supabase/task-templates.sql` 71 — cadence CHECK is monthly/quarterly/annually only
- `supabase/task-templates.sql` 205-214 — period generation series handles month, quarter and year only
- `supabase/staff-reminders-v2.sql` 52-55 — per-task recurrence CHECK none/daily/weekly/monthly/month_end
- `supabase/tasks-notes-v3.sql` 102-212 — complete_staff_item rolls per-task recurrence forward

**Analyst disagreement:** Spec-skeptic wanted to retire per-item recurrence by converting each to a one-item template. Database-first and UI-first keep it for ad-hoc items. I kept it: templates are client and period scoped with admin RLS and no daily cadence, so personal daily or weekly reminders do not fit, and converting them would be a destructive change to live behavior.

**Verification:**
- verify:4:db: agree.
- verify:4:ui: agree.

**Verifier fixes to the proposal:**
- (verify:4:ui) Every CASE in tt_generate_template_tasks (period_end, date_trunc unit, step interval, v_label) uses 'else' for year, as do TT_nextDue and TT_offsetText. Widening the CHECK to 'weekly' before those branches change would generate weekly templates as annual. Widen the CHECK in the same migration as the generator and UI change. Use date_trunc('week', ...), which is Monday in Postgres, so it matches the 'Monday' period key. Update TT_stripPeriod for the weekly label.

**Critic:**
- Widen the cadence CHECK in the same migration as the generator's week branches (every CASE else defaults to year), plus TT_nextDue, TT_offsetText and TT_stripPeriod.


#### 4.3 Due rules including business-day N
**Status:** missing · **Phase:** 2 · **Confidence:** high

**Exists:** A calendar offset from period end, and a weekend roll in the browser only.

**Missing:** Rule types for business day N of the next month, day of month with roll, last business day with offset, and nth weekday (including the COO-SOP 4th/14th/24th dates). A holiday calendar. SQL business-day math that matches the JS.

**Proposal:** Add task_templates.due_rule jsonb, for example {type:'business_day',n:5,month_offset:1} | {type:'day_of_month',day:15,roll:'next_business'} | {type:'eom',offset_bd:-2} | {type:'nth_weekday',n:2,dow:2} | {type:'offset',days:N}. Backfill existing rows to {type:'offset',days:due_offset_days}. New tk_holidays (day date PK, name), seeded with US federal holidays plus any bank or firm-closed days the product owner confirms. SQL functions tk_is_business_day(date), tk_add_business_days(date,int) and tk_business_day_of_month(year,month,n), mirrored in tkRecurrenceLogic.js. Both are tested against one shared fixtures JSON, with a SQL self-check script running the same vectors. OPS_rollWeekend and TT_nextDue move onto the shared logic.

**Evidence:**
- `supabase/task-templates.sql` 215-225 — due = period_end + due_offset_days in calendar days
- `components/staff/staffOpsLogic.js`  — OPS_rollWeekend rolls weekends only; there is no holiday table
- `components/staff/staffOpsLogic.test.js`  — tests cover the weekend roll only
- `supabase/client-emails.sql` 31-231 — doc chaser cadence in calendar days
- `components/staff/TaskTemplates.jsx`  — TT_nextDue preview logic is untested

**Verification:**
- verify:4:db: agree.
- verify:4:ui: agree.

**Verifier fixes to the proposal:**
- (verify:4:ui) Mirror or reuse the existing firm_deadline_rules.due_rule jsonb (firm-deadlines.sql 272-295) and its 'annual' cadence vocabulary, so the firm doesn't end up with two incompatible due_rule shapes. If OPS_rollWeekend moves onto tk_holidays, the Deadlines copy that says holidays don't roll (Deadlines.jsx:18, Tips.jsx:323, firm-deadlines.sql:273) must change in the same release.

**Critic:**
- Align the due_rule shape with firm_deadline_rules.due_rule. State the default rule for new monthly items, pending the product owner's answer (open question 2). Make this the first phase-2 migration, since 6.4, 8.1 and 2.8 depend on tk_add_business_days.

**Decision applied (2026-10-10):** Default due rule for monthly items is a calendar-day offset (the existing due_offset_days meaning). The business-day rule type is still built and tested, because nudges use 3 business days and some items may want it, but it is opt-in per item.


#### 4.4 Tasks generated N days ahead by a scheduled function
**Status:** extend · **Phase:** 2 · **Confidence:** high

**Exists:** A daily pg_cron generator with lead_days, an idempotent issued ledger, source_ref '<tpl>:<client>:<period>', and a checklist copy.

**Missing:** Business-day due rules, the set and override resolver, role-based assignee resolution that is aware of out-of-office, the test_only filter, period and template links on generated rows, and a re-runnable cron. The notify trigger skips rows with no JWT, so generated tasks never send an assignment notice.

**Proposal:** Write tk_generate(p_today) and keep tt_generate_template_tasks and tt_generate_now as wrappers. It resolves sets and overrides, computes due dates with the business-day rules, adds 'and not c.test_only', assigns by assignee_role through tk_client_people (with the OOO backup), sets template_id, period_start and sop_section, and copies SOP steps or the checklist. Reschedule with the unschedule-if-exists guard. Add a dry-run variant behind 'Preview next 30 days' in TK_Templates. Generated tasks feed the daily digest rather than instant emails.

**Evidence:**
- `supabase/task-templates.sql` 62,73 — lead_days integer default 14, CHECK 0-90: a per-template lead time exists
- `supabase/task-templates.sql` 183-277 — tt_generate_template_tasks generates within lead_days; its client join (lines 218-222) has no test_only exclusion
- `supabase/task-templates.sql` 262-266 — copies the template checklist into task_checklist_items
- `supabase/task-templates.sql` 279-301 — tt_generate_now plus cron task-templates-daily '15 10 * * *' scheduled with no unschedule guard
- `supabase/notification-emails.sql` 250-252 — existing unschedule-then-schedule guard pattern to copy
- `supabase/clients-roster.sql` 28 — clients.test_only

**Analyst disagreement:** Spec-skeptic said there is no per-template lead time. task-templates.sql:62 and :225 show lead_days already drives generation, so I followed database-first and UI-first.

**Verification:**
- verify:4:db: agree.
- verify:4:ui: agree.

**Verifier fixes to the proposal:**
- (verify:4:db) Correct what_is_missing on notices. Cron-generated rows are skipped as self-assigned (created_by falls back to staff_email), while admin 'Generate now' rows do send staff_task_assigned. Making the digest the only route needs an explicit skip for source='template' in notify_enqueue_task_assigned. Keep the unschedule guard for convention; pg_cron already upserts by job name.
- (verify:4:db) When tk_generate assigns to an OOO backup, make sure the backup can see the row. Either set staff_email to the backup, which the owner policy covers, or confirm can_access_client(client) for the backup, through staff_client_access or an approved grant, before assigning. Otherwise the shared-row policy hides the task from its assignee.
- (verify:4:ui) 'Generated tasks feed the daily digest rather than instant emails' also needs a change to notify_enqueue_task_assigned. An admin's 'Generate now' runs with a JWT, so created_by = admin and the trigger queues one staff_task_assigned email per generated task today. Add a source = 'template' (and 'import') early return beside the existing 'access_request' one. Also add the 'and not c.test_only' filter to the dry-run preview so its counts match.

**Critic:**
- Correct the notice claim: cron rows are skipped and Generate-now rows email. Add a source='template'/'import' skip to notify_enqueue_task_assigned. State what notifies generated tasks in phase 2, before the digest exists. Verify the backup can see the task before assigning it.

**Decision applied (2026-10-10):** Generator assigns to the client's bookkeeper. Review routing goes to the default reviewer (the Account Manager) or the per-client override, never to another bookkeeper. Due dates come from the calendar-day offset by default; the business-day rule applies only to items that opt in (D2).


#### 4.5 Period object (open / in review / closed) with sign-off
**Status:** extend · **Phase:** 2 · **Confidence:** medium

**Exists:** A per-client monthly close row that already drives the client reports-ready email, CloseTracker and the close KPI.

**Missing:** Who signed off and when, a reopen reason, links from tasks to periods, an automatic move to review when the period's work is finished, realtime, and quarterly and annual periods.

**Proposal:** Make month_close the period store; do not create a parallel table. ADD COLUMN signed_off_by, signed_off_at, reopened_reason, reviewer_email. UI labels: open = not_started or in_progress, in review = review, closed = done. Add staff_reminders.period_start date, with a composite FK (client_id, period_start) to month_close(client_id, period); the generator upserts the month_close row first. A trigger may move a period to 'review' when every period task is ready_for_review or done, but only RPC tk_sign_off_period(client, period), allowed for the reviewer or an admin, may set 'done', because 'done' emails clients. Add month_close to realtime. Weekly tasks do not attach to a period. Quarterly and annual periods: the current PK (client_id, period) would collide, since Q1 and January share 2026-01-01. If the product owner wants quarterly or annual sign-off, add period_kind and widen the PK to (client_id, period_kind, period) in a data-preserving migration (trivial at 0 rows), updating CloseTracker and the reports-ready trigger to filter period_kind='month'. An optional view tk_periods can give the module a clean name.

**Evidence:**
- `supabase/month-close.sql` 25-40 — month_close PK (client_id, period date), period must be first of a month, status not_started/in_progress/review/done/na, no signed_off_by/at, not in realtime, 0 rows
- `supabase/notification-emails.sql` 197-219 — notify_enqueue_reports_ready fires on status done
- `supabase/staff-celebrations-performance.sql` 160-350 — close_pct reads month_close.updated_at
- `components/staff/CloseTracker.jsx` 188-575 — CT_ grid over month_close
- `supabase/qbo-close-checks.sql` 74-321 — close_checks advisory QBO checks
- `supabase/staff-client-tools.sql` 170-185 — client_close_items is a second close checklist

**Analyst disagreement:** All three extend month_close. Spec-skeptic wanted to rename it to tk_periods through a view. Database-first added period_kind including 'week', but month-close.sql:33-34 requires first-of-month dates and the PK would collide across kinds, so weekly is dropped and quarter/year depends on a PK change. UI-first's period_id cannot work because month_close has no id column, so I used a composite key. I accepted UI-first's auto-advance to review, limited by database-first's rule that only sign-off sets done.

**Verification:**
- verify:4:db: agree.
- verify:4:ui: agree.

**Verifier fixes to the proposal:**
- (verify:4:db) 'Only tk_sign_off_period may set done' is not enforceable with the current RLS: any staff with access can upsert status='done', and CloseTracker.jsx:305-308 does. Add a BEFORE trigger on month_close that rejects a move to 'done' unless a transaction-local setting (e.g. mgb.tk_signoff='on', set by the RPC) is present, then switch CT_ to the RPC in the same release.
- (verify:4:db) The composite FK staff_reminders(client_id, period_start) -> month_close must be ON DELETE SET NULL (period_start), the column-list form available in PG15+. Plain SET NULL would also null client_id and violate staff_reminders_shared_needs_client on shared rows. RESTRICT would break the admin delete policy.
- (verify:4:db) Set period_start only for monthly-cadence tasks. Quarterly and annual template periods start on the first of a month (e.g. 2026-01-01), so they would silently attach to the January month_close row until period_kind exists.
- (verify:4:db) The close KPI treats mc.updated_at as the done time (staff-celebrations-performance.sql:229-231). Writing signed_off fields, reviewer_email or a reopen reason after done would push updated_at past the deadline and mark the close late. Change the KPI to coalesce(signed_off_at, updated_at), or stamp signed_off_at in the same write that sets 'done'.
- (verify:4:ui) (a) ON DELETE for the composite FK staff_reminders(client_id, period_start) -> month_close(client_id, period): plain SET NULL would also null client_id and break staff_reminders_shared_needs_client, and RESTRICT blocks the admin delete policy. Use ON DELETE SET NULL (period_start) (PG15+). (b) 'Only tk_sign_off_period may set done' needs a BEFORE UPDATE/INSERT guard on month_close (for example a session flag like mgb.tk_approve). Today RLS lets any staff member with client access set done, and CloseTracker.jsx 306-307 upserts status directly, so CloseTracker's done action must switch to the RPC. (c) A period_kind PK widening must also update client_health (client-health.sql 107-125), Today.jsx 279, Onboarding.jsx 54, staff_performance (staff-celebrations-performance.sql 229), the client-emails edge function (index.ts 347, .maybeSingle() errors on two rows) and CloseTracker's onConflict 'client_id,period'. (d) staff_performance measures on-time with mc.updated_at, and any later write (notes, sign-off fields, reopen) moves it. Switch the KPI to signed_off_at, falling back to updated_at.

**Critic:**
- Add a month_close BEFORE guard (mgb.tk_signoff) and switch CloseTracker to the RPC. Use ON DELETE SET NULL (period_start). Set period_start only for monthly cadence. Change the close KPI to coalesce(signed_off_at, updated_at). Cover 'na' and reopen semantics. List every month_close consumer affected by the PK widening.


#### 4.6 Bulk-edit a recurring series
**Status:** missing · **Phase:** 2 · **Confidence:** medium

**Exists:** Editing a template changes future generation only.

**Missing:** A series key on tasks and an 'apply to this and future' operation.

**Proposal:** Add staff_reminders.template_id (FK task_templates, backfilled from source_ref) and series_id uuid. For generated tasks the series is (template_id, client_id). Ad-hoc recurrences get gen_random_uuid() at creation; complete_staff_item copies series_id forward and sets the next occurrence's source_ref to null, which stops the unique-index collision. RPC tk_update_series(p_template_id, p_client_id or p_series_id, p_from_date, p_patch jsonb) updates open future rows and the template or override row in one transaction. When an item is saved in TK_Templates, a ConfirmModal offers 'Also update N open future tasks'.

**Evidence:**
- `supabase/task-templates.sql` 183-277 — generated rows carry source_ref only, with no series or template id column
- `supabase/tasks-notes-v3.sql` 102-212 — complete_staff_item copies source_ref into the next occurrence, which can collide with the template_ref unique index

**Analyst disagreement:** Database-first used series_id = template id, which would apply across every client. UI-first and spec-skeptic used template_item_id. I combined them: template_id plus client_id scopes a generated series to one client, and series_id covers ad-hoc recurrences.

**Verification:**
- verify:4:db: agree.
- verify:4:ui: agree.

**Verifier fixes to the proposal:**
- (verify:4:db) Do not null source_ref on every roll-forward. source='note' tasks use source_ref as the note link (app.jsx:18499-18612), and source='deadline' uses it for dedupe (Deadlines.jsx:46-64). Null it, or skip the roll-forward, only when source='template'. Alternatively, pin recurrence='none' on template rows in staff_reminders_before_write so the collision cannot happen.
- (verify:4:db) tk_update_series edits task_templates and override rows (admin RLS) as well as staff_reminders. It must be SECURITY DEFINER with explicit checks: admin for firm items, can_access_client for that client's override or client-only rows. Open-row updates must not cross clients when p_client_id is null.
- (verify:4:ui) Backfill series_id for existing live rows with recurrence <> 'none', not only for new ones. Apply the same series_id copy and source_ref null to the browser fallback staffItemsApi._toggleDoneClientSide (app.jsx 17150-17167), or remove the fallback. In tk_update_series, note that staff_reminders_before_write pins staff_email, created_by, client_id and visibility whenever the caller is not the row owner (including security-definer runs with no JWT). A series patch can change text, due date and assignee_email, but cannot move client or visibility unless it sets a bypass flag such as mgb.offboarding.

**Critic:**
- Null source_ref only for source='template'. Backfill series_id for live recurring rows. Patch _toggleDoneClientSide. Make tk_update_series SECURITY DEFINER with admin/can_access_client checks and the trigger bypass flag.


#### 4.7 SOP attached to each recurring item; SOP steps become the task checklist
**Status:** extend · **Phase:** 2 · **Confidence:** medium

**Exists:** A template's checklist is copied into the task checklist at generation. SOPs exist as prose.

**Missing:** A link from an item to its SOP. Structured SOP steps, with client steps overriding firm-standard steps. A 'View SOP' link in the drawer.

**Proposal:** Add task_templates.sop_section (staff_reminders.sop_section is in 1.3). At generation the checklist comes from sop_steps for (client, section), then firm-standard sop_steps (client_id null), then the template checklist. The drawer shows a 'View SOP' link at the top of the checklist. In phase 2, fold staff_checklist_presets into firm-standard sop_steps with a copy migration, keep the old table read-only for one release, then retire it.

**Evidence:**
- `supabase/task-templates.sql` 92-98 — task_templates.checklist text[]
- `supabase/task-templates.sql` 262-266 — the generator already inserts the template checklist into task_checklist_items
- `supabase/client-sops.sql` 47-255 — SOP is free-text prose
- `supabase/task-checklists.sql` 120-165 — staff_checklist_presets is a third checklist source, not linked to SOPs

**Analyst disagreement:** Spec-skeptic marked this missing. The checklist copy at task-templates.sql:262-266 is a working half of the feature, so extend (database-first, UI-first) is better supported. For presets, database-first folded them into task_templates, spec-skeptic into sop_steps, and UI-first kept them. I chose sop_steps, so preset lists do not end up in the generator's item table.

**Verification:**
- verify:4:db: agree.
- verify:4:ui: agree.

**Verifier fixes to the proposal:**
- (verify:4:db) sop_steps firm-standard rows (client_id null) cannot use the client_sops policy pattern, because can_access_client(null) is false. Give firm rows is_active_staff() read and is_active_staff_admin() write, and client rows is_active_staff() and can_access_client(client_id). Key sop_section to the CLIENT_SOP_SECTIONS ids (app.jsx:17370).
- (verify:4:db) staff_checklist_presets are personal (owner_email RLS, unique per owner). Copying them into firm-standard sop_steps would publish every user's private lists firm-wide. Copy only presets the owner chooses to promote, or give sop_steps an owner_email scope for personal lists.
- (verify:4:ui) Do not fold staff_checklist_presets into firm-standard sop_steps (client_id null). The presets are personal: owner_email RLS 'staff manage own checklist presets' and a unique index on (owner_email, lower(name)) (task-checklists.sql 120-165). Folding them would publish every staff member's private lists firm-wide and cause name collisions. Keep them as personal presets, or give sop_steps an owner_email scope. Constrain task_templates.sop_section and sop_steps.section to CLIENT_SOP_SECTION_IDS (app.jsx 17407) with a CHECK or lookup table, since they exist only in JS today. sop_steps must keep the client_sops rule of no client_users policy (client-sops.sql 12-17).

**Critic:**
- Do not fold personal staff_checklist_presets into firm sop_steps; keep them personal, or promote them by choice. Firm-row policies are is_active_staff read and admin write. Add a section CHECK. Update the matching foundation entry.


### Area 5 Review loop

#### 5.1 Ready for review -> Approve / Send back with reason
**Status:** missing · **Phase:** 2 · **Confidence:** high

**Exists:** Nothing at task level. Team reviews are a separate HR feature.

**Missing:** A review-required flag, the reviewer, approve and send-back RPCs with a required reason, a send-back count, and a gate that blocks self-approval.

**Proposal:** Add staff_reminders.review_required boolean default false (true from template items flagged review_required), reviewer_email (from tk_client_people) and send_back_count int default 0. Add staff.can_review boolean. RPC tk_approve(p_id), allowed for the reviewer or an admin, moves ready_for_review to done. RPC tk_send_back(p_id, p_reason not blank) moves ready_for_review to in_progress, adds 1 to the count, and writes a tk_comments row of kind send_back. Both write tk_activity and tk_inbox_items, and send-back sends an immediate email. When review_required is true, the BEFORE trigger blocks status=done unless the session flag mgb.tk_approve is set by tk_approve, the same pattern as mgb.offboarding. In the drawer, the reviewer sees a sticky footer with Approve and Send back; Send back needs a reason.

**Evidence:**
- `supabase/month-close.sql` 35-36 — 'review' exists only as a period status
- `supabase/staff-schema.sql` 11-18 — staff.role is only bookkeeper/admin, with no reviewer flag
- `supabase/staff-offboarding.sql` 70-71 — existing mgb.offboarding session-flag bypass pattern

**Verification:**
- verify:5:db: agree.
- verify:5:ui: agree.

**Verifier fixes to the proposal:**
- (verify:5:db) The trigger gate on status=done is not enough on its own. Under 'staff manage own reminders' (FOR ALL on staff_email) and 'staff update shared client reminders', the owner or any teammate with client access can write review_required=false, reviewer_email, or send_back_count directly and bypass the gate. Extend staff_reminders_before_write to revert review_required, reviewer_email and send_back_count to OLD unless mgb.tk_approve (or a new mgb.tk_review) is on, or the caller is an admin. Follow the client_profile_guard_sop_review pattern in sop-freshness.sql 33-57.
- (verify:5:db) The self-approval check must compare the caller against both assignee_email and staff_email (lower-cased), since staff_performance treats coalesce(assignee_email, staff_email) as the doer. tk_approve should also clear the flag with set_config('mgb.tk_approve','',true) after the update, as mark_sop_reviewed does. Otherwise later statements in the same transaction inherit the bypass.
- (verify:5:db) The reviewer is not covered by current RLS. Private rows, and shared rows for clients the reviewer cannot access, are invisible to them. Make tk_approve and tk_send_back SECURITY DEFINER with an explicit check of caller = reviewer_email or is_active_staff_admin(). Also add reviewer_email to the tk_can_read_task helper, or the reviewer queue will be empty.
- (verify:5:db) staff.can_review is unreadable by other staff, because staff RLS allows reading only your own row. Expose it through staff_directory() (staff-time-off.sql 108), and have the RPC check it via a SECURITY DEFINER helper rather than a client-side read. Also add a 'staff_task_sent_back' kind to the notification_outbox kind CHECK (notification-emails.sql 47-51), and handle it in the notification-emails edge function, for the immediate send-back email.
- (verify:5:db) staff_reminders has no status column today, only done boolean. This row depends on the foundation's status column and done/status sync landing first. tk_approve should set done=true and completed_at in the same write, so that staff_performance, Today and complete_staff_item, which all read done, stay correct.
- (verify:5:ui) The reviewer source does not exist. client_profile has backup_bookkeeper_email but no reviewer column, and tk_client_people is only proposed. Add client_profile.reviewer_email (brief item 1) and resolve it in tk_client_people before defaulting staff_reminders.reviewer_email. Until the product owner answers the open question at brief line 89 ('Is one owner the only reviewer?'), fall back to the active admin.
- (verify:5:ui) Self-approval gate: 'allowed for the reviewer or an admin' still lets an admin who is the assignee approve their own task. Follow the team-reviews precedent and raise in tk_approve and tk_send_back when lower(auth.jwt()->>'email') = lower(coalesce(assignee_email, staff_email)), whatever the role.
- (verify:5:ui) The BEFORE-trigger gate has to test the done boolean as well as status. Today, staffItemsApi and complete_staff_item still write done=true, and the done/status sync makes either path reach done. Block new.done = true and new.status = 'done' when review_required and mgb.tk_approve is unset. Also stop complete_staff_item from rolling a recurring item forward until it is approved.
- (verify:5:ui) tk_approve and tk_send_back must be SECURITY DEFINER, with set search_path = public and their own reviewer/admin check, then set_config('mgb.tk_approve','on', true) and clear it afterwards, as offboard_staff does at lines 221 and 239. A reviewer is not the staff_email owner, so RLS blocks a direct update, and the existing trigger branch at staff-offboarding.sql 70-76 resets staff_email, created_by, client_id and visibility for non-owners.
- (verify:5:ui) Reuse ProBudgetNoteModal (required reason, confirmLabel 'Send back') rather than building a new reason dialog, and mirror client_budget_draft_history by storing the reason both in the tk_comments send_back row and on the activity row, so counts in 5.2 do not depend on parsing comments.

**Critic:**
- Point the reviewer source at clients.reviewer_email (1.1), not client_profile. Have the trigger revert review_required, reviewer_email and send_back_count unless the flag is set. Block self-approval for admins too. Clear the flag after use. Reuse ProBudgetNoteModal and use a distinct Today row kind.

**Decision applied (2026-10-10):** Approve and send back are allowed for any active admin, blocked for the task's own assignee (no self-approval). The review queue defaults to the Account Manager's view, and every admin can open it. No per-bookkeeper reviewer logic.


#### 5.2 Review counts per bookkeeper
**Status:** missing · **Phase:** 2 · **Confidence:** high

**Exists:** Nothing.

**Missing:** Counts of submitted, approved first time and sent back, per bookkeeper per period.

**Proposal:** View tk_review_stats (assignee, month, submitted, approved_first_pass, sent_back) built from tk_activity review_approved and review_sent_back rows, with security_invoker so admins see all and bookkeepers see their own. Shown in the TK_ReviewQueue header and fed to 10.6.

**Evidence:**
- `supabase/staff-celebrations-performance.sql` 160-350 — staff_performance has no review metrics (240-302)

**Verification:**
- verify:5:db: agree.
- verify:5:ui: agree.

**Verifier fixes to the proposal:**
- (verify:5:db) A security_invoker view over tk_activity would expose whatever tk_activity RLS allows. If that follows task readability (shared plus can_access_client), bookkeepers would see teammates' review stats. Make it a SECURITY DEFINER function like staff_performance that returns all rows when is_active_staff_admin() and only the caller's row otherwise. Derive approved_first_pass from send_back_count = 0 at approval time (store it in the review_approved activity payload), not by re-sequencing activity rows.
- (verify:5:ui) staff_performance is a security-definer function, not a view, and it already uses the key 'review' for the HR quarterly-review score. Feeding 10.6 under 'review' would collide. Use a new signal key such as 'qa' or 'first_pass', and update the weights JSON and Performance.jsx.
- (verify:5:ui) Follow the staff_performance convention, not a security_invoker view. Build tk_review_stats as a security-definer RPC that checks is_active_staff() and is_active_staff_admin() inside the function (admin sees all, others see only their own email). A security_invoker view that joins staff for names returns blanks for bookkeepers, because staff RLS allows only the own row (staff-schema.sql 'staff can read own row').

**Critic:**
- Make it a SECURITY DEFINER RPC like staff_performance, not a security_invoker view. Use a new signal key ('first_pass'), not 'review'.

**Decision applied (2026-10-10):** Counts are per bookkeeper, shown to admins. The reviewer dimension is the approving admin.


### Area 6 Ask-Client queue

#### 6.1 Ask client on any task pauses it (Waiting on client)
**Status:** missing · **Phase:** 2 · **Confidence:** high

**Exists:** Doc requests and transaction questions are separate flows with no task link.

**Missing:** A request tied to a task that sets it to waiting_client, pauses the overdue clock, and restores the previous status when answered.

**Proposal:** RPC tk_ask_client(p_task_id, p_prompt, p_kind CHECK in ('document','question','approval'), p_needs_upload, p_recipient_emails text[]). It inserts client_requests, stores staff_reminders.status_before_wait and waiting_since, sets status waiting_client, and writes activity. Overdue logic excludes waiting_client, and waiting time is added to waiting_minutes when the task leaves the state. The drawer's 'Ask client' button opens a ModalShell (question, needs upload, recipient picker from client_contacts, client_users and recipients). The row shows a 'Waiting on client, N bd' pill.

**Evidence:**
- `supabase/staff-client-tools.sql` 48-120 — client_doc_requests exists but has no task link
- `supabase/transaction-questions.sql` 29-178 — transaction_questions are client-initiated

**Verification:**
- verify:6:db: agree.
- verify:6:ui: agree.

**Verifier fixes to the proposal:**
- (verify:6:db) Drop 'client_contacts' from the recipient picker. No such table exists. Use active client_users (the same source as portalEmails in client-emails/index.ts 251-254) minus opted-out client_email_recipients. Make tk_ask_client SECURITY DEFINER with an explicit is_active_staff() and can_access_client() check, and use tk_can_edit_task for the task, since staff_reminders RLS is owner-only (staff-reminders-v2.sql 159-185).
- (verify:6:ui) Drop 'client_contacts' from the recipient picker because no such table exists. Use active client_users for the client_id. Optionally add free-typed emails stored in client_requests.recipient_emails, which only works if the 6.3 token path is approved. client_email_recipients is an unsubscribe ledger: use it to filter out opted-out people, not as a contact source.

**Critic:**
- Pick the recipient source: client_contacts from 1.2 if it ships in phase 2, otherwise client_users minus opted-out. Make tk_ask_client SECURITY DEFINER with a tk_can_edit_task check.


#### 6.2 Client-facing What we need from you page with upload and reply
**Status:** extend · **Phase:** 2 · **Confidence:** high

**Exists:** A read-only requests panel, a fulfill RPC, and a working transaction-question reply UI on the client side.

**Missing:** A reply box, upload against a request, question-type requests, and one page listing everything outstanding.

**Proposal:** New client page TK_ClientNeeds at #/needs (and #/needs/<id>) reading client_requests_for_client. Each request is a card with a reply textarea, a file drop (drive-files upload) and 'Send', calling tk_answer_client_request(p_id, p_reply, p_client_file_id). Reuse TQ_ card styling, build it for 375px first, and show open transaction questions as a linked count. Fold CLIENT_RequestsPanel into it.

**Evidence:**
- `app.jsx` 753-794 — CLIENT_RequestsPanel is a read-only list of client_doc_requests
- `supabase/staff-client-tools.sql` 48-120 — fulfill_doc_request(p_id, p_path, p_name) marks a doc request uploaded (lines 111-116)
- `components/client/TxnQuestions.jsx` 1-466 — TQ_ client Q&A cards with replies, a pattern to reuse
- `supabase/document-folders.sql` 56-66 — client upload and folder policies through is_client_member
- `docs/tasks-prototype.dc.html` 375-419 — clientview screen

**Analyst disagreement:** UI-first used the route #/requests; the others used #/needs. I picked #/needs to match the page name.

**Verification:**
- verify:6:db: agree.
- verify:6:ui: agree.

**Verifier fixes to the proposal:**
- (verify:6:db) Use the client route convention instead of #/needs. Client pages are #/client/<id>/<page> resolved through CLIENT_PLACES, CLIENT_PLACE_OF_PAGE and isKnownAppPage (app.jsx 488-517, 24282-24302). Add a 'needs' page there, as #/client/<id>/needs[/<requestId>], gated by access.tabs. Do not build client_requests_for_client as a view. Repo views are security_invoker by rule (client-scope-view.sql 54-61 says a definer view would leak), and an invoker view needs a client base-table SELECT policy, which exposes task_id and asked_by anyway. Make it a SECURITY DEFINER set-returning RPC filtered by is_client_member. Also repoint drive-files' visibility=request branch (index.ts 414-480) from client_doc_requests/fulfill_doc_request to client_requests/tk_answer_client_request, or uploads against new requests return 404.
- (verify:6:ui) Do not route the client page as top-level #/needs. parseHashRoute treats top-level slugs as staff places (NAV_PLACE_BY_SLUG). Client pages are #/client/<id>/<page>, gated by CLIENT_PLACES, CLIENT_PLACE_OF_PAGE and access.tabs. Use #/client/<id>/needs[/<reqId>] (or the existing Messages > Requests sub, clientSub 'requests'). Repoint clientNeeds 'See requests', the bell items and the tab badge to it. Fold DocumentRequestsCard's client mode as well as CLIENT_RequestsPanel. Base the reply on client_messages-style text, not TQ_ (TQ_ has no reply thread).

**Critic:**
- Route as #/client/<id>/needs[/<reqId>] through CLIENT_PLACES and access.tabs. Make client_requests_for_client a definer RPC, not a view. Fold DocumentRequestsCard, clientNeeds and the bell and badge sources as well.


#### 6.3 Email with magic link for clients who do not log in
**Status:** extend · **Phase:** 2 · **Confidence:** medium

**Exists:** Magic-link sign-in, a client email pipeline over Resend, and a pending-route mechanism.

**Missing:** A link that lands on a specific request after sign-in. A path for a contact with no client_users row.

**Proposal:** Baseline (phase 2): request emails link to /login?next=%23%2Fneeds%2F<id>. ClientAuthGate accepts only whitelisted same-origin hash values for 'next' (no open redirect) and resumes through PENDING_ROUTE_KEY. For contacts with no login, if the product owner approves: tk_request_tokens (token_hash, request_id, email, expires_at, used_at) and a public edge function client-request-respond that verifies a hashed single-use token and accepts the reply or upload for that one request only. Rate limit it, expire tokens after 14 days or less, and hide amounts in the prompt unless the contact signs in.

**Evidence:**
- `components/auth/ClientAuthGate.jsx` 119-125 — emailRedirectTo pinned to origin + '/login'
- `supabase/functions/invite-client-user/index.ts`  — INVITE_REDIRECT_TO is https://app.mygoodbooks.org/login
- `supabase/functions/client-emails/index.ts` 170-183 — chaser email links point to /login
- `supabase/functions/_shared/email.ts`  — Resend sender
- `app.jsx` 24188-24209 — PENDING_ROUTE_KEY deep link survives sign-in

**Analyst disagreement:** Database-first marked this missing; UI-first and spec-skeptic marked it extend. I chose extend since magic-link sign-in and the email pipeline exist. Database-first and spec-skeptic build tokenized no-login access, while UI-first refused to in phase 2. I made the deep link the baseline and put the token path behind the product owner's answer on whether non-account contacts may respond.

**Verification:**
- verify:6:db: agree.
- verify:6:ui: agree.

**Verifier fixes to the proposal:**
- (verify:6:db) Do not rely on PENDING_ROUTE_KEY. It is sessionStorage (app.jsx 24414-24433), and a magic link opened from email is a new tab, so the route is lost. Either have ClientAuthGate validate 'next' against a whitelist (^#/client/<own id>/needs(/uuid)?$) and append it to emailRedirectTo (then add /login?next=* to the Supabase Auth redirect allow-list), or write it to localStorage with a short TTL before signInWithOtp. Point the email link at /login?next=... explicitly, since PORTAL_URL is the bare root today. Because shouldCreateUser:false, a contact without a client_users row cannot use magic links at all. The no-login token path is the only option for them, and no contact table exists to hold them. If that path is built, follow the client_email_recipients token pattern, but store only a hash.
- (verify:6:ui) PENDING_ROUTE_KEY lives in sessionStorage and is stashed only from location.hash at boot, so it does not survive a magic link opened in a new tab from email. Carry the target in the URL instead: ClientAuthGate sets emailRedirectTo to origin + '/login?next=' + whitelisted client hash, and that pattern is added to the Supabase Auth redirect allow-list. On return, read 'next' from location.search, validate it with parseHashRoute plus the user's own client_id, then navigate. Update client-emails PORTAL_URL/button to the request deep link. For tokens, store only the hash (unlike client_email_recipients and report shares, which store plaintext).

**Critic:**
- Carry 'next' in emailRedirectTo with a whitelist plus a Supabase redirect allow-list entry (PENDING_ROUTE_KEY does not survive a new tab). Store token hashes only.


#### 6.4 Nudges every 3 business days
**Status:** extend · **Phase:** 2 · **Confidence:** high

**Exists:** A working calendar-day doc chaser with an email log and prefs.

**Missing:** A business-day cadence, coverage of client_requests and question-type requests, and a stop per request.

**Proposal:** Repoint the chaser at client_requests: next_nudge_at = tk_add_business_days(last_nudged_at, 3), with max_nudges and a stop on answer or cancel. Reuse client_email_log with feature 'client_request' (widen client_email_log_feature_check) and the client-emails edge function with a new template. Retire the calendar-day cadence once client_doc_requests is migrated.

**Evidence:**
- `supabase/client-emails.sql` 31-231 — client-doc-chaser cron '0 14 * * *' sends on calendar day 0/3/7/weekly, tracked in client_doc_chase (126) and client_email_log (142)
- `components/staff/DocChaser.jsx` 24-131 — DC_ staff controls

**Verification:**
- verify:6:db: agree.
- verify:6:ui: agree.

**Verifier fixes to the proposal:**
- (verify:6:db) When widening client_email_log_feature_check, copy the full latest list from tech-inventory-v2.sql 57-61 (doc_chaser, value_report, staff_client_message, staff_doc_upload, staff_task_assigned, staff_task_due, staff_feedback_status, client_message, client_reports_ready, staff_tech_request) and add client_request. Copying client-emails.sql 145 would break notification-emails logging. Also widen the client_emails_cron job whitelist (client-emails.sql 175) and the edge Job type, or have doc_chaser read client_requests. Keep the per-client batching, the 20-hour dedupe and the gates. tk_add_business_days needs a new tk_holidays table, because no SQL business-day or holiday logic exists. Replace client_doc_chase (FK cascade to client_doc_requests) with the new nudge columns in the same migration.
- (verify:6:ui) Keep the existing one-email-per-client-per-day batch and the per-recipient unsubscribe in sendToEach. Compute dueness per request but send one combined email per client. Business-day math must live in the Deno edge function or a SQL helper that the function calls; tk_add_business_days and tk_holidays do not exist yet (only OPS_rollWeekend in JS). Add a per-request stop flag, since today only client-level chaser_paused exists. client_doc_chase cascades from client_doc_requests, so move the chase state onto client_requests (last_nudged_at, nudge_count) before the old table goes read-only.

**Decision applied (2026-10-10):** Nudge cadence stays 3 business days (spec), adjustable per client. This is the one place business-day math is required in phase 2.


#### 6.5 Answering resumes the task and files the upload in the client Drive month folder
**Status:** extend · **Phase:** 2 · **Confidence:** medium

**Exists:** Drive upload and folder caching by year and doc type, plus a fulfill RPC pattern.

**Missing:** A month folder level, an automatic resume of the task, and an inbox item for the assignee.

**Proposal:** Add drive_folders.month smallint null and widen the unique key to (client_id, year, doc_type, coalesce(month,0)) without rewriting cached rows. drive-files and logic.ts accept an optional month (Client/Year/MM Month/...) for request uploads. tk_answer_client_request sets the request answered, posts the reply into tk_comments (kind client_reply), restores status_before_wait when no other open requests remain on the task, adds the waiting time to waiting_minutes, and sends an immediate inbox item and email to the assignee.

**Evidence:**
- `supabase/functions/drive-files/index.ts` 277-281 — folderFor builds Client/Year/DocType, with no month level
- `supabase/functions/drive-files/logic.ts` 44-124 — folder resolver
- `supabase/google-drive-files.sql` 54-128 — drive_folders cache key (client_id, year, doc_type)
- `supabase/staff-client-tools.sql` 48-120 — fulfill_doc_request pattern

**Analyst disagreement:** Spec-skeptic marked this missing. The upload and folder machinery exists and only needs a month level and resume logic, so extend (database-first, UI-first).

**Verification:**
- verify:6:db: agree.
- verify:6:ui: agree.

**Verifier fixes to the proposal:**
- (verify:6:db) drive_folders uniqueness is an expression index (google-drive-files.sql 117-118). Drop drive_folders_path_uidx and recreate it as (client_id, coalesce(year,0), coalesce(month,0), coalesce(lower(doc_type),'')) in the same transaction, and extend the level check. Keeping the old index makes a month-level doc_type folder collide with the year-level folder of the same name. childFolder/remember in drive-files index.ts (~250-275) must also carry month. tk_answer_client_request is called by a client JWT, so it must be SECURITY DEFINER to update staff_reminders (whose RLS is staff-only) and must set an mgb.* bypass flag recognized by staff_reminders_before_write. Route the assignee notice through notification_outbox (widen notification_outbox_kind_check from tech-inventory-v2.sql 52-55) rather than a parallel path, replacing notify_enqueue_doc_upload's fan-out to all staff.
- (verify:6:ui) Write the new drive_folders index as (client_id, coalesce(year,0), coalesce(month,0), coalesce(lower(doc_type),'')), keeping lower(doc_type). Create it first, then drop drive_folders_path_uidx, and update the childFolder/remember cache lookups to match on month so month-less hits do not collide. The drive-files request branch hardcodes client_doc_requests and fulfill_doc_request; switch it to client_requests and tk_answer_client_request. Add client_files.client_request_id, or repoint the request_id FK after an id-preserving migration. Handle the storage fallback path (client-uploads/<client>/<req>/...) used when Drive is not connected. Extend notify_enqueue_doc_upload or add a kind to the notification_outbox kind CHECK for the assignee notification; today it emails every assigned staff member.

**Critic:**
- State which month the folder uses (the task's period_start). Create the new drive_folders index before dropping the old one. Repoint the drive-files request branch.


#### 6.6 client_requests table with Client role RLS (own org only)
**Status:** missing · **Phase:** 2 · **Confidence:** high

**Exists:** The client membership helper and patterns for client RLS and realtime. A grep shows client_requests exists only in the brief.

**Missing:** The table itself.

**Proposal:** New client_requests (id, client_id, task_id references staff_reminders on delete set null, kind, prompt, needs_upload, status CHECK in ('open','answered','accepted','cancelled'), recipient_emails text[], reply, client_file_id, asked_by, asked_at, answered_by, answered_at, last_nudged_at, nudge_count, cancelled_at). RLS: staff use is_active_staff() and can_access_client(client_id). Clients select only through is_client_member(client_id), via the column-limited view client_requests_for_client, which hides task_id and asked_by. Clients update only through tk_answer_client_request. Add a client realtime topic policy like client-messages-realtime. Migrate client_doc_requests (open->open, uploaded->answered, done->accepted, cancelled->cancelled), keep the old table read-only for one release, and make fulfill_doc_request a wrapper.

**Evidence:**
- `supabase/pro-budget-reports.sql` 19-34 — is_client_member(text) helper is defined here
- `supabase/transaction-questions.sql` 29-178 — client-scoped RLS pattern to copy
- `supabase/audit2-realtime-private-channels.sql` 30-40 — realtime topics are staff-only
- `supabase/client-messages-realtime.sql` 21-25 — client topic policy pattern
- `supabase/staff-client-tools.sql` 48-56 — client_doc_requests status open/uploaded/done/cancelled

**Verification:**
- verify:6:db: agree.
- verify:6:ui: agree.

**Verifier fixes to the proposal:**
- (verify:6:db) The migration must also handle: client_files.request_id FK to client_doc_requests (google-drive-files.sql 67), by preserving UUIDs when copying rows and repointing the FK to client_requests (or adding client_request_id); client_doc_chase FK cascade (client-emails.sql 127); notify_enqueue_doc_upload trigger (notification-emails.sql 129-132); the client-health doc_overdue CTE (client-health.sql 166-170); drive-files lookups (index.ts 417, 635); and file_path '<client>/<request id>/drive:<file id>' parsing. Use client_id text references public.clients(id), as client_files and client_email_* do. For client realtime, postgres_changes needs a client base-table SELECT policy. If clients read only through a definer RPC, use a broadcast topic such as 'client-reqs-' || email, with a policy like client-messages-realtime.sql 21-25.
- (verify:6:ui) Clients that can read only through the view client_requests_for_client will not get realtime: postgres_changes runs on base tables and checks the table's RLS (see the client-msgs-<email> pattern in StaffInbox.jsx 2117). Give clients an RLS select policy on client_requests itself via is_client_member(client_id), as client_doc_requests already does with requested_by visible, or limit columns with column grants. Use a private topic like 'client-reqs-<lower email>' with a realtime.messages policy matching client-messages-realtime.sql. Migrate client_doc_requests with the same ids so client_files.request_id, client_doc_chase.request_id and client_email_log.request_ids still resolve. Repoint the client-health doc_overdue check, ClientTabCounts, the TopBar uploaded feed and the client-emails value report.

**Critic:**
- Migrate with preserved ids so client_files.request_id, client_doc_chase and client_email_log.request_ids resolve. Decide the client realtime path (base-table policy, or a broadcast topic). Answer which client_users roles and tabs can respond.


### Area 7 Inbox

#### 7.1 Inbox grouped by client
**Status:** missing · **Phase:** 3 · **Confidence:** high

**Exists:** Client and staff messaging only.

**Missing:** A task notification inbox grouped by client.

**Proposal:** New tk_inbox_items (id, recipient_email, task_id, client_id, kind CHECK in ('mention','sent_back','assigned','client_answered','due_soon','overdue','automation'), actor_email, delivery CHECK in ('immediate','digest'), created_at, read_at, archived_at, digested_at). RLS: the recipient only. Realtime on a private topic tk-inbox-<email>. TK_Inbox at #/tasks/inbox groups by client with collapsible headers, and clicking an item opens the drawer. StaffInbox stays for messaging.

**Evidence:**
- `components/inbox/StaffInbox.jsx` 1158-1767 — SI_ is person-thread messaging, a flat list with no grouping, no mute and no task events
- `docs/tasks-prototype.dc.html` 225-251 — prototype inbox grouped by client

**Analyst disagreement:** UI-first and spec-skeptic marked this extend because StaffInbox exists. All three agree StaffInbox stays separate and a new TK_Inbox is built, so missing (database-first) reflects the work.

**Verification:**
- verify:7:db: agree.
- verify:7:ui: agree.

**Verifier fixes to the proposal:**
- (verify:7:db) Realtime isolation cannot rely on the topic name 'tk-inbox-<email>'. The realtime.messages policies allow any active staff member to join any private topic. Use postgres_changes on tk_inbox_items, so the table's recipient-only RLS filters rows, and never broadcast. Add the table to supabase_realtime with the guarded DO-block pattern. Per the foundation decision, subscribe on the existing staff-reminders-<email> / TK_sync channel rather than opening a fourth channel.
- (verify:7:db) RLS for tk_inbox_items: grant authenticated select, plus update limited to read_at and archived_at (through a column grant or an RPC), with recipient_email = lower(auth.jwt()->>'email'). Insert only from security-definer fan-out triggers, with revoke insert/delete from authenticated, mirroring notification_outbox. Use client_id text (clients.id is text) and task_id uuid references staff_reminders(id). Decide whether TB_Bell's 'task:' items read from tk_inbox_items, or the bell and the inbox will double-count assignments.
- (verify:7:ui) Realtime: a private topic 'tk-inbox-<email>' isolates nothing. realtime.messages policies let any active staff member join any private topic (audit2-realtime-private-channels.sql). Isolation has to come from RLS on tk_inbox_items carried through postgres_changes. Add the table to the supabase_realtime publication and listen on the existing staff-reminders-<email> channel (the TK_sync decision) rather than a new topic. Feed TB_Bell from tk_inbox_items and remove its on-the-fly 'task:' items (TopBar.jsx ~820-830), or staff get double notifications and two unread states (localStorage seen vs read_at). client_id must be text referencing clients(id), since clients.id is text.

**Critic:**
- Drop the per-email topic and use postgres_changes on the TK_sync channel. Decide how TB_Bell's task: items and the TK_Inbox read state reconcile. Add an Internal/Projects group for client-less items. Consider moving the table itself to phase 2 for 4.4, 5.1 and 6.5.


#### 7.2 Mentions and send-backs delivered immediately
**Status:** extend · **Phase:** 2 · **Confidence:** high

**Exists:** An outbox with a 5-minute sender, and a task-assigned email.

**Missing:** Mention, send-back and client-answered kinds.

**Proposal:** Widen notification_outbox_kind_check with staff_task_mention, staff_task_sent_back and staff_task_client_answered, and widen client_email_log_feature_check to match. Enqueue from the tk_inbox_items insert trigger when delivery='immediate', which is also where notify_enqueue_task_assigned is routed. The in-app badge updates through realtime.

**Evidence:**
- `supabase/notification-emails.sql` 44-63 — notification_outbox with a kind CHECK
- `supabase/notification-emails.sql` 136-172 — notify_enqueue_task_assigned queues staff_task_assigned and skips rows with no JWT
- `supabase/notification-emails.sql` 250-252 — 5-minute outbox sender cron

**Analyst disagreement:** Database-first put this in phase 3 with the inbox. UI-first and spec-skeptic put it in phase 2. I chose phase 2 because send-backs (5.1) and client answers (6.5) ship in phase 2 and need immediate delivery; the TK_Inbox screen itself stays phase 3.

**Verification:**
- verify:7:db: agree.
- verify:7:ui: agree.

**Verifier fixes to the proposal:**
- (verify:7:db) Do not widen notification_outbox_kind_check before redeploying the notification-emails edge function. wants() reads PREF[kind].key (index.ts:131) and the Kind/PREF map only knows the current 8 kinds. A queued staff_task_mention row would throw a TypeError and halt the whole 500-row batch every 5 minutes, holding up every other email. An unknown staff kind would also fall into the feedback-status else branch. Ship order: deploy the edge function with the new PREF keys and body builders, add matching keys to ST_STAFF_EMAIL_PREFS, then apply the CHECK migration. Alternatively, follow account-manager.sql and reuse kind staff_task_assigned with payload.event = 'mention' | 'sent_back' | 'client_answered'. The widening migration must restate the full kind and feature lists from tech-inventory-v2.sql:52-61, plus any client_request feature added by the Ask-client work, because it drops and re-adds the constraint.
- (verify:7:db) Generalize am_body_mentions into tk_parse_mentions instead of writing a second parser. It is currently revoked from authenticated and takes one email, so tk_parse_mentions should return the set of matching active staff emails for a body. Keep the existing self-mention guard (v_bk <> author).
- (verify:7:ui) notification_outbox_kind_check and client_email_log_feature_check are each defined twice, in notification-emails.sql:47-51/68-74 and in tech-inventory-v2.sql:52-61. Update both files. Otherwise re-running either one narrows the check again, and because the outbox insert runs inside an AFTER trigger on the tk_inbox_items insert, a check violation would roll back the comment or send-back write itself. Also add the new kinds to the edge function's Kind union and PREF map (index.ts 33-47) and to ST_STAFF_EMAIL_PREFS in Settings.jsx; the code comments say these must match. Without that the function has no PREF entry for the kind, and wants() throws. The alternative is the account-manager.sql convention: reuse an existing kind with a payload flag so no constraint changes. 'Immediate' still means up to 5 minutes (the cron interval).


#### 7.3 Everything else in a daily digest
**Status:** extend · **Phase:** 3 · **Confidence:** medium

**Exists:** A daily per-staff due-task email and a weekly admin digest.

**Missing:** A per-staff daily digest built from inbox items, which respects mutes.

**Proposal:** Turn the notification-task-due job into tk_daily_digest: one email per staff member listing unread digest-delivery tk_inbox_items (skipping muted clients) plus tasks due today and overdue, stamping digested_at. Reuse the digest_runs idempotency pattern keyed (staff_email, run_date) and the Resend sender.

**Evidence:**
- `supabase/notification-emails.sql` 224-252 — cron notification-task-due '30 11 * * *' already sends a daily due-task email per staff member
- `supabase/weekly-digest.sql` 42-537 — digest_settings, digest_runs and digest_cron_tick: a weekly admin digest with an idempotency pattern
- `supabase/functions/weekly-admin-digest`  — admin-only weekly digest edge function

**Analyst disagreement:** Database-first and UI-first marked this missing; spec-skeptic marked it extend. The existing daily per-staff notification-task-due email (notification-emails.sql:252) is the thing to extend, and database-first's own proposal converts it, so extend fits the evidence best.

**Verification:**
- verify:7:db: agree.
- verify:7:ui: agree.

**Verifier fixes to the proposal:**
- (verify:7:db) Replace 'reuse the digest_runs idempotency pattern keyed (staff_email, run_date)'. digest_runs has no staff_email column and no unique key, and its guard is a firm-wide 'any cron run in 20 hours' check with admin-only RLS. Either keep the existing per-recipient client_email_log check (feature staff_task_due, 20-hour window, index.ts:216-218), or add a unique (staff_email, run_date) ledger like review_notifications.dedupe_key. Stamp tk_inbox_items.digested_at in the same service-role pass.
- (verify:7:db) The task_due pref defaults to false (PREF staff_task_due def false; Settings 'Tasks due today' def false). If digest-delivery inbox items only go out through this job under that pref, most staff will never get them. Add a separate pref key such as daily_digest (default true) rather than overloading task_due. The fixed '30 11 * * *' UTC schedule shifts by an hour at DST. Use the DST-safe hourly-tick pattern from digest_cron_tick if the send time matters.
- (verify:7:ui) digest_runs cannot be 'keyed (staff_email, run_date)'. It is an admin-only run log (one row per run, recipients array, week_start) with no unique key. Per-staff idempotency today is the 20-hour client_email_log lookup in index.ts 216-219. Either keep that or add a new ledger with PK (staff_email, run_date). For the prototype's 7:30 AM digest, use digest_cron_tick's hourly timezone tick (weekly-digest.sql 490-537), not the fixed '30 11 * * *' UTC schedule, which drifts to 6:30 AM ET in winter. The task_due preference defaults to false, so reusing the key leaves the digest off for everyone who never toggled it. Add a new key (for example daily_digest, def true) and keep the PREF map and Settings in sync. Extend the query to include overdue tasks, and change the link from #/work/tasks to the new route.

**Critic:**
- Replace the digest_runs keying with the client_email_log 20-hour check, or a new (staff_email, run_date) ledger. Add a daily_digest pref defaulting to true. Use the DST-safe hourly tick.


#### 7.4 Mute per client
**Status:** missing · **Phase:** 3 · **Confidence:** high

**Exists:** Nothing.

**Missing:** Per-user client mutes that still let mentions and send-backs through.

**Proposal:** New tk_inbox_mutes (staff_email, client_id, muted_at, PK both). The inbox group header menu has 'Mute client'. Fan-out and the digest skip muted clients except for kinds mention and sent_back.

**Evidence:**
- `components/inbox/StaffInbox.jsx` 1158-1700 — no mute
- `supabase/user-settings.sql` 55-107 — no mute key

**Verification:**
- verify:7:db: agree.
- verify:7:ui: agree.

**Verifier fixes to the proposal:**
- (verify:7:db) Fan-out and the digest run as security-definer or service-role code, so the mute check must happen server-side against tk_inbox_mutes. A user_settings JSON key would not work as well because it is harder to join. Give tk_inbox_mutes own-row RLS (staff_email = jwt email) with the PK (staff_email, client_id) as proposed, and allow mention and sent_back through per the brief.
- (verify:7:ui) Use client_id text references clients(id) on delete cascade, and lower-case staff_email to match the outbox's recipient_email check convention. Apply mutes in TB_Bell too, not only in fan-out and the digest; otherwise a muted client keeps appearing in the bell's message, document and task items. The settings.notify JSON in user_settings is the existing home for notification preferences, but a table is easier for the SQL fan-out trigger to join, so the new table is acceptable. Say in the spec that it does not live in user_settings.


### Area 8 Automations

#### 8.1 Rule builder with bookkeeping triggers: overdue N business days, period closed, sent back twice, bookkeeper out of office, email received at tasks@
**Status:** missing · **Phase:** 3 · **Confidence:** medium

**Exists:** Only fixed cron jobs.

**Missing:** Rule storage, an evaluator, the five triggers and a builder UI.

**Proposal:** New tk_automation_rules (id, name, trigger CHECK in ('overdue_bd','period_closed','sent_back_n','staff_ooo','email_received'), trigger_params jsonb, action CHECK in ('notify','reassign','create_task','set_status','add_follower'), action_params jsonb, client_ids text[] null, active, created_by). Admin only. Time-based rules run from cron tk-automations-hourly; event rules run from AFTER triggers through tk_fire_rules(event, task_id), with a session-flag recursion guard. TK_Rules at #/tasks/rules is a sentence-style builder ('When [trigger] [N] then [action]').

**Evidence:**
- `supabase/qbo-close-checks.sql` 191-321 — close_checks_evaluate is advisory and creates no tasks
- `supabase/task-templates.sql` 296-301 — only fixed cron jobs exist
- `docs/tasks-prototype.dc.html` 532-566 — Rules screen

**Verification:**
- verify:8:db: agree.
- verify:8:ui: agree.

**Verifier fixes to the proposal:**
- (verify:8:db) tk_fire_rules(event, task_id) cannot express period_closed, whose source row is month_close (client_id, period) and has no task, or staff_ooo, whose source is staff_time_off. Use tk_fire_rules(p_event text, p_subject jsonb) and fire period_closed from an AFTER UPDATE OF status trigger on month_close, next to notify_enqueue_reports_ready (notification-emails.sql 202-219).
- (verify:8:db) A staff_ooo rule with action 'reassign' would duplicate the foundation's reversible OOO ledger. Route that action through tk_apply_ooo/tk_return_ooo, so automated reassignments land in tk_ooo_reassignments and are undone on return, instead of writing assignee_email directly.
- (verify:8:db) overdue_bd needs a SQL business-day function. None exists, since OPS_rollWeekend is JS only. Add tk_business_days_between(date, date) backed by tk_holidays and mirror it in TK tests. The 'notify' action also needs notification_outbox.kind widened, because its CHECK only allows the 7 current kinds.
- (verify:8:db) Tasks created by the cron or the trigger evaluator have no JWT. The extended staff_reminders_before_write forces created_by from the JWT, and notify_enqueue_task_assigned returns early when v_by is empty. Set a session flag (for example mgb.tk_automation, like mgb.offboarding and mgb.tk_import), stamp created_by 'automation', and set source='automation' with source_ref = rule_id:subject_key.
- (verify:8:ui) Reassign and set_status actions fired from an AFTER trigger on staff_reminders run under the editing user's JWT. staff_reminders_before_write (staff-offboarding.sql 70-76) then silently resets staff_email, client_id and visibility for a caller who is not the owner, so a reassign would be lost without any error. tk_fire_rules must set a dedicated transaction-local flag (for example set_config('mgb.tk_automation','on',true)) that serves as both the recursion guard and a bypass that before_write honors, just as it honors mgb.offboarding. For period_closed, extend the existing AFTER trigger on month_close status (notify_enqueue_reports_ready pattern) instead of adding a second one. For staff_ooo, fire from staff_time_off, not staff_reminders. sent_back_n depends on review fields that don't exist yet, so gate it on the review-gate phase. overdue_bd needs a SQL business-day helper backed by tk_holidays, because only weekend roll-forward exists today, and in JS. Use cron.unschedule before cron.schedule for tk-automations-hourly, as the other cron migrations do.

**Critic:**
- Use tk_fire_rules(event, subject jsonb). Fire period_closed beside notify_enqueue_reports_ready. Route staff_ooo reassign through tk_apply_ooo. Add an mgb.tk_automation flag. Add a rule dry-run.

**Decision applied (2026-10-10):** The product owner expects few or no Asana Rules in use (D4). Build the rule builder only for the firm's own triggers (overdue, period closed, sent back twice, out of office); drop the email-received trigger if staff confirm tasks@ is not needed.


#### 8.2 Fire counts per rule
**Status:** missing · **Phase:** 3 · **Confidence:** high

**Exists:** Nothing.

**Missing:** A log of each firing, for counts and dedupe.

**Proposal:** New tk_automation_fires (id, rule_id, task_id, fired_at, result jsonb) with a unique index on (rule_id, task_id, fired_at::date) for once-per-day dedupe. The rule card shows count(*) over the last 30 days.

**Evidence:**
- `supabase/qbo-close-checks.sql` 191-321 — ops_alert_state is a dedupe and state pattern to copy
- `docs/tasks-prototype.dc.html` 532-566 — fire count shown per rule

**Verification:**
- verify:8:db: agree.
- verify:8:ui: agree.

**Verifier fixes to the proposal:**
- (verify:8:db) Postgres rejects the unique index on (rule_id, task_id, fired_at::date). A timestamptz-to-date cast depends on the TimeZone setting, so it is not IMMUTABLE and cannot be used in an index expression. Add a stored column fired_on date not null default ((now() at time zone 'America/Chicago')::date), matching close_checks_evaluate's v_today, and put the unique index on (rule_id, subject_key, fired_on).
- (verify:8:db) task_id is null for period_closed, staff_ooo and email_received fires, and unique indexes treat nulls as distinct, so dedupe silently fails. Use a not-null subject_key text: the task id, client_id:period, the time_off id, or the message_id. Keep task_id as a nullable FK.
- (verify:8:db) Count fires for the current month, as the prototype says ('fired this month'), not over the last 30 days. Follow ops_alert_state's grants: admin-only select RLS, writes revoked from authenticated, and inserts made only by the security-definer evaluator.
- (verify:8:ui) A unique index on (rule_id, task_id, fired_at::date) fails to create. timestamptz::date is not IMMUTABLE because it depends on the TimeZone setting, and Postgres requires immutable functions in index expressions. Store fired_on date not null default ((now() at time zone 'America/Chicago')::date) and index (rule_id, subject_key, fired_on), or index ((fired_at at time zone 'America/Chicago')::date). Also, task_id is null for create_task, email and period_closed firings, and NULLs are distinct in a unique index, so those firings would never dedupe. Use a non-null subject_key text such as a task id, client_id:period or message_id, or declare the index NULLS NOT DISTINCT (PG15+). Copy the dedupe pattern from ops_alert_state in supabase/ops-alerting.sql, not qbo-close-checks.sql. Count 'this month' to match the prototype, or relabel the column.

**Critic:**
- Index on a stored fired_on date plus a non-null subject_key, not fired_at::date. Count this month.


#### 8.3 Email-to-task from a firm tasks@ inbox, client picked by sender domain
**Status:** missing · **Phase:** 3 · **Confidence:** medium

**Exists:** Outbound email only.

**Missing:** An inbound webhook, a sender-domain-to-client map, attachment handling, and triage for unmatched mail.

**Proposal:** New edge function tasks-inbound (Resend inbound, Postmark, or Google Workspace forwarding), verified by the provider's webhook signature. New tk_client_email_domains (domain PK, client_id), where the PK stops one domain mapping to two clients, and tk_inbound_emails (message_id unique, from, subject, body, client_id, task_id, received_at). It creates a staff_reminders row with source 'email' assigned to the client's bookkeeper. Unmatched mail goes to a triage admin's inbox as 'Pick a client'. Free-mail domains (gmail.com, outlook.com and similar) are blocklisted and never auto-mapped; those senders match only by exact address from client_contacts.

**Evidence:**
- `supabase/functions/_shared/email.ts`  — outbound Resend only
- `supabase/functions/resend-webhook`  — outbound event webhook only; none of the 14 edge functions handles inbound mail

**Analyst disagreement:** UI-first used clients.email_domains text[]. Database-first and spec-skeptic used a domain table. I chose the table so uniqueness is enforced. UI-first's low confidence reflects the unknown inbound provider, which stays an open question.

**Verification:**
- verify:8:db: agree.
- verify:8:ui: agree.

**Verifier fixes to the proposal:**
- (verify:8:db) client_contacts does not exist. Match exact sender addresses against client_users.email (PK, so unambiguous) and then client_email_recipients.email (lower-cased; it can map one address to several clients, so send those to triage). Assign to clients.assigned_bookkeeper_email (or tk_client_people once it exists), not a guessed bookkeeper.
- (verify:8:db) The new edge function runs as service_role, which bypasses RLS. It must set the mgb.tk_automation (or tk_import) session flag so the JWT-forced created_by in the extended staff_reminders_before_write does not null or reject the insert, and set source='email' with source_ref=message_id for idempotency. Reuse resend-webhook's Svix verify() rather than writing a second implementation.
- (verify:8:db) The prototype also says 'Replies on the thread post as comments' and 'the thread is attached'. Store in_reply_to and references headers on tk_inbound_emails and resolve replies to the existing task, posting them to tk_comments instead of creating new tasks. Give tk_inbound_emails and tk_client_email_domains admin-only RLS, the same pattern as client_users, because inbound bodies may contain client financial data.
- (verify:8:ui) client_contacts does not exist. Match exact sender addresses with client_users (email PK, client_id, active) and client_email_recipients (client_id, email). Assign to clients.assigned_bookkeeper_email, through tk_client_people once that exists. The prototype tells staff to forward or CC tasks@, so From is often a staff address on the firm's domain and a domain match fails. When the sender matches the staff_email_domain pattern, resolve the client from the forwarded original sender or the other To/CC participants, and treat the forwarding staff member as created_by and staff_email. Insert as service role with staff_email set explicitly: before_write falls back to staff_email for created_by when there is no JWT, and staff_email is NOT NULL. Reuse resend-webhook's Svix verify() by moving it into supabase/functions/_shared, and give the inbound endpoint its own URL so email.received events don't also flow into email_events. Attachments should go to Drive through drive-files and client_files, with Supabase holding metadata only per the foundation decision; tk_inbound_emails should not store blobs. The proposal omits two prototype behaviors: attaching the thread, and posting replies on the thread as tk_comments. Handling replies needs an In-Reply-To/References lookup on tk_inbound_emails.message_id.

**Critic:**
- Handle staff forwards (From is on the firm's domain). Thread replies into tk_comments through In-Reply-To. Reuse Svix verify from _shared. Attachments go to Drive.

**Decision applied (2026-10-10):** The product owner expects email-to-task is not in use (D4). Confirm with an owner and a senior bookkeeper; if confirmed, this row is dropped from phase 3.


### Area 9 Out of office

#### 9.1 Reassign due tasks to the backup while out, and back on return
**Status:** extend · **Phase:** 2 · **Confidence:** medium

**Exists:** Time-off records, coverage access grants and a coverage UI.

**Missing:** A reversible reassignment of due tasks, with a ledger and a return when time off ends.

**Proposal:** New tk_ooo_reassignments (id, time_off_id references staff_time_off, task_id, from_email, to_email, reassigned_at, returned_at, skipped_reason). RPC tk_apply_ooo(time_off_id) moves open tasks due in the window to the client_profile backup (falling back to the reviewer) and records each move. tk_return_ooo(time_off_id) moves back only tasks that are still open and still assigned to the backup. Phase 2: a button on the Coverage page with a preview count, so the November parallel run has backup coverage. Phase 3: run on the start and end dates by cron and fire the staff_ooo automation trigger.

**Evidence:**
- `supabase/staff-time-off.sql` 23-278 — staff_time_off; grant_coverage_access (209-278) grants access only and never reassigns
- `components/staff/Coverage.jsx` 25-480 — CV_ Coverage UI
- `supabase/staff-offboarding.sql` 43-89 — offboard_staff permanently moves open reminders, a pattern for the bulk move

**Analyst disagreement:** Database-first marked this missing and phase 3. UI-first marked it extend, phase 2 manual, and spec-skeptic extend, phase 3. I chose extend (time off and coverage exist). I took UI-first's phase 2 manual button and phase 3 automation. I chose database-first's ledger table over the original_assignee_email column UI-first and spec-skeptic proposed, because a ledger handles overlapping time off and keeps an audit trail.

**Verification:**
- verify:9:db: agree.
- verify:9:ui: agree.

**Verifier fixes to the proposal:**
- (verify:9:db) Drop the 'falling back to the reviewer' clause, or make it depend on the client reviewer column another row adds. client_profile has no reviewer field today; it has only backup_bookkeeper_email. Until then, fall back to the admin who runs the RPC, as offboard_staff does, or skip the task and record skipped_reason='no_backup'.
- (verify:9:db) Visibility: under the current staff_reminders RLS (staff-reminders-v2.sql 157-192) the backup cannot see a moved task if it is private, has no client_id, or is for a client the backup cannot open. tk_apply_ooo must either run after the tk_can_read_task assignee policy ships, or skip private and no-client rows (skipped_reason) and call grant_coverage_access, or require it first, for any client whose backup_access is 'none'. Otherwise the tasks disappear from both people.
- (verify:9:db) Move only assignee_email, never staff_email. If staff_email must change, follow offboard_staff: a security definer RPC that sets a transaction-local mgb.ooo flag (like mgb.offboarding) that staff_reminders_before_write honors. The browser cannot set that flag.
- (verify:9:db) Notification storm: notify_enqueue_task_assigned (notification-emails.sql 170-172) fires per row on an assignee_email update, so applying and returning sends N emails each way. Suppress it during the bulk move with a transaction-local setting checked in the trigger, and send one summary item ('12 tasks moved to you while X is out') through tk_inbox_items.
- (verify:9:db) Recurring roll-forward: complete_staff_item (tasks-notes-v3.sql 195-203) creates the next occurrence with assignee_email = the backup, and that row is not in the ledger, so tk_return_ooo would leave it with the backup for good. Either have roll-forward copy an open ledger entry to the new row, or have tk_return_ooo also return open rows in the same series (series_id, or source/source_ref) created during the window and assigned to the backup.
- (verify:9:db) staff_time_off can still be edited (ends_on is not pinned by staff_time_off_guard) and cancelled (cancelled_at). tk_return_ooo needs a trigger or cron path when cancelled_at is set or ends_on moves earlier. tk_apply_ooo must be idempotent per (time_off_id, task_id), with a unique index on the ledger. Overlapping time off should resolve 'backup is also away' with coverage_overview's backup_away_until logic and record a skipped_reason, not move the task to someone who is out.
- (verify:9:db) Ledger RLS: give tk_ooo_reassignments RLS (select for is_active_staff_admin or the from/to person, and no direct insert/update/delete for authenticated). Write it only from the security definer RPCs, and revoke delete, as staff_time_off does. Use lowercased emails throughout, as staff_time_off_guard does.
- (verify:9:ui) 1) 'Falling back to the reviewer' has no source today. client_profile has no reviewer column, and grep finds none in supabase/*.sql. The brief (line 34) lists a client reviewer, but that is itself part of the Tasks build. Make the fallback conditional on the new reviewer field, or fall back to skipping with skipped_reason='no_backup', or to the firm admin. 2) Reassign by updating assignee_email only. staff_email is the owner and RLS key, and the before-write trigger pins it for non-owners unless mgb.offboarding='on'. Moving staff_email would also change the original owner's access and read like an offboarding. The RPC must be security definer, admin-gated or self-gated (is_active_staff_admin() or staff_email = caller), and must not set mgb.offboarding. 3) Visibility: owner policy matches staff_email, so after moving only assignee_email the backup can see the task only if visibility='shared', client_id is set and can_access_client(client_id) is true. Private tasks and clients where the backup has no access stay invisible to them. Either skip those with skipped_reason ('private','no_access'), or have tk_can_read_task honor assignee_email (already planned in the foundation decisions; make that a hard prerequisite). Note grant_coverage_access refuses when the backup already has access, so the preview must surface 'no access grant yet' per client. 4) The staff_ooo automation trigger does not exist anywhere (grep of docs, supabase, components, app.jsx finds nothing). It depends on the automations engine, so keep it in phase 3 and do not assume it. 5) The Coverage tab is admin-only (TeamPage.jsx 675). If bookkeepers should reassign their own work before leaving, expose a self-serve action in CV_MyTimeOffBody, not only the admin tab. 6) Idempotency: add a unique constraint on (time_off_id, task_id) and handle a time-off edit that shifts dates or a cancel (cancelled_at set), which must trigger a return. 7) tk_return_ooo needs to honor the review-gate and notification triggers: suppress notify_enqueue_task_assigned for bulk moves, or the backup gets one email per task. 8) Cron note: the existing cron pattern uses a shared secret and America/Chicago dates; compute start and end with (now() at time zone 'America/Chicago')::date.

**Critic:**
- Move assignee_email only. Skip private and no-access rows, or require tk_can_read_task first. Suppress per-row assignment emails. Carry the ledger through roll-forward. Handle time-off edits and cancels. Add a self-serve action in CV_MyTimeOffBody. Tie it to open question 3.

**Decision applied (2026-10-10):** Fallback when no backup is set: the default reviewer (the Account Manager) or another admin, chosen manually. The covering bookkeeper needs a coverage grant (grant_coverage_access, staff_client_access) to see the client's tasks, which is the existing pattern (D3), so tk_apply_ooo must create or verify the grant before it moves assignee_email, and tk_return_ooo leaves the grant to expire with the time off.


### Area 10 Dashboards

#### 10.1 Close tracker: clients x months
**Status:** extend · **Phase:** 3 · **Confidence:** high

**Exists:** A working clients-by-months grid over month_close, with cells set by hand.

**Missing:** Period progress derived from task counts, sign-off display, and click-through to the period's tasks.

**Proposal:** Keep CloseTracker and move it under #/tasks/close. Add view tk_period_progress (client_id, period, open, done, waiting, in_review) joining staff_reminders on (client_id, period_start). Show the sign-off fields. A cell click goes to #/tasks/c/<client>/list?period=YYYY-MM.

**Evidence:**
- `components/staff/CloseTracker.jsx` 105-658 — CT_ grid over month_close (page at 188-575)

**Verification:**
- verify:10:ui: agree.
- verify:10:db: agree.

**Verifier fixes to the proposal:**
- (verify:10:ui) staff_reminders.client_id and month_close.client_id are both text, so the join works; period_start must be added first (foundation), and CT_periods keys are 'YYYY-MM-01' while client_close_items use 'YYYY-MM', so the deep link param needs CT_fromYm/CT_toYm conversion.
- (verify:10:db) Sequence tk_period_progress after the staff_reminders.period_start and month_close sign-off column migrations. Add month_close to the supabase_realtime publication (it is not in one today; CloseTracker uses a custom mgb:month-close-changed event) before relying on live updates.


#### 10.2 Overdue by bookkeeper
**Status:** extend (analysts said missing; corrected by verifiers) · **Phase:** 3 · **Confidence:** high

**Exists:** Admin read access, a per-user due count and a per-person dashboard layout.

**Missing:** A team overdue rollup that excludes waiting_client and uses business days.

**Proposal:** View tk_overdue_by_assignee (assignee_email, overdue_count, oldest_due, overdue_bd_max) with security_invoker, shown as a bar-list card on TK_Dashboards or TK_Workload, reusing the TP_ layout.

**Evidence:**
- `supabase/admin-read-all-tasks.sql` 8-10 — admins can read all reminders
- `app.jsx` 24300-24343 — refreshMyTasksDue is a per-user count only
- `components/staff/TeamCapacity.jsx`  — TP_CAP per-person layout to reuse

**Analyst disagreement:** Database-first marked this extend because of admin read and the layout. UI-first and spec-skeptic marked it missing. No overdue aggregate exists, so missing.

**Verification:**
- verify:10:ui: **disagree, status → extend.** An admin-only overdue-by-person rollup already runs on live staff_reminders. TP_aggregate in TeamPage.jsx counts open and overdue (due_date before today, not done) per assignee, and People table cells render an 'Overdue' stat in red. TP_TeamHub is mounted at app.jsx:28253. What is truly missing is the waiting_client exclusion and business-day aging. Also the cited app.jsx 24300-24343 is unrelated theme code; refreshMyTasksDue is at app.jsx:25543.
  - `components/staff/TeamPage.jsx` 140-148 — TP_taskState returns 'overdue' for open tasks with due_date < today
  - `components/staff/TeamPage.jsx` 204-257 — per-person open/overdue/completed counts; per-client overdue too
  - `components/staff/TeamPage.jsx` 1152, 1214 — Overdue stat shown in person and client drill-downs
  - `supabase/admin-read-all-tasks.sql` 8-10 — admin read policy feeding it
- verify:10:db: agree.

**Verifier fixes to the proposal:**
- (verify:10:ui) Extend TP_aggregate/TeamPage People table (admin Team page) rather than build a new TP_-layout bar card; compute overdue from tk_tasks excluding waiting_client. A view with security_invoker is fine since admins already have the read-all policy. Tasks can be done client-side before adding a view.
- (verify:10:db) Fix the evidence cite: refreshMyTasksDue and myTasksDue are around app.jsx 25543-25560, not 24300-24343 (theme code). Define overdue as status not in (done, waiting_client) and deleted_at is null. Exclude visibility='private' rows owned by non-admins only if the viewer is not an admin, and rely on security_invoker so the new tk_can_read_task policy applies.

**Critic:**
- Change the status to extend (TP_aggregate/TeamPage already computes per-person overdue). Fix the cite to app.jsx:25543. Reconcile with staff_performance tasks_overdue.

**Decision applied (2026-10-10):** Admins see it. Status is extend: TeamPage already computes per-person overdue.


#### 10.3 Workload vs capacity in hours
**Status:** extend · **Phase:** 3 · **Confidence:** medium

**Exists:** Capacity targets, client hour budgets and QBO Time actuals.

**Missing:** Planned hours on tasks, so open work can be compared with capacity.

**Proposal:** Add staff_reminders.estimate_minutes and task_templates.estimate_minutes. View tk_workload_week (assignee, week, planned_minutes, actual_minutes from time_entries and QBO Time, capacity from staff_capacity). TeamCapacity or TK_Workload adds a 'planned' series for the next 2 weeks, reusing the TP_ bars.

**Evidence:**
- `supabase/staff-capacity.sql` 17-42 — staff_capacity.weekly_target_hours default 35, admin only
- `supabase/client-hours-budget.sql`  — client_profile.monthly_hours_budget
- `components/staff/TeamCapacity.jsx` 22-373 — TP_CapacityCard: QBO Time actuals vs capacity, admin only
- `components/staff/HoursBudget.jsx`  — HB_ client hours budget

**Verification:**
- verify:10:ui: agree.
- verify:10:db: agree.

**Verifier fixes to the proposal:**
- (verify:10:ui) Source actual_minutes from qbo_hours_by_staff (admin RPC), not time_entries, which is retired from reads and dormant. staff_capacity is admin-only, so the planned-vs-capacity view must also be admin-gated (security_invoker will return nothing for non-admins).
- (verify:10:db) Build actual_minutes from qbo_hours_by_staff / qbo_time_activities (mapped through qbo_employee_staff_map), not from time_entries alone. time_entries is dormant and has no task_id yet. The view is admin-only because staff_capacity RLS is admin-only, so a bookkeeper-facing planned view must not join staff_capacity.

**Critic:**
- Source actuals from qbo_hours_by_staff. Keep it admin-only.


#### 10.4 Review queue
**Status:** missing · **Phase:** 2 · **Confidence:** high

**Exists:** Nothing.

**Missing:** A list of ready_for_review tasks for the reviewer, with age.

**Proposal:** TK_ReviewQueue at #/tasks/review: a TK_List preset filtered to status='ready_for_review' and reviewer_email=me (admins see all), oldest first by status_changed_at, with inline Approve and Send back. Backed by an index on staff_reminders(reviewer_email, status) where deleted_at is null. It ships in phase 2 because the review loop is unusable without it.

**Evidence:**
- `supabase/staff-reminders-v2.sql` 36-83 — no review status
- `docs/tasks-prototype.dc.html` 450-495 — Workload screen

**Verification:**
- verify:10:ui: agree.
- verify:10:db: agree.

**Verifier fixes to the proposal:**
- (verify:10:db) The partial index on staff_reminders(reviewer_email, status) where deleted_at is null needs reviewer_email, status and deleted_at, all added by the foundation migration. Order the migrations accordingly.

**Decision applied (2026-10-10):** Review queue is for admins. Default filter 'reviewer = me' with the Account Manager as the default reviewer; any admin can approve.


#### 10.5 Waiting-on-client list
**Status:** extend · **Phase:** 2 · **Confidence:** medium

**Exists:** The doc chaser view of open document requests.

**Missing:** All open client_requests with age in business days, last nudge, nudge count, the linked task and a 'Nudge now' button.

**Proposal:** Phase 2: TK_WaitingList at #/tasks/waiting (view tk_waiting_on_client) as a list preset, so Ask-client can be run from day one. Phase 3: the dashboard card. Fold DC_DocChaserCard into it once client_doc_requests is migrated.

**Evidence:**
- `components/staff/DocChaser.jsx` 24-131 — DC_DocChaserCard lists chased doc requests

**Analyst disagreement:** UI-first marked this missing, phase 2. Database-first marked it extend, phase 3, and spec-skeptic extend, phase 3. I chose extend because DocChaser exists, and phase 2 for the minimal list because the Ask-client loop (phase 2) needs a working view. The dashboard card stays phase 3.

**Verification:**
- verify:10:ui: agree.
- verify:10:db: agree.

**Verifier fixes to the proposal:**
- (verify:10:ui) Phase 2 TK_WaitingList cannot rely on client_requests until the doc-request migration; ship it first over client_doc_requests + client_doc_chase (status 'open'), since client_requests does not exist yet.
- (verify:10:db) Until client_doc_requests is migrated, make tk_waiting_on_client read client_doc_requests joined to client_doc_chase. Do not reference client_requests, which does not exist in any supabase/*.sql.

**Critic:**
- Build the phase-2 list over client_doc_requests + client_doc_chase until 6.6's migration runs.


#### 10.6 On-time rate feeding quarterly reviews
**Status:** extend · **Phase:** 4 · **Confidence:** medium

**Exists:** Approximate performance percentages and a quarterly review module.

**Missing:** A true on-time measure (first done at or before due, excluding waiting_client time, with first-pass approvals) fed into quarterly reviews.

**Proposal:** Add staff_reminders.waiting_minutes, added to each time a task leaves waiting_client. View tk_on_time_quarter (assignee, quarter, due_count, on_time_count, first_pass_approved) built from tk_activity. staff_performance reads it instead of its approximation, and team reviews show it as a read-only panel.

**Evidence:**
- `supabase/staff-celebrations-performance.sql` 160-350 — staff_performance tasks_pct is not a true on-time measure; close_pct uses month_close.updated_at
- `components/staff/teamReviewsLogic.test.js`  — quarterly review logic with tests
- `supabase/functions/team-reviews`  — quarterly review edge function

**Verification:**
- verify:10:ui: agree.
- verify:10:db: agree.

**Decision applied (2026-10-10):** On-time history uses the full imported history, not a 12-month cutoff.


### Area 11 Standalone + embedded

#### 11.1 Same app served at /tasks (tasks. subdomain later)
**Status:** missing · **Phase:** 1 · **Confidence:** high

**Exists:** Hash routes inside the single page (#/work/tasks).

**Missing:** A /tasks path that boots the same index.html into a slim shell.

**Proposal:** Add vercel.json rewrites /tasks and /tasks/(.*) to /index.html. Boot code detects a pathname starting with /tasks, maps it onto the hash route, and sets window.MGB_SHELL='tasks'. Add 'tasks' to HASH_SUB_ROUTE_PAGES, NON_CLIENT_PAGES and NAV_PLACES. TK_App is the shell root (TK_Sidebar plus outlet). Keep X-Frame-Options DENY, since the pop-out uses window.open, not an iframe. Keep the app.jsx edits inside the effectivePage gate minimal.

**Evidence:**
- `vercel.json` 2-8 — rewrites cover /login, /privacy, /terms, /quickbooks-connected and /unsubscribe only; no /tasks. X-Frame-Options DENY at line 13.
- `app.jsx` 24027-24060 — hash-only routing via parseHashRoute; HASH_SUB_ROUTE_PAGES = work, team, help
- `app.jsx` 25267-25303 — effectivePage gate

**Verification:**
- verify:11:db: agree.
- verify:11:ui: agree.

**Verifier fixes to the proposal:**
- (verify:11:db) index.html loads styles.css, components/*.css and scripts by relative path and has no <base> tag. This works for /login (depth 1) but breaks on /tasks/my or /tasks/t/<id>: the browser requests /tasks/styles.css, and the /tasks/:path* rewrite would serve index.html as CSS or JS. Before adding the rewrite, add <base href="/"> to index.html or convert the asset paths to root-absolute. Use the rewrite source '/tasks' plus '/tasks/:path*' (Vercel syntax, not the regex '/tasks/(.*)'). Also check that Supabase auth redirect or magic-link allow-list URLs and any use of location.pathname still work when the page boots at /tasks.
- (verify:11:ui) Adding rewrites /tasks and /tasks/(.*) -> /index.html will break the app on any nested path. index.html loads styles.css, components/**/*.css, components/ui/tooltips.js (and the app loader) by RELATIVE URL with no <base>, so at /tasks/t/<id> the browser requests /tasks/t/components/... and the /tasks/(.*) rewrite serves index.html for them (CSS/JS parse failure). Fix: add <base href="/"> (or make asset URLs root-absolute) in index.html before the document.write lines, or serve nested routes only via hash. Simplest and consistent with the codebase: rewrite only the single segment /tasks and keep everything after it in the hash (#/tasks/...). Also: staff Google sign-in returns to window.location.origin (AuthGate.jsx:33) and PENDING_ROUTE_KEY stashes only the hash, so the boot code must convert the /tasks/... path into a hash and rewrite via history.replaceState to '/' + hash BEFORE auth, otherwise a cold signed-out load loses the destination. Existing pathname-aware code (app.jsx:26649 builds urls from location.pathname) will otherwise keep '/tasks/...' in pushState URLs.

**Critic:**
- Add <base href="/">, or rewrite only '/tasks' and keep the rest in the hash. Convert the path to a hash before auth. Add a note on the tasks. subdomain (separate origin, so no shared localStorage session). Update .claude/serve.js for local testing.

**Decision applied (2026-10-10):** /tasks is a secondary shell in phase 1, not the main staff entry point. If the pop-out needs its own path (for example /tasks-popout, or /tasks with a shell flag) that is fine (D11). Keep it single-segment, or add <base href="/">, so the relative asset URLs still resolve.


#### 11.2 Open in own window: window.open sized popup with slim top-bar shell; Dock in portal returns
**Status:** missing · **Phase:** 1 · **Confidence:** high

**Exists:** Only a PWA display-mode check.

**Missing:** A sized popup, a slim shell and a dock-back control.

**Proposal:** A TK_ header button 'Open in own window' calls window.open('/tasks/'+route+'?shell=standalone','mgb-tasks','width=1180,height=820'); the named target reuses one window. With shell=standalone, app.jsx skips StaffRail and TopBar and renders TK_StandaloneBar (gold logo badge on navy deep, search, avatar, 'Dock in portal'). The Supabase session is shared through same-origin localStorage. Dock posts {type:'dock', route} on BroadcastChannel; a live opener navigates there and the popup closes, otherwise it calls location.assign('/#/tasks/'+route). The button is hidden on phones.

**Evidence:**
- `app.jsx` 24128 — AN_isStandalone checks PWA display mode only
- `docs/tasks-prototype.dc.html` 88-171 — docked and standalone shells

**Verification:**
- verify:11:db: agree.
- verify:11:ui: agree.

**Verifier fixes to the proposal:**
- (verify:11:db) window.open must not pass the noopener feature, or the opener link is lost. The proposal's BroadcastChannel dock is fine, but the fallback location.assign('/#/tasks/'+route) needs the pending-route logic to tolerate a fresh tab, because PENDING_ROUTE_KEY is in sessionStorage and per tab. Make sure the popup's sign-in state comes from the shared localStorage Supabase session. Check auth-config.js for a per-tab or sessionStorage session setting before relying on it.
- (verify:11:ui) Gate the new bar on the shell flag, not display-mode, and suppress AN_AppNav (app.jsx:25369) or merge it into TK_StandaloneBar so a popup does not get two Back/Refresh bars when also installed. A cold popup that is signed out will redirect through Google to origin '/', losing ?shell=standalone; persist the shell choice in sessionStorage/hash before the auth redirect. Verify BroadcastChannel dock logic also handles a closed opener (location.assign target must be the hash form '/#/tasks/...' as proposed).

**Critic:**
- Gate on the shell flag, suppress AN_AppNav, persist the shell choice across the Google redirect, and never use noopener.

**Decision applied (2026-10-10):** The pop-out may open its own path or flag (D11). Persist the shell choice across the Google sign-in redirect and suppress AN_AppNav inside the shell.


#### 11.3 PWA installable (manifest exists, currently gated)
**Status:** extend · **Phase:** 3 · **Confidence:** medium

**Exists:** A manifest and a gated install prompt. A grep finds no serviceWorker registration in the repo.

**Missing:** A /tasks shortcut or start_url, the gate opened for staff, and a service worker if install criteria need one.

**Proposal:** Add a manifest shortcut {name:'My Tasks', url:'/tasks/my?shell=standalone'}. Add a staff-only install flag and keep the public gate until the product owner decides. Add a minimal service worker only if the target browsers need one to install, and defer offline support. Test launch_handler navigate-existing against the pop-out.

**Evidence:**
- `index.html` 17-22 — INSTALL_APP_PUBLIC=false gate
- `manifest.webmanifest` 6-9 — start_url '/', launch_handler navigate-existing, no shortcuts

**Analyst disagreement:** Spec-skeptic said a service worker exists. A repo-wide grep for serviceWorker finds none, so I followed database-first.

**Verification:**
- verify:11:db: agree.
- verify:11:ui: agree.

**Verifier fixes to the proposal:**
- (verify:11:db) Open a staff-only install flag by reusing the existing mgb_install_app_v1 localStorage mechanism and the 'Show unreleased features' flag, not a new gate. If the shortcut url is /tasks/my?shell=standalone, it needs the 11.1 rewrite and <base> fix shipped first.


#### 11.4 Supabase Realtime plus BroadcastChannel keep windows in sync
**Status:** extend · **Phase:** 1 · **Confidence:** high

**Exists:** Realtime on staff_reminders, filtered to the owner. A grep finds no BroadcastChannel anywhere in the code.

**Missing:** BroadcastChannel. Realtime for checklist, comments, inbox, month_close and client_requests. Subscriptions that also cover assignee rows.

**Proposal:** Add task_checklist_items, tk_comments, tk_activity, tk_inbox_items, month_close and client_requests to supabase_realtime. Use one Supabase channel per user, relying on RLS so assignee, follower and shared rows arrive (not just staff_email). TK_sync.js holds BroadcastChannel('mgb-tasks') to relay local optimistic edits and the selected task between the portal and the popup. Both feed a TK_store (useSyncExternalStore), deduplicated by updated_at, so lists and the drawer update in place.

**Evidence:**
- `app.jsx` 24353-24411 — private channel staff-reminders-<email> on postgres_changes, which dispatches STAFF_ITEMS_CHANGED_EVENT
- `supabase/staff-reminders-v2.sql` 212-224 — staff_reminders is in the realtime publication
- `supabase/task-checklists.sql` 29-114 — checklist not in the publication

**Verification:**
- verify:11:db: agree.
- verify:11:ui: agree.

**Verifier fixes to the proposal:**
- (verify:11:db) Views cannot join a publication, so add the base tables (task_checklist_items, month_close, new tk_ tables). Do it with the guarded do-block pattern and a separate private channel per group, like client-notes and client-sops, so one missing table does not break the rest. Describe the current subscription as RLS-scoped, not owner-filtered. Subscribing to tk_ tables for tasks that are not the user's requires the new RLS helpers to be in place first, or events silently drop.
- (verify:11:ui) 'One Supabase channel per user' contradicts the codebase convention: client-notes- and client-sops- channels are deliberately separate (app.jsx comment: a missing table must not affect the other subscription). Use one channel per table family (e.g. tk-core-, tk-inbox-, tk-close-) and keep the guarded 'if not exists in pg_publication_tables' add pattern from tasks-notes-v3.sql. Also the existing channel has no column filter; RLS already decides delivery, so the proposal's 'not just staff_email' is already how it works once tk_can_read_task RLS lands on the new tables.

**Critic:**
- Use one channel per table family with the guarded publication add. The existing channel is already RLS-scoped.


#### 11.5 Every client, task and view has a URL
**Status:** extend · **Phase:** 1 · **Confidence:** high

**Exists:** Hash sub-routes and pending deep links.

**Missing:** Per-task, per-client, per-project and per-view routes, and Back-friendly view changes.

**Proposal:** tkRoutes.js (parse and format, tested) registered in parseHashRoute: #/tasks/my, /inbox, /review, /waiting, /close, /workload, /templates, /rules, /c/<client>/(list|board|calendar|recurring), /p/<project>/(list|board|calendar), /v/<view>, and /t/<id>, which opens the drawer over the last view. The TK_ router uses pushState for view changes and replaceState only for filter tweaks. #/work/tasks redirects to #/tasks/my. The drawer has 'Copy link'. Test a cold, signed-out load of /tasks/t/<id>.

**Evidence:**
- `app.jsx` 24027-24060 — HASH_SUB_ROUTE_PAGES covers work, team and help
- `components/staff/StaffNav.jsx` 129-163 — NAV_useHashSub uses replaceState, which breaks Back
- `app.jsx` 24188-24209 — PENDING_ROUTE_KEY deep link survives sign-in (sessionStorage, per tab)
- `components/staff/Today.jsx` 929-1307 — task rows link only to #/work/tasks

**Verification:**
- verify:11:db: agree.
- verify:11:ui: **disagree, status → extend.** Status extend is right, but 'what exists' is understated and the premise is partly wrong. A per-task deep link already exists: the LK_ grammar in components/staff/DeepLink.jsx has kind 'task' and place work/tasks, and MyTasksPage consumes it (#/work/tasks?item=task:<id>, app.jsx:19662-19680, with client/view kinds). Also App already pushes one history entry per page change (app.jsx:26633-26660), so only intra-place changes (NAV_useHashSub replaceState, StaffNav.jsx:129-163) break Back. Also, the 'survives sign-in' claim is narrower than stated: PENDING_ROUTE_KEY stashes only the hash, and LK has its own sessionStorage arrival (LK_KEY) for ?item=.
  - `components/staff/DeepLink.jsx` 13-45 — Grammar, LK_KINDS includes 'task', LK_PLACE_CLAIMS has 'work/tasks'; query is one-time pointer stripped via replaceState
  - `app.jsx` 19662-19680 — MyTasksPage claims place work, tab tasks, kinds task/view and reveals the row
  - `app.jsx` 26633-26665 — App pushState per page and fires mgb-nav
  - `components/staff/StaffNav.jsx` 129-163 — NAV_useHashSub replaceState by design
  - `components/staff/DeepLink.jsx` 409 — LK_go builds the link; Today.jsx does not use it, so Today rows link only to #/work/tasks

**Verifier fixes to the proposal:**
- (verify:11:ui) Do not invent /t/<id> beside the existing grammar. Reuse LK_: kind 'task' already exists, so #/tasks/my?item=task:<id> is the cold-link form (LK_capture strips the query, LK_KEY survives sign-in), and add 'tasks/*' entries to LK_PLACE_CLAIMS. Never put free text/emails in URLs (DeepLink.jsx rule). Keep #/work/tasks?item=task:<id> working as an alias since emailed links (notification_outbox, TopBar, Today) already use it. For pushState on view changes, route through a shared helper that also dispatches 'mgb-nav' and respects hashFromHistory in the App rewrite effect (app.jsx:26633), otherwise App's hash-rewrite effect and NAV_useHashSub's replaceState will fight and Back numbering (mgbNav) will skip.

**Critic:**
- Change the status to reflect the DeepLink.jsx LK_ grammar. Keep #/work/tasks?item=task:<id> as an alias for emailed links.


### Area 12 Asana import

#### 12.1 Import users by email, teams -> bookkeeper, projects -> clients
**Status:** missing · **Phase:** 2 · **Confidence:** medium

**Exists:** The staff and clients tables to match against. Asana has 11 users, 5-6 '<Name>'s Clients' teams and 67 projects.

**Missing:** Import tooling, a mapping store, handling for unmatched users, and a real client roster to map into.

**Proposal:** A server-side node script (scripts/asana-import/) using the service role, kept server side because CSP connect-src covers only self and Supabase. A dry run writes raw Asana JSON into tk_import_projects and tk_import_tasks staging tables and produces a mapping CSV for the product owner. tk_asana_import_map (asana_gid PK, kind CHECK in ('user','team','project','section','task'), local_table, local_id, status, notes, imported_at) makes reruns idempotent. Users match on lower(email); each team maps to that bookkeeper's staff.email; unmatched users go to an admin review list. Each project maps to a client or a tk_projects row; internal projects (Directors, Owners, COO-SOP) must not become fake clients. Build a TK_ImportReview admin screen only if the CSV proves clumsy. The client roster must be built before the import.

**Evidence:**
- `supabase/staff-schema.sql` 11-18 — staff table to match against (8 live rows vs 11 Asana users)
- `supabase/clients-roster.sql` 23-68 — clients target; only 2 live clients, both test_only

**Analyst disagreement:** UI-first used a node script with a CSV dry run. Database-first used staging tables and an admin match screen. Spec-skeptic used a script, staging tables and a review screen. I combined them: script plus staging plus map table, with the CSV reviewed first and the screen only if needed.

**Verification:**
- verify:12:ui: agree.
- verify:12:db: agree.

**Verifier fixes to the proposal:**
- (verify:12:ui) clients.id is text, so tk_asana_import_map.local_id must be text, not uuid, or it cannot hold both client ids and uuid ids. Also, 'each team maps to that bookkeeper's staff.email' needs a matching rule, since clients.assigned_bookkeeper is a jsonb name/initials object with no email.
- (verify:12:ui) 'A node script in scripts/asana-import/' has no precedent here (no scripts/ dir or package.json; the repo is a static bundle with Deno edge functions in supabase/functions). Either write it as a one-off outside the repo, or as an edge function using the existing service-role pattern. Do not commit any Asana token.
- (verify:12:db) clients.assigned_bookkeeper is jsonb {name, role, initials} and carries no email. 'Each team maps to that bookkeeper's staff.email' needs a name-to-staff.name match, or a clients.assigned_bookkeeper_email column added first. The staging and map tables need RLS enabled with admin-only policies (is_active_staff_admin()), and revoke from anon and authenticated.

**Critic:**
- Decide the 3 unmatched Asana users. Match teams by name, since clients.assigned_bookkeeper is jsonb (or use assigned_bookkeeper_email). Make local_id text. Run the script outside the repo or as an edge function; keep it out of the served bundle. Add 'build the real client roster' as a gate prerequisite.

**Decision applied (2026-10-10):** Asana add-ons: the product owner expects few or none (no Rules, forms or email-to-task in regular use). Confirm with an owner and a senior bookkeeper, then treat 8.3 and the Rules recreation as not needed for the gate.


#### 12.2 Sections -> cadence; recurring tasks -> draft templates for bookkeeper confirmation
**Status:** missing · **Phase:** 2 · **Confidence:** medium

**Exists:** A template suggestion queue resolved by admins. Asana sections are Weekly, Monthly, Annual, Occasional and Untitled.

**Missing:** Section-to-cadence mapping, translation of Asana recurrence into due_rule, and a draft state the client's bookkeeper confirms.

**Proposal:** Sections map to cadence: Weekly->weekly, Monthly->monthly, Annual->annually, Occasional->no template (one-off tasks). Asana recurrence (date, days_of_week, nth_weekday, yearly) becomes client-only task_templates rows with status='draft', active=false, a proposed due_rule and a 'suggest business day' hint, since Asana has no business-day option. The client page's Recurring tab shows a 'Confirm imported items' banner. The client's bookkeeper confirms through RPC tk_confirm_draft_template, which sets status='active' or links the draft to an equivalent standard item as an override. task_template_suggestions stays as the staff 'make this recurring' queue.

**Evidence:**
- `supabase/task-template-suggestions.sql` 26-114 — pending/created/dismissed suggestion queue; admin-resolved, with no cadence or due-rule columns
- `supabase/task-templates.sql` 57-76 — task_templates has active but no draft status

**Analyst disagreement:** Database-first routed drafts through task_template_suggestions with an added due_rule. UI-first used tk_template_items status draft. Spec-skeptic used task_templates.status draft. I chose draft task_templates rows: the suggestions table is resolved by admins and lacks cadence, rule and checklist fields, while the brief asks for bookkeeper confirmation.

**Verification:**
- verify:12:ui: agree.
- verify:12:db: agree.

**Verifier fixes to the proposal:**
- (verify:12:ui) Draft templates must not be picked up by the existing generator. tt_generate_template_tasks currently filters on active, so keep active=false for drafts as proposed, and make sure any new status column is added with a default so the existing task-templates admin screen (TT_) keeps working. Also add 'weekly' to the cadence CHECK, which allows only monthly, quarterly and annually. Client-only items can use client_ids=[id] without a new client_id column.
- (verify:12:db) task_templates treats empty plan_tiers and empty client_ids as 'every client'. A draft row must set client_ids = array[client_id], enforced by a CHECK when status='draft', and the generator must filter status='active'. Otherwise one imported draft could blanket-generate for all clients if it is activated or the filter is missed. The weekly cadence also needs the cadence CHECK widened, because it is currently monthly, quarterly or annually only. Use the existing client_ids column rather than the proposed new client_id column. tk_confirm_draft_template must be security definer, with a can_access_client check for the caller, because the table's only policy is admin-only.


#### 12.3 12 months of completed history; merge duplicate onboarding projects
**Status:** missing · **Phase:** 2 · **Confidence:** medium

**Exists:** Nothing. There are an estimated 8-10k completed tasks, and duplicate onboarding projects (Collective x2, Golden City x2).

**Missing:** A paged export (Asana search_tasks caps at 100), a bulk insert path that does not fire notifications, and a merge map.

**Proposal:** Export page by page, per project. Insert completed tasks as staff_reminders with status done, source='asana', source_ref = the Asana gid (unique per source), visibility shared, and the original completed_at and due dates. A session flag mgb.tk_import bypasses the notify, activity fan-out and realtime-heavy triggers. Merge duplicate projects by mapping both gids to one client or tk_projects onboarding project in tk_asana_import_map, with the product owner confirming the winner in the dry-run CSV. Whether to import full rows or a lighter archive stays an open question.

**Evidence:**
- `supabase/staff-reminders-v2.sql` 36-46 — source has no CHECK, so 'asana' can be added; source_ref can hold the gid
- `supabase/notification-emails.sql` 136-172 — notify triggers that must be bypassed during bulk insert

**Verification:**
- verify:12:ui: agree.
- verify:12:db: agree.

**Verifier fixes to the proposal:**
- (verify:12:ui) Proposed 'source_ref = Asana gid (unique per source)' does not exist yet. The only unique index is partial on source='template' (task-templates.sql 139-141), so reruns would duplicate rows. Add a new partial unique index on (source_ref) where source='asana' (or on tk_asana_import_map). Rely on tk_asana_import_map for idempotency.
- (verify:12:ui) Setting a session flag 'mgb.tk_import' from a node script over supabase-js/PostgREST will not persist across calls; each REST call is its own transaction, and the repo's convention uses set_config(..., true), which is transaction-local, inside a security definer RPC (staff-offboarding.sql 221-239). The import must go through a service-role RPC (for example tk_import_batch) that sets the flag and inserts in one transaction.
- (verify:12:ui) Imported rows with visibility 'shared' need a non-null client_id (staff_reminders_shared_needs_client), so history from internal projects (Directors, Owners, COO-SOP) cannot be shared and must be private with a staff_email owner. Tasks assigned to an unmatched Asana user have no owner; define a fallback (the admin's email or a skipped list) or the insert violates the owner column.
- (verify:12:db) The proposal says the mgb.tk_import session flag bypasses the notify triggers. It is unnecessary for completed rows, because notify_enqueue_task_assigned returns early when new.done is true (and the outbox write in notification-emails.sql is only for open tasks). It also cannot be set from a PostgREST or service-role client, since each request is a separate transaction. Use a security-definer import RPC that calls set_config('mgb.tk_import','on',true) and inserts in the same transaction, or connect to Postgres directly.
- (verify:12:db) 'source_ref unique per source' does not exist. The only unique index is partial on source = 'template'. Add create unique index ... on staff_reminders (source_ref) where source = 'asana' before the import, so reruns cannot duplicate.
- (verify:12:db) staff_reminders.staff_email is NOT NULL and a shared row needs client_id. Completed tasks from Asana users with no matching staff row (11 Asana users vs 8 staff) and tasks in internal projects with no client cannot be inserted as proposed. Decide a fallback, such as an archive table, a placeholder owner, or private rows owned by an admin, and state it in the proposal. Also the brief's 'done' is a boolean plus completed_at today, because the status column is not yet added. Sequence the import after the status column migration, or write done=true, completed_at.

**Critic:**
- Add a partial unique index on source_ref where source='asana'. Import through a definer RPC that sets mgb.tk_import inside the transaction. Define the owner fallback and the private visibility rule for internal and unmatched rows. Batch inserts to avoid realtime floods. Pick client_onboarding or tk_projects for the duplicate merges.

**Decision applied (2026-10-10):** Keep completed history indefinitely. Default views (My Tasks, List, client pages) hide done tasks older than 12 months; a 'Show older' toggle and search still reach them. 8-10k rows is small for Postgres, so no archive table.


#### 12.4 Parallel run with Asana through the November close
**Status:** missing · **Phase:** 2 · **Confidence:** low

**Exists:** Nothing.

**Missing:** A reconciliation between Asana and the portal during November.

**Proposal:** A read-only nightly diff (script or view) comparing open and completed Asana tasks with generated portal tasks per client and period, sent to the admin as a report (TK_ParallelReport). No two-way sync. Staff work in both tools through the November close, so the diff must flag items missing on either side.

**Evidence:**
- `docs/tasks-module-brief.md` 72 — Gate: Asana import plus parallel run start in phase 2

**Verification:**
- verify:12:ui: agree.
- verify:12:db: agree.

**Verifier fixes to the proposal:**
- (verify:12:db) The diff is only meaningful once tk_generate has produced portal tasks and the import map exists. Make it depend on those, and set it up as a service-role script or an admin-only security-definer view, not a client-readable table. If it is stored, it needs admin-only RLS.

**Decision applied (2026-10-10):** The parallel run compares tasks and completions only; no Rules, forms or email-to-task behaviour needs to be matched (D4).


### Area N Non-negotiables

#### N.1 One name prefix per new file (TK_), registered in window.__SOURCE_ORDER, CSS per component, no bundler
**Status:** exists · **Phase:** 1 · **Confidence:** high

**Exists:** The convention and loader are in place. A grep found no TK_ or tk_ identifiers, so the prefix is free.

**Missing:** Nothing structural. New files must be registered in __SOURCE_ORDER before app.jsx, in dependency order, with their CSS links.

**Proposal:** Put files in components/tasks/: TK_logic.js (pure, module.exports guard), TK_store.js, TK_sync.js, TK_TaskRow.jsx, TK_Drawer.jsx, TK_MyTasks.jsx, TK_List.jsx, TK_QuickAdd.jsx, TK_Sidebar.jsx, TK_StandaloneBar.jsx and TK_App.jsx, each with its own .css. Register them in order: logic, store, sync, rows, drawer, views, app. Add a smoke check that every TK_ global is defined.

**Evidence:**
- `index.html` 142-211 — window.__SOURCE_ORDER (68 entries, app.jsx last)
- `index.html` 109-134 — CSS document.write links with cache-bust

**Verification:**
- verify:N:db: agree.
- verify:N:ui: agree.

**Verifier fixes to the proposal:**
- (verify:N:db) Add the TK_ CSS links to the document.write block in index.html, and note that test files (TK_*.test.js) must not be added to __SOURCE_ORDER. Also say the files are fetched and compiled in the order listed, so TK_logic.js must declare globals the later TK_ files use.
- (verify:N:ui) Note that new files must be inserted before app.jsx in __SOURCE_ORDER and that ToastProvider lives in app.jsx (line 386), so any Toast undo-action change has to be made in app.jsx, not a TK_ file.

**Critic:**
- Fix one file-naming convention. Note that ToastProvider and ModalShell are app.jsx edits. Add a smoke check, and note tests are excluded from __SOURCE_ORDER.


#### N.2 RLS on every new table, re-runnable SQL, nothing destructive to existing tables without a data-preserving migration
**Status:** extend (analysts said exists; corrected by verifiers) · **Phase:** 1 · **Confidence:** high

**Exists:** The helpers and an idempotent policy style are established.

**Missing:** A shared task-access helper, so child tables do not each re-derive access. The cron guard on task-templates.

**Proposal:** Use supabase/tasks-module-v1.sql onward with IF NOT EXISTS, DROP POLICY IF EXISTS, NOT VALID then VALIDATE for new CHECKs, and unschedule guards. Add SECURITY DEFINER STABLE helpers tk_can_read_task(uuid) and tk_can_edit_task(uuid) covering owner, assignee, reviewer, follower, project member, shared plus can_access_client, and admin. Every tk_ child table uses them. Additive columns only; nothing is dropped. Run get_advisors after each migration.

**Evidence:**
- `supabase/staff-reminders-v2.sql` 156-193 — policy pattern using is_active_staff, can_access_client and the JWT email, with drop policy if exists
- `supabase/pro-budget-reports.sql` 19-34 — is_client_member
- `supabase/staff-client-tools.sql` 1-44 — idempotent if-not-exists style
- `supabase/notification-emails.sql` 250-252 — cron unschedule guard pattern
- `supabase/task-templates.sql` 297-301 — counter-example: cron scheduled with no guard

**Verification:**
- verify:N:db: **disagree, status → extend.** The idempotent style, policy helpers and is_active_staff / can_access_client are live. But the row's own what_is_missing lists a shared task-access helper and a cron guard. No tk_can_read_task / tk_can_edit_task exists anywhere in supabase/*.sql. The task-templates daily cron is scheduled unguarded (task-templates.sql 297-301), unlike the guarded pattern in notification-emails.sql 250-252 and several other crons. This is therefore extend, not exists. Also, 'NOT VALID then VALIDATE' is not an existing repo convention (grep for 'not valid' in supabase/*.sql found nothing relevant), so it is a new practice, not a followed one. Note can_access_client is defined twice (audit-hardening-client-scoping.sql 33 and temp-client-access.sql 77, the later one superseding), and is_active_staff in several files, so new helpers should assume the latest definition.
  - `supabase/staff-reminders-v2.sql` 156-193 — existing policies: owner via staff_email = jwt email; shared rows via is_active_staff + can_access_client. No assignee, reviewer, follower or project access.
  - `supabase/task-templates.sql` 297-301 — unguarded cron.schedule
  - `supabase/notification-emails.sql` 250-252 — guarded pattern to copy
  - `supabase/temp-client-access.sql` 77 — later can_access_client definition
- verify:N:ui: agree.

**Verifier fixes to the proposal:**
- (verify:N:db) tk_can_read_task / tk_can_edit_task must be SECURITY DEFINER STABLE with 'set search_path = public' and 'revoke all ... from public, anon; grant execute ... to authenticated', exactly as is_client_member does in pro-budget-reports.sql. Reuse is_active_staff_admin() for the admin branch. Existing staff_reminders policies are permissive and OR together, so add new policies alongside 'staff manage own reminders' rather than replacing them, and keep the owner policy's staff_email check. Drop the claim that NOT VALID/VALIDATE is a convention: it is new to this repo, so state it as a new rule.

**Critic:**
- Change the status to extend. List every non-additive migration with its data-preservation step and rollback. NOT VALID then VALIDATE is a new rule, not an existing convention.


#### N.3 Tests in the existing *.test.js style for business-day math and status transitions
**Status:** extend · **Phase:** 1 · **Confidence:** high

**Exists:** The test style and runner habit.

**Missing:** Tests for business days, holidays, due rules, transitions, grouping and the quick-add parser.

**Proposal:** components/tasks/TK_recurrence.test.js covers business day N across holidays, month ends, the 4th/14th/24th, leap years, eom offsets and the dependency shift. TK_status.test.js covers the canTransition matrix, review gate and wait restore. TK_logic.test.js covers groupMyTasks buckets, parseQuickAdd and routes. A shared fixtures JSON is also asserted by a SQL check script against tk_add_business_days.

**Evidence:**
- `components/staff/staffOpsLogic.test.js`  — node script, t(name, fn) plus assert style, 15 checks passing
- `components/staff/teamReviewsLogic.test.js`  — same style
- `components/staff/TaskTemplates.jsx`  — TT_nextDue has no tests

**Verification:**
- verify:N:db: agree.
- verify:N:ui: agree.

**Verifier fixes to the proposal:**
- (verify:N:ui) No package.json or test runner exists; add a one-line note in README or a small run-all script for the TK_*.test.js files, and drop the 'SQL check script against tk_add_business_days' unless a SQL test harness is introduced (none exists in supabase/).

**Critic:**
- Add a run-all node script or a README line. Drop the SQL vector harness, or define it as a pg_temp self-check.

**Decision applied (2026-10-10):** Tests cover the calendar-day default, the opt-in business-day rule and the 3-business-day nudge cadence (D2), plus status transitions and My Tasks grouping.


#### N.4 Every screen works at phone width
**Status:** extend · **Phase:** 1 · **Confidence:** high

**Exists:** A breakpoint convention and tokens. No shared drawer, and no phone layouts in the prototype.

**Missing:** A task drawer that goes full-screen on phones, and phone fallbacks for the sidebar, list, board and calendar.

**Proposal:** Build TK_Drawer from the SI_ChatDrawer pattern; it becomes a full-screen sheet at 760px or below. On phones the sidebar becomes a bottom tab bar (My Tasks, Inbox, Search, Add), list columns drop to a second line, the board becomes status tabs or snap panes, the calendar becomes an agenda, and the pop-out button is hidden. Use styles.css tokens, not the prototype's hex values.

**Evidence:**
- `styles.css`  — 760px phone breakpoint and theme tokens on :root, with dark mode
- `components/inbox/StaffInbox.jsx` 1706-1756 — SI_ChatDrawer is the only drawer primitive (portal, focus trap, Esc, scrim)
- `app.jsx` 21945-22020 — ModalShell
- `docs/tasks-prototype.dc.html`  — prototype has no media queries

**Analyst disagreement:** Spec-skeptic proposed a 640px breakpoint. I used the existing 760px breakpoint in styles.css (database-first, UI-first) to follow the conventions.

**Verification:**
- verify:N:db: agree.
- verify:N:ui: agree.

**Verifier fixes to the proposal:**
- (verify:N:db) Correct the evidence references: SI_ChatDrawer is at StaffInbox.jsx line 1821 and ModalShell at app.jsx line 23191. SI_ChatDrawer's focus trap skips when '.modal-overlay' is present, so TK_Drawer opening a ModalShell (confirm, undo) must keep that guard.
- (verify:N:ui) Model TK_Drawer's phone behavior on WD_WidgetDrawer (already a full-width sheet on phones) plus SI_ChatDrawer's focus trap and Esc handling; correct the cites to StaffInbox.jsx:1821 and app.jsx:23191.

**Critic:**
- Fix the cites to StaffInbox.jsx:1821 and app.jsx:23191. Model the phone sheet on WD_WidgetDrawer. Keep the .modal-overlay focus-trap guard.


#### N.5 Bump window.MGB_VERSION
**Status:** exists · **Phase:** 1 · **Confidence:** high

**Exists:** The version mechanism.

**Missing:** Only the bump on each ship.

**Proposal:** Bump the label and note on every shipped Tasks slice, for example note 'Tasks: My Tasks and drawer'.

**Evidence:**
- `index.html` 99 — MGB_VERSION {label:'2026-10-09g', note:'Staff tips while you learn'}

**Verification:**
- verify:N:db: agree.
- verify:N:ui: agree.


## B3. Foundation decisions (full)
Decision legend: foundation = build on it unchanged or nearly so; extend = add to it in place; fold = migrate its data and job into the module, then make it read-only; retire = delete after replacement; keep-separate = leave alone, link to it.

- **[foundation] staff_reminders** (table) → Tasks core table, exposed as view tk_tasks (security_invoker). All three analysts agree. It is live, in realtime, has RLS, assignee_email, created_by, client_id, source/source_ref and recurrence, and Today, StaffRail, staff_performance, notes and triggers all read it. Extend it in place with additive columns (status, description, start_on, section, sort_key, project_id, parent_id, period_start, template_id, series_id, review fields, waiting fields, estimate, tags, deleted_at). A new table would force rewriting the checklist and notes FKs, triggers, the realtime channel and Today.jsx for no data benefit.
- **[extend] staff_reminders_before_write (live body in staff-offboarding.sql)** (trigger) → staff_reminders. Add the done/status sync both ways, the review gate (mgb.tk_approve), created_by forced from the JWT, and assignee pinning for non-owners. Keep the mgb.offboarding bypass and add mgb.tk_import. **Corrected:** do not force created_by from the JWT unconditionally. Stamp it only when the caller is active staff and the owner; the generator, the Asana import (mgb.tk_import flag), automation and the access-request definer inserts have no browser JWT. Preserve the access_request text-sniffing branch and the due_date/due_at sync (writers set only one of the two). Lowercase assignee_email. Note the non-owner branch silently reverts fields with no error, so bulk and automation RPCs must use a transaction-local mgb.* flag.
- **[extend] staff_reminders RLS policies** (policy) → tk_can_read_task / tk_can_edit_task. Add assignee, reviewer, follower and project-member access through shared helpers. Private Owners and Directors work is protected by project membership. **Decision (D3, D10):** client tasks stay gated by can_access_client(), so a bookkeeper sees another client's tasks only while a coverage or temp grant is active. Owners and Directors project membership is all admins; the admins-read-all policy is not narrowed.
- **[extend] complete_staff_item(uuid, boolean, date)** (rpc) → called from tk_set_status(id,'done'); kept as a wrapper for old callers. Database-first and UI-first said extend; spec-skeptic said fold. The outcome is the same: tk_set_status becomes the entry point while complete_staff_item keeps the ad-hoc roll-forward. It must copy the checklist and series_id, null the next source_ref, and respect the review gate. **Corrected:** null the next occurrence's source_ref only for source='template' (source='note' and source='deadline' depend on source_ref).
- **[extend] notify_enqueue_task_assigned** (trigger) → tk_inbox_items fan-out. Route it through tk_inbox_items so generated and imported tasks (which have no JWT) become digest items instead of being silently skipped. **Corrected:** today cron-generated rows are skipped (no JWT) and admin 'Generate now' rows email once per task. Add a source in ('template','asana') skip, and decide what notifies generated tasks in phase 2 before the digest exists.
- **[extend] staffItemsApi (app.jsx 16776-17087)** (js api) → TK_store / tkApi shim. Keep its signatures as a shim for Today and notes during the transition. remove becomes a soft delete, and it keeps the notify() event.
- **[retire] MyTasksPage (app.jsx 18142-19522)** (component) → TK_MyTasks / TK_List. All three agree. It is replaced by the TK_ views mounted at #/tasks/my and inside WK_WorkPage at #/work/tasks, and removed once they match.
- **[foundation] task_checklist_items** (table) → Tasks checklist. Right shape and RLS. Add it to realtime, and copy it on roll-forward.
- **[foundation] TaskChecklist.jsx (TCL_)** (component) → TK_Drawer checklist section. Reuse it inside the drawer. Spec-skeptic's renaming to TK_Checklist is optional and cosmetic.
- **[keep-separate] staff_checklist_presets** (table) → sop_steps (firm-standard, client_id null). Conflict: database-first folded it into task_templates, UI-first kept it as a foundation, spec-skeptic folded it into sop_steps. Presets and firm-standard SOP steps are both named reusable step lists, while task_templates is the generator's item table. Copy the rows in phase 2 and keep the old table read-only for one release. **Corrected:** the presets are personal (owner_email RLS, unique per owner; verifier 4.7). Folding them would publish private lists firm-wide. Keep them personal; add a 'promote to firm standard' action instead.
- **[extend] task_templates** (table) → Recurring engine items (one row = one recurring item). 0 live rows, so low risk. Add weekly cadence plus weekday, due_rule jsonb (backfilled from due_offset_days), template_set_id, client_id for client-only items, status draft/active, sop_section, review_required, assignee_role and estimate_minutes. UI-first's replacement by new tk_template_items is rejected so the issued ledger FK keeps working. **Corrected:** express client-only items with the existing client_ids = array[client_id] (empty arrays already mean every client), or add a CHECK tying a new client_id to it. Do not create a second meaning.
- **[foundation] task_template_issued** (table) → Recurring engine idempotency ledger. PK (template_id, client_id, period) is exactly the dedupe key needed. The weekly period stores the week's Monday.
- **[extend] tt_generate_template_tasks / tt_generate_now / cron task-templates-daily** (rpc+cron) → tk_generate (old names kept as wrappers). Add business-day rules, set and override resolution, role and OOO-aware assignment, the test_only exclusion, period and template links, a dry run, and an unschedule guard.
- **[fold] tt_client_bookkeeper** (function) → tk_client_people. All agree. It ignores backup and reviewer and compares emails inconsistently. One resolver replaces it.
- **[keep-separate] task_template_suggestions** (table). Conflict: database-first extended it as the Asana confirmation queue, UI-first folded it into draft items, spec-skeptic kept it separate. It is admin-resolved and has no cadence, rule or checklist fields, so Asana drafts become draft task_templates rows confirmed by the bookkeeper, and this table stays the staff 'make this recurring' queue.
- **[keep-separate] staff_reminders.recurrence (per-item recurrence)** (columns). Conflict: spec-skeptic wanted to retire it into one-item templates; the others keep it for ad-hoc work. Templates are client and period scoped with admin RLS and no daily cadence, so personal reminders do not fit. Converting them would change live behavior. Fix the source_ref collision instead.
- **[extend] month_close** (table) → Period object (optionally exposed as view tk_periods). All agree to extend rather than add a second period table. It already drives reports-ready emails, CloseTracker and the close KPI. Add sign-off, reviewer and reopen fields, and realtime. Quarter and year periods need a PK change, gated on the product owner's answer.
- **[keep-separate] month_close_settings** (table). Firm-level late_day and stale_bank_days remain valid inputs to automations.
- **[keep-separate] close_checks / close_checks_evaluate / cron close-checks-daily** (table+rpc+cron). Advisory QBO health checks. They can feed period readiness or an automation trigger later, but do not create tasks directly.
- **[fold] client_close_items + CLOSE_CHECKLIST (app.jsx 5248)** (table+const) → MGB Standard Monthly Close set (task_templates) plus client overrides and period tasks. All agree. It is a parallel close checklist. Seed the standard set from CLOSE_CHECKLIST, migrate client rows into client-only items or open-period tasks, then make the table read-only.
- **[extend] client_sops / client_sop_history / save_client_sop / sop-freshness** (table+rpc) → SOP narrative plus new sop_steps; linked from tasks by sop_section. UI-first said keep-separate (link only); the others said extend. Both happen: the narrative tables are unchanged and stay the source of truth, and sop_steps is added beside them for structured steps.
- **[fold] client_doc_requests / fulfill_doc_request** (table+rpc) → client_requests / tk_answer_client_request. Database-first and spec-skeptic fold; UI-first showed both side by side. Ask-client is a superset, so migrate the rows with the status map, keep the old table read-only for one release, and make fulfill_doc_request a wrapper. This avoids two client request queues.
- **[extend] client_doc_chase / client-doc-chaser cron / client-emails edge function / DocChaser.jsx (DC_)** (table+cron+edge+component) → client_requests nudges and TK_WaitingList. Conflict: spec-skeptic retired the chaser. Database-first and UI-first reuse it. Reuse the sending, logging and prefs with a 3-business-day cadence on client_requests. Only the calendar-day cadence and the doc-request-only view retire after migration.
- **[keep-separate] client_email_log / client_email_settings / client_email_prefs / client_email_recipients** (table). Shared client email infrastructure. Widen the feature CHECK for client_request. Recipients serve as the fallback list for Ask-client.
- **[keep-separate] transaction_questions / TxnQuestions.jsx (TQ_)** (table+component). All agree. They are client-initiated and bound to QBO transactions. Copy their RLS and card UI patterns, show the open count on the What we need from you page, and add a 'Make task' action (source='txn_question').
- **[fold] CLIENT_RequestsPanel (app.jsx 753-794)** (component) → TK_ClientNeeds (#/needs). The read-only panel becomes the What we need from you page.
- **[extend] notification_outbox / notification-emails edge function / crons** (table+cron+edge) → Inbox delivery. Widen the kinds for mention, send-back and client-answered. notification-task-due becomes tk_daily_digest.
- **[extend] am_body_mentions** (function) → tk_parse_mentions. Generalize it to any active staff member, for tk_comments.
- **[keep-separate] digest_settings / digest_runs / weekly-admin-digest** (table+cron+edge). The weekly admin digest stays. Copy its idempotency pattern for the daily staff digest. **Corrected:** digest_runs has no staff_email and no unique key, so it cannot be 'reused keyed (staff_email, run_date)'. Use the client_email_log 20-hour check or a new (staff_email, run_date) ledger.
- **[extend] staff_time_off / coverage_overview / grant_coverage_access / Coverage.jsx (CV_)** (table+rpc+component) → OOO reassignment (tk_ooo_reassignments, tk_apply_ooo, tk_return_ooo). Keep the access grants. Add a reversible task reassignment ledger, shown next to the grants on the Coverage page.
- **[keep-separate] offboard_staff** (rpc). A permanent move is a different intent from an OOO round trip. Update it to also move reviewer_email, followers and project membership.
- **[extend] staff_capacity / client_profile.monthly_hours_budget / TeamCapacity.jsx (TP_) / HoursBudget.jsx (HB_)** (table+component) → TK_Workload planned vs capacity. Tables stay as inputs. The components gain a 'planned' series from task estimates.
- **[extend] time_entries** (table) → Task timer. Database-first and spec-skeptic extend it. UI-first's staff_app_time route is rejected. It is dormant, so add task_id, started_at, ended_at and source instead of a new time table.
- **[keep-separate] staff_app_time / record_app_time / AppTimeTracker.js** (table+rpc+component). A passive per-client signal, useful as a comparison, not task time.
- **[keep-separate] firm_deadline_rules / client_deadline_overrides / client_deadline_status / Deadlines.jsx (DL_)** (table+component). Statutory deadlines have their own rules. DL_TaskButton keeps creating tasks with source='deadline', TK_Calendar reuses the DL_ month grid and shows deadlines as markers, and OPS_rollWeekend moves onto tk_holidays.
- **[keep-separate] onboarding_steps / client_onboarding** (table). Conflict: spec-skeptic folded onboarding into an internal project template. Database-first and UI-first keep it separate. It is a working client checklist system. A tk_projects onboarding project links to it, and the duplicate Asana onboarding projects map there. Folding it can be revisited after phase 2.
- **[keep-separate] client_private_notes.linked_task_id** (column). Notes stay notes. The drawer shows linked notes next to comments.
- **[extend] staff_performance (staff-celebrations-performance.sql)** (view/rpc). Replace the tasks_pct approximation with tk_on_time_quarter.
- **[extend] client_files / drive_folders / drive-files edge function** (table+edge) → Attachments and Ask-client uploads. Add a nullable month level and task links. Supabase stays metadata only.
- **[keep-separate] client_documents / document_folders** (table). The client document library. Do not use it for task files, because its staff policy lacks can_access_client. **Corrected rationale:** its staff policy does use can_access_client (audit-hardening-client-scoping.sql:73-76). It stays separate because it is the client-readable document library storing drive_url only, not a task-file store.
- **[extend] Today.jsx (TD_buildRows, TD_RemindersCard)** (component) → Today stays home; rows open TK_Drawer; add folds into TK_QuickAdd; grouping comes from TK logic. Spec-skeptic said fold. Database-first and UI-first said extend. The page stays and its task rows reuse TK_ logic, which avoids duplicate grouping either way.
- **[extend] WorkPage.jsx (WK_)** (component). The Tasks tab mounts TK_MyTasks or redirects to #/tasks. Close and Deadlines tabs stay.
- **[extend] TaskTemplates.jsx (TT_)** (component) → TK_Templates and the client Recurring tab. Reuse the form pieces. Add the due-rule editor, client overrides, SOP link and draft confirmation. TT_nextDue moves to tested TK recurrence logic.
- **[extend] CloseTracker.jsx (CT_)** (component) → #/tasks/close period dashboard. Feed it from period progress and sign-off.
- **[keep-separate] StaffInbox.jsx (SI_)** (component). Messaging stays. Task notifications go to TK_Inbox.
- **[foundation] SI_ChatDrawer pattern** (component pattern) → TK_Drawer. The only drawer primitive (portal, focus trap, Esc, scrim).
- **[extend] ModalShell / ConfirmModal / Toast** (component) → TK_ modals; Toast gains an undo action. Toast takes a string only, and complete and move need undo.
- **[extend] TopBar.jsx (TB_Search, TB_QuickAdd, TB_TasksBadge)** (component). Server-side task search with deep links, the parser-backed quick add, and a badge from assignee rows.
- **[extend] StaffNav NAV_PLACES / NAV_useHashSub / HASH_SUB_ROUTE_PAGES / parseHashRoute** (routing) → tkRoutes. Add the 'tasks' place, use pushState for view changes, and redirect #/work/tasks. **Corrected:** use the LK_ grammar from DeepLink.jsx (`#/tasks/<tab>?item=task:<id>`), not `#/tasks/t/<id>`. Add 'tasks' to HASH_SUB_ROUTE_PAGES; parseHashRoute keeps only [a-z0-9-] segments and client ids are free text, so client ids need encoding or a slug. Route view changes through one helper that dispatches 'mgb-nav'.
- **[extend] Realtime channel staff-reminders-<email> (app.jsx 24353-24411)** (realtime) → TK_sync. Add the new tables, rely on RLS for assignee and follower rows, and add the BroadcastChannel relay. **Corrected:** one channel per table family with the guarded publication add; the existing channel is already RLS-scoped, and realtime.messages policies are staff-wide so topic names isolate nothing. Keep the listener on staff_reminders, not the tk_tasks view (views cannot join the publication).
- **[extend] vercel.json / manifest.webmanifest / INSTALL_APP_PUBLIC gate** (config). A /tasks rewrite, a /tasks shortcut, and a staff-only install flag. Keep X-Frame-Options DENY.
- **[foundation] staffOpsLogic.test.js style** (test pattern) → components/tasks/TK_*.test.js. The existing convention.
- **[keep-separate] client_notes** (table, supabase/client-notes.sql). Shared per-client staff notes. Added by the critic: cited by no analyst. Show in the client header or drawer; do not fold into comments.
- **[extend] has_temp_admin_access** (function, staff-temp-admin-access.sql). It gates the task-templates page today (app.jsx around 25422-25430). TK_Templates, TK_Rules and the import review must decide whether temp admins get them.
- **[extend] Offboarding.jsx / offboard_staff_preview.** The preview must also show reviewer override, follower and project-membership moves.
- **[extend] StaffGuide.jsx + staff_guide + docs/staff-guide/*.md** (my-tasks.md, task-templates.md, month-end-close.md, document-requests.md). Help content to rewrite and republish into staff_guide (docs/ is excluded from Vercel).
- **[extend] components/tour/Tips.jsx + Tour.jsx** (TIPS_). Tips and tour steps point at #/work/tasks and the 'my-tasks' slug.
- **[keep-separate, reconcile] ReplyTimes.jsx, HealthBoard.jsx, ClientHealth.jsx, staff-shoutouts / celebrations, client-status-overrides.** Dashboard neighbors that read done, completed_at or overdue signals; the status sync and soft delete must not change their numbers, and 10.2 should reconcile its overdue definition with them.

## B4. Data model sketch (with corrections)
Corrections applied to the analysts' sketch: reviewer storage is an optional per-client override plus a firm default (the Account Manager) in `month_close_settings.default_reviewer_email`, both phase 2; `staff.can_review` is dropped (role admin suffices); `task_templates` client-only items use the existing `client_ids` array; `created_by` is stamped conditionally; roll-forward nulls `source_ref` only for template rows; `client_contacts` ships in phase 2 only if token-link responders are approved (otherwise recipients are `client_users` minus opt-outs from `client_email_recipients`); the `tk_overdue_by_assignee`, `tk_period_progress` and `tk_review_stats` views are security-definer RPCs like `staff_performance` (not security-invoker views) and apply the server-side `test_only` exclusion; `tk_can_read_task` keeps `can_access_client()` for client tasks (D3) and project membership for project tasks (members of Owners and Directors are all admins, D10); `tk_can_read_task` and `tk_can_edit_task` are SECURITY DEFINER STABLE with `set search_path`, revoked from anon, because an EXISTS subquery inside a policy is itself filtered by RLS (README lines 1003-1005).

```text
PRINCIPLE: extend in place, additive only, nothing dropped. New objects use the tk_ prefix, except client_requests (named in the brief) and client-domain tables (client_contacts, sop_steps).

CORE: staff_reminders (exposed as view tk_tasks, security_invoker). Existing columns already present: text, due_date, due_at, priority, assignee_email, created_by, client_id, visibility, source, source_ref, recurrence, done, completed_at. New columns:
- status text NOT NULL DEFAULT 'todo' CHECK (todo|in_progress|waiting_client|ready_for_review|done)
- status_changed_at, status_changed_by
- status_before_wait, waiting_since, waiting_minutes int default 0
- description text, start_on date, section text, sort_key numeric
- project_id -> tk_projects
- parent_id -> staff_reminders (on delete set null)
- period_start date, with (client_id, period_start) -> month_close(client_id, period)
- template_id -> task_templates
- series_id uuid (ad-hoc recurrences)
- sop_section text
- review_required bool default false, reviewer_email, send_back_count int default 0 (phase 2, with the review loop)
- estimate_minutes int
- tags text[] (GIN)
- deleted_at, deleted_by (soft delete replaces the hard delete)
- search_tsv generated (text plus description), GIN index
- source CHECK added NOT VALID then validated: manual|access_request|template|note|deadline|asana|email|txn_question

HOW staff_reminders ROWS SURVIVE:
- Migration 1 adds the columns with defaults, then runs UPDATE status = CASE WHEN done THEN 'done' ELSE 'todo' END.
- done and completed_at stay and are kept in sync with status by the BEFORE trigger, in both directions. Today.jsx, complete_staff_item, toggleDone, notes linked_task_id and the realtime channel keep working.
- template_id is backfilled by parsing source_ref '<tpl>:<client>:<period>'.
- The trigger forces created_by from the JWT and pins assignee_email for non-owners.
- New policies cover assignee, reviewer, follower and project-member access through tk_can_read_task and tk_can_edit_task. Client tasks stay gated by can_access_client() (D3); Owners and Directors project members are all admins (D10).

CLIENTS AND ROLES:
- clients.reviewer_email -> staff(email): optional per-client override, phase 2. Null means the firm default reviewer, month_close_settings.default_reviewer_email (the Account Manager). Any active admin can still approve (D1).
- client_profile.backup_bookkeeper_email stays where it is, with a validation trigger.
- staff.can_review: dropped (D1, any active admin can review).
- Function tk_client_people(client_id) returns bookkeeper, backup, reviewer and account_manager, with lower() compares. It replaces tt_client_bookkeeper.
- client_contacts (id, client_id, name, email, role, is_request_recipient, active), phase 2.
- tk_projects (id, name, kind internal|onboarding, client_id null, owner_email, sections text[], archived_at) and tk_project_members (project_id, staff_email). Client tasks keep client_id and have no project row.
- sop_steps (id, client_id null meaning firm standard, section, template_id null, sort_order, text, archived_at). client_sops is unchanged as the narrative.

TASK CHILDREN (RLS through tk_can_read_task):
- task_checklist_items: existing, added to realtime.
- tk_comments (task_id, author_email, body, mentions text[], kind comment|send_back|client_reply|system, edited_at, deleted_at)
- tk_activity (bigserial, task_id, actor_email, kind, from_value, to_value, meta jsonb). Append-only, written by trigger and RPCs only.
- tk_followers (task_id, staff_email)
- tk_attachments (task_id, client_file_id | storage_path | drive_url, name, size, added_by, removed_at)
- tk_dependencies (task_id, blocked_by_id, lag_business_days). Cycle-checked. Phase 4.
- tk_tags (catalog: name, color). Phase 4.
- time_entries gains task_id, started_at, ended_at, source, with a partial unique index for one running timer per staff member. Phase 4.

RECURRING ENGINE:
- task_templates (one row = one recurring item) gains: cadence CHECK adds 'weekly', weekday, due_rule jsonb (backfilled {type:'offset',days:due_offset_days}; due_offset_days kept as deprecated), template_set_id -> tk_template_sets, client_id (null = firm item, set = client-only item), status draft|active, sop_section, review_required, assignee_role bookkeeper|backup|reviewer, estimate_minutes.
- tk_template_sets (id, name, is_standard), seeded with 'MGB Standard Monthly Close' from CLOSE_CHECKLIST.
- tk_client_template_overrides (client_id, template_id, skip bool, override jsonb, PK both).
- task_template_issued: unchanged ledger. The weekly period stores the week's Monday.
- tk_holidays (day PK, name).
- Functions tk_is_business_day, tk_add_business_days and tk_business_day_of_month, mirrored in JS and tested against the same fixtures.
- staff_checklist_presets stay personal (owner_email RLS, unique per owner). An owner may promote a preset into firm-standard sop_steps by choice; nothing is copied automatically (verifier correction, see B3).
- client_close_items is migrated into client-only items or open-period tasks, then made read-only.

HOW task_templates ROWS SURVIVE: all new columns are additive with defaults (status 'active', template_set_id null meaning a standalone firm template). The cadence CHECK is dropped and re-added wider. The ledger is untouched, so already-issued keys still block regeneration.

PERIODS: month_close stays the period store. New columns: signed_off_by, signed_off_at, reopened_reason, reviewer_email. Added to realtime.
- UI labels: open = not_started or in_progress, in review = review, closed = done.
- Only tk_sign_off_period may set done, because done fires the client reports-ready email.
- A trigger may auto-advance a period to review.
- Quarter and annual periods need period_kind plus a widened PK (client_id, period_kind, period). That is a data-preserving migration (0 rows today), done only if the product owner wants quarterly or annual sign-off. Weekly tasks do not attach to a period.

REVIEW: tk_set_status, tk_approve and tk_send_back, with the session flag mgb.tk_approve gating done when review_required. View tk_review_stats.

ASK-CLIENT:
- client_requests (id, client_id, task_id, kind document|question|approval, prompt, needs_upload, status open|answered|accepted|cancelled, recipient_emails, reply, client_file_id, asked_by/at, answered_by/at, last_nudged_at, nudge_count, cancelled_at).
- Staff access through can_access_client. Clients access through is_client_member via view client_requests_for_client, and update only through tk_answer_client_request. Client realtime topic policy.
- client_doc_requests is migrated in (open->open, uploaded->answered, done->accepted, cancelled->cancelled) and kept read-only.
- tk_request_tokens (token_hash, request_id, email, expires_at, used_at), only if no-login responders are approved.
- drive_folders.month (nullable, with a widened unique key).
- client_email_log feature CHECK gains client_request.

INBOX:
- tk_inbox_items (recipient_email, task_id, client_id, kind, actor_email, delivery immediate|digest, read_at, archived_at, digested_at)
- tk_inbox_mutes (staff_email, client_id)
- notification_outbox kind CHECK gains staff_task_mention, staff_task_sent_back, staff_task_client_answered.

AUTOMATIONS:
- tk_automation_rules and tk_automation_fires (deduped once per rule, task and day)
- tk_client_email_domains (domain PK, client_id; free-mail domains blocklisted)
- tk_inbound_emails

OUT OF OFFICE: tk_ooo_reassignments (time_off_id -> staff_time_off, task_id, from_email, to_email, reassigned_at, returned_at, skipped_reason).

VIEWS: tk_saved_filters (owner_email, name, filter jsonb, shared, sort_order).

IMPORT:
- tk_asana_import_map (asana_gid PK, kind, local_table, local_id, status)
- tk_import_projects and tk_import_tasks (raw JSON staging)
- Completed history goes into staff_reminders with source='asana' and source_ref=gid, under the mgb.tk_import bypass.

FUNCTIONS: tk_can_read_task, tk_can_edit_task, tk_client_people, the business-day trio, tk_set_status, tk_approve, tk_send_back, tk_ask_client, tk_answer_client_request, tk_generate (tt_generate_* become wrappers), tk_update_series, tk_bulk_update, tk_apply_ooo, tk_return_ooo, tk_fire_rules, tk_sign_off_period, tk_search, tk_parse_mentions, tk_timer_start, tk_timer_stop, tk_confirm_draft_template, tk_save_client_item.

CRONS (all with unschedule guards):
- task-templates-daily calls tk_generate
- tk-automations-hourly
- tk-ooo-daily
- client-doc-chaser repointed to client_requests on 3 business days
- notification-task-due becomes tk_daily_digest

VIEWS (security_invoker): tk_tasks, tk_period_progress, tk_overdue_by_assignee, tk_workload_week, tk_review_stats, tk_waiting_on_client, tk_on_time_quarter, tk_time_rollup.

REALTIME ADDITIONS: task_checklist_items, tk_comments, tk_activity, tk_inbox_items, month_close, client_requests. The client topic needs its own realtime.messages policy.
```

## B5. Conventions checklist for the build
- __SOURCE_ORDER: new components/tasks/TK_*.jsx files must be inserted before app.jsx and after the components/staff/* files they call (TCL_, CV_, DL_, LK_ from DeepLink.jsx, TB_). TK_logic.js must not reference globals defined later. *.test.js files must never be listed. README's load-order prose (lines 34-38) must be updated with the new folder.
- Prefix collisions: TK_ and tk_ are free today. But the row set mixes TK_ globals with lowercase file names (tkRoutes.js, tkRecurrenceLogic.js, TK_sync.js). Keep one convention (file TK_*.js, globals TK_*, SQL tk_*, CSS .tk-*). Also, ModalShell, ConfirmModal and ToastProvider live in app.jsx, so the Toast undo change is an app.jsx edit, not a TK_ file.
- CSS loading: component CSS is added by document.write link tags in index.html (lines 109-134) with a ?v=Date.now() cache-bust and relative hrefs. Each TK_ .css needs its own line. Relative paths break under a /tasks/... path unless <base href="/"> is added (there is none today). Use styles.css tokens with dark mode under both @media and [data-theme=dark].
- RLS pitfall from README (lines 1003-1005): an existence subquery inside a policy is filtered by that table's RLS. tk_can_read_task / tk_can_edit_task must be SECURITY DEFINER STABLE with set search_path, revoked from public/anon. The follower, member, checklist and comment policies must call them, not inline EXISTS on staff_reminders. Probe functions go in pg_temp.
- Existing permissive policies OR together. Add assignee, reviewer, follower and member policies beside 'staff manage own reminders'. The non-owner branch of staff_reminders_before_write silently reverts staff_email, created_by, client_id and visibility (no error), so bulk, series and automation RPCs will appear to succeed while doing nothing unless they use a transaction-local mgb.* flag.
- can_access_client and is_active_staff are defined in several files (audit-hardening-client-scoping.sql, temp-client-access.sql:77). New helpers must assume the latest definition and must not be re-declared in tasks-module-v1.sql.
- CHECK constraints redefined in two files: notification_outbox_kind_check and client_email_log_feature_check exist in notification-emails.sql and tech-inventory-v2.sql. Any widening must restate the full list and update both files, or a re-run narrows them again. Deploy the notification-emails edge function (Kind/PREF map) before the CHECK widening, or one queued row halts the outbox batch.
- .vercelignore excludes supabase/, *.md and docs/. The SQL and the brief never deploy (correct), but docs/tasks-prototype.dc.html is not served either. components/tasks/ must not be added to .vercelignore. *.test.js files are not excluded, so they are served publicly (harmless but inconsistent). Any new top-level folder (scripts/asana-import/) must be added to .vercelignore so service-role code is never served.
- CSP (vercel.json, currently Report-Only): connect-src allows only 'self' and the Supabase host, so no browser call to Asana, Resend or Google is allowed. The import and inbound email must run server-side. script-src allows only unpkg and jsdelivr, so a new library from another CDN will be blocked once CSP is enforced. A service worker falls back to script-src 'self' (fine). Test with MGB_CSP_TEST=1.
- Hash routing: parseHashRoute and buildHashRoute keep only [a-z0-9-] segments, NAV_subFromHash reads only segment 2, and HASH_SUB_ROUTE_PAGES must gain 'tasks'. Client ids are free text, so #/tasks/c/<client> must encode them or use a slug. The App hash-rewrite effect (app.jsx ~26633) plus NAV_useHashSub's replaceState will fight a new pushState router unless it goes through one helper that dispatches 'mgb-nav'.
- Pathname boot: /tasks is the first path-based staff route. AuthGate.jsx:33 returns Google sign-in to origin '/' and PENDING_ROUTE_KEY is per-tab sessionStorage holding only the hash, so convert /tasks/... to '/#/tasks/...' with replaceState before auth. Prefer rewriting only '/tasks' and keeping the rest in the hash, rather than '/tasks/:path*'.
- No bundler, Babel in the browser: app.jsx is about 28k lines and compiles on every load. Keep TK_ files small and avoid TypeScript-only syntax in .jsx unless the loader passes the TS preset for that file (daily-close .tsx is the precedent).
- Test style: plain node scripts with a t(name, fn) plus assert pattern, run as node components/staff/staffOpsLogic.test.js, with no runner and no package.json. Pure logic files need the 'if (typeof module !== "undefined") module.exports' guard so they load both in the browser and in node. There is no SQL test harness, so drop the SQL vector check or add a pg_temp self-check script.
- MGB_VERSION (index.html:99) is {label:'2026-10-09g', note}. Every shipped slice needs a new label in the same date-plus-letter format, and the note in plain words.
- Cron: task-templates-daily is scheduled without the unschedule guard. Every new cron (tk-automations-hourly, tk_daily_digest, nudges) should use the guarded DO-block form and America/Chicago dates, and authenticate edge calls with the vault qbo_cron_key bearer.
- Realtime publication: views cannot join supabase_realtime. Add the base tables with the guarded pg_publication_tables loop (client-sops.sql:241-251), and keep the listener on staff_reminders, not the tk_tasks view.
- Commit straight to main (README) with Vercel deploying in about a minute. Every SQL migration must be applied before the JS that depends on it ships, or use the AM_COLS_OK-style retry-without-columns loader for new clients and staff_reminders columns.
- Deep links: reuse DeepLink.jsx (LK_). Grammar `#/<place>[/<tab>][?item=<kind>:<id>]` and `#/client/<id>/<tab>[/<sub>][?item=...]`; the query is a one-time pointer stripped at boot and stored in sessionStorage under LK_KEY. A `?period=YYYY-MM` parameter (10.1) collides with that stripping; put the period in the path (`#/tasks/close/2026-10`) instead.
- Session flags: follow `set_config('mgb.<name>','on',true)` inside SECURITY DEFINER RPCs (staff-offboarding.sql:221-239, sop-freshness.sql) for `mgb.tk_approve`, `mgb.tk_import`, `mgb.tk_automation`, `mgb.tk_signoff`.
- Partial unique indexes: `staff_reminders_template_ref_uniq` is `UNIQUE(source_ref) WHERE source='template'`; add the same shape for `source='asana'`.

## B6. Risks
From the analysts (R1 to R22) plus the critic's convention-level additions (R23 to R27).

- R1. The live before_write trigger (staff-offboarding.sql) trusts a browser-supplied created_by through coalesce on insert, and does not pin assignee_email for non-owners. Once review and approval depend on who did what, a bookkeeper could spoof created_by or reassign a shared task to dodge review. Fix this in migration 1, before any review logic ships. **Softened by D1:** review is by admins, so the spoof vector is created_by on review-required tasks and reassignment to dodge the queue; pin both for non-owners.
- R2. Today, RLS gives the assignee no read access ('staff manage own reminders' keys on staff_email), so a private task assigned to someone else is invisible to them. Adding assignee, follower and project policies widens access. It must not expose private Owners and Directors tasks to bookkeepers (use project membership), and a mistake could hide or expose tasks.
- R3. Two recurrence engines coexist: per-item recurrence through complete_staff_item, and templates through tt_generate. complete_staff_item copies source_ref, which can collide with the template_ref unique index and fail the completion of a template task that also has recurrence set. During migration the two engines could also double-generate.
- R4. tt_generate_template_tasks does not exclude test_only clients, and cron task-templates-daily is scheduled without an unschedule guard, so re-running task-templates.sql may double-schedule it. Both live clients are test_only, so the first real template would generate tasks for test clients.
- R5. Generated and imported tasks have no JWT, so notify_enqueue_task_assigned skips them, and bookkeepers would get no notice of the monthly close batch unless the digest covers it. Conversely, if the mgb.tk_import bypass is not set during the Asana import of about 8-10k tasks, the outbox and realtime could flood.
- R6. The status/done sync trigger must not double-fire complete_staff_item roll-forward or notify_enqueue_task_assigned. A generated done column would break legacy writers that set done directly.
- R7. Business-day math will be implemented twice (SQL for the generator and nudges, JS for previews and tests). Drift between OPS_rollWeekend (weekends only), the untested TT_nextDue and the new SQL would put due dates on different days in the editor and the generated task. Use shared fixtures and tk_holidays only.
- R8. month_close status 'done' fires notify_enqueue_reports_ready to clients. If a period auto-advances to done when its tasks finish, a client could get 'reports ready' before the reviewer signs off. Only tk_sign_off_period may set done.
- R9. month_close's PK (client_id, period) and its first-of-month CHECK mean quarterly and annual periods would collide with monthly ones (Q1 and January share a date). Supporting them needs a PK change, which CloseTracker, close_pct and the reports-ready trigger must be updated for.
- R10. Ask-client token links for contacts without a client_users row bypass Supabase auth, and the prompt or files may name donors or payroll amounts. Use hashed single-use tokens, a short expiry and rate limits, and hide amounts unless the contact signs in. The magic-link 'next' parameter must accept only same-origin hash values, to avoid an open redirect.
- R11. client_documents' staff policy is is_active_staff() without can_access_client. Attaching task files through it would leak across bookkeepers, so use client_files or a staff bucket. **Correction:** client_documents' staff policy does use can_access_client (audit-hardening-client-scoping.sql:73-76); the reason to avoid it is that it is the client-readable library.
- R12. The Drive folder layout is Client/Year/DocType today. Adding a month level changes the drive_folders unique key, and existing cached folder ids must stay valid, so keep month nullable and widen the key without rewriting rows.
- R13. With 67 Asana projects and only 2 live clients (both test_only), the client roster must be built before the import. Internal projects (Directors, Owners, COO-SOP) would otherwise become fake clients that receive client emails.
- R14. Asana search_tasks caps at 100, so export page by page per project. Asana has no business-day recurrence, so converted 5th, 15th and 25th cadences may shift by a day around weekends compared with what bookkeepers expect during the November parallel run.
- R15. The parallel run means staff work in two tools during the November close, a high-stakes period. The diff report must flag work missing on either side.
- R16. Email-to-task matching by sender domain fails for churches whose treasurers use gmail.com or outlook.com, and mis-mapping files one client's financial email under another client.
- R17. Resend domain verification status is unknown, which could block Ask-client emails, nudges, digests and inbound tasks@.
- R18. No bundler and a shared global scope: TK_ files must load before app.jsx in __SOURCE_ORDER, and a typo silently breaks the whole app. app.jsx is over 25k lines, so keep edits around the effectivePage gate and HASH_SUB_ROUTE_PAGES minimal.
- R19. The /tasks rewrite plus the hash router can double-route or lose PENDING_ROUTE_KEY on sign-in. sessionStorage is per tab, so a popup cannot inherit pending routes. Test a cold, signed-out load of /tasks, of #/tasks/my?item=task:<id>, and of the pop-out path or flag (D11).
- R20. The pop-out depends on window.opener and BroadcastChannel (none exists in the code today). Safari private mode and PWA launch_handler navigate-existing may focus the main window instead of opening a popup. The CSP is report-only, which can hide problems.
- R21. CSP connect-src covers only self and Supabase, so the Asana API and inbound email must run server side (script or edge function), not from the browser.
- R22. The task drawer with comments, activity, checklist and review footer is the densest screen at phone width, and the prototype has no mobile layout to copy.
- R23. Relative asset URLs with no `<base>` tag: a `/tasks/(.*)` rewrite would serve index.html as the CSS and JS files. Add `<base href="/">` or rewrite only the single segment `/tasks` and keep the rest in the hash. `.claude/serve.js` does not rewrite paths, so this cannot be tested locally without changing it.
- R24. CHECK constraints defined in two files (`notification_outbox_kind_check`, `client_email_log_feature_check` in notification-emails.sql and tech-inventory-v2.sql) get narrowed again on re-run unless both files are updated.
- R25. Widening the outbox kind CHECK before the notification-emails edge function knows the new kind stalls the whole outbox batch on the first unknown row. Deploy the function first.
- R26. The before_write trigger's non-owner branch silently reverts staff_email, created_by, client_id and visibility with no error, so definer and bulk RPCs appear to succeed while changing nothing unless they set a transaction-local mgb.* flag.
- R27. The status/done sync and the review gate conflict on legacy `done=true` writes (toggleDone, complete_staff_item, _toggleDoneClientSide): map legacy done=true on a review-required task to ready_for_review, and never sync ready_for_review to done=true.

## B7. Spec versus brief: contradictions resolved
- C1 Status names: the spec's short labels are UI labels; the stored set is todo / in_progress / waiting_client / ready_for_review / done.
- C2 My Tasks grouping: Overdue / Today / This week / Later with Waiting on client as its own section (D6; Today tentative).
- C3 Hours: workload uses task estimate_minutes versus staff_capacity, with actuals from qbo_hours_by_staff (QBO Time), not the dormant time_entries, until the timer ships.
- C4 Period statuses map onto month_close: open = not_started or in_progress, in review = review, closed = done; 'na' stays as 'not applicable this month'.
- C5 Reviewer: any admin, the Account Manager default (D1).
- C6 Timer: brief phases only the rollups (phase 4); the one-tap timer is unphased. Recommendation: phase 3 with Board and Calendar, or defer.
- C7 Phase 1 scope: the product owner kept the fuller scope (D9); see A6 for the sequence.
- C8 Email: per-kind preference keys in the existing PREF map, not a new prefs table.
- C9 Clients: extend the clients table and client_profile; no new client table.
- C10 Roles: Owner/Admin/Reviewer/Bookkeeper/Client in the spec collapse to staff.role admin|bookkeeper plus client_users. Owner = admin for the Tasks module (D10); no third role value, so the staff.role CHECK and every is_active_staff_admin() site stay as they are.
- C11/C12 Spec-only items: waiting-on-client list and My stats are in rows 10.5 and 5.2.
- URL scheme: the spec's /tasks/c/manna/t/1234 becomes #/client/<id>/tasks?item=task:<id> under the LK_ grammar; client ids are free text and are never put in a path unencoded.
- Magic link: 14-day expiry per spec; carry 'next' in emailRedirectTo with a same-origin hash whitelist plus a Supabase redirect allow-list entry (sessionStorage PENDING_ROUTE_KEY does not survive a new tab).
- Token uploads for no-login responders need an edge function (service role writes to Drive); phase 2 only if approved.

## B8. Live database versus repo
- Table inventory: every table defined in `supabase/*.sql` exists live and every live public table is in the repo (diff clean). RLS is enabled on all 30 task-relevant tables checked.
- Function inventory: live names match the repo; the only repo-only name is a `_has` helper used inside DO blocks, which is expected.
- Trigger body: the live `staff_reminders_before_write` matches `supabase/staff-offboarding.sql:38-89` (the latest definition; the earlier one in staff-reminders-v2.sql is superseded). `can_access_client` is defined twice in the repo; the live body is temp-client-access.sql:77.
- Row counts (2026-10-10): staff 8 (4 admin, 4 bookkeeper, all active); staff_reminders 1 (source `note`, private, no due date); task_checklist_items 0; staff_checklist_presets 0; task_templates 0; task_template_issued 0; task_template_suggestions 0; month_close 0; month_close_settings 1; time_entries 1; transaction_questions 0; client_documents 0; client_files 1; document_folders 10; client_sops 0; firm_deadline_rules 6 (1099-nec, w-2, 941, 940, 990, 1096 opt-in); client_deadline_overrides 0; staff_time_off 0; staff_capacity 0; notification_outbox 3; client_messages 2; staff_client_access 2; clients 2 (both test_only: 1 basic, 1 premium); client_users 1; audit_log 47; user_settings 2.
- Consequence: the schema can still change cheaply, but every tk_ view, the generator and the dashboards must apply the server-side `test_only` exclusion (clients-test-only-server-side.sql), and a real client roster must exist before the Asana import gate.
- Cron: `task-templates-daily` ('15 10 * * *') is scheduled without the unschedule guard; `notification-task-due` ('30 11 * * *'); `digest_cron_tick` is the DST-aware hourly tick to copy for new jobs.

## B9. Asana workspace inventory (read-only, 2026-10-10)
- One workspace on the firm's domain. 11 users, all on that domain: 2 owners, 2 admins (one is the Account Manager) and 7 bookkeepers (names left out of this file). The portal has 8 staff rows, so 3 Asana users need a mapping decision. A newly hired bookkeeper has a client team and an onboarding project but no Asana user yet. No workspace AI agents.
- 14 teams. Client teams are named for the bookkeeper (six "<bookkeeper>'s Clients" teams) and every one also contains both owners and both admins, so 'team → bookkeeper' means the person in the team name. Directors (both owners and both admins), Owners (both owners and one admin), All Team (10), plus legacy or empty teams (Sales/Marketing, one named for the Account Manager, two 'first team's, and one named for a client).
- 67 projects: 62 active, 5 archived. About 35 active client projects with monthly work (300 to 1,600 tasks each; lifetime about 20,900 completed of about 22,000 across the 35 oldest). A 2026 onboarding cohort of about 23 smaller client projects. Onboarding pipeline projects owned by one of the owners with 25 to 27 tasks each and no team. Internal: Directors Tasks, COO-SOP, AM-SOP, Owners Tasks, COO Tasks, 90 Day, Send Reports (a completed report-sending log). Two 'template' projects (New Client Template, Employee Onboarding Template) are ordinary projects, not Asana templates.
- Duplicates confirmed: Collective Church Onboarding ×2 (both active, created 2026-07-20 and 2026-07-30) and Golden City Church Onboarding (archived + active). The connector listing showed one gid under both names, so the importer must re-verify the pairing. About 15 projects have no team (bookkeeper must be derived from assignee or owner). New Client Onboarding is a multi-client tracker whose sections are client names, a different shape from per-client onboarding.
- Sections seen: Weekly / Monthly / Annual / Occasional / Untitled (plus client-name sections in the shared tracker). Estimated 8 to 10k completed tasks in the last 12 months. Zero attachments in the sampled tasks. Teams attached to projects do not always match who works the tasks.
- API limits: search_tasks caps at 100 per call (export per project, page by page). The API cannot expose Rules, forms or email-to-task settings, so D4 must be confirmed by asking staff. Project-level data exposed: owner, team, members, custom_field_settings, sections. Custom fields seen: 'Task Progress' (Tree City), 'Assignee Role' and 'Tools & Systems' (90 Day).
- Reviewers in practice today: 'Email <owner> reports to review' and older 'Email <bookkeeper> reports to review' tasks appear in client projects. With D1 the module routes review to admins (the Account Manager default), so these tasks become the review step, not imported as tasks.

## B10. Assets the analysts missed (collected by the verifiers and the critic)
Deduplicated by file; one mention per file or symbol, trimmed. The full verifier output is in the workflow journal (B14).

- (verify:3:db) components/dashboard/WidgetDrawer.jsx:355-405 WD_useDragReorder: the only native drag-reorder hook, with a documented touch fallback (up/down buttons). Relevant to the Board and to sort_key reorder in List.
- (verify:3:db) components/staff/Deadlines.jsx:40-110 DL_useStore + components/staff/staffOpsLogic.js:243 OPS_deadlineItems: the data pipeline for calendar deadline markers (computed on the client, not a table).
- (verify:3:db) components/settings/Settings.jsx:1184-1198 Settings > Keyboard shortcuts card: the existing shortcut documentation the ? sheet should share.
- (verify:3:db) components/staff/TopBar.jsx:312-381 TB_pageRows/TB_actionRows and TB_QUICK_ADD_EVENT (line 59): the Cmd+K action registry, where task actions and the q/c create shortcut should hook in.
- (verify:3:db) app.jsx:18253, 18550-18560 MyTasksPage scopeFilter (all/mine/shared) and client filter: existing filter state the List and saved filters should carry over.
- (verify:3:db) components/staff/TeamPage.jsx:888-904: admin cross-staff staff_reminders query (open plus completed in period), a per-person list or overdue-by-bookkeeper source.
- (verify:3:db) components/inbox/StaffInbox.jsx:680-700: per-client open-task panel in the inbox side panel, another staffItemsApi.list consumer that List and TK_store must keep working.
- (verify:3:db) supabase/admin-read-all-tasks.sql: 'admins read all reminders' select policy, the only current path to read another person's tasks.
- (verify:3:db) supabase/user-settings.sql + Settings.jsx ST_store (user_settings.settings JSON): per-person prefs store, a fit for remembered view, group-collapse state and the default view, separate from shared saved filters.
- (verify:3:db) docs/tasks-prototype.dc.html:279-280, 1015-1017: prototype calendar view toggle (only the board toggle was cited).
- (verify:1:db) supabase/staff-time-off.sql 162-250: coverage_overview and grant_coverage_access already resolve the backup from client_profile and check it is active staff. tk_client_people must agree with them, or they should call it.
- (verify:1:db) supabase/staff-offboarding.sql offboard_staff (lines 14-30, 213): moves clients.assigned_bookkeeper_email only. It does not move account_manager_email or client_profile.backup_bookkeeper_email, so a future reviewer_email is not covered either.
- (verify:1:db) supabase/account-manager.sql 69-95: clients_account_manager_before_write is the lowercase and display-name trigger pattern a reviewer_email column should copy.
- (verify:1:db) supabase/clients-roster.sql 38-60: clients insert and update are admin-only (is_active_staff_admin), so only admins can set reviewer_email or other clients columns; client_profile is writable by any assigned staff.
- (verify:1:db) supabase/client-read-own-org.sql: 'client reads own org' select policy on clients. Any new clients column (reviewer_email, qbo_url, drive_root_url) is visible to the client's portal users.
- (verify:1:db) supabase/month_close (month-close sql, lines 89-101): month_close_settings singleton is the natural home for a firm default_reviewer_email.
- (verify:1:db) supabase/team-reviews-2-rpcs.sql review_settings.default_reviewer_id and tr_set_default_reviewer: an existing firm-default-reviewer pattern (uuid, admin-only). Do not confuse it with close review.
- (verify:1:db) supabase/client-users-scoping-update.sql: assigned bookkeepers can read, insert and update client_users through can_access_client, so phase-1 contacts editing needs no new policy.
- (verify:1:db) supabase/qbo-firm-time.sql qbo_customer_client_map / qbo_customer_resolution: the firm QBO customer to client mapping (TeamQbo.jsx 1401-1413).
- (verify:1:db) supabase/pro-budget-reports.sql 19-34 is_client_member(text): exists and is granted to authenticated, so the proposed client_contacts RLS can use it.
- (verify:1:db) supabase/staff-onboarding.sql staff_onboarding_steps / staff_onboarding_progress with components/staff/StaffOnboarding.jsx: an internal onboarding system the 1.4 'onboarding' project should link to or exclude.
- (verify:1:db) components/staff/ClientsPage.jsx, ClientSwitcher.jsx, SopFreshness.jsx, Onboarding.jsx, Coverage.jsx (CV_StaffSelect, CV_BackupName, CV_OutTag): client-level UI to reuse for the client container and the People chips.
- (verify:1:db) supabase/client-health.sql: reads client_profile and month_close_settings; another consumer of the client record.
- (verify:4:db) clients.assigned_bookkeeper_email, client_profile.backup_bookkeeper_email (staff-client-tools.sql:33) and clients.account_manager_email (account-manager.sql:50-60): the real inputs for 4.4's role-based assignee resolution. tk_client_people does not exist yet.
- (verify:4:db) staff_time_off plus the OOO overlap logic in coverage_overview (staff-time-off.sql:23, 140-190): the existing source for out-of-office-aware assignment.
- (verify:4:db) staff_client_access_grants / can_access_client temp grants (temp-client-access.sql:80-101): an OOO backup sees a shared generated task only if a grant or assignment exists.
- (verify:4:db) notification-task-due cron and the staff_task_due outbox kind (notification-emails.sql:19,28,252): generated tasks already get due-day emails.
- (verify:4:db) firm_deadline_rules.due_rule jsonb and the OPS_ deadline evaluator (firm-deadlines.sql:272-295, staffOpsLogic.js:144-266): an existing jsonb due-rule precedent for 4.3.
- (verify:4:db) task_template_suggestions (task-template-suggestions.sql:26-114): FK to task_templates; staff 'make recurring' queue relevant to 4.1, not cited by any row here.
- (verify:4:db) month_close readers not cited: client-health.sql:107-120, components/staff/Today.jsx:279, components/staff/Onboarding.jsx:54, client-onboarding.sql:6-14 (first_close).
- (verify:4:db) CLOSE_CHECKLIST consumers outside app.jsx: components/staff/HomeCards.jsx:242,266 and components/inbox/StaffInbox.jsx:707, which break if the constant is removed when the standard set is seeded.
- (verify:4:db) staff_reminders source_ref consumers: source='note' links (app.jsx:18499-18612) and source='deadline' dedupe (components/staff/Deadlines.jsx:46-64,227).
- (verify:4:db) TT_TIERS = ['basic','premium'] (TaskTemplates.jsx:28) while the DB allows 'standard' (plans-basic-plus-pro.sql:20-22): the editor cannot target standard-plan clients.
- (verify:1:ui) staff_client_access + staff_client_access_grants + can_access_client (supabase/staff-client-access.sql, temp-client-access.sql 77-100): the real access gate behind every per-client policy; a reviewer or backup must be in it to read client tasks
- (verify:1:ui) coverage_overview / grant_coverage_access (supabase/staff-time-off.sql 140-300): existing consumers of backup_bookkeeper_email that tk_client_people must agree with
- (verify:1:ui) CV_StaffSelect / CV_useDirectory / CV_BackupName (components/staff/Coverage.jsx 92-160): existing staff picker and name chip to reuse for reviewer and People chips
- (verify:1:ui) CL_isMine (components/staff/ClientsPage.jsx 66-80) plus the backup reads in HealthBoard.jsx 34-43 and TeamPage.jsx 780-813: three separate client-side role resolvers TK_clientRoles should replace or match
- (verify:1:ui) review_settings.default_reviewer_id + tr_set_default_reviewer (supabase/team-reviews-1-schema.sql 57-66, team-reviews-2-rpcs.sql 131-140): an existing firm-default-reviewer pattern (performance reviews; do not reuse the row)
- (verify:1:ui) month_close_settings (supabase/month-close.sql 89-111): existing firm-level singleton settings row, a natural home for a default close reviewer
- (verify:1:ui) clients_bookkeeper_before_write / clients_bookkeeper_after_write / sca_clear_assigned_bookkeeper triggers (supabase/assigned-bookkeeper-email.sql 57-133): the pattern a reviewer_email column should copy
- (verify:1:ui) window.AM_COLS_OK retry-without-columns roster loader (index.html 328-341): the convention for adding new clients columns
- (verify:1:ui) qbo_customer_client_map (supabase/qbo-firm-time.sql 196-217): admin-only client to QBO customer mapping for firm time
- (verify:1:ui) client_email_prefs.summary_recipients and clients.org_address (supabase/user-settings.sql 261-271)
- (verify:1:ui) drive_status (supabase/google-drive-files.sql 151): whether Drive is connected, needed before showing a Drive link
- (verify:1:ui) ClientSopView readOnly mode (app.jsx 17639), client 'sop' page tab (app.jsx 27084), OPEN_CLIENT_SOP_EVENT/requestOpenClientSop (app.jsx 17365-17418)
- (verify:1:ui) SopFreshness.jsx (SF_useSopStatus, mark_sop_reviewed caller)
- (verify:1:ui) siSopSnippets / SI_ClientContext (components/inbox/StaffInbox.jsx 660-700): existing client context panel showing SOP, doc requests, close items and tasks
- (verify:1:ui) staff_onboarding_steps / staff_onboarding_progress (supabase/staff-onboarding.sql)
- (verify:1:ui) client_milestones / client_milestone_history (supabase/client-milestones.sql)
- (verify:1:ui) admins read all reminders policy (supabase/admin-read-all-tasks.sql)
- (verify:1:ui) staff_reminders_shared_needs_client CHECK (supabase/staff-reminders-v2.sql 59-63)
- (verify:4:ui) task_template_suggestions plus TT_suggestFromTask / TT_openDraft 'Save as template' (supabase/task-template-suggestions.sql; TaskTemplates.jsx 58-101; app.jsx 18428): the existing way a bookkeeper proposes a recurring item; relevant to 4.1
- (verify:4:ui) TT_stripPeriod (TaskTemplates.jsx 63): strips the ' · Sep 2026' / ' · Q3 2026' period suffix and must learn a weekly label for 4.2
- (verify:4:ui) client_profile.backup_bookkeeper_email (staff-time-off.sql 162, 244) and clients.assigned_bookkeeper_email (assigned-bookkeeper-email.sql): inputs for 4.4 assignee_role backup/bookkeeper resolution
- (verify:4:ui) firm_deadline_rules.due_rule jsonb and cadence 'annual' (firm-deadlines.sql 272-295): an existing due-rule jsonb precedent that the 4.3 shape should match or deliberately diverge from
- (verify:4:ui) staff_reminders_template_ref_uniq partial unique index (task-templates.sql 139-141): the dedupe backstop that 4.6 depends on
- (verify:4:ui) staffItemsApi._toggleDoneClientSide and nextRecurrenceYmd (app.jsx 16963-16975, 17125-17167): a browser roll-forward fallback that also copies source_ref
- (verify:4:ui) CloseChecklistCard (app.jsx 5976-6075, mounted 6533) and timeline Close entries (app.jsx 6344): the live UI over client_close_items and CLOSE_CHECKLIST
- (verify:4:ui) month_close consumers: client_health (client-health.sql 107-125), Today.jsx 279, Onboarding.jsx 54, supabase/functions/client-emails/index.ts 347, staff_performance (staff-celebrations-performance.sql 222-231)
- (verify:4:ui) CT_CloseTrackerPage mount in WorkPage.jsx 82 and its direct upsert path (CloseTracker.jsx 291-308)
- (verify:4:ui) CLIENT_SOP_SECTIONS / CLIENT_SOP_SECTION_IDS (app.jsx 17370-17407): the only definition of sop_section keys
- (verify:4:ui) task-templates page gate (app.jsx 25422-25430: admin or hasTempAdminAccess) and the #/templates alias (app.jsx 24163, TopBar.jsx 862)
- (verify:4:ui) TT_matchCount defaults a missing plan to 'standard' (TaskTemplates.jsx 164-169), which differs from the SQL join c.plan = any(plan_tiers)
- (verify:5:db) client_budget_drafts status flow draft/submitted/changes_requested/approved, with submitted_by/at and decided_by/at (supabase/pro-budget-reports.sql 50-100), plus client_budget_draft_history (status and note per change). This is the closest existing...
- (verify:5:db) ProBudgetNoteModal with required reason and 'Send back' confirm (components/pro/ProBudget.jsx 1160-1180, 1770-1795). An existing send-back-with-required-reason UI to reuse in the TK_Drawer footer.
- (verify:5:db) mgb.sop_review session-flag column guard: client_profile_guard_sop_review trigger plus mark_sop_reviewed, which sets and then clears the flag (supabase/sop-freshness.sql 33-86). This is a closer match than mgb.offboarding for 'only this RPC may set these...
- (verify:5:db) team-reviews 'reviewer is never the reviewee' rule: reviews CHECK (staff_id <> reviewer_id) and review_settings.default_reviewer_id (supabase/team-reviews-1-schema.sql 60-109). A precedent for the self-approval block and a firm default reviewer.
- (verify:5:db) staff_directory() SECURITY DEFINER roster RPC (supabase/staff-time-off.sql 108-121). The staff RLS lets a user read only their own row (staff-schema.sql 25-30), so a reviewer picker or a can_review flag has to be surfaced here.
- (verify:5:db) notification_outbox kind CHECK (supabase/notification-emails.sql 47-51) lists staff_task_assigned but no review kinds. It must be widened for the immediate send-back email.
- (verify:5:db) is_active_staff_admin() (supabase/staff-admin-policies.sql 29-43). The existing admin check for 'reviewer or admin' in tk_approve.
- (verify:2:db) notify_enqueue_task_assigned trigger (supabase/notification-emails.sql:136-171): fires on insert or update of assignee_email; today it can email a colleague about a private task they cannot open. Relevant to 2.1 assignee RLS.
- (verify:2:db) notification_outbox kind CHECK and client_email_log feature CHECK, latest in supabase/tech-inventory-v2.sql:52-60. Both must be widened for staff_task_mention and send-back kinds (2.4).
- (verify:2:db) Server-side readers of staff_reminders that would count soft-deleted rows: client_health() overdue CTE (supabase/client-health.sql:144-150), staff_performance tk CTE (supabase/staff-celebrations-performance.sql:240-248), weekly digest counts...
- (verify:2:db) staff_reminders_template_ref_uniq, a partial unique index on source_ref where source='template' (supabase/task-templates.sql:139-141). complete_staff_item and _toggleDoneClientSide both copy source_ref into the next row.
- (verify:2:db) task_template_issued ledger plus the tt_generate_template_tasks checklist copy (supabase/task-templates.sql:243-268): the generator inserts with no JWT, which the created_by fallback relies on.
- (verify:2:db) audit_log and audit_row_change() (supabase/audit-log.sql) and client_activity_log (supabase/client-activity-log.sql): trigger-written log patterns for tk_activity (2.7)
- (verify:2:db) staff_guide.search_tsv and search_staff_guide() (supabase/staff-guide.sql): the existing full-text search pattern (2.13)
- (verify:2:db) StaffQuickActions (app.jsx, about line 6808): the real listener for tb:quick-add, with task, request and note modals (2.11)
- (verify:2:db) staff-chat-attachments private bucket with policies (supabase/staff-chat-v2.sql:226-240) and its size and MIME limits (supabase/audit2-storage-limits.sql): the pattern for a task-files bucket (2.5)
- (verify:2:db) Realtime private-channel policy 'staff read realtime' (supabase/audit2-realtime-private-channels.sql:31): staff-wide, so new tk_ tables can join without topic changes
- (verify:2:db) client_budget_comments (supabase/pro-budget-reports.sql:102-119): the only existing comment table shape
- (verify:2:db) staff-client-tools.sql:236-240 policy 'staff read client time entries': other staff can read time_entries on accessible clients (2.10)
- (verify:5:ui) client_budget_drafts / client_budget_draft_history (supabase/pro-budget-reports.sql 54-100): an existing draft, submitted, changes_requested, approved state machine with decided_by/decided_at and a history row that stores the send-back note. This is the...
- (verify:5:ui) ProBudgetNoteModal (components/pro/ProBudget.jsx 330) with the required, placeholder and confirmLabel='Send back' props (1778-1786): a working required-reason modal to reuse or generalize for TK send-back.
- (verify:5:ui) staff_directory() (supabase/staff-time-off.sql 108-121): a security-definer picker of active staff. It is needed for a reviewer picker, because staff RLS only lets non-admins read their own row.
- (verify:5:ui) Today.jsx 'review' row kind and icon (components/staff/Today.jsx 69, 474-485, 650): today they mean the quarterly HR review. A task review queue row needs its own kind, or it will collide.
- (verify:5:ui) CLOSE_CHECKLIST 'Reports reviewed' step (app.jsx 5338) and the month_close 'review' status / CT_STATUSES (components/staff/CloseTracker.jsx 41): period-level review that a task-level review loop must feed or stay consistent with.
- (verify:5:ui) team-reviews self-review guard pattern (supabase/team-reviews-2-rpcs.sql 159-163, 242): 'Nobody can review themselves.' raise in the RPC, the precedent for blocking self-approval.
- (verify:3:ui) components/staff/DeepLink.jsx (LK_ deep-link grammar, untracked and added today): #/<place>[/<tab>][?item=<kind>:<id>]. 'task' and 'view' are already in LK_KINDS, and LK_useArrival/LK_take/LK_reveal let a destination claim an arrival. No task claimer...
- (verify:3:ui) supabase/user-board-layouts.sql and components/dashboard/WidgetDrawer.jsx: named per-user saved views (views jsonb), synced across devices, with a JWT-stamped guard trigger.
- (verify:3:ui) MyTasksPage's non-task cards: Notes (#my-tasks-notes), SOPs (#my-tasks-sops), By client handoff cards, NoteComposer, and the OPEN_CLIENT_SOP_EVENT listener. They live inside MyTasksPage and are lost if it is retired.
- (verify:3:ui) components/staff/Today.jsx TD_Band (694-756): the existing tone-banded row list component.
- (verify:3:ui) components/staff/team-ops.css .dl-grid phone rule (lines 179-203): chips become dots at 640px.
- (verify:3:ui) components/staff/StaffNav.jsx NAV_subFromHash / NAV_useHashSub read only the second hash segment. NAV_TabRow is the tab primitive.
- (verify:3:ui) index.html component manifest (around line 150-210 list of components/*.jsx, plus document.write CSS links). New components/tasks/TK_*.jsx files and CSS must be registered there.
- (verify:3:ui) Staff guide help slug 'my-tasks' (StaffNav work tab help, components/tour/Tips.jsx:305, docs/staff-guide/work-page.md, bookkeeper-guide.md, task-templates.md).
- (verify:2:ui) StaffQuickActions modal (app.jsx ~6969, drifting): the actual writer behind 'tb:quick-add' for client tasks
- (verify:2:ui) notification-emails edge function task_due job (supabase/functions/notification-emails/index.ts:192-210): reads staff_reminders done=false and due_date=today by assignee_email
- (verify:2:ui) client-emails edge function (supabase/functions/client-emails/index.ts:336-345): emails clients the text of completed shared tasks (done=true, completed_at range)
- (verify:2:ui) client-health.sql:143-150 overdue CTE: counts done=false and due_date<today per client
- (verify:2:ui) weekly-digest.sql:400-406 and digest-staff-feedback.sql:232-238: direct staff_reminders counts
- (verify:2:ui) staff-celebrations-performance.sql:240-250 (tk CTE on done/overdue) and 266-276 (te CTE falls back to time_entries minutes)
- (verify:2:ui) audit_log + audit_row_change() + log_audit_event (supabase/audit-log.sql): append-only, SECURITY DEFINER log pattern; client_activity_log; components/staff/AuditLog.jsx
- (verify:2:ui) task_templates.checklist text[] copied into task_checklist_items by tt_generate_template_tasks (task-templates.sql:92-98, 262-270)
- (verify:2:ui) "staff read client time entries" policy (supabase/staff-client-tools.sql:236-240)
- (verify:2:ui) TB_useMyItems (TopBar.jsx:204-227), the TB_Bell assigned-to-me filter (TopBar.jsx:824) and TB_TasksBadge (TopBar.jsx:937)
- (verify:2:ui) isMyStaffItem / countDueStaffItems (app.jsx ~18214): sidebar due badge logic
- (verify:2:ui) OPS_rollWeekend (components/staff/staffOpsLogic.js:162): the only business-day logic, weekends only
- (verify:8:db) supabase/ops-alerting.sql 169-363: ops_alert_state plus ops_health_plan/ops_health_mark, the real dedupe and re-alert pattern (the row cites the wrong file)
- (verify:8:db) supabase/notification-emails.sql 202-219: notify_enqueue_reports_ready AFTER INSERT/UPDATE OF status ON month_close, which fires on status -> 'done' and is the exact hook point for the 'period closed' event
- (verify:8:db) supabase/month-close.sql 25-60 and month_close_settings (late_day, stale_bank_days): inputs for the period_closed and overdue triggers
- (verify:8:db) supabase/functions/resend-webhook/index.ts 43-60: Svix HMAC verify(), reusable for Resend inbound
- (verify:8:db) supabase/usage-stats-2.sql 214: email_events table, outbound only, so inbound needs its own table
- (verify:8:db) supabase/client-users.sql: client_users(email PK, client_id), for exact sender-address matching
- (verify:8:db) supabase/client-emails.sql 209: client_email_recipients(client_id, email), the second exact-address source
- (verify:8:db) supabase/assigned-bookkeeper-email.sql: clients.assigned_bookkeeper_email, the assignee for email-created tasks
- (verify:8:db) supabase/staff-reminders-v2.sql 44-45: source/source_ref with no CHECK, so 'email' and 'automation' need no constraint change; source_ref can carry message_id
- (verify:8:db) components/staff/staffOpsLogic.js 162 OPS_rollWeekend plus staffOpsLogic.test.js: the only business-day logic, JS only, so overdue_bd needs a SQL counterpart (tk_business_days with tk_holidays)
- (verify:8:ui) notify_enqueue_reports_ready (supabase/notification-emails.sql 197-219): AFTER trigger on month_close when status becomes 'done'. It is the natural hook for the period_closed event.
- (verify:8:ui) notification_outbox and the notification-emails edge function with the 'outbox' and 'task_due' jobs (supabase/notification-emails.sql 224-252): the existing delivery path for a 'notify' action. task_due covers due today only.
- (verify:8:ui) ops_alert_state with ops_health_plan and ops_health_mark (supabase/ops-alerting.sql 169-365): the dedupe and alert-state pattern. 8.2 cites the wrong file for it.
- (verify:8:ui) verify() in resend-webhook (supabase/functions/resend-webhook/index.ts 43-58): Svix signature check that Resend inbound can reuse; move it to _shared.
- (verify:8:ui) email_events (supabase/usage-stats-2.sql 214-229): already receives every Resend webhook event type, deduped by a unique index.
- (verify:8:ui) client_users (email PK, client_id) and client_email_recipients (client_id, email): exact sender-to-client maps. They replace the nonexistent client_contacts.
- (verify:8:ui) clients.assigned_bookkeeper_email (supabase/assigned-bookkeeper-email.sql 34-48): who an email-created task is assigned to.
- (verify:8:ui) staff_time_off with staff_time_off_guard (supabase/staff-time-off.sql 71-105): source events for the staff_ooo trigger.
- (verify:8:ui) month_close_settings.late_day and stale_bank_days: firm thresholds that automations can read.
- (verify:8:ui) mgb.offboarding session flag in staff_reminders_before_write (supabase/staff-offboarding.sql 70-76, 221-239): the only bypass for staff_email, client_id and visibility pinning, and the model for an automation bypass flag.
- (verify:8:ui) team-reviews-sweep */5 cron with the tr_cron dispatcher (supabase/team-reviews-2-rpcs.sql 1005-1009) and digest_cron_tick (weekly-digest.sql 537): existing sweep-and-dispatch cron patterns, with unschedule-before-schedule guards.
- (verify:8:ui) onboarding_steps.auto_source in ('qbo','first_close') (supabase/client-onboarding.sql 34): an existing case of auto-completion driven by a system event.
- (verify:7:db) TB_Bell / TB_useBellItems (components/staff/TopBar.jsx 675-916): the existing in-app staff notification list. It already shows 'task:' items for tasks assigned to me, plus msg/doc/close/shout/tsug items. Seen state is in localStorage. It is the natural...
- (verify:7:db) ST_BELL_PREFS / ST_bellAllows and ST_STAFF_EMAIL_PREFS (components/settings/Settings.jsx 60-80, 328-334): per-user bell categories and email prefs stored in user_settings.settings.notify. New inbox kinds need keys here, and the edge function's PREF map...
- (verify:7:db) user_settings (supabase/user-settings.sql 55-107): JSON settings with own-row RLS, read with the service role by notification-emails through prefsFor()
- (verify:7:db) am_body_mentions + notify_enqueue_message mention/loop-in branch + client_message_loop_in (supabase/account-manager.sql 168-325): working @mention parsing and email delivery, using the payload-flag-on-existing-kind pattern
- (verify:7:db) notification_outbox_kind_check / client_email_log_feature_check re-declared in supabase/tech-inventory-v2.sql 52-61, the later and live definition
- (verify:7:db) review_notifications (supabase/team-reviews-1-schema.sql 241-255) with a unique dedupe_key: an existing per-recipient idempotency pattern better suited to a per-staff daily digest than digest_runs
- (verify:7:db) realtime.messages policies 'staff read realtime' / 'staff write realtime' (supabase/audit2-realtime-private-channels.sql 30-41): private-channel authorization is staff-wide, not per topic
- (verify:7:db) Guarded supabase_realtime publication add pattern (supabase/client-messages.sql 104-114, supabase/client-sops.sql 241-251)
- (verify:7:db) staff-reminders-<email> private realtime channels (app.jsx 24783-24840), where TK_sync is supposed to add new tables
- (verify:6:db) client_files.request_id FK to client_doc_requests and visibility 'request' (supabase/google-drive-files.sql 54-77): request uploads to Drive already exist
- (verify:6:db) drive-files upload path for visibility=request (supabase/functions/drive-files/index.ts 414-480), which calls fulfill_doc_request as the user; copy_legacy also reads client_doc_requests (index.ts 635-690)
- (verify:6:db) notify_enqueue_doc_upload trigger on client_doc_requests -> notification_outbox kind staff_doc_upload (supabase/notification-emails.sql 110-132)
- (verify:6:db) client-health doc_overdue signal on open client_doc_requests (supabase/client-health.sql 31, 166-170)
- (verify:6:db) client_doc_chase per-request chase state with FK cascade (supabase/client-emails.sql 126-137)
- (verify:6:db) client_email_log.request_ids uuid[] column, already per-request send tracking (supabase/client-emails.sql 142-157)
- (verify:6:db) client_email_prefs.chaser_paused / opt_out_doc_chaser per-client stop controls (supabase/client-emails.sql 74-100), toggled by DocChaser.jsx line 68
- (verify:6:db) client_email_recipients with hidden per-recipient token via column grants (supabase/client-emails.sql 209-231), a pattern for tokenized request links
- (verify:6:db) client_emails_cron(p_job) job whitelist (supabase/client-emails.sql 170-190)
- (verify:6:db) Latest client_email_log_feature_check definitions in supabase/notification-emails.sql 68-74 and supabase/tech-inventory-v2.sql 57-61
- (verify:6:db) staffToolsApi doc-request helpers (app.jsx 5340-5405) and the Messages > Requests sub-route (app.jsx ~27289, clientMessagesSub === 'requests')
- (verify:6:db) client-uploads storage bucket and client storage policies (staff-client-tools.sql 120+, client-messages-realtime.sql 33-55), where old request files still live
- (verify:6:db) my_client_scope view / client_users.tabs per-tab client access (supabase/client-scope-view.sql 54-70), which the needs page must respect
- (verify:6:db) can_use_client_tools(text) helper (supabase/pro-budget-reports.sql 36-47)
- (verify:9:db) supabase/tasks-notes-v3.sql:102-212 complete_staff_item: roll-forward inserts the next occurrence with assignee_email copied from the completed row
- (verify:9:db) staff_client_access_grants / end_client_access: the access grant tables the OOO move depends on for backup visibility
- (verify:9:db) audit_write (audit-log.sql): offboard_staff writes one summary audit row, and tk_apply_ooo / tk_return_ooo should too
- (verify:7:ui) supabase/functions/notification-emails/index.ts Kind/PREF (33-47), task_due job (194-235), grouping by kind|recipient|client (261-268), STALE_MS of 2 days drops old queued rows
- (verify:7:ui) supabase/tech-inventory-v2.sql (52-61): a second definition of notification_outbox_kind_check and client_email_log_feature_check
- (verify:7:ui) supabase/team-reviews-1-schema.sql review_notifications (241-255): a second outbox pattern with a dedupe_key unique column and queued/sent/failed/skipped status
- (verify:7:ui) supabase/weekly-digest.sql digest_cron_tick (490-537): an hourly, DST-aware send-at-local-hour tick with a 20-hour dedupe
- (verify:7:ui) supabase/audit2-realtime-private-channels.sql: private topics are authorized for any active staff (is_active_staff), not per topic
- (verify:6:ui) DocumentRequestsCard (app.jsx ~5706): staff create and client upload against doc requests, mounted on staff client overview (~6587) and client Documents (~20215). It must fold into TK_ClientNeeds and the staff drawer, not only CLIENT_RequestsPanel
- (verify:6:ui) StaffQuickActions 'request' modal (app.jsx ~7058-7111): a second doc-request creation path
- (verify:6:ui) staffToolsApi.docRequests/addDocRequest/setDocRequestStatus/uploadForRequest/signedUrl (app.jsx ~5354-5403)
- (verify:6:ui) clientNeeds 'Needs you' list on client Home, ClientNotifications bell (app.jsx ~5880) and CLIENT_TabBar documents badge, all fed by docRequestsList (app.jsx ~24793)
- (verify:6:ui) notify_enqueue_doc_upload trigger and the staff_doc_upload outbox kind (notification-emails.sql 115-135)
- (verify:6:ui) client_doc_chase.request_id FK with on delete cascade to client_doc_requests (client-emails.sql 127)
- (verify:6:ui) client-emails valueData() reads client_doc_requests uploaded/done for the monthly value report (index.ts ~350)
- (verify:6:ui) ClientTabCounts.jsx 151 and TopBar.jsx 754 (uploaded-docs feed) query client_doc_requests
- (verify:6:ui) client_email_recipients unsubscribe tokens and handleUnsub in client-emails, a public-token precedent
- (verify:6:ui) get_report_share(p_token) / ReportShareView (?share=) as a public-token precedent
- (verify:6:ui) DRV_useStorage / DRV_STORAGE_FALLBACK (components/files/DriveFiles.js 137-143): uploads go to Supabase storage when Drive is not connected
- (verify:6:ui) drive-files logic.test.mjs: the test file to extend for a month folder
- (verify:6:ui) components/client/DocFolders.jsx and supabase/document-folders.sql client folder UI
- (verify:9:ui) components/staff/Coverage.jsx: CV_OutTag, CV_useTimeOff store and CV_StaffSelect; the tag is already shown next to bookkeepers in app.jsx 7528-7542 and TeamPage.jsx 814. An 'N tasks covered' indicator belongs here.
- (verify:9:ui) supabase/task-templates.sql tt_client_bookkeeper and cron at line 297 (task-templates-daily): generation-time assignment ignores time off; this is where OOO-aware assignment to the backup would go.
- (verify:9:ui) supabase/staff-client-tools.sql line 33: client_profile.backup_bookkeeper_email, the only backup source.
- (verify:9:ui) staff_client_access_grants plus can_access_client(): the access gate that decides whether the backup can open the moved tasks' clients.
- (verify:12:ui) supabase/client-onboarding.sql: onboarding_steps and client_onboarding (the duplicate Asana onboarding projects merge into this; listed in the foundation decisions but not cited by any row)
- (verify:12:ui) supabase/functions/team-reviews/index.ts and supabase/functions/tech-inventory/index.ts: existing service-role edge function pattern (SUPABASE_SERVICE_ROLE_KEY, machine-auth check) that an import endpoint could follow
- (verify:12:ui) staff_reminders.staff_email (owner column) and the shared-needs-client CHECK, which constrain where imported rows can land
- (verify:12:ui) clients.assigned_bookkeeper jsonb (clients-roster.sql line 28): the free-text name, not an email, which complicates mapping a team to a bookkeeper
- (verify:10:ui) supabase/staff-celebrations-performance.sql: staff_performance already folds tasks, close, reply, health, hours and review signals into one score
- (verify:10:ui) components/staff/ClientClosePage.jsx: per-client close view sharing CT_saveMonthClose
- (verify:10:ui) components/staff/CloseChecks.jsx: per-cell advisory badges in CloseTracker
- (verify:10:ui) components/staff/HomeCards.jsx and ClientsPage.jsx: existing close/hours-budget summaries (CT_useCloseStatus, HB_useBudgets)
- (verify:10:ui) qbo_hours_by_staff / qbo_hours_by_client RPCs (supabase/qbo-firm-time.sql): the real actuals source for workload
- (verify:10:ui) components/staff/ClientTabCounts.jsx: awaiting-staff reply threads count
- (verify:11:db) staffItemsApi.notify() / STAFF_ITEMS_CHANGED_EVENT ('mgb:staff-items-changed'), the existing in-tab event bus. A same-tab bus already exists and TK_store should subscribe to it during the shim period.
- (verify:N:db) supabase/client-sops.sql 241-251: guarded supabase_realtime publication add-table pattern (checks the publication exists, then alter publication ... add table per table); reuse for every new tk_ table instead of ad hoc alters
- (verify:N:db) supabase/staff-admin-policies.sql 29: public.is_active_staff_admin(), the existing admin helper for tk_can_* instead of re-deriving admin
- (verify:N:db) supabase/audit2-qbo-state-hardening.sql 40-49 and ops-alerting.sql 540-545: DO-block guarded cron.unschedule pattern, an alternative to the select-from-cron.job form
- (verify:N:db) components/qbo/mapQboToClient.test.js and components/staff/teamReviewsLogic.test.js: additional existing test files that show the same plain-node style
- (verify:10:db) supabase/client-hours-for-bookkeepers.sql: hours visible to bookkeepers, relevant to the workload view
- (verify:10:db) supabase/client-scope-view.sql: the existing security_invoker view precedent
- (verify:11:ui) components/auth/AuthGate.jsx:33 redirectTo window.location.origin (staff Google sign-in returns to '/', dropping any /tasks path)
- (verify:N:ui) 23 component CSS files in components/*/ already linked in index.html (13 under components/staff)
- (critic) supabase/client-notes.sql: client_notes, a shared per-client staff notes table ('waiting on March bank statement'). It is distinct from client_private_notes and is cited by no row and no foundation decision. It overlaps directly with Waiting-on-client, handoff and comments, so it needs a keep-separate or fold decision (or confirmation that it is superseded).
- (critic) supabase/user-settings.sql:460 and supabase/audit-hardening-telemetry-and-rpcs.sql:161: security-definer access-request flows insert staff_reminders rows (one per staff_client_access row) with no source, no visibility and no assignee. The live before_write trigger then rewrites source to 'access_request' by matching text LIKE 'New access request from %' (staff-offboarding.sql:53-58). Any change to created_by stamping, status defaults or the text column (tk_tasks view, search_tsv) must keep this text-sniffing hook working, and the dedupe relies on it.
- (critic) staff-offboarding.sql:59-64: the live trigger keeps due_date and due_at in sync using UTC midnight. Business-day due rules (4.3), dependency shifts (2.8) and series edits (4.6) must write only one of the two, or the sync branch is skipped. No row mentions this.
- (critic) Staff chat (supabase/staff-chat-v2.sql staff_conversations/staff_conversation_members/staff_messages, useStaffTeamChat in app.jsx): only the attachment bucket is cited. There is no decision on 'make task from chat message', @mentions in chat versus tk_comments, or whether task comments should reuse chat's realtime and presence.
- (critic) client_messages (supabase/client-messages.sql) as a task source: no row covers 'Make task from client message' or linking a client thread to a task (the transaction_questions 'Make task' action is covered), even though client messages are the main way clients answer outside Ask-client.
- (critic) Team reviews (supabase/team-reviews-1-schema.sql, team-reviews-2-rpcs.sql, components/staff/TeamReviews*.jsx): cited as a pattern only. 10.6 'feeding quarterly reviews' has no named consumer (which survey or compare panel, which RPC), and the existing Today 'review' row kind collides with task review.
- (critic) supabase/staff-temp-admin-access.sql has_temp_admin_access: it gates the task-templates page (app.jsx 25422-25430). TK_Templates, TK_Rules and the import review must decide whether temp admins get them.
- (critic) supabase/clients-test-only-server-side.sql / clients-test-only-assigned.sql: test_only hiding is enforced on the server. tk_ views (tk_overdue_by_assignee, tk_period_progress, tk_review_stats) and the generator must apply the same exclusion. Only 4.4 mentions test_only.
- (critic) components/staff/Offboarding.jsx (UI over offboard_staff_preview): offboarding is cited only as a SQL pattern. Its preview UI must also show the new reviewer, follower and project-membership moves.
- (critic) components/staff/StaffGuide.jsx + staff_guide table + docs/staff-guide/*.md (my-tasks.md, task-templates.md, month-end-close.md, document-requests.md): help content that must be rewritten. docs/ is excluded from Vercel, so it must be republished to staff_guide, not just edited.
- (critic) components/tour/Tips.jsx + Tour.jsx (TIPS_ prefix): tips and tour steps that point at #/work/tasks and the 'my-tasks' slug.
- (critic) components/staff/ReplyTimes.jsx + supabase/client-reply-times.sql, HealthBoard.jsx, ClientHealth.jsx: dashboard neighbors that read task or overdue signals. 10.2 should reconcile with them.
- (critic) supabase/staff-shoutouts.sql / celebrations in staff-celebrations-performance.sql: completion-based celebrations may read done or completed_at. If so, the status sync and soft delete affect them.
- (critic) supabase/client-status-overrides.sql: per-client status override, a possible input to period 'na' or to client-health display. It is not cited.
- (critic) supabase/usage-events.sql / usage-stats-2.sql: telemetry. The new TK_ pages and the pop-out should emit page events the same way as the rest of the app (telemetry binding in audit2-telemetry-binding.sql).
- (critic) .claude/serve.js local preview server: it does not rewrite paths (README). /tasks, and any path-based pop-out, cannot be tested locally without changing it.

## B11. Coverage gaps and phase conflicts the critic found
The critic wrote these before the product owner's late answers; resolutions are noted inline in bold.

Missing or partly covered features:
- Scope 11: 'tasks. subdomain later' has no row or proposal. 11.1 covers /tasks only. A subdomain needs its own Supabase Auth redirect allow-list entries, separate localStorage (so no shared session with the portal, which breaks 11.2/11.4's same-origin assumption), a CSP connect-src review and a vercel.json host rule. Add at least a deferred note.
- Scope 1, 'each client has ... SOP': covered (1.3). But 'Internal projects (SOPs, Directors, Owners, 90 Day, onboarding)' is only partly covered. 1.4 does not say which onboarding (client_onboarding or staff_onboarding_steps), and no row seeds the five named internal projects or maps them to Asana's internal teams.
- Scope 2, 'subtasks': only partly covered. 2.3 adds parent_id but leaves the subtask UI unscheduled ('can follow once the drawer is stable'). The brief lists subtasks as a phase-1 drawer feature, so give it a phase.
- Scope 2, 'time tracking (one-tap timer)': the brief puts only rollups in phase 4. 2.10 puts the whole timer in phase 4, so the timer has no phase-1/2 slot. Either split it or record a deliberate deferral. **Still open; see A4.**
- Scope 3, 'Keyboard-first': 3.6 covers shortcuts, but no row covers keyboard operability of the Board (3.3 mentions a keyboard fallback only through the status menu), the drawer or the Calendar.
- Scope 4, 'generated N days ahead': lead_days exists. But no row sets the generation window for weekly items (default 14 days means 2 weekly rows at once), and nobody owns what happens to a generated task when its template is edited or deactivated before the period starts.
- Scope 4, 'period object (open / in review / closed)': 4.5 maps 'open' onto not_started and in_progress but says nothing about month_close's 'na' status, or how a closed period reopens (reopened_reason is added, but there is no reopen RPC and no rule that reopening resets done tasks).
- Scope 5, 'counts per bookkeeper': 5.2 gives a view but no UI home beyond the ReviewQueue header. The brief also lists them under dashboards (10.6), and the Performance page (staff_performance) is not wired in until phase 4.
- Scope 6, 'Client role (RLS: own org only)': 6.6 covers RLS. But no row says which client_users roles/tabs can see or answer requests (my_client_scope / client_users.tabs / can_use_client_tools). The brief's 'Client role' wording implies a role decision.
- Scope 6, 'files the upload in the client's Drive month folder': 6.5 adds a month level but does not say which month. It could be the task's period_start, the request date or the upload date. The period link is the obvious choice and should be stated.
- Scope 7, 'Inbox grouped by client': no row covers inbox items for internal-project tasks (client_id null). They need a 'Projects' or 'Internal' group.
- Scope 8, 'fire counts': covered. But the rule builder has no dry-run or preview and no per-rule enable audit. This matters because rules can reassign tasks or send email.
- Scope 9, 'and back again': 9.1 covers this. But the brief's prototype OOO banner (listed in reader findings as 'OOO banner') has no row.
- Scope 10, 'close tracker (clients x months)': the 10.1 deep link uses ?period=YYYY-MM in a hash route. The DeepLink grammar strips query strings, so this conflicts with LK_ and is unresolved.
- Scope 11, 'every client/task/view has a URL': project and client pages are covered. Saved-filter URLs (3.5) and the review/waiting presets are covered. Comment-level links (link to one comment) and client request links on the staff side are not.
- Scope 12, 'users by email, teams -> bookkeeper': there are 11 Asana users and 8 staff rows. No row decides whether the 3 unmatched Asana users become staff rows, are skipped, or are archived. 12.3's fixes raise the NOT NULL staff_email problem but give no decision.
- Scope 12, 'merge duplicate onboarding projects': 12.3 maps them into client_onboarding or tk_projects, but no one decides between those two targets.
- Phasing 1, 'unify existing task tables/components into one Tasks module': no row inventories every existing task-creating path that must keep working or be rerouted. These include access-request reminders (access-requests via audit-hardening-telemetry-and-rpcs.sql:161, user-settings.sql:460), DL_TaskButton, notes-to-task, StaffQuickActions, TT 'Save as template', TD_RemindersCard, MyTasksPage add, and generator rows. The missed-assets list names some, but no row owns the unification checklist.
- Phasing 2, 'Gate: Asana import + parallel run start here': no row defines the gate's entry criteria. 12.1 notes only 2 live clients, both test_only, so a real client roster must exist first. No row owns building it.
- Non-negotiable 'tests ... for the recurring-rule engine (business-day math) and status transitions': covered by N.3. But there is no runner (no package.json), and the 'SQL check script' has no harness. Only partly covered.
- Non-negotiable 'Nothing destructive to existing tables without a migration that preserves data': no row lists which migrations are non-additive. These are the drive_folders unique index swap (6.5), the month_close PK widening (4.5), the client_doc_requests fold (6.6), the staff_checklist_presets fold, the client_close_items fold, the cadence CHECK widening (4.2) and the shared_needs_client CHECK replacement (1.4). Each needs a data-preserving note and a rollback.
- Open question 3, 'Can bookkeepers read other bookkeepers' clients for coverage?': no row or foundation decision owns it. It directly decides whether 9.1 reassignment needs grant_coverage_access, whether 3.2's per-person list is admin-only, and whether a reviewer needs staff_client_access. **Answered by D3: assigned clients by default, grants when needed.**
- Open question 2, 'Business-day vs calendar-day defaults for monthly items': 4.3 adds rule types but never says what the default rule for a new monthly item is, or what the backfill of existing due_offset_days means. **Answered by D2: calendar-day default, business-day rule opt-in.**
- Open question 4, 'Which Asana integrations are in use today (forms, email-to-task, Drive)?': 8.3 calls the inbound provider an open question. No row covers replacing Asana forms (if they are in use) or Asana's Drive attachments during import (12.3 imports no attachments). **Mostly answered by D4: few or no add-ons; confirm with staff.**

Contradictions inside the table (resolved as stated in Part A and B3/B4 unless noted):
- Reviewer storage: 1.1 puts reviewer_email on clients. The 5.1 ui fix says to add client_profile.reviewer_email, and the 9.1 fixes treat the reviewer as absent from client_profile. Pick one (clients, per 1.1, since the RLS/FK pattern lives there) and rewrite 5.1 and 9.1 to match.
- Firm default reviewer: 1.1 says 'a firm default reviewer setting (an owner)' with no home. The fixes say month_close_settings.default_reviewer_email, and 5.1 ui says to fall back to 'the active admin'. Choose one fallback.
- created_by stamping: 2.1 and the foundation trigger decision say 'force created_by from the JWT on insert'. 4.4 (no-JWT generator), 8.1/8.3 (automation and service role), the access-request definer inserts and complete_staff_item (which carries the original created_by forward) all need otherwise. The 2.1 fix's conditional rule should replace the foundation wording.
- source_ref on roll-forward: the foundation complete_staff_item decision and 2.3/4.6 say null the next occurrence's source_ref. The 4.6 db fix shows source='note' and source='deadline' depend on source_ref, so null it only for source='template'. The foundation text is wrong as written.
- Client-only template items: 4.1 and the foundation task_templates decision add task_templates.client_id. The 4.1/12.2 fixes show the existing generator treats empty client_ids as every client, and that client_ids = array[id] already expresses client-only. 12.2 also writes drafts as 'client-only rows'. Pick client_ids, or a CHECK tying the two together.
- staff_checklist_presets: the foundation folds them into firm-standard sop_steps (and 4.7 agrees). The 4.7 fixes show the presets are personal (owner_email RLS, unique per owner), so folding them would publish private lists firm-wide.
- client_documents rationale: 2.5 evidence and the foundation client_documents decision say its staff policy lacks can_access_client. audit-hardening-client-scoping.sql:73-76 replaced it with can_access_client(client_id). The decision to keep it separate stands, but for a different reason (it is client-readable and stores drive_url only).
- Task deep-link grammar: 2.13, 11.5 and 3.5 invent #/tasks/t/<id> and #/tasks/v/<id>. The existing LK_ grammar in DeepLink.jsx (#/<place>[/<tab>]?item=task:<id>, with 'task' and 'view' kinds already defined) is the convention, and the 10.1 ?period= param collides with LK query stripping.
- Client page route: 6.2 picks top-level #/needs, but client pages are #/client/<id>/<page> through CLIENT_PLACES (parseHashRoute treats top-level slugs as staff places).
- Realtime topology: 7.1 uses a private topic tk-inbox-<email>. 11.4 says 'one Supabase channel per user'. The foundation says to extend staff-reminders-<email>, and the 11.4 fix says one channel per table family. Also, realtime.messages policies are staff-wide, so topic names isolate nothing. Choose one design.
- Digest idempotency: 7.3 says 'reuse digest_runs keyed (staff_email, run_date)', but digest_runs has no staff_email and no unique key. The foundation digest decision repeats this.
- client_contacts: 1.2 creates it in phase 2. 6.1 (phase 2) and 8.3 (phase 3) use it. The 6.1/8.3 fixes say 'drop client_contacts, no such table exists', and the 1.2 fixes say client_email_recipients is not a contact source although 1.2's proposal uses it as one. Either commit to client_contacts in phase 2 with 6.1 as its consumer, or remove it everywhere.
- Status sync vs review gate: 2.2 says the BEFORE trigger keeps done in sync with status both ways. 5.1 says the gate blocks done unless mgb.tk_approve is set. A legacy write of done=true (toggleDone, complete_staff_item, _toggleDoneClientSide) would map to status=done and either be blocked (breaking Today's checkbox) or bypass the gate. 2.2 must say legacy done=true on a review_required task maps to ready_for_review.
- Overdue definition: 3.1 says Overdue excludes waiting_client and uses the business week for This week. Today.jsx uses a rolling 7 days (TD_SOON_DAYS). 10.2 defines its own exclusion, and staff_performance, client_health, TB_TasksBadge and the task_due email have yet another definition. The foundation says Today reads TK logic, but no row makes groupMyTasks the single definition.
- Status labels: 10.2 is marked missing but verified as contested. TP_aggregate/TeamPage already compute overdue per person (extend). N.2 is marked exists but verified as contested (extend: no tk_can_* helper, unguarded cron). 11.5's 'what exists' omits DeepLink.jsx. The table still carries the pre-verification statuses.
- Notification behavior for generated tasks: 4.4 says generated tasks feed the digest rather than instant emails, and the foundation notify_enqueue_task_assigned decision says route them through tk_inbox_items. But the digest (7.3) is phase 3 and tk_inbox_items (7.1) is phase 3, while generation ships in phase 2. Also, admin 'Generate now' currently emails once per task.
- Followers: 2.6 auto-adds the reviewer and mentioned staff as followers, and tk_can_read_task includes followers. 1.4 says private Owners/Directors work is protected by project membership. A mention of a non-member would make them a follower and grant them read access to a private project task.
- OOO fallback: 9.1 falls back to the reviewer, but 1.1 leaves the reviewer null until the product owner answers. In phase 2 the fallback has no data.
- Attachments: 2.5 sends client-task files through drive-files with visibility 'internal'. README says DRV_STORAGE_FALLBACK is false and Drive returns 503 when not connected, so the 2.5/6.5 'storage fallback' paths in the fixes do not exist for new uploads.

Phase conflicts:
- 2.4 comments, 2.5 attachments, 2.6 followers, 2.7 activity log and 2.13 server search are all phase 1. The brief's phase 1 is 'My Tasks, List, roles, task drawer, pop-out shell'. They can be argued as part of the drawer, but together they make phase 1 several times larger than the brief implies. 2.13 server search and 2.5 attachments could move to phase 2 or 3 without hurting the drawer. **Overruled by D9: both stay in phase 1.**
- 7.2 (immediate mentions and send-backs) is phase 2, while the brief puts Inbox in phase 3. The deviation is justified because the review loop needs it, but it should be stated as a brief change for the product owner. And 2.4 (phase 1) already enqueues staff_task_mention, which then needs 7.2's CHECK widening in phase 1, not phase 2.
- 10.4 review queue and 10.5 waiting list are phase 2, but the brief puts dashboards in phase 3. This is a justified pull-forward, but say so explicitly.
- 9.1 OOO is phase 2 (manual) or phase 3 (automatic). The brief does not phase OOO, but its automatic half depends on 8.1's staff_ooo trigger (phase 3). Consistent, but the phase-2 manual button depends on the tk_can_read_task assignee policy (phase 1) and the reviewer fallback (unresolved).
- 4.4 says generated tasks feed the daily digest, but the digest (7.3) and tk_inbox_items (7.1) are phase 3 while generation is phase 2. Generated tasks either get no notice in phase 2, or the inbox table must move to phase 2.
- 2.10: the brief's phase 4 says 'time tracking rollups', but the row puts the one-tap timer itself in phase 4 too. The brief does not phase the timer, so either decide phase 1-3 or note the deferral.
- N.3 is phase 1, but its main subject (business-day and recurrence tests) belongs to 4.3 in phase 2. Phase 1 can only test status transitions, grouping and the parser.
- 12.1-12.4 are phase 2 as the brief gates. But 12.1 notes that no real client roster exists (2 test clients), and 12.2 depends on 4.1/4.2/4.3 shipping first. The parallel run 'through the November close' means phase 2 must be live by early November. No row checks that timeline against phase 1's size.
- 11.3 PWA is phase 3. The brief mentions it in standalone scope without a phase; acceptable, but the 11.2 pop-out (phase 1) and the manifest launch_handler navigate-existing will interact before 11.3 is tested.
- 3.4 Calendar (phase 3) shades tk_holidays, which 4.3 creates in phase 2. Fine, but 2.8 (phase 4) and 6.4 (phase 2) also need tk_add_business_days. Make 4.3's SQL helpers the first phase-2 migration.

## B12. Analyst disagreements and how they were resolved
- D1. 2.1 assignee: spec-skeptic said owner and assignee are the same column. staff-reminders-v2.sql:42 and :81 show assignee_email exists and is backfilled. The real gaps are the assignee RLS policy and trigger pinning (database-first).
- D2. 2.2 done compatibility: spec-skeptic wanted done to become a generated column. I chose trigger sync both ways (database-first, UI-first), because complete_staff_item and toggleDone write done directly. The status values are the descriptive set (todo, in_progress, waiting_client, ready_for_review, done), and the prototype's short names are UI labels only.
- D3. 2.13 search: UI-first said Cmd-K has no task results. TopBar.jsx:504-506 shows a Tasks group exists. The gap is deep links and server-side search.
- D4. 3.4 calendar: UI-first said Deadlines is list-only. Deadlines.jsx:294-345 (DL_MonthView) is a reusable month grid.
- D5. 4.4 lead time: spec-skeptic said there is no per-template lead time. task-templates.sql:62 and :225 show lead_days already drives generation.
- D6. 4.7 status: spec-skeptic marked it missing. The checklist copy on generation exists (task-templates.sql:262-266), so it is extend.
- D7. 11.3 service worker: spec-skeptic said one exists. A repo-wide grep finds no serviceWorker registration.
- D8. 1.1 reviewer location: clients.reviewer_email (database-first, UI-first) over client_profile (spec-skeptic). The backup stays on client_profile for phase 1 (UI-first) rather than being mirrored onto clients (database-first). account_manager is not the reviewer (spec-skeptic).
- D9. 1.4 projects: client tasks keep client_id with no per-client project row (database-first), instead of a lazily created or implicit project per client (UI-first, spec-skeptic), to avoid syncing two client lists.
- D10. 4.1 template model: task_templates stays one row per item, with client_id for client-only items plus a thin overrides table, so the task_template_issued FK and ledger keep working. This rejects UI-first's new tk_template_items and database-first's separate client_only rows outside task_templates.
- D11. 4.2 and per-item recurrence: kept for ad-hoc work (database-first, UI-first), not retired into one-item templates (spec-skeptic). The collision bug is fixed instead.
- D12. 4.5 periods: all three extend month_close. I rejected spec-skeptic's rename, database-first's 'week' period_kind (it conflicts with the first-of-month CHECK and the PK), and UI-first's period_id (month_close has no id). Tasks use a composite (client_id, period_start) FK. Quarter and year periods need a PK change gated on the product owner's answer.
- D13. 4.6 series key: template_id plus client_id for generated series, and series_id for ad-hoc ones. Database-first's series_id = template id would span every client.
- D14. Time tracking (2.10): extend the dormant time_entries table (database-first, spec-skeptic), not staff_app_time (UI-first). Status is extend, not missing.
- D15. Tags (2.9): text[] plus a tk_tags catalog (spec-skeptic hybrid), over join tables (database-first) or text[] only (UI-first).
- D16. Phase placements resolved: followers (2.6) and attachments (2.5) in phase 1, not phase 3 or 2. Immediate mention and send-back delivery (7.2) in phase 2, not phase 3. The review queue (10.4) and a minimal waiting-on-client list (10.5) in phase 2. Manual OOO reassignment (9.1) in phase 2, with automation in phase 3. Keyboard shortcuts (3.6), pop-out (11.2) and BroadcastChannel (11.4) in phase 1. The SOP link (1.3) is phase 1, with structured steps in phase 2.
- D17. 6.3 no-login access: the magic-link deep link is the phase-2 baseline (UI-first). Tokenized responses for contacts without an account (database-first, spec-skeptic) are built only if the product owner approves.
- D18. Status calls where I overrode the majority or a single analyst: 3.6 missing (task shortcuts do not exist), 7.1 missing (StaffInbox stays separate and TK_Inbox is new), 7.3 extend (the daily notification-task-due email already exists), 10.2 missing (no overdue aggregate), 6.3, 6.5, 9.1 and 10.5 extend (working machinery exists to build on).
- D19. Foundation conflicts: staff_checklist_presets folds into firm-standard sop_steps (not task_templates, and not kept as a foundation). task_template_suggestions stays separate, and Asana drafts become draft task_templates rows confirmed by the client's bookkeeper. The doc chaser is extended and repointed, not retired. client_doc_requests folds into client_requests. client onboarding stays separate and is linked from an onboarding project. complete_staff_item stays as a wrapper behind tk_set_status. **Corrected after verification: the presets are personal (owner_email RLS) and stay separate; promotion into firm sop_steps is by the owner's choice (B3, 4.7 fixes).**
- D20. Brief versus repo terms (spec-skeptic): brief 'tasks' = staff_reminders or 'staff items'; 'period' = month_close; 'Ask-Client request' covers today's doc requests (folded in) and sits beside transaction questions (kept separate).

## B13. Open questions as the analysts phrased them
Settled on 2026-10-10: Q1 (any admin, the Account Manager default), Q2 (calendar days; holiday calendar still to pick if the business-day rule is used), Q3 (no by default; access to another bookkeeper's clients is granted when needed, and the product owner may widen it later), Q4 (few or none; confirm), Q11 (import all, hide after 12 months). Still open: the rest, summarised in A4.

- Q1. Reviewer model: is one owner the only reviewer (staff.can_review for her only, firm default), or does each client get clients.reviewer_email, with senior bookkeepers allowed to review each other? This decides whether reviewer_email lives on clients, on templates, or both.
- Q2. Business-day or calendar-day default for monthly close items and nudges, and which holiday calendar: US federal only, or also bank holidays (Columbus Day, Veterans Day) and firm-closed days such as Good Friday?
- Q3. Can bookkeepers read other bookkeepers' clients and tasks for coverage without an active staff_time_off grant? Today can_access_client restricts this, and search, the inbox and dashboards depend on the answer.
- Q4. Which Asana features are in use today (forms, email-to-task, Rules, Drive attachments)? The API cannot see Rules or forms, so automations we do not know about cannot be recreated.
- Q5. Should backup_bookkeeper_email move from client_profile to clients as a single source, or stay on client_profile with reviewer_email added on clients?
- Q6. Out of office: should only tasks due within the time-off window move, or all open tasks? Should tasks in ready_for_review stay with the original bookkeeper?
- Q7. Do quarterly and annual work (990 prep, year-end giving statements) need period sign-off, which requires widening the month_close PK, or only the monthly close?
- Q8. Does closing a period need every task Done, or only the reviewer's sign-off?
- Q9. Ask-client recipients: may a church contact with no portal login (treasurer, pastor) answer through a token link, or must every responder have a client_users row and sign in by magic link? This decides whether tk_request_tokens and client_contacts are built in phase 2.
- Q10. Should client uploads land in a new Drive month folder level (Client/Year/MM Month), or in the existing doc-type folders?
- Q11. Should 12 months of Asana completed history be imported as full tasks (about 8-10k rows) or as a lighter archive table, given it only feeds on-time history and quarterly reviews?
- Q12. Which duplicate onboarding projects (Collective x2, Golden City x2) win in the merge?
- Q13. Should the on-time rate exclude time spent waiting on the client, and does a send-back count against on-time if final approval is still before the due date?
- Q14. Which inbound email provider handles a firm tasks@ inbox (Resend inbound, Postmark, or Google Workspace forwarding), and is the Resend sending domain verified yet?
- Q15. Should /tasks become the main staff entry point (replacing #/work/tasks), or a secondary shell?
- Q16. Should the PWA install gate (INSTALL_APP_PUBLIC) open for staff when the Tasks shell ships?

## B14. Method
Workflow `wf_2703c4e1-23f`: 13 readers (repo SQL, UI, conventions, prototype, README, live DB, Asana), 3 analysts with different lenses (database-first, UI-first, spec-skeptic), one merge, 26 adversarial verifiers (two per area: database and UI; 17 ran on Opus/high, 9 reruns on Sonnet/medium after a usage-limit crash), one completeness critic (Opus/medium). 132 verdicts, 129 agree, 3 corrected. About 1.0M subagent tokens. The spec cross-check (contradictions C1 to C12, spec-only items S1 to S43) was done by the main session after reading the Claude Docs spec in full. All work was read-only against the repo, Supabase and Asana.
