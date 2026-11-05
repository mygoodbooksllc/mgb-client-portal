-- Rollback for client-contacts.sql (client contacts in the org profile,
-- spec docs/client-contacts-spec.md section 14).
--
-- NOT run. Generated 2026-11-05 from the live pg_get_functiondef of the eight
-- functions client-contacts.sql replaces, BEFORE that migration was applied
-- (build step 0). Run by hand in the SQL editor only if the owner decides to
-- undo the build. The firm switch off (tk_settings org_contacts_enabled) is the
-- first-line rollback; with it off, only test clients (test_only) see anything.
--
-- What this does:
--   1. Re-creates the eight replaced functions from their pre-migration bodies.
--      CREATE OR REPLACE keeps each function's existing ACL; the grants are
--      restated explicitly afterwards anyway (pre-migration ACLs, read live):
--        rb__main_contact, tk__owner_only_key: postgres + service_role only
--        rb_board, rb_draft_recipients, staff_client_org_profile,
--        client_org_profile_mine, client_org_profile_save,
--        tk_request_recipients: postgres + authenticated + service_role
--   2. Drops the cc__stamp and cc__revoke_on_change triggers, then
--      staff_client_contact_save, cc__people, cc__materialize, cc__lock,
--      cc__email_ok, op__contacts_on, both trigger functions and the
--      client_contacts_one_main index.
--
-- What this does NOT do (owner's call):
--   - The new columns stay (client_contacts.is_main, gets_monthly_emails,
--     title, source, updated_by, edited_at; client_org_profile.greeting_name).
--     Dropping columns that hold client data is the owner's call. Readers
--     ignore them.
--   - Rows clients added stay live and keep showing in the tasks drawer and
--     Ask client (as can_answer false unless the client ticked it).
--   - The switch row tk_settings.org_contacts_enabled (if the owner made one)
--     is left alone; nothing reads it after the rollback.
-- The code rollback is a git revert of the build commit.

begin;

-- 1. Pre-migration bodies (verbatim) -------------------------------------------

CREATE OR REPLACE FUNCTION public.rb__main_contact(p_client text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.rb_board(p_period date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$
;

CREATE OR REPLACE FUNCTION public.rb_draft_recipients(p_task_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
                            where p.role in ('bookkeeper', 'account_manager')), '[]'::jsonb),
    'sent',      (select jsonb_build_object('by', e.sent_by, 'at', e.sent_at,
                                            'by_name', (select st.name from staff st
                                                         where lower(st.email) = e.sent_by
                                                         order by st.active desc limit 1))
                    from rb_email_sent e where e.task_id = p_task_id));
end $function$
;

CREATE OR REPLACE FUNCTION public.staff_client_org_profile(p_client_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  op client_org_profile;
  v_launch date;
  v_fye text;
  k client_get_to_know;
  v_gtk_ok boolean;
begin
  if not (public.is_active_staff() and public.can_access_client(p_client_id)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from clients where id = p_client_id) then
    raise exception 'unknown client' using errcode = '22023';
  end if;
  select * into op from client_org_profile where client_id = p_client_id;
  select cp.launch_date, cp.fiscal_year_end into v_launch, v_fye from client_profile cp where cp.client_id = p_client_id;
  select * into k from client_get_to_know where client_id = p_client_id;
  v_gtk_ok := public.op__can_read_gtk(p_client_id);

  return jsonb_build_object(
    'client_id', p_client_id,
    'profile', case when op.client_id is null then null else to_jsonb(op) - 'client_id' end,
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
    'get_to_know_submitted_at', case when v_gtk_ok then k.submitted_at end
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.client_org_profile_mine()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  me client_users;
  c clients;
  op client_org_profile;
  v_fye text;
  v_has_gtk boolean;
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

  return jsonb_build_object(
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
    'has_get_to_know', v_has_gtk
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.client_org_profile_save(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  if octet_length(p::text) > 16384 then
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

  v_complete := v_card is not null and v_type is not null
    and (v_est is not null or v_unknown)
    and v_gift is not null and v_recv is not null and v_cphone is not null
    and v_cname is not null and (v_cemail is not null or v_ctel is not null)
    and v_fye is not null;

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

  insert into client_org_profile (
    client_id, card_name, org_type, established_date, established_unknown,
    gift_address, gift_same_as_org, receiver_name, courier_phone,
    contact_name, contact_email, contact_phone, fiscal_year_end,
    completed_at, completed_by, updated_at, updated_by
  ) values (
    me.client_id, v_card, v_type, v_est, v_unknown,
    v_gift, v_same, v_recv, v_cphone,
    v_cname, v_cemail, v_ctel, v_fye,
    v_completed_at, v_completed_by, now(), lower(me.email)
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
    updated_by = excluded.updated_by;

  if v_gtk is not null then
    insert into client_get_to_know (client_id, answers, submitted_by, submitted_at)
    values (me.client_id, v_gtk, lower(me.email), now())
    on conflict (client_id) do update set
      answers = excluded.answers,
      submitted_by = excluded.submitted_by,
      submitted_at = excluded.submitted_at;
  end if;

  perform audit_write('client.org_profile_updated', me.client_id, 'client', me.client_id,
    jsonb_build_object(
      'changed', to_jsonb(v_changed),
      'completed', v_complete,
      'gtk_replaced', v_gtk is not null
    ));

  return public.client_org_profile_mine();
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tk_request_recipients(p_client_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
                                          'can_answer', c.can_answer_requests, 'notes', c.notes)
                       order by c.name)
        from client_contacts c where c.client_id = p_client_id and c.deleted_at is null), '[]'::jsonb));
end $function$
;

CREATE OR REPLACE FUNCTION public.tk__owner_only_key(p_key text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
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
                   'reviewboard_enabled', 'reviewboard_digest_enabled', 'reviewboard_digest_to');
$function$
;

-- Restate the pre-migration ACLs (CREATE OR REPLACE keeps them; this is explicit).
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

-- 2. Drop what the build added --------------------------------------------------
drop trigger if exists cc__stamp on public.client_contacts;
drop trigger if exists cc__revoke_on_change on public.client_contacts;
drop function if exists public.staff_client_contact_save(text, jsonb, boolean);
drop function if exists public.cc__people(text);
drop function if exists public.cc__materialize(text);
drop function if exists public.cc__lock(text);
drop function if exists public.cc__email_ok(text);
drop function if exists public.op__contacts_on(text);
drop function if exists public.cc__stamp_fn();
drop function if exists public.cc__revoke_on_change_fn();
drop index if exists public.client_contacts_one_main;

notify pgrst, 'reload schema';

commit;
