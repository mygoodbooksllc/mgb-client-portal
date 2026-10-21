-- Staff Handbook part 5 (approver tweaks): rule checks.
-- NOT a migration. Run AFTER staff-handbook-5-approver-tweaks.sql has been
-- applied, in the Supabase SQL editor (or psql as postgres). Everything runs
-- in one transaction that ends in ROLLBACK, so no fixture, setting change,
-- email row or audit row survives. A failing check is collected; the run ends
-- by raising 'staff-handbook-5-approver-tweaks tests FAILED: ...' listing
-- every failure, or with the notice '... all N passed'.
--
-- Personas are picked from the live staff table (no emails here):
--   ap    the approver: the current setting when it's an active admin, else
--         the first active admin. The setting is pointed at ap for the run.
--   adm   another active admin (not the approver); put on the changers list
--         for the run
--   adm2  a third active admin, not on the list
--   bk    an active bookkeeper
-- Fixtures: throwaway policies with slugs starting hbt5-.
--
-- Covers: the changers list and its checks; only people on it (active admins) can
-- change the approver, whatever their HR job title says; an empty, missing
-- or non-admin list means nobody can; hb_approver_access; the missing-
-- approver text names who can fix it; Request changes emails the last
-- editor once per request (text edits, details edits, convert), never the
-- approver themselves, never 'system' or a non-admin; the SLA policy is
-- unaffected.

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
    v := 'ERR:' || sqlstate || ':' || left(sqlerrm, 200);
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
    v := 'ERR:' || sqlstate || ':' || left(sqlerrm, 200);
  end;
  return v;
end $$;

create or replace function pg_temp.pid(p_slug text)
returns uuid language sql as $$ select id from handbook_policies where slug = p_slug $$;

-- Unsent changes-requested rows for one policy (optionally one recipient).
create or replace function pg_temp.asks(p_slug text, p_to text default null)
returns int language sql as $$
  select count(*)::int from notification_outbox
  where kind = 'handbook_changes_requested' and processed_at is null
    and ref_id = pg_temp.pid(p_slug)::text
    and (p_to is null or recipient_email = lower(p_to)) $$;

-- Ask for changes on a draft as ap; returns emailed_to (or 'null').
create or replace function pg_temp.ask(p_slug text, p_note text)
returns text language plpgsql as $$
begin
  return pg_temp.probe((select email from _who where k = 'ap'),
    format($q$select coalesce(hb_request_changes(%L, %L) ->> 'emailed_to', 'null')$q$, pg_temp.pid(p_slug), p_note));
end $$;

insert into _who
select 'ap', coalesce(
  (select s.email from handbook_settings h join staff s on lower(s.email) = lower(h.policy_approver_email)
    where h.id = 1 and s.active and s.role = 'admin' limit 1),
  (select min(email) from staff where role = 'admin' and active));
insert into _who select 'adm', min(email) from staff
  where role = 'admin' and active and lower(email) <> lower((select email from _who where k = 'ap'));
insert into _who select 'adm2', min(email) from staff
  where role = 'admin' and active
    and lower(email) not in (select lower(email) from _who where k in ('ap', 'adm') and email is not null);
insert into _who select 'bk', min(email) from staff where role = 'bookkeeper' and active;

-- The seeded list, before the run changes it.
create temp table _seeded as select approver_changers from handbook_settings where id = 1;

-- Point the approver at ap and put only adm on the changers list for the run.
update handbook_settings
   set policy_approver_email = lower((select email from _who where k = 'ap')),
       approver_changers = array[lower((select email from _who where k = 'adm'))]
 where id = 1;

do $$
declare
  ap text := (select email from _who where k = 'ap');
  adm text := (select email from _who where k = 'adm');
  adm2 text := (select email from _who where k = 'adm2');
  bk text := (select email from _who where k = 'bk');
  seeded text[] := (select approver_changers from _seeded);
  v text;
  r notification_outbox;
  sla handbook_policies;
  sla_v int;
begin
  perform pg_temp.chk('personas found (an approver, two other admins, a bookkeeper)',
    ap is not null and adm is not null and adm2 is not null and bk is not null,
    'ap=' || coalesce(ap, '-') || ' adm=' || coalesce(adm, '-') || ' adm2=' || coalesce(adm2, '-') || ' bk=' || coalesce(bk, '-'));

  -- ------------------------------------------------------- seeded list
  -- The live list (not the HR titles: they can change later on purpose).
  perform pg_temp.chk('the list is set and names at least one person', cardinality(seeded) >= 1,
    coalesce(array_to_string(seeded, ','), 'null'));
  v := pg_temp.owner($q$update handbook_settings set approver_changers = array['Mixed@Case.org'] where id = 1 returning 'x'$q$);
  perform pg_temp.chk('the list only takes lower-case emails', v like 'ERR:23514%', v);
  v := pg_temp.owner($q$update handbook_settings set approver_changers = array['a@x.org', ' b@x.org'] where id = 1 returning 'x'$q$);
  perform pg_temp.chk('the list refuses untrimmed entries anywhere', v like 'ERR:23514%', v);
  v := pg_temp.owner($q$update handbook_settings set approver_changers = array['a@x.org', 'a@x.org'] where id = 1 returning 'x'$q$);
  perform pg_temp.chk('the list refuses repeats', v like 'ERR:23514%', v);
  v := pg_temp.owner($q$update handbook_settings set approver_changers = array['a@x.org', ''] where id = 1 returning 'x'$q$);
  perform pg_temp.chk('the list refuses blanks', v like 'ERR:23514%', v);
  v := pg_temp.owner($q$update handbook_settings set approver_changers = null where id = 1 returning 'x'$q$);
  perform pg_temp.chk('the list can''t be unset (null would re-seed on a re-run)', v like 'ERR:23502%', v);
  v := pg_temp.probe(adm, $q$update handbook_settings set approver_changers = array['x@y.org'] where id = 1 returning 'x'$q$);
  perform pg_temp.chk('an admin cannot write the list through the API', v like 'ERR:%' or v = 'null', v);
  perform pg_temp.chk('the list is unchanged after that',
    (select approver_changers from handbook_settings where id = 1) = array[lower(adm)]);

  -- ---------------------------------------------- who can change the approver
  v := pg_temp.probe(ap, format($q$select hb_set_policy_approver(%L)$q$, adm));
  perform pg_temp.chk('the approver (an admin not on the list) cannot change the approver', v like 'ERR:42501%Only%', v);
  v := pg_temp.probe(adm2, format($q$select hb_set_policy_approver(%L)$q$, adm2));
  perform pg_temp.chk('another admin not on the list cannot change the approver', v like 'ERR:42501%', v);
  v := pg_temp.probe(bk, format($q$select hb_set_policy_approver(%L)$q$, adm));
  perform pg_temp.chk('a bookkeeper cannot change the approver', v like 'ERR:42501%', v);
  v := pg_temp.probe(null, format($q$select hb_set_policy_approver(%L)$q$, adm));
  perform pg_temp.chk('anon cannot change the approver', v like 'ERR:42501%', v);
  perform pg_temp.chk('the approver is unchanged after the refusals',
    (select policy_approver_email from handbook_settings where id = 1) = lower(ap));

  v := pg_temp.probe(adm, format($q$select hb_set_policy_approver(%L) ->> 'policy_approver_email'$q$, adm2));
  perform pg_temp.chk('someone on the list changes the approver', v = lower(adm2), v);
  perform pg_temp.chk('the change is audited as before',
    exists (select 1 from audit_log where action = 'handbook.approver_changed'
            and actor_email = lower(adm) and details ->> 'from' = lower(ap) and details ->> 'to' = lower(adm2)));
  v := pg_temp.probe(adm, format($q$select hb_set_policy_approver(%L)$q$, bk));
  perform pg_temp.chk('the approver must still be an active admin', v like 'ERR:%active admin%', v);
  v := pg_temp.probe(adm, format($q$select hb_set_policy_approver(%L) ->> 'policy_approver_email'$q$, adm));
  perform pg_temp.chk('someone on the list can make themselves the approver', v = lower(adm), v);
  v := pg_temp.probe(adm, format($q$select hb_set_policy_approver(%L) ->> 'policy_approver_email'$q$, ap));
  perform pg_temp.chk('and set it back', v = lower(ap), v);

  -- An HR job title doesn't grant the right (any admin can edit titles).
  v := pg_temp.probe(adm, format($q$select hr_save_record(%L, '{"job_title":"Co-CEO"}') ->> 'changed'$q$, adm2));
  perform pg_temp.chk('setup: an admin sets another admin''s HR title to Co-CEO', v not like 'ERR:%', v);
  v := pg_temp.probe(adm2, format($q$select hb_set_policy_approver(%L)$q$, adm2));
  perform pg_temp.chk('a Co-CEO title alone does not let them change the approver', v like 'ERR:42501%', v);

  -- hb_approver_access
  v := pg_temp.probe(adm, $q$select hb_approver_access() ->> 'can_change'$q$);
  perform pg_temp.chk('access: someone on the list can change', v = 'true', v);
  v := pg_temp.probe(adm2, $q$select hb_approver_access() ->> 'can_change'$q$);
  perform pg_temp.chk('access: another admin cannot', v = 'false', v);
  v := pg_temp.probe(ap, $q$select (hb_approver_access() -> 'changers' -> 0 ->> 'email') || '/' || jsonb_array_length(hb_approver_access() -> 'changers')$q$);
  perform pg_temp.chk('access: lists who can', v = lower(adm) || '/1', v);
  v := pg_temp.probe(adm2, $q$select hb_approver_access() ->> 'label'$q$);
  perform pg_temp.chk('access: a first-name label',
    v = coalesce(nullif(split_part((select name from staff where lower(email) = lower(adm)), ' ', 1), ''), lower(adm)), v);
  v := pg_temp.probe(bk, $q$select hb_approver_access()$q$);
  perform pg_temp.chk('access: bookkeepers are refused', v like 'ERR:42501%', v);
  v := pg_temp.probe(null, $q$select hb_approver_access()$q$);
  perform pg_temp.chk('access: anon is refused', v like 'ERR:42501%', v);

  -- Two names read "A or B".
  update handbook_settings set approver_changers = array[lower(adm), lower(adm2)] where id = 1;
  v := pg_temp.probe(adm, $q$select hb_approver_access() ->> 'label'$q$);
  perform pg_temp.chk('access: two names read "A or B"', v like '% or %' and v not like '%,%', v);
  v := pg_temp.probe(adm2, $q$select hb_approver_access() ->> 'can_change'$q$);
  perform pg_temp.chk('access: both on the list can change', v = 'true', v);

  -- Safe by default: a list naming only a non-admin, or an empty list, means
  -- nobody can.
  update handbook_settings set approver_changers = array[lower(bk)] where id = 1;
  v := pg_temp.probe(bk, format($q$select hb_set_policy_approver(%L)$q$, adm));
  perform pg_temp.chk('a bookkeeper on the list still cannot', v like 'ERR:42501%', v);
  v := pg_temp.probe(adm, format($q$select hb_set_policy_approver(%L)$q$, adm));
  perform pg_temp.chk('off the list, an admin cannot', v like 'ERR:42501%Nobody%', v);
  update handbook_settings set approver_changers = '{}' where id = 1;
  v := pg_temp.probe(adm, format($q$select hb_set_policy_approver(%L)$q$, adm));
  perform pg_temp.chk('an empty list: nobody can', v like 'ERR:42501%', v);
  v := pg_temp.probe(adm, $q$select (hb_approver_access() ->> 'can_change') || '/' || coalesce(hb_approver_access() ->> 'label', 'null')$q$);
  perform pg_temp.chk('an empty list: access says nobody', v = 'false/null', v);
  update handbook_settings set approver_changers = array[lower(adm)] where id = 1;

  -- The missing-approver text names who can pick a new one.
  v := pg_temp.probe(adm, $q$select hb_create_policy('Tweaks test P', 'hbt5-p', null, 'Test', 'Text P') ->> 'status'$q$);
  update handbook_settings set policy_approver_email = lower(bk) where id = 1;
  v := pg_temp.probe(adm2, $q$select hb_get_policy('hbt5-p') -> 'approval' ->> 'problem'$q$);
  perform pg_temp.chk('missing approver: the text names who can choose',
    v like '%not an active admin%' and v like '%can choose a new approver in HR › Handbook%' and v not like '%An admin can%', v);
  update handbook_settings set approver_changers = '{}' where id = 1;
  v := pg_temp.probe(adm2, $q$select hb_get_policy('hbt5-p') -> 'approval' ->> 'problem'$q$);
  perform pg_temp.chk('missing approver and nobody to fix it: says so', v like '%Nobody is set up%', v);
  update handbook_settings set policy_approver_email = lower(ap), approver_changers = array[lower(adm)] where id = 1;

  -- ------------------------------------------- Request changes emails
  -- Created by adm: adm is emailed, with the note, title and link.
  v := pg_temp.probe(adm, $q$select hb_create_policy('Tweaks test E', 'hbt5-e', null, 'Test', 'Text E') ->> 'status'$q$);
  perform pg_temp.chk('setup: adm creates draft E', v = 'draft', v);
  v := pg_temp.ask('hbt5-e', 'Please fix <b>the</b> intro.');
  perform pg_temp.chk('request changes: the result names who is emailed', v = lower(adm), v);
  perform pg_temp.chk('request changes: one email to the creator', pg_temp.asks('hbt5-e', adm) = 1, pg_temp.asks('hbt5-e', adm)::text);
  perform pg_temp.chk('request changes: nobody else is emailed', pg_temp.asks('hbt5-e') = 1, pg_temp.asks('hbt5-e')::text);
  select * into r from notification_outbox
   where kind = 'handbook_changes_requested' and processed_at is null and ref_id = pg_temp.pid('hbt5-e')::text limit 1;
  perform pg_temp.chk('the email row carries the note, title, link and who asked',
    r.payload ->> 'note' = 'Please fix <b>the</b> intro.' and r.payload ->> 'policy_title' = 'Tweaks test E'
    and r.payload ->> 'policy_slug' = 'hbt5-e' and r.payload ->> 'link' = '#/hr/handbook?item=handbook:hbt5-e'
    and r.payload ->> 'by_email' = lower(ap) and r.client_id is null and not (r.payload ? 'body_md'),
    r.payload::text);
  perform pg_temp.chk('the audit row records who was emailed',
    exists (select 1 from audit_log where action = 'handbook.policy_changes_requested'
            and target_id = pg_temp.pid('hbt5-e')::text and details ->> 'emailed' = lower(adm)));
  -- A second request: a second email (no batching).
  v := pg_temp.ask('hbt5-e', 'One more thing.');
  perform pg_temp.chk('a second request sends a second email', pg_temp.asks('hbt5-e', adm) = 2, pg_temp.asks('hbt5-e', adm)::text);

  -- adm2 edits the text: now adm2 is the last editor.
  v := pg_temp.probe(adm2, format($q$select hb_publish_version(%L, 'Text E v2', false, 'Fixed') ->> 'version_no'$q$, pg_temp.pid('hbt5-e')));
  perform pg_temp.chk('setup: adm2 edits the text (version 2)', v = '2', v);
  v := pg_temp.ask('hbt5-e', 'Still not right.');
  perform pg_temp.chk('the latest text editor is emailed', v = lower(adm2) and pg_temp.asks('hbt5-e', adm2) = 1, v);
  perform pg_temp.chk('the creator gets no new email', pg_temp.asks('hbt5-e', adm) = 2, pg_temp.asks('hbt5-e', adm)::text);

  -- adm changes the title afterwards: adm is the last editor. (Everything in
  -- this transaction has the same now(), so the audit row is moved a minute
  -- later to stand for "afterwards"; rolled back.)
  v := pg_temp.probe(adm, format($q$select hb_update_policy(%L, 'Tweaks test E renamed', 'Test', null) ->> 'title'$q$, pg_temp.pid('hbt5-e')));
  update audit_log set at = now() + interval '1 minute'
   where action = 'handbook.policy_updated' and target_id = pg_temp.pid('hbt5-e')::text;
  v := pg_temp.ask('hbt5-e', 'Better title, now the text.');
  perform pg_temp.chk('a later title change makes that admin the last editor', v = lower(adm), v);
  -- An order-only change doesn't count as an edit.
  v := pg_temp.probe(adm2, format($q$select hb_update_policy(%L, 'Tweaks test E renamed', 'Test', 555) ->> 'sort'$q$, pg_temp.pid('hbt5-e')));
  update audit_log set at = now() + interval '2 minutes'
   where action = 'handbook.policy_updated' and target_id = pg_temp.pid('hbt5-e')::text and actor_email = lower(adm2);
  v := pg_temp.ask('hbt5-e', 'Order is fine.');
  perform pg_temp.chk('changing only the order is not an edit', v = lower(adm), v);

  -- The approver's own edit: nobody is emailed.
  v := pg_temp.probe(adm, $q$select hb_create_policy('Tweaks test F', 'hbt5-f', null, 'Test', 'Text F') ->> 'status'$q$);
  v := pg_temp.probe(ap, format($q$select hb_publish_version(%L, 'Text F by the approver', false, 'Mine') ->> 'version_no'$q$, pg_temp.pid('hbt5-f')));
  perform pg_temp.chk('setup: the approver edits draft F', v = '2', v);
  v := pg_temp.ask('hbt5-f', 'Note to self.');
  perform pg_temp.chk('the approver''s own edit: nobody is emailed', v = 'null' and pg_temp.asks('hbt5-f') = 0, v);
  perform pg_temp.chk('the approver''s own edit: the request still worked',
    (select approval_status from handbook_policies where slug = 'hbt5-f') = 'changes_requested');

  -- Make this a signed policy counts as an edit.
  v := pg_temp.probe(ap, format($q$select hb_approve_policy(%L, (select id from handbook_versions where policy_id = %L order by version_no desc limit 1)) ->> 'approval_status'$q$,
                                pg_temp.pid('hbt5-f'), pg_temp.pid('hbt5-f')));
  v := pg_temp.probe(adm2, format($q$select hb_convert_to_signed(%L, null, 'Needs signing', true) ->> 'version_no'$q$, pg_temp.pid('hbt5-f')));
  perform pg_temp.chk('setup: adm2 converts the approved draft F', v = '3', v);
  v := pg_temp.ask('hbt5-f', 'Check the signing wording.');
  perform pg_temp.chk('the admin who converted it is emailed', v = lower(adm2) and pg_temp.asks('hbt5-f', adm2) = 1, v);

  -- 'system' (the seed) and non-admin authors are never emailed.
  v := pg_temp.owner($q$
    with p as (
      insert into handbook_policies (slug, title, sort, kind, status, section, published_at)
      values ('hbt5-seed', 'Seed', 1, 'reference', 'draft', 'Employee Handbook', null)
      on conflict (slug) do nothing returning id)
    insert into handbook_versions (policy_id, version_no, body_md, body_sha256, requires_resign, change_note, published_by)
    select id, 1, 'Seed text', encode(sha256(convert_to('Seed text', 'UTF8')), 'hex'), false, 'First draft.', 'system' from p
    returning 'ok'$q$);
  perform pg_temp.chk('setup: a seed-style draft', v = 'ok', v);
  v := pg_temp.ask('hbt5-seed', 'Fill in the TBDs.');
  perform pg_temp.chk('a seeded draft (system): nobody is emailed', v = 'null' and pg_temp.asks('hbt5-seed') = 0, v);
  v := pg_temp.owner(format($q$insert into handbook_versions (policy_id, version_no, body_md, body_sha256, requires_resign, change_note, published_by)
                               values (%L, 2, 'BK text', encode(sha256(convert_to('BK text', 'UTF8')), 'hex'), false, 'x', %L) returning 'ok'$q$,
                            pg_temp.pid('hbt5-seed'), lower(bk)));
  v := pg_temp.ask('hbt5-seed', 'Again.');
  perform pg_temp.chk('a last editor who is not an active admin: nobody is emailed', v = 'null' and pg_temp.asks('hbt5-seed') = 0, v);

  -- Who can still ask for changes is unchanged.
  v := pg_temp.probe(adm, format($q$select hb_request_changes(%L, 'No')$q$, pg_temp.pid('hbt5-e')));
  perform pg_temp.chk('a non-approver admin still cannot request changes', v like 'ERR:42501%', v);
  v := pg_temp.probe(bk, format($q$select hb_request_changes(%L, 'No')$q$, pg_temp.pid('hbt5-e')));
  perform pg_temp.chk('a bookkeeper still cannot request changes', v like 'ERR:42501%', v);

  -- Internal helpers are not callable from the API.
  v := pg_temp.probe(adm, format($q$select hb_last_editor(%L)$q$, pg_temp.pid('hbt5-e')));
  perform pg_temp.chk('hb_last_editor is not callable by users', v like 'ERR:42501%', v);
  v := pg_temp.probe(adm, format($q$select hb_can_change_approver(%L)::text$q$, adm));
  perform pg_temp.chk('hb_can_change_approver is not callable by users', v like 'ERR:42501%', v);

  -- ---------------------------------------------------------------- SLA
  select * into sla from handbook_policies where slug = 'flexible-work-sla';
  select max(version_no) into sla_v from handbook_versions where policy_id = sla.id;
  perform pg_temp.chk('SLA: still signed, published, approval not required',
    sla.kind = 'signed' and sla.status = 'published' and sla.approval_status = 'not_required', sla.approval_status);
  v := pg_temp.probe(ap, format($q$select hb_request_changes(%L, 'x')$q$, sla.id));
  perform pg_temp.chk('SLA: request changes is refused on a published policy', v like 'ERR:%published%', v);
  perform pg_temp.chk('SLA: no email queued for it',
    not exists (select 1 from notification_outbox where kind = 'handbook_changes_requested' and ref_id = sla.id::text));
end $$;

do $$
declare bad text;
begin
  select string_agg(name || coalesce(' [' || detail || ']', ''), E'\n  ') into bad from _hbk where not ok;
  if bad is not null then
    raise exception E'staff-handbook-5-approver-tweaks tests FAILED:\n  %', bad;
  end if;
  raise notice 'staff-handbook-5-approver-tweaks tests: all % passed', (select count(*) from _hbk);
end $$;

rollback;
