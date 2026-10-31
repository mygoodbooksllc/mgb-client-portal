# supabase/migrations

Security-audit database changes, one file per change, applied once in
filename order. Every file here is already live (applied 2026-10-26 through the
Supabase MCP `apply_migration`, same names in `supabase_migrations`).

Applied earlier, on 2026-10-12, and recorded only in `supabase_migrations`:
`m4_staff_must_sign_in_with_google`, `h1a`/`h1b`/`h1c` (deactivated staff lose
access through is_active_staff / can_access_client / is_conversation_member and
the activity-log policy).

| File | Finding |
|---|---|
| 20261026170000_m5_server_tables | M5, L2, L5: tables qbo-sync and invite-client-user use for rate limits and private error details |
| 20261026170100_m2_own_rows_need_active_staff | M2: own tasks/reminders and time entries need active staff |
| 20261026170200_w1_m1_full_access_tools_and_share_links | W-20261019-1, M1: Pro tools need full access; share-link tokens made and locked by the server |
| 20261026170300_l11_l12_access_links | L11, L12: access-request links expire after 30 days; server-made tokens; access_link_info |
| 20261026170400_l13_realtime_topics | L13: staff can only join their own private Realtime topics |
| 20261026170500_w2_task_owner_needs_active_staff | W-20261019-2: tk_row_readable checks active staff first |

A new private Realtime channel needs its topic added to
`realtime_topic_allowed()` (20261026170400), or it silently fails to join.

Still open, deliberately not applied here:
- H1 clean-up trigger (deleting a deactivated person's assignments and
  sessions). Access is already cut by the h1 helpers; the trigger would delete
  data, so it waits for an explicit decision.
- L14 (revoking anonymous EXECUTE on helper functions), L6 (Vault key), L10
  (infra links table), L15 (milestone notes table), CORS `*` (L19).
