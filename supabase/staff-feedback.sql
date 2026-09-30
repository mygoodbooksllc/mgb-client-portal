-- Staff bug reports and feedback (owner request 2026-09-30).
-- Applied to production 2026-09-30.
--
-- Staff send a bug report / idea / question from the top bar's Help (?) menu
-- ("Report a bug / feedback") or the bottom of the Help page
-- (components/staff/Feedback.jsx). Admins triage it on the Feedback page
-- (#/feedback): status new -> planned / done / wont_do, plus an admin note
-- the sender can read under "My feedback".
--
-- Not the same thing as feature_feedback (feature-feedback.sql), which is the
-- periodic rating survey shown to staff and clients.
--
-- Who can do what
--   * active staff: insert (author_email stamped from the JWT, status forced
--     to 'new', admin_note cleared) and read their own rows
--   * active admins: read every row; update status and admin_note only
--   * nobody deletes from the app (no delete policy, delete revoked)
--
-- The trigger does the stamping and column locking, so a staffer can't file a
-- report under a colleague's name or pre-mark it "done", and an admin update
-- can't rewrite what the sender said.

create table if not exists public.staff_feedback (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  author_email text not null default (auth.jwt() ->> 'email'),
  kind text not null default 'bug' check (kind in ('bug', 'idea', 'question', 'other')),
  message text not null check (char_length(btrim(message)) between 1 and 5000),
  -- Bugs only, optional: "What did you expect to happen?"
  expected text check (expected is null or char_length(expected) <= 5000),
  -- Hash route when it was sent, e.g. #/client/abc/reports
  page text check (page is null or char_length(page) <= 300),
  -- Browser user agent + screen size, captured automatically for bugs
  browser text check (browser is null or char_length(browser) <= 300),
  client_id text,
  status text not null default 'new' check (status in ('new', 'planned', 'done', 'wont_do')),
  admin_note text check (admin_note is null or char_length(admin_note) <= 5000)
);

create index if not exists staff_feedback_created_at_idx on public.staff_feedback (created_at desc);
create index if not exists staff_feedback_author_idx on public.staff_feedback (author_email, created_at desc);
create index if not exists staff_feedback_new_idx on public.staff_feedback (status) where status = 'new';

create or replace function public.staff_feedback_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.author_email := auth.jwt() ->> 'email';
    new.status := 'new';
    new.admin_note := null;
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;
  -- UPDATE: only status and admin_note may change.
  new.id := old.id;
  new.created_at := old.created_at;
  new.author_email := old.author_email;
  new.kind := old.kind;
  new.message := old.message;
  new.expected := old.expected;
  new.page := old.page;
  new.browser := old.browser;
  new.client_id := old.client_id;
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function public.staff_feedback_guard() from public, anon, authenticated;

drop trigger if exists staff_feedback_guard on public.staff_feedback;
create trigger staff_feedback_guard
  before insert or update on public.staff_feedback
  for each row execute function public.staff_feedback_guard();

alter table public.staff_feedback enable row level security;

drop policy if exists "staff insert own feedback" on public.staff_feedback;
create policy "staff insert own feedback"
  on public.staff_feedback for insert to authenticated
  with check (
    public.is_active_staff()
    and author_email = (auth.jwt() ->> 'email')
    and status = 'new'
  );

drop policy if exists "staff read own feedback" on public.staff_feedback;
create policy "staff read own feedback"
  on public.staff_feedback for select to authenticated
  using (public.is_active_staff() and author_email = (auth.jwt() ->> 'email'));

drop policy if exists "admins read all feedback" on public.staff_feedback;
create policy "admins read all feedback"
  on public.staff_feedback for select to authenticated
  using (public.is_active_staff_admin());

drop policy if exists "admins update feedback" on public.staff_feedback;
create policy "admins update feedback"
  on public.staff_feedback for update to authenticated
  using (public.is_active_staff_admin())
  with check (public.is_active_staff_admin());

revoke all on public.staff_feedback from anon;
revoke delete, truncate on public.staff_feedback from authenticated;
grant select, insert, update on public.staff_feedback to authenticated;
