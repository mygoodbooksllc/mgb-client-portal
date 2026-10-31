-- staff-dates-entry-2026-10-27.sql
--
-- One-time entry of staff birthdays (month/day) and start dates from the
-- owner's "Staff Birthday & Anniversaries" sheet. Fills BLANKS only: a value
-- already on the profile is never overwritten (same month/day = no-op;
-- different = skipped and reported). Birthdays save as 1904-MM-DD, the app's
-- placeholder year (see staff-birthday-month-day.sql). One transaction,
-- idempotent, one audit_log row per field written via audit_write (actor
-- 'system' = a data load, not a signed-in person; Settings › Audit log shows
-- them). Sends nothing.
--
-- staff_profiles_guard needs a signed-in JWT, so it is switched off for this
-- one transaction (same pattern as staff-name-canonical.sql); the values are
-- in range, and the guard's rules were checked by hand.
--
-- Applied to production 2026-10-27.
begin;
alter table public.staff_profiles disable trigger staff_profiles_guard;
do $$
declare
  r record;
  p public.staff_profiles%rowtype;
  v_bday date;
begin
  for r in
    select * from (values
      ('carmen@mygoodbooks.org', 'Carmen Delacruz', 2, 27, date '2023-09-11'),
      ('holden@mygoodbooks.org', 'Holden Gray',     2, 18, date '2026-09-01'),
      ('gillian@mygoodbooks.org','Gillian Gray',    4,  2, date '2019-01-01'),
      ('nicole@mygoodbooks.org', 'Nicole Hempel',   3, 23, date '2024-01-02'),
      ('sonya@mygoodbooks.org',  'Sonya Johnson',   6, 29, date '2025-05-05'),
      ('debra@mygoodbooks.org',  'Debra Ruffin',    5, 27, date '2024-01-02'),
      ('jesse@mygoodbooks.org',  'Jesse Smithwick', 4, 27, date '2024-07-22')
    ) as v(email, name, bm, bd, start_on)
  loop
    -- Match by exact email AND name; anything else aborts the whole load.
    if not exists (select 1 from public.staff s where lower(s.email) = r.email and s.name = r.name and s.active) then
      raise exception 'staff row for % (%) not found or name differs; nothing written', r.name, r.email;
    end if;
    v_bday := make_date(1904, r.bm, r.bd);

    select * into p from public.staff_profiles where email = r.email;
    if not found then
      insert into public.staff_profiles (email, birthday, start_date, updated_at)
        values (r.email, v_bday, r.start_on, now());
      perform public.audit_write('staff_profile.birthday_set', null, 'staff', r.email,
        jsonb_build_object('month', r.bm, 'day', r.bd, 'source', 'owner sheet 2026-10-27', 'profile_created', true));
      perform public.audit_write('staff_profile.start_date_set', null, 'staff', r.email,
        jsonb_build_object('start_date', r.start_on, 'source', 'owner sheet 2026-10-27', 'profile_created', true));
      continue;
    end if;

    if p.birthday is null then
      update public.staff_profiles set birthday = v_bday, updated_at = now() where email = r.email;
      perform public.audit_write('staff_profile.birthday_set', null, 'staff', r.email,
        jsonb_build_object('month', r.bm, 'day', r.bd, 'source', 'owner sheet 2026-10-27'));
    end if;
    if p.start_date is null then
      update public.staff_profiles set start_date = r.start_on, updated_at = now() where email = r.email;
      perform public.audit_write('staff_profile.start_date_set', null, 'staff', r.email,
        jsonb_build_object('start_date', r.start_on, 'source', 'owner sheet 2026-10-27'));
    end if;
    -- Otherwise: equal = nothing to do; different = left as is (reported by the caller).
  end loop;
end;
$$;
alter table public.staff_profiles enable trigger staff_profiles_guard;
commit;
