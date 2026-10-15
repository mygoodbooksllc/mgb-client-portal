-- Staff sign-in accounts: find active staff who can't sign in yet.
--
-- Supabase Auth has "Allow new users to sign up" OFF on purpose, so a
-- Google sign-in only works for an address that already has an auth.users
-- row. Adding someone on Team → Members only writes public.staff, so on
-- 2026-10-15 four new bookkeepers got signup_disabled from Google until the
-- owner made their accounts by hand in the dashboard. The staff-auth edge
-- function (supabase/functions/staff-auth) now makes that account whenever
-- an admin adds, imports or reactivates someone; this file adds the check
-- that finds anyone it missed, which Team → Members shows as a "Fix sign-in"
-- card.
--
-- Why there is no trigger on public.staff that creates the account:
--   * auth.users can't safely be written from SQL. GoTrue owns that table
--     (identities, instance_id, token columns, hooks); a hand-made row is a
--     half-made account that may break sign-in or a future Auth upgrade.
--   * Calling the edge function from a trigger needs pg_net plus a stored
--     secret, and pg_net is fire-and-forget: the staff insert would commit
--     even when the call failed, with nobody told.
--   * So rows added outside the app (dashboard, SQL, REST) are covered by
--     staff_missing_auth() below: the Members page lists them and one click
--     on Fix sign-in runs the edge function's 'repair'.
--
-- staff_audit_log needs no change: it has no CHECK on action. The edge
-- function writes two new actions there, 'auth_user_created' (one per
-- account) and 'auth_repair' (one per Fix sign-in run). Only
-- 'auth_user_created' feeds its rate limit (index below): about 60 new
-- accounts per admin per hour, 200 overall; not strictly atomic under
-- parallel requests, bounded by number of staff rows missing an account.
-- Labels: STAFF_AUDIT_VERBS in app.jsx.
--
-- Safe to re-run.

create or replace function public.staff_missing_auth()
returns table (email text, name text, role text)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
#variable_conflict use_column
begin
  if not public.is_active_staff_admin() then
    raise exception 'staff_missing_auth: admins only'
      using errcode = '42501';
  end if;
  return query
    select s.email, s.name, s.role
      from public.staff s
     where s.active = true
       and not exists (
         select 1 from auth.users u
          where lower(u.email) = lower(s.email)
       )
     order by lower(coalesce(s.name, s.email));
end;
$$;

revoke all on function public.staff_missing_auth() from public, anon;
grant execute on function public.staff_missing_auth() to authenticated;

-- The edge function's rate limit counts rows by actor + action + time.
create index if not exists staff_audit_log_actor_action_time_idx
  on public.staff_audit_log (actor_email, action, created_at desc);

-- Read-only report (run as postgres in the SQL editor; changes nothing):
--
--   select s.email, s.name, s.role
--     from public.staff s
--    where s.active
--      and not exists (select 1 from auth.users u
--                       where lower(u.email) = lower(s.email))
--    order by s.email;
