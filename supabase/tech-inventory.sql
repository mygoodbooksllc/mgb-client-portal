-- Tech Inventory (owner request 2026-10-08). Replaces the Apps Script tool.
-- Staff: request hardware, log/remove their own assets. Admins: everything.
-- Re-runnable.

create table if not exists public.tech_requests (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  staff_email text not null,
  item text not null,
  reason text,
  priority text not null default 'Normal' check (priority in ('Low', 'Normal', 'High')),
  status text not null default 'Open' check (status in ('Open', 'Ordered', 'Fulfilled', 'Declined'))
);

create table if not exists public.tech_assets (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  staff_email text not null,
  category text not null,
  item text not null,
  serial text,
  condition text not null default 'Good' check (condition in ('New', 'Good', 'Fair', 'Poor', 'Broken')),
  date_received date,
  notes text
);

create table if not exists public.tech_setup (
  id bigint generated always as identity primary key,
  sort int not null default 0,
  item text not null,
  link text,
  price numeric(10, 2),
  essential boolean not null default true
);

alter table public.tech_requests enable row level security;
alter table public.tech_assets enable row level security;
alter table public.tech_setup enable row level security;

drop policy if exists tech_requests_select on public.tech_requests;
create policy tech_requests_select on public.tech_requests for select to authenticated
  using (public.is_active_staff_admin() or (public.is_active_staff() and lower(staff_email) = lower(auth.jwt() ->> 'email')));
drop policy if exists tech_requests_insert on public.tech_requests;
create policy tech_requests_insert on public.tech_requests for insert to authenticated
  with check (public.is_active_staff() and lower(staff_email) = lower(auth.jwt() ->> 'email') and status = 'Open');
drop policy if exists tech_requests_admin on public.tech_requests;
create policy tech_requests_admin on public.tech_requests for all to authenticated
  using (public.is_active_staff_admin()) with check (public.is_active_staff_admin());

drop policy if exists tech_assets_select on public.tech_assets;
create policy tech_assets_select on public.tech_assets for select to authenticated
  using (public.is_active_staff_admin() or (public.is_active_staff() and lower(staff_email) = lower(auth.jwt() ->> 'email')));
drop policy if exists tech_assets_insert on public.tech_assets;
create policy tech_assets_insert on public.tech_assets for insert to authenticated
  with check (public.is_active_staff() and lower(staff_email) = lower(auth.jwt() ->> 'email'));
drop policy if exists tech_assets_delete_own on public.tech_assets;
create policy tech_assets_delete_own on public.tech_assets for delete to authenticated
  using (public.is_active_staff() and lower(staff_email) = lower(auth.jwt() ->> 'email'));
drop policy if exists tech_assets_admin on public.tech_assets;
create policy tech_assets_admin on public.tech_assets for all to authenticated
  using (public.is_active_staff_admin()) with check (public.is_active_staff_admin());

drop policy if exists tech_setup_select on public.tech_setup;
create policy tech_setup_select on public.tech_setup for select to authenticated using (public.is_active_staff());
drop policy if exists tech_setup_admin on public.tech_setup;
create policy tech_setup_admin on public.tech_setup for all to authenticated
  using (public.is_active_staff_admin()) with check (public.is_active_staff_admin());

grant select, insert, update, delete on public.tech_requests, public.tech_assets, public.tech_setup to authenticated;

insert into public.tech_setup (sort, item, essential)
select * from (values
  (1, 'Mac Neo', true), (2, 'Standing Desk', true), (3, 'Desk', true), (4, 'Desk Chair', true),
  (5, 'Chair Mat', true), (6, 'Monitor', true), (7, 'Mount', true), (8, 'USB Hub', true),
  (9, 'Desk Pad', false), (10, 'Surge Protector', false), (11, 'Wrist Rest Support', false)
) v(sort, item, essential)
where not exists (select 1 from public.tech_setup);
