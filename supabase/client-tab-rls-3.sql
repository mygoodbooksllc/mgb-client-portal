-- Client tab RLS, part 3 (S3): org-hidden tabs move to the server, plus a
-- small follow-up on the budget comment delete RPC.
-- Applied to production 2026-10-30 (migration client_tab_rls_3). Checked in a
-- rolled-back block: the trigger stamps only hidden_tabs changes, the app's
-- one-time copy filter applies once and never after a value was saved, and
-- unknown keys still fail clients_hidden_tabs_known.
-- Additive: one nullable column, one trigger, one function body. No data
-- changes. Run after client-tab-rls.sql and client-tab-rls-2.sql.
--
-- 1. clients.hidden_tabs_updated_at
--    The "Organization tabs" switches in Manage access now write
--    clients.hidden_tabs (app.jsx toggleTab; admins only, policy "admins can
--    update clients"), and every login's resolveAccess reads it from the
--    roster row, so the client's browser and the qbo_* RLS agree.
--    The old per-browser setting (localStorage mygoodbooks_tab_config_v2) is
--    copied up once, when an admin opens Organization tabs for a client, and
--    only while the server has never held a value for that client:
--    hidden_tabs = '{}' AND hidden_tabs_updated_at IS NULL. This column is
--    what makes "never" true: it is stamped by the trigger below on any change
--    to hidden_tabs, so once a value has been saved (even back to none hidden)
--    a second admin's stale browser can't bring old hidden tabs back.
--
-- 2. delete_client_budget_comment(p_id) now checks
--    can_use_client_tools(client_id, array['budget']) (was the one-argument
--    form, which means "budget or reports"). Budget comments live only on the
--    Pro Budget page (components/pro/ProBudget.jsx), the same tab the
--    client_budget_comments policies use since client-tab-rls-2.sql (S2).
--    search_path also gains pg_temp (S5). Body otherwise unchanged.

-- ---------------------------------------------------------------- 1
alter table public.clients
  add column if not exists hidden_tabs_updated_at timestamptz;

comment on column public.clients.hidden_tabs_updated_at is
  'Set by trigger whenever hidden_tabs changes. NULL = the server never held an org-hidden tab setting, so the one-time copy of a browser''s old setting may run (app.jsx).';

create or replace function public.clients_hidden_tabs_stamp()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.hidden_tabs is distinct from old.hidden_tabs then
    new.hidden_tabs_updated_at := now();
  end if;
  return new;
end;
$$;

revoke all on function public.clients_hidden_tabs_stamp() from public, anon, authenticated;

drop trigger if exists clients_hidden_tabs_stamp on public.clients;
create trigger clients_hidden_tabs_stamp
  before update of hidden_tabs on public.clients
  for each row execute function public.clients_hidden_tabs_stamp();

-- ---------------------------------------------------------------- 2
create or replace function public.delete_client_budget_comment(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_email text := nullif(btrim(auth.jwt() ->> 'email'), '');
  r record;
begin
  if v_email is null then
    raise exception 'Sign in to delete a comment.' using errcode = '42501';
  end if;
  select client_id, author_email, deleted_at into r
    from client_budget_comments where id = p_id for update;
  if not found or r.deleted_at is not null
     or not public.can_use_client_tools(r.client_id, array['budget']::text[]) then
    raise exception 'That comment was not found.' using errcode = 'P0002';
  end if;
  if lower(coalesce(r.author_email, '')) <> lower(v_email) and not public.is_active_staff_admin() then
    raise exception 'Only the person who wrote this comment or an admin can delete it.'
      using errcode = '42501';
  end if;
  perform set_config('mgb.soft_delete', 'on', true);
  update client_budget_comments
     set deleted_at = now(), deleted_by_email = v_email
   where id = p_id;
  perform set_config('mgb.soft_delete', '', true);
end;
$function$;
