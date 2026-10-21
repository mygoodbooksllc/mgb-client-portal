-- Staff Handbook, part 5: approver tweaks (spec docs/staff-handbook-spec.md
-- Part L, "Approver tweaks"). Run AFTER staff-handbook-4-approvals.sql. Safe
-- to re-run. Flat file; every function pins search_path = public.
--
-- Applied to production 2026-10-20 (migration staff_handbook_5_approver_tweaks).
--
-- ORDER: deploy the notification-emails edge function that knows the kind
-- handbook_changes_requested FIRST, then run this file, then push the front
-- end. Until the function is deployed a queued row would be marked "Unknown
-- email kind" and dropped. Until this file runs, the new front end can't
-- read hb_approver_access and shows no Change button (safe).
--
-- If staff-handbook-4-approvals.sql is re-run, run this file right after: it
-- redefines hb_approval_problem, hb_request_changes and hb_set_policy_approver
-- without the rules below. If any file that restates the outbox kind checks
-- in full is re-run, run this file again too, or the changes-requested email
-- is skipped (hb_queue only warns, nothing fails).
--
-- What changes
--   1. Who can change the policy approver.
--      handbook_settings.approver_changers (text[], lower-case emails, not
--      null, default '{}'): the only people who can run
--      hb_set_policy_approver. They must also be active admins at the time.
--      Seeded ONCE, on the first run (while the new column is still unset),
--      from the HR records: active admins whose job title is Co-CEO (on
--      2026-10-20 that is bailley@ and jeff@mygoodbooks.org). The run prints
--      the seeded list. After that it is a fixed setting: editing a job title
--      in HR changes nothing, so another admin can't give themselves the
--      right. Changing the list is a SQL change by the owner (no RPC). An
--      empty list, or one with no active admins, means nobody can change the
--      approver (safe by default). Other admins still see who the approver
--      is.
--      New: hb_approver_access() for admins: can_change and the names of the
--      people who can (for the note under the approver line).
--      Redefined: hb_set_policy_approver (refuses anyone not on the list,
--      42501; audited as before), hb_approval_problem (names who can pick a
--      new approver instead of "an admin").
--      Self-approval rules are unchanged.
--   2. Request changes emails the person who last edited the draft.
--      hb_request_changes queues ONE handbook_changes_requested row (no
--      batching) for hb_last_editor(policy): whoever made the latest edit,
--      either the latest version (Edit text, create, convert: published_by)
--      or a later title or section change (audit handbook.policy_updated).
--      No row when that person is the approver (their own edit), isn't an
--      active admin (for example 'system' for the seeded chapters), or can't
--      be found. Payload: policy id, slug and title, the note, who asked and
--      a link to the draft. Settings key notify.email.handbook_changes. The
--      result says who is emailed (emailed_to, emailed_name) and the audit
--      row records it (details.emailed).
--
-- Checks: supabase/staff-handbook-5-approver-tweaks-tests.sql (one
-- transaction, ends in ROLLBACK).

begin;

-- ---------------------------------------------------------------------------
-- 1. Who can change the approver
-- ---------------------------------------------------------------------------
alter table public.handbook_settings add column if not exists approver_changers text[];

-- Seed once from HR: active admins whose job title is Co-CEO. A re-run never
-- re-reads the titles (the column is not null after the first run).
insert into public.handbook_settings (id) values (1) on conflict (id) do nothing;
update public.handbook_settings h
   set approver_changers = coalesce((
         select array_agg(distinct lower(s.email) order by lower(s.email))
           from public.staff s
           join public.staff_hr_records r on r.staff_email = lower(s.email)
          where s.active = true and s.role = 'admin'
            and lower(btrim(coalesce(r.job_title, ''))) = 'co-ceo'
            and (r.end_date is null or r.end_date > (now() at time zone 'America/Chicago')::date)),
         '{}'::text[])
 where h.id = 1 and h.approver_changers is null;

update public.handbook_settings set approver_changers = '{}'::text[] where approver_changers is null;
alter table public.handbook_settings alter column approver_changers set default '{}'::text[];
alter table public.handbook_settings alter column approver_changers set not null;

do $$
declare v text[] := (select approver_changers from public.handbook_settings where id = 1);
begin
  if cardinality(v) = 0 then
    raise warning 'handbook part 5: approver_changers is empty, so nobody can change the policy approver. Set it with SQL.';
  else
    raise notice 'handbook part 5: approver_changers = %', array_to_string(v, ', ');
  end if;
end $$;

-- The list: lower-case trimmed emails, no blanks, nulls or repeats, at most 10.
create or replace function public.hb_changers_ok(p text[])
returns boolean language sql immutable set search_path = public as $$
  select p is not null and cardinality(p) <= 10
     and not exists (select 1 from unnest(p) e where e is null or e = '' or e <> lower(btrim(e)))
     and (select count(*) = count(distinct e) from unnest(p) e);
$$;

alter table public.handbook_settings drop constraint if exists handbook_settings_changers_check;
alter table public.handbook_settings add constraint handbook_settings_changers_check
  check (public.hb_changers_ok(approver_changers));

-- The people on the list who are active admins, by name.
create or replace function public.hb_approver_changers()
returns setof public.staff language sql stable security definer set search_path = public as $$
  select s.* from handbook_settings h
  cross join lateral unnest(h.approver_changers) as c(email)
  join staff s on lower(s.email) = lower(btrim(c.email)) and s.active = true and s.role = 'admin'
  where h.id = 1
  order by s.name, s.email;
$$;

-- True when this email may change the approver (on the list and an active
-- admin). False for null, unknown or anyone else.
create or replace function public.hb_can_change_approver(p_email text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(p_email, '') <> ''
     and exists (select 1 from hb_approver_changers() c where lower(c.email) = lower(btrim(p_email)));
$$;

-- "Bailley or Jeff" (first names), or null when nobody can.
create or replace function public.hb_approver_changers_label()
returns text language sql stable security definer set search_path = public as $$
  with n as (
    select coalesce(nullif(split_part(btrim(coalesce(c.name, '')), ' ', 1), ''), lower(c.email)) as first,
           row_number() over (order by c.name, c.email) as i,
           count(*) over () as k
      from hb_approver_changers() c)
  select case when max(k) is null then null
              when max(k) = 1 then max(first)
              else string_agg(first, ', ' order by i) filter (where i < k) || ' or ' || max(first) filter (where i = k)
         end
    from n;
$$;

-- For admins: can the caller change the approver, and who can.
create or replace function public.hb_approver_access()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  me staff := hb_require_admin();
begin
  return jsonb_build_object(
    'can_change', hb_can_change_approver(me.email),
    'changers', coalesce((select jsonb_agg(jsonb_build_object('email', lower(c.email), 'name', c.name))
                            from hb_approver_changers() c), '[]'::jsonb),
    'label', hb_approver_changers_label());
end $$;

-- hb_approval_problem: as in staff-handbook-4-approvals.sql; the missing-
-- approver text names who can choose a new one.
create or replace function public.hb_approval_problem(p public.handbook_policies)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  a staff := hb_approver();
  v_set text;
  l handbook_versions;
  who text;
  v_fix text := hb_approver_changers_label();
begin
  select policy_approver_email into v_set from handbook_settings where id = 1;
  if a.id is null then
    return 'Nobody can approve handbook drafts right now: the policy approver ('
           || coalesce(v_set, 'not set')
           || ') is not an active admin. '
           || case when v_fix is null then 'Nobody is set up to choose a new approver, so ask the owner to fix the setting.'
                   else v_fix || ' can choose a new approver in HR › Handbook.' end;
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

-- hb_set_policy_approver: as in staff-handbook-4-approvals.sql, but only the
-- people on approver_changers (active admins) can run it.
create or replace function public.hb_set_policy_approver(p_email text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me staff := hb_require_admin();
  s staff;
  v_old text;
  v_fix text;
begin
  if not hb_can_change_approver(me.email) then
    v_fix := hb_approver_changers_label();
    raise exception '%', case when v_fix is null then 'Nobody is set up to change the policy approver.'
                              else 'Only ' || v_fix || ' can change the policy approver.' end
      using errcode = '42501';
  end if;
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
-- 2. Request changes emails the last editor
-- ---------------------------------------------------------------------------
-- Outbox kind: handbook_changes_requested. The two checks are extended in
-- place (their current values are read back), as in part 4.
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
      raise notice 'handbook part 5: % has no % (nothing to extend)', t.tbl, t.con;
      continue;
    end if;
    select array_agg(distinct m[1] order by m[1]) into v_vals
      from regexp_matches(v_def, '''([a-z0-9_]+)''', 'g') m;
    if v_vals is null or cardinality(v_vals) < 2 then
      raise exception 'handbook part 5: could not read the values of % (%). Nothing changed.', t.con, v_def;
    end if;
    if 'handbook_changes_requested' = any (v_vals) then continue; end if;
    v_vals := array_append(v_vals, 'handbook_changes_requested'::text);
    execute format('alter table %s drop constraint %I', t.tbl, t.con);
    execute format('alter table %s add constraint %I check (%I in (%s))', t.tbl, t.con, t.col,
                   (select string_agg(quote_literal(x), ', ' order by x) from unnest(v_vals) x));
  end loop;
end $$;

-- Who made the latest edit to a policy: the latest version's author, or a
-- later title or section change (audit handbook.policy_updated). Lower case;
-- may be 'system' (the seed). On a tie in time the version wins, then the
-- higher version number (or the later audit row).
create or replace function public.hb_last_editor(p_policy_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select e from (
    select lower(nullif(btrim(v.published_by), '')) as e, v.published_at as t, 1 as o, v.version_no::bigint as n
      from handbook_versions v
     where v.policy_id = p_policy_id
    union all
    select lower(nullif(btrim(a.actor_email), '')), a.at, 0, a.id
      from audit_log a
     where a.action = 'handbook.policy_updated' and a.target_type = 'handbook_policy'
       and a.target_id = p_policy_id::text
       and (jsonb_typeof(a.details -> 'title') = 'array' or jsonb_typeof(a.details -> 'section') = 'array')
  ) x
  where e is not null
  order by t desc, o desc, n desc
  limit 1;
$$;

-- hb_request_changes: as in staff-handbook-4-approvals.sql, plus one email
-- to the last editor (see the header).
create or replace function public.hb_request_changes(p_policy_id uuid, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me staff := hb_require_approver();
  p handbook_policies;
  v_note text := btrim(coalesce(p_note, ''));
  v_at timestamptz := now();
  v_to text;
  ed staff;
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

  -- The last editor, when that's another active admin.
  v_to := hb_last_editor(p.id);
  if v_to is not null and v_to <> lower(me.email) then
    select * into ed from staff where lower(email) = v_to and active = true and role = 'admin' limit 1;
  end if;
  if ed.id is not null then
    perform hb_queue('handbook_changes_requested', lower(ed.email), p.id::text, jsonb_build_object(
      'policy_id', p.id, 'policy_slug', p.slug, 'policy_title', left(p.title, 200),
      'note', v_note, 'by', coalesce(nullif(btrim(me.name), ''), lower(me.email)),
      'by_email', lower(me.email), 'link', '#/hr/handbook?item=handbook:' || p.slug));
    -- hb_queue only warns when the outbox kind check refuses the row; then
    -- nobody is emailed, so don't say so.
    if not exists (select 1 from notification_outbox
                    where kind = 'handbook_changes_requested' and ref_id = p.id::text
                      and recipient_email = lower(ed.email) and processed_at is null and created_at >= v_at) then
      ed := null;
    end if;
  end if;

  perform audit_write('handbook.policy_changes_requested', null, 'handbook_policy', p.id::text,
    jsonb_build_object('policy', p.slug, 'title', left(p.title, 200), 'from', p.approval_status,
                       'note', left(v_note, 500), 'emailed', lower(ed.email)));
  return jsonb_build_object('policy_id', p.id, 'approval_status', 'changes_requested', 'note', v_note,
                            'pending', hb_pending_approvals(),
                            'emailed_to', lower(ed.email), 'emailed_name', ed.name);
end $$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'hb_changers_ok(text[])', 'hb_approver_changers()', 'hb_can_change_approver(text)', 'hb_approver_changers_label()',
    'hb_last_editor(uuid)', 'hb_approval_problem(public.handbook_policies)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'hb_approver_access()', 'hb_set_policy_approver(text)', 'hb_request_changes(uuid, text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

commit;
