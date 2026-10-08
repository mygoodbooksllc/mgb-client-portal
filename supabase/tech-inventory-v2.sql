-- Tech Inventory v2 (owner 2026-10-08): match the portal. Run after
-- tech-inventory.sql. Re-runnable.
--
--   * Nothing is deleted: requests, items and setup rows are archived
--     (archived_at) and the delete grant is removed.
--   * Staff can edit or withdraw their own open requests and archive their
--     own items. Admins can do everything.
--   * staff_contact: the admin-only staff directory (phones, home address).
--     The portal's staff list is the source of truth for names and emails.
--   * A new request queues an email to admin@mygoodbooks.org
--     (notification_outbox kind staff_tech_request, sent by notification-emails).

alter table public.tech_requests add column if not exists archived_at timestamptz;
alter table public.tech_assets add column if not exists archived_at timestamptz;
alter table public.tech_setup add column if not exists archived_at timestamptz;

drop policy if exists tech_assets_delete_own on public.tech_assets;
drop policy if exists tech_assets_update_own on public.tech_assets;
create policy tech_assets_update_own on public.tech_assets for update to authenticated
  using (public.is_active_staff() and lower(staff_email) = lower(auth.jwt() ->> 'email'))
  with check (public.is_active_staff() and lower(staff_email) = lower(auth.jwt() ->> 'email'));
drop policy if exists tech_requests_update_own on public.tech_requests;
create policy tech_requests_update_own on public.tech_requests for update to authenticated
  using (public.is_active_staff() and lower(staff_email) = lower(auth.jwt() ->> 'email') and status = 'Open')
  with check (public.is_active_staff() and lower(staff_email) = lower(auth.jwt() ->> 'email') and status = 'Open');

revoke delete on public.tech_requests, public.tech_assets, public.tech_setup from authenticated;

-- Staff directory (admin only).
create table if not exists public.staff_contact (
  staff_email text primary key check (staff_email = lower(staff_email)),
  full_name text,
  personal_email text,
  work_phone text,
  home_phone text,
  mobile text,
  street text,
  city text,
  state text,
  zip text,
  updated_at timestamptz not null default now(),
  updated_by text
);
alter table public.staff_contact enable row level security;
drop policy if exists staff_contact_admin on public.staff_contact;
create policy staff_contact_admin on public.staff_contact for all to authenticated
  using (public.is_active_staff_admin()) with check (public.is_active_staff_admin());
grant select, insert, update on public.staff_contact to authenticated;
revoke delete on public.staff_contact from authenticated;

-- Request email to admin@mygoodbooks.org (also in notification-emails.sql).
alter table public.notification_outbox drop constraint if exists notification_outbox_kind_check;
alter table public.notification_outbox add constraint notification_outbox_kind_check check (kind in (
  'staff_client_message', 'staff_doc_upload', 'staff_task_assigned', 'staff_feedback_status',
  'client_message', 'client_reports_ready', 'staff_tech_request'
));
alter table public.client_email_log drop constraint if exists client_email_log_feature_check;
alter table public.client_email_log add constraint client_email_log_feature_check check (feature in (
  'doc_chaser', 'value_report', 'staff_client_message', 'staff_doc_upload', 'staff_task_assigned',
  'staff_task_due', 'staff_feedback_status', 'client_message', 'client_reports_ready', 'staff_tech_request'
));

create or replace function public.notify_enqueue_tech_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Imported history (older than a day) doesn't email anyone.
  if new.created_at < now() - interval '1 day' then
    return null;
  end if;
  insert into notification_outbox (kind, recipient_email, ref_id, payload)
  values ('staff_tech_request', 'admin@mygoodbooks.org', new.id::text, jsonb_build_object(
    'item', left(new.item, 200),
    'priority', new.priority,
    'reason', left(coalesce(new.reason, ''), 1000),
    'by', left(coalesce((select s.name from staff s where lower(s.email) = lower(new.staff_email) limit 1), new.staff_email), 120)
  ));
  return null;
end;
$$;
drop trigger if exists notify_enqueue_tech_request on public.tech_requests;
create trigger notify_enqueue_tech_request
  after insert on public.tech_requests
  for each row execute function public.notify_enqueue_tech_request();
