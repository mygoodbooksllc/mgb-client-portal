-- Moves the qbo-sync cron sweep (supabase/qbo-sync-cron.sql, job
-- 'qbo-sync-hourly') from hourly at :20 to every 5 minutes (offset to :02). NOT APPLIED —
-- apply only after the qbo-sync function with the "Sync now" changes is
-- deployed and the frontend is live.
--
-- Cost per run, per connected company (full pull, not incremental):
-- 7 Intuit calls — Account query, ProfitAndLoss report (12 months by
-- month), Budget query, open Invoice query, open Bill query, TransactionList
-- report (90 days), plus an occasional token refresh (and a one-time second
-- probe call for a connection with no api_env yet). At */5 that's 84 calls/
-- hour/company, ~1.4/minute — against Intuit's ~500 requests/minute/realm
-- and 10 concurrent requests/realm. Calls are sequential, so concurrency
-- per realm is 1. Edge Function invocations: 288/day, ~8,900/month for
-- this job regardless of company count (the sweep is one invocation).
--
-- '2-59/5' (minutes 2, 7, 12, …) rather than '*/5': */5 would fire on the
-- same minutes as qbo-refresh-tokens (*/15), and qbo-sync.sql's original
-- :20 offset exists so a sync never refreshes a token in the same minute the
-- refresher is rotating it (Intuit invalidates the old refresh token on use).
--
-- Every run deletes and re-inserts each company's qbo_* rows, so at 5
-- minutes expect more table churn/WAL (autovacuum handles it at this scale).
--
-- The job name is kept ('qbo-sync-hourly') so existing monitoring queries and
-- the cron-shared-secret.sql reschedule keep matching; only the schedule
-- changes. The command (pg_net POST with the Vault-held qbo_cron_key bearer)
-- is untouched.

select cron.alter_job(
  job_id   := (select jobid from cron.job where jobname = 'qbo-sync-hourly'),
  schedule := '2-59/5 * * * *'
);

-- To revert:
--   select cron.alter_job(
--     job_id   := (select jobid from cron.job where jobname = 'qbo-sync-hourly'),
--     schedule := '20 * * * *'
--   );
