-- Monthly hours budget per client (owner request 2026-10-07).
--
-- Applied to production 2026-10-07 as migration client_hours_budget.
-- Safe to re-run.
--
-- client_profile.monthly_hours_budget: QuickBooks Time hours the firm plans
-- to spend on the client in a calendar month. Null = no budget. Admin only:
-- the app shows it only to admins (HoursBudget.jsx), and the trigger below
-- stops anyone who isn't an active admin from setting or changing it. A
-- bookkeeper can still save the other profile fields; the budget is carried
-- over unchanged. Hours used come from qbo_hours_by_client() (admin-only RPC,
-- qbo-firm-time.sql); nothing here touches QuickBooks.
--
-- Bookkeepers can technically read the column through the existing "staff
-- manage client profile" policy. It is a planning number, not pay or margin,
-- so that is acceptable; the UI never shows it to them.

alter table public.client_profile
  add column if not exists monthly_hours_budget numeric;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'client_profile_monthly_hours_budget_check'
  ) then
    alter table public.client_profile
      add constraint client_profile_monthly_hours_budget_check
      check (monthly_hours_budget is null or (monthly_hours_budget >= 0 and monthly_hours_budget <= 1000));
  end if;
end $$;

create or replace function public.client_profile_guard_hours_budget()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Service role / SQL editor (no JWT) is allowed through.
  if auth.uid() is null then
    return new;
  end if;
  if public.is_active_staff_admin() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.monthly_hours_budget := null;
  elsif new.monthly_hours_budget is distinct from old.monthly_hours_budget then
    new.monthly_hours_budget := old.monthly_hours_budget;
  end if;
  return new;
end;
$$;

revoke all on function public.client_profile_guard_hours_budget() from public, anon, authenticated;

drop trigger if exists client_profile_guard_hours_budget on public.client_profile;
create trigger client_profile_guard_hours_budget
  before insert or update on public.client_profile
  for each row execute function public.client_profile_guard_hours_budget();
