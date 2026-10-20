-- Team survey: anonymous questions (Q7, Q10) are shown to admins as soon as
-- 1 person has answered (owner decision 2026-10-20; was 3). Applies to every
-- cycle, including the open one, because the answers are already stored.
-- Only the threshold in tr_survey_results changes (v_n >= 3 -> v_n >= 1).
-- Applied to production 2026-10-20.

create or replace function public.tr_survey_results(p_cycle uuid default null)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
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
    v_anon := v_anon || jsonb_build_object(k, case when v_n >= 1 then jsonb_build_object('shown', true, 'count', v_n,
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
end $function$;
