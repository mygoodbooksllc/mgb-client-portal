# Slate month rhythm, slice 1: the firm rhythm setting and its editor

Written 2026-10-21. Parent docs: `docs/slate-month-rhythm.md` (value shape and validation),
`docs/slate-month-rhythm-build-plan.md` (slice table). Additive only.

## What ships

1. **`tk_settings` key `month_rhythm`** (jsonb, admin write, audited by the existing
   `tk_settings_after_write` trigger into `tk_settings_audit`):

   ```json
   { "parts": [ { "key": "check_in",  "label": "Check in",     "day": 4 },
                { "key": "reports",   "label": "Send reports", "day": 14 },
                { "key": "follow_up", "label": "Follow up",    "day": 24 } ],
     "roll": "next" }
   ```

   No row is seeded. Missing means the default above (4th, 14th, 24th, roll next).

2. **Validation, the same rules in JS and SQL** (`TK_rhythmProblem` /
   `tk_month_rhythm_problem(jsonb)`; shared vectors in `components/tasks/TK_rhythm.fixtures.js`,
   asserted in node and in `supabase/slate-rhythm-1-settings-tests.sql`):
   - an object with a `parts` array of exactly three items, keys `check_in`, `reports`,
     `follow_up` in that order (each once);
   - each `day` a JSON integer 1 to 28 (no strings, no fractions);
   - days strictly ascending in that order;
   - `label`, when present, a non-empty string of at most 40 characters (missing label = the
     default label; the editor never changes labels, the owner called them final);
   - `roll` one of `next`, `prev`, `none` (required);
   - other fields are ignored (room for later slices), not rejected.

3. **DB-side guard.** `tk_settings` had no per-key validation, so the migration adds one new,
   separate trigger `tk_settings_check_month_rhythm` (BEFORE INSERT OR UPDATE). It only looks at
   rows whose key is `month_rhythm` (on UPDATE it checks `old.key`, because the existing
   before-write trigger pins the key, so firing order does not matter) and raises
   `tk_month_rhythm_invalid: <reason>` (errcode 22023). The existing triggers are not changed.

4. **Reader for later slices.** `tk_month_rhythm()` (stable, security invoker, so RLS applies):
   the stored value when valid, the default when the row is missing, NULL when the stored value
   is somehow invalid (fail closed; the trigger makes that impossible for new writes).
   JS twin: `TK_rhythmResolve(value)` returns `{ rhythm, source: "firm" | "default" | "invalid",
   problem }`.

5. **Firm switch and preview** (later slices gate on them; nothing in this slice is gated):
   - `tk_settings.month_rhythm_enabled`, code never sets it; added to the owner-only key list
     (`tk__owner_only_key`, same as `wb_enabled`, `nav_enabled`, `lato_enabled`), so only the
     owner (or a no-JWT SQL session with `mgb.tk_owner_override = 'on'`) can flip it.
   - per-person checkbox `mgb_rhythm_preview` ("Month rhythm preview") in `FEATURE_FLAGS`.
   - ONE helper: `TK_rhythmEnabled()` (browser) over the pure `TK_rhythmIsOn(settingValue,
     previewOn)`. The setting is read once by `TK_rhythmLoad()`; until then it answers from the
     preview alone. Same truthy rules as `WB_flagValueOn` (true, "true", 1, {on:true}).

6. **Editor.** Settings › Firm settings, a "Month rhythm" card right after the Late tasks card
   (the other Slate setting there). Admins only (`isAdmin`, same as Late tasks; temporary admins
   do not see it, matching the RLS write policy `is_active_staff_admin`). Visible whatever the
   switch says; the copy says it only stores the dates until monthly tasks are turned on.
   Three day pickers (1 to 28), a "Weekend or firm holiday" select
   (next business day / business day before / keep the date), Save rhythm, Use 4th, 14th, 24th,
   inline errors from `TK_rhythmFromForm`, and "Last changed <date> by <who>" from the row.
   Note: changing the dates affects tasks generated afterwards only (stated in the card).

7. **Dev Tools.** `month_rhythm` and `month_rhythm_enabled` rows in the Slate switches list
   (the rhythm row shows "4th, 14th, 24th · next business day", not `[object Object]`), the
   flag in `FEATURE_FLAGS`, a migration note in the infra list, `MGB_VERSION` 2026-10-21g.

## Critique (self-review) and fixes

- **RLS**: no new table; `tk_settings` RLS unchanged (staff read, admin insert/update, no
  delete). The new trigger function is not security definer and reads nothing.
- **Trigger order**: Postgres runs BEFORE triggers by name; `tk_settings_before_write` resets
  `new.key := old.key` on UPDATE. Checking `old.key` on UPDATE avoids a hole where a key rename
  plus bad value could slip past. Covered by a test.
- **JSON integers**: JS `JSON.parse("4.0")` is 4, SQL keeps `4.0` numeric equal to its trunc,
  so both accept it. Strings like `"4"` are rejected in both. Covered by vectors.
- **Rollback**: drop the trigger and the three functions, restore the owner-only list without
  `month_rhythm_enabled`; no data to undo (no row seeded).
- **Parity**: one fixtures file; the node test asserts every fixture id and JSON literal appears
  in the SQL self-test, and the SQL self-test asserts each vector's verdict.
- **Old behavior**: nothing reads the setting yet; Slate is unchanged for everyone.
- **No staff notice or tour**: admin-only settings card; there is no cheap registry for
  admin-only notices. What's new carries an admin-only note.

## Independent review fix (2026-10-21)

- **Label parity**: SQL used `\s` and `char_length`, JS used `String.trim()` and UTF-16 length,
  so they disagreed on U+FEFF, U+0085 and emoji labels (21 emoji passed in SQL, failed in JS).
  Both now use one explicit blank set and count code points: `TK_RHYTHM_BLANK_RE` in
  `TK_rhythmLogic.js`, `v_blank` in `supabase/slate-rhythm-1b-label-parity.sql` (applied to
  production 2026-10-21). Vectors r28-r33 added to the fixtures and the SQL self-test (33 total).
  The UI never edits labels, so this only mattered for direct API writes.
- The trigger function `tk_settings_check_month_rhythm` lost its default PUBLIC execute grant,
  like the other `tk_settings` trigger functions (the trigger still fires for admin writes).
