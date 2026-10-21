-- =====================================================================
-- Slate month rhythm, slice 4b: 24th auto-complete + account manager notice
-- Applied to production 2026-10-21 (migration slate_rhythm_4b_daily). Self-test: slate-rhythm-4b-daily-tests.sql (all ok). Dry run today: 0 notices, 0 emails, 0 completed.
-- Spec: docs/slate-rhythm-slice-4.md (d) and (e). Additive only.
-- Self-test: supabase/slate-rhythm-4b-daily-tests.sql (rolls back).
--
-- 1. tk_comments_before_write: one additive branch so this job can write a
--    'system' note ("Nothing outstanding") with no signed-in person. It only
--    applies while mgb.tk_rhythm = 'on', which only tk_rhythm_daily sets.
-- 2. tk_rhythm_notices: one row per (row 7 task, recipient). The bell reads
--    these for the signed-in person. Nobody writes them from the app.
-- 3. tk_rhythm_daily(p_today): idempotent; acts only on clients where the
--    firm switch month_rhythm_enabled is on, or the client is test_only or
--    internal (the generator rule from slice 2b). Emails only when the switch
--    is strictly on and the client is a real client.
-- 4. cron job month-rhythm-daily at 10:40 UTC, after task-templates-daily.
--
-- Rollback: select cron.unschedule('month-rhythm-daily');
--   drop function public.tk_rhythm_daily(date); drop table public.tk_rhythm_notices;
--   and remove the "tk rhythm s4" branch from tk_comments_before_write.
-- =====================================================================

create or replace function pg_temp.patch_fn(p_sig text, p_from text, p_to text, p_expected int)
returns void language plpgsql as $f$
declare d text; n int;
begin
  d := pg_get_functiondef(p_sig::regprocedure);
  if position(p_to in d) > 0 then return; end if;
  n := (length(d) - length(replace(d, p_from, ''))) / length(p_from);
  if n <> p_expected then raise exception 'patch_fn %: expected % occurrence(s) of anchor %, found %', p_sig, p_expected, p_from, n; end if;
  execute replace(d, p_from, p_to);
end $f$;

-- 1. System note branch --------------------------------------------------
select pg_temp.patch_fn('public.tk_comments_before_write()',
$a$    if v_me = '' or not public.is_active_staff() then
      raise exception 'tk_forbidden' using errcode = '42501';$a$,
$b$    -- tk rhythm s4: a system note from the month rhythm daily job
    if new.kind = 'system' and coalesce(current_setting('mgb.tk_rhythm', true), '') = 'on' and v_me = '' then
      new.author_email := 'system';
      new.mentions := '{}';
      new.created_at := now();
      new.edited_at := null; new.edited_by := null; new.deleted_at := null; new.deleted_by := null;
      return new;
    end if;
    if v_me = '' or not public.is_active_staff() then
      raise exception 'tk_forbidden' using errcode = '42501';$b$, 1);

-- 2. Notices -------------------------------------------------------------
create table if not exists public.tk_rhythm_notices (
  id uuid primary key default gen_random_uuid(),
  recipient_email text not null check (recipient_email = lower(recipient_email)),
  client_id text not null references public.clients(id) on delete cascade,
  period date not null check (period = date_trunc('month', period)::date),
  task_id uuid not null references public.staff_reminders(id) on delete cascade,
  kind text not null default 'second_preliminary' check (kind in ('second_preliminary')),
  created_at timestamptz not null default now(),
  unique (task_id, recipient_email)
);
create index if not exists tk_rhythm_notices_recipient_idx on public.tk_rhythm_notices (recipient_email, created_at desc);
alter table public.tk_rhythm_notices enable row level security;
drop policy if exists "tk rhythm notices own read" on public.tk_rhythm_notices;
create policy "tk rhythm notices own read" on public.tk_rhythm_notices
  for select to authenticated
  using (public.is_active_staff() and recipient_email = lower(coalesce(auth.jwt() ->> 'email', '')));
revoke all on public.tk_rhythm_notices from anon, authenticated;
grant select on public.tk_rhythm_notices to authenticated;

-- 3. The daily job --------------------------------------------------------
create or replace function public.tk_rhythm_daily(p_today date default (now() at time zone 'America/Chicago')::date)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_on boolean := coalesce(public.tk__jsonb_bool((select value from tk_settings where key = 'month_rhythm_enabled')), false);
  v_t7 uuid := (select id from task_templates where source_ref = 'month_rhythm:7_follow_up' limit 1);
  v_t8 uuid := (select id from task_templates where source_ref = 'month_rhythm:8_follow_up' limit 1);
  t record;
  v_to text;
  v_new int;
  v_notices int := 0;
  v_emails int := 0;
  v_done int := 0;
  v_ids uuid[];
begin
  if v_t7 is null and v_t8 is null then
    return jsonb_build_object('notices', 0, 'emails', 0, 'completed', 0);
  end if;
  perform set_config('mgb.tk_actor', 'system', true);

  -- (e) Second preliminary month in a row: notify the account manager.
  for t in
    select r.id, r.client_id, r.period_start, r.description, c.name as client_name,
           (coalesce(c.test_only, false) or coalesce(c.is_internal, false)) as is_test
      from staff_reminders r
      join clients c on c.id = r.client_id
     where r.template_id = v_t7
       and r.deleted_at is null
       and r.period_kind = 'month' and r.period_start is not null
       and r.due_date between p_today - 7 and p_today
       and (v_on or coalesce(c.test_only, false) or coalesce(c.is_internal, false))
       and exists (select 1 from tk_report_state s where s.client_id = r.client_id
                     and s.period = date_trunc('month', r.period_start)::date and s.state = 'preliminary')
       and exists (select 1 from tk_report_state s where s.client_id = r.client_id
                     and s.period = (date_trunc('month', r.period_start) - interval '1 month')::date and s.state = 'preliminary')
  loop
    if coalesce(t.description, '') not like 'Second month in a row.%' then
      perform set_config('mgb.tk_generate', 'on', true);
      update staff_reminders
         set description = 'Second month in a row. ' || coalesce(description, '')
       where id = t.id;
      perform set_config('mgb.tk_generate', '', true);
    end if;
    for v_to in
      select p.email from public.tk__client_people(t.client_id) p where p.role = 'account_manager'
      union
      select lower(s.email) from staff s
       where s.active and s.role = 'admin'
         and not exists (select 1 from public.tk__client_people(t.client_id) p where p.role = 'account_manager')
    loop
      insert into tk_rhythm_notices (recipient_email, client_id, period, task_id)
      values (v_to, t.client_id, date_trunc('month', t.period_start)::date, t.id)
      on conflict (task_id, recipient_email) do nothing;
      get diagnostics v_new = row_count;
      if v_new = 0 then continue; end if;
      v_notices := v_notices + 1;
      if v_on and not t.is_test then
        perform public.tk__enqueue('staff_task_batch', v_to, t.client_id, 'rhythm_second:' || t.id::text,
          jsonb_build_object(
            'title', left('Preliminary reports two months in a row: ' || coalesce(t.client_name, t.client_id), 120),
            'intro', left('Reports for ' || coalesce(t.client_name, t.client_id) || ' went out as preliminary for '
                          || to_char(t.period_start, 'FMMonth YYYY') || ' and the month before. The follow-up task is open.', 400),
            'items', jsonb_build_array(left('Follow up: ' || coalesce(t.client_name, t.client_id), 200)),
            'hash', '#/tasks/my?item=task:' || t.id::text));
        v_emails := v_emails + 1;
      end if;
    end loop;
  end loop;

  -- (d) Nothing outstanding: close rows 7 and 8 when the client owes nothing.
  select coalesce(array_agg(r.id), '{}') into v_ids
    from staff_reminders r
    join clients c on c.id = r.client_id
   where r.template_id in (v_t7, v_t8)
     and r.deleted_at is null
     and r.status in ('todo', 'in_progress')
     and not coalesce(r.done, false)
     and r.period_kind = 'month' and r.period_start is not null
     and r.due_date between p_today - 31 and p_today
     and (v_on or coalesce(c.test_only, false) or coalesce(c.is_internal, false))
     and not exists (select 1 from client_requests q
                      where q.client_id = r.client_id and q.status = 'open'
                        and q.deleted_at is null and not coalesce(q.legacy_doc_request, false))
     and (r.template_id = v_t7
          or not exists (select 1 from tk_report_state s where s.client_id = r.client_id
                           and s.period = date_trunc('month', r.period_start)::date and s.state = 'preliminary'));
  if cardinality(v_ids) > 0 then
    perform set_config('mgb.tk_rhythm', 'on', true);
    perform set_config('mgb.tk_generate', 'on', true);
    update staff_reminders set status = 'done' where id = any (v_ids);
    get diagnostics v_done = row_count;
    perform set_config('mgb.tk_generate', '', true);
    insert into tk_comments (task_id, body, kind)
    select x, 'Nothing outstanding', 'system' from unnest(v_ids) x;
    perform set_config('mgb.tk_rhythm', '', true);
  end if;
  perform set_config('mgb.tk_actor', '', true);
  return jsonb_build_object('notices', v_notices, 'emails', v_emails, 'completed', v_done);
end $$;
revoke all on function public.tk_rhythm_daily(date) from public, anon, authenticated;

-- 4. Schedule -------------------------------------------------------------
select cron.unschedule(jobid) from cron.job where jobname = 'month-rhythm-daily';
select cron.schedule('month-rhythm-daily', '40 10 * * *', $$select public.tk_rhythm_daily();$$);

do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.tk_rhythm_notices'::regclass) then
    raise exception 'RLS off on tk_rhythm_notices';
  end if;
  if has_table_privilege('authenticated', 'public.tk_rhythm_notices', 'insert') then
    raise exception 'authenticated can insert tk_rhythm_notices';
  end if;
  if has_function_privilege('authenticated', 'public.tk_rhythm_daily(date)', 'execute') then
    raise exception 'authenticated can run tk_rhythm_daily';
  end if;
  if position('tk rhythm s4' in pg_get_functiondef('public.tk_comments_before_write()'::regprocedure)) = 0 then
    raise exception 'comment branch missing';
  end if;
  if not exists (select 1 from cron.job where jobname = 'month-rhythm-daily') then
    raise exception 'cron job missing';
  end if;
end $$;
