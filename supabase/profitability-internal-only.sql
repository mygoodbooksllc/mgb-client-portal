-- Profitability is internal-only (owner request 2026-10-31).
--
-- Applied to production 2026-10-31 as migration profitability_internal_only.
-- Safe to re-run. Tests: supabase/profitability-internal-only-tests.sql.
--
-- Client fees, staff cost rates (this is where MGB payroll numbers live), the
-- target margin and everything computed from them used to be readable by every
-- active admin (is_active_staff_admin()). They now also need the owner's
-- MGB (internal) grant: public.can_view_internal() = active admin AND a row in
-- internal_access (supabase/internal-company-profile.sql). The owner turns the
-- grant on or off per admin in HR › Members (the "MGB (internal)" column).
-- The admin check is kept next to it on purpose.
--
-- What changes
--   client_fees, staff_cost_rates, profitability_settings
--       every policy: is_active_staff_admin() AND can_view_internal().
--       An admin without the grant reads zero rows and every write is refused.
--   client_profitability()   refuses (42501) without the grant.
--   quote_inputs()           refuses (42501) without the grant (target margin
--                            and bookkeeper hourly costs).
--   client_health()          the "Margin below target" factor is computed only
--                            for a caller with the grant (the label carries the
--                            margin and the target).
--   saved_quotes             RESTRICTIVE policy: a saved quote copies the target
--                            margin and hourly costs into its assumptions.
--   audit_log                RESTRICTIVE select policy: client_fee.*,
--                            cost_rate.* and profitability.* rows carry the
--                            amounts, so only a caller with the grant reads them.
--   staff_guide              RESTRICTIVE select policy: the "profitability"
--                            article is readable only with the grant.
--
-- Outside SQL (same commit): the weekly-admin-digest edge function drops the
-- Price review and Revenue snapshot sections (and their headline bits) for a
-- preview by an admin without the grant and for any recipient without a grant
-- row; the app hides every fee, rate, cost and margin surface unless
-- staffUser.canViewInternal is true (TP_PF_canSee in TeamProfit.jsx).
--
-- Re-running client-profitability.sql, client-health.sql, tasks-module-v1.sql
-- or gl-review-4-quotes.sql no longer undoes this: those files carry the same
-- checks now. Run this file after any of them anyway; it is idempotent.
--
-- Rollback (back to every active admin): re-create the policies with
-- is_active_staff_admin() only, drop the two RESTRICTIVE policies below, and
-- remove "and public.can_view_internal()" from the three functions.

begin;

-- ---------------------------------------------------------------------------
-- 1. Table policies
-- ---------------------------------------------------------------------------
drop policy if exists "admins read client fees" on public.client_fees;
create policy "admins read client fees" on public.client_fees
  for select to authenticated
  using ((select public.is_active_staff_admin()) and (select public.can_view_internal()));
drop policy if exists "admins write client fees" on public.client_fees;
create policy "admins write client fees" on public.client_fees
  for insert to authenticated
  with check ((select public.is_active_staff_admin()) and (select public.can_view_internal()));
drop policy if exists "admins update client fees" on public.client_fees;
create policy "admins update client fees" on public.client_fees
  for update to authenticated
  using ((select public.is_active_staff_admin()) and (select public.can_view_internal()))
  with check ((select public.is_active_staff_admin()) and (select public.can_view_internal()));
drop policy if exists "admins delete client fees" on public.client_fees;
create policy "admins delete client fees" on public.client_fees
  for delete to authenticated
  using ((select public.is_active_staff_admin()) and (select public.can_view_internal()));

drop policy if exists "admins read staff cost rates" on public.staff_cost_rates;
create policy "admins read staff cost rates" on public.staff_cost_rates
  for select to authenticated
  using ((select public.is_active_staff_admin()) and (select public.can_view_internal()));
drop policy if exists "admins write staff cost rates" on public.staff_cost_rates;
create policy "admins write staff cost rates" on public.staff_cost_rates
  for insert to authenticated
  with check ((select public.is_active_staff_admin()) and (select public.can_view_internal()));
drop policy if exists "admins update staff cost rates" on public.staff_cost_rates;
create policy "admins update staff cost rates" on public.staff_cost_rates
  for update to authenticated
  using ((select public.is_active_staff_admin()) and (select public.can_view_internal()))
  with check ((select public.is_active_staff_admin()) and (select public.can_view_internal()));
drop policy if exists "admins delete staff cost rates" on public.staff_cost_rates;
create policy "admins delete staff cost rates" on public.staff_cost_rates
  for delete to authenticated
  using ((select public.is_active_staff_admin()) and (select public.can_view_internal()));

drop policy if exists "admins read profitability settings" on public.profitability_settings;
create policy "admins read profitability settings" on public.profitability_settings
  for select to authenticated
  using ((select public.is_active_staff_admin()) and (select public.can_view_internal()));
drop policy if exists "admins update profitability settings" on public.profitability_settings;
create policy "admins update profitability settings" on public.profitability_settings
  for update to authenticated
  using ((select public.is_active_staff_admin()) and (select public.can_view_internal()))
  with check ((select public.is_active_staff_admin()) and (select public.can_view_internal()));

-- saved_quotes: assumptions hold the target margin and hourly costs.
drop policy if exists "profitability internal only" on public.saved_quotes;
create policy "profitability internal only" on public.saved_quotes
  as restrictive for all to authenticated
  using ((select public.can_view_internal()))
  with check ((select public.can_view_internal()));

-- audit_log: fee / rate / target rows carry the amounts.
drop policy if exists "profitability internal only" on public.audit_log;
create policy "profitability internal only" on public.audit_log
  as restrictive for select to authenticated
  using (action !~ '^(client_fee|cost_rate|profitability)\.' or (select public.can_view_internal()));

-- staff_guide: the Profitability article explains fees, cost rates and margin.
-- search_staff_guide() is SECURITY INVOKER, so search follows this too.
drop policy if exists "profitability internal only" on public.staff_guide;
create policy "profitability internal only" on public.staff_guide
  as restrictive for select to authenticated
  using (slug <> 'profitability' or (select public.can_view_internal()));

-- ---------------------------------------------------------------------------
-- 2. Functions (patched in place so later edits to their bodies survive)
-- ---------------------------------------------------------------------------
create or replace function pg_temp.patch_fn(p_sig text, p_from text, p_to text, p_expected int)
returns void
language plpgsql
as $f$
declare
  d text;
  n int;
begin
  d := pg_get_functiondef(p_sig::regprocedure);
  if position(p_to in d) > 0 then
    return;  -- already patched
  end if;
  n := (length(d) - length(replace(d, p_from, ''))) / length(p_from);
  if n <> p_expected then
    raise exception 'patch_fn %: expected % occurrence(s) of anchor %, found %', p_sig, p_expected, p_from, n;
  end if;
  execute replace(d, p_from, p_to);
end
$f$;

select pg_temp.patch_fn('public.client_profitability(date,date,jsonb)',
  $a$if not public.is_active_staff_admin() then$a$,
  $a$if not (public.is_active_staff_admin() and public.can_view_internal()) then$a$, 1);

select pg_temp.patch_fn('public.quote_inputs()',
  $a$if not public.is_active_staff_admin() then$a$,
  $a$if not (public.is_active_staff_admin() and public.can_view_internal()) then$a$, 1);

select pg_temp.patch_fn('public.client_health(jsonb)',
  $a$if v_admin then$a$,
  $a$if v_admin and public.can_view_internal() then$a$, 1);

-- Grants are unchanged by create or replace; restate them anyway.
revoke all on function public.client_profitability(date, date, jsonb) from public, anon;
grant execute on function public.client_profitability(date, date, jsonb) to authenticated;
revoke all on function public.quote_inputs() from public, anon;
grant execute on function public.quote_inputs() to authenticated;

commit;
