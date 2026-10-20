# Slate: month rhythm build plan (fold-in)

Written 2026-10-20. Ties together `docs/slate-month-rhythm.md`, `docs/slate-differentiators.md`
and `docs/email-drafts-spec.md` / `docs/email-drafts-README.md`. Additive only: nothing built or
specced is renamed, re-scoped or reordered. Owner approved the build on 2026-10-20.

## Owner rules added 2026-10-20

1. **Waiting on a client never counts against a bookkeeper.** A task in "Waiting on client"
   status, or on a client whose month is Preliminary, is excluded from late counts, on-time
   stats and the performance score. Missed dates while waiting are not misses.
2. **Group by and Sort come first**, so the eight tasks per client land in a list that is easy to
   manage (see slice 0).

## Slices, in order

| # | Slice | Maps to | Notes |
| --- | --- | --- | --- |
| 0 | **Group by / Sort / saved view** | Phase 1 list (`TK_viewLogic.js`, `TK_SORT_COLS`, `TK_groupBySection`) | Group by client, rhythm part, due, status. Sort chips. Quick chips "Mine today" and "Waiting on client". Saved view per person (`mgb_tk_` key). Bulk bar works in any grouping. Same control on the Desk Slate tab. |
| 1 | `tk_settings` key `month_rhythm` and its admin editor | Phase 2 S3 settings | As in `slate-month-rhythm.md`. |
| 2 | `firm_part` due rule, JS and SQL with shared fixtures | Phase 2 recurrence | Existing rule types must keep passing unchanged. Add vectors to both fixtures and run both. |
| 3 | Seed the eight monthly templates, **and add `task_templates.email_kind` in the same migration** | Phase 2 S4 templates | `email_kind` is set on rows 2, 6 and 7 only (see "Email drafts"). Behind the firm switch, so no bookkeeper gets eight new tasks per client until the owner flips it. |
| 4 | `tk_report_state`, Preliminary badge, 24th auto-complete, two-months-running notice, waiting-on-client exclusion from late stats | Phase 2 S5 (Ask client) and the performance score | The late-count exclusion (rule 1) lands here. |
| 5 | Client rhythm override | `client_profile` | Resolver: client, then firm, then fail closed. |
| E1 | Email builder `TK_emailDraft.js` plus tests | New, pure | Can start any time after slice 2, because it needs the resolved rhythm. |
| E2 | Generate email button, hover preview, editor, Copy | Task drawer and row | Needs slice 3. |
| 6 | Option B close-order view | View on slice 0 grouping | Uses the same grouping engine, not a second list. |
| 7 | Option C pre-fill by client type | Templates | Last. |

## Email drafts: where they fit and what changes

The email handoff was written for three templates (4th, 14th, 24th). The month rhythm has eight
rows. Keep the rhythm's row titles (the owner called them final) and attach email drafts to
three of them:

| Rhythm row | `email_kind` | Email |
| --- | --- | --- |
| 2. Ask for missing documents | `request` | Email 1, statement and clarification request |
| 6. Send reports (full or preliminary) | `reports` | Email 2, financial reports delivery |
| 7. Follow up on missing documents | `maintenance` | Email 3 (see open question 1) |

Changes to the email handoff, all additive:

1. **Do not create its own three templates** (README step 1b). The eight-row seed (slice 3) is
   the only source. The handoff's three template titles are not used.
2. **Client-facing dates come from the resolved rhythm.** The doc's 5th, 15th and 25th are
   hard-coded today. Derive them from the part day plus one (client override first, then the
   firm setting), so a client with their own rhythm gets correct dates. Internal task dates
   stay as the rhythm sets them.
3. **Email 2 follows the report state.** Choosing Full or Preliminary on row 6 (slice 4)
   selects Option A or B in the draft. `close_checks` only suggests the default. The pending
   items list is the same list stored in `tk_report_state.missing` (open Ask client
   requests), so the email and the client's Preliminary badge never disagree.
4. **"Today's emails" list (README step 5) becomes a quick chip** ("Emails due") on slice 0's
   list and a saved view, not a separate list. Same hover preview and Copy on those rows.
5. **Not behind its own preview flag**, as the handoff says, but it only shows on tasks with an
   `email_kind`, which only exist once slice 3 is switched on, so it stays hidden until then.
6. **Check for a parallel build first.** The handoff mentions a build on the night of
   2026-10-20. Before starting E1, check `origin/main` for `TK_emailDraft.js` and
   `task_templates.email_kind`; if they exist, rebase the plan on them instead of rebuilding.
7. Handoff step 1a (can a bookkeeper read `qbo_transactions` from the browser) is still the
   first check of E1.

## Storage proposals (not built)

- `tk_report_state` (client_id, period, state `none|preliminary|full`, missing jsonb, set_by,
  set_at). Staff write, that client's users read their own rows, never the task list.
- Nullable `rhythm` jsonb on `client_profile`, same shape as `month_rhythm.parts`.
- `task_templates.email_kind` (from the email spec), set in slice 3's migration.

## Open questions for the owner

1. Email 3 in the doc is "Account maintenance update" (bank feed check, standard text). The
   month rhythm's 24th is "Follow up on missing documents". Should the 24th email be the
   follow-up request, the maintenance update, or both (one email with two sections)?
2. Are the client-facing dates always the internal date plus one day (5th, 15th, 25th)?
3. Competitive brainstorm questions still open: task-size estimate acceptable to staff, client
   checklist scope (every open request or this month only), where "QuickBooks agrees" shows.

## Rules that stay in force

No personal names or email addresses in copy, American spelling, plain copy, no exclamation
marks, QuickBooks read-only, clients never see the internal task list, JS and SQL due-rule
fixtures stay in agreement.
