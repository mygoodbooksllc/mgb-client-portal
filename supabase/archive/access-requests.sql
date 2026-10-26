-- Lets a client's admin specify each of their staff's access without a real
-- login of their own (Phase 2's client auth isn't built yet). MyGoodBooks
-- generates a one-off link from Manage Access -> Requests, the client fills
-- out a public, unauthenticated form at that link (app.jsx's
-- AccessRequestForm, mounted directly from the ?access-form=<token> query
-- param, bypassing AuthGate entirely), and the submission lands back in
-- Manage Access -> Requests for a bookkeeper to read and apply by hand.
--
-- Deliberately NOT wired to auto-apply into userAccess: this app's access
-- control is still client.users mock data plus session-local overrides, not
-- a real per-user table, so there's nothing durable yet to write into. Once
-- Phase 2 (real client login) and Phase 3 (client_users driving real access)
-- land, this is the natural intake point to wire straight into that table
-- instead of a bookkeeper re-typing it into Manage Access.
--
-- Builds on staff-schema.sql (for public.is_active_staff(), also defined by
-- client-notes.sql -- either is fine, this just needs the function to
-- exist). Run this once in the Supabase SQL editor.

create or replace function public.is_active_staff()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from staff
    where email = auth.jwt() ->> 'email'
      and active = true
  );
$$;

-- One row per shareable link. client_id matches a client's id in data.js
-- (there's no clients table yet -- see the Phase 3 note above), not a
-- foreign key. `active` lets a bookkeeper kill a link without deleting the
-- history of who generated it and when.
create table if not exists access_request_links (
  token text primary key,
  client_id text not null,
  created_by text,
  created_at timestamptz not null default now(),
  active boolean not null default true,
  -- Security audit finding H3 (rate limiting): per-link submission cap,
  -- enforced atomically inside submit_access_request() below. Defaults to 1
  -- because each link is already generated as a one-off for a single client
  -- contact to fill out once -- distinct from `active`, which a bookkeeper
  -- toggles by hand. It's a column (not hardcoded) so a bookkeeper could
  -- raise it per-link if a legitimate resubmission is ever needed.
  max_submissions integer not null default 1
);

alter table access_request_links
  drop constraint if exists access_request_links_max_submissions_positive;
alter table access_request_links
  add constraint access_request_links_max_submissions_positive check (max_submissions > 0);

-- One row per client submission. `people` is the whole form: a JSON array
-- of { name, email, role, access: "full"|"scoped", tabs, categories } --
-- same shape UserAccessEditor already edits, so a bookkeeper reading a
-- request and a bookkeeper using Manage Access see the same vocabulary.
create table if not exists access_requests (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  token text references access_request_links (token),
  submitted_by_name text not null,
  submitted_by_email text not null,
  submitted_at timestamptz not null default now(),
  people jsonb not null,
  reviewed boolean not null default false
);

alter table access_request_links enable row level security;
alter table access_requests enable row level security;

-- Staff manage links: generate, list, deactivate.
drop policy if exists "staff read links" on access_request_links;
create policy "staff read links"
  on access_request_links for select
  using (public.is_active_staff());

drop policy if exists "staff write links" on access_request_links;
create policy "staff write links"
  on access_request_links for insert
  with check (public.is_active_staff());

drop policy if exists "staff update links" on access_request_links;
create policy "staff update links"
  on access_request_links for update
  using (public.is_active_staff())
  with check (public.is_active_staff());

-- Security audit finding H2 (HIGH): a `using (true)` select policy here let
-- anon dump the WHOLE table over the REST API -- every client id, staff
-- email that generated a link, and live token, not just the one row a
-- public form actually needs. Replaced with a security definer RPC that
-- only ever returns a single client_id for a single valid token, and the
-- blanket select policy is dropped entirely (see below).
drop policy if exists "public read links by token" on access_request_links;

create or replace function public.access_link_client(p_token text)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select client_id from access_request_links where token = p_token and active;
$$;

grant execute on function public.access_link_client(text) to anon;
grant execute on function public.access_link_client(text) to authenticated;

-- Staff read/triage submissions.
drop policy if exists "staff read requests" on access_requests;
create policy "staff read requests"
  on access_requests for select
  using (public.is_active_staff());

drop policy if exists "staff update requests" on access_requests;
create policy "staff update requests"
  on access_requests for update
  using (public.is_active_staff())
  with check (public.is_active_staff());

-- Security audit finding H3 (HIGH, rate limiting): the public form used to
-- insert directly, gated only by a policy checking the token named an
-- active link and that the submitted client_id (client-supplied, spoofable)
-- matched THAT link's client_id -- nothing stopped a script from POSTing in
-- a loop against a leaked/guessed token. Replaced with a security definer
-- RPC (same pattern as access_link_client / qbo_disconnect) that checks the
-- token, checks the client_id, checks the per-link submission cap, and
-- inserts -- all atomically, so there's no TOCTOU race between "check the
-- count" and "insert the row". The old public insert policy is dropped
-- entirely: a script hitting PostgREST's table endpoint directly can no
-- longer bypass the cap the way it could bypass a bare policy. Staff can
-- still write rows directly (e.g. re-filing a request by hand).
drop policy if exists "public submit via active token" on access_requests;

drop policy if exists "staff write requests" on access_requests;
create policy "staff write requests"
  on access_requests for insert
  with check (public.is_active_staff());

-- Security audit finding H3: cheap size guard against an oversized `people`
-- payload, also re-checked inside submit_access_request() since the RPC
-- bypasses RLS via security definer.
alter table access_requests drop constraint if exists access_requests_people_size;
alter table access_requests add constraint access_requests_people_size check (jsonb_array_length(people) <= 50);

-- Sole public submission path. security definer so it bypasses RLS (the
-- insert policy above is staff-only), and does its own token/client_id/cap
-- checks up front so nothing gets inserted for an invalid, mismatched or
-- exhausted link.
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

  return v_row;
end;
$$;

grant execute on function public.submit_access_request(text, text, text, text, jsonb) to anon;
grant execute on function public.submit_access_request(text, text, text, text, jsonb) to authenticated;
