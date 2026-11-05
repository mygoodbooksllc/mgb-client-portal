-- Review board: Deadline digest (docs/review-board-spec.md section 4a, with
-- the owner decision of 2026-11-05: the digest counts every rhythm task that
-- exists, test and internal clients included).
--
-- Additive:
--   * tk_rhythm_notices gets a second kind, 'deadline_digest' (task_id and
--     client_id become nullable; new columns part, counts, updated_at; a shape
--     check keeps 'second_preliminary' rows exactly as before; one digest row
--     per recipient, period and part via a partial unique index).
--   * rb_deadline_digest(p_today) upserts the rows. Callable by nobody but
--     the cron job (postgres). Writes nothing unless the owner-only switch
--     reviewboard_digest_enabled is strictly on, reviewboard_digest_to is a
--     non-empty array, and rhythm tasks fall in the window.
--   * pg_cron job 'review-board-digest' at 10:50 UTC daily (10 minutes after
--     month-rhythm-daily).
-- Recipients only ever see their own rows (existing policy "tk rhythm notices
-- own read"). Nothing here sends email.
--
-- Applied to production 2026-11-05 (project xumsqmhccgfjnlmieqyu, migration reviewboard_3_digest).

alter table public.tk_rhythm_notices alter column task_id drop not null;
alter table public.tk_rhythm_notices alter column client_id drop not null;
alter table public.tk_rhythm_notices add column if not exists part text;
alter table public.tk_rhythm_notices add column if not exists counts jsonb;
alter table public.tk_rhythm_notices add column if not exists updated_at timestamptz;

alter table public.tk_rhythm_notices drop constraint if exists tk_rhythm_notices_kind_check;
alter table public.tk_rhythm_notices add constraint tk_rhythm_notices_kind_check
  check (kind in ('second_preliminary', 'deadline_digest'));
alter table public.tk_rhythm_notices drop constraint if exists tk_rhythm_notices_shape;
alter table public.tk_rhythm_notices add constraint tk_rhythm_notices_shape
  check ((kind = 'second_preliminary' and task_id is not null and client_id is not null)
      or (kind = 'deadline_digest' and task_id is null and part in ('check_in', 'reports', 'follow_up')
          and counts is not null and jsonb_typeof(counts) = 'object'));
create unique index if not exists tk_rhythm_notices_digest_uq
  on public.tk_rhythm_notices (recipient_email, period, part) where kind = 'deadline_digest';

-- counts = {total, done, not_needed, open, test_tasks, test}
--   done includes not_needed (auto-closed by the rhythm job, actor 'system');
--   test_tasks = tasks on test_only or internal clients;
--   test = every counted task is on a test/internal client (bell prefix "Test clients ·").
create or replace function public.rb_deadline_digest(p_today date default (now() at time zone 'America/Chicago')::date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_on   boolean := coalesce(public.tk__jsonb_bool((select s.value from tk_settings s where s.key = 'reviewboard_digest_enabled')), false);
  v_to   jsonb   := (select s.value from tk_settings s where s.key = 'reviewboard_digest_to');
  v_rows int := 0;
begin
  if p_today is null or not v_on or v_to is null or jsonb_typeof(v_to) <> 'array' or jsonb_array_length(v_to) = 0 then
    return jsonb_build_object('rows', 0, 'skipped', 'off');
  end if;
  with t as (
    select tt.due_rule ->> 'part' as part, r.period_start as period, r.status, r.due_date,
           (coalesce(c.test_only, false) or coalesce(c.is_internal, false)) as test_client,
           (r.status = 'done' and exists (
              select 1 from tk_activity a
               where a.task_id = r.id and a.kind = 'status' and a.to_value = 'done' and a.actor_email = 'system')) as auto
      from task_templates tt
      join staff_reminders r on r.template_id = tt.id
      join clients c on c.id = r.client_id
     where tt.source_ref in ('month_rhythm:2_check_in', 'month_rhythm:6_reports', 'month_rhythm:7_follow_up')
       and r.deleted_at is null and r.parent_id is null
       and r.period_kind = 'month' and r.period_start is not null
       and (c.lost_at is null or c.lost_at > p_today)),
  win as (   -- (part, period) pairs with any task due in the window: due day .. +9 days
    select distinct part, period from t where due_date between p_today - 9 and p_today),
  agg as (   -- then count ALL tasks of that part and period, so totals do not drift
    select t.part, t.period, count(*) as total,
           count(*) filter (where t.status = 'done') as done,
           count(*) filter (where t.auto) as not_needed,
           count(*) filter (where t.test_client) as test_tasks
      from t join win using (part, period)
     group by t.part, t.period),
  rcp as (
    select distinct lower(btrim(e)) as email
      from jsonb_array_elements_text(v_to) e
      join staff s on lower(s.email) = lower(btrim(e)) and s.active and s.role = 'admin')
  insert into tk_rhythm_notices (recipient_email, period, kind, part, counts, updated_at)
  select rcp.email, agg.period, 'deadline_digest', agg.part,
         jsonb_build_object('total', agg.total, 'done', agg.done, 'not_needed', agg.not_needed,
                            'open', agg.total - agg.done, 'test_tasks', agg.test_tasks,
                            'test', agg.test_tasks = agg.total),
         now()
    from agg cross join rcp
  on conflict (recipient_email, period, part) where kind = 'deadline_digest'
  do update set counts = excluded.counts, updated_at = now()
   where tk_rhythm_notices.counts is distinct from excluded.counts;
  get diagnostics v_rows = row_count;
  return jsonb_build_object('rows', v_rows);
end $$;
revoke all on function public.rb_deadline_digest(date) from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'review-board-digest';
select cron.schedule('review-board-digest', '50 10 * * *', $$select public.rb_deadline_digest();$$);

notify pgrst, 'reload schema';
