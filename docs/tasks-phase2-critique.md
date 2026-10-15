# Tasks Phase 2 spec: adversarial review

Reviewed: `docs/tasks-phase2-spec.md` (810 lines), checked against the repo at origin/main (worktree `wt-tasks-p2`). Every finding was checked in the code. File and line references point at the current repo, and spec references point at section ids (B, C1-C7, D, E, F, G, K, L).

Counts: **4 BLOCKER, 15 MAJOR, 14 MINOR.**

---

## BLOCKER

### B1. Repointing the live doc-chaser at client_requests emails real clients about every Ask-client request
- **Spec:** C5 "Repointed: `client_doc_chase`, ... DocChaser", L Q10 ("keeps the job, repointed, as the doc nudge path until `client_request_nudge` is live"), K S5.
- **Why it is wrong:**
  - The live cron `client-doc-chaser` runs `0 14 * * *`. Its job in `supabase/functions/client-emails/index.ts:540-545` selects every `status='open'` row with no kind filter and emails the client's portal users.
  - Its only gates are `client_email_settings.enabled` and `doc_chaser_enabled` (index.ts:102, both default true), opt-outs, and `test_only` for cron (index.ts:108).
  - After S5, every `tk_ask_client` request, including `question` and `approval` kinds, is an open `client_requests` row. A repointed chaser emails real clients about them the next morning.
  - That bypasses `client_request_enabled`, the switch C6 says "only the owner flips". It also lands in S5, before S6 adds the "dry run on a real client sends nothing" verify.
  - This breaks the hard rule: no real-client email without an explicit owner switch.
- **Fix:**
  - In S5, filter the repointed chaser (both the cron path at index.ts:540 and the manual or preview path at index.ts:467) on `legacy_doc_request = true`.
  - Never let it read non-legacy rows. New requests get nudged only by `client_request_nudge`, which sits behind `client_request_enabled`.
  - Add an S5 verify: create a request with `tk_ask_client` on a non-test client, run the chaser in `preview`, and confirm the request is not listed.
  - Remove the S3/S5 swap allowance unless this filter ships in the same commit (see M14).

### B2. The tk_comments insert trigger rejects every client and token answer
- **Spec:** C5 `tk_answer_client_request` ("Adds a comment kind `client_reply`"), C6 `tk_answer_request_by_token` ("runs the same resume, comment, activity and outbox steps"), E step 7.
- **Why it is wrong:**
  - Phase 1 `tk_comments_before_write` (supabase/tasks-module-v1.sql) sets `author_email` from `auth.jwt()->>'email'` on INSERT.
  - It raises `tk_forbidden` when that email is empty or the caller is not `is_active_staff()`.
  - A portal client member is not staff, and the `tk-request-respond` service-role call has no JWT email. Both answer RPCs fail on the comment insert, and the whole answer rolls back.
  - Activity rows stamp the actor from the JWT the same way, so token answers get an empty actor.
  - The B flag `mgb.tk_request` is defined only for "move a task into or out of `waiting_client`". Nothing extends it to the comment trigger.
- **Fix:**
  - In C5, add an explicit edit to `tk_comments_before_write`: when `mgb.tk_request = 'on'` and `kind = 'client_reply'`, accept the insert and take `author_email` from a second definer-set flag (`mgb.tk_actor`, values `client:<email>` or `contact:<contact_id>`).
  - Make the same edit for the activity actor. Every other kind still needs active staff.
  - Add to the S5 and S6 verifies: answer as a `grace-community` member JWT, and answer by token on `basic-test`. Both should land a `client_reply` comment.

### B3. tk_client_people returns nothing under cron, so the generator, OOO and reviewer lookups resolve no one
- **Spec:** D step 6 ("`tk_client_people(client)` role `assignee_role`"), C7 ("Backup from `tk_client_people(client).backup`"), C3 reviewer resolution.
- **Why it is wrong:**
  - `tk_client_people(p_client)` filters on `is_active_staff()` and `can_access_client(p_client)`. Both read `auth.jwt()`.
  - The cron `tk_generate` run has no JWT, so every pair skips `no_assignee`. With B4, every period is also burned.
  - OOO and reviewer lookups fail the same way whenever they run from cron or from a service path.
- **Fix:**
  - Add an internal `tk__client_people(p_client text)` with no JWT checks, like the existing `tt_client_bookkeeper` and `tk_staff_has_client`.
  - `revoke all ... from public, anon, authenticated`.
  - The public `tk_client_people` stays as a JWT-gated wrapper for the UI. `tk_generate`, `tk_apply_ooo` and reviewer stamping call only the internal one.
  - Add to the S4 verify: run `tk_generate` exactly as cron runs it (no JWT, via `select cron...` or `set role postgres`), not only as an admin preview.

### B4. The dedupe ledger row is claimed before the skip checks, so any skip loses that period for good
- **Spec:** D step 5 ("First, `insert into task_template_issued ... on conflict do nothing returning`. A task is created only if that insert returned a row.") comes before step 6 ("Otherwise skip with `no_assignee`" / "`no_access`"). It also covers the dry run and preview path.
- **Why it is wrong:**
  - The claim row is the dedupe key. Once a pair skips at step 6, the ledger row stays, and every later run treats that period as issued.
  - The task is never created, even after an admin fixes the bookkeeper or access. It is not in `missed[]` either, because it was "issued".
  - The legacy generator (supabase/task-templates.sql) inserts the task first and the issued row second, so it never had this hole.
  - The spec also never says the dry run and `tk_generate_preview` skip the claim insert. If they share the loop, a preview burns periods.
- **Fix:**
  - Reorder D: resolve the assignee, time off and access first (step 6). Then claim the ledger row and insert the task (step 7) in one `begin ... exception` block, so a failure rolls both back.
  - Keep skips in the run log, and retry them every run while the period is inside the window.
  - State that `dry_run` and preview write nothing. Add a verify that `count(*)` on `task_template_issued` is unchanged after a preview.

---

## MAJOR

### M1. Dropping the admin check on the coverage grant lets any bookkeeper hand out a year of client access
- **Spec:** C7 `tk_apply_ooo` ("The caller is an admin or the time-off owner") calls `tk__grant_coverage`, described as "a refactor of `grant_coverage_access` that drops its admin check".
- **Why it is wrong:**
  - Staff can insert their own time off spanning up to 366 days (staff-time-off.sql:32 and :45-51).
  - Any staff member with `can_access_client` can set `client_profile.backup_bookkeeper_email` (staff-client-tools.sql).
  - The grant expires at `ends_on + 1` (staff-time-off.sql:256).
  - So a bookkeeper can set a colleague as backup, log 366 days of time off, and run "Hand my tasks to backups". The colleague then gets roughly a year of approved access to clients no admin approved.
  - Today only an admin can create that grant.
- **Fix:**
  - `tk_apply_ooo` calls `tk__grant_coverage` only when the caller is an admin.
  - For a non-admin owner, a backup without access becomes a `no_access` skip, plus a `pending` row in `staff_client_access_grants` for an admin to approve.
  - Cap any OOO grant at the lesser of `ends_on + 1` and now + 31 days.

### M2. The trigger's non-owner pin silently reverts OOO reassignments made by bookkeepers
- **Spec:** B new flags (`mgb.tk_ooo`, `mgb.tk_generate`, `mgb.tk_import`); C7 ("Under `mgb.tk_ooo`, sets `assignee_email := to_email`").
- **Why it is wrong:**
  - In `staff_reminders_before_write`, `v_bypass` covers only `mgb.offboarding` and `mgb.tk_migrate` (tasks-module-v1.sql:657-658).
  - Lines 675-679 pin `assignee_email`, `project_id` and `parent_id` back to the old values when the JWT caller is not the task's `staff_email` and is not an admin.
  - A bookkeeper running `tk_apply_ooo` on tasks an admin created and assigned to them gets each move reverted with no error. The ledger row says "moved", the task does not move, and the return later "succeeds" on unchanged rows.
  - The spec defines the new flags but never adds them to `v_bypass`.
- **Fix:**
  - In B, name the edit: `v_bypass := ... or current_setting('mgb.tk_ooo', true) = 'on' or current_setting('mgb.tk_generate', true) = 'on' or current_setting('mgb.tk_import', true) = 'on'`.
  - Each flag is set only inside its definer RPC, transaction-local.
  - Add to the S7 verify: a non-admin owner applies OOO on a task an admin created, and `assignee_email` actually changes.

### M3. Self-approval can still happen by reassigning while in review
- **Spec:** C3 state machine, row `ready_for_review -> done` ("admin, not `coalesce(assignee_email, staff_email)`"), and `tk_set_reviewer`.
- **Why it is wrong:**
  - `assignee_email` is never null after the Phase 1 trigger (tasks-module-v1.sql:617, :668), so the check compares the approver only against the current assignee.
  - An admin who did the work can send it for review, reassign it (admins pass the pin at line 675), and then approve their own work.
  - The diversion is now "for admins too", but the no-JWT path (`v_me = ''`) is not covered by the stated rule.
- **Fix:**
  - Add `submitted_by text`, stamped when the task enters `ready_for_review`. `tk_approve` and `tk_send_back` refuse when the approver equals `submitted_by` or `assignee_email`.
  - Lock `assignee_email` while status is `ready_for_review`, except under `mgb.tk_approve`.
  - In the trigger, refuse any move to `done` from `ready_for_review` without `mgb.tk_approve`, including no-JWT and admin callers.

### M4. Phase 1 logging counts a Withdraw as a send-back and logs approvals twice
- **Spec:** C3 rows "Withdraw ... no count, activity `status`" and `tk_approve` ("Activity `review_approved`").
- **Why it is wrong:**
  - Phase 1 `tk_staff_reminders_activity` already auto-logs `review_approved` for any `ready_for_review -> done`, and `review_sent_back` for any `ready_for_review -> in_progress/todo`.
  - Phase 1 `tk_set_status` also inserts a `send_back` comment whenever a note comes with that move.
  - So a Withdraw logs as a send-back, and `tk_approve` plus the trigger log approval twice. `tk_review_stats` (`first_pass`, `sent_back`) is wrong if it reads activity.
- **Fix:**
  - In S3, remove the review-kind branches from `tk_staff_reminders_activity`. The RPCs log `review_approved` and `review_sent_back`, and Withdraw logs `review_withdrawn`.
  - Drop the `send_back` comment insert from `tk_set_status`.
  - Compute `tk_review_stats` from `send_back_count`, `approved_at` and `ready_at`, not from activity counts.

### M5. The on-time rate skips open late tasks and deleted tasks, and self-made tasks can game it
- **Spec:** C3 "Eligible tasks: status done, ... `deleted_at` null".
- **Why it is wrong:**
  - A task still open past its effective deadline is never counted, so leaving late work unfinished keeps the rate at 100%.
  - Soft-deleting a late task removes it from the stats.
  - "Only admins move `due_date_original`" does not cover the first value: a self-created manual task gets whatever due date its creator picks.
  - Reviewer delay lands on the bookkeeper (completion means approval). That follows OD8 literally, so keep it, but it should be visible.
- **Fix:**
  - Eligible = done tasks, plus open tasks whose effective deadline has passed (counted late at query time), plus tasks deleted after their effective deadline.
  - Limit eligibility to `source='template'` or tasks where `created_by <> assignee`.
  - Add `submitted_on_time` (`ready_at <= effective_deadline`) as a second column, so reviewer delay is visible without changing OD8.

### M6. Calendar- and fiscal-basis periods collide in month_close and sign-off
- **Spec:** C2 `tk_period_start` (quarter and year aligned to the fiscal year), `tk_sign_off_period` ("Checks that `p_period` equals `tk_period_start(...)`"); D step 2 ("calendar starts, or fiscal starts ... when `period_basis='fiscal'`"); D step 9 (inserts a `month_close` row for quarterly and annual tasks).
- **Why it is wrong:**
  - For a client whose fiscal year does not end 12-31, a calendar-basis annual template (giving statements) creates `year` rows on Jan 1 that `tk_sign_off_period` can never sign off.
  - The same client also gets a fiscal `year` row, so there are two year rows for one client.
  - Calendar-basis quarterly templates have the same problem.
  - `fiscal_year_end` is editable by any staff with access, so an edit shifts alignment and orphans existing rows.
- **Fix:**
  - Quarters are always calendar (answer to Q2), and `tk_period_start` uses calendar quarters. `year` means fiscal only.
  - Calendar-basis annual tasks write no `month_close` row (`period_kind` null on the task).
  - Allow `fiscal_year_end` edits only by admins, with a warning when signed-off year rows exist.

### M7. The close KPI moves to sign-off time, so bookkeepers carry admin delay
- **Spec:** C2 last paragraph: the close KPI in `staff_performance` and `client_health` switches to `coalesce(mc.signed_off_at, mc.done_at, mc.updated_at)`.
- **Why it is wrong:**
  - Today the KPI counts the bookkeeper's own done date (tasks-module-v1.sql:2051-2086).
  - After S2 only admins can set done, so a bookkeeper who finishes on day 5 is marked late if an admin signs off on day 12.
  - This is the same problem as M5, in the existing performance score.
- **Fix:**
  - Add `month_close.ready_at`, stamped the first time status becomes `review`.
  - The bookkeeper KPI uses `coalesce(ready_at, signed_off_at, done_at, updated_at)`.
  - `client_health` can keep sign-off time.

### M8. The public answer endpoint parses up to 125 MB before checking the token
- **Spec:** C6 request contract (`{action:'answer', token, reply}`, multipart with up to 5 `file` parts), `answer` steps 1-3, and the `global` 600/h rate limit.
- **Why it is wrong:**
  - The token is a multipart field, so the function must buffer and parse the whole body (up to 5 x 25 MB) before it can look up the token or apply per-token limits.
  - Edge function memory and time limits make 125 MB bodies unreliable even for real users. For anonymous callers they are a cheap denial of service.
  - The spec never says which IP header is trusted. A spoofable `X-Forwarded-For` first hop lets an attacker defeat the per-IP limits.
  - If the `global` breaker counts all calls, an attacker can lock out every real client for an hour.
- **Fix:**
  - Send the token in a header (`X-MGB-Token`). Validate it and apply the rate limits before reading the body. Reject on a `Content-Length` over 26 MB with 413.
  - Allow one file per call: an `upload` action stages each file and returns an id, and `answer` takes JSON with the staged ids. This matches drive-files (one file, 25 MB).
  - Name the IP source in the spec, using the platform-set client IP header, not the left-most `X-Forwarded-For` hop.
  - Apply the global breaker to invalid or expired hits only.

### M9. Revoking the old token on every nudge breaks the links clients actually click
- **Spec:** C6 `tk_issue_request_token` ("revokes earlier live tokens for the same request and contact"), nudges ("minting a fresh token per contact per request"), threat model "A resend or nudge mints a new token and revokes the old one".
- **Why it is wrong:**
  - People open the first email, not the fourth. With up to 4 nudges, any earlier email returns 410 while the request is still open, and the contact has no portal login to fall back on.
  - Four nudges at 3-business-day spacing run past the 14-day TTL of the first link, so the TTL already limits old links.
- **Fix:**
  - Revoke only on answer, cancel, or explicit staff revoke or resend.
  - Nudges reuse the live token when more than 3 days of validity remain, otherwise mint a new one without revoking the old.
  - Cap live tokens per `(request, contact)` at 5.

### M10. client_request_enabled can be flipped by any admin, so it is not owner-only
- **Spec:** B (`client_email_settings.client_request_enabled`), C6 "Only the owner flips `client_request_enabled`, in Dev Tools > Flags".
- **Why it is wrong:**
  - `client_email_settings` can be updated by any active admin (supabase/client-emails.sql), and by the MCP or postgres role. "Owner only" exists only in the UI.
  - A second admin or a stray SQL statement turns on real-client email for every client at once, with no audit.
- **Fix:**
  - Add a BEFORE UPDATE trigger: `client_request_enabled` may change only when the JWT email is in `tk_settings.owner_emails`, and every change writes an audit row.
  - Add a per-client pilot list (`tk_settings.client_request_pilot`). Live send requires the switch on and the client in the list (or the list set to `all`).

### M11. The new outbox kinds will fail the email log CHECK
- **Spec:** B "New outbox kinds" (5 kinds) versus "New client email features (`client_email_log.feature` CHECK): `client_request` and `client_request_nudge`"; L R-b.
- **Why it is wrong:**
  - `notification-emails` logs every outbox send to `client_email_log` with `feature = kind`.
  - The latest `client_email_log_feature_check` (gl-review-1-core.sql:1711-1722) lists each existing outbox kind for that reason.
  - The five new `staff_task_*` kinds are not in the planned CHECK widening, so their log insert fails. Depending on the code path, the send either errors or retries.
  - Staff-initiated `tk-client-requests` sends must use `trigger='manual'` (the trigger CHECK allows cron, test, preview and manual), which the spec does not state.
- **Fix:**
  - Widen `client_email_log_feature_check` with all 7 new values, restated from the live constraint (`pg_get_constraintdef`).
  - Update every file that defines it in the same commit: notification-emails.sql, client-emails.sql, tech-inventory-v2.sql and gl-review-1-core.sql.
  - State `trigger='manual'` for staff sends.

### M12. Staff can write client_requests directly, and staff read scope is too wide
- **Spec:** C5 RLS ("Staff: `can_access_client` select, insert and update"), `client_requests_for_client` ("`is_client_member` or staff"), the Drive paragraph `tk_attach_request_file`, and "Client realtime uses this base-table policy".
- **Why it is wrong:**
  - With direct update rights, staff can write `answered_via='link'`, `answered_by='contact:...'`, `reply` and `status='answered'`. That fakes a client answer and skips the resume, comment and outbox steps.
  - `client_requests_for_client` lets any active staff member read any client's requests without `can_access_client`.
  - `tk_attach_request_file` has no stated auth. A caller could attach any `client_files` row, from another client or already linked, to a request.
  - Clients read the base table (needed for realtime), so they see `asked_by`, `recipient_emails` and `contact_ids`, including other recipients' emails.
- **Fix:**
  - Revoke insert and update from `authenticated`, so writes go only through the C5 and C6 RPCs. Alternatively, add a pin trigger that reverts `answered_*`, `reply`, `status`, `accepted_*` and `nudge_*` unless a definer flag is set.
  - Require `can_access_client(p_client_id)` in the staff branch.
  - `tk_attach_request_file` must require: the same `client_id`, the caller as uploader (or staff with access), `visibility='request'`, and not already linked.
  - For clients, use column grants that exclude `recipient_emails`, `contact_ids` and `asked_by`, or accept the exposure and document it.

### M13. The client_doc_requests migration fails on nulls, drops file data, and breaks live writers
- **Spec:** C5 "Migration from `client_doc_requests`" (field map, read-only BEFORE trigger, "Drop it later", repoint list).
- **Why it is wrong:**
  - `asked_by text not null` is not mapped. `client_doc_requests.requested_by` is nullable (staff-client-tools.sql), so the insert fails or leaves rows behind.
  - `file_path`, `file_name`, `uploaded_by`, `fulfilled_at`, `closed_at` and `due_date` are not mapped.
    - Legacy uploads stored as a Storage path (not `drive:<id>`) have no `client_files` row, so they disappear from the new UI.
    - The value report (client-emails/index.ts:359-364) filters on `fulfilled_at`.
  - The read-only trigger breaks live writers not on the repoint list:
    - app.jsx:5712-5721 (`addDocRequest`, `setDocRequestStatus`)
    - app.jsx:5741 and drive-files/index.ts:479 (`fulfill_doc_request`)
  - drive-files `doCopyLegacy` (index.ts:635) still reads the old table. That is harmless while it exists, but it is not listed.
  - `client_doc_chase.request_id` references `client_doc_requests on delete cascade`. "Repointed" does not say how the FK moves.
  - "Drop it later" goes against the soft-delete rule, and the cascade means a drop would also wipe chase history.
- **Fix:**
  - Map `asked_by = coalesce(requested_by, 'legacy')`, `asked_at = created_at` and `due_date`.
  - Add `legacy_file_path`, `legacy_file_name`, `answered_at = fulfilled_at` and `answered_by = uploaded_by`.
  - Add the three app.jsx helpers, `fulfill_doc_request` and `doCopyLegacy` to the S5 list, and repoint or retire each.
  - Move the `client_doc_chase` FK to `client_requests(id)` with `on delete restrict`. The ids match, so no data changes.
  - Never drop `client_doc_requests`. Keep it read-only.
  - Verify counts per status, not only in total.

### M14. The slice order breaks Phase 1 between S3 and S5, and the allowed swap is unsafe
- **Spec:** K ("S3 and S5 may swap. S6 needs S5."), C3 ("Entering or leaving `waiting_client` directly (without `mgb.tk_request`) raises an error").
- **Why it is wrong:**
  - S3 makes `waiting_client` reachable only through `tk_ask_client`, which ships in S5. Between the two, the shipped Phase 1 "Waiting on client" action raises an error.
  - Swapping S3 and S5 is only safe if B1's chaser filter ships inside S5.
  - S2 is not independently committable unless it includes the CloseTracker rewrite (M15).
- **Fix:**
  - Move the `waiting_client` lock from S3 into S5.
  - Make the B1 filter part of S5's own verify.
  - State in K that S2 includes M15's UI change.

### M15. The S2 sign-off guard breaks the bookkeeper close flow, and the RPC drops concurrency control
- **Spec:** C2 trigger `month_close_signoff_guard`, `tk_sign_off_period`; F step 8 ("CloseTracker.jsx ...; its done path switches to `tk_sign_off_period`").
- **Why it is wrong:**
  - Bookkeepers mark months done today through `CT_saveMonthClose` (components/staff/CloseTracker.jsx). `tk_sign_off_period` is admin-only, so after S2 the bookkeeper's Done button raises.
  - The spec never says what a bookkeeper does instead. `month_close` already allows `status='review'` (month-close.sql:35-36), which is the natural "ready for sign-off" step, but nothing wires it up.
  - `CT_saveMonthClose` uses optimistic concurrency (`.eq('updated_at', expected)`), and `tk_sign_off_period` has no equivalent, so two admins or tabs overwrite each other.
  - The `CT_ledgerGate` override (`gl_review_override_done`) must run before the RPC, or the GL gate trigger raises inside it. The spec does not state that order.
  - An older `staff_performance` body exists in supabase/staff-celebrations-performance.sql:229. F.0's live diff covers the database, but the repo file must also be updated, or re-running it reverts the fix.
- **Fix:**
  - In S2, CloseTracker shows "Ready for sign-off" (`status='review'`) to non-admins and "Sign off" to admins.
  - Add `p_expected_updated_at timestamptz` to `tk_sign_off_period`. It raises `40001` on a mismatch, matching the existing conflict toast.
  - Document `CT_ledgerGate` running before the RPC.
  - Patch staff-celebrations-performance.sql in the same commit.

---

## MINOR

- **m1. C1 `tk_holidays`:**
  - Problem: holidays are seeded through 2028 only, after which business-day math silently treats holidays as working days.
  - Fix: `tk_generate` adds a warning to its run log when `max(day) < today + 365`.
- **m2. C1 security invoker:**
  - Problem: the calendar functions read `tk_holidays` under the caller's RLS (`is_active_staff` select). Any non-staff caller, such as a client JWT path, sees no holidays and gets different dates.
  - Fix: make `tk_is_business_day` `security definer` with `search_path = public` (it reads only that one table), or add a select policy for all authenticated users.
- **m3. C4 `activated_at`:**
  - Problem: live templates have no `activated_at`. D step 2's `floor` then falls back to `today - 1 year`, so the first run lists up to a year of "missed" periods per template and client.
  - Fix: backfill `activated_at = coalesce(activated_at, created_at)` in S4, and cap `missed[]` to periods after `on_time_since` or the S4 ship date.
- **m4. D missed list:**
  - Problem: `missed[]` is recomputed every run, so the admin banner shows the same items forever.
  - Fix: store missed rows once (`tk_generate_missed` with `dismissed_at`).
- **m5. C6 vercel.json:**
  - Problem: the header block covers `/respond` but not a direct `/respond.html`, and the planned CSP has no framing or form controls.
  - Fix: add the same block for `/respond.html`. Add `frame-ancestors 'none'; base-uri 'none'; form-action 'none'` to the enforced CSP, and add `Cache-Control: no-store`.
- **m6. C6 link scanners:**
  - Problem: mail security scanners pre-fetch links and some run JS. `respond#t=..&stop=1` could stop nudges on load.
  - Fix: stop and answer always need a button press, and view counts are informational only.
- **m7. C6 logging:**
  - Problem: the spec says nothing about function logs.
  - Fix: state that `tk-request-respond` and `tk-client-requests` never log the token, the reply, file names or recipient emails, only request ids and outcome codes.
- **m8. C6 `ip_hash`:**
  - Problem: an unsalted sha256 of a /24 plus the date can be enumerated in seconds.
  - Fix: accept it and document it as pseudonymization only, or use an HMAC with a function secret.
- **m9. C2 reports-ready resend:**
  - Problem: `notify_enqueue_reports_ready` (notification-emails.sql) has no dedupe, so reopening and signing off again emails clients again.
  - Fix: skip when a `client_reports_ready` outbox row for the same `ref_id` exists within 7 days.
- **m10. G step 5:**
  - Problem: G calls `is_admin()`, which does not exist in the repo.
  - Fix: use `is_active_staff_admin()`.
- **m11. C4 templates delete:**
  - Problem: the `task_templates` admin policy is `for all`, so it allows DELETE, and `task_template_issued` cascades on delete. Deleting a template wipes the dedupe ledger, which breaks the soft-delete rule.
  - Fix: revoke DELETE and archive instead.
- **m12. Repo PII:**
  - Problem: the spec contains a staff email address (OD7 line 21, G lines 666 and 673), and Q9 and G name two client organizations. docs/tasks-module-audit.md already names the same clients. The repo rule is no PII in repo files.
  - Fix: replace them with roles ("owner", "client A / client B") in both docs.
- **m13. C7 autofollow:**
  - Problem: `tk_staff_reminders_autofollow` (tasks-module-v1.sql:1148-1168) adds the backup as a follower on reassignment, and `tk_return_ooo` leaves the backup following.
  - Fix: on return, remove followers whose `added_by` is the OOO flag path.
- **m14. C7 `tk_ooo_daily`:**
  - Problem: it only "returns" unreturned time offs and does not call `tk_return_ooo`, so returns depend on someone clicking.
  - Fix: state whether the cron returns tasks automatically. Auto-return is safe, because tasks changed since the move are skipped as `changed`.

---

## Checked and fine (no finding)
- Token design: 32 random bytes in the URL fragment, only the sha256 stored with a unique index, a fixed view field list, single answer, and `history.replaceState`. This is sound. The timing difference from a hash lookup is not exploitable.
- F step 4 (dynamic PK swap, guarded, re-runnable) and step 5 (re-create `on conflict` users in the same transaction) are correct. The F step 6 and step 8 reader lists match the repo, except for the M15 file note.
- `notify_enqueue_task_assigned` already skips the generate, OOO and import flags (B), and `notify_enqueue_reports_ready` gets the month-only filter (F step 6).
- OD8 send-back handling: `completed_at` is the final approval, so a send-back alone never makes a task late. That is correct.
- QBO stays read-only. No secrets in the spec. The backup table is RLS-on and revoked.

---

## Recommended answers to the open questions (owner style: conservative, reversible)

| Q | Recommended default | Why |
|---|---|---|
| Q1 | Only admins approve. A non-admin account manager's clients fall back to "any admin". | Matches D1, adds no permission tier, and can change later. |
| Q2 | Calendar quarters always. `year` means fiscal year. | Avoids the M6 collisions and matches most board reporting. |
| Q3 | No client email for quarter or year sign-off in Phase 2. | Keeps the client email surface minimal. Can be added later as opt-in. |
| Q4 | Yes, a second admin reviews owner tasks, with Jesse as the default reviewer. | No self-approval. Matches the Team Reviews default. |
| Q5 | Manual apply, plus a reminder banner 3 business days before time off starts. | Reversible, no surprise moves, and limits M1 and M2 risk. |
| Q6 | Add Christmas Eve, the day after Thanksgiving and Good Friday as `firm_closed`, editable by the owner. | Common closures, easy to change. |
| Q7 | TTL 14 days, nudge cap 4, catch-up grace 7 days. Confirmed, with M9: nudges do not revoke earlier links. | Conservative, and old emails keep working. |
| Q8 | The per-request "Stop reminders" link, plus an admin-only client-wide pause. | Staff keep control, and a client-wide pause covers a complaint. |
| Q9 | Confirm the fallback users, the client pairing and project targets in the dry-run report before apply. Task Progress: Not started to `todo`, In progress to `in_progress`, anything else to `todo` with the original value in a note. | Nothing is lost, and the owner sees it before apply. |
| Q10 | From S5 on, DocChaser handles `legacy_doc_request` rows only (B1). Retire it once `client_request_nudge` is live and no legacy rows are open. | Closes the B1 real-client email path. |
