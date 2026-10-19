---
title: What does the client's Bank Accounts page show?
section: Working with a client
audience: staff
keywords: [bank accounts, bank, bank on basic, sync now, reconnect, open questions, not reconciled, filter chips, cash, cash on hand, credit card, card balances, owed, net cash, transactions, search, filter, this month, last month, 90 days, money in, money out, card charge, sign, recent activity, show more, export csv, type, category, category filter, uncategorized, split, last synced, reconciliation, ask, question]
sort: 215
---
**Bank Accounts** is the **Bank** tab in the client's tab row. Staff see it on every client, on every plan, even when the client's own access hides it. A Basic client doesn't get a Bank page, so you may see Bank on a client who can't. When the client has the page, they see the same one you do, minus the staff extras below.

### The three numbers at the top

- **Cash on hand**: the total in the client's bank accounts (checking, savings and so on). Credit cards are **not** counted as cash.
- **Card balances (owed)**: what the client owes on their credit cards.
- **Net cash**: cash on hand minus card balances. It turns red if the cards owe more than the bank holds.

The same rule applies everywhere else in the app. Cash on the dashboard, in reports, in the budget and on the Financial Overview counts bank accounts only. On the balance sheet PDF, card balances appear under liabilities.

### Accounts

The **Accounts** card lists every account in two groups, **Cash** and **Cards**, each with its total. The bar under each account shows its share of the group.

- Click an account to show only its transactions. Click it again, or click **All accounts**, to go back to everything.
- The line under the title says how fresh the data is. Clients see, for example, *Last synced 2 hours ago · Synced from QuickBooks every hour*. How often it syncs depends on the client's plan. Staff see the plan's schedule instead, for example *Last synced 24 days ago · Basic syncs monthly, on the 15th*, with a **Sync now** button next to it. A Basic client's data can be weeks old, so click **Sync now** before you rely on it. Staff have no limit on **Sync now**, on any plan. Clients who aren't connected to QuickBooks yet show sample data.

### Transactions

The page opens with **all accounts**, most recent first. When no account is picked, there's an **Account** column so you can tell them apart.

- **Search** looks in the description, memo, category and type.
- **This month**, **Last month**, **90 days** or **All** limits the dates.
- **All**, **In** or **Out** shows everything, only money coming in, or only money going out.
- **All categories** opens a checklist of the categories on the page, each with a count. Tick one or more to show only those; **Clear** shows everything again. The button then reads, for example, *2 categories*.
- The totals line under the filters shows the number of transactions, money in, money out and the net for whatever is showing.
- Credit card rows read the same way as bank rows: a charge is money **out** (minus) and a card payment or refund is money **in** (plus). QuickBooks itself shows card charges as plus amounts, because the balance owed goes up, so the signs here are the reverse of the QuickBooks card register. The dashboard's **Recent Activity** uses the same signs.
- **Category** is the account the transaction was posted to in QuickBooks (for example *Utilities* or *Tithes & Offerings*). A transaction spread over several accounts shows **Split (several accounts)**, and one with no category shows *Uncategorized*.
- **Type** is the QuickBooks transaction type, such as Deposit, Check or Expense.
- Categories come in with each QuickBooks sync, so right after this change a QuickBooks client may show only **Type** until their next sync. How often that is depends on the plan: every hour on Pro, monthly (on the 15th) on Basic. Until then the category filter is hidden.
- Clients can ask about a transaction from its row. A **Question** tag marks rows with an open question. See *How do I answer a client's question about a transaction?*
- The list shows 50 rows at a time. Click **Show more** to load the next 50.
- **Export CSV** downloads every transaction that matches the current filters, not just the rows on screen, including the Category and Type columns.

You can still add a staff note to any transaction with the note button next to its description. Picking a transaction from the top bar search opens this page, picks the account, clears the filters and highlights the row.

### Reconciliation

On clients with Reconciliation Pro, a **Transactions / Reconciliation** toggle at the top switches to the reconciliation view. It is read-only: it shows the balances and outstanding items, with a downloadable reconciliation PDF, and nothing is cleared or closed from it. It works one account at a time.

### For staff: links, filters and sync

Links from other places open Bank already filtered. You'll see a chip above the totals for each filter, and a **×** on each chip to remove it.

- **Uncategorized**: from the Close tab (its QuickBooks check and the **Bank feed categorized** step) and the Overview status line. With a month chip such as *September 2026*, it shows that month's uncategorized transactions. QuickBooks counts every kind of transaction as uncategorized, not just bank ones, so Bank may show fewer.
- **Open questions**: from the **Open questions** chip on the Overview. It shows the transactions with an open client question. If some open questions are on older transactions, a line says so (*{n} more open questions are on older transactions*) and lists them below. Questions on a recent transaction Bank isn't showing (voided or deleted in QuickBooks) get their own line, *{n} open questions are on transactions Bank isn't showing*, and are listed there too. Both lines sit right under the **Transactions** card. The number on the **Bank** tab counts the same open questions. See [How do I answer a client's question about a transaction?](#/help/transaction-questions).
- **Not reconciled**: from the Close tab, for one account and month. If Bank can't tell which rows are reconciled it says *Bank can't tell which rows are reconciled. Check them in QuickBooks.*
- Bank only shows the last 90 days. For an older month it says *Bank shows the last 90 days. Check QuickBooks for {Month}.*
- If the synced data stops before the end of the month you're looking at, it says *These numbers stop at {date}. Sync now to see the rest of {Month}.*

**When QuickBooks isn't working:**

- **QuickBooks isn't connected yet**: there are no bank accounts to show. Click **Connect QuickBooks** to open the QuickBooks part of **Client setup**.
- **QuickBooks needs to be reconnected**: a red banner sits above the old numbers (*These numbers stopped updating on {date}*). Click **Reconnect QuickBooks**. With no synced data at all, the whole page shows the reconnect message instead.
- **Getting the first sync ready**: the connection is fine, and the first sync hasn't finished. Click **Sync now**.
