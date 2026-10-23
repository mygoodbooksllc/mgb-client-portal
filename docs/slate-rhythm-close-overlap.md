# Month rhythm: overlap with the standard close set (before-flip item a)

Written 2026-10-23. Migration `supabase/slate-rhythm-4d-close-overlap.sql`, self-test
`supabase/slate-rhythm-4d-close-overlap-tests.sql` (all ok, rolled back, 2026-10-23).

## The overlap

| Rhythm row | Close set step (close_key, due) |
| --- | --- |
| 3. Categorize the bank feed through month end (4th) | bank_feed (business day 5) |
| 5. Finish the month with the documents received (14th) | bank_rec, card_rec (bd 8), entries (bd 10), review (bd 12) |
| 6. Send reports, full or preliminary (14th) | sent (bd 15, a draft: never issued) |

A client with both would get two tasks for one step, on two different dates. The
close set's review step (about the 16th) also lands after the rhythm's 14th Send reports.

Today no client can get both: `standard_set_live` is unset and `tk_client_close_optin` has
0 rows. The overlap only matters after a flip.

## Decision (recommended, owner pre-approved)

**The month rhythm replaces the close set's task-making.** Once the owner turns on
`month_rhythm_enabled`, any real client the rhythm reaches stops getting the close set's
five step tasks, whether the set is live or the client is opted in. Nothing else changes:

- The Close checklist (Close tab, `close_checks`, `client_close_items`) still works by hand.
- With the rhythm off, every result is unchanged (dry-run md5 identical on four dates).
- Named test clients still get both, so the owner can compare them side by side.
- A client that every rhythm template skips (per-client skip) keeps the close steps.
- Opt-in panel: rhythm templates are never listed as an overlap, and a note says the rhythm
  now makes this client's month-end tasks (`rhythm_replaces` from `tk_close_optin_status`).

Rejected: (1) keep both and dedupe by date (two sources of truth for one step);
(2) drop rows 3 and 5 from the rhythm (the owner called the eight rows final);
(3) link rhythm rows to close keys so ticking the Close tab moves them (bigger change; can be
added later by setting `close_key` on rows 3 and 5 if staff ask).

## Before-flip item c: roll "prev" (report only, nothing changed)

`tk_settings.month_rhythm` was saved once, by an admin on 2026-10-21 16:13 UTC (audit row 104,
first insert), with `"roll":"prev"`. The spec default is `"next"`. Days are 4, 14, 24.
Effect: a part date on a weekend or holiday moves to the business day before, not after.
Example already live: the September follow-up rows on the test client fell on Friday
2026-10-23 because 24 October is a Saturday.

The 8 rhythm tasks that exist are all on the test client, made 2026-10-21 19:54 UTC
("Make due tasks now"); rows 7 and 8 for September are already done by the daily job.
No other client has rhythm tasks. The owner should confirm "prev" is intended before the
flip, or save "next" in Settings, Tasks, Month rhythm.
