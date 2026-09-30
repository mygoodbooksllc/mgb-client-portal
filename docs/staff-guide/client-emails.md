---
title: How do I manage client emails?
section: Admin
audience: admin
keywords: [emails page, client emails, send client emails, missing-documents reminders, monthly value report, value report, reply-to, opt out, unsubscribe, resubscribe, send log, test email]
sort: 570
---
The **Emails** page (**Settings → Firm settings → Emails**, admins only) shows whether email works, the weekly digest, client emails and the send log.

### Is email working?

The banner at the top says so. **Email sending works** is what you want. Other messages (for example that the key is missing, or the domain isn't verified yet) need the owner. **Check the key** tests the setup without sending anything.

### Client email switches

In the **Client emails** card:

| Switch | What it does |
|---|---|
| **Send client emails** | Master switch. Off stops every client email, including tests. |
| **Missing-documents reminders** | Daily at 10 AM. Emails a client about open document requests on day 0, day 3, day 7, then weekly until uploaded. |
| **Monthly value report** | On the 3rd: last month's hours, tasks completed, month-end close status and documents received. |

> **The Monthly value report is off by default.** Nothing goes out until an admin ticks it. Preview it for a few clients first.

Test clients never get client emails. Nothing in these emails shows fees, rates or margins.

### Other settings

- **Replies go to**: the address clients reply to. Click **Save**.
- **Preview or send yourself a test**: pick a client, then **Preview** (opens in a new tab and tells you whether this client would get it) or **Send test to me**.
- **Per client** table: tick **No emails**, **No reminders** or **No value report** to opt a single client out, or **Reminders paused** to pause their document reminders.
- **Unsubscribed by the recipient**: people who clicked unsubscribe. Only click **Resubscribe** if they asked to get emails again.

### Send log

At the bottom: every digest run and client email attempt, newest first. Filter by type (Weekly digest, Document reminder, Value report) and status.

### Troubleshooting

- **"Wouldn't send right now: …"** The preview explains why (for example the client is opted out or it's a test client).
- **"Email isn't configured yet…"** Only the owner can fix this.
