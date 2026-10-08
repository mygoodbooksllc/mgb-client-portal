-- Time off and coverage (owner request 2026-10-07). Staff only.
--
-- Applied to production 2026-10-07 as migration staff_time_off.
-- Safe to re-run.
--
--   staff_time_off            who's out and when. Everyone manages their own;
--                             admins manage anyone's. Never deleted: cancel
--                             sets cancelled_at.
--   staff_directory()         active staff names/emails/roles for pickers
--                             (bookkeepers can't read the staff table).
--   coverage_overview(from,to) admin: who's out in the window, their clients,
--                             each client's backup and whether the backup can
--                             open that client.
--   grant_coverage_access(time_off_id, client_id)
--                             admin: gives the client's backup temporary access
--                             through the existing staff_client_access_grants
--                             table (status approved, expires the day after
--                             the time off ends, America/Chicago). It starts
--                             right away. Ends like any grant (end_client_access).
--
-- Clients can't see any of it: every policy and function needs active staff.

create table if not exists public.staff_time_off (
  id uuid primary key default gen_random_uuid(),
  staff_email text not null,
  starts_on date not null,
  ends_on date not null,
  note text,
  created_by text,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  constraint staff_time_off_dates_check check (ends_on >= starts_on and ends_on - starts_on <= 366),
  constraint staff_time_off_note_check check (note is null or length(note) <= 300)
);
create index if not exists staff_time_off_open_idx on public.staff_time_off (ends_on) where cancelled_at is null;
create index if not exists staff_time_off_email_idx on public.staff_time_off (staff_email);

alter table public.staff_time_off enable row level security;

drop policy if exists "staff read time off" on public.staff_time_off;
create policy "staff read time off" on public.staff_time_off
  for select to authenticated
  using (public.is_active_staff());

drop policy if exists "staff add own time off" on public.staff_time_off;
create policy "staff add own time off" on public.staff_time_off
  for insert to authenticated
  with check (
    public.is_active_staff()
    and (lower(staff_email) = lower(auth.jwt() ->> 'email') or public.is_active_staff_admin())
  );

drop policy if exists "staff edit own time off" on public.staff_time_off;
create policy "staff edit own time off" on public.staff_time_off
  for update to authenticated
  using (
    public.is_active_staff()
    and (lower(staff_email) = lower(auth.jwt() ->> 'email') or public.is_active_staff_admin())
  )
  with check (
    public.is_active_staff()
    and (lower(staff_email) = lower(auth.jwt() ->> 'email') or public.is_active_staff_admin())
  );

-- No delete policy: rows are cancelled, never deleted.
revoke all on public.staff_time_off from anon;
revoke delete, truncate on public.staff_time_off from authenticated;
grant select, insert, update on public.staff_time_off to authenticated;

-- Stamps who/when, keeps the person fixed after insert and a cancel final.
create or replace function public.staff_time_off_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.staff_email := lower(trim(new.staff_email));
    if not exists (select 1 from staff s where lower(s.email) = new.staff_email and s.active) then
      raise exception 'not an active staff member' using errcode = '22023';
    end if;
    if auth.uid() is not null then
      new.created_by := lower(auth.jwt() ->> 'email');
      new.created_at := now();
      new.cancelled_at := null;
    end if;
  else
    new.staff_email := old.staff_email;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    if old.cancelled_at is not null then
      new.cancelled_at := old.cancelled_at;
    end if;
  end if;
  new.note := nullif(trim(coalesce(new.note, '')), '');
  return new;
end;
$$;
revoke all on function public.staff_time_off_guard() from public, anon, authenticated;

drop trigger if exists staff_time_off_guard_trg on public.staff_time_off;
create trigger staff_time_off_guard_trg
  before insert or update on public.staff_time_off
  for each row execute function public.staff_time_off_guard();

-- Active staff list for pickers (backup bookkeeper, time off for someone).
create or replace function public.staff_directory()
returns table (email text, name text, role text)
language sql
stable
security definer
set search_path = public
as $$
  select lower(s.email), s.name, s.role
  from staff s
  where s.active and public.is_active_staff()
  order by s.name nulls last, s.email;
$$;
revoke all on function public.staff_directory() from public, anon;
grant execute on function public.staff_directory() to authenticated;

-- Admin coverage view. backup_access is one of:
--   none_set   no backup on the client profile
--   not_staff  backup email isn't an active staff member
--   admin      backup is an admin (sees every client)
--   assigned   backup is assigned to the client
--   temporary  backup has an approved, unexpired grant (grant_expires_at)
--   none       backup can't open the client
create or replace function public.coverage_overview(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if not public.is_active_staff_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Bad date range' using errcode = '22023';
  end if;

  with t as (
    select o.*, s.name as staff_name
    from staff_time_off o
    left join staff s on lower(s.email) = o.staff_email
    where o.cancelled_at is null and o.ends_on >= p_from and o.starts_on <= p_to
  ),
  their_clients as (
    select distinct t.id as time_off_id, c.id as client_id, c.name as client_name
    from t
    join clients c
      on lower(coalesce(c.assigned_bookkeeper_email, '')) = t.staff_email
      or exists (select 1 from staff_client_access a where a.client_id = c.id and lower(a.staff_email) = t.staff_email)
  ),
  crows as (
    select tc.time_off_id, tc.client_id, tc.client_name,
           lower(p.backup_bookkeeper_email) as backup_email,
           b.name as backup_name, b.role as backup_role, coalesce(b.active, false) as backup_active,
           (select max(g.expires_at) from staff_client_access_grants g
             where g.client_id = tc.client_id and lower(g.staff_email) = lower(p.backup_bookkeeper_email)
               and g.status = 'approved' and g.expires_at > now()) as grant_expires_at,
           exists (select 1 from staff_client_access a
                    where a.client_id = tc.client_id and lower(a.staff_email) = lower(p.backup_bookkeeper_email)) as backup_assigned,
           (select max(o2.ends_on) from staff_time_off o2, t t2
             where t2.id = tc.time_off_id and o2.cancelled_at is null
               and o2.staff_email = lower(p.backup_bookkeeper_email)
               and o2.starts_on <= t2.ends_on and o2.ends_on >= t2.starts_on) as backup_away_until
    from their_clients tc
    left join client_profile p on p.client_id = tc.client_id
    left join staff b on lower(b.email) = lower(p.backup_bookkeeper_email)
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'time_off', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'staff_email', t.staff_email, 'staff_name', t.staff_name,
        'starts_on', t.starts_on, 'ends_on', t.ends_on, 'note', t.note,
        'clients', coalesce((
          select jsonb_agg(jsonb_build_object(
            'client_id', r.client_id, 'client_name', r.client_name,
            'backup_email', r.backup_email, 'backup_name', r.backup_name,
            'backup_away_until', r.backup_away_until,
            'grant_expires_at', r.grant_expires_at,
            'backup_access', case
              when r.backup_email is null or r.backup_email = '' then 'none_set'
              when not r.backup_active then 'not_staff'
              when r.backup_role = 'admin' then 'admin'
              when r.backup_assigned then 'assigned'
              when r.grant_expires_at is not null then 'temporary'
              else 'none' end
          ) order by r.client_name)
          from crows r where r.time_off_id = t.id
        ), '[]'::jsonb)
      ) order by t.starts_on, t.staff_email)
      from t
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.coverage_overview(date, date) from public, anon;
grant execute on function public.coverage_overview(date, date) to authenticated;

create or replace function public.grant_coverage_access(p_time_off_id uuid, p_client_id text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  t staff_time_off;
  v_backup text;
  v_backup_name text;
  v_backup_role text;
  v_today date := (now() at time zone 'America/Chicago')::date;
  v_expires timestamptz;
  v_span int;
  v_away_name text;
  v_id uuid;
begin
  if not public.is_active_staff_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select * into t from staff_time_off where id = p_time_off_id;
  if not found or t.cancelled_at is not null then
    raise exception 'That time off was cancelled or doesn''t exist' using errcode = '22023';
  end if;
  if t.ends_on < v_today then
    raise exception 'That time off is already over' using errcode = '22023';
  end if;
  if not exists (
    select 1 from clients c
    where c.id = p_client_id
      and (lower(coalesce(c.assigned_bookkeeper_email, '')) = t.staff_email
           or exists (select 1 from staff_client_access a where a.client_id = c.id and lower(a.staff_email) = t.staff_email))
  ) then
    raise exception 'That client isn''t one of theirs' using errcode = '22023';
  end if;
  select lower(backup_bookkeeper_email) into v_backup from client_profile where client_id = p_client_id;
  if v_backup is null or v_backup = '' then
    raise exception 'Set a backup bookkeeper on the client first' using errcode = '22023';
  end if;
  select s.name, s.role into v_backup_name, v_backup_role from staff s where lower(s.email) = v_backup and s.active;
  if not found then
    raise exception 'The backup isn''t an active staff member' using errcode = '22023';
  end if;
  if v_backup_role = 'admin'
     or exists (select 1 from staff_client_access a where a.client_id = p_client_id and lower(a.staff_email) = v_backup) then
    raise exception 'The backup already has access to this client' using errcode = '22023';
  end if;
  v_expires := ((t.ends_on + 1)::timestamp at time zone 'America/Chicago');
  if exists (select 1 from staff_client_access_grants g
             where g.client_id = p_client_id and lower(g.staff_email) = v_backup
               and g.status = 'approved' and g.expires_at >= v_expires) then
    raise exception 'The backup already has temporary access for this time off' using errcode = '22023';
  end if;
  select coalesce(s.name, t.staff_email) into v_away_name from staff s where lower(s.email) = t.staff_email;
  v_span := (t.ends_on + 1) - v_today;
  insert into staff_client_access_grants
    (client_id, staff_email, staff_name, reason, duration_days, status, decided_by, decided_at, expires_at)
  values (
    p_client_id, v_backup, v_backup_name,
    left('Covering for ' || coalesce(v_away_name, t.staff_email) || ' (time off ' ||
         to_char(t.starts_on, 'Mon DD') || ' to ' || to_char(t.ends_on, 'Mon DD') || ')', 500),
    case when v_span <= 1 then 1 when v_span <= 7 then 7 else 30 end,
    'approved', lower(auth.jwt() ->> 'email'), now(), v_expires
  )
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.grant_coverage_access(uuid, text) from public, anon;
grant execute on function public.grant_coverage_access(uuid, text) to authenticated;
