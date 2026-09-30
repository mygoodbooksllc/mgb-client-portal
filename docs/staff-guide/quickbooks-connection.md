---
title: How do I connect a client's QuickBooks and use Sync now?
section: QuickBooks
audience: staff
keywords: [quickbooks, qbo, connect, sync, sync now, live, reconnect, disconnect, intuit, refresh, numbers, sample data, prototype]
sort: 400
---
When a client's QuickBooks Online is connected, their portal shows real numbers from QuickBooks instead of sample data. After that, the portal keeps itself up to date.

### Connect a client's QuickBooks

1. Open the client (**Choose a client** at the top left of the page). See [How do I find and open a client?](#/help/finding-a-client).
2. In the client's sidebar, click **Client details**, then the **QuickBooks** tab.
3. Click **Connect QuickBooks**.
4. Sign in to Intuit and pick the client's company when asked. Approve the connection.
5. You come back to the portal. The tab now says **Connected** and shows **Last synced …**.

The first sync can take a minute. Until it finishes, the pages may still show sample numbers.

### How to tell if a client is connected

At the top right of every client page:

- **● Live · synced N minutes ago** (Pro clients) or **Synced weekly · updated …** / **Synced monthly · updated …** (Plus and Basic clients) means the numbers are real QuickBooks numbers.
- A grey **Prototype · Sample Data** badge means QuickBooks isn't connected (or hasn't synced yet), so you're looking at sample numbers.

The **Client overview** also has a QuickBooks health card that shows the last sync, or **Not connected**.

### How often it syncs

The portal syncs on its own, based on the client's plan:

| Plan | Automatic sync |
|---|---|
| Basic | Monthly, on the 15th |
| Plus | Weekly |
| Pro | About every minute |

### Sync now

Use **Sync now** when you've just made changes in QuickBooks and want to see them right away.

- Click the sync pill in the top bar, next to the client picker (**Live · synced …** or **Synced weekly/monthly · updated …**; the whole pill is the Sync now button for staff). The numbers refresh in place. **Or**
- Go to **Client details → QuickBooks** and click **Sync now**. This one says "Reload to see the new numbers", so refresh the page afterwards.

Staff can sync any client, on any plan. (Clients can only use Sync now on the Pro plan.) On a phone, the sync pill stays in the page header.

Admins: if the top bar shows **QuickBooks syncs slowed** or **QuickBooks syncs stopped**, the firm is close to Intuit's monthly limit. Sync now still works. The **Team** page has the details.

A sync takes a few seconds. You can't start another one for the same client for about 60 seconds.

### Reconnect and Disconnect

On **Client details → QuickBooks**:

- **Reconnect** runs the Intuit sign-in again. Use it if syncing keeps failing.
- **Disconnect** stops syncing that client. Only do this if you're sure, for example when a client leaves.

When you click **Disconnect**, the portal asks you to confirm first. Data that already synced stays in the portal. To reconnect later, click **Connect QuickBooks** and go through the Intuit sign-in again.

### Troubleshooting

- **"Last sync: …" shows an error in red.** Try **Sync now**. If the error comes back, click **Reconnect** and sign in to Intuit again.
- **"Connection failed".** Click **Try again** and go through the Intuit sign-in again.
- **Sync now doesn't seem to do anything.** You may have synced in the last 60 seconds ("Already synced within the last minute."). Wait a minute and try again. If you used Client details → Sync now, reload the page.
- **"QuickBooks needs to be reconnected before it can sync."** Go to Client details → QuickBooks and click **Reconnect**.
- **Some numbers still say sample.** Giving, funds, pledges, donors and payroll don't come from QuickBooks yet, so those pages still show sample data. Reconciliation data and account numbers aren't synced either.
