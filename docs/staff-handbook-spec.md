# Staff Handbook — Spec (v1)

Drafted 2026-10-13 and revised after the Opus critique (see the log at the end). Status: **draft for owner approval. No code until approved.**

Rules that apply to every part:
- No personal names or emails in repo files. People appear as roles or settings.
- American spelling.
- Follow the README conventions: file prefix, `window.__SOURCE_ORDER`, re-runnable flat SQL, `MGB_VERSION` bump, and grant hardening (`search_path`, revoke from public/anon, grant to authenticated).

**Reuse, don't rebuild.** Team Reviews already does two-party signing:
- `tr_sign` stores the typed name, the acknowledgment text, IP and browser.
- Signature tables are insert-only, enforced by triggers.
- `team-reviews/pdf.ts` builds the PDF on the server with cp1252 fonts.
- The PDF is filed automatically in the admin-only Staff Reviews Shared Drive.

The Handbook follows that pattern and reuses its helpers.

---

## Part A — For the owner

**What staff get.** A **Handbook** tab under Team. It lists the firm's staff policies, each with a current version and its history.

**Who signs.** Only staff with the `bookkeeper` role. Admins and anyone else can read the policies but are never asked to sign.

**How a bookkeeper signs.**
1. They read the policy in the portal. The sign panel unlocks after they scroll to the end.
2. They tick *"I have read and agree to this policy, and I agree to sign it electronically."*
3. They type their full name. It must match their staff name, with capitals and spaces ignored.
4. They press **Sign**.

The server records the version, the typed name, the agreement sentence, the time, their IP address and their browser. The **Effective Date** on their copy is the day they sign.

**Countersigning.** The countersigner (the Account Manager, held as a setting) sees a "Countersign" item on Today and on the tab. They type their name and press **Countersign**. That completes the signature.

**When a policy changes.** An admin edits the text and publishes a new version as one of two kinds:
- **Needs re-signing:** each bookkeeper gets a nudge. That's a row on Today, a badge on the Handbook tab and one email. They have **7 days** to sign. After that the Today row and the admin grid show **Overdue**. Older signed copies are kept.
- **Minor edit** (typo, formatting): nobody re-signs. Each signature stays tied to the exact version that person signed.

**The signed copy.** When the countersignature lands, the server builds the PDF once and saves it to the Staff Reviews Shared Drive under `Handbook / <Policy>`. It is named `<Policy> v<n> — <Name> — <YYYY-MM-DD>.pdf`.
- **Download:** the signer can download their own copy from the portal, and admins can download anyone's.
- **What it shows:** the policy text as signed, the version, the Effective Date, both typed signatures with time, IP and browser, and the record fingerprints.

The Google Drive copy is the firm's record. A separate editable Google Doc is dropped, because an editable file is a weaker signed record.

**The first policy.** *Flexible Work, Scheduling & Operational SLA Policy*, imported as version 1 with the Asana wording. When the Tasks module launches, an admin publishes version 2, with Asana changed to Tasks, as **Needs re-signing**.

**Admin view.** A status grid with policies down the side and bookkeepers across the top. Each cell shows Signed, Awaiting countersign, Needs re-sign or Not signed, with the date.

---

## Part B — Decisions (recorded)

| # | Decision | Source |
|---|---|---|
| B1 | Sign inside the portal and export a signed copy. No hand-off to Google eSignature, because it has no API. | Owner, 2026-10-13 |
| B2 | Only the `bookkeeper` role is required to sign. | Owner |
| B3 | A Handbook that can hold many policies. This policy is the first. | Owner |
| B4 | The Effective Date is each signer's signing date. | Owner |
| B5 | Keep the Asana wording until Tasks launches, then publish a version that needs re-signing. | Owner |
| B6 | The Account Manager countersigns, stored as a setting. | Owner |
| B7 | Changes nudge bookkeepers to re-sign. The publisher chooses "needs re-signing" or "minor edit". | Owner; the choice is proposed here |
| B8 | The signed record is a PDF built on the server and saved to the Staff Reviews Shared Drive. No Google Doc copy for now. | Owner, 2026-10-13 |
| B9 | Re-signing is due 7 calendar days after publish. After that it shows as Overdue. No penalty or lockout. | Owner, 2026-10-13 |
| B10 | Policy wording: "CEO" stays. "Co-Pod Leader" is replaced by the COO and Account Manager. Section 7 stays as written. | Owner, 2026-10-13 |

---

## Part C — Database (`supabase/staff-handbook.sql`)

The file must be re-runnable.
- **Header lists dependencies:** `staff`, `is_active_staff()`, `is_active_staff_admin()`, `audit_write()`, `notification_outbox`, `tr_request_ip()`, `tr_request_ua()`, `tr_kick` (or its equivalent), and the latest outbox/log check lists in `tech-inventory-v2.sql`.
- **Check the live database first.** Verify the dependencies there before relying on the header.

**`handbook_policies`**
- Columns: `id uuid pk`, `slug text unique`, `title text`, `sort int`, `active bool default true`, `created_at`.
- The bookkeeper-only rule lives in one function, `hb_is_signer(email)`. It means `role = 'bookkeeper'` and active. There is no per-policy role list.

**`handbook_versions`**
- Columns: `id uuid pk`, `policy_id fk`, `version_no int`, `body_md text`, `body_sha256 text`, `requires_resign bool`, `change_note text`, `published_at`, `published_by text` (lower-case email).
- Unique on `(policy_id, version_no)`.
- **Immutable:** a `BEFORE UPDATE OR DELETE` trigger raises an error.
- `body_sha256` is computed in the publish RPC, over the source text with its placeholders. The PDF labels it "SHA-256 of policy source v<n>."

**`handbook_signatures`**
- Columns:
  - `id uuid pk`, `version_id fk`, `staff_email text` (lower-case)
  - `typed_name`, `ack_text`, `signed_at`, `sign_ip`, `sign_ua`, `body_sha256` (copied from the version)
  - `countersigner_email`, `countersign_typed_name`, `countersign_ack_text`, `countersigned_at`, `countersign_ip`, `countersign_ua`, all null until countersigned
  - `pdf_drive_file_id`, `pdf_sha256`, null until filed
- Unique on `(version_id, staff_email)`.
- **Trigger** (the same approach as Team Reviews `team-reviews-1-schema.sql:432-438`):
  - Blocks deletes.
  - Blocks any update except two:
    1. Setting the countersign columns once, from null.
    2. Setting the two PDF columns once, from null.

**`handbook_settings`**
- A single row: `countersigner_email text references staff(email)`.
- **Read:** any active staff member.
- **Write:** only through the admin RPC `hb_set_countersigner(email)`, which audits `handbook.countersigner_changed`.
- **Null or inactive countersigner:** countersign items wait. Admins see a "No active countersigner set" warning on the tab.

**Current version per policy.** The required version is the newest one with `requires_resign = true` (v1 counts as one). A bookkeeper is current if they have signed that version or any later one.

**Due date.** The due date is the required version's `published_at` date (America/Chicago) plus 7 calendar days. It is computed in `hb_status()` and `hb_get_policy()`, not stored. A bookkeeper activated after publish gets 7 days from their own `created_at` instead.

Possible states per bookkeeper and policy: `not_signed`, `overdue`, `awaiting_countersign`, `signed`.

**RLS**
- Policies and versions: active staff can read; there are no direct writes.
- Signatures: the signer reads their own rows; admins and the active countersigner read all. There are no direct inserts or updates.

**RPCs**

All are `SECURITY DEFINER`, set `search_path = public`, are revoked from public and anon, are granted to authenticated, and write to `audit_write`.

- `hb_sign(p_version_id, p_typed_name, p_ack boolean)`
  - Checks:
    - The caller passes `hb_is_signer`.
    - `p_ack` is true.
    - The version is the policy's latest.
    - The typed name matches `staff.name` once normalized.
    - The caller hasn't already signed this version.
  - Records: the IP and browser from `tr_request_ip()` and `tr_request_ua()`, and the acknowledgment text from a fixed function `hb_ack('signer')`.
  - Queues a countersign nudge. Audit action: `handbook.signed`.
- `hb_countersign(p_signature_id, p_typed_name, p_ack)`
  - Checks:
    - The caller equals the setting's email and is active staff.
    - The name matches.
    - The signature is not already countersigned.
    - The caller is not the signer.
  - On success, starts the PDF export (the `tr_kick` pattern). Audit action: `handbook.countersigned`.
- `hb_publish_version(p_policy_id, p_body_md, p_requires_resign, p_change_note)`
  - Admin only. Creates the next `version_no`.
  - When re-signing is needed, queues one email per active bookkeeper. Audit action: `handbook.published`.
- `hb_get_policy(p_slug)` and `hb_status()`: read helpers for the view and the admin grid.
- `hb_retry_export(p_signature_id)`: admin only, for when Drive filing failed.

---

## Part D — Server PDF and filing

- **Where the code goes:** a new `export_handbook` action in the `team-reviews` edge function. It reuses that function's Drive helpers, the `GOOGLE_DRIVE_REVIEWS_DRIVE_ID` drive and `pdf.ts` fonts. `drive-files` stays untouched, because its drive is the client-files drive.
- **Rendering:**
  - Placeholders are filled in: `{{effective_date}}` becomes the signing date in America/Chicago, and `{{employee_name}}` becomes the typed name.
  - The rendered text goes into the PDF with the same cp1252 handling as reviews.
  - The function computes `pdf_sha256`, files the PDF under `Handbook / <Policy>`, and writes the file id and hash back through a service-role update, which the trigger allows once.
- **Download:** a `download_handbook_pdf` action streams the filed PDF. The caller must be the signer, the row's countersigner, or an admin. The audit action is `handbook.exported`.

---

## Part E — Front end (`components/handbook/`, prefix `HB_`, CSS `.hb-`)

| File | Contents |
|---|---|
| `HB_api.js` | RPC wrappers and the download call |
| `HB_HandbookTab.jsx` | Policy list with my status; the admin status grid; the countersigner's queue; the admin "Publish new version" editor (markdown textarea, live preview, change note, Needs re-signing / Minor edit); the countersigner setting |
| `HB_PolicyView.jsx` | Renders `body_md` with `HLP_Markdown` (text only). The sign panel sits at the bottom and unlocks at the end of the scroll. Before signing, placeholders show as "Date of signing" and "Your name". |
| `hb.css` | Styles; must work at phone width |

**Wiring** (checked against the code)
- **Team tab:** add `{key:"handbook", label:"Handbook", help:"staff-handbook", visible: () => typeof HB_HandbookTab === "function"}` to `NAV_PLACES` Team tabs (`StaffNav.jsx`). In `TP_TeamHub` (`TeamPage.jsx`), add an `else if (current === "handbook")` body branch and a `badgeFor("handbook")` count: my unsigned items, plus items to countersign for the countersigner.
- **Deep link:** `#/team/handbook?item=handbook:<policy-slug>`. Add `handbook` to `LK_KINDS`, add `"team/handbook"` to `LK_PLACE_CLAIMS`, and have the Handbook tab register as the link claimer.
- **Today:** a `TD_useHandbookItems` hook that fails quietly. It adds **now** rows:
  - "Sign: <policy> v<n>" with "Due <date>" (or "Overdue"), for bookkeepers.
  - "Countersign: <signer>, <policy>", for the countersigner.
  - Add labels in `TD_KIND_LABEL`.
- **Audit log:** labels for the five `handbook.*` actions in `AL_actionLabel`.
- **Load order:** the `components/handbook/*` files go into `__SOURCE_ORDER` before `app.jsx`, and into `.vercelignore` alignment.

---

## Part F — Email

- **New kinds:** `handbook_sign_needed` (to each bookkeeper when a version needing re-signing is published) and `handbook_countersign_needed` (to the countersigner when someone signs).
- **Constraints:** redo **both** check constraints:
  - the outbox `kind` check;
  - `client_email_log_feature_check`.

  Copy the full lists from `tech-inventory-v2.sql:52-61` and add the new kinds.
- **Send branch:** add one in `notification-emails`. The email has a link only, with no policy text. Recipients must be active staff. The preference key is `notify.email.handbook`.
- **No reminder cron in v1.** One email plus the persistent Today row and badge is enough for a team of about five. A weekly reminder can be added later if signatures lag.

---

## Part G — Content import (version 1 body)

Convert the current Google Doc to markdown and seed it as v1 of `flexible-work-sla`, with `requires_resign = true`. Changes made during import:
- **Effective Date:** `[Date]` becomes `{{effective_date}}`.
- **Calendar bullets:** the colored-circle emoji in section 3B come through garbled in export. The PDF can't print emoji (cp1252), so they become words: **Available (green)**, **Offline (red)**, **Async (blue)**.
- **Section 6 numbering:** it reads 1., 1., 1. in the source. Fix it to 1, 2, 3.
- **Signature lines:** the underscore lines are dropped. The portal's signature block replaces them.

**Wording approved by the owner (B10):**
- **"CEO" stays as written.**
- **SLA table, Urgent Client Escalation:** "peer Co-Pod Leader steps in" becomes "the COO or Account Manager steps in".
- **SLA table, Emergency Escalations:** "between Co-Pod Leaders and CEO" becomes "between the COO, Account Manager and CEO".
- **Section 7 stays as written.**
- **Section 6.3** reads "weekly pod/team syncs". Change it to "weekly team syncs", since "pod" went with Co-Pod Leader. Confirm when reviewing.

---

## Part H — Staff guide

- **New article** `docs/staff-guide/staff-handbook.md` (audience staff, with an admin section): how to sign, what re-signing means, where signed copies live.
- **Update `team-page.md`.** Run `sync.mjs` and apply the SQL.

---

## Part I — Build plan and owner checks

**Size: big** (signatures and permissions). Opus specs, builds and reviews; Haiku runs the screenshot sweep.

**Order**
1. SQL with `pg_temp` probes for each RLS rule and each trigger rule (forge, edit, delete, countersign own, wrong name).
2. `HB_api` and the policy view.
3. Sign and countersign.
4. Edge-function PDF and filing, then download.
5. Today, badge and deep link.
6. Publish editor, status grid and countersigner setting.
7. Emails.
8. Guide.
9. `MGB_VERSION` bump.

**Owner live checks after shipping**
1. A bookkeeper signs v1. They see Awaiting countersign, and the countersigner gets a Today row and an email.
2. The countersigner signs. A PDF lands in Staff Reviews › Handbook with both signatures, IP, and an Effective Date equal to the signing date. The bookkeeper can download it.
3. An admin publishes a minor edit. Nobody is nudged.
4. An admin publishes a version that needs re-signing. Every bookkeeper gets a Today row, a badge and an email, and the old PDF is still there.
5. An admin who isn't a bookkeeper sees no sign prompt.

---

## Part J — Risks and notes

- **Legal weight.** For an internal policy acknowledgment, this covers the usual US e-signature basics (ESIGN/UETA):
  - a consent tick, with the consent sentence stored on the record;
  - a typed name that shows intent;
  - IP and browser recorded;
  - the record tied to a fingerprint of the exact source text;
  - a filed copy the signer can download.

  Not legal advice. The Co-CEOs may want counsel to glance at it.
- **Countersigner change.** Open countersign items move to the new person. Completed countersigns keep the original.
- **Departed bookkeepers** (inactive) drop out of the grid and nudges. Their records and PDFs are kept.
- **Open questions for the owner:** none. The spec is ready for approval.

---

## Part K — Policy kinds and drafts

Added 2026-10-19. SQL: `supabase/staff-handbook-3-kinds.sql` (run after `staff-handbook-2-admin.sql`; it redefines `hb_status`, `hb_publish_version`, `hb_sign`, `hb_countersign`, `hb_retry_export`, `hb_get_policy` and `hb_signature_doc`). Checks: `supabase/staff-handbook-3-kinds-tests.sql` (one transaction, ends in ROLLBACK). Front end: `HB_logic.js` (pure rules, node test `HB_logic.test.js`), `HB_HandbookTab.jsx`, `HB_PolicyView.jsx`, `HB_Admin.jsx`.

**Columns on `handbook_policies`:**
- `kind`: `signed` or `reference`. Existing policies are backfilled to `signed`. The seeded `flexible-work-sla` stays signed and published, unchanged.
- `status`: `draft` or `published`. Existing policies are `published`.
- `section`: optional, up to 80 characters. Used to group reference policies.
- `published_at`.

**Reference policies:**
- Read-only and versioned, like any policy.
- No sign panel, status grid row, nudges, Today items, badge or emails. Not part of the signing state (`hb_state`).
- Every version is a minor edit. The rule "version 1 needs re-signing" is relaxed for reference only. A trigger refuses `requires_resign` on a reference version.
- The server refuses reference policies in `hb_sign`, `hb_countersign`, `hb_retry_export` and the PDF export (`hb_signature_doc`). A trigger on `handbook_signatures` refuses them too.

**Drafts:**
- Visible to admins only, in `hb_status`, `hb_get_policy` and RLS on `handbook_policies` / `handbook_versions`.
- A draft never reaches Today, the badge, the grid, the countersign queue or email.
- An admin can save new draft text with **Edit text**. Draft versions don't email anyone.

**Admin RPCs** (all admin-only and audited):

| RPC | Does | Audit |
|---|---|---|
| `hb_create_policy(title, slug, kind, section, body_md)` | Creates a reference draft with version 1. `kind` must be `reference` or empty; `signed` is refused (SQLSTATE 22023). The slug matches `^[a-z0-9][a-z0-9-]{1,80}$` and is unique. Never emails. | `handbook.policy_created` |
| `hb_publish_policy(policy_id)` | Draft → published. A signed policy emails each active bookkeeper once (7 days to sign). A reference policy emails nobody. | `handbook.policy_published` |
| `hb_update_policy(policy_id, title, section, sort)` | Changes the title, section and list order. The slug never changes. A null sort keeps the current one. | `handbook.policy_updated` |
| `hb_convert_to_signed(policy_id, body_md, change_note, confirm)` | Reference → signed. Needs `confirm = true` and a change note. Publishes a new version that needs re-signing (the current text when `body_md` is empty). Emails only when the policy is already published. | `handbook.policy_converted` |

**Owner rule: nobody is asked to sign until an admin converts.** Every new policy is a reference policy. The New policy form has no kind choice, and the server refuses `kind = 'signed'` in `hb_create_policy`. The only way a policy starts asking for signatures is the explicit, confirmed and audited `hb_convert_to_signed`. On a draft, the emails wait for `hb_publish_policy`.

**Kind changes:**
- Reference → signed only through `hb_convert_to_signed`, enforced by a guard trigger.
- Signed → reference is refused, and so is published → draft.

**List:**
- "Policies to sign" (signed and published) comes first.
- Reference policies follow, grouped by section, A to Z, with "General" for those without a section, last.
- "Drafts" (admins only) comes at the end.
- Client-side search covers title, section and slug.

**Second lock.** The front end filters reference policies and drafts out of Today, the badge and the grid (`HB_todayItems`, `HB_badgeCount`, `HB_gridPolicies`) even though the server already leaves them out.

---

## Part L — Draft approval

Added 2026-10-19. SQL: `supabase/staff-handbook-4-approvals.sql` (run after `staff-handbook-3-kinds.sql`; it redefines `hb_status`, `hb_get_policy`, `hb_publish_policy` and `hb_convert_to_signed`). Checks: `supabase/staff-handbook-4-approvals-tests.sql` (one transaction, ends in ROLLBACK). Seed: `supabase/staff-handbook-4-seed-handbook-drafts.sql`. Email: `notification-emails` kind `handbook_approval_needed` (`handbookApproval.ts`). Front end: `HB_logic.js`, `HB_api.js`, `HB_PolicyView.jsx`, `HB_Admin.jsx` (`HB_ApprovalCard`), `HB_HandbookTab.jsx`, `hb.css`, plus Today, the Team tab badge, Settings and the Audit log.

**Rule.** A draft can only be published once the policy approver has approved its exact current text. Published policies, including the SLA policy, have no approval step: their changes go through **Publish new version** as before.

**Columns on `handbook_policies`:**
- `approval_status`: `not_required` (every published policy), `pending`, `approved` or `changes_requested`. Existing drafts become `pending` when the file runs, with no email. New drafts start `pending`.
- `approved_by`, `approved_at`, `approved_version_id`, `approved_sha256`: who approved which text. Publishing needs the version id and its body hash to match the latest version.
- `approval_note`: the approver's note when asking for changes (up to 2,000 characters; kept after the next edit so the editor still sees it).
- `approval_updated_at`, `approval_updated_by`.

**Approver.** `handbook_settings.policy_approver_email`, default `bailley@mygoodbooks.org`. Any admin changes it with `hb_set_policy_approver(email)`; the new approver must be an active admin, and the change is audited (`handbook.approver_changed`). Approvals already given stay valid. While the setting doesn't point at an active admin, nothing can be approved, so nothing can be published, and the Handbook tab, the draft bar and the approval card all say so.

**Triggers (so every path is covered):**
- Approval columns only change inside the approval RPCs (a transaction-local setting PostgREST can't set). Anything else is refused (42501).
- A new version of a draft (**Edit text**, which is `hb_publish_version` on a draft, or **Make this a signed policy**) resets it to `pending` (audit `handbook.approval_reset`, reason `text_changed`).
- A title, section or kind change on an approved or changes-requested draft resets it to `pending` (reasons `details_changed`, `kind_changed`). The list order alone doesn't.
- Backstop: a draft can't become `published` unless it is `approved` (55000).

**RPCs** (all audited):

| RPC | Who | Does | Audit |
|---|---|---|---|
| `hb_approve_policy(policy_id, version_id)` | approver only (42501 for anyone else) | Approves the latest version. `version_id` is the version the approver read; if the draft changed since, it's refused (55000) and the UI reloads. | `handbook.policy_approved` |
| `hb_request_changes(policy_id, note)` | approver only | `changes_requested` with a required note. Also withdraws an approval. Nobody is emailed. | `handbook.policy_changes_requested` |
| `hb_set_policy_approver(email)` | any admin | See Approver above. Queues the batched notice for the new approver when drafts are waiting. | `handbook.approver_changed` |

`hb_publish_policy` and `hb_convert_to_signed` (on a draft) refuse with the reason from `hb_approval_problem` (55000) until the latest text is approved. A converted draft then needs approval again, since its kind and text changed. `hb_status` adds, for admins, each draft's `approval_status`, `approval_current` and `approval_note`, plus `approver`, `approver_missing`, `approver_setting`, `approvals_pending`, `admins` and `me.is_approver`; the approver's `badge` includes the drafts waiting. `hb_get_policy` adds `approval` (status, whether it matches the latest text, who and when, the approved version, the note and the `problem` text) and the approver.

**Notice to the approver (one email per batch).** When a draft becomes `pending` (created, edited after approval or after changes were requested, details changed) or the approver changes while drafts wait, `hb_queue_approval_notice()` queues one `handbook_approval_needed` row for the approver, except:
- the approver isn't set or isn't an active admin;
- the approver made the change themselves;
- an unsent row for the approver already exists. That email reads the live count when it goes out, so it covers this draft too.

A new row waits until 30 minutes after the last one sent (`payload.not_before`). So the approver gets at most one email per 30 minutes however many drafts are created or saved, and saving a draft that is already waiting queues nothing. At send time the edge function checks the recipient is still the approver and an active admin, and counts the drafts waiting (none: skipped). The email gives the count and links to `#/team/handbook?item=handbook:approvals`; it never includes titles or policy text. Preference: **Settings › Notifications › Handbook drafts to approve** (`notify.email.handbook_approval`, on by default). A pure copy of the rule, with node tests, is in `supabase/functions/notification-emails/handbookApproval.ts` / `tests/edge/hb_approval_email.test.mjs`.

**Front end:**
- An **Awaiting {first name}'s approval** pill (or **Approved**, or **Changes asked**) on each draft in the list and the policy view. Filter chips with counts above the Drafts group (**All drafts**, **Awaiting {first name}**, **Changes asked**, **Approved**). A draft approved on older text counts as awaiting.
- The approver line at the top of the tab for admins: who approves, how many drafts wait, and **Change** (any admin). A warm warning when the approver isn't an active admin.
- For the approver only: **Needs your approval (N)** panel with **Review** links, a Today row "N handbook policies need your approval", and the count in the Team › Handbook badge (combined with anything to sign or countersign).
- The **Approval** card on a draft: the state and any note for every admin; **Approve version N** and **Request changes** (or **Withdraw approval and ask for changes**) for the approver only. Other admins read "Only {name} can approve handbook drafts."
- **Publish** and **Make this a signed policy** on a draft are disabled with the reason until the current text is approved.
- **Edit text** on an approved draft shows, before saving, that saving sends it back for approval; the confirm step and the toast say so too. **Edit details** warns when a title or section change will reset an approval.

**Editing paths.** Drafts (including the seeded chapters) are edited with **Edit text** (Markdown with live preview; each save is a new draft version, still a draft, back to `pending`) and **Edit details**. A published reference policy is changed with **Publish new version**, which is always a minor edit for reference policies and has no approval step.

**Seed.** `staff-handbook-4-seed-handbook-drafts.sql` loads chapters 1–9 of the Employee Handbook mockup as nine reference drafts in the section "Employee Handbook" (order 1–9), each version 1, `pending`. Placeholders are `**[TBD: ...]**` so they stand out and can be edited in the app. It refuses to run before the approvals file, skips any slug that already exists, never publishes, converts or creates a signature, and queues only the one batched approver notice. Chapter 10 (Acknowledgment, a sign-here page) isn't loaded: signing in the portal replaces it.

**Deploy order:** the `notification-emails` edge function first (so the new kind isn't dropped as unknown), then `staff-handbook-4-approvals.sql`, then the seed once. Re-run `staff-handbook-4-approvals.sql` after any re-run of `staff-handbook.sql`, `-2-admin.sql`, `-3-kinds.sql`, or a file that restates the outbox kind checks in full.

---

## Critique log

**Opus critique, 2026-10-13. All findings were accepted.**

| Topic | Change |
|---|---|
| Drive | Use the Staff Reviews drive via `team-reviews`, not `drive-files` |
| Signing pattern | Reuse the `tr_*` signing pattern |
| IP and browser | Captured on the server through `tr_request_ip`/`ua` |
| PDF integrity | Built once on the server, then filed and hashed |
| Signature table | Trigger makes it insert-only |
| Countersigner setting | Gets RLS and an admin RPC |
| Email constraints | Both check constraints redone |
| Wiring | Corrected |
| Grants | Grant hardening applied |
| Scope trimmed | Dropped the Google Doc copy, the `signer_roles` array and the weekly cron |
