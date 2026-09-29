-- Weekly admin digest email (owner request 2026-09-29).
--
-- Applied to production 2026-09-29 as migration weekly_admin_digest.
-- Safe to re-run (if not exists / create or replace / drop policy if exists /
-- unschedule-if-exists), wrapped in one transaction.
--
-- Companion code:
--   supabase/functions/weekly-admin-digest/index.ts   builds + sends the email
--   supabase/functions/_shared/email.ts               Resend helper (reusable)
--   supabase/functions/qbo-firm-sync/index.ts         now also pulls the firm's
--                                                     open invoices (late payers)
--   components/staff/DigestSettings.jsx               admin settings card
--
-- Pieces:
--   digest_settings      singleton: recipients, enabled, send day/hour/timezone.
--                        Admin read/update only.
--   digest_runs          one row per run (cron, manual send, preview). Admin read.
--   qbo_firm_invoices    the firm's OPEN invoices (Balance > 0), replaced on each
--                        qbo-firm-sync run by qbo_firm_replace_invoices().
--   digest_weekly_data() every number in the email, as one jsonb. service_role
--                        only (the edge function calls it after its own auth
--                        check), so it can read the admin-only tables without a
--                        user JWT. It reimplements the client_profitability /
--                        qbo_hours_by_client logic rather than calling those
--                        RPCs, which require an admin JWT.
--   digest_cron_tick()   run hourly by pg_cron. cron runs in UTC and pg_cron
--                        can't follow America/New_York's DST shift, so instead
--                        of a fixed UTC time the tick checks, every hour,
--                        whether it is now send_dow/send_hour in the settings'
--                        timezone and no cron digest went out in the last 20
--                        hours. Only then does it POST to the function (pg_net,
--                        Vault qbo_cron_key bearer, same as qbo-firm-sync).
--
-- Every client section excludes clients.test_only = true.

begin;

-- ============================================================================
-- Settings (singleton)
-- ============================================================================
create table if not exists public.digest_settings (
  id boolean primary key default true check (id),
  recipients text[] not null default array['admin@mygoodbooks.org'],
  enabled boolean not null default true,
  send_dow smallint not null default 1 check (send_dow between 0 and 6),  -- 0 = Sunday, 1 = Monday
  send_hour smallint not null default 7 check (send_hour between 0 and 23),
  timezone text not null default 'America/New_York',
  updated_by text,
  updated_at timestamptz not null default now(),
  check (cardinality(recipients) <= 20)
);
insert into public.digest_settings (id) values (true) on conflict (id) do nothing;
alter table public.digest_settings enable row level security;
revoke all on public.digest_settings from anon;
revoke insert, delete, truncate on public.digest_settings from authenticated;
grant select, update on public.digest_settings to authenticated;

drop policy if exists "admins read digest settings" on public.digest_settings;
create policy "admins read digest settings" on public.digest_settings
  for select to authenticated using ((select public.is_active_staff_admin()));
drop policy if exists "admins update digest settings" on public.digest_settings;
create policy "admins update digest settings" on public.digest_settings
  for update to authenticated
  using ((select public.is_active_staff_admin()))
  with check ((select public.is_active_staff_admin()));

-- Reject a bad timezone name or recipient at write time, not at 7am Monday.
create or replace function public.digest_settings_validate()
returns trigger
language plpgsql
set search_path = public
as $$
declare r text;
begin
  perform now() at time zone new.timezone;  -- raises on an unknown zone
  foreach r in array coalesce(new.recipients, '{}') loop
    if r !~* '^[^@\s,;<>]+@[^@\s,;<>]+\.[a-z]{2,}$' then
      raise exception 'invalid recipient email: %', r;
    end if;
  end loop;
  new.recipients := array(select distinct lower(btrim(x)) from unnest(new.recipients) x);
  new.updated_at := now();
  new.updated_by := coalesce(auth.jwt() ->> 'email', new.updated_by);
  return new;
end;
$$;
drop trigger if exists digest_settings_validate on public.digest_settings;
create trigger digest_settings_validate
  before insert or update on public.digest_settings
  for each row execute function public.digest_settings_validate();

-- ============================================================================
-- Run log
-- ============================================================================
create table if not exists public.digest_runs (
  id bigserial primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  trigger text not null check (trigger in ('cron', 'manual', 'preview')),
  status text not null
    check (status in ('sent', 'preview', 'not_configured', 'disabled', 'error')),
  requested_by text,
  recipients text[],
  week_start date,
  week_end date,
  provider_id text,               -- Resend message id
  detail text,
  summary jsonb
);
create index if not exists digest_runs_started_idx on public.digest_runs (started_at desc);
alter table public.digest_runs enable row level security;
revoke all on public.digest_runs from anon;
revoke insert, update, delete, truncate on public.digest_runs from authenticated;
grant select on public.digest_runs to authenticated;
drop policy if exists "admins read digest runs" on public.digest_runs;
create policy "admins read digest runs" on public.digest_runs
  for select to authenticated using ((select public.is_active_staff_admin()));

-- ============================================================================
-- Firm open invoices (written by qbo-firm-sync)
-- ============================================================================
create table if not exists public.qbo_firm_invoices (
  realm_id text not null,
  qbo_id text not null,
  customer_qbo_id text,
  customer_name text,
  doc_number text,
  txn_date date,
  due_date date,
  total_amt numeric(14, 2),
  balance numeric(14, 2),
  synced_at timestamptz not null default now(),
  primary key (realm_id, qbo_id)
);
create index if not exists qbo_firm_invoices_due_idx on public.qbo_firm_invoices (due_date);
alter table public.qbo_firm_invoices enable row level security;
revoke all on public.qbo_firm_invoices from anon;
revoke insert, update, delete, truncate on public.qbo_firm_invoices from authenticated;
grant select on public.qbo_firm_invoices to authenticated;
drop policy if exists "admins read firm invoices" on public.qbo_firm_invoices;
create policy "admins read firm invoices" on public.qbo_firm_invoices
  for select to authenticated using ((select public.is_active_staff_admin()));

-- Whole-set replace for one realm (open invoices only, so the set is small and
-- a paid invoice simply disappears). Also drops rows from any other realm, so
-- a reconnect to a different company never leaves stale invoices behind.
create or replace function public.qbo_firm_replace_invoices(p_realm_id text, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
  rows_in jsonb := coalesce(p_rows, '[]'::jsonb);
begin
  if p_realm_id is null or jsonb_typeof(rows_in) <> 'array' then
    raise exception 'qbo_firm_replace_invoices: bad arguments';
  end if;
  delete from qbo_firm_invoices where true;
  insert into qbo_firm_invoices (
    realm_id, qbo_id, customer_qbo_id, customer_name, doc_number, txn_date,
    due_date, total_amt, balance, synced_at)
  select distinct on (r.qbo_id)
         p_realm_id, r.qbo_id, r.customer_qbo_id, r.customer_name, r.doc_number,
         r.txn_date, r.due_date, r.total_amt, r.balance, now()
  from jsonb_to_recordset(rows_in) as r(
    qbo_id text, customer_qbo_id text, customer_name text, doc_number text,
    txn_date date, due_date date, total_amt numeric, balance numeric)
  where r.qbo_id is not null
  order by r.qbo_id;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.qbo_firm_replace_invoices(text, jsonb) from public, anon, authenticated;
grant execute on function public.qbo_firm_replace_invoices(text, jsonb) to service_role;

-- ============================================================================
-- All digest numbers for one week (Monday p_week_start .. Sunday +6).
-- p_today is "today" in the digest timezone (overdue / stale cut-offs).
-- ============================================================================
create or replace function public.digest_weekly_data(p_week_start date, p_today date)
returns jsonb
language plpgsql
volatile   -- fills per-call temp tables
security definer
set search_path = public
as $$
declare
  ws date := p_week_start;
  we date := p_week_start + 6;
  w4_from date := p_week_start - 21;            -- last 4 weeks = w4_from .. we
  base_from date := p_week_start - 21 - 91;     -- 13 weeks before that
  base_to date := p_week_start - 22;
  pr_from date := we - 89;                      -- price review: trailing 90 days
  pr_months numeric := 90 / 30.44;
  v_target numeric;
  v_avg_rate numeric;
  v_firm record;
  v_caps jsonb := '{}'::jsonb;
  v_has_caps boolean := false;
  v_out jsonb := '{}'::jsonb;
begin
  if p_week_start is null or p_today is null then
    raise exception 'digest_weekly_data: bad arguments';
  end if;

  select * into v_firm from qbo_firm_connection where id = true;
  select coalesce(target_margin_pct, 40) into v_target from profitability_settings where id = true;
  v_target := coalesce(v_target, 40);
  select avg(r.hourly_cost) into v_avg_rate from (
    select distinct on (staff_email) hourly_cost from staff_cost_rates
    where effective_from <= we order by staff_email, effective_from desc) r;

  -- staff_capacity is optional (created separately). Read it dynamically so
  -- this function compiles and runs whether or not it exists yet.
  if to_regclass('public.staff_capacity') is not null then
    begin
      execute 'select coalesce(jsonb_object_agg(lower(staff_email), weekly_target_hours), ''{}''::jsonb)
               from public.staff_capacity where weekly_target_hours is not null'
        into v_caps;
      v_has_caps := true;
    exception when others then
      v_caps := '{}'::jsonb;
    end;
  end if;

  v_out := jsonb_build_object(
    'week_start', ws, 'week_end', we, 'today', p_today,
    'target_margin_pct', v_target,
    'firm_qbo', jsonb_build_object(
      'status', coalesce(v_firm.status, 'disconnected'),
      'company_name', v_firm.company_name,
      'last_synced_at', v_firm.last_synced_at,
      'last_error', v_firm.last_error),
    'has_capacity_table', v_has_caps
  );

  -- Shared: QuickBooks minutes per real client per day, since base_from.
  create temp table if not exists _dg_client_time (client_id text, txn_date date, minutes int) on commit drop;
  truncate _dg_client_time;
  insert into _dg_client_time
  select r.client_id, a.txn_date, a.minutes
  from qbo_time_activities a
  join qbo_customer_resolution r
    on r.realm_id = a.realm_id and r.qbo_customer_id = a.customer_qbo_id
  join clients c on c.id = r.client_id and coalesce(c.test_only, false) = false
  where a.txn_date >= least(base_from, pr_from, p_today - 30);

  -- 1. Scope creep --------------------------------------------------------
  v_out := v_out || jsonb_build_object('scope_creep', coalesce((
    select jsonb_agg(x order by x.ratio desc) from (
      select c.id as client_id, c.name as client_name,
             round(coalesce(s.week_min, 0) / 60.0, 1) as week_hours,
             round(s.base_min / 13.0 / 60.0, 1) as base_week_hours,
             round(coalesce(s.w4_min, 0) * 30.44 / 28 / 60.0, 1) as pace_month_hours,
             round(s.base_min * 30.44 / 91 / 60.0, 1) as base_month_hours,
             (coalesce(s.week_min, 0) >= s.base_min / 13.0 * 1.5 and coalesce(s.week_min, 0) - s.base_min / 13.0 >= 120) as week_flag,
             (coalesce(s.w4_min, 0) * 30.44 / 28 >= s.base_min * 30.44 / 91 * 1.5
               and coalesce(s.w4_min, 0) * 30.44 / 28 - s.base_min * 30.44 / 91 >= 120) as month_flag,
             round(greatest(coalesce(s.week_min, 0) / (s.base_min / 13.0),
                            (coalesce(s.w4_min, 0) / 28.0) / (s.base_min / 91.0)), 2) as ratio
      from (
        select client_id,
               sum(minutes) filter (where txn_date between ws and we) as week_min,
               sum(minutes) filter (where txn_date between w4_from and we) as w4_min,
               sum(minutes) filter (where txn_date between base_from and base_to) as base_min
        from _dg_client_time group by client_id
      ) s
      join clients c on c.id = s.client_id
      where s.base_min > 0
        and ((coalesce(s.week_min, 0) >= s.base_min / 13.0 * 1.5 and coalesce(s.week_min, 0) - s.base_min / 13.0 >= 120)
          or (coalesce(s.w4_min, 0) * 30.44 / 28 >= s.base_min * 30.44 / 91 * 1.5
              and coalesce(s.w4_min, 0) * 30.44 / 28 - s.base_min * 30.44 / 91 >= 120))
    ) x), '[]'::jsonb));

  -- 2. Price review (clients with a client_fees row only) ------------------
  v_out := v_out || jsonb_build_object('price_review', coalesce((
    select jsonb_agg(x order by x.margin_pct asc) from (
      select c.id as client_id, c.name as client_name, f.monthly_fee,
             round(k.cost / pr_months, 2) as monthly_cost,
             round(k.minutes / 60.0 / pr_months, 1) as monthly_hours,
             round((f.monthly_fee * pr_months - k.cost) / nullif(f.monthly_fee * pr_months, 0) * 100, 1) as margin_pct,
             round(k.cost / pr_months / (1 - v_target / 100.0), 0) as suggested_fee,
             k.estimated
      from client_fees f
      join clients c on c.id = f.client_id and coalesce(c.test_only, false) = false
      join lateral (
        select sum(a.minutes) as minutes,
               sum(a.minutes / 60.0 * coalesce(
                 (select sc.hourly_cost from staff_cost_rates sc
                   where sc.staff_email = lower(p.staff_email) and sc.effective_from <= a.txn_date
                   order by sc.effective_from desc limit 1), v_avg_rate)) as cost,
               bool_or(p.staff_email is null or not exists (
                 select 1 from staff_cost_rates sc
                  where sc.staff_email = lower(p.staff_email) and sc.effective_from <= a.txn_date)) as estimated
        from qbo_time_activities a
        join qbo_customer_resolution r
          on r.realm_id = a.realm_id and r.qbo_customer_id = a.customer_qbo_id
        left join qbo_employee_staff_map p
          on p.realm_id = a.realm_id
         and p.qbo_entity_type = case when a.employee_qbo_id is not null then 'Employee' else 'Vendor' end
         and p.qbo_id = coalesce(a.employee_qbo_id, a.vendor_qbo_id)
        where r.client_id = c.id and a.txn_date between pr_from and we
      ) k on k.cost is not null and k.minutes > 0
      where v_target < 100
        and f.monthly_fee * pr_months > 0
        and (f.monthly_fee * pr_months - k.cost) / (f.monthly_fee * pr_months) * 100 < v_target
    ) x), '[]'::jsonb),
    'price_review_no_fee_count', (
      select count(*) from clients c
      where coalesce(c.test_only, false) = false
        and not exists (select 1 from client_fees f where f.client_id = c.id)),
    'price_review_has_rates', exists (select 1 from staff_cost_rates));

  -- 3. Revenue snapshot ---------------------------------------------------
  -- clients has created_at but no archived/deleted marker, so removals can't
  -- be detected; the email says so.
  v_out := v_out || jsonb_build_object('revenue', (
    select jsonb_build_object(
      'mrr', coalesce(sum(f.monthly_fee), 0),
      'active_clients', count(*),
      'clients_with_fee', count(f.client_id),
      'projection_3m', coalesce(sum(f.monthly_fee), 0) * 3,
      'added', coalesce(jsonb_agg(jsonb_build_object('client_id', c.id, 'client_name', c.name,
                                                     'created_at', c.created_at))
                        filter (where c.created_at >= now() - interval '7 days'), '[]'::jsonb))
    from clients c
    left join client_fees f on f.client_id = c.id
    where coalesce(c.test_only, false) = false));

  -- 4. Late payers ----------------------------------------------------------
  v_out := v_out || jsonb_build_object('late_payers', coalesce((
    select jsonb_agg(x order by x.days_overdue desc, x.balance desc) from (
      select i.doc_number, i.customer_name, i.txn_date, i.due_date, i.total_amt, i.balance,
             (p_today - i.due_date) as days_overdue,
             r.client_id, c.name as client_name
      from qbo_firm_invoices i
      left join qbo_customer_resolution r
        on r.realm_id = i.realm_id and r.qbo_customer_id = i.customer_qbo_id
      left join clients c on c.id = r.client_id
      where i.balance > 0 and i.due_date < p_today
        and coalesce(c.test_only, false) = false
        and not coalesce(r.ignored, false)
    ) x), '[]'::jsonb),
    'open_invoice_count', (select count(*) from qbo_firm_invoices where balance > 0),
    'invoices_synced_at', (select max(synced_at) from qbo_firm_invoices));

  -- Shared per-staff per-day tables for sections 5 and 6.
  create temp table if not exists _dg_staff_qbo (email text, d date, minutes int) on commit drop;
  truncate _dg_staff_qbo;
  insert into _dg_staff_qbo
  select lower(p.staff_email), a.txn_date, sum(a.minutes)
  from qbo_time_activities a
  join qbo_employee_staff_map p
    on p.realm_id = a.realm_id
   and p.qbo_entity_type = case when a.employee_qbo_id is not null then 'Employee' else 'Vendor' end
   and p.qbo_id = coalesce(a.employee_qbo_id, a.vendor_qbo_id)
  where a.txn_date between ws and we and p.staff_email is not null
  group by 1, 2;

  create temp table if not exists _dg_staff_app (email text, d date, seconds int) on commit drop;
  truncate _dg_staff_app;
  insert into _dg_staff_app
  select lower(staff_email), day, sum(seconds)
  from staff_app_time where day between ws and we
  group by 1, 2;

  -- 5. Timesheet gaps (active staff) --------------------------------------
  v_out := v_out || jsonb_build_object('timesheet_gaps', coalesce((
    select jsonb_agg(x order by x.staff_name) from (
      select s.email as staff_email, coalesce(s.name, s.email) as staff_name,
             coalesce((select jsonb_agg(d.d::date order by d.d)
                       from generate_series(ws, ws + 4, interval '1 day') d(d)
                       where not exists (select 1 from _dg_staff_qbo q
                                         where q.email = lower(s.email) and q.d = d.d::date and q.minutes > 0)),
                      '[]'::jsonb) as no_qbo_weekdays,
             coalesce((select jsonb_agg(jsonb_build_object('day', a.d, 'app_minutes', round(a.seconds / 60.0)) order by a.d)
                       from _dg_staff_app a
                       where a.email = lower(s.email) and a.seconds >= 300
                         and not exists (select 1 from _dg_staff_qbo q
                                         where q.email = a.email and q.d = a.d and q.minutes > 0)),
                      '[]'::jsonb) as app_without_qbo
      from staff s
      where s.active
    ) x
    where jsonb_array_length(x.no_qbo_weekdays) > 0 or jsonb_array_length(x.app_without_qbo) > 0
  ), '[]'::jsonb));

  -- 6. Staff scorecard ------------------------------------------------------
  v_out := v_out || jsonb_build_object('scorecard', coalesce((
    select jsonb_agg(x order by x.staff_name) from (
      select s.email as staff_email, coalesce(s.name, s.email) as staff_name, s.role,
             round(coalesce((select sum(minutes) from _dg_staff_qbo q where q.email = lower(s.email)), 0) / 60.0, 1) as qbo_hours,
             coalesce((v_caps ->> lower(s.email))::numeric, 35) as target_hours,
             (v_caps ? lower(s.email)) as target_set,
             round(coalesce((select sum(seconds) from _dg_staff_app a where a.email = lower(s.email)), 0) / 3600.0, 1) as app_hours,
             (select count(*) from staff_reminders t
               where lower(coalesce(t.assignee_email, t.staff_email)) = lower(s.email)
                 and t.done and (t.completed_at at time zone 'America/New_York')::date between ws and we) as tasks_done,
             (select count(*) from staff_reminders t
               where lower(coalesce(t.assignee_email, t.staff_email)) = lower(s.email)
                 and not t.done) as tasks_open,
             (select count(*) from staff_reminders t
               where lower(coalesce(t.assignee_email, t.staff_email)) = lower(s.email)
                 and not t.done
                 and coalesce(t.due_date, (t.due_at at time zone 'America/New_York')::date) < p_today) as tasks_overdue
      from staff s
      where s.active
    ) x), '[]'::jsonb));

  -- 7. Stale clients --------------------------------------------------------
  v_out := v_out || jsonb_build_object('stale_clients', coalesce((
    select jsonb_agg(x order by x.client_name) from (
      select c.id as client_id, c.name as client_name,
             (select max(day) from staff_app_time a where a.client_id = c.id) as last_app_day,
             (select max(txn_date) from _dg_client_time t where t.client_id = c.id) as last_qbo_day
      from clients c
      where coalesce(c.test_only, false) = false
        and not exists (select 1 from staff_app_time a where a.client_id = c.id and a.day >= p_today - 30 and a.seconds > 0)
        and not exists (select 1 from _dg_client_time t where t.client_id = c.id and t.txn_date >= p_today - 30 and t.minutes > 0)
    ) x), '[]'::jsonb),
    'qbo_errors', coalesce((
      select jsonb_agg(jsonb_build_object('client_id', c.id, 'client_name', c.name,
                                          'last_error', q.last_error, 'last_synced_at', q.last_synced_at)
                       order by c.name)
      from qbo_connections q
      join clients c on c.id = q.client_id and coalesce(c.test_only, false) = false
      where q.status = 'error'), '[]'::jsonb));

  -- 8. Pending --------------------------------------------------------------
  v_out := v_out || jsonb_build_object('pending', jsonb_build_object(
    'access_requests', coalesce((
      select jsonb_agg(jsonb_build_object('staff_name', coalesce(g.staff_name, g.staff_email),
                                          'client_name', c.name, 'requested_at', g.requested_at,
                                          'reason', left(g.reason, 140))
                       order by g.requested_at)
      from staff_client_access_grants g
      join clients c on c.id = g.client_id and coalesce(c.test_only, false) = false
      where g.status = 'pending'), '[]'::jsonb),
    -- Same definitions as qbo_firm_status().
    'unmapped_customers', (
      select count(distinct (r.realm_id, r.qbo_customer_id))
      from qbo_customer_resolution r
      join qbo_time_activities t on t.realm_id = r.realm_id and t.customer_qbo_id = r.qbo_customer_id
      where r.client_id is null and not r.ignored),
    'unmapped_people', (
      select count(*) from qbo_employee_staff_map p
      where p.staff_email is null and not p.ignored
        and exists (
          select 1 from qbo_time_activities t
          where t.realm_id = p.realm_id
            and coalesce(t.employee_qbo_id, t.vendor_qbo_id) = p.qbo_id
            and p.qbo_entity_type = case when t.employee_qbo_id is not null then 'Employee' else 'Vendor' end))
  ));

  return v_out;
end;
$$;
revoke all on function public.digest_weekly_data(date, date) from public, anon, authenticated;
grant execute on function public.digest_weekly_data(date, date) to service_role;

-- ============================================================================
-- Hourly cron tick (DST-safe local send time)
-- ============================================================================
create or replace function public.digest_cron_tick()
returns bigint
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  s record;
  v_local timestamp;
  v_id bigint;
begin
  select * into s from digest_settings where id = true;
  if not found or not s.enabled then return null; end if;
  v_local := now() at time zone s.timezone;
  if extract(dow from v_local) <> s.send_dow or extract(hour from v_local) <> s.send_hour then
    return null;
  end if;
  if exists (select 1 from digest_runs
             where trigger = 'cron' and started_at > now() - interval '20 hours') then
    return null;
  end if;
  select net.http_post(
    url := 'https://xumsqmhccgfjnlmieqyu.supabase.co/functions/v1/weekly-admin-digest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'qbo_cron_key' limit 1
      )
    ),
    body := '{"trigger":"cron"}'::jsonb,
    timeout_milliseconds := 120000
  ) into v_id;
  return v_id;
end;
$$;
revoke all on function public.digest_cron_tick() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'weekly-admin-digest') then
    perform cron.unschedule('weekly-admin-digest');
  end if;
end
$$;

select cron.schedule('weekly-admin-digest', '2 * * * *', $cron$ select public.digest_cron_tick(); $cron$);

commit;

-- Checks after applying:
--   select * from digest_settings;
--   select * from cron.job where jobname = 'weekly-admin-digest';
--   select * from digest_runs order by started_at desc limit 10;
-- To remove the schedule:  select cron.unschedule('weekly-admin-digest');
