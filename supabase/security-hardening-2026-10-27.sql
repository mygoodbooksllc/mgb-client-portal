-- =====================================================================
-- Security hardening batch, 2026-10-27.
-- Applied to production 2026-10-27 via Supabase MCP apply_migration
-- (migration name `security_hardening_2026_10_27`).
-- Self-test: security-hardening-tests.sql (rolls back).
--
-- Idempotent: every statement can be re-run (REVOKE/GRANT, CREATE OR
-- REPLACE, ALTER ... SET, DROP POLICY IF EXISTS + CREATE POLICY).
-- No data is changed or deleted. No visible app behavior changes.
--
-- 1. qbo_tokens, qbo_firm_tokens: revoke every table privilege from anon
--    and authenticated (they had ALL, including TRUNCATE, which RLS does
--    not cover). RLS already blocked reads (no permissive policy). Only
--    service_role and the postgres-owned SECURITY DEFINER functions
--    (qbo_get_tokens, qbo_store_tokens, qbo_disconnect, qbo_firm_*) touch
--    these tables, and those run as the owner, so they are unaffected.
--
-- 2. access_link_client(p_token): anon-callable token lookup had no minimum
--    token length. Adds the same `length(p_token) >= 32` guard that
--    access_link_info and get_report_share use. Every stored token is 32+
--    characters (checked live). Signature, return type, volatility,
--    SECURITY DEFINER, search_path and grants are unchanged (CREATE OR
--    REPLACE keeps the ACL).
--
-- 3. conversation_has_members(uuid), conversation_is_unused(uuid): staff
--    chat helpers were executable by anon (through the default PUBLIC
--    grant). No app or edge-function code calls them; they are used only
--    in staff_conversations / staff_conversation_members policies, which
--    already require is_active_staff(). Revoked from PUBLIC and anon;
--    authenticated and service_role keep EXECUTE so the policies still work
--    for signed-in users.
--
-- 4. (no change) tr_review_revealed_id, tk_task_internal_blocked: used by
--    RLS policies for role authenticated (action_steps tr_steps_read,
--    tk_comments update), so authenticated must keep EXECUTE.
--    is_roster_client_id: called by SECURITY INVOKER functions
--    qbo_hours_by_client / qbo_hours_by_staff, so authenticated must keep
--    EXECUTE. tk_late_count_from: called directly by the app
--    (TK_api.lateCountFrom) and by digest/score functions that run from
--    cron/service_role with no staff JWT, so an is_active_staff() guard
--    would change late-task scoring there. Left as is.
--
-- 5. is_roster_client(clients), cel_next_occurrence(date, date): pin
--    search_path (advisor: function_search_path_mutable).
--
-- 6. tk_projects "tk projects read": the owner_email branch now also
--    requires is_active_staff(), so a deactivated staff member (or any
--    non-staff session with a matching email) no longer reads projects
--    they own. tk_can_see_project(id) branch unchanged (it already checks
--    is_active_staff()).
--
-- 7. client_files "client reads own files": limited (access <> 'full')
--    client users could read every visibility='request' file for their
--    client. Request files are now visible to full-access users, or to a
--    limited user only when their email is in the linked request's
--    recipient_emails (mirrors client_requests "client requests read").
--    New helper client_file_request_visible(text, uuid) (SECURITY DEFINER,
--    authenticated + service_role only) because recipient_emails is not
--    readable by authenticated. 'shared' and 'message' branches unchanged.
-- =====================================================================

begin;

-- 1 ------------------------------------------------------------------
revoke all on table public.qbo_tokens      from public, anon, authenticated;
revoke all on table public.qbo_firm_tokens from public, anon, authenticated;
grant all on table public.qbo_tokens      to service_role;
grant all on table public.qbo_firm_tokens to service_role;

-- 2 ------------------------------------------------------------------
create or replace function public.access_link_client(p_token text)
 returns text
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select client_id from access_request_links
   where token = p_token and length(p_token) >= 32
     and active and expires_at > now();
$function$;

-- 3 ------------------------------------------------------------------
revoke execute on function public.conversation_has_members(uuid) from public, anon;
revoke execute on function public.conversation_is_unused(uuid)   from public, anon;
grant  execute on function public.conversation_has_members(uuid) to authenticated, service_role;
grant  execute on function public.conversation_is_unused(uuid)   to authenticated, service_role;

-- 5 ------------------------------------------------------------------
alter function public.is_roster_client(public.clients)   set search_path = public, pg_temp;
alter function public.cel_next_occurrence(date, date)    set search_path = public, pg_temp;

-- 6 ------------------------------------------------------------------
drop policy if exists "tk projects read" on public.tk_projects;
create policy "tk projects read" on public.tk_projects
  as permissive for select to authenticated
  using (
    ((owner_email = lower(coalesce((auth.jwt() ->> 'email'::text), ''::text)))
       and (select public.is_active_staff()))
    or public.tk_can_see_project(id)
  );

-- 7 ------------------------------------------------------------------
-- client_requests.recipient_emails is not column-granted to authenticated,
-- so the policy cannot read it directly: a small SECURITY DEFINER helper
-- answers only "may the caller see request files for this client/request"
-- (full-access member, or named recipient of that live request).
create or replace function public.client_file_request_visible(p_client_id text, p_request_id uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (
           select 1 from client_users cu
            where lower(cu.email) = lower(nullif(btrim(auth.jwt() ->> 'email'), ''))
              and cu.client_id = p_client_id
              and cu.active
              and cu.access = 'full')
      or exists (
           select 1 from client_requests r
            where p_request_id is not null
              and r.id = p_request_id
              and r.client_id = p_client_id
              and r.deleted_at is null
              and lower(nullif(btrim(auth.jwt() ->> 'email'), '')) in
                  (select lower(x.x) from unnest(coalesce(r.recipient_emails, '{}'::text[])) x(x)));
$function$;
revoke execute on function public.client_file_request_visible(text, uuid) from public, anon;
grant  execute on function public.client_file_request_visible(text, uuid) to authenticated, service_role;

drop policy if exists "client reads own files" on public.client_files;
create policy "client reads own files" on public.client_files
  as permissive for select to authenticated
  using (
    (trashed_at is null)
    and public.is_client_member(client_id)
    and (
      (visibility = 'shared'::text)
      or ((visibility = 'request'::text)
          and public.client_file_request_visible(client_id, client_request_id))
      or ((visibility = 'message'::text)
          and (participant_email = lower(((select auth.jwt()) ->> 'email'::text))))
    )
  );

commit;
