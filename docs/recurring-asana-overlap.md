# Recurring templates and the Asana import: no duplicates (2026-11-02)

Owner approved 2026-11-02. Goal: recurring templates (`task_templates`, made by `tk_generate`, daily cron
`task-templates-daily` at 10:15 UTC) can be turned on while staff still work in Asana until December, without a
second task for the same period. Asana stays read-only. Nothing is turned on by this change: no firm switch, no
preview flag, no template status.

State on 2026-11-02 (read-only check): 754 Asana-mirrored templates, all `draft`, none ever activated. 145 of them
have an open, unlinked Asana copy for the same client and title (148 copies, 14 with no due date). Until a
template is turned on, both new rules do nothing.

Built and applied: `supabase/recurring-asana-overlap.sql` (migration `recurring_asana_overlap`) and review fixes
`supabase/recurring-asana-overlap-fix1.sql` (migration `recurring_asana_overlap_fix1`). Self-test
`supabase/recurring-asana-overlap-tests.sql` (rolls back, passed). Rollback
`supabase/recurring-asana-overlap-rollback.sql` (not applied). JS in `scripts/asana-import/dailyImport.js`.
The apply-time skip in `tk_import_asana_apply` is checked by presence only in the self-test; its condition is
`tk__asana_task_covered`, which the self-test does exercise.

## The problem

- The daily Asana import (`scripts/asana-import/dailyImport.js`, runs until 2026-11-24) holds back a new Asana task
  only when an open portal task has the same client and exactly the same title. A template task is titled
  `<title> · <label>` (`Oct 2026`, `Wk of Nov 2`, `Q3 2026`, `FY 2026`, `2026`), so that guard never sees it.
- `tk__issue_period` skips a period only when `task_template_issued` already has (template, client, period). Asana's
  next copy, imported as a plain `source='asana'` task, is never linked, so the template makes a second task.

## Scope: Asana-mirrored templates only

Both rules apply only to templates with `task_templates.source = 'asana'`. Firm templates (`source` not `asana`,
including the 13 active ones today), standard sets, the month rhythm and custom (`occ`) schedules behave exactly as
before. A template rebuilt by hand as a firm template gets no guard (see edge cases).

## Matching rules (one definition, used by both sides)

A task **matches** a template period when all of these hold:

1. **Client:** same `client_id`.
2. **Title:** `tk__norm_title(task title)` equals the normalized effective title for that client
   (`tk__template_eff(...)->>'title'`) or the normalized template title. Normalized = curly single quotes to `'`,
   no-break spaces (U+00A0, U+202F) to spaces, runs of whitespace to one space, trimmed, lower case. JS `norm()`
   gives the same key (its `\s` already covers no-break spaces). On 2026-11-02 the import plan rows had the same
   titles as their templates (0 differ).
3. **Period window:** the task's due date is within N days of the period's due date. N is
   `tk__asana_match_days(kind)`: week 3, month 13, quarter 44, year and calendar year 120. N is under half the
   usual gap between two periods (7, 28, 89, 365 days), so one task normally matches one period of a template.
   Business-day rolls can shorten a gap (weekly to 6 days, monthly to about 25), so two windows can touch at the
   edges; the earlier period then adopts the copy. No due date = no match.

Data check on the open copies with a due date and a rule: weekly 72 of 72 within 3 days; monthly 56 of 60 within
13 days (the rest are 2 Compassion duplicates and 2 copies whose Asana due date was moved by 15+ days); quarterly
1 of 3.

## A. Generator adopts the Asana copy (`tk__issue_period`)

Order inside `tk__issue_period`: firm_part gate, due date, `exists` (issued key), `close_dup`, **then the new
adoption step**, then the assignee and create (unchanged). For an Asana-mirrored template on a week, month,
quarter, year or calendar-year period:

- `tk__asana_copy_for_period(template, eff, client, start, due)` looks for **open** imported copies:
  `source='asana'`, `template_id is null`, not trashed, not done, top level (`parent_id is null`), not already the
  task of any issued row, matching by the rules above.
- **Carry forward.** Asana makes the next copy of a recurring task when the last one is completed, often with a due
  date that drifts from the template's rule. When the previous period's issued task is done, the lower edge of the
  window becomes that task's due date + 1 (instead of due - N). This caught 13 real copies in the data check. If
  the previous task is still open, the normal window applies.
- **One match:** adopt the nearest copy (smallest day gap, then earliest due, then oldest, then id).
  - Dry run (Preview): `{status: 'would_adopt', reminder_id, due, copy_due, label}`. Nothing is written.
  - Real run: lock the copy (`for update skip locked`), insert `task_template_issued (template, client, period,
    reminder_id = copy, assignee = copy's assignee, else its owner)`, then set the copy's `template_id`, and for
    month, quarter and year its `period_kind` / `period_start` (the same columns the original import link set).
    Seeds `month_close` like a created task. Returns `{status: 'adopted', reminder_id, assignee, due, copy_due,
    label}`.
  - Nothing else on the copy changes: title, assignee, due date, status, `source='asana'` and `source_ref` stay, so
    the import's key check still sees it. `updated_at` changes (row update). No notification and no email.
- **Locking re-select** (fix1): before linking, the copy is re-read `for update skip locked` with every search
  condition again (open, unlinked, same client, `source='asana'`, top level, not in any issued row). A copy that
  was closed or trashed in between is also reported as `asana_copy_busy` (harmless; the next run decides again).
- **Ambiguous:** another Asana-mirrored template with `status = 'active'` (on or paused) for the same client has the
  same normalized title (its base title or its per-client title, fix1) ->
  `{status: 'skipped', reason: 'asana_copy_ambiguous'}`. Nothing is created or linked.
  Drafts and retired templates do not count. Fix by retiring one of the two.
- **Copy locked by another writer:** `{status: 'skipped', reason: 'asana_copy_busy'}`; the next run retries.
- **No copy:** unchanged; the template makes its own task.

`tk__generate` adds two result keys: `adopted` (count, real runs) and `would_adopt` (list, dry runs, capped at 500).
Existing keys keep their meaning. `tk_issue_missed` reports an adoption as `exists` with `adopted: true`, so the
Missed periods row closes with the existing "already had a task, so it's linked" message. No UI change.

## B. Import holds back a copy a template already covers

A **cover** is an issued row of an activated Asana-mirrored template (`activated_at is not null`) whose task is not
trashed (open or done), issued **after** the template was made (`issued_at > created_at`). The 2026-10-16 import
link wrote its issued rows in the same transaction that made the template (issued_at = created_at, 740 of 740
rows), so those original links never hold anything back. The cover's anchor is the task's original due date
(`coalesce(due_date_original, due_date)`): the rule due for a generated task, the Asana due for an adopted copy.

A new Asana task (top level, with client and due date) is **held back** when a cover exists for that client and
title with `|task due - anchor| <= N`.

- **Plan time** (`dailyImport.js`): the context query adds `covered` rows from
  `tk__asana_cover_rows(null, current_date - 200)`. `planDaily` holds the task back with
  `why: 'template_covers_period'` and counts it in `held_back` and `held_back_template`. Its subtasks are held
  back too (existing rule). An older context without `covered` behaves as before.
- **Apply time** (`tk_import_asana_apply`): the same check, `tk__asana_task_covered(client, title, due)`, runs again
  inside the transaction, so a task made by the generator between plan and apply is still caught. Skipped with
  reason `template_covers_period` in `skips`, counted in `held_back_template`, no map row.
- Held-back tasks get no map row, so they import on a later morning if the cover goes away (template task trashed).

## Locks (one writer at a time)

`tk__generate` already takes `pg_advisory_xact_lock(hashtext('tk_generate'))`. The same lock is now taken by
`tk_issue_missed` and by `tk_import_asana_apply`, so the generator, a manual "Issue" and the import never adopt,
create or import the same period at the same moment.

## Idempotent

- Adoption claims the period through the `task_template_issued` primary key; a re-run returns `exists`.
- An adopted copy has `template_id` set and an issued row, so it is excluded from every later search.
- A held-back Asana task is re-checked each morning and stays held while its cover exists.

## Edge cases (decided)

| Case | What happens |
|---|---|
| Copy already **closed** (done) in the portal | Not adopted (open copies only). The template makes its own task for that period, and that task then covers the period, so the import will not bring another Asana copy for it. Staff close the extra if the work was done. |
| Copy **trashed** | Never adopted, never a cover. The template makes its own task. |
| Copy has a **different assignee** than the template | Adopted as is. The copy keeps its Asana assignee. No reassignment, no email. |
| Copy **renamed** (in Asana or the portal) | Title no longer matches: not adopted, not held back. Can duplicate. The batch check lists it. |
| Copy's due date **moved** beyond the window | Not adopted. Can duplicate. The batch check lists it. 2 monthly copies today. |
| **Two templates, same title**, same client (Compassion weekly + monthly) | Once both are on, adoption skips with `asana_copy_ambiguous`; retire one first. The import holds back a copy covered by either. |
| **Two open copies** for one period | The nearest is adopted; the other stays as a plain Asana task. |
| Old **overdue** copy from an earlier period still open | Outside the window: left alone. The template makes this period's task (a different period). |
| Asana task with **no due date** | Never matched. 14 open copies have no due date. |
| Template task trashed later | No longer a cover: the held-back Asana copy imports the next morning. |
| Subtask of a parent held back at **apply** time | Skipped as `parent_not_imported` with a map row (existing rule), so it will not come back. Rare: plan time holds both back first. |
| **Missed** periods (due over 7 days ago) | Unchanged: listed, not created. "Issue" on one adopts a matching copy. |
| Other Unicode whitespace (beyond no-break spaces) | Postgres and JS may disagree; such a title might not match. |
| Template **paused** after issuing | Its issued rows still cover their periods, and it still counts for ambiguity. A **retired** template's rows still cover; it no longer counts for ambiguity. |
| Template rebuilt as a **firm** template (`source` not `asana`) | No adoption, no cover. It behaves like any firm template and can duplicate an Asana copy. Keep Asana-mirrored ones for clients still in Asana. |
| On-time stats | Adopted copies stay `source='asana'`, so they stay out of the on-time numbers like other imported tasks. |
| Previous period's copy **drifted** past the window and is still open, while that period's template task is done | Carry forward can let the next period adopt it (wrong period on the copy), and that period's real copy later imports as an extra. Rare; same family as moved due dates. |
| Very overdue Asana task (due 130+ days before its cover) | Plan time (covers since today - 200) can stage it and apply time (covers since due - 130) can hold it. Its subtasks then get a `parent_not_imported` map row. Not reachable until covers are months old. |
| The import's own same-title guard | Unchanged. It compares raw titles with a plain lower-case/whitespace fold (no curly quotes); the new cover rule uses the full norm. |

## Batch check before turning a batch on (read-only)

The portal's template **Preview** does not show adoptions yet: its tables show `would_create`, `upcoming`,
`skipped` and `missed`, so a template whose periods would all adopt reads "Nothing would be created now", and
`asana_copy_ambiguous` / `asana_copy_busy` show only as "Skipped". Use this SQL check instead (SQL editor,
read-only; it calls only stable helpers). For every open Asana copy of a batch template it shows which period
(previous, current or next) would adopt it.

- `check_result = RISK` means the template will not adopt that copy and may make its own task next to it: close
  or trash the copy, or fix its title or due date, before turning the batch on. Copies with no due date always
  show as a risk.
- `same_title_templates > 0` means retire one of the pair first (it would become `asana_copy_ambiguous`).

```sql
-- Put the batch's template ids in the array.
with b as (select unnest(array['00000000-0000-0000-0000-000000000000']::uuid[]) id),
tc as (
  select tt, tt.id, tt.title, x.client, public.tk__template_eff(tt, x.client) eff
    from task_templates tt join b on b.id = tt.id
    cross join unnest(tt.client_ids) x(client)
   where tt.source = 'asana'),
p as (
  select tc.*, s.start,
         public.tk_resolve_due(tc.eff -> 'rule', s.start, public.tk__period_end(tc.eff ->> 'kind', s.start)) due
    from tc
    cross join lateral (select public.tk_period_start_for(tc.eff ->> 'kind', current_date, tc.eff ->> 'fye') s0) a
    cross join lateral (values (public.tk_period_start_for(tc.eff ->> 'kind', a.s0 - 1, tc.eff ->> 'fye')), (a.s0),
                               (public.tk__period_end(tc.eff ->> 'kind', a.s0) + 1)) s(start)
   where a.s0 is not null),
ad as (
  select p.id, p.client, p.start, p.due,
         public.tk__asana_copy_for_period(p.tt, p.eff, p.client, p.start, p.due) res
    from p)
select tc.id template_id, tc.client, tc.eff ->> 'title' title, tc.eff ->> 'kind' kind,
       r.id reminder_id, r.text, r.due_date, coalesce(r.assignee_email, r.staff_email) who,
       ad.start adopted_by_period, ad.due period_due,
       case when ad.start is null then 'RISK' else 'ok' end check_result,
       (select count(*) from task_templates o
         where o.id <> tc.id and o.source = 'asana' and coalesce(o.status, '') <> 'retired'
           and tc.client = any (o.client_ids)
           and public.tk__norm_title(o.title) = public.tk__norm_title(tc.title)) same_title_templates
  from tc
  join staff_reminders r
    on r.client_id = tc.client and r.source = 'asana' and r.template_id is null and r.deleted_at is null
   and r.parent_id is null and r.status <> 'done' and not coalesce(r.done, false)
   and public.tk__norm_title(r.text) in (public.tk__norm_title(tc.eff ->> 'title'), public.tk__norm_title(tc.title))
  left join ad on ad.id = tc.id and ad.client = tc.client and ad.res ->> 'status' = 'match'
              and (ad.res ->> 'reminder_id')::uuid = r.id
 order by tc.client, title, r.due_date;
```

Tried on 2026-11-02 against 8 templates: it flagged copies with no due date and an overdue weekly copy, and
matched a monthly copy (rule "7th of next month") to the previous period.

### Rollout risk to watch: template tasks left open while the work is done in Asana

Asana makes the next copy of a recurring task only when the previous one is completed. Lead days are weekly 4,
monthly 14, quarterly 30. If staff complete the previous Asana task late, the next copy does not exist yet when
the generator reaches the period, so the template makes its own task (`source='template'`, counted in on-time
stats). The Asana copy that appears later is held back by the import, and staff keep working it in Asana. The
portal task then stays open and goes overdue unless someone closes it. This avoids duplicates as designed, but it
can lower on-time and performance numbers. During the overlap, check each batch's open template tasks weekly and
close the ones whose work was done in Asana. Keep late scoring off until Asana is retired.

## Rollback

Run `supabase/recurring-asana-overlap-rollback.sql`. It undoes `-fix1.sql` and then the main file in reverse order,
putting each anchor's original text back, and fails if any patch is left (it was tried on production inside a
transaction that was rolled back, 2026-11-02). Re-running the main file with the anchors swapped does not work,
because `patch_fn` sees the old text still inside the patched body. The helpers and the index stay (unused). JS:
revert the commit. No table column, RLS, cron or data change. After a rollback, Asana tasks that were held back
import the next morning and may duplicate the template tasks; trash or close the extras.

Adopted copies keep their `template_id` and issued rows after a rollback; they behave like the original import
links.
