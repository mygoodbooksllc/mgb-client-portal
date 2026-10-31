# Builder handoff: monthly email drafts (4th / 14th / 24th)

Read `docs/email-drafts-spec.md` first. It is approved and the decisions in section 11 are final. This file is the short version plus the rules for the build.

## Goal

Tasks for the 4th, 14th and 24th get a **Generate email** button. Hover shows a preview of the draft, click opens an editable box with a **Copy** button (clipboard only). The draft is filled from portal and QuickBooks data. Nothing is sent, saved or put in Gmail.

Source wording: Google Doc "BOOKKEEPER - 4, 14, 24 Template" (id `1y_iNF54nxW3RYnZhtlT258VvPNRqalhJHihshhaEkQM`). Copy the standard sections verbatim. Keep the doc's dates as written: the 4th/14th/24th are internal task dates; the 5th/15th/25th (and the 10th reply date) are the client-facing dates in the email text. Do not change either set.

## Decisions already made

- Greeting uses the client name ("Hi [Client Name],"). No first-name field.
- Signature: the assigned bookkeeper's first and last name, then "MyGoodBooks".
- 24th email: standard text only. No bank-feed or stale-feed detection. Bank Connection Status and Additional Notes are left as empty prompts.
- 14th email highlights are left as placeholders for the bookkeeper. No auto-written insights.
- American spelling in all copy.

## Before you start

1. Work in `/Users/holdengray/Desktop/Mygoodbooks-app-code/client-dashboard`. Run `git fetch` and compare with `origin/main`; the local branch is behind and work also happens in web sessions.
2. Ship with the `mgb-ship-from-worktree` skill (throwaway worktree off origin/main, push to main, confirm the Vercel deploy, remove the worktree). Do not commit from the local checkout.
3. Conventions: no bundler, Babel in the browser, `window.__SOURCE_ORDER` in `index.html` is the load order, one name prefix per file (`TK_` / `.tk-`), flat `supabase/*.sql` applied by hand, commit straight to main. Never add `<base>` (CSP has `base-uri 'none'`).
4. Supabase project `xumsqmhccgfjnlmieqyu`; use the `mgb-supabase-deploy` skill for the migration.

## Build steps

1. **Check first, report if wrong:** (a) can a bookkeeper read `qbo_transactions`, `qbo_account_status`, `close_checks`, `client_doc_requests` for their own clients from the browser (RLS via `can_access_client`)? If `qbo_transactions` is not readable, add a small `security definer` RPC that checks `can_access_client` and returns only the uncategorized rows for one client and month. (b) Do the three monthly task templates exist (4th, 14th, 24th)? If not, create them with the titles in the spec, section 3.
2. **Migration** `supabase/task-template-email-kind.sql`: `task_templates.email_kind text check (email_kind in ('request','reports','maintenance'))`, null default, safe to re-run. Set it on the three templates. Add an admin control for it in the template editor if one exists; otherwise set it in SQL.
3. **Pure builder** `components/tasks/TK_emailDraft.js` (no DOM) with unit tests in `TK_emailDraft.test.js`. Input: kind, client, period, bookkeeper, account rows, transactions, close check, doc requests. Output: `{subject, body}` plain text. Test: all three emails with full data, empty data, `no_data` close check, January sends December, 28/29/30/31-day months, long account lists, deposit vs debit wording, empty sections say "None this month."
4. **UI** `TK_EmailDraft.jsx` plus CSS (`.tk-` prefix): the button in the task drawer (`TK_Drawer.jsx`) and a small icon in the task row; hover/focus preview popover (read-only, scrollable); tap opens the editor on touch devices; editor with editable subject and body, **Copy**, **Copy subject**, and a "Copied" confirmation. Register new files in `window.__SOURCE_ORDER`.
5. **Today's emails list** in My Tasks: the bookkeeper's own 4th/14th/24th tasks due today or overdue, one row per client, same hover and Copy. Admins can filter by bookkeeper.
6. **Resolve the task to a template** via `source_ref = '<template_id>:<client_id>:<period>'` and `email_kind`. Never match on the task title.
7. **Upkeep in the same commit**, via the `mgb-ui-upkeep` skill: staff guide article, tour step, tip, What's new, README, Developer tools. Not behind a preview flag.

## Rules

- Draft text is built in the browser on demand. Nothing about a draft is stored.
- Clients never see this; staff only.
- Keep it medium-sized: Sonnet builds, Opus reviews, Haiku runs the checks. Announce the model split in one line when you start.
- Cost control: few screenshot variants, no reruns. One screenshot each of the hover preview and editor at desktop width, one at phone width.

## Done means

- Unit tests pass.
- On a test client with QuickBooks data, the 4th task shows missing statements and uncategorized items, the 14th picks Option A or B correctly, the 24th is standard text.
- Hover preview, click-to-edit and Copy work at desktop and phone width.
- Pushed to main, Vercel deploy confirmed, worktree removed.
- Report back: what you checked in step 1, what you changed, and anything you could not verify.
