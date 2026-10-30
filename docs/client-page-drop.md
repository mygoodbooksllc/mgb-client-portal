# Client page drop: spec

Status: BUILT 2026-10-30 behind the preview flag mgb_clientdrop_preview and the owner-only switch client_page_drop_enabled (off). Phase 1 (database + drive-files v8) 4a1d1a6; Phase 2 (UI + upkeep) in the commit that added this file.
Date: 2026-10-30
Size: Big (new RLS, a security-definer helper and an edge function change). Opus does the spec, build, critique and final verify. Sonnet does upkeep edits. Haiku does screenshot and grep sweeps.

Where this file lives: `docs/specs/` does not exist in the working tree or on origin/main. Specs live flat in `docs/`. So this file is in the session scratchpad. When the build starts, move it to `docs/client-page-drop.md`.

Code citations come from an origin/main snapshot. Line numbers are origin/main as of 2026-10-30.

---

## Goal

A client can drop a file anywhere in the portal. A dialog then asks four things:

1. Where it goes: an existing Documents folder, or none.
2. Its name.
3. What it is for: a designation, which is the Drive document type.
4. Who in the client's organization can see it: everyone, only these logins, or everyone except these logins.

MyGoodBooks staff always see every file.

---

## 1. How client Documents work today

### Storage

- The file of record lives in Google Drive. The Shared Drive is "~ MGB: Client Files (Portal)", with the path `<Client>/<Year>/<Document type>`.
- Supabase keeps only the `client_files` metadata row (`components/files/DriveFiles.js:1-27`).
- `DRV_STORAGE_FALLBACK = false` (`DriveFiles.js:29`). The `client-uploads` Storage bucket is legacy, read-only history.
- The browser never talks to Google. Every action goes through the `drive-files` edge function: `DRV_fetch` / `DRV_call` (`DriveFiles.js:77-103`) and `DRV_upload` (`DriveFiles.js:154-165`).
- `DRV_upload` sends these FormData fields: `file`, `client_id`, `visibility`, `doc_type`, `year`, `request_id`, `participant`, `internal`.

### Tables (live columns, checked with SELECT on 2026-10-30)

| Table | Columns that matter here |
|---|---|
| `client_files` | id, client_id, drive_file_id, drive_folder_id, name, mime, size, year, doc_type, visibility (`shared`/`internal`/`request`/`message`), participant_email, request_id, message_id, client_request_id, uploaded_by, uploaded_at, trashed_at, trashed_by, legacy_path |
| `client_documents` (staff-added links) | id, client_id, name, drive_url, category, added_by, created_at, trashed_at |
| `document_folders` | PK (client_id, name). Name is 1-60 characters. Also sort, created_by. |
| `document_folder_items` | PK (client_id, doc_key), plus folder. FK (client_id, folder) points to document_folders, with cascade on update and delete. |
| `client_users` | **PK email**, so one login belongs to exactly one client. Also client_id, name, role, active, access (`full`/`scoped`), tabs[], categories[], funds[], premium_throttled. |

- DDL: `supabase/google-drive-files.sql:54-78`.
- Browsers get SELECT only on `client_files`. Every write goes through the service role in the edge function (`google-drive-files.sql:80-83`).
- Folder membership is keyed by `doc_key`. Examples: `drive:<uuid>`, `file:<stored>`, `file:internal/<stored>`, `link:<id>`, `sample:<name>`. See `DF_assign` in `components/client/DocFolders.jsx:107-126`, which upserts on `(client_id, doc_key)`.

### RLS (live policy text)

`client_files` "client reads own files" (SELECT). Originally `google-drive-files.sql:92-102`, last replaced by `security-hardening-2026-10-27.sql:52-140`:

```
trashed_at IS NULL AND is_client_member(client_id) AND (
     visibility = 'shared'
  OR (visibility = 'request' AND client_file_request_visible(client_id, client_request_id))
  OR (visibility = 'message' AND participant_email = lower(jwt email)))
```

Other policies:

- `client_files` "staff read client files": `(select is_active_staff()) AND can_access_client(client_id)` (`google-drive-files.sql:86-88`).
- `client_files` "internal company lock" (ALL): `client_id NOT IN internal_blocked_ids()`.
- `document_folders`: clients have ALL with `is_client_member(client_id)`. Clients can create, rename and delete folders. Staff have ALL with `can_access_client`.
- `document_folder_items`: clients have ALL with `is_client_member(client_id) AND doc_key NOT LIKE 'file:internal/%'`. Staff have ALL.
- `client_users`: a client reads only their own row. Staff read, insert and update with `can_access_client`. Admins have ALL.

Helpers. All are SECURITY DEFINER with `search_path=public`.

- `is_client_member(client_id)`: there is an active `client_users` row for the jwt email and that client, and the client is not internal.
- `can_access_client(client_id)`: the caller is an admin, or has `staff_client_access`, or has an approved unexpired grant. Internal clients also need can_view_internal.
- `is_active_staff()`: `jwt_has_google()` and an active staff row.
- `client_file_request_visible`: the caller is a full-access member, or is in the request's recipient_emails.

### Who sees what today

- Every active login of the org sees every `shared` file. There is no per-login control.
- Category or fund scoping (`supabase/client-scope-rls.sql:1-55`) covers reports and transactions, not `client_files`.
- `internal` files are staff only.
- `message` files are visible to the participant plus staff.
- `request` files are visible to full-access members, plus recipients of that request.

### Upload paths that exist for clients

- **Documents page dropzone**: `DocumentsPage` `addFiles` (`app.jsx:23184-23254`).
  - It always sends `docType: "Other"` (`app.jsx:23220`) and `visibility: "shared"`.
  - It files into the open folder via `DF_assign`.
  - Toast: "Your bookkeeper can see it now."
  - The dropzone card calls `preventDefault` on dragover and drop (`app.jsx:23489-23506`).
  - The upload button carries `data-tour="doc-upload"` (`app.jsx:23566`).
- **Basic plan Home page-wide drop**: `components/client/BasicHome.jsx`. This is an existing client page drop, but only on the Basic dashboard.
  - Mount: `app.jsx:30938-30946`, with `canUpload={access.tabs.has("documents")}`.
  - Window listeners with a depth counter and an 800 ms safety timer (`BasicHome.jsx:223-287`).
  - It honors `defaultPrevented` and steps aside when another dialog is open.
  - `beforeunload` guard while uploading (`BasicHome.jsx:290-298`).
  - Uploads one file at a time with per-file pending, uploading, done and failed states (`BasicHome.jsx:302-345`).
  - Chooser modal `BH_Chooser` with a focus trap, Esc and "Add more files" (`BasicHome.jsx:32-172`).
  - Pure rules in `components/client/basicHomeLogic.js`:
    - `BH_checkFile` (lines 69-82) checks extension, MIME agreement, empty files and the 25 MB cap.
    - `BH_pickFiles` (lines 90-107) removes duplicates.
    - `BH_dragHasFiles` (lines 110-115).
    - `BH_DESTINATIONS` (lines 41-48) maps buttons to doc types.
  - Tested in `basicHomeLogic.test.js` against `drive-files/logic.ts`.
- **Messages card drop** (`app.jsx:24415-24430`). It attaches to a message, not to Documents.

### Listing and download

- `DocumentsPage` merges four sources:
  - sample docs
  - `client_documents` links (`app.jsx:22894-22899`)
  - legacy Storage (`app.jsx:22900-22909`)
  - Drive via `DRV_list(client.id, "documents")` (`app.jsx:22888-22892`)
- `driveRow` (`app.jsx:22957-22979`) shows "Staff only" for internal files, otherwise `doc_type`. A non-staff uploader shows as "Your organization".
- `drive-files` `doList` (`supabase/functions/drive-files/index.ts:267-295`) queries **as the user**, so RLS is the gate.
- `doLink` (`index.ts:297-309`) runs an RLS-checked select, then issues HMAC link tokens that live 10 minutes (`logic.ts` LINK_TTL_SEC 600).
- `doGet` (`index.ts:311-335`) streams the file only after the token verifies.
- So any extra rule added to the client SELECT policy automatically hides the file from the list and blocks download links. No list or link code changes are needed.

### Existing gap to note (not caused by this feature)

- The `tabs[]` setting on a scoped login is enforced only in the UI for uploads.
- `doUpload` checks `is_client_member` only (`index.ts:111-241`, member check near line 130). The shared SELECT policy ignores `tabs[]`.
- A scoped login without the Documents tab can still upload or read shared files through the API.
- Recommendation: fix this in the same migration (see 3.6), because the new feature widens who uses page drop.

---

## 2. How staff PageDrop works, and what clients reuse

`components/staff/PageDrop.jsx` (348 lines):

- **Limits**:
  - `PD_MAX_BYTES` is 25 MB and `PD_MAX_FILES = 10` (lines 31-32).
  - The `PD_TYPES` / `PD_EXT_TYPES` type map is at lines 35-57.
  - `PD_typeOf`, `PD_problem` and `PD_hasFiles` are at lines 59-75.
- **Upload**: `PD_uploadDocs(sb, clientId, files, {staffOnly, folder, docType, year})` (lines 78-119).
  - It calls `DRV_useStorage()`.
  - Then `DRV_upload({visibility: staffOnly ? "internal" : "shared", docType, year})` for each file.
  - It collects `"drive:"+res.file.id` keys, then calls `DF_load` and `DF_assign` into the chosen folder.
  - Backend: the same `drive-files` edge function, so the same Drive path and `client_files` row.
- **Dialog**: `PD_ConfirmModal` (lines 121-292).
  - Fields: client picker, folder from `DF_load`, Drive doc type and year (only when `DRV_status()` is true), and a "Visible to client" switch.
  - On success it dispatches `PD_DOCS_CHANGED_EVENT = "mgb:docs-changed"` (line 30). DocumentsPage listens for it (`app.jsx:23031-23037`).
- **Listener**: `PD_PageDrop` (lines 296-348) uses window `dragover` and `drop`.
  - `blocked()` is true while busy, or when `.modal-overlay, [aria-modal='true']` is present.
  - It steps aside when `e.defaultPrevented`.
  - The overlay says "Drop to add to X's documents".
- **Mount**: `app.jsx:30322-30333`. It is enabled only when `isStaffSession && !isPreviewingUser` and not on the team feedback page.
  - `isStaffSession = !clientPortalUser` (`app.jsx:29448`)
  - `isPreviewingUser` (`app.jsx:29444`)

### Reuse for clients

| Reuse as is | Do not reuse |
|---|---|
| `DRV_upload`, `DRV_useStorage`, `DRV_DOC_TYPES` (`DriveFiles.js:37-52`) | The PD client picker (a client has exactly one org) |
| `DF_load`, `DF_assign` (`DocFolders.jsx:21-68`, `107-126`) | The `staffOnly` / internal switch (the server rejects internal from clients at `index.ts:134`) |
| `PD_DOCS_CHANGED_EVENT` to refresh Documents | The Year picker (keep the server default year; staff can refile) |
| `BH_checkFile`, `BH_pickFiles`, `BH_dragHasFiles`, `BH_sizeLabel`, `BH_ACCEPT` | `PD_problem` (BH_checkFile is stricter, already tested and client-worded) |
| BasicHome's depth-counter listener, focus trap, `beforeunload`, per-file progress loop | |

---

## 3. What is missing for per-login allow and deny, and the minimum schema plus RLS

### 3.1 Missing today

1. There is no per-file login rule. `shared` means the whole org.
2. There is no display name. `client_files.name` is always `file.name`, set by the edge function.
3. Clients cannot list their org's logins. The `client_users` policy is "client reads own row", and no client-facing RPC exists. Checked live: there is no `client_*users*` or org-members function except `st_my_client_user`, which returns only the caller.
4. Documents uploads always send doc_type "Other".

### 3.2 Schema (additive only)

```sql
-- On client_files: the rule mode. Default keeps every existing row as today.
alter table public.client_files
  add column access_mode text not null default 'everyone'
    check (access_mode in ('everyone','only','except')),
  add column display_name text check (display_name is null or length(display_name) between 1 and 200);

-- The logins named by an 'only' or 'except' rule.
create table public.client_file_access (
  file_id    uuid not null references public.client_files(id) on delete cascade,
  client_id  text not null,
  email      text not null check (email = lower(email)),
  created_by text not null,
  created_at timestamptz not null default now(),
  primary key (file_id, email),
  foreign key (email) references public.client_users(email) on delete cascade
);
alter table public.client_file_access enable row level security;
-- No insert/update/delete policies: browsers cannot write it. Writes go only
-- through the drive-files service role or the security-definer RPC in 3.5.
```

Integrity trigger `cfa_guard` (BEFORE INSERT OR UPDATE on `client_file_access`):

- `client_id` must equal `client_files.client_id` for `file_id`.
- `email` must be a `client_users` row whose `client_id` is that same client.
- This stops a cross-org email from ever being listed.

Rule checks live in one SQL function, `cfa_validate(file_id)`. The upload path and the change RPC call it after writing, inside the same transaction.

- If the mode is `only`, the uploader's email must be on the list, and the list must not be empty.
- If the mode is `except`, the uploader's email must not be on the list.

Why a child table rather than a `text[]` column:

- The FK to `client_users` keeps the list honest.
- A login that is deleted drops off the list automatically.

### 3.3 RLS helper (security definer)

```sql
create or replace function public.client_file_login_ok(p_file_id uuid, p_mode text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select case p_mode
    when 'everyone' then true
    when 'only'   then exists (select 1 from client_file_access a
                               where a.file_id = p_file_id
                                 and a.email = lower(auth.jwt() ->> 'email'))
    when 'except' then not exists (select 1 from client_file_access a
                               where a.file_id = p_file_id
                                 and a.email = lower(auth.jwt() ->> 'email'))
    else false end;
$$;
revoke all on function public.client_file_login_ok(uuid, text) from public, anon;
grant execute on function public.client_file_login_ok(uuid, text) to authenticated;
```

Security notes:

- The function answers only for the **caller's own jwt email**. There is no email argument, so it cannot be used to probe other logins.
- An unknown mode fails closed.

### 3.4 Policy change (replace one policy, staff untouched)

Replace "client reads own files" with the live text plus one clause on the `shared` branch:

```
OR (visibility = 'shared' AND client_file_login_ok(id, access_mode))
```

These stay byte-for-byte unchanged, so staff access can never be narrowed by a client rule:

- "staff read client files"
- "internal company lock"
- `request` / `message` branches

Notes:

- The helper takes row arguments, so it is per row, not an initplan. Client file counts are small (hundreds), so this is fine.
- Add an index on `client_file_access(file_id)`; the PK already covers it.

`client_file_access` SELECT policy, so a login can render a "Shared with" chip:

- Staff: `is_active_staff() AND can_access_client(client_id)`.
- Clients:
  - Only for files the caller can read (`exists (select 1 from client_files f where f.id = file_id)`, which is itself RLS-filtered).
  - Only when the caller is the file's uploader. Other logins never see who was excluded.

### 3.5 Writes

**At upload**: the `drive-files` `doUpload` (`index.ts:111-241`) accepts three new optional form fields:

- `display_name`
- `access_mode`
- `access_emails`, a JSON array

Server-side rules, in order:

1. The existing member or staff check is unchanged. The caller must pass `is_client_member(client_id)` or staff. A client cannot name another client's id.
2. Only `visibility = 'shared'` may carry a non-`everyone` mode. Any other combination returns 400.
3. Lowercase and de-duplicate the emails. Cap at 50.
4. Fetch the `client_users` rows with the service role, filtered to `client_id = <client_id> AND active`. Any email not found returns 400 `bad_access_list`. This blocks cross-org widening at the API, and the trigger in 3.2 blocks it again at the DB.
5. For a client uploader: force-add their own email for `only`, and reject their own email for `except`.
6. `doc_type` is normalized by the existing `normalizeDocType`. Unknown values become "Other".
7. Insert `client_files`, then insert `client_file_access`. Wrap both in one RPC (`cfa_insert_file_with_access`, service role only) so a failure leaves no half row. On failure, trash the Drive file as today.

**After upload**: a new RPC `client_file_set_access(p_file_id uuid, p_mode text, p_emails text[])`. It is SECURITY DEFINER, revoked from anon, granted to authenticated.

- Allowed callers:
  - Staff with `can_access_client(file.client_id)`.
  - The client login who uploaded the file (`uploaded_by = jwt email`) and is still `is_client_member`. See owner question 2 for whether full-access logins also get this.
- It applies the same validation as upload.
- It writes `drive_file_events` with action `access_changed` for the audit trail.
- It never touches staff policies or columns.

**Display-name rename**: fold this into the same RPC as an optional `p_display_name`, or add a small separate RPC with the same rules.

### 3.6 Fix the existing tabs gap (recommended, same migration)

Add `client_docs_tab_ok(client_id)`: a SECURITY DEFINER, STABLE function with no row arguments, used as `(select ...)`. It returns true for full access, or when tabs[] contains `documents`.

- Add it to the client `shared` branch.
- Check it in `doUpload` for non-staff callers.
- This matches what the UI already promises (`resolveAccess`, `app.jsx:1642`; `BASIC_TAB_KEYS` at `app.jsx:1551`).

### 3.7 Folder items

- A restricted file's `document_folder_items` row (`drive:<uuid>`) stays readable org-wide.
- That leaks only an opaque id, not the name or contents, because the client row is not in the list for that login. Acceptable.
- Optional hardening: add to the client policy on `document_folder_items` that a `drive:` key must map to a readable `client_files` row. Skip this unless the critique asks for it.

### 3.8 Org login list for the dialog

New RPC: `client_org_logins()`. It is SECURITY DEFINER, STABLE, revoked from anon, granted to authenticated.

- It takes **no client argument**. It derives `client_id` from the caller's own active `client_users` row.
- It returns `email, name, is_me` for active logins of that client only.
- Staff do not need it, because they read `client_users` directly (`components/tasks/TK_api.js:2489`).
- It does not expose role, access, tabs or funds.

### 3.9 Security risks and how each is closed

| Risk | Closed by |
|---|---|
| A client reads another client's files | Unchanged `is_client_member(client_id)` in the policy. The new helper only narrows. List and link go through RLS (`index.ts:267-309`). |
| A client widens access beyond their org | There is no mode that adds outsiders. Emails are validated against same-client `client_users` in the edge function, the trigger and the FK. `client_org_logins()` derives the org from the jwt. |
| A client removes staff access | Staff policies untouched. The helper is referenced only in the client policy. `internal` is still staff-only at `index.ts:134`. |
| Rules enforced only in the UI | Enforced in RLS (3.4), which list, link and download (token issued after an RLS select) all pass through. |
| Probing who is excluded | The helper checks only the caller. `client_file_access` is readable only by staff and the uploader. |
| Function search_path hijack | All new functions set `search_path = public` and are revoked from public and anon. |
| Half-written rows | A single RPC inserts both rows. Drive trash on failure, as today. |
| Desk inbox leaks | `wb_inbox` is staff-only (`workbench-1-core.sql:416-430`), so it is unaffected. |
| Other security-definer readers of `client_files` | Checked live: `client_requests_for_client` and `tk_attach_client_file` are staff- or request-scoped. Re-verify in critique with a grep for `from client_files` in `supabase/*.sql`. |

Tests: add `supabase/client-page-drop-tests.sql` using the `pg_temp.ok` style from `security-hardening-tests.sql`. Cover:

- An `only` file is visible to a listed login and hidden from an unlisted one.
- An `except` file is the reverse.
- Staff see both.
- Another org's login sees neither.
- A cross-org email insert fails.
- `client_file_set_access` from a non-uploader client fails.
- `client_org_logins()` never returns another org.
- A scoped login without the documents tab sees no shared files (3.6).

---

## 4. UI plan

### 4.1 Listener and mount

New file: `components/client/ClientPageDrop.jsx`, with prefix `CPD_`. Load it in `index.html` after `BasicHome.jsx` and `DocFolders.jsx`, before `app.jsx`.

Mount it in `app.jsx` next to `PD_PageDrop` (around line 30322):

```
<CPD_ClientPageDrop
  enabled={!isStaffSession && access.tabs.has("documents") && cpdOn && !basicHomeOwnsPage}
  client={client} sb={supabase} />
```

- `basicHomeOwnsPage` is true on the Basic dashboard, where BasicHome already owns the page drop (`app.jsx:30938`). There is never a second overlay there.
- Staff "View as" (`isPreviewingUser`) does **not** mount it. Staff keep their own PD_PageDrop. View-as is read-only.

Listener behavior, copied from the BasicHome pattern (`BasicHome.jsx:223-298`):

- Uses window `dragenter`, `dragover`, `dragleave`, `drop`, `dragend` and `blur`.
- A depth counter plus an 800 ms reset timer.
- It reacts only when `BH_dragHasFiles(e.dataTransfer)`.
- **No double firing**: it returns early when `e.defaultPrevented`. That covers:
  - the Documents dropzone (`app.jsx:23489-23506`)
  - the Messages card drop (`app.jsx:24415-24430`)
  - WidgetDrawer (`WidgetDrawer.jsx:381-391`, `598-610`)
- It also returns early when a dialog is already open (`.modal-overlay, [aria-modal='true']`, excluding its own) or while it is busy.
- Gap to handle: the Messages card skips `preventDefault` on dragover when unavailable or read-only (`app.jsx:24415-24420`), but its drop always calls preventDefault. So the overlay may show over Messages, but a drop there still goes to Messages. Fix this in the build by also skipping when the drag target is inside `[data-drop-owner]`, and add that attribute to the Messages card and the Documents dropzone.
- The overlay is a portal saying "Drop to add to your documents". It reuses the `.bh-drop` styles via a shared class.

### 4.2 Dialog (modal, focus trap, Esc closes when idle)

| Field | Detail |
|---|---|
| Files | List with size (`BH_sizeLabel`). Remove per file. "Add more files" uses `BH_ACCEPT`. Rejected files are listed with the `BH_checkFile` reason. |
| Folder | `DF_load(sb, client.id)` folders plus "No folder". Default is "No folder", or the open folder if on Documents. Clients can create folders today (policy), so offer "New folder..." using `DF_NewFolderModal` (max 60). |
| Name | Shown only for a single file. Defaults to the file name without extension, 1-200 characters, and is saved as `display_name`. Multiple files keep their own names. |
| What it is for | Select from `DRV_DOC_TYPES` (`DriveFiles.js:37-52`). Default "Other". Show the BasicHome friendly labels first (`BH_DESTINATIONS`, `basicHomeLogic.js:41-48`), then "More types". |
| Who can see it | Radio: **Everyone at <Org>** (default), **Only these people**, **Everyone except these people**. A checklist comes from `client_org_logins()`. "You" is locked on for Only and hidden for Except. A line under it says "MyGoodBooks staff can always see your files." If the org has one login, hide this field. |

### 4.3 Limits, progress and errors

- Up to 10 files per drop (matches `PD_MAX_FILES`), 25 MB each, and the `BH_TYPES` list. The server checks again (`logic.ts` MAX_BYTES and ALLOWED_TYPES).
- Upload one file at a time with per-file pending, uploading, done and failed rows, as in BasicHome's run loop (`BasicHome.jsx:302-345`). Use `beforeunload` while busy.
- If any file fails, the dialog stays open with Retry on the failed rows. Done rows are kept.
- Map errors to plain text:
  - `drive_not_connected` becomes "File storage is down for a moment. Try again shortly."
  - `bad_access_list` becomes "One of those people no longer has a login. Refresh and try again."
  - 413 becomes "Over 25 MB."
- On success:
  - Dispatch `PD_DOCS_CHANGED_EVENT` so an open Documents page refreshes (`app.jsx:23031-23037`).
  - Call `DF_assign` for the chosen folder.
  - Toast "Added 2 files. Your bookkeeper can see them now." (`BH_summary` wording).

### 4.4 Documents page changes (small)

- `driveRow` (`app.jsx:22957-22979`) uses `display_name || name`.
- Add a small "Only some people" chip on restricted rows, visible to the uploader and staff. It comes from `shape()` in `index.ts:243-265`, which needs `access_mode` and `display_name` added to the output.
- Add a row menu item "Who can see this" that opens the access part of the dialog and calls `client_file_set_access`.
- The existing Documents upload button can open the same dialog later. That is out of scope for v1; keep `addFiles` as is.

### 4.5 Staff notifications (no email by default)

How it works today:

- The `staff_doc_upload` email fires only when a legacy `client_doc_requests` row moves to `uploaded`. This is trigger `notify_enqueue_doc_upload` in `supabase/notification-emails.sql:109-131`.
  - It is sent by `notification-emails` with pref key `doc_upload`, default on (`supabase/functions/notification-emails/index.ts:65`).
  - Body: "uploaded a requested document" (`index.ts:544-551`).
- A plain Documents upload sends **no email**. Staff see it only in the Desk inbox as a "New file: <name>" row from the `wb_inbox` docs CTE (`supabase/workbench-1-core.sql:416-430`). That row covers:
  - `visibility = 'shared'`
  - not trashed
  - uploader not active staff
  - not yet checked in `client_file_checks`
- Rows clear with "Mark checked" (`wb_mark_file_checked`).

Plan:

- Page-drop uploads are plain `shared` rows, so they appear in the Desk Inbox Files filter automatically. **No new email and no outbox row.**
- The `wb_inbox` CTE should show `display_name` when present. That is a one-line change.

---

## 5. Upkeep list (same commit as the build, per owner rules)

- **Staff guide md**:
  - `docs/staff-guide/add-documents.md`: lines 59-61 currently say page drop is not for client users. Rewrite that to describe the client page drop and access rules.
  - `docs/staff-guide/client-portal.md` (lines 14-20 cover the Basic Home drop): add the client page drop and "Only some people".
  - `docs/staff-guide/google-drive-files.md`: add `display_name` and the access rule, and state that staff always see everything.
  - `docs/staff-guide/client-tour.md`: describe the new tour step.
- **`staff_guide` DB rows**: an md5-guarded update SQL file, following the pattern of `supabase/staff-guide-slate-search.sql`, for each changed article.
- **Client tour**: change the Documents step in `components/tour/Tour.jsx:693-701` (target `doc-upload`) to mention dropping anywhere and choosing who sees it.
- **Tips**: add a documents tip in `components/tour/Tips.jsx:296-305` ("Drop a file anywhere in the portal").
- **Client ? menu**: in `CLIENT_HelpButton` (`app.jsx:770-797`), add an optional "How to add documents" item only if the owner wants it. The tour already covers it.
- **What's new and notices**: add a client next-visit notice and a staff notice in `components/tour/announcements.js`, as the mgb-launch-kit skill requires.
- **README**: add the feature, the new table and RPCs, and the test file.
- **MGB_VERSION**: bump in `index.html:449` (currently `2026-10-28z`).
- **Dev Tools**:
  - feature flag row
  - firm switch description, near the `org_profile_enabled` row around `app.jsx:15633`
  - reset key for the notice
  - PAGE_META if a page label changes
  - usage-tracking key `client-page-drop`
- **Preview flag** (mgb-preview-flag-build pattern):
  - Per-person flag: `mgb_clientdrop_preview` in the app.jsx flag list (`app.jsx:1000-1060`), with `reloads: true`. It lets staff try the dialog in a demo mode that never uploads.
  - Firm switch: `tk_settings.client_page_drop_enabled`, added to `tk__owner_only_key()` (`client-org-profile.sql:750-764`). Code never writes it.
  - Optional pilot list: `client_page_drop_pilot` (client ids), following the `client_request_pilot` precedent.
  - Clients cannot read `tk_settings`, so add `client_page_drop_state()`, a SECURITY DEFINER RPC returning `{enabled}` for the caller's org. This copies the `client_org_profile_mine()` / `op__switch_on()` pattern (`client-org-profile.sql:155-162`; `components/client/OP_store.js:1-110`).
  - The edge function also refuses non-`everyone` access modes when the switch is off, so the server never relies on the UI gate.

---

## 6. Owner questions (blocking, at most 4)

1. **Who can set "Only these" or "Everyone except"?** Recommended default: any client login with the Documents tab can set it on their own uploads. Staff can set it on any file.
2. **Who can change access after upload?** Recommended default: the uploader and staff. Full-access client logins cannot change someone else's file.
3. **Do restrictions apply to full-access client logins too, such as the org's main contact?** Recommended default: yes. A restriction applies to every client login. Only MyGoodBooks staff bypass it.
4. **Rollout.** Recommended default: build behind `mgb_clientdrop_preview` plus a firm switch that stays off. Pilot one client via `client_page_drop_pilot`. No email to staff; uploads show only in the Desk Inbox "New file" list.

---

## Build order (for the build session)

1. SQL migration: columns, `client_file_access`, trigger, helpers, policy swap, the tabs fix, three RPCs, owner-only key. Then the tests file.
2. `drive-files`: new form fields, validation, the atomic insert RPC, and the new fields in `shape()`. Deploy with `npx supabase` (mgb-supabase-deploy skill).
3. `ClientPageDrop.jsx` plus the mount, the `data-drop-owner` attributes, and the `driveRow` and `wb_inbox` display_name changes.
4. Upkeep list (section 5).
5. Opus critique, then fixes, then Opus verify: RLS tests pass, live SELECT checks, and a Haiku screenshot sweep at phone and desktop widths.

---
## ADDENDUM 2026-10-30: Opus critique fixes (mandatory)
B1: cfa_insert_file_with_access and cfa_validate are SECURITY INVOKER; revoke all from public, anon, authenticated; grant execute to service_role only. Same for every helper not meant for clients (default privileges grant execute to authenticated by name).
B2: client_file_set_access and client_org_logins() check switch-on + pilot (op__switch_on pattern) + client_docs_tab_ok. set_access rejects non-shared, trashed, legacy_path rows; requires lower(uploaded_by)=lower(jwt email) (or staff).
S1: tab check copies resolveAccess semantics (Basic plan = all tabs, access=full = all, scoped tabs NULL = all). doUpload check only for visibility='shared'; message/request uploads untouched. Behind the switch.
S2: no ON DELETE CASCADE for exclusions; check at insert in cfa_guard or block delete; index on email.
S3: "uploader must be on only list" applies only when uploaded_by is a client login. Staff may set only without uploader.
S4: revoke all on client_file_access from anon, authenticated; grant select to authenticated.
S5: client_org_logins via is_client_member (excludes internal), active logins only.
S6: reject non-everyone mode when legacy_path is not null.
S7: harden document_folder_items client policy (USING and WITH CHECK); add visibility='message' check to client_messages_link_drive_file trigger.
S8: preview mount: define demo mount for staff View as (isStaffSession && isPreviewingUser && flag, uploads stubbed); define basicHomeOwnsPage exactly.
S9: staff View as shows access chip / filters by list.
S10: if drive-files/logic.ts changes, redeploy team-reviews, tech-inventory, tk-request-respond.
NITS: file id goes in drive_file_events.detail; shape() returns access_mode only to uploader+staff; show staff the original file name beside display_name; reorder list at app.jsx ~25913 gets data-drop-owner; add client_page_drop_pilot to tk__owner_only_key; keep client_file_access out of realtime; keep policy name/role/(select auth.jwt()) form when swapping; document 10-min link TTL.
Extras folded in (owner OK'd by "do all" + my recommendation): stale access list rule, visible "Add a file" button for phones, search respects restrictions, staff access badge, access-change history log. Email-on-upload and Drive sharing check are left to owner.

---
## ADDENDUM 2026-10-30 (later): Phase 2 review fixes
- **Stale logins on a new file.** `CPD_normalizeAccess(..., { forNewFile: true })` drops inactive emails in every mode, because the database only lets active logins onto a new file (cfa_guard). Used by the client page drop, the staff upload picker and Replace. Re-saving an existing file's Except list still keeps people whose login went inactive (they stay hidden). Replace: an Except list left with nobody becomes Everyone; an Only list left with nobody is refused with a message. drive-files was not changed to accept inactive emails on a new file (it would need a cfa_guard change).
- **Error text.** `bad_access_list` says "One of those people no longer has a login. Refresh and try again." only when the message is about a login; otherwise the server's own sentence without the code prefix. Friendly text for `bad_access_mode` and `blocked_type`.
- **Launch notice.** The staff app reads the switch once at boot (`CPD_readSwitch`, like TM_gate). `ANN_clientDropLaunchOn` needs `enabled` AND pilot `"all"`; a pilot list is not a launch.
- **Dialog never unmounts mid-upload.** `CPD_ClientPageDrop` is always mounted; it latches its props while an upload runs or the dialog is open. `pageOk` (not staff pages, not NON_CLIENT_PAGES, not Basic Home) only turns the page-wide listener and the "Add a file" button on or off.
- **Renames wait for the switch.** Staff file rename, folder rename and `client_file_rename` need the switch on for that client (`cpd__on`), because the client sees the new name. The server refuses a new name with `feature_off` (going back to the original name is allowed any time) and refuses files in Trash and old Storage uploads (`bad_file`). Preview staff still see the Rename dialogs read-only with a "turns on at launch" note; the row-menu tip says so too. Links (`client_documents`) and folders are gated in the UI only.
- **Replace keeps the uploader.** drive-files takes `replaces` (staff only, a live portal file of the same client). The new row gets the old one's `uploaded_by` (checked with `cfa_validate`, put back on failure) and, if the old file was checked off on the Desk, a check of its own, so a staff Replace never shows as a new client file. The new-file email trigger is insert-only, so nothing is sent. The upload event's detail carries `replaces`; History reads "Replaced by a new version" on the old file and "Uploaded as a new version" on the new one.
- **Smaller fixes.** "Only" stays Only (with a note) when nobody else has a login; `me` falls back to the login list's own row; bulk actions keep failed rows ticked, clear the ticks when the search or filter changes, and block single-row trash while running; View as hides every restricted file until the lists load; the client state read waits 3 seconds between tries with no session.
- Tests: `clientPageDropLogic.test.js`; `client-page-drop-2-tests.sql` now writes the switch rows inside its transaction (switch off and on paths, Trash and legacy refusals, `wb_inbox` title run as an admin).
