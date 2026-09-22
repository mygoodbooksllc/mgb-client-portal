-- Schedules the qbo-sync Edge Function (supabase/functions/qbo-sync/index.ts)
-- hourly. Deliberately a carbon copy of the qbo-refresh-tokens job in
-- supabase/qbo-refresh.sql — same extensions, same Vault-held bearer token,
-- same "the function itself checks the service_role key" posture — because
-- qbo-sync has the identical trust profile: verify_jwt off (the caller is
-- pg_net, not a browser session), so the function refuses anything that
-- doesn't present SUPABASE_SERVICE_ROLE_KEY as its bearer token.
--
-- APPLY ORDER: after qbo-data.sql (the tables the function writes) and after
-- the qbo-sync function is deployed. Scheduling it earlier is harmless — the
-- calls just 404/401 and no-op — but nothing will sync.
--
-- Hourly, not every 15 minutes like the token refresher: a full sync pulls
-- accounts + a 12-month P&L + budgets + open AR/AP + 90 days of transactions
-- per client, which is a handful of Intuit API calls each. Intuit throttles
-- at 500 requests/minute per realm, so the cadence is nowhere near the
-- ceiling, but hourly is the right granularity for bookkeeping data that a
-- human enters once a day. The "Sync now" button in the Client details
-- QuickBooks tab covers the impatient case.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- Runs at :20 past the hour, offset from the token refresher's :00/:15/:30/:45
-- so a sync never starts in the same minute a refresh might be rotating that
-- client's tokens out from under it. (The function also refreshes on its own
-- when a token is within 10 minutes of expiry, so this is belt-and-braces.)
select cron.schedule(
  'qbo-sync-hourly',
  '20 * * * *',
  $$
  select net.http_post(
    url := 'https://xumsqmhccgfjnlmieqyu.supabase.co/functions/v1/qbo-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'qbo_refresh_service_key' limit 1
      )
    ),
    body := '{}'::jsonb
  );
  $$
);

-- SAME ONE-TIME MANUAL FOLLOW-UP as qbo-refresh.sql, and the same secret:
-- this job reads the Vault secret `qbo_refresh_service_key`, so if that was
-- already populated for the token refresher, nothing further is needed here.
-- If it hasn't been, run once (Supabase SQL editor — never paste the key
-- into a committed file):
--
--   select vault.create_secret('<the service_role key value>', 'qbo_refresh_service_key');
--
-- Until then this job fires hourly, each call gets a 401 from the function,
-- and nothing syncs. Nothing insecure happens in the meantime.
--
-- To check the job:
--   select * from cron.job_run_details
--   where jobid = (select jobid from cron.job where jobname = 'qbo-sync-hourly')
--   order by start_time desc limit 20;
-- And what it actually did, per client:
--   select * from qbo_sync_runs order by started_at desc limit 20;
--
-- To remove it:  select cron.unschedule('qbo-sync-hourly');
