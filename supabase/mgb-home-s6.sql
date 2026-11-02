-- MGB Home, slice S6: Capacity (docs/mgb-home-spec.md "Capacity", OQ7).
-- Applied to production 2026-11-02 (Supabase MCP apply_migration, name mgb_home_s6).
--
-- Owner answers (OQ7, 2026-11-02): IHH is Illumination Health and Home, a
-- separate contract client (already a QuickBooks Time customer resolved to the
-- portal client 'illumination-health-home'). Carmen works 100% on IHH. Jesse is
-- an MGB account manager who does most of the IHH work: his cost splits between
-- IHH and MGB clients by his logged QuickBooks Time hours; in a month with no
-- logged hours, a stored fallback share applies (owner edits it).
--
-- 1. cost_contract_clients: which clients are separate contracts whose staff
--    cost is shown apart from MGB clients (seed: IHH). Additive marker on the
--    existing client; no change to clients or the QuickBooks mapping.
-- 2. staff_cost_allocations(person, contract client, share, method,
--    effective_from): 'fixed' rows always apply (Carmen 100% IHH, seeded);
--    'fallback' rows apply only in a month with no logged hours (none seeded,
--    the owner adds Jesse's if wanted). No pay figures stored here.
--    Both tables: RLS = active admin with the MGB (internal) grant, every
--    command; stamped updated_by/updated_at; audited as cost_contract.* and
--    cost_alloc.* and those audit rows join the "profitability internal only"
--    RESTRICTIVE audit_log policy; the RESTRICTIVE "internal company lock"
--    policy, as every table with client_id has.
-- 3. capacity_inputs(p_from, p_to, p_basis, p_default_fees) SECURITY DEFINER:
--    raw per person/month hours, contract hours, loaded rate (+ full-cost
--    uplift), target hours, client fees per month and who logged time where.
--    The page (components/internal/MH_capacity.js) does the allocation math.
--    Refuses (42501) without is_active_staff_admin() and can_view_internal().
-- 4. usage_events: the Capacity page (mgb-capacity, #/internal/capacity) and
--    capacity/allocation/IHH guide searches by a grant holder file under the
--    internal client.
--
-- Safe to re-run. Tests: supabase/mgb-home-tests.sql (rolls back), section S6.

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
-- 1. cost_contract_clients
-- ---------------------------------------------------------------------------
create table if not exists public.cost_contract_clients (
  client_id text primary key references public.clients(id) on delete cascade,
  label text not null check (length(btrim(label)) between 1 and 40),
  note text check (note is null or length(note) <= 500),
  updated_by text,
  updated_at timestamptz not null default now()
);
comment on table public.cost_contract_clients is
  'MGB Home S6: clients that are separate contracts (e.g. IHH); Capacity shows their staff cost apart from MGB clients. Grant holders only.';

-- ---------------------------------------------------------------------------
-- 2. staff_cost_allocations
-- ---------------------------------------------------------------------------
create table if not exists public.staff_cost_allocations (
  id bigint generated always as identity primary key,
  staff_email text not null check (staff_email = lower(btrim(staff_email)) and length(staff_email) between 3 and 320),
  client_id text not null references public.cost_contract_clients(client_id) on delete cascade,
  share numeric not null check (share >= 0 and share <= 1),
  method text not null default 'fixed' check (method in ('fixed', 'fallback')),
  effective_from date not null,
  note text check (note is null or length(note) <= 500),
  updated_by text,
  updated_at timestamptz not null default now(),
  constraint staff_cost_allocations_uniq unique (staff_email, client_id, method, effective_from)
);
comment on table public.staff_cost_allocations is
  'MGB Home S6: share of a person''s cost that sits on a contract client. fixed = always; fallback = only in a month with no logged hours. Grant holders only.';

do $do$
declare
  t text;
begin
  foreach t in array array['cost_contract_clients', 'staff_cost_allocations'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon', t);
    execute format('revoke all on table public.%I from public', t);
    execute format('revoke all on table public.%I from authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', t);

    execute format('drop policy if exists "capacity read" on public.%I', t);
    execute format('drop policy if exists "capacity insert" on public.%I', t);
    execute format('drop policy if exists "capacity update" on public.%I', t);
    execute format('drop policy if exists "capacity delete" on public.%I', t);
    execute format('drop policy if exists "internal company lock" on public.%I', t);
    execute format($p$create policy "capacity read" on public.%I for select to authenticated
      using ((select public.is_active_staff_admin()) and (select public.can_view_internal()))$p$, t);
    execute format($p$create policy "capacity insert" on public.%I for insert to authenticated
      with check ((select public.is_active_staff_admin()) and (select public.can_view_internal()))$p$, t);
    execute format($p$create policy "capacity update" on public.%I for update to authenticated
      using ((select public.is_active_staff_admin()) and (select public.can_view_internal()))
      with check ((select public.is_active_staff_admin()) and (select public.can_view_internal()))$p$, t);
    execute format($p$create policy "capacity delete" on public.%I for delete to authenticated
      using ((select public.is_active_staff_admin()) and (select public.can_view_internal()))$p$, t);
    execute format($p$create policy "internal company lock" on public.%I as restrictive for all to public
      using ((client_id is null) or (client_id <> all ((select public.internal_blocked_ids())::text[])))
      with check ((client_id is null) or (client_id <> all ((select public.internal_blocked_ids())::text[])))$p$, t);

    -- Who changed it: always the signed-in caller (same stamp as firm_cost_basis).
    execute format('drop trigger if exists %I on public.%I', t || '_stamp', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.firm_cost_basis__stamp()',
                   t || '_stamp', t);
    execute format('drop trigger if exists audit_log_trg on public.%I', t);
    execute format('create trigger audit_log_trg after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t);
  end loop;
end
$do$;

-- Audit: cost_contract.* / cost_alloc.* (client_id left null on purpose; the
-- RESTRICTIVE policy below hides them from admins without the grant).
select pg_temp.mh_patch_fn('public.audit_row_change()',
  $a$  elsif t = 'profitability_settings' then$a$,
  $a$  elsif t = 'cost_contract_clients' then
    -- MGB Home S6: contract clients (grant holders only, see audit_log policy)
    if tg_op = 'UPDATE' and (o ->> 'label') is not distinct from (n ->> 'label')
       and (o ->> 'client_id') is not distinct from (n ->> 'client_id') then
      return null;
    end if;
    perform audit_write(
      case tg_op when 'INSERT' then 'cost_contract.set' when 'DELETE' then 'cost_contract.removed' else 'cost_contract.changed' end,
      null, 'client', r ->> 'client_id',
      jsonb_build_object('client', r ->> 'client_id', 'label_from', o -> 'label', 'label_to', n -> 'label'));

  elsif t = 'staff_cost_allocations' then
    -- MGB Home S6: cost allocation rows (grant holders only)
    if tg_op = 'UPDATE' and (o ->> 'share') is not distinct from (n ->> 'share')
       and (o ->> 'method') is not distinct from (n ->> 'method')
       and (o ->> 'client_id') is not distinct from (n ->> 'client_id')
       and (o ->> 'staff_email') is not distinct from (n ->> 'staff_email')
       and (o ->> 'effective_from') is not distinct from (n ->> 'effective_from') then
      return null;
    end if;
    perform audit_write(
      case tg_op when 'INSERT' then 'cost_alloc.set' when 'DELETE' then 'cost_alloc.removed' else 'cost_alloc.changed' end,
      null, 'staff', r ->> 'staff_email',
      jsonb_build_object('client', r ->> 'client_id', 'method', r ->> 'method',
                         'effective_from', r ->> 'effective_from',
                         'share_from', o -> 'share', 'share_to', n -> 'share'));

  elsif t = 'profitability_settings' then$a$,
  $a$MGB Home S6: contract clients$a$, 1);

drop policy if exists "profitability internal only" on public.audit_log;
create policy "profitability internal only" on public.audit_log
  as restrictive
  for select
  to authenticated
  using ((action !~ '^(client_fee|cost_rate|profitability|firm_cost|cost_contract|cost_alloc)\.') or (select public.can_view_internal()));

-- Seeds (owner decision 2026-11-02): IHH is a contract client; Carmen is 100% IHH.
-- Jesse gets no row: his split comes from his logged hours.
insert into public.cost_contract_clients (client_id, label, note)
select c.id, 'IHH', 'Illumination Health and Home, separate contract (owner, 2026-11-02)'
  from public.clients c
 where c.id = 'illumination-health-home'
on conflict (client_id) do nothing;

insert into public.staff_cost_allocations (staff_email, client_id, share, method, effective_from, note)
select lower(s.email), 'illumination-health-home', 1, 'fixed', date '2000-01-01', 'Owner, 2026-11-02: 100% IHH'
  from public.staff s
 where s.active and s.name ilike 'Carmen%Delacruz%'
   and exists (select 1 from public.cost_contract_clients cc where cc.client_id = 'illumination-health-home')
 order by s.created_at
 limit 1
on conflict on constraint staff_cost_allocations_uniq do nothing;

-- ---------------------------------------------------------------------------
-- 3. capacity_inputs(p_from, p_to, p_basis, p_default_fees)
-- ---------------------------------------------------------------------------
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
  -- MGB Home S6: only an active admin with the MGB (internal) grant.
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
    select p.pkey, mo.m,
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
                 'former', pm.rate is null and v_avg is not null and pm.gone)
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

-- ---------------------------------------------------------------------------
-- 4. usage_events: the Capacity page is internal too
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
      or coalesce(p_detail ~* '(mgb-(home|overhead|profitability|pricing|costs|capacity)|#?/internal/(overhead|profitability|pricing|books|costs|capacity))', false)
      or (coalesce(p_detail ~* '^guide-(search|miss):.*(mgb|overhead|profitab|margin|internal|cost|capacity|allocat|ihh)', false)
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
--   select relrowsecurity from pg_class where oid in ('public.cost_contract_clients'::regclass, 'public.staff_cost_allocations'::regclass);
--   select count(*) from public.cost_contract_clients;            -- 1 (IHH)
--   select count(*), min(method) from public.staff_cost_allocations;  -- 1, fixed (Carmen)
--   select has_function_privilege('anon', 'public.capacity_inputs(date,date,text,jsonb)', 'execute');  -- false
--   select qual from pg_policies where tablename = 'audit_log' and policyname = 'profitability internal only';
