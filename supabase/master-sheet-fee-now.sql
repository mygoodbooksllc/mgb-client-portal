-- Master Data fee sync: the portal holds TODAY's fee (owner decision 2026-11-02).
-- Spec: docs/master-sheet-sync-spec.md (section "Which column").
--
-- The column switch itself is code, not SQL: FEE_COLUMN = "now" in
-- supabase/functions/master-sheet-sync/logic.js (deploy master-sheet-sync).
-- This file only holds the one data change that goes with it.
--
-- Applied to production 2026-11-02 as migration master_sheet_fee_now_tampa_override.
-- Safe to re-run.
--
-- Tampa Design Company stays at its current portal fee for now (owner
-- decision C), whatever the sheet's "now" column says later. The existing
-- per-client Override (client_fees.sheet_override) is the mechanism: the sync
-- (planSync and master_sheet_apply) skips a client whose override is on.
-- The fee value is NOT changed here.
--
-- Rollback (or when the owner wants Tampa to follow the sheet again): click
-- "Resume sync" on Tampa's row in Pricing & fees, or
--   update client_fees set sheet_override = false where client_id = 'tampa-design-company';

begin;

update public.client_fees
   set sheet_override = true
 where client_id = 'tampa-design-company'
   and sheet_override = false;

commit;
