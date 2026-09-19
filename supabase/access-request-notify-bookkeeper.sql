-- §141: alongside the in-app "Manage access" glow (see app.jsx's
-- hasPendingAccessRequests), a client submitting an access request now
-- also drops a private reminder on their actual assigned bookkeeper's own
-- list -- a simultaneous, in-app "message" rather than relying on them to
-- notice the sidebar next time they look. Uses staff_client_access (the
-- real per-client staff assignment table that drives visibleClients/RLS),
-- not clients.assigned_bookkeeper (a free-text display label with no
-- email, entered by hand on the Client Roster page -- see §133/§139).
-- A client with more than one assigned staffer notifies all of them; a
-- client with none yet (no staff_client_access rows) simply gets none --
-- no error, no fallback to "all admins".
--
-- Builds on access-requests.sql (submit_access_request, replaced below
-- with an identical signature so this is a drop-in `create or replace`),
-- staff-client-access.sql, staff-reminders.sql, and clients-roster.sql
-- (for the client's display name). Run those first if you haven't.
--
-- Run this once in the Supabase SQL editor, or via the Supabase MCP's
-- apply_migration.

create or replace function public.submit_access_request(
  p_token text,
  p_client_id text,
  p_submitted_by_name text,
  p_submitted_by_email text,
  p_people jsonb
)
returns access_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link access_request_links;
  v_count integer;
  v_row access_requests;
  v_client_name text;
begin
  select * into v_link from access_request_links where token = p_token for update;

  if v_link is null or not v_link.active then
    raise exception 'invalid_or_inactive_token' using errcode = 'P0001';
  end if;

  if v_link.client_id <> p_client_id then
    raise exception 'client_id_mismatch' using errcode = 'P0001';
  end if;

  select count(*) into v_count from access_requests where token = p_token;
  if v_count >= v_link.max_submissions then
    raise exception 'submission_cap_reached' using errcode = 'P0001';
  end if;

  if p_people is null or jsonb_array_length(p_people) > 50 then
    raise exception 'invalid_people_payload' using errcode = 'P0001';
  end if;

  insert into access_requests (
    client_id, token, submitted_by_name, submitted_by_email, people
  ) values (
    p_client_id, p_token, p_submitted_by_name, p_submitted_by_email, p_people
  )
  returning * into v_row;

  select name into v_client_name from clients where id = p_client_id;

  insert into staff_reminders (staff_email, text, client_id, priority, due_date)
  select
    sca.staff_email,
    'New access request from ' || p_submitted_by_name || ' at ' ||
      coalesce(v_client_name, p_client_id) || ' — review it under Manage access.',
    p_client_id,
    'high',
    current_date
  from staff_client_access sca
  where sca.client_id = p_client_id;

  return v_row;
end;
$$;

grant execute on function public.submit_access_request(text, text, text, text, jsonb) to anon;
grant execute on function public.submit_access_request(text, text, text, text, jsonb) to authenticated;
