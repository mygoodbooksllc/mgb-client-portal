-- Employee records: one admin-only HR record per staff member (Team ›
-- Employee records). Safe to re-run. Flat file; every function pins
-- search_path = public. NOT applied to production yet.
--
-- Depends on:
--   * public.staff (email unique, lower-case; role; active; name)
--   * public.staff_profiles (user-settings.sql) with start_date
--     (staff-celebrations-performance.sql) and the latest
--     staff_profiles_guard (staff-photo.sql)
--   * is_active_staff_admin() (staff-admin-policies.sql): role 'admin' and
--     active. Temporary admins are bookkeepers and fail it.
--   * audit_write(text, text, text, text, jsonb) (audit-log.sql)
--   * offboard_staff(text, jsonb) (staff-offboarding.sql), patched in place
--     below. If staff-offboarding.sql is re-run, re-run this file after it.
--
-- What it holds
--   staff_hr_records   one row per staff member, keyed by staff email (follows
--                      an email change, like staff_profiles): legal name, job
--                      title, employment type, schedule, manager, hire and end
--                      dates, work location, personal contact details,
--                      emergency contact, notes. Never pay, government IDs or
--                      bank details.
--
-- Rules
--   * Admins only. Nobody (not even an admin) reads or writes the table
--     directly: no grants to anon / authenticated, and RLS (admins only) as a
--     second lock. Everything goes through the hr_* RPCs below, so every
--     opened record is in the audit log.
--       hr_list_records()           every staff member with the list columns
--                                   only (name, title, type, schedule, manager,
--                                   hire date, end date, status) plus which
--                                   fields are filled in (true / false, never
--                                   the values). Audits hr.list_viewed (the
--                                   row count only).
--       hr_get_record(email)        the full record. Audits hr.record_viewed.
--       hr_save_record(email, rec)  creates or updates it. Audits
--                                   hr.record_saved with the changed field
--                                   names only (never the values).
--   * hr_save_record copies a hire date into staff_profiles.start_date (the
--     date work anniversaries use). It never clears start_date.
--   * offboard_staff sets end_date to today (America/Chicago) when the person
--     has a record with no end date (and no future hire date), and audits
--     hr.end_date_set (field name only). It never overwrites an end date an
--     admin already entered. The file ends by checking the live offboard_staff
--     really has the patch, and fails (rolling everything back) if not.
--   * Bookkeepers, temporary admins, "View as" and portal clients have no read
--     path: every RPC checks role = 'admin' on the signed-in staff row and
--     is_active_staff_admin() on the JWT, and "View as" never changes the JWT.
--
-- Checks: supabase/staff-hr-records-tests.sql (one transaction, ends in
-- ROLLBACK): a bookkeeper can't select the table or call any RPC, anon can't,
-- an admin's view and save are each audited, offboarding sets the end date.

begin;

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
create table if not exists public.staff_hr_records (
  staff_email text primary key references public.staff(email) on update cascade,
  legal_name text check (legal_name is null or char_length(btrim(legal_name)) between 1 and 200),
  job_title text check (job_title is null or char_length(btrim(job_title)) between 1 and 120),
  employment_type text check (employment_type is null or employment_type in ('w2_employee', 'contractor')),
  schedule text check (schedule is null or schedule in ('full_time', 'part_time')),
  manager_email text references public.staff(email) on update cascade on delete set null,
  hire_date date check (hire_date is null or hire_date >= date '1950-01-01'),
  end_date date,
  work_location text check (work_location is null or char_length(btrim(work_location)) between 1 and 200),
  personal_email text check (personal_email is null
                             or (char_length(personal_email) <= 254 and personal_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  personal_phone text check (personal_phone is null or personal_phone ~ '^[0-9+(). x-]{7,40}$'),
  address text check (address is null or char_length(btrim(address)) between 1 and 500),
  emergency_contact_name text check (emergency_contact_name is null
                                     or char_length(btrim(emergency_contact_name)) between 1 and 200),
  emergency_contact_relationship text check (emergency_contact_relationship is null
                                             or char_length(btrim(emergency_contact_relationship)) between 1 and 80),
  emergency_contact_phone text check (emergency_contact_phone is null or emergency_contact_phone ~ '^[0-9+(). x-]{7,40}$'),
  notes text check (notes is null or char_length(notes) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text check (updated_by is null or updated_by = lower(updated_by)),
  check (staff_email = lower(staff_email)),
  check (manager_email is null or manager_email = lower(manager_email)),
  check (manager_email is null or manager_email <> staff_email),
  check (end_date is null or hire_date is null or end_date >= hire_date)
);
create index if not exists staff_hr_records_manager_idx on public.staff_hr_records (manager_email);

alter table public.staff_hr_records enable row level security;
revoke all on public.staff_hr_records from public, anon, authenticated;

drop policy if exists hr_records_admin_read on public.staff_hr_records;
create policy hr_records_admin_read on public.staff_hr_records for select to authenticated
  using (public.is_active_staff_admin());

-- ---------------------------------------------------------------------------
-- Helpers (internal)
-- ---------------------------------------------------------------------------
-- The signed-in admin's staff row, or an error. role = 'admin' on the row and
-- is_active_staff_admin() on the JWT, so a temporary admin is refused.
create or replace function public.hr_require_admin()
returns public.staff language plpgsql stable security definer set search_path = public as $$
declare me staff;
begin
  select * into me from staff
  where lower(email) = lower(auth.jwt() ->> 'email') and active = true limit 1;
  if me.id is null or me.role <> 'admin' or not coalesce(is_active_staff_admin(), false) then
    raise exception 'Employee records are for admins only.' using errcode = '42501';
  end if;
  return me;
end $$;

-- Which fields are filled in (never the values). The list and the detail use
-- the same keys; HR_logic.js HR_FIELDS mirrors them.
create or replace function public.hr_filled(r public.staff_hr_records)
returns jsonb language sql immutable set search_path = public as $$
  select jsonb_build_object(
    'legal_name', r.legal_name is not null,
    'job_title', r.job_title is not null,
    'employment_type', r.employment_type is not null,
    'schedule', r.schedule is not null,
    'manager_email', r.manager_email is not null,
    'hire_date', r.hire_date is not null,
    'work_location', r.work_location is not null,
    'personal_email', r.personal_email is not null,
    'personal_phone', r.personal_phone is not null,
    'address', r.address is not null,
    'emergency_contact_name', r.emergency_contact_name is not null,
    'emergency_contact_relationship', r.emergency_contact_relationship is not null,
    'emergency_contact_phone', r.emergency_contact_phone is not null);
$$;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------
-- Every staff member (active first), list columns only.
create or replace function public.hr_list_records()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me staff := hr_require_admin();
  v jsonb;
begin
  v := coalesce((
    select jsonb_agg(jsonb_build_object(
        'email', lower(s.email), 'name', s.name, 'role', s.role, 'active', s.active,
        'has_record', r.staff_email is not null,
        'job_title', r.job_title, 'employment_type', r.employment_type, 'schedule', r.schedule,
        'manager_email', r.manager_email, 'manager_name', m.name,
        'hire_date', r.hire_date, 'end_date', r.end_date,
        'filled', case when r.staff_email is null then null else hr_filled(r) end,
        'updated_at', r.updated_at)
      order by s.active desc, s.name)
    from staff s
    left join staff_hr_records r on r.staff_email = lower(s.email)
    left join staff m on lower(m.email) = r.manager_email), '[]'::jsonb);
  -- Who opened the list and how many rows it held; never any values.
  perform audit_write('hr.list_viewed', null, 'staff', null, jsonb_build_object('rows', jsonb_array_length(v)));
  return v;
end $$;

-- One full record. Opening it is audited (hr.record_viewed).
create or replace function public.hr_get_record(p_email text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me staff := hr_require_admin();
  v_email text := lower(btrim(coalesce(p_email, '')));
  s staff;
  r staff_hr_records;
begin
  select * into s from staff where lower(email) = v_email limit 1;
  if s.id is null then raise exception 'No staff member with that email.'; end if;
  select * into r from staff_hr_records where staff_email = v_email;
  perform audit_write('hr.record_viewed', null, 'staff', v_email,
    jsonb_build_object('has_record', r.staff_email is not null));
  return jsonb_build_object(
    'staff', jsonb_build_object('email', lower(s.email), 'name', s.name, 'role', s.role, 'active', s.active),
    'record', case when r.staff_email is null then null else
      (to_jsonb(r) - 'staff_email') || jsonb_build_object(
        'manager_name', (select name from staff where lower(email) = r.manager_email limit 1),
        'filled', hr_filled(r)) end,
    'profile_start_date', (select start_date from staff_profiles where email = v_email));
end $$;

-- Create or update one record. p_record keys are the column names below; a
-- key that is missing keeps the saved value, an empty string clears it.
-- Audits hr.record_saved with the changed field names (never the values).
create or replace function public.hr_save_record(p_email text, p_record jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me staff := hr_require_admin();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_keys text[] := array['legal_name', 'job_title', 'employment_type', 'schedule', 'manager_email',
                         'hire_date', 'end_date', 'work_location', 'personal_email', 'personal_phone',
                         'address', 'emergency_contact_name', 'emergency_contact_relationship',
                         'emergency_contact_phone', 'notes'];
  v_bad text;
  s staff;
  o staff_hr_records;
  n staff_hr_records;
  v_changed text[];
  v_created boolean;
  k text;
begin
  if p_record is null or jsonb_typeof(p_record) <> 'object' then
    raise exception 'Send the record as an object.';
  end if;
  select k2 into v_bad from jsonb_object_keys(p_record) k2 where k2 <> all (v_keys) limit 1;
  if v_bad is not null then raise exception 'Unknown field: %.', v_bad; end if;
  select * into s from staff where lower(email) = v_email limit 1;
  if s.id is null then raise exception 'No staff member with that email.'; end if;

  select * into o from staff_hr_records where staff_email = v_email for update;
  v_created := o.staff_email is null;
  n := o;
  n.staff_email := v_email;

  begin
    if p_record ? 'legal_name' then n.legal_name := nullif(btrim(p_record ->> 'legal_name'), ''); end if;
    if p_record ? 'job_title' then n.job_title := nullif(btrim(p_record ->> 'job_title'), ''); end if;
    if p_record ? 'employment_type' then n.employment_type := nullif(btrim(p_record ->> 'employment_type'), ''); end if;
    if p_record ? 'schedule' then n.schedule := nullif(btrim(p_record ->> 'schedule'), ''); end if;
    if p_record ? 'manager_email' then n.manager_email := lower(nullif(btrim(p_record ->> 'manager_email'), '')); end if;
    if p_record ? 'hire_date' then n.hire_date := nullif(btrim(p_record ->> 'hire_date'), '')::date; end if;
    if p_record ? 'end_date' then n.end_date := nullif(btrim(p_record ->> 'end_date'), '')::date; end if;
    if p_record ? 'work_location' then n.work_location := nullif(btrim(p_record ->> 'work_location'), ''); end if;
    if p_record ? 'personal_email' then n.personal_email := lower(nullif(btrim(p_record ->> 'personal_email'), '')); end if;
    if p_record ? 'personal_phone' then n.personal_phone := nullif(btrim(p_record ->> 'personal_phone'), ''); end if;
    if p_record ? 'address' then n.address := nullif(btrim(p_record ->> 'address'), ''); end if;
    if p_record ? 'emergency_contact_name' then n.emergency_contact_name := nullif(btrim(p_record ->> 'emergency_contact_name'), ''); end if;
    if p_record ? 'emergency_contact_relationship' then
      n.emergency_contact_relationship := nullif(btrim(p_record ->> 'emergency_contact_relationship'), '');
    end if;
    if p_record ? 'emergency_contact_phone' then n.emergency_contact_phone := nullif(btrim(p_record ->> 'emergency_contact_phone'), ''); end if;
    if p_record ? 'notes' then n.notes := nullif(btrim(p_record ->> 'notes'), ''); end if;
  exception when invalid_datetime_format or datetime_field_overflow then
    raise exception 'Dates must be YYYY-MM-DD.';
  end;

  -- Friendly messages for the table checks.
  if n.employment_type is not null and n.employment_type not in ('w2_employee', 'contractor') then
    raise exception 'Employment type must be W-2 employee or Contractor.';
  end if;
  if n.schedule is not null and n.schedule not in ('full_time', 'part_time') then
    raise exception 'Schedule must be Full time or Part time.';
  end if;
  if n.manager_email is not null then
    if n.manager_email = v_email then raise exception 'Someone can''t be their own manager.'; end if;
    if not exists (select 1 from staff where lower(email) = n.manager_email) then
      raise exception 'The manager must be a staff member.';
    end if;
  end if;
  if n.hire_date is not null and (n.hire_date < date '1950-01-01' or n.hire_date > current_date + 366) then
    raise exception 'The hire date is out of range.';
  end if;
  if n.end_date is not null and n.hire_date is not null and n.end_date < n.hire_date then
    raise exception 'The end date can''t be before the hire date.';
  end if;
  if n.personal_email is not null and (char_length(n.personal_email) > 254 or n.personal_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    raise exception 'The personal email doesn''t look like an email address.';
  end if;
  if n.personal_phone is not null and n.personal_phone !~ '^[0-9+(). x-]{7,40}$' then
    raise exception 'The personal phone should be digits, spaces and + ( ) - . only.';
  end if;
  if n.emergency_contact_phone is not null and n.emergency_contact_phone !~ '^[0-9+(). x-]{7,40}$' then
    raise exception 'The emergency contact phone should be digits, spaces and + ( ) - . only.';
  end if;
  if char_length(coalesce(n.legal_name, '')) > 200 or char_length(coalesce(n.emergency_contact_name, '')) > 200
     or char_length(coalesce(n.work_location, '')) > 200 then
    raise exception 'Names and the work location are limited to 200 characters.';
  end if;
  if char_length(coalesce(n.job_title, '')) > 120 then raise exception 'The job title is limited to 120 characters.'; end if;
  if char_length(coalesce(n.emergency_contact_relationship, '')) > 80 then
    raise exception 'The relationship is limited to 80 characters.';
  end if;
  if char_length(coalesce(n.address, '')) > 500 then raise exception 'The address is limited to 500 characters.'; end if;
  if char_length(coalesce(n.notes, '')) > 4000 then raise exception 'Notes are limited to 4000 characters.'; end if;

  foreach k in array v_keys loop
    if (to_jsonb(n) -> k) is distinct from (to_jsonb(o) -> k) then
      v_changed := array_append(v_changed, k);
    end if;
  end loop;

  if v_created then
    insert into staff_hr_records (staff_email, legal_name, job_title, employment_type, schedule, manager_email,
                                  hire_date, end_date, work_location, personal_email, personal_phone, address,
                                  emergency_contact_name, emergency_contact_relationship, emergency_contact_phone,
                                  notes, updated_by)
    values (v_email, n.legal_name, n.job_title, n.employment_type, n.schedule, n.manager_email,
            n.hire_date, n.end_date, n.work_location, n.personal_email, n.personal_phone, n.address,
            n.emergency_contact_name, n.emergency_contact_relationship, n.emergency_contact_phone,
            n.notes, lower(me.email))
    returning * into n;
  elsif coalesce(array_length(v_changed, 1), 0) > 0 then
    update staff_hr_records set
      legal_name = n.legal_name, job_title = n.job_title, employment_type = n.employment_type,
      schedule = n.schedule, manager_email = n.manager_email, hire_date = n.hire_date, end_date = n.end_date,
      work_location = n.work_location, personal_email = n.personal_email, personal_phone = n.personal_phone,
      address = n.address, emergency_contact_name = n.emergency_contact_name,
      emergency_contact_relationship = n.emergency_contact_relationship,
      emergency_contact_phone = n.emergency_contact_phone, notes = n.notes,
      updated_at = now(), updated_by = lower(me.email)
    where staff_email = v_email
    returning * into n;
  else
    n := o;
  end if;

  -- Hire date -> staff_profiles.start_date (anniversaries). Insert or update
  -- only start_date; staff_profiles_guard allows it for an admin and keeps
  -- the photo, title and phone as they are.
  if n.hire_date is not null and 'hire_date' = any (coalesce(v_changed, '{}')) then
    insert into staff_profiles (email, start_date) values (v_email, n.hire_date)
    on conflict (email) do update set start_date = excluded.start_date
      where staff_profiles.start_date is distinct from excluded.start_date;
  end if;

  if v_created or coalesce(array_length(v_changed, 1), 0) > 0 then
    perform audit_write('hr.record_saved', null, 'staff', v_email,
      jsonb_build_object('created', v_created, 'fields', to_jsonb(coalesce(v_changed, '{}'::text[]))));
  end if;

  return jsonb_build_object('email', v_email, 'created', v_created,
                            'changed', to_jsonb(coalesce(v_changed, '{}'::text[])),
                            'record', (to_jsonb(n) - 'staff_email') || jsonb_build_object('filled', hr_filled(n)));
end $$;

-- ---------------------------------------------------------------------------
-- Offboarding: set the end date (patched into offboard_staff in place, the
-- pg_temp.patch_fn idiom from internal-company-profile.sql). If the live
-- function doesn't match the anchor, the file fails and nothing is applied
-- (see the check at the end).
-- ---------------------------------------------------------------------------
create or replace function pg_temp.patch_fn(p_sig text, p_from text, p_to text, p_expected int)
returns void
language plpgsql
as $f$
declare
  d text;
  n int;
begin
  d := pg_get_functiondef(p_sig::regprocedure);
  if position(p_to in d) > 0 then
    return;  -- already patched
  end if;
  n := (length(d) - length(replace(d, p_from, ''))) / length(p_from);
  if n <> p_expected then
    raise exception 'patch_fn %: expected % occurrence(s) of anchor %, found %', p_sig, p_expected, p_from, n;
  end if;
  execute replace(d, p_from, p_to);
end
$f$;

do $do$
begin
  perform pg_temp.patch_fn('public.offboard_staff(text, jsonb)',
    $a$  -- 4. Deactivate (never delete)
  update staff set active = false where email = v_email and active;$a$,
    $a$  -- 3b. Employee record (staff-hr-records.sql): end date today, unless
  --     one is already set or the hire date is still ahead.
  update staff_hr_records
     set end_date = (now() at time zone 'America/Chicago')::date, updated_at = now(), updated_by = v_caller
   where staff_email = v_email and end_date is null
     and (hire_date is null or hire_date <= (now() at time zone 'America/Chicago')::date);
  if found then
    perform audit_write('hr.end_date_set', null, 'staff', v_email,
      jsonb_build_object('fields', jsonb_build_array('end_date'), 'via', 'offboarding'));
  end if;

  -- 4. Deactivate (never delete)
  update staff set active = false where email = v_email and active;$a$, 1);
end $do$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on function public.hr_require_admin() from public, anon, authenticated;
revoke all on function public.hr_filled(public.staff_hr_records) from public, anon, authenticated;
revoke all on function public.hr_list_records() from public, anon;
grant execute on function public.hr_list_records() to authenticated;
revoke all on function public.hr_get_record(text) from public, anon;
grant execute on function public.hr_get_record(text) to authenticated;
revoke all on function public.hr_save_record(text, jsonb) from public, anon;
grant execute on function public.hr_save_record(text, jsonb) to authenticated;

-- The offboarding patch must be live. A silent miss would leave end dates
-- unset with no sign, so fail the whole file instead.
do $chk$
declare d text := pg_get_functiondef('public.offboard_staff(text, jsonb)'::regprocedure);
begin
  if position('staff_hr_records' in d) = 0 or position('hr.end_date_set' in d) = 0 then
    raise exception 'staff-hr-records: offboard_staff does not set the employee record end date. Nothing was applied.';
  end if;
end $chk$;

commit;
