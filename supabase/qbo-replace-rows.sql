-- Atomic per-table swap for qbo-sync (supabase/functions/qbo-sync/index.ts,
-- replaceRows). The sync used to delete a client's rows and then insert the
-- fresh ones as separate API calls, so a page load or report pulled in that
-- gap saw an empty table. With the sweep moving to every 5 minutes
-- (qbo-sync-cron-5min.sql) that gap would be hit far more often. This does
-- the delete and the insert in one transaction: readers see the old rows
-- until the new ones commit, never nothing.
--
-- service_role only (qbo-sync's admin client). The table name is checked
-- against the fixed list of synced tables before it reaches format(%I), and
-- every row must carry the same client_id being replaced.
-- Rows missing updated_at get now(), matching the column default that
-- jsonb_populate_recordset would otherwise bypass (it yields NULL).

create or replace function public.qbo_replace_rows(
  p_table text,
  p_client_id text,
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
  if p_table not in (
    'qbo_accounts', 'qbo_monthly_pl', 'qbo_pl_lines', 'qbo_budget_lines',
    'qbo_invoices', 'qbo_bills', 'qbo_transactions'
  ) then
    raise exception 'qbo_replace_rows: table % not allowed', p_table;
  end if;
  if jsonb_typeof(rows_in) <> 'array' then
    raise exception 'qbo_replace_rows: rows must be a JSON array';
  end if;
  if exists (
    select 1 from jsonb_array_elements(rows_in) e
    where e ->> 'client_id' is distinct from p_client_id
  ) then
    raise exception 'qbo_replace_rows: row client_id mismatch';
  end if;

  select coalesce(jsonb_agg(
           case when e ? 'updated_at' then e
                else e || jsonb_build_object('updated_at', now()) end
         ), '[]'::jsonb)
    into rows_in
    from jsonb_array_elements(rows_in) e;

  execute format('delete from %I where client_id = $1', p_table)
    using p_client_id;
  execute format(
    'insert into %I select * from jsonb_populate_recordset(null::%I, $1)',
    p_table, p_table
  ) using rows_in;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.qbo_replace_rows(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.qbo_replace_rows(text, text, jsonb) to service_role;
