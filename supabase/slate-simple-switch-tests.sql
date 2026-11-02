-- Checks for supabase/slate-simple-switch.sql (read only). Each row should say true.
select public.tk__owner_only_key('slatesimple_enabled') as switch_is_owner_only,
       public.tk__owner_only_key('slateplus_enabled') as older_keys_kept,
       public.tk__owner_only_key('create_menu_enabled') as newest_older_key_kept,
       not exists (select 1 from public.tk_settings where key = 'slatesimple_enabled') as switch_row_absent_means_off;
