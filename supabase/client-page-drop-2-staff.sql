-- =====================================================================
-- Client page drop, Phase 2: staff Documents helpers (spec
-- docs/client-page-drop.md). Additive; changes nothing a client sees.
--
--   * client_file_rename(file, name): staff rename a portal file's display
--     name (the Drive file and its original name are untouched). Staff
--     only. A new name needs the firm switch on for that client
--     (cpd__on; the client sees it), else 'feature_off'; going back to the
--     original name ('' or null) is allowed any time. Live portal files
--     only: a file in Trash or an old Storage upload (legacy_path) is
--     refused ('bad_file'). Logged in drive_file_events as 'renamed'.
--   * client_file_access_history(file): the file's access trail (upload,
--     access_changed, renamed, trash, restore) from drive_file_events, for
--     staff who can open that client. drive_file_events itself stays
--     admin-read only; this hands back just one file's rows.
--   * wb_inbox(): the Desk "New file" row shows display_name when set.
--     Patched in place (one expression), so the rest of the function and
--     its grants stay exactly as they are.
--
-- Function privileges: revoked from public, anon and authenticated, then
-- granted to authenticated only (both functions check staff inside).
--
-- Applied to production 2026-10-30 (project xumsqmhccgfjnlmieqyu).
-- client_file_rename re-applied 2026-10-30 with the switch gate and the
-- trashed/legacy refusal (review fixes).
-- Tests: supabase/client-page-drop-2-tests.sql (ends in ROLLBACK).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Staff rename
-- ---------------------------------------------------------------------
create or replace function public.client_file_rename(p_file_id uuid, p_display_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(coalesce(auth.jwt() ->> 'email', '')));
  f client_files;
  v_dn text;
begin
  if v_email = '' or not public.is_active_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into f from client_files where id = p_file_id;
  if f.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if not public.can_access_client(f.client_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if f.trashed_at is not null or f.legacy_path is not null then
    raise exception 'bad_file: only live portal files can be renamed' using errcode = '22023';
  end if;
  v_dn := nullif(btrim(regexp_replace(coalesce(p_display_name, ''), '[[:cntrl:]]', ' ', 'g')), '');
  if v_dn is not null and length(v_dn) > 200 then
    raise exception 'bad_display_name: 200 characters at most' using errcode = '22023';
  end if;
  -- Same as the original name: store null so the row follows the file.
  if v_dn = f.name then
    v_dn := null;
  end if;
  -- A new name is something the client sees: only once the switch is on
  -- for them. Back to the original name stays allowed.
  if v_dn is not null and not public.cpd__on(f.client_id) then
    raise exception 'feature_off' using errcode = '42501';
  end if;
  update client_files set display_name = v_dn where id = p_file_id;

  insert into drive_file_events (action, ok, client_id, actor, detail)
  values ('renamed', true, f.client_id, v_email,
          left(jsonb_build_object('file_id', f.id, 'from', coalesce(f.display_name, f.name),
                                  'to', coalesce(v_dn, f.name))::text, 2000));

  return jsonb_build_object('id', f.id, 'name', f.name, 'display_name', v_dn);
end $$;
revoke all on function public.client_file_rename(uuid, text) from public, anon, authenticated;
grant execute on function public.client_file_rename(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 2. One file's access trail (staff)
-- ---------------------------------------------------------------------
create or replace function public.client_file_access_history(p_file_id uuid)
returns table (at timestamptz, action text, ok boolean, actor text, detail text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  f client_files;
begin
  if not public.is_active_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into f from client_files where id = p_file_id;
  if f.id is null or not public.can_access_client(f.client_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select e.at, e.action, e.ok, e.actor, e.detail
      from drive_file_events e
     where e.client_id = f.client_id
       and e.action in ('upload', 'access_changed', 'renamed', 'trash', 'restore')
       and position(p_file_id::text in coalesce(e.detail, '')) > 0
     order by e.at desc, e.id desc
     limit 100;
end $$;
revoke all on function public.client_file_access_history(uuid) from public, anon, authenticated;
grant execute on function public.client_file_access_history(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Desk inbox: "New file: <display name>"
-- ---------------------------------------------------------------------
do $$
declare
  d text;
  v_old text := $r$'New file: ' || left(coalesce(f.name, 'file'), 160)$r$;
  v_new text := $r$'New file: ' || left(coalesce(f.display_name, f.name, 'file'), 160)$r$;
begin
  d := pg_get_functiondef('public.wb_inbox(text,text[],boolean)'::regprocedure);
  if position(v_new in d) > 0 then
    return; -- already patched
  end if;
  if position(v_old in d) = 0 then
    raise exception 'wb_inbox: the New file title expression was not found';
  end if;
  execute replace(d, v_old, v_new);
end $$;
