---
title: How do I connect a client's QuickBooks and use Sync now?
section: QuickBooks
audience: staff
keywords: [quickbooks, connect failed, couldn't finish connecting, error id, not set up for this account type, production keys, sandbox company, test client sandbox, where the money went, expenses by account, no expenses recorded, qbo, sync schedule, every hour, every 2 hours, intuit limit, connect, sync, sync now, no limit for staff, sync pill, reconnect, client setup, disconnect, intuit, refresh, numbers, sample data, prototype, setting up, giving, tithes, offerings, giving accounts, funds, fund accounts, restricted, unrestricted, fund balances, donor statements, tax documents, year-end giving statement, last year, anonymous, pledges]
sort: 400
---
When a client's QuickBooks Online is connected, their portal shows real numbers from QuickBooks instead of sample data. After that, the portal keeps itself up to date.

### Connect a client's QuickBooks

1. Open the client (**Choose a client** at the top left of the page). See [How do I find and open a client?](#/help/finding-a-client).
2. Click **Client setup** at the right end of the client's tab row, then **Access and details → Client details → Open**, then the **QuickBooks** tab. A **Connect** or **Reconnect** link on the Overview, the Close tab or the Bank tab opens this tab for you.
3. Click **Connect QuickBooks**.
4. Sign in to Intuit and pick the client's company when asked. Approve the connection.
5. You come back to the portal. The tab now says **Connected** and shows **Last synced …**.

The first sync can take a minute. Until it finishes, the pages may still show sample numbers.

**Test clients vs. real clients.** A test client connects to an Intuit **sandbox** (test) company, not a real one, so use it to practice. Real clients connect to their real QuickBooks company. The firm's own QuickBooks (Team › QuickBooks Time) also connects to a real company. Which kind of connection you get depends on the client; there's nothing to choose.

**If connecting fails.**

- A red message on the QuickBooks tab such as **Production QuickBooks keys aren't set up yet — ask an admin.** means an admin has to finish the setup first. Tell an admin.
- If the page after Intuit says **We couldn't finish connecting QuickBooks. Ask an admin to retry. Error id: …**, give an admin that error id. A connection that ended in an error can simply be connected again: click **Connect QuickBooks** (or **Reconnect**) again.
- If it says **QuickBooks isn't set up for this account type yet. Ask an admin.**, an admin needs to finish setup for that type of account (test or real).

### How to tell if a client is connected

At the top right of every client page:

- **Every hour · synced 5m ago** (Pro clients) or **Synced monthly · synced …** (Basic) means the numbers are real QuickBooks numbers. The first part is how often that plan syncs; the second is when it last did. Pro isn't instant: it syncs every hour, so a change made in QuickBooks can take up to an hour (2 hours when the firm is near its Intuit limit) to show unless you use **Sync now**.
- A gray **Setting up — connecting QuickBooks** badge (just **Setting up** on a phone) means a real client isn't connected yet (or hasn't synced yet). They see empty pages, never sample numbers.
- A gray **Prototype · Sample Data** badge is the same thing for a test client. Test clients show sample numbers until QuickBooks is connected.

The **Client overview** status line also shows the last sync (*QuickBooks synced 2 hours ago*), or **QuickBooks not connected** with a **Connect** link, or **QuickBooks needs reconnecting** with a **Reconnect** link.

### How often it syncs

The portal syncs on its own, based on the client's plan:

| Plan | Automatic sync |
|---|---|
| Basic | Monthly, on the 15th |
| Pro | Every hour (every 2 hours if the firm is near its Intuit limit) |

If the firm uses 95% of its Intuit monthly limit, automatic syncs pause until the 1st; **Sync now** still works. Admins can see usage on Team › Hours.

Month-close data (used by the QuickBooks check on each client's Close tab and the stale-bank flags on Work › Close) refreshes daily. Staff also refresh it whenever they use **Sync now**, on any plan.

### Sync now

Use **Sync now** when you've just made changes in QuickBooks and want to see them right away.

- Click the sync pill in the top bar, next to the client picker (**Every hour · synced …** or **Synced monthly · synced …**; the whole pill is the Sync now button for staff). The numbers refresh in place. **Or**
- Click **Sync now** on the client's Overview status line, the **Bank** tab's sync line or the **Close** tab's QuickBooks check. Same button, same result. **Or**
- Go to **Client details → QuickBooks** and click **Sync now**. This one says "Reload to see the new numbers", so refresh the page afterwards.

Staff can sync any client, on any plan, as often as they like. There's no wait between syncs for staff. A Basic client's automatic sync is monthly, so their numbers can be weeks old until you click **Sync now**. (Clients can only use Sync now on the Pro plan, and they have to wait about 60 seconds between syncs.) On a phone, the sync pill stays in the page header.

Admins: if the top bar shows **QuickBooks syncs slowed** or **QuickBooks syncs stopped**, the firm is close to Intuit's monthly limit. Sync now still works. The **Team** page has the details.

A sync takes a few seconds. Staff can start another straight away. A Pro client has to wait about 60 seconds.

### Giving from QuickBooks

For a connected client, the **Giving** page shows tithes and offerings from QuickBooks, as of the last sync:

- **This month so far**, **Last month**, **Year to date** and **Last 12 months**.
- **Giving by month**: a bar for each of the last 12 months. The lighter bar is this month so far.
- **By account**: each giving account's total.
- **Recent giving**: transactions posted to the giving accounts in the last 90 days. A deposit split across several accounts isn't listed, but it is in the totals.

It only reads from QuickBooks. Nothing is written back.

**Which accounts count as giving.** By default, any income account with a name like tithe, offering, contribution, donation, giving, pledge or gift. To choose them yourself, go to **Client details → QuickBooks** and, under **Giving accounts**, tick the income accounts that count, then click **Save giving accounts**. **Go back to automatic** undoes your pick. This is a portal setting only; nothing changes in QuickBooks. The Giving page and the dashboard Giving card update straight away.

If no income account matches, the Giving page says **No giving accounts found in QuickBooks yet**. Pick the accounts as above.

QuickBooks only syncs the last 12 months of the profit and loss, so year to date can't go back further than that, and there's no comparison with last year yet.

### Funds from QuickBooks

Fund balances come from the QuickBooks chart of accounts, as of the last sync. Nothing is written back to QuickBooks.

**Which accounts are funds.** By default, any active equity or asset account with "fund" or "restricted" in its name (never "Undeposited Funds"). To choose them yourself, go to **Client details → QuickBooks** and, under **Fund accounts**, tick the accounts that are funds. Each picked account is marked **Restricted** or **Unrestricted**. The portal guesses from the name (names with "restricted" but not "unrestricted" start as Restricted) and you can switch it. Click **Save fund accounts**; **Go back to automatic** undoes your pick. This is a portal setting only. If a picked account is later renamed or removed in QuickBooks, it shows as "(no longer in QuickBooks)" so you can fix the pick.

If no account matches, the Funds section says **Funds appear here once your bookkeeper sets them up**. Staff also see a pointer to the Fund accounts picker.

**Pro clients** get the full Giving & Funds page, filled from QuickBooks:

- **Giving Year to Date**, **Unrestricted Funds**, **Restricted Funds** and **Giving · Last 12 Months** at the top.
- **Fund Balances**: each fund account with its balance.
- **Giving**: the monthly bars and by-account table.
- **Contributions**: every gift posted to the giving accounts for the full calendar year, newest first, not just the last 90 days. It uses the same year picker as Tax Documents (this year or last year). The donor is the QuickBooks customer or payer on the transaction ("Anonymous" when there isn't one, for example most bank deposits), with sub-customers listed under their parent customer. Refunds show as negative amounts.
- **Fund Activity**: each fund's balance. Transfers between funds aren't synced from QuickBooks, so they aren't listed.
- **Tax Documents**: full calendar-year giving by donor, for year-end giving statements. Pick **this year or last year** at the top. Each donor shows their number of gifts and total, and **Download** gives a statement with the church's name and every gift (date, fund or account, memo, amount). The donor is the QuickBooks customer or payer on the gift. Sub-customers (QuickBooks names them "Parent:Child") are combined under their parent customer, and each gift on the statement notes the sub-customer in the memo column. Every statement ends with the line "No goods or services were provided in exchange for these contributions." Donors whose total for the year is $0 or negative (for example, fully refunded) are hidden and get no statement; the note under the table says how many. Refunds for other donors stay on their statement and in their total, so it matches QuickBooks. Gifts with no name (most bank deposits) are grouped under **Anonymous / no donor in QuickBooks** and can't go on a statement. To include them, record the donor as the customer in QuickBooks. Totals are as of the last sync: this year's giving refreshes about once a day and whenever you press **Sync now**, and last year's refreshes daily through February 15. Statements aren't emailed from the portal. Download, send it yourself, then click **Mark sent**. **Mark sent** is only remembered on your computer. Clients limited to certain ministries or funds don't see donor giving.
- **Pledges** is hidden for QuickBooks clients, because QuickBooks has no pledges.

Basic clients see the simpler Giving page with the Funds section. The dashboard **Fund balances** card uses the same accounts.

### Reconnect and Disconnect

On **Client details → QuickBooks**:

- **Reconnect** runs the Intuit sign-in again. Use it if syncing keeps failing.
- **Disconnect** stops syncing that client. Only do this if you're sure, for example when a client leaves.

When you click **Disconnect**, the portal asks you to confirm first. Data that already synced stays in the portal. To reconnect later, click **Connect QuickBooks** and go through the Intuit sign-in again.

### Troubleshooting

- **"Last sync: …" shows an error in red.** Try **Sync now**. If the error comes back, click **Reconnect** and sign in to Intuit again.
- **"Connection failed" or "We couldn't finish connecting QuickBooks".** Click **Connect QuickBooks** or **Reconnect** and go through the Intuit sign-in again. If it fails again, ask an admin to retry and quote the **Error id** shown on the page.
- **Sync now doesn't seem to do anything.** A sync takes a few seconds. If you used Client details → Sync now, reload the page to see the new numbers. A Pro client who clicks it twice within a minute sees "Already up to date with QuickBooks."
- **"QuickBooks needs to be reconnected. Reconnect it from Client setup."** Go to **Client setup › Client details → QuickBooks** and click **Reconnect**.
- **A dashboard card says "No expenses recorded this month yet." (or "No open invoices right now.").** That's real: QuickBooks has nothing for that card yet. **Where the money went** shows this month's expenses by QuickBooks account (the six biggest, the rest as **Other**), so it stays empty until the first expense of the month is entered in QuickBooks and the next sync runs. It doesn't need a QuickBooks budget.
- **Some numbers still say sample.** Funds, pledges, donors and payroll don't come from QuickBooks yet. Test clients still show sample data there; real clients see "Funds appear here once your bookkeeper sets them up" and "Payroll appears here once it's connected". Account numbers aren't synced either. (Reconciliation is estimated for the close checks; see [How do I track month-end close?](#/help/month-end-close).)
