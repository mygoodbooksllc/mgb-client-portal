-- Slate app launch: staff guide text (seven articles). Regenerated 2026-10-25 against the live rows
-- (the older version of this file was built on stale base md5s). Generated from docs/staff-guide/*.md after
-- node docs/staff-guide/drafts/slate-launch-patch.mjs --write 2026-10-26 (What's new entry moved to the top).
-- Applied to production 2026-10-25 with tk_settings.slate_app_enabled turned on (owner said flip it).
-- Verify: select slug from staff_guide where body_md ilike '%Can I keep Slate in its own window%' (no rows).
-- tasks-own-window: before 1ab17ec3388a7b8fc73369c2a3458119 -> after 919e26c87257a1e7f960c299df8aeee3
-- whats-new: before dfc312c2c3063b10f1836cb8fd8f1ea4 -> after 696909ce72182766834dfcb41da948e1
-- tips: before 09c6f71efd1ad27863676532a3f630aa -> after 20a3c1023c3848aea60b6ee393a2a9d4
-- workbench: before 0d3058d411aeb1a52e0cce20c78e9fd3 -> after 68c3c08f43dbd6bc0258a15d3cb9fd7d
-- get-the-app: before 4ebbedd44b9ecc89d17e7c7f39661368 -> after b4e95631a45d93cfc481ac4444dc7c56
-- admin-insight: before 0fbff5e0d5d828df67e2ae121c2b5891 -> after 90090cf830cf9f771d6982fc62e054f2
-- client-tasks-drawer: before 75d871b25098ff165ed44dc9071e353e -> after c71dd6a976ef96569ac40091f1c87192
-- One DO block (atomic). Pre-check: each live row must be at its base md5 (or already at the after md5,
-- so a re-run is a no-op). Post-check: each row must end at the after md5. Upserts only, no deletes.
do $guard$
declare cur text;
begin
  select md5(body_md) into cur from public.staff_guide where slug = 'tasks-own-window';
  if cur is distinct from '1ab17ec3388a7b8fc73369c2a3458119' and cur is distinct from '919e26c87257a1e7f960c299df8aeee3' then raise exception 'tasks-own-window: live row changed (md5 %), regenerate', cur; end if;
  select md5(body_md) into cur from public.staff_guide where slug = 'whats-new';
  if cur is distinct from 'dfc312c2c3063b10f1836cb8fd8f1ea4' and cur is distinct from '696909ce72182766834dfcb41da948e1' then raise exception 'whats-new: live row changed (md5 %), regenerate', cur; end if;
  select md5(body_md) into cur from public.staff_guide where slug = 'tips';
  if cur is distinct from '09c6f71efd1ad27863676532a3f630aa' and cur is distinct from '20a3c1023c3848aea60b6ee393a2a9d4' then raise exception 'tips: live row changed (md5 %), regenerate', cur; end if;
  select md5(body_md) into cur from public.staff_guide where slug = 'workbench';
  if cur is distinct from '0d3058d411aeb1a52e0cce20c78e9fd3' and cur is distinct from '68c3c08f43dbd6bc0258a15d3cb9fd7d' then raise exception 'workbench: live row changed (md5 %), regenerate', cur; end if;
  select md5(body_md) into cur from public.staff_guide where slug = 'get-the-app';
  if cur is distinct from '4ebbedd44b9ecc89d17e7c7f39661368' and cur is distinct from 'b4e95631a45d93cfc481ac4444dc7c56' then raise exception 'get-the-app: live row changed (md5 %), regenerate', cur; end if;
  select md5(body_md) into cur from public.staff_guide where slug = 'admin-insight';
  if cur is distinct from '0fbff5e0d5d828df67e2ae121c2b5891' and cur is distinct from '90090cf830cf9f771d6982fc62e054f2' then raise exception 'admin-insight: live row changed (md5 %), regenerate', cur; end if;
  select md5(body_md) into cur from public.staff_guide where slug = 'client-tasks-drawer';
  if cur is distinct from '75d871b25098ff165ed44dc9071e353e' and cur is distinct from 'c71dd6a976ef96569ac40091f1c87192' then raise exception 'client-tasks-drawer: live row changed (md5 %), regenerate', cur; end if;
  insert into public.staff_guide as g (slug, title, section, audience, body_md, keywords, sort)
  values
    ($sg$tasks-own-window$sg$, $sg$How do I use the Slate app?$sg$, $sg$Daily work$sg$, $sg$staff$sg$, $sg$The **Slate app** is Slate in a window of its own, for example next to QuickBooks or on a second screen. Open it from the portal whenever you want it; the portal never opens it for you, and everything in Slate still works inside the portal exactly as before.

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
- **List or Board.** The **List | Board** switch shows the same tasks as columns, by **Status** or by **Section**. Drag a card to another column to change that field; the rules are the same as the status pill, so a task that needs review still goes through review. Alt+arrow keys move a focused card. Each list remembers whether you left it as a list or a board. The Done column shows only the done tasks Slate has already loaded.

### Quick actions (in the app)

These work in the Slate app only, on My tasks and on project, client and person lists. Nothing changes in the portal.

- **Right-click menu.** Right-click a task (or press and hold it on a touch screen) for **Open**, **Edit title**, **Mark done**, **Duplicate**, **Copy**, **Paste here**, **Assign to me**, due dates, **Snooze a day**, **Move to section** (projects), **Select** and **Delete**. With several tasks selected, the menu acts on all of them. Shift+right-click shows the browser's own menu.
- **Duplicate, copy and paste.** **Cmd+D** (Ctrl+D on Windows) duplicates the task, or the selected tasks, right where they are. **Cmd+C** copies them and **Cmd+V** pastes copies into the list you are on; in a project they land in the focused task's section. Copies are new tasks assigned to you, with the same title, notes, due date and subtasks, but they are never part of a recurring template, and nobody gets an email about them. Tasks stay with their own client: you can't paste one client's task into another client's list.
- **Select several.** Shift-click or Cmd-click (Ctrl-click) rows, or drag a box across empty space beside the rows. Hold Shift while you drag to add to what is already selected.
- **Quick keys.** **E** edits the title of the focused task, **Enter** opens it, **X** marks it done, and the **Up** and **Down** arrows move between tasks. Press **?** for the full list.
- **Drag onto a person or a date.** While you drag a task, a panel appears on the right (at the bottom on a phone): drop on **Today**, **Tomorrow**, **Next week**, **No date** or a person's name. Turn on **Manual order** to drag tasks between sections in a list, or use the **Board**.
- **Swipes on a touch screen.** Swipe a task right to mark it done, or left to snooze it a day. Press and hold to pick a task up and drag it.
- **Swipe back.** Swipe two fingers right on a trackpad (or from the left edge of a touch screen) to close the open menu, then the open task, then go to the previous page. In Safari, the trackpad swipe is Safari's own Back.
- **Undo.** In the app, **Undo** (or **Cmd+Z**) works for 9 minutes after a change, instead of 10 seconds. Undoing a duplicate or a paste deletes the copies, the same way **Delete** does. If someone changed the task since (you or a teammate), a late **Undo** leaves it alone and says so, so it never wipes out newer work.

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
- **I don't see Open Slate app.** Use a computer; on a phone or tablet, use Slate inside the portal. If you still see **Open in own window**, an admin has put your browser on **Classic tasks page**.
- **I'd rather use the old window.** Ask an admin to tick **Classic tasks page** on your computer, in Settings › Firm settings › Developer tools › Feature flags. It is per browser, and the Slate page in the portal is the same either way.
- **Templates, projects or bulk edits are grayed out.** Make the window wider (Regular or Full) or click **Full page**.
- **The size buttons are missing.** They only work in the app window. In a normal browser tab, drag the window's edge instead.
$sg$, array[$sg$slate app$sg$, $sg$open slate app$sg$, $sg$install slate app$sg$, $sg$mgb slate$sg$, $sg$own window$sg$, $sg$open in own window$sg$, $sg$pop out$sg$, $sg$popout$sg$, $sg$slim window$sg$, $sg$sliver$sg$, $sg$strip$sg$, $sg$compact$sg$, $sg$regular$sg$, $sg$full page$sg$, $sg$full$sg$, $sg$size$sg$, $sg$window size$sg$, $sg$sliver start$sg$, $sg$sliver done$sg$, $sg$undo$sg$, $sg$expand$sg$, $sg$detail pane$sg$, $sg$views$sg$, $sg$saved views$sg$, $sg$named views$sg$, $sg$bulk$sg$, $sg$bulk status$sg$, $sg$bulk priority$sg$, $sg$bulk section$sg$, $sg$manual order$sg$, $sg$drag$sg$, $sg$reorder$sg$, $sg$alt up$sg$, $sg$alt down$sg$, $sg$board$sg$, $sg$board view$sg$, $sg$columns$sg$, $sg$status columns$sg$, $sg$section columns$sg$, $sg$list or board$sg$, $sg$dock$sg$, $sg$dock in portal$sg$, $sg$side by side$sg$, $sg$quickbooks$sg$, $sg$second monitor$sg$, $sg$/slate$sg$, $sg$/tasks$sg$, $sg$pop-up blocked$sg$, $sg$follow my client$sg$, $sg$follow$sg$, $sg$install$sg$, $sg$dock icon$sg$, $sg$start menu$sg$, $sg$classic tasks page$sg$, $sg$mgb_slate_classic$sg$, $sg$old window$sg$]::text[], 116),
    ($sg$whats-new$sg$, $sg$What's new$sg$, $sg$Getting started$sg$, $sg$staff$sg$, $sg$The newest changes to the staff side, newest first. For how anything works, search this guide or click **?** → **Help for this page**.

Each new launch also has a **Launches** list above, with **Open** and **Take the tour**, so a tour is never lost once its notice is gone.

### 2026-10-26: Slate is now its own app

- **Open Slate app.** On the Slate page and on the Desk's **Slate** tab, **Open Slate app** opens Slate in a window of its own. It replaces **Open in own window**. The portal never opens it for you, and Slate inside the portal works as before.
- **Install it.** **Install Slate app** adds Slate to your Dock or Start menu in Chrome or Edge on a computer, as a second app next to MyGoodBooks.
- **Four sizes.** Shrink the window to a **sliver** with just your current task and **Start** and **Done**, a **compact** list, a **regular** list with a rail, or a **full** page with a detail pane. The **Sliver**, **List** and **Full page** buttons jump to a size.
- **Shape your work.** In the app: named **Views** you can save and switch, bulk **Status**, **Priority** and **Section**, **Manual order** by dragging rows (or Alt+Up and Alt+Down), and a **List | Board** switch with columns by status or section.
- **Quick actions.** In the app: a right-click (or press and hold) menu on every task, **Cmd+D** to duplicate, **Cmd+C** and **Cmd+V** to copy and paste, drag a box to select several, **E**, **Enter** and **X** on the focused task, drag a task onto a date or a person, swipe right to finish and left to snooze on a touch screen, a two-finger swipe back, and a 9-minute **Undo**.
- **Links open in the portal.** A client page, chat or file opens in your portal window and the app stays put.

See [How do I use the Slate app?](#/help/tasks-own-window) and [How do I install MyGoodBooks as an app?](#/help/get-the-app).

### 2026-10-23: View as covers the whole app, and Last seen (admins)

- **View as covers the whole app.** On **HR › Members**, **View as** now shows a bookkeeper's Today (in its classic form), Clients and each client's pages, Work (with a read-only snapshot of their Slate), Team and HR. Their Inbox, Reviews and Handbook show a private placeholder, and private tasks stay hidden. See [How do I add staff and manage their access?](#/help/staff-management).
- **It's read-only.** The bar says "Read-only. Nothing you do here is saved." Anything that would save or send is refused with a note, and each blocked attempt is recorded in the [Audit log](#/help/audit-log) as *View as: blocked change*. Budgets show **Approve** greyed out, with a link to exit View as and approve.
- **Last seen.** A new **Last seen** button next to **View as** shows a person's last page and time, device, browser, app version, last sign-in and last error, with a link to **Recent errors**. Admins only. See [Usage stats and Developer tools](#/help/admin-insight).
- **Usage stats ignore View as.** Time you spend in View as no longer counts as the bookkeeper's activity.

### 2026-10-22: Change a client's bookkeeper from its list (admins)

On a client's Slate list, admins can click the **Bookkeeper** in the header, pick someone else and click **Reassign**. A ticked box also moves the old bookkeeper's open tasks on that client to the new one; tasks in review, private tasks and tasks anyone else owns or is on stay put. No email is sent. See [Change a client's bookkeeper](#/help/task-lists-and-projects).

### 2026-10-21: The Desk, a left sidebar and a new look

The Desk and the new **Today** are on for everyone, with a **left sidebar** under the rail (your **Pinned** and **Recent** clients, and a gear to **Customize** it), the **Lato** font, brand colors (navy and teal), and menus that open when you point at them. Press **D** to open the Desk. A short tour covers all of it: **?** → **New: The Desk, a left sidebar and a new look**. The old Today is one click away in the **?** on the **Do next** card. Admins and temporary admins can switch the old fonts, colors and menus back on this computer under **Developer tools › Feature flags**. See [What changed: the Desk, left sidebar and new look](#/help/new-look-and-sidebar).

### 2026-10-21: Ledger review: Roll-forward

Ledger review has a new **Roll-forward** panel under **Reconciliation**. For each bank, credit card and loan account it shows the month's beginning balance, the money in and out by type, and the ending balance, then checks that ending against QuickBooks. An account that doesn't tie opens by itself and shows the difference. It's for looking only; no flags are created. See [How does Ledger review work?](#/help/ledger-review).

### 2026-10-21: Reviews: see the comparison together in your meeting

Once both sides of a quarterly review are in, the comparison now opens first for your reviewer and the admins, so they can prepare. You get an email and a **Both sides complete. Set up a time with** (your reviewer) message on **My review**. In the meeting, your reviewer (or Jesse or Bailley) clicks **Reveal comparison**, and you see it together. Signing opens after the reveal. Reviewers see **Ready to reveal** on **Reviews I'm giving**. See [How do quarterly reviews work?](#/help/quarterly-reviews) and, for admins, [How do I run a review cycle?](#/help/review-cycles).

### 2026-10-21: No more photo popup

The full-page **Add your profile photo** screen is gone. Everyone has a task, **Finish setting up your portal profile**, due Wednesday, October 28. Add your photo under **Settings › Profile** when you have a minute. See [How do I add or change my profile photo?](#/help/profile-photo).

### 2026-10-21: Month rhythm setting (admins)

Admins have a new **Month rhythm** card in **Settings › Firm settings**. It holds the three days each month when Slate's monthly tasks will come due: **Check in** (4th), **Send reports** (14th) and **Follow up** (24th), plus what happens when a date falls on a weekend or firm holiday. For now it only stores the dates; the monthly rhythm tasks come later, so nothing changes for anyone else yet. See [How do I change my settings?](#/help/staff-settings).

### 2026-10-21: Group, sort and filter Slate your way

Slate has a new bar above the list. **Group by** now offers **Due date**, **Client**, **4/14/24th** (Check in, Send reports, Follow up) and **Status**. **Sort** chips order tasks inside each group by due date, priority, status or name. Two quick chips, **Mine today** and **Waiting on client**, narrow the list in one click, and **Reset view** puts it back. Your view is remembered per person. The same bar is on the Desk's **Slate** tab. A short tour comes with it; rerun it from **?** → **New: Group, sort and filter Slate tour**. See [How do I use my Slate?](#/help/my-tasks).

### 2026-10-20: Handbook approver changes and a "sent back" email

- **Only the Co-CEOs change the approver.** On the Handbook tab, only Bailley and Jeff see **Change** next to the policy approver. Other admins still see who it is, with the note **Only Bailley or Jeff can change the approver.**
- **Sent back by email.** When the approver clicks **Request changes**, whoever edited the draft last gets one email with the note and a link to the draft. Nobody is emailed if the approver made the last edit. Switch it off in **Settings › Notifications › Handbook drafts sent back to me**. See [How do I sign the Staff Handbook?](#/help/staff-handbook).

### 2026-10-20: Anonymous survey answers show right away

Admins now see the anonymous answers to survey questions 7 and 10 as soon as one person has answered, including for the current quarter. They still show without names. The survey page tells staff that, with a small team, an admin may be able to guess who wrote one.

### 2026-10-19: Handbook drafts need approval

- **One approver.** A handbook draft can only be published once the policy approver (Bailley) has approved its current text. Each draft shows **Awaiting Bailley's approval**, **Changes asked** or **Approved**, and the Drafts group has filters with counts. Published policies, including the Flexible Work policy, don't change.
- **For Bailley.** **Needs your approval (N)** on the Handbook tab, a Today row, the count on the tab and at most one email every 30 minutes (switch it off in **Settings › Notifications › Handbook drafts to approve**). In a draft, **Approve version N** or **Request changes** with a note.
- **Admins: edit any draft.** **Edit text** (Markdown with a live preview) and **Edit details** work on every draft, approved or not. Saving new text sends it back to Bailley, and the editor warns you first. To change a published reference policy, use **Publish new version** (always a minor edit). **Change** at the top of the tab picks a different approver.
- **The Employee Handbook, chapters 1 to 9,** are loaded as reference drafts waiting for approval, with **[TBD: ...]** where details still need filling in. See [How do I sign the Staff Handbook?](#/help/staff-handbook).

### 2026-10-19: Month swing in Ledger review

- **A new low priority check.** **Month swing** flags an income or expense account whose month total is at least $1,000 and at least 50% away from its average over the three months before it, up or down, with the numbers in the flag. It needs at least two earlier months in the pull, so the usual 14-month pull shows it and a year-to-date pull early in the year may not. See [How does Ledger review work?](#/help/ledger-review).

### 2026-10-19: HR is now its own place

- **A new place in the left rail.** **HR** sits right below **Team**. **Handbook**, **Reviews** and **Onboarding** moved there, and admins also find **Members** (real admins, **Employee records**) there. **Team** keeps **People**, **Performance** and **Inventory**, plus **Hours**, **Reply times**, **Feedback** and **Ledger review** for admins.
- **Old links still work.** A bookmark or email that points at `#/team/handbook`, `#/team/reviews`, `#/team/onboarding`, `#/team/employees` or `#/team/members` opens the same page under HR.
- **One number.** The number next to HR in the rail adds up what's waiting on you under **Reviews** and **Handbook**. A short tour comes with it; rerun it from **?** → **New: HR is now its own place tour**. See [What's on the Team page?](#/help/team-page).

### 2026-10-19: Reference policies and employee records

- **Two kinds of handbook policy.** **Team › Handbook** now has **Signed** policies (bookkeepers sign, as before) and **Reference** policies (read only; nobody signs them, and they never add a Today row, a badge or an email). The list starts with **Policies to sign**, then the reference policies by section, with a search box. See [How do I sign the Staff Handbook?](#/help/staff-handbook).
- **Admins: New policy.** Add a policy from the Handbook tab. It's saved as a reference draft only admins see. A new policy never asks anyone to sign; **Make this a signed policy** is the one step that does, and only after you confirm it.
- **Admins: Employee records.** **Team › Employee records** keeps job details, personal contact details and an emergency contact for each staff member, with their handbook signatures. Admins only (not a temporary admin grant), and each record you open is logged. See [How do I keep employee records?](#/help/employee-records).

### 2026-10-19: A real Home for Basic clients

- **Home at a glance.** A Basic client's Home no longer shows a locked card. Below **Needs you** and the organization card it has a **Choose files** box, **Latest from your bookkeeper** (with **Reply**), **Latest statements**, **Your files** and one slim row on what Pro adds.
- **Drop files anywhere.** They can drag files onto the page, then pick where each goes (bank statement, card statement, receipts, invoices and bills, tax documents, something else). It's the Documents page's upload, so files land in the same Drive folders. Details in [the client portal article](#/help/client-portal).

### 2026-10-19: A calmer Today

- **One Do next card.** Today now leads with your top item (what, which client, when it's due, and **then:** the one after it) and a button that starts or opens it. The long **Needs you** list, the filter buttons and the four number tiles are gone from Today; **Work › Slate** and the Desk (press **D**) hold the full list. **N more tasks in Slate** (or **N more in your Desk**) links there.
- **A count line.** Under the greeting: **3 due today · 1 late · Open Slate**.
- **Small cards.** **Clients needing attention** (reply waiting, close blocked, client health, no backup), **Waiting on others** (access and upgrade requests, replies), **Your reminders** and **This week** (birthdays, anniversaries and milestones to review), then a **Recent clients** line. **Also show** at the bottom switches each one off; all start on.
- **Approvals and other less common items** (handbook, deadlines, bills, access approvals, upgrades) sit under **Also needs you** on Today. A short tour comes with it; rerun it from **?** → **New: A calmer Today tour**. See [What's on my Today page?](#/help/home-page).

### 2026-10-19: Right now, at the top of the Desk (still off until the owner turns it on)

- **The Desk follows the page.** The open Desk now starts with your waiting counts (messages, reviews, files, mentions; click one to filter) and, on a client's page, a **Right now** card: your open tasks for that client (late ones marked), messages to answer and the oldest wait, questions waiting on the client, a month close problem and the QuickBooks sync. On **Inbox** it shows what waits on you.
- **Rail flyouts say how long.** Each line now ends with how long it has waited, plus **+N more** when there are more.
- **Fewer duplicates.** With the Desk on, the top bar's **Slate** is a plain link (no numbers), the top bar's **+** moves to the foot of the rail on a computer, and Today drops its four number tiles. Turn the Desk off and they come back. A short tour comes with it; rerun it from **?** → **New: Right now, at the top of the Desk tour**. See [How do I use the Desk?](#/help/workbench).

### 2026-10-19: Tasks open in the Desk (still off until the owner turns it on)

- **No more pop-up.** With the Desk on, a task you open from Slate, My Tasks, a client's page, the bell or a link shows in the Desk column beside the page, so the list stays in view. The column widens a little while a task shows. On a phone it fills the Desk sheet.
- **Back steps back.** **← Back** at the top of the task (or **Esc**) goes from a subtask to its parent, then to the list. If the Desk opened just for the task, it closes again. **D** closes the Desk and the task waits there for 5 minutes.
- **F6** moves between the Desk and the page. **Esc** also hides a rail flyout.
- **t opens the Desk's Client tab** on a client's page, and the task strip under the client's tabs is gone while the Desk is on. With the Desk off, both work as before. See [How do I use the Desk?](#/help/workbench).

### 2026-10-19: The Desk moves to the right (still off until the owner turns it on)

- **A rail and a column.** While closed, the Desk is a slim rail on the right with four counts: messages, reviews, files and mentions. Point at one for the latest few; click to open. Press **D**, or click the rail or the bar, and it widens into the Desk beside the page. Drag its left edge to make it wider or narrower; it remembers your width. **Esc** goes back to the rail.
- **An info bar along the bottom.** It shows what's late, how many of today's tasks you've done, your next task and, on a client's pages, that client's open tasks, waiting tasks and QuickBooks sync. **Clean slate** when there's nothing late or due.
- **No chat bubble while the Desk is on** (on a computer). The rail's messages icon opens the same chat drawer. On a phone the bubble stays and the Desk still opens full screen from the bar. A short tour comes with it; rerun it from **?** → **New: The Desk moves to the right tour**. See [How do I use the Desk?](#/help/workbench).

### 2026-10-19: Settings and Sign out are only at the top right

- **One account menu.** The left sidebar no longer shows your name, **Settings** or **Sign out**. Click your picture or initials at the top right for **Settings**, dark mode, Preview as and **Sign out**. On a phone they're still in the menu at the top left.
- **More room for the places.** The sidebar is just Today, Inbox, Work, Clients and Team, with **Expand** and **Collapse** at the bottom. A short tour comes with it; rerun it from **?** → **New: Settings and Sign out are at the top right tour**. See [Getting started](#/help/getting-started) and [How do I change my settings?](#/help/staff-settings).

### 2026-10-19: The Desk is the same color as the left menu (still off until the owner turns it on)

- **Look only.** The Desk panel and its bar are now solid, the same color as the left menu, instead of see-through glass. Nothing else about the Desk changed.

### 2026-10-19: Final scores when a review locks

- **One email each when it locks.** When both of you sign a quarterly review, the team member and the reviewer each get one email with the final scores (the reviewer's ratings: each area out of 5, Overall out of 30), how each one changed from the last locked review (**Up**, **Down** or **No change**) and the agreed action steps. It replaces the old "signed and locked" email; reviews that locked before today don't get a second one.
- **Gaps and first reviews.** If the last locked review wasn't the quarter right before, the email says which quarter it compares with. On a first locked review there's nothing to compare yet, and it says so.
- **Also on the review.** Open a locked review on **Team › Reviews** to see the same numbers under **Compared with last quarter**. Comments and self-review scores are never in the email, and an addendum doesn't send it again. A short tour comes with it; rerun it from **?** → **New: Final scores when a review locks tour**. See [How do quarterly reviews work?](#/help/quarterly-reviews).

### 2026-10-19: Task details open with the main fields at the top

- **One block at the top.** A task's details now start with **Assignee**, **Due**, **Client**, **Project**, **Priority** and **Status** together, each with its name on the left. **Status** moved there from beside the title.
- **Empty fields say so.** A blank field shows faint text such as **Unassigned**, **No due date**, **No client** or **No project**.
- **Same rules as before.** The due date saves once it's fully typed, the same way as on a task row; view-only tasks and tasks in review stay locked the same way. Description, subtasks, comments and **Ask client** are below as before. A short tour comes with it; rerun it from **?** → **New: Task details fields at the top tour**. See [What's in a task's details?](#/help/task-details).

### 2026-10-19: Settings › Plan now describes only what exists

- **Written for a Basic client.** Each Pro card says where it shows up ("Adds a Budget tab", "Replaces the locked card on Home"), and the tool-by-tool list says "What you get on the Budget tab" instead of implying Basic already has it. On Reports, only the Board packet is new; the four statement PDFs are on Basic.
- **Claims brought back to what the portal does.** Cash flow is a planning list for paying bills with a CSV export (no bank file, no approval step, nothing is paid), and duplicate-bill checks match the same vendor and amount. Bank accounts has a read-only reconciliation view and a downloadable reconciliation PDF (no month-end close). Giving & funds lists fund balances, contributions and year-end statements you download per donor (nothing is emailed). Home lists the four numbers it really has (Cash, Receivables, Payables, Net income this month).
- **Same wording everywhere.** The Pro tour, locked cards, README plan block and the pricing page embed match. The embed must be pasted into Squarespace again to show it publicly.

### 2026-10-19: Task rows you can change in place

- **Change it right on the row.** Click a task's person badge, due date or priority to pick a new one without opening the task. The badge is the person's initials; a dashed circle means nobody is on it yet.
- **Due dates you can read at a glance.** Red means overdue, amber means due today, and a faint calendar means no date. Click it for **Today**, **Tomorrow**, **Next Monday**, **Pick a date…** or **Clear date**.
- **A ... menu on hover.** It holds **Open**, **Mark done**, **Claim** and **Copy link**.
- **Add task at the bottom of each group.** In Slate, My Tasks and a client's panel, click **Add task**, type a name and press **Enter**; it's made in that group's day or client and the box stays open for the next one. **Esc** closes it. A short tour comes with it; rerun it from **?** → **New: Task rows you can change in place tour**. See [How do I use my Slate?](#/help/my-tasks).

### 2026-10-17: The left sidebar starts as icons

- **Icon rail by default.** The sidebar on the left now opens as the narrow icon rail, with the name under each icon, so pages get more room. Hover over an icon, or tab to it, to see its full name.
- **Expand and it stays that way.** Click **Expand** at the bottom of the rail to show the full names; the portal remembers your choice (per person, on this browser) and keeps it until you click **Collapse**.
- **Narrower and tidier when expanded.** The expanded sidebar is a little narrower (220px), and the places fill the sidebar down to **Expand** (on 2026-10-19 your name, **Settings** and **Sign out** moved to the top-right account menu). A short tour comes with it; rerun it from **?** → **New: The sidebar starts as icons tour**. See [Getting started](#/help/getting-started).

### 2026-10-17: Smarter duplicate checks in Ledger review

- **Smart mode (the new default).** The **Possible duplicate** check now skips look-alikes that are clearly not duplicates: amounts under $1, a Payment and a Deposit on Undeposited Funds, entries with different memos or different invoice numbers, and the lines of one split transaction. Monthly payments never flag, since the dates differ. When in doubt it still flags.
- **Strict mode** is the old rule: every same-date, same-name, same-amount match. A chip on the Ledger review tab shows which mode applies, and in Smart mode the tab lists what it set aside.
- **Admins:** pick the mode for the firm in **Team › Ledger review**, or for one client on that client's Ledger review tab. Changes are logged in the Audit log. A change to Smart applies on the next Pull; flags Smart no longer detects show **No longer flagged (Smart mode)** and come back if you switch to Strict. See [How does Ledger review work?](#/help/ledger-review).

### 2026-10-17: Resize the Desk, keep using the page, and D to open it (still off until the owner turns it on)

- **Press D** to open and close the Desk (it was **W**, which no longer does anything). Not while you're typing or with Ctrl, Cmd, Alt or Shift held.
- **Drag its top edge** to make it shorter or taller: short (about one row plus the tabs), medium or tall. It remembers your height on this browser. You can also drag up on the closed bar to open it.
- **The page stays usable.** Nothing is dimmed behind the Desk any more: scroll, click and use page shortcuts such as **q** with it open. **Esc** closes the Desk only while you're working inside it.
- On a phone (or a narrow window) it still opens as a full-height sheet. A launch notice and tour come with it; rerun it from **?** → **New: The Desk: glass, resizable, D to open tour**. See [How do I use the Desk?](#/help/workbench).

### 2026-10-17: No late-task penalties yet while everyone settles in

- **A grace period.** Late and overdue tasks are not counted against anyone yet: not in the performance score, client health, on-time rates, the weekly digest or the Team page's Overdue columns. Filing deadlines are not tasks, so they still count. Your own Slate still shows what is due, as a reminder.
- **Admins:** **Settings › Firm settings › Late tasks** has **Count late tasks in scores and reports**, off by default. Only the owner can turn it on, and only tasks due after that day will count. See [Staff settings](#/help/staff-settings) and [How is my score worked out?](#/help/performance).

### 2026-10-17: The Desk is frosted glass (still off until the owner turns it on)

- **Look only.** The Desk panel and its bar at the bottom are now see-through frosted glass, centered about 640 pixels wide beside the left menu, so you can still make out the page behind them. Rows sit on a lighter layer so the text stays easy to read.
- Menus, windows, tours and the task drawer stay solid. On a phone the Desk is still a full sheet. If your device is set to reduce transparency, the Desk is solid.

### 2026-10-17: The Workbench is now the Desk, and Tasks is now Slate

- **Only the names changed.** The panel at the bottom of every page is the **Desk** (it was the Workbench), and the whole Tasks area is **Slate** (the **Tasks** tab under Work, the top-bar button, and **My tasks** are now just **Slate**). Nothing moved and your settings, pins and tasks are untouched.
- **Today keeps its name.** Its list is still called **Needs you**; the Desk's old *Full page* link is gone (Today is in the left menu), and the button that added a task is **Add to your Slate**.
- A launch notice and tour come with it; rerun it from **?** → **New: Workbench is now Desk, Tasks is now Slate tour**. See [How do I use the Desk?](#/help/workbench) and [How do I use my Slate?](#/help/my-tasks). Older entries below keep the old names.

### 2026-10-17: A Client tab in the Workbench (the Workbench is still off until the owner turns it on)

- The Workbench panel has a third tab, **Client**: one client's open tasks and contacts without leaving the page. On a client's page it starts on that client; type in the box to pick another.
- **☆** pins a client to the top of the list (up to 8, on this browser). **+ Task** adds a task for the client; **Open client** goes to their page.
- See [How do I use the Workbench?](#/help/workbench).

### 2026-10-16: Select many tasks at once, with Undo

- **Select many tasks.** In My Tasks and on every list, tick the small box at the left of a row (it shows when you point at it), or press **v**; **Shift+V** or Shift-click picks a run. A bar at the bottom can **Complete**, **Reopen**, **Reassign**, **Move to project**, change the **Due date** (+1 day, +1 week, a date, none) or **Delete** them, up to 100 at a time. **Esc** clears.
- **Nothing is skipped silently.** Complete never touches a task that's in review or waiting on a client. The bar says *N skipped*; click it to see why and open each one.
- **Undo.** After a change (one task or many, including a plain tick, a delete or a reassign in a task's details), the message has **Undo** for 10 seconds, or press **Ctrl+Z** (**⌘Z**). An assignment email that hasn't gone out yet is cancelled.
- A launch notice and tour come with it; rerun it from **?** → **New: Select many tasks, with Undo tour**. See [How do I change many tasks at once, and undo a change?](#/help/select-many-tasks).

### 2026-10-16: Clear several Ledger review flags at once

- On **Ledger review**, tick the box on each open or asked flag (or **Select all**) and press **Clear N selected**. One reason and note go on all of them. The selection resets when you change tab, check chip or month.

### 2026-10-16: Reply and Open file in the Workbench without leaving the page (the Workbench is still off until the owner turns it on)

- **Reply** on a client message opens the Messages chat drawer on top of the Workbench, on that person's thread. **Esc** closes it and puts you back on the row. The Workbench keeps its filter, tab and scroll.
- **Open file** on a new client file opens or downloads it in a new tab (a PDF or image shows, a spreadsheet or Word file downloads); the Workbench stays open. **Mark checked** is still in the **⋯** menu.
- **Open full page** is now in the **⋯** menu of messages and files for the old behavior.
- See [How do I use the Workbench?](#/help/workbench).

### 2026-10-16: Close steps can be tasks (one client at a time)

- **Create month-end tasks from the Close checklist**, a switch under **Tasks › Recurring › One client**, makes bank feed, bank rec, card rec, entries and review into tasks each month for that client. It's off for every client; admins and the client's account manager turn it on, starting next month unless they tick **Also this month**. It works while the standard close set is still off.
- **The step and its task stay in step.** On the Close tab a linked step shows who has the task and its status; ticking it moves the task, and finishing the task ticks it. A task that needs approval shows **In review** until approved. A message says why when nothing can change (*Waiting on the client*, *Ask an admin to reopen*).
- **Looks done.** When QuickBooks shows bank feed or bank rec is done for the month, the step and the task show **Mark done**. Nothing ticks by itself.
- **Duplicates warning** when the client already has recurring templates that look like month-end work.
- A launch notice and tour come with it; rerun it from **?** → **New: Close steps can be tasks tour**. See [How do Close checklist steps become tasks?](#/help/close-checklist-tasks).

### 2026-10-16: My tasks tab in the Workbench (the Workbench is still off until the owner turns it on)

- **A second tab, My tasks**, lists every open task assigned to you in groups: **Overdue**, **Today**, **This week**, **Later**, **Waiting on client**. Click a row to open it in the task drawer on top; tick the circle to finish it from the list; **+ Add task** is at the bottom.
- The panel remembers your filter and open tab for you only, so a shared computer starts clean for the next person, and it won't reopen on a different page or a link that points at one item.
- See [How do I use the Workbench?](#/help/workbench).

### 2026-10-16: Quick add understands plain words

- **Type the task the way you'd say it.** *Send the payroll summary for Sierra re Example Church by Friday* picks the person, the client and the due date. Also *for me*, *assign to Sierra*, **@me**, *tomorrow*, *next week*, *due the 15th* and *end of month*.
- **A Will add line** under the box shows what it understood before you press Enter, as chips you can remove. **×** on a plain-words chip puts those words back in the title.
- **Never a silent guess.** A name it doesn't know stays in the title. If it could be two people, a client and a person, or two clients, a **Did you mean** line offers each choice as a button, with **Neither**.
- The symbols (**@name**, **#client**, **!high**) still work. The small add box on a project or client list reads only those symbols and dates.
- A launch notice and tour come with it; rerun it from **?** → **New: Quick add understands plain words tour**. See [How do I add a task, note or document request, or message a client?](#/help/quick-actions).

### 2026-10-16: The Workbench (off until the owner turns it on)

- **Today becomes one list of everything that needs you**: tasks, reviews, client messages with no reply, Ledger flags, new client files and the rest of Today's rows, grouped **Overdue**, **Today** and **This week**. Tiles at the top count **Needs reply**, **Due today**, **Overdue** and **Reviews**; chips filter by source. See [How do I use the Workbench?](#/help/workbench).
- **One button per row** does the next thing (**Reply**, **Start**, **Open**, **Review**, **File**). The **⋯** menu has **Snooze**, **No reply needed** for a message and **Mark checked** for a client file, each with **Undo**.
- **A drawer on every staff page**: a bar across the bottom of the page shows your count, the next item and **Press D**. Click it or press **D**; **Esc** closes it.
- **Open a task without leaving the page**: **Open** on a task or review in the drawer opens the task drawer on top, and the page behind it does not change. **Esc** closes one layer at a time (menu, task drawer, then the Workbench), and closing the task drawer puts you back on the row. The panel remembers your filter and scroll, and reopens where you left it if you reload within a few minutes.
- **No reply needed** is also in the Inbox thread header. See [How do I message a client or a teammate?](#/help/inbox).
- **Prefer the old Today?** **?** on the Workbench → **Use classic Today in this browser**; Today then offers the way back.
- **Admins** get **Mine** or **Everyone**. Dev Tools has **Workbench preview** and **Classic Today** (your browser only), and **Tasks switches** shows `wb_enabled`.
- It stays off for everyone until the owner turns it on. A launch notice and tour come with it; rerun it from **?** → **New: The Workbench tour**.

### 2026-10-16: Subtasks open in place, and project colors

- **Subtasks open under their task.** A task with subtasks shows a small arrow and a count such as **2/5** (done out of total). Click the row, or the arrow, to open them underneath; click again to close. The arrow keys also work: right opens, left closes. Tick a subtask right there, or click its name to open its details. Click the task's own name to open its details. The portal remembers what you left open on this browser. See [How do I add and manage my tasks?](#/help/my-tasks).
- **It works everywhere tasks are listed:** My Tasks, client and project lists, a person's list and the task panel on a client page. A done subtask still shows under an open task. A subtask whose task is in a different group keeps its own row there as well. Review, Waiting on client and search results are not nested yet.
- **Every project has a color.** A color dot sits beside the project name in the Tasks sidebar, in its list header and on each task's project chip. New projects pick a color on their own. Owners and admins change it from **Project options → Change color**; admins can also use the **Color** button in **Manage projects**. A trashed project keeps its color and can't be recolored until it is restored. See [How do client task lists and projects work?](#/help/task-lists-and-projects) and [How do I rename, archive or trash a project?](#/help/manage-projects).
- The **Tasks tour** gains a **Subtasks open in place** stop.

### 2026-10-16: Group tasks by client, and manage projects

- **Group by Client.** My Tasks has a **Sort by** switch: **Due date** or **Client**. Clients are listed A to Z, then **No client**, then test and internal clients. Admins get the same switch on a person's list under **People** (**Default** or **Client**). The portal remembers your choice. See [How do I add and manage my tasks?](#/help/my-tasks).
- **Admins: Manage projects.** Under **Projects** in the Tasks sidebar, **Manage projects** lists every project (active, archived and in the trash) with its owner and task counts. Rename, archive, unarchive, move to trash or restore. See [How do I rename, archive or trash a project?](#/help/manage-projects).
- **Move to trash** hides a project and its tasks from every list, My Tasks, Waiting on client, counts, digests and performance. Nothing is deleted; **Restore** brings back exactly what the trash hid. It's refused while a task is waiting on a client request. Project owners can trash their own project from **Project options**; only an admin can restore it.
- The **Admin tour** now stops at **Tasks › Manage projects**.
- **Move to trash by a project owner.** The confirm now says how many tasks go with the project and how many belong to other people, and the message afterwards has an **Undo** button. A restore blocked by a name another project is using now says *Rename or archive the active project with this name first.*

### 2026-10-16: Your Asana tasks are in Tasks

- **Open Asana tasks were copied into Tasks once, on Oct 16**, each on the person it was assigned to and on its client where we could match one. Open one and its details say **Imported from Asana** with a link to the original. Asana itself was not changed. See [How do I add and manage my tasks?](#/help/my-tasks).
- **Tasks with no assignee in Asana** show as **Unassigned** on My Tasks for anyone on the client to **Claim**.
- **Not brought over:** anything added or changed in Asana after Oct 16. Repeating Asana tasks came over as **draft** recurring templates that stay switched off until an admin reviews them, so nothing new is made from them yet. No emails were sent.
- **Admins:** clients that came over without a bookkeeper are under **No team yet** in the Tasks sidebar; use **Assign team** on each. The **Admin tour** now also stops at **Tasks › Review**, and the **Tasks tour** at **Review**.
- **? → Help for this page** on Tasks now opens the article for the list you're on (Review, Waiting on client, Recurring, a client list or a project).

### 2026-10-16: Unassigned tasks and Claim

- **Some tasks have nobody on them yet**, mostly ones coming over from Asana. They show **Unassigned** where the name would be.
- **My Tasks has an Unassigned group** with the open ones on clients you can see. Click **Claim** to take one; it moves into your groups. Admins see only their own clients' ones there. Lists have an **Unassigned** option in the person filter. See [How do I add and manage my tasks?](#/help/my-tasks).
- **Recurring templates** can now go to **a named person**, or **Leave unassigned (anyone on the client can claim it)**, under **Assign to**. Templates from Asana have a **From Asana** tag. See [How do recurring tasks from templates work?](#/help/task-templates).
- **Admins:** **No team yet** in the Tasks sidebar lists imported clients with no bookkeeper; **Assign team** on the client's list gives them one, and they own its unassigned tasks (which anyone on the team can still claim). No email is sent. See [How do client task lists and projects work?](#/help/task-lists-and-projects).
- **Unassigned tasks count for nobody** until someone claims them: not anyone's overdue, performance score or weekly digest. Time off hand-off only moves tasks assigned to the person who is out.

### 2026-10-16: Ask client emails switch on the Emails page

- **Admins:** the **Client emails** card on **Settings › Firm settings › Emails** now has **Ask client emails live**. Only the owner can turn it on; everyone else sees **Owner only**. Off means Ask client emails and reminders to real clients are a dry run. On sends them only to real clients in the pilot list, which shows under the row. Turning it on asks to confirm who will be emailed. Test clients still get one **[Test]** copy sent to you only. See [How do I manage client emails?](#/help/client-emails).

### 2026-10-16: Profile photos for the whole team

- **Everyone adds one.** The first time you sign in, a full-page **Add your profile photo** screen asks for a clear picture of your face and shoulders. Upload one or take one, crop it to the circle and you're done. It shows in the top bar, team lists, what clients see next to your name and your email signature. See [How do I add or change my profile photo?](#/help/profile-photo).
- **Change, not remove.** In **Settings › Profile** the photo button is now **Change photo**. There is no remove button, and your photo can be up to 15 MB now.
- **Admins tidy the background.** **Team › Members** has a **Photo** column and **Today** shows **N profile photos to edit**. Download a photo, remove the background, then **Replace with edited photo**. You can also restore the original, see the history, mark someone **Not required** and **Download all (zip)**. See [How do I manage staff profile photos?](#/help/staff-photos).
- Photo changes show in the Audit log under **Profile photos**.

### 2026-10-16: Time off hands tasks to backups

- **Your tasks are covered while you're out.** Click **Hand my tasks to backups** before you go and open tasks due while you're away go to each client's **backup bookkeeper**, then come back to you after your last day. (An automatic hand-off on the first day off is off unless an admin turns it on.) **Ready for review**, private and MGB (internal) tasks stay with you.
- **Hand my tasks to backups.** **Team › People › My time off** has the button: a preview of what goes to whom and what stays, then **Hand off {n} tasks**. **Hand back now** ends it early; cancelling, shortening or moving the time off later brings tasks back too. Clicking it again re-sends anything that came back.
- **Backups see it.** The task drawer says **Covering for {name} until {date}**, **Today** says **Covering for {name}**, and the task's Activity shows the hand-off and the hand-back.
- **Admins** get **Hand off tasks** on each person's time off, with a cover pick for clients with no backup and access given for the time off.
- **One summary email per person**, staff only, following the **Task summaries** setting. Nothing goes to clients. See [What happens to my tasks while I'm out?](#/help/out-of-office-handoff).

### 2026-10-16: Clients answer your requests themselves

- **In the portal.** A client's **Messages › Requests** is now **What we need from you**: every question, document or approval you asked for, from **Ask client** or the Documents tab. They type an answer, attach files and click **Send**, and Home says *Your bookkeeper is waiting on {n} items from you*. Their **?** menu has **What we need from you** too.
- **By link, with no login.** A client contact (a treasurer, a pastor) gets a link that opens just that one request. It works for 14 days and one answer. See [How do I add a client contact who answers by link?](#/help/client-contacts).
- **Stop reminders** in a reminder email pauses every open request for that client that lists the person, not just one.
- **Client contacts** have their own section in each client's tasks drawer: add, edit, remove, and untick **Can answer requests by email link** to stop their links.
- **When they answer**, the request leaves **Waiting on client** and the task comes back with their reply and files.
- **Emails still wait for the owner's switch.** Until then **Email again** and **Send reminder** are a dry run, and a test client gets one **[Test]** copy sent to you only. See [How do I ask a client something from a task?](#/help/ask-client).

### 2026-10-16: Ask client from a task

- **Ask the client from the task you're working on.** On a client task, **Client requests** → **Ask client** asks a question, for a document or for an approval. Pick the client's portal users or its contacts (add a treasurer or pastor without a portal sign-in with **+ Add contact**). The task moves to **Waiting on client** and stays there until they answer or you cancel.
- **Follow up from the request.** **Email again**, **Send reminder**, **Pause reminders**, **Turn off links**, **Record answer** (for a phone or email reply) and **Cancel**. When they answer, **Accept** it or **Ask again**. After four reminders the request says **No reply**.
- **Tasks › Waiting on client** (`#/tasks/waiting`) lists every open request, grouped by client, longest wait first.
- **Nothing is emailed yet.** Client emails for requests are a dry run until the owner switches them on; the toast says who it would have gone to. See [How do I ask a client something from a task?](#/help/ask-client).

### 2026-10-15: Recurring tasks in Tasks › Recurring

- **Templates moved to Tasks › Recurring.** The old **Task templates** page in Settings now takes you there. Due dates can be a business day, the last business day, a day or weekday of the month, a day of the week (weekly) or days after the period. Annual templates can follow each client's fiscal year.
- **New templates start as drafts.** Nothing is made until an admin clicks **Turn on**, and then only for periods from now on. **Preview** shows what a template would make before it's on. **Pause**, **Resume** and **Retire** are on each row.
- **Tasks from a template show a Recurring tag**, end with the period ("· Sep 2026"), and don't send an assignment email. You get each one once per client per period.
- **Anyone can open One client** to skip a template for that client, change it for that client, or preview the next 60 days.
- **Missed periods** (admins): a period more than 7 days late when a template first reaches it is listed, not made. **Make task** or **Dismiss**.
- **The standard close set** comes as drafts and only reaches test clients until the owner switches it live. See [How do recurring tasks from templates work?](#/help/task-templates).

### 2026-10-15: Task review with a named reviewer, and on-time

- **Review in the Tasks sidebar** lists work waiting for an admin's approval, oldest first. Admins see a count of what they can approve and, below the list, each person's **on time** rate, approvals, first passes and send-backs for the last 30 days.
- **Nobody approves their own work.** Admins' own tasks with a review step go to review too, and the reviewer is the client's reviewer, its account manager if they're an admin, or for an admin's own work the Team Reviews default reviewer. Otherwise any admin can approve.
- **Send back needs a short note**, which is added to the task's comments. The person who did the work can **Take back** a task from review, and can't reassign it while it waits.
- **On time** means finished (or approved) by the end of the original due date, with client-wait time added. See [How does task review work?](#/help/task-review).

### 2026-10-15: Admins sign off each month

- **Bookkeepers mark a month Ready for sign-off; an admin signs it off.** The **Review** status is now **Ready for sign-off**, and only an admin can make a month **Done** (**Sign off {Month}** on the Close tab, **Done (sign off)** on Work › Close). Signing off sends the "reports are ready" email, at most once a week per person for the same month.
- **Reopening needs a reason (admins).** It's kept with the month. Bookkeepers can't reopen a signed-off month.
- **Open tasks for the month warn, they don't block** the sign-off.
- **On-time counts from Ready.** Your on-time score uses when you marked the month ready, not when it was signed off. See [Who signs off a month, quarter or year?](#/help/period-sign-off).

### 2026-10-15: A short notice and tour for every new launch

- **When we launch something, you get one quiet notice the next time you visit.** It sits at the top of the page, says what's new in a sentence, and offers **Take the 1-minute tour**, **Later** and **Skip**. It never covers the page, never appears while another tour is running, while you finish your profile on **Today**, or during **View as** and **Preview as**, and you only ever see one at a time.
- **Later** brings it back on your next visit (the third **Later** counts as **Skip**). **Skip** puts it away. Finishing or skipping the tour counts as done. A launch is only offered if it came out on or after the day your account was made, and it stops appearing about two months after it shipped.
- **Take any tour again.** Each launch stays in the **Launches** list above and in **?** → **New: … tour** (also in **⌘K** and **Settings › Help**).
- **Admins** can see who has toured, seen or skipped each launch in **Settings › Firm settings › Usage stats** (the **Announcements** card). See [Usage stats and Developer tools](#/help/admin-insight).

### 2026-10-15: Reviewers hear when a self-review is in

- **Your reviewer gets an email when you submit your self-review.** It says who submitted and for which quarter, that their own review is still open, and links to their form. It never includes your scores or answers. It's sent once per review, so re-submitting after an admin reopens your form doesn't send it again, and it's skipped if they've already submitted (the comparison email covers that). See [How do quarterly reviews work?](#/help/quarterly-reviews).

### 2026-10-15: New staff can sign in straight away

- **Adding someone now sets up their sign-in too (admins).** New sign-ups are switched off for the portal on purpose, which meant a newly added bookkeeper could be turned away by Google. **+ Add**, **Bulk import** and reactivating someone on **Team → Members** now also make their sign-in account. If that step fails you'll see "sign-in setup failed — use Fix sign-in", and the person stays on the list. Their first sign-in must be with Google; after that the installed app's emailed code works too.
- **Fix sign-in (admins).** If any active staff member can't sign in yet, a **Can't sign in yet** card at the top of **Team → Members** lists them (their rows get a red **Can't sign in** tag). One click fixes it. See [How do I add staff and manage their access?](#/help/staff-management).

### 2026-10-15: Client list failed to load

- **Clear message instead of blank pages.** If the client list can't load, client pages now say so and offer **Reload**; Today, Team and Settings still open.

### 2026-10-15: First sign-in fix and error codes

- **New bookkeepers with no clients yet no longer hit "Something went wrong."** They now land on the normal "no clients assigned yet" screen, with **Go to Team** and the temporary-access request button.
- **Error screen shows a code.** If a page ever does crash, the screen shows an **Error code** and a **Copy details** button (message, version and page only, no sign-in data). Send the code to an admin; the crash is also logged to Developer tools → Recent errors.

### 2026-10-15: Staff roster split into Admins and Bookkeepers

- **Two cards instead of one list.** **Team → Members** now shows **Admins** and **Bookkeepers** as separate cards with a headcount each. Same columns and buttons as before. Deactivated people sit dimmed at the bottom of their card, and a bookkeeper with temporary admin access shows a **Temp admin** tag. See [How do I add staff and manage their access?](#/help/staff-management).

### 2026-10-15: Sign-in failures show a Reason

- **A failed staff sign-in now shows a Reason line**, the time it started and your browser, so an admin can see what went wrong. It says whether Google returned an error or nothing came back at all. Screenshot it for an admin. See [How do I sign in?](#/help/signing-in).

### 2026-10-15: A staff sign-in page of its own

- **app.mygoodbooks.org/staff** is the staff sign-in page. Bookmark it: one **Sign in with Google** button, no client email form. A sign-in that fails comes back to it with what to try. The old small link on the client page still works and takes you there. See [How do I sign in?](#/help/signing-in).

### 2026-10-15: A failed staff sign-in now says why

- **No more silent bounce to the client page.** If **MyGoodBooks staff? Sign in with Google** comes back without signing you in (wrong Google account, an error from Google, or a browser that blocked cookies), the sign-in page now shows what to try, and the address you used when it knows it. See [How do I sign in?](#/help/signing-in).

### 2026-10-15: MGB (internal), and test clients tucked away

- **MGB (internal)** is MyGoodBooks' own books, set up like a client. It has its own place in the left rail, open to every admin by default; the owner can switch it off per person. Temp admins, bookkeepers, account managers and clients never see it, and **View as** hides it. The owner switches it off per admin in **Team → Members**. Emails about its tasks go to one address the owner sets, not to the people on the task. See [What is MGB (internal), and who can open it?](#/help/mgb-internal).
- **Test clients and MGB (internal) no longer count as clients.** They're left out of client totals, deadline and close counts, alerts, performance, workload, fees and revenue.
- **A Test tag, and test clients at the bottom of every list.** Basic Test Client and Pro Test Client keep their names but sort last everywhere you pick a client, with a small **Test** tag.
- **Show test clients** (off by default) at the top of the Clients page and the bottom of the client picker brings them back to the lists. It's remembered for you. It applies to everyone, even if you're assigned to a test client. See [Try things on the test clients first](#/help/preview-as).

### 2026-10-15: Go further back on Ledger review

- **The list now matches the range.** Ledger review only shows transactions inside the range of the pull on screen, with a line saying which months. Older flags stay saved; tick **Show older unresolved flags** on that line to see them, or pull further back.

- **Choose how far back one pull goes.** On a client's Ledger review tab, **Go back to** (next to **Pull from QuickBooks**) lists the last 24 months. Pick one to include older transactions in that pull only; your saved setting doesn't change. The line beside the button shows the months the last pull covered, and **Review month** is the month you're checking. See [How does Ledger review work?](#/help/ledger-review).

### 2026-10-14: QuickBooks connects the right way for each client

- **Test clients connect to a QuickBooks sandbox (test) company; real clients and the firm's own QuickBooks connect to the real thing.** The old "Sandbox mode only" banner on Manage Access › QuickBooks is gone. Test clients now say so on that tab.
- **Clearer connect errors.** If connecting fails, you see a plain message, and the page after Intuit shows an **Error id** to give an admin. A connection that ended in an error can just be connected again. See [How do I connect a client's QuickBooks and use Sync now?](#/help/quickbooks-connection).

### 2026-10-14: Ledger review

- **A new Ledger review tab on every client**, right after Close. Pull the month's General Ledger from QuickBooks and it flags what needs a look: uncategorized and suspense, opening balance equity, duplicates, check gaps, odd amounts and accounts not reconciled. **Clear** a flag with a reason, **Stop flagging this** for a known pattern, or **Ask client** by portal or email.
- **A reconciliation panel, a month-vs-year view and a summary for the client** you can edit and send by portal or email. Nothing sends by itself.
- **A seventh close step, Ledger reviewed**, for clients with QuickBooks connected. **Mark reviewed** ticks it and an admin **Approves** or **Sends back**. Marking a month done before approval only asks first (*Mark done anyway?*); an admin can switch that to a block.
- **Review a file** (Work › Ledger review) checks any exported General Ledger in your browser, nothing saved. Admins set the rules in Team › Ledger review.
- **Two new fields under Edit dates and coverage on the Overview**: Greeting name and Contact email, used by the summary and by Ask client by email.

See [How does Ledger review work?](#/help/ledger-review).

### 2026-10-14: Who can approve a budget; deleted notes are kept

- **A Pro client's budget can be approved by a MyGoodBooks admin or by the organization's own full-access contacts.** Bookkeepers and limited-access contacts can still submit it or send it back with requested changes, but they see "Only a MyGoodBooks admin or the organization's full-access contact can approve a budget." where the **Approve** button was. Once a budget is approved, only those same people can change or reopen it.
- **"Submitted by", "Approved by" and the Close tab's tick names come from the signed-in account**, so they always show the real person.
- **Deleted notes are kept.** Deleting an internal note, a budget comment or a budget (variance) note hides it everywhere in the app, but the note stays on file with who deleted it and when. You can delete your own; admins can delete anyone's. Only the person who wrote a budget (variance) note, or an admin, can change its text.

### 2026-10-14: Pro QuickBooks sync is now hourly

- **Pro clients now sync from QuickBooks every hour instead of every 15 minutes.** The sync pill reads **Every hour · synced 5m ago**. Changes made in QuickBooks can take up to an hour to show; **Sync now** still pulls them straight away, any time. When the firm is near its Intuit limit, Pro slows to every 2 hours instead of every 30 minutes.
- **The wording is updated everywhere it appeared**, including the plan cards, the tours and the pricing page.

### 2026-10-14: Note and comment names are checked

- **The name on internal notes, budget comments, budget notes and budget history now comes from the writer's account**, the same way client messages already do: your Team name, or the client's name on their portal access. The app can't be used to put a different name on them. Nothing changes in how you write them.
- **Client contacts' names and emails are locked to admins.** The Client roster never offered editing them, so nothing changes day to day. If one is wrong, remove the contact and add them again. Any name or email change now shows in the client's activity log.

### 2026-10-14: Staff Handbook admin tools

- **Publish a new policy version (admins).** Open a policy and click **Publish new version**. Edit the text with a live preview, add a change note, and choose **Needs re-signing** (each bookkeeper gets one email, a Today row and 7 days to sign) or **Minor edit** (nobody is emailed). See [How do I sign the Staff Handbook?](#/help/staff-handbook).
- **Signatures by bookkeeper (admins).** The Handbook tab now ends with a grid: policies down the side, bookkeepers across the top, and each person's state with its date, including **Overdue**.
- **Retry filing (admins).** If a countersigned copy doesn't reach the Staff Reviews drive, it shows under **Not filed to Drive yet** with a **Retry filing** button.
- **No double signing after a minor edit.** If you already signed, a later minor edit doesn't ask you to sign again.

### 2026-10-14: Message names are checked

- **The name on a client message now comes from the sender's account.** MyGoodBooks fills it in from your Team name, or from the client's name on their portal access. The app can't be used to type in a different name, and the "new client message" email uses the same name. Nothing changes in how you send.

### 2026-10-14: Month-end Balance Sheet from QuickBooks

- **Balance Sheet as of last month's end.** On a client with QuickBooks connected, the Balance Sheet card on **Reports** has a second button, **Balance Sheet as of {last day of last month} (QuickBooks)**. It pulls that day's Balance Sheet straight from QuickBooks (read-only) and downloads a PDF that says so. Each press is one QuickBooks call. Mark sent only appears after the month-end PDF has downloaded.
- **It counts as Reports sent.** Its own **Mark sent to client** ticks **Reports sent to the client** for the month being closed. The plain **Download PDF** is still as of today and is only logged. See [What's on a client's Close tab?](#/help/client-close).

### 2026-10-14: Client tabs polish

- **Balance Sheet and Reports sent.** A Balance Sheet counts as **Reports sent to the client** for last month when its as-of date is last month's last day. A Balance Sheet as of any other day is only logged. See [What's on a client's Close tab?](#/help/client-close).
- **A fade shows when the tab row scrolls.** When a client's tabs don't all fit (a narrow window), the edge with more tabs behind it fades out.
- **Bank: open questions Bank isn't showing** now sit right under the Transactions card, not at the bottom of the page.
- **Client setup (staff) has no empty gap** at the top any more.

### 2026-10-14: Get the app (computers)

- **Install MyGoodBooks on your computer.** Sign in with Chrome or Edge, then click the install icon at the right end of the address bar. It opens in its own window. Phones and tablets just use the website. See [How do I install MyGoodBooks as an app?](#/help/get-the-app).
- A new tip on **Today** mentions it for your first 30 days.

### 2026-10-13: Staff Handbook

- **Team › Handbook** is new. It holds the firm's staff policies, starting with **Flexible Work, Scheduling & Operational SLA Policy**. Everyone can read them.
- **Bookkeepers sign in the portal.** Read to the end, tick the agreement, type your name and click **Sign**. A **Sign** row on **Today** and a number on the tab show what's waiting. See [How do I sign the Staff Handbook?](#/help/staff-handbook).
- **The Account Manager countersigns** from a **Countersign** row on Today. The signed PDF is then saved to the admin-only Staff Reviews drive, and you can download your copy from the policy.
- A new email setting, **Staff Handbook signatures**, is under **Settings › Notifications** (on to start with).

### 2026-10-13: Reviews: last quarter, live view for admins

- **Reviews cover the quarter that just ended.** Opening a cycle in October starts on Q3, and the due date starts at the end of the next month. The current cycle is now **Q3 2026**. See [How do I run a review cycle?](#/help/review-cycles).
- **Admins can follow a review as it happens.** Click **Open** on **Reviews → Team status** to see both forms' scores and comments so far, drafts included. The person and their reviewer (usually Jesse) still can't see each other's side until both are submitted. See [How do quarterly reviews work?](#/help/quarterly-reviews).
- **No clients yet? Team still opens.** Staff with no clients assigned can now open Today, Inbox, Team (reviews, survey, onboarding), Settings and Help. Only client pages wait for an assignment, and that screen has a **Go to Team** button.
- **Finish the survey later.** Survey answers now save as a draft on your device as you type, so you can leave and come back. The review form already saved drafts. See [How does the team survey work?](#/help/team-survey).

### 2026-10-14: Your name, changed everywhere

- **Settings › Profile › Name** now changes your name across the whole portal: the top bar, team lists and pickers, Team pages, client cards and new messages and notes. It saves when you click out of the field or press **Enter**. Before, most of the portal kept showing your old name. See [How do I change my settings?](#/help/staff-settings).
- **For admins**: on the QuickBooks mapping page, people now auto-match to staff by email only, not by name. Map anyone whose QuickBooks email isn't their sign-in email by hand.

### 2026-10-11: A client's tasks, one key away

- **Up next**: on a client's tabs, a line under the tabs shows how many tasks are open and overdue and the next one. Tick it off or click it for details.
- **The client task panel**: press **t** (or click **All tasks**, or **Tasks** in the top bar with a client open) for every open task for the client, grouped by when it's due, with an add box. It stays open while you move between tabs. See [How do I see a client's tasks without leaving the page?](#/help/client-tasks-drawer).
- **For this page**: the panel puts tasks that fit the tab you're on at the top, such as reconcile tasks on Bank.
- **Follow my client**: the Tasks window can follow the client you open in the portal. See [Can I keep Tasks in its own window?](#/help/tasks-own-window).

### 2026-10-11: Tasks, rebuilt

- **My Tasks**: one list of everything assigned to you, grouped as Overdue, Today, This week, Later, Waiting on client and Done. Open it from the **Tasks** button in the top bar or **Work › Tasks**. A task you assign to someone shows on *their* list, and you follow it. See [How do I add and manage my tasks?](#/help/my-tasks).
- **Add a task from anywhere**: press **q** on any staff page (not while typing), or **+** → **New task**, with or without a client open. Type one line such as `Reconcile operating account #example-church @name fri !high` and the client, person, date and priority are picked out.
- **Task details**: click any task for its status, dates, priority, subtasks, checklist, files, comments and history. Five statuses: To do, In progress, Waiting on client, Ready for review and Done. On a task that needs review, Done goes to **Ready for review** and any admin approves it or sends it back. See [What's in a task's details?](#/help/task-details).
- **@mentions**: type **@** in a comment to bring a teammate in. They get **mentioned you** in the bell (no email yet) and follow the task. Turn it off under **Settings › Notifications** with **Mentions on tasks**.
- **Client lists and projects**: the Tasks page has a list for each of your clients and shared projects. **SOPs** and **90 Day** are open to all staff to start with; an admin can switch **Open to all staff** off. **Directors** and **Owners** are for admins. See [How do client task lists and projects work?](#/help/task-lists-and-projects).
- **Deletes are hidden, not erased**: a deleted task keeps its comments, checklist and history, and its owner or an admin can **Restore** it.
- **Its own window**: **Open in own window** puts Tasks in a slim window beside QuickBooks, and **Dock in portal** brings it back. The `/tasks` address opens the slim view too. Today is still home. See [Can I keep Tasks in its own window?](#/help/tasks-own-window).
- **Search** (**Ctrl+K** / **⌘K**) now finds words in task descriptions and comments, and the keys **j**, **k**, **Enter**, **x**, **s**, **a** and **?** work on task lists.
- **Notes & SOPs** moved to their own tab, **Work › Notes & SOPs**, and work as before. The old **By client** view is gone; client lists replace it.
- A short **Tasks tour** is in the **?** menu, ⌘K and **Settings › Help**. It never starts by itself.

### 2026-10-10: One tab row for every client

- Every client has the same tabs in the same place: Overview, Messages, Documents, Bank, Close, Reports and SOP. Admins also see Milestone.
- **Close** is new: the month's steps, the QuickBooks check, what was sent and the month's status in one place. Your first tick sets In progress. Done is always your click, and it emails the client that reports are ready. See [What's on a client's Close tab?](#/help/client-close).
- The client's own pages are under **Client view**, with **View as client…** at the bottom. The gear is now **Client setup**. On a laptop under about 1280 pixels wide, both sit in the page header so every tab fits.
- Staff see **Bank** on Basic clients too, and Sync now has no limit for staff. Links from the Overview, Close, Today and the bell open the exact item. On the Inbox, a bell message opens that thread right there.
- Coming back to a client goes to the tab you left. The Overview shows only bookkeeping work; billing is in Billing and time for admins. Organization type is now in Key dates and coverage.

### 2026-10-09: Board packet is the one report builder

- **One builder**: a Pro client's **Reports › Board packet** is now the only place they build reports. The old Report Builder, with its Quick Download grid and Custom Report, is gone. **Downloads** keeps the canned statement PDFs (Profit & Loss, Balance Sheet, Budget vs. Actual, Contribution Statement, plus Payroll, year to date, with the payroll add-on).
- **Presentation view**: a new button on the packet shows it full screen for a board meeting, with large type, the organization and period on top, then the sections they ticked. **Esc** or **Exit presentation** closes it.
- Staff see a Pro client's Reports as one page: the Downloads grid, then **Board reports** below it. Basic clients still see the locked card on Board packet.
- The Pro tour's report step is now called **Board Packet**, and the public pricing chart and landing page say **Board Packet** too. See [What does the client portal look like?](#/help/client-portal).

### 2026-10-09: a ? menu for clients

- **?** in the client's top bar, next to the bell: **Take the tour**, **Take the Pro tour** (Basic clients only), **Message your bookkeeper**, **Help and settings** and **Contact support**. It's the quickest way for a client to restart the tour or ask for help from any page.
- The client tour's last step now points at the **?** instead of **Settings › Help**. On a phone the QuickBooks sync pill shortens to "Synced 5 minutes ago" (or **Setting up** before QuickBooks is connected) so everything fits.
- Admins can see how often it's used in **Settings › Firm settings › Usage stats › Actions** as **Client ? menu clicks**. See [How does the client guided tour work?](#/help/client-tour).

### 2026-10-09: Tips while you learn

- **Tips**: for your first 30 days, a small card now and then points out one useful thing on the page you're on, with a thin outline around it. Nothing dims or blocks the page. Click **Got it** to dismiss it or **Learn more** for the full article. Only one shows at a time, each shows once, never during a tour, and at most one every couple of minutes.
- Everyone on the team gets 30 days starting the first time they open the portal after this change; new staff get 30 days from their first sign-in. Bookkeepers, admins and account managers see a few tips for their own pages too.
- Turn tips off, or back on for another 30 days, from **?** → **Tips while you learn**, **Settings › Help**, or the top of the Staff guide. Turning them back on shows every tip again. See [How do tips work?](#/help/tips).

### 2026-10-09: Pro tour for Basic clients

- **Pro tour**: a two-minute walkthrough on a Basic client's **Settings › Plan** page that shows what Pro would add: live QuickBooks sync every hour with **Sync now**, the Board-ready Financial Overview, Board Packet (called Report Builder at the time), Budgeting Tool, Cash Flow Pro, Reconciliation Pro and Fund Accounting Pro, the tool-by-tool comparison, Payroll (if they don't have it) and **Upgrade to Pro**. It never starts on its own and never clicks anything: an upgrade is still a request to the bookkeeper, which shows on **Today**.
- Clients start it from **Take the Pro tour** on the Plan page, from the locked card on their Home, or from **Settings › Help**. The client tour's Plan stop points to it on Basic.
- To see it, use **Preview as** on a Basic client's person, then **Settings › Plan › Take the Pro tour**. See [How does the Pro tour work?](#/help/pro-tour).
- **Client tour**: the Sync stop now shows for anyone at a Pro organization synced from QuickBooks, even with their Pro pages turned off. See [How does the client guided tour work?](#/help/client-tour).

### 2026-10-09: bookkeeper, temporary admin and client tour versions

- **Bookkeeper tour** replaces the old staff tour. It's a three-minute walk through a bookkeeper's day: Today, your clients and a client's Overview, the **+** button, the Inbox, Work (Tasks and Close), Team (People, Reviews) and search. It starts by itself once for bookkeepers, including anyone who did the old tour, and admins can run it from **?**. See [Bookkeeper guide](#/help/bookkeeper-guide).
- **Temporary admin tour**: when an admin gives you temporary admin access, a one-minute tour shows the pages that just opened (Team › Hours, Reply times, Feedback, Members and Settings › Firm settings) and says when your access ends. It starts again for each new grant. See [Temporary access](#/help/temporary-access).
- **Admin tour**: a new admin now gets the basics (the five places, search and help) first, then the admin pages.
- **Client tour versions**: clients no longer all get the same tour. It follows their plan (Pro or Basic), their access level (full, limited, or budget-only) and add-ons such as Payroll, and it skips anything they can't see. **Invite a teammate** on the setup checklist now shows only for people who can open **Organization**. See [How does the client guided tour work?](#/help/client-tour).
- To see a client's version, use **Preview as** and pick that person, then **Settings** > **Help** > **Preview the tour**.

### 2026-10-09: admin and account manager tours

- **Admin tour**: a two-minute walk through the pages only admins see (Team › Members, Hours, Reply times, Performance, Reviews, Feedback and Inventory, then Firm settings and Today). See [Admin guide](#/help/admin-guide).
- **Account manager tour**, for anyone who is a client's account manager: bookkeeper reviews, client messages, new clients, client health and plans. See [Account manager guide](#/help/account-manager-guide).
- Each starts by itself once, one tour per sign-in: admins get the Admin tour first, and the Account manager tour comes after your other pending tours (Temporary admin, Bookkeeper or Admin). Both run again from **?**, **Ctrl+K** / **⌘K** or **Settings › Help**.
- Dropdowns and date pickers everywhere now match the light and dark themes instead of showing the browser's gray box.

### 2026-10-08: Team › Inventory

- **Team › Inventory** replaces the Tech Inventory spreadsheet. Everyone gets **My inventory** (request hardware, log what you have) and **Standard setup**. A new request emails admin@mygoodbooks.org.
- Admins also get **Requests**, **Items**, a **Roster** of who's missing what, the staff **Directory** and **Export to Google Sheet**. Nothing is deleted; rows are archived. See [How do I request equipment or log what I have?](#/help/tech-inventory).

### 2026-10-08: a simpler client portal

- Clients now see five places: **Home**, **Messages**, **Finances**, **Reports** and **Documents**, with **Settings** at the bottom. See [What does the client portal look like?](#/help/client-portal).
- **Home** opens with what needs them, beside a card with their milestone, plan and **See plans**. The milestone moved there from the top of the sidebar.
- **Finances** gathers Budget, Bank accounts, Cash flow, Giving & funds and Payroll as tabs. **Reports** splits into **Downloads** and **Board packet**. **Messages** gains **Requests**.
- Phones get a bottom bar: Home, Messages, Finances, Reports and More.
- **Payroll pricing is no longer shown** to clients or on the website. The Payroll add-on card tells them to message their account manager for pricing and details, and has a **Message your account manager** button. Expect those questions in your inbox.

### 2026-10-08: tabs you can see, usage stats that count everything

- **Tabs** on Work, Team, a client's pages and inside cards are now a filled control (the active tab is gold), so "Tasks, Close, Deadlines" reads as a row of tabs instead of plain text.
- **Settings › Usage stats** (admins) now counts in the database, so the numbers are exact at any range: pages *and* tabs, an eight-week trend, who's active and when each person was last seen, clients that have gone quiet for 30 days, key actions (search, guide searches with no result, help, tours), devices, and **Export CSV**. See [Usage stats and Developer tools](#/help/admin-insight).
- **Settings › Developer tools** (admins) gained **Scheduled jobs** with **Run now**, **Recent errors** caught in people's browsers, **Send me a test email**, **Reload for the latest** and a **Show unreleased features** flag.
- **Settings › Emails** shows delivered, opened, clicked and bounced counts for the last 30 days once the Resend webhook is set up.

### 2026-10-08: your photo in your email signature

- **Settings › Email signature** has **Include my profile photo**. Turn it on and your Profile photo shows beside your sign-off in the emails the portal sends to your clients. Drafts that open in your own mail app stay text-only. See [How do I change my settings?](#/help/staff-settings).

### 2026-10-08: birthdays, anniversaries and performance

- **Settings › Profile** has **Birthday** and **Start date**. Add yours so the team can celebrate with you; a first sign-in prompt and a Today item remind you until both are in. See [Birthdays, work anniversaries and gift reminders](#/help/celebrations).
- **Team › People › Celebrations** shows the next 30 days of birthdays and work anniversaries. Admins get each one on **Today** a week ahead with **Send shout-out**, **Gift sent** and **Dismiss**, plus a "Coming up" section in the weekly digest. Admins can also fill in dates from **Team › Members**.
- **Team › Performance** scores every bookkeeper 0 to 100 from replies within goal, month-ends closed on time, client health, tasks and deadlines, hours vs capacity and the latest quarterly review. Admins see the ranking; bookkeepers see their own score and inputs. See [How does Team › Performance score bookkeepers?](#/help/performance).

### 2026-10-08: new staff navigation

- **Five places** in the left rail: **Today**, **Inbox**, **Work**, **Clients** and **Team**, with **Settings** at the bottom. Every page is a title, one row of tabs and the content.
- **One top bar.** The page title, its buttons and its tab row now sit on a single bar across the top: white over the cream page in light mode, and the same dark color as the rail in dark mode so the rail, tool bar and header read as one frame. Clients see the same bar on their side.
- **Today** replaces Home: one list of what needs you, most urgent first, with four tiles above it. No more cards to arrange. See [What's on my Today page?](#/help/home-page).
- **Work** holds **Tasks** (was My Tasks), **Close** (was Close tracker) and **Deadlines**. See [What's on the Work page?](#/help/work-page).
- **Clients** is your client list with health, backup and **Hours this month**, which bookkeepers can now see for their own clients. Inside a client you get a breadcrumb, one tab row (including **SOP** and **Milestone**) and **View as client**. See [How do I use the Clients page?](#/help/clients-page).
- **Team** is for everyone now: **People** (who's out, your backups, your time off, shout-outs), **Reviews** and **Onboarding**. Admins also get **Hours**, **Reply times**, **Feedback** and **Members**. See [What's on the Team page?](#/help/team-page).
- **Help, feedback and the tour** are under **?** in the top bar. The **Help** and **Feedback** sidebar items are gone.
- **Ctrl+K** / **⌘K** now jumps to any page or action as well as clients, tasks, SOPs and help. With nothing typed it lists every page.
- Tabs are in the address, so links such as `#/work/close` or `#/team/reviews` open straight to the tab, and **Back** works the way you'd expect.
- A one-minute **tour** runs on your first sign-in. Run it again from **?** → **Take the tour**.

### 2026-10-07

- **Team Reviews**: quarterly self-reviews, manager reviews, action steps, signatures and the team survey. See [How do quarterly reviews work?](#/help/quarterly-reviews).
- **Client files in Google Drive**: documents clients upload go to the firm's Google Drive.
- Filing deadlines, client health scores, time off and coverage, shout-outs, SOP freshness and the new-hire checklist.

### 2026-09-30

- The staff **top bar**: client picker, sync pill, search, bell, **+** and **?**. See [What's on the bar at the top of the page?](#/help/top-bar).
- Automated close checks and stale-bank flags on the month-end close.
$sg$, array[$sg$change bookkeeper$sg$, $sg$reassign bookkeeper$sg$, $sg$bookkeeper chip$sg$, $sg$new look$sg$, $sg$left sidebar$sg$, $sg$brand colors$sg$, $sg$hover menus$sg$, $sg$lato$sg$, $sg$classic colors$sg$, $sg$classic menus$sg$, $sg$roll-forward$sg$, $sg$balance tie out$sg$, $sg$reveal comparison$sg$, $sg$review meeting$sg$, $sg$both sides complete$sg$, $sg$ready to reveal$sg$, $sg$month rhythm$sg$, $sg$month rhythm setting$sg$, $sg$monthly dates$sg$, $sg$slate view bar$sg$, $sg$sort chips$sg$, $sg$quick chips$sg$, $sg$mine today$sg$, $sg$part of month$sg$, $sg$group by status$sg$, $sg$reset view$sg$, $sg$new today$sg$, $sg$do next$sg$, $sg$today redesign$sg$, $sg$clients needing attention$sg$, $sg$waiting on others$sg$, $sg$this week card$sg$, $sg$recent clients$sg$, $sg$count line$sg$, $sg$also needs you$sg$, $sg$right now$sg$, $sg$right now card$sg$, $sg$desk follows the page$sg$, $sg$waiting counts$sg$, $sg$slate link$sg$, $sg$plus on the rail$sg$, $sg$today tiles hidden$sg$, $sg$tasks open in the desk$sg$, $sg$task in the desk$sg$, $sg$back to desk$sg$, $sg$desk back button$sg$, $sg$f6$sg$, $sg$esc goes back$sg$, $sg$desk client tab$sg$, $sg$t opens the desk$sg$, $sg$desk on the right$sg$, $sg$desk rail$sg$, $sg$desk info bar$sg$, $sg$desk width$sg$, $sg$account menu$sg$, $sg$avatar menu$sg$, $sg$top right menu$sg$, $sg$settings moved$sg$, $sg$sign out moved$sg$, $sg$one avatar$sg$, $sg$final scores$sg$, $sg$review final email$sg$, $sg$compared with last quarter$sg$, $sg$quarter over quarter$sg$, $sg$review locked email$sg$, $sg$task details fields$sg$, $sg$fields at the top$sg$, $sg$field grid$sg$, $sg$task details placeholders$sg$, $sg$task rows$sg$, $sg$edit tasks in the list$sg$, $sg$add task row$sg$, $sg$assignee badge$sg$, $sg$due chip$sg$, $sg$priority$sg$, $sg$three dot menu$sg$, $sg$sidebar starts as icons$sg$, $sg$icon rail$sg$, $sg$expand sidebar$sg$, $sg$smarter duplicate checks$sg$, $sg$possible duplicates$sg$, $sg$smart mode$sg$, $sg$strict mode$sg$, $sg$client tab$sg$, $sg$workbench client tab$sg$, $sg$look up a client$sg$, $sg$pin a client$sg$, $sg$pinned clients$sg$, $sg$select many tasks$sg$, $sg$bulk actions$sg$, $sg$bulk complete$sg$, $sg$multi-select tasks$sg$, $sg$reassign many$sg$, $sg$move many tasks$sg$, $sg$undo$sg$, $sg$ctrl z$sg$, $sg$cmd z$sg$, $sg$n skipped$sg$, $sg$clear several flags$sg$, $sg$select all flags$sg$, $sg$bulk clear$sg$, $sg$clear multiple flags$sg$, $sg$reply from the workbench$sg$, $sg$open file from the workbench$sg$, $sg$reply without leaving the page$sg$, $sg$close steps can be tasks$sg$, $sg$create month-end tasks from the close checklist$sg$, $sg$month-end tasks$sg$, $sg$looks done$sg$, $sg$close checklist tasks$sg$, $sg$my tasks tab$sg$, $sg$plain words$sg$, $sg$quick add plain words$sg$, $sg$for me$sg$, $sg$re client$sg$, $sg$by friday$sg$, $sg$did you mean$sg$, $sg$will add$sg$, $sg$workbench$sg$, $sg$the workbench$sg$, $sg$press w$sg$, $sg$drawer$sg$, $sg$open a task from the workbench$sg$, $sg$esc closes one layer$sg$, $sg$snooze$sg$, $sg$no reply needed$sg$, $sg$mark checked$sg$, $sg$classic today$sg$, $sg$workbench preview$sg$, $sg$subtasks$sg$, $sg$subtasks inline$sg$, $sg$subtasks open in place$sg$, $sg$open subtasks$sg$, $sg$expand subtasks$sg$, $sg$subtask arrow$sg$, $sg$project color$sg$, $sg$project colors$sg$, $sg$color dot$sg$, $sg$change color$sg$, $sg$change project color$sg$, $sg$manage projects$sg$, $sg$move to trash$sg$, $sg$restore project$sg$, $sg$trash$sg$, $sg$group by client$sg$, $sg$group by$sg$, $sg$by client$sg$, $sg$asana import$sg$, $sg$imported from asana$sg$, $sg$asana tasks$sg$, $sg$your asana tasks$sg$, $sg$asana copied$sg$, $sg$draft templates$sg$, $sg$help for this page tasks$sg$, $sg$unassigned$sg$, $sg$unassigned tasks$sg$, $sg$claim$sg$, $sg$claim a task$sg$, $sg$unassigned group$sg$, $sg$assign to$sg$, $sg$named person$sg$, $sg$leave unassigned$sg$, $sg$from asana$sg$, $sg$no team yet$sg$, $sg$assign team$sg$, $sg$profile photo$sg$, $sg$profile photos$sg$, $sg$photo$sg$, $sg$headshot$sg$, $sg$photo background$sg$, $sg$needs edit$sg$, $sg$time off hand-off$sg$, $sg$hand my tasks to backups$sg$, $sg$hand off tasks$sg$, $sg$hand back now$sg$, $sg$covering for$sg$, $sg$out of office tasks$sg$, $sg$ooo$sg$, $sg$recurring$sg$, $sg$recurring tasks$sg$, $sg$task templates$sg$, $sg$#/tasks/templates$sg$, $sg$missed periods$sg$, $sg$standard set$sg$, $sg$standard close set$sg$, $sg$make due tasks now$sg$, $sg$recurring tag$sg$, $sg$skip for this client$sg$, $sg$change for this client$sg$, $sg$task review$sg$, $sg$review queue$sg$, $sg$approve$sg$, $sg$send back$sg$, $sg$take back$sg$, $sg$reviewer$sg$, $sg$on time$sg$, $sg$on-time$sg$, $sg$sign off$sg$, $sg$ready for sign-off$sg$, $sg$admin sign-off$sg$, $sg$reopen reason$sg$, $sg$launches$sg$, $sg$launch notice$sg$, $sg$new feature tour$sg$, $sg$new tour$sg$, $sg$announcements$sg$, $sg$fix sign-in$sg$, $sg$can't sign in$sg$, $sg$sign-in account$sg$, $sg$signup disabled$sg$, $sg$client list failed$sg$, $sg$couldn't load the client list$sg$, $sg$error code$sg$, $sg$copy details$sg$, $sg$something went wrong$sg$, $sg$new bookkeeper first sign in$sg$, $sg$reason line$sg$, $sg$sign-in diagnostics$sg$, $sg$admins and bookkeepers cards$sg$, $sg$staff roster$sg$, $sg$staff page$sg$, $sg$staff sign in page$sg$, $sg$/staff$sg$, $sg$sign-in failed$sg$, $sg$couldn't sign you in$sg$, $sg$google sign-in$sg$, $sg$mgb internal$sg$, $sg$internal$sg$, $sg$show test clients$sg$, $sg$test tag$sg$, $sg$test clients hidden$sg$, $sg$pull from$sg$, $sg$ledger pull range$sg$, $sg$quickbooks keys$sg$, $sg$sandbox$sg$, $sg$test client connect$sg$, $sg$production keys$sg$, $sg$connect failed$sg$, $sg$error id$sg$, $sg$ledger review$sg$, $sg$review a file$sg$, $sg$ledger reviewed$sg$, $sg$greeting name$sg$, $sg$contact email$sg$, $sg$budget approval$sg$, $sg$approve budget$sg$, $sg$full access contact$sg$, $sg$approved by$sg$, $sg$submitted by$sg$, $sg$done by$sg$, $sg$deleted notes$sg$, $sg$soft delete$sg$, $sg$delete note$sg$, $sg$note names$sg$, $sg$budget comment names$sg$, $sg$variance note names$sg$, $sg$contact name change$sg$, $sg$rename contact$sg$, $sg$publish policy version$sg$, $sg$publish new version$sg$, $sg$handbook grid$sg$, $sg$signatures by bookkeeper$sg$, $sg$retry filing$sg$, $sg$message names$sg$, $sg$message sender$sg$, $sg$fake name$sg$, $sg$month end balance sheet$sg$, $sg$balance sheet from quickbooks$sg$, $sg$change my name$sg$, $sg$rename$sg$, $sg$name$sg$, $sg$install$sg$, $sg$get the app$sg$, $sg$desktop app$sg$, $sg$install tip$sg$, $sg$app$sg$, $sg$staff handbook$sg$, $sg$handbook$sg$, $sg$sign policy$sg$, $sg$countersign$sg$, $sg$policies$sg$, $sg$review quarter$sg$, $sg$previous quarter$sg$, $sg$survey drafts$sg$, $sg$finish survey later$sg$, $sg$admins follow reviews$sg$, $sg$in progress view$sg$, $sg$no clients yet$sg$, $sg$tasks$sg$, $sg$my tasks$sg$, $sg$task details$sg$, $sg$quick add$sg$, $sg$q$sg$, $sg$projects$sg$, $sg$sops project$sg$, $sg$90 day$sg$, $sg$open to all staff$sg$, $sg$own window$sg$, $sg$dock in portal$sg$, $sg$notes and sops$sg$, $sg$mentions$sg$, $sg$task status$sg$, $sg$ready for review$sg$, $sg$restore task$sg$, $sg$tasks tour$sg$, $sg$board packet$sg$, $sg$presentation view$sg$, $sg$report builder$sg$, $sg$client help menu$sg$, $sg$question mark menu$sg$, $sg$tips$sg$, $sg$tips while you learn$sg$, $sg$hints$sg$, $sg$first 30 days$sg$, $sg$learning$sg$, $sg$pro tour$sg$, $sg$upsell$sg$, $sg$upgrade$sg$, $sg$basic clients$sg$, $sg$bookkeeper tour$sg$, $sg$temporary admin tour$sg$, $sg$client tour$sg$, $sg$tour versions$sg$, $sg$admin tour$sg$, $sg$account manager tour$sg$, $sg$inventory$sg$, $sg$tech$sg$, $sg$equipment$sg$, $sg$what's new$sg$, $sg$whats new$sg$, $sg$new$sg$, $sg$changes$sg$, $sg$updates$sg$, $sg$release notes$sg$, $sg$changelog$sg$, $sg$navigation$sg$, $sg$redesign$sg$, $sg$five places$sg$, $sg$client setup$sg$, $sg$close tab$sg$, $sg$client close$sg$, $sg$last tab$sg$, $sg$client view$sg$, $sg$bank on basic$sg$, $sg$open for this client$sg$, $sg$deep links$sg$, $sg$balance sheet$sg$, $sg$reports sent$sg$, $sg$tab row fade$sg$, $sg$client task panel$sg$, $sg$up next$sg$, $sg$t$sg$, $sg$for this page$sg$, $sg$follow my client$sg$, $sg$ask client$sg$, $sg$client requests$sg$, $sg$waiting on client$sg$, $sg$#/tasks/waiting$sg$, $sg$client contacts$sg$, $sg$what we need from you$sg$, $sg$clients answer$sg$, $sg$answer link$sg$, $sg$/respond$sg$, $sg$test copy$sg$, $sg$ask client emails live$sg$, $sg$pilot list$sg$, $sg$desk$sg$, $sg$glass$sg$, $sg$frosted glass$sg$, $sg$desk glass$sg$, $sg$slate$sg$, $sg$the desk$sg$, $sg$renamed$sg$, $sg$workbench is now desk$sg$, $sg$tasks is now slate$sg$, $sg$press d$sg$, $sg$d key$sg$, $sg$resize the desk$sg$, $sg$drag to resize$sg$, $sg$desk height$sg$, $sg$page stays usable$sg$, $sg$reference policy$sg$, $sg$reference policies$sg$, $sg$new policy$sg$, $sg$policy drafts$sg$, $sg$policies to sign$sg$, $sg$search policies$sg$, $sg$employee records$sg$, $sg$emergency contact$sg$, $sg$month swing$sg$, $sg$swing flag$sg$, $sg$hr$sg$, $sg$hr place$sg$, $sg$moved from team$sg$, $sg$team split$sg$, $sg$old links$sg$, $sg$approve handbook drafts$sg$, $sg$policy approver$sg$, $sg$needs your approval$sg$, $sg$request changes$sg$, $sg$employee handbook chapters$sg$, $sg$handbook drafts to approve$sg$, $sg$change approver$sg$, $sg$co-ceo$sg$, $sg$handbook drafts sent back to me$sg$, $sg$changes requested email$sg$, $sg$slate app$sg$, $sg$open slate app$sg$, $sg$install slate app$sg$, $sg$sliver$sg$, $sg$slate sizes$sg$, $sg$saved views$sg$, $sg$manual order$sg$, $sg$board view$sg$, $sg$classic tasks page$sg$]::text[], 15),
    ($sg$tips$sg$, $sg$How do tips work?$sg$, $sg$Getting started$sg$, $sg$staff$sg$, $sg$For your first 30 days, a small **Tip** now and then points out one useful thing on the page you're on. Tips are quiet on purpose: nothing dims, nothing blocks the page, and you can ignore them. This page explains how they behave and lists every one, so you can read again anything you dismissed.

### What a tip looks like

- A thin, soft outline appears around one part of the page, and a small card sits beside it, never on top of it. The card keeps clear of buttons, links and fields where it can, and off the page's title and tabs: for something in the bar at the top, it hangs below, in the page. On a phone the card sits along the bottom of the screen (or near the top, under the page's title and tabs, when the part it points at is low on the screen, but never over the fields of the form that part is in).
- The card says **Tip**, then one or two short sentences. Along the bottom: a small **Turn off tips**, **Learn more** (opens the full help article) and **Got it**.
- Everything on the page keeps working while a tip is showing. A tip never scrolls the page, never takes over your keyboard, and never pulses or bounces. It fades in gently (not at all if your device is set to reduce motion).

### How they behave

- **One at a time, once each.** Only one tip is on screen at a time, and each tip shows once. Dismissing it counts as seen, so it doesn't come back.
- **A gentle pace.** A tip waits until the page has settled, and not in the first few seconds after you sign in. You get at most one tip per visit to a page, about two minutes between tips (counted from when the last one went away, or from when a tour ended) and at most four a day, so your first day isn't a tip on every page.
- **Out of the way.** No tip shows while a tour is running or about to start, while a **New** launch notice is showing at the top of the page, while a dialog, menu or panel is open, while you're typing in a field, or while the browser tab is in the background. If a tour or dialog opens by itself (or you press **Ctrl+K** / **⌘K**) while a tip is showing, the tip just hides and isn't counted as seen, so it can come back on a later visit. Clicking anything else, a menu button included, counts as dismissing it.
- **It goes when you move on.** Press **Esc**, click **Got it** or **Learn more**, or click anywhere else, even on the card's text (that click still does what it normally does). Going to another page or scrolling the highlighted part out of view also makes it go away, and counts as seen once the tip has been up for a couple of seconds.
- **Tips match your role.** Everyone gets the tips for daily work. Bookkeepers, admins and account managers also get a few on their own pages (see the lists below).
- **Never in someone else's view.** Tips don't appear in the client portal, in **Preview as a client user** or while an admin uses **View as**, and nothing is saved there.

### How long they last

Tips run for 30 days from the first time you sign in to the portal. If you were already on the team when tips were introduced (2026-10-09), your 30 days started the first time you opened the portal after that, so everyone gets the full 30 days. When the 30 days are up, tips stop on their own.

### Turn tips off or on

It's one switch, in three places:

1. **Staff guide**: the **Tips while you learn** switch at the top of the guide's home page, under the search box (**?** → **Staff guide**).
2. **Settings › Help**: the last row of the card.
3. **?** in the top bar: **Tips while you learn: On** / **Off**. Click it to flip the switch.

Under the switch it says where you stand: **On, 23 days left**, **Off**, or **Your 30 days ended. Turn on for another 30 days.** The small **Turn off tips** on a tip's card does the same as switching it off.

- **Turning off** stops tips right away. Nothing is lost: the tips you've seen stay marked as seen.
- **Turning on again** (from Off, or after your 30 days ended) starts a fresh 30 days and shows every tip again, including ones you dismissed before.

While an admin uses **View as**, nothing can be saved, so the switch is greyed out in Settings and the **?** menu row is hidden. Stop viewing as first.

### All tips

Here is every tip, in the order they're considered when two fit the same page (the first one you haven't seen, and that is on screen, shows; the other waits for a later visit). **Learn more** on the card opens the article in the last column.

#### Everyone

| Page | Tip | Learn more |
|---|---|---|
| Today | This line counts what is due today and what is late. Open Slate takes you to the full list. | [What's on my Today page?](#/help/home-page) |
| Today (only while the Desk is on) | The button does the next thing: it starts or opens your top item. Press D on any page for your Desk, where the full list has Snooze, No reply needed and Mark checked (each with Undo); its Slate tab has your tasks, and its Client tab one client's tasks (☆ pins a client). | [How do I use the Desk?](#/help/workbench) |
| Any page (only while the Desk is on, on a computer) | Press D or click this bar to open your Desk on the right. Drag its left edge to make it wider or narrower; it remembers your width. | [How do I use the Desk?](#/help/workbench) |
| Clients | Mine also includes clients you're the backup for and ones an admin gave you access to, not only those assigned to you. | [How do I use the Clients page?](#/help/clients-page) |
| Clients | Hover a Health score to see what's costing it points. The same reasons are listed on the client's Overview. | [What does client health mean?](#/help/client-health) |
| A client's Close | Tick each close step as you finish it; it records who and when. Your first tick sets the month to In progress. When your part is done, mark it Ready for sign-off; an admin signs it off, and that emails the client. | [What's on a client's Close tab?](#/help/client-close) |
| A client's Ledger review | Clear a flag with a reason, or Ask client when only they can say. Stop flagging this keeps a known pattern quiet for this client only. | [How does Ledger review work?](#/help/ledger-review) |
| A client's Documents | The client sees these on their Documents page and uploads straight into them. Files go to the firm's Google Drive; Mark received closes one. | [How do I request a document from a client?](#/help/document-requests) |
| A client's Overview | Set this client's backup under Edit dates and coverage. A backup doesn't get in automatically; they can request access, or an admin can give it. | [How do I add time off and make sure my clients are covered?](#/help/time-off-coverage) |
| A client's SOP | After 180 days an SOP shows as stale. Read it through; if it's still right, Mark as still accurate resets the clock. | [How do I write or update a client's SOP?](#/help/client-sops) |
| Inbox, or a client's Messages | Loop in emails the assigned bookkeeper and adds a staff-only note. @name in a Note does the same; in a Reply the client sees the @name. | [How do I message a client or a teammate?](#/help/inbox) |
| Inbox (only while the Desk is on) | A client's last message just says thanks? No reply needed takes the thread off your Desk without sending anything. A new message from them puts it back. | [How do I use the Desk?](#/help/workbench) |
| A client's Messages | Click i for this client's portal logins, open requests, pinned notes, SOP and recent portal visits, right beside the thread. | [How do I message a client or a teammate?](#/help/inbox) |
| Any client page | The sync pill: QuickBooks syncs on the plan's schedule (Basic monthly, Pro every hour). Staff can click it to Sync now on any plan after changing something in QuickBooks. | [How do I connect a client's QuickBooks and use Sync now?](#/help/quickbooks-connection) |
| Any client page | Client view shows the client's own pages. View as client, at the bottom of it, shows them exactly as one of the client's people sees them. Nothing changes for them; Exit preview brings you back. | [How do I see the portal the way a client sees it?](#/help/preview-as) |
| Work › Slate | Pick a client and tick Share with this client's team so other staff on it can see and tick off the task. Repeat needs a Due date. | [How do I use my Slate?](#/help/my-tasks) |
| Work › Close | Click a cell to set the month's status and add a note, like waiting on a bank statement. The cell shows who changed it and when. | [How do I track month-end close?](#/help/month-end-close) |
| Work › Deadlines | Weekend due dates move to Monday, but holidays don't, so verify each date before filing. Mark filed shows the team who filed it. | [How do I track filing deadlines?](#/help/deadlines) |
| HR › Reviews | Your self-review saves as a draft as you go. Once both forms are in, set up a time with your reviewer; you see the comparison together in that meeting. Other admins can follow along. | [How do quarterly reviews work?](#/help/quarterly-reviews) |
| Today | On a computer you can install MyGoodBooks as an app. In Chrome or Edge, click the install icon at the right end of the address bar. | [How do I install MyGoodBooks as an app?](#/help/get-the-app) |
| Settings | Choose where you land after signing in: Today, Work › Slate or the last client you opened. It's under Appearance & start page. | [How do I change my settings (profile, notifications, theme, signature)?](#/help/staff-settings) |
| Any client page | Search (or Ctrl+K, ⌘K on a Mac) also looks inside the open client: transactions, budget lines, documents and messages, as well as clients, SOPs and help. | [What's on the bar at the top of the page?](#/help/top-bar) |

#### Everyone: Slate

These show on **Work › Slate** (the Slate pages), after the tips above. The newest are **Select many tasks**, **Month-end tasks from the Close checklist**, **Quick add in plain words**, **Subtasks**, **project colors**, **Group by** and **Manage projects**.

| Page | Tip | Learn more |
|---|---|---|
| Slate | Press q on any staff page to add a task (on a touch screen, tap Add task). Type it in one line: @name assigns it, #client files it, fri or 10/31 sets the date, and !high marks it urgent. | [How do I use my Slate?](#/help/my-tasks) |
| Slate | Click a group's heading to fold it; it stays that way next time. Done starts folded, and View can turn the Today group off. | [How do I use my Slate?](#/help/my-tasks) |
| Slate | Click a status to change it. On a task that needs review, Done becomes Send for review; an admin who didn't do the work approves it or sends it back with a note. | [What's in a task's details?](#/help/task-details) |
| Slate | Recurring holds the templates that make monthly, quarterly and yearly tasks for each client. Tasks they make show a Recurring tag. | [How do recurring tasks from templates work?](#/help/task-templates) |
| Slate | Waiting on client lists everything you've asked a client for from a task, longest wait first. Ask client is in a client task's details. | [How do I ask a client something from a task?](#/help/ask-client) |
| Slate (new) | Group by lists your tasks by due date, client, part of the month or status. Sort and quick chips sit beside it, and the portal remembers your view. | [How do I use my Slate?](#/help/my-tasks) |
| Slate › Recurring, One client (new) | Turn this on and the client's Close steps (bank feed, bank rec, card rec, entries, review) become tasks each month. Ticking a step moves its task. Admins and the client's account manager can change it. | [How do Close checklist steps become tasks?](#/help/close-checklist-tasks) |
| Slate (new) | Tick this box (or press v) on several tasks to complete, reassign, move, reschedule or delete them together. Each change has Undo for 10 seconds, or press Ctrl+Z. On a touch screen it leaves out the keys. | [How do I change many tasks at once, and undo a change?](#/help/select-many-tasks) |
| Slate (new) | Add a task in plain words: Send the payroll summary for Sierra re Example Church by Friday. Quick add shows what it understood before you save. | [How do I add a task, note or document request, or message a client?](#/help/quick-actions) |
| Slate (new) | This task has subtasks. Click its row and they open right under it; click the task's name to open its details instead. The count shows how many are done. | [How do I use my Slate?](#/help/my-tasks) |
| Slate (new) | Every project has a color, shown beside its name here, in the sidebar and on its tasks. An owner or admin can change it under Project options. | [How do client task lists and projects work?](#/help/task-lists-and-projects) |
| Slate | Nobody is on this task yet. Assign opens a list of people: pick yourself and it moves into your groups, or pick a teammate to hand it to them. | [How do I use my Slate?](#/help/my-tasks) |
| Slate | Projects are shared lists. SOPs and 90 Day are open to all staff, so anyone can add to them. Each client you can see has its own list too. | [How do client task lists and projects work?](#/help/task-lists-and-projects) |
| Slate (not on a touch screen) | Open Slate app opens Slate as its own app beside your work. Links you click there open in this portal window. | [How do I use the Slate app?](#/help/tasks-own-window) |
| Any client page (Desk off) | Your next task for this client. Click All tasks, or press t, to see them all without leaving the page. | [How do I see a client's tasks without leaving the page?](#/help/client-tasks-drawer) |

#### Admins: Slate

| Page | Tip | Learn more |
|---|---|---|
| Slate | Review lists the work waiting for an admin's approval, oldest first. The number is what you can approve now. | [How does task review work?](#/help/task-review) |
| Slate (new) | Manage projects lists every project, including archived ones and the trash. Rename, archive, trash or restore from there. | [How do I rename, archive or trash a project?](#/help/manage-projects) |
| Slate | No team yet lists clients brought over from Asana with no bookkeeper. Open one and click Assign team to give it one; no email is sent. | [How do client task lists and projects work?](#/help/task-lists-and-projects) |

#### Bookkeepers

| Page | Tip | Learn more |
|---|---|---|
| Team › People | Adding time off doesn't give your backup access. Check each client has a backup on its Overview; admins can give access for your dates. | [How do I add time off and make sure my clients are covered?](#/help/time-off-coverage) |

#### Admins

| Page | Tip | Learn more |
|---|---|---|
| HR › Members | Give a bookkeeper the admin pages for 1 hour, 1 day or 1 week, say while you're away. It ends by itself; Revoke ends it early. | [How do I add staff and manage their access?](#/help/staff-management) |
| HR › Members | Last seen shows when someone last used the app: their page, browser, app version and last error. Check it first when someone says something's broken. | [How do I add staff and manage their access?](#/help/staff-management) |

#### Admins and anyone with temporary admin access

| Page | Tip | Learn more |
|---|---|---|
| Settings › Firm settings › Usage stats | Counts are exact for the range you pick. Further down, Quiet clients lists organizations with no sign-in for 30 days or more (or never): worth a nudge. | [Usage stats and Developer tools](#/help/admin-insight) |

#### Account managers (admins who are a client's account manager)

| Page | Tip | Learn more |
|---|---|---|
| Today | A client asked to upgrade or add Payroll. Follow up, then mark it Contacted or Completed, or Dismiss it, so it leaves everyone's Today. | [Account manager guide](#/help/account-manager-guide) |
| HR › Reviews | Reviews you give are here. Fill in each person's form; once both are in, prep with the comparison, reveal it in the meeting, agree on action steps and both sign. | [Account manager guide](#/help/account-manager-guide) |

On a touch screen the search tip leaves out the keyboard shortcut, and the Health tip (it needs a mouse to hover) doesn't show.

### Good to know

- Tips are saved to your account, so they follow you to any computer or browser. Clearing your browser's data, or **Reset local state** in Developer tools, doesn't bring dismissed tips back.
- A tip you expected didn't show? You may have already seen it, the daily limit of four may be used up, or the part of the page it points at isn't on screen yet (a list that is still loading, or nothing to show there yet) or has no room for the card beside it. It will show on a later visit.
- Want the whole walk-through instead? **?** → **Bookkeeper tour** (or the Admin and Account manager tours). Tours, launch notices and tips never show at the same time. See [Bookkeeper guide](#/help/bookkeeper-guide).
$sg$, array[$sg$tips$sg$, $sg$hints$sg$, $sg$tooltips$sg$, $sg$learning$sg$, $sg$new staff$sg$, $sg$first 30 days$sg$, $sg$turn off tips$sg$, $sg$turn on tips$sg$, $sg$help page$sg$, $sg$tip$sg$, $sg$got it$sg$, $sg$learn more$sg$, $sg$dismiss$sg$, $sg$tips while you learn$sg$, $sg$settings help$sg$, $sg$30 days$sg$]::text[], 32),
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

The Desk lives on the right of the portal. For a small window of your own beside QuickBooks or on a second screen, use the Slate app instead: see [How do I use the Slate app?](#/help/tasks-own-window). Bulk edits, saved views, manual order and boards are in the Slate app too.

**View as** (admins): the Desk is private to each person, so it never opens there. Today shows the classic page with the note "{First}'s Desk is private to them, so View as shows the classic Today."

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

### Install the Slate app

Slate can be installed as a second app next to MyGoodBooks, with its own icon, so you can open it from the Dock or Start menu without opening the portal first. In Chrome or Edge on a computer, click **Install Slate app** next to **Open Slate app** on the Slate page and confirm. To remove it, open the **⋮** (Chrome) or **…** (Edge) menu in the Slate window and choose **Uninstall MGB Slate**. See [How do I use the Slate app?](#/help/tasks-own-window).

### Troubleshooting

- **I don't see the install icon.** Sign in first and use Chrome or Edge on a computer. It doesn't show if the app is already installed (you'll see an *Open in app* icon instead).
- **I installed MGB Desk during the preview.** That preview window is gone: the Desk itself is on the right of the portal (press **D**). Remove the old app the same way: open its **⋮** (Chrome) or **…** (Edge) menu and choose **Uninstall MGB Desk**.
- **I want to remove it.** In Chrome's app window, open the **⋮** menu and choose **Uninstall MyGoodBooks**. In Edge's app window, open the **…** menu, then **App settings**, then **Uninstall**. You can also go to `chrome://apps` or `edge://apps`, right-click MyGoodBooks and choose to remove it.
$sg$, array[$sg$install banner$sg$, $sg$install$sg$, $sg$app$sg$, $sg$desktop app$sg$, $sg$computer$sg$, $sg$chrome$sg$, $sg$edge$sg$, $sg$install icon$sg$, $sg$address bar$sg$, $sg$pwa$sg$, $sg$window$sg$, $sg$start menu$sg$, $sg$dock$sg$, $sg$get the app$sg$, $sg$phone$sg$, $sg$iphone$sg$, $sg$android$sg$, $sg$website$sg$, $sg$uninstall$sg$, $sg$slate app$sg$, $sg$install slate app$sg$, $sg$mgb slate$sg$]::text[], 25),
    ($sg$admin-insight$sg$, $sg$Usage stats and Developer tools$sg$, $sg$Admin$sg$, $sg$staff$sg$, $sg$Two admin pages under **Settings › Firm settings › Insight and records**, next to the [Audit log](#/help/audit-log). Search (**Ctrl+K** / **⌘K**) jumps to each one too.

### Usage stats

Counts come straight from the database for the range you pick (7, 30 or 90 days, or all time), so the numbers are exact. Time spent in **View as** isn't counted.

- **Most-used pages** ranks every page and tab (for example **Team › Performance**), with the staff and client split. A client's **Close** tab shows as **Close**. From Oct 10, 2026, coming back to a client opens the tab you left, so Overview views drop from that day and Close views start then. **Client view menu opened** under **Actions** counts how often staff open the Client view menu.
- **Trend** shows the last eight weeks of page views and how many different people were in each week.
- **Active people** shows how many staff and clients signed in over the last 7 and 30 days, then everyone by last seen. **Quiet clients** lists client organizations with no sign-in for 30 days or more, or none ever. That's a good list to nudge.
- **Actions** counts things people did rather than pages they opened: search opened with **Ctrl+K**, guide searches, guide searches that found nothing (the queries are listed so you can add an article), **Help for this page**, tours finished or skipped, and **Client ? menu clicks** (what clients pick from the **?** in their top bar: the tours, Messages, Help and settings, Contact support; previews don't count).
- **Devices** splits views across desktop, phone and the installed app.
- **Export CSV** downloads the page and people tables for the range.
- **Feature feedback** is the in-app survey, with **Copy summary for Claude**.
- **Announcements** at the very bottom lists each launch notice with how many people **Toured**, have **Seen** it (this includes Later), **Skipped** it or are **Not yet**, and a click on any count shows the names. Temporary admins and account managers only appear once they have answered, since the staff list can't tell them apart.

### Developer tools

- **Feature flags** are per-browser testing switches: force every client to Pro, verbose console logging, a simulated slow network, **Show unreleased features** (currently the **Install app** prompt), **Slate app preview** (Slate as its own app for you only while its firm switch is off), **Classic tasks page** (the old Slate window for you only once the Slate app is on), **Classic Today** (the old Today for you only), **Classic fonts**, **Classic colors** and **Classic menus** (the old fonts, colors and old menus for you only) and **Month rhythm preview** (the Slate month rhythm work for you only while its firm switch is off; nothing uses it yet). The Desk, left sidebar, Lato font, brand colors and hover menus no longer have a preview box, because they are on for everyone; if the owner ever turns one of those switches off, it goes off for everyone. Nothing here changes anything for anyone else. See [How do I use the Desk?](#/help/workbench).
- **Reset local state** clears this browser's saved layouts, theme and other per-browser hints. It also forgets the last tab you used on each client, any link waiting to open, which Onboarding cards you had open, and the **Show test clients** switch. Feature flags stay. Tours, Tips while you learn and launch announcements are saved to your account, so it doesn't reset them.
- **Slate switches** shows the firm-wide Slate settings, read-only: whether late tasks count in scores and reports (`late_tasks_count_against_staff`, off during the grace period) and the date it started counting (`late_tasks_effective_from`), whether the standard close set is live, **Ask client emails live** (off means every Ask client email and reminder is a dry run), the Ask client pilot clients, how many reminders come before **No reply**, how long an answer link works, the on-time start date, whether time off hands tasks to backups automatically on the first day off (off means only the manual **Hand my tasks to backups** / **Hand off tasks** buttons move them), whether the one-time Asana import can be applied (off; it ran once, on Oct 16, and was switched off again), whether the **Desk** and new Today are on for staff (`wb_enabled`, off until the owner turns it on), whether the new left sidebar is on for staff (`nav_enabled`), whether the whole app uses Lato (`lato_enabled`), whether the brand colors are on for everyone (`brand_enabled`) and whether menus open on hover for everyone (`hovernav_enabled`); `wb_enabled`, `nav_enabled`, `lato_enabled`, `brand_enabled` and `hovernav_enabled` are all on as of 2026-10-21 (they stay off until the owner turns them on), the sidebar's role defaults (`layout_defaults`, set in **Settings › Firm settings › Sidebar defaults**), whether the **Slate app** is on for staff (`slate_app_enabled`, on for everyone since October 25, 2026; the owner-only SQL line sets it, never this card), which business day of the next month a month's open Ledger flags count as due on it (`wb_gl_due_bday`; 10 when not set), from which date client uploads show there as new files (`wb_doc_check_from`; Oct 16 when not set), the **Month rhythm** days (`month_rhythm`, shown as for example 4th, 14th, 24th · next business day; 4th, 14th, 24th when not set; admins change it on **Settings › Firm settings › Month rhythm**) and whether the monthly rhythm tasks are on for everyone (`month_rhythm_enabled`, off until the owner turns it on). Only the owner changes them: the standard close set on **Slate › Recurring**, and **Ask client emails live** on **Settings › Firm settings › Emails** (**Client emails** card); the time-off, Asana import, Desk, Slate app, left sidebar, Lato, brand colors, hover menus and month rhythm switches are changed in the database only (the card only shows them).
- **Scheduled jobs** lists every automatic job (email outbox, digest, QuickBooks sync, health checks, chasers) with its schedule, last run and result. **Run now** starts one immediately. A red **failed** means the last run errored; **Run now** and read the message.
- **Recent errors** are errors the app caught in someone's browser: when, who, which page, browser, app version and the message. Click one for the technical detail. Send that to whoever is fixing the app. **HR › Members › Last seen** shows one person's latest error and version (see [Staff and access](#/help/staff-management)).
- **Recent activity** is every change to the staff list (added, removed, role changed, deactivated, reactivated), plus each Google sign-in account the app set up ("set up Google sign-in for …") and each **Fix sign-in** run. See [How do I add staff and manage their access?](#/help/staff-management).
- **Send me a test email** sends a short email to your own address so you can confirm the firm's sender works.
- **System info** shows the app version with **Reload for the latest**, which Supabase project the app talks to, and whether the staff table and audit log can be read.
- **Where things live** links to GitHub, Supabase, Vercel, Google Cloud, GoDaddy, Squarespace, Resend, the client-files Google Drive and the Intuit developer dashboard. Credentials are in the 1Password vault, never here.

### Emails › Delivery

The **Emails** page shows delivered, opened, clicked and bounced counts for the last 30 days once the Resend webhook is set up (Resend › Webhooks, pointed at the portal's `resend-webhook` function). Until then the card says so.

Keep **click tracking off** for the sending domain in Resend (Domains › your domain › Configuration). Ask-client emails carry a link that answers a request with no login, and click tracking would route that link through Resend. The webhook only stores when a click happened and the browser, never the link itself. Open tracking is fine.
$sg$, array[$sg$slate app preview$sg$, $sg$slate_app_enabled$sg$, $sg$mgb_slate_app_preview$sg$, $sg$workbench preview$sg$, $sg$classic today$sg$, $sg$wb_enabled$sg$, $sg$announcements$sg$, $sg$launch notice$sg$, $sg$who toured$sg$, $sg$usage stats$sg$, $sg$usage$sg$, $sg$analytics$sg$, $sg$page views$sg$, $sg$active users$sg$, $sg$last seen$sg$, $sg$quiet clients$sg$, $sg$developer tools$sg$, $sg$dev tools$sg$, $sg$feature flags$sg$, $sg$unreleased$sg$, $sg$scheduled jobs$sg$, $sg$cron$sg$, $sg$run now$sg$, $sg$errors$sg$, $sg$error log$sg$, $sg$test email$sg$, $sg$app version$sg$, $sg$reload$sg$, $sg$where things live$sg$, $sg$export csv$sg$, $sg$delivery$sg$, $sg$opened$sg$, $sg$clicked$sg$, $sg$webhook$sg$, $sg$click tracking$sg$, $sg$desk preview$sg$, $sg$slate switches$sg$, $sg$sidebar preview$sg$, $sg$nav_enabled$sg$, $sg$layout_defaults$sg$, $sg$left sidebar$sg$, $sg$month rhythm preview$sg$, $sg$month_rhythm$sg$, $sg$month_rhythm_enabled$sg$, $sg$classic tasks page$sg$, $sg$mgb_slate_classic$sg$]::text[], 560),
    ($sg$client-tasks-drawer$sg$, $sg$How do I see a client's tasks without leaving the page?$sg$, $sg$Daily work$sg$, $sg$staff$sg$, $sg$When you have a client open, their tasks are one glance or one key away. A line under the client's tabs shows the next task, and a side panel lists all of them. Neither one takes you off the page you're on.

### With the Desk on

When the Desk is on, the Desk's **Client** tab takes over this job: **t**, or **Slate** in the top bar while a client is open, opens the Desk on its **Client** tab for that client, and pressing **t** again closes the Desk. The strip under the client's tabs doesn't show, since the Desk's info bar already shows the client's open and waiting tasks. A task you click opens inside the Desk; **← Back** or **Esc** brings you back to the list. See [How do I use the Desk?](#/help/workbench). Everything below is how it works with the Desk off.

### The strip

On a client's tabs (Overview, Messages, Documents, Bank, Close, Reports, SOP and the others), a line under the tabs shows how many tasks are open and how many are overdue, and the next one. The next one is a task for the page you're on when there is one, otherwise the most overdue or soonest due.

- Tick the box to mark the next task done. On a task that needs review, your tick sends it to an admin instead. If it's already waiting for review, there's no box, unless you're an admin who can approve it: then the tick approves it.
- Click the task's name to open its details.
- **All tasks** opens the panel.
- With nothing open, the strip says so and has an **Add task** button.

The strip doesn't show on the Client view pages (the ones that copy what the client sees). The panel still opens from **Slate** in the top bar there.

### The panel

Press **t**, click **All tasks**, or click **Slate** in the top bar while a client is open. The panel slides in from the right (on a phone it's a sheet from the bottom) and lists every open task for the client:

- in groups: Overdue, Today, This week, Later, Waiting on client and Ready for review;
- with an add box at the top that picks this client for you, and an **Add task** row at the bottom of **This week**, **Later** and the other groups that can take a new task (click, type, **Enter**);
- with each row's assignee, due date and priority changeable in place (see [How do I use my Slate?](#/help/my-tasks));
- with **Show done**, to see finished tasks too;
- with **Full list** (the client's list on the Slate page) and **Slate** at the bottom.

It stays open as you move between the client's tabs, and it follows you to another client. On a staff page, **t** shows the last client you opened, and says so (or asks you to open a client first, if you haven't opened one yet). Press **Esc**, press **t** again or click **×** to close it.

Click a task and its details open on top of the panel. Close the details and you're back on that task in the list. While the panel is open, **q** adds a task to that client.

### For this page

The group at the top, **For this page**, lists the tasks that fit the tab you're on:

- **Close**: close or reconcile tasks, and tasks from the Monthly close SOP.
- **Bank**: bank, feed, reconcile, uncategorized or statement tasks, and tasks from the Bank feeds SOP.
- **Documents**: document, statement, receipt, upload, W-9 or 1099 tasks.
- **Reports**: report, board, packet or financials tasks.
- **Client settings**: access, login, invite or permissions tasks, tasks from the Access SOP, and access requests.
- **SOP**: any task that came from an SOP section.
- **Client view pages**: budget, giving, payroll and invoice tasks.

The task just moves up; nothing is hidden, and it never shows twice. The portal only looks at the task's name, its SOP section and where it came from (for example an access request), not its description.

### Follow my client

In the Slate app (see [How do I use the Slate app?](#/help/tasks-own-window)), turn on **Follow my client** and its list switches to whichever client you open in the portal. On a phone or tablet the switch is in the account menu. Your choice is remembered in that browser.

### Troubleshooting

- **There's no strip.** You're on a Client view page, previewing as a client, or Slate isn't set up yet.
- **t does nothing.** You're typing in a box, a menu or dialog is open, or a task's details are open. Press **Esc** first.
- **Follow doesn't switch.** Both windows need to be open in the same browser.
$sg$, array[$sg$desk client tab$sg$, $sg$with the desk on$sg$, $sg$strip hidden$sg$, $sg$add task row in the client panel$sg$, $sg$task row pickers$sg$, $sg$client tasks$sg$, $sg$tasks panel$sg$, $sg$client task panel$sg$, $sg$up next$sg$, $sg$next task$sg$, $sg$strip$sg$, $sg$all tasks$sg$, $sg$t$sg$, $sg$shortcut$sg$, $sg$for this page$sg$, $sg$tasks pill$sg$, $sg$follow my client$sg$, $sg$follow$sg$, $sg$side panel$sg$]::text[], 117)
  on conflict (slug) do update set
    title = excluded.title, section = excluded.section, audience = excluded.audience,
    body_md = excluded.body_md, keywords = excluded.keywords, sort = excluded.sort, updated_at = now()
  where (g.title, g.section, g.audience, g.body_md, g.keywords, g.sort)
    is distinct from (excluded.title, excluded.section, excluded.audience, excluded.body_md, excluded.keywords, excluded.sort);
  select md5(body_md) into cur from public.staff_guide where slug = 'tasks-own-window';
  if cur is distinct from '919e26c87257a1e7f960c299df8aeee3' then raise exception 'tasks-own-window: post-check failed (md5 %)', cur; end if;
  select md5(body_md) into cur from public.staff_guide where slug = 'whats-new';
  if cur is distinct from '696909ce72182766834dfcb41da948e1' then raise exception 'whats-new: post-check failed (md5 %)', cur; end if;
  select md5(body_md) into cur from public.staff_guide where slug = 'tips';
  if cur is distinct from '20a3c1023c3848aea60b6ee393a2a9d4' then raise exception 'tips: post-check failed (md5 %)', cur; end if;
  select md5(body_md) into cur from public.staff_guide where slug = 'workbench';
  if cur is distinct from '68c3c08f43dbd6bc0258a15d3cb9fd7d' then raise exception 'workbench: post-check failed (md5 %)', cur; end if;
  select md5(body_md) into cur from public.staff_guide where slug = 'get-the-app';
  if cur is distinct from 'b4e95631a45d93cfc481ac4444dc7c56' then raise exception 'get-the-app: post-check failed (md5 %)', cur; end if;
  select md5(body_md) into cur from public.staff_guide where slug = 'admin-insight';
  if cur is distinct from '90090cf830cf9f771d6982fc62e054f2' then raise exception 'admin-insight: post-check failed (md5 %)', cur; end if;
  select md5(body_md) into cur from public.staff_guide where slug = 'client-tasks-drawer';
  if cur is distinct from 'c71dd6a976ef96569ac40091f1c87192' then raise exception 'client-tasks-drawer: post-check failed (md5 %)', cur; end if;
end $guard$;
