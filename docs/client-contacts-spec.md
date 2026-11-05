# Client contacts in the org profile: spec (2026-11-05)

Owner goal (approved 2026-11-05): the client org profile collects every contact staff need. Staff see and edit the same people. The Review board and the email drafts read that one list. Everything is built hidden. Prefixes: `OP_` / `OPC_` (client side), `cc__` (SQL helpers), `RB_` (board).

Big change: Opus specs, builds, critiques and verifies. Sonnet or Haiku only for screenshot and grep sweeps.

Facts checked against production on 2026-11-05 (read-only):
- `org_profile_enabled` is ON (live since 2026-10-25).
- `reviewboard_enabled` is missing (hidden).
- `client_org_profile` has 0 rows.
- `client_contacts` has 4 live rows on 1 client.
- `client_users` has 3 rows, all on test clients.
- `client_profile.greeting_name` is never set.
- No contact tokens exist.
- (Critique, 2026-11-05) The 4 contacts and all 3 logins are on `grace-community` / `basic-test`, both `test_only`. Only 2 of 69 clients are `test_only`. `client_contacts` has no update trigger today. Supabase default privileges grant EXECUTE on every new public function to `anon` and `authenticated`.

## 1. Gate
The org-profile gate is already live, so this work gets its own gate. With the gate off, what anyone sees and every write path behave exactly as they do today. Server replies may gain extra JSON keys (`contact_list`, `title`), and the UI ignores them unless `OPC_isOn()` is true. For a client with the gate off, `rb__main_contact` and `staff_client_org_profile.profile` return exactly what they return today (see section 4 and section 4 RPC changes).

**Firm switch**
- Key: `tk_settings.org_contacts_enabled`, owner only.
- Add it to `tk__owner_only_key`. Re-read the live definition with `pg_get_functiondef` right before replacing it, and keep every existing key.
- Code never writes this switch.

**Server helper**
- `op__contacts_on(p_client text)` returns true when the switch is on, or when `clients.test_only` is true.
- The helper is revoked from everyone: `revoke all ... from public, anon, authenticated`. Naming `public` alone is not enough, because the default privileges grant `anon` and `authenticated` directly. This applies to every internal helper in this build (`op__contacts_on`, `cc__people`, `cc__materialize`, `cc__lock`, the trigger functions).
- Test clients get the feature early, so the owner can try the client side on a test login.

**Clients**
- `client_org_profile_mine()` returns `contacts_enabled`.
- The client UI decides only on that value.

**Staff**
- `OPC_isOn()` is true when `OP_isOn()` is true and either the switch is on or the per-person preview is on.
  - Preview: localStorage `mgb_orgcontacts_preview` = "1" (a FEATURE_FLAGS entry with `reloads: true`).
  - Switch cache: `mgb_orgcontacts_cache`, filled by `OPC_readSwitch()`. It reads `tk_settings` key `org_contacts_enabled` the same way `OP_readSwitch` reads `org_profile_enabled`, and emits `mgb:orgcontacts`.
- Staff writes are also gated on the server: `staff_client_contact_save` checks the switch, or a test client, or `p_preview = true` from a **real admin** (the same test as `rb__require_admin`: never bookkeepers or temp admins).
  - The preview flag is a UI convenience only. The server still enforces access.

**Review board and drafts**
- The board stays behind its own gate (`mgb_reviewboard_preview` / `RB_on()`).
- On top of that, `RB_rowModel`, `RB_ContactExpander` and `RB_recipientChips` use `contact_list` only when `OPC_isOn()` is true. Otherwise they run today's code path unchanged, even though the server sends the key.
- So an admin with only the Review board preview sees exactly today's board and chips.

## 2. Data model (additive only)
Migration file: `supabase/client-contacts.sql`. Self-test file: `supabase/client-contacts-tests.sql`, which ends in ROLLBACK. Both are applied together, and nothing existing is dropped or renamed.

**`client_contacts` new columns**

| column | type | rule |
|---|---|---|
| `is_main` | bool not null default false | unique partial index `client_contacts_one_main` on (client_id) where is_main and deleted_at is null |
| `gets_monthly_emails` | bool not null default false | |
| `title` | text | trimmed, 1-120 or null (free-text role or title from the client form) |
| `source` | text not null default 'staff' | check in ('staff', 'client', 'import') |
| `updated_by` | text | lowercased email from the JWT |
| `edited_at` | timestamptz | the last human edit; import never sets it |

**Existing columns stay exactly as they are**
- `role` keeps its check (treasurer|pastor|board|finance|other). Client rows leave `role` null and use `title`.
- `can_answer_requests` keeps default TRUE, so the current `tk_save_client_contact` behavior is unchanged.
- New client-written rows pass `can_answer` explicitly; the default is false from the form.

**Trigger `cc__stamp`** (BEFORE INSERT OR UPDATE)
- Sets `updated_at = now()`.
- Sets `updated_by` from `auth.jwt()->>'email'` (lowercased).
- Sets `edited_at = now()`, unless `current_setting('mgb.cc_import', true) = '1'`.
- Does not touch any other column.
- Existing writers (`tk_save_client_contact`, `tk_retire_client_contact`) keep working; they now just get stamps.

**Trigger `cc__revoke_on_change`** (AFTER UPDATE, one place for token safety)
- When `email` changes, or `can_answer_requests` goes from true to false, or `deleted_at` goes from null to set, it calls `tk__revoke_tokens(null, 'contact_retired', <jwt email or 'system'>, new.id)` (the reason check `tk_request_tokens_reason_check` allows no new value, so 'contact_retired' is used; see Build notes).
  - The contact id is never null.
- This covers every writer: the client save, the staff RPC, `tk_save_client_contact`, `tk_retire_client_contact` and a future import.
  - A second revoke after `tk_retire_client_contact`'s own call finds nothing and does no harm.
- **Owner override of Q2 (2026-11-05):** the trigger is a **no-op while the gate is off** for that client (`op__contacts_on(new.client_id)` false), so live behavior is byte-identical with the feature hidden: `tk_save_client_contact` edits on real clients keep today's behavior until the owner turns on `org_contacts_enabled`. On test clients, or once the switch is on, it revokes as described. The staff RPC's admin-preview path (gate off, real admin, `p_preview`) revokes that contact's tokens itself, always with a non-null contact id.

**Email format for new writes**
- `cc__email_ok(text)` / `OPC_EMAIL_RE` use the same character class as `RB_EMAIL_RE`: `^[^\s@?&,%#<>"]+@[^\s@?&,%#<>"]+\.[^\s@?&,%#<>"]+$`.
- This applies to the main contact email under the gate, to `people`, to the mirror and to the staff RPC.
- Without it, an address the client saves with `?`, `&`, `,` or `%` passes today's `OP_EMAIL_RE` but is silently dropped from the chips, or adds parameters to a raw `mailto:` link.
- Name, title and greeting reject control characters (`[[:cntrl:]]`, 22023), because `op__txt` only trims spaces.

**`client_org_profile` new column**
- `greeting_name text`: trimmed, 1-80 or null.

**Grants and RLS**
- Grants and RLS are unchanged:
  - `client_contacts`: authenticated SELECT only, through the "staff read client contacts" policy plus the restrictive internal company lock.
  - `client_org_profile`: staff read only.
- No new table policies. All writes go through SECURITY DEFINER RPCs that re-apply `can_access_client` and the internal rule.
- Not added to realtime. No row-change or activity triggers beyond `cc__stamp` and `cc__revoke_on_change`.

**Serializing writes per client**
- `cc__lock(p_client)` runs `pg_advisory_xact_lock(hashtextextended('cc:' || p_client, 0))`.
- It is called first by the client save's contact section, by `staff_client_contact_save` and by `cc__materialize`.
- Without it, two first-time saves race: the `for update` on `client_org_profile` locks nothing when no row exists yet. A client save and a staff save that both set `is_main` would also race, and the loser gets a raw 23505 from `client_contacts_one_main` or `client_contacts_live_email`.
- `tk_save_client_contact` does not take the lock. Its race with the mirror can still raise 23505, so `OP_saveError` maps any 23505 to "Someone just changed this list. Reload and try again."

## 3. Main contact: mirroring decision
- The main contact keeps living in `client_org_profile.contact_name/email/phone`, so existing readers (the staff card, completeness and `rb__main_contact`) are not broken.
- With the gate on for that client, every client save also mirrors the main contact into `client_contacts` as the one row with `is_main = true`:
  - Upsert by `lower(email)` into the live row with that email, if there is one; otherwise insert with `source = 'client'`.
  - Clear `is_main` on the previous main row first. That row stays as an "other" contact and is not deleted.
  - The main row is forced to `gets_monthly_emails = true`.
  - `can_answer_requests` is true on a new row and unchanged on an existing row.
  - A main contact with a phone but no email is not mirrored. Email is required under the gate (section 6), so this only applies to old rows.
- Staff never write `client_org_profile`. Staff set "Main contact" on a contact row (`is_main`).
- **Lazy materialize, `cc__materialize(p_client)`** (critique fix: it stops the profile and the rows drifting apart). It runs under `cc__lock` at the start of every gated contact write: the client save's contact section and `staff_client_contact_save`.
  - It does nothing if a live `is_main` row exists, or if the profile has no valid email.
  - Otherwise, if a live row has the profile email, that row gets `is_main = true` and `gets_monthly_emails = true`.
  - Otherwise, if the email is tombstoned (a deleted row and no live row), it does nothing.
  - Otherwise it inserts the profile person: `source 'client'`, `is_main`, monthly on, `can_answer` false, and name = `contact_name`, or the email if the name is blank.
  - The effect: after any gated write, the org-profile person is a row. A staff "make X main" demotes them to "other" instead of making them vanish on the client's next save.
- `mine()` prefill of the form's main contact:
  - Name and email come from the live `is_main` row when there is one.
  - Phone comes from `client_org_profile.contact_phone` only when the profile email equals that row's email. Otherwise it is blank, because `client_contacts` has no phone and the profile phone belongs to the profile person.
  - With no `is_main` row, the prefill comes from the profile, unless the profile email is tombstoned. Then the main contact is blank, so the client must choose one, and a contact staff removed is never silently re-created by an unchanged save.
- No backfill. The resolver's fallback (section 4) covers clients that have not saved since launch.

## 4. One people list: read order, dedupe, labels
New internal helper `cc__people(p_client text) returns jsonb`. It is SECURITY DEFINER, `search_path = public`, and revoked from everyone. It returns an ordered array with one entry per person.

Entry keys: `name`, `email`, `phone`, `title`, `role`, `is_main`, `gets_monthly_emails`, `can_answer`, `opted_out`, `source`, `contact_id`. It never returns `notes`.

Build order:
1. The live `client_contacts` row with `is_main`. Source `main`.
2. The org-profile contact (`client_org_profile.contact_*`). Source `profile`.
   - Only when **step 1 produced nothing** (critique fix: when a live main row exists, the profile copy is stale, for example after staff edited the main row's email, and listing it would show two "main contacts").
   - Only when it has a name or an email.
   - Tombstone rule: skip it when its email matches a deleted `client_contacts` row and no live row. Staff removed that person, so the profile copy must not resurrect them.
   - This entry gets `is_main = true` and `gets_monthly_emails = true`.
   - The profile phone is attached to whichever entry has the profile email. It is never attached to a main row with a different email.
3. Other live `client_contacts` rows with an email. Order: `gets_monthly_emails` desc, `can_answer_requests` desc, name, lower(email). Source `contact`.
4. Active `client_users` logins. Order: created_at, lower(email). Source `login`.

`opted_out` is computed for **every** entry by email from `client_email_recipients.opted_out_at` (same client), not only for logins. Unsubscribing is per email.

Dedupe is by `lower(btrim(email))`. The first occurrence wins, and later duplicates only fill fields the earlier entry left blank: a missing phone, a missing title, or opted_out true. Entries with no email (only a profile contact with a phone) are kept and never merged.

**`rb__main_contact(p_client)`**
- When `op__contacts_on(p_client)` is false, it runs today's body exactly: same keys, no `title`. This keeps the board byte-identical for real clients, even after a real admin with the preview writes an `is_main` row on one.
- When on, it keeps the same keys (`name`, `email`, `phone`, `source`) plus `title`.
  - It returns the first entry with `is_main`. If there is none, the first entry with source `contact` and `gets_monthly_emails`. If there is none, the first login.
- Sources: `main` | `profile` | `contact` | `login`. Old values `profile` and `login` keep their meaning.
- Note: both test clients that `review-board-tests.sql` uses are `test_only`, so those tests run the new branch. They still pass, because neither has an `is_main` or monthly row.

**Labels (UI)**, defined once in `OPC_SOURCE_LABEL`:

| source | label |
|---|---|
| main | Main contact |
| profile | Main contact (from org profile, not saved as a contact yet) |
| contact | Contact list |
| login | Portal login |

The existing "first portal login" note in `RB_ContactExpander` shows when the source is `login`.

Entries also carry `added_by_client` (true when `source = 'client'`). The staff card, the board expander and the Ask client picker show it, so staff can spot an address a client added before sending a request link to it.

**RPC changes** (same signatures, keys only added). The new key is named `contact_list` everywhere, because `rb_board` rows already have a `people` key that means MGB staff.
- `rb_board(p_period)`: each row adds `contact_list` (the `cc__people` array, emails lowercased).
- `rb_draft_recipients(p_task_id)`: adds `contact_list`. Keeps `contact`, `contacts`, `logins`, `staff` and `sent` exactly as in `review-board-sent-read.sql`.
- `staff_client_org_profile(p_client_id)`:
  - Adds `contact_list`.
  - Adds `contacts_enabled`.
  - Adds `greeting: {org_profile, client_profile, mismatch}`, where mismatch means both are set and they differ, case-insensitive.
  - It stays STABLE, so it can remain on `MGB_VIEW_AS_READ_RPCS`.
  - Its `profile` key is `to_jsonb(op) - 'client_id'`, which would start carrying `greeting_name` automatically. When the gate is off, it also removes `'greeting_name'`, so the output is byte-identical.
- Access rules stay exactly as they are today:
  - The board is for real admins only.
  - Drafts are for active staff with `can_access_client`.
  - The card is for staff with `can_access_client`.

**JS helper `components/client/OP_contacts.js`**
- Pure, global scope, node-testable.
- `OPC_normalizeEmail`, `OPC_dedupePeople(list)` (mirrors the SQL rule, used for the form preview and tests), `OPC_SOURCE_LABEL`, `OPC_sourceLabel(p)`, `OPC_checkPeople(rows, mainEmail)` returning `{errors, payload}`, `OPC_toChips(people, me)`, `OPC_isOn()`.
- Loaded in index.html right before `OP_store.js`.

## 5. Email draft chips (TK_EmailDraft via RB_useEmailExtras)
- `RB_recipientChips(data, me, opts)` uses `data.contact_list` only when `opts.contactsOn` is true (the caller passes `OPC_isOn()`) and the key is present. Otherwise it runs today's code path unchanged. This covers both the old server, before the migration is applied, and an admin who has only the Review board preview.
- **To chips:** one per person with an email that passes `RB_emailOk`, skipping logins that have `opted_out` (as today).
  - Preselected (on): `is_main` or `gets_monthly_emails`, and never anyone who has `opted_out`. An opted-out non-login is shown off, with "Opted out of portal emails" in the tooltip.
  - If none is on, the first chip that is not opted out is on.
- **Cc chips:** the bookkeeper and account manager, unchanged.
- The chip tooltip shows the source label.
- The chip-row empty text becomes "Add people in Organization profile › People to contact." when the gate is on. Otherwise it stays "Add a contact in Client info."
- Admin-only board rules stay. Nothing is sent from the portal.
- `RB_ContactExpander` builds every `mailto:` link with `RB_mailto({to:[email]}).href`, never `"mailto:" + email`. Today's line 86 concatenates the raw address, and client-entered addresses now reach it.

## 6. Client form (OP_ClientPrompt) under the gate
**Main contact section**
- Name: required.
- Email: required. The hint "An email or a phone number is enough." becomes "We email monthly reports here."
- Phone: optional.

**New field: "How should we greet you in emails?"**
- Optional, max 80 characters, placeholder "e.g. Pastor Jim".
- Saved as `greeting_name`.

**New section: "Other people we should contact"**
- A repeatable row with:
  - Name: required, 120 characters.
  - Email: required.
  - Role or title: optional, 120 characters.
  - Tick "Gets monthly emails", default on.
  - Tick "Can answer our questions", default off.
- "Add another person" button and a remove (x) on each row. Maximum 24 other people (25 with the main contact), which matches the server cap.
- Rows that came from staff are shown and editable too. Notes are never shown. (Owner decision Q1: can clients remove rows that staff added?)
- The main contact is not repeated in the list.
- The payload sends only new or changed rows in `upsert` and removed ids in `remove`, never the whole list. Without this, a client with more than 20 staff-added contacts could never save.

**Client-side validation (`OPC_checkPeople`)**
- Email format uses `OPC_EMAIL_RE` (the stricter class, section 2), not `OP_EMAIL_RE`. It applies to the main contact email too while the gate is on.
- No duplicate emails within the list. An email equal to the main contact email is rejected: "Already the main contact".
- Errors name the row and field, never the value.

**Completeness under the gate**
- Requires `contact_name` and `contact_email`. Phone alone no longer completes the profile.
- The server computes `v_complete` the same way, and only when `op__contacts_on(me.client_id)` is true. With the gate off, the server rule stays `(email or phone)`.
- Profiles already completed keep `completed_at` (grandfathered); they are re-checked only on the next save.
- `OP_isComplete` / `OP_checkForm` take `opts.contactsOn`.

**Save payload additions**
- New keys: `greeting_name` and `people: {upsert:[{id?, name, email, title, gets_monthly_emails, can_answer}], remove:[uuid]}`.
- The server honors them only when `op__contacts_on(client)` is true and ignores them otherwise.

## 7. Server: `client_org_profile_save(p)` additions
CREATE OR REPLACE, same signature. Re-read the live body first and keep every existing check.

**Payload checks**
- Payload cap raised from 16 KB to 24 KB, but only when the gate is on for the caller's client. With the gate off, the cap stays at 16 KB.
- `people.upsert` and `people.remove` hold at most 25 entries each.
- Unknown keys inside entries are ignored, and no record-populate is used. That includes `is_main`, `source`, `role`, `notes`, `client_id`, `created_by` and `edited_at`.
- At most 25 live contacts per client. The save raises 22023 `people_limit` only when it would **increase** the live count above 25. Staff can exceed 25 with `tk_save_client_contact`, and that must not lock the client out of saving.
- Order of work: `cc__lock`, then `cc__materialize`, then removes, then upserts, then the main-contact mirror, then the cap check.

**Upsert rules**
- An `id` must be a live row of the caller's own client; otherwise 22023 `people_id` (no existence leak across clients).
- An `id` that is the current `is_main` row also raises `people_id`. The main contact is edited only through the main-contact fields, so a crafted payload cannot change the main row's email behind the mirror.
- An entry without an id whose email matches a live row is merged into that row.
- Emails are lowercased and must be unique in the payload. An email equal to the main contact email raises 22023 `people_email_duplicate`, naming the field and not the value.
- New rows get `source = 'client'`.
- Client saves never write `role` or `notes`, never set `is_main` (except through the main-contact mirror) and never touch rows of other clients.

**Remove rules**
- Removal is a soft delete (`deleted_at`).
- Each id must be a live row of the caller's own client; otherwise 22023 `people_id`. This is the same rule as upsert.
- The current main row cannot be removed this way (22023 `people_remove_main`).

**Token safety**
- Handled by the trigger `cc__revoke_on_change` (section 2). It fires when can_answer goes from true to false, when an email changes, or on removal.
- The RPC makes no `tk__revoke_tokens` call of its own, so the call can never be written with a null contact id. null/null revokes every open token.

**Greeting**
- Strip a leading "Hi", "Hello" or "Dear" (case-insensitive) and a trailing comma or colon, then trim. An empty result becomes null.
- Store the result in `client_org_profile.greeting_name`.
- Also set `client_profile.greeting_name` only when that row exists and its greeting is null or blank: update only, never insert, never overwrite. It passes the existing `normalize_contact` trigger.
  - The UPDATE sets **only** `greeting_name`. The `client_profile` guard triggers run under the client JWT: `reviewer_guard` and `rhythm_guard` raise 42501 for a non-admin JWT when their columns change, and `hours_budget` resets its column. Checked live: setting only `greeting_name` trips none of them. Test 8 proves it under a client JWT.
- The staff card shows a mismatch flag when both are set and they differ.

**Audit**
- `client.org_profile_updated` keeps its changed field names.
- New record `client.contacts_updated` with `{added, updated, removed, main_changed}` as counts and a boolean only. It contains no names or emails.

**`client_org_profile_mine()` additions under the gate**
- `contacts_enabled`, `profile.greeting_name`.
- `people`: the client's live contacts with id, name, email, title, gets_monthly_emails, can_answer, is_main. Never notes, role, created_by, updated_by or source.
- `main_prefill`: the main-contact prefill rule from section 3.
- Scoped users, staff and other callers still get `{eligible:false}`.

## 8. Staff UI (OP_StaffCard, gated by OPC_isOn)
**New section "People to contact"** in the "Organization profile" card (anchor `ov-orgprofile-people`, tour target `op-staff-people`)
- Lists `contact_list` from `staff_client_org_profile`, with the source label, and badges for Main, Monthly emails, Can answer, Added by client and Opted out.
- Add and Edit open an inline form with name, email, title, role (existing select `TK_CC_ROLES`), the ticks Monthly emails / Can answer / Main contact, and notes (staff only).
- Remove uses the existing `tk_retire_client_contact(p_id)`. On the main row, the card first asks for another main, or warns: "The client will be asked to pick a new main contact." The section 3 prefill rule stops a resurrection.
- Logins and the profile-only contact are shown read-only, with the hint "Ask the client to update their org profile, or add them here."
- Read-only in View as (`MGB_viewAsReadOnly()`). The write RPC stays out of the View-as allow-lists, so it is blocked.

**New RPC `staff_client_contact_save(p_client_id text, p jsonb, p_preview boolean default false) returns jsonb`**
- Guard: `tk__req_staff_guard(client)`, which is active staff plus `can_access_client` (admins, assigned staff, approved temp grants that have not expired, internal rule). This is the same guard `tk_save_client_contact` uses.
  - With an `id`, the client is the row's own `client_id`, read from the live row. `p_client_id` must equal it, or the RPC raises `tk_not_found`.
- Then the gate: switch on, or a `test_only` client, or `p_preview` and a real admin. Otherwise 42501 `cc_off`.
- Then `cc__lock`, then `cc__materialize`.
- Fields: `id?`, `name`, `email`, `title`, `role`, `gets_monthly_emails`, `can_answer`, `notes`, `is_main`.
  - Lengths are the same as the table checks.
  - Email uses `cc__email_ok`. No control characters in name or title.
- Setting `is_main` clears the old main row in the same transaction. The old main row's monthly flag stays. Unsetting `is_main` on the main row is refused (22023 `cc_need_main`); staff pick another main instead.
- Duplicate live email raises 23505, mapped to `tk_contact_exists` (same message the drawer already shows).
- Tokens: handled by the trigger `cc__revoke_on_change`.
- Audit `staff.client_contact_saved` with `{client_id, contact_id, fields_changed}`; never values.
- Revoked from public/anon; granted to authenticated.

**Other places**
- The tasks drawer (`TK_ClientContacts.jsx`) and Ask client keep working unchanged on the same rows.
- `TK_ClientContacts` shows the title when the role is blank (a small, gated read-only tweak).
- Ask client (`TK_AskClientModal`): under `OPC_isOn()`, it shows an "Added by client" hint on rows with `source = 'client'`. `tk_request_recipients(p_client_id)` gains `source` per contact (additive; CREATE OR REPLACE after re-reading it live, added to the rollback list). Client rows default to `can_answer` false, but a client can tick it, so staff should see who added an address before sending a link to it.

## 9. Import safety (Master Data sheet, later)
- The import writes only through an admin RPC that runs `set local mgb.cc_import = '1'`.
- It inserts new rows with `source = 'import'`, `can_answer = false` and `gets_monthly_emails` taken from the sheet.
- It updates only rows where `source = 'import'` and `edited_at is null`, meaning nobody has touched them in the portal.
- It never deletes, never clears a field, never sets `is_main` and never changes rows with source `client` or `staff`.
- It fills `client_org_profile.contact_*` only when those are blank and no live main row exists.
- The planning logic `OPI_planContacts(rows, existing)` goes in `OP_importLogic.js`. It is a dry run that returns `{insert, update, skipped_edited, skipped_conflict}` and is node-tested.
- The write RPC itself is out of scope for this build; the rule above is binding for whoever builds it.

## 10. Flags and Dev Tools
- FEATURE_FLAGS (app.jsx, next to `mgb_reviewboard_preview` at about line 1050): add `mgb_orgcontacts_preview` with the label "Org profile contacts (preview)", `reloads: true`. The description says: staff side only (People to contact, board contact list, draft chips); real clients see nothing until the owner flips `org_contacts_enabled`; test clients (`test_only`) get the client form now; writes on real clients need a real admin.
- Switches table (app.jsx about line 15812): add the row `org_contacts_enabled`, "Off (hidden)", owner only, read-only.
- Resettable keys comment block (app.jsx about lines 14219-14239): add `mgb_orgcontacts_cache` (cleared by Reset) and `mgb_orgcontacts_preview` (a flag, kept).
- INFRA_LINKS note (about line 1231): mention migration `client-contacts.sql` once it is applied.
- PAGE_META (app.jsx about line 27645): no change, because there is no new page or route. Say so in the commit message so the upkeep check is visibly done.

## 11. Test plan
**SQL: `supabase/client-contacts-tests.sql`** (pg_temp style, `set local role` plus JWT claims, ends in ROLLBACK)

Gate and auth:
1. With the gate off on a non-test client, save ignores `people` and `greeting_name`, and `mine()` has `contacts_enabled = false`.
   - Every client login is on a `test_only` client, so the test runs `update clients set test_only = false where id = 'basic-test'` inside the transaction.
   - In the same state, `rb__main_contact`, `staff_client_org_profile` (with `profile` keys compared) and the 16 KB cap match today's output exactly.
2. anon gets 42501 on every new or changed RPC. Scoped users get `{eligible:false}`, and their save raises 42501. A staff JWT on `client_org_profile_save` raises 42501.

Client save:
3. A client cannot touch another client's contact id in `upsert` **or** `remove` (22023 `people_id`), and a client_id in the payload is ignored. The main row's id in `upsert` raises `people_id`. Entry keys `is_main`, `source`, `role`, `notes` and `client_id` are ignored (the row is unchanged).
4. Duplicate emails in the payload, and an email equal to the main contact, raise 22023. Errors never contain the email value. Emails with `?`, `&`, `,`, `%`, `#`, `<`, `>` or `"`, and names, titles or greetings with a newline, raise 22023.
5. The mirror creates a single `is_main` row. Changing the main email moves `is_main`, and the old row stays live as "other". The unique index holds.
   - Materialize: a profile-only person becomes a row on the first gated write, and is demoted to "other" when staff make someone else main.
   - Resurrection: staff retire the main row, `mine()` prefill is blank, and `cc__people` has no profile entry.
   - Phone: a main row with a different email from the profile gets no profile phone.
6. The 25-row cap counts only increases: a client with 26 staff rows can still save other fields. The 24 KB cap applies with the gate on, 16 KB with it off.

Tokens:
7. Token revoke through the trigger, for each writer (client save, staff RPC, `tk_save_client_contact` email change, `tk_retire_client_contact`): it revokes only that contact's tokens, and a second contact's open token survives. This catches the null/null trap.

Greeting:
8. Under a **client JWT** (so the `client_profile` guard triggers really run), a blank `client_profile.greeting_name` is filled and no other `client_profile` column changes. An existing greeting is left alone. A missing `client_profile` row inserts nothing. "Hi Jim," becomes "Jim".

People list and main contact:
9. `cc__people` dedupes by email across main, profile, contact and login, and the tombstone suppresses a removed profile contact.
10. `rb__main_contact` returns the sources in order: `main`, then `profile`, then `contact` (monthly), then `login`.

Staff RPC:
11. `staff_client_contact_save` works for an assigned bookkeeper and for an admin. It raises 42501 for unassigned staff and for an expired temp grant. The internal-client lock holds.
    - On a non-test client with the switch off: a bookkeeper or temp admin with `p_preview = true` gets 42501 `cc_off`; a real admin with `p_preview` succeeds.
    - An `id` from client A with `p_client_id` = client B is refused.
    - Unsetting the only main raises `cc_need_main`.

Audit, privacy and import:
12. `audit_log.details` from this feature contains no `@`. The `actor_email` column legitimately holds the caller's email, so the test checks only `details`.
13. Notes are never in `mine()`, `cc__people`, `rb_board`, `rb_draft_recipients` or `staff_client_org_profile.contact_list`.
14. The import setting stamps no `edited_at`, and a portal edit afterwards does.

Grants and helpers:
15. `anon` and `authenticated` get 42501 on `cc__people`, `op__contacts_on`, `cc__materialize`, `cc__lock` and `cc__email_ok` (checked with `has_function_privilege`). `anon` gets 42501 on `staff_client_contact_save`.
16. `staff_client_org_profile` is still `provolatile = 's'` (it stays on the View-as read list).
17. Opt-out: an opted-out non-login contact has `opted_out` true in `cc__people`.

Re-run after the migration: `review-board-tests.sql`, `tasks-p2-5-requests-tests.sql` and `tasks-p2-6-tokens-tests.sql`. The new triggers touch every `client_contacts` writer those files cover.

Also update `supabase/review-board-tests.sql` (lines about 175-225): the old `profile` and `login` assertions still hold on a client with no contacts, and a new case adds a `main` row.

**Node**
- `components/client/OP_contacts.test.js` (new): dedupe, labels, `checkPeople` (duplicates, main collision, caps, error text without values), chip preselect.
- `components/client/OP_logic.test.js`: completeness with `contactsOn` requires email; grandfathering is unaffected; payload includes `greeting_name` and `people` only when on.
- `components/staff/RB_logic.test.js` (about lines 304-337): chips from `contact_list` with `contactsOn` (main plus monthly preselected, opted-out login skipped, opted-out monthly contact off, first-on fallback skips opted-out people). With `contactsOn` false and `contact_list` present, the output is identical to today. The old-shape tests stay as the fallback.
- `OP_contacts.test.js`: `OPC_EMAIL_RE` rejects `a@b.co?bcc=x`, `a,b@x.co` and `a%0A@x.co`.
- `components/client/OP_importLogic.test.js`: `OPI_planContacts` never touches edited or client/staff rows and never deletes.
- Run all existing `*.test.js` files with node.

## 12. Upkeep (same commit, all held or hidden)
- `docs/client-contacts-spec.md` (this file). Append the final RPC contract after the build.
- `docs/client-org-profile-spec.md`: new section "10. People to contact (2026-11-05)" pointing here, plus the completeness change under the gate.
- `docs/review-board-spec.md`: the contact read order and sources (`main`/`profile`/`contact`/`login`), `contact_list`, `people` and the chip preselect rule, in the Final RPC contract section (about line 586).
- `docs/staff-guide/drafts/client-contacts-org-profile.md` (new, held): how staff add or edit people, what the ticks mean and where the board reads them.
- `docs/staff-guide/drafts/whats-new-client-contacts.md` (new, held). Published guides are not edited until launch.
- `docs/staff-guide/drafts/client-help-org-contacts.md` (new, held): the client-facing ? menu and help text for "Other people we should contact" and the greeting. The live client org-profile help and tour stay untouched until launch.
- The held Review board drafts `review-board-guide.md`, `review-board-notice-tour.md` and `review-board-whats-new.md` describe the expander as "Main contact … first portal login". Add a held note covering the contact list and the source labels, effective only when both switches are on.
- Tours and tips: the new section adds `data-tour="op-staff-people"`. The existing `op-staff-card` target and any staff tip that points at the Organization profile card must still resolve (check `grep -rn "op-staff-" components app.jsx`). No new tour step until launch.
- `README.md`: "Client org profile + gifts" section (about line 3206), a hidden contacts note; "Database changes" (about line 1967), `client-contacts.sql`.
- `app.jsx`: FEATURE_FLAGS, the switches row, resettable keys and the INFRA note (section 10).
- `index.html`: add the string `"components/client/OP_contacts.js"` to the script loader array, before `"components/client/OP_store.js"` (about line 674). It is an array entry, not a `<script>` tag. Also bump `MGB_VERSION` (label `2026-11-05d` or that day's next letter; the note starts "Hidden preview: Org profile contacts…").
- `components/auth/supabaseClient.js`: no new read RPC (the existing ones gain keys). `staff_client_contact_save` is deliberately not in `MGB_VIEW_AS_READ_RPCS` / `MGB_VIEW_AS_SILENT_RPCS`. Add a comment saying so.
- Launch notice and tour: not now. Use the `mgb-launch-kit` skill when the owner flips the switch.

## 13. Build plan, file by file
0. **Before writing any SQL**, generate `supabase/client-contacts-rollback.sql` from the live `pg_get_functiondef` of all eight functions this build replaces (list in section 14). It must exist before the migration is applied, or the "pre-migration bodies" are gone.
1. `supabase/client-contacts.sql`: columns, index, `cc__stamp`, `cc__revoke_on_change`, `greeting_name`, `op__contacts_on`, `cc__lock`, `cc__email_ok`, `cc__materialize`, `cc__people`. Then replacements for `rb__main_contact`, `rb_board`, `rb_draft_recipients`, `staff_client_org_profile`, `client_org_profile_mine`, `client_org_profile_save` and `tk_request_recipients` (each re-read live with `pg_get_functiondef` first). Then `staff_client_contact_save`, `tk__owner_only_key` (+`org_contacts_enabled`), grants (helpers revoked from `public, anon, authenticated`), `notify pgrst`.
2. `supabase/client-contacts-tests.sql`, plus edits to `review-board-tests.sql`.
3. `components/client/OP_contacts.js` + `OP_contacts.test.js`.
4. `components/client/OP_logic.js` (+ tests): `contactsOn` option, `greeting_name`, `people` in the payload.
5. `components/client/OP_store.js`: `OP_api.saveContact` (staff), expose `contacts_enabled`; cache key.
6. `components/client/OP_ClientPrompt.jsx`: greeting field, "Other people we should contact" section, error mapping in `OP_saveError`.
7. `components/client/OP_StaffCard.jsx`: "People to contact" section and the greeting mismatch flag.
8. `components/staff/RB_logic.js` (+ tests): `RB_recipientChips(data, me, {contactsOn})` and `RB_rowModel` use `contact_list` only when `contactsOn` is true.
9. `components/staff/RB_ReviewBoard.jsx`: `RB_ContactExpander` lists `contact_list` with source labels; chip empty text.
10. `components/client/OP_importLogic.js` (+ tests): `OPI_planContacts`.
11. `components/tasks/TK_ClientContacts.jsx`: show title (gated).
12. Upkeep files (section 12).

Apply the SQL with the `mgb-supabase-deploy` skill (pre-approved). Run the test file first, then the migration, then the test file again, and confirm everything rolls back.

## 14. Rollback
`supabase/client-contacts-rollback.sql` (kept in the repo and not applied):
- Re-create the **eight** replaced functions from their pre-migration bodies, saved into the rollback file before the apply (build step 0): `rb__main_contact`, `rb_board`, `rb_draft_recipients`, `staff_client_org_profile`, `client_org_profile_mine`, `client_org_profile_save`, `tk_request_recipients` and `tk__owner_only_key`.
  - Restore their ACLs too: the old bodies keep their grants under CREATE OR REPLACE, but say so explicitly.
- Drop the `cc__stamp` and `cc__revoke_on_change` triggers, then `staff_client_contact_save`, `cc__people`, `cc__materialize`, `cc__lock`, `cc__email_ok`, `op__contacts_on`, both trigger functions, and the `client_contacts_one_main` index.
- The new columns stay: dropping columns that hold client data is the owner's call. Readers ignore them.
- Rows that clients added stay live and keep showing in the tasks drawer and Ask client (as `can_answer` false unless the client ticked it). Retiring them is the owner's call.
- The code rollback is a `git revert` of the build commit. Every JS reader falls back when `contact_list` / `people` are missing.
- The switch off is the first-line rollback; with it off, only test clients see anything.

## 15. Risks
1. **The org-profile gate is already live.** Any change that is not behind `op__contacts_on` reaches real clients at once. Every new branch in `mine()`, `save()` and the form checks the new gate.
2. **`tk__revoke_tokens(null, …, null)` revokes every open token.** The only caller this build adds is the trigger `cc__revoke_on_change`, which always passes `new.id`. Test 7 covers it.
3. **Client-added people appear in Ask client and the tasks drawer immediately.** Mitigated by `can_answer` defaulting to false for client rows. Staff should know (guide draft).
4. **Clients see staff-added contacts** (names, emails, titles; never notes or role). Acceptable and stated in the guide. Staff must not put private remarks in title.
5. **`client_profile.contact_email` (GL review send-to, `gl-review-send`) stays a separate field.** It is not unified in this build. The Review board and drafts read the new list; GL review does not.
6. **The greeting fill-blank writes the staff table `client_profile` through a definer** under a client JWT. It is an update only, the column is limited, and it passes `normalize_contact`. 12 clients have no `client_profile` row and get no fill.
7. **Existing tests assert the old sources:** `review-board-tests.sql` and `RB_logic.test.js`. Update them in the same commit, or CI and self-tests fail.
8. **`tk_save_client_contact` does not know the new columns.** It leaves them untouched, which is safe. It can't set `is_main` or the monthly flag; that is done in the staff card only.
9. **The Master Data sheet's columns are unknown.** `OPI_planContacts` is written against a column map that the owner confirms at import time.
10. **The completeness change means a phone-only main contact no longer completes** under the gate. Existing completions are grandfathered, but the next save re-checks them, and the form says why.
11. **`st_my_client_user()` takes `limit 1` with no order.** A login on two clients could load one client in `mine()` and save into the other. The `people_id` own-client rule turns that into an error, not a cross-client write. This is not fixed here.
12. **Contact-type request sends do not check `client_email_recipients` opt-out** (`tasks-p2-6-tokens.sql`). That is existing behavior, unchanged here.

## Critique resolutions (Opus critique, 2026-11-05)
Verified against live definitions (`pg_get_functiondef`, `pg_policy`, `pg_trigger`, `pg_default_acl`) and the worktree code.
1. **Gate leaks:**
   - `RB_recipientChips`, `RB_rowModel` and the expander would use the new list for any admin with only the Review board preview. They now also need `OPC_isOn()`.
   - `rb__main_contact` runs today's body exactly when the gate is off.
   - `staff_client_org_profile.profile` would gain `greeting_name` through `to_jsonb(op)`, so the key is stripped when the gate is off.
   - The cap stays at 16 KB with the gate off.
   - The server completeness rule changes only under the gate.
2. **`p_preview` bypass:** any bookkeeper could write `is_main` or the monthly flag on real clients. It is now real admins only.
3. **Grants:** the default privileges give `anon` and `authenticated` EXECUTE on new functions. Helpers now revoke from `public, anon, authenticated`, with a test.
4. **Races:** the `for update` on the profile locks nothing on a first save. Added the `cc__lock` advisory lock, and 23505 maps to a reload message.
5. **Drift and resurrection:**
   - A staff "make B main" made a profile-only person vanish on the client's next save, so the profile person is now materialized as a row first (`cc__materialize`).
   - The stale profile entry showed a second "main contact", so the profile step now runs only with no main row.
   - The profile phone was attached to the wrong person, so it now attaches only by matching email.
   - A main row that staff retired was re-created by an unchanged client save, so the prefill is now blank when the email is tombstoned.
6. **Crafted payloads:** `remove` had no own-client check, and the main row could be edited through `upsert`. Ignored entry keys are now listed and tested.
7. **Caps:**
   - The 20-entry payload limit plus whole-list sends would lock out clients with more than 20 contacts. The payload is now changes only, with 25 entries per array.
   - The live cap now counts only increases.
8. **Injection:**
   - The SQL and `OP_EMAIL_RE` email regex allowed `?&,%#<>"`, which are silently dropped by `RB_emailOk` and unencoded in the expander's raw `mailto:`.
   - Added a stricter shared regex and `RB_mailto` in the expander.
   - Control characters are now rejected in name, title and greeting.
9. **Tokens:** revoking moved to one AFTER UPDATE trigger. It never passes a null id, and it also covers `tk_save_client_contact` email edits, which today leave links open.
10. **Opt-out** now applies to every person, not only logins. Chips never preselect an opted-out person.
11. **Key name:** `rb_board` rows already have `people` (MGB staff), so the new key is `contact_list` everywhere staff-side.
12. **Greeting write:** checked against the five `client_profile` guard triggers. Setting only `greeting_name` is safe, and test 8 runs under a client JWT.
13. **Tests:** test 1 must flip `basic-test` to non-test, because every login is on a test client. Test 12 checks only `details`, because `audit_log.actor_email` holds an email. Added tests 15-17 and re-runs of the tasks and token test files.
14. **Rollback:**
   - There are eight replaced functions, not six. `tk__owner_only_key` and `tk_request_recipients` were missing.
   - The rollback file must be generated before the apply (build step 0).
   - Client-added rows survive a rollback.
15. **Upkeep:**
   - `index.html` uses a loader array, not a `<script>` tag.
   - Added the held client help draft and held Review board draft notes.
   - Added tour and tip target checks, PAGE_META "no change", and the flag description.

**Owner decisions**
- **Q1:** Can clients edit or remove contacts that staff added? Spec default: yes, with tokens revoked and audit counts.
- **Q2:** Should the token-revoke trigger also apply to today's `tk_save_client_contact` email edits (a small live change: open links for that contact stop working)? Spec default: yes.

**Owner answers (2026-11-05)**
- **Q1:** yes. Clients may edit or remove contacts staff added (never `notes` or `role`).
- **Q2:** overridden. The revoke trigger does nothing while the gate is off for that client (see section 3), so nothing changes for real clients until the switch is on.

## Build notes and final RPC contract (2026-11-05)
Migration `supabase/client-contacts.sql` applied to production 2026-11-05 (rollback `client-contacts-rollback.sql`, generated before the apply, not run; self-test `client-contacts-tests.sql`, rolls back). Code is in the worktree, all hidden.

**Gate:** `op__contacts_on(client)` = `tk_settings.org_contacts_enabled` true OR `clients.test_only`. Client UI decides only on `mine().contacts_enabled === true`. Staff UI: `OPC_isOn()` = `OP_isOn()` AND (`mgb_orgcontacts_cache` = "1" OR `mgb_orgcontacts_preview` = "1"); `OPC_readSwitch()` fills the cache and emits `mgb:orgcontacts`; `OPC_useGate()` re-renders.

**`cc__people(client)` entry:** `{name, email, phone, title, role, is_main, gets_monthly_emails, can_answer, opted_out, source: "main"|"profile"|"contact"|"login", contact_id, added_by_client}`; deduped by lower(trim(email)), first wins; never notes.

**`client_org_profile_mine()`** always has `contacts_enabled`. When true it adds `profile.greeting_name`, `main_prefill {name, email, phone}` (all null when the main row was retired) and `people [{id, name, email, title, gets_monthly_emails, can_answer, is_main}]`.

**`client_org_profile_save(p)`** (gate on) also takes `greeting_name` and `people {upsert:[{id?, name, email, title, gets_monthly_emails, can_answer}], remove:[id]}`. Errors (22023 unless noted): `people_id`, `people_remove_main`, `people_email_duplicate: people[n].email…`, `people_limit…`, `people[n].email is not a valid…`, `people[n].name is required`, `greeting_name has characters…`, `payload is too large`; 23505 on a race. Errors never carry the value.

**`staff_client_org_profile(id)`** adds `contacts_enabled`, `contact_list` (cc__people) and `greeting {org_profile, client_profile, mismatch}`.

**`rb_board` / `rb_draft_recipients`** add `contact_list` per client (always present; the UI uses it only under `OPC_isOn()`). **`tk_request_recipients`** contacts add `source` and `title`.

**`staff_client_contact_save(p_client_id, p, p_preview)`** → `{id, contact_list}`. `p`: `{id?, name, email, title, role, notes, gets_monthly_emails, can_answer, is_main}`; role and notes are overwritten with what is sent, so the staff form always sends them. Errors: `tk_bad_contact`, `tk_not_found`, `cc_off`, `cc_need_main`, `tk_contact_exists` (23505). Retire stays `tk_retire_client_contact({p_id})`.

**Deviations from the sections above**
1. Revoke reason is `contact_retired` (the reason check allows no new value).
2. The gate-off admin-preview path of `staff_client_contact_save` revokes tokens itself (the trigger is a no-op there, Q2 override).
3. `mine()` always includes `contacts_enabled` (false when off); `contact_list`, `greeting`, `contacts_enabled` are always-present extra keys on the staff and board RPCs. The UI ignores them when off.
4. A crafted client upsert that would merge into the main row is rejected (`people_id`).
5. The materialized main row uses `created_by = 'org_profile'`.
6. Existing tests changed: `client-org-profile-tests.sql` (25 KB payload case, phone-only completeness assertion under the gate) and `review-board-tests.sql`.
7. `OPI_planContacts` also returns `skipped_invalid`.
8. `OPC_toChips(people, seen)` takes the caller's `seen` map (shared with Cc de-duplication), not `me`; `RB_recipientChips` accepts `opts.toChips` for tests.
9. The old-path expander email link now goes through `RB_mailto` (only valid addresses become links); otherwise the old expander is unchanged.
