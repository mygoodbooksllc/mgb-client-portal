-- =====================================================================
-- Client contacts in the org profile (spec docs/client-contacts-spec.md).
-- Built hidden behind tk_settings.org_contacts_enabled (owner only; never
-- written by code) plus a test-client rule (clients.test_only). With the gate
-- off for a client, every reply and every write path behaves as before; the
-- only visible differences are extra JSON keys (contact_list, contacts_enabled,
-- greeting, source, title) that the UI ignores unless the gate is on.
--
-- Additive only: new columns, one partial unique index, new helpers, two
-- triggers on client_contacts, CREATE OR REPLACE of eight functions (bodies
-- saved first in client-contacts-rollback.sql), one new staff RPC.
--
-- Owner decisions 2026-11-05:
--   Q1 yes: clients may edit or remove contacts staff added (never notes/role).
--   Q2 override: the token-revoke trigger cc__revoke_on_change is a NO-OP while
--   the gate is off for that client (op__contacts_on false), so live behavior
--   is byte-identical with the feature hidden. staff_client_contact_save's
--   admin-preview path (gate off, real admin, p_preview) revokes that contact's
--   tokens itself, always with a non-null contact id.
--
-- Self-test: supabase/client-contacts-tests.sql (ends in ROLLBACK).
-- Rollback:  supabase/client-contacts-rollback.sql (not run).
--
-- Applied to production 2026-11-05 (project xumsqmhccgfjnlmieqyu).
-- =====================================================================

begin;

-- 1. Columns, checks, index ------------------------------------------------------
alter table public.client_contacts
  add column if not exists is_main boolean not null default false,
  add column if not exists gets_monthly_emails boolean not null default false,
  add column if not exists title text,
  add column if not exists source text not null default 'staff',
  add column if not exists updated_by text,
  add column if not exists edited_at timestamptz;

alter table public.client_contacts drop constraint if exists client_contacts_title_len;
alter table public.client_contacts add constraint client_contacts_title_len
  check (title is null or (title = btrim(title) and char_length(title) between 1 and 120));
alter table public.client_contacts drop constraint if exists client_contacts_source_check;
alter table public.client_contacts add constraint client_contacts_source_check
  check (source in ('staff', 'client', 'import'));

create unique index if not exists client_contacts_one_main
  on public.client_contacts (client_id) where is_main and deleted_at is null;

alter table public.client_org_profile add column if not exists greeting_name text;
alter table public.client_org_profile drop constraint if exists client_org_profile_greeting_len;
alter table public.client_org_profile add constraint client_org_profile_greeting_len
  check (greeting_name is null or (greeting_name = btrim(greeting_name) and char_length(greeting_name) between 1 and 80));

-- 2. Helpers -----------------------------------------------------------------------
-- Gate: firm switch on, or a test client.
create or replace function public.op__contacts_on(p_client text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.tk__jsonb_bool((select s.value from tk_settings s where s.key = 'org_contacts_enabled')), false)
      or coalesce((select c.test_only from clients c where c.id = p_client), false);
$$;

-- Serializes contact writes per client (first-save race, two is_main writers).
create or replace function public.cc__lock(p_client text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('cc:' || coalesce(p_client, ''), 0));
end $$;

-- Stricter email check (same class as RB_EMAIL_RE / OPC_EMAIL_RE).
create or replace function public.cc__email_ok(p text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p is not null
     and char_length(p) between 3 and 254
     and p !~ '[[:cntrl:]]'
     and p ~ '^[^\s@?&,%#<>"]+@[^\s@?&,%#<>"]+\.[^\s@?&,%#<>"]+$';
$$;

-- BEFORE INSERT OR UPDATE: stamps only updated_at, updated_by, edited_at.
create or replace function public.cc__stamp_fn()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  new.updated_by := nullif(lower(btrim(coalesce(auth.jwt() ->> 'email', ''))), '');
  if coalesce(current_setting('mgb.cc_import', true), '') = '1' then
    -- The import never stamps a human edit.
    if tg_op = 'UPDATE' then
      new.edited_at := old.edited_at;
    else
      new.edited_at := null;
    end if;
  else
    new.edited_at := now();
  end if;
  return new;
end $$;

-- AFTER UPDATE: one place for token safety. Q2 override: a no-op while the
-- gate is off for that client. Never passes a null contact id.
create or replace function public.cc__revoke_on_change_fn()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.id is null or not public.op__contacts_on(new.client_id) then
    return null;
  end if;
  -- Reason is always 'contact_retired': tk_request_tokens_reason_check allows
  -- no other contact reason, and widening that constraint is not worth it.
  if (old.deleted_at is null and new.deleted_at is not null)
     or (coalesce(old.can_answer_requests, false) and not coalesce(new.can_answer_requests, false))
     or new.email is distinct from old.email then
    perform public.tk__revoke_tokens(null, 'contact_retired',
      coalesce(nullif(lower(btrim(coalesce(auth.jwt() ->> 'email', ''))), ''), 'system'), new.id);
  end if;
  return null;
end $$;

drop trigger if exists cc__stamp on public.client_contacts;
create trigger cc__stamp before insert or update on public.client_contacts
  for each row execute function public.cc__stamp_fn();
drop trigger if exists cc__revoke_on_change on public.client_contacts;
create trigger cc__revoke_on_change after update on public.client_contacts
  for each row execute function public.cc__revoke_on_change_fn();

-- Lazy materialize: the org-profile person becomes a contact row (section 3).
-- Callers hold cc__lock.
create or replace function public.cc__materialize(p_client text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_name text;
  v_email text;
  v_id uuid;
begin
  if exists (select 1 from client_contacts k where k.client_id = p_client and k.is_main and k.deleted_at is null) then
    return;
  end if;
  select nullif(btrim(o.contact_name), ''), lower(nullif(btrim(o.contact_email), ''))
    into v_name, v_email
    from client_org_profile o where o.client_id = p_client;
  if v_email is null or not public.cc__email_ok(v_email) then
    return;
  end if;
  select k.id into v_id from client_contacts k
   where k.client_id = p_client and k.email = v_email and k.deleted_at is null;
  if v_id is not null then
    update client_contacts set is_main = true, gets_monthly_emails = true where id = v_id;
    return;
  end if;
  if exists (select 1 from client_contacts k where k.client_id = p_client and k.email = v_email) then
    return;   -- tombstoned: staff removed this person
  end if;
  if v_name is not null and v_name ~ '[[:cntrl:]]' then
    v_name := null;
  end if;
  insert into client_contacts (client_id, name, email, is_main, gets_monthly_emails, can_answer_requests, source, created_by)
  values (p_client, left(coalesce(v_name, v_email), 120), v_email, true, true, false, 'client', 'org_profile');
end $$;

-- One people list (section 4). Never returns notes.
create or replace function public.cc__people(p_client text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_pos jsonb := '{}'::jsonb;   -- lower(email) -> array index
  v_has_main boolean;
  v_pname text; v_pemail text; v_pphone text;
  r record;
  v_key text;
  v_i int;
  v_cur jsonb;
begin
  select nullif(btrim(o.contact_name), ''), lower(nullif(btrim(o.contact_email), '')), nullif(btrim(o.contact_phone), '')
    into v_pname, v_pemail, v_pphone
    from client_org_profile o where o.client_id = p_client;
  v_has_main := exists (select 1 from client_contacts k where k.client_id = p_client and k.is_main and k.deleted_at is null);

  for r in
    with cand as (
      -- 1. live main row
      select 1 as grp, 0::bigint as ord, k.name, lower(k.email) as email, k.title, k.role,
             true as is_main, k.gets_monthly_emails as monthly, k.can_answer_requests as can_answer,
             'main'::text as src, k.id as contact_id, k.source = 'client' as by_client
        from client_contacts k
       where k.client_id = p_client and k.is_main and k.deleted_at is null
      union all
      -- 2. org-profile contact, only with no live main row, not tombstoned
      select 2, 0, v_pname, v_pemail, null, null, true, true, null, 'profile', null::uuid, false
       where not v_has_main
         and (v_pname is not null or v_pemail is not null)
         and not (v_pemail is not null
                  and exists (select 1 from client_contacts d where d.client_id = p_client and d.email = v_pemail and d.deleted_at is not null)
                  and not exists (select 1 from client_contacts l where l.client_id = p_client and l.email = v_pemail and l.deleted_at is null))
      union all
      -- 3. other live contacts
      select 3, row_number() over (order by k.gets_monthly_emails desc, k.can_answer_requests desc, k.name, lower(k.email)),
             k.name, lower(k.email), k.title, k.role, false, k.gets_monthly_emails, k.can_answer_requests,
             'contact', k.id, k.source = 'client'
        from client_contacts k
       where k.client_id = p_client and k.deleted_at is null and not k.is_main
         and nullif(btrim(k.email), '') is not null
      union all
      -- 4. active logins
      select 4, row_number() over (order by u.created_at, lower(u.email)),
             u.name, lower(u.email), null, null, false, false, null, 'login', null::uuid, false
        from client_users u
       where u.client_id = p_client and u.active
    )
    select c.*,
           case when c.email is not null and c.email = v_pemail then v_pphone
                when c.src = 'profile' and c.email is null then v_pphone end as phone,
           (c.email is not null and exists (select 1 from client_email_recipients x
                                             where x.client_id = p_client and lower(x.email) = c.email
                                               and x.opted_out_at is not null)) as opted_out
      from cand c
     order by c.grp, c.ord
  loop
    v_key := nullif(btrim(r.email), '');
    if v_key is not null and v_pos ? v_key then
      v_i := (v_pos ->> v_key)::int;
      v_cur := v_out -> v_i;
      if (v_cur -> 'phone') = 'null'::jsonb and r.phone is not null then
        v_cur := jsonb_set(v_cur, '{phone}', to_jsonb(r.phone));
      end if;
      if (v_cur -> 'title') = 'null'::jsonb and r.title is not null then
        v_cur := jsonb_set(v_cur, '{title}', to_jsonb(r.title));
      end if;
      if r.opted_out then
        v_cur := jsonb_set(v_cur, '{opted_out}', 'true'::jsonb);
      end if;
      v_out := jsonb_set(v_out, array[v_i::text], v_cur);
    else
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'name', r.name,
        'email', v_key,
        'phone', r.phone,
        'title', r.title,
        'role', r.role,
        'is_main', r.is_main,
        'gets_monthly_emails', r.monthly,
        'can_answer', r.can_answer,
        'opted_out', coalesce(r.opted_out, false),
        'source', r.src,
        'contact_id', r.contact_id,
        'added_by_client', coalesce(r.by_client, false)));
      if v_key is not null then
        v_pos := v_pos || jsonb_build_object(v_key, jsonb_array_length(v_out) - 1);
      end if;
    end if;
  end loop;
  return v_out;
end $$;

-- 3. Replaced readers -------------------------------------------------------------
-- Gate off: exactly the pre-migration body (same keys, no title).
create or replace function public.rb__main_contact(p_client text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_list jsonb;
  e jsonb;
begin
  if not public.op__contacts_on(p_client) then
    return (select coalesce(
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
        limit 1)));
  end if;
  v_list := public.cc__people(p_client);
  select x into e from jsonb_array_elements(v_list) with ordinality t(x, i)
   where (x ->> 'is_main')::boolean order by i limit 1;
  if e is null then
    select x into e from jsonb_array_elements(v_list) with ordinality t(x, i)
     where x ->> 'source' = 'contact' and (x ->> 'gets_monthly_emails')::boolean order by i limit 1;
  end if;
  if e is null then
    select x into e from jsonb_array_elements(v_list) with ordinality t(x, i)
     where x ->> 'source' = 'login' order by i limit 1;
  end if;
  if e is null then
    return null;
  end if;
  return jsonb_build_object('name', e -> 'name', 'email', e -> 'email', 'phone', e -> 'phone',
                            'source', e -> 'source', 'title', e -> 'title');
end $$;

create or replace function public.rb_board(p_period date default null::date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
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
        'contact_list', public.cc__people(c.id),   -- client contacts (spec section 4); never notes
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
end $function$;

create or replace function public.rb_draft_recipients(p_task_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
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
    'contact_list', public.cc__people(v_client),   -- spec section 4/5; never notes
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
                            where p.role in ('bookkeeper', 'account_manager')), '[]'::jsonb),
    'sent',      (select jsonb_build_object('by', e.sent_by, 'at', e.sent_at,
                                            'by_name', (select st.name from staff st
                                                         where lower(st.email) = e.sent_by
                                                         order by st.active desc limit 1))
                    from rb_email_sent e where e.task_id = p_task_id));
end $function$;

create or replace function public.staff_client_org_profile(p_client_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  op client_org_profile;
  v_launch date;
  v_fye text;
  k client_get_to_know;
  v_gtk_ok boolean;
  v_on boolean;
  v_cp_greet text;
begin
  if not (public.is_active_staff() and public.can_access_client(p_client_id)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from clients where id = p_client_id) then
    raise exception 'unknown client' using errcode = '22023';
  end if;
  select * into op from client_org_profile where client_id = p_client_id;
  select cp.launch_date, cp.fiscal_year_end, nullif(btrim(cp.greeting_name), '')
    into v_launch, v_fye, v_cp_greet from client_profile cp where cp.client_id = p_client_id;
  select * into k from client_get_to_know where client_id = p_client_id;
  v_gtk_ok := public.op__can_read_gtk(p_client_id);
  v_on := public.op__contacts_on(p_client_id);

  return jsonb_build_object(
    'client_id', p_client_id,
    -- Gate off: greeting_name is stripped so the profile is byte-identical.
    'profile', case when op.client_id is null then null
                    when v_on then to_jsonb(op) - 'client_id'
                    else to_jsonb(op) - 'client_id' - 'greeting_name' end,
    'complete', op.completed_at is not null,
    'client_since', coalesce(op.client_since, v_launch),
    'client_since_source', case when op.client_since is not null then 'staff'
                                when v_launch is not null then 'launch_date' end,
    'client_since_set_by', op.client_since_set_by,
    'launch_date', v_launch,
    'staff_fiscal_year_end', v_fye,
    'fiscal_year_mismatch', coalesce(op.fiscal_year_end is not null and nullif(btrim(v_fye), '') is not null
                                     and op.fiscal_year_end <> btrim(v_fye), false),
    'has_get_to_know', k.client_id is not null,
    'can_see_get_to_know', v_gtk_ok,
    'get_to_know', case when v_gtk_ok then k.answers end,
    'get_to_know_submitted_by', case when v_gtk_ok then k.submitted_by end,
    'get_to_know_submitted_at', case when v_gtk_ok then k.submitted_at end,
    'contacts_enabled', v_on,
    'contact_list', public.cc__people(p_client_id),
    'greeting', jsonb_build_object(
      'org_profile', op.greeting_name,
      'client_profile', v_cp_greet,
      'mismatch', coalesce(op.greeting_name is not null and v_cp_greet is not null
                           and lower(op.greeting_name) <> lower(v_cp_greet), false))
  );
end;
$function$;

create or replace function public.client_org_profile_mine()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  me client_users;
  c clients;
  op client_org_profile;
  v_fye text;
  v_has_gtk boolean;
  v_on boolean;
  v_out jsonb;
  v_main client_contacts;
  v_pemail text;
  v_prefill jsonb;
begin
  if public.is_active_staff()
     or exists (select 1 from staff s where lower(s.email) = lower(auth.jwt() ->> 'email')) then
    return jsonb_build_object('eligible', false);
  end if;
  me := st_my_client_user();
  if me.email is null or coalesce(me.access, 'full') <> 'full' then
    return jsonb_build_object('eligible', false);
  end if;

  select * into c from clients where id = me.client_id;
  if c.id is null then
    return jsonb_build_object('eligible', false);
  end if;
  select * into op from client_org_profile where client_id = me.client_id;
  select cp.fiscal_year_end into v_fye from client_profile cp where cp.client_id = me.client_id;
  v_has_gtk := exists (select 1 from client_get_to_know k where k.client_id = me.client_id);
  v_on := public.op__contacts_on(me.client_id);

  v_out := jsonb_build_object(
    'eligible', true,
    'enabled', public.op__switch_on(),
    'profile', case when op.client_id is null then null else jsonb_build_object(
      'card_name', op.card_name,
      'org_type', op.org_type,
      'established_date', op.established_date,
      'established_unknown', op.established_unknown,
      'gift_address', op.gift_address,
      'gift_same_as_org', op.gift_same_as_org,
      'receiver_name', op.receiver_name,
      'courier_phone', op.courier_phone,
      'contact_name', op.contact_name,
      'contact_email', op.contact_email,
      'contact_phone', op.contact_phone,
      'fiscal_year_end', op.fiscal_year_end,
      'completed_at', op.completed_at,
      'updated_at', op.updated_at
    ) end,
    'prefill', jsonb_build_object(
      'name', c.name,
      'entity_type', c.entity_type,
      'org_type', c.org_type,
      'org_address', c.org_address,
      'fiscal_year_end', v_fye,
      'user_name', me.name,
      'user_email', lower(me.email)
    ),
    'complete', op.completed_at is not null,
    'has_get_to_know', v_has_gtk,
    'contacts_enabled', v_on
  );
  if not v_on then
    return v_out;
  end if;

  -- Gate on: greeting, people (never notes, role, source, created_by, updated_by), main prefill.
  if op.client_id is not null then
    v_out := jsonb_set(v_out, '{profile,greeting_name}', coalesce(to_jsonb(op.greeting_name), 'null'::jsonb));
  end if;
  select * into v_main from client_contacts k
   where k.client_id = me.client_id and k.is_main and k.deleted_at is null;
  v_pemail := lower(nullif(btrim(op.contact_email), ''));
  if v_main.id is not null then
    v_prefill := jsonb_build_object('name', v_main.name, 'email', lower(v_main.email),
      'phone', case when v_pemail = lower(v_main.email) then nullif(btrim(op.contact_phone), '') end);
  elsif v_pemail is not null
        and exists (select 1 from client_contacts d where d.client_id = me.client_id and d.email = v_pemail and d.deleted_at is not null)
        and not exists (select 1 from client_contacts l where l.client_id = me.client_id and l.email = v_pemail and l.deleted_at is null) then
    v_prefill := jsonb_build_object('name', null, 'email', null, 'phone', null);   -- tombstoned: client picks again
  else
    v_prefill := jsonb_build_object('name', nullif(btrim(op.contact_name), ''), 'email', v_pemail,
                                    'phone', nullif(btrim(op.contact_phone), ''));
  end if;
  return v_out || jsonb_build_object(
    'main_prefill', v_prefill,
    'people', coalesce((
      select jsonb_agg(jsonb_build_object('id', k.id, 'name', k.name, 'email', lower(k.email), 'title', k.title,
                                          'gets_monthly_emails', k.gets_monthly_emails,
                                          'can_answer', k.can_answer_requests, 'is_main', k.is_main)
                       order by k.is_main desc, k.gets_monthly_emails desc, k.can_answer_requests desc, k.name, lower(k.email))
        from client_contacts k
       where k.client_id = me.client_id and k.deleted_at is null), '[]'::jsonb));
end;
$function$;

create or replace function public.client_org_profile_save(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  me client_users;
  v_old client_org_profile;
  v_card text; v_type text; v_est_txt text; v_est date; v_unknown boolean;
  v_same boolean; v_gift text; v_recv text; v_cphone text;
  v_cname text; v_cemail text; v_ctel text; v_fye text;
  v_gtk_in jsonb; v_gtk jsonb;
  v_complete boolean;
  v_completed_at timestamptz; v_completed_by text;
  v_changed text[] := '{}';
  v_phone_re text := '^[0-9+().\-\s x]+$';
  -- client contacts (gate on only)
  v_on boolean;
  v_greet text;
  v_people jsonb; v_up jsonb; v_rm jsonb; e jsonb;
  v_i int;
  v_lbl text;
  v_id uuid; v_row client_contacts; v_main_id uuid; v_hit uuid;
  v_pname text; v_pemail text; v_ptitle text; v_pmonthly boolean; v_pcan boolean;
  v_seen text[] := '{}';
  v_before int; v_after int;
  v_added int := 0; v_updated int := 0; v_removed int := 0; v_main_changed boolean := false;
begin
  if public.is_active_staff()
     or exists (select 1 from staff s where lower(s.email) = lower(auth.jwt() ->> 'email')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  me := st_my_client_user();
  if me.email is null or coalesce(me.access, 'full') <> 'full' then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'payload must be an object' using errcode = '22023';
  end if;
  v_on := public.op__contacts_on(me.client_id);
  if octet_length(p::text) > (case when v_on then 24576 else 16384 end) then
    raise exception 'payload is too large' using errcode = '22023';
  end if;

  v_card   := public.op__txt(p, 'card_name', 200);
  v_type   := public.op__txt(p, 'org_type', 120);
  v_unknown := public.op__bool(p, 'established_unknown');
  v_est_txt := public.op__txt(p, 'established_date', 10);
  if v_est_txt is not null then
    if v_est_txt !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'established_date must be a date (YYYY-MM-DD)' using errcode = '22023';
    end if;
    begin
      v_est := v_est_txt::date;
    exception when others then
      raise exception 'established_date must be a date (YYYY-MM-DD)' using errcode = '22023';
    end;
    if v_est < date '1800-01-01' or v_est > current_date then
      raise exception 'established_date must be between 1800-01-01 and today' using errcode = '22023';
    end if;
  end if;
  if v_unknown then
    v_est := null;
  end if;

  v_same := public.op__bool(p, 'gift_same_as_org');
  if v_same then
    select nullif(btrim(c.org_address), '') into v_gift from clients c where c.id = me.client_id;
    if v_gift is null then
      raise exception 'gift_address: the organization address is empty, so it cannot be copied' using errcode = '22023';
    end if;
    v_gift := left(v_gift, 500);
  else
    v_gift := public.op__txt(p, 'gift_address', 500);
  end if;

  v_recv   := public.op__txt(p, 'receiver_name', 120);
  v_cphone := public.op__txt(p, 'courier_phone', 40);
  if v_cphone is not null and v_cphone !~ v_phone_re then
    raise exception 'courier_phone has characters a phone number cannot have' using errcode = '22023';
  end if;
  v_cname  := public.op__txt(p, 'contact_name', 120);
  v_cemail := lower(public.op__txt(p, 'contact_email', 254));
  if v_cemail is not null and v_cemail !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'contact_email is not a valid email address' using errcode = '22023';
  end if;
  if v_on then
    -- Stricter rules under the gate (spec section 2).
    if v_cemail is not null and not public.cc__email_ok(v_cemail) then
      raise exception 'contact_email is not a valid email address' using errcode = '22023';
    end if;
    if v_cname is not null and v_cname ~ '[[:cntrl:]]' then
      raise exception 'contact_name has characters a name cannot have' using errcode = '22023';
    end if;
  end if;
  v_ctel   := public.op__txt(p, 'contact_phone', 40);
  if v_ctel is not null and v_ctel !~ v_phone_re then
    raise exception 'contact_phone has characters a phone number cannot have' using errcode = '22023';
  end if;
  v_fye    := public.op__txt(p, 'fiscal_year_end', 10);
  if v_fye is not null then
    if v_fye !~ '^[0-9]{2}-[0-9]{2}$' then
      raise exception 'fiscal_year_end must be MM-DD' using errcode = '22023';
    end if;
    begin
      perform ('2024-' || v_fye)::date;   -- 2024 is a leap year: 02-29 ok, 02-30 not
    exception when others then
      raise exception 'fiscal_year_end must be a real month and day (MM-DD)' using errcode = '22023';
    end;
  end if;

  v_gtk_in := p -> 'get_to_know';
  if v_gtk_in is not null and jsonb_typeof(v_gtk_in) <> 'null' then
    if jsonb_typeof(v_gtk_in) <> 'object' then
      raise exception 'get_to_know must be an object' using errcode = '22023';
    end if;
    v_gtk := jsonb_strip_nulls(jsonb_build_object(
      'favorite_treat', public.op__txt(v_gtk_in, 'favorite_treat', 300, 'get_to_know.favorite_treat'),
      'coffee_or_tea',  public.op__txt(v_gtk_in, 'coffee_or_tea', 300, 'get_to_know.coffee_or_tea'),
      'allergies',      public.op__txt(v_gtk_in, 'allergies', 300, 'get_to_know.allergies'),
      'hobbies',        public.op__txt(v_gtk_in, 'hobbies', 300, 'get_to_know.hobbies'),
      'team_note',      public.op__txt(v_gtk_in, 'team_note', 300, 'get_to_know.team_note')
    ));
    if v_gtk = '{}'::jsonb then
      v_gtk := null;
    end if;
  end if;

  -- Gate on: greeting + people payload shape checks (gate off: ignored entirely).
  if v_on then
    v_greet := public.op__txt(p, 'greeting_name', 80);
    if v_greet is not null then
      if v_greet ~ '[[:cntrl:]]' then
        raise exception 'greeting_name has characters a name cannot have' using errcode = '22023';
      end if;
      v_greet := regexp_replace(v_greet, '^\s*(hi|hello|dear)\y[\s,:]*', '', 'i');
      v_greet := regexp_replace(v_greet, '[\s,:]+$', '');
      v_greet := nullif(btrim(v_greet), '');
    end if;
    v_people := p -> 'people';
    if v_people is not null and jsonb_typeof(v_people) <> 'null' then
      if jsonb_typeof(v_people) <> 'object' then
        raise exception 'people must be an object' using errcode = '22023';
      end if;
      v_up := coalesce(v_people -> 'upsert', '[]'::jsonb);
      v_rm := coalesce(v_people -> 'remove', '[]'::jsonb);
      if jsonb_typeof(v_up) = 'null' then v_up := '[]'::jsonb; end if;
      if jsonb_typeof(v_rm) = 'null' then v_rm := '[]'::jsonb; end if;
      if jsonb_typeof(v_up) <> 'array' or jsonb_typeof(v_rm) <> 'array' then
        raise exception 'people.upsert and people.remove must be lists' using errcode = '22023';
      end if;
      if jsonb_array_length(v_up) > 25 or jsonb_array_length(v_rm) > 25 then
        raise exception 'people_limit: at most 25 changes at a time' using errcode = '22023';
      end if;
    else
      v_up := '[]'::jsonb;
      v_rm := '[]'::jsonb;
    end if;
  end if;

  v_complete := v_card is not null and v_type is not null
    and (v_est is not null or v_unknown)
    and v_gift is not null and v_recv is not null and v_cphone is not null
    and v_cname is not null
    and (case when v_on then v_cemail is not null else (v_cemail is not null or v_ctel is not null) end)
    and v_fye is not null;

  if v_on then
    -- Serialize, then turn the current org-profile person into a row (before the profile changes).
    perform public.cc__lock(me.client_id);
    perform public.cc__materialize(me.client_id);
  end if;

  select * into v_old from client_org_profile where client_id = me.client_id for update;
  v_completed_at := case when not v_complete then null else coalesce(v_old.completed_at, now()) end;
  v_completed_by := case when not v_complete then null
                         when v_old.completed_at is not null then v_old.completed_by
                         else lower(me.email) end;

  if v_old.card_name is distinct from v_card then v_changed := array_append(v_changed, 'card_name'); end if;
  if v_old.org_type is distinct from v_type then v_changed := array_append(v_changed, 'org_type'); end if;
  if v_old.established_date is distinct from v_est then v_changed := array_append(v_changed, 'established_date'); end if;
  if v_old.established_unknown is distinct from v_unknown then v_changed := array_append(v_changed, 'established_unknown'); end if;
  if v_old.gift_address is distinct from v_gift then v_changed := array_append(v_changed, 'gift_address'); end if;
  if v_old.gift_same_as_org is distinct from v_same then v_changed := array_append(v_changed, 'gift_same_as_org'); end if;
  if v_old.receiver_name is distinct from v_recv then v_changed := array_append(v_changed, 'receiver_name'); end if;
  if v_old.courier_phone is distinct from v_cphone then v_changed := array_append(v_changed, 'courier_phone'); end if;
  if v_old.contact_name is distinct from v_cname then v_changed := array_append(v_changed, 'contact_name'); end if;
  if v_old.contact_email is distinct from v_cemail then v_changed := array_append(v_changed, 'contact_email'); end if;
  if v_old.contact_phone is distinct from v_ctel then v_changed := array_append(v_changed, 'contact_phone'); end if;
  if v_old.fiscal_year_end is distinct from v_fye then v_changed := array_append(v_changed, 'fiscal_year_end'); end if;
  if v_on and v_old.greeting_name is distinct from v_greet then v_changed := array_append(v_changed, 'greeting_name'); end if;

  insert into client_org_profile (
    client_id, card_name, org_type, established_date, established_unknown,
    gift_address, gift_same_as_org, receiver_name, courier_phone,
    contact_name, contact_email, contact_phone, fiscal_year_end,
    completed_at, completed_by, updated_at, updated_by, greeting_name
  ) values (
    me.client_id, v_card, v_type, v_est, v_unknown,
    v_gift, v_same, v_recv, v_cphone,
    v_cname, v_cemail, v_ctel, v_fye,
    v_completed_at, v_completed_by, now(), lower(me.email),
    case when v_on then v_greet end
  )
  on conflict (client_id) do update set
    card_name = excluded.card_name,
    org_type = excluded.org_type,
    established_date = excluded.established_date,
    established_unknown = excluded.established_unknown,
    gift_address = excluded.gift_address,
    gift_same_as_org = excluded.gift_same_as_org,
    receiver_name = excluded.receiver_name,
    courier_phone = excluded.courier_phone,
    contact_name = excluded.contact_name,
    contact_email = excluded.contact_email,
    contact_phone = excluded.contact_phone,
    fiscal_year_end = excluded.fiscal_year_end,
    completed_at = excluded.completed_at,
    completed_by = excluded.completed_by,
    updated_at = excluded.updated_at,
    updated_by = excluded.updated_by,
    greeting_name = case when v_on then excluded.greeting_name else client_org_profile.greeting_name end;

  if v_gtk is not null then
    insert into client_get_to_know (client_id, answers, submitted_by, submitted_at)
    values (me.client_id, v_gtk, lower(me.email), now())
    on conflict (client_id) do update set
      answers = excluded.answers,
      submitted_by = excluded.submitted_by,
      submitted_at = excluded.submitted_at;
  end if;

  if v_on then
    -- Greeting fill-blank on the staff table: update only, greeting_name only, never overwrite.
    if v_greet is not null then
      update client_profile set greeting_name = v_greet
       where client_id = me.client_id and nullif(btrim(greeting_name), '') is null;
    end if;

    select count(*) into v_before from client_contacts k where k.client_id = me.client_id and k.deleted_at is null;
    select k.id into v_main_id from client_contacts k where k.client_id = me.client_id and k.is_main and k.deleted_at is null;

    -- Removes (soft delete; own client's live rows only; never the main row).
    for v_i in 0 .. jsonb_array_length(v_rm) - 1 loop
      e := v_rm -> v_i;
      v_lbl := 'people.remove[' || (v_i + 1) || ']';
      v_id := null;
      if jsonb_typeof(e) = 'string' then
        begin
          v_id := (e #>> '{}')::uuid;
        exception when others then
          v_id := null;
        end;
      end if;
      if v_id is null or not exists (select 1 from client_contacts k where k.id = v_id and k.client_id = me.client_id and k.deleted_at is null) then
        raise exception 'people_id: % is not one of your contacts', v_lbl using errcode = '22023';
      end if;
      if v_id = v_main_id then
        raise exception 'people_remove_main: % is the main contact', v_lbl using errcode = '22023';
      end if;
      update client_contacts set deleted_at = now() where id = v_id;
      v_removed := v_removed + 1;
    end loop;

    -- Upserts (changes only; unknown keys ignored, no record populate).
    for v_i in 0 .. jsonb_array_length(v_up) - 1 loop
      e := v_up -> v_i;
      v_lbl := 'people[' || (v_i + 1) || ']';
      if jsonb_typeof(e) <> 'object' then
        raise exception '% must be an object', v_lbl using errcode = '22023';
      end if;
      v_id := null;
      if e ? 'id' and jsonb_typeof(e -> 'id') <> 'null' then
        if jsonb_typeof(e -> 'id') = 'string' then
          begin
            v_id := (e ->> 'id')::uuid;
          exception when others then
            v_id := null;
          end;
        end if;
        if v_id is null or not exists (select 1 from client_contacts k where k.id = v_id and k.client_id = me.client_id and k.deleted_at is null)
           or v_id = v_main_id then
          raise exception 'people_id: % is not one of your contacts', v_lbl using errcode = '22023';
        end if;
      end if;
      v_pname := public.op__txt(e, 'name', 120, v_lbl || '.name');
      if v_pname is null then
        raise exception '%.name is required', v_lbl using errcode = '22023';
      end if;
      v_pemail := lower(public.op__txt(e, 'email', 254, v_lbl || '.email'));
      if v_pemail is null then
        raise exception '%.email is required', v_lbl using errcode = '22023';
      end if;
      if not public.cc__email_ok(v_pemail) then
        raise exception '%.email is not a valid email address', v_lbl using errcode = '22023';
      end if;
      v_ptitle := public.op__txt(e, 'title', 120, v_lbl || '.title');
      if v_pname ~ '[[:cntrl:]]' then
        raise exception '%.name has characters a name cannot have', v_lbl using errcode = '22023';
      end if;
      if v_ptitle is not null and v_ptitle ~ '[[:cntrl:]]' then
        raise exception '%.title has characters a title cannot have', v_lbl using errcode = '22023';
      end if;
      v_pmonthly := public.op__bool(e, 'gets_monthly_emails');
      v_pcan := public.op__bool(e, 'can_answer');
      if v_pemail = any (v_seen) or v_pemail = v_cemail then
        raise exception 'people_email_duplicate: %.email is already in the list', v_lbl using errcode = '22023';
      end if;
      v_seen := array_append(v_seen, v_pemail);

      select k.id into v_hit from client_contacts k
       where k.client_id = me.client_id and k.email = v_pemail and k.deleted_at is null;
      if v_hit is not null and v_hit = v_main_id then
        -- The main row is edited only through the main-contact fields.
        raise exception 'people_email_duplicate: %.email is already in the list', v_lbl using errcode = '22023';
      end if;
      if v_id is null then
        v_id := v_hit;   -- merge by email (may be null: new row)
      elsif v_hit is not null and v_hit <> v_id then
        raise exception 'people_email_duplicate: %.email is already in the list', v_lbl using errcode = '22023';
      end if;

      if v_id is null then
        insert into client_contacts (client_id, name, email, title, gets_monthly_emails, can_answer_requests, source, created_by)
        values (me.client_id, v_pname, v_pemail, v_ptitle, v_pmonthly, v_pcan, 'client', lower(me.email));
        v_added := v_added + 1;
      else
        update client_contacts
           set name = v_pname, email = v_pemail, title = v_ptitle,
               gets_monthly_emails = v_pmonthly, can_answer_requests = v_pcan
         where id = v_id
           and (name, email, title, gets_monthly_emails, can_answer_requests)
               is distinct from (v_pname, v_pemail, v_ptitle, v_pmonthly, v_pcan);
        if found then
          v_updated := v_updated + 1;
        end if;
      end if;
    end loop;

    -- Main-contact mirror (only with an email).
    if v_cemail is not null then
      select k.id into v_hit from client_contacts k
       where k.client_id = me.client_id and k.email = v_cemail and k.deleted_at is null;
      if v_main_id is not null and v_main_id is distinct from v_hit then
        update client_contacts set is_main = false where id = v_main_id;
        v_main_changed := true;
      end if;
      if v_hit is not null then
        update client_contacts
           set is_main = true, gets_monthly_emails = true, name = coalesce(v_cname, name)
         where id = v_hit
           and (not is_main or not gets_monthly_emails or name is distinct from coalesce(v_cname, name));
        if v_main_id is distinct from v_hit then
          v_main_changed := true;
        end if;
      else
        insert into client_contacts (client_id, name, email, is_main, gets_monthly_emails, can_answer_requests, source, created_by)
        values (me.client_id, coalesce(v_cname, v_cemail), v_cemail, true, true, true, 'client', lower(me.email));
        v_added := v_added + 1;
        v_main_changed := true;
      end if;
    end if;

    -- Live cap: refuse only an increase above 25.
    select count(*) into v_after from client_contacts k where k.client_id = me.client_id and k.deleted_at is null;
    if v_after > 25 and v_after > v_before then
      raise exception 'people_limit: at most 25 people' using errcode = '22023';
    end if;

    if v_added + v_updated + v_removed > 0 or v_main_changed then
      perform audit_write('client.contacts_updated', me.client_id, 'client', me.client_id,
        jsonb_build_object('added', v_added, 'updated', v_updated, 'removed', v_removed, 'main_changed', v_main_changed));
    end if;
  end if;

  perform audit_write('client.org_profile_updated', me.client_id, 'client', me.client_id,
    jsonb_build_object(
      'changed', to_jsonb(v_changed),
      'completed', v_complete,
      'gtk_replaced', v_gtk is not null
    ));

  return public.client_org_profile_mine();
end;
$function$;

create or replace function public.tk_request_recipients(p_client_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
begin
  perform public.tk__req_staff_guard(p_client_id);
  return jsonb_build_object(
    'portal', coalesce((
      select jsonb_agg(jsonb_build_object('email', lower(cu.email), 'name', cu.name, 'role', cu.role,
                                          'opted_out', exists (select 1 from client_email_recipients er
                                                                where er.client_id = cu.client_id and lower(er.email) = lower(cu.email)
                                                                  and er.opted_out_at is not null))
                       order by cu.name)
        from client_users cu where cu.client_id = p_client_id and cu.active), '[]'::jsonb),
    'contacts', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'email', c.email, 'role', c.role,
                                          'can_answer', c.can_answer_requests, 'notes', c.notes,
                                          'source', c.source, 'title', c.title)
                       order by c.name)
        from client_contacts c where c.client_id = p_client_id and c.deleted_at is null), '[]'::jsonb));
end $function$;

-- 4. New staff RPC ----------------------------------------------------------------
create or replace function public.staff_client_contact_save(p_client_id text, p jsonb, p_preview boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_client text;
  r client_contacts;
  v_on boolean;
  v_name text; v_email text; v_title text; v_role text; v_notes text;
  v_monthly boolean; v_can boolean; v_main boolean;
  v_changed text[] := '{}';
  v_me text := public.tk__me();
  v_old_main uuid;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'tk_bad_contact' using errcode = '22023';
  end if;
  if octet_length(p::text) > 8192 then
    raise exception 'tk_bad_contact' using errcode = '22023';
  end if;
  if p ? 'id' and jsonb_typeof(p -> 'id') <> 'null' then
    begin
      v_id := (p ->> 'id')::uuid;
    exception when others then
      raise exception 'tk_not_found' using errcode = 'P0002';
    end;
    select k.client_id into v_client from client_contacts k where k.id = v_id and k.deleted_at is null;
    if v_client is null or v_client is distinct from p_client_id then
      raise exception 'tk_not_found' using errcode = 'P0002';
    end if;
  else
    v_client := p_client_id;
  end if;
  perform public.tk__req_staff_guard(v_client);
  v_on := public.op__contacts_on(v_client);
  if not v_on and not (coalesce(p_preview, false) and coalesce(public.is_active_staff_admin(), false)) then
    raise exception 'cc_off' using errcode = '42501';
  end if;

  perform public.cc__lock(v_client);
  perform public.cc__materialize(v_client);
  if v_id is not null then
    select * into r from client_contacts k where k.id = v_id and k.deleted_at is null for update;
    if r.id is null then
      raise exception 'tk_not_found' using errcode = 'P0002';
    end if;
  end if;

  -- Fields (same lengths as the table checks).
  begin
    v_name  := public.op__txt(p, 'name', 120);
    v_email := lower(public.op__txt(p, 'email', 254));
    v_title := public.op__txt(p, 'title', 120);
    v_role  := public.op__txt(p, 'role', 20);
    v_notes := public.op__txt(p, 'notes', 500);
  exception when sqlstate '22023' then
    raise exception 'tk_bad_contact' using errcode = '22023';
  end;
  if v_name is null or v_name ~ '[[:cntrl:]]'
     or not public.cc__email_ok(v_email)
     or (v_title is not null and v_title ~ '[[:cntrl:]]')
     or (v_role is not null and v_role not in ('treasurer', 'pastor', 'board', 'finance', 'other')) then
    raise exception 'tk_bad_contact' using errcode = '22023';
  end if;
  begin
    v_monthly := case when p ? 'gets_monthly_emails' then public.op__bool(p, 'gets_monthly_emails')
                      else coalesce(r.gets_monthly_emails, false) end;
    v_can     := case when p ? 'can_answer' then public.op__bool(p, 'can_answer')
                      else coalesce(r.can_answer_requests, true) end;
    v_main    := case when p ? 'is_main' then public.op__bool(p, 'is_main')
                      else coalesce(r.is_main, false) end;
  exception when sqlstate '22023' then
    raise exception 'tk_bad_contact' using errcode = '22023';
  end;
  if r.id is not null and r.is_main and not v_main then
    raise exception 'cc_need_main' using errcode = '22023';
  end if;
  if exists (select 1 from client_contacts k where k.client_id = v_client and k.email = v_email
               and k.deleted_at is null and k.id is distinct from v_id) then
    raise exception 'tk_contact_exists' using errcode = '23505';
  end if;

  if v_main then
    select k.id into v_old_main from client_contacts k
     where k.client_id = v_client and k.is_main and k.deleted_at is null and k.id is distinct from v_id;
    if v_old_main is not null then
      update client_contacts set is_main = false where id = v_old_main;   -- its monthly flag stays
    end if;
  end if;

  if v_id is null then
    insert into client_contacts (client_id, name, email, title, role, notes, gets_monthly_emails,
                                 can_answer_requests, is_main, source, created_by)
    values (v_client, v_name, v_email, v_title, v_role, v_notes, v_monthly, v_can, v_main, 'staff', v_me)
    returning id into v_id;
    v_changed := array['created'];
  else
    if r.name is distinct from v_name then v_changed := array_append(v_changed, 'name'); end if;
    if r.email is distinct from v_email then v_changed := array_append(v_changed, 'email'); end if;
    if r.title is distinct from v_title then v_changed := array_append(v_changed, 'title'); end if;
    if r.role is distinct from v_role then v_changed := array_append(v_changed, 'role'); end if;
    if r.notes is distinct from v_notes then v_changed := array_append(v_changed, 'notes'); end if;
    if r.gets_monthly_emails is distinct from v_monthly then v_changed := array_append(v_changed, 'gets_monthly_emails'); end if;
    if r.can_answer_requests is distinct from v_can then v_changed := array_append(v_changed, 'can_answer'); end if;
    if r.is_main is distinct from v_main then v_changed := array_append(v_changed, 'is_main'); end if;
    if cardinality(v_changed) > 0 then
      update client_contacts
         set name = v_name, email = v_email, title = v_title, role = v_role, notes = v_notes,
             gets_monthly_emails = v_monthly, can_answer_requests = v_can, is_main = v_main
       where id = v_id;
      -- Gate off (admin preview path): the trigger is a no-op, so revoke here. Never a null id.
      if not v_on and (r.email is distinct from v_email or (r.can_answer_requests and not v_can)) then
        perform public.tk__revoke_tokens(null, 'contact_retired', coalesce(nullif(v_me, ''), 'system'), v_id);
      end if;
    end if;
  end if;

  perform audit_write('staff.client_contact_saved', v_client, 'client_contact', v_id::text,
    jsonb_build_object('client_id', v_client, 'contact_id', v_id, 'fields_changed', to_jsonb(v_changed)));

  return jsonb_build_object('id', v_id, 'contact_list', public.cc__people(v_client));
end $$;

-- 5. Owner-only switch key (all existing keys kept) --------------------------------
create or replace function public.tk__owner_only_key(p_key text)
returns boolean
language sql
immutable
set search_path = public
as $function$
  select p_key in ('mgb_home_enabled', 'client_request_enabled', 'client_request_pilot', 'standard_set_live',
                   'late_tasks_count_against_staff', 'late_tasks_effective_from',
                   'wb_enabled', 'desk_app_enabled', 'nav_enabled', 'lato_enabled',
                   'month_rhythm_enabled', 'slate_app_enabled',
                   'brand_enabled', 'hovernav_enabled',
                   'org_profile_enabled',
                   'deskplus_enabled',
                   'threadmenu_enabled',
                   'slateplus_enabled',
                   'client_page_drop_enabled', 'client_page_drop_pilot',
                   'client_upload_notify_enabled',
                   'members_area_open',
                   'members_staff_enabled',
                   'create_menu_enabled',
                   'slatesimple_enabled',
                   'desk_peek_enabled',
                   'reviewboard_enabled', 'reviewboard_digest_enabled', 'reviewboard_digest_to',
                   'org_contacts_enabled');
$function$;

-- 6. Grants -------------------------------------------------------------------------
-- Internal helpers: nobody (default privileges grant anon + authenticated directly).
revoke all on function public.op__contacts_on(text) from public, anon, authenticated;
revoke all on function public.cc__lock(text) from public, anon, authenticated;
revoke all on function public.cc__email_ok(text) from public, anon, authenticated;
revoke all on function public.cc__stamp_fn() from public, anon, authenticated;
revoke all on function public.cc__revoke_on_change_fn() from public, anon, authenticated;
revoke all on function public.cc__materialize(text) from public, anon, authenticated;
revoke all on function public.cc__people(text) from public, anon, authenticated;
-- Replaced functions keep their ACLs under CREATE OR REPLACE; restated here.
revoke all on function public.rb__main_contact(text) from public, anon, authenticated;
revoke all on function public.tk__owner_only_key(text) from public, anon, authenticated;
revoke all on function public.rb_board(date) from public, anon;
revoke all on function public.rb_draft_recipients(uuid) from public, anon;
revoke all on function public.staff_client_org_profile(text) from public, anon;
revoke all on function public.client_org_profile_mine() from public, anon;
revoke all on function public.client_org_profile_save(jsonb) from public, anon;
revoke all on function public.tk_request_recipients(text) from public, anon;
grant execute on function public.rb_board(date) to authenticated;
grant execute on function public.rb_draft_recipients(uuid) to authenticated;
grant execute on function public.staff_client_org_profile(text) to authenticated;
grant execute on function public.client_org_profile_mine() to authenticated;
grant execute on function public.client_org_profile_save(jsonb) to authenticated;
grant execute on function public.tk_request_recipients(text) to authenticated;
-- New staff RPC.
revoke all on function public.staff_client_contact_save(text, jsonb, boolean) from public, anon;
grant execute on function public.staff_client_contact_save(text, jsonb, boolean) to authenticated;

notify pgrst, 'reload schema';

commit;
