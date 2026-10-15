# Tasks module, Phase 2 spec: recurring engine, review loop, Ask-client, Asana import

Status: SPEC, no code yet. Written 2026-10-15 against origin/main.
Sources: `docs/tasks-module-brief.md`, `docs/tasks-module-audit.md` (A3 D1-D11, A6, Part B, B9, R1-R27),
`docs/tasks-phase1-spec.md` (conventions B3, schema probe B4), and the owner decisions of 2026-10-15
(numbered OD1-OD10 below). OD answers override the audit where they differ.

**Size and models: Big change. Opus specs, builds, critiques and does final verify for every slice.
Sonnet runs the docs and guide sweep; Haiku runs grep, lint and phone-width screenshot checks (low effort).**

## 0. Owner decisions (settled, do not re-open)

| # | Decision |
|---|---|
| OD1 | The backup bookkeeper stays on `client_profile.backup_bookkeeper_email`. No data move. |
| OD2 | OOO moves only open tasks due inside the window. `ready_for_review` tasks stay with the original bookkeeper. |
| OD3 | Quarterly and annual sign-off (990 prep, giving statements) are supported. Widen the `month_close` key now with a data-preserving, re-runnable migration. |
| OD4 | The admin sign-off closes a period. Open tasks show as a warning, never a block. |
| OD5 | Ask-client for people with no login uses a token link. New `client_contacts` and `tk_request_tokens`. Tokens are hashed, single-purpose, expiring, revocable, rate-limited and logged. Dry-run mode by default. Test only on `basic-test` and `grace-community`. Outbound only. |
| OD6 | Client uploads go into the existing Drive doc-type folders. No month folder level. Supabase keeps only the link. |
| OD7 | One-time import of OPEN Asana tasks. Duplicate onboarding projects merge, newest wins. 3 unmapped users go to the owner's address. Onboarding projects become `tk_projects`. The owner sees a dry-run report before any row is written. Soft deletes only. |
| OD8 | On-time excludes time waiting on the client. A send-back does not count against on-time if final approval is still before the (adjusted) due time. |
| OD9 | No inbound email to tasks@ in Phase 2. |
| OD10 | The installable app stays staff-only. |

Hard rules for every slice:
- Never touch secrets or the service_role key. QBO stays read-only.
- Soft deletes only. No PII in repo files (Asana snapshots and dry-run reports live in the scratchpad and the DB, never in git).
- RLS on every new table. Each new table starts with `revoke all ... from anon, authenticated`, because `pg_default_acl` grants everything.
- All SQL is re-runnable. A new CHECK on an existing table is added `not valid`, then validated.
- Edge function deploy: `npx --yes supabase@latest functions deploy <name> --project-ref xumsqmhccgfjnlmieqyu`. Public functions add `--no-verify-jwt`.
- CHECK widening for outbox kinds or email features: deploy the edge function first, then widen. Restate the full live list, read with `pg_get_constraintdef`, and update every file that defines it (`notification-emails.sql`, `tech-inventory-v2.sql`, `staff-handbook.sql`, `gl-review-1-core.sql`) (R24/R25).

## A. Phase 2 rows (audit A6), with ids

| Id | Row | Slice |
|---|---|---|
| 4.1 | Per-client template built on "MGB Standard Monthly Close" plus client items | S4 |
| 4.2 | Cadence: weekly, monthly, quarterly, annual | S4 |
| 4.3 | Due rules, including business-day N | S1 (math), S4 (use) |
| 4.4 | Tasks generated N days ahead by a scheduled function | S4 |
| 4.5 | Period object (open / in review / closed) with sign-off | S2 |
| 4.6 | Bulk-edit a recurring series | S4 |
| 4.7 | SOP attached to each recurring item; SOP steps become the checklist | S4 |
| 5.1 | Ready for review, then Approve or Send back with a reason | S3 |
| 5.2 | Review counts per bookkeeper | S3 |
| 6.1 | Ask client on any task pauses it (Waiting on client) | S5 |
| 6.2 | Client "What we need from you" page with upload and reply | S5 |
| 6.3 | Email with a magic link for clients who do not log in | S6 |
| 6.4 | Nudges every 3 business days | S6 |
| 6.5 | Answering resumes the task and files the upload (doc-type folders per OD6) | S5, S6 |
| 6.6 | `client_requests` table with client RLS (own org only) | S5 |
| 7.2 | Mentions and send-backs delivered immediately (within the 5-minute outbox cycle) | S3 |
| 9.1 | Reassign due tasks to the backup while out, and back on return | S7 |
| 10.4 | Review queue | S3 |
| 10.5 | Waiting-on-client list | S5 |
| 12.1 | Import users by email, teams to bookkeeper, projects to clients | S8 |
| 12.2 | Sections to cadence; recurring tasks become draft templates | S8 |
| 12.3 | History and duplicate merge (OD7: OPEN tasks only, no history) | S8 |
| 12.4 | Parallel run with Asana through the November close (read-only diff) | S8 |
| 14.1 | Fold the Close tab checklist and doc requests into tasks (source link, never title match) | S5, S9 |
| 14.2 | Suggest from QBO close_checks: "Looks done. QuickBooks shows ..." | S9 |
| (10.6) | On-time metric. The dashboard stays Phase 4; the definition and RPC ship now (OD8). | S3 |

## B. Shared additions

**New session flags.** Each is set with `set_config(name,'on',true)` inside a SECURITY DEFINER function and cleared before return.
- `mgb.tk_approve`: approve and send-back.
- `mgb.tk_signoff`: `month_close` done.
- `mgb.tk_generate`: the generator. Suppresses per-row assignment emails.
- `mgb.tk_ooo`: OOO apply and return. Suppresses per-row emails.
- `mgb.tk_import`: Asana apply. Suppresses all emails.
- `mgb.tk_request`: lets client-request RPCs move a task into or out of `waiting_client`.

`notify_enqueue_task_assigned` skips a row when `mgb.tk_generate`, `mgb.tk_ooo` or `mgb.tk_import` is on, or when `source in ('template','asana')`.

**New outbox kinds** (`notification_outbox.kind`, Option A of 7.2). Each kind needs a `PREF` map entry in `notification-emails/index.ts` and `ST_STAFF_EMAIL_PREFS` in `Settings.jsx`.
- `staff_task_review_ready`: to the reviewer.
- `staff_task_sent_back`: to the assignee.
- `staff_task_mention`: to the mentioned staff member, not the author.
- `staff_task_client_answered`: to the assignee.
- `staff_task_batch`: one summary per person per run. Used by the generator digest, the OOO handoff and the OOO return.

**New client email features** (`client_email_log.feature` CHECK): `client_request` and `client_request_nudge`.
- `client_email_settings` gains `client_request_enabled boolean not null default false`. This is the live switch.
- `client_emails_cron` whitelist gains `client_request_nudge`. The edge `Job` type gains it too.

**`tk_settings`** (key text PK, value jsonb, updated_by, updated_at). RLS: `is_active_staff` select, admin insert and update, no delete. Keys:
- `standard_set_live`: false until the owner turns it on after the Asana apply.
- `on_time_since`: the ship date of S3.
- `token_ttl_days`: 14.
- `nudge_max`: 4.

**Schema probe.** `tk_schema_version()` returns 2 through 9 as slices land. TK_api uses it to hide UI whose SQL is missing (Phase 1 B4).

**New JS files** (TK_ prefix, registered in `window.__SOURCE_ORDER`). Pure logic files get node tests:
- `components/tasks/TK_recurrenceLogic.js` (+ `.test.js`, + `TK_recurrence.fixtures.js`)
- `TK_reviewLogic.js` (+ test)
- `TK_metricsLogic.js` (+ test)
- `TK_ReviewQueue.jsx`, `TK_WaitingList.jsx`, `TK_AskClientModal.jsx`, `TK_Templates.jsx`, `TK_PeriodSignOff.jsx`
- `tk-review.css`, `tk-requests.css`

Client side: `components/client/ClientNeeds.jsx` (prefix `CN_`) and `client-needs.css`. Static page: `respond.html` (+ `respond.js`, no app bundle).

## C. Data model and RPCs, by area

### C1. Calendar (4.3), file `supabase/tasks-p2-1-calendar.sql`

**Table.** `tk_holidays(day date PK, name text not null, firm_closed boolean not null default true, created_by text, created_at)`.
- Seeded with US Federal Reserve bank holidays for 2026-2028. The owner adds firm-only days.
- RLS: `is_active_staff` select, admin insert and update. No delete grant; set `firm_closed=false` instead.

**Functions** (all `stable`, `security invoker`, granted to authenticated):
- `tk_is_business_day(p_day date) returns boolean`: Monday-Friday and not a `firm_closed` holiday.
- `tk_add_business_days(p_day date, p_n int) returns date`: n may be negative. n=0 rolls forward to a business day.
- `tk_business_day_of_month(p_month date, p_n int) returns date`: the Nth business day. n=-1 means the last business day.
- `tk_roll(p_day date, p_mode text) returns date`: modes `next`, `prev`, `none`.
- `tk_due_rule_valid(p_rule jsonb) returns boolean`: `immutable`, used in a CHECK.
- `tk_resolve_due(p_rule jsonb, p_period_start date, p_period_end date) returns date`.

**Due-rule shapes.** `month_offset` defaults to 1, meaning the month after the period ends. Any month the rule targets counts from the period end.

| `type` | fields | meaning |
|---|---|---|
| `offset` | `days` (-90..120) | `period_end + days`, calendar (D2 default). `null` rule = legacy `due_offset_days`. |
| `business_day` | `n` (1..23 or -1), `month_offset` | Nth business day of the target month |
| `day_of_month` | `day` (1..31, clamped), `month_offset`, `roll` | Fixed day, rolled by `tk_roll` |
| `eom` | `offset_bd` (0..10), `month_offset` | Last business day minus N business days |
| `nth_weekday` | `n` (1..5 or -1), `dow` (1=Mon..7), `month_offset` | e.g. 2nd Tuesday |
| `weekday` | `dow` | Weekly cadence: that weekday in the period week, rolled `next` |

`firm_deadline_rules.due_rule` shapes stay as they are. `OPS_rollWeekend` stays weekend-only in Phase 2, so the Deadlines copy does not change (R14).

**JS mirror.** `TK_recurrenceLogic.js` exports `TK_isBusinessDay`, `TK_addBusinessDays`, `TK_businessDayOfMonth`, `TK_resolveDue`, `TK_periodsFor` and `TK_periodKey`. It takes the holiday list as an argument.
- `TK_recurrence.fixtures.js` holds at least 40 cases: month ends, February, holidays on a Monday, `n=-1`, weekly across a year end, and fiscal quarters.
- The node test asserts every case.
- `tk_recurrence_selftest()` (admin, returns `table(case_id text, expected date, got date)` for failures only) runs the same fixtures. The slice pastes them in via a generated `values` list.

### C2. Periods and sign-off (4.5, OD3, OD4), file `supabase/tasks-p2-2-periods.sql`

The migration plan is in section F.

**New `month_close` columns:**
- `period_kind text not null default 'month'` (`month`, `quarter`, `year`)
- `signed_off_by text`, `signed_off_at timestamptz`
- `reopened_reason text` (<=500), `reopened_by text`, `reopened_at timestamptz`
- `reviewer_email text`

**New task columns** on `staff_reminders`: `period_kind text` and `period_start date`. There is no FK (decision below), and a partial index sits on `(client_id, period_kind, period_start) where deleted_at is null`.
- Decision: no composite FK. The generator upserts the `month_close` row first, and readers left-join. This avoids PG15 column-list `SET NULL` and coupling during the key change.

**RPCs** (SECURITY DEFINER, `search_path=public`):
- `tk_period_start(p_client_id text, p_kind text, p_date date) returns date`
  - month: `date_trunc('month')`
  - quarter and year: aligned to the fiscal year start, which is the month after `client_profile.fiscal_year_end` (default `12-31`, so January).
  - A CHECK cannot read `client_profile`, so alignment is enforced here and in the sign-off RPC.
- `tk_sign_off_period(p_client_id text, p_kind text, p_period date, p_note text default null, p_ack_open boolean default false) returns jsonb`
  - Admin only. Checks that `p_period` equals `tk_period_start(...)`.
  - Counts open tasks with that `client_id/period_kind/period_start` that are not deleted and not done.
  - If the count is above 0 and `p_ack_open` is false, it returns `{ok:false, needs_ack:true, open_tasks:n, sample:[{id,title,status}x5]}` and writes nothing (OD4: warn, never block).
  - Otherwise it sets `mgb.tk_signoff` and upserts the row with `status='done'`, `signed_off_by/at`, and the note appended to `notes`. It then logs `tk_activity` kind `period_signed_off` (CHECK widened) on each open task and returns `{ok:true, signed_off_at, open_tasks:n}`.
  - The GL gate still runs for months.
- `tk_reopen_period(p_client_id text, p_kind text, p_period date, p_reason text) returns void`
  - Admin only. The reason must be 3-500 characters. Sets `status='in_progress'`, clears `signed_off_*` and stamps `reopened_*`.
  - The GL reopen trigger still fires for months.
- `tk_period_summary(p_client_id text, p_kind text, p_period date) returns jsonb`: staff with `can_access_client`. Returns open, review, waiting and done counts plus the sign-off state. Used by the sign-off panel.

**Trigger** `month_close_signoff_guard` (BEFORE INSERT OR UPDATE):
- A new or changed `status='done'` raises `'Only an admin sign-off can close a period'` unless `mgb.tk_signoff='on'`.
- `na` stays allowed for admins.
- `signed_off_*` columns revert unless the flag is on.

The close KPI in `staff_performance` (`tasks-module-v1.sql` ~2083) and in `client_health` switches to `coalesce(mc.signed_off_at, mc.done_at, mc.updated_at)`. Both filter `period_kind='month'`.

### C3. Review loop and on-time (5.1, 5.2, 7.2, 10.4, 10.6), file `supabase/tasks-p2-3-review.sql`

**New `staff_reminders` columns:**
- `reviewer_email text`
- `send_back_count int not null default 0`
- `ready_at timestamptz`
- `approved_by text`, `approved_at timestamptz`
- `due_date_original date`: set on insert. It changes only when an admin edits `due_date`.
- `waiting_before_due_minutes int not null default 0`

`client_profile.reviewer_email text` is a nullable override. A trigger checks it is an active admin.

**Indexes:**
- `staff_reminders(reviewer_email, status) where deleted_at is null`
- `(status, ready_at) where status='ready_for_review' and deleted_at is null`

**Reviewer resolution.** `tk_client_people` gains a role `reviewer`, computed as `coalesce(client_profile.reviewer_email, clients.account_manager_email)`, kept only if that person is an active admin, else null (meaning any admin).
- `reviewer_email` is stamped when a task first enters `ready_for_review` with no reviewer set.
- `tk_can_read_task` adds `reviewer_email = auth email`.

**State machine.** `tk_set_status`, the new RPCs and the BEFORE trigger enforce it.

| From | To | Who | How | Side effects |
|---|---|---|---|---|
| todo | in_progress | editor | `tk_set_status` | activity `status` |
| todo, in_progress | ready_for_review | editor | `tk_set_status` ("Send for review") | `review_required=true`, `ready_at` stamped on first entry, reviewer stamped, outbox `staff_task_review_ready` |
| todo, in_progress | done | editor | `tk_set_status` | Only when `review_required=false`. Otherwise diverted to `ready_for_review` (now for admins too). |
| ready_for_review | done | admin, not `coalesce(assignee_email, staff_email)` | `tk_approve` | `approved_by/at`, `completed_at`. Activity `review_approved` with meta `{first_pass: send_back_count=0}`. Series roll-forward through `complete_staff_item`. |
| ready_for_review | in_progress | admin, not assignee | `tk_send_back` (reason required) | `send_back_count+1`, comment kind `send_back`, activity `review_sent_back`, outbox `staff_task_sent_back` |
| ready_for_review | in_progress | editor | `tk_set_status` ("Withdraw") | no count, activity `status` |
| todo, in_progress | waiting_client | editor | `tk_ask_client` only (flag `mgb.tk_request`) | `status_before_wait`, `waiting_since` |
| waiting_client | status_before_wait | system, or an editor via "Stop waiting" | last open request answered or cancelled, or `tk_stop_waiting` (cancels open requests) | `waiting_minutes`, `waiting_before_due_minutes` |
| done | todo | editor (admin if `approved_at` is set) | `tk_set_status` ("Reopen") | clears `approved_*` |
| done | waiting_client, ready_for_review | nobody | blocked (Phase 1) | |

Trigger changes in `staff_reminders_before_write`:
- Writing `approved_by`, `approved_at`, `send_back_count` or `ready_at` without `mgb.tk_approve` raises an error. It no longer reverts silently (fixes R26).
- `reviewer_email` may change only for an admin or through the stamping path.
- Entering or leaving `waiting_client` directly (without `mgb.tk_request`) raises an error.
- On leaving `waiting_client`, it computes the wait and the before-due credit (C3 on-time, below).
- `TK_reviewLogic.js` mirrors the table as `TK_allowedTransitions(task, actor)` and the drawer uses it. Its tests cover every row, including self-approval.

**RPCs** (SECURITY DEFINER):
- `tk_approve(p_id uuid, p_note text default null) returns jsonb`: returns `{ok, next_id}` (the roll-forward id or null).
- `tk_send_back(p_id uuid, p_reason text) returns void`: the reason must be 3-2000 characters. The UI reuses `ProBudgetNoteModal`.
- `tk_set_reviewer(p_id uuid, p_email text) returns void`: admin only. The email must belong to an active admin who is not the assignee.
- `tk_stop_waiting(p_id uuid, p_note text default null) returns void`: editor.
- `tk_review_stats(p_from date, p_to date, p_email text default null)`
  - Returns `table(staff_email text, approved int, first_pass int, sent_back int, avg_hours_in_review numeric, open_in_review int)`.
  - An admin sees everyone; anyone else sees only their own row. The signal key is `first_pass`.
- `tk_on_time_stats(p_from date, p_to date, p_email text default null)`
  - Returns `table(staff_email text, eligible int, on_time int, rate numeric, avg_hours_late numeric, excluded_wait_hours numeric)`.
  - Same visibility rule.

**On-time definition (OD8).** Times are America/Chicago.
- `deadline0 = (due_date_original + 1)::timestamp at time zone 'America/Chicago'`, which is the end of the due day.
- `effective_deadline = deadline0 + waiting_before_due_minutes`.
- When a task leaves `waiting_client`, the trigger computes `w = now() - waiting_since`. If `waiting_since < effective_deadline` (using the minutes accrued so far), it adds all of `w` to `waiting_before_due_minutes`. A wait that starts after the deadline adds nothing.
  - Reasoning: if the client answers late, the bookkeeper gets back the same time they had left.
- `on_time = completed_at <= effective_deadline`. `completed_at` is the final approval for review tasks, so send-backs never count by themselves (OD8).
- Eligible tasks:
  - status done, `due_date_original` not null, `deleted_at` null
  - client not `test_only`
  - `source <> 'asana'` for tasks created before the import, and `completed_at >= tk_settings.on_time_since`
- Credit goes to `coalesce(assignee_email, staff_email)` at completion, so an OOO backup who finishes the task gets the credit.
- Due-date gaming is prevented because only admins move `due_date_original`.
- `TK_metricsLogic.js` exports `TK_effectiveDeadline` and `TK_isOnTime`, with tests for: a wait before due, a wait straddling due, a wait after due, two waits, and a send-back then approval before and after the deadline.

**Notifications (7.2).**
- `tk_comments` AFTER INSERT enqueues `staff_task_mention` for each parsed mention (`tk_parse_mentions`), except the author.
- Send-back and review-ready are enqueued inside the RPC or trigger.
- "Immediate" means the next 5-minute `notification-emails` run.

### C4. Templates and generator (4.1, 4.2, 4.4, 4.6, 4.7), file `supabase/tasks-p2-4-recurring.sql`

**New table** `tk_template_sets(id uuid PK, name text unique, is_standard boolean, created_by, created_at, updated_at, deleted_at)`.
- RLS: staff select, admin write.
- Seed "MGB Standard Monthly Close" with 6 templates from `CLOSE_CHECKLIST` (app.jsx:5541): `bank_feed`, `bank_rec`, `card_rec`, `entries`, `review`, `sent`.
- They are seeded with `status='draft'` and stay inactive until `tk_settings.standard_set_live` (R15).

**`task_templates` gains:**
- `template_set_id uuid references tk_template_sets`
- `status text not null default 'active'`, CHECK in (`draft`, `active`, `retired`)
- `due_rule jsonb`, CHECK `due_rule is null or tk_due_rule_valid(due_rule)`
- `assignee_role text not null default 'bookkeeper'`, CHECK in (`bookkeeper`, `backup`, `account_manager`, `reviewer`)
- `review_required boolean not null default false`
- `sop_section text`, with the same CHECK as `staff_reminders.sop_section`
- `estimate_minutes int`
- `period_basis text not null default 'calendar'`, CHECK in (`calendar`, `fiscal`)
- `close_key text`, which links to the Close checklist (14.1)
- `activated_at timestamptz`, stamped on the draft-to-active change
- `source text` (`manual` or `asana`), `source_ref text`
- The cadence CHECK widens to add `weekly`. A client item is `client_ids = array[client_id]` with a CHECK of `cardinality(client_ids) <= 1 or template_set_id is null`.

**New table** `tk_client_template_overrides(client_id text references clients, template_id uuid references task_templates, skip boolean not null default false, override jsonb not null default '{}', updated_by, updated_at, PK (client_id, template_id))`.
- `override` keys: `title`, `due_rule`, `assignee_role`, `checklist`, `review_required`.
- RLS: staff with `can_access_client` select. Writes go through the RPCs only.

**New table** `tk_sop_steps(id uuid PK, client_id text null references clients, sop_section text not null, position int not null, body text not null (<=500), created_by, updated_at, deleted_at)`.
- Firm rows (`client_id` null): `is_active_staff` select, admin write.
- Client rows: `can_access_client` select and write.
- Personal `staff_checklist_presets` are not folded in.

**Read path for bookkeepers.** Add staff select policies on `task_templates` and `task_template_issued`: rows where `client_ids` is empty or contains a client the user can access.

**RPCs** (SECURITY DEFINER):
- `tk_save_client_item(p_client_id text, p_item jsonb) returns uuid`: `is_active_staff` and `can_access_client`. Refuses firm items (`client_ids` empty).
- `tk_set_client_override(p_client_id text, p_template_id uuid, p_skip boolean, p_override jsonb) returns void`.
- `tk_confirm_draft_template(p_template_id uuid, p_due_rule jsonb, p_skip_covered boolean default true) returns void`: `can_access_client`. It sets status `active` and `activated_at`. When `p_skip_covered` is true it inserts `task_template_issued` for periods already covered by an open imported task with the same client and a matching normalized title, so there are no duplicates.
- `tk_update_series(p_template_id uuid, p_client_id text, p_from_date date, p_patch jsonb, p_also_future boolean default true) returns int`
  - Admin, or `can_access_client` for that client.
  - Patch keys: `title`, `description`, `assignee_email`, `priority`, `review_required`, `sop_section`. Admin only can turn `review_required` off.
  - It updates open, not-deleted tasks with that template and client where `due_date >= p_from_date`.
  - With `p_also_future`, it writes the override as well.
  - It backfills `series_id` and patches the client-side `_toggleDoneClientSide`.
- `tk_generate(p_today date default (now() at time zone 'America/Chicago')::date, p_dry_run boolean default false, p_client_id text default null, p_horizon_days int default null) returns jsonb`. Algorithm in section D.
- `tk_generate_preview(p_client_id text default null, p_days int default 30) returns jsonb`: a dry run with a horizon.
- `tt_generate_template_tasks(p_today)` and `tt_generate_now()` stay as thin wrappers with their current return types.

**New table** `tk_generator_runs(id uuid PK, ran_at timestamptz, p_today date, trigger text (cron, manual, preview), dry_run boolean, created int, skipped jsonb, missed jsonb, result jsonb)`. RLS: admin select only.

**Cron.** `task-templates-daily` at `'15 10 * * *'` runs `select tk_generate()`, re-scheduled behind the `cron.unschedule ... where jobname in (...)` guard.

### C5. Client requests on the portal (6.1, 6.2, 6.5, 6.6, 10.5, 14.1 doc part), file `supabase/tasks-p2-5-requests.sql`

**Table `client_requests`:**
- `id uuid PK`
- `client_id text not null references clients`
- `task_id uuid references staff_reminders on delete set null`
- `kind text check (document, question, approval)`
- `title text not null (<=200)`, `prompt text not null (<=2000)`
- `needs_upload boolean not null default false`
- `due_date date`
- `status text not null default 'open'`, CHECK in (`open`, `answered`, `accepted`, `cancelled`)
- `recipient_emails text[] not null default '{}'` (portal users)
- `contact_ids uuid[] not null default '{}'`
- `reply text (<=4000)`
- `answered_via text` (`portal`, `link`, `staff`), `answered_by text`, `answered_at`
- `accepted_by`, `accepted_at`, `cancelled_by`, `cancelled_at`
- `asked_by text not null`, `asked_at timestamptz not null default now()`
- `last_nudged_at`, `nudge_count int not null default 0`, `nudge_paused boolean not null default false`
- `legacy_doc_request boolean not null default false`
- `deleted_at`

Indexes:
- `(client_id, status) where deleted_at is null`
- `(task_id)`
- `(status, last_nudged_at) where status='open'`

**RLS:**
- Staff: `can_access_client` select, insert and update.
- Clients: select where `is_client_member(client_id) and deleted_at is null`.
- No client writes. No delete grant.
- Client realtime uses this base-table policy.

**Migration from `client_doc_requests`.** Ids are preserved: `insert ... select ... on conflict (id) do nothing`.
- Status maps open to open, uploaded to answered, done to accepted, cancelled to cancelled.
- `title` comes from title, `prompt` from `coalesce(details, title)`, `needs_upload` is true, and `legacy_doc_request` is true.
- `client_files.client_request_id uuid references client_requests on delete set null` is backfilled from `request_id`. The ids match.
- `client_doc_requests` becomes read-only through a BEFORE trigger, with an `mgb.offboarding` bypass. Drop it later.
- Repointed: `client_doc_chase`, the `client_health` `doc_overdue` CTE, `ClientTabCounts`, the TopBar feed, the value report, DocChaser and `clientNeeds` (app.jsx ~28777).

**RPCs:**
- `tk_ask_client(p_client_id text, p_task_id uuid, p_title text, p_prompt text, p_kind text, p_needs_upload boolean, p_due_date date, p_recipient_emails text[], p_contact_ids uuid[]) returns uuid`
  - Staff with `can_access_client`. If there is a task, also `tk_can_edit_task`.
  - Recipients must be active `client_users` of that client or live `client_contacts` with `can_answer_requests`.
  - The task moves to `waiting_client` (flag `mgb.tk_request`). Activity `client_asked`.
  - Sending email is a separate call (C6) so the RPC stays mail-free.
- `tk_cancel_client_request(p_id uuid, p_reason text) returns void`: staff. Resumes the task if no open requests remain and revokes its tokens.
- `tk_accept_client_request(p_id uuid) returns void`: staff. Changes answered to accepted.
- `client_requests_for_client(p_client_id text) returns table(id, kind, title, prompt, needs_upload, due_date, status, asked_at, asked_by_first_name, answered_at, file_count)`: definer, `is_client_member` or staff.
- `tk_answer_client_request(p_id uuid, p_reply text) returns void`
  - Definer, caller must be `is_client_member`. The request must be open, and the reply or at least one file is required.
  - Sets answered (`answered_via='portal'`).
  - Adds a comment kind `client_reply` on the task and activity `client_answered`.
  - Resumes the task (restores `status_before_wait`) if no other open requests remain.
  - Enqueues outbox `staff_task_client_answered` to the assignee. This replaces the `notify_enqueue_doc_upload` fan-out for request uploads.
- `tk_waiting_on_client(p_client_id text default null) returns table(task_id, title, client_id, client_name, assignee_email, request_id, request_title, asked_at, business_days_waiting int, nudge_count, last_nudged_at, recipients int)`. Covers staff-accessible clients.

**Drive.** In `drive-files`, the request branch (index.ts ~414-480) switches from `client_doc_requests` and `fulfill_doc_request` to `client_requests` and new `tk_attach_request_file(p_request_id uuid, p_client_file_id uuid)`.
- The folder stays `docTypeFor(title)/yearForRequest` (OD6). Visibility is `request`.
- `uploadIntoFolders` and `trashDriveFile` move to `supabase/functions/_shared/drive.ts` so C6 can reuse them. Existing behavior is unchanged.

### C6. Token links, contacts, email, nudges (6.3, 6.4), file `supabase/tasks-p2-6-tokens.sql`

**Table `client_contacts`:**
- `id uuid PK`, `client_id text not null references clients`
- `name text not null (<=120)`
- `email text not null (<=254)`, CHECK `email = lower(email)`
- `role text check (treasurer, pastor, board, finance, other)`
- `can_answer_requests boolean not null default true`
- `notes text (<=500)`
- `created_by`, `created_at`, `updated_at`, `deleted_at`
- Unique index `(client_id, email) where deleted_at is null`.
- RLS: staff `can_access_client` select, insert and update. No client access in Phase 2. No delete grant.

**Table `tk_request_tokens`:**
- `id uuid PK`
- `request_id uuid not null references client_requests`
- `contact_id uuid references client_contacts`
- `recipient_email text not null`
- `token_hash bytea not null unique` (sha256)
- `created_by text not null`, `created_at`
- `expires_at timestamptz not null`
- `revoked_at`, `revoked_by`, `revoke_reason`
- `first_viewed_at`, `answered_at`
- `view_count int default 0`, `answer_attempts int default 0`
- `is_test boolean not null default false`
- RLS is on. `revoke all`. Staff select uses a column-level grant on every column except `token_hash`, with a policy for `can_access_client` via the request. No direct writes.

**Table `tk_request_token_events`:**
- `id bigint identity PK`, `token_id uuid`, `request_id uuid`
- `event text check (issued, emailed, view, answer, upload, stop_nudges, invalid, expired, revoked, answered_already, rate_limited, dry_run)`
- `ip_hash text`, `detail jsonb`, `at timestamptz default now()`
- RLS: admin select. Rows are never updated or deleted.
- The `detail` field never holds reply text, file names or the token.

**Table `tk_rate_buckets(key text PK, window_start timestamptz, count int)`.** One row per key, updated in place, never deleted. RLS on, no grants.

**Service-only RPCs.** EXECUTE is revoked from public, anon and authenticated and granted to `service_role` only.
- `tk_rate_hit(p_key text, p_window_s int, p_max int) returns boolean`
- `tk_issue_request_token(p_request_id uuid, p_contact_id uuid, p_email text, p_hash bytea, p_ttl_days int, p_actor text, p_is_test boolean) returns uuid`: revokes earlier live tokens for the same request and contact (reason `reissued`).
- `tk_token_lookup(p_hash bytea) returns jsonb`: returns the token state plus only the view fields below. It bumps `view_count` and `first_viewed_at`.
- `tk_answer_request_by_token(p_hash bytea, p_reply text, p_files jsonb, p_ip_hash text) returns jsonb`
  - Takes a row lock and re-validates.
  - Sets the request answered (`via 'link'`, `answered_by 'contact:<id>'`) and stamps `answered_at` on the token.
  - Revokes sibling tokens (`answered`), inserts `client_files` rows linked by `client_request_id`, and runs the same resume, comment, activity and outbox steps as the portal path.
- `tk_stop_nudges_by_token(p_hash bytea) returns void`
- `tk_log_token_event(p_token_id uuid, p_request_id uuid, p_event text, p_ip_hash text, p_detail jsonb) returns void`

**Revoke.** `tk_revoke_request_tokens(p_request_id uuid, p_reason text) returns int` is a staff RPC (`can_access_client`).

**Edge function `tk-client-requests`** (verify_jwt ON, staff JWT). Actions:
- `send` and `preview` take `{request_id}`.
- `resend` takes `{request_id, contact_id}`.

How it works:
- It confirms the caller with the user JWT: `is_active_staff` and `can_access_client`.
- Recipients: `recipient_emails` (portal users, minus unsubscribed, as `recipientsFor`) plus the contacts.
- Portal users get a deep link: `https://app.mygoodbooks.org/login?next=%23%2Fclient%2F<id>%2Fneeds%2F<reqId>`. Add an allow-list regex `^#/client/[a-z0-9-]+/needs(/[0-9a-f-]{36})?$` to the login redirect handling (the sessionStorage `PENDING_ROUTE_KEY` does not survive a new tab).
- Contacts get a token link `https://app.mygoodbooks.org/respond#t=<token>`. The token is 32 random bytes from `crypto.getRandomValues`, base64url-encoded. Only its sha256 is stored. The plaintext exists only in the email body.

Gating, in order:
1. If `client_email_settings.enabled` is false, the request is refused.
2. If the client is `test_only`, a test send happens: one `[Test]` copy to the caller only. Contact tokens are minted with `recipient_email = caller` and `is_test=true`, so the whole link flow can be exercised on `basic-test` and `grace-community`.
3. Else, if `client_request_enabled` is false, it is a **dry run**. Nothing is sent and no token is minted. It returns `{dry_run:true, recipients:[...], subject, html}`, logs `client_email_log` status `skipped`, reason `dry_run`, and records event `dry_run`.
4. Else it sends live: claim-before-send, a 10-minute resend guard, `Reply-To` set to the asking staff member, and a `client_email_log` row with feature `client_request`.

Only the owner flips `client_request_enabled`, in Dev Tools > Flags. That flip is the explicit confirmation. Build and verify agents never flip it.

**Public edge function `tk-request-respond`** (deploy `--no-verify-jwt`, `POST` only, CORS limited to `https://app.mygoodbooks.org`).

Request contract:
- `{action:'view', token}`, JSON
- `{action:'answer', token, reply}`, multipart with up to 5 `file` parts
- `{action:'stop_nudges', token}`, JSON

**Exact data a `view` returns.** Nothing else, ever:
- `title`, `prompt`, `kind`, `needs_upload`, `due_date`, `status`
- `asked_on` (date only), `asked_by_first_name`
- `client_display_name` (`clients.name`), `expires_on`
- `limits:{max_files:5, max_mb:25, types:[...]}`

It never returns emails, ids, the task, other requests, files, amounts or QBO data.

`answer` steps:
1. Checks the rate limits.
2. Re-validates through `tk_token_lookup`.
3. Validates the reply (<=4000) and the files (<=5, each <=25 MB, the `drive-files` `typeOf` allow-list).
4. Uploads into the client's Drive doc-type folder with `_shared/drive.ts`.
5. Calls `tk_answer_request_by_token`. If the RPC fails, the uploaded files are trashed (compensating).
6. Answering is single-use. A later call gets 410 `answered_already`.

Response codes, each with body `{error:'<code>'}`:
- 200 OK
- 400 `bad_request`
- 404 `invalid` (same response time path for all misses)
- 410 `expired`, `revoked`, `answered_already` or `cancelled`
- 413 `too_large`
- 415 `bad_type`
- 429 `rate_limited`

`ip_hash` is the sha256 of the IP truncated to /24 (IPv4) or /48 (IPv6) plus the date. No secret salt, so there is no secret to handle.

**Rate limits** (`tk_rate_hit`):

| Key | Limit |
|---|---|
| `ip:<hash>` | 30 calls per 10 minutes |
| `ipbad:<hash>` | 10 invalid or expired tokens per 15 minutes, then 429 for that window |
| `tokview:<id>` | 20 views per hour |
| token `answer_attempts` | 3 total |
| `global` | 600 per hour (circuit breaker, logged) |

**Threat model:**

| Threat | Control |
|---|---|
| Guessing tokens | 256-bit random, hash-only storage, per-IP invalid limit, uniform 404 |
| Leakage via Referer or server logs | Token in the URL fragment (never sent to servers). `respond.js` calls `history.replaceState` before fetching. `Referrer-Policy: no-referrer` and an enforced CSP on `/respond`. |
| Old or forwarded email | 14-day expiry. Single answer. A resend or nudge mints a new token and revokes the old one. Staff can revoke. A forwarded link reveals only that one prompt (accepted, documented risk). |
| Data exposure | Fixed view field list. Service-only RPCs return only those fields. No listing endpoint. |
| Upload abuse | Count, size and type limits. 3 attempts. Files land in the client's own folder with visibility `request`. Staff accept before anything is relied on. |
| XSS or injection | `respond.html` renders with `textContent` only. No markdown or HTML from the prompt. |
| Replay after answer | 410, plus sibling tokens revoked |
| Database abuse | Service-only EXECUTE grants; the function env holds the Supabase-provided service key (never read or handled by Claude) |
| Audit | Every view, answer, upload, invalid hit, expiry and rate-limit writes `tk_request_token_events` |

**Static page.** `respond.html` plus `respond.js` and `client-needs.css` tokens.
- `vercel.json` gets `{ "source": "/respond", "destination": "/respond.html" }`, plus a header block for `/respond` with `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex` and an enforced CSP: `default-src 'self'; connect-src https://xumsqmhccgfjnlmieqyu.supabase.co; img-src 'self' data:`.
- States: loading, the form (prompt, reply box, file picker), sent ("Thanks, <first name> has it"), expired or used (with a mailto link to the bookkeeper, using only the first name and generic support email), and rate-limited.
- Works at 375px.

**Email templates.** Plain HTML in the house email style, all text escaped.
- Ask:
  - Subject: `<Client name>: <request title>`
  - Body: "Hi <first name>," then "<Staff first name> at MyGoodBooks needs the following:", the title, the prompt, and a due date if set.
  - Button: "Reply or upload". Then: "This link works once and expires on <date>. It only shows this request."
  - Footer: "Questions? Reply to this email to reach <staff first name>."
- Nudge:
  - Subject: `Reminder: <n> item(s) <Client name> still needs from you`
  - Body: the list of titles, each with its own fresh link. Footer: a "Stop reminders" link (`respond#t=..&stop=1`), plus the portal user unsubscribe from `client_email_recipients`.
- Neither email includes amounts or any other client data.

**Nudges (6.4).** Cron `client-request-nudge` runs at `'0 14 * * 1-5'` (10:00 ET) and calls `client_emails_cron('client_request_nudge')`.
- The `client-emails` job selects open requests where:
  - `not nudge_paused`
  - `nudge_count < tk_settings.nudge_max`
  - `tk_add_business_days(coalesce(last_nudged_at, asked_at)::date, 3) <= today ET`
  - the client is not `test_only` (cron gate)
- It sends one combined email per recipient per client per day, minting a fresh token per contact per request, then bumps `nudge_count` and `last_nudged_at`.
- After the last nudge, the task shows a "No reply" chip and the assignee gets one `staff_task_batch`.
- The same dry-run gate as `send` applies.

### C7. Out of office (9.1), file `supabase/tasks-p2-7-ooo.sql`

**Table `tk_ooo_reassignments`:**
- `id uuid PK`
- `time_off_id uuid not null references staff_time_off`
- `task_id uuid not null references staff_reminders`
- `from_email`, `to_email`
- `reason text check (backup, manual, generator, rollforward)`
- `reassigned_at`, `reassigned_by`
- `returned_at`, `returned_by`
- `return_skipped_reason text`, `skipped_reason text`
- `unique (time_off_id, task_id)`
- RLS: select for an admin or for the from or to person. No direct writes.

**RPCs** (SECURITY DEFINER):
- `tk_apply_ooo(p_time_off_id uuid, p_dry_run boolean default true, p_overrides jsonb default '{}') returns jsonb`
  - The caller is an admin or the time-off owner. Only admins may pass `p_overrides` (`{client_id: to_email}`).
  - Selects tasks where `coalesce(assignee_email, staff_email)` is the owner, `deleted_at` is null, `status in ('todo','in_progress','waiting_client')` (OD2 keeps `ready_for_review`), and `due_date between starts_on and ends_on`.
  - Per task:
    - No `client_id`: skip `private`.
    - Backup from `tk_client_people(client).backup` or the override. Skip reasons: `no_backup`, `backup_away` (an overlapping uncancelled time off) and `self`.
    - If the backup lacks access, call the internal `tk__grant_coverage(p_time_off_id, p_client_id)`. This is a refactor of `grant_coverage_access` that drops its admin check, and it is revoked from public. If that fails, skip `no_access`.
  - Under `mgb.tk_ooo`, sets `assignee_email := to_email` and never changes `staff_email`.
  - Writes the ledger row and activity `reassigned_ooo`.
  - Sends one `staff_task_batch` to each backup and one summary to the owner.
  - A dry run returns `{move:[...], skip:[...]}` and writes nothing. It is idempotent through the unique key.
- `tk_return_ooo(p_time_off_id uuid, p_dry_run boolean default false) returns jsonb`
  - For ledger rows with `returned_at` null:
    - A done or deleted task gets `return_skipped_reason='closed'`.
    - If `assignee_email <> to_email`, someone changed it, so it gets `changed` and is left alone.
    - Otherwise `assignee_email := from_email`.
  - Then one summary to each person. Coverage grants are left to their own expiry.
- `tk_ooo_daily() returns jsonb`: cron `tk-ooo-daily` at `'0 11 * * *'` (6:00 CT). It returns every time off with `ends_on < today` (CT) that still has unreturned rows.

**Apply** is manual in Phase 2 (open question Q5). Admins use the Coverage tab "Hand off tasks" preview. Staff use "Hand my tasks to backups" in `CV_MyTimeOffBody`.

**Edits and cancels.** An AFTER UPDATE trigger on `staff_time_off` handles them:
- `cancelled_at` set: `tk_return_ooo` runs at once.
- `ends_on` moved earlier: tasks due after the new end are returned.
- Window extended: the UI prompts to re-run apply.

**Generator and roll-forward during a window.**
- `tk_generate` assigns a task due inside an active window to the backup and writes a ledger row (`generator`).
- `complete_staff_item` roll-forward: if the completed task has an open ledger row and the next due date is after `ends_on`, the new task goes to `from_email`. Otherwise it stays with the backup and gets a ledger row (`rollforward`).

## D. Recurring engine algorithm (`tk_generate`)

Runs with `mgb.tk_generate` set. The scope:
- Active templates: `active` and `status='active'`, set members only if `standard_set_live` or the client is in `p_client_id`.
- Crossed with clients, where `client_ids` contains the client, or `client_ids` is empty and `plan_tiers` is empty or matches.
- Skips clients that are `test_only`, unless `p_client_id` names them (admin test path), and skips overrides with `skip`.

For each pair:

1. Apply the override (`title`, `due_rule`, `assignee_role`, `checklist`, `review_required`).
2. **Periods.** Enumerate periods P from `floor` to `p_today + max(lead_days, p_horizon_days)`, where `floor = greatest(date_trunc(cadence, activated_at), p_today - interval '1 year')`. Period starts:
   - weekly: `date_trunc('week')` (Monday)
   - monthly: day 1
   - quarterly and annual: calendar starts, or fiscal starts from `tk_period_start` when `period_basis='fiscal'`
   - Annual means the fiscal year for 990 prep and the calendar year for giving statements, set per template.
3. **Due date.** `due = tk_resolve_due(coalesce(due_rule, {type:'offset',days:due_offset_days}), P.start, P.end)`.
4. **Window.** Create the task when `due - lead_days <= p_today` (or within the horizon for preview) **and** `due >= p_today - 7` (a 7-day catch-up grace; the task appears already overdue).
   - Periods with `due < p_today - 7` that were never issued are **not** created. They go in `result.missed[]`, the run log and the admin preview banner, so the owner can create one by hand.
   - This keeps a long outage from flooding everyone's lists.
5. **Dedupe and idempotency key.** `(template_id, client_id, period_start)`.
   - First, `insert into task_template_issued ... on conflict do nothing returning`. A task is created only if that insert returned a row.
   - Second guard: the existing unique `staff_reminders(source_ref) where source='template'` with `source_ref='<tpl>:<client>:<YYYY-MM-DD>'`.
   - Re-running the same day creates nothing.
6. **Assignee.** `tk_client_people(client)` role `assignee_role`, falling back to `bookkeeper`, then `account_manager`. Otherwise skip with `no_assignee`.
   - If the assignee has an active time off covering `due`, assign the backup and write a ledger row (C7).
   - The assignee must pass `tk_staff_has_client`. Otherwise skip with `no_access`.
7. **Insert into `staff_reminders`.** `staff_email` and `assignee_email` are set to the assignee. Also set:
   - `source='template'`, `source_ref`, `template_id`, `series_id = md5(template_id||client_id)::uuid`
   - `period_kind` (weekly gives null), `period_start`
   - `sop_section`, `review_required`, `priority`, `due_date`, `due_date_original`, `start_on = due - lead_days`
   - The title label `Mon YYYY`, `Qn YYYY`, `FY YYYY` or `Wk of Mon D`. `TT_stripPeriod`, `TT_offsetText` and `TT_nextDue` are updated for weekly and fiscal.
8. **Checklist** (`task_checklist_items`): the template checklist, then the firm `tk_sop_steps` for the `sop_section`, then the client steps. At most 50.
9. **Period row.** For monthly, quarterly and annual tasks, `insert into month_close (client_id, period_kind, period, status) values (..,'not_started') on conflict do nothing`.
10. **Summary.** After the loop, one `staff_task_batch` per assignee, then the run is written to `tk_generator_runs`.

Return value: `{created:n, by_assignee:{}, skipped:[{template,client,period,reason}], missed:[...], dry_run}`.

## E. Ask-client flow end to end

1. In the drawer, the staff member clicks **Ask client** (allowed in `todo` and `in_progress`), or uses the client header with no task.
2. `TK_AskClientModal` collects: kind, title, prompt, needs upload, due date, and recipients (portal users from `client_users`, contacts from `client_contacts`, with "Add contact" inline).
3. `rpc tk_ask_client`. The task is now `waiting_client` and the request is `open`.
4. `functions.invoke('tk-client-requests', {action:'preview'})` shows the email. **Send** calls `send`. The toast says "Dry run: nothing sent" when the switch is off.
5. Portal user: email, then login with `next`, then `#/client/<id>/needs/<reqId>`, then `ClientNeeds`. They upload through `drive-files` (request branch) and reply with `rpc tk_answer_client_request`.
6. Contact: email, then `/respond#t=..`, then `view`, then `answer` (files plus reply).
7. Either path:
   - The request becomes `answered`.
   - A `client_reply` comment lands on the task.
   - The task resumes when it was the last open request.
   - The assignee gets `staff_task_client_answered`.
8. Staff **Accept** (answered becomes accepted), or **Ask again**: a new request on the same task, which goes back to waiting.
9. Nudges run every 3 business days, at most 4. The client or contact can stop them. Staff can pause them.

Lifecycles:
- **Token:** issued, then emailed, then viewed (any number of times, rate-limited), then answered. The other endings are revoked (resend, cancel, answered sibling, staff action) or expired (14 days). Each step is logged.
- **Request:** open, then answered, then accepted. Or open, then cancelled. No deletes, only `deleted_at` by an admin.

## F. `month_close` migration SQL plan (OD3)

`tasks-p2-2-periods.sql`, one transaction, re-runnable.

0. **Pre-flight (read-only, in the slice).** Run `select count(*), count(distinct (client_id, period)) from month_close`. Then grep the live functions with `select proname from pg_proc where prosrc ilike '%month_close%'` and diff against the repo list below. Any extra function goes on the list.
1. **Backup.** `create table if not exists month_close_p2_backup as select * from month_close`. Enable RLS, `revoke all`, admin select. It is kept and never dropped in Phase 2.
2. `alter table month_close add column if not exists period_kind text not null default 'month'`. Existing rows become `'month'`. Add the C2 columns with `add column if not exists`.
3. `month_close_period_kind_check` CHECK (`period_kind in ('month','quarter','year')`), added `not valid` then `validate`, guarded by `pg_constraint`. The first-of-month CHECK stays (quarters and years also start on day 1).
4. **Primary key.** A `do $$` block reads the PK columns from `pg_constraint` (`contype='p'`) joined to `pg_attribute` in `conkey` order. If they are not `client_id,period_kind,period`, it runs `lock table month_close in access exclusive mode`, `execute format('alter table month_close drop constraint %I', conname)`, and `alter table month_close add constraint month_close_pkey primary key (client_id, period_kind, period)`. A re-run is a no-op.
5. **Same transaction.** Re-create every function with `on conflict (client_id, period)` on `month_close`. Otherwise the conflict target no longer matches a unique index and they fail at runtime.
   - `gl_review_mark_reviewed` (gl-review-1-core.sql:1265) becomes `on conflict (client_id, period_kind, period)`, with `period_kind` defaulting to `'month'` in the insert.
   - `test-clients-seed-data.sql:37` gets the same change in the file.
   - The other `on conflict (client_id, period)` sites target `gl_review_*` and `close_checks` and are unaffected.
   - Bodies come from live `pg_get_functiondef`.
6. **Add `period_kind = 'month'`** to these month-only readers (create-or-replace from live bodies):
   - `month_close_gl_review_gate`, `month_close_gl_review_reopen` (skip unless month)
   - `gl_review_baseline_from_last_print`, the check at gl-review-1-core ~1604
   - `notify_enqueue_reports_ready` (quarter and year send no client email in Phase 2, Q3)
   - `staff_performance`, `client_health` (client-health.sql 107-125)
   - `qbo-close-checks.sql` readers, `client-onboarding.sql` readers
   - `tasks-module-v1.sql` 1585-1598 and 2051-2086
7. Add the sign-off guard trigger, the RPCs and the new `tk_activity` kind `period_signed_off` (widen the CHECK, restating the live list).
8. **Clients in the same commit.** Add `.eq('period_kind','month')` to every `month_close` read or update:
   - CloseTracker.jsx 122/203/211/262/374; its done path switches to `tk_sign_off_period`
   - ClientClosePage.jsx 136/1025
   - Today.jsx 282, Onboarding.jsx 54, ClientTabCounts.jsx 205, app.jsx 6058
   - Edge functions: `qbo-gl-review/index.ts` 383/535 and `client-emails/index.ts` 356 (`.maybeSingle` would throw on 2 rows), then redeploy both.
   - Inserts rely on the default. Every `onConflict` for `month_close` becomes `"client_id,period_kind,period"`.
9. **Verify.**
   - Row count and per-row equality against `month_close_p2_backup`.
   - Run the file twice.
   - `gl_review_mark_reviewed` on `basic-test`.
   - Insert a `quarter` row for `grace-community`, confirm the month screens ignore it, then soft-revert it to `status='na'`.

## G. Asana import (12.1-12.4, OD7), file `supabase/tasks-p2-8-asana-import.sql`, runbook in this section

**Tables** (all RLS, admin select only; writes through definer RPCs or the postgres role in MCP `execute_sql`):
- `tk_import_runs(id uuid PK, source text default 'asana', snapshot_at, status text (staged, planned, applied, undone), report jsonb, applied_at, applied_by, created_at)`
- `tk_import_asana_rows(run_id uuid, kind text (user, team, project, section, task), asana_gid text, parent_gid text, project_gid text, payload jsonb, PK (run_id, kind, asana_gid))`
- `tk_import_project_map(run_id uuid, project_gid text, target_kind text (client, onboarding, internal, skip), client_id text, merged_into_gid text, confidence text, note text, PK (run_id, project_gid))`. The plan pre-fills it and the owner edits it before apply.
- `tk_asana_import_map(asana_gid text PK, kind text, local_table text, local_id text, run_id uuid, status text (created, merged, skipped), notes text, imported_at)`. This is the permanent re-run key.
- `staff_reminders`: a unique partial index on `(source_ref) where source='asana'`, with no `deleted_at` filter, so a soft-deleted import is never re-created.

**Steps:**
1. A Claude session (Opus) loads the Asana connector tools with ToolSearch: `get_users`, `get_teams`, `get_projects`, `get_project`, `get_tasks`, `get_task`, `search_tasks`.
   - It reads users (gid, name, email), teams, projects (gid, name, team, archived, created and modified dates, sections) and **incomplete** tasks per project.
   - Task fields: gid, name, notes, assignee, `due_on`, `start_on`, section membership, custom fields (Task Progress, Assignee Role), parent, `modified_at`, `permalink_url`. Open subtasks one level deep come through `get_task`.
   - `search_tasks` caps at 100, so it pages by project.
2. It writes the snapshot JSON to the scratchpad only, never the repo.
3. It inserts the snapshot into `tk_import_asana_rows` through Supabase MCP `execute_sql`, in batches of at most 200. No service key is used.
4. `select tk_import_asana_plan(:run)` fills `tk_import_project_map` with guesses and writes `report`. The session shows the owner the **dry-run report** in chat (never committed).
5. The owner corrects the map rows and says go. Then `select tk_import_asana_apply(:run, 'IMPORT <first 8 of run id>')` runs. The confirm string must match, and the caller is `is_admin()` or the postgres role.
6. Rollback: `tk_import_asana_undo(:run)` soft-deletes the rows that run created (`deleted_by='asana-undo'`). Map rows go to `skipped`.

**Mapping:**
- **Users.** `lower(email)` is matched to a staff row (active or not). The 3 users with no staff row map to the `p_fallback_email` parameter, which is the owner's address per OD7. The address is passed at apply time and never hard-coded in SQL. The Asana name goes in the description footer.
- **Teams** ("<bookkeeper>'s Clients"). Informational only. `clients.assigned_bookkeeper_email` stays the source of truth. Mismatches are reported.
- **Projects.** The name is normalized (lowercase, punctuation stripped, "monthly", "onboarding" and "- client" suffixes dropped) and matched to `clients.name` or `id`.
  - Onboarding-named projects become `onboarding`.
  - The 7 known internal names (Directors Tasks, COO-SOP, AM-SOP, Owners Tasks, COO Tasks, 90 Day, Send Reports) become `internal`.
  - About 15 projects with no team come out `skip`, low confidence, for the owner to decide.
- **New Client Onboarding tracker.** Each section, which is a client name, becomes that client's onboarding project.
- **Duplicates.** Same normalized name and same target means one `tk_projects` row from the newest `modified_at` project. Tasks are unioned and deduped on normalized title plus section, newest wins. Both gids are mapped. The client A and client B pairs are re-verified by gid in the report, because B9 saw one gid under both names.
- **Onboarding and internal** become `tk_projects` (`kind` `onboarding` with `client_id`, or `internal`). Sections become `tk_projects.sections`. Mapped assignees become `tk_project_members`. A client missing from `clients` is skipped and reported (we never create clients).
- **Tasks** become `staff_reminders`:
  - `title` (<=200), `description` (notes plus "Imported from Asana: <permalink>")
  - `due_date`, `due_date_original`, `start_on`, `section`
  - `assignee_email`, `staff_email` from the mapped user
  - `client_id` or `project_id`
  - Status from Task Progress: Not started gives todo, In progress gives in_progress, anything else gives todo with a note.
  - `source='asana'`, `source_ref=gid`, and `parent_id` for open subtasks (deeper levels flattened).
  - Comments and attachments are not imported. The permalink is kept.
- **Review-step tasks** ("Email <owner> reports to review") are imported as-is and counted in the report, then retired once the review loop is adopted.
- **Recurring tasks** (open tasks in Weekly, Monthly, Quarterly or Annual sections of client projects) become `task_templates` with `status='draft'`, `active=false`, `client_ids=[client]`, the matching cadence, `source='asana'` and `source_ref=gid`, with the subtasks as the checklist. The bookkeeper confirms each with `tk_confirm_draft_template` (C4).
- **Completed tasks are not imported** (OD7). All imports run under `mgb.tk_import`, so there are no emails.

**Dry-run report format** (`tk_import_runs.report`, shown as tables in chat):
```
{ run_id, snapshot_at,
  totals:{asana_users, mapped_users, unmapped_users, projects, client, onboarding, internal, skip,
          open_tasks, subtasks, to_create, already_imported, draft_templates, review_step_tasks},
  unmapped_users:[{asana_name, open_tasks, mapped_to}],
  duplicates:[{normalized_name, gids:[..], winner_gid, winner_modified_at, tasks_merged, tasks_dropped}],
  projects:[{gid, name, target_kind, client_id, confidence, open_tasks}],
  client_missing:[{gid, name}], warnings:[..] }
```

**Re-run and parallel run (12.4).** During November, re-snapshot weekly as a new run. The plan compares the snapshot to `tk_asana_import_map` and reports, read-only:
- new open tasks in Asana
- tasks completed in Asana but open here
- tasks done here but open in Asana
- due-date drift

Apply only ever creates unmapped gids. It never overwrites local edits.

## H. UI surfaces by role

| Surface | Bookkeeper | Admin / AM | Client |
|---|---|---|---|
| Drawer (`TK_Drawer`) | Send for review, Withdraw, Ask client, Stop waiting, request list with status, "No reply" chip | plus Approve, Send back (reason modal), Set reviewer. Self-approval is hidden and shows a tooltip. | none |
| `#/tasks/review` `TK_ReviewQueue` | own tasks in review, read-only | "Assigned to me" and "All in review", oldest first, inline Approve / Send back, review stats panel (`tk_review_stats`, `tk_on_time_stats`) | none |
| `#/tasks/waiting` `TK_WaitingList` | waiting tasks for accessible clients, business days waiting, nudges, Resend, Cancel | all clients | none |
| `#/tasks/templates` `TK_Templates` (replaces the TaskTemplates admin card) | client items, overrides, skip, confirm drafts, preview next 30 days for own clients | firm sets, standard set live switch, SOP steps, Generate now, run log, missed periods | none |
| Close tab: `CloseTracker` / `ClientClosePage` + `TK_PeriodSignOff` | Mark ready for sign-off (`status='review'`), month/quarter/year switch | Sign off (open-task warning with Acknowledge), Reopen with reason | none |
| Client profile: contacts (`TK_ClientContacts` in `TK_ClientDrawer`) | add, edit, retire contacts | same | none |
| Coverage (`Coverage.jsx`) | "Hand my tasks to backups" preview in My time off | Hand off tasks preview with overrides; return now | none |
| `#/client/<id>/needs[/<reqId>]` `ClientNeeds` | staff preview mode | same | open requests with reply and upload, answered history; Home card and bell badge counts |
| `/respond` | none | none | contact with no login: one request only |
| Sidebar `TK_Sidebar` | Review (count), Waiting (count) | same | none |

Every screen works at 760px and below: queues become stacked cards, and inline actions move into an overflow menu. Use design tokens only. CSS goes in per-component files.

Routes:
- `TK_parseRoute` and `TK_formatRoute` add `review`, `waiting` and `templates`.
- The client route uses `CLIENT_PLACES` and `CLIENT_PLACE_OF_PAGE` (app.jsx 488-517) and `access.tabs`.
- `CLIENT_RequestsPanel` (app.jsx 767) and client-mode `DocumentRequestsCard` fold into `ClientNeeds`.

## I. 14.1 / 14.2 fold (S9)

- **14.1.** Standard-set templates carry a `close_key`.
  - A Close tab checklist row for (client, month, key) reads the generated task whose `template_id.close_key = key` and `period_start = month`. The link is by key, never by title match.
  - Ticking the box calls `tk_set_status` on that task, so review still applies and a review task shows "In review".
  - Unticking reopens it. Both are logged in `tk_activity`.
  - With no task, the old `client_close_items` behavior stays. `CLOSE_CHECKLIST` remains until HomeCards and StaffInbox stop reading it.
- **14.2.** For a task with `close_key` in (`bank_feed`, `bank_rec`, `card_rec`), the drawer reads `close_checks` (read-only) for (client, period).
  - When the checks pass, it shows "Looks done. QuickBooks shows <reason text>. [Mark done]", and the button goes through `tk_set_status`.
  - No QBO write.

## J. Upkeep checklist (every slice, same commit)

- **Staff guide** (`docs/staff-guide/`):
  - New: `recurring-tasks.md`, `task-review.md`, `ask-client.md`, `client-contacts.md`, `out-of-office-handoff.md`, `period-sign-off.md`.
  - Update: `my-tasks.md`, `client-tasks-drawer.md`, `month-end-close.md`, `document-requests.md` (now client requests), `client-emails.md` (`client_request` feature, dry run), `admin-guide.md`, `bookkeeper-guide.md`, `account-manager-guide.md`, `client-portal.md`, `capacity.md` (OOO), and the guide index.
- **Tours** (`components/tour/Tour.jsx`):
  - Extend `tasksTour` with the Review and Waiting sidebar stops.
  - Admin and AM tours get a review queue stop.
  - The client tour gets a Needs page stop.
  - Add new `data-tour` anchors and re-point any moved ones.
- **Tips** (`Tips.jsx`): `tk-review`, `tk-ask-client`, `tk-waiting`, `tk-signoff`. Re-check that `tk-add` still targets the right element.
- **Help menus:** the staff ? menu links the new articles. The client ? menu adds "What we need from you".
- **README:**
  - The `components/tasks` file list (~87).
  - The Tasks module section (~655, ~1395): tables, RPCs, flags, crons (`task-templates-daily`, `client-request-nudge`, `tk-ooo-daily`), edge functions (`tk-client-requests`, `tk-request-respond` public), `/respond`, deploy order.
- **What's new and Dev Tools:**
  - Bump `window.MGB_VERSION` (index.html:205) on every slice, with a one-line note.
  - `PAGE_META` for `#/tasks/review`, `#/tasks/waiting`, `#/tasks/templates`, the client needs page and `/respond`.
  - Infra links for the 2 new functions and 3 crons.
  - Flags panel: `client_request_enabled` (owner-only toggle with a confirm dialog) and `standard_set_live`.
  - Reset keys for any new `mgb_tk_*` localStorage keys.
- **Settings.jsx:** `ST_STAFF_EMAIL_PREFS` for the 5 new kinds.
- **Announcements:** if an announcements registry exists at build time, add one entry per launch (review loop, Ask client, recurring). Otherwise use the next-visit notice plus tour pattern (feedback memory).
- **`__SOURCE_ORDER`:** register every new file. `vercel.json` gets the `/respond` rewrite and headers.

## K. Build plan (independently committable slices)

The per-slice routine:
1. Opus builds.
2. An Opus critique agent reviews the diff against this spec.
3. Haiku runs the checks: `node` tests, grep for stale `month_close`/`client_doc_requests` reads, and 760px screenshots on `basic-test` and `grace-community`.
4. Apply the SQL **twice** with MCP `apply_migration` (auto-apply is pre-approved) and run `get_advisors` (security) after each slice.
5. Commit to main and push.

| Slice | Contents | Files | Verify |
|---|---|---|---|
| S1 Calendar | C1 | `supabase/tasks-p2-1-calendar.sql`, `components/tasks/TK_recurrenceLogic.js`, `.test.js`, `TK_recurrence.fixtures.js`, index.html (`__SOURCE_ORDER`, version), README | node test green; `tk_recurrence_selftest()` returns 0 rows; RLS advisor clean |
| S2 Periods | C2 + F | `tasks-p2-2-periods.sql`, `test-clients-seed-data.sql`, CloseTracker.jsx, ClientClosePage.jsx, Today.jsx, Onboarding.jsx, ClientTabCounts.jsx, app.jsx, `TK_PeriodSignOff.jsx`, `functions/client-emails`, `functions/qbo-gl-review` (redeploy), guide `period-sign-off.md`, `month-end-close.md` | F.9; sign-off with open tasks returns `needs_ack`; a non-admin done raises; GL gate still blocks a month without approval |
| S3 Review + on-time + notifications | C3 | `tasks-p2-3-review.sql`, `TK_reviewLogic.js`(+test), `TK_metricsLogic.js`(+test), `TK_ReviewQueue.jsx`, `tk-review.css`, TK_Drawer, TK_Sidebar, TK_api.js, TK_viewLogic (routes), `functions/notification-emails` (**deploy first**), Settings.jsx, guide, tour, tips | transition matrix tests; self-approve refused; send-back email lands in the outbox within 5 minutes (test staff); on-time fixtures match `tk_on_time_stats` on seeded tasks |
| S4 Recurring | C4 + D | `tasks-p2-4-recurring.sql`, `TK_Templates.jsx`, TaskTemplates.jsx (wrapper and redirect), TT_ helpers, TK_api.js, guide `recurring-tasks.md` | `tk_generate_preview('basic-test')` is correct; real run twice creates 0 the second time; a missed period is listed and not created; weekly, quarterly-fiscal and annual cases; real clients untouched while `standard_set_live=false` |
| S5 Client requests (portal) | C5, 10.5 | `tasks-p2-5-requests.sql`, `functions/_shared/drive.ts`, `functions/drive-files` (redeploy), `components/client/ClientNeeds.jsx`, `client-needs.css`, app.jsx (`CLIENT_PLACES`, panel fold, `clientNeeds`), `TK_AskClientModal.jsx`, `TK_WaitingList.jsx`, `tk-requests.css`, DocChaser.jsx, client-health.sql, guide `ask-client.md`, `client-portal.md`, `document-requests.md` | migrated row count equals old; ids preserved; a client member of `grace-community` sees only own requests (RLS test with JWT claims); answer resumes the task; upload lands in the doc-type folder |
| S6 Tokens + email + nudges | C6 | `tasks-p2-6-tokens.sql`, `functions/tk-client-requests`, `functions/tk-request-respond` (`--no-verify-jwt`), `functions/client-emails` (job + **deploy before** the CHECK widening), client-emails.sql (whitelist, cron), `respond.html`, `respond.js`, vercel.json, `TK_ClientContacts.jsx`, Dev Tools flag, guide `client-contacts.md`, `client-emails.md` | dry run on a real client sends nothing (`client_email_log` skipped); a test client `[Test]` reaches the caller only; full link flow on `basic-test`; 404/410/429 paths; token hash only in DB; events logged; `client_request_enabled` stays false |
| S7 OOO | C7 | `tasks-p2-7-ooo.sql`, Coverage.jsx (`CV_MyTimeOffBody`, Coverage tab), staff-time-off.sql (helper refactor), guide `out-of-office-handoff.md`, `capacity.md` | dry run lists the move and skip sets; `ready_for_review` untouched; cancel returns tasks; roll-forward after `ends_on` goes back to the owner; one summary email each |
| S8 Asana tooling + dry run | G | `tasks-p2-8-asana-import.sql`, this spec's runbook section | snapshot staged; plan report shown to the owner; **apply not run**; `undo` tested on a 2-task synthetic run against `basic-test` |
| S9 Fold 14.1/14.2 | I | CloseTracker.jsx, ClientClosePage.jsx, TK_Drawer, TK_api.js | checkbox and task stay in sync both ways; suggestion only with a passing `close_checks` |
| S10 Final verify | all | none | Opus end-to-end on test clients and a Sonnet guide sweep against J |

The order is S1 to S10. S3 and S5 may swap. S6 needs S5. S8 can run after S4 in parallel with S5-S7. Turning on `standard_set_live` and `client_request_enabled`, and the real Asana apply, are owner actions after S10.

## L. Risks and open questions

**Risks:**
- R-a. **The key change breaks unseen conflict targets.** Mitigated by the F.0 live `pg_proc` diff and by re-creating functions in the same transaction.
- R-b. **CHECK and deploy order** (R24/R25). Deploy the function first, restate live lists, and update all 4 defining files.
- R-c. **Double tasks during the parallel run.** The standard set stays draft until the Asana apply. Draft confirmation marks covered periods as issued.
- R-d. **Public endpoint.** Covered by the threat model in C6. Residual: a forwarded link lets a third party answer one request. Staff Accept is the backstop.
- R-e. **Reports-ready email (R8)** now fires only through sign-off. Clients who got it on a bookkeeper "done" will see a delay until an admin signs off.
- R-f. **Review bottleneck.** Every review task needs an admin other than the assignee. The queue shows age so this is visible.
- R-g. **No real roster (R13).** All tests run on `basic-test` and `grace-community`. Behavior on real volume is unproven until the parallel run.
- R-h. `client_doc_requests` repointing touches 7+ readers. A missed reader shows stale counts. The Haiku grep sweep covers it.

**Open questions (owner):**
- Q1. Is the account manager always an admin? If not, the default reviewer falls back to "any admin". Should AMs who are not admins be able to approve? D1 says admins only.
- Q2. Quarterly periods: fiscal quarters (spec default `period_basis` per template) or always calendar?
- Q3. Should quarter or year sign-off email the client a "reports ready" notice? The spec says no in Phase 2.
- Q4. Admin-owned review tasks need a second admin. Is that OK for the owners' own tasks?
- Q5. OOO apply: manual (spec) or automatic N days before the time off starts?
- Q6. Firm-closed days beyond Federal Reserve holidays (Christmas Eve, Good Friday?) for `tk_holidays`.
- Q7. Token TTL of 14 days, nudge cap of 4, and a 7-day generator catch-up grace: confirm.
- Q8. For contacts, is the per-request "Stop reminders" link enough, or do they need a client-wide opt-out?
- Q9. Asana: confirm the 3 fallback users by name in the report, the client A / client B gid pairing, the targets for the ~15 projects with no team, and the Task Progress to status mapping.
- Q10. When does DocChaser retire? The spec keeps the job, repointed, as the doc nudge path until `client_request_nudge` is live.
