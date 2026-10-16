---
title: How do I manage client emails?
section: Admin
audience: admin
keywords: [emails page, client emails, send client emails, missing-documents reminders, monthly value report, value report, reply-to, opt out, unsubscribe, resubscribe, send log, test email, ask client, client requests, request reminders, dry run, test copy, pilot, pilot list, client_request_enabled, request emails, ask client emails live, owner only, turn on ask client emails]
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
| **Ask client emails live** | **Owner only.** Off (the default): every Ask client email and reminder to a real client is a dry run. On: they go to real clients in the pilot list only. |

### Ask client emails live (owner only)

Requests sent from a task (**Ask client**) and their reminders are a dry run, logged as *skipped*, until the owner turns on **Ask client emails live**. It is the last row under **Send client emails**.

- **Who can flip it.** Only the owner. Everyone else sees the row greyed out with **Owner only**. The database refuses anyone else too.
- **Turning it on** asks you to confirm and says exactly who will be emailed: the real clients in the **pilot list**, to the portal users and contacts picked on each request. Every other real client stays a dry run. **Turning it off** is immediate.
- **Pilot.** The line under the row shows the pilot list: **not set** or **empty** (no real client gets these emails, even with the switch on), **All real clients (N)**, or **N clients** with their names.
- **Test clients** always get one **[Test]** copy, sent only to the staff member who clicked send. They get no automatic reminders.
- **Send client emails** must be on too.
- The line under the row also says who last turned it on or off and when. Every change is kept.

Automatic reminders go out each morning once a request has waited a few business days, up to four. See [How do I ask a client something from a task?](#/help/ask-client).

> **The Monthly value report is off by default.** Nothing goes out until an admin ticks it. Preview it for a few clients first.

Test clients never get the automatic client emails (reminders and the value report). **Send test to me**, and **Ask client** on a test client, send one **[Test]** copy to you only. Nothing in these emails shows fees, rates or margins.

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
