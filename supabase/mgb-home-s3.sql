-- MGB Home, slice S3: Cost rates (docs/mgb-home-spec.md "Cost rates", OQ4).
-- Applied to production 2026-11-02 (Supabase MCP apply_migration, name mgb_home_s3).
--
-- 1. firm_cost_basis: the owner's two blended firm figures per effective date
--    (staff cost per hour, and full cost per hour including owner pay and
--    retirement). Values live only in this table, never in code or docs; this
--    migration inserts no rows. RLS: an active admin with the MGB (internal)
--    grant only (can_view_internal()), every command. Writes stamp
--    updated_by / updated_at and are audited as firm_cost.set / changed /
--    removed, and those audit rows join the "profitability internal only"
--    RESTRICTIVE audit_log policy.
-- 2. Cost basis. client_profitability and internal_hours gain
--    p_basis text default 'staff':
--      'staff' (default): each person's loaded rate at the entry date, as before.
--      'full': that rate plus the firm uplift (full_rate - staff_rate) of the
--              firm_cost_basis row in effect at the entry date (the earliest
--              row for entries before it). Refused (22023) while the table is
--              empty, so Full cost never silently equals Staff cost.
--    The old signatures are dropped in the same transaction and recreated with
--    the extra defaulted argument, so every existing call (PostgREST named
--    args, client_health's positional 3-arg call) resolves unchanged.
-- 3. People no longer on staff. Time by someone whose QuickBooks employee
--    mapping is set to "ignored" (people who have left and were never given a
--    portal login, such as Naomi Townes and Haley M. Dick) or who maps to an
--    inactive staff row, with no rate on the entry date, is still costed at
--    the firm average rate (totals unchanged) but is no longer marked
--    "estimated": it is reported separately as former_minutes / former_cost
--    (and 'former' per person). "Estimated" now means a current person
--    without a rate, which the owner can fix on the Cost rates page.
--    No rate rows are created for anyone.
-- 4. usage_events: the Cost rates page (mgb-costs, #/internal/costs) and
--    "cost rate" guide searches by a grant holder file under the internal
--    client, as S2 did for the other MGB Home pages.
--
-- Safe to re-run. Tests: supabase/mgb-home-tests.sql (rolls back), section S3.

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
-- 1. firm_cost_basis
-- ---------------------------------------------------------------------------
create table if not exists public.firm_cost_basis (
  effective_from date primary key,
  staff_rate numeric not null check (staff_rate >= 0 and staff_rate < 10000),
  full_rate numeric not null check (full_rate < 10000),
  note text check (note is null or length(note) <= 500),
  updated_by text,
  updated_at timestamptz not null default now(),
  constraint firm_cost_basis_full_ge_staff check (full_rate >= staff_rate)
);
comment on table public.firm_cost_basis is
  'MGB Home S3: the owner''s blended firm cost per hour (staff only, and full incl. owner pay + retirement) by effective date. Grant holders only.';

alter table public.firm_cost_basis enable row level security;
revoke all on table public.firm_cost_basis from anon;
revoke all on table public.firm_cost_basis from public;
revoke all on table public.firm_cost_basis from authenticated;  -- no TRUNCATE etc. (applied as mgb_home_s3_grants)
grant select, insert, update, delete on table public.firm_cost_basis to authenticated;

drop policy if exists "firm cost basis read" on public.firm_cost_basis;
drop policy if exists "firm cost basis insert" on public.firm_cost_basis;
drop policy if exists "firm cost basis update" on public.firm_cost_basis;
drop policy if exists "firm cost basis delete" on public.firm_cost_basis;
create policy "firm cost basis read" on public.firm_cost_basis
  for select to authenticated
  using ((select public.is_active_staff_admin()) and (select public.can_view_internal()));
create policy "firm cost basis insert" on public.firm_cost_basis
  for insert to authenticated
  with check ((select public.is_active_staff_admin()) and (select public.can_view_internal()));
create policy "firm cost basis update" on public.firm_cost_basis
  for update to authenticated
  using ((select public.is_active_staff_admin()) and (select public.can_view_internal()))
  with check ((select public.is_active_staff_admin()) and (select public.can_view_internal()));
create policy "firm cost basis delete" on public.firm_cost_basis
  for delete to authenticated
  using ((select public.is_active_staff_admin()) and (select public.can_view_internal()));

-- Who changed it: always the signed-in caller, never what the browser sent.
create or replace function public.firm_cost_basis__stamp()
returns trigger
language plpgsql
set search_path to 'public'
as $f$
begin
  new.updated_by := nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '');
  new.updated_at := now();
  return new;
end;
$f$;
revoke all on function public.firm_cost_basis__stamp() from public;
revoke all on function public.firm_cost_basis__stamp() from anon;
revoke all on function public.firm_cost_basis__stamp() from authenticated;
drop trigger if exists firm_cost_basis_stamp on public.firm_cost_basis;
create trigger firm_cost_basis_stamp
  before insert or update on public.firm_cost_basis
  for each row execute function public.firm_cost_basis__stamp();

-- Audit: firm_cost.set / changed / removed (no client_id; the RESTRICTIVE
-- policy below hides them from admins without the grant).
select pg_temp.mh_patch_fn('public.audit_row_change()',
  $a$  elsif t = 'profitability_settings' then$a$,
  $a$  elsif t = 'firm_cost_basis' then
    -- MGB Home S3: firm cost basis (grant holders only, see audit_log policy)
    if tg_op = 'UPDATE' and (o ->> 'staff_rate') is not distinct from (n ->> 'staff_rate')
       and (o ->> 'full_rate') is not distinct from (n ->> 'full_rate')
       and (o ->> 'effective_from') is not distinct from (n ->> 'effective_from') then
      return null;
    end if;
    perform audit_write(
      case tg_op when 'INSERT' then 'firm_cost.set' when 'DELETE' then 'firm_cost.removed' else 'firm_cost.changed' end,
      null, 'settings', r ->> 'effective_from',
      jsonb_build_object('effective_from', r ->> 'effective_from',
                         'staff_from', o -> 'staff_rate', 'staff_to', n -> 'staff_rate',
                         'full_from', o -> 'full_rate', 'full_to', n -> 'full_rate'));

  elsif t = 'profitability_settings' then$a$,
  $a$MGB Home S3: firm cost basis$a$, 1);

drop trigger if exists audit_log_trg on public.firm_cost_basis;
create trigger audit_log_trg
  after insert or update or delete on public.firm_cost_basis
  for each row execute function public.audit_row_change();

drop policy if exists "profitability internal only" on public.audit_log;
create policy "profitability internal only" on public.audit_log
  as restrictive
  for select
  to authenticated
  using ((action !~ '^(client_fee|cost_rate|profitability|firm_cost)\.') or (select public.can_view_internal()));

-- ---------------------------------------------------------------------------
-- 2 + 3. client_profitability(p_from, p_to, p_default_fees, p_basis)
-- ---------------------------------------------------------------------------
drop function if exists public.client_profitability(date, date, jsonb);
create or replace function public.client_profitability(
  p_from date, p_to date, p_default_fees jsonb default '{}'::jsonb, p_basis text default 'staff')
returns table(client_id text, client_name text, monthly_fee numeric, fee_source text, months numeric,
              revenue numeric, total_minutes bigint, estimated_minutes bigint, uncosted_minutes bigint,
              cost numeric, estimated_cost numeric, profit numeric, margin_pct numeric, avg_rate numeric,
              staff_costs jsonb, former_minutes bigint, former_cost numeric, basis text)
language plpgsql
stable
set search_path to 'public'
as $function$
#variable_conflict use_column
declare
  v_months numeric;
  v_avg numeric;
  v_basis text := coalesce(p_basis, 'staff');
  v_first_uplift numeric;
begin
  if not (public.is_active_staff_admin() and public.can_view_internal()) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'invalid date range';
  end if;
  if v_basis not in ('staff', 'full') then
    raise exception 'unknown cost basis' using errcode = '22023';
  end if;
  if v_basis = 'full' then
    -- MGB Home S3: Full cost needs the firm cost basis set on Cost rates.
    select fb.full_rate - fb.staff_rate into v_first_uplift
      from firm_cost_basis fb order by fb.effective_from asc limit 1;
    if v_first_uplift is null then
      raise exception 'no firm cost basis' using errcode = '22023';
    end if;
  end if;

  select coalesce(sum(
           (least(p_to, (m + interval '1 month - 1 day')::date) - greatest(p_from, m::date) + 1)::numeric
           / extract(day from (m + interval '1 month - 1 day'))::numeric
         ), 0)
    into v_months
  from generate_series(date_trunc('month', p_from), date_trunc('month', p_to), interval '1 month') as m;

  select avg(r.hourly_cost) into v_avg
  from (
    select distinct on (staff_email) hourly_cost
    from staff_cost_rates
    where effective_from <= p_to
    order by staff_email, effective_from desc
  ) r;

  return query
  with e as (
    select res.client_id as cid,
           p.staff_email as sem,
           coalesce(a.employee_name, a.vendor_name) as pname,
           a.minutes,
           (select sc.hourly_cost from staff_cost_rates sc
             where sc.staff_email = lower(p.staff_email) and sc.effective_from <= a.txn_date
             order by sc.effective_from desc limit 1) as rate,
           -- MGB Home S3: no longer on staff (ignored QuickBooks mapping or inactive staff row)
           (coalesce(p.ignored, false)
              or exists (select 1 from staff s0 where lower(s0.email) = lower(p.staff_email) and not s0.active)) as gone,
           case when v_basis = 'full' then
             coalesce((select fb.full_rate - fb.staff_rate from firm_cost_basis fb
                        where fb.effective_from <= a.txn_date
                        order by fb.effective_from desc limit 1), v_first_uplift)
           else 0 end as uplift
    from qbo_time_activities a
    join qbo_customer_resolution res
      on res.realm_id = a.realm_id and res.qbo_customer_id = a.customer_qbo_id
    left join qbo_employee_staff_map p
      on p.realm_id = a.realm_id
     and p.qbo_entity_type = case when a.employee_qbo_id is not null then 'Employee' else 'Vendor' end
     and p.qbo_id = coalesce(a.employee_qbo_id, a.vendor_qbo_id)
    where a.txn_date between p_from and p_to
      and res.client_id is not null
  ), ec as (
    select e.*,
           coalesce(e.rate, v_avg) + e.uplift as use_rate,
           (e.rate is null and not e.gone) as est,
           (e.rate is null and e.gone) as former
    from e
  ), per_staff as (
    select cid,
           coalesce(lower(sem), 'unmapped:' || coalesce(pname, '')) as skey,
           max(lower(sem)) as sem,
           max(pname) as pname,
           sum(minutes)::bigint as mins,
           sum(minutes / 60.0 * use_rate) as scost,
           bool_or(est) as sest,
           bool_or(former) as sformer
    from ec
    group by cid, coalesce(lower(sem), 'unmapped:' || coalesce(pname, ''))
  ), per_client as (
    select cid,
           sum(minutes)::bigint as mins,
           sum(case when est and use_rate is not null then minutes else 0 end)::bigint as est_mins,
           sum(case when use_rate is null then minutes else 0 end)::bigint as unc_mins,
           sum(minutes / 60.0 * use_rate) as ccost,
           sum(case when est then minutes / 60.0 * use_rate else 0 end) as est_cost,
           sum(case when former and use_rate is not null then minutes else 0 end)::bigint as fmr_mins,
           sum(case when former then minutes / 60.0 * use_rate else 0 end) as fmr_cost
    from ec
    group by cid
  ), staff_json as (
    select ps.cid,
           jsonb_agg(jsonb_build_object(
             'staff_email', ps.sem,
             'staff_name', coalesce(s.name, ps.pname, ps.sem),
             'minutes', ps.mins,
             'cost', round(ps.scost, 2),
             'estimated', ps.sest,
             'former', ps.sformer
           ) order by ps.scost desc nulls last, ps.mins desc) as j
    from per_staff ps
    left join staff s on lower(s.email) = ps.sem
    group by ps.cid
  ), base as (
    select c.id as cid,
           c.name as cname,
           case when f.client_id is not null then f.monthly_fee
                when p_default_fees ? c.id and jsonb_typeof(p_default_fees -> c.id) = 'number'
                  then (p_default_fees ->> c.id)::numeric end as fee,
           case when f.client_id is not null then 'actual'
                when p_default_fees ? c.id and jsonb_typeof(p_default_fees -> c.id) = 'number'
                  then 'tier_default' end as src
    from clients c
    left join client_fees f on f.client_id = c.id
    where public.is_roster_client(c)
  )
  select b.cid,
         b.cname,
         b.fee,
         b.src,
         round(v_months, 4),
         round(b.fee * v_months, 2),
         coalesce(pc.mins, 0),
         coalesce(pc.est_mins, 0),
         coalesce(pc.unc_mins, 0),
         case when coalesce(pc.mins, 0) = 0 then 0::numeric
              when pc.ccost is null then null
              else round(pc.ccost, 2) end,
         round(coalesce(pc.est_cost, 0), 2),
         case when b.fee is null then null
              when coalesce(pc.mins, 0) = 0 then round(b.fee * v_months, 2)
              when pc.ccost is null then null
              else round(b.fee * v_months - pc.ccost, 2) end,
         case when b.fee is null or b.fee * v_months = 0 then null
              when coalesce(pc.mins, 0) = 0 then 100::numeric
              when pc.ccost is null then null
              else round((b.fee * v_months - pc.ccost) / (b.fee * v_months) * 100, 1) end,
         round(v_avg, 2),
         coalesce(sj.j, '[]'::jsonb),
         coalesce(pc.fmr_mins, 0),
         round(coalesce(pc.fmr_cost, 0), 2),
         v_basis
  from base b
  left join per_client pc on pc.cid = b.cid
  left join staff_json sj on sj.cid = b.cid
  order by 13 asc nulls last, 2;
end;
$function$;
revoke all on function public.client_profitability(date, date, jsonb, text) from public;
revoke all on function public.client_profitability(date, date, jsonb, text) from anon;
grant execute on function public.client_profitability(date, date, jsonb, text) to authenticated;
grant execute on function public.client_profitability(date, date, jsonb, text) to service_role;

-- ---------------------------------------------------------------------------
-- 2 + 3. internal_hours(p_from, p_to, p_basis)
-- ---------------------------------------------------------------------------
drop function if exists public.internal_hours(date, date);
create or replace function public.internal_hours(p_from date, p_to date, p_basis text default 'staff')
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
  v_basis text := coalesce(p_basis, 'staff');
  v_first_uplift numeric;
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
  if v_basis not in ('staff', 'full') then
    raise exception 'unknown cost basis' using errcode = '22023';
  end if;
  if v_basis = 'full' then
    -- MGB Home S3: Full cost needs the firm cost basis set on Cost rates.
    select fb.full_rate - fb.staff_rate into v_first_uplift
      from firm_cost_basis fb order by fb.effective_from asc limit 1;
    if v_first_uplift is null then
      raise exception 'no firm cost basis' using errcode = '22023';
    end if;
  end if;

  -- Same fallback as client_profitability: the average of each person's
  -- latest rate on or before p_to, used for anyone without a rate on the
  -- entry date (marked estimated for current staff, former for people who
  -- have left).
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
           (coalesce(p.ignored, false)
              or exists (select 1 from staff s0 where lower(s0.email) = lower(p.staff_email) and not s0.active)) as gone,
           coalesce((t.realm_id, t.customer_qbo_id) in (select ic.realm_id, ic.qbo_customer_id from ic), false) as internal
      from qbo_time_activities t
      left join qbo_employee_staff_map p
        on p.realm_id = t.realm_id
       and p.qbo_entity_type = case when t.employee_qbo_id is not null then 'Employee' else 'Vendor' end
       and p.qbo_id = coalesce(t.employee_qbo_id, t.vendor_qbo_id)
     where t.txn_date between p_from and p_to
  ), ak as (
    select a.*, coalesce(a.sem, 'unmapped:' || coalesce(a.pname, '')) as pkey from a
  ), e0 as (
    select ak.*,
           r.rate,
           case when v_basis = 'full' then
             coalesce((select fb.full_rate - fb.staff_rate from firm_cost_basis fb
                        where fb.effective_from <= ak.txn_date
                        order by fb.effective_from desc limit 1), v_first_uplift)
           else 0 end as uplift
      from ak
      left join lateral (
        select sc.hourly_cost as rate
          from staff_cost_rates sc
         where sc.staff_email = ak.sem and sc.effective_from <= ak.txn_date
         order by sc.effective_from desc
         limit 1) r on true
     where ak.internal
  ), e as (
    select e0.*,
           coalesce(e0.rate, v_avg) + e0.uplift as use_rate,
           (e0.rate is null and not e0.gone) as est,
           (e0.rate is null and e0.gone) as former
      from e0
  ), all_by_person as (
    select pkey, sum(minutes)::bigint as mins from ak group by pkey
  ), people as (
    select e.pkey,
           max(e.sem) as sem,
           max(e.pname) as pname,
           sum(e.minutes)::bigint as mins,
           round(sum(e.minutes / 60.0 * e.use_rate), 2) as cost,
           bool_or(e.est and e.use_rate is not null) as est,
           bool_or(e.former and e.use_rate is not null) as fmr,
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
    'basis', v_basis,
    'rates_set', v_rates,
    'totals', (
      select jsonb_build_object(
        'minutes', coalesce(sum(e.minutes), 0)::bigint,
        'entries', count(*)::bigint,
        'people', count(distinct e.pkey)::bigint,
        'cost', round(coalesce(sum(e.minutes / 60.0 * e.use_rate), 0), 2),
        'estimated_minutes', coalesce(sum(case when e.est and e.use_rate is not null then e.minutes end), 0)::bigint,
        'estimated_cost', round(coalesce(sum(case when e.est then e.minutes / 60.0 * e.use_rate end), 0), 2),
        'former_minutes', coalesce(sum(case when e.former and e.use_rate is not null then e.minutes end), 0)::bigint,
        'former_cost', round(coalesce(sum(case when e.former then e.minutes / 60.0 * e.use_rate end), 0), 2),
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
               'former', p.fmr,
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
revoke all on function public.internal_hours(date, date, text) from public;
revoke all on function public.internal_hours(date, date, text) from anon;
grant execute on function public.internal_hours(date, date, text) to authenticated;
grant execute on function public.internal_hours(date, date, text) to service_role;

-- ---------------------------------------------------------------------------
-- 4. usage_events: the Cost rates page is internal too
-- ---------------------------------------------------------------------------
create or replace function public.usage_events__mh_is_internal(p_page text, p_tab text, p_detail text, p_actor text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $f$
  select coalesce(p_page like 'mgb-%', false)
      or (p_page = 'help' and p_tab in ('mgb-home', 'profitability'))
      or coalesce(p_detail ~ '^help-page:(mgb-home|profitability)$', false)
      or coalesce(p_detail ~* '(mgb-(home|overhead|profitability|pricing|costs)|#?/internal/(overhead|profitability|pricing|books|costs))', false)
      or (coalesce(p_detail ~* '^guide-(search|miss):.*(mgb|overhead|profitab|margin|internal|cost)', false)
          and exists (select 1 from internal_access ia where lower(ia.staff_email) = lower(p_actor)));
$f$;
revoke all on function public.usage_events__mh_is_internal(text, text, text, text) from public;
revoke all on function public.usage_events__mh_is_internal(text, text, text, text) from anon;
revoke all on function public.usage_events__mh_is_internal(text, text, text, text) from authenticated;

update public.usage_events
   set client_id = (select c.id from public.clients c where c.is_internal order by c.id limit 1)
 where client_id is null
   and public.usage_events__mh_is_internal(page, tab, detail, actor_email);

notify pgrst, 'reload schema';

-- Quick check after applying:
--   select relrowsecurity from pg_class where oid = 'public.firm_cost_basis'::regclass;      -- true
--   select count(*) from public.firm_cost_basis;                                             -- 0 (owner enters values)
--   select oid::regprocedure from pg_proc where proname in ('client_profitability', 'internal_hours');
--   select has_function_privilege('anon', 'public.internal_hours(date,date,text)', 'execute');  -- false
--   select qual from pg_policies where tablename = 'audit_log' and policyname = 'profitability internal only';
