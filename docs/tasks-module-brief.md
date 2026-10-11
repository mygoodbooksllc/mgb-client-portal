# Tasks module — build brief for Claude Code

Goal: replace Asana for MyGoodBooks staff with a Tasks module inside this portal that is
more capable than Asana for bookkeeping work, runs embedded in the staff portal **and** as
its own popped-out window, and includes a client-facing "What we need from you" page.

Full spec (read first): Claude doc "MGB Portal — Tasks Module Spec"
(https://claude.ai/code/artifact/5f33f084-ef1a-4e3a-89ed-36f755893d55).
Interactive prototype: Claude Design "MGB Tasks Prototype"
(https://claude.ai/artifact/LFy7S6i5w7292gmQ2moYWs); its source is `docs/tasks-prototype.dc.html`.
Use the prototype for layout, copy and interaction, and the MyGoodBooks design tokens in
`styles.css` (not the hex values baked into the prototype).

## Step 0 — audit before building (do this first, report back, then stop)

This repo already has partial versions of most of this. Do not duplicate them. Read:

- SQL: `supabase/staff-schema.sql`, `tasks-notes-v3.sql`, `task-templates.sql`,
  `month-close.sql`, `staff-reminders.sql`, `admin-read-all-tasks.sql`,
  `transaction-questions.sql`, `client-documents.sql`, `document-folders.sql`
- UI: `components/staff/Today.jsx`, `WorkPage.jsx`, `TaskChecklist.jsx`, `TaskTemplates.jsx`,
  `CloseTracker.jsx`, `DocChaser.jsx`, `Deadlines.jsx`, `Coverage.jsx`, `TeamCapacity.jsx`,
  `HoursBudget.jsx`, `AppTimeTracker.js`, `components/inbox/StaffInbox.jsx`,
  `components/client/TxnQuestions.jsx`, `DocFolders.jsx`, and the task-related parts of `app.jsx`
- Conventions: `README.md` (load order, name prefixes, `window.__SOURCE_ORDER`, no bundler,
  Babel in browser, `window.mgbSupabase`, roster, toasts, realtime, tests)

Produce a gap table: for each spec feature, (a) exists as-is, (b) exists but needs extending,
(c) missing. Propose which existing tables/components become the Tasks module's foundation and
which get retired or folded in. Wait for approval before writing code.

## Scope (from the spec)

1. Clients as first-class: each client has bookkeeper, backup, reviewer, QBO link, Drive folder,
   contacts, SOP. Internal projects (SOPs, Directors, Owners, 90 Day, onboarding) too.
2. Tasks: title, description, assignee, due/start, section, priority, status
   (To do → In progress → Waiting on client → Ready for review → Done), subtasks/checklist,
   comments with @mentions, attachments, followers, activity log, blocked-by dependencies that
   shift due dates, tags, time tracking (one-tap timer), quick add, bulk edit, global search.
3. Views: My Tasks (Overdue / This week / Waiting on clients / Later), List, Board, Calendar,
   saved filters. Keyboard-first.
4. Recurring engine: per-client template built on "MGB Standard Monthly Close" + client items;
   cadence weekly/monthly/quarterly/annual; due rules incl. business-day N; generated N days
   ahead by a scheduled function; period object (open / in review / closed) with sign-off;
   bulk-edit a series; SOP attached to each item, steps become the task checklist.
5. Review loop: Ready for review → Approve / Send back (with reason); counts per bookkeeper.
6. Ask-Client queue (full build, decided Oct 10 2026): "Ask client" on any task pauses it;
   request appears on the client's **What we need from you** page in the Client Portal with
   upload/reply; email with magic link for clients who don't log in; nudges every 3 business
   days; answering resumes the task and files the upload in the client's Drive month folder.
   New `client_requests` table + Client role (RLS: own org only).
7. Inbox: grouped by client; mentions and send-backs immediate; rest in daily digest; mute per
   client.
8. Automations: rule builder with bookkeeping triggers (overdue N business days, period closed,
   sent back twice, bookkeeper out of office, email received at tasks@) and fire counts.
   Email-to-task from `tasks@mygoodbooks.org`, client picked by sender domain.
9. Out of office: reassign due tasks to backup and back again.
10. Dashboards: close tracker (clients × months), overdue by bookkeeper, workload vs capacity
    (hours), review queue, waiting-on-client, on-time rate feeding quarterly reviews.
11. Standalone + embedded: same app at `/tasks` (and `tasks.` subdomain later); "Open in own
    window" uses `window.open` sized popup with a slim top-bar shell; "Dock in portal" returns;
    PWA installable (manifest already exists, currently gated); Supabase Realtime +
    `BroadcastChannel` keep windows in sync; every client/task/view has a URL.
12. Asana import: users by email, teams → bookkeeper, projects → clients, sections → cadence,
    recurring tasks → draft templates for bookkeeper confirmation, 12 months of completed
    history; merge duplicate onboarding projects; parallel run through the November close.

## Phasing

1. Foundation: unify existing task tables/components into one Tasks module; My Tasks, List,
   roles, task drawer, pop-out shell.
2. Recurring + review + Ask-Client (staff and client pages, email links). Gate: Asana import +
   parallel run start here.
3. Board, Calendar, saved filters, Inbox, Automations, dashboards, digest.
4. Dependencies, tags, bulk edit, time tracking rollups, quarterly-review feed.

## Non-negotiables

- Follow README conventions exactly: no bundler, one name prefix per new file (suggest `TK_`),
  register in `window.__SOURCE_ORDER`, CSS per component, RLS on every new table, tests in the
  existing `*.test.js` style for the recurring-rule engine (business-day math) and status
  transitions.
- Nothing destructive to existing tables without a migration that preserves data.
- Every screen works at phone width.
- Bump `window.MGB_VERSION`.

## Open questions to settle with Holden before Phase 2

- Is Bailley the only reviewer, or can senior bookkeepers review each other?
- Business-day vs calendar-day defaults for monthly items.
- Can bookkeepers read other bookkeepers' clients for coverage?
- Which Asana integrations are in use today (forms, email-to-task, Drive)?
