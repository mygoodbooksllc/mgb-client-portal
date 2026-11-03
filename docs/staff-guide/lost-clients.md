---
title: How do I mark a client as lost?
section: Admin
audience: staff
keywords: [lost client, lost clients, mark lost, undo lost, former client, fired client, client left, stopped being a client, churn, leaving, lost date, client organizations, history, past client]
sort: 525
---
When an organization stops being a MyGoodBooks client, an admin marks it **lost** with the date they left. It's reversible, and nothing is deleted. This is different from a test client: a test client is never real, a lost client was.

### Mark a client lost

1. Go to **Manage access › Client organizations**.
2. On the client's row, click **Mark lost** (under **Edit**).
3. Pick the **first day they're no longer a client** and click **Mark lost**. A future date is fine: until then the row says **Leaving** and nothing changes.
4. A message confirms it, with **Undo** if you picked the wrong client.

The row then shows a **Lost** tag and the date. Only admins see these buttons, and every change is recorded in the [Audit log](#/help/audit-log).

### What changes from that day

- The client leaves the **Clients** list, the client picker, pickers in forms, alerts, the weekly digest, client health, coverage and the anniversary gift list.
- Its repeating tasks stop making new ones.
- Fee revenue on Profitability and Capacity stops on the lost date (a month they left part way through counts only the days before it).
- The **Mark lost** and **Undo lost** buttons stay on **Manage access**, the one place a lost client stays in the list.

### What stays

- **History**: its hours, tasks, messages, documents and audit entries. Find it under **Lost clients** at the bottom of the **Clients** page, or type its name in the client picker or search (it shows last, tagged **Lost**).
- **QuickBooks Time hours** still count in firm hours and pay cost on Team and Capacity, so the totals still match QuickBooks.
- **Sign-in**: marking a client lost never blocks anyone. If the client's people should lose access, remove them under **Manage access** too.

### Before you mark one lost

- Close or move the client's open tasks. Repeating tasks stop, but tasks that are already open stay open, and the Desk inbox still shows them.
- Remove staff access to the client if nobody should keep it.

### Undo it

Click **Undo lost** on the client's row in **Manage access › Client organizations**. The client is current again everywhere, and the change goes in the Audit log.
