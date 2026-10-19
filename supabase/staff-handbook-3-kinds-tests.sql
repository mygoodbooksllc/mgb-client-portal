-- Staff Handbook part 3 (policy kinds, drafts): rule checks.
-- NOT a migration. Run AFTER staff-handbook-3-kinds.sql has been applied, in
-- the Supabase SQL editor (or psql as postgres). Everything runs in one
-- transaction that ends in ROLLBACK, so no fixture, email row or audit row
-- survives. A failing check is collected; the run ends by raising
-- 'staff-handbook-3-kinds tests FAILED: ...' listing every failure, or with
-- the notice '... all N passed'.
--
-- Personas are picked from the live staff table by role (no emails here):
--   adm  an active admin
--   bk   an active bookkeeper
-- Fixtures: two throwaway policies, slugs hbt-ref and hbt-signed.

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
    v := 'ERR:' || sqlstate || ':' || left(sqlerrm, 120);
  end;
  reset role;
  perform pg_temp.claims(null);
  return v;
end $$;

-- Same, as the table owner (no RLS, no grants): checks the table rules.
create or replace function pg_temp.owner(p_sql text)
returns text language plpgsql as $$
declare v text;
begin
  begin
    execute p_sql into v;
    v := coalesce(v, 'null');
  exception when others then
    v := 'ERR:' || sqlstate || ':' || left(sqlerrm, 120);
  end;
  return v;
end $$;

insert into _who select 'adm', min(email) from staff where role = 'admin' and active;
insert into _who select 'bk', min(email) from staff where role = 'bookkeeper' and active;

do $$
declare
  adm text := (select email from _who where k = 'adm');
  bk text := (select email from _who where k = 'bk');
  n_bk int := (select count(*) from staff where role = 'bookkeeper' and active);
  v text;
  v_badge0 text;
  v_ref uuid;
  v_sig uuid;
  v_ver uuid;
  sla handbook_policies;
  sla_v1 handbook_versions;
begin
  perform pg_temp.chk('personas found', adm is not null and bk is not null, 'adm=' || coalesce(adm, '-') || ' bk=' || coalesce(bk, '-'));

  -- The seeded SLA policy is unchanged: still signed, published, no section,
  -- live from (at or before) its first version, so due dates don't move.
  select * into sla from handbook_policies where slug = 'flexible-work-sla';
  select * into sla_v1 from handbook_versions where policy_id = sla.id and version_no = 1;
  perform pg_temp.chk('SLA: signed and published', sla.kind = 'signed' and sla.status = 'published');
  perform pg_temp.chk('SLA: no section', sla.section is null);
  perform pg_temp.chk('SLA: published_at <= v1 published_at', sla.published_at <= sla_v1.published_at);
  perform pg_temp.chk('SLA: v1 still needs signing', sla_v1.requires_resign);
  v := pg_temp.probe(bk, $q$select (select e -> 'my' ->> 'state' from jsonb_array_elements(hb_status() -> 'policies') e
                               where e ->> 'slug' = 'flexible-work-sla')$q$);
  perform pg_temp.chk('SLA: bookkeeper still has a signing state', v in ('not_signed', 'overdue', 'awaiting_countersign', 'signed'), v);
  v := pg_temp.probe(adm, $q$select count(*) from jsonb_array_elements(hb_status() -> 'grid') e
                             where e ->> 'policy_slug' = 'flexible-work-sla'$q$);
  perform pg_temp.chk('SLA: still in the admin grid', v = n_bk::text, v);
  v_badge0 := pg_temp.probe(bk, 'select hb_status() ->> ''badge''');

  -- Creating: admins only.
  v := pg_temp.probe(bk, $q$select hb_create_policy('T', 'hbt-bk', 'reference', null, 'x')$q$);
  perform pg_temp.chk('non-admin cannot create', v like 'ERR:42501%', v);
  v := pg_temp.probe(null, $q$select hb_create_policy('T', 'hbt-anon', 'reference', null, 'x')$q$);
  perform pg_temp.chk('anon cannot create', v like 'ERR:42501%', v);
  v := pg_temp.probe(adm, $q$select hb_create_policy('T', 'Bad Slug', 'reference', null, 'x')$q$);
  perform pg_temp.chk('bad slug refused', v like 'ERR:%', v);
  v := pg_temp.probe(adm, $q$select hb_create_policy('Test reference', 'hbt-ref', 'reference', 'Test section', 'Hello')->>'status'$q$);
  perform pg_temp.chk('admin creates a reference draft', v = 'draft', v);
  v := pg_temp.probe(adm, $q$select hb_create_policy('Again', 'hbt-ref', 'reference', null, 'x')$q$);
  perform pg_temp.chk('duplicate slug refused', v like 'ERR:%', v);
  select id into v_ref from handbook_policies where slug = 'hbt-ref';
  select id into v_ver from handbook_versions where policy_id = v_ref and version_no = 1;
  perform pg_temp.chk('reference v1 does not need signing',
    not (select requires_resign from handbook_versions where id = v_ver));
  perform pg_temp.chk('creating emails nobody',
    not exists (select 1 from notification_outbox where payload ->> 'policy_slug' = 'hbt-ref'));
  perform pg_temp.chk('creating is audited',
    exists (select 1 from audit_log where action = 'handbook.policy_created' and target_id = v_ref::text));

  -- Staff can't see drafts: not in hb_status, not by slug, not by table.
  v := pg_temp.probe(bk, $q$select count(*) from jsonb_array_elements(hb_status() -> 'policies') e where e ->> 'slug' = 'hbt-ref'$q$);
  perform pg_temp.chk('staff: draft not in hb_status', v = '0', v);
  v := pg_temp.probe(bk, $q$select hb_get_policy('hbt-ref') ->> 'policy'$q$);
  perform pg_temp.chk('staff: draft not found by slug', v like 'ERR:%not found%', v);
  v := pg_temp.probe(bk, $q$select count(*) from handbook_policies where slug = 'hbt-ref'$q$);
  perform pg_temp.chk('staff: draft row hidden (RLS)', v = '0', v);
  v := pg_temp.probe(bk, format($q$select count(*) from handbook_versions where policy_id = %L$q$, v_ref));
  perform pg_temp.chk('staff: draft versions hidden (RLS)', v = '0', v);
  v := pg_temp.probe(adm, $q$select count(*) from jsonb_array_elements(hb_status() -> 'policies') e where e ->> 'slug' = 'hbt-ref'$q$);
  perform pg_temp.chk('admin: draft in hb_status', v = '1', v);
  v := pg_temp.probe(adm, $q$select hb_get_policy('hbt-ref') -> 'policy' ->> 'status'$q$);
  perform pg_temp.chk('admin: draft opens', v = 'draft', v);

  -- Draft states can't be faked from the table side.
  v := pg_temp.owner(format($q$update handbook_policies set kind = 'signed' where id = %L returning kind$q$, v_ref));
  perform pg_temp.chk('reference -> signed only through the RPC', v like 'ERR:42501%', v);

  -- Publish the reference policy: nobody is emailed, nothing to sign.
  v := pg_temp.probe(bk, format($q$select hb_publish_policy(%L)$q$, v_ref));
  perform pg_temp.chk('non-admin cannot publish', v like 'ERR:42501%', v);
  v := pg_temp.probe(adm, format($q$select hb_publish_policy(%L) ->> 'notified'$q$, v_ref));
  perform pg_temp.chk('publishing a reference policy notifies nobody', v = '0', v);
  perform pg_temp.chk('publishing is audited',
    exists (select 1 from audit_log where action = 'handbook.policy_published' and target_id = v_ref::text));
  v := pg_temp.owner(format($q$update handbook_policies set status = 'draft', published_at = null where id = %L returning status$q$, v_ref));
  perform pg_temp.chk('published never goes back to draft', v like 'ERR:42501%', v);
  v := pg_temp.probe(bk, $q$select (select coalesce(e -> 'my', 'null'::jsonb)::text from jsonb_array_elements(hb_status() -> 'policies') e
                               where e ->> 'slug' = 'hbt-ref')$q$);
  perform pg_temp.chk('staff: reference listed with no signing state', v = 'null', v);
  v := pg_temp.probe(bk, 'select hb_status() ->> ''badge''');
  perform pg_temp.chk('staff: badge unchanged by a reference policy', v = v_badge0, v || ' vs ' || v_badge0);
  v := pg_temp.probe(adm, $q$select count(*) from jsonb_array_elements(hb_status() -> 'grid') e where e ->> 'policy_slug' = 'hbt-ref'$q$);
  perform pg_temp.chk('admin grid leaves reference out', v = '0', v);

  -- Nobody signs a reference policy.
  v := pg_temp.probe(bk, format($q$select hb_sign(%L, 'x', true)$q$, v_ver));
  perform pg_temp.chk('staff cannot sign a reference policy', v like 'ERR:%', v);
  v := pg_temp.owner(format($q$insert into handbook_signatures (version_id, staff_email, typed_name, ack_text, body_sha256)
                               values (%L, %L, 'Test Name', 'x', repeat('0', 64)) returning id$q$, v_ver, bk));
  perform pg_temp.chk('table refuses a signature on a reference policy', v like 'ERR:42501%', v);

  -- Reference versions never need re-signing and never email.
  v := pg_temp.probe(adm, format($q$select hb_publish_version(%L, 'Hello again', true, 'x')$q$, v_ref));
  perform pg_temp.chk('reference publish with re-sign refused', v like 'ERR:%', v);
  v := pg_temp.probe(adm, format($q$select hb_publish_version(%L, 'Hello again', false, 'Typo') ->> 'requires_resign'$q$, v_ref));
  perform pg_temp.chk('reference publish is a plain new version', v = 'false', v);
  perform pg_temp.chk('reference publish emails nobody',
    not exists (select 1 from notification_outbox where payload ->> 'policy_slug' = 'hbt-ref'));

  -- Title / section / order: admins only, audited.
  v := pg_temp.probe(bk, format($q$select hb_update_policy(%L, 'X', null, null)$q$, v_ref));
  perform pg_temp.chk('non-admin cannot edit details', v like 'ERR:42501%', v);
  v := pg_temp.probe(adm, format($q$select hb_update_policy(%L, 'Test reference 2', 'Other', 5) ->> 'section'$q$, v_ref));
  perform pg_temp.chk('admin edits details', v = 'Other', v);
  perform pg_temp.chk('detail edit is audited',
    exists (select 1 from audit_log where action = 'handbook.policy_updated' and target_id = v_ref::text));

  -- Reference -> signed: explicit confirm, admins only, new version that
  -- needs signing, one email per active bookkeeper.
  v := pg_temp.probe(bk, format($q$select hb_convert_to_signed(%L, null, 'Now signed', true)$q$, v_ref));
  perform pg_temp.chk('non-admin cannot convert', v like 'ERR:42501%', v);
  v := pg_temp.probe(adm, format($q$select hb_convert_to_signed(%L, null, 'Now signed', false)$q$, v_ref));
  perform pg_temp.chk('convert needs confirm', v like 'ERR:%', v);
  v := pg_temp.probe(adm, format($q$select hb_convert_to_signed(%L, null, 'Now signed', true) ->> 'notified'$q$, v_ref));
  perform pg_temp.chk('convert asks every active bookkeeper', v = n_bk::text, v);
  perform pg_temp.chk('converted policy is signed', (select kind from handbook_policies where id = v_ref) = 'signed');
  perform pg_temp.chk('convert is audited',
    exists (select 1 from audit_log where action = 'handbook.policy_converted' and target_id = v_ref::text));
  v := pg_temp.owner(format($q$update handbook_policies set kind = 'reference' where id = %L returning kind$q$, v_ref));
  perform pg_temp.chk('signed never goes back to reference', v like 'ERR:42501%', v);
  v := pg_temp.probe(bk, $q$select (select e -> 'my' ->> 'state' from jsonb_array_elements(hb_status() -> 'policies') e
                               where e ->> 'slug' = 'hbt-ref')$q$);
  perform pg_temp.chk('converted policy now asks the bookkeeper to sign', v in ('not_signed', 'overdue'), v);

  -- A signed draft: hidden and quiet until published, then emails.
  v := pg_temp.probe(adm, $q$select hb_create_policy('Test signed', 'hbt-signed', 'signed', null, 'Sign me') ->> 'kind'$q$);
  perform pg_temp.chk('admin creates a signed draft', v = 'signed', v);
  perform pg_temp.chk('signed v1 needs signing',
    (select v1.requires_resign from handbook_versions v1 join handbook_policies p on p.id = v1.policy_id
     where p.slug = 'hbt-signed' and v1.version_no = 1));
  perform pg_temp.chk('signed draft emails nobody',
    not exists (select 1 from notification_outbox where payload ->> 'policy_slug' = 'hbt-signed'));
  v := pg_temp.probe(bk, $q$select count(*) from jsonb_array_elements(hb_status() -> 'policies') e where e ->> 'slug' = 'hbt-signed'$q$);
  perform pg_temp.chk('staff: signed draft not in hb_status', v = '0', v);
  v := pg_temp.probe(adm, $q$select count(*) from jsonb_array_elements(hb_status() -> 'grid') e where e ->> 'policy_slug' = 'hbt-signed'$q$);
  perform pg_temp.chk('admin grid leaves drafts out', v = '0', v);
  select v1.id into v_ver from handbook_versions v1 join handbook_policies p on p.id = v1.policy_id where p.slug = 'hbt-signed';
  v := pg_temp.probe(bk, format($q$select hb_sign(%L, 'x', true)$q$, v_ver));
  perform pg_temp.chk('staff cannot sign a draft', v like 'ERR:%', v);
  v := pg_temp.probe(adm, $q$select hb_publish_policy((select id from handbook_policies where slug = 'hbt-signed')) ->> 'notified'$q$);
  perform pg_temp.chk('publishing a signed policy asks every active bookkeeper', v = n_bk::text, v);
end $$;

do $$
declare bad text;
begin
  select string_agg(name || coalesce(' [' || detail || ']', ''), E'\n  ') into bad from _hbk where not ok;
  if bad is not null then
    raise exception E'staff-handbook-3-kinds tests FAILED:\n  %', bad;
  end if;
  raise notice 'staff-handbook-3-kinds tests: all % passed', (select count(*) from _hbk);
end $$;

rollback;
