-- =====================================================================
-- Client page drop, Phase 1: database (spec docs/client-page-drop.md,
-- including the 2026-10-30 critique addendum B1, B2, S1-S7).
--
-- Additive and harmless while the firm switch is off:
--   * client_files gets access_mode (default 'everyone', so every existing
--     row keeps today's visibility) and display_name (null = show name).
--   * client_file_access lists the logins an 'only' or 'except' rule names.
--   * The client SELECT policy on client_files gains two clauses on the
--     'shared' branch. Both answer true for every existing row while the
--     switch is off: client_docs_tab_ok() is true when the switch is off for
--     that client, and access_mode = 'everyone' short-circuits the per-login
--     check. Staff policies are not touched.
--   * Every client-facing RPC refuses (or answers "off") while the switch
--     is off, so no restriction can be set until the owner turns it on.
--
-- Firm switch (owner-only, never written by code):
--   tk_settings.client_page_drop_enabled   true/false, missing = off
--   tk_settings.client_page_drop_pilot     "all" or ["client-id", ...];
--                                          missing/anything else = nobody.
--   The feature is on for a client only when enabled is true AND the pilot
--   is "all" or lists that client.
--   tk_settings.client_upload_notify_enabled  true/false, missing = off.
--     When on (and the feature is on for that client), a client login's
--     'shared' upload queues a staff_doc_upload email to the client's
--     account manager through notification_outbox (the staff member's own
--     Settings > Notifications "doc_upload" toggle still applies).
--   All three are added to tk__owner_only_key().
--
-- Function privileges (B1): Supabase default privileges grant EXECUTE on new
-- functions to anon and authenticated by name, so every function below
-- revokes from public, anon and authenticated explicitly, then grants back
-- only what browsers need:
--   authenticated: client_file_login_ok, client_docs_tab_ok (used by RLS),
--                  client_file_set_access, client_org_logins,
--                  client_page_drop_state
--   service_role:  cpd__on, cpd__docs_tab_rule, cfa_validate,
--                  cfa__apply_access, cfa_insert_file_with_access
--
-- Applied to production 2026-10-30 (project xumsqmhccgfjnlmieqyu).
-- Tests: supabase/client-page-drop-tests.sql (ends in ROLLBACK).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Columns on client_files
-- ---------------------------------------------------------------------
alter table public.client_files
  add column if not exists access_mode text not null default 'everyone',
  add column if not exists display_name text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'client_files_access_mode_check') then
    alter table public.client_files add constraint client_files_access_mode_check
      check (access_mode in ('everyone', 'only', 'except'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'client_files_display_name_check') then
    alter table public.client_files add constraint client_files_display_name_check
      check (display_name is null or length(display_name) between 1 and 200);
  end if;
  -- S6 + addendum: a rule only ever sits on a live 'shared', non-legacy row.
  if not exists (select 1 from pg_constraint where conname = 'client_files_access_mode_shared_check') then
    alter table public.client_files add constraint client_files_access_mode_shared_check
      check (access_mode = 'everyone' or (visibility = 'shared' and legacy_path is null));
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. client_file_access
--    No FK to client_users (S2): deleting or re-creating a login must never
--    silently drop an 'except' row and widen access. cfa_guard checks at
--    write time that the email is an active login of the same client.
-- ---------------------------------------------------------------------
create table if not exists public.client_file_access (
  file_id    uuid not null references public.client_files(id) on delete cascade,
  client_id  text not null,
  email      text not null check (email = lower(email) and length(email) between 3 and 320),
  created_by text not null,
  created_at timestamptz not null default now(),
  primary key (file_id, email)
);
create index if not exists client_file_access_email_idx on public.client_file_access (email);
create index if not exists client_file_access_client_idx on public.client_file_access (client_id);
alter table public.client_file_access enable row level security;

-- S4: browsers read only (through the policies below); never write.
revoke all on public.client_file_access from public, anon, authenticated;
grant select on public.client_file_access to authenticated;
grant all on public.client_file_access to service_role;

create or replace function public.cfa_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_file_client text;
begin
  new.email := lower(btrim(new.email));
  select f.client_id into v_file_client from client_files f where f.id = new.file_id;
  if v_file_client is null then
    raise exception 'bad_access_list: file not found' using errcode = '23503';
  end if;
  if new.client_id is distinct from v_file_client then
    raise exception 'bad_access_list: client mismatch' using errcode = '23514';
  end if;
  if not exists (select 1 from client_users cu
                  where lower(cu.email) = new.email
                    and cu.client_id = v_file_client
                    and cu.active) then
    raise exception 'bad_access_list: % is not an active login of this client', new.email using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.cfa_guard() from public, anon, authenticated;

drop trigger if exists cfa_guard on public.client_file_access;
create trigger cfa_guard
  before insert or update on public.client_file_access
  for each row execute function public.cfa_guard();

-- ---------------------------------------------------------------------
-- 3. Switch helpers
-- ---------------------------------------------------------------------
-- Feature on for this client: enabled AND (pilot "all" OR pilot lists it).
create or replace function public.cpd__on(p_client_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.tk__jsonb_bool((select value from tk_settings where key = 'client_page_drop_enabled')), false)
     and coalesce((
       select case
                when jsonb_typeof(s.value) = 'string' then s.value #>> '{}' = 'all'
                when jsonb_typeof(s.value) = 'array' then s.value ? p_client_id
                else false
              end
         from tk_settings s where s.key = 'client_page_drop_pilot'), false);
$$;
revoke all on function public.cpd__on(text) from public, anon, authenticated;
grant execute on function public.cpd__on(text) to service_role;

-- S1: the Documents tab rule, with resolveAccess() semantics (app.jsx):
-- Basic plan = every tab, access 'full' = every tab, scoped with tabs NULL =
-- every tab, else tabs[] must include 'documents'. Takes an email, so it is
-- service-only (no probing other logins).
create or replace function public.cpd__docs_tab_rule(p_email text, p_client_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from client_users cu
      join clients c on c.id = cu.client_id
     where lower(cu.email) = lower(btrim(p_email))
       and cu.client_id = p_client_id
       and cu.active
       and (c.plan = 'basic'
            or coalesce(cu.access, 'full') = 'full'
            or cu.tabs is null
            or 'documents' = any (cu.tabs)));
$$;
revoke all on function public.cpd__docs_tab_rule(text, text) from public, anon, authenticated;
grant execute on function public.cpd__docs_tab_rule(text, text) to service_role;

-- Used by the client RLS policy and by drive-files doUpload (as the user).
-- Behind the switch: answers true while the feature is off for the client,
-- so today's behavior is unchanged until the owner turns it on.
create or replace function public.client_docs_tab_ok(p_client_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (not public.cpd__on(p_client_id))
      or public.cpd__docs_tab_rule(auth.jwt() ->> 'email', p_client_id);
$$;
revoke all on function public.client_docs_tab_ok(text) from public, anon, authenticated;
grant execute on function public.client_docs_tab_ok(text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. Per-login RLS helper (answers only for the caller's own JWT email)
-- ---------------------------------------------------------------------
create or replace function public.client_file_login_ok(p_file_id uuid, p_mode text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case p_mode
    when 'everyone' then true
    when 'only' then exists (
      select 1 from client_file_access a
       where a.file_id = p_file_id
         and a.email = lower(btrim(auth.jwt() ->> 'email')))
    when 'except' then not exists (
      select 1 from client_file_access a
       where a.file_id = p_file_id
         and a.email = lower(btrim(auth.jwt() ->> 'email')))
    else false
  end;
$$;
revoke all on function public.client_file_login_ok(uuid, text) from public, anon, authenticated;
grant execute on function public.client_file_login_ok(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5. Policy swap: "client reads own files" (same name, role and
--    (select auth.jwt()) form; request/message branches byte-for-byte).
-- ---------------------------------------------------------------------
drop policy if exists "client reads own files" on public.client_files;
create policy "client reads own files" on public.client_files
  for select to authenticated
  using (
    (trashed_at is null)
    and is_client_member(client_id)
    and (
      ((visibility = 'shared'::text)
        and client_docs_tab_ok(client_id)
        and ((access_mode = 'everyone'::text) or client_file_login_ok(id, access_mode)))
      or ((visibility = 'request'::text) and client_file_request_visible(client_id, client_request_id))
      or ((visibility = 'message'::text) and (participant_email = lower((( select auth.jwt() as jwt) ->> 'email'::text))))
    )
  );

-- client_file_access read policies: staff for their clients; a client login
-- only for files it uploaded and can still read. Other logins never learn
-- who was listed or excluded.
drop policy if exists "staff read client file access" on public.client_file_access;
create policy "staff read client file access" on public.client_file_access
  for select to authenticated
  using ((select is_active_staff()) and can_access_client(client_id));

drop policy if exists "uploader reads own file access" on public.client_file_access;
create policy "uploader reads own file access" on public.client_file_access
  for select to authenticated
  using (
    is_client_member(client_id)
    and exists (
      select 1 from client_files f
       where f.id = client_file_access.file_id
         and lower(f.uploaded_by) = lower((( select auth.jwt() as jwt) ->> 'email'::text)))
  );

drop policy if exists "internal company lock" on public.client_file_access;
create policy "internal company lock" on public.client_file_access
  as restrictive for all
  using ((client_id is null) or (client_id <> all ((select internal_blocked_ids())::text[])))
  with check ((client_id is null) or (client_id <> all ((select internal_blocked_ids())::text[])));

-- ---------------------------------------------------------------------
-- 6. Rule checks and writers (service role only, SECURITY INVOKER)
-- ---------------------------------------------------------------------
-- Raises if the file's rule is inconsistent. Called after every write.
create or replace function public.cfa_validate(p_file_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  f client_files;
  v_n int;
  v_uploader text;
  v_uploader_client boolean;
  v_listed boolean;
begin
  select * into f from client_files where id = p_file_id;
  if f.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select count(*) into v_n from client_file_access where file_id = p_file_id;
  if f.access_mode = 'everyone' then
    if v_n > 0 then
      raise exception 'bad_access_list: everyone has a list' using errcode = '23514';
    end if;
    return;
  end if;
  if f.visibility <> 'shared' or f.legacy_path is not null then
    raise exception 'bad_access_mode: only shared portal files can be restricted' using errcode = '23514';
  end if;
  if v_n = 0 then
    raise exception 'bad_access_list: pick at least one person' using errcode = '23514';
  end if;
  if v_n > 50 then
    raise exception 'bad_access_list: at most 50 people' using errcode = '23514';
  end if;
  -- S3: the uploader rule applies only when the uploader is an active client
  -- login of this client (staff uploads may set 'only' without themselves).
  v_uploader := lower(btrim(coalesce(f.uploaded_by, '')));
  v_uploader_client := exists (select 1 from client_users cu
                                where lower(cu.email) = v_uploader
                                  and cu.client_id = f.client_id and cu.active);
  if v_uploader_client then
    v_listed := exists (select 1 from client_file_access a where a.file_id = p_file_id and a.email = v_uploader);
    if f.access_mode = 'only' and not v_listed then
      raise exception 'bad_access_list: the uploader must be on an only list' using errcode = '23514';
    end if;
    if f.access_mode = 'except' and v_listed then
      raise exception 'bad_access_list: the uploader cannot be excluded' using errcode = '23514';
    end if;
  end if;
end $$;
revoke all on function public.cfa_validate(uuid) from public, anon, authenticated;
grant execute on function public.cfa_validate(uuid) to service_role;

-- Replaces a file's rule. Normalizes the list (lower case, trimmed,
-- distinct), checks every email is an active login of the file's client,
-- force-adds a client uploader to 'only' and refuses them on 'except'.
-- Does NOT check the caller or the switch: callers do that.
create or replace function public.cfa__apply_access(p_file_id uuid, p_mode text, p_emails text[], p_actor text)
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  f client_files;
  v_mode text := lower(btrim(coalesce(p_mode, 'everyone')));
  v_emails text[];
  v_bad text;
  v_uploader text;
  v_n int := 0;
begin
  select * into f from client_files where id = p_file_id for update;
  if f.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if v_mode not in ('everyone', 'only', 'except') then
    raise exception 'bad_access_mode: unknown mode' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct e order by e), '{}') into v_emails
    from (select lower(btrim(x)) e from unnest(coalesce(p_emails, '{}'::text[])) x) s
   where e <> '';

  if v_mode = 'everyone' then
    delete from client_file_access where file_id = p_file_id;
    update client_files set access_mode = 'everyone' where id = p_file_id;
    perform public.cfa_validate(p_file_id);
    return 0;
  end if;

  if f.visibility <> 'shared' or f.legacy_path is not null or f.trashed_at is not null then
    raise exception 'bad_access_mode: only live shared portal files can be restricted' using errcode = '22023';
  end if;

  v_uploader := lower(btrim(coalesce(f.uploaded_by, '')));
  if exists (select 1 from client_users cu where lower(cu.email) = v_uploader and cu.client_id = f.client_id and cu.active) then
    if v_mode = 'only' and not (v_uploader = any (v_emails)) then
      v_emails := v_emails || v_uploader;
    elsif v_mode = 'except' and v_uploader = any (v_emails) then
      raise exception 'bad_access_list: you cannot exclude the person who added the file' using errcode = '22023';
    end if;
  end if;

  if cardinality(v_emails) = 0 then
    raise exception 'bad_access_list: pick at least one person' using errcode = '22023';
  end if;
  if cardinality(v_emails) > 50 then
    raise exception 'bad_access_list: at most 50 people' using errcode = '22023';
  end if;

  select e into v_bad
    from unnest(v_emails) e
   where not exists (select 1 from client_users cu
                      where lower(cu.email) = e and cu.client_id = f.client_id and cu.active)
   limit 1;
  if v_bad is not null then
    raise exception 'bad_access_list: % is not an active login of this client', v_bad using errcode = '22023';
  end if;

  delete from client_file_access where file_id = p_file_id;
  update client_files set access_mode = v_mode where id = p_file_id;
  insert into client_file_access (file_id, client_id, email, created_by)
  select p_file_id, f.client_id, e, lower(btrim(coalesce(p_actor, 'system'))) from unnest(v_emails) e;
  get diagnostics v_n = row_count;
  perform public.cfa_validate(p_file_id);
  return v_n;
end $$;
revoke all on function public.cfa__apply_access(uuid, text, text[], text) from public, anon, authenticated;
grant execute on function public.cfa__apply_access(uuid, text, text[], text) to service_role;

-- drive-files doUpload: inserts the client_files row and its access list in
-- one transaction, so a failure leaves no half-written rule.
create or replace function public.cfa_insert_file_with_access(p_file jsonb, p_mode text, p_emails text[])
returns public.client_files
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
  v_row client_files;
  v_dn text := nullif(btrim(regexp_replace(coalesce(p_file ->> 'display_name', ''), '[[:cntrl:]]', ' ', 'g')), '');
begin
  insert into client_files (client_id, drive_file_id, drive_folder_id, name, display_name, mime, size,
                            year, doc_type, visibility, uploaded_by)
  values (p_file ->> 'client_id',
          p_file ->> 'drive_file_id',
          p_file ->> 'drive_folder_id',
          p_file ->> 'name',
          left(v_dn, 200),
          p_file ->> 'mime',
          (p_file ->> 'size')::bigint,
          (p_file ->> 'year')::int,
          coalesce(nullif(p_file ->> 'doc_type', ''), 'Other'),
          coalesce(nullif(p_file ->> 'visibility', ''), 'shared'),
          lower(p_file ->> 'uploaded_by'))
  returning id into v_id;
  if coalesce(lower(btrim(p_mode)), 'everyone') <> 'everyone' then
    perform public.cfa__apply_access(v_id, p_mode, p_emails, p_file ->> 'uploaded_by');
  end if;
  select * into v_row from client_files where id = v_id;
  return v_row;
end $$;
revoke all on function public.cfa_insert_file_with_access(jsonb, text, text[]) from public, anon, authenticated;
grant execute on function public.cfa_insert_file_with_access(jsonb, text, text[]) to service_role;

-- ---------------------------------------------------------------------
-- 7. Client-facing RPCs (B2: switch + pilot + Documents tab)
-- ---------------------------------------------------------------------
-- What the portal reads to decide whether to mount the client page drop.
create or replace function public.client_page_drop_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(coalesce(auth.jwt() ->> 'email', '')));
  v_client text;
begin
  if v_email = '' or public.is_active_staff() then
    return jsonb_build_object('eligible', false, 'enabled', false);
  end if;
  select cu.client_id into v_client from client_users cu where lower(cu.email) = v_email and cu.active;
  if v_client is null or not public.is_client_member(v_client) then
    return jsonb_build_object('eligible', false, 'enabled', false);
  end if;
  return jsonb_build_object(
    'eligible', true,
    'enabled', public.cpd__on(v_client) and public.cpd__docs_tab_rule(v_email, v_client),
    'notify_account_manager', public.cpd__on(v_client)
      and coalesce(public.tk__jsonb_bool((select value from tk_settings where key = 'client_upload_notify_enabled')), false));
end $$;
revoke all on function public.client_page_drop_state() from public, anon, authenticated;
grant execute on function public.client_page_drop_state() to authenticated;

-- The caller's own org logins for the "Who can see it" checklist. No client
-- argument: the org comes from the caller's own active login (S5, via
-- is_client_member, so internal companies are excluded). Empty unless the
-- feature is on for that client and the caller has the Documents tab.
create or replace function public.client_org_logins()
returns table (email text, name text, is_me boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(coalesce(auth.jwt() ->> 'email', '')));
  v_client text;
begin
  if v_email = '' then
    return;
  end if;
  select cu.client_id into v_client from client_users cu where lower(cu.email) = v_email and cu.active;
  if v_client is null
     or not public.is_client_member(v_client)
     or not public.cpd__on(v_client)
     or not public.client_docs_tab_ok(v_client) then
    return;
  end if;
  return query
    select lower(cu.email), cu.name, lower(cu.email) = v_email
      from client_users cu
     where cu.client_id = v_client and cu.active
     order by lower(cu.email) = v_email desc, lower(cu.name), lower(cu.email);
end $$;
revoke all on function public.client_org_logins() from public, anon, authenticated;
grant execute on function public.client_org_logins() to authenticated;

-- Change who can see a file after upload (and optionally its display name).
-- Callers: staff with can_access_client, or the client login who uploaded
-- it (still a member, with the Documents tab). Refused while the switch is
-- off for the client, for non-shared, trashed and legacy rows.
-- p_display_name: null = unchanged, '' = back to the original file name.
create or replace function public.client_file_set_access(
  p_file_id uuid, p_mode text, p_emails text[], p_display_name text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(coalesce(auth.jwt() ->> 'email', '')));
  f client_files;
  v_staff boolean;
  v_n int;
  v_dn text;
  v_emails text[];
begin
  if v_email = '' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into f from client_files where id = p_file_id;
  if f.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  v_staff := public.is_active_staff() and public.can_access_client(f.client_id);
  if not v_staff then
    if not public.is_client_member(f.client_id)
       or lower(btrim(coalesce(f.uploaded_by, ''))) <> v_email then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  end if;
  if not public.cpd__on(f.client_id) then
    raise exception 'feature_off' using errcode = '42501';
  end if;
  if not v_staff and not public.client_docs_tab_ok(f.client_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if f.visibility <> 'shared' or f.trashed_at is not null or f.legacy_path is not null then
    raise exception 'bad_access_mode: only live shared portal files can be restricted' using errcode = '22023';
  end if;

  v_n := public.cfa__apply_access(p_file_id, p_mode, p_emails, v_email);

  if p_display_name is not null then
    v_dn := nullif(btrim(regexp_replace(p_display_name, '[[:cntrl:]]', ' ', 'g')), '');
    if v_dn is not null and length(v_dn) > 200 then
      raise exception 'bad_display_name: 200 characters at most' using errcode = '22023';
    end if;
    update client_files set display_name = v_dn where id = p_file_id;
  end if;

  select * into f from client_files where id = p_file_id;
  select coalesce(array_agg(a.email order by a.email), '{}') into v_emails
    from client_file_access a where a.file_id = p_file_id;

  -- Audit trail (admins read drive_file_events). File id lives in detail.
  insert into drive_file_events (action, ok, client_id, actor, detail)
  values ('access_changed', true, f.client_id, v_email,
          left(jsonb_build_object('file_id', f.id, 'access_mode', f.access_mode, 'count', v_n,
                                  'emails', to_jsonb(v_emails),
                                  'display_name_changed', p_display_name is not null)::text, 2000));

  return jsonb_build_object('id', f.id, 'access_mode', f.access_mode,
                            'display_name', f.display_name, 'emails', to_jsonb(v_emails));
end $$;
revoke all on function public.client_file_set_access(uuid, text, text[], text) from public, anon, authenticated;
grant execute on function public.client_file_set_access(uuid, text, text[], text) to authenticated;

-- ---------------------------------------------------------------------
-- 8. S7: harden document_folder_items (a drive: key must map to a
--    client_files row the caller can read, in USING and WITH CHECK) and
--    the message-link trigger (only message files, or internal files on an
--    internal note, can be linked to a message).
-- ---------------------------------------------------------------------
drop policy if exists "client manages own document folder items" on public.document_folder_items;
create policy "client manages own document folder items" on public.document_folder_items
  for all
  using (
    is_client_member(client_id)
    and (doc_key !~~ 'file:internal/%'::text)
    and ((doc_key !~~ 'drive:%'::text) or exists (
      select 1 from client_files f
       where f.client_id = document_folder_items.client_id
         and doc_key = 'drive:' || f.id::text))
  )
  with check (
    is_client_member(client_id)
    and (doc_key !~~ 'file:internal/%'::text)
    and ((doc_key !~~ 'drive:%'::text) or exists (
      select 1 from client_files f
       where f.client_id = document_folder_items.client_id
         and doc_key = 'drive:' || f.id::text))
  );

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
       and (visibility = 'message' or (visibility = 'internal' and coalesce(new.internal, false)))
       and (participant_email is null or participant_email = new.participant_email);
  end if;
  return new;
end;
$$;
revoke all on function public.client_messages_link_drive_file() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 9. Optional account-manager email on a client upload (owner extra,
--    OFF by default). Only for 'shared' rows uploaded by an active client
--    login of that client, only while the feature is on for that client
--    and client_upload_notify_enabled is true. Rides the existing
--    staff_doc_upload kind (notification-emails words it as "added").
-- ---------------------------------------------------------------------
create or replace function public.cpd__notify_upload()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_am text;
  v_by text;
begin
  if new.visibility <> 'shared' or new.trashed_at is not null or new.legacy_path is not null then
    return null;
  end if;
  if not coalesce(public.tk__jsonb_bool((select value from tk_settings where key = 'client_upload_notify_enabled')), false) then
    return null;
  end if;
  if not public.cpd__on(new.client_id) then
    return null;
  end if;
  select cu.name into v_by from client_users cu
   where lower(cu.email) = lower(coalesce(new.uploaded_by, ''))
     and cu.client_id = new.client_id and cu.active;
  if v_by is null then
    return null;  -- staff upload, or not a login of this client
  end if;
  select lower(c.account_manager_email) into v_am
    from clients c
    join staff s on lower(s.email) = lower(c.account_manager_email) and s.active
   where c.id = new.client_id;
  if v_am is null then
    return null;
  end if;
  insert into notification_outbox (kind, recipient_email, client_id, ref_id, payload)
  values ('staff_doc_upload', v_am, new.client_id, new.id::text,
          jsonb_build_object('title', left(coalesce(new.display_name, new.name), 200),
                             'by', left(v_by, 120),
                             'page_drop', true));
  return null;
end $$;
revoke all on function public.cpd__notify_upload() from public, anon, authenticated;

drop trigger if exists cpd_notify_upload on public.client_files;
create trigger cpd_notify_upload
  after insert on public.client_files
  for each row execute function public.cpd__notify_upload();

-- ---------------------------------------------------------------------
-- 10. Owner-only keys (re-read live with pg_get_functiondef 2026-10-30;
--     list last set by the slateplus switch) plus the three new keys.
--     No tk_settings row is inserted: missing = off.
-- ---------------------------------------------------------------------
create or replace function public.tk__owner_only_key(p_key text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_key in ('client_request_enabled', 'client_request_pilot', 'standard_set_live',
                   'late_tasks_count_against_staff', 'late_tasks_effective_from',
                   'wb_enabled', 'desk_app_enabled', 'nav_enabled', 'lato_enabled',
                   'month_rhythm_enabled', 'slate_app_enabled',
                   'brand_enabled', 'hovernav_enabled',
                   'org_profile_enabled',
                   'deskplus_enabled',
                   'threadmenu_enabled',
                   'slateplus_enabled',
                   'client_page_drop_enabled', 'client_page_drop_pilot',
                   'client_upload_notify_enabled');
$$;

notify pgrst, 'reload schema';
