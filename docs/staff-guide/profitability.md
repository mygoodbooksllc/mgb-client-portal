---
title: How do I set client fees, hourly costs and the target margin?
section: Admin
audience: admin
keywords: [profitability, profit, margin, target margin, fee, monthly fee, tier default, hourly cost, loaded cost, cost rate, effective from, revenue, effective rate, internal, mgb internal, who sees profit]
sort: 540
---
Profit figures are internal. Only admins the owner has given the **MGB (internal)** permission (**HR › Members**, the **MGB (internal)** column) see them. Other admins and all other staff see no fees, hourly costs, cost, profit or margins anywhere, and can't open this article. Nothing tells them it's hidden.

They combine three things you set up once:

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

### Where else you see it

- **Team › Hours, Clients table**: Fee / mo, **vs milestone** (the actual fee minus the fee for the client's confirmed pricing milestone: plus means they pay more, minus means less; "on milestone" when no actual fee is set so the milestone fee is used), Eff. rate, Cost, Profit and Margin %, plus the **Least profitable first** sort.
- **Team › Hours, click a person**: their **Loaded hourly cost**.
- **Client overview → Billing and time**: monthly fee, cost, profit and margin.
- **Client health**: **Margin below target** takes 15 points off. Only people with the permission have it in their score, so their score for a client can be lower than another admin's.
- **Weekly digest**: the **Price review** and **Revenue snapshot** sections, and the fee and margin bits of the headline, go only to recipients with the permission. Everyone else on the list gets the same digest without them. **Preview** shows you the version you would get.
- **Audit log**: every fee, rate and target change, in the **Client fees**, **Cost rates** and **Profitability settings** groups. Only people with the permission see those entries or groups.

Turning the permission off for an admin hides all of this from them at once, in the database as well as on screen.

### Troubleshooting

- **"Connect QuickBooks Time to see cost and profit. Fees are shown alone."** See [How do I connect the firm's QuickBooks Time?](#/help/firm-quickbooks).
- **"Set staff rates to see profit."** Add a loaded hourly cost for each person with hours.
- **"Cost (part estimated)" or "…couldn't be costed (no rates)."** Someone worked on the client without an hourly cost set for that date.
- **"Profitability isn't set up on the server yet."** A database update is missing. Tell the owner.
