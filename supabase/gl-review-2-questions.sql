-- Ledger review (GL Review), part 2: "Ask client" on transaction_questions.
-- Spec: docs/gl-review-spec.md section 5 (and 4.1 ask/answer, 13.2).
-- NOT APPLIED. Written 2026-10-14 for Phase 1. Put the applied date here when
-- it goes to production (migration name gl_review_2_questions).
-- Needs gl-review-1-core.sql first (gl_review_flags, gl_review_require_staff).
--
-- Today transaction_questions only represents a CLIENT asking STAFF
-- (transaction-questions.sql, applied 2026-09-30). Ask client is the opposite
-- direction, so this file changes the live table's security, not just adds to it:
--   * new columns direction / asked_of_email / asked_via / answer /
--     answered_by / answered_at / flag_id; status gains 'answered'
--   * the suggested_category-or-note check now depends on direction
--     (staff_asked needs the question in `note`, an addressee and a channel)
--   * SELECT policy replaced: a client user now sees only client_asked rows
--     THEY created and staff_asked portal rows addressed to THEM while open or
--     answered (a resolved staff question carries a staff-only
--     resolution_note) (was: every row of their client). Staff are unchanged.
--   * transaction_questions_one_open widened to status in ('open', 'answered')
--   * gl_review_ask (portal) refuses scoped / limited portal users
--   * client INSERT policy also requires direction = 'client_asked'
--   * new client UPDATE policy: the addressee answers a portal question once
--   * column grant adds `answer`
--   * stamp trigger: direction comes from the caller (never the row), every
--     identity column is pinned on update, and the transition table below
--   * notify trigger routes by direction and asked_via
--   * RPCs gl_review_ask (the only way staff create a question) and
--     gl_review_answer ("Got an answer", email path)
--
-- Transitions (spec 5), enforced in transaction_questions_stamp():
--   staff        client_asked              open -> resolved (unchanged)
--   addressee    staff_asked, portal       open -> answered, writes answer once
--   staff        staff_asked, email        open -> answered, writes answer
--   staff        staff_asked               answered -> resolved,
--                                          or open -> resolved with a note
-- Anything else raises. The only update allowed with no signed-in caller is
-- flag_id going to null on its own (the ON DELETE SET NULL from gl_review_flags).
--
-- Notifications (transaction_questions_notify):
--   client_asked: exactly as before (client message on ask, staff reply on resolve).
--   staff_asked + portal: on ask, a staff message in the addressee's thread
--     (queues the usual client_message email); on answer, a client message
--     with the answer in that same thread (staff see "Message waiting").
--     Resolving posts nothing.
--   staff_asked + email: posts nothing; gl-review-send emails the question.
--
-- App code that must change in the same release (spec 5): TxnQuestions.jsx and
-- TQ_api.resolve (accept 'answered'), BankAccounts.jsx, the Inbox context
-- pane, the client overview badge, ClientTabCounts and "What we need from
-- you" must filter or label by direction.
--
-- Safe to re-run.
--
-- Rollback (after rolling back gl-review-3-close.sql; inside one transaction):
--   drop function if exists public.gl_review_ask(uuid, text, text, text), public.gl_review_answer(uuid, text);
--   drop policy if exists "client answers a question" on public.transaction_questions;
--   -- staff_asked rows can't survive the old checks:
--   delete from public.transaction_questions where direction = 'staff_asked';
--   update public.transaction_questions set status = 'open' where status = 'answered';  -- none expected
--   drop index if exists public.transaction_questions_one_open;
--   create unique index transaction_questions_one_open
--     on public.transaction_questions (client_id, txn_key) where status = 'open';
--   alter table public.transaction_questions drop constraint if exists transaction_questions_status_check,
--     drop constraint if exists transaction_questions_direction_shape,
--     drop constraint if exists transaction_questions_answered_shape;
--   alter table public.transaction_questions drop column if exists flag_id, drop column if exists answered_at,
--     drop column if exists answered_by, drop column if exists answer, drop column if exists asked_via,
--     drop column if exists asked_of_email, drop column if exists direction;
--   alter table public.transaction_questions add constraint transaction_questions_status_check
--     check (status in ('open', 'resolved'));
--   alter table public.transaction_questions add constraint transaction_questions_check
--     check (suggested_category is not null or note is not null);
--   revoke update on public.transaction_questions from authenticated;
--   -- then re-run transaction-questions.sql (restores the grant, policies, stamp and notify).
--
-- Depends on (repo definitions re-read 2026-10-14): transaction-questions.sql,
-- client-messages.sql + client-messages-author-stamp.sql (author_name is
-- stamped from the directory on insert), pro-budget-reports.sql
-- (is_client_member), temp-client-access.sql (can_access_client),
-- staff-client-tools.sql (client_profile; contact_email from part 1).

begin;

-- ===========================================================================
-- 1. Columns
-- ===========================================================================
alter table public.transaction_questions
  add column if not exists direction text not null default 'client_asked',
  add column if not exists asked_of_email text,
  add column if not exists asked_via text,
  add column if not exists answer text,
  add column if not exists answered_by text,
  add column if not exists answered_at timestamptz,
  add column if not exists flag_id uuid references public.gl_review_flags(id) on delete set null;

create index if not exists transaction_questions_flag_idx
  on public.transaction_questions (flag_id) where flag_id is not null;
create index if not exists transaction_questions_asked_of_idx
  on public.transaction_questions (client_id, asked_of_email) where direction = 'staff_asked';

-- ===========================================================================
-- 2. Checks
-- ===========================================================================
-- The live table has two auto-named checks to replace: the inline status
-- check (transaction_questions_status_check) and the table check
-- `suggested_category is not null or note is not null`
-- (transaction_questions_check). Drop them by definition, not by guessed name.
do $$
declare c record;
begin
  for c in
    select con.conname
      from pg_constraint con
     where con.conrelid = 'public.transaction_questions'::regclass
       and con.contype = 'c'
       and (
            (pg_get_constraintdef(con.oid) ilike '%status%' and pg_get_constraintdef(con.oid) ilike '%resolved%'
               and pg_get_constraintdef(con.oid) not ilike '%answered%')
         or (pg_get_constraintdef(con.oid) ilike '%suggested_category IS NOT NULL%'
               and pg_get_constraintdef(con.oid) ilike '%note IS NOT NULL%'
               and pg_get_constraintdef(con.oid) not ilike '%direction%')
       )
  loop
    execute format('alter table public.transaction_questions drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.transaction_questions drop constraint if exists transaction_questions_status_check;
alter table public.transaction_questions add constraint transaction_questions_status_check
  check (status in ('open', 'answered', 'resolved'));

alter table public.transaction_questions drop constraint if exists transaction_questions_direction_check;
alter table public.transaction_questions add constraint transaction_questions_direction_check
  check (direction in ('client_asked', 'staff_asked'));

alter table public.transaction_questions drop constraint if exists transaction_questions_asked_via_check;
alter table public.transaction_questions add constraint transaction_questions_asked_via_check
  check (asked_via is null or asked_via in ('portal', 'email'));

alter table public.transaction_questions drop constraint if exists transaction_questions_asked_of_email_check;
alter table public.transaction_questions add constraint transaction_questions_asked_of_email_check
  check (asked_of_email is null or (asked_of_email = lower(asked_of_email) and length(asked_of_email) <= 254));

alter table public.transaction_questions drop constraint if exists transaction_questions_answer_check;
alter table public.transaction_questions add constraint transaction_questions_answer_check
  check (answer is null or length(answer) between 1 and 2000);

-- client_asked: what the client thinks it was, or a note (as before).
-- staff_asked: the question (in note), who it's for and how it was sent.
alter table public.transaction_questions drop constraint if exists transaction_questions_direction_shape;
alter table public.transaction_questions add constraint transaction_questions_direction_shape check (
     (direction = 'client_asked' and (suggested_category is not null or note is not null))
  or (direction = 'staff_asked' and note is not null and asked_of_email is not null and asked_via is not null)
);

-- Only a staff question can be 'answered', and then it has an answer.
alter table public.transaction_questions drop constraint if exists transaction_questions_answered_shape;
alter table public.transaction_questions add constraint transaction_questions_answered_shape check (
  status <> 'answered' or (direction = 'staff_asked' and answer is not null and answered_at is not null)
);

-- "One unresolved question per transaction" (spec 5): the live
-- transaction_questions_one_open index (transaction-questions.sql) covers only
-- status = 'open', so an answered-but-not-resolved staff question would let a
-- second question on the same transaction in. Widen it to open + answered.
-- Any two unresolved questions on one transaction collide, whichever way they
-- were asked (staff-asked vs client-asked included); gl_review_ask reports it
-- and the UI shows the existing one. Drop/create only when the live
-- definition is the old one, so a re-run is a no-op. On the first apply no
-- row is 'answered' yet, so the new index can't fail on existing data.
do $$
begin
  if exists (select 1 from pg_indexes
              where schemaname = 'public' and tablename = 'transaction_questions'
                and indexname = 'transaction_questions_one_open'
                and indexdef not ilike '%answered%') then
    drop index public.transaction_questions_one_open;
  end if;
end $$;
create unique index if not exists transaction_questions_one_open
  on public.transaction_questions (client_id, txn_key) where status in ('open', 'answered');

-- ===========================================================================
-- 3. Grants and policies
-- ===========================================================================
revoke all on public.transaction_questions from anon;
grant select, insert on public.transaction_questions to authenticated;
grant update (status, resolution_note, answer) on public.transaction_questions to authenticated;

-- Staff: unchanged. Client users: their own client_asked questions, and the
-- staff questions sent to them in the portal while open or answered. A
-- resolved staff question disappears from the portal: its resolution_note is
-- a staff-only note (RLS is per row, so hiding the row is how the note stays
-- unreadable). Email-path questions are not shown in the portal (the client
-- got them by email and can't answer there).
drop policy if exists "read transaction questions" on public.transaction_questions;
create policy "read transaction questions" on public.transaction_questions
  for select using (
    (public.is_active_staff() and public.can_access_client(client_id))
    or (
      public.is_client_member(client_id)
      and (
           (direction = 'client_asked' and created_by = lower(auth.jwt() ->> 'email'))
        or (direction = 'staff_asked' and asked_via = 'portal' and asked_of_email = lower(auth.jwt() ->> 'email')
            and status in ('open', 'answered'))
      )
    )
  );

drop policy if exists "client asks about a transaction" on public.transaction_questions;
create policy "client asks about a transaction" on public.transaction_questions
  for insert with check (
    public.is_client_member(client_id) and status = 'open' and direction = 'client_asked'
  );

-- The addressee answers a portal question (open -> answered, once).
drop policy if exists "client answers a question" on public.transaction_questions;
create policy "client answers a question" on public.transaction_questions
  for update
  using (
    direction = 'staff_asked' and asked_via = 'portal' and status = 'open'
    and asked_of_email = lower(auth.jwt() ->> 'email')
    and public.is_client_member(client_id)
  )
  with check (
    direction = 'staff_asked' and asked_via = 'portal' and status = 'answered'
    and asked_of_email = lower(auth.jwt() ->> 'email')
    and public.is_client_member(client_id)
  );

-- "staff resolve transaction questions" (update, staff + access) is unchanged.
-- No delete policy: nobody deletes.

-- ===========================================================================
-- 4. Stamp trigger
-- ===========================================================================
create or replace function public.transaction_questions_stamp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(nullif(btrim(auth.jwt() ->> 'email'), ''));
  v_staff boolean;
  v_addressee boolean;
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
    new.answer := null;
    new.answered_by := null;
    new.answered_at := null;
    new.suggested_category := nullif(btrim(new.suggested_category), '');
    new.note := nullif(btrim(new.note), '');
    -- direction comes from the caller, never from the row. staff_asked only
    -- through gl_review_ask (which sets app.gl_review_ask for this transaction).
    if coalesce(current_setting('app.gl_review_ask', true), '') = 'on'
       and public.is_active_staff() and public.can_access_client(new.client_id) then
      new.direction := 'staff_asked';
      new.asked_of_email := lower(nullif(btrim(new.asked_of_email), ''));
      new.suggested_category := null;
      if new.asked_of_email is null or new.asked_via is null or new.note is null then
        raise exception 'transaction_questions: a staff question needs the question, who it is for and how it is sent';
      end if;
    else
      new.direction := 'client_asked';
      new.asked_of_email := null;
      new.asked_via := null;
      new.flag_id := null;
    end if;
    return new;
  end if;

  -- UPDATE.
  -- ON DELETE SET NULL from gl_review_flags: only flag_id changes, to null. It
  -- runs with whatever (or no) JWT deleted the flag, so allow exactly that.
  if old.flag_id is not null and new.flag_id is null
     and (to_jsonb(new) - 'flag_id') = (to_jsonb(old) - 'flag_id') then
    return new;
  end if;

  if v_email is null then
    raise exception 'transaction_questions: sign in to change a question';
  end if;

  -- Identity never changes.
  new.id := old.id;
  new.client_id := old.client_id;
  new.txn_key := old.txn_key;
  new.txn_date := old.txn_date;
  new.txn_amount := old.txn_amount;
  new.txn_description := old.txn_description;
  new.txn_account := old.txn_account;
  new.suggested_category := old.suggested_category;
  new.note := old.note;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.direction := old.direction;
  new.asked_of_email := old.asked_of_email;
  new.asked_via := old.asked_via;
  new.flag_id := old.flag_id;

  v_staff := public.is_active_staff() and public.can_access_client(old.client_id);
  v_addressee := old.direction = 'staff_asked' and old.asked_via = 'portal'
                 and old.asked_of_email = v_email and public.is_client_member(old.client_id);

  if old.status = 'open' and new.status = 'answered' and old.direction = 'staff_asked'
     and ((v_addressee) or (v_staff and old.asked_via = 'email')) then
    new.answer := nullif(btrim(new.answer), '');
    if new.answer is null then
      raise exception 'transaction_questions: type an answer';
    end if;
    new.answered_by := v_email;
    new.answered_at := now();
    new.resolution_note := old.resolution_note;
    new.resolved_by := old.resolved_by;
    new.resolved_at := old.resolved_at;
  elsif new.status = 'resolved' and v_staff
        and ((old.direction = 'client_asked' and old.status = 'open')
          or (old.direction = 'staff_asked' and old.status in ('open', 'answered'))) then
    new.resolution_note := nullif(btrim(new.resolution_note), '');
    if old.direction = 'staff_asked' and old.status = 'open' and new.resolution_note is null then
      raise exception 'transaction_questions: add a note to close a question that has no answer';
    end if;
    new.resolved_by := v_email;
    new.resolved_at := now();
    new.answer := old.answer;
    new.answered_by := old.answered_by;
    new.answered_at := old.answered_at;
  elsif old.direction = 'client_asked' then
    raise exception 'transaction_questions: only an open question can be resolved';
  else
    raise exception 'transaction_questions: that change is not allowed for this question';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function public.transaction_questions_stamp() from public, anon, authenticated;
drop trigger if exists transaction_questions_stamp on public.transaction_questions;
create trigger transaction_questions_stamp
  before insert or update on public.transaction_questions
  for each row execute function public.transaction_questions_stamp();

-- ===========================================================================
-- 5. Notify trigger (client_asked branches are the live ones, unchanged)
-- ===========================================================================
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
  if new.direction = 'staff_asked' then
    -- Email path: nothing in the portal (gl-review-send emails the question).
    if new.asked_via is distinct from 'portal' then
      return null;
    end if;
    if tg_op = 'INSERT' then
      v_body := 'We have a question about a transaction: ' || coalesce(nullif(v_label, ''), new.txn_key)
        || coalesce(' (' || new.txn_account || ')', '') || '.'
        || E'\n' || new.note;
      -- author_name is stamped from the staff directory (client_messages_stamp_author).
      insert into client_messages (client_id, participant_email, author_email, author_name, author_kind, body)
      values (new.client_id, new.asked_of_email, new.created_by, null, 'staff', left(v_body, 8000));
    elsif new.status = 'answered' and old.status = 'open' then
      v_body := 'Answer about ' || coalesce(nullif(v_label, ''), 'a transaction') || ':'
        || E'\n' || new.answer;
      insert into client_messages (client_id, participant_email, author_email, author_name, author_kind, body)
      values (new.client_id, new.asked_of_email, new.answered_by, null, 'client', left(v_body, 8000));
    end if;
    -- Resolving a staff question posts nothing.
    return null;
  end if;

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

-- ===========================================================================
-- 6. RPCs
-- ===========================================================================
-- Ask the client about a flagged transaction. The flag must be open and be
-- a real QuickBooks transaction (made-up keys such as acct:, chk:, neg:,
-- month:, syn: can't be asked about). Portal: the addressee must be an active,
-- unscoped portal user of this client (gl_review_portal_addressable, part 1;
-- a category- or fund-limited user is refused). Email: it must be the client's contact email
-- (Client setup); gl-review-send then emails it. Sets the flag to 'asked'.
-- Returns the question id.
create or replace function public.gl_review_ask(
  p_flag_id uuid,
  p_asked_via text,
  p_asked_of_email text,
  p_question text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  f public.gl_review_flags;
  v_email text;
  v_to text := lower(nullif(btrim(p_asked_of_email), ''));
  v_q text := nullif(btrim(p_question), '');
  v_contact text;
  v_id uuid;
begin
  select * into f from public.gl_review_flags where id = p_flag_id for update;
  if f.id is null then
    raise exception 'Flag not found.' using errcode = 'P0002';
  end if;
  v_email := public.gl_review_require_staff(f.client_id);
  if f.status <> 'open' then
    raise exception 'Only an open flag can be asked about.' using errcode = '22023';
  end if;
  if f.txn_key ~ '^(syn|acct|chk|neg|month):' or f.txn_key !~ '^[^:]+:.+$' then
    raise exception 'This flag isn''t a single QuickBooks transaction, so it can''t be sent to the client.'
      using errcode = '22023';
  end if;
  if v_q is null or length(v_q) > 2000 then
    raise exception 'Type a question (2,000 characters at most).' using errcode = '22023';
  end if;
  if p_asked_via is null or p_asked_via not in ('portal', 'email') then
    raise exception 'Choose portal or email.' using errcode = '22023';
  end if;
  if v_to is null then
    raise exception 'Choose who to ask.' using errcode = '22023';
  end if;
  if p_asked_via = 'portal' then
    if not exists (select 1 from client_users cu
                   where lower(cu.email) = v_to and cu.client_id = f.client_id and cu.active) then
      raise exception 'That person isn''t an active portal user for this client.' using errcode = '22023';
    end if;
    -- Same predicate as gl_review_portal_addressees (part 1): no limited users.
    if not public.gl_review_portal_addressable(f.client_id, v_to) then
      raise exception 'That person has limited access in the portal, so they can''t be asked about ledger transactions. Pick someone with full access, or use email.'
        using errcode = '22023';
    end if;
  else
    select cp.contact_email into v_contact from client_profile cp where cp.client_id = f.client_id;
    if v_contact is null then
      raise exception 'Add a contact email in Client setup.' using errcode = '22023';
    end if;
    if v_contact <> v_to then
      raise exception 'Email questions go to the contact email in Client setup.' using errcode = '22023';
    end if;
  end if;

  perform set_config('app.gl_review_ask', 'on', true);
  begin
    insert into transaction_questions (client_id, txn_key, txn_date, txn_amount, txn_description, txn_account,
                                       note, direction, asked_of_email, asked_via, flag_id)
    values (f.client_id, f.txn_key, f.txn_date, f.amount,
            left(nullif(concat_ws(' · ', nullif(btrim(f.name), ''), nullif(btrim(f.memo), '')), ''), 500),
            left(f.account_name, 200), v_q, 'staff_asked', v_to, p_asked_via, f.id)
    returning id into v_id;
  exception when unique_violation then
    perform set_config('app.gl_review_ask', 'off', true);
    raise exception 'There''s already an open or answered question about this transaction. Resolve it first.'
      using errcode = '23505';
  end;
  perform set_config('app.gl_review_ask', 'off', true);

  update public.gl_review_flags
     set status = 'asked', question_id = v_id, reviewer = v_email
   where id = f.id;
  return v_id;
end;
$$;

-- "Got an answer": staff type in the answer to an email question. The flag
-- stays 'asked'; a person clears it after reading the answer (spec 5).
create or replace function public.gl_review_answer(p_flag_id uuid, p_answer text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  f public.gl_review_flags;
  q public.transaction_questions;
  v_answer text := nullif(btrim(p_answer), '');
begin
  select * into f from public.gl_review_flags where id = p_flag_id;
  if f.id is null then
    raise exception 'Flag not found.' using errcode = 'P0002';
  end if;
  perform public.gl_review_require_staff(f.client_id);
  if v_answer is null or length(v_answer) > 2000 then
    raise exception 'Type the answer (2,000 characters at most).' using errcode = '22023';
  end if;
  select * into q from transaction_questions where id = f.question_id for update;
  if q.id is null then
    raise exception 'This flag has no question.' using errcode = 'P0002';
  end if;
  if q.direction <> 'staff_asked' or q.asked_via <> 'email' or q.status <> 'open' then
    raise exception 'Only an open emailed question can be answered here.' using errcode = '22023';
  end if;
  update transaction_questions set status = 'answered', answer = v_answer where id = q.id;
end;
$$;

revoke all on function public.gl_review_ask(uuid, text, text, text) from public, anon;
grant execute on function public.gl_review_ask(uuid, text, text, text) to authenticated;
revoke all on function public.gl_review_answer(uuid, text) from public, anon;
grant execute on function public.gl_review_answer(uuid, text) to authenticated;

commit;
