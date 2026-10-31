# Slate plus: Calendar view (hidden preview)

Built 2026-10-28. Gated by `TKP_useOn()` (Feature flags > Slate plus preview, or the owner-only `slateplus_enabled`; never in View as, never embedded). Front end only.

## 1. What it is
A **Calendar** button in the toolbar of the Slate page and of client, project and person lists swaps the list for a month grid (weeks start Monday, like the rest of Slate). Tasks are compact chips on their due date: overdue in the late color, done dimmed with a line through. More than 3 tasks (2 on a phone) in one day shows `+N more`, which opens a small day list. A chip opens the task drawer. Under the grid: "N tasks have no due date and are not on the calendar." Buttons: previous month, Today, next month.

Keyboard: Tab to the grid, arrows move between days, PageUp and PageDown change month, Enter on a day with tasks opens its list, Esc closes the list.

## 2. Data
No new read. The calendar gets the tasks the list page already loaded and filtered:
- Slate page: the same search box, client filter, Slate plus filter bar and quick chips as the list (done tasks included, dimmed; "Show older" still decides how far back done tasks go).
- Client, project and person lists: the list's own Assignee, Status and Show older filters, with done tasks shown.
The toggle is remembered only for the visit (no localStorage key).

## 3. Moving a due date
Drag a chip to another day (mouse; not on touch screens). It saves through `TK_vRowSave`, the same path as the due chip on a row: the start-date check, the optimistic save, a toast with **Undo**. Not draggable: tasks in review, read-only (offline, archived project). To change a date on a phone or by keyboard, open the task.

## 4. Drafts (not published)
Guide (`task-lists-and-projects`, new "Calendar" section): "Press **Calendar** above the list to see tasks on a month calendar by due date. Late tasks are red and finished ones are gray. If a day has more tasks than fit, click **+N more** to see them all. Click a task to open it, or drag it to another day to change its due date (Undo is on the message that appears). The note under the calendar tells you how many tasks have no due date; open the list to give them one. The calendar follows your search and filters. Press **Calendar** again to go back to the list."

What's new: "Slate has a Calendar view: your tasks by due date on a month grid, with drag to reschedule."

Notice (`slateplus-calendar`, at launch): title "Slate Calendar", body "See tasks on a month calendar by due date. Drag a task to another day to reschedule.", no tour (a tip is enough).

## 5. Launch
Flip `slateplus_enabled` with the rest of Slate plus (README launch checklist); publish section 4. No SQL.

## 6. Rollback
Revert the commit, or leave the switch off.
