# Thread menu: spec (staff side only)

Status: SPEC rev 2 (critique folded in), 2026-10-25. Base: origin/main c19e7b4.
Big change (DB + permissions): Opus spec/build/critique/verify.
Gate (house pattern, section 6): `TM_isOn = !viewAsReadOnly && (previewOn || switchOn)`.
A thread = (client_id, participant_email) in public.client_messages. Starter set only: Rename, Hide/Restore,
Reassign, Mark done/Reopen, Snooze, Pin, Create task, Copy link. The brief's "NOT in this build" list stays out.

## 1. What exists today (file:line, c19e7b4)

Messages page list (components/inbox/StaffInbox.jsx)
- `StaffInbox` 1267 (props include compact, lockClientId, sampleThreads); state 1294-1319 (mode
  loading|real|sample, filter all/clients/team, query, clientFilter, sel).
- `loadRecent` 1341-1387: one `Promise.all` of client_messages (in client ids, deleted_at null, desc,
  limit 1500) + client_message_reads (reader_email = me). Realtime 1398-1423: private channel
  `si-inbox-${me}-${instance}` on client_messages, INSERT bumps / UPDATE patches.
- `clientEntries` 1426-1504 (kind, key, client, clientId, email, userId, name, role, lastAt, preview,
  waiting, waitingSince, unread). Key = `siPersonKey` 193 = `c:${clientId}:${email}`.
- `matches`/`inClientScope`/`byRecent`/`listed` 1525-1538. `openEntry` 1572-1581. `counts` 1640.
- Deep-link arrival `LK_useArrival` 1583-1625 (finds the message id, toasts `LK_COPY.threadGone`).
- Desk "No reply needed" button 1642-1664. Filter chips 1727-1745 (All/Clients/Team, shown only when
  teamEnabled). List 1761-1812: `<li><button className="si-item" onClick=openEntry>` (avatar, name, time,
  `si-tag` tags, preview, `si-waiting`, `si-dot`). Thread head 1823-1851.
- Client side (`SI_useClientMessaging` 2084+, channel `client-msgs-<email>` ~2350) reads client_messages only.

Desk Inbox (components/workbench)
- `WB_Row.jsx`: `WB_keyBlocked` 43-59 (open menu = `.wb-menu, .tk-menu[role='menu']`), `WB_SnoozeMenu`
  62-109, `WB_RowMenu` 112-148 (items from `WB_hubMenu`/`WB_menuActions` + an extra Unsnooze button),
  `WB_Row` 151-287 (`.wb-more` button, Esc closes and refocuses). Message rows come from rpc `wb_inbox`
  (supabase/workbench-1-core.sql 302-351; owner = client's assigned bookkeeper; cleared by a
  wb_thread_noreply marker at or after the latest client message).
- `WB_logic.js`: `WB_hubMenu` 848-862, `WB_menuActions` 917-927, `WB_linkTarget` 939-962 (message link
  `{ t:{clientId, tab:"messages", item:"msg:"+id}, hint:{email} }` at 958), `WB_snoozeUntil` 1005,
  `WB_SNOOZE_PRESETS` 1023, `WB_SNOOZE_MAX_DAYS = 30` line 21.
- `WB_plus.js` (176 lines): resolver template (`WB_plusIsOn` 56-59, one cached switch read, event).
- `wb_mark_no_reply` workbench-1-core.sql 526-562 (idempotency check 552-557), `wb_undo_no_reply` 564-584.

Menu to reuse: `TK_IxMenu` components/tasks/TK_SlateIx.jsx 210-334 (portal, viewport clamp, first-item
focus, capture Esc/pointerdown/scroll/resize/blur close, ArrowUp/Down wrap, ArrowLeft back; classes
`tk-menu tk-ix-menu`, `tk-menu-item tk-ix-item`, `tk-ix-sep`, `tk-ix-hint`; no Home/End).
CSS tk-slate.css 558-580, tk-views.css 294-340. Dialogs: `ModalShell` app.jsx 25289 (focus trap + restore).

Tasks: `TK_api.create` components/tasks/TK_api.js ~543-578 inserts staff_reminders (prod columns id uuid,
client_id text, created_by text, staff_email, source text, source_ref text). Visibility rule 567-568:
client + no project -> "private". Precedent `makeTaskFromNote` app.jsx 21598-21620. `TK_openTask(id)`
TK_Drawer.jsx 463. staff_reminders.source has no check constraint.

Deep links: components/staff/DeepLink.jsx `LK_href` 129-154, kind `msg` 27-30; rule 1-20: never emails,
names or free text in URLs. View as: `MGB_viewAsReadOnly()` (used guarded, e.g. LR_Tab.jsx 334).

Prod facts (checked 2026-10-25): no thread assignee/reassign concept exists (closest:
`client_message_loop_in`, which notifies the assigned bookkeeper), so Reassign sends no notification.
Helpers: `is_active_staff()`, `is_active_staff_admin()`, `can_access_client(text)`,
`tk_staff_has_client(p_email, p_client)`, `tk_assignable_staff(p_client, p_project)` -> (email, name, role,
can_see). clients.id is text. client_messages has a RESTRICTIVE "internal company lock" policy
(`client_id <> all (select internal_blocked_ids())`). Realtime publication `supabase_realtime` contains
client_messages and client_message_reads; clients can subscribe to client_messages (RLS-filtered to their
own non-internal rows), so nothing here may write client_messages. tk__owner_only_key = the 15 keys in
supabase/owner-only-deskplus-switch.sql. No `threadmenu_enabled` row exists.

## 2. Data model (supabase/thread-menu.sql, additive only)

```
create table if not exists public.client_thread_state (
  client_id         text not null references public.clients(id) on delete cascade,
  participant_email text not null check (participant_email = lower(trim(participant_email))
                                         and char_length(participant_email) <= 320),
  label             text check (label is null or char_length(label) between 1 and 80),
  hidden_at timestamptz, hidden_by text,
  done_at   timestamptz, done_by   text,
  done_marker_id uuid,             -- wb_thread_noreply row THIS feature inserted (Done or Hide)
  snoozed_until timestamptz, snoozed_at timestamptz, snoozed_by text,
  pinned_at timestamptz, pinned_by text,
  assignee_email text,
  updated_at timestamptz not null default now(), updated_by text,
  primary key (client_id, participant_email));
create table if not exists public.client_thread_audit (          -- no FK: survives client deletion
  id uuid primary key default gen_random_uuid(),
  client_id text not null, participant_email text not null,
  action text not null check (action in ('label','hide','restore','done','reopen','snooze','unsnooze',
                                        'pin','unpin','assign','task')),
  from_value jsonb, to_value jsonb, marker_id uuid,   -- marker_id set when the action inserted a marker
  actor_email text not null, at timestamptz not null default now());
create index if not exists client_thread_audit_thread_idx
  on public.client_thread_audit (client_id, participant_email, at desc);
create index if not exists client_thread_audit_marker_idx
  on public.client_thread_audit (marker_id) where marker_id is not null;
```
- Firm-wide shared state, one row per thread, created lazily by the first RPC write. Last write wins.
- Both tables: RLS on; `revoke all ... from public, anon, authenticated`; `grant select on
  client_thread_state to authenticated`. Policies on client_thread_state:
  `cts_staff_read` permissive select using `(select public.is_active_staff()) and
  public.can_access_client(client_id)`; `cts_internal_lock` RESTRICTIVE for all using
  `client_id <> all ((select public.internal_blocked_ids())::text[])` (parity with client_messages).
  Audit: no grant, no policy (RPC-only; admins read it in SQL; history view out of scope).
- No client policy, no insert/update/delete policy, not in any publication, no trigger on client_messages,
  no edge function reads either table.

## 3. RPCs (all `language plpgsql security definer set search_path = public`; revoke execute from
public, anon; grant execute to authenticated)

Private helpers (revoke execute from public, anon, authenticated; only called by the RPCs):
- `thread__guard(p_client_id text, p_email text) returns text` -> returns `v_email := lower(trim(p_email))`.
  Raises 42501 `not_staff` unless `v_me <> ''` and `public.is_active_staff()`; 42501 `no_client_access`
  unless `public.can_access_client(p_client_id)`; 22023 `bad_email` if v_email = '' or length > 320;
  22023 `no_thread` unless a client_messages row exists with that client_id and participant_email = v_email
  (equality, no ilike).
- `thread__mark_no_reply(p_client_id text, p_email text) returns uuid` (marker id inserted by THIS call,
  else null): pick the latest client message `author_kind='client' and internal=false and deleted_at is null`
  (order created_at desc, id desc). None -> return null. If a non-undone wb_thread_noreply row already has
  `through_message_id = v_msg.id` -> return null (idempotent like 552-557, and we do not claim it).
  Else insert (client_id, participant_email, through_message_id, through_at, reason, marked_by) copied
  verbatim from v_msg (`v_msg.participant_email`, `v_msg.id`, `v_msg.created_at`), reason 'no_reply_needed',
  marked_by v_me; return the new id.

Each public write: `v_email := thread__guard(...)`, upsert the state row, set updated_at/by, insert ONE
audit row, return the state row (`returns public.client_thread_state`). State is read directly (no list RPC).

| RPC | Who | Notes |
|---|---|---|
| `thread_set_label(p_client_id text, p_email text, p_label text)` | staff w/ access | strip control chars and newlines (`regexp_replace(p_label, '[[:cntrl:]]', ' ', 'g')`), collapse spaces, trim; '' or null clears; > 80 -> 22023 `bad_label` |
| `thread_hide(p_client_id text, p_email text)` | staff w/ access | hidden_at = now(), hidden_by; `m := thread__mark_no_reply`; if m not null and done_marker_id is null -> done_marker_id = m; audit.marker_id = m. Re-hiding a woken thread restamps hidden_at. |
| `thread_restore(p_client_id text, p_email text)` | admin: guard (incl. can_access_client) + `is_active_staff_admin()` else 42501 `admin_only` | clears hidden_*; does not undo markers |
| `thread_set_done(p_client_id text, p_email text, p_done boolean)` | staff w/ access | true: done_at/by, marker as in Hide (set done_marker_id only when m not null). false: clear done_*; if done_marker_id set and that marker is not undone, set its undone_at/undone_by (as wb_undo_no_reply 564-584); null done_marker_id |
| `thread_snooze(p_client_id text, p_email text, p_until timestamptz)` | staff w/ access | null = unsnooze; else p_until > now() and <= now() + 30 days (WB_SNOOZE_MAX_DAYS) else 22023 `bad_snooze`; sets snoozed_at = now() |
| `thread_set_pin(p_client_id text, p_email text, p_pinned boolean)` | staff w/ access | |
| `thread_assign(p_client_id text, p_email text, p_assignee text)` | staff w/ access | null/'' clears; else `lower(trim())`, must match `staff.email` with `staff.active` AND `tk_staff_has_client(v_assignee, p_client_id)` else 22023 `bad_assignee`. No notification, no Desk ownership change. |
| `thread_log_task(p_client_id text, p_email text, p_task_id uuid)` | staff w/ access | requires a staff_reminders row with id = p_task_id, client_id = p_client_id, lower(created_by) = v_me, else 22023 `bad_task`; audit action 'task', to_value {task_id} |

Hard rules for every RPC: never write client_messages, client_message_reads, notification_outbox, or any
client-readable table; the only cross-table write is wb_thread_noreply (staff-only, already exists).

## 4. Behavior rules (client UI never changes)

New additive entry field in clientEntries (built only from rows loadRecent already has):
`lastClientAt` = created_at of the newest client message with `author_kind==='client' && !internal`.
`clientAfter(ts)` = `lastClientAt && ts && lastClientAt > ts` (browser-computed; no DB trigger).
`TM_threadView(entry, state, now, isAdmin)` in TM_logic.js -> { hidden, wokeHidden, done, snoozed, pinned,
label, assignee, tags[] }:
- hidden = hidden_at && !clientAfter(hidden_at). wokeHidden = hidden_at && clientAfter(hidden_at): row is
  back in the default list with a "Hidden" tag until an admin restores (or someone re-hides, restamping).
- done = done_at && !clientAfter(done_at) (auto-reopen view-side; row keeps done_at for audit).
- snoozed = snoozed_until > now && !clientAfter(snoozed_at). Wakes early on a client message: YES, so a
  client's new message is never buried by a staff snooze.
- Re-evaluation: when the gate is on and any snoozed row exists, a timer fires at the earliest
  snoozed_until (capped to a 60 s tick) and recomputes `now`; cleared on unmount.
- Unread: hide/done/snooze never change unread counts or `si-dot` (the badge still counts a hidden
  thread's unread messages; this divergence goes in the guide). The feature never writes
  client_message_reads.

Where filtering applies (S7): only the full Messages page (`!lockClientId && !compact`). The client's
Messages tab (lockClientId) and the compact drawer show the menu and tags but filter and re-sort nothing.
On the full page with the gate on:
- All / Clients: exclude hidden, done, snoozed; pinned first (pinned_at desc), then byRecent. Team chip and
  team entries are untouched (no menu, no tags, no handlers).
- New chips after Team: "Done", "Snoozed", "Hidden" (admins only); each lists only that set, byRecent.
  The chip group renders when `teamEnabled || tmOn` (gate off: unchanged condition).
- Counts: all/clients count only visible (non-filtered) client rows; Done/Snoozed/Hidden show their set sizes.
- Search: `matches` also checks label. While the query is non-empty, done and snoozed rows are included
  (with tags); hidden rows only for admins (wokeHidden always included).
- Arrival (deep link) into a filtered-out thread switches the filter to All and shows it with its tag;
  hidden threads still open for anyone with access (the link is explicit).
- Label: row title = label; preview becomes "Name: preview". Thread head shows label + name.
- Tags (si-tag): "Pinned", "Snoozed until Tue 8am" (formatted America/Chicago), "Done", "Hidden",
  "Assigned: First name".
- After Hide/Done/Snooze removes the focused row: focus the next row, else the previous, else the list.
- Refetch thread state on own writes (`mgb:thread-state-changed`), on the existing realtime INSERT bump
  (debounced 1 s), and on `visibilitychange`(visible)/window `focus`. Last write wins.

## 5. Menu

Messages page items (order; `—` = separator): Rename… | Pin to top / Unpin | Mark done / Reopen |
Snooze ▸ (Tomorrow 8am, Next Monday 8am, Pick a date…, plus Unsnooze when snoozed) — Reassign… |
Create task — Copy link — Hide (non-hidden or wokeHidden) / Restore (admin, when hidden_at is set).
Not shown when `entry.lastAt == null` or `mode === "sample"`; never on team rows.
Role matrix: bookkeeper on own client = all except Restore; admin = all; staff without access = no rows
(RLS) and server refuses; clients = never mounted (staff components only). View as = gate off (section 6).
Desk Inbox items (message rows only): Rename…, Mark done / Reopen, Reassign…, Create task, Copy link,
Hide / Restore. No Snooze or Pin (Desk has its own per-person Snooze and its own order).

Snooze times: `WB_snoozeUntil("tomorrow"|"monday"|"date", now, pick)` (WB_logic.js 1005, Chicago 8am).
Pick a date: `<input type="date">` min tomorrow, max today + 30 days.
Dialogs (Rename, Reassign, Pick a date) reuse `ModalShell` (app.jsx 25289; guarded
`typeof ModalShell === "function"`). Reassign list = `rpc tk_assignable_staff(p_client, null)` filtered
`can_see`, plus "Unassigned".
Feedback: toast with Undo for Done/Snooze/Pin (Undo calls the inverse RPC). Hide toast: "Thread hidden. An
admin can restore it." with Undo only for admins. Errors: plain toast, local state unchanged.

Keyboard / a11y contract (new `TM_Menu` = TK_IxMenu contract + Home/End):
- Open: right-click on `.si-item` (preventDefault only when the gate is on); visible, tabbable "⋯" button
  `.si-more` as a sibling of the row button inside the `<li>` (no nested buttons), `aria-label="Thread
  actions for <name>"`, aria-haspopup="menu", aria-expanded; `onKeyDown` on the row button handles Shift+F10
  and the ContextMenu key with preventDefault. `open()` is idempotent (a second trigger does not stack a
  menu). `onContextMenu` with `clientX===0 && clientY===0` (keyboard origin) positions under the ⋯ button,
  else at the pointer. Mac users without a ContextMenu key use the tabbable ⋯.
- `role="menu"` with aria-label; `role="menuitem"`; Snooze trigger aria-haspopup="menu". ArrowUp/Down wrap,
  Home/End, ArrowRight/Enter opens Snooze, ArrowLeft/Esc closes the submenu, Esc/Tab closes the menu,
  Enter/Space activates. Menu Esc calls preventDefault + stopPropagation so the drawer/modal does not close.
  Focus returns to the trigger on close.
- Classes `tk-menu tk-ix-menu` + `tm-menu`, so `WB_keyBlocked` and Tips blockers (`[role='menu']`,
  Tips.jsx 144) already treat it as open. `.tm-menu` z-index above the chat drawer and ModalShell.
- ⋯ shows on row hover/focus-within, always under `@media (hover: none)`.

Desk wiring (S9): `WB_menuActions` and `WB_hubMenu` stay pure and untouched. When gated:
- `WB_Row` for `row.kind === "message"` adds onContextMenu + Shift+F10/ContextMenu, opening the same
  `TM_Menu` with the Desk item set.
- Touch/visible path: `WB_RowMenu` renders one extra gated button "Thread actions…" for message rows
  (same pattern as its existing extra Unsnooze button, 131-145), which closes the Desk menu and opens
  `TM_Menu` anchored to the row's `.wb-more`. Chosen because it adds no second ⋯ button to Desk rows.
- Desk vs Messages divergences (for the guide): no Snooze/Pin on Desk; Desk rows are not filtered by
  thread state (wb_inbox untouched), Hide/Done clear them only through the no-reply marker; Reopen brings a
  Desk row back only if the marker came from this feature; labels show only on the Messages page.

Copy link: `location.origin + location.pathname + LK_href({ clientId, tab: "messages", item: "msg:" +
latestMessageId })` (target shape as WB_logic.js 958, no email/hint). `navigator.clipboard.writeText` with a
textarea + `document.execCommand("copy")` fallback, then a toast.

Create task: `TK_api.create({ text: "Reply to " + (label || name) + " (" + clientName + ")" cut to 140,
client_id, assignee_email: me, source: "thread", source_ref: latestMessageId,
description: "From the message thread with <name>.\n" + copyLink })` with NO visibility field (-> private,
TK_api.js 567-568), then `thread_log_task(...)`, toast "Task created", `TK_openTask(id)`. QuickAdd untouched.

## 6. Gate (one resolver)

New components/inbox/TM_gate.js, a copy of WB_plus.js with keys `mgb_threadmenu_preview`, cache
`mgb_threadmenu_cache`, event `mgb:threadmenu`, switch key `threadmenu_enabled`. Exports
`TM_switchValue(v)`, pure `TM_isOn(viewAsRO, previewOn, switchValue)` =
`!viewAsRO && (previewOn === true || TM_switchValue(switchValue))`, `TM_readSwitch(force)` (one cached
tk_settings read per page load, staff only, same retry rules as WB_plusReadSwitch), `TM_threadMenuOn()`,
hook `TM_useThreadMenu()`; module.exports for node. viewAsRO = `typeof MGB_viewAsReadOnly === "function" &&
MGB_viewAsReadOnly()`. Every gated spot uses only `TM_useThreadMenu()` (Desk: `&& deskOn`). Hooks are called
unconditionally; components early-return. Cross-file calls guarded with `typeof X === "function"`.
- app.jsx FEATURE_FLAGS after mgb_deskplus_preview (996-1002): `{ key: "mgb_threadmenu_preview", label:
  "Thread menu preview", description: "Turns on for you only, in this browser, while the firm-wide
  threadmenu_enabled switch is off, the client message thread menu: right-click or ⋯ on a thread to rename,
  pin, mark done, snooze, reassign, hide, make a task or copy a link. Staff only; clients never see it and
  nothing emails anyone. Off in View as. The page reloads when you toggle it.", reloads: true }`.
- Dev Tools settings row next to deskplus_enabled (~15649): `threadmenu_enabled`, "Message thread menu for
  all staff (owner only). Off = only people with the Thread menu preview flag see it."
- Reset-keys comment (14105-14125): add mgb_threadmenu_preview, mgb_threadmenu_cache.
- supabase/owner-only-threadmenu-switch.sql + -tests.sql: exact copy of the deskplus pair; list = the 15 live
  keys + 'threadmenu_enabled' (builder re-reads prod `pg_get_functiondef` first). No row inserted.

## 7. Files

New: components/inbox/TM_gate.js, TM_gate.test.js, TM_logic.js, TM_logic.test.js, TM_ThreadMenu.jsx
(TM_Menu, TM_RenameDialog, TM_AssignDialog, TM_DateDialog, TM_store: state map by siPersonKey, RPC
wrappers, `mgb:thread-state-changed`), components/inbox/thread-menu.css; supabase/thread-menu.sql,
thread-menu-tests.sql, owner-only-threadmenu-switch.sql, owner-only-threadmenu-switch-tests.sql;
docs/staff-guide/drafts/thread-menu.md, supabase/staff-guide-thread-menu.sql (not applied).
Edited (small, localized): StaffInbox.jsx, WB_Row.jsx (gated only; WB_logic.js untouched), index.html
(TM_gate.js + TM_logic.js before StaffInbox.jsx, TM_ThreadMenu.jsx right after it, one css link;
MGB_VERSION held), app.jsx (FEATURE_FLAGS, settings row, reset-keys comment), announcements.js, Tour.jsx,
Tips.jsx, drafts/whats-new.md, README.md.

StaffInbox wiring (all behind `const tmOn = TM_useThreadMenu()`):
- loadRecent: when tmOn, a separate `sb.from("client_thread_state").select(TM_COLS).in("client_id", ids)`
  runs in parallel with (not inside) the existing Promise.all, into `tmState`; the Promise.all array is
  byte-identical. Errors -> tmState {} (feature degrades to no tags, list unfiltered).
- `listed`: when tmOn and full page, `TM_filterSort(entries, tmState, filterId, query, now, isAdmin)`;
  else exactly today's code.
- Row: when tmOn, onContextMenu, onKeyDown (Shift+F10/ContextMenu), ⋯ sibling, tags.

## 8. Upkeep (written in this build, held until launch)

- Guide draft + guide SQL (not applied), incl. the Desk vs Messages divergences and the unread note.
- Launch notice in announcements.js gated by the firm switch (pattern ANN_deskPlusLaunchOn 127-135) and
  never shown in View as; tour stop on `inbox-list` (Tour.jsx ~1099) only when TM_threadMenuOn(); tip
  `inbox-thread-menu` (Tips.jsx 313-335 group) same gate; What's new draft entry.
- README: components/inbox list (84), Inbox section (819), launch checklist like Desk additions (2717) with
  the owner override snippet; Supabase SQL note app.jsx 1197-1201.
- No new page -> no PAGE_META. MGB_VERSION bump (re-read origin/main; next free label after 2026-10-25g)
  only at ship time.

## 9. Tests

Node (style WB_plus.test.js):
- TM_gate: truth table viewAsRO x previewOn x switch (true/"true"/1/{on:true}/false/null/undefined);
  View as forces off; one switch read per load (vm sandbox counts calls), cache + event, retry cap.
- TM_logic: lastClientAt ignores internal and staff rows; clientAfter wake rules for hidden/done/snoozed;
  wokeHidden shown with tag; default list excludes hidden/done/snoozed; pinned-first then byRecent, stable;
  Hidden chip admin-only; counts; search over label and inclusion rules; team entries untouched; no menu when
  lastAt null or sample; menu items per role/state (bookkeeper no Restore; Unsnooze only when snoozed; Desk
  set has no Snooze/Pin); snooze dates Chicago incl. DST edge and 30-day cap; next-timer computation;
  label sanitize/80 cap; task text 140 cap; copy link has no "@"; focus-next-row choice; gate off ->
  `TM_filterSort` not called and `WB_menuActions`/`WB_hubMenu` deep-equal to today's output.
SQL self-test supabase/thread-menu-tests.sql (`begin; ... rollback;`, helpers and `set local role
anon|authenticated` + `reset role` as in workbench-1-core-tests.sql 68-135):
- Fixtures inside the transaction: pick a real client id with a client member and a bookkeeper who has
  access (and one who does not) at runtime; insert client_messages rows (client-authored, staff-authored,
  one internal). Snapshot `count(*)` of notification_outbox and a hash of client_messages AFTER fixtures.
- anon: cannot select either table, cannot execute any RPC or helper. authenticated: cannot execute
  thread__guard / thread__mark_no_reply; cannot insert/update the state table directly.
- Client member: 42501 on every RPC, 0 rows from client_thread_state.
- Bookkeeper with access: label (control chars stripped; 81 chars -> 22023), hide, done, snooze (past and
  > 30 days -> 22023), pin, assign (inactive / no-access / non-staff assignee -> 22023; mixed case lowercased),
  log_task (someone else's task or wrong client -> 22023). Other client -> 42501. Restore -> 42501.
- Admin: restore OK. Every write adds exactly one audit row.
- Markers: Done inserts a wb_thread_noreply row copied from the latest client message and sets
  done_marker_id; a second Done or a Hide does not insert again; an existing Desk marker is not claimed
  (done_marker_id stays null, Reopen leaves it alone); Reopen undoes only its own marker.
- After all calls: notification_outbox count and client_messages hash unchanged; client_message_reads
  unchanged; `pg_publication_tables` has neither table. Ends with ROLLBACK.

## 10. Gate OFF = byte-for-byte checklist (verify stage greps/diffs these)

Gate off = preview flag off AND switch off, OR View as.
- [ ] loadRecent Promise.all array identical; no client_thread_state query. The only new request is the
      one cached tk_settings read of threadmenu_enabled per page load (staff only), as deskplus does.
- [ ] No onContextMenu / onKeyDown / ⋯ / extra tags on `.si-item`; browser right-click menu unchanged.
- [ ] Filter chips and their render condition identical; `listed`, counts and search exactly as today.
- [ ] No new timers or visibilitychange/focus listeners.
- [ ] Desk: WB_menuActions/WB_hubMenu untouched; WB_Row/WB_RowMenu render identical (no "Thread actions…").
- [ ] No announcement, tour stop, tip or guide text; CSS targets only new `.tm-*`/`.si-more` classes.
- [ ] Client app: no new query, channel or UI (TM files referenced only from staff components).

## 11. Rollback

1. Quick off: owner sets `threadmenu_enabled` to false (update, never delete the row); staff untick the
   preview flag. UI returns to today's behavior; state rows stay.
2. Server off: `revoke execute on function public.thread_set_label(...), thread_hide(...), ...
   from authenticated;` (all 8 public RPCs). Reads keep working, writes stop.
3. Desk markers made by this feature: list them with
   `select marker_id from client_thread_audit where marker_id is not null` joined to
   wb_thread_noreply where undone_at is null; undo individually via `wb_undo_no_reply(id)` as staff.
4. Never drop the tables or delete audit rows (additive-only rule).

## 12. Decided (owner confirmed via orchestrator)

Firm-wide state, last write wins. Any staff with access may Hide; only admins Restore and see the Hidden
chip. Snooze/Done/Hide wake on a new client message (browser-computed). Reassign = staff-side
"Assigned: Name" tag only: no notification, no Desk ownership change. Desk menu omits Snooze/Pin. Task is
private (TK_api default for a client task without project). Snooze max 30 days everywhere.
