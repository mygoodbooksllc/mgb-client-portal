---
title: Frequently asked questions
section: Help and FAQ
audience: staff
keywords: [faq, cash flow, net position, owed to you, bills to pay, bill number, receivables aging, giving, tax documents, mark sent, giving statement, year to date, limited access, ministry, expenses by account, stale bank, bank feed, questions, help, sample data, prototype, can clients see, log time, hours, password, access, missing client, not working]
sort: 900
---
### Can clients see my notes, tasks or the Client overview?

No. The Client overview, staff notes, internal notes in the Inbox, SOPs, My Tasks and the top bar are staff-only. Clients only see what you deliberately send them: document requests (on their Documents page), messages sent as **Reply** (not **Note**), and client emails.

### Why does a page say "Prototype · Sample Data"?

That's a test client whose QuickBooks isn't connected (or hasn't synced yet), so the numbers are made up. Connect QuickBooks to show real numbers. See [How do I connect a client's QuickBooks and use Sync now?](#/help/quickbooks-connection).

A real client is never shown sample numbers or "prototype" wording. Until their QuickBooks is connected, the badge says **Setting up — connecting QuickBooks** and pages are empty (Giving says "Giving appears here once QuickBooks is connected").

This holds even when a real client's id matches one of the built-in sample clients: a real client never picks up sample data.

Giving and funds come from QuickBooks for connected clients (see [Funds from QuickBooks](#/help/quickbooks-connection)). Some areas are still sample data on test clients: pledges, donors on unconnected test clients, and payroll (real clients see an empty state there instead); message threads in the Client overview's Engagement card; and uploads on the client's own Documents page (files uploaded into a document request are stored for real). Reconciliation status is only estimated (for the Close tracker's QuickBooks checks).

### What do the client's Cash Flow numbers mean?

- **Owed To You, Less What You Owe** (it used to say "Net Position") is open receivables minus open payables. It is not cash.
- Invoices and bills show the number from QuickBooks (for example *Bill #1043*). Until the next QuickBooks sync fills those numbers in, a bill shows its date instead (*Bill dated 2026-08-10*); the app no longer makes up a number.
- Lists with more than 5 items get a search box and sorting (due date, amount, name), flag how many days each item is overdue, and show 25 at a time with **Show more**.
- On the AP page for a QuickBooks client, the list is **Bills to Pay**: it's for planning only, nothing is paid or sent from the app, and **Export List (CSV)** downloads the selection. **Receivables Aging** and **Who Owes You** cards sit alongside.

### Does "Mark sent" on the Giving page email the donor?

No. On **Tax Documents**, download the giving statement, send it yourself, then click **Mark sent** (or **Mark All Sent**) to record that it went out. Year-to-date giving counts only gifts from January 1 of this year through today.

### Why doesn't a limited-access person see the income chart or cash flow?

People limited to certain ministries (categories) only see their own areas. Org-wide numbers (monthly income and expense history, receivables, payables, bank accounts, reports and payroll) are hidden for them, and the Budget trend view says so instead of showing the whole church's history. This is enforced by the database too, not just hidden on screen: their sign-in can only read QuickBooks rows for the categories and funds they've been given. That includes bank and credit card accounts: they can't read account names or balances unless that account is one of their categories or funds. Their dashboard's recent activity list still shows their own transactions from the last two months (bank and card activity posted to their categories), just without the account names or balances.

### Where does the dashboard's "Expenses by account" list come from?

For a QuickBooks client it's the Profit & Loss lines for the chart's latest month (month to date if the month isn't over), the same numbers as the P&L report. It shows the top 8 accounts and rolls the rest into one line. Sample clients show their budget actuals.

### What does the red "Stale bank" chip mean?

One of the client's bank or card accounts has had no transaction in QuickBooks for more than 10 days (admins can change the number with **Stale bank after (days)**). The bank feed has probably stopped. Reconnect the feed in QuickBooks, then click **Sync now** on the client. Hover over the chip to see which account. See [How do I track month-end close?](#/help/month-end-close).

### How do I log my hours?

You don't log hours in this app. Keep using **QuickBooks Time** as usual; hours sync from there. The app also records "in-app" time automatically, which is not billed. See [How is my time tracked?](#/help/quickbooks-time-and-app-time).

### A client is missing from my client list.

Bookkeepers only see their assigned clients. Ask an admin to assign it to you on Team → Members, or request temporary access. See [How do I get temporary access to a client I don't normally work on?](#/help/temporary-access).

### Where do I keep client passwords?

Not in the portal. In the SOP's **Access & logins** section, note *where* the password is kept (for example the password manager entry name), never the password itself.

### Does "Mark sent to client" email the report?

No. It only records that you sent it. Send the report yourself first.

### Does the app send staff invitations?

No. On Team → Members, **Email invite** opens a draft in Gmail or your mail app for an admin to send.

### Is "Manage access" / Client details access enforced?

Real portal logins (the client's people in Client details) are enforced at sign-in. On a test client the people listed may be samples for preview only, and the window says so.

### What's the difference between the Close tracker and the Month-end close checklist?

The checklist (on Client overview) is the six steps for one client this month. The Close tracker is the status of every client, month by month. They're separate; update both. See [How do I track month-end close?](#/help/month-end-close).

### Something says "…database update is applied" or "…isn't set up on the server yet".

A feature's database update hasn't been installed. Nothing is wrong with your account. Tell an admin or the owner.

### I'm stuck or found a bug.

Ask an admin, or email admin@mygoodbooks.org.
