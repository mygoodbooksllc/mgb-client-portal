-- =====================================================================
-- Tasks Phase 2, S5: Ask client (requests, contacts, link tokens schema).
-- Spec: docs/tasks-phase2-spec.md C5 + C6 (schema part), E.
-- Critique fixes applied here: B1, B2, B3 (already shipped in S4), M1,
-- M9, M12, M13.
--
-- What this file does (safe to re-run, one transaction, nothing dropped):
--   1. client_email_settings.client_request_enabled (owner-only switch,
--      default off) and the owner guard re-attached (critique M10).
--   2. client_contacts, client_requests, tk_request_tokens,
--      tk_request_token_events, tk_rate_buckets. RLS on every table,
--      each starts from "revoke all".
--   3. client_doc_requests rows copied into client_requests with the same
--      ids (legacy_doc_request = true) and kept in step by a mirror
--      trigger. client_doc_requests stays writable in S5 (the portal,
--      Documents panel and drive-files still write it; they move in S6).
--      client_files.client_request_id added and backfilled.
--   4. B2: the comment and activity triggers accept a client answer made
--      by a definer answer RPC (flags mgb.tk_request + mgb.tk_actor).
--   5. Staff RPCs (ask, cancel, accept, record answer, revoke links, pause
--      reminders, send = dry run only, lists), the client answer RPC, and
--      service-only token RPCs for the S6 public endpoint.
--   6. M1: internal tk__grant_coverage with the admin check kept and a
--      31-day cap, for S7.
--
-- Email: nothing here sends mail. tk_client_request_send is a dry run in
-- every mode until the S6 sender exists; it writes a skipped
-- client_email_log row. B1: tk_ask_client never writes client_doc_requests,
-- so the live doc-chaser (which reads only client_doc_requests) never sees
-- an Ask-client request.
-- Tokens: only sha256 hashes are stored; plaintext tokens never touch SQL.
-- =====================================================================

-- Temporary helper (same as tasks-p2-4-hotfix-trigger-helpers.sql).
create or replace function pg_temp.patch_fn(p_sig text, p_from text, p_to text, p_expected int)
returns void
language plpgsql
as $f$
declare
  d text;
  n int;
begin
  d := pg_get_functiondef(p_sig::regprocedure);
  if position(p_to in d) > 0 then
    return;  -- already patched
  end if;
  n := (length(d) - length(replace(d, p_from, ''))) / length(p_from);
  if n <> p_expected then
    raise exception 'patch_fn %: expected % occurrence(s) of anchor %, found %', p_sig, p_expected, p_from, n;
  end if;
  execute replace(d, p_from, p_to);
end
$f$;

-- 1. Owner-only live switch ------------------------------------------------
alter table public.client_email_settings
  add column if not exists client_request_enabled boolean not null default false;

create or replace function public.tk_guard_client_request_switch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) -> 'client_request_enabled'
                      else 'false'::jsonb end;
  v_new jsonb := coalesce(to_jsonb(new) -> 'client_request_enabled', 'false'::jsonb);
begin
  if v_new is not distinct from v_old then
    return new;
  end if;
  if not public.is_internal_owner()
     and coalesce(current_setting('mgb.tk_owner_override', true), '') <> 'on' then
    raise exception 'tk_owner_only' using errcode = '42501';
  end if;
  insert into tk_settings_audit (key, old_value, new_value, changed_by)
  values ('client_email_settings.client_request_enabled', v_old, v_new,
          coalesce(nullif(lower(coalesce(auth.jwt() ->> 'email', '')), ''), 'system'));
  return new;
end $$;

drop trigger if exists tk_guard_client_request_switch on public.client_email_settings;
create trigger tk_guard_client_request_switch before insert or update on public.client_email_settings
  for each row execute function public.tk_guard_client_request_switch();

-- Admin-editable defaults (not owner-only keys).
insert into public.tk_settings (key, value) values ('token_ttl_days', '14') on conflict (key) do nothing;
insert into public.tk_settings (key, value) values ('nudge_max', '4') on conflict (key) do nothing;

create or replace function public.tk__setting_int(p_key text, p_default int, p_min int, p_max int)
returns int
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
  n int;
begin
  select value into v from tk_settings where key = p_key;
  begin
    n := case jsonb_typeof(v) when 'number' then (v #>> '{}')::int
                              when 'string' then (v #>> '{}')::int end;
  exception when others then
    n := null;
  end;
  if n is null or n < p_min or n > p_max then
    return p_default;
  end if;
  return n;
end $$;
revoke all on function public.tk__setting_int(text, int, int, int) from public, anon, authenticated;

-- 2a. client_contacts (C6) -------------------------------------------------
create table if not exists public.client_contacts (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references public.clients(id),
  name text not null,
  email text not null,
  role text,
  can_answer_requests boolean not null default true,
  notes text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint client_contacts_name_len check (char_length(btrim(name)) between 1 and 120),
  constraint client_contacts_email_len check (char_length(email) between 3 and 254),
  constraint client_contacts_email_lower check (email = lower(email)),
  constraint client_contacts_role_check check (role is null or role in ('treasurer', 'pastor', 'board', 'finance', 'other')),
  constraint client_contacts_notes_len check (notes is null or char_length(notes) <= 500)
);
create unique index if not exists client_contacts_live_email on public.client_contacts (client_id, email) where deleted_at is null;

alter table public.client_contacts enable row level security;
revoke all on table public.client_contacts from public, anon, authenticated;
grant select on table public.client_contacts to authenticated;
drop policy if exists "staff read client contacts" on public.client_contacts;
create policy "staff read client contacts" on public.client_contacts
  for select to authenticated using (public.is_active_staff() and public.can_access_client(client_id));
drop policy if exists "internal company lock" on public.client_contacts;
create policy "internal company lock" on public.client_contacts as restrictive for all
  using (client_id is null or client_id <> all ((select public.internal_blocked_ids())::text[]))
  with check (client_id is null or client_id <> all ((select public.internal_blocked_ids())::text[]));

-- 2b. client_requests (C5) -------------------------------------------------
create table if not exists public.client_requests (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references public.clients(id),
  task_id uuid references public.staff_reminders(id) on delete set null,
  kind text not null default 'question',
  title text not null,
  prompt text not null,
  needs_upload boolean not null default false,
  due_date date,
  status text not null default 'open',
  recipient_emails text[] not null default '{}',
  contact_ids uuid[] not null default '{}',
  reply text,
  answered_via text,
  answered_by text,
  answered_at timestamptz,
  accepted_by text,
  accepted_at timestamptz,
  cancelled_by text,
  cancelled_at timestamptz,
  cancel_reason text,
  asked_by text not null,
  asked_at timestamptz not null default now(),
  link_ttl_days int not null default 14,
  last_nudged_at timestamptz,
  nudge_count int not null default 0,
  nudge_paused boolean not null default false,
  legacy_doc_request boolean not null default false,
  legacy_file_path text,
  legacy_file_name text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint client_requests_kind_check check (kind in ('document', 'question', 'approval')),
  constraint client_requests_status_check check (status in ('open', 'answered', 'accepted', 'cancelled')),
  constraint client_requests_title_len check (char_length(btrim(title)) between 1 and 200),
  constraint client_requests_prompt_len check (char_length(btrim(prompt)) between 1 and 2000),
  constraint client_requests_reply_len check (reply is null or char_length(reply) <= 4000),
  constraint client_requests_via_check check (answered_via is null or answered_via in ('portal', 'link', 'staff')),
  constraint client_requests_cancel_reason_len check (cancel_reason is null or char_length(cancel_reason) <= 500),
  constraint client_requests_ttl_check check (link_ttl_days between 1 and 30),
  constraint client_requests_nudge_check check (nudge_count >= 0)
);
create index if not exists client_requests_client_status on public.client_requests (client_id, status) where deleted_at is null;
create index if not exists client_requests_task on public.client_requests (task_id);
create index if not exists client_requests_nudge on public.client_requests (status, last_nudged_at) where status = 'open';

-- M12: no direct writes; staff and clients write only through the RPCs
-- below. Reads use column grants that leave out who else was asked
-- (recipient_emails, contact_ids) and staff-side fields.
alter table public.client_requests enable row level security;
revoke all on table public.client_requests from public, anon, authenticated;
grant select (id, client_id, task_id, kind, title, prompt, needs_upload, due_date, status, reply,
              answered_via, answered_at, accepted_at, cancelled_at, asked_at, link_ttl_days,
              last_nudged_at, nudge_count, nudge_paused, legacy_doc_request, legacy_file_name,
              updated_at, deleted_at)
  on public.client_requests to authenticated;
drop policy if exists "client requests read" on public.client_requests;
create policy "client requests read" on public.client_requests
  for select to authenticated using (
    (deleted_at is null and public.is_client_member(client_id))
    or (public.is_active_staff() and public.can_access_client(client_id))
  );
drop policy if exists "internal company lock" on public.client_requests;
create policy "internal company lock" on public.client_requests as restrictive for all
  using (client_id is null or client_id <> all ((select public.internal_blocked_ids())::text[]))
  with check (client_id is null or client_id <> all ((select public.internal_blocked_ids())::text[]));

-- 2c. Link tokens (C6 schema; the endpoint that uses them is S6) -----------
create table if not exists public.tk_request_tokens (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.client_requests(id),
  contact_id uuid references public.client_contacts(id),
  recipient_email text not null,
  token_hash bytea not null unique,
  created_by text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by text,
  revoke_reason text,
  first_viewed_at timestamptz,
  answered_at timestamptz,
  view_count int not null default 0,
  answer_attempts int not null default 0,
  is_test boolean not null default false,
  constraint tk_request_tokens_hash_len check (octet_length(token_hash) = 32),
  constraint tk_request_tokens_reason_check check (revoke_reason is null or revoke_reason in
    ('reissued', 'answered', 'cancelled', 'staff', 'cap', 'contact_retired', 'expired'))
);
create index if not exists tk_request_tokens_request on public.tk_request_tokens (request_id);
create index if not exists tk_request_tokens_contact on public.tk_request_tokens (contact_id);

alter table public.tk_request_tokens enable row level security;
revoke all on table public.tk_request_tokens from public, anon, authenticated;
grant select (id, request_id, contact_id, recipient_email, created_by, created_at, expires_at, revoked_at,
              revoked_by, revoke_reason, first_viewed_at, answered_at, view_count, answer_attempts, is_test)
  on public.tk_request_tokens to authenticated;   -- never token_hash
drop policy if exists "staff read request tokens" on public.tk_request_tokens;
create policy "staff read request tokens" on public.tk_request_tokens
  for select to authenticated using (
    public.is_active_staff()
    and exists (select 1 from public.client_requests r
                 where r.id = tk_request_tokens.request_id and public.can_access_client(r.client_id))
  );

create table if not exists public.tk_request_token_events (
  id bigint generated always as identity primary key,
  token_id uuid,
  request_id uuid,
  event text not null,
  ip_hash text,
  detail jsonb not null default '{}'::jsonb,
  at timestamptz not null default now(),
  constraint tk_request_token_events_event_check check (event in
    ('issued', 'emailed', 'view', 'answer', 'upload', 'stop_nudges', 'invalid', 'expired', 'revoked',
     'answered_already', 'rate_limited', 'dry_run')),
  constraint tk_request_token_events_ip_len check (ip_hash is null or char_length(ip_hash) <= 128),
  constraint tk_request_token_events_detail_len check (char_length(detail::text) <= 2000)
);
create index if not exists tk_request_token_events_request on public.tk_request_token_events (request_id, at);
alter table public.tk_request_token_events enable row level security;
revoke all on table public.tk_request_token_events from public, anon, authenticated;
grant select on table public.tk_request_token_events to authenticated;
drop policy if exists "admin read token events" on public.tk_request_token_events;
create policy "admin read token events" on public.tk_request_token_events
  for select to authenticated using (public.is_active_staff_admin());

-- Append-only, for every role (service_role and the owner included).
create or replace function public.tk_request_token_events_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'tk_append_only' using errcode = '42501';
end $$;
drop trigger if exists tk_request_token_events_append_only on public.tk_request_token_events;
create trigger tk_request_token_events_append_only before update or delete on public.tk_request_token_events
  for each row execute function public.tk_request_token_events_append_only();

create table if not exists public.tk_rate_buckets (
  key text primary key,
  window_start timestamptz not null default now(),
  count int not null default 0,
  constraint tk_rate_buckets_key_len check (char_length(key) between 1 and 200)
);
alter table public.tk_rate_buckets enable row level security;
revoke all on table public.tk_rate_buckets from public, anon, authenticated;

-- 3. Legacy document requests (M13) ----------------------------------------
create or replace function public.tk__legacy_status(p text)
returns text
language sql
immutable
set search_path = public
as $$
  select case p when 'uploaded' then 'answered' when 'done' then 'accepted'
                when 'cancelled' then 'cancelled' else 'open' end;
$$;

create or replace function public.tk__mirror_doc_request(d public.client_doc_requests)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text := public.tk__legacy_status(d.status);
begin
  -- A row whose client was removed has nothing to show (client_requests keeps
  -- its client foreign key); it stays in client_doc_requests only.
  if not exists (select 1 from clients c where c.id = d.client_id) then
    return;
  end if;
  insert into client_requests (id, client_id, kind, title, prompt, needs_upload, due_date, status,
                               asked_by, asked_at, answered_via, answered_by, answered_at,
                               accepted_at, cancelled_at, legacy_doc_request, legacy_file_path,
                               legacy_file_name, updated_at)
  values (d.id, d.client_id, 'document', left(btrim(d.title), 200),
          left(coalesce(nullif(btrim(d.details), ''), btrim(d.title)), 2000), true, d.due_date, v_status,
          coalesce(nullif(lower(btrim(d.requested_by)), ''), 'legacy'), d.created_at,
          case when d.fulfilled_at is not null or v_status in ('answered', 'accepted') then 'portal' end,
          d.uploaded_by, d.fulfilled_at,
          case when v_status = 'accepted' then coalesce(d.closed_at, d.fulfilled_at, d.created_at) end,
          case when v_status = 'cancelled' then coalesce(d.closed_at, d.created_at) end,
          true, d.file_path, d.file_name, now())
  on conflict (id) do update
    set client_id = excluded.client_id, title = excluded.title, prompt = excluded.prompt,
        due_date = excluded.due_date, status = excluded.status, asked_by = excluded.asked_by,
        answered_via = excluded.answered_via, answered_by = excluded.answered_by,
        answered_at = excluded.answered_at, accepted_at = excluded.accepted_at,
        cancelled_at = excluded.cancelled_at, legacy_file_path = excluded.legacy_file_path,
        legacy_file_name = excluded.legacy_file_name, updated_at = now()
    where client_requests.legacy_doc_request;
end $$;
revoke all on function public.tk__mirror_doc_request(public.client_doc_requests) from public, anon, authenticated;

create or replace function public.tk_client_doc_requests_mirror()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.tk__mirror_doc_request(new);
  return null;
end $$;
drop trigger if exists tk_client_doc_requests_mirror on public.client_doc_requests;
create trigger tk_client_doc_requests_mirror after insert or update on public.client_doc_requests
  for each row execute function public.tk_client_doc_requests_mirror();

select public.tk__mirror_doc_request(d) from public.client_doc_requests d;

-- Per-status counts must match (M13 verify).
do $$
declare r record;
begin
  for r in
    select s, (select count(*) from client_doc_requests d where public.tk__legacy_status(d.status) = s
                  and exists (select 1 from clients c where c.id = d.client_id)) a,
              (select count(*) from client_requests c where c.legacy_doc_request and c.status = s) b
      from unnest(array['open', 'answered', 'accepted', 'cancelled']) s
  loop
    if r.a <> r.b then
      raise exception 'tk legacy copy mismatch for %: % vs %', r.s, r.a, r.b;
    end if;
  end loop;
end $$;

alter table public.client_files
  add column if not exists client_request_id uuid references public.client_requests(id) on delete set null;
create index if not exists client_files_client_request on public.client_files (client_request_id) where client_request_id is not null;
update public.client_files f set client_request_id = f.request_id
 where f.request_id is not null and f.client_request_id is null
   and exists (select 1 from public.client_requests r where r.id = f.request_id);

create or replace function public.tk_client_files_request_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.request_id is not null and new.client_request_id is null
     and exists (select 1 from client_requests r where r.id = new.request_id) then
    new.client_request_id := new.request_id;
  end if;
  return new;
end $$;
drop trigger if exists tk_client_files_request_link on public.client_files;
create trigger tk_client_files_request_link before insert or update of request_id on public.client_files
  for each row execute function public.tk_client_files_request_link();

-- 4. B2: client answers through the comment and activity triggers ----------
select pg_temp.patch_fn('public.tk_comments_before_write()',
$a$    new.author_email := v_me;
    if v_me = '' or not public.is_active_staff() then$a$,
$b$    new.author_email := v_me;
    -- tk p2 s5 (B2): a client or link answer, inserted by a definer answer RPC
    if new.kind = 'client_reply' and coalesce(current_setting('mgb.tk_request', true), '') = 'on'
       and coalesce(current_setting('mgb.tk_actor', true), '') <> '' then
      new.author_email := left(current_setting('mgb.tk_actor', true), 300);
      new.mentions := '{}';
      new.created_at := now();
      new.edited_at := null; new.edited_by := null; new.deleted_at := null; new.deleted_by := null;
      return new;
    end if;
    if v_me = '' or not public.is_active_staff() then$b$, 1);

select pg_temp.patch_fn('public.tk_staff_reminders_activity()',
$a$  v_actor text := coalesce(nullif(lower(coalesce(auth.jwt() ->> 'email', '')), ''), 'system');$a$,
$b$  v_actor text := coalesce(nullif(current_setting('mgb.tk_actor', true), ''),   -- tk p2 s5 (B2)
                            nullif(lower(coalesce(auth.jwt() ->> 'email', '')), ''), 'system');$b$, 1);

-- 5. Waiting guard ----------------------------------------------------------
-- A task with open Ask-client requests leaves "Waiting on client" only
-- through the request RPCs (answer, cancel). Named tk_* so it runs after
-- staff_reminders_before_write.
create or replace function public.tk_staff_reminders_request_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'waiting_client' and new.status is distinct from 'waiting_client'
     and coalesce(current_setting('mgb.tk_request', true), '') <> 'on'
     and coalesce(current_setting('mgb.offboarding', true), '') <> 'on'
     and coalesce(current_setting('mgb.tk_migrate', true), '') <> 'on'
     and exists (select 1 from client_requests r
                  where r.task_id = new.id and r.status = 'open' and r.deleted_at is null
                    and not r.legacy_doc_request) then
    raise exception 'tk_has_open_requests' using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists tk_staff_reminders_request_guard on public.staff_reminders;
create trigger tk_staff_reminders_request_guard before update of status, done on public.staff_reminders
  for each row execute function public.tk_staff_reminders_request_guard();

-- 6. Internal helpers --------------------------------------------------------
create or replace function public.tk__me()
returns text
language sql
stable
set search_path = public
as $$ select lower(coalesce(auth.jwt() ->> 'email', '')) $$;

create or replace function public.tk__req_staff_guard(p_client_id text)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_client_id is null or not public.is_active_staff() or not public.can_access_client(p_client_id) then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
end $$;
revoke all on function public.tk__req_staff_guard(text) from public, anon, authenticated;

create or replace function public.tk__flags_off()
returns void
language sql
set search_path = public
as $$
  select set_config('mgb.tk_request', '', true), set_config('mgb.tk_actor', '', true), set_config('mgb.tk_rpc', '', true);
$$;
revoke all on function public.tk__flags_off() from public, anon, authenticated;

create or replace function public.tk__business_days_since(p_from date, p_to date)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select case when p_from is null or p_to is null or p_to <= p_from then 0
         else (select count(*)::int from generate_series(p_from + 1, p_to, interval '1 day') d
                where public.tk_is_business_day(d::date)) end;
$$;
revoke all on function public.tk__business_days_since(date, date) from public, anon, authenticated;

-- Resume a task when its last open request closes.
create or replace function public.tk__request_resume(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_before text;
begin
  if p_task_id is null then
    return;
  end if;
  if exists (select 1 from client_requests r
              where r.task_id = p_task_id and r.status = 'open' and r.deleted_at is null and not r.legacy_doc_request) then
    return;
  end if;
  select status, status_before_wait into v_status, v_before
    from staff_reminders where id = p_task_id and deleted_at is null;
  if not found or v_status is distinct from 'waiting_client' then
    return;
  end if;
  perform set_config('mgb.tk_request', 'on', true);
  update staff_reminders
     set status = case when v_before in ('todo', 'in_progress') then v_before else 'todo' end
   where id = p_task_id;
end $$;
revoke all on function public.tk__request_resume(uuid) from public, anon, authenticated;

-- Shared answer step: portal, link and staff-recorded answers.
create or replace function public.tk__request_answer(p_id uuid, p_reply text, p_via text, p_by text,
                                                     p_actor text, p_notify boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r client_requests;
  t record;
  v_reply text := nullif(btrim(coalesce(p_reply, '')), '');
  v_files int;
  v_body text;
begin
  select * into r from client_requests where id = p_id for update;
  if not found or r.deleted_at is not null then
    raise exception 'tk_not_found' using errcode = 'P0002';
  end if;
  if r.status <> 'open' then
    raise exception 'tk_not_open' using errcode = '22023';
  end if;
  if v_reply is not null and char_length(v_reply) > 4000 then
    raise exception 'tk_bad_request' using errcode = '22023';
  end if;
  select count(*) into v_files from client_files f where f.client_request_id = p_id and f.trashed_at is null;
  if v_reply is null and v_files = 0 then
    raise exception 'tk_reply_required' using errcode = '22023';
  end if;
  update client_requests
     set status = 'answered', reply = v_reply, answered_via = p_via, answered_by = left(p_by, 300),
         answered_at = now(), updated_at = now()
   where id = p_id;
  update tk_request_tokens
     set revoked_at = now(), revoked_by = left(p_actor, 300), revoke_reason = 'answered'
   where request_id = p_id and revoked_at is null and answered_at is null;
  if r.task_id is not null then
    select s.id, s.text, s.assignee_email, s.deleted_at into t from staff_reminders s where s.id = r.task_id;
    if found and t.deleted_at is null then
      v_body := case
        when v_reply is not null then
          format('Answer to "%s": %s', r.title, v_reply)
          || case when v_files > 0 then format(' (%s file%s attached)', v_files, case when v_files = 1 then '' else 's' end) else '' end
        else format('Uploaded %s file%s for "%s".', v_files, case when v_files = 1 then '' else 's' end, r.title) end;
      perform set_config('mgb.tk_request', 'on', true);
      perform set_config('mgb.tk_actor', left(p_actor, 300), true);
      insert into tk_comments (task_id, body, kind) values (r.task_id, left(v_body, 5000), 'client_reply');
      insert into tk_activity (task_id, actor_email, kind, to_value, meta)
      values (r.task_id, left(p_actor, 300), 'client_answered', left(r.title, 200),
              jsonb_build_object('request_id', r.id, 'via', p_via, 'files', v_files));
      perform public.tk__request_resume(r.task_id);
      if p_notify then
        perform public.tk__enqueue('staff_task_client_answered', t.assignee_email, r.client_id, r.task_id::text,
                                   jsonb_build_object('text', left(t.text, 200)));
      end if;
    end if;
  end if;
  perform public.tk__flags_off();
end $$;
revoke all on function public.tk__request_answer(uuid, text, text, text, text, boolean) from public, anon, authenticated;

create or replace function public.tk__revoke_tokens(p_request_id uuid, p_reason text, p_actor text, p_contact_id uuid default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  with x as (
    update tk_request_tokens
       set revoked_at = now(), revoked_by = left(p_actor, 300), revoke_reason = p_reason
     where (p_request_id is null or request_id = p_request_id)
       and (p_contact_id is null or contact_id = p_contact_id)
       and revoked_at is null and answered_at is null
    returning id, request_id
  ), ev as (
    insert into tk_request_token_events (token_id, request_id, event, detail)
    select id, request_id, 'revoked', jsonb_build_object('reason', p_reason) from x
    returning 1
  )
  select count(*) into n from ev;
  return n;
end $$;
revoke all on function public.tk__revoke_tokens(uuid, text, text, uuid) from public, anon, authenticated;

-- 7. Contacts RPCs -------------------------------------------------------------
create or replace function public.tk_save_client_contact(p_id uuid, p_client_id text, p_name text, p_email text,
                                                         p_role text default null, p_can_answer boolean default true,
                                                         p_notes text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name text := btrim(coalesce(p_name, ''));
  v_id uuid;
  v_client text;
begin
  if p_id is not null then
    select client_id into v_client from client_contacts where id = p_id and deleted_at is null;
    if not found then
      raise exception 'tk_not_found' using errcode = 'P0002';
    end if;
  else
    v_client := p_client_id;
  end if;
  perform public.tk__req_staff_guard(v_client);
  if v_name = '' or char_length(v_name) > 120 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
     or char_length(v_email) > 254 or (p_role is not null and p_role not in ('treasurer', 'pastor', 'board', 'finance', 'other'))
     or char_length(coalesce(p_notes, '')) > 500 then
    raise exception 'tk_bad_contact' using errcode = '22023';
  end if;
  if exists (select 1 from client_contacts c where c.client_id = v_client and c.email = v_email
                and c.deleted_at is null and c.id is distinct from p_id) then
    raise exception 'tk_contact_exists' using errcode = '23505';
  end if;
  if p_id is null then
    insert into client_contacts (client_id, name, email, role, can_answer_requests, notes, created_by)
    values (v_client, v_name, v_email, p_role, coalesce(p_can_answer, true), nullif(btrim(coalesce(p_notes, '')), ''), public.tk__me())
    returning id into v_id;
  else
    update client_contacts
       set name = v_name, email = v_email, role = p_role, can_answer_requests = coalesce(p_can_answer, true),
           notes = nullif(btrim(coalesce(p_notes, '')), ''), updated_at = now()
     where id = p_id
    returning id into v_id;
    if not coalesce(p_can_answer, true) then
      perform public.tk__revoke_tokens(null, 'contact_retired', public.tk__me(), p_id);
    end if;
  end if;
  return v_id;
end $$;

create or replace function public.tk_retire_client_contact(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client text;
begin
  select client_id into v_client from client_contacts where id = p_id and deleted_at is null;
  if not found then
    raise exception 'tk_not_found' using errcode = 'P0002';
  end if;
  perform public.tk__req_staff_guard(v_client);
  update client_contacts set deleted_at = now(), updated_at = now() where id = p_id;
  perform public.tk__revoke_tokens(null, 'contact_retired', public.tk__me(), p_id);
end $$;

-- Who can be asked: active portal users and live contacts.
create or replace function public.tk_request_recipients(p_client_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.tk__req_staff_guard(p_client_id);
  return jsonb_build_object(
    'portal', coalesce((
      select jsonb_agg(jsonb_build_object('email', lower(cu.email), 'name', cu.name, 'role', cu.role,
                                          'opted_out', exists (select 1 from client_email_recipients er
                                                                where er.client_id = cu.client_id and lower(er.email) = lower(cu.email)
                                                                  and er.opted_out_at is not null))
                       order by cu.name)
        from client_users cu where cu.client_id = p_client_id and cu.active), '[]'::jsonb),
    'contacts', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'email', c.email, 'role', c.role,
                                          'can_answer', c.can_answer_requests, 'notes', c.notes)
                       order by c.name)
        from client_contacts c where c.client_id = p_client_id and c.deleted_at is null), '[]'::jsonb));
end $$;

-- 8. Staff request RPCs ----------------------------------------------------------
create or replace function public.tk_ask_client(p_client_id text, p_task_id uuid, p_title text, p_prompt text,
                                                p_kind text, p_needs_upload boolean, p_due_date date,
                                                p_recipient_emails text[], p_contact_ids uuid[],
                                                p_link_ttl_days int default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := public.tk__me();
  v_title text := btrim(coalesce(p_title, ''));
  v_prompt text := btrim(coalesce(p_prompt, ''));
  v_emails text[];
  v_contacts uuid[];
  v_ttl int;
  v_task record;
  v_id uuid;
  v_today date := (now() at time zone 'America/Chicago')::date;
begin
  perform public.tk__req_staff_guard(p_client_id);
  if v_title = '' or char_length(v_title) > 200 or v_prompt = '' or char_length(v_prompt) > 2000
     or coalesce(p_kind, '') not in ('document', 'question', 'approval')
     or (p_due_date is not null and (p_due_date < v_today or p_due_date > v_today + 366)) then
    raise exception 'tk_bad_request' using errcode = '22023';
  end if;
  v_ttl := coalesce(p_link_ttl_days, public.tk__setting_int('token_ttl_days', 14, 1, 30));
  if v_ttl < 1 or v_ttl > 30 then
    raise exception 'tk_bad_request' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct e order by e), '{}') into v_emails
    from (select lower(btrim(x)) e from unnest(coalesce(p_recipient_emails, '{}')) x) s where e <> '';
  select coalesce(array_agg(distinct c order by c), '{}') into v_contacts
    from unnest(coalesce(p_contact_ids, '{}')) c where c is not null;
  if cardinality(v_emails) + cardinality(v_contacts) = 0 then
    raise exception 'tk_no_recipients' using errcode = '22023';
  end if;
  if cardinality(v_emails) + cardinality(v_contacts) > 20 then
    raise exception 'tk_bad_request' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_emails) e
              where not exists (select 1 from client_users cu
                                 where cu.client_id = p_client_id and cu.active and lower(cu.email) = e)) then
    raise exception 'tk_bad_recipient' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_contacts) c
              where not exists (select 1 from client_contacts k
                                 where k.id = c and k.client_id = p_client_id and k.deleted_at is null
                                   and k.can_answer_requests)) then
    raise exception 'tk_bad_recipient' using errcode = '22023';
  end if;
  if p_task_id is not null then
    select id, client_id, status, deleted_at into v_task from staff_reminders where id = p_task_id;
    if not found or v_task.deleted_at is not null then
      raise exception 'tk_not_found' using errcode = 'P0002';
    end if;
    if v_task.client_id is distinct from p_client_id or not public.tk_can_edit_task(p_task_id) then
      raise exception 'tk_forbidden' using errcode = '42501';
    end if;
    if v_task.status not in ('todo', 'in_progress', 'waiting_client') then
      raise exception 'tk_bad_transition' using errcode = '22023';
    end if;
  end if;

  insert into client_requests (client_id, task_id, kind, title, prompt, needs_upload, due_date, recipient_emails,
                               contact_ids, asked_by, link_ttl_days)
  values (p_client_id, p_task_id, p_kind, v_title, v_prompt, coalesce(p_needs_upload, false), p_due_date, v_emails,
          v_contacts, v_me, v_ttl)
  returning id into v_id;

  if p_task_id is not null then
    perform set_config('mgb.tk_request', 'on', true);
    if v_task.status <> 'waiting_client' then
      update staff_reminders set status = 'waiting_client' where id = p_task_id;
    end if;
    insert into tk_activity (task_id, actor_email, kind, to_value, meta)
    values (p_task_id, v_me, 'client_asked', left(v_title, 200),
            jsonb_build_object('request_id', v_id, 'kind', p_kind,
                               'recipients', cardinality(v_emails) + cardinality(v_contacts)));
  end if;
  perform public.tk__flags_off();
  return v_id;
end $$;

create or replace function public.tk__request_for_staff(p_id uuid)
returns public.client_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  r client_requests;
begin
  select * into r from client_requests where id = p_id and deleted_at is null for update;
  if not found then
    raise exception 'tk_not_found' using errcode = 'P0002';
  end if;
  perform public.tk__req_staff_guard(r.client_id);
  if r.legacy_doc_request then
    raise exception 'tk_legacy_request' using errcode = '22023';   -- managed in the Documents panel until S6
  end if;
  return r;
end $$;
revoke all on function public.tk__request_for_staff(uuid) from public, anon, authenticated;

create or replace function public.tk_cancel_client_request(p_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r client_requests;
  v_me text := public.tk__me();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  r := public.tk__request_for_staff(p_id);
  if r.status <> 'open' then
    raise exception 'tk_not_open' using errcode = '22023';
  end if;
  if char_length(coalesce(v_reason, '')) > 500 then
    raise exception 'tk_bad_request' using errcode = '22023';
  end if;
  update client_requests
     set status = 'cancelled', cancelled_by = v_me, cancelled_at = now(), cancel_reason = v_reason, updated_at = now()
   where id = p_id;
  perform public.tk__revoke_tokens(p_id, 'cancelled', v_me);
  if r.task_id is not null and exists (select 1 from staff_reminders where id = r.task_id and deleted_at is null) then
    perform set_config('mgb.tk_rpc', 'on', true);
    insert into tk_comments (task_id, body, kind)
    values (r.task_id, left(format('Cancelled the request "%s"', r.title)
                            || coalesce(': ' || v_reason, '.'), 5000), 'system');
    perform public.tk__request_resume(r.task_id);
  end if;
  perform public.tk__flags_off();
end $$;

create or replace function public.tk_accept_client_request(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r client_requests;
begin
  r := public.tk__request_for_staff(p_id);
  if r.status <> 'answered' then
    raise exception 'tk_not_answered' using errcode = '22023';
  end if;
  update client_requests set status = 'accepted', accepted_by = public.tk__me(), accepted_at = now(), updated_at = now()
   where id = p_id;
end $$;

-- An answer that came by phone or email, typed in by staff.
create or replace function public.tk_record_client_answer(p_id uuid, p_reply text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r client_requests;
  v_me text := public.tk__me();
begin
  r := public.tk__request_for_staff(p_id);
  if nullif(btrim(coalesce(p_reply, '')), '') is null then
    raise exception 'tk_reply_required' using errcode = '22023';
  end if;
  perform public.tk__request_answer(p_id, p_reply, 'staff', v_me, v_me, false);
end $$;

create or replace function public.tk_revoke_request_tokens(p_request_id uuid, p_reason text default 'staff')
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r client_requests;
begin
  r := public.tk__request_for_staff(p_request_id);
  return public.tk__revoke_tokens(p_request_id, 'staff', public.tk__me());
end $$;

create or replace function public.tk_set_request_nudge_paused(p_id uuid, p_paused boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r client_requests;
begin
  r := public.tk__request_for_staff(p_id);
  if r.status <> 'open' then
    raise exception 'tk_not_open' using errcode = '22023';
  end if;
  update client_requests set nudge_paused = coalesce(p_paused, false), updated_at = now() where id = p_id;
end $$;

-- Which way a send would go today (C6 gating). Never sends.
create or replace function public.tk__request_send_mode(p_client_id text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_on boolean;
  v_live boolean;
  v_test boolean;
  v_pilot jsonb;
begin
  select enabled, client_request_enabled into v_on, v_live from client_email_settings limit 1;
  if not coalesce(v_on, false) then
    return 'off';
  end if;
  select test_only into v_test from clients where id = p_client_id;
  if coalesce(v_test, false) then
    return 'test';
  end if;
  select value into v_pilot from tk_settings where key = 'client_request_pilot';
  if not coalesce(v_live, false)
     or not (v_pilot = '"all"'::jsonb
             or (jsonb_typeof(v_pilot) = 'array' and v_pilot ? p_client_id)) then
    return 'dry_run';
  end if;
  return 'live';
end $$;
revoke all on function public.tk__request_send_mode(text) from public, anon, authenticated;

-- S5: every action is a dry run. The S6 edge function (tk-client-requests)
-- does real test and live sends; until then nothing leaves the building.
create or replace function public.tk_client_request_send(p_id uuid, p_action text default 'send')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r client_requests;
  v_me text := public.tk__me();
  v_mode text;
  v_client text;
  v_subject text;
  v_rcpt text[];
begin
  if coalesce(p_action, '') not in ('preview', 'send', 'resend', 'nudge') then
    raise exception 'tk_bad_request' using errcode = '22023';
  end if;
  r := public.tk__request_for_staff(p_id);
  if r.status <> 'open' then
    raise exception 'tk_not_open' using errcode = '22023';
  end if;
  v_mode := public.tk__request_send_mode(r.client_id);
  if v_mode = 'off' then
    raise exception 'tk_email_off' using errcode = '22023';
  end if;
  select name into v_client from clients where id = r.client_id;
  v_subject := case when p_action = 'nudge'
                    then format('Reminder: 1 item %s still needs from you', coalesce(v_client, 'your organization'))
                    else format('%s: %s', coalesce(v_client, 'Your organization'), r.title) end;
  if v_mode = 'test' then
    v_rcpt := array[v_me];   -- a test client's copy only ever goes to the caller
  else
    select coalesce(array_agg(e order by e), '{}') into v_rcpt from (
      select e from unnest(r.recipient_emails) e
       where not exists (select 1 from client_email_recipients er
                          where er.client_id = r.client_id and lower(er.email) = e and er.opted_out_at is not null)
      union
      select k.email from client_contacts k
       where k.id = any (r.contact_ids) and k.deleted_at is null and k.can_answer_requests
    ) s;
  end if;
  if p_action <> 'preview' then
    insert into client_email_log (feature, trigger, client_id, status, reason, recipients, request_ids, subject, requested_by)
    values (case when p_action = 'nudge' then 'client_request_nudge' else 'client_request' end, 'manual', r.client_id,
            'skipped', case when v_mode = 'dry_run' then 'dry_run' else 'dry_run: sender ships in S6 (' || v_mode || ')' end,
            v_rcpt, array[r.id], left(v_subject, 300), v_me);
    insert into tk_request_token_events (request_id, event, detail)
    values (r.id, 'dry_run', jsonb_build_object('action', p_action, 'mode', v_mode, 'recipients', cardinality(v_rcpt)));
  end if;
  return jsonb_build_object('mode', v_mode, 'dry_run', true, 'sent', 0, 'action', p_action,
                            'recipients', to_jsonb(v_rcpt), 'subject', v_subject);
end $$;

-- Staff list for a task or a client: everything the drawer and lists show.
create or replace function public.tk_list_client_requests(p_task_id uuid default null, p_client_id text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_client text := p_client_id;
  v_max int := public.tk__setting_int('nudge_max', 4, 0, 20);
begin
  if p_task_id is not null then
    if not public.tk_can_read_task(p_task_id) then
      raise exception 'tk_forbidden' using errcode = '42501';
    end if;
    select client_id into v_client from staff_reminders where id = p_task_id;
    if v_client is null then
      return '[]'::jsonb;
    end if;
  end if;
  perform public.tk__req_staff_guard(v_client);
  return coalesce((
    select jsonb_agg(x order by (x ->> 'asked_at') desc) from (
      select jsonb_build_object(
        'id', r.id, 'client_id', r.client_id, 'task_id', r.task_id, 'kind', r.kind, 'title', r.title,
        'prompt', r.prompt, 'needs_upload', r.needs_upload, 'due_date', r.due_date, 'status', r.status,
        'recipient_emails', to_jsonb(r.recipient_emails),
        'recipients', coalesce((select jsonb_agg(jsonb_build_object('email', e, 'name', cu.name, 'type', 'portal'))
                                  from unnest(r.recipient_emails) e
                                  left join client_users cu on cu.client_id = r.client_id and lower(cu.email) = e), '[]'::jsonb)
                      || coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'email', k.email, 'name', k.name, 'type', 'contact',
                                                                       'retired', k.deleted_at is not null))
                                     from client_contacts k where k.id = any (r.contact_ids)), '[]'::jsonb),
        'reply', r.reply, 'answered_via', r.answered_via, 'answered_by', r.answered_by, 'answered_at', r.answered_at,
        'accepted_by', r.accepted_by, 'accepted_at', r.accepted_at, 'cancelled_by', r.cancelled_by,
        'cancelled_at', r.cancelled_at, 'cancel_reason', r.cancel_reason, 'asked_by', r.asked_by, 'asked_at', r.asked_at,
        'link_ttl_days', r.link_ttl_days, 'last_nudged_at', r.last_nudged_at, 'nudge_count', r.nudge_count,
        'nudge_paused', r.nudge_paused, 'no_reply', r.status = 'open' and r.nudge_count >= v_max,
        'legacy', r.legacy_doc_request, 'legacy_file_name', r.legacy_file_name,
        'files', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'drive_file_id', f.drive_file_id,
                                                               'uploaded_at', f.uploaded_at) order by f.uploaded_at)
                             from client_files f where f.client_request_id = r.id and f.trashed_at is null), '[]'::jsonb),
        'links', (select jsonb_build_object('live', count(*) filter (where t.revoked_at is null and t.answered_at is null and t.expires_at > now()),
                                            'viewed_at', max(t.first_viewed_at), 'expires_at', max(t.expires_at) filter (where t.revoked_at is null))
                    from tk_request_tokens t where t.request_id = r.id),
        'business_days_waiting', case when r.status = 'open'
                                      then public.tk__business_days_since((r.asked_at at time zone 'America/Chicago')::date,
                                                                          (now() at time zone 'America/Chicago')::date) end
      ) x
        from client_requests r
       where r.deleted_at is null
         and (case when p_task_id is not null then r.task_id = p_task_id else r.client_id = v_client end)
       order by r.asked_at desc
       limit 200
    ) s), '[]'::jsonb);
end $$;

-- The Waiting list (#/tasks/waiting): open requests and waiting tasks on
-- clients the caller can reach (admins: all).
create or replace function public.tk_waiting_on_client(p_client_id text default null)
returns table (task_id uuid, title text, client_id text, client_name text, assignee_email text, task_status text,
               due_date date, request_id uuid, request_title text, request_kind text, asked_at timestamptz,
               asked_by text, business_days_waiting int, nudge_count int, last_nudged_at timestamptz,
               nudge_paused boolean, no_reply boolean, recipients int)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_max int := public.tk__setting_int('nudge_max', 4, 0, 20);
  v_today date := (now() at time zone 'America/Chicago')::date;
begin
  if not public.is_active_staff() then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  return query
  select s.id, s.text, r.client_id, c.name, s.assignee_email, s.status, s.due_date, r.id, r.title, r.kind, r.asked_at,
         r.asked_by, public.tk__business_days_since((r.asked_at at time zone 'America/Chicago')::date, v_today),
         r.nudge_count, r.last_nudged_at, r.nudge_paused, r.nudge_count >= v_max,
         cardinality(r.recipient_emails) + cardinality(r.contact_ids)
    from client_requests r
    join clients c on c.id = r.client_id
    left join staff_reminders s on s.id = r.task_id and s.deleted_at is null
   where r.status = 'open' and r.deleted_at is null and not r.legacy_doc_request
     and (p_client_id is null or r.client_id = p_client_id)
     and public.can_access_client(r.client_id)
  union all
  select s.id, s.text, s.client_id, c.name, s.assignee_email, s.status, s.due_date, null, null, null, s.waiting_since,
         null, public.tk__business_days_since((s.waiting_since at time zone 'America/Chicago')::date, v_today),
         0, null, false, false, 0
    from staff_reminders s
    join clients c on c.id = s.client_id
   where s.status = 'waiting_client' and s.deleted_at is null
     and (p_client_id is null or s.client_id = p_client_id)
     and public.can_access_client(s.client_id)
     and not exists (select 1 from client_requests r where r.task_id = s.id and r.status = 'open'
                        and r.deleted_at is null and not r.legacy_doc_request)
   order by 11 nulls last
   limit 500;
end $$;

-- Client-facing list (the S6 ClientNeeds page reads this).
create or replace function public.client_requests_for_client(p_client_id text)
returns table (id uuid, kind text, title text, prompt text, needs_upload boolean, due_date date, status text,
               asked_at timestamptz, asked_by_first_name text, answered_at timestamptz, file_count int)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.is_client_member(p_client_id)
          or (public.is_active_staff() and public.can_access_client(p_client_id))) then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  return query
  select r.id, r.kind, r.title, r.prompt, r.needs_upload, r.due_date, r.status, r.asked_at,
         nullif(split_part(btrim(coalesce(st.name, '')), ' ', 1), ''),
         r.answered_at,
         (select count(*)::int from client_files f where f.client_request_id = r.id and f.trashed_at is null)
    from client_requests r
    left join staff st on lower(st.email) = r.asked_by
   where r.client_id = p_client_id and r.deleted_at is null and r.status <> 'cancelled'
   order by (r.status = 'open') desc, r.asked_at desc
   limit 200;
end $$;

-- Portal answer (signed-in client member).
create or replace function public.tk_answer_client_request(p_id uuid, p_reply text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r client_requests;
  v_me text := public.tk__me();
begin
  select * into r from client_requests where id = p_id and deleted_at is null;
  if not found or not public.is_client_member(r.client_id) then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  if r.legacy_doc_request then
    raise exception 'tk_legacy_request' using errcode = '22023';
  end if;
  perform public.tk__request_answer(p_id, p_reply, 'portal', v_me, 'client:' || v_me, true);
end $$;

-- Link a just-uploaded request file (drive-files request branch, S6).
create or replace function public.tk_attach_request_file(p_request_id uuid, p_client_file_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r client_requests;
  f client_files;
  v_me text := public.tk__me();
begin
  select * into r from client_requests where id = p_request_id and deleted_at is null;
  select * into f from client_files where id = p_client_file_id and trashed_at is null for update;
  if r.id is null or f.id is null then
    raise exception 'tk_not_found' using errcode = 'P0002';
  end if;
  if not (public.is_active_staff() and public.can_access_client(r.client_id))
     and not (public.is_client_member(r.client_id) and lower(coalesce(f.uploaded_by, '')) = v_me) then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  if r.legacy_doc_request or r.status <> 'open' or f.client_id <> r.client_id or f.visibility <> 'request'
     or f.client_request_id is not null then
    raise exception 'tk_bad_request' using errcode = '22023';
  end if;
  update client_files set client_request_id = r.id where id = f.id;
end $$;

-- 9. Service-only token RPCs (the S6 public endpoint; service_role only) ----
create or replace function public.tk_rate_hit(p_key text, p_window_s int, p_max int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  if p_key is null or char_length(p_key) not between 1 and 200 or p_window_s < 1 or p_max < 1 then
    raise exception 'tk_bad_request' using errcode = '22023';
  end if;
  insert into tk_rate_buckets as b (key, window_start, count) values (p_key, now(), 1)
  on conflict (key) do update
    set window_start = case when b.window_start < now() - make_interval(secs => p_window_s) then now() else b.window_start end,
        count = case when b.window_start < now() - make_interval(secs => p_window_s) then 1 else b.count + 1 end
  returning count into n;
  return n <= p_max;
end $$;

create or replace function public.tk_log_token_event(p_token_id uuid, p_request_id uuid, p_event text,
                                                     p_ip_hash text, p_detail jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into tk_request_token_events (token_id, request_id, event, ip_hash, detail)
  values (p_token_id, p_request_id, p_event, left(p_ip_hash, 128), coalesce(p_detail, '{}'::jsonb));
end $$;

-- p_mode: send (first email), nudge (reminder; never revokes, M9), resend
-- (staff asked to resend: earlier live links for that contact are revoked).
-- At most 5 live links per (request, contact); the oldest go first.
create or replace function public.tk_issue_request_token(p_request_id uuid, p_contact_id uuid, p_email text, p_hash bytea,
                                                         p_ttl_days int, p_actor text, p_is_test boolean,
                                                         p_mode text default 'send')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  r client_requests;
  v_id uuid;
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  select * into r from client_requests where id = p_request_id and deleted_at is null for update;
  if not found or r.status <> 'open' or r.legacy_doc_request then
    raise exception 'tk_not_open' using errcode = '22023';
  end if;
  if p_hash is null or octet_length(p_hash) <> 32 or v_email = '' or coalesce(p_ttl_days, 0) not between 1 and 30
     or coalesce(p_mode, '') not in ('send', 'resend', 'nudge') or coalesce(btrim(p_actor), '') = '' then
    raise exception 'tk_bad_request' using errcode = '22023';
  end if;
  if p_contact_id is not null and not exists (
       select 1 from client_contacts k where k.id = p_contact_id and k.client_id = r.client_id
          and k.deleted_at is null and k.can_answer_requests and k.id = any (r.contact_ids)) then
    raise exception 'tk_bad_recipient' using errcode = '22023';
  end if;
  if p_mode = 'resend' then
    update tk_request_tokens set revoked_at = now(), revoked_by = left(p_actor, 300), revoke_reason = 'reissued'
     where request_id = p_request_id and contact_id is not distinct from p_contact_id
       and revoked_at is null and answered_at is null;
  end if;
  insert into tk_request_tokens (request_id, contact_id, recipient_email, token_hash, created_by, created_at, expires_at, is_test)
  values (p_request_id, p_contact_id, v_email, p_hash, left(p_actor, 300), clock_timestamp(),
          now() + make_interval(days => p_ttl_days), coalesce(p_is_test, false))
  returning id into v_id;
  update tk_request_tokens set revoked_at = now(), revoked_by = 'system', revoke_reason = 'cap'
   where id in (select t.id from tk_request_tokens t
                 where t.request_id = p_request_id and t.contact_id is not distinct from p_contact_id
                   and t.revoked_at is null and t.answered_at is null and t.expires_at > now()
                 order by t.created_at desc, t.id offset 5);
  insert into tk_request_token_events (token_id, request_id, event, detail)
  values (v_id, p_request_id, 'issued', jsonb_build_object('mode', p_mode, 'test', coalesce(p_is_test, false)));
  return v_id;
end $$;

create or replace function public.tk__token_state(t public.tk_request_tokens, r public.client_requests)
returns text
language sql
stable
set search_path = public
as $$
  select case
    when t.id is null or r.id is null or r.deleted_at is not null then 'invalid'
    when t.answered_at is not null or r.status in ('answered', 'accepted') then 'answered_already'
    when r.status = 'cancelled' then 'cancelled'
    when t.revoked_at is not null then 'revoked'
    when t.expires_at <= now() then 'expired'
    else 'ok' end;
$$;
revoke all on function public.tk__token_state(public.tk_request_tokens, public.client_requests) from public, anon, authenticated;

-- The exact view fields (C6). Nothing else ever leaves this function.
create or replace function public.tk_token_lookup(p_hash bytea)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t tk_request_tokens;
  r client_requests;
  v_state text;
  v_first text;
  v_client text;
begin
  select * into t from tk_request_tokens where token_hash = p_hash;
  if t.id is null then
    return jsonb_build_object('state', 'invalid');
  end if;
  select * into r from client_requests where id = t.request_id;
  v_state := public.tk__token_state(t, r);
  if v_state = 'ok' then
    update tk_request_tokens set view_count = view_count + 1, first_viewed_at = coalesce(first_viewed_at, now())
     where id = t.id;
  end if;
  insert into tk_request_token_events (token_id, request_id, event)
  values (t.id, t.request_id, case v_state when 'ok' then 'view' when 'expired' then 'expired'
                                           when 'answered_already' then 'answered_already'
                                           when 'invalid' then 'invalid' else 'revoked' end);
  if v_state <> 'ok' then
    return jsonb_build_object('state', v_state, 'token_id', t.id);
  end if;
  select nullif(split_part(btrim(coalesce(s.name, '')), ' ', 1), '') into v_first from staff s where lower(s.email) = r.asked_by;
  select c.name into v_client from clients c where c.id = r.client_id;
  return jsonb_build_object(
    'state', 'ok', 'token_id', t.id, 'request_id', r.id,   -- ids for the endpoint's own logging, never returned to the browser
    'view', jsonb_build_object(
      'title', r.title, 'prompt', r.prompt, 'kind', r.kind, 'needs_upload', r.needs_upload,
      'due_date', r.due_date, 'status', r.status, 'asked_on', (r.asked_at at time zone 'America/Chicago')::date,
      'asked_by_first_name', v_first, 'client_display_name', v_client,
      'expires_on', (t.expires_at at time zone 'America/Chicago')::date));
end $$;

-- p_files: [{drive_file_id, drive_folder_id, name, mime, size, year, doc_type}] already uploaded by the endpoint.
create or replace function public.tk_answer_request_by_token(p_hash bytea, p_reply text, p_files jsonb, p_ip_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t tk_request_tokens;
  r client_requests;
  v_state text;
  v_actor text;
  v_f jsonb;
  v_n int := 0;
begin
  select * into t from tk_request_tokens where token_hash = p_hash for update;
  if t.id is null then
    insert into tk_request_token_events (event, ip_hash) values ('invalid', left(p_ip_hash, 128));
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  select * into r from client_requests where id = t.request_id for update;
  v_state := public.tk__token_state(t, r);
  if v_state <> 'ok' then
    insert into tk_request_token_events (token_id, request_id, event, ip_hash)
    values (t.id, t.request_id, case v_state when 'expired' then 'expired' when 'answered_already' then 'answered_already'
                                             else 'revoked' end, left(p_ip_hash, 128));
    return jsonb_build_object('ok', false, 'error', v_state);
  end if;
  if t.answer_attempts >= 3 then
    insert into tk_request_token_events (token_id, request_id, event, ip_hash)
    values (t.id, t.request_id, 'rate_limited', left(p_ip_hash, 128));
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;
  update tk_request_tokens set answer_attempts = answer_attempts + 1 where id = t.id;
  if char_length(coalesce(p_reply, '')) > 4000
     or (p_files is not null and (jsonb_typeof(p_files) <> 'array' or jsonb_array_length(p_files) > 5)) then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  v_actor := 'contact:' || coalesce(t.contact_id::text, t.recipient_email);
  for v_f in select * from jsonb_array_elements(coalesce(p_files, '[]'::jsonb)) loop
    insert into client_files (client_id, drive_file_id, drive_folder_id, name, mime, size, year, doc_type, visibility,
                              uploaded_by, client_request_id)
    values (r.client_id, v_f ->> 'drive_file_id', v_f ->> 'drive_folder_id', left(coalesce(v_f ->> 'name', 'file'), 255),
            v_f ->> 'mime', (v_f ->> 'size')::bigint,
            coalesce((v_f ->> 'year')::int, extract(year from now())::int), coalesce(v_f ->> 'doc_type', 'Other'),
            'request', v_actor, r.id);
    v_n := v_n + 1;
  end loop;
  update tk_request_tokens set answered_at = now() where id = t.id;
  perform public.tk__request_answer(r.id, p_reply, 'link', v_actor, v_actor, true);
  insert into tk_request_token_events (token_id, request_id, event, ip_hash, detail)
  values (t.id, r.id, 'answer', left(p_ip_hash, 128), jsonb_build_object('files', v_n));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.tk_stop_nudges_by_token(p_hash bytea)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t tk_request_tokens;
begin
  select * into t from tk_request_tokens where token_hash = p_hash;
  if t.id is null or t.revoked_at is not null then
    return;
  end if;
  update client_requests set nudge_paused = true, updated_at = now() where id = t.request_id and status = 'open';
  insert into tk_request_token_events (token_id, request_id, event) values (t.id, t.request_id, 'stop_nudges');
end $$;

-- 10. M1: internal coverage grant (the S7 OOO handoff calls it) -------------
-- Same checks as grant_coverage_access, the admin check kept (the JWT
-- caller must be an active admin), and the grant capped at the lesser of
-- the day after the time off and 31 days from now.
create or replace function public.tk__grant_coverage(p_time_off_id uuid, p_client_id text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  t staff_time_off;
  v_backup text;
  v_backup_name text;
  v_backup_role text;
  v_today date := (now() at time zone 'America/Chicago')::date;
  v_expires timestamptz;
  v_span int;
  v_away_name text;
  v_id uuid;
begin
  if not public.is_active_staff_admin() then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  if exists (select 1 from clients ic where ic.id = p_client_id and ic.is_internal) then
    raise exception 'tk_bad_request' using errcode = '22023';
  end if;
  select * into t from staff_time_off where id = p_time_off_id;
  if not found or t.cancelled_at is not null or t.ends_on < v_today then
    raise exception 'tk_bad_request' using errcode = '22023';
  end if;
  if not exists (select 1 from clients c where c.id = p_client_id
                   and (lower(coalesce(c.assigned_bookkeeper_email, '')) = t.staff_email
                        or exists (select 1 from staff_client_access a where a.client_id = c.id and lower(a.staff_email) = t.staff_email))) then
    raise exception 'tk_bad_request' using errcode = '22023';
  end if;
  select lower(backup_bookkeeper_email) into v_backup from client_profile where client_id = p_client_id;
  if v_backup is null or v_backup = '' then
    raise exception 'tk_no_backup' using errcode = '22023';
  end if;
  select s.name, s.role into v_backup_name, v_backup_role from staff s where lower(s.email) = v_backup and s.active;
  if not found then
    raise exception 'tk_no_backup' using errcode = '22023';
  end if;
  if v_backup_role = 'admin'
     or exists (select 1 from staff_client_access a where a.client_id = p_client_id and lower(a.staff_email) = v_backup) then
    return null;   -- already has access
  end if;
  v_expires := least((t.ends_on + 1)::timestamp at time zone 'America/Chicago', now() + interval '31 days');
  select g.id into v_id from staff_client_access_grants g
   where g.client_id = p_client_id and lower(g.staff_email) = v_backup and g.status = 'approved' and g.expires_at >= v_expires
   limit 1;
  if v_id is not null then
    return v_id;
  end if;
  select coalesce(s.name, t.staff_email) into v_away_name from staff s where lower(s.email) = t.staff_email;
  v_span := greatest(1, ceil(extract(epoch from v_expires - now()) / 86400)::int);
  insert into staff_client_access_grants
    (client_id, staff_email, staff_name, reason, duration_days, status, decided_by, decided_at, expires_at)
  values (p_client_id, v_backup, v_backup_name,
          left('Covering for ' || coalesce(v_away_name, t.staff_email) || ' (time off ' ||
               to_char(t.starts_on, 'Mon DD') || ' to ' || to_char(t.ends_on, 'Mon DD') || ')', 500),
          case when v_span <= 1 then 1 when v_span <= 7 then 7 else 30 end,
          'approved', public.tk__me(), now(), v_expires)
  returning id into v_id;
  return v_id;
end $$;

-- 11. Grants -------------------------------------------------------------------
do $$
declare f text;
begin
  -- staff and client RPCs (each checks the caller itself)
  foreach f in array array[
    'public.tk_save_client_contact(uuid, text, text, text, text, boolean, text)',
    'public.tk_retire_client_contact(uuid)',
    'public.tk_request_recipients(text)',
    'public.tk_ask_client(text, uuid, text, text, text, boolean, date, text[], uuid[], int)',
    'public.tk_cancel_client_request(uuid, text)',
    'public.tk_accept_client_request(uuid)',
    'public.tk_record_client_answer(uuid, text)',
    'public.tk_revoke_request_tokens(uuid, text)',
    'public.tk_set_request_nudge_paused(uuid, boolean)',
    'public.tk_client_request_send(uuid, text)',
    'public.tk_list_client_requests(uuid, text)',
    'public.tk_waiting_on_client(text)',
    'public.client_requests_for_client(text)',
    'public.tk_answer_client_request(uuid, text)',
    'public.tk_attach_request_file(uuid, uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  -- service-only (S6 public endpoint)
  foreach f in array array[
    'public.tk_rate_hit(text, int, int)',
    'public.tk_log_token_event(uuid, uuid, text, text, jsonb)',
    'public.tk_issue_request_token(uuid, uuid, text, bytea, int, text, boolean, text)',
    'public.tk_token_lookup(bytea)',
    'public.tk_answer_request_by_token(bytea, text, jsonb, text)',
    'public.tk_stop_nudges_by_token(bytea)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  -- internal only
  foreach f in array array[
    'public.tk__grant_coverage(uuid, text)',
    'public.tk__legacy_status(text)',
    'public.tk_client_doc_requests_mirror()',
    'public.tk_client_files_request_link()',
    'public.tk_staff_reminders_request_guard()',
    'public.tk_request_token_events_append_only()',
    'public.tk__me()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;
-- tk__me is used by RPCs only; authenticated callers reach it through them.

create or replace function public.tk_schema_version()
returns integer
language sql
stable
set search_path = public
as $$ select 6 $$;
