-- Team Reviews & Team Survey, part 2: the RPCs (owner request 2026-10-07).
-- Applied to production 2026-10-07 as migration team_reviews_2_rpcs.
-- Needs team-reviews-1-schema.sql first. Safe to re-run.
--
-- Every function here is SECURITY DEFINER and checks the caller itself:
--   * tr_me() resolves the caller to an active public.staff row by JWT email;
--     no staff row = "Team Reviews is for MyGoodBooks staff." (clients never get in).
--   * admin = staff.role 'admin'.
--   * reads that include scores go through tr_submission_json (blind rule).
-- The team-reviews edge function uses the service-role-only helpers at the
-- bottom (tr_review_doc, tr_year_doc, tr_kick, tr_cron).

-- ---------------------------------------------------------------------------
-- Small helpers
-- ---------------------------------------------------------------------------
create or replace function public.tr_require_staff()
returns public.staff language plpgsql stable security definer set search_path = public as $$
declare me staff;
begin
  select * into me from staff
  where lower(email) = lower(auth.jwt() ->> 'email') and active = true limit 1;
  if me.id is null then
    raise exception 'Team Reviews is for MyGoodBooks staff.' using errcode = '42501';
  end if;
  return me;
end $$;

create or replace function public.tr_require_admin()
returns public.staff language plpgsql stable security definer set search_path = public as $$
declare me staff := tr_require_staff();
begin
  if me.role <> 'admin' then
    raise exception 'Only admins can do that.' using errcode = '42501';
  end if;
  return me;
end $$;

create or replace function public.tr_cycle_label(p_cycle uuid)
returns text language sql stable security definer set search_path = public as $$
  select 'Q' || quarter || ' ' || year from review_cycles where id = p_cycle;
$$;

create or replace function public.tr_ack(p_role text)
returns text language sql immutable as $$
  -- Verbatim from the spec. Do not reword without the owner.
  select case p_role
    when 'staff' then 'I have reviewed these results and the agreed action steps.'
    when 'reviewer' then 'I completed this review and discussed it with the team member.'
  end;
$$;

create or replace function public.tr_request_ip()
returns inet language plpgsql stable as $$
declare h json; v text;
begin
  begin
    h := nullif(current_setting('request.headers', true), '')::json;
  exception when others then return null;
  end;
  if h is null then return null; end if;
  v := coalesce(nullif(btrim(h ->> 'cf-connecting-ip'), ''),
                nullif(btrim(h ->> 'x-real-ip'), ''),
                nullif(btrim(split_part(coalesce(h ->> 'x-forwarded-for', ''), ',', 1)), ''));
  if v is null then return null; end if;
  begin
    return v::inet;
  exception when others then return null;
  end;
end $$;

create or replace function public.tr_request_ua()
returns text language plpgsql stable as $$
begin
  return left(nullif(current_setting('request.headers', true), '')::json ->> 'user-agent', 500);
exception when others then return null;
end $$;

-- Does either submission need an action step? (any rating < 3 or total < 18)
create or replace function public.tr_needs_action_step(s public.review_submissions)
returns boolean language sql immutable as $$
  select s.id is not null and s.cam_behavior is not null and (
    least(s.cam_behavior, s.cam_success, s.own_behavior, s.own_success, s.hh_behavior, s.hh_success) < 3
    or public.tr_sub_total(s) < 18);
$$;

create or replace function public.tr_has_signatures(p_review uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from review_signatures where review_id = p_review);
$$;

-- Copy open / in-progress steps from earlier locked or closed reviews into
-- this person's newest unsigned review, marking the originals 'carried'.
create or replace function public.tr_carry_forward(p_staff uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_target uuid; v_rank int; st action_steps;
begin
  select r.id, c.year * 4 + c.quarter into v_target, v_rank
  from reviews r join review_cycles c on c.id = r.cycle_id
  where r.staff_id = p_staff and r.status in ('open', 'comparing')
    and not exists (select 1 from review_signatures g where g.review_id = r.id)
  order by c.year desc, c.quarter desc limit 1;
  if v_target is null then return; end if;
  for st in
    select a.* from action_steps a
    join reviews r on r.id = a.review_id
    join review_cycles c on c.id = r.cycle_id
    where a.staff_id = p_staff and a.status in ('open', 'in_progress')
      and r.status in ('signed', 'closed_unsigned') and c.year * 4 + c.quarter < v_rank
    order by a.created_at
  loop
    insert into action_steps (review_id, staff_id, section, description, owner, due_date, status, carried_from, created_by)
    values (v_target, p_staff, st.section, st.description, st.owner, st.due_date, st.status, st.id, st.created_by);
    update action_steps set status = 'carried' where id = st.id;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Settings and pickers (admin)
-- ---------------------------------------------------------------------------
create or replace function public.tr_admin_options()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me staff := tr_require_admin();
begin
  return jsonb_build_object(
    'default_reviewer_id', (select default_reviewer_id from review_settings where id = 1),
    'staff', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'email', email, 'role', role) order by name)
                       from staff where active), '[]'::jsonb));
end $$;

create or replace function public.tr_set_default_reviewer(p_reviewer uuid)
returns void language plpgsql security definer set search_path = public as $$
declare me staff := tr_require_admin();
begin
  if not exists (select 1 from staff where id = p_reviewer and active and role = 'admin') then
    raise exception 'The default reviewer must be an active admin.';
  end if;
  update review_settings set default_reviewer_id = p_reviewer, updated_at = now(), updated_by = me.id where id = 1;
end $$;

-- ---------------------------------------------------------------------------
-- Cycles
-- ---------------------------------------------------------------------------
-- p_reviewers: optional {"<staff id>": "<reviewer staff id>"} overrides.
create or replace function public.tr_add_reviewees(p_cycle uuid, p_staff_ids uuid[], p_reviewers jsonb default '{}'::jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare
  me staff := tr_require_admin();
  c review_cycles; v_staff staff; v_reviewer uuid; v_default uuid; v_review uuid; n int := 0; sid uuid;
begin
  select * into c from review_cycles where id = p_cycle;
  if c.id is null or c.status <> 'open' then raise exception 'That cycle is not open.'; end if;
  select default_reviewer_id into v_default from review_settings where id = 1;
  foreach sid in array coalesce(p_staff_ids, '{}') loop
    select * into v_staff from staff where id = sid and active;
    if v_staff.id is null then raise exception 'Only active staff can be reviewed.'; end if;
    if exists (select 1 from reviews where cycle_id = c.id and staff_id = sid) then continue; end if;
    v_reviewer := coalesce(nullif(p_reviewers ->> sid::text, '')::uuid, v_default);
    if v_reviewer is null or v_reviewer = sid then
      raise exception 'Pick a different reviewer for %. Nobody can review themselves.', v_staff.name;
    end if;
    if not exists (select 1 from staff where id = v_reviewer and active and role = 'admin') then
      raise exception 'The reviewer for % must be an active admin.', v_staff.name;
    end if;
    insert into reviews (cycle_id, staff_id, reviewer_id) values (c.id, sid, v_reviewer) returning id into v_review;
    perform tr_carry_forward(sid);
    insert into review_events (review_id, cycle_id, kind, actor_id) values (v_review, c.id, 'reviewee_added', me.id);
    perform tr_notify('cycle_opened', sid, v_review, c.id,
      jsonb_build_object('cycle', tr_cycle_label(c.id), 'due_at', c.due_at), 'opened:' || v_review);
    perform tr_notify('review_assigned', v_reviewer, v_review, c.id,
      jsonb_build_object('cycle', tr_cycle_label(c.id), 'due_at', c.due_at, 'staff_name', v_staff.name), 'assigned:' || v_review || ':' || v_reviewer);
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.tr_open_cycle(p_year int, p_quarter int, p_opens date, p_due date,
                                                p_staff_ids uuid[], p_reviewers jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare me staff := tr_require_admin(); v_id uuid;
begin
  if coalesce(array_length(p_staff_ids, 1), 0) = 0 then raise exception 'Pick at least one person to review.'; end if;
  if exists (select 1 from review_cycles where year = p_year and quarter = p_quarter) then
    raise exception 'Q% % already has a cycle.', p_quarter, p_year;
  end if;
  insert into review_cycles (year, quarter, opens_at, due_at, created_by)
  values (p_year, p_quarter, coalesce(p_opens, current_date), p_due, me.id) returning id into v_id;
  insert into review_events (cycle_id, kind, actor_id) values (v_id, 'cycle_opened', me.id);
  perform tr_add_reviewees(v_id, p_staff_ids, p_reviewers);
  return v_id;
end $$;

-- Reviews that would close unsigned (for the confirmation dialog).
create or replace function public.tr_close_cycle_preview(p_cycle uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me staff := tr_require_admin();
begin
  return coalesce((select jsonb_agg(jsonb_build_object('review_id', r.id, 'staff_name', s.name, 'status', r.status) order by s.name)
    from reviews r join staff s on s.id = r.staff_id
    where r.cycle_id = p_cycle and r.status in ('open', 'comparing')), '[]'::jsonb);
end $$;

create or replace function public.tr_close_cycle(p_cycle uuid)
returns int language plpgsql security definer set search_path = public as $$
declare me staff := tr_require_admin(); r reviews; n int := 0;
begin
  if not exists (select 1 from review_cycles where id = p_cycle and status = 'open') then
    raise exception 'That cycle is already closed.';
  end if;
  for r in select * from reviews where cycle_id = p_cycle and status in ('open', 'comparing') loop
    update reviews set status = 'closed_unsigned', closed_reason = 'Cycle closed', closed_at = now(), closed_by = me.id
    where id = r.id;
    insert into review_events (review_id, cycle_id, kind, actor_id, reason) values (r.id, p_cycle, 'close_unsigned', me.id, 'Cycle closed');
    perform tr_carry_forward(r.staff_id);
    n := n + 1;
  end loop;
  update review_cycles set status = 'closed', closed_at = now(), closed_by = me.id where id = p_cycle;
  insert into review_events (cycle_id, kind, actor_id) values (p_cycle, 'cycle_closed', me.id);
  return n;
end $$;

create or replace function public.tr_close_review_unsigned(p_review uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare me staff := tr_require_admin(); r reviews;
begin
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'Add a reason for closing this review unsigned.'; end if;
  select * into r from reviews where id = p_review for update;
  if r.id is null or r.status not in ('open', 'comparing') then raise exception 'Only an open review can be closed unsigned.'; end if;
  update reviews set status = 'closed_unsigned', closed_reason = left(btrim(p_reason), 1000), closed_at = now(), closed_by = me.id
  where id = r.id;
  insert into review_events (review_id, cycle_id, kind, actor_id, reason) values (r.id, r.cycle_id, 'close_unsigned', me.id, left(btrim(p_reason), 2000));
  perform tr_carry_forward(r.staff_id);
end $$;

create or replace function public.tr_reassign_reviewer(p_review uuid, p_reviewer uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare me staff := tr_require_admin(); r reviews; m review_submissions; v_staff_name text;
begin
  select * into r from reviews where id = p_review for update;
  if r.id is null or r.status <> 'open' then raise exception 'Only an open review can get a new reviewer.'; end if;
  if p_reviewer = r.reviewer_id then return; end if;
  if p_reviewer = r.staff_id then raise exception 'Nobody can review themselves.'; end if;
  if not exists (select 1 from staff where id = p_reviewer and active and role = 'admin') then
    raise exception 'The reviewer must be an active admin.';
  end if;
  select * into m from review_submissions where review_id = r.id and kind = 'manager';
  if m.submitted_at is not null then raise exception 'The manager review is already submitted. Reopen it first.'; end if;
  insert into review_events (review_id, cycle_id, kind, actor_id, reason, snapshot)
  values (r.id, r.cycle_id, 'reassign', me.id, left(p_reason, 2000),
          jsonb_build_object('from_reviewer', r.reviewer_id, 'to_reviewer', p_reviewer,
                             'draft', case when m.id is null then null else to_jsonb(m) end));
  if m.id is not null then
    -- The old reviewer's draft is not handed to the new reviewer.
    perform set_config('tr.reassign', 'on', true);
    update review_submissions set author_id = p_reviewer,
      cam_behavior = null, cam_success = null, own_behavior = null, own_success = null, hh_behavior = null, hh_success = null,
      comment_camaraderie = null, comment_ownership = null, comment_healthy_hustle = null, action_steps = null,
      appreciation = null, coaching = null, evaluation = null
    where id = m.id;
    perform set_config('tr.reassign', 'off', true);
  end if;
  update reviews set reviewer_id = p_reviewer where id = r.id;
  select name into v_staff_name from staff where id = r.staff_id;
  perform tr_notify('review_assigned', p_reviewer, r.id, r.cycle_id,
    jsonb_build_object('cycle', tr_cycle_label(r.cycle_id), 'due_at', (select due_at from review_cycles where id = r.cycle_id),
                       'staff_name', v_staff_name), 'assigned:' || r.id || ':' || p_reviewer);
end $$;

-- ---------------------------------------------------------------------------
-- Forms
-- ---------------------------------------------------------------------------
create or replace function public.tr_save_submission(p_review uuid, p_kind text, p_data jsonb, p_submit boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me staff := tr_require_staff();
  r reviews; c review_cycles; s review_submissions; o review_submissions; probs text[]; v_reopens int;
  d jsonb := coalesce(p_data, '{}'::jsonb);
begin
  select * into r from reviews where id = p_review for update;
  if r.id is null then raise exception 'Review not found.'; end if;
  if p_kind = 'self' and me.id <> r.staff_id then raise exception 'Only the team member can fill in their self-review.' using errcode = '42501'; end if;
  if p_kind = 'manager' and me.id <> r.reviewer_id then raise exception 'Only the assigned reviewer can fill in this review.' using errcode = '42501'; end if;
  if p_kind not in ('self', 'manager') then raise exception 'Unknown form.'; end if;
  select * into c from review_cycles where id = r.cycle_id;
  if r.status <> 'open' or c.status <> 'open' then raise exception 'This review is no longer open for changes.'; end if;
  select * into s from review_submissions where review_id = r.id and kind = p_kind;
  if s.submitted_at is not null then raise exception 'This form was submitted and is read-only.'; end if;
  if s.id is null then
    insert into review_submissions (review_id, kind, author_id) values (r.id, p_kind, me.id) returning * into s;
  end if;
  update review_submissions set
    cam_behavior = (d ->> 'cam_behavior')::int, cam_success = (d ->> 'cam_success')::int,
    own_behavior = (d ->> 'own_behavior')::int, own_success = (d ->> 'own_success')::int,
    hh_behavior = (d ->> 'hh_behavior')::int, hh_success = (d ->> 'hh_success')::int,
    comment_camaraderie = nullif(btrim(d ->> 'comment_camaraderie'), ''),
    comment_ownership = nullif(btrim(d ->> 'comment_ownership'), ''),
    comment_healthy_hustle = nullif(btrim(d ->> 'comment_healthy_hustle'), ''),
    action_steps = nullif(btrim(d ->> 'action_steps'), ''),
    note_to_reviewer = case when p_kind = 'self' then nullif(btrim(d ->> 'note_to_reviewer'), '') end,
    appreciation = case when p_kind = 'manager' then nullif(btrim(d ->> 'appreciation'), '') end,
    coaching = case when p_kind = 'manager' then nullif(btrim(d ->> 'coaching'), '') end,
    evaluation = case when p_kind = 'manager' then nullif(btrim(d ->> 'evaluation'), '') end
  where id = s.id returning * into s;
  if not coalesce(p_submit, false) then
    return jsonb_build_object('saved', true, 'submitted', false);
  end if;
  probs := tr_submission_problems(s);
  if coalesce(array_length(probs, 1), 0) > 0 then
    return jsonb_build_object('saved', true, 'submitted', false, 'problems', to_jsonb(probs));
  end if;
  update review_submissions set submitted_at = now() where id = s.id;
  select * into o from review_submissions where review_id = r.id and kind <> p_kind;
  if o.submitted_at is not null then
    update reviews set status = 'comparing' where id = r.id;
    select count(*) into v_reopens from review_events where review_id = r.id and kind = 'reopen';
    perform tr_notify('comparison_ready', r.staff_id, r.id, r.cycle_id,
      jsonb_build_object('cycle', tr_cycle_label(r.cycle_id), 'staff_name', (select name from staff where id = r.staff_id),
                         'reviewer_name', (select name from staff where id = r.reviewer_id)), 'compare:' || r.id || ':staff:' || v_reopens);
    perform tr_notify('comparison_ready', r.reviewer_id, r.id, r.cycle_id,
      jsonb_build_object('cycle', tr_cycle_label(r.cycle_id), 'staff_name', (select name from staff where id = r.staff_id),
                         'reviewer_name', (select name from staff where id = r.reviewer_id)), 'compare:' || r.id || ':reviewer:' || v_reopens);
  end if;
  return jsonb_build_object('saved', true, 'submitted', true, 'comparing', o.submitted_at is not null);
end $$;

-- Admin reopen of a submitted form, only while nobody has signed.
create or replace function public.tr_reopen_submission(p_review uuid, p_kind text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare me staff := tr_require_admin(); r reviews; s review_submissions;
begin
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'Add a reason for reopening.'; end if;
  select * into r from reviews where id = p_review for update;
  if r.id is null or r.status not in ('open', 'comparing') then raise exception 'Only an open review can be reopened.'; end if;
  if tr_has_signatures(r.id) then
    raise exception 'Someone has already signed. Add an addendum after it locks instead.';
  end if;
  select * into s from review_submissions where review_id = r.id and kind = p_kind;
  if s.submitted_at is null then raise exception 'That form is not submitted.'; end if;
  insert into review_events (review_id, cycle_id, kind, submission_kind, actor_id, reason, snapshot)
  values (r.id, r.cycle_id, 'reopen', p_kind, me.id, left(btrim(p_reason), 2000), to_jsonb(s));
  perform set_config('tr.reopen', 'on', true);
  update review_submissions set submitted_at = null where id = s.id;
  perform set_config('tr.reopen', 'off', true);
  update reviews set status = 'open' where id = r.id;
  perform tr_notify('reopened', s.author_id, r.id, r.cycle_id,
    jsonb_build_object('cycle', tr_cycle_label(r.cycle_id), 'kind', p_kind, 'reason', left(btrim(p_reason), 400),
                       'staff_name', (select name from staff where id = r.staff_id)),
    'reopen:' || (select max(id) from review_events where review_id = r.id and kind = 'reopen'));
end $$;

-- ---------------------------------------------------------------------------
-- Comparison: action steps, recipient comments, signatures
-- ---------------------------------------------------------------------------
create or replace function public.tr_review_access(r public.reviews, me public.staff)
returns boolean language sql stable as $$
  select r.id is not null and (me.role = 'admin' or me.id = r.staff_id or me.id = r.reviewer_id);
$$;

create or replace function public.tr_require_editable(p_review uuid, me public.staff)
returns public.reviews language plpgsql stable security definer set search_path = public as $$
declare r reviews;
begin
  select * into r from reviews where id = p_review;
  if not tr_review_access(r, me) then raise exception 'Review not found.' using errcode = '42501'; end if;
  if r.status <> 'comparing' then raise exception 'Action steps are agreed on the comparison, after both reviews are in.'; end if;
  if tr_has_signatures(r.id) then raise exception 'Someone has signed, so the agreed steps are locked.'; end if;
  return r;
end $$;

create or replace function public.tr_upsert_action_step(p_review uuid, p_id uuid, p_section text, p_description text,
                                                        p_owner text, p_due date)
returns uuid language plpgsql security definer set search_path = public as $$
declare me staff := tr_require_staff(); r reviews; v_id uuid;
begin
  r := tr_require_editable(p_review, me);
  if btrim(coalesce(p_description, '')) = '' then raise exception 'Describe the action step.'; end if;
  if p_id is null then
    insert into action_steps (review_id, staff_id, section, description, owner, due_date, created_by)
    values (r.id, r.staff_id, nullif(p_section, ''), btrim(p_description), coalesce(nullif(p_owner, ''), 'staff'), p_due, me.id)
    returning id into v_id;
  else
    update action_steps set section = nullif(p_section, ''), description = btrim(p_description),
      owner = coalesce(nullif(p_owner, ''), 'staff'), due_date = p_due
    where id = p_id and review_id = r.id and status <> 'removed' returning id into v_id;
    if v_id is null then raise exception 'Action step not found.'; end if;
  end if;
  return v_id;
end $$;

create or replace function public.tr_remove_action_step(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare me staff := tr_require_staff(); a action_steps;
begin
  select * into a from action_steps where id = p_id;
  if a.id is null then raise exception 'Action step not found.'; end if;
  perform tr_require_editable(a.review_id, me);
  update action_steps set status = 'removed' where id = a.id;
end $$;

create or replace function public.tr_set_action_step_status(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare me staff := tr_require_staff(); a action_steps; r reviews;
begin
  if p_status not in ('open', 'in_progress', 'done') then raise exception 'Unknown status.'; end if;
  select * into a from action_steps where id = p_id;
  select * into r from reviews where id = a.review_id;
  if a.id is null or not tr_review_access(r, me) then raise exception 'Action step not found.' using errcode = '42501'; end if;
  if a.status in ('carried', 'removed') then raise exception 'This step was carried forward or removed.'; end if;
  update action_steps set status = p_status where id = a.id;
end $$;

create or replace function public.tr_save_recipient_comments(p_review uuid, p_text text)
returns void language plpgsql security definer set search_path = public as $$
declare me staff := tr_require_staff(); r reviews;
begin
  r := tr_require_editable(p_review, me);
  if me.id <> r.staff_id then raise exception 'Only the team member writes recipient comments.' using errcode = '42501'; end if;
  update reviews set recipient_comments = nullif(left(btrim(coalesce(p_text, '')), 5000), '') where id = r.id;
end $$;

create or replace function public.tr_sign(p_review uuid, p_typed_name text, p_ack boolean,
                                          p_disagree boolean default false, p_disagree_comment text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me staff := tr_require_staff(); r reviews; v_role text; v_other uuid; v_needs boolean; n int;
  s1 review_submissions; s2 review_submissions;
begin
  select * into r from reviews where id = p_review for update;
  if r.id is null then raise exception 'Review not found.'; end if;
  if me.id = r.staff_id then v_role := 'staff'; v_other := r.reviewer_id;
  elsif me.id = r.reviewer_id then v_role := 'reviewer'; v_other := r.staff_id;
  else raise exception 'Only the team member and the reviewer sign.' using errcode = '42501'; end if;
  if r.status <> 'comparing' then raise exception 'This review is not ready to sign.'; end if;
  if btrim(coalesce(p_typed_name, '')) = '' or not coalesce(p_ack, false) then
    raise exception 'Type your name and check the box to sign.';
  end if;
  if exists (select 1 from review_signatures where review_id = r.id and signer_role = v_role) then
    raise exception 'You have already signed.';
  end if;
  if coalesce(p_disagree, false) and v_role <> 'staff' then raise exception 'Only the team member can mark disagreement.'; end if;
  if coalesce(p_disagree, false) and btrim(coalesce(p_disagree_comment, '')) = '' then
    raise exception 'Add a comment about what you disagree with.';
  end if;
  select * into s1 from review_submissions where review_id = r.id and kind = 'self';
  select * into s2 from review_submissions where review_id = r.id and kind = 'manager';
  v_needs := tr_needs_action_step(s1) or tr_needs_action_step(s2);
  if v_needs and not exists (select 1 from action_steps where review_id = r.id and status <> 'removed') then
    raise exception 'Add at least one agreed action step before signing.';
  end if;
  insert into review_signatures (review_id, signer_role, user_id, typed_name, email, acknowledgment,
                                 disagree, disagree_comment, ip, user_agent)
  values (r.id, v_role, me.id, left(btrim(p_typed_name), 200), lower(me.email), tr_ack(v_role),
          coalesce(p_disagree, false), case when coalesce(p_disagree, false) then left(btrim(p_disagree_comment), 5000) end,
          tr_request_ip(), tr_request_ua());
  select count(*) into n from review_signatures where review_id = r.id;
  if n >= 2 then
    update reviews set status = 'signed', locked_at = now() where id = r.id;
    perform tr_carry_forward(r.staff_id);
    perform tr_kick('export_review', r.id);
    return jsonb_build_object('signed', true, 'locked', true);
  end if;
  perform tr_notify('signature_needed', v_other, r.id, r.cycle_id,
    jsonb_build_object('cycle', tr_cycle_label(r.cycle_id), 'signer_name', me.name,
                       'staff_name', (select name from staff where id = r.staff_id)), 'sign:' || r.id || ':' || v_other);
  return jsonb_build_object('signed', true, 'locked', false);
end $$;

create or replace function public.tr_add_addendum(p_review uuid, p_body text)
returns void language plpgsql security definer set search_path = public as $$
declare me staff := tr_require_admin(); r reviews;
begin
  select * into r from reviews where id = p_review;
  if r.id is null or r.status not in ('signed', 'closed_unsigned') then
    raise exception 'Addenda are for locked or closed reviews. Edit or reopen an open review instead.';
  end if;
  if btrim(coalesce(p_body, '')) = '' then raise exception 'Write the addendum first.'; end if;
  insert into review_addenda (review_id, author_id, body) values (r.id, me.id, left(btrim(p_body), 5000));
  if r.status = 'signed' then perform tr_kick('export_review', r.id); end if;
end $$;

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------
create or replace function public.tr_get_review(p_review uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  me staff := tr_require_staff(); r reviews; c review_cycles; is_admin boolean := me.role = 'admin';
  s1 review_submissions; s2 review_submissions; v_both boolean;
begin
  select * into r from reviews where id = p_review;
  if not tr_review_access(r, me) then raise exception 'Review not found.' using errcode = '42501'; end if;
  select * into c from review_cycles where id = r.cycle_id;
  select * into s1 from review_submissions where review_id = r.id and kind = 'self';
  select * into s2 from review_submissions where review_id = r.id and kind = 'manager';
  v_both := s1.submitted_at is not null and s2.submitted_at is not null;
  return jsonb_build_object(
    'id', r.id, 'status', r.status, 'locked_at', r.locked_at, 'created_at', r.created_at,
    'recipient_comments', r.recipient_comments,
    'closed_reason', r.closed_reason, 'closed_at', r.closed_at,
    'cycle', jsonb_build_object('id', c.id, 'year', c.year, 'quarter', c.quarter, 'opens_at', c.opens_at,
                                'due_at', c.due_at, 'status', c.status, 'label', 'Q' || c.quarter || ' ' || c.year),
    'staff', (select jsonb_build_object('id', id, 'name', name, 'email', email) from staff where id = r.staff_id),
    'reviewer', (select jsonb_build_object('id', id, 'name', name, 'email', email) from staff where id = r.reviewer_id),
    'my_role', case when me.id = r.staff_id then 'staff' when me.id = r.reviewer_id then 'reviewer' else 'admin' end,
    'viewer_is_admin', is_admin,
    'self', tr_submission_json(r, 'self', me.id, is_admin),
    'manager', tr_submission_json(r, 'manager', me.id, is_admin),
    'both_submitted', v_both,
    'requires_action_step', case when v_both then tr_needs_action_step(s1) or tr_needs_action_step(s2) end,
    'has_signatures', tr_has_signatures(r.id),
    'ack', jsonb_build_object('staff', tr_ack('staff'), 'reviewer', tr_ack('reviewer')),
    'signatures', coalesce((select jsonb_agg(jsonb_build_object(
        'signer_role', g.signer_role, 'typed_name', g.typed_name, 'email', g.email, 'signed_at', g.signed_at,
        'acknowledgment', g.acknowledgment, 'disagree', g.disagree, 'disagree_comment', g.disagree_comment,
        'ip', case when is_admin then host(g.ip) end, 'user_agent', case when is_admin then g.user_agent end)
        order by g.signed_at) from review_signatures g where g.review_id = r.id), '[]'::jsonb),
    'steps', coalesce((select jsonb_agg(jsonb_build_object(
        'id', a.id, 'section', a.section, 'description', a.description, 'owner', a.owner, 'due_date', a.due_date,
        'status', a.status, 'completed_at', a.completed_at, 'carried_from', a.carried_from,
        'from_label', (select 'Q' || oc.quarter || ' ' || oc.year from action_steps o
                       join reviews orv on orv.id = o.review_id join review_cycles oc on oc.id = orv.cycle_id
                       where o.id = a.carried_from))
        order by (a.carried_from is null), a.created_at)
        from action_steps a where a.review_id = r.id and a.status <> 'removed'), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object(
        'kind', e.kind, 'submission_kind', e.submission_kind, 'reason', e.reason, 'created_at', e.created_at,
        'actor_name', (select name from staff where id = e.actor_id)) order by e.created_at)
        from review_events e where e.review_id = r.id and e.kind in ('reopen', 'reassign', 'close_unsigned')), '[]'::jsonb),
    'addenda', coalesce((select jsonb_agg(jsonb_build_object('body', d.body, 'created_at', d.created_at,
        'author_name', (select name from staff where id = d.author_id)) order by d.created_at)
        from review_addenda d where d.review_id = r.id), '[]'::jsonb),
    'drive', case when is_admin then jsonb_build_object(
        'exported_at', r.drive_exported_at, 'error', r.drive_export_error, 'attempted_at', r.drive_export_attempted_at,
        'has_file', r.drive_file_id is not null) end
  );
end $$;

-- What the signed-in person needs on the Reviews overview + the due badge.
create or replace function public.tr_my_overview()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  me staff := tr_require_staff(); c review_cycles; r reviews; s1 review_submissions; s2 review_submissions;
  v_items jsonb := '[]'::jsonb; v_my jsonb; v_giving jsonb := '[]'::jsonb; v_survey jsonb; v_eligible boolean := false;
  v_last jsonb; g record; v_sub timestamptz;
begin
  select * into c from review_cycles where status = 'open' order by year desc, quarter desc limit 1;
  if c.id is null then
    select * into c from review_cycles order by year desc, quarter desc limit 1;
  end if;
  if c.id is not null then
    select * into r from reviews where cycle_id = c.id and staff_id = me.id;
    if r.id is not null then
      v_eligible := true;
      select * into s1 from review_submissions where review_id = r.id and kind = 'self';
      select * into s2 from review_submissions where review_id = r.id and kind = 'manager';
      v_my := jsonb_build_object('id', r.id, 'status', r.status,
        'self_status', case when s1.id is null then 'not_started' when s1.submitted_at is null then 'in_progress' else 'submitted' end,
        'manager_status', case when s2.id is null or s2.submitted_at is null then 'not_submitted' else 'submitted' end,
        'reviewer_name', (select name from staff where id = r.reviewer_id),
        'staff_signed', exists (select 1 from review_signatures where review_id = r.id and signer_role = 'staff'),
        'reviewer_signed', exists (select 1 from review_signatures where review_id = r.id and signer_role = 'reviewer'));
      if c.status = 'open' then
        if r.status = 'open' and s1.submitted_at is null then
          v_items := v_items || jsonb_build_object('kind', 'self', 'label', 'Self-review', 'review_id', r.id);
        end if;
        if r.status = 'comparing' and not (v_my ->> 'staff_signed')::boolean then
          v_items := v_items || jsonb_build_object('kind', 'sign', 'label', 'Sign your review', 'review_id', r.id);
        end if;
      end if;
    end if;
    select submitted_at into v_sub from survey_responses where cycle_id = c.id and staff_id = me.id;
    v_survey := jsonb_build_object('eligible', v_eligible, 'submitted_at', v_sub);
    if v_eligible and v_sub is null and c.status = 'open' then
      v_items := v_items || jsonb_build_object('kind', 'survey', 'label', 'Team survey');
    end if;
    for g in
      select rv.id, rv.status, st.name as staff_name,
             (select submitted_at from review_submissions where review_id = rv.id and kind = 'manager') as m_sub,
             (select id from review_submissions where review_id = rv.id and kind = 'manager') as m_id,
             (select submitted_at from review_submissions where review_id = rv.id and kind = 'self') as s_sub,
             exists (select 1 from review_signatures where review_id = rv.id and signer_role = 'reviewer') as rev_signed
      from reviews rv join staff st on st.id = rv.staff_id
      where rv.cycle_id = c.id and rv.reviewer_id = me.id order by st.name
    loop
      v_giving := v_giving || jsonb_build_object('review_id', g.id, 'staff_name', g.staff_name, 'status', g.status,
        'manager_status', case when g.m_id is null then 'not_started' when g.m_sub is null then 'in_progress' else 'submitted' end,
        'self_status', case when g.s_sub is null then 'not_submitted' else 'submitted' end,
        'reviewer_signed', g.rev_signed);
      if c.status = 'open' and g.status = 'open' and g.m_sub is null then
        v_items := v_items || jsonb_build_object('kind', 'manager', 'label', 'Review of ' || g.staff_name, 'review_id', g.id);
      elsif c.status = 'open' and g.status = 'comparing' and not g.rev_signed then
        v_items := v_items || jsonb_build_object('kind', 'sign', 'label', 'Sign ' || g.staff_name || '''s review', 'review_id', g.id);
      end if;
    end loop;
  end if;

  -- Last two locked quarters for the "last quarter total" tile.
  select coalesce(jsonb_agg(x order by x ->> 'rank' desc), '[]'::jsonb) into v_last from (
    select jsonb_build_object('rank', cc.year * 4 + cc.quarter, 'label', 'Q' || cc.quarter || ' ' || cc.year,
      'self_total', tr_sub_total(a), 'manager_total', tr_sub_total(b)) as x
    from reviews rv join review_cycles cc on cc.id = rv.cycle_id
    join review_submissions a on a.review_id = rv.id and a.kind = 'self' and a.submitted_at is not null
    join review_submissions b on b.review_id = rv.id and b.kind = 'manager' and b.submitted_at is not null
    where rv.staff_id = me.id and rv.status in ('signed', 'closed_unsigned')
    order by cc.year desc, cc.quarter desc limit 2) t;

  return jsonb_build_object(
    'me', jsonb_build_object('id', me.id, 'name', me.name, 'role', me.role, 'is_admin', me.role = 'admin'),
    'cycle', case when c.id is null then null else jsonb_build_object('id', c.id, 'year', c.year, 'quarter', c.quarter,
      'opens_at', c.opens_at, 'due_at', c.due_at, 'status', c.status, 'label', 'Q' || c.quarter || ' ' || c.year,
      'opened_by', (select name from staff where id = c.created_by)) end,
    'my_review', v_my, 'survey', v_survey, 'giving', v_giving, 'last_totals', v_last,
    'open_steps', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'description', a.description, 'section', a.section,
        'owner', a.owner, 'due_date', a.due_date, 'status', a.status,
        'from_label', (select 'Q' || oc.quarter || ' ' || oc.year from action_steps o
                       join reviews orv on orv.id = o.review_id join review_cycles oc on oc.id = orv.cycle_id
                       where o.id = a.carried_from)) order by a.created_at)
      from action_steps a join reviews rv on rv.id = a.review_id
      where a.staff_id = me.id and a.status in ('open', 'in_progress')
        and (rv.status in ('signed', 'closed_unsigned') or a.carried_from is not null)), '[]'::jsonb),
    'due', jsonb_build_object('count', jsonb_array_length(v_items), 'items', v_items,
                              'due_at', case when c.status = 'open' then c.due_at end));
end $$;

create or replace function public.tr_team_status(p_cycle uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me staff := tr_require_admin(); c review_cycles;
begin
  if p_cycle is null then
    select * into c from review_cycles order by (status = 'open') desc, year desc, quarter desc limit 1;
  else
    select * into c from review_cycles where id = p_cycle;
  end if;
  return jsonb_build_object(
    'cycles', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'year', year, 'quarter', quarter, 'status', status,
        'due_at', due_at, 'label', 'Q' || quarter || ' ' || year) order by year desc, quarter desc) from review_cycles), '[]'::jsonb),
    'cycle', case when c.id is null then null else jsonb_build_object('id', c.id, 'year', c.year, 'quarter', c.quarter,
        'opens_at', c.opens_at, 'due_at', c.due_at, 'status', c.status, 'label', 'Q' || c.quarter || ' ' || c.year) end,
    'rows', coalesce((select jsonb_agg(row order by row ->> 'staff_name') from (
      select jsonb_build_object(
        'review_id', rv.id, 'staff_id', rv.staff_id, 'staff_name', st.name, 'reviewer_id', rv.reviewer_id,
        'reviewer_name', rw.name, 'status', rv.status, 'closed_reason', rv.closed_reason,
        'self_status', case when a.id is null then 'not_started' when a.submitted_at is null then 'in_progress' else 'submitted' end,
        'manager_status', case when b.id is null then 'not_started' when b.submitted_at is null then 'in_progress' else 'submitted' end,
        'staff_signed', exists (select 1 from review_signatures g where g.review_id = rv.id and g.signer_role = 'staff'),
        'reviewer_signed', exists (select 1 from review_signatures g where g.review_id = rv.id and g.signer_role = 'reviewer'),
        'manager_total', case when b.submitted_at is not null and tr_can_see_submission('manager', b.author_id, true,
            a.submitted_at is not null, me.id, rv.staff_id, rv.reviewer_id, true) then tr_sub_total(b) end,
        'self_total', case when a.submitted_at is not null and b.submitted_at is not null then tr_sub_total(a) end,
        'drive_exported_at', rv.drive_exported_at, 'drive_export_error', rv.drive_export_error,
        'survey_submitted', exists (select 1 from survey_responses sr where sr.cycle_id = rv.cycle_id and sr.staff_id = rv.staff_id)
      ) as row
      from reviews rv join staff st on st.id = rv.staff_id join staff rw on rw.id = rv.reviewer_id
      left join review_submissions a on a.review_id = rv.id and a.kind = 'self'
      left join review_submissions b on b.review_id = rv.id and b.kind = 'manager'
      where rv.cycle_id = c.id) q), '[]'::jsonb),
    -- Team averages for the cycle's year: reviewer scores, reviews with both forms in only.
    'averages', (select jsonb_build_object(
        'camaraderie', round(avg((b.cam_behavior + b.cam_success) / 2.0), 2),
        'ownership', round(avg((b.own_behavior + b.own_success) / 2.0), 2),
        'healthy_hustle', round(avg((b.hh_behavior + b.hh_success) / 2.0), 2),
        'count', count(*))
      from reviews rv join review_cycles cc on cc.id = rv.cycle_id
      join review_submissions a on a.review_id = rv.id and a.kind = 'self' and a.submitted_at is not null
      join review_submissions b on b.review_id = rv.id and b.kind = 'manager' and b.submitted_at is not null
      where cc.year = c.year),
    'default_reviewer_id', (select default_reviewer_id from review_settings where id = 1)
  );
end $$;

create or replace function public.tr_history(p_staff uuid default null, p_year int default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me staff := tr_require_staff(); v_staff uuid := coalesce(p_staff, me.id); v_year int; ys review_year_summaries;
begin
  if v_staff <> me.id and me.role <> 'admin' then raise exception 'You can only see your own history.' using errcode = '42501'; end if;
  v_year := coalesce(p_year, (select max(c.year) from reviews r join review_cycles c on c.id = r.cycle_id where r.staff_id = v_staff),
                     extract(year from now())::int);
  select * into ys from review_year_summaries where staff_id = v_staff and year = v_year;
  if ys.id is not null and ys.status <> 'confirmed' and me.role <> 'admin' then ys := null; end if;
  return jsonb_build_object(
    'staff', (select jsonb_build_object('id', id, 'name', name) from staff where id = v_staff),
    'year', v_year,
    'years', coalesce((select jsonb_agg(distinct c.year) from reviews r join review_cycles c on c.id = r.cycle_id where r.staff_id = v_staff), '[]'::jsonb),
    'reviews', coalesce((select jsonb_agg(x order by (x ->> 'quarter')::int) from (
      select jsonb_build_object('review_id', r.id, 'year', c.year, 'quarter', c.quarter, 'label', 'Q' || c.quarter || ' ' || c.year,
        'status', r.status, 'locked_at', r.locked_at, 'closed_reason', r.closed_reason,
        'both_submitted', a.submitted_at is not null and b.submitted_at is not null,
        'self', case when a.submitted_at is not null and b.submitted_at is not null then jsonb_build_object(
            'cam_behavior', a.cam_behavior, 'cam_success', a.cam_success, 'own_behavior', a.own_behavior,
            'own_success', a.own_success, 'hh_behavior', a.hh_behavior, 'hh_success', a.hh_success, 'total', tr_sub_total(a)) end,
        'manager', case when a.submitted_at is not null and b.submitted_at is not null then jsonb_build_object(
            'cam_behavior', b.cam_behavior, 'cam_success', b.cam_success, 'own_behavior', b.own_behavior,
            'own_success', b.own_success, 'hh_behavior', b.hh_behavior, 'hh_success', b.hh_success, 'total', tr_sub_total(b)) end,
        'reviewer_name', (select name from staff where id = r.reviewer_id)) as x
      from reviews r join review_cycles c on c.id = r.cycle_id
      left join review_submissions a on a.review_id = r.id and a.kind = 'self'
      left join review_submissions b on b.review_id = r.id and b.kind = 'manager'
      where r.staff_id = v_staff and c.year = v_year) q), '[]'::jsonb),
    'steps', (select jsonb_build_object('done', count(*) filter (where a.status = 'done'), 'total', count(*))
      from action_steps a join reviews r on r.id = a.review_id join review_cycles c on c.id = r.cycle_id
      where a.staff_id = v_staff and c.year = v_year and a.status not in ('carried', 'removed')
        and r.status in ('signed', 'closed_unsigned', 'comparing')),
    'summary', case when ys.id is null then null else jsonb_build_object('strongest', ys.strongest, 'focus', ys.focus,
        'alignment', ys.alignment, 'status', ys.status, 'confirmed_at', ys.confirmed_at,
        'confirmed_by', (select name from staff where id = ys.confirmed_by), 'updated_at', ys.updated_at,
        'drive_exported_at', case when me.role = 'admin' then ys.drive_exported_at end) end
  );
end $$;

create or replace function public.tr_save_year_summary(p_staff uuid, p_year int, p_strongest text, p_focus text,
                                                       p_alignment text, p_confirm boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me staff := tr_require_admin(); v_confirm boolean := coalesce(p_confirm, false);
begin
  if not exists (select 1 from staff where id = p_staff) then raise exception 'Unknown team member.'; end if;
  if v_confirm and (btrim(coalesce(p_strongest, '')) = '' or btrim(coalesce(p_focus, '')) = '' or btrim(coalesce(p_alignment, '')) = '') then
    raise exception 'Fill in all three parts before confirming.';
  end if;
  insert into review_year_summaries as y (staff_id, year, strongest, focus, alignment, status, updated_by, updated_at, confirmed_by, confirmed_at)
  values (p_staff, p_year, left(btrim(p_strongest), 3000), left(btrim(p_focus), 3000), left(btrim(p_alignment), 3000),
          case when v_confirm then 'confirmed' else 'draft' end, me.id, now(),
          case when v_confirm then me.id end, case when v_confirm then now() end)
  on conflict (staff_id, year) do update set strongest = excluded.strongest, focus = excluded.focus,
    alignment = excluded.alignment, status = excluded.status, updated_by = excluded.updated_by, updated_at = now(),
    confirmed_by = excluded.confirmed_by, confirmed_at = excluded.confirmed_at;
  return jsonb_build_object('status', case when v_confirm then 'confirmed' else 'draft' end);
end $$;

-- ---------------------------------------------------------------------------
-- Survey
-- ---------------------------------------------------------------------------
create or replace function public.tr_survey_get(p_cycle uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me staff := tr_require_staff(); c review_cycles; sr survey_responses;
begin
  if p_cycle is null then
    select * into c from review_cycles where status = 'open' order by year desc, quarter desc limit 1;
  else
    select * into c from review_cycles where id = p_cycle;
  end if;
  if c.id is null then return jsonb_build_object('cycle', null); end if;
  select * into sr from survey_responses where cycle_id = c.id and staff_id = me.id;
  return jsonb_build_object(
    'cycle', jsonb_build_object('id', c.id, 'label', 'Q' || c.quarter || ' ' || c.year, 'status', c.status, 'due_at', c.due_at),
    'eligible', exists (select 1 from reviews where cycle_id = c.id and staff_id = me.id),
    'submitted_at', sr.submitted_at, 'answers', sr.answers,
    'admins', coalesce((select jsonb_agg(split_part(name, ' ', 1) order by name) from staff where active and role = 'admin'), '[]'::jsonb));
end $$;

create or replace function public.tr_survey_submit(p_cycle uuid, p_answers jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  me staff := tr_require_staff(); c review_cycles; a jsonb := coalesce(p_answers, '{}'::jsonb);
  v_named jsonb := '{}'::jsonb; k text; n int := 0; v_rating int; v_choice text;
begin
  select * into c from review_cycles where id = p_cycle;
  if c.id is null or c.status <> 'open' then raise exception 'The survey for that quarter is closed.'; end if;
  if not exists (select 1 from reviews where cycle_id = c.id and staff_id = me.id) then
    raise exception 'The survey is for team members in this review cycle.' using errcode = '42501';
  end if;
  if exists (select 1 from survey_responses where cycle_id = c.id and staff_id = me.id) then
    raise exception 'You already submitted the survey for this quarter.';
  end if;
  v_rating := nullif(a ->> 'q6_rating', '')::int;
  if v_rating is not null and v_rating not between 1 and 5 then raise exception 'Morale is rated 1 to 5.'; end if;
  v_choice := nullif(a ->> 'q8_choice', '');
  if v_choice is not null and v_choice not in ('more', 'same', 'less') then raise exception 'Unknown workload choice.'; end if;
  foreach k in array array['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q8', 'q9'] loop
    if btrim(coalesce(a ->> k, '')) <> '' then
      v_named := v_named || jsonb_build_object(k, left(btrim(a ->> k), 5000));
    end if;
  end loop;
  if v_rating is not null then v_named := v_named || jsonb_build_object('q6_rating', v_rating); end if;
  if v_choice is not null then v_named := v_named || jsonb_build_object('q8_choice', v_choice); end if;
  -- Count answered questions (Q6 / Q8 count if either part is filled).
  foreach k in array array['q1', 'q2', 'q3', 'q4', 'q5', 'q9', 'q7', 'q10'] loop
    if btrim(coalesce(a ->> k, '')) <> '' then n := n + 1; end if;
  end loop;
  if v_named ? 'q6' or v_rating is not null then n := n + 1; end if;
  if v_named ? 'q8' or v_choice is not null then n := n + 1; end if;
  if n < 3 then raise exception 'Answer at least 3 questions to submit'; end if;
  insert into survey_responses (cycle_id, staff_id, answers) values (c.id, me.id, v_named);
  -- Anonymous answers: no staff id, no timestamp.
  foreach k in array array['q7', 'q10'] loop
    if btrim(coalesce(a ->> k, '')) <> '' then
      insert into survey_anonymous_answers (cycle_id, question, answer) values (c.id, k, left(btrim(a ->> k), 5000));
    end if;
  end loop;
end $$;

create or replace function public.tr_survey_results(p_cycle uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me staff := tr_require_admin(); c review_cycles; prev review_cycles; k text; v_anon jsonb := '{}'::jsonb; v_n int;
begin
  if p_cycle is null then
    select * into c from review_cycles order by (status = 'open') desc, year desc, quarter desc limit 1;
  else
    select * into c from review_cycles where id = p_cycle;
  end if;
  if c.id is null then return jsonb_build_object('cycle', null); end if;
  select * into prev from review_cycles where year * 4 + quarter < c.year * 4 + c.quarter order by year desc, quarter desc limit 1;
  foreach k in array array['q7', 'q10'] loop
    select count(*) into v_n from survey_anonymous_answers where cycle_id = c.id and question = k;
    v_anon := v_anon || jsonb_build_object(k, case when v_n >= 3 then jsonb_build_object('shown', true, 'count', v_n,
        'answers', (select jsonb_agg(answer order by answer) from survey_anonymous_answers where cycle_id = c.id and question = k))
      else jsonb_build_object('shown', false) end);
  end loop;
  return jsonb_build_object(
    'cycle', jsonb_build_object('id', c.id, 'label', 'Q' || c.quarter || ' ' || c.year, 'status', c.status),
    'cycles', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'label', 'Q' || quarter || ' ' || year) order by year desc, quarter desc) from review_cycles), '[]'::jsonb),
    'eligible', (select count(*) from reviews where cycle_id = c.id),
    'responses', coalesce((select jsonb_agg(jsonb_build_object('staff_name', s.name, 'submitted_at', sr.submitted_at, 'answers', sr.answers) order by s.name)
      from survey_responses sr join staff s on s.id = sr.staff_id where sr.cycle_id = c.id), '[]'::jsonb),
    'morale', (select round(avg((answers ->> 'q6_rating')::numeric), 1) from survey_responses where cycle_id = c.id and answers ? 'q6_rating'),
    'morale_prev', (select round(avg((answers ->> 'q6_rating')::numeric), 1) from survey_responses where cycle_id = prev.id and answers ? 'q6_rating'),
    'prev_label', case when prev.id is not null then 'Q' || prev.quarter || ' ' || prev.year end,
    'workload', (select jsonb_build_object('more', count(*) filter (where answers ->> 'q8_choice' = 'more'),
        'same', count(*) filter (where answers ->> 'q8_choice' = 'same'), 'less', count(*) filter (where answers ->> 'q8_choice' = 'less'))
      from survey_responses where cycle_id = c.id),
    'anonymous', v_anon);
end $$;

-- ---------------------------------------------------------------------------
-- Reminders
-- ---------------------------------------------------------------------------
-- Queues one reminder per person per review for anything still to do.
create or replace function public.tr_queue_reminders(p_cycle uuid, p_kind text, p_key text)
returns int language plpgsql security definer set search_path = public as $$
declare c review_cycles; g record; n int := 0; v_label text;
begin
  select * into c from review_cycles where id = p_cycle and status = 'open';
  if c.id is null then return 0; end if;
  v_label := 'Q' || c.quarter || ' ' || c.year;
  for g in
    select rv.*, st.name as staff_name,
      (select submitted_at from review_submissions where review_id = rv.id and kind = 'self') as s_sub,
      (select submitted_at from review_submissions where review_id = rv.id and kind = 'manager') as m_sub,
      exists (select 1 from review_signatures where review_id = rv.id and signer_role = 'staff') as s_signed,
      exists (select 1 from review_signatures where review_id = rv.id and signer_role = 'reviewer') as r_signed,
      exists (select 1 from survey_responses where cycle_id = rv.cycle_id and staff_id = rv.staff_id) as surveyed
    from reviews rv join staff st on st.id = rv.staff_id
    where rv.cycle_id = c.id and rv.status in ('open', 'comparing')
  loop
    if (g.status = 'open' and g.s_sub is null) or (g.status = 'comparing' and not g.s_signed) or not g.surveyed then
      perform tr_notify(p_kind, g.staff_id, g.id, c.id, jsonb_build_object('cycle', v_label, 'due_at', c.due_at, 'role', 'staff',
        'todo', jsonb_strip_nulls(jsonb_build_object(
          'self', case when g.status = 'open' and g.s_sub is null then true end,
          'survey', case when not g.surveyed then true end,
          'sign', case when g.status = 'comparing' and not g.s_signed then true end))),
        p_kind || ':' || g.id || ':staff:' || p_key);
      n := n + 1;
    end if;
    if (g.status = 'open' and g.m_sub is null) or (g.status = 'comparing' and not g.r_signed) then
      perform tr_notify(p_kind, g.reviewer_id, g.id, c.id, jsonb_build_object('cycle', v_label, 'due_at', c.due_at, 'role', 'reviewer',
        'staff_name', g.staff_name,
        'todo', jsonb_strip_nulls(jsonb_build_object(
          'manager', case when g.status = 'open' and g.m_sub is null then true end,
          'sign', case when g.status = 'comparing' and not g.r_signed then true end))),
        p_kind || ':' || g.id || ':reviewer:' || p_key);
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke all on function public.tr_queue_reminders(uuid, text, text) from public, anon, authenticated;

create or replace function public.tr_send_reminder(p_cycle uuid)
returns int language plpgsql security definer set search_path = public as $$
declare me staff := tr_require_admin(); n int;
begin
  n := tr_queue_reminders(p_cycle, 'reminder', to_char(now() at time zone 'America/Chicago', 'YYYY-MM-DD'));
  perform tr_kick('sweep', null);
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- Edge function plumbing (service role / cron only)
-- ---------------------------------------------------------------------------
create or replace function public.tr_kick(p_job text, p_id uuid)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_key text;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'qbo_cron_key' limit 1;
  if v_key is null then
    raise warning 'tr_kick: qbo_cron_key missing from vault';
    return;
  end if;
  perform net.http_post(
    url := 'https://xumsqmhccgfjnlmieqyu.supabase.co/functions/v1/team-reviews',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := jsonb_build_object('job', p_job, 'id', p_id, 'trigger', 'db'),
    timeout_milliseconds := 60000);
end $$;

create or replace function public.tr_cron(p_job text)
returns void language plpgsql security definer set search_path = public as $$
declare c record;
begin
  if p_job = 'sweep' then
    if exists (select 1 from review_notifications where status = 'queued')
       or exists (select 1 from reviews where status = 'signed' and drive_file_id is null
                  and (drive_export_attempted_at is null or drive_export_attempted_at < now() - interval '1 hour')) then
      perform tr_kick('sweep', null);
    end if;
  elsif p_job = 'due_soon' then
    for c in select id from review_cycles where status = 'open'
             and due_at = (now() at time zone 'America/Chicago')::date + 3 loop
      perform tr_queue_reminders(c.id, 'due_soon', 'once');
    end loop;
  else
    raise exception 'unknown job %', p_job;
  end if;
end $$;

-- Full review for the PDF. Signed reviews only (both forms are submitted,
-- so nothing here is hidden by the blind rule from the people it goes to).
create or replace function public.tr_review_doc(p_review uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r reviews; c review_cycles;
begin
  select * into r from reviews where id = p_review;
  if r.id is null or r.status <> 'signed' then return null; end if;
  select * into c from review_cycles where id = r.cycle_id;
  return jsonb_build_object(
    'id', r.id, 'status', r.status, 'locked_at', r.locked_at, 'recipient_comments', r.recipient_comments,
    'drive_file_id', r.drive_file_id, 'staff_id', r.staff_id, 'reviewer_id', r.reviewer_id,
    'cycle', jsonb_build_object('year', c.year, 'quarter', c.quarter, 'due_at', c.due_at, 'label', 'Q' || c.quarter || ' ' || c.year),
    'staff', (select jsonb_build_object('id', id, 'name', name, 'email', email) from staff where id = r.staff_id),
    'reviewer', (select jsonb_build_object('id', id, 'name', name, 'email', email) from staff where id = r.reviewer_id),
    'self', (select to_jsonb(s) from review_submissions s where s.review_id = r.id and s.kind = 'self'),
    'manager', (select to_jsonb(s) from review_submissions s where s.review_id = r.id and s.kind = 'manager'),
    'signatures', coalesce((select jsonb_agg(jsonb_build_object('signer_role', g.signer_role, 'typed_name', g.typed_name,
        'email', g.email, 'signed_at', g.signed_at, 'acknowledgment', g.acknowledgment, 'disagree', g.disagree,
        'disagree_comment', g.disagree_comment, 'ip', host(g.ip), 'user_agent', g.user_agent) order by g.signed_at)
      from review_signatures g where g.review_id = r.id), '[]'::jsonb),
    'steps', coalesce((select jsonb_agg(jsonb_build_object('section', a.section, 'description', a.description, 'owner', a.owner,
        'due_date', a.due_date, 'status', a.status,
        'from_label', (select 'Q' || oc.quarter || ' ' || oc.year from action_steps o join reviews orv on orv.id = o.review_id
                       join review_cycles oc on oc.id = orv.cycle_id where o.id = a.carried_from))
        order by (a.carried_from is null), a.created_at)
      from action_steps a where a.review_id = r.id and a.status <> 'removed'), '[]'::jsonb),
    'addenda', coalesce((select jsonb_agg(jsonb_build_object('body', d.body, 'created_at', d.created_at,
        'author_name', (select name from staff where id = d.author_id)) order by d.created_at)
      from review_addenda d where d.review_id = r.id), '[]'::jsonb));
end $$;

create or replace function public.tr_year_doc(p_staff uuid, p_year int)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare ys review_year_summaries;
begin
  select * into ys from review_year_summaries where staff_id = p_staff and year = p_year;
  if ys.id is null or ys.status <> 'confirmed' then return null; end if; -- never export unconfirmed text
  return jsonb_build_object('id', ys.id, 'year', ys.year, 'strongest', ys.strongest, 'focus', ys.focus, 'alignment', ys.alignment,
    'confirmed_at', ys.confirmed_at, 'confirmed_by', (select name from staff where id = ys.confirmed_by),
    'drive_file_id', ys.drive_file_id,
    'staff', (select jsonb_build_object('id', id, 'name', name, 'email', email) from staff where id = p_staff),
    'quarters', coalesce((select jsonb_agg(jsonb_build_object('label', 'Q' || c.quarter || ' ' || c.year, 'status', r.status,
        'self_total', case when a.submitted_at is not null and b.submitted_at is not null then tr_sub_total(a) end,
        'manager_total', case when a.submitted_at is not null and b.submitted_at is not null then tr_sub_total(b) end) order by c.quarter)
      from reviews r join review_cycles c on c.id = r.cycle_id
      left join review_submissions a on a.review_id = r.id and a.kind = 'self'
      left join review_submissions b on b.review_id = r.id and b.kind = 'manager'
      where r.staff_id = p_staff and c.year = p_year), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  -- Internal: nobody but the definer functions / service role.
  foreach f in array array[
    'tr_require_staff()', 'tr_require_admin()', 'tr_cycle_label(uuid)', 'tr_request_ip()', 'tr_request_ua()',
    'tr_has_signatures(uuid)', 'tr_carry_forward(uuid)', 'tr_review_access(public.reviews, public.staff)',
    'tr_require_editable(uuid, public.staff)', 'tr_kick(text, uuid)', 'tr_cron(text)',
    'tr_review_doc(uuid)', 'tr_year_doc(uuid, integer)',
    'tr_can_see_submission(text, uuid, boolean, boolean, uuid, uuid, uuid, boolean)',
    'tr_submission_problems(public.review_submissions)', 'tr_sub_total(public.review_submissions)',
    'tr_needs_action_step(public.review_submissions)', 'tr_ack(text)',
    'tr_no_delete()', 'tr_insert_only()', 'tr_submissions_guard()', 'tr_reviews_guard()',
    'tr_action_steps_guard()', 'tr_cycles_guard()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  execute 'grant execute on function public.tr_review_doc(uuid), public.tr_year_doc(uuid, integer) to service_role';
  -- Callable by signed-in users (each checks staff / admin itself).
  foreach f in array array[
    'tr_admin_options()', 'tr_set_default_reviewer(uuid)',
    'tr_add_reviewees(uuid, uuid[], jsonb)', 'tr_open_cycle(integer, integer, date, date, uuid[], jsonb)',
    'tr_close_cycle_preview(uuid)', 'tr_close_cycle(uuid)', 'tr_close_review_unsigned(uuid, text)',
    'tr_reassign_reviewer(uuid, uuid, text)', 'tr_save_submission(uuid, text, jsonb, boolean)',
    'tr_reopen_submission(uuid, text, text)', 'tr_upsert_action_step(uuid, uuid, text, text, text, date)',
    'tr_remove_action_step(uuid)', 'tr_set_action_step_status(uuid, text)', 'tr_save_recipient_comments(uuid, text)',
    'tr_sign(uuid, text, boolean, boolean, text)', 'tr_add_addendum(uuid, text)', 'tr_get_review(uuid)',
    'tr_my_overview()', 'tr_team_status(uuid)', 'tr_history(uuid, integer)',
    'tr_save_year_summary(uuid, integer, text, text, text, boolean)', 'tr_survey_get(uuid)',
    'tr_survey_submit(uuid, jsonb)', 'tr_survey_results(uuid)', 'tr_send_reminder(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Schedules
-- ---------------------------------------------------------------------------
select cron.unschedule(jobid) from cron.job where jobname in ('team-reviews-sweep', 'team-reviews-due-soon');
select cron.schedule('team-reviews-sweep', '*/5 * * * *', $$select public.tr_cron('sweep');$$);
-- 14:00 UTC = 8 or 9 am Central.
select cron.schedule('team-reviews-due-soon', '0 14 * * *', $$select public.tr_cron('due_soon');$$);

-- Pin search_path on the plain (non-definer) helpers too (advisor 0011).
alter function public.tr_can_see_submission(text, uuid, boolean, boolean, uuid, uuid, uuid, boolean) set search_path = public;
alter function public.tr_submission_problems(public.review_submissions) set search_path = public;
alter function public.tr_sub_total(public.review_submissions) set search_path = public;
alter function public.tr_no_delete() set search_path = public;
alter function public.tr_insert_only() set search_path = public;
alter function public.tr_submissions_guard() set search_path = public;
alter function public.tr_reviews_guard() set search_path = public;
alter function public.tr_action_steps_guard() set search_path = public;
alter function public.tr_cycles_guard() set search_path = public;
alter function public.tr_ack(text) set search_path = public;
alter function public.tr_request_ip() set search_path = public;
alter function public.tr_request_ua() set search_path = public;
alter function public.tr_needs_action_step(public.review_submissions) set search_path = public;
alter function public.tr_review_access(public.reviews, public.staff) set search_path = public;
