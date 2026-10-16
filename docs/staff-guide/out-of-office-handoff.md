---
title: What happens to my tasks while I'm out?
section: Working with a client
audience: staff
keywords: [out of office, ooo, time off, vacation, away, hand off, handoff, hand my tasks to backups, hand off tasks, hand back now, covering, covering for, covered by, backup, backup bookkeeper, reassigned while out of office, handed back, tk-ooo-daily, ooo_auto_apply, pick a cover, backup is also out, no backup, can't open this client, ready for review stays]
sort: 256
---
While you're out, your open tasks can go to each client's **backup bookkeeper** and come back to you when you return. Nothing is lost and nobody has to reassign tasks one by one.

### What moves

When you click **Hand my tasks to backups** (or an admin clicks **Hand off tasks**), every task that is:

- assigned to you,
- **To do**, **In progress** or **Waiting on client**, and
- **due on a day you're out**

goes to that client's **Backup bookkeeper** (set on the client's **Overview** › **Edit dates and coverage**).

What **stays with you**:

- Tasks due **after** you're back.
- **Ready for review** tasks. Review and sign-off work exactly as before.
- **Private** tasks and **MGB (internal)** tasks.
- **Unassigned** tasks, even ones you made. Nobody is on them, so they stay where they are for anyone to **Claim**.
- A client with **no backup**, or whose backup is **also out that day**.
- A client the backup **can't open**. If you hand off yourself, an admin is asked to give them access. An admin's hand-off gives the access itself, for the time off only.

You stay the task's creator, so it still shows as yours in its history. The backup gets **one** email listing everything they're covering (not one per task), and you get one listing what went where. Those emails follow each person's **Task summaries** email setting (Settings).

### Do it now: Hand my tasks to backups

Tasks don't move on their own unless an admin has switched on the automatic hand-off (see **Admins** below), so do this before you leave.

1. Open **Team › People** (`#/team/people`) and find **My time off**.
2. Under the dates, click **Hand my tasks to backups**.
3. Check the list: **To {backup}** shows what moves and when it's due; **Staying with {your name}** shows what stays and why.
4. Click **Hand off {n} tasks**, or **Close** to leave it.

Doing it again later moves anything that's back with you, including tasks you took back with **Hand back now**. If a backup is refused access to a client, that client isn't asked about again for the same time off.

### Coming back

After your **last day off**, everything that went to a backup comes back to you automatically. You can end it early with **Hand back now** (then **Yes, hand back now**) next to the dates.

- **Cancel** your time off and covered tasks come back at once.
- **Shorten** it and tasks now due after you're back come home.
- **Move it later** before it starts and every covered task comes back to you. Click **Hand my tasks to backups** again closer to the new dates.
- A task whose **due date is moved** past your last day off stays with the backup until you're back.
- A task someone **reassigned by hand** while you were out is left where they put it.
- A task that is **Ready for review** waits until the review is finished, then comes back.
- A recurring task the backup ticks off rolls forward: if the next one is still due while you're out it stays with them, otherwise it comes straight back to you.

### What the backup sees

- In the task drawer, under **Assignee**: **Covering for {name} until {date}**. You see **With {backup} while you're out** on yours.
- On **Today**, covered tasks say **Covering for {name}**.
- The task's **Activity** shows *Reassigned to {backup} while out of office* and, later, *Handed back to {you} after time off*.
- Recurring tasks that come due during your time off are made for the backup straight away.

### Admins

On **Team › People**, each person's time off has **Hand off tasks**:

- The preview shows each task, who it goes to and **gives access** where the backup can't open the client yet.
- **Pick someone to cover (admins)**: for a client with no backup, a backup who is out or one without access, choose a person, then **Check again**.
- **{n} tasks with backups** and **Hand back now** show while tasks are out.

The automatic hand-off is **off** unless the `ooo_auto_apply` setting is `true` (Dev Tools › **Tasks switches** shows it). When it's on, the **tk-ooo-daily** cron hands tasks off early on the first day off. It never takes back a task someone handed back. Handing back after the last day off always runs.

### Related

- [How do I add time off and make sure my clients are covered?](#/help/time-off-coverage)
- [How do I get temporary access to a client I don't normally work on?](#/help/temporary-access)
