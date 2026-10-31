# Archived SQL files: do not run

Security audit 2026-10-05, finding M8. These files were written as "safe to
re-run", but they recreate older policies that only check `is_active_staff()`.
Running one again (during a restore or a fresh setup) would either replace the
per-client hardened policy of the same name or add a broader policy beside it
(policies are OR'd), giving every bookkeeper every client's private notes,
documents and live invite tokens.

| File | What re-running it would undo |
| --- | --- |
| `client-private-notes.sql` | replaces the scoped private-notes policy |
| `client-documents.sql` | replaces the scoped documents policy |
| `qbo-connections.sql` | replaces the scoped QuickBooks connections policy |
| `qbo-connect-state.sql` | replaces the connect-state policy (direct insert is now revoked; use `qbo_connect_start()`) |
| `access-requests.sql` | adds unscoped policies that expose every live invite token |
| `client-notes.sql` | adds an unscoped client-notes policy |
| `client-status-overrides.sql` | adds an unscoped status-overrides policy |
| `enterprise-upgrade-requests.sql` | adds an unscoped upgrade-requests policy |

The live database (project `xumsqmhccgfjnlmieqyu`) is the source of truth for
these tables' policies. New database changes go in `supabase/migrations/` as
`<timestamp>_<name>.sql`, applied once, in order.
