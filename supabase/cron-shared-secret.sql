-- Cron -> Edge Function auth via a machine-generated shared secret.
--
-- The cron jobs used to present a Vault secret named 'qbo_refresh_service_key'
-- that a human had to paste in by hand, and the Edge Functions compared it to
-- env SUPABASE_SERVICE_ROLE_KEY. One typo / one rotated key and every
-- scheduled call silently 401'd. Instead, Postgres generates its own 32-byte
-- random secret once, stores it in Vault, and the functions read the same
-- value back through a security-definer RPC. Nobody ever copies a key.

-- 1. Generate the secret, once. Re-running this file must not rotate it out
--    from under the deployed functions.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'qbo_cron_key') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'qbo_cron_key',
      'Shared secret pg_cron presents to the qbo-* Edge Functions.'
    );
  end if;
end
$$;

-- 2. The functions read it back with the service_role client. security definer
--    because vault.decrypted_secrets is not readable by API roles directly;
--    execute is revoked from everyone except service_role.
create or replace function public.qbo_cron_key()
returns text
language sql
security definer
set search_path = public
as $$
  select decrypted_secret from vault.decrypted_secrets
  where name = 'qbo_cron_key' limit 1
$$;

revoke all on function public.qbo_cron_key() from public;
revoke all on function public.qbo_cron_key() from anon;
revoke all on function public.qbo_cron_key() from authenticated;
grant execute on function public.qbo_cron_key() to service_role;

-- 3. Repoint both cron jobs at the generated secret. Same schedules, same
--    commands, only the Authorization header changes.
select cron.unschedule('qbo-refresh-tokens');
select cron.unschedule('qbo-sync-hourly');

select cron.schedule(
  'qbo-refresh-tokens',
  '*/15 * * * *',
  $cron$
  select net.http_post(
    url := 'https://xumsqmhccgfjnlmieqyu.supabase.co/functions/v1/qbo-refresh-token',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'qbo_cron_key' limit 1
      )
    ),
    body := '{}'::jsonb
  );
  $cron$
);

select cron.schedule(
  'qbo-sync-hourly',
  '20 * * * *',
  $cron$
  select net.http_post(
    url := 'https://xumsqmhccgfjnlmieqyu.supabase.co/functions/v1/qbo-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'qbo_cron_key' limit 1
      )
    ),
    body := '{}'::jsonb
  );
  $cron$
);
