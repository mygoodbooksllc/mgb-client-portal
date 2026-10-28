# Slate plus: task dependencies ("Blocked by")

Status: built hidden 2026-10-27; review pass 2 applied 2026-10-27 (rules marked "pass 2" below). Part of the "Slate plus" batch (with @mentions, saved filters, workload strip).
Gate: per-person flag `mgb_slateplus_preview` (Developer tools > Feature flags) or firm switch
`tk_settings.slateplus_enabled` (NOT SET = off; code never sets it). Shared check: `TKP_on()` in
`components/tasks/TK_slatePlus.js`.

Aim: the month-end close checklist. "Reports" cannot start before "Bank recs" is done, and so on.

## 1. What staff see (preview on)

- Task drawer: a **Blocked by** section under the fields. Lists each blocker (title, client, status,
  assignee) with a remove button, plus **+ Add blocker** (search any task you can see, any client).
  A **Blocking** line lists the tasks this one holds up.
- Rows: a lock chip **Blocked by N** (N = unfinished blockers). Hover lists the blocker titles.
- Slate (My tasks, Desk My tasks tab, Today): open blocked tasks move to a **Blocked** group after
  Later. Exception: a blocked task that is **overdue stays in Overdue** (with the chip), so it still
  counts as late everywhere (summary, top bar pill, Desk bar, performance rules are untouched).
- "Do next" surfaces skip blocked tasks: Slate summary Today/Next, Today page Needs you (non-late
  bands), Desk bar "Next up".
- Trying to tick done, start (In progress) or send for review on a blocked task shows:
  "Blocked by 2 unfinished tasks: Bank recs, Credit cards. Finish those first." (the browser's
  quick check). When the server refuses (stale browser, Close tab, undo, Today, review), every path
  says "This task is waiting on another task to finish." (pass 2). Admins get an
  **Override** action (asks for a reason). Overrides are logged.
- When the last blocker is completed or trashed, the blocked task's assignee gets ONE bell notice
  "Ready to start: <task>" (in-app only, no email). The task leaves Blocked on its own. If it is
  blocked again and freed again, the notice is sent again (pass 2).
- Templates (admins): a **Close order step** number on a recurring template. Each month's generated
  tasks are wired "blocked by the previous step in this set" for the same client and period.
  Empty for every existing template, so nothing changes until an admin sets it.

Preview off (everyone today): nothing above renders. The only server effect that can reach a
non-preview person is the completion guard on a task that a previewer has wired (see 3.3).

## 2. Data (supabase/slateplus-deps.sql, additive only)

| Object | Purpose |
|---|---|
| `tk_task_deps(task_id, blocker_id, created_by, created_at, source, overridden_at, overridden_by)` | PK (task_id, blocker_id); both FK `staff_reminders(id) on delete cascade`; check task_id <> blocker_id; source in manual/template |
| `tk_dep_events(id, task_id, blocker_id, actor_email, kind, reason, created_at)` | log: add, remove, override, template_link. Admin read only |
| `tk_dep_notices(id, recipient_email, task_id, blocker_id, created_at)` | bell rows; unique (task_id, recipient_email) = one live notice per person per task; a later unblock re-sends it (upsert with a new id) |
| `task_templates.dep_step smallint null check 1..99` | close order step; null = not chained |

RLS on all three tables: enabled, no anon. Deps: staff read only where they can read BOTH the task
and the blocker (`tk_can_read_task`, pass 2). Writes only through RPCs (no insert/update/delete
grants). Events: active admins who can read the task (and the blocker, when set; pass 2).
Notices: own rows, active staff. Clients (authenticated but not staff) get nothing anywhere.

"Open blocker" = blocker row exists, `done = false`, `deleted_at is null`, and the dep is not overridden.

### RPCs (security definer, `search_path public`, execute revoked from public/anon)
- `tk_dep_add(p_task, p_blocker)` -> jsonb. Needs active staff, edit right on the task
  (`tk_can_edit_task`), read right on the blocker (`tk_can_read_task`), neither deleted, not the same,
  no cycle, max 20 blockers per task. Takes `pg_advisory_xact_lock` so two concurrent adds cannot
  build a cycle. Idempotent (already linked = ok). Logs `add`.
- `tk_dep_remove(p_task, p_blocker)` -> jsonb. Edit right on the task. Logs `remove`.
- `tk_dep_list(p_task_ids uuid[] default null)` -> setof rows (task side and blocker side), only
  where the caller can read at least one side. The side the caller cannot read comes back fully
  masked (pass 2): null id, title, client, status, assignee, due date and done / deleted flags; only
  the new `is_open` column (not overridden, blocker not done, not trashed) says whether it still
  blocks. The browser files such rows under the known side with a local key and never offers
  Remove for them (non-admins ask for an override). Null argument = every dep the caller can see (max 2000).
- `tk_dep_override(p_task, p_reason)` -> jsonb. Active admin only, reason 3..500 chars. Stamps
  `overridden_at/by` on the open deps and logs `override`. No notice.
- `tk_dep_my_notices(p_days int default 14)` -> own notices joined to task title/client (skips
  deleted or unreadable tasks; the blocker id is null when the reader can't read the blocker).
- `tk_set_template_dep_step(p_id, p_step)` -> jsonb. Active admin only (same rule as
  `tk_save_template`). Null clears.
- Internal: `tk__dep_open_count(task)`, `tk__dep_would_cycle(task, blocker)`, `tk__dep_link(...)`.

### Triggers on `staff_reminders` (all return early unless a dep exists)
1. `tk_staff_reminders_zdeps_guard` BEFORE UPDATE OF done, status. Fires last among BEFORE triggers
   (name order), so it sees final values. Acts only when the row moves into done, in_progress or
   ready_for_review, AND a `tk_task_deps` row exists for it, AND the actor is active staff
   (cron, service role, token answer pages and client users pass untouched). Pass 2: also skipped
   inside a nested trigger (`pg_trigger_depth() > 1`) and while the rhythm, generator or close-sync
   session flags (`mgb.tk_rhythm`, `mgb.tk_generate`, `mgb.tk_close`) are on, so a cascade never
   aborts its transaction; only direct staff writes (RPCs, bulk, undo, which catch per row) are
   guarded. Open blockers > 0
   raises `tk_blocked: Blocked by N unfinished task(s)` (errcode P0001). Message carries a count only,
   never titles. `tk__bulk_reason` gains `tk_blocked -> 'blocked'` so bulk actions skip the row
   with a clear reason instead of failing the batch (bulk already catches per row).
2. `tk_staff_reminders_zdeps_ready` AFTER UPDATE OF done, deleted_at. When a row flips to done, or
   is trashed while open (pass 2), and it blocks something: for each dependent that is open, not deleted, and now has zero open blockers, insert
   one notice for its assignee (skip unassigned, skip the person who completed the blocker, skip
   inactive staff and people without access to the client). Overridden deps are ignored. On
   conflict the existing row gets a new id and time, so a re-block then unblock notifies again.
3. `tk_staff_reminders_zdeps_wire` AFTER INSERT, `when (new.template_id is not null)`. Reads the
   template's `dep_step`; null returns at once. Otherwise links the new task to the tasks made from
   the same set's previous step (largest step below), same client and same period
   (`period_kind` + `period_start`), and links the next step's existing tasks to it, so insert order
   does not matter. Same-step templates are parallel (all of step 2 waits for all of step 1).
   Cycle-checked; logs `template_link`.

## 3. Rules and edge cases

1. **Self-block / cycles**: check constraint + `tk__dep_would_cycle` (walks every blocker of the
   blocker by id with `UNION`, so loops end and there is no depth cap; pass 2) under an advisory lock. The browser runs the same check first for a quick message.
2. **Blocker deleted (trash)**: stops blocking; if it was the last open blocker, the Ready to start
   notice is sent (pass 2). Restored: blocks again. Hard delete
   cascades the dep row away.
3. **Blocker completed then reopened** (undo, reopen): blocks again if the dependent is still open.
   When it is finished again the dependent's notice is sent again (pass 2; one row per person,
   re-stamped).
4. **Reassigned blocker**: no effect. **Reassigned blocked task**: the notice goes to whoever is the
   assignee when it unblocks.
5. **Completed blocked task** (via override, or done before the dep was added): deps stay as history;
   a done task is never "Blocked".
6. **Waiting on client** tasks: not blocked from waiting; they stay in Waiting. Review: a task already
   in review is not pulled back.
7. **Duplicate (Cmd+D), copy/paste**: copies start with no blockers (deps are not copied; the copy
   is a new piece of work). Undo of a copy deletes the copy; its dep rows cascade on hard delete only,
   and a trashed copy never blocks.
8. **Undo**: adding or removing a blocker offers Undo (client-side: remove / re-add). Undo of a
   completion reopens the blocker (rule 3).
9. **Multi-select**: bulk Complete and bulk Status In progress skip blocked rows in the browser with
   "N blocked tasks skipped"; the server also skips them (`blocked` reason) if the list was stale.
10. **Recurring repeat (Repeat menu)**: the next copy of a repeating task does not inherit deps
    (same as copy). Use template steps for monthly chains.
11. **View as**: the shared gate (`TKP_on`) is always off in View as, so nothing from this feature
    shows there (no section, chip, group or notice) and no dependency RPC runs; `tk_dep_list` and
    `tk_dep_my_notices` are also listed in `MGB_VIEW_AS_SILENT_RPCS`. Writes stay refused by the
    existing View as guard. The server guard still applies to anything the viewed person does.
12. **Clients**: no client screen, RPC, email or Ask-client path reads the new tables. The guard
    ignores non-staff actors, so a client answering a request never hits it, and the message has no
    titles. Ask-client emails are built from the request's own fields only.
13. **Off = old behavior**: no dep rows exist today, so every trigger returns at the first
    `exists` check. `TK_groupMyTasks` only adds a `blocked` key when the caller passes `isBlocked`,
    which only happens when `TKP_on()`.

14. **Resume is not a start** (review fix): back from review (send back, withdraw) to In progress
    is never refused. From Waiting on client it is a resume only when the task was In progress
    before it waited (`status_before_wait = 'in_progress'`); To do → Waiting → In progress is a
    start and is refused (pass 2). The browser stays lenient there and lets the server decide.
15. **Close order links** (source `template`) are removed by admins only; others ask for an override.
16. **Full load** (`tk_dep_list(null)`): only deps whose task is still open, newest first, max 2000,
    so finished history never crowds out live blocks. The drawer of a done task shows no list.
17. **Ready notice** fires on the final row (`after update ... when new.done and not old.done`, or
    a soft delete of an open blocker), so
    status-only completions (rhythm auto-complete, close adopt, undo) notify too, and an advisory
    lock stops two last blockers finished at once from both missing it.

## 4. Self-critique (and what changed because of it)

- *Guard reaches non-preview staff.* If the owner wires deps on real tasks during preview, a
  bookkeeper without the preview will see "Blocked by 1 unfinished task" when ticking it. Accepted:
  it is the correct rule, the message is plain, and the preview is the owner's sandbox. Advice in
  the launch checklist: wire real client tasks only after launch.
- *Cron jobs failing.* A raise inside `tk_rhythm_daily` or the generator would abort a whole run.
  Fixed by skipping the guard when there is no signed-in active staff member.
- *Close tab ticks.* Ticking a Close step syncs its task to done; if that task is blocked the tick
  answers status `blocked` with "This task is waiting on another task to finish." (pass 2: plain
  words, not an error). Accepted (same rule in both places).
- *Bulk failing as a batch.* Checked: `tk_bulk_complete`/`tk_bulk_set` catch per row; added the
  `blocked` reason text.
- *Leaking titles.* `tk_dep_list` masks the side the caller cannot read (pass 2: ids and flags
  too); direct table reads need both sides readable; errors carry counts only.
- *Notice spam.* One per person per unblock (re-sent only after a real re-block); none for your own
  completions.
- *Cycle race.* Advisory transaction lock on all dep writes.
- *Template step ambiguity.* "Previous step" = largest `dep_step` below this one in the same set
  (or the firm templates group when the set is null); equal steps run in parallel.
- *Performance.* Each trigger is one indexed `exists` probe when no deps exist; the wiring trigger
  only runs for template-made rows (one PK lookup).

Not in this slice: dependency arrows on the board, copying deps when a whole checklist is pasted,
email notices, start-date shifting when blockers slip.

## 5. Launch checklist (owner says go)

1. Final Opus verify with preview on and off (both browsers); run `supabase/slateplus-deps-tests.sql`.
2. Owner flips `slateplus_enabled` (shared with the other Slate plus features).
3. Publish the guide article and What's new entry below; add the notice + tour (mgb-launch-kit).
4. Set Close order steps on the standard close set templates with the team.
5. Keep `mgb_slateplus_preview` two weeks, then offer to remove it.

## 6. Drafts (NOT published; publish at launch)

**Guide article `task-dependencies` (Slate > Blocked by)**
> Some tasks can't start until another is finished. Open the task, find **Blocked by**, and pick
> the task it waits for (any client you can see). The row shows a lock and **Blocked by 1**, and the
> task sits in **Blocked** on your Slate until the other task is done. You can't tick it done or
> start it while it is blocked. When the last blocker is done you get one bell notice,
> **Ready to start**. Late blocked tasks still show in Overdue. Admins can **Override** a block with
> a reason (it is logged). Admins can number recurring templates with a **Close order step** so each
> month's close checklist wires itself: step 2 waits for step 1, and so on.

**What's new**: "Blocked by: make a task wait for another. Blocked tasks move to their own group, can't
be started early, and you get a Ready to start notice when they're free."

**Next-visit notice**: "New: Blocked by. Link close checklist steps so the next one waits its turn."
**Tour stops**: drawer Blocked by section (`data-tour="tk-dw-deps"`), row chip, Slate Blocked group.
