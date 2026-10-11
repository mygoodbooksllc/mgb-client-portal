---
title: What does the Client overview show?
section: Working with a client
audience: staff
keywords: [client overview, overview, open for this client, chips, status line, tasks for this client, client task list, task status, activity, log a call, key dates, coverage, organization type, pinned notes, billing and time, monthly bill, profitability, hours budget, engagement, onboarding, health, why score, duplicate bills, quickbooks sync, deadlines, backup bookkeeper, out until, time off, account manager, close summary]
sort: 200
---
The **Client overview** is the staff-only summary of one client. It's the first tab in the client's tab row. The client never sees this page.

When you open a client, the app puts you back on the tab you last used for that client in this browser session. If you haven't used one yet, you land on **Overview**. To come back, click **Overview**. On a phone, the tab row scrolls sideways. Clients don't have this tab, and **Client view › View as client…** shows exactly what they see. A banner reminds you: "Staff only. {client} never sees this page."

### Open for this client

The strip at the top is your to-do list for this client. Each chip is a link that takes you to the exact place to fix it. The chips use the same numbers as the badges on the tab row, so a chip and its badge never disagree.

Chips you may see, worst first:

- **QuickBooks needs reconnecting** (always first)
- **{n} replies waiting** (client messages)
- **{n} open questions** (transaction questions, QuickBooks clients)
- **{n} requests overdue** and **{n} uploads to mark received** (document requests)
- **{Month} close: Late**, or **{Month} close: {status}**, and **QuickBooks close: blocked**
- **Bank feed may have stopped**
- **{n} of my tasks**, or **{n} of my tasks overdue**
- The next filing deadline, when it's overdue or within 30 days, for example *Form 990 due in 12 days*

Red means overdue or broken, amber means waiting on you, and plain means just so you know. The strip shows six chips. Click **+{n} more** for the rest. When nothing needs you it says *Nothing needs you on {client} right now*. If the check fails, click **Try again**.

### The status line

Under the strip is one line of facts:

- **Health {score} · {band} · Why {score}?** Click it to see the reasons points were taken off, each with a link to fix it. See [What does client health mean?](#/help/client-health).
- **QuickBooks synced {time}**, with **Sync now** next to it. Staff have no limit on **Sync now**, on any plan. It turns red when the sync is overdue or the last run failed. If QuickBooks isn't connected you'll see **Connect**. If the connection broke, **Reconnect**. Both open the QuickBooks part of **Client setup**.
- **Uncategorized: {amount} in {n} accounts**, a link to Bank on the uncategorized transactions. Or *Uncategorized: none*.
- **Possible duplicate bills: {n}**, when there are any. Click it to see the vendors and dates.
- The client's plan and how often their data syncs, for example *Basic plan · Basic syncs monthly, on the 15th*.

### Left column

- **{Month} close · {status} · {n} of 6 steps · QuickBooks: {result}**. This is a one-line summary of last month's close. Click it, or **Open Close →**, to open the **Close** tab. See [What's on a client's Close tab?](#/help/client-close).
- **Tasks for this client**: the open tasks for this client. **Mine** shows yours. **Everyone** adds shared tasks from the rest of the team (your choice is remembered). A task that isn't **To do** shows its status, such as **In progress** or **Waiting on client**. Tick the box to mark one done (on a task that needs review, that sends it to an admin). Click a task to open its details. **Add task** opens quick add with this client picked. It shows six, with **Show all {n}**. The card's title opens this client's task list on the Tasks page. See [How do client task lists and projects work?](#/help/task-lists-and-projects).
- **Activity**: a timeline of notes, calls, meetings, requests, uploads, sends, close items and milestone changes. Type in **Log a call** and click **Log call** to record a phone call. It shows eight entries. Click **Show more** for the rest.

### Right column

- **Key dates and coverage**:
  - The client's upcoming filing deadlines, with a **Filed** control on each. See [How do I track filing deadlines?](#/help/deadlines).
  - Form 990 and 1099 due dates, launch date (church plants), board meetings, fiscal year end.
  - The **Bookkeeper**, the **Backup** and the **Account manager**. An **Out until {date}** tag shows next to anyone who's on time off. See [How do I add time off and make sure my clients are covered?](#/help/time-off-coverage).
  - **Organization type** (**Nonprofit** or **For-profit**). Any staff member can change it. It drives which deadlines the client gets.
  - **Edit dates and coverage** opens the form. Change what you need and click **Save**. It includes **Backup bookkeeper (covers when they're out)**, a list of active staff, and the **Account manager** pick (admins only). Admins also see **Target hourly rate ($)** and **Monthly hours budget (admins only)**.
  - **Account manager** is the client's main contact. They get the email when the client sends a message, and they show on the client's Dashboard as **Your account manager**. New clients start with Jesse. Choosing **Not set** means client messages email everyone with access to the client.
- **Pinned notes**: the notes pinned for this client, plus the latest notes on transactions, budget lines and reports. Click **All notes** to see every note. You can pin or unpin and edit a note here. To remove one, go to **Client setup › Notes**. See [How do I keep notes on a client?](#/help/notes).

### Billing and time (admins only)

Below the columns, real admins see a **Billing and time** section, with the monthly bill and the hours so far this month in its heading. Bookkeepers, account managers and temporary admins don't see it at all. It stays open or closed the way you last left it for that client.

- **Monthly bill**: what the client pays: milestone fee, plan and logins, plus payroll if they have the add-on. The title opens the client's **Milestone** tab.
- **Profitability · this month**: the bill divided by QuickBooks Time hours, against a target rate. Also shows your in-app time, fee, cost and margin, and **Hours budget**: hours used this month out of the client's monthly budget. See [How do I set a monthly hours budget for a client?](#/help/hours-budget) and [How do I set client fees, hourly costs and the target margin?](#/help/profitability).
- **Engagement · 30 days**: when the client last visited, page views, who signed in and their top pages. **Usage stats** opens the full report.
- **Onboarding**: steps for new clients. Once every step is done it folds to one line, *Onboarding done*, with **Show steps**. See [How does client onboarding work?](#/help/onboarding).

### Cards and links

Each card's title is a link: it takes you to the full page for that thing. Where a card has its own control (a tick box, **Save**, **Log call**), that works in place.

Nothing on the Overview glows or pulses. The gold glow is now only on the **Close** tab's QuickBooks check when it's **Blocked**, and on a request card on **Documents** when it's overdue. Everything else that needs you is a chip in **Open for this client**.

### Troubleshooting

- **"This needs supabase/staff-client-tools.sql…"** A database update is missing. Tell an admin.
- **"Couldn't check what's open for {client}."** Click **Try again**. If it keeps failing, reload the page.
- **I don't see Billing and time.** It's for admins only. Ask an admin if you need a number from it.
- **Profitability shows "—" for hours.** No QuickBooks Time hours are logged for this client this month.
