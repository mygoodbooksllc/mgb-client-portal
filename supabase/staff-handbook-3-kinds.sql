-- Staff Handbook, part 3: policy kinds, drafts and sections (spec
-- docs/staff-handbook-spec.md Part K). Run AFTER staff-handbook.sql and
-- staff-handbook-2-admin.sql. Safe to re-run. Flat file; every function pins
-- search_path = public. NOT applied to production yet.
--
-- Depends on (from staff-handbook.sql / staff-handbook-2-admin.sql):
--   handbook_policies, handbook_versions, handbook_signatures, handbook_settings,
--   staff, hb_require_staff(), hb_is_signer(), hb_countersigner(), hb_queue(),
--   hb_link(), hb_kick(), hb_ack(), hb_norm_name(), hb_today(),
--   tr_request_ip(), tr_request_ua(), audit_write(), is_active_staff(),
--   is_active_staff_admin().
-- If staff-handbook.sql or staff-handbook-2-admin.sql is re-run, run this
-- file right after: they redefine hb_status, hb_get_policy, hb_sign,
-- hb_publish_version, hb_retry_export and the read policies without the
-- kind / draft rules below.
--
-- What changes
--   handbook_policies gets three columns:
--     kind          'signed' (bookkeepers sign it, as before) or 'reference'
--                   (read only: versions and history, no signatures). Every
--                   existing row is backfilled to 'signed'. New rows default
--                   to 'reference'.
--     status        'draft' (admins only, staff can't read it through any RPC
--                   or table) or 'published'. Existing rows are 'published'.
--     section       optional heading the list groups reference policies by.
--     published_at  when the policy went live (null while a draft). Existing
--                   rows get their first version's publish time, so the due
--                   date of the seeded SLA policy doesn't move.
--   handbook_versions: the table check "version_no > 1 or requires_resign" is
--     replaced by an insert trigger: a signed policy's version 1 still always
--     needs signing; a reference policy's versions never do.
--   handbook_signatures: an insert trigger refuses a signature on a reference
--     or draft policy (backstop for hb_sign).
--   handbook_policies guard trigger: slug never changes; signed never becomes
--     reference; a published policy never goes back to draft; reference
--     becomes signed only inside hb_convert_to_signed (transaction-local
--     setting mgb.hb_convert, which PostgREST can't set).
--
--   Redefined (same behavior for signed, published policies):
--     hb_state            null for reference / draft; due date also waits for
--                         the policy's own publish date.
--     hb_status           policies carry kind / status / section; drafts only
--                         for admins; `my`, badge, grid and countersign queue
--                         only for signed, published policies.
--     hb_get_policy       a draft is "Policy not found." for non-admins.
--     hb_sign, hb_countersign, hb_retry_export, hb_signature_doc
--                         refuse reference and draft policies.
--     hb_publish_version  reference: never needs re-signing, never emails.
--                         Draft: no emails (they go out on publish).
--   New admin RPCs (each audited):
--     hb_create_policy(title, slug, kind, section, body_md)  -> a draft, v1.
--       No email, no Today item, no badge. handbook.policy_created
--     hb_publish_policy(policy_id)  draft -> published. For a signed policy
--       each active bookkeeper gets one handbook_sign_needed email.
--       handbook.policy_published
--     hb_update_policy(policy_id, title, section, sort)  handbook.policy_updated
--     hb_convert_to_signed(policy_id, body_md, change_note, confirm)
--       reference -> signed, publishing a new version that needs signing
--       (emails as a re-sign publish does). The only way to make a reference
--       policy signed. handbook.policy_converted
--
-- Checks: supabase/staff-handbook-3-kinds-tests.sql (one transaction, ends
-- in ROLLBACK): staff can't read drafts (RPC or table), nobody can sign a
-- reference policy, a non-admin can't create / publish / convert, anon can't
-- call anything, and the seeded flexible-work-sla policy is unchanged.

begin;

-- ---------------------------------------------------------------------------
-- Columns (existing rows: signed, published)
-- ---------------------------------------------------------------------------
alter table public.handbook_policies add column if not exists kind text not null default 'signed';
alter table public.handbook_policies add column if not exists status text not null default 'published';
alter table public.handbook_policies add column if not exists section text;
alter table public.handbook_policies add column if not exists published_at timestamptz;

update public.handbook_policies p
   set published_at = coalesce((select min(v.published_at) from public.handbook_versions v where v.policy_id = p.id),
                               p.created_at)
 where p.status = 'published' and p.published_at is null;

-- New rows (hb_create_policy) start as reference drafts.
alter table public.handbook_policies alter column kind set default 'reference';
alter table public.handbook_policies alter column status set default 'draft';

alter table public.handbook_policies drop constraint if exists handbook_policies_kind_check;
alter table public.handbook_policies add constraint handbook_policies_kind_check
  check (kind in ('signed', 'reference'));
alter table public.handbook_policies drop constraint if exists handbook_policies_status_check;
alter table public.handbook_policies add constraint handbook_policies_status_check
  check (status in ('draft', 'published'));
alter table public.handbook_policies drop constraint if exists handbook_policies_section_check;
alter table public.handbook_policies add constraint handbook_policies_section_check
  check (section is null or char_length(btrim(section)) between 1 and 80);
alter table public.handbook_policies drop constraint if exists handbook_policies_published_check;
alter table public.handbook_policies add constraint handbook_policies_published_check
  check ((status = 'published') = (published_at is not null));

-- Drop the "version_no > 1 or requires_resign" table check (unnamed in
-- staff-handbook.sql, so found by its text). hb_versions_kind_rule replaces it.
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.handbook_versions'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ~ 'version_no > 1' and pg_get_constraintdef(oid) ~ 'requires_resign'
  loop
    execute format('alter table public.handbook_versions drop constraint %I', c);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Rule triggers
-- ---------------------------------------------------------------------------
create or replace function public.hb_versions_kind_rule()
returns trigger language plpgsql set search_path = public as $$
declare k text;
begin
  select kind into k from handbook_policies where id = new.policy_id;
  if k = 'reference' and new.requires_resign then
    raise exception 'Reference policies are read only. Nobody signs them.' using errcode = '23514';
  end if;
  if k = 'signed' and new.version_no = 1 and not new.requires_resign then
    raise exception 'Version 1 of a signed policy always needs signing.' using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists hb_versions_kind_rule on public.handbook_versions;
create trigger hb_versions_kind_rule before insert on public.handbook_versions
  for each row execute function public.hb_versions_kind_rule();

create or replace function public.hb_signatures_kind_rule()
returns trigger language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from handbook_versions v join handbook_policies p on p.id = v.policy_id
                 where v.id = new.version_id and p.kind = 'signed' and p.status = 'published') then
    raise exception 'Only published signed policies can be signed.' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists hb_signatures_kind_rule on public.handbook_signatures;
create trigger hb_signatures_kind_rule before insert on public.handbook_signatures
  for each row execute function public.hb_signatures_kind_rule();

create or replace function public.hb_policies_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.slug is distinct from old.slug then
    raise exception 'A policy''s link name can''t change.' using errcode = '42501';
  end if;
  if old.kind = 'signed' and new.kind <> 'signed' then
    raise exception 'A signed policy can''t become a reference policy.' using errcode = '42501';
  end if;
  if old.kind = 'reference' and new.kind = 'signed'
     and coalesce(current_setting('mgb.hb_convert', true), '') <> 'on' then
    raise exception 'Use Make this a signed policy to ask for signatures.' using errcode = '42501';
  end if;
  if old.status = 'published' and new.status <> 'published' then
    raise exception 'A published policy can''t go back to draft.' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists hb_policies_guard on public.handbook_policies;
create trigger hb_policies_guard before update on public.handbook_policies
  for each row execute function public.hb_policies_guard();

-- ---------------------------------------------------------------------------
-- hb_state: as before, null for reference / draft policies, and the due date
-- also waits for the policy's own publish date (a signed draft published
-- days after its text was saved still gives 7 days).
-- ---------------------------------------------------------------------------
create or replace function public.hb_state(p_policy_id uuid, p_staff public.staff)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  p handbook_policies;
  r handbook_versions;
  g record;
  v_last int;
  v_due date;
begin
  select * into p from handbook_policies where id = p_policy_id;
  if p.id is null or p.kind <> 'signed' or p.status <> 'published' then return null; end if;
  select * into r from handbook_versions
  where policy_id = p_policy_id and requires_resign
  order by version_no desc limit 1;
  if r.id is null then return null; end if;
  select max(v.version_no) into v_last
  from handbook_signatures s join handbook_versions v on v.id = s.version_id
  where v.policy_id = p_policy_id and s.staff_email = lower(p_staff.email);
  select s.id, s.signed_at, s.countersigned_at, s.pdf_drive_file_id, v.version_no into g
  from handbook_signatures s join handbook_versions v on v.id = s.version_id
  where v.policy_id = p_policy_id and s.staff_email = lower(p_staff.email) and v.version_no >= r.version_no
  order by v.version_no desc limit 1;
  if g.id is not null then
    return jsonb_build_object(
      'state', case when g.countersigned_at is null then 'awaiting_countersign' else 'signed' end,
      'required_version_no', r.version_no, 'due_date', null, 'overdue', false,
      'signature_id', g.id, 'version_no', g.version_no, 'signed_at', g.signed_at,
      'countersigned_at', g.countersigned_at, 'has_pdf', g.pdf_drive_file_id is not null,
      'last_signed_version_no', v_last);
  end if;
  v_due := greatest((r.published_at at time zone 'America/Chicago')::date,
                    (coalesce(p.published_at, r.published_at) at time zone 'America/Chicago')::date,
                    (coalesce(p_staff.created_at, r.published_at) at time zone 'America/Chicago')::date) + 7;
  return jsonb_build_object(
    'state', case when hb_today() > v_due then 'overdue' else 'not_signed' end,
    'required_version_no', r.version_no, 'due_date', v_due, 'overdue', hb_today() > v_due,
    'signature_id', null, 'version_no', null, 'signed_at', null, 'countersigned_at', null,
    'has_pdf', false, 'last_signed_version_no', v_last);
end $$;

-- ---------------------------------------------------------------------------
-- hb_status (as in staff-handbook-2-admin.sql, plus kinds and drafts)
-- ---------------------------------------------------------------------------
create or replace function public.hb_status()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  me staff := hb_require_staff();
  is_admin boolean := me.role = 'admin';
  sees_drafts boolean := me.role = 'admin' and coalesce(is_active_staff_admin(), false);
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
      'kind', p.kind, 'status', p.status, 'section', p.section, 'published_at', p.published_at,
      'latest_version_id', l.id, 'latest_version_no', l.version_no,
      'required_version_no', r.version_no, 'required_published_at', r.published_at,
      'my', case when is_signer and p.kind = 'signed' and p.status = 'published' then hb_state(p.id, me) end)
      order by p.sort, p.title), '[]'::jsonb)
    into v_policies
  from handbook_policies p
  left join lateral (select id, version_no from handbook_versions where policy_id = p.id
                     order by version_no desc limit 1) l on true
  left join lateral (select version_no, published_at from handbook_versions where policy_id = p.id and requires_resign
                     order by version_no desc limit 1) r on true
  where p.active and l.id is not null and (p.status = 'published' or sees_drafts);
  if is_signer then
    select count(*) into v_badge from jsonb_array_elements(v_policies) e
    where e ->> 'kind' = 'signed' and e ->> 'status' = 'published'
      and e -> 'my' ->> 'state' in ('not_signed', 'overdue');
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
    where s.countersigned_at is null and s.staff_email <> lower(me.email)
      and p.kind = 'signed' and p.status = 'published';
    v_badge := v_badge + jsonb_array_length(v_queue);
  end if;
  if is_admin then
    select coalesce(jsonb_agg(jsonb_build_object(
        'policy_id', p.id, 'policy_slug', p.slug, 'staff_email', lower(b.email), 'staff_name', b.name)
        || hb_state(p.id, b) order by p.sort, p.title, b.name), '[]'::jsonb) into v_grid
    from handbook_policies p
    cross join staff b
    where p.active and p.kind = 'signed' and p.status = 'published'
      and b.role = 'bookkeeper' and b.active = true
      and exists (select 1 from handbook_versions x where x.policy_id = p.id);
    select coalesce(jsonb_agg(jsonb_build_object(
        'signature_id', s.id, 'policy_slug', p.slug, 'policy_title', p.title, 'version_no', v.version_no,
        'signer_name', coalesce(st.name, s.typed_name), 'signed_at', s.signed_at,
        'countersigned_at', s.countersigned_at) order by s.countersigned_at), '[]'::jsonb) into v_unfiled
    from handbook_signatures s
    join handbook_versions v on v.id = s.version_id
    join handbook_policies p on p.id = v.policy_id
    left join staff st on lower(st.email) = s.staff_email
    where s.countersigned_at is not null and s.pdf_drive_file_id is null and p.kind = 'signed';
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

-- ---------------------------------------------------------------------------
-- hb_get_policy: drafts are "not found" for anyone but an admin.
-- ---------------------------------------------------------------------------
create or replace function public.hb_get_policy(p_slug text, p_version_no int default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  me staff := hb_require_staff();
  is_admin boolean := me.role = 'admin';
  sees_drafts boolean := me.role = 'admin' and coalesce(is_active_staff_admin(), false);
  is_signer boolean := hb_is_signer(me.email);
  cs staff := hb_countersigner();
  p handbook_policies;
  v handbook_versions;
  r handbook_versions;
  l handbook_versions;
  signs boolean;
begin
  select * into p from handbook_policies where slug = p_slug;
  if p.id is null or (not p.active and not is_admin) or (p.status <> 'published' and not sees_drafts) then
    raise exception 'Policy not found.';
  end if;
  signs := p.kind = 'signed' and p.status = 'published';
  select * into l from handbook_versions where policy_id = p.id order by version_no desc limit 1;
  select * into r from handbook_versions where policy_id = p.id and requires_resign order by version_no desc limit 1;
  if p_version_no is null then v := l;
  else select * into v from handbook_versions where policy_id = p.id and version_no = p_version_no;
  end if;
  if p_version_no is not null and v.id is null then raise exception 'Version not found.'; end if;
  return jsonb_build_object(
    'policy', jsonb_build_object('id', p.id, 'slug', p.slug, 'title', p.title, 'sort', p.sort, 'active', p.active,
                                 'kind', p.kind, 'status', p.status, 'section', p.section,
                                 'published_at', p.published_at),
    'version', case when v.id is null then null else jsonb_build_object(
      'id', v.id, 'version_no', v.version_no, 'body_md', v.body_md, 'body_sha256', v.body_sha256,
      'requires_resign', v.requires_resign, 'change_note', v.change_note,
      'published_at', v.published_at, 'published_by', v.published_by,
      'is_latest', v.id = l.id) end,
    'latest_version_id', l.id,
    'latest_version_no', l.version_no,
    'required_version_no', case when p.kind = 'signed' then r.version_no end,
    'required_published_at', case when p.kind = 'signed' then r.published_at end,
    'versions', coalesce((select jsonb_agg(jsonb_build_object(
        'id', x.id, 'version_no', x.version_no, 'requires_resign', x.requires_resign,
        'change_note', x.change_note, 'published_at', x.published_at, 'published_by', x.published_by,
        'body_sha256', x.body_sha256) order by x.version_no desc)
      from handbook_versions x where x.policy_id = p.id), '[]'::jsonb),
    'me', jsonb_build_object(
      'email', lower(me.email), 'name', me.name, 'is_admin', is_admin, 'is_signer', is_signer,
      'is_countersigner', cs.id is not null and lower(cs.email) = lower(me.email),
      'status', case when is_signer and signs then hb_state(p.id, me) end,
      'signatures', case when p.kind <> 'signed' then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object(
          'id', s.id, 'version_no', x.version_no, 'signed_at', s.signed_at,
          'countersigned_at', s.countersigned_at, 'has_pdf', s.pdf_drive_file_id is not null) order by x.version_no desc)
        from handbook_signatures s join handbook_versions x on x.id = s.version_id
        where x.policy_id = p.id and s.staff_email = lower(me.email)), '[]'::jsonb) end),
    'countersigner', case when cs.id is null then null
      else jsonb_build_object('email', lower(cs.email), 'name', cs.name) end);
end $$;

-- ---------------------------------------------------------------------------
-- hb_sign: as in staff-handbook-2-admin.sql, plus the kind / draft refusals.
-- ---------------------------------------------------------------------------
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
  if p.status <> 'published' then raise exception 'Policy version not found.'; end if;
  if p.kind <> 'signed' then
    raise exception 'This policy is for reading only. There is nothing to sign.' using errcode = '42501';
  end if;
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

-- hb_countersign: as in staff-handbook.sql, plus the kind refusal (checked
-- before the update instead of after it).
create or replace function public.hb_countersign(p_signature_id uuid, p_typed_name text, p_ack boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me staff := hb_require_staff();
  cs staff := hb_countersigner();
  g handbook_signatures;
  v handbook_versions;
  p handbook_policies;
  v_at timestamptz;
begin
  if cs.id is null or lower(cs.email) <> lower(me.email) then
    raise exception 'Only the handbook countersigner can countersign.' using errcode = '42501';
  end if;
  if not coalesce(p_ack, false) then
    raise exception 'Check the box to agree before countersigning.';
  end if;
  select * into g from handbook_signatures where id = p_signature_id for update;
  if g.id is null then raise exception 'Signature not found.'; end if;
  select * into v from handbook_versions where id = g.version_id;
  select * into p from handbook_policies where id = v.policy_id;
  if p.kind <> 'signed' or p.status <> 'published' then
    raise exception 'Only signed policies are countersigned.' using errcode = '42501';
  end if;
  if g.countersigned_at is not null then raise exception 'This signature is already countersigned.'; end if;
  if g.staff_email = lower(me.email) then
    raise exception 'You can''t countersign your own signature.' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_typed_name, ''))) < 2
     or hb_norm_name(p_typed_name) <> hb_norm_name(me.name) then
    raise exception 'Type your full name exactly as it appears on your staff profile.';
  end if;
  v_at := now();
  update handbook_signatures set
    countersigner_email = lower(me.email),
    countersign_typed_name = left(btrim(p_typed_name), 200),
    countersign_ack_text = hb_ack('countersigner'),
    countersigned_at = v_at,
    countersign_ip = tr_request_ip(),
    countersign_ua = tr_request_ua()
  where id = g.id;
  perform audit_write('handbook.countersigned', null, 'handbook_signature', g.id::text,
    jsonb_build_object('policy', p.slug, 'version_no', v.version_no, 'staff_email', g.staff_email));
  perform hb_kick(g.id);
  return jsonb_build_object('signature_id', g.id, 'countersigned_at', v_at, 'state', 'signed', 'export_started', true);
end $$;

-- hb_retry_export: as in staff-handbook-2-admin.sql, plus the kind refusal.
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
  if not exists (select 1 from handbook_versions v join handbook_policies p on p.id = v.policy_id
                 where v.id = g.version_id and p.kind = 'signed') then
    raise exception 'Only signed policies have signed copies.';
  end if;
  if g.countersigned_at is null then raise exception 'This signature is not countersigned yet.'; end if;
  if g.pdf_drive_file_id is not null then raise exception 'The signed PDF is already filed.'; end if;
  if g.countersigned_at > now() - interval '2 minutes' then
    raise exception 'This copy is probably still filing. Try again in two minutes.';
  end if;
  perform hb_kick(g.id);
  return jsonb_build_object('signature_id', g.id, 'export_started', true);
end $$;

-- hb_signature_doc (service role, PDF export): null for anything but a
-- countersigned signature on a signed policy, which team-reviews treats as
-- "not ready" / not found.
create or replace function public.hb_signature_doc(p_signature_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare g handbook_signatures; v handbook_versions; p handbook_policies;
begin
  select * into g from handbook_signatures where id = p_signature_id;
  if g.id is null or g.countersigned_at is null then return null; end if;
  select * into v from handbook_versions where id = g.version_id;
  select * into p from handbook_policies where id = v.policy_id;
  if p.kind <> 'signed' then return null; end if;
  return jsonb_build_object(
    'signature_id', g.id,
    'policy', jsonb_build_object('id', p.id, 'slug', p.slug, 'title', p.title),
    'version', jsonb_build_object('id', v.id, 'version_no', v.version_no, 'body_md', v.body_md,
                                  'body_sha256', v.body_sha256, 'published_at', v.published_at,
                                  'requires_resign', v.requires_resign),
    'effective_date', to_char(g.signed_at at time zone 'America/Chicago', 'YYYY-MM-DD'),
    'signer', jsonb_build_object('email', g.staff_email,
      'name', (select name from staff where lower(email) = g.staff_email limit 1),
      'typed_name', g.typed_name, 'ack_text', g.ack_text, 'signed_at', g.signed_at,
      'ip', host(g.sign_ip), 'user_agent', g.sign_ua, 'body_sha256', g.body_sha256),
    'countersigner', jsonb_build_object('email', g.countersigner_email,
      'name', (select name from staff where lower(email) = g.countersigner_email limit 1),
      'typed_name', g.countersign_typed_name, 'ack_text', g.countersign_ack_text,
      'signed_at', g.countersigned_at, 'ip', host(g.countersign_ip), 'user_agent', g.countersign_ua),
    'pdf_drive_file_id', g.pdf_drive_file_id,
    'pdf_sha256', g.pdf_sha256);
end $$;

-- ---------------------------------------------------------------------------
-- hb_publish_version: as in staff-handbook-2-admin.sql, plus
--   reference: never needs re-signing (p_requires_resign true is refused),
--              never emails;
--   draft:     no emails (hb_publish_policy sends them when it goes live).
-- ---------------------------------------------------------------------------
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
  select * into p from handbook_policies where id = p_policy_id for update;
  if p.id is null then raise exception 'Policy not found.'; end if;
  if p.kind = 'reference' then
    if coalesce(p_requires_resign, false) then
      raise exception 'Reference policies are read only. Use Make this a signed policy to ask for signatures.';
    end if;
  elsif p_requires_resign is null then
    raise exception 'Choose Needs re-signing or Minor edit.';
  end if;
  select coalesce(max(version_no), 0) + 1 into v_no from handbook_versions where policy_id = p.id;
  v_sha := encode(sha256(convert_to(p_body_md, 'UTF8')), 'hex');
  select body_sha256 into v_last_sha from handbook_versions where policy_id = p.id order by version_no desc limit 1;
  if v_last_sha = v_sha then
    raise exception 'This text is the same as the current version. Change the text before publishing.';
  end if;
  v_resign := p.kind = 'signed' and (p_requires_resign or v_no = 1);
  insert into handbook_versions (policy_id, version_no, body_md, body_sha256, requires_resign, change_note, published_by)
  values (p.id, v_no, p_body_md, v_sha, v_resign, nullif(left(btrim(coalesce(p_change_note, '')), 2000), ''), lower(me.email))
  returning id, published_at into v_id, v_at;
  if v_resign and p.active and p.status = 'published' then
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
                       'kind', p.kind, 'draft', p.status = 'draft',
                       'body_sha256', v_sha, 'change_note', left(coalesce(p_change_note, ''), 500), 'notified', n));
  return jsonb_build_object('version_id', v_id, 'version_no', v_no, 'requires_resign', v_resign,
                            'body_sha256', v_sha, 'published_at', v_at, 'notified', n);
end $$;

-- ---------------------------------------------------------------------------
-- New admin RPCs
-- ---------------------------------------------------------------------------
-- Shared admin gate for the RPCs below.
create or replace function public.hb_require_admin()
returns public.staff language plpgsql stable security definer set search_path = public as $$
declare me staff := hb_require_staff();
begin
  if me.role <> 'admin' or not coalesce(is_active_staff_admin(), false) then
    raise exception 'Only admins can manage handbook policies.' using errcode = '42501';
  end if;
  return me;
end $$;

-- A new policy, always a draft with its first version. Nobody is emailed and
-- nothing shows on Today or the badge until hb_publish_policy (and only then
-- for a signed policy).
create or replace function public.hb_create_policy(p_title text, p_slug text, p_kind text, p_section text,
                                                   p_body_md text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me staff := hb_require_admin();
  v_title text := btrim(coalesce(p_title, ''));
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_kind text := coalesce(nullif(btrim(p_kind), ''), 'reference');
  v_section text := nullif(btrim(coalesce(p_section, '')), '');
  v_sort int;
  v_id uuid;
  v_vid uuid;
begin
  if char_length(v_title) not between 1 and 200 then raise exception 'Give the policy a title (up to 200 characters).'; end if;
  if v_slug !~ '^[a-z0-9][a-z0-9-]{1,80}$' then
    raise exception 'The link name must be 2 to 81 lower-case letters, numbers or hyphens, starting with a letter or number.';
  end if;
  if v_kind not in ('signed', 'reference') then raise exception 'Choose Reference or Signed.'; end if;
  if v_section is not null and char_length(v_section) > 80 then raise exception 'Keep the section under 80 characters.'; end if;
  if btrim(coalesce(p_body_md, '')) = '' then raise exception 'The policy text is empty.'; end if;
  if char_length(p_body_md) > 200000 then raise exception 'The policy text is too long.'; end if;
  if exists (select 1 from handbook_policies where slug = v_slug) then
    raise exception 'Another policy already uses the link name %.', v_slug;
  end if;
  select coalesce(max(sort), 0) + 10 into v_sort from handbook_policies;
  begin
    insert into handbook_policies (slug, title, sort, kind, status, section, published_at)
    values (v_slug, v_title, v_sort, v_kind, 'draft', v_section, null)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'Another policy already uses the link name %.', v_slug;
  end;
  insert into handbook_versions (policy_id, version_no, body_md, body_sha256, requires_resign, change_note, published_by)
  values (v_id, 1, p_body_md, encode(sha256(convert_to(p_body_md, 'UTF8')), 'hex'), v_kind = 'signed',
          'First draft.', lower(me.email))
  returning id into v_vid;
  perform audit_write('handbook.policy_created', null, 'handbook_policy', v_id::text,
    jsonb_build_object('policy', v_slug, 'title', left(v_title, 200), 'kind', v_kind, 'section', v_section));
  return jsonb_build_object('policy_id', v_id, 'slug', v_slug, 'kind', v_kind, 'status', 'draft', 'version_id', v_vid);
end $$;

-- Draft -> published. A signed policy asks every active bookkeeper to sign
-- (one handbook_sign_needed email each, due in 7 days); a reference policy
-- emails nobody.
create or replace function public.hb_publish_policy(p_policy_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me staff := hb_require_admin();
  p handbook_policies;
  r handbook_versions;
  b staff;
  n int := 0;
  v_at timestamptz := now();
begin
  select * into p from handbook_policies where id = p_policy_id for update;
  if p.id is null then raise exception 'Policy not found.'; end if;
  if p.status = 'published' then raise exception 'This policy is already published.'; end if;
  if not exists (select 1 from handbook_versions where policy_id = p.id) then
    raise exception 'This policy has no text yet.';
  end if;
  update handbook_policies set status = 'published', published_at = v_at where id = p.id;
  if p.kind = 'signed' and p.active then
    select * into r from handbook_versions where policy_id = p.id and requires_resign order by version_no desc limit 1;
    for b in select * from staff where role = 'bookkeeper' and active = true order by name loop
      perform hb_queue('handbook_sign_needed', b.email, r.id::text, jsonb_build_object(
        'policy_title', left(p.title, 200), 'policy_slug', p.slug, 'version_no', r.version_no,
        'due_date', greatest((v_at at time zone 'America/Chicago')::date,
                             (b.created_at at time zone 'America/Chicago')::date) + 7,
        'link', hb_link(p.slug)));
      n := n + 1;
    end loop;
  end if;
  perform audit_write('handbook.policy_published', null, 'handbook_policy', p.id::text,
    jsonb_build_object('policy', p.slug, 'kind', p.kind, 'notified', n));
  return jsonb_build_object('policy_id', p.id, 'slug', p.slug, 'kind', p.kind, 'status', 'published',
                            'published_at', v_at, 'notified', n);
end $$;

-- Title, section and list order. Kind and status have their own RPCs; the
-- slug never changes (links in emails point at it).
create or replace function public.hb_update_policy(p_policy_id uuid, p_title text, p_section text, p_sort int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me staff := hb_require_admin();
  p handbook_policies;
  v_title text := btrim(coalesce(p_title, ''));
  v_section text := nullif(btrim(coalesce(p_section, '')), '');
begin
  select * into p from handbook_policies where id = p_policy_id for update;
  if p.id is null then raise exception 'Policy not found.'; end if;
  if char_length(v_title) not between 1 and 200 then raise exception 'Give the policy a title (up to 200 characters).'; end if;
  if v_section is not null and char_length(v_section) > 80 then raise exception 'Keep the section under 80 characters.'; end if;
  if p_sort is not null and (p_sort < -100000 or p_sort > 100000) then raise exception 'The order must be between -100000 and 100000.'; end if;
  update handbook_policies set title = v_title, section = v_section, sort = coalesce(p_sort, p.sort) where id = p.id;
  perform audit_write('handbook.policy_updated', null, 'handbook_policy', p.id::text,
    jsonb_build_object('policy', p.slug,
      'title', case when v_title is distinct from p.title then jsonb_build_array(p.title, v_title) end,
      'section', case when v_section is distinct from p.section then jsonb_build_array(p.section, v_section) end,
      'sort', case when coalesce(p_sort, p.sort) <> p.sort then jsonb_build_array(p.sort, p_sort) end));
  return jsonb_build_object('policy_id', p.id, 'title', v_title, 'section', v_section, 'sort', coalesce(p_sort, p.sort));
end $$;

-- Reference -> signed. The only way to make a reference policy signed: the
-- caller must pass p_confirm = true and a change note, and a new version
-- that needs signing is published (the current text when p_body_md is
-- empty). Published: every active bookkeeper is emailed, as for a re-sign
-- publish. Draft: no emails until hb_publish_policy.
create or replace function public.hb_convert_to_signed(p_policy_id uuid, p_body_md text, p_change_note text,
                                                       p_confirm boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me staff := hb_require_admin();
  p handbook_policies;
  l handbook_versions;
  v_body text;
  v_no int;
  v_id uuid;
  v_at timestamptz;
  v_sha text;
  b staff;
  n int := 0;
begin
  if not coalesce(p_confirm, false) then
    raise exception 'Confirm that every bookkeeper will need to sign this policy.';
  end if;
  if btrim(coalesce(p_change_note, '')) = '' then
    raise exception 'Add a short change note so people know why they are signing.';
  end if;
  select * into p from handbook_policies where id = p_policy_id for update;
  if p.id is null then raise exception 'Policy not found.'; end if;
  if p.kind = 'signed' then raise exception 'This policy is already signed.'; end if;
  select * into l from handbook_versions where policy_id = p.id order by version_no desc limit 1;
  v_body := case when btrim(coalesce(p_body_md, '')) = '' then l.body_md else p_body_md end;
  if btrim(coalesce(v_body, '')) = '' then raise exception 'The policy text is empty.'; end if;
  if char_length(v_body) > 200000 then raise exception 'The policy text is too long.'; end if;

  perform set_config('mgb.hb_convert', 'on', true);
  update handbook_policies set kind = 'signed' where id = p.id;
  perform set_config('mgb.hb_convert', '', true);

  v_no := coalesce(l.version_no, 0) + 1;
  v_sha := encode(sha256(convert_to(v_body, 'UTF8')), 'hex');
  insert into handbook_versions (policy_id, version_no, body_md, body_sha256, requires_resign, change_note, published_by)
  values (p.id, v_no, v_body, v_sha, true, left(btrim(p_change_note), 2000), lower(me.email))
  returning id, published_at into v_id, v_at;
  if p.active and p.status = 'published' then
    for b in select * from staff where role = 'bookkeeper' and active = true order by name loop
      perform hb_queue('handbook_sign_needed', b.email, v_id::text, jsonb_build_object(
        'policy_title', left(p.title, 200), 'policy_slug', p.slug, 'version_no', v_no,
        'due_date', greatest((v_at at time zone 'America/Chicago')::date,
                             (b.created_at at time zone 'America/Chicago')::date) + 7,
        'link', hb_link(p.slug)));
      n := n + 1;
    end loop;
  end if;
  perform audit_write('handbook.policy_converted', null, 'handbook_policy', p.id::text,
    jsonb_build_object('policy', p.slug, 'from', 'reference', 'to', 'signed', 'version_no', v_no,
                       'body_sha256', v_sha, 'change_note', left(p_change_note, 500), 'notified', n));
  return jsonb_build_object('policy_id', p.id, 'kind', 'signed', 'version_id', v_id, 'version_no', v_no,
                            'requires_resign', true, 'notified', n);
end $$;

-- ---------------------------------------------------------------------------
-- RLS: staff read published policies and their versions; drafts only admins.
-- (Writes stay RPC-only, as in staff-handbook.sql.)
-- ---------------------------------------------------------------------------
drop policy if exists hb_policies_read on public.handbook_policies;
create policy hb_policies_read on public.handbook_policies for select to authenticated
  using (public.is_active_staff() and (status = 'published' or public.is_active_staff_admin()));

drop policy if exists hb_versions_read on public.handbook_versions;
create policy hb_versions_read on public.handbook_versions for select to authenticated
  using (public.is_active_staff()
         and (public.is_active_staff_admin()
              or exists (select 1 from public.handbook_policies p
                         where p.id = handbook_versions.policy_id and p.status = 'published')));

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'hb_versions_kind_rule()', 'hb_signatures_kind_rule()', 'hb_policies_guard()', 'hb_require_admin()',
    'hb_state(uuid, public.staff)', 'hb_signature_doc(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  execute 'grant execute on function public.hb_signature_doc(uuid) to service_role';
  foreach f in array array[
    'hb_status()', 'hb_get_policy(text, integer)', 'hb_sign(uuid, text, boolean)',
    'hb_countersign(uuid, text, boolean)', 'hb_retry_export(uuid)',
    'hb_publish_version(uuid, text, boolean, text)',
    'hb_create_policy(text, text, text, text, text)', 'hb_publish_policy(uuid)',
    'hb_update_policy(uuid, text, text, integer)', 'hb_convert_to_signed(uuid, text, text, boolean)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

commit;
