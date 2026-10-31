-- Weekly audit W-20261019-1 and baseline M1.
--
-- W-20261019-1. can_use_client_tools() let any active member of an org use
-- the Pro tools (budget drafts, report shares, templates, branding, ...), so
-- a category-limited client user saw and changed whole-org data. Members now
-- need access = 'full', the same rule can_approve_client_budget() uses. Staff
-- are unchanged. The member branch of "client requests read" now shows a
-- limited user only the requests addressed to them.
--
-- M1. Report share links: the browser chose the token and created_by, and any
-- member could edit any link. A trigger now fills the token when none is sent
-- (the app's next version sends none), always stamps created_by from the
-- login, refuses short tokens, and after creation allows only turning a link
-- off (revoked_at).
--
-- No one is affected today: every client user has access = 'full'.

create or replace function public.can_use_client_tools(p_client_id text)
returns boolean
language sql
stable security definer
set search_path = public
as $$
  select (public.is_active_staff() and public.can_access_client(p_client_id))
      or (public.is_client_member(p_client_id)
          and exists (
            select 1 from client_users cu
             where lower(cu.email) = lower(nullif(btrim(auth.jwt() ->> 'email'), ''))
               and cu.client_id = p_client_id and cu.active and cu.access = 'full'));
$$;

alter policy "client requests read" on public.client_requests
  using (
    (deleted_at is null
      and public.is_client_member(client_id)
      and (exists (
             select 1 from client_users cu
              where lower(cu.email) = lower(nullif(btrim(auth.jwt() ->> 'email'), ''))
                and cu.client_id = client_requests.client_id and cu.active and cu.access = 'full')
           or lower(auth.jwt() ->> 'email') = any (
             select lower(r) from unnest(coalesce(recipient_emails, '{}'::text[])) r)))
    or (public.is_active_staff() and public.can_access_client(client_id))
  );

alter policy "client tools report shares" on public.client_report_shares
  to authenticated;

create or replace function public.client_report_shares_before_write()
returns trigger
language plpgsql
-- Runs as the caller (not SECURITY DEFINER) so current_user tells API
-- writes apart from server functions.
set search_path = public, extensions
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.token is null or new.token = '' then
      new.token := encode(gen_random_bytes(32), 'hex');
    elsif length(new.token) < 64 or new.token !~ '^[0-9a-f]+$' then
      raise exception 'client_report_shares: token must be 64+ hex characters' using errcode = '22023';
    end if;
    new.created_by := auth.jwt() ->> 'email';
    new.created_at := now();
    new.revoked_at := null;
  else
    if new.token is distinct from old.token
       or new.client_id is distinct from old.client_id
       or new.title is distinct from old.title
       or new.snapshot is distinct from old.snapshot
       or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at
       or new.expires_at is distinct from old.expires_at
       or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at) then
      raise exception 'client_report_shares: a share link can only be turned off' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create or replace trigger client_report_shares_before_write
  before insert or update on public.client_report_shares
  for each row execute function public.client_report_shares_before_write();
