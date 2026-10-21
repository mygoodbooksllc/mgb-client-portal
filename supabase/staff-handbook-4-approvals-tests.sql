-- Staff Handbook part 4 (draft approval): rule checks.
-- NOT a migration. Run AFTER staff-handbook-4-approvals.sql has been applied
-- (and, optionally, the seed), in the Supabase SQL editor (or psql as
-- postgres). Everything runs in one transaction that ends in ROLLBACK, so no
-- fixture, setting change, email row or audit row survives. A failing check
-- is collected; the run ends by raising
-- 'staff-handbook-4-approvals tests FAILED: ...' listing every failure, or
-- with the notice '... all N passed'.
--
-- Personas are picked from the live staff table (no emails here):
--   ap    the approver: the current setting when it's an active admin, else
--         the first active admin. The setting is pointed at ap for the run.
--   adm   another active admin (not the approver)
--   bk    an active bookkeeper
-- Fixtures: throwaway policies with slugs starting hbt4-.
--
-- Covers: a non-approver (admin, bookkeeper, anon) can't approve or ask for
-- changes; publish is blocked until approved, and approval is tied to the
-- exact latest text; Edit text and Edit details reset approval (sort alone
-- doesn't); editing an approved draft keeps it a draft; Make this a signed
-- policy on a draft needs approval, then approval again; a missing or
-- inactive approver blocks publishing; the approver setting is admin-only
-- and audited; the SLA policy is unaffected; drafts stay invisible to
-- non-admins; the approver notice batching rule; and the seed never creates
-- a signed or published policy.

begin;

create temp table _hbk (n serial, name text, ok boolean, detail text);
create temp table _who (k text primary key, email text);

create or replace function pg_temp.chk(p_name text, p_ok boolean, p_detail text default null)
returns void language plpgsql as $$
begin
  insert into _hbk(name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail);
end $$;

create or replace function pg_temp.claims(p_email text)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    case when p_email is null then ''
         else json_build_object('email', p_email, 'role', 'authenticated', 'sub', gen_random_uuid(),
                'app_metadata', json_build_object('provider', 'google', 'providers', json_build_array('google')))::text end,
    true);
end $$;

-- Run one scalar query as a signed-in user (or anon when p_email is null).
-- Returns the value as text, or 'ERR:<sqlstate>:<message>'.
create or replace function pg_temp.probe(p_email text, p_sql text)
returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp.claims(p_email);
  if p_email is null then set local role anon; else set local role authenticated; end if;
  begin
    execute p_sql into v;
    v := coalesce(v, 'null');
  exception when others then
    v := 'ERR:' || sqlstate || ':' || left(sqlerrm, 160);
  end;
  reset role;
  perform pg_temp.claims(null);
  return v;
end $$;

-- Same, as the table owner with no signed-in user (like the seed or a cron).
create or replace function pg_temp.owner(p_sql text)
returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp.claims(null);
  begin
    execute p_sql into v;
    v := coalesce(v, 'null');
  exception when others then
    v := 'ERR:' || sqlstate || ':' || left(sqlerrm, 160);
  end;
  return v;
end $$;

create or replace function pg_temp.pid(p_slug text)
returns uuid language sql as $$ select id from handbook_policies where slug = p_slug $$;

create or replace function pg_temp.latest(p_slug text)
returns uuid language sql as $$
  select v.id from handbook_versions v join handbook_policies p on p.id = v.policy_id
  where p.slug = p_slug order by v.version_no desc limit 1 $$;

create or replace function pg_temp.appr(p_slug text)
returns text language sql as $$ select approval_status from handbook_policies where slug = p_slug $$;

-- Unsent approver notices for ap.
create or replace function pg_temp.unsent()
returns int language sql as $$
  select count(*)::int from notification_outbox
  where kind = 'handbook_approval_needed' and processed_at is null
    and recipient_email = (select lower(email) from _who where k = 'ap') $$;

-- Mark every approver notice for ap as sent p_ago ago (rolled back at the end).
create or replace function pg_temp.sent_ago(p_ago interval)
returns void language sql as $$
  update notification_outbox set processed_at = now() - p_ago, status = 'sent', reason = null
  where kind = 'handbook_approval_needed'
    and recipient_email = (select lower(email) from _who where k = 'ap') $$;

-- Approve the latest text of a draft as ap.
create or replace function pg_temp.approve(p_slug text)
returns text language plpgsql as $$
begin
  return pg_temp.probe((select email from _who where k = 'ap'),
    format($q$select hb_approve_policy(%L, %L) ->> 'approval_status'$q$, pg_temp.pid(p_slug), pg_temp.latest(p_slug)));
end $$;

insert into _who
select 'ap', coalesce(
  (select s.email from handbook_settings h join staff s on lower(s.email) = lower(h.policy_approver_email)
    where h.id = 1 and s.active and s.role = 'admin' limit 1),
  (select min(email) from staff where role = 'admin' and active));
insert into _who select 'adm', min(email) from staff
  where role = 'admin' and active and lower(email) <> lower((select email from _who where k = 'ap'));
insert into _who select 'bk', min(email) from staff where role = 'bookkeeper' and active;

-- Point the setting at ap for the run, and start with no unsent notices.
update handbook_settings set policy_approver_email = lower((select email from _who where k = 'ap')) where id = 1;
-- Part 5 (staff-handbook-5-approver-tweaks.sql) limits who can change the
-- approver to handbook_settings.approver_changers. Put adm on it for the run.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'handbook_settings' and column_name = 'approver_changers') then
    execute 'update handbook_settings set approver_changers = array[lower($1)] where id = 1'
      using (select email from _who where k = 'adm');
  end if;
end $$;
update notification_outbox set processed_at = now(), status = 'skipped', reason = 'test run'
 where kind = 'handbook_approval_needed' and processed_at is null;

do $$
declare
  ap text := (select email from _who where k = 'ap');
  adm text := (select email from _who where k = 'adm');
  bk text := (select email from _who where k = 'bk');
  v text;
  v_old uuid;
  v_nb timestamptz;
  sla handbook_policies;
  n int;
begin
  perform pg_temp.chk('personas found (an approver, a second admin, a bookkeeper)',
    ap is not null and adm is not null and bk is not null,
    'ap=' || coalesce(ap, '-') || ' adm=' || coalesce(adm, '-') || ' bk=' || coalesce(bk, '-'));

  -- ---------------------------------------------------------------- SLA
  select * into sla from handbook_policies where slug = 'flexible-work-sla';
  perform pg_temp.chk('SLA: approval not required', sla.approval_status = 'not_required', sla.approval_status);
  perform pg_temp.chk('SLA: still signed and published', sla.kind = 'signed' and sla.status = 'published');
  perform pg_temp.chk('SLA: no approval recorded', sla.approved_by is null and sla.approved_version_id is null);
  v := pg_temp.probe(bk, $q$select (select e -> 'my' ->> 'state' from jsonb_array_elements(hb_status() -> 'policies') e
                               where e ->> 'slug' = 'flexible-work-sla')$q$);
  perform pg_temp.chk('SLA: bookkeeper still has a signing state', v in ('not_signed', 'overdue', 'awaiting_countersign', 'signed'), v);
  v := pg_temp.probe(adm, $q$select (select e ? 'approval_status' from jsonb_array_elements(hb_status() -> 'policies') e
                                where e ->> 'slug' = 'flexible-work-sla')::text$q$);
  perform pg_temp.chk('SLA: no approval fields in hb_status', v = 'false', v);
  v := pg_temp.owner(format($q$update handbook_policies set title = title || ' x' where id = %L returning approval_status$q$, sla.id));
  perform pg_temp.chk('SLA: a published edit never touches approval', v = 'not_required', v);

  -- ---------------------------------------------------- batching, part 1
  -- Several drafts created together: one notice.
  v := pg_temp.probe(adm, $q$select hb_create_policy('Approval test A', 'hbt4-a', null, 'Test', 'Text A') ->> 'status'$q$);
  perform pg_temp.chk('admin creates draft A', v = 'draft', v);
  perform pg_temp.chk('new draft starts pending', pg_temp.appr('hbt4-a') = 'pending', pg_temp.appr('hbt4-a'));
  v := pg_temp.probe(adm, $q$select hb_create_policy('Approval test B', 'hbt4-b', null, 'Test', 'Text B') ->> 'status'$q$);
  v := pg_temp.probe(adm, $q$select hb_create_policy('Approval test C', 'hbt4-c', null, 'Test', 'Text C') ->> 'status'$q$);
  perform pg_temp.chk('batch: three new drafts queue one notice', pg_temp.unsent() = 1, pg_temp.unsent()::text);
  perform pg_temp.chk('batch: the notice goes to the approver with a link only',
    exists (select 1 from notification_outbox where kind = 'handbook_approval_needed' and processed_at is null
            and recipient_email = lower(ap) and payload ->> 'link' = '#/team/handbook?item=handbook:approvals'
            and not (payload ? 'policy_title') and not (payload ? 'body_md')));
  -- An edit while that notice is unsent adds none.
  v := pg_temp.probe(adm, format($q$select hb_publish_version(%L, 'Text A edited', false, 'Edit') ->> 'version_no'$q$, pg_temp.pid('hbt4-a')));
  perform pg_temp.chk('edit text on a draft saves version 2', v = '2', v);
  perform pg_temp.chk('batch: an edit while a notice is unsent adds none', pg_temp.unsent() = 1, pg_temp.unsent()::text);

  -- --------------------------------------------- who can approve
  v := pg_temp.probe(adm, format($q$select hb_approve_policy(%L, %L)$q$, pg_temp.pid('hbt4-a'), pg_temp.latest('hbt4-a')));
  perform pg_temp.chk('another admin cannot approve', v like 'ERR:42501%', v);
  v := pg_temp.probe(bk, format($q$select hb_approve_policy(%L, %L)$q$, pg_temp.pid('hbt4-a'), pg_temp.latest('hbt4-a')));
  perform pg_temp.chk('a bookkeeper cannot approve', v like 'ERR:42501%', v);
  v := pg_temp.probe(null, format($q$select hb_approve_policy(%L, %L)$q$, pg_temp.pid('hbt4-a'), pg_temp.latest('hbt4-a')));
  perform pg_temp.chk('anon cannot approve', v like 'ERR:42501%', v);
  v := pg_temp.probe(adm, format($q$select hb_request_changes(%L, 'No')$q$, pg_temp.pid('hbt4-a')));
  perform pg_temp.chk('another admin cannot request changes', v like 'ERR:42501%', v);
  v := pg_temp.probe(bk, format($q$select hb_request_changes(%L, 'No')$q$, pg_temp.pid('hbt4-a')));
  perform pg_temp.chk('a bookkeeper cannot request changes', v like 'ERR:42501%', v);
  v := pg_temp.owner(format($q$update handbook_policies set approval_status = 'approved', approved_by = 'x', approved_at = now(),
                               approved_version_id = %L, approved_sha256 = 'x' where id = %L returning approval_status$q$,
                            pg_temp.latest('hbt4-a'), pg_temp.pid('hbt4-a')));
  perform pg_temp.chk('approval cannot be written to the table directly', v like 'ERR:42501%', v);
  perform pg_temp.chk('approval still pending after the refusals', pg_temp.appr('hbt4-a') = 'pending');

  -- ------------------------------------------ publish blocked until approved
  v := pg_temp.probe(adm, format($q$select hb_publish_policy(%L)$q$, pg_temp.pid('hbt4-a')));
  perform pg_temp.chk('publish refused while pending', v like 'ERR:55000%approved%', v);
  v := pg_temp.owner(format($q$update handbook_policies set status = 'published', published_at = now() where id = %L returning status$q$, pg_temp.pid('hbt4-a')));
  perform pg_temp.chk('table backstop: an unapproved draft never goes live', v like 'ERR:55000%', v);
  -- Stale approval: the approver read version 1, the draft is at version 2.
  select id into v_old from handbook_versions where policy_id = pg_temp.pid('hbt4-a') and version_no = 1;
  v := pg_temp.probe(ap, format($q$select hb_approve_policy(%L, %L)$q$, pg_temp.pid('hbt4-a'), v_old));
  perform pg_temp.chk('approving an older version is refused', v like 'ERR:55000%changed%', v);
  v := pg_temp.approve('hbt4-a');
  perform pg_temp.chk('the approver approves the latest text', v = 'approved', v);
  perform pg_temp.chk('approval is tied to the exact version and hash',
    exists (select 1 from handbook_policies p join handbook_versions l on l.id = p.approved_version_id
            where p.slug = 'hbt4-a' and l.version_no = 2 and p.approved_sha256 = l.body_sha256
              and p.approved_by = lower(ap) and p.approved_at is not null));
  perform pg_temp.chk('approval is audited',
    exists (select 1 from audit_log where action = 'handbook.policy_approved' and target_id = pg_temp.pid('hbt4-a')::text
            and details ->> 'version_no' = '2'));
  v := pg_temp.approve('hbt4-a');
  perform pg_temp.chk('approving the same version twice is refused', v like 'ERR:55000%', v);
  perform pg_temp.chk('the approver''s own approve queues nothing', pg_temp.unsent() = 1, pg_temp.unsent()::text);

  -- ---------------------------------------------- edit resets approval
  -- Edit text on an approved draft: still a draft, pending again, audited,
  -- publish blocked again.
  v := pg_temp.probe(adm, format($q$select hb_publish_version(%L, 'Text A edited again', false, 'More') ->> 'version_no'$q$, pg_temp.pid('hbt4-a')));
  perform pg_temp.chk('edit text on an approved draft saves version 3', v = '3', v);
  perform pg_temp.chk('edit text resets approval to pending', pg_temp.appr('hbt4-a') = 'pending', pg_temp.appr('hbt4-a'));
  perform pg_temp.chk('edit text keeps it a draft', (select status from handbook_policies where slug = 'hbt4-a') = 'draft');
  perform pg_temp.chk('edit text clears the approval',
    (select approved_by is null and approved_version_id is null and approved_sha256 is null
       from handbook_policies where slug = 'hbt4-a'));
  perform pg_temp.chk('the reset is audited',
    exists (select 1 from audit_log where action = 'handbook.approval_reset' and target_id = pg_temp.pid('hbt4-a')::text
            and details ->> 'reason' = 'text_changed' and details ->> 'from' = 'approved'));
  v := pg_temp.probe(adm, format($q$select hb_publish_policy(%L)$q$, pg_temp.pid('hbt4-a')));
  perform pg_temp.chk('publish refused after an edit until approved again', v like 'ERR:55000%', v);
  perform pg_temp.chk('the edit made while a notice was unsent added none', pg_temp.unsent() = 1, pg_temp.unsent()::text);

  -- Edit details: title or section resets; order alone doesn't.
  v := pg_temp.approve('hbt4-a');
  v := pg_temp.probe(adm, format($q$select hb_update_policy(%L, 'Approval test A', 'Test', 77) ->> 'sort'$q$, pg_temp.pid('hbt4-a')));
  perform pg_temp.chk('details: changing only the order keeps approval', pg_temp.appr('hbt4-a') = 'approved', pg_temp.appr('hbt4-a'));
  v := pg_temp.probe(adm, format($q$select hb_update_policy(%L, 'Approval test A renamed', 'Test', 77) ->> 'title'$q$, pg_temp.pid('hbt4-a')));
  perform pg_temp.chk('details: a new title resets approval', pg_temp.appr('hbt4-a') = 'pending', pg_temp.appr('hbt4-a'));
  v := pg_temp.approve('hbt4-a');
  v := pg_temp.probe(adm, format($q$select hb_update_policy(%L, 'Approval test A renamed', 'Other', 77) ->> 'section'$q$, pg_temp.pid('hbt4-a')));
  perform pg_temp.chk('details: a new section resets approval', pg_temp.appr('hbt4-a') = 'pending', pg_temp.appr('hbt4-a'));

  -- ------------------------------------------------ batching, part 2
  -- A notice was sent 10 minutes ago: the next one waits until 30 minutes
  -- after it.
  perform pg_temp.sent_ago(interval '10 minutes');
  perform pg_temp.chk('batch: setup, nothing unsent', pg_temp.unsent() = 0, pg_temp.unsent()::text);
  v := pg_temp.approve('hbt4-a');
  v := pg_temp.probe(adm, format($q$select hb_publish_version(%L, 'Text A v5', false, 'Edit') ->> 'version_no'$q$, pg_temp.pid('hbt4-a')));
  perform pg_temp.chk('batch: an edit after approval re-flags the approver', pg_temp.unsent() = 1, pg_temp.unsent()::text);
  select (payload ->> 'not_before')::timestamptz into v_nb from notification_outbox
   where kind = 'handbook_approval_needed' and processed_at is null and recipient_email = lower(ap);
  perform pg_temp.chk('batch: held until 30 minutes after the last email',
    v_nb between now() + interval '19 minutes 59 seconds' and now() + interval '20 minutes 1 second', v_nb::text);
  -- Several more edits and drafts in that window: still one notice.
  v := pg_temp.probe(adm, format($q$select hb_publish_version(%L, 'Text B v2', false, 'Edit') ->> 'version_no'$q$, pg_temp.pid('hbt4-b')));
  v := pg_temp.probe(adm, $q$select hb_create_policy('Approval test D', 'hbt4-d', null, 'Test', 'Text D') ->> 'status'$q$);
  perform pg_temp.chk('batch: more drafts in the window add none', pg_temp.unsent() = 1, pg_temp.unsent()::text);
  -- A notice sent 40 minutes ago: the next one can go now.
  perform pg_temp.sent_ago(interval '40 minutes');
  v := pg_temp.approve('hbt4-a');
  v := pg_temp.probe(adm, format($q$select hb_publish_version(%L, 'Text A v6', false, 'Edit') ->> 'version_no'$q$, pg_temp.pid('hbt4-a')));
  select (payload ->> 'not_before')::timestamptz into v_nb from notification_outbox
   where kind = 'handbook_approval_needed' and processed_at is null and recipient_email = lower(ap);
  perform pg_temp.chk('batch: after 30 quiet minutes it can go at once', v_nb is not null and v_nb <= now() + interval '1 second', coalesce(v_nb::text, 'none'));
  -- The approver's own edit queues nothing.
  perform pg_temp.sent_ago(interval '40 minutes');
  v := pg_temp.approve('hbt4-a');
  v := pg_temp.probe(ap, format($q$select hb_publish_version(%L, 'Text A v7', false, 'My edit') ->> 'version_no'$q$, pg_temp.pid('hbt4-a')));
  perform pg_temp.chk('the approver''s own edit resets approval', pg_temp.appr('hbt4-a') = 'pending', pg_temp.appr('hbt4-a'));
  perform pg_temp.chk('batch: the approver''s own edit queues no email', pg_temp.unsent() = 0, pg_temp.unsent()::text);
  -- An edit to a draft that is already pending queues nothing new.
  v := pg_temp.probe(adm, format($q$select hb_publish_version(%L, 'Text C v2', false, 'Edit') ->> 'version_no'$q$, pg_temp.pid('hbt4-c')));
  perform pg_temp.chk('batch: editing a draft that is already waiting queues no email', pg_temp.unsent() = 0, pg_temp.unsent()::text);

  -- ------------------------------------------------- request changes
  v := pg_temp.probe(ap, format($q$select hb_request_changes(%L, '')$q$, pg_temp.pid('hbt4-b')));
  perform pg_temp.chk('request changes needs a note', v like 'ERR:%', v);
  v := pg_temp.probe(ap, format($q$select hb_request_changes(%L, 'Fix the second paragraph.') ->> 'approval_status'$q$, pg_temp.pid('hbt4-b')));
  perform pg_temp.chk('the approver asks for changes', v = 'changes_requested', v);
  perform pg_temp.chk('request changes is audited',
    exists (select 1 from audit_log where action = 'handbook.policy_changes_requested' and target_id = pg_temp.pid('hbt4-b')::text));
  perform pg_temp.chk('request changes emails nobody', pg_temp.unsent() = 0, pg_temp.unsent()::text);
  v := pg_temp.probe(adm, format($q$select hb_publish_policy(%L)$q$, pg_temp.pid('hbt4-b')));
  perform pg_temp.chk('publish refused while changes are requested', v like 'ERR:55000%changes%', v);
  v := pg_temp.probe(adm, format($q$select hb_publish_version(%L, 'Text B v3, fixed', false, 'Fixed') ->> 'version_no'$q$, pg_temp.pid('hbt4-b')));
  perform pg_temp.chk('editing after changes were requested makes it pending', pg_temp.appr('hbt4-b') = 'pending', pg_temp.appr('hbt4-b'));
  perform pg_temp.chk('the approver''s note stays for context',
    (select approval_note from handbook_policies where slug = 'hbt4-b') = 'Fix the second paragraph.');
  perform pg_temp.chk('batch: the fixed draft re-flags the approver once', pg_temp.unsent() = 1, pg_temp.unsent()::text);

  -- -------------------------------------------- approve, then publish
  v := pg_temp.approve('hbt4-b');
  v := pg_temp.probe(adm, format($q$select hb_publish_policy(%L) ->> 'status'$q$, pg_temp.pid('hbt4-b')));
  perform pg_temp.chk('an approved draft publishes (any admin)', v = 'published', v);
  perform pg_temp.chk('a published policy keeps its approval as history', pg_temp.appr('hbt4-b') = 'approved');
  v := pg_temp.probe(adm, format($q$select hb_publish_version(%L, 'Text B published v4', false, 'Typo') ->> 'version_no'$q$, pg_temp.pid('hbt4-b')));
  perform pg_temp.chk('a published reference policy takes a minor edit without approval', v = '4', v);
  perform pg_temp.chk('a published edit leaves approval alone', pg_temp.appr('hbt4-b') = 'approved', pg_temp.appr('hbt4-b'));
  v := pg_temp.probe(ap, format($q$select hb_approve_policy(%L, %L)$q$, pg_temp.pid('hbt4-b'), pg_temp.latest('hbt4-b')));
  perform pg_temp.chk('published policies are not approved again', v like 'ERR:%published%', v);

  -- ---------------------------------- convert a draft to signed
  v := pg_temp.probe(adm, format($q$select hb_convert_to_signed(%L, null, 'Needs signing', true)$q$, pg_temp.pid('hbt4-c')));
  perform pg_temp.chk('convert on an unapproved draft is refused', v like 'ERR:55000%', v);
  perform pg_temp.chk('the refused convert left it reference', (select kind from handbook_policies where slug = 'hbt4-c') = 'reference');
  v := pg_temp.approve('hbt4-c');
  v := pg_temp.probe(adm, format($q$select hb_convert_to_signed(%L, null, 'Needs signing', true) ->> 'notified'$q$, pg_temp.pid('hbt4-c')));
  perform pg_temp.chk('convert on an approved draft works and emails nobody', v = '0', v);
  perform pg_temp.chk('the converted draft needs approval again', pg_temp.appr('hbt4-c') = 'pending', pg_temp.appr('hbt4-c'));
  v := pg_temp.probe(adm, format($q$select hb_publish_policy(%L)$q$, pg_temp.pid('hbt4-c')));
  perform pg_temp.chk('the converted draft can''t publish before re-approval', v like 'ERR:55000%', v);

  -- ------------------------------------------- the approver setting
  v := pg_temp.probe(bk, format($q$select hb_set_policy_approver(%L)$q$, adm));
  perform pg_temp.chk('a bookkeeper cannot change the approver', v like 'ERR:42501%', v);
  v := pg_temp.probe(adm, format($q$select hb_set_policy_approver(%L)$q$, bk));
  perform pg_temp.chk('the approver must be an active admin', v like 'ERR:%active admin%', v);
  v := pg_temp.probe(adm, $q$select hb_set_policy_approver('')$q$);
  perform pg_temp.chk('the approver cannot be cleared', v like 'ERR:%', v);
  perform pg_temp.sent_ago(interval '40 minutes');
  v := pg_temp.probe(adm, format($q$select hb_set_policy_approver(%L) ->> 'policy_approver_email'$q$, adm));
  perform pg_temp.chk('an admin changes the approver', v = lower(adm), v);
  perform pg_temp.chk('the change is audited',
    exists (select 1 from audit_log where action = 'handbook.approver_changed'
            and details ->> 'from' = lower(ap) and details ->> 'to' = lower(adm)));
  perform pg_temp.chk('setting yourself as approver queues you no email',
    not exists (select 1 from notification_outbox where kind = 'handbook_approval_needed'
                and processed_at is null and recipient_email = lower(adm)));
  v := pg_temp.probe(ap, format($q$select hb_approve_policy(%L, %L)$q$, pg_temp.pid('hbt4-c'), pg_temp.latest('hbt4-c')));
  perform pg_temp.chk('the old approver can no longer approve', v like 'ERR:42501%', v);
  v := pg_temp.probe(adm, format($q$select hb_set_policy_approver(%L) ->> 'policy_approver_email'$q$, ap));
  perform pg_temp.chk('the approver is set back', v = lower(ap), v);
  perform pg_temp.chk('a new approver with drafts waiting gets one notice', pg_temp.unsent() = 1, pg_temp.unsent()::text);

  -- An approver who isn't an active admin blocks publishing, even for an
  -- already-approved draft, and the status says so.
  v := pg_temp.approve('hbt4-c');
  update handbook_settings set policy_approver_email = lower(bk) where id = 1;
  v := pg_temp.probe(adm, format($q$select hb_publish_policy(%L)$q$, pg_temp.pid('hbt4-c')));
  perform pg_temp.chk('publish refused while the approver is not an active admin', v like 'ERR:55000%not an active admin%', v);
  v := pg_temp.probe(adm, $q$select hb_status() ->> 'approver_missing'$q$);
  perform pg_temp.chk('hb_status reports the missing approver', v = 'true', v);
  update handbook_settings set policy_approver_email = lower(ap) where id = 1;
  v := pg_temp.probe(adm, format($q$select hb_publish_policy(%L) ->> 'notified'$q$, pg_temp.pid('hbt4-c')));
  perform pg_temp.chk('with the approver back, the approved signed draft publishes', v ~ '^[0-9]+$', v);

  -- --------------------------------------- what each person sees
  v := pg_temp.probe(ap, $q$select hb_status() -> 'me' ->> 'is_approver'$q$);
  perform pg_temp.chk('hb_status: the approver is flagged', v = 'true', v);
  v := pg_temp.probe(adm, $q$select hb_status() -> 'me' ->> 'is_approver'$q$);
  perform pg_temp.chk('hb_status: another admin is not the approver', v = 'false', v);
  select count(*) into n from handbook_policies p
   where p.status = 'draft' and p.active and p.approval_status = 'pending'
     and exists (select 1 from handbook_versions x where x.policy_id = p.id);
  v := pg_temp.probe(adm, $q$select hb_status() ->> 'approvals_pending'$q$);
  perform pg_temp.chk('hb_status: admins see the pending count', v = n::text, v || ' vs ' || n);
  v := pg_temp.probe(ap, $q$select (hb_status() ->> 'badge')::int$q$);
  perform pg_temp.chk('hb_status: the approver''s badge counts the drafts waiting',
    n >= 2 and case when v ~ '^[0-9]+$' then v::int >= n else false end, v || ' (pending ' || n || ')');
  v := pg_temp.probe(adm, $q$select hb_get_policy('hbt4-d') -> 'approval' ->> 'status'$q$);
  perform pg_temp.chk('hb_get_policy: admins see the approval', v = 'pending', v);
  v := pg_temp.probe(adm, $q$select hb_get_policy('hbt4-d') -> 'approval' ->> 'problem'$q$);
  perform pg_temp.chk('hb_get_policy: says why it can''t publish yet', v like '%approved%', v);
  -- Drafts stay invisible to non-admins.
  v := pg_temp.probe(bk, $q$select count(*) from jsonb_array_elements(hb_status() -> 'policies') e where e ->> 'slug' like 'hbt4-%' and e ->> 'status' = 'draft'$q$);
  perform pg_temp.chk('staff: drafts not in hb_status', v = '0', v);
  v := pg_temp.probe(bk, $q$select hb_get_policy('hbt4-d') ->> 'policy'$q$);
  perform pg_temp.chk('staff: a draft is not found by slug', v like 'ERR:%not found%', v);
  v := pg_temp.probe(bk, $q$select count(*) from handbook_policies where slug = 'hbt4-d'$q$);
  perform pg_temp.chk('staff: draft row hidden (RLS)', v = '0', v);
  v := pg_temp.probe(bk, $q$select coalesce(hb_status() ->> 'approvals_pending', 'null') || '/' || (hb_status() -> 'me' ->> 'is_approver')$q$);
  perform pg_temp.chk('staff: no approval counts, not the approver', v = 'null/false', v);
  v := pg_temp.probe(bk, $q$select hb_get_policy('hbt4-b') ->> 'approval'$q$);
  perform pg_temp.chk('staff: a published policy shows no approval', v = 'null', v);

  -- ------------------------------------------- the seed's rules
  -- The same inserts the seed makes, as the owner with nobody signed in:
  -- reference drafts, pending, one notice for several, nothing signed.
  perform pg_temp.sent_ago(interval '40 minutes');
  v := pg_temp.owner($q$
    with p as (
      insert into handbook_policies (slug, title, sort, kind, status, section, published_at)
      values ('hbt4-seed-1', 'Seed 1', 1, 'reference', 'draft', 'Employee Handbook', null),
             ('hbt4-seed-2', 'Seed 2', 2, 'reference', 'draft', 'Employee Handbook', null),
             ('hbt4-seed-3', 'Seed 3', 3, 'reference', 'draft', 'Employee Handbook', null)
      on conflict (slug) do nothing returning id)
    insert into handbook_versions (policy_id, version_no, body_md, body_sha256, requires_resign, change_note, published_by)
    select id, 1, 'Seed text', encode(sha256(convert_to('Seed text', 'UTF8')), 'hex'), false, 'First draft.', 'system' from p
    returning 'ok'$q$);
  perform pg_temp.chk('seed-style insert works', v = 'ok', v);
  perform pg_temp.chk('seed-style drafts are reference, draft, pending',
    (select bool_and(kind = 'reference' and status = 'draft' and approval_status = 'pending' and published_at is null)
       from handbook_policies where slug like 'hbt4-seed-%'));
  perform pg_temp.chk('seed-style: one notice for three drafts', pg_temp.unsent() = 1, pg_temp.unsent()::text);
  perform pg_temp.chk('seed-style: no signature email',
    not exists (select 1 from notification_outbox where processed_at is null and kind in ('handbook_sign_needed', 'handbook_countersign_needed')
                and payload ->> 'policy_slug' like 'hbt4-seed-%'));
  v := pg_temp.owner($q$update handbook_policies set approval_status = 'approved' where slug = 'hbt4-seed-1' returning 'x'$q$);
  perform pg_temp.chk('seed-style: approval cannot be faked by the owner either', v like 'ERR:42501%', v);
  -- If the real seed has run: nine reference drafts (or published later by
  -- an admin), never signed, no signatures.
  select count(*) into n from handbook_policies where slug like 'employee-handbook-%';
  if n = 0 then
    perform pg_temp.chk('seeded chapters: seed not run here (skipped)', true, 'no employee-handbook-* policies');
  else
    perform pg_temp.chk('seeded chapters: nine at most', n <= 9, n::text);
    perform pg_temp.chk('seeded chapters: never signed',
      not exists (select 1 from handbook_policies where slug like 'employee-handbook-%' and kind <> 'reference'));
    perform pg_temp.chk('seeded chapters: no signatures',
      not exists (select 1 from handbook_signatures s join handbook_versions x on x.id = s.version_id
                  join handbook_policies p on p.id = x.policy_id where p.slug like 'employee-handbook-%'));
    perform pg_temp.chk('seeded chapters: in the Employee Handbook section',
      not exists (select 1 from handbook_policies where slug like 'employee-handbook-%' and section is distinct from 'Employee Handbook'));
    perform pg_temp.chk('seeded chapters: version 1 is by system and needs no signing',
      not exists (select 1 from handbook_versions x join handbook_policies p on p.id = x.policy_id
                  where p.slug like 'employee-handbook-%' and x.version_no = 1
                    and (x.requires_resign or x.published_by <> 'system')));
    perform pg_temp.chk('seeded chapters: no chapter 10 (Acknowledgment)',
      not exists (select 1 from handbook_policies where slug like 'employee-handbook-%' and title ilike '%acknowledg%'));
  end if;
end $$;

do $$
declare bad text;
begin
  select string_agg(name || coalesce(' [' || detail || ']', ''), E'\n  ') into bad from _hbk where not ok;
  if bad is not null then
    raise exception E'staff-handbook-4-approvals tests FAILED:\n  %', bad;
  end if;
  raise notice 'staff-handbook-4-approvals tests: all % passed', (select count(*) from _hbk);
end $$;

rollback;
