-- Team Reviews 5 (tr_final_compare + tr_get_review.quarter_compare): tests.
-- NOT a migration. Run in the Supabase SQL editor (or psql as postgres) AFTER
-- team-reviews-5-final-compare.sql is applied. For a dry run before it is
-- applied, paste that file's contents right after `begin;` below: the whole
-- run ends in ROLLBACK, so neither the functions nor any fixture survive.
-- Each check raises 'FAIL n: ...' on failure. The last select shows the three
-- comparisons (with a prior, first locked review, prior after a gap).
--
-- Fake people only (cycles in 2091-2092 so they never meet real ones):
--   trfinal-a   Jane Doe   reviewee: signed Q3 2091, Q4 2091, Q1 2092 (Q1 follows Q4)
--   trfinal-b   Pat Moe    reviewee: signed Q2 2091, open Q3 2091, signed Q1 2092 (gap)
--   trfinal-c   Lee Hoe    reviewee: closed_unsigned Q4 2091, signed Q1 2092 (first)
--   trfinal-r   John Roe   reviewer of the Q1 2092 reviews
--   trfinal-r2  Sam Poe    reviewer of the earlier ones (prior by any reviewer counts)

begin;

insert into public.staff (email, name, role, active) values
  ('trfinal-a@mygoodbooks.org', 'Jane Doe', 'bookkeeper', true),
  ('trfinal-b@mygoodbooks.org', 'Pat Moe', 'bookkeeper', true),
  ('trfinal-c@mygoodbooks.org', 'Lee Hoe', 'bookkeeper', true),
  ('trfinal-r@mygoodbooks.org', 'John Roe', 'bookkeeper', true),
  ('trfinal-r2@mygoodbooks.org', 'Sam Poe', 'bookkeeper', true);

insert into public.review_cycles (year, quarter, opens_at, due_at, status) values
  (2091, 2, '2091-07-01', '2091-07-31', 'closed'),
  (2091, 3, '2091-10-01', '2091-10-31', 'closed'),
  (2091, 4, '2092-01-01', '2092-01-31', 'closed'),
  (2092, 1, '2092-04-01', '2092-04-30', 'open');

-- Reviews: (person, cycle, reviewer, status)
create temp table trf_rev on commit drop as
select gen_random_uuid() as id, x.who, x.y, x.q, x.rev, x.status
from (values
  ('a', 2091, 3, 'r2', 'signed'), ('a', 2091, 4, 'r2', 'signed'), ('a', 2092, 1, 'r', 'signed'),
  ('b', 2091, 2, 'r2', 'signed'), ('b', 2091, 3, 'r2', 'open'), ('b', 2092, 1, 'r', 'signed'),
  ('c', 2091, 4, 'r2', 'closed_unsigned'), ('c', 2092, 1, 'r', 'signed')
) as x(who, y, q, rev, status);

insert into public.reviews (id, cycle_id, staff_id, reviewer_id, status, locked_at)
select t.id, c.id,
  (select id from public.staff where email = 'trfinal-' || t.who || '@mygoodbooks.org'),
  (select id from public.staff where email = 'trfinal-' || t.rev || '@mygoodbooks.org'),
  t.status, case when t.status = 'signed' then now() end
from trf_rev t join public.review_cycles c on c.year = t.y and c.quarter = t.q;

grant select on trf_rev to authenticated; -- the signed-in checks below look up fixture ids

-- Manager (official) ratings: cam_b, cam_s, own_b, own_s, hh_b, hh_s.
create temp table trf_scores on commit drop as
select * from (values
  ('a', 2091, 3, 2, 2, 2, 2, 2, 2),   -- older; must be skipped for Q1 2092
  ('a', 2091, 4, 4, 4, 4, 4, 5, 4),   -- 4.0 / 4.0 / 4.5 / 25
  ('a', 2092, 1, 5, 4, 4, 4, 3, 4),   -- 4.5 / 4.0 / 3.5 / 24
  ('b', 2091, 2, 3, 3, 3, 3, 3, 3),   -- 3.0 x3 / 18
  ('b', 2091, 3, 1, 1, 1, 1, 1, 1),   -- open review: never a prior
  ('b', 2092, 1, 4, 4, 4, 4, 4, 4),   -- 4.0 x3 / 24
  ('c', 2091, 4, 1, 1, 1, 1, 1, 1),   -- closed_unsigned: never a prior
  ('c', 2092, 1, 5, 5, 4, 4, 3, 3)    -- 5.0 / 4.0 / 3.0 / 24
) as x(who, y, q, cb, cs, ob, os, hb, hs);

insert into public.review_submissions (review_id, kind, author_id, cam_behavior, cam_success, own_behavior, own_success,
  hh_behavior, hh_success, comment_camaraderie, comment_ownership, comment_healthy_hustle, action_steps, coaching, evaluation, submitted_at)
select t.id, 'manager', r.reviewer_id, s.cb, s.cs, s.ob, s.os, s.hb, s.hs,
  'SECRET-COMMENT', 'SECRET-COMMENT', 'SECRET-COMMENT', 'SECRET-STEPS', 'SECRET-COACHING', 'SECRET-EVAL', now()
from trf_rev t join trf_scores s on s.who = t.who and s.y = t.y and s.q = t.q
join public.reviews r on r.id = t.id;

-- Self ratings are all 1 and must never show up in the comparison.
insert into public.review_submissions (review_id, kind, author_id, cam_behavior, cam_success, own_behavior, own_success,
  hh_behavior, hh_success, note_to_reviewer, submitted_at)
select t.id, 'self', r.staff_id, 1, 1, 1, 1, 1, 1, 'SECRET-NOTE', now()
from trf_rev t join public.reviews r on r.id = t.id;

-- Jane's Q1 2092: 12 action steps, one removed -> 11 in all, 10 returned.
insert into public.action_steps (review_id, staff_id, section, description, owner, due_date, status, created_at)
select t.id, r.staff_id, 'ownership', 'Fake step ' || g, case when g % 2 = 0 then 'reviewer' else 'staff' end,
  date '2092-05-01' + g, case when g = 3 then 'removed' else 'open' end, now() + make_interval(secs => g)
from trf_rev t join public.reviews r on r.id = t.id, generate_series(1, 12) g
where t.who = 'a' and t.y = 2092;

-- ===========================================================================
-- tr_final_compare (as postgres / service role)
-- ===========================================================================
do $$
declare
  ra uuid := (select id from trf_rev where who = 'a' and y = 2092);
  rb uuid := (select id from trf_rev where who = 'b' and y = 2092);
  rc uuid := (select id from trf_rev where who = 'c' and y = 2092);
  rb_open uuid := (select id from trf_rev where who = 'b' and y = 2091 and q = 3);
  rc_closed uuid := (select id from trf_rev where who = 'c' and y = 2091);
  j jsonb;
begin
  -- 1. With a prior: Q1 2092 vs Q4 2091 (consecutive across the year), by another reviewer.
  j := public.tr_final_compare(ra);
  if j is null then raise exception 'FAIL 1a: null for a signed review'; end if;
  if j #>> '{current,label}' <> 'Q1 2092' then raise exception 'FAIL 1b: current label %', j #>> '{current,label}'; end if;
  if (j #>> '{current,camaraderie}')::numeric <> 4.5 or (j #>> '{current,ownership}')::numeric <> 4.0
     or (j #>> '{current,healthy_hustle}')::numeric <> 3.5 or (j #>> '{current,total}')::int <> 24 then
    raise exception 'FAIL 1c: current scores %', j -> 'current';
  end if;
  if j #>> '{prior,label}' <> 'Q4 2091' then raise exception 'FAIL 1d: prior should be Q4 2091, got %', j #>> '{prior,label}'; end if;
  if (j #>> '{prior,consecutive}')::boolean is not true then raise exception 'FAIL 1e: Q1 after Q4 should be consecutive'; end if;
  if (j #>> '{prior,total}')::int <> 25 or (j #>> '{prior,healthy_hustle}')::numeric <> 4.5 then raise exception 'FAIL 1f: prior scores %', j -> 'prior'; end if;
  if (j #>> '{changes,camaraderie,change}')::numeric <> 0.5 or j #>> '{changes,camaraderie,direction}' <> 'up'
     or (j #>> '{changes,ownership,change}')::numeric <> 0 or j #>> '{changes,ownership,direction}' <> 'flat'
     or (j #>> '{changes,healthy_hustle,change}')::numeric <> -1 or j #>> '{changes,healthy_hustle,direction}' <> 'down'
     or (j #>> '{changes,total,change}')::numeric <> -1 or j #>> '{changes,total,direction}' <> 'down' then
    raise exception 'FAIL 1g: changes %', j -> 'changes';
  end if;
  if jsonb_array_length(j -> 'steps') <> 10 then raise exception 'FAIL 1h: steps capped at 10, got %', jsonb_array_length(j -> 'steps'); end if;
  if (j ->> 'steps_total')::int <> 11 then raise exception 'FAIL 1i: steps_total should skip removed (11), got %', j ->> 'steps_total'; end if;
  if j::text like '%Fake step 3"%' then raise exception 'FAIL 1j: removed step returned'; end if;
  if j::text like '%SECRET%' then raise exception 'FAIL 1k: comments or notes leaked'; end if;
  if (select count(*) from jsonb_object_keys(j -> 'steps' -> 0)) <> 4 then raise exception 'FAIL 1l: step keys %', j -> 'steps' -> 0; end if;

  -- 2. First locked review: the closed_unsigned Q4 never counts.
  j := public.tr_final_compare(rc);
  if j is null or j -> 'prior' <> 'null'::jsonb or j -> 'changes' <> 'null'::jsonb then
    raise exception 'FAIL 2a: first review should have prior null, got %', j;
  end if;
  if (j #>> '{current,camaraderie}')::numeric <> 5.0 then raise exception 'FAIL 2b: current %', j -> 'current'; end if;

  -- 3. Prior after a gap: Q2 2091 (the open Q3 is skipped), not consecutive.
  j := public.tr_final_compare(rb);
  if j #>> '{prior,label}' <> 'Q2 2091' then raise exception 'FAIL 3a: prior should be Q2 2091, got %', j #>> '{prior,label}'; end if;
  if (j #>> '{prior,consecutive}')::boolean is not false then raise exception 'FAIL 3b: Q2 2091 -> Q1 2092 is not consecutive'; end if;
  if (j #>> '{changes,total,change}')::numeric <> 6 or j #>> '{changes,total,direction}' <> 'up' then raise exception 'FAIL 3c: total change %', j -> 'changes'; end if;

  -- 4. Not signed -> null.
  if public.tr_final_compare(rb_open) is not null then raise exception 'FAIL 4a: open review returned numbers'; end if;
  if public.tr_final_compare(rc_closed) is not null then raise exception 'FAIL 4b: closed_unsigned review returned numbers'; end if;
  if public.tr_final_compare(gen_random_uuid()) is not null then raise exception 'FAIL 4c: unknown review returned numbers'; end if;
end
$$;

-- ===========================================================================
-- Signed-in staff: tr_final_compare is not callable; tr_get_review carries it.
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"trfinal-a@mygoodbooks.org","role":"authenticated","app_metadata":{"provider":"google","providers":["google"]}}', true);
do $$
declare j jsonb;
begin
  begin
    perform public.tr_final_compare((select id from trf_rev where who = 'a' and y = 2092));
    raise exception 'FAIL 5a: authenticated could call tr_final_compare';
  exception when insufficient_privilege then null; end;
  j := public.tr_get_review((select id from trf_rev where who = 'a' and y = 2092));
  if j -> 'quarter_compare' is null or j -> 'quarter_compare' = 'null'::jsonb then raise exception 'FAIL 5b: quarter_compare missing on a signed review'; end if;
  if j #>> '{quarter_compare,prior,label}' <> 'Q4 2091' then raise exception 'FAIL 5c: quarter_compare prior %', j #>> '{quarter_compare,prior,label}'; end if;
  if j -> 'drive' <> 'null'::jsonb then raise exception 'FAIL 5d: non-admin sees drive block'; end if;
end
$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"email":"trfinal-b@mygoodbooks.org","role":"authenticated","app_metadata":{"provider":"google","providers":["google"]}}', true);
do $$
declare j jsonb;
begin
  j := public.tr_get_review((select id from trf_rev where who = 'b' and y = 2091 and q = 3));
  if j -> 'quarter_compare' <> 'null'::jsonb then raise exception 'FAIL 6a: quarter_compare on an open review'; end if;
end
$$;
reset role;

do $$ begin raise notice 'team-reviews-5 final-compare tests: all passed'; end $$;

select jsonb_build_object(
  'with_prior', public.tr_final_compare((select id from trf_rev where who = 'a' and y = 2092)) - 'review_id' - 'staff_id' - 'reviewer_id' - 'steps',
  'first_quarter', public.tr_final_compare((select id from trf_rev where who = 'c' and y = 2092)) - 'review_id' - 'staff_id' - 'reviewer_id',
  'prior_after_gap', public.tr_final_compare((select id from trf_rev where who = 'b' and y = 2092)) - 'review_id' - 'staff_id' - 'reviewer_id'
) as results;

rollback;
