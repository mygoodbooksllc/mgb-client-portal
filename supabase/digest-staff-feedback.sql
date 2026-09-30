-- Weekly admin digest: Staff feedback section (owner request 2026-09-30).
-- Applied to production 2026-09-30 as migration digest_staff_feedback.
--
-- Re-creates digest_weekly_data() (supabase/weekly-digest.sql, where the same
-- change was made in place) with one new key, staff_feedback:
--   new_total     count of staff_feedback rows with status 'new'
--   new_by_kind   {"bug": n, "idea": n, ...} for those 'new' rows
--   last_7_days   rows created in the last 7 days (any status)
--   newest        up to 5 newest 'new' rows: kind, author email + staff name,
--                 page, created_at, message (whitespace collapsed, 200 chars;
--                 the edge function trims to ~120 and escapes)
-- The rest of the function is unchanged. Safe to re-run.

begin;

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

  -- 9. Staff feedback (staff_feedback, supabase/staff-feedback.sql) ----------
  -- Added 2026-09-30 (migration digest_staff_feedback). Open 'new' reports by
  -- kind, how many arrived in the last 7 days, and the 5 newest 'new' ones.
  v_out := v_out || jsonb_build_object('staff_feedback', jsonb_build_object(
    'new_total', (select count(*) from staff_feedback where status = 'new'),
    'new_by_kind', coalesce((
      select jsonb_object_agg(k.kind, k.n)
      from (select kind, count(*) as n from staff_feedback where status = 'new' group by kind) k), '{}'::jsonb),
    'last_7_days', (select count(*) from staff_feedback where created_at >= now() - interval '7 days'),
    'newest', coalesce((
      select jsonb_agg(x order by x.created_at desc) from (
        select f.id, f.kind, f.author_email, s.name as author_name, f.created_at, f.page,
               left(regexp_replace(btrim(f.message), '\s+', ' ', 'g'), 200) as message
        from staff_feedback f
        left join lateral (
          select st.name from staff st where lower(st.email) = lower(f.author_email) limit 1) s on true
        where f.status = 'new'
        order by f.created_at desc
        limit 5
      ) x), '[]'::jsonb)
  ));

  return v_out;
end;
$$;
revoke all on function public.digest_weekly_data(date, date) from public, anon, authenticated;
grant execute on function public.digest_weekly_data(date, date) to service_role;

commit;
