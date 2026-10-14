-- Client tools: stamp note and comment authors on the server, and lock
-- client contacts' names and emails to admins (2026-10-14)
-- Applied to production 2026-10-14.
--
-- Follow-up to client-messages-author-stamp.sql (same pattern).
--
-- Bug 1: four tables took the author's email and display name from the
-- browser. RLS decides whether someone may write the row, never whose name
-- goes on it, so a staff member (or, on the Pro budget tables, a client
-- user) could post under anyone's name:
--   client_internal_notes        author_email / author_name  (staff only)
--   client_budget_comments       author_email / author_name  (staff + client)
--   client_variance_notes        author_email / author_name  (staff + client;
--                                shared with the client, carried into reports)
--   client_budget_draft_history  changed_by / changed_by_name (staff + client;
--                                "Changes requested by ..." on the budget page)
-- Writers (verified 2026-10-14): only the browser (app.jsx staffToolsApi,
-- components/pro/ProBudget.jsx). No edge function or database function
-- writes these tables.
--
-- Fix: BEFORE INSERT OR UPDATE trigger client_tools_stamp_author.
--   - Signed in (a JWT email, or JWT role authenticated/anon):
--       email := the JWT email;
--       name  := staff.name when that email is staff (canonical, see
--                staff-name-canonical.sql; a staff email always wins, even
--                if staff added a client_users row for it), else the
--                client_users.name for that client_id, else
--                staff without a name -> the email, client without a name
--                -> null (the screens then show the email).
--     Whatever the browser sent is overwritten, never rejected, so cached
--     old tabs that still send it keep working.
--   - Not signed in (service role, SQL editor, cron): the supplied values
--     are kept (trusted backend).
--   - UPDATE: author fields can't change (old values are kept), for every
--     caller. One exception: client_variance_notes is an upsert whose
--     author means "who wrote this text", so when a signed-in user changes
--     the note text (or moves it) the author is re-stamped from the JWT;
--     otherwise the old author stays.
--   - Grants: authenticated loses UPDATE on client_internal_notes and
--     client_budget_comments (the app only inserts and deletes; this stops
--     one person rewriting another person's note body under their name),
--     and TRUNCATE / TRIGGER / REFERENCES on all four tables.
--   - Existing rows are not touched.
--
-- Bug 2: any staff member with access to a client could UPDATE that
-- client's client_users rows directly (RLS "staff update assigned client
-- users"), including name, email and client_id (moving a person into
-- another client they also work on). The app never edits either (the
-- Client roster only adds, removes, toggles active and edits scope), but
-- through the API a staffer could rename a real contact or swap a
-- contact's email for an address they control and then sign in as that
-- contact, and the 40fe147 stamp would faithfully show the contact's name.
-- The activity log recorded the update without the name or email change.
-- Fix: BEFORE UPDATE trigger client_users_guard_identity: only an active
-- admin (or a trusted backend with no JWT) may change name, email or
-- client_id; anyone else gets an error. log_client_user_change now also
-- records old/new name, old email and old client_id on 'access_updated'.
-- anon loses write grants on client_users. Adding a brand-new contact is
-- unchanged (that is the roster flow). It is logged as 'access_granted',
-- but through the invite-client-user edge function (service role) the
-- actor shows as 'System' and only the separate 'portal_invite_sent' row
-- names the staffer. Restricting who may add contacts is left as an owner
-- decision.
--
-- Depends on (verified live 2026-10-14): public.client_internal_notes
-- (staff-client-tools.sql), public.client_budget_comments,
-- public.client_variance_notes, public.client_budget_draft_history
-- (pro-budget-reports.sql), public.staff (email, name), public.client_users
-- (email, client_id, name, role, active, access, tabs, categories, funds,
-- premium_throttled), public.client_activity_log and
-- public.log_client_user_change (client-activity-log.sql,
-- client-users-scoping-update.sql), public.is_active_staff_admin(),
-- auth.jwt().
-- Safe to re-run.

begin;

-- ---------------------------------------------------------------------------
-- 1. Author stamp for the four client-tool tables
-- ---------------------------------------------------------------------------
create or replace function public.client_tools_stamp_author()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_jwt_email text := nullif(btrim(auth.jwt() ->> 'email'), '');
  v_jwt_role text := coalesce(auth.jwt() ->> 'role', '');
  v_signed_in boolean;
  v_history boolean := tg_table_name = 'client_budget_draft_history';
  v_old_email text;
  v_old_name text;
  v_email text;
  v_name text;
  v_is_staff boolean;
  v_restamp boolean := false;
begin
  if tg_table_name not in ('client_internal_notes', 'client_budget_comments',
                           'client_variance_notes', 'client_budget_draft_history') then
    raise exception 'client_tools_stamp_author: unexpected table %', tg_table_name;
  end if;
  v_signed_in := v_jwt_email is not null or v_jwt_role in ('authenticated', 'anon');

  if tg_op = 'UPDATE' then
    if v_history then
      v_old_email := old.changed_by;
      v_old_name := old.changed_by_name;
    else
      v_old_email := old.author_email;
      v_old_name := old.author_name;
    end if;
    -- (Nested IF: plpgsql resolves new.note even when the table test is false.)
    if tg_table_name = 'client_variance_notes' and v_signed_in then
      v_restamp := (new.note, new.category, new.period, new.client_id)
                   is distinct from (old.note, old.category, old.period, old.client_id);
    end if;
    if not v_restamp then
      if v_history then
        new.changed_by := v_old_email;
        new.changed_by_name := v_old_name;
      else
        new.author_email := v_old_email;
        new.author_name := v_old_name;
      end if;
      return new;
    end if;
  end if;

  if v_signed_in then
    v_email := v_jwt_email;
    if v_email is not null then
      select true, nullif(btrim(s.name), '') into v_is_staff, v_name
        from staff s
       where lower(s.email) = lower(v_email)
       order by (s.email = v_email) desc
       limit 1;
      if coalesce(v_is_staff, false) then
        v_name := coalesce(v_name, v_email);
      elsif tg_table_name <> 'client_internal_notes' then
        select nullif(btrim(cu.name), '') into v_name
          from client_users cu
         where lower(cu.email) = lower(v_email)
           and cu.client_id = new.client_id
         order by (cu.email = v_email) desc
         limit 1;
      end if;
    end if;
  else
    if v_history then
      v_email := new.changed_by;
      v_name := new.changed_by_name;
    else
      v_email := new.author_email;
      v_name := new.author_name;
    end if;
  end if;

  v_name := left(v_name, 120);
  if v_history then
    new.changed_by := v_email;
    new.changed_by_name := v_name;
  else
    new.author_email := v_email;
    new.author_name := v_name;
  end if;
  return new;
end;
$$;

-- Trigger functions never check the caller's EXECUTE privilege; revoking it
-- just removes the PostgREST RPC surface (see audit-hardening-function-grants.sql).
revoke all on function public.client_tools_stamp_author() from public, anon, authenticated;

drop trigger if exists client_tools_stamp_author on public.client_internal_notes;
create trigger client_tools_stamp_author
  before insert or update on public.client_internal_notes
  for each row execute function public.client_tools_stamp_author();

drop trigger if exists client_tools_stamp_author on public.client_budget_comments;
create trigger client_tools_stamp_author
  before insert or update on public.client_budget_comments
  for each row execute function public.client_tools_stamp_author();

drop trigger if exists client_tools_stamp_author on public.client_variance_notes;
create trigger client_tools_stamp_author
  before insert or update on public.client_variance_notes
  for each row execute function public.client_tools_stamp_author();

drop trigger if exists client_tools_stamp_author on public.client_budget_draft_history;
create trigger client_tools_stamp_author
  before insert or update on public.client_budget_draft_history
  for each row execute function public.client_tools_stamp_author();

-- Grant hardening. The app never updates internal notes or budget comments.
revoke update on public.client_internal_notes from authenticated;
revoke update on public.client_budget_comments from authenticated;
revoke truncate, trigger, references on public.client_internal_notes from anon, authenticated;
revoke truncate, trigger, references on public.client_budget_comments from anon, authenticated;
revoke truncate, trigger, references on public.client_variance_notes from anon, authenticated;
revoke truncate, trigger, references on public.client_budget_draft_history from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. client_users: only admins (or a trusted backend) change name or email
-- ---------------------------------------------------------------------------
create or replace function public.client_users_guard_identity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_jwt_email text := nullif(btrim(auth.jwt() ->> 'email'), '');
  v_jwt_role text := coalesce(auth.jwt() ->> 'role', '');
begin
  if (new.email is distinct from old.email or new.name is distinct from old.name
      or new.client_id is distinct from old.client_id)
     and (v_jwt_email is not null or v_jwt_role in ('authenticated', 'anon'))
     and not public.is_active_staff_admin() then
    raise exception 'Only an admin can change a client contact''s name, email or organization. Ask an admin to change it.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.client_users_guard_identity() from public, anon, authenticated;

drop trigger if exists client_users_guard_identity on public.client_users;
create trigger client_users_guard_identity
  before update on public.client_users
  for each row execute function public.client_users_guard_identity();

-- Same as the live version (client-users-scoping-update.sql) plus
-- old/new name, old email and old client_id on 'access_updated'.
create or replace function public.log_client_user_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor text := auth.jwt() ->> 'email';
begin
  if (tg_op = 'INSERT') then
    insert into client_activity_log (client_id, actor_email, actor_name, action, detail)
    values (
      new.client_id,
      actor,
      coalesce(actor, 'System'),
      'access_granted',
      jsonb_build_object('email', new.email, 'name', new.name, 'role', new.role)
    );
  elsif (tg_op = 'UPDATE') then
    insert into client_activity_log (client_id, actor_email, actor_name, action, detail)
    values (
      new.client_id,
      actor,
      coalesce(actor, 'System'),
      'access_updated',
      jsonb_strip_nulls(jsonb_build_object(
        'email', new.email,
        'old_role', old.role,
        'new_role', new.role,
        'old_active', old.active,
        'new_active', new.active
      ))
      || case when new.email is distinct from old.email
           then jsonb_build_object('old_email', old.email)
           else '{}'::jsonb end
      || case when new.client_id is distinct from old.client_id
           then jsonb_build_object('old_client_id', old.client_id)
           else '{}'::jsonb end
      || case when new.name is distinct from old.name
           then jsonb_build_object('old_name', old.name, 'new_name', new.name)
           else '{}'::jsonb end
      || case when new.access is distinct from old.access
           then jsonb_build_object('old_access', old.access, 'new_access', new.access)
           else '{}'::jsonb end
      || case when new.tabs is distinct from old.tabs
           then jsonb_build_object('old_tabs', to_jsonb(old.tabs), 'new_tabs', to_jsonb(new.tabs))
           else '{}'::jsonb end
      || case when new.categories is distinct from old.categories
           then jsonb_build_object('old_categories', to_jsonb(old.categories), 'new_categories', to_jsonb(new.categories))
           else '{}'::jsonb end
      || case when new.funds is distinct from old.funds
           then jsonb_build_object('old_funds', to_jsonb(old.funds), 'new_funds', to_jsonb(new.funds))
           else '{}'::jsonb end
      || case when new.premium_throttled is distinct from old.premium_throttled
           then jsonb_build_object('old_premium_throttled', old.premium_throttled,
                                   'new_premium_throttled', new.premium_throttled)
           else '{}'::jsonb end
    );
  elsif (tg_op = 'DELETE') then
    insert into client_activity_log (client_id, actor_email, actor_name, action, detail)
    values (
      old.client_id,
      actor,
      coalesce(actor, 'System'),
      'access_revoked',
      jsonb_build_object('email', old.email, 'name', old.name, 'role', old.role)
    );
  end if;
  return coalesce(new, old);
end;
$$;

revoke all on function public.log_client_user_change() from public, anon, authenticated;

-- Grant hardening: anon never writes client contacts (every write policy
-- needs a signed-in staff or admin), and nobody needs TRUNCATE / TRIGGER /
-- REFERENCES through the API roles.
revoke insert, update, delete on public.client_users from anon;
revoke truncate, trigger, references on public.client_users from anon, authenticated;

commit;
