-- §171: let an assigned bookkeeper (not just an admin) manage the portal
-- contacts of a client they're assigned to, and record scoping changes in
-- the activity log. APPLIED LIVE via Supabase MCP apply_migration
-- (`client_users_scoping_update`). Kept here so the repo records it.
--
-- Before this, client_users' only staff policy was "admins can manage client
-- users" (FOR ALL, is_active_staff_admin() — client-users.sql). The §171
-- scoping editor lets a bookkeeper set a person's access/tabs/categories/
-- funds/premium_throttled from Manage Access, so the same
-- can_access_client() predicate every other per-client table now uses
-- (audit-hardening-client-scoping.sql) applies here too: assignment-scoped,
-- with admins still covered because can_access_client() short-circuits on
-- is_active_staff_admin().
--
-- Deliberately no delete policy for the bookkeeper tier — removing a contact
-- outright stays admin-only under the existing FOR ALL policy.

drop policy if exists "staff read assigned client users" on client_users;
create policy "staff read assigned client users"
  on client_users for select
  using (public.can_access_client(client_id));

drop policy if exists "staff insert assigned client users" on client_users;
create policy "staff insert assigned client users"
  on client_users for insert
  with check (public.can_access_client(client_id));

-- with_check on BOTH the old and new client_id: without it an assigned
-- bookkeeper could move a contact they control onto a client they aren't
-- assigned to (using = old row, with_check = new row).
drop policy if exists "staff update assigned client users" on client_users;
create policy "staff update assigned client users"
  on client_users for update
  using (public.can_access_client(client_id))
  with check (public.can_access_client(client_id));

-- The activity-log trigger (client-activity-log.sql) only recorded role and
-- active on an update, so every scoping change looked like a no-op edit in
-- the Activity tab. Widen the detail payload — same function name, same
-- trigger, so this is a drop-in replacement.
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
