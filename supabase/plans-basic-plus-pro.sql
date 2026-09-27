-- Three client plans: Basic (free), Plus and Pro (owner decision 2026-09-26).
--
-- The stored plan values stay as they were so nothing else has to migrate:
--   'basic'    -> Basic  (new; free, barebones)
--   'standard' -> Plus
--   'premium'  -> Pro
-- The app maps these to display names in one place (PLAN_LABELS in app.jsx).
--
-- What this does:
--   1. Allows 'basic' on clients.plan.
--   2. Adds the Basic Test Client and renames the other two test clients to
--      match the new plan names.
--   3. Upgrade requests record which plan was asked for (Basic clients can
--      ask for Plus or Pro), via an optional p_plan on
--      request_enterprise_upgrade().
-- Safe to re-run. Applied to production 2026-09-27.

begin;

alter table public.clients drop constraint if exists clients_plan_check;
alter table public.clients
  add constraint clients_plan_check check (plan in ('basic', 'standard', 'premium'));

insert into public.clients (id, name, org_type, plan, test_only, payroll_add_on, assigned_bookkeeper)
values ('basic-test', 'Basic Test Client', 'Church', 'basic', true, false,
        '{"name": "Marcus Webb", "role": "Bookkeeper", "initials": "MW"}'::jsonb)
on conflict (id) do nothing;

update public.clients set name = 'Plus Test Client' where id = 'new-hope' and name = 'Standard Test Client';
update public.clients set name = 'Pro Test Client' where id = 'grace-community' and name = 'Premium Test Client';

alter table public.enterprise_upgrade_requests
  add column if not exists requested_plan text
  check (requested_plan is null or requested_plan in ('standard', 'premium'));

drop function if exists public.request_enterprise_upgrade(text, text);

create or replace function public.request_enterprise_upgrade(
  p_client_id text,
  p_requested_by text,
  p_plan text default null
)
returns enterprise_upgrade_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_open_count integer;
  v_row enterprise_upgrade_requests;
begin
  if p_client_id is null or length(trim(p_client_id)) = 0 then
    raise exception 'invalid_client_id' using errcode = 'P0001';
  end if;

  if auth.jwt() ->> 'email' is null then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;

  if not (
    public.can_access_client(p_client_id)
    or exists (
      select 1 from client_users cu
      where cu.email = auth.jwt() ->> 'email'
        and cu.client_id = p_client_id
        and cu.active
    )
  ) then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;

  if p_requested_by is not null and length(p_requested_by) > 200 then
    raise exception 'requested_by_too_long' using errcode = 'P0001';
  end if;

  if p_plan is not null and p_plan not in ('standard', 'premium') then
    raise exception 'invalid_plan' using errcode = 'P0001';
  end if;

  select count(*) into v_open_count
  from enterprise_upgrade_requests
  where client_id = p_client_id and status = 'new';

  if v_open_count >= 5 then
    raise exception 'too_many_open_requests' using errcode = 'P0001';
  end if;

  insert into enterprise_upgrade_requests (client_id, requested_by, requested_plan)
  values (p_client_id, p_requested_by, p_plan)
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.request_enterprise_upgrade(text, text, text) from public, anon;
grant execute on function public.request_enterprise_upgrade(text, text, text) to authenticated;

commit;
