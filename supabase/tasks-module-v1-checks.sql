-- =====================================================================
-- Tasks module, Phase 1 (tk v1): read-only checks for tasks-module-v1.sql.
-- Spec: docs/tasks-phase1-spec.md Part D, "tasks-module-v1-checks.sql".
--
-- SELECTs only. No writes, no transaction control. Every statement
-- returns rows of (chk text, ok boolean, detail text). detail never holds
-- an email, a name or task text: only object names, counts and flags.
-- Run each statement on its own (or all of them; each one stands alone).
-- =====================================================================

-- check 1: D1 columns and project_id exist with the right type and default
select 'check 1 column ' || x.col as chk,
       c.column_name is not null
         and format_type(a.atttypid, a.atttypmod) = x.typ
         and coalesce(pg_get_expr(d.adbin, d.adrelid), '') like x.def
         and (x.nn is null or a.attnotnull = x.nn) as ok,
       coalesce(format_type(a.atttypid, a.atttypmod), 'missing') || ' default=' || coalesce(pg_get_expr(d.adbin, d.adrelid), 'none') as detail
  from (values
    ('status', 'text', '''todo''::text', true),
    ('status_changed_at', 'timestamp with time zone', '', null),
    ('status_changed_by', 'text', '', null),
    ('status_before_wait', 'text', '', null),
    ('waiting_since', 'timestamp with time zone', '', null),
    ('waiting_minutes', 'integer', '0', true),
    ('description', 'text', '', null),
    ('start_on', 'date', '', null),
    ('section', 'text', '', null),
    ('sort_key', 'numeric', '', null),
    ('parent_id', 'uuid', '', null),
    ('sop_section', 'text', '', null),
    ('review_required', 'boolean', 'false', true),
    ('series_id', 'uuid', '', null),
    ('updated_at', 'timestamp with time zone', 'now()', true),
    ('deleted_at', 'timestamp with time zone', '', null),
    ('deleted_by', 'text', '', null),
    ('project_id', 'uuid', '', null),
    ('search_tsv', 'tsvector', '%to_tsvector%', null)
  ) x(col, typ, def, nn)
  left join information_schema.columns c
    on c.table_schema = 'public' and c.table_name = 'staff_reminders' and c.column_name = x.col
  left join pg_attribute a
    on a.attrelid = 'public.staff_reminders'::regclass and a.attname = x.col and not a.attisdropped
  left join pg_attrdef d
    on d.adrelid = a.attrelid and d.adnum = a.attnum;

-- check 2: D1 and D3 CHECKs exist and are validated; shared_needs_client mentions project_id
select 'check 2 constraint ' || x.name as chk,
       k.oid is not null and k.convalidated
         and (x.name <> 'staff_reminders_shared_needs_client' or pg_get_constraintdef(k.oid) like '%project_id%') as ok,
       case when k.oid is null then 'missing'
            else 'validated=' || k.convalidated::text
                 || ' mentions_project_id=' || (pg_get_constraintdef(k.oid) like '%project_id%')::text end as detail
  from (values
    ('staff_reminders_status_check'),
    ('staff_reminders_status_before_wait_check'),
    ('staff_reminders_sop_section_check'),
    ('staff_reminders_description_len'),
    ('staff_reminders_section_len'),
    ('staff_reminders_shared_needs_client')
  ) x(name)
  left join pg_constraint k
    on k.conrelid = 'public.staff_reminders'::regclass and k.conname = x.name;

-- check 3: C3 functions exist, definer as expected, search_path=public, no anon execute,
-- authenticated execute only where C3 says so (internal and trigger functions have none)
select 'check 3 function ' || x.sig as chk,
       p.oid is not null
         and p.prosecdef = x.definer
         and 'search_path=public' = any (coalesce(p.proconfig, '{}'))
         and not has_function_privilege('anon', p.oid, 'execute')
         and has_function_privilege('authenticated', p.oid, 'execute') = x.auth_exec as ok,
       case when p.oid is null then 'missing'
            else 'definer=' || p.prosecdef::text
                 || ' search_path_public=' || ('search_path=public' = any (coalesce(p.proconfig, '{}')))::text
                 || ' anon_exec=' || has_function_privilege('anon', p.oid, 'execute')::text
                 || ' auth_exec=' || has_function_privilege('authenticated', p.oid, 'execute')::text end as detail
  from (values
    ('tk_schema_version()', false, true),
    ('tk_can_read_task(uuid)', true, true),
    ('tk_can_edit_task(uuid)', true, true),
    ('tk_row_readable(uuid,text,text,text,uuid,text)', true, true),
    ('tk_is_project_member(uuid)', true, true),
    ('tk_can_see_project(uuid)', true, true),
    ('tk_can_manage_project(uuid)', true, true),
    ('tk_project_info(uuid)', true, true),
    ('tk_path_task_id(text)', false, true),
    ('tk_can_upload_task_file(text)', true, true),
    ('tk_staff_has_client(text,text)', true, false),
    ('tk_task_scope_ok(uuid,text)', true, false),
    ('tk_parse_mentions(text,uuid)', true, false),
    ('complete_staff_item(uuid,boolean,date)', true, true),
    ('tk_set_status(uuid,text,text,date)', true, true),
    ('tk_add_follower(uuid,text)', true, true),
    ('tk_attach_client_file(uuid,uuid)', true, true),
    ('tk_search(text,integer)', true, true),
    ('tk_client_people(text)', true, true),
    ('tk_assignable_staff(text,uuid)', true, true),
    ('tk_staff_reminders_soft_delete()', true, false),
    ('staff_reminders_before_write()', false, false),
    ('tk_projects_before_insert()', true, false),
    ('tk_projects_before_update()', false, false),
    ('tk_projects_after_insert()', true, false),
    ('tk_project_members_before_insert()', true, false),
    ('tk_project_members_before_update()', false, false),
    ('tk_comments_before_write()', true, false),
    ('tk_comments_follow()', true, false),
    ('tk_staff_reminders_activity()', true, false),
    ('tk_attachments_before_write()', true, false),
    ('tk_staff_reminders_autofollow()', true, false)
  ) x(sig, definer, auth_exec)
  left join pg_proc p on p.oid = to_regprocedure('public.' || x.sig);

-- check 4: RLS on the six tk_ tables
select 'check 4 rls ' || x.t as chk,
       coalesce(c.relrowsecurity, false) as ok,
       case when c.oid is null then 'missing' else 'rls=' || c.relrowsecurity::text end as detail
  from (values ('tk_projects'), ('tk_project_members'), ('tk_followers'),
               ('tk_comments'), ('tk_activity'), ('tk_attachments')) x(t)
  left join pg_class c on c.oid = to_regclass('public.' || x.t);

-- check 4: every policy named in D2, D8, D9 and D12 exists
select 'check 4 policy ' || x.tbl || ' / ' || x.pol as chk,
       p.policyname is not null and p.cmd = x.cmd as ok,
       coalesce('cmd=' || p.cmd, 'missing') as detail
  from (values
    ('public', 'tk_projects', 'tk projects read', 'SELECT'),
    ('public', 'tk_projects', 'tk projects insert', 'INSERT'),
    ('public', 'tk_projects', 'tk projects update', 'UPDATE'),
    ('public', 'tk_project_members', 'tk members read', 'SELECT'),
    ('public', 'tk_project_members', 'tk members insert', 'INSERT'),
    ('public', 'tk_project_members', 'tk members update', 'UPDATE'),
    ('public', 'tk_project_members', 'tk members delete', 'DELETE'),
    ('public', 'tk_followers', 'tk followers read', 'SELECT'),
    ('public', 'tk_followers', 'tk followers insert self', 'INSERT'),
    ('public', 'tk_followers', 'tk followers delete', 'DELETE'),
    ('public', 'tk_comments', 'tk comments read', 'SELECT'),
    ('public', 'tk_comments', 'tk comments insert', 'INSERT'),
    ('public', 'tk_comments', 'tk comments update', 'UPDATE'),
    ('public', 'tk_activity', 'tk activity read', 'SELECT'),
    ('public', 'tk_attachments', 'tk attachments read', 'SELECT'),
    ('public', 'tk_attachments', 'tk attachments insert', 'INSERT'),
    ('public', 'tk_attachments', 'tk attachments update', 'UPDATE'),
    ('public', 'staff_reminders', 'tk read tasks', 'SELECT'),
    ('public', 'staff_reminders', 'tk edit tasks', 'UPDATE'),
    ('public', 'task_checklist_items', 'tk edit checklist', 'ALL'),
    ('storage', 'objects', 'tk task files read', 'SELECT'),
    ('storage', 'objects', 'tk task files insert', 'INSERT')
  ) x(sch, tbl, pol, cmd)
  left join pg_policies p on p.schemaname = x.sch and p.tablename = x.tbl and p.policyname = x.pol;

-- check 4a: anon has no privilege on any tk_ table, the tk_tasks view or tk_activity_id_seq
select 'check 4a anon ' || x.t as chk,
       to_regclass('public.' || x.t) is not null
         and not exists (select 1 from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) pr
                          where has_table_privilege('anon', ('public.' || x.t)::regclass, pr)) as ok,
       case when to_regclass('public.' || x.t) is null then 'missing'
            else coalesce((select string_agg(pr, ',') from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) pr
                            where has_table_privilege('anon', ('public.' || x.t)::regclass, pr)), 'none') end as detail
  from (values ('tk_projects'), ('tk_project_members'), ('tk_followers'), ('tk_comments'),
               ('tk_activity'), ('tk_attachments'), ('tk_tasks')) x(t);

select 'check 4a sequence tk_activity_id_seq' as chk,
       to_regclass('public.tk_activity_id_seq') is not null
         and not exists (select 1 from unnest(array['USAGE','SELECT','UPDATE']) pr
                          where has_sequence_privilege('anon', 'public.tk_activity_id_seq', pr)
                             or has_sequence_privilege('authenticated', 'public.tk_activity_id_seq', pr)) as ok,
       case when to_regclass('public.tk_activity_id_seq') is null then 'missing'
            else coalesce((select string_agg(r || ':' || pr, ',')
                             from unnest(array['anon','authenticated']) r, unnest(array['USAGE','SELECT','UPDATE']) pr
                            where has_sequence_privilege(r, 'public.tk_activity_id_seq', pr)), 'none') end as detail;

-- check 4a: authenticated has exactly the grants D2, D8 and D11 list
select 'check 4a authenticated ' || x.t as chk,
       to_regclass('public.' || x.t) is not null
         and coalesce((select string_agg(pr, ',' order by pr)
                         from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) pr
                        where has_table_privilege('authenticated', ('public.' || x.t)::regclass, pr)), '') = x.want as ok,
       case when to_regclass('public.' || x.t) is null then 'missing'
            else 'has=' || coalesce((select string_agg(pr, ',' order by pr)
                                       from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) pr
                                      where has_table_privilege('authenticated', ('public.' || x.t)::regclass, pr)), '')
                 || ' want=' || x.want end as detail
  from (values
    ('tk_projects', 'INSERT,SELECT,UPDATE'),
    ('tk_project_members', 'DELETE,INSERT,SELECT,UPDATE'),
    ('tk_followers', 'DELETE,INSERT,SELECT'),
    ('tk_comments', 'INSERT,SELECT,UPDATE'),
    ('tk_activity', 'SELECT'),
    ('tk_attachments', 'INSERT,SELECT,UPDATE'),
    ('tk_tasks', 'SELECT')
  ) x(t, want);

-- check 5: the publication holds the five D14 tables
select 'check 5 publication ' || x.t as chk,
       exists (select 1 from pg_publication_tables pt
                where pt.pubname = 'supabase_realtime' and pt.schemaname = 'public' and pt.tablename = x.t) as ok,
       case when exists (select 1 from pg_publication where pubname = 'supabase_realtime')
            then 'publication present' else 'publication missing' end as detail
  from (values ('task_checklist_items'), ('tk_comments'), ('tk_activity'), ('tk_followers'), ('tk_attachments')) x(t);

-- check 6: the task-files bucket is private with a 25 MB limit
select 'check 6 bucket task-files' as chk,
       coalesce((select not b.public and b.file_size_limit = 26214400 from storage.buckets b where b.id = 'task-files'), false) as ok,
       coalesce((select 'public=' || b.public::text || ' limit=' || coalesce(b.file_size_limit::text, 'null')
                        || ' mimes=' || coalesce(cardinality(b.allowed_mime_types)::text, '0')
                   from storage.buckets b where b.id = 'task-files'), 'missing') as detail;

-- check 7: the D13 readers filter deleted tasks
select 'check 7 reader ' || x.sig as chk,
       coalesce(p.prosrc like '%deleted_at%', false) as ok,
       case when p.oid is null then 'missing'
            else 'mentions_deleted_at=' || (p.prosrc like '%deleted_at%')::text
                 || ' mentions_waiting_client=' || (p.prosrc like '%waiting_client%')::text end as detail
  from (values ('client_health(jsonb)'), ('digest_weekly_data(date,date)'),
               ('staff_performance(integer,jsonb)'), ('offboard_staff_preview(text)')) x(sig)
  left join pg_proc p on p.oid = to_regprocedure('public.' || x.sig);

-- check 8: invariants
select 'check 8 done matches status' as chk,
       count(*) = 0 as ok, count(*)::text || ' rows' as detail
  from public.staff_reminders where done <> (status = 'done');

select 'check 8 ready_for_review never done' as chk,
       count(*) = 0 as ok, count(*)::text || ' rows' as detail
  from public.staff_reminders where status = 'ready_for_review' and done;

select 'check 8 assignee lowercase' as chk,
       count(*) = 0 as ok, count(*)::text || ' rows' as detail
  from public.staff_reminders where assignee_email <> lower(assignee_email);

select 'check 8 schema version' as chk,
       public.tk_schema_version() = 1 as ok, public.tk_schema_version()::text as detail;

select 'check 8 seed project ' || x.name as chk,
       p.id is not null as ok,
       case when p.id is null then 'missing'
            else 'open_to_staff=' || p.open_to_staff::text || ' first-run expected=' || x.first_run::text end as detail
  from (values ('SOPs', true), ('Directors', false), ('Owners', false), ('90 Day', true)) x(name, first_run)
  left join public.tk_projects p
    on p.client_id is null and lower(p.name) = lower(x.name) and p.archived_at is null;

select 'check 8 mixed-case active staff' as chk,
       true as ok, count(*)::text || ' rows (follower inserts skip them)' as detail
  from public.staff where active and email <> lower(email);

-- check 9: triggers on staff_reminders, tk_comments and tk_project_members
select 'check 9 trigger ' || x.tbl || ' / ' || x.trg as chk,
       t.oid is not null and pg_get_triggerdef(t.oid) like x.shape as ok,
       coalesce(case when pg_get_triggerdef(t.oid) like x.shape then 'shape ok' else 'shape differs' end, 'missing') as detail
  from (values
    ('staff_reminders', 'staff_reminders_before_write', '%BEFORE INSERT OR UPDATE%'),
    ('staff_reminders', 'tk_staff_reminders_activity', '%AFTER INSERT OR UPDATE%'),
    ('staff_reminders', 'tk_staff_reminders_autofollow', '%AFTER INSERT OR UPDATE OF assignee_email%'),
    ('staff_reminders', 'tk_staff_reminders_soft_delete', '%BEFORE DELETE%'),
    ('staff_reminders', 'notify_enqueue_task_assigned', '%AFTER INSERT OR UPDATE%'),
    ('tk_comments', 'tk_comments_before_write', '%BEFORE INSERT OR UPDATE%'),
    ('tk_comments', 'tk_comments_follow', '%AFTER INSERT OR UPDATE OF body%'),
    ('tk_project_members', 'tk_project_members_before_insert', '%BEFORE INSERT%'),
    ('tk_project_members', 'tk_project_members_before_update', '%BEFORE UPDATE%')
  ) x(tbl, trg, shape)
  left join pg_trigger t
    on t.tgrelid = ('public.' || x.tbl)::regclass and t.tgname = x.trg and not t.tgisinternal;

select 'check 9 notify skips deleted' as chk,
       coalesce(p.prosrc like '%deleted_at%', false) as ok,
       case when p.oid is null then 'missing' else 'mentions_deleted_at=' || (p.prosrc like '%deleted_at%')::text end as detail
  from (select 1) one
  left join pg_proc p on p.oid = to_regprocedure('public.notify_enqueue_task_assigned()');

-- check 10: D4 and D8 indexes, including the client and client_file indexes
select 'check 10 index ' || x.idx as chk,
       to_regclass('public.' || x.idx) is not null as ok,
       case when to_regclass('public.' || x.idx) is null then 'missing' else 'present' end as detail
  from (values ('staff_reminders_tk_assignee_idx'), ('staff_reminders_tk_project_idx'), ('staff_reminders_tk_parent_idx'),
               ('staff_reminders_tk_updated_idx'), ('staff_reminders_tk_client_idx'), ('staff_reminders_tk_search_idx'),
               ('tk_attachments_task_idx'), ('tk_attachments_client_file_idx')) x(idx);

-- check 11: exactly one tk_set_status overload
select 'check 11 tk_set_status overloads' as chk,
       count(*) = 1 as ok, count(*)::text || ' overloads' as detail
  from pg_proc where proname = 'tk_set_status' and pronamespace = 'public'::regnamespace;

-- check 12: fix 1 (code review) is in place
select 'check 12 ' || x.what as chk, coalesce(x.ok, false) as ok, case when coalesce(x.ok, false) then 'present' else 'missing' end as detail
  from (values
    ('before_write staff and client gate',
       (select prosrc like '%current_user in (''anon'', ''authenticated'')%' and prosrc like '%can_access_client(new.client_id)%'
          from pg_proc where oid = to_regprocedure('public.staff_reminders_before_write()'))),
    ('edit rule checks staff before owner',
       (select position('is_active_staff()' in prosrc) < position('lower(v_r.staff_email) = v_me' in prosrc)
          from pg_proc where oid = to_regprocedure('public.tk_can_edit_task(uuid)'))),
    ('attachments insert needs staff',
       (select prosrc like '%is_active_staff()%' from pg_proc where oid = to_regprocedure('public.tk_attachments_before_write()'))),
    ('assigned email checks client access',
       (select prosrc like '%tk_staff_has_client(new.assignee_email, new.client_id)%'
          from pg_proc where oid = to_regprocedure('public.notify_enqueue_task_assigned()'))),
    ('project info masks client',
       (select prosrc like '%tk_can_see_project(p.id)%' from pg_proc where oid = to_regprocedure('public.tk_project_info(uuid)'))),
    ('tk_comments.edited_by column',
       exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'tk_comments' and column_name = 'edited_by'))
  ) x(what, ok);
