# Review board: DRAFT guide text

Draft for the hidden Review board preview (Feature flags label "Review board (preview)", localStorage `mgb_reviewboard_preview`; firm switch `tk_settings.reviewboard_enabled`, owner-only). Publish at launch, when the owner flips `reviewboard_enabled`: create the guide article with slug `review-board` (the Work › Review board tab's `help` key already points at it), add it to the admin guide's Work section, and sync the guide rows. Do not copy into the live guide before then. Real admins only: bookkeepers, temp admins and View as never see any of this.

## Review board (article `review-board`)

**Where:** Work › Review board. Admins only.

The Review board shows every client's month-rhythm work for one month on one screen: the **Check in** (4th), **Send reports** (14th) and **Follow up** (24th) tasks, the month-end close status, and who to contact.

### Columns

- **Client.** The name opens the client. The ▸ arrow opens the client's contacts under the row (see below).
- **Bookkeeper** and **Backup.** From the client's assignments. **Unassigned** means no bookkeeper is set.
- **Main contact.** From the client's organization profile. With no profile contact, the client's first active portal login shows instead. **Not set** means neither exists.
- **Check in**, **Send reports**, **Follow up.** One chip per deadline (the column names follow Settings › Firm settings › Month rhythm). A chip says what state the task is in:
  - **Done · Sierra · Nov 14**: who finished it and when.
  - **Not needed · nothing outstanding**: the system closed it because there was nothing to send.
  - **Ready for review · Sierra**: waiting for an approver.
  - **Late · due Nov 14 · Sierra** (red): past its due date and still open.
  - **Open · due Nov 24 · Sierra**, **Open · waiting on client** or **Open · preliminary month**. Waiting on client and preliminary months are never late.
  - **No task yet**: the rhythm has not made this task for the client.
  - A second line, **Email marked sent · Jesse · Nov 14**, shows when someone used **Mark sent** in the email draft.
  Click a chip to open the task.
- **Close.** The same status as the Close tracker (Not started, In progress, Review, Done, N/A, or **Late**). Click it to open the client's Close tab.
- **Approve.** Reserved for a later step. It shows a dash for now.

Every column header sorts the table; click it again to reverse. Empty values stay at the bottom either way. Your sort is remembered in this browser.

### Filters

- **Month:** last month (the default) or the two before it.
- **Bookkeeper:** one person, or **Unassigned**.
- **Status:** **Has late**, **Any open**, **All three done**, **No task yet**, **Close not done** or **Preliminary reports**.
- **Show test clients:** test clients and MGB (internal) are hidden unless this is ticked.
- **Refresh** reloads the board.

The line under the filters counts the clients shown and how the current deadline is going, for example **62 clients · 14th: 41 done, 21 open** (done includes not needed).

### Contacts (the ▸ arrow)

Opens a row under the client with the main contact (name, email, phone) and every portal login. Inactive logins are dimmed.

### Links

- The address `#/work/review?period=2026-10` opens the board on that month (one of the last three).
- Work › Close has an **Open Review board** button for admins.

## Deadline digest (bell)

If the owner has put you on the digest list, your bell gets one entry per deadline, refreshed every morning: **Send reports for October: 41 of 62 done, 21 open**. It comes back as new when the numbers change. Click it to open the Review board on that month. While only test clients have rhythm tasks the entry starts with **Test clients ·**. Nothing is emailed.

## Email drafts: To and Cc, Open in email app, Mark sent

The draft window on a month-rhythm email task (Draft request, Draft reports, Draft maintenance) gains, for admins:

- **To** chips: the main contact (on), the client's contacts (people who can answer requests first) and the client's portal logins that have not opted out (off). Click a chip to turn it on or off. No chips means the client has no contacts yet: **Add a contact in Client info**.
- **Cc** chips: the bookkeeper and the account manager, on unless it is you. They replace the "Suggested CC" line.
- **Copy draft** copies To, Cc, Subject and the email together.
- **Open in email app** opens your own email app with To, Cc, Subject and the email filled in. If the email is too long for that, the app opens without the body and the body is copied for you: **Body copied. Paste it into the email.**
- **Mark sent** records that you sent it (**Marked sent by you · 2:14 pm**, with **Undo**). It does not complete the task. The Review board chip shows the marker.

Nothing is ever sent from the portal. You send the email from your own email app.


> **Held note (client contacts, 2026-11-05):** when both `reviewboard_enabled` and `org_contacts_enabled` are on (or for test clients / the Org profile contacts preview), the ▸ expander shows one **People** list instead of "Main contact … first portal login" and Portal logins. Each person shows where they came from: **Main contact**, **Main contact (from org profile, not saved as a contact yet)**, **Contact list** or **Portal login**, plus Monthly emails, Can answer, **Added by client** and Opted out. Email-draft To chips come from the same list (main contact and Monthly emails preselected, never anyone opted out). See `drafts/client-contacts-org-profile.md`. Update this text at that launch.
