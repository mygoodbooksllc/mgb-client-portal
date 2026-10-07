---
title: What are the health-check alert emails?
section: Admin
audience: admin
keywords: [alert, health check, outage, sync failing, sync errors, overdue sync, reconnect, quickbooks disconnected, failed emails, usage stopped, google drive, drive uploads failing, file storage not connected, resolved, uptime, uptimerobot, admin@mygoodbooks.org, monitoring, down]
sort: 565
---
The app checks itself **every 15 minutes**. If something is wrong, it emails **admin@mygoodbooks.org** right away, with a subject starting **"MyGoodBooks alert:"**. Clients are never emailed.

### What it watches

- **QuickBooks syncs failing**: a client's sync has failed 2 or more times in a row. The email includes the last error.
- **QuickBooks syncs overdue**: a client hasn't synced in twice their plan's normal gap (Pro every 15 minutes, Plus weekly, Basic monthly on the 15th). This is skipped while scheduled syncs are stopped by the API usage limit.
- **QuickBooks needs reconnecting**: a client's connection was revoked or expired.
- **Scheduled syncs not running**: the sync job itself hasn't run in over 20 minutes.
- **QuickBooks API usage stopped**: scheduled syncs are stopped until next month because the firm hit its Intuit limit (Sync now still works). See [How do I read the QuickBooks API usage card?](#/help/quickbooks-api-usage).
- **Emails failing**: 3 or more emails failed to send in the last hour.
- **Google Drive uploads failing**: 3 or more client file uploads to Google Drive failed in the last hour.
- **Google Drive not connected**: client file storage isn't connected (or Google refused the portal's key) while real, non-test clients exist. See [Where are client files stored?](#/help/google-drive-files).

Test clients never trigger an alert.

### How often you'll hear about it

- At most **one email per problem per 24 hours**. If it's still happening a day later, you get a reminder marked "still happening".
- When a problem clears, you get one **"MyGoodBooks: resolved"** note.
- The Monday [weekly digest](#/help/weekly-digest) also lists the week's problems in **Needs attention**.

### What to do

- **Syncs failing / needs reconnecting**: open the client, check the QuickBooks connection and click **Sync now**; reconnect if asked. See [How do I connect a client's QuickBooks?](#/help/quickbooks-connection).
- **Scheduled syncs not running** or **Emails failing**: tell the owner.
- **Google Drive uploads failing** or **not connected**: the owner checks the Drive setup in [Where are client files stored?](#/help/google-drive-files).

### What it can't see

If the whole app or its database is down, the check can't run, so it can't email. The owner sets up a separate outside uptime monitor for that.
