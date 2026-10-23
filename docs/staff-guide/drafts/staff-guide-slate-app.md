WIRED 2026-10-21 (launch prep): the notice and tour are in components/tour/announcements.js as slate-app-launch, gated by visible(); the guide text is applied at flip time with supabase/staff-guide-slate-launch.sql (built by drafts/slate-launch-patch.mjs from these drafts). The text below stays here as the source for that script.

DRAFT - not live until the owner flips tk_settings.slate_app_enabled. Nothing in this file is synced: docs/staff-guide/sync.mjs only reads the top-level .md files, so this drafts folder is skipped.

AT LAUNCH (mgb-launch-kit, mgb-ui-upkeep), in one commit:
1. Replace docs/staff-guide/tasks-own-window.md with the article below (same slug, so every link and tip to #/help/tasks-own-window keeps working). Then generate the guide SQL for just the changed articles (copy supabase/staff-guide-slate-s6.sql as the pattern; upserts only, no deletes) and run `node docs/staff-guide/sync.mjs --check`.
2. Add the line marked "WORKBENCH LINE" and the section marked "GET-THE-APP SECTION" below to workbench.md and get-the-app.md.
3. Add the sentence marked "ADMIN-INSIGHT" to admin-insight.md (the Slate app preview flag and switch rows are already there).
4. Flip the Tips text for tk-popout in Tips.jsx (and the row in tips.md) to the Open Slate app wording, and drop the TK_slateAppOn gate in the Tour.jsx tk-popout step.
5. Publish drafts/whats-new-slate-app.txt and the notice and tour in drafts/tour-slate-app.md.
6. The mgb_slate_classic opt-out (TK_SLATE_APP_CLASSIC) is "added at launch": when its Feature flags row ("Slate app classic") is added, add a troubleshooting bullet ("I'd rather use the old window: an admin can switch you back from Developer tools") and a keyword to the article, and add the key to the README list.

Facts to re-check before publishing. These are owner checks from the S0/S2 spike that are not yet confirmed in an installed app: the size buttons in the installed app (resizeTo), and the smallest window the browser allows. If either fails, delete the sentences that promise it.

--- tasks-own-window.md (replacement) ---

---
title: How do I use the Slate app?
section: Daily work
audience: staff
keywords: [slate app, open slate app, install slate app, mgb slate, own window, open in own window, pop out, popout, slim window, sliver, strip, compact, regular, full page, full, size, window size, sliver start, sliver done, undo, expand, detail pane, views, saved views, named views, bulk, bulk status, bulk priority, bulk section, manual order, drag, reorder, alt up, alt down, board, board view, columns, status columns, section columns, list or board, dock, dock in portal, side by side, quickbooks, second monitor, /slate, /tasks, pop-up blocked, follow my client, follow, install, dock icon, start menu]
sort: 116
---
The **Slate app** is Slate in a window of its own, for example next to QuickBooks or on a second screen. Open it from the portal whenever you want it; the portal never opens it for you, and everything in Slate still works inside the portal exactly as before.

Think of it this way: the portal is where you act on the task in front of you. The Slate app is where you **shape** your work: set up projects and sections, build views, change many tasks at once, and keep your list on screen all day.

### Open it

On the Slate page (`#/tasks/my`), or on the **Slate** tab of the Desk, click **Open Slate app** at the top right. A window opens with just Slate: no rail and no top bar. It remembers its size next time. The button is there on a computer; on a phone or tablet, use Slate inside the portal.

You can also type the portal's address with `/slate` at the end (for example in a bookmark). It opens the same app after you sign in.

### Install it

In Chrome or Edge on a computer, click **Install Slate app** (next to **Open Slate app**), then confirm. Slate gets its own icon in your Dock, Start menu or Launchpad, and opens without the portal. It is a second app next to MyGoodBooks: installing one does not install the other. Once it is installed, the button says only **Open Slate app** and tells you to open it from your Dock or Start menu.

### Four sizes

The app changes what it shows to fit the window, so you can shrink it to a sliver and grow it back:

- **Sliver** (a window under about 300 pixels wide or 200 tall): just your current task, with **Start** and **Done**. Under about 200 tall it is one line; narrower and taller it is a small column.
- **Compact** (up to about 720 wide): a phone-style list. You can read and tick things, but templates, project setup, sections and bulk edits wait for a wider window (the window says so, with a **Full page** button).
- **Regular** (about 720 to 1100 wide): the full list with a left rail of lists and projects. A task opens in a drawer over the list.
- **Full** (about 1100 wide and up): the rail, the list and a **detail pane** side by side. Click a task, or move with **j** and **k**, and its details show in the pane; **Esc** clears it.

Drag the window's edge to any size, or click **Sliver**, **List** or **Full page** (in the bar, or in the menu in a compact window) to jump to one. The size buttons need the app window, so they do not show in an ordinary browser tab; there, drag the edge.

### The sliver: your current task

The sliver shows the task you are on right now: the one you started, else the next one due. It shows the task, the client and when it is due, as far as the window has room.

- **Start** moves a to-do task to In progress.
- **Done** completes it the same way as everywhere else (a task that needs review goes to review instead; a recurring task makes its next one). A short **Undo** shows for a few seconds, then the next task comes in. A **Send reports** task grows the window to List size so you can pick Full or Preliminary.
- **Expand** (or click the title) grows the window to List size.
- Keys, while the sliver has focus: **s** Start, **x** Done, **Enter** Expand.
- Offline, Start and Done are off until you reconnect. With nothing left it says **Clean slate**.

### Views, bulk edits, order and boards (Regular and Full)

- **Views.** In the view bar, **Views** saves the way your list is set up (group by, sort, chips) as a named view: save a new one, apply, rename, update with the current setup, or delete. Your earlier single view is still there, called **Default**. Up to 30 named views per list.
- **Bulk edit.** Select several tasks (**v**, or tick the boxes), then use **Status**, **Priority** or **Section** besides Complete, Reopen, Reassign, Move to project, Due date and Delete. Section is offered when every task you picked is in one project. One **Undo** reverses the whole change, and tasks that could not change are listed with the reason.
- **Manual order.** Turn on **Manual** (My tasks) or **Manual order** (a project, client or person list) and drag rows by their grip handle, or press **Alt+Up** or **Alt+Down** on a row. In a project you can drop a task into another section. **Esc** cancels a drag. The order is yours alone: nobody else's list changes, and the portal keeps its usual order.
- **List or Board.** The **List | Board** switch shows the same tasks as columns, by **Status** or by **Section**. Drag a card to another column to change that field; the rules are the same as the status pill, so a task that needs review still goes through review. Alt+arrow keys move a focused card. Each list remembers whether you left it as a list or a board.

### Links open in the portal

A client's page, a chat or a file opens in your portal window and the app stays where it is. If no portal window is open, the link opens in a new tab. **Open full portal** and **Help** in the app's menu do the same.

### Follow my client

- The **Follow my client** switch is in the app's top bar (in the menu in a compact window).
- When it is on, opening a client in the portal switches the app to that client's list.
- It is remembered in this browser, and both windows need to be open in the same browser.

### Dock it back

Click **Dock in portal**. Your portal window opens Slate on the same list and the app window closes. If no portal window is open, a new tab opens with it. If the browser will not close the app window, it stays open; close it yourself.

### Troubleshooting

- **"Your browser blocked the new window. Allow pop-ups for this site and try again."** Allow pop-ups for the portal's address in your browser's settings, then click **Open Slate app** again.
- **I don't see Open Slate app.** Use a computer. Until the owner turns the app on for the team, only people with the preview switch see it.
- **Templates, projects or bulk edits are grayed out.** Make the window wider (Regular or Full) or click **Full page**.
- **The size buttons are missing.** They only work in the app window. In a normal browser tab, drag the window's edge instead.

--- WORKBENCH LINE (workbench.md, under "Want your list in a small window?") ---

Deep task work (templates, projects, bulk edits, saved views, boards) lives in the Slate app: see [How do I use the Slate app?](#/help/tasks-own-window).

--- GET-THE-APP SECTION (get-the-app.md, new "### Install the Slate app" at the end) ---

### Install the Slate app

Slate can be installed as a second app next to MyGoodBooks, with its own icon, so you can open it from the Dock or Start menu without opening the portal first. In Chrome or Edge on a computer, click **Install Slate app** next to **Open Slate app** on the Slate page and confirm. To remove it, open the **⋮** (Chrome) or **…** (Edge) menu in the Slate window and choose **Uninstall MGB Slate**. See [How do I use the Slate app?](#/help/tasks-own-window).

--- ADMIN-INSIGHT (admin-insight.md, Developer tools, after the Feature flags sentence) ---

**Slate app preview** shows the Slate app for you only while the firm switch (`slate_app_enabled`) is off. Only the owner turns the firm switch on, with one SQL line.
