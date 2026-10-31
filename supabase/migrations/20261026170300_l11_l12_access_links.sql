-- Security audit findings L11 and L12, plus the note about the public
-- access-request form.
--
-- L11. Access-request links never expired. They now expire 30 days after
-- creation (links live today get 30 days from now), and the browser can't
-- extend that.
-- L12. The browser chose the link token. A trigger now fills it when none is
-- sent (the app's next version sends none) and refuses short ones; after
-- creation only `active` can change. created_by is already stamped by the
-- existing stamp_author trigger.
-- Note: the form looked the org name up in CLIENTS, which anonymous visitors
-- can't read. access_link_info() returns the id and name for a live token.

alter table public.access_request_links
  add column if not exists expires_at timestamptz;
update public.access_request_links
   set expires_at = greatest(created_at, now()) + interval '30 days'
 where expires_at is null;
alter table public.access_request_links
  alter column expires_at set default now() + interval '30 days',
  alter column expires_at set not null;

create or replace function public.access_request_links_before_write()
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
    elsif length(new.token) < 32 then
      raise exception 'access_request_links: token too short' using errcode = '22023';
    end if;
    new.created_at := now();
    new.expires_at := now() + interval '30 days';
  else
    -- Staff can turn a link off (or back on); nothing else changes.
    new.token := old.token;
    new.client_id := old.client_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.expires_at := old.expires_at;
    new.max_submissions := old.max_submissions;
  end if;
  return new;
end;
$$;

create or replace trigger access_request_links_before_write
  before insert or update on public.access_request_links
  for each row execute function public.access_request_links_before_write();

create or replace function public.access_link_client(p_token text)
returns text
language sql
stable security definer
set search_path = public
as $$
  select client_id from access_request_links
   where token = p_token and active and expires_at > now();
$$;

create or replace function public.access_link_info(p_token text)
returns table(client_id text, client_name text)
language sql
stable security definer
set search_path = public
as $$
  select l.client_id, c.name
    from access_request_links l
    join clients c on c.id = l.client_id
   where l.token = p_token and length(p_token) >= 32
     and l.active and l.expires_at > now()
     and not c.is_internal;
$$;
grant execute on function public.access_link_info(text) to anon, authenticated;

CREATE OR REPLACE FUNCTION public.submit_access_request(p_token text, p_client_id text, p_submitted_by_name text, p_submitted_by_email text, p_people jsonb)
 RETURNS access_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_link access_request_links;
  v_count integer;
  v_row access_requests;
  v_client_name text;
begin
  select * into v_link from access_request_links where token = p_token for update;

  if v_link is null or not v_link.active or v_link.expires_at <= now() then
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
$function$;
