-- Slate plus: workload strip (docs/slateplus-workload-spec.md).
--
-- Additive and read-only. One RPC, tk_slateplus_workload(), returns task
-- COUNTS per active staff member for the Slate page's "Team load" strip:
--   open_count  open tasks assigned to them (not done, not waiting on the
--               client, not trashed, not Unassigned)
--   due_week    of those, due Monday..Sunday of this week (America/Chicago)
--   late_count  of those, late by the firm rule (tk_late_count_from +
--               tk_late_excused); NULL while late tasks don't count against
--               staff (grace period), so the app hides the column
-- No task text, client ids, client names or any other field leaves here.
-- Test and internal (MGB) clients never count, same as Team > Capacity.
-- Other people's private tasks are not counted; your own row counts yours.
--
-- Who sees what (decision in the spec, section 4):
--   admins and account managers (account_manager_email on a real client)
--     every active staff member
--   everyone else (active staff)       only their own row
--   anyone else (clients, anon)        refused (42501)
-- Hours stay where they are (staff_capacity + qbo_hours_by_staff, admin only);
-- the app adds them client-side for admins.
--
-- Also: tk_settings.slateplus_enabled (the shared firm switch for the Slate
-- plus batch) becomes owner-only in tk__owner_only_key. No row is inserted;
-- missing = off. Code never writes it.
--
-- Safe to re-run. Self-test: supabase/slateplus-workload-tests.sql (rolls back).
-- Applied to production 2026-10-27 (project xumsqmhccgfjnlmieqyu).

create or replace function public.tk_slateplus_workload()
returns table (
  staff_id uuid,
  email text,
  name text,
  role text,
  is_me boolean,
  open_count integer,
  due_week integer,
  late_count integer,
  week_start date,
  week_end date
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_all boolean;
  v_today date := (now() at time zone 'America/Chicago')::date;
  v_ws date;
  v_we date;
  v_late_from date := public.tk_late_count_from();
begin
  if v_me = '' or not public.is_active_staff() then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  v_ws := date_trunc('week', v_today)::date;   -- Monday
  v_we := v_ws + 6;
  v_all := public.is_active_staff_admin()
        or exists (select 1 from public.clients c
                    where lower(c.account_manager_email) = v_me
                      and coalesce(c.is_internal, false) = false
                      and coalesce(c.test_only, false) = false);

  return query
  with people as (
    select s.id, lower(s.email) as em, s.name, s.role
      from public.staff s
     where s.active = true
       and (v_all or lower(s.email) = v_me)
  ),
  t as (
    select lower(r.assignee_email) as em, r.due_date, r.status, r.client_id,
           r.period_kind, r.period_start
      from public.staff_reminders r
      left join public.clients c on c.id = r.client_id
     where r.done = false
       and r.deleted_at is null
       and coalesce(r.is_unassigned, false) = false
       and r.assignee_email is not null
       and coalesce(r.status, 'todo') not in ('done', 'waiting_client')
       and (r.client_id is null
            or (c.id is not null and coalesce(c.is_internal, false) = false and coalesce(c.test_only, false) = false))
       and (coalesce(r.visibility, '') <> 'private' or lower(r.assignee_email) = v_me)
       and lower(r.assignee_email) in (select p.em from people p)
  )
  select p.id, p.em, coalesce(p.name, split_part(p.em, '@', 1)), coalesce(p.role, ''),
         p.em = v_me,
         count(t.em)::integer,
         count(t.em) filter (where t.due_date between v_ws and v_we)::integer,
         case when v_late_from is null then null
              else (count(t.em) filter (
                      where t.due_date < v_today and t.due_date >= v_late_from
                        and not public.tk_late_excused(t.status, t.client_id, t.period_kind, t.period_start)))::integer
         end,
         v_ws, v_we
    from people p
    left join t on t.em = p.em
   group by p.id, p.em, p.name, p.role
   order by 6 desc, 2;
end;
$$;

revoke all on function public.tk_slateplus_workload() from public, anon;
grant execute on function public.tk_slateplus_workload() to authenticated;

-- Owner-only firm switch (re-read from production right before applying;
-- every live key kept, plus slateplus_enabled; idempotent if a sibling Slate
-- plus build already added it).
create or replace function public.tk__owner_only_key(p_key text)
returns boolean
language sql
immutable
set search_path = public
as $fn$
  select p_key in ('client_request_enabled', 'client_request_pilot', 'standard_set_live',
                   'late_tasks_count_against_staff', 'late_tasks_effective_from',
                   'wb_enabled', 'desk_app_enabled', 'nav_enabled', 'lato_enabled',
                   'month_rhythm_enabled', 'slate_app_enabled',
                   'brand_enabled', 'hovernav_enabled',
                   'org_profile_enabled',
                   'deskplus_enabled',
                   'threadmenu_enabled',
                   'slateplus_enabled');
$fn$;

notify pgrst, 'reload schema';
