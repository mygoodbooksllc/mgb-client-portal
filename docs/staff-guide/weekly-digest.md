---
title: How does the weekly digest email work?
section: Admin
audience: admin
keywords: [weekly digest, staff feedback, bug reports, quickbooks api usage, intuit limit, digest, monday email, recipients, preview, send test, scope creep, late payers, timesheet gaps, scorecard, needs attention, failed syncs, failed emails, fee changes, milestone suggestions]
sort: 560
---
The weekly digest is an email for admins covering scope creep, pricing, revenue, late payers, timesheet gaps, the staff scorecard, stale clients, pending items and staff feedback. It's sent **Mondays at 7:00 AM (America/New York)**.

The pending items include a **QuickBooks API usage** line: calls this month, the percent of Intuit's monthly limit, the month-end projection and how often Pro clients sync. It's flagged if syncing has been slowed down, and in red if scheduled syncs are stopped until next month (Sync now still works). It's the same as the card on Team; see [How do I read the QuickBooks API usage card?](#/help/quickbooks-api-usage).

The **Staff feedback** section shows how many bug reports and ideas are still marked **New** (for example "3 new: 2 bugs, 1 idea"), how many came in over the last 7 days, and the 5 newest **New** reports with who sent them and the start of their message. Click **Open the Feedback page** to triage them; see [How do I review bug reports and feedback?](#/help/feedback-page). If nothing is waiting it says "No new feedback."

### Needs attention

When something has gone wrong in the past 7 days, a **Needs attention** section appears at the top of the digest. It lists QuickBooks syncs that failed (with the last error), connections that need a reconnect, clients whose syncs are overdue for their plan, client or admin emails that failed to send, QuickBooks API usage close to Intuit's limit, and health-check alerts that are still open. If nothing is wrong, the section is left out. Test clients are never included. For problems that can't wait until Monday, see [What are the health-check alert emails?](#/help/health-alerts).

### Fee changes to review

**Fee changes to review** lists clients whose numbers now point to a different pricing milestone than the one confirmed, for example *Foundation ($300/mo) → Advanced ($800/mo)*, and says whether transactions or the budget drove it. Fees can go down as well as up. It's a suggestion only: no fee changes and no client is emailed until someone confirms the new milestone in **Client details → Milestone**. It also says how many clients have no confirmed milestone yet. It's the same list as **Home → Milestones to review**; see [How do pricing milestones work?](#/help/pricing-milestones). If there's nothing to review, the section is left out.

Find it on **Emails** (**Settings → Firm settings → Emails**), in the **Weekly digest** card.

### Settings

- **On / Off**: turns the Monday send on or off.
- **Recipients (comma separated)**: who gets it. Click **Save**.

### Check it before Monday

- **Preview** opens the email in a new tab. Nothing is sent.
- **Send test now** sends it right away to the recipients, even when the digest is Off.

**Recent runs** shows the last five runs and whether each was Sent, Skipped (turned off), Failed, etc.

### Troubleshooting

- **"Email isn't configured yet…"** The email service key isn't set up. Only the owner can fix this; see the banner at the top of the Emails page.
- **"Not set up yet. The digest hasn't been installed on the server."** Tell the owner.
