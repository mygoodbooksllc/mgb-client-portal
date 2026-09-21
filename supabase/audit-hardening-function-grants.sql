-- Audit hardening, batch 1: revoke browser EXECUTE on internal functions.
-- APPLIED LIVE via Supabase MCP apply_migration (migration name
-- `revoke_browser_execute_on_internal_functions`). Kept here so the repo
-- records it.
--
-- Background
-- ----------
-- Postgres grants EXECUTE on a newly created function to PUBLIC by default,
-- and Supabase exposes every public-schema function over PostgREST at
-- /rest/v1/rpc/<name>. Nothing in this project ever revoked those defaults
-- except the QBO token functions (qbo-token-encryption.sql) and qbo_disconnect
-- (qbo-disconnect.sql), so Supabase's own security advisor flagged thirteen
-- SECURITY DEFINER functions as callable by `anon` — i.e. by someone with the
-- publishable key and no account at all.
--
-- The six below are the ones with no legitimate browser caller.
--
--   log_client_document_change, log_client_note_change,
--   log_client_user_change, log_qbo_connection_change,
--   staff_messages_set_author_from_staff
--     All RETURN TRIGGER. A trigger function runs as part of the statement
--     that fires it, as the table owner, and does not consult the caller's
--     EXECUTE privilege — so this revoke removes reachable surface and
--     changes nothing about how the audit-log and author-stamping triggers
--     actually work.
--
--   has_temp_admin_access(text)
--     SECURITY DEFINER, takes an arbitrary email, performs no auth check of
--     its own, and is referenced by no RLS policy and no application code
--     (verified against pg_policies and against app.jsx/components before
--     revoking). An anonymous caller could use it as an oracle — ask it about
--     any staff address and learn whether that person currently holds an
--     elevated grant, which is useful for timing a social-engineering
--     attempt. Revoked rather than dropped so a future policy can still use
--     it server-side.
--
-- What is deliberately NOT revoked here
-- -------------------------------------
--   is_active_staff(), is_active_staff_admin(), is_conversation_member(uuid)
--     RLS policies are evaluated as the CALLING role, so these must stay
--     executable by anon/authenticated or every policy that calls them fails
--     closed and the app stops working entirely.
--
--   access_link_client(text), submit_access_request(...)
--     Genuinely part of the anonymous access-request flow: someone following
--     an emailed link has no session yet. Both validate the link token
--     internally.
--
--   request_enterprise_upgrade(text,text)
--     Still anon-callable, and it should not be — it trusts both parameters
--     and never checks that the caller has any relationship to p_client_id.
--     A revoke alone would break the real in-app caller, so this one needs
--     the function body fixed to derive the requester from the JWT. Tracked
--     as a follow-up, not fixed here.

revoke all on function public.log_client_document_change() from public, anon, authenticated;
revoke all on function public.log_client_note_change() from public, anon, authenticated;
revoke all on function public.log_client_user_change() from public, anon, authenticated;
revoke all on function public.log_qbo_connection_change() from public, anon, authenticated;
revoke all on function public.staff_messages_set_author_from_staff() from public, anon, authenticated;
revoke all on function public.has_temp_admin_access(text) from public, anon, authenticated;

-- Verify (expect anon_can = false for all six):
--   select p.oid::regprocedure::text as fn,
--          has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_can
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.prosecdef
--   order by anon_can desc, 1;
