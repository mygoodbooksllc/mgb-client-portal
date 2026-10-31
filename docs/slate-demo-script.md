# Slate app: Monday demo script (one page)

The Slate app is on for everyone (since October 25, 2026), and Slate plus launched on October 28, 2026 (on for everyone once the owner sets `slateplus_enabled`). No preview box is needed; to show Slate plus before the switch is on, tick **Developer tools › Feature flags › Slate plus preview** on the demo laptop only.

## Before the meeting (5 minutes)

1. In Chrome on the demo laptop, sign in at app.mygoodbooks.org as yourself.
2. Only if Slate plus isn't on yet: go to **Developer tools › Feature flags** and tick **Slate plus preview**. The page reloads.
3. Open **Slate**, then click **Open Slate app**. Install it if Chrome offers, so it opens in its own window.
4. Pick a demo client with 15 to 30 open tasks, including some overdue and a project with two or more sections. Use your own tasks, or tasks the room is fine seeing.
5. Close every other tab that shows Slate, so only one window runs during the demo.

## The 10 things to show, in this order

1. **Full page.** Make the window wide (about 1400 px). Click a task: the details open in the right pane. Press **Esc** to close it.
2. **Size modes.** Drag the window narrower: Regular, then Compact, then a thin **sliver** showing the current task. Drag it back to full. You can also use the size buttons; give each click a second to land.
3. **Keys.** Click a row, then press **↓ ↑** to move, **Enter** to open, **E** to edit the title (press Esc to leave it), and **X** to mark it done. Press **?** to show the shortcuts sheet.
4. **Undo.** Right after X, press **Cmd+Z**. The task comes back. Say: "Undo works for 9 minutes in the app, and it refuses if someone changed the task since."
5. **Right-click menu.** Right-click a task to show Duplicate, Copy, Due today / tomorrow / next week, Snooze a day and Select. Pick **Due tomorrow**.
6. **Select several and bulk edit.** Cmd-click one task, then Shift-click a task a few rows down. The bar shows "N selected". Set **Priority › High**, then press **Cmd+Z** to undo it in one step.
7. **Duplicate and copy/paste.** Select a task and press **Cmd+D**: the toast says "Duplicated." Press Cmd+Z to remove the copy. Then select 2 tasks, press **Cmd+C**, open a project list and press **Cmd+V** ("Pasted 2 tasks"), then Cmd+Z.
8. **Your own order.** Click the **Manual** chip (next to Due, Priority, Status, Name), then drag a task by its handle, or click it and press **Alt+↓**. The toast says "Moved." Say: "This order is yours only; teammates keep their own."
9. **Board and saved views.** Switch **List › Board** to see the status columns, then switch back to List. Open **Views**, choose **Save as new view…** and name it "Mine today". Change the sort, then pick "Mine today" again to show it come back.
10. **Drop on a date or person.** Start dragging a task: a dock appears with Today, Tomorrow, Next week and teammates' names. Drop it on **Tomorrow**.

## What to avoid on the day

- Do not run **Delete** or bulk Delete on real client tasks; use Snooze or a due date instead.
- Do not paste in **My tasks** or a person list: paste there duplicates in place, which looks like a double. Paste into a project or client list.
- Do not demo the **Safari** trackpad swipe back (it is off in Safari) or the touch swipes, unless you have a touch screen ready.
- Do not try to move or paste a task into another **client**: that is not supported (a paste skips those tasks), so it looks broken in a demo.
- Do not tick or untick **Classic** or any firm switch in Developer tools during the demo.
- Do not leave copies behind: Cmd+Z each duplicate or paste, or Delete it straight after.

## Known limits (say these if asked)

- Undo lasts 9 minutes in the app (10 seconds elsewhere). A late Undo refuses when the task changed since: "Not undone: ...".
- Manual order keeps up to 2,000 saved positions per list for each person; older positions are not cleaned up yet.
- The size buttons resize the window only where the browser allows it, mainly the installed app. Otherwise, drag the window edge.
- Copy/paste stays inside Slate; it never moves tasks between clients and copies at most 50 tasks at a time.
- Touch gestures and real phones or tablets have not been tested on devices yet.
