-- =====================================================================
-- Tasks Phase 2, S6: link tokens, the public answer endpoint's RPCs,
-- the sender and nudge plumbing, and the S5 review fixes.
-- Spec: docs/tasks-phase2-spec.md C6 (+ C5 leftovers).
-- Critique fixes applied here: M8 (staged one-file uploads, token checked
-- before any body is read), M9 (nudges never revoke), M11 (trigger
-- 'manual'/'test' for staff sends), M13 (client_doc_requests read-only,
-- client_doc_chase FK moved), m6-m8 (stop needs a token in good standing,
-- ip_hash logged, nothing personal in events).
--
-- What this file does (safe to re-run, one transaction, nothing dropped
-- except superseded service-only function signatures):
--   0. S5 review major: tk_issue_request_token checks the recipient when
--      there is no contact (must be on the request), and the 5-link cap and
--      resend are per recipient, not per "no contact" bucket.
--   1. S5 minors: tk_list_client_requests(task) matches the task's current
--      client; stop-reminders refuses expired/answered/revoked links and
--      logs ip_hash; an empty answer still counts as an attempt; the token
--      event log blocks TRUNCATE; a client_doc_requests DELETE is mirrored.
--   2. Token RPCs for tk-request-respond: lookup (with ip_hash), gate (no
--      view count, for the upload pre-check), stage one file, answer
--      (JSON, staged files), stop reminders, rate peek.
--   3. Sender: tk_client_request_send (user RPC: preview, dry run, plan for
--      test/live) + service-only claim/finish for the tk-client-requests
--      edge function. Nudges: service-only plan + mark, cron
--      client-request-nudge (the client-emails job is a dry run unless the
--      owner's client_request_enabled switch is on and the client is in the
--      pilot list).
--   4. client_doc_requests becomes read-only (BEFORE trigger + revoked
--      writes). Staff write through tk_add_doc_request /
--      tk_set_doc_request_status; fulfill_doc_request sets the bypass flag.
--      client_doc_chase.request_id now references client_requests (cascade, as before).
--   5. client_requests joins the realtime publication (column grants hold:
--      realtime.apply_rls filters by has_column_privilege).
--   6. tk__trg_is_admin / tk__trg_default_reviewer answer only inside a
--      trigger (the staff_reminders trigger is not a definer, so EXECUTE
--      must stay; a direct RPC call now gets false/null).
--
-- Email: nothing here sends mail. Tokens: only sha256 hashes reach SQL.
-- =====================================================================

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

-- 0. Trigger-only helpers (S4 leftover) ------------------------------------
create or replace function public.tk__trg_is_admin(p_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when pg_trigger_depth() = 0 then false   -- tk p2 s6: answers only inside a trigger
    when auth.uid() is null and coalesce(auth.jwt() ->> 'email', '') = '' then public.tk__is_active_admin(p_email)
    when public.is_active_staff() then public.tk__is_active_admin(p_email)
    else false
  end;
$$;

create or replace function public.tk__trg_default_reviewer(p_client text, p_exclude text[])
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when pg_trigger_depth() = 0 then null   -- tk p2 s6: answers only inside a trigger
    when auth.uid() is null and coalesce(auth.jwt() ->> 'email', '') = '' then public.tk__default_reviewer(p_client, p_exclude)
    when public.is_active_staff() and (p_client is null or public.can_access_client(p_client))
      then public.tk__default_reviewer(p_client, p_exclude)
    else null
  end;
$$;
revoke all on function public.tk__trg_is_admin(text) from public, anon;
revoke all on function public.tk__trg_default_reviewer(text, text[]) from public, anon;

-- 1. Token events: append-only also blocks TRUNCATE ------------------------
create or replace function public.tk_request_token_events_no_truncate()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'tk_append_only' using errcode = '42501';
end $$;
drop trigger if exists tk_request_token_events_no_truncate on public.tk_request_token_events;
create trigger tk_request_token_events_no_truncate before truncate on public.tk_request_token_events
  for each statement execute function public.tk_request_token_events_no_truncate();
revoke truncate on public.tk_request_token_events from public, anon, authenticated;

-- 2. client_doc_requests: read-only, mirrored deletes, chase FK -------------
create or replace function public.tk_client_doc_requests_lock()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(current_setting('mgb.tk_legacy_write', true), '') = 'on'
     or coalesce(current_setting('mgb.offboarding', true), '') = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception 'tk_legacy_read_only' using errcode = '42501',
    hint = 'Document requests are written through tk_add_doc_request / tk_set_doc_request_status.';
end $$;
drop trigger if exists tk_client_doc_requests_lock on public.client_doc_requests;
create trigger tk_client_doc_requests_lock before insert or update or delete on public.client_doc_requests
  for each row execute function public.tk_client_doc_requests_lock();
revoke insert, update, delete, truncate on public.client_doc_requests from public, anon, authenticated;

create or replace function public.tk_client_doc_requests_mirror_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update client_requests set deleted_at = now(), updated_at = now()
   where id = old.id and legacy_doc_request and deleted_at is null;
  return null;
end $$;
drop trigger if exists tk_client_doc_requests_mirror_delete on public.client_doc_requests;
create trigger tk_client_doc_requests_mirror_delete after delete on public.client_doc_requests
  for each row execute function public.tk_client_doc_requests_mirror_delete();

do $$
begin
  if exists (select 1 from pg_constraint
              where conrelid = 'public.client_doc_chase'::regclass and conname = 'client_doc_chase_request_id_fkey'
                and confrelid = 'public.client_doc_requests'::regclass) then
    alter table public.client_doc_chase drop constraint client_doc_chase_request_id_fkey;
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.client_doc_chase'::regclass and conname = 'client_doc_chase_request_id_fkey') then
    alter table public.client_doc_chase add constraint client_doc_chase_request_id_fkey
      foreign key (request_id) references public.client_requests(id) on delete cascade;
  end if;
end $$;

-- Staff writers for the Documents panel (app.jsx staffToolsApi).
create or replace function public.tk_add_doc_request(p_client_id text, p_title text, p_details text default null,
                                                     p_due_date date default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := public.tk__me();
  v_title text := btrim(coalesce(p_title, ''));
  v_details text := nullif(btrim(coalesce(p_details, '')), '');
  v_name text;
  v_id uuid;
begin
  perform public.tk__req_staff_guard(p_client_id);
  if v_title = '' or char_length(v_title) > 200 or char_length(coalesce(v_details, '')) > 2000 then
    raise exception 'tk_bad_request' using errcode = '22023';
  end if;
  select coalesce(nullif(btrim(s.name), ''), v_me) into v_name from staff s where lower(s.email) = v_me;
  perform set_config('mgb.tk_legacy_write', 'on', true);
  insert into client_doc_requests (client_id, title, details, due_date, requested_by, requested_by_name)
  values (p_client_id, v_title, v_details, p_due_date, v_me, coalesce(v_name, v_me))
  returning id into v_id;
  perform set_config('mgb.tk_legacy_write', '', true);
  return v_id;
end $$;

create or replace function public.tk_set_doc_request_status(p_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client text;
begin
  select client_id into v_client from client_doc_requests where id = p_id;
  if v_client is null then
    raise exception 'tk_not_found' using errcode = 'P0002';
  end if;
  perform public.tk__req_staff_guard(v_client);
  if coalesce(p_status, '') not in ('open', 'uploaded', 'done', 'cancelled') then
    raise exception 'tk_bad_request' using errcode = '22023';
  end if;
  perform set_config('mgb.tk_legacy_write', 'on', true);
  update client_doc_requests
     set status = p_status, closed_at = case when p_status in ('done', 'cancelled') then now() end
   where id = p_id;
  perform set_config('mgb.tk_legacy_write', '', true);
end $$;

-- fulfill_doc_request (portal + drive-files legacy uploads) keeps working.
select pg_temp.patch_fn('public.fulfill_doc_request(uuid, text, text)',
$a$  update client_doc_requests
     set status = 'uploaded',$a$,
$b$  perform set_config('mgb.tk_legacy_write', 'on', true);   -- tk p2 s6: the table is read-only otherwise
  update client_doc_requests
     set status = 'uploaded',$b$, 1);
select pg_temp.patch_fn('public.fulfill_doc_request(uuid, text, text)',
$a$   where id = p_id and status in ('open', 'uploaded');
end;$a$,
$b$   where id = p_id and status in ('open', 'uploaded');
  perform set_config('mgb.tk_legacy_write', '', true);
end;$b$, 1);

-- 3. S5 review major: per-recipient tokens ---------------------------------
-- p_mode: send (first email), nudge (reminder; never revokes, M9), resend
-- (staff asked to resend: that recipient's earlier live links are revoked).
-- Recipient rules:
--   * a contact: live, can answer, on the request; the email must be the
--     contact's own (a test copy goes to the caller instead, see below);
--   * no contact: the email must be one of the request's recipient_emails
--     and still an active portal user of the client;
--   * is_test: only on a test_only client, and the email is the caller's
--     (p_actor 'staff:<email>').
-- At most 5 live links per (request, recipient); the oldest go first.
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
  v_test boolean := coalesce(p_is_test, false);
  v_caller text := lower(regexp_replace(btrim(coalesce(p_actor, '')), '^staff:', ''));
  v_contact_email text;
begin
  select * into r from client_requests where id = p_request_id and deleted_at is null for update;
  if not found or r.status <> 'open' or r.legacy_doc_request then
    raise exception 'tk_not_open' using errcode = '22023';
  end if;
  if p_hash is null or octet_length(p_hash) <> 32 or v_email = '' or coalesce(p_ttl_days, 0) not between 1 and 30
     or coalesce(p_mode, '') not in ('send', 'resend', 'nudge') or coalesce(btrim(p_actor), '') = '' then
    raise exception 'tk_bad_request' using errcode = '22023';
  end if;
  if v_test then
    if not exists (select 1 from clients c where c.id = r.client_id and c.test_only) or v_email <> v_caller then
      raise exception 'tk_bad_recipient' using errcode = '22023';
    end if;
  end if;
  if p_contact_id is not null then
    select k.email into v_contact_email from client_contacts k
     where k.id = p_contact_id and k.client_id = r.client_id and k.deleted_at is null
       and k.can_answer_requests and k.id = any (r.contact_ids);
    if v_contact_email is null or (not v_test and v_contact_email <> v_email) then
      raise exception 'tk_bad_recipient' using errcode = '22023';
    end if;
  elsif not v_test then
    if not (v_email = any (r.recipient_emails))
       or not exists (select 1 from client_users cu where cu.client_id = r.client_id and cu.active and lower(cu.email) = v_email) then
      raise exception 'tk_bad_recipient' using errcode = '22023';
    end if;
  end if;
  if p_mode = 'resend' then
    with x as (
      update tk_request_tokens set revoked_at = now(), revoked_by = left(p_actor, 300), revoke_reason = 'reissued'
       where request_id = p_request_id and contact_id is not distinct from p_contact_id
         and (p_contact_id is not null or recipient_email = v_email)
         and revoked_at is null and answered_at is null
      returning id
    )
    insert into tk_request_token_events (token_id, request_id, event, detail)
    select id, p_request_id, 'revoked', jsonb_build_object('reason', 'reissued') from x;
  end if;
  insert into tk_request_tokens (request_id, contact_id, recipient_email, token_hash, created_by, created_at, expires_at, is_test)
  values (p_request_id, p_contact_id, v_email, p_hash, left(p_actor, 300), clock_timestamp(),
          now() + make_interval(days => p_ttl_days), v_test)
  returning id into v_id;
  update tk_request_tokens set revoked_at = now(), revoked_by = 'system', revoke_reason = 'cap'
   where id in (select t.id from tk_request_tokens t
                 where t.request_id = p_request_id and t.contact_id is not distinct from p_contact_id
                   and (p_contact_id is not null or t.recipient_email = v_email)
                   and t.revoked_at is null and t.answered_at is null and t.expires_at > now()
                 order by t.created_at desc, t.id offset 5);
  insert into tk_request_token_events (token_id, request_id, event, detail)
  values (v_id, p_request_id, 'issued', jsonb_build_object('mode', p_mode, 'test', v_test));
  return v_id;
end $$;

-- 4. S5 minor: the task path matches the task's current client --------------
select pg_temp.patch_fn('public.tk_list_client_requests(uuid, text)',
$a$and (case when p_task_id is not null then r.task_id = p_task_id else r.client_id = v_client end)$a$,
$b$and r.client_id = v_client and (p_task_id is null or r.task_id = p_task_id)   -- tk p2 s6: task moved to another client$b$, 1);

-- 5. Endpoint RPCs (service_role only) --------------------------------------
create or replace function public.tk__token_event_for(p_state text)
returns text
language sql
immutable
set search_path = public
as $$
  select case p_state when 'ok' then 'view' when 'expired' then 'expired' when 'answered_already' then 'answered_already'
                      when 'invalid' then 'invalid' else 'revoked' end;
$$;
revoke all on function public.tk__token_event_for(text) from public, anon, authenticated;

create or replace function public.tk__token_actor(t public.tk_request_tokens)
returns text
language sql
immutable
set search_path = public
as $$ select 'contact:' || coalesce(t.contact_id::text, t.recipient_email) $$;
revoke all on function public.tk__token_actor(public.tk_request_tokens) from public, anon, authenticated;

-- Check a rate bucket without counting a hit (true = still under the limit).
create or replace function public.tk_rate_peek(p_key text, p_window_s int, p_max int)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select b.window_start < now() - make_interval(secs => p_window_s) or b.count < p_max
                     from tk_rate_buckets b where b.key = p_key), true);
$$;

drop function if exists public.tk_token_lookup(bytea);
-- The exact view fields (C6). Nothing else ever leaves this function for
-- the browser; token_id/request_id are for the endpoint's own rate keys.
create or replace function public.tk_token_lookup(p_hash bytea, p_ip_hash text)
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
  v_ip text := left(p_ip_hash, 128);
begin
  select * into t from tk_request_tokens where token_hash = p_hash;
  if t.id is null then
    insert into tk_request_token_events (event, ip_hash) values ('invalid', v_ip);
    return jsonb_build_object('state', 'invalid');
  end if;
  select * into r from client_requests where id = t.request_id;
  v_state := public.tk__token_state(t, r);
  if v_state = 'ok' then
    update tk_request_tokens set view_count = view_count + 1, first_viewed_at = coalesce(first_viewed_at, now())
     where id = t.id;
  end if;
  insert into tk_request_token_events (token_id, request_id, event, ip_hash)
  values (t.id, t.request_id, public.tk__token_event_for(v_state), v_ip);
  select nullif(split_part(btrim(coalesce(s.name, '')), ' ', 1), '') into v_first from staff s where lower(s.email) = r.asked_by;
  if v_state <> 'ok' then
    -- first name only, for the "ask <first name>" line on the expired page
    return jsonb_build_object('state', v_state, 'token_id', t.id, 'request_id', t.request_id,
                              'view', jsonb_build_object('asked_by_first_name', v_first));
  end if;
  select c.name into v_client from clients c where c.id = r.client_id;
  return jsonb_build_object(
    'state', 'ok', 'token_id', t.id, 'request_id', r.id,
    'view', jsonb_build_object(
      'title', r.title, 'prompt', r.prompt, 'kind', r.kind, 'needs_upload', r.needs_upload,
      'due_date', r.due_date, 'status', r.status, 'asked_on', (r.asked_at at time zone 'America/Chicago')::date,
      'asked_by_first_name', v_first, 'client_display_name', v_client,
      'expires_on', (t.expires_at at time zone 'America/Chicago')::date));
end $$;

-- Upload pre-check (M8): token state and room for another file, before the
-- endpoint reads any body. Counts no view. Returns internal fields for the
-- Drive folder (never sent to the browser).
create or replace function public.tk_token_gate(p_hash bytea, p_ip_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t tk_request_tokens;
  r client_requests;
  v_state text;
  v_n int;
  v_ip text := left(p_ip_hash, 128);
begin
  select * into t from tk_request_tokens where token_hash = p_hash;
  if t.id is null then
    insert into tk_request_token_events (event, ip_hash) values ('invalid', v_ip);
    return jsonb_build_object('state', 'invalid');
  end if;
  select * into r from client_requests where id = t.request_id;
  v_state := public.tk__token_state(t, r);
  if v_state <> 'ok' then
    insert into tk_request_token_events (token_id, request_id, event, ip_hash)
    values (t.id, t.request_id, public.tk__token_event_for(v_state), v_ip);
    return jsonb_build_object('state', v_state, 'token_id', t.id, 'request_id', t.request_id);
  end if;
  if t.answer_attempts >= 3 then
    return jsonb_build_object('state', 'rate_limited', 'token_id', t.id, 'request_id', t.request_id);
  end if;
  select count(*) into v_n from client_files f
   where f.client_request_id = r.id and f.uploaded_by = public.tk__token_actor(t) and f.trashed_at is null;
  return jsonb_build_object('state', 'ok', 'token_id', t.id, 'request_id', r.id, 'client_id', r.client_id,
                            'client_name', (select c.name from clients c where c.id = r.client_id),
                            'title', r.title, 'needs_upload', r.needs_upload, 'files_left', greatest(0, 5 - v_n));
end $$;

-- One uploaded file (already in the client's Drive folder) linked to the
-- request. The endpoint trashes the Drive file if this returns ok=false.
-- p_file: {drive_file_id, drive_folder_id, name, mime, size, year, doc_type}
create or replace function public.tk_stage_request_file_by_token(p_hash bytea, p_file jsonb, p_ip_hash text)
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
  v_n int;
  v_id uuid;
  v_size bigint;
  v_year int;
  v_ip text := left(p_ip_hash, 128);
begin
  select * into t from tk_request_tokens where token_hash = p_hash for update;
  if t.id is null then
    insert into tk_request_token_events (event, ip_hash) values ('invalid', v_ip);
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  select * into r from client_requests where id = t.request_id for update;
  v_state := public.tk__token_state(t, r);
  if v_state <> 'ok' then
    insert into tk_request_token_events (token_id, request_id, event, ip_hash)
    values (t.id, t.request_id, public.tk__token_event_for(v_state), v_ip);
    return jsonb_build_object('ok', false, 'error', v_state);
  end if;
  if t.answer_attempts >= 3 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;
  begin
    v_size := (p_file ->> 'size')::bigint;
    v_year := coalesce((p_file ->> 'year')::int, extract(year from now())::int);
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end;
  if not r.needs_upload or jsonb_typeof(p_file) <> 'object'
     or coalesce(p_file ->> 'drive_file_id', '') !~ '^[A-Za-z0-9_-]{10,200}$'
     or char_length(coalesce(p_file ->> 'drive_folder_id', '')) > 200
     or char_length(btrim(coalesce(p_file ->> 'name', ''))) not between 1 and 255
     or char_length(coalesce(p_file ->> 'mime', '')) not between 3 and 200
     or v_size is null or v_size not between 1 and 26214400
     or v_year not between 2000 and 2100
     or char_length(coalesce(p_file ->> 'doc_type', '')) > 60 then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  v_actor := public.tk__token_actor(t);
  select count(*) into v_n from client_files f
   where f.client_request_id = r.id and f.uploaded_by = v_actor and f.trashed_at is null;
  if v_n >= 5 then
    return jsonb_build_object('ok', false, 'error', 'too_many');
  end if;
  insert into client_files (client_id, drive_file_id, drive_folder_id, name, mime, size, year, doc_type, visibility,
                            uploaded_by, client_request_id)
  values (r.client_id, p_file ->> 'drive_file_id', nullif(p_file ->> 'drive_folder_id', ''), btrim(p_file ->> 'name'),
          p_file ->> 'mime', v_size, v_year, coalesce(nullif(p_file ->> 'doc_type', ''), 'Other'), 'request', v_actor, r.id)
  returning id into v_id;
  insert into tk_request_token_events (token_id, request_id, event, ip_hash, detail)
  values (t.id, r.id, 'upload', v_ip, jsonb_build_object('n', v_n + 1));
  return jsonb_build_object('ok', true, 'file_id', v_id, 'files_left', 4 - v_n);
end $$;

drop function if exists public.tk_answer_request_by_token(bytea, text, jsonb, text);
-- JSON answer (M8): the reply plus the ids of files this link staged.
create or replace function public.tk_answer_request_by_token(p_hash bytea, p_reply text, p_file_ids uuid[], p_ip_hash text)
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
  v_reply text := nullif(btrim(coalesce(p_reply, '')), '');
  v_ids uuid[] := coalesce(p_file_ids, '{}');
  v_linked int;
  v_ip text := left(p_ip_hash, 128);
begin
  select * into t from tk_request_tokens where token_hash = p_hash for update;
  if t.id is null then
    insert into tk_request_token_events (event, ip_hash) values ('invalid', v_ip);
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  select * into r from client_requests where id = t.request_id for update;
  v_state := public.tk__token_state(t, r);
  if v_state <> 'ok' then
    insert into tk_request_token_events (token_id, request_id, event, ip_hash)
    values (t.id, t.request_id, public.tk__token_event_for(v_state), v_ip);
    return jsonb_build_object('ok', false, 'error', v_state);
  end if;
  if t.answer_attempts >= 3 then
    insert into tk_request_token_events (token_id, request_id, event, ip_hash)
    values (t.id, t.request_id, 'rate_limited', v_ip);
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;
  -- Every attempt counts, including the ones refused below (no exception,
  -- so the increment is kept).
  update tk_request_tokens set answer_attempts = answer_attempts + 1 where id = t.id;
  v_actor := public.tk__token_actor(t);
  if char_length(coalesce(v_reply, '')) > 4000 or cardinality(v_ids) > 5
     or exists (select 1 from unnest(v_ids) i
                 where not exists (select 1 from client_files f where f.id = i and f.client_request_id = r.id
                                     and f.uploaded_by = v_actor and f.trashed_at is null)) then
    return jsonb_build_object('ok', false, 'error', 'bad_request');
  end if;
  -- Only this link's own files count (S6 review): a portal user's or another
  -- contact's upload on the same request does not answer for this person.
  select count(*) into v_linked from client_files f
   where f.client_request_id = r.id and f.uploaded_by = v_actor and f.trashed_at is null;
  if v_reply is null and v_linked = 0 then
    return jsonb_build_object('ok', false, 'error', 'reply_required');
  end if;
  update tk_request_tokens set answered_at = now() where id = t.id;
  perform public.tk__request_answer(r.id, v_reply, 'link', v_actor, v_actor, true);
  insert into tk_request_token_events (token_id, request_id, event, ip_hash, detail)
  values (t.id, r.id, 'answer', v_ip, jsonb_build_object('files', cardinality(v_ids)));
  return jsonb_build_object('ok', true);
end $$;

drop function if exists public.tk_stop_nudges_by_token(bytea);
-- "Stop reminders" (S6 review): one reminder email can list several requests
-- but carries one stop link, so the stop is per person: it pauses every open
-- request on this client that lists this link's contact (or address). It
-- still works after that link was used, expired or replaced (stopping is
-- harmless and the link proves who it is), but not on an unknown link or one
-- staff revoked on purpose (revoked by staff, or the contact was retired).
create or replace function public.tk_stop_nudges_by_token(p_hash bytea, p_ip_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t tk_request_tokens;
  r client_requests;
  v_state text;
  v_n int;
  v_ip text := left(p_ip_hash, 128);
begin
  select * into t from tk_request_tokens where token_hash = p_hash;
  if t.id is null then
    insert into tk_request_token_events (event, ip_hash) values ('invalid', v_ip);
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  select * into r from client_requests where id = t.request_id;
  v_state := public.tk__token_state(t, r);
  if v_state = 'invalid' or t.revoke_reason in ('staff', 'contact_retired') then
    insert into tk_request_token_events (token_id, request_id, event, ip_hash)
    values (t.id, t.request_id, public.tk__token_event_for(case when v_state = 'invalid' then 'invalid' else 'revoked' end), v_ip);
    return jsonb_build_object('ok', false, 'error', case when v_state = 'invalid' then 'invalid' else 'revoked' end);
  end if;
  with u as (
    update client_requests q set nudge_paused = true, updated_at = now()
     where q.client_id = r.client_id and q.status = 'open' and q.deleted_at is null and not q.nudge_paused
       and (case when t.contact_id is not null then t.contact_id = any (q.contact_ids)
                 else lower(t.recipient_email) = any (q.recipient_emails) end)
    returning q.id)
  select count(*) into v_n from u;
  insert into tk_request_token_events (token_id, request_id, event, ip_hash, detail)
  values (t.id, r.id, 'stop_nudges', v_ip, jsonb_build_object('paused', v_n));
  return jsonb_build_object('ok', true, 'paused', v_n);
end $$;

-- 6. Sender ---------------------------------------------------------------------
-- User RPC (staff JWT). preview: the plan, nothing logged. Dry run: logs a
-- skipped client_email_log row + a dry_run event (S5 behavior). Test/live:
-- returns the plan with needs_sender=true; only the tk-client-requests edge
-- function sends (claim/finish below). p_target (resend): a contact id or
-- a portal email on the request.
drop function if exists public.tk_client_request_send(uuid, text);
create or replace function public.tk_client_request_send(p_id uuid, p_action text default 'send', p_target text default null)
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
  v_targets jsonb;
  v_rcpt text[];
  v_first text;
  v_target text := lower(btrim(coalesce(p_target, '')));
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
  select nullif(split_part(btrim(coalesce(s.name, '')), ' ', 1), '') into v_first from staff s where lower(s.email) = r.asked_by;
  v_subject := case when p_action = 'nudge'
                    then format('Reminder: 1 item %s still needs from you', coalesce(v_client, 'your organization'))
                    else format('%s: %s', coalesce(v_client, 'Your organization'), r.title) end;
  select coalesce(jsonb_agg(x order by x ->> 'email'), '[]'::jsonb) into v_targets from (
    select jsonb_build_object('type', 'portal', 'email', e, 'name', cu.name) x
      from unnest(r.recipient_emails) e
      join client_users cu on cu.client_id = r.client_id and cu.active and lower(cu.email) = e
     where not exists (select 1 from client_email_recipients er
                        where er.client_id = r.client_id and lower(er.email) = e and er.opted_out_at is not null)
    union all
    select jsonb_build_object('type', 'contact', 'email', k.email, 'name', k.name, 'contact_id', k.id)
      from client_contacts k
     where k.id = any (r.contact_ids) and k.deleted_at is null and k.can_answer_requests
  ) s
  where v_target = '' or x ->> 'email' = v_target or x ->> 'contact_id' = v_target;
  if v_target <> '' and jsonb_array_length(v_targets) = 0 then
    raise exception 'tk_bad_recipient' using errcode = '22023';
  end if;
  if v_mode = 'test' then
    v_rcpt := array[v_me];   -- a test client's copy only ever goes to the caller
  else
    select coalesce(array_agg(x ->> 'email' order by x ->> 'email'), '{}') into v_rcpt from jsonb_array_elements(v_targets) x;
  end if;
  if p_action <> 'preview' and v_mode = 'dry_run' then
    insert into client_email_log (feature, trigger, client_id, status, reason, recipients, request_ids, subject, requested_by)
    values (case when p_action = 'nudge' then 'client_request_nudge' else 'client_request' end, 'manual', r.client_id,
            'skipped', 'dry_run', v_rcpt, array[r.id], left(v_subject, 300), v_me);
    insert into tk_request_token_events (request_id, event, detail)
    values (r.id, 'dry_run', jsonb_build_object('action', p_action, 'mode', v_mode, 'recipients', cardinality(v_rcpt)));
  end if;
  return jsonb_build_object('mode', v_mode, 'dry_run', v_mode = 'dry_run', 'sent', 0, 'action', p_action,
                            'needs_sender', p_action <> 'preview' and v_mode in ('test', 'live'),
                            'recipients', to_jsonb(v_rcpt), 'targets', v_targets, 'subject', v_subject,
                            'client_id', r.client_id, 'client_name', v_client, 'staff_first_name', v_first,
                            'asked_by', r.asked_by, 'title', r.title, 'prompt', r.prompt, 'kind', r.kind,
                            'needs_upload', r.needs_upload, 'due_date', r.due_date, 'link_ttl_days', r.link_ttl_days);
end $$;

-- Service-only: claim before send (10-minute guard on live sends).
create or replace function public.tk_request_send_claim(p_id uuid, p_action text, p_actor text, p_mode text,
                                                        p_recipients text[], p_subject text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  r client_requests;
  v_id uuid;
  v_feature text := case when p_action = 'nudge' then 'client_request_nudge' else 'client_request' end;
begin
  select * into r from client_requests where id = p_id and deleted_at is null for update;
  if not found or r.status <> 'open' or r.legacy_doc_request then
    raise exception 'tk_not_open' using errcode = '22023';
  end if;
  if coalesce(p_mode, '') not in ('test', 'live') or coalesce(p_action, '') not in ('send', 'resend', 'nudge') then
    raise exception 'tk_bad_request' using errcode = '22023';
  end if;
  if p_mode <> public.tk__request_send_mode(r.client_id) then
    raise exception 'tk_mode_changed' using errcode = '22023';
  end if;
  if p_mode = 'live' and exists (
       select 1 from client_email_log l
        where l.feature = v_feature and p_id = any (l.request_ids) and l.trigger = 'manual'
          and l.created_at > now() - interval '10 minutes'
          and (l.status = 'sent' or (l.status = 'skipped' and l.reason = 'claimed'))) then
    raise exception 'tk_too_soon' using errcode = '22023';
  end if;
  insert into client_email_log (feature, trigger, client_id, status, reason, recipients, request_ids, subject, requested_by)
  values (v_feature, case when p_mode = 'test' then 'test' else 'manual' end, r.client_id, 'skipped', 'claimed',
          p_recipients, array[r.id], left(p_subject, 300), left(regexp_replace(coalesce(p_actor, ''), '^staff:', ''), 300))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.tk_request_send_finish(p_log_id uuid, p_status text, p_reason text,
                                                         p_recipients text[], p_provider_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(p_status, '') not in ('sent', 'error', 'not_configured', 'skipped') then
    raise exception 'tk_bad_request' using errcode = '22023';
  end if;
  update client_email_log
     set status = p_status, reason = left(p_reason, 500), recipients = coalesce(p_recipients, recipients),
         provider_id = left(p_provider_id, 500)
   where id = p_log_id and status = 'skipped' and reason = 'claimed';
end $$;

-- Nudges (service-only; the client-emails job). Due: open, not paused,
-- under nudge_max, 3 business days since the last nudge (or the ask), not
-- nudged today, client not test-only/internal, email not off.
create or replace function public.tk_nudge_plan()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_max int := public.tk__setting_int('nudge_max', 4, 0, 20);
  v_today date := (now() at time zone 'America/Chicago')::date;
begin
  return coalesce((
    select jsonb_agg(g order by g ->> 'client_id', g -> 'recipient' ->> 'email') from (
      select jsonb_build_object(
               'client_id', d.client_id, 'client_name', d.client_name, 'mode', d.mode,
               'recipient', jsonb_build_object('type', x.type, 'email', x.email, 'name', x.name, 'contact_id', x.contact_id),
               'items', jsonb_agg(jsonb_build_object('request_id', d.id, 'title', d.title, 'link_ttl_days', d.link_ttl_days,
                                                     'asked_by', d.asked_by, 'nudge_count', d.nudge_count)
                                  order by d.asked_at)) g
        from (
          select r.*, c.name client_name, public.tk__request_send_mode(r.client_id) mode
            from client_requests r
            join clients c on c.id = r.client_id
           where r.status = 'open' and r.deleted_at is null and not r.legacy_doc_request and not r.nudge_paused
             and r.nudge_count < v_max and not coalesce(c.test_only, false) and not coalesce(c.is_internal, false)
             and public.tk_add_business_days((coalesce(r.last_nudged_at, r.asked_at) at time zone 'America/Chicago')::date, 3) <= v_today
             and (r.last_nudged_at is null or (r.last_nudged_at at time zone 'America/Chicago')::date < v_today)
        ) d
        cross join lateral (
          select 'portal'::text type, e email, cu.name, null::uuid contact_id
            from unnest(d.recipient_emails) e
            join client_users cu on cu.client_id = d.client_id and cu.active and lower(cu.email) = e
           where not exists (select 1 from client_email_recipients er
                              where er.client_id = d.client_id and lower(er.email) = e and er.opted_out_at is not null)
          union all
          select 'contact', k.email, k.name, k.id
            from client_contacts k
           where k.id = any (d.contact_ids) and k.deleted_at is null and k.can_answer_requests
        ) x
       where d.mode in ('dry_run', 'live')
       group by d.client_id, d.client_name, d.mode, x.type, x.email, x.name, x.contact_id
    ) s), '[]'::jsonb);
end $$;

-- Live only: count the nudge; at the cap, one staff_task_batch per assignee.
create or replace function public.tk_nudge_mark(p_request_ids uuid[])
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max int := public.tk__setting_int('nudge_max', 4, 0, 20);
  v_ids uuid[];
  a record;
begin
  with u as (
    update client_requests r set nudge_count = r.nudge_count + 1, last_nudged_at = now(), updated_at = now()
     where r.id = any (coalesce(p_request_ids, '{}')) and r.status = 'open' and r.deleted_at is null
       and not r.legacy_doc_request
       and (r.last_nudged_at is null or (r.last_nudged_at at time zone 'America/Chicago')::date
                                         < (now() at time zone 'America/Chicago')::date)
    returning r.id
  )
  select coalesce(array_agg(id), '{}') into v_ids from u;
  -- only the requests counted by this call (a repeat call the same day
  -- counts nothing and tells nobody)
  for a in
    select s.assignee_email, r.client_id, max(c.name) client_name, array_agg(r.title order by r.title) titles
      from client_requests r
      join staff_reminders s on s.id = r.task_id and s.deleted_at is null
      join clients c on c.id = r.client_id
     where r.id = any (v_ids) and r.nudge_count = v_max and r.status = 'open'
       and s.assignee_email is not null
     group by s.assignee_email, r.client_id
  loop
    perform public.tk__enqueue('staff_task_batch', a.assignee_email, a.client_id, 'no_reply:' || a.client_id,
      jsonb_build_object('title', left(format('No reply from %s', a.client_name), 120),
                         'intro', format('%s hasn''t answered after %s reminders. Follow up another way, or cancel the request.',
                                         a.client_name, v_max),
                         'items', to_jsonb(a.titles), 'hash', '#/tasks/waiting'));
  end loop;
  return cardinality(v_ids);
end $$;

-- 7. Client list: legacy flag and the client's own answer -------------------
drop function if exists public.client_requests_for_client(text);
create or replace function public.client_requests_for_client(p_client_id text)
returns table (id uuid, kind text, title text, prompt text, needs_upload boolean, due_date date, status text,
               asked_at timestamptz, asked_by_first_name text, answered_at timestamptz, file_count int,
               legacy boolean, reply text, legacy_file_name text)
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
         (select count(*)::int from client_files f where f.client_request_id = r.id and f.trashed_at is null),
         r.legacy_doc_request, r.reply, r.legacy_file_name
    from client_requests r
    left join staff st on lower(st.email) = r.asked_by
   where r.client_id = p_client_id and r.deleted_at is null and r.status <> 'cancelled'
   order by (r.status = 'open') desc, r.asked_at desc
   limit 200;
end $$;

-- 8. Cron + realtime ------------------------------------------------------------
select pg_temp.patch_fn('public.client_emails_cron(text)',
$a$if p_job not in ('doc_chaser', 'value_report') then$a$,
$b$if p_job not in ('doc_chaser', 'value_report', 'client_request_nudge') then$b$, 1);
select cron.unschedule(jobid) from cron.job where jobname = 'client-request-nudge';
select cron.schedule('client-request-nudge', '0 14 * * 1-5', $$select public.client_emails_cron('client_request_nudge');$$);

do $$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'client_requests') then
    alter publication supabase_realtime add table public.client_requests;
  end if;
end $$;

-- 9. Grants ------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.tk_add_doc_request(text, text, text, date)',
    'public.tk_set_doc_request_status(uuid, text)',
    'public.tk_client_request_send(uuid, text, text)',
    'public.client_requests_for_client(text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  foreach f in array array[
    'public.tk_rate_hit(text, int, int)',
    'public.tk_rate_peek(text, int, int)',
    'public.tk_log_token_event(uuid, uuid, text, text, jsonb)',
    'public.tk_issue_request_token(uuid, uuid, text, bytea, int, text, boolean, text)',
    'public.tk_token_lookup(bytea, text)',
    'public.tk_token_gate(bytea, text)',
    'public.tk_stage_request_file_by_token(bytea, jsonb, text)',
    'public.tk_answer_request_by_token(bytea, text, uuid[], text)',
    'public.tk_stop_nudges_by_token(bytea, text)',
    'public.tk_request_send_claim(uuid, text, text, text, text[], text)',
    'public.tk_request_send_finish(uuid, text, text, text[], text)',
    'public.tk_nudge_plan()',
    'public.tk_nudge_mark(uuid[])'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array[
    'public.tk_client_doc_requests_lock()',
    'public.tk_client_doc_requests_mirror_delete()',
    'public.tk_request_token_events_no_truncate()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;

create or replace function public.tk_schema_version()
returns integer
language sql
stable
set search_path = public
as $$ select 7 $$;
