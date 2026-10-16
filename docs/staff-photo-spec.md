# Staff profile photos: required upload, admin edit and uniform display

Spec date: 2026-10-16. Status: ready to build. Size: **big** (permissions, storage policies,
edge functions). Opus writes the spec, reviews and does the final verify. Sonnet builds chunks A, B
and C. Haiku runs the screenshot and grep sweeps.

## Part A: what the owner asked for

1. Every staff member must submit a profile photo as part of onboarding. Until they do, the app is
   blocked, except for Settings and Sign out.
2. Admins can download the photo (one at a time or all at once) and remove the background in an
   outside tool so every photo matches. They then upload the edited version, which becomes the
   photo shown everywhere. The staffer's original is never lost.
3. Photos look the same everywhere they appear: in the app (circle, same crop) and in email
   signatures (a brand-color circle behind a transparent PNG).

Not in scope: automatic background removal, client photos, and changing who can see staff photos.

## Part B: decisions (defaults the builder must follow)

| # | Question | Decision |
|---|---|---|
| B1 | Where is the "current photo" stored? | `staff_profiles.photo_path` stays the current-photo pointer, so every existing reader keeps working unchanged: `bookkeeper_public_profile`, `client_team_profiles`, `signature.ts`, `ST_profile` and `AM_usePhoto`. History lives in a new `staff_photo_versions` table. |
| B2 | Who must upload? | Every **active** staff member (admins and bookkeepers) whose status is `missing` and who is not exempt. Staff who already have a `photo_path` pass the gate on day one through the backfill. |
| B3 | Test or internal accounts? | There is no internal or test staff concept in the schema (`can_view_internal()` is about the internal company client, and `hb_is_signer` is role only). Add an admin-only **Not required** switch (`staff_photo_exemptions`). An exempt staffer with no photo never sees the gate. |
| B4 | Is "View as" exempt? | Yes. The gate never renders while `impersonating` is set, while previewing a client user (`isPreviewingUser`), or for the person being viewed. The server ignores View as, because RPCs use the real JWT. |
| B5 | Status values | Derived, never stored: `missing` (no photo), `exempt` (no photo and exempt), `submitted` (shown in the UI as **Needs edit**: the current version is the staffer's own), `edited` (shown as **Done**: the current version is an admin edit). |
| B6 | What happens when a staffer resubmits after an admin edit? | The new upload becomes current, so status goes back to `submitted` and the admin Today item reappears. Earlier admin edits stay in history. |
| B7 | How are admins notified? | An admin Today item, "N profile photos to edit" (rank 3), derived from the list. It reappears on every resubmit. No new email kind and no Tasks rows. Staff tasks are deliberately not inserted from SQL because of `staff_reminders_before_write`. |
| B8 | What does "Restore original" do? | It makes the staffer's own **cropped square** from their latest submission current again. The raw original is never shown directly, because it isn't square and email `<img>` tags can't crop. If that submission has no crop (backfilled legacy photos), the latest `original` is used. Status becomes `submitted`. |
| B9 | Are storage objects ever deleted? | Never. The staff `update`/`delete` storage policies are dropped. Versions are only soft-deleted (`deleted_at`). Old emails' five-year signed URLs keep working because the object is never removed. |
| B10 | Who can see photos? | Narrowed, never widened. Originals and history: the owner and real admins only. A current photo: all active staff, plus the client users who could already see it (their assigned bookkeeper's and account manager's current photo). |
| B11 | Who counts as an admin for photo actions? | `public.is_active_staff_admin()` on the server, which already excludes temp admins. On the client: `staffUser.role === "admin" && !impersonating`. Temp admins see the Photo column read-only, with no actions and no downloads. |
| B12 | File rules | Input jpg, png, webp, or HEIC where the browser can decode it. Input up to 15 MB. The cropped square must cover at least 400 × 400 source pixels. Outputs are re-encoded through canvas, which strips EXIF and GPS. Original: JPEG, longest side ≤ 2048 px. Current: 512 × 512 JPEG. Admin edit: 512 × 512 PNG with alpha kept. Bucket limit raised to 5 MB. |
| B13 | Can staff remove their photo? | No. Settings changes from **Remove photo** to **Change photo**, and only the upload flow remains. Admins use Not required for the rare person who can't have a photo. |
| B14 | Bulk download | Yes. "Download all (zip)" on the admin card uses a tiny stored (uncompressed) zip writer, about 70 lines, kept in the pure logic file so it is unit-tested. It is logged once per zip. |
| B15 | Audit | Every RPC that changes something writes both `audit_write('staff_photo.<verb>', null, 'staff', <email>, details)`, shown on the Audit log page, and a `staff_audit_log` row, shown on the Dev Tools Recent Activity card. Downloads are logged as `staff_photo.downloaded`. |
| B16 | Mount order | Photo gate → Today's first-sign-in profile prompt (birthday and start date) → role tour → announcements and tips. This is done by making `TOUR_staffHold` / `TOUR_staffBusy` return true while `#pg-gate` exists. Today's prompt is hidden while the gate shows. There is no blocking handbook gate in this app (signing is a Today nudge), so nothing needs ordering against it. |
| B17 | Upload failure | After a failed upload the gate offers **Continue for now**, which hides it for this page load only (in memory, not localStorage). If loading the status fails, the gate fails open and does not show at all. |

## Part C: findings (current code, 2026-10-16)

- `staff_profiles (email pk, display_name [retired, always null], title, phone, photo_path ≤ 300,
  birthday, start_date, updated_at)` is defined in `supabase/user-settings.sql`. The latest guard
  body is in `supabase/staff-name-canonical.sql` (lines 158–196). The guard raises without a JWT,
  checks that `photo_path` starts with `email || '/'`, and lets admins edit other people's rows
  (policy "admins can manage staff profiles", `staff-celebrations-performance.sql`). Backfills use
  `alter table … disable/enable trigger staff_profiles_guard` inside the same transaction.
- Bucket `staff-avatars` is private, 2 MB, png/jpeg/webp, with path `<email>/<file>`. Its current policies are:
  - "staff upload own avatar" (insert, own folder)
  - "staff update own avatar"
  - "staff delete own avatar"
  - "read staff avatars", as last redefined in `supabase/account-manager.sql`: active staff, or a
    client user whose client's `assigned_bookkeeper_email` / `account_manager_email` equals the
    folder name.
- `components/settings/Settings.jsx`:
  - `ST_AVATAR_BUCKET`, `ST_AVATAR_MAX_BYTES` (2 MB), `ST_AVATAR_TYPES`.
  - `ST_profile` store (≈ line 371): `signed(path)` returns a 3600 s URL, `save(patch)` upserts
    every column including `photo_path`, and there is no reload method.
  - `ST_useMyProfile`, `ST_initials`, and `ST_Avatar({name,url,size})` (≈ 470).
  - `ST_StaffProfileCard` (≈ 806–925) handles upload and remove photo.
  - The signature photo switch (≈ 1215).
  - Client cards: `AM_useTeamProfiles`, `AM_usePhoto(path)` (≈ 1907), `AM_ContactCard`, `AM_AccountManagerCard`, `ST_BookkeeperCard` (≈ 2026).
- `components/staff/TopBar.jsx` `TB_AvatarMenu` (≈ 1336) renders its own
  `<img className="staff-user-avatar tb-avatar-photo">`.
- `app.jsx`:
  - Initials-only avatars at ≈ 1826, 2000, 2405 and 25120. These show no photo today, so they stay as they are.
  - `StaffAccessPage` (Team › Members) at 13741, with profiles loaded at ≈ 14083 and the roster header at ≈ 14334.
  - Rendered with `readOnly={staffUser.role !== "admin"}` at ≈ 30008.
  - `impersonating` at 27318, `isPreviewingUser` at 28392, `showStaffRail` at 28970, `tkShell` at 28979.
  - Tour, Tips and Announcements mounts at ≈ 29667–29714, just before `<div id="client-panel">`.
  - `onSignOut` is an `App` prop. Settings opens with `setPage("settings")`.
- `components/staff/Today.jsx` holds the first-sign-in modal `#td-profile-title` (≈ 1090–1400, key
  `mgb-profile-prompt:<email>`) and the `TD_useHandbookItems` pattern for Today rows (rank 3 = reviews/handbook).
- `components/tour/Tour.jsx`: `TOUR_staffHold(email, tries)` (1447) and `TOUR_staffBusy()`. ANN_Root waits on both.
- `supabase/staff-onboarding.sql` seeds `staff_onboarding_steps` with sort 10–90. Its guard trigger
  stamps `done_by` from the JWT and requires the step key to exist.
- `supabase/functions/_shared/signature.ts`: `loadSignoffs` signs `photo_path` for five years with
  the service role. `signoffHtml` renders a 56 px `<img>` with `border-radius:28px`. Imported by
  `notification-emails` (verify_jwt OFF), `client-emails` (verify_jwt OFF) and `gl-review-send`
  (verify_jwt ON).
- `audit_write(action, client_id, target_type, target_id, details)` is revoked from
  `authenticated`, so only SECURITY DEFINER functions can call it. Labels are in
  `components/staff/AuditLog.jsx` `AL_ACTIONS`. `staff_audit_log (actor_email, action,
  target_email, detail)` has no insert policy.
- Name prefixes `SP_`, `SPI_`, `PG_`, `SPA_` and SQL prefix `sp_` are unused (checked by grep).

## Part D: data model, new file `supabase/staff-photo.sql` (chunk A)

The file is flat SQL, wrapped in `begin; … commit;`, and safe to re-run (`if not exists`,
`create or replace`, `drop policy if exists`). Before any `create or replace` of an existing
function, the builder runs `select pg_get_functiondef('public.staff_profiles_guard()'::regprocedure)`
on production and diffs it against the body quoted in Part C. If it differs, rebuild from the live text.

### D1. Tables

```sql
create table if not exists public.staff_photo_versions (
  id            uuid primary key default gen_random_uuid(),
  staff_email   text not null references public.staff(email) on update cascade,
  submission_id uuid not null,              -- groups one staff upload's original + crop
  kind          text not null check (kind in ('original','staff_crop','admin_edit')),
  storage_path  text not null unique check (char_length(storage_path) <= 300),
  uploaded_by   text not null,
  note          text check (note is null or char_length(note) <= 500),
  created_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  deleted_by    text,
  check (left(storage_path, char_length(staff_email) + 1) = staff_email || '/')
);
create index if not exists staff_photo_versions_email_idx
  on public.staff_photo_versions (staff_email, created_at desc);

create table if not exists public.staff_photo_exemptions (
  staff_email text primary key references public.staff(email) on update cascade on delete cascade,
  reason      text check (reason is null or char_length(reason) <= 300),
  set_by      text not null,
  set_at      timestamptz not null default now()
);
```

RLS (enable on both):
- `staff_photo_versions`: one select policy "own or admin reads photo versions", using
  `lower(staff_email) = lower(auth.jwt()->>'email') or public.is_active_staff_admin()`. No insert,
  update or delete policies; RPCs write it.
- `staff_photo_exemptions`: select only, for `public.is_active_staff_admin()`. No write policies.
- `revoke insert, update, delete on both from anon, authenticated;`

### D2. Guard change (`staff_profiles_guard`)

Copy the live body, then replace only the `photo_path` check with:

```sql
  -- photo_path changes only through the sp_* RPCs (supabase/staff-photo.sql),
  -- which set mgb.staff_photo_rpc locally. Anything else is ignored rather than
  -- rejected, so an old open Settings tab still saves title and phone.
  if coalesce(current_setting('mgb.staff_photo_rpc', true), '') <> 'on' then
    if tg_op = 'UPDATE' then new.photo_path := old.photo_path; else new.photo_path := null; end if;
  end if;
  if new.photo_path is not null and left(new.photo_path, char_length(new.email) + 1) <> new.email || '/' then
    raise exception 'photo must be in the staff member''s own folder' using errcode = '22023';
  end if;
```

PostgREST only exposes `public`, so browsers can't call `pg_catalog.set_config` themselves. Each
RPC sets the flag with `perform set_config('mgb.staff_photo_rpc','on', true);` right before its
one `staff_profiles` write, and sets it back to `'off'` right after.

### D3. Status helper (internal)

```sql
create or replace function public.sp_status_for(p_email text)
returns table(status text, current_path text, current_kind text, original_path text, exempt boolean)
language sql stable security definer set search_path = public as $$
  with p as (select photo_path from staff_profiles where email = lower(p_email)),
       cur as (select v.kind from staff_photo_versions v, p
               where v.storage_path = p.photo_path and v.deleted_at is null),
       orig as (select v.storage_path from staff_photo_versions v
                where v.staff_email = lower(p_email) and v.kind = 'original' and v.deleted_at is null
                order by v.created_at desc limit 1),
       ex as (select exists (select 1 from staff_photo_exemptions e where e.staff_email = lower(p_email)) as x)
  select case
           when (select photo_path from p) is null then case when ex.x then 'exempt' else 'missing' end
           when (select kind from cur) = 'admin_edit' then 'edited'
           else 'submitted'
         end,
         (select photo_path from p), (select kind from cur), (select storage_path from orig), ex.x
  from ex;
$$;
revoke all on function public.sp_status_for(text) from public, anon, authenticated;
```

The JS mirror is `SP_deriveStatus` (Part F). Both must agree; the unit tests pin the JS one.

### D4. Internal audit helper

```sql
create or replace function public.sp_audit(p_action text, p_email text, p_details jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.audit_write(p_action, null, 'staff', lower(p_email), coalesce(p_details, '{}'::jsonb));
  insert into staff_audit_log (actor_email, action, target_email, detail)
  values (coalesce(lower(auth.jwt()->>'email'), 'system'), p_action, lower(p_email), p_details::text);
end $$;
revoke all on function public.sp_audit(text, text, jsonb) from public, anon, authenticated;
```

Action codes: `staff_photo.submitted`, `staff_photo.replaced`, `staff_photo.restored`,
`staff_photo.exempt_on`, `staff_photo.exempt_off`, `staff_photo.version_hidden`, `staff_photo.downloaded`.

### D5. RPCs

All of these are `security definer`, `set search_path = public`, `revoke all … from public, anon`,
`grant execute … to authenticated`. Every one starts with
`v_me text := lower(auth.jwt()->>'email'); if v_me is null then raise exception 'not signed in' using errcode='42501'; end if;`.
Storage existence is checked with
`exists (select 1 from storage.objects o where o.bucket_id = 'staff-avatars' and o.name = <path>)`.

| Function | Who | Does |
|---|---|---|
| `sp_my_photo_status() returns jsonb` | any active staff (else `{"status":"none","required":false}`) | Returns `{status, required, current_path, current_kind, original_path, exempt, is_new_hire}`. `required = active and status = 'missing'`. `is_new_hire = staff.created_at > now() - interval '30 days'`. |
| `sp_submit_my_photo(p_original_path text, p_current_path text) returns jsonb` | the active staffer, for themself | Validates both paths: the folder is `v_me`; the original filename matches `^original-[0-9]{10,16}\.jpg$` and the current filename matches `^current-[0-9]{10,16}\.jpg$`; both objects exist; neither is already in `staff_photo_versions`. Inserts two version rows with one new `submission_id` (`original`, `staff_crop`), with `uploaded_by = v_me`. Upserts `staff_profiles (email, photo_path = p_current_path)` with the flag on. Upserts `staff_onboarding_progress (staff_email = v_me, step_key = 'profile-photo', done_at = now())` with `on conflict (staff_email, step_key) do update set done_at = coalesce(staff_onboarding_progress.done_at, now())`. Audits `staff_photo.submitted` with `{resubmit: <previous status = 'edited'>}`. Returns `sp_my_photo_status()`. |
| `sp_admin_photo_list() returns table(email text, name text, role text, active boolean, status text, current_path text, current_kind text, original_path text, submitted_at timestamptz, edited_at timestamptz, edited_by text, exempt_reason text, is_new_hire boolean)` | `is_active_staff_admin()` else raise 42501 | One row per `staff` row (active first, then name), joined to `sp_status_for`. `submitted_at` is the newest `staff_crop` or `original` `created_at`; `edited_at`/`edited_by` come from the newest `admin_edit`. |
| `sp_admin_photo_history(p_staff_email text) returns table(id uuid, submission_id uuid, kind text, storage_path text, uploaded_by text, note text, created_at timestamptz, is_current boolean)` | admin | Non-deleted versions, newest first. |
| `sp_admin_replace_staff_photo(p_staff_email text, p_path text, p_note text default null) returns jsonb` | admin | The staffer must exist. The path folder must be `lower(p_staff_email)` and the filename must match `^edited-[0-9]{10,16}\.png$`. The object must exist and the path must not already be a version. Inserts an `admin_edit` row whose `submission_id` is copied from the newest `original`, or a new uuid if there is none. Sets `photo_path` with the flag on. Audits `staff_photo.replaced` with `{path, note}`. Returns `{status:'edited'}`. |
| `sp_admin_restore_staff_photo(p_staff_email text) returns jsonb` | admin | Target = the newest non-deleted `staff_crop`. If there is none, the newest `original`. If neither exists, raise `'no original to restore'`. Sets `photo_path` with the flag on. Audits `staff_photo.restored` with `{path}`. Returns `{status:'submitted'}`. |
| `sp_admin_set_photo_exempt(p_staff_email text, p_exempt boolean, p_reason text default null) returns void` | admin | Upsert or delete the `staff_photo_exemptions` row, then audit `exempt_on` or `exempt_off`. |
| `sp_admin_hide_photo_version(p_version_id uuid) returns void` | admin | Soft delete (`deleted_at`, `deleted_by`). Refuses the version that is current (`'restore or replace first'`) and the only non-deleted `original`. The storage object stays. Audits `staff_photo.version_hidden`. |
| `sp_admin_log_photo_download(p_staff_emails text[], p_what text) returns void` | admin | `p_what in ('original','current','zip')` else raise 22023. Writes one `audit_write` row with `target_id = 'bulk'` when there is more than one email, or the email when there is one, plus `{emails, what}`. Writes one `staff_audit_log` row per email (cap of 200). |

### D6. Storage

```sql
update storage.buckets set file_size_limit = 5242880,
  allowed_mime_types = array['image/png','image/jpeg','image/webp']
where id = 'staff-avatars';

drop policy if exists "staff update own avatar" on storage.objects;
drop policy if exists "staff delete own avatar" on storage.objects;

drop policy if exists "staff upload own avatar" on storage.objects;
create policy "staff upload own avatar" on storage.objects for insert to authenticated
with check (
  bucket_id = 'staff-avatars' and public.is_active_staff()
  and (storage.foldername(name))[1] = lower(auth.jwt()->>'email')
  and storage.filename(name) ~ '^(original|current)-[0-9]{10,16}\.jpg$'
);

drop policy if exists "admins upload edited staff photo" on storage.objects;
create policy "admins upload edited staff photo" on storage.objects for insert to authenticated
with check (
  bucket_id = 'staff-avatars' and public.is_active_staff_admin()
  and exists (select 1 from public.staff s where s.email = (storage.foldername(name))[1])
  and storage.filename(name) ~ '^edited-[0-9]{10,16}\.png$'
);

-- Read: narrowed, never widened (decision B10).
create or replace function public.sp_can_read_avatar(p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select
    -- own folder (originals, history)
    (storage.foldername(p_name))[1] = lower(auth.jwt()->>'email') and public.is_active_staff()
    -- real admins: everything
    or public.is_active_staff_admin()
    -- active staff: anyone's CURRENT photo
    or (public.is_active_staff() and exists (select 1 from staff_profiles p where p.photo_path = p_name))
    -- client users: the current photo of their client's bookkeeper or account manager (unchanged audience)
    or exists (
      select 1 from client_users cu
      join clients c on c.id = cu.client_id
      join staff_profiles p on p.photo_path = p_name
        and p.email in (lower(c.assigned_bookkeeper_email), lower(c.account_manager_email))
      where lower(cu.email) = lower(auth.jwt()->>'email') and cu.active);
$$;
revoke all on function public.sp_can_read_avatar(text) from public, anon;
grant execute on function public.sp_can_read_avatar(text) to authenticated;

drop policy if exists "read staff avatars" on storage.objects;
create policy "read staff avatars" on storage.objects for select to authenticated
using (bucket_id = 'staff-avatars' and public.sp_can_read_avatar(name));
```

Before writing the client branch, the builder runs `select pg_get_functiondef` / `pg_policies` for
"read staff avatars" on production and confirms the current client condition matches the one in
`account-manager.sql`. If production differs, keep production's audience. Signed URLs already issued
(the 3600 s app URLs and the five-year email URLs) keep working, because signed URLs don't go
through RLS.

### D7. Onboarding step and backfill

```sql
insert into public.staff_onboarding_steps (key, title, description, guide_slug, sort) values
  ('profile-photo', 'Add your profile photo',
   'A clear, recent photo of your face and shoulders. An admin tidies the background so every photo matches.',
   'profile-photo', 5)
on conflict (key) do nothing;

-- Existing photos become the staffer's submitted original (status "Needs edit").
insert into public.staff_photo_versions (staff_email, submission_id, kind, storage_path, uploaded_by, note)
select p.email, gen_random_uuid(), 'original', p.photo_path, p.email, 'Backfilled from the photo set before 2026-10-16'
from public.staff_profiles p
where p.photo_path is not null
on conflict (storage_path) do nothing;

-- Tick the onboarding step for them (no JWT here, so set done_by explicitly).
alter table public.staff_onboarding_progress disable trigger staff_onboarding_progress_guard_trg;
insert into public.staff_onboarding_progress (staff_email, step_key, done_at, done_by)
select p.email, 'profile-photo', now(), 'system' from public.staff_profiles p
where p.photo_path is not null
on conflict (staff_email, step_key) do nothing;
alter table public.staff_onboarding_progress enable trigger staff_onboarding_progress_guard_trg;
```

The builder checks the progress table's real primary key and trigger name on production before
running this. The staff_profiles guard is not touched by the backfill.

### D8. SQL smoke checks (run after applying, through MCP `execute_sql` as the `authenticated` role with a test JWT, or by reading results only)

- `select status, count(*) from public.sp_admin_photo_list() group by 1;` (as an admin JWT) shows no errors.
- As a bookkeeper JWT: `select public.sp_admin_photo_list();` raises 42501.
- `update staff_profiles set photo_path = '<me>/x.jpg' where email = '<me>'` as that staffer leaves `photo_path` unchanged.
- `select count(*) from staff_photo_versions` equals the count of non-null `photo_path` values before the migration.

## Part E: client API and image helpers (chunk A)

### E1. `components/staff/staffPhotoApi.js` (new, `SP_` prefix, browser only)

```js
const SP_BUCKET = "staff-avatars";
const SP_CHANGED_EVENT = "sp:changed";
const SP_api = {
  myStatus(),                               // rpc sp_my_photo_status -> object
  submit(originalPath, currentPath),        // rpc sp_submit_my_photo -> status object; fires SP_changed()
  adminList(),                              // rpc sp_admin_photo_list -> rows[]
  history(email),                           // rpc sp_admin_photo_history -> rows[]
  replace(email, path, note),               // rpc sp_admin_replace_staff_photo; fires SP_changed()
  restore(email),                           // rpc sp_admin_restore_staff_photo; fires SP_changed()
  setExempt(email, exempt, reason),         // rpc sp_admin_set_photo_exempt; fires SP_changed()
  hideVersion(id),                          // rpc sp_admin_hide_photo_version; fires SP_changed()
  logDownload(emails, what),                // rpc sp_admin_log_photo_download (never throws)
  upload(path, blob, contentType),          // storage upload, upsert:false, cacheControl "31536000"
  signedUrl(path, seconds = 3600),          // storage createSignedUrl -> string|null
  download(path),                           // storage download -> Blob
};
function SP_errText(err)                    // same shape as HB_errText
function SP_changed()                       // dispatch window event SP_CHANGED_EVENT
function SP_useMyStatus(email)              // shared store: {loaded, error, data}; reloads on SP_CHANGED_EVENT;
                                            // returns {loaded:false} for a null email
function SP_useAdminList(enabled)           // shared store for Today + Members: {loaded, error, rows}; reloads on event
```

Every call goes through `window.mgbSupabase`. If it is missing, throw `new Error("Sign in again.")`.
The stores dedupe in-flight requests, as `HB_useStatus` does.

### E2. `components/staff/staffPhotoImage.js` (new, `SPI_` prefix, browser only)

```js
async function SPI_loadImage(file)
//   -> {source, width, height}  (source is an ImageBitmap or HTMLImageElement; EXIF orientation applied)
//   Uses createImageBitmap(file, {imageOrientation:"from-image"}), falling back to an <img> with an object URL.
//   Throws Error with .code = "heic" when the file looks like HEIC/HEIF (type or .heic/.heif name) and
//   can't be decoded, and .code = "decode" for any other failure.
async function SPI_encodeOriginal(src)
//   -> Blob image/jpeg; longest side <= 2048; quality 0.9, stepping to 0.8 then 0.7 while > 4.5 MB.
async function SPI_encodeCrop(src, rect, size = 512)
//   -> Blob image/jpeg 512x512 q0.9. rect = {sx, sy, sSize} from SP_cropRect. Fills white first.
async function SPI_normalizeEdited(file)
//   -> {blob, width, height, hasAlpha}. Center-crops to a square, draws to 512x512 on a transparent canvas,
//      exports image/png. hasAlpha = any pixel alpha < 250 (sampled every 4th pixel).
//      Throws .code = "small" when the source is under 400 px on its short side.
function SPI_downloadBlob(blob, filename)   // object URL + <a download>, revoked after 1 s
```

Canvas re-encoding drops all metadata, including EXIF and GPS. Nothing reads or uploads the original
file bytes.

## Part F: pure logic `components/staff/staffPhotoLogic.js` + `.test.js` (chunk A)

The file uses `var` declarations only, no DOM, and ends with the `module.exports` guard, the same as
`teamReviewsLogic.js`. The test uses plain `assert` and prints `staffPhotoLogic: N checks passed`.
Run it with `node components/staff/staffPhotoLogic.test.js`.

```js
var SP_STATUS = { MISSING: "missing", EXEMPT: "exempt", SUBMITTED: "submitted", EDITED: "edited" };
var SP_LIMITS = { maxInputBytes: 15 * 1024 * 1024, minSide: 400, currentSize: 512, originalMaxSide: 2048 };
var SP_INPUT_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

function SP_deriveStatus({ photoPath, currentKind, exempt })   // mirrors sp_status_for
function SP_mustUpload({ loaded, error, status, active, impersonating, previewing, dismissedThisLoad })
//   true only if loaded && !error && active !== false && status === "missing" && !impersonating
//   && !previewing && !dismissedThisLoad.  Fails open on error or while not loaded.
function SP_statusLabel(status)   // {label, tone}: missing "Missing"/"warn", exempt "Not required"/"muted",
                                  // submitted "Needs edit"/"attention", edited "Done"/"ok", other "—"/"muted"
function SP_validateFile({ type, size, name })
//   -> {ok:true} | {ok:false, error}. Type is from SP_INPUT_TYPES, or the extension is
//      .jpg/.jpeg/.png/.webp/.heic/.heif when type is "". Size > 0 and <= maxInputBytes.
//   Error copy: "Choose a JPG, PNG or WebP photo." / "That photo is over 15 MB. Choose a smaller one."
function SP_isHeic({ type, name })
function SP_cropRect({ imgW, imgH, zoom, cx, cy })
//   zoom >= 1 (1 = largest square that fits); cx, cy = center in 0..1 of the image.
//   -> {sx, sy, sSize} integers, clamped inside the image.
function SP_maxZoom(imgW, imgH)   // largest zoom where sSize >= SP_LIMITS.minSide (>= 1; 1 if the image is too small)
function SP_tooSmall(imgW, imgH)  // Math.min(imgW, imgH) < SP_LIMITS.minSide
function SP_fitWithin(w, h, max)  // -> {w, h}, aspect kept, never upscaled
function SP_paths(email, kind, nowMs)
//   kind "original" -> `${email}/original-${nowMs}.jpg`, "current" -> `${email}/current-${nowMs}.jpg`,
//   "edited" -> `${email}/edited-${nowMs}.png`. Email is lower-cased.
function SP_canAdmin({ role, impersonating })   // role === "admin" && !impersonating
function SP_needsEditCount(rows)                // rows with active && status === "submitted"
function SP_todayItem(rows)                     // null or {key:"sp-needs-edit", count, title, detail}
//   title: "1 profile photo to edit" / "N profile photos to edit"; detail lists up to 3 names, then "and N more".
function SP_zipName(name, email, which, ext)    // "jane-doe-original.jpg"; slug of name, else the local part of the email
function SP_crc32(bytes)                        // Uint8Array -> unsigned int
function SP_buildZip(entries, date)
//   entries [{name, bytes:Uint8Array}] -> Uint8Array; stored (method 0), with local headers,
//   a central directory and an end record. DOS time from `date`. Names are de-duplicated by
//   appending -2, -3 ….
```

Required tests (at least 40 checks):
- `SP_deriveStatus`: all four states, exempt plus a photo gives submitted or edited, and an unknown kind gives submitted.
- `SP_mustUpload`: error fails open, not loaded is false, impersonating, previewing, inactive and dismissed are all false, and missing is true.
- `SP_validateFile`: empty type with a `.HEIC` name, an 0-byte file, 15 MB + 1, and `image/gif` rejected.
- `SP_cropRect`: clamping at the edges, zoom 1 on portrait and landscape, and integer outputs.
- `SP_maxZoom`: an exactly 400 px image gives 1, and 1600×1200 gives 3.
- `SP_paths`: lower-casing and the regexes from D5/D6.
- `SP_todayItem`: 0, 1 and 5 rows.
- `SP_crc32("123456789") === 0xCBF43926`.
- `SP_buildZip`: the signature bytes `50 4B 03 04` / `50 4B 05 06`, the entry count in the end record, and the duplicate name renamed.

## Part G: the gate, Settings, Avatar, signature (chunk B)

### G1. `components/staff/StaffPhotoGate.jsx` (new, `PG_` prefix) + `components/staff/staff-photo.css`

`PG_Gate({ staffUser, impersonating, isPreviewingUser, page, onOpenSettings, onSignOut })`:
- Reads `SP_useMyStatus(staffUser.email)`. Show it when `SP_mustUpload({...})` is true and `page !== "settings"`.
- Renders a fixed full-page overlay with `id="pg-gate"`, `role="dialog"`, `aria-modal="true"`,
  `aria-labelledby="pg-gate-title"`, and `z-index` above the top bar and tours (use
  `var(--z-modal, 1000) + 10`; check `tour.css` and `top-bar.css` for the highest value in use).
  Focus starts on the title. Esc does nothing.
- Header row: the MyGoodBooks wordmark, then **Settings** (calls `onOpenSettings`) and **Sign out**
  (calls `onSignOut`) on the right. Both always work.
- Copy:
  - `is_new_hire` true. Title "Add your profile photo". Body: "Welcome to MyGoodBooks! Clients and
    teammates see this photo next to your name, and in your email signature if you turn that on.
    It takes about a minute."
  - `is_new_hire` false. Title "Add your profile photo". Body: "We now ask everyone for a profile
    photo so the team looks the same everywhere clients see us. It takes about a minute, and you
    only do it once."
  - Guidance list, the same for both: "A clear, recent photo of your face and shoulders" · "Look at
    the camera, in good light" · "Any background is fine: an admin removes it so every photo
    matches" · "No sunglasses, hats, filters or group photos".
- Body: `<PG_PhotoPicker email onDone />`. On success, a check mark with "Thanks! Your photo is
  saved." Then `SP_changed()` + `ST_profile.reload()` run, and the gate unmounts because the status
  is now submitted.
- On an upload or RPC error: show `SP_errText` in a `role="alert"` box, plus **Try again** and
  **Continue for now**. Continue for now sets a module variable `PG_dismissedThisLoad = true`, which
  feeds `dismissedThisLoad`.
- Phone width (≤ 600 px): single column, 16 px gutters, buttons full width, crop box `min(80vw, 320px)`.

`PG_PhotoPicker({ email, onDone, compact })` is shared by the gate and Settings:
1. Step "choose". Buttons:
   - **Upload a photo**: a hidden `<input type="file" accept="image/*">`.
   - **Take a photo**: on a coarse pointer, a hidden input with `accept="image/*" capture="user"`.
     On a fine pointer with `navigator.mediaDevices?.getUserMedia`, it opens `PG_Webcam` instead:
     a 4:3 `<video>` with **Capture** and **Cancel**, which stops every track on close or unmount.
   - The picker also accepts drag and drop onto the drop zone.
2. Checks `SP_validateFile`, then runs `SPI_loadImage`. On `.code === "heic"` it says: "This photo
   is in HEIC format, which this browser can't open. On a Mac, open it in Preview and choose File ›
   Export › JPEG. On an iPhone, set Settings › Camera › Formats to Most Compatible, or take a
   screenshot of the photo, then try again." If `SP_tooSmall`, it says: "This photo is too small.
   Choose one at least 400 × 400 pixels."
3. Step "crop": a square viewport with a round mask overlay (CSS `border-radius:50%` ring over a
   dimmed square). Drag or touch pans `cx`/`cy`, the wheel and a range input (`1..SP_maxZoom`)
   zoom, and arrow keys pan by 2%. The preview is drawn with a canvas from `SP_cropRect`. A small
   48 px circle preview sits next to it. Buttons: **Use this photo** and **Choose another**.
4. Save:
   1. `now = Date.now()`.
   2. `SPI_encodeOriginal`, then `SP_api.upload(SP_paths(email,"original",now), blob, "image/jpeg")`.
   3. `SPI_encodeCrop`, then upload `SP_paths(email,"current",now)`.
   4. `SP_api.submit(origPath, curPath)`.
   5. Show progress text: "Saving…".

   Once uploaded, objects are never deleted. If submit fails, the orphaned objects are harmless.

### G2. `components/settings/Settings.jsx`

- `ST_profile`: add `reload()`, which re-runs `load(email)`. Remove `photo_path` from the `save`
  payload so it is never sent. Subscribe once to `SP_CHANGED_EVENT` and reload when it fires.
- `ST_StaffProfileCard`: replace the upload and remove code with:
  - the current `ST_Avatar` (size 72)
  - status text from `SP_useMyStatus`: "Required: add a photo" (missing), "Saved. An admin will tidy
    the background." (submitted), "Edited by an admin" (edited)
  - a **Change photo** / **Add photo** button that opens `PG_PhotoPicker` in a `ModalShell`

  Remove **Remove photo**. Delete `ST_AVATAR_MAX_BYTES`/`ST_AVATAR_TYPES` if nothing else uses them
  (grep first).
- `ST_Avatar({ name, url, size, tone })`: this is the one avatar component.
  - Markup: `<span className="st-avatar-wrap" style={{width:size,height:size}}>`, holding either an
    `<img className="st-avatar" alt="" loading="lazy" decoding="async">` or the initials span.
    `onError` falls back to initials.
  - The wrap gets `background: var(--avatar-bg)` and `border-radius:50%; overflow:hidden`, so a
    transparent PNG sits on the same circle everywhere.
  - Keep the existing `.st-avatar` / `.st-avatar-initials` class names. Callers that pass `size`
    keep working.
- `settings.css`: add `.st-avatar-wrap{display:inline-flex;flex:none;border-radius:50%;overflow:hidden;background:var(--avatar-bg)}`.
  Set `.st-avatar{width:100%;height:100%;object-fit:cover}`. Add `--avatar-bg` tokens: light `#233746`
  (brand logo navy), and dark `#233746` under both `@media (prefers-color-scheme: dark)` and
  `[data-theme="dark"]`. Use the same navy in both themes so edited photos look identical everywhere
  (including email).

### G3. `components/staff/TopBar.jsx`

In `TB_AvatarMenu`, replace the inline `<img className="staff-user-avatar tb-avatar-photo">` with
`<ST_Avatar name={…} url={profile.photoUrl} size={32} />` inside the existing button. Keep
`.staff-user-avatar` on the button for its existing styles, and keep the initials path when
`ST_Avatar` is undefined. Delete `.tb-avatar-photo` from `settings.css` only if nothing else uses it.

### G4. `components/tour/Tour.jsx`

```js
// in TOUR_staffHold, first line:
if (document.getElementById("pg-gate")) return true;
// in TOUR_staffBusy, add:  || !!document.getElementById("pg-gate")
```

### G5. `components/staff/Today.jsx` (chunk C owns this file; listed here for the order rule)

Today's first-sign-in prompt must not open while `#pg-gate` exists. See H4.

### G6. `supabase/functions/_shared/signature.ts`

- `signoffHtml`: put the photo inside a fixed brand-color circle so transparent PNGs look uniform:

```ts
`<td valign="top" style="padding:2px 14px 0 0;">` +
`<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;"><tr>` +
`<td width="${PHOTO_PX}" height="${PHOTO_PX}" bgcolor="${L.colors?.logoNavy ?? "#233746"}" ` +
`style="width:${PHOTO_PX}px;height:${PHOTO_PX}px;background-color:#233746;border-radius:${PHOTO_PX / 2}px;overflow:hidden;line-height:0;font-size:0;">` +
`<img src="${esc(s.photoUrl)}" width="${PHOTO_PX}" height="${PHOTO_PX}" alt="" ` +
`style="display:block;width:${PHOTO_PX}px;height:${PHOTO_PX}px;border-radius:${PHOTO_PX / 2}px;border:0;object-fit:cover;"></td>` +
`</tr></table></td>`
```

  Use the brand constant exported by `_shared/layout.ts` if it exists; otherwise use the literal
  `#233746`. Outlook desktop ignores `border-radius` and shows a navy square tile. That is accepted.
- `loadSignoffs`: unchanged logic. It still signs the *current* `photo_path` for five years. Add a
  comment: "Old emails keep their own URL: objects in staff-avatars are never deleted
  (staff-photo.sql), so a replace or restore only changes what new emails show."
- Redeploy (Part K).

## Part H: admin UI in Team › Members (chunk C)

### H1. `components/staff/StaffPhotoAdmin.jsx` (new, `SPA_` prefix)

- `SPA_PhotoCell({ row, profileName, canAct, onOpen })` is the table cell. It shows a 32 px
  `ST_Avatar` (signed URL from `SP_api.signedUrl(row.current_path)`, cached per path for 50 min)
  plus a status chip from `SP_statusLabel`. Clicking it calls `onOpen(row.email)`. It has
  `data-tour="members-photo"` on the first row only.
- `SPA_PhotoDrawer({ email, onClose, canAct })` is a `ModalShell` titled "Profile photo — <name>".
  It contains:
  - Large preview: 160 px current on the left and 160 px original on the right (both signed). The
    current photo sits on the `--avatar-bg` circle.
  - **Download original** and **Download current**. Each runs
    `SP_api.download → SPI_downloadBlob(blob, SP_zipName(name,email,"original"|"current",ext))`
    then `SP_api.logDownload([email], what)`.
  - **Replace with edited photo**: a file input, `accept="image/png,image/webp,image/jpeg"`. Then:
    1. `SPI_normalizeEdited`.
    2. If `!hasAlpha`, show the warning "This photo has no transparent background. Upload it
       anyway?" with **Upload anyway** and **Cancel**.
    3. Upload to `SP_paths(email,"edited",Date.now())` as `image/png`, with an optional note field.
    4. Call `SP_api.replace`.
  - **Restore original**: confirm "Show <name>'s own photo again? Your edit stays in the history."
    Then `SP_api.restore`.
  - **Not required** switch, shown only when status is `missing` or `exempt`, with an optional
    reason. Calls `SP_api.setExempt`.
  - **History**: `SP_api.history(email)` as a list of rows: 40 px thumb · kind label ("Original",
    "Their crop", "Admin edit") · who · date · "Current" tag · **Download** · **Hide** (not on the
    current version or the only original; confirm first; `SP_api.hideVersion`).
  - Every action button is disabled with a `title` when `!canAct`. Temp admins and View as get a
    read-only drawer with no Download buttons, because downloads of originals are admin-only by RLS.
- `SPA_BulkBar({ rows, canAct })` sits above the Admins card: "Profile photos: N need an edit · M
  missing". It has a **Download all (zip)** button with a select for "Current" / "Originals" /
  "Needs edit only (originals)". It downloads sequentially with progress text "3 of 12…", builds
  the zip with `SP_buildZip`, saves `mgb-staff-photos-YYYY-MM-DD.zip`, and runs one
  `SP_api.logDownload(emails, "zip")`. Missing files are skipped and listed after the download.

### H2. `app.jsx` `StaffAccessPage` (≈ 13741)

- Load `SP_useAdminList(canSeePhotos)`, where `canSeePhotos = typeof SP_useAdminList === "function"`.
  This is safe for readOnly temp admins: the RPC raises for them, the hook returns `{error}`, and the
  column shows "—".
- Header: insert `<th>Photo</th>` after `<th>Name</th>`. Row: insert
  `<td data-label="Photo"><SPA_PhotoCell …/></td>` after the name cell, so the column comes second.
  Mobile `data-label` follows the table's existing pattern.
- `canAct = staffUser.role === "admin" && !readOnly`. The page already receives the real staffer;
  View as never reaches Members as an admin.
- Render `SPA_BulkBar` above the roster cards when `canAct`. Render `SPA_PhotoDrawer` when
  `photoEmail` state is set.
- Supports a `?photo=needs-edit` hash flag (the Today item link): scroll to the first `submitted`
  row and open its drawer.

### H3. Gate mount in `app.jsx` (≈ 29667, before `TOUR_StaffRoot`)

```jsx
{/* Required profile photo (components/staff/StaffPhotoGate.jsx). First in
    line: tours, tips, announcements and Today's profile prompt wait for it. */}
{typeof PG_Gate === "function" && staffUser && !clientPortalUser && !isPreviewingUser && !impersonating && (
  <PG_Gate
    staffUser={staffUser}
    impersonating={Boolean(impersonating)}
    isPreviewingUser={Boolean(isPreviewingUser)}
    page={effectivePage}
    onOpenSettings={() => setPage("settings")}
    onSignOut={onSignOut}
  />
)}
```

It is not limited to `showStaffRail`, so the standalone Tasks window (`tkShell`) is gated too. The
builder confirms `clientPortalUser` and `onSignOut` are in scope at that line, or uses the names
that are.

### H4. `components/staff/Today.jsx` (chunk C)

- Profile prompt: in the effect that sets `profilePrompt`, return early when
  `document.getElementById("pg-gate")`. Also re-check on `SP_CHANGED_EVENT`, so the prompt shows
  right after the gate closes.
- Admin item: when `admin && typeof SP_useAdminList === "function"`:
  - `const sp = SP_useAdminList(true); const it = sp.rows && SP_todayItem(sp.rows);`
  - Push `{ key: it.key, kind: "photos", rank: 3, sort: 0, title: it.title, detail: it.detail,
    onClick: () => { location.hash = "#/team/members?photo=needs-edit"; } }` into the same band
    as the handbook rows. If the Members route doesn't parse a query, use `NAV_go("team","members")`
    plus `sessionStorage.setItem("mgb-photo-open","needs-edit")`, which H2 reads.
  - Skip it when `TR_isSomeoneElse(staffUser, …)` is true (View as), following the handbook rule.

## Part I: launch announcement and tour (chunk C)

Append to `ANN_REGISTRY` in `components/tour/announcements.js`:

```js
{
  id: "staff-profile-photos",
  date: "<ship date YYYY-MM-DD>",
  title: "Profile photos",
  summary: "Everyone now adds a profile photo, and admins tidy the background so every photo matches.",
  roles: ["admin", "bookkeeper"],
  hash: "#/settings",
  steps: (ctx) => [
    { id: "ann-welcome", title: "Profile photos for the whole team",
      body: () => ctx && ctx.isAdmin
        ? "Everyone now adds a profile photo. You can download each one, remove the background, and put the edited photo back so the team matches. About a minute."
        : "Everyone now adds a profile photo, so clients see the same tidy look from all of us. An admin removes the background for you. About a minute." },
    { id: "ann-settings", go: () => { location.hash = "#/settings"; }, targets: ["#st-profile-photo"], wait: true,
      title: "Your photo lives in Settings",
      body: () => "Change photo opens the same picker any time. Your original is kept, and an admin will tidy the background." },
    TOUR_tabStep("team", "members", "Team › Members",
      "The Photo column shows who still needs an edit. Click a photo to download it, replace it with your edited version or restore the original."),
    { id: "ann-photo-cell", when: (c) => !!c.isAdmin, targets: ["members-photo"], wait: true,
      title: "Download, edit, replace",
      body: () => "Download the original, remove the background in your editor, save it as a PNG with a transparent background, then choose Replace with edited photo." },
  ],
}
```

- Use the exact `ctx` field name for admin that `Announcements.jsx` passes (check `ANN_ctx` /
  `ctx.isAdmin` in existing entries before relying on it).
- `TOUR_tabStep("team","members",…)` only applies to roles that can open Members. Add
  `when: (c) => !!c.isAdmin` to that step if the helper doesn't already filter it.
- Chunk B adds `id="st-profile-photo"` to the photo block in `ST_StaffProfileCard`.
- New hires never see this notice, because their account is newer than `date`. They get the gate
  copy (G1), onboarding step `profile-photo`, and the guide article instead. Existing staff get the
  "We now ask everyone" gate copy plus this notice.
- Run `node components/tour/announcementsLogic.test.js`.

Tips: add no new tip. Re-point any tip that targets the old **Remove photo** button. Grep
`components/tour/tips.js` for `photo`.

## Part J: upkeep checklist (chunk C, same commit)

1. **Guide articles** (`docs/staff-guide/`):
   - **New** `profile-photo.md` (audience staff, section "Getting started", keywords `[photo,
     avatar, picture, headshot, profile, background, HEIC]`). Cover: why it's required, the steps,
     HEIC tips, what an admin does to it, and how to change it.
   - **New** `staff-photos.md` (audience admin, section "Team"). Cover: the Photo column, statuses,
     Download, the editing advice (remove the background, export as a square PNG with transparency
     at 512 px or larger), Replace, Restore, History and Hide, Not required, Download all, and what
     gets logged.
   - **Update** `staff-settings.md` (the photo section: Change photo, no Remove), `new-hire-onboarding.md`
     (first-day step: the photo prompt comes first), `admin-guide.md` (photo editing in the admin
     checklist), `staff-management.md` (the new column), `onboarding.md` (new step 'profile-photo')
     and `audit-log.md` (the new action labels).
   - **Update** `whats-new.md` with one entry dated the ship date, using the summary from Part I.
   - Run `node docs/staff-guide/sync.mjs --check`, then
     `node docs/staff-guide/sync.mjs > /tmp/staff-guide-sync.sql`. **Strip the
     `delete from public.staff_guide where slug not in …` statement** and apply only the changed or
     new articles' upserts (through MCP `execute_sql`).
2. **Help menus:** add `profile-photo` to `TB_HELP_FOR_PAGE` for `settings` if it isn't already
   mapped. Leave the Members tab's `help: "staff-management"` as is (it links on to `staff-photos`).
3. **Tours:** step targets added: `#st-profile-photo` (B) and `data-tour="members-photo"` (C). Check
   with grep that both exist.
4. **README.md:** add a "Staff profile photos" section with the bucket rules, statuses, RPC list,
   the guard rule (`mgb.staff_photo_rpc`), never-delete storage, and the gate order. Add the new
   files to the repo map.
5. **Dev Tools:** bump `window.MGB_VERSION` in `index.html` (the next label after the current
   `2026-10-16d`, with a one-line note at the front). Add a `PAGE_META` entry only if a new page key
   was added (none is planned). Add `staff-photo.sql` to the Dev Tools infra notes list near
   app.jsx ≈ 1010. No new localStorage key (the gate dismissal is in memory).
6. **`index.html`:**
   - Add the stylesheet `components/staff/staff-photo.css` after `settings.css`.
   - Add the scripts in this order: `components/staff/staffPhotoLogic.js`,
     `components/staff/staffPhotoApi.js` and `components/staff/staffPhotoImage.js` immediately
     before `components/staff/StaffOnboarding.jsx`.
   - Add `components/staff/StaffPhotoGate.jsx` and `components/staff/StaffPhotoAdmin.jsx`
     immediately after `components/settings/Settings.jsx`. They use `ST_Avatar` at render time
     only, but keep them after it.
7. **AuditLog.jsx `AL_ACTIONS`:** `"staff_photo.submitted": "Profile photo submitted"`,
   `"staff_photo.replaced": "Profile photo replaced (edited)"`, `"staff_photo.restored": "Profile
   photo restored"`, `"staff_photo.exempt_on": "Photo marked not required"`,
   `"staff_photo.exempt_off": "Photo required again"`, `"staff_photo.version_hidden": "Photo version
   hidden"`, `"staff_photo.downloaded": "Profile photo downloaded"`.
8. **Admin checklist text:** the new-hire checklist in `new-hire-onboarding.md` and the onboarding
   step seeded in D7. Admins see the step on Team › Onboarding automatically.

## Part K: edge functions to redeploy (after chunk B merges)

```
npx --yes supabase@latest functions deploy notification-emails --project-ref xumsqmhccgfjnlmieqyu --no-verify-jwt
npx --yes supabase@latest functions deploy client-emails      --project-ref xumsqmhccgfjnlmieqyu --no-verify-jwt
npx --yes supabase@latest functions deploy gl-review-send     --project-ref xumsqmhccgfjnlmieqyu
```

Before deploying, confirm each function's current `verify_jwt` with MCP `get_edge_function` and keep
it as it is. If `grep -rl "_shared/signature.ts" supabase/functions` lists any other function,
redeploy that one too, with its own flag.

## Part L: build chunks and contracts

All three chunks can start in parallel against the contracts above. Merge in the order A → B → C.
No file is edited by two chunks.

| Chunk | Model | Files (exclusive) | Done when |
|---|---|---|---|
| **A: data + logic** | Sonnet, effort high | `supabase/staff-photo.sql`, `components/staff/staffPhotoLogic.js`, `components/staff/staffPhotoLogic.test.js`, `components/staff/staffPhotoApi.js`, `components/staff/staffPhotoImage.js` | The test prints `staffPhotoLogic: N checks passed` (N ≥ 40). The SQL is applied to production (auto-apply is pre-approved) and passes the D8 smoke checks. Exported names and RPC signatures match Parts D–F exactly. |
| **B: gate + Settings + avatar + email** | Sonnet, effort high | `components/staff/StaffPhotoGate.jsx`, `components/staff/staff-photo.css`, `components/settings/Settings.jsx`, `components/settings/settings.css`, `components/staff/TopBar.jsx`, `components/tour/Tour.jsx`, `supabase/functions/_shared/signature.ts` | The gate works at desktop and 375 px. Settings has Change photo and `#st-profile-photo`. TopBar uses `ST_Avatar`. Tours hold while the gate is open. Part K deploys are done. |
| **C: admin + wiring + docs** | Sonnet, effort high | `components/staff/StaffPhotoAdmin.jsx`, `app.jsx`, `components/staff/Today.jsx`, `components/staff/AuditLog.jsx`, `components/tour/announcements.js`, `index.html`, `README.md`, `docs/staff-guide/*.md` | Members column and drawer, bulk zip, Today item, gate mount, announcement (test passes), and every Part J item. The guide is synced with the delete line stripped. |

Each chunk's contract is only what it **calls**:
- B calls `SP_*` (E1, F), `SPI_*` (E2) and `ST_profile.reload` (its own).
- C calls `SP_*`, `SPI_*`, `ST_Avatar` (the existing signature, unchanged) and `PG_Gate` (G1 props).

Review: Opus reviews each chunk's diff against this spec, focusing on RLS and storage policies, the
guard, admin gating and View as. Final verify (Opus), with a Haiku screenshot sweep. The verify
covers:
1. A new test staffer is gated, can open Settings and sign out, uploads, and the gate closes.
2. An admin sees "Needs edit", downloads, replaces with a PNG, and the photo shows on a navy circle in the top bar, Members, the client contact card and a test email signature.
3. A resubmit puts the Today item back.
4. Restore works.
5. A temp admin can't download.
6. View as never shows the gate.
7. Phone width, light and dark.

Never use real staff photos in screenshots. Use a test staffer with a generated placeholder image.

## Part M: risks and open questions (defaults decided)

| Risk or question | Default |
|---|---|
| Existing staff without a photo are blocked on their next load. | Accepted (owner wants it required). The gate takes about a minute, Settings and Sign out stay open, and admins can set Not required. |
| A stale open Settings tab writes an old `photo_path`. | The guard ignores `photo_path` outside the RPCs (D2). |
| Signed URLs in old emails after a replace or restore. | They stay valid: objects are never deleted. New emails show the new current photo. |
| Backfilled legacy photos aren't square. | The app uses `object-fit:cover`, and email adds `object-fit:cover` (ignored by Gmail, so a non-square legacy photo may look squashed in Gmail). The status is "Needs edit", so admins will replace them with a square PNG. |
| HEIC on Chrome or Edge desktop. | No library. A clear message (G1 step 2). iPhone Safari converts to JPEG on upload. |
| Webcam permission denied. | Show "Camera access is blocked. Upload a photo instead." and keep Upload available. |
| Storage growth from never deleting. | Negligible: about 1–2 MB per submission, 20 staff. |
| Narrowing the read policy breaks a reader. | All in-app readers sign `photo_path` (current) or are admin or own. If a client card shows initials after launch, compare it with the old policy before widening anything. |
| Zip of originals contains personal photos. | Admin-only, logged per email. The zip is built in the browser and never uploaded. |
| Should edited photos also be emailed to the staffer? | No (not requested). They see it in Settings with the status "Edited by an admin". |
| Snooze for existing staff? | None. Continue for now appears only after an upload error. |
