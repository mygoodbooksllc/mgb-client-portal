---
title: How does Blocked by work?
section: Daily work
audience: staff
keywords: [blocked by, blocked, blocking, blocker, add blocker, remove blocker, dependency, dependencies, waits for, wait for another task, lock, ready to start, blocked group, override, override block, close order step, close order, recurring template step, can't start, can't mark done]
sort: 112
---
Part of [Slate plus](#/help/slate-plus). Some tasks can't start until another one is finished. **Blocked by** makes a task wait for that other task.

### Make a task wait

1. Open the task and find **Blocked by** in its details, under the fields at the top.
2. Click **+ Add blocker** and search for the task it waits for (**Find the task it waits for**). It can be any task you can see, for any client.
3. Pick it. To undo, click the **×** (**Remove blocker**) on that line; the message has **Undo**.

The other task's details show a **Blocking** line, so both sides know.

### What a blocked task does

- The row shows a lock and **Blocked by 1** (the number is how many unfinished tasks it waits on). Hover it to see their names.
- On your Slate it sits in its own **Blocked** group, after **Later**, until the other task is done. A blocked task that is **late stays in Overdue** (with the lock), so it still counts as late everywhere.
- **Do next** on Today and the Desk, and Slate's summary, skip blocked tasks.
- You can't tick it done, start it (**In progress**) or send it for review while it's blocked. Slate says which tasks it's waiting on, for example *Blocked by 2 unfinished tasks: Bank recs, Credit cards. Finish those first.*
- When the last blocker is done (or moved to the trash), the blocked task's assignee gets one bell notice, **Ready to start**, and the task leaves **Blocked** on its own. There's no email.

A task can't block itself, and you can't make a loop (if task A already waits on task B, B can't wait on A).

### For admins

- **Override.** On a blocked task, admins get **Override…**. It asks for a reason (at least 3 characters) and is logged.
- **Close order step** on a recurring template. Number the steps of a close set (1, 2, 3 …) and each month's tasks wire themselves for the same client and month: step 2 waits for step 1, and so on. Every template starts with no step, so nothing changes until an admin sets one. Save the template first, then give it a step. See [How do recurring tasks from templates work?](#/help/task-templates).

### Troubleshooting

- **"This task is waiting on another task to finish."** It's still blocked. Open it and check **Blocked by**.
- **I don't see Blocked by.** It's not in **View as**, and read-only tasks show it without the add and remove buttons.
