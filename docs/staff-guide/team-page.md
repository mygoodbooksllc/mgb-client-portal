---
title: How do I read the Team page?
section: Admin
audience: admin
keywords: [team, quickbooks api usage, hours, quickbooks time, in app, people table, clients table, drill-down, csv, this month, custom range, billable]
sort: 500
---
**Team** (staff menu → Team, or `#/team`) shows hours and tasks by person and by client. Admins see money figures; temporary admins see the page without them.

### Layout, top to bottom

1. **QuickBooks Time** panel: the firm's QuickBooks connection. See [How do I connect the firm's QuickBooks Time?](#/help/firm-quickbooks).
2. **QuickBooks API usage** card (admins): calls to QuickBooks this month against Intuit's limit. See [How do I read the QuickBooks API usage card?](#/help/quickbooks-api-usage).
3. A link to **Emails** (weekly digest and client email settings live there now).
4. Period tabs: **This week**, **This month** (default), **Last month**, **Custom range**. Use **People CSV** / **Clients CSV** to export.
5. A summary line: hours in QuickBooks Time and hours active in the app (automatic, not billed).
6. **Capacity** card. See [How do I check team capacity?](#/help/capacity).
7. **People** table, then **Clients** table.

### Hours: where they come from

- **QB hours** come only from QuickBooks Time. Nobody logs time in this app.
- **In app** is automatic active time on client pages. It is not billed time.

### People table

Name, QB hours, In app, Billable, On clients, unmapped customer hours, Open, Overdue, Completed tasks, and Clients (with "+N temporary"). Rows tagged **Unmapped**, **Ignored**, **No customer** or **No person** collect hours that aren't matched yet; click **Map them** to fix.

Click a person to see their QB hours, billable hours, in-app time by client, tasks (Overdue, Open, Completed in period) and, for admins, their **Loaded hourly cost**.

### Clients table

Client, Plan, QB hours, In app, Avg / mo, Trend (for example "▲ 20% vs avg"), Billable value, then admin-only Fee / mo, Eff. rate, Cost, Profit, Margin %, then Open and Overdue.

- **Least profitable first** (admin) sorts by margin.
- **Show clients with no activity** includes quiet clients.
- The line under the table reconciles total hours: on clients, unmapped, ignored or internal.

Click a client to see hours by QuickBooks customer and by person, hours over the period, every QuickBooks Time entry and, for admins, the **Profitability** card.

### Troubleshooting

- **No hours at all.** QuickBooks Time isn't connected, or the first sync hasn't finished (it can take about 10 minutes).
- **Hours land in "Unmapped".** A QuickBooks customer or employee isn't matched to a client or staff member yet. Use **Customer and staff mapping ›**.
