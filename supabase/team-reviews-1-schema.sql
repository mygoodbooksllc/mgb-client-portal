-- Team Reviews & Team Survey, part 1: tables, locks, row-level security and
-- the blind rule (owner request 2026-10-07). Applied to production 2026-10-07.
--
-- Staff-side module only (#/reviews, components/staff/TeamReviews.jsx).
-- Clients can never reach it: every table has RLS on, and every policy and
-- RPC requires an active row in public.staff (matched by JWT email, the same
-- way is_active_staff() works).
--
-- Roles: "staff" in the spec = staff.role 'bookkeeper'; "admin" = 'admin'.
-- Reviewees are picked per cycle (admins can be reviewees too). Each review
-- has one reviewer, an active admin, never the reviewee. The default reviewer
-- is review_settings.default_reviewer_id (seeded with Jesse Smithwick).
--
-- How reads and writes work
--   * Browsers can SELECT only the harmless tables (cycles, reviews, action
--     steps, own survey answers, settings, confirmed year summaries).
--   * review_submissions, review_signatures, review_events,
--     survey_anonymous_answers and the outbox have NO policies: they are read
--     and written only through SECURITY DEFINER RPCs (team-reviews-2-rpcs.sql)
--     and the team-reviews edge function.
--   * No table has an insert/update/delete policy. All writes go through RPCs.
--   * Nothing in this module is ever hard-deleted: delete triggers refuse.
--
-- BLIND RULE (tr_can_see_submission below; mirrored in
-- components/staff/teamReviewsLogic.js and its test):
--   a submission's scores/comments are visible to
--     - its author, always (their own draft or submitted form);
--     - once BOTH are submitted: the reviewee, the reviewer and every admin;
--     - a submitted MANAGER submission: any admin who is not the reviewee.
--   Nobody else, admins included. So no admin sees a self-review's scores in
--   an open review until the manager submission is in, and a reviewee who is
--   also an admin never sees the manager's scores early. Drafts are author-only.
--   The same rule applies to closed_unsigned reviews.
--
-- Locks (triggers):
--   * a submitted submission can't change, except an admin reopen (RPC sets
--     tr.reopen) before any signature; the old version is snapshotted into
--     review_events first.
--   * signatures, events, addenda and survey answers are insert-only.
--   * a locked (signed) or closed_unsigned review can only have its Drive
--     export fields updated.
--   * once any signature exists, action steps can only change status.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.tr_me()
returns uuid language sql stable security definer set search_path = public as $$
  select id from staff
  where lower(email) = lower(auth.jwt() ->> 'email') and active = true
  limit 1;
$$;
revoke all on function public.tr_me() from public, anon;
grant execute on function public.tr_me() to authenticated;

-- ---------------------------------------------------------------------------
-- Settings (one row). The default reviewer is a firm setting, changeable by
-- admins with tr_set_default_reviewer (team-reviews-2-rpcs.sql).
-- ---------------------------------------------------------------------------
create table if not exists public.review_settings (
  id int primary key default 1 check (id = 1),
  default_reviewer_id uuid references public.staff(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff(id)
);
insert into public.review_settings (id, default_reviewer_id)
select 1, (select id from public.staff
           where lower(email) = 'jesse@mygoodbooks.org' or name = 'Jesse Smithwick'
           order by (lower(email) = 'jesse@mygoodbooks.org') desc limit 1)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.review_cycles (
  id uuid primary key default gen_random_uuid(),
  year int not null check (year between 2020 and 2100),
  quarter int not null check (quarter between 1 and 4),
  opens_at date not null,
  due_at date not null,
  status text not null default 'open' check (status in ('open', 'closed')),
  created_by uuid references public.staff(id),
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by uuid references public.staff(id),
  unique (year, quarter),
  check (due_at >= opens_at)
);

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.review_cycles(id),
  staff_id uuid not null references public.staff(id),
  reviewer_id uuid not null references public.staff(id),
  -- open -> comparing (both submitted) -> signed (both signatures, locked).
  -- closed_unsigned: closed by an admin before both signatures; read-only.
  status text not null default 'open' check (status in ('open', 'comparing', 'signed', 'closed_unsigned')),
  recipient_comments text check (char_length(recipient_comments) <= 5000),
  locked_at timestamptz,
  closed_reason text check (char_length(closed_reason) <= 1000),
  closed_at timestamptz,
  closed_by uuid references public.staff(id),
  drive_file_id text,
  drive_exported_at timestamptz,
  drive_export_attempted_at timestamptz,
  drive_export_error text,
  created_at timestamptz not null default now(),
  unique (cycle_id, staff_id),
  check (staff_id <> reviewer_id)
);
create index if not exists reviews_staff_idx on public.reviews (staff_id);
create index if not exists reviews_reviewer_idx on public.reviews (reviewer_id);

create table if not exists public.review_submissions (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.reviews(id),
  kind text not null check (kind in ('self', 'manager')),
  author_id uuid not null references public.staff(id),
  cam_behavior int check (cam_behavior between 1 and 5),
  cam_success int check (cam_success between 1 and 5),
  own_behavior int check (own_behavior between 1 and 5),
  own_success int check (own_success between 1 and 5),
  hh_behavior int check (hh_behavior between 1 and 5),
  hh_success int check (hh_success between 1 and 5),
  comment_camaraderie text check (char_length(comment_camaraderie) <= 5000),
  comment_ownership text check (char_length(comment_ownership) <= 5000),
  comment_healthy_hustle text check (char_length(comment_healthy_hustle) <= 5000),
  action_steps text check (char_length(action_steps) <= 5000),
  note_to_reviewer text check (char_length(note_to_reviewer) <= 5000), -- self only
  appreciation text check (char_length(appreciation) <= 5000),         -- manager only
  coaching text check (char_length(coaching) <= 5000),                 -- manager only
  evaluation text check (char_length(evaluation) <= 5000),             -- manager only
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (review_id, kind)
);

create table if not exists public.review_signatures (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.reviews(id),
  signer_role text not null check (signer_role in ('staff', 'reviewer')),
  user_id uuid not null references public.staff(id),
  typed_name text not null check (char_length(btrim(typed_name)) between 2 and 200),
  email text not null,
  acknowledgment text not null,
  -- Staff block only: "I disagree with parts of this review" + required comment.
  disagree boolean not null default false,
  disagree_comment text check (char_length(disagree_comment) <= 5000),
  ip inet,
  user_agent text,
  signed_at timestamptz not null default now(),
  unique (review_id, signer_role),
  check (not disagree or (signer_role = 'staff' and char_length(btrim(coalesce(disagree_comment, ''))) > 0))
);

create table if not exists public.action_steps (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.reviews(id),
  staff_id uuid not null references public.staff(id),
  section text check (section in ('camaraderie', 'ownership', 'healthy_hustle')),
  description text not null check (char_length(btrim(description)) between 1 and 2000),
  owner text not null default 'staff' check (owner in ('staff', 'reviewer')),
  due_date date,
  -- carried: copied forward into a later review (the copy carries on).
  -- removed: taken off before signing (soft delete; never hard-deleted).
  status text not null default 'open' check (status in ('open', 'in_progress', 'done', 'carried', 'removed')),
  carried_from uuid references public.action_steps(id),
  completed_at timestamptz,
  created_by uuid references public.staff(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists action_steps_review_idx on public.action_steps (review_id);
create index if not exists action_steps_staff_idx on public.action_steps (staff_id);

-- Append-only audit trail: reopen, reassign, close_unsigned, cycle events.
-- snapshot holds the previous scores/comments on a reopen; it is never
-- returned by any RPC (it could break the blind rule) and is for audit only.
create table if not exists public.review_events (
  id bigserial primary key,
  review_id uuid references public.reviews(id),
  cycle_id uuid references public.review_cycles(id),
  kind text not null check (kind in ('reopen', 'reassign', 'close_unsigned', 'cycle_opened', 'cycle_closed', 'reviewee_added')),
  submission_kind text check (submission_kind in ('self', 'manager')),
  actor_id uuid references public.staff(id),
  reason text check (char_length(reason) <= 2000),
  snapshot jsonb,
  created_at timestamptz not null default now()
);
create index if not exists review_events_review_idx on public.review_events (review_id);

-- Corrections after a review is locked (the signed record is never edited).
create table if not exists public.review_addenda (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.reviews(id),
  author_id uuid not null references public.staff(id),
  body text not null check (char_length(btrim(body)) between 1 and 5000),
  created_at timestamptz not null default now()
);

-- Named survey answers (all but Q7 and Q10). One per person per cycle.
create table if not exists public.survey_responses (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.review_cycles(id),
  staff_id uuid not null references public.staff(id),
  answers jsonb not null,
  submitted_at timestamptz not null default now(),
  unique (cycle_id, staff_id)
);

-- Anonymous survey answers (Q7, Q10): no staff id, no timestamp, keyed only
-- by cycle. Written only by tr_survey_submit; read only as a group of 3+.
create table if not exists public.survey_anonymous_answers (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.review_cycles(id),
  question text not null check (question in ('q7', 'q10')),
  answer text not null check (char_length(btrim(answer)) between 1 and 5000)
);
create index if not exists survey_anon_cycle_idx on public.survey_anonymous_answers (cycle_id, question);

create table if not exists public.review_year_summaries (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id),
  year int not null,
  strongest text check (char_length(strongest) <= 3000),
  focus text check (char_length(focus) <= 3000),
  alignment text check (char_length(alignment) <= 3000),
  status text not null default 'draft' check (status in ('draft', 'confirmed')),
  updated_by uuid references public.staff(id),
  updated_at timestamptz not null default now(),
  confirmed_by uuid references public.staff(id),
  confirmed_at timestamptz,
  drive_file_id text,
  drive_exported_at timestamptz,
  unique (staff_id, year),
  check ((status = 'confirmed') = (confirmed_by is not null and confirmed_at is not null))
);

-- Email outbox, sent by the team-reviews edge function.
create table if not exists public.review_notifications (
  id bigserial primary key,
  kind text not null,
  to_staff_id uuid not null references public.staff(id),
  review_id uuid references public.reviews(id),
  cycle_id uuid references public.review_cycles(id),
  payload jsonb not null default '{}'::jsonb,
  dedupe_key text unique,
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'skipped')),
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists review_notifications_queued_idx on public.review_notifications (created_at) where status = 'queued';

-- Drive folder cache: one "{Staff Name}" folder per person in the reviews drive.
create table if not exists public.review_drive_folders (
  staff_id uuid primary key references public.staff(id),
  name text not null,
  drive_folder_id text not null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Blind rule
-- ---------------------------------------------------------------------------
create or replace function public.tr_can_see_submission(
  p_kind text, p_author uuid, p_this_submitted boolean, p_both_submitted boolean,
  p_viewer uuid, p_staff_id uuid, p_reviewer_id uuid, p_viewer_admin boolean)
returns boolean language sql immutable as $$
  select case
    when p_viewer is null then false
    when p_viewer = p_author then true
    when not coalesce(p_this_submitted, false) then false
    when coalesce(p_both_submitted, false) then
      p_viewer = p_staff_id or p_viewer = p_reviewer_id or coalesce(p_viewer_admin, false)
    when p_kind = 'manager' and coalesce(p_viewer_admin, false) and p_viewer <> p_staff_id then true
    else false
  end;
$$;

-- Submission JSON for a viewer: full row when visible, else status only.
create or replace function public.tr_submission_json(p_review public.reviews, p_kind text, p_viewer uuid, p_viewer_admin boolean)
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
                           p_viewer, p_review.staff_id, p_review.reviewer_id, p_viewer_admin) then
    return to_jsonb(s) - 'created_at'
      || jsonb_build_object('status', case when s.submitted_at is null then 'in_progress' else 'submitted' end, 'visible', true);
  end if;
  return jsonb_build_object('kind', p_kind,
    'status', case when s.submitted_at is null then 'in_progress' else 'submitted' end,
    'submitted_at', s.submitted_at, 'visible', false);
end $$;
revoke all on function public.tr_submission_json(public.reviews, text, uuid, boolean) from public, anon, authenticated;

-- Validation (mirrors TR_validateSubmission in teamReviewsLogic.js).
-- Returns the list of problems; empty means it can be submitted.
create or replace function public.tr_submission_problems(s public.review_submissions)
returns text[] language plpgsql immutable as $$
declare
  probs text[] := '{}';
  v_vals int[] := array[s.cam_behavior, s.cam_success, s.own_behavior, s.own_success, s.hh_behavior, s.hh_success];
  v_total int;
  v_all_low boolean;
  v_any_low boolean;
begin
  if array_position(v_vals, null) is not null then
    return array['Rate all six items before submitting'];
  end if;
  v_total := s.cam_behavior + s.cam_success + s.own_behavior + s.own_success + s.hh_behavior + s.hh_success;
  v_all_low := v_total < 18;
  v_any_low := least(s.cam_behavior, s.cam_success, s.own_behavior, s.own_success, s.hh_behavior, s.hh_success) < 3;
  if (v_all_low or least(s.cam_behavior, s.cam_success) < 3) and btrim(coalesce(s.comment_camaraderie, '')) = '' then
    probs := array_append(probs, 'Camaraderie');
  end if;
  if (v_all_low or least(s.own_behavior, s.own_success) < 3) and btrim(coalesce(s.comment_ownership, '')) = '' then
    probs := array_append(probs, 'Ownership');
  end if;
  if (v_all_low or least(s.hh_behavior, s.hh_success) < 3) and btrim(coalesce(s.comment_healthy_hustle, '')) = '' then
    probs := array_append(probs, 'Healthy Hustle');
  end if;
  if array_length(probs, 1) > 0 then
    probs := array['Add comments for: ' || array_to_string(probs, ', ')];
  end if;
  if (v_any_low or v_all_low) and btrim(coalesce(s.action_steps, '')) = '' then
    probs := array_append(probs, 'Add an action step (a rating below 3 or a total below 18 needs one)');
  end if;
  return probs;
end $$;

create or replace function public.tr_sub_total(s public.review_submissions)
returns int language sql immutable as $$
  select s.cam_behavior + s.cam_success + s.own_behavior + s.own_success + s.hh_behavior + s.hh_success;
$$;

-- ---------------------------------------------------------------------------
-- Lock triggers
-- ---------------------------------------------------------------------------
create or replace function public.tr_no_delete()
returns trigger language plpgsql as $$
begin
  raise exception 'Team Reviews records are kept forever and can''t be deleted (%).', tg_table_name;
end $$;

create or replace function public.tr_insert_only()
returns trigger language plpgsql as $$
begin
  raise exception '% rows can''t be changed once saved.', tg_table_name;
end $$;

create or replace function public.tr_submissions_guard()
returns trigger language plpgsql as $$
begin
  if new.review_id <> old.review_id or new.kind <> old.kind then
    raise exception 'A submission can''t move to another review or kind.';
  end if;
  if new.author_id <> old.author_id and coalesce(current_setting('tr.reassign', true), '') <> 'on' then
    raise exception 'A submission''s author can''t change.';
  end if;
  if old.submitted_at is not null and coalesce(current_setting('tr.reopen', true), '') <> 'on' then
    raise exception 'This form was submitted and is read-only.';
  end if;
  new.updated_at := now();
  return new;
end $$;

create or replace function public.tr_reviews_guard()
returns trigger language plpgsql as $$
begin
  if new.cycle_id <> old.cycle_id or new.staff_id <> old.staff_id then
    raise exception 'A review can''t move to another cycle or person.';
  end if;
  if old.status in ('signed', 'closed_unsigned') then
    if (to_jsonb(new) - array['drive_file_id', 'drive_exported_at', 'drive_export_attempted_at', 'drive_export_error'])
       is distinct from (to_jsonb(old) - array['drive_file_id', 'drive_exported_at', 'drive_export_attempted_at', 'drive_export_error']) then
      raise exception 'This review is locked. Add an addendum instead.';
    end if;
  end if;
  return new;
end $$;

create or replace function public.tr_action_steps_guard()
returns trigger language plpgsql as $$
declare
  v_locked boolean;
begin
  if new.review_id <> old.review_id or new.staff_id <> old.staff_id or new.carried_from is distinct from old.carried_from then
    raise exception 'An action step can''t move to another review.';
  end if;
  select (r.status in ('signed', 'closed_unsigned') or exists (select 1 from review_signatures g where g.review_id = r.id))
    into v_locked from reviews r where r.id = old.review_id;
  if v_locked and (new.description <> old.description or new.owner <> old.owner
                   or new.due_date is distinct from old.due_date or new.section is distinct from old.section
                   or new.status = 'removed' or old.status = 'removed') then
    raise exception 'Signed action steps can only change status.';
  end if;
  if old.status = 'carried' and new.status <> 'carried' then
    raise exception 'This step was carried forward; update it on the later review.';
  end if;
  new.updated_at := now();
  new.completed_at := case when new.status = 'done' then coalesce(new.completed_at, now()) else null end;
  return new;
end $$;

create or replace function public.tr_cycles_guard()
returns trigger language plpgsql as $$
begin
  if old.status = 'closed' and new.status <> 'closed' then
    raise exception 'A closed cycle can''t be reopened.';
  end if;
  if new.year <> old.year or new.quarter <> old.quarter then
    raise exception 'A cycle''s quarter can''t change.';
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['review_cycles', 'reviews', 'review_submissions', 'review_signatures', 'action_steps',
                           'review_events', 'review_addenda', 'survey_responses', 'survey_anonymous_answers',
                           'review_year_summaries', 'review_settings', 'review_notifications'] loop
    execute format('drop trigger if exists tr_no_delete on public.%I', t);
    execute format('create trigger tr_no_delete before delete on public.%I for each row execute function public.tr_no_delete()', t);
  end loop;
  foreach t in array array['review_signatures', 'review_events', 'review_addenda', 'survey_responses', 'survey_anonymous_answers'] loop
    execute format('drop trigger if exists tr_insert_only on public.%I', t);
    execute format('create trigger tr_insert_only before update on public.%I for each row execute function public.tr_insert_only()', t);
  end loop;
end $$;

drop trigger if exists tr_submissions_guard on public.review_submissions;
create trigger tr_submissions_guard before update on public.review_submissions
  for each row execute function public.tr_submissions_guard();
drop trigger if exists tr_reviews_guard on public.reviews;
create trigger tr_reviews_guard before update on public.reviews
  for each row execute function public.tr_reviews_guard();
drop trigger if exists tr_action_steps_guard on public.action_steps;
create trigger tr_action_steps_guard before update on public.action_steps
  for each row execute function public.tr_action_steps_guard();
drop trigger if exists tr_cycles_guard on public.review_cycles;
create trigger tr_cycles_guard before update on public.review_cycles
  for each row execute function public.tr_cycles_guard();

-- ---------------------------------------------------------------------------
-- RLS: on everywhere; SELECT-only policies on the harmless tables.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['review_settings', 'review_cycles', 'reviews', 'review_submissions', 'review_signatures',
                           'action_steps', 'review_events', 'review_addenda', 'survey_responses',
                           'survey_anonymous_answers', 'review_year_summaries', 'review_notifications',
                           'review_drive_folders'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from authenticated', t);
  end loop;
end $$;
-- No-policy tables: no direct access at all, even SELECT.
revoke select on public.review_submissions, public.review_signatures, public.review_events,
  public.review_addenda, public.survey_anonymous_answers, public.review_notifications,
  public.review_drive_folders from authenticated;
revoke usage, select on sequence public.review_events_id_seq, public.review_notifications_id_seq from anon, authenticated;

drop policy if exists tr_settings_read on public.review_settings;
create policy tr_settings_read on public.review_settings for select to authenticated using (public.is_active_staff());

drop policy if exists tr_cycles_read on public.review_cycles;
create policy tr_cycles_read on public.review_cycles for select to authenticated using (public.is_active_staff());

drop policy if exists tr_reviews_read on public.reviews;
create policy tr_reviews_read on public.reviews for select to authenticated
  using (public.is_active_staff_admin() or staff_id = public.tr_me());

drop policy if exists tr_steps_read on public.action_steps;
create policy tr_steps_read on public.action_steps for select to authenticated
  using (public.is_active_staff_admin() or staff_id = public.tr_me());

drop policy if exists tr_survey_read on public.survey_responses;
create policy tr_survey_read on public.survey_responses for select to authenticated
  using (public.is_active_staff_admin() or staff_id = public.tr_me());

drop policy if exists tr_year_read on public.review_year_summaries;
create policy tr_year_read on public.review_year_summaries for select to authenticated
  using (public.is_active_staff_admin() or (staff_id = public.tr_me() and status = 'confirmed'));

-- ---------------------------------------------------------------------------
-- Outbox helper (used by the RPCs in later parts)
-- ---------------------------------------------------------------------------
create or replace function public.tr_notify(p_kind text, p_to uuid, p_review uuid, p_cycle uuid,
                                            p_payload jsonb default '{}'::jsonb, p_dedupe text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_to is null then return; end if;
  insert into review_notifications (kind, to_staff_id, review_id, cycle_id, payload, dedupe_key)
  values (p_kind, p_to, p_review, p_cycle, coalesce(p_payload, '{}'::jsonb), p_dedupe)
  on conflict (dedupe_key) do nothing;
end $$;
revoke all on function public.tr_notify(text, uuid, uuid, uuid, jsonb, text) from public, anon, authenticated;
