---
title: Usage stats and Developer tools
section: Admin
audience: staff
keywords: [usage stats, usage, analytics, page views, active users, last seen, quiet clients, developer tools, dev tools, feature flags, unreleased, scheduled jobs, cron, run now, errors, error log, test email, app version, reload, where things live, export csv, delivery, opened, clicked, webhook]
sort: 560
---
Two admin pages under **Settings › Firm settings › Insight and records**, next to the [Audit log](#/help/audit-log). Search (**Ctrl+K** / **⌘K**) jumps to each one too.

### Usage stats

Counts come straight from the database for the range you pick (7, 30 or 90 days, or all time), so the numbers are exact.

- **Most-used pages** ranks every page and tab (for example **Team › Performance**), with the staff and client split.
- **Trend** shows the last eight weeks of page views and how many different people were in each week.
- **Active people** shows how many staff and clients signed in over the last 7 and 30 days, then everyone by last seen. **Quiet clients** lists client organizations with no sign-in for 30 days or more, or none ever. That's a good list to nudge.
- **Actions** counts things people did rather than pages they opened: search opened with **Ctrl+K**, guide searches, guide searches that found nothing (the queries are listed so you can add an article), **Help for this page**, and tours finished or skipped.
- **Devices** splits views across desktop, phone and the installed app.
- **Export CSV** downloads the page and people tables for the range.
- **Feature feedback** at the bottom is the in-app survey, with **Copy summary for Claude**.

### Developer tools

- **Feature flags** are per-browser testing switches: force every client to Pro, verbose console logging, a simulated slow network, and **Show unreleased features** (currently the **Install app** prompt). Nothing here changes anything for anyone else.
- **Reset local state** clears this browser's saved layouts, theme, tour and tips. Feature flags stay.
- **Scheduled jobs** lists every automatic job (email outbox, digest, QuickBooks sync, health checks, chasers) with its schedule, last run and result. **Run now** starts one immediately. A red **failed** means the last run errored; **Run now** and read the message.
- **Recent errors** are errors the app caught in someone's browser: when, who, which page, app version and the message. Click one for the technical detail. Send that to whoever is fixing the app.
- **Send me a test email** sends a short email to your own address so you can confirm the firm's sender works.
- **System info** shows the app version with **Reload for the latest**, which Supabase project the app talks to, and whether the staff table and audit log can be read.
- **Where things live** links to GitHub, Supabase, Vercel, Google Cloud, GoDaddy, Squarespace, Resend, the client-files Google Drive and the Intuit developer dashboard. Credentials are in the 1Password vault, never here.

### Emails › Delivery

The **Emails** page shows delivered, opened, clicked and bounced counts for the last 30 days once the Resend webhook is set up (Resend › Webhooks, pointed at the portal's `resend-webhook` function). Until then the card says so.
