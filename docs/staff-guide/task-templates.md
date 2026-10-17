---
title: How do recurring tasks from templates work?
section: Month-end and recurring work
audience: staff
keywords: [create month-end tasks from the close checklist, close checklist tasks, also this month, templates, recurring, recurring tasks, repeat, weekly, monthly, quarterly, annually, fiscal year, generate, make due tasks now, automatic tasks, task templates, suggestions, suggested templates, save as template, checklist, due rule, business day, last business day, lead days, draft, turn on, pause, resume, retire, missed periods, dismissed, skip for this client, repeats locked, live for real clients, change for this client, standard set, standard close set, preview, recurring badge, #/tasks/templates, assign to, named person, leave unassigned, unassigned, claim, from asana, asana import]
sort: 320
---
Some work happens for every client on a schedule, like reconciling bank accounts each month. Instead of typing those tasks by hand, an admin sets up a **recurring template** once, and the portal makes the task for each client on its own every morning.

Templates live in **Slate › Recurring** (`#/tasks/templates`). The old **Task templates** link in Settings, and `#/templates`, take you there.

### What bookkeepers see

- The tasks appear on your **Slate** (and on the client's task list) for the clients you look after. A template picks who does it in **Assign to**: the client's **bookkeeper** (the default), **backup bookkeeper**, **account manager** or **reviewer**; **a named person** for every client; or **Leave unassigned (anyone on the client can claim it)**. If nobody has the chosen role, it goes to the bookkeeper, then the account manager. An unassigned task shows in the **Unassigned** group of **Slate** for everyone on the client, and **Claim** takes it (see [How do I use my Slate?](#/help/my-tasks)).
- The task name ends with the period, for example **"Reconcile bank accounts · Sep 2026"**, **"· Q3 2026"**, **"· FY 2027"** or **"· Wk of Sep 7"**.
- Each one shows a small **Recurring** tag on the row and in its details.
- It shows up a set number of days before it's due (the template's "show it early" days), not months ahead.
- If the template has a checklist, the task arrives with those steps. If it needs approval, it goes to review when you finish it (see [How does task review work?](#/help/task-review)).
- You get each task once per client per period. Making a template run again never makes a second copy.
- New tasks from a template don't send an assignment email. They're on your list the next morning.

### Due dates

A template's due date can be:

- **A business day of the month**, like the 10th business day of the month after the period ends.
- **The last business day**, or a few business days before it.
- **A day of the month**, like the 15th, moved to the next business day if it lands on a weekend or firm holiday.
- **A weekday of the month**, like the 2nd Tuesday.
- **A day of the week** (weekly templates).
- **Days after the period ends** (the old style).

Business days skip weekends and the firm's holidays. The editor shows the next three due dates as you type.

### What you can see (all staff)

Everyone can open **Slate › Recurring** to see the templates. Under **One client**, pick a client you look after to see which templates reach them and when the next one is due. You can also:

- **Skip a template for that client** with its switch. It stops making tasks for that client only.
- **Change** it for that client: a different title, due date, who does it, or whether it needs approval. Only an admin can turn approval off for a client. If an admin already turned it off, you can still skip or change the rest; the admin's setting stays as it is.
- **Preview 60 days** to see what's coming for that client.

### Setting up a template (admins)

1. In **Slate › Recurring**, click **New template**.
2. Type the **Title**, for example *Reconcile bank accounts*. Don't add the month; it's added for you.
3. Pick how often it **Repeats**: **Weekly**, **Monthly**, **Quarterly** or **Annually**. Annual templates can follow the calendar year or **each client's fiscal year**.
4. Pick when it's **Due** (see above).
5. **Show it this many days early** (0 to 90).
6. Pick **Assign to** (a role on the client, **A named person** and then the **Person**, or **Leave unassigned**), the **Priority**, and optionally the minutes it takes and the client's **SOP section** it links to.
7. Turn on **An admin approves it before it counts as done** if it needs review.
8. Under **Which clients**, tick plans and/or pick clients. Nothing ticked means every client.
9. Optional: a **Checklist**, one step per line (up to 50).
10. Click **Save draft**.

**New templates are drafts.** Nothing is made until you click **Turn on**. When you turn one on, it only makes tasks for periods from now on. Use **Pause** and **Resume** to stop and restart it, and **Retire** when it's no longer needed (tasks it already made stay). A retired template can go **Back to draft**.

**How often it repeats is fixed once a template has been on.** After it has been turned on (or has made a task), **Repeats** and **Year** can't be changed, because each period is counted from its start date. To change them, **Retire** it and make a new template. Everything else, like the title, due date and checklist, can still change.

Before turning one on, click **Preview** on its row to see what it would make for every client today. **Preview 30 days** shows what all templates that are on will make in the next 30 days. Nothing is created by a preview.

**Make due tasks now** runs the morning job straight away. It only makes what's already due to show up; anything already made is left alone.

The list says who each template goes to, for example *The client's bookkeeper*, a person's name, or *Unassigned*. Templates brought over from Asana have a **From Asana** tag.

### Missed periods (admins)

If a period's due date is more than 7 days ago when a template first reaches it (for example, you turned one on late), it isn't made on its own. It's listed under **Missed periods** at the top of the page. Click **Make task** if the work still needs doing, or **Dismiss**. A dismissed period isn't listed again.

If **Make task** can't make it, for example the client has nobody to give it to, it says why and the period stays listed so you can fix that and try again. If the period already has a task, it's linked to that task and leaves the list.

### The standard close set (admins and owner)

The firm's standard month-end templates are grouped at the top as a set. They come as drafts. Even when an admin turns them on, they only reach **test clients** until the owner switches the set to **Live for real clients**. The owner can switch it back off at any time.

Real clients start from the day the owner switches the set live: earlier months aren't made and aren't listed as missed. Switching it off and on again starts them from the new day. Test clients still start from the day each template was turned on.

**One client at a time, before the set is live.** Under **One client**, an admin or the client's account manager can turn on **Create month-end tasks from the Close checklist** for one client. That client then gets the five close-step templates (bank feed, bank rec, card rec, entries, review) from its first close month on, while the set stays off for everyone else. **Reports sent** is never made as a task. See [How do Close checklist steps become tasks?](#/help/close-checklist-tasks).

### Templates from tasks and suggestions

Any task can become a template: open it and pick **More actions** → **Save as template** (see [How do I use my Slate?](#/help/my-tasks)).

- Admins go straight to the editor on **Slate › Recurring**, pre-filled with the title (the period is removed), priority, the task's client and its checklist. Nothing is saved until you click **Save draft**.
- Other staff send a suggestion instead. Pending suggestions show at the top of **Slate › Recurring** under **Suggested by staff**, and in admins' bell. Click **Make template** to open the pre-filled editor (the suggestion is marked done when you save), or **Dismiss**.

### Troubleshooting

- **A task didn't appear for a client.** Check the template is **On**, that the client's plan or name is ticked, and that the client has a bookkeeper. **Recent runs** (admins) shows how many were skipped each morning, and **Preview** on a template lists each skipped client with the reason.
- **"Firm holidays run out on …"** in a preview: business-day due dates need next year's firm holidays. Ask an admin to add them.
- **"Pick someone who's active on staff."** The person picked under **Assign to** has left or isn't on staff. Pick someone else, or a role.
- **Temporary admins** can see templates but can't change them.
