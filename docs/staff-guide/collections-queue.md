---
title: How does the Collections Queue draft payment reminders?
section: QuickBooks
audience: staff
keywords: [collections, collections queue, overdue, receivables, a/r, accounts receivable, invoice, reminder, payment reminder, draft reminder, customer email, no email on file, financial overview, board-ready, live report, past due]
sort: 410
---
The **Collections Queue** sits on a Pro client's **Financial Overview** (formerly the Live Report), under the receivables aging. It lists the client's overdue invoices and drafts a friendly payment reminder for **one customer at a time**.

### Draft a reminder

1. Check an overdue invoice. That picks the customer. The line under the title shows the customer's name, how many invoices are selected, and the total.
2. To add that customer's other overdue invoices, check them too, or click **Select all from <customer>**.
3. Click **Draft Reminder**. The client's own email program opens a draft that:
   - is addressed to the customer's email from QuickBooks
   - starts "Hi <customer>,"
   - lists only the invoices you selected, with the total
   - is signed with the client's organization name
4. The client reads the draft and sends it from their own email. **Nothing is sent from the portal.**

### Why only one customer at a time

A reminder that listed several customers would show each of them what the others owe. So if you check an invoice from a different customer, it **replaces** what you had selected instead of adding to it. With nothing checked, the button reads **Select a customer** and can't be clicked.

### "No email on file in QuickBooks"

The email comes from the customer record in QuickBooks: the customer's main email address, or else the billing email on the invoice. If neither is filled in, the draft opens with a blank **To** line and the queue says so. You can either:

- add the email to the customer in QuickBooks. It shows up after the next sync (see [How do I connect a client's QuickBooks and use Sync now?](#/help/quickbooks-connection)), or
- type the address into the draft before sending.

The portal only reads from QuickBooks. It never changes customer records there.

### Sample data

For a client without QuickBooks connected, the queue uses sample invoices. These have no email addresses, so the draft opens with a blank **To** line.
