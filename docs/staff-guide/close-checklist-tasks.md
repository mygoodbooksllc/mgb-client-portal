---
title: How do Close checklist steps become tasks?
section: Month-end and recurring work
audience: staff
keywords: [close checklist and tasks, close checklist tasks, month-end tasks, create month-end tasks from the close checklist, close steps tasks, linked task, linked step, tick moves the task, sent for review, in review, ask an admin to reopen, waiting on the client, looks done, mark done, quickbooks shows, also this month, opt in, pilot, per client, one client, duplicates, month-end work, bank feed task, bank rec task, card rec task, entries task, review task, close_key, close checklist link]
sort: 322
---
For a client that has it turned on, five of the Close steps are also tasks: **Bank feed categorized**, **Bank accounts reconciled**, **Credit cards reconciled**, **Payroll and journal entries posted** and **Reports reviewed**. Each month the portal makes one task for each, for that client's team, and the step and its task stay in step: finish the task and the step ticks, tick the step and the task moves. **Reports sent to the client** and **Ledger reviewed** are never tasks; they tick themselves as before.

It's off for every client to start. The firm is trying it on one or two clients first.

### Turning it on for a client (admins and account managers)

1. Go to **Work › Slate › Recurring** and pick the client under **One client**.
2. Turn on **Create month-end tasks from the Close checklist**.
3. Tick **Also this month** first if you want tasks for the month you're in. Without it, the first tasks are next month's close.

The line under the switch says when the first tasks come, for example *First tasks: the November 2026 close, due early December 2026.* The tasks are made by the morning run, not the moment you switch it on. Only an admin or that client's account manager can change the switch; everyone else sees it read-only.

This works even while the standard close set is still off for everyone else (**Test clients only** on the Recurring page). Turning it off stops future months. Tasks already made stay, and so do their links.

### Duplicates: check the client's other templates

Month-end work can also come from other recurring templates (for example ones copied from Asana) or tasks someone made by hand. When you turn the switch on and the client already has templates that look like month-end work (titles with rec, reconcile, bank, card or close), you'll see *This client has N recurring templates that look like month-end work (bank rec, reconcile, close). Turn them off or you may get duplicates.* with their names. Skip them for this client in the same **One client** list. An admin turning on such a template for a client that has this switched on gets the same warning first.

### On the Close tab

A linked step shows its task's assignee and status (**To do**, **In progress**, **Waiting on client**, **In review**, **Done** or **Approved**). Click it to open the task.

Ticking a linked step moves its task, and a message says what happened:

| What you do | The task is | What happens |
|---|---|---|
| Tick | To do or In progress | The task is done (*Task marked done*). If it needs approval it goes to review instead (*Sent for review*) and the step stays unticked, showing **In review**. |
| Tick | Waiting on the client | Nothing changes: *Waiting on the client. Close the request first.* |
| Tick | In review | Nothing changes: *In review*. It ticks when the reviewer approves. |
| Untick | Done | The task goes back to To do (*Task reopened*). If an admin already approved it, only an admin can: *Ask an admin to reopen*. |
| Untick | In review | If you sent it, it comes back from review (*Pulled back from review*). Otherwise *In review. Only the person who sent it can pull it back.* |

Anyone who works on the client can tick a linked step, the same as changing that client's tasks. If you can't change the task, the step says so and nothing changes.

Your first tick on the Close tab still sets a **Not started** month to **In progress**, as before. Finishing a task from the Slate page ticks its step but doesn't change the month's status. A task made for a step someone already ticked starts done. Reassigning a task doesn't change the step. Reopening a month doesn't reopen its tasks.

### Looks done (from QuickBooks)

For a client with QuickBooks connected, when the month's QuickBooks check passes, two steps show a suggestion:

- **Bank feed categorized**: when bank accounts are active through month end and Uncategorized is zero.
- **Bank accounts reconciled**: when accounts are reconciled through month end.

It reads *Looks done. QuickBooks shows ...* with a **Mark done** button, which ticks the step the same way your own tick does. It never ticks by itself. **Credit cards reconciled** has no QuickBooks check, so it never suggests.

### In the task

A linked task's details show a link back, for example **Close checklist: Bank accounts reconciled, November 2026**, which opens that client's Close tab on that month and step. The same **Looks done** line shows there for bank feed and bank rec. The task's Activity shows *Close checklist updated* each time the step follows it.

### Troubleshooting

- **No tasks came.** The switch makes tasks starting with the month on the line under it, from the next morning run. Check that the step templates aren't skipped for this client in **One client**.
- **"This step has a task now. Refresh and tick it again."** The page was open before the task was made. Refresh it.
- **A ticked step unticked itself.** Someone reopened its task. Open the task from the step to see its Activity.
- **The step won't tick.** Read the message: the task may be waiting on the client, in review, or approved (only an admin reopens it).

See also [What's on a client's Close tab?](#/help/client-close) and [How do recurring tasks from templates work?](#/help/task-templates).
