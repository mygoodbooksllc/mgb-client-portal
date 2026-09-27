-- Church Plant milestone (owner decision 2026-09-27): $100/mo until the
-- church's launch date. Stored as tier 0 so the nine volume-based tiers
-- (1-9) keep their numbers. Staff set it with "Set milestone"; the app never
-- suggests it from the numbers and never proposes a change while a client is
-- on it. After launch, staff set the client's regular milestone.
--
-- Builds on client-milestones.sql and milestones-nine-tiers.sql.
-- Safe to re-run.

begin;

alter table public.client_milestones
  drop constraint if exists client_milestones_confirmed_tier_check;
alter table public.client_milestones
  add constraint client_milestones_confirmed_tier_check check (confirmed_tier between 0 and 9);

alter table public.client_milestone_history
  drop constraint if exists client_milestone_history_to_tier_check;
alter table public.client_milestone_history
  add constraint client_milestone_history_to_tier_check check (to_tier between 0 and 9);

create or replace function public.confirm_client_milestone(
  p_client_id text,
  p_tier int,
  p_avg_monthly_tx numeric,
  p_annual_budget numeric,
  p_budget_basis text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := nullif(auth.jwt() ->> 'email', '');
  v_from int;
begin
  if v_email is null or not public.is_active_staff() or not public.can_access_client(p_client_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  -- 0 = Church Plant; 1-9 = the volume-based milestones.
  if p_tier is null or p_tier < 0 or p_tier > 9 then
    raise exception 'invalid tier' using errcode = '22023';
  end if;

  select confirmed_tier into v_from from client_milestones where client_id = p_client_id;

  perform set_config('app.milestone_confirm', 'on', true);
  insert into client_milestones (client_id, confirmed_tier, confirmed_at, confirmed_by)
    values (p_client_id, p_tier, now(), v_email)
    on conflict (client_id) do update
      set confirmed_tier = excluded.confirmed_tier,
          confirmed_at = excluded.confirmed_at,
          confirmed_by = excluded.confirmed_by;
  perform set_config('app.milestone_confirm', 'off', true);

  insert into client_milestone_history
    (client_id, from_tier, to_tier, avg_monthly_tx, annual_budget, budget_basis, note, changed_by)
  values
    (p_client_id, v_from, p_tier, p_avg_monthly_tx, p_annual_budget, p_budget_basis,
     nullif(trim(coalesce(p_note, '')), ''), v_email);
end;
$$;

revoke all on function public.confirm_client_milestone(text, int, numeric, numeric, text, text) from public, anon;
grant execute on function public.confirm_client_milestone(text, int, numeric, numeric, text, text) to authenticated;

commit;
