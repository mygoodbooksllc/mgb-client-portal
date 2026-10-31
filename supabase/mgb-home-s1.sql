-- MGB Home, slice S1 (docs/mgb-home-spec.md sections 5, 6 and 8).
-- Applied to production 2026-10-31 (Supabase MCP apply_migration, name mgb_home_s1).
--
-- 1. qbo_hours_by_client(): billable_value is null unless the caller has the
--    MGB (internal) grant (can_view_internal()). Every other column is
--    unchanged; any admin still gets hours. Patched in place
--    (pg_get_functiondef -> anchored replace -> CREATE OR REPLACE), the same
--    way internal-company-profile.sql does, so the signature, STABLE,
--    search_path and grants stay byte-identical.
-- 2. tk__owner_only_key(): adds mgb_home_enabled (the MGB Home firm switch),
--    anchored on the live list's last key so keys other sessions add are kept.
--    No tk_settings row is inserted: missing = off; code never writes it.
-- 3. staff_guide: the RESTRICTIVE internal-only article policy covers a list
--    of slugs (profitability, mgb-home) instead of one.
-- 4. staff_last_seen(): the "last page" never names an internal-company page
--    (MGB Home) to a caller without the grant (applied as migration
--    mgb_home_s1_last_seen).
--
-- No new tables, so no internal company lock is needed. Safe to re-run: each
-- patch is skipped once applied. Tests: supabase/mgb-home-tests.sql (rolls back).

create or replace function pg_temp.mh_patch_fn(p_sig text, p_from text, p_to text, p_done text, p_expected int)
returns void
language plpgsql
as $f$
declare
  d text;
  n int;
begin
  d := pg_get_functiondef(p_sig::regprocedure);
  if position(p_done in d) > 0 then
    return;  -- already patched
  end if;
  n := (length(d) - length(replace(d, p_from, ''))) / length(p_from);
  if n <> p_expected then
    raise exception 'mh_patch_fn %: expected % occurrence(s) of anchor %, found %', p_sig, p_expected, p_from, n;
  end if;
  execute replace(d, p_from, p_to);
end
$f$;

-- ---------------------------------------------------------------------------
-- 1. qbo_hours_by_client: no billable value without the internal grant
-- ---------------------------------------------------------------------------
select pg_temp.mh_patch_fn('public.qbo_hours_by_client(date, date)',
  $a$round(sum(case when b.hourly_rate is not null then b.minutes / 60.0 * b.hourly_rate else 0 end), 2),$a$,
  $a$case when public.can_view_internal()  -- MGB Home S1: money only with the internal grant
              then round(sum(case when b.hourly_rate is not null then b.minutes / 60.0 * b.hourly_rate else 0 end), 2)
         end,$a$,
  $a$MGB Home S1: money only with the internal grant$a$, 1);

-- ---------------------------------------------------------------------------
-- 2. Owner-only firm switch mgb_home_enabled
-- ---------------------------------------------------------------------------
select pg_temp.mh_patch_fn('public.tk__owner_only_key(text)',
  $a$'client_upload_notify_enabled');$a$,
  $a$'client_upload_notify_enabled',
                   'mgb_home_enabled');$a$,
  $a$'mgb_home_enabled'$a$, 1);

-- ---------------------------------------------------------------------------
-- 3. Internal-only staff guide articles: a slug list
-- ---------------------------------------------------------------------------
drop policy if exists "profitability internal only" on public.staff_guide;
drop policy if exists "internal only articles" on public.staff_guide;
create policy "internal only articles" on public.staff_guide
  as restrictive
  for select
  to authenticated
  using (slug not in ('profitability', 'mgb-home') or (select public.can_view_internal()));

-- ---------------------------------------------------------------------------
-- 4. staff_last_seen: the "last page" never names an internal-company page
--    (mgb-home, mgb-profitability, ...) for an admin without the grant.
--    SECURITY DEFINER bypasses the usage_events internal company lock, so the
--    lock is repeated here. usage_summary already drops internal rows
--    (is_roster_client_id is false for is_internal clients).
--    Applied as a second migration, mgb_home_s1_last_seen.
-- ---------------------------------------------------------------------------
select pg_temp.mh_patch_fn('public.staff_last_seen(text)',
  $a$where actor_email = e and kind = 'view' and not view_as$a$,
  $a$where actor_email = e and kind = 'view' and not view_as
          and (client_id is null or client_id <> all(public.internal_blocked_ids()))  -- MGB Home S1: internal lock$a$,
  $a$MGB Home S1: internal lock$a$, 1);

-- Quick check after applying:
--   select pg_get_functiondef('public.qbo_hours_by_client(date,date)'::regprocedure) ~ 'can_view_internal';
--   select public.tk__owner_only_key('mgb_home_enabled');   -- true
--   select qual from pg_policies where tablename = 'staff_guide' and policyname = 'internal only articles';
