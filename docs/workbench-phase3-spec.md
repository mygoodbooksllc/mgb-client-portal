# Workbench (Tasks Phase 3): one staff inbox, spec

Status: DRAFT for owner decision, 2026-10-15. Nothing is built, applied or committed.
Name: "Workbench" is a working name. It lives in ONE constant (`WB_NAME` in `components/workbench/WB_logic.js`), and every label, nav entry, tour step and guide title reads it. A rename then costs one constant plus a guide sweep.
Size: **Big change.** Opus writes the spec, builds, critiques and verifies. Sonnet runs the guide/README sweep. Haiku runs the checks (node tests, grep, 760px screenshots).
Depends on Phase 2 (`docs/tasks-phase2-spec.md`). Live `tk_schema_version()` = **5**, so S1-S4 are live. S5 (`client_requests`), S7 (OOO) and S9 (Close fold) are still being built. Where a slice needs one of them, this spec says so.

## A. Goals and non-goals

**Goals**
1. **One prioritized list** of everything a staff member must act on, drawn from four sources:
   - tasks and reviews
   - client messages that need a reply
   - ledger (GL) review work
   - client documents that need filing or a check
2. **Grouped Overdue / Today / This week.** Each row shows: source label, title, client, due-or-waiting text, and ONE primary action.
3. **Filter chips per source, with counts.** "Mine" is the default view. Admins get an "Everyone" toggle. Out-of-office coverage rows appear with a "Covering for …" tag.
4. **Read-only over the sources.** No source data is copied. The only new state is small:
   - per-user snooze/clear
   - a firm-wide "no reply needed" marker
   - a firm-wide "file checked" marker
5. **Fast and safe.** One RPC call per refresh. It finishes in under 150 ms at 100 clients. The list respects `can_access_client` exactly as the source screens do.

**Non-goals (this phase)**
- **Replacing Messages (StaffInbox), Documents, or Ledger review.** These stay the full working screens; Workbench links into them (see E).
- **New emails, outbox kinds, digests or push notifications** (see G). The daily digest from the Tasks brief stays a later item.
- **Board, Calendar views, Automations, dashboards.** These remain Tasks Phase 3+ items, tracked separately.
- **Writing to QBO or Drive.** QBO stays read-only. Moving or retyping files in Drive needs a new drive-files action and is deferred (K-Q5).
- **The client-facing Workbench.** It is outlined in section L only.

## B. Data design

### B1. Sources and the "needs you" rule

The RPC returns one row per actionable item. Each row has a stable key, `item_key = source || ':' || kind || ':' || source_id`.

| kind | source | Table(s) read | Appears when | source_id | version (for snooze) |
|---|---|---|---|---|---|
| `task` | task | `staff_reminders` | not done, not deleted, `status in (todo, in_progress)`, due ≤ today+7 or no due + created ≥ 14d ago | task id | `status‖due_date` |
| `task_review` | review | `staff_reminders` | `status = ready_for_review` | task id | `updated_at` |
| `task_sent_back` | review | `staff_reminders` + `tk_activity` | last review event = sent_back, status back to in_progress | task id | activity id |
| `client_answered` | task | `client_requests` (**S5**) | request `answered`, not accepted | request id | `answered_at` |
| `message` | message | `client_messages`, `client_message_reads`, `wb_thread_noreply` | newest public, non-deleted message in (client, participant) is from the client and not covered by a no-reply marker | id of FIRST client msg of the waiting run | last client msg id |
| `gl_flags` | gl | `gl_review_flags`, `gl_review_signoffs` | open high/medium flags for (client, period) and signoff not `reviewed`/`approved` | `client_id‖period` | open count |
| `gl_approve` | gl | `gl_review_signoffs` | status `reviewed` (admin/reviewer only) | `client_id‖period` | `reviewed_at` |
| `gl_sent_back` | gl | `gl_review_signoffs` | status `sent_back` | `client_id‖period` | `sent_back_at` |
| `gl_answer` | gl | `transaction_questions` | `direction = staff_asked`, status `answered` | question id | `answered_at` |
| `doc_upload` | doc | `client_files`, `client_file_checks` | client upload (uploader not active staff), `visibility = shared`, not trashed, uploaded ≥ `wb.doc_check_from` setting, no live check row | file id | file id |
| `doc_request` | doc | `client_doc_requests` (→ `client_requests` after S5) | status `uploaded` | request id | `updated_at` |

**Why the message key uses the first message of the waiting run.** Each new run of client messages after a staff reply gets a new key. A snooze or clear on an old run never hides a new question.

**Per-flag rows are deliberately absent.** At about 30 flags per client-month, per-flag rows would bury everything else. Instead, one row per (client, period) shows counts, for example "12 open (3 high)".

**Today's other kinds stay out of the RPC in this phase:**
- deadlines
- close blocked
- bills
- quarterly reviews
- handbook
- upgrades
- health
- coverage gaps
- stale SOPs
- access requests
- profile

Today already computes these client-side. They arrive as source `other` in W3 (see E1), so nothing Today shows today is lost.

### B2. "Mine", covered, everyone

- **Task rows are mine** when `coalesce(assignee_email, staff_email) = me`.
- **Review rows are mine** when `reviewer_email = me`. When `reviewer_email` is null and I am an admin, the row lands in an "Any admin" sub-tag. This matches `TK_ReviewQueue`.
- **Client-level rows** (message, gl, doc) are mine when I am the client's assigned bookkeeper (`tk_client_people` role `bookkeeper`).
  - `gl_approve` is mine when I am the client's reviewer (`client_profile.reviewer_email`), or an admin when no reviewer is set.
- **Covered:** the assigned bookkeeper has a `staff_time_off` row covering today, and I am `client_profile.backup_bookkeeper_email`. The row gets `covered_for = <their email>`.
  - Task rows reassigned by S7 `tk_apply_ooo` are simply "mine" once S7 lands. Before S7, coverage applies to client-level rows only.
- **Everyone** (admin only): every row the admin can access, with `owner_email` shown.
- **Unassigned:** a client with no bookkeeper. Its rows go to admins under "Unassigned" rather than vanishing.

### B3. RPC

```sql
create or replace function public.wb_inbox(
  p_scope   text   default 'mine',      -- 'mine' | 'everyone'
  p_sources text[] default null         -- null = all of task, review, message, gl, doc
) returns table (
  item_key text, source text, kind text, source_id text, version text,
  client_id uuid, client_name text, period text,          -- period 'YYYY-MM' for gl rows
  title text, detail text,                                -- detail ≤ 120 chars, no attachment names
  owner_email text, covered_for text, any_admin boolean,
  due_date date, waiting_since timestamptz,
  severity text, item_count int, status text,
  snoozed_until timestamptz, cleared boolean
) language plpgsql stable security definer set search_path = public
```

- **Access guard.** It raises `42501` unless `is_active_staff()`. Clients never get a row. `p_scope = 'everyone'` raises 42501 unless `is_active_staff_admin()`.
- **Per-row filter.** Every row is filtered by `can_access_client(client_id)`. Task rows also go through `tk_row_readable`, so internal clients obey `can_view_internal()` exactly as they do today.
- **Excluded clients.** Test and demo clients use the same exclusion Today uses: `clients.is_test` / `CF_excludedIds`. W1 confirms the column and mirrors it server-side.
- **Snooze and clear.** These are joined from `wb_item_state` for `auth.email()`.
  - A row with `snoozed_until > now()` AND `snoozed_version = version` is returned with `snoozed_until` set; the client hides it unless the Snoozed chip is on.
  - A changed version un-snoozes the row automatically.
- **Performance.** The function returns facts only. Ranking and grouping are done in `WB_logic.js` (pure and testable).
- **Grants.** `revoke all on function … from public, anon`, then `grant execute … to authenticated`.

**Write RPCs** (all `security definer`, staff-only, `can_access_client` checked, idempotent):

| RPC | Effect |
|---|---|
| `wb_snooze(p_item_key text, p_version text, p_until timestamptz)` | upsert own `wb_item_state`; `p_until` capped at now()+30d |
| `wb_unsnooze(p_item_key text)` | sets `snoozed_until = null` |
| `wb_mark_no_reply(p_message_id uuid)` | inserts `wb_thread_noreply` through that message (must be the latest client message of the thread) |
| `wb_undo_no_reply(p_id uuid)` | sets `undone_at/undone_by` (soft) |
| `wb_mark_file_checked(p_file_id uuid, p_note text default null)` | inserts `client_file_checks` |
| `wb_undo_file_checked(p_id uuid)` | soft undo |
| `wb_schema_version()` | returns 1-n as slices land (same pattern as `tk_schema_version`) |

### B4. New tables

All three tables follow the same rules:
- They start with `revoke all on … from anon, authenticated`, because `pg_default_acl` would otherwise grant everything.
- RLS is enabled with explicit policies, and none of them allows delete.
- Rows are soft-undone, never deleted.
- The SQL is re-runnable (`create table if not exists`, `drop policy if exists`, `create or replace`).
- No PII is seeded.

```sql
-- per-user, private
create table if not exists public.wb_item_state (
  staff_email     text not null default lower(auth.email()),
  item_key        text not null check (length(item_key) <= 200),
  snoozed_until   timestamptz,
  snoozed_version text,
  cleared_at      timestamptz,          -- reserved for "Done for me" on other-source rows
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (staff_email, item_key)
);
-- guard trigger stamps staff_email := lower(auth.email()) on insert/update (cannot be spoofed)
-- RLS: select/insert/update where staff_email = lower(auth.email()) and is_active_staff(); no delete

-- firm-wide, one row per "no reply needed" decision
create table if not exists public.wb_thread_noreply (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  participant_email text not null,
  through_message_id uuid not null references public.client_messages(id),
  through_at timestamptz not null,
  reason text not null check (reason in ('no_reply_needed','auto_ack')),
  marked_by text not null, marked_at timestamptz not null default now(),
  undone_at timestamptz, undone_by text
);
-- RLS: staff select where can_access_client(client_id); writes only via RPCs

create table if not exists public.client_file_checks (
  id uuid primary key default gen_random_uuid(),
  client_file_id uuid not null references public.client_files(id),
  checked_by text not null, checked_at timestamptz not null default now(),
  note text check (length(note) <= 500),
  undone_at timestamptz, undone_by text
);
create unique index if not exists client_file_checks_live_uq
  on public.client_file_checks (client_file_id) where undone_at is null;
-- RLS: staff select via the file's client and can_access_client; writes only via RPCs
```

### B5. Clear-on-read (messages)

The owner wants messages that need no reply to clear once read. Clearing every read message is unsafe, because opening a thread is not the same as answering it. The rule is two-tier:

1. **Acknowledgement-only runs clear on read.** Every client message in the waiting run must meet all of these:
   - ≤ 60 chars
   - contains no `?`
   - has no attachment
   - matches `WB_ACK_RE` (thanks / thank you / ok / okay / got it / sounds good / perfect / great / 👍; case-insensitive, whole-message)

   Such a run clears when any staff `client_message_reads.last_read_at` ≥ the last client message. The RPC computes this live, so nothing is stored. The pattern lives in SQL and is mirrored in `WB_logic.js` with tests.
2. **Everything else clears** when staff reply, or when someone presses **No reply needed** (Workbench row or the Messages thread header). This writes `wb_thread_noreply`, which is firm-wide, so the backup does not see an item the owner already closed.

A new client message after the marker opens a new run, and with it a new item.
- **Owner question K-Q2:** should `client_reply_times` (the 24h SLA report) end a wait at a no-reply marker? Recommended default: **yes**, ending the wait at `marked_at`, with the reason shown in the report.

### B6. Due and age

| kind | due_date | waiting_since |
|---|---|---|
| task, task_sent_back | `due_date` | `created_at` |
| task_review | `coalesce(due_date, review_requested_at + 2 business days)` | `review_requested_at` (S3 activity) |
| message | `first_client_msg_at + 1 business day` (24h goal, matches `client_reply_times`) | first client msg |
| gl_flags | business day N of the month after `period` (`wb.gl_due_bday`, default 10, via the S2 business-day helper) | oldest open flag `created_at` |
| gl_approve / gl_sent_back | `reviewed_at` / `sent_back_at` + 2 business days | same stamp |
| gl_answer, client_answered | `answered_at + 1 business day` | `answered_at` |
| doc_upload, doc_request | `uploaded_at + 2 business days` | `uploaded_at` |

### B7. Indexes (W1, all `create index if not exists`, built concurrently by hand if any table is large)

- `client_messages_wb_public_idx on client_messages (client_id, participant_email, created_at desc) where deleted_at is null and internal = false`
- `gl_review_flags_wb_open_idx on gl_review_flags (client_id, period) include (severity) where status = 'open'`
- `client_files_wb_shared_idx on client_files (client_id, uploaded_at) where trashed_at is null and visibility = 'shared'`
- `client_doc_requests_wb_uploaded_idx on client_doc_requests (client_id) where status = 'uploaded'`
- `staff_reminders`: the existing `tk_assignee_idx`, `staff_open_idx`, `reviewer_status_idx` and `in_review_idx` already cover task reads. No new index.

### B8. Performance at realistic counts

**Live today (prelaunch):**

| Table | Rows |
|---|---|
| clients | 3 |
| active staff | 9 |
| client_messages | 2 |
| open tasks | 0 |
| gl_review_flags (all open; 66 high) | 440 |
| client_files | 1 |
| client_doc_requests | 3 |

**Projection at 100 clients:**

| Table | Rows |
|---|---|
| staff_reminders | about 7k/yr (about 600 open) |
| client_messages | about 20k/yr |
| gl_review_flags | about 36k/yr (about 3k open at month-end) |
| client_files | about 5k/yr |

**What one call reads:**
- Messages: one `distinct on (client_id, participant_email)` over the partial index, about 300 threads.
- GL: one grouped scan over open flags, about 3k rows.
- Tasks: index range scans.

The target is under 150 ms with `explain analyze`, checked in W1 on seeded synthetic rows inside a rolled-back transaction (no live writes). If the target is missed, the fallback is to materialize per-thread "last message" into a small trigger-maintained table. This is not planned unless measured.

### B9. RLS per role

| Role | wb_inbox | wb_item_state | wb_thread_noreply / client_file_checks |
|---|---|---|---|
| Bookkeeper | own + covered rows; only clients passing `can_access_client` (assignment, approved grant incl. coverage grant) | own rows only | read for accessible clients; write via RPC |
| Admin | mine by default; `everyone` = all accessible | own rows only | same |
| Temp admin / view-as | follows `is_active_staff_admin()` as it does today; view-as reuses the viewer's JWT, so it shows the viewer's own rows (K-Q6) | own | same |
| Client | RPC raises 42501 | no access | no access |
| anon | no execute | revoked | revoked |

## C. Priority and grouping algorithm (`WB_logic.js`, pure, node-tested)

1. **Drop hidden rows:** snoozed rows (unless the Snoozed chip is on) and rows failing the source filter.
2. **Assign a group** using `today` in the firm's timezone (`America/Chicago` constant, matching TK):
   - **Overdue:** `due_date < today`.
   - **Today:** `due_date = today`, OR waiting rows with no due date older than 1 business day.
   - **This week:** `due_date ≤ today + WB_SOON_DAYS` (7, the same value as `TD_SOON_DAYS`/`TK_SOON_DAYS`).
   - **Later rows** are not shown. The footer reads "N more later → My Tasks".
3. **Rank within a group.** Lower sorts first:
   - **0, blocks someone else:** task_review, gl_approve, client_answered, gl_answer.
   - **1, client is waiting on us:** message, doc_request, doc_upload.
   - **2, work sent back to me:** task_sent_back, gl_sent_back.
   - **3, own work:** task, gl_flags with high > 0.
   - **4:** gl_flags medium-only.
4. **Tiebreak:** `due_date` asc, then `waiting_since` asc, then `client_name`, then `item_key`. The order is deterministic, so rows never jump around on refresh.
5. **Covered rows** sort with their peers and carry a tag. They are not a separate group.
6. **Chip counts** are computed after step 1 and before the source filter, so every chip shows its true count.

Tests (`WB_logic.test.js`, same style as `TK_logic.test.js`):
- group boundaries across a weekend
- version-change un-snooze
- the ack regex, both positive and negative
- rank ordering
- deterministic sort
- no-due fallbacks
- chip counts

## D. UI

### D1. Screen

Route `#/today` keeps its slug (bookmarks, PWA start URL, `PAGE_META.today`). The page header shows `WB_NAME`.

Layout, top to bottom:
1. **Greeting line and four KPI tiles.** Kept from Today. Tiles become: Needs reply · Due today · Overdue · Reviews waiting. Clicking a tile sets the matching chip.
2. **Toolbar:**
   - Source chips with counts: All · Tasks · Reviews · Messages · Ledger · Documents · Other. A Snoozed chip appears only when count > 0.
   - Scope toggle "Mine / Everyone", shown to admins only.
   - Refresh-age text ("Updated 1 min ago").
3. **Groups** Overdue / Today / This week, each with a sticky header and count. Empty groups are hidden.
4. **Row:** `[source pill] Title · Client · due/waiting text  [Covering for Ann] [Primary button] [⋯]`.
   - Detail (message preview or flag counts) shows as a second muted line.
5. **Optional cards** (Reminders, Milestones, Recently viewed) stay below the list under `user_settings.todayCards`.

**Components** (new folder `components/workbench/`, prefix `WB_`, registered in `window.__SOURCE_ORDER` after TK files and before `Today.jsx`, one CSS file `WB.css` using design tokens):
- `WB_logic.js`: constants, `WB_NAME`, grouping, ack regex
- `WB_store.js`: fetch, cache, realtime, events
- `WB_Page.jsx`
- `WB_Row.jsx`
- `WB_Chips.jsx`
- `WB_SnoozeMenu.jsx`
- `WB_QuickReply.jsx` (W7, optional)

**States:**
- **Loading:** skeleton of 5 rows.
- **Empty (all clear):** "Nothing needs you right now", plus links to My Tasks and Messages.
- **Filtered empty:** "No <source> items. Show all".
- **Error:** an inline banner with Retry, while the last good list is kept.
- **Schema not live yet** (`wb_schema_version` missing): Today's current list renders unchanged. This is the rollout safety net.
- **Offline:** cached list plus an "Offline" pill.

### D2. Actions per kind (one primary button; the rest go in ⋯)

| kind | Primary | Lands at / does | ⋯ menu |
|---|---|---|---|
| task (todo) | **Start** | inline `tk_set_status(in_progress)`, row stays, button becomes Open | Open, Snooze |
| task (in_progress), task_sent_back | **Open** | task drawer via `LK_go({place:'work',tab:'tasks',item:'task:'+id})` | Snooze |
| task_review | **Review** | `#/tasks/review` drawer for that task (`item:'task:'+id`) | Snooze |
| client_answered (S5) | **Review** | `ClientNeeds` `#/client/<id>/needs/<reqId>` | Open task, Snooze |
| message | **Reply** | Messages thread: `LK_go({clientId, tab:'messages', item:'msg:'+lastId}, {email})`, email as in-memory hint only | No reply needed, Snooze, (W7) Quick reply |
| gl_flags, gl_sent_back | **Review** | `LK_go({clientId, tab:'ledger', month: period})` | Snooze |
| gl_approve | **Review** | same ledger link; approve stays on that screen | Snooze |
| gl_answer | **Review** | ledger with `item:'question:'+id` | Snooze |
| doc_upload | **File** | client Files tab `item:'file:'+id` (rename/folder in Drive there) | Mark checked, Snooze |
| doc_request | **Review** | client Requests: `item:'docreq:'+id` (after S5 `ClientNeeds`) | Snooze |
| other (Today kinds) | its existing action | unchanged | none |

Snooze choices: Later today (3h), Tomorrow 8am, Next Monday 8am, Pick date (up to 30d). Every write gives an Undo toast (5s).

### D3. Phone and 760px

- At ≤760px the toolbar chips scroll horizontally and the scope toggle moves into a ⋯ sheet.
- Rows stack in two lines: line 1 has the pill and title, line 2 has client · due · primary button.
- The ⋯ menu opens as a bottom sheet, and every target is at least 44px.
- KPI tiles become a 2×2 grid.
- Haiku screenshots at 760px and 375px on `basic-test` and `grace-community` for every UI slice.

### D4. Keyboard (only when focus is in the list; ignored in inputs)

| Key | Action |
|---|---|
| `j` / `k` | next / previous row |
| `Enter` | primary action |
| `o` | open in its home screen |
| `s` | snooze menu |
| `e` | "No reply needed" (message) or "Mark checked" (doc_upload) |
| `1`-`6` | chips |
| `0` | All |
| `?` | shortcut sheet |

These reuse `TK_bindListKeys` patterns and avoid `q`, `x`, `a` and `t`, which keep their TK meanings in the drawer.

## E. Relation to existing screens, migration and nav

### E1. What merges and what coexists

> **Workbench does NOT replace the Messages inbox (`StaffInbox`, `#/inbox`, and each client's Messages tab).** Messages stays the place to read and reply to whole conversations. In Workbench a client message appears only as a "needs reply" item. Its **Reply** button deep-links into that conversation in Messages. An inline quick reply is an optional later slice (W7), and is safe only under the limits in D2/W7.

The same coexist-and-deep-link rule applies to two more screens:
- **Documents** (client Files tab, Document requests, later `ClientNeeds`): Workbench shows "needs filing/check" rows and links there. Filing, renaming and trashing happen only on the Documents screens.
- **Ledger review** (`#/client/<id>/ledger`, Work › Ledger review): Workbench shows one row per client-month and links there. Clearing, asking about, fixing, signing off and approving flags happen only on the Ledger screens.

**Only Today and My Tasks are candidates to merge or replace:**

| Screen | Decision |
|---|---|
| **Today** (`Today.jsx` "Needs you" list) | **Replaced in place** by Workbench at the same route. The greeting, tiles and optional cards are kept. Today's extra row kinds (deadlines, close blocked, bills, reviews, handbook, upgrades, health, coverage gaps, SOPs, access, profile) are fed in as source `other` by adapting `TD_*` builders into WB rows. Nothing Today shows today is lost. |
| **My Tasks** (`TK_MyTasks`) | **Kept** as the full task manager: Later, Waiting, Done, projects, bulk edit. Workbench shows only actionable windows (≤ 7 days) and links to My Tasks via the "N more later" footer. No merge in this phase (K-Q3). |
| Review queue `#/tasks/review` | Kept; Workbench Review rows open it. |
| Messages, Documents, Ledger review | Kept; deep-link targets (above). |
| Top-bar bell | Kept; see G. |

### E2. Migration plan

1. **W3 ships behind `wb.enabled`** (an `app_settings` flag, default off) plus a per-user `localStorage` opt-in `mgb_wb_preview`. Admins try it for one week while Today's list stays the default.
2. **The owner flips `wb.enabled`.** Workbench becomes the Today list for everyone. The old list code stays reachable for one release through Dev Tools "Classic Today", then W8 deletes it.
3. **No data migration** is needed (read-only design). Snooze state starts empty.

### E3. Nav changes

- **`NAV_PLACES.today`**: label → `WB_NAME`, blurb "Everything that needs you, in order". The slug stays `today`.
- **Rail badge** = Overdue + Today count from `WB_store`. The rail, phone drawer, ⌘K and tour all read `NAV_PLACES`, so one change covers them.
- **Messages keeps its own rail badge** (waiting threads).
- **No new place.** This is so the rail does not grow.

## F. Realtime and refresh

`WB_store` is a single shared store, so the page, rail badge and tiles all read one fetch.

- **Realtime channels:**
  - `client_messages` INSERT/UPDATE (already in the publication)
  - `staff_reminders` UPDATE (added in W1 if not already published; check `pg_publication_tables`)

  Each change triggers a **debounced refetch (1.5s)** rather than a client-side patch, so RLS and logic stay server-authoritative.
- **Window events** also trigger a refetch:
  - `mgb:client-messages-changed` (StaffInbox)
  - `mgb:tasks-changed` (TK)
  - `mgb:gl-review-changed`
  - `mgb:files-changed`

  Emitters are added where missing (GL and Files).
- **Polling:** a 2-minute poll fallback (`TD_REFRESH_MS`), paused while the tab is hidden, plus a refetch on focus.
- **Optimistic writes:** Start, Snooze and No-reply update the store immediately and roll back on error.
- **Cross-window sync:** a `BroadcastChannel('mgb-wb')` keeps a popped-out Tasks window and the portal in step.

## G. Notifications (no new emails)

- **No new outbox kinds, emails or digests.** Existing kinds stay as they are: `staff_client_message`, `staff_doc_upload`, `staff_task_assigned`, and the S3 review kinds.
- **Snooze never suppresses an email.** It is a view preference only.
- **"No reply needed"** does not email the client.
- **Bell:** it keeps its four sources. Optionally (W6) its message and document counts read `WB_store`, so the bell and Workbench never disagree. Its seen-state stays in localStorage.
- **Email links:** links in existing emails keep their targets. A Workbench link may be added to the staff email footer later; that needs owner approval and is not in scope.

## H. Analytics (repo convention: `MGB_track(name, detail)` → `usage_events` kind 'action')

| Event | detail | When |
|---|---|---|
| `wb-action` | `<kind>:<action>` e.g. `message:reply`, `task:start` | primary or menu action |
| `wb-snooze` | `<kind>:<preset>` | snooze set |
| `wb-noreply` | `manual` / `undo` | marker written or undone |
| `wb-filter` | chip id | chip change |
| `wb-scope` | `mine` / `everyone` | admin toggle |
| `wb-quickreply` | `sent` / `opened-full` | W7 only |

- **Page views** are automatic per page.
- **Usage Stats:** `usage_summary` already groups by action name, so it needs no RPC change. W6 adds "Workbench actions" to the Usage Stats action legend.
- **Privacy:** `detail` carries no IDs, emails or text.

## I. Upkeep checklist (every UI slice, in the same commit)

- [ ] **Staff guide.** New `docs/staff-guide/workbench.md`. Update these articles:
  - `home-page.md` (Today becomes Workbench)
  - `inbox.md` ("Workbench links here; No reply needed button")
  - `my-tasks.md`
  - `task-review.md`
  - `ledger-review.md`
  - `document-requests.md`
  - `google-drive-files.md`
  - `time-off-coverage.md`
  - `top-bar.md`
  - `tips.md`

  Run `node docs/staff-guide/sync.mjs --check`, then generate and apply the guide SQL.
- [ ] **Tour.** Re-point `TOUR_staffTour` Today steps (`data-tour` `today-kpis`, `today-list`, `today-cards`) to the WB anchors `wb-tiles`, `wb-chips`, `wb-list` and `wb-row-action`. Add a short `workbenchTour` (4 steps).
- [ ] **Tips.** In `Tips.jsx`, re-point Today tip targets, and add tips for "Snooze" and "No reply needed".
- [ ] **Help menus.** The ? menu on the page links to the guide article and tour.
- [ ] **README.** Add the `components/workbench/` folder, `WB_` prefix, load order and the `wb_*` SQL files.
- [ ] **What's new** entry.
- [ ] **Dev Tools:**
  - bump `window.MGB_VERSION` (index.html)
  - `PAGE_META.today` title and blurb
  - flags list gets `wb.enabled`, `wb.gl_due_bday` and `wb.doc_check_from`
  - reset keys get `mgb_wb_*`
  - add a "Classic Today" toggle until W8
- [ ] **Launch announcement.** `ANN_REGISTRY` entry `workbench-launch`: roles staff, hash `#/today`, steps = `workbenchTour`. It is shown on the next visit after `wb.enabled` flips.
- [ ] **Memory note** updated after each slice ships.

## J. Slices (each independently committable; per-slice routine from Phase 2)

**Per-slice routine:**
1. Opus builds.
2. Opus critique (fresh agent, reads the diff and this spec).
3. Haiku checks: `node` tests, grep for leftover `TD_` anchors, 760px and 375px screenshots on `basic-test` and `grace-community`.
4. Apply SQL twice with `apply_migration` (proves it re-runs).
5. `get_advisors` (security and performance) is clean.
6. Commit to main and push.

**Usage:** Phase 2 slices ran about 1-2% of the weekly cap each. The estimates below include critique and checks.

| # | Slice | Files | Verify | Needs | Est. weekly % |
|---|---|---|---|---|---|
| W1 | SQL core: 3 tables, `wb_inbox` (task, review, message, gl, doc_request kinds), snooze RPCs, indexes, `wb_schema_version`=1 | `supabase/workbench-1-core.sql` | Run twice; advisors; RLS probes as bookkeeper, admin, client (42501), anon; `explain analyze` on synthetic rows in rolled-back txn <150 ms | S3 live ✓ | 2.0 |
| W2 | `WB_logic.js` + tests (grouping, rank, ack regex, snooze version, chip counts), `WB_NAME` | `components/workbench/WB_logic.js`, `WB_logic.test.js` | `node WB_logic.test.js` green; SQL ack regex vs JS parity cases | W1 | 1.0 |
| W3 | UI: `WB_store`, `WB_Page`, `WB_Row`, `WB_Chips`, `WB_SnoozeMenu`, CSS; Today list swapped behind `wb.enabled`; Today extras adapted as `other`; keyboard | `components/workbench/*`, `Today.jsx`, `index.html` (`__SOURCE_ORDER`), `WB.css` | Screenshots 1440/760/375; every primary action lands on the right screen; flag-off = old Today unchanged; guide/tour/tips per I (behind flag) | W2 | 2.5 |
| W4 | Messages: clear-on-read ack rule + `wb_mark_no_reply`/undo + "No reply needed" button in StaffInbox thread header; `client_reply_times` change if K-Q2 = yes | `supabase/workbench-2-messages.sql`, `StaffInbox.jsx`, `WB_Row.jsx` | Ack thread clears after read; question thread does not; new message reopens; SLA report numbers before/after | W3 | 1.5 |
| W5 | Documents + GL extras: `client_file_checks` RPCs, `doc_upload` kind, `gl_answer`, `gl_sent_back`, due rule settings; GL/Files change events | `supabase/workbench-3-docs-gl.sql`, `WB_*`, Files + Ledger components (event emit only) | Upload as client in `basic-test` → row; Mark checked → gone for backup too; GL counts match Ledger screen | W3 | 1.5 |
| W6 | Nav + launch: `NAV_PLACES` label/badge, bell reads store, announcement, What's new, Dev Tools, README, guide final pass (Sonnet), flip-ready | `StaffNav.jsx`, `TopBar.jsx`, `announcements.js`, `Tour.jsx`, `Tips.jsx`, docs | Guide `--check` clean; tour runs on desktop + phone; announcement shows once | W4, W5 | 1.5 |
| W7 | (Optional) Inline quick reply: last 5 public messages + composer reusing StaffInbox send path; "Open full conversation" always visible | `WB_QuickReply.jsx`, small export from `StaffInbox.jsx` | Sends land in thread, realtime updates Messages; internal notes never shown to client; attachments → "Open in Messages" | W6, owner yes on K-Q4 | 1.0 |
| W8 | Final verify + remove Classic Today; S5/S7 hooks switched on (`client_answered`, `client_requests` docs, OOO-reassigned tasks) | `Today.jsx` cleanup, `workbench-4-s5.sql` | Full role matrix walk; advisors; usage events visible in Usage Stats | S5, S7 live | 1.0 |

**Total: about 11-12% of the weekly cap** (W1-W6 about 10%; W7-W8 about 2%). Spread it over two days to stay under the 85% cap at the 12%/day pace.

**Ordering note:** W1-W6 do not need S5-S10. W8 waits for S5 and S7. If S9 (Close fold) lands first, "close blocked" moves from `other` into the RPC in W8.

## K. Risks and owner questions

**Risks**

| Risk | Mitigation |
|---|---|
| Workbench and Messages disagree on "waiting" | Same rule in SQL as `SI_`/`TD_` (newest public non-deleted from client); W4 parity test on the same thread set |
| GL flag volume swamps the list | Per client-month aggregation; only high/medium open; due on business day N |
| Clear-on-read hides a real question | Ack rule is narrow (no `?`, ≤60 chars, whole-message match); everything else needs reply or explicit marker; marker is undoable |
| Coverage leaks data | Rows are always filtered by `can_access_client`; covered rows only show where a coverage grant/assignment already exists |
| Slow RPC at scale | Partial indexes, measured in W1; fallback described in B8 |
| Losing Today features on swap | `other` source adapts every Today kind; flag + Classic Today for one release |
| Phase 2 builder conflicts (S5-S10 touching TK files) | WB lives in its own folder; only `Today.jsx`, `StaffNav.jsx`, `TopBar.jsx`, `StaffInbox.jsx` header shared, each slice rebases on main first |

**Owner questions (recommended default in bold)**

| # | Question | Default |
|---|---|---|
| Q1 | Final name? Candidates: Workbench, My Work, Today | **Keep "Workbench" until launch; one constant** |
| Q2 | Should "No reply needed" stop the 24h reply-time clock? | **Yes, ends at the marker, labelled in report** |
| Q3 | Merge My Tasks into Workbench later? | **No: My Tasks stays the full manager; Workbench is the action window** |
| Q4 | Inline quick reply in Workbench (W7)? | **Yes, text-only, last 5 messages, with "Open full conversation"** |
| Q5 | Add a Drive "move/retype" action so File can finish in place? | **Later (needs drive-files edge change); File opens the Files tab for now** |
| Q6 | In view-as-bookkeeper, should Workbench show that bookkeeper's rows? | **Not in this phase; follows the planned "View as" project** |
| Q7 | GL due day: business day N of the following month | **N = 10** |
| Q8 | Should backups see covered rows only on time-off days, or always? | **Only during an active `staff_time_off`** |
| Q9 | Admin default scope | **Mine, with Everyone one click away (remembered per user)** |
| Q10 | Should snooze be capped? | **30 days max; resurfaces early if the item changes** |

## L. Later: client-facing Workbench (outline only)

The client-facing Workbench comes after the staff Workbench ships and S5 is live. It is a client-portal page (client nav place, `#/home` card plus its own tab) with three panels:

1. **Close progress.** Months from `month_close` / S2 periods show open → in review → closed, with a plain-language status ("We're reconciling September"). It reads only the period status and dates. No internal notes, flags or staff names beyond the bookkeeper.
2. **What we need from you.** Open `client_requests` (S5) with upload and reply, which is the S5 `ClientNeeds` list. Workbench embeds it rather than rebuilding it.
3. **Recently finished.** A feed of the last 30 days from `client_sent_items` (reports and packets sent) and client-visible `tk_activity` events (for example "September close completed"), allow-listed by event type.

**Data:** a definer RPC `wb_client_home(p_client_id)`, which checks `is_client_member(p_client_id)` and returns only allow-listed fields. No staff tables are exposed directly. RLS stays deny-by-default for clients.
**UI:** same `WB_` row component in a client skin, phone-first, with no keyboard layer and no snooze.
**Notifications:** none new. S6 nudges cover requests.
**Estimate:** about 3-4% weekly over two slices (RPC+tests, then UI+guide/client tour).
**Owner questions for then:** whether to show close percentage; whether "recently finished" shows staff names; whether to show it to all client members or only the primary contact.

## Addendum 2026-10-16: bottom drawer (owner approved)

Workbench also appears as a drawer that slides up from the bottom of every staff page. Collapsed: a 44px bar with the count, the next item and a "Press W" hint. Open: a 360px panel over the page with a scrim; tabs All / Tasks / Reviews / Messages / Files; Mine / Everyone toggle (admins); rows grouped Overdue / Today / This week with one quick action each (Approve, Reply, Open). It reads from the same `wb_inbox` function as the Today page, so there is one data path.

Decisions: the drawer and the full-page Today both stay (drawer for quick triage, Today for deep work); `W` toggles the drawer and Esc closes it; phones get a full-height sheet instead of the 360px panel; the client-facing drawer is a later, separate slice. Build the drawer as its own slice after W1 to W3 (data function, ranking, Today page), behind `wb.enabled`.
