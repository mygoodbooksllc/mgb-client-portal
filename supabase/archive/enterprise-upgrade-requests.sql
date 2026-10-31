-- Lets a client-portal user click "Upgrade to Enterprise" on the Enterprise
-- upgrade preview page (EnterpriseUpgradePage in app.jsx) and have that
-- actually land somewhere a bookkeeper can see and act on it, instead of
-- just a toast that goes nowhere. Surfaced on Bookkeeper Home under
-- "Enterprise upgrade requests" (open, status = 'new' requests).
--
-- Client portal access in this app is mostly the mock "Preview As" flow, not
-- a real Supabase Auth session (see the note on clientPortalUser in App and
-- ClientAuthGate.jsx, which only covers clients with realAuthEnabled) — so a
-- bare RLS insert policy keyed on auth.uid() wouldn't cover most client
-- portal users. Same posture as access-requests.sql's submit_access_request:
-- a SECURITY DEFINER RPC does the insert, open to anon + authenticated,
-- rather than a public insert policy on the table itself. Builds on
-- staff-schema.sql / access-requests.sql for public.is_active_staff() —
-- either is fine, this just needs the function to exist. Run this once in
-- the Supabase SQL editor.

create table if not exists enterprise_upgrade_requests (
  id uuid primary key default gen_random_uuid(),
  -- Matches a client's id in data.js (there's no clients table yet — same
  -- posture as access_requests.client_id), not a foreign key.
  client_id text not null,
  -- The client portal user's name/email if available (see clientPortalUser
  -- in App), falling back to a generic "Someone at <client name>" client
  -- side when neither is known.
  requested_by text,
  created_at timestamptz not null default now(),
  status text not null default 'new',
  -- For a future staff comment on the request; nullable, unused by the UI
  -- yet.
  note text
);

alter table enterprise_upgrade_requests
  drop constraint if exists enterprise_upgrade_requests_status_check;
alter table enterprise_upgrade_requests
  add constraint enterprise_upgrade_requests_status_check
  check (status in ('new', 'contacted', 'completed', 'dismissed'));

alter table enterprise_upgrade_requests enable row level security;

-- Read visibility: any active staff member, not admin-only — "so I can make
-- them premium clients" applies to whoever on staff gets to it first, same
-- read-visibility posture as client_notes.
drop policy if exists "staff read upgrade requests" on enterprise_upgrade_requests;
create policy "staff read upgrade requests"
  on enterprise_upgrade_requests for select
  using (public.is_active_staff());

-- Staff can also update status by hand (mark contacted/completed/dismissed
-- from Bookkeeper Home), and write rows directly if needed (e.g. filing one
-- on a client's behalf after a phone call).
drop policy if exists "staff update upgrade requests" on enterprise_upgrade_requests;
create policy "staff update upgrade requests"
  on enterprise_upgrade_requests for update
  using (public.is_active_staff())
  with check (public.is_active_staff());

drop policy if exists "staff write upgrade requests" on enterprise_upgrade_requests;
create policy "staff write upgrade requests"
  on enterprise_upgrade_requests for insert
  with check (public.is_active_staff());

-- Sole public submission path, mirroring submit_access_request: security
-- definer so it bypasses RLS (the insert policy above is staff-only), and
-- does its own basic validation and a per-client rate-limit check up front
-- (at most 5 open ("new") requests per client at a time) so a script can't
-- spam this endpoint into an unbounded queue for one client. Atomic — the
-- count check and insert happen inside the same function call, no
-- check-then-insert race from the caller's side.
create or replace function public.request_enterprise_upgrade(
  p_client_id text,
  p_requested_by text
)
returns enterprise_upgrade_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_open_count integer;
  v_row enterprise_upgrade_requests;
begin
  if p_client_id is null or length(trim(p_client_id)) = 0 then
    raise exception 'invalid_client_id' using errcode = 'P0001';
  end if;

  if p_requested_by is not null and length(p_requested_by) > 200 then
    raise exception 'requested_by_too_long' using errcode = 'P0001';
  end if;

  select count(*) into v_open_count
  from enterprise_upgrade_requests
  where client_id = p_client_id and status = 'new';

  if v_open_count >= 5 then
    raise exception 'too_many_open_requests' using errcode = 'P0001';
  end if;

  insert into enterprise_upgrade_requests (client_id, requested_by)
  values (p_client_id, p_requested_by)
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.request_enterprise_upgrade(text, text) to anon;
grant execute on function public.request_enterprise_upgrade(text, text) to authenticated;
