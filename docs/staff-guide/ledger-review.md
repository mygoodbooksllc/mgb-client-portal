---
title: How does Ledger review work?
section: Working with a client
audience: staff
keywords: [ledger review, general ledger, GL review, gl, flags, pull from quickbooks, pull again, clear a flag, ask client, got an answer, stop flagging, reconciliation, month vs the year, summary for the client, send via portal, send by email, greeting name, contact email, mark reviewed, approve, send back, ledger reviewed, warn, block, review a file, copy for excel, watch list, vendor watch list, uncategorized, suspense, opening balance equity, duplicate, check gap, round dollar, weekend, high priority]
sort: 207
---
**Ledger review** checks one month of a client's General Ledger for things worth a second look, before you close the month. It lives on the client's **Ledger review** tab, right after **Close**. Staff only. The client never sees this tab, and nothing in it changes their QuickBooks.

Open it from the client's tab row, or go straight to `#/client/{id}/ledger`. Check a ledger that isn't in QuickBooks with **Review a file** (below).

### Pull the ledger

1. Pick the **Month**. It opens on the last completed month.
2. The tab gets the ledger from QuickBooks (a "pull") and saves the flags it finds. **Pull from QuickBooks** gets the latest any time, for example after you fix something in QuickBooks. The line next to it says when the last pull happened and the months it covered, like *covered Aug 2025 – Oct 2026*. **Review month** is just the month you're checking.
   - **Go back to** (next to the button; the **i** explains it) chooses how far back that one pull goes: the usual 14 months, or any earlier month up to 24 months back. It applies to this pull only and never changes the saved setting in Settings; it goes back to the usual range after the pull. An earlier-month pull always runs fresh, and it doesn't clear flags that dropped out of QuickBooks (only the usual pull does that). It also saves only the checks that don't depend on how much history is loaded; round amounts, weekends, large, repeat vendors, check gaps and uncleared loans are shown but not saved. Use the usual range for the routine pull.
3. If someone else is pulling the same client, the tab says so. Wait a minute and click **Try again**.

A client without a working QuickBooks connection has no ledger to pull. The tab says so and points you to **Review a file**.

### The summary strip

Across the top: ledger lines, open flags, high priority, asked, and the dollars sitting in Uncategorized and in Ask client. Use it to see at a glance whether the month is ready.

### Flags

Each flag is one transaction (or one account) that a check picked out. The checks include suspense or uncategorized, opening balance equity, possible duplicates, a negative bank balance, a manual journal entry to cash, check number gaps, unusually large amounts, round dollars, weekend dates, no name or memo, and accounts that aren't reconciled. **Watch-list vendor** flags come from the list an admin keeps (see Settings below). **Changed after close** flags a month that was already closed.

- Filter by check with the chips, and by state with the **Open**, **Asked** and **Cleared** tabs.
- Each flag says **Open since {month}**, so one that carries over month after month is easy to spot.
- High priority flags are the ones to deal with before you mark the month reviewed.

What you can do with a flag:

- **Clear** it. Pick a reason (*Expected, nothing wrong*, *Reviewed, it's fine*, *Fixed it in QuickBooks*, *The client answered* or *Other*) and add a note if it helps. Your name and the time are recorded.
- **Stop flagging this** (in the Clear box). A rule is saved for this client only, so the same pattern stays quiet from now on. The rules are listed on the tab. You can remove one any time, or accept or dismiss a rule the tab suggests.
- **Ask client** when only they can say what a charge was. The question is pre-filled and you can edit it. You choose **In the portal** (replies come back in Messages; only portal users who can see the whole company are offered, never someone limited to certain accounts) or **By email** to their contact email (see Client setup below; replies come to your own email). The flag moves to **Asked**.
- **Got an answer** when the client replies. Then clear it.
- **Send back** (admins) on a cleared flag you disagree with. It goes back to **Open**.

An asked question can show the amount and the question text in the email. It never shows our fees, rates or margins.

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

By default Ledger review **warns** but doesn't block. If you mark the month done before it's approved, the app asks *Ledger review isn't approved. Mark done anyway?* Yes records who went ahead. An admin can change this to **Block** in Team › Ledger review.

### Review a file

**Work › Ledger review** checks any exported General Ledger (.csv or .xlsx, up to 25 MB), for a client who isn't on QuickBooks or a quick look at someone's file. All staff can use it.

1. **Choose a file** (or drop it on the box).
2. Read the flags and the accounts it found. Check the account types and pass-through guesses in the list; fix any that are wrong. Those fixes apply to this file only and aren't saved.
3. **Copy for Excel** takes the flags with you.

The file is read in your browser. Nothing is uploaded, stored or sent to QuickBooks, and it's gone when you leave the page.

### Settings (admins)

**Team › Ledger review**. Only admins see this tab.

- **Marking a month done**: *Warn* (the default) or *Block*. With Block, a month can't be marked done until its review is approved, and an admin can override with a reason.
- **Go back to**: the usual range for every pull, 14 months back (recommended) or this year so far. Staff can go further back for one pull on the client's tab.
- **Count the Close step from**: the first month the Ledger reviewed step applies to, so older months don't suddenly look behind.
- **Vendor watch list**: names that get a *Watch-list vendor* flag for every client. Add a name with a category, edit it, or turn it off.

### Troubleshooting

- **There's nothing to pull.** The client's QuickBooks isn't connected. Reconnect it, or use **Review a file**.
- **Send by email is greyed out.** Add a contact email under Client setup above.
- **Send via portal is greyed out.** The client has no active portal users who can see the whole company. If it says *portal users couldn't load*, the database update isn't applied yet; email still works.
- **"The firm watch list didn't load."** That pull used the built-in list, so nothing was marked fixed. Pull from QuickBooks again later.
- **I can't tick Ledger reviewed.** That's on purpose. Click **Mark reviewed**.
- **A flag keeps coming back.** Clear it with **Stop flagging this** to keep that pattern quiet for this client.
- **A message says the database update isn't applied.** An admin needs to run the Ledger review database update. See [the FAQ](#/help/faq).
