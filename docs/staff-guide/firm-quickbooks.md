---
title: How do I connect the firm's QuickBooks Time and match customers and staff?
section: Admin
audience: admin
keywords: [firm quickbooks, quickbooks time, timesheets, connect, reconnect, disconnect, sync now, mapping, customer mapping, employee mapping, unmapped, ignore, reset, auto-matched]
sort: 580
---
Staff hours come from the **firm's own** QuickBooks Online company (the one QuickBooks Time sends timesheets to). This is separate from each client's QuickBooks. Staff keep using QuickBooks Time exactly as they do now.

### Connect

1. Go to **Team**. The **QuickBooks Time** panel is at the top.
2. Click **Connect QuickBooks**. Intuit opens in a new tab.
3. Sign in to the firm's QuickBooks company there and approve the connection, then come back.

The first sync can take about 10 minutes. After that it syncs hourly. The panel shows the company, when it last synced and how many entries it has.

These syncs count toward the firm's Intuit monthly limit, shown in the **QuickBooks API usage** card just below the panel. See [How do I read the QuickBooks API usage card?](#/help/quickbooks-api-usage).

- **Sync now**: pull the latest hours right away.
- **Reconnect QuickBooks**: use this if the connection has expired or failed.
- **Disconnect**: stops hourly syncing (you'll be asked to confirm). Hours already synced stay on Team › Hours.

### Match QuickBooks customers and people

Hours only count toward a client or person once they're matched. Click **Customer and staff mapping ›** (the panel also shows how many need mapping).

On the **QuickBooks mapping** page:

- **Customers** tab: which client each QuickBooks customer is.
- **People** tab: which staff member each QuickBooks employee or vendor is.
- Filter **Needs mapping** / **All**. The biggest gaps sort first.

For each row, choose a client (**Choose a client…**) or staff member (**Choose a staff member…**), or click **Ignore** for internal or non-client work. **Reset** hands a row back to automatic matching by name or email.

Row statuses: **Mapped to X**, **Auto-matched to X**, **Via {parent}: X** (jobs and sub-customers roll up to their parent unless mapped on their own), **Ignored**, **Not mapped**.

Every mapping change is recorded in the Audit log.

### Troubleshooting

- **"Last sync failed (…)"** Try **Sync now**. If it fails again, click **Reconnect QuickBooks**.
- **"No QuickBooks customers synced yet."** The first sync can take about 10 minutes.
- **"Sign in as an admin to see the QuickBooks connection."** Only admins can see or change this panel.
