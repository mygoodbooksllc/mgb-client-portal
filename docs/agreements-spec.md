# Client Agreements (spec, 2026-10-28)

Size: **Big** (new table, RLS, client-facing data). Opus specs, builds and verifies.

## 0. Owner decisions (2026-10-28, not re-asked)

- Clients see their agreements in the portal: **view only**, never editable, and **not signable** unless staff allows it.
- Every existing client has old signed documents that must eventually live there. Staff load them first.
- In-portal signing is a **future** feature. Build only the groundwork (a stored, admin-only, disabled `client_can_sign` control). No signing flow.
- Staff-only agreements must be possible (internal agreements and notes the client never sees).
- Files of record live in MGB's Google Drive. Supabase holds only the link or the Drive file id. Never hard-delete.

## 1. Audit: how documents work today

| Piece | Today |
|---|---|
| `client_documents` | `id, client_id text, name, drive_url, category, added_by, created_at, trashed_at`. Staff add links; clients read them on Documents. No FK to `clients`. |
| RLS on `client_documents` | `staff manage documents` FOR ALL `can_access_client(client_id)`; `client reads own documents` SELECT `trashed_at is null and exists(client_users cu where cu.client_id = client_documents.client_id and cu.email = auth.jwt()->>'email' and cu.active)`; RESTRICTIVE `internal company lock` FOR ALL `client_id is null or client_id <> all(internal_blocked_ids())`. A DELETE ("Delete forever" from Trash) is allowed to staff. |
| Helpers | `is_active_staff()` (Google JWT + active staff row), `is_active_staff_admin()` (same + role admin), `can_access_client(text)` (admin, or active staff with `staff_client_access` / an approved unexpired temporary grant; MGB internal needs `can_view_internal()`), `is_client_member(text)` (active `client_users` row for the JWT email, not internal). |
| Uploads | Google Drive via `drive-files` (`client_files`, visibility `shared` / `internal` / `request` / `message`), with the old `client-uploads/<client>/shared/` and `/internal/` Storage paths as fallback. `client_files` RLS: clients read `shared` (and their own request/message files); staff read with `can_access_client`. |
| Staff roles | `staff.role` is only `admin` or `bookkeeper`. **Account manager** is per client: `clients.account_manager_email`. Temporary admins count as non-admins. |
| Staff UI | The in-client tab row (`STAFF_CLIENT_TABS`) has a **Documents** tab that renders the same `DocumentsPage` clients see, with staff extras (Staff only, Trash, Document requests, Doc chaser cards). |
| Client UI | `DocumentsPage` with `isBookkeeper` false: links + shared files, folders, upload. |
| Firm switches | `tk_settings` (`key`, `value jsonb`). Staff can read; only admins write; clients cannot read it at all, so client gates come back from a SECURITY DEFINER RPC (pattern: `client_org_profile_mine` returns `enabled`). |

## 2. Design decision: a new table, not new `client_documents` columns

`client_agreements` is a **new additive table**. Reasons:

- `client_documents` has a client SELECT policy on the whole row. A staff note column there would be readable by clients unless the policy were rewritten; the Documents page, the client-emails function and the activity-log trigger all read that table. Changing it risks what existing rows show.
- `client_documents` allows hard DELETE; agreements must never be hard-deleted.
- Agreements need their own edit rule (admins and the client's account manager only), which is stricter than `client_documents` (any assigned staff).

Nothing about `client_documents`, `client_files`, Storage or the Documents list changes.

## 3. Data

`public.client_agreements`

| Column | Type | Notes |
|---|---|---|
| id | uuid pk | |
| client_id | text not null | same text id as every per-client table (no FK, like `client_documents`) |
| title | text not null | 1 to 200 chars |
| agreement_type | text not null default `service_agreement` | `service_agreement`, `engagement_letter`, `addendum`, `nda`, `pricing_change`, `other` |
| status | text not null default `draft` | `draft`, `sent`, `signed`, `expired`, `terminated` |
| signed_on / effective_on / expires_on | date null | expires_on doubles as the renewal date |
| document_url | text null | https only, at most 2000 chars (checked in SQL and with `safeHttpUrl` in the browser) |
| client_file_id | uuid null, FK `client_files(id)` on delete set null | a file already in the client's Documents (Google Drive) |
| staff_note | text null | at most 4000 chars. **Never returned to clients.** |
| visible_to_client | boolean not null default **false** | staff turn it on per agreement |
| client_can_sign | boolean not null default **false** | reserved for future signing; admins only; UI control disabled |
| created_by, created_at, updated_by, updated_at | | stamped by trigger from the JWT |
| trashed_at, trashed_by | | soft delete |

## 4. Access (enforced in SQL, not just UI)

- RLS on. `anon`: no grants at all. `authenticated`: SELECT, INSERT, UPDATE. **No DELETE grant and no DELETE policy** (never hard-deleted).
- RESTRICTIVE `internal company lock`: copied exactly from `client_documents`.
- SELECT `staff read assigned agreements`: `can_access_client(client_id)`. Admins, account managers and assigned bookkeepers (and live temporary grants) read; nobody else.
- INSERT/UPDATE: `agreements_can_edit(client_id)` = `can_access_client(client_id) and (is_active_staff_admin() or the JWT email is the client's account_manager_email)`. Bookkeepers read only.
- **Clients have no policy on the table.** They read only through `client_agreements_mine(p_client_id)`, SECURITY DEFINER, which returns a fixed column list without `staff_note`, `client_can_sign`, creator or trash fields, only rows with `visible_to_client` and not trashed, only for `is_client_member(p_client_id)`, and only when `tk_settings.agreements_client_enabled` is true. Off or missing: `{enabled:false, agreements:[]}`.
- Staff calling `client_agreements_mine` (Preview as a client user) get the same safe, visible-only list plus `enabled` and `preview:true`, so the preview is exact.
- Trigger `client_agreements_guard` (BEFORE INSERT/UPDATE), applies only to `authenticated` JWT callers:
  - stamps `created_by`/`updated_by` and `updated_at`; insert starts untrashed;
  - `client_id`, `created_by`, `created_at` cannot change;
  - **restore is admin only** (trashed_at not null to null); a non-admin cannot edit a trashed row at all;
  - `trashed_by` is stamped on trash;
  - only an admin may change `client_can_sign`.
- `agreements_staff_perms(p_client_id)` returns `{can_read, can_edit, is_admin, client_enabled}` for the caller, for the UI.
- View as: both RPCs are STABLE reads and go on `MGB_VIEW_AS_READ_RPCS`; the card is read-only while View as is on (writes are blocked by the guard anyway).

## 5. Staff UI (live for admins and account managers; read-only for bookkeepers)

An **Agreements** card on the client's **Documents** tab (staff view), after the Document requests and Document reminders cards, above the folder bar. No new tab, so the tab row, tours and counts don't move.

- List: title, type, status pill (word plus color), signed, effective and expiry dates, **Visible to client** or **Staff only** tag, **Expires in N days** pill within 60 days (or **Expired** when past and not terminated), Open link (link or Drive file), staff note (staff only).
- Toolbar: **Add agreement**, **Paste several links**, **Show trash** (admins see Restore).
- Add/Edit form: title, type, status, dates, link, Drive file picker (files already in Documents), staff note, Visible to client toggle, and (admins only) a disabled **Client signing: not available yet** checkbox.
- Row actions (editors): Edit, **Mark signed** (status signed, signed date today if blank), **Show to client / Hide from client**, **Move to trash**.
- Paste several links: one per line, `Title | https://...` or `Title<TAB>https://...` (spreadsheet paste) or just a URL (title "Signed agreement"). One type and status for the batch (defaults Service agreement, Signed). All start **Staff only**. Bad lines are listed and skipped.
- Firm switch off: a note on the card says clients don't see agreements yet (owner turns on `agreements_client_enabled`).
- Warning when a visible agreement uses a **Staff only** Drive file (the client won't be able to open it).
- **Skipped (not cheap):** a firm-wide "Expiring in 60 days" list across clients. The per-row pill covers it on each client.

## 6. Client UI (hidden: firm switch `agreements_client_enabled`, unset)

On the client Documents page, an **Agreements** card after the document requests card, above the documents list, only when the RPC says `enabled`. Read-only: title, type, status pill (word), signed date, expiry, **Open**. No note, no edit, no upload, no signing. Empty state: *No agreements are shared with you yet. Your MyGoodBooks team adds them here.* With the switch off, clients see nothing at all (no card, no empty state).

## 7. Pure logic: `components/client/AG_logic.js` (+ `AG_logic.test.js`)

`AG_TYPES`, `AG_STATUSES`, labels, `AG_safeUrl`, `AG_validate(draft)`, `AG_daysUntil`, `AG_expiryInfo(row, today)` (expiring-soon within 60 days / expired), `AG_effectiveStatus`, `AG_clientVisible(row)`, `AG_toClientRow(row)` (strips the note), `AG_parseBulk(text)`, `AG_sort`.

## 8. Rollout

- Staff card: live on push for admins and account managers (bookkeepers read-only). Changes nothing for clients.
- Client card: off until the owner runs `insert into tk_settings(key, value) values ('agreements_client_enabled', 'true') on conflict (key) do update set value = excluded.value;` **Code never sets it.** Listed in Developer tools › Settings with a plain description.
- Rollback: set the switch false (clients see nothing). Staff card: revert the commit; the table is inert without UI.

## 9. Upkeep

- Staff guide: new article `client-agreements` (audience staff) published; `add-documents` gets a pointer; What's new; README; MGB_VERSION; Dev Tools switch row; tip; staff launch notice.
- Client-facing drafts (publish only when the owner flips the switch): see §10.

## 10. Client drafts (NOT published)

**Client notice:** *New: your agreements. Your signed agreements with MyGoodBooks are now on your Documents page, under Agreements. Open any of them any time.*

**Client tour step (Documents › Agreements card, `data-tour="client-agreements"`):** *Agreements: your service agreement, engagement letter and any changes, with the date each was signed and when it renews. Click Open to view one. Questions? Message your team.*

**Client help (? menu entry / client-portal guide addition):** *Where are my agreements? On Documents, in the Agreements card. They're read-only. If one is missing or out of date, message your MyGoodBooks team.*

## 11. Future signing roadmap (not built)

1. Admin turns on `client_can_sign` per agreement (control enabled only when signing ships, behind its own firm switch).
2. Client sees **Review and sign** on that agreement; a SECURITY DEFINER RPC records signer name, email, timestamp, IP/user agent, and a hash of the exact file version, and sets status signed. Additive columns (`signed_by_email`, `signed_by_name`, `signature_hash`, `signed_via`), and an append-only signature log table.
3. Or integrate a provider (DocuSign / Dropbox Sign) and store only the envelope id and the final PDF in Drive.

## 12. Verification plan

- `node components/client/AG_logic.test.js` and every `*.test.js`.
- Babel parse of the new `.jsx` and `app.jsx`.
- SQL tests (`supabase/client-agreements-tests.sql`), each in a rolled-back transaction, as admin, account manager, bookkeeper (assigned and unassigned), client of org A, client of org B, anon: read, write, trash, restore, staff_note exposure, switch on/off. No rows left.
