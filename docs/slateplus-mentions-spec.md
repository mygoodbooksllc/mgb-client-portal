# Slate plus: @mentions in task comments (spec + self-critique)

2026-10-27. Part of the hidden "Slate plus" batch. Gate: per-person flag
`mgb_slateplus_preview` (Developer tools > Feature flags, reloads) OR firm
switch `tk_settings.slateplus_enabled` (owner-only, NOT SET = off; code never
writes it). One shared check: `TKP_on()` in `components/tasks/TK_slatePlus.js`
(off in View as).

## 0. What already exists (live since Tasks Phase 1/2, 2026-10-11/16)

The brief asked for @mentions from scratch. Most of it is already built and
live for every staff member, NOT behind any flag:

| Ask | Live today | Where |
|---|---|---|
| Typing @ shows an active-staff picker | Yes: `TK_cmEditor` + `TK_mentionMatches` (skips `active === false`) | TK_Comments.jsx, TK_drawerLogic.js |
| Comment stores mentioned staff emails | Yes: `tk_comments.mentions text[]`, always recomputed server-side by `tk_parse_mentions` (active staff in scope only, author removed) | tasks-module-v1.sql |
| One in-app bell notice linking to the task | Yes: TopBar bell item `tkm:<comment id>` (14 days, opens the task), same derived-from-rows pattern as shout-outs (`shout:`); bell setting "Mentions on tasks" | TopBar.jsx, TK_api.listMentions |
| Mentions render highlighted | Yes: `.tk-cm-mention` | TK_Comments.jsx, tk-drawer.css |
| No notice for self-mention | Yes: `array_remove(..., author)` + bell `neq author_email` | |
| No notice for inactive staff | Yes: `tk_parse_mentions` and the email trigger require `staff.active` | |
| Never exposed to clients | Yes: `tk comments read` = `tk_can_read_task` -> `tk_row_readable`, which needs `is_active_staff()`; clients read nothing | |
| Internal company tasks | Read is blocked by `internal_blocked_ids()` in `tk_row_readable`; the email trigger skips anyone failing `tk_staff_has_client` (internal-aware) | internal-company-profile.sql |
| No email | **Differs.** `tk_comments_notify_mentions` enqueues a `staff_task_mention` email (Settings pref `task_mention`, default ON). Not changed here (old behavior must stay byte-for-byte); owner decision, see section 5. |

So this build ships only the gaps, all behind `TKP_on()`.

## 1. Gaps this build closes (preview on only)

G1. **Picker lists people who will never be notified.** Today the list is every
active staff member. Picking someone who cannot see the task (not on the
client, private task by a non-editor, internal company task without internal
access) inserts a highlighted @name, but the server drops it silently: no
bell, no email. With the preview on, the picker lists only people who will
actually see it. When the typed name only matches people who can't, one muted
line says "<Name> can't see this task" (not pickable).

G2. **No feedback after posting.** With the preview on, after a post the
composer shows one polite line: "Jesse and Carmen were notified." and/or "Kim can't see this task, so they weren't notified." and "You
don't get a notice for mentioning yourself." Computed from the saved row's
server-computed `mentions` intersected with the candidates (G1), never from
the client's own guess alone.

G3. **Your own name doesn't stand out.** With the preview on, a mention of the
viewer gets `.tk-cm-mention.is-me` (stronger fill) so you can spot where you
were tagged.

G4. **Internal company hardening for candidates.** `tk_task_scope_ok` returns
true for ANY active admin before the internal check, so a non-internal admin
could be stored in `mentions` on an internal task (never readable or emailed,
but stored). The new candidates RPC adds the internal check explicitly, so the
preview picker never offers them. `tk_parse_mentions` itself is NOT changed
(additive rule); noted as an optional owner-approved hardening in section 5.

## 2. Database (additive, `supabase/slateplus-mentions.sql`)

`tk_mention_candidates(p_task uuid) returns table(email text)`, SECURITY
DEFINER, `search_path = public`, STABLE. Returns empty unless the caller is
active staff and `tk_can_read_task(p_task)` and the task is not deleted.
Returns lower(email) of active staff, excluding the caller, where:
- `tk_task_scope_ok(p_task, email)` (the same rule `tk_parse_mentions` uses), AND
- if the task's client is the internal company: `tk_staff_has_client(email, client)`
  (internal_access + admin), AND
- they will be able to read the comment afterward: the caller can edit the task
  (then `tk_comments_follow` adds them as a follower), or they are an admin,
  the owner, the assignee, an existing follower, or the task is `shared` on a
  client or project.
Grants: revoke from public, anon; execute to authenticated.

Owner-only switch: `slateplus_enabled` must be in `tk__owner_only_key`. As
built: a sibling Slate plus migration had already added it to the live list
(re-read with pg_get_functiondef right before applying, identical to the list
this file would have set), so this file does not recreate the function; the
self-test checks the key. No row inserted.

Self-test `supabase/slateplus-mentions-tests.sql` (one transaction, rolled
back): anon/non-staff get nothing; caller excluded; inactive staff excluded;
a bookkeeper without the client excluded; internal task excludes a
non-internal admin; private task by a non-editor lists only already-involved
people; `slateplus_enabled` is owner-only and has no row.

## 3. Front end

- `components/tasks/TK_slatePlus.js` (shared gate, browser + node):
  `TKP_on()`, `TKP_useOn()`, `TKP_isOn(viewAsRO, previewOn, switchValue)`,
  `TKP_switchValue`, `TKP_previewOn`, `TKP_readSwitch`. Same read rules as
  `TM_gate.js` (one read per page load after a session, cache
  `mgb_slateplus_cache`, event `mgb:slateplus`).
- `components/tasks/TK_mentionsLogic.js` (pure, node tests): `TKM_pickerLists`
  (picker partition; you are in neither list), `TKM_postNote` (G2 line), `TKM_isMe`.
- `TK_api.mentionCandidates(taskId)` -> rpc. Only called when `TKP_on()`.
- `TK_Comments.jsx`: when on, load candidates per task id; pass to the editor;
  show the G2 note after a post; `is-me` class. When off: no call, no new
  markup, same props, same classes (byte-for-byte old behavior).
- `tk-drawer.css`: new classes only (`.is-me`, `.tk-cm-option-off`,
  `.tk-cm-note`).

## 4. Upkeep (hidden feature)

Dev Tools: FEATURE_FLAGS row `mgb_slateplus_preview`, settings row
`slateplus_enabled`, INFRA SQL note, Reset comment for `mgb_slateplus_cache`;
`MGB_VERSION` bump. README section + launch checklist. Guide, notice and tour
text drafted in `docs/staff-guide/drafts/staff-guide-slateplus-mentions.md`,
NOT published.

## 5. Self-critique

1. *Duplicate build risk.* Rebuilding mentions would double-notify and fork the
   bell. Decision: reuse everything live; add only G1-G4. Reported up front.
2. *"No email" vs live email.* Turning off `staff_task_mention` would change
   behavior for everyone (and a localStorage flag cannot gate a DB trigger).
   Left as is. Owner options: (a) keep email (pref per person in Settings >
   Notifications), (b) at launch, gate the enqueue on `slateplus_enabled`, or
   (c) flip the pref default to off. Needs an owner answer.
3. *Candidate rule drifts from RLS.* The "will be able to read" clause mirrors
   `tk_row_readable` by hand. Risk: a future RLS change makes the picker hide
   someone who could read it (false negative) or show someone who can't. Both
   are UX-only: the server still decides who is stored/notified; reading is
   still RLS. Self-test pins today's cases.
4. *Leak through the candidate list.* It returns only staff emails (already
   visible to all staff in the directory) and only to callers who can read the
   task. Clients and anon get nothing. Internal tasks: only callers with
   internal access can read them, and only internal-access admins come back.
5. *Picker lists names the RPC hasn't returned yet.* While the candidates load
   (or if the RPC fails), the picker falls back to today's behavior (all active
   staff) and the G2 note is built from the saved row's `mentions` alone.
   Never blocks posting.
6. *Feedback wrong for handles that aren't staff.* `TKM_postNote` only names
   typed handles that match a known staff handle; unknown @words are ignored
   (same as rendering).
7. *Rollback.* Front end: untick the flag / leave the switch unset. DB:
   `drop function tk_mention_candidates(uuid)` is safe (nothing old calls it);
   the owner-only key (added by a sibling) is harmless.
8. *Concurrency with siblings.* `TK_slatePlus.js`, the FEATURE_FLAGS row, the
   settings row, `index.html` script list and `tk__owner_only_key` may be
   created by sibling agents too: on rebase keep one copy, merge exports and
   descriptions; re-read the live owner-only list right before applying.

9. *Guide drift found while building.* The live guide (`task-details.md`,
   `staff-settings.md`) says mentions are bell only, "no email for now", but
   `tk_comments_notify_mentions` (tasks-p2-3-review.sql) enqueues the
   `staff_task_mention` email and notification-emails sends it (pref
   `task_mention`, default on). Not changed here; fix the wording together
   with the owner's answer to point 2.
