-- Team Reviews, part 3: admins watch reviews as they happen (owner request
-- 2026-10-13: "all admin to have full access to the review process, but jesse
-- being the primary reviewer. we need to be able to look into it as its
-- happening").
-- Applied to production 2026-10-13 as migration team_reviews_3_admin_live_view.
-- Safe to re-run. Same definition as team-reviews-1-schema.sql.
--
-- An admin who is neither the reviewee nor the reviewer now sees both
-- submissions at any time, drafts included. The reviewee and the reviewer
-- still can't see each other's side until both are submitted (owner picked
-- "keep reviewer blind"), so Jesse, as reviewer, doesn't see a self-review
-- before submitting his own. Mirrored in components/staff/teamReviewsLogic.js.
-- Callers: tr_submission_json (tr_get_review) and tr_team_status.
--
-- tr_reassign_reviewer: a former reviewer can't be put back on a review once
-- its self-review is started (they could see it while off the review).
-- Same definition as team-reviews-2-rpcs.sql.

create or replace function public.tr_can_see_submission(
  p_kind text, p_author uuid, p_this_submitted boolean, p_both_submitted boolean,
  p_viewer uuid, p_staff_id uuid, p_reviewer_id uuid, p_viewer_admin boolean)
returns boolean language sql immutable set search_path = public as $$
  select case
    when p_viewer is null then false
    when p_viewer = p_author then true
    when coalesce(p_viewer_admin, false)
         and p_viewer is distinct from p_staff_id
         and p_viewer is distinct from p_reviewer_id then true
    when not coalesce(p_this_submitted, false) then false
    when coalesce(p_both_submitted, false) then
      p_viewer = p_staff_id or p_viewer = p_reviewer_id or coalesce(p_viewer_admin, false)
    when p_kind = 'manager' and coalesce(p_viewer_admin, false) and p_viewer <> p_staff_id then true
    else false
  end;
$$;

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
  -- While off the review, a former reviewer counted as "another admin" and
  -- could see the self-review (team-reviews-3), so they can't come back once
  -- it's started; otherwise the reviewer's blind could be lifted on purpose.
  if exists (select 1 from review_submissions where review_id = r.id and kind = 'self')
     and exists (select 1 from review_events e where e.review_id = r.id and e.kind = 'reassign'
                 and e.snapshot ->> 'from_reviewer' = p_reviewer::text) then
    raise exception 'That admin was this review''s reviewer before and may have seen the self-review since. Pick someone else.';
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
