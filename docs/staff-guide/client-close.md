---
title: What's on a client's Close tab?
section: Working with a client
audience: staff
keywords: [close tab, client close, month-end close, sign off, signed off, ready for sign-off, reopen reason, admin sign-off, close steps, checklist, ledger reviewed, ledger review, approve, send back, mark reviewed, in progress, mark done, reopen, n/a, quickbooks check, sync now, sent to client, reports sent, balance sheet, month end balance sheet, balance sheet from quickbooks, email, reports are ready, late, status, notes, month picker, monthly close steps]
sort: 205
---
The **Close** tab is where you close one client's month. It holds the month's status, the QuickBooks check, the close steps (six, or seven with **Ledger reviewed**), what you've sent the client, and the client's own written close steps from their SOP. Staff only. The client never sees this tab.

Open it from the client's tab row, from the **{Month} close** line on the Overview, or by clicking the client's name on **Work › Close**. The address is `#/client/{id}/close`, so you can send a teammate a link.

### What's on the tab

- **Month**: pick the month. It opens on last month, the one you're closing now. The list goes back six months and also has the current month.
- **Due {date}** or **Late · {n} days**, next to the picker. A month is late when it isn't **Done** or **N/A** by the 15th of the next month (an admin can change that day on Work › Close). The chip goes away once the month is **Done** or **N/A**.
- A one-line summary: the status, **{n} of 6 steps** (or **of 7**) and the QuickBooks badge. Click it to jump to the status.
- **Status**: **Not started**, **In progress**, **Ready for sign-off**, **N/A**, and for admins **Done (sign off)**, with **Notes** (for example *Waiting on bank statement*) and a **Save** button. Under it: *Last updated by {name} · {time}*.
- **QuickBooks check**: what QuickBooks says about the month. See below.
- **Ledger review** (QuickBooks clients, from the month Ledger review started): this month's open, asked and cleared flags, how many are high priority, and *Last pulled {time} · counts as of the last pull*. It shows the sign-off (*Reviewed by {name} · Waiting for admin approval*, *Approved by {name}* or *Sent back: {note}*) and *Ready to mark reviewed* once no high-priority flags are open. Buttons: **Open Ledger review →**, **Mark reviewed**, and for an admin **Approve** and **Send back** (Send back asks what needs another look). An admin can approve their own review.
- **Close steps**: the six steps (seven with **Ledger reviewed**), with a tick box each.
- **Monthly close steps**: this client's own close steps, read-only, from the **SOP** tab. **Edit in SOP →** opens the SOP. If none are written, it says so and links to **Add them in SOP →**.
- **Sent to the client**: reports you've marked as sent, newest first. It shows the last 10; **Show all** lists the rest. If nothing's been sent, use **Mark sent to client** on Reports. **Go to Reports →** is right there.

On a phone, the tab stacks. **Monthly close steps** and **Sent to the client** fold up, and **Mark {Month} ready for sign-off** (admins: **Sign off {Month}**) stays at the bottom of the screen once it's ready.

### The close steps

1. Bank feed categorized
2. Bank accounts reconciled
3. Credit cards reconciled
4. Payroll and journal entries posted
5. Reports reviewed
6. Reports sent to the client

For a client with QuickBooks connected, from the month Ledger review started, there's a seventh step, **Ledger reviewed**, after **Reports reviewed**. Its box can't be ticked by hand. **Mark reviewed** ticks it, **Send back** unticks it, and the line under it says who reviewed and who approved. Its link is **Open Ledger →**. A client without a working QuickBooks connection keeps six steps.

Each tick records who ticked it and when. Most steps have a **Go →** link that opens the right place for that month: Bank filtered to uncategorized transactions, Bank filtered to not-reconciled rows, or Reports. The payroll and journal entries step says **See your steps →** and scrolls to the client's monthly close steps.

**Your first tick sets the month to In progress.** It only does that when the month is **Not started** (or has no record yet) and no other step is ticked. You'll see *{Month} is now In progress.* Unticking a step never changes the status.

### Ready for sign-off, then an admin signs off

**Only an admin makes a month Done.** That's the sign-off. Bookkeepers finish the work and mark the month **Ready for sign-off**. Ticking the last step doesn't finish the month. The full rules are in [Who signs off a month, quarter or year?](#/help/period-sign-off).

- Until every step is ticked, the tab says *{n} steps left before {Month} is ready for sign-off.* (admins: *before you can sign off {Month}*).
- **Bookkeepers:** when every step is ticked, **Mark {Month} ready for sign-off** appears. If QuickBooks still shows a problem, it reads **Mark {Month} ready anyway** and asks first. After that the tab says *{Month} is ready for sign-off · {date}. An admin signs it off.* You can also pick **Ready for sign-off** in the **Status** card and **Save**.
- **Admins:** the button is **Sign off {Month}** (or **Sign off {Month} anyway** when QuickBooks still shows a problem). Under it: *Signing off emails {client}'s people that {Month} reports are ready.* That's a real email to the client's people. See [How do I manage client emails?](#/help/client-emails). You can also pick **Done (sign off)** in the **Status** card and click **Save**; you don't need every step ticked for it.
- If tasks linked to the month are still open, signing off asks first: *{n} open tasks are still linked to {Month}: {names}. Sign off anyway?* It warns, it never blocks.
- If the client has the **Ledger reviewed** step and the review isn't approved yet, signing off asks *Ledger review isn't approved. Sign off anyway?* Yes records who went ahead without approval. Reopening a signed-off month clears the approval, so it needs approving again.
- If this month was signed off before, the app asks first, because signing it off again **sends the "reports are ready" email again**, unless it already went to that person in the last 7 days. Pick **Sign off again** only if you mean to.
- Once it's signed off, the tab says *{Month} is signed off · {name} · {date}*. Admins see a **Reopen** link. **Reopen** asks *Why reopen it?* (at least 3 characters), puts the month back to **In progress**, keeps the reason with the month, and doesn't send an email. Bookkeepers can't reopen a signed-off month; ask an admin.
- **N/A** means the month isn't needed. The tab says *{Month} is marked not needed (N/A).*

Saving a note on an **N/A** month after the late day asks first: *This close was on time. Saving a note now records it as finished today, which can count as late.* Pick **Save note** if you still want to.

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

On **Reports**, **Mark sent to client** logs the send. When the report is the **Profit & Loss Statement** set to **Last Closed Month**, it also ticks **Reports sent to the client** for that month and shows *Ticked "Reports sent to the client" for {Month}.* The **Board packet** does the same when it covers the month being closed. The **Balance Sheet** has no period of its own, so it counts only when its as-of date is the last day of the month being closed; a Balance Sheet as of any other day is only logged. For a client with QuickBooks connected, the Balance Sheet card has a second button, **Balance Sheet as of {last day of last month} (QuickBooks)**. It asks QuickBooks for the Balance Sheet as of that day and downloads it as a PDF that says it came from QuickBooks. Its own **Mark sent to client** appears once the month-end PDF has downloaded (logged as *As of {date} (QuickBooks)*) ticks **Reports sent to the client** for the month being closed. The plain **Download PDF** is still as of today and is only logged. Any other report, or another period, is only logged. If that was the last step, a link appears for 15 seconds: **1 step left: mark {Month} done →**. If the month is already **Done** or **N/A**, the step is still ticked but the status doesn't change, and no link appears.

### One record, two places

The Close tab and **Work › Close** show the same record. A change in one shows in the other. If two people save the same month at nearly the same time, the second sees **Someone else saved first**, with the other person's version and two buttons: **Load theirs** and **Keep mine**.

### The badge on the tab

The **Close** tab can show a dot for last month. Red means QuickBooks needs reconnecting, a QuickBooks check is blocked (uncategorized transactions or undeposited funds), the close is late, or the month before is still open. Amber means a bank or card account needs catching up in QuickBooks. A plain Not started or In progress month before the late day shows no dot. A screen reader reads the reason as part of the tab's name. To see it on screen, open the tab: the QuickBooks check says what's wrong. A client without a working QuickBooks connection never gets a "late" dot.

### Troubleshooting

- **I ticked every step and the month still isn't Done.** That's expected. Click **Mark {Month} ready for sign-off**; an admin signs it off.
- **"Only an admin sign-off can close a period."** Done is the admin sign-off. Pick **Ready for sign-off** instead.
- **"A signed-off period can only be reopened by an admin, with a reason."** Ask an admin to reopen it.
- **I can't tick Ledger reviewed.** That's on purpose. Click **Mark reviewed** on the Ledger review card or tab.
- **The status didn't change when I ticked a step.** Only the first tick of a month that's **Not started** moves it to **In progress**. If anyone ticked a step earlier, it won't change again.
- **The QuickBooks check looks old.** Click **Sync now**. On a Basic client the numbers can be weeks old.
- **The month-end Balance Sheet button isn't there.** It shows only for staff (not in **Preview as**) on a client with QuickBooks connected. Otherwise send the P&L for **Last Closed Month**, or tick the step yourself.
- **"Press Sync now once first, then try again."** This client's QuickBooks connection hasn't recorded which QuickBooks environment it uses yet. Press **Sync now** once on the client, then try the month-end Balance Sheet again.
- **"We couldn't read it" or "didn't balance."** QuickBooks sent a Balance Sheet we couldn't read, or one whose assets don't equal liabilities plus equity, so no PDF was made. Try again; if it repeats, check the Balance Sheet in QuickBooks.
- **"We couldn't get the Balance Sheet from QuickBooks just now."** Try again in a few minutes. If it says QuickBooks needs to be reconnected, reconnect it from **Client setup** first.
- **"Someone else saved first."** A teammate saved the same month. Read their version, then pick **Load theirs** or **Keep mine**.
- **No close steps in the side panel.** Add them on the client's **SOP** tab. See [How do I write or update a client's SOP?](#/help/client-sops).
