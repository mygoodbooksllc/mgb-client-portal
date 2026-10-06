-- Full-year giving by donor from QuickBooks, for year-end giving statements
-- (Pro Giving & Funds -> Tax Documents). 2026-10-06.
--
-- Status: Applied to production 2026-10-06 (migration qbo_donor_gifts).
-- Safe to re-run. Depends on qbo-data.sql (can_access_client),
-- staff-schema.sql (is_active_staff) and client-scope-rls.sql
-- (my_unscoped_client_ids).
--
-- Why: Tax Documents used to total donors from qbo_transactions, which only
-- holds about the last 90 days, so a statement was never a full year.
--
-- qbo-sync now pulls ONE GeneralLedger report per client per calendar year
-- (Jan 1 - Dec 31), restricted to the client's income accounts (Income and
-- Other Income), with the date, type, number, name (customer / payer =
-- donor), memo and amount columns. One row per gift line lands here:
--
--   qbo_donor_gifts        client_id, year, txn date, donor name (blank =
--                          no name in QuickBooks), QuickBooks name id when
--                          the report carries one, amount, account (the
--                          fund / giving account), txn type, doc number,
--                          memo. Lines of the same transaction, account and
--                          donor are summed into one gift.
--   qbo_donor_gift_pulls   one row per client per year: when it was last
--                          pulled and how many rows came back ("as of last
--                          sync" on the page, and the refresh schedule).
--
-- Every income account is stored, not just the giving ones; the browser keeps
-- only the client's giving accounts (client.givingQbo.accounts: the staff pick
-- in client_giving_accounts, or auto-detect). That way changing the pick takes
-- effect at once without another Intuit call.
--
-- Refresh (qbo-sync): the current year at most once a day, or on Sync now;
-- the previous year once a day through February 15 (January statements and
-- late entries), then only if it was never pulled. So 1-2 Intuit calls per
-- client per day, counted in qbo_api_usage like every other call, and
-- skipped with the rest of the scheduled sync at the usage hard stop.
--
-- RLS: staff read through can_access_client(). Client users read only when
-- they're unscoped for that client with no categories AND no funds list
-- (my_unscoped_client_ids(true), the same rule as client_giving_accounts):
-- category- or fund-limited users never see donor data. No anon access, no
-- browser writes: qbo-sync writes through qbo_replace_donor_gifts(),
-- SECURITY DEFINER and service_role only. Read-only toward QuickBooks.

begin;

create table if not exists public.qbo_donor_gifts (
  client_id     text    not null,
  year          integer not null,
  line_key      text    not null,
  txn_date      date    not null,
  donor_name    text,
  donor_qbo_id  text,
  amount        numeric(14,2) not null default 0,
  account_name  text,
  account_qbo_id text,
  txn_type      text,
  txn_qbo_id    text,
  doc_number    text,
  memo          text,
  updated_at    timestamptz not null default now(),
  primary key (client_id, year, line_key),
  constraint qbo_donor_gifts_year check (year between 2000 and 2100),
  constraint qbo_donor_gifts_date_in_year check (extract(year from txn_date) = year)
);

create index if not exists qbo_donor_gifts_client_year_idx
  on public.qbo_donor_gifts (client_id, year, donor_name);

create table if not exists public.qbo_donor_gift_pulls (
  client_id  text    not null,
  year       integer not null,
  pulled_at  timestamptz not null default now(),
  row_count  integer not null default 0,
  primary key (client_id, year)
);

alter table public.qbo_donor_gifts enable row level security;
alter table public.qbo_donor_gift_pulls enable row level security;

drop policy if exists "staff read qbo_donor_gifts" on public.qbo_donor_gifts;
create policy "staff read qbo_donor_gifts" on public.qbo_donor_gifts
  for select to authenticated
  using ((select public.is_active_staff()) and public.can_access_client(client_id));

drop policy if exists "client reads own qbo_donor_gifts" on public.qbo_donor_gifts;
create policy "client reads own qbo_donor_gifts" on public.qbo_donor_gifts
  for select to authenticated
  using (client_id = any ((select public.my_unscoped_client_ids(true))::text[]));

drop policy if exists "staff read qbo_donor_gift_pulls" on public.qbo_donor_gift_pulls;
create policy "staff read qbo_donor_gift_pulls" on public.qbo_donor_gift_pulls
  for select to authenticated
  using ((select public.is_active_staff()) and public.can_access_client(client_id));

drop policy if exists "client reads own qbo_donor_gift_pulls" on public.qbo_donor_gift_pulls;
create policy "client reads own qbo_donor_gift_pulls" on public.qbo_donor_gift_pulls
  for select to authenticated
  using (client_id = any ((select public.my_unscoped_client_ids(true))::text[]));

revoke all on public.qbo_donor_gifts from anon, authenticated;
revoke all on public.qbo_donor_gift_pulls from anon, authenticated;
grant select on public.qbo_donor_gifts to authenticated;
grant select on public.qbo_donor_gift_pulls to authenticated;

-- Atomic per client + year swap, the qbo_replace_rows() pattern: delete and
-- insert in one transaction, so a reader mid-sync sees the previous year's
-- rows, never none. Also stamps qbo_donor_gift_pulls.
create or replace function public.qbo_replace_donor_gifts(
  p_client_id text,
  p_year integer,
  p_rows jsonb
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
  rows_in jsonb := coalesce(p_rows, '[]'::jsonb);
begin
  if p_year is null or p_year not between 2000 and 2100 then
    raise exception 'qbo_replace_donor_gifts: bad year';
  end if;
  if jsonb_typeof(rows_in) <> 'array' then
    raise exception 'qbo_replace_donor_gifts: rows must be a JSON array';
  end if;
  if exists (
    select 1 from jsonb_array_elements(rows_in) e
    where e ->> 'client_id' is distinct from p_client_id
       or (e ->> 'year')::integer is distinct from p_year
  ) then
    raise exception 'qbo_replace_donor_gifts: row client_id / year mismatch';
  end if;

  select coalesce(jsonb_agg(
           case when e ? 'updated_at' then e
                else e || jsonb_build_object('updated_at', now()) end
         ), '[]'::jsonb)
    into rows_in
    from jsonb_array_elements(rows_in) e;

  delete from public.qbo_donor_gifts where client_id = p_client_id and year = p_year;
  insert into public.qbo_donor_gifts
    select * from jsonb_populate_recordset(null::public.qbo_donor_gifts, rows_in);
  get diagnostics n = row_count;

  insert into public.qbo_donor_gift_pulls as p (client_id, year, pulled_at, row_count)
  values (p_client_id, p_year, now(), n)
  on conflict (client_id, year)
  do update set pulled_at = excluded.pulled_at, row_count = excluded.row_count;

  return n;
end;
$$;

revoke all on function public.qbo_replace_donor_gifts(text, integer, jsonb) from public, anon, authenticated;
grant execute on function public.qbo_replace_donor_gifts(text, integer, jsonb) to service_role;

commit;
