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
