-- QuickBooks webhooks: sync a company when QuickBooks says it changed,
-- instead of only on the polling schedule (README "QuickBooks sync at scale").
-- NOT APPLIED until the owner runs it. Safe to apply before or after
-- deploying the functions: qbo-sync falls back to the old behaviour when
-- these columns are missing, and does nothing new until webhooks_enabled is
-- set to true.
--
-- Pieces:
--   qbo_connections.webhook_dirty_at  set by the qbo-webhook function when a
--                                     notification names this realm; cleared
--                                     by qbo-sync when it syncs the client.
--   qbo_connections.webhook_last_at   last time any notification arrived for
--                                     this realm (for checking it works).
--   qbo_usage_settings.webhooks_enabled      false (default) = poll exactly as
--                                     today. true = Pro clients sync within a
--                                     few minutes of a change, and the poll
--                                     becomes a safety net every
--   qbo_usage_settings.webhook_fallback_min  minutes (default 360 = 6 hours).
--   Plus and Basic keep their weekly / monthly schedule either way.
--
-- Turn on (after the Intuit webhook is set up and webhook_last_at is filling
-- in):   update public.qbo_usage_settings set webhooks_enabled = true where id;
-- Roll back: update public.qbo_usage_settings set webhooks_enabled = false where id;
-- Re-runnable.

alter table public.qbo_connections add column if not exists webhook_dirty_at timestamptz;
alter table public.qbo_connections add column if not exists webhook_last_at  timestamptz;

-- qbo-webhook looks connections up by realm id.
create index if not exists qbo_connections_realm_id_idx on public.qbo_connections (realm_id);

alter table public.qbo_usage_settings add column if not exists webhooks_enabled boolean not null default false;
alter table public.qbo_usage_settings add column if not exists webhook_fallback_min integer not null default 360;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'qbo_usage_settings_webhook_fallback'
  ) then
    alter table public.qbo_usage_settings
      add constraint qbo_usage_settings_webhook_fallback check (webhook_fallback_min between 60 and 2880);
  end if;
end $$;

-- Check it is working (service role / SQL editor):
--   select client_id, realm_id, webhook_last_at, webhook_dirty_at, last_synced_at
--     from public.qbo_connections order by webhook_last_at desc nulls last;
