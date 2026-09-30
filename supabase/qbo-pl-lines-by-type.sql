-- qbo_pl_lines: key by account type as well as account name (2026-09-30).
--
-- Status: Applied to production 2026-09-30
-- Safe to re-run. Depends on qbo-data.sql. Deploy qbo-sync v9 (or later)
-- after this file: v9 can write an Income and an Expense line with the same
-- account name for the same month, which the old key rejected.
--
-- Why: QuickBooks P&L lines are leaf account names, and one company can have
-- an income sub-account and an expense sub-account with the same short name
-- (the Intuit sample company has "Plants and Soil" etc. under both Landscaping
-- Services income and Job Materials expense). With the old key
-- (client_id, month, account_name) the sync merged the two into one line
-- tagged with whichever section came first, so the expense side vanished
-- into income: August 2026 expense lines summed $321.61 short of
-- qbo_monthly_pl. The Live Report's "Where the money went" card reads these
-- lines (mapQboToClient's expenseByAccount), so they need to add up.
--
-- No RLS change: the existing staff / client read policies on qbo_pl_lines
-- (qbo-data.sql) are unchanged, and qbo_pl_lines is already on the
-- qbo_replace_rows() allow-list.

begin;

update qbo_pl_lines set account_type = 'Expense' where account_type is null;
alter table qbo_pl_lines alter column account_type set not null;

do $$
begin
  if exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.qbo_pl_lines'::regclass
      and c.contype = 'p'
      and pg_get_constraintdef(c.oid) <> 'PRIMARY KEY (client_id, month, account_type, account_name)'
  ) then
    alter table qbo_pl_lines drop constraint qbo_pl_lines_pkey;
  end if;
  if not exists (
    select 1 from pg_constraint c
    where c.conrelid = 'public.qbo_pl_lines'::regclass and c.contype = 'p'
  ) then
    alter table qbo_pl_lines
      add constraint qbo_pl_lines_pkey primary key (client_id, month, account_type, account_name);
  end if;
end $$;

commit;
