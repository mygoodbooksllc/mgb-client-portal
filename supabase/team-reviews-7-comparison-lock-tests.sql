-- Team Reviews 7 (comparison lock until the meeting): tests.
-- NOT a migration. Run in the Supabase SQL editor (or psql as postgres) AFTER
-- team-reviews-7-comparison-lock.sql is applied. Everything ends in ROLLBACK:
-- no fixture, notification or setting survives. Fake people only, cycle Q1 2093.
-- Each check raises 'FAIL n: ...' on failure.
--
--   trlock-b  Bea Doe   bookkeeper, reviewee (review rb, reviewer trlock-r)
--   trlock-a  Ann Doe   admin, reviewee (review ra, reviewer trlock-r)
--   trlock-r  Rob Roe   admin, reviewer of both
--   trlock-o  Oli Poe   admin, not a revealer
--   trlock-x  Xan Moe   admin, added to review_settings.revealer_emails for the test

begin;

insert into public.staff (email, name, role, active) values
  ('trlock-b@mygoodbooks.org', 'Bea Doe', 'bookkeeper', true),
  ('trlock-a@mygoodbooks.org', 'Ann Doe', 'admin', true),
  ('trlock-r@mygoodbooks.org', 'Rob Roe', 'admin', true),
  ('trlock-o@mygoodbooks.org', 'Oli Poe', 'admin', true),
  ('trlock-x@mygoodbooks.org', 'Xan Moe', 'admin', true);
update public.review_settings set revealer_emails = revealer_emails || array['trlock-x@mygoodbooks.org'] where id = 1;

insert into public.review_cycles (year, quarter, opens_at, due_at, status) values (2093, 1, '2093-04-01', '2093-04-30', 'open');

create temp table trl on commit drop as
select gen_random_uuid() as rb, gen_random_uuid() as ra;
grant select on trl to authenticated;

insert into public.reviews (id, cycle_id, staff_id, reviewer_id, status)
select (select rb from trl), c.id, (select id from public.staff where email = 'trlock-b@mygoodbooks.org'),
       (select id from public.staff where email = 'trlock-r@mygoodbooks.org'), 'open'
from public.review_cycles c where c.year = 2093 and c.quarter = 1
union all
select (select ra from trl), c.id, (select id from public.staff where email = 'trlock-a@mygoodbooks.org'),
       (select id from public.staff where email = 'trlock-r@mygoodbooks.org'), 'open'
from public.review_cycles c where c.year = 2093 and c.quarter = 1;

-- Both self-reviews already in.
insert into public.review_submissions (review_id, kind, author_id, cam_behavior, cam_success, own_behavior, own_success,
  hh_behavior, hh_success, note_to_reviewer, submitted_at)
select r.id, 'self', r.staff_id, 5, 5, 5, 5, 5, 5, 'SELF-NOTE', now()
from public.reviews r where r.id in ((select rb from trl), (select ra from trl));

-- Ann's manager review goes straight in (status comparing), as if submitted.
insert into public.review_submissions (review_id, kind, author_id, cam_behavior, cam_success, own_behavior, own_success,
  hh_behavior, hh_success, comment_ownership, action_steps, coaching, submitted_at)
select r.id, 'manager', r.reviewer_id, 4, 4, 2, 3, 4, 4, 'SECRET-MGR', 'SECRET-MGR', 'SECRET-MGR', now()
from public.reviews r where r.id = (select ra from trl);
update public.reviews set status = 'comparing' where id = (select ra from trl);

-- ---------------------------------------------------------------------------
-- 1. Rob submits Bea's manager review through the RPC.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"trlock-r@mygoodbooks.org","role":"authenticated","app_metadata":{"provider":"google","providers":["google"]}}', true);
do $$
declare j jsonb; rb uuid := (select rb from trl);
begin
  j := public.tr_save_submission(rb, 'manager', jsonb_build_object(
    'cam_behavior', 4, 'cam_success', 4, 'own_behavior', 2, 'own_success', 3, 'hh_behavior', 4, 'hh_success', 4,
    'comment_ownership', 'SECRET-MGR', 'action_steps', 'SECRET-MGR', 'coaching', 'SECRET-MGR'), true);
  if not coalesce((j ->> 'comparing')::boolean, false) then raise exception 'FAIL 1a: not comparing: %', j; end if;
  -- Reviewer sees both sides right away, can prep a step and reveal.
  j := public.tr_get_review(rb);
  if not (j #>> '{self,visible}')::boolean or not (j #>> '{manager,visible}')::boolean then raise exception 'FAIL 1b: reviewer blind'; end if;
  if (j ->> 'comparison_locked')::boolean then raise exception 'FAIL 1c: locked for reviewer'; end if;
  if not (j ->> 'can_reveal')::boolean then raise exception 'FAIL 1d: reviewer can''t reveal'; end if;
  if (j ->> 'revealed')::boolean then raise exception 'FAIL 1e: revealed too early'; end if;
  perform public.tr_upsert_action_step(rb, null, 'ownership', 'Prep step', 'staff', null);
  begin
    perform public.tr_sign(rb, 'Rob Roe', true);
    raise exception 'FAIL 1f: reviewer signed before reveal';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  j := public.tr_my_overview();
  if not exists (select 1 from jsonb_array_elements(j #> '{due,items}') i where i ->> 'kind' = 'reveal' and i ->> 'review_id' = rb::text) then
    raise exception 'FAIL 1g: no reveal due item for the reviewer: %', j -> 'due';
  end if;
end $$;
reset role;

-- Notifications: Bea gets both_complete (never comparison_ready), Rob gets comparison_ready.
do $$
declare rb uuid := (select rb from trl);
begin
  if not exists (select 1 from public.review_notifications n join public.reviews r on r.id = n.review_id
                 where n.review_id = rb and n.kind = 'both_complete' and n.to_staff_id = r.staff_id) then
    raise exception 'FAIL 2a: no both_complete to the reviewee';
  end if;
  if exists (select 1 from public.review_notifications n join public.reviews r on r.id = n.review_id
             where n.review_id = rb and n.kind = 'comparison_ready' and n.to_staff_id = r.staff_id) then
    raise exception 'FAIL 2b: comparison_ready sent to the reviewee before reveal';
  end if;
  if not exists (select 1 from public.review_notifications n join public.reviews r on r.id = n.review_id
                 where n.review_id = rb and n.kind = 'comparison_ready' and n.to_staff_id = r.reviewer_id) then
    raise exception 'FAIL 2c: no comparison_ready to the reviewer';
  end if;
  if exists (select 1 from public.review_notifications n where n.review_id = rb and n.payload::text like '%SECRET%') then
    raise exception 'FAIL 2d: answers in a notification payload';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Bea (bookkeeper reviewee) before the reveal: nothing from Rob's side.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"trlock-b@mygoodbooks.org","role":"authenticated","app_metadata":{"provider":"google","providers":["google"]}}', true);
do $$
declare j jsonb; rb uuid := (select rb from trl); n int;
begin
  j := public.tr_get_review(rb);
  if (j #>> '{manager,visible}')::boolean then raise exception 'FAIL 3a: reviewee sees manager side'; end if;
  if not (j #>> '{self,visible}')::boolean then raise exception 'FAIL 3b: reviewee can''t see own form'; end if;
  if not (j ->> 'comparison_locked')::boolean then raise exception 'FAIL 3c: comparison_locked should be true'; end if;
  if (j ->> 'can_reveal')::boolean then raise exception 'FAIL 3d: reviewee can reveal'; end if;
  if jsonb_array_length(j -> 'steps') <> 0 then raise exception 'FAIL 3e: reviewee sees prep steps'; end if;
  if j -> 'requires_action_step' <> 'null'::jsonb then raise exception 'FAIL 3f: requires_action_step leaks: %', j -> 'requires_action_step'; end if;
  if j::text like '%SECRET%' then raise exception 'FAIL 3g: manager answers leaked'; end if;
  select count(*) into n from public.action_steps where review_id = rb;
  if n <> 0 then raise exception 'FAIL 3h: action_steps table readable before reveal (%)', n; end if;
  j := public.tr_my_overview();
  if not exists (select 1 from jsonb_array_elements(j #> '{due,items}') i where i ->> 'kind' = 'meet') then
    raise exception 'FAIL 3i: no meet item: %', j -> 'due';
  end if;
  if exists (select 1 from jsonb_array_elements(j #> '{due,items}') i where i ->> 'kind' = 'sign') then
    raise exception 'FAIL 3j: sign item before reveal';
  end if;
  j := public.tr_history(null, 2093);
  if j #> '{reviews,0,manager}' <> 'null'::jsonb or j #> '{reviews,0,self}' <> 'null'::jsonb then
    raise exception 'FAIL 3k: history shows scores before reveal: %', j -> 'reviews';
  end if;
  if not exists (select 1 from public.staff_performance(30, null) p where p.email = 'trlock-b@mygoodbooks.org') then
    raise exception 'FAIL 3l0: staff_performance has no row for the reviewee';
  end if;
  if exists (select 1 from public.staff_performance(30, null) p where p.email = 'trlock-b@mygoodbooks.org' and p.review_pct is not null) then
    raise exception 'FAIL 3l: staff_performance shows own manager score before reveal';
  end if;
  begin perform public.tr_upsert_action_step(rb, null, null, 'Mine', 'staff', null); raise exception 'FAIL 3m: reviewee edited steps';
  exception when insufficient_privilege then null; end;
  begin perform public.tr_save_recipient_comments(rb, 'hi'); raise exception 'FAIL 3n: reviewee saved comments';
  exception when insufficient_privilege then null; end;
  begin perform public.tr_sign(rb, 'Bea Doe', true); raise exception 'FAIL 3o: reviewee signed before reveal';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;
  begin perform public.tr_reveal_comparison(rb); raise exception 'FAIL 3p: bookkeeper revealed';
  exception when insufficient_privilege then null; when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;
  begin perform public.tr_can_see_submission('manager', null, true, true, null, null, null, true, true); raise exception 'FAIL 3q: helper callable';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- 4. Ann (admin reviewee): same lock; she can't reveal her own.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"trlock-a@mygoodbooks.org","role":"authenticated","app_metadata":{"provider":"google","providers":["google"]}}', true);
do $$
declare j jsonb; ra uuid := (select ra from trl); rb uuid := (select rb from trl); n int;
begin
  j := public.tr_get_review(ra);
  if (j #>> '{manager,visible}')::boolean then raise exception 'FAIL 4a: admin reviewee sees manager side'; end if;
  if not (j ->> 'comparison_locked')::boolean then raise exception 'FAIL 4b: not locked for admin reviewee'; end if;
  if j::text like '%SECRET%' then raise exception 'FAIL 4c: leak to admin reviewee'; end if;
  begin perform public.tr_reveal_comparison(ra); raise exception 'FAIL 4d: reviewee revealed own';
  exception when insufficient_privilege then null; end;
  j := public.tr_team_status((select id from public.review_cycles where year = 2093 and quarter = 1));
  if exists (select 1 from jsonb_array_elements(j -> 'rows') x where x ->> 'review_id' = ra::text and x -> 'manager_total' <> 'null'::jsonb) then
    raise exception 'FAIL 4e: team status shows own manager total';
  end if;
  if (j #>> '{averages,count}')::int <> 1 then raise exception 'FAIL 4f: own review in averages: %', j -> 'averages'; end if;
  -- As an admin she still sees Bea's review live.
  j := public.tr_get_review(rb);
  if not (j #>> '{manager,visible}')::boolean or not (j #>> '{self,visible}')::boolean then raise exception 'FAIL 4g: admin not seeing other review'; end if;
  select count(*) into n from public.action_steps where review_id = rb;
  if n <> 1 then raise exception 'FAIL 4h: admin should read others'' steps (%)', n; end if;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- 5. Oli (admin, not reviewer, not a revealer): sees all, can't reveal.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"trlock-o@mygoodbooks.org","role":"authenticated","app_metadata":{"provider":"google","providers":["google"]}}', true);
do $$
declare j jsonb; rb uuid := (select rb from trl);
begin
  j := public.tr_get_review(rb);
  if not (j #>> '{manager,visible}')::boolean then raise exception 'FAIL 5a: admin blind'; end if;
  if (j ->> 'can_reveal')::boolean then raise exception 'FAIL 5b: non-revealer admin offered reveal'; end if;
  begin perform public.tr_reveal_comparison(rb); raise exception 'FAIL 5c: non-revealer revealed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- 6. Rob reveals Bea's; Xan (revealer list) reveals Ann's.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"trlock-r@mygoodbooks.org","role":"authenticated","app_metadata":{"provider":"google","providers":["google"]}}', true);
do $$
declare j jsonb; rb uuid := (select rb from trl);
begin
  j := public.tr_reveal_comparison(rb);
  if (j ->> 'already')::boolean then raise exception 'FAIL 6a: first reveal reported already'; end if;
  j := public.tr_reveal_comparison(rb);
  if not (j ->> 'already')::boolean then raise exception 'FAIL 6b: second reveal not a no-op'; end if;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"trlock-x@mygoodbooks.org","role":"authenticated","app_metadata":{"provider":"google","providers":["google"]}}', true);
do $$
declare j jsonb; ra uuid := (select ra from trl);
begin
  j := public.tr_get_review(ra);
  if not (j ->> 'can_reveal')::boolean then raise exception 'FAIL 6c: revealer list admin not offered reveal'; end if;
  perform public.tr_reveal_comparison(ra);
end $$;
reset role;

do $$
declare rb uuid := (select rb from trl);
begin
  if (select count(*) from public.review_events where review_id = rb and kind = 'reveal') <> 1 then raise exception 'FAIL 6d: reveal event count'; end if;
  if exists (select 1 from public.review_notifications where review_id = rb and kind not in ('both_complete', 'comparison_ready')) then
    raise exception 'FAIL 6e: unexpected notification after reveal';
  end if;
  begin
    update public.reviews set revealed_at = null where id = rb;
    raise exception 'FAIL 6f: reveal undone';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Bea after the reveal: everything opens; both sign; review locks.
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"trlock-b@mygoodbooks.org","role":"authenticated","app_metadata":{"provider":"google","providers":["google"]}}', true);
do $$
declare j jsonb; rb uuid := (select rb from trl); n int;
begin
  j := public.tr_get_review(rb);
  if not (j #>> '{manager,visible}')::boolean then raise exception 'FAIL 7a: still blind after reveal'; end if;
  if (j ->> 'comparison_locked')::boolean then raise exception 'FAIL 7b: still locked'; end if;
  if jsonb_array_length(j -> 'steps') <> 1 then raise exception 'FAIL 7c: steps not shown'; end if;
  if j ->> 'revealed_by_name' <> 'Rob Roe' then raise exception 'FAIL 7d: revealed_by_name %', j ->> 'revealed_by_name'; end if;
  select count(*) into n from public.action_steps where review_id = rb;
  if n <> 1 then raise exception 'FAIL 7e: steps table not readable after reveal'; end if;
  j := public.tr_history(null, 2093);
  if j #> '{reviews,0,manager}' = 'null'::jsonb then raise exception 'FAIL 7f: history still hidden'; end if;
  if not exists (select 1 from public.staff_performance(30, null) p where p.email = 'trlock-b@mygoodbooks.org' and p.review_pct is not null) then
    raise exception 'FAIL 7g: staff_performance missing revealed score';
  end if;
  j := public.tr_my_overview();
  if not exists (select 1 from jsonb_array_elements(j #> '{due,items}') i where i ->> 'kind' = 'sign') then raise exception 'FAIL 7h: no sign item'; end if;
  perform public.tr_save_recipient_comments(rb, 'Thanks');
  perform public.tr_sign(rb, 'Bea Doe', true);
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"email":"trlock-r@mygoodbooks.org","role":"authenticated","app_metadata":{"provider":"google","providers":["google"]}}', true);
do $$
declare j jsonb;
begin
  j := public.tr_sign((select rb from trl), 'Rob Roe', true);
  if not (j ->> 'locked')::boolean then raise exception 'FAIL 7i: not locked after both signed: %', j; end if;
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"email":"trlock-a@mygoodbooks.org","role":"authenticated","app_metadata":{"provider":"google","providers":["google"]}}', true);
do $$
declare j jsonb;
begin
  j := public.tr_get_review((select ra from trl));
  if not (j #>> '{manager,visible}')::boolean or (j ->> 'comparison_locked')::boolean then raise exception 'FAIL 8a: Ann still locked after Xan revealed'; end if;
  if j ->> 'revealed_by_name' <> 'Xan Moe' then raise exception 'FAIL 8b: revealed_by %', j ->> 'revealed_by_name'; end if;
end $$;
reset role;

do $$ begin raise notice 'team-reviews-7 comparison-lock tests: all passed'; end $$;
select 'team-reviews-7 comparison-lock tests: all passed' as result;

rollback;
