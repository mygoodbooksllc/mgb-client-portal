---
title: How does task review work?
section: Daily work
audience: staff
keywords: [review, task review, review queue, ready for review, send for review, needs review, approve, approval, send back, sent back, take back, withdraw, reviewer, any admin, default reviewer, second admin, self review, own work, on time, on-time, deadline, late, waiting on client, first pass, review count, #/tasks/review]
sort: 113
---
Some tasks need a second pair of eyes before they're **Done**. The person doing the work sends it for review; an admin approves it or sends it back with a note.

### Sending work for review

A task with **Needs review before it's done** ticked has a review step. When you finish it, the status menu says **Send for review** instead of Done, and ticking the box does the same. The task goes to **Ready for review** and you see *Sent for review. An admin will approve it.*

This applies to admins too: an admin's own task with a review step goes to another admin.

While a task is in review:

- **The assignee can't be changed.** Take it back from review first.
- **You can take it back.** Open it and click **Take back**, or pick another status. It goes to **In progress** and the activity says *Taken back from review*.

### Who reviews it

The details show **Reviewer: {name}** or **Reviewer: any admin**.

- If the client has a reviewer set, or its account manager is an admin, that person reviews.
- An admin's own work with no reviewer goes to the Team Reviews default reviewer, so a second admin always looks at it.
- Otherwise any admin can approve it.
- Nobody approves work they did or sent for review. If you try, you see *You can't approve your own work. Another admin will review it.*

Admins can change the reviewer from the **Reviewer** menu in the review strip at the top of the task's details. The default reviewer for an admin's own work is the **Default reviewer** on **Team › Reviews**.

### Approving and sending back (admins)

Open the task. The strip at the top says **Waiting for review**, who the reviewer is, how long it has waited and how many times it was sent back.

- **Approve** makes it Done. If the task repeats, the next one is created.
- **Send back** asks *What needs another look?*. A note of at least 3 characters is required. The task goes back to **In progress**, your note is added to the task's comments, and the send-back count goes up.

You can also use the status menu on the row: **Approve** and **Send back** are there for the reviewer.

### The review queue

Click **Review** in the Slate sidebar (or go to `#/tasks/review`). Admins see everything waiting, oldest first, in groups:

- **Waiting on you**: you're the named reviewer.
- **Any admin**: no reviewer named.
- **Other reviewers**: another admin is named. You can still approve if you're an admin.
- **Your work in review**: what you sent, which you can take back but not approve.

The number next to **Review** in the sidebar counts what you can act on. Everyone who isn't an admin sees only their own work in review.

### On time

Below the queue, admins see the **Last 30 days** card: for each person, how much of their work was on time, how many tasks were approved, approved the first time (**First pass**) and sent back.

A task is **on time** when it's finished (or, with a review step, approved) by the end of its original due date, Chicago time. Time spent **Waiting on client** that started before the deadline is added to it. Being sent back is fine, as long as the approval lands before the deadline.

Only tasks with a due date count, and only tasks made from a template or by someone else. Tasks imported from Asana and access requests don't count. Work that's still open after its deadline counts as late.

### Emails

Admins can get an email when work is ready for their review, and the assignee when a task is sent back. Turn either off under **Settings › Notifications** (**Work is ready for my review**, **My task is sent back**).
