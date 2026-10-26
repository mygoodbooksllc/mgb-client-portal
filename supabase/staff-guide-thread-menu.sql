-- Thread menu staff guide rows: three articles, targeted replace() updates, body_md only.
-- NOT APPLIED: apply at launch, when the owner flips tk_settings.threadmenu_enabled.
-- Articles: inbox (new section before "Who gets emailed"), whats-new (new top entry), tips (new row).
-- Each update inserts new text next to an anchor of the live row, only when the row does not already contain it
-- (a re-run is a no-op); the DO block raises (and rolls back) when a row is missing, an anchor moved, or the text
-- is not there afterwards. No deletes. body_plain is generated: not touched.
-- Text source: docs/staff-guide/drafts/staff-guide-thread-menu.md ("Ready to paste"); paste the same text into
-- the repo files so the guide sync check still matches.
-- Verify afterward: select slug from staff_guide where body_md ilike '%Thread actions: rename%' or body_md ilike '%Thread menu in the Inbox%' or body_md ilike '%Right-click a client thread%';
do $guard$
begin
  if not exists (select 1 from public.staff_guide where slug = 'inbox') then raise exception 'inbox: row missing'; end if;
  if position($m$### Thread actions: rename, pin, done, snooze$m$ in (select body_md from public.staff_guide where slug = 'inbox')) = 0 then
    if position($a$### Who gets emailed when a client writes$a$ in (select body_md from public.staff_guide where slug = 'inbox')) = 0 then raise exception 'inbox: anchor not found, regenerate'; end if;
    update public.staff_guide set body_md = replace(body_md, $a$### Who gets emailed when a client writes$a$, $n$### Thread actions: rename, pin, done, snooze, reassign, hide

Right-click a client thread in the list, or click its **⋯** (it shows when you point at or tab to the row, and always on a phone or tablet). With the keyboard, **Shift+F10** or the menu key opens it on the selected thread.

- **Rename…** gives the thread a name everyone on staff sees, like "2025 tax documents" (up to 80 characters). The person's name moves to the start of the preview line. **Clear name** puts it back.
- **Pin to top** keeps the thread at the top of **All** and **Clients**, newest pin first. **Unpin** undoes it.
- **Mark done** moves the thread out of **All** and **Clients** into the **Done** chip. **Reopen** brings it back, and so does a new message from the client.
- **Snooze** gives **Tomorrow 8am**, **Next Monday 8am** or **Pick a date…** (up to 30 days ahead), all Central time. The thread waits in the **Snoozed** chip with a **Snoozed until …** tag and comes back at that time, or sooner if the client writes. **Unsnooze** brings it back now.
- **Reassign…** picks who on staff owns the thread (anyone who can see the client), shown as an **Assigned:** tag. **Unassigned** clears it. Nobody is emailed.
- **Create task** makes a private task for you, "Reply to …", linked to the thread, and opens it.
- **Copy link** copies a link to the newest message, to paste to a teammate.
- **Hide** takes the thread out of the list for everyone. Only an admin can bring it back: admins see a **Hidden** chip and pick **Restore**. If the client writes again, the thread comes back on its own with a **Hidden** tag until an admin restores it.

**Pin**, **Mark done**, **Reopen** and **Snooze** (and **Hide**, for admins) show **Undo** in the message at the bottom for a few seconds.

Good to know:

- It is shared: what one person does, everyone on staff sees. The last change wins.
- The client never sees names, tags or any of these actions, and nothing is emailed. Each change is kept in an audit log.
- None of these mark messages read. The unread count, the dots and the bell still count unread messages in a hidden, done or snoozed thread.
- While you search, done and snoozed threads show too, with their tag (hidden ones only for admins).
- A link straight to a done, snoozed or hidden thread still opens it; the list switches to **All**.
- A client's **Messages** tab and the chat drawer have the same menu and tags, but nothing is hidden or moved there.
- On the Desk, right-click a message row, or open its **⋯** and pick **Thread actions…**, for **Rename…**, **Mark done** / **Reopen**, **Reassign…**, **Create task**, **Copy link** and **Hide** / **Restore**. There is no Snooze or Pin there (the Desk has its own **Snooze**), and the Desk does not hide or reorder rows by these. **Mark done** and **Hide** take the row off the Desk the way **No reply needed** does; **Reopen** (or **Restore**) puts it back once neither **Mark done** nor **Hide** still holds it, and never undoes a **No reply needed** someone set on the Desk. Thread names show only on the Inbox.
- Team chats have no menu, and it is off during **View as**.

### Who gets emailed when a client writes$n$), updated_at = now() where slug = 'inbox';
  end if;
  if position($m$### Thread actions: rename, pin, done, snooze$m$ in (select body_md from public.staff_guide where slug = 'inbox')) = 0 then raise exception 'inbox: post-check failed'; end if;
  if not exists (select 1 from public.staff_guide where slug = 'whats-new') then raise exception 'whats-new: row missing'; end if;
  if position($m$Thread menu in the Inbox$m$ in (select body_md from public.staff_guide where slug = 'whats-new')) = 0 then
    if position($a$so a tour is never lost once its notice is gone.

$a$ in (select body_md from public.staff_guide where slug = 'whats-new')) = 0 then raise exception 'whats-new: anchor not found, regenerate'; end if;
    update public.staff_guide set body_md = replace(body_md, $a$so a tour is never lost once its notice is gone.

$a$, $n$so a tour is never lost once its notice is gone.

### 2026-10-25: Thread menu in the Inbox
- **Right-click a client thread** (or its **⋯**) to **Rename** it, **Pin** it to the top, **Mark done**, **Snooze** it until tomorrow, next Monday or a date, **Reassign** it, **Create task**, **Copy link** or **Hide** it. **Done**, **Snoozed** and **Hidden** (admins) chips list those threads, and a new client message always brings a thread back. Shared by the whole team; the client never sees it and nothing is emailed. On the Desk, a message row's **⋯** has **Thread actions…**. See [How do I message a client or a teammate?](#/help/inbox).

$n$), updated_at = now() where slug = 'whats-new';
  end if;
  if position($m$Thread menu in the Inbox$m$ in (select body_md from public.staff_guide where slug = 'whats-new')) = 0 then raise exception 'whats-new: post-check failed'; end if;
  if not exists (select 1 from public.staff_guide where slug = 'tips') then raise exception 'tips: row missing'; end if;
  if position($m$Right-click a client thread$m$ in (select body_md from public.staff_guide where slug = 'tips')) = 0 then
    if position($a$| Inbox (only while the Desk is on) | A client's last message just says thanks?$a$ in (select body_md from public.staff_guide where slug = 'tips')) = 0 then raise exception 'tips: anchor not found, regenerate'; end if;
    update public.staff_guide set body_md = replace(body_md, $a$| Inbox (only while the Desk is on) | A client's last message just says thanks?$a$, $n$| Inbox | Right-click a client thread, or click its ⋯, to rename, pin, mark done, snooze, reassign or hide it, make a task or copy a link. The client never sees it. | [How do I message a client or a teammate?](#/help/inbox) |
| Inbox (only while the Desk is on) | A client's last message just says thanks?$n$), updated_at = now() where slug = 'tips';
  end if;
  if position($m$Right-click a client thread$m$ in (select body_md from public.staff_guide where slug = 'tips')) = 0 then raise exception 'tips: post-check failed'; end if;
end
$guard$;
