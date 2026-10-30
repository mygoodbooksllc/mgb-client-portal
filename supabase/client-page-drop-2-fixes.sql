-- =====================================================================
-- Client page drop, Phase 1 review fixes (follow-up to
-- supabase/client-page-drop-1-core.sql, commit 4a1d1a6). Additive: replaces
-- functions and one policy in place, adds no table, column or row, and
-- changes nothing a client sees while the firm switch is off.
--
--  F1  document_folder_items policy: the drive: key is parsed to a uuid and
--      compared with client_files.id (primary-key lookup) instead of
--      building 'drive:' || f.id::text for every file of the client. Same
--      answers: the old text match only ever matched the canonical
--      lower-case uuid form, and the strict pattern below accepts exactly
--      that form (so a malformed key can never reach the ::uuid cast and
--      raise for everyone reading the table).
--  F2  'except' lists never silently drop an excluded person. A person
--      already excluded on the file whose login is no longer active
--      (inactive, or the login row was removed) stays excluded when the
--      rule is re-saved, whether or not the caller sends them (the
--      checklist only lists active logins). Sending them explicitly is also
--      accepted. Rows that stay on the list are kept as they are (not
--      deleted and re-inserted), and cfa_guard lets an unchanged row of an
--      'except' file be updated.
--  F3  cpd__notify_upload: the account-manager email is best effort. Any
--      error inside it becomes a WARNING, so it can never block or roll
--      back an upload.
--  F4  client_docs_tab_ok(p_client_id) answers true when the caller is not
--      a member of that client, so it leaks nothing about another client's
--      pilot or switch. (Every caller already pairs it with a membership
--      check, so access does not change.)
--  F5  display_name rides only on shared rows. On upload, a client login's
--      display name is kept only while the feature is on for that client
--      (staff may name shared files any time, as the Phase 2 staff rename
--      does). client_file_set_access: staff may reset a file to 'everyone'
--      while the switch is off (nothing else is allowed while off), and a
--      display name change is refused on a non-shared row. Rules already
--      set keep applying while the switch is off (client_file_login_ok
--      does not read the switch).
--
-- Note for the guide/spec: a download link handed out before an access
-- change keeps working until it expires (drive-files 'link' tokens last
-- 10 minutes). Lists and new links follow the new rule at once.
--
-- Applied to production 2026-10-30 (project xumsqmhccgfjnlmieqyu).
-- Tests: supabase/client-page-drop-tests.sql (ends in ROLLBACK).
-- =====================================================================

-- ---------------------------------------------------------------------
-- F1. document_folder_items: primary-key lookup on the parsed drive: id
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
         and f.id = case when doc_key ~ '^drive:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                         then substr(doc_key, 7)::uuid end))
  )
  with check (
    is_client_member(client_id)
    and (doc_key !~~ 'file:internal/%'::text)
    and ((doc_key !~~ 'drive:%'::text) or exists (
      select 1 from client_files f
       where f.client_id = document_folder_items.client_id
         and f.id = case when doc_key ~ '^drive:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                         then substr(doc_key, 7)::uuid end))
  );

-- ---------------------------------------------------------------------
-- F2. cfa_guard: an unchanged row on an 'except' file may be updated even
--     when that login is no longer active. New rows still need an active
--     login of the same client.
-- ---------------------------------------------------------------------
create or replace function public.cfa_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_file_client text;
  v_mode text;
begin
  new.email := lower(btrim(new.email));
  select f.client_id, f.access_mode into v_file_client, v_mode from client_files f where f.id = new.file_id;
  if v_file_client is null then
    raise exception 'bad_access_list: file not found' using errcode = '23503';
  end if;
  if new.client_id is distinct from v_file_client then
    raise exception 'bad_access_list: client mismatch' using errcode = '23514';
  end if;
  if exists (select 1 from client_users cu
              where lower(cu.email) = new.email
                and cu.client_id = v_file_client
                and cu.active) then
    return new;
  end if;
  -- Already excluded on this file: keep it, even if the login is gone.
  if tg_op = 'UPDATE' and v_mode = 'except'
     and old.file_id = new.file_id and old.email = new.email then
    return new;
  end if;
  raise exception 'bad_access_list: % is not an active login of this client', new.email using errcode = '23514';
end $$;
revoke all on function public.cfa_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- F2. cfa__apply_access: keep excluded people whose login is no longer
--     active; keep unchanged rows in place.
-- ---------------------------------------------------------------------
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
  v_keepable text[] := '{}';
  v_bad text;
  v_uploader text;
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

  if v_mode = 'except' then
    -- People already on this file's list who no longer have an active login
    -- anywhere (made inactive, or the login was removed). They may stay on
    -- an 'except' list, and if the file is already 'except' they stay
    -- whether or not the caller sent them: the checklist only shows active
    -- logins, so leaving them off is never a deliberate choice.
    select coalesce(array_agg(a.email order by a.email), '{}') into v_keepable
      from client_file_access a
     where a.file_id = p_file_id
       and not exists (select 1 from client_users cu where lower(cu.email) = a.email and cu.active);
    if f.access_mode = 'except' then
      select coalesce(array_agg(distinct e order by e), '{}') into v_emails
        from unnest(v_emails || v_keepable) e;
    end if;
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
     and not (e = any (v_keepable))
   limit 1;
  if v_bad is not null then
    raise exception 'bad_access_list: % is not an active login of this client', v_bad using errcode = '22023';
  end if;

  delete from client_file_access where file_id = p_file_id and not (email = any (v_emails));
  update client_files set access_mode = v_mode where id = p_file_id;
  insert into client_file_access (file_id, client_id, email, created_by)
  select p_file_id, f.client_id, e, lower(btrim(coalesce(p_actor, 'system')))
    from unnest(v_emails) e
   where not exists (select 1 from client_file_access a where a.file_id = p_file_id and a.email = e);
  perform public.cfa_validate(p_file_id);
  return cardinality(v_emails);
end $$;
revoke all on function public.cfa__apply_access(uuid, text, text[], text) from public, anon, authenticated;
grant execute on function public.cfa__apply_access(uuid, text, text[], text) to service_role;

-- ---------------------------------------------------------------------
-- F3. Account-manager email: best effort, never blocks an upload.
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
  begin
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
                               'by', left(coalesce(v_by, ''), 120),
                               'page_drop', true));
  exception when others then
    raise warning 'cpd__notify_upload: account-manager email not queued for file %: % (%)', new.id, sqlerrm, sqlstate;
  end;
  return null;
end $$;
revoke all on function public.cpd__notify_upload() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- F4. client_docs_tab_ok: no answer about clients the caller isn't in.
-- ---------------------------------------------------------------------
create or replace function public.client_docs_tab_ok(p_client_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
           when not public.is_client_member(p_client_id) then true
           else (not public.cpd__on(p_client_id))
                or public.cpd__docs_tab_rule(auth.jwt() ->> 'email', p_client_id)
         end;
$$;
revoke all on function public.client_docs_tab_ok(text) from public, anon, authenticated;
grant execute on function public.client_docs_tab_ok(text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- F5. Upload insert: display_name only on shared rows; a client login's
--     only while the feature is on for that client.
-- ---------------------------------------------------------------------
create or replace function public.cfa_insert_file_with_access(p_file jsonb, p_mode text, p_emails text[])
returns public.client_files
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
  v_row client_files;
  v_client text := p_file ->> 'client_id';
  v_vis text := coalesce(nullif(p_file ->> 'visibility', ''), 'shared');
  v_by text := lower(p_file ->> 'uploaded_by');
  v_dn text := left(nullif(btrim(regexp_replace(coalesce(p_file ->> 'display_name', ''), '[[:cntrl:]]', ' ', 'g')), ''), 200);
begin
  if v_dn is not null then
    if v_vis <> 'shared' then
      v_dn := null;
    elsif not public.cpd__on(v_client)
          and exists (select 1 from client_users cu
                       where lower(cu.email) = v_by and cu.client_id = v_client and cu.active) then
      v_dn := null;
    end if;
  end if;
  insert into client_files (client_id, drive_file_id, drive_folder_id, name, display_name, mime, size,
                            year, doc_type, visibility, uploaded_by)
  values (v_client,
          p_file ->> 'drive_file_id',
          p_file ->> 'drive_folder_id',
          p_file ->> 'name',
          v_dn,
          p_file ->> 'mime',
          (p_file ->> 'size')::bigint,
          (p_file ->> 'year')::int,
          coalesce(nullif(p_file ->> 'doc_type', ''), 'Other'),
          v_vis,
          v_by)
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
-- F5. client_file_set_access: staff may reset to 'everyone' while the
--     switch is off; display names only on shared rows.
-- ---------------------------------------------------------------------
create or replace function public.client_file_set_access(
  p_file_id uuid, p_mode text, p_emails text[], p_display_name text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(coalesce(auth.jwt() ->> 'email', '')));
  v_mode text := lower(btrim(coalesce(p_mode, 'everyone')));
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
    -- Switch off: staff may only lift a rule (back to everyone). Rules
    -- already set keep applying until someone does.
    if not (v_staff and v_mode = 'everyone' and p_display_name is null) then
      raise exception 'feature_off' using errcode = '42501';
    end if;
  end if;
  if not v_staff and not public.client_docs_tab_ok(f.client_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if (v_mode <> 'everyone' or not v_staff or p_display_name is not null)
     and (f.visibility <> 'shared' or f.trashed_at is not null or f.legacy_path is not null) then
    raise exception 'bad_access_mode: only live shared portal files can be restricted' using errcode = '22023';
  end if;

  v_n := public.cfa__apply_access(p_file_id, v_mode, p_emails, v_email);

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

notify pgrst, 'reload schema';
