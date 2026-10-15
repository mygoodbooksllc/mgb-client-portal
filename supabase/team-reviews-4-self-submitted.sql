-- Team Reviews 4: email the reviewer when the reviewee submits their self-review first.
-- Re-runnable. The edge function (team-reviews) renders kind 'self_review_submitted'
-- and skips it at send time if the reviewer has submitted by then.

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
  -- Heads-up to the reviewer when the team member's self-review lands first.
  -- No scores or answers in the payload (blind rule). One email per review, ever:
  -- the key has no reopen counter, so a re-submit after an admin reopen stays quiet.
  if p_kind = 'self' and o.submitted_at is null then
    perform tr_notify('self_review_submitted', r.reviewer_id, r.id, r.cycle_id,
      jsonb_build_object('cycle', tr_cycle_label(r.cycle_id), 'staff_name', (select name from staff where id = r.staff_id),
                         'due_at', c.due_at), 'self_submitted:' || r.id);
  end if;
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
