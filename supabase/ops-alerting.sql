-- Error alerting + fee-change suggestions (owner request 2026-10-06).
--
-- Applied to production 2026-10-06 as migration ops_alerting.
-- Safe to re-run (create or replace / if not exists / unschedule-if-exists).
--
-- Companion code:
--   supabase/functions/weekly-admin-digest/index.ts  "Needs attention" and
--                                                    "Fee changes to review"
--   supabase/functions/ops-health-check/index.ts     the 15-minute health check
--
-- Pieces:
--   qbo_sync_health(include_test)  one row per QuickBooks connection: plan
--        schedule, overdue / 2x overdue, errors in a row, errors in 7 days.
--        Mirrors isDueForPlan() in supabase/functions/qbo-sync/index.ts:
--          premium (Pro)    every qbo_usage_status().premium_interval_min
--                           (15, or 30 while throttled)
--          standard (Plus)  weekly
--          basic            monthly, on the 15th (US Central date)
--        "Overdue" allows one cron tick of slack; "2x overdue" is twice the
--        interval (basic: missed two 15ths in a row). While the usage guard
--        has stopped scheduled syncs (mode 'stopped') paused_by_usage is true
--        and the health check doesn't page about overdue clients.
--   digest_needs_attention(include_test)  the digest's "Needs attention" data
--        for the past 7 days (sync failures/last_error, disconnected or
--        errored connections, overdue clients, failed client/admin emails,
--        Intuit usage near the cap, health alerts still open).
--   digest_fee_suggestions(include_test)  clients whose live numbers point to
--        a different pricing milestone than the confirmed one. Same rules as
--        summarizeMilestone() in app.jsx (higher of 3-month average monthly
--        transactions and annual budget; staff-entered budget, else the
--        QuickBooks budget, else annualized expenses). The tier table below
--        MUST match PRICING_MILESTONES in app.jsx. Suggestion only: nothing
--        here changes a fee, and nothing emails a client.
--   ops_alert_state      one row per problem key, for de-duplication: at most
--        one alert per problem per 24 hours, and a "resolved" note when a
--        problem that was alerted clears.
--   ops_health_problems()  the current problems (test clients excluded).
--   ops_health_plan()      records what's seen now and returns what to send.
--   ops_health_mark()      called after a successful send.
--   cron job ops-health-check: every 15 minutes, POSTs to the function with
--        the Vault qbo_cron_key bearer (same pattern as qbo-sync).
--
-- Test clients (clients.test_only) never page anyone: the health check
-- excludes them entirely, and so does the digest (as every other digest
-- section does). include_test = true is only for previews.
--
-- All functions are service_role only (the edge functions call them after
-- their own auth check).

begin;

-- ============================================================================
-- Sync health per connection
-- ============================================================================
create or replace function public.qbo_sync_health(p_include_test boolean default false)
returns table (
  client_id text,
  client_name text,
  plan text,
  test_only boolean,
  status text,
  connected_at timestamptz,
  last_synced_at timestamptz,
  last_error text,
  expected text,
  overdue boolean,
  overdue_2x boolean,
  errors_in_a_row integer,
  errors_7d integer,
  last_run_status text,
  last_run_at timestamptz,
  last_run_detail text,
  paused_by_usage boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_usage  jsonb;
  v_int    integer := 15;
  v_paused boolean := false;
  v_today  date := (now() at time zone 'America/Chicago')::date;
  v_d15    date;
  v_prev15 date;
begin
  begin
    v_usage := public.qbo_usage_status();
    v_int := coalesce((v_usage ->> 'premium_interval_min')::integer, 15);
    v_paused := coalesce(v_usage ->> 'mode', '') = 'stopped';
  exception when others then
    null;  -- usage status unavailable: assume the normal cadence
  end;
  -- The most recent 15th on or before today (Central), and the one before.
  v_d15 := case when extract(day from v_today) >= 15
                then date_trunc('month', v_today)::date + 14
                else (date_trunc('month', v_today) - interval '1 month')::date + 14 end;
  v_prev15 := (v_d15 - interval '1 month')::date;

  return query
  select
    q.client_id,
    c.name,
    c.plan,
    coalesce(c.test_only, false),
    q.status,
    q.connected_at,
    q.last_synced_at,
    q.last_error,
    case c.plan
      when 'basic' then 'monthly on the 15th'
      when 'standard' then 'weekly'
      else 'every ' || v_int || ' min'
    end,
    -- overdue
    q.status = 'connected' and case
      when q.last_synced_at is null then q.connected_at < now() - interval '1 hour'
      when c.plan = 'basic' then v_today > v_d15
        and (q.last_synced_at at time zone 'America/Chicago')::date < v_d15
      when c.plan = 'standard' then q.last_synced_at < now() - interval '7 days 1 hour'
      else q.last_synced_at < now() - make_interval(mins => v_int + 10)
    end,
    -- 2x overdue
    q.status = 'connected' and case
      when q.last_synced_at is null then q.connected_at < now() - interval '2 hours'
      when c.plan = 'basic' then v_today > v_d15
        and (q.last_synced_at at time zone 'America/Chicago')::date < v_prev15
      when c.plan = 'standard' then q.last_synced_at < now() - interval '14 days'
      else q.last_synced_at < now() - make_interval(mins => 2 * v_int + 5)
    end,
    coalesce(e.in_a_row, 0)::integer,
    coalesce(e.week, 0)::integer,
    lr.status,
    lr.started_at,
    lr.detail,
    v_paused
  from qbo_connections q
  join clients c on c.id = q.client_id
  left join lateral (
    select
      count(*) filter (
        where r.status = 'error'
          and r.started_at > coalesce(
            (select max(r2.started_at) from qbo_sync_runs r2
              where r2.client_id = q.client_id and r2.status = 'ok'),
            '-infinity'::timestamptz)
      ) as in_a_row,
      count(*) filter (where r.status = 'error' and r.started_at > now() - interval '7 days') as week
    from qbo_sync_runs r
    where r.client_id = q.client_id
  ) e on true
  left join lateral (
    select r.status, r.started_at, r.detail
    from qbo_sync_runs r
    where r.client_id = q.client_id
    order by r.started_at desc
    limit 1
  ) lr on true
  where p_include_test or not coalesce(c.test_only, false);
end;
$$;
revoke all on function public.qbo_sync_health(boolean) from public, anon, authenticated;
grant execute on function public.qbo_sync_health(boolean) to service_role;

-- ============================================================================
-- Health alert state (de-duplication)
-- ============================================================================
create table if not exists public.ops_alert_state (
  key text primary key,
  title text not null,
  detail text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_alerted_at timestamptz,
  alert_count integer not null default 0,
  resolved_at timestamptz,
  -- true once an alert went out for the current occurrence; turns into
  -- resolve_note_due when the problem clears.
  alerted_since_resolve boolean not null default false,
  resolve_note_due boolean not null default false
);
alter table public.ops_alert_state enable row level security;
revoke all on public.ops_alert_state from anon;
revoke insert, update, delete, truncate on public.ops_alert_state from authenticated;
grant select on public.ops_alert_state to authenticated;
drop policy if exists "admins read ops alert state" on public.ops_alert_state;
create policy "admins read ops alert state" on public.ops_alert_state
  for select to authenticated using ((select public.is_active_staff_admin()));

-- ============================================================================
-- Current problems (test clients excluded)
-- ============================================================================
create or replace function public.ops_health_problems()
returns table (key text, kind text, client_id text, title text, detail text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_last_cron  timestamptz;
  v_cron_on    boolean;
  v_usage      jsonb;
  v_mail_fails integer;
  v_mail_last  text;
begin
  -- 1-3. Per-client QuickBooks problems.
  return query
  select 'sync_errors:' || h.client_id, 'sync_errors', h.client_id,
         h.client_name || ': QuickBooks sync failed ' || h.errors_in_a_row || ' times in a row',
         'Last error: ' || coalesce(left(h.last_run_detail, 300), left(h.last_error, 300), 'none recorded') ||
         '. Last good sync: ' || coalesce(to_char(h.last_synced_at at time zone 'America/Chicago', 'Mon FMDD, FMHH12:MI AM') || ' CT', 'never') ||
         '. Plan: ' || coalesce(h.plan, '?') || ' (' || h.expected || ').'
    from public.qbo_sync_health(false) h
   where h.status = 'connected' and h.errors_in_a_row >= 2;

  return query
  select 'sync_overdue:' || h.client_id, 'sync_overdue', h.client_id,
         h.client_name || ': QuickBooks sync is more than 2x overdue',
         'Expected ' || h.expected || '. Last good sync: ' ||
         coalesce(to_char(h.last_synced_at at time zone 'America/Chicago', 'Mon FMDD, FMHH12:MI AM') || ' CT', 'never') || '.'
    from public.qbo_sync_health(false) h
   where h.status = 'connected' and h.overdue_2x and not h.paused_by_usage and h.errors_in_a_row < 2;

  return query
  select 'qbo_reconnect:' || h.client_id, 'qbo_reconnect', h.client_id,
         h.client_name || ': QuickBooks needs to be reconnected',
         'The connection is in an error state, so nothing syncs until someone reconnects it. ' ||
         coalesce('Last error: ' || left(h.last_error, 300), '')
    from public.qbo_sync_health(false) h
   where h.status = 'error';

  -- 4. The qbo-sync cron job itself (every 5 minutes).
  select bool_or(j.active) into v_cron_on from cron.job j where j.jobname = 'qbo-sync-hourly';
  select max(d.start_time) into v_last_cron
    from cron.job_run_details d join cron.job j on j.jobid = d.jobid
   where j.jobname = 'qbo-sync-hourly' and d.status = 'succeeded';
  if v_cron_on is distinct from true or v_last_cron is null or v_last_cron < now() - interval '20 minutes' then
    return query select 'qbo_sync_cron'::text, 'qbo_sync_cron'::text, null::text,
      'The QuickBooks sync schedule hasn''t run recently'::text,
      (case when v_cron_on is null then 'The qbo-sync-hourly cron job is missing.'
            when v_cron_on = false then 'The qbo-sync-hourly cron job is turned off.'
            else 'Last successful run: ' || coalesce(to_char(v_last_cron at time zone 'America/Chicago', 'Mon FMDD, FMHH12:MI AM') || ' CT', 'never') ||
                 '. It should run every 5 minutes.' end)::text;
  end if;

  -- 5. Intuit usage hard stop (scheduled syncs paused until next month).
  begin
    v_usage := public.qbo_usage_status();
  exception when others then
    v_usage := null;
  end;
  if v_usage is not null and v_usage ->> 'mode' = 'stopped' then
    return query select 'qbo_usage_stopped'::text, 'qbo_usage_stopped'::text, null::text,
      'QuickBooks API usage hit the monthly safety limit'::text,
      ('Scheduled syncs are stopped until next month (' || (v_usage ->> 'calls') || ' of ' || (v_usage ->> 'cap') ||
       ' calls). Sync now still works.')::text;
  end if;

  -- 6. Emails failing: 3+ failed sends in the last hour (client/staff emails
  -- in client_email_log, plus the admin digest). Test clients' emails excluded.
  select count(*), max(x.reason) into v_mail_fails, v_mail_last
  from (
    select l.reason
      from client_email_log l
      left join clients c on c.id = l.client_id
     where l.created_at > now() - interval '1 hour'
       and l.status in ('error', 'not_configured')
       and l.trigger <> 'preview'
       and not coalesce(c.test_only, false)
    union all
    select r.detail
      from digest_runs r
     where r.started_at > now() - interval '1 hour'
       and r.status in ('error', 'not_configured')
       and r.trigger <> 'preview'
  ) x;
  if v_mail_fails >= 3 then
    return query select 'email_failures'::text, 'email_failures'::text, null::text,
      ('Emails are failing: ' || v_mail_fails || ' failed sends in the last hour')::text,
      ('Example error: ' || coalesce(left(v_mail_last, 300), 'none recorded') || '. Check Resend and the RESEND_API_KEY secret.')::text;
  end if;
end;
$$;
revoke all on function public.ops_health_problems() from public, anon, authenticated;
grant execute on function public.ops_health_problems() to service_role;

-- Records what's seen now; returns {alerts, resolved, open}. Alerts: current
-- problems not alerted in the last 24 hours. Resolved: problems that were
-- alerted and have now cleared (each gets one note).
create or replace function public.ops_health_plan()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r        record;
  v_keys   text[] := '{}';
  v_alerts jsonb;
  v_res    jsonb;
begin
  for r in select * from public.ops_health_problems() loop
    insert into ops_alert_state as s (key, title, detail)
    values (r.key, r.title, r.detail)
    on conflict (key) do update set
      title = excluded.title,
      detail = excluded.detail,
      last_seen_at = now(),
      first_seen_at = case when s.resolved_at is not null then now() else s.first_seen_at end,
      resolve_note_due = case when s.resolved_at is not null then false else s.resolve_note_due end,
      resolved_at = null;
    v_keys := v_keys || r.key;
  end loop;

  update ops_alert_state
     set resolved_at = now(),
         resolve_note_due = alerted_since_resolve,
         alerted_since_resolve = false
   where resolved_at is null and not (key = any (v_keys));

  delete from ops_alert_state
   where resolved_at < now() - interval '90 days' and not resolve_note_due;

  select coalesce(jsonb_agg(jsonb_build_object(
           'key', key, 'title', title, 'detail', detail,
           'first_seen_at', first_seen_at, 'reminder', alert_count > 0 and alerted_since_resolve)
           order by first_seen_at), '[]'::jsonb)
    into v_alerts
    from ops_alert_state
   where resolved_at is null and key = any (v_keys)
     and (last_alerted_at is null or last_alerted_at < now() - interval '24 hours');

  select coalesce(jsonb_agg(jsonb_build_object(
           'key', key, 'title', title, 'first_seen_at', first_seen_at, 'resolved_at', resolved_at)
           order by resolved_at), '[]'::jsonb)
    into v_res
    from ops_alert_state
   where resolve_note_due;

  return jsonb_build_object('alerts', v_alerts, 'resolved', v_res, 'open', cardinality(v_keys));
end;
$$;
revoke all on function public.ops_health_plan() from public, anon, authenticated;
grant execute on function public.ops_health_plan() to service_role;

create or replace function public.ops_health_mark(p_alerted text[], p_resolved text[])
returns void
language sql
security definer
set search_path = public
as $$
  update ops_alert_state
     set last_alerted_at = now(), alert_count = alert_count + 1, alerted_since_resolve = true
   where key = any (coalesce(p_alerted, '{}'));
  update ops_alert_state
     set resolve_note_due = false
   where key = any (coalesce(p_resolved, '{}'));
$$;
revoke all on function public.ops_health_mark(text[], text[]) from public, anon, authenticated;
grant execute on function public.ops_health_mark(text[], text[]) to service_role;

-- ============================================================================
-- Weekly digest: Needs attention (past 7 days)
-- ============================================================================
create or replace function public.digest_needs_attention(p_include_test boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_usage jsonb;
  v_near  jsonb := null;
begin
  begin
    v_usage := public.qbo_usage_status();
  exception when others then
    v_usage := null;
  end;
  if v_usage is not null and coalesce((v_usage ->> 'cap')::numeric, 0) > 0 and (
       v_usage ->> 'mode' <> 'normal'
       or (v_usage ->> 'projected')::numeric >= 0.7 * (v_usage ->> 'cap')::numeric
       or (v_usage ->> 'calls')::numeric >= 0.7 * (v_usage ->> 'cap')::numeric) then
    v_near := v_usage;
  end if;

  return jsonb_build_object(
    'include_test', p_include_test,
    'sync', coalesce((
      select jsonb_agg(jsonb_build_object(
               'client_id', h.client_id, 'client_name', h.client_name, 'plan', h.plan,
               'test_only', h.test_only, 'errors_7d', h.errors_7d,
               'errors_in_a_row', h.errors_in_a_row, 'last_error', h.last_error,
               'last_run_detail', case when h.last_run_status = 'error' then h.last_run_detail end,
               'overdue', h.overdue, 'expected', h.expected,
               'last_synced_at', h.last_synced_at, 'paused_by_usage', h.paused_by_usage)
             order by h.client_name)
        from public.qbo_sync_health(p_include_test) h
       where h.status = 'connected'
         and (h.errors_7d > 0 or h.last_error is not null or h.overdue)), '[]'::jsonb),
    'connections', coalesce((
      select jsonb_agg(jsonb_build_object(
               'client_id', h.client_id, 'client_name', h.client_name, 'test_only', h.test_only,
               'status', h.status, 'last_error', h.last_error, 'last_synced_at', h.last_synced_at)
             order by h.client_name)
        from public.qbo_sync_health(p_include_test) h
       where h.status <> 'connected'), '[]'::jsonb),
    'emails', coalesce((
      select jsonb_agg(e order by e.last_at desc)
      from (
        select 'client_email' as source, l.feature, count(*) as failed, max(l.created_at) as last_at,
               (array_agg(l.reason order by l.created_at desc))[1] as last_reason
          from client_email_log l
          left join clients c on c.id = l.client_id
         where l.created_at > now() - interval '7 days'
           and l.status in ('error', 'not_configured')
           and l.trigger <> 'preview'
           and (p_include_test or not coalesce(c.test_only, false))
         group by l.feature
        union all
        select 'admin_digest', 'weekly_admin_digest', count(*), max(r.started_at),
               (array_agg(r.detail order by r.started_at desc))[1]
          from digest_runs r
         where r.started_at > now() - interval '7 days'
           and r.status in ('error', 'not_configured')
           and r.trigger <> 'preview'
        having count(*) > 0
      ) e), '[]'::jsonb),
    'usage', v_near,
    'open_alerts', coalesce((
      select jsonb_agg(jsonb_build_object('title', s.title, 'first_seen_at', s.first_seen_at) order by s.first_seen_at)
        from ops_alert_state s
       where s.resolved_at is null and s.last_alerted_at is not null), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.digest_needs_attention(boolean) from public, anon, authenticated;
grant execute on function public.digest_needs_attention(boolean) to service_role;

-- ============================================================================
-- Weekly digest: Fee changes to review
-- ============================================================================
create or replace function public.digest_fee_suggestions(p_include_test boolean default false)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with tiers(tier, name, tx_max, budget_max, fee) as (
    -- Keep in sync with PRICING_MILESTONES in app.jsx (null max = no limit,
    -- null fee = Custom).
    values
      (1, 'Starter',     30,   150000,  250),
      (2, 'Foundation',  60,   300000,  300),
      (3, 'Growth',      100,  500000,  400),
      (4, 'Expanding',   150,  750000,  600),
      (5, 'Established', 200,  1000000, 700),
      (6, 'Advanced',    300,  2000000, 800),
      (7, 'Strategic',   500,  3000000, 1500),
      (8, 'Premier',     800,  4000000, 2500),
      (9, 'Enterprise',  null, null,    null)
  ),
  cl as (
    select c.id, c.name from clients c
     where p_include_test or not coalesce(c.test_only, false)
  ),
  stats as (
    select * from public.client_milestone_stats((select coalesce(array_agg(id), '{}') from cl))
  ),
  base as (
    select
      cl.id as client_id, cl.name as client_name,
      m.confirmed_tier,
      case when s.last_synced_at is not null then coalesce(s.tx_90d, 0) / 3.0 end as avg_tx,
      case
        when m.annual_budget is not null then m.annual_budget
        when s.qbo_budget_total > 0 then s.qbo_budget_total
        when s.expenses_12m > 0 then s.expenses_12m
      end as budget,
      case
        when m.annual_budget is not null then
          case m.budget_source when 'form_990' then 'Form 990' when 'approved_budget' then 'Approved budget'
               else 'Entered by MyGoodBooks' end
        when s.qbo_budget_total > 0 then 'QuickBooks budget'
        when s.expenses_12m > 0 then 'Last 12 months of expenses'
      end as budget_basis
    from cl
    left join client_milestones m on m.client_id = cl.id
    left join stats s on s.client_id = cl.id
  ),
  tiered as (
    select b.*,
      (select min(t.tier) from tiers t where b.avg_tx is not null and (t.tx_max is null or round(b.avg_tx) <= t.tx_max)) as tx_tier,
      (select min(t.tier) from tiers t where b.budget is not null and (t.budget_max is null or b.budget <= t.budget_max)) as budget_tier
    from base b
  ),
  computed as (
    select x.*,
      case when x.tx_tier is null and x.budget_tier is null then null
           else greatest(coalesce(x.tx_tier, 1), coalesce(x.budget_tier, 1)) end as computed_tier
    from tiered x
  )
  select jsonb_build_object(
    'changes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'client_id', c.client_id, 'client_name', c.client_name,
               'current_tier', c.confirmed_tier, 'current_name', ct.name, 'current_fee', ct.fee,
               'suggested_tier', c.computed_tier, 'suggested_name', st.name, 'suggested_fee', st.fee,
               'direction', case when c.computed_tier > c.confirmed_tier then 'up' else 'down' end,
               'avg_tx', round(c.avg_tx, 1), 'budget', c.budget, 'budget_basis', c.budget_basis,
               'driven_by', case
                 when c.tx_tier is not null and c.budget_tier is not null then
                   case when c.tx_tier = c.budget_tier then 'both'
                        when c.tx_tier > c.budget_tier then 'transactions' else 'budget' end
                 when c.tx_tier is not null then 'transactions'
                 else 'budget' end)
             order by c.client_name)
        from computed c
        join tiers ct on ct.tier = c.confirmed_tier
        join tiers st on st.tier = c.computed_tier
       where c.confirmed_tier is not null and c.confirmed_tier <> 0  -- 0 = Church Plant: never proposed
         and c.computed_tier is not null
         and c.computed_tier <> c.confirmed_tier), '[]'::jsonb),
    'unconfirmed', (select count(*) from computed c where c.confirmed_tier is null and c.computed_tier is not null)
  );
$$;
revoke all on function public.digest_fee_suggestions(boolean) from public, anon, authenticated;
grant execute on function public.digest_fee_suggestions(boolean) to service_role;

-- ============================================================================
-- Cron: every 15 minutes (offset from the other jobs)
-- ============================================================================
do $$
begin
  if exists (select 1 from cron.job where jobname = 'ops-health-check') then
    perform cron.unschedule('ops-health-check');
  end if;
end
$$;

select cron.schedule(
  'ops-health-check',
  '4,19,34,49 * * * *',
  $cron$
  select net.http_post(
    url := 'https://xumsqmhccgfjnlmieqyu.supabase.co/functions/v1/ops-health-check',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'qbo_cron_key' limit 1
      )
    ),
    body := '{"trigger":"cron"}'::jsonb,
    timeout_milliseconds := 30000
  );
  $cron$
);

commit;
