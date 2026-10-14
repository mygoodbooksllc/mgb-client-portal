-- Pro QuickBooks sync: every hour instead of every 15 minutes (owner decision
-- 2026-10-14, final). The cadence is NOT in the cron schedule: cron job
-- 'qbo-sync-hourly' (jobid 5, '2-59/5 * * * *') ticks every 5 minutes and the
-- qbo-sync edge function decides who is due (isDueForPlan), using
-- qbo_usage_settings.premium_interval_min. So the cron job is left untouched;
-- only the setting changes. Sync now is not gated by this interval.
-- throttled_interval_min must stay >= premium_interval_min (table check), so
-- the throttled cadence moves from 30 min to 2 hours.
--
-- Re-runnable. To revert: premium_interval_min = 15, throttled_interval_min = 30.
-- Applied to production 2026-10-14.

update public.qbo_usage_settings
   set premium_interval_min   = 60,
       throttled_interval_min = 120,
       updated_at             = now()
 where id;

alter table public.qbo_usage_settings alter column premium_interval_min   set default 60;
alter table public.qbo_usage_settings alter column throttled_interval_min set default 120;
