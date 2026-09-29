-- Client profitability (owner request 2026-09-29).
--
-- Applied to production 2026-09-29 as migration client_profitability.
-- Safe to re-run. If it were missing the app would hide the
-- profit columns and says so.
--
-- Everything here is ADMIN-ONLY. Bookkeepers never read fees, pay rates,
-- cost or margin.
--
--   client_fees            the client's actual monthly fee. With no row, the
--                          app falls back to the pricing-milestone tier fee
--                          ("tier default"), which it passes to the RPC.
--   staff_cost_rates       loaded hourly cost per staff member, keyed by
--                          effective_from, so a pay change adds a row and
--                          never rewrites history.
--   profitability_settings one row: target margin % (default 40).
--   client_profitability() per client for a date range:
--       revenue = monthly fee x months in the range (partial months prorated
--                 by days)
--       cost    = sum over QuickBooks Time entries on that client of
--                 hours x the person's rate effective on the entry date.
--                 Entries with no mapped staff member, or a staff member with
--                 no rate yet, are costed at the average current rate and
--                 counted as "estimated".
--       profit  = revenue - cost;  margin % = profit / revenue.
--
-- Hours come from qbo_time_activities resolved through
-- qbo_customer_resolution / qbo_employee_staff_map, the same way as
-- qbo_hours_by_client / qbo_hours_by_staff (supabase/qbo-firm-time.sql).
--
-- The RPC is SECURITY INVOKER with an explicit is_active_staff_admin() check;
-- the tables it reads are all admin-only under RLS as well.

begin;

-- ---------------------------------------------------------------------------
-- Actual monthly fee per client
-- ---------------------------------------------------------------------------
create table if not exists public.client_fees (
  client_id text primary key references public.clients (id) on delete cascade,
  monthly_fee numeric(12, 2) not null check (monthly_fee >= 0),
  updated_by text,
  updated_at timestamptz not null default now()
);
alter table public.client_fees enable row level security;
revoke all on public.client_fees from anon;
grant select, insert, update, delete on public.client_fees to authenticated;

drop policy if exists "admins read client fees" on public.client_fees;
create policy "admins read client fees" on public.client_fees
  for select to authenticated using (public.is_active_staff_admin());
drop policy if exists "admins write client fees" on public.client_fees;
create policy "admins write client fees" on public.client_fees
  for insert to authenticated with check (public.is_active_staff_admin());
drop policy if exists "admins update client fees" on public.client_fees;
create policy "admins update client fees" on public.client_fees
  for update to authenticated
  using (public.is_active_staff_admin()) with check (public.is_active_staff_admin());
drop policy if exists "admins delete client fees" on public.client_fees;
create policy "admins delete client fees" on public.client_fees
  for delete to authenticated using (public.is_active_staff_admin());

-- ---------------------------------------------------------------------------
-- Loaded hourly cost per staff member (history kept by effective_from)
-- ---------------------------------------------------------------------------
create table if not exists public.staff_cost_rates (
  staff_email text not null check (staff_email = lower(staff_email)),
  effective_from date not null,
  hourly_cost numeric(10, 2) not null check (hourly_cost >= 0),
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (staff_email, effective_from)
);
alter table public.staff_cost_rates enable row level security;
revoke all on public.staff_cost_rates from anon;
grant select, insert, update, delete on public.staff_cost_rates to authenticated;

drop policy if exists "admins read staff cost rates" on public.staff_cost_rates;
create policy "admins read staff cost rates" on public.staff_cost_rates
  for select to authenticated using (public.is_active_staff_admin());
drop policy if exists "admins write staff cost rates" on public.staff_cost_rates;
create policy "admins write staff cost rates" on public.staff_cost_rates
  for insert to authenticated with check (public.is_active_staff_admin());
drop policy if exists "admins update staff cost rates" on public.staff_cost_rates;
create policy "admins update staff cost rates" on public.staff_cost_rates
  for update to authenticated
  using (public.is_active_staff_admin()) with check (public.is_active_staff_admin());
drop policy if exists "admins delete staff cost rates" on public.staff_cost_rates;
create policy "admins delete staff cost rates" on public.staff_cost_rates
  for delete to authenticated using (public.is_active_staff_admin());

-- ---------------------------------------------------------------------------
-- Settings (single row)
-- ---------------------------------------------------------------------------
create table if not exists public.profitability_settings (
  id boolean primary key default true check (id),
  target_margin_pct numeric(5, 2) not null default 40 check (target_margin_pct between 0 and 100),
  updated_by text,
  updated_at timestamptz not null default now()
);
insert into public.profitability_settings (id) values (true) on conflict (id) do nothing;
alter table public.profitability_settings enable row level security;
revoke all on public.profitability_settings from anon;
revoke insert, delete, truncate on public.profitability_settings from authenticated;
grant select, update on public.profitability_settings to authenticated;

drop policy if exists "admins read profitability settings" on public.profitability_settings;
create policy "admins read profitability settings" on public.profitability_settings
  for select to authenticated using (public.is_active_staff_admin());
drop policy if exists "admins update profitability settings" on public.profitability_settings;
create policy "admins update profitability settings" on public.profitability_settings
  for update to authenticated
  using (public.is_active_staff_admin()) with check (public.is_active_staff_admin());

-- ---------------------------------------------------------------------------
-- Profit per client for a date range
-- ---------------------------------------------------------------------------
-- p_default_fees: {"client_id": tier_fee, ...} from the app's pricing tiers,
-- used only where client_fees has no row.
create or replace function public.client_profitability(
  p_from date,
  p_to date,
  p_default_fees jsonb default '{}'::jsonb
)
returns table (
  client_id text,
  client_name text,
  monthly_fee numeric,
  fee_source text,            -- 'actual' | 'tier_default' | null (no fee)
  months numeric,
  revenue numeric,
  total_minutes bigint,
  estimated_minutes bigint,   -- costed at the average rate
  uncosted_minutes bigint,    -- no rate at all to cost with
  cost numeric,               -- null when nothing could be costed
  estimated_cost numeric,
  profit numeric,
  margin_pct numeric,
  avg_rate numeric,
  staff_costs jsonb           -- [{staff_email, staff_name, minutes, cost, estimated}]
)
language plpgsql
stable
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_months numeric;
  v_avg numeric;
begin
  if not public.is_active_staff_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'invalid date range';
  end if;

  -- Months in the range, each calendar month prorated by overlapping days.
  select coalesce(sum(
           (least(p_to, (m + interval '1 month - 1 day')::date) - greatest(p_from, m::date) + 1)::numeric
           / extract(day from (m + interval '1 month - 1 day'))::numeric
         ), 0)
    into v_months
  from generate_series(date_trunc('month', p_from), date_trunc('month', p_to), interval '1 month') as m;

  -- Average of each staff member's rate in effect at the end of the range.
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
             order by sc.effective_from desc limit 1) as rate
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
           coalesce(e.rate, v_avg) as use_rate,
           (e.rate is null) as est
    from e
  ), per_staff as (
    select cid,
           coalesce(lower(sem), 'unmapped:' || coalesce(pname, '')) as skey,
           max(lower(sem)) as sem,
           max(pname) as pname,
           sum(minutes)::bigint as mins,
           sum(minutes / 60.0 * use_rate) as scost,
           bool_or(est) as sest
    from ec
    group by cid, coalesce(lower(sem), 'unmapped:' || coalesce(pname, ''))
  ), per_client as (
    select cid,
           sum(minutes)::bigint as mins,
           sum(case when est and use_rate is not null then minutes else 0 end)::bigint as est_mins,
           sum(case when use_rate is null then minutes else 0 end)::bigint as unc_mins,
           sum(minutes / 60.0 * use_rate) as ccost,
           sum(case when est then minutes / 60.0 * use_rate else 0 end) as est_cost
    from ec
    group by cid
  ), staff_json as (
    select ps.cid,
           jsonb_agg(jsonb_build_object(
             'staff_email', ps.sem,
             'staff_name', coalesce(s.name, ps.pname, ps.sem),
             'minutes', ps.mins,
             'cost', round(ps.scost, 2),
             'estimated', ps.sest
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
         coalesce(sj.j, '[]'::jsonb)
  from base b
  left join per_client pc on pc.cid = b.cid
  left join staff_json sj on sj.cid = b.cid
  order by 13 asc nulls last, 2;
end;
$$;

revoke all on function public.client_profitability(date, date, jsonb) from public, anon;
grant execute on function public.client_profitability(date, date, jsonb) to authenticated;

commit;
