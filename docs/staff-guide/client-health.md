---
title: What does client health mean?
section: Working with a client
audience: staff
keywords: [client health, health board, clients at risk, points, deductions, document requests, reply, hours budget, sop stale, health score, healthy, watch, at risk, dot, status, override, score out of 100]
sort: 240
---
Every client gets a **health score out of 100**. It's a quick way to spot who needs attention.

### Where you see it

- A coloured dot next to each client in the client picker. Hover it for "Health N/100 · …" and the reasons.
- The **Client health** card at the top of the Client overview, with a meter and the reasons points were taken off.
- The client name in the picker also shows the health label.
- The **Clients at risk** card on **Home**: red and amber clients, lowest first. Bookkeepers see only their own clients.
- Admins: the **Client health** tab on the **Team** page (`#/team/health`) lists every client. Click a column to sort, and filter by band, bookkeeper or backup, or reason.

### The bands

| Band | Colour | Meaning |
|---|---|---|
| **Healthy** | Green | 80 or more. On track. |
| **Watch** | Amber | 50 to 79. Something is slipping; have a look. |
| **At risk** | Red | Under 50. Several problems; act soon. |

### What goes into the score

Every client starts at 100. Points come off for each problem, and the score never goes below 0.

| Problem | Points off |
|---|---|
| Overdue tasks on the client | 10 each, up to 30 |
| QuickBooks not connected or has an error | 25 |
| QuickBooks hasn't synced in over 3 days | 10 |
| No staff time logged in 30 days | 20 |
| Last month's close is late | 20 |
| Overdue document requests | 5 each, up to 15 |
| Client waiting on a reply for over 24 hours | 10 |
| SOP not edited or marked accurate in 180 days ("SOP not reviewed in N days"), or under half its sections filled | 5 |
| Margin below target (admins only) | 15 |
| Over the monthly hours budget (admins only) | 10 |

Bookkeepers never see the margin or hours budget reasons, and those points aren't taken off in their view.

The card reads: "Score out of 100 from overdue tasks, QuickBooks connection, staff activity in the last 30 days, month-end close, overdue document requests, client replies waiting, and the SOP."

When nothing is wrong, the card says: "Nothing flagged. Tasks, QuickBooks, activity, close, requests, replies and the SOP are on track."

Click **Refresh** on the card to recalculate after you've fixed something.

### Manual status override

On **Home**, in the **Your clients** card, click **Status** next to a client to set a green, yellow or red status with a reason (for example *needs follow-up on missing August bank statement*). While an override is set, it's shown instead of the calculated score. Click **Clear override** to go back to the score.

### Troubleshooting

- **The card says "Unavailable".** The score couldn't be loaded. Refresh the page.
- **The card is missing entirely.** The health feature isn't installed on the server yet. Tell an admin.
