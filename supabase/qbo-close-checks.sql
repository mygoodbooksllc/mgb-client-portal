-- QuickBooks close data, automated month-close checks and stale-bank flags
-- (QBO features plan, Phase 1, 2026-09-30).
--
-- Status: Applied to production 2026-09-30
-- Safe to re-run. Depends on qbo-data.sql, qbo-replace-rows.sql,
-- month-close.sql and staff-schema.sql.
--
-- QuickBooks has no bank-feed status and no "last reconciled" date in its
-- API, so qbo-sync pulls proxies for them once a day per client (and at once
-- for a client that has none yet, which is the backfill):
--
--   qbo_account_status   one row per bank / credit card / Undeposited Funds /
--                        uncategorized (incl. Ask My Accountant) account:
--                        last transaction date (13 months of TransactionList,
--                        both sides of a transfer), last reconciled transaction
--                        date and the count of transactions not yet reconciled
--                        (the TransactionList "cleared" column; null when
--                        QuickBooks didn't return it).
--   qbo_period_balances  one row per such account per month (13 months):
--                        balance at month end (BalanceSheet by month; bank,
--                        card, Undeposited Funds and balance-sheet
--                        uncategorized accounts), transactions dated in the
--                        month (GeneralLedger for uncategorized accounts,
--                        TransactionList for bank and card), and for bank and
--                        card accounts the number of transactions dated on or
--                        before month end that aren't reconciled.
--   close_checks         one row per client per completed month (last 6):
--                        ready / blocked / behind / no_data, the individual
--                        checks and plain-language reasons. Written by
--                        close_checks_evaluate(), which qbo-sync calls after
--                        each close-data pull and a daily cron re-runs (the
--                        stale-bank rule depends on today's date).
--
-- The checks, for month M ending on day E:
--   uncategorized   no transactions dated in M on an Uncategorized or Ask My
--                   Accountant account
--   undeposited     Undeposited Funds balance at E is zero
--   bank_active     every bank and card account with any activity in the last
--                   13 months has a transaction on or after E - N days
--                   (N = month_close_settings.stale_bank_days, default 10)
--   reconciled      every bank and card account has no unreconciled
--                   transaction dated on or before E
-- Status: behind (bank_active or reconciled fails) > blocked (uncategorized
-- or undeposited fails) > ready. no_data until the first close-data pull.
--
-- qbo_connections gains last_full_sync_at (the last full re-read; CDC checks
-- in between skip the re-read when nothing changed) and close_synced_at (the
-- last close-data pull).
--
-- RLS: like the other qbo_* tables for staff (can_access_client), plus an
-- active-staff check. No client-user policy: these tables are staff only.
-- No browser writes; qbo-sync writes through qbo_replace_rows() and
-- close_checks_evaluate(), both SECURITY DEFINER and service_role only.

alter table public.qbo_connections add column if not exists last_full_sync_at timestamptz;
alter table public.qbo_connections add column if not exists close_synced_at timestamptz;

alter table public.month_close_settings
  add column if not exists stale_bank_days integer not null default 10;
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'month_close_settings_stale_bank_days'
  ) then
    alter table public.month_close_settings
      add constraint month_close_settings_stale_bank_days check (stale_bank_days between 1 and 90);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.qbo_account_status (
  client_id                text not null references public.clients(id) on delete cascade,
  qbo_id                   text not null,
  name                     text,
  kind                     text not null,
  account_type             text,
  account_sub_type         text,
  current_balance          numeric,
  last_txn_date            date,
  last_reconciled_date     date,
  unreconciled_count       integer,
  oldest_unreconciled_date date,
  updated_at               timestamptz not null default now(),
  primary key (client_id, qbo_id),
  constraint qbo_account_status_kind check (kind in ('bank', 'credit_card', 'undeposited', 'uncategorized'))
);

create table if not exists public.qbo_period_balances (
  client_id            text not null references public.clients(id) on delete cascade,
  month                date not null,
  account_qbo_id       text not null,
  account_name         text,
  kind                 text not null,
  balance_end          numeric,
  txn_count            integer not null default 0,
  unreconciled_through integer,
  updated_at           timestamptz not null default now(),
  primary key (client_id, month, account_qbo_id),
  constraint qbo_period_balances_month_first check (month = date_trunc('month', month)::date),
  constraint qbo_period_balances_kind check (kind in ('bank', 'credit_card', 'undeposited', 'uncategorized'))
);

create table if not exists public.close_checks (
  client_id    text not null references public.clients(id) on delete cascade,
  period       date not null,
  status       text not null,
  checks       jsonb not null default '[]'::jsonb,
  reasons      text[] not null default '{}',
  data_as_of   timestamptz,
  evaluated_at timestamptz not null default now(),
  primary key (client_id, period),
  constraint close_checks_period_first check (period = date_trunc('month', period)::date),
  constraint close_checks_status check (status in ('ready', 'blocked', 'behind', 'no_data'))
);

create index if not exists close_checks_period_idx on public.close_checks (period);

do $$
declare t text;
begin
  foreach t in array array['qbo_account_status', 'qbo_period_balances', 'close_checks'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "staff read %s" on public.%I', t, t);
    execute format(
      'create policy "staff read %s" on public.%I for select to authenticated '
      'using ((select public.is_active_staff()) and public.can_access_client(client_id))',
      t, t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- qbo_replace_rows: allow the two new data tables. Body otherwise identical to
-- the live function (checked 2026-09-30).
-- ---------------------------------------------------------------------------
create or replace function public.qbo_replace_rows(p_table text, p_client_id text, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n integer;
  rows_in jsonb := coalesce(p_rows, '[]'::jsonb);
begin
  if p_table not in (
    'qbo_accounts', 'qbo_monthly_pl', 'qbo_pl_lines', 'qbo_budget_lines',
    'qbo_invoices', 'qbo_bills', 'qbo_transactions',
    'qbo_account_status', 'qbo_period_balances'
  ) then
    raise exception 'qbo_replace_rows: table % not allowed', p_table;
  end if;
  if jsonb_typeof(rows_in) <> 'array' then
    raise exception 'qbo_replace_rows: rows must be a JSON array';
  end if;
  if exists (
    select 1 from jsonb_array_elements(rows_in) e
    where e ->> 'client_id' is distinct from p_client_id
  ) then
    raise exception 'qbo_replace_rows: row client_id mismatch';
  end if;

  select coalesce(jsonb_agg(
           case when e ? 'updated_at' then e
                else e || jsonb_build_object('updated_at', now()) end
         ), '[]'::jsonb)
    into rows_in
    from jsonb_array_elements(rows_in) e;

  execute format('delete from %I where client_id = $1', p_table)
    using p_client_id;
  execute format(
    'insert into %I select * from jsonb_populate_recordset(null::%I, $1)',
    p_table, p_table
  ) using rows_in;
  get diagnostics n = row_count;
  return n;
end;
$function$;

revoke all on function public.qbo_replace_rows(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.qbo_replace_rows(text, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Evaluation
-- ---------------------------------------------------------------------------
create or replace function public.close_checks_evaluate(p_client_id text default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today      date := (now() at time zone 'America/Chicago')::date;
  v_stale_days integer;
  v_conn       record;
  v_period     date;
  v_end        date;
  v_checks     jsonb;
  v_reasons    text[];
  v_status     text;
  v_n          integer;
  v_amt        numeric;
  v_has        boolean;
  v_names      text;
  v_recon_known boolean;
  v_behind     boolean;
  v_blocked    boolean;
  v_written    integer := 0;
begin
  select coalesce(max(stale_bank_days), 10) into v_stale_days from public.month_close_settings;

  for v_conn in
    select c.client_id, c.close_synced_at
      from public.qbo_connections c
     where p_client_id is null or c.client_id = p_client_id
  loop
    for i in 1..6 loop
      v_period := (date_trunc('month', v_today) - make_interval(months => i))::date;
      v_end := (v_period + interval '1 month' - interval '1 day')::date;
      v_checks := '[]'::jsonb;
      v_reasons := '{}';
      v_behind := false;
      v_blocked := false;

      if v_conn.close_synced_at is null then
        v_status := 'no_data';
        v_reasons := array['Close data hasn''t synced from QuickBooks yet.'];
      else
        -- 1. Uncategorized / Ask My Accountant activity in the month.
        select coalesce(sum(txn_count), 0) into v_n
          from public.qbo_period_balances
         where client_id = v_conn.client_id and month = v_period and kind = 'uncategorized';
        v_checks := v_checks || jsonb_build_object(
          'key', 'uncategorized', 'label', 'Uncategorized is zero', 'ok', v_n = 0, 'count', v_n);
        if v_n > 0 then
          v_blocked := true;
          v_reasons := v_reasons || format('%s uncategorized or Ask My Accountant transaction%s',
                                           v_n, case when v_n = 1 then '' else 's' end);
        end if;

        -- 2. Undeposited Funds at month end.
        select count(*) > 0, coalesce(sum(balance_end), 0) into v_has, v_amt
          from public.qbo_period_balances
         where client_id = v_conn.client_id and month = v_period and kind = 'undeposited';
        if not v_has then
          select count(*) > 0 into v_has from public.qbo_account_status
           where client_id = v_conn.client_id and kind = 'undeposited';
          v_amt := case when v_has then null else 0 end;
        end if;
        v_checks := v_checks || jsonb_build_object(
          'key', 'undeposited', 'label', 'Undeposited funds cleared',
          'ok', case when v_amt is null then null else abs(v_amt) < 0.005 end, 'amount', v_amt);
        if v_amt is not null and abs(v_amt) >= 0.005 then
          v_blocked := true;
          v_reasons := v_reasons || format('Undeposited Funds balance of $%s at month end',
                                           to_char(v_amt, 'FM999,999,990.00'));
        end if;

        -- 3. Bank and card accounts active through month end.
        select count(*), string_agg(coalesce(name, qbo_id) || ' (last ' || to_char(last_txn_date, 'Mon FMDD') || ')', ', ' order by name)
          into v_n, v_names
          from public.qbo_account_status
         where client_id = v_conn.client_id
           and kind in ('bank', 'credit_card')
           and last_txn_date is not null
           and last_txn_date < v_end - v_stale_days;
        v_checks := v_checks || jsonb_build_object(
          'key', 'bank_active', 'label', 'Bank accounts active through month end',
          'ok', v_n = 0, 'count', v_n, 'accounts', v_names);
        if v_n > 0 then
          v_behind := true;
          v_reasons := v_reasons || format('No recent transactions: %s', v_names);
        end if;

        -- 4. Reconciled through month end (proxy: nothing dated on or before
        -- month end is unreconciled).
        select count(*) filter (where unreconciled_through is not null) > 0,
               count(*) filter (where unreconciled_through > 0),
               string_agg(coalesce(account_name, account_qbo_id) || ' (' || unreconciled_through || ')', ', '
                          order by account_name) filter (where unreconciled_through > 0)
          into v_recon_known, v_n, v_names
          from public.qbo_period_balances
         where client_id = v_conn.client_id and month = v_period and kind in ('bank', 'credit_card');
        v_checks := v_checks || jsonb_build_object(
          'key', 'reconciled', 'label', 'Reconciled through month end',
          'ok', case when v_recon_known then v_n = 0 else null end, 'count', v_n, 'accounts', v_names);
        if v_recon_known and v_n > 0 then
          v_behind := true;
          v_reasons := v_reasons || format('Unreconciled transactions through month end: %s', v_names);
        end if;

        v_status := case when v_behind then 'behind' when v_blocked then 'blocked' else 'ready' end;
        if v_conn.close_synced_at < now() - interval '3 days' then
          v_reasons := v_reasons || format('QuickBooks close data is %s days old',
                                           extract(day from now() - v_conn.close_synced_at)::int);
        end if;
      end if;

      insert into public.close_checks as cc (client_id, period, status, checks, reasons, data_as_of, evaluated_at)
      values (v_conn.client_id, v_period, v_status, v_checks, v_reasons, v_conn.close_synced_at, now())
      on conflict (client_id, period) do update
        set status = excluded.status, checks = excluded.checks, reasons = excluded.reasons,
            data_as_of = excluded.data_as_of, evaluated_at = excluded.evaluated_at;
      v_written := v_written + 1;
    end loop;
  end loop;
  return v_written;
end;
$$;

revoke all on function public.close_checks_evaluate(text) from public, anon, authenticated;
grant execute on function public.close_checks_evaluate(text) to service_role;

-- Daily re-evaluation (pure SQL, no HTTP): 06:25 US Central-ish (11:25 UTC).
select cron.unschedule(jobid) from cron.job where jobname = 'close-checks-daily';
select cron.schedule('close-checks-daily', '25 11 * * *', $cron$ select public.close_checks_evaluate(null); $cron$);
