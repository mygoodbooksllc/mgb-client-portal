-- Recurring task templates (owner request 2026-09-29).
--
-- Applied to production 2026-09-29 as migrations task_templates and
-- tt_onboarding_advisor_fixes (revoke + client_id index).
-- Safe to re-run.
--
--   task_templates        admin-defined recurring work: title, cadence
--                         (monthly / quarterly / annually), due_offset_days,
--                         lead_days, and who it applies to (plan tiers and/or
--                         specific clients; both empty = every client).
--   task_template_issued  dedupe ledger, one row per template x client x
--                         period ever generated. Kept separately from
--                         staff_reminders so a bookkeeper deleting a generated
--                         task doesn't make the next run recreate it.
--
-- Dates. For a period (month / quarter / year) the task is due
--   last day of the period + due_offset_days
-- (0 = the last day of the period, 10 = the 10th of the next month for a
-- monthly template, -5 = five days before period end). A task is generated
-- once today is within lead_days of its due date and the due date hasn't
-- passed.
--
-- Generated rows in staff_reminders (how they show up in My Tasks):
--   staff_email = assignee_email = the client's assigned bookkeeper, so the
--                 task is "mine" for them (isMyStaffItem) and counts in
--                 their due badge;
--   visibility  = 'shared' + client_id, so anyone covering the client sees it
--                 and admins read everything anyway;
--   created_by  = the admin who pressed "Generate now", or the bookkeeper
--                 themself when the daily cron runs (no JWT -> the
--                 staff_reminders trigger falls back to staff_email);
--   source      = 'template', source_ref = '<template_id>:<client_id>:<period>'
--                 (period = YYYY-MM-DD, first day of the period). A partial
--                 unique index on source_ref backs the dedupe.
--
-- Assigned bookkeeper. tt_client_bookkeeper() resolves the client to an
-- active staff email: clients.assigned_bookkeeper_email (the real staff link,
-- supabase/assigned-bookkeeper-email.sql, applied 2026-09-29 together with
-- migration tt_bookkeeper_prefers_email) if that person is active, else the
-- legacy display JSON clients.assigned_bookkeeper ({name, role, initials},
-- optionally email): an "email" key if present, else an active staff member
-- with the same name, else the first bookkeeper-role staff
-- member in staff_client_access for the client, else anyone in
-- staff_client_access. No match = skipped (and counted, so the admin page
-- can say so).
--
-- Running it:
--   tt_generate_template_tasks()  internal, callable only by postgres; the
--                                 pg_cron job "task-templates-daily" runs it
--                                 at 10:15 UTC.
--   tt_generate_now()             RPC for the "Generate now" button; admins
--                                 only.

create table if not exists public.task_templates (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,
  cadence         text not null default 'monthly',
  due_offset_days integer not null default 10,
  lead_days       integer not null default 14,
  plan_tiers      text[] not null default '{}',
  client_ids      text[] not null default '{}',
  priority        text not null default 'normal',
  active          boolean not null default true,
  created_by      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint task_templates_title_len check (length(title) between 1 and 200),
  constraint task_templates_cadence check (cadence in ('monthly', 'quarterly', 'annually')),
  constraint task_templates_offset check (due_offset_days between -90 and 120),
  constraint task_templates_lead check (lead_days between 0 and 90),
  constraint task_templates_plan_tiers check (plan_tiers <@ array['basic', 'standard', 'premium']::text[]),
  constraint task_templates_priority check (priority in ('low', 'normal', 'high'))
);

create or replace function public.task_templates_before_write()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_by := coalesce(nullif(auth.jwt() ->> 'email', ''), new.created_by);
  end if;
  return new;
end;
$$;

drop trigger if exists task_templates_before_write on public.task_templates;
create trigger task_templates_before_write
  before insert or update on public.task_templates
  for each row execute function public.task_templates_before_write();

alter table public.task_templates enable row level security;

drop policy if exists "admins manage task templates" on public.task_templates;
create policy "admins manage task templates" on public.task_templates
  for all to authenticated
  using (public.is_active_staff_admin())
  with check (public.is_active_staff_admin());

revoke all on public.task_templates from anon;
grant select, insert, update, delete on public.task_templates to authenticated;

create table if not exists public.task_template_issued (
  template_id uuid not null references public.task_templates(id) on delete cascade,
  client_id   text not null references public.clients(id) on delete cascade,
  period      date not null,
  reminder_id uuid,
  assignee    text,
  issued_at   timestamptz not null default now(),
  primary key (template_id, client_id, period)
);

create index if not exists task_template_issued_client_idx on public.task_template_issued (client_id);

alter table public.task_template_issued enable row level security;

drop policy if exists "admins read issued template tasks" on public.task_template_issued;
create policy "admins read issued template tasks" on public.task_template_issued
  for select to authenticated
  using (public.is_active_staff_admin());

revoke all on public.task_template_issued from anon;
revoke insert, update, delete on public.task_template_issued from authenticated;
grant select on public.task_template_issued to authenticated;

create unique index if not exists staff_reminders_template_ref_uniq
  on public.staff_reminders (source_ref)
  where source = 'template';

-- ---------------------------------------------------------------------------
-- Assigned bookkeeper -> staff email
-- ---------------------------------------------------------------------------

create or replace function public.tt_client_bookkeeper(p_client_id text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  with c as (
    select assigned_bookkeeper ab, assigned_bookkeeper_email abe from clients where id = p_client_id
  )
  select coalesce(
    (select s.email from staff s, c
      where s.active and s.email = c.abe limit 1),
    (select s.email from staff s, c
      where s.active and lower(s.email) = lower(c.ab ->> 'email') limit 1),
    (select s.email from staff s, c
      where s.active and nullif(trim(c.ab ->> 'name'), '') is not null
        and lower(trim(s.name)) = lower(trim(c.ab ->> 'name'))
      order by s.created_at limit 1),
    (select s.email from staff_client_access sca join staff s on s.email = sca.staff_email
      where sca.client_id = p_client_id and s.active and s.role = 'bookkeeper'
      order by sca.created_at limit 1),
    (select s.email from staff_client_access sca join staff s on s.email = sca.staff_email
      where sca.client_id = p_client_id and s.active
      order by sca.created_at limit 1)
  );
$$;

-- Internal only: it returns a staff email for any client id, so nobody
-- signed in (client portal users included) may call it directly.
revoke execute on function public.tt_client_bookkeeper(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Generator
-- ---------------------------------------------------------------------------

create or replace function public.tt_generate_template_tasks(p_today date default current_date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_created integer := 0;
  v_skipped integer := 0;
  r record;
  v_id uuid;
begin
  for r in
    with t as (
      select * from task_templates where active
    ),
    periods as (
      select t.id template_id, gs::date period_start,
        case t.cadence
          when 'monthly' then (gs + interval '1 month' - interval '1 day')::date
          when 'quarterly' then (gs + interval '3 months' - interval '1 day')::date
          else (gs + interval '1 year' - interval '1 day')::date
        end period_end
      from t
      cross join lateral generate_series(
        date_trunc(case t.cadence when 'monthly' then 'month' when 'quarterly' then 'quarter' else 'year' end,
                   p_today - interval '2 years'),
        date_trunc(case t.cadence when 'monthly' then 'month' when 'quarterly' then 'quarter' else 'year' end,
                   p_today + interval '1 year'),
        case t.cadence when 'monthly' then interval '1 month' when 'quarterly' then interval '3 months' else interval '1 year' end
      ) gs
    )
    select t.id template_id, t.title, t.cadence, t.priority, c.id client_id,
           p.period_start, (p.period_end + t.due_offset_days) due_date
    from t
    join periods p on p.template_id = t.id
    join clients c on (
      (cardinality(t.plan_tiers) = 0 and cardinality(t.client_ids) = 0)
      or c.plan = any(t.plan_tiers)
      or c.id = any(t.client_ids)
    )
    where (p.period_end + t.due_offset_days) >= p_today
      and (p.period_end + t.due_offset_days) - t.lead_days <= p_today
      and not exists (
        select 1 from task_template_issued i
        where i.template_id = t.id and i.client_id = c.id and i.period = p.period_start
      )
  loop
    declare
      v_assignee text := tt_client_bookkeeper(r.client_id);
      v_label text := case r.cadence
        when 'monthly' then to_char(r.period_start, 'Mon YYYY')
        when 'quarterly' then 'Q' || extract(quarter from r.period_start)::int || ' ' || extract(year from r.period_start)::int
        else extract(year from r.period_start)::int::text
      end;
    begin
      if v_assignee is null then
        v_skipped := v_skipped + 1;
        continue;
      end if;

      v_id := null;
      insert into staff_reminders (
        staff_email, assignee_email, text, client_id, priority, due_date,
        kind, recurrence, visibility, source, source_ref
      ) values (
        v_assignee, v_assignee, r.title || ' · ' || v_label, r.client_id, r.priority, r.due_date,
        'task', 'none', 'shared', 'template',
        r.template_id::text || ':' || r.client_id || ':' || to_char(r.period_start, 'YYYY-MM-DD')
      )
      on conflict (source_ref) where source = 'template' do nothing
      returning id into v_id;

      insert into task_template_issued (template_id, client_id, period, reminder_id, assignee)
      values (r.template_id, r.client_id, r.period_start, v_id, v_assignee)
      on conflict do nothing;

      if v_id is not null then
        v_created := v_created + 1;
      end if;
    end;
  end loop;

  return jsonb_build_object('created', v_created, 'skipped_no_assignee', v_skipped);
end;
$$;

revoke execute on function public.tt_generate_template_tasks(date) from public, anon, authenticated;

create or replace function public.tt_generate_now()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_active_staff_admin() then
    raise exception 'Only admins can generate template tasks' using errcode = '42501';
  end if;
  return public.tt_generate_template_tasks(current_date);
end;
$$;

revoke execute on function public.tt_generate_now() from public, anon;
grant execute on function public.tt_generate_now() to authenticated;

-- Daily at 10:15 UTC (early morning US time).
select cron.schedule(
  'task-templates-daily',
  '15 10 * * *',
  $$select public.tt_generate_template_tasks()$$
);
