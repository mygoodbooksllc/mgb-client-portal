# Client page drop + Documents upgrades: DRAFT guide text

Draft for the hidden build (per-person preview `mgb_clientdrop_preview`, Developer tools › Feature flags › **Client page drop + Documents upgrades preview**; owner-only firm switch `tk_settings.client_page_drop_enabled` plus `client_page_drop_pilot`). **Published 2026-10-31**: the text below went into `docs/staff-guide/*.md` and the `staff_guide` table at launch, when the switch went on with the pilot set to `"all"`. Spec: `docs/client-page-drop.md`.

Already in the code, shown only while the feature is on for that person:

- **Client tour**, Documents stop (`Tour.jsx`, `TOUR_clientDropOn()`): mentions dropping anywhere and choosing who can see a file, only for a client login whose `client_page_drop_state()` says enabled, or a staff member previewing a client with the preview flag on. Everyone else keeps the old wording.
- **Tip** `docs-row-menu` (`Tips.jsx`): waits for a file's ⋯ (`data-tour="doc-row-menu"`), which renders only with the preview or the switch on.
- **Staff notice** `client-page-drop` (`announcements.js`): shows only once the switch is on (`mgb_clientdrop_cache` has `enabled: true`), never to a preview person alone and never in View as.

Launch day:

1. Change the `client-page-drop` entry's `date` in `components/tour/announcements.js`, and the `### 2026-10-31:` heading below and in `supabase/staff-guide-client-page-drop.sql`, to the day you flip the switch.
2. Paste each "Ready to paste" block into the live file named, and run `supabase/staff-guide-client-page-drop.sql` (upserts only, guarded; a re-run is a no-op).
3. Add `drop anywhere, add a file, who can see it, only these people, everyone except, rename file, replace file, copy link, file history, move several files, rename folder` to the keywords of `add-documents.md`, and `who can see it, only some people, add a file` to `client-portal.md`.
4. Send the client notice (below) the way the owner prefers: the portal has no client next-visit notice, so it goes in the monthly summary or a message.

## Ready to paste (launch)

### docs/staff-guide/add-documents.md: replace the section `### Places that take drops themselves` (heading and its one paragraph) with

````markdown
### Places that take drops themselves

Dropping onto the **Documents** upload box, a message thread or the **Feedback** page works the way it always has there. The drop box doesn't open on top of another open window, while you're previewing a client user, or for client users.

### Clients can drop files anywhere too

A client user with the **Documents** tab can drop a file on any page of their portal (on a Basic client's Home, Home's own drop box still handles it). On a phone they tap **+ Add a file** at the bottom left, on any page except Documents. A box called **Add to your documents** opens:

1. **Folder**: one of their folders, **No folder**, or **New folder…**.
2. **Name**: for a single file, starts as the file's name without the extension. It's the name everyone sees in Documents; the file in Google Drive keeps its own name.
3. **What it is for**: Bank statement, Credit card statement, Receipts, Invoices and bills, Tax documents or Something else, then the other document types. It picks the Google Drive folder, the same as **Document type** for staff.
4. **Who can see it**: **Everyone at {organization}** (the default), **Only these people** or **Everyone except these people**, with a list of their organization's logins. The person uploading is always on an **Only** list. Under it: *MyGoodBooks staff can always see your files.* Organizations with a single login don't see this choice.

Same limits as the Documents page: up to 10 files, 25 MB each, PDF, images, CSV, text, Excel or Word. If a file fails, the box stays open with just the failures so they can try again. Uploads show as a **New file** on the Desk's Inbox (**Files** filter) like any client upload. Nobody is emailed unless the owner turns on upload emails; then the client's account manager gets one (their own **A client uploads a requested document** choice in **Settings › Notifications** still applies).

**Who can see it, the rules:**

- A rule applies to every client login, full access included. Only MyGoodBooks staff see every file.
- Only the person who uploaded a file, or staff, can change its rule. On their Documents page the uploader sees **Only some people** or **Hidden from some people** on the row and a **Who can see** button.
- Someone left off a file doesn't see it in Documents, in search or anywhere else in the portal.
- If someone on an **Only** list loses their login, the box says so the next time the rule is opened and leaves them off. Someone on an **Everyone except** list stays hidden from the file even after their login goes, so the file never opens up to them by accident.

### More on a client's Documents page (staff)

- **Each file's ⋯** has **Rename**, **Who can see it**, **Replace with a new version**, **Copy link** and **History**.
  - **Rename** changes the name in the portal only. The Google Drive file keeps its name, shown in small gray text under the new name.
  - **Who can see it** sets the same rule clients can set. Staff can change it on any client file.
  - **Replace with a new version** uploads the new file with the same name, type, year, folder and rule, then moves the old one to **Trash**.
  - **Copy link** copies a link to the row. Anyone who opens it still needs access to this client.
  - **History** lists uploads, renames, rule changes, trash and restore, with who and when.
- **Tick files** (or the box in the header for all of them) to **Move to** a folder or **Move to Trash** together. **Clear** unticks them.
- A small tag beside the document type shows the kind of file: PDF, Excel, Word, Image and so on.
- **✎** on a folder renames it for everyone. Its files stay in it.
- **Visible to** shows a lock with **Only 2 people** or **Everyone except 1** for a file with a rule.
- When you upload on the Documents page, **Who can see: Everyone at the client** (next to **Drive folder**) sets a rule for those files. It shows once page drop is on for that client.
- In **View as**, files the person can't see (and staff-only files) are left out, and a chip says how many are hidden.
````

### docs/staff-guide/client-portal.md: replace the line starting `- **Documents** is where they upload what you ask for.` with

````markdown
- **Documents** is where they upload what you ask for. They can also drop a file on any page (or tap **+ Add a file** on a phone), name it, pick a folder and choose who at their organization can see it; see [How do I add, file, hide or delete a client's documents?](#/help/add-documents). On Basic, Home's own drop box still asks where the file goes.
````

### docs/staff-guide/google-drive-files.md: insert before `### Trash and restore`

````markdown
### Names and who can see a file

- A file can have a portal name that differs from its Google Drive name (a client names it when they upload it, or staff **Rename** it). Drive keeps the original name; staff see it in gray under the portal name.
- A file can be limited to some of the client's logins (**Only these people** or **Everyone except these people**). The rule lives in the portal, not in Drive: nobody gets Google access either way, and MyGoodBooks staff always see every file.
- Download links the portal makes last 10 minutes.

````

### docs/staff-guide/client-tour.md: replace the table row starting `| **Documents**: upload what you ask for |` with

````markdown
| **Documents**: upload what you ask for, and (once page drop is on for them) drop a file anywhere and choose who can see it | If they have it | If they have it | If they have it | If they have it |
````

### docs/staff-guide/tips.md: add a row after the two `| A client's Documents |` rows

````markdown
| A client's Documents | Each file's ⋯ renames it, sets who at the client can see it, replaces it with a new version, copies a link or shows its history. Tick files to move several at once. | [How do I add, file, hide or delete a client's documents?](#/help/add-documents) |
````

(Tips.jsx shows this text once the switch is on for the client. Before that, for preview staff, the tip reads: "Each file's ⋯ replaces it with a new version, copies a link or shows its history. Renaming and choosing who can see it turn on for this client at launch. Tick files to move several at once." Rename and Who can see it open read-only until then.)

### docs/staff-guide/whats-new.md: new top entry

````markdown
### 2026-10-31: Clients can drop files anywhere
- **Clients drop a file on any page** of their portal (or tap **+ Add a file** on a phone), then pick a folder, a name, and who at their organization can see it: everyone, only some people, or everyone except some people. MyGoodBooks staff always see every file. Uploads show on the Desk's Inbox like any client file.
- **On a client's Documents page**, each file's **⋯** has **Rename**, **Who can see it**, **Replace with a new version**, **Copy link** and **History**. Tick several files to move them together, and **✎** renames a folder. See [How do I add, file, hide or delete a client's documents?](#/help/add-documents).

````

## Client notice (one or two sentences, for the owner to send)

You can now add a file from any page of your portal: drag it in, or tap **Add a file** on your phone. Name it, pick a folder, and choose who at your organization can see it. MyGoodBooks can always see your files.

## Staff next-visit notice (wired, held)

The `summary` in the `client-page-drop` entry: Clients can now drop a file anywhere in the portal and choose its folder, name and who at their organization can see it. On a client's Documents page, each file's ⋯ renames it, sets who can see it, replaces it, copies a link or shows its history.
