---
title: What's on a client's Close tab?
section: Working with a client
audience: staff
keywords: [close tab, client close, month-end close, close steps, checklist, in progress, mark done, reopen, n/a, quickbooks check, sync now, sent to client, reports sent, email, reports are ready, late, status, notes, month picker, monthly close steps]
sort: 205
---
The **Close** tab is where you close one client's month. It holds the month's status, the QuickBooks check, the six close steps, what you've sent the client, and the client's own written close steps from their SOP. Staff only. The client never sees this tab.

Open it from the client's tab row, from the **{Month} close** line on the Overview, or by clicking the client's name on **Work › Close**. The address is `#/client/{id}/close`, so you can send a teammate a link.

### What's on the tab

- **Month**: pick the month. It opens on last month, the one you're closing now. The list goes back six months and also has the current month.
- **Due {date}** or **Late · {n} days**, next to the picker. A month is late when it isn't **Done** or **N/A** by the 15th of the next month (an admin can change that day on Work › Close). The chip goes away once the month is **Done** or **N/A**.
- A one-line summary: the status, **{n} of 6 steps** and the QuickBooks badge. Click it to jump to the status.
- **Status**: **Not started**, **In progress**, **Review**, **Done** or **N/A**, with **Notes** (for example *Waiting on bank statement*) and a **Save** button. Under it: *Last updated by {name} · {time}*.
- **QuickBooks check**: what QuickBooks says about the month. See below.
- **Close steps**: the six steps, with a tick box each.
- **Monthly close steps**: this client's own close steps, read-only, from the **SOP** tab. **Edit in SOP →** opens the SOP. If none are written, it says so and links to **Add them in SOP →**.
- **Sent to the client**: reports you've marked as sent, newest first. It shows the last 10; **Show all** lists the rest. If nothing's been sent, use **Mark sent to client** on Reports. **Go to Reports →** is right there.

On a phone, the tab stacks. **Monthly close steps** and **Sent to the client** fold up, and **Mark {Month} done** stays at the bottom of the screen once it's ready.

### The six close steps

1. Bank feed categorized
2. Bank accounts reconciled
3. Credit cards reconciled
4. Payroll and journal entries posted
5. Reports reviewed
6. Reports sent to the client

Each tick records who ticked it and when. Most steps have a **Go →** link that opens the right place for that month: Bank filtered to uncategorized transactions, Bank filtered to not-reconciled rows, or Reports. The payroll and journal entries step says **See your steps →** and scrolls to the client's monthly close steps.

**Your first tick sets the month to In progress.** It only does that when the month is **Not started** (or has no record yet) and no other step is ticked. You'll see *{Month} is now In progress.* Unticking a step never changes the status.

### Marking the month done

**Done is always your click.** Ticking the sixth step doesn't finish the month.

- Until all six steps are ticked, the tab says *{n} steps left before you can mark {Month} done.*
- When they are, **Mark {Month} done** appears. If QuickBooks still shows a problem for that month, the button reads **Mark {Month} done anyway**, and asks you to confirm: *QuickBooks still shows: {reasons}. Mark {Month} done anyway?*
- Under the button: *Marking it done emails {client}'s people that {Month} reports are ready.* That's a real email to the client's people. See [How do I manage client emails?](#/help/client-emails).
- You can also pick **Done** in the **Status** card and click **Save**. That sends the same email, and you don't need all six steps for it.
- If this month was already marked done, the app asks first, because marking it done again **sends the "reports are ready" email again**. It remembers a done month for as long as you have the app open. Pick **Mark done and email again** only if you mean to.
- Once it's done, the tab says *{Month} is done · {name} · {date}* with a **Reopen** link. **Reopen** asks *Reopen {Month}? It goes back to In progress.* and doesn't send an email.
- **N/A** means the month isn't needed. The tab says *{Month} is marked not needed (N/A).*

Saving a note on a **Done** or **N/A** month after the late day asks first: *This close was on time. Saving a note now records it as finished today, which can count as late.* Pick **Save note** if you still want to.

### The QuickBooks check

For clients with QuickBooks connected, the app checks each finished month on its own. The tab shows the same **Ready**, **Blocked** or **Behind** result as Work › Close, with the reasons and the four checks. See [How do I track month-end close?](#/help/month-end-close).

- The current month says *QuickBooks checks a month after it ends.*
- **From QuickBooks {time} · Sync now** shows how fresh the check is. **Sync now** has no limit for staff, on any plan. A Basic client's data can be weeks old (Basic syncs monthly, on the 15th), so use **Sync now** before you rely on the check.
- If a check fails, the reason is a link. **Review uncategorized transactions →** opens Bank on those rows for the month. Each account that isn't reconciled is a link too, and so is each account whose bank feed went quiet. **Fix in QuickBooks** (undeposited funds) isn't a link: do that in QuickBooks.
- QuickBooks counts every kind of transaction under uncategorized, not just bank ones, so Bank may show fewer.
- Bank only shows the last 90 days. For an older month the tab says *Bank shows the last 90 days. Check QuickBooks for {Month}.*
- If the connection broke: *QuickBooks needs to be reconnected, so this check is out of date.* **Reconnect QuickBooks** opens the QuickBooks part of **Client setup**. Then click **Sync now**.
- If QuickBooks isn't connected: *QuickBooks isn't connected, so there's no automatic check. Tick the steps yourself.* If it just hasn't checked that month yet: *QuickBooks hasn't checked {Month} yet. Tick the steps yourself.*

### Reports sent

On **Reports**, **Mark sent to client** logs the send. When the report is the **Profit & Loss Statement** set to **Last Closed Month**, it also ticks **Reports sent to the client** for that month and shows *Ticked "Reports sent to the client" for {Month}.* The **Board packet** does the same when it covers the month being closed. Any other report, or another period, is only logged. If that was the last step, a link appears for 15 seconds: **1 step left: mark {Month} done →**. If the month is already **Done** or **N/A**, the step is still ticked but the status doesn't change, and no link appears.

### One record, two places

The Close tab and **Work › Close** show the same record. A change in one shows in the other. If two people save the same month at nearly the same time, the second sees **Someone else saved first**, with the other person's version and two buttons: **Load theirs** and **Keep mine**.

### The badge on the tab

The **Close** tab can show a dot for last month. Red means QuickBooks needs reconnecting, a QuickBooks check is blocked (uncategorized transactions or undeposited funds), the close is late, or the month before is still open. Amber means a bank or card account needs catching up in QuickBooks. A plain Not started or In progress month before the late day shows no dot. A screen reader reads the reason as part of the tab's name. To see it on screen, open the tab: the QuickBooks check says what's wrong. A client without a working QuickBooks connection never gets a "late" dot.

### Troubleshooting

- **I ticked all six steps and the month still isn't Done.** That's expected. Click **Mark {Month} done**.
- **The status didn't change when I ticked a step.** Only the first tick of a month that's **Not started** moves it to **In progress**. If anyone ticked a step earlier, it won't change again.
- **The QuickBooks check looks old.** Click **Sync now**. On a Basic client the numbers can be weeks old.
- **"Someone else saved first."** A teammate saved the same month. Read their version, then pick **Load theirs** or **Keep mine**.
- **No close steps in the side panel.** Add them on the client's **SOP** tab. See [How do I write or update a client's SOP?](#/help/client-sops).
