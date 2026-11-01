-- MGB Home, slice S2: Overhead (docs/mgb-home-spec.md sections 4, 6, 12 OQ5).
-- Applied to production 2026-10-31 (Supabase MCP apply_migration: sections
-- 1-5 as mgb_home_s2, sections 6-7 as mgb_home_s2_locks).
--
-- 1. Map the firm's own QuickBooks Time customer "My Good Books (Clock-in
--    Option)" to MGB (internal) (spec OQ5). A documented admin mapping, the
--    same row change qbo_set_customer_mapping makes for a grant holder
--    (manual = true, so auto-match never touches it again); audited by the
--    table's audit_log trigger (the audit row carries the internal client_id,
--    so the internal company lock hides it from admins without the grant).
--    Only when the row is still unmapped and not ignored: a later owner
--    choice is never overwritten by a re-run.
-- 2. qbo_internal_customers(): the firm's QuickBooks customers that resolve
--    (directly or through a parent) to the internal client. SECURITY DEFINER
--    because the mapping rows are hidden from admins without the grant by
--    the internal company lock; it returns only (realm, customer id) pairs,
--    nothing else, and nothing at all to a caller who isn't an active admin.
-- 3. qbo_hours_by_client / qbo_hours_by_staff: time on those customers drops
--    out for every admin the same way. Before this, a grant holder saw it
--    dropped (the mapping is visible to them) while an admin without the
--    grant saw the same hours as "Unmapped" (the lock hides the mapping row,
--    so the time looked unresolved). Patched in place, anchored, as S1 did.
-- 4. qbo_set_customer_mapping: an admin without the grant can no longer
--    change, ignore or reset a customer that is mapped to the internal
--    client (SECURITY DEFINER updated the row by id regardless of the lock).
-- 5. internal_hours(p_from, p_to): the Overhead tab's one read. SECURITY
--    DEFINER, raises 42501 unless the caller is an active admin with the MGB
--    (internal) grant (can_view_internal()). Returns jsonb: totals, per
--    person (internal minutes, all their minutes, cost), per month, and per
--    service item + description line. Cost uses staff_cost_rates at the
--    entry date, falling back to the average of current rates (marked
--    estimated), exactly as client_profitability does. No revenue.
--
-- No new tables. Safe to re-run: each patch is skipped once applied.
-- Tests: supabase/mgb-home-tests.sql (rolls back), section S2.

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
-- 1. Map "My Good Books (Clock-in Option)" to the internal client
-- ---------------------------------------------------------------------------
update public.qbo_customer_client_map m
   set client_id = (select c.id from public.clients c where c.is_internal limit 1),
       ignored = false,
       manual = true,
       auto_matched = false,
       updated_by = 'mgb-home-s2 migration (spec OQ5)',
       updated_at = now()
 where m.realm_id = (select f.realm_id from public.qbo_firm_connection f where f.id = true)
   and m.customer_name = 'My Good Books (Clock-in Option)'
   and m.client_id is null
   and not m.ignored
   and exists (select 1 from public.clients c where c.is_internal);

-- ---------------------------------------------------------------------------
-- 2. qbo_internal_customers()
-- ---------------------------------------------------------------------------
create or replace function public.qbo_internal_customers()
returns table(realm_id text, qbo_customer_id text)
language sql
stable
security definer
set search_path to 'public'
as $f$
  -- MGB Home S2. Owner-run: the internal company lock does not apply here,
  -- so the mapping is seen the same way for every admin.
  select r.realm_id, r.qbo_customer_id
    from public.qbo_customer_resolution r
    join public.clients c on c.id = r.client_id and c.is_internal
   where public.is_active_staff_admin();
$f$;
revoke all on function public.qbo_internal_customers() from public;
revoke all on function public.qbo_internal_customers() from anon;
grant execute on function public.qbo_internal_customers() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Hours RPCs: internal customers drop out for every admin
-- ---------------------------------------------------------------------------
select pg_temp.mh_patch_fn('public.qbo_hours_by_client(date, date)',
  $a$      and (r.client_id is null or public.is_roster_client_id(r.client_id))$a$,
  $a$      and (r.client_id is null or public.is_roster_client_id(r.client_id))
      -- MGB Home S2: internal customers drop for everyone
      and not coalesce((a.realm_id, a.customer_qbo_id) in (select ic.realm_id, ic.qbo_customer_id from public.qbo_internal_customers() ic), false)$a$,
  $a$MGB Home S2: internal customers drop for everyone$a$, 1);

select pg_temp.mh_patch_fn('public.qbo_hours_by_staff(date, date)',
  $a$(coalesce(r.ignored, false) or not public.is_roster_client_id(r.client_id)) as res_ignored$a$,
  $a$(coalesce(r.ignored, false) or not public.is_roster_client_id(r.client_id)
            -- MGB Home S2: internal customers count as ignored for everyone
            or coalesce((a.realm_id, a.customer_qbo_id) in (select ic.realm_id, ic.qbo_customer_id from public.qbo_internal_customers() ic), false)) as res_ignored$a$,
  $a$MGB Home S2: internal customers count as ignored for everyone$a$, 1);

-- ---------------------------------------------------------------------------
-- 4. qbo_set_customer_mapping: an internal-mapped customer needs the grant
-- ---------------------------------------------------------------------------
select pg_temp.mh_patch_fn('public.qbo_set_customer_mapping(text, text, boolean, text)',
  $a$  if p_client_id is not null and not exists (select 1 from clients where id = p_client_id) then$a$,
  $a$  -- MGB Home S2: a customer mapped to the internal client changes only with the grant
  if not public.can_view_internal() and exists (
       select 1 from qbo_customer_client_map m0 join clients c0 on c0.id = m0.client_id and c0.is_internal
        where m0.realm_id = v_realm and m0.qbo_customer_id = p_qbo_customer_id) then
    raise exception 'not authorized';
  end if;
  if p_client_id is not null and not exists (select 1 from clients where id = p_client_id) then$a$,
  $a$MGB Home S2: a customer mapped to the internal client changes only with the grant$a$, 1);

-- ---------------------------------------------------------------------------
-- 5. internal_hours(p_from, p_to)
-- ---------------------------------------------------------------------------
create or replace function public.internal_hours(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $f$
declare
  v_avg numeric;
  v_rates boolean;
  v_out jsonb;
begin
  -- MGB Home S2: only an active admin with the MGB (internal) grant.
  if not (public.is_active_staff_admin() and public.can_view_internal()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'invalid date range' using errcode = '22023';
  end if;
  if p_to - p_from > 1100 then
    raise exception 'date range too long (3 years at most)' using errcode = '22023';
  end if;

  -- Same fallback as client_profitability: the average of each person's
  -- latest rate on or before p_to, used (and marked estimated) for anyone
  -- without a rate on the entry date.
  select avg(r.hourly_cost) into v_avg
  from (
    select distinct on (staff_email) hourly_cost
    from staff_cost_rates
    where effective_from <= p_to
    order by staff_email, effective_from desc
  ) r;
  v_rates := v_avg is not null;

  with ic as (
    select r.realm_id, r.qbo_customer_id
      from qbo_customer_resolution r
      join clients c on c.id = r.client_id and c.is_internal
  ), a as (
    select t.realm_id,
           t.txn_date,
           t.minutes,
           t.customer_qbo_id,
           nullif(btrim(t.item_name), '') as item,
           nullif(btrim(t.description), '') as descr,
           coalesce(t.employee_name, t.vendor_name) as pname,
           lower(p.staff_email) as sem,
           coalesce((t.realm_id, t.customer_qbo_id) in (select ic.realm_id, ic.qbo_customer_id from ic), false) as internal
      from qbo_time_activities t
      left join qbo_employee_staff_map p
        on p.realm_id = t.realm_id
       and p.qbo_entity_type = case when t.employee_qbo_id is not null then 'Employee' else 'Vendor' end
       and p.qbo_id = coalesce(t.employee_qbo_id, t.vendor_qbo_id)
     where t.txn_date between p_from and p_to
  ), ak as (
    select a.*, coalesce(a.sem, 'unmapped:' || coalesce(a.pname, '')) as pkey from a
  ), e as (
    select ak.*,
           r.rate,
           coalesce(r.rate, v_avg) as use_rate
      from ak
      left join lateral (
        select sc.hourly_cost as rate
          from staff_cost_rates sc
         where sc.staff_email = ak.sem and sc.effective_from <= ak.txn_date
         order by sc.effective_from desc
         limit 1) r on true
     where ak.internal
  ), all_by_person as (
    select pkey, sum(minutes)::bigint as mins from ak group by pkey
  ), people as (
    select e.pkey,
           max(e.sem) as sem,
           max(e.pname) as pname,
           sum(e.minutes)::bigint as mins,
           round(sum(e.minutes / 60.0 * e.use_rate), 2) as cost,
           bool_or(e.rate is null and e.use_rate is not null) as est,
           bool_or(e.use_rate is null) as unc
      from e
     group by e.pkey
  ), months as (
    select date_trunc('month', e.txn_date)::date as m,
           sum(e.minutes)::bigint as mins,
           round(sum(e.minutes / 60.0 * e.use_rate), 2) as cost
      from e
     group by 1
  ), lines as (
    select e.item,
           min(left(e.descr, 200)) as descr,
           sum(e.minutes)::bigint as mins,
           round(sum(e.minutes / 60.0 * e.use_rate), 2) as cost,
           count(*)::bigint as entries,
           count(distinct e.pkey)::bigint as ppl
      from e
     group by e.item, lower(e.descr)
     order by 3 desc
     limit 300
  )
  select jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'rates_set', v_rates,
    'totals', (
      select jsonb_build_object(
        'minutes', coalesce(sum(e.minutes), 0)::bigint,
        'entries', count(*)::bigint,
        'people', count(distinct e.pkey)::bigint,
        'cost', round(coalesce(sum(e.minutes / 60.0 * e.use_rate), 0), 2),
        'estimated_minutes', coalesce(sum(case when e.rate is null and e.use_rate is not null then e.minutes end), 0)::bigint,
        'estimated_cost', round(coalesce(sum(case when e.rate is null then e.minutes / 60.0 * e.use_rate end), 0), 2),
        'uncosted_minutes', coalesce(sum(case when e.use_rate is null then e.minutes end), 0)::bigint,
        'all_minutes', (select coalesce(sum(ak.minutes), 0)::bigint from ak),
        'no_customer_minutes', (select coalesce(sum(ak.minutes), 0)::bigint from ak where ak.customer_qbo_id is null))
      from e),
    'people', coalesce((
      select jsonb_agg(jsonb_build_object(
               'key', p.pkey,
               'staff_email', p.sem,
               'name', coalesce(s.name, p.pname, p.sem),
               'mapped', p.sem is not null,
               'minutes', p.mins,
               'all_minutes', coalesce(ab.mins, p.mins),
               'cost', p.cost,
               'estimated', p.est,
               'uncosted', p.unc)
             order by p.mins desc, coalesce(s.name, p.pname, p.sem))
        from people p
        left join staff s on lower(s.email) = p.sem
        left join all_by_person ab on ab.pkey = p.pkey), '[]'::jsonb),
    'months', coalesce((
      select jsonb_agg(jsonb_build_object('month', m.m, 'minutes', m.mins, 'cost', m.cost) order by m.m)
        from months m), '[]'::jsonb),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
               'item', l.item, 'description', l.descr, 'minutes', l.mins, 'cost', l.cost,
               'entries', l.entries, 'people', l.ppl)
             order by l.mins desc, l.descr nulls first)
        from lines l), '[]'::jsonb)
  ) into v_out;

  return v_out;
end;
$f$;
revoke all on function public.internal_hours(date, date) from public;
revoke all on function public.internal_hours(date, date) from anon;
grant execute on function public.internal_hours(date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Re-lock the firm switch (applied as mgb_home_s2_locks).
--    members_area_gate_v1 (applied after mgb_home_s1) rewrote
--    tk__owner_only_key from its own copy and dropped 'mgb_home_enabled', so
--    any admin could again read and write the MGB Home switch. Put it back
--    in a way that survives the list growing: prepend it once.
-- ---------------------------------------------------------------------------
select pg_temp.mh_patch_fn('public.tk__owner_only_key(text)',
  $a$select p_key in ($a$,
  $a$select p_key in ('mgb_home_enabled', $a$,
  $a$'mgb_home_enabled'$a$, 1);

-- ---------------------------------------------------------------------------
-- 7. Usage actions logged on an MGB Home page carry the internal client
--    (applied as mgb_home_s2_locks). MGB_track (app.jsx) logs actions with
--    client_id null, so an action on an mgb-* page (the Firm books menu, the
--    ⌘K palette...) was readable by every admin in Usage stats; the internal
--    company lock only hides rows that name the internal client. Fill it in
--    on insert, and fix the rows already logged that way.
-- ---------------------------------------------------------------------------
create or replace function public.usage_events__mh_internal()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $f$
begin
  -- MGB Home S2: an mgb-* page always belongs to the internal client.
  if new.client_id is null and new.page like 'mgb-%' then
    new.client_id := (select c.id from clients c where c.is_internal order by c.id limit 1);
  end if;
  return new;
end;
$f$;
revoke all on function public.usage_events__mh_internal() from public;
revoke all on function public.usage_events__mh_internal() from anon;
revoke all on function public.usage_events__mh_internal() from authenticated;
drop trigger if exists usage_events_mh_internal on public.usage_events;
create trigger usage_events_mh_internal
  before insert on public.usage_events
  for each row execute function public.usage_events__mh_internal();

update public.usage_events
   set client_id = (select c.id from public.clients c where c.is_internal order by c.id limit 1)
 where client_id is null and page like 'mgb-%';

-- Quick check after applying:
--   select client_id, manual, updated_by from qbo_customer_client_map where customer_name = 'My Good Books (Clock-in Option)';
--   select pg_get_functiondef('public.qbo_hours_by_client(date,date)'::regprocedure) ~ 'MGB Home S2';
--   select pg_get_functiondef('public.qbo_hours_by_staff(date,date)'::regprocedure) ~ 'MGB Home S2';
--   select pg_get_functiondef('public.qbo_set_customer_mapping(text,text,boolean,text)'::regprocedure) ~ 'MGB Home S2';
--   select has_function_privilege('anon', 'public.internal_hours(date,date)', 'execute');   -- false
