-- Applied to production 2026-09-30 as migration qbo_doc_number.
--
-- QuickBooks' own bill/invoice number (DocNumber). Before this the app had
-- no number to show and invented "Bill #<internal id>", which matched
-- nothing the client could look up in QuickBooks. qbo-sync fills these on
-- its next run (supabase/functions/qbo-sync/index.ts); until then they stay
-- null and the app shows no number rather than a made-up one.

alter table public.qbo_invoices add column if not exists doc_number text;
alter table public.qbo_bills add column if not exists doc_number text;
