# Slate month rhythm, slice 0: Group by, Sort, quick chips, saved view

Written 2026-10-21. Part of `docs/slate-month-rhythm-build-plan.md`. Not behind the preview flag:
a plain improvement to the Slate list (#/tasks/my) and the Desk's Slate tab.

## What a person sees

One control, the same on the Slate page and on the Desk's Slate tab:

- **Group by**: Due date (default, today's groups), Client, Rhythm step, Status.
  - Rhythm step groups by the task's section. The month rhythm parts come first, in rhythm
    order (Check in, Send reports, Follow up), then any other section (Weekly, Monthly, ...
    first, then A to Z), then **No part**. Slice 3 seeds the monthly templates with these
    sections, so the eight tasks per client land under their part. A later slice can pass the
    firm's own part list and a template section lookup; with neither, the task's own section
    is used.
  - Status groups: To do, In progress, Waiting on client, Ready for review, Done (Done is
    folded by default, like the Done group today).
- **Sort** chips: Due, Priority, Status, Name. A click sorts ascending, a second click
  descending, a third goes back to the default order. Sorting is inside each group.
- **Quick chips** (one at a time): **Mine today** (assigned to me, not done, not waiting on
  the client, due today or earlier) and **Waiting on client** (status `waiting_client`; Ask
  client sets this status when a request goes out, so the chip and the Waiting list agree).
- **Reset view** shows only when something is chosen.

The view is saved per person in this browser: `mgb_tk_slate_view_v1:<email>` for the Slate page,
`mgb_tk_slate_view_v1:desk:<email>` for the Desk tab (each place keeps its own). The Slate page
falls back to the old `mgb_tk_groupby_v1:<email>` (Due date or Client) when nothing new is saved,
and keeps writing it for Due date and Client, so nobody's earlier choice is lost and a rollback
keeps working. Both keys start with `mgb_`, so Dev Tools' reset and storage list already find
them. Every read and write is in try/catch (`TK_vLsGet`/`TK_vLsSet`, `WB__lsGet` style).

## Default stays identical

With nothing chosen (Due date, no sort, no chip) the Slate page builds its groups exactly as
before (`TK_myGroupsView`), and Client with no sort and no chip uses the old client path. Tests
assert deep equality with the old functions. The Desk tab's default path and its tab count are
unchanged; the count always uses the default grouping so a chip never changes the tab badge.

## Pure logic (TK_viewLogic.js, additive)

`TK_SLATE_GROUPS`, `TK_SLATE_SORTS`, `TK_SLATE_CHIPS`, `TK_RHYTHM_PARTS_DEFAULT`,
`TK_SLATE_VIEW_KEY`, `TK_NO_PART_KEY`, `TK_slateViewKey`, `TK_normalizeSlateView`,
`TK_slateViewRead`, `TK_isDefaultSlateView`, `TK_slateChipMatch`, `TK_slateApplyChip`,
`TK_rhythmPartOf`, `TK_groupByPart`, `TK_groupByStatus`, `TK_slateSortWithin`,
`TK_slateBuildView`. Nothing existing is renamed or changed. `WB_hubTaskGroups` gains an
optional third argument `{ anyKey: true }` so the Desk can draw Client, Part and Status groups;
without it the whitelist stays as it is.

## Bulk bar

The Slate page's bulk select uses `TK_focusIds(view)` and each group's `TK_BulkGroupBox`, which
only need `{ key, label, tasks, collapsed }`. Every grouping returns that shape, so select,
group select-all, and the bar work in any grouping. Collapsed groups drop out of the selection
as before. The Desk tab has no bulk bar today; that does not change.

## Critique (self)

- RLS: no server change, no new table. Nothing reaches a client.
- Edge cases: an unknown saved value normalizes to the default; a bad JSON value reads as the
  fallback; a sort column outside the chips is dropped; tasks with no section go to No part;
  sections that differ only in case merge; Unassigned tasks in a non-due grouping keep their
  Claim button (same rule the Client grouping uses today). Mine today never includes a task
  waiting on the client (owner rule: waiting never counts against a bookkeeper).
- Collapsed keys: Part and Status keys are prefixed (`part:`, `status:`) so they never collide
  with due keys (`waiting`) or client keys (`client:`). On the Desk, Client/Part/Status folds
  live in component state only (the hub state keeps its own whitelist).
- Rollback: revert the commit. Saved views are inert under old code (unknown key); the legacy
  group by key stays valid.
- Owner late-count rule: this slice changes no counts.

## Review (2026-10-21)

- Fixed: the Slate page showed "No tasks match this view" with Reset view whenever a non-default
  view was empty, including a legacy Client view with the client filter on. It now shows only when a
  quick chip empties a list that has tasks; otherwise the old empty copy shows.
- Fixed: the guide said Rhythm step falls back to the template's section; My Tasks and the Desk
  don't pass templates yet, so the guide now says a task with no section goes under No part.
- Launch kit: announcement `slate-view-bar` (2026-10-21, admin + bookkeeper, `#/tasks/my`, not gated)
  with four steps on `tk-groupby`, `tk-slate-chips` and `tk-slate-sort` (Slate page only; the Desk's
  compact bar has no tour targets). Test in `announcementsLogic.test.js`.
- Guide sync: `my-tasks`, `whats-new` and `tips` updated in `staff_guide` by targeted replace (no
  delete, no full upsert, since main's `whats-new` has a newer line this worktree lacks).
