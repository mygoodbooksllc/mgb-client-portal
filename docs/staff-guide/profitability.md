---
title: How do I set client fees, hourly costs and the target margin?
section: Admin
audience: admin
keywords: [profitability, profit, margin, target margin, fee, monthly fee, tier default, hourly cost, loaded cost, cost rate, effective from, revenue, effective rate]
sort: 540
---
Profit figures are for admins only. They combine three things you set up once:

| Input | Where | Default |
|---|---|---|
| Client's monthly fee | Team → click a client → **Profitability** | The fee from the client's confirmed pricing milestone ("tier default") |
| Staff hourly cost | Team → click a person → **Loaded hourly cost** | Not set |
| Target margin | Team → summary strip above the Clients table | 40% |

Hours come from QuickBooks Time.

### How it's calculated

- **Revenue** = monthly fee × months in the period (partial months by days).
- **Cost** = QuickBooks Time hours × each person's loaded hourly cost on the day they worked.
- **Margin** = profit ÷ revenue. The chip is green at or above target, amber up to 15 points below, red below that.

### Set a client's actual fee

1. On **Team**, click the client.
2. In **Profitability**, click **Set actual monthly fee** (or **Change actual monthly fee**), enter the amount and click **Save fee**.
3. To go back to the milestone fee, click **Use tier default** or **Clear actual fee**.

### Set a staff member's hourly cost

1. On **Team**, click the person.
2. In **Loaded hourly cost** (pay plus taxes and overhead), enter the **Hourly cost** and an **Effective from** date, then **Save rate**.

A new rate starts on its date; hours before it keep the old rate. Rate history is listed below with **Remove** on each row.

### Change the target margin

In the summary strip (Revenue, Cost, Profit, Blended margin), click **Edit** next to **Target margin**, enter 0–100 and **Save**.

Admins also see monthly fee, cost, profit and margin on each client's **Client overview**. Every fee, rate and target change is recorded in the Audit log.

### Troubleshooting

- **"Connect QuickBooks Time to see cost and profit. Fees are shown alone."** See [How do I connect the firm's QuickBooks Time?](#/help/firm-quickbooks).
- **"Set staff rates to see profit."** Add a loaded hourly cost for each person with hours.
- **"Cost (part estimated)" or "…couldn't be costed (no rates)."** Someone worked on the client without an hourly cost set for that date.
- **"Profitability isn't set up on the server yet."** A database update is missing. Tell the owner.
