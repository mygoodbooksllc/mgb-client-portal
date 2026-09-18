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
  active boolean not null default true
);

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

-- The public form submits here with no session. Restricted to inserting
-- against a token that actually names an active link, so a stale or
-- deactivated link can't still be used to write rows.
--
-- Security audit finding H3 (HIGH): this used to check only that the token
-- named an active link, never that the submitted client_id (client-supplied,
-- spoofable) actually matched THAT link's client_id -- so an attacker with
-- one valid token could post a fake "grant me access" request that showed up
-- under any client. Added `l.client_id = access_requests.client_id`.
drop policy if exists "public submit via active token" on access_requests;
create policy "public submit via active token"
  on access_requests for insert
  with check (
    exists (
      select 1 from access_request_links l
      where l.token = access_requests.token
        and l.active
        and l.client_id = access_requests.client_id
    )
  );

-- Security audit finding H3: cheap size guard against an oversized `people`
-- payload.
alter table access_requests drop constraint if exists access_requests_people_size;
alter table access_requests add constraint access_requests_people_size check (jsonb_array_length(people) <= 50);
