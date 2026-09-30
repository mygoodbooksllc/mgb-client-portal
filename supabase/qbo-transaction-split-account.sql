-- Applied to production 2026-09-30 as migration qbo_transaction_split_account.
--
-- The posting ("split") account of each register transaction: the
-- TransactionList report's "Split" column (split_acc), e.g. "Office
-- Supplies" on a debit-card purchase. The Bank Accounts page uses it as the
-- transaction's Category and filters by it (components/client/BankAccounts.jsx
-- via components/qbo/mapQboToClient.js).
--
-- Nullable and appended last, so it is backward compatible: qbo_replace_rows
-- (qbo-replace-rows.sql) fills it through jsonb_populate_recordset, and a
-- qbo-sync build that doesn't send it yet simply leaves it null. The app then
-- shows the transaction Type and "Uncategorized" until the updated qbo-sync is
-- deployed and the client's next scheduled sync runs. A multi-line
-- transaction reports "-Split-" here; the app treats that as "Split".

alter table public.qbo_transactions add column if not exists split_account text;
