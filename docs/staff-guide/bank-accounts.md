---
title: What does the client's Bank Accounts page show?
section: Working with a client
audience: staff
keywords: [bank accounts, bank, cash, cash on hand, credit card, card balances, owed, net cash, transactions, search, filter, this month, last month, 90 days, money in, money out, card charge, sign, recent activity, show more, export csv, type, category, category filter, uncategorized, split, last synced, reconciliation, ask, question]
sort: 215
---
**Bank Accounts** is one of the client's own pages (the **Bank** tab in the client's tab row), so the client sees the same page you do.

### The three numbers at the top

- **Cash on hand**: the total in the client's bank accounts (checking, savings and so on). Credit cards are **not** counted as cash.
- **Card balances (owed)**: what the client owes on their credit cards.
- **Net cash**: cash on hand minus card balances. It turns red if the cards owe more than the bank holds.

The same rule applies everywhere else in the app. Cash on the dashboard, in reports, in the budget and on the Financial Overview counts bank accounts only. On the balance sheet PDF, card balances appear under liabilities.

### Accounts

The **Accounts** card lists every account in two groups, **Cash** and **Cards**, each with its total. The bar under each account shows its share of the group.

- Click an account to show only its transactions. Click it again, or click **All accounts**, to go back to everything.
- The line under the title says how fresh the data is, for example *Last synced 2 hours ago · Synced from QuickBooks every 15 minutes*. How often it syncs depends on the client's plan. Clients who aren't connected to QuickBooks yet show sample data.

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
- Categories come in with each QuickBooks sync, so right after this change a QuickBooks client may show only **Type** until their next sync. How often that is depends on the plan: every 15 minutes on Pro, monthly (on the 15th) on Basic. Until then the category filter is hidden.
- Clients can ask about a transaction from its row. A **Question** tag marks rows with an open question. See *How do I answer a client's question about a transaction?*
- The list shows 50 rows at a time. Click **Show more** to load the next 50.
- **Export CSV** downloads every transaction that matches the current filters, not just the rows on screen, including the Category and Type columns.

You can still add a staff note to any transaction with the note button next to its description. Picking a transaction from the top bar search opens this page, picks the account, clears the filters and highlights the row.

### Reconciliation

On clients with Reconciliation Pro, a **Transactions / Reconciliation** toggle at the top switches to the reconciliation view. It works one account at a time, the same as before.
