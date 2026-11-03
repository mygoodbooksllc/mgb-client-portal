-- Lost clients: a reversible "no longer a client" date (owner approved
-- 2026-11-03; first use: Citymark Church, let go 2026-10-30).
-- Applied to production 2026-11-03 (Supabase MCP apply_migration, name lost_clients).
--
-- 1. clients.lost_at date, nullable. Empty = a current client (every read
--    behaves exactly as before). A date = the first day they are no longer a
--    client: lost once lost_at <= today. Clearing it undoes everything; no
--    row, history, task, file, QuickBooks mapping or login is touched.
--    Who can set it: the existing clients policies (an active admin updates;
--    staff and the client only read). No reason column on purpose: the client
--    can read their own clients row, so a reason would leak to them. The
--    audit log records who and when (client.lost_set / client.lost_cleared).
--    lost_at never blocks sign-in or portal access: no policy, can_access_client
--    or client_users rule reads it.
-- 2. public.is_current_client(c clients): is_roster_client(c) and not lost
--    today. is_roster_client is unchanged on purpose: firm hours, staff cost,
--    Team › Hours, staff performance and usage stats keep a lost client's
--    time, so pay cost always reconciles.
-- 3. Reads that list CURRENT clients skip lost ones:
--      client_health (Health board), digest_weekly_data (price review, no-fee
--      count, revenue / active clients, stale clients, QuickBooks errors,
--      pending access requests; scope creep, late payers and tasks keep them),
--      digest_fee_suggestions, coverage_overview (time-off coverage),
--      op__anniversaries (gifts), tk__generate (no new recurring tasks),
--      tk_nudge_plan (no client reminder emails).
-- 4. Ranged money reads keep a lost client for the part of the range before
--    lost_at:
--      client_profitability: a client lost on or before p_from is listed only
--        when it has time in the range (revenue 0, so the time still shows as
--        cost); otherwise months and revenue are prorated to the days before
--        lost_at (same day-count rule as v_months). Same signature and columns.
--      capacity_inputs: clients[] gain lost_at; MH_capacity.js prorates the fee
--        revenue. Person-month minutes and pay cost are unchanged (all time).
-- 5. Citymark Church (id citymark-church): lost_at = 2026-10-30.
--
-- Safe to re-run (anchor patches skip when already applied). Tests:
-- supabase/mgb-home-tests.sql, section LOST (rolls back).

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
-- 1. The column
-- ---------------------------------------------------------------------------
alter table public.clients add column if not exists lost_at date;
comment on column public.clients.lost_at is
  'Lost clients: first day this org is no longer a client (lost once lost_at <= today). Null = current. Admin-set, audited, reversible; never blocks sign-in.';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'clients_lost_at_sane') then
    alter table public.clients add constraint clients_lost_at_sane
      check (lost_at is null or lost_at >= date '2000-01-01');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Helper
-- ---------------------------------------------------------------------------
create or replace function public.is_current_client(c public.clients)
returns boolean
language sql
stable
set search_path = public
as $$
  select public.is_roster_client(c) and (c.lost_at is null or c.lost_at > current_date);
$$;
comment on function public.is_current_client(public.clients) is
  'Lost clients: a real client (is_roster_client) that is not lost today. Hours and cost keep using is_roster_client.';
grant execute on function public.is_current_client(public.clients) to authenticated, service_role;

-- Audit: lost_at set / changed / cleared (the clients branch of audit_row_change).
select pg_temp.mh_patch_fn('public.audit_row_change()',
  $a$      if (o ->> 'org_type') is distinct from (n ->> 'org_type')$a$,
  $a$      if (o ->> 'lost_at') is distinct from (n ->> 'lost_at') then
        perform audit_write(case when n ->> 'lost_at' is null then 'client.lost_cleared' else 'client.lost_set' end,
          n ->> 'id', 'client', n ->> 'id',
          jsonb_build_object('name', n ->> 'name', 'from', o -> 'lost_at', 'to', n -> 'lost_at'));
      end if;
      if (o ->> 'org_type') is distinct from (n ->> 'org_type')$a$,
  $a$'client.lost_set'$a$, 1);

-- ---------------------------------------------------------------------------
-- 3. Current-client reads
-- ---------------------------------------------------------------------------
select pg_temp.mh_patch_fn('public.client_health(jsonb)',
  $a$select cl.id from clients cl where public.can_access_client(cl.id) and not cl.is_internal$a$,
  $a$select cl.id from clients cl where public.can_access_client(cl.id) and not cl.is_internal and (cl.lost_at is null or cl.lost_at > current_date) /* lost */$a$,
  '/* lost */', 1);

select pg_temp.mh_patch_fn('public.digest_weekly_data(date,date)',
  $a$join clients c on c.id = f.client_id and public.is_roster_client(c)$a$,
  $a$join clients c on c.id = f.client_id and public.is_current_client(c) /* lost:price_review */$a$,
  '/* lost:price_review */', 1);
select pg_temp.mh_patch_fn('public.digest_weekly_data(date,date)',
  E'where public.is_roster_client(c)\n        and not exists (select 1 from client_fees f where f.client_id = c.id)',
  E'where public.is_current_client(c) /* lost:no_fee */\n        and not exists (select 1 from client_fees f where f.client_id = c.id)',
  '/* lost:no_fee */', 1);
select pg_temp.mh_patch_fn('public.digest_weekly_data(date,date)',
  $a$where public.is_roster_client(c)));$a$,
  $a$where public.is_current_client(c) /* lost:revenue */));$a$,
  '/* lost:revenue */', 1);
select pg_temp.mh_patch_fn('public.digest_weekly_data(date,date)',
  E'where public.is_roster_client(c)\n        and not exists (select 1 from staff_app_time a',
  E'where public.is_current_client(c) /* lost:stale */\n        and not exists (select 1 from staff_app_time a',
  '/* lost:stale */', 1);
select pg_temp.mh_patch_fn('public.digest_weekly_data(date,date)',
  $a$join clients c on c.id = q.client_id and public.is_roster_client(c)$a$,
  $a$join clients c on c.id = q.client_id and public.is_current_client(c) /* lost:qbo_errors */$a$,
  '/* lost:qbo_errors */', 1);
select pg_temp.mh_patch_fn('public.digest_weekly_data(date,date)',
  $a$join clients c on c.id = g.client_id and public.is_roster_client(c)$a$,
  $a$join clients c on c.id = g.client_id and public.is_current_client(c) /* lost:access */$a$,
  '/* lost:access */', 1);

select pg_temp.mh_patch_fn('public.digest_fee_suggestions(boolean)',
  $a$where (p_include_test or public.is_roster_client(c)) and not c.is_internal$a$,
  $a$where (p_include_test or public.is_roster_client(c)) and not c.is_internal and (c.lost_at is null or c.lost_at > current_date) /* lost */$a$,
  '/* lost */', 1);

select pg_temp.mh_patch_fn('public.coverage_overview(date,date)',
  $a$join (select cc.* from clients cc where public.is_roster_client(cc)) c$a$,
  $a$join (select cc.* from clients cc where public.is_current_client(cc) /* lost */) c$a$,
  '/* lost */', 1);

select pg_temp.mh_patch_fn('public.op__anniversaries(date,integer)',
  $a$where not coalesce(c.test_only, false) and not coalesce(c.is_internal, false)$a$,
  $a$where not coalesce(c.test_only, false) and not coalesce(c.is_internal, false) and (c.lost_at is null or c.lost_at > current_date) /* lost */$a$,
  '/* lost */', 2);

select pg_temp.mh_patch_fn('public.tk__generate(date,boolean,text,integer,text,uuid)',
  $a$where (case when p_client_id is not null then cl.id = p_client_id else public.is_roster_client(cl) end)$a$,
  $a$where (case when p_client_id is not null then cl.id = p_client_id else public.is_roster_client(cl) end)
         and (cl.lost_at is null or cl.lost_at > v_today) /* lost */$a$,
  '/* lost */', 1);

select pg_temp.mh_patch_fn('public.tk_nudge_plan()',
  $a$and r.nudge_count < v_max and not coalesce(c.test_only, false) and not coalesce(c.is_internal, false)$a$,
  $a$and r.nudge_count < v_max and not coalesce(c.test_only, false) and not coalesce(c.is_internal, false)
             and (c.lost_at is null or c.lost_at > v_today) /* lost */$a$,
  '/* lost */', 1);

-- ---------------------------------------------------------------------------
-- 4. Ranged money reads
-- ---------------------------------------------------------------------------
-- capacity_inputs: lost_at on each client (JS prorates the fee revenue).
select pg_temp.mh_patch_fn('public.capacity_inputs(date,date,text,jsonb)',
  $a$exists (select 1 from cc where cc.client_id = c.id) as contract$a$,
  $a$exists (select 1 from cc where cc.client_id = c.id) as contract, c.lost_at as lost_at$a$,
  'c.lost_at as lost_at', 1);
select pg_temp.mh_patch_fn('public.capacity_inputs(date,date,text,jsonb)',
  $a$'fee_source', cl.src, 'contract', cl.contract)$a$,
  $a$'fee_source', cl.src, 'contract', cl.contract, 'lost_at', cl.lost_at)$a$,
  $a$'lost_at', cl.lost_at$a$, 1);

-- client_profitability: same signature and columns; lost clients prorated.
create or replace function public.client_profitability(p_from date, p_to date, p_default_fees jsonb DEFAULT '{}'::jsonb, p_basis text DEFAULT 'staff'::text)
 RETURNS TABLE(client_id text, client_name text, monthly_fee numeric, fee_source text, months numeric, revenue numeric, total_minutes bigint, estimated_minutes bigint, uncosted_minutes bigint, cost numeric, estimated_cost numeric, profit numeric, margin_pct numeric, avg_rate numeric, staff_costs jsonb, former_minutes bigint, former_cost numeric, basis text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
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
  ), base0 as (
    select c.id as cid,
           c.name as cname,
           c.lost_at as lost,
           case when f.client_id is not null then f.monthly_fee
                when p_default_fees ? c.id and jsonb_typeof(p_default_fees -> c.id) = 'number'
                  then (p_default_fees ->> c.id)::numeric end as fee,
           case when f.client_id is not null then 'actual'
                when p_default_fees ? c.id and jsonb_typeof(p_default_fees -> c.id) = 'number'
                  then 'tier_default' end as src
    from clients c
    left join client_fees f on f.client_id = c.id
    where public.is_roster_client(c)
      -- Lost clients: listed while they were a client for part of the range,
      -- or when time was logged on them in it (so that time still shows).
      and (c.lost_at is null or c.lost_at > p_from
           or exists (select 1 from per_client pc0 where pc0.cid = c.id))
  ), base as (
    select b0.cid, b0.cname, b0.fee, b0.src,
           case when b0.lost is null or b0.lost > p_to then v_months
                when b0.lost <= p_from then 0::numeric
                else (select coalesce(sum(
                        (least(b0.lost - 1, (m + interval '1 month - 1 day')::date) - greatest(p_from, m::date) + 1)::numeric
                        / extract(day from (m + interval '1 month - 1 day'))::numeric
                      ), 0)
                        from generate_series(date_trunc('month', p_from), date_trunc('month', b0.lost - 1), interval '1 month') as m)
           end as bm
    from base0 b0
  )
  select b.cid,
         b.cname,
         b.fee,
         b.src,
         round(b.bm, 4),
         round(b.fee * b.bm, 2),
         coalesce(pc.mins, 0),
         coalesce(pc.est_mins, 0),
         coalesce(pc.unc_mins, 0),
         case when coalesce(pc.mins, 0) = 0 then 0::numeric
              when pc.ccost is null then null
              else round(pc.ccost, 2) end,
         round(coalesce(pc.est_cost, 0), 2),
         case when b.fee is null then null
              when coalesce(pc.mins, 0) = 0 then round(b.fee * b.bm, 2)
              when pc.ccost is null then null
              else round(b.fee * b.bm - pc.ccost, 2) end,
         case when b.fee is null or b.fee * b.bm = 0 then null
              when coalesce(pc.mins, 0) = 0 then 100::numeric
              when pc.ccost is null then null
              else round((b.fee * b.bm - pc.ccost) / (b.fee * b.bm) * 100, 1) end,
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

-- ---------------------------------------------------------------------------
-- 5. Citymark Church
-- ---------------------------------------------------------------------------
update public.clients set lost_at = date '2026-10-30'
 where id = 'citymark-church' and lost_at is null;
