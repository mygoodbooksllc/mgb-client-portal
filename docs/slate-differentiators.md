# Slate: where it can win

Written 2026-10-18 against HEAD `065edfc`. A competitive brainstorm, not a build spec. The
owner asked for it to be folded into the task module build **without changing anything that
is already built or specced**.

Full write-up with sources: https://claude.ai/artifact/TS3fpfXacNpXUB85cD6TAb (private artifact,
owner's account).

## How to fold this in

- Treat every item below as additive input. Do not rename, re-scope or reorder anything in
  Phases 1 to 4, Desk D1 to D3, `docs/desk-spec.md`, `docs/desk-right-spec.md`, or any
  `TK_` / `tk_` / `wb_` name, route or table.
- Nothing here replaces Slate's list, drawer, review queue, templates or Ask client. Each idea
  names the existing piece it builds on so it can be checked against the code.
- Suggested placement: a "Where Slate can win" section or appendix in the current spec, or a
  roadmap row per idea where one maps cleanly to an existing phase.
- The three open questions at the end are for the owner, not for the spec to decide.

## What the research found

Ten tools: Asana, ClickUp, Monday, Notion, Trello / Basecamp / Planner, Todoist, Motion /
Sunsama, Karbon, TaxDome, Financial Cents. Sources were G2, Capterra, Trustpilot, vendor forums
and pricing reviews. No source surveyed bookkeepers specifically, so staff interviews outrank
everything here.

Wishes that repeat across almost every product:

1. **"Tell me what's actually done."** A ticked box is a claim, not proof.
2. **Stop me chasing clients for documents.** Firm owners rank it the second-hardest part of
   running a team; requests sit in email, phone and portals at once.
3. **Only ping me when it matters.** Asana users get a notification every time a teammate
   completes anything.
4. **Don't make me build the system.** Setup burden in Notion, ClickUp, Karbon and TaxDome.
   "A simple task list" is a top missing feature in Karbon reviews.
5. **Warn me before I overbook.** Nothing adds up the hours.
6. **Work should wait until it can start.** No dependencies; recurring work fires on a date,
   not on readiness.
7. **Make the portal easy for the client.** One TaxDome firm said clunky client sign-in
   "outweighs literally everything else".
8. **AI that's specific and asks first.** ClickUp Brain is called generic; Motion reshuffles
   the day silently and users can't tell why.

Financial Cents reviewers specifically note few templates for nonprofits, which is our niche.

## Our unfair advantages

The books (QuickBooks sync, `close_checks`, `qbo_account_status`), the client (already signs
in to the portal), the hours (QuickBooks Time per client, `monthly_hours_budget`), and the
niche (churches and nonprofits).

## Ideas, ranked

### Tier A: only possible because books, client and tasks share one portal

1. **Tasks that check themselves.** A close task such as "Reconcile operating account" shows
   "QuickBooks agrees" when `qbo_account_status` / `close_checks` confirm every transaction
   through month-end is cleared, and turns amber if new uncategorized activity lands after it
   was ticked. Builds on `supabase/qbo-close-checks.sql`. New: link a task or template step to
   a check; show agreement on the row.
2. **One "What we need from you" list per client** on the client dashboard. Every Ask client
   request lands there; each item says exactly what is needed, accepts a phone photo, and
   resolves the staff task on upload; reminders escalate on their own. Builds on Ask client
   (Phase 2 S5), client documents, client emails. New: client-side checklist,
   upload-to-resolve, reminder cadence.
3. **Work that starts when its inputs arrive.** Template steps get a "starts when" trigger
   (statement uploaded, or QuickBooks activity past month-end) instead of only a fixed date.
   Until then the task sits in "Waiting on bank" and never turns red. Builds on
   `TK_recurrenceLogic.js`, the business calendar, templates (S4).
4. **Tasks that carry their evidence.** A task created from a GL review flag, an
   uncategorized transaction or a client message keeps a typed link to it. An AI draft of the
   client question is grounded in those exact transactions; a person edits and sends. Builds
   on GL review, `client_messages`, Drive files. New: typed links on tasks; draft helper.
5. **Close progress the client can check.** "October books: 7 of 10 steps done, waiting on 1
   item from you." Outcomes only, never the internal task list. Builds on the client dashboard
   and close tracker.

### Tier B: better because we are narrow

6. **Nonprofit calendar out of the box.** Client-type template packs (Established church,
   Church plant, Food pantry): board meeting date drives packet deadlines, giving statements by
   January 31, the 990 off fiscal year end, quarterly 941s, housing allowance resolution.
   Builds on templates, `firm_deadlines`, client entity type. New: packs by type; board date
   on the client profile.
7. **Capacity before overbooking.** A rough size per task (15 min, 1 h, half day) totaled per
   week against QuickBooks Time hours and the client's `monthly_hours_budget`, with a warning
   at assign time. Suggest only; never auto-reshuffle. Builds on
   `supabase/client-hours-budget.sql`, `supabase/qbo-firm-time.sql`. New: size field, weekly
   totals, warning.
8. **Treasurer turnover.** Requests addressed to a role ("Treasurer") rather than a person, so
   open requests and reminders move to the new volunteer when the contact changes. Builds on
   client contacts (S6).

### Tier C: table stakes competitors get wrong

9. **Quiet by default.** Bell only for assigned, @mention, client replied, review requested.
   Everything else in a daily digest. No pings for teammates completing tasks.
10. **Weekly reset instead of a red pile.** A guided pass over anything overdue more than 7
    days: do this week, move, hand off, ask client, or drop with a reason. Builds on the bulk
    bar (P4-3) and coverage hand-off (S7).
11. **One lead, many helpers.** One accountable assignee plus helpers who see the task on their
    own lists. Builds on followers.
12. **Fast, simple, exportable.** List-first, keyboard speed, no per-seat pricing, full export
    of tasks, comments and files at any time.

## Guardrails

- No feature parity with ClickUp (Gantt, whiteboards, docs).
- Custom fields only within bounds. Owner decision 2026-10-28: build custom fields on tasks,
  bounded (at most 15 active per project or client list, six types, 20 options per dropdown,
  archive instead of delete). Still no open-ended database: the fixed shape for nonprofit
  bookkeeping stays the base. Spec `docs/slateplus-customfields-spec.md` (hidden preview).
- AI drafts and suggests; a person approves.
- Don't go general-purpose.

## Suggested order

1 → 2 + 8 → 3 + 6 → 9 + 10 → the rest as staff ask. Test the top three with two or three
bookkeepers and one volunteer treasurer before building.

## Open questions for the owner

- Is a task-size estimate acceptable to staff?
- Should the client checklist show every open request, or only the current month's?
- Does "QuickBooks agrees" live on the task row, in the drawer, or both?
