-- Reply-time tracker (owner request 2026-10-07).
--
-- Applied to production 2026-10-07 as migration client_reply_times.
-- Safe to re-run. Read only: no tables, nothing written.
--
-- client_reply_times(p_from date, p_to date) returns jsonb:
--   { goal_hours: 24,
--     overall:   {waits, replied, median_h, p90_h, pct_under_goal, open_over_goal},
--     by_staff:  [{email, name, replies, median_h, p90_h, pct_under_goal}],
--     by_client: [{client_id, client_name, waits, replied, median_h, p90_h,
--                  pct_under_goal, open_over_goal, oldest_open_at}],
--     open:      [{client_id, client_name, participant_email, since, hours}] }
--
-- How a wait is counted (calendar hours, nights and weekends included):
--   - Source is client_messages, skipping internal notes and soft-deleted
--     rows (deleted_at set). A thread is (client_id, participant_email).
--   - A wait starts at the FIRST client message of an unanswered run: a
--     client message whose previous visible message in the thread is not
--     also from the client. Follow-up client messages in the same run don't
--     start new waits.
--   - The reply is the next non-internal staff message in that thread; its
--     author is the replier (by_staff credits the replier).
--   - Waits are bucketed by the date the wait started (America/Chicago)
--     between p_from and p_to inclusive. "open" lists waits with no reply
--     yet that are older than the goal, whatever the period.
--
-- Who sees what (security definer, active staff only):
--   - Admins: everyone and every client.
--   - Everyone else: by_staff has only their own row; by_client, open and
--     overall cover only clients they can access (can_access_client).
--   Clients can't call it (is_active_staff() is false for them).

create or replace function public.client_reply_times(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_goal constant numeric := 24;
  v_admin boolean := public.is_active_staff_admin();
  v_me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_result jsonb;
begin
  if not public.is_active_staff() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Bad date range' using errcode = '22023';
  end if;

  with base as (
    select m.id, m.client_id, lower(m.participant_email) as participant_email,
           m.author_kind, lower(m.author_email) as author_email, m.author_name, m.created_at
    from client_messages m
    where m.deleted_at is null
      and coalesce(m.internal, false) = false
      and (v_admin or public.can_access_client(m.client_id))
  ),
  seq as (
    select b.*,
           lag(b.author_kind) over (partition by b.client_id, b.participant_email order by b.created_at, b.id) as prev_kind
    from base b
  ),
  starts as (
    select s.* from seq s
    where s.author_kind = 'client' and s.prev_kind is distinct from 'client'
  ),
  waits as (
    select st.client_id, st.participant_email, st.created_at as started_at,
           r.created_at as replied_at, r.author_email as replier, r.author_name as replier_name,
           extract(epoch from (coalesce(r.created_at, now()) - st.created_at)) / 3600.0 as hours,
           (st.created_at at time zone 'America/Chicago')::date as start_day
    from starts st
    left join lateral (
      select b2.created_at, b2.author_email, b2.author_name
      from base b2
      where b2.client_id = st.client_id
        and b2.participant_email = st.participant_email
        and b2.author_kind = 'staff'
        and b2.created_at > st.created_at
      order by b2.created_at, b2.id
      limit 1
    ) r on true
  ),
  in_period as (
    select * from waits where start_day between p_from and p_to
  ),
  open_now as (
    select * from waits where replied_at is null and hours > v_goal
  ),
  staff_rows as (
    select w.replier as email,
           coalesce(max(s.name), max(w.replier_name), w.replier) as name,
           count(*) as replies,
           percentile_cont(0.5) within group (order by w.hours) as median_h,
           percentile_cont(0.9) within group (order by w.hours) as p90_h,
           avg(case when w.hours <= v_goal then 1.0 else 0.0 end) as pct_under_goal
    from in_period w
    left join staff s on lower(s.email) = w.replier
    where w.replied_at is not null
      and (v_admin or w.replier = v_me)
    group by w.replier
  ),
  client_ids as (
    select client_id from in_period union select client_id from open_now
  ),
  client_rows as (
    select ci.client_id,
           c.name as client_name,
           (select count(*) from in_period w where w.client_id = ci.client_id) as waits,
           (select count(*) from in_period w where w.client_id = ci.client_id and w.replied_at is not null) as replied,
           (select percentile_cont(0.5) within group (order by w.hours) from in_period w where w.client_id = ci.client_id and w.replied_at is not null) as median_h,
           (select percentile_cont(0.9) within group (order by w.hours) from in_period w where w.client_id = ci.client_id and w.replied_at is not null) as p90_h,
           (select avg(case when w.hours <= v_goal then 1.0 else 0.0 end) from in_period w where w.client_id = ci.client_id and w.replied_at is not null) as pct_under_goal,
           (select count(*) from open_now o where o.client_id = ci.client_id) as open_over_goal,
           (select min(o.started_at) from open_now o where o.client_id = ci.client_id) as oldest_open_at
    from client_ids ci
    left join clients c on c.id = ci.client_id
  )
  select jsonb_build_object(
    'goal_hours', v_goal,
    'overall', (
      select jsonb_build_object(
        'waits', (select count(*) from in_period),
        'replied', count(*),
        'median_h', round(percentile_cont(0.5) within group (order by w.hours)::numeric, 2),
        'p90_h', round(percentile_cont(0.9) within group (order by w.hours)::numeric, 2),
        'pct_under_goal', round(avg(case when w.hours <= v_goal then 1.0 else 0.0 end) * 100, 1),
        'open_over_goal', (select count(*) from open_now)
      )
      from in_period w where w.replied_at is not null
    ),
    'by_staff', coalesce((
      select jsonb_agg(jsonb_build_object(
        'email', email, 'name', name, 'replies', replies,
        'median_h', round(median_h::numeric, 2), 'p90_h', round(p90_h::numeric, 2),
        'pct_under_goal', round(pct_under_goal * 100, 1)
      ) order by median_h)
      from staff_rows
    ), '[]'::jsonb),
    'by_client', coalesce((
      select jsonb_agg(jsonb_build_object(
        'client_id', client_id, 'client_name', client_name, 'waits', waits, 'replied', replied,
        'median_h', round(median_h::numeric, 2), 'p90_h', round(p90_h::numeric, 2),
        'pct_under_goal', round(pct_under_goal * 100, 1),
        'open_over_goal', open_over_goal, 'oldest_open_at', oldest_open_at
      ) order by open_over_goal desc, median_h desc nulls last)
      from client_rows
    ), '[]'::jsonb),
    'open', coalesce((
      select jsonb_agg(jsonb_build_object(
        'client_id', o.client_id, 'client_name', c.name, 'participant_email', o.participant_email,
        'since', o.started_at, 'hours', round(o.hours::numeric, 1)
      ) order by o.started_at)
      from open_now o left join clients c on c.id = o.client_id
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.client_reply_times(date, date) from public, anon;
grant execute on function public.client_reply_times(date, date) to authenticated;
