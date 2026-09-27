-- Nine-tier pricing chart (owner decision 2026-09-26).
--
-- The chart went from six milestones (Foundation $350 ... Strategic $1,450,
-- Enterprise) to nine (Starter $250 ... Premier $2,500, Enterprise), so a
-- stored tier number now means a different milestone. Run this once on an
-- existing database, then deploy the app.jsx that has the nine-tier
-- PRICING_MILESTONES right after. Fresh installs get the same result from
-- client-milestones.sql alone.
--
-- What it does:
--   1. Allows tiers 1-9 on client_milestones and client_milestone_history.
--   2. Adds client_milestone_history.chart and marks every existing row as
--      chart 1 (the old six-tier chart), so history keeps its old names.
--   3. Clears every confirmed milestone, so staff confirm each client again
--      on the new chart. The app shows "Set milestone" until they do.
--   4. Lets confirm_client_milestone() accept tiers 1-9.
-- Steps 2 and 3 run only the first time, so re-running is safe.

begin;

alter table public.client_milestones
  drop constraint if exists client_milestones_confirmed_tier_check;
alter table public.client_milestones
  add constraint client_milestones_confirmed_tier_check check (confirmed_tier between 1 and 9);

alter table public.client_milestone_history
  drop constraint if exists client_milestone_history_to_tier_check;
alter table public.client_milestone_history
  add constraint client_milestone_history_to_tier_check check (to_tier between 1 and 9);

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'client_milestone_history' and column_name = 'chart'
  ) then
    alter table public.client_milestone_history add column chart smallint;
    update public.client_milestone_history set chart = 1;
    alter table public.client_milestone_history alter column chart set default 2;
    alter table public.client_milestone_history alter column chart set not null;

    -- The before-write trigger only lets confirmed_* change while this is on.
    perform set_config('app.milestone_confirm', 'on', true);
    update public.client_milestones
      set confirmed_tier = null, confirmed_at = null, confirmed_by = null
      where confirmed_tier is not null;
    perform set_config('app.milestone_confirm', 'off', true);
  end if;
end;
$$;

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
  if p_tier is null or p_tier < 1 or p_tier > 9 then
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
