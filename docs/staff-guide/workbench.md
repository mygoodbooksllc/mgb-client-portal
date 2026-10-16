---
title: How do I use the Workbench?
section: Getting started
audience: staff
keywords: [workbench, reply without leaving the page, reply from the workbench, open file, open file from the workbench, files open in drive, chat drawer, my tasks tab, tasks tab, tick done from the list, today, needs you, inbox, one list, drawer, bottom drawer, press w, w key, keyboard shortcuts, snooze, snoozed, no reply needed, mark checked, undo, needs reply, due today, overdue, reviews waiting, ledger flags, documents, new files, client files, mine, everyone, covering, classic today, workbench preview, j k, next item, open a task without leaving the page, stacked drawer, esc closes one layer, panel remembers, reopens where you left it]
sort: 41
---
The **Workbench** is one list of everything that needs you, in order: your tasks, work waiting for your review, client messages with no reply, Ledger flags, new client files, and the rest of what used to be on Today. It takes over **Today** (the first place in the left rail, which is then called **Workbench**; the address stays `#/today`) and also sits in a drawer at the bottom of every staff page. Press **W** anywhere to open it.

The owner turns the Workbench on for the whole team. Until then Today looks as it always has. See [What's on my Today page?](#/help/home-page).

### The four tiles

- **Needs reply**: client messages where the client wrote last and nobody on our side has answered. Click it to show only messages.
- **Due today**: items due today. Click it to jump to the Today group.
- **Overdue**: items past their due date. Click it to jump to the Overdue group.
- **Reviews**: tasks waiting for your review, and your own work an admin sent back to you. Click it to show only those. (Ledger reviews waiting for an admin's approval are under the **Ledger** chip.)

### The list

Items are grouped **Overdue**, **Today** and **This week**, most urgent first. A client message is due the next business day after it arrives, and a new client file two business days after it's uploaded, so an unanswered message turns overdue after that. Anything due more than a week out is counted under the list as **N more later**, with a link to **My Tasks**.

The chips above the list filter by where an item came from: **All**, **Tasks**, **Reviews**, **Messages**, **Ledger**, **Documents** and **Other** (deadlines, bills, handbook signatures and the other Today rows), each with a count. **Snoozed** appears when you have snoozed something.

Each row says what it is, which client, and how long it has waited or when it's due. **Covering for <name>** means it's on your list because you're that person's backup while they're out.

### Doing the next thing

Each row has one main button (in the bottom drawer, **Reply** and **Open file** stay on the page; see "Reply without leaving the page" below):

- **Reply** on a client message opens the conversation in the Inbox.
- **Start** or **Open** on a task opens its details.
- **Review** on a review, a client answer or a Ledger flag opens it where it lives.
- **File** on a new client upload opens the file.

The **⋯** menu next to it has the rest:

- **Snooze**: **Later today**, **Tomorrow 8am**, **Next Monday 8am** or **Pick a date**. The item leaves the list until then. If something changes on it first (the client writes again, the due date moves), it comes back early.
- **No reply needed** (messages): the client's last message doesn't need an answer, like a thank-you. The thread leaves the Workbench without sending anything. A new message from the client puts it back. The same button is in the Inbox thread header.
- **Mark checked** (client files): you've looked at the upload. It leaves everyone's Workbench.

Each of these shows **Undo** at the bottom of the screen for a few seconds.

Items also leave by themselves when the work is done: you reply, finish or approve the task, or clear the Ledger flags.

### The drawer on every page

A bar runs across the whole bottom of every staff page, beside the left menu, and shows your count, the next item and **Press W**. Click it or press **W** and the list slides up from it, the full width of the page, with the rest of the page dimmed behind it. It has filters (**All**, **Tasks**, **Reviews**, **Messages**, **Files**) and the same buttons as the full page. **Full page** goes to Today. **Esc** or **W** closes it. On a phone it opens as a full-screen sheet.

The panel remembers where you were: the filter you picked and how far you had scrolled. If you leave it open and reload the page within a few minutes it opens again where you left it; after that it stays closed but keeps your filter. **Reset local state** under Dev Tools clears what it remembers.

The **Workbench** item in the left rail shows how many items are overdue or due today (a dot when the rail is narrow).

### Open a task without leaving the page

In the drawer, **Open** (or **Review**) on a task opens its details in the task drawer on top of the Workbench. The page behind it does not change. Edit it, comment, tick it done, reassign it or approve it there.

- **Esc** closes one layer at a time: a row's **⋯** menu first, then the task drawer, then the Workbench. Clicking the dimmed page behind a task drawer closes only the task drawer.
- Closing the task drawer puts you back on the row you opened it from.
- **W** does nothing while a task drawer or dialog is open on top, so it can't close the Workbench from under it. **q** (quick add) does nothing while the Workbench is open; a **+ Task** button for it is coming.
- On a task you haven't started, **Start** moves into the **⋯** menu, next to **Snooze** and **Open full page** (which goes to the task's page, as before).
- Ledger items still take you to where they live. Client messages and new files stay on the page too; see the next section.

### Reply without leaving the page

In the Workbench drawer, a client message has **Reply** and a new client file has **Open file**. Neither one changes the page behind the drawer.

- **Reply** opens the Messages chat drawer on top of the Workbench, already on that person's thread. Type and send as usual. Once you reply, the item leaves your list within a couple of seconds.
- **Esc**, or a click on the dimmed page, closes the chat drawer and puts you back on the row you came from. Your filter, tab and scroll are as you left them.
- **Open file** opens or downloads the file in a new browser tab: a PDF or an image shows in the tab, while a spreadsheet, Word file or CSV downloads. The Workbench stays open. The item stays in your list until you tick **Mark checked** in its **⋯** menu (there's an Undo).
- If your browser blocks the new tab, allow pop-ups for this site and click **Open file** again. If Drive can't find the file, a message says so; **Open full page** in the **⋯** menu goes to the client's Files tab.
- The **⋯** menu on a message or file also has **Open full page**, which goes to the thread or the Files tab as before. On the Messages page itself, **Reply** goes to the thread instead of stacking a second inbox.
- The Messages drawer only lists clients you can open. If you've lost access to a client, or the person isn't in that client's list, a message says it couldn't find the conversation (use **Open full page** in the **⋯** menu), and nothing from another client shows in its place.

### My tasks in the Workbench

The Workbench panel has two tabs, **Inbox** and **My tasks**. **My tasks** lists every open task assigned to you, grouped **Overdue**, **Today**, **This week**, **Later** and **Waiting on client**, the same way My Tasks does. Tasks that are done or unassigned don't show here.

- Click a row to open the task drawer on top; closing it puts you back on the row. Tick the circle to mark it done from the list. The count on the tab is your open tasks.
- Click a group's name to fold it; the panel remembers which groups you folded.
- **+ Add task** opens quick add. **My Tasks page** goes to the full page.
- It shows up to 200 tasks. If you have more, a line says how many more there are and links to **My Tasks**.
- **Show older** on My Tasks doesn't change this tab, and this tab doesn't change My Tasks.
- Your filter, scroll and open tab are remembered for you only, on this browser. If you share a computer, the next person starts clean.

### Keyboard shortcuts

Click **?** at the top of the Workbench and pick **Keyboard shortcuts**. They work when you're not typing in a box:

- **W** opens or closes the drawer (not while a task drawer, dialog or menu is open on top of it).
- **j** and **k** move to the next and previous item; **Enter** does the main action; **o** opens it where it lives.
- **s** snoozes; **e** is **No reply needed** on a message or **Mark checked** on a file.
- **1** to **6** pick a filter on the full page, **0** goes back to All.
- **Esc** closes the top layer: a menu, then a drawer or dialog on top, then the Workbench.

### Admins: Mine or Everyone

Admins get **Mine** and **Everyone** next to the chips. **Everyone** shows every staff member's items, with whose each one is. Your choice is remembered.

### Troubleshooting

- **Something I expected isn't there.** The Workbench only shows clients you can open, and tasks waiting on the client stay on My Tasks. Check **Snoozed** too.
- **It says Couldn't refresh.** Click **Retry**. The last list stays on screen meanwhile. **Offline** means your connection dropped; it refreshes when you're back.
- **I'd rather have the old Today.** Click **?** at the top of the Workbench and pick **Use classic Today in this browser**. Today then has **Switch back to the Workbench** at the top. It only changes this browser. (Admins: it's also **Classic Today** under Dev Tools › Feature flags.)
