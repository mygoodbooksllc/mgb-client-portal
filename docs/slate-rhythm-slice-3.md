# Slate month rhythm, slice 3: the eight monthly templates

Written 2026-10-21. Parent docs: `docs/slate-month-rhythm.md`, `docs/slate-month-rhythm-build-plan.md`,
`docs/slate-rhythm-slice-1.md` (the `month_rhythm` setting), `docs/slate-rhythm-slice-2.md` (the
`firm_part` due rule and the issue gate). Additive only. Real clients get nothing until the owner
turns on `month_rhythm_enabled`. Staff see nothing new unless they have Month rhythm preview on.

## What ships

1. **Seed: the MGB Month Rhythm set** (`supabase/slate-rhythm-3-templates.sql`). This is a new
   `tk_template_sets` row (`is_standard` false, `gate_key` `month_rhythm_enabled`) with eight
   templates. All eight have:
   - cadence monthly, due rule `{"type":"firm_part","part":…,"month_offset":1}`;
   - status active, assignee role bookkeeper, priority normal;
   - `source` `standard`, `source_ref` `month_rhythm:<n>_<part>`;
   - close_key NULL, every plan and client;
   - a description and the checklist suggested in `docs/slate-month-rhythm.md`.

   | # | Part (lead days) | Title | SOP | email_kind |
   | --- | --- | --- | --- | --- |
   | 1 | Check in (3) | Check in with the client about last month | | |
   | 2 | Check in (3) | Ask for missing documents | | request |
   | 3 | Check in (3) | Categorize the bank feed through month end | bank_feeds | |
   | 4 | Check in (3) | Note what is still missing | | |
   | 5 | Send reports (10) | Finish the month with the documents received | monthly_close | |
   | 6 | Send reports (10) | Send reports: full if complete, preliminary if documents are missing | reporting | reports |
   | 7 | Follow up (10) | Follow up on missing documents | | maintenance |
   | 8 | Follow up (10) | Finish and send full reports once documents arrive | reporting | |

   Rows 7 and 8 are always created. Auto-completing them when nothing is missing is slice 4.

   A partial unique index on (set, source_ref) for standard rows makes a re-run insert nothing.

2. **New columns** (nullable or with a default, so every existing row keeps its meaning):
   - `task_templates.email_kind`: `request`, `reports` or `maintenance`, for the email drafts in
     slice E1/E2. The editor shows it and never sends it.
   - `task_templates.description`: up to 2000 characters, copied onto each new task.
   - `tk_template_sets.gate_key`: `standard_set_live` (default, every existing set) or
     `month_rhythm_enabled`.

3. **Gate per set.** `tk__generate` reads each set's `gate_key`. Existing sets still follow
   `standard_set_live` and the close opt-in, exactly as before. The rhythm set follows
   `month_rhythm_enabled`. Named test and internal clients pass either way, like every other
   set. The slice 2 `firm_part` gate in `tk__generate` and `tk__issue_period` stays, so there
   are two locks.

4. **live_since per set.** `tk_settings_set_live_since` stamps only the sets whose `gate_key`
   is the key being turned on. Turning on `month_rhythm_enabled` starts rhythm tasks from that
   day, with no back-fill.

5. **Task fields.** `tk__issue_period` writes the template description, and for a
   `firm_part` task `section` = the part label from the rhythm ("Check in", "Send reports",
   "Follow up"). Slate's Part of month grouping reads that section. For every other template
   both fields are NULL, the column default.

6. **Saving.** `tk_save_template` accepts `description`. A payload without that key leaves it
   as it is.

7. **Close overlaps.** `tk_close_optin_status` leaves rhythm templates out of the overlap list
   while the switch is off. Without that, the word "bank" in row 3 would flag every client.

8. **Slate › Recurring** (`TK_Templates.jsx`, `TK_templateLogic.js`, `TK_api.js`):
   - **With `TK_rhythmEnabled()` off:** `TK_tplHideRhythm` leaves out the rhythm set, its
     templates and any `firm_part` template, and the rule menu is the old list. The page is
     what it was.
   - **With it on (preview or switch):**
     - The rhythm set shows as its own group with a note: "Test clients only" until the switch
       is on, then "Live for real clients".
     - Rows read "Monthly · On the Send reports date (14th), next month", with an email-kind
       tag on rows 2, 6 and 7.
     - The editor offers **A month rhythm date**: pick the part, then which month. The help
       line says "Dates come from Settings › Firm settings › Month rhythm."
     - The editor has a Description field and a read-only email draft line.
     - The next-dates preview uses the firm rhythm.
     - Weekly templates never offer the rhythm rule.
   - **One client panel:**
     - A rhythm template on a real client reads "Waits for the owner to turn on month rhythm
       tasks" until the switch is on.
     - The close opt-in period floor no longer applies to rhythm templates. The server never
       applied it.

## Why nothing changes in production yet

- `month_rhythm_enabled` is unset (owner-only, never set by code).
  - The daily cron runs with no client, so it covers the roster only, and roster clients fail
    the set gate.
  - `tk__issue_period` refuses a real `firm_part` write too (slice 2b).
- Test and internal clients (mygoodbooks, basic-test, grace-community) get rhythm tasks only when
  an admin presses **Make due tasks now** for one of them. Their dry runs already list the
  rhythm rows.
- The templates page hides everything new unless the viewer has Month rhythm preview on.

## Proof (2026-10-21, production)

- **Baseline before applying:** dry-run `tk__generate` md5 at 2026-10-21, 2026-11-05 and
  2026-11-25, for the roster (no client) and each of the three test clients. Also: a
  single-template preview over all 755 older templates on two dates, and close opt-in
  overlaps for every client.
- **After applying:**
  - Roster output is byte-identical on all three dates.
  - For the test clients, output with the rhythm entries removed equals the baseline. Rhythm
    entries on 10-21: 2 would, 8 upcoming. On 11-05: 6 would, 8 upcoming, 2 missed. On 11-25:
    2 would, 8 upcoming, 8 missed. Dry runs only.
  - The single-template preview over the 755 older templates is identical on both dates
    (8907c388…, 906ab10c…).
  - Close opt-in overlaps are identical (732bc796…).
  - Older template rows are untouched (max `updated_at` still 2026-10-16).
- **Function settings:** ACLs, SECURITY DEFINER and search_path are unchanged on all five
  patched functions. Advisors show nothing new.
- **Self-test** (`slate-rhythm-3-templates-tests.sql`, ends in rollback): `SELFTEST_OK`. It
  covers:
  - the seed shape;
  - idempotency, including the unique violation;
  - switch off: roster runs list no rhythm templates, a test client sees 8, and a real issue
    returns `rhythm_off`;
  - switch on: the trigger stamps only the rhythm set, and a roster client sees 8 October
    entries with the resolver's dues (2026-11-04, 2026-11-13, 2026-11-24 with roll `prev`);
  - a real issue on all 8 gives the right section, description and checklist, while an
    ordinary template still gets NULL section and description;
  - `tk_save_template` saves, keeps and clears the description, and edits the rule part, run
    as an admin.
- **After the test:**
  - 0 rhythm tasks exist;
  - the switch is unset;
  - the rhythm set's `live_since` is NULL;
  - 763 templates.
- **JS:** `TK_templateLogic.test.js` has six new tests (49 in all). They cover:
  - rule lists unchanged when off;
  - the rule text, with and without a rhythm;
  - the preview with a rhythm (Sep 2026 due 10-14, Oct 2026 due 11-13 with roll `prev`), and
    null without one;
  - `TK_tplHideRhythm`;
  - payloads for older templates have no new keys;
  - the seed SQL titles, parts and email kinds.

  All 38 `*.test.js` files pass, and every source file in `index.html` compiles with Babel.

## Rollback

From the SQL header, in this order:

1. Swap each anchor pair (to -> from) with `pg_temp.patch_fn`.
2. Delete the rhythm templates that issued nothing. If tasks were issued, retire them instead.
   Then delete the empty set.
3. Drop `task_templates_std_ref_uniq` and the three columns.

The JS needs no rollback. With the switch and preview off it draws exactly the old page. If
needed, revert the four JS files.

## Self-critique

- **RLS:** no new table. The new columns sit on tables whose policies already limit reads to
  staff. Clients never read `task_templates` or the internal task list. The three columns are
  selectable by `authenticated` only through those policies.
- **Owner rule (no late tasks while waiting on clients):**
  - Rows 2, 7 and 8 depend on the client.
  - Nothing is made for real clients in this slice, so no late counts change.
  - The late-count exclusion for waiting-on-client tasks lands in slice 4, and it must land
    before the switch is turned on.
- **Overlap with the standard close set:**
  - Rows 3 and 5 cover the same work as the close set's bank feed and close steps.
  - While the rhythm switch is off this does not matter.
  - Before launch, decide whether the close set is retired, or the rhythm replaces it for
    clients who get both. Otherwise opted-in clients get duplicates.
  - The overlap warning comes back once the switch is on.
- **Launch timing:**
  - Live roll is `prev`. Turning the switch on mid-month makes every part date from that day
    on. For example, turning it on Oct 21 makes the September-period Follow up rows (due
    Oct 23) at once.
  - Turning it on right after the 24th avoids a burst.
- **Fixed lead days:** lead days (3, 10, 10) do not follow a changed rhythm. If an admin moves
  Send reports to the 20th, rows 5 and 6 still show 10 days early.
- **Single-template preview:** it bypasses the gates. That is by design, and it is a dry run.
- **Readings of "yes":** `TK_rhythmFlagValueOn` (UI) and `tk__jsonb_bool` (server) read `"yes"`
  differently. This predates slice 3. The page uses `TK_tplBool` (the server's reading) for
  the "Live for real clients" note, so the note always matches the generator.
- **Override modal:** with the rhythm on, an admin can give one client a rhythm rule. The
  server gates it the same way.
- **Not verified:** the page has not been checked in a browser. Checked so far: Babel compile,
  node tests and SQL. It needs a look on the deployed preview with Month rhythm preview on and
  off.

## Independent review (2026-10-21)

Checked live on production with `month_rhythm_enabled` unset. All checks were dry runs or ran
inside a transaction that rolled back.

- **Zero rhythm tasks for real clients.**
  - Generator dry runs for the roster and each of the 61 real clients, on 10-21, 11-05, 11-25
    and 12-20 (horizon 120): no rhythm entries in would create, upcoming, skipped or missed.
  - A real (not dry) `tk__issue_period` for all 8 templates on every real client: 488 of 488
    returned `rhythm_off`.
  - With `standard_set_live` also simulated on: still no rhythm entries.
  - The other paths:
    - Asana import makes only its own templates (source `asana`, no set).
    - `tk_issue_missed` goes through `tk__issue_period`.
    - No onboarding or set-apply path makes tasks.
    - No edge function makes tasks.
    - The only cron job is `tk_generate()` for the roster.
- **Older output unchanged.**
  - The pre-slice `tk__generate` was rebuilt in `pg_temp` (the two anchors reversed). Its
    output was compared with the live function for the roster and all 64 clients on the four
    dates: 260 runs, 0 differences once the rhythm rows were taken out.
  - With the standard switch simulated on: 124 runs, and the raw md5 was identical.
- **Columns.**
  - The three columns, their check constraints, the description length limit, the `gate_key`
    check and the partial unique index all reject bad values.
  - Re-running the DDL, seed and patches in a transaction changed nothing: 763 templates,
    2 sets, function bodies and template rows identical by md5.
  - The self-test passed again.
- **Access.**
  - Clients cannot read `task_templates` or `tk_template_sets`. Both are staff-only by RLS,
    and only `authenticated` has SELECT.
  - Task rows are readable only by staff (`tk_row_readable`).
  - `month_rhythm_enabled` is owner-only (`tk__owner_only_key`).
  - Advisors: nothing new.
- **UI fix (additive).**
  - With month rhythm off, the client panel's "Next 60 days" dry run for a test client listed
    the 8 rhythm rows. So did the Missed periods list, once a test client had missed rhythm
    periods.
  - Both now leave out the hidden templates. When the rhythm is on, or nothing is hidden,
    nothing changes.
- **Duplicate-task risk with the standard close set.** This is latent today: no client is
  opted in, there are no close tasks, and `standard_set_live` is unset.
  - Row 3 (bank feed) repeats close step `bank_feed`.
  - Row 5 covers `bank_rec`, `card_rec`, `entries` and `review`. Its checklist names the
    same four steps.
  - Row 6 repeats `sent`, a draft close template.
  - The close-dup guard in `tk__issue_period` does not catch any of these, because it keys
    on `close_key` and rhythm rows have none.
  - Once month rhythm is on, the overlap warning in `tk_close_optin_status` flags row 3
    ("bank") but not row 5: "Finish the month" matches none of rec, bank, card or close.
  - Duplicates would happen for:
    - a client opted in to the close set, or every client if `standard_set_live` is on,
      while month rhythm is on;
    - test clients today, when an admin presses Make due tasks now: they pass both gates.
  - The 749 inactive Asana draft templates also overlap if they are turned on: about
    100 bank, 130 close, 144 report and 92 document titles.
  - Decide before the switch: retire the close set for rhythm clients, or skip close
    templates for clients on the rhythm.
