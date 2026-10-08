-- staff-celebrations-performance.sql
--
-- Owner request 2026-10-08: staff enter their birthday and start date;
-- admins get reminders to send a gift or shout-out; Team › Performance
-- scores bookkeepers 0–100 so nobody has to guess where they stand.
-- Safe to re-run.
--
-- 1. staff_profiles gains birthday + start_date. Staff edit their own row
--    (existing policies); admins may also fill a teammate's dates from
--    Team › Members (new policy + guard change).
-- 2. staff_celebration_actions: an admin marked an occurrence "gift sent"
--    or dismissed it, so it leaves Today. Admin-only. Never deleted.
-- 3. staff_celebrations(): next birthday / work anniversary per active staff
--    member for Today, Team › People and the weekly digest. Everyone sees the
--    day; the birth year is returned only to admins and the digest.
-- 4. staff_performance(p_days, p_weights): one row per bookkeeper with six
--    signals (0–100 each), the weighted score and, for admins, the rank.
--    Non-admins get their own row only, rank null.

-- 1. Dates on the profile ----------------------------------------------------
alter table public.staff_profiles
  add column if not exists birthday date,
  add column if not exists start_date date;

create or replace function public.staff_profiles_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(auth.jwt() ->> 'email');
begin
  if v_email is null or v_email = '' then
    raise exception 'staff_profiles: no signed-in email';
  end if;
  new.email := lower(coalesce(new.email, v_email));
  -- Staff edit their own row. Admins may also fill in a teammate's dates.
  if new.email <> v_email and not public.is_active_staff_admin() then
    raise exception 'you can only edit your own profile' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.email <> old.email then
    raise exception 'profile email cannot change' using errcode = '22023';
  end if;
  new.display_name := nullif(btrim(new.display_name), '');
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
$$;

drop policy if exists "admins can manage staff profiles" on public.staff_profiles;
create policy "admins can manage staff profiles" on public.staff_profiles
  for all to authenticated
  using (public.is_active_staff_admin())
  with check (public.is_active_staff_admin());

-- 2. Celebration actions -------------------------------------------------------
create table if not exists public.staff_celebration_actions (
  id uuid primary key default gen_random_uuid(),
  staff_email text not null,
  kind text not null check (kind in ('birthday', 'anniversary')),
  occurs_on date not null,
  action text not null check (action in ('gift', 'dismissed')),
  by_email text not null,
  created_at timestamptz not null default now(),
  unique (staff_email, kind, occurs_on)
);
alter table public.staff_celebration_actions enable row level security;
drop policy if exists "admins manage celebration actions" on public.staff_celebration_actions;
create policy "admins manage celebration actions" on public.staff_celebration_actions
  for all to authenticated
  using (public.is_active_staff_admin())
  with check (public.is_active_staff_admin() and by_email = lower(auth.jwt() ->> 'email'));
revoke all on public.staff_celebration_actions from anon;
grant select, insert, update on public.staff_celebration_actions to authenticated;

-- 3. Upcoming celebrations -----------------------------------------------------
-- Next occurrence of a yearly date on or after `today`. 29 Feb falls on
-- 28 Feb in non-leap years (Postgres clamps year arithmetic).
create or replace function public.cel_next_occurrence(d date, today date)
returns date
language sql
immutable
as $$
  select case when u.c >= today then u.c else (d + make_interval(years => t.n + 1))::date end
  from (select extract(year from today)::int - extract(year from d)::int as n) t,
       lateral (select (d + make_interval(years => t.n))::date as c) u
$$;

drop function if exists public.staff_celebrations();
create function public.staff_celebrations()
returns table (
  email text,
  name text,
  role text,
  birthday date,
  birthday_md text,
  start_date date,
  next_birthday date,
  next_anniversary date,
  years int,
  birthday_action text,
  anniversary_action text
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select public.is_active_staff() as ok,
           (public.is_active_staff_admin() or auth.role() = 'service_role') as adm
  ),
  base as (
    select s.email,
           coalesce(p.display_name, s.name, s.email) as name,
           s.role,
           p.birthday,
           p.start_date,
           public.cel_next_occurrence(p.birthday, current_date) as next_birthday,
           case when p.start_date < current_date
                then public.cel_next_occurrence(p.start_date, current_date) end as next_anniversary
    from public.staff s
    join public.staff_profiles p on p.email = s.email
    where s.active and (p.birthday is not null or p.start_date is not null)
  )
  select b.email,
         b.name,
         b.role,
         case when me.adm then b.birthday end,
         to_char(b.birthday, 'MM-DD'),
         b.start_date,
         b.next_birthday,
         b.next_anniversary,
         case when b.next_anniversary is not null
              then extract(year from b.next_anniversary)::int - extract(year from b.start_date)::int end,
         (select a.action from public.staff_celebration_actions a
           where a.staff_email = b.email and a.kind = 'birthday' and a.occurs_on = b.next_birthday),
         (select a.action from public.staff_celebration_actions a
           where a.staff_email = b.email and a.kind = 'anniversary' and a.occurs_on = b.next_anniversary)
  from base b, me
  where me.ok or me.adm
  order by least(coalesce(b.next_birthday, date '9999-12-31'), coalesce(b.next_anniversary, date '9999-12-31')), b.name;
$$;
revoke all on function public.staff_celebrations() from public, anon;
grant execute on function public.staff_celebrations() to authenticated, service_role;

-- 4. Bookkeeper performance ----------------------------------------------------
-- Signals, each 0–100 or null when there is nothing to measure:
--   reply   share of client replies inside the reply-time goal (client_reply_times)
--   close   month-ends closed by the late day, for months whose late day fell in the window
--   health  average client_health score of assigned clients
--   tasks   (tasks done + filings on time) / (tasks done + tasks overdue + filings)
--   hours   closeness of logged hours (QuickBooks time, else time entries) to capacity
--   review  manager total from the latest quarterly review, out of 30
-- Score = weighted mean over the signals that have data, so a missing
-- signal never drags anyone down. Default weights 25/25/20/15/10/5;
-- p_weights overrides any of them, e.g. '{"hours": 0}'.
drop function if exists public.staff_performance(int, jsonb);
create function public.staff_performance(p_days int default 30, p_weights jsonb default null)
returns table (
  email text, name text, role text, clients int,
  reply_pct numeric, replies int,
  close_pct numeric, close_done int, close_total int,
  health_pct numeric, health_red int, health_n int,
  tasks_pct numeric, tasks_done int, tasks_overdue int, deadlines_on_time int, deadlines_total int,
  hours_pct numeric, hours numeric, capacity_hours numeric,
  review_pct numeric, review_label text,
  score numeric, rank int, weights jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_me text := lower(auth.jwt() ->> 'email');
  v_adm boolean := public.is_active_staff_admin();
  v_days int := greatest(7, least(365, coalesce(p_days, 30)));
  v_from date := current_date - greatest(7, least(365, coalesce(p_days, 30)));
  v_w jsonb := '{"reply":25,"close":25,"health":20,"tasks":15,"hours":10,"review":5}'::jsonb || coalesce(p_weights, '{}'::jsonb);
  v_late int := coalesce((select s.late_day from public.month_close_settings s where s.id), 15);
  v_reply jsonb;
begin
  if not public.is_active_staff() then return; end if;
  v_reply := public.client_reply_times(v_from, current_date);
  return query
  with people as (
    select s.email, s.id as staff_id, coalesce(p.display_name, s.name, s.email) as name, s.role
    from public.staff s
    left join public.staff_profiles p on p.email = s.email
    where s.active
      and (v_adm or s.email = v_me)
      and (s.role = 'bookkeeper' or exists (
        select 1 from public.clients c
        where lower(c.assigned_bookkeeper_email) = s.email and not coalesce(c.test_only, false)))
  ),
  cl as (
    select lower(c.assigned_bookkeeper_email) as email, c.id as client_id, c.created_at
    from public.clients c
    where c.assigned_bookkeeper_email is not null and not coalesce(c.test_only, false)
  ),
  rp as (
    select lower(x ->> 'email') as email, (x ->> 'replies')::int as replies, (x ->> 'pct_under_goal')::numeric as pct
    from jsonb_array_elements(coalesce(v_reply -> 'by_staff', '[]'::jsonb)) x
  ),
  pr as (
    select g::date as period, (g + interval '1 month' + make_interval(days => v_late - 1))::date as deadline
    from generate_series(date_trunc('month', v_from - interval '2 month'), date_trunc('month', current_date::timestamp), interval '1 month') g
  ),
  cz as (
    select cl.email,
           count(*)::int as total,
           count(*) filter (where mc.status in ('done', 'na') and mc.updated_at::date <= pr.deadline)::int as done
    from cl
    cross join pr
    left join public.month_close mc on mc.client_id = cl.client_id and mc.period = pr.period
    where pr.deadline between v_from and current_date
      and cl.created_at <= pr.period + interval '1 month'
    group by cl.email
  ),
  hl as (
    select cl.email, round(avg(h.score), 0) as avg_score,
           count(*) filter (where h.band = 'red')::int as red, count(h.client_id)::int as n
    from cl join public.client_health() h on h.client_id = cl.client_id
    group by cl.email
  ),
  tk as (
    select lower(coalesce(r.assignee_email, r.staff_email)) as email,
           count(*) filter (where coalesce(r.done, false) and r.completed_at >= v_from)::int as done,
           count(*) filter (where not coalesce(r.done, false) and r.due_date < current_date)::int as overdue
    from public.staff_reminders r
    where (coalesce(r.done, false) and r.completed_at >= v_from)
       or (not coalesce(r.done, false) and r.due_date < current_date)
    group by 1
  ),
  dl as (
    select cl.email, count(*)::int as total,
           count(*) filter (where d.due_date is null or d.filed_at::date <= d.due_date)::int as on_time
    from public.client_deadline_status d join cl on cl.client_id = d.client_id
    where d.undone_at is null and d.filed_at >= v_from
    group by cl.email
  ),
  qb as (
    select lower(p.staff_email) as email, sum(a.minutes) as minutes
    from public.qbo_time_activities a
    join public.qbo_employee_staff_map p
      on p.realm_id = a.realm_id
     and p.qbo_entity_type = case when a.employee_qbo_id is not null then 'Employee' else 'Vendor' end
     and p.qbo_id = coalesce(a.employee_qbo_id, a.vendor_qbo_id)
    where a.txn_date between v_from and current_date and p.staff_email is not null
    group by 1
  ),
  te as (
    select lower(t.staff_email) as email, sum(t.minutes) as minutes
    from public.time_entries t
    where t.entry_date between v_from and current_date
    group by 1
  ),
  hr as (
    select p.email,
           round(coalesce(nullif(qb.minutes, 0), te.minutes, 0) / 60.0, 1) as hours,
           round(coalesce(sc.weekly_target_hours, 35) * v_days / 7.0, 1) as capacity
    from people p
    left join qb on qb.email = p.email
    left join te on te.email = p.email
    left join public.staff_capacity sc on sc.staff_email = p.email
  ),
  rv as (
    select distinct on (r.staff_id) r.staff_id,
           round(100.0 * (s.cam_behavior + s.cam_success + s.own_behavior + s.own_success + s.hh_behavior + s.hh_success) / 30.0, 0) as pct,
           'Q' || c.quarter || ' ' || c.year as label
    from public.reviews r
    join public.review_cycles c on c.id = r.cycle_id
    join public.review_submissions s on s.review_id = r.id and s.kind = 'manager' and s.submitted_at is not null
    where r.status in ('comparing', 'signed', 'closed_unsigned')
    order by r.staff_id, c.year desc, c.quarter desc, s.submitted_at desc
  ),
  sig as (
    select p.email, p.name, p.role,
           (select count(*) from cl where cl.email = p.email)::int as clients,
           rp.pct as reply_pct, coalesce(rp.replies, 0)::int as replies,
           case when cz.total > 0 then round(100.0 * cz.done / cz.total, 0) end as close_pct,
           coalesce(cz.done, 0)::int as close_done, coalesce(cz.total, 0)::int as close_total,
           hl.avg_score as health_pct, coalesce(hl.red, 0)::int as health_red, coalesce(hl.n, 0)::int as health_n,
           case when coalesce(tk.done, 0) + coalesce(tk.overdue, 0) + coalesce(dl.total, 0) > 0
                then round(100.0 * (coalesce(tk.done, 0) + coalesce(dl.on_time, 0))
                           / (coalesce(tk.done, 0) + coalesce(tk.overdue, 0) + coalesce(dl.total, 0)), 0) end as tasks_pct,
           coalesce(tk.done, 0)::int as tasks_done, coalesce(tk.overdue, 0)::int as tasks_overdue,
           coalesce(dl.on_time, 0)::int as deadlines_on_time, coalesce(dl.total, 0)::int as deadlines_total,
           case when hr.hours > 0 and hr.capacity > 0
                then greatest(0, round(100 - 100.0 * abs(hr.hours - hr.capacity) / hr.capacity, 0)) end as hours_pct,
           hr.hours, hr.capacity as capacity_hours,
           rv.pct as review_pct, rv.label as review_label
    from people p
    left join rp on rp.email = p.email
    left join cz on cz.email = p.email
    left join hl on hl.email = p.email
    left join tk on tk.email = p.email
    left join dl on dl.email = p.email
    left join hr on hr.email = p.email
    left join rv on rv.staff_id = p.staff_id
  ),
  scored as (
    select s.*,
           case when w.total > 0
                then round((coalesce(s.reply_pct, 0) * w.reply + coalesce(s.close_pct, 0) * w.close
                          + coalesce(s.health_pct, 0) * w.health + coalesce(s.tasks_pct, 0) * w.tasks
                          + coalesce(s.hours_pct, 0) * w.hours + coalesce(s.review_pct, 0) * w.review) / w.total, 0) end as score
    from sig s,
    lateral (
      select wr.reply, wr.close, wr.health, wr.tasks, wr.hours, wr.review,
             wr.reply + wr.close + wr.health + wr.tasks + wr.hours + wr.review as total
      from (select
        case when s.reply_pct  is null then 0 else coalesce((v_w ->> 'reply')::numeric, 0) end as reply,
        case when s.close_pct  is null then 0 else coalesce((v_w ->> 'close')::numeric, 0) end as close,
        case when s.health_pct is null then 0 else coalesce((v_w ->> 'health')::numeric, 0) end as health,
        case when s.tasks_pct  is null then 0 else coalesce((v_w ->> 'tasks')::numeric, 0) end as tasks,
        case when s.hours_pct  is null then 0 else coalesce((v_w ->> 'hours')::numeric, 0) end as hours,
        case when s.review_pct is null then 0 else coalesce((v_w ->> 'review')::numeric, 0) end as review) wr
    ) w
  )
  select s.email, s.name, s.role, s.clients,
         s.reply_pct, s.replies,
         s.close_pct, s.close_done, s.close_total,
         s.health_pct, s.health_red, s.health_n,
         s.tasks_pct, s.tasks_done, s.tasks_overdue, s.deadlines_on_time, s.deadlines_total,
         s.hours_pct, s.hours, s.capacity_hours,
         s.review_pct, s.review_label,
         s.score,
         case when v_adm then (rank() over (order by s.score desc nulls last))::int end as rank,
         v_w as weights
  from scored s
  order by s.score desc nulls last, s.name;
end;
$$;
revoke all on function public.staff_performance(int, jsonb) from public, anon;
grant execute on function public.staff_performance(int, jsonb) to authenticated, service_role;
