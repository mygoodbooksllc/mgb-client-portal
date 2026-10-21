# Slate month rhythm, slice 2: the firm_part due rule

Written 2026-10-21. Parent docs: `docs/slate-month-rhythm.md`, `docs/slate-month-rhythm-build-plan.md`,
`docs/slate-rhythm-slice-1.md` (the `month_rhythm` setting and `tk_month_rhythm()`). Additive only.
Database and shared logic only. Nothing is visible to staff or clients.

## What ships

1. **New due rule type**, shared by JS and SQL:

   ```json
   { "type": "firm_part", "part": "check_in|reports|follow_up", "month_offset": 0 }
   ```

   - `part` is required and must be one of the three rhythm part keys.
   - `month_offset` is optional and follows the same rule as `day_of_month` (a whole number
     from 0 to 12; missing or null means 1).
   - Other fields are ignored, the same as for the other rule types.

2. **Validation.** `TK_dueRuleValid` / `tk_due_rule_valid(jsonb)` accept the shape above. The SQL
   function backs the `task_templates_due_rule_check` CHECK, so the new body is a strict
   superset. Only two things change: `firm_part` joins the `month_offset` type list, and it
   gains its own branch. Every old rule type takes the same code path as before.

3. **Resolving (JS).** `TK_resolveDue(rule, start, end, holidays, rhythm)` takes an optional
   fifth argument. Calls with four arguments behave exactly as before. A firm_part rule
   resolves as `day_of_month` with `day` = the rhythm part's day and `roll` = the rhythm's
   roll. It fails closed:
   - no rhythm throws `tk_month_rhythm_missing`;
   - an invalid rhythm throws `tk_month_rhythm_invalid: <code>`, with the same codes as
     `TK_rhythmProblem`.

4. **Resolving (SQL).**
   - New `tk_resolve_due(rule, start, end, rhythm jsonb)`, which raises the same errors.
   - The old 3-arg `tk_resolve_due` gets one early branch. For firm_part it reads
     `tk_month_rhythm()` (the firm value; not the hook, which signed-in users cannot run) and
     passes the result to the 4-arg form. All other types run the old body unchanged.
   - Under a client JWT, RLS hides `tk_settings`, so this read returns the default rhythm.
     That is harmless: clients never run the generator or see templates.

5. **Slice 5 hook.** `tk__rhythm_for_client(p_client_id text)` (stable, security invoker) returns
   `tk_month_rhythm()` for now. Slice 5 replaces its body to apply a per-client override. Its
   callers do not change.

6. **Generator gate.** `tk__generate` is patched at 4 anchors, and `tk__issue_period` at 1:
   - With `month_rhythm_enabled` off or missing (the default), firm_part templates are
     skipped before any period is built. Nothing is listed or created, and there is no warning.
   - When it is on, the run reads the rhythm once per client through the hook. If that read
     returns NULL, the client's firm_part templates are skipped and one warning is added for
     the run: "Month rhythm tasks were skipped because the month rhythm setting could not be
     read. An admin can save it again in Settings."
   - Old rule types never reach the new code.

7. **No table, RLS or cron change.** The cron job and its arguments are unchanged.

## Why nothing changes in production yet

- Today no template has a firm_part rule, and the switch is off.
- The template editor does not offer the rule:
  - `TK_TPL_RULES_BY_CADENCE` does not list it;
  - `TK_tplValidate` rejects it;
  - `TK_tplUpcoming` returns null.

  Slice 3 adds the editor UI and is the first point where a firm_part task can exist.

## Proof (2026-10-21, production, rollback-style)

- **Validator.** Old and new `tk_due_rule_valid` gave identical results on a corpus of 359,813
  inputs (33,697 valid under the old function, all still valid). The only new passes are the
  432 firm_part shapes.
- **Resolver.**
  - Inputs: 1,338 rules (a 1/25 hash sample plus every live template rule), 8 periods each.
  - Comparison: the old and new 3-arg forms, and the 4-arg form with a null, default and
    garbage rhythm.
  - Result: 10,704 pairs, all identical. 456 pairs raise in both versions (see follow-ups).
- **Shared vectors.** 51 vectors: 32 rhythm cases and 19 rule vectors (`frv_`). They pass in
  node and in `supabase/slate-rhythm-2-firm-part-tests.sql`. `tk_recurrence_selftest()` still
  returns no rows.
- **Generator.**
  - Before and after the apply, these gave byte-identical output: a single-template preview of
    all 755 templates on two dates, the test clients' runs, and the roster dry run.
  - Live template dues: 0 of 17,784 differ. Would create today: 0.
- **Self-test.** A temporary firm_part template:
  - is skipped with the switch off;
  - follows the default rhythm with the switch on (2026-10-14);
  - follows a changed rhythm (2026-10-15);
  - is skipped with exactly one warning when the hook returns NULL.

## Rollback

1. Re-create the old `tk_due_rule_valid` and the 3-arg `tk_resolve_due`. Verbatim copies are
   `pg_temp.old_due_rule_valid` and `pg_temp.old_resolve_due` in the tests file.
2. Undo the 5 anchor replacements in `tk__generate` and `tk__issue_period`. Each anchor's old
   text is in the migration.
3. Drop the 4-arg `tk_resolve_due` and `tk__rhythm_for_client`.


This is safe only while no template uses `firm_part`, because the CHECK would reject such rows.

## Self-critique

- **Risk: the CHECK constraint function changed.** Mitigation: an md5 guard on the old body,
  plus the 359,813-input equivalence run. The new body only adds branches.
- **Risk: firm_part reaching `tk__issue_period` from another caller.** `tk__issue_period`
  already reads the hook itself, but before review it had no switch check (so
  `tk_issue_missed`, the admin Issue button on a missed period, could create a firm_part task
  with the switch off) and a NULL rhythm raised out of it. Fixed in review by
  `supabase/slate-rhythm-2b-issue-gate.sql` (applied 2026-10-21, self-test
  `slate-rhythm-2b-issue-gate-tests.sql`): a real write with the switch off returns
  `skipped / rhythm_off` (test and internal clients excepted, as in `tk__generate`), and no
  usable rhythm returns `skipped / no_rhythm`. Dry runs are not gated. Generator output is
  byte-identical before and after. Copy for both reasons is in `TK_TPL_SKIP_TEXT`.
- **Gap: no browser check.** Nothing is visible, so there is nothing to click.
- **Pre-existing, not this slice:** `{"type":"day_of_month","day":1.0}` passes the validator
  but raises in `tk_resolve_due`'s `::int` cast. The old and new versions behave the same
  (the 456 raising pairs). JS reads 1.0 as 1, so the UI never sends it. Follow-up: tighten
  the validator to whole JSON integers, or round in the resolver.
