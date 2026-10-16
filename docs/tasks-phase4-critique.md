# Tasks Phase 4 spec: critique

Reviewer: fresh Opus agent (high effort), read-only, checked against origin/main be7bde7, the live DB (SELECT only), wt-workbench (uncommitted) and wt-subcolor (4fb2473). Date 2026-10-16. Every item below is fixed in docs/tasks-phase4-spec.md.

## BLOCKERS

**B1. Per-client opt-in would never generate close tasks.** All six standard-set templates are `status='draft'`; `tk__generate` selects only `active and status='active'`; the set gate `continue`s at template level before the client loop unless `standard_set_live` is on or a test client is named, so the daily cron (`p_client_id` null) never reaches a per-client check.
Fix: move the set gate inside the client loop (`standard_set_live OR opted in OR named test client`); activate the five linked members, keep `sent` draft; per-client activation floor so no back-periods hit `tk_generate_missed`; explicit "include this month" choice. (Spec 2.2.)

**B2. Bulk complete through `tk_set_status` was unsafe.** From ready_for_review it calls `tk_approve` (silent approval of others' work); done→done raises; waiting_client raises `tk_has_open_requests`; it discards the roll-forward id; one raise aborts the batch.
Fix: `tk_bulk_complete` calls `complete_staff_item(id, true, today)` directly for todo/in_progress (captures the roll-forward uuid), routes review-required rows to ready_for_review, skips the rest with reasons, per-row exception blocks. (Spec 2.3.)

**B3. Digest dedupe would silently fail.** `task_due` is a direct send deduped on `client_email_log` feature `staff_task_due`; the feature CHECK rejects a new `staff_task_digest` and the insert error is only console-logged, so the digest would resend every run.
Fix: reuse PREF `task_due` and feature `staff_task_due`, relabel "Morning summary"; no CHECK or outbox change. (Spec 2.7.)

## MAJORS

- **M1. Key collisions.** `x` = mark done and `s` = status in Tasks (TK_viewLogic.js:376, TK_logic.js:762); `t` is global. Fix: `v` select, `z` snooze, `g` sequences only as two-key chords; reserved list updated. (2.3, 2.4, 2.8.)
- **M2. Undo wrote a non-existent column.** Outbox has `reason`, not `error`. Fix: `status='skipped', reason='undone'` only where `status is null`; sent rows stay sent (race test); add `mgb.tk_rollforward` so spawned rows don't enqueue assignment emails. (2.3.)
- **M3. Custom batch email could vanish and skipped guards.** 4 KB payload cap swallowed by `tk__enqueue`; batch rows bypass `tk_staff_has_client` and the test-client exclusion. Fix: no custom batch; enqueue normal `staff_task_assigned` rows with the same guards and rely on the function's existing per-run grouping. (2.3.)
- **M4. Snooze clamp broke for overdue tasks** (`least(until, due_date)` ≤ now → `wb_bad_until`). Fix: clamp only when due date is in the future; client-side version string must equal Workbench's; sent-back key gap documented; D4 reworded. (2.4, D4.)
- **M5. Per-client toggle had no safe home.** No `client_task_settings`; `client_profile` RLS lets any staff with access write. Fix: new `tk_client_close_optin` table, RLS select only, admin/AM definer setter, soft disable. (2.2.)
- **M6. Checklist ↔ task sync edge cases and 14.2 mapping.** Untick approved needs admin; ready_for_review needs `tk_withdraw_review`; done→done and waiting_client raise; five direct writers exist; `close_checks` has no card key; checklist is monthly only. Fix: state table in `tk_close_tick` that returns messages; definer sync trigger with flag reset; all five writers listed; map bank_feed ← bank_active+uncategorized, bank_rec ← reconciled, no card_rec suggestion; quarterly mapping removed. (2.2.)
- **M7. Shared-file table was stale.** Subcolor also touches TK_api, TK_viewLogic, TK_store, TK_ClientDrawer, TK_ManageProjects, tk-views.css and doesn't bump the schema probe; Workbench touches app.jsx, StaffInbox, Today, Tour, Tips, StaffNav, announcements, index.html, README, guide. Fix: table rewritten; every slice waits for subcolor and rebases after Workbench; schema numbers assigned at rebase. (Section 3, rule 11.)
- **M8. `at_risk` view column would slow every list.** Fix: separate `tk_at_risk_ids` RPC merged client-side; no view change. (2.6.)

## MINOR

- Waiting-on-client status is `open`; reuse `tk_waiting_on_client`. Fixed.
- No "tk daily cleanup" cron exists; undo-log cleanup moved into the bulk RPC. Fixed.
- Cmd+Z window contradictory; now only while the toast is visible. Fixed.
- ~23 keydown listeners, not ~8; P4-8 declares only, no refactor. Fixed.
- Digest timezone: function uses America/New_York; spec keeps cron time and states it in D2. Fixed.
- Digest sections for client replies and mentions cut (they already email immediately; no client message text in digests). Fixed.
- "Untouched spawned row" also requires `updated_at = created_at` and no comments/subtasks/checklist. Fixed.
- Duplicate close-task insert returns `skipped` from `tk__issue_period`; tests expect that. Fixed.
- Saved views write through the Settings store only; last write wins across devices. Fixed.
- Opt-in "turn off" was a hard delete; changed to `disabled_at` (soft). Fixed (found in self-review).

## Checked and fine

- staff_reminders has period_kind, period_start, template_id, parent_id, series_id, recurrence, updated_at (bumped by `staff_reminders_before_write`); `close_key` must be added.
- notification_outbox id is bigint identity; `skipped` is allowed; `staff_task_batch` exists (now unused by Phase 4).
- `notify_enqueue_task_assigned` live checks tk_generate, tk_ooo, tk_import, self-assign; only gap was roll-forward.
- `wb_snooze(text, text, timestamptz)` is SECURITY DEFINER reading the JWT email; `task:task:<uuid>` matches its regex; 30-day cap; `wb_unsnooze` exists.
- month_close has ready_at, signed_off_at, reopened_*; 0 signed off (empty state is correct).
- close_checks shape `{ok, key, label}`, cron 11:25 UTC.
- task_due cron `30 11 * * *`, default off, 15-item cap.
- `client_request_pilot` and `standard_set_live` absent (off). No Phase 4 slice emails a client.
- Code references verified: TK_parseQuickAdd TK_logic.js:581, TK_applyFilters TK_viewLogic.js:314, TK_ClientStrip TK_ClientDrawer.jsx:108, mount app.jsx ~29779, TK_QuickAddHost app.jsx ~30560, TK_tplNextList (next-3 cut is valid), MGB_VERSION index.html:205, TK_vToast.
- Business-day helpers exist (`tk__business_days_since`, `tk_add_business_days`).
- Model per slice, upkeep checklist, re-runnable SQL rule, ≤6 owner decisions with defaults: present.

## Recommended answers

Use the defaults in spec section 4 (D1 per-client toggle off by default; D2 off by default, existing time; D3 3 days / 2 idle days / under half done; D4 30 days, never past a future due date; D5 admins + AMs; D6 cut mobile view for now).
