-- =====================================================================
-- Tasks Phase 2, S8b review fixes (2026-10-16). Builds on
-- tasks-p2-10-asana-import-v2.sql. Safe to re-run (each function is patched
-- once; a marker comment says it is done). Nothing dropped, no data changed,
-- no switch flipped. tk_schema_version() stays 10 (fix files do not bump it,
-- same as tasks-p2-9-ooo-fixes.sql).
--
-- MAJOR 1  An unassigned task (assignee_email is null) counts for nobody: not
--          in anyone's open / overdue / done counts, the performance score, the
--          weekly digest, the on-time card or the review stats. Before, these
--          used coalesce(assignee_email, staff_email), so the row owner (for
--          the Asana import often the fallback person) carried them.
--            staff_performance, digest_weekly_data, tk_on_time_stats,
--            tk_review_stats
--          client_health counts per client, not per person: unchanged.
-- MAJOR 2  Time off hand-off moves only tasks actually assigned to the away
--          person. An unassigned task is never handed to a backup, so the
--          return can never turn it into an assigned one.
--            tk__ooo_apply (select + guarded update), tk__ooo_return (the
--            "still with the backup" check reads the assignee only)
-- minor    The default reviewer of an unassigned task is never its owner (the
--          owner cannot review it: tk__review_target treats them as the doer).
--            staff_reminders_before_write (review entry)
-- minor    Completing a recurring unassigned task makes the next copy
--          unassigned too (it used to land on the owner).
--            complete_staff_item
-- minor    tk_import_assign_team only acts on a real (not test, not internal)
--          client that has imported Asana tasks.
-- Email: none added or changed (tested in tasks-p2-11-s8b-review-fixes-tests.sql).
-- =====================================================================

-- p_edits: [[from, to, expected count], ...]; skipped when the marker is already there.
create or replace function pg_temp.patch_fn_multi(p_sig text, p_marker text, p_edits jsonb)
returns void language plpgsql as $f$
declare d text; e jsonb; v_from text; v_to text; n int;
begin
  d := pg_get_functiondef(p_sig::regprocedure);
  if position(p_marker in d) > 0 then return; end if;
  for e in select * from jsonb_array_elements(p_edits) loop
    v_from := e ->> 0; v_to := e ->> 1;
    n := (length(d) - length(replace(d, v_from, ''))) / length(v_from);
    if n <> (e ->> 2)::int then
      raise exception 'patch_fn_multi %: expected % occurrence(s) of anchor %, found %', p_sig, e ->> 2, v_from, n;
    end if;
    d := replace(d, v_from, v_to);
  end loop;
  if position(p_marker in d) = 0 then
    raise exception 'patch_fn_multi %: marker % missing after the edits', p_sig, p_marker;
  end if;
  execute d;
end $f$;

-- MAJOR 1 ------------------------------------------------------------------------
select pg_temp.patch_fn_multi('public.staff_performance(integer,jsonb)', 'tk p2 s8b fix: unassigned', jsonb_build_array(
  jsonb_build_array(
    'select lower(coalesce(r.assignee_email, r.staff_email)) as email,',
    'select lower(r.assignee_email) as email,   -- tk p2 s8b fix: unassigned counts for nobody', 1),
  jsonb_build_array(
    '    where r.deleted_at is null   -- tk v1',
    '    where r.deleted_at is null   -- tk v1' || chr(10) || '      and r.assignee_email is not null', 1)
));

select pg_temp.patch_fn_multi('public.digest_weekly_data(date,date)', 'tk p2 s8b fix: unassigned', jsonb_build_array(
  jsonb_build_array(
    'where lower(coalesce(t.assignee_email, t.staff_email)) = lower(s.email)',
    'where lower(t.assignee_email) = lower(s.email)   -- tk p2 s8b fix: unassigned counts for nobody', 3)
));

select pg_temp.patch_fn_multi('public.tk_on_time_stats(date,date,text)', 'tk p2 s8b fix: unassigned', jsonb_build_array(
  jsonb_build_array('coalesce(r.assignee_email, r.staff_email)', 'r.assignee_email', 3),
  jsonb_build_array(
    '     where r.due_date_original is not null',
    '     where r.due_date_original is not null' || chr(10)
      || '       and r.assignee_email is not null   -- tk p2 s8b fix: unassigned counts for nobody', 1)
));

select pg_temp.patch_fn_multi('public.tk_review_stats(date,date,text)', 'tk p2 s8b fix: unassigned', jsonb_build_array(
  jsonb_build_array('coalesce(r.assignee_email, r.staff_email)', 'r.assignee_email', 2),
  jsonb_build_array(
    '       and r.ready_at is not null',
    '       and r.ready_at is not null' || chr(10)
      || '       and r.assignee_email is not null   -- tk p2 s8b fix: unassigned counts for nobody', 1)
));

-- MAJOR 2 ------------------------------------------------------------------------
select pg_temp.patch_fn_multi('public.tk__ooo_apply(uuid,boolean,jsonb,text,boolean)', 'tk p2 s8b fix: assigned only', jsonb_build_array(
  jsonb_build_array(
    '     where lower(coalesce(x.assignee_email, x.staff_email)) = v_owner',
    '     where lower(x.assignee_email) = v_owner   -- tk p2 s8b fix: assigned only (an unassigned task is nobody''s to hand off)', 1),
  jsonb_build_array(
    'where id = r.id and lower(coalesce(assignee_email, staff_email)) = v_owner',
    'where id = r.id and lower(assignee_email) = v_owner', 1)
));

select pg_temp.patch_fn_multi('public.tk__ooo_return(uuid,date,date,boolean,text)', 'tk p2 s8b fix: assigned only', jsonb_build_array(
  jsonb_build_array(
    'v_cur := lower(coalesce(l.assignee_email, l.staff_email));',
    'v_cur := lower(l.assignee_email);   -- tk p2 s8b fix: assigned only; an emptied task is "changed", never re-assigned', 1)
));

-- minor: default reviewer is never the owner of an unassigned task --------------
select pg_temp.patch_fn_multi('public.staff_reminders_before_write()', 'tk p2 s8b fix: reviewer', jsonb_build_array(
  jsonb_build_array(
    'if new.reviewer_email is null or new.reviewer_email in (new.assignee_email, new.submitted_by)',
    'if new.reviewer_email is null   -- tk p2 s8b fix: reviewer is never the doer (assignee, else the owner of an unassigned task)' || chr(10)
      || '       or new.reviewer_email in (coalesce(new.assignee_email, lower(new.staff_email)), new.submitted_by)', 1),
  jsonb_build_array(
    'public.tk__trg_default_reviewer(new.client_id, array[new.assignee_email, new.submitted_by])',
    'public.tk__trg_default_reviewer(new.client_id, array[coalesce(new.assignee_email, lower(new.staff_email)), new.submitted_by])', 1)
));

-- minor: a recurring unassigned task rolls forward unassigned --------------------
select pg_temp.patch_fn_multi('public.complete_staff_item(uuid,boolean,date)', 'tk p2 s8b fix: next copy', jsonb_build_array(
  jsonb_build_array(
    'v_assignee := lower(coalesce(v_row.assignee_email, v_row.staff_email));',
    'v_assignee := lower(v_row.assignee_email);   -- tk p2 s8b fix: next copy of an unassigned task stays unassigned', 1),
  jsonb_build_array(
    '  perform set_config(''mgb.tk_rollforward'', ''on'', true);   -- tk v1',
    '  perform set_config(''mgb.tk_rollforward'', ''on'', true);   -- tk v1' || chr(10)
      || '  perform set_config(''mgb.tk_unassigned'', case when v_row.assignee_email is null then ''on'' else '''' end, true);', 1),
  jsonb_build_array(
    '    coalesce(v_assignee, v_row.assignee_email, v_row.staff_email),   -- tk p2 s7',
    '    case when v_row.assignee_email is null then null else coalesce(v_assignee, v_row.assignee_email) end,   -- tk p2 s7', 1),
  jsonb_build_array(
    '  perform set_config(''mgb.tk_rollforward'', '''', true);   -- tk v1',
    '  perform set_config(''mgb.tk_rollforward'', '''', true);   -- tk v1' || chr(10)
      || '  perform set_config(''mgb.tk_unassigned'', '''', true);', 1)
));

-- minor: assign team only for real imported clients ------------------------------
select pg_temp.patch_fn_multi('public.tk_import_assign_team(text,text)', 'tk p2 s8b fix: real imported', jsonb_build_array(
  jsonb_build_array(
    'if not exists (select 1 from clients c where c.id = p_client_id and not coalesce(c.is_internal, false)) then',
    'if not exists (select 1 from clients c where c.id = p_client_id and not coalesce(c.is_internal, false)' || chr(10)
      || '                  and not coalesce(c.test_only, false)   -- tk p2 s8b fix: real imported clients only' || chr(10)
      || '                  and exists (select 1 from staff_reminders r where r.client_id = c.id and r.source = ''asana'')) then', 1)
));
