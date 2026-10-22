# Slate: change a client's bookkeeper from the client list header

Owner request (2026-10-22): "click the current bookkeeper and reassign with a dropdown list".
Small admin control on existing UI. No preview flag, no launch notice or tour (see Upkeep).

## What changes

On a client's Slate list (`TK_ClientHeader`), an **admin** can click the **Bookkeeper** chip and pick
someone else. Everyone else sees the chip exactly as today. The **Backup**, **Account Manager** and
**Reviewer** chips never change. **Assign team** (client with no bookkeeper) stays exactly as it is.

### Flow

1. The Bookkeeper chip is a disclosure button for admins (`aria-expanded`, `aria-controls`, label
   "Change bookkeeper, now {name}"; no `aria-haspopup`, since the panel is inline, not a menu).
2. Click opens the inline panel under the header (same `tk-assign-team` styling as Assign team):
   - **New bookkeeper** select: active staff with an email, sorted by name, the current
     bookkeeper left out.
   - Checkbox, on by default: **Also move {old}'s open tasks on this client to {new}**.
   - Help line: "Moves open tasks on this client that {old} owns and that are on them or on nobody.
     Tasks in review, private tasks, and tasks anyone else owns or is on stay as they are. {old}
     keeps access to the client. No email is sent."
   - **Reassign** and **Cancel**.
3. **Reassign** shows a confirm step in the same panel: "Make {new} the bookkeeper for {client}?
   {old}'s open tasks here move to them." (or "Tasks stay where they are." when unchecked) with
   **Yes, reassign** and **Back**.
4. On success: toast "{new} is now the bookkeeper. Moved N tasks from {old}." (plus "N in review stay
   with {old}." when any), the header reloads, `mgb:tk-team-assigned` fires and `onTeamChanged` runs
   so lists refresh.
5. Esc closes the panel and returns focus to the chip. Works on phones (the panel wraps).

## Server: `public.tk_change_bookkeeper(p_client_id text, p_new_email text, p_move_open_tasks boolean default true) returns jsonb`

New file `supabase/slate-change-bookkeeper.sql`, idempotent (`create or replace`), security definer,
`search_path = public`. Grants: revoke from public and anon, execute to authenticated.
`tk_schema_version` is not touched (Slate-era additive migrations do not bump it).

1. **Caller**: `public.tk__import_caller()` (active admin with a JWT, or a direct database session with
   no JWT; anyone else gets `tk_forbidden`, 42501). Returns the actor for `by`.
2. **New bookkeeper**: must be active staff, else `tk_bad_assignee` (22023).
3. **Client**: must exist and not be MGB (internal) (`is_internal`), else `tk_not_found` (P0002).
   Same internal rule as `tk_import_assign_team`. Test clients are allowed (admins use them to try
   things). The client row is locked (`for update`) so two admins cannot race.
4. **No bookkeeper yet**: `tk_no_team` (22023); the caller uses Assign team instead.
5. **Same person**: `tk_same_bookkeeper` (22023).
6. `update clients set assigned_bookkeeper_email = <new>`. This is the same column the Client Roster
   edit writes; the existing triggers do the rest: `clients_bookkeeper_before_write` refreshes the
   display JSON (keeps its role text) and `clients_bookkeeper_after_write` grants the new bookkeeper
   `staff_client_access`. No second path.
7. The new bookkeeper joins the client's live projects (`tk_projects` with `archived_at` and
   `trashed_at` null) as `member`, `on conflict do nothing`.
8. If `p_move_open_tasks`: inside the `mgb.offboarding` + `mgb.tk_import` guards (exactly as
   `tk_import_assign_team`; reset right after), update `staff_reminders` on that client where:
   - `deleted_at is null`, `status not in ('done', 'ready_for_review')`, `kind = 'task'`,
     `visibility <> 'private'`;
   - owner `staff_email` = old bookkeeper, and `assignee_email` is null or = old bookkeeper.
   Owner becomes the new bookkeeper; the assignee becomes the new bookkeeper only if it was the old
   one (unassigned stays unassigned and claimable).
   Matching tasks that are in review are counted, not moved (`tasks_in_review`).
9. Audit: `audit_write('client.bookkeeper_changed', client, 'client', client, {from, to, tasks_moved})`,
   the existing firm-wide audit helper. Labeled in the Audit log page.
10. Returns `{client_id, old_bookkeeper, bookkeeper, tasks_moved, tasks_in_review, projects_joined, by}`.

## Client code

- `TK_api.changeBookkeeper(clientId, newEmail, moveOpenTasks)` next to `assignTeam` (same
  `rpcWrite` + `afterWrite(null)`), resolves with the jsonb.
- Pure wording and picking in `components/tasks/TK_bookkeeperLogic.js` (loaded after
  `TK_clientLogic.js`), node test `TK_bookkeeperLogic.test.js`: eligible staff, checkbox label, help
  text, confirm text, success text, error text.
- Error copy: `tk_forbidden` "Only admins can change the bookkeeper.", `tk_bad_assignee` "Pick
  someone who's active on staff.", `tk_not_found` "We couldn't find that client.",
  `tk_same_bookkeeper` "They're already the bookkeeper.", `tk_no_team` "This client has no bookkeeper
  yet. Use Assign team." (the last two reload the header).

## Critique (adversarial pass) and what changed

| Risk | Finding | Decision |
|---|---|---|
| Security | Function is definer; a bookkeeper calling it directly must fail | `tk__import_caller` raises `tk_forbidden` for any JWT that is not an active admin, and for anon/authenticated with no email. anon has no EXECUTE. Tested. |
| Grants | Helper `tk__import_caller` is not executable by authenticated | Fine: definer functions call it as owner (same as Assign team). |
| RLS | The RPC bypasses RLS on clients and staff_reminders | Only after the admin check; it touches one client's rows only. |
| Second path | Writing staff_client_access ourselves would duplicate the trigger | Only `update clients`; the trigger grants access. Tested. |
| Same bookkeeper | A no-op update would still move tasks to the same person | `tk_same_bookkeeper` before any write. UI also leaves the current one out of the list. |
| No bookkeeper | Changing from nothing is Assign team's job (it also handles parked import tasks) | `tk_no_team`. UI only shows the chip button when there is a bookkeeper chip. |
| Legacy bookkeeper (display name, no email) | No chip (tk_client_people needs a staff row) and Assign team hidden | Unchanged from today; Client Roster handles it. Noted, out of scope. |
| Inactive old bookkeeper | tk_client_people shows only active staff, so no chip | Same as above; offboarding normally moves the client. The RPC itself allows it. |
| Inactive or unknown new person | | `tk_bad_assignee`; `tk_project_members` would also refuse. |
| Internal client | MGB (internal) has its own rules | `tk_not_found`, like Assign team. |
| Test clients | Assign team refuses them (import-only); here admins may try it on a test client | Allowed. |
| Tasks in review | Reassigning in review is refused by the task trigger (M3) unless bypassed; moving would also risk the reviewer reviewing their own work | Kept with the old bookkeeper and counted (same rule as time off). |
| Private tasks | Personal notes of the old bookkeeper | Never moved (same rule as time off). |
| Owned by someone else, or assigned to a third person | Must never be touched | Filter is owner = old AND assignee in (null, old). Tested both ways. |
| Owned by someone else, assigned to the old bookkeeper | Not moved (owner rule). | Known gap: use Slate's select-many reassign. Stated in the guide. |
| Email | Assignee change fires `notify_enqueue_task_assigned` | `mgb.tk_import = 'on'` skips it; the review notifier only fires on entering review, which never happens here. outbox count tested unchanged. |
| Guards leaking | `set_config(..., true)` is transaction-local, but a later statement in the same transaction would still see it | Reset to '' right after the update, like Assign team. Tested. |
| Recurring | Role-based templates resolve the bookkeeper when they issue, so new periods go to the new person. Templates naming the old person by email are not changed. | Stated in the guide; admin edits the template. Series roll-forward copies the moved task's owner, so it follows. |
| Followers | The old bookkeeper stays a follower on moved tasks (the new one is added by the autofollow trigger) | Kept, like offboarding and time off. They can unfollow. Open question for the owner. |
| Old bookkeeper's access | Removing it would also clear the bookkeeper via `sca_clear_assigned_bookkeeper` if done wrong | Never touched; the old bookkeeper keeps `staff_client_access`. Tested. The admin removes access on the Team page if wanted. |
| Backup | New bookkeeper may already be the Backup | Allowed; both chips then show the same person. The admin changes the backup on the client page. |
| Concurrency | Two admins at once | `select ... for update` on the client row; the second sees the new bookkeeper (and gets `tk_same_bookkeeper` or moves only that person's tasks). |
| Audit | The clients audit trigger ignores bookkeeper changes | `audit_write('client.bookkeeper_changed', ...)`; access grant already logs `client_access.assigned`. |
| Rollback | | Undo by running it again the other way, but that also moves the new bookkeeper's own earlier open tasks on the client, and access and project membership stay in place. The function can be dropped with `drop function public.tk_change_bookkeeper(text, text, boolean)`; nothing else depends on it. |

## Tests

- `supabase/slate-change-bookkeeper-tests.sql` (ends in ROLLBACK; people picked at run time; throwaway
  client): admin ok; bookkeeper forbidden; bad assignee; not found (missing and internal); no team;
  same bookkeeper; move scope (own unassigned and self-assigned move; third-person assignee, third-
  person owner, done, private and in-review do not); `p_move_open_tasks = false` moves nothing; new
  bookkeeper gets access and project membership; outbox unchanged; old bookkeeper's access stays;
  guards reset; audit row written; anon cannot execute.
- `components/tasks/TK_bookkeeperLogic.test.js` (node).

## Upkeep

Staff guide (task-lists-and-projects, admin-guide, whats-new, audit-log), tips catalog text unchanged
(no target moved), What's new, README, `MGB_VERSION`. No new page, flag, storage key or service, so no
`PAGE_META`, `FEATURE_FLAGS`, reset keys or infra links. No launch notice or tour: a small admin
control on an existing header, announced in What's new and the guide.
