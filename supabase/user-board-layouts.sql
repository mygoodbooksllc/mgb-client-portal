-- Customizable boards follow the signed-in person across browsers and devices
-- (owner request 2026-09-30).
-- Applied to production 2026-09-30 as migration user_board_layouts (RLS tested: own rows only).
--
-- One row per person per board. A "board" is any page with the Customize
-- drawer (components/dashboard/WidgetDrawer.jsx):
--   * client Dashboard, full access   board_key  <clientId>:full
--   * client Dashboard, limited user  board_key  <clientId>:scoped:<areas>
--   * staff Bookkeeper Home           board_key  bookkeeper-home
--   * Live Report                     board_key  live-report:<clientId>
-- layout is { order: [...widget ids], hidden: [...widget ids] } (null until the
-- person first changes the layout); views is the list of saved views,
-- [{ name, order, hidden }, ...].
--
-- The browser keeps localStorage as a cache and fallback (offline, signed out,
-- this table missing), uploads an existing local layout the first time it
-- finds no row here, and skips writes during staff "View as" / client-user
-- preview so those sessions never overwrite the staff member's own rows.
--
-- Who can do what: any authenticated user (staff or client) reads, inserts,
-- updates and deletes only their own rows. user_email is stamped from the JWT
-- by the trigger, so nobody can write a row under someone else's email.

create table if not exists public.user_board_layouts (
  user_email text not null default lower(auth.jwt() ->> 'email'),
  board_key text not null check (char_length(board_key) between 1 and 200),
  layout jsonb check (
    layout is null
    or (jsonb_typeof(layout) = 'object' and pg_column_size(layout) <= 16384)
  ),
  views jsonb not null default '[]'::jsonb check (
    jsonb_typeof(views) = 'array' and pg_column_size(views) <= 65536
  ),
  updated_at timestamptz not null default now(),
  primary key (user_email, board_key)
);

create or replace function public.user_board_layouts_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.user_email := lower(auth.jwt() ->> 'email');
  if new.user_email is null or new.user_email = '' then
    raise exception 'user_board_layouts: no signed-in email';
  end if;
  if tg_op = 'UPDATE' then
    new.board_key := old.board_key;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function public.user_board_layouts_guard() from public, anon, authenticated;

drop trigger if exists user_board_layouts_guard on public.user_board_layouts;
create trigger user_board_layouts_guard
  before insert or update on public.user_board_layouts
  for each row execute function public.user_board_layouts_guard();

alter table public.user_board_layouts enable row level security;

drop policy if exists "own board layouts select" on public.user_board_layouts;
create policy "own board layouts select"
  on public.user_board_layouts for select to authenticated
  using (user_email = lower(auth.jwt() ->> 'email'));

drop policy if exists "own board layouts insert" on public.user_board_layouts;
create policy "own board layouts insert"
  on public.user_board_layouts for insert to authenticated
  with check (user_email = lower(auth.jwt() ->> 'email'));

drop policy if exists "own board layouts update" on public.user_board_layouts;
create policy "own board layouts update"
  on public.user_board_layouts for update to authenticated
  using (user_email = lower(auth.jwt() ->> 'email'))
  with check (user_email = lower(auth.jwt() ->> 'email'));

drop policy if exists "own board layouts delete" on public.user_board_layouts;
create policy "own board layouts delete"
  on public.user_board_layouts for delete to authenticated
  using (user_email = lower(auth.jwt() ->> 'email'));

revoke all on public.user_board_layouts from anon;
revoke truncate on public.user_board_layouts from authenticated;
grant select, insert, update, delete on public.user_board_layouts to authenticated;
