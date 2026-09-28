-- Pro budget and report tools (owner request 2026-09-27).
--
-- Budget: next year's draft with an approval flow, line comments, version
-- history, monthly (seasonal) amounts and ministry owners per line; variance
-- notes shared with the client. Reports: saved packet templates, read-only
-- share links, church branding on PDFs, the functional-expense mapping for
-- the Statement of Functional Expenses, and the edited "what happened this
-- month" summary.
--
-- Clients (active client_users of the org) can read and write these, as can
-- staff who can access the client. Plan gating (Pro only) is in the app.
-- Builds on staff-schema.sql, audit-hardening-client-scoping.sql and
-- client-users.sql. Safe to re-run. Applied to production 2026-09-27.

begin;

-- One helper instead of an existence subquery in every policy (see README:
-- a subquery inside a policy is itself filtered by RLS).
create or replace function public.is_client_member(p_client_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from client_users cu
    where cu.email = auth.jwt() ->> 'email'
      and cu.client_id = p_client_id
      and cu.active
  );
$$;
revoke all on function public.is_client_member(text) from public, anon;
grant execute on function public.is_client_member(text) to authenticated;

create or replace function public.can_use_client_tools(p_client_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (public.is_active_staff() and public.can_access_client(p_client_id))
      or public.is_client_member(p_client_id);
$$;
revoke all on function public.can_use_client_tools(text) from public, anon;
grant execute on function public.can_use_client_tools(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Budget drafts, history and comments
-- ---------------------------------------------------------------------------
-- lines: [{ "category": text, "proposed": number (annual),
--           "months": [12 numbers] | null (null = spread evenly),
--           "owner_email": text | null }]
create table if not exists public.client_budget_drafts (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  fiscal_year int not null check (fiscal_year between 2000 and 2100),
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'changes_requested', 'approved')),
  lines jsonb not null default '[]'::jsonb,
  version int not null default 1,
  submitted_by text,
  submitted_at timestamptz,
  decided_by text,
  decided_at timestamptz,
  updated_by text,
  updated_at timestamptz not null default now(),
  unique (client_id, fiscal_year)
);
alter table public.client_budget_drafts enable row level security;
revoke all on public.client_budget_drafts from anon;
drop policy if exists "client tools budget drafts" on public.client_budget_drafts;
create policy "client tools budget drafts" on public.client_budget_drafts
  for all using (public.can_use_client_tools(client_id))
  with check (public.can_use_client_tools(client_id));

create table if not exists public.client_budget_draft_history (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  fiscal_year int not null,
  version int not null,
  status text not null,
  lines jsonb not null,
  note text check (note is null or length(note) <= 1000),
  changed_by text,
  changed_by_name text,
  changed_at timestamptz not null default now()
);
create index if not exists client_budget_draft_history_idx
  on public.client_budget_draft_history (client_id, fiscal_year, changed_at desc);
alter table public.client_budget_draft_history enable row level security;
revoke all on public.client_budget_draft_history from anon;
revoke update, delete on public.client_budget_draft_history from authenticated;
drop policy if exists "client tools budget history read" on public.client_budget_draft_history;
create policy "client tools budget history read" on public.client_budget_draft_history
  for select using (public.can_use_client_tools(client_id));
drop policy if exists "client tools budget history write" on public.client_budget_draft_history;
create policy "client tools budget history write" on public.client_budget_draft_history
  for insert with check (public.can_use_client_tools(client_id));

create table if not exists public.client_budget_comments (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  fiscal_year int not null,
  category text,                          -- null = about the whole budget
  body text not null check (length(body) between 1 and 2000),
  author_email text,
  author_name text,
  created_at timestamptz not null default now()
);
create index if not exists client_budget_comments_idx
  on public.client_budget_comments (client_id, fiscal_year, created_at);
alter table public.client_budget_comments enable row level security;
revoke all on public.client_budget_comments from anon;
drop policy if exists "client tools budget comments" on public.client_budget_comments;
create policy "client tools budget comments" on public.client_budget_comments
  for all using (public.can_use_client_tools(client_id))
  with check (public.can_use_client_tools(client_id));

-- ---------------------------------------------------------------------------
-- Variance notes (shared with the client, carried into reports)
-- ---------------------------------------------------------------------------
create table if not exists public.client_variance_notes (
  client_id text not null,
  period text not null check (period ~ '^[0-9]{4}-[0-9]{2}$'),
  category text not null check (length(category) between 1 and 200),
  note text not null check (length(note) between 1 and 1000),
  author_email text,
  author_name text,
  updated_at timestamptz not null default now(),
  primary key (client_id, period, category)
);
alter table public.client_variance_notes enable row level security;
revoke all on public.client_variance_notes from anon;
drop policy if exists "client tools variance notes" on public.client_variance_notes;
create policy "client tools variance notes" on public.client_variance_notes
  for all using (public.can_use_client_tools(client_id))
  with check (public.can_use_client_tools(client_id));

-- ---------------------------------------------------------------------------
-- Reports: templates, branding, functional map, monthly summary
-- ---------------------------------------------------------------------------
create table if not exists public.client_report_templates (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  name text not null check (length(name) between 1 and 120),
  config jsonb not null default '{}'::jsonb,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists client_report_templates_idx
  on public.client_report_templates (client_id, name);
alter table public.client_report_templates enable row level security;
revoke all on public.client_report_templates from anon;
drop policy if exists "client tools report templates" on public.client_report_templates;
create policy "client tools report templates" on public.client_report_templates
  for all using (public.can_use_client_tools(client_id))
  with check (public.can_use_client_tools(client_id));

create table if not exists public.client_branding (
  client_id text primary key,
  logo_data_url text check (logo_data_url is null or
    (length(logo_data_url) <= 400000 and logo_data_url ~ '^data:image/(png|jpeg);base64,')),
  brand_color text check (brand_color is null or brand_color ~ '^#[0-9a-fA-F]{6}$'),
  updated_by text,
  updated_at timestamptz not null default now()
);
alter table public.client_branding enable row level security;
revoke all on public.client_branding from anon;
drop policy if exists "client tools branding" on public.client_branding;
create policy "client tools branding" on public.client_branding
  for all using (public.can_use_client_tools(client_id))
  with check (public.can_use_client_tools(client_id));

create table if not exists public.client_functional_map (
  client_id text not null,
  category text not null check (length(category) between 1 and 200),
  function text not null check (function in ('program', 'management', 'fundraising')),
  primary key (client_id, category)
);
alter table public.client_functional_map enable row level security;
revoke all on public.client_functional_map from anon;
drop policy if exists "client tools functional map" on public.client_functional_map;
create policy "client tools functional map" on public.client_functional_map
  for all using (public.can_use_client_tools(client_id))
  with check (public.can_use_client_tools(client_id));

create table if not exists public.client_report_summaries (
  client_id text not null,
  period text not null check (period ~ '^[0-9]{4}-[0-9]{2}$'),
  summary text not null check (length(summary) <= 6000),
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (client_id, period)
);
alter table public.client_report_summaries enable row level security;
revoke all on public.client_report_summaries from anon;
drop policy if exists "client tools report summaries" on public.client_report_summaries;
create policy "client tools report summaries" on public.client_report_summaries
  for all using (public.can_use_client_tools(client_id))
  with check (public.can_use_client_tools(client_id));

-- ---------------------------------------------------------------------------
-- Read-only share links
-- ---------------------------------------------------------------------------
-- snapshot is structured JSON (never HTML); the share page renders it with
-- React, so nothing in it can run as script.
create table if not exists public.client_report_shares (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  token text not null unique check (length(token) >= 32),
  title text not null check (length(title) between 1 and 200),
  snapshot jsonb not null,
  created_by text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index if not exists client_report_shares_client_idx
  on public.client_report_shares (client_id, created_at desc);
alter table public.client_report_shares enable row level security;
revoke all on public.client_report_shares from anon;
drop policy if exists "client tools report shares" on public.client_report_shares;
create policy "client tools report shares" on public.client_report_shares
  for all using (public.can_use_client_tools(client_id))
  with check (public.can_use_client_tools(client_id)
              and expires_at <= now() + interval '90 days');

-- The only thing a signed-out visitor can do: open one live share by token.
create or replace function public.get_report_share(p_token text)
returns table (title text, snapshot jsonb, client_name text, created_at timestamptz, expires_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select s.title, s.snapshot, c.name, s.created_at, s.expires_at
  from client_report_shares s
  join clients c on c.id = s.client_id
  where s.token = p_token
    and length(p_token) >= 32
    and s.revoked_at is null
    and s.expires_at > now();
$$;
revoke all on function public.get_report_share(text) from public;
grant execute on function public.get_report_share(text) to anon, authenticated;

commit;
