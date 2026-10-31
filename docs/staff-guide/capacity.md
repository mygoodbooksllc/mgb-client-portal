---
title: How do I check team capacity?
section: Admin
audience: admin
keywords: [capacity, workload, utilization, weekly target, hours per week, has room, overloaded, 35 hours, time off, covered tasks, backup]
sort: 550
---
The **Capacity** card on **Team** (admins only) compares each person's average QuickBooks Time hours per week with their weekly target.

### Reading the card

Columns: Name, **Target / wk**, **Avg / wk (4 wks)**, **Utilization**, Clients, Open and Overdue tasks.

There is no "this week" column on purpose. QuickBooks Time hands hours to QuickBooks Online when a pay period is approved, so the newest days are not in yet and the current week would show zero for everyone. The average uses only the last 4 **complete** weeks (Monday to Sunday) that have fully synced, never the current week. On **Team › Hours**, a line under the period tabs says **Hours synced through** the newest day the portal has.

People who are paid monthly (Gillian) show **Paid monthly, hours post at month end** instead of an average and a utilization bar, because their hours reach QuickBooks only at month end. Who is paid monthly is a short list in the code (`TH_MONTHLY_PAID_EMAILS` in `components/staff/teamHoursLogic.js`); there is no pay-frequency field yet, so ask to have someone added.

Open and Overdue count by who the task is assigned to now. (The Overdue column is hidden during the late-task grace period.) While someone is out, tasks handed to a backup count for the backup until they go back. See [What happens to my tasks while I'm out?](#/help/out-of-office-handoff).

Utilization uses the 4-week average:

| Label | Meaning |
|---|---|
| **Has room** | Under 70% of target |
| **OK** | 70% to 100% |
| **Overloaded** | Over 100% |

### Change someone's weekly target

The default is **35 h**. Click **Edit** next to their target, enter 0–100 hours and save.

### Workload hint on HR → Members

When assigning clients on **HR → Members** (formerly Staff Access), the Clients column and the "{name}'s clients" window show a small workload bar with **Has room** / **Overloaded**, so you can balance assignments.

### Troubleshooting

- **"Weekly targets aren't set up on the server yet, so everyone uses 35 h."** A database update is missing; everyone uses the default until it's applied.
- **"QuickBooks Time isn't connected, so there are no hours to compare with targets yet."** See [How do I connect the firm's QuickBooks Time?](#/help/firm-quickbooks).
