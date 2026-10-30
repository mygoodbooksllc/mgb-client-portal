-- Client page drop staff guide rows: six articles, targeted replace() updates, body_md only.
-- NOT APPLIED: apply at launch, when the owner turns tk_settings.client_page_drop_enabled on with
-- client_page_drop_pilot = "all". Before running, replace DATE in the whats-new heading (here and in
-- docs/staff-guide/drafts/staff-guide-client-page-drop.md) with the launch day.
-- Articles: add-documents, client-portal, google-drive-files, client-tour, tips, whats-new.
-- Each update swaps an anchor of the live row for the new text, only when the row does not already contain
-- the marker (a re-run is a no-op); the DO block raises (and rolls back) when a row is missing, an anchor moved,
-- or the marker is not there afterwards. No deletes. body_plain is generated: not touched.
-- Text source: docs/staff-guide/drafts/staff-guide-client-page-drop.md ("Ready to paste"); paste the same text
-- into the repo files so the guide sync check still matches. Generated from that file; regenerate, don't hand-edit.
-- Verify afterward: select slug from staff_guide where body_md ilike '%Clients can drop files anywhere%' or body_md ilike '%Names and who can see a file%' or body_md ilike '%Each file''s ⋯ renames it%';
do $guard$
begin
  if not exists (select 1 from public.staff_guide where slug = 'add-documents') then raise exception 'add-documents: row missing'; end if;
  if position($m$### Clients can drop files anywhere too$m$ in (select body_md from public.staff_guide where slug = 'add-documents')) = 0 then
    if position($a$### Places that take drops themselves

Dropping onto the **Documents** upload box, a message thread or the **Feedback** page works the way it always has there. The drop box doesn't open on top of another open window, while you're previewing a client user, or for client users.
$a$ in (select body_md from public.staff_guide where slug = 'add-documents')) = 0 then raise exception 'add-documents: anchor not found, regenerate'; end if;
    update public.staff_guide set body_md = replace(body_md, $a$### Places that take drops themselves

Dropping onto the **Documents** upload box, a message thread or the **Feedback** page works the way it always has there. The drop box doesn't open on top of another open window, while you're previewing a client user, or for client users.
$a$, $n$### Places that take drops themselves

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
$n$), updated_at = now() where slug = 'add-documents';
  end if;
  if position($m$### Clients can drop files anywhere too$m$ in (select body_md from public.staff_guide where slug = 'add-documents')) = 0 then raise exception 'add-documents: post-check failed'; end if;
  if not exists (select 1 from public.staff_guide where slug = 'client-portal') then raise exception 'client-portal: row missing'; end if;
  if position($m$tap **+ Add a file** on a phone), name it$m$ in (select body_md from public.staff_guide where slug = 'client-portal')) = 0 then
    if position($a$- **Documents** is where they upload what you ask for. On Basic they can also drop files on Home and say where they go.
$a$ in (select body_md from public.staff_guide where slug = 'client-portal')) = 0 then raise exception 'client-portal: anchor not found, regenerate'; end if;
    update public.staff_guide set body_md = replace(body_md, $a$- **Documents** is where they upload what you ask for. On Basic they can also drop files on Home and say where they go.
$a$, $n$- **Documents** is where they upload what you ask for. They can also drop a file on any page (or tap **+ Add a file** on a phone), name it, pick a folder and choose who at their organization can see it; see [How do I add, file, hide or delete a client's documents?](#/help/add-documents). On Basic, Home's own drop box still asks where the file goes.
$n$), updated_at = now() where slug = 'client-portal';
  end if;
  if position($m$tap **+ Add a file** on a phone), name it$m$ in (select body_md from public.staff_guide where slug = 'client-portal')) = 0 then raise exception 'client-portal: post-check failed'; end if;
  if not exists (select 1 from public.staff_guide where slug = 'google-drive-files') then raise exception 'google-drive-files: row missing'; end if;
  if position($m$### Names and who can see a file$m$ in (select body_md from public.staff_guide where slug = 'google-drive-files')) = 0 then
    if position($a$### Trash and restore$a$ in (select body_md from public.staff_guide where slug = 'google-drive-files')) = 0 then raise exception 'google-drive-files: anchor not found, regenerate'; end if;
    update public.staff_guide set body_md = replace(body_md, $a$### Trash and restore$a$, $n$### Names and who can see a file

- A file can have a portal name that differs from its Google Drive name (a client names it when they upload it, or staff **Rename** it). Drive keeps the original name; staff see it in gray under the portal name.
- A file can be limited to some of the client's logins (**Only these people** or **Everyone except these people**). The rule lives in the portal, not in Drive: nobody gets Google access either way, and MyGoodBooks staff always see every file.
- Download links the portal makes last 10 minutes.

### Trash and restore$n$), updated_at = now() where slug = 'google-drive-files';
  end if;
  if position($m$### Names and who can see a file$m$ in (select body_md from public.staff_guide where slug = 'google-drive-files')) = 0 then raise exception 'google-drive-files: post-check failed'; end if;
  if not exists (select 1 from public.staff_guide where slug = 'client-tour') then raise exception 'client-tour: row missing'; end if;
  if position($m$drop a file anywhere and choose who can see it$m$ in (select body_md from public.staff_guide where slug = 'client-tour')) = 0 then
    if position($a$| **Documents**: upload what you ask for | If they have it | If they have it | If they have it | If they have it |
$a$ in (select body_md from public.staff_guide where slug = 'client-tour')) = 0 then raise exception 'client-tour: anchor not found, regenerate'; end if;
    update public.staff_guide set body_md = replace(body_md, $a$| **Documents**: upload what you ask for | If they have it | If they have it | If they have it | If they have it |
$a$, $n$| **Documents**: upload what you ask for, and (once page drop is on for them) drop a file anywhere and choose who can see it | If they have it | If they have it | If they have it | If they have it |
$n$), updated_at = now() where slug = 'client-tour';
  end if;
  if position($m$drop a file anywhere and choose who can see it$m$ in (select body_md from public.staff_guide where slug = 'client-tour')) = 0 then raise exception 'client-tour: post-check failed'; end if;
  if not exists (select 1 from public.staff_guide where slug = 'tips') then raise exception 'tips: row missing'; end if;
  if position($m$Each file's ⋯ renames it$m$ in (select body_md from public.staff_guide where slug = 'tips')) = 0 then
    if position($a$| A client's Documents | Signed agreements live here, with their renewal dates. New ones start Staff only; clients see nothing until the owner turns client agreements on. | [Client agreements](#/help/client-agreements) |
$a$ in (select body_md from public.staff_guide where slug = 'tips')) = 0 then raise exception 'tips: anchor not found, regenerate'; end if;
    update public.staff_guide set body_md = replace(body_md, $a$| A client's Documents | Signed agreements live here, with their renewal dates. New ones start Staff only; clients see nothing until the owner turns client agreements on. | [Client agreements](#/help/client-agreements) |
$a$, $n$| A client's Documents | Signed agreements live here, with their renewal dates. New ones start Staff only; clients see nothing until the owner turns client agreements on. | [Client agreements](#/help/client-agreements) |
| A client's Documents | Each file's ⋯ renames it, sets who at the client can see it, replaces it with a new version, copies a link or shows its history. Tick files to move several at once. | [How do I add, file, hide or delete a client's documents?](#/help/add-documents) |
$n$), updated_at = now() where slug = 'tips';
  end if;
  if position($m$Each file's ⋯ renames it$m$ in (select body_md from public.staff_guide where slug = 'tips')) = 0 then raise exception 'tips: post-check failed'; end if;
  if not exists (select 1 from public.staff_guide where slug = 'whats-new') then raise exception 'whats-new: row missing'; end if;
  if position($m$Clients can drop files anywhere$m$ in (select body_md from public.staff_guide where slug = 'whats-new')) = 0 then
    if position($a$so a tour is never lost once its notice is gone.

$a$ in (select body_md from public.staff_guide where slug = 'whats-new')) = 0 then raise exception 'whats-new: anchor not found, regenerate'; end if;
    update public.staff_guide set body_md = replace(body_md, $a$so a tour is never lost once its notice is gone.

$a$, $n$so a tour is never lost once its notice is gone.

### DATE: Clients can drop files anywhere
- **Clients drop a file on any page** of their portal (or tap **+ Add a file** on a phone), then pick a folder, a name, and who at their organization can see it: everyone, only some people, or everyone except some people. MyGoodBooks staff always see every file. Uploads show on the Desk's Inbox like any client file.
- **On a client's Documents page**, each file's **⋯** has **Rename**, **Who can see it**, **Replace with a new version**, **Copy link** and **History**. Tick several files to move them together, and **✎** renames a folder. See [How do I add, file, hide or delete a client's documents?](#/help/add-documents).

$n$), updated_at = now() where slug = 'whats-new';
  end if;
  if position($m$Clients can drop files anywhere$m$ in (select body_md from public.staff_guide where slug = 'whats-new')) = 0 then raise exception 'whats-new: post-check failed'; end if;
end
$guard$;
