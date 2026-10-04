---
title: What does the Client overview show?
section: Working with a client
audience: staff
keywords: [client overview, urgent, gold glow, needs attention, close card, month close, ready, blocked, behind, stale bank, organization type, overview, monthly bill, profitability, quickbooks health, engagement, key dates, coverage, activity, log a call, pinned notes, sent to client]
sort: 200
---
The **Client overview** is the staff-only summary of one client. You land here whenever you open a client. The client never sees this page.

To come back to it, click **Overview** next to the client picker in the dark bar at the top of the page (it's highlighted while you're on the overview). On a phone, tap the client picker and pick the same client again. The client's own sidebar doesn't list the overview, so it shows exactly what the client sees. A banner reminds you: "Staff only. {client} never sees this page."

### Cards with a gold glow

A card with a soft gold glow that gently pulses needs attention. Only these cards do it, and only when:

- **Client health** is **At risk** (red).
- **Transaction questions** has at least one open question from the client.
- **QuickBooks health** shows a red problem: uncategorized balances, possible duplicate bills, no sync in over 26 hours, or the last sync run failed.
- **Document requests** has a request that's still open past its due date (marked **Overdue**).
- **{Month} close** has a **Blocked** badge.

Fix the problem and the glow goes away the next time the card loads. Onboarding steps that aren't finished don't glow. If your computer is set to reduce motion, the card gets a still gold outline instead of a pulse.

### Top row

- **Client health**: a score out of 100 with the reasons points were taken off. See [What does client health mean?](#/help/client-health).
- **Monthly bill**: what the client pays: milestone fee, plan and logins, plus payroll if they have the add-on. **Milestone details** opens their milestone.
- **Profitability · this month**: the bill divided by QuickBooks Time hours, against a target rate. Also shows your in-app time. QuickBooks Time hours are shown to admins only.
- **QuickBooks health**: last sync, uncategorized balances and possible duplicate bills. Shows **Not connected** if QuickBooks isn't set up. (For reconciliation, see the close card below.)
- **Engagement · 30 days**: when the client last visited, page views, who signed in and their top pages. (The "waiting on a reply" lines here come from sample threads. Real client messages are in the **Inbox**.)

### Left column

- **Month-end close** checklist for the month. See [How do I track month-end close?](#/help/month-end-close).
- **Document requests** and **Document reminders**. See [How do I request a document from a client?](#/help/document-requests).
- **Activity**: a timeline of notes, calls, meetings, requests, uploads, sends, close items and milestone changes. Type in **Log a call** and click **Log call** to record a phone call.

### Right column

- **Onboarding** steps for new clients, plus the client's **Organization type** (Nonprofit or For-profit). See [How does client onboarding work?](#/help/onboarding).
- **{Month} close** (for example *September 2026 close*): last month's automatic QuickBooks checks, with a **Ready**, **Blocked**, **Behind** or **No data** badge, the reasons and the four checks. If a bank or card account has gone quiet, it also says **Bank feed may have stopped** and lists the accounts with their last transaction date. "From QuickBooks …" shows how fresh the data is. The card only appears for clients with QuickBooks close data. See [How do I track month-end close?](#/help/month-end-close).
- **Key dates and coverage**: Form 990 and 1099 due dates, launch date (church plants), board meetings, fiscal year end, the bookkeeper and backup. Click **Edit dates and coverage** to change them (including **Target hourly rate ($)**), then **Save**.
- **Pinned notes** and the latest **notes on transactions, budget lines and reports**.
- **Sent to the client**: reports recently marked as sent. See [How do I leave a staff note on a transaction, budget line or report?](#/help/staff-notes).

### Troubleshooting

- **"This needs supabase/staff-client-tools.sql…"** A database update is missing. Tell an admin.
- **Profitability shows "—" for hours.** Hours are only shown to admins, or no QuickBooks Time hours are logged for this client this month.
