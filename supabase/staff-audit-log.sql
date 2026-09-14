-- Audit trail for changes to the `staff` table, surfaced in the Staff
-- Access page as "Recent Activity". Builds on staff-schema.sql and
-- staff-admin-policies.sql — run both first (this reuses the
-- is_active_staff_admin() function the second one defines).
--
-- Logged automatically by a trigger on `staff`, not by the app itself, so
-- it captures every change regardless of how it was made (the Staff Access
-- UI, the Supabase dashboard, a future script) instead of only the ones the
-- app remembers to record.
--
-- Run this once in the Supabase SQL editor.

create table if not exists staff_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_email text,
  action text not null,
  target_email text not null,
  detail text,
  created_at timestamptz not null default now()
);

alter table staff_audit_log enable row level security;

drop policy if exists "admins can read audit log" on staff_audit_log;
create policy "admins can read audit log"
  on staff_audit_log for select
  using (public.is_active_staff_admin());

-- Deliberately no insert/update/delete policy for regular callers — only
-- the SECURITY DEFINER trigger function below writes to this table, so not
-- even an admin can edit or clear their own history from the browser.

create or replace function public.log_staff_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor text := auth.jwt() ->> 'email';
begin
  if (tg_op = 'INSERT') then
    insert into staff_audit_log (actor_email, action, target_email, detail)
    values (actor, 'added', new.email, new.role);
  elsif (tg_op = 'UPDATE') then
    if (old.role is distinct from new.role) then
      insert into staff_audit_log (actor_email, action, target_email, detail)
      values (actor, 'role_changed', new.email, old.role || ' -> ' || new.role);
    end if;
    if (old.active is distinct from new.active) then
      insert into staff_audit_log (actor_email, action, target_email, detail)
      values (
        actor,
        case when new.active then 'activated' else 'deactivated' end,
        new.email,
        null
      );
    end if;
  elsif (tg_op = 'DELETE') then
    insert into staff_audit_log (actor_email, action, target_email, detail)
    values (actor, 'removed', old.email, old.role);
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists staff_audit_trigger on staff;
create trigger staff_audit_trigger
  after insert or update or delete on staff
  for each row execute function public.log_staff_change();
