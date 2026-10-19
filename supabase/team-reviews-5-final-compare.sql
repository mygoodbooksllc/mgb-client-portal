-- Team Reviews 5: "review final" email + quarter-over-quarter comparison.
-- Re-runnable (create or replace only; no table changes).
--
-- tr_final_compare(review) builds the numbers for the final email (kind
-- 'review_final', rendered by supabase/functions/team-reviews/finalemail.ts)
-- and for the "Compared with last quarter" card on a locked review
-- (tr_get_review.quarter_compare).
--
-- Official score = the reviewer's (manager) submission. Category = the average
-- of its two ratings (out of 5, one decimal); total = the six ratings (out of 30).
-- Prior = the most recent earlier SIGNED review of the same team member, by any
-- reviewer (closed_unsigned reviews never count). It is "consecutive" only when
-- it is the quarter right before (Q4 of last year counts for Q1).
--
-- Never returned: comments, notes, coaching, disagree text, self ratings.

create or replace function public.tr_final_compare(p_review uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  r reviews; c review_cycles; m review_submissions;
  pr reviews; pc review_cycles; pm review_submissions;
  cur jsonb; pri jsonb; chg jsonb; v_steps jsonb; v_steps_total int;
  k text; d numeric;
begin
  select * into r from reviews where id = p_review;
  if r.id is null or r.status <> 'signed' then return null; end if;
  select * into c from review_cycles where id = r.cycle_id;
  select * into m from review_submissions where review_id = r.id and kind = 'manager' and submitted_at is not null;
  if m.id is null or tr_sub_total(m) is null then return null; end if;

  cur := jsonb_build_object(
    'label', 'Q' || c.quarter || ' ' || c.year, 'year', c.year, 'quarter', c.quarter,
    'camaraderie', round((m.cam_behavior + m.cam_success) / 2.0, 1),
    'ownership', round((m.own_behavior + m.own_success) / 2.0, 1),
    'healthy_hustle', round((m.hh_behavior + m.hh_success) / 2.0, 1),
    'total', tr_sub_total(m));

  -- Most recent earlier signed review of the same person (any reviewer).
  select pr0.* into pr
  from reviews pr0
  join review_cycles pc0 on pc0.id = pr0.cycle_id
  join review_submissions pm0 on pm0.review_id = pr0.id and pm0.kind = 'manager' and pm0.submitted_at is not null
  where pr0.staff_id = r.staff_id and pr0.id <> r.id and pr0.status = 'signed'
    and (pc0.year * 4 + pc0.quarter) < (c.year * 4 + c.quarter)
    and tr_sub_total(pm0) is not null
  order by pc0.year desc, pc0.quarter desc
  limit 1;

  if pr.id is not null then
    select * into pc from review_cycles where id = pr.cycle_id;
    select * into pm from review_submissions where review_id = pr.id and kind = 'manager';
    pri := jsonb_build_object(
      'label', 'Q' || pc.quarter || ' ' || pc.year, 'year', pc.year, 'quarter', pc.quarter,
      'camaraderie', round((pm.cam_behavior + pm.cam_success) / 2.0, 1),
      'ownership', round((pm.own_behavior + pm.own_success) / 2.0, 1),
      'healthy_hustle', round((pm.hh_behavior + pm.hh_success) / 2.0, 1),
      'total', tr_sub_total(pm),
      'consecutive', (c.year * 4 + c.quarter) - (pc.year * 4 + pc.quarter) = 1);
    chg := '{}'::jsonb;
    foreach k in array array['camaraderie', 'ownership', 'healthy_hustle', 'total'] loop
      d := round((cur ->> k)::numeric - (pri ->> k)::numeric, 1);
      chg := chg || jsonb_build_object(k, jsonb_build_object('change', d,
        'direction', case when d > 0 then 'up' when d < 0 then 'down' else 'flat' end));
    end loop;
  end if;

  -- Agreed action steps (no removed ones), capped at 10; steps_total says how many in all.
  select count(*) into v_steps_total from action_steps a where a.review_id = r.id and a.status <> 'removed';
  select coalesce(jsonb_agg(jsonb_build_object('section', x.section, 'description', x.description,
           'owner', x.owner, 'due_date', x.due_date) order by x.ord, x.created_at), '[]'::jsonb)
    into v_steps
  from (select a.section, a.description, a.owner, a.due_date, a.created_at, (a.carried_from is null) as ord
        from action_steps a where a.review_id = r.id and a.status <> 'removed'
        order by (a.carried_from is null), a.created_at limit 10) x;

  return jsonb_build_object(
    'review_id', r.id, 'staff_id', r.staff_id, 'reviewer_id', r.reviewer_id,
    'staff_name', (select name from staff where id = r.staff_id),
    'current', cur, 'prior', pri, 'changes', chg,
    'steps', v_steps, 'steps_total', v_steps_total);
end $$;

-- Service role only (the edge function at send time). tr_get_review calls it
-- as the definer, so signed-in users never call it directly.
revoke all on function public.tr_final_compare(uuid) from public, anon, authenticated;
grant execute on function public.tr_final_compare(uuid) to service_role;

-- tr_get_review: an exact copy of team-reviews-2-rpcs.sql plus one key,
-- quarter_compare (null unless the review is signed).
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
        'has_file', r.drive_file_id is not null) end,
    'quarter_compare', case when r.status = 'signed' then tr_final_compare(r.id) end
  );
end $$;

-- create or replace keeps the existing grants; restated so a fresh run is complete.
revoke all on function public.tr_get_review(uuid) from public, anon;
grant execute on function public.tr_get_review(uuid) to authenticated;
