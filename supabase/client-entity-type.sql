-- Client entity type: nonprofit or for-profit (QBO features plan, Phase 1,
-- 2026-09-30). Stored and displayed only for now; later phases will use it
-- to pick report wording (Statement of Activities vs Profit and Loss).
--
-- Status: Applied to production 2026-09-30
-- Safe to re-run. Depends on staff-schema.sql (is_active_staff,
-- can_access_client).
--
-- Only admins can update public.clients directly (RLS "admins can update
-- clients"), so bookkeepers set the type from the onboarding card through
-- set_client_entity_type(), which checks they can access the client.

alter table public.clients
  add column if not exists entity_type text not null default 'nonprofit';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'clients_entity_type_check') then
    alter table public.clients
      add constraint clients_entity_type_check check (entity_type in ('nonprofit', 'for_profit'));
  end if;
end $$;

create or replace function public.set_client_entity_type(p_client_id text, p_entity_type text)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_active_staff() or not public.can_access_client(p_client_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_entity_type not in ('nonprofit', 'for_profit') then
    raise exception 'entity type must be nonprofit or for_profit' using errcode = '22023';
  end if;
  update public.clients set entity_type = p_entity_type where id = p_client_id;
  if not found then
    raise exception 'client not found' using errcode = 'P0002';
  end if;
  return p_entity_type;
end;
$$;

revoke all on function public.set_client_entity_type(text, text) from public, anon;
grant execute on function public.set_client_entity_type(text, text) to authenticated;
