-- =====================================================================
-- Workbench (Tasks Phase 3), W1 + W4/W5 server: one staff inbox.
-- Spec: docs/workbench-phase3-spec.md B1-B9 (+ "Build notes 2026-10-16").
--
-- Read-only over the sources. The only new state is small:
--   wb_item_state       per-user snooze (private; writes only via RPC)
--   wb_thread_noreply   firm-wide "No reply needed" marker on a thread
--   client_file_checks  firm-wide "file checked" marker on a client upload
-- All three start from "revoke all", have RLS, allow select only, and are
-- soft-undone (never deleted). Writes go through the definer RPCs below.
--
-- wb_inbox(p_scope, p_sources, p_include_test) returns facts only; ranking and
-- grouping live in components/workbench/WB_logic.js (node-tested).
-- Kinds: task, task_sent_back, task_review, client_answered, doc_request,
-- message, gl_flags, gl_sent_back, gl_approve, gl_answer, doc_upload.
--
-- Settings (tk_settings, all optional; this file sets none of them):
--   wb_enabled         read by the app (the rollout switch; unset = off)
--   wb_gl_due_bday     business day N of the month after a period (default 10)
--   wb_doc_check_from  client uploads before this date are ignored (default 2026-10-16)
--
-- No email, no outbox kind, no switch flipped. Safe to re-run.
-- =====================================================================

-- 1. Tables -------------------------------------------------------------
create table if not exists public.wb_item_state (
  staff_email     text not null,
  item_key        text not null check (char_length(item_key) <= 200),
  snoozed_until   timestamptz,
  snoozed_version text check (snoozed_version is null or char_length(snoozed_version) <= 200),
  cleared_at      timestamptz,          -- reserved for "Done for me" on other-source rows
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (staff_email, item_key)
);
revoke all on public.wb_item_state from anon, authenticated;
grant select on public.wb_item_state to authenticated;
alter table public.wb_item_state enable row level security;
drop policy if exists wb_item_state_own_read on public.wb_item_state;
create policy wb_item_state_own_read on public.wb_item_state for select to authenticated
  using (staff_email = lower(coalesce((select auth.jwt()) ->> 'email', '')) and (select public.is_active_staff()));

create table if not exists public.wb_thread_noreply (
  id                 uuid primary key default gen_random_uuid(),
  client_id          text not null references public.clients(id) on delete cascade,
  participant_email  text not null,
  through_message_id uuid not null references public.client_messages(id) on delete cascade,
  through_at         timestamptz not null,
  reason             text not null default 'no_reply_needed' check (reason in ('no_reply_needed', 'auto_ack')),
  marked_by          text not null,
  marked_at          timestamptz not null default now(),
  undone_at          timestamptz,
  undone_by          text
);
revoke all on public.wb_thread_noreply from anon, authenticated;
grant select on public.wb_thread_noreply to authenticated;
alter table public.wb_thread_noreply enable row level security;
drop policy if exists wb_thread_noreply_staff_read on public.wb_thread_noreply;
create policy wb_thread_noreply_staff_read on public.wb_thread_noreply for select to authenticated
  using ((select public.is_active_staff()) and public.can_access_client(client_id));
create index if not exists wb_thread_noreply_thread_idx
  on public.wb_thread_noreply (client_id, participant_email, through_at);
create index if not exists wb_thread_noreply_msg_idx on public.wb_thread_noreply (through_message_id);

create table if not exists public.client_file_checks (
  id             uuid primary key default gen_random_uuid(),
  client_file_id uuid not null references public.client_files(id) on delete cascade,
  client_id      text not null references public.clients(id) on delete cascade,
  checked_by     text not null,
  checked_at     timestamptz not null default now(),
  note           text check (note is null or char_length(note) <= 500),
  undone_at      timestamptz,
  undone_by      text
);
revoke all on public.client_file_checks from anon, authenticated;
grant select on public.client_file_checks to authenticated;
alter table public.client_file_checks enable row level security;
drop policy if exists client_file_checks_staff_read on public.client_file_checks;
create policy client_file_checks_staff_read on public.client_file_checks for select to authenticated
  using ((select public.is_active_staff()) and public.can_access_client(client_id));
create unique index if not exists client_file_checks_live_uq
  on public.client_file_checks (client_file_id) where undone_at is null;
create index if not exists client_file_checks_file_idx on public.client_file_checks (client_file_id);
create index if not exists client_file_checks_client_idx on public.client_file_checks (client_id);

-- 2. Source indexes (B7) -------------------------------------------------
create index if not exists client_messages_wb_public_idx
  on public.client_messages (client_id, participant_email, created_at desc)
  where deleted_at is null and internal = false;
create index if not exists gl_review_flags_wb_open_idx
  on public.gl_review_flags (client_id, period) include (severity, created_at)
  where status = 'open';
create index if not exists client_files_wb_shared_idx
  on public.client_files (client_id, uploaded_at)
  where trashed_at is null and visibility = 'shared';
create index if not exists transaction_questions_wb_answered_idx
  on public.transaction_questions (client_id)
  where direction = 'staff_asked' and status = 'answered';

-- 3. Helpers -------------------------------------------------------------
-- The acknowledgement rule (B5). Mirrored by WB_isAck in WB_logic.js; the
-- parity cases live in both test files. A whole-message match only: one or
-- more of the phrases below, with spaces, commas, ! or . between them.
create or replace function public.wb_is_ack(p_body text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(
    char_length(btrim(p_body)) between 1 and 60
    and position('?' in p_body) = 0
    and btrim(p_body) ~* '^((thanks|thank you|thank you so much|thanks so much|ty|thx|ok|okay|k|got it|sounds good|perfect|great|awesome|will do|noted|👍)[[:space:],.!]*)+$',
    false);
$$;

create or replace function public.wb_schema_version()
returns integer
language sql
stable
set search_path = public
as $$ select 1 $$;

-- 4. wb_inbox ------------------------------------------------------------
-- Drop first so a changed column list re-applies cleanly.
drop function if exists public.wb_inbox(text, text[], boolean);
create function public.wb_inbox(
  p_scope        text    default 'mine',   -- 'mine' | 'everyone' (admins)
  p_sources      text[]  default null,     -- null = task, review, message, gl, doc
  p_include_test boolean default false     -- test clients (basic-test …) are left out unless asked
) returns table (
  item_key text, source text, kind text, source_id text, version text,
  client_id text, client_name text, period text,
  title text, detail text,
  owner_email text, covered_for text, any_admin boolean,
  due_date date, waiting_since timestamptz,
  severity text, item_count integer, status text,
  snoozed_until timestamptz, cleared boolean,
  participant_email text, ref_id text
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_me      text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_admin   boolean;
  v_today   date := (now() at time zone 'America/Chicago')::date;
  v_horizon date;
  v_src     text[];
  v_bday    int := 10;
  v_docfrom timestamptz := timestamptz '2026-10-16 00:00 America/Chicago';
  v_raw     jsonb;
  v_blocked text[];
  v_viewint boolean;
begin
  if v_me = '' or not public.is_active_staff() then
    raise exception 'wb_forbidden' using errcode = '42501';
  end if;
  v_admin := public.is_active_staff_admin();
  if p_scope is null or p_scope not in ('mine', 'everyone') then
    raise exception 'wb_bad_scope' using errcode = '22023';
  end if;
  if p_scope = 'everyone' and not v_admin then
    raise exception 'wb_forbidden' using errcode = '42501';
  end if;
  v_src := coalesce(p_sources, array['task', 'review', 'message', 'gl', 'doc']);
  if cardinality(v_src) > 10 or exists (select 1 from unnest(v_src) s where s is null or s not in ('task', 'review', 'message', 'gl', 'doc')) then
    raise exception 'wb_bad_source' using errcode = '22023';
  end if;
  v_horizon := v_today + 7;   -- WB_SOON_DAYS; later rows live in My Tasks
  -- An admin reads every task except the internal-company lock (tk_row_readable
  -- in short); computing it once keeps "Everyone" fast.
  v_blocked := coalesce(public.internal_blocked_ids(), array[]::text[]);
  v_viewint := public.can_view_internal();

  select value into v_raw from tk_settings where key = 'wb_gl_due_bday';
  if v_raw is not null and jsonb_typeof(v_raw) = 'number' and (v_raw #>> '{}')::numeric between 1 and 20 then
    v_bday := (v_raw #>> '{}')::numeric::int;
  end if;
  select value into v_raw from tk_settings where key = 'wb_doc_check_from';
  if v_raw is not null and jsonb_typeof(v_raw) = 'string' and (v_raw #>> '{}') ~ '^\d{4}-\d{2}-\d{2}$' then
    v_docfrom := ((v_raw #>> '{}')::date)::timestamp at time zone 'America/Chicago';
  end if;

  return query
  with
  -- People who are out today (S7 staff_time_off).
  away as materialized (
    select distinct lower(o.staff_email) as e
      from staff_time_off o
     where o.cancelled_at is null and v_today between o.starts_on and o.ends_on
  ),
  -- Clients this person can open (computed once), with their team.
  acc as materialized (
    select c.id, c.name,
           (select lower(s.email) from staff s where s.active and lower(s.email) = lower(c.assigned_bookkeeper_email) limit 1) as bk,
           (select lower(s.email) from staff s where s.active and lower(s.email) = lower(cp.backup_bookkeeper_email) limit 1) as backup,
           (select lower(s.email) from staff s where s.active and lower(s.email) = lower(cp.reviewer_email) limit 1) as reviewer
      from clients c
      left join client_profile cp on cp.client_id = c.id
     where (p_include_test or not coalesce(c.test_only, false))
       -- can_access_client, with the admin branch inlined (same rule, one call)
       and case when v_admin then (not coalesce(c.is_internal, false) or v_viewint)
                else public.can_access_client(c.id) end
  ),
  -- Open tasks (own work + sent back), one lateral look at the last review event.
  tb as (
    select t.*, la.kind as last_kind, la.id as last_act_id, la.created_at as last_act_at
      from staff_reminders t
      left join lateral (
        select a.id, a.kind, a.created_at
          from tk_activity a
         where a.task_id = t.id
           and a.kind in ('status', 'review_sent_back', 'review_approved', 'review_withdrawn')
         order by a.created_at desc, a.id desc
         limit 1
      ) la on t.send_back_count > 0 and t.status = 'in_progress'
     where not t.done and t.deleted_at is null and coalesce(t.kind, 'task') = 'task'
       and t.status in ('todo', 'in_progress')
       and ((t.send_back_count > 0 and t.status = 'in_progress') or (t.due_date is not null and t.due_date <= v_horizon))
       and (p_scope = 'everyone' or lower(t.assignee_email) = v_me)
  ),
  tasks as (
    select case when x.sb then 'review:task_sent_back:' else 'task:task:' end || x.id::text as item_key,
           case when x.sb then 'review' else 'task' end as source,
           case when x.sb then 'task_sent_back' else 'task' end as kind,
           x.id::text as source_id,
           case when x.sb then 'sb' || x.last_act_id::text else x.status || '|' || coalesce(x.due_date::text, '') end as version,
           x.client_id, c.name as client_name, null::text as period,
           left(x.text, 200) as title,
           nullif(left(regexp_replace(coalesce(x.description, ''), '\s+', ' ', 'g'), 120), '') as detail,
           lower(nullif(x.assignee_email, '')) as owner_email, false as any_admin,
           case when x.sb then coalesce(x.due_date, public.tk_add_business_days((x.last_act_at at time zone 'America/Chicago')::date, 1))
                else x.due_date end as due_date,
           case when x.sb then x.last_act_at else x.created_at end as waiting_since,
           x.priority as severity, 1 as item_count, x.status,
           null::text as participant_email, x.id::text as ref_id
      from (select tb.*, (tb.last_kind = 'review_sent_back') is true as sb from tb) x
      left join clients c on c.id = x.client_id
     where ((x.sb and 'review' = any (v_src)) or (not x.sb and 'task' = any (v_src)))
       and (x.sb or (x.due_date is not null and x.due_date <= v_horizon))
       and (x.client_id is null or p_include_test or not coalesce(c.test_only, false))
       and case when v_admin then (x.client_id is null or not (x.client_id = any (v_blocked)))
                else public.tk_row_readable(x.id, x.staff_email, x.assignee_email, x.client_id, x.project_id, x.visibility) end
  ),
  reviews as (
    select 'review:task_review:' || t.id::text, 'review', 'task_review', t.id::text,
           coalesce(t.ready_at, t.updated_at)::text,
           t.client_id, c.name, null::text,
           left(t.text, 200),
           nullif(left(regexp_replace(coalesce(t.description, ''), '\s+', ' ', 'g'), 120), ''),
           lower(nullif(t.reviewer_email, '')), (t.reviewer_email is null),
           least(t.due_date, public.tk_add_business_days((coalesce(t.ready_at, t.updated_at) at time zone 'America/Chicago')::date, 2)),
           coalesce(t.ready_at, t.updated_at),
           t.priority, 1, t.status, null::text, t.id::text
      from staff_reminders t
      left join clients c on c.id = t.client_id
     where 'review' = any (v_src)
       and t.status = 'ready_for_review' and not t.done and t.deleted_at is null
       and (p_scope = 'everyone' or lower(t.reviewer_email) = v_me or (t.reviewer_email is null and v_admin))
       and (t.client_id is null or p_include_test or not coalesce(c.test_only, false))
       and case when v_admin then (t.client_id is null or not (t.client_id = any (v_blocked)))
                else public.tk_row_readable(t.id, t.staff_email, t.assignee_email, t.client_id, t.project_id, t.visibility) end
  ),
  -- Client requests the client answered (S5). Documents go to the doc source.
  reqs as (
    select y.*,
           case when y.is_doc then 'doc:doc_request:' else 'task:client_answered:' end || y.id::text as k
      from (
        select r.*, a.name as cname, a.bk,
               (r.kind = 'document' or coalesce(r.needs_upload, false)) as is_doc,
               (select lower(s.email) from staff s
                 where s.active and lower(s.email) = lower(coalesce(tt.assignee_email, r.asked_by)) limit 1) as asker
          from client_requests r
          join acc a on a.id = r.client_id
          left join staff_reminders tt on tt.id = r.task_id
         where r.status = 'answered' and r.deleted_at is null
           -- a request whose task was deleted or trashed with its project stays out
           and (r.task_id is null or tt.deleted_at is null)
      ) y
     where (y.is_doc and 'doc' = any (v_src)) or (not y.is_doc and 'task' = any (v_src))
  ),
  requests as (
    select q.k,
           case when q.is_doc then 'doc' else 'task' end,
           case when q.is_doc then 'doc_request' else 'client_answered' end,
           q.id::text, coalesce(q.answered_at, q.updated_at)::text,
           q.client_id, q.cname, null::text,
           left(q.title, 200),
           nullif(left(regexp_replace(coalesce(q.reply, ''), '\s+', ' ', 'g'), 120), ''),
           coalesce(q.asker, q.bk), (coalesce(q.asker, q.bk) is null),
           public.tk_add_business_days((coalesce(q.answered_at, q.updated_at) at time zone 'America/Chicago')::date,
                                       case when q.is_doc then 2 else 1 end),
           coalesce(q.answered_at, q.updated_at),
           null::text, 1, q.status, null::text,
           coalesce(q.task_id::text, q.id::text)
      from reqs q
  ),
  -- Messages: newest public, non-deleted message per thread is from the client.
  th as (
    select distinct on (m.client_id, m.participant_email)
           m.client_id, m.participant_email, m.id, m.created_at, m.author_kind, m.body, m.attachment_path
      from client_messages m
      join acc a on a.id = m.client_id
     where 'message' = any (v_src) and m.deleted_at is null and m.internal = false
     order by m.client_id, m.participant_email, m.created_at desc, m.id desc
  ),
  wt as (
    select th.*,
           (select max(s.created_at) from client_messages s
             where s.client_id = th.client_id and s.participant_email = th.participant_email
               and s.deleted_at is null and s.internal = false and s.author_kind <> 'client') as last_staff_at,
           (select max(n.through_at) from wb_thread_noreply n
             where n.client_id = th.client_id and n.participant_email = th.participant_email
               and n.undone_at is null) as marker_at
      from th
     where th.author_kind = 'client'
  ),
  msgs as (
    select 'message:message:' || ru.first_id::text, 'message', 'message', ru.first_id::text, wt.id::text,
           wt.client_id, a.name, null::text,
           case when ru.n > 1 then ru.n::text || ' new messages' else 'New message' end,
           coalesce(nullif(left(regexp_replace(coalesce(wt.body, ''), '\s+', ' ', 'g'), 120), ''),
                    case when wt.attachment_path is not null then '(attachment)' end),
           a.bk, (a.bk is null),
           public.tk_add_business_days((ru.first_at at time zone 'America/Chicago')::date, 1),
           ru.first_at,
           null::text, ru.n::int, 'waiting'::text, wt.participant_email, wt.id::text
      from wt
      join acc a on a.id = wt.client_id
      cross join lateral (
        select (array_agg(r.id order by r.created_at, r.id))[1] as first_id,
               min(r.created_at) as first_at,
               count(*) as n,
               bool_and(r.attachment_path is null and public.wb_is_ack(r.body)) as all_ack
          from client_messages r
         where r.client_id = wt.client_id and r.participant_email = wt.participant_email
           and r.deleted_at is null and r.internal = false and r.author_kind = 'client'
           and r.created_at > coalesce(greatest(wt.last_staff_at, wt.marker_at), '-infinity'::timestamptz)
      ) ru
     where ru.first_id is not null
       and (wt.marker_at is null or wt.marker_at < wt.created_at)
       -- an acknowledgement-only run clears once any staff member has read it
       and not (coalesce(ru.all_ack, false) and exists (
             select 1 from client_message_reads cr
               join staff s on lower(s.email) = lower(cr.reader_email) and s.active
              where cr.client_id = wt.client_id and cr.participant_email = wt.participant_email
                and cr.last_read_at >= wt.created_at))
  ),
  -- Ledger review: one row per (client, month) with open high/medium flags.
  gf as (
    select f.client_id, f.period,
           count(*)::int as n,
           (count(*) filter (where f.severity = 'high'))::int as nh,
           min(f.created_at) as since, max(f.created_at) as newest
      from gl_review_flags f
      join acc a on a.id = f.client_id
     where 'gl' = any (v_src) and f.status = 'open' and f.severity in ('high', 'medium')
     group by f.client_id, f.period
  ),
  gl as (
    select 'gl:gl_flags:' || g.client_id || '|' || to_char(g.period, 'YYYY-MM'), 'gl', 'gl_flags',
           g.client_id || '|' || to_char(g.period, 'YYYY-MM'),
           g.n::text || '|' || coalesce(g.newest::text, ''),
           g.client_id, a.name, to_char(g.period, 'YYYY-MM'),
           'Ledger review',
           g.n::text || ' open' || case when g.nh > 0 then ' (' || g.nh::text || ' high)' else '' end,
           a.bk, (a.bk is null),
           public.tk_business_day_of_month((g.period + interval '1 month')::date, v_bday),
           g.since,
           case when g.nh > 0 then 'high' else 'medium' end, g.n, coalesce(s.status, 'open'), null::text, null::text
      from gf g
      join acc a on a.id = g.client_id
      left join gl_review_signoffs s on s.client_id = g.client_id and s.period = g.period
     where coalesce(s.status, 'in_review') = 'in_review'
  ),
  glsign as (
    select 'gl:' || case when s.status = 'reviewed' then 'gl_approve' else 'gl_sent_back' end || ':' || s.client_id || '|' || to_char(s.period, 'YYYY-MM'),
           'gl',
           case when s.status = 'reviewed' then 'gl_approve' else 'gl_sent_back' end,
           s.client_id || '|' || to_char(s.period, 'YYYY-MM'),
           coalesce(case when s.status = 'reviewed' then s.reviewed_at else s.sent_back_at end, s.updated_at)::text,
           s.client_id, a.name, to_char(s.period, 'YYYY-MM'),
           case when s.status = 'reviewed' then 'Ledger review ready to approve' else 'Ledger review sent back' end,
           case when s.status = 'sent_back' and s.sent_back_note is not null
                then left(regexp_replace(s.sent_back_note, '\s+', ' ', 'g'), 120)
                when g.n is not null then g.n::text || ' open' || case when g.nh > 0 then ' (' || g.nh::text || ' high)' else '' end
           end,
           case when s.status = 'reviewed' then a.reviewer else a.bk end,
           (case when s.status = 'reviewed' then a.reviewer else a.bk end) is null,
           public.tk_add_business_days((coalesce(case when s.status = 'reviewed' then s.reviewed_at else s.sent_back_at end, s.updated_at)
                                        at time zone 'America/Chicago')::date, 2),
           coalesce(case when s.status = 'reviewed' then s.reviewed_at else s.sent_back_at end, s.updated_at),
           case when coalesce(g.nh, 0) > 0 then 'high' else null end, coalesce(g.n, 0), s.status, null::text, null::text
      from gl_review_signoffs s
      join acc a on a.id = s.client_id
      left join gf g on g.client_id = s.client_id and g.period = s.period
     where 'gl' = any (v_src) and s.status in ('reviewed', 'sent_back')
  ),
  glq as (
    select 'gl:gl_answer:' || q.id::text, 'gl', 'gl_answer', q.id::text, coalesce(q.answered_at, q.updated_at)::text,
           q.client_id, a.name, to_char(q.txn_date, 'YYYY-MM'),
           'Client answered: ' || coalesce(nullif(left(q.txn_description, 120), ''), 'a transaction question'),
           nullif(left(regexp_replace(coalesce(q.answer, ''), '\s+', ' ', 'g'), 120), ''),
           a.bk, (a.bk is null),
           public.tk_add_business_days((coalesce(q.answered_at, q.updated_at) at time zone 'America/Chicago')::date, 1),
           coalesce(q.answered_at, q.updated_at),
           null::text, 1, q.status, null::text, q.id::text
      from transaction_questions q
      join acc a on a.id = q.client_id
     where 'gl' = any (v_src) and q.direction = 'staff_asked' and q.status = 'answered'
  ),
  -- Client uploads to shared Documents that nobody has checked yet.
  docs as (
    select 'doc:doc_upload:' || f.id::text, 'doc', 'doc_upload', f.id::text, f.id::text,
           f.client_id, a.name, null::text,
           'New file: ' || left(coalesce(f.display_name, f.name, 'file'), 160), -- display_name: client-page-drop-2-staff.sql
           f.doc_type,
           a.bk, (a.bk is null),
           public.tk_add_business_days((f.uploaded_at at time zone 'America/Chicago')::date, 2),
           f.uploaded_at,
           null::text, 1, 'uploaded'::text, null::text, f.id::text
      from client_files f
      join acc a on a.id = f.client_id
     where 'doc' = any (v_src)
       and f.visibility = 'shared' and f.trashed_at is null and f.uploaded_at >= v_docfrom
       and not exists (select 1 from staff s where s.active and lower(s.email) = lower(coalesce(f.uploaded_by, '')))
       and not exists (select 1 from client_file_checks k where k.client_file_id = f.id and k.undone_at is null)
  ),
  items as (
    select * from tasks
    union all select * from reviews
    union all select * from requests
    union all select * from msgs
    union all select * from gl
    union all select * from glsign
    union all select * from glq
    union all select * from docs
  ),
  scoped as (
    select i.*,
           case when i.kind not in ('task', 'task_sent_back', 'task_review')
                     and i.owner_email is not null and i.owner_email <> v_me
                     and a.backup = v_me
                     and exists (select 1 from away w where w.e = i.owner_email)
                then i.owner_email end as cov
      from items i
      left join acc a on a.id = i.client_id
     where i.due_date is null or i.due_date <= v_horizon
  )
  select sc.item_key, sc.source, sc.kind, sc.source_id, sc.version,
         sc.client_id, sc.client_name, sc.period,
         sc.title, sc.detail,
         sc.owner_email, sc.cov, sc.any_admin,
         sc.due_date, sc.waiting_since,
         sc.severity, sc.item_count, sc.status,
         case when st.snoozed_until > now() and st.snoozed_version is not distinct from sc.version then st.snoozed_until end,
         (st.cleared_at is not null),
         sc.participant_email, sc.ref_id
    from scoped sc
    left join wb_item_state st on st.staff_email = v_me and st.item_key = sc.item_key
   where p_scope = 'everyone'
      or sc.owner_email = v_me
      or sc.cov is not null
      or (sc.any_admin and v_admin)
   order by sc.due_date nulls last, sc.waiting_since nulls last, sc.item_key
   limit 800;
end $$;

-- 5. Write RPCs ----------------------------------------------------------
create or replace function public.wb_snooze(p_item_key text, p_version text, p_until timestamptz)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_until timestamptz;
begin
  if v_me = '' or not public.is_active_staff() then
    raise exception 'wb_forbidden' using errcode = '42501';
  end if;
  if p_item_key is null or char_length(p_item_key) > 200
     or p_item_key !~ '^(task|review|message|gl|doc|other):[a-z_]+:[^[:space:]]+$' then
    raise exception 'wb_bad_key' using errcode = '22023';
  end if;
  if p_version is not null and char_length(p_version) > 200 then
    raise exception 'wb_bad_version' using errcode = '22023';
  end if;
  if p_until is null or p_until <= now() then
    raise exception 'wb_bad_until' using errcode = '22023';
  end if;
  v_until := least(p_until, now() + interval '30 days');
  insert into wb_item_state (staff_email, item_key, snoozed_until, snoozed_version)
  values (v_me, p_item_key, v_until, p_version)
  on conflict (staff_email, item_key) do update
     set snoozed_until = excluded.snoozed_until,
         snoozed_version = excluded.snoozed_version,
         updated_at = now();
  return v_until;
end $$;

create or replace function public.wb_unsnooze(p_item_key text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_me text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if v_me = '' or not public.is_active_staff() then
    raise exception 'wb_forbidden' using errcode = '42501';
  end if;
  update wb_item_state set snoozed_until = null, snoozed_version = null, updated_at = now()
   where staff_email = v_me and item_key = p_item_key;
end $$;

-- "No reply needed" on a waiting thread, through its latest client message.
create or replace function public.wb_mark_no_reply(p_message_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_msg client_messages%rowtype;
  v_id uuid;
begin
  if v_me = '' or not public.is_active_staff() then
    raise exception 'wb_forbidden' using errcode = '42501';
  end if;
  select * into v_msg from client_messages where id = p_message_id;
  if not found or v_msg.deleted_at is not null or v_msg.internal or v_msg.author_kind <> 'client'
     or not public.can_access_client(v_msg.client_id) then
    raise exception 'wb_not_found' using errcode = 'P0002';
  end if;
  if exists (select 1 from client_messages m
              where m.client_id = v_msg.client_id and m.participant_email = v_msg.participant_email
                and m.deleted_at is null and m.internal = false and m.author_kind = 'client'
                and (m.created_at > v_msg.created_at or (m.created_at = v_msg.created_at and m.id > v_msg.id))) then
    raise exception 'wb_not_latest' using errcode = '22023';
  end if;
  select n.id into v_id from wb_thread_noreply n
   where n.through_message_id = v_msg.id and n.undone_at is null
   limit 1;
  if v_id is not null then
    return v_id;   -- idempotent
  end if;
  insert into wb_thread_noreply (client_id, participant_email, through_message_id, through_at, reason, marked_by)
  values (v_msg.client_id, v_msg.participant_email, v_msg.id, v_msg.created_at, 'no_reply_needed', v_me)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.wb_undo_no_reply(p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_client text;
begin
  if v_me = '' or not public.is_active_staff() then
    raise exception 'wb_forbidden' using errcode = '42501';
  end if;
  select n.client_id into v_client from wb_thread_noreply n where n.id = p_id;
  if v_client is null or not public.can_access_client(v_client) then
    raise exception 'wb_not_found' using errcode = 'P0002';
  end if;
  update wb_thread_noreply set undone_at = now(), undone_by = v_me
   where id = p_id and undone_at is null;
end $$;

create or replace function public.wb_mark_file_checked(p_file_id uuid, p_note text default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_client text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_id uuid;
begin
  if v_me = '' or not public.is_active_staff() then
    raise exception 'wb_forbidden' using errcode = '42501';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'wb_note_too_long' using errcode = '22023';
  end if;
  select f.client_id into v_client from client_files f where f.id = p_file_id and f.trashed_at is null;
  if v_client is null or not public.can_access_client(v_client) then
    raise exception 'wb_not_found' using errcode = 'P0002';
  end if;
  select k.id into v_id from client_file_checks k where k.client_file_id = p_file_id and k.undone_at is null;
  if v_id is not null then
    return v_id;   -- idempotent
  end if;
  insert into client_file_checks (client_file_id, client_id, checked_by, note)
  values (p_file_id, v_client, v_me, v_note)
  on conflict (client_file_id) where undone_at is null do nothing
  returning id into v_id;
  if v_id is null then
    select k.id into v_id from client_file_checks k where k.client_file_id = p_file_id and k.undone_at is null;
  end if;
  return v_id;
end $$;

create or replace function public.wb_undo_file_checked(p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_client text;
begin
  if v_me = '' or not public.is_active_staff() then
    raise exception 'wb_forbidden' using errcode = '42501';
  end if;
  select k.client_id into v_client from client_file_checks k where k.id = p_id;
  if v_client is null or not public.can_access_client(v_client) then
    raise exception 'wb_not_found' using errcode = 'P0002';
  end if;
  update client_file_checks set undone_at = now(), undone_by = v_me
   where id = p_id and undone_at is null;
end $$;

-- 6. Grants ---------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.wb_inbox(text, text[], boolean)',
    'public.wb_snooze(text, text, timestamptz)',
    'public.wb_unsnooze(text)',
    'public.wb_mark_no_reply(uuid)',
    'public.wb_undo_no_reply(uuid)',
    'public.wb_mark_file_checked(uuid, text)',
    'public.wb_undo_file_checked(uuid)',
    'public.wb_schema_version()',
    'public.wb_is_ack(text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
