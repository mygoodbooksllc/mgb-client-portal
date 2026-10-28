# Slate plus: person profile (spec)

Status: built hidden 2026-10-27 behind the shared Slate plus gate. Nothing changes for anyone with the preview off.

## What it is

This is an Asana-style page for one staff member, inside Slate (portal Tasks page and the Slate app). It answers "what is on Sierra's plate, who does she work with, and is she out?" It only shows things the viewer can already see somewhere else in the app.

## Gate (shared with the Slate plus batch)

- `components/tasks/TK_slatePlus.js` exports `TKP_on()` / `TKP_useOn()`. It is on only when View as is off AND (the per-person preview `mgb_slateplus_preview === "1"` OR the firm switch `tk_settings.slateplus_enabled`).
- The firm switch is NOT SET, so it is off. Code never writes it.
- With the gate off:
  - `#/tasks/person/<key>` still parses as `unknown`, so you get the same "We couldn't find that list." as before.
  - No entry link renders anywhere.
  - No profile query runs. The only read is the shared gate's own one-time `tk_settings.slateplus_enabled` read per page load (cached in `mgb_slateplus_cache`), which the Slate plus gate on main already makes.
  - Every touched component renders exactly the old markup and element tree: rows and Team names check `TKP_on()` with a plain call (no hook or listener per row) and render the old children when it is false.

## Route

- The route is `#/tasks/person/<key>`. It follows the existing Slate route style (`c/<id>`, `p/<uuid>`, `u/<uuid>`).
- Slate's route rule says "no email ever reaches a URL", so `<key>` is not the email. It is a 16-hex-character, non-reversible key: two 32-bit FNV-1a hashes of the lowercased email.
- The page resolves the key against `staff_directory()`, which lists active staff for active staff only. An unknown key shows "We couldn't find that person."
- The key is not a secret. Anyone who can resolve it can already read the directory.
- Admins also get "Open full list" on the page, which links to the existing `#/tasks/u/<uuid>` list.
- `TK_formatRoute({view:"profile", key})` writes the route only for a valid 16-hex key. Anything else formats as My Tasks, the same as today.
- The Lists bottom-bar item counts the profile as a list view.

## Shared helper

- `components/tasks/TK_personLink.js` exports:
  - `TKP_personKey(email)`
  - `TKP_personHref(email)`
  - `TKP_openPerson(email)`
  - `TKP_PersonLink({email, children, className})`
- `TKP_openPerson` uses `TK_navigate`, so it works from inside Slate, and from the Team page (it sets the hash, and App switches to the Tasks page).
- It does nothing when `TKP_on()` is false.
- `TKP_PersonLink` renders `children` unchanged when the gate is off or there is no email.
- The workload strip (sibling agent) calls `TKP_openPerson`.

## Sections and data sources

Every read is an existing RLS-scoped table or RPC read made with the viewer's own JWT. There is no new RPC, view, policy or migration.

| Section | Source | Notes |
|---|---|---|
| Header: name, role | `staff_directory()` (TK_api or `CV_useDirectory`) | Active staff only. Role uses the same label as the person list header. |
| Header: title | `staff_profiles.title` | RLS: own row or admins. Others simply get nothing. |
| Header: photo or initials | `TK_vAvatar` (sp_staff_photo_paths, staff only) | Existing. |
| Header: out of office | `staff_time_off` (all active staff read; same rows as Team › Who's out) | Shows the current or next range within 30 days, plus the note, the same as Who's out. |
| Header: hand-off backup | `client_profile.backup_bookkeeper_email` for the clients they cover that the viewer can see | RLS: is_active_staff AND can_access_client. Shows the most common backup and "N clients". |
| Header: last seen | `staff_last_seen(p_email)` | Called only for real admins (role admin, not temp admin, not View as). The RPC refuses anyone else anyway. |
| This week at a glance | Their open assigned tasks (below) | Open, Due this week (today plus 7 days), Late, Waiting on client. Late has no red tone and no score (grace period: `late_tasks_count_against_staff` off). |
| Their tasks | `TK_api.listScope({assigneeEmail})` (tk_tasks, RLS `tk_row_readable`) through the store list `assignee:<profile key>` (never an email, same rule as `TK_listKey`) | Grouped with `TK_groupMyTasks(tasks, today, {email: person})`: Late (overdue), This week (today plus week), Later, Waiting on client. Same `TK_TaskRow`. |
| Clients they cover | The viewer's `clients` prop (visibleClients: the viewer's own book plus live grants, minus internal unless allowed; admins all) | Bookkeeper or account manager. Internal and test-only clients are left out. |
| Frequent collaborators | Their tasks plus tasks they created by hand (not deleted, not from a template, 90 days, 300 rows) plus their comments' tasks (90 days, 200 comments, `task_id` only) | Count of other people: assignee, creator or reviewer on the same task. Top 6. Only tasks the viewer can read are counted. |
| Recent clients and projects | Same task set, newest activity first | Client names only from the viewer's `clients`; project names only from RLS-scoped `tk_projects`. An unknown id is dropped, never shown as an id. |
| Recent shout-outs received | `SO_store` (staff_shoutouts RLS: non-hidden for staff; admins all) | Filtered to `to_email = person` and not hidden. Latest 5. Client tag only if the client is in the viewer's clients. |
| Hours | none | Team capacity and hours stay admin-only on Team. The profile shows no hours. |

## Visibility matrix

| Data | Viewer = the person | Non-admin staff | Admin (real) | Temp admin | View as | Client |
|---|---|---|---|---|---|---|
| Name, role, photo | yes | yes | yes | yes | route unreachable | never |
| Title | yes | no | yes | no (no admin RLS) | — | never |
| Time off and note | yes | yes (same as Who's out) | yes | yes | — | never |
| Backup | for their clients the viewer can access | only clients the viewer can access | all | only accessible clients | — | never |
| Last seen | no | no | yes | no | — | never |
| Their tasks | own (all, including private) | only shared or involved tasks on clients and projects the viewer can access. Never private tasks of others. Internal clients only with internal access. | everything RLS gives admins | same as non-admin (RLS) | — | never |
| Row editing | TK_canEdit (owner, assignee) | TK_canEdit; otherwise read-only (no done box, status, inline cells) | yes | TK_canEdit (server decides) | — | never |
| Clients they cover | the viewer's own list | the overlap with the viewer's own book plus grants | all their clients | the viewer's list | — | never |
| Collaborators and recent | from readable tasks only | from readable tasks only | everything | readable only | — | never |
| Shout-outs | non-hidden | non-hidden | non-hidden (hidden ones stay on Team) | non-hidden | — | never |
| Hours | none | none | none | none | — | never |

- View as: the Tasks page already bounces to Work, so the profile route can't be reached. `TKP_on()` is false in View as, so entry links never render on Team or in shout-outs. No write and no new RPC exists for the guard to classify.
- Clients: no client route reaches Slate. Every component here is staff-only.

## Entry points (gate on only)

- Slate row assignee:
  - The read-only face becomes a link.
  - The editable assignee menu gets a "See profile" item at the top.
- Admin person list header ("See profile").
- Team › People:
  - Who's out names
  - My clients' backups names
  - Coverage tab staff and backup names (admins)
- Shout-out from and to names.
- Not linked on purpose: Board card avatars (a link inside a draggable card risks breaking drag) and Team › Upcoming.
- The Team load strip (`TK_Workload.jsx`): someone else's name links to `TKP_personHref(email)` (it used to open the admin-only `#/tasks/u/<id>` list for admins; the profile keeps that as "Open full list").

## Mobile

- Single column at 760px and below.
- The glance counts become a 2x2 grid.
- Rows use the existing phone row layout.
- Side cards stack under the tasks.
- No horizontal scroll.

## Upkeep (hidden launch)

- FEATURE_FLAGS `mgb_slateplus_preview` (shared row) and a Dev Tools tk_settings row `slateplus_enabled` (shared).
- PAGE_META: no new page key (the profile is a Slate sub-view under `tasks`). The `tasks` subtitle stays unchanged while hidden.
- localStorage: no new keys.
- README section plus launch checklist.
- Drafts (not published): guide text, next-visit notice and tour in `docs/slateplus-profile-launch-drafts.md`.
- MGB_VERSION bumped.

## Rollback

- Untick the preview. The switch is unset.
- For code, revert the commit. It is additive: new files plus gated branches.

## Self-critique

1. **Client names leaking through tasks.**
   - Row client names come only from the viewer's `clients` list, the same as TK_List.
   - RLS already hides tasks on clients the viewer can't access.
   - Admin `clients` is the full roster, which is right for admins.
2. **Private tasks.** `tk_row_readable` never returns another person's private task to a non-admin. The profile adds no filter that could widen that.
3. **Comments.**
   - We read only `task_id, created_at` of the person's comments, never `body`.
   - `tk_comments` RLS uses `tk_can_read_task`, so comments on tasks the viewer can't read never come back.
4. **Admin vs temp admin.** Last seen and "Open full list" use a real-admin check (`staffUser.role === 'admin'` and isAdmin), because temp admins have no admin RLS and `staff_last_seen` refuses them.
5. **Store side effects.** The new list key `assignee:<profile key>` (no email, matching the `TK_listKey` rule) only holds tasks already in the viewer's store (RLS-loaded). The matcher is additive: existing keys are unchanged, and unknown kinds still return null.
6. **Email in URL.** Avoided with the hashed key. A hash collision between two staff is improbable (64 bits). If one happens, the first directory match wins, and only directory-level info about the wrong person appears, which every staff member can already see.
7. **Hours.** Excluded on purpose. Capacity is admin-only on Team.
8. **Performance.**
   - Four bounded reads when the page opens: tasks (1000), created (300), comments (200), tasks by id (200).
   - Plus `client_profile` for covered clients, and `staff_profiles` for one row.
   - Nothing polls.
9. **Grace period.** Late is a neutral group. There is no score and no red count chip.
10. **Unverified until live:** the RLS behavior is inherited, not new, so no rolled-back SQL test was needed (no new RPC). A live check with a non-admin login is still listed for the owner.
