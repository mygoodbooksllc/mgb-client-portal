-- Client gifts: the default anniversary is now the Founding date.
-- Owner request 2026-10-27 (Bailley): the client's org birthday
-- (client_org_profile.established_date) is the day we recognize a client for
-- anniversary gifts. The MGB anniversary (Client since) stays on file and
-- visible to staff. Follows supabase/client-org-gift-basis.sql.
--
-- Additive only: no table change, no data written or deleted.
--   op__gift_basis()   now reads no row (and anything but "client_since") as
--                      "established". An explicit "client_since" is still
--                      honored, so admins can switch back. Production on
--                      2026-10-27 had NO org_gift_basis row (the default lived
--                      only in code), so nothing is overwritten.
--   op__anniversaries  unchanged: with "established" a client whose founding
--                      date is blank or "Not sure" still lists on Client since.
--   admin_gift_dates(p_client_ids text[])   admin only. Client since (staff
--                      override, else launch date) and the founding date for
--                      the given clients, so the Client gifts list can show
--                      both next to each other whichever date is followed.
--
-- Production on 2026-10-27 had 0 founding dates and 0 gifts, so the list is
-- unchanged until founding dates are entered (clients with no founding date
-- fall back to Client since, exactly the old default).
-- Self-test: client-org-gift-basis-tests.sql (rolls back). Safe to re-run.
--
-- Applied to production 2026-10-27 (project xumsqmhccgfjnlmieqyu).

begin;

create or replace function public.op__gift_basis()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case when (select value #>> '{}' from tk_settings where key = 'org_gift_basis') = 'client_since'
              then 'client_since' else 'established' end;
$$;
revoke all on function public.op__gift_basis() from public, anon, authenticated;

create or replace function public.admin_gift_dates(p_client_ids text[])
returns table (client_id text, client_since date, established_date date, established_unknown boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_active_staff_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
    select c.id, coalesce(op.client_since, cp.launch_date), op.established_date, coalesce(op.established_unknown, false)
    from clients c
    left join client_org_profile op on op.client_id = c.id
    left join client_profile cp on cp.client_id = c.id
    where c.id = any (coalesce(p_client_ids, '{}'::text[]));
end $$;
revoke all on function public.admin_gift_dates(text[]) from public, anon;
grant execute on function public.admin_gift_dates(text[]) to authenticated;

commit;

notify pgrst, 'reload schema';
