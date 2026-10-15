-- Ledger review (GL Review), part 1: core tables, RLS and RPCs.
-- Spec: docs/gl-review-spec.md (sections 2.5, 3.2, 4, 6.4, 10, 13).
-- NOT APPLIED. Written 2026-10-14 for Phase 1. Put the applied date here when
-- it goes to production (migration name gl_review_1_core).
--
-- Apply order: this file, then gl-review-2-questions.sql, then
-- gl-review-3-close.sql. gl-review-4-quotes.sql is independent.
-- Safe to re-run (create if not exists / create or replace / drop ... if exists).
--
-- What this file adds
--   gl_review_flags           one row per (client, transaction or made-up key, check)
--   gl_review_rules           per-client stop_flagging / pass_through /
--                             account_type_override / threshold rules
--   gl_review_summaries       the client summary draft per month (locked once sent)
--   gl_review_signoffs        per client and month: reviewed / approved / sent back /
--                             override
--   gl_review_month_prints    month fingerprints and closed-month baselines
--                             (service role writes; staff never see `lines`)
--   gl_review_pulls           latest pull per client: the lock and "last pulled";
--                             gl_review_upsert_flags / gl_review_mark_fixed take
--                             the pull's id and read its time from here (the
--                             browser never supplies a pull time)
--   gl_review_watch_vendors   firm-wide vendor watch list (admins edit), seeded
--   gl_review_settings        single row: done_gate (default 'warn'), pull_window,
--                             effective_from (first month the Close step applies)
--   qbo_connections.token_refresh_at   the token-refresh lock (spec 3.2)
--   client_profile.greeting_name / contact_email   (spec 4.10)
--   client_email_log: accepts feature 'gl_review_question' / 'gl_review_summary'
--                     and trigger 'manual' (for gl-review-send, spec 3.3)
--
-- Security model (spec 4 + 10)
--   * RLS on every table. Client users have NO policy on any gl_review_* table.
--   * The browser only SELECTs. Every browser write goes through a SECURITY
--     DEFINER RPC with `set search_path = public` that checks is_active_staff()
--     and can_access_client() (admins: is_active_staff_admin()) itself, stamps
--     who/when from the JWT (lowercased) and enforces the status transitions.
--     authenticated has no INSERT / UPDATE / DELETE / TRUNCATE on these tables.
--   * gl_review_month_prints and gl_review_pulls are written only by the
--     qbo-gl-review edge function (service role) through service-role-only RPCs.
--   * gl_review_month_prints: staff get a column grant that leaves out `lines`.
--
-- Owner decisions honored (spec 13): done_gate ships as 'warn'; an admin may
-- approve their own review (reviewed_by and approved_by are both recorded).
--
-- Overrides and the block gate (spec 4.4, 6.4): gl_review_override_done
-- records the done_gate in force when it was made (override_gate). The
-- month_close block gate (gl-review-3-close.sql) accepts only an override
-- made in block mode (admin + reason), so a warn-era "Mark done anyway"
-- never satisfies block mode later. The block gate applies to every caller,
-- service_role and postgres included (no backend bypass; see part 3).
--
-- Portal addressees: only an active, UNSCOPED portal user of the client can
-- receive a ledger question (gl_review_ask, part 2) or summary
-- (gl_review_send_summary_portal). "Unscoped" is the predicate of
-- my_unscoped_client_ids(p_funds_too => true) in client-scope-rls.sql:
-- access <> 'scoped', or the Basic plan, or no categories and no funds list.
-- gl_review_portal_addressees(client) lists them for the picker.
--
-- Rollback (nothing else depends on these yet; run inside one transaction,
-- after rolling back parts 3 and 2):
--   drop function if exists public.gl_review_upsert_flags(text, uuid, int, jsonb),
--     public.gl_review_portal_addressees(text), public.gl_review_portal_addressable(text, text),
--     public.gl_review_mark_fixed(text, uuid, int), public.gl_review_clear(uuid, text, text, boolean),
--     public.gl_review_send_back_flag(uuid, text), public.gl_review_save_rule(text, text, text, text, text, text, text, jsonb, text, text, text),
--     public.gl_review_set_rule_status(uuid, text), public.gl_review_save_summary(text, date, text, text, jsonb),
--     public.gl_review_send_summary_portal(uuid, text[]), public.gl_review_record_summary_email(uuid, text[], text),
--     public.gl_review_mark_reviewed(text, date), public.gl_review_approve(text, date),
--     public.gl_review_send_back(text, date, text), public.gl_review_override_done(text, date, text),
--     public.gl_review_save_watch_vendor(uuid, text, text, text, boolean), public.gl_review_save_settings(text, text, date),
--     public.gl_review_pull_begin(text, text, text, date, date, boolean), public.gl_review_pull_finish(text, uuid, text, int, int, text),
--     public.gl_review_record_prints(text, jsonb, text), public.gl_review_store_baseline(text, date, text, int, numeric, text, jsonb, text),
--     public.gl_review_rule_hides(public.gl_review_rules, public.gl_review_flags),
--     public.gl_review_rule_upsert(text, text, text, text, text, text, text, jsonb, text, text, text, text),
--     public.gl_review_require_staff(text), public.gl_review_require_admin(), public.gl_review_month(date),
--     public.gl_review_log(text, text, text, jsonb), public.gl_review_stamp(), public.gl_review_summaries_guard(),
--     public.client_profile_normalize_contact();
--   drop table if exists public.gl_review_month_prints, public.gl_review_pulls, public.gl_review_signoffs,
--     public.gl_review_summaries, public.gl_review_rules, public.gl_review_flags,
--     public.gl_review_watch_vendors, public.gl_review_settings;
--   drop trigger if exists client_profile_normalize_contact on public.client_profile;
--   alter table public.client_profile drop column if exists greeting_name, drop column if exists contact_email;
--   alter table public.qbo_connections drop column if exists token_refresh_at;
--   -- client_email_log checks: re-add the lists from staff-handbook.sql / client-emails.sql
--   -- (only after deleting any log rows that use the new values).
--
-- Depends on (repo definitions re-read 2026-10-14): public.clients (clients-roster.sql),
-- public.staff (staff-schema.sql), is_active_staff() (access-requests.sql /
-- client-notes.sql), is_active_staff_admin() (staff-admin-policies.sql),
-- can_access_client() (temp-client-access.sql), public.transaction_questions
-- (transaction-questions.sql), public.client_profile / client_close_items /
-- client_sent_items (staff-client-tools.sql), public.month_close (month-close.sql),
-- public.client_messages (client-messages.sql, client-messages-author-stamp.sql),
-- public.client_activity_log (client-activity-log.sql), public.client_users,
-- public.qbo_connections (qbo-connections.sql, qbo-sync-now.sql),
-- public.client_email_log (client-emails.sql; latest feature list staff-handbook.sql).
-- Note: is_active_staff(), is_active_staff_admin() and can_access_client()
-- compare emails case-sensitively today; the RPCs here call them for the
-- access decision and use lower(jwt email) for every stamp and comparison
-- they make themselves.

begin;

-- ===========================================================================
-- 0. Shared helpers (no browser EXECUTE)
-- ===========================================================================

-- Caller's lowercased email, after checking active staff + access to the client.
create or replace function public.gl_review_require_staff(p_client_id text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_email text := lower(nullif(btrim(auth.jwt() ->> 'email'), ''));
begin
  if v_email is null or not public.is_active_staff() then
    raise exception 'Ledger review is for MyGoodBooks staff.' using errcode = '42501';
  end if;
  if p_client_id is not null and not public.can_access_client(p_client_id) then
    raise exception 'You don''t have access to this client.' using errcode = '42501';
  end if;
  return v_email;
end;
$$;

create or replace function public.gl_review_require_admin()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_email text := lower(nullif(btrim(auth.jwt() ->> 'email'), ''));
begin
  if v_email is null or not public.is_active_staff_admin() then
    raise exception 'Only admins can do that.' using errcode = '42501';
  end if;
  return v_email;
end;
$$;

-- First of the month; null is an error.
create or replace function public.gl_review_month(p_period date)
returns date
language plpgsql
immutable
set search_path = public
as $$
begin
  if p_period is null then
    raise exception 'A month is required.' using errcode = '22023';
  end if;
  return date_trunc('month', p_period)::date;
end;
$$;

-- client_activity_log row, actor name from the staff directory.
create or replace function public.gl_review_log(p_client_id text, p_actor text, p_action text, p_detail jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  select nullif(btrim(s.name), '') into v_name from staff s where lower(s.email) = lower(p_actor) limit 1;
  insert into client_activity_log (client_id, actor_email, actor_name, action, detail)
  values (p_client_id, p_actor, coalesce(v_name, p_actor, 'System'), p_action, p_detail);
end;
$$;

-- Generic created_/updated_ stamp. Signed in: the JWT email (lowercased) wins
-- over anything supplied. Service role (no JWT email): supplied values kept.
-- created_* never change on UPDATE.
create or replace function public.gl_review_stamp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(nullif(btrim(auth.jwt() ->> 'email'), ''));
  v jsonb := to_jsonb(new);
  o jsonb;
begin
  if tg_op = 'INSERT' then
    if v ? 'created_at' then v := v || jsonb_build_object('created_at', now()); end if;
    if v ? 'created_by' then v := v || jsonb_build_object('created_by', coalesce(v_email, v ->> 'created_by')); end if;
  else
    o := to_jsonb(old);
    if v ? 'created_at' then v := v || jsonb_build_object('created_at', o -> 'created_at'); end if;
    if v ? 'created_by' then v := v || jsonb_build_object('created_by', o -> 'created_by'); end if;
  end if;
  if v ? 'updated_at' then v := v || jsonb_build_object('updated_at', now()); end if;
  if v ? 'updated_by' then v := v || jsonb_build_object('updated_by', coalesce(v_email, v ->> 'updated_by')); end if;
  new := jsonb_populate_record(new, v);
  return new;
end;
$$;

-- Can this person receive ledger review content in the portal? An active
-- portal user of the client who is NOT limited: the predicate of
-- my_unscoped_client_ids(p_funds_too => true) (client-scope-rls.sql), applied
-- to the addressee instead of the caller. A category- or fund-limited user
-- can't see the whole ledger, so they get neither questions nor summaries.
create or replace function public.gl_review_portal_addressable(p_client_id text, p_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from client_users cu
      join clients c on c.id = cu.client_id
     where lower(cu.email) = lower(btrim(p_email))
       and cu.client_id = p_client_id
       and cu.active
       and (cu.access <> 'scoped'
            or c.plan = 'basic'
            or (cu.categories is null and cu.funds is null))
  );
$$;

revoke all on function public.gl_review_portal_addressable(text, text) from public, anon, authenticated;
revoke all on function public.gl_review_require_staff(text) from public, anon, authenticated;
revoke all on function public.gl_review_require_admin() from public, anon, authenticated;
revoke all on function public.gl_review_month(date) from public, anon, authenticated;
revoke all on function public.gl_review_log(text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.gl_review_stamp() from public, anon, authenticated;

-- ===========================================================================
-- 1. gl_review_settings (single row)  (spec 4.9, 6.1, 6.4)
-- ===========================================================================
create table if not exists public.gl_review_settings (
  id             boolean primary key default true,
  done_gate      text not null default 'warn',
  pull_window    text not null default 'rolling14',
  -- First month the "Ledger reviewed" Close step applies to (spec 6.1
  -- "effective-from period"). closeStepsFor() and the month_close gate
  -- (gl-review-3-close.sql) both read it. Defaults to the month this is applied.
  effective_from date not null default date_trunc('month', now())::date,
  updated_by     text,
  updated_at     timestamptz not null default now(),
  constraint gl_review_settings_singleton check (id),
  constraint gl_review_settings_done_gate check (done_gate in ('warn', 'block')),
  constraint gl_review_settings_pull_window check (pull_window in ('rolling14', 'ytd')),
  constraint gl_review_settings_effective_from check (effective_from = date_trunc('month', effective_from)::date)
);
insert into public.gl_review_settings (id) values (true) on conflict (id) do nothing;

-- ===========================================================================
-- 2. gl_review_flags  (spec 4.1)
-- ===========================================================================
create table if not exists public.gl_review_flags (
  id             uuid primary key default gen_random_uuid(),
  client_id      text not null references public.clients(id) on delete cascade,
  period         date not null,                  -- month of txn_date / of the key
  -- '<txn_type>:<qbo_id>' for transactions; made-up keys otherwise:
  -- acct:<acct_id>:<YYYY-MM>, chk:<acct_id>:<num>, neg:<acct_id>:<YYYY-MM-DD>,
  -- month:<YYYY-MM>, syn:... (no QuickBooks id; can't be asked about).
  txn_key        text not null check (length(txn_key) between 1 and 200),
  -- suspense, obe, dup, negbank, jecash, gap, large, round, weekend, blank;
  -- phase 2+: swing, vendor_acct, loan_expense, watch_vendor, recon_uncleared,
  -- changed_after_close ... A pattern, not a list, so phase 2 needs no migration.
  flag_type      text not null check (flag_type ~ '^[a-z][a-z0-9_]{1,39}$'),
  severity       text not null check (severity in ('high', 'medium', 'low')),
  why            text not null check (length(why) between 1 and 1000),
  -- Snapshot, so the row still reads after a re-pull.
  txn_date       date,
  amount         numeric,
  name           text check (name is null or length(name) <= 500),
  memo           text check (memo is null or length(memo) <= 2000),
  account_name   text check (account_name is null or length(account_name) <= 200),
  account_qbo_id text check (account_qbo_id is null or length(account_qbo_id) <= 64),
  other_side     text check (other_side is null or length(other_side) <= 500),
  class_name     text check (class_name is null or length(class_name) <= 200),
  location_name  text check (location_name is null or length(location_name) <= 200),
  status         text not null default 'open' check (status in ('open', 'asked', 'cleared', 'fixed')),
  -- 'rule' = hidden by a stop_flagging / pass_through rule (gl_review_mark_fixed).
  cleared_reason text check (cleared_reason is null or cleared_reason in
                   ('expected', 'reviewed_ok', 'fixed_in_qbo', 'client_answered', 'other', 'rule')),
  note           text check (note is null or length(note) <= 2000),
  stop_flagging  boolean not null default false,
  reviewer       text,                           -- last staff email to act
  cleared_by     text,                           -- staff email, or 'rule'
  cleared_at     timestamptz,
  question_id    uuid references public.transaction_questions(id) on delete set null,
  -- Admin review of one specific clear (spec 0.2 item 1). sent_back_note is
  -- written by gl_review_send_back_flag; approved_* is reserved (no RPC sets it
  -- in phase 1; month approval lives in gl_review_signoffs).
  approved_by    text,
  approved_at    timestamptz,
  sent_back_note text check (sent_back_note is null or length(sent_back_note) <= 1000),
  first_period   date not null,                  -- never changes after insert
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz,
  last_pull_at   timestamptz,                    -- started_at of the pull that last saw it (gl_review_pulls)
  last_pull_id   uuid,                           -- pull_id of the pull that last saw it
  fixed_at       timestamptz,
  fixed_by       text,                           -- 'system'
  checks_version int not null check (checks_version >= 1),
  created_by     text,
  created_at     timestamptz not null default now(),
  updated_by     text,
  updated_at     timestamptz not null default now(),
  constraint gl_review_flags_period_first check (period = date_trunc('month', period)::date),
  constraint gl_review_flags_first_period_first check (first_period = date_trunc('month', first_period)::date),
  constraint gl_review_flags_key unique (client_id, txn_key, flag_type)
);
-- Re-run safety for a database that has the table from an earlier draft.
alter table public.gl_review_flags add column if not exists last_pull_id uuid;
create index if not exists gl_review_flags_period_idx on public.gl_review_flags (client_id, period, status);
create index if not exists gl_review_flags_status_idx on public.gl_review_flags (client_id, status, severity);
create index if not exists gl_review_flags_question_idx on public.gl_review_flags (question_id) where question_id is not null;

-- ===========================================================================
-- 3. gl_review_rules  (spec 4.2)
-- ===========================================================================
create table if not exists public.gl_review_rules (
  id                    uuid primary key default gen_random_uuid(),
  client_id             text not null references public.clients(id) on delete cascade,
  kind                  text not null check (kind in ('stop_flagging', 'pass_through', 'account_type_override', 'threshold')),
  status                text not null default 'active' check (status in ('active', 'suggested', 'dismissed')),
  flag_type             text check (flag_type is null or flag_type ~ '^[a-z][a-z0-9_]{1,39}$'),
  match_name            text check (match_name is null or length(match_name) between 1 and 500),
  account_qbo_id        text check (account_qbo_id is null or length(account_qbo_id) between 1 and 64),
  account_name          text check (account_name is null or length(account_name) between 1 and 200),
  account_type_override text check (account_type_override is null or account_type_override in (
                          'Bank', 'Other Current Asset', 'Fixed Asset', 'Other Asset', 'Accounts Receivable',
                          'Equity', 'Expense', 'Other Expense', 'Cost of Goods Sold', 'Accounts Payable',
                          'Credit Card', 'Long Term Liability', 'Other Current Liability', 'Income', 'Other Income')),
  params                jsonb not null default '{}'::jsonb
                          check (jsonb_typeof(params) = 'object' and pg_column_size(params) <= 4096),
  source                text not null default 'manual' check (source in ('manual', 'auto_detected', 'suggested')),
  note                  text check (note is null or length(note) <= 1000),
  created_by            text,
  created_at            timestamptz not null default now(),
  updated_by            text,
  updated_at            timestamptz not null default now(),
  constraint gl_review_rules_shape check (
       (kind = 'stop_flagging' and flag_type is not null
          and (match_name is not null or account_qbo_id is not null or account_name is not null))
    or (kind = 'pass_through' and (account_qbo_id is not null or account_name is not null))
    or (kind = 'account_type_override' and (account_qbo_id is not null or account_name is not null)
          and account_type_override is not null)
    or (kind = 'threshold' and flag_type is not null)
  )
);
create unique index if not exists gl_review_rules_unique on public.gl_review_rules (
  client_id, kind, coalesce(flag_type, ''), coalesce(lower(match_name), ''),
  coalesce(account_qbo_id, lower(account_name), '')
);

-- ===========================================================================
-- 4. gl_review_summaries  (spec 4.3)
-- ===========================================================================
create table if not exists public.gl_review_summaries (
  id         uuid primary key default gen_random_uuid(),
  client_id  text not null references public.clients(id) on delete cascade,
  period     date not null check (period = date_trunc('month', period)::date),
  variant    text not null check (variant in ('clean', 'minor', 'action')),
  body       text not null check (length(body) between 1 and 8000),
  findings   jsonb not null check (jsonb_typeof(findings) = 'object' and pg_column_size(findings) <= 16384),
  status     text not null default 'draft' check (status in ('draft', 'sent')),
  sent_via   text check (sent_via is null or sent_via in ('portal', 'email')),
  sent_to    text[],
  sent_by    text,
  sent_at    timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  updated_by text,
  updated_at timestamptz not null default now(),
  constraint gl_review_summaries_one_per_month unique (client_id, period),
  constraint gl_review_summaries_sent_shape check (
    status = 'draft' or (sent_via is not null and sent_at is not null and sent_by is not null)
  )
);

-- A sent summary is locked, for every caller (service role included).
create or replace function public.gl_review_summaries_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status = 'sent' then
    raise exception 'This summary was already sent and can''t be changed.' using errcode = '42501';
  end if;
  if new.client_id is distinct from old.client_id or new.period is distinct from old.period then
    raise exception 'A summary can''t move to another client or month.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.gl_review_summaries_guard() from public, anon, authenticated;

-- ===========================================================================
-- 5. gl_review_signoffs (per client and month)  (spec 4.4, 6.4)
-- ===========================================================================
create table if not exists public.gl_review_signoffs (
  client_id           text not null references public.clients(id) on delete cascade,
  period              date not null check (period = date_trunc('month', period)::date),
  status              text not null default 'in_review'
                        check (status in ('in_review', 'reviewed', 'approved', 'sent_back')),
  reviewed_by         text,
  reviewed_at         timestamptz,
  high_open_at_review int check (high_open_at_review is null or high_open_at_review >= 0),
  approved_by         text,
  approved_at         timestamptz,
  sent_back_by        text,
  sent_back_at        timestamptz,
  sent_back_note      text check (sent_back_note is null or length(sent_back_note) <= 1000),
  override_by         text,
  override_note       text check (override_note is null or length(override_note) <= 1000),
  override_at         timestamptz,
  -- done_gate in force when the override was made. Only 'block' satisfies the
  -- block-mode month_close gate (spec 4.4: a warn-era override must not).
  override_gate       text check (override_gate is null or override_gate in ('warn', 'block')),
  updated_by          text,
  updated_at          timestamptz not null default now(),
  primary key (client_id, period),
  constraint gl_review_signoffs_approved_shape check (
    status <> 'approved' or (approved_by is not null and approved_at is not null)
  )
);
-- Re-run safety for a database that has the table from an earlier draft.
alter table public.gl_review_signoffs add column if not exists override_gate text;
alter table public.gl_review_signoffs drop constraint if exists gl_review_signoffs_override_gate_check;
alter table public.gl_review_signoffs add constraint gl_review_signoffs_override_gate_check
  check (override_gate is null or override_gate in ('warn', 'block'));

-- ===========================================================================
-- 6. gl_review_month_prints  (spec 2.1, 4.5)
-- ===========================================================================
create table if not exists public.gl_review_month_prints (
  id          uuid primary key default gen_random_uuid(),
  client_id   text not null references public.clients(id) on delete cascade,
  period      date not null check (period = date_trunc('month', period)::date),
  kind        text not null check (kind in ('pull', 'baseline')),
  -- Accounting basis the pull used (spec 2.1), so a cash/accrual flip reads as
  -- "basis changed", not "edited after close".
  basis       text check (basis is null or basis in ('Cash', 'Accrual')),
  line_count  int not null check (line_count >= 0),
  debit_total numeric not null,
  hash        text not null check (hash ~ '^[0-9a-f]{64}$'),
  captured_at timestamptz not null default now(),
  captured_by text check (captured_by is null or length(captured_by) <= 200),   -- 'staff:<email>' or 'system'
  -- Baseline rows only: [[key, acct_id, date, cents, name], ...]. Null otherwise.
  lines       jsonb check (
                lines is null
                or (kind = 'baseline' and jsonb_typeof(lines) = 'array' and pg_column_size(lines) <= 8388608)
              ),
  constraint gl_review_month_prints_unique unique (client_id, period, kind, captured_at)
);
create index if not exists gl_review_month_prints_latest_idx
  on public.gl_review_month_prints (client_id, period, kind, captured_at desc);

-- ===========================================================================
-- 7. gl_review_pulls (latest pull per client: lock + "last pulled")  (spec 4.6)
-- ===========================================================================
create table if not exists public.gl_review_pulls (
  client_id    text primary key references public.clients(id) on delete cascade,
  -- New every pull. gl_review_mark_fixed only acts for the latest one, which is
  -- what stops an older tab flipping flags.
  pull_id      uuid not null default gen_random_uuid(),
  status       text not null check (status in ('ok', 'error', 'running')),
  window_kind  text check (window_kind is null or window_kind in ('rolling14', 'ytd', 'custom', 'baseline')),
  window_start date,
  window_end   date,
  started_at   timestamptz not null default now(),   -- = the pull's server-issued pulled_at
  finished_at  timestamptz,
  calls        int not null default 0 check (calls >= 0),
  line_count   int check (line_count is null or line_count >= 0),
  error        text check (error is null or length(error) <= 300),   -- short, plain language; never Intuit text
  pulled_by    text
);

-- ===========================================================================
-- 8. gl_review_watch_vendors (firm-wide)  (spec 4.7)
-- ===========================================================================
create table if not exists public.gl_review_watch_vendors (
  id         uuid primary key default gen_random_uuid(),
  pattern    text not null check (length(btrim(pattern)) between 2 and 80),   -- case-insensitive substring
  category   text not null default 'other'
               check (category in ('streaming', 'liquor', 'gambling', 'personal_payment', 'other')),
  note       text check (note is null or length(note) <= 500),
  active     boolean not null default true,
  created_by text,
  created_at timestamptz not null default now(),
  updated_by text,
  updated_at timestamptz not null default now()
);
create unique index if not exists gl_review_watch_vendors_pattern_idx
  on public.gl_review_watch_vendors (lower(btrim(pattern)));

-- Starter list (spec 4.7). Bailley reviews it before it ships (spec 13.5).
-- Re-running skips patterns that already exist, so one an admin turned off
-- stays off (a pattern an admin renamed would come back on a re-run).
insert into public.gl_review_watch_vendors (pattern, category, created_by, updated_by) values
  ('netflix',         'streaming',        'seed', 'seed'),
  ('hulu',            'streaming',        'seed', 'seed'),
  ('disney+',         'streaming',        'seed', 'seed'),
  ('spotify',         'streaming',        'seed', 'seed'),
  ('liquor',          'liquor',           'seed', 'seed'),
  ('wine & spirits',  'liquor',           'seed', 'seed'),
  ('casino',          'gambling',         'seed', 'seed'),
  ('venmo',           'personal_payment', 'seed', 'seed'),
  ('cash app',        'personal_payment', 'seed', 'seed')
on conflict do nothing;

-- ===========================================================================
-- 9. Stamp triggers
-- ===========================================================================
drop trigger if exists gl_review_flags_stamp on public.gl_review_flags;
create trigger gl_review_flags_stamp before insert or update on public.gl_review_flags
  for each row execute function public.gl_review_stamp();
drop trigger if exists gl_review_rules_stamp on public.gl_review_rules;
create trigger gl_review_rules_stamp before insert or update on public.gl_review_rules
  for each row execute function public.gl_review_stamp();
drop trigger if exists gl_review_summaries_stamp on public.gl_review_summaries;
create trigger gl_review_summaries_stamp before insert or update on public.gl_review_summaries
  for each row execute function public.gl_review_stamp();
drop trigger if exists gl_review_summaries_guard on public.gl_review_summaries;
create trigger gl_review_summaries_guard before update on public.gl_review_summaries
  for each row execute function public.gl_review_summaries_guard();
drop trigger if exists gl_review_signoffs_stamp on public.gl_review_signoffs;
create trigger gl_review_signoffs_stamp before insert or update on public.gl_review_signoffs
  for each row execute function public.gl_review_stamp();
drop trigger if exists gl_review_watch_vendors_stamp on public.gl_review_watch_vendors;
create trigger gl_review_watch_vendors_stamp before insert or update on public.gl_review_watch_vendors
  for each row execute function public.gl_review_stamp();
drop trigger if exists gl_review_settings_stamp on public.gl_review_settings;
create trigger gl_review_settings_stamp before insert or update on public.gl_review_settings
  for each row execute function public.gl_review_stamp();

-- ===========================================================================
-- 10. RLS, policies and grants
-- ===========================================================================
do $$
declare t text;
begin
  foreach t in array array['gl_review_flags', 'gl_review_rules', 'gl_review_summaries', 'gl_review_signoffs',
                           'gl_review_month_prints', 'gl_review_pulls', 'gl_review_watch_vendors',
                           'gl_review_settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon', t);
    execute format('revoke all on public.%I from authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- Per-client tables: active staff who can access the client read; nobody
-- writes from the browser (RPCs only). No client-user policy anywhere.
drop policy if exists "staff read gl review flags" on public.gl_review_flags;
create policy "staff read gl review flags" on public.gl_review_flags
  for select to authenticated
  using (public.is_active_staff() and public.can_access_client(client_id));
grant select on public.gl_review_flags to authenticated;

drop policy if exists "staff read gl review rules" on public.gl_review_rules;
create policy "staff read gl review rules" on public.gl_review_rules
  for select to authenticated
  using (public.is_active_staff() and public.can_access_client(client_id));
grant select on public.gl_review_rules to authenticated;

drop policy if exists "staff read gl review summaries" on public.gl_review_summaries;
create policy "staff read gl review summaries" on public.gl_review_summaries
  for select to authenticated
  using (public.is_active_staff() and public.can_access_client(client_id));
grant select on public.gl_review_summaries to authenticated;

drop policy if exists "staff read gl review signoffs" on public.gl_review_signoffs;
create policy "staff read gl review signoffs" on public.gl_review_signoffs
  for select to authenticated
  using (public.is_active_staff() and public.can_access_client(client_id));
grant select on public.gl_review_signoffs to authenticated;

drop policy if exists "staff read gl review prints" on public.gl_review_month_prints;
create policy "staff read gl review prints" on public.gl_review_month_prints
  for select to authenticated
  using (public.is_active_staff() and public.can_access_client(client_id));
-- Column grant: `lines` (baseline transaction rows) is not readable from the
-- browser. A select * from the browser fails; list the columns.
grant select (id, client_id, period, kind, basis, line_count, debit_total, hash, captured_at, captured_by)
  on public.gl_review_month_prints to authenticated;

drop policy if exists "staff read gl review pulls" on public.gl_review_pulls;
create policy "staff read gl review pulls" on public.gl_review_pulls
  for select to authenticated
  using (public.is_active_staff() and public.can_access_client(client_id));
grant select on public.gl_review_pulls to authenticated;

-- Firm-wide tables: every active staff member reads; admins write via RPC.
drop policy if exists "staff read gl review watch vendors" on public.gl_review_watch_vendors;
create policy "staff read gl review watch vendors" on public.gl_review_watch_vendors
  for select to authenticated using (public.is_active_staff());
grant select on public.gl_review_watch_vendors to authenticated;

drop policy if exists "staff read gl review settings" on public.gl_review_settings;
create policy "staff read gl review settings" on public.gl_review_settings
  for select to authenticated using (public.is_active_staff());
grant select on public.gl_review_settings to authenticated;

-- ===========================================================================
-- 11. Flag RPCs  (spec 4.1)
-- ===========================================================================

-- Does an active rule hide this flag? stop_flagging: same flag_type and every
-- criterion the rule sets matches (name case-insensitive exact; account by
-- QuickBooks id, else by name). pass_through: the flag's account.
create or replace function public.gl_review_rule_hides(r public.gl_review_rules, g public.gl_review_flags)
returns boolean
language sql
stable
set search_path = public
as $$
  select r.status = 'active' and r.client_id = g.client_id and (
    (r.kind = 'stop_flagging'
      and r.flag_type = g.flag_type
      and (r.match_name is null or lower(r.match_name) = lower(g.name))
      and (r.account_qbo_id is null or r.account_qbo_id = g.account_qbo_id)
      and (r.account_qbo_id is not null or r.account_name is null or lower(r.account_name) = lower(g.account_name)))
    or (r.kind = 'pass_through'
      and ((r.account_qbo_id is not null and r.account_qbo_id = g.account_qbo_id)
        or (r.account_qbo_id is null and lower(r.account_name) = lower(g.account_name))))
  );
$$;
revoke all on function public.gl_review_rule_hides(public.gl_review_rules, public.gl_review_flags) from public, anon, authenticated;

-- Insert or update the flags one pull found. The pull is named by its id and
-- read from gl_review_pulls; the browser supplies no time. It must be the
-- client's latest pull, started by the caller, and either finished 'ok' less
-- than 20 minutes ago (the browser keeps lines 15 minutes) or still 'running'
-- inside its 3-minute lock window. Anything else raises (stale / too old:
-- 22023; someone else's pull: 42501).
-- New rows are 'open'. On conflict only detection fields, last_seen_at,
-- last_pull_at (= the pull's started_at) and last_pull_id change, and a
-- 'fixed' flag reopens (the latest pull sees it again); open / asked /
-- cleared are never changed. A flag already seen by a newer pull is left alone.
-- Keys are trimmed before de-duplicating, so "Purchase:1" and "Purchase:1 "
-- in one batch are one flag (the last one in the batch wins).
-- p_flags: [{txn_key, flag_type, severity, why, period?, txn_date?, amount?,
--            name?, memo?, account_name?, account_qbo_id?, other_side?,
--            class_name?, location_name?}]  (period or txn_date required;
--            period is the month derived from the key, spec 4.1)
-- Returns {inserted, updated, reopened}.
drop function if exists public.gl_review_upsert_flags(text, timestamptz, int, jsonb);
create or replace function public.gl_review_upsert_flags(
  p_client_id text,
  p_pull_id uuid,
  p_checks_version int,
  p_flags jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := public.gl_review_require_staff(p_client_id);
  p public.gl_review_pulls;
  v_pull_at timestamptz;
  v_n int;
  v_ins int := 0;
  v_upd int := 0;
  v_reopen int := 0;
begin
  if p_pull_id is null then
    raise exception 'pull_id is required.' using errcode = '22023';
  end if;
  select * into p from public.gl_review_pulls where client_id = p_client_id;
  if p.client_id is null or p.pull_id is distinct from p_pull_id then
    raise exception 'A newer pull replaced this one. Pull again.' using errcode = '22023';
  end if;
  if p.pulled_by is distinct from v_email then
    raise exception 'Only the person who ran this pull can save its flags.' using errcode = '42501';
  end if;
  if not ((p.status = 'ok' and p.started_at >= now() - interval '20 minutes')
          or (p.status = 'running' and p.started_at > now() - interval '3 minutes')) then
    raise exception 'This pull is too old to save. Pull again.' using errcode = '22023';
  end if;
  v_pull_at := p.started_at;
  if p_checks_version is null or p_checks_version < 1 then
    raise exception 'checks_version is required.' using errcode = '22023';
  end if;
  if p_flags is null or jsonb_typeof(p_flags) <> 'array' then
    raise exception 'flags must be a JSON array.' using errcode = '22023';
  end if;
  v_n := jsonb_array_length(p_flags);
  if v_n > 2000 then
    raise exception 'At most 2,000 flags per call.' using errcode = '22023';
  end if;
  if v_n = 0 then
    return jsonb_build_object('inserted', 0, 'updated', 0, 'reopened', 0);
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_flags) e
    where jsonb_typeof(e) <> 'object'
       or nullif(btrim(e ->> 'txn_key'), '') is null
       or nullif(btrim(e ->> 'flag_type'), '') is null
       or nullif(btrim(e ->> 'why'), '') is null
       or coalesce(e ->> 'severity', '') not in ('high', 'medium', 'low')
       or coalesce(e ->> 'period', e ->> 'txn_date') is null
  ) then
    raise exception 'Every flag needs txn_key, flag_type, severity, why and period or txn_date.' using errcode = '22023';
  end if;

  with raw as (
    select f.*, btrim(f.txn_key) as k, btrim(f.flag_type) as t, o.n as ord
    from jsonb_array_elements(p_flags) with ordinality as o(e, n)
    cross join lateral jsonb_to_record(o.e) as f(
      txn_key text, flag_type text, severity text, why text, period date, txn_date date,
      amount numeric, name text, memo text, account_name text, account_qbo_id text,
      other_side text, class_name text, location_name text)
  ),
  src as (
    -- De-duplicate on the trimmed key (what is stored), last entry wins.
    select distinct on (r.k, r.t)
      r.k as txn_key,
      r.t as flag_type,
      r.severity,
      left(btrim(r.why), 1000) as why,
      date_trunc('month', coalesce(r.period, r.txn_date))::date as period,
      r.txn_date,
      r.amount,
      left(nullif(btrim(r.name), ''), 500) as name,
      left(nullif(btrim(r.memo), ''), 2000) as memo,
      left(nullif(btrim(r.account_name), ''), 200) as account_name,
      left(nullif(btrim(r.account_qbo_id), ''), 64) as account_qbo_id,
      left(nullif(btrim(r.other_side), ''), 500) as other_side,
      left(nullif(btrim(r.class_name), ''), 200) as class_name,
      left(nullif(btrim(r.location_name), ''), 200) as location_name
    from raw r
    order by r.k, r.t, r.ord desc
  ),
  pre as (
    select g.id
    from public.gl_review_flags g
    join src s on g.client_id = p_client_id and g.txn_key = s.txn_key and g.flag_type = s.flag_type
    where g.status = 'fixed'
      and (g.last_pull_at is null or v_pull_at >= g.last_pull_at)
  ),
  up as (
    insert into public.gl_review_flags as g (
      client_id, period, txn_key, flag_type, severity, why, txn_date, amount, name, memo,
      account_name, account_qbo_id, other_side, class_name, location_name,
      status, first_period, first_seen_at, last_seen_at, last_pull_at, last_pull_id, checks_version, reviewer)
    select p_client_id, s.period, s.txn_key, s.flag_type, s.severity, s.why, s.txn_date, s.amount, s.name, s.memo,
           s.account_name, s.account_qbo_id, s.other_side, s.class_name, s.location_name,
           'open', s.period, now(), now(), v_pull_at, p_pull_id, p_checks_version, null
    from src s
    on conflict (client_id, txn_key, flag_type) do update set
      period         = excluded.period,
      severity       = excluded.severity,
      why            = excluded.why,
      txn_date       = excluded.txn_date,
      amount         = excluded.amount,
      name           = excluded.name,
      memo           = excluded.memo,
      account_name   = excluded.account_name,
      account_qbo_id = excluded.account_qbo_id,
      other_side     = excluded.other_side,
      class_name     = excluded.class_name,
      location_name  = excluded.location_name,
      checks_version = excluded.checks_version,
      last_seen_at   = now(),
      last_pull_at   = excluded.last_pull_at,
      last_pull_id   = excluded.last_pull_id,
      -- Only the latest pull gets here, so a fixed flag it sees is back.
      status         = case when g.status = 'fixed' then 'open' else g.status end,
      fixed_at       = case when g.status = 'fixed' then null else g.fixed_at end,
      fixed_by       = case when g.status = 'fixed' then null else g.fixed_by end
    where g.last_pull_at is null or excluded.last_pull_at >= g.last_pull_at
    returning (xmax = 0) as inserted
  )
  select count(*) filter (where inserted), count(*) filter (where not inserted), (select count(*) from pre)
    into v_ins, v_upd, v_reopen
  from up;

  return jsonb_build_object('inserted', v_ins, 'updated', v_upd, 'reopened', v_reopen);
end;
$$;

-- After a complete rolling14 pull: open flags of this checks_version, inside
-- the pull's window, whose last_pull_id is not this pull (it didn't see them)
-- are 'fixed' (or 'cleared' with reason 'rule' when an active stop_flagging /
-- pass_through rule now hides them). Only the client's latest pull, run by
-- the caller, may do this; anything else gets {status:'stale'} and nothing
-- changes. Month-dependent checks are never auto-fixed: their detection
-- depends on the review month open in the browser, not on the pull window, so
-- "this pull didn't see it" doesn't mean "fixed". Today that is
-- recon_uncleared (GLR_checks.reconciliation uses ctx.reviewPeriod); add any
-- new check whose detection reads the review month to v_month_types.
create or replace function public.gl_review_mark_fixed(p_client_id text, p_pull_id uuid, p_checks_version int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := public.gl_review_require_staff(p_client_id);
  v_month_types text[] := array['recon_uncleared'];
  p public.gl_review_pulls;
  v_rule int := 0;
  v_fixed int := 0;
begin
  select * into p from public.gl_review_pulls where client_id = p_client_id;
  if p.client_id is null or p_pull_id is null or p.pull_id is distinct from p_pull_id
     or p.pulled_by is distinct from v_email then
    return jsonb_build_object('status', 'stale', 'fixed', 0, 'cleared_by_rule', 0);
  end if;
  if p.status <> 'ok' or p.window_kind is distinct from 'rolling14'
     or p.window_start is null or p.window_end is null then
    raise exception 'Only a complete rolling 14-month pull can mark flags fixed.' using errcode = '22023';
  end if;
  if p_checks_version is null then
    raise exception 'checks_version is required.' using errcode = '22023';
  end if;

  update public.gl_review_flags g
     set status = 'cleared', cleared_reason = 'rule', cleared_by = 'rule', cleared_at = now()
   where g.client_id = p_client_id
     and g.status = 'open'
     and g.checks_version = p_checks_version
     and g.last_pull_id is distinct from p_pull_id
     and g.flag_type <> all (v_month_types)
     and g.period >= date_trunc('month', p.window_start)::date
     and g.period <= p.window_end
     and exists (select 1 from public.gl_review_rules r
                 where r.client_id = g.client_id and public.gl_review_rule_hides(r, g));
  get diagnostics v_rule = row_count;

  update public.gl_review_flags g
     set status = 'fixed', fixed_at = now(), fixed_by = 'system'
   where g.client_id = p_client_id
     and g.status = 'open'
     and g.checks_version = p_checks_version
     and g.last_pull_id is distinct from p_pull_id
     and g.flag_type <> all (v_month_types)
     and g.period >= date_trunc('month', p.window_start)::date
     and g.period <= p.window_end;
  get diagnostics v_fixed = row_count;

  return jsonb_build_object('status', 'ok', 'fixed', v_fixed, 'cleared_by_rule', v_rule);
end;
$$;

-- Internal: create or re-activate a rule by its unique key. Returns the id.
create or replace function public.gl_review_rule_upsert(
  p_client_id text, p_kind text, p_flag_type text, p_match_name text, p_account_qbo_id text,
  p_account_name text, p_account_type_override text, p_params jsonb, p_status text, p_source text,
  p_note text, p_actor text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_flag text := nullif(btrim(p_flag_type), '');
  v_name text := nullif(btrim(p_match_name), '');
  v_acct text := nullif(btrim(p_account_qbo_id), '');
  v_acct_name text := nullif(btrim(p_account_name), '');
begin
  select r.id into v_id from public.gl_review_rules r
   where r.client_id = p_client_id and r.kind = p_kind
     and coalesce(r.flag_type, '') = coalesce(v_flag, '')
     and coalesce(lower(r.match_name), '') = coalesce(lower(v_name), '')
     and coalesce(r.account_qbo_id, lower(r.account_name), '') = coalesce(v_acct, lower(v_acct_name), '')
   for update;
  if v_id is null then
    insert into public.gl_review_rules (client_id, kind, status, flag_type, match_name, account_qbo_id, account_name,
                                        account_type_override, params, source, note, created_by, updated_by)
    values (p_client_id, p_kind, p_status, v_flag, v_name, v_acct, v_acct_name,
            nullif(btrim(p_account_type_override), ''), coalesce(p_params, '{}'::jsonb), p_source,
            nullif(btrim(p_note), ''), p_actor, p_actor)
    returning id into v_id;
  else
    update public.gl_review_rules
       set status = p_status,
           account_name = coalesce(v_acct_name, account_name),
           account_type_override = coalesce(nullif(btrim(p_account_type_override), ''), account_type_override),
           params = coalesce(p_params, params),
           note = coalesce(nullif(btrim(p_note), ''), note),
           updated_by = p_actor
     where id = v_id;
  end if;
  return v_id;
end;
$$;
revoke all on function public.gl_review_rule_upsert(text, text, text, text, text, text, text, jsonb, text, text, text, text)
  from public, anon, authenticated;

-- open / asked -> cleared. stop_flagging also stores a stop_flagging rule
-- (this vendor + this check; by account when the flag has no name).
-- Returns {flag_id, status, rule_id}.
create or replace function public.gl_review_clear(
  p_flag_id uuid,
  p_reason text,
  p_note text default null,
  p_stop_flagging boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  f public.gl_review_flags;
  v_email text;
  v_note text := nullif(btrim(p_note), '');
  v_rule uuid;
begin
  select * into f from public.gl_review_flags where id = p_flag_id for update;
  if f.id is null then
    raise exception 'Flag not found.' using errcode = 'P0002';
  end if;
  v_email := public.gl_review_require_staff(f.client_id);
  if f.status not in ('open', 'asked') then
    raise exception 'Only an open or asked flag can be cleared.' using errcode = '22023';
  end if;
  if p_reason is null or p_reason not in ('expected', 'reviewed_ok', 'fixed_in_qbo', 'client_answered', 'other') then
    raise exception 'Pick a reason.' using errcode = '22023';
  end if;
  if length(v_note) > 2000 then
    raise exception 'The note is too long (2,000 characters at most).' using errcode = '22023';
  end if;
  if coalesce(p_stop_flagging, false)
     and nullif(btrim(f.name), '') is null and f.account_qbo_id is null and f.account_name is null then
    raise exception 'This flag has no name or account, so it can''t be muted. Clear it without "stop flagging".'
      using errcode = '22023';
  end if;

  update public.gl_review_flags
     set status = 'cleared', cleared_reason = p_reason, note = v_note,
         stop_flagging = coalesce(p_stop_flagging, false),
         reviewer = v_email, cleared_by = v_email, cleared_at = now(),
         approved_by = null, approved_at = null
   where id = f.id;

  if coalesce(p_stop_flagging, false) then
    v_rule := public.gl_review_rule_upsert(
      f.client_id, 'stop_flagging', f.flag_type, f.name,
      case when nullif(btrim(f.name), '') is null then f.account_qbo_id end,
      case when nullif(btrim(f.name), '') is null then f.account_name end,
      null, '{}'::jsonb, 'active', 'manual', v_note, v_email);
  end if;

  return jsonb_build_object('flag_id', f.id, 'status', 'cleared', 'rule_id', v_rule);
end;
$$;

-- Admin disagrees with one clear: cleared -> open, with a note.
-- (Named _flag so it doesn't overload the month-level gl_review_send_back.)
create or replace function public.gl_review_send_back_flag(p_flag_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := public.gl_review_require_admin();
  f public.gl_review_flags;
  v_note text := nullif(btrim(p_note), '');
begin
  if v_note is null or length(v_note) > 1000 then
    raise exception 'A note (1 to 1,000 characters) is required.' using errcode = '22023';
  end if;
  select * into f from public.gl_review_flags where id = p_flag_id for update;
  if f.id is null then
    raise exception 'Flag not found.' using errcode = 'P0002';
  end if;
  perform public.gl_review_require_staff(f.client_id);
  if f.status <> 'cleared' then
    raise exception 'Only a cleared flag can be sent back.' using errcode = '22023';
  end if;
  update public.gl_review_flags
     set status = 'open', sent_back_note = v_note, reviewer = v_email,
         cleared_reason = null, cleared_by = null, cleared_at = null,
         approved_by = null, approved_at = null
   where id = f.id;
end;
$$;

-- ===========================================================================
-- 12. Rule RPCs  (spec 4.2)
-- ===========================================================================
-- Create a rule, or re-activate / update the existing one with the same key.
-- p_status 'active' (staff saved it) or 'suggested' (the app proposes it;
-- accepted with gl_review_set_rule_status(id, 'active')).
create or replace function public.gl_review_save_rule(
  p_client_id text,
  p_kind text,
  p_flag_type text default null,
  p_match_name text default null,
  p_account_qbo_id text default null,
  p_account_name text default null,
  p_account_type_override text default null,
  p_params jsonb default '{}'::jsonb,
  p_status text default 'active',
  p_source text default 'manual',
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := public.gl_review_require_staff(p_client_id);
begin
  if p_kind is null or p_kind not in ('stop_flagging', 'pass_through', 'account_type_override', 'threshold') then
    raise exception 'Unknown rule kind.' using errcode = '22023';
  end if;
  if p_status is null or p_status not in ('active', 'suggested') then
    raise exception 'A new rule is active or suggested.' using errcode = '22023';
  end if;
  if p_source is null or p_source not in ('manual', 'auto_detected', 'suggested') then
    raise exception 'Unknown rule source.' using errcode = '22023';
  end if;
  return public.gl_review_rule_upsert(p_client_id, p_kind, p_flag_type, p_match_name, p_account_qbo_id,
                                      p_account_name, p_account_type_override, p_params, p_status, p_source,
                                      p_note, v_email);
end;
$$;

-- Accept a suggestion ('active') or remove a rule ('dismissed'; rules are never deleted).
create or replace function public.gl_review_set_rule_status(p_rule_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client text;
begin
  select client_id into v_client from public.gl_review_rules where id = p_rule_id for update;
  if v_client is null then
    raise exception 'Rule not found.' using errcode = 'P0002';
  end if;
  perform public.gl_review_require_staff(v_client);
  if p_status is null or p_status not in ('active', 'dismissed') then
    raise exception 'A rule can be set to active or dismissed.' using errcode = '22023';
  end if;
  update public.gl_review_rules set status = p_status where id = p_rule_id;
end;
$$;

-- ===========================================================================
-- 13. Summary RPCs  (spec 4.3, 3.3, 7.3)
-- ===========================================================================
-- Save (create or update) the month's draft. Refused once sent.
create or replace function public.gl_review_save_summary(
  p_client_id text,
  p_period date,
  p_variant text,
  p_body text,
  p_findings jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := public.gl_review_require_staff(p_client_id);
  v_period date := public.gl_review_month(p_period);
  v_body text := btrim(p_body);
  v_id uuid;
begin
  if p_variant is null or p_variant not in ('clean', 'minor', 'action') then
    raise exception 'Unknown summary variant.' using errcode = '22023';
  end if;
  if v_body is null or length(v_body) = 0 or length(v_body) > 8000 then
    raise exception 'The summary must be 1 to 8,000 characters.' using errcode = '22023';
  end if;
  if p_findings is null or jsonb_typeof(p_findings) <> 'object' then
    raise exception 'findings must be a JSON object.' using errcode = '22023';
  end if;
  insert into public.gl_review_summaries as s (client_id, period, variant, body, findings, status)
  values (p_client_id, v_period, p_variant, v_body, p_findings, 'draft')
  on conflict (client_id, period) do update
    set variant = excluded.variant, body = excluded.body, findings = excluded.findings
    where s.status = 'draft'
  returning id into v_id;
  if v_id is null then
    raise exception 'This month''s summary was already sent and can''t be changed.' using errcode = '42501';
  end if;
  return v_id;
end;
$$;

-- Who the portal pickers (Ask client, Send summary) may offer: active,
-- unscoped portal users of the client (gl_review_portal_addressable).
-- Staff with access to the client only. Emails come back lowercased.
create or replace function public.gl_review_portal_addressees(p_client_id text)
returns table (email text, name text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.gl_review_require_staff(p_client_id);
  return query
    select lower(cu.email), cu.name
      from client_users cu
     where cu.client_id = p_client_id
       and public.gl_review_portal_addressable(p_client_id, cu.email)
     order by lower(cu.name), lower(cu.email);
end;
$$;

-- Send via portal: one staff message per recipient thread (each must be an
-- active, unscoped portal user of this client: gl_review_portal_addressable),
-- lock the summary, and add the "Sent to the client" history row.
-- Returns {summary_id, sent_to}.
create or replace function public.gl_review_send_summary_portal(p_summary_id uuid, p_to text[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.gl_review_summaries;
  v_email text;
  v_to text[];
  v_bad text[];
  v_name text;
  e text;
begin
  select * into s from public.gl_review_summaries where id = p_summary_id for update;
  if s.id is null then
    raise exception 'Summary not found.' using errcode = 'P0002';
  end if;
  v_email := public.gl_review_require_staff(s.client_id);
  if s.status <> 'draft' then
    raise exception 'This summary was already sent.' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct lower(btrim(x))), '{}') into v_to
    from unnest(coalesce(p_to, '{}'::text[])) x where nullif(btrim(x), '') is not null;
  if cardinality(v_to) = 0 or cardinality(v_to) > 20 then
    raise exception 'Pick 1 to 20 portal users.' using errcode = '22023';
  end if;
  select array_agg(t) into v_bad from unnest(v_to) t
   where not exists (select 1 from client_users cu
                     where lower(cu.email) = t and cu.client_id = s.client_id and cu.active);
  if v_bad is not null then
    raise exception 'Not an active portal user of this client: %', array_to_string(v_bad, ', ') using errcode = '22023';
  end if;
  select array_agg(t) into v_bad from unnest(v_to) t
   where not public.gl_review_portal_addressable(s.client_id, t);
  if v_bad is not null then
    raise exception 'These portal users have limited access, so they can''t receive the ledger review summary: %',
      array_to_string(v_bad, ', ') using errcode = '22023';
  end if;

  foreach e in array v_to loop
    -- author_name is stamped from the staff directory (client_messages_stamp_author).
    insert into client_messages (client_id, participant_email, author_email, author_name, author_kind, body)
    values (s.client_id, e, v_email, null, 'staff', s.body);
  end loop;

  update public.gl_review_summaries
     set status = 'sent', sent_via = 'portal', sent_to = v_to, sent_by = v_email, sent_at = now()
   where id = s.id;

  select nullif(btrim(st.name), '') into v_name from staff st where lower(st.email) = v_email limit 1;
  insert into client_sent_items (client_id, item_type, item_key, item_label, period_label, sent_by, sent_by_name)
  values (s.client_id, 'other', 'ledger_review_summary', 'Ledger review summary',
          to_char(s.period, 'FMMonth YYYY'), v_email, coalesce(v_name, v_email));

  return jsonb_build_object('summary_id', s.id, 'sent_to', to_jsonb(v_to));
end;
$$;

-- Service role only: gl-review-send records an emailed summary after Resend
-- accepted it (the function reads body/recipient from the row by id).
create or replace function public.gl_review_record_summary_email(p_summary_id uuid, p_sent_to text[], p_sent_by text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.gl_review_summaries;
  v_by text := lower(nullif(btrim(p_sent_by), ''));
  v_name text;
begin
  select * into s from public.gl_review_summaries where id = p_summary_id for update;
  if s.id is null then
    raise exception 'Summary not found.' using errcode = 'P0002';
  end if;
  if s.status <> 'draft' then
    raise exception 'This summary was already sent.' using errcode = '22023';
  end if;
  if v_by is null or coalesce(cardinality(p_sent_to), 0) = 0 then
    raise exception 'sent_by and sent_to are required.' using errcode = '22023';
  end if;
  update public.gl_review_summaries
     set status = 'sent', sent_via = 'email', sent_to = p_sent_to, sent_by = v_by, sent_at = now()
   where id = s.id;
  select nullif(btrim(st.name), '') into v_name from staff st where lower(st.email) = v_by limit 1;
  insert into client_sent_items (client_id, item_type, item_key, item_label, period_label, sent_by, sent_by_name)
  values (s.client_id, 'other', 'ledger_review_summary', 'Ledger review summary',
          to_char(s.period, 'FMMonth YYYY'), v_by, coalesce(v_name, v_by));
end;
$$;

-- ===========================================================================
-- 14. Sign-off RPCs  (spec 4.4, 6.1, 6.4)
-- ===========================================================================
-- Any staff with access. Sets 'reviewed', records the open high-priority count,
-- ticks client_close_items 'ledger_reviewed' (the only way to tick it, see
-- gl-review-3-close.sql), and does CT_applyFirstTick's effect: when no other
-- step of the month was done and the month is not started, it moves to
-- In progress. Refused while the month is approved (an admin sends it back first).
create or replace function public.gl_review_mark_reviewed(p_client_id text, p_period date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := public.gl_review_require_staff(p_client_id);
  v_period date := public.gl_review_month(p_period);
  v_ym text := to_char(v_period, 'YYYY-MM');
  v_status text;
  v_high int;
  v_first boolean := false;
begin
  select status into v_status from public.gl_review_signoffs
   where client_id = p_client_id and period = v_period for update;
  if v_status = 'approved' then
    raise exception 'This month is already approved. An admin can send it back first.' using errcode = '22023';
  end if;

  select count(*) into v_high from public.gl_review_flags
   where client_id = p_client_id and period = v_period and severity = 'high' and status = 'open';

  insert into public.gl_review_signoffs as s (client_id, period, status, reviewed_by, reviewed_at, high_open_at_review)
  values (p_client_id, v_period, 'reviewed', v_email, now(), v_high)
  on conflict (client_id, period) do update
    set status = 'reviewed', reviewed_by = excluded.reviewed_by, reviewed_at = excluded.reviewed_at,
        high_open_at_review = excluded.high_open_at_review, approved_by = null, approved_at = null;

  perform set_config('app.gl_review_signoff', 'on', true);
  insert into client_close_items (client_id, period, item_key, done, done_by, done_at)
  values (p_client_id, v_ym, 'ledger_reviewed', true, v_email, now())
  on conflict (client_id, period, item_key) do update
    set done = true, done_by = excluded.done_by, done_at = excluded.done_at;
  perform set_config('app.gl_review_signoff', 'off', true);

  if not exists (select 1 from client_close_items
                 where client_id = p_client_id and period = v_ym and done and item_key <> 'ledger_reviewed') then
    insert into month_close as m (client_id, period, status)
    values (p_client_id, v_period, 'in_progress')
    on conflict (client_id, period_kind, period) do update set status = 'in_progress'   -- period_kind: added by tasks-p2-2-periods.sql
      where m.status = 'not_started';
    v_first := found;
  end if;

  perform public.gl_review_log(p_client_id, v_email, 'ledger_review_reviewed',
    jsonb_build_object('period', v_ym, 'high_open', v_high));
  return jsonb_build_object('status', 'reviewed', 'high_open_at_review', v_high, 'month_started', v_first);
end;
$$;

-- Admin only. reviewed -> approved. An admin may approve their own review
-- (owner decision 2026-10-14); reviewed_by and approved_by are both kept, and
-- the activity log notes self_approved.
create or replace function public.gl_review_approve(p_client_id text, p_period date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := public.gl_review_require_admin();
  v_period date := public.gl_review_month(p_period);
  s public.gl_review_signoffs;
begin
  perform public.gl_review_require_staff(p_client_id);
  select * into s from public.gl_review_signoffs
   where client_id = p_client_id and period = v_period for update;
  if s.client_id is null or s.status <> 'reviewed' then
    raise exception 'Only a month marked reviewed can be approved.' using errcode = '22023';
  end if;
  update public.gl_review_signoffs
     set status = 'approved', approved_by = v_email, approved_at = now()
   where client_id = p_client_id and period = v_period;
  perform public.gl_review_log(p_client_id, v_email, 'ledger_review_approved',
    jsonb_build_object('period', to_char(v_period, 'YYYY-MM'), 'reviewed_by', s.reviewed_by,
                       'self_approved', lower(coalesce(s.reviewed_by, '')) = v_email));
end;
$$;

-- Admin only, note required. reviewed / approved -> sent_back, clears the
-- approval and unticks the Close step.
create or replace function public.gl_review_send_back(p_client_id text, p_period date, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := public.gl_review_require_admin();
  v_period date := public.gl_review_month(p_period);
  v_note text := nullif(btrim(p_note), '');
  v_status text;
begin
  perform public.gl_review_require_staff(p_client_id);
  if v_note is null or length(v_note) > 1000 then
    raise exception 'A note (1 to 1,000 characters) is required.' using errcode = '22023';
  end if;
  select status into v_status from public.gl_review_signoffs
   where client_id = p_client_id and period = v_period for update;
  if v_status is null or v_status not in ('reviewed', 'approved') then
    raise exception 'Only a reviewed or approved month can be sent back.' using errcode = '22023';
  end if;
  update public.gl_review_signoffs
     set status = 'sent_back', sent_back_by = v_email, sent_back_at = now(), sent_back_note = v_note,
         approved_by = null, approved_at = null
   where client_id = p_client_id and period = v_period;

  perform set_config('app.gl_review_signoff', 'on', true);
  insert into client_close_items (client_id, period, item_key, done, done_by, done_at)
  values (p_client_id, to_char(v_period, 'YYYY-MM'), 'ledger_reviewed', false, null, null)
  on conflict (client_id, period, item_key) do update set done = false, done_by = null, done_at = null;
  perform set_config('app.gl_review_signoff', 'off', true);

  perform public.gl_review_log(p_client_id, v_email, 'ledger_review_sent_back',
    jsonb_build_object('period', to_char(v_period, 'YYYY-MM'), 'note', v_note));
end;
$$;

-- "Mark done anyway". warn mode: any staff with access, note optional.
-- block mode: admins only, note required. Recorded on the sign-off row
-- (override_gate = the mode it was made in) and in client_activity_log. The UI
-- then saves month_close as done. The block-mode trigger in
-- gl-review-3-close.sql accepts only an override_gate = 'block' override, so a
-- warn-era override never satisfies block mode (spec 4.4); an admin overrides
-- again after the switch. Reopening the month clears it.
create or replace function public.gl_review_override_done(p_client_id text, p_period date, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := public.gl_review_require_staff(p_client_id);
  v_period date := public.gl_review_month(p_period);
  v_note text := nullif(btrim(p_note), '');
  v_gate text;
  v_status text;
begin
  select done_gate into v_gate from public.gl_review_settings where id;
  v_gate := coalesce(v_gate, 'warn');
  if v_gate = 'block' then
    if not public.is_active_staff_admin() then
      raise exception 'Only an admin can override the ledger review.' using errcode = '42501';
    end if;
    if v_note is null then
      raise exception 'A reason is required.' using errcode = '22023';
    end if;
  end if;
  if length(v_note) > 1000 then
    raise exception 'The reason is too long (1,000 characters at most).' using errcode = '22023';
  end if;
  insert into public.gl_review_signoffs as s (client_id, period, override_by, override_note, override_at, override_gate)
  values (p_client_id, v_period, v_email, v_note, now(), v_gate)
  on conflict (client_id, period) do update
    set override_by = excluded.override_by, override_note = excluded.override_note,
        override_at = excluded.override_at, override_gate = excluded.override_gate
  returning s.status into v_status;
  perform public.gl_review_log(p_client_id, v_email, 'ledger_review_override',
    jsonb_build_object('period', to_char(v_period, 'YYYY-MM'), 'gate', v_gate, 'note', v_note,
                       'signoff_status', v_status));
end;
$$;

-- ===========================================================================
-- 15. Admin RPCs: watch list and settings  (spec 4.7, 4.9)
-- ===========================================================================
-- p_id null = add. Returns the id.
create or replace function public.gl_review_save_watch_vendor(
  p_id uuid,
  p_pattern text,
  p_category text default 'other',
  p_note text default null,
  p_active boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := public.gl_review_require_admin();
  v_pattern text := btrim(p_pattern);
  v_id uuid;
begin
  if v_pattern is null or length(v_pattern) < 2 or length(v_pattern) > 80 then
    raise exception 'The pattern must be 2 to 80 characters.' using errcode = '22023';
  end if;
  if coalesce(p_category, 'other') not in ('streaming', 'liquor', 'gambling', 'personal_payment', 'other') then
    raise exception 'Unknown category.' using errcode = '22023';
  end if;
  if p_id is null then
    insert into public.gl_review_watch_vendors (pattern, category, note, active)
    values (v_pattern, coalesce(p_category, 'other'), nullif(btrim(p_note), ''), coalesce(p_active, true))
    returning id into v_id;
  else
    update public.gl_review_watch_vendors
       set pattern = v_pattern, category = coalesce(p_category, 'other'),
           note = nullif(btrim(p_note), ''), active = coalesce(p_active, true)
     where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'Watch-list entry not found.' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end;
$$;

-- Any argument left null keeps its current value.
create or replace function public.gl_review_save_settings(
  p_done_gate text default null,
  p_pull_window text default null,
  p_effective_from date default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := public.gl_review_require_admin();
begin
  if p_done_gate is not null and p_done_gate not in ('warn', 'block') then
    raise exception 'done_gate is warn or block.' using errcode = '22023';
  end if;
  if p_pull_window is not null and p_pull_window not in ('rolling14', 'ytd') then
    raise exception 'pull_window is rolling14 or ytd.' using errcode = '22023';
  end if;
  insert into public.gl_review_settings (id) values (true) on conflict (id) do nothing;
  update public.gl_review_settings
     set done_gate = coalesce(p_done_gate, done_gate),
         pull_window = coalesce(p_pull_window, pull_window),
         effective_from = coalesce(date_trunc('month', p_effective_from)::date, effective_from)
   where id;
end;
$$;

-- ===========================================================================
-- 16. Service-role helpers for qbo-gl-review  (spec 2.6, 3.1, 4.5, 4.6)
-- ===========================================================================
-- Take the per-client pull lock (3-minute stale takeover). Returns
--   {status:'ok', pull_id, pulled_at}       lock taken; pulled_at = started_at
--   {status:'in_progress'}                  another pull is running
--   {status:'fresh', pull_id, pulled_at}    same window finished < 30 s ago and not p_force
create or replace function public.gl_review_pull_begin(
  p_client_id text,
  p_pulled_by text,
  p_window_kind text,
  p_window_start date,
  p_window_end date,
  p_force boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_at timestamptz;
  r public.gl_review_pulls;
begin
  if p_window_kind is null or p_window_kind not in ('rolling14', 'ytd', 'custom', 'baseline') then
    raise exception 'Unknown pull window.' using errcode = '22023';
  end if;
  insert into public.gl_review_pulls as g (client_id, pull_id, status, window_kind, window_start, window_end,
                                           started_at, finished_at, calls, line_count, error, pulled_by)
  values (p_client_id, gen_random_uuid(), 'running', p_window_kind, p_window_start, p_window_end,
          now(), null, 0, null, null, lower(nullif(btrim(p_pulled_by), '')))
  on conflict (client_id) do update
    set pull_id = excluded.pull_id, status = 'running', window_kind = excluded.window_kind,
        window_start = excluded.window_start, window_end = excluded.window_end,
        started_at = excluded.started_at, finished_at = null, calls = 0, line_count = null,
        error = null, pulled_by = excluded.pulled_by
    where not (g.status = 'running' and g.started_at > now() - interval '3 minutes')
      and (coalesce(p_force, false)
           or not (g.status = 'ok' and g.finished_at > now() - interval '30 seconds'
                   and g.window_kind is not distinct from excluded.window_kind))
  returning pull_id, started_at into v_id, v_at;
  if v_id is not null then
    return jsonb_build_object('status', 'ok', 'pull_id', v_id, 'pulled_at', v_at);
  end if;
  select * into r from public.gl_review_pulls where client_id = p_client_id;
  if r.status = 'running' then
    return jsonb_build_object('status', 'in_progress');
  end if;
  return jsonb_build_object('status', 'fresh', 'pull_id', r.pull_id, 'pulled_at', r.started_at);
end;
$$;

-- Release the lock with the outcome. A pull_id that is no longer current
-- (taken over after 3 minutes) changes nothing and returns false.
create or replace function public.gl_review_pull_finish(
  p_client_id text,
  p_pull_id uuid,
  p_status text,
  p_calls int,
  p_line_count int default null,
  p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_status is null or p_status not in ('ok', 'error') then
    raise exception 'status is ok or error.' using errcode = '22023';
  end if;
  update public.gl_review_pulls
     set status = p_status, finished_at = now(), calls = greatest(coalesce(p_calls, 0), 0),
         line_count = case when p_status = 'ok' then p_line_count end,
         error = case when p_status = 'error' then left(coalesce(nullif(btrim(p_error), ''), 'Pull failed'), 300) end
   where client_id = p_client_id and pull_id = p_pull_id and status = 'running';
  return found;
end;
$$;

-- Month fingerprints from one pull. Inserts a 'pull' print only when the hash
-- or basis differs from that month's latest 'pull' print.
-- p_prints: [{period, basis, line_count, debit_total, hash}]. Returns rows inserted.
create or replace function public.gl_review_record_prints(p_client_id text, p_prints jsonb, p_captured_by text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
begin
  if p_prints is null or jsonb_typeof(p_prints) <> 'array' or jsonb_array_length(p_prints) > 60 then
    raise exception 'prints must be an array of at most 60 months.' using errcode = '22023';
  end if;
  insert into public.gl_review_month_prints (client_id, period, kind, basis, line_count, debit_total, hash, captured_by)
  select p_client_id, x.period, 'pull', x.basis, x.line_count, x.debit_total, x.hash, left(p_captured_by, 200)
  from (
    -- one print per month per call (captured_at = now() is part of the unique key)
    select distinct on (date_trunc('month', r.period)::date)
           date_trunc('month', r.period)::date as period, r.basis, r.line_count, r.debit_total, lower(r.hash) as hash
      from jsonb_to_recordset(p_prints) as r(period date, basis text, line_count int, debit_total numeric, hash text)
     where r.period is not null
     order by date_trunc('month', r.period)::date
  ) x
  where not exists (
    select 1 from (
      select mp.hash, mp.basis from public.gl_review_month_prints mp
       where mp.client_id = p_client_id and mp.period = date_trunc('month', x.period)::date and mp.kind = 'pull'
       order by mp.captured_at desc limit 1
    ) latest
    where latest.hash = lower(x.hash) and latest.basis is not distinct from x.basis
  );
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Closed-month snapshot (spec 4.5 (b)): called right after a month is marked
-- Done. Refused unless month_close says done. Replaces any earlier baseline
-- for the month (re-closing a reopened month replaces it).
create or replace function public.gl_review_store_baseline(
  p_client_id text,
  p_period date,
  p_basis text,
  p_line_count int,
  p_debit_total numeric,
  p_hash text,
  p_lines jsonb,
  p_captured_by text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period date := public.gl_review_month(p_period);
  v_id uuid;
begin
  if not exists (select 1 from month_close where client_id = p_client_id and period_kind = 'month' and period = v_period and status = 'done') then
    raise exception 'A baseline is only stored for a month marked Done.' using errcode = '22023';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'lines must be an array.' using errcode = '22023';
  end if;
  delete from public.gl_review_month_prints
   where client_id = p_client_id and period = v_period and kind = 'baseline';
  insert into public.gl_review_month_prints (client_id, period, kind, basis, line_count, debit_total, hash, captured_by, lines)
  values (p_client_id, v_period, 'baseline', p_basis, p_line_count, p_debit_total, lower(p_hash),
          left(p_captured_by, 200), p_lines)
  returning id into v_id;
  return v_id;
end;
$$;

-- ===========================================================================
-- 17. Function grants
-- ===========================================================================
-- Browser (staff) RPCs: authenticated only. Each checks the caller itself.
do $$
declare f text;
begin
  foreach f in array array[
    'public.gl_review_upsert_flags(text, uuid, int, jsonb)',
    'public.gl_review_portal_addressees(text)',
    'public.gl_review_mark_fixed(text, uuid, int)',
    'public.gl_review_clear(uuid, text, text, boolean)',
    'public.gl_review_send_back_flag(uuid, text)',
    'public.gl_review_save_rule(text, text, text, text, text, text, text, jsonb, text, text, text)',
    'public.gl_review_set_rule_status(uuid, text)',
    'public.gl_review_save_summary(text, date, text, text, jsonb)',
    'public.gl_review_send_summary_portal(uuid, text[])',
    'public.gl_review_mark_reviewed(text, date)',
    'public.gl_review_approve(text, date)',
    'public.gl_review_send_back(text, date, text)',
    'public.gl_review_override_done(text, date, text)',
    'public.gl_review_save_watch_vendor(uuid, text, text, text, boolean)',
    'public.gl_review_save_settings(text, text, date)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  -- Edge functions only (service role).
  foreach f in array array[
    'public.gl_review_record_summary_email(uuid, text[], text)',
    'public.gl_review_pull_begin(text, text, text, date, date, boolean)',
    'public.gl_review_pull_finish(text, uuid, text, int, int, text)',
    'public.gl_review_record_prints(text, jsonb, text)',
    'public.gl_review_store_baseline(text, date, text, int, numeric, text, jsonb, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- ===========================================================================
-- 18. qbo_connections.token_refresh_at  (spec 3.2)
-- ===========================================================================
-- The token-refresh lock. qbo-sync, qbo-refresh-token and qbo-gl-review take
-- it with a conditional UPDATE ... WHERE token_refresh_at is null or older
-- than 60 seconds ... RETURNING (the acquireSyncLock pattern), hold it only
-- around the Intuit token call + qbo_store_tokens, then set it back to null.
-- A caller that can't take it waits 2 s (up to 3 tries) and re-reads the
-- stored tokens instead of refreshing. Not sync_started_at (spec 3.2).
alter table public.qbo_connections add column if not exists token_refresh_at timestamptz;

-- ===========================================================================
-- 19. client_profile: greeting name and contact email  (spec 4.10)
-- ===========================================================================
-- Covered by the existing "staff manage client profile" policy
-- (staff + can_access_client). Not on clients (spec 0.2 item 2).
alter table public.client_profile add column if not exists greeting_name text;
alter table public.client_profile add column if not exists contact_email text;
alter table public.client_profile drop constraint if exists client_profile_greeting_name_len;
alter table public.client_profile add constraint client_profile_greeting_name_len
  check (greeting_name is null or length(greeting_name) between 1 and 80);
alter table public.client_profile drop constraint if exists client_profile_contact_email_check;
alter table public.client_profile add constraint client_profile_contact_email_check
  check (contact_email is null
         or (contact_email = lower(contact_email)
             and length(contact_email) <= 254
             and contact_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'));

-- Trim, blank -> null, lowercase the email, so the check above rarely bites.
create or replace function public.client_profile_normalize_contact()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.greeting_name := nullif(btrim(new.greeting_name), '');
  new.contact_email := lower(nullif(btrim(new.contact_email), ''));
  return new;
end;
$$;
revoke all on function public.client_profile_normalize_contact() from public, anon, authenticated;
drop trigger if exists client_profile_normalize_contact on public.client_profile;
create trigger client_profile_normalize_contact
  before insert or update on public.client_profile
  for each row execute function public.client_profile_normalize_contact();

-- ===========================================================================
-- 20. client_email_log accepts the gl-review-send emails  (spec 3.3)
-- ===========================================================================
-- Feature list = the latest repo definition (staff-handbook.sql, 2026-10-14)
-- + the two new values. Any later file that redoes this check must keep them.
alter table public.client_email_log drop constraint if exists client_email_log_feature_check;
alter table public.client_email_log add constraint client_email_log_feature_check check (feature in (
  'doc_chaser', 'value_report', 'staff_client_message', 'staff_doc_upload', 'staff_task_assigned',
  'staff_task_due', 'staff_feedback_status', 'client_message', 'client_reports_ready', 'staff_tech_request',
  'handbook_sign_needed', 'handbook_countersign_needed',
  'gl_review_question', 'gl_review_summary'
));
-- trigger: client-emails.sql allows cron / test / preview; a staff-clicked send is 'manual'.
alter table public.client_email_log drop constraint if exists client_email_log_trigger_check;
alter table public.client_email_log add constraint client_email_log_trigger_check
  check (trigger in ('cron', 'test', 'preview', 'manual'));

commit;
