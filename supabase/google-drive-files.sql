-- Client files stored in the firm's Google Drive (owner request 2026-10-06).
--
-- Owner: "client files to pass through supabase as a link and actually store
-- in mgb google drive". The file of record lives in a Google Workspace Shared
-- Drive ("MGB Client Files"); Supabase keeps only the metadata and the Drive
-- file id. Clients never get Google access: every upload and download goes
-- through the drive-files edge function, which talks to Drive as a service
-- account (secrets GOOGLE_SERVICE_ACCOUNT_JSON + GOOGLE_DRIVE_SHARED_DRIVE_ID).
--
-- Applied to production 2026-10-06 as migration google_drive_files.
-- Safe to re-run.
--
-- Companion code:
--   supabase/functions/drive-files/index.ts   upload / list / link / get /
--                                             trash / restore / status /
--                                             copy_legacy
--   components/files/DriveFiles.js            browser helper + fallback switch
--   supabase/functions/ops-health-check       writes drive_status each tick
--
-- Pieces:
--   client_files        one row per file in Drive. Browsers can only SELECT
--                       the rows they're allowed (same rules as the old
--                       client-uploads bucket); every write is the edge
--                       function (service role).
--     visibility  shared   : everyone at the client + staff (Documents page)
--                 internal : staff only (Documents "Staff only", internal notes)
--                 request  : a document-request upload (client + staff)
--                 message  : a message attachment; client side only for the
--                            person whose thread it is
--   drive_folders       folder-id cache: <client> / <year> / <doc type>.
--   drive_file_events   upload/download/trash outcomes, for the health check.
--   drive_status        single row: are the secrets present (written by
--                       ops-health-check) and the last Drive auth result
--                       (written by drive-files).
--   ops_health_problems()  + drive_upload_failures (3+ failed uploads in an
--                       hour, test clients excluded) and drive_not_connected
--                       (only while a real, non-test client exists).
--   client_messages trigger: links client_files.message_id once the message
--                       that carries a Drive attachment is inserted.
--
-- How the old columns point at Drive files: client_doc_requests.file_path and
-- client_messages.attachment_path keep their existing shape so no constraint
-- or policy changes: "<client>/<request id>/drive:<client_files.id>" and
-- "<client>/messages/<email>/drive:<client_files.id>". Readers that see
-- "/drive:" ask the edge function for a link; anything else is an old
-- Supabase Storage object and is signed the old way. The function authorizes
-- downloads against client_files itself, so a forged path grants nothing.

begin;

-- ============================================================================
-- client_files
-- ============================================================================
create table if not exists public.client_files (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references public.clients(id) on delete restrict,
  drive_file_id text not null unique,
  drive_folder_id text,
  name text not null check (length(name) between 1 and 255),
  mime text check (mime is null or length(mime) <= 200),
  size bigint check (size is null or size >= 0),
  year integer not null check (year between 2000 and 2100),
  doc_type text not null default 'Other' check (length(doc_type) between 1 and 60),
  visibility text not null default 'shared'
    check (visibility in ('shared', 'internal', 'request', 'message')),
  participant_email text check (participant_email is null or participant_email = lower(participant_email)),
  request_id uuid references public.client_doc_requests(id) on delete set null,
  message_id uuid references public.client_messages(id) on delete set null,
  legacy_path text unique,
  uploaded_by text,
  uploaded_at timestamptz not null default now(),
  trashed_at timestamptz,
  trashed_by text,
  check (visibility <> 'message' or participant_email is not null)
);
create index if not exists client_files_client_idx on public.client_files (client_id, uploaded_at desc);
create index if not exists client_files_request_idx on public.client_files (request_id) where request_id is not null;
create index if not exists client_files_message_idx on public.client_files (message_id) where message_id is not null;

alter table public.client_files enable row level security;
revoke all on public.client_files from anon;
revoke insert, update, delete, truncate on public.client_files from authenticated;
grant select on public.client_files to authenticated;

drop policy if exists "staff read client files" on public.client_files;
create policy "staff read client files" on public.client_files
  for select to authenticated
  using ((select public.is_active_staff()) and public.can_access_client(client_id));

-- Mirrors the old bucket's "client reads own uploads": not staff-only, not in
-- trash, and message files only in the reader's own thread.
drop policy if exists "client reads own files" on public.client_files;
create policy "client reads own files" on public.client_files
  for select to authenticated
  using (
    trashed_at is null
    and public.is_client_member(client_id)
    and (
      visibility in ('shared', 'request')
      or (visibility = 'message' and participant_email = lower((select auth.jwt()) ->> 'email'))
    )
  );

-- ============================================================================
-- Folder cache: <client> / <year> / <doc type>
-- level 'client' (year and doc_type null), 'year' (doc_type null), 'doc_type'.
-- ============================================================================
create table if not exists public.drive_folders (
  id bigint generated always as identity primary key,
  client_id text not null references public.clients(id) on delete restrict,
  year integer,
  doc_type text,
  name text not null,
  drive_folder_id text not null,
  created_at timestamptz not null default now(),
  check ((year is null and doc_type is null) or (year is not null))
);
create unique index if not exists drive_folders_path_uidx
  on public.drive_folders (client_id, coalesce(year, 0), coalesce(lower(doc_type), ''));

alter table public.drive_folders enable row level security;
revoke all on public.drive_folders from anon;
revoke insert, update, delete, truncate on public.drive_folders from authenticated;
grant select on public.drive_folders to authenticated;
drop policy if exists "staff read drive folders" on public.drive_folders;
create policy "staff read drive folders" on public.drive_folders
  for select to authenticated
  using ((select public.is_active_staff()) and public.can_access_client(client_id));

-- ============================================================================
-- Events (for the health check) and connection status
-- ============================================================================
create table if not exists public.drive_file_events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  action text not null,
  ok boolean not null,
  client_id text,
  actor text,
  detail text
);
create index if not exists drive_file_events_at_idx on public.drive_file_events (at desc);
alter table public.drive_file_events enable row level security;
revoke all on public.drive_file_events from anon;
revoke insert, update, delete, truncate on public.drive_file_events from authenticated;
grant select on public.drive_file_events to authenticated;
drop policy if exists "admins read drive events" on public.drive_file_events;
create policy "admins read drive events" on public.drive_file_events
  for select to authenticated using ((select public.is_active_staff_admin()));

create table if not exists public.drive_status (
  id integer primary key default 1 check (id = 1),
  secrets_present boolean,
  checked_at timestamptz,
  last_auth_ok_at timestamptz,
  last_auth_error_at timestamptz,
  last_auth_error text
);
insert into public.drive_status (id) values (1) on conflict (id) do nothing;
alter table public.drive_status enable row level security;
revoke all on public.drive_status from anon;
revoke insert, update, delete, truncate on public.drive_status from authenticated;
grant select on public.drive_status to authenticated;
drop policy if exists "admins read drive status" on public.drive_status;
create policy "admins read drive status" on public.drive_status
  for select to authenticated using ((select public.is_active_staff_admin()));

-- ============================================================================
-- Link a Drive attachment to the message that carries it
-- ============================================================================
create or replace function public.client_messages_link_drive_file()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if new.attachment_path is not null
     and new.attachment_path ~ '/drive:[0-9a-f-]{36}$' then
    v_id := substring(new.attachment_path from '/drive:([0-9a-f-]{36})$')::uuid;
    update client_files
       set message_id = new.id
     where id = v_id
       and client_id = new.client_id
       and message_id is null
       and (participant_email is null or participant_email = new.participant_email);
  end if;
  return new;
end;
$$;
revoke all on function public.client_messages_link_drive_file() from public, anon, authenticated;

drop trigger if exists client_messages_link_drive_file on public.client_messages;
create trigger client_messages_link_drive_file
  after insert on public.client_messages
  for each row execute function public.client_messages_link_drive_file();

-- ============================================================================
-- Health check: + Drive upload failures, + Drive not connected
-- (everything above the "Drive" block is unchanged from ops-alerting.sql)
-- ============================================================================
create or replace function public.ops_health_problems()
returns table (key text, kind text, client_id text, title text, detail text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_last_cron  timestamptz;
  v_cron_on    boolean;
  v_usage      jsonb;
  v_mail_fails integer;
  v_mail_last  text;
  v_drive_fails integer;
  v_drive_last  text;
  v_drive       drive_status%rowtype;
  v_real_clients integer;
begin
  return query
  select 'sync_errors:' || h.client_id, 'sync_errors', h.client_id,
         h.client_name || ': QuickBooks sync failed ' || h.errors_in_a_row || ' times in a row',
         'Last error: ' || coalesce(left(h.last_run_detail, 300), left(h.last_error, 300), 'none recorded') ||
         '. Last good sync: ' || coalesce(to_char(h.last_synced_at at time zone 'America/Chicago', 'Mon FMDD, FMHH12:MI AM') || ' CT', 'never') ||
         '. Plan: ' || coalesce(h.plan, '?') || ' (' || h.expected || ').'
    from public.qbo_sync_health(false) h
   where h.status = 'connected' and h.errors_in_a_row >= 2;

  return query
  select 'sync_overdue:' || h.client_id, 'sync_overdue', h.client_id,
         h.client_name || ': QuickBooks sync is more than 2x overdue',
         'Expected ' || h.expected || '. Last good sync: ' ||
         coalesce(to_char(h.last_synced_at at time zone 'America/Chicago', 'Mon FMDD, FMHH12:MI AM') || ' CT', 'never') || '.'
    from public.qbo_sync_health(false) h
   where h.status = 'connected' and h.overdue_2x and not h.paused_by_usage and h.errors_in_a_row < 2;

  return query
  select 'qbo_reconnect:' || h.client_id, 'qbo_reconnect', h.client_id,
         h.client_name || ': QuickBooks needs to be reconnected',
         'The connection is in an error state, so nothing syncs until someone reconnects it. ' ||
         coalesce('Last error: ' || left(h.last_error, 300), '')
    from public.qbo_sync_health(false) h
   where h.status = 'error';

  select bool_or(j.active) into v_cron_on from cron.job j where j.jobname = 'qbo-sync-hourly';
  select max(d.start_time) into v_last_cron
    from cron.job_run_details d join cron.job j on j.jobid = d.jobid
   where j.jobname = 'qbo-sync-hourly' and d.status = 'succeeded';
  if v_cron_on is distinct from true or v_last_cron is null or v_last_cron < now() - interval '20 minutes' then
    return query select 'qbo_sync_cron'::text, 'qbo_sync_cron'::text, null::text,
      'The QuickBooks sync schedule hasn''t run recently'::text,
      (case when v_cron_on is null then 'The qbo-sync-hourly cron job is missing.'
            when v_cron_on = false then 'The qbo-sync-hourly cron job is turned off.'
            else 'Last successful run: ' || coalesce(to_char(v_last_cron at time zone 'America/Chicago', 'Mon FMDD, FMHH12:MI AM') || ' CT', 'never') ||
                 '. It should run every 5 minutes.' end)::text;
  end if;

  begin
    v_usage := public.qbo_usage_status();
  exception when others then
    v_usage := null;
  end;
  if v_usage is not null and v_usage ->> 'mode' = 'stopped' then
    return query select 'qbo_usage_stopped'::text, 'qbo_usage_stopped'::text, null::text,
      'QuickBooks API usage hit the monthly safety limit'::text,
      ('Scheduled syncs are stopped until next month (' || (v_usage ->> 'calls') || ' of ' || (v_usage ->> 'cap') ||
       ' calls). Sync now still works.')::text;
  end if;

  select count(*), max(x.reason) into v_mail_fails, v_mail_last
  from (
    select l.reason
      from client_email_log l
      left join clients c on c.id = l.client_id
     where l.created_at > now() - interval '1 hour'
       and l.status in ('error', 'not_configured')
       and l.trigger <> 'preview'
       and not coalesce(c.test_only, false)
    union all
    select r.detail
      from digest_runs r
     where r.started_at > now() - interval '1 hour'
       and r.status in ('error', 'not_configured')
       and r.trigger <> 'preview'
  ) x;
  if v_mail_fails >= 3 then
    return query select 'email_failures'::text, 'email_failures'::text, null::text,
      ('Emails are failing: ' || v_mail_fails || ' failed sends in the last hour')::text,
      ('Example error: ' || coalesce(left(v_mail_last, 300), 'none recorded') || '. Check Resend and the RESEND_API_KEY secret.')::text;
  end if;

  -- Drive (google-drive-files.sql). Test clients never page.
  select count(*), max(e.detail) into v_drive_fails, v_drive_last
    from drive_file_events e
    left join clients c on c.id = e.client_id
   where e.at > now() - interval '1 hour'
     and e.action = 'upload'
     and not e.ok
     and e.client_id is not null
     and not coalesce(c.test_only, false);
  if v_drive_fails >= 3 then
    return query select 'drive_upload_failures'::text, 'drive_upload_failures'::text, null::text,
      ('Google Drive uploads are failing: ' || v_drive_fails || ' failed uploads in the last hour')::text,
      ('Example error: ' || coalesce(left(v_drive_last, 300), 'none recorded') ||
       '. Check the MGB Client Files Shared Drive and the service account (Staff guide: Google Drive client files).')::text;
  end if;

  select count(*) into v_real_clients from clients c where not coalesce(c.test_only, false);
  select * into v_drive from drive_status where id = 1;
  if v_real_clients > 0 and (
       v_drive.secrets_present is distinct from true
       or (v_drive.last_auth_error_at is not null
           and v_drive.last_auth_error_at > coalesce(v_drive.last_auth_ok_at, '-infinity'::timestamptz))
     ) then
    return query select 'drive_not_connected'::text, 'drive_not_connected'::text, null::text,
      'Google Drive file storage isn''t connected'::text,
      (case when v_drive.secrets_present is distinct from true
            then 'The GOOGLE_SERVICE_ACCOUNT_JSON / GOOGLE_DRIVE_SHARED_DRIVE_ID secrets aren''t set, so client files are going to the portal''s backup storage instead of Drive.'
            else 'Drive rejected the service account: ' || coalesce(left(v_drive.last_auth_error, 300), 'no detail') || '.' end ||
       ' Real clients exist, so this matters now. See Staff guide: Google Drive client files.')::text;
  end if;
end;
$$;
revoke all on function public.ops_health_problems() from public, anon, authenticated;
grant execute on function public.ops_health_problems() to service_role;

commit;
