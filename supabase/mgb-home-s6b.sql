-- MGB Home, slice S6b: Capacity prices by date (fix after the S6 review).
-- Applied to production 2026-11-02 (Supabase MCP apply_migration, name mgb_home_s6b).
--
-- Review defect (2026-11-02): S6's capacity_inputs() looked up each person's
-- rate (and, on Full cost, the firm overhead per hour) at the END of each
-- month and the page applied allocation rules at month end too, so a raise or
-- a new rule in the middle of a month repriced the whole month. Profitability
-- (client_profitability) and Overhead (internal_hours) price each entry at the
-- rate on its txn_date, so Capacity disagreed with them in such a month, and
-- the guide promises "A newer rule takes over from its date".
--
-- This replaces capacity_inputs(p_from, p_to, p_basis, p_default_fees) only
-- (same signature, same grant check: is_active_staff_admin() and
-- can_view_internal(), else 42501; same grants). Each person_months row gains
-- 'segments': the month cut at every date the person's rate, the firm cost
-- basis (Full cost only) or one of their allocation rules starts. Each segment
-- has { from, to, days, minutes, contract_minutes, rate, estimated, former },
-- with the rate in effect on its first day, so logged minutes in a segment are
-- priced exactly as client_profitability prices them by txn_date. The page
-- (components/internal/MH_capacity.js MH_capPriceMonth) prices each segment,
-- spreads unlogged target hours over the segments by days, and applies the
-- rules in effect on each segment's first day. Every S6 key stays as it was
-- (including the month-level 'rate'), so a page still on the old script keeps
-- working until it reloads.
--
-- Additive: no table, policy or data change. Safe to re-run.
-- Tests: supabase/mgb-home-tests.sql (rolls back), section S6b.

create or replace function public.capacity_inputs(
  p_from date, p_to date, p_basis text default 'staff', p_default_fees jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $f$
declare
  v_to date;
  v_avg numeric;
  v_basis text := coalesce(p_basis, 'staff');
  v_first_uplift numeric;
  v_fees jsonb := coalesce(p_default_fees, '{}'::jsonb);
  v_out jsonb;
begin
  -- MGB Home S6 / S6b: only an active admin with the MGB (internal) grant.
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
  if jsonb_typeof(v_fees) <> 'object' then
    v_fees := '{}'::jsonb;
  end if;
  if v_basis = 'full' then
    select fb.full_rate - fb.staff_rate into v_first_uplift
      from firm_cost_basis fb order by fb.effective_from asc limit 1;
    if v_first_uplift is null then
      raise exception 'no firm cost basis' using errcode = '22023';
    end if;
  end if;

  -- Capacity is about time that has passed: stop at today.
  v_to := least(p_to, current_date);

  -- Same firm-average fallback as client_profitability / internal_hours.
  select avg(r.hourly_cost) into v_avg
  from (
    select distinct on (staff_email) hourly_cost
    from staff_cost_rates
    where effective_from <= v_to
    order by staff_email, effective_from desc
  ) r;

  with mo as (
    select m::date as m,
           (m + interval '1 month - 1 day')::date as mend,
           greatest(p_from, m::date) as cfrom,
           least(v_to, (m + interval '1 month - 1 day')::date) as cto
      from generate_series(date_trunc('month', p_from), date_trunc('month', v_to), interval '1 month') as m
     where v_to >= p_from
  ), months as (
    select mo.*, extract(day from mo.mend)::int as days, (mo.cto - mo.cfrom + 1)::int as covered
      from mo
  ), cc as (
    select c.client_id, c.label from cost_contract_clients c
  ), a as (
    select date_trunc('month', t.txn_date)::date as m,
           t.txn_date as d,
           t.minutes,
           res.client_id as cid,
           coalesce(t.employee_name, t.vendor_name) as pname,
           lower(p.staff_email) as sem,
           coalesce(p.ignored, false) as ign
      from qbo_time_activities t
      left join qbo_employee_staff_map p
        on p.realm_id = t.realm_id
       and p.qbo_entity_type = case when t.employee_qbo_id is not null then 'Employee' else 'Vendor' end
       and p.qbo_id = coalesce(t.employee_qbo_id, t.vendor_qbo_id)
      left join qbo_customer_resolution res
        on res.realm_id = t.realm_id and res.qbo_customer_id = t.customer_qbo_id
     where t.txn_date between p_from and v_to
  ), ak as (
    select a.*, coalesce(a.sem, 'unmapped:' || coalesce(a.pname, '')) as pkey from a
  ), keys as (
    select ak.pkey, max(ak.sem) as sem, max(ak.pname) as pname, bool_or(ak.ign) as ign
      from ak group by ak.pkey
    union all
    select lower(s.email), lower(s.email), null, false
      from staff s
     where s.active
       and (exists (select 1 from staff_capacity sc where lower(sc.staff_email) = lower(s.email))
            or exists (select 1 from staff_cost_allocations al where al.staff_email = lower(s.email)))
       and lower(s.email) not in (select ak2.pkey from ak ak2)
  ), people as (
    select k.pkey, k.sem, s.name as sname, k.pname, s.role, coalesce(s.active, false) as active,
           (k.ign or (s.email is not null and not s.active)) as gone,
           case when coalesce(s.active, false) then cap.weekly_target_hours end as target
      from keys k
      left join staff s on lower(s.email) = k.sem
      left join staff_capacity cap on lower(cap.staff_email) = k.sem
  ), pm_hours as (
    select ak.pkey, ak.m,
           sum(ak.minutes)::bigint as mins,
           sum(case when ak.cid is null then ak.minutes else 0 end)::bigint as no_client_mins
      from ak group by ak.pkey, ak.m
  ), pm_contract as (
    select x.pkey, x.m, jsonb_object_agg(x.cid, x.mins) as j
      from (select ak.pkey, ak.m, ak.cid, sum(ak.minutes)::bigint as mins
              from ak join cc on cc.client_id = ak.cid
             group by ak.pkey, ak.m, ak.cid) x
     group by x.pkey, x.m
  ), pm as (
    select p.pkey, mo.m, mo.cfrom, mo.cto, p.sem,
           coalesce(h.mins, 0) as mins,
           coalesce(h.no_client_mins, 0) as no_client_mins,
           coalesce(c.j, '{}'::jsonb) as contract_minutes,
           r.rate,
           case when v_basis = 'full' then
             coalesce((select fb.full_rate - fb.staff_rate from firm_cost_basis fb
                        where fb.effective_from <= mo.cto
                        order by fb.effective_from desc limit 1), v_first_uplift)
           else 0 end as uplift,
           p.gone
      from people p
      cross join months mo
      left join pm_hours h on h.pkey = p.pkey and h.m = mo.m
      left join pm_contract c on c.pkey = p.pkey and c.m = mo.m
      left join lateral (
        select sr.hourly_cost as rate
          from staff_cost_rates sr
         where lower(sr.staff_email) = p.sem and sr.effective_from <= mo.cto
         order by sr.effective_from desc
         limit 1) r on true
     where coalesce(h.mins, 0) > 0 or p.target is not null
        or exists (select 1 from staff_cost_allocations al where al.staff_email = p.sem)
  ), bd as (
    -- S6b: cut each person-month where their rate, the firm cost basis (Full
    -- cost only) or one of their allocation rules starts, so every segment
    -- has one rate and one set of rules (priced by date, as
    -- client_profitability prices each entry by its txn_date).
    select pm.pkey, pm.m, pm.cfrom as d from pm
    union
    select pm.pkey, pm.m, sr.effective_from
      from pm join staff_cost_rates sr on lower(sr.staff_email) = pm.sem
     where sr.effective_from > pm.cfrom and sr.effective_from <= pm.cto
    union
    select pm.pkey, pm.m, fb.effective_from
      from pm join firm_cost_basis fb on v_basis = 'full'
     where fb.effective_from > pm.cfrom and fb.effective_from <= pm.cto
    union
    select pm.pkey, pm.m, al.effective_from
      from pm join staff_cost_allocations al on al.staff_email = pm.sem
     where al.effective_from > pm.cfrom and al.effective_from <= pm.cto
  ), seg as (
    select b.pkey, b.m, b.d as sfrom,
           coalesce(lead(b.d) over (partition by b.pkey, b.m order by b.d) - 1, pm.cto) as sto,
           pm.sem, pm.gone
      from bd b join pm on pm.pkey = b.pkey and pm.m = b.m
  ), seg_mins as (
    select s.pkey, s.m, s.sfrom, sum(ak.minutes)::bigint as mins
      from seg s join ak on ak.pkey = s.pkey and ak.m = s.m and ak.d between s.sfrom and s.sto
     group by s.pkey, s.m, s.sfrom
  ), seg_contract as (
    select x.pkey, x.m, x.sfrom, jsonb_object_agg(x.cid, x.mins) as j
      from (select s.pkey, s.m, s.sfrom, ak.cid, sum(ak.minutes)::bigint as mins
              from seg s
              join ak on ak.pkey = s.pkey and ak.m = s.m and ak.d between s.sfrom and s.sto
              join cc on cc.client_id = ak.cid
             group by s.pkey, s.m, s.sfrom, ak.cid) x
     group by x.pkey, x.m, x.sfrom
  ), seg_x as (
    select s.pkey, s.m, s.sfrom, s.sto, s.gone,
           coalesce(sm.mins, 0) as mins,
           coalesce(sc.j, '{}'::jsonb) as contract_minutes,
           (select sr.hourly_cost from staff_cost_rates sr
             where lower(sr.staff_email) = s.sem and sr.effective_from <= s.sfrom
             order by sr.effective_from desc limit 1) as rate,
           case when v_basis = 'full' then
             coalesce((select fb.full_rate - fb.staff_rate from firm_cost_basis fb
                        where fb.effective_from <= s.sfrom
                        order by fb.effective_from desc limit 1), v_first_uplift)
           else 0 end as uplift
      from seg s
      left join seg_mins sm on sm.pkey = s.pkey and sm.m = s.m and sm.sfrom = s.sfrom
      left join seg_contract sc on sc.pkey = s.pkey and sc.m = s.m and sc.sfrom = s.sfrom
  ), segs as (
    select sx.pkey, sx.m,
           jsonb_agg(jsonb_build_object(
             'from', sx.sfrom, 'to', sx.sto, 'days', (sx.sto - sx.sfrom + 1),
             'minutes', sx.mins, 'contract_minutes', sx.contract_minutes,
             'rate', round(coalesce(sx.rate, v_avg) + sx.uplift, 4),
             'estimated', sx.rate is null and v_avg is not null and not sx.gone,
             'former', sx.rate is null and v_avg is not null and sx.gone)
             order by sx.sfrom) as j
      from seg_x sx
     group by sx.pkey, sx.m
  ), cl as (
    select c.id as cid, c.name as cname,
           case when f.client_id is not null then f.monthly_fee
                when v_fees ? c.id and jsonb_typeof(v_fees -> c.id) = 'number'
                  then (v_fees ->> c.id)::numeric end as fee,
           case when f.client_id is not null then 'actual'
                when v_fees ? c.id and jsonb_typeof(v_fees -> c.id) = 'number'
                  then 'tier_default' end as src,
           exists (select 1 from cc where cc.client_id = c.id) as contract
      from clients c
      left join client_fees f on f.client_id = c.id
     where not coalesce(c.is_internal, false)
       and (public.is_roster_client(c) or exists (select 1 from cc where cc.client_id = c.id))
  ), work as (
    select ak.pkey, ak.cid, ak.m, sum(ak.minutes)::bigint as mins
      from ak join cl on cl.cid = ak.cid
     group by ak.pkey, ak.cid, ak.m
  )
  select jsonb_build_object(
    'from', p_from,
    'to', v_to,
    'basis', v_basis,
    'rates_set', v_avg is not null,
    'avg_rate', round(v_avg, 2),
    'months', coalesce((select jsonb_agg(jsonb_build_object(
                 'month', months.m, 'days', months.days, 'covered_days', months.covered) order by months.m)
               from months), '[]'::jsonb),
    'contracts', coalesce((select jsonb_agg(jsonb_build_object(
                 'client_id', cc.client_id, 'label', cc.label,
                 'name', (select c.name from clients c where c.id = cc.client_id)) order by cc.label)
               from cc), '[]'::jsonb),
    'allocations', coalesce((select jsonb_agg(jsonb_build_object(
                 'id', al.id, 'staff_email', al.staff_email, 'client_id', al.client_id,
                 'share', al.share, 'method', al.method, 'effective_from', al.effective_from)
                 order by al.staff_email, al.client_id, al.effective_from)
               from staff_cost_allocations al), '[]'::jsonb),
    'people', coalesce((select jsonb_agg(jsonb_build_object(
                 'key', p.pkey, 'staff_email', p.sem,
                 'name', coalesce(p.sname, p.pname, p.sem),
                 'role', p.role, 'active', p.active, 'mapped', p.sem is not null,
                 'former', p.gone, 'weekly_target', p.target)
                 order by coalesce(p.sname, p.pname, p.sem))
               from people p), '[]'::jsonb),
    'person_months', coalesce((select jsonb_agg(jsonb_build_object(
                 'key', pm.pkey, 'month', pm.m, 'minutes', pm.mins,
                 'no_client_minutes', pm.no_client_mins,
                 'contract_minutes', pm.contract_minutes,
                 'rate', round(coalesce(pm.rate, v_avg) + pm.uplift, 4),
                 'estimated', pm.rate is null and v_avg is not null and not pm.gone,
                 'former', pm.rate is null and v_avg is not null and pm.gone,
                 'segments', coalesce((select sg.j from segs sg where sg.pkey = pm.pkey and sg.m = pm.m), '[]'::jsonb))
                 order by pm.pkey, pm.m)
               from pm), '[]'::jsonb),
    'clients', coalesce((select jsonb_agg(jsonb_build_object(
                 'client_id', cl.cid, 'name', cl.cname, 'monthly_fee', cl.fee,
                 'fee_source', cl.src, 'contract', cl.contract)
                 order by cl.cname)
               from cl), '[]'::jsonb),
    'work', coalesce((select jsonb_agg(jsonb_build_object(
                 'key', w.pkey, 'client_id', w.cid, 'month', w.m, 'minutes', w.mins)
                 order by w.pkey, w.cid, w.m)
               from work w), '[]'::jsonb)
  ) into v_out;

  return v_out;
end;
$f$;
revoke all on function public.capacity_inputs(date, date, text, jsonb) from public;
revoke all on function public.capacity_inputs(date, date, text, jsonb) from anon;
grant execute on function public.capacity_inputs(date, date, text, jsonb) to authenticated;
grant execute on function public.capacity_inputs(date, date, text, jsonb) to service_role;

notify pgrst, 'reload schema';

-- Quick check after applying:
--   select position('seg_contract' in pg_get_functiondef('public.capacity_inputs(date,date,text,jsonb)'::regprocedure)) > 0;  -- true
--   select has_function_privilege('anon', 'public.capacity_inputs(date,date,text,jsonb)', 'execute');  -- false
