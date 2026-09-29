-- ============================================================================
-- Client-facing emails: master controls, missing-documents chaser, monthly
-- value report (owner request 2026-09-29).
-- Applied to production 2026-09-29 as migrations client_emails (sections 1-5)
-- and client_email_unsubscribe (section 6).
--
-- Sender: supabase/functions/client-emails (uses _shared/email.ts / Resend).
-- Every real send checks, server-side, in this order:
--   1. client_email_settings.enabled            (global kill switch)
--   2. client_email_settings.<feature>_enabled  (doc_chaser / value_report)
--   3. client_email_prefs.opt_out_all / opt_out_<feature> for the client
--      (+ chaser_paused for the chaser)
--   4. clients.test_only (skipped, except an admin's "send test to me")
-- and every attempt (sent, skipped, not configured, error) is logged in
-- client_email_log.
--
-- Doc chaser builds on client_doc_requests (status 'open' = still waiting).
-- Per request: first reminder as soon as it's open, then 3 days later
-- (day 3), 4 days after that (day 7), then weekly. Stops as soon as the
-- request is no longer 'open' (uploaded / done / cancelled). One email per
-- client per day lists everything still outstanding.
--
-- Value report (default OFF): on the 3rd of each month, the previous month's
-- QuickBooks Time hours total, client-visible (shared) tasks completed,
-- month_close status and documents received. No fees, rates or margins.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Global settings (singleton). Admin read/update.
-- ---------------------------------------------------------------------------
create table if not exists public.client_email_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default true,
  doc_chaser_enabled boolean not null default true,
  value_report_enabled boolean not null default false,
  reply_to text default 'admin@mygoodbooks.org',
  updated_at timestamptz not null default now(),
  updated_by text
);
insert into public.client_email_settings (id) values (true) on conflict do nothing;

alter table public.client_email_settings enable row level security;
drop policy if exists "admins read client email settings" on public.client_email_settings;
create policy "admins read client email settings" on public.client_email_settings
  for select to authenticated using ((select public.is_active_staff_admin()));
drop policy if exists "admins update client email settings" on public.client_email_settings;
create policy "admins update client email settings" on public.client_email_settings
  for update to authenticated
  using ((select public.is_active_staff_admin()))
  with check ((select public.is_active_staff_admin()));

create or replace function public.client_email_settings_stamp()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.reply_to is not null then
    new.reply_to := lower(trim(new.reply_to));
    if new.reply_to = '' then new.reply_to := null;
    elsif new.reply_to !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      raise exception 'reply_to is not a valid email' using errcode = '22023';
    end if;
  end if;
  new.updated_at := now();
  new.updated_by := coalesce(nullif(auth.jwt() ->> 'email', ''), new.updated_by);
  return new;
end $$;
drop trigger if exists client_email_settings_stamp on public.client_email_settings;
create trigger client_email_settings_stamp before update on public.client_email_settings
  for each row execute function public.client_email_settings_stamp();

-- ---------------------------------------------------------------------------
-- 2. Per-client preferences. Staff with access to the client can read and
--    pause/resume the chaser; only admins can change the opt-outs.
-- ---------------------------------------------------------------------------
create table if not exists public.client_email_prefs (
  client_id text primary key references public.clients(id) on delete cascade,
  opt_out_all boolean not null default false,
  opt_out_doc_chaser boolean not null default false,
  opt_out_value_report boolean not null default false,
  chaser_paused boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by text
);

alter table public.client_email_prefs enable row level security;
drop policy if exists "staff read client email prefs" on public.client_email_prefs;
create policy "staff read client email prefs" on public.client_email_prefs
  for select to authenticated
  using ((select public.is_active_staff()) and public.can_access_client(client_id));
drop policy if exists "staff insert client email prefs" on public.client_email_prefs;
create policy "staff insert client email prefs" on public.client_email_prefs
  for insert to authenticated
  with check ((select public.is_active_staff()) and public.can_access_client(client_id));
drop policy if exists "staff update client email prefs" on public.client_email_prefs;
create policy "staff update client email prefs" on public.client_email_prefs
  for update to authenticated
  using ((select public.is_active_staff()) and public.can_access_client(client_id))
  with check ((select public.is_active_staff()) and public.can_access_client(client_id));

create or replace function public.client_email_prefs_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  -- Signed-in non-admins may only toggle chaser_paused.
  if coalesce(auth.role(), '') = 'authenticated' and not public.is_active_staff_admin() then
    if tg_op = 'INSERT' then
      if new.opt_out_all or new.opt_out_doc_chaser or new.opt_out_value_report then
        raise exception 'only admins can change email opt-outs' using errcode = '42501';
      end if;
    elsif new.opt_out_all is distinct from old.opt_out_all
       or new.opt_out_doc_chaser is distinct from old.opt_out_doc_chaser
       or new.opt_out_value_report is distinct from old.opt_out_value_report
       or new.client_id is distinct from old.client_id then
      raise exception 'only admins can change email opt-outs' using errcode = '42501';
    end if;
  end if;
  new.updated_at := now();
  new.updated_by := coalesce(nullif(auth.jwt() ->> 'email', ''), new.updated_by);
  return new;
end $$;
drop trigger if exists client_email_prefs_guard on public.client_email_prefs;
create trigger client_email_prefs_guard before insert or update on public.client_email_prefs
  for each row execute function public.client_email_prefs_guard();

-- ---------------------------------------------------------------------------
-- 3. Per-request chase state (written by the edge function only).
-- ---------------------------------------------------------------------------
create table if not exists public.client_doc_chase (
  request_id uuid primary key references public.client_doc_requests(id) on delete cascade,
  client_id text not null,
  reminders_sent int not null default 0,
  last_reminded_at timestamptz
);
create index if not exists client_doc_chase_client_idx on public.client_doc_chase (client_id);
alter table public.client_doc_chase enable row level security;
drop policy if exists "staff read doc chase" on public.client_doc_chase;
create policy "staff read doc chase" on public.client_doc_chase
  for select to authenticated
  using ((select public.is_active_staff()) and public.can_access_client(client_id));

-- ---------------------------------------------------------------------------
-- 4. Log of every client email attempt.
-- ---------------------------------------------------------------------------
create table if not exists public.client_email_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  feature text not null check (feature in ('doc_chaser', 'value_report')),
  trigger text not null check (trigger in ('cron', 'test', 'preview')),
  client_id text references public.clients(id) on delete set null,
  status text not null check (status in ('sent', 'skipped', 'not_configured', 'error', 'preview')),
  reason text,
  recipients text[],
  request_ids uuid[],
  period date,
  subject text,
  provider_id text,
  requested_by text
);
create index if not exists client_email_log_client_idx on public.client_email_log (client_id, created_at desc);
create index if not exists client_email_log_feature_idx on public.client_email_log (feature, created_at desc);
alter table public.client_email_log enable row level security;
drop policy if exists "staff read client email log" on public.client_email_log;
create policy "staff read client email log" on public.client_email_log
  for select to authenticated
  using ((select public.is_active_staff()) and (
    (select public.is_active_staff_admin()) or (client_id is not null and public.can_access_client(client_id))
  ));

-- ---------------------------------------------------------------------------
-- 5. Schedules. Same pattern as the qbo-firm-sync / digest crons: pg_net with
--    the Vault-held qbo_cron_key as bearer.
--    Doc chaser daily at 14:00 UTC (10 AM EDT / 9 AM EST).
--    Value report on the 3rd at 14:00 UTC (the function covers last month).
-- ---------------------------------------------------------------------------
create or replace function public.client_emails_cron(p_job text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  v_key text;
begin
  if p_job not in ('doc_chaser', 'value_report') then
    raise exception 'unknown job %', p_job;
  end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'qbo_cron_key' limit 1;
  if v_key is null then
    raise warning 'client_emails_cron: qbo_cron_key missing from vault';
    return;
  end if;
  perform net.http_post(
    url := 'https://xumsqmhccgfjnlmieqyu.supabase.co/functions/v1/client-emails',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := jsonb_build_object('job', p_job, 'trigger', 'cron'),
    timeout_milliseconds := 60000
  );
end $$;
revoke all on function public.client_emails_cron(text) from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname in ('client-doc-chaser', 'client-value-report');
select cron.schedule('client-doc-chaser', '0 14 * * *', $$select public.client_emails_cron('doc_chaser');$$);
select cron.schedule('client-value-report', '0 14 3 * *', $$select public.client_emails_cron('value_report');$$);

-- ---------------------------------------------------------------------------
-- 6. Per-recipient unsubscribe (migration client_email_unsubscribe).
--    One row per (client, portal-user email), created by the edge function the
--    first time it emails that person. `token` is 32 random bytes (hex) and is
--    the only thing the unsubscribe link carries. Clicking it (or a mail
--    client's RFC 8058 one-click POST) sets opted_out_at through the edge
--    function; that person then gets no client emails for that client. Staff
--    can see who unsubscribed; admins can clear opted_out_at (resubscribe).
--    Tokens are never readable by clients.
-- ---------------------------------------------------------------------------
create table if not exists public.client_email_recipients (
  client_id text not null references public.clients(id) on delete cascade,
  email text not null check (email = lower(email)),
  token text not null unique default encode(extensions.gen_random_bytes(32), 'hex'),
  opted_out_at timestamptz,
  opted_out_via text check (opted_out_via in ('link', 'one_click', 'admin')),
  created_at timestamptz not null default now(),
  primary key (client_id, email)
);
alter table public.client_email_recipients enable row level security;
drop policy if exists "staff read email recipients" on public.client_email_recipients;
create policy "staff read email recipients" on public.client_email_recipients
  for select to authenticated
  using ((select public.is_active_staff()) and public.can_access_client(client_id));
drop policy if exists "admins update email recipients" on public.client_email_recipients;
create policy "admins update email recipients" on public.client_email_recipients
  for update to authenticated
  using ((select public.is_active_staff_admin()))
  with check ((select public.is_active_staff_admin()));
-- Staff never need the token itself: column-level grants hide it.
revoke all on public.client_email_recipients from anon, authenticated;
grant select (client_id, email, opted_out_at, opted_out_via, created_at) on public.client_email_recipients to authenticated;
grant update (opted_out_at, opted_out_via) on public.client_email_recipients to authenticated;
