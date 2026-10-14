-- Client contacts added through the invite flow: log the staff member, not
-- "System" (2026-10-14)
-- Applied to production 2026-10-14.
--
-- Follow-up to client-tools-author-stamp.sql. The invite-client-user edge
-- function writes client_users with the service role, so auth.jwt() has no
-- email and log_client_user_change() recorded the actor as 'System'. Owner
-- decision: record the staff member's email. Staff may still add contacts
-- (adding is NOT restricted to admins).
--
-- Mechanism: the edge function calls invite_write_client_user() (service_role
-- only) with the caller email it verified itself via auth.getUser(jwt), never
-- a value from the request body. The RPC re-checks that the email is an
-- active staff row, then sets the transaction-local setting mgb.actor_email
-- around the insert/activate. log_client_user_change() uses it ONLY when
-- there is no signed-in JWT (no email claim and role not authenticated/anon);
-- a signed-in browser session always logs its own JWT email, and nobody but
-- the service role can run the RPC. Direct service-role writes without the
-- RPC (SQL editor, cron) are unchanged: 'System'.
--
-- Depends on: public.client_users, public.client_activity_log,
-- public.log_client_user_change (client-tools-author-stamp.sql),
-- public.staff (email, active), auth.jwt().
-- Redeploy supabase/functions/invite-client-user (uses the RPC).
-- Safe to re-run.

begin;

create or replace function public.invite_write_client_user(
  p_actor_email text, p_email text, p_client_id text, p_name text, p_role text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor text := lower(nullif(btrim(p_actor_email), ''));
  v_n int;
begin
  if v_actor is null or not exists (
    select 1 from staff s where lower(s.email) = v_actor and s.active
  ) then
    raise exception 'invite_write_client_user: actor is not active staff' using errcode = '42501';
  end if;
  perform set_config('mgb.actor_email', v_actor, true);
  begin
    if exists (select 1 from client_users where email = p_email) then
      update client_users set active = true where email = p_email and client_id = p_client_id;
      get diagnostics v_n = row_count;
      if v_n = 0 then
        raise exception 'invite_write_client_user: contact belongs to a different organization' using errcode = '23505';
      end if;
    else
      insert into client_users (email, client_id, name, role, active)
      values (p_email, p_client_id, p_name, p_role, true);
    end if;
  exception when others then
    perform set_config('mgb.actor_email', '', true);
    raise;
  end;
  perform set_config('mgb.actor_email', '', true);
end;
$$;

revoke all on function public.invite_write_client_user(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.invite_write_client_user(text, text, text, text, text) to service_role;

-- Same as client-tools-author-stamp.sql except for the actor line.
create or replace function public.log_client_user_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_jwt_email text := nullif(btrim(auth.jwt() ->> 'email'), '');
  v_jwt_role text := coalesce(auth.jwt() ->> 'role', '');
  actor text;
begin
  actor := v_jwt_email;
  if actor is null and v_jwt_role not in ('authenticated', 'anon') then
    actor := nullif(current_setting('mgb.actor_email', true), '');
  end if;
  if (tg_op = 'INSERT') then
    insert into client_activity_log (client_id, actor_email, actor_name, action, detail)
    values (new.client_id, actor, coalesce(actor, 'System'), 'access_granted',
      jsonb_build_object('email', new.email, 'name', new.name, 'role', new.role));
  elsif (tg_op = 'UPDATE') then
    insert into client_activity_log (client_id, actor_email, actor_name, action, detail)
    values (
      new.client_id, actor, coalesce(actor, 'System'), 'access_updated',
      jsonb_strip_nulls(jsonb_build_object(
        'email', new.email,
        'old_role', old.role,
        'new_role', new.role,
        'old_active', old.active,
        'new_active', new.active
      ))
      || case when new.email is distinct from old.email
           then jsonb_build_object('old_email', old.email) else '{}'::jsonb end
      || case when new.client_id is distinct from old.client_id
           then jsonb_build_object('old_client_id', old.client_id) else '{}'::jsonb end
      || case when new.name is distinct from old.name
           then jsonb_build_object('old_name', old.name, 'new_name', new.name) else '{}'::jsonb end
      || case when new.access is distinct from old.access
           then jsonb_build_object('old_access', old.access, 'new_access', new.access) else '{}'::jsonb end
      || case when new.tabs is distinct from old.tabs
           then jsonb_build_object('old_tabs', to_jsonb(old.tabs), 'new_tabs', to_jsonb(new.tabs)) else '{}'::jsonb end
      || case when new.categories is distinct from old.categories
           then jsonb_build_object('old_categories', to_jsonb(old.categories), 'new_categories', to_jsonb(new.categories)) else '{}'::jsonb end
      || case when new.funds is distinct from old.funds
           then jsonb_build_object('old_funds', to_jsonb(old.funds), 'new_funds', to_jsonb(new.funds)) else '{}'::jsonb end
      || case when new.premium_throttled is distinct from old.premium_throttled
           then jsonb_build_object('old_premium_throttled', old.premium_throttled,
                                   'new_premium_throttled', new.premium_throttled) else '{}'::jsonb end
    );
  elsif (tg_op = 'DELETE') then
    insert into client_activity_log (client_id, actor_email, actor_name, action, detail)
    values (old.client_id, actor, coalesce(actor, 'System'), 'access_revoked',
      jsonb_build_object('email', old.email, 'name', old.name, 'role', old.role));
  end if;
  return coalesce(new, old);
end;
$$;

revoke all on function public.log_client_user_change() from public, anon, authenticated;

commit;
