-- Applied live via Supabase MCP apply_migration (name: qbo_refresh_cron).
-- Closes the documented gap that QBO connections had no refresh logic at
-- all: access tokens expire after ~1hr, refresh tokens after ~100 days of
-- inactivity, so every connection went stale within an hour with nothing to
-- catch or fix it.
--
-- New Edge Function: supabase/functions/qbo-refresh-token/index.ts. Called
-- on a schedule (not per-request): for every qbo_connections row with
-- status = 'connected', decrypts its tokens via the existing qbo_get_tokens
-- RPC, skips anything not within 10 minutes of expiring (or that was
-- touched in the last 3 minutes, to dodge a race with a concurrent manual
-- reconnect), and otherwise calls Intuit's token endpoint with
-- grant_type=refresh_token. Intuit always rotates the refresh token on
-- every use, so the new refresh_token is stored via qbo_store_tokens same
-- as the old one (the old one is invalid the instant the call succeeds).
-- On invalid_grant (refresh token itself expired/revoked) the connection is
-- flipped to status='error' with last_error = "Connection expired — please
-- reconnect QuickBooks." — the existing Reconnect/Disconnect UI in
-- app.jsx's QuickBooks tab already handles that status, no UI change
-- needed.
--
-- The function reuses every existing security pattern rather than adding
-- new surface: same QBO_TOKEN_ENCRYPTION_KEY secret, same qbo_store_tokens/
-- qbo_get_tokens security-definer RPCs (service_role only), same
-- never-log-token-values discipline as qbo-callback. verify_jwt is off
-- (the caller is pg_net, not a browser with a Supabase session) but the
-- function itself requires the caller to present a known bearer token
-- before doing anything — a random anon caller cannot hit it to force
-- token churn or read error details.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- Every 15 minutes, pg_net POSTs to the Edge Function with the cron key as
-- its Authorization bearer token, pulled from Supabase Vault rather than
-- inlined in this file (this .sql file is committed to git).
--
-- NO MANUAL STEP. The bearer is `qbo_cron_key`, a 32-byte secret Postgres
-- generates for itself and stores in Vault (supabase/cron-shared-secret.sql),
-- and the Edge Function reads the same value back through the
-- service_role-only public.qbo_cron_key() RPC. This replaced the earlier
-- `qbo_refresh_service_key` arrangement, which required a human to paste the
-- project's service_role key into Vault by hand and 401'd on every cron call
-- until they did. The function still accepts the service_role key too, for
-- ad-hoc calls.
--
-- Superseded by supabase/cron-shared-secret.sql, which reschedules this job
-- with the qbo_cron_key header — the command below is kept for the record.
select cron.schedule(
  'qbo-refresh-tokens',
  '*/15 * * * *',
  $$
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
  $$
);

-- To check the job is actually running once deployed:
--   select * from cron.job_run_details order by start_time desc limit 20;
