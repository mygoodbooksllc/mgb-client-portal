-- In-app time: real-time cap per staff member across ALL clients
-- (owner request 2026-09-29, follow-up to supabase/app-time-tracking.sql).
--
-- NOT YET APPLIED to production (apply as migration app_time_per_staff_clock
-- once approved). Safe to re-run.
--
-- Before: record_app_time capped each call at the wall-clock time since THAT
-- (staff, client, day) row was last updated, so two tabs on two different
-- clients could both accrue. Now each staff member has one "credited until"
-- clock. A call may add at most (now + 15 s) - credited_until seconds, and
-- the clock then moves forward by exactly what was added. Across every client
-- and every tab, a person can never be credited more than real elapsed time
-- (plus 15 s slack). The clock never looks back more than 120 s, so idle gaps
-- don't bank credit. The browser also lets only one tab per person accrue
-- (components/staff/AppTimeTracker.js); this is the server-side backstop.
--
-- The other caps are unchanged: 120 s per call, 12 h per client per day,
-- 16 h per person per day, p_day within one day of the UTC date.
--
-- staff_app_time_clock is internal: RLS on, no policies, no grants. Only the
-- SECURITY DEFINER function reads or writes it.

begin;

create table if not exists public.staff_app_time_clock (
  staff_email text primary key,
  credited_until timestamptz not null
);

alter table public.staff_app_time_clock enable row level security;
revoke all on public.staff_app_time_clock from anon, authenticated;

create or replace function public.record_app_time(
  p_client_id text,
  p_seconds integer,
  p_day date default null
)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_email text := lower(auth.jwt() ->> 'email');
  v_now timestamptz := now();
  v_today date := (now() at time zone 'utc')::date;
  v_day date;
  v_add integer;
  v_row_total integer;
  v_day_total integer;
  v_credited timestamptz;
  v_base timestamptz;
begin
  if v_email is null or not public.is_active_staff() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_client_id is null or not public.can_access_client(p_client_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from clients where id = p_client_id) then
    return 0;
  end if;

  v_add := least(greatest(coalesce(p_seconds, 0), 0), 120);
  if v_add = 0 then
    return 0;
  end if;
  v_day := case when p_day between v_today - 1 and v_today + 1 then p_day else v_today end;

  -- Serialize per staff member so concurrent calls (several tabs) can't race.
  perform pg_advisory_xact_lock(hashtext('staff_app_time:' || v_email));

  -- Per-person real-time budget across all clients.
  select credited_until into v_credited from staff_app_time_clock where staff_email = v_email;
  v_base := greatest(coalesce(v_credited, v_now - interval '120 seconds'), v_now - interval '120 seconds');
  v_add := least(v_add, greatest(0, floor(extract(epoch from (v_now + interval '15 seconds' - v_base)))::integer));

  select seconds into v_row_total
  from staff_app_time
  where staff_email = v_email and client_id = p_client_id and day = v_day;

  select coalesce(sum(seconds), 0) into v_day_total
  from staff_app_time
  where staff_email = v_email and day = v_day;

  v_add := least(
    v_add,
    greatest(0, 43200 - coalesce(v_row_total, 0)),
    greatest(0, 57600 - v_day_total)
  );
  if v_add <= 0 then
    return 0;
  end if;

  insert into staff_app_time_clock (staff_email, credited_until)
  values (v_email, v_base + make_interval(secs => v_add))
  on conflict (staff_email) do update set credited_until = excluded.credited_until;

  insert into staff_app_time (staff_email, client_id, day, seconds, updated_at)
  values (v_email, p_client_id, v_day, v_add, v_now)
  on conflict (staff_email, client_id, day)
  do update set seconds = staff_app_time.seconds + excluded.seconds,
                updated_at = v_now;
  return v_add;
end;
$$;

revoke all on function public.record_app_time(text, integer, date) from public, anon;
grant execute on function public.record_app_time(text, integer, date) to authenticated;

commit;
