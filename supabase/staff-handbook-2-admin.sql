-- Staff Handbook, part 2: admin tools (spec docs/staff-handbook-spec.md
-- Parts A, C, E). Run AFTER supabase/staff-handbook.sql. Safe to re-run.
-- Flat file; every function pins search_path = public.
-- NOTE: supabase/staff-handbook-3-kinds.sql redefines hb_status,
-- hb_publish_version, hb_sign and hb_retry_export; re-run it after this file.
-- Re-run guard: once staff-handbook-3-kinds.sql has run (handbook_policies has
-- a `kind` column), this file refuses to run unless mgb.rerun_superseded is
-- 'on' (see the guard below). The whole file is one transaction.
--
-- Depends on (all from staff-handbook.sql, checked live 2026-10-14):
--   handbook_policies, handbook_versions, handbook_signatures, staff,
--   hb_require_staff(), hb_is_signer(), hb_countersigner(), hb_state(),
--   hb_queue(), hb_link(), hb_kick(), hb_ack(), hb_norm_name(),
--   tr_request_ip(), tr_request_ua(), audit_write(), is_active_staff_admin().
-- Does NOT touch the notification_outbox / client_email_log checks.
--
-- What changes
--   * hb_publish_version: refuses a publish whose text is identical to the
--     current version (a double click or a no-op edit would otherwise make a
--     second version and email every bookkeeper twice). Everything else is as
--     shipped: admin only, next version_no, one handbook_sign_needed email per
--     active bookkeeper when it needs re-signing, audit handbook.published.
--   * hb_status: admins also get `unfiled`, the countersigned signatures whose
--     PDF isn't filed to Drive yet (for the Retry filing button, which calls
--     hb_retry_export). Everything else is as shipped.
--   * hb_sign: refuses a second signature from a bookkeeper who already
--     signed the version that needs signing (only minor edits since).
--   * hb_retry_export: refuses for 2 minutes after the countersignature, so
--     a retry can't race the first export.
--
-- Applied to production 2026-10-14 (hb_sign / hb_retry_export guards added
-- and applied the same day).

begin;

-- Re-run guard (2026-10-19): once staff-handbook-3-kinds.sql has run, re-running this file
-- would silently put back hb_status, hb_publish_version, hb_sign and hb_retry_export without policy kinds. So it stops here with an error and changes
-- nothing. On a fresh database the check passes. To re-run it on purpose,
-- put `set mgb.rerun_superseded = 'on';` on the line before this file, then
-- run staff-handbook-3-kinds.sql again right after it.
do $guard$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'handbook_policies' and column_name = 'kind')
     and coalesce(current_setting('mgb.rerun_superseded', true), '') <> 'on' then
    raise exception 'Stopped: staff-handbook-3-kinds.sql has already run, and re-running this file would undo it. Nothing was changed. See the re-run guard note at the top of this file.'
      using errcode = '55000';
  end if;
end $guard$;

create or replace function public.hb_publish_version(p_policy_id uuid, p_body_md text, p_requires_resign boolean,
                                                     p_change_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me staff := hb_require_staff();
  p handbook_policies;
  v_no int;
  v_resign boolean;
  v_id uuid;
  v_at timestamptz;
  v_sha text;
  v_last_sha text;
  b staff;
  n int := 0;
begin
  if me.role <> 'admin' or not coalesce(is_active_staff_admin(), false) then
    raise exception 'Only admins can publish policy versions.' using errcode = '42501';
  end if;
  if btrim(coalesce(p_body_md, '')) = '' then raise exception 'The policy text is empty.'; end if;
  if char_length(p_body_md) > 200000 then raise exception 'The policy text is too long.'; end if;
  if p_requires_resign is null then raise exception 'Choose Needs re-signing or Minor edit.'; end if;
  select * into p from handbook_policies where id = p_policy_id for update;
  if p.id is null then raise exception 'Policy not found.'; end if;
  select coalesce(max(version_no), 0) + 1 into v_no from handbook_versions where policy_id = p.id;
  v_sha := encode(sha256(convert_to(p_body_md, 'UTF8')), 'hex');
  select body_sha256 into v_last_sha from handbook_versions where policy_id = p.id order by version_no desc limit 1;
  if v_last_sha = v_sha then
    raise exception 'This text is the same as the current version. Change the text before publishing.';
  end if;
  v_resign := p_requires_resign or v_no = 1;
  insert into handbook_versions (policy_id, version_no, body_md, body_sha256, requires_resign, change_note, published_by)
  values (p.id, v_no, p_body_md, v_sha, v_resign, nullif(left(btrim(coalesce(p_change_note, '')), 2000), ''), lower(me.email))
  returning id, published_at into v_id, v_at;
  if v_resign and p.active then
    for b in select * from staff where role = 'bookkeeper' and active = true order by name loop
      perform hb_queue('handbook_sign_needed', b.email, v_id::text, jsonb_build_object(
        'policy_title', left(p.title, 200), 'policy_slug', p.slug, 'version_no', v_no,
        'due_date', greatest((v_at at time zone 'America/Chicago')::date,
                             (b.created_at at time zone 'America/Chicago')::date) + 7,
        'link', hb_link(p.slug)));
      n := n + 1;
    end loop;
  end if;
  perform audit_write('handbook.published', null, 'handbook_version', v_id::text,
    jsonb_build_object('policy', p.slug, 'version_no', v_no, 'requires_resign', v_resign,
                       'body_sha256', v_sha, 'change_note', left(coalesce(p_change_note, ''), 500), 'notified', n));
  return jsonb_build_object('version_id', v_id, 'version_no', v_no, 'requires_resign', v_resign,
                            'body_sha256', v_sha, 'published_at', v_at, 'notified', n);
end $$;

create or replace function public.hb_status()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  me staff := hb_require_staff();
  is_admin boolean := me.role = 'admin';
  is_signer boolean := hb_is_signer(me.email);
  cs staff := hb_countersigner();
  is_cs boolean;
  v_set text;
  v_policies jsonb;
  v_queue jsonb := '[]'::jsonb;
  v_grid jsonb;
  v_unfiled jsonb;
  v_badge int := 0;
begin
  is_cs := cs.id is not null and lower(cs.email) = lower(me.email);
  select countersigner_email into v_set from handbook_settings where id = 1;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'slug', p.slug, 'title', p.title, 'sort', p.sort,
      'latest_version_id', l.id, 'latest_version_no', l.version_no,
      'required_version_no', r.version_no, 'required_published_at', r.published_at,
      'my', case when is_signer then hb_state(p.id, me) end) order by p.sort, p.title), '[]'::jsonb)
    into v_policies
  from handbook_policies p
  left join lateral (select id, version_no from handbook_versions where policy_id = p.id
                     order by version_no desc limit 1) l on true
  left join lateral (select version_no, published_at from handbook_versions where policy_id = p.id and requires_resign
                     order by version_no desc limit 1) r on true
  where p.active and l.id is not null;
  if is_signer then
    select count(*) into v_badge from jsonb_array_elements(v_policies) e
    where e -> 'my' ->> 'state' in ('not_signed', 'overdue');
  end if;
  if is_cs then
    select coalesce(jsonb_agg(jsonb_build_object(
        'signature_id', s.id, 'policy_slug', p.slug, 'policy_title', p.title, 'version_no', v.version_no,
        'signer_email', s.staff_email, 'signer_name', coalesce(st.name, s.typed_name), 'signed_at', s.signed_at)
        order by s.signed_at), '[]'::jsonb) into v_queue
    from handbook_signatures s
    join handbook_versions v on v.id = s.version_id
    join handbook_policies p on p.id = v.policy_id
    left join staff st on lower(st.email) = s.staff_email
    where s.countersigned_at is null and s.staff_email <> lower(me.email);
    v_badge := v_badge + jsonb_array_length(v_queue);
  end if;
  if is_admin then
    select coalesce(jsonb_agg(jsonb_build_object(
        'policy_id', p.id, 'policy_slug', p.slug, 'staff_email', lower(b.email), 'staff_name', b.name)
        || hb_state(p.id, b) order by p.sort, p.title, b.name), '[]'::jsonb) into v_grid
    from handbook_policies p
    cross join staff b
    where p.active and b.role = 'bookkeeper' and b.active = true
      and exists (select 1 from handbook_versions x where x.policy_id = p.id);
    select coalesce(jsonb_agg(jsonb_build_object(
        'signature_id', s.id, 'policy_slug', p.slug, 'policy_title', p.title, 'version_no', v.version_no,
        'signer_name', coalesce(st.name, s.typed_name), 'signed_at', s.signed_at,
        'countersigned_at', s.countersigned_at) order by s.countersigned_at), '[]'::jsonb) into v_unfiled
    from handbook_signatures s
    join handbook_versions v on v.id = s.version_id
    join handbook_policies p on p.id = v.policy_id
    left join staff st on lower(st.email) = s.staff_email
    where s.countersigned_at is not null and s.pdf_drive_file_id is null;
  end if;
  return jsonb_build_object(
    'me', jsonb_build_object('email', lower(me.email), 'name', me.name, 'is_admin', is_admin,
                             'is_signer', is_signer, 'is_countersigner', is_cs),
    'countersigner', case when cs.id is null then null
      else jsonb_build_object('email', lower(cs.email), 'name', cs.name) end,
    'countersigner_missing', cs.id is null,
    'countersigner_setting', case when is_admin then v_set end,
    'policies', v_policies,
    'to_countersign', v_queue,
    'badge', v_badge,
    'bookkeepers', case when is_admin then coalesce((select jsonb_agg(jsonb_build_object('email', lower(email), 'name', name) order by name)
                                                     from staff where role = 'bookkeeper' and active = true), '[]'::jsonb) end,
    'grid', case when is_admin then v_grid end,
    'unfiled', case when is_admin then v_unfiled end,
    'pending_countersign_count', case when is_admin then
      (select count(*) from handbook_signatures where countersigned_at is null) end,
    'unfiled_count', case when is_admin then
      (select count(*) from handbook_signatures where countersigned_at is not null and pdf_drive_file_id is null) end);
end $$;

-- hb_sign: as shipped (same messages, same acknowledgment text), plus one
-- guard: a bookkeeper whose state is already signed / awaiting countersign
-- (they signed the version that needs signing, and only minor edits came
-- after) can't sign again. Without it a minor edit would let them make a
-- second signature and send the countersigner a second email.
create or replace function public.hb_sign(p_version_id uuid, p_typed_name text, p_ack boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me staff := hb_require_staff();
  v handbook_versions;
  p handbook_policies;
  cs staff;
  v_latest int;
  v_id uuid;
  v_at timestamptz;
begin
  if not hb_is_signer(me.email) then
    raise exception 'Only bookkeepers sign staff policies.' using errcode = '42501';
  end if;
  if not coalesce(p_ack, false) then
    raise exception 'Check the box to agree before signing.';
  end if;
  select * into v from handbook_versions where id = p_version_id;
  if v.id is null then raise exception 'Policy version not found.'; end if;
  select * into p from handbook_policies where id = v.policy_id for share;
  if not p.active then raise exception 'This policy is no longer active.'; end if;
  select max(version_no) into v_latest from handbook_versions where policy_id = p.id;
  if v.version_no <> v_latest then
    raise exception 'A newer version of this policy has been published. Reload and sign the latest version.';
  end if;
  if char_length(btrim(coalesce(p_typed_name, ''))) < 2
     or hb_norm_name(p_typed_name) <> hb_norm_name(me.name) then
    raise exception 'Type your full name exactly as it appears on your staff profile.';
  end if;
  if exists (select 1 from handbook_signatures where version_id = v.id and staff_email = lower(me.email)) then
    raise exception 'You have already signed this version.';
  end if;
  if coalesce(hb_state(p.id, me) ->> 'state', '') in ('signed', 'awaiting_countersign') then
    raise exception 'You have already signed this policy. Later versions were minor edits, so you don''t need to sign again.';
  end if;
  begin
    insert into handbook_signatures (version_id, staff_email, typed_name, ack_text, sign_ip, sign_ua, body_sha256)
    values (v.id, lower(me.email), left(btrim(p_typed_name), 200), hb_ack('signer'),
            tr_request_ip(), tr_request_ua(), v.body_sha256)
    returning id, signed_at into v_id, v_at;
  exception when unique_violation then
    raise exception 'You have already signed this version.';
  end;
  perform audit_write('handbook.signed', null, 'handbook_signature', v_id::text,
    jsonb_build_object('policy', p.slug, 'version_no', v.version_no, 'staff_email', lower(me.email)));
  cs := hb_countersigner();
  if cs.id is not null and lower(cs.email) <> lower(me.email) then
    perform hb_queue('handbook_countersign_needed', cs.email, v_id::text, jsonb_build_object(
      'policy_title', left(p.title, 200), 'policy_slug', p.slug, 'version_no', v.version_no,
      'signer_name', left(me.name, 120), 'signature_id', v_id, 'link', hb_link(p.slug)));
  end if;
  return jsonb_build_object('signature_id', v_id, 'signed_at', v_at, 'version_no', v.version_no,
                            'state', 'awaiting_countersign');
end $$;

-- hb_retry_export: as shipped, plus it refuses for the first 2 minutes after
-- the countersignature, while the first export (up to 60 s) may still be
-- running. Two parallel exports could file a second PDF revision whose hash
-- doesn't match the recorded one.
create or replace function public.hb_retry_export(p_signature_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me staff := hb_require_staff();
  g handbook_signatures;
begin
  if me.role <> 'admin' or not coalesce(is_active_staff_admin(), false) then
    raise exception 'Only admins can retry the export.' using errcode = '42501';
  end if;
  select * into g from handbook_signatures where id = p_signature_id;
  if g.id is null then raise exception 'Signature not found.'; end if;
  if g.countersigned_at is null then raise exception 'This signature is not countersigned yet.'; end if;
  if g.pdf_drive_file_id is not null then raise exception 'The signed PDF is already filed.'; end if;
  if g.countersigned_at > now() - interval '2 minutes' then
    raise exception 'This copy is probably still filing. Try again in two minutes.';
  end if;
  perform hb_kick(g.id);
  return jsonb_build_object('signature_id', g.id, 'export_started', true);
end $$;

-- Grant hardening (same as staff-handbook.sql).
revoke all on function public.hb_publish_version(uuid, text, boolean, text) from public, anon;
grant execute on function public.hb_publish_version(uuid, text, boolean, text) to authenticated;
revoke all on function public.hb_status() from public, anon;
grant execute on function public.hb_status() to authenticated;
revoke all on function public.hb_sign(uuid, text, boolean) from public, anon;
grant execute on function public.hb_sign(uuid, text, boolean) to authenticated;
revoke all on function public.hb_retry_export(uuid) from public, anon;
grant execute on function public.hb_retry_export(uuid) to authenticated;

commit;
