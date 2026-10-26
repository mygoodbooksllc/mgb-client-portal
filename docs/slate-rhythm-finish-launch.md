# Slate month rhythm finish: launch kit (PUBLISHED 2026-10-25)

**PUBLISHED 2026-10-25:** month_rhythm_enabled is on; the guide, notice (`month-rhythm-launch`), tour, tips, What's new and MGB_VERSION shipped in one commit. Kept as the source of record; do not re-apply.

Drafted 2026-10-23 (mgb-launch-kit). Covers E1/E2 (email drafts), S6 (Close order view) and S7 (Pre-fill by client
type). Nothing in this file is wired into the app. On launch day, when the owner turns on `month_rhythm_enabled`,
ship this together with `docs/slate-rhythm-slice-3-launch.md`:

- the guide text from `docs/staff-guide/drafts/month-rhythm-emails-close-order-prefill.txt`;
- the notices and tours below, in the same commit as the guide;
- the tips and the What's new line.

## Next-visit notice (everyone with month rhythm tasks)

Title: Client emails, ready to copy

Body: Check in, Send reports and Follow up tasks now come with a draft client email built from the client's data.
Open the task and choose Draft email, or click the envelope in a list. Nothing is sent: you copy it into your own
email. A client's list also has a new Month view, Close order, that shows the month's steps in order with a Next
pill.

Buttons: Show me (starts the tour) · Later

## Next-visit notice (admins, extra line)

Add to the admin version: "On Slate › Recurring, Pre-fill by client type makes draft Quarterly and Annual
templates for churches, nonprofits and for-profit clients."

## Tour (everyone, on a client's task list)

1. `data-tour="tk-email-draft"` (the envelope on a row with an email task): "This task comes with a client email.
   Click to open the draft, edit it and copy it. Slate never sends it."
2. `data-tour="tk-close-order"`: "Month view: The thirds groups by part of the month; Close order shows each
   month's steps in the order you work them. Your choice, per client."

Needs a client list with a month rhythm email task on screen; if none, skip step 1 (the tour runner skips a
missing target).

## Tour (admin, on Slate › Recurring)

1. `data-tour="tk-optc"`: "Pre-fill makes draft Quarterly and Annual templates for one client type. Drafts never
   make tasks until you activate them. Filings stay on Work › Deadlines."

## Tips (while learning)

- `data-tour="tk-email-draft"`: "Draft email builds from the latest data each time you open it. Start over
  rebuilds it."
- `data-tour="tk-close-order"`: "Close order is only your view. It turns off while you sort by a column or use
  Board."

## What's new (at launch only)

"Month rhythm tasks come with a draft client email to copy (nothing is sent), and a client's list can show the
month in close order. Admins can pre-fill Quarterly and Annual draft templates by client type."

## Before launch

- Re-point tour and tip targets if the client list toolbar or the Recurring page layout changes.
- Move the guide draft into the live guide (do not apply guide SQL to live rows while the feature is hidden).
- Bump MGB_VERSION and add the Dev Tools PAGE_META note.
- Activate (or delete) any Pre-fill drafts once their clients and dates are checked.
