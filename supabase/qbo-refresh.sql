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
-- function itself requires the caller to present the project's
-- service_role key as a Bearer token before doing anything — a random anon
-- caller cannot hit it to force token churn or read error details.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- Every 15 minutes, pg_net POSTs to the Edge Function with the service_role
-- key as its Authorization bearer token, pulled from Supabase Vault rather
-- than inlined in this file (this .sql file is committed to git).
--
-- ONE-TIME MANUAL FOLLOW-UP REQUIRED: this session did not have the raw
-- service_role key value available to store, so the Vault secret the cron
-- job reads (`qbo_refresh_service_key`) does not exist yet. Until a human
-- with dashboard access runs the following once (Supabase SQL editor, or
-- via a securely-copied value — never paste it into a committed file):
--
--   select vault.create_secret('<the service_role key value>', 'qbo_refresh_service_key');
--
-- ...the cron job fires every 15 minutes but each call gets a 401 from the
-- function and no-ops (visible in `select * from cron.job_run_details`).
-- Nothing insecure happens in the meantime — the function just refuses the
-- unauthenticated calls — but token refresh will NOT actually run until
-- this one step is done. This is the "needs a manual follow-up" gap called
-- out in HANDOFF7.md; pg_cron and pg_net are both available on this
-- project's plan, so no external scheduler (GitHub Action, Supabase Cron
-- tier, etc.) is needed once the secret is populated.
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
        where name = 'qbo_refresh_service_key' limit 1
      )
    ),
    body := '{}'::jsonb
  );
  $$
);

-- To check the job is actually running (and whether it's still hitting the
-- 401 no-op above) once deployed:
--   select * from cron.job_run_details order by start_time desc limit 20;
