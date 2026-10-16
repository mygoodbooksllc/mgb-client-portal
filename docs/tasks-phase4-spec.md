# Tasks Phase 4 spec: power-user features

Status: SPEC ONLY (2026-10-16), self-critiqued and fixed (docs/tasks-phase4-critique.md). No code, no SQL applied. Base: origin/main be7bde7 (Tasks p3 Manage projects + review fixes; tk_schema_version() = 10 live).
Size: **Big** (multi-file, permissions, outbox emails, SQL). Models: Opus writes spec, server slices, critiques and final verify; Sonnet builds UI-only slices; Haiku runs screenshot sweeps, grep and lint checks.

Parallel builds this spec must NOT duplicate:
- **wt-workbench**: Workbench drawer + Today page (`components/workbench/*`, `wb_inbox`, `wb_item_state`, `wb_snooze`, keys j/k/Enter/o/s/e/1-6/0/? inside Workbench, W toggles drawer). W1 SQL (`wb_item_state`) is already live.
- **wt-subcolor**: inline subtask expand + project colors (TK_TaskRow, TK_List, TK_MyTasks, TK_Sidebar, project color column).

Every Phase 4 slice starts only after the slice it depends on has merged to main, and rebases on main first.

---

## 0. Critical view: what to cut, merge or shrink

Code reading found that 5 of the 15 approved items already exist in some form. Building them "fresh" would duplicate code and confuse staff.

| # | Feature | What exists today | Verdict |
|---|---|---|---|
| 1 | Quick add (Q, plain words) | `TK_QuickAddHost` is global (app.jsx ~30560), `q` opens it from any page, TopBar "+" opens it, client pages pass `client_id`. `TK_parseQuickAdd` (TK_logic.js:581) handles `@person`, `#client-slug`, `!high/!low`, date words. | **Shrink.** Only add the plain-words parser (no symbols) + default project from the current page. Small Sonnet slice. |
| 2 | Bulk actions | Nothing. | **Build, merged with Undo** (one server op log serves both). |
| 3 | Snooze | `start_on` exists but is shared and hides nothing. Workbench has per-user `wb_item_state` + `wb_snooze` (30-day cap). | **Merge into Workbench storage.** Task snooze writes `wb_item_state` with key `task:task:<id>`; no new table. My Tasks and Workbench then agree. |
| 4 | Saved filters pinned in sidebar | Nothing. `TK_applyFilters` (TK_viewLogic.js:314) already takes a filter object. `user_settings.settings` jsonb (≤16 KB) exists. | **Build, no migration.** Pair with Snooze (same list/sidebar files). |
| 5 | Close checklist ↔ tasks (Phase 2 items 14.1/14.2) | Spec'd in tasks-phase2-spec.md section I, never built (old slice S9 was repurposed). `task_templates.close_key` + standard set exist (drafts, gated by `standard_set_live`). | **Build. Highest risk** (three sources of month-end tasks, see 2.5). |
| 6 | Client page strip | `TK_ClientStrip` (TK_ClientDrawer.jsx:108, mounted app.jsx ~29778) already shows open count, next task and a tick. | **Shrink.** Add waiting-requests count + next due date only. |
| 7 | Time-to-close per client per month | `month_close.ready_at` and `signed_off_at` exist. | **Build as read-only RPC + small report.** No new table. Pair with client strip. |
| 8 | Next-3-dates preview for templates | **Already built**: `TK_tplNextList` (count 3) in the template editor (~760) and client item editor (~1045). | **Cut.** Optional 1-line polish (show next date on template list rows) rides along with any later Templates touch. |
| 9 | Daily digest (email or in-app card) | Email: notification-emails `task_due` job (cron `30 11 * * *` UTC, direct send, dedupe via `client_email_log` feature `staff_task_due`) already emails tasks due today, PREF `task_due` default off (0 users have it on). In-app: the Workbench drawer + Today page IS the in-app card. | **Email only, by extending `task_due` in place** (same PREF key and log feature, relabeled "Morning summary"). Cut the in-app card (redundant with Workbench). |
| 10 | At-risk flag | Nothing. | **Build** as one SQL function reused by lists, digest and Workbench. Pair with workload. |
| 11 | Workload view | `TeamCapacity.jsx` (admin, hours). Admin People list in Tasks sidebar links `#/tasks/u/<staffId>`. | **Shrink.** One counts RPC; show counts in the existing People list + a column on Capacity. No new page. |
| 12 | Comments with @mentions | **Already built**: `TK_Comments` @ autocomplete, `tk_parse_mentions`, outbox `staff_task_mention` (PREF `task_mention`, on), TopBar bell shows 14 days of mentions. | **Cut from Phase 4.** The only gap is a "mention" row type in Workbench `wb_inbox`. Hand to the Workbench build (W follow-up), not here. |
| 13 | Universal Undo toast | `TK_vToast(text, {label,onClick})` exists; used for Undo on project trash. No Undo for complete/reassign. | **Build with Bulk** (same op log). |
| 14 | Keyboard shortcuts everywhere + ? sheet | List keys j/k/Enter/x(mark done)/s(status)/a/q/? + `TK_KeysSheet` in Tasks only (TK_KEYMAP TK_logic.js:762, TK_vLIST_KEYS TK_viewLogic.js:376). Workbench adds its own keys. ~23 separate keydown listeners across app.jsx and components. | **Shrink.** One small registry + one global `?` sheet that lists what exists. Do it LAST (after Workbench) so it documents real keys. |
| 15 | Lean mobile check-off view | Workbench gives phones a full-height sheet with tick/snooze. | **Defer (recommend cut).** Revisit after Workbench phone sheet is in use for 2 weeks. If still wanted: CSS-only phone mode of My Tasks, no new route. |

Net: 15 asks become **8 slices** (P4-1..P4-8). Two cut (next-3 preview, in-app digest card), one handed to Workbench (mention row), one deferred (mobile view).

---

## 1. Global rules for every Phase 4 slice

1. **Email:** nothing in Phase 4 emails a client. The only new email is the staff morning digest (P4-7). It goes through `notification_outbox` → `notification-emails` like every other staff email, has a PREF key, respects existing access/test/internal-client rules, and dedupes. Any later feature that could reach a client must check `tk_settings.client_request_pilot` (pilot switch) and stay off until the owner sets it. Bulk and Undo never send client emails; bulk reassign sends one batched staff email per person.
2. **RLS:** every new table: `alter table ... enable row level security; revoke all on ... from anon, authenticated;` then grant only via SECURITY DEFINER RPCs with `set search_path = public, pg_temp`. Every RPC checks `is_active_staff()` first, then per-row `tk_can_edit_task(id)` / `tk_can_read_task(id)` / `can_access_client(client_id)`. RPCs are `revoke execute ... from public, anon; grant execute ... to authenticated`.
3. **Re-runnable SQL:** `create table if not exists`, `create or replace function`, `drop trigger if exists` + `create trigger`, `add column if not exists`. Each slice ships `supabase/tasks-p4-N-<name>.sql` + `-tests.sql` (BEGIN ... ROLLBACK with asserts). Apply twice, then `get_advisors` (security + performance).
4. **Soft deletes only.** Undo "delete" = clear `deleted_at`. Nothing hard-deletes.
5. **QBO stays read-only.** 14.2 only reads `close_checks`.
6. **Schema probe:** each SQL slice bumps `tk_schema_version()` (11, 12, ...). The UI hides the feature when the probe is lower, so UI can ship before or after SQL safely.
7. **tk_tasks view:** new staff_reminders columns are appended at the END of the explicit column list (latest definition: tasks-p2-10-asana-import-v2.sql:55). `create or replace view` fails if columns move.
8. **Live bodies:** before replacing any existing function (notably `notify_enqueue_task_assigned`, `complete_staff_item`, `tk_set_status`, `tk__generate`), read the live body with `pg_get_functiondef`. Repo files differ from live.
9. **Session flags:** new flags `mgb.tk_bulk`, `mgb.tk_undo`, `mgb.tk_close` set with `set_config(..., true)` (transaction-local) only inside the owning RPC or SECURITY DEFINER trigger, and reset to '' right after the guarded write so later statements in the same transaction are not exempted.
11. **Schema probe numbering:** `tk_schema_version()` is 10 live; wt-subcolor's `tasks-p3-project-colors.sql` does not bump it. Whichever slice lands first after subcolor takes 11; each later SQL slice takes the next number at rebase time (never hard-code in the spec).
10. **No PII in repo** (tests use test/internal clients and fake emails). US spelling (color).

---

## 2. Feature specs

### 2.1 Quick add: plain words (P4-1)

**Data/migration:** none.

**Parser** (`TK_parseQuickAdd` in TK_logic.js, pure, unit-tested): keep current symbol syntax; add plain-words patterns, each only when unambiguous:
- Assignee: `for <name>`, `to <name>`, `assign(ed)? (to)? <name>` where `<name>` matches exactly one active staff first name or full name (case-insensitive). `me` → current user.
- Client: a trailing or leading phrase that matches exactly one client display name or slug the user can access, with at least 4 characters, and only when preceded by `for`, `re`, `client` or a dash (`Bank rec - Acme`). Bare words in the middle of a title are never treated as a client.
- Due: existing date words + `by <date word>`, `due <date word>`, `on <weekday>`, `next week` (Monday), `end of month`, `eom`.
- Ambiguity rule: if a name matches 2+ staff or 2+ clients, leave the words in the title and show a chip "Did you mean ...?" with options. Never guess silently.

**UI:** TK_QuickAdd.jsx shows parsed chips under the input (client, assignee, due, priority) with an x on each to undo that parse (the words go back into the title). Default client from the current client page (already passed); default project from the current project list (`#/tasks/p/<id>`) via the existing `tk:quick-add` event detail.

**Access:** create goes through the existing create path; RLS unchanged. Assignee list limited to active staff; client list limited to clients the user can access (already loaded in the store).

**Edge cases:** names that are also English words ("Will", "May", "Grace"): only parse after `for/to/assign`. Date words inside titles ("Monday deposits"): only parse when at the end or after `by/due/on`. Client names with dashes. Empty title after parse → keep the original text as the title.

**Privacy:** staff-only. No client sees quick add.

### 2.2 Close checklist linked to tasks (P4-2, Phase 2 items 14.1 + 14.2)

Uses the existing generator and `close_key`. No parallel task creator.

**Why the generator needs a change (critique B1):** all six standard-set templates are `status='draft'`, `tk__generate` only selects `active and status='active'`, and the set gate `continue`s at template level before the client loop unless `standard_set_live` is on or the call names a test/internal client. So today a per-client flag would never be reached by the daily cron.

**Data model / migration (`tasks-p4-2-close-link.sql`):**
- New table `tk_client_close_optin (client_id text pk references clients, enabled_at timestamptz not null, enabled_by text not null, include_current_month boolean not null default false, disabled_at timestamptz, disabled_by text)`. RLS on; `revoke all from anon, authenticated`; `grant select to authenticated` with policy `is_active_staff() and can_access_client(client_id)`. Written only by `tk_set_close_optin(p_client_id, p_enabled, p_include_current boolean default false)` (SECURITY DEFINER; admin, or account manager of that client). Not a column on `client_profile`: its RLS lets any staff with access write it directly (critique M5). Turning off sets `disabled_at/by` (soft, never delete); turning back on clears them and stamps a new `enabled_at`. "Opted in" = row exists and `disabled_at is null`.
- `staff_reminders.close_key text null` (add column if not exists). BEFORE INSERT trigger stamps it from `task_templates.close_key` when `template_id` is set. Appended to the END of the `tk_tasks` view column list.
- Unique partial index `uq_close_task (client_id, period_start, close_key) where close_key is not null and deleted_at is null and parent_id is null`. A collision inside `tk__issue_period` is swallowed by its `exception when others` and returns `skipped`; tests expect `skipped`, not an error.
- Generator (`tk__generate`, replaced from the LIVE body): move the set gate inside the client loop: a set member generates for a client when `standard_set_live` OR the client is in `tk_client_close_optin` OR the call names a test/internal client. Activation floor per client: `greatest(template activation, set live_since, opted-in month)` so the first run does not log every earlier period to `tk_generate_missed`. Current month generates only when `include_current_month` was ticked at opt-in.
- Activate the five linked members (`bank_feed`, `bank_rec`, `card_rec`, `entries`, `review`): set `status='active', active=true`. Because the gate stays closed for non-opted clients, activation alone creates nothing. Keep `sent` as draft forever: it auto-ticks from Send reports (app.jsx:6122). The GL "Ledger reviewed" step stays GL-owned.
- Scope: monthly only. `client_close_items.period` is 'YYYY-MM' and the templates are monthly. Quarterly `month_close` rows (stored by quarter start month) are not linked in Phase 4.

**Sync rules (both directions, loop-safe):**
- `tk_close_tick(p_client_id, p_period text 'YYYY-MM', p_item_key, p_done bool) returns jsonb {status, linked_task_id, message}` (SECURITY DEFINER, staff with `can_access_client`). If no live linked task: write `client_close_items` as today. If linked, by current task status:
  - todo / in_progress + tick: `tk_set_status(task,'done')` (review_required diverts to `ready_for_review`; message "Sent for review").
  - waiting_client + tick: no change; message "Waiting on the client. Close the request first." (the request guard would raise `tk_has_open_requests`).
  - ready_for_review + tick: no change; message "In review". + untick: `tk_withdraw_review` only if the caller is the submitter, else message.
  - done + tick: no-op. done + untick: `tk_set_status(task,'todo')`; when the task was approved and the caller is not admin, return message "Ask an admin to reopen" (before_write raises `tk_forbidden`).
  - Every path catches the known error codes and returns a message; never raises to the UI for a state it can't change.
- AFTER UPDATE OF status trigger on staff_reminders (`close_key` not null), SECURITY DEFINER: set `mgb.tk_close`, upsert `client_close_items.done` = (status = 'done') and `done_by`/`done_at`, reset the flag. `ready_for_review` leaves it unticked; the UI shows "In review". Reopen unticks. Writes a task activity note "Close checklist updated".
- Guard trigger on `client_close_items` BEFORE INSERT/UPDATE: if a live linked task exists and `mgb.tk_close` is not set, raise `tk_use_close_tick`. Existing direct writers must switch to `tk_close_tick`: app.jsx:5820 (`setCloseItem`), app.jsx:6618, app.jsx:7492, ClientClosePage.jsx:1134, StaffInbox.jsx:778. `sent` and GL steps are never linked, so their writers are untouched.
- Soft-deleting the linked task unlinks (the guard and RPC look only at live tasks).

**14.2 "Looks done" suggestion:** read-only. `close_checks` keys are `bank_active`, `reconciled`, `uncategorized`, `undeposited`. Map: `bank_feed` ← `bank_active` and `uncategorized` both ok; `bank_rec` ← `reconciled` ok. Nothing maps to `card_rec`, so no suggestion there. When the mapped checks pass for that client/period, the checklist row and the task drawer show "Looks done. QuickBooks shows <check label>. [Mark done]". Mark done calls `tk_close_tick`. Never auto-ticks.

**UI surfaces:** ClientClosePage / CloseTracker checklist rows show the linked task's assignee + status chip and open the task drawer on click; ticking calls `tk_close_tick` and shows its message as a toast. Task drawer shows "Close checklist: <item>, <month>" link back. Client Tasks settings: toggle "Create month-end tasks from the Close checklist" (admin or that client's AM; others see it read-only).

**Overlap warning (the main risk):** month-end work can come from (a) this standard set, (b) 749 imported Asana draft templates (inactive), (c) hand-made tasks. When turning the toggle on, show "This client has N recurring templates that look like month-end work (bank rec, reconcile, close). Turn them off or you may get duplicates." with a link to the client's templates. Match by `close_key` or title words (rec, reconcil, bank, card, close). Same warning when activating an Asana draft for an opted-in client.

**Edge cases:** opt-in mid-month (next month unless "also this month"); task reassigned (no checklist effect); month reopened (`month_close.reopened_*`) does not reopen tasks; opt-out keeps existing tasks and links, stops future months.

**Privacy:** checklist and tasks are staff-only. Client-facing close status (HomeCards "month closed") is unchanged and still reads `month_close` only.

### 2.3 Undo op log + bulk actions (P4-3)

**Data model (`tasks-p4-3-bulk-undo.sql`):**
```
tk_undo_ops (
  id uuid pk default gen_random_uuid(),
  actor_email text not null,
  kind text not null check (kind in ('complete','reopen','delete','reassign','move_project','set_due')),
  task_ids uuid[] not null,
  before jsonb not null,           -- [{id, status, assignee_email, project_id, due_date, recurrence, deleted_at, updated_at_after}]
  spawned_ids uuid[] default '{}', -- roll-forward rows created by complete
  outbox_ids bigint[] default '{}',-- notification_outbox ids enqueued by the op (id is bigint identity)
  created_at timestamptz default now(),
  expires_at timestamptz default now() + interval '10 minutes',
  undone_at timestamptz
)
```
RLS on, revoke all; only RPCs touch it. Cleanup: each bulk RPC call first deletes this actor's rows older than 1 day (log rows, not user data; documented hard delete). No new cron.

**RPCs (all SECURITY DEFINER, staff only; each row in its own `begin ... exception when others` block; returns per-row results; one bad row never aborts the batch):**
- `tk_bulk_update(p_ids uuid[], p_patch jsonb) returns jsonb {op_id, done:[ids], skipped:[{id,reason}]}`. `p_ids` ≤ 100. Allowed patch keys only: `assignee_email`, `project_id`, `due_date`, `due_shift_days`. Each row must pass `tk_can_edit_task`; project must be visible; assignee must be active staff.
- `tk_bulk_complete(p_ids uuid[])` (critique B2): NOT via `tk_set_status` (from ready_for_review it would call `tk_approve`, silently approving others' work; done→done raises; it discards the roll-forward id). Instead, per row by status:
  - todo / in_progress, review not required: call `complete_staff_item(id, true, today)` directly; it returns the new roll-forward uuid, stored in `spawned_ids`.
  - todo / in_progress, review required: `tk_set_status(id,'done')` (diverts to ready_for_review); reported as "sent for review".
  - ready_for_review: skip, "in review: approve it in Review".
  - waiting_client: skip, "waiting on client".
  - done: skip, "already done".
- `tk_bulk_reopen(p_ids)` for done → todo (admin needed for approved rows; others skipped with reason).
- `tk_bulk_delete(p_ids)` soft delete.
- Single-row actions (tick, delete, reassign in drawer and row) call the same RPCs with one id, so every action gets an `op_id` for Undo.
- `tk_undo(p_op uuid)`: only `actor_email`, only before `expires_at`, only once (sets `undone_at`). Per row: revert only if the row's `updated_at` still equals `updated_at_after` (the before_write trigger bumps `updated_at` on every UPDATE); else skip "changed since". Complete undo: reopen row, restore `recurrence`, soft-delete each spawned row only if untouched (`updated_at = created_at`, no comments, no subtasks, no checklist items). Outbox: `update notification_outbox set status='skipped', reason='undone', processed_at=now() where id = any(outbox_ids) and status is null`. Rows already sent (cron runs every 5 min, inside the 10-min window) stay sent; the toast then says "Undone. Ann was already emailed."

**Assignment emails during bulk:** the RPC sets `mgb.tk_bulk` (and resets it). `notify_enqueue_task_assigned` (replaced from the LIVE body, keeping its tk_generate / tk_ooo / tk_import / self-assign checks) returns early when `mgb.tk_bulk` is set, and also when a new `mgb.tk_rollforward` flag is set (today a spawned roll-forward row can enqueue `staff_task_assigned`). No custom batch email (critique M3): the RPC enqueues one normal `staff_task_assigned` row per task, only for tasks that pass `tk_staff_has_client` and are not test/internal clients (same D3 guards), and the existing per-run grouping in notification-emails (index.ts:443-450, per kind + recipient + client) already sends one email per person per client. Ids go into `outbox_ids`. This avoids the 4 KB payload cap (`tk__enqueue` silently swallows check_violation).

**UI:**
- Multi-select in TK_List / TK_MyTasks: checkbox appears on row hover and when any row is selected; Shift+click range; `v` toggles selection on the focused row (`x` stays "mark done", `s` stays "status"). Sticky bulk bar: "N selected · Complete · Reassign · Move to project · Due date · Delete · Clear". Esc clears.
- After any action: `TK_vToast("7 tasks completed", {label:"Undo", onClick})`, visible 10 s. Ctrl/Cmd+Z undoes the last op only while its toast is visible, and never when focus is in an input, textarea or contenteditable. Mixed results: "5 completed, 1 sent for review, 2 skipped". Clicking "2 skipped" lists reasons.
- Undo toast also on single tick, single delete, single reassign (project trash keeps its own existing undo).

**Edge cases:** selection across clients the user can't edit (skipped); selection including subtasks and their parent (apply to selected rows only, never cascade); realtime: other viewers see changes via existing TK_sync.

**Privacy:** staff only. Bulk cannot change `client_id` and never touches client requests.

### 2.4 Snooze + saved filters (P4-4)

**Snooze (no new table):** reuse Workbench `wb_item_state` and `wb_snooze(p_item_key text, p_version text, p_until timestamptz)` (SECURITY DEFINER, reads the JWT email, 30-day cap, `wb_unsnooze` exists). Key `task:task:<id>`; version exactly `status || '|' || coalesce(due_date::text,'')` (Workbench's rule; My Tasks builds the same string client-side in TK_viewLogic.js with a unit test that matches WB_logic). A status or due-date change wakes the task.
- Thin wrapper `tk_snooze_task(p_task_id uuid, p_until timestamptz)` checks `tk_can_read_task`, builds key and version server-side, and clamps: when `due_date > today` (America/Chicago), `p_until` is clamped to the end of the day before the due date; when the task is due today, overdue or undated, any date up to Workbench's 30-day cap is allowed. Then calls `wb_snooze`.
- My Tasks hides snoozed rows by default; "Snoozed (N)" toggle at the bottom shows them with "until Tue Oct 21" and Unsnooze.
- Snooze menu on the row (`z` key; `s` stays "status") and in the drawer: Tomorrow, Next Monday, Next week, Pick date.
- Personal only: hides it for me, never for the assignee or admins. Overdue counts in the sidebar still count snoozed tasks.
- Known gap: a sent-back task appears in Workbench as `review:task_sent_back:<id>`, so a task snooze does not hide that Workbench row (snoozing it in Workbench works as today). Documented in the guide.

**Saved filters (no migration):** stored in `user_settings.settings.tk_saved_filters` = array of `{id, name, pinned, filter:{assignee, statuses, projectId, clientId, due:'overdue|today|week|none', showDone}}`, max 20, name ≤ 40 chars. Written only through the existing Settings store (Settings.jsx: whole-object debounced upsert ~209, cross-tab adopt ~230, refresh ~240), never a separate upsert. Across two devices the last write wins (documented). Size: largest settings value live is ~1.4 KB against the 16 KB CHECK; guard before save anyway.
- "Save view" in the list header saves the current `TK_applyFilters` input. Pinned views show in TK_Sidebar under "My views" and route to `#/tasks/v/<id>`.
- Rename, unpin, delete in a small menu. Personal only.
- A view pointing to a deleted project or a client the user lost access to shows "Project removed" and falls back to all.

**Privacy:** staff-only, personal.

### 2.5 Client strip additions + time-to-close (P4-5)

**Client strip (TK_ClientStrip):** add "N waiting on client" from the existing `tk_waiting_on_client(p_client_id)` (requests with status `open`, not deleted, not legacy doc requests) and "Next due: <date> <title>". Optional third chip "Close: Sep in review" from `month_close`. No migration.

**Time-to-close RPC `tk_close_times(p_client_id text default null, p_from date, p_to date)`** (read-only, SECURITY DEFINER, `can_access_client` per row; admins see all, staff see their clients):
- Per client per month: `bk_days` = business days (`tk__business_days_since` helpers) from period end to `ready_at`; `total_days` = to `signed_off_at`; null when not reached. Uses current stamps and flags `reopened`.
- UI: a "Time to close" table on the client's Close page (last 12 months) and an admin firm view in Reports (client rows × month columns, median row). Live data: 0 signed off today, so show an empty state that says so.

**Privacy:** staff only. Never shown on client pages (this measures us, not them).

### 2.6 At-risk flag + workload counts (P4-6)

**Not a view column** (critique M8: `tk_tasks` is read by every list; a per-row subquery over checklist, comments and activity on ~1,133 open rows slows every read). Instead:

**`tk_at_risk_ids(p_assignee text default null) returns setof uuid`** (SECURITY DEFINER, rows filtered by `tk_can_read_task`), merged client-side into list rows. It first narrows to open rows with a due date inside the window (indexed on status, due_date, assignee_email), then checks the rest. Definition (thresholds in `tk_settings`, see owner decision D3):
- status todo or in_progress (not waiting_client, not in review, not done),
- due within `at_risk_days` business days (default 3) or overdue by ≤ 2 days,
- has subtasks or checklist items, < 50% complete,
- no subtask/checklist tick, status change or comment in the last `at_risk_idle_days` business days (default 2).

**UI:** small amber "At risk" chip on TaskRow (fits subcolor's row layout), an "At risk" quick filter in My Tasks, and the count in the digest (P4-7). Workbench can call the same RPC later.

**Workload RPC `tk_workload_counts()`** (admin or account manager see everyone; others get only their own row): per active staff: open, overdue, due this week, at risk, in review (waiting on them as reviewer), waiting on client. Shown next to each name in the TK_Sidebar People list (admin) and as a column group on TeamCapacity. No new page.

**Performance:** tests include `explain analyze` on live-size data; target < 50 ms for each RPC.

**Privacy:** staff only; workload for others visible to admins/AMs only.

### 2.7 Morning digest email (P4-7)

**Extend the existing `task_due` job in place** in `supabase/functions/notification-emails` (index.ts ~301-392; cron `notification-task-due` `30 11 * * *` UTC). Keep PREF key `task_due` (default off; 0 users have it on, so no carry-over needed) and keep the `client_email_log` feature `staff_task_due` for the 20-hour dedupe (critique B3: a new feature name is rejected by the live CHECK and the error is only console-logged, so dedupe would silently fail and resend every run). No outbox kind, no CHECK change. Relabel the pref in Settings (`ST_STAFF_EMAIL_PREFS` + PREF map index.ts:46-63) as "Morning summary of my tasks".

Timezone: the function computes "today" in America/New_York (index.ts:34). The job keeps that for this slice (one zone for the whole function); email says the date, not a clock time. Owner decision D2 picks the send time; the cron stays 11:30 UTC unless changed.

Content per staff member (only tasks they can access; existing access, test and internal-client rules):
1. Overdue (assigned to me), max 10 + "and N more".
2. Due today (max 15, existing cap).
3. At risk (from P4-6; section hidden until `tk_schema_version()` reaches P4-6's number).
4. Waiting for my review (count + top 5).
Cut from the digest (critique): client replies and mentions. Both already send immediate emails that are on by default, and client message text must not be copied into a digest email.
Skip sending when all sections are empty. Links open the app; titles and client names only, no amounts.

**Email rules:** staff recipients only (active staff emails). Never a client. The pilot switch is irrelevant because no client is addressed; a test asserts recipients ⊆ active staff. Cron context has no `auth.email()`, so every query is explicit per recipient.

### 2.8 Global shortcuts registry + ? cheat sheet (P4-8)

**After Workbench and P4-3 land.** `components/shared/MGB_keys.js`: a tiny registry `MGB_registerKeys(scope, [{key, label, when}])` that existing handlers call to *declare* their keys (they keep handling them). A single global `?` (Shift+/) handler, ignored in inputs/contenteditable and when another `?` sheet (Tasks TK_KeysSheet, Workbench) is open, opens `MGB_KeysSheet` listing Global (q quick add, w Workbench drawer, t client's tasks, Cmd/Ctrl+K search, ? this sheet, Esc close) plus the current page's scope.
- Tasks list `?` keeps its sheet but renders from the registry (one source; TK_KEYMAP TK_logic.js:762 becomes the Tasks scope).
- Reserved, do not reuse: q, w, t, j, k, x, s, a, e, o, v, z, 0-6, Cmd+K, Cmd+Z.
- Optional `g` sequences (`g` then `t/m/c/h` within 1 s: Go to Tasks / My Tasks / Clients / Home) only as two-key sequences, because bare `t` already fires; default: include them.
- Budget: ~23 keydown listeners exist; the slice only adds declare calls, it does not refactor them.


## 3. Slice plan (ordered; each ships on its own)

Per-slice routine (from Phase 2 section K): rebase on main → build → Opus critique (fresh agent, model and effort set) → fix → Haiku checks (screenshots light/dark + phone width, grep for leftovers, `node` unit tests) → apply SQL twice + run tests file + `get_advisors` → upkeep in the SAME commit → commit + push to main → announce.

Upkeep checklist (every slice, same commit): staff guide article (docs/staff-guide + sync to `staff_guide` table, upserts only) · tour step + `ANN_REGISTRY` announcement (components/tour/announcements.js) · tips (Tips.jsx + tips.md; re-point targets if layout moved) · help menus (? menu entries) · README feature list · whats-new · Dev Tools: bump `window.MGB_VERSION` (index.html:205), INFRA_LINKS, flags, resettable localStorage keys, PAGE_META · Usage Stats labels for new events/routes.

| Slice | Features | Build model / effort | Critique | Cost | Depends on |
|---|---|---|---|---|---|
| **P4-1** | Quick add plain words | Sonnet / medium | Opus / medium | S | subcolor merged (it edits TK_viewLogic/TK_store); upkeep files after Workbench |
| **P4-2** | Close checklist ↔ tasks (14.1 + 14.2) | Opus / high | Opus / high | L | subcolor + Workbench merged (app.jsx, StaffInbox.jsx); owner D1 |
| **P4-3** | Undo op log + bulk actions | Opus / high | Opus / high | L | subcolor merged (row checkbox); after P4-2 (TK_api.js) |
| **P4-4** | Snooze (via wb_item_state) + saved filters | Sonnet / medium (UI) + Opus / medium (`tk_snooze_task` wrapper) | Opus / medium | M | Workbench merged (wb_snooze contract); after P4-3 |
| **P4-5** | Client strip additions + time-to-close | Opus / medium (RPC) + Sonnet / medium (UI) | Opus / medium | S-M | subcolor merged (TK_ClientDrawer.jsx); after P4-2 (ClientClosePage) |
| **P4-6** | At-risk + workload counts | Opus / high (SQL RPCs) + Sonnet / medium (UI) | Opus / medium | M | P4-3, P4-4 (shared row/list files) |
| **P4-7** | Morning digest email | Opus / high (edge fn + email) | Opus / high | M | P4-6 for at-risk section (optional guard) |
| **P4-8** | Global shortcuts registry + ? sheet | Sonnet / medium | Opus / low | S | Workbench + P4-3 merged (final key list) |

Owner's suggested order (quick add, Close checklist, bulk) is kept for the first three. Nothing in Phase 4 can start until wt-subcolor merges (it touches TK_api, TK_viewLogic, TK_store, TK_ClientDrawer, TK_TaskRow, TK_List, TK_MyTasks, TK_Sidebar, TK_ManageProjects, tk-views.css). Every slice also edits upkeep files that wt-workbench edits (Tour.jsx, Tips.jsx, announcements.js, index.html, README, staff guide), so each slice rebases after Workbench lands.

### Per-slice detail

**P4-1 Quick add plain words**
- Files: components/tasks/TK_logic.js (+ TK_logic.test.js), TK_QuickAdd.jsx, app.jsx (only if the project default needs the event detail; likely not), docs.
- Conflicts: low. TK_logic.js is not touched by Workbench or subcolor; check subcolor didn't edit `TK_parseQuickAdd`.
- Tests: ≥ 25 parser cases (each pattern, ambiguity, words-as-names, dates in titles, `me`); manual: Q on a client page, project page, Today page.
- Upkeep: guide "Quick add" section update, tip on the + button, announcement "Quick add understands plain words" with 2-step tour, whats-new, MGB_VERSION.

**P4-2 Close checklist ↔ tasks**
- Files: supabase/tasks-p4-2-close-link.sql (+tests; replaces `tk__generate` from LIVE body; activates 5 set members); TK_api.js (`closeTick`, `setCloseOptin`); app.jsx (setCloseItem ~5820, writers ~6618 and ~7492 route to RPC; CLOSE_CHECKLIST ~5593 rows show task chip); ClientClosePage.jsx (~1134 writer); StaffInbox.jsx (~778 writer); CloseTracker; TK_Drawer.jsx (back link); client Tasks settings toggle; TK_Templates.jsx (overlap warning).
- Conflicts: **app.jsx** and **StaffInbox.jsx** (Workbench edits both: rebase after Workbench lands, keep edits inside the close-item call sites); TK_api.js (P4-3 also edits: P4-2 merges first).
- Tests: SQL: cron run (`p_client_id` null) generates for an opted-in client and not for others; activation floor writes no `tk_generate_missed` rows for earlier periods; include_current_month on/off; tick on todo → done; review_required → ready_for_review, checklist stays unticked + "In review"; tick on waiting_client, done, ready_for_review returns a message and changes nothing; untick approved task as non-admin returns "Ask an admin"; direct write to a linked item rejected (`tk_use_close_tick`); unlinked items and `sent` still write directly; `mgb.tk_close` is reset after the trigger; soft-deleted task unlinks; duplicate close task returns `skipped`; opt-in setter rejects a plain bookkeeper. UI: tick both ways in two tabs (realtime); 14.2 suggestion only for bank_feed/bank_rec when mapped checks pass.
- Upkeep: guide article "Close checklist and tasks", tour on ClientClosePage, announcement for bookkeepers + admins, tip on the toggle, help entry, Dev Tools count of opted-in clients.

**P4-3 Undo + bulk**
- Files: supabase/tasks-p4-3-bulk-undo.sql (+tests; replaces `notify_enqueue_task_assigned` from LIVE body; sets `mgb.tk_rollforward` around the roll-forward insert in `complete_staff_item`, also from LIVE body); TK_api.js; TK_List.jsx; TK_MyTasks.jsx; TK_TaskRow.jsx (checkbox); TK_viewLogic.js (selection state, pure + tests; `v` key); TK_logic.js (TK_KEYMAP entries); new TK_BulkBar.jsx; TK_Drawer.jsx (single-row actions return op_id). No notification-emails change.
- Conflicts: **highest**. TK_List, TK_MyTasks, TK_TaskRow, TK_viewLogic are all touched by subcolor; must start after subcolor merges. TK_api.js also P4-2. Keys: `v` select, `x` stays mark done; Cmd+Z must not hijack text inputs.
- Tests: SQL: 100-id cap; per-row exception isolation (one bad row, rest succeed); skips for no-access, ready_for_review, waiting_client, done; review_required → "sent for review" and never `tk_approve`; spawned roll-forward id captured; undo soft-deletes untouched spawned row and keeps a touched one; "changed since" skip; undo by a different user rejected; expired op rejected; each existing notify flag (generator, ooo, import, self-assign) still suppresses; `mgb.tk_bulk` and `mgb.tk_rollforward` suppress; enqueued rows skip test/internal clients and fail `tk_staff_has_client` rows; undo marks unsent rows `skipped/undone` and leaves sent rows (race test). UI: shift-range, toast + Ctrl+Z only while the toast is up, mixed results message.
- Upkeep: guide "Select many tasks" + "Undo", tour (3 steps), announcement, tips on checkbox, keys sheet entries, MGB_VERSION.

**P4-4 Snooze + saved filters**
- Files: supabase/tasks-p4-4-snooze.sql (wrapper only, +tests); TK_api.js; TK_MyTasks.jsx; TK_List.jsx; TK_Sidebar.jsx ("My views"); TK_viewLogic.js (saved-filter shape + tests); TK_Drawer.jsx (snooze menu); TK_App.jsx (route `#/tasks/v/<id>`).
- Conflicts: Workbench owns wb_item_state; do not alter its schema or `wb_snooze`. TK_Sidebar also touched by subcolor (project colors). TK_MyTasks by P4-3: P4-4 merges after P4-3.
- Tests: snooze hides in My Tasks and Workbench both; client-side version string equals WB_logic's; due-date or status change wakes it; clamp to the day before a future due date; overdue / due-today / undated tasks snooze up to 30 days without `wb_bad_until`; another user still sees it; saved view CRUD through the Settings store; deleted project fallback; 16 KB guard.
- Upkeep: guide "Snooze" + "Saved views", tour, announcement, tips, reset key for any new localStorage, Usage Stats route label for `#/tasks/v`.

**P4-5 Client strip + time-to-close**
- Files: supabase/tasks-p4-5-close-times.sql (+tests); TK_ClientDrawer.jsx (strip); ClientClosePage.jsx (table); Reports page (admin view); TK_api.js.
- Conflicts: TK_ClientDrawer.jsx is edited by subcolor (merge it first); ClientClosePage also edited by P4-2 (merge P4-2 first).
- Tests: business-day math across weekends/holidays (use existing business-day helper), null when not reached, access scoping, empty state.
- Upkeep: guide, tip on the strip, announcement (admins for the report), Usage Stats label.

**P4-6 At-risk + workload**
- Files: supabase/tasks-p4-6-at-risk.sql (+tests; `tk_at_risk_ids`, `tk_workload_counts`, tk_settings thresholds; no view change); TK_TaskRow.jsx (chip); TK_MyTasks.jsx (filter); TK_Sidebar.jsx (counts); TeamCapacity.jsx (column); TK_api.js; TK_store.js (merge at-risk ids).
- Conflicts: TaskRow/MyTasks/Sidebar shared with P4-3/P4-4 and subcolor; ship after them.
- Tests: each rule boundary (business days, 50%, idle window), performance < 50 ms on live-size data, workload scoping (bookkeeper sees own row only).
- Upkeep: guide "At risk", tip on the chip, admin announcement for workload, Dev Tools thresholds display.

**P4-7 Morning digest**
- Files: supabase/functions/notification-emails/index.ts (task_due job → digest sections + template; PREF label); Settings.jsx (`ST_STAFF_EMAIL_PREFS` label + help text); no SQL file unless the at-risk read needs a definer RPC callable by service role (reuse `tk_at_risk_ids` with an explicit assignee). DigestSettings.jsx untouched (admin weekly digest stays separate).
- Deploy: redeploy notification-emails only (no CHECK change; same PREF key and log feature). Test by enabling the pref on the owner's own staff account only.
- Conflicts: Settings.jsx (low); notification-emails is shared with all email work: check `git log` on it before starting.
- Tests: recipients ⊆ active staff; empty digest skipped; 20 h dedupe still finds the `staff_task_due` log row (run the job twice); test/internal client rules; at-risk section hidden when schema < P4-6; no client message text in the body; links resolve.
- Upkeep: guide "Morning summary email", Settings help text, announcement ("Turn on your morning summary" with a link to Settings), INFRA_LINKS cron note, MGB_VERSION.

**P4-8 Shortcuts + ? sheet**
- Files: new components/shared/MGB_keys.js + MGB_KeysSheet.jsx; app.jsx (mount), TK_keys.jsx (render from registry), WB_* (declare keys only, one line each), TopBar/StaffInbox/ClientsPage (declare only).
- Conflicts: touches many files lightly; must be last.
- Tests: `?` ignored in inputs; one sheet at a time; every listed key actually works (Haiku clicks through).
- Upkeep: guide "Keyboard shortcuts" page, help menu entry "Keyboard shortcuts (?)", announcement, tip.

### Shared files: who touches what

| File | Workbench | Subcolor | P4 slices |
|---|---|---|---|
| TK_List.jsx | – | yes | P4-3, P4-4 |
| TK_MyTasks.jsx | – | yes | P4-3, P4-4, P4-6 |
| TK_TaskRow.jsx | – | yes (+303) | P4-3, P4-6 |
| TK_Sidebar.jsx | – | yes | P4-4, P4-6 |
| TK_viewLogic.js / TK_store.js | – | yes (+221 / yes) | P4-3, P4-4, P4-6 |
| TK_ClientDrawer.jsx | – | yes | P4-5 |
| TK_api.js | – | yes (+34) | P4-2..P4-6 |
| app.jsx | yes | – | P4-2, P4-8 |
| StaffInbox.jsx | yes | – | P4-2 |
| Tour.jsx, Tips.jsx, README, staff guide | yes | upkeep | every slice |
| announcements.js | yes | yes | every slice (append-only entries) |
| index.html MGB_VERSION | yes | yes | every slice (always re-bump on rebase) |
| notification-emails fn | – | – | P4-7 only |
| WB_HubTasks.jsx (reads TK_TaskRow, TK_groupMyTasks, TK_myGroupsView) | Hub H2 | – | P4-3, P4-6: WB_HubTasks renders TK_TaskRow and calls TK_groupMyTasks/TK_myGroupsView; keep them backward compatible; run the hub smoke test. |

Rule: one P4 slice in flight at a time; all start after subcolor merges and rebase after Workbench lands. P4-1 and P4-7 touch few shared files and may overlap one other slice.

---

## 4. Owner decisions (6, each with a recommended default)

| # | Question | Recommended default |
|---|---|---|
| D1 | Close checklist tasks: create automatically for clients you opt in (per-client toggle), or only by a "Create this month's tasks" button? | **Per-client toggle, off by default.** Turn it on for 1-2 pilot clients first. Items: bank feed, bank rec, card rec, entries, review (not "sent"). |
| D2 | Morning summary email: on or off by default, and what time? | **Off by default; staff opt in in Settings. Keep the existing job time (11:30 UTC: 6:30 am Central in summer, 5:30 am in winter).** It replaces the "tasks due today" email (same setting). |
| D3 | At-risk rule: due within how many business days, and idle for how long? | **Due within 3 business days, no progress for 2 business days, under half the subtasks done.** Admin can change later. |
| D4 | Snooze: longest snooze, and may you snooze past the due date? | **Up to 30 days (Workbench's cap). A task with a future due date can only be snoozed until the day before it is due; overdue, due-today and undated tasks can be snoozed up to 30 days.** |
| D5 | Workload counts: admins and account managers only, or everyone sees everyone? | **Admins and account managers only;** others see their own numbers. |
| D6 | Lean mobile check-off view: cut it (Workbench phone sheet covers it) or keep for later? | **Cut for now;** revisit after 2 weeks of Workbench on phones. |

Not asked (decided in spec): next-3 preview cut (already built); in-app digest card cut (Workbench is it); mentions row handed to Workbench; saved views are personal only; new keys are `v` (select) and `z` (snooze) because `x` and `s` are taken; bulk complete skips tasks in review or waiting on a client instead of approving or forcing them; the digest leaves out client replies and mentions (they already email right away).

---

## 5. Risks

1. **Duplicate month-end tasks** (P4-2): standard set + Asana drafts + hand-made tasks. Mitigation: per-client opt-in, overlap warning, unique index on (client, period, close_key).
2. **Generator change touches every client's cron run** (P4-2): moving the set gate into the client loop must not generate for non-opted clients. Mitigation: dry-run `tk__generate(p_dry_run => true)` before and after apply; diff must show only opted-in clients.
3. **Bulk email storm** (P4-3): replacing `notify_enqueue_task_assigned` from a stale repo copy would drop the OOO/import/generator checks. Mitigation: rule 8 (live body) + a test that each existing flag still suppresses.
4. **Bulk complete approving others' work** (P4-3): avoided by calling `complete_staff_item` directly and skipping ready_for_review rows.
5. **Undo wrong rows** (P4-3): relies on `updated_at`, which `staff_reminders_before_write` bumps on every UPDATE; checklist/comment/subtask edits do not bump it, so spawned-row checks also look at those tables.
6. **Merge conflicts** with subcolor and Workbench: strict order (section 3 tables).
7. **Workbench contract drift** (P4-4): if Workbench changes `wb_item_state` key or version rules, task snooze breaks. Mitigation: P4-4 starts only after Workbench merges, reads the live function, and has a unit test that compares version strings.
8. **Digest noise**: off by default, skip empty, cap each section.

Self-critique: see docs/tasks-phase4-critique.md (3 blockers, 8 majors, all folded into this spec).
