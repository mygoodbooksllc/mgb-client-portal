# Desk additions: DRAFT guide text

Draft for the hidden Desk additions preview (localStorage `mgb_deskplus_preview` / firm switch `deskplus_enabled`). Publish at launch, when the owner flips `deskplus_enabled`. Do not copy into the live guide before then.

## What's new (draft line)

- S1: The Desk Inbox has a new Ledger chip for your Ledger (GL Review) items.
- S2: The Desk's Client tab now shows what's waiting on the client, their latest messages and their latest files, under the client's tasks.
- S3: The Desk's Client tab has two new buttons next to + Task: Ask client (send the client a question or a document request without picking a task) and Message (open the chat on that client).

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

Tip (draft, add to tips.md at launch; already in Tips.jsx and shows only while the Desk additions preview is on):

| Where | Tip | Learn more |
|---|---|---|
| Any page, Desk open on the Client tab (only with Desk additions on) | Waiting on client lists what you've asked this client for that they haven't answered yet. Click one to open it. Their latest messages and files are just below. | [How do I use the Desk?](#/help/workbench) |
