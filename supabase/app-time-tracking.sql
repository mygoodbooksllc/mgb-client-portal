-- Automatic in-app time per staff member per client (owner request 2026-09-29).
--
-- Applied to production 2026-09-29 (Supabase MCP apply_migration, name:
-- app_time_tracking). Safe to re-run.
--
-- QuickBooks Time (Workforce) is the only source of billed staff hours; the
-- manual "My Time" page is gone (time_entries is kept, untouched, but the UI
-- no longer reads or writes it). This table is a separate, automatic count of
-- how long staff actively spend in the app on each client, so an admin can
-- track it if needed. It is NOT billed time.
--
-- The browser (components/staff/AppTimeTracker.js) counts a second only while
-- a staff member (not a client, not an admin in "View as") has a client open,
-- the tab is visible, and there was mouse/keyboard/touch/scroll input in the
-- last 2 minutes. It flushes every ~60 s and on tab hide / page close through
-- record_app_time() below. Nothing is ever logged by hand.
--
-- Anti-inflation caps, all enforced here, not in the browser:
--   * at most 120 s per call;
--   * at most the wall-clock time since that row was last updated (+15 s
--     slack), so hammering the RPC or two tabs on the same client can't add
--     more than real elapsed time;
--   * at most 12 h per staff member per client per day, 16 h per staff
--     member per day across all clients;
--   * p_day (the browser's local date) is only honoured within one day of
--     the server's UTC date, otherwise the UTC date is used.
-- Calls are serialized per staff member (advisory xact lock) so concurrent
-- calls can't race the caps.
--
-- Access: is_active_staff() and can_access_client(p_client_id) are required
-- to write. RLS: admins read everything, staff read only their own rows. No
-- insert/update/delete policy, and no table grants for writes: the RPC
-- (SECURITY DEFINER) is the only writer.

begin;

create table if not exists public.staff_app_time (
  staff_email text not null,
  client_id text not null,
  day date not null,
  seconds integer not null default 0 check (seconds >= 0),
  updated_at timestamptz not null default now(),
  primary key (staff_email, client_id, day)
);

create index if not exists staff_app_time_day_idx on public.staff_app_time (day);
create index if not exists staff_app_time_client_day_idx on public.staff_app_time (client_id, day);

alter table public.staff_app_time enable row level security;

revoke all on public.staff_app_time from anon;
revoke insert, update, delete, truncate, references, trigger on public.staff_app_time from authenticated;
grant select on public.staff_app_time to authenticated;

drop policy if exists "admins read all app time" on public.staff_app_time;
create policy "admins read all app time" on public.staff_app_time
  for select to authenticated
  using (public.is_active_staff_admin());

drop policy if exists "staff read own app time" on public.staff_app_time;
create policy "staff read own app time" on public.staff_app_time
  for select to authenticated
  using (staff_email = lower(auth.jwt() ->> 'email') and public.is_active_staff());

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
  v_today date := (now() at time zone 'utc')::date;
  v_day date;
  v_add integer;
  v_row_total integer;
  v_last timestamptz;
  v_day_total integer;
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

  perform pg_advisory_xact_lock(hashtext('staff_app_time:' || v_email));

  select seconds, updated_at into v_row_total, v_last
  from staff_app_time
  where staff_email = v_email and client_id = p_client_id and day = v_day;

  if v_last is not null then
    v_add := least(v_add, greatest(0, ceil(extract(epoch from (now() - v_last)))::integer + 15));
  end if;

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

  insert into staff_app_time (staff_email, client_id, day, seconds, updated_at)
  values (v_email, p_client_id, v_day, v_add, now())
  on conflict (staff_email, client_id, day)
  do update set seconds = staff_app_time.seconds + excluded.seconds,
                updated_at = now();
  return v_add;
end;
$$;

revoke all on function public.record_app_time(text, integer, date) from public, anon;
grant execute on function public.record_app_time(text, integer, date) to authenticated;

commit;
