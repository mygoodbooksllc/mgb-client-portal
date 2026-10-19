-- Employee records: rule checks.
-- NOT a migration. Run AFTER staff-hr-records.sql has been applied, in the
-- Supabase SQL editor (or psql as postgres). Everything runs in one
-- transaction that ends in ROLLBACK, so no record, profile change, audit row
-- or offboarding survives. A failing check is collected; the run ends by
-- raising 'staff-hr-records tests FAILED: ...' listing every failure, or with
-- the notice '... all N passed'.
--
-- Personas are picked from the live staff table by role (no emails here):
--   adm  an active admin
--   bk   an active bookkeeper (the record under test)
--   bk2  another active bookkeeper, if there is one (offboarding check)
-- A temporary admin is simulated by giving bk a live staff_temp_admin_access
-- row inside the transaction.

begin;

create temp table _hrk (n serial, name text, ok boolean, detail text);
create temp table _who (k text primary key, email text);

create or replace function pg_temp.chk(p_name text, p_ok boolean, p_detail text default null)
returns void language plpgsql as $$
begin
  insert into _hrk(name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail);
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

insert into _who select 'adm', min(email) from staff where role = 'admin' and active;
insert into _who select 'bk', min(email) from staff where role = 'bookkeeper' and active;
insert into _who select 'bk2', min(email) from staff
  where role = 'bookkeeper' and active and email > (select email from _who where k = 'bk');

do $$
declare
  adm text := (select email from _who where k = 'adm');
  bk text := (select email from _who where k = 'bk');
  bk2 text := (select email from _who where k = 'bk2');
  v text;
  n_audit int;
  v_start date;
begin
  perform pg_temp.chk('personas found', adm is not null and bk is not null, 'adm=' || coalesce(adm, '-') || ' bk=' || coalesce(bk, '-'));

  -- No direct table access for anyone signed in, admins included.
  v := pg_temp.probe(bk, 'select count(*) from staff_hr_records');
  perform pg_temp.chk('bookkeeper cannot select the table', v like 'ERR:42501%', v);
  v := pg_temp.probe(adm, 'select count(*) from staff_hr_records');
  perform pg_temp.chk('admin cannot select the table directly either', v like 'ERR:42501%', v);
  v := pg_temp.probe(null, 'select count(*) from staff_hr_records');
  perform pg_temp.chk('anon cannot select the table', v like 'ERR:42501%', v);
  v := pg_temp.probe(adm, format($q$insert into staff_hr_records (staff_email) values (%L) returning staff_email$q$, bk));
  perform pg_temp.chk('admin cannot insert directly', v like 'ERR:42501%', v);

  -- RPCs: bookkeepers, anon and internal helpers are refused.
  v := pg_temp.probe(bk, 'select hr_list_records()::text');
  perform pg_temp.chk('bookkeeper cannot list', v like 'ERR:42501%', v);
  v := pg_temp.probe(bk, format('select hr_get_record(%L)::text', bk));
  perform pg_temp.chk('bookkeeper cannot read even their own record', v like 'ERR:42501%', v);
  v := pg_temp.probe(bk, format($q$select hr_save_record(%L, '{"job_title":"x"}')::text$q$, bk));
  perform pg_temp.chk('bookkeeper cannot save', v like 'ERR:42501%', v);
  v := pg_temp.probe(null, 'select hr_list_records()::text');
  perform pg_temp.chk('anon cannot list', v like 'ERR:42501%', v);
  v := pg_temp.probe(adm, 'select hr_require_admin()::text');
  perform pg_temp.chk('helper not callable from the browser', v like 'ERR:42501%', v);

  -- A temporary admin is still a bookkeeper: refused.
  insert into staff_temp_admin_access (staff_email, expires_at) values (bk, now() + interval '1 day');
  v := pg_temp.probe(bk, 'select hr_list_records()::text');
  perform pg_temp.chk('temporary admin cannot list', v like 'ERR:42501%', v);
  v := pg_temp.probe(bk, format('select hr_get_record(%L)::text', adm));
  perform pg_temp.chk('temporary admin cannot read', v like 'ERR:42501%', v);
  delete from staff_temp_admin_access where staff_email = bk and expires_at > now() + interval '23 hours';

  -- Admin: list, save, read; each view and save is audited.
  v := pg_temp.probe(adm, format($q$select e ->> 'has_record' from jsonb_array_elements(hr_list_records()) e where e ->> 'email' = %L$q$, bk));
  perform pg_temp.chk('admin list shows "no record yet"', v = 'false', v);
  v := pg_temp.probe(adm, $q$select count(*) from jsonb_array_elements(hr_list_records()) e
                             where e ? 'personal_phone' or e ? 'address' or e ? 'notes' or e ? 'personal_email'$q$);
  perform pg_temp.chk('list never carries personal details', v = '0', v);

  v := pg_temp.probe(adm, format($q$select hr_save_record(%L, '{"job_title":"x","salary":"1"}')::text$q$, bk));
  perform pg_temp.chk('unknown field refused', v like 'ERR:%Unknown field%', v);
  v := pg_temp.probe(adm, format($q$select hr_save_record(%L, '{"hire_date":"not a date"}')::text$q$, bk));
  perform pg_temp.chk('bad date refused', v like 'ERR:%YYYY-MM-DD%', v);
  v := pg_temp.probe(adm, format($q$select hr_save_record(%L, jsonb_build_object('manager_email', %L))::text$q$, bk, bk));
  perform pg_temp.chk('own manager refused', v like 'ERR:%own manager%', v);
  v := pg_temp.probe(adm, format($q$select hr_save_record(%L, '{"personal_phone":"call me"}')::text$q$, bk));
  perform pg_temp.chk('bad phone refused', v like 'ERR:%phone%', v);

  select start_date into v_start from staff_profiles where email = bk;
  v := pg_temp.probe(adm, format($q$select hr_save_record(%L, jsonb_build_object(
          'legal_name', 'Test Legal Name', 'job_title', 'Bookkeeper', 'employment_type', 'w2_employee',
          'schedule', 'full_time', 'manager_email', %L, 'hire_date', '2020-02-03',
          'personal_phone', '(555) 010-0000')) ->> 'created'$q$, bk, adm));
  perform pg_temp.chk('admin creates a record', v = 'true', v);
  perform pg_temp.chk('save is audited with field names only',
    exists (select 1 from audit_log where action = 'hr.record_saved' and target_id = bk
              and details -> 'fields' ? 'job_title' and details::text not like '%Test Legal Name%'));
  perform pg_temp.chk('hire date copied to the profile start date',
    (select start_date from staff_profiles where email = bk) = date '2020-02-03');

  v := pg_temp.probe(adm, format($q$select hr_save_record(%L, '{"job_title":"Bookkeeper"}') -> 'changed'$q$, bk));
  perform pg_temp.chk('saving the same value changes nothing', v = '[]', v);
  v := pg_temp.probe(adm, format($q$select hr_save_record(%L, '{"hire_date":""}') -> 'record' ->> 'hire_date'$q$, bk));
  perform pg_temp.chk('empty string clears a field', v = 'null', v);
  perform pg_temp.chk('clearing the hire date keeps the profile start date',
    (select start_date from staff_profiles where email = bk) = date '2020-02-03');
  v := pg_temp.probe(adm, format($q$select hr_save_record(%L, '{"hire_date":"2020-02-03"}') ->> 'created'$q$, bk));
  perform pg_temp.chk('update is not a create', v = 'false', v);

  select count(*) into n_audit from audit_log where action = 'hr.record_viewed' and target_id = bk;
  v := pg_temp.probe(adm, format($q$select hr_get_record(%L) -> 'record' ->> 'legal_name'$q$, bk));
  perform pg_temp.chk('admin reads the full record', v = 'Test Legal Name', v);
  perform pg_temp.chk('opening a record is audited',
    (select count(*) from audit_log where action = 'hr.record_viewed' and target_id = bk) = n_audit + 1);
  v := pg_temp.probe(adm, format($q$select e -> 'filled' ->> 'legal_name' from jsonb_array_elements(hr_list_records()) e where e ->> 'email' = %L$q$, bk));
  perform pg_temp.chk('list shows completeness', v = 'true', v);

  -- Offboarding sets the end date when there is a record without one.
  if bk2 is not null then
    v := pg_temp.probe(adm, format($q$select hr_save_record(%L, '{"job_title":"Bookkeeper","hire_date":"2021-01-04"}') ->> 'created'$q$, bk2));
    v := pg_temp.probe(adm, format($q$select offboard_staff(%L, '{}'::jsonb)::text$q$, bk2));
    perform pg_temp.chk('offboarding runs', v not like 'ERR:%', v);
    v := pg_temp.probe(adm, format($q$select hr_get_record(%L) -> 'record' ->> 'end_date'$q$, bk2));
    perform pg_temp.chk('offboarding sets the end date to today',
      v = ((now() at time zone 'America/Chicago')::date)::text, v);
  else
    perform pg_temp.chk('offboarding check skipped (only one active bookkeeper)', true);
  end if;
end $$;

do $$
declare bad text;
begin
  select string_agg(name || coalesce(' [' || detail || ']', ''), E'\n  ') into bad from _hrk where not ok;
  if bad is not null then
    raise exception E'staff-hr-records tests FAILED:\n  %', bad;
  end if;
  raise notice 'staff-hr-records tests: all % passed', (select count(*) from _hrk);
end $$;

rollback;
