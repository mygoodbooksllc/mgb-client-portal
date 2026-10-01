---
title: How do I read the QuickBooks API usage card?
section: Admin
audience: admin
keywords: [quickbooks api usage, api usage, intuit limit, monthly limit, calls, projected, slowed down, scheduled syncs stopped, change limits, pro sync every, throttle, cadence]
sort: 585
---
Intuit limits how many times a month the app can read from QuickBooks (500,000 calls by default). Every client sync and every QuickBooks Time sync counts. The **QuickBooks API usage** card keeps the firm under that limit.

Find it on **Team** (sidebar → **Team**, **Hours and tasks** tab), just under the **QuickBooks Time** panel, or open **Settings → Firm settings → QuickBooks usage and limits**, which also shows this month's **% used**. Only admins see it.

### What the card shows

- **Calls in {month}**: calls so far this month, and the percent of the monthly limit used.
- **Projected by month end**: where the month will land at the current pace.
- **Pro clients sync every**: how often Pro clients sync right now (15 minutes normally).
- A bar showing used and projected calls, with marks at the slow-down and stop points.
- A breakdown by source: **Client syncs**, **QuickBooks Time**, and **Estimated (before counting started)** for the part of the month before counting began.

The badge at the top right shows the current mode: **Normal**, **Slowed down** or **Scheduled syncs stopped**.

### What happens as usage climbs

It's automatic; you don't have to do anything.

| Mode | When | What changes |
|---|---|---|
| **Normal** | Below the limits | Pro clients sync every 15 minutes. Basic clients sync on the 15th. |
| **Slowed down** | The month is on pace to pass 80% of the limit | Pro clients sync every 30 minutes instead of 15. |
| **Scheduled syncs stopped** | 95% of the limit is used | Automatic syncs stop until the 1st of next month. **Sync now** still works. |

Everything goes back to normal on the 1st, when the count resets.

### Change limits (admins)

Click **Change limits** to edit:

- **Monthly limit (calls)**: Intuit's limit (at least 1,000).
- **Slow down at (% projected)**: default 80.
- **Stop at (% used)**: default 95. It can't be lower than the slow-down percent.
- **Pro sync every (min)**: default 15.
- **When slowed (min)**: default 30. It can't be faster than the normal Pro cadence.

Click **Save** (or **Cancel**). You'll see "Usage settings saved."

### The weekly digest

The Monday weekly digest repeats this as one line: calls this month, the projection and the Pro cadence, with a warning if syncing is slowed down or stopped. See [How does the weekly digest email work?](#/help/weekly-digest).

### Troubleshooting

- **"Couldn't load usage…"** Refresh the page. If it keeps happening, tell the owner; the usage database update may not be installed.
- **Pro clients aren't syncing as often as usual.** Check the badge. **Slowed down** is expected near the limit. Use **Sync now** on a client when you need fresh numbers.
