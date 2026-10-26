-- Desk additions (S1-S4) staff guide rows: five articles, targeted replace() updates, body_md only.
-- Not applied: apply at launch when the owner flips deskplus_enabled.
-- Articles: workbench (the Desk), time-off-coverage, ask-client, whats-new, tips.
-- Each update inserts new text next to an anchor line of the live row (replace(body_md, anchor, new || anchor)),
-- only when the row does not already contain the new text (a re-run is a no-op), and the DO block raises (and rolls
-- back) when the row is missing, the anchor has moved, or the new text is not there afterwards. No deletes.
-- body_plain is generated: not touched. Text source: docs/staff-guide/drafts/staff-guide-desk-additions.md ("Ready to paste").
-- Verify afterward: select slug from staff_guide where body_md ilike '%More on the Desk%' or body_md ilike '%Ask without a task%'.
do $guard$
begin
  if not exists (select 1 from public.staff_guide where slug = 'workbench') then raise exception 'workbench: row missing'; end if;
  if position($m$### Ledger chip, and the Client tab$m$ in (select body_md from public.staff_guide where slug = 'workbench')) = 0 then
    if position($a$### Keyboard shortcuts$a$ in (select body_md from public.staff_guide where slug = 'workbench')) = 0 then raise exception 'workbench: anchor not found, regenerate'; end if;
    update public.staff_guide set body_md = replace(body_md, $a$### Keyboard shortcuts$a$, $n$### Ledger chip, and the Client tab's lists and buttons

**Ledger chip.** In the Inbox, the chips along the top have a **Ledger** chip just before **Files**. It shows only your Ledger (GL Review) items: flags to look at, reviews to approve, reviews sent back to you, and questions waiting on an answer. Pick **All** to see everything again.

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

- **Ask client…** On a client's page it opens Ask client for that client straight away. On any other page it first asks which client (type to find one), then opens Ask client.
- **Message…** On a client's page it opens the chat on that client. On any other page it opens the chat list.
- **Time off** opens **My time off** in a window: add or remove days you'll be away, and **Hand my tasks to backups** works as it does on Team › People.

**Request document** and **New note** stay as they were.

### Keyboard shortcuts$n$), updated_at = now() where slug = 'workbench';
  end if;
  if position($m$### Ledger chip, and the Client tab$m$ in (select body_md from public.staff_guide where slug = 'workbench')) = 0 then raise exception 'workbench: post-check failed'; end if;
  if not exists (select 1 from public.staff_guide where slug = 'time-off-coverage') then raise exception 'time-off-coverage: row missing'; end if;
  if position($m$pick **Time off**$m$ in (select body_md from public.staff_guide where slug = 'time-off-coverage')) = 0 then
    if position($a$Click **Save time off**.
$a$ in (select body_md from public.staff_guide where slug = 'time-off-coverage')) = 0 then raise exception 'time-off-coverage: anchor not found, regenerate'; end if;
    update public.staff_guide set body_md = replace(body_md, $a$Click **Save time off**.
$a$, $n$Click **Save time off**.

You can also click **+** in the top bar or the Desk rail and pick **Time off**. The same **My time off** window opens, with **Hand my tasks to backups** as on Team › People.
$n$), updated_at = now() where slug = 'time-off-coverage';
  end if;
  if position($m$pick **Time off**$m$ in (select body_md from public.staff_guide where slug = 'time-off-coverage')) = 0 then raise exception 'time-off-coverage: post-check failed'; end if;
  if not exists (select 1 from public.staff_guide where slug = 'ask-client') then raise exception 'ask-client: row missing'; end if;
  if position($m$### Ask without a task$m$ in (select body_md from public.staff_guide where slug = 'ask-client')) = 0 then
    if position($a$### Ask from a task$a$ in (select body_md from public.staff_guide where slug = 'ask-client')) = 0 then raise exception 'ask-client: anchor not found, regenerate'; end if;
    update public.staff_guide set body_md = replace(body_md, $a$### Ask from a task$a$, $n$### Ask without a task

From the Desk you can ask a client for something without picking a task. On the Desk's **Client** tab click **Ask client**, or click **+** in the top bar or the Desk rail and pick **Ask client…** (on a page that isn't a client's, pick the client first). It is the same window as on a task, with no task attached. The request shows under **Waiting on client** on the Client tab right away, and in **Slate › Waiting on client**.

### Ask from a task$n$), updated_at = now() where slug = 'ask-client';
  end if;
  if position($m$### Ask without a task$m$ in (select body_md from public.staff_guide where slug = 'ask-client')) = 0 then raise exception 'ask-client: post-check failed'; end if;
  if not exists (select 1 from public.staff_guide where slug = 'whats-new') then raise exception 'whats-new: row missing'; end if;
  if position($m$### 2026-10-25: More on the Desk$m$ in (select body_md from public.staff_guide where slug = 'whats-new')) = 0 then
    if position($a$### 2026-10-23: View as covers the whole app, and Last seen (admins)$a$ in (select body_md from public.staff_guide where slug = 'whats-new')) = 0 then raise exception 'whats-new: anchor not found, regenerate'; end if;
    update public.staff_guide set body_md = replace(body_md, $a$### 2026-10-23: View as covers the whole app, and Last seen (admins)$a$, $n$### 2026-10-25: More on the Desk

- **Ledger chip.** The Desk Inbox has a new **Ledger** chip for your Ledger (GL Review) items.
- **Client tab.** It now shows what's waiting on the client, their latest messages and their latest files, under the client's tasks.
- **Ask client and Message.** Two new buttons next to **+ Task**: Ask client (a question or document request without picking a task) and Message (open the chat on that client).
- **The + menu.** Three new lines: **Ask client…**, **Message…** and **Time off**.

### 2026-10-23: View as covers the whole app, and Last seen (admins)$n$), updated_at = now() where slug = 'whats-new';
  end if;
  if position($m$### 2026-10-25: More on the Desk$m$ in (select body_md from public.staff_guide where slug = 'whats-new')) = 0 then raise exception 'whats-new: post-check failed'; end if;
  if not exists (select 1 from public.staff_guide where slug = 'tips') then raise exception 'tips: row missing'; end if;
  if position($m$Any page, Desk open on the Client tab$m$ in (select body_md from public.staff_guide where slug = 'tips')) = 0 then
    if position($a$| Slate | Waiting on client lists everything you've asked a client for from a task$a$ in (select body_md from public.staff_guide where slug = 'tips')) = 0 then raise exception 'tips: anchor not found, regenerate'; end if;
    update public.staff_guide set body_md = replace(body_md, $a$| Slate | Waiting on client lists everything you've asked a client for from a task$a$, $n$| Any page, Desk open on the Client tab | Waiting on client lists what you've asked this client for that they haven't answered yet. Click one to open it. Their latest messages and files are just below. | [How do I use the Desk?](#/help/workbench) |
| Slate | Waiting on client lists everything you've asked a client for from a task$n$), updated_at = now() where slug = 'tips';
  end if;
  if position($m$Any page, Desk open on the Client tab$m$ in (select body_md from public.staff_guide where slug = 'tips')) = 0 then raise exception 'tips: post-check failed'; end if;
end $guard$;
