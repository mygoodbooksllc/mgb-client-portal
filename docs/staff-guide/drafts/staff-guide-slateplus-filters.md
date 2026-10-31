# Slate plus filter bar and saved filters: DRAFT guide, notice, tip and tour text

Draft for the hidden Slate plus preview (localStorage `mgb_slateplus_preview` / firm switch `slateplus_enabled`, gate `TKP_on()` in `components/tasks/TK_slatePlus.js`). Publish at launch, when the owner flips `slateplus_enabled`. Do not copy into the live guide, `announcements.js`, `Tips.jsx` or `Tour.jsx` before then. The search box itself is already live (2026-10-27, `### Search the list` in `my-tasks.md`); this draft only adds the filter bar and saved filters.

## docs/staff-guide/my-tasks.md: new section right after `### Search the list`

````markdown
### Filter the list and save filters

Under the view bar there is a row of filters. Pick any mix and the list narrows right away; every filter you set must match, together with the search box.

- **Assignee**: **Anyone**, **Assigned to me** or **Unassigned** (the open unassigned tasks your Slate shows).
- **Client**: one client from your tasks. (This takes the place of the client menu in the toolbar.)
- **Project**: one project, or **No project**.
- **Due**: **Late**, **Due today**, **Next 7 days**, **Next 30 days**, **No due date**, or **Custom range…** with From and To dates.
- **Status**: **Late**, **Waiting on client**, **To do**, **In progress** or **Ready for review**. Done tasks still follow **Show done**.

**Late** means open and past its due date. A task waiting on the client, or a month task whose reports went out as preliminary, is never late.

**Clear filters** resets the filters and the search. Group by, Sort and the quick chips are separate and stay as you set them.

**Saved filters.** Set the filters (and a search, if you like), open **Saved filters** and pick **Save this view…**, then name it. Pick a saved filter from the same menu to put it back. Each one has **Rename**, **Delete** and **Set as my default**. Your default opens with the Slate page each time you load the portal, unless you already typed or picked something. **Remove default** goes back to no filters. Saved filters are yours only: no one else sees them, and you can keep up to 30. Dates like **Next 7 days** stay relative, so they move with today.

The filter bar is not in Work › Slate, the Desk's Slate tab or View as.
````

Keywords to add to `my-tasks.md`: `filter, filters, saved filters, save this view, default filter, assignee filter, due filter, late filter, waiting on client filter, project filter, custom range`.

## docs/staff-guide/whats-new.md: new entry at the top (launch day)

````markdown
### <launch date>: filters and saved filters on your Slate

The Slate page has a filter row under the view bar: Assignee, Client, Project, Due (Late, today, next 7 or 30 days, a custom range) and Status (Late, Waiting on client and more). Save a mix you use often with **Saved filters › Save this view…**, and pick **Set as my default** to open your Slate with it. Saved filters are yours only. See **How do I use my Slate?** › Filter the list and save filters.
````

Keywords: `filters, saved filters, default filter`.

## docs/staff-guide/tips.md: new row (and put it first on the "newest" line)

| Tip | Where | Says |
|---|---|---|
| **Filter and save** (`tk-filter-bar`) | Slate page, the filter row | Narrow your list by assignee, client, project, due date or status. Save a mix you use often under Saved filters, and set one as your default. |

`Tips.jsx` entry (after `tk-search`): id `tk-filter-bar`, page `tasks`, target `tk-filter-bar`, slug `my-tasks`, ready only when `[data-tour="tk-filter-bar"]` exists (so it never shows while the preview is off).

## Next-visit notice and tour step (components/tour/announcements.js)

Entry id `slateplus-filters`, date = launch day, roles admin / tempAdmin / bookkeeper / accountManager, hash `#/tasks/my`, `visible` = `ANN_slateLaunchOn() && TKP_on()` (never in View as). Steps (3, the test requires 3-6):

1. **ann-welcome**: "Filters for your Slate". "Your Slate page now has a filter row and saved filters, so you can jump straight to the tasks you need."
2. **ann-filters** (go to `#/tasks/my`, targets `["tk-filter-bar"]`, wait): "Filter the list". "Pick an assignee, client, project, due date or status. Every filter you set must match, together with the search box. Clear filters resets them."
3. **ann-done**: "Save the ones you use". "Open Saved filters › Save this view… to keep a mix, and Set as my default to open your Slate with it. Saved filters are yours only. More in How do I use my Slate?"

Add `slateplus-filters` to the walk-order exclusion lists in `announcementsLogic.test.js`, like `slate-search`.
