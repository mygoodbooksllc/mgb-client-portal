-- Site forms (2026-11-03): the intake for forms on the public marketing site
-- (mygoodbooks.org; the site repo is ~/Desktop/MGB Website, its
-- build/site_static/js/forms.js posts JSON to the site-forms edge function).
-- First form: the Free Financial Clarity Review (data-site-form
-- "clarity-review"); "contact" is accepted for a later contact form.
-- Docs: docs/site-forms.md. Function: supabase/functions/site-forms/.
--
--   site_form_submissions  one row per accepted submission. Written ONLY by
--                          the site-forms function with the service role
--                          (anonymous visitors never touch the table). Active
--                          admins can read it and change status (new,
--                          contacted, done, spam); nothing else is editable.
--   site_form_recipients   who gets the "new submission" email. Admins only.
--                          Empty or unreadable -> the function falls back to
--                          holden@mygoodbooks.org.
--
-- The function rate limits by ip_hash (sha256 of the caller's IP and the
-- SITE_FORMS_SALT secret; the raw IP is never stored) using this table:
-- 5 per hour and 20 per day.
--
-- Builds on supabase/staff-admin-policies.sql (is_active_staff_admin()).
-- Status: Applied to production 2026-11-03 (migration site_forms_v1). Was run via the
-- Supabase MCP apply_migration. Safe to re-run.

create table if not exists public.site_form_submissions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  form text not null check (length(form) between 1 and 64),
  page text,
  fields jsonb not null check (jsonb_typeof(fields) = 'object'),
  name text,
  email text,
  status text not null default 'new' check (status in ('new', 'contacted', 'done', 'spam')),
  email_sent boolean not null default false,
  email_error text,
  ip_hash text,
  user_agent text
);

create index if not exists site_form_submissions_created_at_idx
  on public.site_form_submissions (created_at desc);
-- Rate limit lookups: recent rows for one caller.
create index if not exists site_form_submissions_ip_created_idx
  on public.site_form_submissions (ip_hash, created_at);

create table if not exists public.site_form_recipients (
  email text primary key check (email = lower(email) and email like '%_@_%'),
  active boolean not null default true,
  note text
);

alter table public.site_form_submissions enable row level security;
alter table public.site_form_recipients enable row level security;

-- No anon or authenticated insert policy on either table, on purpose: the
-- service role (the function) bypasses RLS and is the only writer of
-- submissions.
drop policy if exists "admins read site form submissions" on public.site_form_submissions;
create policy "admins read site form submissions"
  on public.site_form_submissions for select to authenticated
  using (public.is_active_staff_admin());

drop policy if exists "admins update site form submissions" on public.site_form_submissions;
create policy "admins update site form submissions"
  on public.site_form_submissions for update to authenticated
  using (public.is_active_staff_admin())
  with check (public.is_active_staff_admin());

drop policy if exists "admins manage site form recipients" on public.site_form_recipients;
create policy "admins manage site form recipients"
  on public.site_form_recipients for all to authenticated
  using (public.is_active_staff_admin())
  with check (public.is_active_staff_admin());

-- Table grants. Supabase's default privileges give anon and authenticated
-- everything on new public tables; take that back and grant only what the
-- admin policies need. Admins may change a submission's status only (a
-- column grant), so what the visitor sent stays as sent.
revoke all on public.site_form_submissions from anon, authenticated;
revoke all on public.site_form_recipients from anon, authenticated;
grant select on public.site_form_submissions to authenticated;
grant update (status) on public.site_form_submissions to authenticated;
grant select, insert, update, delete on public.site_form_recipients to authenticated;
grant all on public.site_form_submissions to service_role;
grant all on public.site_form_recipients to service_role;

insert into public.site_form_recipients (email, active, note) values
  ('holden@mygoodbooks.org', true, 'Holden main inbox, primary'),
  ('admin@mygoodbooks.org', true, 'shared admin address')
on conflict (email) do nothing;
