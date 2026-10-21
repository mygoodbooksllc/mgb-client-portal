# Slate month rhythm, slice 4: report state, Preliminary badge, 24th rules, late exclusion

Written 2026-10-21. Plan: `docs/slate-month-rhythm-build-plan.md` row 4 and owner decisions 1 and 2
in `docs/slate-month-rhythm.md`. Additive only. Everything new for staff is behind
`TK_rhythmEnabled()` (preview `mgb_rhythm_preview` or the firm switch `month_rhythm_enabled`),
except part (f), the late exclusion, which the owner wants regardless of the switch.

Rhythm rows are found by `task_templates.source_ref` (`month_rhythm:6_reports`,
`month_rhythm:7_follow_up`, `month_rhythm:8_follow_up`), never by title or id in code.

## (a) Report state

Migration `supabase/slate-rhythm-4-report-state.sql`.

- `public.tk_report_state`: `client_id` text references clients (on delete cascade), `period`
  date (first of month, checked), `state` in `none|preliminary|full`, `missing` jsonb array (at
  most 30 items, each `{label: 1-200 chars, request_id: uuid|null}`, checked), `set_by`, `set_at`;
  unique `(client_id, period)`. RLS on.
  - SELECT: `is_active_staff() and can_access_client(client_id)`. No other policies. Clients
    have no table access at all.
  - INSERT/UPDATE/DELETE revoked from anon and authenticated; writes only through the RPC.
- `public.tk_report_state_audit` (id, client_id, period, old_state, new_state, old_missing,
  new_missing, changed_by, changed_at), filled by an AFTER trigger on every write. RLS on, admins
  read, nobody writes directly. Same idea as `tk_settings_audit`.
- `tk_set_report_state(p_client, p_period, p_state, p_missing)` SECURITY DEFINER: active staff
  with `can_access_client`; normalizes the period to the first of the month; `preliminary` needs at
  least one item; `full`/`none` store `[]`; labels trimmed, blank items dropped, a `request_id`
  kept only when that request belongs to the same client. Upsert. Returns the row as jsonb.
- `tk_client_report_state(p_client_id)` SECURITY DEFINER, the only client read path: allowed for
  `is_client_member(p_client_id)` or staff with access. Returns `period, state, missing` where
  each missing item is `{label, request_id}` and `request_id` is non-null only while that request
  is still open on that client. Nothing else (no task ids, names, assignees, notes). Clients see
  rows only when the firm switch is on or the client is test_only (staff always see them), so a
  staff preview never shows a badge to a real client before launch. Last 24 months.
- Row 8 trigger `tk_rhythm_row8_full` AFTER UPDATE OF status, done ON staff_reminders, WHEN the
  task turns done and has a template_id: if the template is `month_rhythm:8_follow_up` and the
  task has a month period, upsert state `full` with `missing []` for that client and period.
  Skipped while `mgb.tk_rhythm` is on (the 24th auto-complete, see d) so an auto-completed row 8
  never claims full reports were sent. Exception-safe: a failure here never blocks the
  completion (it raises a warning).

## (b) Row 6 picker (drawer)

Behind `TK_rhythmEnabled()`. When a staff member marks a row 6 task done (drawer status menu or
the done toggle) and it has a client and a month period, the drawer opens a small modal instead
of completing straight away:

- Full reports / Preliminary reports (radio).
- Preliminary: a list prefilled with the titles of the client's open Ask client requests
  (`tk_list_client_requests`, status `open`, not legacy), each editable or removable, plus "Add
  an item". At least one item is required.
- Save: `tk_set_report_state`, then the normal `api.complete`. If the state write fails the task
  is not completed and a toast says so.
- Cancel leaves the task as it was.
- Review fix (2026-10-21): every other single completion (list checkbox, Today, Overview,
  Desk rows) goes through `TK_api.complete`, which now opens the task with the toast "Choose
  Full or Preliminary reports to finish this task." instead of completing a row 6 task while
  `TK_rhythmEnabled()` (rows read without `template_id`, like Today, look it up once). The
  picker passes `skipReportPick`. Feature off: no check, no template read.
- Still without the picker: bulk complete (`tk_bulk_complete` from the bulk bar) and an admin
  approving a row 6 that a bookkeeper sent for review (the state was asked at submit, unless
  the submit itself came from the bulk bar). State then stays as it was (`none`: no badge,
  not excused, and row 8 may auto-close as "Nothing outstanding"). The guide draft says to
  complete Send reports one at a time.
- Prefill fix (2026-10-21): the list now comes from `tk_list_client_requests(null, client)`,
  all the client's open requests. It was passing the task id, which only returned requests
  linked to the row 6 task itself (usually none).

## (c) Client Preliminary card

`CN_ReportStateCard` in `components/client/ClientNeeds.jsx`, rendered by `ReportsPage` in the
client Downloads branch only (new optional props). It calls `tk_client_report_state` once and
renders nothing unless a row is `preliminary`. Copy: "Preliminary reports for October 2026",
"These reports were sent before everything arrived. We will send the full set once these come
in." and "Missing: <label>" items. An item with a `request_id` links to Messages › Requests
focused on that request when the person has Messages; otherwise plain text. No exclamation
marks. Tours and help are untouched (no new targets).

## (d) 24th auto-complete and (e) account manager notice

Migration `supabase/slate-rhythm-4b-daily.sql`.

`tk_rhythm_daily(p_today date default Chicago today)` SECURITY DEFINER, cron `month-rhythm-daily`
at `40 10 * * *` (after `task-templates-daily` at 10:15). Only acts on clients where the switch
is on, or the client is test_only / is_internal (the generator's rule). Idempotent.

1. Notice: for each row 7 task (not deleted, month period, due within the last 7 days up to
   today) whose period P and P minus one month are both `preliminary`, and no notice exists for
   that task yet:
   - description gets the prefix "Second month in a row. " once;
   - a `tk_rhythm_notices` row per recipient: the client's account manager when active staff,
     otherwise every active admin;
   - an email through the existing `staff_task_batch` outbox kind (pref "task_batch", one
     person, no edge function change) only when the switch is strictly on and the client is not
     test_only / internal. Nothing is emailed while the switch is off.
   The bell shows `tk_rhythm_notices` for the signed-in person (id prefix `rhy:`) only when
   `TK_rhythmEnabled()`; test and internal clients follow the bell's existing skip rule.
2. Auto-complete: open (todo, in_progress) row 7 and row 8 tasks due on or before today, client
   with zero open Ask client requests. Row 8 also needs the period state not `preliminary` (the
   full reports are still owed even when every document has arrived). Each is set done with
   `mgb.tk_generate` (server write, no review diversion, no assigned email) and gets a system
   comment "Nothing outstanding" (the comment trigger accepts `kind = system` from this job via
   `mgb.tk_rhythm`). Waiting and in-review tasks are never touched.

`tk_rhythm_notices` (id, recipient_email, client_id, period, task_id, kind, created_at), unique
(task_id, recipient_email). RLS: the recipient (active staff) reads their own rows; no writes.

## (f) Late exclusion (ungated)

Migration `supabase/slate-rhythm-4c-late-exclusion.sql`.

`tk_late_excused(status, client_id, period_kind, period_start)`: true when status is
`waiting_client`, or the task has a month period (`period_kind = 'month'`) and that client month
is `preliminary`. Quarter, year and no-period tasks are excused only while waiting, so ad hoc
work never hides real lateness behind a preliminary month.

Applied (anchor patches, each adds one `and not tk_late_excused(...)`):

| Where | Change |
| --- | --- |
| `staff_performance` tk.overdue (score) | excused tasks are not overdue |
| `client_health` overdue (feeds health and score) | same |
| `digest_weekly_data` tasks_overdue | same |
| `tk_on_time_stats` (review queue, on-time) | excused tasks leave the eligible set entirely |

JS mirror `TK_lateExcused(task)` / `TK_taskMonth(task)` in `TK_logic.js` with
`TK_reportStateCache` (preliminary `client|YYYY-MM-01` keys, loaded by staff from
`tk_report_state` through `TK_api.loadReportStates`, 5-minute cache: Slate lists, and since
the review fix also `staffItemsApi.list` (Today, top bar and sidebar badges, client tabs) and
the Team page task read). Used by `TK_isOverdue` (Slate badges, top bar, client tabs), `TK_groupMyTasks`
(an excused late task goes to Waiting, not Overdue; Desk "late" count), `TP_taskState` (Team
pages: adds the missing waiting check too), the Today header "late" count and
`TK_onTimeOutcome`. Task reads gain `template_id, period_kind, period_start` so JS and SQL decide
the month the same way.

Applied to production 2026-10-21. Today: 0 waiting tasks, 0 report-state rows and late counts
off (grace), so no visible number changes. With grace simulated on production data: tasks
overdue 176 -> 176, health red 33 -> 33, on-time eligible 0 -> 0 (on_time_since is 2026-10-15).

## Self-critique (fixed above)

- RLS: the client path is an RPC that whitelists fields; the table itself has no client policy, so
  a direct select returns nothing. Tested as a real client role.
- A staff preview could have shown a badge to a real client: client reads now need the switch or
  a test client.
- Row 8 auto-complete would have marked the month full: the trigger skips the job's writes.
- The cron job runs with no JWT: comment insert needed an additive branch; status writes use the
  existing generator bypass, so no assigned emails and no review diversion.
- Notices could repeat daily: unique (task_id, recipient) and the description prefix check.
- Switching on later would back-notify old months: notice window is due within the last 7 days.
- JS/SQL parity on the task month: list reads carry period columns; shared vectors test both.
- Rollback: drop the cron job, the trigger and the new functions/tables; reverse the four anchor
  patches (each file lists them). No existing data changes.
