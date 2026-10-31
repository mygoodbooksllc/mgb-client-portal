# Master Data fee sync (spec, 2026-10-31)

Owner-approved design. INTERNAL-ONLY like the rest of profitability.

## Goal
Keep `client_fees.monthly_fee` in step with the Google Sheet **MGB_Master_Data**
(Drive id `1y6Tw4GDZWxpD20UfHKVLUvuej1q2abUQ1FaZRYfrPR8`), tab **Clients**,
header row 4, data from row 5. Columns found by header text (not letter):
`Client`, `Status`, and the fee column picked by one constant:
`FEE_COLUMN = "2027"` -> header `Bookkeeping fee 2027` (flip to `"now"` ->
`Bookkeeping fee now`) in `supabase/functions/master-sheet-sync/logic.js`.
If any of the three headers is missing the run errors and changes nothing.

## Pieces
- **Edge function `master-sheet-sync`** (verify_jwt off, in-function auth).
  Actions: `status` (connected? service-account email, last runs; no writes),
  `preview` (dry run: reads sheet, returns the plan + a SHA-256 `fingerprint` of
  the changes, logs a `dry_run` run, writes no fee), `sync` (live; a person must
  send the preview's fingerprint, and if the sheet or fees moved since, the run
  logs `changed_since_preview` and writes nothing). Cron body
  `{"trigger":"cron","action":"sync"}` (machine callers only) = live, but only
  after a manual live run with the same fee column has succeeded (else logs
  `skipped`), and it is `held` (nothing written) if it would change more than 10
  fees or move any fee by more than 50%.
- **Auth**: machine = service-role key or Vault `qbo_cron_key` (same as
  weekly-admin-digest). Person = their Supabase JWT, then
  `can_view_internal()` called AS THEM (it includes `is_active_staff_admin()` and
  the Google-login check). Anything else: 401/403, nothing read or written.
- **Google**: secret `GOOGLE_SA_KEY` = the read-only service account's JSON key.
  Token scope `spreadsheets.readonly`. The sheet is shared with the service
  account email as Viewer. Without the secret: status `not_connected`, nothing
  changes. Never the publish-to-web link.
- **Pure logic** `logic.js` (+ `logic.test.js`): money parsing, name
  normalization, status rules, header lookup, the plan, JWT signing.

## Rules (the plan)
- Rows read = rows with a non-blank Client name.
- Name match: `norm(s) = lowercase, drop every non a-z0-9` (same in JS
  `normName` and SQL `master_sheet_norm`; no accent folding, so they always agree).
  Map table first (`master_sheet_client_map`, keyed by normalized sheet name),
  else exact normalized name equality with one portal client. Two portal clients
  with the same normalized name = ambiguous = unmatched (never guessed). No
  fuzzy/substring matching (Pathway Community Church never matches The Way).
- Map rows may say `ignored` (not a client): counted as skipped, not unmatched.
- Status (trimmed, any case): `Active` may write. `Lost` / `Paused` / `Gone`
  never change a fee (logged as skipped). Blank/other status: skipped.
- Fee: number or money text (`$3,000.00`, `3000`, `$ 1,200`). Blank, `-`, `TBD`,
  `#N/A`, negative, `(100)`, zero, or over 100,000 = no usable fee -> skipped;
  NEVER clears or zeroes an existing fee. Rounded to cents.
- `test_only` and `is_internal` clients: skipped.
- Fee row with `sheet_override = true`: skipped (admin override).
- Two sheet rows landing on the same client: error for that client, no write.
- Unmatched Active/other rows go to `master_sheet_unmatched` (rebuilt on each
  live run) and show in the UI; never written.
- Sanity: fewer than 5 data rows read = error, nothing written.

## Database (`supabase/master-sheet-sync.sql`)
- `client_fees` + `source` ('manual' | 'master_sheet', default manual),
  `sheet_override boolean default false`, `synced_at timestamptz`.
- `master_sheet_client_map(sheet_key pk, sheet_name, client_id -> clients,
  ignored, note, updated_by, updated_at)`; check `ignored or client_id not null`.
  Seeds: Life Church Danville -> life-church, City House Church, Milwaukee ->
  city-house-church, Compassion Church AZ -> compassion-church, The Way
  Community Church -> the-way.
- `master_sheet_sync_runs` (log): trigger, mode, status, requested_by, counts
  (rows_read, updated, unchanged, unmatched, skipped, errors), fee_column,
  detail jsonb (per-row outcome), started/finished.
- `master_sheet_unmatched(sheet_key pk, sheet_name, status, fee_text, last_run_id,
  first_seen_at, last_seen_at)`.
- `master_sheet_apply(p_run_id, p_items jsonb, p_unmatched jsonb default '[]',
  p_rebuild_unmatched boolean default false)` SECURITY DEFINER, execute granted
  to service_role only, one transaction + advisory lock. Per item upsert with guards
  (fee still equals the planned `from`, not overridden); fee change sets
  `source='master_sheet'`, `synced_at`, `updated_by='master-sheet-sync'`; same
  fee just stamps `source/synced_at` (no audit row). Sets
  the whole `request.jwt.claims` JSON (`email = master-sheet-sync`) and clears
  `request.jwt.claim` for the transaction so the
  existing `audit_row_change()` trigger writes `client_fee.set/changed` with actor
  `master-sheet-sync` (details gain `source`). Override on/off is audited as
  `client_fee.sheet_override_on/off`.
- RLS: all three tables readable only with `is_active_staff_admin() and
  can_view_internal()`; map writable by the same; runs/unmatched written only by
  the service role. anon revoked.
- Guard trigger `client_fees_sheet_guard` (people only: `current_user` is
  `authenticated`/`anon`): a person can't set `source`/`synced_at`; changing the
  fee of a synced row turns `sheet_override` on (so the sync never fights an
  admin); deleting a synced, non-overridden row is refused (turn Override on
  first). Rollback SQL is in the migration header.
- Cron `master-sheet-sync-nightly` 08:20 UTC -> `master_sheet_cron_tick()`
  which posts only when a successful manual live run exists.

## UI (TeamProfit.jsx, only when TP_PF_canSee)
- Status strip above the Clients table (next to the profit summary): last sync
  time + trigger, counts, unmatched list with "Match to client" / "Not a
  client", Preview changes, Sync now (confirm), "not connected yet" state with
  plain steps + the service-account email once the key exists.
- Client fee card: synced fee is read-only with "Synced from Master Data" and
  last synced time; "Override" (clearly labeled: stops the sync for this client)
  opens the editor and saves with `sheet_override=true`; "Resume sync" turns it
  off. Fee tag "Master Data" in tables.

## Not in scope
No write-back to the sheet. No What's new entry (Jesse must not read it). Owner
creates the service account and sets the secret.
