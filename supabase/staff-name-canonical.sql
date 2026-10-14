-- One canonical staff name: public.staff.name (2026-10-12)
-- NOT YET APPLIED (WIP, review fixes pending).
--
-- Bug: Settings › Profile › Name saved to staff_profiles.display_name, but
-- almost everything reads staff.name (AuthGate's staffUser, team lists and
-- pickers, the author-stamping triggers on staff_messages and
-- client_private_notes, Team Reviews). Staff can't update public.staff under
-- RLS, so a self-rename showed up almost nowhere.
--
-- Fix:
--   1. set_my_staff_name(p_name): SECURITY DEFINER, renames only the
--      caller's own staff row (email from the JWT). Only the name column;
--      role/active/email are never touched. NFKC-normalizes, trims and
--      collapses spaces, rejects empty, over-120, '@', control and invisible
--      characters, and a name another staff member already has (so nobody
--      can pass as a teammate). Settings mirrors the same checks.
--      staff_after_rename (AFTER UPDATE OF name on staff, so admin renames
--      are covered too) refreshes the denormalized "current" copies on
--      clients (account_manager, assigned_bookkeeper.name/initials) and
--      writes a staff.renamed audit row. Neither older staff audit trigger
--      (log_staff_change, audit_row_change) logs names, so no double entry.
--      Past author stamps (messages, notes) keep the name they were sent with.
--   2. staff_profiles.display_name is retired: the guard now always stores
--      null (old cached browser tabs that still send it are ignored, not
--      rejected), and existing values are cleared. Every reader now uses
--      staff.name.
--   3. Nothing matches staff by free-text name any more, so a self-rename
--      can't capture someone else's data:
--        - qbo_firm_auto_match: QuickBooks employees/vendors auto-match to
--          staff by email only (customers still match clients by name).
--        - tt_client_bookkeeper: drops the "assigned_bookkeeper.name equals
--          staff.name" fallback (0 clients relied on it).
--
-- No trigger copies between staff and staff_profiles (staff_profiles_guard
-- raises without a JWT, which would break service-role updates to staff).

begin;

-- ---------------------------------------------------------------------------
-- 1. The RPC
-- ---------------------------------------------------------------------------
create or replace function public.set_my_staff_name(p_name text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := lower(nullif(btrim(auth.jwt() ->> 'email'), ''));
  -- NFKC first, so full-width letters and odd spaces fold to plain ones
  -- before the checks and the duplicate test.
  v_name text := btrim(regexp_replace(normalize(coalesce(p_name, ''), NFKC), '\s+', ' ', 'g'));
  v_old text;
begin
  if v_email is null or not public.is_active_staff() then
    raise exception 'Only active staff can change their name.' using errcode = '42501';
  end if;
  if v_name = '' then
    raise exception 'Your name can''t be empty.' using errcode = '22023';
  end if;
  if char_length(v_name) > 120 then
    raise exception 'Keep your name to 120 characters or fewer.' using errcode = '22023';
  end if;
  if position('@' in v_name) > 0 then
    raise exception 'Your name can''t include @.' using errcode = '22023';
  end if;
  -- Control, soft-hyphen, zero-width, bidi, Hangul/Mongolian filler,
  -- variation-selector and tag characters. Escapes only, no literal
  -- invisible characters (Settings.jsx ST_NAME_BAD_CHARS mirrors this).
  if v_name ~ '[[:cntrl:]]'
     or v_name ~ '[\u0001-\u001F\u007F-\u009F\u00AD\u034F\u061C\u115F\u1160\u180B-\u180F\u200B-\u200F\u2028-\u202E\u2060-\u2069\u3164\uFE00-\uFE0F\uFEFF\uFFA0\U000E0000-\U000E007F]' then
    raise exception 'Your name has a character that can''t be used.' using errcode = '22023';
  end if;

  -- Serialize renames so two people can't race to the same name.
  perform pg_advisory_xact_lock(hashtext('public.set_my_staff_name'));

  select s.name into v_old
    from staff s
   where s.email = v_email and s.active
   for update;
  if not found then
    raise exception 'Only active staff can change their name.' using errcode = '42501';
  end if;
  if v_old is not distinct from v_name then
    return v_name;
  end if;

  if exists (
    select 1 from staff s
     where s.email <> v_email
       and lower(btrim(regexp_replace(normalize(s.name, NFKC), '\s+', ' ', 'g'))) = lower(v_name)
  ) then
    raise exception 'Another team member already uses that name. Add a middle initial or last name.'
      using errcode = '23505';
  end if;

  -- staff_after_rename refreshes clients and writes the audit row.
  update staff set name = v_name where email = v_email;

  return v_name;
end;
$$;

revoke all on function public.set_my_staff_name(text) from public, anon;
grant execute on function public.set_my_staff_name(text) to authenticated;

comment on function public.set_my_staff_name(text) is
  'Settings › Profile › Name. Renames the caller''s own staff row only (JWT email). staff.name is the one canonical staff name.';

-- After any rename (the RPC above or an admin editing staff): refresh the
-- current-state copies on clients and write the audit row. Neither the
-- clients before-write triggers (they return early when the email is
-- unchanged) nor the after-write ones (they fire only on the email columns)
-- change access here, and none of them need a JWT. audit_write falls back to
-- actor 'system' when there's no JWT (service role).
create or replace function public.staff_after_rename()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := lower(new.email);
  -- Same fallback as the clients before-write triggers.
  v_name text := coalesce(nullif(btrim(new.name), ''), split_part(lower(new.email), '@', 1));
begin
  update clients
     set account_manager = v_name
   where account_manager_email = v_email
     and account_manager is distinct from v_name;
  update clients
     set assigned_bookkeeper = coalesce(assigned_bookkeeper, '{}'::jsonb)
       || jsonb_build_object(
            'name', v_name,
            'initials', upper(left(split_part(v_name, ' ', 1), 1) || left(split_part(v_name, ' ', 2), 1)))
   where assigned_bookkeeper_email = v_email
     and (assigned_bookkeeper ->> 'name') is distinct from v_name;

  perform public.audit_write('staff.renamed', null, 'staff', v_email,
    jsonb_build_object('from', old.name, 'to', new.name));
  return null;
end;
$$;

revoke all on function public.staff_after_rename() from public, anon, authenticated;

drop trigger if exists staff_after_rename on public.staff;
create trigger staff_after_rename
  after update of name on public.staff
  for each row
  when (old.name is distinct from new.name)
  execute function public.staff_after_rename();

-- ---------------------------------------------------------------------------
-- 2. Retire staff_profiles.display_name
-- ---------------------------------------------------------------------------
create or replace function public.staff_profiles_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_email text := lower(auth.jwt() ->> 'email');
begin
  if v_email is null or v_email = '' then
    raise exception 'staff_profiles: no signed-in email';
  end if;
  new.email := lower(coalesce(new.email, v_email));
  if new.email <> v_email and not public.is_active_staff_admin() then
    raise exception 'you can only edit your own profile' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.email <> old.email then
    raise exception 'profile email cannot change' using errcode = '22023';
  end if;
  -- Retired 2026-10-12: staff.name is the one name (set_my_staff_name).
  -- Ignored rather than rejected so an old open tab still saves title/phone.
  new.display_name := null;
  new.title := nullif(btrim(new.title), '');
  new.phone := nullif(btrim(new.phone), '');
  if new.photo_path is not null and left(new.photo_path, char_length(new.email) + 1) <> new.email || '/' then
    raise exception 'photo must be in your own folder' using errcode = '22023';
  end if;
  if new.birthday is not null and (new.birthday < date '1900-01-01' or new.birthday > current_date) then
    raise exception 'birthday must be a past date' using errcode = '22023';
  end if;
  if new.start_date is not null and (new.start_date < date '1950-01-01' or new.start_date > current_date + 366) then
    raise exception 'start date is out of range' using errcode = '22023';
  end if;
  new.updated_at := now();
  return new;
end;
$function$;

comment on column public.staff_profiles.display_name is
  'Retired 2026-10-12, always null. The staff name lives in public.staff.name (set_my_staff_name).';

-- Clear existing values. The guard raises without a JWT, so switch it off
-- for this one statement (same transaction, so nothing else slips through).
alter table public.staff_profiles disable trigger staff_profiles_guard;
update public.staff_profiles set display_name = null where display_name is not null;
alter table public.staff_profiles enable trigger staff_profiles_guard;

-- Readers: use staff.name. These four are long, so rewrite the live
-- definition in place, replacing only the display_name expression (and
-- staff_performance's now-unused profile join), and fail loudly if the live
-- text isn't what we expect.
do $$
declare
  r record;
  v_def text;
  v_new text;
begin
  for r in
    select * from (values
      ('public.bookkeeper_public_profile(text)'::regprocedure,
         'coalesce(p.display_name, s.name) as name', 's.name as name', null::text, null::text),
      ('public.client_team_profiles(text)'::regprocedure,
         'coalesce(p.display_name, s.name) as name', 's.name as name', null, null),
      ('public.staff_celebrations()'::regprocedure,
         'coalesce(p.display_name, s.name, s.email) as name', 'coalesce(s.name, s.email) as name', null, null),
      ('public.staff_performance(integer, jsonb)'::regprocedure,
         'coalesce(p.display_name, s.name, s.email) as name', 'coalesce(s.name, s.email) as name',
         E'    from public.staff s\n    left join public.staff_profiles p on p.email = s.email\n    where s.active\n',
         E'    from public.staff s\n    where s.active\n'),
      -- Team Reviews' "View as" check now compares by email, since names change.
      ('public.tr_my_overview()'::regprocedure,
         $q$'me', jsonb_build_object('id', me.id, 'name', me.name,$q$,
         $q$'me', jsonb_build_object('id', me.id, 'email', me.email, 'name', me.name,$q$, null, null)
    ) as t(fn, old1, new1, old2, new2)
  loop
    v_def := pg_get_functiondef(r.fn);
    if (char_length(v_def) - char_length(replace(v_def, r.old1, ''))) / char_length(r.old1) <> 1 then
      raise exception '% : expected exactly one "%"', r.fn, r.old1;
    end if;
    v_new := replace(v_def, r.old1, r.new1);
    if r.old2 is not null then
      if (char_length(v_new) - char_length(replace(v_new, r.old2, ''))) / char_length(r.old2) <> 1 then
        raise exception '% : expected exactly one profile join', r.fn;
      end if;
      v_new := replace(v_new, r.old2, r.new2);
    end if;
    if v_new ilike '%display_name%' then
      raise exception '% still mentions display_name', r.fn;
    end if;
    execute v_new;
  end loop;
end $$;

-- @mention matcher for a client's bookkeeper: staff.name only.
create or replace function public.am_body_mentions(p_body text, p_email text)
returns boolean
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_names text[];
  v_n text;
  v_tok text;
begin
  if p_body is null or position('@' in p_body) = 0 or p_email is null then
    return false;
  end if;
  select array_remove(array[
           nullif(trim(s.name), ''),
           nullif(split_part(trim(s.name), ' ', 1), ''),
           split_part(s.email, '@', 1)
         ], null)
    into v_names
    from staff s
   where s.email = lower(p_email);
  if v_names is null then
    return false;
  end if;
  foreach v_n in array v_names loop
    v_tok := regexp_replace(v_n, '([^A-Za-z0-9 ])', '\\\1', 'g');
    if length(v_n) >= 2 and p_body ~* ('(^|[^A-Za-z0-9])@' || v_tok || '($|[^A-Za-z0-9])') then
      return true;
    end if;
  end loop;
  return false;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3. No staff matching by free-text name
-- ---------------------------------------------------------------------------
create or replace function public.qbo_firm_auto_match(p_realm_id text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  with names as (
    select lower(btrim(name)) nm, min(id) id, count(*) n
    from clients
    where coalesce(test_only, false) = false and name is not null
    group by lower(btrim(name))
  )
  update qbo_customer_client_map m
     set client_id = x.id, auto_matched = true, updated_at = now()
    from (
      select m2.realm_id, m2.qbo_customer_id, coalesce(a.id, b.id) as id
      from qbo_customer_client_map m2
      left join names a on a.n = 1 and a.nm = lower(btrim(m2.customer_name))
      left join names b on b.n = 1 and b.nm = lower(btrim(m2.company_name))
      where m2.realm_id = p_realm_id
    ) x
   where m.realm_id = x.realm_id and m.qbo_customer_id = x.qbo_customer_id
     and x.id is not null
     and not m.manual and not m.ignored and m.client_id is null;

  -- Staff match by email only (2026-10-12): staff can rename themselves, so
  -- a name match could hand one person's QuickBooks time to another.
  -- Employees without a matching email are mapped by an admin.
  update qbo_employee_staff_map m
     set staff_email = s.email, auto_matched = true, updated_at = now()
    from staff s
   where m.realm_id = p_realm_id
     and not m.manual and not m.ignored and m.staff_email is null
     and m.qbo_email is not null
     and lower(btrim(m.qbo_email)) = lower(s.email);
end;
$function$;

create or replace function public.tt_client_bookkeeper(p_client_id text)
returns text
language sql
stable security definer
set search_path to 'public'
as $function$
  -- No staff.name fallback (2026-10-12): staff can rename themselves.
  with c as (
    select assigned_bookkeeper ab, assigned_bookkeeper_email abe from clients where id = p_client_id
  )
  select coalesce(
    (select s.email from staff s, c
      where s.active and s.email = c.abe limit 1),
    (select s.email from staff s, c
      where s.active and lower(s.email) = lower(c.ab ->> 'email') limit 1),
    (select s.email from staff_client_access sca join staff s on s.email = sca.staff_email
      where sca.client_id = p_client_id and s.active and s.role = 'bookkeeper'
      order by sca.created_at limit 1),
    (select s.email from staff_client_access sca join staff s on s.email = sca.staff_email
      where sca.client_id = p_client_id and s.active
      order by sca.created_at limit 1)
  );
$function$;

commit;
