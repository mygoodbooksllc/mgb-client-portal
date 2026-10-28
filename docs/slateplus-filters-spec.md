# Slate plus: search, filters and saved filter views (spec)

Date 2026-10-27. Size: big (new table + RLS, Slate page behavior). Part of the
"Slate plus" batch (three sibling features ship at the same time behind the
same gate).

## 0. Two parts, two gates (owner update 2026-10-27)

| Part | Who sees it | Gate |
|---|---|---|
| A. **Search box** on the Slate page | every staff member, live | none (additive, fixes a missing basic) |
| B. **Filter bar**, **Saved filters** menu, **Set as my default** | only with the preview | `TKP_on()` |

Part A ships first, as its own commit, with full upkeep (guide, tip, What's
new, next-visit notice with a tour step, README, Dev Tools, MGB_VERSION).
Part B ships after, hidden; guide, tour and notice text drafted, not live.

The gate (`components/tasks/TK_slatePlus.js`, shared by the batch):
`TKP_on()` is true only when the person is not in View as, AND either the
per-person preview `localStorage.mgb_slateplus_preview === "1"` (Developer
tools > Feature flags, "Slate plus preview", reloads) or the firm switch
`tk_settings.slateplus_enabled` is true. The switch is NOT SET (= off); code
only reads it, never writes it. Hook `TKP_useOn()` for components. Same shape
as `TM_gate.js`.

## 1. Where

Only the full Slate list: `TK_vMyTasksBody` (the Slate page `#/tasks/my` and
the Slate app window, which renders the same component). Not on: Work › Slate
summary, the Desk's Slate tab (`embedded`), the View as snapshot
(`TK_vSnapshotBody`), client or project lists, Board layout keeps working
(the search narrows the tasks the board is built from).

## 2. Part A: search box (live)

- An input in the Slate toolbar, after Add task: placeholder "Search title,
  client, notes", a search icon, a clear (×) button while there is text.
- Instant: every keystroke re-filters the loaded tasks in the browser. No
  network call, works offline over the cached rows.
- Match rule (`TK_searchMatch` in `TK_filterLogic.js`): the query is lower-
  cased and split on white space; EVERY word must appear somewhere (substring,
  so "recon" finds "Reconcile") in the task title, its client's name or its
  notes (description). Up to 200 characters. Empty query = no filter (the
  same array back, so nothing changes for anyone not typing).
- Applies BEFORE grouping, so groups, counts, Group by, Sort, quick chips,
  Show done, the board, j/k focus, multi-select (rows not shown drop out of
  the selection, the existing prune rule) and the "+ Add task" rows all act
  on the matches only.
- Esc in the box: clears the text if any (and stops the key so nothing else
  closes), otherwise leaves the box (blur). The box is a typing target, so
  list keys (j k x s a q v ?) never fire while typing (existing guard).
- Nothing matches: "No tasks match "<query>"." with a Clear search button.
- A polite live region says "N tasks match" for screen readers.
- Not remembered: a reload or leaving the page starts with an empty box.
- The Slate app's top-bar "Search tasks" box (firm-wide server search) is
  unchanged; it is a different tool (all tasks you can see, whole words).

## 3. Part B: filter bar (preview only)

A row under the view bar with:
- **Assignee**: Anyone (default) | Me | Unassigned. The Slate list holds my
  tasks plus the unassigned ones I can see, so these are the real choices.
- **Client**: All clients | each client in my loaded tasks. With Slate plus on
  this replaces the toolbar's client select (one client filter, not two); it
  drives the same `clientFilter` state, so quick add keeps the client.
- **Project**: Any project | No project | each project in my loaded tasks.
- **Due**: Any time | Late | Today | Next 7 days | Next 30 days | No due date |
  Custom range (from / to dates). Relative choices stay relative when saved.
- **Status**: Any status | Late | Waiting on client | To do | In progress |
  Ready for review. (Done stays under Show done.) "Late" means open, not
  waiting on the client, due before today and not excused (`TK_lateExcused`).
- **Clear filters** link while any filter or search is set.
All filters AND together and with the search. Pure rule:
`TK_applySlateFilters(tasks, f, ctx)`; `TK_normalizeSlateFilters(raw)` makes
any stored value safe. Group by, Sort and quick chips are NOT part of a saved
filter set (they already save themselves, and the Slate app's Views menu
names them), so the existing view logic is untouched.

## 4. Part B: saved filters (preview only)

"Saved filters" menu on the filter bar:
- Lists my saved sets (name, check on the active one, "Default" tag on mine).
- Pick one: applies its search + filters.
- **Save this view…**: name it (1-60 characters, unique per person, any case).
- Per row: **Rename**, **Delete** (confirm), **Set as my default** /
  **Remove default**.
- My default applies once when the Slate page first opens in a page load
  (not on every re-render, never over something I already typed).
- In View as: hidden (gate off). Read-only staff never reach it.

### Table `public.tk_slate_filter_views` (new, additive)

```
id uuid pk, owner_email text (stamped from the JWT by trigger),
name text 1-60 trimmed, filters jsonb object <= 4000 bytes,
is_default boolean default false, position int,
created_at, updated_at
unique (owner_email, lower(name)); unique (owner_email) where is_default
```
- RLS on; four policies, all `is_active_staff() and owner_email = jwt email`.
  Clients (not staff) see and write nothing. anon: no grants. authenticated:
  select/insert/update/delete only (no truncate/references/trigger).
- Trigger: owner from the JWT on insert (never trusted from the client),
  owner and created_at frozen on update, name trimmed and single-spaced,
  max 30 rows per person (advisory lock).
- RPC `tk_filter_view_set_default(p_id uuid)` SECURITY INVOKER (RLS applies):
  clears my other default and sets this one in one transaction; `null`
  clears my default. Execute: authenticated only.
- Self-test (rolled back): RLS shape, owner stamping, other staff can't read
  or change, a non-staff login sees nothing, name rules, cap, one default.

## 5. Self-critique

1. *Two search boxes in the Slate app* (top bar + list). Risk of confusion.
   Mitigation: different placeholders ("Search tasks" = everything, server;
   "Search title, client, notes" = this list). Owner question at launch: make
   the top-bar box filter the list instead of opening Search.
2. *Existing server search is whole-word only* (`websearch_to_tsquery`;
   "recon" finds 0 of the 162 titles containing it) and never matches client
   names. Likely the "doesn't work" report. Not changed here (live SQL
   function, other screens use it); flagged for the owner.
3. *Hidden selection*: searching hides selected rows; the existing prune rule
   drops them, so a bulk action never touches a row you can't see. Good.
4. *Subtasks*: a subtask whose parent is filtered out shows as its own row
   (same as other narrowing today). Acceptable.
5. *Default applied over a live view*: only once per page load and only if the
   person hasn't typed or picked a filter yet.
6. *Security*: owner-only RLS plus staff check; trigger owner stamp; invoker
   RPC so it cannot touch others' rows; no client code path loads the table
   (only `TK_FilterBar.jsx`, staff shell, gated).
7. *Old behavior when off*: Part B renders nothing, does no network call and
   keeps the toolbar client select. Part A with an empty box returns the same
   task array (identity), so groups are built exactly as before.
8. *Rollback*: Part A is one revertable commit. Part B: revert the commit;
   the table can stay (nothing reads it) or `drop table
   public.tk_slate_filter_views; drop function
   public.tk_filter_view_set_default(uuid);`.
9. *Conflicts with the sibling builds*: pure rules live in a new file
   (`TK_filterLogic.js`) and UI in `TK_FilterBar.jsx`, so `TK_viewLogic.js`
   and `TK_MyTasks.jsx` get only small hooks.
