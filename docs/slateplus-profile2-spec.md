# Slate plus: Profile 2, unified search, Team load move (spec + self-critique)

Date 2026-10-28. Size: BIG (new table + RLS, two SECURITY DEFINER read RPCs,
search across the app, permissions). Owner approved all four items; decisions
in the shared brief are final. Builds on `docs/slateplus-profile-spec.md`
(profile v1), `docs/slateplus-workload-spec.md` (Team load strip) and
`docs/slateplus-filters-spec.md` (Slate search box, saved filters).

Status: spec only. No app code, no SQL applied.

---

## 0. Gate and the "off" promise

- Everything here is behind the shared gate `TKP_on()` / `TKP_useOn()`
  (`components/tasks/TK_slatePlus.js`): per-person preview
  `localStorage.mgb_slateplus_preview === "1"` or firm switch
  `tk_settings.slateplus_enabled` (NOT SET; code never writes it). False in
  View as, so View as always gets today's behavior and no new network call.
- Gate off = byte-for-byte today: same markup, same element tree in the DOM,
  same network calls. In particular:
  - the live Slate list search box `TK_SlateListSearch` (67ffc4d) renders and
    filters exactly as now;
  - the portal top-bar search `TB_Search` (TopBar.jsx) is not edited at all;
  - the Slate app top-bar box `TK_SlateSearchBox` / "Search tasks" link render
    as now;
  - the Team load strip renders nothing (it already returns null when off), and
    the Unassigned load line renders nothing;
  - assignee cells render the old button/face;
  - the new RPCs and the new table are never called or read.
- Row-level components use the plain `TKP_on()` call (no hook per row), as in
  profile v1. Page-level components (top bar, Slate bar, profile, Team tab)
  use `TKP_useOn()`.
- No new localStorage keys, no new flags, no new switch.

---

## 1. Name click goes straight to the profile

### 1.1 What changes (gate on)

Every staff name or avatar rendered in Slate is a link to that person's profile
(`TKP_PersonLink` / `TKP_personHref`, `#/tasks/person/<16-hex key>`, never an
email). Reassigning is its own small control. The "See <name>'s profile" item
in the assign menu is removed (that was the redundant second step).

| Place | File / function | Gate on | Gate off |
|---|---|---|---|
| Task row assignee, read-only | `TK_TaskRow.jsx` `TK_vRowAssignee` (`!props.editable` branch) | Face + name is a `TKP_PersonLink` (exists today); title becomes `"Open " + name + "'s profile"` | unchanged old `span.tk-asg` |
| Task row assignee, editable | `TK_vRowAssignee` (button branch) | `span.tk-asg-wrap` holds (a) `TKP_PersonLink` with the face (+ name when `showName`), (b) a separate `button.tkp-reassign` (small swap icon `TK_vIcon name="swap"` or chevron if no swap icon exists, 28px, hit area 32px, `aria-haspopup="menu"`, `aria-expanded`, `aria-label="Reassign. Assigned to " + name` / `"Assign someone"` when empty, `ref={menu.btnRef}`). The button opens the existing "Assign to" menu, now without the `tkp-menu-profile` item. Unassigned: no link; the empty avatar plus "Assign" hint sit inside the reassign button (same as today's empty state). | unchanged old single button + menu (the `tkp-menu-profile` item only ever rendered with the gate on, so removing it changes nothing when off) |
| Task drawer assignee | `TK_DrawerContent.jsx` assignee field (`select#tk-dw-assignee`, ~1418-1483) | A `TKP_PersonLink` (avatar + name) above the select; the select keeps its id/ref and becomes the reassign control, label text "Reassign". Empty: no link. | unchanged |
| Drawer header subline name | `TK_DrawerContent.jsx` (~1997, `· nameOf(task.assignee_email)`) | name wrapped in `TKP_PersonLink` | unchanged |
| Drawer reviewer | review strip (~259-300, `TK_dlNameOf`) | reviewer name is a link; reviewer picker unchanged | unchanged |
| Drawer followers | footer avatars (~700-720) | each avatar wrapped in `TKP_PersonLink` with `aria-label="Open <name>'s profile"` (the initials span stays `aria-hidden`) | unchanged |
| Comment author | `TK_Comments.jsx` `tk-cm-name` (~297) | link only when the author is in `staff_directory()` (resolved through `CV_useDirectory`); client authors (`TK_requestAuthorLabel`) and unknown emails are never links | unchanged |
| Activity actor | `TK_Activity.jsx` (~57) and comment activity lines (`TK_Comments.jsx` ~371) | link when actor is staff (same rule) | unchanged |
| Admin person list header | `TK_List.jsx` ~1020-1036 | the header name/avatar becomes the link; the separate "See profile" link is removed (duplicate) | unchanged (old link was gate-on only) |
| List rows using `assigneeName` | `TK_List.jsx` 554/830/1579 | go through `TK_vRowAssignee`, so covered by the row change | unchanged |
| Team › People names | `TeamPage.jsx` Who's out (951), My clients' backups (1034); `Coverage.jsx` (683, 723) | already links (profile v1) | unchanged |
| Shout-outs | `Shoutouts.jsx` (111/115) | already links | unchanged |
| Team load strip | `TK_Workload.jsx` | already links others to their profile; own chip now links to own profile (was own Slate) | renders nothing |
| Board card avatars | `TK_Board.jsx` 230 | NOT linked (a link inside a draggable card breaks drag; the card opens the drawer, where the name is a link) | unchanged |

### 1.2 Remove the duplicated info

The owner found the menu and the profile "basically the same info". Fixes:
- The assign menu is now only "Assign to" (people list with the current one
  checked). No profile item, no person summary.
- Profile header is trimmed to identity: avatar, name, role pill, title (if
  readable), status line (new), Out pill. The hand-off backup summary and the
  time-off note move out of the header into the single "Out of office" section
  (§4), so they show once.
- "This week at a glance" stays the one place for counts (header shows none).

### 1.3 Keyboard and mobile

- Tab order in a row: done box, title, … person link, reassign button (both
  real `<a>`/`<button>`; link Enter opens profile, button Enter/Space opens the
  menu; Esc closes and returns focus to the reassign button, existing
  `TK_vUseMenu`).
- List key `a` (assign) if bound: the builder must grep `TK_MyTasks.jsx` /
  `TK_listKeys*` for how `a` finds the assignee button (class `tk-asg` /
  `btnRef`) and point it at `button.tkp-reassign` when the gate is on.
- Both controls `stopPropagation` so a click never opens the drawer.
- Phone row layout: the link is the avatar only (name hidden as today), the
  reassign button sits right of it; both ≥ 32px targets.

---

## 2. One unified search

### 2.1 Where it lives (gate on only)

| Screen | Today | Gate on |
|---|---|---|
| Portal staff top bar (`TB_StaffTopBar`, TopBar.jsx ~1854) | `<TB_Search …/>` | `<TKS_SearchBox variant="tb" …same props… />`. `TB_Search` is untouched. `TB_StaffTopBar` calls `TKP_useOn()` once and picks one or the other. |
| Slate app shell bar (`TK_StandaloneBar.jsx` ~309) | `TK_SlateSearchBox` (wide) / "Search tasks" link (narrow) | `<TKS_SearchBox variant="sbar" clients={clients} />` (wide); narrow = icon button that opens the same box as a sheet |
| Slate list toolbar (`TK_MyTasks.jsx` ~1165) | `TK_SlateListSearch` | not rendered when `TKP_on()` (the list text filter moves, §2.6) |
| Slate search page `#/tasks/search` (`TK_SearchView`, TK_List.jsx 1741) | `tk_search` | uses `tk_search_prefix` (limit 25) when the gate is on; same page layout |

View as: `TKP_on()` is false, so the old `TB_Search` (with its existing View
as rules) renders. The new box never mounts in View as.

Clients: the client app uses `GlobalSearch` (app.jsx 3731) and never mounts
either box. Nothing changes for clients.

### 2.2 New files

- `components/tasks/TK_searchLogic.js` (plain JS, pure, node tests):
  `TKS_terms(q)`, `TKS_norm(s)`, `TKS_wordPrefix(hay, terms)`,
  `TKS_escapeLike(s)`, `TKS_rank(row)`, `TKS_cap(groups, caps)`,
  `TKS_flatten(groups)` (keyboard order, skips headers), `TKS_routeFor(item)`,
  `TKS_seq()` (stale-response guard).
- `components/tasks/TK_UnifiedSearch.jsx`: `TKS_useResults(q, ctx)` hook and
  `TKS_SearchBox({variant, clients, items, isAdmin, navCtx, client,
  effectiveTheme, onToggleTheme, onSignOut, onOpenSettings})`.
- CSS in `components/tasks/tk-search.css` (or appended to `tk-profile.css`).
- `index.html` script/link tags next to `TK_personLink.js` / `TK_Profile.jsx`.

### 2.3 Matching

- `TKS_norm`: lowercase, every run of characters other than `a-z0-9` becomes a
  single space, trimmed. (Accents are not folded; no `unaccent` extension.)
- `TKS_terms(q)`: `TKS_norm(q)` split on spaces, de-duplicated, at most 6
  terms, each cut to 40 chars; terms of length 1 are kept only if another term
  has length ≥ 2. Query over 200 chars → no search.
- Word-prefix rule: a term matches a field when it is the start of any word in
  the normalized field (`(" " + norm(field)).indexOf(" " + term) !== -1`).
  Every term must match somewhere in the item's fields (AND). Case-insensitive.
  "recon" finds "Bank Reconcile"; "con" does not (prefix, not substring).
- Rank: exact name/title start > word-prefix in name/title > client name >
  notes/description > comment. Ties: due date, then name.
- Server side uses the same rule (§2.5). Because terms are normalized to
  `[a-z0-9 ]`, no LIKE wildcard can survive; the SQL still escapes `\`, `%`,
  `_` (defense in depth, `TKS_escapeLike` mirrors it for tests).
- SOPs and Help come from existing server searches that match substrings;
  their results are re-ranked prefix-first locally (a substring hit is still
  shown, lower).

### 2.4 Groups, sources and permissions

All reads use the viewer's own JWT. Only one new data path (the Tasks RPC).

| Group (order) | Cap | Min chars | Source | Who can see what | Opens |
|---|---|---|---|---|---|
| People | 5 | 1 | `staff_directory()` via `CV_loadDirectory` (active staff only; definer, staff only) matched on name words and email local part | every active staff member sees every active staff name (same as pickers today). Shows name + role label only, never the email. | `TKP_openPerson(email)` → `#/tasks/person/<key>` |
| Clients | 5 | 1 | the `clients` prop the top bar already gets (must be `visibleClients`: own book + live grants, internal only with access, admins all). NEVER a query on `clients` (its RLS lets any staff read every non-internal client, wider than access). | only the viewer's visible clients | tb: `TB_go(TB_clientHash(id))`; sbar: `TK_navigate({view:"client", id})` |
| Projects | 5 | 2 | `tk_projects` RLS read (`id,name,client_id,kind,archived_at`, `trashed_at is null`, limit 500, cached 60 s in memory), matched locally; rows whose `client_id` is not in the viewer's visible clients are dropped (non-admins) | RLS: owner or `tk_can_see_project` | `TK_navigate({view:"project", id})` |
| Tasks | 8 | 2 | NEW `tk_search_prefix(q, 12)` (§2.5), kind `task` | `tk_row_readable` (the same check as every Slate read): own, admins, shared/involved on accessible clients/projects; never others' private tasks; internal only with internal access; deleted never | `TK_openTask(id)` (same opener `TB_Search` uses for task rows) |
| Notes | 5 | 2 | same RPC rows with kind `note` (none exist today) | same | same |
| SOPs | 5 | 2 | `client_sops` RLS read (`can_access_client`), the same query `TB_Search` makes (`TB_safeTerm` on the longest term, `or=(title.ilike,section.ilike,body.ilike)`), selecting `id,client_id,section,title` only, limit 20; then filtered to visible clients | `can_access_client` | `TB_go(TB_clientHash(client_id, "sop"))` |
| Help | 5 | 2 | `search_staff_guide(q)` (invoker; staff_guide RLS: staff audience for staff, admin articles for admins) plus `TB_Search`'s audience filter (`TB_ADMIN_ARTICLES` dropped for non-admins) | staff_guide RLS | `TB_go("#/help/" + slug)` |
| Pages | 4 | 1 | `TB_pageRows(navCtx, onOpenSettings)` (tb only; reused top-level helper) | nav rules already applied | its `go()` |
| Actions | 3 | 1 | `TB_actionRows(...)` (tb only) | as today | its `go()` |
| (top row) Filter this Slate list | 1 | 1 | only when the Slate list is mounted (§2.6) | local | sets the list text filter |

Never shown in any group: hours, capacity, last seen, time-off notes, client
emails, task descriptions of unreadable tasks, comment bodies of unreadable
tasks, client names outside the viewer's visible clients.

"In <client>" results (`buildClientSearchResults`) stay in the old `TB_Search`
only; the unified box shows the Clients group instead (one list, no duplicate).

### 2.5 New RPC `tk_search_prefix`

File `supabase/slateplus-profile2.sql` (same file as §4's table).

```sql
create or replace function public.tk_search_prefix(q text, p_limit int default 12)
returns table(task_id uuid, task_text text, kind text, client_id text,
              project_id uuid, status text, due_date date, done boolean,
              match text, snippet text, rank int)
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_terms text[];
  v_lim int := least(greatest(coalesce(p_limit, 12), 1), 25);
begin
  if not public.is_active_staff() then return; end if;
  if q is null or char_length(q) > 200 then return; end if;
  select array_agg(t) into v_terms from (
    select distinct left(t, 40) as t
      from regexp_split_to_table(btrim(regexp_replace(lower(q), '[^a-z0-9]+', ' ', 'g')), ' ') t
     where t <> '' limit 6) s;
  if v_terms is null or (select max(char_length(t)) from unnest(v_terms) t) < 2 then return; end if;
  -- escape LIKE specials (none can survive the normalize above; kept on purpose)
  v_terms := array(select replace(replace(replace(t, '\', '\\'), '%', '\%'), '_', '\_') from unnest(v_terms) t);

  return query
  with cand as (            -- 1) match first (cheap, no row rules yet)
    select r.id, r."text", r.kind, r.client_id, r.project_id, r.status, r.due_date, r.done,
           r.staff_email, r.assignee_email, r.visibility, r.description,
           ' ' || regexp_replace(lower(coalesce(r."text", '')), '[^a-z0-9]+', ' ', 'g') as n_title,
           ' ' || regexp_replace(lower(coalesce(r.description, '')), '[^a-z0-9]+', ' ', 'g') as n_desc,
           ' ' || regexp_replace(lower(coalesce(c.name, '')), '[^a-z0-9]+', ' ', 'g') as n_client
      from staff_reminders r
      left join clients c on c.id = r.client_id
     where r.deleted_at is null
  ),
  task_hits as (
    select x.*,
           case when (select bool_and(x.n_title like '% ' || t || '%' escape '\') from unnest(v_terms) t) then 'title'
                when (select bool_and(x.n_title || x.n_desc like '% ' || t || '%' escape '\') from unnest(v_terms) t) then 'notes'
                else 'client' end as h_match
      from cand x
     where (select bool_and(
              x.n_title like '% ' || t || '%' escape '\'
           or x.n_desc  like '% ' || t || '%' escape '\'
           or (x.client_id is not null and x.n_client like '% ' || t || '%' escape '\'))
            from unnest(v_terms) t)
  ),
  readable as (             -- 2) then the Slate row rule, per matched row
    select h.* from task_hits h
     where public.tk_row_readable(h.id, h.staff_email, h.assignee_email, h.client_id, h.project_id, h.visibility)
       -- a client-name-only hit counts only where the viewer can access the client
       and (h.h_match <> 'client' or public.can_access_client(h.client_id))
  ),
  comment_hits as (
    select r.id, r."text", r.kind, r.client_id, r.project_id, r.status, r.due_date, r.done,
           left(cm.body, 140) as snip
      from tk_comments cm
      join staff_reminders r on r.id = cm.task_id
     where cm.deleted_at is null and r.deleted_at is null
       and (select bool_and(' ' || regexp_replace(lower(cm.body), '[^a-z0-9]+', ' ', 'g')
                            like '% ' || t || '%' escape '\') from unnest(v_terms) t)
       and public.tk_row_readable(r.id, r.staff_email, r.assignee_email, r.client_id, r.project_id, r.visibility)
  ),
  allhits as (
    select id, "text", kind, client_id, project_id, status, due_date, done, h_match,
           case when h_match = 'notes' then left(coalesce(description, ''), 140) else null end as snip,
           case h_match when 'title' then 1 when 'client' then 2 else 3 end as rk
      from readable
    union all
    select id, "text", kind, client_id, project_id, status, due_date, done, 'comment', snip, 4
      from comment_hits
  ),
  best as (select distinct on (id) * from allhits order by id, rk)
  select b.id, b."text", coalesce(b.kind, 'task'), b.client_id, b.project_id, b.status,
         b.due_date, b.done, b.h_match, b.snip, b.rk
    from best b
   order by b.rk, b.done, b.due_date nulls last
   limit v_lim;
end $$;

revoke all on function public.tk_search_prefix(text, int) from public, anon;
grant execute on function public.tk_search_prefix(text, int) to authenticated;
```

Why DEFINER and match-first: an invoker query with non-leakproof `like`
predicates on an RLS table makes Postgres run the row rules on every row
before the match. Definer + match first + `tk_row_readable` on the few matched
rows is the `tk_search` pattern, already live. The definer bypasses RLS, so
EVERY branch that returns a row must call `tk_row_readable` (both branches do;
the SQL test checks each branch). It returns no client names, no emails, no
hours, no last seen. Snippets are only for readable tasks (same as
`tk_search`).

Read-only: `stable`, no writes, no dynamic SQL, every object qualified or on
`search_path = public`.

`TK_api.searchPrefix(q, limit)` in `components/tasks/TK_api.js` next to
`search` (line ~2020): `c.rpc("tk_search_prefix", {q, p_limit})`, returns `[]`
on error (missing RPC before the migration is applied = empty Tasks group, no
toast). `supabaseClient.js`: add `tk_search_prefix` and `tk_profile_card` to
`MGB_VIEW_AS_SILENT_RPCS` (never called in View as; belt and braces).

### 2.6 The Slate list text filter (in-Slate box removed when on)

- `TK_MyTasks.jsx`: the toolbar renders `TK_SlateListSearch` only when
  `!plusGate` (gate off = today). `searchText` state and `TK_applySearch` stay.
- Saved filters keep their `q` (the filter bar already merges
  `{q: searchText}`); `TK_FilterBar.jsx` shows a removable chip
  `Text: "<q>" ×` when `q` is set (gate on only, the bar is gate-on only).
- Unified box, while a full (not embedded) Slate list is mounted: the first
  row is `Filter this Slate list for "<q>"`. Choosing it dispatches
  `window` event `tks:filter-list` `{q}`; `TK_MyTasks` (plusOn, !embedded)
  listens and sets `searchText`. The box closes; the chip shows the filter.
  `TK_MyTasks` announces presence with a module flag `TKS__listMounted`
  (set on mount, cleared on unmount) so other pages don't show the row.

### 2.7 UI and behavior

- Input: placeholder `Search people, clients, tasks, help`; search icon;
  clear ×; `role="combobox"`, `aria-expanded`, `aria-controls`,
  `aria-activedescendant`; list `role="listbox"` with group headers as
  `role="presentation"` labels and rows as `role="option"`; polite live region
  "N results".
- Typing: local groups (People, Clients, Projects, Pages, Actions, filter row)
  update on every keystroke. Server groups (Tasks/Notes, SOPs, Help) debounce
  200 ms, min 2 chars, each in flight under a sequence number; a response for
  an older query is dropped. "Searching…" note in the Tasks group while waiting.
  A failed server group hides itself silently.
- Keys: ↑/↓ move across groups (skip headers, wrap), Home/End, Enter opens,
  Esc clears text then closes then blurs; Ctrl/Cmd+K focuses (one listener,
  owned by whichever box is mounted; builder greps for other Ctrl/Cmd+K
  listeners in the Slate shell, e.g. TK_SlateModes/TK_App, and keeps one).
- Footer row (Tasks group has more): `See all task matches` → `#/tasks/search`
  with the query (prefix search page).
- Empty: `No matches for "<q>".`
- data-tour: `tb-search` on the tb variant (existing top-bar tour step still
  finds it), `tks-search` on the sbar variant.
- Mobile (≤ 760px): the box collapses to an icon button; tapping opens a
  full-width sheet (input at top, results scroll, max-height 75vh, rows ≥ 44px,
  no horizontal scroll); Esc / backdrop / back closes.

---

## 3. Team load strip moves

| Where | Gate on | Gate off |
|---|---|---|
| Slate page `TK_MyTasks.jsx` line ~1268 (`<TK_WorkloadStrip …/>`) | call removed: the Slate page is the working list | the strip rendered null anyway; DOM identical |
| Slate Unassigned group line (`TK_WorkloadLine`, ~1080) | REMOVED when the gate is on (coordinator decision: the whole strip moves). Condition becomes `… && !plusGate` | null as today |
| Team › People (`TeamPage.jsx` `TP_PeopleTab`) | `TK_WorkloadStrip` at the top of both layouts (admin coverage layout and the two-column layout), `isAdmin` = the same value Slate passes today (`isAdmin` of the staff app, hours only for admins via `TP_useCapacity`), `bump={0}`. First chip is `Unassigned: N open · N due this week` (from `tk_slateplus_workload_weeks`, §12.4, only tasks the viewer can read) linking to `#/tasks/my` (Slate's Unassigned group). Below the chips: the 4-week bars (§12.4). | null |
| Profile, admins and account managers | "Team load" section (§4.3) with the strip, the profiled person's chip highlighted (`highlightEmail`) | route unreachable |
| Own profile, everyone | "Your load" card: the strip's own chip only (`selfOnly`) labeled `How Team load shows you`, plus hours for admins | route unreachable |

Visibility is the existing RPC rule, unchanged and decided by the server:
`tk_slateplus_workload()` returns everyone (admins with hours from
`TP_useCapacity`; account managers counts only) or only your own row. The
profile shows the "Team load" section only when the RPC returned more than one
row (that is exactly "admin or account manager"); no new client-side role rule.

`TK_Workload.jsx` changes (small, gate-on paths only): `TKW_useWorkload`
treats `bump === 0` as "ready" (it already only waits on `null`; verify);
new props `highlightEmail` (adds `is-focus` + `aria-current="true"` on that
chip) and `selfOnly` (renders the own row only, no collapse chevron); own chip
links to own profile (`TKP_personHref(me)`); collapse key unchanged
(`mgb_slateplus_workload_v1`).

---

## 4. Profile customization

### 4.1 Storage (new, additive)

```sql
create table if not exists public.tk_staff_profile_prefs (
  owner_email      text primary key,
  status_line      text check (status_line is null or char_length(status_line) between 1 and 140),
  status_set_at    timestamptz,
  focus_quarter    text check (focus_quarter is null or focus_quarter ~ '^[0-9]{4}-Q[1-4]$'),
  focus_goals      jsonb not null default '[]'::jsonb,   -- [{text<=120, done bool}] max 3
  bio              text check (bio is null or char_length(bio) <= 600),
  skills           text[] not null default '{}',          -- max 12, each 1-40
  working_hours    text check (working_hours is null or char_length(working_hours) <= 120),
  pinned_client_ids  text[] not null default '{}',        -- max 12
  pinned_project_ids uuid[] not null default '{}',        -- max 12
  favorites        jsonb not null default '[]'::jsonb,    -- max 20, see trigger
  section_order    text[] not null default '{}',
  hidden_sections  text[] not null default '{}',
  time_zone        text,                                  -- IANA name; null = not set (§12.3)
  share            jsonb not null default
                   '{"status":true,"about":true,"focus":false,"pins":false,"favorites":false,"time":true}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
alter table public.tk_staff_profile_prefs enable row level security;

create policy tkpp_select on public.tk_staff_profile_prefs for select to authenticated
  using (public.is_active_staff() and owner_email = lower(coalesce(auth.jwt()->>'email','')));
create policy tkpp_insert on public.tk_staff_profile_prefs for insert to authenticated
  with check (public.is_active_staff() and owner_email = lower(coalesce(auth.jwt()->>'email','')));
create policy tkpp_update on public.tk_staff_profile_prefs for update to authenticated
  using (public.is_active_staff() and owner_email = lower(coalesce(auth.jwt()->>'email','')))
  with check (public.is_active_staff() and owner_email = lower(coalesce(auth.jwt()->>'email','')));
create policy tkpp_delete on public.tk_staff_profile_prefs for delete to authenticated
  using (public.is_active_staff() and owner_email = lower(coalesce(auth.jwt()->>'email','')));

revoke all on public.tk_staff_profile_prefs from public, anon, authenticated;
grant select, insert, update, delete on public.tk_staff_profile_prefs to authenticated;
```

No admin policy: no existing rule lets admins edit other people's profile
fields (staff_profiles has an admin policy, but these are new personal fields),
so admins cannot read or write anyone else's row directly.

Trigger `tk_staff_profile_prefs_guard` (BEFORE INSERT OR UPDATE, plpgsql,
`set search_path = public`, invoker):
- insert: `owner_email := lower(auth.jwt()->>'email')` (never trusted from the
  client); raise if empty. update: `owner_email` and `created_at` frozen.
- `updated_at := now()`; `status_set_at := now()` when `status_line` changes.
- trims every text; empty string → null.
- `focus_goals`: array, ≤ 3 items, each object `{text: 1-120 chars, done:
  boolean}` (extra keys stripped).
- `skills`: ≤ 12, each trimmed 1-40, de-duplicated case-insensitively.
- pins: ≤ 12 each, de-duplicated. Not checked against access at write time
  (a pin is just an id; every read filters by access, §4.2).
- `favorites`: ≤ 20; each `{kind:'sop', sop_id uuid, client_id text, label
  1-80}` or `{kind:'link', url, label 1-80}` where `url` must match
  `^https://[^\s<>"']{3,500}$` (no javascript:, data:, http:).
- `section_order`, `hidden_sections`: every key in the allowed set (§4.3),
  de-duplicated, ≤ 16; `hidden_sections` may not contain non-hideable keys.
- `time_zone`: null, or a name in `pg_timezone_names` (no abbreviations like
  `CST`, no offsets).
- `share`: object with exactly the six boolean keys (missing → default).
- raise `22023` with a plain message on any violation.

### 4.2 Reading someone else's profile: `tk_profile_card(p_email text)`

SECURITY DEFINER, `stable`, `set search_path = public`, returns one `jsonb`
(or null). Execute: revoke from public, anon; grant to authenticated.

```
if not is_active_staff() -> return null
target := lower(btrim(p_email)); must be an active staff email (staff.active) else null
me := lower(jwt email)
row := the target's tk_staff_profile_prefs row (may be missing -> defaults)
if target = me -> return every field (same as a direct RLS read)
else return jsonb with:
  section_order, hidden_sections                  (layout; never sensitive)
  status_line, status_set_at  only if share.status
  bio, skills, working_hours  only if share.about
  focus_quarter, focus_goals  only if share.focus
  pinned_client_ids  only if share.pins, filtered: can_access_client(id)
  pinned_project_ids only if share.pins, filtered: tk_can_see_project(id) and not trashed
  favorites only if share.favorites, filtered: sop items only when can_access_client(client_id)
            and the SOP row exists for that client; link items as stored
  time_zone only if share.time (never a default filled in for someone else)
always (self and others, §12):
  org   = {manager: {email, name} | null, reports: [{email, name}]}  from staff_hr_records.manager_email,
          active staff on both ends, employment not ended; NO other HR column is read
  teams = [{id, name, color}]  the target's non-archived teams
```
The self branch also returns `org` and `teams`, so the profile makes one call
for everyone (own private fields come back only in the self branch).
`can_access_client` and `tk_can_see_project` read the caller's JWT, so they
answer for the viewer inside the definer. No other table is touched; no
emails other than the target's (already known to the caller) are returned.

Own profile editing writes the table directly (RLS); reading goes through the
RPC for everyone (one call, self branch = full row).

### 4.3 Sections and layout

Section keys (order = default order):

| Key | Title | Hideable | Shown to others |
|---|---|---|---|
| `header` | (identity + status + local time + team chips) | no (always first) | yes (status, time per share) |
| `pins` | Pinned | yes | only if shared, filtered |
| `glance` | This week at a glance | no | yes |
| `load` | Your load + your next 4 weeks (own) / Team load + 4-week bars (admins, AMs) | no | Team load only for admins/AMs |
| `org` | Manager and team (manager, direct reports, teams) | yes | yes |
| `focus` | Focus this quarter | yes | only if shared |
| `tasks` | Their tasks | no | yes (RLS) |
| `ooo` | Out of office | yes | yes (time off is visible to all staff today) |
| `about` | About me | yes | only if shared |
| `favorites` | Favorites | yes | only if shared, filtered |
| `covers` | Clients they cover | yes | yes (viewer's clients only) |
| `collab` | Works most with | yes | yes |
| `recent` | Recent work | yes | yes |
| `shoutouts` | Shout-outs | yes | yes |
| `defaultview` | Default view | n/a | self only (never rendered for others) |

- Order and hidden apply to how anyone sees your profile (hiding only removes
  things that other screens already show; it can never reveal anything).
- Unknown keys in stored order are dropped; sections added later are appended
  in default order (`TKP2_mergeOrder` in `TK_profilePrefsLogic.js`).
- Desktop: `header`, `pins`, `glance`, `load` span the top; the rest flow in
  the existing two columns (`tasks`, `focus` in `.tkp-main`; cards in
  `.tkp-side`), keeping the person's relative order within each column.
- Own profile: `Customize` button in the header opens `Arrange sections`
  dialog: list with Move up / Move down buttons (keyboard), a Show/Hide toggle
  per hideable section, `Reset to default`, Save. No drag needed.

### 4.4 Own-profile editing UI (owner only)

Edit controls render only when `viewer email === profile email` and not View
as. All writes: one upsert to `tk_staff_profile_prefs` (onConflict
`owner_email`, body includes own lowercase email; trigger re-stamps) through
new `TK_api.profilePrefs.get()` / `.save(patch)` (merge patch on the current
row; optimistic update with revert + toast on error).

- Status line (header): `Set a status` link → inline input (140, counter),
  Save / Cancel / Clear. Shown as plain text with `Updated <date>` muted.
- Focus this quarter: up to 3 goals (120 each) with a done checkbox; quarter
  label auto (`Q4 2026`, America/Chicago). When the stored quarter is older:
  muted `From Q3 2026` with `Start this quarter's goals` (clears goals, sets the
  new quarter). No score, no percent, nothing anyone grades.
- About me: bio (600, plain text, line breaks kept, no links rendered), skills
  (chips, add by Enter, × to remove, max 12), working hours (free text 120,
  e.g. what the person types; no time-zone guessing).
- Pinned: `Pin a client` (select from the viewer's own visible clients),
  `Pin a project` (select from RLS projects), × to unpin, up/down to order.
  Rendered as chips at the top linking to the client page / project list.
  Pins the viewer can no longer see are hidden (not deleted).
- Favorites: `Add SOP` (pick a client, then an SOP title from `client_sops`
  RLS) or `Add link` (label + https URL). Links open in a new tab with
  `rel="noopener noreferrer"`; labels rendered as text.
- Default view: select of my saved filters (`tk_slate_filter_views`, owner
  RLS) plus `None`; saving calls the existing `tk_filter_view_set_default(id)`
  (or null). Hint: `Applies when you open Slate.` Plus `Open Slate with this
  view` button. No new column; the filters spec's once-per-page-load rule is
  unchanged.
- Sharing: each of Status, About me, Focus, Pinned, Favorites has a small
  `Visible to: Only me | All staff` select (defaults in §4.1). Others never see
  the select or a hint of hidden content.
- Out of office (§4.5).

Other people's profiles: read-only rendering of whatever `tk_profile_card`
returned; empty shared sections are not rendered (no "nothing here" filler
about another person).

### 4.5 Out of office and backup (reuse, no new data)

- Time off source stays `staff_time_off` (read: all active staff; write: own or
  admin) through `CV_useTimeOff`.
- Own profile `ooo` section: `CV_MyTimeOffBody({staffUser})` reused as is (add
  range + note, cancel, hand-off via `tk_apply_ooo` / `tk_return_ooo`).
- Backups: `My clients' backups` list = viewer's visible clients where
  `assigned_bookkeeper_email = me` (same set `TP_MyBackupsCard` uses), each row
  with `CV_StaffSelect` (exclude me) saving through the existing
  `staffToolsApi.saveProfile(sb, clientId, {backup_bookkeeper_email}, me)`
  (client_profile RLS: staff with `can_access_client`; upsert touches only
  that column plus updated_by/at). `Use <name> for all` button applies one pick
  to every row (sequential saves, one toast).
- Someone else's profile: the section shows their current/next time off and
  note (as Who's out) and the backup summary for clients the viewer can access
  (profile v1 logic moved out of the header). Admins get a `Manage in Team ›
  Who's out` link (the existing admin rule to edit others' time off lives
  there; the profile adds no new edit surface for others).

---

## 5. Visibility matrix (updated)

Legend: yes / no / filt. = filtered to what the viewer can already access.
"Share" = only when the owner set Visible to: All staff.

| Field | Self | Other staff | Account manager | Admin (real) | Temp admin | Client | anon |
|---|---|---|---|---|---|---|---|
| Name, role, photo | yes | yes | yes | yes | yes | no | no |
| Title (staff_profiles) | yes | no | no | yes | no | no | no |
| Status line | yes | share | share | share | share | no | no |
| Focus goals | yes | share | share | share | share | no | no |
| Bio, skills, working hours | yes | share | share | share | share | no | no |
| Pinned clients / projects | yes | share + filt. | share + filt. | share (all) | share + filt. | no | no |
| Favorites: SOP | yes | share + filt. | share + filt. | share | share + filt. | no | no |
| Favorites: link | yes | share | share | share | share | no | no |
| Default view (saved filter) | yes | no | no | no | no | no | no |
| Time zone + local time | yes (firm time hint if unset) | share (default on); nothing if unset | share | share | share | no | no |
| Manager + direct reports (names) | yes | yes | yes | yes | yes | no | no |
| Other HR record fields | no (unchanged: admin-only HR) | no | no | HR page only | no | no | no |
| Teams (names, members) | yes | yes | yes | yes | yes | no | no |
| Edit "reports to" | no | no | no | yes (existing HR › Employee records, `hr_save_record`) | no | no | no |
| Edit teams / membership | no | no | no | yes (Team › People › Teams) | no | no | no |
| 4-week bars | own row | own row | everyone (counts) | everyone (+ this week's hours) | per RPC | no | no |
| Unassigned counts (Team page) | readable tasks | readable tasks | readable tasks | all | readable | no | no |
| Section order / hidden | yes | yes (layout only) | yes | yes | yes | no | no |
| Time off + note | yes | yes | yes | yes | yes | no | no |
| Backups (client_profile) | own clients, editable | filt. | filt. | all | filt. | no | no |
| Last seen | no | no | no | yes | no | no | no |
| Their tasks | all own | RLS (`tk_row_readable`) | RLS | RLS (admin) | RLS | no | no |
| Glance counts | yes | from readable tasks | same | same | same | no | no |
| Your load chip | yes | no | no | no | no | no | no |
| Team load section | no unless admin/AM | no | yes (counts) | yes (+ hours) | per RPC (AM rule) | no | no |
| Hours | no | no | no | Team load only | no | no | no |
| Edit any of the above | own only | no | no | no (own only) | no | no | no |

Admins see the same shared fields as anyone else: the new personal fields have
no admin override (owner decision: edit only own; no existing admin rule).

Unified search:

| Group | Self / staff | Admin | Client | anon | View as |
|---|---|---|---|---|---|
| People | active staff names + role | same | never (box not mounted; RPC staff only) | no execute | old TB_Search |
| Clients | visible clients only | all | never | — | old |
| Projects | RLS projects on visible clients | all RLS | never | — | old |
| Tasks / Notes | `tk_row_readable` | admin RLS | RPC returns nothing (`is_active_staff`) | no execute | old (tk_search silent) |
| SOPs | `can_access_client` | all | never (RLS) | — | old |
| Help | staff audience | + admin articles | never | — | old |

---

## 6. Touch list

New:
- `components/tasks/TK_searchLogic.js` + `TK_searchLogic.test.js`
- `components/tasks/TK_UnifiedSearch.jsx`, `components/tasks/tk-search.css`
- `components/tasks/TK_profilePrefsLogic.js` + `TK_profilePrefsLogic.test.js`
  (normalize prefs, share defaults, `TKP2_mergeOrder`, hideable rule, favorite
  URL check mirroring the trigger, quarter label)
- `components/tasks/TK_ProfileEdit.jsx` (status, focus, about, pins,
  favorites, default view, arrange dialog, backups list)
- `supabase/slateplus-profile2.sql` (table, policies, trigger,
  `tk_profile_card`, `tk_search_prefix`, grants), `supabase/slateplus-profile2-tests.sql`

Edited (gate-on branches only):
- `index.html` (script/css tags, MGB_VERSION), `TK_TaskRow.jsx`,
  `TK_DrawerContent.jsx`, `TK_Comments.jsx`, `TK_Activity.jsx`, `TK_List.jsx`,
  `TK_MyTasks.jsx`, `TK_FilterBar.jsx`, `TK_Profile.jsx`, `TK_Workload.jsx`,
  `TK_api.js`, `components/staff/TeamPage.jsx`, `components/staff/TopBar.jsx`
  (mount choice in `TB_StaffTopBar` only), `TK_StandaloneBar.jsx` (one
  expression), `components/auth/supabaseClient.js` (two SILENT entries),
  `tk-profile.css`, `app.jsx` (flag description, Dev Tools switch text),
  `README.md`, `docs/slateplus-profile-launch-drafts.md`.

---

## 7. Tests

### 7.1 SQL (rolled back): `supabase/slateplus-profile2-tests.sql`

`BEGIN; <migration>; <tests>; ROLLBACK;` Claim set-up copied from
`supabase/slateplus-workload-tests.sql` (`set local role authenticated`,
`set_config('request.jwt.claims', …google provider…, true)`). Fixtures created
inside the transaction: non-admin staff A and B, admin C, client X
(A has access via `staff_client_access`, B none), internal client I, a client
login K (no staff row).

1. Shape: RLS enabled; exactly 4 policies; `anon` has no table privilege and
   no execute on either RPC; `authenticated` has no truncate/references/trigger;
   both RPCs `prosecdef` with `search_path=public`; trigger function invoker.
2. A inserts with `owner_email = B` → row stored as A.
3. B inserts own row. A `select` → 1 row (own). A `update … where owner_email
   = B` → 0 rows; `delete` → 0 rows.
4. Admin C `select` → own only; C update of B → 0 rows (no admin override).
5. Validation: status 141 chars, 4 goals, 13 skills, favorite `javascript:` /
   `http://` URL, unknown section key, hiding `tasks` → each raises 22023.
6. `tk_profile_card(B)` as A with default share: status + about present;
   focus, pins, favorites null; no `default_*` key anywhere.
7. B shares pins with client X and client Y (A no access) and a trashed
   project → A sees X only; C sees X and Y; trashed project never.
8. B favorites an SOP on Y → A's card has no SOP item; link item present when
   favorites shared.
9. Unknown / inactive target → null. K (client JWT) → table select 0 rows,
   insert raises RLS error, both RPCs return null / no rows. anon → permission
   denied on both.
10. `tk_search_prefix` as B: A's private task "Zebra reconcile" → no hit for
    `zeb`; as A → hit (`match='title'`). Shared task on X: A hits, B none.
    Client-name-only hit (`q` = prefix of X's name) → A yes, B none. Comment
    containing `quokka` on a task B can't read → B none (comment branch
    checked). Internal client I task → only internal-access staff. Deleted task
    → none. `q` = `%`, `_`, `a`, `''`, 201 chars → zero rows, no error.
    `p_limit` 0 / 999 → 1 / 25 cap. Prefix rule: `recon` hits "Bank
    Reconcile", `concile` does not.
11. Result-shape check: the RPC's output columns are exactly the documented
    list (no hours, last seen, emails, client names).
12. Teams (§12.2): A (non-admin) insert/update/delete on `tk_staff_teams` and
    `tk_staff_team_members` → RLS error / 0 rows; C (admin) can; A and B can
    read both; adding an inactive or unknown email → 22023; duplicate team name
    (any case) → unique violation; K and anon → nothing / permission denied.
13. Org (§12.1): fixtures set B's `staff_hr_records.manager_email = C`;
    `tk_profile_card(B)` as A → `org.manager = C`, `org.reports = []`;
    `tk_profile_card(C)` → B in `reports`. An ended employee (end_date past) or
    inactive staff never appears. The card JSON's keys contain no HR column
    other than the manager relation (no `legal_name`, `personal_*`, `address`,
    `emergency_*`, `notes`, `schedule`, `work_location`). A still cannot select
    `staff_hr_records` directly (0 rows).
14. Time zone: `America/Chicago` and `America/Phoenix` accepted; `CST`,
    `+05:00`, `Mars/Base` → 22023. B sets a zone with `share.time=false` → A's
    card has no `time_zone`; B unset → A's card has no `time_zone` (no default
    filled in).
15. `tk_slateplus_workload_weeks()` (§12.4): exactly 4 weeks per visible
    person, Monday starts in America/Chicago; non-AM A gets own rows + the
    Unassigned rows only; admin C gets everyone; another person's private task
    never counted; a waiting-on-client, done, deleted, test-client or internal
    task never counted; Unassigned counts only tasks `tk_row_readable` gives
    the caller; K / anon → 42501 / permission denied; `prosecdef`, search_path.

### 7.2 Node

- `node components/tasks/*.test.js` all pass (existing + two new files).
- `TK_searchLogic.test.js`: terms (normalize, dedupe, 6 max, 1-char rule),
  word-prefix AND across fields, case-insensitive, escapeLike, ranking order,
  caps, flatten skips headers and wraps, routeFor (person route is a 16-hex
  key, never contains `@`), stale-sequence guard.
- `TK_profilePrefsLogic.test.js`: normalize missing row → defaults, share
  defaults, mergeOrder (drops unknown, appends new, header first), hidden
  filter refuses non-hideable, favorite URL rule identical to SQL regex,
  quarter label in America/Chicago at quarter boundaries; time zone list
  (common US zones first, `Intl.supportedValuesOf` fallback), `TKP2_localTime`
  (formats a given instant in a zone; null/invalid zone → null, never the
  browser zone), "same as you" detection, share default `time: true`.
- `TK_workloadLogic.test.js` additions: `TKW_weekRows` (pivot RPC rows to 4
  columns per person, missing weeks = 0), `TKW_weekPct` (bar width relative to
  the largest cell visible; 0 → 0%), Unassigned chip text, sort unchanged.
- `announcementsLogic.test.js`: `slate-search` is not visible while
  `TKP_on()` is true (update the existing "gated like Slate" test).
- Existing app.jsx flag test: `mgb_slateplus_preview` description < 900.
- esbuild parse of every touched `.jsx`/`.js`.
- Gate-off check (manual or a node render test if the repo has one): with
  `mgb_slateplus_preview` unset and cache empty, a rendered `TK_vRowAssignee`
  (editable and read-only) matches the old markup.

### 7.3 Live checks for the owner (after ship)

Non-admin login with the preview: search a coworker's private task title (no
hit), a client outside the book (no hit), a coworker's profile with private
focus (not shown). Admin: Team › People strip with hours. Phone: search sheet,
profile single column, row reassign button.

---

## 8. Upkeep (same commit)

- `app.jsx` FEATURE_FLAGS `mgb_slateplus_preview` description rewritten (now
  682 chars; target ≤ 860, measured by the test). Draft:
  "Turns on for you only, in this browser, while the firm-wide
  slateplus_enabled switch is off, the Slate plus additions: @mentions in task
  comments (only people who can see the task); Slate filters and Saved
  filters; person profiles (click any name; Reassign is its own button) with
  status, focus goals, About me, local time, manager, teams, pins, favorites
  and time off; one search for people, clients, projects, tasks, SOPs and help
  (replaces the top-bar and Slate list boxes); Team load with 4 weeks ahead on
  Team › People and on profiles for admins and account managers; and Blocked
  by (a task waits on other tasks). Staff only;
  clients never see it; no new emails. Off in View as. The page reloads when
  you toggle it."
- Dev Tools tk_settings row `slateplus_enabled`: description lists the same
  additions (shorter form).
- PAGE_META: no new page key; `tasks` and `team` subtitles unchanged while
  hidden (note in README to update at launch).
- Resettable localStorage keys: none new.
- README: Slate plus section (profile 2, unified search, Team load move) and
  launch checklist lines: publish guide rows, flip notice dates, update `team`
  subtitle, retire `TK_SlateListSearch` decision, tell admins to fill
  Manager in HR › Employee records and create Teams.
- `slate-search` tip and tour (coordinator decision: never point at a hidden
  element). Tip `tk-search` (Tips.jsx 618) already has
  `ready: () => !!document.querySelector('[data-tour="tk-search"]')`, so it
  cannot show while the box is hidden; add `&& !TKP_on()` anyway so it never
  flickers. Announcement `slate-search` (announcements.js 2064): `visible`
  becomes `ANN_slateLaunchOn() && !(typeof TKP_on === "function" && TKP_on())`.
  Gate off: both unchanged. At launch the `slateplus-profile2` notice tours the
  unified box instead (`tb-search` / `tks-search`).
- `index.html` `window.MGB_VERSION`: new label (e.g. `2026-10-28…`), note
  starts "Hidden, nothing visible: Slate plus profile 2 …", sibling's toolbar
  note combined at rebase, previous note kept after "Earlier:".
- Drafts (not published, not live) appended to
  `docs/slateplus-profile-launch-drafts.md`:
  - Guide article "Your profile and one search" (name click, Reassign
    button, customizing, sharing choices, OOO and backups, unified search
    groups and keys, where Team load went).
  - Next-visit notice `slateplus-profile2` (date left blank) + 5-step tour:
    search box (`tb-search`), a row's person link + reassign button, profile
    `Customize` (time zone, status), Team › People strip with 4-week bars and
    Unassigned chip, Manager and team section.
  - Admin-only guide paragraph: setting Manager (HR › Employee records) and
    managing Teams (Team › People › Teams).
  - Guide sentence: no photo upload here; photos stay where they are today.
  - What's new line.
  - Tip text for the reassign button and for Ctrl/Cmd+K.

---

## 9. Rollout and rollback

- Ship: commit, rebase on origin/main (sibling toolbar fix), push, apply
  `supabase/slateplus-profile2.sql` (additive: one table, one trigger, two
  functions), mark it "Applied to production <date>", Vercel READY.
- Inert after ship: the gate is off for everyone without the preview; no code
  path reads the table or calls the RPCs while off.
- Rollback: untick the preview (switch stays unset). Code: revert the commit
  (gated branches + new files). DB (optional, nothing else depends on it):
  `drop function public.tk_search_prefix(text,int); drop function
  public.tk_profile_card(text); drop function
  public.tk_slateplus_workload_weeks(); drop table
  public.tk_staff_team_members, public.tk_staff_teams,
  public.tk_staff_profile_prefs;` (drop the trigger functions too).
  `staff_hr_records` is untouched, so nothing there to undo.

---

## 10. Self-critique (first pass) and fixes applied above

1. **Definer search leaks private tasks.** First draft had one `tk_row_readable`
   on the task branch only. Fixed: comment branch checks it too, test 10 checks
   each branch separately.
2. **Client names through tasks.** A client-name match on a task the viewer
   owns but whose client they can't access would confirm the client name.
   Fixed: client-name hits also require `can_access_client`; the RPC returns
   no client names; the UI shows client names only from visibleClients.
3. **`clients` RLS is wider than access.** First draft queried `clients` for
   the Clients group. Fixed: local match on the `visibleClients` prop only.
   Build check: confirm `TB_StaffTopBar` receives visibleClients (not the full
   roster) for non-admins; if not, pass visibleClients to `TKS_SearchBox`.
4. **LIKE wildcards / injection.** Terms are normalized to `[a-z0-9 ]` and
   escaped; PostgREST `or=` filter for SOPs uses `TB_safeTerm` (strips `,()%_`).
5. **SECURITY DEFINER pitfalls.** Both RPCs: `set search_path = public`,
   `stable`, no dynamic SQL, staff check first, revoke from public/anon, grant
   to authenticated only; helpers they call read the caller's JWT. The trigger
   is invoker so RLS still applies to the write.
6. **Admins editing others.** First draft added an admin policy "for
   support". Removed: no existing rule allows it and the owner said own only.
   Time off for others stays on Team (existing admin rule), linked not
   duplicated.
7. **Pins/favorites pointing at things the viewer can't see.** Filtered in the
   RPC by the viewer's access; SOP favorites require the SOP row to exist on
   that client (no id probing beyond what `can_access_client` allows).
8. **Unsafe links.** https-only regex in the trigger and in the client;
   rendered with `rel="noopener noreferrer"`; labels as text.
9. **View as writes.** Gate is false in View as, so no edit control renders;
   the fetch guard already blocks REST writes and unknown RPCs; the two RPCs
   are added to the SILENT set so a stray call fails quietly.
10. **Gate-off regressions.** `TB_Search` untouched (only the mount site picks);
    `TK_SlateListSearch` condition is `!plusGate` so off = today; strip removal
    from Slate is a null-rendering component; `TK_StandaloneBar` is a one-line
    conditional; row changes behind plain `TKP_on()`. Profile v1 header move
    is gate-on only (the route is gate-on only).
11. **Losing instant list filtering.** The in-Slate box goes away with the gate
    on (owner decision). Kept the function: "Filter this Slate list" row,
    text chip, saved filter `q`.
12. **Double Ctrl/Cmd+K.** One mounted box owns the listener; builder greps for
    other listeners in the Slate shell.
13. **Stale results.** Sequence guard per server group.
14. **900-char description.** Rewritten shorter (§8) instead of appending.
15. **Sibling toolbar fix.** The sibling is fixing the Slate app bar, the same
    area as `TK_StandaloneBar.jsx`. Kept our edit to one expression at the
    search slot; rebase right before push; re-run tests after the rebase;
    combine MGB_VERSION notes.
16. **Duplicated counts (own profile).** Glance tiles and "Your load" chip
    count differently (load excludes waiting-on-client, like the strip). The
    chip is labeled "How Team load shows you" so the difference is intentional
    and explained in the guide draft.
17. **Free text and pronouns.** Only text the person types; no pronoun field,
    no generated sentences about a person ("Sierra is…"); labels use names.

## 11. Remaining open risks

- Account-manager branch of the Team load section cannot be tested live (no
  non-admin AMs today); covered by the existing workload SQL tests.
- Board card avatars stay unlinked (drag; coordinator OK); the drawer link
  covers it.
- (Resolved) Unassigned load line now leaves the Slate page with the gate on;
  Unassigned shows as a chip on Team › People.
- (Resolved) `slate-search` tip and notice are suppressed with the gate on.
- Manager data: only 7 of 9 HR records have a manager (3 managers, all
  admins); people with none show "No manager set" to themselves and nothing to
  others until admins fill HR › Employee records.
- Exposing the manager relation from the admin-only HR table to all staff is a
  new read (one column, names only). If the owner wants it admin-only, flip one
  branch in `tk_profile_card` (org only for admins and self).
- Firm time zone: Slate uses America/Chicago everywhere (weeks, late rule),
  but `digest_settings.timezone` is America/New_York (admin digest only). The
  profile uses America/Chicago as "firm time".
- No teams exist yet; the Teams section stays empty until an admin creates one.
- `client_sops` has 0 rows and no `kind='note'` tasks exist, so SOP and Notes
  groups are only covered by SQL/node tests until data exists.
- Word-prefix only: "concile" won't find "Reconcile" (by design; substring
  would flood results). Watch owner feedback.
- Comment snippets (140 chars) of readable tasks appear in results, same as
  `tk_search` today.
- Live `slate-search` tip/tour targets the list box, which is gone for preview
  users; the tip engine must skip a missing target (builder verifies) and the
  launch checklist re-points it.
- Sibling conflict on `TK_StandaloneBar.jsx` / `index.html` at rebase.

---

## 12. Extra scope (owner approved 2026-10-28, same gate, same review)

Not in this pass: profile photo upload (photos stay as today, `TK_vAvatar` /
`sp_staff_photo_paths`).

Existing data checked read-only 2026-10-28:
- Manager: `staff_hr_records.manager_email` exists (9 rows, 7 with a manager,
  3 distinct managers, all admins). RLS: admin read only; written only by
  `hr_save_record` (definer, admins) from HR › Employee records
  (`components/hr/HR_RecordsTab.jsx`, manager picker `HR_managerOptions`).
  So "reports to" is REUSED, not added. No new column.
- Teams/groups: none. `tk_project_members` is project membership and
  `staff_conversation_members` is private group chat; neither is a team. So
  teams are additive (§12.2).
- Time zone: no per-person zone anywhere. Firm zone in code is
  America/Chicago (`TK_ON_TIME_TZ`, `TK_RPT_TZ`, `TM_TZ`, `WB_TZ`, workload
  week). New column on the person's own prefs row (§4.1 `time_zone`).

### 12.1 Manager and direct reports (reuse HR data)

- Read: `tk_profile_card` adds `org` (§4.2). Inside the definer:
  `manager` = the target's `staff_hr_records.manager_email` joined to active
  `staff` (name from `staff.name`, else the email local part), only when the
  target's `end_date` is null or in the future; `reports` = active staff whose
  HR row names the target as manager and whose employment hasn't ended, sorted
  by name, max 50. Only `staff_email`, `manager_email`, `end_date` are read
  from `staff_hr_records`; nothing else from HR ever leaves.
- Write: unchanged. Admins set Manager in HR › Employee records. On a profile,
  real admins see a `Change in HR › Employee records` link (hash of the HR
  tab); nobody edits it from the profile. No new write path.
- UI (`org` section, "Manager and team"): `Reports to` with the manager's avatar
  + name (profile link), `Direct reports` as avatar + name links (wrap on
  phone), then the person's Teams (§12.2). Empty for others → section not
  rendered; own profile with no manager → `No manager set yet.` (no blame, no
  prompt to anyone).
- Small org view: a single level up and down (manager → person → reports). No
  full org chart in this pass.

### 12.2 Teams (additive)

```sql
create table if not exists public.tk_staff_teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 60),
  description text check (description is null or char_length(description) <= 200),
  color       text check (color is null or color in ('gold','sage','sky','plum','rose','slate')),
  sort        int not null default 0,
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  archived_at timestamptz
);
create unique index if not exists tk_staff_teams_name_uq on public.tk_staff_teams (lower(btrim(name)));

create table if not exists public.tk_staff_team_members (
  team_id     uuid not null references public.tk_staff_teams(id) on delete cascade,
  staff_email text not null,
  added_by    text,
  added_at    timestamptz not null default now(),
  primary key (team_id, staff_email)
);
alter table public.tk_staff_teams enable row level security;
alter table public.tk_staff_team_members enable row level security;

-- read: any active staff; write: admins only (org structure, like Manager)
create policy tkst_read  on public.tk_staff_teams for select to authenticated using (public.is_active_staff());
create policy tkst_ins   on public.tk_staff_teams for insert to authenticated with check (public.is_active_staff_admin());
create policy tkst_upd   on public.tk_staff_teams for update to authenticated using (public.is_active_staff_admin()) with check (public.is_active_staff_admin());
create policy tkst_del   on public.tk_staff_teams for delete to authenticated using (public.is_active_staff_admin());
create policy tkstm_read on public.tk_staff_team_members for select to authenticated using (public.is_active_staff());
create policy tkstm_ins  on public.tk_staff_team_members for insert to authenticated with check (public.is_active_staff_admin());
create policy tkstm_del  on public.tk_staff_team_members for delete to authenticated using (public.is_active_staff_admin());
-- no update policy on members (remove + add)

revoke all on public.tk_staff_teams, public.tk_staff_team_members from public, anon, authenticated;
grant select, insert, update, delete on public.tk_staff_teams to authenticated;
grant select, insert, delete on public.tk_staff_team_members to authenticated;
```
Triggers (invoker, `set search_path = public`): teams stamp `created_by` from
the JWT on insert, freeze it and `created_at` on update, trim name, set
`updated_at`; members lowercase `staff_email`, require it to be an active
`staff` row (22023 otherwise), stamp `added_by`. Max 30 teams, 40 members per
team.

`is_active_staff_admin()` is the same admin check every other admin write uses
(temp admins included if that function includes them; no new rule).

UI:
- Team › People, real admins: a `Teams` card (both layouts, under the strip):
  list of teams with member avatars; `New team` (name, optional description,
  color from the fixed palette); per team `Rename`, `Add people`
  (`CV_StaffSelect`), × on a member, `Archive` (confirm). Keyboard reachable
  buttons, no drag.
- Everyone: team chips in the profile header (max 3 shown, `+N`), and the full
  list in the `org` section. A chip opens nothing new in this pass (no team
  page); it has a title listing members.
- Unified search: People results show team names as a muted second line (from
  the same read). No Teams group in this pass.
- Data: one RLS read of both tables (cached 60 s) shared by the card, header
  and search; the profile also gets the target's teams from `tk_profile_card`.

### 12.3 Local time and time zone

- Stored: `tk_staff_profile_prefs.time_zone` (owner-only write, §4.1), shown
  to others only when `share.time` (default on).
- Own profile header: `Local time 3:42 PM · Central` with `Change`; when unset:
  `Time zone not set. Showing firm time (Central).` + `Set time zone`. Never
  filled from the browser or location; the picker may pre-select nothing.
- Picker: common US zones first (Eastern, Central, Mountain, Arizona, Pacific,
  Alaska, Hawaii → IANA names), then `Other…` listing
  `Intl.supportedValuesOf("timeZone")` (fallback: the US list only). Labels by
  zone name, never a city chosen for the person.
- Others' profiles: `Local time 3:42 PM · Pacific` and, when different from the
  viewer's own set zone (or firm time if unset), `(1 hour behind you)`. Unset or
  not shared → nothing shown (no guessing).
- Next to the name in the people search result and in the header only (not on
  every row, to keep rows unchanged).
- The clock updates once a minute while the profile is visible (one interval,
  cleared on unmount / hidden tab).

### 12.4 Four-week workload bars

New RPC in `supabase/slateplus-profile2.sql`:

```sql
create or replace function public.tk_slateplus_workload_weeks()
returns table (staff_id uuid, email text, name text, is_me boolean,
               is_unassigned boolean, week_start date, due_count integer)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_me text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_ws date := date_trunc('week', (now() at time zone 'America/Chicago')::date)::date;
begin
  if v_me = '' or not public.is_active_staff() then
    raise exception 'tk_forbidden' using errcode = '42501';
  end if;
  return query
  with people as (        -- EXACTLY the strip's visibility: reuse its RPC
    select w.staff_id, w.email as em, w.name from public.tk_slateplus_workload() w
  ),
  weeks as (select (v_ws + 7 * g)::date as ws from generate_series(0, 3) g),
  t as (                  -- the strip's counting rules, copied
    select lower(r.assignee_email) as em, r.due_date
      from public.staff_reminders r left join public.clients c on c.id = r.client_id
     where r.done = false and r.deleted_at is null
       and coalesce(r.is_unassigned, false) = false and r.assignee_email is not null
       and coalesce(r.status, 'todo') not in ('done', 'waiting_client')
       and (r.client_id is null or (c.id is not null and coalesce(c.is_internal,false) = false and coalesce(c.test_only,false) = false))
       and (coalesce(r.visibility, '') <> 'private' or lower(r.assignee_email) = v_me)
       and r.due_date between v_ws and v_ws + 27
       and lower(r.assignee_email) in (select em from people)
  ),
  u as (                  -- Unassigned: only tasks the caller can read
    select r.due_date
      from public.staff_reminders r left join public.clients c on c.id = r.client_id
     where r.done = false and r.deleted_at is null
       and (coalesce(r.is_unassigned, false) or r.assignee_email is null)
       and coalesce(r.status, 'todo') not in ('done', 'waiting_client')
       and (r.client_id is null or (c.id is not null and coalesce(c.is_internal,false) = false and coalesce(c.test_only,false) = false))
       and r.due_date between v_ws and v_ws + 27
       and public.tk_row_readable(r.id, r.staff_email, r.assignee_email, r.client_id, r.project_id, r.visibility)
  )
  select p.staff_id, p.em, p.name, p.em = v_me, false, w.ws,
         (select count(*) from t where t.em = p.em and t.due_date between w.ws and w.ws + 6)::int
    from people p cross join weeks w
  union all
  select null, null, 'Unassigned', false, true, w.ws,
         (select count(*) from u where u.due_date between w.ws and w.ws + 6)::int
    from weeks w
  order by 5, 2, 6;
end $$;
revoke all on function public.tk_slateplus_workload_weeks() from public, anon;
grant execute on function public.tk_slateplus_workload_weeks() to authenticated;
```
- Visibility is the strip's by construction (the `people` set IS the existing
  RPC's output), so admins and AMs see everyone, others only themselves. The
  Unassigned rows count only readable tasks (it is the same set the viewer's
  Slate Unassigned group shows). Counts only; no ids, titles or clients.
- The current Unassigned open/due-this-week numbers for the chip (§3) come from
  week 0 plus an `open` total: add an extra `week_start = null` row per person
  and for Unassigned carrying the all-dates open count (same filters minus the
  date window). Builder keeps it in this one RPC.
- UI (`TK_WorkloadWeeks` in `TK_Workload.jsx`): one row per visible person,
  four cells `This week`, `Next week`, `Nov 9`, `Nov 16` (Monday dates), each a
  bar (width relative to the largest visible cell, `TKW_weekPct`) with the
  number as text; admins also see this week's QuickBooks Time hours vs weekly
  target in the first cell (existing `TP_capFor`, admin only); future weeks
  never show hours. Unassigned row first, muted. No red tones (grace period).
  Accessible as a `table` with header cells; on phone the four cells stay in
  one row with numbers only (bars shrink), name above.
- Where: Team › People under the strip (gate on), the profile `load` section
  for admins/AMs (the profiled person's row highlighted), and own profile
  `Your next 4 weeks` (own row only). Same 60 s cache/TTL as the strip.
- `supabaseClient.js`: add `tk_slateplus_workload_weeks` to
  `MGB_VIEW_AS_SILENT_RPCS` (gate is off in View as; belt and braces).

### 12.5 Self-critique for the new parts (and fixes applied)

1. **HR data leak.** First idea: let staff read `staff_hr_records` through a
   new policy. Rejected: that table holds personal phone, address, emergency
   contacts. Fixed: the definer card reads only `staff_email`,
   `manager_email`, `end_date`; test 13 asserts no other HR key appears and
   that direct table reads still return 0 rows for non-admins.
2. **Ended or inactive people in the org view.** Filtered on both ends
   (active staff, end_date not past).
3. **Duplicating "reports to".** Brief allowed a new admin-set field only if
   none existed; one exists, so no new column (two sources would drift).
4. **Teams write rights.** Admin-only by RLS, not by UI; triggers stamp
   `created_by`/`added_by` from the JWT; members must be active staff. A
   non-admin cannot create a team that shows on someone's profile.
5. **Team names as free text.** Rendered as text only; 60 chars; unique per
   firm; fixed color palette (no CSS injection through a color value).
6. **Time zone guessing.** No browser default, no location; unset shows firm
   time only to the person, nothing to others; validation against
   `pg_timezone_names` prevents junk zones breaking `Intl`; client wraps
   `Intl.DateTimeFormat` in try/catch and shows nothing on error.
7. **Time zone as location hint.** Shareable (`share.time`, default on, can
   be turned off).
8. **Workload visibility drift.** Instead of copying the AM/admin rule, the new
   RPC derives its people from `tk_slateplus_workload()`, so a future rule
   change applies to both. Counting rules are copied; a comment in both SQL
   functions says "keep in sync", and test 15 checks the same exclusions.
9. **Unassigned counts leaking private or inaccessible tasks.** Counted only
   through `tk_row_readable` for the caller.
10. **Hours beyond admins.** Hours only from `TP_useCapacity` (admin RLS) and
    only in week 0; the RPC returns no hours.
11. **Definer + nested definer.** `tk_slateplus_workload()` raises 42501 for
    non-staff; the outer function checks first so the error is the same.
    Both `stable`, fixed `search_path`, no dynamic SQL.
12. **Gate off.** None of the new sections, cards, RPCs or table reads exist
    outside gate-on code paths; Team › People with the gate off renders as
    today (strip, weeks and Teams card all behind `TKP_useOn()`).
13. **Flag text.** Rewritten to mention local time, manager, teams and 4 weeks
    ahead; still about 790 chars, under 900 (test enforces).
14. **Upkeep.** Dev Tools: no new flag or key; tk_settings switch description
    updated with the same words; README lists Teams card and Manager source;
    drafts include the admin paragraph.

### 12.6 Touch list additions

- `supabase/slateplus-profile2.sql`: + teams tables/policies/triggers,
  `time_zone` column, `org`/`teams`/`time_zone` in `tk_profile_card`,
  `tk_slateplus_workload_weeks`. Tests in `supabase/slateplus-profile2-tests.sql`
  (§7.1 items 12-15).
- `components/tasks/TK_Workload.jsx` (+ `TK_WorkloadWeeks`, Unassigned chip),
  `TK_workloadLogic.js` (+ `TKW_weekRows`, `TKW_weekPct`) and its test.
- `components/tasks/TK_ProfileEdit.jsx` (+ time zone picker),
  `TK_profilePrefsLogic.js` (+ zone list, `TKP2_localTime`).
- `components/tasks/TK_Profile.jsx` (+ `org` section, header time and team chips).
- `components/staff/TeamPage.jsx` (+ Teams card for real admins, weeks bars).
- `components/tour/Tips.jsx`, `components/tour/announcements.js`,
  `components/tour/announcementsLogic.test.js` (slate-search suppressed when on).
- `components/auth/supabaseClient.js` (+ `tk_slateplus_workload_weeks`).
