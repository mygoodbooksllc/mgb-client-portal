-- Shout-outs (owner request 2026-10-07). Staff only.
--
-- Applied to production 2026-10-07 as migration staff_shoutouts.
-- Safe to re-run.
--
--   staff_shoutouts   a short thank-you from one staff member to another,
--                     optionally about a client. Every active staff member
--                     can read them. Authors hide their own; admins hide
--                     any. Never deleted: hide sets hidden_at / hidden_by
--                     (and can be undone by the same people).
--
-- The recipient sees it in the top-bar bell (app side, "shout:" items).
-- No email is sent. The quarterly review form shows the reviewee's
-- shout-outs for that quarter, read-only and not copied into the review.
--
-- Clients can't see any of it: every policy needs active staff.

create table if not exists public.staff_shoutouts (
  id uuid primary key default gen_random_uuid(),
  from_email text not null,
  to_email text not null,
  body text not null,
  client_id text references public.clients (id) on delete set null,
  created_at timestamptz not null default now(),
  hidden_at timestamptz,
  hidden_by text,
  constraint staff_shoutouts_body_check check (length(trim(body)) between 1 and 500),
  constraint staff_shoutouts_not_self check (lower(from_email) <> lower(to_email))
);
create index if not exists staff_shoutouts_created_idx on public.staff_shoutouts (created_at desc);
create index if not exists staff_shoutouts_to_idx on public.staff_shoutouts (to_email, created_at desc);

alter table public.staff_shoutouts enable row level security;

-- Hidden ones stay visible to their author and to admins only.
drop policy if exists "staff read shoutouts" on public.staff_shoutouts;
create policy "staff read shoutouts" on public.staff_shoutouts
  for select to authenticated
  using (
    public.is_active_staff()
    and (hidden_at is null
         or lower(from_email) = lower(auth.jwt() ->> 'email')
         or public.is_active_staff_admin())
  );

drop policy if exists "staff add shoutouts" on public.staff_shoutouts;
create policy "staff add shoutouts" on public.staff_shoutouts
  for insert to authenticated
  with check (public.is_active_staff() and lower(from_email) = lower(auth.jwt() ->> 'email'));

drop policy if exists "author or admin hides shoutouts" on public.staff_shoutouts;
create policy "author or admin hides shoutouts" on public.staff_shoutouts
  for update to authenticated
  using (
    public.is_active_staff()
    and (lower(from_email) = lower(auth.jwt() ->> 'email') or public.is_active_staff_admin())
  )
  with check (
    public.is_active_staff()
    and (lower(from_email) = lower(auth.jwt() ->> 'email') or public.is_active_staff_admin())
  );

-- No delete policy: rows are hidden, never deleted.
revoke all on public.staff_shoutouts from anon;
revoke delete, truncate on public.staff_shoutouts from authenticated;
grant select, insert, update on public.staff_shoutouts to authenticated;

-- Stamps the author and time, checks the recipient, and on update only lets
-- the hidden flag change (who hid it is stamped).
create or replace function public.staff_shoutouts_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me text := lower(auth.jwt() ->> 'email');
begin
  if tg_op = 'INSERT' then
    new.to_email := lower(trim(new.to_email));
    new.from_email := lower(trim(new.from_email));
    if auth.uid() is not null then
      new.from_email := v_me;
      new.created_at := now();
    end if;
    new.hidden_at := null;
    new.hidden_by := null;
    new.body := trim(new.body);
    if not exists (select 1 from staff s where lower(s.email) = new.to_email and s.active) then
      raise exception 'not an active staff member' using errcode = '22023';
    end if;
    if new.client_id is not null and auth.uid() is not null
       and not public.can_access_client(new.client_id) then
      raise exception 'not allowed for this client' using errcode = '42501';
    end if;
  else
    new.id := old.id;
    new.from_email := old.from_email;
    new.to_email := old.to_email;
    new.body := old.body;
    new.client_id := old.client_id;
    new.created_at := old.created_at;
    if new.hidden_at is null then
      new.hidden_by := null;
    elsif old.hidden_at is null then
      new.hidden_at := now();
      new.hidden_by := coalesce(v_me, new.hidden_by);
    else
      new.hidden_at := old.hidden_at;
      new.hidden_by := old.hidden_by;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.staff_shoutouts_guard() from public, anon, authenticated;

drop trigger if exists staff_shoutouts_guard_trg on public.staff_shoutouts;
create trigger staff_shoutouts_guard_trg
  before insert or update on public.staff_shoutouts
  for each row execute function public.staff_shoutouts_guard();
