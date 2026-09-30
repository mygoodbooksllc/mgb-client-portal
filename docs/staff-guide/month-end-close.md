---
title: How do I track month-end close?
section: Month-end and recurring work
audience: staff
keywords: [month-end close, close tracker, quickbooks checks, ready, blocked, behind, no data, stale bank, bank feed, uncategorized, ask my accountant, undeposited funds, unreconciled, stale bank after, checklist, reconcile, reconciled, late, not started, in progress, review, done, n/a, late after day]
sort: 310
---
There are two separate tools for month-end close. They don't update each other.

| Tool | Where | What it's for |
|---|---|---|
| **Month-end close** checklist | Client overview (one client) | Tick off the six close steps for this month. |
| **Close tracker** | Staff menu → **Close tracker** | See every client's close status, month by month. |

### The Month-end close checklist (one client)

On the client's **Client overview**, the **Month-end close** card shows the month and progress (for example *Sep 2026 · 3/6*). Tick each item as you finish it:

1. Bank feed categorized
2. Bank accounts reconciled
3. Credit cards reconciled
4. Payroll and journal entries posted
5. Reports reviewed
6. Reports sent to the client

Each ticked item records who ticked it and when. Home's **Month-end close** card lists your clients least-finished first.

### The Close tracker (all clients)

Open it from the staff menu (**Close tracker**). You'll see a grid of your clients against the last six months plus the current one. Bookkeepers see their assigned clients and any they have temporary access to; admins see everyone.

**To update a month:**

1. Click the cell for the client and month.
2. Choose a **Status**: **Not started**, **In progress**, **Review**, **Done** or **N/A**.
3. Add **Notes** if useful, for example *Waiting on bank statement*.
4. Click **Save**.

Each cell shows the status, who changed it and when, and a dot if there's a note.

**Filters:** use **Month**, **Bookkeeper** (Everyone, My clients, a person, Unassigned) and **Status** (including **Late**). The count buttons at the top also filter the grid when clicked.

### QuickBooks checks: Ready, Blocked, Behind

For clients with QuickBooks connected, the app also checks each completed month in QuickBooks on its own. The result is a small badge under each month's cell in the Close tracker, separate from the status you set by hand. A **Ready** badge doesn't change your status, and your status doesn't change the badge.

| Badge | What it means | What to do |
|---|---|---|
| **Ready** | All the checks pass. | Finish the close as usual. |
| **Blocked** | There are uncategorized or Ask My Accountant transactions in the month, or Undeposited Funds wasn't cleared at month end. | Fix these in QuickBooks: categorize the transactions and deposit or clear Undeposited Funds. |
| **Behind** | A bank or card account went quiet before month end (no transactions in the last 10 days of the month), or transactions on or before month end aren't reconciled. | Check the bank feed in QuickBooks and reconnect it if needed; reconcile through month end. |
| **No data** | QuickBooks close data hasn't synced for this client yet. | Use **Sync now** on the client, or wait for the daily refresh. |

To see why, hover over a badge, or click the cell. The window shows **QuickBooks checks** with the badge, the reasons (for example *2 uncategorized or Ask My Accountant transactions*) and the four checks, each ticked (✓) or flagged (!):

- **Uncategorized is zero**
- **Undeposited funds cleared**
- **Bank accounts active through month end**
- **Reconciled through month end**

A **?** next to a check means there isn't enough data yet to tell. If the reasons say *QuickBooks close data is N days old*, use **Sync now** on the client.

The checks refresh every day and after **Sync now** on the client. After you fix something in QuickBooks, click **Sync now** to update the badge.

**The QuickBooks checks row:** above the grid, **QuickBooks checks** counts the focus month's clients: **N ready**, **N blocked**, **N behind** and **N stale bank**. Click one to filter the grid; click again to clear it.

**Status filter:** besides the manual statuses and **Late**, the **Status** filter has **QuickBooks: ready**, **QuickBooks: blocked**, **QuickBooks: behind** and **Stale bank feed**.

**Good to know (limits):**

- "Reconciled" is an estimate. QuickBooks doesn't share reconciliation reports, so the app looks at QuickBooks' cleared flag on each transaction over the last 13 months.
- Bank-feed status is also an estimate. QuickBooks doesn't share feed status, so the app looks at each account's last transaction date. A quiet account that really had no activity will still be flagged.

### Stale bank

A red **Stale bank** chip under a client's name in the Close tracker means one of their bank or card accounts has had no transaction for more than 10 days. The bank feed has probably stopped, so reconnect it in QuickBooks. Hover over the chip to see which accounts and how many days. The client's overview shows the same accounts in its close card.

Admins can change the number of days with **Stale bank after (days)** (1 to 90) and **Save**. Close checks pick up the new number overnight.

### When is a month "late"?

A month is late if it isn't **Done** or **N/A** by the 15th of the following month. Admins can change that day with **Late after day** and **Save**.

> Saving a month in the Close tracker also ticks the client's "first month closed" onboarding step.

### Troubleshooting

- **"Couldn't load close status (...). Showing empty months."** Refresh the page. If it keeps happening, tell an admin.
- **"No clients to show."** You don't have any assigned clients yet. Ask an admin.
- **I ticked every checklist item but the Close tracker still says Not started.** That's expected: they're separate. Update the Close tracker cell too.
- **The badge says Ready but I haven't closed the month.** The badge is only the automatic QuickBooks checks. Set the status yourself when you're done.
- **I fixed it in QuickBooks but the badge still says Blocked or Behind.** Click **Sync now** on the client, then refresh the Close tracker.
- **No badge at all.** The client's QuickBooks isn't connected, or it's the current month (only completed months are checked).
