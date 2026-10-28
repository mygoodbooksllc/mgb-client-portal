-- Slate plus custom fields: SQL tests (last run 2026-10-28 after slateplus_customfields_review_fixes). Leaves nothing behind: the whole DO block ends with
-- RAISE EXCEPTION carrying the log, so every write rolls back. Run via execute_sql (or the SQL
-- editor) and read the error message: each line is PASS or FAIL.
-- Fixture ids are live rows (a bookkeeper-owned project tied to a client, its tasks, staff);
-- swap them if those rows go away.
do $t$
declare
  c_proj uuid := 'c5e5ec43-c302-4af7-a260-4ab1664e6a16';   -- owner debra (bookkeeper), client p23-church
  c_client text := 'p23-church';
  c_task1 uuid := 'ce5224a0-93cb-434d-a43f-4f6e044faf5d';  -- task in c_proj
  c_task2 uuid := 'e311d393-a5c2-47e6-a4da-0cbd272da10c';  -- task in c_proj
  c_ctask uuid := '1ef7c1e5-0880-4552-9e1a-07362abb63e8';  -- client-only task (no project)
  c_owner text := 'debra@mygoodbooks.org';
  c_member text := 'sonya@mygoodbooks.org';                 -- member, not owner
  c_other text := 'gillian@mygoodbooks.org';                -- not a member
  c_admin text := 'jeff@mygoodbooks.org';
  log text := '';
  r jsonb;
  f_text uuid; f_num uuid; f_date uuid; f_chk uuid; f_dd uuid; f_person uuid; f_cli uuid;
  ids uuid[];
  n int; m int; i int;
  ok boolean;
  opt_a text; opt_b text;
begin
  -- helpers (temp, rolled back)
  create function pg_temp.as_user(p_email text) returns void language plpgsql as $f$
  begin
    execute 'reset role';
    perform set_config('request.jwt.claims', json_build_object('email', p_email, 'role', 'authenticated',
      'app_metadata', json_build_object('provider', 'google', 'providers', json_build_array('google')))::text, true);
    execute 'set local role authenticated';
  end $f$;
  create function pg_temp.as_postgres() returns void language plpgsql as $f$
  begin
    execute 'reset role';
    perform set_config('request.jwt.claims', '', true);
  end $f$;
  create function pg_temp.err(p_sql text) returns text language plpgsql as $f$
  begin
    execute p_sql;
    return 'NO ERROR';
  exception when others then
    return sqlerrm;
  end $f$;
  grant execute on all functions in schema pg_temp to public;

  -- 1. owner creates fields
  perform pg_temp.as_user(c_owner);
  r := tk_cf_field_save(null, 'project', c_proj::text, '  Fund  ', 'text', null);
  f_text := (r ->> 'id')::uuid;
  log := log || case when r ->> 'name' = 'Fund' then 'PASS' else 'FAIL' end || ' create text (trimmed name)' || chr(10);
  f_num := (tk_cf_field_save(null, 'project', c_proj::text, 'Amount', 'number', null) ->> 'id')::uuid;
  f_date := (tk_cf_field_save(null, 'project', c_proj::text, 'Board date', 'date', null) ->> 'id')::uuid;
  f_chk := (tk_cf_field_save(null, 'project', c_proj::text, 'Reviewed', 'checkbox', null) ->> 'id')::uuid;
  f_person := (tk_cf_field_save(null, 'project', c_proj::text, 'Preparer', 'person', null) ->> 'id')::uuid;
  r := tk_cf_field_save(null, 'project', c_proj::text, 'Bank', 'dropdown', '[{"label":"Checking"},{"label":"Savings"}]'::jsonb);
  f_dd := (r ->> 'id')::uuid;
  opt_a := r -> 'options' -> 0 ->> 'id';
  opt_b := r -> 'options' -> 1 ->> 'id';
  log := log || case when jsonb_array_length(r -> 'options') = 2 and opt_a ~ '^o[0-9a-f]{10}$' then 'PASS' else 'FAIL' end
             || ' dropdown ids generated' || chr(10);
  log := log || case when (select array_agg(position order by position) from tk_custom_fields where project_id = c_proj) = '{0,1,2,3,4,5}'
                     then 'PASS' else 'FAIL' end || ' positions 0..5' || chr(10);

  -- 2. name and type rules
  log := log || case when pg_temp.err(format('select tk_cf_field_save(null, %L, %L, %L, %L, null)', 'project', c_proj, 'FUND', 'text')) like 'tk_cf_name_taken%' then 'PASS' else 'FAIL' end || ' name taken (any case)' || chr(10);
  log := log || case when pg_temp.err(format('select tk_cf_field_save(null, %L, %L, %L, %L, null)', 'project', c_proj, '   ', 'text')) like 'tk_cf_bad_name%' then 'PASS' else 'FAIL' end || ' empty name' || chr(10);
  log := log || case when pg_temp.err(format('select tk_cf_field_save(null, %L, %L, %L, %L, null)', 'project', c_proj, repeat('x', 41), 'text')) like 'tk_cf_bad_name%' then 'PASS' else 'FAIL' end || ' 41-char name' || chr(10);
  log := log || case when pg_temp.err(format('select tk_cf_field_save(null, %L, %L, %L, %L, null)', 'project', c_proj, 'Calc', 'formula')) like 'tk_cf_bad_type%' then 'PASS' else 'FAIL' end || ' bad type' || chr(10);
  log := log || case when pg_temp.err(format('select tk_cf_field_save(%L, null, null, %L, %L, null)', f_text, 'Fund', 'number')) like 'tk_cf_type_locked%' then 'PASS' else 'FAIL' end || ' type locked' || chr(10);
  log := log || case when pg_temp.err(format('select tk_cf_field_save(null, %L, %L, %L, %L, %L)', 'project', c_proj, 'D2', 'dropdown', '[{"label":"A"},{"label":"a"}]')) like 'tk_cf_bad_options%' then 'PASS' else 'FAIL' end || ' duplicate option labels' || chr(10);
  log := log || case when pg_temp.err(format('select tk_cf_field_save(null, %L, %L, %L, %L, %L)', 'project', c_proj, 'D2', 'dropdown', '[]')) like 'tk_cf_bad_options%' then 'PASS' else 'FAIL' end || ' zero options' || chr(10);
  log := log || case when pg_temp.err(format('select tk_cf_field_save(null, %L, %L, %L, %L, %L)', 'project', c_proj, 'D2', 'dropdown',
                 (select jsonb_agg(jsonb_build_object('label', 'o' || g)) from generate_series(1, 21) g)::text)) like 'tk_cf_bad_options%' then 'PASS' else 'FAIL' end || ' 21 options' || chr(10);

  -- 3. values: type checks and normalizing (owner can edit the task)
  r := tk_cf_value_set(f_text, c_task1, to_jsonb('  hello  '::text));
  log := log || case when r -> 'value' = to_jsonb('hello'::text) then 'PASS' else 'FAIL' end || ' text trimmed' || chr(10);
  log := log || case when pg_temp.err(format('select tk_cf_value_set(%L, %L, %L)', f_text, c_task1, to_jsonb(repeat('x', 501)))) like 'tk_cf_bad_value%' then 'PASS' else 'FAIL' end || ' text over 500' || chr(10);
  log := log || case when pg_temp.err(format('select tk_cf_value_set(%L, %L, %L)', f_text, c_task1, '5')) like 'tk_cf_bad_value%' then 'PASS' else 'FAIL' end || ' text given a number' || chr(10);
  r := tk_cf_value_set(f_num, c_task1, '1250.5'::jsonb);
  log := log || case when (r ->> 'value')::numeric = 1250.5 then 'PASS' else 'FAIL' end || ' number ok' || chr(10);
  log := log || case when pg_temp.err(format('select tk_cf_value_set(%L, %L, %L)', f_num, c_task1, '1e12')) like 'tk_cf_bad_value%' then 'PASS' else 'FAIL' end || ' number too big' || chr(10);
  log := log || case when pg_temp.err(format('select tk_cf_value_set(%L, %L, %L)', f_num, c_task1, '1.1234567')) like 'tk_cf_bad_value%' then 'PASS' else 'FAIL' end || ' number 7 decimals' || chr(10);
  log := log || case when pg_temp.err(format('select tk_cf_value_set(%L, %L, %L)', f_date, c_task1, '"2026-02-30"')) like 'tk_cf_bad_value%' then 'PASS' else 'FAIL' end || ' date Feb 30' || chr(10);
  log := log || case when pg_temp.err(format('select tk_cf_value_set(%L, %L, %L)', f_date, c_task1, '"1899-12-31"')) like 'tk_cf_bad_value%' then 'PASS' else 'FAIL' end || ' date before 1900' || chr(10);
  log := log || case when pg_temp.err(format('select tk_cf_value_set(%L, %L, %L)', f_date, c_task1, '"2026-2-3"')) like 'tk_cf_bad_value%' then 'PASS' else 'FAIL' end || ' date bad format' || chr(10);
  r := tk_cf_value_set(f_date, c_task1, '"2026-02-28"'::jsonb);
  log := log || case when r ->> 'value' = '2026-02-28' then 'PASS' else 'FAIL' end || ' date ok' || chr(10);
  log := log || case when pg_temp.err(format('select tk_cf_value_set(%L, %L, %L)', f_chk, c_task1, '"yes"')) like 'tk_cf_bad_value%' then 'PASS' else 'FAIL' end || ' checkbox string' || chr(10);
  r := tk_cf_value_set(f_chk, c_task1, 'true'::jsonb);
  log := log || case when r -> 'value' = 'true'::jsonb then 'PASS' else 'FAIL' end || ' checkbox ok' || chr(10);
  log := log || case when pg_temp.err(format('select tk_cf_value_set(%L, %L, %L)', f_person, c_task1, '"nobody@example.com"')) like 'tk_cf_bad_value%' then 'PASS' else 'FAIL' end || ' person not staff' || chr(10);
  r := tk_cf_value_set(f_person, c_task1, to_jsonb(upper(c_member)));
  log := log || case when r ->> 'value' = c_member then 'PASS' else 'FAIL' end || ' person lowercased' || chr(10);
  log := log || case when pg_temp.err(format('select tk_cf_value_set(%L, %L, %L)', f_dd, c_task1, '"nope"')) like 'tk_cf_bad_value%' then 'PASS' else 'FAIL' end || ' dropdown unknown id' || chr(10);
  r := tk_cf_value_set(f_dd, c_task1, to_jsonb(opt_a));
  log := log || case when r ->> 'value' = opt_a then 'PASS' else 'FAIL' end || ' dropdown ok' || chr(10);
  r := tk_cf_value_set(f_text, c_task2, '"   "'::jsonb);
  log := log || case when r -> 'value' is null or r -> 'value' = 'null'::jsonb then 'PASS' else 'FAIL' end || ' blank text stores null' || chr(10);
  r := tk_cf_value_set(f_num, c_task2, 'null'::jsonb);
  log := log || case when (select value from tk_custom_field_values where field_id = f_num and task_id = c_task2) is null then 'PASS' else 'FAIL' end || ' json null clears' || chr(10);

  -- 4. retired options
  r := tk_cf_field_save(f_dd, null, null, 'Bank', null, jsonb_build_array(jsonb_build_object('id', opt_b, 'label', 'Savings acct'), jsonb_build_object('label', 'Payroll')));
  log := log || case when (select count(*) from jsonb_array_elements(r -> 'options') x where x ->> 'id' = opt_a and (x ->> 'retired')::boolean) = 1
                      and (select x ->> 'label' from jsonb_array_elements(r -> 'options') x where x ->> 'id' = opt_b) = 'Savings acct'
                     then 'PASS' else 'FAIL' end || ' used option kept retired; rename by id' || chr(10);
  log := log || case when pg_temp.err(format('select tk_cf_value_set(%L, %L, %L)', f_dd, c_task2, to_jsonb(opt_a))) like 'tk_cf_bad_value%retired%' then 'PASS' else 'FAIL' end || ' retired option cannot be picked' || chr(10);
  r := tk_cf_value_set(f_dd, c_task1, to_jsonb(opt_a));
  log := log || case when r ->> 'value' = opt_a then 'PASS' else 'FAIL' end || ' retired value re-save is a no-op' || chr(10);
  log := log || case when pg_temp.err(format('select tk_cf_field_save(%L, null, null, %L, null, %L)', f_dd, 'Bank',
                 jsonb_build_array(jsonb_build_object('id', opt_b, 'label', 'X'), jsonb_build_object('id', opt_b, 'label', 'Y'))::text)) like 'tk_cf_bad_options%' then 'PASS' else 'FAIL' end || ' duplicate option ids' || chr(10);

  -- 5. scope: a project field on a client-only task (trigger, direct insert as postgres)
  perform pg_temp.as_postgres();
  log := log || case when pg_temp.err(format('insert into tk_custom_field_values (field_id, task_id, value) values (%L, %L, %L)', f_text, c_ctask, '"x"')) like 'tk_cf_wrong_scope%' then 'PASS' else 'FAIL' end || ' wrong scope (trigger)' || chr(10);
  log := log || case when pg_temp.err(format('update tk_custom_field_values set task_id = %L where field_id = %L and task_id = %L', c_task2, f_text, c_task1)) like 'tk_cf_bad_value%' then 'PASS' else 'FAIL' end || ' value cannot move' || chr(10);

  -- 6. cap, archive, restore, order
  perform pg_temp.as_user(c_owner);
  for i in 1..9 loop
    perform tk_cf_field_save(null, 'project', c_proj::text, 'Extra ' || i, 'text', null);
  end loop;
  log := log || case when pg_temp.err(format('select tk_cf_field_save(null, %L, %L, %L, %L, null)', 'project', c_proj, 'Sixteen', 'text')) like 'tk_cf_limit%' then 'PASS' else 'FAIL' end || ' cap 15' || chr(10);
  perform tk_cf_field_archive(f_text, true);
  log := log || case when pg_temp.err(format('select tk_cf_value_set(%L, %L, %L)', f_text, c_task1, '"changed"')) like 'tk_cf_archived%' then 'PASS' else 'FAIL' end || ' archived field refuses values' || chr(10);
  log := log || case when pg_temp.err(format('select tk_cf_field_save(%L, null, null, %L, null, null)', f_text, 'Fund 2')) like 'tk_cf_archived%' then 'PASS' else 'FAIL' end || ' archived field refuses edits' || chr(10);
  perform tk_cf_field_save(null, 'project', c_proj::text, 'Fund', 'text', null);
  log := log || case when pg_temp.err(format('select tk_cf_field_archive(%L, false)', f_text)) like 'tk_cf_limit%' then 'PASS' else 'FAIL' end || ' restore at cap' || chr(10);
  perform tk_cf_field_archive((select id from tk_custom_fields where project_id = c_proj and name = 'Extra 9'), true);
  log := log || case when pg_temp.err(format('select tk_cf_field_archive(%L, false)', f_text)) like 'tk_cf_name_taken%' then 'PASS' else 'FAIL' end || ' restore with name clash' || chr(10);
  log := log || case when (select value from tk_custom_field_values where field_id = f_text and task_id = c_task1) = to_jsonb('hello'::text) then 'PASS' else 'FAIL' end || ' archived value kept' || chr(10);
  select array_agg(id order by position desc) into ids from tk_custom_fields where project_id = c_proj and archived_at is null;
  log := log || case when pg_temp.err(format('select tk_cf_field_order(%L)', ids[1:3])) like 'tk_cf_bad_order%' then 'PASS' else 'FAIL' end || ' order needs all ids' || chr(10);
  log := log || case when pg_temp.err(format('select tk_cf_field_order(%L)', ids || f_text)) like 'tk_cf_bad_order%' then 'PASS' else 'FAIL' end || ' order refuses archived id' || chr(10);
  perform tk_cf_field_order(ids);
  log := log || case when (select id from tk_custom_fields where project_id = c_proj and archived_at is null and position = 0) = ids[1] then 'PASS' else 'FAIL' end || ' order saved' || chr(10);
  select count(*) into n from tk_cf_values(array[c_task1]);
  log := log || case when n = 5 then 'PASS' else 'FAIL (' || n || ')' end || ' tk_cf_values skips archived + null' || chr(10);

  -- 7. who can manage
  log := log || case when pg_temp.err(format('select tk_cf_field_save(null, %L, %L, %L, %L, null)', 'client', c_client, 'Grant', 'text')) like 'tk_forbidden%' then 'PASS' else 'FAIL' end || ' non-admin cannot add client field' || chr(10);
  perform pg_temp.as_user(c_member);
  log := log || case when pg_temp.err(format('select tk_cf_field_save(null, %L, %L, %L, %L, null)', 'project', c_proj, 'Member field', 'text')) like 'tk_forbidden%' then 'PASS' else 'FAIL' end || ' member cannot add project field' || chr(10);
  log := log || case when pg_temp.err(format('select tk_cf_field_archive(%L, true)', f_num)) like 'tk_forbidden%' then 'PASS' else 'FAIL' end || ' member cannot archive' || chr(10);
  log := log || case when pg_temp.err(format('select tk_cf_field_order(%L)', ids)) like 'tk_forbidden%' then 'PASS' else 'FAIL' end || ' member cannot reorder' || chr(10);
  ok := tk_can_edit_task(c_task1);
  log := log || case when (pg_temp.err(format('select tk_cf_value_set(%L, %L, %L)', f_num, c_task1, '7')) = 'NO ERROR') = ok then 'PASS' else 'FAIL' end
             || ' member value set matches tk_can_edit_task (' || ok || ')' || chr(10);
  log := log || case when pg_temp.err(format('insert into tk_custom_field_values (field_id, task_id, value) values (%L, %L, %L)', f_num, c_task2, '3')) like '%permission denied%' then 'PASS' else 'FAIL' end || ' no direct insert' || chr(10);
  log := log || case when pg_temp.err(format('update tk_custom_fields set name = %L where id = %L', 'Hacked', f_num)) like '%permission denied%' then 'PASS' else 'FAIL' end || ' no direct update' || chr(10);
  log := log || case when pg_temp.err(format('delete from tk_custom_field_values where field_id = %L', f_num)) like '%permission denied%' then 'PASS' else 'FAIL' end || ' no direct delete' || chr(10);

  -- 8. RLS reads match the task/project helpers
  for c_other in select unnest(array[c_member, c_other, 'nicole@mygoodbooks.org', 'carmen@mygoodbooks.org']) loop
    perform pg_temp.as_user(c_other);
    select count(*) into n from tk_custom_fields where project_id = c_proj;
    ok := tk_can_see_project(c_proj);
    select count(*) into m from tk_custom_field_values v where v.field_id in (f_text, f_num, f_date, f_chk, f_dd, f_person);
    -- values need the task readable AND the field visible (project fields: tk_can_see_project)
    log := log || case when (n > 0) = ok and (m > 0) = ((tk_can_read_task(c_task1) or tk_can_read_task(c_task2)) and ok)
                       then 'PASS' else 'FAIL' end
               || ' RLS ' || c_other || ' fields=' || n || ' see_project=' || ok || ' values=' || m || chr(10);
  end loop;

  -- 9. admin client field, anon, not staff
  perform pg_temp.as_user(c_admin);
  r := tk_cf_field_save(null, 'client', c_client, 'Grant', 'dropdown', '[{"label":"CDBG"}]'::jsonb);
  f_cli := (r ->> 'id')::uuid;
  log := log || case when f_cli is not null then 'PASS' else 'FAIL' end || ' admin adds client field' || chr(10);
  r := tk_cf_value_set(f_cli, c_task1, to_jsonb(r -> 'options' -> 0 ->> 'id'));
  log := log || case when r ->> 'ok' = 'true' then 'PASS' else 'FAIL' end || ' client field on project task tied to the client' || chr(10);
  r := tk_cf_value_set(f_cli, c_ctask, to_jsonb((select options -> 0 ->> 'id' from tk_custom_fields where id = f_cli)));
  log := log || case when r ->> 'ok' = 'true' then 'PASS' else 'FAIL' end || ' client field on client task' || chr(10);
  log := log || case when pg_temp.err(format('select tk_cf_value_set(%L, %L, %L)', f_num, c_ctask, '1')) like 'tk_cf_wrong_scope%' then 'PASS' else 'FAIL' end || ' project field on client task (rpc)' || chr(10);
  perform pg_temp.as_user('stranger@example.com');
  log := log || case when pg_temp.err(format('select tk_cf_value_set(%L, %L, %L)', f_num, c_task1, '1')) like 'tk_forbidden%' then 'PASS' else 'FAIL' end || ' non-staff value set' || chr(10);
  select count(*) into n from tk_custom_fields;
  log := log || case when n = 0 then 'PASS' else 'FAIL' end || ' non-staff sees no fields' || chr(10);
  select count(*) into n from tk_cf_values(null);
  log := log || case when n = 0 then 'PASS' else 'FAIL' end || ' non-staff tk_cf_values empty' || chr(10);
  execute 'reset role';
  execute 'set local role anon';
  log := log || case when pg_temp.err('select count(*) from tk_custom_fields') like '%permission denied%' then 'PASS' else 'FAIL' end || ' anon table read' || chr(10);
  log := log || case when pg_temp.err('select tk_cf_values(null)') like '%permission denied%' then 'PASS' else 'FAIL' end || ' anon rpc' || chr(10);
  execute 'reset role';

  -- 10. a task moved off the project keeps its values stored but they no longer read
  perform pg_temp.as_postgres();
  select count(*) into m from tk_custom_field_values where task_id = c_task1 and value is not null;
  update staff_reminders set project_id = null where id = c_task1;
  perform pg_temp.as_user(c_admin);
  select count(*) into n from tk_cf_values(array[c_task1]);
  log := log || case when n = 1 then 'PASS' else 'FAIL (' || n || ')' end || ' moved task: only the client field value reads (rpc)' || chr(10);
  select count(*) into n from tk_custom_field_values where task_id = c_task1;
  log := log || case when n = 1 then 'PASS' else 'FAIL (' || n || ')' end || ' moved task: only the client field value reads (RLS)' || chr(10);
  perform pg_temp.as_postgres();
  select count(*) into n from tk_custom_field_values where task_id = c_task1 and value is not null;
  log := log || case when n = m then 'PASS' else 'FAIL' end || ' moved task: values still stored (' || n || ')' || chr(10);
  execute 'reset role';

  raise exception E'TEST RESULTS (rolled back)\n%', log;
end $t$;
