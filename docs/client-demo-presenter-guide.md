# Client portal demo: presenter guide (for a pastor, over Google Meet)

Written 2026-11-05. Pairs with `docs/client-demo-review-2026-11.md` (the findings list). Things marked **(after fix)** assume the owner approved that fix from the review; if it is not done yet, follow the "until then" note.

Everything here was checked against the live app (Pro Test Client, viewed as its test contact) and the code on `main` at 963a63e.

## The one idea to leave the pastor with

"Your bookkeeping team and your books live in one calm place. You see your real numbers, answer us in one spot, and only the people you choose can see it."

## Which client to present with

**Use "Pro Test Client" (internal id `grace-community`), viewed as its test contact "Pastor John Whitfield" (Lead Pastor).**

- It is a church, on the Pro plan with the Payroll add-on, so every client page is on show.
- It is connected to a QuickBooks test file (synced hourly), so the money pages have believable church numbers (Operating Checking, Building Fund Savings, Ministry Visa, weekly offerings). No real client names or numbers appear.
- Do **not** present with a real client (3Circle Church, etc.). Do **not** use "Basic Test Client": it shows a "Prototype · Sample Data" pill and unfinished sample text.
- Most real clients (67 of 69) are on Basic, which has only Home, Messages, Reports and Documents. If the pastor's church would be Basic, say: "Pro adds the live money pages, which I'll show you now."

Show it with **staff "View as client"** (Clients › Pro Test Client › Client overview › Client view › View as client… › Pastor John Whitfield). A gold bar at the top says "Previewing as Pastor John Whitfield… This is exactly what they see when they sign in." That is honest and fine to leave on screen. Do not type any password anywhere.

What View as does not show you (so describe it in words): the sign-in screen, the first-time welcome tour starting on its own, and the "tell us about your organization" prompt.

## Pre-demo checklist (do this the day before, and again 15 minutes before)

1. **Sign in to the portal as yourself and open it once** so it is not cold. The first load takes several seconds ("Loading your portal…") because the app builds itself in the browser. Never load it for the first time while sharing. Also sign in once as the demo contact outside View as, finish or skip the tour, dismiss the "Get set up" checklist and the "Finish your organization profile" pop-up, then sync QuickBooks just before the call (finding F-15).
2. **Browser:** Chrome, one window, zoom 100% (125% also looks fine). Hide the bookmarks bar. Close other tabs except these, in this order: (1) portal in View as, (2) a private window on app.mygoodbooks.org showing only the sign-in page, (3) the Google Drive folder is NOT open.
3. **Theme:** use Dark (it is clean everywhere). Light theme has one contrast problem on Home (finding F-08) until it is fixed.
4. **Share one browser tab, not the whole screen,** so notifications, other tabs and Slack never show. Turn on Do Not Disturb (macOS Focus) and quit Slack, Mail and Messages.
5. **Go to the top of each page once before the call** so charts have drawn. Charts fade in a few seconds after you scroll to them; on the call, pause on a page for a breath before talking about its chart.
6. **Clean the test data** (findings F-01, F-02, F-04): the "Signed engagement letter (sample)" request and its file name, the canned Aug 2026 conversation, and stale payroll dates. Until then, follow the "avoid" notes below.
7. **Check the date effect.** Early in a month, Budget shows $0 spent for every category and Giving shows "$0 so far this month". On 2026-11-05 this makes the Budget page look broken. (finding F-03). Either fix first or skip Budget.
8. **Keep one fallback:** have the Reports "Download PDF" sample already downloaded in your Downloads folder in case the browser is slow.
9. **Do not press** Sync now, Upload, Send, Replace file, or any delete "×" during the demo. View as is read-only, but the pastor does not need to see error toasts.
10. Click **Exit preview** at the end, before you stop sharing, so the staff screen is never shown.

## 15-minute running order

| Min | Page | What you do |
|---|---|---|
| 0:00 | (private window) Sign-in | Show the email-link sign-in. One sentence on no passwords. Then switch to tab 1. |
| 1:30 | Home | Needs you, organization card, the snapshot, Bills due soon. |
| 4:00 | Finances › Bank accounts | The strongest page. Accounts, transactions, search, Export CSV. |
| 7:00 | Finances › Giving & funds | Fund balances (restricted vs unrestricted). Skip Budget and Payroll unless fixed. |
| 9:00 | Reports › Downloads, then Board packet | One-click statements; the board packet. |
| 11:00 | Messages | One conversation for the whole team, plus "What we need from you". |
| 12:30 | Documents | Where files go to and from your bookkeeper. |
| 13:30 | Settings › Security & privacy and Plan | Who sees what, then plans. |
| 14:30 | Wrap-up and questions | Exit preview. |

## Page by page

### 0. Sign-in (private window only)
- **Purpose:** the front door. Clients get an emailed link or code, no password to forget.
- **Say:** "There is no password to remember or leak. We email you a one-time link. Only people we set up can get in."
- **Click:** nothing. Do not type any email.
- **Questions:** "What if someone forwards the email?" → The link works once and only for that email address; sign-out on all devices is in Settings. "Is there two-step sign-in?" → No separate second step today; the emailed link is the only way in (do not promise one).
- **Avoid:** typing a real email address or code on screen.

### 1. Home
- **Purpose:** what needs your attention, and where your finances stand, on one page.
- **Say:** "This opens with 'Needs you': anything your bookkeeper is waiting on. Today it says you're all caught up. Next to it is your organization card with your plan. Below is a live snapshot from QuickBooks: cash, what you're owed, what you owe, and this month's net income."
- **Click:** scroll slowly: the four number tiles, Revenue vs. expenses, Cash by account, Receivables aging, then Bills due soon. Point at "Synced with QuickBooks Online · 44 minutes ago" and say "this refreshes every hour on Pro."
- **Questions:** "Is this our real balance?" → It is read from QuickBooks; the portal never changes QuickBooks. "Why a red ▼ 29.5%?" → October's net income is lower than September's (say it is test data).
- **Avoid:** the "Customize overview" and "New custom card" buttons (unrehearsed). The small **ALERT** tag on Cash on hand has no explanation on screen (finding F-09); do not hover it. The Collections Queue and "Anomalies & Flags" tab are bookkeeper-style words; skip them.

### 2. Finances › Bank accounts
- **Purpose:** see every account balance and every transaction without logging in to the bank.
- **Say:** "Three accounts and one credit card, with net cash after what's owed on the card. Search any transaction, filter by month, and export to a spreadsheet."
- **Click:** point at the three tiles; scroll the Transactions list; type "offering" in the search box; click "Last month". Do not click Export CSV on a shared screen unless you want a download.
- **Questions:** "Does this connect to our bank?" → The numbers come through QuickBooks, which gets them from the bank feeds your bookkeeper maintains. The portal never stores bank passwords. "Can we ask about a charge?" → Yes, tap a transaction and ask your bookkeeper (Pro). "Reconciliation?" → The second tab shows whether each month is reconciled (only open it if rehearsed).
- **Avoid:** the "Missions fund top-up" row shows "Operating Checking" as its category (a transfer); do not dwell on it.

### 3. Finances › Giving & funds
- **Purpose:** church-specific: how much was given, and which money is restricted vs free to use.
- **Say:** "Restricted funds like the Building Fund and Missions are tracked separately from unrestricted money, so you can answer 'do we really have this to spend?'"
- **Click:** the five fund cards; then the Giving and Contributions sub-tabs only if rehearsed.
- **Questions:** "Can members get giving statements?" → Tax Documents is a sub-tab; say "we can walk through that next" rather than demoing it.
- **Avoid:** nothing major. Remember the "$0 so far this month" line early in a month.

### 4. Finances › Budget (only after fix F-03) and Cash flow
- **Budget:** purpose is planning next year's budget with your bookkeeper. **Skip it on 2026-11-05 unless F-03 is fixed**: it shows every category at $0 and "+956.3% vs. current budget × 12", which looks like an error.
- **Cash flow (Open bills, Who owes you):** "Every bill you owe, how overdue, and who owes your church." Use plain words: owed to you / you owe. Skip the Vendor Summary and aging boxes.

### 5. Finances › Payroll
**Do not show.** It is labeled "Sample Gusto data, not connected yet" and shows September dates and Q3 deposits still marked "Upcoming" (finding F-04). If the pastor asks: "Payroll is an add-on that shows pay runs and tax deposits; we'll set that up per church."

### 6. Reports
- **Purpose:** the statements your board and auditors ask for, as PDFs.
- **Say:** "Profit & Loss, Balance Sheet, Budget vs. Actual: one click each. Choose the period, then Download."
- **Click:** the three period buttons; then **Board packet** tab. Say "this builds one board-ready PDF with a cover page, a plain-words 'What happened this month' and the Treasurer's note." Use **Preview on screen** or **Presentation view** rather than Download if you rehearsed it.
- **Questions:** "Can the treasurer add a note?" → Yes (Treasurer's note field). "Can we share it?" → Share links gives a read-only copy.
- **Avoid:** the **Contribution Statement** card (says "Giving isn't connected yet" although Giving shows data: F-05) and the Payroll YTD card. The packet page has seven sub-tabs; stay on the first one. "vs. same month last year" is ticked but says it can't work yet (F-07).

### 7. Messages
- **Purpose:** one place to talk to your bookkeeping team and answer what they need.
- **Say:** "Instead of email threads, you message us here, and each person has a private conversation. When we need something from you, it shows up under Requests and on Home."
- **Click:** Conversation, then Requests ("Nothing is waiting on you right now."). Do not click Send.
- **Avoid until fix F-02 (appears in View as only; a real client never sees it):** the banner "This is a sample conversation — sending a message here doesn't notify anyone yet" and the canned August thread dated Aug 20/21 with a $142,300 Building Fund balance that does not match Giving & funds ($61,246).
- **Questions:** "Who reads these?" → Your account manager and bookkeeper; other staff only if assigned or approved. Staff-only notes never show to you.

### 8. Documents
- **Purpose:** the shared folder between you and your bookkeeper.
- **Say:** "When we need a bank statement, it shows up here as a request with a due date; you drag the file in and it goes straight to us."
- **Click:** point at the folder chips (Bank statements, Financial statements, Tax, Receipts, Payroll) and the drag-and-drop box. Do not upload.
- **Avoid until fix F-01:** the "Signed engagement letter (sample) / Sample request for testing" row and its file name "Bluevine Bank Account (2).pdf". Also the small "×" next to the folder chips.
- **Questions:** "Where do the files actually live?" → In MyGoodBooks' Google Drive for the firm, shown to you through the portal; you do not need a Google account. "Who sees a file I upload?" → By default everyone at your church who has a login; staff can narrow it (client page drop is ON for all clients: it adds the "who can see this file" choice).

### 9. Settings
- **Security & privacy tab:** the best trust slide. Read the sections on screen: signing in, who can see your books, how data is stored.
- **Plan tab:** Basic is free (1 login included); Pro is $100/mo + $20/mo per login; lists what Pro adds. Use it only if the pastor asks about price; the "$ per month for your 3 logins" lines show test-client numbers.
- **Appearance:** light, dark, or match your computer.
- **Help:** "See the tour" and "Message your bookkeeper".
- **Avoid:** Notifications' "Month-end reports are ready / Monthly summary" explanations are fine; skip.

### 10. The "?" menu and the guided tour
- The "?" button (top right) offers: take the tour, message your bookkeeper, what we need from you, help and settings, contact support.
- The tour has **13 steps** and says it "takes about two minutes". Do not run it live. If asked: "Every new person gets a short walkthrough the first time they sign in."
- Known tour mismatches (finding F-10): step 2 says "Customize dashboard" (the button says "Customize overview"); step 11 describes a Settings "Your organization" page not in the Settings list for this contact.

## How it keeps their data safe: who sees what (talking points)

Say these; every one matches how the portal works today.

1. **Sign in:** emailed one-time link or code. No passwords stored. No self sign-up: only MyGoodBooks staff can create a login. "Sign out on all devices" is in Settings.
2. **Your church only:** every page, message and file is tied to your organization. A login from another church cannot see yours (the database itself checks this on every request, not just the screen).
3. **Inside your church:** the person who sets you up decides which pages each login sees. Messages are private per person; one teammate cannot read another's conversation.
4. **MyGoodBooks staff:** a few MyGoodBooks admins can see every client. Other staff see your books only if they are assigned to you, or for a short time when your bookkeeper approves it. Changes to who has access are recorded.
5. **QuickBooks:** the portal reads your QuickBooks; it does not change your books. The connection key is stored encrypted. You can disconnect any time from your Intuit account.
6. **No bank passwords:** the portal never asks for or stores bank logins. Bank data arrives through QuickBooks.
7. **Files:** stored in MyGoodBooks' secure Google Drive and shown through the portal; clients do not need Google access. Only staff can delete files.
8. **Email:** portal notices go by email (sent through our email service) and say what happened and link back; message text itself stays in the portal.

### Do NOT say (these would overclaim)
- "Nobody at MyGoodBooks can see your data." (Admins can; staff reads are not logged.)
- "We can't touch your QuickBooks." Say instead: "The portal only reads it."
- "Bank-level security", "SOC 2", "audited", "two-factor".
- "Everything is backed up." The Security tab says account details and messages are backed up daily, but uploaded files are not part of that backup (note in the code). If asked, say "I'll confirm the exact details in writing."
- The Security tab also says "No one else" can see your books and names vendors (Supabase, Vercel, Resend). Do not read those lines aloud (finding F-14); say the plain version from the list above.

## Likely questions, short answers

- **What does it cost?** Settings › Plan: Basic free, Pro $100/mo + $20 per extra login (confirm current pricing before the call).
- **Can several people at the church log in?** Yes, each with their own email and, if you want, limited pages.
- **What if our bookkeeper changes?** Your history stays; your account manager is named on Home (Jesse) and in Settings.
- **Is it on a phone?** Yes: Home, Messages, Finances, Reports and More at the bottom. (Layout tested at phone width; no sideways scrolling on any client page.)
- **Can we install it like an app?** Not yet for clients (staff only today).
- **Who is Milestone / "II · Foundation"?** Your pricing tier for bookkeeping; shown on the organization card.

## What is live for clients today versus hidden (only demo live things)

Live for clients: Home with Needs you, Messages (Conversation, Requests), Finances (Budget, Bank accounts, Cash flow, Giving & funds, Payroll with add-on; Pro only), Reports (Downloads, Board packet; Pro), Documents, Settings, "?" menu, first-visit tour, client page drop (ON, all clients, since 2026-10-31), organization profile prompt (ON since 2026-10-25, shown to real client logins only).

Hidden or off: Agreements, "Preliminary reports" badge, upload email to account manager, Ask-client request emails (portal shows requests; no email yet), anniversary gifts, review board, Slate/Desk, installable app, What's-new notices and tips (staff only).

Switch values come from the Dev Tools descriptions; re-check them in Dev Tools before the call.
