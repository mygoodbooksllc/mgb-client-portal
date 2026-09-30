---
title: How do I use the Audit log?
section: Admin
audience: admin
keywords: [audit log, history, who changed, export csv, filters, access changes, fees, rates, mappings, view as]
sort: 530
---
The **Audit log** (staff menu → Audit log, admins only) records who changed access, fees, rates, mappings and client settings, and when. The database writes it, so nobody can edit or delete entries.

### Find something

Use the filters at the top:

- Search (email, client id, action…)
- **Person**: Everyone, System, or a staff member
- **Client**
- **Action group**: Client assignments, Temporary access, Staff changes, Client fees, Cost rates, Profitability settings, QuickBooks, Clients, View as, Portal preview
- **From** / **To** dates

**Clear filters** resets them. The table shows When, Person, Action, Client, Target and Details (click **Raw** for the full record). It shows 50 rows per page; use **Newer** / **Older**.

### Export

**Export CSV** downloads what matches your filters, up to the newest 10,000 rows. For older entries, narrow the dates.

### Troubleshooting

- **"The audit log table isn't set up yet."** The database update hasn't been run. Tell the owner.
- **"Nothing matches these filters."** Clear or widen the filters.
