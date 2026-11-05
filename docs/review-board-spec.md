# Review board, deadline digest, email draft extras: spec

Status: SPEC, critiqued 2026-11-05 (see "Critique resolutions" at the end). Nothing built. Owner decisions 2026-11-05. Visible names: "Review board" (page), "Deadline digest" (bell entry). Never "Desk". Everything here is hidden until the owner launches it and must work with `month_rhythm_enabled` OFF (test clients get rhythm tasks from "Make due tasks now"). Code never writes `month_rhythm_enabled` or any switch below.

## 0. Decisions (the five that matter)

1. **Separate page, not a Close tracker extension.** New Work hub tab `#/work/review` "Review board", real admins only. CloseTracker (components/staff/CloseTracker.jsx:594) is for every staff member and shows no contacts. Extending it would put admin-only contact data and new columns on an all-staff page, and old behavior would no longer be byte-identical. The board **reuses** `CT_useCloseStatus` (CloseTracker.jsx:495), `CT_STATUSES` (:38), `CT_isLate` (:78), `CT_bookkeeperKey` and `CT_bookkeeperOf` instead of copying them. CloseTracker gets one extra link, "Open Review board", shown only when `RB_on()`.
2. **One gate file** `components/staff/RB_gate.js`, modeled on components/workbench/WB_peek.js:1-60. The gate is: viewer is a real admin AND not in View as AND (preview `mgb_reviewboard_preview` OR firm switch `tk_settings.reviewboard_enabled`, owner-only, missing = off). Because every piece (board, digest, email extras) is admin-only, the admin check lives inside `RB_on()` itself, so no caller can forget it. The digest has its own owner-only pair `reviewboard_digest_enabled` + `reviewboard_digest_to`.
3. **Admin-only contacts are enforced server side** by SECURITY DEFINER RPCs that require a real admin (`rb__require_admin`, raises 42501): `rb_board(p_period)` for the board and `rb_draft_recipients(p_task_id)` for the email extras. Grants are explicit. No RB code reads `client_org_profile`, `client_users`, `client_contacts` or `tk_request_recipients` directly. Bookkeeper pages and their reads are unchanged.
4. **The digest reuses `tk_rhythm_notices`** (supabase/slate-rhythm-4b-daily.sql:50-67) with additive columns and a new kind, `deadline_digest`. A new function, `rb_deadline_digest(p_today)`, runs on its own pg_cron job 10 minutes after `month-rhythm-daily` (`40 10 * * *` UTC, so `50 10 * * *`). It upserts one row per recipient, month and part, and counts refresh on every run. It writes nothing unless the digest switch is strictly on, the list is non-empty, and rhythm tasks exist. It follows the generator's rule for which clients count (real clients only when `month_rhythm_enabled` is on; test and internal clients only while it is off) so it can be tested before launch.
5. **Email extras stay inside the existing E1/E2 draft modal** (components/tasks/TK_EmailDraft.jsx). The button rule (`TK_useEmailKind`) is unchanged. The extras (To/Cc chips, Open in email app, Mark sent) render only when `RB_on()`, and their recipient data comes only from the admin-only `rb_draft_recipients`. "Mark sent" writes a new small table, `rb_email_sent`, through one RPC that derives the email kind server side. Drafts are DRAFT ONLY: nothing is sent from the portal.

## 1. Gate (resolved in ONE helper)

New file **components/staff/RB_gate.js** (plain JS; node-exported for tests). Load order is in section 6 (index.html `window.__SOURCE_ORDER`).

```js
var RB_PREVIEW_KEY = "mgb_reviewboard_preview";
var RB_CACHE_KEY   = "mgb_reviewboard_cache";      // "1" or removed
var RB_EVENT       = "mgb:reviewboard";
var RB_SWITCH      = "reviewboard_enabled";
var RB__viewer     = { realAdmin: false, read: false };
function RB_isOn(previewOn, switchValue)            // pure: previewOn===true || switchValue===true
function RB_viewingAs()                             // !!(window.mgbViewAs && window.mgbViewAs.on)
function RB_setViewer(isRealAdmin)                  // App calls it in render with STAFF_isRealAdmin(staffUser) && !impersonating.
                                                    // Plain assignment, no event, no read (safe during render).
function RB_switchRead()                            // once per page load, only if RB__viewer.realAdmin: tk_settings eq key RB_SWITCH;
                                                    // never writes; missing row = off; sets/removes RB_CACHE_KEY; fires RB_EVENT on change.
                                                    // App calls it from a useEffect when realAdmin becomes true.
function RB_on()                                    // sync: RB__viewer.realAdmin && !RB_viewingAs()
                                                    //        && RB_isOn(ls[RB_PREVIEW_KEY]==="1", ls[RB_CACHE_KEY]==="1")
function RB_useOn()                                 // React hook, re-renders on RB_EVENT
```

- **Real admin** means `STAFF_isRealAdmin(u)` = `u.role === "admin"` (app.jsx:1648). Temp admins (staff_temp_admin_access, supabase/staff-temp-admin-access.sql) never pass. The server agrees: `is_active_staff_admin()` (supabase/staff-admin-policies.sql:29) requires `jwt_has_google()`, the staff row role = 'admin' and active.
- **Off** means no reads, no listeners, no tab, no bell rows, and no modal extras. Every gated spot draws exactly what it drew before. For anyone who is not a real admin (bookkeepers, temp admins, View as), not even the `tk_settings` switch read happens, so their network traffic is byte-identical too.
- **View as:** there is no existing View as check to reuse (WB_peek.js has none; it relies on the Desk never mounting in View as). `RB_viewingAs()` reads `window.mgbViewAs.on` directly, and `RB_setViewer` also receives `!impersonating`. Never add an `rb_*` RPC to the `MGB_VIEW_AS_READ_RPCS` allow-list in supabaseClient.js; the existing guard then blocks them in View as as a second fence.
- A stale `mgb_reviewboard_cache` = "1" left in a browser later used by a non-admin is harmless: `RB_on()` checks `RB__viewer.realAdmin` first.

## 2. Owner-only switches (migration 1)

File **supabase/review-board-switch.sql** (+ `review-board-switch-tests.sql`).

Recreate `public.tk__owner_only_key(text)` exactly as supabase/owner-only-desk-peek-switch.sql does: `language sql immutable set search_path = public`, ending with `notify pgrst, 'reload schema';`. **Before applying, re-read the live list with `pg_get_functiondef('public.tk__owner_only_key(text)'::regprocedure)`**, because another build may add keys before this one ships. Live list verified 2026-11-05 = the repo list below (26 keys, ending `desk_peek_enabled`), plus three new keys:

```sql
... in ('mgb_home_enabled','client_request_enabled','client_request_pilot','standard_set_live',
 'late_tasks_count_against_staff','late_tasks_effective_from','wb_enabled','desk_app_enabled',
 'nav_enabled','lato_enabled','month_rhythm_enabled','slate_app_enabled','brand_enabled',
 'hovernav_enabled','org_profile_enabled','deskplus_enabled','threadmenu_enabled',
 'slateplus_enabled','client_page_drop_enabled','client_page_drop_pilot',
 'client_upload_notify_enabled','members_area_open','members_staff_enabled',
 'create_menu_enabled','slatesimple_enabled','desk_peek_enabled',
 'reviewboard_enabled','reviewboard_digest_enabled','reviewboard_digest_to')
```

- NO rows are inserted. Missing = off.
- Value shapes:
  - `reviewboard_enabled`: jsonb `true`/`false`.
  - `reviewboard_digest_enabled`: jsonb `true`/`false`.
  - `reviewboard_digest_to`: jsonb array of emails (compared lowercase). The owner sets `["jesse@…"]`.
- Tests, in the same style as owner-only-desk-peek-switch-tests.sql (pg_temp helpers `as_user`, `ok`, `expect_err`; people are picked at run time; no names appear in the file; ends in `rollback`) check that:
  - the 3 new keys are owner-only;
  - every earlier key is still owner-only (loop over the list read before the change);
  - a non-owner admin insert is refused;
  - no row exists for the 3 keys.

## 3. Review board (piece 1)

### 3a. Server: `rb_board` (migration 2: supabase/review-board.sql + -tests.sql)

```sql
create or replace function public.rb__require_admin() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_active_staff_admin() then
    raise exception 'rb_forbidden' using errcode = '42501';
  end if;
end $$;
revoke all on function public.rb__require_admin() from public, anon, authenticated;

create or replace function public.rb_board(p_period date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_today date := (now() at time zone 'America/Chicago')::date;
        v_p date := date_trunc('month', coalesce(p_period, (date_trunc('month', v_today) - interval '1 month')::date))::date;
        v_internal boolean := public.can_view_internal();
begin
  perform public.rb__require_admin();
  return jsonb_build_object(
    'period', v_p, 'today', v_today,
    'rhythm', (select value from tk_settings where key = 'month_rhythm'),   -- parts [{key,label,day}], owner-editable
    'clients', coalesce((
    select jsonb_agg(jsonb_build_object(
      'client_id',   c.id,
      'name',        c.name,
      'test_only',   coalesce(c.test_only, false),
      'is_internal', coalesce(c.is_internal, false),
      'people',   (select jsonb_agg(jsonb_build_object('role',p.role,'email',p.email,'name',p.name))
                     from public.tk__client_people(c.id) p where p.role in ('bookkeeper','backup')),
      'contact',  (select jsonb_build_object('name',o.contact_name,'email',o.contact_email,'phone',o.contact_phone)
                     from client_org_profile o where o.client_id = c.id),
      'logins',   (select jsonb_agg(jsonb_build_object('email',u.email,'name',u.name,'role',u.role,'active',u.active)
                                    order by u.active desc, u.name)
                     from client_users u where u.client_id = c.id),
      'report_state', (select s.state from tk_report_state s where s.client_id = c.id and s.period = v_p),
      'tasks',    (select jsonb_agg(jsonb_build_object(
                     'part', x.part, 'id', x.id, 'status', x.status,
                     'assignee', x.assignee_email,                    -- null = Unassigned (S8b rule)
                     'assignee_name', (select s.name from staff s where lower(s.email) = lower(x.assignee_email)),
                     'owner', x.staff_email,                          -- row owner; never shown as the assignee
                     'due', x.due_date, 'completed_at', x.completed_at,
                     'by', x.done_by,
                     'by_name', (select s.name from staff s where lower(s.email) = lower(x.done_by)),
                     'auto', x.done_by = 'system',
                     'excused', public.tk_late_excused(x.status, x.client_id, x.period_kind, x.period_start),
                     'waiting', x.status = 'waiting_client',
                     'sent', (select jsonb_build_object('by', e.sent_by, 'at', e.sent_at)
                                from rb_email_sent e where e.task_id = x.id)))
                   from (select distinct on (tt.id)
                                tt.due_rule->>'part' as part, r.*,
                                case when r.status = 'done' then
                                  (select a.actor_email from tk_activity a
                                    where a.task_id = r.id and a.kind = 'status' and a.to_value = 'done'
                                    order by a.created_at desc limit 1) end as done_by
                           from task_templates tt
                           join staff_reminders r on r.template_id = tt.id
                          where tt.source_ref in ('month_rhythm:2_check_in','month_rhythm:6_reports','month_rhythm:7_follow_up')
                            and r.client_id = c.id and r.deleted_at is null and r.parent_id is null
                            and r.period_kind = 'month' and r.period_start = v_p
                          order by tt.id, r.created_at desc) x)
    ) order by c.name)
      from clients c
     where (c.lost_at is null or c.lost_at > v_today)
       and (not coalesce(c.is_internal, false) or v_internal)), '[]'::jsonb));
end $$;
revoke all on function public.rb_board(date) from public, anon;
grant execute on function public.rb_board(date) to authenticated;
```

Notes and column gotchas (checked against the repo .sql files and the live DB on 2026-11-05):

- **Assignee vs owner.** Generated rhythm tasks set `staff_email = assignee_email` today, but the app's rule (TK_logic.js:285 `TK_assigneeOf`, S8b fix in supabase/tasks-p2-11-s8b-review-fixes.sql) is that `assignee_email` null means Unassigned and the owner (`staff_email`) never stands in. The board shows `assignee` ("Unassigned" when null) and keeps `owner` only for tooltips.
- **Done "by"** comes from `tk_activity` (kind 'status', to_value 'done', latest row). `status_changed_by`/`approved_by`/`submitted_by` are null on every live rhythm task and `status_changed_by` is null on 164 of 203 done tasks, so they cannot be used. The rhythm cron writes actor 'system' (slate-rhythm-4b-daily.sql sets `mgb.tk_actor = 'system'`), which is how `auto` is detected; no `tk_comments` lookup. A task reopened and re-done shows the latest closer.
- **Internal clients.** `rb_board` is definer, so it bypasses the RESTRICTIVE "internal company lock" policies. It re-applies the same rule: an internal client is returned only when `can_view_internal()` (admin + `internal_access` row).
- **Parts** come from `task_templates.due_rule->>'part'` (`check_in`, `reports`, `follow_up`), the same keys as `tk_settings.month_rhythm.parts[].key`. Templates are found by `source_ref`, never by title or id. Column labels use the firm days from `rhythm` (owner-editable), not hard-coded "4th/14th/24th".
- `distinct on` + `parent_id is null` keep one task per part even if a manual copy exists; the newest wins.
- Bookkeeper and backup come from `tk__client_people` (supabase/tasks-p2-4-recurring.sql:317; executable only by postgres/service_role, fine inside definer). The page's Bookkeeper column and filter use `CT_bookkeeperKey`/`CT_bookkeeperOf` on the app's client objects (same as CloseTracker); `name`, `test_only`, `is_internal` are returned so the page works even for a client missing from the app list.
- `staff_profiles` has **no id or name columns**. Names come from `staff`.
- `staff_reminders` fields used: `assignee_email`, `staff_email`, `status` (todo, in_progress, waiting_client, ready_for_review, done), `period_kind`/`period_start` (P = the closed month), `template_id`, `parent_id`, `due_date`, `completed_at`, `created_at`, `deleted_at`.
- Lost clients: `clients.lost_at` (date); a client is lost once `lost_at <= today`, same as `LC_isLost`.
- Test clients (`test_only`) ARE returned. The page hides them by default with a "Show test clients" toggle, so the board is testable with the rhythm off.
- `tk_late_excused(text,text,text,date)` (slate-rhythm-4c-late-exclusion.sql:38) is true for `waiting_client` or a preliminary month.
- Admin RLS on `client_users`, `client_org_profile` and `client_contacts` is unchanged.

Tests (`review-board-tests.sql`, rolled back):

- A real admin gets every current non-internal client; with an `internal_access` row also the internal one; without it, not.
- A bookkeeper and a temp admin each get 42501; anon has no execute: `has_function_privilege('anon','public.rb_board(date)','execute')` is false.
- A lost client is absent.
- A rhythm task created in the transaction (test client, the three templates) shows up with the right part/status; `assignee` is null when `assignee_email` is null while `owner` is set.
- After a status change to done by a staff user (mgb.tk_actor set) `by` is that email; with `mgb.tk_actor = 'system'` `auto` is true.
- `rb_board(null)` returns last month.
- `rb__require_admin` is not executable by authenticated.

### 3b. Deadline chips (pure logic: components/staff/RB_logic.js + RB_logic.test.js)

Period P = the month being closed. Default is last month (= `CT_useCloseStatus().focus`, and `rb_board(null)`). Rhythm tasks for P are due in month P+1 on the firm part days (firm_part rule, docs/slate-rhythm-slice-3.md; weekends roll to the business day before; client overrides in `client_profile.rhythm` can move a client's dates). Part key to template:

- `check_in` → `month_rhythm:2_check_in` (email kind request).
- `reports` → `month_rhythm:6_reports` (email kind reports).
- `follow_up` → `month_rhythm:7_follow_up` (email kind maintenance).

`RB_partLabel(partKey, rhythm)` → "4th · Check in" from `rhythm.parts` (ordinal of `day` + `label`); falls back to the key's default label if the setting is missing.

`RB_chipFor(task, ctx) -> {state, label, by, at, tone}`. Evaluate the rules in order:

| # | Condition | state | label |
|---|---|---|---|
| 1 | no task row | `none` | "No task yet" |
| 2 | `status='done'` and `auto` (only the follow-up is auto-closed, when nothing is outstanding) | `notneeded` | "Not needed · nothing outstanding · Nov 24" |
| 3 | `status='done'` and `by` present | `done` | "Done · First L. · Nov 14" (`by_name` → "First L."; `at` = completed_at, Chicago) |
| 4 | `status='done'` and `by` null (history missing) | `done` | "Done · Nov 14" |
| 5 | `status='ready_for_review'` | `review` | "Ready for review · assignee" |
| 6 | open and `due < today` and not `excused` | `late` | "Late · due Nov 14 · assignee" |
| 7 | open and `excused` | `open` | "Open · waiting on client" when `waiting`, else "Open · preliminary month" |
| 8 | otherwise | `open` | "Open · due Nov 14 · assignee" |

- `assignee` renders as "First L." from `assignee_name`, or "Unassigned" when null. It never falls back to the owner, and `by` never falls back to the assignee.
- If `sent` is present, a second line reads "Email marked sent · First L. · Nov 13". It does not change the state.
- Chip sort rank, worst first: `late 0, open 1, review 2, none 3, done 4, notneeded 5`.
- Pure functions: `RB_chipFor`, `RB_chipRank`, `RB_partOf(sourceRef)`, `RB_partLabel`, `RB_rowModel(rpcRow, client, closeStatus)`, `RB_sortRows(rows, key, dir)`, `RB_filterRows(rows, f)`, `RB_counts(rows, part)`, `RB_digestTitle(part, counts, rhythm)`. Node-tested like TK_emailDraft.test.js.

### 3c. Close column (reuse, no new SQL)

`CT_useCloseStatus(realClients, staffUser)` provides `statusOf(clientId, P)` and `isLate`.

- Label: `CT_STATUSES` (CloseTracker.jsx:38). not_started shows "—"; review shows "Ready"; also in_progress, done and na.
- Tone: red when `CT_isLate(P, status, lateDay, today)` (late from day `month_close_settings.late_day`, default 15; only from `CT_LATE_FROM` "2026-10"; review/done/na never late).
- When `signed_off_by` is present, show a small "signed off" mark.
- It listens to `mgb:month-close-changed` (`CT_CHANGED_EVENT`), so edits elsewhere refresh it.
- `CT_useCloseStatus` covers 7 months; the period picker offers only the last 3, so it is always in range.
- No QuickBooks checks on the board, because the Close tracker already shows them.

### 3d. Page: components/staff/RB_ReviewBoard.jsx

`function RB_ReviewBoardPage({ staffUser, clients, taskClients, viewingAs })`:

- If `!RB_on() || viewingAs`, render `null`.
- It loads `rbApi.board(P)` (one RPC call), plus `CT_useCloseStatus`. On a 42501 it renders null (never an error banner with details).
- P comes from `?period=YYYY-MM` in the hash when present and within the last 3 months (parsed on mount and on hashchange), else the focus month.
- Columns (all sortable; click the header to toggle asc/desc; the choice is remembered in `localStorage mgb_rb_sort` inside try/catch):

| Column | Sort key |
|---|---|
| Client | name, a-z |
| Bookkeeper | name (`CT_bookkeeperOf`), then client |
| Backup | name ("—" last) |
| Main contact | contact name ("Not set" last) |
| `RB_partLabel('check_in')` e.g. "4th · Check in" | chip rank, then due date |
| `RB_partLabel('reports')` | chip rank, then due date |
| `RB_partLabel('follow_up')` | chip rank, then due date |
| Close | CT order not_started<in_progress<review<done<na, late first |
| Approve | reserved: renders "—", is not sortable, has a tooltip "Coming later" |

- Each row has an expander (▸) showing the main contact (name, email as a mailto link, phone) and then every `client_users` login (name, email, role), active first; inactive logins are dimmed with "inactive". "No portal logins" shows when there are none, and "Not set" when there is no main contact.
- Filters sit in a toolbar above the table and use plain selects:
  - Bookkeeper: All, each `CT_bookkeeperKey`, "Unassigned".
  - Status: All; Has late; Any open; All three done (done or not needed); No task yet; Close not done; Preliminary reports.
  - Period: the last 3 months, defaulting to the focus month.
  - "Show test clients": off by default; turn it on to test with the rhythm off.
- Top line: "62 clients · 14th: 41 done, 21 open" (`RB_counts`, the same rule as the digest: done includes not needed).
- An empty state reads "No rhythm tasks for October yet". Tasks for a client come from "Make due tasks now" while `month_rhythm_enabled` is off.
- Clicking a chip opens the task drawer using the existing task-open route (`#/tasks/my?item=task:<id>`).
- Styling uses existing table classes (CloseTracker `CT_COLS` look) and US spelling.

### 3e. Placement (Work hub)

- components/staff/StaffNav.jsx NAV_PLACES work tabs (:65-75): append `{ key: "review", label: "Review board", help: "review-board", admin: true, realAdmin: true, visible: () => typeof RB_on === "function" && RB_on() }`. The filter at :184-188 already honors `realAdmin` via `c.isRealAdmin`.
- components/staff/WorkPage.jsx :74: pass `isRealAdmin: staffUser.role === "admin" && !viewingAs` to `NAV_visibleTabs`. Today isRealAdmin is not passed, so `realAdmin` tabs would hide. No existing work tab sets `realAdmin`, so nothing else changes. Then render `RB_ReviewBoardPage` for key `review`. An unknown or hidden key falls back to the default tab, as today.
- Other surfaces that list work tabs already pass isRealAdmin: the ⌘K rows (TopBar navCtx :2146-2160, `isRealAdmin && !impersonating`), the HoverNav flyout (app.jsx:2703) and Tour.jsx `TOUR_hasTab` (:1033). StaffSidebar does not list work tabs. Check each shows the tab only for a real admin with the board on.
- app.jsx: call `RB_setViewer(STAFF_isRealAdmin(staffUser) && !impersonating)` in the App render before the staff shell renders, plus a `useEffect` that calls `RB_switchRead()` when that value becomes true.
- CloseTracker.jsx: add one `RB_on()`-gated link, "Open Review board", in the header.

## 4. Deadline digest in the bell (piece 2)

### 4a. Migration 3: supabase/review-board-digest.sql (+ -tests.sql)

All changes are additive. Old rows and the old bell behave the same.

```sql
alter table public.tk_rhythm_notices alter column task_id drop not null;
alter table public.tk_rhythm_notices alter column client_id drop not null;
alter table public.tk_rhythm_notices add column if not exists part text;
alter table public.tk_rhythm_notices add column if not exists counts jsonb;
alter table public.tk_rhythm_notices add column if not exists updated_at timestamptz;
-- kind check: live name verified 2026-11-05 = tk_rhythm_notices_kind_check, CHECK (kind = 'second_preliminary').
alter table public.tk_rhythm_notices drop constraint if exists tk_rhythm_notices_kind_check;
alter table public.tk_rhythm_notices add constraint tk_rhythm_notices_kind_check
  check (kind in ('second_preliminary','deadline_digest'));
alter table public.tk_rhythm_notices drop constraint if exists tk_rhythm_notices_shape;
alter table public.tk_rhythm_notices add constraint tk_rhythm_notices_shape
  check ((kind='second_preliminary' and task_id is not null and client_id is not null)
      or (kind='deadline_digest' and task_id is null and part in ('check_in','reports','follow_up') and counts is not null));
create unique index if not exists tk_rhythm_notices_digest_uq
  on public.tk_rhythm_notices (recipient_email, period, part) where kind = 'deadline_digest';
```

- The existing UNIQUE(task_id, recipient_email) is unaffected: digest rows have task_id null, and NULLs never collide.
- RLS: the existing policy "tk rhythm notices own read" (`is_active_staff()` and recipient = my lowercase jwt email) already limits reads to the recipient. No policy change is needed. Grants stay select-only for authenticated.
- `period` = P, the closed month (first of month, existing check), which matches the existing `period` meaning.

```sql
create or replace function public.rb_deadline_digest(p_today date default (now() at time zone 'America/Chicago')::date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_on     boolean := coalesce(public.tk__jsonb_bool((select value from tk_settings where key='reviewboard_digest_enabled')), false);
  v_to     jsonb   := (select value from tk_settings where key='reviewboard_digest_to');
  v_rhythm boolean := coalesce(public.tk__jsonb_bool((select value from tk_settings where key='month_rhythm_enabled')), false);
  v_rows int := 0;
begin
  if not v_on or v_to is null or jsonb_typeof(v_to) <> 'array' or jsonb_array_length(v_to) = 0 then
    return jsonb_build_object('rows', 0, 'skipped', 'off'); end if;
  with t as (
    select tt.due_rule->>'part' as part, r.period_start as period, r.status, r.due_date,
           (exists (select 1 from tk_activity a where a.task_id = r.id and a.kind='status'
                     and a.to_value='done' and a.actor_email='system')) as auto
      from task_templates tt
      join staff_reminders r on r.template_id = tt.id
      join clients c on c.id = r.client_id
     where tt.source_ref in ('month_rhythm:2_check_in','month_rhythm:6_reports','month_rhythm:7_follow_up')
       and r.deleted_at is null and r.parent_id is null
       and r.period_kind = 'month' and r.period_start is not null
       and (c.lost_at is null or c.lost_at > p_today)
       -- same client rule as the generator: real clients when the rhythm is on; only test/internal while it is off
       and (case when v_rhythm then not coalesce(c.test_only,false) and not coalesce(c.is_internal,false)
                 else coalesce(c.test_only,false) or coalesce(c.is_internal,false) end)),
  win as (   -- (part, period) pairs with any task due in the window: due day .. +9
    select distinct part, period from t where due_date between p_today - 9 and p_today),
  agg as (   -- then count ALL tasks of that part and period, so totals do not drift
    select t.part, t.period, count(*) total,
           count(*) filter (where t.status='done') done,
           count(*) filter (where t.status='done' and t.auto) not_needed
      from t join win using (part, period) group by t.part, t.period),
  rcp as (
    select distinct lower(e) as email
      from jsonb_array_elements_text(v_to) e
      join staff s on lower(s.email) = lower(e) and s.active and s.role = 'admin')
  insert into tk_rhythm_notices (recipient_email, period, kind, part, counts, updated_at)
  select rcp.email, agg.period, 'deadline_digest', agg.part,
         jsonb_build_object('total',agg.total,'done',agg.done,'not_needed',agg.not_needed,
                            'open',agg.total-agg.done,'test',not v_rhythm), now()
    from agg cross join rcp
  on conflict (recipient_email, period, part) where kind='deadline_digest'
  do update set counts = excluded.counts, updated_at = now()
   where tk_rhythm_notices.counts is distinct from excluded.counts;
  get diagnostics v_rows = row_count;
  return jsonb_build_object('rows', v_rows, 'test', not v_rhythm);
end $$;
revoke all on function public.rb_deadline_digest(date) from public, anon, authenticated;
select cron.unschedule(jobid) from cron.job where jobname = 'review-board-digest';
select cron.schedule('review-board-digest', '50 10 * * *', $$select public.rb_deadline_digest();$$);
```

- **Recipients are de-duplicated** (`distinct lower(e)`); without it a repeated email would make ON CONFLICT DO UPDATE hit the same row twice in one statement and the whole run would error.
- **Idempotency:** each recipient, period and part has one row (partial unique index). A re-run updates `counts`/`updated_at` only when they change, and `created_at` is kept.
- **Window:** a (part, period) is reported from its earliest due date through 9 days after the latest due date in it; counts cover every task of that part and period, so a client override with a later date does not change the total.
- **No rhythm tasks** means agg is empty and nothing is written. **Switch off or empty list** means nothing is written.
- **Test mode:** while `month_rhythm_enabled` is off, only test and internal clients count (the same clients "Make due tasks now" fills), `counts.test` is true and the bell title starts "Test clients ·". The day the owner turns the rhythm on, the next run counts real clients only and new rows have `test: false`. Old test rows for an earlier period age out of the bell after 14 days.
- **Counts can lag up to 24h.** The bell recomputes nothing itself; the board shows live numbers.
- Why a new function rather than extending `tk_rhythm_daily`: tk_rhythm_daily is gated on `month_rhythm_enabled`/test clients and owned by slice 4b. The digest has its own owner switch, and a separate function keeps slice 4b untouched.
- Tests check that:
  - the switch off, a missing list or an empty list gives 0 rows;
  - with a switch, list and tasks set (rhythm off → a test client), a second run gives 1 row per part/recipient with the same id and updated counts, and `counts.test` is true;
  - the same email listed twice (any case) gives one row and no error;
  - a non-admin or inactive email in the list is ignored;
  - with `month_rhythm_enabled` set true inside the transaction, test-client tasks are not counted;
  - authenticated cannot execute;
  - the old `second_preliminary` insert without part still works; a digest row without counts is refused; a digest row with part '14th' is refused;
  - the cron job exists with schedule `50 10 * * *`.

### 4b. Bell (components/staff/TopBar.jsx)

- The existing loader (`TK_api.listRhythmNotices`, TK_api.js:3423-3428) gets `.neq("kind","deadline_digest")`, so digest rows never take its 50 slots. The old bell code (TopBar.jsx:1107-1121) already drops rows without `task_id`.
- `TB_useBellItems({ clients, items, me, isAdmin, page })` (:855) gets a new `isRealAdmin` argument; `TB_Bell` (:1188) already has it and passes it down. The bell only renders for the user's own session, never in View as.
- New loader beside rhyNotices (:950-969). It runs only when `RB_on() && isRealAdmin`, using the same 2-minute refresh (TB_BELL_REFRESH_MS, :66). It calls `rbApi.listDigests()`: `select id, period, part, counts, created_at, updated_at from tk_rhythm_notices where kind='deadline_digest' and updated_at > now() - interval '14 days' order by updated_at desc limit 6`.
- Bell item fields (same shape as the rhythm items at :1107-1121):
  - id: `"rbd:" + row.id + ":" + row.updated_at`. A count change re-surfaces it as unread (the seen set is capped at TB_BELL_SEEN_MAX, so old ids age out). "rbd:" is not in ST_BELL_PREFS (Settings.jsx:96-102), so `ST_bellAllows` lets it through.
  - title: `RB_digestTitle(part, counts, rhythm)`, e.g. "14th · Send reports for October: 41 of 62 done, 21 open"; prefixed "Test clients · " when `counts.test`.
  - `go: () => { location.hash = "#/work/review?period=YYYY-MM"; }` (the bell uses `go` functions, not href).
- Only opted-in admins get rows (server list + RLS). The board must also be on for them (`RB_on()`), so the digest is invisible until the preview flag or the firm switch is on for that admin.

## 5. Email draft extras (piece 3)

Base: TK_EmailDraft.jsx `TK_EmailDraftModal` and the pure builder TK_emailDraft.js `TK_emailDraftBuild`. These already give the subject, body, the CC suggestion (account manager *name*), and kinds request/reports/maintenance for rows 2/6/7. Nothing is duplicated.

- **Button visibility is unchanged.** `TK_useEmailKind(task)` keeps requiring `TK_rhythmEnabled()`, which already includes the per-person Month rhythm preview (`TK_rhythmPreviewOn`). An admin testing with the rhythm off turns on both previews (Month rhythm + Review board). This keeps the button rule for bookkeepers byte-identical.
- **Extras** render only when `RB_on()` (real admin, not View as), in a new block `RB_EmailExtras` above Subject inside the modal. The modal has no staffUser prop; `RB_on()` needs none.
  - **Data:** `rbApi.draftRecipients(task.id)` → `rpc('rb_draft_recipients', { p_task_id })` (below). One call when the modal opens. On 42501 or error the block hides and the modal looks as today.
  - **To chips**, de-duplicated by lowercase email, in this order:
    - the org-profile main contact (on by default);
    - `contacts` (client_contacts, `can_answer` first; off);
    - active portal `logins`, skipping `opted_out` (off).

    If there is no main contact, the first chip is on. If there are no chips at all, "Add a contact in Client info" shows.
  - **Cc chips.** The assigned bookkeeper (role bookkeeper) is on by default when it is not me; the account manager (by email, from the same RPC) is on by default when it is not me. When the extras are on, the existing "Suggested CC" text line is replaced by these chips; when off it stays.
  - The Subject and body are the existing prefilled fields; nothing changes.
  - **Buttons.** The footer adds **Open in email app** and **Mark sent** after the existing Start over / Copy subject / Copy email (the existing Copy email copies the **body only**; unchanged).
    - Open in email app: `RB_mailto({to, cc, subject, body})`. Every address is checked against a simple email pattern (no `?`, `&`, `,`, spaces or `%`) and dropped if it fails; valid addresses are joined by "," and inserted **unencoded** (encoding `@` breaks some mail apps). Subject and body: newlines normalized to `\r\n`, then `encodeURIComponent` (gives `%0D%0A`). Query is `?cc=…&subject=…&body=…`, omitting empty parts.
    - If the full URL is longer than 1800 chars, it falls back to a URL with to/cc/subject only, copies the body to the clipboard first (TK_emailCopy), and shows a toast: "Body copied. Paste it into the email."
    - Pure functions with node tests: `RB_mailto`, `RB_recipientChips`.
  - **Mark sent** calls `rpc('rb_mark_email_sent', { p_task_id, p_to_count })` and then shows "Marked sent by you · 2:14 pm". **Undo** calls `rb_unmark_email_sent(p_task_id)`. It does not complete the task. The board chip shows the second line (3b).
- **DRAFT ONLY.** The hint "Nothing is sent from here..." stays.

Migration (inside review-board.sql, same -tests.sql):

```sql
create or replace function public.rb_draft_recipients(p_task_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_client text;
begin
  perform public.rb__require_admin();
  select r.client_id into v_client from staff_reminders r
   where r.id = p_task_id and r.deleted_at is null and r.client_id is not null;
  if v_client is null then raise exception 'rb_not_found' using errcode = 'P0002'; end if;
  if not public.can_access_client(v_client) then
    raise exception 'rb_forbidden' using errcode = '42501'; end if;   -- includes the internal-client rule
  return jsonb_build_object(
    'contact', (select jsonb_build_object('name',o.contact_name,'email',lower(o.contact_email))
                  from client_org_profile o where o.client_id = v_client and o.contact_email is not null),
    'contacts', coalesce((select jsonb_agg(jsonb_build_object('name',k.name,'email',lower(k.email),'can_answer',k.can_answer)
                            order by k.can_answer desc, k.name)
                  from client_contacts k where k.client_id = v_client and k.email is not null), '[]'),   -- never notes
    'logins', coalesce((select jsonb_agg(jsonb_build_object('name',u.name,'email',lower(u.email),
                            'opted_out', coalesce(x.opted_out,false)) order by u.name)
                  from client_users u
                  left join client_email_recipients x on x.client_id = u.client_id and lower(x.email) = lower(u.email)
                 where u.client_id = v_client and u.active), '[]'),
    'staff', coalesce((select jsonb_agg(jsonb_build_object('role',p.role,'email',lower(p.email),'name',p.name))
                  from public.tk__client_people(v_client) p where p.role in ('bookkeeper','account_manager')), '[]'));
end $$;
revoke all on function public.rb_draft_recipients(uuid) from public, anon;
grant execute on function public.rb_draft_recipients(uuid) to authenticated;

create table if not exists public.rb_email_sent (
  task_id uuid primary key references public.staff_reminders(id) on delete cascade,
  client_id text not null references public.clients(id) on delete cascade,
  kind text not null check (kind in ('request','reports','maintenance')),
  to_count int not null default 0 check (to_count between 0 and 50),
  sent_by text not null check (sent_by = lower(sent_by)),
  sent_at timestamptz not null default now());
alter table public.rb_email_sent enable row level security;
drop policy if exists "rb email sent staff read" on public.rb_email_sent;
create policy "rb email sent staff read" on public.rb_email_sent for select to authenticated
  using (public.is_active_staff() and public.can_access_client(client_id));
revoke all on public.rb_email_sent from public, anon, authenticated;
grant select on public.rb_email_sent to authenticated;
-- rb_mark_email_sent(p_task_id uuid, p_to_count int) returns jsonb, SECURITY DEFINER, set search_path = public:
--   load task + template (deleted_at is null, client_id not null) else 'rb_not_found';
--   perform tk__req_staff_guard(task.client_id);  -- active staff + can_access_client
--   v_kind := task_templates.email_kind of task.template_id; null -> raise 'rb_not_email_task';
--   upsert on task_id: kind = v_kind, to_count = least(greatest(coalesce(p_to_count,0),0),50),
--     sent_by = lower(auth.jwt()->>'email'), sent_at = now(); return {by, at}.
-- rb_unmark_email_sent(p_task_id uuid) returns void: same guard, delete by task_id.
-- revoke all from public, anon; grant execute to authenticated (both).
```

- Column names for `client_org_profile`, `client_contacts`, `client_users` and `client_email_recipients` must be re-checked against the live tables in build (`information_schema.columns`), as with every gotcha in the deploy skill. The shape above is what the page needs.
- Mark sent stays open to any staff member who can access the client (the RPC guard), but the button is only drawn for admins today. That keeps the table ready if bookkeepers get the extras later.

Why a table rather than a tk_comments row: `tk_comments_before_write` allows `kind='system'` only for the rhythm job (slate-rhythm-4b-daily.sql:35-47). A staff-written marker would need a trigger change, and one row per task can be read cheaply by `rb_board`.

**Not built, ask owner:** whether staff want sending from the portal (Resend) or scheduled sends. Today it is a draft plus their own email app only.

## 6. File list

| File | Change | Functions |
|---|---|---|
| components/staff/RB_gate.js | new | RB_isOn, RB_viewingAs, RB_setViewer, RB_switchRead, RB_on, RB_useOn |
| components/staff/RB_logic.js (+ .test.js) | new, pure | RB_chipFor, RB_chipRank, RB_partOf, RB_partLabel, RB_rowModel, RB_sortRows, RB_filterRows, RB_counts, RB_digestTitle, RB_mailto, RB_recipientChips |
| components/staff/RB_api.js | new | rbApi.board(period), rbApi.listDigests(), rbApi.draftRecipients(taskId), rbApi.markSent(taskId, n), rbApi.unmarkSent(taskId) |
| components/staff/RB_ReviewBoard.jsx | new | RB_ReviewBoardPage, RB_Chip, RB_ContactExpander, RB_Toolbar, RB_EmailExtras |
| components/staff/StaffNav.jsx | edit :65-75 | work tab `review` |
| components/staff/WorkPage.jsx | edit :74 + body switch | pass isRealAdmin; render board |
| components/staff/CloseTracker.jsx | edit header | gated link |
| components/staff/TopBar.jsx | edit :855, :950-969, :1107-1121, :1188 | isRealAdmin into TB_useBellItems; digest loader + items |
| components/tasks/TK_api.js | edit :3423-3428 | `.neq('kind','deadline_digest')` |
| components/tasks/TK_EmailDraft.jsx | edit | mount `RB_EmailExtras` when `RB_on()`; footer buttons. `TK_useEmailKind` unchanged |
| index.html | edit `window.__SOURCE_ORDER` | `RB_gate.js`, `RB_logic.js`, `RB_api.js` before `StaffNav.jsx` (:583); `RB_ReviewBoard.jsx` after `CloseTracker.jsx` (:599) and before `WorkPage.jsx` (:651). TopBar.jsx (:653) and TK_EmailDraft.jsx (:727) then load after all RB files. Bump `window.MGB_VERSION` (:449) |
| app.jsx | edit | `RB_setViewer` + `RB_switchRead` effect in App; FEATURE_FLAGS entry `mgb_reviewboard_preview` (reloads:true, after `mgb_peek_preview` :1042); Dev Tools switch rows (~15777-15795): `reviewboard_enabled`, `reviewboard_digest_enabled`, `reviewboard_digest_to`; PAGE_META (:27612) entry for `work/review`; resettableLocalStorageKeys (:14181) and readAllMygoodbooksStorage (:15462): `mgb_reviewboard_preview`, `mgb_reviewboard_cache`, `mgb_rb_sort`; INFRA_LINKS (:1126) cron row |
| supabase/review-board-switch.sql (+ -tests.sql) | new | tk__owner_only_key |
| supabase/review-board.sql (+ -tests.sql) | new | rb__require_admin, rb_board, rb_draft_recipients, rb_email_sent, rb_mark_email_sent, rb_unmark_email_sent |
| supabase/review-board-sent-read.sql (+ -tests.sql) | new (review follow-up, applied as reviewboard_4_sent_read) | rb_draft_recipients gains `sent` |
| supabase/review-board-digest.sql (+ -tests.sql) | new | notices extension, rb_deadline_digest, cron `review-board-digest` |

Never add any `rb_*` RPC to `MGB_VIEW_AS_READ_RPCS` (supabaseClient.js).

FEATURE_FLAGS text: "Turns on for you only, in this browser, while the firm-wide reviewboard_enabled switch is off, the Review board (Work › Review board), the Deadline digest in your bell (once the owner sets the digest list), plus To/Cc chips, Open in email app and Mark sent in email drafts. Real admins only. Nothing emails anyone. Off in View as. To try drafts while the month rhythm is off, also turn on the Month rhythm preview. The page reloads when you toggle it."

## 7. Upkeep touch points (mgb-ui-upkeep)

Hidden build: draft now, publish at launch.

- Staff guide: a new draft article `docs/staff-guide/review-board.md` (help key `review-board`). At launch, sync with a targeted `UPDATE staff_guide SET body_md = …`. Never write body_plain; it is generated.
- Tours (components/tour/Tour.jsx): an admin tour step for the Work › Review board tab, plus `data-tour` on the table, filters and expander. No bookkeeper/temp-admin/client tour changes, because they cannot see it.
- Tips: components/tour/Tips.jsx + docs/staff-guide/tips.md, with one admin tip on the chips. Re-point any tip that targets Work tabs.
- Staff ? menu: a "Review board" entry for admins on that page. Client CLIENT_HelpButton: no change.
- README.md (month-rhythm paragraphs: one line on the board and digest) and docs/staff-guide/whats-new.md (draft entry).
- Dev Tools:
  - bump `window.MGB_VERSION` (label `2026-11-0Xa`);
  - INFRA_LINKS: add the cron job `review-board-digest`;
  - resettableLocalStorageKeys + readAllMygoodbooksStorage get the 3 keys;
  - FEATURE_FLAGS, the switch rows, PAGE_META;
  - docs admin-insight.md.
- Launch kit: a next-visit notice + walkthrough in components/tour/announcements.js (pattern :160-167), dated at launch, admins only.
- Marketing text: none.
- Grep after the build that no visible string says "Desk" on the board, that "colour" appears nowhere new, and that every new `data-tour`/tip target exists.

## 8. Test plan

- **SQL** (each -tests.sql rolls back; run via the deploy skill's apply flow, not ad hoc against production data):
  - switch keys (2);
  - rb_board access matrix + data shape + internal rule + `by`/`auto` from tk_activity (3a);
  - rb_draft_recipients: admin ok; bookkeeper on their own client → 42501; temp admin → 42501; anon no execute; contacts carry no `notes` key;
  - digest idempotency/gates/duplicate recipients/test mode (4a);
  - rb_email_sent guard: a bookkeeper on their own client can mark; on another client gets 42501; anon has no execute; a task whose template has no email_kind → 'rb_not_email_task'.
- **Node** (`node components/staff/RB_logic.test.js`, plus the existing `TK_emailDraft.test.js` and `WB_peek.test.js` still pass; a small `RB_gate` test):
  - every chip table row, including Unassigned and missing history;
  - part labels from a custom rhythm (e.g. day 15) and from a missing setting;
  - sort stability and direction for each column;
  - each filter option;
  - RB_isOn truth table; RB_on false for non-admin, for View as, and with a stale cache for a non-admin;
  - mailto: ampersand, non-ASCII, newline (`%0D%0A`), a bad address dropped, `@` unencoded, and the >1800 fallback;
  - chip de-duplication and opted-out skip;
  - digest titles, including the "Test clients ·" prefix.
- **Browser**, signed in as a real admin with the Review board and Month rhythm previews on, `reviewboard_enabled` missing, and `month_rhythm_enabled` off:
  1. On a test client, run "Make due tasks now", then show test clients on the board. The 3 chips show open/late, and "No task yet" shows for others.
  2. Complete the check-in task. The chip shows done, by me, today.
  3. Sort every column and use each filter; open `#/work/review?period=` for an earlier month.
  4. Open the expander. The contact and logins show (production has almost no contact data yet; expect "Not set" on most rows).
  5. Open the reports-row draft. The To/Cc chips, Open in email app (check the mailto in the URL), and Mark sent all work, and the board chip shows the "marked sent" line.
  6. Turn the Review board flag off. The tab, the bell rows, the modal extras, and the CloseTracker link all disappear. A screenshot should match before.
  7. As a bookkeeper and as a temp admin: no tab, `#/work/review` falls back, no `tk_settings` read for `reviewboard_enabled` in the network log, no extras in the email draft, and rpc rb_board / rb_draft_recipients → 42501.
  8. View as a bookkeeper: no tab, no extras.
  9. Bell: the owner sets `reviewboard_digest_enabled` + list = Jesse while the rhythm is still off; the next 10:50 UTC run creates "Test clients ·" rows for the test client's tasks. Before that, check the render with a local stub of `rbApi.listDigests`.

## 9. Rollback

- UI: turn the preview flag off and leave the switch missing. That is byte-identical to before.
- Code revert: remove the RB_* files and their `__SOURCE_ORDER` entries, then revert the StaffNav/WorkPage/CloseTracker/TopBar/TK_EmailDraft/TK_api/app.jsx edits.
- SQL, in this order:
  1. `select cron.unschedule('review-board-digest'); drop function if exists rb_deadline_digest(date);`
  2. `delete from tk_rhythm_notices where kind='deadline_digest';`
  3. drop `tk_rhythm_notices_shape` and `tk_rhythm_notices_digest_uq`; restore the kind check to `(kind = 'second_preliminary')`; `set not null` on task_id and client_id; drop the part/counts/updated_at columns.
  4. `drop function if exists rb_mark_email_sent(uuid,int), rb_unmark_email_sent(uuid), rb_draft_recipients(uuid), rb_board(date), rb__require_admin(); drop table if exists rb_email_sent;`
  5. Recreate `tk__owner_only_key` without the 3 keys (re-read the live list first), and delete any rows for those keys (owner).

## 10. Open risks (numbered)

1. **Contacts at the table level.** Assigned bookkeepers can already read `client_users`, `client_contacts` and `client_org_profile` for their own clients through existing RLS. This build adds no new path for them: the board and the email extras use admin-only RPCs. If the owner meant "bookkeepers must not see client contacts anywhere", that is a bigger RLS change. Ask.
2. **The live `tk__owner_only_key` may change** before apply. Re-read it with pg_get_functiondef right before applying, or a key will be dropped.
3. **Contact data is nearly empty in production** (2026-11-05: 0 `client_org_profile` rows, 1 active client login, 4 `client_contacts` rows, 0 `client_profile.contact_email`). The Main contact column will read "Not set" for almost every client and To chips will usually be empty until data is filled in. Ask the owner where "Main contact" should come from and who fills it.
4. **Digest needs its own switch and the board.** The server cannot see the per-browser preview, so no digest rows exist until the owner sets `reviewboard_digest_enabled` + `reviewboard_digest_to`, and a recipient sees them only while the board is on for them (`RB_on()`). While the rhythm is off the digest counts test/internal clients only ("Test clients ·").
5. **The digest window** (due day to +9 days) and the once-a-day refresh are assumptions. Counts can lag up to 24h, and the board is live.
6. **Done "by" for older tasks.** Tasks closed before tk_activity existed, or with no activity row, show "Done · date" with no name.
7. **Unassigned rhythm tasks** show "Unassigned" (never the owner), matching the S8b rule.
8. **"Not needed"** relies on the rhythm cron writing actor 'system' when it auto-closes the follow-up. A staff member closing it by hand shows as "Done".
9. **WorkPage now passes isRealAdmin.** No existing work tab sets realAdmin today; re-check if one is added before this ships.
10. **mailto behavior varies** by email app. Outlook desktop has a lower URL limit (~2000), and the 1800 fallback covers it.
11. **Re-marking sent overwrites** the earlier sender/time (one row per task). Undo deletes it. There is no history.
12. **Not built, ask owner:** sending or scheduling from the portal, and the Approve column's meaning.

## Critique resolutions

Critique 2026-11-05 (Opus). Every issue below is fixed in the sections above unless marked "kept".

| # | Severity | Issue | Resolution |
|---|---|---|---|
| 1 | High | `rb_board` returned `staff_email` as the assignee and the spec said never to use `assignee_email`. That is the reverse of the S8b rule (TK_assigneeOf: null assignee = Unassigned, owner never stands in). | 3a returns `assignee` = `assignee_email`, `assignee_name`, and `owner` separately; 3b renders "Unassigned"; old risk 7 replaced. |
| 2 | High | `rb_board` is SECURITY DEFINER and bypassed the RESTRICTIVE internal-company lock, so any admin without `internal_access` would see the internal client's contacts and logins. | Added `and (not is_internal or can_view_internal())`; test added. |
| 3 | High | Email extras were gated on `RB_on()` only, which had no admin check, and read contacts via `tk_request_recipients` + a direct `client_org_profile` read. A bookkeeper with the preview flag (or after the firm switch) would see To chips: contacts not admin-only. | `RB_on()` now includes real admin + not View as (`RB_setViewer`). New admin-only definer RPC `rb_draft_recipients(p_task_id)` (client derived from the task, `can_access_client`, no contact notes). No direct table reads; `rb_*` never added to the View as allow-list. |
| 4 | High | Done "by" used `approved_by/submitted_by/status_changed_by`, all null on every live rhythm task; `auto` used a tk_comments row. | `by` = latest `tk_activity` status→done `actor_email`; `auto` = actor 'system'. Assignee fallback dropped. |
| 5 | Medium | Digest recipients not de-duplicated: a repeated email makes ON CONFLICT DO UPDATE touch one row twice and the run errors. | `select distinct lower(e)`; test added. |
| 6 | Medium | Digest counted only tasks due inside the window, so totals drifted as client-override dates entered/left it. | Window picks (part, period) pairs; counts cover all tasks of that pair. |
| 7 | Medium | Digest always excluded test clients, so it could not be tried with the rhythm off (no real client has rhythm tasks). | Mirrors the generator: real clients when `month_rhythm_enabled` is on, test/internal only while off; `counts.test` + "Test clients ·" prefix. |
| 8 | Medium | Parts and labels hard-coded "4th/14th/24th"; the firm days are owner-editable (`tk_settings.month_rhythm.parts`). | Part keys `check_in/reports/follow_up` (= `due_rule.part`); labels from the setting via `RB_partLabel`; shape check uses keys. |
| 9 | Medium | Top line and digest said "sent" for done tasks; "sent" is reserved for Mark sent. | "done"; done includes not needed. |
| 10 | Medium | `rb_mark_email_sent` took `p_kind` from the client. | Kind derived from `task_templates.email_kind`; null → 'rb_not_email_task'; `p_to_count` clamped. |
| 11 | Medium | Load order said "after WB_peek.js and before WorkPage.jsx", but WB_peek.js loads after WorkPage (`__SOURCE_ORDER` :778 vs :651). | Exact positions in section 6. |
| 12 | Medium | "Reuse the same View as check WB_peek uses": WB_peek has none. | `RB_viewingAs()` reads `window.mgbViewAs.on`; plus the `!impersonating` viewer flag. |
| 13 | Medium | Bell: `TB_useBellItems` has no `isRealAdmin`; items use `go:` not `href`; digest list had no age limit. | isRealAdmin threaded in; `go` function; `updated_at > now() - 14 days`. |
| 14 | Medium | `TK_useEmailKind` changed to `TK_rhythmEnabled() || RB_on()`: needless change to a shared gate. | Kept unchanged; testers use the existing Month rhythm preview. |
| 15 | Low | Spec said Copy email copies subject + body; it copies the body only. | Corrected. |
| 16 | Low | mailto encoded every address with encodeURIComponent (`%40` breaks some apps) and only `\n` handled. | Validate, insert unencoded; normalize to CRLF then encode. |
| 17 | Low | Bookkeeper column/filter source was unclear (RPC vs app). | `CT_bookkeeperKey`/`CT_bookkeeperOf` from app clients; RPC also returns name/test_only/is_internal. |
| 18 | Low | Expander showed only active logins. | All logins, inactive dimmed. |
| 19 | Low | Task pick could return duplicates. | `distinct on` template, `parent_id is null`, newest first. |
| 20 | Low | Rule 7 always said "waiting on client", but excused also covers a preliminary month. | Label by reason (`waiting`). |
| 21 | Low | Null `p_period` and the bell's `?period=` were unhandled. | `coalesce` to last month; page parses `?period=`. |
| 22 | Low | `create policy` not re-runnable; kind-check drop not written. | `drop policy/constraint if exists` first; live constraint name verified. |
| 23 | Low | Digest visibility depends on the board being on: not stated. | Stated in 4b and risk 4. |
| 24 | Low | The firm switch read ran for every staff member. | Only real admins read it (`RB_switchRead` after `RB_setViewer`). |
| 25 | Low | Rollback missed new functions; drops lacked signatures. | Full list with signatures and `if exists`. |
| 26 | Low (kept) | Mark sent RPC allows any staff with client access, while the button is admin-only. | Kept: no contact data is exposed by marking, and it keeps the table ready for bookkeepers later. |

**Owner decisions needed:** (a) where "Main contact" comes from, since production contact data is almost empty (risk 3); (b) whether bookkeepers should get the To/Cc chips later (admin-only now); (c) whether the digest counting test clients while the rhythm is off is fine; (d) sending/scheduling from the portal and the Approve column (unchanged).

### Verified facts (live DB, read-only, 2026-11-05; structure and counts only)

- `tk__owner_only_key`: live body = the 26-key repo list ending `desk_peek_enabled`; `language sql immutable`, `search_path = public`.
- `tk_rhythm_notices`: columns id, recipient_email, client_id NOT NULL, period, task_id NOT NULL, kind NOT NULL default 'second_preliminary', created_at. Constraints `tk_rhythm_notices_kind_check CHECK (kind = 'second_preliminary')`, period first-of-month check, lowercase recipient check, UNIQUE(task_id, recipient_email). Policy "tk rhythm notices own read" (SELECT, authenticated: `is_active_staff()` and recipient = lower jwt email). Grants: authenticated SELECT only. 0 rows.
- Month rhythm templates: `month_rhythm:1_check_in` … `month_rhythm:8_follow_up`; email_kind request on 2, reports on 6, maintenance on 7, null on the rest; `due_rule = {type: firm_part, part: check_in|reports|follow_up, month_offset: 1}`.
- `tk_settings.month_rhythm` = `{roll: "prev", parts: [{key, label, day}]}` with days 4/14/24; `month_rhythm_enabled` = false; no `reviewboard*` keys exist.
- Rhythm tasks: `staff_email = assignee_email` on generated rows; source 'template' with unique `source_ref`; `period_start` = P; due dates in P+1, weekend-rolled (e.g. 11-13 for a Saturday 14th); section "Check in" / "Send reports" / "Follow up". Status check allows todo, in_progress, waiting_client, ready_for_review, done. `status_changed_by`, `approved_by`, `submitted_by` are null on rhythm tasks; `status_changed_by` is null on 164 of 203 done tasks overall.
- `tk_activity` (id, task_id, actor_email, kind, from_value, to_value, meta, created_at; index (task_id, created_at)) records status→done with the real actor; the rhythm cron writes actor 'system'.
- `tk_rhythm_daily` auto-closes row 7 regardless of report state and row 8 only when not preliminary; needs no open client requests, due within the last 31 days, status todo/in_progress, and `(rhythm on or test_only or is_internal)`.
- `tk_late_excused` is true for waiting_client or a preliminary report month; `tk_report_state` states: none, preliminary, full.
- `tk__client_people` returns (role, email, name) for bookkeeper, backup, account_manager, reviewer; executable only by postgres/service_role; `tk_client_people` wrapper granted to authenticated. `tk_request_recipients` is definer, guarded by `tk__req_staff_guard`, and returns contact notes.
- RLS: `client_users`, `client_contacts` readable by staff via `can_access_client` plus a RESTRICTIVE internal-company lock; `client_org_profile` readable via `is_active_staff() and can_access_client` (no restrictive lock); `tk_settings` read for active staff, writes for admins with the owner-only trigger.
- `is_active_staff_admin()` requires `jwt_has_google()` + staff role 'admin' + active (temp admins fail). Internal clients also need `can_view_internal()` (admin + `internal_access` row).
- Contact data: 0 `client_org_profile` rows; 3 `client_users` rows (1 active); 4 `client_contacts`; 0 `client_profile.contact_email`; 0 `client_email_recipients`.
- Clients: 65 real current, 1 lost, 2 test_only, 1 internal; `lost_at` is a date.
- pg_cron 1.6.4: `month-rhythm-daily` at `40 10 * * *`, `task-templates-daily` at `15 10 * * *` (UTC); no `review-board-digest` job yet.

## Final RPC contract

Built and applied to production 2026-11-05 (migrations `reviewboard_1_owner_keys`, `reviewboard_2_board`, `reviewboard_3_digest`; files supabase/review-board-switch.sql, review-board.sql, review-board-digest.sql, each with a rolled-back -tests.sql, all green). This section overrides the SQL sketches above where they differ. Errors: `42501` (message `rb_forbidden` or `tk_forbidden`) = not allowed, render nothing; `P0002` `rb_not_found`; `22023` `rb_not_email_task`. Emails in results are lowercase. Dates are `YYYY-MM-DD`, timestamps ISO.

### `rpc('rb_board', { p_period })` → jsonb (real admins only)

`p_period`: any date in the month, or null = last month (America/Chicago). Bookkeepers, temp admins, clients, non-Google sessions, View as: 42501.

```
{ period: "2026-10-01", today: "2026-11-05",
  rhythm: {roll, parts:[{key,label,day}]} | null,            // tk_settings.month_rhythm
  clients: [ {                                               // current clients, sorted by name; test clients included;
                                                             // internal client only with internal_access
    client_id, name, test_only: bool, is_internal: bool,
    people:  [{role: "bookkeeper"|"backup", email, name}],   // [] when none
    contact: {name, email, phone, source: "profile"|"login"} | null,
             // profile = client_org_profile contact (name or email set);
             // else the first active client login (oldest), phone null; else null
    logins:  [{email, name, role, active: bool}],            // all logins, active first, then name
    report_state: "none"|"preliminary"|"full" | null,
    approve: null,                                           // reserved slot, nothing built
    tasks: [ {                                               // 0..3, one per part, sorted by part key
      part: "check_in"|"reports"|"follow_up", id: uuid, status,
      assignee: email|null,  assignee_name: string|null,     // null = Unassigned; never fall back to owner
      owner: email,                                          // row owner (tooltip only)
      due: date|null, completed_at: ts|null,
      by: email|"system"|null, by_name: string|null,         // latest tk_activity status/review_approved -> done
      auto: bool,                                            // by == "system" (Not needed)
      excused: bool, waiting: bool,
      sent: {by, by_name, at} | null } ] } ] }
```

### `rpc('rb_draft_recipients', { p_task_id })` → jsonb

Access (owner decision 2026-11-05, loosened from the spec's admin-only): anyone who can read these contacts today, i.e. active Google-signed-in staff with `can_access_client` on the task's client (admins: all clients; internal client only with internal_access); temp admins count only for their own clients. Clients and everyone else: 42501. Unknown/deleted task: P0002. The UI still shows the extras only when `RB_on()`.

```
{ client_id,
  contact:  {name, email, phone, source: "profile"|"login"} | null,   // same rule as rb_board
  contacts: [{name, email, role, can_answer: bool}],                  // client_contacts, not deleted, can_answer first; never notes
  logins:   [{name, email, opted_out: bool}],                         // active client logins only, by name
  staff:    [{role: "bookkeeper"|"account_manager", email, name}],
  sent:     {by, by_name, at} | null }                                // added by review-board-sent-read.sql (review 2026-11-05)
```

The `sent` key lets a reopened draft show "Marked sent by <you or name> · <day>, <time>" with Undo, and keeps Mark sent disabled.

### `rpc('rb_mark_email_sent', { p_task_id, p_to_count })` → `{task_id, kind, to_count, by, at}`

Active staff with access to the task's client (42501 otherwise). Kind comes from the template's `email_kind` (null → 22023 `rb_not_email_task`). `p_to_count` clamped 0..50. Re-marking overwrites by/at. Nothing is sent.

### `rpc('rb_unmark_email_sent', { p_task_id })` → void

Same guard; deletes the marker.

### Table reads

- `rb_email_sent` (task_id, client_id, kind, to_count, sent_by, sent_at): select only, staff with client access. The board already embeds it as `tasks[].sent`.
- Digest rows: `from('tk_rhythm_notices').select('id, period, part, counts, created_at, updated_at').eq('kind','deadline_digest').gt('updated_at', <now - 14 days>).order('updated_at', {ascending:false}).limit(6)`. RLS returns only the signed-in recipient's rows. `counts` = `{total, done, not_needed, open, test_tasks, test}`: done includes not_needed; `test_tasks` = tasks on test/internal clients; `test` = true when every counted task is on a test/internal client (use it for the "Test clients ·" prefix). Owner decision 2026-11-05: the digest counts every rhythm task, test and internal clients included, whether or not `month_rhythm_enabled` is on (replaces the generator-mirroring rule in 4a).
- The existing second-preliminary loader must add `.neq('kind','deadline_digest')` (4b).

### Server-only

`rb_deadline_digest(p_today date)` (cron `review-board-digest`, `50 10 * * *` UTC; not callable by authenticated/anon), `rb__require_admin()`, `rb__main_contact(text)`. Owner-only switch keys added to `tk__owner_only_key`: `reviewboard_enabled`, `reviewboard_digest_enabled`, `reviewboard_digest_to`; no rows inserted.

### Deviations from the sketches above

- Done "by" also reads `tk_activity.kind = 'review_approved'` (ready_for_review → done is logged under that kind, not 'status'), so approved tasks show the approver.
- `client_contacts.can_answer_requests` (not `can_answer`) and `deleted_at`; `client_email_recipients.opted_out_at` (no boolean). Output keys stay `can_answer` / `opted_out`.
- `rb_draft_recipients` access widened to today's contact readers (see above), not admin-only. `contact` has `phone` and `source`.
- Digest: no generator client rule (owner decision); `counts` gains `test_tasks`; `test` means "all counted tasks are test/internal".
