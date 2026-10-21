-- Team Reviews 7: the reviewee doesn't see the comparison until it's revealed
-- in the review meeting (owner, 2026-10-21). Spec:
-- docs/team-reviews-comparison-lock-spec.md.
-- Applied to production 2026-10-21 as migration team_reviews_7_comparison_lock.
-- Additive: two columns on reviews, one on review_settings, a wider
-- review_events kind check, create-or-replace functions and one policy change.
-- No review rows are updated: signed reviews count as revealed by definition.
-- Safe to re-run.
--
--   Reviewee (any role)  own form only until revealed; "both sides complete,
--                        set up a time with {reviewer}" once both are in.
--   Reviewer             the comparison as soon as both are in (prep).
--   Other admins         both sides live, as before (team-reviews-3).
--   Reveal               the review's reviewer or anyone in
--                        review_settings.revealer_emails (Jesse, Bailley),
--                        never the reviewee. One-way.
-- Mirrored in components/staff/teamReviewsLogic.js (TR_canSeeSubmission).

-- ---------------------------------------------------------------------------
-- Columns, settings, event kind
-- ---------------------------------------------------------------------------
alter table public.reviews add column if not exists revealed_at timestamptz;
alter table public.reviews add column if not exists revealed_by uuid references public.staff(id);
alter table public.review_settings add column if not exists revealer_emails text[] not null default '{}';
update public.review_settings
   set revealer_emails = array['jesse@mygoodbooks.org', 'bailley@mygoodbooks.org']
 where id = 1 and revealer_emails = '{}';

alter table public.review_events drop constraint if exists review_events_kind_check;
alter table public.review_events add constraint review_events_kind_check check (kind = any (array[
  'reopen', 'reassign', 'close_unsigned', 'cycle_opened', 'cycle_closed', 'reviewee_added', 'reveal']));

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.tr_review_revealed(r public.reviews)
returns boolean language sql stable set search_path = public as $$
  select r.id is not null and (r.revealed_at is not null or r.status = 'signed');
$$;

-- For the action_steps policy (runs as the caller, so it needs to be definer).
create or replace function public.tr_review_revealed_id(p_review uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from reviews r where r.id = p_review and (r.revealed_at is not null or r.status = 'signed'));
$$;

create or replace function public.tr_can_reveal(r public.reviews, me public.staff)
returns boolean language sql stable security definer set search_path = public as $$
  select r.id is not null and me.id is not null and me.active and me.role = 'admin'
     and me.id <> r.staff_id
     and (me.id = r.reviewer_id
          or lower(me.email) in (select lower(e) from review_settings s, unnest(s.revealer_emails) e where s.id = 1));
$$;

-- The blind rule with the reveal. The reviewee is checked first, so an admin
-- being reviewed never gets the live view of their own review.
create or replace function public.tr_can_see_submission(
  p_kind text, p_author uuid, p_this_submitted boolean, p_both_submitted boolean,
  p_viewer uuid, p_staff_id uuid, p_reviewer_id uuid, p_viewer_admin boolean, p_revealed boolean)
returns boolean language sql immutable set search_path = public as $$
  select case
    when p_viewer is null then false
    when p_viewer = p_author then true
    when p_viewer = p_staff_id then
      coalesce(p_revealed, false) and coalesce(p_this_submitted, false) and coalesce(p_both_submitted, false)
    when coalesce(p_viewer_admin, false) and p_viewer is distinct from p_reviewer_id then true
    when not coalesce(p_this_submitted, false) then false
    when coalesce(p_both_submitted, false) then p_viewer = p_reviewer_id or coalesce(p_viewer_admin, false)
    when p_kind = 'manager' and coalesce(p_viewer_admin, false) then true
    else false
  end;
$$;

-- The old 8-argument version fails closed (never revealed) if anything still calls it.
create or replace function public.tr_can_see_submission(
  p_kind text, p_author uuid, p_this_submitted boolean, p_both_submitted boolean,
  p_viewer uuid, p_staff_id uuid, p_reviewer_id uuid, p_viewer_admin boolean)
returns boolean language sql immutable set search_path = public as $$
  select public.tr_can_see_submission(p_kind, p_author, p_this_submitted, p_both_submitted,
                                      p_viewer, p_staff_id, p_reviewer_id, p_viewer_admin, false);
$$;

-- revealed_at/by: set once (even on a closed_unsigned row), never changed or cleared.
create or replace function public.tr_reviews_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.cycle_id <> old.cycle_id or new.staff_id <> old.staff_id then
    raise exception 'A review can''t move to another cycle or person.';
  end if;
  if old.revealed_at is not null
     and (new.revealed_at is distinct from old.revealed_at or new.revealed_by is distinct from old.revealed_by) then
    raise exception 'A revealed comparison can''t be hidden again.';
  end if;
  if new.revealed_at is null and new.revealed_by is not null then
    raise exception 'A reveal needs a time.';
  end if;
  if old.status in ('signed', 'closed_unsigned') then
    if (to_jsonb(new) - array['drive_file_id', 'drive_exported_at', 'drive_export_attempted_at', 'drive_export_error', 'revealed_at', 'revealed_by'])
       is distinct from (to_jsonb(old) - array['drive_file_id', 'drive_exported_at', 'drive_export_attempted_at', 'drive_export_error', 'revealed_at', 'revealed_by']) then
      raise exception 'This review is locked. Add an addendum instead.';
    end if;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Reveal
-- ---------------------------------------------------------------------------
create or replace function public.tr_reveal_comparison(p_review uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me staff := tr_require_admin(); r reviews;
begin
  select * into r from reviews where id = p_review for update;
  if r.id is null then raise exception 'Review not found.' using errcode = '42501'; end if;
  if not tr_can_reveal(r, me) then
    raise exception 'Only this review''s reviewer, Jesse or Bailley can reveal the comparison.' using errcode = '42501';
  end if;
  if tr_review_revealed(r) then
    return jsonb_build_object('revealed', true, 'already', true, 'revealed_at', r.revealed_at);
  end if;
  if not exists (select 1 from review_submissions where review_id = r.id and kind = 'self' and submitted_at is not null)
     or not exists (select 1 from review_submissions where review_id = r.id and kind = 'manager' and submitted_at is not null) then
    raise exception 'Both forms have to be submitted before the comparison can be revealed.';
  end if;
  if r.status not in ('comparing', 'closed_unsigned') then raise exception 'This review can''t be revealed.'; end if;
  update reviews set revealed_at = now(), revealed_by = me.id where id = r.id;
  insert into review_events (review_id, cycle_id, kind, actor_id) values (r.id, r.cycle_id, 'reveal', me.id);
  -- A review that closed before its meeting: its agreed steps carry forward now.
  if r.status = 'closed_unsigned' then perform tr_carry_forward(r.staff_id); end if;
  return jsonb_build_object('revealed', true, 'already', false, 'revealed_at', now());
end $$;

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------
create or replace function public.tr_submission_json(p_review reviews, p_kind text, p_viewer uuid, p_viewer_admin boolean)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  s review_submissions;
  o review_submissions;
  v_both boolean;
begin
  select * into s from review_submissions where review_id = p_review.id and kind = p_kind;
  if s.id is null then
    return jsonb_build_object('kind', p_kind, 'status', 'not_started', 'visible', false);
  end if;
  select * into o from review_submissions where review_id = p_review.id and kind <> p_kind;
  v_both := s.submitted_at is not null and o.submitted_at is not null;
  if tr_can_see_submission(p_kind, s.author_id, s.submitted_at is not null, v_both,
                           p_viewer, p_review.staff_id, p_review.reviewer_id, p_viewer_admin,
                           tr_review_revealed(p_review)) then
    return to_jsonb(s) - 'created_at'
      || jsonb_build_object('status', case when s.submitted_at is null then 'in_progress' else 'submitted' end, 'visible', true);
  end if;
  return jsonb_build_object('kind', p_kind,
    'status', case when s.submitted_at is null then 'in_progress' else 'submitted' end,
    'submitted_at', s.submitted_at, 'visible', false);
end $$;

-- tr_get_review: team-reviews-5 plus the reveal. A reviewee before the reveal
-- gets no flags, steps, signatures or addenda (comparison_locked = true once
-- both are in).
create or replace function public.tr_get_review(p_review uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  me staff := tr_require_staff(); r reviews; c review_cycles; is_admin boolean := me.role = 'admin';
  s1 review_submissions; s2 review_submissions; v_both boolean; v_rev boolean; v_hide boolean;
begin
  select * into r from reviews where id = p_review;
  if not tr_review_access(r, me) then raise exception 'Review not found.' using errcode = '42501'; end if;
  select * into c from review_cycles where id = r.cycle_id;
  select * into s1 from review_submissions where review_id = r.id and kind = 'self';
  select * into s2 from review_submissions where review_id = r.id and kind = 'manager';
  v_both := s1.submitted_at is not null and s2.submitted_at is not null;
  v_rev := tr_review_revealed(r);
  v_hide := me.id = r.staff_id and not v_rev;
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
    'revealed', v_rev,
    'revealed_at', r.revealed_at,
    'revealed_by_name', (select name from staff where id = r.revealed_by),
    'comparison_locked', v_hide and v_both,
    'can_reveal', v_both and not v_rev and r.status in ('comparing', 'closed_unsigned') and tr_can_reveal(r, me),
    'requires_action_step', case when v_both and not v_hide then tr_needs_action_step(s1) or tr_needs_action_step(s2) end,
    'has_signatures', tr_has_signatures(r.id),
    'ack', jsonb_build_object('staff', tr_ack('staff'), 'reviewer', tr_ack('reviewer')),
    'signatures', case when v_hide then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object(
        'signer_role', g.signer_role, 'typed_name', g.typed_name, 'email', g.email, 'signed_at', g.signed_at,
        'acknowledgment', g.acknowledgment, 'disagree', g.disagree, 'disagree_comment', g.disagree_comment,
        'ip', case when is_admin then host(g.ip) end, 'user_agent', case when is_admin then g.user_agent end)
        order by g.signed_at) from review_signatures g where g.review_id = r.id), '[]'::jsonb) end,
    'steps', case when v_hide then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object(
        'id', a.id, 'section', a.section, 'description', a.description, 'owner', a.owner, 'due_date', a.due_date,
        'status', a.status, 'completed_at', a.completed_at, 'carried_from', a.carried_from,
        'from_label', (select 'Q' || oc.quarter || ' ' || oc.year from action_steps o
                       join reviews orv on orv.id = o.review_id join review_cycles oc on oc.id = orv.cycle_id
                       where o.id = a.carried_from))
        order by (a.carried_from is null), a.created_at)
        from action_steps a where a.review_id = r.id and a.status <> 'removed'), '[]'::jsonb) end,
    'events', coalesce((select jsonb_agg(jsonb_build_object(
        'kind', e.kind, 'submission_kind', e.submission_kind, 'reason', e.reason, 'created_at', e.created_at,
        'actor_name', (select name from staff where id = e.actor_id)) order by e.created_at)
        from review_events e where e.review_id = r.id and e.kind in ('reopen', 'reassign', 'close_unsigned', 'reveal')), '[]'::jsonb),
    'addenda', case when v_hide then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('body', d.body, 'created_at', d.created_at,
        'author_name', (select name from staff where id = d.author_id)) order by d.created_at)
        from review_addenda d where d.review_id = r.id), '[]'::jsonb) end,
    'drive', case when is_admin then jsonb_build_object(
        'exported_at', r.drive_exported_at, 'error', r.drive_export_error, 'attempted_at', r.drive_export_attempted_at,
        'has_file', r.drive_file_id is not null) end,
    'quarter_compare', case when r.status = 'signed' then tr_final_compare(r.id) end
  );
end $$;

create or replace function public.tr_my_overview()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  me staff := tr_require_staff(); c review_cycles; r reviews; s1 review_submissions; s2 review_submissions;
  v_items jsonb := '[]'::jsonb; v_my jsonb; v_giving jsonb := '[]'::jsonb; v_survey jsonb; v_eligible boolean := false;
  v_last jsonb; g record; v_sub timestamptz; v_rev boolean; v_grev boolean;
begin
  select * into c from review_cycles where status = 'open' order by year desc, quarter desc limit 1;
  if c.id is null then
    select * into c from review_cycles order by year desc, quarter desc limit 1;
  end if;
  if c.id is not null then
    select * into r from reviews where cycle_id = c.id and staff_id = me.id;
    if r.id is not null then
      v_eligible := true;
      v_rev := tr_review_revealed(r);
      select * into s1 from review_submissions where review_id = r.id and kind = 'self';
      select * into s2 from review_submissions where review_id = r.id and kind = 'manager';
      v_my := jsonb_build_object('id', r.id, 'status', r.status,
        'self_status', case when s1.id is null then 'not_started' when s1.submitted_at is null then 'in_progress' else 'submitted' end,
        'manager_status', case when s2.id is null or s2.submitted_at is null then 'not_submitted' else 'submitted' end,
        'both_submitted', s1.submitted_at is not null and s2.submitted_at is not null,
        'revealed', v_rev,
        'reviewer_name', (select name from staff where id = r.reviewer_id),
        'staff_signed', exists (select 1 from review_signatures where review_id = r.id and signer_role = 'staff'),
        'reviewer_signed', exists (select 1 from review_signatures where review_id = r.id and signer_role = 'reviewer'));
      if c.status = 'open' then
        if r.status = 'open' and s1.submitted_at is null then
          v_items := v_items || jsonb_build_object('kind', 'self', 'label', 'Self-review', 'review_id', r.id);
        end if;
        if r.status = 'comparing' and not v_rev then
          v_items := v_items || jsonb_build_object('kind', 'meet', 'review_id', r.id,
            'label', 'Set up your review meeting with ' || coalesce(split_part((select name from staff where id = r.reviewer_id), ' ', 1), 'your reviewer'));
        elsif r.status = 'comparing' and not (v_my ->> 'staff_signed')::boolean then
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
      select rv.id, rv.status, rv.revealed_at, st.name as staff_name,
             (select submitted_at from review_submissions where review_id = rv.id and kind = 'manager') as m_sub,
             (select id from review_submissions where review_id = rv.id and kind = 'manager') as m_id,
             (select submitted_at from review_submissions where review_id = rv.id and kind = 'self') as s_sub,
             exists (select 1 from review_signatures where review_id = rv.id and signer_role = 'reviewer') as rev_signed
      from reviews rv join staff st on st.id = rv.staff_id
      where rv.cycle_id = c.id and rv.reviewer_id = me.id order by st.name
    loop
      v_grev := g.revealed_at is not null or g.status = 'signed';
      v_giving := v_giving || jsonb_build_object('review_id', g.id, 'staff_name', g.staff_name, 'status', g.status,
        'manager_status', case when g.m_id is null then 'not_started' when g.m_sub is null then 'in_progress' else 'submitted' end,
        'self_status', case when g.s_sub is null then 'not_submitted' else 'submitted' end,
        'revealed', v_grev,
        'reviewer_signed', g.rev_signed);
      if c.status = 'open' and g.status = 'open' and g.m_sub is null then
        v_items := v_items || jsonb_build_object('kind', 'manager', 'label', 'Review of ' || g.staff_name, 'review_id', g.id);
      elsif c.status = 'open' and g.status = 'comparing' and not v_grev then
        v_items := v_items || jsonb_build_object('kind', 'reveal', 'label', 'Review meeting with ' || g.staff_name, 'review_id', g.id);
      elsif c.status = 'open' and g.status = 'comparing' and not g.rev_signed then
        v_items := v_items || jsonb_build_object('kind', 'sign', 'label', 'Sign ' || g.staff_name || '''s review', 'review_id', g.id);
      end if;
    end loop;
  end if;

  select coalesce(jsonb_agg(x order by x ->> 'rank' desc), '[]'::jsonb) into v_last from (
    select jsonb_build_object('rank', cc.year * 4 + cc.quarter, 'label', 'Q' || cc.quarter || ' ' || cc.year,
      'self_total', tr_sub_total(a), 'manager_total', tr_sub_total(b)) as x
    from reviews rv join review_cycles cc on cc.id = rv.cycle_id
    join review_submissions a on a.review_id = rv.id and a.kind = 'self' and a.submitted_at is not null
    join review_submissions b on b.review_id = rv.id and b.kind = 'manager' and b.submitted_at is not null
    where rv.staff_id = me.id and rv.status in ('signed', 'closed_unsigned')
      and (rv.status = 'signed' or rv.revealed_at is not null)
    order by cc.year desc, cc.quarter desc limit 2) t;

  return jsonb_build_object(
    'me', jsonb_build_object('id', me.id, 'email', me.email, 'name', me.name, 'role', me.role, 'is_admin', me.role = 'admin'),
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
        and (rv.status = 'signed' or (rv.status = 'closed_unsigned' and rv.revealed_at is not null) or a.carried_from is not null)), '[]'::jsonb),
    'due', jsonb_build_object('count', jsonb_array_length(v_items), 'items', v_items,
                              'due_at', case when c.status = 'open' then c.due_at end));
end $$;

create or replace function public.tr_history(p_staff uuid default null, p_year integer default null)
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
        'revealed', tr_review_revealed(r),
        'self', case when a.submitted_at is not null and b.submitted_at is not null
                      and (r.staff_id <> me.id or tr_review_revealed(r)) then jsonb_build_object(
            'cam_behavior', a.cam_behavior, 'cam_success', a.cam_success, 'own_behavior', a.own_behavior,
            'own_success', a.own_success, 'hh_behavior', a.hh_behavior, 'hh_success', a.hh_success, 'total', tr_sub_total(a)) end,
        'manager', case when a.submitted_at is not null and b.submitted_at is not null
                         and (r.staff_id <> me.id or tr_review_revealed(r)) then jsonb_build_object(
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
        and r.status in ('signed', 'closed_unsigned', 'comparing')
        and (r.staff_id <> me.id or tr_review_revealed(r) or a.carried_from is not null)),
    'summary', case when ys.id is null then null else jsonb_build_object('strongest', ys.strongest, 'focus', ys.focus,
        'alignment', ys.alignment, 'status', ys.status, 'confirmed_at', ys.confirmed_at,
        'confirmed_by', (select name from staff where id = ys.confirmed_by), 'updated_at', ys.updated_at,
        'drive_exported_at', case when me.role = 'admin' then ys.drive_exported_at end) end
  );
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
        'revealed', tr_review_revealed(rv),
        'self_status', case when a.id is null then 'not_started' when a.submitted_at is null then 'in_progress' else 'submitted' end,
        'manager_status', case when b.id is null then 'not_started' when b.submitted_at is null then 'in_progress' else 'submitted' end,
        'staff_signed', exists (select 1 from review_signatures g where g.review_id = rv.id and g.signer_role = 'staff'),
        'reviewer_signed', exists (select 1 from review_signatures g where g.review_id = rv.id and g.signer_role = 'reviewer'),
        'manager_total', case when b.submitted_at is not null and tr_can_see_submission('manager', b.author_id, true,
            a.submitted_at is not null, me.id, rv.staff_id, rv.reviewer_id, true, tr_review_revealed(rv)) then tr_sub_total(b) end,
        'self_total', case when a.submitted_at is not null and b.submitted_at is not null then tr_sub_total(a) end,
        'drive_exported_at', rv.drive_exported_at, 'drive_export_error', rv.drive_export_error,
        'survey_submitted', exists (select 1 from survey_responses sr where sr.cycle_id = rv.cycle_id and sr.staff_id = rv.staff_id)
      ) as row
      from reviews rv join staff st on st.id = rv.staff_id join staff rw on rw.id = rv.reviewer_id
      left join review_submissions a on a.review_id = rv.id and a.kind = 'self'
      left join review_submissions b on b.review_id = rv.id and b.kind = 'manager'
      where rv.cycle_id = c.id) q), '[]'::jsonb),
    -- An admin being reviewed: their own unrevealed review stays out of the averages.
    'averages', (select jsonb_build_object(
        'camaraderie', round(avg((b.cam_behavior + b.cam_success) / 2.0), 2),
        'ownership', round(avg((b.own_behavior + b.own_success) / 2.0), 2),
        'healthy_hustle', round(avg((b.hh_behavior + b.hh_success) / 2.0), 2),
        'count', count(*))
      from reviews rv join review_cycles cc on cc.id = rv.cycle_id
      join review_submissions a on a.review_id = rv.id and a.kind = 'self' and a.submitted_at is not null
      join review_submissions b on b.review_id = rv.id and b.kind = 'manager' and b.submitted_at is not null
      where cc.year = c.year and (rv.staff_id <> me.id or tr_review_revealed(rv))),
    'default_reviewer_id', (select default_reviewer_id from review_settings where id = 1)
  );
end $$;

create or replace function public.tr_year_doc(p_staff uuid, p_year integer)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare ys review_year_summaries;
begin
  select * into ys from review_year_summaries where staff_id = p_staff and year = p_year;
  if ys.id is null or ys.status <> 'confirmed' then return null; end if;
  return jsonb_build_object('id', ys.id, 'year', ys.year, 'strongest', ys.strongest, 'focus', ys.focus, 'alignment', ys.alignment,
    'confirmed_at', ys.confirmed_at, 'confirmed_by', (select name from staff where id = ys.confirmed_by),
    'drive_file_id', ys.drive_file_id,
    'staff', (select jsonb_build_object('id', id, 'name', name, 'email', email) from staff where id = p_staff),
    'quarters', coalesce((select jsonb_agg(jsonb_build_object('label', 'Q' || c.quarter || ' ' || c.year, 'status', r.status,
        'self_total', case when a.submitted_at is not null and b.submitted_at is not null and tr_review_revealed(r) then tr_sub_total(a) end,
        'manager_total', case when a.submitted_at is not null and b.submitted_at is not null and tr_review_revealed(r) then tr_sub_total(b) end) order by c.quarter)
      from reviews r join review_cycles c on c.id = r.cycle_id
      left join review_submissions a on a.review_id = r.id and a.kind = 'self'
      left join review_submissions b on b.review_id = r.id and b.kind = 'manager'
      where r.staff_id = p_staff and c.year = p_year), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- Writes
-- ---------------------------------------------------------------------------
-- The reviewer and admins can prep action steps before the meeting; the
-- reviewee edits steps and comments only after the reveal.
create or replace function public.tr_require_editable(p_review uuid, me staff)
returns reviews language plpgsql stable security definer set search_path = public as $$
declare r reviews;
begin
  select * into r from reviews where id = p_review;
  if not tr_review_access(r, me) then raise exception 'Review not found.' using errcode = '42501'; end if;
  if me.id = r.staff_id and not tr_review_revealed(r) then
    raise exception 'This opens for you once the comparison is revealed in your review meeting.' using errcode = '42501';
  end if;
  if r.status <> 'comparing' then raise exception 'Action steps are agreed on the comparison, after both reviews are in.'; end if;
  if tr_has_signatures(r.id) then raise exception 'Someone has signed, so the agreed steps are locked.'; end if;
  return r;
end $$;

create or replace function public.tr_set_action_step_status(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare me staff := tr_require_staff(); a action_steps; r reviews;
begin
  if p_status not in ('open', 'in_progress', 'done') then raise exception 'Unknown status.'; end if;
  select * into a from action_steps where id = p_id;
  select * into r from reviews where id = a.review_id;
  if a.id is null or not tr_review_access(r, me) then raise exception 'Action step not found.' using errcode = '42501'; end if;
  if me.id = r.staff_id and a.carried_from is null and not tr_review_revealed(r) then
    raise exception 'Action step not found.' using errcode = '42501';
  end if;
  if a.status in ('carried', 'removed') then raise exception 'This step was carried forward or removed.'; end if;
  update action_steps set status = p_status where id = a.id;
end $$;

-- Only steps from a revealed review carry forward (prep steps from a review
-- that closed before its meeting were never agreed).
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
      and (r.status = 'signed' or (r.status = 'closed_unsigned' and r.revealed_at is not null))
      and c.year * 4 + c.quarter < v_rank
    order by a.created_at
  loop
    insert into action_steps (review_id, staff_id, section, description, owner, due_date, status, carried_from, created_by)
    values (v_target, p_staff, st.section, st.description, st.owner, st.due_date, st.status, st.id, st.created_by);
    update action_steps set status = 'carried' where id = st.id;
  end loop;
end $$;

create or replace function public.tr_sign(p_review uuid, p_typed_name text, p_ack boolean, p_disagree boolean default false, p_disagree_comment text default null)
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
  if not tr_review_revealed(r) then
    raise exception 'Signing opens once the comparison is revealed in the review meeting.';
  end if;
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

-- team-reviews-4 plus: when both are in, the reviewee gets 'both_complete'
-- (set up the meeting) instead of 'comparison_ready', unless it's already
-- revealed (a resubmit after a reopen).
create or replace function public.tr_save_submission(p_review uuid, p_kind text, p_data jsonb, p_submit boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me staff := tr_require_staff();
  r reviews; c review_cycles; s review_submissions; o review_submissions; probs text[]; v_reopens int; v_payload jsonb;
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
  -- Heads-up to the reviewer when the team member's self-review lands first.
  -- No scores or answers in the payload. One email per review, ever.
  if p_kind = 'self' and o.submitted_at is null then
    perform tr_notify('self_review_submitted', r.reviewer_id, r.id, r.cycle_id,
      jsonb_build_object('cycle', tr_cycle_label(r.cycle_id), 'staff_name', (select name from staff where id = r.staff_id),
                         'due_at', c.due_at), 'self_submitted:' || r.id);
  end if;
  if o.submitted_at is not null then
    update reviews set status = 'comparing' where id = r.id;
    select count(*) into v_reopens from review_events where review_id = r.id and kind = 'reopen';
    v_payload := jsonb_build_object('cycle', tr_cycle_label(r.cycle_id), 'staff_name', (select name from staff where id = r.staff_id),
                                    'reviewer_name', (select name from staff where id = r.reviewer_id));
    if tr_review_revealed(r) then
      perform tr_notify('comparison_ready', r.staff_id, r.id, r.cycle_id, v_payload, 'compare:' || r.id || ':staff:' || v_reopens);
    else
      perform tr_notify('both_complete', r.staff_id, r.id, r.cycle_id, v_payload, 'both:' || r.id || ':staff:' || v_reopens);
    end if;
    perform tr_notify('comparison_ready', r.reviewer_id, r.id, r.cycle_id, v_payload, 'compare:' || r.id || ':reviewer:' || v_reopens);
  end if;
  return jsonb_build_object('saved', true, 'submitted', true, 'comparing', o.submitted_at is not null);
end $$;

-- Reminders: before the reveal the reviewee is asked to set up the meeting
-- and the reviewer to hold it; signing comes after.
create or replace function public.tr_queue_reminders(p_cycle uuid, p_kind text, p_key text)
returns integer language plpgsql security definer set search_path = public as $$
declare c review_cycles; g record; n int := 0; v_label text; v_rev boolean;
begin
  select * into c from review_cycles where id = p_cycle and status = 'open';
  if c.id is null then return 0; end if;
  v_label := 'Q' || c.quarter || ' ' || c.year;
  for g in
    select rv.*, st.name as staff_name, rw.name as reviewer_name,
      (select submitted_at from review_submissions where review_id = rv.id and kind = 'self') as s_sub,
      (select submitted_at from review_submissions where review_id = rv.id and kind = 'manager') as m_sub,
      exists (select 1 from review_signatures where review_id = rv.id and signer_role = 'staff') as s_signed,
      exists (select 1 from review_signatures where review_id = rv.id and signer_role = 'reviewer') as r_signed,
      exists (select 1 from survey_responses where cycle_id = rv.cycle_id and staff_id = rv.staff_id) as surveyed
    from reviews rv join staff st on st.id = rv.staff_id left join staff rw on rw.id = rv.reviewer_id
    where rv.cycle_id = c.id and rv.status in ('open', 'comparing')
  loop
    v_rev := g.revealed_at is not null;
    if (g.status = 'open' and g.s_sub is null) or (g.status = 'comparing' and not g.s_signed) or not g.surveyed then
      perform tr_notify(p_kind, g.staff_id, g.id, c.id, jsonb_build_object('cycle', v_label, 'due_at', c.due_at, 'role', 'staff',
        'reviewer_name', g.reviewer_name,
        'todo', jsonb_strip_nulls(jsonb_build_object(
          'self', case when g.status = 'open' and g.s_sub is null then true end,
          'survey', case when not g.surveyed then true end,
          'meet', case when g.status = 'comparing' and not v_rev then true end,
          'sign', case when g.status = 'comparing' and v_rev and not g.s_signed then true end))),
        p_kind || ':' || g.id || ':staff:' || p_key);
      n := n + 1;
    end if;
    if (g.status = 'open' and g.m_sub is null) or (g.status = 'comparing' and not g.r_signed) then
      perform tr_notify(p_kind, g.reviewer_id, g.id, c.id, jsonb_build_object('cycle', v_label, 'due_at', c.due_at, 'role', 'reviewer',
        'staff_name', g.staff_name,
        'todo', jsonb_strip_nulls(jsonb_build_object(
          'manager', case when g.status = 'open' and g.m_sub is null then true end,
          'reveal', case when g.status = 'comparing' and not v_rev then true end,
          'sign', case when g.status = 'comparing' and v_rev and not g.r_signed then true end))),
        p_kind || ':' || g.id || ':reviewer:' || p_key);
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- staff_performance: the review part only counts revealed reviews, except for
-- an admin looking at someone else. Patched in place (the function is long and
-- owned by the performance feature); fails loudly if the text moved.
-- ---------------------------------------------------------------------------
do $do$
declare v_def text; v_old text; v_new text;
begin
  select pg_get_functiondef('public.staff_performance(integer, jsonb)'::regprocedure) into v_def;
  if position('tr7: revealed only' in v_def) > 0 then return; end if;
  v_old := E'    where r.status in (''comparing'', ''signed'', ''closed_unsigned'')\n    order by r.staff_id';
  v_new := E'    where r.status in (''comparing'', ''signed'', ''closed_unsigned'')\n'
        || E'      and (r.status = ''signed'' or r.revealed_at is not null   -- tr7: revealed only\n'
        || E'           or (v_adm and not exists (select 1 from public.staff me where me.id = r.staff_id and lower(me.email) = v_me)))\n'
        || E'    order by r.staff_id';
  if position(v_old in v_def) = 0 then raise exception 'staff_performance: review CTE not found, not patched'; end if;
  execute replace(v_def, v_old, v_new);
end $do$;

-- ---------------------------------------------------------------------------
-- Direct reads: own action steps only once revealed (or carried in).
-- ---------------------------------------------------------------------------
alter policy tr_steps_read on public.action_steps using (
  (public.is_active_staff_admin() and staff_id is distinct from public.tr_me())
  or (staff_id = public.tr_me() and (carried_from is not null or public.tr_review_revealed_id(review_id))));

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on function public.tr_reveal_comparison(uuid) from public, anon;
grant execute on function public.tr_reveal_comparison(uuid) to authenticated;
revoke all on function public.tr_review_revealed_id(uuid) from public, anon;
grant execute on function public.tr_review_revealed_id(uuid) to authenticated;
revoke all on function public.tr_can_reveal(public.reviews, public.staff) from public, anon, authenticated;
revoke all on function public.tr_review_revealed(public.reviews) from public, anon, authenticated;
revoke all on function public.tr_can_see_submission(text, uuid, boolean, boolean, uuid, uuid, uuid, boolean, boolean) from public, anon, authenticated;
