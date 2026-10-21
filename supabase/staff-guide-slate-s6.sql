-- Slate app S6 (upkeep): the MGB Desk window is gone (deleted in S5), so its staff guide text goes too.
-- Three articles: workbench (Desk window section and blocked pop-up line removed), get-the-app (Install MGB Desk removed;
-- a note for anyone who installed it during the preview), admin-insight (Desk window flag and desk_app_enabled rows replaced
-- by the Slate app preview and slate_app_enabled rows).
-- Upserts only, no deletes. Idempotent: a row whose content is unchanged keeps its updated_at.
-- Replaces supabase/staff-guide-desk-app.sql. Generated from docs/staff-guide/{workbench,get-the-app,admin-insight}.md.
-- The Slate app guide article, What's new entry and tour are DRAFTS (docs/staff-guide/drafts/), not in this file.
-- Applied to production 2026-10-21 (all three rows updated; body_md and keywords md5 match this file).
begin;

insert into public.staff_guide as g (slug, title, section, audience, body_md, keywords, sort)
values
  ($sg$workbench$sg$, $sg$How do I use the Desk?$sg$, $sg$Getting started$sg$, $sg$staff$sg$, $sg$The **Desk** (it was called the Workbench) sits on the right of every staff page, with an info bar along the bottom. Press **D** anywhere to open it (**W** no longer does): one list of everything that needs you, in order, with tabs for your **Inbox**, your **Slate** (it was called Tasks) and one **Client**. **Today** (the first place in the left rail; the address stays `#/today`) keeps its name and shows only the top of that list as a **Do next** card (always your own items, even while an admin has **Everyone** picked here); the full list stays here and in **Slate**.

The Desk and the new Today are on for the whole team (since October 21). See [What's on my Today page?](#/help/home-page) and [What changed: the Desk, left sidebar and new look](#/help/new-look-and-sidebar).

### The four counts

Today no longer has number tiles: the Desk's bar and rail carry the counts, and the filter buttons above the list keep theirs. They count like this:

- **Needs reply**: client messages where the client wrote last and nobody on our side has answered. Click it to show only messages.
- **Due today**: items due today. Click it to jump to the Today group.
- **Overdue**: items past their due date. Click it to jump to the Overdue group.
- **Reviews**: tasks waiting for your review, and your own work an admin sent back to you. Click it to show only those. (Ledger reviews waiting for an admin's approval are under the **Ledger** chip.)

### The list

Items are grouped **Overdue**, **Today** and **This week**, most urgent first. A client message is due the next business day after it arrives, and a new client file two business days after it's uploaded, so an unanswered message turns overdue after that. Anything due more than a week out is counted under the list as **N more later**, with a link to **Slate**.

The chips above the list filter by where an item came from: **All**, **Tasks**, **Reviews**, **Messages**, **Ledger**, **Documents** and **Other** (deadlines, bills, handbook signatures and the other Today rows), each with a count. **Snoozed** appears when you have snoozed something.

Each row says what it is, which client, and how long it has waited or when it's due. **Covering for <name>** means it's on your list because you're that person's backup while they're out.

### Doing the next thing

Each row has one main button (in the Desk, **Reply** and **Open file** stay on the page; see "Reply without leaving the page" below):

- **Reply** on a client message opens the conversation in the Inbox.
- **Start** or **Open** on a task opens its details.
- **Review** on a review, a client answer or a Ledger flag opens it where it lives.
- **File** on a new client upload opens the file.

The **⋯** menu next to it has the rest:

- **Snooze**: **Later today**, **Tomorrow 8am**, **Next Monday 8am** or **Pick a date**. The item leaves the list until then. If something changes on it first (the client writes again, the due date moves), it comes back early.
- **No reply needed** (messages): the client's last message doesn't need an answer, like a thank-you. The thread leaves the Desk without sending anything. A new message from the client puts it back. The same button is in the Inbox thread header.
- **Mark checked** (client files): you've looked at the upload. It leaves everyone's Desk.

Each of these shows **Undo** at the bottom of the screen for a few seconds.

Items also leave by themselves when the work is done: you reply, finish or approve the task, or clear the Ledger flags.

### The Desk, on every page

The Desk has three parts:

- **The info bar** along the bottom of every staff page. It shows how many of your tasks are **late** (in red), how many of today's you've done (**5 of 8 today**), your next task and its client, and **D to open/close**. On a client's pages it also shows that client's open tasks, how many are waiting on the client, and when QuickBooks last synced (with a red dot when the sync is old or failed). When you have nothing late or due today it says **Clean slate**. The bar is for reading: a click anywhere on it opens or closes the Desk.
- **The rail**, a slim strip on the right while the Desk is closed. It shows four counts only: **messages**, **reviews**, **files** and **mentions**. Point at one (or Tab to it) to see the latest few. Click it to open them: **messages** opens the chat drawer (on a client's page, already on that client), **mentions** opens the bell menu, and **reviews** and **files** open the Desk's Inbox on that filter. Each line in the flyout says who, what and how long it has waited (**Acme: Question · 3h**), with **+2 more** when there are more than three. Up and down arrows move between the icons, **Enter** opens one and **Esc** hides the flyout. The **+** at the foot is the quick add (task, note, document request, message); on a computer it replaces the **+** in the top bar while the Desk is on.
- **The column**: click the bar, click the rail or press **D**, and the rail widens into the Desk, in the same color as the left menu. Its **Inbox** tab has filters (**All**, **Tasks**, **Reviews**, **Messages**, **Files**) and the same buttons as the Needs you list on Today. Today is in the left menu. **D** closes it, and so does **Esc** while you're working inside it; it goes back to the rail and you're back where you were.

### Right now, at the top of the open Desk

The open Desk starts with two things above its tabs (they hide while a task shows):

- **Waiting counts**: the same messages, reviews, files and mentions the rail shows while it's closed, only the ones with something waiting. Click **messages**, **reviews** or **files** to filter the Inbox tab to them; **mentions** opens the bell menu.
- **Right now**: a card about the page you're on. On a client's page it shows your open tasks for that client (and how many are late, with a red dot), messages to answer and how long the oldest has waited, questions waiting on the client, a month close problem if there is one, and when QuickBooks last synced. Click the tasks line to open the Desk's **Client** tab, or the messages line to answer in the chat drawer. On **Inbox** it shows how many items wait on you and how long the oldest message has waited. On other pages there is no card. While the card shows a client, the info bar leaves out its own line for that client, so the same numbers aren't in two places.

The card uses what the page has already loaded, so it adds no wait. On a short window (under about 640 pixels tall) only the counts show, to leave room for the list.

**With the Desk on, the top bar has less on it.** The **Slate** button is a plain link to Slate (your late and today counts are in the Desk bar), and on a computer the top bar's **+** steps aside for the rail's **+**. On a phone the top bar keeps its **+**. Turn the Desk off and the top bar, Today's tiles and the rest come back as they were.

**The chat bubble steps aside while the Desk is on** (on a computer). The rail's messages icon opens the same chat drawer. On a phone the bubble stays, just above the bar.

**The page keeps working while the Desk is open.** Nothing is dimmed. On a wide window the column sits beside the page and pushes it over, so nothing is hidden; on a window narrower than about 1100 pixels it sits over the right side of the page instead. Either way you can scroll the page, click on it and use its shortcuts (like **q** for quick add, or **j** and **k** on a list) with the Desk still open. The top bar always runs the full width.

On a phone (or a window narrower than about 760 pixels) there is no rail: the bar sits at the bottom and the Desk opens as a full-screen sheet over the page, and can't be resized.

The panel remembers where you were: the filter you picked and how far you had scrolled. If you leave it open and reload the page within a few minutes it opens again where you left it; after that it stays closed but keeps your filter. **Reset local state** under Dev Tools clears what it remembers, including its width.

### Make the Desk wider or narrower

Drag the left edge of the open Desk to make it wider or narrower. It starts at **standard** (about 380 pixels) and goes from **narrow** (320) to **widest** (520); it snaps to narrow, standard and wide when you let go near one. A quick flick to the right, or dragging it well past narrow, closes it.

The Desk remembers your width for you, on this browser, and opens at it next time. If the window is too small to fit it beside the page, it shrinks to fit.

From the keyboard: press **Tab** until the left edge is selected, then use the left arrow to make it wider and the right arrow to make it narrower, **Page Up** and **Page Down** for the next width stop, **Home** for the narrowest and **End** for the widest. Screen readers hear it as a resize control with its current width.

The **Today** item in the left rail shows how many items are overdue or due today (a dot when the rail is narrow).

### Open a task without leaving the page

With the Desk on, a task opens inside the Desk, wherever you open it from: **Open** (or **Review**) in the Inbox tab, a row on the Slate or Client tab, a task on the Slate or My Tasks page or a client's page, the bell, or a link to a task. The page beside it does not change, and the row you opened is marked. Click that row again to close its task view. The column widens a little while a task shows (to at least 460px); it goes back to your width afterwards. On a phone the task fills the Desk sheet. Edit it, comment, tick it done, reassign it or approve it there.

- **← Back** at the top of the task goes back one step. Open a subtask or a parent from inside a task and Back names the task you came from; at the first task it says **Back to Desk**.
- **Esc** goes back one step too: it closes a menu or the SOP panel first, then goes from a subtask to its parent, then to the list (with your row selected again). If the Desk opened just for this task, that last step closes it and puts you back on the page where you were. In a box you're typing in, the first **Esc** only undoes the typing.
- **D** closes the Desk. The task waits there: press **D** within 5 minutes and it's still open.
- **F6** moves between the Desk and the page.
- **x** done, **s** status and **a** assignee work on the task showing, as they do in the task pop-up.
- With the Desk off, a task opens in the task pop-up as before.
- **q** (quick add) works while the Desk is open, as long as you're not typing in a box. **Add to your Slate** on the Slate tab and **+ Task** on the Client tab work too.
- On a task you haven't started, **Start** moves into the **⋯** menu, next to **Snooze** and **Open full page** (which goes to the task's page, as before).
- Ledger items still take you to where they live. Client messages and new files stay on the page too; see the next section.

### Reply without leaving the page

In the Desk, a client message has **Reply** and a new client file has **Open file**. Neither one changes the page behind the drawer.

- **Reply** opens the Messages chat drawer on top of the Desk, already on that person's thread. Type and send as usual. Once you reply, the item leaves your list within a couple of seconds.
- **Esc**, or a click on the dimmed page, closes the chat drawer and puts you back on the row you came from. Your filter, tab and scroll are as you left them.
- **Open file** opens or downloads the file in a new browser tab: a PDF or an image shows in the tab, while a spreadsheet, Word file or CSV downloads. The Desk stays open. The item stays in your list until you tick **Mark checked** in its **⋯** menu (there's an Undo).
- If your browser blocks the new tab, allow pop-ups for this site and click **Open file** again. If Drive can't find the file, a message says so; **Open full page** in the **⋯** menu goes to the client's Files tab.
- The **⋯** menu on a message or file also has **Open full page**, which goes to the thread or the Files tab as before. On the Messages page itself, **Reply** goes to the thread instead of stacking a second inbox.
- The Messages drawer only lists clients you can open. If you've lost access to a client, or the person isn't in that client's list, a message says it couldn't find the conversation (use **Open full page** in the **⋯** menu), and nothing from another client shows in its place.

### Your Slate in the Desk

The Desk has three tabs: **Inbox**, **Slate** and **Client** (see the next section). With a tab selected, the left and right arrow keys move between them. **Slate** lists every open task assigned to you, grouped **Overdue**, **Today**, **This week**, **Later** and **Waiting on client**, the same way the Slate page does. Tasks that are done or unassigned don't show here.

- Click a row to open the task in the Desk; **← Back** or **Esc** puts you back on the row. Tick the circle to mark it done from the list. The count on the tab is your open tasks.
- Click a group's name to fold it; the panel remembers which groups you folded.
- **Add to your Slate** opens quick add. **Slate page** goes to the full page.
- It shows up to 200 tasks. If you have more, a line says how many more there are and links to **Slate**.
- **Show older** on the Slate page doesn't change this tab, and this tab doesn't change the Slate page.
- Your filter, scroll and open tab are remembered for you only, on this browser. If you share a computer, the next person starts clean.

### Look up a client from the Desk

The **Client** tab shows one client's open tasks without leaving the page you're on.

- **Picking a client.** On a client's page, the tab starts on that client. Anywhere else it shows the client you looked at last. To pick another, click the box at the top and type part of the name, or use the up and down arrows and press **Enter**. The list shows your **Pinned** clients first, then **Recent** ones, then all of them. It only lists clients you can open, and leaves out MGB's own record and test clients (unless **Show test clients** is on). If there are more than 50, the last row says **Showing 50 of** the total; type to narrow it.
- **Pins.** The **☆** next to the client's name pins it to the top of the list (it turns into **★**); click it again to unpin. You can pin up to 8. Pinning a ninth unpins the oldest, and a message says which one. Pins are yours alone and only on this browser.
- **The tasks.** These are the same tasks, groups and contacts as the client's tasks panel (**t**). Add a task in the row at the top, tick a circle to mark it done, or click a row to open the task in the Desk; **← Back** or **Esc** puts you back in the tab. On a client's page, **t** opens this tab for that client (press it again to close the Desk). Private tasks show only to the people who can already see them.
- **+ Task** opens quick add for this client. **Open client** goes to the client's page and closes the Desk.
- **Esc** closes the client list first, then clears what you typed, then closes the Desk.
- If a client you looked at before is no longer yours, the tab says **You don't have access to this client** and hides it from your pins. The pin comes back if you get access again.

### Keyboard shortcuts

Click **?** on Today's Do next card and pick **Keyboard shortcuts**. They work when you're not typing in a box:

- **D** opens or closes the Desk (not while you're typing, with Ctrl, Cmd, Alt or Shift held, or while a task drawer, dialog, menu or tour is open on top of it). **W** no longer does anything.
- With the Desk's left edge selected, the left arrow makes it wider and the right arrow narrower; **Home** and **End** go to the narrowest and widest.
- On the rail, the up and down arrows move between the icons and **Enter** opens one.
- **j** and **k** move to the next and previous item; **Enter** does the main action; **o** opens it where it lives.
- **s** snoozes; **e** is **No reply needed** on a message or **Mark checked** on a file.
- **1** to **6** pick a filter on the full page, **0** goes back to All.
- The left and right arrows move between the Desk's tabs (**Inbox**, **Slate**, **Client**) while a tab is selected.
- **Esc** closes the top layer: a menu or the client list, then a drawer or dialog on top, then a task (back one step at a time), then the Desk (back to the rail). With focus on the page instead of the Desk, **Esc** belongs to the page and leaves the Desk open. On the rail, **Esc** hides the flyout.
- **F6** moves between the Desk and the page while the Desk is open.

### Admins: Mine or Everyone

Admins get **Mine** and **Everyone** next to the chips. **Everyone** shows every staff member's items, with whose each one is. Your choice is remembered.

### Want your list in a small window?

The Desk lives on the right of the portal. For a small window of your own beside QuickBooks or on a second screen, use Slate's own window instead: see [Can I keep Slate in its own window?](#/help/tasks-own-window).

### Troubleshooting

- **Something I expected isn't there.** The Desk and Today's Do next card only show clients you can open, and tasks waiting on the client stay on Slate. Check **Snoozed** too.
- **It says Couldn't refresh.** Click **Retry**. The last list stays on screen meanwhile. **Offline** means your connection dropped; it refreshes when you're back.
- **I'd rather have the old Today.** Click **?** on Today's Do next card and pick **Use classic Today in this browser**. Today then has **Switch back to the new Today** at the top. It only changes this browser. (Admins: it's also **Classic Today** under Dev Tools › Feature flags.)
$sg$, array[$sg$workbench$sg$, $sg$desk$sg$, $sg$tasks open in the desk$sg$, $sg$task in the desk$sg$, $sg$back to desk$sg$, $sg$back button$sg$, $sg$f6$sg$, $sg$move between desk and page$sg$, $sg$esc goes back$sg$, $sg$drill in$sg$, $sg$slate$sg$, $sg$the desk$sg$, $sg$slate tab$sg$, $sg$reply without leaving the page$sg$, $sg$reply from the workbench$sg$, $sg$open file$sg$, $sg$open file from the workbench$sg$, $sg$files open in drive$sg$, $sg$chat drawer$sg$, $sg$my tasks tab$sg$, $sg$tasks tab$sg$, $sg$tick done from the list$sg$, $sg$today$sg$, $sg$needs you$sg$, $sg$inbox$sg$, $sg$one list$sg$, $sg$drawer$sg$, $sg$right column$sg$, $sg$right side$sg$, $sg$rail$sg$, $sg$desk rail$sg$, $sg$info bar$sg$, $sg$bottom bar$sg$, $sg$right now$sg$, $sg$right now card$sg$, $sg$glance$sg$, $sg$waiting counts$sg$, $sg$page client$sg$, $sg$oldest wait$sg$, $sg$clean slate$sg$, $sg$late$sg$, $sg$done today$sg$, $sg$next up$sg$, $sg$qbo sync$sg$, $sg$chat bubble$sg$, $sg$messages icon$sg$, $sg$mentions$sg$, $sg$press d$sg$, $sg$d key$sg$, $sg$w key$sg$, $sg$resize$sg$, $sg$resize the desk$sg$, $sg$desk width$sg$, $sg$wider$sg$, $sg$narrower$sg$, $sg$drag the left edge$sg$, $sg$page stays usable$sg$, $sg$keyboard shortcuts$sg$, $sg$snooze$sg$, $sg$snoozed$sg$, $sg$no reply needed$sg$, $sg$mark checked$sg$, $sg$undo$sg$, $sg$needs reply$sg$, $sg$due today$sg$, $sg$overdue$sg$, $sg$reviews waiting$sg$, $sg$ledger flags$sg$, $sg$documents$sg$, $sg$new files$sg$, $sg$client files$sg$, $sg$mine$sg$, $sg$everyone$sg$, $sg$covering$sg$, $sg$classic today$sg$, $sg$workbench preview$sg$, $sg$j k$sg$, $sg$next item$sg$, $sg$open a task without leaving the page$sg$, $sg$stacked drawer$sg$, $sg$esc closes one layer$sg$, $sg$panel remembers$sg$, $sg$reopens where you left it$sg$, $sg$client tab$sg$, $sg$look up a client$sg$, $sg$client tasks from the workbench$sg$, $sg$pick a client$sg$, $sg$pinned clients$sg$, $sg$pin a client$sg$, $sg$star$sg$, $sg$unpin$sg$, $sg$recent clients$sg$, $sg$open client$sg$, $sg$+ task$sg$]::text[], 41),
  ($sg$get-the-app$sg$, $sg$How do I install MyGoodBooks as an app?$sg$, $sg$Getting started$sg$, $sg$staff$sg$, $sg$On your computer you can install MyGoodBooks as an app. It opens in its own window with no browser tabs, and gets its own icon in your Start menu, Launchpad or Applications folder. It's the same portal. Only signed-in staff are offered the install.

**On a phone or tablet, just use the website.** Open **app.mygoodbooks.org** in your phone's browser and sign in with Google. There is no phone app. If you added it to your phone's home screen earlier, remove that icon (press and hold, then **Remove App** or **Uninstall**) and use the website.

### Install on a computer (Chrome or Edge, Mac or Windows)

1. Open **app.mygoodbooks.org** in **Chrome** or **Edge** and sign in.
2. Click the **install** icon at the right end of the address bar (Chrome: a small screen with a down arrow; Edge: a few squares with a plus), then click **Install**.
   - Not there? In Chrome open the **⋮** menu, then **Cast, save and share → Install MyGoodBooks**. In Edge open the **…** menu, then **Apps → Install MyGoodBooks**.
3. The app opens in its own window. Next time, open it from the Start menu (Windows) or Launchpad or Applications (Mac), or pin it to your taskbar or Dock.

Use Chrome or Edge. Other browsers aren't supported for the app.

### Signing in to the installed app

The installed app shares your browser's sign-in. If you're signed in in Chrome or Edge, you're signed in in the app, and signing out in one signs you out of the other. If it asks you to sign in, use the small **MyGoodBooks staff? Sign in with Google** link at the bottom of the first screen and pick your @mygoodbooks.org account. You stay signed in until you sign out or the sign-in expires.

If Google doesn't finish signing in inside the app:

1. On the first screen, type your **@mygoodbooks.org email** in the box and click **Email me a sign-in link**.
2. Open that email and **type the code** into the app's **Sign-in code** box.
3. Click **Sign in**.

The code only works if you've signed in to the portal with Google at least once.

### Troubleshooting

- **I don't see the install icon.** Sign in first and use Chrome or Edge on a computer. It doesn't show if the app is already installed (you'll see an *Open in app* icon instead).
- **I installed MGB Desk during the preview.** That preview window is gone: the Desk itself is on the right of the portal (press **D**). Remove the old app the same way: open its **⋮** (Chrome) or **…** (Edge) menu and choose **Uninstall MGB Desk**.
- **I want to remove it.** In Chrome's app window, open the **⋮** menu and choose **Uninstall MyGoodBooks**. In Edge's app window, open the **…** menu, then **App settings**, then **Uninstall**. You can also go to `chrome://apps` or `edge://apps`, right-click MyGoodBooks and choose to remove it.
$sg$, array[$sg$install banner$sg$, $sg$install$sg$, $sg$app$sg$, $sg$desktop app$sg$, $sg$computer$sg$, $sg$chrome$sg$, $sg$edge$sg$, $sg$install icon$sg$, $sg$address bar$sg$, $sg$pwa$sg$, $sg$window$sg$, $sg$start menu$sg$, $sg$dock$sg$, $sg$get the app$sg$, $sg$phone$sg$, $sg$iphone$sg$, $sg$android$sg$, $sg$website$sg$, $sg$uninstall$sg$]::text[], 25),
  ($sg$admin-insight$sg$, $sg$Usage stats and Developer tools$sg$, $sg$Admin$sg$, $sg$staff$sg$, $sg$Two admin pages under **Settings › Firm settings › Insight and records**, next to the [Audit log](#/help/audit-log). Search (**Ctrl+K** / **⌘K**) jumps to each one too.

### Usage stats

Counts come straight from the database for the range you pick (7, 30 or 90 days, or all time), so the numbers are exact.

- **Most-used pages** ranks every page and tab (for example **Team › Performance**), with the staff and client split. A client's **Close** tab shows as **Close**. From Oct 10, 2026, coming back to a client opens the tab you left, so Overview views drop from that day and Close views start then. **Client view menu opened** under **Actions** counts how often staff open the Client view menu.
- **Trend** shows the last eight weeks of page views and how many different people were in each week.
- **Active people** shows how many staff and clients signed in over the last 7 and 30 days, then everyone by last seen. **Quiet clients** lists client organizations with no sign-in for 30 days or more, or none ever. That's a good list to nudge.
- **Actions** counts things people did rather than pages they opened: search opened with **Ctrl+K**, guide searches, guide searches that found nothing (the queries are listed so you can add an article), **Help for this page**, tours finished or skipped, and **Client ? menu clicks** (what clients pick from the **?** in their top bar: the tours, Messages, Help and settings, Contact support; previews don't count).
- **Devices** splits views across desktop, phone and the installed app.
- **Export CSV** downloads the page and people tables for the range.
- **Feature feedback** is the in-app survey, with **Copy summary for Claude**.
- **Announcements** at the very bottom lists each launch notice with how many people **Toured**, have **Seen** it (this includes Later), **Skipped** it or are **Not yet**, and a click on any count shows the names. Temporary admins and account managers only appear once they have answered, since the staff list can't tell them apart.

### Developer tools

- **Feature flags** are per-browser testing switches: force every client to Pro, verbose console logging, a simulated slow network, **Show unreleased features** (currently the **Install app** prompt), **Desk preview** (the Desk and new Today for you only while they're off for the team), **Slate app preview** (Slate as its own app for you only while its firm switch is off; for now the owner's testing switch), **Classic Today** (the old Today for you only once it's on), **Sidebar preview** (the new left sidebar for you only while its firm switch is off), **Lato font preview** (the whole app in Lato for you only while its firm switch is off), **Classic fonts** (the old fonts for you only once Lato is on), **Brand colors preview** and **Hover menus preview** (the new navy and teal look, and menus that open on hover, for you only while their firm switches are off), **Classic colors** and **Classic menus** (the old ones for you only once the firm switches are on) and **Month rhythm preview** (the Slate month rhythm work for you only while its firm switch is off; nothing uses it yet). Nothing here changes anything for anyone else. See [How do I use the Desk?](#/help/workbench).
- **Reset local state** clears this browser's saved layouts, theme and other per-browser hints. It also forgets the last tab you used on each client, any link waiting to open, which Onboarding cards you had open, and the **Show test clients** switch. Feature flags stay. Tours, Tips while you learn and launch announcements are saved to your account, so it doesn't reset them.
- **Slate switches** shows the firm-wide Slate settings, read-only: whether late tasks count in scores and reports (`late_tasks_count_against_staff`, off during the grace period) and the date it started counting (`late_tasks_effective_from`), whether the standard close set is live, **Ask client emails live** (off means every Ask client email and reminder is a dry run), the Ask client pilot clients, how many reminders come before **No reply**, how long an answer link works, the on-time start date, whether time off hands tasks to backups automatically on the first day off (off means only the manual **Hand my tasks to backups** / **Hand off tasks** buttons move them), whether the one-time Asana import can be applied (off; it ran once, on Oct 16, and was switched off again), whether the **Desk** and new Today are on for staff (`wb_enabled`, off until the owner turns it on), whether the new left sidebar is on for staff (`nav_enabled`), whether the whole app uses Lato (`lato_enabled`), whether the brand colors are on for everyone (`brand_enabled`) and whether menus open on hover for everyone (`hovernav_enabled`); `wb_enabled`, `nav_enabled`, `lato_enabled`, `brand_enabled` and `hovernav_enabled` are all on as of 2026-10-21 (they stay off until the owner turns them on), the sidebar's role defaults (`layout_defaults`, set in **Settings › Firm settings › Sidebar defaults**), whether the **Slate app** is on for staff (`slate_app_enabled`, off until the owner turns it on; the owner-only SQL line sets it, never this card), which business day of the next month a month's open Ledger flags count as due on it (`wb_gl_due_bday`; 10 when not set), from which date client uploads show there as new files (`wb_doc_check_from`; Oct 16 when not set), the **Month rhythm** days (`month_rhythm`, shown as for example 4th, 14th, 24th · next business day; 4th, 14th, 24th when not set; admins change it on **Settings › Firm settings › Month rhythm**) and whether the monthly rhythm tasks are on for everyone (`month_rhythm_enabled`, off until the owner turns it on). Only the owner changes them: the standard close set on **Slate › Recurring**, and **Ask client emails live** on **Settings › Firm settings › Emails** (**Client emails** card); the time-off, Asana import, Desk, Slate app, left sidebar, Lato, brand colors, hover menus and month rhythm switches are changed in the database only (the card only shows them).
- **Scheduled jobs** lists every automatic job (email outbox, digest, QuickBooks sync, health checks, chasers) with its schedule, last run and result. **Run now** starts one immediately. A red **failed** means the last run errored; **Run now** and read the message.
- **Recent errors** are errors the app caught in someone's browser: when, who, which page, app version and the message. Click one for the technical detail. Send that to whoever is fixing the app.
- **Recent activity** is every change to the staff list (added, removed, role changed, deactivated, reactivated), plus each Google sign-in account the app set up ("set up Google sign-in for …") and each **Fix sign-in** run. See [How do I add staff and manage their access?](#/help/staff-management).
- **Send me a test email** sends a short email to your own address so you can confirm the firm's sender works.
- **System info** shows the app version with **Reload for the latest**, which Supabase project the app talks to, and whether the staff table and audit log can be read.
- **Where things live** links to GitHub, Supabase, Vercel, Google Cloud, GoDaddy, Squarespace, Resend, the client-files Google Drive and the Intuit developer dashboard. Credentials are in the 1Password vault, never here.

### Emails › Delivery

The **Emails** page shows delivered, opened, clicked and bounced counts for the last 30 days once the Resend webhook is set up (Resend › Webhooks, pointed at the portal's `resend-webhook` function). Until then the card says so.

Keep **click tracking off** for the sending domain in Resend (Domains › your domain › Configuration). Ask-client emails carry a link that answers a request with no login, and click tracking would route that link through Resend. The webhook only stores when a click happened and the browser, never the link itself. Open tracking is fine.
$sg$, array[$sg$slate app preview$sg$, $sg$slate_app_enabled$sg$, $sg$mgb_slate_app_preview$sg$, $sg$workbench preview$sg$, $sg$classic today$sg$, $sg$wb_enabled$sg$, $sg$announcements$sg$, $sg$launch notice$sg$, $sg$who toured$sg$, $sg$usage stats$sg$, $sg$usage$sg$, $sg$analytics$sg$, $sg$page views$sg$, $sg$active users$sg$, $sg$last seen$sg$, $sg$quiet clients$sg$, $sg$developer tools$sg$, $sg$dev tools$sg$, $sg$feature flags$sg$, $sg$unreleased$sg$, $sg$scheduled jobs$sg$, $sg$cron$sg$, $sg$run now$sg$, $sg$errors$sg$, $sg$error log$sg$, $sg$test email$sg$, $sg$app version$sg$, $sg$reload$sg$, $sg$where things live$sg$, $sg$export csv$sg$, $sg$delivery$sg$, $sg$opened$sg$, $sg$clicked$sg$, $sg$webhook$sg$, $sg$click tracking$sg$, $sg$desk preview$sg$, $sg$slate switches$sg$, $sg$sidebar preview$sg$, $sg$nav_enabled$sg$, $sg$layout_defaults$sg$, $sg$left sidebar$sg$, $sg$month rhythm preview$sg$, $sg$month_rhythm$sg$, $sg$month_rhythm_enabled$sg$]::text[], 560)
on conflict (slug) do update set
  title      = excluded.title,
  section    = excluded.section,
  audience   = excluded.audience,
  body_md    = excluded.body_md,
  keywords   = excluded.keywords,
  sort       = excluded.sort,
  updated_at = now()
where (g.title, g.section, g.audience, g.body_md, g.keywords, g.sort)
  is distinct from
  (excluded.title, excluded.section, excluded.audience, excluded.body_md, excluded.keywords, excluded.sort);

commit;
