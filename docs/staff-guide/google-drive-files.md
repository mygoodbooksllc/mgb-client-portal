---
title: Where are client files stored? (Google Drive setup)
section: Admin
audience: admin
keywords: [google drive, drive, shared drive, mgb client files, file storage, storage, where are files, uploads, attachments, service account, json key, secret, setup, connect drive, file storage isn't connected, open in drive, drive trash, 30 days, restore, copy older files, folders, year, document type]
sort: 566
---
Client files live in the firm's Google Drive, in a Shared Drive called **~ MGB: Client Files (Portal)**. The portal only keeps a link to each file. Clients never get Google access: every file they open goes through the portal.

This covers files uploaded on a client's **Documents** page, files dropped anywhere in the staff app, uploads into a **document request**, and files attached to **messages**. Staff chat attachments, profile photos and Feedback screenshots stay in the portal's own storage.

### Where files land

Each client gets their own folder, then a year, then a document type:

> ~ MGB: Client Files (Portal) / **New Hope Fellowship** / **2026** / **Bank statements**

- The portal makes folders the first time it needs them.
- **Document type**: when staff upload on the Documents page or drop a file, pick it next to **Drive folder** (or **Document type** in the drop box). It starts on **Other**. Uploads into a document request are sorted by the request's name (for example *September bank statement* goes to **Bank statements**). Message attachments go to **Messages**.
- **Year**: this year, unless you pick another one, or the request's name has a year in it (*2025 W-2s* goes to **2025**).
- Renaming a client in the portal renames their Drive folder. It never makes a second folder.
- Staff see **Open in Drive** on each Drive file's row. Clients don't.

### Trash and restore

- The trash can on a Drive file moves it to the portal's **Trash** folder **and** to Google Drive's trash. **Restore** brings it back in both places.
- Google Drive empties its trash after **30 days**, so restore before then. After that you'll see *Google Drive has already emptied this file from its trash*.
- Drive files have no **Delete forever** button. The portal never deletes Drive files.

### Owner setup (one time)

This was done on Oct 7, 2026: the Google project is **MyGoodBooks Auth** and the service account is **mgb-portal-drive**. If Drive is ever disconnected (a secret removed or the key revoked), uploads stop and the upload box shows staff *File storage isn't connected yet; tell the owner.* Files already in Drive aren't affected.

1. In Google Drive, click **Shared drives** → **New**, and name it **~ MGB: Client Files (Portal)**.
2. Go to **console.cloud.google.com** and create a project (for example *MyGoodBooks portal*).
3. In that project, open **APIs & Services → Library**, search for **Google Drive API** and click **Enable**.
4. Open **IAM & Admin → Service accounts → Create service account**. Name it (for example *portal-files*) and click **Done**. You don't need to give it any roles.
5. Click the new service account → **Keys → Add key → Create new key → JSON**. A file downloads. Keep it private. If Google says *Service account key creation is disabled*, an organization policy blocks it: an org admin grants themselves **Organization Policy Administrator** on the organization, then under **IAM & Admin → Organization policies** sets **Disable service account key creation** (both the managed and the older version) to **Not enforced** for this project only.
6. Back in Google Drive, open the Shared Drive → **Manage members**. Add the service account's email (it ends in *.iam.gserviceaccount.com*) as **Content manager**.
7. Open the Shared Drive and copy the last part of its web address, after */folders/*. That's the Shared Drive ID.
8. In Supabase, open **Edge Functions → Secrets** and add:
   - **GOOGLE_SERVICE_ACCOUNT_JSON**: paste the whole JSON file from step 5.
   - **GOOGLE_DRIVE_SHARED_DRIVE_ID**: the ID from step 7.

   Then delete the JSON file from your computer and empty the Trash.
9. Upload a test file on a test client's Documents page. It should show **Open in Drive**, and the file should appear in Drive under the client's name.

### Older files

Files uploaded before Drive was connected stay in the portal's own storage and keep working. On a client's Documents page staff see **Copy {n} older files to Drive**. It copies up to 50 at a time into the right Drive folders and leaves the originals where they are. The page then shows the Drive copy.

### If something goes wrong

- *File storage isn't connected yet; tell the owner.*: a Drive secret was removed or changed. Uploads are paused until the owner fixes it.
- The [health-check alerts](#/help/health-alerts) email admin@mygoodbooks.org if 3 or more Drive uploads fail in an hour, or if Drive isn't connected while real (non-test) clients exist.
