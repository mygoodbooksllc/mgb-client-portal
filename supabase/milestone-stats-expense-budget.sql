-- Applied to production 2026-09-30 as migration milestone_stats_expense_budget.
--
-- client_milestone_stats (client-milestones.sql) fixes:
--
-- qbo_budget_total summed EVERY QuickBooks Budget line, and qbo-sync pulls
-- income lines too (a church budgets its giving). Budgeted giving plus
-- budgeted spending roughly doubled the "annual operating budget" and could
-- push a client up a pricing milestone. It now counts expense lines only: a
-- line is left out when its account (matched by name, or by the last segment
-- of a "Parent:Child" name) is an Income / Other Income account in
-- qbo_accounts, or, failing an account match, when qbo_pl_lines only ever
-- saw that name on the income side.
--
-- expenses_12m: qbo-sync keeps 11 closed months plus the current partial
-- month, so "the last 12 complete months" was really 11 months of expenses
-- and read ~8% low. It is now annualized: the average closed month in the
-- last 12, times 12. Null when there are no closed months.
--
-- Same signature and grants; safe to re-run.

create or replace function public.client_milestone_stats(p_client_ids text[])
returns table (
  client_id text,
  tx_90d bigint,
  qbo_budget_total numeric,
  expenses_12m numeric,
  last_synced_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    c.id,
    (select count(*) from qbo_transactions t
      where t.client_id = c.id and t.txn_date > current_date - 90),
    (select sum(b.budgeted) from qbo_budget_lines b
      where b.client_id = c.id
        and b.fiscal_year = (select max(b2.fiscal_year) from qbo_budget_lines b2 where b2.client_id = c.id)
        and not coalesce(
          (select bool_or(a.account_type in ('Income', 'Other Income'))
             from qbo_accounts a
            where a.client_id = b.client_id
              and (a.name = b.account_name
                   or a.name = regexp_replace(b.account_name, '^.*:', ''))),
          (select bool_and(l.account_type = 'Income')
             from qbo_pl_lines l
            where l.client_id = b.client_id
              and l.account_name = b.account_name),
          false)),
    (select round(avg(p.expenses) * 12, 2) from qbo_monthly_pl p
      where p.client_id = c.id
        and p.month >= (date_trunc('month', current_date) - interval '12 months')::date
        and p.month < date_trunc('month', current_date)::date),
    (select max(t.updated_at) from qbo_transactions t where t.client_id = c.id)
  from unnest(p_client_ids) as c(id);
$$;

revoke all on function public.client_milestone_stats(text[]) from public, anon;
grant execute on function public.client_milestone_stats(text[]) to authenticated;
