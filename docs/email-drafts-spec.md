# Monthly email drafts (4th / 14th / 24th), spec

Status: draft for owner approval, 2026-10-20. No code, SQL or commits until approved.
Source of the wording: Google Doc "BOOKKEEPER - 4, 14, 24 Template" (id `1y_iNF54nxW3RYnZhtlT258VvPNRqalhJHihshhaEkQM`).
Size: medium (Sonnet builds, Opus reviews, Haiku checks). Fits with Tasks Phase 2.

## 1. What it is

On a bookkeeper's 4th, 14th or 24th task, a **Generate email** button shows a filled-in draft of the matching template.
Hovering the button shows the draft in a preview popover. Clicking it opens the draft in an editable box with a **Copy** button
that copies subject and body to the clipboard. The portal never sends, stores or creates Gmail drafts.

## 2. Dates: internal vs client-facing

The 4th, 14th and 24th are the internal task due dates (what bookkeepers see in Tasks). The 5th, 15th and 25th are the dates
promised to clients, and they stay in the email text exactly as the doc has them. Do not "fix" either set. The email body also
uses the doc's own dates ("reports by the 15th", "respond by the 10th", "next request by the 5th of next month").

## 3. Which tasks get the button

Never match on title. Add `email_kind text check (email_kind in ('request','reports','maintenance'))` to `task_templates`
(null by default). An admin sets it on the three monthly templates (4th, 14th, 24th). Generated tasks already carry
`source = 'template'` and `source_ref = '<template_id>:<client_id>:<period>'`, so the button resolves task to template
to `email_kind`, and client and period from `source_ref`. Tasks with no `email_kind` show no button.

Open: if the three monthly templates do not exist yet, creating them is part of this build (titles from the doc:
"[Client] - Monthly Setup & Statement Request", "... Account Reconciliation & Financial Reporting",
"... Mid-Month Bank Feed & Account Maintenance Check").

## 4. Draft contents

Standard sections are copied verbatim from the doc and not editable by the generator. Fields filled automatically:

| Field | Source |
|---|---|
| Client name | `clients.name` |
| Previous month and year | Calculated from the period in `source_ref` |
| Signature | Assigned bookkeeper's first and last name, then "MyGoodBooks" |
| Account manager | `clients.account_manager` (Jesse), CC line suggestion only |

### Email 1, 4th: Statement & clarification request
- **Missing statements:** bank and card accounts from `qbo_account_status` (kind `bank`, `credit_card`) whose
  `last_reconciled_date` is before the end of the previous month, written as "[Account name] - [Month Year] statement".
  Plus open rows in `client_doc_requests` (title, details). Account numbers are not in the sync, so the account name is used.
- **Clarifications:** `qbo_transactions` dated in the previous month on an Uncategorized or Ask My Accountant account
  (`account_name`): date, amount, `name`, `memo`, as "Debit on 08/12/2026 for $150.00 to 'Vendor XYZ' - what was the business
  purpose?" (deposits use the "please confirm source of funds" line).
- Empty section: the heading stays with "None this month."

### Email 2, 14th: Financial reports delivery
- **Option A or B:** `close_checks` for the previous month. `ready` selects Option A. `blocked` or `behind` selects Option B,
  and the pending items come from `reasons`. `no_data` selects nothing and leaves both options for the bookkeeper to choose.
- **Pending items:** same sources as Email 1, for items still open.
- **Key observations:** left as the three-line placeholder for the bookkeeper. Revenue and expense month-over-month
  suggestions are out of scope for v1.
- The Google Drive link is left as a placeholder.

### Email 3, 24th: Account maintenance update
- Standard section only. The **Bank Connection Status** and **Additional Notes** sections stay as empty prompts for the
  bookkeeper. No stale-feed or disconnected-bank detection goes in the email (owner decision 2026-10-20).

## 5. UI

- Button **Generate email** in the task drawer (`TK_Drawer.jsx`) and as a small icon in the task row actions on the
  4th/14th/24th tasks.
- Hover (or keyboard focus) shows a read-only preview popover with subject and the first lines of the body, scrollable.
  Touch devices skip the hover and open the editable box on tap.
- Click opens a panel with an editable subject and body, a **Copy** button, a **Copy subject** link and a "Copied" confirmation.
- Draft text is built in the browser on demand from rows the staff member can already read, so no new endpoint is needed
  if RLS allows it (see open question 2). Nothing about the draft is saved.
- Pure builder `TK_emailDraft.js` (no DOM, unit tested) plus `TK_EmailDraft.jsx` for the popover and panel; prefix `TK_`/`.tk-`.

## 6. Bookkeeper batch view

A "Today's emails" list in My Tasks shows the bookkeeper's own 4th/14th/24th tasks due today or overdue, one row per client,
each with the same hover preview and Copy. Admins can filter by bookkeeper.

## 7. Out of scope (v1)

Sending email, Gmail drafts, auto-written highlights, stale bank feed detection, the one-time "Initial Email" introducing
the schedule (it stays in the doc), per-client wording overrides.

## 8. Data and permissions

One column (`task_templates.email_kind`), applied by hand like the other `supabase/*.sql` files. No new tables.
Reads only: `clients`, `qbo_account_status`, `qbo_transactions`, `close_checks`, `client_doc_requests`, all already
staff-readable through `can_access_client`. Client users never see it.

## 9. Upkeep (same commit as the build)

Staff guide article, tour step on the button, tip, What's new entry, README and Developer tools entries, per the
`mgb-ui-upkeep` checklist. Ship from a worktree per `mgb-ship-from-worktree`. Not behind a preview flag; it is additive and
only shows on templated tasks.

## 10. Tests

Unit tests for the builder: each email with full data, empty data, `no_data` close check, month rollover (January sends
December), 31-day and February months, long account lists, deposit vs debit wording. Visual check at desktop and phone width
of the hover popover and editor.

## 11. Decisions (owner, 2026-10-20)

1. Client first name: not used. Greet with the client name ("Hi [Client Name],"); no new field.
2. Signature: the assigned bookkeeper's first and last name, then "MyGoodBooks".
3. The build happens the night of 2026-10-20; see `docs/email-drafts-README.md` for the builder handoff.

Still to confirm during the build: whether RLS lets a bookkeeper read `qbo_transactions` for their own clients from the browser
(if not, use a small `security definer` RPC that checks `can_access_client`), and whether the three monthly templates exist.
