# Slate plus: Rules (simple automations)

Status: built hidden 2026-10-28. Part of the "Slate plus" batch (feature 3 of the "better than Asana" list).
Gate (UI): per-person flag `mgb_slateplus_preview` (Developer tools > Feature flags) or firm switch
`tk_settings.slateplus_enabled` (NOT SET = off; code never sets it). Shared check: `TKP_on()` in
`components/tasks/TK_slatePlus.js`.
Gate (database): the executor does NOTHING unless `tk_settings.slateplus_enabled` is true AND the
rule's own `enabled` box is on. `enabled` defaults to false and only the owner can switch it on.
While the owner previews with only the personal flag, rules never fire: use **Dry run**.

Aim: take the repetitive clicks out of a project. "When a task moves to Review, assign Jesse",
"When a task is done, post a note and add the follow-up", "When a task is late, move it to Needs attention".

## 0. Audit (what already exists, 2026-10-28)

- Tasks live in `staff_reminders` (not `tk_tasks`, a legacy view-like table). Sections are free text
  `staff_reminders.section` (1..60 chars); a project lists its sections in `tk_projects.sections text[]`.
  Client lists have no fixed section list, so section rules are project rules only.
- No tag or label field exists on tasks. **Tag action skipped** (follow-up if labels are ever added).
- Comments: `tk_comments` with `kind in (comment, send_back, client_reply, system)`; a `system`
  comment is shown as "System" with an "Update" label (TK_Comments.jsx). The before-write trigger only
  lets the month rhythm job write `system` comments today; this build adds one branch for rules.
- Activity: `tk_activity` written by `tk_staff_reminders_activity`; it takes its actor from
  `mgb.tk_actor` when set (rules set it to `system`).
- Recurring templates (`task_templates`, `tk_generate`, daily cron 10:15 UTC), month rhythm
  (`tk_rhythm_daily`, 10:40 UTC), dependencies (`supabase/slateplus-deps.sql`), Ask client, OOO.
  These background jobs mark themselves with session flags (`mgb.tk_generate`, `mgb.tk_rhythm`,
  `mgb.tk_ooo`, `mgb.tk_import`, `mgb.tk_migrate`, `mgb.tk_close`, `mgb.tk_undo`, `mgb.offboarding`).
- Existing triggers on `staff_reminders`: `staff_reminders_before_write` (pins assignee/project for
  non-owner non-admins unless a bypass flag is on; only admins move the on-time baseline
  `due_date_original`), trash guard, close key, activity, autofollow, `notify_enqueue_task_assigned`
  (email outbox; silent under `mgb.tk_generate`), `tk_review_notify`, request guard, close sync/adopt,
  rhythm row 8, and the three deps triggers.
- Notification outbox: `notification_outbox` (emails). **Rules never write to it** (see 3.4).
- Scheduled jobs: pg_cron. There is no overdue job for tasks, so this build adds one small daily job
  (`tk-rules-overdue-daily`, 11:50 UTC) that returns at once while the gate is off.

## 1. What admins see (preview on)

- Slate sidebar (and the icon rail's Projects panel): **Rules** under Manage projects, admins only
  (full admins, not temporary admins). Route `#/tasks/rules`, parsed only while the gate is on.
- Rules page:
  - A note at the top: whether rules can run now ("Rules are not running: Slate plus is off for the
    firm. Use Dry run to see what a rule would do." / "Rules run for rules that are switched on.").
  - **List of rules**: one sentence each ("When a task moves to **Review** in **Year-end**, assign
    **Jesse Ray**"), its scope, an On/Off switch, Edit, Dry run, Archive. The switch: only the owner
    can turn a rule on; any admin can turn one off. Non-owners see "Only the owner can switch a rule on".
  - **New rule** form: Name; Applies to (Project or Client, then pick one); **When** [trigger] (plus a
    section or person when the trigger needs one); **Then** [action] (only actions that fit the
    trigger are offered) plus the action's fields; Save; Dry run.
  - **Dry run** panel: up to 25 matching tasks with what would happen to each ("Assign Jesse Ray (now
    Carmen)", "Already in Review: nothing to do"), plus a total. Writes nothing.
  - **Recent runs**: the last 50 runs (time, rule, task, what changed "from → to", OK / nothing to do /
    skipped / error with the reason). Enough for an admin to put a change back by hand.
- Staff (not admins) can read rules for projects and clients they can see (via the table; no screen
  in this version; used later to show "a rule did this").

Preview off: no nav item, no route, no page. Database: rules table empty, executor inert.

## 2. The fixed menu (no free-form logic, no scripting)

Triggers:
| key | meaning | needs |
|---|---|---|
| `section_moved` | task moved into section S of the project | project scope, a section of that project |
| `done` | task marked done (status becomes done) | none |
| `overdue` | task became overdue (due date passed, still open), checked once a day | none |
| `assigned` | task assigned (new task with an assignee, or the assignee changed) | optional: only when assigned to person P |

Actions:
| key | does | fields |
|---|---|---|
| `assign` | set the assignee | an active staff member who can open the client |
| `set_due` | due date = trigger day + N days | N 0..365, business days yes/no |
| `move_section` | move to section S | project scope, a section of that project |
| `comment` | post a System comment "Rule <name>: <text>" | text 1..1000 |
| `follow_up` | add a new task in the same client/project | title 1..200, due in N days (optional), assignee: same as the task or a person |

Allowed pairs (anything else is refused by the browser AND the database):
| trigger | assign | set_due | move_section | comment | follow_up |
|---|---|---|---|---|---|
| section_moved | yes | yes | no (loops) | yes | yes |
| done | no | no | yes | yes | yes |
| overdue | yes | no (would hide lateness) | yes | yes | no |
| assigned | no (loops) | yes | yes | yes | no |

Scope: exactly one project OR one client. A client rule matches that client's tasks in any project
or none. Rules act only on top-level shared tasks (`kind = 'task'`, `visibility = 'shared'`,
`parent_id is null`, not in the trash). Reminders, private tasks and subtasks are never touched.

## 3. Data (supabase/slateplus-rules.sql, additive only)

| Object | Purpose |
|---|---|
| `tk_rules(id, name, scope_kind, project_id, client_id, trigger_kind, trigger_config, action_kind, action_config, enabled, enabled_at, enabled_by, created_by, created_at, updated_by, updated_at, archived_at, archived_by)` | one rule; `enabled` default false; checks on scope, kinds and the pair table |
| `tk_rule_runs(id, rule_id, task_id, event_key, trigger_kind, action_kind, outcome, detail, from_value, to_value, created_task_id, comment_id, actor_email, depth, created_at)` | every run (ok / noop / skipped / error); unique (rule_id, task_id, event_key) |
| cron `tk-rules-overdue-daily` 11:50 UTC | `select public.tk_rules_overdue_tick()` |

RLS: both tables on, no anon, no write grants (RPCs only). `tk_rules` read: active admins all; other
active staff only rules whose project they can see (`tk_can_see_project`) or whose client they can
open (`can_access_client`). `tk_rule_runs` read: active admins who can read the task.

### RPCs (security definer, search_path public, execute revoked from public/anon)
- `tk_rule_save(p jsonb)` -> jsonb. Full admin. Insert (no id) or update (id). Validates with
  `tk__rule_problem` (same rules as the browser) and stores only the known config keys. An edit by
  anyone other than the owner switches the rule off (the owner approved what it did before).
- `tk_rule_set_enabled(p_id, p_on)` -> jsonb. On: owner only (`is_internal_owner()`), rule must still
  be valid. Off: any full admin. On stamps `enabled_at`/`enabled_by`.
- `tk_rule_archive(p_id, p_archived default true)` -> jsonb. Full admin. Archive also switches it off.
  Nothing is ever deleted.
- `tk_rule_dry_run(p jsonb)` -> jsonb. Full admin. Takes a saved rule id or an unsaved draft; returns
  `{ok, problem, live, enabled, total, matches:[{task_id, text, client_id, outcome, would, from, to}]}`.
  Candidates: section_moved = open tasks now in that section; done = done in the last 14 days;
  assigned = open tasks with that assignee (any when none set); overdue = open tasks past due.
  Uses the same planner as the executor. STABLE: writes nothing.
- `tk_rule_recent_runs(p_rule default null, p_limit default 50)` -> table. Full admin. Task title only
  when the caller can read the task.
- `tk_rules_overdue_tick()` -> int. Cron only (no execute for authenticated).

### Executor
- Triggers `tk_staff_reminders_zrules` (AFTER UPDATE, `when` the section changed, the task became done
  or the assignee changed) and `tk_staff_reminders_zrules_ins` (AFTER INSERT with an assignee).
  Named `z...` so they run after the deps triggers.
- First check: `tk__rules_live()` = `tk_settings.slateplus_enabled` is JSON true. Missing/false: return.
- Then only `enabled` and not archived rules in scope are read (indexed).
- Background changes do not trigger rules: when not already inside a rule run, any of the job flags
  above (`mgb.tk_generate`, `tk_rhythm`, `tk_ooo`, `tk_import`, `tk_migrate`, `tk_close`, `tk_undo`,
  `offboarding`) makes the trigger return. Undo of a change never fires rules.
- `tk__rule_fire(rule, task, event_key, depth, fired)`:
  1. **Loop guard** (pure rule mirrored in `TKRU_loopDecision`): depth >= 2 -> skipped "loop guard:
     too many rules in a row"; rule already in this chain's fired list -> skipped "loop guard: this
     rule already ran for this change". So a person's change can start rules, a rule's change can start
     other rules once, and nothing goes further; a rule never re-triggers itself.
  2. **Idempotent**: insert the run row first with `on conflict (rule_id, task_id, event_key) do
     nothing`; no row inserted = already handled. Event key: `<trigger>:<transaction id>` for event
     triggers, `overdue:<due date>` for overdue (once per due date).
  3. Plan with `tk__rule_plan` (skip / noop / do, with from and to), then act inside its own
     `begin ... exception` block so a failing rule never undoes or blocks the person's change; the
     error text goes to the run row.
  4. While acting: `mgb.tk_rule_depth`/`mgb.tk_rule_fired` carry the chain; `mgb.tk_generate = on`
     (the existing generator bypass: the change is server-made, so assignee pins do not revert it,
     the deps guard does not block it and no assignment email is queued); `mgb.tk_actor = system`
     (activity says System); `mgb.tk_rule = on` (lets the System comment through). All restored after.
- **On-time baseline**: a rule's due date change never moves `due_date_original` once it has a value
  (it puts the baseline back right after), so a rule can't be used to excuse lateness.
- Follow-up task: same client, project, owner (`staff_email`) and visibility as the trigger task;
  `source = 'rule'`, `source_ref = rule id`, `created_by` = the rule's author, status To do,
  `due_date_original` = its due date. Its insert can start one more rule (depth 1 -> 2).

### Widened existing function (one branch, every old input as before)
- `tk_comments_before_write`: a `system` comment written while `mgb.tk_rule = on` is stored with
  author `system` and no mentions (same shape as the rhythm branch). Applied by text replace of the
  live definition with an assertion that the anchor line exists exactly once.

## 4. Rules and edge cases

1. **Gate off (today)**: `tk__rules_live()` false, so the triggers return after one primary-key read;
   the cron tick returns 0. No rows exist either.
2. **Owner preview**: the switch is off, so nothing fires even for the owner. Dry run is the test.
3. **Section renamed or removed** after a rule was saved: section_moved never matches; move_section
   is skipped "section no longer in the project" (logged). Edit the rule.
4. **No emails or bell notices**: assignment under the generator flag queues nothing; follow-ups queue
   nothing; System comments carry no mentions. The person sees the change in the task's activity.
5. **Assign**: skipped when the task is done, in review (no reassigning in review), the person is
   inactive or can't open the client; noop when already theirs.
6. **Due date**: skipped on done tasks; noop when already that date. `due_at` follows (existing sync).
7. **Done**: fires on the final done (after review approval when review is required; Ready for review
   is not done). Reopen then done again is a new change and runs again.
8. **Overdue**: once per task per due date, only for tasks whose due date is on or after the day the
   rule was switched on (no flood of old late tasks), 200 tasks per rule per day at most.
9. **Bulk actions**: each row is its own change; the run log shows each one.
10. **View as**: the gate is off in View as, so the page never renders and no RPC runs.
11. **Clients**: no client screen, RPC or email reads the new tables; RLS gives clients nothing.
12. **Archived/trashed project**: rules stay but tasks in the trash are never touched; a trashed
    project can't receive a follow-up (existing trash guard raises; logged as error).
13. **Undo by hand**: every run row has from/to (assignee, due date, section) or the comment / new task id.

## 5. Self-critique (and what changed because of it)

- *Executor reaching people without the preview.* Fixed by the double gate: firm switch AND owner-
  enabled rule. Nothing runs until the owner launches Slate plus and switches a rule on.
- *Rule fires inside cron jobs, flooding.* Background job flags skip the executor.
- *Rule assigns but before_write silently reverts it* (non-admin trigger). Using the generator bypass
  flag during the action makes the change server-made. Side effects checked: assignment email off
  (wanted), deps guard skipped (a rule never blocks), close_key only for template inserts (follow-ups
  have none), review stamps on insert are passed explicitly.
- *Gaming the on-time score with a set_due rule.* Baseline restored after a rule's due change; no
  set_due on overdue.
- *Loops.* Pair table forbids the obvious self-loops; depth guard + fired list + one run per event key
  stop the rest.
- *A broken rule breaking staff work.* Every action is in its own exception block.
- *Performance.* One PK read per qualifying change while off; with the switch on, one indexed read of
  enabled rules per qualifying change.
- *Owner-only enable after launch* may be too strict once admins write rules. Design call for the
  owner (a one-line change in `tk_rule_set_enabled`).

Not in this slice: tags/labels (no field), follow-up from a recurring template (typed title instead),
bell notices, multiple actions per rule, conditions (priority, assignee filters beyond "assigned to").

## 6. Launch checklist (owner says go)

1. Final Opus verify with preview on and off; run `supabase/slateplus-rules-tests.sql`.
2. Owner flips `slateplus_enabled` (shared with the other Slate plus features).
3. Owner switches on the first rules after a Dry run.
4. Publish the guide article and What's new below; add the notice + tour (mgb-launch-kit).

## 7. Drafts (NOT published; publish at launch)

**Guide article `slate-rules` (Slate > Rules, admins)**
> Rules do small, repeat steps for you on one project or one client. Open **Rules** in the Slate
> sidebar and choose **New rule**. Pick what it applies to, then **When** (a task moves to a section,
> is marked done, becomes overdue, or is assigned) and **Then** (assign someone, set the due date a
> number of days out, move it to a section, post a comment, or add a follow-up task). Use **Dry run**
> to see which tasks it would change and how; it changes nothing. New rules start switched off; the
> owner switches them on. **Recent runs** lists everything a rule did, with the old and new value, so
> you can put a change back by hand. Rules never send emails and never run on a task twice for the
> same change.

**What's new**: "Rules for Slate projects and clients: when a task moves, is done, is late or is
assigned, Slate can assign, set a due date, move it, comment or add a follow-up. Try one with Dry run."

**Next-visit notice (admins)**: "New: Rules. Automate the small steps on a project. Dry run first."
**Tour stops**: sidebar Rules link (`data-tour="tk-rules-nav"`), New rule button
(`data-tour="tk-rules-new"`), Dry run (`data-tour="tk-rules-dry"`), Recent runs (`data-tour="tk-rules-runs"`).
