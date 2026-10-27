---
title: How does Ledger review work?
section: Working with a client
audience: staff
keywords: [ledger review, general ledger, GL review, gl, flags, pull from quickbooks, pull again, clear a flag, ask client, got an answer, stop flagging, reconciliation, month vs the year, summary for the client, send via portal, send by email, greeting name, contact email, mark reviewed, approve, send back, ledger reviewed, warn, block, review a file, copy for excel, watch list, vendor watch list, uncategorized, suspense, opening balance equity, duplicate, possible duplicates, smart mode, strict mode, no longer flagged, set aside, undeposited funds, split lines, check gap, round dollar, weekend, month swing, swing, big change from usual, high priority]
sort: 207
---
**Ledger review** checks one month of a client's General Ledger for things worth a second look, before you close the month. It lives on the client's **Ledger review** tab, right after **Close**. Staff only. The client never sees this tab, and nothing in it changes their QuickBooks.

Open it from the client's tab row, or go straight to `#/client/{id}/ledger`. Check a ledger that isn't in QuickBooks with **Review a file** (below).

### Pull the ledger

1. Pick the **Month**. It opens on the last completed month.
2. The tab gets the ledger from QuickBooks (a "pull") and saves the flags it finds. **Pull from QuickBooks** gets the latest any time, for example after you fix something in QuickBooks. The line next to it says when the last pull happened and the months it covered, like *covered Aug 2025 – Oct 2026*. **Review month** is just the month you're checking.
   - **Go back to** (next to the button; the **i** explains it) chooses how far back that one pull goes: the usual 14 months, or any earlier month up to 24 months back. It applies to this pull only and never changes the saved setting in Settings; it goes back to the usual range after the pull. An earlier-month pull always runs fresh, and it doesn't clear flags that dropped out of QuickBooks (only the usual pull does that). It also saves only the checks that don't depend on how much history is loaded; round amounts, weekends, large, repeat vendors, check gaps and uncleared loans are shown but not saved. Use the usual range for the routine pull.
   - The tab lists only transactions dated inside the pull on screen (a line above the list says *Showing transactions from … to …*). Flags saved from an earlier, longer pull aren't deleted; they're hidden by default, and the line has a **Show N older unresolved flags** checkbox that brings them back (and counts them) whenever you want. You can also pull further back with **Go back to.
3. If someone else is pulling the same client, the tab says so. Wait a minute and click **Try again**.

A client without a working QuickBooks connection has no ledger to pull. The tab says so and points you to **Review a file**.

### The summary strip

Across the top: ledger lines, open flags, high priority, asked, and the dollars sitting in Uncategorized and in Ask client. Use it to see at a glance whether the month is ready.

### Flags

Each flag is one transaction (or one account) that a check picked out. The checks include suspense or uncategorized, opening balance equity, possible duplicates, a negative bank balance, a manual journal entry to cash, check number gaps, unusually large amounts, round dollars, weekend dates, no name or memo, accounts that aren't reconciled, and a **Month swing** on an income or expense account (below). **Watch-list vendor** flags come from the list an admin keeps (see Settings below). **Changed after close** flags a month that was already closed.

- Filter by check with the chips, and by state with the **Open**, **Asked** and **Cleared** tabs.
- Each flag says **Open since {month}**, so one that carries over month after month is easy to spot.
- High priority flags are the ones to deal with before you mark the month reviewed.

What you can do with a flag:

- **Clear** it. Pick a reason (*Expected, nothing wrong*, *Reviewed, it's fine*, *Fixed it in QuickBooks*, *The client answered* or *Other*) and add a note if it helps. Your name and the time are recorded.
- **Clear several at once.** Tick the box on each flag (or **Select all** above the list), then **Clear N selected**. Pick one reason and note for all of them. It clears what's on screen, so use the check chips first to narrow the list. Use **Stop flagging this** on a single flag, not in bulk.
- **Stop flagging this** (in the Clear box). A rule is saved for this client only, so the same pattern stays quiet from now on. The rules are listed on the tab. You can remove one any time, or accept or dismiss a rule the tab suggests.
- **Ask client** when only they can say what a charge was. The question is pre-filled and you can edit it. You choose **In the portal** (replies come back in Messages; only portal users who can see the whole company are offered, never someone limited to certain accounts) or **By email** to their contact email (see Client setup below; replies come to your own email). The flag moves to **Asked**.
- **Got an answer** when the client replies. Then clear it.
- **Send back** (admins) on a cleared flag you disagree with. It goes back to **Open**.

An asked question can show the amount and the question text in the email. It never shows our fees, rates or margins.

### Roll-forward

Under **Reconciliation** there is a **Roll-forward** panel. For each bank, credit card and loan account it shows the month you're reviewing as a tie out: the **beginning balance**, plus **money in** and minus **money out** (grouped by transaction type, biggest first), equals the **ending balance**. Credit cards call these **Charges** and **Payments and credits**; loans call them **Increases** and **Payments**. If the pull starts partway through the month, the beginning balance says what date it is as of.

It then checks that ending balance against the running balance QuickBooks reports on the account's last line of the month. If they match to the cent, the account says **Ties**. If not, the account opens by itself with **Doesn't tie** and the unexplained difference. Nothing is adjusted to make it work, so the difference is real: look for a line that's missing from the pull, was edited after it, or sits in another month. If QuickBooks didn't send running balances for an account, the activity is still listed but there is no check. When QuickBooks sends cleared status, each account also shows how many lines in the month aren't reconciled yet and their total.

The panel is for looking only. A balance that doesn't tie doesn't create a flag.

### Month swing

**Month swing** is a low priority flag on an income or expense account whose total for the month is very different from usual. It compares the month you're reviewing with the average of the up to three months just before it, using the ledger lines in the pull. A month the pull covers but the account has nothing in counts as zero.

It flags an account when the change is at least **$1,000** and at least **50%** of that average, up or down. Accounts whose average is under about $50 are skipped, since a percentage of nothing doesn't mean much. The flag says the account, this month's total, the earlier average and the percent change, for example *6620 Ministry Supplies is $4,200 this month vs a $1,100 average over the last 3 months (+282%).* There is one flag per account per month.

It needs at least **two earlier months** in the pull, so a year-to-date pull in January or February won't show it; the usual 14-month pull does. The account also needs activity in at least two of those months, so a one-time bill doesn't flag the months after it. Like **Not reconciled**, it's saved as of the last completed month, whichever month you're looking at, so it isn't saved from a one-off **Go back to** pull. Clear it when the change is expected (a big event, a seasonal bill), or use **Stop flagging** to quiet one account.

### Possible duplicates: Smart or Strict

The **Possible duplicate** check looks for entries with the same date, name, amount and account on different transactions. It has two modes. A small chip near the top of the tab says which one applies: **Possible duplicates: Smart** or **Possible duplicates: Strict**, and whether it is the firm default or set for this client.

- **Smart** (the default) skips look-alikes that are clearly not duplicates, so there are fewer false alarms.
- **Strict** is the original rule: it flags every same-date, same-name, same-amount, same-account match on a different transaction.

What Smart does **not** flag:

- **Different dates.** A monthly recurring payment never flags, because each one is on its own date. (Strict doesn't flag these either.)
- **Under $1.** A $0.50 fee that repeats isn't worth a look. The floor is $1.
- **A Payment and a Deposit on Undeposited Funds.** Two different kinds of entry that pass through a holding account, like a customer Payment and the bank Deposit that holds it, or a transfer between a bank and a clearing account, aren't a pair. Two entries of the same kind can still pair, and so can two money-out kinds (Expense, Check, Bill, Bill Payment, card charge) or two money-in kinds (Invoice, Sales Receipt, Deposit, Payment).
- **Different memos or different numbers.** If both entries have a memo and the memos differ, or both have a document number and the numbers differ (two invoices numbered 1041 and 1042), they're treated as separate.
- **Split lines.** Lines of the same transaction aren't a duplicate of each other.

What still flags in Smart mode: when in doubt, it flags. Two entries of the same kind, on the same day, for the same amount, with blank or identical memos still flag. The flag names the other entry and says what it found: *same memo*, *same number* or *nothing tells them apart*.

In Smart mode the tab says how many possible duplicates it set aside and lists them (date, name, type, amount), so you can see what was skipped. **Show** opens the list.

**When a change applies.** The ledger lines aren't stored, so a change to Smart applies on the **next Pull from QuickBooks**. A change to Strict also brings hidden flags back right away. A duplicate flag that was open and that Smart no longer detects is not deleted. It's marked **No longer flagged (Smart mode)**, hidden from the open list and left out of the count the Close step uses. Your decisions (Ask client, Clear, Stop flagging, Approve, notes) are never touched. Switching back to Strict reopens those flags.

An admin picks the mode for the firm in **Team › Ledger review** (see Settings below), and can set a different mode for one client from the chip on that client's Ledger review tab, for example Strict for one client while the firm uses Smart.

### Reconciliation

One row per bank, card and loan account: how many items haven't cleared, the dollars, and the oldest date. A loan with uncleared items while the operating accounts are clean is marked high priority. If the pull has no cleared data for a company, it says **Not available for this company**.

The panel follows the **Month** you pick. The **Not reconciled** flag itself is saved as of the last completed month, whichever month you're looking at, and stays until you clear it, even after the items reconcile.

### Month vs. the year

Income and expense accounts only, compared with the rest of the year. Balance sheet accounts and anything marked pass-through are left out. Click an account to see its lines. **Copy for Excel** copies the rows.

### Summary for the client

A short plain-English write-up of the month, built from the flags (it's a template, not a person's opinion). Edit it as much as you like, then **Save draft**. **Start over from the template** rebuilds it.

- **Send via portal** posts it as a message in the client's portal. It's off when the client has no active portal users.
- **Send by email** sends it to the client's contact email, with your own address as the reply-to. It's off when no contact email is set.

Nothing sends by itself. See [How do I manage client emails?](#/help/client-emails).

### Client setup: greeting name and contact email

On the client's **Overview**, open **Edit dates and coverage**:

- **Greeting name** is how the summary says hello, like *Pastor Mark* or *Mrs. Ellis*. Left empty, it says *Hello,*.
- **Contact email** is where Ask client and **Send by email** go for a client who doesn't use the portal. Staff only. Use one lowercase address.

### Mark reviewed, approve, send back

At the bottom of the tab is the sign-off for the month:

- **Mark reviewed** is yours to click when you've worked through the flags. It shows *Ready to mark reviewed* once no high priority flags are open. If some are, it tells you how many were open.
- An admin then sees **Approve** and **Send back**. **Send back** asks what needs another look, and you see the note. An admin can approve their own review. Both names are recorded.
- The **Ledger reviewed** step on the Close tab follows this sign-off. You can't tick it by hand. See [What's on a client's Close tab?](#/help/client-close).
- Counts on the Close tab's **Ledger review** card are as of the last pull, and the card says so.

### Marking the month done

By default Ledger review **warns** but doesn't block. If an admin signs off the month before it's approved, the app asks *Ledger review isn't approved. Sign off anyway?* Yes records who went ahead. An admin can change this to **Block** in Team › Ledger review.

### Review a file

**Work › Ledger review** checks any exported General Ledger (.csv or .xlsx, up to 25 MB), for a client who isn't on QuickBooks or a quick look at someone's file. All staff can use it.

1. **Choose a file** (or drop it on the box).
2. Read the flags and the accounts it found. Check the account types and pass-through guesses in the list; fix any that are wrong. Those fixes apply to this file only and aren't saved.
3. **Copy for Excel** takes the flags with you.

The file is read in your browser. Nothing is uploaded, stored or sent to QuickBooks, and it's gone when you leave the page.

### Settings (admins)

**Team › Ledger review**. Only admins see this tab.

- **Marking a month done**: *Warn* (the default) or *Block*. With Block, a month can't be signed off until its review is approved, and an admin can override with a reason.
- **Go back to**: the usual range for every pull, 14 months back (recommended) or this year so far. Staff can go further back for one pull on the client's tab.
- **Count the Close step from**: the first month the Ledger reviewed step applies to, so older months don't suddenly look behind.
- **Possible duplicates**: **Smart (fewer false alarms)** or **Strict (flag every same-date, same-amount match)**, the firm default for every client, with **Save**. Each change is written to **Settings › Firm settings › Audit log**. A single client can be set differently from their Ledger review tab (admins only). See *Possible duplicates: Smart or Strict* above.
- **Vendor watch list**: names that get a *Watch-list vendor* flag for every client. Add a name with a category, edit it, or turn it off.

In **View as** (admins) the tab doesn't pull from QuickBooks by itself. It shows the last pull with "Read-only: showing the last pull." and Pull, Clear, Ask, Send back, Mark reviewed and Approve are disabled.

### Troubleshooting

- **There's nothing to pull.** The client's QuickBooks isn't connected. Reconnect it, or use **Review a file**.
- **Send by email is grayed out.** Add a contact email under Client setup above.
- **Send via portal is grayed out.** The client has no active portal users who can see the whole company. If it says *portal users couldn't load*, the database update isn't applied yet; email still works.
- **"The firm watch list didn't load."** That pull used the built-in list, so nothing was marked fixed. Pull from QuickBooks again later.
- **I can't tick Ledger reviewed.** That's on purpose. Click **Mark reviewed**.
- **A duplicate flag I expected is missing.** In Smart mode it may have been set aside; open the list under the **Possible duplicates** chip, or ask an admin to switch the client to Strict.
- **A flag says No longer flagged (Smart mode).** A later pull found that Smart no longer calls it a duplicate. It stays on record, and switching to Strict reopens it.
- **A flag keeps coming back.** Clear it with **Stop flagging this** to keep that pattern quiet for this client.
- **A message says the database update isn't applied.** An admin needs to run the Ledger review database update. See [the FAQ](#/help/faq).
