---
title: What's on the Team page?
section: Getting started
audience: staff
keywords: [team, people, who's out, backups, my time off, shout-outs, reviews, onboarding, hours, reply times, feedback, members, staff access, quickbooks time, in app, people table, clients table, drill-down, csv, this month, custom range, billable, hours budget, quickbooks api usage, coverage, client health]
sort: 48
---
**Team** (in the left rail, or `#/team`) is about the people you work with. Everyone gets the first three tabs. Admins get four more. The tab is part of the address (`#/team/people`, `#/team/reviews` and so on).

### For everyone

- **People** (opens first): **Who's out** today and in the next 30 days, **My clients' backups** (who covers each of your clients, and whether they can open it), **My time off** with **+ Add time off**, and **Shout-outs**. See [How do I add time off and make sure my clients are covered?](#/help/time-off-coverage) and [How do I give a teammate a shout-out?](#/help/shoutouts).
- **Reviews**: your quarterly review, your history and the team survey. Admins also get Team status, Reviews I'm giving, Survey results and Year-end. The number on the tab shows what's waiting on you. See [How do quarterly reviews work?](#/help/quarterly-reviews).
- **Onboarding**: your new-hire checklist, **Your onboarding**. Admins also see each person's progress and can edit the steps. See [How does the new-hire onboarding checklist work?](#/help/new-hire-onboarding).

### Admins only

- **Hours** (`#/team/hours`): hours and tasks by person and by client, with the QuickBooks Time connection and the QuickBooks API usage card. Details below.
- **Reply times** (`#/team/reply-times`): how fast we answer client messages, by person and by client, and who's waiting over 24 hours. See [How do I read reply times?](#/help/reply-times).
- **Feedback** (`#/team/feedback`): every bug report and idea staff have sent, with status and replies. The number on the tab counts reports still marked **New**. See [How do I review bug reports and feedback?](#/help/feedback-page).
- **Members** (`#/team/members`): add staff, roles, active/inactive, client assignments, temporary admin access, **View as**, **Offboard** and email invites. Temporary admins see it read-only. See [How do I add staff and manage their access?](#/help/staff-management).

Client health has no tab of its own any more: the **Clients** page shows every client's score and band, and its **Needs attention** filter picks out the ones to look at. See [What does client health mean?](#/help/client-health).

### Hours, top to bottom

1. **QuickBooks Time** panel: the firm's QuickBooks connection. See [How do I connect the firm's QuickBooks Time and match customers and staff?](#/help/firm-quickbooks).
2. **QuickBooks API usage** card: calls to QuickBooks this month against Intuit's limit. See [How do I read the QuickBooks API usage card?](#/help/quickbooks-api-usage).
3. A link to **Emails** (weekly digest and client email settings live there).
4. Period tabs: **This week**, **This month** (default), **Last month**, **Custom range**. Use **People CSV** / **Clients CSV** to export.
5. A summary line: hours in QuickBooks Time and hours active in the app (automatic, not billed).
6. **Capacity** card. See [How do I check team capacity?](#/help/capacity).
7. **People** table, then **Clients** table.

Temporary admins see the tab without the money figures.

### Hours: where they come from

- **QB hours** come only from QuickBooks Time. Nobody logs time in this app.
- **In app** is automatic active time on client pages. It is not billed time.

### People table

Name, QB hours, In app, Billable, On clients, unmapped customer hours, Open, Overdue, Completed tasks, and Clients (with "+N temporary"). Rows tagged **Unmapped**, **Ignored**, **No customer** or **No person** collect hours that aren't matched yet; click **Map them** to fix.

Click a person to see their QB hours, billable hours, in-app time by client, tasks (Overdue, Open, Completed in period) and their **Loaded hourly cost**.

### Clients table

Client, Plan, QB hours, In app, Avg / mo, Trend (for example "▲ 20% vs avg"), Billable value, Fee / mo, Eff. rate, Cost, Profit, Margin %, **Budget (this month)**, then Open and Overdue.

- **Budget (this month)** compares this calendar month's QuickBooks Time hours with the client's monthly hours budget: amber from 80%, red with **Over** at 100%. A dash means no budget is set. Bookkeepers see the same comparison as **Hours this month** on the **Clients** page. See [How do I set a monthly hours budget for a client?](#/help/hours-budget).
- **Least profitable first** sorts by margin.
- **Show clients with no activity** includes quiet clients.
- The line under the table reconciles total hours: on clients, unmapped, ignored or internal.

Click a client to see hours by QuickBooks customer and by person, hours over the period, every QuickBooks Time entry and the **Profitability** card.

### Troubleshooting

- **No hours at all.** QuickBooks Time isn't connected, or the first sync hasn't finished (it can take about 10 minutes).
- **Hours land in "Unmapped".** A QuickBooks customer or employee isn't matched to a client or staff member yet. Use **Customer and staff mapping ›**.
- **I don't see Hours, Reply times, Feedback or Members.** Those tabs are for admins. Ask an admin if you need something from them.
