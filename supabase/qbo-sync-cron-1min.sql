-- Moves the qbo-sync cron sweep (job 'qbo-sync-hourly', name kept for
-- monitoring) from every 5 minutes to every minute, skipping :00/:15/:30/:45
-- so a sync never runs in the same minute qbo-refresh-tokens (*/15) rotates
-- a refresh token (Intuit invalidates the old one on use). APPLIED 2026-09-24.
--
-- Cost per connected company: ~7 Intuit calls a minute (limit ~500/min per
-- company). Each sweep syncs every connected company in turn, a few seconds
-- each; once a sweep takes longer than a minute (roughly 15+ companies) runs
-- overlap. The per-connection sync_started_at lock stops two runs syncing the
-- same company at once, but consider QuickBooks webhooks (sync on change)
-- before growing much past that. Supersedes qbo-sync-cron-5min.sql.

select cron.alter_job(
  job_id   := (select jobid from cron.job where jobname = 'qbo-sync-hourly'),
  schedule := '1-14,16-29,31-44,46-59 * * * *'
);

-- To revert to every 5 minutes:
--   select cron.alter_job(
--     job_id   := (select jobid from cron.job where jobname = 'qbo-sync-hourly'),
--     schedule := '2-59/5 * * * *'
--   );
