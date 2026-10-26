-- Client gifts: which anniversary the gift list follows (firm-wide).
-- Owner request 2026-10-25: an owner-visible choice between "Client since"
-- (the default) and "Founding date". Spec: docs/client-org-profile-spec.md
-- (section "Gift anniversary basis"). Self-test: client-org-gift-basis-tests.sql
-- (rolls back).
--
-- Additive only: nothing is dropped or deleted, no table changes.
--   tk_settings key org_gift_basis   jsonb string "client_since" | "established".
--                                    No row = "client_since". Admin write (the
--                                    existing tk_settings RLS), audited in
--                                    tk_settings_audit by the existing trigger.
--                                    Not an owner-only key.
--   trigger tk_settings_check_org_gift_basis  refuses any other value (22023).
--   op__gift_basis()                 internal reader, fail-safe: anything but
--                                    "established" reads as "client_since".
--   op__anniversaries(date, int)     same signature and columns. Basis
--                                    client_since: only Client since rows.
--                                    Basis established: the founding date
--                                    (established_date, unless "Not sure"), and
--                                    Client since for a client with no known
--                                    founding date, so no client drops off.
--                                    admin_upcoming_anniversaries and
--                                    org_anniversaries_digest_count read it, so
--                                    Team › Client gifts and the digest line
--                                    follow the choice with no other change.
--   admin_gift_basis()               admin only: the current basis.
--   admin_set_gift_basis(p text)     admin only: saves it, returns it.
--
-- Before this file the list showed both occasions. Production on 2026-10-25
-- had 0 founding dates, 0 Client since overrides and 0 gifts, so the default
-- (client_since) lists exactly the same rows as before.
--
-- No email, no notifications. Safe to re-run.
--
-- Applied to production 2026-10-25 (project xumsqmhccgfjnlmieqyu).

begin;

create or replace function public.op__gift_basis()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case when (select value #>> '{}' from tk_settings where key = 'org_gift_basis') = 'established'
              then 'established' else 'client_since' end;
$$;
revoke all on function public.op__gift_basis() from public, anon, authenticated;

create or replace function public.tk_settings_check_org_gift_basis()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_key text := case when tg_op = 'UPDATE' then old.key else new.key end;
begin
  if v_key = 'org_gift_basis' then
    if new.value is null or jsonb_typeof(new.value) <> 'string'
       or (new.value #>> '{}') not in ('client_since', 'established') then
      raise exception 'org_gift_basis_invalid' using errcode = '22023';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists tk_settings_check_org_gift_basis on public.tk_settings;
create trigger tk_settings_check_org_gift_basis
  before insert or update on public.tk_settings
  for each row execute function public.tk_settings_check_org_gift_basis();

create or replace function public.op__anniversaries(p_from date, p_days int)
returns table (
  client_id text, client_name text, occasion text, occasion_date date, years int,
  profile_complete boolean, has_get_to_know boolean,
  gift_id uuid, gift_status text, gift_amount numeric, gift_item text
)
language sql
stable
security definer
set search_path = public
as $$
  with basis as (select public.op__gift_basis() as b),
  bases as (
    select c.id, c.name, 'client_since'::text as occ,
           coalesce(op.client_since, cp.launch_date) as base,
           op.completed_at is not null as complete
    from clients c
    cross join basis
    left join client_org_profile op on op.client_id = c.id
    left join client_profile cp on cp.client_id = c.id
    where not coalesce(c.test_only, false) and not coalesce(c.is_internal, false)
      and (basis.b = 'client_since'
           or op.established_date is null
           or coalesce(op.established_unknown, false))
    union all
    select c.id, c.name, 'established'::text,
           op.established_date,
           op.completed_at is not null
    from clients c
    cross join basis
    join client_org_profile op on op.client_id = c.id
    where not coalesce(c.test_only, false) and not coalesce(c.is_internal, false)
      and basis.b = 'established'
      and op.established_date is not null
      and not coalesce(op.established_unknown, false)
  )
  select b.id, b.name, b.occ, n.occ, n.years,
         b.complete,
         exists (select 1 from client_get_to_know k where k.client_id = b.id),
         g.id, g.status, g.amount, g.item
  from bases b
  cross join lateral public.op__next_occurrence(b.base, p_from) n
  left join client_gifts g
    on g.client_id = b.id and g.occasion = b.occ and g.occasion_year = extract(year from n.occ)::int
  where b.base is not null
    and n.years >= 1
    and n.occ <= p_from + p_days
  order by n.occ, b.name, b.occ;
$$;
revoke all on function public.op__anniversaries(date, int) from public, anon, authenticated;

create or replace function public.admin_gift_basis()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_active_staff_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return public.op__gift_basis();
end $$;
revoke all on function public.admin_gift_basis() from public, anon;
grant execute on function public.admin_gift_basis() to authenticated;

create or replace function public.admin_set_gift_basis(p_basis text)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_active_staff_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_basis is null or p_basis not in ('client_since', 'established') then
    raise exception 'org_gift_basis_invalid' using errcode = '22023';
  end if;
  insert into tk_settings (key, value) values ('org_gift_basis', to_jsonb(p_basis))
  on conflict (key) do update set value = excluded.value;
  return public.op__gift_basis();
end $$;
revoke all on function public.admin_set_gift_basis(text) from public, anon;
grant execute on function public.admin_set_gift_basis(text) to authenticated;

commit;

notify pgrst, 'reload schema';
