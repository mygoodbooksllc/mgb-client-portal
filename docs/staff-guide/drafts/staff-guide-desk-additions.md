# Desk additions: DRAFT guide text

Draft for the hidden Desk additions preview (localStorage `mgb_deskplus_preview` / firm switch `deskplus_enabled`). Publish at launch, when the owner flips `deskplus_enabled`. Do not copy into the live guide before then.

## What's new (draft line)

- S1: The Desk Inbox has a new Ledger chip for your Ledger (GL Review) items.
- S2: The Desk's Client tab now shows what's waiting on the client, their latest messages and their latest files, under the client's tasks.
- S3: The Desk's Client tab has two new buttons next to + Task: Ask client (send the client a question or a document request without picking a task) and Message (open the chat on that client).
- S4: The + menu (top bar, Desk rail and phone) has three new items: Ask client…, Message… and Time off.

## Ledger chip

In the Desk, open the Inbox and look at the chips along the top. A new Ledger chip sits between Messages and Files. It shows only your Ledger (GL Review) items: flags to look at, reviews to approve, reviews sent back to you, and questions waiting on an answer. Pick All to see everything again.

## Client tab: Waiting on client, recent messages, recent files (S2)

Open your Desk, pick the **Client** tab and choose a client. Under the client's tasks are three short lists:

- **Waiting on client.** Everything you've asked this client for that they haven't answered yet, the longest wait first: what you asked, the day you asked, how many business days it has waited, and the reminder state (**Reminded once**, **Reminded 3 times**, **Reminders paused**, **No reply**). Click a row to open it: a request on a task you can open opens that task right in the Desk. If the request sits on a task you can't open (someone else's private task), you see only the request itself, never the task, and the row opens **Waiting on client** instead (bookkeepers: untick **Just my tasks** there to see it). A task that is waiting on the client without an open request shows under its own name. More than 10? **See all in Waiting on client** opens the full list.
- **Recent messages.** The client's last five messages, newest first: who wrote it, client or staff, when, and the first line of the message. A message that is only an attachment says *(attachment)*. Staff-only notes (internal notes) never appear here. Click one to open the chat on that person without leaving the page.
- **Recent files.** The client's last five files, newest first, with the file type and the day it was added. Files in the trash don't show. Click one to open it in Google Drive in a new tab (the server checks you can open it first). If it can't open, try again or open it from the client's **Documents**. A file that isn't in Google Drive yet opens the client's **Documents** instead.

Each list loads on its own. If one can't load, it says so with a **Retry** button and the others still show. Switching clients clears the lists and loads the new client's.

**Who sees what.** You only see clients you can open (the same list as the client picker): bookkeepers see their own clients, admins see every client, and a temporary admin sees the clients they were given. The lists are not in the Desk while an admin uses **View as**, because the Desk itself is off then.

## Client tab: Ask client and Message buttons (S3)

On the Desk's **Client** tab, two buttons sit next to **+ Task**:

- **Ask client** opens the same Ask client window you know from a task, but with no task attached. Pick what you need (a question, a document, an approval), write the title and message, choose who should answer, and send. The request then shows right away under **Waiting on client** on the same tab. Test clients only send you a copy marked [Test], and a client whose emails aren't switched on yet gets a dry run (nothing is emailed and the toast says so). Esc closes the window first; press Esc again to close the Desk.
- **Message** opens the chat on that client without leaving the page (on the Inbox page it takes you to the client's Messages instead).

Both buttons show only for a client you can open.

## The + menu: Ask client…, Message… and Time off (S4)

Click the **+** (top bar, Desk rail, or the top bar on a phone). Three new lines join **New task**:

- **Ask client…** On a client's page it opens Ask client for that client straight away. On any other page it first asks which client (type to find one; the same clients as the Client tab picker, so no MGB internal and no test clients unless **Show test clients** is on), then opens Ask client. It is the same window as on a task, with no task attached.
- **Message…** On a client's page it opens the chat on that client (this replaces the old **Message** line there). On any other page it opens the chat list (on the staff Inbox page the chat is the page itself, so it opens the Desk's Messages chip instead).
- **Time off** opens **My time off** in a window: add or remove days you'll be away, and **Hand my tasks to backups** works as it does on Team › People.

At launch also update the tour step "quick" in `Tour.jsx` (~line 1054, "or starts a Message") to mention Ask client…, Message… and Time off.

**Request document** and **New note** stay as they were. Esc closes the window first, then the Desk.

Guide files to update at launch (a "new way in" line each): `time-off-coverage.md` (**Time off** in the + menu) and `ask-client.md` (**Ask client…** in the + menu and the Client tab's **Ask client** button, no task needed).

Tip (draft, add to tips.md at launch; already in Tips.jsx and shows only while the Desk additions preview is on):

| Where | Tip | Learn more |
|---|---|---|
| Any page, Desk open on the Client tab (only with Desk additions on) | Waiting on client lists what you've asked this client for that they haven't answered yet. Click one to open it. Their latest messages and files are just below. | [How do I use the Desk?](#/help/workbench) |

## Ready to paste (launch)

The same text the guide SQL (supabase/staff-guide-desk-additions.sql) inserts. Paste into the live files at launch, in the places named. Do not paste before the owner flips `deskplus_enabled`.

### docs/staff-guide/workbench.md: insert before `### Keyboard shortcuts`

````markdown
### Ledger chip, and the Client tab's lists and buttons

**Ledger chip.** In the Inbox, the chips along the top have a **Ledger** chip just before **Documents**. It shows only your Ledger (GL Review) items: flags to look at, reviews to approve, reviews sent back to you, and questions waiting on an answer. Pick **All** to see everything again.

**Under the client's tasks on the Client tab** are three short lists. Each loads on its own; if one can't load it says so with a **Retry** button and the others still show.

- **Waiting on client.** Everything you've asked this client for that they haven't answered yet, longest wait first: what you asked, the day you asked, how many business days it has waited, and the reminder state (**Reminded once**, **Reminded 3 times**, **Reminders paused**, **No reply**). Click a row to open it: a request on a task you can open opens that task in the Desk. If the request sits on a task you can't open (someone else's private task), you see only the request, never the task, and the row opens **Waiting on client** instead. More than 10? **See all in Waiting on client** opens the full list.
- **Recent messages.** The client's last five messages, newest first: who wrote it, when, and the first line. A message that is only an attachment says *(attachment)*. Staff-only notes never appear here. Click one to open the chat on that person without leaving the page.
- **Recent files.** The client's last five files, newest first, with the file type and the day it was added. Files in the trash don't show. Click one to open it in Google Drive in a new tab. A file that isn't in Google Drive yet opens the client's **Documents** instead.

You only see clients you can open: bookkeepers see their own clients, admins see every client, and a temporary admin sees the clients they were given.

**Ask client and Message** sit next to **+ Task** on the Client tab:

- **Ask client** opens the same Ask client window you know from a task, but with no task attached. Pick what you need (a question, a document, an approval), write the title and message, choose who should answer, and send. The request then shows right away under **Waiting on client**. Test clients only send you a copy marked [Test], and a client whose emails aren't switched on yet gets a dry run (nothing is emailed and the toast says so). Esc closes the window first; press Esc again to close the Desk.
- **Message** opens the chat on that client without leaving the page.

### The + menu has three more lines

Click the **+** (top bar, Desk rail, or the top bar on a phone). Three lines join **New task**:

- **Ask client...** On a client's page it opens Ask client for that client straight away. On any other page it first asks which client (type to find one), then opens Ask client.
- **Message...** On a client's page it opens the chat on that client. On any other page it opens the chat list.
- **Time off** opens **My time off** in a window: add or remove days you'll be away, and **Hand my tasks to backups** works as it does on Team › People.

**Request document** and **New note** stay as they were.

````

### docs/staff-guide/time-off-coverage.md: insert right after `Click **Save time off**.` in Add your time off

````markdown
You can also click **+** in the top bar or the Desk rail and pick **Time off**. The same **My time off** window opens, with **Hand my tasks to backups** as on Team › People.
````

### docs/staff-guide/ask-client.md: insert before `### Ask from a task`

````markdown
### Ask without a task

From the Desk you can ask a client for something without picking a task. On the Desk's **Client** tab click **Ask client**, or click **+** in the top bar or the Desk rail and pick **Ask client...** (on a page that isn't a client's, pick the client first). It is the same window as on a task, with no task attached. The request shows under **Waiting on client** on the Client tab right away, and in **Slate › Waiting on client**.

````

### docs/staff-guide/whats-new.md: insert before `### 2026-10-23: View as covers the whole app, and Last seen (admins)`

````markdown
### 2026-10-25: More on the Desk

- **Ledger chip.** The Desk Inbox has a new **Ledger** chip for your Ledger (GL Review) items.
- **Client tab.** It now shows what's waiting on the client, their latest messages and their latest files, under the client's tasks.
- **Ask client and Message.** Two new buttons next to **+ Task**: Ask client (a question or document request without picking a task) and Message (open the chat on that client).
- **The + menu.** Three new lines: **Ask client...**, **Message...** and **Time off**.

````

### docs/staff-guide/tips.md: add under `#### Everyone: Slate`, before the `Waiting on client lists everything` row

````markdown
| Any page, Desk open on the Client tab | Waiting on client lists what you've asked this client for that they haven't answered yet. Click one to open it. Their latest messages and files are just below. | [How do I use the Desk?](#/help/workbench) |
````

Also at launch: nothing else in the app changes (the Desk tour stop and the Tour.jsx "quick" text switch on by themselves with the gate; the notice `desk-client-actions` shows by itself).
