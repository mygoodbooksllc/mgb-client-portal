-- Staff Handbook, part 4: draft approval (spec docs/staff-handbook-spec.md
-- Part L). Run AFTER staff-handbook.sql, staff-handbook-2-admin.sql and
-- staff-handbook-3-kinds.sql. Safe to re-run. Flat file; every function pins
-- search_path = public. NOT applied to production yet.
--
-- ORDER: deploy the notification-emails edge function that knows the kind
-- handbook_approval_needed FIRST, then run this file, then (once) the seed
-- staff-handbook-4-seed-handbook-drafts.sql. Until the function is deployed
-- a queued approval notice would be marked "Unknown email kind" and dropped.
--
-- If staff-handbook.sql, -2-admin.sql or -3-kinds.sql is re-run, run this
-- file right after: they redefine hb_status, hb_get_policy, hb_publish_policy
-- and hb_convert_to_signed without the approval rules below. If any file that
-- restates the outbox kind checks in full is re-run (notification-emails.sql,
-- tasks-p2-3b-review-email-kinds.sql, ...), run this file again too, or the
-- approval notice is skipped (hb_queue only warns, nothing fails).
--
-- What changes
--   handbook_policies gets the approval state of a draft:
--     approval_status       'not_required' (policies published before this
--                           file, including the SLA), 'pending', 'approved'
--                           or 'changes_requested'. A draft published after
--                           approval keeps 'approved' as the record.
--                           Existing drafts become 'pending'; new drafts start
--                           'pending'.
--     approved_by / approved_at
--     approved_version_id / approved_sha256
--                           the exact text that was approved (version id and
--                           its body hash). Publishing needs both to match the
--                           latest version.
--     approval_note         the approver's note when asking for changes (kept
--                           after the next edit so the editor can see it).
--     approval_updated_at / approval_updated_by
--   handbook_settings.policy_approver_email: who approves drafts. Default
--     bailley@mygoodbooks.org. Changed only by hb_set_policy_approver (an
--     admin, audited). Must be an active admin to approve; while it isn't,
--     nothing can be approved, so nothing can be published.
--
--   Rules (triggers, so every path is covered):
--     * Approval columns only change inside the approval RPCs (transaction-
--       local setting mgb.hb_approval, which PostgREST can't set).
--     * A new draft (hb_create_policy, the seed) starts 'pending'.
--     * Any new version of a draft (Edit text = hb_publish_version on a
--       draft, Make this a signed policy on a draft) resets it to 'pending'.
--     * A title, section or kind change on a draft resets it to 'pending'.
--       The list order alone doesn't.
--     * A draft only goes live when it is 'approved' (backstop for
--       hb_publish_policy).
--     * Published policies are never touched: their edits go through Publish
--       new version, with no approval step.
--
--   Approver notice (one email per batch), hb_queue_approval_notice():
--     Called when a draft becomes 'pending' (created, edited after approval,
--     edited after changes were requested, details changed) and when the
--     approver changes. It queues ONE handbook_approval_needed row for the
--     approver, unless
--       - the approver isn't set or isn't an active admin,
--       - the person making the change is the approver (their own edit),
--       - an unsent handbook_approval_needed row for them already exists (that
--         email reads the live count when it goes out, so it covers this
--         draft too),
--     and it holds the new row until 30 minutes after the last one that was
--     sent (payload.not_before). So the approver gets at most one email per
--     30 minutes however many drafts are created or edited, and an edit to a
--     draft that is already waiting queues nothing. The email says how many
--     drafts wait and links to Team › Handbook; it never includes titles or
--     policy text.
--
--   Redefined
--     hb_status            per-policy approval for admins, the approver, the
--                          caller's is_approver, approvals_pending, and the
--                          approver's badge counts drafts waiting for them.
--     hb_get_policy        approval and approver for admins.
--     hb_publish_policy    refuses unless the latest version is approved and
--                          the approver is an active admin.
--     hb_convert_to_signed on a draft: refuses unless the latest version is
--                          approved; the converted draft then needs approval
--                          again (kind changed, new version).
--   New RPCs (each audited)
--     hb_approve_policy(policy_id, version_id)    approver only.
--                                                 handbook.policy_approved
--     hb_request_changes(policy_id, note)         approver only.
--                                                 handbook.policy_changes_requested
--     hb_set_policy_approver(email)               any admin.
--                                                 handbook.approver_changed
--   Resets are audited too: handbook.approval_reset.
--
-- Checks: supabase/staff-handbook-4-approvals-tests.sql (one transaction,
-- ends in ROLLBACK).

begin;

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------
alter table public.handbook_policies add column if not exists approval_status text not null default 'not_required';
alter table public.handbook_policies add column if not exists approved_by text;
alter table public.handbook_policies add column if not exists approved_at timestamptz;
alter table public.handbook_policies add column if not exists approved_version_id uuid
  references public.handbook_versions(id);
alter table public.handbook_policies add column if not exists approved_sha256 text;
alter table public.handbook_policies add column if not exists approval_note text;
alter table public.handbook_policies add column if not exists approval_updated_at timestamptz;
alter table public.handbook_policies add column if not exists approval_updated_by text;

alter table public.handbook_policies drop constraint if exists handbook_policies_approval_check;
alter table public.handbook_policies add constraint handbook_policies_approval_check
  check (approval_status in ('not_required', 'pending', 'approved', 'changes_requested'));
alter table public.handbook_policies drop constraint if exists handbook_policies_approved_check;
alter table public.handbook_policies add constraint handbook_policies_approved_check
  check (approval_status <> 'approved'
         or (approved_by is not null and approved_at is not null
             and approved_version_id is not null and approved_sha256 is not null));
alter table public.handbook_policies drop constraint if exists handbook_policies_approval_note_check;
alter table public.handbook_policies add constraint handbook_policies_approval_note_check
  check (approval_note is null or char_length(approval_note) <= 2000);

alter table public.handbook_settings add column if not exists policy_approver_email text
  default 'bailley@mygoodbooks.org';
update public.handbook_settings set policy_approver_email = 'bailley@mygoodbooks.org'
 where id = 1 and policy_approver_email is null;
alter table public.handbook_settings drop constraint if exists handbook_settings_approver_check;
alter table public.handbook_settings add constraint handbook_settings_approver_check
  check (policy_approver_email is null or policy_approver_email = lower(btrim(policy_approver_email)));

-- ---------------------------------------------------------------------------
-- Outbox kind: handbook_approval_needed. The two checks are extended in place
-- (their current values are read back), so kinds added by other files are
-- kept whatever order the files ran in.
-- ---------------------------------------------------------------------------
do $$
declare
  t record;
  v_def text;
  v_vals text[];
begin
  for t in select * from (values
      ('public.notification_outbox', 'notification_outbox_kind_check', 'kind'),
      ('public.client_email_log', 'client_email_log_feature_check', 'feature')) x(tbl, con, col) loop
    select pg_get_constraintdef(c.oid) into v_def from pg_constraint c
     where c.conrelid = t.tbl::regclass and c.conname = t.con;
    if v_def is null then
      raise notice 'handbook part 4: % has no % (nothing to extend)', t.tbl, t.con;
      continue;
    end if;
    select array_agg(distinct m[1] order by m[1]) into v_vals
      from regexp_matches(v_def, '''([a-z0-9_]+)''', 'g') m;
    if v_vals is null or cardinality(v_vals) < 2 then
      raise exception 'handbook part 4: could not read the values of % (%). Nothing changed.', t.con, v_def;
    end if;
    if 'handbook_approval_needed' = any (v_vals) then continue; end if;
    v_vals := array_append(v_vals, 'handbook_approval_needed'::text);
    execute format('alter table %s drop constraint %I', t.tbl, t.con);
    execute format('alter table %s add constraint %I check (%I in (%s))', t.tbl, t.con, t.col,
                   (select string_agg(quote_literal(x), ', ' order by x) from unnest(v_vals) x));
  end loop;
end $$;

-- Lookups for the batching rule.
create index if not exists notification_outbox_hb_approval_idx
  on public.notification_outbox (recipient_email, processed_at)
  where kind = 'handbook_approval_needed';

-- Backfill: drafts wait for approval; everything else is not required.
-- (mgb.hb_approval lets the rule trigger below accept the change on re-runs.)
select set_config('mgb.hb_approval', 'on', true);
update public.handbook_policies
   set approval_status = 'pending', approval_updated_at = now()
 where status = 'draft' and approval_status = 'not_required';
update public.handbook_policies
   set approval_status = 'not_required'
 where status = 'published' and approval_status in ('pending', 'changes_requested');
select set_config('mgb.hb_approval', '', true);

alter table public.handbook_policies alter column approval_status set default 'pending';

-- ---------------------------------------------------------------------------
-- Helpers (internal)
-- ---------------------------------------------------------------------------
-- The approver's staff row when the setting names an active admin; else null.
create or replace function public.hb_approver()
returns public.staff language sql stable security definer set search_path = public as $$
  select s.* from handbook_settings h
  join staff s on lower(s.email) = lower(h.policy_approver_email) and s.active = true and s.role = 'admin'
  where h.id = 1 limit 1;
$$;

-- Active drafts waiting for the approver (with at least one version).
create or replace function public.hb_pending_approvals()
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from handbook_policies p
  where p.status = 'draft' and p.active and p.approval_status = 'pending'
    and exists (select 1 from handbook_versions v where v.policy_id = p.id);
$$;

-- Why this draft can't go live yet (null when it can). Used by publish and
-- by Make this a signed policy on a draft.
create or replace function public.hb_approval_problem(p public.handbook_policies)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  a staff := hb_approver();
  v_set text;
  l handbook_versions;
  who text;
begin
  select policy_approver_email into v_set from handbook_settings where id = 1;
  if a.id is null then
    return 'Nobody can approve handbook drafts right now: the policy approver ('
           || coalesce(v_set, 'not set')
           || ') is not an active admin. An admin can choose a new approver in Team › Handbook.';
  end if;
  who := coalesce(nullif(split_part(btrim(coalesce(a.name, '')), ' ', 1), ''), a.email);
  select * into l from handbook_versions where policy_id = p.id order by version_no desc limit 1;
  if l.id is null then return 'This policy has no text yet.'; end if;
  if p.approval_status = 'changes_requested' then
    return who || ' asked for changes to this draft. Edit it, then it goes back to ' || who || ' for approval.';
  end if;
  if p.approval_status <> 'approved' then
    return who || ' hasn''t approved this draft yet. It can be published once it''s approved.';
  end if;
  if p.approved_version_id is distinct from l.id or p.approved_sha256 is distinct from l.body_sha256 then
    return 'The text changed after ' || who || ' approved it. It needs approval again before it can be published.';
  end if;
  return null;
end $$;

-- One batched approver notice (see the header for the rule). Returns true
-- when a row was queued.
create or replace function public.hb_queue_approval_notice()
returns boolean language plpgsql security definer set search_path = public as $$
declare
  a staff := hb_approver();
  v_to text;
  v_actor text := lower(coalesce(nullif(auth.jwt() ->> 'email', ''), ''));
  v_last timestamptz;
  v_nb timestamptz;
begin
  if a.id is null then return false; end if;
  v_to := lower(a.email);
  if v_actor = v_to then return false; end if;          -- their own edit: they already know
  -- One queuer at a time, so two saves in parallel can't both add a row.
  perform pg_advisory_xact_lock(hashtext('hb_queue_approval_notice'));
  if exists (select 1 from notification_outbox
             where kind = 'handbook_approval_needed' and recipient_email = v_to and processed_at is null) then
    return false;                                       -- the unsent one covers this change
  end if;
  select max(processed_at) into v_last from notification_outbox
   where kind = 'handbook_approval_needed' and recipient_email = v_to and status = 'sent';
  v_nb := greatest(now(), coalesce(v_last + interval '30 minutes', now()));
  perform hb_queue('handbook_approval_needed', v_to, 'approvals', jsonb_build_object(
    'not_before', v_nb, 'link', '#/team/handbook?item=handbook:approvals'));
  return exists (select 1 from notification_outbox
                 where kind = 'handbook_approval_needed' and recipient_email = v_to and processed_at is null);
end $$;

-- ---------------------------------------------------------------------------
-- Rule triggers
-- ---------------------------------------------------------------------------
create or replace function public.hb_policies_approval_rule()
returns trigger language plpgsql set search_path = public as $$
declare
  v_ok boolean := coalesce(current_setting('mgb.hb_approval', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    new.approval_status := case when new.status = 'draft' then 'pending' else 'not_required' end;
    new.approved_by := null;
    new.approved_at := null;
    new.approved_version_id := null;
    new.approved_sha256 := null;
    new.approval_note := null;
    new.approval_updated_at := now();
    new.approval_updated_by := null;
    return new;
  end if;

  if not v_ok and (new.approval_status, new.approved_by, new.approved_at, new.approved_version_id,
                   new.approved_sha256, new.approval_note)
                  is distinct from
                  (old.approval_status, old.approved_by, old.approved_at, old.approved_version_id,
                   old.approved_sha256, old.approval_note) then
    raise exception 'Handbook approval only changes through Approve or Request changes.' using errcode = '42501';
  end if;

  -- A draft whose title, section or kind changed needs approval again.
  if old.status = 'draft' and new.status = 'draft' and not v_ok
     and old.approval_status <> 'pending'
     and (new.title is distinct from old.title or new.section is distinct from old.section
          or new.kind is distinct from old.kind) then
    new.approval_status := 'pending';
    new.approved_by := null;
    new.approved_at := null;
    new.approved_version_id := null;
    new.approved_sha256 := null;
    new.approval_updated_at := now();
    new.approval_updated_by := lower(nullif(auth.jwt() ->> 'email', ''));
    perform audit_write('handbook.approval_reset', null, 'handbook_policy', new.id::text,
      jsonb_build_object('policy', new.slug, 'from', old.approval_status,
                         'reason', case when new.kind is distinct from old.kind then 'kind_changed' else 'details_changed' end));
  end if;

  -- Backstop: a draft only goes live once approved.
  if old.status = 'draft' and new.status = 'published' and new.approval_status <> 'approved' then
    raise exception 'This draft needs approval before it can be published.' using errcode = '55000';
  end if;
  return new;
end $$;

drop trigger if exists hb_policies_approval_rule on public.handbook_policies;
create trigger hb_policies_approval_rule before insert or update on public.handbook_policies
  for each row execute function public.hb_policies_approval_rule();

-- After a draft becomes pending (created, or reset): the batched notice.
create or replace function public.hb_policies_approval_notify()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status = 'draft' and new.active and new.approval_status = 'pending'
     and (tg_op = 'INSERT' or old.approval_status is distinct from 'pending') then
    perform hb_queue_approval_notice();
  end if;
  return null;
end $$;

drop trigger if exists hb_policies_approval_notify on public.handbook_policies;
create trigger hb_policies_approval_notify after insert or update on public.handbook_policies
  for each row execute function public.hb_policies_approval_notify();

-- Any new version of a draft (Edit text, convert) resets its approval.
create or replace function public.hb_versions_approval_reset()
returns trigger language plpgsql set search_path = public as $$
declare p handbook_policies;
begin
  select * into p from handbook_policies where id = new.policy_id;
  if p.id is null or p.status <> 'draft' or p.approval_status = 'pending' then return null; end if;
  perform set_config('mgb.hb_approval', 'on', true);
  update handbook_policies
     set approval_status = 'pending', approved_by = null, approved_at = null,
         approved_version_id = null, approved_sha256 = null,
         approval_updated_at = now(), approval_updated_by = lower(nullif(auth.jwt() ->> 'email', ''))
   where id = p.id;
  perform set_config('mgb.hb_approval', '', true);
  perform audit_write('handbook.approval_reset', null, 'handbook_policy', p.id::text,
    jsonb_build_object('policy', p.slug, 'from', p.approval_status, 'reason', 'text_changed',
                       'version_no', new.version_no));
  return null;
end $$;

drop trigger if exists hb_versions_approval_reset on public.handbook_versions;
create trigger hb_versions_approval_reset after insert on public.handbook_versions
  for each row execute function public.hb_versions_approval_reset();

-- ---------------------------------------------------------------------------
-- hb_status (as in staff-handbook-3-kinds.sql, plus approval)
-- ---------------------------------------------------------------------------
create or replace function public.hb_status()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  me staff := hb_require_staff();
  is_admin boolean := me.role = 'admin';
  sees_drafts boolean := me.role = 'admin' and coalesce(is_active_staff_admin(), false);
  is_signer boolean := hb_is_signer(me.email);
  cs staff := hb_countersigner();
  ap staff := hb_approver();
  is_cs boolean;
  is_ap boolean;
  v_set text;
  v_ap_set text;
  v_policies jsonb;
  v_queue jsonb := '[]'::jsonb;
  v_grid jsonb;
  v_unfiled jsonb;
  v_badge int := 0;
  v_pending int := 0;
begin
  is_cs := cs.id is not null and lower(cs.email) = lower(me.email);
  is_ap := sees_drafts and ap.id is not null and lower(ap.email) = lower(me.email);
  select countersigner_email, policy_approver_email into v_set, v_ap_set from handbook_settings where id = 1;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'slug', p.slug, 'title', p.title, 'sort', p.sort,
      'kind', p.kind, 'status', p.status, 'section', p.section, 'published_at', p.published_at,
      'latest_version_id', l.id, 'latest_version_no', l.version_no,
      'required_version_no', r.version_no, 'required_published_at', r.published_at,
      'my', case when is_signer and p.kind = 'signed' and p.status = 'published' then hb_state(p.id, me) end)
      || case when sees_drafts and p.status = 'draft' then jsonb_build_object(
           'approval_status', p.approval_status, 'approved_by', p.approved_by, 'approved_at', p.approved_at,
           'approved_version_no', av.version_no,
           'approval_current', p.approval_status = 'approved' and p.approved_version_id = l.id
                               and p.approved_sha256 = l.body_sha256,
           'approval_note', p.approval_note, 'approval_updated_at', p.approval_updated_at)
         else '{}'::jsonb end
      order by p.sort, p.title), '[]'::jsonb)
    into v_policies
  from handbook_policies p
  left join lateral (select id, version_no, body_sha256 from handbook_versions where policy_id = p.id
                     order by version_no desc limit 1) l on true
  left join lateral (select version_no, published_at from handbook_versions where policy_id = p.id and requires_resign
                     order by version_no desc limit 1) r on true
  left join handbook_versions av on av.id = p.approved_version_id
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
  if sees_drafts then
    v_pending := hb_pending_approvals();
  end if;
  if is_ap then
    v_badge := v_badge + v_pending;
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
                             'is_signer', is_signer, 'is_countersigner', is_cs, 'is_approver', is_ap),
    'countersigner', case when cs.id is null then null
      else jsonb_build_object('email', lower(cs.email), 'name', cs.name) end,
    'countersigner_missing', cs.id is null,
    'countersigner_setting', case when is_admin then v_set end,
    'approver', case when not sees_drafts or ap.id is null then null
      else jsonb_build_object('email', lower(ap.email), 'name', ap.name) end,
    'approver_missing', case when sees_drafts then ap.id is null end,
    'approver_setting', case when sees_drafts then v_ap_set end,
    'approvals_pending', case when sees_drafts then v_pending end,
    'policies', v_policies,
    'to_countersign', v_queue,
    'badge', v_badge,
    'bookkeepers', case when is_admin then coalesce((select jsonb_agg(jsonb_build_object('email', lower(email), 'name', name) order by name)
                                                     from staff where role = 'bookkeeper' and active = true), '[]'::jsonb) end,
    'admins', case when sees_drafts then coalesce((select jsonb_agg(jsonb_build_object('email', lower(email), 'name', name) order by name)
                                                   from staff where role = 'admin' and active = true), '[]'::jsonb) end,
    'grid', case when is_admin then v_grid end,
    'unfiled', case when is_admin then v_unfiled end,
    'pending_countersign_count', case when is_admin then
      (select count(*) from handbook_signatures where countersigned_at is null) end,
    'unfiled_count', case when is_admin then
      (select count(*) from handbook_signatures where countersigned_at is not null and pdf_drive_file_id is null) end);
end $$;

-- ---------------------------------------------------------------------------
-- hb_get_policy (as in staff-handbook-3-kinds.sql, plus approval for admins)
-- ---------------------------------------------------------------------------
create or replace function public.hb_get_policy(p_slug text, p_version_no int default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  me staff := hb_require_staff();
  is_admin boolean := me.role = 'admin';
  sees_drafts boolean := me.role = 'admin' and coalesce(is_active_staff_admin(), false);
  is_signer boolean := hb_is_signer(me.email);
  cs staff := hb_countersigner();
  ap staff := hb_approver();
  p handbook_policies;
  v handbook_versions;
  r handbook_versions;
  l handbook_versions;
  av handbook_versions;
  signs boolean;
  v_ap_set text;
begin
  select * into p from handbook_policies where slug = p_slug;
  if p.id is null or (not p.active and not is_admin) or (p.status <> 'published' and not sees_drafts) then
    raise exception 'Policy not found.';
  end if;
  signs := p.kind = 'signed' and p.status = 'published';
  select * into l from handbook_versions where policy_id = p.id order by version_no desc limit 1;
  select * into r from handbook_versions where policy_id = p.id and requires_resign order by version_no desc limit 1;
  if p.approved_version_id is not null then
    select * into av from handbook_versions where id = p.approved_version_id;
  end if;
  select policy_approver_email into v_ap_set from handbook_settings where id = 1;
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
    'approval', case when sees_drafts and p.status = 'draft' then jsonb_build_object(
      'status', p.approval_status, 'approved_by', p.approved_by,
      'approved_by_name', (select name from staff where lower(email) = lower(p.approved_by) limit 1),
      'approved_at', p.approved_at, 'approved_version_id', p.approved_version_id,
      'approved_version_no', av.version_no, 'approved_sha256', p.approved_sha256,
      'current', p.approval_status = 'approved' and p.approved_version_id = l.id and p.approved_sha256 = l.body_sha256,
      'note', p.approval_note, 'updated_at', p.approval_updated_at, 'updated_by', p.approval_updated_by,
      'problem', hb_approval_problem(p)) end,
    'approver', case when not sees_drafts or ap.id is null then null
      else jsonb_build_object('email', lower(ap.email), 'name', ap.name) end,
    'approver_missing', case when sees_drafts then ap.id is null end,
    'approver_setting', case when sees_drafts then v_ap_set end,
    'me', jsonb_build_object(
      'email', lower(me.email), 'name', me.name, 'is_admin', is_admin, 'is_signer', is_signer,
      'is_countersigner', cs.id is not null and lower(cs.email) = lower(me.email),
      'is_approver', sees_drafts and ap.id is not null and lower(ap.email) = lower(me.email),
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
-- hb_publish_policy: as in staff-handbook-3-kinds.sql, but only an approved
-- draft (the exact latest text) goes live.
-- ---------------------------------------------------------------------------
create or replace function public.hb_publish_policy(p_policy_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me staff := hb_require_admin();
  p handbook_policies;
  r handbook_versions;
  b staff;
  n int := 0;
  v_at timestamptz := now();
  v_problem text;
begin
  select * into p from handbook_policies where id = p_policy_id for update;
  if p.id is null then raise exception 'Policy not found.'; end if;
  if p.status = 'published' then raise exception 'This policy is already published.'; end if;
  if not exists (select 1 from handbook_versions where policy_id = p.id) then
    raise exception 'This policy has no text yet.';
  end if;
  v_problem := hb_approval_problem(p);
  if v_problem is not null then
    raise exception '%', v_problem using errcode = '55000';
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
    jsonb_build_object('policy', p.slug, 'kind', p.kind, 'notified', n,
                       'approved_by', p.approved_by, 'approved_sha256', p.approved_sha256));
  return jsonb_build_object('policy_id', p.id, 'slug', p.slug, 'kind', p.kind, 'status', 'published',
                            'published_at', v_at, 'notified', n);
end $$;

-- ---------------------------------------------------------------------------
-- hb_convert_to_signed: as in staff-handbook-3-kinds.sql; on a draft it
-- needs the current text approved first (the conversion then makes a new
-- version, so the draft goes back to the approver before it's published).
-- ---------------------------------------------------------------------------
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
  v_problem text;
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
  if p.status = 'draft' then
    v_problem := hb_approval_problem(p);
    if v_problem is not null then
      raise exception '%', v_problem using errcode = '55000';
    end if;
  end if;
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
-- Approval RPCs
-- ---------------------------------------------------------------------------
-- The caller must be the approver (an active admin named in the setting).
create or replace function public.hb_require_approver()
returns public.staff language plpgsql stable security definer set search_path = public as $$
declare
  me staff := hb_require_admin();
  v_set text;
begin
  select lower(policy_approver_email) into v_set from handbook_settings where id = 1;
  if v_set is null or lower(me.email) <> v_set then
    raise exception 'Only the policy approver (%) can approve handbook drafts.', coalesce(v_set, 'not set')
      using errcode = '42501';
  end if;
  return me;
end $$;

-- Approve the exact latest text of a draft. p_version_id is the version the
-- approver read; if the draft changed since, nothing is approved.
create or replace function public.hb_approve_policy(p_policy_id uuid, p_version_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me staff := hb_require_approver();
  p handbook_policies;
  l handbook_versions;
  v_at timestamptz := now();
begin
  select * into p from handbook_policies where id = p_policy_id for update;
  if p.id is null or not p.active then raise exception 'Policy not found.'; end if;
  if p.status <> 'draft' then raise exception 'Only drafts need approval. This policy is already published.'; end if;
  select * into l from handbook_versions where policy_id = p.id order by version_no desc limit 1;
  if l.id is null then raise exception 'This draft has no text yet.'; end if;
  if p_version_id is null or p_version_id <> l.id then
    raise exception 'The draft changed since you opened it. Reload and review the latest text (version %).', l.version_no
      using errcode = '55000';
  end if;
  if p.approval_status = 'approved' and p.approved_version_id = l.id then
    raise exception 'You already approved version % of this draft.', l.version_no using errcode = '55000';
  end if;
  perform set_config('mgb.hb_approval', 'on', true);
  update handbook_policies
     set approval_status = 'approved', approved_by = lower(me.email), approved_at = v_at,
         approved_version_id = l.id, approved_sha256 = l.body_sha256, approval_note = null,
         approval_updated_at = v_at, approval_updated_by = lower(me.email)
   where id = p.id;
  perform set_config('mgb.hb_approval', '', true);
  perform audit_write('handbook.policy_approved', null, 'handbook_policy', p.id::text,
    jsonb_build_object('policy', p.slug, 'title', left(p.title, 200), 'version_no', l.version_no,
                       'version_id', l.id, 'body_sha256', l.body_sha256));
  return jsonb_build_object('policy_id', p.id, 'approval_status', 'approved', 'approved_by', lower(me.email),
                            'approved_at', v_at, 'approved_version_id', l.id, 'approved_version_no', l.version_no,
                            'pending', hb_pending_approvals());
end $$;

-- Send a draft back with a note. Nobody is emailed; the note shows on the
-- draft for whoever edits it next.
create or replace function public.hb_request_changes(p_policy_id uuid, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me staff := hb_require_approver();
  p handbook_policies;
  v_note text := btrim(coalesce(p_note, ''));
  v_at timestamptz := now();
begin
  if char_length(v_note) not between 1 and 2000 then
    raise exception 'Say what needs to change (up to 2000 characters).';
  end if;
  select * into p from handbook_policies where id = p_policy_id for update;
  if p.id is null or not p.active then raise exception 'Policy not found.'; end if;
  if p.status <> 'draft' then raise exception 'Only drafts need approval. This policy is already published.'; end if;
  perform set_config('mgb.hb_approval', 'on', true);
  update handbook_policies
     set approval_status = 'changes_requested', approved_by = null, approved_at = null,
         approved_version_id = null, approved_sha256 = null, approval_note = v_note,
         approval_updated_at = v_at, approval_updated_by = lower(me.email)
   where id = p.id;
  perform set_config('mgb.hb_approval', '', true);
  perform audit_write('handbook.policy_changes_requested', null, 'handbook_policy', p.id::text,
    jsonb_build_object('policy', p.slug, 'title', left(p.title, 200), 'from', p.approval_status,
                       'note', left(v_note, 500)));
  return jsonb_build_object('policy_id', p.id, 'approval_status', 'changes_requested', 'note', v_note,
                            'pending', hb_pending_approvals());
end $$;

-- Choose who approves drafts (any admin). Must be an active admin; the
-- setting can't be cleared. Earlier approvals stay valid. If drafts are
-- waiting, the new approver gets the batched notice.
create or replace function public.hb_set_policy_approver(p_email text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me staff := hb_require_admin();
  s staff;
  v_old text;
begin
  select * into s from staff
   where lower(email) = lower(btrim(coalesce(p_email, ''))) and active = true and role = 'admin' limit 1;
  if s.id is null then raise exception 'The policy approver must be an active admin.'; end if;
  insert into handbook_settings (id) values (1) on conflict (id) do nothing;
  select policy_approver_email into v_old from handbook_settings where id = 1 for update;
  if lower(coalesce(v_old, '')) = lower(s.email) then
    return jsonb_build_object('policy_approver_email', lower(s.email), 'name', s.name, 'changed', false);
  end if;
  update handbook_settings set policy_approver_email = lower(s.email), updated_at = now(), updated_by = lower(me.email)
   where id = 1;
  perform audit_write('handbook.approver_changed', null, 'handbook_settings', '1',
    jsonb_build_object('from', v_old, 'to', lower(s.email)));
  if hb_pending_approvals() > 0 then
    perform hb_queue_approval_notice();
  end if;
  return jsonb_build_object('policy_approver_email', lower(s.email), 'name', s.name, 'changed', true);
end $$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'hb_approver()', 'hb_pending_approvals()', 'hb_approval_problem(public.handbook_policies)',
    'hb_queue_approval_notice()', 'hb_policies_approval_rule()', 'hb_policies_approval_notify()',
    'hb_versions_approval_reset()', 'hb_require_approver()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'hb_status()', 'hb_get_policy(text, integer)', 'hb_publish_policy(uuid)',
    'hb_convert_to_signed(uuid, text, text, boolean)',
    'hb_approve_policy(uuid, uuid)', 'hb_request_changes(uuid, text)', 'hb_set_policy_approver(text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

commit;
