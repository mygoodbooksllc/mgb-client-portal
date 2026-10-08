---
title: How do I set up Google Drive for staff reviews?
section: Admin
audience: admin
keywords: [staff reviews drive, shared drive, google drive, review pdf, export to drive, waiting for drive setup, service account, secret, GOOGLE_DRIVE_REVIEWS_DRIVE_ID, setup, drive status]
sort: 567
---
Signed review PDFs and confirmed year-end summaries save to a separate Shared Drive that only admins can open. Client files live somewhere else (see [Where are client files stored?](#/help/google-drive-files)).

### One-time setup

1. In Google Drive, create a Shared Drive named **~ MGB: Staff Reviews**.
2. Add the 4 admins as **Content manager**.
3. Add **mgb-portal-drive@mygoodbooks-auth.iam.gserviceaccount.com** as **Content manager** too. This is the portal's own account; it's the same one that saves client files.
4. Copy the Shared Drive's ID: open the drive and copy the last part of the address after `/folders/`.
5. In Supabase, go to **Edge Functions → Secrets** and add a secret named **GOOGLE_DRIVE_REVIEWS_DRIVE_ID** with that ID as its value.

### Check it

Go to **Reviews → Team status**. The **Google Drive** card at the bottom should say **Connected to** and the drive's name. Click **Check again** after changing anything.

### What lands where

- *{Staff Name} / {YYYY} Q{n} Review.pdf*: saved when a review's second signature lands.
- *{Staff Name} / {YYYY} Year-End Summary.pdf*: saved when an admin clicks **Export to Drive** on a confirmed summary.

The portal creates each person's folder the first time. Exporting again saves a new version of the same file, not a copy.

### If Drive isn't set up yet

Reviews still lock when both people sign. Team status shows **Waiting for Drive setup** under those reviews. Once the drive is connected, the portal saves those PDFs on its own within about an hour. To do it right away, open the review and click **Export to Drive**. Year-end summaries aren't retried on their own: click **Retry export** on Year-end.
