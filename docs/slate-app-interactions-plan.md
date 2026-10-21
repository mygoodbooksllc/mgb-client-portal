# Slate app: interaction options plan

Requested by the owner 2026-10-21. Everything here is staff-only, lives behind the Slate app preview flag (`mgb_slate_app_preview`) and the `slate_app_enabled` firm switch, and ships with the usual upkeep (guide, tips, What's new, tour, README, Dev Tools). Nothing is live until the Slate app launches.

Already in progress elsewhere: drag to reorder (Slate app P2). This plan builds on it and does not duplicate it.

## Items

1. **Drag and drop to move.** Drag a task into another section (and reorder inside one). Builds on P2 drag reorder; the same drop targets must accept a move between sections.
2. **Duplicate.** Cmd+D and a menu item. The copy keeps title, notes, subtasks and assignee; it gets a fresh status and no completed state.
3. **Copy and paste across sections.** Cmd+C on a selected task, Cmd+V while another section is focused. Same field rules as Duplicate.
4. **Swipe back.** Slate and the portal share one "back" order: close the drawer, then the open task, then go to the previous page. Trackpad two-finger swipe and, on touch, an edge swipe only (starts within about 24px of the screen edge) so it never fights board drag or scroll.
5. **Undo (Cmd+Z)** for the last move, delete, complete, duplicate or paste, with an "Undone / Undo" toast. Build this first: drag and drop makes accidents easy.
6. **Multi-select.** Shift-click and a drag box, then move, assign or set due date for all at once. Moves and edits go through the same undo step as a single action.
7. **Drag a task onto a person or a date** to reassign it or change its due date.
8. **Swipe a row** right to complete and left to snooze (touch and trackpad).
9. **Quick keys:** E edit, Enter open, X complete, arrow keys move between tasks.
10. **Right-click menu** that gathers all of the above in one place.

## Left out on purpose

Drag a task to another client's list (move between clients). It changes real client data, so it needs its own decision from the owner before it is added.

## Build order

Undo first, then Duplicate and Copy/Paste, then Move between sections, multi-select, the right-click menu, quick keys, swipe back, then drag-onto-person/date and row swipes. Each step is a small commit behind the preview flag.

## Rules

- Moves, copies and undo use additive database changes only; never delete task data (undo of a duplicate or paste archives the copy the same way delete does today).
- Copies never inherit recurring-template links, so they cannot create duplicate recurring work.
- No emails or notifications fire from duplicate, paste or undo.
