# Client org profile + anniversary gifts: spec (2026-10-23)

Owner decisions (2026-10-14, 2026-10-16) are final. Built hidden behind a preview flag. Prefix for new code: `OP_`.

## 1. Gate (preview-flag pattern)
- Per-person preview: localStorage `mgb_orgprofile_preview` = "1" (FEATURE_FLAGS entry, `reloads: true`).
- Firm switch: `tk_settings.org_profile_enabled` (code never writes it; it stays missing/off). It is listed read-only in the Developer tools switches table.
- One resolver, `components/client/OP_store.js` `OP_isOn()`: preview OR switch. Staff read the switch from `tk_settings`. Clients cannot read `tk_settings`, so the client RPC returns `enabled`.
- With the gate off, nothing changes: no prompt, no Needs-you item, no staff card, no admin tab, no onboarding step, and no digest line.

## 2. Who is prompted
- A real client session only: `clientPortalUser`, not a staff session, not impersonating, not previewing a user (the same rule as the client tour's `isRealClient`).
- The user has `client_users.access` of 'full' or null. Scoped users are never prompted, including Basic-plan scoped users. The server enforces the same rule.
- The prompt appears once per sign-in while the profile is incomplete. Dismissing it ("Later") stores a sessionStorage key, so it returns at the next sign-in.
- A "Finish your organization profile" item stays in the client home "Needs you" card until the profile is complete, and it reopens the form.

## 3. Fields (client form)
| Field | Required | Notes |
|---|---|---|
| Name for cards and gifts (`card_name`) | yes | prefilled from `clients.name` |
| Organization type (`org_type`) | yes | prefilled from `clients.entity_type`/`org_type`; the client's answer is stored on the org profile, never written to `clients` |
| Established date (`established_date`) | yes, or "Not sure" (`established_unknown`) | |
| Gift mailing address (`gift_address`) | yes | the "Same as organization address" checkbox (`gift_same_as_org`) copies `clients.org_address`; it is disabled when that address is empty |
| Who receives deliveries (`receiver_name`) | yes | |
| Phone for couriers (`courier_phone`) | yes | |
| Main contact name, email, phone | name, plus email or phone | prefilled from the signed-in user |
| Fiscal year end (`fiscal_year_end`, MM-DD) | yes | prefilled from `client_profile.fiscal_year_end`, read through the RPC; the staff Key dates field is not overwritten, and the staff card flags any difference |
| Get to know you (optional) | no | favorite candy or treat, coffee or tea, allergies, hobbies, "what would feel right for your team" |

- Get-to-know answers are WRITE-ONLY for clients and are never returned to them. The form says "Thanks, we have your answers. Sending new ones replaces them."
- Completeness: `completed_at` is set by the server when all the required fields are valid.

## 4. Data (additive; file `supabase/client-org-profile.sql` plus `-tests.sql`)
- `client_org_profile` (client_id pk → clients): the fields above, plus `client_since date`, `client_since_set_by`, `completed_at`, `completed_by`, `updated_at` and `updated_by`.
- `client_get_to_know` (client_id pk): `answers jsonb` (5 known keys, each text up to 300 characters), `submitted_by` and `submitted_at`.
- `client_gifts`: `id`, `client_id`, `occasion` ('client_since' | 'established'), `occasion_year int`, `occasion_date date`, `status` ('planned' | 'sent' | 'skipped'), `item`, `amount numeric(8,2)` (check 0-500; the UI warns outside $30-45), `notes`, `planned_by`, `sent_at`, `sent_by`, `created_at`, `updated_at`. Unique on (client_id, occasion, occasion_year), so a gift can't go twice.
- RLS is on for all three tables, with `revoke all` from anon and public. There are no client policies.
  - Org profile: staff select where `is_active_staff() and can_access_client(client_id)`. Writes go through RPCs.
  - Get to know: staff select with the same rule.
  - Gifts: `is_active_staff_admin()` only, for all operations.
- RPCs (security definer, `set search_path = public`, granted to authenticated):
  - `client_org_profile_mine()`: requires a full-access user from `st_my_client_user()`. Returns `{eligible, enabled (switch), profile (client-safe fields), prefill {name, entity_type, org_address, fiscal_year_end, user_name, user_email}, complete, has_get_to_know bool}`. Scoped users get `{eligible:false}` and no data.
  - `client_org_profile_save(p jsonb)`: full-access users only, for their own client_id only (taken from `st_my_client_user()`, never from the payload). It validates lengths and dates, upserts the profile, sets or clears `completed_at`, upserts get-to-know only when supplied, and writes an audit record (`audit_write('client.org_profile_updated', …)`; no answer text goes in the audit). Clients cannot set `client_since`.
  - `staff_set_client_since(p_client_id, p_date)`: requires active staff with `can_access_client`. Null resets to `launch_date`.
  - `admin_upcoming_anniversaries(p_days int default 30)`: admin only. Returns rows of client, occasion, date, years, whether the profile is complete, gift status, and the get-to-know presence.
  - `org_anniversaries_digest_count(p_today date)`: service_role only. Returns null when the switch is off.
- Effective client-since date: `coalesce(client_org_profile.client_since, client_profile.launch_date)`.

## 5. Staff UI (gated)
- Client overview gets an "Organization profile" card for staff with client access. It shows the fields, completeness, a Client since date that can be edited (source "from launch date" or "set by staff"), the get-to-know answers, and the fiscal-year mismatch flag.
- Team › Client gifts tab (admin only). It lists anniversaries in the next 30 days, with columns for client, occasion, date, years and gift status. Plan sets status to planned with an item, amount and notes. Mark sent stamps the sender and date. Skip is also available. A "Past gifts" list and the budget note ("$30-45") sit on the same tab. The tab also holds the import dry-run tool (section 7).
- Onboarding: when the gate is on, `OB_progress` gets a virtual step, "Client finished organization profile", ticked from `completed_at`. No `onboarding_steps` row is written.
- Nothing emails anyone and nothing orders a gift. Reminders are in-app only.

### 5a. Gift anniversary basis (owner request, 2026-10-25)
- One firm-wide choice on Team › Client gifts, **Anniversary to follow**: "Client since" (the default, and the meaning of no setting) or "Founding date". Stored as `tk_settings.org_gift_basis`, a JSON string `"client_since"` or `"established"`; a trigger refuses any other value (`org_gift_basis_invalid`, 22023). Admin-writable (existing tk_settings RLS, not an owner-only key), audited in `tk_settings_audit`. RPCs `admin_gift_basis()` and `admin_set_gift_basis(p_basis)`, admin only.
- `op__anniversaries` follows it, so `admin_upcoming_anniversaries` and the digest count both do. Client since: only Client since rows (before 2026-10-25 the list showed both occasions). Founding date: the founding date, and Client since for any client whose founding date is "Not sure" or blank, so no client drops off.
- File `supabase/client-org-gift-basis.sql` (additive, applied 2026-10-25) plus `client-org-gift-basis-tests.sql` (rolls back).

## 6. Weekly digest
- `weekly-admin-digest` adds a single line to Coming up: "Anniversaries coming up: N clients" (next 30 days). The line appears only when the digest-count RPC returns a number, which happens only when the firm switch is on. With the switch off the email is unchanged.

## 7. One-time import (dry run only)
- Pure logic `components/client/OP_importLogic.js` (node-tested on synthetic rows). It reads CSV text with columns Customer Name, Email, Anniversary and Address, then fuzzy-matches names to clients. Its output buckets are matched, unmatched, ambiguous names, ambiguous or bad dates, and incomplete addresses (no zip or city, or a PO box flagged).
- Admin UI: paste the CSV, see the report, and nothing is written. There is no write button in this build; the real import waits for owner approval.
- No sheet content goes into the repo, tests, reports or commits.

## 8. Upkeep
- LIVE 2026-10-25: guide `docs/staff-guide/client-org-profile.md` and the What's new entry are published; the launch notice is dated 2026-10-25. (Built as drafts in `docs/staff-guide/drafts/`.) A What's new draft. A hidden launch notice and tour in announcements.js, visible only when the switch is on. README, MGB_VERSION, FEATURE_FLAGS, the switches table, INFRA_LINKS and PAGE_META if needed. A client `?` menu entry stays gated.

## 9. Security critique resolutions (Opus, 2026-10-23), all binding
1. Table grants: `revoke all on <t> from public, anon, authenticated`. Then grant select on client_org_profile and client_get_to_know, and select/insert/update/delete on client_gifts, to authenticated. RLS decides who sees rows.
2. Function grants: revoke from public and anon on every function, then grant to authenticated. Internal helpers are also revoked from authenticated. `org_anniversaries_digest_count` is granted to service_role only.
3. `org_profile_enabled` is added to `tk__owner_only_key`. Re-read the LIVE definition with pg_get_functiondef right before replacing it and keep every existing key. The switch is read server-side only, with `coalesce(tk__jsonb_bool(...), false)`.
4. `client_org_profile_mine()` returns whitelisted fields only.
   - From client_profile: only fiscal_year_end. Never launch_date or rates.
   - From the profile: no client_since, staff emails or completed_by.
   - From get-to-know: only a presence boolean.
   - A caller with no client_users row, a scoped caller or a staff caller gets `{eligible:false}`, with no exception.
5. Both client RPCs block staff JWTs. `mine()` returns `{eligible:false}` and `save()` raises 42501.
6. The save RPC:
   - Reads each known key explicitly and ignores unknown keys. It never uses jsonb_populate_record.
   - Rejects a payload that is not an object, or is over 16 KB.
   - Uses an explicit ON CONFLICT SET list that never touches client_since.
   - Builds get-to-know answers from the 5 known keys only: strings of 300 characters or fewer after trimming, with empty strings dropped.
   - Error messages name the field and never echo the value.
7. Validation:
   - Date casts are caught and return 22023. The established date must be between 1800-01-01 and today.
   - Fiscal year end must be MM-DD, checked as a real date in a leap year (02-29 is allowed, 02-30 is rejected).
   - Length caps: card name 200, address 500, names 120, phone 40 (`^[0-9+().\-\s x]+$`), email 254 with a basic format check.
   - With same-as-org, the server copies `clients.org_address` itself and rejects the save if that address is empty.
8. Anniversaries use `base + make_interval(years => n)`, so Feb 29 lands on Feb 28 in other years. Never use make_date. A test covers this.
9. The audit record stores changed field names, completed and gtk_replaced only, never values.
   - client_get_to_know has no row-change or activity triggers.
   - None of the three tables are in a realtime publication.
   - A test checks that audit_log never contains answer text.
10. client_gifts has a trigger that stamps planned_by, sent_by and sent_at (on the change to sent) and updated_at from the JWT email.
11. `staff_set_client_since` checks `is_active_staff() and can_access_client`, validates the date (1900 to today) and that the client exists, upserts only client_since and client_since_set_by, and writes the audit record `client.since_set` with from and to.
12. `admin_upcoming_anniversaries` raises 42501 unless `is_active_staff_admin()`, clamps days to 1..366, excludes test_only and is_internal clients, and returns presence flags only.
13. (SHOULD, adopted) Temp-access grants are excluded from get-to-know. It is readable by admins, the assigned bookkeeper and the account manager only, not by temp-grant-only staff.
14. (SHOULD, adopted) The client UI decides on the RPC's `eligible` value, never on `resolveAccess().isFullAccess`. The digest treats an RPC error as no line. No triggers and no tk__enqueue calls. The dismissal key is `mgb_op_later:<email>` in sessionStorage. Delete rules: client_gifts uses `on delete restrict`; the profile and get-to-know cascade.
15. (SHOULD, deferred) A unique index on lower(client_users.email) is not added, because it is a shared table outside this feature. Noted for the owner.
16. SQL self-tests (rolled back) cover: a scoped user, an inactive user, a staff JWT, another org's client_id in the payload, oversized and unknown keys, anon, Feb 29, and audit containing no answer text.
