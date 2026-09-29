-- Staff capacity (owner request 2026-09-29).
--
-- Applied to production 2026-09-29 as migration staff_capacity. RLS verified
-- in a rolled-back transaction: admin read/write OK; bookkeeper and anon
-- read 0 rows and every write is refused (42501).
-- Safe to re-run.
--
-- staff_capacity  weekly target hours per staff member (default 35). The
--                 Team page capacity view and the Staff Access workload hints
--                 compare QuickBooks Time hours against it, and the weekly
--                 digest agent reads it. Keep the table and column names.
--
-- ADMIN-ONLY: admins read and write; bookkeepers can't see it.

begin;

create table if not exists public.staff_capacity (
  staff_email text primary key check (staff_email = lower(staff_email)),
  weekly_target_hours numeric(5, 2) not null default 35
    check (weekly_target_hours >= 0 and weekly_target_hours <= 100),
  updated_by text,
  updated_at timestamptz not null default now()
);
alter table public.staff_capacity enable row level security;
revoke all on public.staff_capacity from anon;
grant select, insert, update, delete on public.staff_capacity to authenticated;

drop policy if exists "admins read staff capacity" on public.staff_capacity;
create policy "admins read staff capacity" on public.staff_capacity
  for select to authenticated using ((select public.is_active_staff_admin()));
drop policy if exists "admins write staff capacity" on public.staff_capacity;
create policy "admins write staff capacity" on public.staff_capacity
  for insert to authenticated with check ((select public.is_active_staff_admin()));
drop policy if exists "admins update staff capacity" on public.staff_capacity;
create policy "admins update staff capacity" on public.staff_capacity
  for update to authenticated
  using ((select public.is_active_staff_admin())) with check ((select public.is_active_staff_admin()));
drop policy if exists "admins delete staff capacity" on public.staff_capacity;
create policy "admins delete staff capacity" on public.staff_capacity
  for delete to authenticated using ((select public.is_active_staff_admin()));

commit;
