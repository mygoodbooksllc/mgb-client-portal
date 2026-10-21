# Slate month rhythm, slice 3: launch kit draft (not live)

Drafted 2026-10-21 (mgb-launch-kit step 5). Nothing in this file is wired into the app. On launch day, when the
owner turns on `month_rhythm_enabled`:

- add the notice and the tour in the same commit as the guide article;
- add the tip;
- add the What's new line.

The launch should also bundle slice 4, so the late-count exclusion is live first.

## Next-visit notice (admins and account managers)

Title: Month rhythm tasks are on

Body: Slate now makes the monthly Check in, Send reports and Follow up tasks for every client. They are due on
the dates in Settings › Firm settings › Month rhythm. Tasks waiting on a client do not count as late.

Buttons: Show me (starts the tour) · Later

## Next-visit notice (bookkeepers)

Title: Your monthly tasks follow the month rhythm

Body: Each client now gets Check in, Send reports and Follow up tasks every month. Today groups them by part of
the month. Tasks waiting on a client do not count against you.

Buttons: Show me · Later

## Tour (admin, on Slate › Recurring)

1. `data-tour="tk-recurring-rhythm"`: "These eight templates follow the firm's month rhythm. Each one is due on
   its part's date in the month after the one it covers."
2. `data-tour="tk-recurring-list"`: "Open a template to change its checklist, description or which part of the
   month it follows."
3. The Settings › Firm settings › Month rhythm row: "Change the days here. The next tasks use the new dates."

## Tour (bookkeeper)

The bookkeeper tour targets Today's Rhythm step grouping. That grouping ships in a later slice, so it is
drafted there, not here.

## Tip (admin, while learning)

Target `data-tour="tk-recurring-rhythm"`: "Month rhythm templates take their dates from Settings. Change the
rhythm once instead of editing each template."

## What's new (at launch only)

"Slate makes monthly Check in, Send reports and Follow up tasks for every client, due on the firm's month rhythm
dates."

## Before launch

- Re-point the tour and tip targets if the Recurring layout changes.
- Move `docs/staff-guide/drafts/month-rhythm-templates.txt` and `month-rhythm-due-rule.txt` into the live guide.
- Bump MGB_VERSION and add the Dev Tools PAGE_META note.
