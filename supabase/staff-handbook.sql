-- Staff Handbook (signed staff policies), database part. Owner request
-- 2026-10-13; spec docs/staff-handbook-spec.md Parts B, C, F and G.
-- Safe to re-run. Flat file; every function pins search_path = public.
--
-- Later changes: supabase/staff-handbook-2-admin.sql redefines hb_publish_version
-- (refuses identical text) and hb_status (adds `unfiled` for admins). If you
-- re-run this file, run that one right after it, then
-- supabase/staff-handbook-3-kinds.sql (policy kinds and drafts), which
-- redefines most hb_* functions and the read policies again.
-- Re-run guard: once staff-handbook-3-kinds.sql has run (handbook_policies has
-- a `kind` column), this file refuses to run unless mgb.rerun_superseded is
-- 'on' (see the guard below). The whole file is one transaction.
--
-- Depends on (checked against the live database 2026-10-13):
--   * public.staff (id, email unique + lower-case @mygoodbooks.org, name,
--     role in ('bookkeeper', 'admin'), active, created_at)
--   * is_active_staff(), is_active_staff_admin() (both also require a Google
--     sign-in, via jwt_has_google())
--   * audit_write(text, text, text, text, jsonb) and audit_log (audit-log.sql)
--   * notification_outbox (kind, recipient_email lower-case, client_id, ref_id,
--     payload <= 4 KB), sent every 5 minutes by notification-emails. Its kind
--     check and client_email_log_feature_check are redone below with the live
--     lists (same as tech-inventory-v2.sql) plus the two handbook kinds.
--   * tr_request_ip(), tr_request_ua() (team-reviews-2-rpcs.sql)
--   * the tr_kick pattern (team-reviews-2-rpcs.sql): Vault secret
--     qbo_cron_key + pg_net POST to the team-reviews edge function. hb_kick
--     below is the handbook copy.
--   * clients.account_manager_email (account-manager.sql), only to seed the
--     countersigner the first time.
--
-- What it holds
--   handbook_policies    one row per policy (slug, title, sort, active)
--   handbook_versions    the published text of each version. Immutable.
--   handbook_signatures  one row per signer per version. Insert-only, except
--                        the countersign columns (set once, from null) and
--                        the two PDF columns (set once, from null).
--   handbook_settings    one row: countersigner_email.
--
-- Rules
--   * Signers: hb_is_signer(email) = active staff with role 'bookkeeper'.
--   * Required version per policy = the newest version with
--     requires_resign = true (v1 always counts). A bookkeeper is current when
--     they signed that version or a later one.
--   * Due date = the required version's publish date (America/Chicago), or the
--     bookkeeper's own created_at date if later, plus 7 calendar days. It is
--     computed (hb_state), never stored.
--   * States: not_signed, overdue, awaiting_countersign, signed.
--   * Typed names must match staff.name with case and whitespace ignored.
--   * No direct writes from the browser. All writes go through the hb_* RPCs
--     (SECURITY DEFINER), and every write RPC calls audit_write:
--     handbook.signed, handbook.countersigned, handbook.published,
--     handbook.countersigner_changed. handbook.exported is written by the
--     edge-function helpers hb_record_export / hb_log_export.
--   * Emails (notification_outbox, link only, no policy text):
--       handbook_countersign_needed  to the countersigner when someone signs
--       handbook_sign_needed         to each active bookkeeper when a version
--                                    that needs re-signing is published

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
begin;

-- Re-run guard (2026-10-19): once staff-handbook-3-kinds.sql has run, re-running this file
-- would silently put back the pre-kinds hb_* functions and read policies. So it stops here with an error and changes
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

create table if not exists public.handbook_policies (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,80}$'),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.handbook_versions (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.handbook_policies(id),
  version_no int not null check (version_no >= 1),
  body_md text not null check (char_length(btrim(body_md)) between 1 and 200000),
  body_sha256 text not null check (body_sha256 ~ '^[0-9a-f]{64}$'),
  requires_resign boolean not null,
  change_note text check (char_length(change_note) <= 2000),
  published_at timestamptz not null default now(),
  published_by text not null check (published_by = lower(published_by)),
  unique (policy_id, version_no),
  check (version_no > 1 or requires_resign)
);

create table if not exists public.handbook_signatures (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.handbook_versions(id),
  staff_email text not null check (staff_email = lower(staff_email)),
  typed_name text not null check (char_length(btrim(typed_name)) between 2 and 200),
  ack_text text not null,
  signed_at timestamptz not null default now(),
  sign_ip inet,
  sign_ua text,
  body_sha256 text not null,
  countersigner_email text check (countersigner_email = lower(countersigner_email)),
  countersign_typed_name text check (char_length(btrim(countersign_typed_name)) between 2 and 200),
  countersign_ack_text text,
  countersigned_at timestamptz,
  countersign_ip inet,
  countersign_ua text,
  pdf_drive_file_id text,
  pdf_sha256 text,
  unique (version_id, staff_email),
  check (countersigner_email is distinct from staff_email),
  check ((countersigned_at is null) = (countersigner_email is null)
     and (countersigned_at is null) = (countersign_typed_name is null)
     and (countersigned_at is null) = (countersign_ack_text is null)),
  check ((pdf_drive_file_id is null) = (pdf_sha256 is null)),
  check (pdf_drive_file_id is null or countersigned_at is not null)
);
create index if not exists handbook_signatures_staff_idx on public.handbook_signatures (staff_email);
create index if not exists handbook_signatures_open_idx on public.handbook_signatures (signed_at) where countersigned_at is null;

create table if not exists public.handbook_settings (
  id int primary key default 1 check (id = 1),
  countersigner_email text references public.staff(email) on update cascade on delete set null,
  updated_at timestamptz not null default now(),
  updated_by text
);
-- First run only: the firm's account manager (the most common
-- clients.account_manager_email that is an active staff member). Change it
-- with hb_set_countersigner.
insert into public.handbook_settings (id, countersigner_email)
select 1, (select lower(c.account_manager_email) from public.clients c
           join public.staff s on lower(s.email) = lower(c.account_manager_email) and s.active
           where c.account_manager_email is not null
           group by lower(c.account_manager_email) order by count(*) desc, 1 limit 1)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Lock triggers
-- ---------------------------------------------------------------------------
create or replace function public.hb_versions_immutable()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'Published policy versions can''t be changed or deleted. Publish a new version instead.'
    using errcode = '42501';
end $$;

create or replace function public.hb_no_truncate()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'Staff Handbook records are kept forever (%).', tg_table_name using errcode = '42501';
end $$;

create or replace function public.hb_signatures_guard()
returns trigger language plpgsql set search_path = public as $$
declare
  v_cs text[] := array['countersigner_email', 'countersign_typed_name', 'countersign_ack_text',
                       'countersigned_at', 'countersign_ip', 'countersign_ua'];
  v_pdf text[] := array['pdf_drive_file_id', 'pdf_sha256'];
  v_cs_changed boolean;
  v_pdf_changed boolean;
begin
  if tg_op = 'DELETE' then
    raise exception 'Signed policy records are kept forever and can''t be deleted.' using errcode = '42501';
  end if;
  if (to_jsonb(new) - v_cs - v_pdf) is distinct from (to_jsonb(old) - v_cs - v_pdf) then
    raise exception 'A signature can''t be changed once saved.' using errcode = '42501';
  end if;
  v_cs_changed := (new.countersigner_email, new.countersign_typed_name, new.countersign_ack_text,
                   new.countersigned_at, new.countersign_ip, new.countersign_ua)
       is distinct from (old.countersigner_email, old.countersign_typed_name, old.countersign_ack_text,
                         old.countersigned_at, old.countersign_ip, old.countersign_ua);
  v_pdf_changed := (new.pdf_drive_file_id, new.pdf_sha256) is distinct from (old.pdf_drive_file_id, old.pdf_sha256);
  if v_cs_changed and v_pdf_changed then
    raise exception 'Countersign first, then file the PDF.' using errcode = '42501';
  end if;
  if v_cs_changed then
    if old.countersigned_at is not null or old.countersigner_email is not null or old.countersign_typed_name is not null
       or old.countersign_ack_text is not null or old.countersign_ip is not null or old.countersign_ua is not null then
      raise exception 'This signature is already countersigned.' using errcode = '42501';
    end if;
    if new.countersigner_email is null or new.countersign_typed_name is null
       or new.countersign_ack_text is null or new.countersigned_at is null then
      raise exception 'A countersignature needs the countersigner, typed name, acknowledgment and time.' using errcode = '42501';
    end if;
  end if;
  if v_pdf_changed then
    if old.pdf_drive_file_id is not null or old.pdf_sha256 is not null then
      raise exception 'The signed PDF is already filed.' using errcode = '42501';
    end if;
    if new.pdf_drive_file_id is null or new.pdf_sha256 is null then
      raise exception 'Filing needs both the Drive file id and the PDF hash.' using errcode = '42501';
    end if;
    if old.countersigned_at is null then
      raise exception 'Only countersigned records are filed.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists hb_versions_immutable on public.handbook_versions;
create trigger hb_versions_immutable before update or delete on public.handbook_versions
  for each row execute function public.hb_versions_immutable();
drop trigger if exists hb_signatures_guard on public.handbook_signatures;
create trigger hb_signatures_guard before update or delete on public.handbook_signatures
  for each row execute function public.hb_signatures_guard();
drop trigger if exists hb_no_truncate on public.handbook_versions;
create trigger hb_no_truncate before truncate on public.handbook_versions
  for each statement execute function public.hb_no_truncate();
drop trigger if exists hb_no_truncate on public.handbook_signatures;
create trigger hb_no_truncate before truncate on public.handbook_signatures
  for each statement execute function public.hb_no_truncate();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- Case and all whitespace ignored when comparing a typed name to staff.name.
create or replace function public.hb_norm_name(p text)
returns text language sql immutable set search_path = public as $$
  select lower(regexp_replace(coalesce(p, ''), '[\s ]+', '', 'g'));
$$;

-- The one place the bookkeeper-only rule lives.
create or replace function public.hb_is_signer(p_email text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from staff
                 where lower(email) = lower(p_email) and role = 'bookkeeper' and active = true);
$$;

-- Fixed acknowledgment sentences stored on each signature. Do not reword
-- without the owner.
create or replace function public.hb_ack(p_role text)
returns text language sql immutable set search_path = public as $$
  select case p_role
    when 'signer' then 'I have read and agree to this policy, and I agree to sign it electronically.'
    when 'countersigner' then 'I countersign this policy on behalf of MyGoodBooks, and I agree to sign it electronically.'
  end;
$$;

create or replace function public.hb_require_staff()
returns public.staff language plpgsql stable security definer set search_path = public as $$
declare me staff;
begin
  if not coalesce(is_active_staff(), false) then
    raise exception 'The Staff Handbook is for MyGoodBooks staff.' using errcode = '42501';
  end if;
  select * into me from staff
  where lower(email) = lower(auth.jwt() ->> 'email') and active = true limit 1;
  if me.id is null then
    raise exception 'The Staff Handbook is for MyGoodBooks staff.' using errcode = '42501';
  end if;
  return me;
end $$;

-- The active countersigner's staff row (null when unset or inactive).
create or replace function public.hb_countersigner()
returns public.staff language sql stable security definer set search_path = public as $$
  select s.* from handbook_settings h
  join staff s on lower(s.email) = lower(h.countersigner_email) and s.active = true
  where h.id = 1 limit 1;
$$;

-- For RLS: is the caller the active countersigner?
create or replace function public.hb_is_countersigner()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(is_active_staff(), false)
     and exists (select 1 from handbook_settings h
                 join staff s on lower(s.email) = lower(h.countersigner_email) and s.active = true
                 where h.id = 1 and lower(s.email) = lower(auth.jwt() ->> 'email'));
$$;

create or replace function public.hb_link(p_slug text)
returns text language sql immutable set search_path = public as $$
  select '#/team/handbook?item=handbook:' || p_slug;
$$;

create or replace function public.hb_today()
returns date language sql stable set search_path = public as $$
  select (now() at time zone 'America/Chicago')::date;
$$;

-- One bookkeeper's state for one policy (null when the policy has no versions).
create or replace function public.hb_state(p_policy_id uuid, p_staff public.staff)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  r handbook_versions;
  g record;
  v_last int;
  v_due date;
begin
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
                    (coalesce(p_staff.created_at, r.published_at) at time zone 'America/Chicago')::date) + 7;
  return jsonb_build_object(
    'state', case when hb_today() > v_due then 'overdue' else 'not_signed' end,
    'required_version_no', r.version_no, 'due_date', v_due, 'overdue', hb_today() > v_due,
    'signature_id', null, 'version_no', null, 'signed_at', null, 'countersigned_at', null,
    'has_pdf', false, 'last_signed_version_no', v_last);
end $$;

-- Queue one email row (link only; never the policy text). If an older SQL
-- file re-ran and dropped the handbook kinds from the outbox check, warn and
-- skip the email instead of failing the sign or publish.
create or replace function public.hb_queue(p_kind text, p_to text, p_ref text, p_payload jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_to is null or btrim(p_to) = '' then return; end if;
  begin
    insert into notification_outbox (kind, recipient_email, client_id, ref_id, payload)
    values (p_kind, lower(btrim(p_to)), null, p_ref, coalesce(p_payload, '{}'::jsonb));
  exception when check_violation then
    raise warning 'hb_queue: % not queued (outbox kind check): %', p_kind, sqlerrm;
  end;
end $$;

-- Start the PDF export in the team-reviews edge function (the tr_kick
-- pattern: Vault cron key, pg_net). The machine path of team-reviews reads
-- body.job; action and signature_id are sent too.
create or replace function public.hb_kick(p_signature_id uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_key text;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'qbo_cron_key' limit 1;
  if v_key is null then
    raise warning 'hb_kick: qbo_cron_key missing from vault';
    return;
  end if;
  perform net.http_post(
    url := 'https://xumsqmhccgfjnlmieqyu.supabase.co/functions/v1/team-reviews',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := jsonb_build_object('job', 'export_handbook', 'action', 'export_handbook',
                               'signature_id', p_signature_id, 'id', p_signature_id, 'trigger', 'db'),
    timeout_milliseconds := 60000);
end $$;

-- ---------------------------------------------------------------------------
-- Write RPCs
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
  select * into v from handbook_versions where id = g.version_id;
  select * into p from handbook_policies where id = v.policy_id;
  perform audit_write('handbook.countersigned', null, 'handbook_signature', g.id::text,
    jsonb_build_object('policy', p.slug, 'version_no', v.version_no, 'staff_email', g.staff_email));
  perform hb_kick(g.id);
  return jsonb_build_object('signature_id', g.id, 'countersigned_at', v_at, 'state', 'signed', 'export_started', true);
end $$;

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
  v_resign := p_requires_resign or v_no = 1;
  v_sha := encode(sha256(convert_to(p_body_md, 'UTF8')), 'hex');
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

create or replace function public.hb_set_countersigner(p_email text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me staff := hb_require_staff();
  s staff;
  v_old text;
begin
  if me.role <> 'admin' or not coalesce(is_active_staff_admin(), false) then
    raise exception 'Only admins can change the countersigner.' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_email, '')), '') is not null then
    select * into s from staff where lower(email) = lower(btrim(p_email)) and active = true limit 1;
    if s.id is null then raise exception 'The countersigner must be an active staff member.'; end if;
  end if;
  insert into handbook_settings (id) values (1) on conflict (id) do nothing;
  select countersigner_email into v_old from handbook_settings where id = 1 for update;
  update handbook_settings set countersigner_email = case when s.id is null then null else s.email end,
                               updated_at = now(), updated_by = lower(me.email)
  where id = 1;
  perform audit_write('handbook.countersigner_changed', null, 'handbook_settings', '1',
    jsonb_build_object('from', v_old, 'to', case when s.id is null then null else lower(s.email) end));
  return jsonb_build_object('countersigner_email', case when s.id is null then null else lower(s.email) end,
                            'countersigner_name', s.name);
end $$;

-- Admin: start the PDF export again (Drive filing failed).
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
  perform hb_kick(g.id);
  return jsonb_build_object('signature_id', g.id, 'export_started', true);
end $$;

-- ---------------------------------------------------------------------------
-- Read RPCs
-- ---------------------------------------------------------------------------
-- One policy: the shown version's text (latest, or p_version_no), the
-- version history, the caller's status and own signatures.
create or replace function public.hb_get_policy(p_slug text, p_version_no int default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  me staff := hb_require_staff();
  is_admin boolean := me.role = 'admin';
  is_signer boolean := hb_is_signer(me.email);
  cs staff := hb_countersigner();
  p handbook_policies;
  v handbook_versions;
  r handbook_versions;
  l handbook_versions;
begin
  select * into p from handbook_policies where slug = p_slug;
  if p.id is null or (not p.active and not is_admin) then raise exception 'Policy not found.'; end if;
  select * into l from handbook_versions where policy_id = p.id order by version_no desc limit 1;
  select * into r from handbook_versions where policy_id = p.id and requires_resign order by version_no desc limit 1;
  if p_version_no is null then v := l;
  else select * into v from handbook_versions where policy_id = p.id and version_no = p_version_no;
  end if;
  if p_version_no is not null and v.id is null then raise exception 'Version not found.'; end if;
  return jsonb_build_object(
    'policy', jsonb_build_object('id', p.id, 'slug', p.slug, 'title', p.title, 'sort', p.sort, 'active', p.active),
    'version', case when v.id is null then null else jsonb_build_object(
      'id', v.id, 'version_no', v.version_no, 'body_md', v.body_md, 'body_sha256', v.body_sha256,
      'requires_resign', v.requires_resign, 'change_note', v.change_note,
      'published_at', v.published_at, 'published_by', v.published_by,
      'is_latest', v.id = l.id) end,
    'latest_version_id', l.id,
    'latest_version_no', l.version_no,
    'required_version_no', r.version_no,
    'required_published_at', r.published_at,
    'versions', coalesce((select jsonb_agg(jsonb_build_object(
        'id', x.id, 'version_no', x.version_no, 'requires_resign', x.requires_resign,
        'change_note', x.change_note, 'published_at', x.published_at, 'published_by', x.published_by,
        'body_sha256', x.body_sha256) order by x.version_no desc)
      from handbook_versions x where x.policy_id = p.id), '[]'::jsonb),
    'me', jsonb_build_object(
      'email', lower(me.email), 'name', me.name, 'is_admin', is_admin, 'is_signer', is_signer,
      'is_countersigner', cs.id is not null and lower(cs.email) = lower(me.email),
      'status', case when is_signer then hb_state(p.id, me) end,
      'signatures', coalesce((select jsonb_agg(jsonb_build_object(
          'id', s.id, 'version_no', x.version_no, 'signed_at', s.signed_at,
          'countersigned_at', s.countersigned_at, 'has_pdf', s.pdf_drive_file_id is not null) order by x.version_no desc)
        from handbook_signatures s join handbook_versions x on x.id = s.version_id
        where x.policy_id = p.id and s.staff_email = lower(me.email)), '[]'::jsonb)),
    'countersigner', case when cs.id is null then null
      else jsonb_build_object('email', lower(cs.email), 'name', cs.name) end);
end $$;

-- Everything the Handbook tab, Today and the badge need in one call.
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
    'pending_countersign_count', case when is_admin then
      (select count(*) from handbook_signatures where countersigned_at is null) end,
    'unfiled_count', case when is_admin then
      (select count(*) from handbook_signatures where countersigned_at is not null and pdf_drive_file_id is null) end);
end $$;

-- ---------------------------------------------------------------------------
-- Edge function helpers (service role only)
-- ---------------------------------------------------------------------------
-- Everything the PDF needs. Countersigned records only.
create or replace function public.hb_signature_doc(p_signature_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare g handbook_signatures; v handbook_versions; p handbook_policies;
begin
  select * into g from handbook_signatures where id = p_signature_id;
  if g.id is null or g.countersigned_at is null then return null; end if;
  select * into v from handbook_versions where id = g.version_id;
  select * into p from handbook_policies where id = v.policy_id;
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

-- File the PDF once (the guard trigger allows this update once, from null).
create or replace function public.hb_record_export(p_signature_id uuid, p_drive_file_id text, p_pdf_sha256 text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_pdf_sha256 is null or p_pdf_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'pdf_sha256 must be lower-case hex SHA-256'; end if;
  update handbook_signatures set pdf_drive_file_id = p_drive_file_id, pdf_sha256 = p_pdf_sha256
  where id = p_signature_id;
  if not found then raise exception 'Signature not found.'; end if;
  insert into audit_log (actor_email, action, target_type, target_id, details)
  values ('system', 'handbook.exported', 'handbook_signature', p_signature_id::text,
          jsonb_build_object('event', 'filed', 'drive_file_id', p_drive_file_id, 'pdf_sha256', p_pdf_sha256));
end $$;

-- Log a download of the signed PDF (actor = the signed-in downloader).
create or replace function public.hb_log_export(p_signature_id uuid, p_actor_email text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log (actor_email, action, target_type, target_id, details)
  values (coalesce(nullif(lower(btrim(p_actor_email)), ''), 'system'), 'handbook.exported', 'handbook_signature',
          p_signature_id::text, jsonb_build_object('event', 'download'));
end $$;

-- ---------------------------------------------------------------------------
-- Email kinds (Part F). Live lists as of 2026-10-13 + the two handbook kinds.
-- Any later file that redoes these checks must keep both handbook kinds.
-- ---------------------------------------------------------------------------
alter table public.notification_outbox drop constraint if exists notification_outbox_kind_check;
alter table public.notification_outbox add constraint notification_outbox_kind_check check (kind in (
    'staff_client_message', 'staff_doc_upload', 'staff_task_assigned', 'staff_feedback_status',
    'client_message', 'client_reports_ready', 'staff_tech_request',
    'handbook_sign_needed', 'handbook_countersign_needed',
    'staff_task_review_ready', 'staff_task_sent_back', 'staff_task_mention',
    'staff_task_client_answered', 'staff_task_batch'   -- full list: tasks-p2-3b-review-email-kinds.sql
));
alter table public.client_email_log drop constraint if exists client_email_log_feature_check;
alter table public.client_email_log add constraint client_email_log_feature_check check (feature in (
    'doc_chaser', 'value_report', 'staff_client_message', 'staff_doc_upload', 'staff_task_assigned',
    'staff_task_due', 'staff_feedback_status', 'client_message', 'client_reports_ready', 'staff_tech_request',
    'handbook_sign_needed', 'handbook_countersign_needed', 'gl_review_question', 'gl_review_summary',
    'staff_task_review_ready', 'staff_task_sent_back', 'staff_task_mention',
    'staff_task_client_answered', 'staff_task_batch',
    'client_request', 'client_request_nudge'   -- full list: tasks-p2-3b-review-email-kinds.sql
  ));

-- ---------------------------------------------------------------------------
-- RLS and grants
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['handbook_policies', 'handbook_versions', 'handbook_signatures', 'handbook_settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, public', t);
    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

drop policy if exists hb_policies_read on public.handbook_policies;
create policy hb_policies_read on public.handbook_policies for select to authenticated
  using (public.is_active_staff());

drop policy if exists hb_versions_read on public.handbook_versions;
create policy hb_versions_read on public.handbook_versions for select to authenticated
  using (public.is_active_staff());

drop policy if exists hb_settings_read on public.handbook_settings;
create policy hb_settings_read on public.handbook_settings for select to authenticated
  using (public.is_active_staff());

drop policy if exists hb_signatures_read on public.handbook_signatures;
create policy hb_signatures_read on public.handbook_signatures for select to authenticated
  using ((public.is_active_staff() and staff_email = lower(auth.jwt() ->> 'email'))
         or public.is_active_staff_admin()
         or public.hb_is_countersigner());

do $$
declare f text;
begin
  -- Internal: definer functions, triggers and the service role only.
  foreach f in array array[
    'hb_versions_immutable()', 'hb_no_truncate()', 'hb_signatures_guard()', 'hb_norm_name(text)',
    'hb_is_signer(text)', 'hb_ack(text)', 'hb_require_staff()', 'hb_countersigner()', 'hb_link(text)',
    'hb_today()', 'hb_state(uuid, public.staff)', 'hb_queue(text, text, text, jsonb)', 'hb_kick(uuid)',
    'hb_signature_doc(uuid)', 'hb_record_export(uuid, text, text)', 'hb_log_export(uuid, text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  execute 'grant execute on function public.hb_signature_doc(uuid), public.hb_record_export(uuid, text, text), '
          'public.hb_log_export(uuid, text) to service_role';
  -- Callable by signed-in users (each checks staff / admin / countersigner itself).
  foreach f in array array[
    'hb_is_countersigner()', 'hb_sign(uuid, text, boolean)', 'hb_countersign(uuid, text, boolean)',
    'hb_publish_version(uuid, text, boolean, text)', 'hb_set_countersigner(text)', 'hb_retry_export(uuid)',
    'hb_get_policy(text, integer)', 'hb_status()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Seed: policy 1, version 1 (Part G). Imported from the firm's SLA policy
-- document with the owner-approved wording changes (B10): emoji -> words,
-- section 6 numbered 1-3, signature lines dropped, Co-Pod Leader -> COO /
-- Account Manager, "pod/team" -> "team", the SLA table and the milestone
-- timeline written as lists (the PDF fonts are cp1252). Asana wording kept
-- until Tasks launches (B5). Inserted only once; versions are immutable.
-- ---------------------------------------------------------------------------
insert into public.handbook_policies (slug, title, sort)
values ('flexible-work-sla', 'Flexible Work, Scheduling & Operational SLA Policy', 10)
on conflict (slug) do nothing;

with b(body) as (select $hb_body$**Applies To:** All Full-Time & Part-Time Staff

**Effective Date:** {{effective_date}}

## 1. Policy Overview & Philosophy

Our firm operates on a culture of flexibility, autonomy, and work-life integration. We evaluate performance based on **results, accuracy, and on-time execution**—not physical time spent sitting at a desk.

However, flexibility requires structure, scheduling transparency, and mutual accountability to ensure:

1. Clients experience zero disruption or delay in service.
2. Team members and leadership always know when peers are available for collaboration.
3. Monthly accounting deadlines are met without exception.

## 2. Core Operating Principles

- **Weekly Calendarization of Hours:** All full-time employees must explicitly calendar 40 hours of work per week in Google Calendar. All part-time employees must calendar their agreed upon hours per week in Google Calendar.
- **Complete Calendar Visibility:** All company calendars must be shared internally with full event details visible so the team can see when peers are online vs. offline.
- **Client Continuity:** Clients must receive seamless, top-tier service during standard business hours regardless of an individual's custom schedule.
- **Asynchronous Visibility:** Systems (Asana, Google Meet) must reflect real-time task status so performance is measured by completed deliverables.

## 3. Weekly Calendarization Requirement

### A. Calendarization Protocol (Fridays by 5:00 PM)

Every employee must block out their hours **(40 working hours for full time)** in their company Google Calendar for the upcoming week no later than **Friday at 5:00 PM**.

### B. Calendar Category Blocks

Calendar events must be categorized clearly so the entire firm understands availability:

- **Available (green) / Live Focus Windows:** Dedicated time for live client calls, team check-ins, availability, and active work.
- **Offline (red) / Outside Commitment Windows:** Explicit blocks for personal appointments, morning business focus, or offline time where the employee is unavailable for firm tasks.
- **Async (blue) Production / Deep Work Windows:** Dedicated blocks (e.g., evening reconciliation/review sessions) where production work is being completed asynchronously.

### C. Full Time Staff Schedule Guidelines (With Outside Commitments)

For full time staff managing personal commitments in the morning:

1. The working hours must be explicitly mapped across the week (e.g., combining afternoon client/team windows, scheduled meeting blocks, and evening focus blocks).
2. Schedules **must maintain core overlap during peak business hours (e.g., 12:00 PM – 5:00 PM)** to handle client calls, lead bookkeeper syncs, and triage escalations.
3. The baseline schedule must be agreed upon with the CEO and updated if recurring shift patterns change.

## 4. Communication & Response Service Level Agreements (SLAs)

During an employee's designated working windows, the following response thresholds are mandatory:

- **Urgent Client Escalation**
  - **Target SLA Threshold:** Within **2 to 4 business hours**
  - **Operational Protocol:** Shared inbox/phone triage. If primary lead is in an offline block, the COO or Account Manager steps in.
- **Standard Client Inquiry**
  - **Target SLA Threshold:** Within **24 business hours**
  - **Operational Protocol:** Acknowledged and answered during the employee's primary daily online window.
- **Internal Team Asana**
  - **Target SLA Threshold:** Same-day response (by 5:00 PM)
  - **Operational Protocol:** Employees must check internal channels at minimum twice daily (start & end of primary work window).
- **Emergency Escalations**
  - **Target SLA Threshold:** Immediate notification
  - **Operational Protocol:** Emergency phone/SMS protocol enabled between the COO, Account Manager and CEO for critical issues.

## 5. Non-Negotiable Monthly Hard Deadlines

Flexibility applies to *when* hours are worked, but **never to completion deadlines**. All staff must hit the following recurring monthly milestones:

**Monthly Milestone Timeline**

- **4th of Month (by 5:00 PM):** Prior month data entered; statement/info requests sent to clients with due date by the 10th of the month.
- **14th of Month (by 5:00 PM):** Account reconciliations complete & report packages prepared. Monthly financial reports delivered to all clients. If we're still waiting on items to send completed reports, client document request follow-ups completed.
- **24th of Month (by 5:00 PM):** Mid-month bank feed & QBO connection check, check-in with client completed.

## 6. Visibility & Accountability System

To verify work completion without micromanagement, the firm uses three accountability checkpoints:

1. **Asana Real-Time Updates:**
  - All tasks must live in Asana and be marked complete as finished.
  - If any deliverable is at risk of missing a deadline, the employee must notify their supervisor **at least 24 hours prior** with an action plan.
2. **Daily Async Standup (By 1:00 PM Local Time):** Every full time employee posts a daily 3-bullet check-in:
  - *Completed yesterday / overnight*
  - *Top priorities today*
  - *Blockers or support needed*
3. **Weekly Sync Meetings:** Attendance at scheduled weekly team syncs is mandatory.

## 7. Peer Cross-Coverage & Handover Protocol

- **Shared Access:** COO and Account Manager maintain shared access to client email inboxes, QBO accounts, password vaults, and workflow dashboards.
- **Scheduled Time Off / Offline Handover:** Planned time off or extended unavailability during business hours must be submitted **48 hours in advance** in Google Chat with a brief handover note detailing active portfolio status.

### Employee Acknowledgment

I acknowledge that I have read, understood, and agree to abide by the Flexible Work, Scheduling & Operational SLA Policy. I agree to calendar my hours (40 weekly working hours for full time) in advance, adhere to response SLAs, and consistently meet all firm deadlines.
$hb_body$::text)
insert into public.handbook_versions (policy_id, version_no, body_md, body_sha256, requires_resign, change_note, published_by)
select p.id, 1, b.body, encode(sha256(convert_to(b.body, 'UTF8')), 'hex'), true,
       'Version 1, imported from the original policy document.', 'system'
from b join public.handbook_policies p on p.slug = 'flexible-work-sla'
on conflict (policy_id, version_no) do nothing;

commit;
