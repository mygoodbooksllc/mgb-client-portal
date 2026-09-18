-- Per-client activity/audit trail: "who touched what and when" for a given
-- client, for handoffs when a bookkeeper changes and for catching mistakes
-- ("did someone actually update this budget, and when"). Distinct from
-- staff_audit_log (staff-audit-log.sql), which logs changes to the `staff`
-- roster itself, not per-client actions.
--
-- Trigger-based, mirroring staff_audit_log's pattern: a SECURITY DEFINER
-- trigger function per source table inserts a row here, so every change is
-- captured regardless of how it was made (the app, the Supabase dashboard, a
-- future script) instead of relying on every write site in app.jsx to
-- remember to log itself.
--
-- Builds on staff-schema.sql / access-requests.sql (is_active_staff()) and
-- staff-client-access.sql (staff_client_access, for scoping bookkeeper
-- reads). Run those first.
--
-- Run this once in the Supabase SQL editor, or via the Supabase MCP's
-- apply_migration.

create table if not exists client_activity_log (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  actor_email text,
  actor_name text,
  action text not null,
  detail jsonb,
  created_at timestamptz not null default now()
);

create index if not exists client_activity_log_client_id_idx
  on client_activity_log (client_id, created_at desc);

alter table client_activity_log enable row level security;

-- Read: admins see every client's log; bookkeepers only the logs of clients
-- assigned to them in staff_client_access, same scoping app.jsx already
-- applies to what clients a bookkeeper can see at all (staff-client-access.sql).
drop policy if exists "staff can read client activity log" on client_activity_log;
create policy "staff can read client activity log"
  on client_activity_log for select
  using (
    public.is_active_staff_admin()
    or exists (
      select 1 from staff_client_access sca
      where sca.client_id = client_activity_log.client_id
        and sca.staff_email = auth.jwt() ->> 'email'
    )
  );

-- Deliberately no insert/update/delete policy for regular callers — only the
-- SECURITY DEFINER trigger functions below write to this table. Revoke
-- write grants explicitly so even an admin can't edit or clear history from
-- the browser (RLS with no policy already blocks it, but this belt-and-
-- suspenders matches staff_audit_log's stance).
revoke insert, update, delete on client_activity_log from anon, authenticated;

-- ----------------------------------------------------------------------------
-- client_documents: upload / remove
-- ----------------------------------------------------------------------------

create or replace function public.log_client_document_change()
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
      'document_added',
      jsonb_build_object('name', new.name, 'category', new.category)
    );
  elsif (tg_op = 'DELETE') then
    insert into client_activity_log (client_id, actor_email, actor_name, action, detail)
    values (
      old.client_id,
      actor,
      coalesce(actor, 'System'),
      'document_removed',
      jsonb_build_object('name', old.name, 'category', old.category)
    );
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists client_documents_activity_trigger on client_documents;
create trigger client_documents_activity_trigger
  after insert or delete on client_documents
  for each row execute function public.log_client_document_change();

-- ----------------------------------------------------------------------------
-- client_users: access grants changed
-- ----------------------------------------------------------------------------

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
      jsonb_build_object(
        'email', new.email,
        'old_role', old.role,
        'new_role', new.role,
        'old_active', old.active,
        'new_active', new.active
      )
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

drop trigger if exists client_users_activity_trigger on client_users;
create trigger client_users_activity_trigger
  after insert or update or delete on client_users
  for each row execute function public.log_client_user_change();

-- ----------------------------------------------------------------------------
-- qbo_connections: status changes (connect / disconnect / error)
-- ----------------------------------------------------------------------------

create or replace function public.log_qbo_connection_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor text := auth.jwt() ->> 'email';
begin
  if (tg_op = 'UPDATE' and old.status is distinct from new.status) then
    insert into client_activity_log (client_id, actor_email, actor_name, action, detail)
    values (
      new.client_id,
      actor,
      coalesce(actor, 'System'),
      'qbo_status_changed',
      jsonb_build_object(
        'old_status', old.status,
        'new_status', new.status,
        'last_error', new.last_error
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists qbo_connections_activity_trigger on qbo_connections;
create trigger qbo_connections_activity_trigger
  after update on qbo_connections
  for each row execute function public.log_qbo_connection_change();

-- ----------------------------------------------------------------------------
-- client_notes: shared scratchpad edits (if that table exists yet — it's
-- built by a concurrent agent's client-notes.sql; skip gracefully if not).
-- ----------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from information_schema.tables where table_name = 'client_notes') then
    execute $trigger$
      create or replace function public.log_client_note_change()
      returns trigger
      language plpgsql
      security definer
      set search_path = public
      as $func$
      declare
        actor text := auth.jwt() ->> 'email';
      begin
        insert into client_activity_log (client_id, actor_email, actor_name, action, detail)
        values (
          coalesce(new.client_id, old.client_id),
          actor,
          coalesce(actor, 'System'),
          'note_updated',
          jsonb_build_object('note', coalesce(new.note, old.note))
        );
        return coalesce(new, old);
      end;
      $func$;

      drop trigger if exists client_notes_activity_trigger on client_notes;
      create trigger client_notes_activity_trigger
        after insert or update or delete on client_notes
        for each row execute function public.log_client_note_change();
    $trigger$;
  end if;
end;
$$;
