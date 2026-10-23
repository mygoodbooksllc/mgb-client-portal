# View as: whole app (read-only) + admin "Last seen" — spec

Status: SPEC ONLY. Written 2026-10-15; **refreshed 2026-10-23 against origin/main 646d3ac** (worktree `wt-viewas2`). Nothing here is built. Opus critique applied and owner decisions Q1-Q6 folded in (see §8 and §9). **§10 (Drift addendum) wins wherever it disagrees with §1-§9.**
Line numbers in §1-§9 are from the 2026-10-15 checkout and have drifted by up to ~2,000 lines in app.jsx. Always find the code by the quoted **symbol** (e.g. `startImpersonating`, `effectivePage`, `StaffAccessPage`, `TP_TeamHub`), not the number. §10 numbers are from 646d3ac.

**Size and models.** **Big change** (permissions and security logic, 1 SQL file plus about 25 front-end files). Opus specs, builds the guard and SQL, critiques and does the final verify; Sonnet may build the placeholder and disabled-button UI pieces; Haiku runs the screenshot and console sweeps at low effort. Review and verify stages stay on: the owner prefers review over speed.

Owner rules this spec keeps:
- There is no super-admin tier.
- There is no true impersonation. The session, JWT and credentials always belong to the real admin.
- No private data is shown that an admin couldn't already read.
- Temporary admin access stays an app-side page flag. In SQL a temporary admin is still a bookkeeper.

---

## 1. Decisions (with why)

### D1. View as is read-only. All writes are blocked, not attributed.
The admin can look at everything the bookkeeper sees, and every save, send, tick, upload, sync or edge-function call is refused with a toast.

**Why not "allow, attributed to the admin":**
1. **Mixed stamping.** Some writes are stamped server-side from the JWT and would credit the admin. These include `stamp_author_from_jwt` (audit2-author-stamping.sql), `client_tools_stamp_author`, the staff_shoutouts guard, tk_comments, tk_attachments and client_messages `author_email`. Many others stamp client-side from the *effective* user and would credit the bookkeeper for something they never did:
   - `setCloseItem(..., staffUser.email)` app.jsx:6065
   - `addDocRequest` requested_by/requested_by_name app.jsx:6179, 8377
   - `saveProfile(..., staffUser.email)` app.jsx:7616
   - CloseTracker `updated_by` CloseTracker.jsx:568
   - ProReports `updated_by`/`created_by` ProReports.jsx:2048, 2291, 2644, 2810
   - ProBudget `changed_by = viewerEmail` ProBudget.jsx:1129, 1140
   - StaffOnboarding upsert `staff_email = me` StaffOnboarding.jsx:85
   - TechInventory `staff_email = me` TechInventory.jsx:230, 275, 306

   Fixing attribution means auditing about 40 write paths. Blocking them is one choke point.
2. **RLS already rejects some writes.** Others it rejects with confusing 42501 errors. Examples: `staffItemsApi.add` and `TK_api.create` require `staff_email = jwt`.
3. **Side effects are the real risk.** View as can trigger emails (client messages, doc chaser), QBO syncs, read-marker writes (`client_message_reads` upsert StaffInbox.jsx:378) and audit noise. A preview should change nothing.
4. **There is prior art.** `WD_sync.setPaused("view-as")` and `ST_store.setPaused("view-as")` (app.jsx:28244-28248) and the Settings `readOnlyReason` (29768-29783) already treat View as as read-only.

**Exceptions (allow-list):**
- The admin's own telemetry, all JWT-bound server-side: `usage_events`, `client_errors`, `log_audit_event` and `record_app_time` (the App time tracker's final flush when View as starts lands after `window.mgbViewAs` is set; without this the admin loses their own minutes and sees a toast on entering View as).
- Read-only RPCs on the §3.1a list.
- Auth token refresh, sign-out and `GET /auth/v1/user` only (not `PUT /auth/v1/user`, `/otp`, `/recover` or anything else under `/auth/v1/`).
- Three read-only `drive-files` actions (`status`, `list`, `link`), see §3.1.

**What the guard is and isn't.** It is a UX safety net that stops accidental writes and side effects. It is not a security boundary: the admin's JWT can always write through devtools, and RLS stays the real control. No rule in this spec may rely on the guard to keep data from the admin.

### D2. One guard at the network layer, plus visible hints
- **Guard.** `window.fetch` is wrapped once, early, so it covers every caller:
  - the supabase-js client (`slowNetworkFetch` calls global `fetch`, supabaseClient.js:27-28)
  - storage
  - `functions.invoke`
  - the raw `fetch` callers (re-grepped at 646d3ac, unchanged set): HB_api.js:134, DriveFiles.js:81, ClientEmailSettings.jsx:69, TeamReviews.jsx:56, AppTimeTracker.js:186, EmailsPage.jsx:175, DigestSettings.jsx:120. All but AppTimeTracker (`record_app_time`, allowed) and DriveFiles (three read actions) hit `/functions/v1/` and are blocked.
  - `functions.invoke` callers at 646d3ac: `qbo-sync` (3, app.jsx), `staff-auth`, `invite-client-user`, `qbo-firm-sync` (TeamQbo), `weekly-admin-digest` (DigestSettings), `qbo-gl-review` (LR_api, CloseTracker baseline after a Close tick), `gl-review-send` (LR_api), `tk-client-requests` (TK_api), `tech-inventory` export. All blocked; see §10.4 for the one that fires on page open.
- **Order matters.** The wrap must run before `createClient`. realtime-js resolves the global `fetch` once, when the client is built, and uses it for the REST broadcast fallback (`POST /realtime/v1/api/broadcast`, used when `channel.send` runs on an unjoined channel). A wrap installed later would miss it.
- **Realtime.** Websocket presence and typing (`channel.track` / `channel.send` on a joined channel, `useStaffTeamChat` presence and typing, app.jsx:16257 and 16320 at 646d3ac, still the only two call sites) don't go through fetch. They stay keyed to the real admin. Team chat (`useStaffTeamChat`) is never mounted in View as: the Inbox page shows a placeholder (D6) and the chat drawer is already gated by `!impersonating` (app.jsx:28371-28376). The HTTP broadcast fallback is caught by the default-deny rule (§3.1).
- **Not covered, by design:** navigations (`<a href>`, `window.open`, form posts) and new windows or tabs. A new tab opened during View as (for example the Tasks window, TK_keys.jsx:289) is the admin's ordinary app, not View as, because View as state isn't persisted. Navigations reachable in View as are Drive download links (`drive-files?t=`, read-only) and Storage signed URLs, both reads.
- **Blocked reads are silent.** Reads the guard denies on purpose (the deny list in §3.1a) return 403 with no toast and no audit row. Only write attempts toast and log. Otherwise opening Today or Team would toast "read-only" before the admin did anything.
- **Banner.** The existing preview bar (app.jsx:29220-29232) gets a line: "Read-only. Nothing you do here is saved."
- **Toast** on every blocked write, deduped to one per 4 s: "View as is read-only. Exit View as to make changes."
- **Disabled controls** where cheap. A `MGB_viewAsReadOnly()` helper lets composers, Save and Approve buttons show `disabled` with a `title`. The guard stays the safety net, so a missed button still can't write.

### D3. Approve on budgets (the reported gap)
**Cause.** ProBudget.jsx:845 reads `canApprove = staff ? staffUser.role === "admin" : acc.isFullAccess`. Under View as, the context `staffUser` is the bookkeeper (app.jsx:29046), so Approve is replaced by the "Only a MyGoodBooks admin…" line (1736). This faithfully matches a real bookkeeper: commit 70fac3c (2026-10-14) made approval admin or full-access only. The DB (`can_approve_client_budget()` → `is_active_staff_admin()` from the JWT) *would* accept the admin's approve, so the UI and the DB disagree.

**Fix (A), owner decision Q1.** Keep the bookkeeper view faithful and add a clear way out:
- When `viewingAsName` is set and the effective role can't approve, show the Approve button **disabled**, captioned "{First name} can't approve budgets."
- Next to it, add a link-button **"Exit View as to approve"**. It calls a new `stopImpersonating({ keepPage: true })`, so the admin lands on the same client budget as themselves with Approve live.
- This keeps D1 (no writes in View as) and fixes "admin doesn't see Approve".

**Alternative (B), rejected by the owner.** Show Approve enabled in View as and allow-list the approve write, attributed to the admin. This would break the "read-only" promise for one action.

### D4. Audit log
- `view_as.start` is logged already (app.jsx:27162).
- `view_as.stop` is logged only on the Exit button (27167). A reload, sign-out or tab close ends View as silently, because the state isn't persisted. Fix:
  - Log `view_as.stop` with `details.reason` set to `"exit" | "signout" | "pagehide"` from the Exit button, the sign-out handler and a `pagehide` listener.
  - pagehide uses a raw `fetch(rpcUrl, { method: "POST", keepalive: true, ... })` to `/rest/v1/rpc/log_audit_event` with an access token cached when View as starts (the AppTimeTracker.js pattern), not `sb.rpc`, which awaits `getSession()` and is cut off when the page unloads. It is still best-effort and the guide says so.
  - Sign-out **awaits** the stop log before calling `signOut()`; otherwise the JWT is gone before the RPC runs.
  - Add **`view_as.blocked`** (one per page per View as session, deduped client-side): `details = { target, page, kind: "rest|rpc|storage|function", name }`. This shows the owner what admins tried to change and tells us which read RPCs we wrongly blocked.
  - Both need the allow-list in `log_audit_event` widened (SQL §4.4), and §4.4 also makes every `view_as.*` action admin-only. Today any active staff member can write `view_as.start` rows naming anyone, which makes the audit trail forgeable.
- Page views during View as stay under the **admin's** email (`usage_events` insert is bound to the JWT, audit2-telemetry-binding.sql:30-46) and carry a new `view_as boolean not null default false` column. Not `detail = 'view-as'`: `MGB_track` already writes `detail = "name:detail"` on action rows, so `detail` can't carry the marker for them. `MGB_track` sets `view_as` too. Usage Stats and "Last seen" can then tell preview activity apart. No bookkeeper email goes into usage rows.

### D5. Admin Settings stay read-only
Already done: `ST_StaffSettingsPage staffUser={staffUser}` (the real admin) with `readOnlyReason` (app.jsx:29768-29783), and `ST_store` is paused. Keep it. The admin's own settings aren't the bookkeeper's (`user_settings` is own-row RLS), so the page says "These are your settings, not {name}'s."

### D6. What is shown for each private surface (blind rule, signatures, private items)
Rule: show the bookkeeper's data only when an admin can already read it through RLS **and** the UI already lets admins see it elsewhere. Otherwise show a **"Private to {name}"** placeholder card, never the admin's own data dressed as theirs.
- **Team Reviews.**
  - `tr_my_overview` and `tr_get_review` resolve "me" from the JWT, so they would show the *admin's* reviews, including an admin reviewer's live view of others.
  - Placeholder: "Reviews are private between {name} and their reviewer. See Team › Reviews as yourself."
  - Never call `tr_my_overview`, `tr_get_review`, `tr_survey_get` or `tr_survey_results` in View as. This keeps the blind rule intact even when the admin is that bookkeeper's reviewer. Anonymous survey answers (Q7/Q10, n≥3) are never touched.
  - The guard blocks these silently (D2), but the callers must also not fire: `TR_useOverview` (TeamReviews.jsx:135) and `TP_useReviewsDue` / `TP_useFeedbackNew` (TeamPage.jsx ~569-590) run unconditionally today. Give them an `enabled` argument that is false in View as.
  - `TR_NavBadge` (unguarded, app.jsx rail ~1888/2288) is hidden in View as.
  - **Cached admin data.** The TR overview store and `HB_statusStore` (HB_api.js:152) are module-level caches filled with the admin's own data before View as. Clear both on start *and* on stop, so neither the bookkeeper's screen shows the admin's queue nor the admin's screen shows an empty one afterwards.
- **Handbook.**
  - `hb_status` is JWT-resolved (it would show the admin's queue and countersigner tools). `HB_useStatus` feeds the Handbook tab, the Team badge (`TP_useHandbookDue`) and Today (`TD_useHandbookItems`, Today.jsx:330); all three take an `enabled` flag that is false in View as.
  - v1: a placeholder plus a read-only list of policies with the bookkeeper's signed/unsigned state. Admins can read every `handbook_signatures` row (staff-handbook.sql:751), so this needs no new grant.
  - The list selects **only** `version_id, signed_at, countersigned_at` (plus policy title/version from the versions table). Never select `typed_name`, `sign_ip`, `sign_ua`, `countersign_ip` or `countersign_ua`: they are PII and not needed to show signed/unsigned.
  - Sign, countersign and the PDF download (`team-reviews` function) are disabled; the guard blocks the function call anyway.
- **Tasks / reminders (owner decision Q3: hide private).**
  - Admins already read every `staff_reminders` row (admin-read-all-tasks.sql, owner decision 2026-09-29), but View as hides `visibility = 'private'` items anyway.
  - Filter in every reader reachable in View as: Today (Today.jsx:202), `OV_ClientTasks` (app.jsx ~7157), `MyTasksPage` (~20532), `myTasksDue` (~26895), the Work › Tasks snapshot (§3.6, server-side `.neq('visibility','private')`; the column is `not null`) and the command palette. Client-side filters fail closed: drop a row when `visibility` is missing.
  - `tk_search` is removed from the read allow-list: for an admin JWT it searches everyone's tasks, private ones included.
- **Inbox / team chat (owner decision Q2: placeholder is fine for v1).**
  - Chat v2 DMs are member-only (`is_conversation_member`), so admins can't read them.
  - Client-message read markers are keyed by the JWT reader.
  - v1: the Inbox place is visible with a placeholder ("Team chat and unread state are private to {name}"), plus a link list of the bookkeeper's assigned clients' Messages tabs. Those tabs already open in View as and their writes are blocked by D1.
  - **Client › Messages attribution.** StaffInbox takes `me` from `siSessionEmail` (the admin's JWT), so the admin's own messages would show as "mine" and the bookkeeper's as someone else's. In View as pass the effective email as `me` for bubble side and "You" labels, and hide unread dots and counts (they are the admin's).
- **Feedback "mine"** (Feedback.jsx:222 filters `author_email` from `getSession`, so it returns the admin's rows). It lives in the Feedback modal, which stays the admin's own: label it "Your feedback" in View as rather than adding a placeholder.
- **Hours budget.** `qbo_my_client_hours` (client-hours-for-bookkeepers.sql) returns per-client totals for every client the caller can access. It is not personal: for an admin it returns a superset, and the Clients list (ClientsPage.jsx:258 `HB_useBudgets`) already filters rows to the bookkeeper's assigned clients. Allow it (it is STABLE) and show the hours column as normal. No placeholder.
- **Celebrations.** `staff_celebrations` returns full birthdays only to admins. In View as hide the birth year and any admin-only fields, so the preview matches what a bookkeeper sees.
- **Bell, tasks badge and unread badge:**
  - The bell is already hidden (TopBar.jsx:1594).
  - Rail badges `staffMessagesUnread` (app.jsx:26811-26860) and `myTasksDue` (26868-26905) use the real email. Hide unread in View as. Compute tasks-due from the effective email (admin-readable), private items excluded.
- **Show-test-clients and assigned flags:**
  - `window.mgbViewerEmail` (app.jsx:27338) is the real email. It drives only `CF_useShowTest` (ClientFlags.jsx), which prefers it over the email argument. `CF_pick` ignores `isAssigned`, and `flagMe` (27341) already uses the effective email, so the "assigned" flags need no change.
  - Set `window.mgbViewerEmail` to the effective email in View as. `CF_useShowTest` then reads the bookkeeper's localStorage key on the admin's device, which is normally absent and defaults to false (a bookkeeper's default). Passing `null` to `CF_useShowTest` would do nothing, because the hook reads `window.mgbViewerEmail` first.
  - Disable the "Show test clients" toggle in View as so it can't write a key under the bookkeeper's email. Say so in the guide.

### D7. A bookkeeper who holds temporary admin access
`hasTempAdminAccess` comes from the real user (app.jsx:27227-27280). Viewing as a bookkeeper with an active grant shows no admin pages today.
- **Owner decision Q4:** keep it that way. View as previews the *role*. Temporary admin pages are the admin's own pages, so there is nothing new to preview.
- The preview bar adds "{name} also has temporary admin access until {date}" when a grant exists. Admins can read `staff_temp_admin_access`, so a read-only fetch is fine.

### D8. Part 2: "Last seen" (admin-only, not temporary admins)
- **Reuse existing data:**
  - Last page and time: `usage_events` (index `usage_events_actor_idx (actor_email, occurred_at desc)`).
  - Last error: `client_errors`.
  - Last sign-in: `auth.users.last_sign_in_at`, read inside a security-definer RPC.
- **Minimal addition:** `usage_events.browser` and `usage_events.app_version` (text, nullable). These are filled by the existing page-view insert (app.jsx:28016-28026), so browser and version are known even for people with no errors. No new table.
- **One RPC:** `staff_last_seen(p_email)`, security definer, `is_active_staff_admin()` only.
  - A temporary admin is `role='bookkeeper'` in SQL, so they're excluded automatically.
  - The UI also hides it when `readOnly` (Members is read-only for temporary admins, app.jsx:14128).
- **UI:** a "Last seen" button on Team › Members rows next to View as (app.jsx:14509-14516). The View as button sits inside `!isSelf && row.role !== "admin" && row.active`; Last seen goes **outside** that condition (`!isSelf && !readOnly`), so it also shows for admins and inactive staff. It opens a small dialog showing:
  - last page and time, device, browser, app version (with a "behind current" pill if it doesn't match `MGB_VERSION.label`)
  - last sign-in
  - last error: time, page, the message's first line and the browser parsed from `user_agent`
  - a link to Developer Tools › Recent errors
- **Throttling:** no new write path, so nothing new to throttle. Page views already log once per page/tab change (app.jsx:28031 deps). The browser string is computed once per load and cached.
- **Retention (owner decision Q5):** no automatic deletion. Nothing purges `usage_events`, `client_errors` or `audit_log`, and this spec adds nothing that does.
- **Hardening (same file):**
  - `client_errors` insert accepts any `actor_email` from any signed-in user (usage-stats-2.sql:144-147). Last seen will display that field, so bind it: `actor_email is null or lower(actor_email) = lower(auth.jwt()->>'email')`.
  - Add length checks matching what the app already trims.
  - **Timestamps are client-settable today.** `usage_events.occurred_at` and `client_errors.created_at` are plain defaults, and no policy binds them, so anyone signed in can insert their own row dated far in the future and appear "last seen" forever. Add `BEFORE INSERT` triggers that force `occurred_at := now()` and `created_at := now()`.
  - Text in a person's own rows (page, tab, browser, message, user agent) is still whatever their browser sent. The dialog renders it as plain text only, never as HTML or a link target.
  - Last seen shows PII-light data only: no IP addresses (none are stored in these tables), and the user agent is reduced to a parsed browser name.

---

## 2. Surface table

Abbreviations:
- **eff** = effective (viewed bookkeeper)
- **real** = signed-in admin
- **JWT** = server resolves "me" from the admin's session
- **RO** = read-only under the D1 guard

### Navigation and shell

| Page / feature | What it shows | Data source / key | Risk under View as | Decision |
|---|---|---|---|---|
| Rail places (StaffNav.jsx NAV_PLACES) | Inbox, Work, Team, Internal | `visible: ctx => !ctx.impersonating` on inbox (35), work (44), team (72), internal (99) | Today these are hidden: not "whole app" | Show inbox, work and team. Keep internal hidden (`STAFF_canViewInternal` is false in View as, app.jsx:1329) |
| effectivePage gate (app.jsx:27911-27978) | Page routing | `!impersonating` on inbox, work, team, help; tasks→today | Same | Allow inbox, work, team, help and tasks. Keep admin-only pages blocked |
| Team tabs (NAV_TEAM tabs) | people, reviews, onboarding, handbook, performance, inventory (+ admin tabs) | `NAV_visibleTabs` with `isAdmin = showsAdminPages` (false in View as) | Admin tabs already hidden | No change |
| Top bar avatar / Exit | Name, " · View as" | TopBar.jsx:1399, 1478-1491 | none | Keep. Add `keepPage` exit for D3 |
| Bell | Mentions, shoutouts, client reads | real email (TopBar.jsx:786-1042) | admin's data | Already hidden (1594). Keep |
| Rail badges | Unread chat, tasks due, reviews due | real email (app.jsx:26811-26905), `TR_NavBadge` JWT | admin's counts on the bookkeeper's rail | Unread and reviews hidden. Tasks-due from eff |
| Preview bar | "Viewing as {name}" | app.jsx:29220-29232 | none | Add "Read-only", temporary admin note (D7) |
| ? menu / guide | Help articles | staff_guide (admin JWT also reads `audience='admin'`) | admin-only articles listed as the bookkeeper's | Allow (help gate opened), **staff-audience articles only** (§3.7) |
| Tours | Bookkeeper tour | Tour.jsx:1339-1345 (available in View as) | stops missing for hidden places | Re-enable Inbox/Work/Team stops in View as (TOUR_visibleStaffSteps 1463 uses ctx.places, so this follows automatically once NAV allows them). Verify copy |
| Tips | Learning tips | TIPS_Root off in View as (Tips.jsx:948) | none | Keep off |

### Home and Work

| Page / feature | What it shows | Data source / key | Risk under View as | Decision |
|---|---|---|---|---|
| Today | Their tasks, waiting threads, coverage, celebrations, onboarding card, reviews notice | `staffItemsApi.list(eff)` (Today.jsx:202), coverage_overview, staff_celebrations, `SON_HomeCard` (eff, can tick), `TR_HomeDueNotice` (guarded by TR_isSomeoneElse) | tick and add write as admin or get RLS errors; celebrations action `by_email = me` (Today.jsx:1042); `TD_useHandbookItems` (330) calls `hb_status` (admin's queue); private reminders | RO guard. Disable tick/add with `MGB_viewAsReadOnly()`. Hide private items (Q3). Handbook items off in View as |
| Work › Tasks | Their tasks | `TK_MyTasks staffUser=eff`. TK store is fed by `TK_sync` (off in View as, app.jsx:28828/28858) | empty or the admin's cached store | Add `TK_api.listFor({assigneeEmail: eff})` snapshot (TK_api.js:413-421 already supports `assigneeEmail`) with `visibility <> 'private'`. No drawers or quick-add (tkHosts stays false) |
| Client › Tasks (`OV_ClientTasks`, app.jsx:7130) | Tasks on a client | `staffItemsApi.list` (shared + own) | private items | Hide private (Q3). RO guard |
| Drive files (Client › Documents) | File list, download links | `drive-files` function: `status`, `list`, `link` | blocking `status` caches "not connected" for 60 s (DriveFiles.js:108-130) and breaks Files after exit | Allow the three read actions (§3.1). Upload, trash, restore, copy_legacy blocked |
| /tasks page | Full Tasks app | `TK_App staffUser=real` (app.jsx:29857) | admin's tasks | Keep redirect to Work › Tasks in View as |
| Work › Notes, Close, Deadlines | Their notes, close tracker, deadlines | eff prop; CloseTracker `staff_client_access` by eff (380) | writes stamp eff (`updated_by`) | RO guard |

### Team

| Page / feature | What it shows | Data source / key | Risk under View as | Decision |
|---|---|---|---|---|
| Team › People | Directory, celebrations | staff_directory, staff_celebrations | admin JWT gets full birthdays | Allow; hide admin-only birthday fields in View as |
| Team › Reviews | Their reviews | `tr_my_overview`/`tr_get_review` JWT; `TR_useOverview` and `TP_useReviewsDue` fire unconditionally | admin's reviews shown as theirs; blind-rule breach if admin is their reviewer; admin's cached overview | **Placeholder**. Never call TR RPCs in View as (hooks get `enabled=false`, guard denies silently). Clear the TR cache on start/stop |
| Team › Onboarding | Their steps | `staff_onboarding_progress` (all rows, filtered client-side), eff | tick writes their row | Show RO |
| Team › Handbook | Their sign status | `hb_status` JWT via shared `HB_statusStore` | admin queue/countersign shown; admin's cache | Placeholder + RO signed list from `handbook_signatures` (admin-readable): `version_id, signed_at, countersigned_at` only, never IP/UA/typed name. Clear `HB_statusStore` on start/stop |
| Team › Performance | Their score | `staff_performance` (admin JWT returns all rows), `mine` by eff (Performance.jsx:160-166) | no new exposure (admins see all) | Allow, `isAdmin=false` |
| Team › Inventory | Their equipment/requests | tech_* (admin reads all), `me` = eff (TechInventory.jsx:43) | submits stamp eff | Allow RO |
| Shoutouts | Their shoutouts | `to_email = who`; insert forced to JWT; admin JWT also reads hidden rows | sending would come from admin; hidden shoutouts shown | RO; drop hidden rows not written by eff (§3.7) |
| Coverage / time off | Their time off | coverage_overview; `staff_time_off.staff_email = who` | admin may write for them (RLS own or admin) | RO |
| Hours column (Clients list, ClientsPage.jsx:258) | Hours per assigned client | `qbo_my_client_hours` (per-client totals for any accessible client; STABLE) | none: per-client, and the list is already filtered to eff's clients | Allow-list the RPC; show as normal |
| Feedback modal (mine) | Feedback the signed-in person sent | `author_email` from getSession | admin's rows | Stays the admin's own; label "Your feedback" in View as |

### Inbox and client pages

| Page / feature | What it shows | Data source / key | Risk under View as | Decision |
|---|---|---|---|---|
| Inbox / team chat | DMs, groups | chat v2 member-only; presence on `staffUser.email` (app.jsx ~15745-15825) | not readable; presence or typing spoof if eff passed | **Placeholder** + links to their clients' Messages. Never mount `useStaffTeamChat` in View as |
| Client › Messages | Client threads | StaffInbox `me` from `siSessionEmail` (JWT); read markers by admin | read-marker upsert and sends as admin; admin's bubbles shown as "mine", unread is the admin's | RO guard blocks upsert/send (upsert skipped, silent). Composer disabled. `me` = eff for display; unread hidden |
| Clients list | Their assigned clients | staff_client_access by eff (app.jsx:27174-27217); show-test via `mgbViewerEmail` (real) | admin's "Show test clients" setting applied | Set `mgbViewerEmail` = eff in View as; disable the toggle |
| Client pages (finances, close, ledger, docs) | Client data | `can_access_client` (admin sees all) + eff assignment filter | writes: client-stamped eff / server-stamped admin | RO guard |
| Budget (ProBudget) | Draft, Approve | context staffUser eff; `can_approve_client_budget` JWT | Approve hidden ≠ DB | D3 |

### Admin-only pages and telemetry

| Page / feature | What it shows | Data source / key | Risk under View as | Decision |
|---|---|---|---|---|
| Settings | Admin's own settings | real, `readOnlyReason` | none | Keep (D5) + copy |
| Admin pages (client access, dev tools, usage, templates, audit, emails) | Admin tools | `!impersonating` gates | n/a | Stay hidden |
| App time / feedback survey | Time tracking, survey | disabled in View as (app.jsx:28140, 28160) | the tracker's final `record_app_time` flush lands after View as starts | Keep; allow-list `record_app_time` (JWT-bound, admin's own minutes) |
| Usage logging | Page views and actions | usage_events, admin email | preview activity mixed into admin's stats | New `view_as` boolean column |
| New windows (Tasks window, TK_keys.jsx:289) | Full app | not in View as | none: it's the admin's normal app | Expected; note in guide |
| Team › Members › Last seen (new) | Last page, browser, version, sign-in, last error | `staff_last_seen` RPC | admin-only, temporary admins excluded | New (D8) |

---

## 3. Build plan, file by file

### 3.1 `components/auth/supabaseClient.js` — the guard (new code at the top, before `createClient`)
```js
// View as is read-only (spec D1). App sets window.mgbViewAs = { on, name, email } while an
// admin previews a bookkeeper; every write leaving the page is refused here.
window.MGB_VIEW_AS_READ_RPCS = new Set([/* §3.1a */]);
window.MGB_VIEW_AS_SILENT_RPCS = new Set([/* §3.1a deny list: blocked with no toast or audit */]);
window.MGB_VIEW_AS_WRITE_OK = new Set(["usage_events", "client_errors"]); // admin's own telemetry
window.MGB_VIEW_AS_TELEMETRY_RPCS = new Set(["log_audit_event", "record_app_time"]); // JWT-bound, admin's own
function MGB_viewAsReadOnly() { return !!(window.mgbViewAs && window.mgbViewAs.on); }
(function wrapFetch() {
  const orig = window.fetch.bind(window);
  window.fetch = function (input, init) {
    if (!MGB_viewAsReadOnly()) return orig(input, init);
    // input can be a string, a URL object (.href) or a Request (.url); resolve relative URLs.
    let url;
    try {
      const raw = typeof input === "string" ? input : (input && (input.href || input.url)) || "";
      url = new URL(String(raw), window.location.href);
    } catch (e) { url = null; }
    const method = String((init && init.method) || (input && input.method) || "GET").toUpperCase();
    const v = MGB_viewAsVerdict(url, method, init); // { ok, silent, kind, name }
    if (v.ok) return orig(input, init);
    if (!v.silent) MGB_viewAsBlocked(v); // toast (deduped 4s) + console.warn + one view_as.blocked audit per page
    else console.debug("[view-as] skipped", v.kind, v.name);
    return Promise.resolve(new Response(JSON.stringify({
      code: "VIEWAS", message: "View as is read-only. Exit View as to make changes.",
    }), { status: 403, headers: { "Content-Type": "application/json" } }));
  };
})();
// ...then the existing slowNetworkFetch + createClient. The wrap MUST come first (realtime captures fetch at construction).
```

`MGB_viewAsVerdict(url, method, init)` rules. Requests to other origins pass (CDN, Google Fonts). An unparseable URL is blocked. On the configured Supabase origin, the **default is deny for anything that isn't GET or HEAD**; only the listed paths pass:
- **Auth:** `POST /auth/v1/token` (refresh), `POST /auth/v1/logout`, and `GET`/`HEAD /auth/v1/user` → ok. Everything else under `/auth/v1/` (`PUT /user` changes email or password, `/otp`, `/recover`, `/factors`…) → blocked as `auth`.
- **RPC** `/rest/v1/rpc/<name>`, matched by name **whatever the method** (PostgREST also accepts GET RPCs):
  - in `MGB_VIEW_AS_READ_RPCS` or `MGB_VIEW_AS_TELEMETRY_RPCS` → ok
  - in `MGB_VIEW_AS_SILENT_RPCS` → blocked, `silent: true`
  - anything else → blocked as `rpc`
- **Tables** `/rest/v1/<table>`: GET or HEAD → ok. POST to a table in `MGB_VIEW_AS_WRITE_OK` → ok. POST/upsert to `client_message_reads` → blocked, `silent: true` (StaffInbox also skips it, §3.7). Any other POST, PATCH, PUT or DELETE → blocked as `rest`.
- **Storage:** GET → ok. `POST /storage/v1/object/sign/<bucket>/…` (signed download URL) and `POST /storage/v1/object/list/<bucket>` → ok, matched as exact prefixes. Note `/storage/v1/object/upload/sign/` (signed **upload** URL) does not match and stays blocked. Every other non-GET → blocked as `storage`.
- **Functions** `/functions/v1/<name>`: blocked as `function` **for every method, GET and HEAD included** (the general "GET is ok" rule applies to `/rest/v1` and `/storage/v1` only). Edge functions run their own code with service keys, so a GET can still send mail, call QBO or write (e.g. `weekly-admin-digest?preview=1` from DigestSettings.jsx:120, `client-emails?preview=1` from EmailsPage.jsx:175). The only exceptions:
  - `POST drive-files` with a JSON body whose `action` is `status`, `list` or `link` (parse `init.body` when it is a string; FormData uploads never match). Without this the Files tab fails and `DRV_status` caches "not connected" for 60 s (DriveFiles.js:108-130), which breaks Files for the admin for a minute after exit.
  - `GET drive-files?t=…` (download stream; the function only logs failures to `drive_file_events`).
  - Every other function (team-reviews PDF, qbo-sync, qbo-gl-review, client-emails, digests…) stays blocked whatever the method.
- **Everything else** on the Supabase origin (`/realtime/v1/api/broadcast`, `/graphql/v1`, unknown paths) with a non-GET/HEAD method → blocked as `other`.

**§3.1a read RPC allow-list (rebuilt 2026-10-23 against 646d3ac and the live DB).** Every name below was checked live (`pg_proc`): STABLE (`s`), or VOLATILE with no INSERT/UPDATE/DELETE/`perform log`/`net.http` in the body. "JWT" marks a function that reads the caller's email; for each, the note says why it is still safe or what the caller must do. The builder re-checks any name added later with the same query.

| RPC | Live | Reached in View as from | Note |
|---|---|---|---|
| bookkeeper_public_profile | s, JWT | client pages | client-scoped (`can_access_client`); JWT only for the portal-member branch |
| client_team_profiles | s, JWT | client pages | same as above |
| can_view_internal, is_internal_owner | s, JWT | shell | answer for the admin; `STAFF_canViewInternal(real, impersonating)` already hides Internal in View as |
| staff_performance | s, JWT | Team › Performance | admin JWT gets every row; `PF_PerformanceTab` already picks `mine` by eff. Never show other rows in View as |
| client_health, client_milestone_stats, client_org_settings, client_org_team, client_sop_status | s | Clients, client pages | client-scoped; lists already filtered to eff's clients |
| client_requests_for_client, tk_client_report_state, tk_list_client_requests, tk_request_recipients, tk_close_optin_status, tk_waiting_on_client | s | client Needs/Requests/Close tabs, Slate side lists | client-scoped. `tk_waiting_on_client(null)` returns every accessible client for an admin: filter rows to eff's clients (fail closed) |
| tk_late_count_from, tk_schema_version, tk_assignable_staff, tk_client_people | s | Slate, client tabs | firm settings / directory |
| tk_on_time_stats, tk_review_stats | s, JWT | Slate review queue, Performance | admin may pass `p_email`; in View as callers **must pass eff email** (a `null` returns everyone) |
| tk_my_coverage | s, JWT | Team › People (Coverage.jsx `CV_cov`) | admin gets every handoff; in View as keep only rows where `from_email` or `to_email` = eff |
| coverage_overview, staff_directory, staff_celebrations | s | Today, Team › People | celebrations: hide birth year in View as (D6) |
| sp_staff_photo_paths | s, JWT | avatars everywhere | JWT only checks signed-in |
| qbo_hours_by_client, qbo_hours_by_staff, qbo_usage_status, qbo_my_client_hours | s | Clients hours column, top bar/sidebar QBO usage | per-client totals (D6) |
| search_staff_guide | s | ? menu, ⌘K | |
| hb_get_policy | s | HR › Handbook read-only list (policy text) | |
| gl_review_portal_addressees | s | Client › Ledger | the only read RPC in `LR_api`; every other `gl_review_*` RPC is a write (most `gl_review_*` reads are table GETs) |
| client_profitability | s | Team › Profit (admin-only today) | harmless to allow; keep for when it reaches bookkeepers |

Removed from the 2026-10-15 list: `client_reply_times` (only `ReplyTimes.jsx`, an admin tab, calls it) and `access_link_client` (client invite-link flow, not a staff page). Both stay off; a toast is fine if one ever fires.

**Silent deny list** (`MGB_VIEW_AS_SILENT_RPCS`), blocked even though they are reads, with no toast and no audit row. Each answers "me" from the admin's JWT, or exposes more than the bookkeeper could see:
- tr_my_overview, tr_get_review, tr_survey_get, tr_survey_results: blind rule, D6.
- hb_status, hb_approver_access: JWT "me" is the admin (queue, countersign and approver tools).
- tk_search: searches everyone's tasks for an admin JWT, private ones included (Q3).
- wb_inbox: the Desk list; `v_me` and `wb_item_state` are the admin's (§10.1).
- sp_my_photo_status: the admin's own photo status (StaffPhotoGate, §10.6).
- tk_project_task_counts: VOLATILE and counts "not mine" from the JWT; only used before project trash (a write).

Not listed and therefore blocked **with a toast** (they are writes or only follow a user action): `get_report_share`, `tk_generate_preview` (VOLATILE, runs `tk__generate(..., 'preview')`; template pages are admin-only), `cron_health`, `usage_summary`, `staff_announcement_report`, `qbo_firm_status`, `offboard_staff_preview`, `staff_missing_auth`, `tr_admin_options`, `tr_history`, `tr_team_status`, `tr_close_cycle_preview`, `tk_admin_list_projects`, `tk_import_no_team_clients`, `hr_get_record`, `hr_list_records`, `sp_admin_photo_list`, `sp_admin_photo_history` (all admin-page reads, hidden in View as), and every `*_save_*`, `*_set_*`, `tk_*`, `gl_review_*`, `wb_*`, `hb_*`, `tr_*`, `sp_*` write.

Also export `MGB_viewAsReadOnly` (global function) for UI disabling.

### 3.2 `app.jsx`
- **27149-27172 (start/stop; `startImpersonating` at 27869 on 646d3ac).**
  - **Role check first (critique 2026-10-23).** Today `startImpersonating` has no check at all; only the disabled button (`readOnly={staffUser.role !== "admin"}`) stops a temporary admin, who does see HR › Members. Start with: return unless the **real** `staffUser.role === "admin"` (not `staffIsAdmin`, which is true for temporary admins), the target is `active`, not `admin`, and not the admin's own email. Nothing else (`window.mgbViewAs`, token cache, `setImpersonating`) runs before this check, so for every non-admin the guard stays inert and nothing changes.
  - **Audit before entering.** `await` the `view_as.start` log. If it errors (forbidden, network), do not enter View as; toast "Couldn't start View as. Try again." Today `AL_logEvent` only warns, so a refused log still enters View as with no audit row.
  - Then set `window.mgbViewAs = { on: true, name: row.name, email: row.email }` and cache the current access token for the pagehide log.
  - Clear the TR overview cache and `HB_statusStore` (`data = null, at = 0`) on start and on stop (D6).
  - Change `stopImpersonating(opts)` to clear `window.mgbViewAs`, log `view_as.stop` with `{ reason: "exit" }`, and only call `setPage("today")` when `!opts || !opts.keepPage`.
  - Add a `useEffect` on `impersonating` that registers a `pagehide` listener. It sends `view_as.stop` with `{ reason: "pagehide" }` through a raw `fetch(..., { keepalive: true })` with the cached token (D4), not `sb.rpc`.
  - The sign-out handler awaits the `{ reason: "signout" }` log, then signs out.
  - Set `window.mgbViewAs` in an effect *and* synchronously in start, so the first fetch after the click is already guarded.
- **27338-27340.** `window.mgbViewerEmail = impersonating ? impersonating.email : staffUser.email`. Leave `CF_useShowTest(staffUser.email)` as is: the hook prefers `window.mgbViewerEmail`, so it now reads the bookkeeper's key (normally absent, so false). Disable the Show test clients toggle when `MGB_viewAsReadOnly()` (D6).
- **26811-26860 (`staffMessagesUnread`).** Return 0 while impersonating. The rail badge is hidden.
- **26868-26905 (`myTasksDue`).** List by `effectiveStaffUser.email` and drop `visibility === 'private'` rows (fail closed). Skip the realtime channel `"staff-reminders-"+email` while impersonating (refresh on page change instead).
- **~7157 (`OV_ClientTasks`) and ~20532 (`MyTasksPage`).** In View as, drop private rows from the `staffItemsApi.list` result (Q3).
- **Command palette.** Don't call `tk_search` in View as (it's on the silent deny list); search only the snapshot rows.
- **27911-27978 (effectivePage gate).**
  - Drop `!impersonating` from inbox, work, team and help.
  - Change the `tasks` redirect to `work` with the tasks tab, not `today`.
  - Update the explanatory comment at 27880-27900.
- **28016-28026 (usage insert).** Add `browser: MGB_browserLabel()`, `app_version: window.MGB_VERSION ? window.MGB_VERSION.label : null`, and `view_as: !!impersonating`. Add `impersonating` to the deps. Leave `detail` alone.
- **`MGB_track` (~1063).** Add `view_as: MGB_viewAsReadOnly()` to its insert, so actions taken during View as are marked too.
- **New helper near MGB_deviceKind (~1048).** `MGB_browserLabel()` returns e.g. "Chrome 141 · macOS", memoised. Copy the `browserName()` parse from components/auth/signInNotice.js (Edg, Firefox, Chrome/CriOS, Version…Safari) and add OS (Mac, Windows, iOS, Android, Linux). Max 60 chars.
- **29099-29121 (StaffRail).** Pass `impersonating` and keep it. In StaffRail (2165-2330), hide the `TR_NavBadge` and unread badge when `impersonating`.
- **29220-29232 (preview bar).** Add the "Read-only" chip and the temporary admin note (D7, a read-only fetch of `staff_temp_admin_access` for the viewed email).
- **29825-29838 (TP_TeamHub).** Pass `viewingAs={impersonating}`. TeamPage forwards it to reviews and handbook for the placeholders. (It already passes `isRealAdmin={staffUser.role==="admin" && !impersonating}`, so People, Performance and Inventory get `realAdmin=false` today.)
- **Today (Today.jsx).** `TD_useHandbookItems` (330) gets `enabled=false` in View as; the existing `TR_isSomeoneElse` guards (1213, 1216) stay.
  - **Also `TR_useOverview()`** (Today.jsx:1313 on 646d3ac) runs unconditionally in `TD_TodayPage`. Pass `TR_useOverview(!impersonating)` (`TD_TodayPage` already receives `impersonating`). Without it Today shows the admin's cached review overview (before the start-time cache clear lands) and fires `tr_my_overview` on every open.
  - **The profile prompt** (`ST_useMyProfile(me)` at Today.jsx:1321 and the prompt block ~1325-1366) is not gated: in View as it loads the bookkeeper's profile, can open the "finish your profile" prompt and writes `mgb-profile-prompt:<eff>` to localStorage (breaks N7; Save is a write). Pass `null` to `ST_useMyProfile` while impersonating (as TopBar.jsx:1487 already does) and never show the prompt.
- **29843 (Inbox).** When `impersonating`, render `<VA_PrivatePlaceholder kind="inbox" name=… clients={assigned}/>` instead of `StaffMessagesPage`.
- **29857 (TK_App).** Unchanged. The tasks route redirects in View as.
- **29869 (WK_WorkPage).** Pass `viewingAs`. On the tasks tab, `TK_MyTasks` gets `snapshotFor={eff email}` (§3.6).
- **New small component `VA_PrivatePlaceholder({ kind, name, clients })`** placed near the preview bar. Copy for each kind:
  - reviews / handbook / inbox: "{First} sees their own {X} here. It's private to them, so View as doesn't show it. Exit View as to see yours."
  - inbox also lists links to assigned clients' Messages tabs.
- **ST_StaffSettingsPage readOnlyReason (29768-29783).** Change the copy to "These are your settings, not {name}'s. Exit View as to change them."
- **StaffAccessPage 14509-14516.** Add the `SA_LastSeenButton` (§3.8) after View as, **outside** the existing `!isSelf && row.role !== "admin" && row.active` condition, shown when `!isSelf && !readOnly`. It appears for admin and inactive rows too, since they're admin-readable and useful.

### 3.3 `components/staff/StaffNav.jsx`
- Lines 35, 44, 72: remove `visible: ctx => !ctx.impersonating` from inbox, work and team. Keep it on internal (99).
- Update the file header comment.

### 3.4 `components/pro/ProBudget.jsx` (D3, 820-846, 1727-1740)
- Read `viewingAsName` and `onExitViewAs` from `StaffToolsContext`. Add `exitViewAs: () => stopImpersonating({ keepPage: true })` to the provider value at app.jsx:29046.
- When `staff && viewingAsName && !canApprove`, render a disabled Approve with `aria-describedby`. The caption reads "{First} can't approve budgets." A `link-btn` reads "Exit View as to approve".
- Request changes is disabled by `MGB_viewAsReadOnly()`.
- Reopen (1741) is disabled likewise.

### 3.5 `components/staff/TeamPage.jsx` (569-700)
- Accept `viewingAs`.
- In View as, render `VA_PrivatePlaceholder` for reviews (line ~603) and handbook (~606, the placeholder plus the read-only signed list from D6). Hours (`TP_TeamPage`) is admin-only, so no change there.
- Leave people, onboarding, performance and inventory as they are. They already take eff and `isAdmin=false`.
- `TP_useReviewsDue`, `TP_useHandbookDue` and `TP_useFeedbackNew` run unconditionally today (~569-590). Pass `enabled = !viewingAs` so they make no `tr_*` / `hb_status` calls, and hide the tab badges (~587-589).
- `TR_useOverview` (TeamReviews.jsx:135) and `HB_useStatus` (HB_api.js:181) take the same `enabled` argument; when false they skip the load and the 5-minute interval.

### 3.6 `components/tasks/TK_MyTasks.jsx` (109+) and `TK_api.js` (413-421)
- Add `TK_api.listFor(email)`, a thin wrapper over the existing `assigneeEmail` list that adds `.neq('visibility', 'private')` (Q3).
- `TK_MyTasks` with `snapshotFor` loads that list once into local state (not `TK_store`), renders rows read-only (no drawer, no checkbox handlers) and shows "Read-only preview".

### 3.7 `components/staff/Today.jsx`, `StaffOnboarding.jsx`, `TechInventory.jsx`, `Shoutouts.jsx`, `Coverage.jsx`, `inbox/StaffInbox.jsx`
- Gate action buttons with `typeof MGB_viewAsReadOnly === "function" && MGB_viewAsReadOnly()`, setting `disabled` and `title="Read-only in View as"`:
  - Today.jsx: toggleItem 1130, add 1158, remove 1178, celebration action 1042
  - StaffOnboarding.jsx: `SON_StepList canTick` 167/196 → `canTick={!ro}`
  - TechInventory.jsx: request/submit at 230/275/306
  - Shoutouts.jsx: send at 164, hide at 97
  - Coverage.jsx: time-off add/cancel 189/248, grant 352
  - StaffInbox.jsx: composer, loop-in 316, delete 528. Skip the staff read-marker upsert (377-378) when read-only (the guard also denies it silently). In View as use the effective email as `me` for bubble side and "You" labels, and hide unread dots.
  - Today.jsx: private reminders filtered from the `staffItemsApi.list` result at 202 (Q3).
  - Show test clients toggle (ClientFlags / ClientsPage): disabled.
  - Team › People celebrations: hide admin-only birthday fields.
- **Data filters added by the 2026-10-23 critique** (these are D6 rules, not niceties; each fails closed):
  - **Shoutouts.jsx (`SO_store`, line 18-37).** An admin JWT reads hidden shoutouts (`hidden_at` set), which a bookkeeper's RLS never returns unless they wrote it. In View as drop rows with `hidden_at` unless `from_email` = eff, and hide the Hide control. `SO_store` is a module cache: render from a filtered copy, never mutate it.
  - **Staff guide (StaffGuide.jsx `HLP_StaffGuidePage`, list at 291, article at 315; TopBar.jsx:651 ⌘K hits; ? menu `TB_helpSlugFor`).** `staff_guide_read_admin` lets the admin JWT read `audience = 'admin'` articles and `search_staff_guide` is SECURITY INVOKER, so View as would list admin articles (with the Admin pill) as if the bookkeeper could read them. In View as keep only `audience === 'staff'` rows (a missing or unknown audience is dropped): the list, search results, an article opened by slug or deep link (show "This article is for admins." instead of the body), ⌘K guide hits (`isAdmin` there must be false in View as) and the ? menu link (`TB_helpSlugFor(page, false)`). `HLP_StaffGuidePage` gets an `impersonating` prop, or reads `MGB_viewAsReadOnly()`.
  - **L1 sidebar (StaffSidebar.jsx `SS_useSidebar`, called from StaffRail ~2419).** Pinned (`mgb_wb_pins:<realEmail>`) and Recent (`mgb-client-switcher-recent:<realEmail>`) are the **admin's own** lists, shown under the bookkeeper's rail. Hide both sections in View as (Alerts is already `isRealAdmin`-gated). Do not read or write the eff-keyed copies either.
  - **ClientSwitcher.jsx `CS_pushRecent`.** It writes `mgb-client-switcher-recent:<eff>` on every client change. Skip the write when `MGB_viewAsReadOnly()` (N7). Reading the eff key is fine.
  - **ClientTabCounts.jsx `CTC_loadTasks`.** The client tab task count uses `staffItemsApi.list(sb, me)` and counts private items. Drop `visibility === 'private'` (and missing) rows in View as, like every other Q3 reader.
- The button gating (first list) is a nicety. The guard is the safety net, so a missed button only shows the toast; RLS stays the security boundary.

### 3.8 New: Last seen dialog (app.jsx near StaffAccessPage, prefix `SA_`)
- `SA_LastSeenButton({ row })` is a `btn-secondary` "Last seen" button.
- On click it calls `sb.rpc("staff_last_seen", { p_email: row.email })` and opens the existing modal pattern with these rows:
  - **Last active:** relative time, page › tab, device, browser, app version (with a "behind" pill if `!= MGB_VERSION.label`). Rows are rendered as plain text (they come from the person's own browser).
  - **Last sign-in:** relative time.
  - **Last error:** time, page, message (one line, 200 chars), source, version, parsed browser, plus "Open Recent errors" → `NAV_go("developer-tools")`.
  - Empty states: "No activity recorded yet" and "No errors reported".
- No PAGE_META entry is needed (it's a dialog). Add a `MGB_track("last-seen:open")` action event.

### 3.9 `index.html:205`
Bump `MGB_VERSION` (label, e.g. `2026-10-16a`).

---

## 4. SQL: new file `supabase/view-as-last-seen.sql` (idempotent)

```sql
-- View as (read-only) + admin "Last seen" (2026-10-16). Safe to re-run.
begin;

-- 4.1 usage_events: browser + app version on every page view (spec D8).
alter table usage_events add column if not exists browser text;
alter table usage_events add column if not exists app_version text;
alter table usage_events drop constraint if exists usage_events_browser_len;
alter table usage_events add constraint usage_events_browser_len
  check (browser is null or length(browser) <= 80) not valid;
alter table usage_events drop constraint if exists usage_events_app_version_len;
alter table usage_events add constraint usage_events_app_version_len
  check (app_version is null or length(app_version) <= 40) not valid;
-- View as marker (not detail: MGB_track already uses detail for actions).
alter table usage_events add column if not exists view_as boolean not null default false;
-- Insert policy (audit2-telemetry-binding.sql) is column-agnostic: no change.

-- 4.1b Server time only. Without this anyone signed in can insert their own
-- row dated in the future and look "last seen" forever.
create or replace function public.telemetry_force_now()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_table_name = 'usage_events' then
    new.occurred_at := now();
  else
    new.created_at := now();
  end if;
  return new;
end
$$;
drop trigger if exists usage_events_force_now on usage_events;
create trigger usage_events_force_now before insert on usage_events
  for each row execute function public.telemetry_force_now();
drop trigger if exists client_errors_force_now on client_errors;
create trigger client_errors_force_now before insert on client_errors
  for each row execute function public.telemetry_force_now();

-- 4.2 client_errors: bind actor_email to the session and bound the sizes.
drop policy if exists "signed-in users can report errors" on client_errors;
create policy "signed-in users can report errors"
  on client_errors for insert
  with check (
    auth.role() = 'authenticated'
    and (actor_email is null or lower(actor_email) = lower(auth.jwt() ->> 'email'))
    and length(message) <= 500
    and (stack is null or length(stack) <= 4000)
    and (source is null or length(source) <= 300)
    and (user_agent is null or length(user_agent) <= 300)
    and (page is null or length(page) <= 100)
    and (app_version is null or length(app_version) <= 40)
    and (device is null or length(device) <= 40)          -- added 2026-10-23
    and (actor_role is null or length(actor_role) <= 20)  -- added 2026-10-23
  );
create index if not exists client_errors_actor_idx on client_errors (lower(actor_email), created_at desc);

-- 4.3 staff_last_seen: admins only (temporary admins are role 'bookkeeper' in
-- SQL, so is_active_staff_admin() already excludes them).
create or replace function public.staff_last_seen(p_email text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  e text := lower(trim(coalesce(p_email, '')));
  result jsonb;
begin
  if not public.is_active_staff_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from staff s where lower(s.email) = e) then
    raise exception 'not a staff member' using errcode = '22023';
  end if;
  select jsonb_build_object(
    'last_view', (
      select to_jsonb(x) from (
        select occurred_at, page, tab, device, browser, app_version
        from usage_events
        where actor_email = e and kind = 'view' and not view_as  -- usage policy stores the JWT email as-is
        order by occurred_at desc limit 1
      ) x),
    'last_action_at', (select max(occurred_at) from usage_events where actor_email = e and not view_as),
    'last_sign_in_at', (select u.last_sign_in_at from auth.users u where lower(u.email) = e limit 1),
    'last_error', (
      select to_jsonb(x) from (
        select created_at, page, left(message, 200) as message, source, app_version, device, user_agent
        from client_errors
        where lower(actor_email) = e
        order by created_at desc limit 1
      ) x),
    'errors_7d', (select count(*) from client_errors
                  where lower(actor_email) = e and created_at >= now() - interval '7 days')
  ) into result;
  return result;
end
$$;
revoke all on function public.staff_last_seen(text) from public, anon;
grant execute on function public.staff_last_seen(text) to authenticated;
```

The `actor_email = e` match: emails are stored as the JWT gives them. Checked live during the critique (2026-10-15): 0 mixed-case emails in `usage_events`, `client_errors` and `staff`, so the existing `usage_events_actor_idx` serves the query. The builder re-checks with `select count(*) from usage_events where actor_email <> lower(actor_email)` before applying.

Last seen ignores the admin's own View as rows (`not view_as`), so previewing a bookkeeper never makes the *admin* look active on that page. `p_email` is only used as a bound value, so there is no injection path.

```sql
-- 4.4 log_audit_event: allow view_as.blocked (stop already allowed; details carry reason).
-- view_as.* is admin-only: only admins can View as, so a bookkeeper writing
-- view_as.start naming someone else would be a forged row.
create or replace function public.log_audit_event(
  p_action text, p_client_id text default null, p_details jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if not public.is_active_staff() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_action like 'view\_as.%' and not public.is_active_staff_admin() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_action not in ('view_as.start', 'view_as.stop', 'view_as.blocked',
                      'portal_preview.start', 'portal_preview.stop') then
    raise exception 'unknown audit action %', p_action using errcode = '22023';
  end if;
  if p_client_id is not null and not public.can_access_client(p_client_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  insert into audit_log (actor_email, action, client_id, target_type, target_id, details)
  values (
    auth.jwt() ->> 'email', p_action, p_client_id,
    case when p_action like 'view_as.%' then 'staff' else 'client_user' end,
    left(coalesce(p_details ->> 'target', ''), 200),
    case when length(coalesce(p_details, '{}'::jsonb)::text) <= 2000
         then coalesce(p_details, '{}'::jsonb) else '{}'::jsonb end
  );
end;
$$;
revoke all on function public.log_audit_event(text, text, jsonb) from public, anon;
grant execute on function public.log_audit_event(text, text, jsonb) to authenticated;

-- 4.5 usage_summary: exclude View as activity from every count. The file
-- patches the live definition in place with pg_temp.patch_fn (the
-- internal-company-profile.sql pattern): each of the 11 usage_events
-- subqueries' `where ue.client_id is null or public.is_roster_client_id(ue.client_id))`
-- becomes `where (…) and not ue.view_as)`. Skips if already patched; raises if
-- the anchor count is not 11. See supabase/view-as-last-seen.sql for the code.

commit;
-- No retention job (owner decision Q5: no automatic deletion).
```

**Live re-check, 2026-10-23 (read-only SQL against xumsqmhccgfjnlmieqyu).** The SQL file needed only one change.
- `usage_events` insert policy "signed-in users can log their own usage" binds `actor_email = jwt email`, `actor_role` and `client_id`. It is column-agnostic, so the new columns need no policy change. There are 3,310 rows, and the `not null default false` add is a fast default with no table rewrite.
- `client_errors` insert policy "signed-in users can report errors" is still `auth.role() = 'authenticated'` only, and the name matches. Its columns are: id, created_at, actor_email, actor_role, page, message, stack, source, app_version, user_agent, device.
  - **Drift fixed:** `device` and `actor_role` were unbounded. 4.2 now caps them at 40 and 20 characters (live max is 7).
  - 0 existing rows exceed any bound.
- `log_audit_event` is unchanged since 2026-10-15. It allows only view_as.start/stop and portal_preview.start/stop, uses `search_path = public`, and has no admin check.
  - 4.4 keeps all four actions, adds `view_as.blocked` and the admin-only rule, and moves to `public, pg_temp`.
  - The other audit actions AuditLog.jsx labels (handbook.*, qbo_firm.*, client.updated…) are written by other functions and triggers, not through this RPC, so nothing is lost.
- `usage_summary(integer)` has one overload, exactly 11 anchors and no `view_as` yet.
- `is_active_staff_admin()` is `jwt_has_google() and staff.role = 'admin' and active`. The live roles are only `admin` and `bookkeeper`, so a temporary admin (an app-side `staff_temp_admin_access` grant) is `bookkeeper` in SQL and is refused by `staff_last_seen`.
- There are no triggers on `usage_events` or `client_errors` yet, and 0 mixed-case emails in `usage_events`, `client_errors` and `staff`.
- `audit_log` columns: id, at, actor_email, action, client_id, target_type, target_id, details. These match the 4.4 insert.

- Also mirror the 4.4 change into `supabase/audit-log.sql` (267-296) so a re-run of that file doesn't drop `view_as.blocked`. Or note in its header that view-as-last-seen.sql supersedes it.
- `AuditLog.jsx:46-47, 68`: add a label "View as: blocked change" and include it in the View as filter.
- Apply via the Supabase MCP (owner pre-approved auto-apply), then run `get_advisors`.

---

## 5. Test and verify plan

### 5.1 SQL (Supabase MCP, `execute_sql` as a role simulation)
1. Admin JWT: `select staff_last_seen('<bookkeeper email>')` → JSON with the keys above.
2. Bookkeeper JWT (`set local request.jwt.claims`) → `42501`. Bookkeeper with an active temporary admin grant → still `42501`.
3. `client_errors` insert with another user's `actor_email` → rejected. With null or own → ok.
4. Admin JWT: `log_audit_event('view_as.blocked', null, '{"target":"x"}')` ok. `'nope'` → 22023. Bookkeeper JWT: `log_audit_event('view_as.start', …)` → 42501; `portal_preview.start` still works for staff.
5. Insert a `usage_events` row with `occurred_at = now() + interval '1 year'` and a `client_errors` row with a future `created_at` → both stored with server `now()`.
6. Admin JWT: a `view_as = true` usage row for the admin does not change `staff_last_seen('<admin email>')`.
7. `get_advisors` (security): no new warnings.

### 5.2 Browser (Claude Browser pane against a Vercel preview or local; sign-in done by the owner)
These run with a real admin session. Claude cannot sign in on the owner's behalf, so the owner signs in and Claude drives from there.
1. Team › Members → View as a bookkeeper. Check that the rail shows Today, Clients, Inbox, Work and Team, that Internal is gone, and that the preview bar says "Read-only".
2. Visit each page in the surface table:
   - Each page loads with no console errors.
   - No unexpected `[view-as] blocked rpc` warnings. Any that appear are read RPCs missing from §3.1a: add them after confirming in SQL that they're read-only.
3. Try a write on each page (tick a task, send a client message, add a note, submit an inventory request, Approve a budget, upload a doc). Check that:
   - a toast appears
   - the Network panel shows no non-GET request to the Supabase origin other than usage/errors/log_audit_event/record_app_time, token refresh and the three `drive-files` read actions
   - nothing changed after exiting View as and reloading
4. Team › Reviews, Handbook and Inbox show placeholders, and Today shows no handbook items. Network shows **no** `tr_*` or `hb_status` calls during View as (`read_network_requests` with urlPattern `rpc/tr_` and `rpc/hb_status`), and no "read-only" toast appears just from opening Today or Team.
5. Guard edge cases, from the console during View as: `fetch(new URL(cfgUrl + "/rest/v1/notes"), {method:"POST"})` → 403; `fetch(cfgUrl + "/rest/v1/rpc/staff_last_seen?p_email=x")` (GET RPC not on the list) → 403; `fetch(cfgUrl + "/auth/v1/user", {method:"PUT"})` → 403; `fetch(cfgUrl + "/realtime/v1/api/broadcast", {method:"POST"})` → 403; `fetch(cfgUrl + "/storage/v1/object/upload/sign/x/y", {method:"POST"})` → 403.
6. Client › Documents in View as lists files and opens a download. After exit, uploading works at once (no 60 s "not connected").
7. Private tasks: give the bookkeeper one private and one shared reminder. In View as only the shared one appears on Today, Work › Tasks, Client › Tasks and the tasks-due badge.
8. Enter View as, exit, then open Team › Reviews and Handbook as the admin: the admin's own data shows (caches were cleared, not left empty or stale).
9. Client › Messages: the bookkeeper's own messages sit on the "mine" side; no unread dots.
10. Budget: a submitted budget in View as shows the disabled Approve plus "Exit View as to approve". Clicking it stays on the budget, and Approve is live as the admin.
11. Audit log (as admin, after exit): `view_as.start`, one `view_as.blocked` per page tried, `view_as.stop` with reason `exit`. Reload mid-View-as → `view_as.stop` with reason `pagehide` (best-effort, may be missing: note the result). Sign out mid-View-as → `view_as.stop` with reason `signout`.
12. Last seen: open it on a bookkeeper row, an admin row and an inactive row. It shows page, browser, version and last error. Signed in as a temporary admin (owner-assisted), Members is read-only and the button is absent.
13. The bookkeeper tour run in View as now includes the Inbox, Work and Team stops.
14. Phone width (375px): the Last seen dialog and the preview bar wrap cleanly.

Added 2026-10-23 for the surfaces in §10. Item 1 now expects the rail to show Today, Clients, Inbox, Work, Team and **HR**, with Internal gone.

15. **Today / Desk.** With `wb_enabled` on, or the admin's own Desk preview ticked, View as shows Classic Today, the one-line Desk note, no WB_NavBadge and no Desk drawer. Network shows no `rpc/wb_` calls.
    After exit, the admin's Desk loads fresh: `WB_store.refresh()` ran, with no error and no empty state.
16. **Work › Slate.** The snapshot shows only the bookkeeper's non-private tasks, never the admin's. Seed one admin-only task first to prove the admin's TK_store rows don't leak.
    - The snapshot has no checkbox, drawer, quick-add, pop-out, review queue or waiting list.
    - No `rpc/tk_search` call is made.
    - No `mgb_tk_slate_*:<bookkeeper email>` localStorage key appears.
    - Changing group or sort works for the session only.
17. **HR.** The HR place shows Handbook, Reviews and Onboarding. Employee records and Members are absent, and the HR rail badge is absent.
    - Handbook shows the placeholder plus the signed-list table.
    - Reviews shows the placeholder.
    - Onboarding shows the bookkeeper's steps with ticks disabled.
    - Network shows no `rpc/tr_`, `rpc/hb_status` or `rpc/hb_approver_access` call.
18. **Team.** People, Performance and Inventory show the bookkeeper's data. Performance shows only their row. People › coverage lists only handoffs to or from them. No admin tabs are shown.
19. **Client › Ledger** in View as makes no `functions/v1/qbo-gl-review` request (no auto-pull), shows the last stored pull with a read-only note, and Pull is disabled. No toast fires on open.
20. **⌘K** in View as returns the bookkeeper's non-private tasks, clients and guide hits, and makes no `rpc/tk_search` call.
21. **No surprise notices.** No announcement notice, tip, StaffPhotoGate or admin/AM/temp-admin tour appears during View as. Each appears again as normal after exit.
22. **Last seen** sits on **HR › Members** rows. Its tip points there.
23. **Toast-free sweep.** Open every place and tab reachable in View as without clicking anything. Zero "View as is read-only" toasts and zero `view_as.blocked` audit rows should result. Any that appear are a read missing from §3.1a, or a write that fires on open and must be gated (as in §10.4).

Added 2026-10-23 by the critique (§11):

24. **Temporary admin can't start View as.** Signed in as a temporary admin (owner-assisted), HR › Members shows View as disabled, and calling the start handler from the console (React devtools) does nothing: no `window.mgbViewAs`, no preview bar, no `view_as.*` request. With the network offline, an admin's View as click shows "Couldn't start View as" and does not enter View as.
25. **Guide.** In View as, the guide list, guide search, ⌘K guide hits and the ? menu show no Admin-pill article. `#/help/staff-management` (an admin article) shows "This article is for admins." After exit the admin sees every article again.
26. **Shoutouts.** Hide one shoutout (as admin) that the bookkeeper did not write. In View as it does not appear and no Hide control shows.
27. **L1 sidebar.** The admin has pins and recents. In View as the Pinned and Recent sections are absent. Opening three clients in View as adds no `mgb-client-switcher-recent:<bookkeeper email>` key (check localStorage before and after).
28. **Today.** Network shows no `rpc/tr_my_overview` on Today in View as. The profile prompt never shows, and no `mgb-profile-prompt:<bookkeeper email>` key appears.
29. **Functions.** From the console in View as, `fetch(cfgUrl + "/functions/v1/weekly-admin-digest?preview=1")` (a GET) → 403 from the guard, and no request reaches the network.
30. **Client tab counts.** With one private and one shared reminder on a client, the client's tab count in View as counts only the shared one.

5.1 addition: 8. Re-run the §4 live re-check queries just before applying. Expect the same policy names, 11 anchors and no `telemetry_force_now` trigger yet. Stop if any of these differ.

### 5.3 Not browser-checkable
- Realtime presence is not spoofed. This is checked by code review: `useStaffTeamChat` is never mounted in View as.
- pagehide reliability.

---

## 6. Upkeep (same commit; memory rule: guide, tours, tips, ? menus, README, whats-new, Dev Tools)

- **Staff guide** (`docs/staff-guide/*.md`):
  - `staff-management.md` "### View as" (line 63): whole app, read-only, placeholders, Exit to approve, Last seen.
  - Also update: `preview-as`, `admin-guide`, `bookkeeper-guide`, `account-manager-guide`, `top-bar`, `team-page`, `temporary-access` (D7 + Last seen not for temporary admins), `audit-log` (`view_as.blocked`, stop reasons, view_as.* admin-only), `review-cycles` and `quarterly-reviews` (blind rule kept in View as), `staff-settings` (read-only copy), `admin-insight` (Usage stats line 10: View as activity excluded. Recent errors line 27: browser/version + Last seen).
  - Also: `staff-handbook` (View as shows signed/unsigned only), `inbox` (placeholder, Messages "mine" side), `work-page` and `my-tasks` (private tasks hidden in View as), `google-drive-files` (files list and download in View as, uploads blocked). Mention that a new window opened during View as is the admin's normal app.
  - `grep -ril "view as" docs/staff-guide` for the rest (tips, getting-started, mgb-internal, quickbooks-time-and-app-time).
- **whats-new.md:** `### 2026-10-16: View as covers the whole app` with bold-lead bullets linking `(#/help/staff-management)` and `(#/help/admin-insight)`.
- **sync.mjs:**
  - Run `node docs/staff-guide/sync.mjs --check` (validates frontmatter: title, section, audience, keywords, sort).
  - Then `node docs/staff-guide/sync.mjs > <scratchpad>/guide.sql`, which prints one transaction upserting `public.staff_guide` plus a delete line.
  - Run the **upserts only** (drop the delete line) via the Supabase MCP. README:1622-1640 documents this.
- **Tours** (`components/tour/Tour.jsx`):
  - Bookkeeper tour `sub` (1340) → "Their day: Today, their clients, Inbox, Work and Team".
  - Remove the "During View as the Inbox, Work and Team stops are left out" comment (1339).
  - Check the steps in `TOUR_bookkeeperSteps` (885-1028) for anchors on the placeholders. Admin tour: a step or sentence on the "View as" button saying it's read-only.
- **Tips** (`Tips.jsx` TIPS_CATALOG 180+):
  - Edit `client-view-as` (304) if its text says pages are hidden.
  - Add a `members-last-seen` tip pointing at the new button. Its copy must match `tips.md` word for word.
  - Tips stay off in View as.
- **? menus:** both the staff `TB_HelpButton` (TopBar.jsx:1228) and the client one. Staff gets a "View as" link to `staff-management#view-as` if not present. No client change.
- **README:**
  - View as lines (360, 386, 419, 531, 540, 553, 635, 646, 795, 810, 1032, 1039, 1234): reword "hidden in View as" to "read-only in View as".
  - Database changes (1341): add view-as-last-seen.sql.
  - Usage stats (821) and client_errors (1019): new columns (`browser`, `app_version`, `view_as`), email binding, server-set timestamps.
  - Security notes (1547): the fetch guard is a UX net, RLS is the boundary; the blind rule kept; every new read RPC must be added to §3.1a; view_as.* audit is admin-only.
  - Known gaps (1470): pagehide best-effort; realtime websocket sends not guarded.
- **Dev Tools:**
  - Bump `MGB_VERSION` (index.html:205).
  - FEATURE_FLAGS (app.jsx:913): none (owner decision Q6: no kill switch).
  - INFRA_LINKS (959): no change.
  - resettableLocalStorageKeys (13682): no new keys.
  - PAGE_META (25999): no new page.
- **Usage Stats:**
  - Exclude View as activity from per-person counts: `usage_summary` gets `and not view_as` (SQL §4.5, same new file).
  - Optionally add a "Browser" column to Active people later.

**Added 2026-10-23 (surfaces in §10). Do these in the same commit as the rest; use the `mgb-ui-upkeep` and `mgb-launch-kit` skills.**
- **Guide articles, beyond the list above:**
  - `workbench.md` and `home-page.md`: in View as, Today is the classic view; the Desk is private to the person.
  - `my-tasks.md`, `work-page.md` and `tasks-own-window.md`: Slate in View as is a read-only snapshot, with no pop-out, and private tasks are hidden.
  - `staff-handbook.md`, `quarterly-reviews.md`, `review-cycles.md`, `new-hire-onboarding.md`: what HR shows in View as.
  - `employee-records.md`: never shown in View as.
  - `staff-management.md`: View as and Last seen now live on **HR › Members**. Fix any "Team › Members" wording there and in `team-page.md`, `admin-guide.md` and `temporary-access.md`.
  - `ledger-review.md`: no auto-pull in View as.
  - `quick-actions.md`: ⌘K in View as.
  - `preview-as.md`: whole app, including HR.
  - Then run `grep -ril "view as" docs/staff-guide` again (21 files at 646d3ac) and fix any "hidden in View as" wording.
- **Tours (`components/tour/Tour.jsx`):**
  - The bookkeeper tour `sub` (~1484) still says "Their day: Today, their clients and a client's pages". Change it to "Their day: Today, Clients, Inbox, Work, Team and HR". The non-View-as text "Your day: … Inbox, Work and Team" also misses HR, so fix it in the same edit.
  - Remove the "stops are left out during View as" comment.
  - `TOUR_StaffRoot` (~2287-2458) builds stops from `NAV_visiblePlaces` with `impersonating`, so the HR, Work and Team stops come back on their own. Check that each stop's target exists on the placeholder screens, or skip it.
  - The admin (~1492), temp-admin (~1498), account-manager (~1508) and Slate (`tasks`, ~1518) tours stay `!impersonating`.
  - The admin tour's Members stop (HR › Members) gets one sentence: "View as is read-only; Last seen shows when they were last on."
- **Tips (`components/tour/Tips.jsx`; the §6 "Tips.jsx" lines above mean this file):** the `members-last-seen` tip from the old patch must match `r.page === "hr" && TIPS_tab("tp-tab-members")`. The old match was `team`. Keep its copy word-for-word with `docs/staff-guide/tips.md`. `TIPS_Root` stays off in View as (Tips.jsx:1114).
- **Announcement (launch notice), admins only.** Add one entry to the **`components/tour/announcements.js` registry** (Announcements.jsx renders it), following that file's header conventions:
  - `id: "view-as-whole-app"` (never reuse)
  - `date`: the ship day
  - `title: "View as: the whole app"`
  - `summary: "See any bookkeeper's whole app, read-only, and check when they were last on with Last seen."`
  - `roles: ["admin"]`: real admins only; `tempAdmin` is left out because Members is read-only for them and Last seen is admin-only
  - `hash: "#/hr/members"`
  - `steps`: 3-4 stops built with `TOUR_tabStep("hr", "members", …)`, pointing at `[data-tour="members-last-seen"]` and the View as button
  - The notice is already suppressed while impersonating (Announcements.jsx:214, announcementsLogic.js:107).
  - It also lists in What's new › Launches and the ? menu automatically.
- **README:** add "every new read RPC reachable by a bookkeeper must be classified in §3.1a (allow / silent deny)" to the Tasks, Desk and HR sections' developer notes, not just Security notes.

---

## 7. Open risks

0. **The guard is client-side.** It is a UX net. The admin's JWT can still write through devtools, and nothing in this spec relies on the guard to hide data (D1).
1. **Read RPCs we block by mistake.** These break a page quietly (a toast fires). Mitigated by the `[view-as] blocked` console warnings, `view_as.blocked` audit rows and sweep 5.2-2. Every newly added read RPC must be added to §3.1a, so the README Security notes must say so.
2. **Writes that use GET** (none known; PostgREST runs GET in a read-only transaction, so a GET RPC can't write) or **other origins** slip past. Drive download links (`drive-files?t=`) are GETs that only log failures. Low.
3. **Websocket sends** (realtime presence and typing on joined channels) are not covered by the guard. Mitigated by never mounting team chat in View as and keeping TK_sync off; the HTTP broadcast fallback is covered by default-deny. Review must grep for `.track(` and `.send(` in components reachable in View as (today only app.jsx:15762 and 15825).
4. **Stale admin data in shared stores.** TK_store, CS_store, the TR overview cache and `HB_statusStore` may hold the admin's rows from before View as. TR and HB are cleared on start/stop (D6); TK_MyTasks uses a separate snapshot; ClientSwitcher recents are keyed by eff (read-only in View as); `SO_store` (shoutouts) and the L1 sidebar's real-email pins/recents are filtered or hidden (§3.7). Any other module-level cache found in the build sweep gets the same treatment: filter to eff or hide, never show it as theirs.
5. **view_as.stop on pagehide** may not land even with `keepalive`, so the audit can show a start with no stop. Documented.
6. **Last seen accuracy.** Rows before this ship have no browser. Rows before 4.1b/4.2 may carry spoofed emails or timestamps (low; app-only writer). A person can still put any text in their own rows' page/browser fields, so the dialog renders it as text. Errors are capped at 5 per load.
6a. **JWT-"me" reads on the allow-list** (bookkeeper_public_profile, can_view_internal, is_internal_owner, client_reply_times, client_team_profiles, staff_performance) answer for the admin. They show no data the admin can't already see, but a page using them may look subtly different from the bookkeeper's real view. The sweep notes any such page.
7. **Not fully audited** (grep-level only in the component audit): TaskTemplates, ClientClosePage, TeamQbo, TeamProfit, TeamCapacity, QboUsage, SopFreshness, HealthBoard, ClientHealth, LR_api internals, TxnQuestions, QboGiving. Most are admin-only (hidden), and the guard covers their writes. The build sweep must open each page reachable in View as. The 2026-10-23 critique also did not read in full: StaffInbox's `me` / read-marker code (§3.7 already covers it), whether a client open auto-runs `qbo-sync` (the functions block stops it; the sweep must see zero toasts), CloseTracker's ensure-on-load, and announcement/tour "seen" writes (gated off by N6). The 5.2-23 toast-free sweep is the check for all of them.

### 7a. Rollback and preview flag
- **No preview flag.** The owner rule is a flag only when a half-built change would disrupt others. View as is an admin-only tool, every change is gated on `impersonating` (which only a real admin can set, §3.2), and non-admins see no difference. Last seen is a new admin-only button. Ship directly, with no kill switch (Q6).
- **App rollback** is a plain code revert of the build commit. Nothing persists in the browser that a revert would trip over (no new localStorage keys; `window.mgbViewAs` lives in memory).
- **SQL rollback is not needed for an app revert.** Every SQL change is additive or tighter and compatible with the old app:
  - the new `usage_events` columns have defaults or allow null, and the old app simply doesn't send them;
  - the timestamp triggers and the `client_errors` policy only reject rows the app never sends (another person's email, oversize text);
  - `log_audit_event` keeps every action the old app uses;
  - `usage_summary` only drops `view_as = true` rows.
- If one piece must be undone: drop the two triggers; re-run `audit-log.sql` for the old `log_audit_event`; recreate the old `client_errors` insert policy (`auth.role() = 'authenticated'`); `drop function staff_last_seen(text)`; undo the 4.5 patch by running the same `pg_temp.patch_fn` call with the two anchor texts swapped (re-running `internal-company-profile.sql` would not remove it). Leave the columns: dropping them would lose data.

## 8. Owner decisions (decided 2026-10-15)

- **Q1 Approve:** (A) disabled Approve + "Exit View as to approve". **Accepted.**
- **Q2 Inbox:** placeholder plus links to their clients' Messages. **OK for v1.**
- **Q3 Private tasks:** **hide** `visibility='private'` items in View as (D6).
- **Q4 Temporary-admin bookkeepers:** preview only their bookkeeper role. **Do not preview temporary admin pages.**
- **Q5 Retention:** **no automatic deletion** of `usage_events`, `client_errors` or `audit_log`. Not requested.
- **Q6 Kill switch:** **none.**

---

## 9. Critique resolutions (Opus review, 2026-10-15)

Each claim was checked against the code in `wt-viewas` and, read-only, the live database. Fixed in place above:

1. **Guard default was allow.** Unknown Supabase paths with POST (`/realtime/v1/api/broadcast`, `/graphql/v1`) passed. Now default-deny for any non-GET/HEAD on the Supabase origin, and the wrap must run before `createClient` because realtime-js captures `fetch` at construction (D2, §3.1).
2. **URL objects and relative URLs slipped through** (`input.url` is undefined on a `URL`). The guard now resolves `input.href || input.url` with `new URL(raw, location.href)`; RPCs are matched by name for every method, GET included.
3. **`/auth/v1/*` was fully open**, including `PUT /user` (email/password change) and `/otp`. Narrowed to token refresh, logout and `GET /user`.
4. **Storage** prefixes made exact; signed *upload* URLs (`/object/upload/sign/`) stay blocked.
5. **drive-files was blocked outright**, which broke Files and poisoned `DRV_connectedCache` as "not connected" for 60 s after exit. `status`, `list` and `link` are now allowed by body action.
6. **Intentionally denied reads toasted on page open** (Today and Team fire `tr_my_overview` / `hb_status` unconditionally). Added a silent deny list, `enabled` flags on `TR_useOverview`, `HB_useStatus`, `TP_use*Due`, `TD_useHandbookItems`, and cache clears on start/stop so the admin's data never shows in either direction.
7. **`record_app_time` was missing** from the allow-list, so the App time flush on entering View as would toast and lose the admin's minutes.
8. **Hours placeholder was wrong.** `qbo_my_client_hours` is per-client, not the admin's personal figures; it's allowed and the Clients hours column works normally.
9. **RPC list errors.** `tk_search` removed (exposes private tasks, Q3). `get_report_share` is STABLE, the "may create a share" reason was wrong. "LR_api read RPCs" is just `gl_review_portal_addressees`. JWT-"me" reads flagged (risk 6a).
10. **`CF_useShowTest(null)` would not work**: the hook prefers `window.mgbViewerEmail`. Now: set `mgbViewerEmail` to eff and disable the toggle. The claim that `mgbViewerEmail` drives `CF_isAssigned` flags was wrong (`CF_pick` ignores it; `flagMe` already uses eff).
11. **Q3 applied** to every task reader reachable in View as, failing closed.
12. **Handbook list** limited to `version_id, signed_at, countersigned_at`; IP, user agent and typed name never selected.
13. **Client Messages attribution**: the admin's bubbles showed as "mine". `me` = eff for display; unread hidden.
14. **`detail = 'view-as'` collided** with `MGB_track`, which already writes `detail` on action rows. Replaced by a `usage_events.view_as` boolean; `usage_summary` and `staff_last_seen` filter on it, so previews never make the admin look active.
15. **Forgeable timestamps.** `occurred_at` / `created_at` were client-settable, so anyone could look "last seen" forever. BEFORE INSERT triggers force `now()`.
16. **Forgeable audit rows.** Any active staff could log `view_as.*` naming anyone. Now admin-only.
17. **`search_path`** on both security-definer functions is `public, pg_temp`. `p_email` is only a bound value (no injection). Temp admins are role `bookkeeper` in SQL, so `is_active_staff_admin()` excludes them server-side (staff-admin-policies.sql:29). Live check: 0 mixed-case emails.
18. **pagehide stop** used `sb.rpc`, which awaits `getSession` and dies on unload. Now raw `fetch` with `keepalive` and a cached token. Sign-out awaits the log first.
19. **Q5 and Q6 applied**: the 180-day cron and the kill-switch flag are removed.
20. **Last seen button** moved outside the `row.role !== "admin" && row.active` condition so it shows for admins and inactive staff.
21. **Upkeep gaps**: added staff-handbook, quarterly-reviews, inbox, work-page, my-tasks, google-drive-files guide pages; fixed the tour path to `components/tour/Tour.jsx`.
22. **Smaller accuracy fixes**: celebrations show admin-only birthday fields in View as (hide them); the Feedback modal is the admin's own, so it's labelled rather than replaced; a new window (Tasks, TK_keys.jsx:289) is the admin's normal app; `TP_TeamHub` already passes `isRealAdmin=false` in View as.

Checked and found correct: line refs for start/stop, effectivePage, usage insert, StaffNav, ProBudget, TeamPage, Tips, TopBar, preview bar and page mounts; `siStaffChat` already excludes View as; `ST_store` and `WD_sync` are paused; all user-triggered `qbo-sync` invokes hit the function block.

---

## 10. Drift addendum (2026-10-23, origin/main 646d3ac)

Surfaces added or changed since 2026-10-15. Line numbers are from 646d3ac. Every decision follows D1 (read-only), D6 (show only what an admin can already read and the bookkeeper would see; otherwise "Private to {name}") and Q3 (hide private tasks, fail closed). Where this section disagrees with §1-§9, this section wins.

**Summary of new decisions**
- **N1.** Today in View as is always **Classic Today**. The Desk never mounts.
- **N2.** Work › Slate in View as is a **read-only snapshot** of the bookkeeper's non-private tasks. It is never TK_store, and it has no pop-out.
- **N3.** The **HR place is visible** with Handbook (placeholder + signed list), Reviews (placeholder) and Onboarding (read-only). Employee records and Members stay hidden. The HR rail badge is hidden.
- **N4.** Client › Ledger **does not auto-pull** in View as.
- **N5.** ⌘K in View as never calls `tk_search`, and drops private rows.
- **N6.** Announcements, Tips, StaffPhotoGate and the admin, temp-admin, AM and Slate tours stay off in View as. They are already gated; keep the gates.
- **N7.** No localStorage writes keyed by the bookkeeper's email in View as. Reads fall back to defaults.
- **N8.** Last seen lives on **HR › Members**, not Team › Members.

### 10.1 Today and the Desk (Workbench)
- **Shows:** the Desk (Needs you list, tiles, right-side Desk drawer, `WB_NavBadge`) when `tk_settings.wb_enabled` is on, or this browser's `mgb_wb_preview` is set. Otherwise it shows Classic Today.
- **Data:**
  - `wb_inbox(p_scope)` is JWT "me". `v_me` drives scope `mine`, coverage (`a.backup = v_me`) and per-person state (`wb_item_state.staff_email = v_me`).
  - The preview flags are this browser's localStorage, so they are the admin's, not the bookkeeper's.
- **Writes and side effects:** `wb_mark_file_checked`, `wb_mark_no_reply`, `wb_snooze`, `wb_unsnooze`, `wb_undo_*` (all JWT-stamped writes), a `WB_REFRESH_MS` poll, and the `mgb-wb` BroadcastChannel.
- **Decision: Classic Today**, which is already the code:
  - `TD_TodayPage` uses `wbOn = !!wbSwitch && !impersonating` (Today.jsx:1268).
  - `WB_deskMounts` returns false when impersonating (WB_logic.js:1380).
  - `WB_NavBadge` is `!impersonating` (app.jsx:2091, 2528).
  - Keep all three gates.
  - A real Desk "as the bookkeeper" is impossible without new SQL: snoozes and checks are keyed to the JWT.
- **Add:** when `WB_useSwitch()` is true, Today shows one muted line under the preview bar: "{First}'s Desk is private to them, so View as shows the classic Today."
- **Add:** put `wb_inbox` on the silent deny list. In `stopImpersonating`, call `WB_store.refresh()` when it exists, so the admin's Desk is current after exit.
- **Keep:** Classic Today's existing D6 rules (private items hidden, handbook items off, ticks disabled).

### 10.2 Work › Slate (tasks tab, label "Slate")
- **Shows:** `WK_WorkPage` tab `tasks` renders `<TK_MyTasks embedded staffUser={eff} …/>` (WorkPage.jsx:87). It reads **TK_store**.
- **Data:**
  - TK_store is filled by `TK_sync.start(email)` and `TK_slateBoot` only when `tkHosts` (app.jsx:29554, `!impersonating`).
  - During View as, sync is stopped, but **TK_store still holds the admin's own tasks from before View as**. Without a change, the bookkeeper's Slate would show the admin's tasks. This is the most serious current leak-by-mislabel.
  - View prefs are localStorage `mgb_tk_slate_view_v1:<email>` and `mgb_tk_slate_base_v1:<email>` (TK_viewLogic.js:1444, 1606).
  - The firm switch `tk_settings.slate_app_enabled` and the per-browser `mgb_slate_classic` decide whether **Open in own window** shows.
  - Month rhythm (`tk_set_client_rhythm`, being built in parallel) is a write.
- **Writes and side effects:** every `tk_*` write, including bulk, undo, claim, status and project ones. Also `TK_SlateLaunch` / TK_SlateBridge (`mgb-slate` BroadcastChannel and a new window, which is the admin's ordinary app), and `MGB_track("slate-app-mode")`.
- **Decision: snapshot (the old §3.6 plan), now required, not optional.**
  - In View as, `WK_WorkPage` passes `snapshotFor={eff.email}`.
  - `TK_MyTasks` with `snapshotFor` never reads TK_store. It loads `TK_api.listFor(eff.email)` (assignee = eff, `.neq("visibility","private")`, fail closed on a missing `visibility`) into local state.
  - It renders rows read-only, with no checkbox, drawer, quick-add, bulk bar, pop-out or project actions, and a "Read-only preview" chip.
  - Group and sort chips work in memory and are **not** saved to localStorage (N7).
  - `TK_ReviewQueue`, `TK_WaitingList` and `TK_Sidebar` are not mounted in snapshot mode. If a later build mounts them, they must pass eff to `tk_review_stats` / `tk_on_time_stats` (`p_email`) and filter `tk_waiting_on_client` rows to eff's clients.
  - `tkHosts` stays false. `/tasks` still redirects in View as; change the redirect to `work` (tasks tab), per §3.2.
- **Per-person preview flags:** ignored in View as. They are the admin's browser flags, and snapshot mode has no pop-out.

### 10.3 HR place (Handbook, Reviews, Onboarding; Employee records and Members hidden)
- **Shows:** NAV_PLACES `hr` (StaffNav.jsx ~105) has tabs handbook, reviews, onboarding, employees (`admin`, `realAdmin`) and members (`admin`). It is `visible: !ctx.impersonating` today and routed via `effectivePage` with `"hr"` in the `!impersonating` list (~28625-28645).
- **Data:**
  - `HB_HandbookTab staffUser={eff}` reads `hb_status` (JWT), `hb_approver_access` and `hb_get_policy`.
  - `TR_TeamReviewsPage` (no props) reads `tr_my_overview` / `tr_get_review` (JWT).
  - `SON_ProgressTab` reads `StaffToolsContext.staffUser` (eff) and shows `SON_MyStepsTab` for a non-admin. Admins can read all `staff_onboarding_progress` rows, so this is faithful.
- **Badges:**
  - `TP_HrNavBadge` (TeamPage.jsx:589; rail app.jsx:2100 and 2542) calls `TP_useReviewsDue` + `TP_useHandbookDue`. Both are unconditional, and `TP_useHandbookDue` now returns `{n, sign, approve}`.
  - `TP_TeamHub` calls both again for the tab badges.
- **Writes:** `hb_sign`, `hb_countersign`, the HB PDF (`HB_api.js:134` raw fetch to a function), `tr_*` saves, and onboarding ticks.
- **Decision:**
  - Remove `!ctx.impersonating` from `hr` and add `"hr"` to the opened pages in `effectivePage`.
  - Tabs follow `NAV_visibleTabs` with `isAdmin = staffIsAdmin` (false in View as, app.jsx:29571), so **Employee records and Members never show** in View as.
  - Additionally, `TP_TeamHub` must refuse `current === "employees" | "members"` when `viewingAs`, in case a hash names them.
  - **Handbook:** `VA_PrivatePlaceholder kind="handbook"` plus the read-only signed list (D6 columns only). `HB_HandbookTab` is not mounted.
  - **Reviews:** `VA_PrivatePlaceholder kind="reviews"`. `TR_TeamReviewsPage` is not mounted.
  - **Onboarding:** show it, with ticks disabled (`canTick={!MGB_viewAsReadOnly()}`).
  - `TP_useReviewsDue(enabled)` and `TP_useHandbookDue(enabled)` take an `enabled` argument; when false they return `0` / `{n:0, sign:0, approve:0}` and skip `TR_useOverview(false)` / `HB_useStatus(false)`.
  - `TP_HrNavBadge` gets `viewingAs` and returns null, or the rail passes nothing while impersonating (both rail sites).
  - Move the §3.5 placeholders from the Team hub to the HR hub. `TP_TeamHub` gets `viewingAs`.
- **Members (admin, real):** `renderMembers` → `StaffAccessPage staffUser={real} readOnly={role!=="admin"}`. The **Last seen** button and the View as button live here (N8). Place `SA_LastSeenButton` as §3.2 says, `{!isSelf && !readOnly && …}`.

### 10.4 Client pages (new or changed tabs)
- `STAFF_CLIENT_TABS` (app.jsx:1513) at 646d3ac: client-overview, messages, documents, bank, client-close, client-ledger, reports, sop, milestone.
- **Client › Ledger (`LR_LedgerTab`):**
  - On first load it calls `LR_api.loadContext` (table GETs on `qbo_connections`, `gl_review_*`, `client_profile`; fine) and then **auto-runs `doPull`** when connected and uncached (LR_Tab.jsx ~494-509).
  - `doPull` → `functions/v1/qbo-gl-review` (a QBO call) → `gl_review_upsert_flags`, `gl_review_hide_dup_flags`, `gl_review_mark_fixed` (writes).
  - Under the guard this toasts and logs `view_as.blocked` just from opening the tab.
  - **Decision:** skip the auto-pull when `MGB_viewAsReadOnly()`. Show the stored flags with "Read-only: showing the last pull." Disable Pull, Clear, Ask, Send back, Mark reviewed, Approve and Summary send. `gl_review_portal_addressees` is allowed.
- **Client › Close (`CLC_ClientClosePage`, CloseTracker):** reads are client-scoped (`tk_close_optin_status`, month_close GETs). A Close tick invokes `qbo-gl-review` `baseline` (CloseTracker.jsx:377), but only after a write, so it is already blocked. Read-only; ticks disabled.
- **Client › Documents / Needs (`ClientNeeds.jsx`):** `client_requests_for_client` and `tk_client_report_state` are allowed. Ask-client sends (`tk_client_request_send`, `tk-client-requests` function) are blocked.
- **Clients page (`CL_ClientsPage`):** filtered to eff's assignments. `client_health` and `qbo_my_client_hours` are allowed. Request access is already off (`TB_ClientPicker canRequest={!impersonating}`). The Show test clients toggle is disabled (D6).
- **Work › Ledger review (file review, `LR_ReviewFilePage`):** parses an uploaded file in the browser and saves nothing. Allow it as-is.

### 10.5 Team place (People, Performance, Inventory)
- Admin tabs (Hours, Reply times, Feedback, Ledger review settings) are hidden by `isAdmin=false`. No change.
- **People:**
  - `staff_directory`, `staff_celebrations` (hide the birth year), `client_profile` backups (`TP_MyBackupsCard`, eff) and `tk_my_coverage`.
  - `tk_my_coverage` is new: admin JWT returns every handoff. Keep only rows with `from_email` or `to_email` = eff.
  - Shoutouts and time off are read-only (§3.7).
- **Performance:** `staff_performance` (admin gets all rows); show only the eff row (already `mine` by eff).
- **Inventory:** `TI_TechTab staffUser={eff} isAdmin={false}`, read-only. The `tech-inventory` export function is admin-only and blocked.

### 10.6 Announcements, tours, tips and the photo gate
- **Announcements:** `ANN_Root` (Announcements.jsx:231) has `available: !ctx.impersonating` (214), and announcementsLogic.js:107 blocks while impersonating. Its writes go to `staff_announcements` and its report RPC is admin-only. **Keep off.**
- **Tips:** `TIPS_Root` is off when impersonating (Tips.jsx:1114). Keep off.
- **Tours:** only the bookkeeper tour is available in View as. The rest are `!ctx.impersonating` (Tour.jsx ~1492-1523). Copy changes are in §6.
- **StaffPhotoGate:**
  - Its mount was removed from app.jsx.
  - `staffPhotoLogic.js:31` returns false when impersonating.
  - `sp_my_photo_status` (VOLATILE, JWT, the admin's own) goes on the silent deny list in case a profile card calls it.
  - `sp_staff_photo_paths` (avatars) is allowed.
  - `ST_useMyProfile` is already null while impersonating (TopBar.jsx:1487).
  - **Keep off.**

### 10.7 Inbox
- At 646d3ac it is unchanged: `StaffMessagesPage staffUser={real}` (app.jsx ~30700), and the place is `!ctx.impersonating`.
- **Decision unchanged (Q2):** show the place with `VA_PrivatePlaceholder kind="inbox"` plus links to eff's clients' Messages tabs.
- Never mount `useStaffTeamChat`. Its `.track` / `.send` are app.jsx:16257 and 16320.
- If Workbench Phase 3's single inbox lands first, treat it like the Desk (§10.1): JWT-keyed state means a placeholder.

### 10.8 ⌘K palette (TopBar `TB_Search`)
- Local tasks come from `TB_useMyItems(eff)`, which is `staffItemsApi.list`. Drop `visibility === "private"` rows and rows missing `visibility`.
- Server hits come from `TK_api.search` → `tk_search` (TopBar.jsx ~534-555). Add `&& !MGB_viewAsReadOnly()` to `canSearch`. `tk_search` also stays on the silent deny list.
- SOP and help hits (`search_staff_guide`, notes GETs) are fine.

### 10.9 Network surface check (646d3ac)
- **Raw fetch and invoke callers:** listed in D2. The set has no new raw `fetch` callers since 2026-10-15; only line numbers moved. New invoke callers: `qbo-gl-review` (§10.4, the only one that fires on open), `gl-review-send`, `tk-client-requests`, `tech-inventory`, `qbo-firm-sync`.
- **Realtime:** still only the two team-chat sites. The BroadcastChannels (`mgb-wb`, `mgb-slate`) are same-browser messages, not network. Nothing they carry writes, and the receiving window is the admin's ordinary app.
- **localStorage keyed by email:** Slate view and base keys (§10.2), `CF_useShowTest` (D6, toggle disabled) and ClientSwitcher recents (keyed by eff; reading is fine, don't write in View as). Rule N7 covers new ones.

### 10.10 Riskiest open questions (decided; owner away and approved best recommendations)
1. **The TK_store leak (§10.2).** Today, opening Work › Slate in View as would show the admin's own tasks under the bookkeeper's name. **Decided:** snapshot mode is mandatory, and the build is not done until 5.2-16 passes with a seeded admin-only task.
2. **The Desk is not previewable.** **Decided:** Classic Today plus a one-line note. A faithful Desk would need an `as_email` parameter on `wb_inbox`, which widens a JWT-scoped function, and the owner rule "never grant beyond the admin" makes that a separate, reviewed change. Not in this build.
3. **Admin-wide JWT reads** (`staff_performance`, `tk_my_coverage`, `tk_waiting_on_client(null)`, `tk_*_stats(null)`) return more than the bookkeeper sees. **Decided:** allow them, and filter to eff client-side (fail closed). No new data reaches the admin, but the filters are where "never show data the viewed role couldn't see" lives, so the Opus critique must read each one.
4. **Writes that fire on page open** (the ledger auto-pull was one) would toast before the admin clicks anything. **Decided:** the 5.2-23 toast-free sweep is a release gate. Each hit is gated at its caller, not allow-listed.
5. **HR deep links** (`#/hr/employees`, `#/hr/members`) during View as. **Decided:** `TP_TeamHub` refuses them when `viewingAs`, even though the tab list already hides them. `HR_*` RPCs are also admin-only server-side.

---

## 11. Critique resolutions (2026-10-23)

Independent Opus critique against 646d3ac and the live DB (read-only). Fixed in place above; ranked by severity.

1. **`startImpersonating` had no role check** (app.jsx:27869). Only a disabled button stopped a temporary admin, who can open HR › Members. §3.2 now requires a real `role === "admin"` check plus an active, non-admin, not-self target before anything else runs, so the guard stays inert for every non-admin. Test 5.2-24.
2. **A failed `view_as.start` log still entered View as** (`AL_logEvent` only warns). §3.2 now awaits the log and refuses to start if it fails, so every start is audited.
3. **The guide showed admin-only articles as the bookkeeper's.** The admin JWT reads `audience='admin'` rows, and `search_staff_guide` is SECURITY INVOKER. §3.7 limits the list, search, article by slug, ⌘K hits and the ? menu to `audience === 'staff'` in View as, failing closed. §2 row updated. Test 5.2-25.
4. **Hidden shoutouts leaked** through the admin's RLS (`SO_store`). They are now dropped unless eff wrote them, and the Hide control is hidden. Test 5.2-26.
5. **The L1 sidebar's Pinned and Recent lists are the admin's own** (keyed by real email) shown under the bookkeeper's rail. Both are hidden in View as. Test 5.2-27.
6. **Today still called `TR_useOverview()` unconditionally**, and its profile prompt (`ST_useMyProfile(me)`) could open, write `mgb-profile-prompt:<eff>` to localStorage and offer a Save. Both are now gated. Test 5.2-28.
7. **The functions rule was ambiguous for GET.** It now blocks `/functions/v1/*` for every method, except the `drive-files` read actions and the `?t=` download. Test 5.2-29.
8. **`CS_pushRecent` writes the eff-keyed recents** and **`CTC_loadTasks` counted private items.** Both are now named in §3.7, closing N7 and Q3 gaps. Test 5.2-30.
9. **No rollback or preview-flag statement.** Added §7a: no flag is needed (admin-only, gated on `impersonating`). The app reverts on its own because the SQL is additive and compatible; per-piece undo steps are listed, including reversing the `usage_summary` patch.
10. **Last seen email match.** Kept the exact `actor_email = e` match so the index is used. Re-checked live: 0 mixed-case emails in `usage_events` and `staff`, and a comment was added in the SQL. The raw `user_agent` goes only to admins and is parsed and rendered as text client-side (§3.8); no change.

Checked and found correct: every §3.1a allow-list RPC is live STABLE; `record_app_time` / `log_audit_event` are the only volatile allowed calls, and both are telemetry; there are no XMLHttpRequest or sendBeacon callers; the guard wraps before `createClient`; there are no Vercel `/api` routes; the drive-files read actions are RLS-scoped. The new `client_errors` policy keeps current reporters working (they send the JWT email or null) and anon was already blocked. `portal_preview.*` still works for non-admin staff, and `is_active_staff_admin()` excludes temporary admins. The `usage_summary` patch is idempotent and nothing in the SQL is destructive. The Approve exit path (`keepPage`) is reachable only by a real admin. Performance, Inventory and Onboarding already filter by eff.
