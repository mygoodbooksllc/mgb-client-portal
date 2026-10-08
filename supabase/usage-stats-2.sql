-- Usage stats, round two (2026-10-08), plus the live cards on Developer Tools.
--
--   usage_events   gains tab / kind / detail / device so Usage Stats can tell
--                  Team › Performance from Team › People, count actions
--                  (Ctrl+K, guide searches, help, tour) and split devices.
--   usage_summary  does the counting in the database, so the page is exact
--                  (no 5,000-row cap) and the raw rows stay put.
--   client_errors  JavaScript errors reported by the app itself, for the
--                  "Recent errors" card on Developer Tools.
--   cron_health    last run of every pg_cron job, cron_run_now fires one.
--
-- Idempotent. Everything is admin-only through public.is_active_staff_admin().

alter table usage_events add column if not exists tab text;
alter table usage_events add column if not exists kind text not null default 'view';
alter table usage_events add column if not exists detail text;
alter table usage_events add column if not exists device text;
alter table usage_events drop constraint if exists usage_events_kind_check;
alter table usage_events add constraint usage_events_kind_check check (kind in ('view', 'action'));
create index if not exists usage_events_actor_idx on usage_events (actor_email, occurred_at desc);
create index if not exists usage_events_kind_idx on usage_events (kind, occurred_at desc);

create or replace function public.usage_summary(p_days int default 30)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  since timestamptz := case when p_days is null or p_days <= 0 then '-infinity'::timestamptz
                            else now() - make_interval(days => p_days) end;
  result jsonb;
begin
  if not public.is_active_staff_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'days', p_days,
    'total_views', (select count(*) from usage_events where kind = 'view' and occurred_at >= since),
    'pages', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.views desc), '[]'::jsonb) from (
        select page, tab, count(*)::int as views,
               count(*) filter (where actor_role = 'staff')::int as staff_views,
               count(*) filter (where actor_role = 'client')::int as client_views
        from usage_events
        where kind = 'view' and occurred_at >= since
        group by page, tab
      ) x
    ),
    'weeks', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.week_start), '[]'::jsonb) from (
        select date_trunc('week', occurred_at)::date as week_start, count(*)::int as views,
               count(*) filter (where actor_role = 'staff')::int as staff_views,
               count(*) filter (where actor_role = 'client')::int as client_views,
               count(distinct actor_email) filter (where actor_role = 'staff')::int as staff_people,
               count(distinct actor_email) filter (where actor_role = 'client')::int as client_people
        from usage_events
        where kind = 'view' and occurred_at >= date_trunc('week', now()) - interval '7 weeks'
        group by 1
      ) x
    ),
    'active', jsonb_build_object(
      'staff_7d',   (select count(distinct actor_email) from usage_events where actor_role = 'staff'  and occurred_at >= now() - interval '7 days'),
      'client_7d',  (select count(distinct actor_email) from usage_events where actor_role = 'client' and occurred_at >= now() - interval '7 days'),
      'staff_30d',  (select count(distinct actor_email) from usage_events where actor_role = 'staff'  and occurred_at >= now() - interval '30 days'),
      'client_30d', (select count(distinct actor_email) from usage_events where actor_role = 'client' and occurred_at >= now() - interval '30 days')
    ),
    'people', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.last_seen desc), '[]'::jsonb) from (
        select u.actor_email as email, u.actor_role as role, max(u.occurred_at) as last_seen,
               count(*) filter (where u.occurred_at >= since and u.kind = 'view')::int as views,
               coalesce(s.name, cu.name) as name, c.name as client_name, cu.client_id
        from usage_events u
        left join staff s on lower(s.email) = lower(u.actor_email)
        left join client_users cu on lower(cu.email) = lower(u.actor_email)
        left join clients c on c.id = cu.client_id
        where u.actor_email is not null
        group by u.actor_email, u.actor_role, s.name, cu.name, c.name, cu.client_id
      ) x
    ),
    'quiet_clients', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.last_seen nulls first), '[]'::jsonb) from (
        select c.id, c.name, max(u.occurred_at) as last_seen, count(distinct cu.email)::int as users
        from clients c
        left join client_users cu on cu.client_id = c.id and cu.active
        left join usage_events u on lower(u.actor_email) = lower(cu.email) and u.actor_role = 'client'
        where not c.test_only
        group by c.id, c.name
        having max(u.occurred_at) is null or max(u.occurred_at) < now() - interval '30 days'
      ) x
    ),
    'actions', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.count desc), '[]'::jsonb) from (
        select split_part(detail, ':', 1) as action, count(*)::int as count
        from usage_events
        where kind = 'action' and occurred_at >= since
        group by 1
      ) x
    ),
    'guide_misses', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.count desc), '[]'::jsonb) from (
        select substr(detail, length('guide-miss:') + 1) as q, count(*)::int as count
        from usage_events
        where kind = 'action' and detail like 'guide-miss:%' and occurred_at >= since
        group by 1
        order by 2 desc
        limit 25
      ) x
    ),
    'devices', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.count desc), '[]'::jsonb) from (
        select coalesce(device, 'unknown') as device, count(*)::int as count
        from usage_events
        where kind = 'view' and occurred_at >= since
        group by 1
      ) x
    )
  ) into result;
  return result;
end
$$;
revoke all on function public.usage_summary(int) from public, anon;
grant execute on function public.usage_summary(int) to authenticated;

-- JavaScript errors the app reports about itself (window error / unhandled
-- rejection, capped per session in app.jsx). Signed-in users insert their
-- own; admins read them on Developer Tools. Never updated or deleted by the app.
create table if not exists client_errors (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  actor_email text,
  actor_role text,
  page text,
  message text not null,
  stack text,
  source text,
  app_version text,
  user_agent text,
  device text
);
create index if not exists client_errors_created_idx on client_errors (created_at desc);
alter table client_errors enable row level security;
drop policy if exists "signed-in users can report errors" on client_errors;
create policy "signed-in users can report errors"
  on client_errors for insert
  with check (auth.role() = 'authenticated');
drop policy if exists "admins can read errors" on client_errors;
create policy "admins can read errors"
  on client_errors for select
  using (public.is_active_staff_admin());
revoke update, delete on client_errors from anon, authenticated;

-- Every pg_cron job with its last run, for the "Scheduled jobs" card.
create or replace function public.cron_health()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not public.is_active_staff_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.jobname), '[]'::jsonb) into result from (
    select j.jobid, j.jobname, j.schedule, j.active,
           d.start_time as last_start, d.end_time as last_end, d.status as last_status,
           left(d.return_message, 300) as last_message,
           (select count(*) from cron.job_run_details f
             where f.jobid = j.jobid and f.status = 'failed' and f.start_time >= now() - interval '7 days')::int as failed_7d
    from cron.job j
    left join lateral (
      select r.start_time, r.end_time, r.status, r.return_message
      from cron.job_run_details r where r.jobid = j.jobid
      order by r.start_time desc limit 1
    ) d on true
  ) x;
  return result;
end
$$;
revoke all on function public.cron_health() from public, anon;
grant execute on function public.cron_health() to authenticated;

-- Runs one job's stored command right now (the same statement pg_cron runs).
-- The HTTP jobs return immediately; the function they call does the work.
create or replace function public.cron_run_now(p_jobname text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  cmd text;
begin
  if not public.is_active_staff_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select command into cmd from cron.job where jobname = p_jobname;
  if cmd is null then
    raise exception 'no scheduled job named %', p_jobname;
  end if;
  execute cmd;
  return 'started';
end
$$;
revoke all on function public.cron_run_now(text) from public, anon;
grant execute on function public.cron_run_now(text) to authenticated;

-- Delivery events Resend posts to the resend-webhook function (delivered,
-- opened, clicked, bounced, ...). Written with the service role only; admins
-- read the 30-day counts on the Emails page.
create table if not exists email_events (
  id bigint generated always as identity primary key,
  received_at timestamptz not null default now(),
  event_type text not null,
  email_id text,
  to_email text,
  subject text,
  occurred_at timestamptz,
  payload jsonb
);
create index if not exists email_events_received_idx on email_events (received_at desc);
create unique index if not exists email_events_dedupe_idx on email_events (email_id, event_type, occurred_at) where email_id is not null;
alter table email_events enable row level security;
drop policy if exists "admins can read email events" on email_events;
create policy "admins can read email events"
  on email_events for select
  using (public.is_active_staff_admin());
revoke insert, update, delete on email_events from anon, authenticated;
