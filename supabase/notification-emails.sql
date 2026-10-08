-- Notification emails behind the Settings > Notifications toggles (owner
-- request 2026-09-30). Applied to production 2026-09-30 as migration
-- notification_emails.
--
-- Safe to re-run. Needs client-emails.sql, user-settings.sql,
-- client-messages.sql, client-documents.sql, staff-reminders-v2.sql,
-- staff-feedback.sql, month-close.sql and cron-shared-secret.sql first.
--
-- How it works
--   * Database triggers drop a row in public.notification_outbox when
--     something worth an email happens. Nothing is emailed from inside a
--     trigger, so a slow or failing email provider can never block a write.
--   * The notification-emails edge function (cron every 5 minutes) reads the
--     unprocessed rows, groups them per person and kind, checks that person's
--     preference in user_settings.settings.notify.email, and sends one email
--     per group through Resend (supabase/functions/_shared/email.ts). Each
--     attempt is logged in client_email_log (feature = the kind below), so it
--     shows on the Emails page with the other client emails. A daily run
--     (job "task_due", 11:30 UTC) emails each person the tasks due today.
--
-- Kinds (recipient, trigger, Settings key)
--   staff_client_message   assigned staff     client posts a message        email.client_message
--                          (2026-10-04: account-manager.sql replaces notify_enqueue_message:
--                          the account manager only, plus bookkeeper loop-ins and @mentions)
--   staff_doc_upload       assigned staff     doc request -> uploaded       email.doc_upload
--   staff_task_assigned    the assignee       task assigned by another      email.task_assigned
--                                             staffer (insert or reassign)
--   staff_task_due         the assignee       daily cron, due today         email.task_due
--   staff_feedback_status  the author         admin changes feedback status email.feedback_status
--   staff_tech_request     admin@mygoodbooks  new Team › Tech request       (always; trigger in
--                          .org (not a login)                               tech-inventory-v2.sql)
--   client_message         the client person  staff replies in their thread email.bookkeeper_message
--   client_reports_ready   active portal      month-end close marked Done   email.reports_ready
--                          users of the org
--
-- Client kinds also honor the admin master switch (client_email_settings
-- .enabled), the org's opt_out_all, each person's unsubscribe link, and
-- test_only clients (never emailed). Email bodies never include message
-- text, amounts, fees or rates: they say what happened and link to the portal.

-- ---------------------------------------------------------------------------
-- 1. Outbox (service role only)
-- ---------------------------------------------------------------------------
create table if not exists public.notification_outbox (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  kind text not null check (kind in (
    'staff_client_message', 'staff_doc_upload', 'staff_task_assigned',
    'staff_feedback_status', 'client_message', 'client_reports_ready',
    'staff_tech_request'
  )),
  recipient_email text not null check (recipient_email = lower(recipient_email)),
  client_id text,
  ref_id text,
  payload jsonb not null default '{}'::jsonb check (pg_column_size(payload) <= 4096),
  processed_at timestamptz,
  status text check (status is null or status in ('sent', 'skipped', 'not_configured', 'error')),
  reason text
);
create index if not exists notification_outbox_pending_idx
  on public.notification_outbox (created_at) where processed_at is null;
alter table public.notification_outbox enable row level security;
revoke all on public.notification_outbox from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The email log accepts the new kinds
-- ---------------------------------------------------------------------------
alter table public.client_email_log drop constraint if exists client_email_log_feature_check;
alter table public.client_email_log add constraint client_email_log_feature_check
  check (feature in (
    'doc_chaser', 'value_report',
    'staff_client_message', 'staff_doc_upload', 'staff_task_assigned', 'staff_task_due',
    'staff_feedback_status', 'client_message', 'client_reports_ready', 'staff_tech_request'
  ));

-- ---------------------------------------------------------------------------
-- 3. Triggers
-- ---------------------------------------------------------------------------
create or replace function public.notify_enqueue_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.internal then
    return null;
  end if;
  if new.author_kind = 'client' then
    insert into notification_outbox (kind, recipient_email, client_id, ref_id, payload)
    select 'staff_client_message', lower(sca.staff_email), new.client_id, new.id::text,
           jsonb_build_object('author_name', left(coalesce(new.author_name, new.author_email), 120))
    from staff_client_access sca
    join staff s on lower(s.email) = lower(sca.staff_email) and s.active
    where sca.client_id = new.client_id;
  elsif new.author_kind = 'staff' and new.participant_email is not null then
    insert into notification_outbox (kind, recipient_email, client_id, ref_id, payload)
    values ('client_message', lower(new.participant_email), new.client_id, new.id::text,
            jsonb_build_object('author_name', left(coalesce(new.author_name, 'Your bookkeeper'), 120)));
  end if;
  return null;
end;
$$;
revoke execute on function public.notify_enqueue_message() from public, anon, authenticated;
drop trigger if exists notify_enqueue_message on public.client_messages;
create trigger notify_enqueue_message
  after insert on public.client_messages
  for each row execute function public.notify_enqueue_message();

create or replace function public.notify_enqueue_doc_upload()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'uploaded' and old.status is distinct from 'uploaded' then
    insert into notification_outbox (kind, recipient_email, client_id, ref_id, payload)
    select 'staff_doc_upload', lower(sca.staff_email), new.client_id, new.id::text,
           jsonb_build_object('title', left(new.title, 200))
    from staff_client_access sca
    join staff s on lower(s.email) = lower(sca.staff_email) and s.active
    where sca.client_id = new.client_id;
  end if;
  return null;
end;
$$;
revoke execute on function public.notify_enqueue_doc_upload() from public, anon, authenticated;
drop trigger if exists notify_enqueue_doc_upload on public.client_doc_requests;
create trigger notify_enqueue_doc_upload
  after update of status on public.client_doc_requests
  for each row execute function public.notify_enqueue_doc_upload();

-- Assigned by a different, active staff member (not by the task-template
-- cron, an access request, or yourself).
create or replace function public.notify_enqueue_task_assigned()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_by text := lower(coalesce(nullif(auth.jwt() ->> 'email', ''), new.created_by, ''));
  v_by_name text;
begin
  if new.done or new.assignee_email is null then
    return null;
  end if;
  if tg_op = 'UPDATE' and lower(new.assignee_email) is not distinct from lower(old.assignee_email) then
    return null;
  end if;
  if coalesce(new.source, 'manual') = 'access_request' then
    return null;
  end if;
  if v_by = '' or v_by = lower(new.assignee_email) then
    return null;
  end if;
  select name into v_by_name from staff where lower(email) = v_by and active;
  if v_by_name is null then
    return null;
  end if;
  insert into notification_outbox (kind, recipient_email, client_id, ref_id, payload)
  values ('staff_task_assigned', lower(new.assignee_email), new.client_id, new.id::text,
          jsonb_build_object('text', left(new.text, 200), 'due_date', new.due_date, 'by', v_by_name));
  return null;
end;
$$;
revoke execute on function public.notify_enqueue_task_assigned() from public, anon, authenticated;
drop trigger if exists notify_enqueue_task_assigned on public.staff_reminders;
create trigger notify_enqueue_task_assigned
  after insert or update of assignee_email on public.staff_reminders
  for each row execute function public.notify_enqueue_task_assigned();

create or replace function public.notify_enqueue_feedback_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status and new.author_email is not null then
    insert into notification_outbox (kind, recipient_email, ref_id, payload)
    values ('staff_feedback_status', lower(new.author_email), new.id::text,
            jsonb_build_object('status', new.status, 'kind', new.kind,
                               'message', left(new.message, 160),
                               'note', left(new.admin_note, 400)));
  end if;
  return null;
end;
$$;
revoke execute on function public.notify_enqueue_feedback_status() from public, anon, authenticated;
drop trigger if exists notify_enqueue_feedback_status on public.staff_feedback;
create trigger notify_enqueue_feedback_status
  after update of status on public.staff_feedback
  for each row execute function public.notify_enqueue_feedback_status();

create or replace function public.notify_enqueue_reports_ready()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'done' and (tg_op = 'INSERT' or old.status is distinct from 'done') then
    insert into notification_outbox (kind, recipient_email, client_id, ref_id, payload)
    select 'client_reports_ready', lower(cu.email), new.client_id,
           new.client_id || ':' || new.period::text,
           jsonb_build_object('period', new.period)
    from client_users cu
    where cu.client_id = new.client_id and cu.active;
  end if;
  return null;
end;
$$;
revoke execute on function public.notify_enqueue_reports_ready() from public, anon, authenticated;
drop trigger if exists notify_enqueue_reports_ready on public.month_close;
create trigger notify_enqueue_reports_ready
  after insert or update of status on public.month_close
  for each row execute function public.notify_enqueue_reports_ready();

-- ---------------------------------------------------------------------------
-- 4. Schedules (same pattern as client_emails_cron)
-- ---------------------------------------------------------------------------
create or replace function public.notification_emails_cron(p_job text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  v_key text;
begin
  if p_job not in ('outbox', 'task_due') then
    raise exception 'unknown job %', p_job;
  end if;
  -- Nothing queued: skip the HTTP call entirely.
  if p_job = 'outbox' and not exists (select 1 from notification_outbox where processed_at is null) then
    return;
  end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'qbo_cron_key' limit 1;
  if v_key is null then
    raise warning 'notification_emails_cron: qbo_cron_key missing from vault';
    return;
  end if;
  perform net.http_post(
    url := 'https://xumsqmhccgfjnlmieqyu.supabase.co/functions/v1/notification-emails',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := jsonb_build_object('job', p_job, 'trigger', 'cron'),
    timeout_milliseconds := 60000
  );
end $$;
revoke all on function public.notification_emails_cron(text) from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname in ('notification-emails', 'notification-task-due');
select cron.schedule('notification-emails', '*/5 * * * *', $$select public.notification_emails_cron('outbox');$$);
select cron.schedule('notification-task-due', '30 11 * * *', $$select public.notification_emails_cron('task_due');$$);
