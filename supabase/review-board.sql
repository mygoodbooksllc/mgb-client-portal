-- Review board (docs/review-board-spec.md sections 3a and 5, plus the
-- "Final RPC contract" section): server side for the admin-only board and
-- the email-draft extras. Additive; nothing here runs until the app calls it,
-- and the app only calls it while the board is on for a real admin.
--
--   rb__require_admin()                  internal: raises 42501 unless a real admin
--   rb__main_contact(client)             internal: org-profile contact, else first active login
--   rb_board(p_period date)              real admins only (temp admins, bookkeepers, clients: 42501)
--   rb_draft_recipients(p_task_id uuid)  active staff who can read that client's contacts today
--                                        (is_active_staff + can_access_client, the same rule as the
--                                        RLS on client_org_profile / client_contacts / client_users /
--                                        client_email_recipients); admins always pass. Nobody new.
--   rb_email_sent                        one "marked sent" row per task (staff read via RLS)
--   rb_mark_email_sent / rb_unmark_email_sent   active staff with client access
--
-- DRAFT ONLY: nothing here sends email. Every function is SECURITY DEFINER
-- with search_path = public, revoked from public/anon, and granted only to
-- authenticated (internal helpers: granted to nobody). Definer functions
-- bypass the RESTRICTIVE "internal company lock" policies, so each one
-- re-applies the internal-client rule (can_view_internal / can_access_client).
--
-- Applied to production 2026-11-05 (project xumsqmhccgfjnlmieqyu, migration reviewboard_2_board).

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
create or replace function public.rb__require_admin()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not coalesce(public.is_active_staff_admin(), false) then
    raise exception 'rb_forbidden' using errcode = '42501';
  end if;
end $$;
revoke all on function public.rb__require_admin() from public, anon, authenticated;

-- Main contact (owner decision 2026-11-05): the client org profile contact;
-- when the profile has neither a contact name nor a contact email, the first
-- active client login (oldest first). source = 'profile' | 'login'; null when
-- neither exists.
create or replace function public.rb__main_contact(p_client text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select jsonb_build_object('name', nullif(btrim(o.contact_name), ''),
                               'email', lower(nullif(btrim(o.contact_email), '')),
                               'phone', nullif(btrim(o.contact_phone), ''),
                               'source', 'profile')
       from client_org_profile o
      where o.client_id = p_client
        and (nullif(btrim(o.contact_name), '') is not null or nullif(btrim(o.contact_email), '') is not null)),
    (select jsonb_build_object('name', u.name, 'email', lower(u.email), 'phone', null, 'source', 'login')
       from client_users u
      where u.client_id = p_client and u.active
      order by u.created_at, lower(u.email)
      limit 1));
$$;
revoke all on function public.rb__main_contact(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- rb_email_sent: "Mark sent" marker, one row per task. Created before
-- rb_board, which reads it.
-- ---------------------------------------------------------------------
create table if not exists public.rb_email_sent (
  task_id   uuid primary key references public.staff_reminders(id) on delete cascade,
  client_id text not null references public.clients(id) on delete cascade,
  kind      text not null check (kind in ('request', 'reports', 'maintenance')),
  to_count  int  not null default 0 check (to_count between 0 and 50),
  sent_by   text not null check (sent_by = lower(sent_by)),
  sent_at   timestamptz not null default now()
);
alter table public.rb_email_sent enable row level security;
drop policy if exists "rb email sent staff read" on public.rb_email_sent;
create policy "rb email sent staff read" on public.rb_email_sent for select to authenticated
  using (public.is_active_staff() and public.can_access_client(client_id));
revoke all on public.rb_email_sent from public, anon, authenticated;
grant select on public.rb_email_sent to authenticated;

-- ---------------------------------------------------------------------
-- rb_board(p_period): the whole board in one call. Real admins only.
-- p_period null = last month (America/Chicago). Any date is truncated to
-- the first of its month.
-- ---------------------------------------------------------------------
create or replace function public.rb_board(p_period date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today    date := (now() at time zone 'America/Chicago')::date;
  v_p        date := date_trunc('month', coalesce(p_period, (date_trunc('month', v_today) - interval '1 month')::date))::date;
  v_internal boolean;
begin
  perform public.rb__require_admin();
  v_internal := coalesce(public.can_view_internal(), false);
  return jsonb_build_object(
    'period', v_p,
    'today',  v_today,
    'rhythm', (select s.value from tk_settings s where s.key = 'month_rhythm'),
    'clients', coalesce((
      select jsonb_agg(jsonb_build_object(
        'client_id',    c.id,
        'name',         c.name,
        'test_only',    coalesce(c.test_only, false),
        'is_internal',  coalesce(c.is_internal, false),
        'people',       coalesce((select jsonb_agg(jsonb_build_object('role', p.role, 'email', p.email, 'name', p.name))
                                    from public.tk__client_people(c.id) p
                                   where p.role in ('bookkeeper', 'backup')), '[]'::jsonb),
        'contact',      public.rb__main_contact(c.id),
        'logins',       coalesce((select jsonb_agg(jsonb_build_object('email', lower(u.email), 'name', u.name,
                                                                      'role', u.role, 'active', u.active)
                                                   order by u.active desc, u.name, lower(u.email))
                                    from client_users u where u.client_id = c.id), '[]'::jsonb),
        'report_state', (select rs.state from tk_report_state rs where rs.client_id = c.id and rs.period = v_p),
        'approve',      null,   -- reserved slot for the Approve column; nothing built yet
        'tasks',        coalesce((
          select jsonb_agg(jsonb_build_object(
                   'part',          x.part,
                   'id',            x.id,
                   'status',        x.status,
                   'assignee',      x.assignee_email,       -- null = Unassigned (S8b rule)
                   'assignee_name', (select st.name from staff st where lower(st.email) = lower(x.assignee_email)
                                      order by st.active desc limit 1),
                   'owner',         x.staff_email,          -- row owner; never shown as the assignee
                   'due',           x.due_date,
                   'completed_at',  x.completed_at,
                   'by',            x.done_by,
                   'by_name',       (select st.name from staff st where lower(st.email) = lower(x.done_by)
                                      order by st.active desc limit 1),
                   'auto',          coalesce(x.done_by = 'system', false),
                   'excused',       public.tk_late_excused(x.status, x.client_id, x.period_kind, x.period_start),
                   'waiting',       x.status = 'waiting_client',
                   'sent',          (select jsonb_build_object('by', e.sent_by, 'at', e.sent_at,
                                                               'by_name', (select st.name from staff st
                                                                            where lower(st.email) = e.sent_by
                                                                            order by st.active desc limit 1))
                                       from rb_email_sent e where e.task_id = x.id))
                 order by x.part)
            from (select distinct on (tt.id)
                         tt.due_rule ->> 'part' as part, r.id, r.status, r.assignee_email, r.staff_email,
                         r.due_date, r.completed_at, r.client_id, r.period_kind, r.period_start,
                         case when r.status = 'done' then
                           (select a.actor_email from tk_activity a
                             where a.task_id = r.id and a.kind in ('status', 'review_approved') and a.to_value = 'done'
                             order by a.created_at desc, a.id desc limit 1) end as done_by
                    from task_templates tt
                    join staff_reminders r on r.template_id = tt.id
                   where tt.source_ref in ('month_rhythm:2_check_in', 'month_rhythm:6_reports', 'month_rhythm:7_follow_up')
                     and r.client_id = c.id and r.deleted_at is null and r.parent_id is null
                     and r.period_kind = 'month' and r.period_start = v_p
                   order by tt.id, r.created_at desc, r.id desc) x), '[]'::jsonb)
      ) order by c.name, c.id)
      from clients c
     where (c.lost_at is null or c.lost_at > v_today)
       and (not coalesce(c.is_internal, false) or v_internal)), '[]'::jsonb));
end $$;
revoke all on function public.rb_board(date) from public, anon;
grant execute on function public.rb_board(date) to authenticated;

-- ---------------------------------------------------------------------
-- rb_draft_recipients(p_task_id): To/Cc data for the email draft extras.
-- Access = whoever can read these contacts today (active staff with
-- can_access_client on the task's client, which also applies the
-- internal-client rule); admins always pass. Clients never pass.
-- ---------------------------------------------------------------------
create or replace function public.rb_draft_recipients(p_task_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_client text;
begin
  if not coalesce(public.is_active_staff(), false) then
    raise exception 'rb_forbidden' using errcode = '42501';
  end if;
  select r.client_id into v_client
    from staff_reminders r
   where r.id = p_task_id and r.deleted_at is null and r.client_id is not null;
  if v_client is null then
    raise exception 'rb_not_found' using errcode = 'P0002';
  end if;
  if not coalesce(public.can_access_client(v_client), false) then
    raise exception 'rb_forbidden' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'client_id', v_client,
    'contact',   public.rb__main_contact(v_client),
    'contacts',  coalesce((select jsonb_agg(jsonb_build_object('name', k.name, 'email', lower(k.email),
                                                               'role', k.role, 'can_answer', k.can_answer_requests)
                                            order by k.can_answer_requests desc, k.name, lower(k.email))
                             from client_contacts k
                            where k.client_id = v_client and k.deleted_at is null
                              and nullif(btrim(k.email), '') is not null), '[]'::jsonb),   -- never notes
    'logins',    coalesce((select jsonb_agg(jsonb_build_object('name', u.name, 'email', lower(u.email),
                                                               'opted_out', exists (
                                                                 select 1 from client_email_recipients x
                                                                  where x.client_id = u.client_id
                                                                    and lower(x.email) = lower(u.email)
                                                                    and x.opted_out_at is not null))
                                            order by u.name, lower(u.email))
                             from client_users u
                            where u.client_id = v_client and u.active), '[]'::jsonb),
    'staff',     coalesce((select jsonb_agg(jsonb_build_object('role', p.role, 'email', p.email, 'name', p.name))
                             from public.tk__client_people(v_client) p
                            where p.role in ('bookkeeper', 'account_manager')), '[]'::jsonb));
end $$;
revoke all on function public.rb_draft_recipients(uuid) from public, anon;
grant execute on function public.rb_draft_recipients(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- rb_mark_email_sent / rb_unmark_email_sent. Kind comes from the task's
-- template (task_templates.email_kind), never from the caller.
-- ---------------------------------------------------------------------
create or replace function public.rb_mark_email_sent(p_task_id uuid, p_to_count int default 0)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client text;
  v_kind   text;
  v_me     text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_row    rb_email_sent%rowtype;
begin
  if not coalesce(public.is_active_staff(), false) or v_me = '' then
    raise exception 'rb_forbidden' using errcode = '42501';
  end if;
  select r.client_id, t.email_kind into v_client, v_kind
    from staff_reminders r
    left join task_templates t on t.id = r.template_id
   where r.id = p_task_id and r.deleted_at is null and r.client_id is not null;
  if v_client is null then
    raise exception 'rb_not_found' using errcode = 'P0002';
  end if;
  perform public.tk__req_staff_guard(v_client);   -- active staff + can_access_client (42501)
  if v_kind is null then
    raise exception 'rb_not_email_task' using errcode = '22023';
  end if;
  insert into rb_email_sent (task_id, client_id, kind, to_count, sent_by, sent_at)
  values (p_task_id, v_client, v_kind, least(greatest(coalesce(p_to_count, 0), 0), 50), v_me, now())
  on conflict (task_id) do update
     set client_id = excluded.client_id, kind = excluded.kind, to_count = excluded.to_count,
         sent_by = excluded.sent_by, sent_at = excluded.sent_at
  returning * into v_row;
  return jsonb_build_object('task_id', v_row.task_id, 'kind', v_row.kind, 'to_count', v_row.to_count,
                            'by', v_row.sent_by, 'at', v_row.sent_at);
end $$;
revoke all on function public.rb_mark_email_sent(uuid, int) from public, anon;
grant execute on function public.rb_mark_email_sent(uuid, int) to authenticated;

create or replace function public.rb_unmark_email_sent(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client text;
begin
  if not coalesce(public.is_active_staff(), false) then
    raise exception 'rb_forbidden' using errcode = '42501';
  end if;
  select r.client_id into v_client
    from staff_reminders r
   where r.id = p_task_id and r.deleted_at is null and r.client_id is not null;
  if v_client is null then
    raise exception 'rb_not_found' using errcode = 'P0002';
  end if;
  perform public.tk__req_staff_guard(v_client);
  delete from rb_email_sent where task_id = p_task_id;
end $$;
revoke all on function public.rb_unmark_email_sent(uuid) from public, anon;
grant execute on function public.rb_unmark_email_sent(uuid) to authenticated;

notify pgrst, 'reload schema';
