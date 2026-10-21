# Slate month rhythm, slice 5: per-client rhythm override

Written 2026-10-21. Plan: `docs/slate-month-rhythm-build-plan.md` row 5 and owner decision 3 in
`docs/slate-month-rhythm.md`. Additive only. The UI is behind `TK_rhythmEnabled()` (preview
`mgb_rhythm_preview` or the firm switch `month_rhythm_enabled`). With no override saved (the
state today), every resolver returns exactly what it returned before.

## What ships

1. **Column `client_profile.rhythm jsonb null`.** Same shape as `month_rhythm.parts`: an array of
   three `{ "key", "day" }` items, keys `check_in`, `reports`, `follow_up` in that order, days 1 to
   28 strictly ascending. `null` means the client uses the firm rhythm.
   - Only the three days are per client (owner decision 3: "override the three days"). The part
     labels and the weekend or holiday roll always come from the firm setting, so section names
     and grouping stay the same for every client.
   - Labels inside the array are tolerated by the validator (it is the firm validator) but the
     RPC strips them, and the merge ignores them.

2. **Validation, the same as the firm setting.** `tk_client_rhythm_problem(jsonb)` returns
   `tk_month_rhythm_problem(jsonb_build_object('parts', p, 'roll', 'next'))`, or null for SQL
   NULL / JSON null. JS twin `TK_clientRhythmProblem(v)` calls `TK_rhythmProblem` the same way.
   Same problem codes and copy.

3. **Merge (pure, JS and SQL, shared vectors).** `TK_rhythmForClient(firm, client)` /
   `tk_month_rhythm_merge(firm jsonb, client jsonb)`:
   - firm missing or invalid -> null (fail closed; nothing to take the roll and labels from);
   - client null or JSON null -> the firm value unchanged;
   - client invalid -> null (fail closed: never silently fall back to the firm days for a client
     an admin gave its own days);
   - otherwise `{ parts: [ { key, label (only when the firm part has one), day: client day } x3 ],
     roll: firm roll }`.
   Vectors in `components/tasks/TK_rhythmClient.fixtures.js`, run in node and copied into
   `supabase/slate-rhythm-5-client-override-tests.sql` (the node test checks every row is there).

4. **Resolver order: client, then firm, then fail closed.** The slice 2 hook
   `tk__rhythm_for_client(p_client)` now returns
   `tk_month_rhythm_merge(tk_month_rhythm(), <that client's client_profile.rhythm>)`. Its callers
   are unchanged and already cover every firm_part resolution on the server:
   - `tk__generate` (cron, Make due tasks now, all dry runs and the 60-day preview);
   - `tk__issue_period` (due date and the section label; `tk_issue_missed` goes through it);
   - `tk_rhythm_daily` (the 24th auto-complete and the second-month notice) does not resolve a
     day at all: it reads each task's `due_date`, which the generator already set from the
     client's rhythm. No change needed (checked: no hard-coded 4/14/24 or +1 day in SQL).
   The 3-arg `tk_resolve_due` keeps reading the firm value (signed-in users cannot run the hook;
   no client task is resolved through it).

5. **Write path: admins only.**
   - RPC `tk_set_client_rhythm(p_client_id text, p_parts jsonb)` SECURITY DEFINER:
     `is_active_staff_admin() and can_access_client(p_client_id)` or `tk_forbidden` (42501);
     unknown client `tk_unknown_client`; `p_parts` null / JSON null clears; otherwise keeps only
     `key` and `day` of each part, validates (`tk_month_rhythm_invalid: <code>`, 22023) and
     upserts `client_profile (rhythm, updated_by, updated_at)`. Returns `{client_id, rhythm}`.
     Granted to authenticated only.
   - Trigger `client_profile_rhythm_guard` (BEFORE INSERT OR UPDATE OR DELETE) for direct table
     writes: an unchanged value passes; a change (or deleting a row that has an override) by a
     JWT session that is not `is_active_staff_admin()` raises `tk_forbidden`; a changed value is
     validated. No-JWT server sessions pass (same rule as the hours budget guard). Bookkeepers'
     Overview "Edit dates and coverage" save sends named fields only, never `rhythm`, so it is
     unaffected.
   - Audit: `client_rhythm_audit` (client_id, old_value, new_value, changed_by, changed_at),
     AFTER trigger on every change; RLS on, admins read, nobody writes directly.

6. **Read path.** `client_profile` RLS is staff only (`is_active_staff() and
   can_access_client`) plus the internal-company lock. Clients have no policy, so they cannot
   read any column of it, including `rhythm`. Checked: no view selects from `client_profile`;
   the SECURITY DEFINER functions that join it name columns (none returns `cp.*`, `to_jsonb(cp)`
   or `rhythm`); `client_org_settings` (the client Organization tab) does not read it; the only
   `select("*")` is `staffToolsApi.profile` (staff Overview); edge functions select named
   columns. So no view or column grant is needed. Bookkeepers can read the override (they see
   it on the client's Settings tab), but not change it.

7. **JS.**
   - `TK_clientRhythmProblem`, `TK_rhythmForClient`, `TK_clientRhythmFromForm`,
     `TK_clientRhythmSummary` in `TK_rhythmLogic.js` (pure, tested).
   - `TK_api.clientRhythm(clientId)` (select `rhythm` from `client_profile`) and
     `TK_api.setClientRhythm(clientId, partsOrNull)` (the RPC).
   - Recurring page, client panel: while `TK_rhythmEnabled()`, it loads the client's override and
     passes `TK_rhythmForClient(firm, override)` as `rhythm` to `TK_tplUpcoming`,
     `TK_dueRuleText` and the per-client Change modal, so "Next: ... due ..." and the rule text
     use the client's days. Off: no extra read, the firm value as before.
   - Client Settings tab (staff, "Access and details"): a "Month rhythm" row, only while
     `TK_rhythmEnabled()`: "Uses the firm rhythm (4th, 14th, 24th)" or "Own rhythm: 5th, 15th,
     25th (weekends and holidays follow the firm setting)". Admins (real admins, not View as)
     get Change: three day pickers, Save, and "Use the firm rhythm" (clear). Errors show the same
     copy as the firm editor.

8. **Downstream consumers checked.**
   - Preliminary and two-months-running logic (slice 4) works on periods and due dates, not on
     days, so an override needs nothing there.
   - Slate grouping (slice 0) uses part labels, which come from the firm, so it is unchanged.
   - Email drafts (E1, not built yet): client-facing dates must be the part day plus one from
     `TK_rhythmForClient(firm, override)`, never a hard-coded 5th/15th/25th. Noted for E1.
   - The only remaining literal "4th, 14th, 24th" is the firm editor's "Use 4th, 14th, 24th"
     reset button (the default), which is correct.

## Proof plan

- Before applying: dry-run `tk__generate` md5 for the roster and every client on 2026-10-21,
  11-05, 11-25 and 12-20 (260 runs). After applying: identical (no override exists).
- Self-test (rolls back): vectors, write rules as real roles (admin yes; bookkeeper with access,
  client user and anon no; delete guard; direct admin update validated), client user reads
  nothing from `client_profile`, audit rows, and a test client with an override gets its
  rhythm rows on the client's days while non-rhythm output is byte-identical.

## Rollback

1. Re-create `tk__rhythm_for_client` with body `select public.tk_month_rhythm();`.
2. Drop the RPC, the triggers `client_profile_rhythm_guard` and `client_profile_rhythm_audit`,
   their functions, `tk_month_rhythm_merge`, `tk_client_rhythm_problem` and the table
   `client_rhythm_audit`.
3. `alter table client_profile drop column rhythm` (only after the hook is back to the firm body).
4. JS: revert the files listed in the slice notes.

## Self-critique (fixed above)

- Column grants would have broken every staff `select("*")` on `client_profile`; not needed
  because clients have no row access at all.
- A bookkeeper could have cleared an override by deleting the profile row (the existing policy
  allows staff delete): the guard covers DELETE.
- `client_profile` has no foreign key to `clients`: the RPC checks the client exists.
- An invalid stored override could have quietly used the firm days: the merge fails closed, and
  the generator then skips that client's firm_part templates with its existing warning.
- Labels per client would change section names and grouping: labels stay firm-wide.
- Temporary admins cannot set an override (`is_active_staff_admin` excludes them), the same as
  the firm setting.
