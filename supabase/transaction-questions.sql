-- Applied to production 2026-09-30 as migration transaction_questions.
--
-- "Ask about a transaction" (owner-approved 2026-09-30). On the Bank Accounts
-- page a signed-in client picks or types what a QuickBooks transaction was
-- for, with an optional note. Staff who can access the client see the open
-- questions (Inbox context pane, client overview, a badge on the row),
-- recategorize the transaction in QuickBooks themselves, and mark the
-- question resolved here. Strictly read-only to QuickBooks: nothing in this
-- file or the app writes anything back to Intuit.
--
-- Notifications reuse client messaging (client-messages.sql) rather than a
-- new outbox kind: asking posts a client message in the asker's own thread,
-- so the existing notify_enqueue_message trigger queues the usual
-- staff_client_message email (notification-emails.sql) and the staff bell /
-- Inbox show "Message waiting". Resolving posts a staff reply in that thread,
-- which queues the usual client_message email to the asker.
--
-- txn_key is "<txn_type>:<qbo_id>" (qbo_transactions' key minus client_id).
-- The date, amount, description and account are snapshotted so the question
-- still reads correctly after a re-sync changes or drops the row.
--
-- Needs staff-schema.sql, audit-hardening-client-scoping.sql /
-- temp-client-access.sql (can_access_client), pro-budget-reports.sql
-- (is_client_member), client-messages.sql and notification-emails.sql.
-- Safe to re-run.

begin;

create table if not exists public.transaction_questions (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  txn_key text not null check (length(txn_key) between 1 and 200),
  txn_date date,
  txn_amount numeric,
  txn_description text check (txn_description is null or length(txn_description) <= 500),
  txn_account text check (txn_account is null or length(txn_account) <= 200),
  suggested_category text check (suggested_category is null or length(suggested_category) <= 200),
  note text check (note is null or length(note) <= 2000),
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_by text not null,
  created_at timestamptz not null default now(),
  resolved_by text,
  resolved_at timestamptz,
  resolution_note text check (resolution_note is null or length(resolution_note) <= 2000),
  updated_at timestamptz not null default now(),
  check (suggested_category is not null or note is not null)
);
-- One open question per transaction.
create unique index if not exists transaction_questions_one_open
  on public.transaction_questions (client_id, txn_key) where status = 'open';
create index if not exists transaction_questions_client_idx
  on public.transaction_questions (client_id, status, created_at desc);

alter table public.transaction_questions enable row level security;
revoke all on public.transaction_questions from anon, authenticated;
grant select, insert on public.transaction_questions to authenticated;
grant update (status, resolution_note) on public.transaction_questions to authenticated;

drop policy if exists "read transaction questions" on public.transaction_questions;
create policy "read transaction questions" on public.transaction_questions
  for select using (
    (public.is_active_staff() and public.can_access_client(client_id))
    or public.is_client_member(client_id)
  );

drop policy if exists "client asks about a transaction" on public.transaction_questions;
create policy "client asks about a transaction" on public.transaction_questions
  for insert with check (public.is_client_member(client_id) and status = 'open');

drop policy if exists "staff resolve transaction questions" on public.transaction_questions;
create policy "staff resolve transaction questions" on public.transaction_questions
  for update using (public.is_active_staff() and public.can_access_client(client_id))
  with check (public.is_active_staff() and public.can_access_client(client_id));
-- No delete policy: nobody deletes.

-- Stamping and guards. created_by / resolved_by always come from the JWT.
create or replace function public.transaction_questions_stamp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(nullif(auth.jwt() ->> 'email', ''));
begin
  if tg_op = 'INSERT' then
    if v_email is null then
      raise exception 'transaction_questions: sign in to ask a question';
    end if;
    new.created_by := v_email;
    new.created_at := now();
    new.updated_at := now();
    new.status := 'open';
    new.resolved_by := null;
    new.resolved_at := null;
    new.resolution_note := null;
    new.suggested_category := nullif(btrim(new.suggested_category), '');
    new.note := nullif(btrim(new.note), '');
    return new;
  end if;
  -- UPDATE: only open -> resolved, with an optional resolution note.
  if old.status <> 'open' or new.status <> 'resolved' then
    raise exception 'transaction_questions: only an open question can be resolved';
  end if;
  if v_email is null then
    raise exception 'transaction_questions: sign in to resolve';
  end if;
  new.resolved_by := v_email;
  new.resolved_at := now();
  new.updated_at := now();
  new.resolution_note := nullif(btrim(new.resolution_note), '');
  return new;
end;
$$;
revoke execute on function public.transaction_questions_stamp() from public, anon, authenticated;
drop trigger if exists transaction_questions_stamp on public.transaction_questions;
create trigger transaction_questions_stamp
  before insert or update on public.transaction_questions
  for each row execute function public.transaction_questions_stamp();

-- "Sep 12, 2026 · Home Depot · -$45.00"
create or replace function public.transaction_question_label(q public.transaction_questions)
returns text
language sql
stable
set search_path = public
as $$
  select concat_ws(' · ',
    to_char(q.txn_date, 'Mon FMDD, YYYY'),
    nullif(left(q.txn_description, 120), ''),
    case when q.txn_amount is null then null
         else (case when q.txn_amount < 0 then '-' else '' end)
              || '$' || to_char(abs(q.txn_amount), 'FM999,999,999,990.00') end
  );
$$;
revoke execute on function public.transaction_question_label(public.transaction_questions) from public, anon;
grant execute on function public.transaction_question_label(public.transaction_questions) to authenticated;

-- Notifications through the client's message thread.
create or replace function public.transaction_questions_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_label text := public.transaction_question_label(new);
  v_name text;
  v_body text;
begin
  if tg_op = 'INSERT' then
    select cu.name into v_name from client_users cu
      where lower(cu.email) = new.created_by and cu.client_id = new.client_id
      limit 1;
    v_body := 'Question about a transaction: ' || coalesce(nullif(v_label, ''), new.txn_key)
      || coalesce(' (' || new.txn_account || ')', '') || '.'
      || coalesce(E'\nI think this was: ' || new.suggested_category, '')
      || coalesce(E'\nNote: ' || new.note, '');
    insert into client_messages (client_id, participant_email, author_email, author_name, author_kind, body)
    values (new.client_id, new.created_by, new.created_by, left(coalesce(v_name, new.created_by), 120),
            'client', left(v_body, 8000));
  elsif new.status = 'resolved' and old.status = 'open' then
    select s.name into v_name from staff s where lower(s.email) = new.resolved_by limit 1;
    v_body := 'Resolved your question about ' || coalesce(nullif(v_label, ''), 'a transaction') || '.'
      || coalesce(E'\n' || new.resolution_note, '')
      || E'\nAny change made in QuickBooks shows here after the next sync.';
    insert into client_messages (client_id, participant_email, author_email, author_name, author_kind, body)
    values (new.client_id, new.created_by, new.resolved_by, left(coalesce(v_name, 'Your bookkeeper'), 120),
            'staff', left(v_body, 8000));
  end if;
  return null;
end;
$$;
revoke execute on function public.transaction_questions_notify() from public, anon, authenticated;
drop trigger if exists transaction_questions_notify on public.transaction_questions;
create trigger transaction_questions_notify
  after insert or update of status on public.transaction_questions
  for each row execute function public.transaction_questions_notify();

commit;
