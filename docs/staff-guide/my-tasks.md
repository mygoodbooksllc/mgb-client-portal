---
title: How do I use my Slate?
section: Daily work
audience: staff
keywords: [task in the desk, desk client tab, task row, change assignee from the row, change due date from the row, priority from the row, avatar, initials, overdue red, due today amber, row menu, three dots, add task row, add task at the bottom of a group, inline add, select many, bulk, multi-select, undo, ctrl z, v, select a task, plain words, quick add plain words, for me, re client, by friday, did you mean, will add, subtasks inline, open subtasks, expand subtasks, collapse subtasks, subtask count, 2/5, chevron, project color, project colors, color dot, group by, group by client, by client, due date, client groups, no client, my tasks, tasks, work, tasks tab, task, reminder, to do, due, overdue, today, this week, later, waiting on client, done, show done, show older, today group, view, quick add, q, add task, at mention, hashtag, priority, high, low, business days, bd5, keyboard, shortcuts, j k, status, assign, by client, save as template, suggest template, checklist, subtasks, tasks page, lists, client task panel, t, waiting on client list, ask client, #/tasks/waiting, unassigned, claim, claim a task, nobody assigned, no assignee, unassigned group, asana import, slate, my slate]
sort: 110
---
**Slate** is where your tasks live (it was called Tasks). Its home page is one list of everything assigned to you, across every client and project. Open it from the **Slate** button in the top bar (`#/tasks/my`), or from **Work › Slate** (`#/work/tasks`), which shows the same list inside Work. The Slate page also has a sidebar with every client list and project; see [How do client task lists and projects work?](#/help/task-lists-and-projects).

A task is yours when it's assigned to you. A task you give someone else shows on *their* Slate, not yours. You still see it on the client's or project's list, and you follow it automatically.

### The groups

- **Overdue**: past its due date. Overdue is only a reminder for you right now: during the late-task grace period, late tasks aren't counted in anyone's score or reports.
- **Today**: due today. To fold these into This week, open **View** and untick **Today group**.
- **This week**: due in the next 7 days.
- **Later**: due after that, or with no due date.
- **Waiting on client**: tasks paused with the **Waiting on client** status. They never count as late, whatever the date. **Slate › Waiting on client** in the sidebar lists every open client request, longest wait first; see [How do I ask a client something from a task?](#/help/ask-client).
- **Unassigned**: open tasks on your clients that nobody is on yet (see below). Click **Assign** and pick yourself to take one, or pick a teammate.
- **Done**: finished tasks. It starts folded.

Click a group's heading to fold or open it. The portal remembers which groups you folded. Empty groups don't show.

### On a task row

Every row shows the same few things, and you can change most of them without opening the task:

- **Assignee**: a round badge with the person's initials. A task nobody is on shows a dashed empty circle (hover it, or tab to it, to see *Assign*). Click it to pick a teammate; only the task's owner or an admin can reassign, and people who can't see the client are grayed out.
- **Due date**: a chip that is red when the task is overdue, amber when it is due today and plain otherwise. With no date it's a faint calendar icon. Click it to pick **Today**, **Tomorrow**, **Next Monday**, **Pick a date…** or **Clear date**.
- **Priority**: **High**, **Normal** or **Low**, always shown. Click it to change it.
- **Status**: the pill on the right, as before.
- **The ... menu**: hover the row (or tab into it) to show it. It has **Open**, **Mark done**, **Assign to me** (when the task is unassigned) and **Copy link**. On a phone it's always visible.

Each picker is a small menu: arrow keys move, **Enter** picks, **Esc** closes. If you can't edit a task (view-only, or it's waiting for review), the cells are plain text. The list keys (**j**, **k**, **x**, **s**, **a**) work as before.

### Group by client

The toolbar's **Group by** switch changes **Due date** (the groups above) to **Client**. Your tasks are then grouped one client at a time, clients A to Z, with **No client** after them and test and internal clients last (tagged **Test** or **Internal**). Inside a client the most urgent task comes first, and **Show done** still applies. The client filter still works. The portal remembers your choice, per person, in this browser. An admin's switch on a person's list under **People** is remembered separately from the one on Slate.

The toolbar has **Add task**, a client filter (**All clients**, or one client), **Show done** and, once Show done is on, **Show older**. Done tasks finished more than 12 months ago stay hidden unless you turn on **Show older**. Nothing is deleted.

### Unassigned tasks and Claim

Some tasks have nobody on them: tasks brought over from Asana without an owner, and recurring tasks whose template says **Leave unassigned**. They show as **Unassigned** wherever the person's name would be.

- **Slate** has an **Unassigned** group with the open ones on clients you can see. Admins see only the ones on their own clients (where they are the bookkeeper) or ones they made, so the group stays short.
- Click **Assign** on the row and pick yourself to take it (or pick a teammate to hand it to them). In the task's details, use the **Assignee** dropdown. You'll see *It's yours. Find it in Slate.* and it moves into your groups.
- If someone claimed it a moment before you, you'll see *Someone already took this task.*
- Admins can also pick a person in the task's details instead of claiming it.
- An unassigned task never counts as anyone's overdue, and it isn't in anyone's performance score, on-time or review numbers, or weekly digest until someone claims it. Time off hand-off leaves it alone, and when you tick off a recurring unassigned task the next one stays unassigned too.
- On a client's or project's list, the person filter has an **Unassigned** option.

The first time you see an unassigned task, a short notice offers a tour of the group and **Claim**. It's also under **What's new** and in the **?** menu.

### Add a task

The quickest way is the **Add task** row at the bottom of **Today**, **This week** and **Later** (or of a client's group when you group by client). Click it, type a name and press **Enter**: the task is made right there with that group's due date (**Today**, tomorrow for **This week**) or client, and the box stays open for the next one. **Esc** closes it. Groups that can't take a new task, such as **Overdue**, **Waiting on client**, **Unassigned** and **Done**, don't have the row, and neither do people who can't create tasks.

Or:

Press **q** on any staff page (not while you're typing in a box), click **Add task**, or use **+** → **New task** in the top bar (with the Desk on, the **+** at the foot of its rail). The **+** button works with or without a client open. See [How do I add a task, note or document request, or message a client?](#/help/quick-actions).

Type the task in one line. The portal picks out the details and shows them as chips under the box:

| Type | What it does | Examples |
|---|---|---|
| **@name** | Assigns it. Use the start of a teammate's name, or their email before the @. | `@name` |
| **#client** | Files it under a client. Use the start of the client's name. | `#example-church` |
| **!high**, **!low** | Sets the priority (`!h`, `!l` and `!normal` work too). | `!high` |
| A date | Sets the due date. | `today`, `tomorrow`, `fri`, `next week`, `eom`, `in 3 days`, `+2w`, `10/31`, `2026-11-15` |

For example: `Reconcile operating account #example-church @name fri !high`, where `@name` stands for a teammate.

You can also type it in plain words. The box shows a **Will add** line with what it understood before you save:

| Type | What it does | Examples |
|---|---|---|
| *for* or *assign to* a first name | Assigns it (*to Sierra* offers a **Did you mean** button). *For me* is you. | `Send payroll summary for Sierra`, `call the bank for me` |
| *for*, *re* or *client* a client's name | Files it under that client (type the whole name; at the end of the line, or at the start before a colon). | `Statements re Example Church`, `re Example Church: reconcile` |
| *by Friday*, *due the 15th*, *the 15th*, *end of month* | Sets the due date. | `Send invoices by Friday` |

If a name matches more than one person or client, or both a person and a client, nothing is picked: the words stay in the title and a **Did you mean** line lets you pick. Click **×** on a plain-words chip to put its words back in the title (on an **@**, **#** or **!** chip it removes the symbol). The inline add box on a project or client list still reads only the symbols (**@**, **#**, **!**) and dates.

- A weekday such as `fri` means the next one, never today.
- `tom`, `sun`, `mon` and `sat` are also everyday words, so they only count as dates right after "due" or "on", or as the last word. *Call Tom about payroll* stays as you typed it.
- Due dates are calendar days. Business days apply only when you type them: `+3bd` is three business days from today, and `bd5` is the fifth business day of the month (this month, or next month if it has passed).
- If more than one person or client matches, nothing is picked. Type more of the name, or pick it in the box below.
- Click **×** on a chip to undo it. A field you pick by hand wins over what the line says.

Press **Enter** to add it, or **Shift+Enter** to add it and open its details. You'll see *Task added.* When you add from a client or project page, the task starts in that client or project and is shared with its team; untick **Share with the client's team** (or **Share with project members**) to keep it private.

To add a reminder instead, use ⌘K → **New reminder**, or set **Type** to **Reminder** in the task's details.

### Work with a task

- Click the done box on a row to mark a task done, and again to undo. On a task that needs review, your Done sends it to an admin instead. See [What's in a task's details?](#/help/task-details) and [How does task review work?](#/help/task-review). The message that follows has **Undo** for 10 seconds (or press **Ctrl+Z** / **⌘Z**).
- To change several tasks at once, tick the small select box at the far left of each row (it shows when you point at the row), or press **v**. A bar at the bottom completes, reopens, reassigns, moves, reschedules or deletes them together. See [How do I change many tasks at once, and undo a change?](#/help/select-many-tasks).
- Click the status (for example **To do**) to change it.
- Click the task's name to open its details: dates, priority, comments, files, subtasks, the checklist and its history.
- A task with checklist steps shows its progress, such as **3/5**.
- A task with subtasks shows a small arrow and how many are done, such as **2/5**. See *Subtasks* below.
- A task that belongs to a project shows the project's name with its color dot. See [How do client task lists and projects work?](#/help/task-lists-and-projects).

### Subtasks

A task with subtasks has a small arrow and a count, such as **2/5** (2 of its 5 subtasks are done), next to its name.

- **Click the row** (anywhere that isn't its name, a button or a menu) and the subtasks open right under it, indented. Click the row again to close them.
- **Click the task's name** to open its details instead. That's the one click that goes to the drawer; a row without subtasks opens the drawer from anywhere on the row.
- You can also click the arrow itself, or focus the row and press **→** to open and **←** to close.
- Each subtask has its own check box (click to mark it done, again to undo), its name, who it's assigned to and its due date. Click a subtask's name to open its details.
- The portal remembers which tasks you opened, in this browser. A subtask that is done still shows under its parent while the parent is open, whatever the list's **Show done** says.
- A subtask shows only under its parent. If its parent is in a different group or hidden (for example, the parent is due later), the subtask keeps its own row as well, so it never goes missing.
- Subtasks work the same in Slate (by due date or by client), in client and project lists, in a person's list and in a client's task panel. Add and reorder subtasks in the task's details.

### Keyboard shortcuts

| Key | What it does |
|---|---|
| **j** / **k** | Next / previous task |
| **Enter** | Open the task |
| **x** | Mark done or not done |
| **s** | Change status |
| **a** | Assign |
| **v** | Select the task (**Shift+V** selects a range); **Esc** clears |
| **Ctrl+Z** / **⌘Z** | Undo your last change while its Undo message shows |
| **q** | Add a task (works on every staff page) |
| **t** | Open or close the client's task panel (works on every staff page; with the Desk on, the Desk's Client tab) |
| **Esc** | Close the details (in the Desk: back one step) |
| **?** | Show these shortcuts |

The shortcuts pause while you type in a box or have a menu open. Click the keyboard button in the toolbar, or see **Settings › Shortcuts › Slate shortcuts**, for the list.

### Save a task as a template

Doing the same task every month? Open the task, click **More actions** in its header and pick **Save as template**.

- **Admins**: the template editor opens on **Slate › Recurring**, pre-filled with the task's title (without the " · Sep 2026" part), its priority, its client and its checklist. Check the details, pick how often it repeats, and click **Save draft**. Nothing is saved until you do, and nothing is made until you turn the template on.
- **Everyone else** (including temporary admins): the item says **Suggest as template**. It sends the idea to the admins, who see it at the top of **Slate › Recurring** and in their bell. You'll see "Suggested to admins as a recurring template."

See [How do recurring tasks from templates work?](#/help/task-templates).

### Elsewhere in the portal

- **Today**'s count line (**due today** and **late**) counts your tasks, and the most urgent one shows as **Do next**. The full list is here in Slate.
- The **Slate** button in the top bar shows how many open tasks you have, with overdue ones in a red number. With a client open, it opens that client's task panel instead. With the Desk on it is a plain link to Slate with no numbers: the Desk's bar shows your late tasks and today's progress.
- Search (**Ctrl+K** / **⌘K**) finds tasks by their name, description and comments. A match inside a comment says *In a comment:*. Click a result to open the task.
- A client's Overview has a **Tasks for this client** card. See [What's on a client's Overview?](#/help/client-overview).

On a client's pages, a line under the tabs shows the next task, and **t** opens all of the client's tasks in a side panel. With the Desk on, the line is gone and **t** opens the Desk's **Client** tab, and a task you open shows in the Desk instead of the pop-up. See [How do I see a client's tasks without leaving the page?](#/help/client-tasks-drawer).

### Troubleshooting

- **Clicking a row opened its subtasks, not the details.** That's how a task with subtasks works: click the row to open or close its subtasks, and click the task's name to open its details.
- **Notes and SOPs used to be here.** They moved to **Work › Notes & SOPs**. See [How do I keep notes on a client?](#/help/notes).
- **The By client view is gone.** Each client now has its own list in the Slate sidebar, with the client's people, SOP and Drive folder at the top. Handoff summaries moved to **Work › Notes & SOPs → Handoff summaries**.
- **"Slate is being set up"**: the update is still finishing. Your tasks are safe; use the page again in a few minutes.
- **Claim says "Someone already took this task."** A teammate claimed it first. It now shows their name; it's no longer in your Unassigned group.
- **I assigned a task and it left my list.** That's expected. Find it on the client's or project's list. You follow it, so its comments still reach you.
- **"They can't see this client yet, so they won't see this task."** The person you picked isn't assigned to that client and has no coverage or temporary access. Pick someone else, or ask an admin to give them access.
