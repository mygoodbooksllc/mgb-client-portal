-- Audit hardening, batch 2c: bind writes to the actual caller.
-- APPLIED LIVE via Supabase MCP apply_migration
-- (`bind_telemetry_and_upgrade_requests_to_caller`,
--  `bound_access_request_free_text`).

-- (1) Telemetry was attributable to anyone.
--
-- Both policies were `with check (auth.role() = 'authenticated')`, despite one
-- of them being named "signed-in users can log their own usage". actor_email,
-- actor_role and client_id were all sent from the browser and never compared
-- to the session, so ANY signed-in user — including a client-tier user, the
-- lowest-privilege principal in the system — could write unlimited rows
-- attributed to any email, any role and any client.
--
-- That poisons the admin-only Usage Stats page, forges the record of who
-- viewed which client's pages, and injects attacker-authored text into an
-- admin's screen (friction_text / comments) under a spoofed staff identity.
-- React escapes it, so this is log forgery and content injection, not XSS.
--
-- Verified before applying: both call sites in app.jsx already send the
-- signed-in user's own address (clientPortalUser.email, else staffUser.email),
-- so binding to the JWT required no application change.
drop policy if exists "signed-in users can log their own usage" on usage_events;
create policy "signed-in users can log their own usage" on usage_events
  for insert with check (actor_email = auth.jwt() ->> 'email');

drop policy if exists "signed-in users can submit feedback" on feature_feedback;
create policy "signed-in users can submit feedback" on feature_feedback
  for insert with check (actor_email = auth.jwt() ->> 'email');

-- (2) request_enterprise_upgrade() was callable by `anon` and never checked
-- that the caller had any relationship to p_client_id — so anyone on the
-- internet could file up to 5 open requests per org, each carrying 200
-- characters of attacker-chosen text that renders on Bookkeeper Home.
--
-- p_requested_by stays a display label rather than being replaced by the JWT
-- email: the app deliberately passes a human name, and "Someone at <org>" when
-- a staffer is previewing, and that is what staff read on their home page. The
-- authorization is what changes — the caller must now be staff who can access
-- this client, or an active client_users member of this very org.
create or replace function public.request_enterprise_upgrade(p_client_id text, p_requested_by text)
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

  if auth.jwt() ->> 'email' is null then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;

  if not (
    public.can_access_client(p_client_id)
    or exists (
      select 1 from client_users cu
      where cu.email = auth.jwt() ->> 'email'
        and cu.client_id = p_client_id
        and cu.active
    )
  ) then
    raise exception 'not_authorized' using errcode = 'P0001';
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

revoke all on function public.request_enterprise_upgrade(text, text) from public, anon;
grant execute on function public.request_enterprise_upgrade(text, text) to authenticated;

-- (3) submit_access_request() is anon-callable by design — someone following
-- an emailed link has no session yet — and it validates the link token, the
-- client_id match and the submission cap correctly. But p_submitted_by_name
-- and p_submitted_by_email were never length-checked, and the
-- notify-bookkeeper step concatenates the name straight into a staff_reminders
-- row. Because the function is SECURITY DEFINER it bypasses staff_reminders'
-- otherwise airtight self-only policy, so an anonymous caller holding a valid
-- token could inject unbounded attacker-chosen text into the private task list
-- of every staffer assigned to that client.
--
-- request_enterprise_upgrade already bounds its equivalent field at 200; this
-- matches that precedent rather than inventing a new limit. Everything else in
-- the function body is unchanged.
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

  if p_submitted_by_name is not null and length(p_submitted_by_name) > 200 then
    raise exception 'submitted_by_name_too_long' using errcode = 'P0001';
  end if;

  if p_submitted_by_email is not null and length(p_submitted_by_email) > 200 then
    raise exception 'submitted_by_email_too_long' using errcode = 'P0001';
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
